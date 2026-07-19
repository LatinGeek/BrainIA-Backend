import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

const { classifyEvent } = await import("../src/domain/classification.ts");
const { buildEntityDrafts } = await import("../src/domain/entities.ts");
const { buildFinancialTransactionCandidate } = await import("../src/domain/financial-transactions.ts");
const { buildRelationDrafts, normalizeRelationType } = await import("../src/domain/relations.ts");
const { shouldQueueMerchantReview } = await import("../src/storage/entity-alias-repository.ts");
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

test("completed Santander card alerts become expenses even with UYU prefix amounts", () => {
  const classified = classifyEvent({
    id: "santander_card_purchase",
    source: "Santander",
    kind: "notification",
    title: "Aviso: uso de tarjeta de crédito",
    body: "Se realizó una transacción con la tarjeta MASTERCARD terminada en 2188 por un monto de UYU 258,42 en DLOPEDIDOSYA. Si no reconoces esta transacción comunícate al 132.",
    raw: {},
    tags: [],
  });

  assert.equal(classified.inferredKind, "expense");
  assert.equal(classified.confidence, 0.99);
  assert.deepEqual(classified.entities, [
    { type: "amount", value: "UYU 258,42" },
    { type: "merchant", value: "DLOPEDIDOSYA" },
  ]);
});

test("rejected card alerts do not receive the completed-purchase classification", () => {
  const classified = classifyEvent({
    id: "santander_card_rejected",
    source: "Santander",
    kind: "notification",
    title: "Aviso: rechazo de tarjeta de crédito",
    body: "Se rechazó la transacción con la tarjeta MASTERCARD terminada en 2188 por un monto de UYU 34,30 en DLOPEDIDOSYA.",
    raw: {},
    tags: [],
  });

  assert.equal(classified.inferredKind, "notification");
  assert.equal(classified.confidence, 0.98);
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

test("notification payment titles keep the merchant separate from the debit message", () => {
  const title = "Pagaste a La pequena mar azul";
  const body = "Descontamos $ 195,00 de tu cuenta.";
  const drafts = buildEntityDrafts({
    title,
    body,
    inferredKind: "expense",
    entities: [{ type: "amount", value: "$ 195,00" }],
  });
  const merchant = drafts.find((draft) => draft.type === "merchant");
  const candidate = buildFinancialTransactionCandidate({
    event: { id: "md_notification", source: "macrodroid", kind: "notification", title, body, raw: {}, tags: [] },
    classified: { inferredKind: "expense", confidence: 0.82 },
    entityDrafts: drafts,
  });

  assert.equal(merchant?.value, "La pequena mar azul");
  assert.equal(candidate?.merchantLabel, "La pequena mar azul");
  assert.equal(candidate?.amount, 195);
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

test("email drafts capture sender and recipient without inventing merchants", () => {
  const drafts = buildEntityDrafts({
    title: "Hola",
    body: "from: billing@example.com\nto: me@example.com",
    raw: {
      providerPayload: {
        fromName: "Billing Team",
        fromEmail: "billing@example.com",
        to: [{ email: "me@example.com" }],
      },
    },
    inferredKind: "email",
    entities: [],
  });

  assert.equal(drafts.some((draft) => draft.type === "merchant"), false);
  assert.equal(drafts.some((draft) => draft.type === "sender"), true);
  assert.equal(drafts.some((draft) => draft.type === "recipient"), true);
  assert.equal(drafts.some((draft) => draft.type === "message"), true);
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

test("email relation drafts include sender and recipient links", () => {
  const entityDrafts = buildEntityDrafts({
    title: "Receipt",
    body: "from: billing@example.com\nto: me@example.com",
    raw: {
      providerPayload: {
        fromName: "Billing Team",
        fromEmail: "billing@example.com",
        to: [{ email: "me@example.com" }],
      },
    },
    inferredKind: "email",
    entities: [],
  });

  const drafts = buildRelationDrafts({
    title: "Receipt",
    body: "from: billing@example.com\nto: me@example.com",
    source: "mail",
    inferredKind: "email",
    entities: entityDrafts,
  });

  assert.equal(drafts.some((draft) => draft.relationType === "sent_by"), true);
  assert.equal(drafts.some((draft) => draft.relationType === "sent_to"), true);
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

test("relation labels normalize to stable relation types", () => {
  assert.deepEqual(normalizeRelationType("paid_to", "Paid to"), { relationType: "spent_at", label: "Spent at" });
  assert.deepEqual(normalizeRelationType("custom", "Purchased from"), { relationType: "spent_at", label: "Spent at" });
});

test("all-caps merchant labels are sent to alias review", () => {
  assert.equal(shouldQueueMerchantReview("DLOPEDIDOSYA"), true);
  assert.equal(shouldQueueMerchantReview("UYU"), false);
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

test("classification assistant inspects confident email captures for transaction knowledge", async () => {
  let completionCalls = 0;
  const assistant = createClassificationAssistant({
    apiKey: "test-key",
    model: "test-model",
    generateCompletion: async () => {
      completionCalls += 1;
      return JSON.stringify({
        inferredKind: "expense",
        confidence: 0.96,
        entities: [
          { type: "amount", value: "UYU 439.00" },
          { type: "merchant", value: "MERPAGO*MARIADELROSARVIS3" },
          { type: "card_last_four", value: "5343" },
        ],
        rationale: "Santander card transaction alert.",
      });
    },
  });

  const event = {
    id: "mail_santander_1",
    source: "make.gmail",
    kind: "email" as const,
    title: "Aviso de transacción",
    body: "Se realizó una transacción con tu tarjeta VISA terminada en 5343. Importe UYU 439,00. Establecimiento MONTEVIDEO/MERPAGO*MARIADELROSARVIS3.",
    raw: {},
    tags: [],
  };

  const result = await assistant({
    event,
    base: {
      ...event,
      classificationVersion: "heuristic-v1",
      inferredKind: "email",
      confidence: 0.8,
      entities: [],
    },
  });

  assert.equal(completionCalls, 1);
  assert.equal(result.inferredKind, "expense");
  assert.equal(result.classificationVersion, "heuristic-v1+llm");
  assert.deepEqual(result.entities.map((entity) => entity.type), ["amount", "merchant", "card_last_four"]);
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
