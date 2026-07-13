import type { EntityGraph } from "./graph-repository.js";

type CachedGraphTraversal = {
  expiresAt: number;
  graph: EntityGraph;
};

const GRAPH_TRAVERSAL_CACHE_TTL_MS = 30_000;
const graphTraversalCache = new Map<string, CachedGraphTraversal>();

export function buildGraphTraversalCacheKey(
  rootEntityId: string,
  depth: number,
  maxNodes: number,
  maxRelations: number,
) {
  return [rootEntityId, depth, maxNodes, maxRelations].join(":");
}

export function readGraphTraversalCache(cacheKey: string): EntityGraph | null {
  const cached = graphTraversalCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    graphTraversalCache.delete(cacheKey);
    return null;
  }

  return cached.graph;
}

export function writeGraphTraversalCache(cacheKey: string, graph: EntityGraph) {
  graphTraversalCache.set(cacheKey, {
    expiresAt: Date.now() + GRAPH_TRAVERSAL_CACHE_TTL_MS,
    graph,
  });
}

export function invalidateGraphTraversalCache() {
  graphTraversalCache.clear();
}
