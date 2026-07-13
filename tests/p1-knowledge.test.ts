import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

type QueryResult<T> = {
  rows: T[];
  rowCount: number;
};

type Queryable = {
  query: <T>(sql: string, params?: readonly unknown[]) => Promise<QueryResult<T>>;
};

function createQueuedDb(responses: Array<QueryResult<any>>): Queryable {
  let index = 0;
  return {
    async query<T>() {
      const response = responses[index++];
      if (!response) {
        throw new Error(`Unexpected query at index ${index}`);
      }
      return response as QueryResult<T>;
    },
  };
}

const { mergeEntities, resolveEntityMatches, upsertEntity } = await import("../src/storage/entity-repository.ts");
const { buildGraphTraversalCacheKey, invalidateGraphTraversalCache, readGraphTraversalCache, writeGraphTraversalCache } = await import("../src/storage/graph-cache.ts");
const { buildEventSearchQuery } = await import("../src/storage/search-repository.ts");
const { buildGraphTraversalPaths } = await import("../src/storage/graph-repository.ts");
const { buildKnowledgeInsight } = await import("../src/storage/insights.ts");

test("upsert entity returns the canonical root when the row is merged", async () => {
  const db = createQueuedDb([
    { rows: [{ id: "entity_2" }], rowCount: 1 },
    {
      rows: [
        {
          id: "entity_2",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: false,
          aliasCount: 0,
          mergeReason: "manual_merge",
          mergeConfidence: 1,
        },
      ],
      rowCount: 1,
    },
    {
      rows: [
        {
          id: "entity_1",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: true,
          aliasCount: 1,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 1,
    },
  ]);

  const entity = await upsertEntity(db, {
    type: "merchant",
    value: "Spotify",
    normalizedValue: "spotify",
    metadata: {
      source: "heuristic",
    },
  });

  assert.equal(entity.id, "entity_1");
  assert.equal(entity.canonicalEntityId, "entity_1");
  assert.equal(entity.isCanonical, true);
});

test("resolve entity matches deduplicates aliases into the canonical root", async () => {
  const db = createQueuedDb([
    {
      rows: [
        {
          id: "entity_2",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: false,
          aliasCount: 0,
          mergeReason: "manual_merge",
          mergeConfidence: 1,
        },
        {
          id: "entity_1",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: true,
          aliasCount: 1,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 2,
    },
    {
      rows: [
        {
          id: "entity_1",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: true,
          aliasCount: 1,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 1,
    },
  ]);

  const matches = await resolveEntityMatches(db, { q: "spotify" });

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.id, "entity_1");
  assert.equal(matches[0]?.matchedEntityId, "entity_2");
  assert.equal(matches[0]?.isCanonical, true);
});

test("merge entities materializes same_as provenance and keeps canonical roots deterministic", async () => {
  const db = createQueuedDb([
    {
      rows: [
        {
          id: "entity_4",
          type: "merchant",
          value: "Spotify Inc.",
          normalizedValue: "spotify inc",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_4",
          isCanonical: true,
          aliasCount: 0,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 1,
    },
    {
      rows: [
        {
          id: "entity_1",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: true,
          aliasCount: 0,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 1,
    },
    {
      rows: [
        {
          id: "entity_4",
          type: "merchant",
          value: "Spotify Inc.",
          normalizedValue: "spotify inc",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_4",
          isCanonical: true,
          aliasCount: 0,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 1,
    },
    {
      rows: [
        {
          id: "entity_1",
          type: "merchant",
          value: "Spotify",
          normalizedValue: "spotify",
          metadata: {},
          createdAt: "2026-07-13T00:00:00.000Z",
          canonicalEntityId: "entity_1",
          isCanonical: true,
          aliasCount: 0,
          mergeReason: null,
          mergeConfidence: null,
        },
      ],
      rowCount: 1,
    },
    { rows: [], rowCount: 1 },
    {
      rows: [
        {
          id: "relation_1",
          relationType: "same_as",
          label: "es la misma entidad que",
          description: "Spotify Inc. es la misma entidad que Spotify",
          confidence: 1,
        },
      ],
      rowCount: 1,
    },
  ]);

  const merge = await mergeEntities(db, "entity_4", "entity_1", {
    reason: "manual cleanup",
    confidence: 1,
  });

  assert.equal(merge.aliasEntityId, "entity_4");
  assert.equal(merge.canonicalEntityId, "entity_1");
  assert.equal(merge.alreadyMerged, false);
  assert.equal(merge.sameAsRelation?.relationType, "same_as");
});

test("search relevance filters are translated into deterministic query clauses", () => {
  const built = buildEventSearchQuery("spotify", {
    source: "tasker",
    kind: "notification",
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-31T23:59:59.999Z",
  });

  assert.equal(built.eventParams[0], "%spotify%");
  assert.equal(built.eventParams[1], "tasker");
  assert.equal(built.eventParams[2], "notification");
  assert.equal(built.eventParams[3], "2026-07-01T00:00:00.000Z");
  assert.equal(built.eventParams[4], "2026-07-31T23:59:59.999Z");
  assert.match(built.eventWhereClause, /lower\(coalesce\(r\.source, ''\)\) = \$2/);
  assert.match(built.eventWhereClause, /lower\(coalesce\(r\.kind, ''\)\) = \$3/);
  assert.match(built.eventWhereClause, /coalesce\(r\.timestamp, r\.created_at\) >= \$4::timestamptz/);
  assert.match(built.eventWhereClause, /coalesce\(r\.timestamp, r\.created_at\) <= \$5::timestamptz/);
});

test("graph traversal paths include a readable summary and ranking hints", () => {
  const paths = buildGraphTraversalPaths(
    "entity_1",
    [
      { id: "entity_1", type: "merchant", value: "Spotify", normalizedValue: "spotify", metadata: {}, createdAt: "2026-07-13T00:00:00.000Z", depth: 0, rootDistance: 0 },
      { id: "entity_2", type: "amount", value: "$12.40", normalizedValue: "$12.40", metadata: {}, createdAt: "2026-07-13T00:00:00.000Z", depth: 1, rootDistance: 1 },
    ],
    [
      {
        id: "relation_1",
        sourceEntityId: "entity_2",
        targetEntityId: "entity_1",
        relationType: "spent_at",
        label: "se gastó en",
        description: "$12.40 se gastó en Spotify",
        confidence: 0.8,
        importanceScore: 0.4,
        explanation: "$12.40 se gastó en Spotify",
        metadata: {},
        createdAt: "2026-07-13T00:00:00.000Z",
        depth: 1,
        direction: "incoming",
      },
    ],
  );

  assert.equal(paths.length, 1);
  assert.equal(paths[0]?.summary, "$12.40 se gastó en Spotify");
  assert.equal(paths[0]?.direction, "incoming");
  assert.equal(paths[0]?.importanceScore, 0.4);
});

test("graph traversal cache stores and invalidates cached graphs", () => {
  const cacheKey = buildGraphTraversalCacheKey("entity_1", 2, 100, 100);
  const graph = {
    resolvedFromEntityId: null,
    rootEntity: {
      id: "entity_1",
      type: "merchant",
      value: "Spotify",
      normalizedValue: "spotify",
      metadata: {},
      createdAt: "2026-07-13T00:00:00.000Z",
    },
    depthRequested: 2,
    depthReturned: 1,
    stats: {
      nodesCount: 1,
      relationsCount: 0,
      maxDepthReached: 0,
      truncated: false,
    },
    nodes: [],
    relations: [],
    paths: [],
  };

  invalidateGraphTraversalCache();
  writeGraphTraversalCache(cacheKey, graph);
  assert.deepEqual(readGraphTraversalCache(cacheKey), graph);
  invalidateGraphTraversalCache();
  assert.equal(readGraphTraversalCache(cacheKey), null);
});

test("knowledge insights package summaries, takeaways, and supporting evidence", () => {
  const insight = buildKnowledgeInsight({
    query: "spotify",
    resolution: {
      requestedEntityId: null,
      requestedQuery: "spotify",
      matchedEntityId: "entity_1",
      canonicalEntityId: "entity_1",
      mode: "search_match",
      explanation: "The query matched a canonical entity through textual retrieval.",
    },
    summary: "Spotify is a merchant entity linked to expense activity.",
    graphSummary: {
      rootEntityId: "entity_1",
      resolvedFromEntityId: null,
      nodesCount: 2,
      relationsCount: 1,
      maxDepthReached: 1,
      truncated: false,
      depthRequested: 2,
      depthReturned: 1,
      pathCount: 1,
    },
    graph: {
      nodes: [
        { id: "entity_1", value: "Spotify", type: "merchant" },
        { id: "entity_2", value: "$12.40", type: "amount" },
      ],
      relations: [
        {
          id: "relation_1",
          relationType: "spent_at",
          label: "se gastó en",
          description: "$12.40 se gastó en Spotify",
          importanceScore: 0.4,
        },
      ],
    },
  });

  assert.equal(insight.takeaways.length, 2);
  assert.equal(insight.supportingEntities[0]?.value, "Spotify");
  assert.equal(insight.supportingRelations[0]?.relationType, "spent_at");
  assert.equal(insight.graphSummary?.nodesCount, 2);
});
