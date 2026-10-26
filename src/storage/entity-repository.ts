import { pool } from "./postgres.js";
import type { EntityDraft } from "../domain/entities.js";
import type { RelationDraft } from "../domain/relations.js";
import { upsertRelation } from "./relation-repository.js";
import { invalidateGraphTraversalCache } from "./graph-cache.js";
import { randomUUID } from "node:crypto";

type Queryable = Pick<typeof pool, "query">;

export type EntityRecord = {
  id: string;
  type: string;
  value: string;
  normalizedValue: string;
  description: string;
  identitySource: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  canonicalEntityId: string;
  isCanonical: boolean;
  aliasCount: number;
  mergeReason: string | null;
  mergeConfidence: number | null;
};

export type ResolvedEntityRecord = EntityRecord & {
  matchedEntityId: string;
};

export async function rewireEntityRelations(db: Queryable, aliasEntityId: string, canonicalEntityId: string) {
  const relations = await db.query<{ id: string; sourceEntityId: string; targetEntityId: string; relationType: string }>(`
    select id, source_entity_id as "sourceEntityId", target_entity_id as "targetEntityId", relation_type as "relationType"
    from relations where source_entity_id = $1 or target_entity_id = $1
    order by created_at, id
  `, [aliasEntityId]);
  for (const relation of relations.rows) {
    if (relation.relationType === "same_as") continue;
    const nextSource = relation.sourceEntityId === aliasEntityId ? canonicalEntityId : relation.sourceEntityId;
    const nextTarget = relation.targetEntityId === aliasEntityId ? canonicalEntityId : relation.targetEntityId;
    if (nextSource === nextTarget) {
      await db.query(`delete from relations where id = $1`, [relation.id]);
      continue;
    }
    const hierarchy = ["part_of", "belongs_to_domain"].includes(relation.relationType);
    if (hierarchy && relation.sourceEntityId === aliasEntityId) {
      const established = await db.query<{ id: string }>(`
        select id from relations where source_entity_id = $1 and relation_type in ('part_of','belongs_to_domain') limit 1
      `, [canonicalEntityId]);
      if (established.rows[0]) {
        await db.query(`
          insert into event_relations (id,event_id,relation_id,role,confidence)
          select $1 || md5(old.id || old.event_id), old.event_id, $2, old.role, old.confidence
          from event_relations old where old.relation_id = $3
          on conflict (event_id,relation_id) do update set confidence = greatest(event_relations.confidence, excluded.confidence)
        `, [`event_relation_${randomUUID()}_`, established.rows[0].id, relation.id]);
        await db.query(`delete from relations where id = $1`, [relation.id]);
        continue;
      }
    }
    if (hierarchy && relation.targetEntityId === aliasEntityId) {
      await db.query(`delete from relations where source_entity_id = $1 and id <> $2 and relation_type in ('part_of','belongs_to_domain')`, [nextSource, relation.id]);
    }
    const duplicate = await db.query<{ id: string }>(`
      select id from relations where source_entity_id = $1 and target_entity_id = $2 and relation_type = $3 and id <> $4 limit 1
    `, [nextSource, nextTarget, relation.relationType, relation.id]);
    if (duplicate.rows[0]) {
      await db.query(`
        insert into event_relations (id,event_id,relation_id,role,confidence)
        select $1 || md5(old.id || old.event_id), old.event_id, $2, old.role, old.confidence
        from event_relations old where old.relation_id = $3
        on conflict (event_id,relation_id) do update set confidence = greatest(event_relations.confidence, excluded.confidence)
      `, [`event_relation_${randomUUID()}_`, duplicate.rows[0].id, relation.id]);
      await db.query(`delete from relations where id = $1`, [relation.id]);
    } else {
      await db.query(`update relations set source_entity_id = $1, target_entity_id = $2 where id = $3`, [nextSource, nextTarget, relation.id]);
    }
  }
}

type EntityMatchRow = EntityRecord & {
  matchedEntityId?: string | null;
};

type ApproximateEntityMatchRow = EntityMatchRow & {
  matchText: string;
};

function normalizeMatchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshteinDistance(left: string, right: string) {
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function diceCoefficient(left: string[], right: string[]) {
  if (!left.length || !right.length) return 0;
  const remaining = new Map<string, number>();
  for (const value of right) remaining.set(value, (remaining.get(value) ?? 0) + 1);
  let overlap = 0;
  for (const value of left) {
    const count = remaining.get(value) ?? 0;
    if (!count) continue;
    overlap += 1;
    remaining.set(value, count - 1);
  }
  return (2 * overlap) / (left.length + right.length);
}

function characterBigrams(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (compact.length < 2) return compact ? [compact] : [];
  return Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2));
}

/** Rank user-entered names against stored entities and aliases without requiring pg_trgm. */
export function scoreEntityNameMatch(query: string, candidate: string) {
  const normalizedQuery = normalizeMatchText(query);
  const normalizedCandidate = normalizeMatchText(candidate);
  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (normalizedQuery === normalizedCandidate) return 1;

  const shorterLength = Math.min(normalizedQuery.length, normalizedCandidate.length);
  const longerLength = Math.max(normalizedQuery.length, normalizedCandidate.length);
  const containmentScore = normalizedQuery.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedQuery)
    ? 0.72 + (shorterLength / longerLength) * 0.2
    : 0;
  const tokenScore = diceCoefficient(normalizedQuery.split(" "), normalizedCandidate.split(" ")) * 0.9;
  const bigramScore = diceCoefficient(characterBigrams(normalizedQuery), characterBigrams(normalizedCandidate));
  const editScore = 1 - (levenshteinDistance(normalizedQuery, normalizedCandidate) / longerLength);

  return Math.max(containmentScore, tokenScore, bigramScore * 0.78 + editScore * 0.22, editScore * 0.8);
}

export type EntityMergeRecord = {
  aliasEntityId: string;
  canonicalEntityId: string;
  reason: string;
  confidence: number;
  alreadyMerged: boolean;
  sameAsRelation: {
    id: string;
    relationType: string;
    label: string;
    description: string;
  } | null;
};

function selectEntityProjectionSql() {
  return `
    select
      e.id,
      e.type,
      e.value,
      e.normalized_value as "normalizedValue",
      e.description,
      e.identity_source as "identitySource",
      e.metadata,
      e.created_at as "createdAt",
      coalesce(em.canonical_entity_id, e.id) as "canonicalEntityId",
      case when em.alias_entity_id is null then true else false end as "isCanonical",
      coalesce((
        select count(*)::integer
        from entity_merges aliases
        where aliases.canonical_entity_id = e.id
      ), 0) as "aliasCount",
      em.reason as "mergeReason",
      em.confidence as "mergeConfidence"
    from entities e
    left join entity_merges em on em.alias_entity_id = e.id
  `;
}

async function loadEntityById(db: Queryable, entityId: string): Promise<EntityRecord | null> {
  const result = await db.query<EntityRecord>(
    `
      ${selectEntityProjectionSql()}
      where e.id = $1
      limit 1
    `,
    [entityId],
  );

  return result.rows[0] ?? null;
}

export async function resolveCanonicalEntityId(db: Queryable, entityId: string) {
  const entity = await loadEntityById(db, entityId);
  return entity?.canonicalEntityId ?? null;
}

export async function loadCanonicalEntityById(db: Queryable, entityId: string): Promise<EntityRecord | null> {
  const canonicalEntityId = await resolveCanonicalEntityId(db, entityId);
  if (!canonicalEntityId) {
    return null;
  }

  return loadEntityById(db, canonicalEntityId);
}

/** Resolve an existing canonical merchant before falling back to raw text. */
export async function findCanonicalMerchantByValue(db: Queryable, value: string): Promise<EntityRecord | null> {
  const normalizedValue = value.trim().toLocaleLowerCase();
  if (!normalizedValue) return null;

  const result = await db.query<{ id: string }>(`
    select e.id
    from entities e
    where e.type = 'merchant'
      and e.visibility <> 'hidden'
      and not exists (
        select 1 from deletion_tombstones tombstone
        where tombstone.target_type = 'entity' and tombstone.target_id = e.id
      )
      and (
        lower(e.normalized_value) = $1
        or exists (
          select 1 from entity_aliases a
          where a.entity_id = e.id and lower(a.normalized_alias) = $1
        )
      )
    order by e.created_at asc
    limit 1
  `, [normalizedValue]);

  return result.rows[0] ? loadCanonicalEntityById(db, result.rows[0].id) : null;
}

export async function upsertEntity(
  db: Queryable,
  draft: EntityDraft,
  options: { ownerId?: string | null } = {},
): Promise<EntityRecord> {
  // The owner applies only to a newly inserted personal identity. Public
  // taxonomy stays ownerless, and an existing row never changes owner here.
  const ownerId = draft.type === "domain" || draft.type === "concept" ? null : options.ownerId ?? null;
  // During a historical activation many events share category and identity
  // rows. A plain read avoids taking a row lock on every existing shared
  // entity; inserts still use the unique index and a bounded conflict path.
  if (process.env.BRAINIA_ACTIVATION_MODE === "true") {
    const existing = await db.query<{ id: string }>(
      `select id from entities where type = $1 and normalized_value = $2 limit 1`,
      [draft.type, draft.normalizedValue],
    );
    if (existing.rows[0]) {
      const record = await loadCanonicalEntityById(db, existing.rows[0].id);
      if (record) return record;
    }
  }
  const result = await db.query<{ id: string }>(
    `
      insert into entities (
        id,
        type,
        value,
        normalized_value,
        description,
        identity_source,
        metadata,
        owner_id
      ) values (
        next_sequence_value('entity'),
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        $7
      )
      on conflict (type, normalized_value)
      do update set
        value = case
          when excluded.identity_source in ('ai', 'ai_seed', 'user') or entities.identity_source not in ('ai', 'ai_seed', 'user') then excluded.value
          else entities.value
        end,
        description = case when length(btrim(excluded.description)) > 0 then excluded.description else entities.description end,
        identity_source = case when excluded.identity_source in ('ai', 'ai_seed', 'user') then excluded.identity_source else entities.identity_source end,
        metadata = entities.metadata || excluded.metadata
      returning
        id
    `,
    [draft.type, draft.value, draft.normalizedValue, draft.description?.trim() ?? "", draft.identitySource ?? "extracted", JSON.stringify(draft.metadata ?? {}), ownerId],
  );

  const storedEntity = await loadCanonicalEntityById(db, result.rows[0].id);
  if (!storedEntity) {
    throw new Error("Entity could not be loaded after upsert");
  }

  return storedEntity;
}

export async function listEntities(ownerId?: string, db: Queryable = pool) {
  const result = await db.query<EntityRecord>(
    `
      ${selectEntityProjectionSql()}
      where e.visibility <> 'hidden'
        and not exists (
          select 1 from deletion_tombstones tombstone
          where tombstone.target_type = 'entity' and tombstone.target_id = e.id
        )
        ${ownerId ? "and (e.owner_id = $1 or (e.owner_id is null and e.type in ('domain','concept')))" : ""}
      order by e.created_at asc
    `,
    ownerId ? [ownerId] : [],
  );

  return result.rows;
}

export async function resolveEntityMatches(
  db: Queryable,
  input: { id?: string; q?: string; ownerId?: string | null },
): Promise<ResolvedEntityRecord[]> {
  const resolved: ResolvedEntityRecord[] = [];
  const seenCanonicalIds = new Set<string>();

  if (input.id) {
    const rows = await db.query<EntityRecord>(
      `
        ${selectEntityProjectionSql()}
        where e.id = $1
        limit 10
      `,
      [input.id],
    );

    for (const row of rows.rows) {
      const canonical = row.canonicalEntityId === row.id ? row : await loadEntityById(db, row.canonicalEntityId);
      if (!canonical) continue;
      if (seenCanonicalIds.has(canonical.id)) continue;
      seenCanonicalIds.add(canonical.id);

      resolved.push({
        ...canonical,
        matchedEntityId: row.id,
      });
    }

    return resolved;
  }

  const query = input.q!.trim();
  const normalizedQuery = normalizeMatchText(query);
  const term = `%${normalizedQuery}%`;
  const ownerId = input.ownerId ?? null;
  // Query-based resolution must never rank another owner's entity. Public
  // taxonomy stays matchable for every caller; personal rows require an exact
  // owner match. An unscoped caller (admin/global or disabled local mode)
  // keeps the previous global behavior.
  const entityOwnerClause = ownerId
    ? `and (e.owner_id = $3 or (e.owner_id is null and e.type in ('domain','concept')))`
    : "";
  const aliasOwnerClause = ownerId
    ? `and (e.owner_id = $2 or (e.owner_id is null and e.type in ('domain','concept')))`
    : "";
  const approximateOwnerClause = ownerId
    ? `where e.owner_id = $1 or (e.owner_id is null and e.type in ('domain','concept'))`
    : `where true`;
  const [entityRows, aliasRows, approximateRows] = await Promise.all([
    db.query<EntityMatchRow>(
      `
        ${selectEntityProjectionSql()}
        where (
          lower(e.id) like $1
           or lower(e.type) like $1
           or lower(e.value) like $1
           or lower(e.normalized_value) like $1
        )
        ${entityOwnerClause}
        and e.visibility <> 'hidden'
        and not exists (
          select 1 from deletion_tombstones tombstone
          where tombstone.target_type = 'entity' and tombstone.target_id = e.id
        )
        order by
          case when lower(e.id) = $2 then 0 else 1 end,
          case when lower(e.value) = $2 or lower(e.normalized_value) = $2 then 0 else 1 end,
          e.created_at desc
        limit 10
      `,
      ownerId ? [term, normalizedQuery, ownerId] : [term, normalizedQuery],
    ),
    db.query<EntityMatchRow>(
      `
        select
          e.id,
          e.type,
          e.value,
          e.normalized_value as "normalizedValue",
          e.metadata,
          e.created_at as "createdAt",
          coalesce(em.canonical_entity_id, e.id) as "canonicalEntityId",
          case when em.alias_entity_id is null then true else false end as "isCanonical",
          coalesce((
            select count(*)::integer
            from entity_merges aliases
            where aliases.canonical_entity_id = e.id
          ), 0) as "aliasCount",
          em.reason as "mergeReason",
          em.confidence as "mergeConfidence",
          a.id as "matchedEntityId"
        from entity_aliases a
        join entities e on e.id = a.entity_id
        left join entity_merges em on em.alias_entity_id = e.id
        where (
          lower(a.alias) like $1
           or lower(a.normalized_alias) like $1
           or lower(coalesce(array_to_string(a.category_path, ' / '), '')) like $1
        )
        ${aliasOwnerClause}
        and e.visibility <> 'hidden'
        and not exists (
          select 1 from deletion_tombstones tombstone
          where tombstone.target_type = 'entity' and tombstone.target_id = e.id
        )
        order by a.created_at desc
        limit 10
      `,
      ownerId ? [term, ownerId] : [term],
    ),
    db.query<ApproximateEntityMatchRow>(
      `
        select
          e.id,
          e.type,
          e.value,
          e.normalized_value as "normalizedValue",
          e.description,
          e.identity_source as "identitySource",
          e.metadata,
          e.created_at as "createdAt",
          coalesce(em.canonical_entity_id, e.id) as "canonicalEntityId",
          case when em.alias_entity_id is null then true else false end as "isCanonical",
          coalesce((
            select count(*)::integer
            from entity_merges aliases
            where aliases.canonical_entity_id = e.id
          ), 0) as "aliasCount",
          em.reason as "mergeReason",
          em.confidence as "mergeConfidence",
          e.id as "matchedEntityId",
          coalesce(nullif(a.alias, ''), e.value) as "matchText"
        from entities e
        left join entity_merges em on em.alias_entity_id = e.id
        left join entity_aliases a on a.entity_id = e.id
        ${approximateOwnerClause}
        and e.visibility <> 'hidden'
        and not exists (
          select 1 from deletion_tombstones tombstone
          where tombstone.target_type = 'entity' and tombstone.target_id = e.id
        )
        order by e.created_at desc
        limit 1000
      `,
      ownerId ? [ownerId] : [],
    ),
  ]);

  const rankedRows = [
    ...entityRows.rows.map((row) => ({ row, score: 2 })),
    ...aliasRows.rows.map((row) => ({ row, score: 1.9 })),
    ...approximateRows.rows
      .map((row) => ({ row, score: Math.max(scoreEntityNameMatch(query, row.value), scoreEntityNameMatch(query, row.normalizedValue), scoreEntityNameMatch(query, row.matchText)) }))
      .filter(({ score }) => score >= 0.56)
      .sort((left, right) => right.score - left.score),
  ];

  for (const { row } of rankedRows) {
    const canonical = row.canonicalEntityId === row.id ? row : await loadEntityById(db, row.canonicalEntityId);
    if (!canonical) continue;
    if (seenCanonicalIds.has(canonical.id)) continue;
    seenCanonicalIds.add(canonical.id);

    resolved.push({
      ...canonical,
      matchedEntityId: row.matchedEntityId ?? row.id,
    });
    if (resolved.length >= 10) break;
  }

  return resolved;
}

export async function mergeEntities(
  db: Queryable,
  aliasEntityId: string,
  canonicalEntityId: string,
  options: {
    reason?: string;
    confidence?: number;
    sameAsDraft?: Partial<RelationDraft>;
  } = {},
): Promise<EntityMergeRecord> {
  const aliasRootId = await resolveCanonicalEntityId(db, aliasEntityId);
  const canonicalRootId = await resolveCanonicalEntityId(db, canonicalEntityId);

  if (!aliasRootId || !canonicalRootId) {
    throw new Error("Both entities must exist before they can be merged");
  }

  if (aliasRootId === canonicalRootId) {
    return {
      aliasEntityId: aliasRootId,
      canonicalEntityId: canonicalRootId,
      reason: options.reason ?? "same_as",
      confidence: options.confidence ?? 1,
      alreadyMerged: true,
      sameAsRelation: null,
    };
  }

  const aliasEntity = await loadEntityById(db, aliasRootId);
  const canonicalEntity = await loadEntityById(db, canonicalRootId);

  if (!aliasEntity || !canonicalEntity) {
    throw new Error("Both entities must exist before they can be merged");
  }

  if (aliasEntity.type !== canonicalEntity.type) {
    throw new Error("Only entities of the same type can be merged");
  }

  const reason = options.reason ?? "manual_merge";
  const confidence = options.confidence ?? 1;

  await rewireEntityRelations(db, aliasRootId, canonicalRootId);

  await db.query(
    `
      insert into entity_merges (
        alias_entity_id,
        canonical_entity_id,
        reason,
        confidence
      ) values (
        $1, $2, $3, $4
      )
      on conflict (alias_entity_id)
      do update set
        canonical_entity_id = excluded.canonical_entity_id,
        reason = excluded.reason,
        confidence = excluded.confidence
    `,
    [aliasRootId, canonicalRootId, reason, confidence],
  );

  const sameAsDraft: RelationDraft = {
    relationType: options.sameAsDraft?.relationType ?? "same_as",
    label: options.sameAsDraft?.label ?? "es la misma entidad que",
    description:
      options.sameAsDraft?.description ?? `${aliasEntity.value} es la misma entidad que ${canonicalEntity.value}`,
    sourceEntity: {
      type: aliasEntity.type,
      value: aliasEntity.value,
      normalizedValue: aliasEntity.normalizedValue,
      metadata: {
        source: "merge",
        reason,
      },
    },
    targetEntity: {
      type: canonicalEntity.type,
      value: canonicalEntity.value,
      normalizedValue: canonicalEntity.normalizedValue,
      metadata: {
        source: "merge",
        reason,
      },
    },
    confidence,
    metadata: {
      source: "manual_merge",
      reason,
    },
  };

  const sameAsRelation = await upsertRelation(
    db,
    sameAsDraft,
    aliasRootId,
    canonicalRootId,
  );

  invalidateGraphTraversalCache();

  return {
    aliasEntityId: aliasRootId,
    canonicalEntityId: canonicalRootId,
    reason,
    confidence,
    alreadyMerged: false,
    sameAsRelation,
  };
}
