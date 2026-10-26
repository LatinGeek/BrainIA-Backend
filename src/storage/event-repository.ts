import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "./postgres.js";
import { captureContent, EventCaptureConflictError } from "../domain/event-ingestion.js";
import type { ClassifiedEvent, EventInput } from "../domain/event.js";
import {
  decodeEventHistoryCursor,
  encodeEventHistoryCursor,
  type EventHistoryFilters,
} from "../domain/event-history.js";

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
  processingStatus: "captured" | "classified" | "semantically_resolved" | "review" | "retryable" | "discarded";
  processingStatusReason: string | null;
  processingStatusUpdatedAt: string;
  privacyStatus: "standard" | "private" | "hidden";
  processingAllowed: boolean;
  displayTitle: string | null;
  displayDescription: string | null;
  interpretationStatus: string;
  interpretationSource: string | null;
  interpretationConfidence: number | null;
  interpretationModel: string | null;
  interpretationPromptVersion: string | null;
  interpretationFailureReason: string | null;
  taxonomyVersion: string | null;
  primaryCategoryKey: string | null;
  secondaryCategoryKeys: string[];
  facets: Array<{ type: string; value: string; normalizedValue: string; confidence: number; source: string }>;
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

export async function updateClassifiedEventInterpretation(
  db: Queryable,
  rawEventId: string,
  interpretation: {
    displayTitle: string | null;
    displayDescription: string | null;
    status: string;
    source: string;
    confidence: number | null;
    model: string;
    promptVersion: string;
    failureReason: string | null;
  },
) {
  await db.query(`
    update classified_events set
      display_title = $2,
      display_description = $3,
      interpretation_status = $4,
      interpretation_source = $5,
      interpretation_confidence = $6,
      interpretation_model = $7,
      interpretation_prompt_version = $8,
      interpretation_failure_reason = $9
    where raw_event_id = $1
  `, [rawEventId, interpretation.displayTitle, interpretation.displayDescription, interpretation.status,
    interpretation.source, interpretation.confidence, interpretation.model,
    interpretation.promptVersion, interpretation.failureReason]);
}

export type StoredRawEvent = EventInput & {
  clientId: string | null;
  dedupeKey: string;
  rawEventCreatedAt: string;
  processingStatus: StoredEventRecord["processingStatus"];
  processingStatusReason: string | null;
  processingStatusUpdatedAt: string;
  privacyStatus: StoredEventRecord["privacyStatus"];
  processingAllowed: boolean;
};

export async function transitionEventProcessingStatus(
  db: Queryable,
  input: {
    eventId: string;
    toStatus: StoredEventRecord["processingStatus"];
    reason?: string | null;
    jobId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const previous = await db.query<{ processingStatus: string }>(`
    select processing_status as "processingStatus" from raw_events where id = $1 for update
  `, [input.eventId]);
  if (!previous.rows[0]) return false;
  await db.query(`
    update raw_events set processing_status = $2, processing_status_reason = $3,
      processing_status_updated_at = now() where id = $1
  `, [input.eventId, input.toStatus, input.reason ?? null]);
  await db.query(`
    insert into event_processing_history (
      id, event_id, from_status, to_status, reason, job_id, metadata
    ) values ($1,$2,$3,$4,$5,$6,$7::jsonb)
  `, [randomUUID(), input.eventId, previous.rows[0].processingStatus, input.toStatus,
    input.reason ?? null, input.jobId ?? null, JSON.stringify(input.metadata ?? {})]);
  return true;
}

/** Must share the insert transaction: every identity is checked, not only the preferred key. */
export async function resolveRawEventCapture(db: Queryable, event: EventInput, clientId: string | null) {
  const result = await db.query<{ id: string }>(`
    select id from raw_events
    where id = $1 or (client_id is not distinct from $2 and source = $3 and (
      ($4::text is not null and external_id = $4) or
      ($5::text is not null and idempotency_key = $5)
    ))
  `, [event.id, clientId, event.source, event.externalId ?? null, event.idempotencyKey ?? null]);
  if (!result.rows.length) return null;
  // Multiple matching rows are ambiguous even if their content happens to agree.
  if (result.rows.length !== 1) throw new EventCaptureConflictError();
  const stored = await loadRawEventById(db, result.rows[0]!.id);
  if (!stored || stored.clientId !== clientId || stored.source !== event.source ||
      captureContent(stored) !== captureContent(event)) throw new EventCaptureConflictError();
  return stored.id;
}

export async function insertRawEvent(
  db: Queryable,
  event: EventInput,
  clientId: string | null,
  dedupeKey: string,
): Promise<boolean> {
  if (db === pool) return withTransaction(tx => insertRawEvent(tx, event, clientId, dedupeKey));
  // Sorted transaction locks serialize any overlap, including different preferred
  // keys sharing an external ID. Global IDs also lock across owners and sources.
  const identities = [JSON.stringify(["id", event.id])];
  if (event.externalId != null) identities.push(JSON.stringify(["external", clientId, event.source, event.externalId]));
  if (event.idempotencyKey != null) identities.push(JSON.stringify(["idempotency", clientId, event.source, event.idempotencyKey]));
  for (const identity of identities.sort()) {
    await db.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [identity]);
  }
  if (await resolveRawEventCapture(db, event, clientId)) return false;
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

  if (!(result.rowCount ?? 0)) {
    // Includes legacy dedupe-key collisions. Never resolve an arbitrary row or
    // expose its identity when no scoped, content-equal match was found.
    throw new EventCaptureConflictError();
  }
  return true;
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
      on conflict (id) do update set
        classification_version=excluded.classification_version,
        inferred_kind=excluded.inferred_kind, confidence=excluded.confidence,
        entities=excluded.entities, model_metadata=excluded.model_metadata
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
        processing_status as "processingStatus",
        processing_status_reason as "processingStatusReason",
        processing_status_updated_at as "processingStatusUpdatedAt",
        privacy_status as "privacyStatus",
        processing_allowed as "processingAllowed",
        created_at as "rawEventCreatedAt"
      from raw_events
      where id = $1
      limit 1
    `,
    [eventId],
  );

  return result.rows[0] ?? null;
}

// Explicit user-requested knowledge deletion only (data-controls). Projection
// rebuilds use replaceSemanticProjection and never call this destructive path.
export async function deleteDerivedDataForEvent(db: Queryable, eventId: string) {
  for (const table of ['event_semantic_anchors','semantic_observations','semantic_candidates',
    'semantic_event_decisions','knowledge_facts','event_relations','event_entities','entity_review_queue']) {
    await db.query(`delete from ${table} where event_id=$1`, [eventId]);
  }
  await db.query('delete from classified_events where raw_event_id=$1', [eventId]);
}

// Only replace machine-owned rows in the requested semantic generation/domains.
// Canonical entities, classifications, finance and resolved user reviews have
// independent lifecycles and must never be garbage-collected by this stage.
export async function replaceSemanticProjection(
  db: Queryable,
  scope: { eventId: string; clientId: string | null; generation: string; domains: string[] },
) {
  const values = [scope.eventId, scope.clientId, scope.generation, scope.domains];
  await db.query(`
    delete from semantic_candidates c where c.event_id=$1
      and c.client_id is not distinct from $2 and c.governance_version=$3
      and c.domain_value=any($4::text[]) and c.status='pending'
      and exists(select 1 from raw_events e where e.id=$1 and e.client_id is not distinct from $2)
  `, values);
  // Parent ancestry identifies the observation domain without relying on a
  // shared subject (one subject can occur in several domains).
  await db.query(`
    with recursive domain_nodes(id) as (
      select id from entities where type='domain' and value=any($4::text[])
      union
      select r.source_entity_id from relations r join domain_nodes d on d.id=r.target_entity_id
      where r.relation_type in ('part_of','belongs_to_domain')
    )
    delete from semantic_observations o where o.event_id=$1
      and o.client_id is not distinct from $2 and o.governance_version=$3
      and o.parent_entity_id in(select id from domain_nodes)
      and exists(select 1 from raw_events e where e.id=$1 and e.client_id is not distinct from $2)
  `, values);
  await db.query(`
    delete from event_semantic_anchors a using raw_events e, entities d
    where a.event_id=$1 and e.id=a.event_id and e.client_id is not distinct from $2
      and a.governance_version=$3 and d.id=a.domain_entity_id and d.value=any($4::text[])
  `, values);
}

// Fact types and extractor generation form the classification projection's
// namespace. Other extractors and user-authored facts survive a rebuild.
export async function replaceClassificationFacts(
  db: Queryable,
  input: { eventId: string; clientId: string | null; facts: import('../domain/knowledge-fact.js').KnowledgeFact[] },
) {
  for (const generation of new Set(input.facts.map(f => f.extractorVersion))) {
    const types = ['event_classification', ...['amount','merchant','sender','recipient','app','card_last_four'].map(type => `entity_${type}`)];
    await db.query(`delete from knowledge_facts where event_id=$1 and client_id is not distinct from $2
      and extractor_version=$3 and fact_type=any($4::text[])`,
    [input.eventId, input.clientId, generation, types]);
  }
  for (const f of input.facts) await db.query(`
    insert into knowledge_facts(id,client_id,event_id,fact_type,value,normalized_value,confidence,evidence,
      model,model_version,prompt_version,extractor_version,visibility)
    values($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)
    on conflict(event_id,fact_type,normalized_value,extractor_version) do nothing
  `, [randomUUID(),input.clientId,input.eventId,f.factType,JSON.stringify(f.value),f.normalizedValue,
    f.confidence,JSON.stringify(f.evidence),f.model,f.modelVersion,f.promptVersion,f.extractorVersion,f.visibility]);
}

// Evidence is an observation, not a processing attempt or model revision.
export async function countEventEvidence(db: Queryable, eventId: string) {
  const { rows } = await db.query<{ evidenceCount: number; revisionCount: number }>(`
    select (select count(distinct e.raw_event_id)::int from financial_transaction_events e
      join financial_transactions t on t.id=e.transaction_id
      where coalesce(t.merged_into_transaction_id,t.id) in (
        select coalesce(t2.merged_into_transaction_id,t2.id) from financial_transaction_events e2
        join financial_transactions t2 on t2.id=e2.transaction_id where e2.raw_event_id=$1
      )) as "evidenceCount",
      (select count(distinct id)::int from classification_decisions where event_id=$1) as "revisionCount"
  `, [eventId]);
  return rows[0];
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
  clientId?: string | null,
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
        r.processing_status as "processingStatus",
        r.processing_status_reason as "processingStatusReason",
        r.processing_status_updated_at as "processingStatusUpdatedAt",
        r.privacy_status as "privacyStatus",
        r.processing_allowed as "processingAllowed",
        c.classification_version as "classificationVersion",
        c.inferred_kind as "inferredKind",
        c.confidence::float8 as confidence,
        c.model_metadata as "modelMetadata",
        c.display_title as "displayTitle",
        c.display_description as "displayDescription",
        c.interpretation_status as "interpretationStatus",
        c.interpretation_source as "interpretationSource",
        c.interpretation_confidence::float8 as "interpretationConfidence",
        c.interpretation_model as "interpretationModel",
        c.interpretation_prompt_version as "interpretationPromptVersion",
        c.interpretation_failure_reason as "interpretationFailureReason",
        semantic.taxonomy_version as "taxonomyVersion",
        semantic.primary_category_key as "primaryCategoryKey",
        coalesce(semantic.secondary_category_keys, '{}') as "secondaryCategoryKeys",
        coalesce(semantic.facets, '[]'::jsonb) as facets,
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
      left join semantic_event_decisions semantic on semantic.event_id = r.id
      where r.id = $1 and (not $3::boolean or r.client_id is not distinct from $2)
      limit 1
    `,
    [eventId, clientId ?? null, clientId !== undefined],
  );

  return result.rows[0] ?? null;
}

export async function listStoredEvents(clientId?: string, db: Queryable = pool) {
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
        r.processing_status as "processingStatus",
        r.processing_status_reason as "processingStatusReason",
        r.processing_status_updated_at as "processingStatusUpdatedAt",
        r.privacy_status as "privacyStatus",
        r.processing_allowed as "processingAllowed",
        c.classification_version as "classificationVersion",
        c.inferred_kind as "inferredKind",
        c.confidence::float8 as confidence,
        c.model_metadata as "modelMetadata",
        c.display_title as "displayTitle",
        c.display_description as "displayDescription",
        c.interpretation_status as "interpretationStatus",
        c.interpretation_source as "interpretationSource",
        c.interpretation_confidence::float8 as "interpretationConfidence",
        c.interpretation_model as "interpretationModel",
        c.interpretation_prompt_version as "interpretationPromptVersion",
        c.interpretation_failure_reason as "interpretationFailureReason",
        semantic.taxonomy_version as "taxonomyVersion",
        semantic.primary_category_key as "primaryCategoryKey",
        coalesce(semantic.secondary_category_keys, '{}') as "secondaryCategoryKeys",
        coalesce(semantic.facets, '[]'::jsonb) as facets,
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
      left join semantic_event_decisions semantic on semantic.event_id = r.id
      where ($1::text is null or r.client_id = $1)
      order by r.created_at asc
    `,
    [clientId ?? null],
  );

  return result.rows as StoredEventRecord[];
}

export type EventHistoryItem = {
  id: string;
  source: string;
  kind: string;
  inferredKind: string | null;
  title: string;
  displayTitle: string | null;
  /** First 200 characters of the body; the full body is only on GET /events/:id. */
  bodyPreview: string | null;
  occurredAt: string;
  ingestedAt: string;
  processingStatus: StoredEventRecord["processingStatus"];
  primaryCategoryKey: string | null;
  interpretationStatus: string | null;
  privacyStatus: StoredEventRecord["privacyStatus"];
};

export type EventHistoryPage = {
  items: EventHistoryItem[];
  hasMore: boolean;
  nextCursor: string | null;
};

// Summary-only keyset page over raw_events. Deliberately skips raw payloads,
// bodies, entities and relations; clients fetch those with GET /events/:id.
export async function listEventHistoryPage(
  db: Queryable,
  options: { ownerId?: string; limit: number; cursor?: string; filters: EventHistoryFilters },
): Promise<EventHistoryPage> {
  const { ownerId, limit, filters } = options;
  const position = options.cursor ? decodeEventHistoryCursor(options.cursor, ownerId, filters) : null;

  const sortExpr = filters.dateField === "ingestedAt" ? "r.created_at" : "coalesce(r.timestamp, r.created_at)";
  const descending = filters.order === "desc";
  const params: unknown[] = [ownerId ?? null];
  const where: string[] = ["($1::text is null or r.client_id = $1)"];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.from) where.push(`${sortExpr} >= ${bind(filters.from)}::timestamptz`);
  if (filters.to) where.push(`${sortExpr} < ${bind(filters.to)}::timestamptz`);
  if (filters.source) where.push(`r.source = any(${bind(filters.source)}::text[])`);
  if (filters.category) where.push(`semantic.primary_category_key = any(${bind(filters.category)}::text[])`);
  if (filters.status) where.push(`r.processing_status = any(${bind(filters.status)}::text[])`);
  if (position) {
    const op = descending ? "<" : ">";
    where.push(`(${sortExpr}, r.id::text) ${op} (${bind(position.key)}::timestamptz, ${bind(position.id)}::text)`);
  }

  const direction = descending ? "desc" : "asc";
  const result = await db.query<EventHistoryItem & { sortKey: string }>(
    `
      select
        r.id::text as id,
        r.source,
        r.kind,
        c.inferred_kind as "inferredKind",
        r.title,
        c.display_title as "displayTitle",
        left(r.body, 200) as "bodyPreview",
        coalesce(r.timestamp, r.created_at) as "occurredAt",
        r.created_at as "ingestedAt",
        r.processing_status as "processingStatus",
        semantic.primary_category_key as "primaryCategoryKey",
        c.interpretation_status as "interpretationStatus",
        r.privacy_status as "privacyStatus",
        (${sortExpr})::text as "sortKey"
      from raw_events r
      left join classified_events c on c.raw_event_id = r.id
      left join semantic_event_decisions semantic on semantic.event_id = r.id
      where ${where.join(" and ")}
      order by ${sortExpr} ${direction}, r.id::text ${direction}
      limit ${bind(limit + 1)}
    `,
    params,
  );

  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const last = rows[rows.length - 1];
  const items = rows.map(({ sortKey: _sortKey, ...item }) => ({
    ...item,
    occurredAt: new Date(item.occurredAt).toISOString(),
    ingestedAt: new Date(item.ingestedAt).toISOString(),
  }));

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeEventHistoryCursor({ key: last.sortKey, id: last.id }, ownerId, filters) : null,
  };
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
