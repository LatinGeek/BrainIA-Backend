import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

const { buildSemanticProposals, hasMeaningfulAiIdentity } = await import("../src/storage/semantic-enrichment.ts");
const { LIFE_DOMAINS, MAX_SEMANTIC_DEPTH, ontologyParentName } = await import("../src/domain/ontology.ts");

test("governance exposes the controlled roots and bounded recursive depth", () => {
  assert.ok(LIFE_DOMAINS.includes("Home"));
  assert.ok(LIFE_DOMAINS.includes("Communication"));
  assert.equal(MAX_SEMANTIC_DEPTH, 8);
  assert.equal(ontologyParentName("Home automation"), "Home");
  assert.equal(ontologyParentName("Orders"), "Food / Delivery");
  assert.equal(ontologyParentName("Email accounts"), "Email");
  assert.equal(ontologyParentName("Email contacts"), "Email");
});

test("structural financial evidence anchors only at the most-specific governed parent", () => {
  const subject = { type: "merchant", value: "PedidosYa", normalizedValue: "pedidosya", metadata: {} };
  const proposals = buildSemanticProposals({ entities: [subject], source: "Santander", inferredKind: "expense" });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.targetValue, "Financial activity");
  assert.equal(proposals[0]?.relationType, "part_of");
});

test("structural email evidence anchors at Email rather than Communication", () => {
  const subject = { type: "email_message", value: "Receipt", normalizedValue: "event:email-1", metadata: {} };
  const proposals = buildSemanticProposals({ entities: [subject], source: "gmail", inferredKind: "email" });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]?.targetValue, "Email");
  assert.equal(proposals[0]?.relationType, "part_of");
});

test("every durable email subject receives its own most-specific path", () => {
  const message = { type: "email_message", value: "Receipt", normalizedValue: "event:email-3", metadata: {} };
  const recipient = { type: "recipient", value: "me@example.com", normalizedValue: "me@example.com", metadata: {} };
  const sender = { type: "sender", value: "shop@example.com", normalizedValue: "shop@example.com", metadata: {} };
  const proposals = buildSemanticProposals({ entities: [message, recipient, sender], source: "gmail", inferredKind: "email" });
  assert.deepEqual(proposals.map((proposal) => proposal.targetValue), ["Email", "Email accounts", "Email contacts"]);
});

test("financial email evidence exposes one most-specific anchor in each relevant tree", () => {
  const merchant = { type: "merchant", value: "PedidosYa", normalizedValue: "pedidosya", metadata: {} };
  const message = { type: "email_message", value: "Card alert", normalizedValue: "event:email-2", metadata: {} };
  const proposals = buildSemanticProposals({ entities: [merchant, message], source: "make.gmail", inferredKind: "expense" });
  assert.deepEqual(proposals.map((proposal) => proposal.targetValue), ["Financial activity", "Email"]);
  assert.equal(new Set(proposals.map((proposal) => proposal.targetValue)).size, 2);
});

test("AI identity governance rejects copied event titles and generic fragments", () => {
  const activity = { type: "activity_instance", value: "Aviso: uso de tarjeta de cr\u00e9dito", normalizedValue: "event:notification-1", metadata: {} };
  assert.equal(hasMeaningfulAiIdentity(activity, {
    canonicalName: "Aviso: uso de tarjeta de cr\u00e9dito",
    description: "A notification reporting a completed credit-card purchase.",
    confidence: 0.95,
  }), false);
  assert.equal(hasMeaningfulAiIdentity({ type: "merchant", value: "merchant", normalizedValue: "merchant", metadata: {} }, {
    canonicalName: "Aviso",
    description: "A generic notification fragment without durable meaning.",
    confidence: 0.95,
  }), false);
});

test("AI identity governance accepts a meaningful canonical identity with description", () => {
  const merchant = { type: "merchant", value: "RESTAURANTE BLANES", normalizedValue: "restaurante blanes", metadata: {} };
  assert.equal(hasMeaningfulAiIdentity(merchant, {
    canonicalName: "Restaurante Blanes",
    description: "A restaurant merchant identified in the user's financial activity.",
    confidence: 0.94,
  }), true);
});
