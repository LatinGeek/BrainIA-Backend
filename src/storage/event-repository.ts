import { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";
import type { ClassifiedEvent, EventInput } from "../domain/event.js";

type Queryable = Pick<typeof pool, "query">;

type StoredEntity = {
  id: string;
  type: string;
  value: string;
  normalizedValue: string;
};

type StoredRelation = {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  label: string;
  description: string;
  confidence: number;
};

export type StoredEventRecord = EventInput & {
  classificationVersion: string;
  inferredKind: ClassifiedEvent["inferredKind"];
  confidence: number;
  classifiedEntities: ClassifiedEvent["entities"];
  modelMetadata: Record<string, unknown> | null;
  clientId: string | null;
  dedupeKey: string;
  rawEventCreatedAt: string;
  classifiedEventCreatedAt: string;
  entities: StoredEntity[];
  relations: StoredRelation[];
};

export type StoredRawEvent = EventInput & {
  clientId: string | null;
  dedupeKey: string;
  rawEventCreatedAt: string;
};

export async function insertRawEvent(
  db: Queryable,
  event: EventInput,
  clientId: string | null,
  dedupeKey: string,
) {
  const result = await db.query(
    `
      insert into raw_events (
        id,
        source,
        contract_version,
        client_id,
        idempotency_key,
        dedupe_key,
        kind,
        title,
        body,
        timestamp,
        external_id,
        raw,
        tags
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::text[]
      )
      on conflict do nothing
      returning id
    `,
    [
      event.id,
      event.source,
      event.contractVersion,
      clientId,
      event.idempotencyKey ?? null,
      dedupeKey,
      event.kind,
      event.title ?? null,
      event.body ?? null,
      event.timestamp ?? null,
      event.externalId ?? null,
      JSON.stringify(event.raw ?? {}),
      event.tags ?? [],
    ],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function insertClassifiedEvent(
  db: Queryable,
  event: ClassifiedEvent,
  rawEventId: string,
  clientId: string | null,
) {
  const result = await db.query(
    `
      insert into classified_events (
        id,
        raw_event_id,
        client_id,
        contract_version,
        classification_version,
        inferred_kind,
        confidence,
        model_metadata,
        entities
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb
      )
      on conflict do nothing
      returning id
    `,
    [
      event.id,
      rawEventId,
      clientId,
      event.contractVersion,
      event.classificationVersion,
      event.inferredKind,
      event.confidence,
      JSON.stringify(event.modelMetadata ?? null),
      JSON.stringify(event.entities ?? []),
    ],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function loadRawEventById(db: Queryable, eventId: string): Promise<StoredRawEvent | null> {
  const result = await db.query<StoredRawEvent>(
    `
      select
        id,
        source,
        contract_version as "contractVersion",
        client_id as "clientId",
        idempotency_key as "idempotencyKey",
        dedupe_key as "dedupeKey",
        kind,
        title,
        body,
        timestamp,
        external_id as "externalId",
        raw,
        tags,
        created_at as "rawEventCreatedAt"
      from raw_events
      where id = $1
      limit 1
    `,
    [eventId],
  );

  return result.rows[0] ?? null;
}

export async function findStoredRawEventId(
  db: Queryable,
  eventId: string,
  dedupeKey: string,
) {
  const result = await db.query<{ id: string }>(
    `
      select id
      from raw_events
      where id = $1 or dedupe_key = $2
      order by case when id = $1 then 0 else 1 end
      limit 1
    `,
    [eventId, dedupeKey],
  );

  return result.rows[0]?.id ?? null;
}

export async function deleteDerivedDataForEvent(db: Queryable, eventId: string) {
  await db.query(
    `
      with
      candidate_entities as (
        select distinct entity_id
        from event_entities
        where event_id = $1
      ),
      candidate_relations as (
        select distinct relation_id
        from event_relations
        where event_id = $1
      ),
      deleted_event_relations as (
        delete from event_relations
        where event_id = $1
        returning relation_id
      ),
      deleted_event_entities as (
        delete from event_entities
        where event_id = $1
        returning entity_id
      ),
      deleted_review_queue as (
        delete from entity_review_queue
        where event_id = $1
        returning id
      ),
      deleted_financial_transaction_events as (
        delete from financial_transaction_events
        where raw_event_id = $1
        returning transaction_id
      ),
      deleted_financial_transactions as (
        delete from financial_transactions t
        where not exists (
          select 1
          from financial_transaction_events e
          where e.transaction_id = t.id
        )
        returning id
      ),
      deleted_relations as (
        delete from relations rel
        where rel.id in (select relation_id from candidate_relations)
          and not exists (
            select 1
            from event_relations er
            where er.relation_id = rel.id
          )
        returning id
      ),
      deleted_entities as (
        delete from entities e
        where e.id in (select entity_id from candidate_entities)
          and not exists (
            select 1
            from event_entities ee
            where ee.entity_id = e.id
          )
          and not exists (
            select 1
            from relations r
            where r.source_entity_id = e.id
               or r.target_entity_id = e.id
          )
          and not exists (
            select 1
            from entity_merges m
            where m.alias_entity_id = e.id
               or m.canonical_entity_id = e.id
          )
          and not exists (
            select 1
            from entity_aliases a
            where a.entity_id = e.id
          )
          and not exists (
            select 1
            from entity_review_queue q
            where q.entity_id = e.id
          )
          and not exists (
            select 1
            from financial_transactions ft
            where ft.merchant_entity_id = e.id
          )
        returning id
      )
      select 1
    `,
    [eventId],
  );

  await db.query("delete from classified_events where raw_event_id = $1", [eventId]);
}

export async function linkEventEntity(
  db: Queryable,
  eventId: string,
  entityId: string,
  confidence: number,
) {
  await db.query(
    `
      insert into event_entities (
        id,
        event_id,
        entity_id,
        role,
        confidence
      ) values (
        $1, $2, $3, $4, $5
      )
      on conflict (event_id, entity_id, role)
      do update set confidence = excluded.confidence
    `,
    [randomUUID(), eventId, entityId, "mentioned", confidence],
  );
}

export async function loadStoredEventById(
  db: Queryable,
  eventId: string,
): Promise<StoredEventRecord | null> {
  const result = await db.query<StoredEventRecord>(
    `
      select
        r.id,
        r.source,
        r.contract_version as "contractVersion",
        r.client_id as "clientId",
        r.idempotency_key as "idempotencyKey",
        r.dedupe_key as "dedupeKey",
        r.kind,
        r.title,
        r.body,
        r.timestamp,
        r.external_id as "externalId",
        r.raw,
        r.tags,
        c.classification_version as "classificationVersion",
        c.inferred_kind as "inferredKind",
        c.confidence,
        c.model_metadata as "modelMetadata",
        c.entities as "classifiedEntities",
        r.created_at as "rawEventCreatedAt",
        c.created_at as "classifiedEventCreatedAt",
        coalesce(
          (
            select json_agg(
              json_build_object(
                'id', e.id,
                'type', e.type,
                'value', e.value,
                'normalizedValue', e.normalized_value
              )
              order by ee.entity_id asc
            )
            from event_entities ee
            join entities e on e.id = ee.entity_id
            where ee.event_id = r.id
          ),
          '[]'::json
        ) as entities,
        coalesce(
          (
            select json_agg(
              json_build_object(
                'id', rel.id,
                'sourceEntityId', rel.source_entity_id,
                'targetEntityId', rel.target_entity_id,
                'relationType', rel.relation_type,
                'label', rel.label,
                'description', rel.description,
                'confidence', rel.confidence
              )
              order by er.relation_id asc
            )
            from event_relations er
            join relations rel on rel.id = er.relation_id
            where er.event_id = r.id
          ),
          '[]'::json
        ) as relations
      from raw_events r
      left join classified_events c on c.raw_event_id = r.id
      where r.id = $1
      limit 1
    `,
    [eventId],
  );

  return result.rows[0] ?? null;
}

export async function loadStoredEventByLookup(
  db: Queryable,
  eventId: string,
  dedupeKey: string,
): Promise<StoredEventRecord | null> {
  const result = await db.query<{ id: string }>(
    `
      select id
      from raw_events
      where id = $1 or dedupe_key = $2
      order by case when id = $1 then 0 else 1 end
      limit 1
    `,
    [eventId, dedupeKey],
  );

  const rawEventId = result.rows[0]?.id ?? null;
  if (!rawEventId) {
    return null;
  }

  return loadStoredEventById(db, rawEventId);
}

export async function listStoredEvents() {
  const result = await pool.query<StoredEventRecord>(
    `
      select
        r.id,
        r.source,
        r.contract_version as "contractVersion",
        r.client_id as "clientId",
        r.idempotency_key as "idempotencyKey",
        r.dedupe_key as "dedupeKey",
        r.kind,
        r.title,
        r.body,
        r.timestamp,
        r.external_id as "externalId",
        r.raw,
        r.tags,
        c.classification_version as "classificationVersion",
        c.inferred_kind as "inferredKind",
        c.confidence,
        c.model_metadata as "modelMetadata",
        c.entities as "classifiedEntities",
        r.created_at as "rawEventCreatedAt",
        c.created_at as "classifiedEventCreatedAt",
        coalesce(
          (
            select json_agg(
              json_build_object(
                'id', e.id,
                'type', e.type,
                'value', e.value,
                'normalizedValue', e.normalized_value
              )
              order by ee.entity_id asc
            )
            from event_entities ee
            join entities e on e.id = ee.entity_id
            where ee.event_id = r.id
          ),
          '[]'::json
        ) as entities,
        coalesce(
          (
            select json_agg(
              json_build_object(
                'id', rel.id,
                'sourceEntityId', rel.source_entity_id,
                'targetEntityId', rel.target_entity_id,
                'relationType', rel.relation_type,
                'label', rel.label,
                'description', rel.description,
                'confidence', rel.confidence
              )
              order by er.relation_id asc
            )
            from event_relations er
            join relations rel on rel.id = er.relation_id
            where er.event_id = r.id
          ),
          '[]'::json
        ) as relations
      from raw_events r
      left join classified_events c on c.raw_event_id = r.id
      order by r.created_at asc
    `,
  );

  return result.rows as StoredEventRecord[];
}

export async function countKnowledgeMetrics(db: Queryable) {
  const result = await db.query<{
    rawEventsCount: string;
    classifiedEventsCount: string;
    entitiesCount: string;
    relationsCount: string;
    eventEntitiesCount: string;
    eventRelationsCount: string;
    financialTransactionsCount: string;
    financialTransactionEventsCount: string;
  }>(
    `
      select
        (select count(*)::text from raw_events) as "rawEventsCount",
        (select count(*)::text from classified_events) as "classifiedEventsCount",
        (select count(*)::text from entities) as "entitiesCount",
        (select count(*)::text from relations) as "relationsCount",
        (select count(*)::text from event_entities) as "eventEntitiesCount",
        (select count(*)::text from event_relations) as "eventRelationsCount",
        (select count(*)::text from financial_transactions) as "financialTransactionsCount",
        (select count(*)::text from financial_transaction_events) as "financialTransactionEventsCount"
    `,
  );

  return result.rows[0];
}
