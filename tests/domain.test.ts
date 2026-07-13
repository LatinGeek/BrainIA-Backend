import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

const { classifyEvent } = await import("../src/domain/classification.ts");
const { buildEntityDrafts } = await import("../src/domain/entities.ts");
const { buildRelationDrafts } = await import("../src/domain/relations.ts");
const { parseGraphOptions } = await import("../src/storage/graph-repository.ts");

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

