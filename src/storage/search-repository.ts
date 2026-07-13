import { pool } from "./postgres.js";

export function buildEventSearchQuery(
  query: string,
  filters: {
    source?: string;
    kind?: string;
    from?: string;
    to?: string;
  } = {},
) {
  const term = `%${query.trim().toLowerCase()}%`;

  const eventParams: Array<string> = [term];
  const eventWhereParts = [
    `(
      lower(coalesce(r.title, '')) like $1
      or lower(coalesce(r.body, '')) like $1
      or lower(coalesce(r.source, '')) like $1
      or lower(coalesce(r.kind, '')) like $1
    )`,
  ];

  if (filters.source?.trim()) {
    eventParams.push(filters.source.trim().toLowerCase());
    eventWhereParts.push(`lower(coalesce(r.source, '')) = $${eventParams.length}`);
  }

  if (filters.kind?.trim()) {
    eventParams.push(filters.kind.trim().toLowerCase());
    eventWhereParts.push(`lower(coalesce(r.kind, '')) = $${eventParams.length}`);
  }

  if (filters.from?.trim()) {
    eventParams.push(filters.from.trim());
    eventWhereParts.push(`coalesce(r.timestamp, r.created_at) >= $${eventParams.length}::timestamptz`);
  }

  if (filters.to?.trim()) {
    eventParams.push(filters.to.trim());
    eventWhereParts.push(`coalesce(r.timestamp, r.created_at) <= $${eventParams.length}::timestamptz`);
  }

  return {
    eventParams,
    eventWhereClause: eventWhereParts.join("\n        and "),
  };
}

export async function searchKnowledge(
  query: string,
  filters: {
    source?: string;
    kind?: string;
    from?: string;
    to?: string;
  } = {},
) {
  const { eventParams, eventWhereClause } = buildEventSearchQuery(query, filters);
  const term = eventParams[0];

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
        where ${eventWhereClause}
        order by r.created_at desc
        limit 20
      `,
      eventParams,
    ),
    pool.query(
      `
        select
          id,
          type,
          value,
          normalized_value as "normalizedValue",
          metadata,
          created_at as "createdAt",
          coalesce(em.canonical_entity_id, e.id) as "canonicalEntityId",
          case when em.alias_entity_id is null then true else false end as "isCanonical",
          coalesce((
            select count(*)::integer
            from entity_merges aliases
            where aliases.canonical_entity_id = e.id
          ), 0) as "aliasCount",
          em.reason as "mergeReason"
        from entities e
        left join entity_merges em on em.alias_entity_id = e.id
        where lower(type) like $1
           or lower(value) like $1
           or lower(normalized_value) like $1
        order by e.created_at desc
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

  const entityDeduped = new Map<string, (typeof entities.rows)[number]>();
  for (const row of entities.rows) {
    const key = row.canonicalEntityId ?? row.id;
    if (!entityDeduped.has(key)) {
      entityDeduped.set(key, row);
    }
  }

  return {
    events: events.rows,
    entities: Array.from(entityDeduped.values()),
    relations: relations.rows,
  };
}
