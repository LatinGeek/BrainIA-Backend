import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

const { classifyEvent } = await import("../src/domain/classification.ts");
const { buildEntityDrafts } = await import("../src/domain/entities.ts");
const { buildRelationDrafts } = await import("../src/domain/relations.ts");
const { parseGraphOptions } = await import("../src/storage/graph-repository.ts");
const { createClassificationAssistant } = await import("../src/storage/classification-assistant.ts");
const { buildSearchMatchHint } = await import("../src/storage/search-repository.ts");
const { buildKnowledgeDigest } = await import("../src/storage/digests.ts");

test("classification extracts expense signals", () => {
  const classified = classifyEvent({
    id: "evt_1",
    source: "tasker",
    kind: "notification",
    title: "Compra en supermercado",
    body: "Visa $12.40",
    raw: {},
    tags: [],
  });

  assert.equal(classified.inferredKind, "expense");
  assert.ok(classified.entities.some((entity) => entity.type === "amount"));
});

test("entity drafts include expense and merchant heuristics", () => {
  const drafts = buildEntityDrafts({
    title: "Compra en Spotify",
    body: "pagado con tarjeta",
    inferredKind: "expense",
    entities: [{ type: "amount", value: "$12.40" }],
  });

  assert.ok(drafts.some((draft) => draft.type === "amount"));
  assert.ok(drafts.some((draft) => draft.type === "merchant"));
});

test("entity drafts discard noisy merchants and dedupe repeated drafts", () => {
  const drafts = buildEntityDrafts({
    title: "Compra",
    body: "Compra",
    inferredKind: "expense",
    entities: [
      { type: "merchant", value: "Spotify" },
      { type: "merchant", value: "Spotify" },
    ],
  });

  assert.equal(drafts.filter((draft) => draft.type === "merchant").length, 1);
  assert.equal(drafts.some((draft) => draft.type === "merchant" && draft.value === "Compra"), false);
});

test("relation drafts include readable relation text", () => {
  const drafts = buildRelationDrafts({
    title: "Compra en Spotify",
    body: "pagado con tarjeta",
    inferredKind: "expense",
    entities: [
      { type: "amount", value: "$12.40", normalizedValue: "$12.40" },
      { type: "merchant", value: "Spotify", normalizedValue: "spotify" },
    ],
  });

  assert.ok(drafts.length > 0);
  assert.equal(drafts[0]?.label.includes("gast"), true);
  assert.ok(drafts[0]?.description.length > 0);
});

test("notification relations attach the event source when available", () => {
  const entityDrafts = buildEntityDrafts({
    title: "Alerta de batería",
    body: "Batería baja",
    source: "tasker",
    inferredKind: "notification",
    entities: [],
  });

  const drafts = buildRelationDrafts({
    title: "Alerta de batería",
    body: "Batería baja",
    source: "tasker",
    inferredKind: "notification",
    entities: entityDrafts,
  });

  assert.equal(drafts[0]?.relationType, "received_from");
  assert.equal(drafts[0]?.metadata?.evidence.source, "tasker");
});

test("graph options are clamped to safe bounds", () => {
  const options = parseGraphOptions({
    depth: "99",
    maxNodes: "9999",
    maxRelations: "-1",
  });

  assert.equal(options.depth, 5);
  assert.equal(options.maxNodes, 500);
  assert.equal(options.maxRelations, 1);
});

test("search match hints explain why a result was returned", () => {
  const hint = buildSearchMatchHint(
    "spotify",
    {
      title: "Compra en Spotify",
      body: "Visa $12.40",
      source: "tasker",
      kind: "notification",
    },
    {
      title: 5,
      body: 4,
      source: 2,
      kind: 2,
    },
  );

  assert.deepEqual(hint.matchedFields, ["title"]);
  assert.ok(hint.relevanceScore > 0);
  assert.match(hint.explanation, /title/);
});

test("classification assistant upgrades ambiguous events when the model is confident", async () => {
  const assistant = createClassificationAssistant({
    apiKey: "test-key",
    model: "test-model",
    generateCompletion: async () =>
      JSON.stringify({
        inferredKind: "expense",
        confidence: 0.91,
        entities: [
          { type: "amount", value: "$12.40" },
          { type: "merchant", value: "Spotify" },
        ],
        rationale: "Looks like a payment.",
      }),
  });

  const result = await assistant({
    event: {
      id: "evt_1",
      source: "tasker",
      kind: "other",
      title: "Cobro detectado",
      body: "Spotify $12.40",
      raw: {},
      tags: [],
    },
    base: {
      id: "evt_1",
      source: "tasker",
      kind: "other",
      title: "Cobro detectado",
      body: "Spotify $12.40",
      raw: {},
      tags: [],
      classificationVersion: "heuristic-v1",
      inferredKind: "other",
      confidence: 0.4,
      entities: [],
    },
  });

  assert.equal(result.inferredKind, "expense");
  assert.equal(result.classificationVersion, "heuristic-v1+llm");
  assert.equal(result.entities.length, 2);
  assert.equal(result.modelMetadata?.provider, "deepseek");
  assert.equal(result.modelMetadata?.applied, true);
});

test("knowledge digests summarize windows, counts, and highlights", () => {
  const digest = buildKnowledgeDigest({
    scope: "window 2026-07-06T00:00:00.000Z -> 2026-07-13T00:00:00.000Z",
    window: {
      from: "2026-07-06T00:00:00.000Z",
      to: "2026-07-13T00:00:00.000Z",
    },
    filters: {
      source: "tasker",
      kind: null,
    },
    events: [
      {
        id: "evt_1",
        source: "tasker",
        kind: "notification",
        title: "Compra en supermercado",
        body: "Visa $12.40",
        timestamp: "2026-07-13T12:00:00.000Z",
        createdAt: "2026-07-13T12:00:00.000Z",
        inferredKind: "expense",
        confidence: 0.9,
      },
      {
        id: "evt_2",
        source: "tasker",
        kind: "note",
        title: "Nota rápida",
        body: "Recordatorio",
        timestamp: "2026-07-12T12:00:00.000Z",
        createdAt: "2026-07-12T12:00:00.000Z",
        inferredKind: "note",
        confidence: 0.7,
      },
    ],
    relatedInsights: [
      {
        id: "insight_1",
        query: "spotify",
        summary: "Spotify is a merchant entity linked to expense activity.",
        model: "deepseek-v4-flash",
        createdAt: "2026-07-13T12:05:00.000Z",
      },
    ],
    uniqueEntities: 5,
    uniqueRelations: 2,
    summary: null,
    model: null,
  });

  assert.equal(digest.metrics.totalEvents, 2);
  assert.equal(digest.metrics.uniqueEntities, 5);
  assert.equal(digest.highlights[0]?.startsWith("Captured 2 events"), true);
  assert.equal(digest.relatedInsights[0]?.id, "insight_1");
  assert.equal(digest.summaryAvailable, true);
});
