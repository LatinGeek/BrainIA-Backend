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

export async function listRelations(ownerId?: string) {
  const params: string[] = [];
  const conditions = [
    `source.visibility <> 'hidden'`,
    `target.visibility <> 'hidden'`,
    `not exists (
      select 1 from deletion_tombstones tombstone
      where tombstone.target_type = 'relation' and tombstone.target_id = relation.id
    )`,
    `not exists (
      select 1 from deletion_tombstones tombstone
      where tombstone.target_type = 'entity'
        and tombstone.target_id in (relation.source_entity_id, relation.target_entity_id)
    )`,
    `(
      not exists (select 1 from event_relations link where link.relation_id = relation.id)
      or exists (
        select 1 from event_relations link
        join raw_events event on event.id = link.event_id
        where link.relation_id = relation.id
          and event.privacy_status <> 'hidden'
          and event.processing_allowed
          and not exists (
            select 1 from deletion_tombstones tombstone
            where tombstone.target_type = 'event' and tombstone.target_id = event.id
          )
      )
    )`,
  ];
  if (ownerId) {
    params.push(ownerId);
    conditions.push(`(
      relation.owner_id = $1
      or (
        relation.owner_id is null
        and source.type in ('domain','concept')
        and target.type in ('domain','concept')
      )
    )`);
  }
  const result = await pool.query(`
    select
      relation.id,
      relation.source_entity_id as "sourceEntityId",
      relation.target_entity_id as "targetEntityId",
      relation.relation_type as "relationType",
      relation.label,
      relation.description,
      relation.confidence,
      relation.metadata,
      relation.created_at as "createdAt"
    from relations relation
    join entities source on source.id = relation.source_entity_id
    join entities target on target.id = relation.target_entity_id
    where ${conditions.join("\n      and ")}
    order by relation.created_at asc
  `, params);

  return result.rows;
}
