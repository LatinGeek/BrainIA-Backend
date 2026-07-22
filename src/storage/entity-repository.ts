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

export async function upsertEntity(db: Queryable, draft: EntityDraft): Promise<EntityRecord> {
  const result = await db.query<{ id: string }>(
    `
      insert into entities (
        id,
        type,
        value,
        normalized_value,
        description,
        identity_source,
        metadata
      ) values (
        next_sequence_value('entity'),
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb
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
    [draft.type, draft.value, draft.normalizedValue, draft.description?.trim() ?? "", draft.identitySource ?? "extracted", JSON.stringify(draft.metadata ?? {})],
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
