import { pool } from "./postgres.js";

export type SearchMatchHint = {
  matchedFields: string[];
  relevanceScore: number;
  explanation: string;
};

function normalizeSearchText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

export function buildSearchMatchHint(
  query: string,
  fields: Record<string, unknown>,
  fieldWeights: Record<string, number>,
): SearchMatchHint {
  const term = query.trim().toLowerCase();
  const matchedFields: string[] = [];
  let relevanceScore = 0;

  for (const [fieldName, value] of Object.entries(fields)) {
    const normalizedValue = normalizeSearchText(value);
    if (!normalizedValue) continue;

    if (normalizedValue === term) {
      matchedFields.push(fieldName);
      relevanceScore += (fieldWeights[fieldName] ?? 1) + 2;
      continue;
    }

    if (normalizedValue.includes(term)) {
      matchedFields.push(fieldName);
      relevanceScore += fieldWeights[fieldName] ?? 1;
    }
  }

  return {
    matchedFields,
    relevanceScore,
    explanation: matchedFields.length
      ? `Matched fields: ${matchedFields.join(", ")}`
      : "Matched through keyword search",
  };
}

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
          coalesce((
            select string_agg(alias, ' | ' order by created_at asc)
            from entity_aliases a
            where a.entity_id = e.id
          ), '') as aliases,
          coalesce((
            select string_agg(array_to_string(category_path, ' / '), ' | ' order by created_at asc)
            from entity_aliases a
            where a.entity_id = e.id
          ), '') as "categoryPaths",
          metadata,
          e.created_at as "createdAt",
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
           or exists (
             select 1
             from entity_aliases a
             where a.entity_id = e.id
               and (
                 lower(a.alias) like $1
                 or lower(a.normalized_alias) like $1
                 or lower(coalesce(array_to_string(a.category_path, ' / '), '')) like $1
               )
           )
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

  const eventResults = events.rows
    .map((row: (typeof events.rows)[number]) => ({
      ...row,
      matchHint: buildSearchMatchHint(query, row, {
        title: 5,
        body: 4,
        source: 2,
        kind: 2,
      }),
    }))
    .sort((left, right) => {
      if (right.matchHint.relevanceScore !== left.matchHint.relevanceScore) {
        return right.matchHint.relevanceScore - left.matchHint.relevanceScore;
      }

      return String(right.rawEventCreatedAt).localeCompare(String(left.rawEventCreatedAt));
    });

  const entityDeduped = new Map<string, (typeof entities.rows)[number] & { matchHint: SearchMatchHint }>();
  for (const row of entities.rows) {
    const key = row.canonicalEntityId ?? row.id;
    if (!entityDeduped.has(key)) {
      entityDeduped.set(key, {
        ...row,
        matchHint: buildSearchMatchHint(query, row, {
          value: 5,
          normalizedValue: 4,
          aliases: 4,
          categoryPaths: 2,
          type: 1,
        }),
      });
    }
  }

  const entityResults = Array.from(entityDeduped.values()).sort((left, right) => {
    if (right.matchHint.relevanceScore !== left.matchHint.relevanceScore) {
      return right.matchHint.relevanceScore - left.matchHint.relevanceScore;
    }

    return String(right.createdAt).localeCompare(String(left.createdAt));
  });

  const relationResults = relations.rows
    .map((row: (typeof relations.rows)[number]) => ({
      ...row,
      matchHint: buildSearchMatchHint(query, row, {
        relationType: 3,
        label: 4,
        description: 5,
      }),
    }))
    .sort((left, right) => {
      if (right.matchHint.relevanceScore !== left.matchHint.relevanceScore) {
        return right.matchHint.relevanceScore - left.matchHint.relevanceScore;
      }

      return String(right.createdAt).localeCompare(String(left.createdAt));
    });

  return {
    query,
    searchHints: {
      eventFields: ["title", "body", "source", "kind"],
      entityFields: ["value", "normalizedValue", "aliases", "categoryPaths", "type"],
      relationFields: ["relationType", "label", "description"],
    },
    events: eventResults,
    entities: entityResults,
    relations: relationResults,
  };
}
