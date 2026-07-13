import { listEntities } from "./entity-repository.js";
import { getEntityGraph } from "./graph-repository.js";
import { searchKnowledge } from "./search-repository.js";
import { generateNaturalLanguageSummary } from "./deepseek.js";

type InspectDeps = {
  listEntities: typeof listEntities;
  getEntityGraph: typeof getEntityGraph;
  searchKnowledge: typeof searchKnowledge;
  generateNaturalLanguageSummary: typeof generateNaturalLanguageSummary;
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
      : searchResult.entities;

    const selectedMatch = entityMatches[0] ?? null;
    const rootEntityId = selectedMatch ? selectedMatch.canonicalEntityId ?? selectedMatch.id : null;
    const rootEntity = rootEntityId ? allEntities.find((entity) => entity.id === rootEntityId) ?? selectedMatch : null;
    const graph = rootEntity ? await deps.getEntityGraph(rootEntity.id, input.depth, input.maxNodes, input.maxRelations) : null;

    const summary = await deps.generateNaturalLanguageSummary({
      apiKey: deps.apiKey,
      model: deps.model,
      systemPrompt:
        "You are a knowledge assistant for a backend-first agent system. Summarize only the provided structured data. Be concise, factual, and useful for retrieval. Do not invent facts.",
      userPrompt: JSON.stringify(
        {
          query: input.q ?? input.id ?? null,
          resolvedFromEntityId: selectedMatch ? selectedMatch.id : null,
          rootEntity,
          graph,
          searchResult,
        },
        null,
        2,
      ),
    });

    return {
      query: input.q ?? input.id ?? null,
      resolvedFromEntityId: selectedMatch ? selectedMatch.id : null,
      rootEntity,
      graph,
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
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
});
