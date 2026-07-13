import { pool } from "./postgres.js";
import type { EntityDraft } from "../domain/entities.js";
import type { RelationDraft } from "../domain/relations.js";
import { upsertRelation } from "./relation-repository.js";
import { invalidateGraphTraversalCache } from "./graph-cache.js";

type Queryable = Pick<typeof pool, "query">;

export type EntityRecord = {
  id: string;
  type: string;
  value: string;
  normalizedValue: string;
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

type EntityMatchRow = EntityRecord & {
  matchedEntityId?: string | null;
};

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

export async function upsertEntity(db: Queryable, draft: EntityDraft): Promise<EntityRecord> {
  const result = await db.query<{ id: string }>(
    `
      insert into entities (
        id,
        type,
        value,
        normalized_value,
        metadata
      ) values (
        next_sequence_value('entity'),
        $1,
        $2,
        $3,
        $4::jsonb
      )
      on conflict (type, normalized_value)
      do update set
        value = excluded.value,
        metadata = entities.metadata || excluded.metadata
      returning
        id
    `,
    [draft.type, draft.value, draft.normalizedValue, JSON.stringify(draft.metadata ?? {})],
  );

  const storedEntity = await loadCanonicalEntityById(db, result.rows[0].id);
  if (!storedEntity) {
    throw new Error("Entity could not be loaded after upsert");
  }

  return storedEntity;
}

export async function listEntities() {
  const result = await pool.query<EntityRecord>(
    `
      ${selectEntityProjectionSql()}
      order by e.created_at asc
    `,
  );

  return result.rows;
}

export async function resolveEntityMatches(
  db: Queryable,
  input: { id?: string; q?: string },
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

  const term = `%${input.q!.trim().toLowerCase()}%`;
  const [entityRows, aliasRows] = await Promise.all([
    db.query<EntityMatchRow>(
      `
        ${selectEntityProjectionSql()}
        where lower(e.id) like $1
           or lower(e.type) like $1
           or lower(e.value) like $1
           or lower(e.normalized_value) like $1
        order by
          case when lower(e.id) = $1 then 0 else 1 end,
          case when lower(e.value) = $1 then 0 else 1 end,
          e.created_at desc
        limit 10
      `,
      [term],
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
        where lower(a.alias) like $1
           or lower(a.normalized_alias) like $1
           or lower(coalesce(array_to_string(a.category_path, ' / '), '')) like $1
        order by a.created_at desc
        limit 10
      `,
      [term],
    ),
  ]);

  for (const row of [...entityRows.rows, ...aliasRows.rows]) {
    const canonical = row.canonicalEntityId === row.id ? row : await loadEntityById(db, row.canonicalEntityId);
    if (!canonical) continue;
    if (seenCanonicalIds.has(canonical.id)) continue;
    seenCanonicalIds.add(canonical.id);

    resolved.push({
      ...canonical,
      matchedEntityId: row.matchedEntityId ?? row.id,
    });
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

  const reason = options.reason ?? "manual_merge";
  const confidence = options.confidence ?? 1;

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
