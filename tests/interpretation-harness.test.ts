import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

const { classifyEvent } = await import("../src/domain/classification.ts");
const { buildEntityDrafts } = await import("../src/domain/entities.ts");
const { buildFinancialTransactionCandidate } = await import("../src/domain/financial-transactions.ts");
const { createClassificationAssistant } = await import("../src/storage/classification-assistant.ts");

const sodimacEvent = {
  id: "santander_sodimac_thousands",
  source: "Santander",
  kind: "notification" as const,
  title: "Aviso: uso de tarjeta de crédito",
  body: "Se realizó una transacción con la tarjeta MASTERCARD terminada en 2188 por un monto de UYU 1.733,00 en SODIMAC SAYAGO. Si no reconoce esta transacción comunícate al 132 a la brevedad.",
  raw: {},
  tags: [],
};

function interpretFinancialEvent(event: typeof sodimacEvent) {
  const classified = classifyEvent(event);
  const entityDrafts = buildEntityDrafts(classified);
  return {
    classified,
    candidate: buildFinancialTransactionCandidate({ event, classified, entityDrafts }),
  };
}

test("interpretation harness recognizes locale-formatted Santander posted charges", () => {
  const { classified, candidate } = interpretFinancialEvent(sodimacEvent);

  assert.equal(classified.inferredKind, "expense");
  assert.equal(classified.confidence, 0.99);
  assert.deepEqual(classified.entities, [
    { type: "amount", value: "UYU 1.733,00" },
    { type: "merchant", value: "SODIMAC SAYAGO" },
  ]);
  assert.equal(candidate?.amount, 1733);
  assert.equal(candidate?.currency, "UYU");
  assert.equal(candidate?.merchantLabel, "SODIMAC SAYAGO");
});

test("interpretation harness parses English thousands separators without losing magnitude", () => {
  const event = {
    ...sodimacEvent,
    id: "santander_usd_thousands",
    body: "Se realizó una transacción con la tarjeta VISA terminada en 2188 por un monto de USD 1,733.00 en SODIMAC SAYAGO. Si no reconoce esta transacción comunícate al 132.",
  };
  const { classified, candidate } = interpretFinancialEvent(event);

  assert.equal(classified.inferredKind, "expense");
  assert.equal(candidate?.amount, 1733);
  assert.equal(candidate?.currency, "USD");
});

test("interpretation harness keeps rejected card attempts out of the ledger", () => {
  const event = {
    ...sodimacEvent,
    id: "santander_rejected_thousands",
    title: "Aviso: rechazo de tarjeta de crédito",
    body: "Se rechazó la transacción con la tarjeta MASTERCARD terminada en 2188 por un monto de UYU 1.733,00 en SODIMAC SAYAGO.",
  };
  const { classified, candidate } = interpretFinancialEvent(event);

  assert.equal(classified.inferredKind, "notification");
  assert.equal(candidate, null);
});

test("LLM interpretation cannot downgrade a deterministic posted charge or replace its exact amount", async () => {
  const base = classifyEvent(sodimacEvent);
  const assistant = createClassificationAssistant({
    apiKey: "test-key",
    model: "interpretation-harness-model",
    generateCompletion: async () => JSON.stringify({
      inferredKind: "notification",
      confidence: 1,
      entities: [
        { type: "amount", value: "UYU 1,73" },
        { type: "merchant", value: "SODIMAC SAYAGO" },
      ],
      rationale: "Incorrect adversarial transport-type interpretation.",
      displayTitle: "Credit card transaction at Sodimac Sayago",
      displayDescription: "A Santander notification reported a completed card transaction at Sodimac Sayago.",
    }),
  });

  const enhanced = await assistant({ event: sodimacEvent, base });
  const candidate = buildFinancialTransactionCandidate({
    event: sodimacEvent,
    classified: enhanced,
    entityDrafts: buildEntityDrafts(enhanced),
  });

  assert.equal(enhanced.inferredKind, "expense");
  assert.deepEqual(enhanced.entities.filter((entity) => entity.type === "amount"), [
    { type: "amount", value: "UYU 1.733,00" },
  ]);
  assert.equal(candidate?.amount, 1733);
});
