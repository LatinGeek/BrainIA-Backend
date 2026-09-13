import { randomUUID } from "node:crypto";
import { categoryByKey } from "../domain/ontology.js";
import { normalizeRelationType } from "../domain/relations.js";
import { loadCanonicalEntityById } from "./entity-repository.js";
import { invalidateGraphTraversalCache } from "./graph-cache.js";
import { pool, withTransaction } from "./postgres.js";
import { upsertRelation } from "./relation-repository.js";

type Queryable = Pick<typeof pool, "query">;

export const ENTITY_ROLES = [
  "merchant", "business", "payment_method", "organization", "app", "provider", "account",
] as const;
export type EntityRole = typeof ENTITY_ROLES[number];

export const REVIEW_RELATION_TYPES = ["part_of", "uses_service", "produced_by_app", "controls", "related_to"] as const;
export type ReviewRelationType = typeof REVIEW_RELATION_TYPES[number];

export type EntityProfileRelation = {
  relationType: ReviewRelationType;
  targetEntityId: string;
};

export type EntitySemanticProfile = {
  entityId: string;
  taxonomyKeys: string[];
  roles: EntityRole[];
  notes: string | null;
  relations: Array<EntityProfileRelation & { targetLabel: string }>;
  updatedAt: string | null;
};

function normalizeUnique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export async function loadEntitySemanticProfile(db: Queryable, entityId: string): Promise<EntitySemanticProfile | null> {
  const entity = await loadCanonicalEntityById(db, entityId);
  if (!entity) return null;
  const [profile, relations] = await Promise.all([
    db.query<{ taxonomyKeys: string[]; roles: EntityRole[]; notes: string | null; updatedAt: string }>(`
      select taxonomy_keys as "taxonomyKeys", roles, notes, updated_at as "updatedAt"
      from entity_semantic_profiles where entity_id = $1 limit 1
    `, [entity.id]),
    db.query<{ relationType: ReviewRelationType; targetEntityId: string; targetLabel: string }>(`
      select relation.relation_type as "relationType", target.id as "targetEntityId", target.value as "targetLabel"
      from relations relation join entities target on target.id = relation.target_entity_id
      where relation.source_entity_id = $1 and relation.metadata ->> 'source' = 'entity-review'
      order by target.value
    `, [entity.id]),
  ]);
  const saved = profile.rows[0];
  return {
    entityId: entity.id,
    taxonomyKeys: saved?.taxonomyKeys ?? [],
    roles: saved?.roles ?? [],
    notes: saved?.notes ?? null,
    relations: relations.rows,
    updatedAt: saved?.updatedAt ?? null,
  };
}

export async function saveEntitySemanticProfile(input: {
  entityId: string;
  clientId: string | null;
  taxonomyKeys: string[];
  roles: EntityRole[];
  notes?: string | null;
  relations: EntityProfileRelation[];
}) {
  const taxonomyKeys = normalizeUnique(input.taxonomyKeys);
  if (taxonomyKeys.some((key) => !categoryByKey(key))) throw new Error("Unknown taxonomy key");
  const roles = normalizeUnique(input.roles) as EntityRole[];
  if (roles.some((role) => !ENTITY_ROLES.includes(role))) throw new Error("Unknown entity role");
  if (input.relations.some((relation) => !REVIEW_RELATION_TYPES.includes(relation.relationType))) throw new Error("Unsupported review relation");

  return withTransaction(async (db) => {
    const entity = await loadCanonicalEntityById(db, input.entityId);
    if (!entity) return null;
    const relations = [...new Map(input.relations.map((relation) => [`${relation.relationType}:${relation.targetEntityId}`, relation])).values()];
    for (const relation of relations) {
      if (relation.targetEntityId === entity.id) throw new Error("An entity cannot relate to itself");
      const target = await loadCanonicalEntityById(db, relation.targetEntityId);
      if (!target) throw new Error("Relation target was not found");
    }
    await db.query(`
      insert into entity_semantic_profiles (entity_id, client_id, taxonomy_keys, roles, notes)
      values ($1,$2,$3::text[],$4::text[],$5)
      on conflict (entity_id) do update set client_id = excluded.client_id,
        taxonomy_keys = excluded.taxonomy_keys, roles = excluded.roles, notes = excluded.notes,
        updated_at = now()
    `, [entity.id, input.clientId, taxonomyKeys, roles, input.notes?.trim() || null]);
    await db.query(`delete from relations where source_entity_id = $1 and metadata ->> 'source' = 'entity-review'`, [entity.id]);
    for (const relation of relations) {
      const target = await loadCanonicalEntityById(db, relation.targetEntityId);
      if (!target) continue;
      const normalized = normalizeRelationType(relation.relationType);
      await upsertRelation(db, {
        relationType: normalized.relationType,
        label: normalized.label,
        description: `${entity.value} ${normalized.label.toLowerCase()} ${target.value}`,
        sourceEntity: { type: entity.type, value: entity.value, normalizedValue: entity.normalizedValue, description: entity.description, metadata: entity.metadata },
        targetEntity: { type: target.type, value: target.value, normalizedValue: target.normalizedValue, description: target.description, metadata: target.metadata },
        confidence: 1,
        metadata: { source: "entity-review", clientId: input.clientId, confirmed: true },
      }, entity.id, target.id);
    }
    await db.query(`
      insert into knowledge_feedback (id, client_id, action, target_type, target_id, payload)
      values ($1,$2,'categorize','entity',$3,$4::jsonb)
    `, [randomUUID(), input.clientId, entity.id, JSON.stringify({ taxonomyKeys, roles, relations, notes: input.notes?.trim() || null })]);
    invalidateGraphTraversalCache();
    return loadEntitySemanticProfile(db, entity.id);
  });
}
