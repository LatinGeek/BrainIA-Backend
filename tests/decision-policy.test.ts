import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

const {
  DECISION_POLICY_VERSION,
  buildEvidenceIndex,
  decisionPolicyMode,
  isRedundantProviderOrHeadingConcept,
  isRejectedFinancialText,
  isRuleEligibleAction,
  isSupportedAssociationRationale,
  resolveEvidenceReferences,
  semanticActionKind,
  spanishChangeExplanation,
  unsupportedNumericClaims,
} = await import("../src/domain/decision-policy.ts");
const { verifyDecision, validateEvidenceReferences, tautologyCheck } = await import("../src/storage/decision-verification.ts");
const { createClassificationAssistant } = await import("../src/storage/classification-assistant.ts");

const evidence = [
  {
    ref: "event.title", kind: "event_title" as const, label: "Título", text: "¡Sábado con 20% OFF!🍕",
    eventId: "evt_1", source: "PedidosYa", occurredAt: "2026-10-24T16:12:56.016Z", field: "title",
  },
  {
    ref: "event.body", kind: "event_body" as const, label: "Texto",
    text: "¡Sábado con 20% OFF!🍕\nAlmorzá riquísimo hoy: encontrá platos con desde 20% OFF en la app",
    eventId: "evt_1", source: "PedidosYa", occurredAt: "2026-10-24T16:12:56.016Z", field: "body",
  },
  {
    ref: "event.source", kind: "event_source" as const, label: "Fuente", text: "PedidosYa",
    eventId: "evt_1", source: "PedidosYa", occurredAt: "2026-10-24T16:12:56.016Z", field: "source",
  },
];

const pedidosYaProposal = {
  paths: [{
    subjectNormalizedValue: "pedidosya notification",
    subjectType: "activity_instance",
    role: "primary",
    domain: "Food",
    action: "create",
    hierarchyPath: ["Food", "Food / Delivery", "Orders"],
    proposedChild: { value: "PedidosYa notification", description: "Una notificación de PedidosYa.", parent: "Orders", durable: true },
    evidence: [{ ref: "event.title", excerpt: "Sábado con 20% OFF" }],
  }],
  associations: [],
};

test("policy mode is explicit and defaults to shadow", () => {
  const previous = process.env.BRAINIA_EVIDENCE_POLICY;
  delete process.env.BRAINIA_EVIDENCE_POLICY;
  assert.equal(decisionPolicyMode(), "shadow");
  process.env.BRAINIA_EVIDENCE_POLICY = "enforce";
  assert.equal(decisionPolicyMode(), "enforce");
  if (previous === undefined) delete process.env.BRAINIA_EVIDENCE_POLICY; else process.env.BRAINIA_EVIDENCE_POLICY = previous;
});

test("invented evidence references invalidate a decision", () => {
  const result = validateEvidenceReferences({
    references: [{ ref: "event.title", excerpt: "Sábado con 20% OFF" }, { ref: "event.invented", excerpt: "x" }],
    evidence,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("invented_evidence_reference:event.invented"));
});

test("an excerpt that is not in the supplied input invalidates the reference", () => {
  const index = buildEvidenceIndex(evidence);
  const resolution = resolveEvidenceReferences([{ ref: "event.body", excerpt: "texto que nunca existió" }], index);
  assert.deepEqual(resolution.invalidRefs, []);
  assert.deepEqual(resolution.excerptMismatches, ["event.body"]);
});

test("the verifier is called without generator confidence or rationale", async () => {
  process.env.BRAINIA_EVIDENCE_POLICY = "enforce";
  let verifierPrompt = "";
  const outcome = await verifyDecision({
    actionKind: "place_entity",
    operation: "test_semantic",
    generatorModel: "generator-model",
    generatorPromptVersion: "gen-v1",
    evidence,
    evidenceReferences: [{ ref: "event.title", excerpt: "Sábado con 20% OFF" }],
    proposal: { ...pedidosYaProposal, confidence: 0.85, rationale: "Confianza alta del generador" },
    deterministic: { ok: true, errors: [] },
    apiKey: "test-key",
    completion: async (request) => {
      verifierPrompt = request.userPrompt;
      return JSON.stringify({ verdict: "reject", reason: "Tautología: el concepto repite el proveedor y el título.", unsupported: ["concepto tautológico"], pathVerdicts: [{ index: 0, accept: false, reason: "sin actividad" }], associationVerdicts: [] });
    },
  });
  assert.equal(outcome.verification.status, "rejected");
  assert.equal(outcome.applies, false);
  assert.ok(!verifierPrompt.includes("Confianza alta del generador"));
  assert.ok(!verifierPrompt.includes("0.85"));
  assert.match(verifierPrompt, /untrusted data/);
});

test("shadow mode records disagreement but does not block the legacy decision", async () => {
  process.env.BRAINIA_EVIDENCE_POLICY = "shadow";
  const outcome = await verifyDecision({
    actionKind: "place_entity",
    operation: "test_shadow",
    generatorModel: "generator-model",
    generatorPromptVersion: "gen-v1",
    evidence,
    evidenceReferences: [{ ref: "event.title" }],
    proposal: pedidosYaProposal,
    deterministic: { ok: true, errors: [] },
    apiKey: "test-key",
    completion: async () => JSON.stringify({ verdict: "reject", reason: "sin soporte", unsupported: [], pathVerdicts: [], associationVerdicts: [] }),
  });
  assert.equal(outcome.verification.status, "rejected");
  assert.equal(outcome.applies, true);
});

test("deterministic failure blocks even in shadow mode", async () => {
  process.env.BRAINIA_EVIDENCE_POLICY = "shadow";
  const outcome = await verifyDecision({
    actionKind: "place_entity",
    operation: "test_deterministic",
    generatorModel: "generator-model",
    generatorPromptVersion: "gen-v1",
    evidence,
    evidenceReferences: [{ ref: "event.missing" }],
    proposal: pedidosYaProposal,
    deterministic: { ok: false, errors: ["invented_evidence_reference"] },
  });
  assert.equal(outcome.verification.status, "rejected");
  assert.equal(outcome.applies, false);
});

test("the screenshot proposal is rejected as a provider/heading restatement", () => {
  assert.equal(isRedundantProviderOrHeadingConcept({
    proposedValue: "PedidosYa notification",
    source: "PedidosYa",
    eventTitle: "PedidosYa",
    subjectValue: "PedidosYa notification",
  }), true);
  assert.equal(isRedundantProviderOrHeadingConcept({
    proposedValue: "Promoción de descuento de PedidosYa",
    source: "PedidosYa",
    eventTitle: "¡Sábado con 20% OFF!🍕",
  }), true);
  assert.equal(isRedundantProviderOrHeadingConcept({
    proposedValue: "Home motion detection",
    source: "Xiaomi Home",
    eventTitle: "Motion detected",
  }), false);
});

test("identical semantic endpoints are a no-effect tautology", () => {
  const check = tautologyCheck({
    subjectLabel: "PedidosYa notification",
    subjectType: "activity_instance",
    targetLabel: "PedidosYa notification",
    targetType: "concept",
    actionKind: "create_category",
  });
  assert.equal(check.ok, false);
  assert.ok(check.errors.includes("identical_endpoint_labels_without_effect"));
});

test("a declined or rejected card attempt is not a completed purchase", () => {
  assert.equal(isRejectedFinancialText({ title: "Compra rechazada", body: "La compra fue rechazada." }), true);
  assert.equal(isRejectedFinancialText({ title: "Pago rechazado", body: "El pago fue rechazado." }), true);
  assert.equal(isRejectedFinancialText({ title: "Compra completada", body: "La compra se realizó correctamente." }), false);
  assert.equal(isRejectedFinancialText({ title: "Compra", body: "No se realizó la compra." }), true);
  assert.equal(isRejectedFinancialText({ title: "Pago aprobado", body: "El pago fue aprobado." }), false);
  assert.equal(isRejectedFinancialText({ title: "Ose", body: "Se pagó tu factura." }), false);
  assert.equal(isRejectedFinancialText({ title: "Factura", body: "Tu factura vence mañana." }), true);
  assert.equal(isRejectedFinancialText({ title: "Recordatorio", body: "Tenés 1 factura para pagar." }), true);
});

test("trusted social and smart-home providers reuse deterministic categories", async () => {
  const { buildDeterministicSemanticDecision } = await import("../src/storage/semantic-enrichment.ts");
  const instagram = buildDeterministicSemanticDecision({
    entities: [{ type: "activity_instance", value: "Nuevo seguidor", normalizedValue: "event:instagram", metadata: { instance: true } }],
    source: "Instagram",
    inferredKind: "notification",
    title: "Nuevo seguidor",
    body: "Tato de Leon (@tato_dl) follows you on Instagram",
  });
  assert.equal(instagram.paths[0]?.hierarchyPath.at(-1), "Social interactions");
  const xiaomi = buildDeterministicSemanticDecision({
    entities: [{ type: "activity_instance", value: "Notificación de la automatización", normalizedValue: "event:xiaomi", metadata: { instance: true } }],
    source: "Xiaomi Home",
    inferredKind: "notification",
    title: "Notificación de la automati...",
    body: "Movimiento detectado",
  });
  assert.equal(xiaomi.paths[0]?.hierarchyPath.at(-1), "Device alerts");
});

test("shared-app-only association rationales do not justify a relation", () => {
  assert.equal(isSupportedAssociationRationale("Both are PedidosYa notifications from the same app."), false);
  assert.equal(isSupportedAssociationRationale("Ambos son de la misma aplicación y plataforma."), false);
  assert.equal(isSupportedAssociationRationale("The receipt confirms this payment settled the same order referenced by the email."), true);
});

test("generated prose cannot invent a total", () => {
  assert.deepEqual(unsupportedNumericClaims("You spent UYU 999,00 in 42 purchases.", "Spent UYU 120,00 in 3 purchases."), ["999,00", "42"]);
  assert.deepEqual(unsupportedNumericClaims("3 purchases were captured.", "3 purchases were captured."), []);
});

test("action kinds, rule eligibility and Spanish explanations are explicit", () => {
  const kind = semanticActionKind({ decisionKind: "reuse", subjectType: "financial_event", targetType: "concept" });
  assert.equal(kind, "assign_existing_category");
  assert.equal(isRuleEligibleAction({ actionKind: kind, decisionKind: "reuse", relationType: "part_of", subjectType: "financial_event" }), true);
  assert.equal(isRuleEligibleAction({ actionKind: "create_category", decisionKind: "create", relationType: "part_of", subjectType: "financial_event" }), false);
  assert.equal(isRuleEligibleAction({ actionKind: "associate_entities", decisionKind: "association", relationType: "uses_service", subjectType: "activity_instance" }), false);
  const explanation = spanishChangeExplanation({ actionKind: "create_category", subjectLabel: "Pedido en PedidosYa", targetLabel: "Pedidos de delivery", hierarchyPath: ["Food", "Delivery", "Orders"], verifiedEventCount: 2 });
  assert.match(explanation, /Crear la categoría/);
  assert.match(explanation, /2 eventos/);
  assert.equal(DECISION_POLICY_VERSION, "evidence-grounded-v1");
});

test("enforce mode drops a classification whose verifier rejects it", async () => {
  process.env.BRAINIA_EVIDENCE_POLICY = "enforce";
  const assistant = createClassificationAssistant({
    apiKey: "test-key",
    model: "test-model",
    generateCompletion: async () => JSON.stringify({
      inferredKind: "expense",
      confidence: 0.99,
      entities: [{ type: "amount", value: "USD 20,00" }, { type: "merchant", value: "OpenAI" }],
      displayTitle: "Pago a OpenAI",
      displayDescription: "Se realizó un pago de USD 20,00 a OpenAI.",
      evidence: [
        { field: "inferredKind", ref: "event.body", excerpt: "USD 20,00" },
        { field: "entities", ref: "event.body", excerpt: "OPENAI" },
      ],
    }),
    verifyCompletion: async () => JSON.stringify({ verdict: "reject", reason: "importe no coincide con la evidencia determinista", unsupported: ["USD 20,00"], pathVerdicts: [], associationVerdicts: [] }),
  });
  const event = { id: "evt_enforce", source: "Santander", kind: "notification" as const, title: "Aviso", body: "USD 20,00 OPENAI", raw: {}, tags: [] };
  const result = await assistant({ event, base: { ...event, classificationVersion: "heuristic-v2", inferredKind: "notification", confidence: 0.5, entities: [] } });
  assert.equal(result.inferredKind, "notification");
  assert.equal(result.modelMetadata?.applied, false);
  assert.equal((result.modelMetadata?.verification as { status?: string } | undefined)?.status, "rejected");
});

test("enforce mode applies a classification only when the verifier accepts", async () => {
  process.env.BRAINIA_EVIDENCE_POLICY = "enforce";
  const assistant = createClassificationAssistant({
    apiKey: "test-key",
    model: "test-model",
    generateCompletion: async () => JSON.stringify({
      inferredKind: "expense",
      confidence: 0.99,
      entities: [{ type: "amount", value: "USD 20,00" }, { type: "merchant", value: "OpenAI" }],
      displayTitle: "Pago a OpenAI",
      displayDescription: "Se realizó un pago de USD 20,00 a OpenAI.",
      evidence: [
        { field: "inferredKind", ref: "event.body", excerpt: "USD 20,00" },
        { field: "entities", ref: "event.body", excerpt: "OPENAI" },
      ],
    }),
    verifyCompletion: async () => JSON.stringify({ verdict: "accept", reason: "importe y comercio respaldados", unsupported: [], pathVerdicts: [], associationVerdicts: [] }),
  });
  const event = { id: "evt_enforce_ok", source: "Santander", kind: "notification" as const, title: "Aviso", body: "USD 20,00 OPENAI", raw: {}, tags: [] };
  const result = await assistant({ event, base: { ...event, classificationVersion: "heuristic-v2", inferredKind: "notification", confidence: 0.5, entities: [] } });
  assert.equal(result.inferredKind, "expense");
  assert.equal(result.modelMetadata?.applied, true);
  assert.equal((result.modelMetadata?.verification as { status?: string } | undefined)?.status, "verified");
});
