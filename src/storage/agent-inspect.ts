import { listEntities } from "./entity-repository.js";
import { getEntityGraph } from "./graph-repository.js";
import { searchKnowledge } from "./search-repository.js";
import { pool } from "./postgres.js";
import { generateNaturalLanguageSummary } from "./deepseek.js";
import {
  loadOwnerSourcePolicies,
  sourcePolicyAllowsEgress,
  stillAuthorized,
  type PrivacyAuthorization,
} from "./privacy.js";

type InspectLineageEvent = { id: string; source: string | null; ownerId: string | null };

export type InspectEntityLineage = {
  events: InspectLineageEvent[];
  /** Entities whose linked events are all present and eligible for this owner. */
  eligibleEntityIds: string[];
  /** Entities with no lineage, foreign lineage, or ineligible evidence. */
  blockedEntityIds: string[];
  /** True when no eligible entity/evidence exists at all. */
  ambiguous: boolean;
};

/**
 * Resolve the event/source lineage that supports an entity and the entities in
 * its graph. External synthesis is only allowed when every linked event belongs
 * to the requesting owner and is eligible for processing. Lineage is per
 * entity so a graph neighbour without evidence can be omitted instead of
 * inheriting the root's permission. An entity with no event lineage (for
 * example a manually-created or global row) is blocked: there is no evidence
 * set to intersect, so its description must not be dispatched.
 */
export async function loadInspectEntityLineage(input: {
  entityIds: string[];
  ownerId: string | null;
}): Promise<InspectEntityLineage> {
  const entityIds = [...new Set(input.entityIds.filter(Boolean))];
  if (!entityIds.length) return { events: [], eligibleEntityIds: [], blockedEntityIds: [], ambiguous: true };
  const result = await pool.query<InspectLineageEvent & {
    entityId: string;
    privacyStatus: string;
    processingAllowed: boolean;
  }>(`
    with lineage as (
      select link.entity_id, link.event_id
      from event_entities link
      where link.entity_id = any($1::text[])
      union
      select relation.source_entity_id as entity_id, link.event_id
      from event_relations link
      join relations relation on relation.id = link.relation_id
      where relation.source_entity_id = any($1::text[])
      union
      select relation.target_entity_id as entity_id, link.event_id
      from event_relations link
      join relations relation on relation.id = link.relation_id
      where relation.target_entity_id = any($1::text[])
    )
    select distinct lineage.entity_id as "entityId", event.id, event.source,
      coalesce(event.owner_id, event.client_id) as "ownerId",
      event.privacy_status as "privacyStatus",
      event.processing_allowed as "processingAllowed"
    from lineage
    join raw_events event on event.id = lineage.event_id
    order by lineage.entity_id, event.id
  `, [entityIds]);

  const eventsById = new Map<string, InspectLineageEvent>();
  const eligibility = new Map<string, boolean>();
  const entityEventIds = new Map<string, Set<string>>();
  // Source policy is applied per linked event, so a neighbour whose evidence
  // comes from a denied source is excluded instead of poisoning the whole
  // request. Missing policy rows are denials, mirroring authorizeModelDispatch.
  const policies = await loadOwnerSourcePolicies(pool, {
    ownerId: input.ownerId,
    sources: result.rows
      .map((row) => row.source)
      .filter((source): source is string => Boolean(source)),
  });
  for (const row of result.rows) {
    eventsById.set(row.id, { id: row.id, source: row.source, ownerId: row.ownerId });
    const eligible = Boolean(row.ownerId)
      && row.ownerId === input.ownerId
      && row.privacyStatus === "standard"
      && row.processingAllowed
      && sourcePolicyAllowsEgress(
        row.source ? policies.get(row.source.toLowerCase()) : undefined,
      );
    // Conservative: one ineligible linked event blocks that entity entirely.
    eligibility.set(row.entityId, (eligibility.get(row.entityId) ?? true) && eligible);
    const linked = entityEventIds.get(row.entityId) ?? new Set<string>();
    linked.add(row.id);
    entityEventIds.set(row.entityId, linked);
  }
  const eligibleEntityIds: string[] = [];
  const blockedEntityIds: string[] = [];
  for (const entityId of entityIds) {
    const hasEvents = (entityEventIds.get(entityId)?.size ?? 0) > 0;
    const eligible = hasEvents && eligibility.get(entityId) === true;
    if (eligible) eligibleEntityIds.push(entityId);
    else blockedEntityIds.push(entityId);
  }
  const eligibleEventIds = new Set(
    eligibleEntityIds.flatMap((entityId) => [...(entityEventIds.get(entityId) ?? [])]),
  );
  const events = [...eventsById.values()].filter((event) => eligibleEventIds.has(event.id));
  return {
    events,
    eligibleEntityIds,
    blockedEntityIds,
    ambiguous: !eligibleEntityIds.length,
  };
}

type ExternalGraph = NonNullable<Awaited<ReturnType<typeof getEntityGraph>>>;

/**
 * Remove nodes that are not individually authorized (and any relation or path
 * that references them) from the payload sent to an external model.
 */
export function restrictGraphForExternalDispatch(
  graph: ExternalGraph | null,
  allowedEntityIds: Iterable<string>,
) {
  if (!graph) return graph;
  const allowed = new Set(allowedEntityIds);
  allowed.add(graph.rootEntity.id);
  const nodes = graph.nodes.filter((node) => allowed.has(node.id));
  const nodeIds = new Set([graph.rootEntity.id, ...nodes.map((node) => node.id)]);
  return {
    ...graph,
    nodes,
    relations: graph.relations.filter(
      (relation) => nodeIds.has(relation.sourceEntityId) && nodeIds.has(relation.targetEntityId),
    ),
    paths: graph.paths.filter((path) => path.nodeIds.every((id) => nodeIds.has(id))),
  };
}

type InspectDeps = {
  listEntities: typeof listEntities;
  getEntityGraph: typeof getEntityGraph;
  searchKnowledge: typeof searchKnowledge;
  generateNaturalLanguageSummary: typeof generateNaturalLanguageSummary;
  resolveEntityMatches?: (input: { q?: string; id?: string; ownerId?: string | null }) => Promise<Array<{
    id: string;
    canonicalEntityId: string;
    matchedEntityId?: string | null;
  }>>;
  authorizeDispatch?: (input: {
    ownerId: string | null;
    query: string | null;
    events: Array<{ id: string; source?: string | null }>;
  }) => Promise<PrivacyAuthorization | null>;
  loadEntityLineage?: (input: {
    entityIds: string[];
    ownerId: string | null;
  }) => Promise<InspectEntityLineage>;
  model: string;
  apiKey?: string;
};

export function createInspectKnowledge(deps: InspectDeps) {
  return async function inspectKnowledge(input: {
    id?: string;
    q?: string;
    clientId?: string;
    depth: number;
    maxNodes: number;
    maxRelations: number;
  }) {
    const searchResult = input.q ? await deps.searchKnowledge(input.q, { clientId: input.clientId }) : { events: [], entities: [], relations: [] };
    const allEntities = await deps.listEntities(input.clientId);
    const entityMatches = input.id
      ? allEntities.filter((entity) => entity.id === input.id || entity.canonicalEntityId === input.id)
      : input.q && deps.resolveEntityMatches
        ? await deps.resolveEntityMatches({ q: input.q, ownerId: input.clientId ?? null })
        : searchResult.entities;

    const selectedMatch = entityMatches[0] ?? null;
    const requestedEntityId = input.id ?? null;
    const requestedQuery = input.q ?? null;
    const rootEntityId = selectedMatch ? selectedMatch.canonicalEntityId ?? selectedMatch.id : null;
    const rootEntity = rootEntityId ? allEntities.find((entity) => entity.id === rootEntityId) ?? selectedMatch : null;
    const graph = rootEntity ? await deps.getEntityGraph(rootEntity.id, input.depth, input.maxNodes, input.maxRelations) : null;
    const graphSummary = graph
      ? {
          rootEntityId: graph.rootEntity.id,
          resolvedFromEntityId: graph.resolvedFromEntityId,
          nodesCount: graph.stats.nodesCount,
          relationsCount: graph.stats.relationsCount,
          maxDepthReached: graph.stats.maxDepthReached,
          truncated: graph.stats.truncated,
          depthRequested: graph.depthRequested,
          depthReturned: graph.depthReturned,
          pathCount: graph.paths.length,
        }
      : null;
    const resolution = {
      requestedEntityId,
      requestedQuery,
      matchedEntityId: selectedMatch ? selectedMatch.id : null,
      canonicalEntityId: rootEntity ? rootEntity.id : null,
      mode: !selectedMatch
        ? "not_found"
        : requestedEntityId
          ? selectedMatch.id === requestedEntityId
            ? "exact_id"
            : "canonical_alias"
          : "search_match",
      explanation: !selectedMatch
        ? "No entity match was found for the request."
        : requestedEntityId
          ? selectedMatch.id === requestedEntityId
            ? "The requested id matched a canonical entity directly."
            : "The requested id resolved to a canonical root through merge metadata."
          : "The query matched a canonical entity through textual retrieval.",
    } as const;

    // The search result may resolve an entity without returning any event.
    // Authorize against the entity/graph event lineage as well, because the
    // summary prompt includes the entity description and graph nodes. If the
    // lineage is absent, ambiguous, or cross-owner, no external synthesis is
    // attempted even when the search-level event set is empty.
    const lineageEvents: Array<{ id: string; source?: string | null }> = searchResult.events.map(
      (event: { id: string; source?: string | null }) => ({ id: event.id, source: event.source ?? null }),
    );
    let lineageBlocked = false;
    let allowedEntityIds = new Set<string>();
    if (deps.authorizeDispatch) {
      if (rootEntity && deps.loadEntityLineage) {
        const entityIds = [
          rootEntity.id,
          ...(graph?.nodes.map((node) => node.id) ?? []),
          ...searchResult.entities.map((entity: { id: string; canonicalEntityId?: string | null }) =>
            entity.canonicalEntityId ?? entity.id),
        ];
        const lineage = await deps.loadEntityLineage({ entityIds, ownerId: input.clientId ?? null });
        if (
          lineage.ambiguous
          || !lineage.events.length
          || !lineage.eligibleEntityIds.includes(rootEntity.id)
        ) {
          lineageBlocked = true;
        } else {
          // Only entities with their own eligible lineage may contribute bytes
          // to the external prompt. Unlineaged or denied-source neighbours are
          // omitted below.
          allowedEntityIds = new Set(lineage.eligibleEntityIds);
          const seen = new Set(lineageEvents.map((event) => event.id));
          for (const event of lineage.events) {
            if (seen.has(event.id)) continue;
            seen.add(event.id);
            lineageEvents.push({ id: event.id, source: event.source });
          }
        }
      } else if (!lineageEvents.length) {
        // No entity and no event evidence: a data-bearing purpose has nothing
        // legitimate to authorize, so it must fail closed.
        lineageBlocked = true;
      }
    }
    const externalGraph = deps.authorizeDispatch
      ? restrictGraphForExternalDispatch(graph, allowedEntityIds)
      : graph;
    const externalSearchResult = deps.authorizeDispatch
      ? {
          ...searchResult,
          entities: searchResult.entities.filter((entity: { id: string; canonicalEntityId?: string | null }) =>
            allowedEntityIds.has(entity.canonicalEntityId ?? entity.id)),
        }
      : searchResult;

    const authorization = deps.authorizeDispatch && !lineageBlocked
      ? await deps.authorizeDispatch({
          ownerId: input.clientId ?? null,
          query: input.q ?? null,
          events: lineageEvents,
        })
      : deps.authorizeDispatch
        ? null
        : undefined;

    const summary = deps.authorizeDispatch && !authorization
      ? null
      : await deps.generateNaturalLanguageSummary({
          apiKey: deps.apiKey,
          model: deps.model,
          privacy: authorization,
          systemPrompt:
            "You are a knowledge assistant for a backend-first agent system. Summarize only the provided structured data. Be concise, factual, and useful for retrieval. Do not invent facts.",
          userPrompt: JSON.stringify(
            {
              query: requestedQuery ?? requestedEntityId,
              resolution,
              rootEntity,
              graph: externalGraph,
              graphSummary,
              searchResult: externalSearchResult,
            },
            null,
            2,
          ),
        });

    const publishableSummary = authorization
      ? (await stillAuthorized(authorization) ? summary : null)
      : summary;

    return {
      query: requestedQuery ?? requestedEntityId,
      resolution,
      rootEntity,
      graph,
      graphSummary,
      searchResult,
      summary: publishableSummary,
      model: deps.apiKey ? deps.model : null,
      summaryAvailable: Boolean(publishableSummary),
    };
  };
}

export const inspectKnowledge = createInspectKnowledge({
  listEntities,
  getEntityGraph,
  searchKnowledge,
  generateNaturalLanguageSummary,
  resolveEntityMatches: async (input) => {
    const { resolveEntityMatches } = await import("./entity-repository.js");
    const { pool } = await import("./postgres.js");
    return resolveEntityMatches(pool, input);
  },
  loadEntityLineage: loadInspectEntityLineage,
  authorizeDispatch: async (input) => {
    const { authorizeModelDispatch } = await import("./privacy.js");
    const { pool } = await import("./postgres.js");
    const decision = await authorizeModelDispatch(pool, {
      ownerId: input.ownerId,
      purpose: "agent_inspect",
      sources: input.events.map((event) => event.source),
      eventIds: input.events.map((event) => event.id),
    });
    return decision.allowed ? decision : null;
  },
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
});
