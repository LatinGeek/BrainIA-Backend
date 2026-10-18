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
    clientId?: string;
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
    `r.privacy_status <> 'hidden'`,
    `r.processing_allowed`,
    `not exists (
      select 1 from deletion_tombstones tombstone
      where tombstone.target_type = 'event' and tombstone.target_id = r.id
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

  if (filters.clientId?.trim()) {
    eventParams.push(filters.clientId.trim());
    eventWhereParts.push(`r.client_id = $${eventParams.length}`);
  }

  return {
    eventParams,
    eventWhereClause: eventWhereParts.join("\n        and "),
  };
}

export type DerivedRunReadTable = "insight_runs" | "digest_runs";

/**
 * B11 r3 / R1: read-time eligibility for persisted derived runs.
 *
 * Earlier tombstones only quarantined the runs whose payload text happened to
 * contain the deleted id, so a legacy window digest or an entity-only insight
 * could survive a tombstone (and a restore) and still be served. Rather than
 * backfilling rows, every read path applies this predicate:
 *
 * - a direct `insight`/`digest` tombstone for the run itself makes it ineligible;
 * - a run created at/before an owner tombstone is ineligible, even when its
 *   payload never named the deleted target (conservative r1 upgrade rule);
 * - a digest whose window overlaps the tombstoned event's timestamp is
 *   ineligible;
 * - a run is eligible again only when `revalidated_at` is strictly after the
 *   covering tombstone (explicit revalidation).
 *
 * Runs created after the tombstone must still persist explicit live-event
 * lineage (event id in `evidence`/`request`/`response`), which makes an
 * unlinked summary replay ineligible even if it was written before the r3
 * insert guard existed.
 *
 * The alias must be a trusted identifier (table name or a fixed local alias).
 */
export function derivedRunReadEligibilitySql(table: DerivedRunReadTable, alias: string): string {
  const windowOverlap = table === "digest_runs"
    ? `
          or (
            ${alias}.window_from is not null and ${alias}.window_to is not null
            and exists (
              select 1 from raw_events window_event
              where window_event.id = tombstone.target_id
                and coalesce(window_event.timestamp, window_event.created_at)
                  between ${alias}.window_from and ${alias}.window_to
            )
          )`
    : "";
  // digest_runs has no evidence column; request/response are its lineage store.
  const lineageMatch = table === "digest_runs"
    ? `strpos(coalesce(${alias}.request::text, ''), lineage_event.id) > 0
                or strpos(coalesce(${alias}.response::text, ''), lineage_event.id) > 0`
    : `strpos(coalesce(${alias}.evidence::text, ''), lineage_event.id) > 0
                or strpos(coalesce(${alias}.request::text, ''), lineage_event.id) > 0
                or strpos(coalesce(${alias}.response::text, ''), lineage_event.id) > 0`;
  return `(
        not exists (
          select 1 from deletion_tombstones tombstone
          where tombstone.owner_id = coalesce(${alias}.owner_id, 'anonymous')
            and (
              tombstone.target_id = ${alias}.id
              or ${alias}.created_at <= tombstone.created_at${windowOverlap}
            )
            and (${alias}.revalidated_at is null or ${alias}.revalidated_at <= tombstone.created_at)
        )
        and (
          not exists (
            select 1 from deletion_tombstones owner_tombstone
            where owner_tombstone.owner_id = coalesce(${alias}.owner_id, 'anonymous')
          )
          or exists (
            select 1 from raw_events lineage_event
            where (
              (${alias}.owner_id is not null
                and coalesce(lineage_event.owner_id, lineage_event.client_id) = ${alias}.owner_id)
              or (${alias}.owner_id is null
                and lineage_event.owner_id is null and lineage_event.client_id is null)
            )
              and lineage_event.privacy_status = 'standard'
              and lineage_event.processing_allowed
              and (
                ${lineageMatch}
              )
          )
        )
      )`;
}

type RetrievalResultLike = {
  objectType: string;
  objectId: string;
  eventId: string | null;
};

type RetrievalPackageLike = {
  evidenceId: string;
  sourceEventId: string | null;
};

/**
 * Post-filter for `/retrieval/hybrid`. The hybrid SQL is intentionally broad;
 * this applies the same deletion/visibility eligibility used by the legacy
 * read routes to relation/digest/insight candidates before they leave the API.
 */
export async function filterEligibleRetrievalResults<
  T extends {
    results: RetrievalResultLike[];
    evidencePackage: RetrievalPackageLike[];
  },
>(retrieval: T, clientId?: string | null): Promise<T> {
  const relationIds = retrieval.results
    .filter((result) => result.objectType === "relation")
    .map((result) => result.objectId);
  const runIds = retrieval.results
    .filter((result) => result.objectType === "insight" || result.objectType === "digest")
    .map((result) => result.objectId);
  const [relationRows, eligibleRunRows] = await Promise.all([
    relationIds.length
      ? pool.query<{ id: string; eventId: string | null; hasLinks: boolean }>(`
          select relation.id,
            (
              select event.id
              from event_relations link
              join raw_events event on event.id = link.event_id
              where link.relation_id = relation.id
                and event.privacy_status <> 'hidden'
                and event.processing_allowed
                and not exists (
                  select 1 from deletion_tombstones tombstone
                  where tombstone.target_type = 'event' and tombstone.target_id = event.id
                )
              order by link.event_id
              limit 1
            ) as "eventId",
            exists (select 1 from event_relations link where link.relation_id = relation.id) as "hasLinks"
          from relations relation
          join entities source on source.id = relation.source_entity_id
          join entities target on target.id = relation.target_entity_id
          where relation.id = any($1::text[])
            and source.visibility <> 'hidden'
            and target.visibility <> 'hidden'
            and not exists (
              select 1 from deletion_tombstones tombstone
              where tombstone.target_type = 'relation' and tombstone.target_id = relation.id
            )
            and (
              $2::text is null
              or relation.owner_id = $2
              or (
                relation.owner_id is null
                and source.type in ('domain','concept')
                and target.type in ('domain','concept')
              )
            )
        `, [relationIds, clientId ?? null])
      : Promise.resolve({ rows: [] as Array<{ id: string; eventId: string | null; hasLinks: boolean }> }),
    runIds.length
      ? pool.query<{ id: string }>(`
          select run.id from insight_runs run
          where run.id = any($1::text[]) and (run.summary is not null or run.query is not null)
            and ${derivedRunReadEligibilitySql("insight_runs", "run")}
          union all
          select run.id from digest_runs run
          where run.id = any($1::text[]) and run.summary is not null
            and ${derivedRunReadEligibilitySql("digest_runs", "run")}
        `, [runIds])
      : Promise.resolve({ rows: [] as Array<{ id: string }> }),
  ]);
  const relations = new Map(relationRows.rows.map((row) => [row.id, row]));
  const eligibleRuns = new Set(eligibleRunRows.rows.map((row) => row.id));
  const results = retrieval.results.flatMap((result) => {
    if (result.objectType === "relation") {
      const relation = relations.get(result.objectId);
      if (!relation || (relation.hasLinks && !relation.eventId)) return [];
      return [{ ...result, eventId: relation.eventId }];
    }
    if (result.objectType === "insight" || result.objectType === "digest") {
      return eligibleRuns.has(result.objectId) ? [result] : [];
    }
    return [result];
  });
  const resultById = new Map(results.map((result) => [`${result.objectType}:${result.objectId}`, result]));
  return {
    ...retrieval,
    results,
    evidencePackage: retrieval.evidencePackage.flatMap((item) => {
      const result = resultById.get(item.evidenceId);
      return result ? [{ ...item, sourceEventId: result.eventId }] : [];
    }),
  };
}

export async function searchKnowledge(
  query: string,
  filters: {
    source?: string;
    kind?: string;
    from?: string;
    to?: string;
    clientId?: string;
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
        where (lower(type) like $1
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
           ))
          and ($2::text is null or e.owner_id = $2 or (e.owner_id is null and e.type in ('domain', 'concept')))
          and e.visibility <> 'hidden'
          and not exists (
            select 1 from deletion_tombstones tombstone
            where tombstone.target_type = 'entity' and tombstone.target_id = e.id
          )
        order by e.created_at desc
        limit 20
      `,
      [term, filters.clientId?.trim() ?? null],
    ),
    pool.query(
      `
        select
          r.id,
          r.source_entity_id as "sourceEntityId",
          r.target_entity_id as "targetEntityId",
          r.relation_type as "relationType",
          r.label,
          r.description,
          r.confidence,
          r.metadata,
          r.created_at as "createdAt"
        from relations r
        join entities source on source.id = r.source_entity_id
        join entities target on target.id = r.target_entity_id
        where (lower(r.relation_type) like $1
           or lower(r.label) like $1
           or lower(r.description) like $1)
          and (
            $2::text is null
            or r.owner_id = $2
            or (r.owner_id is null and source.type in ('domain', 'concept') and target.type in ('domain', 'concept'))
          )
          and source.visibility <> 'hidden'
          and target.visibility <> 'hidden'
          and not exists (
            select 1 from deletion_tombstones tombstone
            where tombstone.target_type = 'relation' and tombstone.target_id = r.id
          )
          and (
            not exists (select 1 from event_relations link where link.relation_id = r.id)
            or exists (
              select 1 from event_relations link
              join raw_events event on event.id = link.event_id
              where link.relation_id = r.id
                and event.privacy_status <> 'hidden'
                and event.processing_allowed
                and not exists (
                  select 1 from deletion_tombstones tombstone
                  where tombstone.target_type = 'event' and tombstone.target_id = event.id
                )
            )
          )
        order by r.created_at desc
        limit 20
      `,
      [term, filters.clientId?.trim() ?? null],
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
