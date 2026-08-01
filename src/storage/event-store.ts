import { classifyEvent } from "../domain/classification.js";
import type { EventInput } from "../domain/event.js";
import { buildEntityDrafts, type EntityDraft } from "../domain/entities.js";
import { buildRelationDrafts } from "../domain/relations.js";
import { pool, withSemanticMaterializationLock, withTransaction } from "./postgres.js";
import { maybeEnhanceClassification } from "./classification-assistant.js";
import { invalidateGraphTraversalCache } from "./graph-cache.js";
import { enqueueEntityReview } from "./entity-alias-repository.js";
import { buildFinancialTransactionCandidate } from "../domain/financial-transactions.js";
import {
  countKnowledgeMetrics,
  deleteDerivedDataForEvent,
  insertClassifiedEvent,
  insertRawEvent,
  findStoredRawEventId,
  linkEventEntity,
  loadRawEventById,
  loadStoredEventByLookup,
  loadStoredEventById,
  listStoredEvents,
  updateClassifiedEventInterpretation,
  transitionEventProcessingStatus,
} from "./event-repository.js";
import { findCanonicalMerchantByValue, upsertEntity } from "./entity-repository.js";
import { linkFinancialTransactionForEvent } from "./financial-transaction-repository.js";
import { linkEventRelation, upsertRelation } from "./relation-repository.js";
import { semanticInstanceDraft } from "../domain/ontology.js";
import { consolidateProviderIdentity, ensureOntology } from "./semantic-repository.js";
import { resolveEventSemantics } from "./semantic-resolver.js";
import { buildModelSemanticDecision } from "./semantic-enrichment.js";
import type { SemanticDecision } from "./semantic-enrichment.js";
import { buildEventInterpretation } from "../domain/event-interpretation.js";
import { deriveKnowledgeFacts, replaceEventKnowledgeFacts } from "./knowledge-fact-repository.js";
import { enqueueBackgroundJob, settleInlineBackgroundJob } from "./job-repository.js";
import { loadSourceProcessingPolicy } from "./privacy.js";
import { config } from "../config.js";

export type EventIngestionContext = {
  clientId?: string | null;
};

export function buildEventDedupeKey(event: EventInput, clientId: string | null | undefined) {
  const stableInput = event.idempotencyKey?.trim() || event.externalId?.trim() || event.id.trim();
  const clientScope = clientId?.trim() || "anonymous";
  return `${clientScope}:${event.source}:${event.contractVersion}:${stableInput}`;
}

function isFinancialInferredKind(kind: string) {
  return kind === "expense" || kind === "income" || kind === "transfer";
}

function shouldPersistGraphEntity(draft: EntityDraft) {
  // Classifiers may extract dozens of payload fields (URL, timestamp, action,
  // device property, etc.). Those belong to the raw event, not to the durable
  // knowledge graph. New durable concepts can only enter through a reviewed
  // semantic proposal, never through an extractor field.
  return ["app", "merchant", "sender", "recipient", "email_message", "financial_event", "activity_instance"].includes(draft.type);
}

function governedGraphDrafts(decision: SemanticDecision) {
  // Review and unavailable decisions remain evidence/proposals only. Persisting
  // their suggested AI identities here would create visible, unrooted graph
  // nodes before semantic governance has accepted a hierarchy path.
  if (decision.status !== "resolved") return [];
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

function classifiedEventIdentity(classified: { modelMetadata?: Record<string, unknown> | null }) {
  const response = classified.modelMetadata?.response;
  if (!response || typeof response !== "object" || Array.isArray(response)) return null;
  const record = response as Record<string, unknown>;
  return {
    displayTitle: typeof record.displayTitle === "string" ? record.displayTitle : undefined,
    displayDescription: typeof record.displayDescription === "string" ? record.displayDescription : undefined,
  };
}

async function persistClassifiedEvent(
  event: EventInput,
  clientId: string | null,
) {
  const classified = await maybeEnhanceClassification({
    event,
    base: classifyEvent(event),
    clientId,
  });
  const dedupeKey = buildEventDedupeKey(event, clientId);
  const entityDrafts = buildEntityDrafts({ ...classified, raw: classified.raw });
  const instanceDraft = semanticInstanceDraft({ eventId: event.id, inferredKind: classified.inferredKind, source: event.source, title: event.title, body: event.body, identity: classifiedEventIdentity(classified) });
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
    await replaceEventKnowledgeFacts(db, {
      eventId: event.id,
      clientId,
      facts: deriveKnowledgeFacts({ event, classified, entities: entityDrafts }),
    });
    await transitionEventProcessingStatus(db, { eventId: event.id, toStatus: "classified", reason: "classification_projection_persisted" });

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

    if (isFinancialInferredKind(classified.inferredKind) && !upsertedByType.has("merchant")) {
      const merchantEvidence = entityDrafts.find((draft) => draft.type === "merchant");
      if (merchantEvidence) {
        const entity = await upsertEntity(db, merchantEvidence);
        await linkEventEntity(db, event.id, entity.id, classified.confidence);
        await enqueueEntityReview(db, {
          entityId: entity.id, eventId: event.id, source: event.source,
          originalValue: merchantEvidence.value, suggestedAlias: merchantEvidence.value,
          reason: "merchant_candidate",
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

    const financialCandidate = buildFinancialTransactionCandidate({
      event,
      classified,
      entityDrafts,
      merchantEntity: upsertedByType.get("merchant") ?? null,
      amountEntity: upsertedByType.get("amount") ?? null,
      observedAt: event.timestamp ?? new Date().toISOString(),
    });

    if (financialCandidate) {
      if (!financialCandidate.merchantEntityId && financialCandidate.kind !== "transfer") {
        const merchant = await findCanonicalMerchantByValue(db, financialCandidate.merchantLabel);
        if (merchant) {
          financialCandidate.merchantEntityId = merchant.id;
          financialCandidate.matchStrategy = "merchant_identity_lookup";
          await linkEventEntity(db, event.id, merchant.id, 0.9);
        }
      }
      await linkFinancialTransactionForEvent(db, financialCandidate);
    }

    await updateClassifiedEventInterpretation(db, event.id, buildEventInterpretation({
      event,
      classified,
      decision: semanticDecision,
      eventIdentity: instanceDraft,
      financialCandidate,
    }));

    const finalStatus = semanticDecision.status === "resolved" ? "semantically_resolved"
      : semanticDecision.status === "review" ? "review"
        : semanticDecision.status === "discarded" ? "discarded" : "retryable";
    await transitionEventProcessingStatus(db, {
      eventId: event.id,
      toStatus: finalStatus,
      reason: `semantic_decision:${semanticDecision.status}`,
    });

    const stored = await loadStoredEventByLookup(db, event.id, dedupeKey);
    if (!stored) throw new Error("Stored event could not be loaded after ingestion");

    invalidateGraphTraversalCache();
    return stored;
  });
}

export async function ensureStorage() {
  return;
}

export async function appendEvent(event: EventInput, context: EventIngestionContext = {}) {
  const clientId = context.clientId ?? null;
  const dedupeKey = buildEventDedupeKey(event, clientId);
  const policy = await loadSourceProcessingPolicy(pool, { clientId, source: event.source });
  const capture = await withTransaction(async (db) => {
    const inserted = await insertRawEvent(db, event, clientId, dedupeKey);
    const storedId = inserted ? event.id : await findStoredRawEventId(db, event.id, dedupeKey);
    if (!storedId) throw new Error("Captured event could not be resolved");
    if (inserted) {
      if (!policy.enabled) {
        await db.query(`update raw_events set processing_allowed = false where id = $1`, [storedId]);
        await transitionEventProcessingStatus(db, { eventId: storedId, toStatus: "discarded", reason: "source_processing_policy_disabled" });
      } else {
        await transitionEventProcessingStatus(db, { eventId: storedId, toStatus: "captured", reason: "immutable_evidence_captured" });
        await enqueueBackgroundJob(db, {
          clientId, eventId: storedId, jobType: "classification",
          idempotencyKey: `classification:${storedId}:v1`,
          payload: { eventId: storedId }, provider: "deepseek",
        });
      }
    }
    return { inserted, storedId };
  });

  if (!capture.inserted || !policy.enabled || config.processingMode === "queued") {
    const stored = await loadStoredEventByLookup(pool, capture.storedId, dedupeKey);
    if (!stored) throw new Error("Captured event could not be loaded");
    return stored;
  }

  try {
    const stored = await reprocessEvent(capture.storedId);
    await settleInlineBackgroundJob({ jobType: "classification", idempotencyKey: `classification:${capture.storedId}:v1` });
    if (!stored) throw new Error("Captured event disappeared before processing");
    await enqueueBackgroundJob(pool, {
      clientId, eventId: capture.storedId, jobType: "embedding",
      idempotencyKey: `embedding:${capture.storedId}:${process.env.EMBEDDING_VERSION ?? "embedding-v1"}`,
      payload: { eventId: capture.storedId },
    });
    return stored;
  } catch (error) {
    await withTransaction((db) => transitionEventProcessingStatus(db, {
      eventId: capture.storedId, toStatus: "retryable",
      reason: error instanceof Error ? error.message.slice(0, 500) : "processing_failed",
    }));
    await settleInlineBackgroundJob({ jobType: "classification", idempotencyKey: `classification:${capture.storedId}:v1`, error });
    const stored = await loadStoredEventByLookup(pool, capture.storedId, dedupeKey);
    if (!stored) throw error;
    return stored;
  }
}

export async function classifyCapturedEvent(eventId: string) {
  const rawEvent = await loadRawEventById(pool, eventId);
  if (!rawEvent || !rawEvent.processingAllowed || rawEvent.privacyStatus === "hidden") return null;
  const classified = await maybeEnhanceClassification({
    event: rawEvent,
    base: classifyEvent(rawEvent),
    clientId: rawEvent.clientId,
    allowModel: rawEvent.privacyStatus === "standard",
  });
  const entityDrafts = buildEntityDrafts({ ...classified, raw: classified.raw });
  return withTransaction(async (db) => {
    await deleteDerivedDataForEvent(db, eventId);
    await insertClassifiedEvent(db, classified, rawEvent.id, rawEvent.clientId);
    await replaceEventKnowledgeFacts(db, {
      eventId: rawEvent.id, clientId: rawEvent.clientId,
      facts: deriveKnowledgeFacts({ event: rawEvent, classified, entities: entityDrafts }),
    });
    await transitionEventProcessingStatus(db, { eventId, toStatus: "classified", reason: "classification_job_completed" });
    return loadStoredEventById(db, eventId);
  });
}

export async function reprocessEvent(eventId: string, options: { ensureOntology?: boolean; reuseClassification?: boolean; skipFinancial?: boolean } = {}) {
  return withSemanticMaterializationLock(() => reprocessEventUnlocked(eventId, options));
}

async function reprocessEventUnlocked(eventId: string, options: { ensureOntology?: boolean; reuseClassification?: boolean; skipFinancial?: boolean } = {}) {
  const rawEvent = await loadRawEventById(pool, eventId);
  if (!rawEvent) {
    return null;
  }
  const existing = options.reuseClassification ? await loadStoredEventById(pool, eventId) : null;
  const classified = existing?.classificationVersion ? {
    ...rawEvent,
    classificationVersion: existing.classificationVersion,
    inferredKind: existing.inferredKind,
    confidence: existing.confidence,
    entities: existing.classifiedEntities,
    modelMetadata: existing.modelMetadata,
  } : await maybeEnhanceClassification({
      event: rawEvent,
      base: classifyEvent(rawEvent),
      clientId: rawEvent.clientId,
      allowModel: rawEvent.privacyStatus === "standard",
    });
  const entityDrafts = buildEntityDrafts({ ...classified, raw: classified.raw });
  const instanceDraft = semanticInstanceDraft({ eventId: rawEvent.id, inferredKind: classified.inferredKind, source: rawEvent.source, title: rawEvent.title, body: rawEvent.body, identity: classifiedEventIdentity(classified) });
  entityDrafts.push(instanceDraft);
  const semanticDecision = await buildModelSemanticDecision({ entities: entityDrafts, source: rawEvent.source, inferredKind: classified.inferredKind, title: rawEvent.title, body: rawEvent.body, clientId: rawEvent.clientId, allowModel: rawEvent.privacyStatus === "standard" });
  const graphDrafts = governedGraphDrafts(semanticDecision);
  return withTransaction(async (db) => {
    await deleteDerivedDataForEvent(db, eventId);
    await insertClassifiedEvent(db, classified, rawEvent.id, rawEvent.clientId);
    await replaceEventKnowledgeFacts(db, {
      eventId: rawEvent.id,
      clientId: rawEvent.clientId,
      facts: deriveKnowledgeFacts({ event: rawEvent, classified, entities: entityDrafts }),
    });
    await transitionEventProcessingStatus(db, { eventId: rawEvent.id, toStatus: "classified", reason: "classification_projection_persisted" });
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


    if (isFinancialInferredKind(classified.inferredKind) && !upsertedByType.has("merchant")) {
      const merchantEvidence = entityDrafts.find((draft) => draft.type === "merchant");
      if (merchantEvidence) {
        const entity = await upsertEntity(db, merchantEvidence);
        await linkEventEntity(db, rawEvent.id, entity.id, classified.confidence);
        await enqueueEntityReview(db, {
          entityId: entity.id, eventId: rawEvent.id, source: rawEvent.source,
          originalValue: merchantEvidence.value, suggestedAlias: merchantEvidence.value,
          reason: "merchant_candidate",
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

    const financialCandidate = buildFinancialTransactionCandidate({
      event: rawEvent,
      classified,
      entityDrafts,
      merchantEntity: upsertedByType.get("merchant") ?? null,
      amountEntity: upsertedByType.get("amount") ?? null,
      observedAt: rawEvent.timestamp ?? rawEvent.rawEventCreatedAt,
    });

    if (financialCandidate && !options.skipFinancial) {
      await linkFinancialTransactionForEvent(db, financialCandidate);
    }

    await updateClassifiedEventInterpretation(db, rawEvent.id, buildEventInterpretation({
      event: rawEvent,
      classified,
      decision: semanticDecision,
      eventIdentity: instanceDraft,
      financialCandidate,
    }));

    const finalStatus = semanticDecision.status === "resolved" ? "semantically_resolved"
      : semanticDecision.status === "review" ? "review"
        : semanticDecision.status === "discarded" ? "discarded" : "retryable";
    await transitionEventProcessingStatus(db, {
      eventId: rawEvent.id,
      toStatus: finalStatus,
      reason: `semantic_decision:${semanticDecision.status}`,
    });

    const stored = await loadStoredEventByLookup(db, rawEvent.id, rawEvent.dedupeKey);

    invalidateGraphTraversalCache();
    return stored;
  });
}

export async function correlateFinancialEvent(eventId: string) {
  const stored = await loadStoredEventById(pool, eventId);
  if (!stored?.classificationVersion || !stored.inferredKind) return null;
  const classified = {
    ...stored,
    classificationVersion: stored.classificationVersion,
    inferredKind: stored.inferredKind,
    confidence: stored.confidence,
    entities: stored.classifiedEntities,
    modelMetadata: stored.modelMetadata,
  };
  const entityDrafts = buildEntityDrafts({ ...classified, raw: stored.raw });
  const candidate = buildFinancialTransactionCandidate({
    event: stored,
    classified,
    entityDrafts,
    merchantEntity: null,
    amountEntity: null,
    observedAt: stored.timestamp ?? stored.rawEventCreatedAt,
  });
  if (!candidate) return { eventId, correlated: false };
  return withTransaction(async (db) => {
    if (!candidate.merchantEntityId && candidate.kind !== "transfer") {
      const merchantDraft = entityDrafts.find((draft) => draft.type === "merchant");
      const merchant = merchantDraft ? await findCanonicalMerchantByValue(db, merchantDraft.value) : null;
      if (merchant) {
        candidate.merchantEntityId = merchant.id;
        candidate.matchStrategy = "merchant_identity_lookup";
        await linkEventEntity(db, eventId, merchant.id, 0.9);
      }
    }
    const transaction = await linkFinancialTransactionForEvent(db, candidate);
    return { eventId, correlated: true, transaction };
  });
}

export async function previewEventSemantics(eventId: string) {
  const rawEvent = await loadRawEventById(pool, eventId);
  if (!rawEvent) return null;
  const classified = await maybeEnhanceClassification({ event: rawEvent, base: classifyEvent(rawEvent), clientId: rawEvent.clientId, allowModel: rawEvent.privacyStatus === "standard" });
  const entityDrafts = buildEntityDrafts({ ...classified, raw: classified.raw });
  entityDrafts.push(semanticInstanceDraft({ eventId: rawEvent.id, inferredKind: classified.inferredKind, source: rawEvent.source, title: rawEvent.title, body: rawEvent.body, identity: classifiedEventIdentity(classified) }));
  return buildModelSemanticDecision({ entities: entityDrafts, source: rawEvent.source, inferredKind: classified.inferredKind, title: rawEvent.title, body: rawEvent.body, clientId: rawEvent.clientId, allowModel: rawEvent.privacyStatus === "standard" });
}

export async function listEvents() {
  return listStoredEvents();
}

export async function getMetrics() {
  return countKnowledgeMetrics(pool);
}
