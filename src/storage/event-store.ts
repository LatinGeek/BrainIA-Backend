import { classifyEvent } from "../domain/classification.js";
import type { EventInput } from "../domain/event.js";
import { buildEntityDrafts, type EntityDraft } from "../domain/entities.js";
import { buildRelationDrafts } from "../domain/relations.js";
import { pool, withTransaction } from "./postgres.js";
import { maybeEnhanceClassification } from "./classification-assistant.js";
import { invalidateGraphTraversalCache } from "./graph-cache.js";
import { enqueueEntityReview } from "./entity-alias-repository.js";
import { buildFinancialTransactionCandidate } from "../domain/financial-transactions.js";
import {
  countKnowledgeMetrics,
  deleteDerivedDataForEvent,
  insertClassifiedEvent,
  insertRawEvent,
  linkEventEntity,
  loadRawEventById,
  loadStoredEventByLookup,
  listStoredEvents,
} from "./event-repository.js";
import { upsertEntity } from "./entity-repository.js";
import { linkFinancialTransactionForEvent } from "./financial-transaction-repository.js";
import { linkEventRelation, upsertRelation } from "./relation-repository.js";
import { semanticInstanceDraft } from "../domain/ontology.js";
import { consolidateProviderIdentity, ensureOntology } from "./semantic-repository.js";
import { resolveEventSemantics } from "./semantic-resolver.js";
import { buildModelSemanticDecision } from "./semantic-enrichment.js";
import type { SemanticDecision } from "./semantic-enrichment.js";

export type EventIngestionContext = {
  clientId?: string | null;
};

export function buildEventDedupeKey(event: EventInput, clientId: string | null | undefined) {
  const stableInput = event.idempotencyKey?.trim() || event.externalId?.trim() || event.id.trim();
  const clientScope = clientId?.trim() || "anonymous";
  return `${clientScope}:${event.source}:${event.contractVersion}:${stableInput}`;
}

function isFinancialInferredKind(kind: string) {
  return kind === "expense" || kind === "income";
}

function shouldPersistGraphEntity(draft: EntityDraft) {
  // Classifiers may extract dozens of payload fields (URL, timestamp, action,
  // device property, etc.). Those belong to the raw event, not to the durable
  // knowledge graph. New durable concepts can only enter through a reviewed
  // semantic proposal, never through an extractor field.
  return ["app", "merchant", "sender", "recipient", "email_message", "financial_event", "activity_instance"].includes(draft.type);
}

function governedGraphDrafts(decision: SemanticDecision) {
  const seen = new Set<string>();
  return decision.paths
    .map((path) => path.subject)
    .filter((draft) => {
      const eligible = draft.identitySource === "ai" && Boolean(draft.description?.trim()) && draft.metadata?.aiIdentity === true;
      const key = `${draft.type}:${draft.normalizedValue}`;
      if (!eligible || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function persistClassifiedEvent(
  event: EventInput,
  clientId: string | null,
) {
  const classified = await maybeEnhanceClassification({
    event,
    base: classifyEvent(event),
  });
  const dedupeKey = buildEventDedupeKey(event, clientId);
  const entityDrafts = buildEntityDrafts({ ...classified, raw: classified.raw });
  const instanceDraft = semanticInstanceDraft({ eventId: event.id, inferredKind: classified.inferredKind, source: event.source, title: event.title, body: event.body });
  entityDrafts.push(instanceDraft);
  // Model inference must happen before opening a database transaction. Holding
  // ontology row locks while waiting on the network serializes batch workers.
  const semanticDecision = await buildModelSemanticDecision({ entities: entityDrafts, source: event.source, inferredKind: classified.inferredKind, title: event.title, body: event.body, clientId });
  const graphDrafts = governedGraphDrafts(semanticDecision);

  return withTransaction(async (db) => {
    const inserted = await insertRawEvent(db, event, clientId, dedupeKey);
    if (!inserted) {
      const existing = await loadStoredEventByLookup(db, event.id, dedupeKey);
      if (!existing) {
        throw new Error("Duplicate event could not be resolved");
      }

      return existing;
    }

    await insertClassifiedEvent(db, classified, event.id, clientId);

    await ensureOntology(db, clientId);
    const upsertedByType = new Map<string, Awaited<ReturnType<typeof upsertEntity>>>();
    for (const draft of graphDrafts) {
      if (!shouldPersistGraphEntity(draft)) continue;
      const entity = await consolidateProviderIdentity(db, draft);
      if (!upsertedByType.has(draft.type)) {
        upsertedByType.set(draft.type, entity);
      }
      await linkEventEntity(db, event.id, entity.id, 0.8);

      if (draft.type === "merchant" && isFinancialInferredKind(classified.inferredKind)) {
        await enqueueEntityReview(db, {
          entityId: entity.id,
          eventId: event.id,
          source: event.source,
          originalValue: String(draft.metadata?.evidenceValue ?? draft.value),
          suggestedAlias: draft.value,
          reason: "ai_identity_review",
        });
      }
    }

    const relationDrafts = buildRelationDrafts({
      title: event.title,
      body: event.body,
      source: event.source,
      inferredKind: classified.inferredKind,
      entities: graphDrafts,
    });

    for (const draft of relationDrafts) {
      if (!shouldPersistGraphEntity(draft.sourceEntity) || !shouldPersistGraphEntity(draft.targetEntity)) continue;
      const sourceEntity = await upsertEntity(db, draft.sourceEntity);
      const targetEntity = await upsertEntity(db, draft.targetEntity);
      const relation = await upsertRelation(db, draft, sourceEntity.id, targetEntity.id);
      await linkEventRelation(db, event.id, relation.id, draft.confidence);
    }

    const providerDraft = graphDrafts.find((draft) => draft.type === "app");
    const instanceEntity = upsertedByType.get(instanceDraft.type);
    const providerEntity = upsertedByType.get("app");
    if (providerDraft && instanceEntity && providerEntity) {
      const relation = await upsertRelation(db, {
        relationType: "produced_by_app",
        label: "Captured by app",
        description: `${instanceEntity.value} is an event from ${providerEntity.value}`,
        sourceEntity: instanceDraft,
        targetEntity: providerDraft,
        confidence: 1,
        metadata: { source: "event-hierarchy" },
      }, instanceEntity.id, providerEntity.id);
      await linkEventRelation(db, event.id, relation.id, 1);
    }

    if (instanceEntity) for (const draft of graphDrafts) {
      if (["app", "activity_instance", "financial_event", "email_message", "sender", "recipient", "merchant", "amount", "expense", "income", "notification"].includes(draft.type)) continue;
      const evidence = await upsertEntity(db, draft);
      if (evidence.id === instanceEntity?.id) continue;
      const relation = await upsertRelation(db, {
        relationType: "evidence_for", label: "Evidence for event",
        description: `${evidence.value} is evidence captured in ${instanceEntity?.value ?? "this event"}`,
        sourceEntity: draft, targetEntity: instanceDraft, confidence: 0.9,
        metadata: { source: "event-evidence" },
      }, evidence.id, instanceEntity.id);
      await linkEventRelation(db, event.id, relation.id, 0.9);
    }

    await resolveEventSemantics(db, { eventId: event.id, clientId, drafts: graphDrafts, source: event.source, inferredKind: classified.inferredKind, title: event.title, body: event.body, decision: semanticDecision });

    const stored = await loadStoredEventByLookup(db, event.id, dedupeKey);
    if (!stored) {
      throw new Error("Stored event could not be loaded after ingestion");
    }

    const financialCandidate = buildFinancialTransactionCandidate({
      event: stored,
      classified,
      entityDrafts,
      merchantEntity: upsertedByType.get("merchant") ?? null,
      amountEntity: upsertedByType.get("amount") ?? null,
      observedAt: stored.timestamp ?? stored.rawEventCreatedAt,
    });

    if (financialCandidate) {
      await linkFinancialTransactionForEvent(db, financialCandidate);
    }

    invalidateGraphTraversalCache();
    return stored;
  });
}

export async function ensureStorage() {
  return;
}

export async function appendEvent(event: EventInput, context: EventIngestionContext = {}) {
  return persistClassifiedEvent(event, context.clientId ?? null);
}

export async function reprocessEvent(eventId: string, options: { ensureOntology?: boolean } = {}) {
  const rawEvent = await loadRawEventById(pool, eventId);
  if (!rawEvent) {
    return null;
  }
  const classified = await maybeEnhanceClassification({
    event: rawEvent,
    base: classifyEvent(rawEvent),
  });
  const entityDrafts = buildEntityDrafts({ ...classified, raw: classified.raw });
  const instanceDraft = semanticInstanceDraft({ eventId: rawEvent.id, inferredKind: classified.inferredKind, source: rawEvent.source, title: rawEvent.title, body: rawEvent.body });
  entityDrafts.push(instanceDraft);
  const semanticDecision = await buildModelSemanticDecision({ entities: entityDrafts, source: rawEvent.source, inferredKind: classified.inferredKind, title: rawEvent.title, body: rawEvent.body, clientId: rawEvent.clientId });
  const graphDrafts = governedGraphDrafts(semanticDecision);
  return withTransaction(async (db) => {
    await deleteDerivedDataForEvent(db, eventId);
    await insertClassifiedEvent(db, classified, rawEvent.id, rawEvent.clientId);
    if (options.ensureOntology !== false) await ensureOntology(db, rawEvent.clientId);
    const upsertedByType = new Map<string, Awaited<ReturnType<typeof upsertEntity>>>();
    for (const draft of graphDrafts) {
      if (!shouldPersistGraphEntity(draft)) continue;
      const entity = await consolidateProviderIdentity(db, draft);
      if (!upsertedByType.has(draft.type)) {
        upsertedByType.set(draft.type, entity);
      }
      await linkEventEntity(db, rawEvent.id, entity.id, 0.8);

      if (draft.type === "merchant" && isFinancialInferredKind(classified.inferredKind)) {
        await enqueueEntityReview(db, {
          entityId: entity.id,
          eventId: rawEvent.id,
          source: rawEvent.source,
          originalValue: String(draft.metadata?.evidenceValue ?? draft.value),
          suggestedAlias: draft.value,
          reason: "ai_identity_review",
        });
      }
    }

    const relationDrafts = buildRelationDrafts({
      title: rawEvent.title,
      body: rawEvent.body,
      source: rawEvent.source,
      inferredKind: classified.inferredKind,
      entities: graphDrafts,
    });

    for (const draft of relationDrafts) {
      if (!shouldPersistGraphEntity(draft.sourceEntity) || !shouldPersistGraphEntity(draft.targetEntity)) continue;
      const sourceEntity = await upsertEntity(db, draft.sourceEntity);
      const targetEntity = await upsertEntity(db, draft.targetEntity);
      const relation = await upsertRelation(db, draft, sourceEntity.id, targetEntity.id);
      await linkEventRelation(db, rawEvent.id, relation.id, draft.confidence);
    }

    const providerDraft = graphDrafts.find((draft) => draft.type === "app");
    const instanceEntity = upsertedByType.get(instanceDraft.type);
    const providerEntity = upsertedByType.get("app");
    if (providerDraft && instanceEntity && providerEntity) {
      const relation = await upsertRelation(db, {
        relationType: "produced_by_app",
        label: "Captured by app",
        description: `${instanceEntity.value} is an event from ${providerEntity.value}`,
        sourceEntity: instanceDraft,
        targetEntity: providerDraft,
        confidence: 1,
        metadata: { source: "event-hierarchy" },
      }, instanceEntity.id, providerEntity.id);
      await linkEventRelation(db, rawEvent.id, relation.id, 1);
    }

    if (instanceEntity) for (const draft of graphDrafts) {
      if (["app", "activity_instance", "financial_event", "email_message", "sender", "recipient", "merchant", "amount", "expense", "income", "notification"].includes(draft.type)) continue;
      const evidence = await upsertEntity(db, draft);
      if (evidence.id === instanceEntity?.id) continue;
      const relation = await upsertRelation(db, {
        relationType: "evidence_for", label: "Evidence for event",
        description: `${evidence.value} is evidence captured in ${instanceEntity?.value ?? "this event"}`,
        sourceEntity: draft, targetEntity: instanceDraft, confidence: 0.9,
        metadata: { source: "event-evidence" },
      }, evidence.id, instanceEntity.id);
      await linkEventRelation(db, rawEvent.id, relation.id, 0.9);
    }

    await resolveEventSemantics(db, { eventId: rawEvent.id, clientId: rawEvent.clientId, drafts: graphDrafts, source: rawEvent.source, inferredKind: classified.inferredKind, title: rawEvent.title, body: rawEvent.body, decision: semanticDecision });

    const stored = await loadStoredEventByLookup(db, rawEvent.id, rawEvent.dedupeKey);
    const financialCandidate = buildFinancialTransactionCandidate({
      event: rawEvent,
      classified,
      entityDrafts,
      merchantEntity: upsertedByType.get("merchant") ?? null,
      amountEntity: upsertedByType.get("amount") ?? null,
      observedAt: rawEvent.timestamp ?? rawEvent.rawEventCreatedAt,
    });

    if (financialCandidate) {
      await linkFinancialTransactionForEvent(db, financialCandidate);
    }

    invalidateGraphTraversalCache();
    return stored;
  });
}

export async function previewEventSemantics(eventId: string) {
  const rawEvent = await loadRawEventById(pool, eventId);
  if (!rawEvent) return null;
  const classified = await maybeEnhanceClassification({ event: rawEvent, base: classifyEvent(rawEvent) });
  const entityDrafts = buildEntityDrafts({ ...classified, raw: classified.raw });
  entityDrafts.push(semanticInstanceDraft({ eventId: rawEvent.id, inferredKind: classified.inferredKind, source: rawEvent.source, title: rawEvent.title, body: rawEvent.body }));
  return buildModelSemanticDecision({ entities: entityDrafts, source: rawEvent.source, inferredKind: classified.inferredKind, title: rawEvent.title, body: rawEvent.body, clientId: rawEvent.clientId });
}

export async function listEvents() {
  return listStoredEvents();
}

export async function getMetrics() {
  return countKnowledgeMetrics(pool);
}
