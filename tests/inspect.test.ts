import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

const { createInspectKnowledge } = await import("../src/storage/agent-inspect.ts");

test("inspect knowledge resolves, expands and summarizes using injected dependencies", async () => {
  const inspect = createInspectKnowledge({
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    listEntities: async () => [
      { id: "entity_1", type: "merchant", value: "Spotify", normalizedValue: "spotify" },
    ],
    getEntityGraph: async (id) => ({
      rootEntity: { id, type: "merchant", value: "Spotify", normalizedValue: "spotify", metadata: {}, createdAt: "2026-07-13T00:00:00.000Z" },
      depthRequested: 2,
      depthReturned: 2,
      stats: { nodesCount: 1, relationsCount: 0, maxDepthReached: 0, truncated: false },
      nodes: [],
      relations: [],
      paths: [],
    }),
    searchKnowledge: async () => ({
      events: [],
      entities: [{ id: "entity_1", type: "merchant", value: "Spotify", normalizedValue: "spotify", metadata: {}, createdAt: "2026-07-13T00:00:00.000Z" }],
      relations: [],
    }),
    generateNaturalLanguageSummary: async () => "Spotify is a merchant entity linked to the query.",
  });

  const result = await inspect({
    q: "spotify",
    depth: 2,
    maxNodes: 100,
    maxRelations: 100,
  });

  assert.equal(result.summaryAvailable, true);
  assert.equal(result.model, "deepseek-v4-flash");
  assert.equal(result.rootEntity?.value, "Spotify");
  assert.equal(result.resolution.mode, "search_match");
  assert.equal(result.resolution.canonicalEntityId, "entity_1");
  assert.equal(result.graphSummary?.rootEntityId, "entity_1");
  assert.equal(result.summary, "Spotify is a merchant entity linked to the query.");
});
