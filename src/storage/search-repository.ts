import { pool } from "./postgres.js";

export async function searchKnowledge(query: string) {
  const term = `%${query.trim().toLowerCase()}%`;

  const [events, entities, relations] = await Promise.all([
    pool.query(
      `
        select
          r.id,
          r.source,
          r.kind,
          r.title,
          r.body,
          r.timestamp,
          r.external_id as "externalId",
          r.tags,
          c.inferred_kind as "inferredKind",
          c.confidence,
          r.created_at as "rawEventCreatedAt"
        from raw_events r
        left join classified_events c on c.raw_event_id = r.id
        where lower(coalesce(r.title, '')) like $1
           or lower(coalesce(r.body, '')) like $1
           or lower(coalesce(r.source, '')) like $1
           or lower(coalesce(r.kind, '')) like $1
        order by r.created_at desc
        limit 20
      `,
      [term],
    ),
    pool.query(
      `
        select
          id,
          type,
          value,
          normalized_value as "normalizedValue",
          metadata,
          created_at as "createdAt"
        from entities
        where lower(type) like $1
           or lower(value) like $1
           or lower(normalized_value) like $1
        order by created_at desc
        limit 20
      `,
      [term],
    ),
    pool.query(
      `
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
        where lower(relation_type) like $1
           or lower(label) like $1
           or lower(description) like $1
        order by created_at desc
        limit 20
      `,
      [term],
    ),
  ]);

  return {
    events: events.rows,
    entities: entities.rows,
    relations: relations.rows,
  };
}
