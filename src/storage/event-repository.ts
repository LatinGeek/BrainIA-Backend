import { randomUUID } from "node:crypto";
import { pool } from "./postgres.js";
import { buildEntityDrafts } from "../domain/entities.js";
import { buildRelationDrafts } from "../domain/relations.js";
import { upsertEntity } from "./entity-repository.js";
import { linkEventRelation, upsertRelation } from "./relation-repository.js";
import type { ClassifiedEvent, EventInput } from "../domain/event.js";

export type StoredEventRecord = EventInput & ClassifiedEvent & {
  rawEventCreatedAt: string;
  classifiedEventCreatedAt: string;
};

export async function insertSplitEvent(event: ClassifiedEvent) {
  await pool.query("begin");

  try {
    const rawResult = await pool.query(
      `
        insert into raw_events (
          id,
          source,
          kind,
          title,
          body,
          timestamp,
          external_id,
          raw,
          tags
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::text[]
        )
        returning
          id,
          source,
          kind,
          title,
          body,
          timestamp,
          external_id as "externalId",
          raw,
          tags,
          created_at as "rawEventCreatedAt"
      `,
      [
        event.id,
        event.source,
        event.kind,
        event.title ?? null,
        event.body ?? null,
        event.timestamp ?? null,
        event.externalId ?? null,
        JSON.stringify(event.raw ?? {}),
        event.tags ?? [],
      ],
    );

    const classifiedResult = await pool.query(
      `
        insert into classified_events (
          id,
          raw_event_id,
          inferred_kind,
          confidence,
          entities
        ) values (
          $1, $2, $3, $4, $5::jsonb
        )
        returning
          id,
          raw_event_id as "rawEventId",
          inferred_kind as "inferredKind",
          confidence,
          entities,
          created_at as "classifiedEventCreatedAt"
      `,
      [
        event.id,
        event.id,
        event.inferredKind,
        event.confidence,
        JSON.stringify(event.entities ?? []),
      ],
    );

    const entityDrafts = buildEntityDrafts(event);
    const entityRecords = [];
    for (const draft of entityDrafts) {
      const entity = await upsertEntity(draft);
      entityRecords.push(entity);
      await pool.query(
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
        [randomUUID(), event.id, entity.id, "mentioned", 0.8],
      );
    }

    const relationDrafts = buildRelationDrafts({
      title: event.title,
      body: event.body,
      inferredKind: event.inferredKind,
      entities: entityDrafts,
    });
    const relationRecords = [];
    for (const draft of relationDrafts) {
      const sourceEntity = await upsertEntity(draft.sourceEntity);
      const targetEntity = await upsertEntity(draft.targetEntity);
      const relation = await upsertRelation(draft, sourceEntity.id, targetEntity.id);
      relationRecords.push(relation);
      await linkEventRelation(event.id, relation.id, draft.confidence);
    }

    await pool.query("commit");

    return {
      ...rawResult.rows[0],
      ...classifiedResult.rows[0],
      entities: entityRecords,
      relations: relationRecords,
    } as StoredEventRecord;
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }
}

export async function listStoredEvents() {
  const result = await pool.query(
    `
      select
        r.id,
        r.source,
        r.kind,
        r.title,
        r.body,
        r.timestamp,
        r.external_id as "externalId",
        r.raw,
        r.tags,
      c.inferred_kind as "inferredKind",
      c.confidence,
      c.entities as "classifiedEntities",
      coalesce(
        json_agg(
          json_build_object(
            'id', e.id,
            'type', e.type,
            'value', e.value,
            'normalizedValue', e.normalized_value
          )
        ) filter (where e.id is not null),
        '[]'::json
      ) as entities,
      r.created_at as "rawEventCreatedAt",
      c.created_at as "classifiedEventCreatedAt"
    from raw_events r
    left join classified_events c on c.raw_event_id = r.id
    left join event_entities ee on ee.event_id = r.id
    left join entities e on e.id = ee.entity_id
    group by r.id, c.id
    order by r.created_at asc
  `,
  );

  return result.rows as StoredEventRecord[];
}
