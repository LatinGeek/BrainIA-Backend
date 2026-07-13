import { listEntities } from "./entity-repository.js";
import { getEntityGraph } from "./graph-repository.js";
import { searchKnowledge } from "./search-repository.js";
import { generateNaturalLanguageSummary } from "./deepseek.js";

type InspectDeps = {
  listEntities: typeof listEntities;
  getEntityGraph: typeof getEntityGraph;
  searchKnowledge: typeof searchKnowledge;
  generateNaturalLanguageSummary: typeof generateNaturalLanguageSummary;
  resolveEntityMatches?: (input: { q?: string; id?: string }) => Promise<Array<{
    id: string;
    canonicalEntityId: string;
    matchedEntityId?: string | null;
  }>>;
  model: string;
  apiKey?: string;
};

export function createInspectKnowledge(deps: InspectDeps) {
  return async function inspectKnowledge(input: {
    id?: string;
    q?: string;
    depth: number;
    maxNodes: number;
    maxRelations: number;
  }) {
    const searchResult = input.q ? await deps.searchKnowledge(input.q) : { events: [], entities: [], relations: [] };
    const allEntities = await deps.listEntities();
    const entityMatches = input.id
      ? allEntities.filter((entity) => entity.id === input.id || entity.canonicalEntityId === input.id)
      : input.q && deps.resolveEntityMatches
        ? await deps.resolveEntityMatches({ q: input.q })
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

    const summary = await deps.generateNaturalLanguageSummary({
      apiKey: deps.apiKey,
      model: deps.model,
      systemPrompt:
        "You are a knowledge assistant for a backend-first agent system. Summarize only the provided structured data. Be concise, factual, and useful for retrieval. Do not invent facts.",
      userPrompt: JSON.stringify(
        {
          query: requestedQuery ?? requestedEntityId,
          resolution,
          rootEntity,
          graph,
          graphSummary,
          searchResult,
        },
        null,
        2,
      ),
    });

    return {
      query: requestedQuery ?? requestedEntityId,
      resolution,
      rootEntity,
      graph,
      graphSummary,
      searchResult,
      summary,
      model: deps.apiKey ? deps.model : null,
      summaryAvailable: Boolean(summary),
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
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
});
