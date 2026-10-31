import { cosineSimilarity, EMBEDDING_VERSION, generateEmbedding } from "./embeddings.js";
import { pool } from "./postgres.js";
import { authorizeModelDispatch } from "./privacy.js";
import { derivedRunReadEligibilitySql } from "./search-repository.js";

type Queryable = Pick<typeof pool, "query">;

export type HybridRetrievalFilters = {
  clientId?: string | null;
  source?: string;
  kind?: string;
  from?: string;
  to?: string;
  currency?: string;
  account?: string;
  category?: string;
  limit?: number;
  includeGraph?: boolean;
  objectTypes?: Array<"event" | "entity" | "relation" | "fact" | "insight" | "digest">;
};

export type RetrievalCandidate = {
  objectType: "event" | "entity" | "relation" | "fact" | "insight" | "digest";
  objectId: string;
  title: string;
  excerpt: string;
  eventId: string | null;
  entityId: string | null;
  occurredAt: string | null;
  confidence: number;
  frequency: number;
  textScore: number;
  vectorScore: number;
  graphScore: number;
  finalScore: number;
  evidence: Record<string, unknown>;
};

export function rerankRetrievalCandidate(
  candidate: Omit<RetrievalCandidate, "finalScore">,
  now = Date.now(),
) {
  const occurredAt = candidate.occurredAt ? Date.parse(candidate.occurredAt) : Number.NaN;
  const ageDays = Number.isFinite(occurredAt) ? Math.max(0, (now - occurredAt) / 86_400_000) : 365;
  const recency = Math.exp(-ageDays / 90);
  const frequency = Math.min(1, Math.log2(Math.max(1, candidate.frequency) + 1) / 4);
  return 0.32 * Math.min(1, candidate.textScore)
    + 0.32 * Math.max(0, candidate.vectorScore)
    + 0.12 * candidate.graphScore
    + 0.1 * Math.min(1, Math.max(0, candidate.confidence))
    + 0.08 * recency
    + 0.06 * frequency;
}

function clampLimit(limit: number | undefined) {
  return Math.min(30, Math.max(10, Math.trunc(limit ?? 20)));
}

function candidateKey(candidate: Pick<RetrievalCandidate, "objectType" | "objectId">) {
  return `${candidate.objectType}:${candidate.objectId}`;
}

export async function hybridRetrieve(
  query: string,
  filters: HybridRetrievalFilters = {},
  db: Queryable = pool,
) {
  const limit = clampLimit(filters.limit);
  const objectTypes = new Set(filters.objectTypes ?? ["event", "entity", "relation", "fact", "insight", "digest"]);
  const params = [query, filters.clientId ?? null, filters.source ?? null, filters.kind ?? null,
    filters.from ?? null, filters.to ?? null, filters.currency ?? null,
    filters.account ?? null, filters.category ?? null, limit * 3];
  const textRows = await db.query<{
    objectType: RetrievalCandidate["objectType"];
    objectId: string; title: string; excerpt: string; eventId: string | null;
    entityId: string | null; occurredAt: string | null; confidence: number;
    frequency: number; textScore: number; evidence: Record<string, unknown>;
  }>(`
    with search as (select websearch_to_tsquery('simple', $1) query), candidates as (
      select 'event'::text as "objectType", event.id as "objectId",
        coalesce(classified.display_title, event.title, event.kind) as title,
        left(coalesce(classified.display_description, event.body, event.title, ''), 600) as excerpt,
        event.id as "eventId", null::text as "entityId",
        coalesce(event.timestamp, event.created_at)::text as "occurredAt",
        coalesce(classified.confidence::float8, 0.5) as confidence, 1::int as frequency,
        ts_rank_cd(event.search_vector, search.query)::float8 as "textScore",
        jsonb_build_object('source', event.source, 'kind', event.kind, 'status', event.processing_status,
          'taxonomyVersion', semantic.taxonomy_version, 'primaryCategoryKey', semantic.primary_category_key,
          'secondaryCategoryKeys', semantic.secondary_category_keys, 'facets', semantic.facets) as evidence
      from raw_events event cross join search
      left join classified_events classified on classified.raw_event_id = event.id
      left join semantic_event_decisions semantic on semantic.event_id = event.id
      where event.search_vector @@ search.query and event.privacy_status <> 'hidden'
        and ($2::text is null or event.client_id is not distinct from $2)
        and ($3::text is null or lower(event.source) = lower($3))
        and ($4::text is null or lower(coalesce(classified.inferred_kind, event.kind)) = lower($4))
        and ($5::timestamptz is null or coalesce(event.timestamp, event.created_at) >= $5)
        and ($6::timestamptz is null or coalesce(event.timestamp, event.created_at) <= $6)
        and ($7::text is null or lower(event.raw::text) like '%' || lower($7) || '%')
        and ($8::text is null or lower(event.raw::text) like '%' || lower($8) || '%')
        and ($9::text is null or semantic.primary_category_key = $9 or semantic.primary_category_key like $9 || '.%')
      union all
      select 'entity', coalesce(merged.canonical_entity_id, entity.id), entity.value,
        left(entity.description, 600), null, coalesce(merged.canonical_entity_id, entity.id),
        entity.created_at::text, coalesce((entity.metadata->>'identityConfidence')::float8, 0.8),
        greatest(1, (select count(*)::int from event_entities link where link.entity_id = entity.id)),
        greatest(ts_rank_cd(entity.search_vector, search.query), coalesce((
          select max(ts_rank_cd(alias.search_vector, search.query)) from entity_aliases alias where alias.entity_id = entity.id
        ), 0))::float8,
        jsonb_build_object('type', entity.type, 'aliases', coalesce((select jsonb_agg(alias.alias) from entity_aliases alias where alias.entity_id = entity.id), '[]'::jsonb))
      from entities entity cross join search left join entity_merges merged on merged.alias_entity_id = entity.id
      where entity.visibility <> 'hidden' and (entity.search_vector @@ search.query or exists (
        select 1 from entity_aliases alias where alias.entity_id = entity.id and alias.search_vector @@ search.query
      ))
        and ($2::text is null or entity.owner_id = $2 or (entity.owner_id is null and entity.type in ('domain','concept')))
      union all
      select 'relation', relation.id, relation.label, left(relation.description, 600),
        evidence.event_id, relation.source_entity_id, relation.created_at::text,
        relation.confidence::float8,
        greatest(1, (select count(*)::int from event_relations link where link.relation_id = relation.id)),
        ts_rank_cd(relation.search_vector, search.query)::float8,
        jsonb_build_object('relationType', relation.relation_type, 'sourceEntityId', relation.source_entity_id, 'targetEntityId', relation.target_entity_id)
      from relations relation cross join search
      left join lateral (select link.event_id from event_relations link where link.relation_id = relation.id order by link.event_id limit 1) evidence on true
      where relation.search_vector @@ search.query
        and ($2::text is null or relation.owner_id = $2)
      union all
      select 'fact', fact.id, fact.fact_type, left(fact.value::text, 600), fact.event_id,
        null, fact.created_at::text, fact.confidence::float8, 1,
        ts_rank_cd(to_tsvector('simple', fact.fact_type || ' ' || fact.normalized_value || ' ' || fact.value::text), search.query)::float8,
        fact.evidence
      from knowledge_facts fact cross join search
      where fact.visibility <> 'hidden' and to_tsvector('simple', fact.fact_type || ' ' || fact.normalized_value || ' ' || fact.value::text) @@ search.query
        and ($2::text is null or fact.client_id is not distinct from $2)
      union all
      select 'insight', insight.id, coalesce(insight.query, 'Insight'), left(coalesce(insight.summary, ''), 600),
        null, null, insight.created_at::text, coalesce(insight.confidence::float8, 0.7), 1,
        ts_rank_cd(insight.search_vector, search.query)::float8,
        insight.evidence
      from insight_runs insight cross join search where insight.search_vector @@ search.query
        and ($2::text is null or insight.owner_id is not distinct from $2)
        and (insight.policy_version is null or not exists (
          select 1 from source_processing_policies policy
          where (policy.owner_id = insight.owner_id
              or (policy.owner_id is null and policy.client_scope = insight.owner_id))
            and coalesce(policy.policy_version, 0) > insight.policy_version
        ))
        and ${derivedRunReadEligibilitySql("insight_runs", "insight")}
      union all
      select 'digest', digest.id, coalesce(digest.scope, 'Digest'), left(coalesce(digest.summary, ''), 600),
        null, null, digest.created_at::text, 0.7, 1,
        ts_rank_cd(digest.search_vector, search.query)::float8,
        jsonb_build_object('windowFrom', digest.window_from, 'windowTo', digest.window_to)
      from digest_runs digest cross join search where digest.search_vector @@ search.query
        and ($2::text is null or digest.owner_id is not distinct from $2)
        and (digest.policy_version is null or not exists (
          select 1 from source_processing_policies policy
          where (policy.owner_id = digest.owner_id
              or (policy.owner_id is null and policy.client_scope = digest.owner_id))
            and coalesce(policy.policy_version, 0) > digest.policy_version
        ))
        and ${derivedRunReadEligibilitySql("digest_runs", "digest")}
    ) select * from candidates order by "textScore" desc limit $10
  `, params);

  const selectedTextRows = textRows.rows.filter((row) => objectTypes.has(row.objectType));
  const candidates = new Map<string, Omit<RetrievalCandidate, "finalScore">>();
  for (const row of selectedTextRows) {
    const candidate = { ...row, confidence: Number(row.confidence), frequency: Number(row.frequency), textScore: Number(row.textScore), vectorScore: 0, graphScore: 0 };
    candidates.set(candidateKey(candidate), candidate);
  }

  // The query vector must come from the same model as the stored vectors.
  // Without authorization the provider is never called and the local hash
  // model is used, so only local-hash rows are comparable in that case.
  const queryAuthorization = await authorizeModelDispatch(db, { ownerId: filters.clientId ?? null, purpose: "retrieval_query" });
  const queryGenerated = await generateEmbedding({
    text: query, clientId: filters.clientId, ownerId: filters.clientId ?? null,
    purpose: "retrieval_query", authorization: queryAuthorization,
  });
  const queryEmbedding = queryGenerated.embedding;
  const vectorRows = await db.query<{
    objectType: "event" | "entity" | "insight" | "digest" | "fact";
    objectId: string; embedding: number[]; content: string; metadata: Record<string, unknown>;
    updatedAt: string;
  }>(`
    select embedding.object_type as "objectType", embedding.object_id as "objectId", embedding.embedding,
      embedding.content, embedding.metadata, embedding.updated_at::text as "updatedAt"
    from knowledge_embeddings embedding
    where embedding.embedding_version = $1
      and ($2::text is null or embedding.client_id is not distinct from $2)
      and embedding.model = $3 and embedding.dimensions = $4
      -- An embedding marked stale by a policy change must never surface, even
      -- when its original source metadata is unavailable.
      and coalesce(embedding.metadata->>'policyStale', 'false') <> 'true'
      -- Any embedding older than the owner's current policy version is
      -- outdated for external/derived use.
      and (
        coalesce(embedding.owner_id, embedding.client_id) is null
        or not exists (
          select 1 from source_processing_policies policy
          where (policy.owner_id = coalesce(embedding.owner_id, embedding.client_id)
              or (policy.owner_id is null and policy.client_scope = coalesce(embedding.owner_id, embedding.client_id)))
            and coalesce(policy.policy_version, 0) > coalesce(embedding.policy_version, 0)
        )
      )
      and (embedding.object_type <> 'event' or exists (select 1 from raw_events event where event.id = embedding.object_id and event.privacy_status <> 'hidden'))
      and (embedding.object_type <> 'entity' or exists (select 1 from entities entity where entity.id = embedding.object_id and entity.visibility <> 'hidden'))
      and (embedding.object_type <> 'fact' or exists (select 1 from knowledge_facts fact where fact.id = embedding.object_id and fact.visibility <> 'hidden'))
      -- Insight/digest embeddings must be joinable to a still-fresh run. A
      -- missing run or a run older than an owner policy bump is stale.
      and (
        embedding.object_type not in ('insight', 'digest')
        or (
          embedding.object_type = 'insight'
          and exists (
            select 1 from insight_runs run
            where run.id = embedding.object_id
              and (run.policy_version is null or not exists (
                select 1 from source_processing_policies policy
                where (policy.owner_id = run.owner_id
                    or (policy.owner_id is null and policy.client_scope = run.owner_id))
                  and coalesce(policy.policy_version, 0) > run.policy_version
              ))
              and ${derivedRunReadEligibilitySql("insight_runs", "run")}
          )
        )
        or (
          embedding.object_type = 'digest'
          and exists (
            select 1 from digest_runs run
            where run.id = embedding.object_id
              and (run.policy_version is null or not exists (
                select 1 from source_processing_policies policy
                where (policy.owner_id = run.owner_id
                    or (policy.owner_id is null and policy.client_scope = run.owner_id))
                  and coalesce(policy.policy_version, 0) > run.policy_version
              ))
              and ${derivedRunReadEligibilitySql("digest_runs", "run")}
          )
        )
      )
    order by embedding.updated_at desc limit 1000
  `, [EMBEDDING_VERSION, filters.clientId ?? null, queryGenerated.model, queryEmbedding.length]);
  for (const row of vectorRows.rows) {
    if (!objectTypes.has(row.objectType)) continue;
    const similarity = cosineSimilarity(queryEmbedding, row.embedding.map(Number));
    if (similarity < 0.08) continue;
    const key = `${row.objectType}:${row.objectId}`;
    const existing = candidates.get(key);
    if (existing) {
      existing.vectorScore = Math.max(existing.vectorScore, similarity);
    } else {
      candidates.set(key, {
        objectType: row.objectType, objectId: row.objectId,
        title: String(row.metadata.title ?? row.metadata.type ?? row.objectType),
        excerpt: row.content.slice(0, 600), eventId: row.objectType === "event" ? row.objectId : null,
        entityId: row.objectType === "entity" ? row.objectId : null, occurredAt: row.updatedAt,
        confidence: Number(row.metadata.confidence ?? 0.7), frequency: Number(row.metadata.frequency ?? 1),
        textScore: 0, vectorScore: similarity, graphScore: 0, evidence: row.metadata,
      });
    }
  }

  const seedEntityIds = [...candidates.values()].filter((candidate) => candidate.entityId).map((candidate) => candidate.entityId!);
  if (filters.includeGraph !== false && seedEntityIds.length) {
    const graph = await db.query<{ id: string; value: string; description: string; type: string; seedId: string; confidence: number }>(`
      select neighbor.id, neighbor.value, neighbor.description, neighbor.type,
        seed.id as "seedId", relation.confidence::float8
      from entities seed join relations relation
        on relation.source_entity_id = seed.id or relation.target_entity_id = seed.id
      join entities neighbor on neighbor.id = case when relation.source_entity_id = seed.id then relation.target_entity_id else relation.source_entity_id end
      where seed.id = any($1::text[]) and neighbor.visibility <> 'hidden'
        and ($2::text is null or neighbor.owner_id is not distinct from $2
          or (neighbor.owner_id is null and neighbor.type in ('domain','concept')))
        and ($2::text is null or relation.owner_id is not distinct from $2)
      order by relation.confidence desc limit 100
    `, [seedEntityIds, filters.clientId ?? null]);
    for (const row of graph.rows) {
      const key = `entity:${row.id}`;
      const existing = candidates.get(key);
      if (existing) existing.graphScore = Math.max(existing.graphScore, Number(row.confidence));
      else if (objectTypes.has("entity")) candidates.set(key, {
        objectType: "entity", objectId: row.id, title: row.value, excerpt: row.description,
        eventId: null, entityId: row.id, occurredAt: null, confidence: Number(row.confidence), frequency: 1,
        textScore: 0, vectorScore: 0, graphScore: Number(row.confidence), evidence: { type: row.type, connectedTo: row.seedId },
      });
    }
  }

  const results = [...candidates.values()].map((candidate) => ({ ...candidate, finalScore: rerankRetrievalCandidate(candidate) }))
    .sort((left, right) => right.finalScore - left.finalScore || candidateKey(left).localeCompare(candidateKey(right)))
    .slice(0, limit);
  return {
    query,
    filters: { ...filters, limit },
    strategy: { structured: true, fullText: true, vector: true, aliasesAndMerges: true, graphDepth: filters.includeGraph === false ? 0 : 1, reranked: true },
    count: results.length,
    results,
    evidencePackage: results.map((result) => ({
      evidenceId: `${result.objectType}:${result.objectId}`,
      title: result.title,
      fact: result.excerpt,
      confidence: result.confidence,
      score: result.finalScore,
      sourceEventId: result.eventId,
      relationship: result.evidence,
    })),
  };
}

export async function retrieveSemanticContext(
  query: string,
  clientId: string | null,
  limit = 20,
  db: Queryable = pool,
) {
  const retrieval = await hybridRetrieve(query, { clientId, limit, includeGraph: true, objectTypes: ["entity"] }, db);
  const ids = retrieval.results.map((result) => result.objectId);
  if (!ids.length) return { entities: [], hierarchy: [], retrieval };
  const entities = await db.query<{ id: string; type: string; value: string; normalizedValue: string; description: string; aliases: string[]; taxonomyKeys: string[]; roles: string[] }>(`
    select distinct entity.id, entity.type, entity.value, entity.normalized_value as "normalizedValue",
      entity.description, coalesce((select array_agg(alias.alias order by alias.alias) from entity_aliases alias where alias.entity_id = entity.id), '{}') as aliases,
      coalesce(profile.taxonomy_keys, '{}'::text[]) as "taxonomyKeys", coalesce(profile.roles, '{}'::text[]) as roles
    from entities entity left join entity_merges merged on merged.alias_entity_id = entity.id
    left join entity_semantic_profiles profile on profile.entity_id = entity.id
    where entity.id = any($1::text[]) and merged.alias_entity_id is null
      and entity.visibility <> 'hidden' and entity.identity_source in ('ai','ai_seed','user')
      and length(btrim(entity.description)) > 0
    limit 30
  `, [ids]);
  const hierarchy = await db.query<{ child: string; parent: string }>(`
    with recursive lineage(source_id, target_id, depth) as (
      select relation.source_entity_id, relation.target_entity_id, 1
      from relations relation where relation.source_entity_id = any($1::text[])
        and relation.relation_type in ('part_of','belongs_to_domain')
      union all
      select relation.source_entity_id, relation.target_entity_id, lineage.depth + 1
      from lineage join relations relation on relation.source_entity_id = lineage.target_id
      where relation.relation_type in ('part_of','belongs_to_domain') and lineage.depth < 8
    )
    select distinct child.value as child, parent.value as parent
    from lineage join entities child on child.id = lineage.source_id
      join entities parent on parent.id = lineage.target_id
  `, [ids]);
  return { entities: entities.rows, hierarchy: hierarchy.rows, retrieval };
}
