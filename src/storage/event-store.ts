import { classifyEvent } from "../domain/classification.js";
import type { EventInput } from "../domain/event.js";
import { buildEntityDrafts } from "../domain/entities.js";
import { buildRelationDrafts } from "../domain/relations.js";
import { pool, withTransaction } from "./postgres.js";
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
import { linkEventRelation, upsertRelation } from "./relation-repository.js";

export type EventIngestionContext = {
  clientId?: string | null;
};

export function buildEventDedupeKey(event: EventInput, clientId: string | null | undefined) {
  const stableInput = event.idempotencyKey?.trim() || event.externalId?.trim() || event.id.trim();
  const clientScope = clientId?.trim() || "anonymous";
  return `${clientScope}:${event.source}:${event.contractVersion}:${stableInput}`;
}

async function persistClassifiedEvent(
  event: EventInput,
  clientId: string | null,
  classified = classifyEvent(event),
) {
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

    const entityDrafts = buildEntityDrafts(classified);
    for (const draft of entityDrafts) {
      const entity = await upsertEntity(db, draft);
      await linkEventEntity(db, event.id, entity.id, 0.8);
    }

    const relationDrafts = buildRelationDrafts({
      title: event.title,
      body: event.body,
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

    const classified = classifyEvent(rawEvent);
    await insertClassifiedEvent(db, classified, rawEvent.id, rawEvent.clientId);

    const entityDrafts = buildEntityDrafts(classified);
    for (const draft of entityDrafts) {
      const entity = await upsertEntity(db, draft);
      await linkEventEntity(db, rawEvent.id, entity.id, 0.8);
    }

    const relationDrafts = buildRelationDrafts({
      title: rawEvent.title,
      body: rawEvent.body,
      inferredKind: classified.inferredKind,
      entities: entityDrafts,
    });

    for (const draft of relationDrafts) {
      const sourceEntity = await upsertEntity(db, draft.sourceEntity);
      const targetEntity = await upsertEntity(db, draft.targetEntity);
      const relation = await upsertRelation(db, draft, sourceEntity.id, targetEntity.id);
      await linkEventRelation(db, rawEvent.id, relation.id, draft.confidence);
    }

    return loadStoredEventByLookup(db, rawEvent.id, rawEvent.dedupeKey);
  });
}

export async function listEvents() {
  return listStoredEvents();
}

export async function getMetrics() {
  return countKnowledgeMetrics(pool);
}
