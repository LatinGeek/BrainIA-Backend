import { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";
import { normalizeRelationType, type RelationDraft } from "../domain/relations.js";

type Queryable = Pick<typeof pool, "query">;

type StoredRelation = {
  id: string;
  relationType: string;
  label: string;
  description: string;
};

export async function upsertRelation(
  db: Queryable,
  draft: RelationDraft,
  sourceEntityId: string,
  targetEntityId: string,
): Promise<StoredRelation> {
  const normalized = normalizeRelationType(draft.relationType, draft.label);
  const result = await db.query<StoredRelation>(
    `
      insert into relations (
        id,
        source_entity_id,
        target_entity_id,
        relation_type,
        label,
        description,
        confidence,
        metadata
      ) values (
        next_sequence_value('relation'),
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::jsonb
      )
      on conflict (source_entity_id, target_entity_id, relation_type)
      do update set
        label = excluded.label,
        description = excluded.description,
        confidence = excluded.confidence,
        metadata = relations.metadata || excluded.metadata
      returning
        id,
        relation_type as "relationType",
        label,
        description,
        confidence
    `,
    [
      sourceEntityId,
      targetEntityId,
      normalized.relationType,
      normalized.label,
      draft.description,
      draft.confidence,
      JSON.stringify(draft.metadata ?? {}),
    ],
  );

  return result.rows[0];
}

export async function linkEventRelation(
  db: Queryable,
  eventId: string,
  relationId: string,
  confidence: number,
) {
  await db.query(
    `
      insert into event_relations (
        id,
        event_id,
        relation_id,
        role,
        confidence
      ) values (
        $1, $2, $3, $4, $5
      )
      on conflict (event_id, relation_id)
      do update set confidence = excluded.confidence
    `,
    [randomUUID(), eventId, relationId, "implied", confidence],
  );
}

export async function listRelations() {
  const result = await pool.query(`
    select
      id,
      source_entity_id as "sourceEntityId",
      target_entity_id as "targetEntityId",
      relation_type as "relationType",
      label,
      description,
      confidence,
      metadata,
      created_at as "createdAt"
    from relations
    order by created_at asc
  `);

  return result.rows;
}
