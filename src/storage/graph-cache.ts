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

/**
 * Deletion path: drop every cached traversal rooted at one of the removed or
 * hidden entities. Cache entries contain derived node/relation text, so they
 * must not survive a tombstone even for the short TTL.
 */
export function invalidateGraphTraversalCacheForEntities(entityIds: readonly string[]) {
  const roots = new Set(entityIds.filter(Boolean));
  if (!roots.size) return;
  for (const key of [...graphTraversalCache.keys()]) {
    const root = key.split(":", 1)[0]!;
    if (roots.has(root)) graphTraversalCache.delete(key);
  }
}
