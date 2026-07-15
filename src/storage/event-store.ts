import { classifyEvent } from "../domain/classification.js";
import type { EventInput } from "../domain/event.js";
import { buildEntityDrafts } from "../domain/entities.js";
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

async function persistClassifiedEvent(
  event: EventInput,
  clientId: string | null,
) {
  const classified = await maybeEnhanceClassification({
    event,
    base: classifyEvent(event),
  });
  const dedupeKey = buildEventDedupeKey(event, clientId);

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

    const entityDrafts = buildEntityDrafts({
      ...classified,
      raw: classified.raw,
    });
    const upsertedByType = new Map<string, Awaited<ReturnType<typeof upsertEntity>>>();
    for (const draft of entityDrafts) {
      const entity = await upsertEntity(db, draft);
      if (!upsertedByType.has(draft.type)) {
        upsertedByType.set(draft.type, entity);
      }
      await linkEventEntity(db, event.id, entity.id, 0.8);

      if (draft.type === "merchant" && isFinancialInferredKind(classified.inferredKind)) {
        await enqueueEntityReview(db, {
          entityId: entity.id,
          eventId: event.id,
          source: event.source,
          originalValue: draft.value,
          suggestedAlias: draft.value,
          reason: String(draft.metadata?.source ?? "merchant_candidate"),
        });
      }
    }

    const relationDrafts = buildRelationDrafts({
      title: event.title,
      body: event.body,
      source: event.source,
      inferredKind: classified.inferredKind,
      entities: entityDrafts,
    });

    for (const draft of relationDrafts) {
      const sourceEntity = await upsertEntity(db, draft.sourceEntity);
      const targetEntity = await upsertEntity(db, draft.targetEntity);
      const relation = await upsertRelation(db, draft, sourceEntity.id, targetEntity.id);
      await linkEventRelation(db, event.id, relation.id, draft.confidence);
    }

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

export async function reprocessEvent(eventId: string) {
  return withTransaction(async (db) => {
    const rawEvent = await loadRawEventById(db, eventId);
    if (!rawEvent) {
      return null;
    }

    await deleteDerivedDataForEvent(db, eventId);

    const classified = await maybeEnhanceClassification({
      event: rawEvent,
      base: classifyEvent(rawEvent),
    });
    await insertClassifiedEvent(db, classified, rawEvent.id, rawEvent.clientId);

    const entityDrafts = buildEntityDrafts({
      ...classified,
      raw: classified.raw,
    });
    const upsertedByType = new Map<string, Awaited<ReturnType<typeof upsertEntity>>>();
    for (const draft of entityDrafts) {
      const entity = await upsertEntity(db, draft);
      if (!upsertedByType.has(draft.type)) {
        upsertedByType.set(draft.type, entity);
      }
      await linkEventEntity(db, rawEvent.id, entity.id, 0.8);

      if (draft.type === "merchant" && isFinancialInferredKind(classified.inferredKind)) {
        await enqueueEntityReview(db, {
          entityId: entity.id,
          eventId: rawEvent.id,
          source: rawEvent.source,
          originalValue: draft.value,
          suggestedAlias: draft.value,
          reason: String(draft.metadata?.source ?? "merchant_candidate"),
        });
      }
    }

    const relationDrafts = buildRelationDrafts({
      title: rawEvent.title,
      body: rawEvent.body,
      source: rawEvent.source,
      inferredKind: classified.inferredKind,
      entities: entityDrafts,
    });

    for (const draft of relationDrafts) {
      const sourceEntity = await upsertEntity(db, draft.sourceEntity);
      const targetEntity = await upsertEntity(db, draft.targetEntity);
      const relation = await upsertRelation(db, draft, sourceEntity.id, targetEntity.id);
      await linkEventRelation(db, rawEvent.id, relation.id, draft.confidence);
    }

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

export async function listEvents() {
  return listStoredEvents();
}

export async function getMetrics() {
  return countKnowledgeMetrics(pool);
}
