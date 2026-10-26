import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  isLowUtilityPromotion,
  isRedundantProviderOrHeadingConcept,
  isRejectedFinancialText,
  isSupportedAssociationRationale,
  semanticActionKind,
  spanishChangeExplanation,
  unsupportedNumericClaims,
} = await import("../src/domain/decision-policy.ts");
const { tautologyCheck, validateEvidenceReferences } = await import("../src/storage/decision-verification.ts");

type Case = {
  id: string;
  expected: "accept" | "abstain";
  useful: boolean;
  expectedActionKind: "assign_existing_category" | "create_category" | "merge_identities" | "associate_entities" | "place_entity";
  subject: { label: string; type: string; id?: string };
  source: string;
  title: string;
  body: string;
  target: { label: string; type: string; id?: string };
  action: "reuse" | "create" | "merge" | "association";
  relationType: string;
  existingConcepts: string[];
  evidenceRefs: string[];
  verifier: "accept" | "reject" | "fail";
  rationale?: string;
  claimText?: string;
  categoryPath?: string[];
  verifiedEventCount?: number;
  flags?: { identicalIds?: boolean; relationExists?: boolean; hasCycle?: boolean; ownerMismatch?: boolean; typeMismatch?: boolean };
  note?: string;
};

const fixture = JSON.parse(readFileSync(new URL("./fixtures/evidence-policy/cases.json", import.meta.url), "utf8")) as {
  version: string;
  policyVersion: string;
  critical: Case[];
  heldout: Case[];
};

function evaluate(input: Case) {
  const evidence = [
    { ref: "event.title", kind: "event_title" as const, label: "Título", text: input.title, eventId: "evt_eval", source: input.source },
    { ref: "event.body", kind: "event_body" as const, label: "Texto", text: input.body, eventId: "evt_eval", source: input.source },
    { ref: "event.source", kind: "event_source" as const, label: "Fuente", text: input.source, eventId: "evt_eval", source: input.source },
  ];
  const reasons: string[] = [];
  const flags = input.flags ?? {};
  if (flags.identicalIds) reasons.push("identical_endpoint_ids");
  if (flags.relationExists) reasons.push("relation_already_exists");
  if (flags.hasCycle) reasons.push("hierarchy_cycle");
  if (flags.ownerMismatch) reasons.push("owner_mismatch");
  if (flags.typeMismatch) reasons.push("entity_type_mismatch");
  const refs = input.evidenceRefs.map((ref) => ({ ref }));
  const evidenceCheck = validateEvidenceReferences({ references: refs, evidence, requireEventEvidence: true });
  reasons.push(...evidenceCheck.errors);
  const tautology = tautologyCheck({
    subjectLabel: input.subject.label,
    subjectType: input.subject.type,
    targetLabel: input.target.label,
    targetType: input.target.type,
    actionKind: input.expectedActionKind,
  });
  reasons.push(...tautology.errors);
  if (["activity_instance", "financial_event", "email_message"].includes(input.subject.type)
    && ["create_category", "assign_existing_category"].includes(input.expectedActionKind)) {
    const redundant = isRedundantProviderOrHeadingConcept({
      proposedValue: input.expectedActionKind === "create_category" ? input.target.label : input.target.label,
      source: input.source,
      eventTitle: input.title,
      subjectValue: input.subject.label,
      supportedNames: input.existingConcepts,
    });
    if (redundant) reasons.push("concept_restates_provider_or_heading");
  }
  if (input.expectedActionKind === "associate_entities" && !isSupportedAssociationRationale(input.rationale)) {
    reasons.push("association_without_independent_evidence");
  }
  if (input.categoryPath?.some((node) => /(?:spending|card purchases)/iu.test(node))
    && isRejectedFinancialText({ source: input.source, title: input.title, body: input.body })) {
    reasons.push('rejected_transaction_cannot_be_a_purchase');
  }
  if (isLowUtilityPromotion({ source: input.source, title: input.title, body: input.body })) {
    reasons.push('promotional_offer_is_not_a_financial_activity');
  }
  if (input.claimText) {
    const unsupported = unsupportedNumericClaims(input.claimText, `${input.title}\n${input.body}`);
    for (const claim of unsupported) reasons.push(`unsupported_number:${claim}`);
  }
  const deterministicAccepted = reasons.length === 0;
  const verifierAccepted = input.verifier === "accept";
  const accepted = deterministicAccepted && verifierAccepted;
  const actionKind = input.expectedActionKind
    ?? semanticActionKind({ decisionKind: input.action, subjectType: input.subject.type, targetType: input.target.type });
  const explanation = accepted
    ? spanishChangeExplanation({
      actionKind,
      subjectLabel: input.subject.label,
      targetLabel: input.target.label,
      relationType: input.relationType,
      hierarchyPath: input.existingConcepts,
      verifiedEventCount: input.verifiedEventCount,
    })
    : null;
  return {
    id: input.id,
    expected: input.expected,
    accepted,
    outcome: accepted ? "accept" as const : "abstain" as const,
    reasons,
    explanation,
    actionKind,
  };
}

function score(cases: Case[]) {
  const results = cases.map(evaluate);
  const accepted = results.filter((result) => result.accepted);
  const trueAccepted = accepted.filter((result) => {
    const input = cases.find((candidate) => candidate.id === result.id)!;
    return input.expected === "accept" && input.useful;
  }).length;
  const falseAccepted = accepted.length - trueAccepted;
  const precision = accepted.length ? trueAccepted / accepted.length : 1;
  const supportedAssignments = cases.filter((input) => input.expected === "accept" && input.useful && input.expectedActionKind === "assign_existing_category");
  const recalledAssignments = supportedAssignments.filter((input) => results.find((result) => result.id === input.id)?.accepted).length;
  const recall = supportedAssignments.length ? recalledAssignments / supportedAssignments.length : 1;
  return { results, precision, recall, accepted: accepted.length, trueAccepted, falseAccepted, supportedAssignments: supportedAssignments.length, recalledAssignments };
}

test("critical safety fixtures never surface an unsupported proposal", () => {
  const scored = score(fixture.critical);
  for (const result of scored.results) {
    assert.equal(result.outcome, result.expected, `${result.id}: ${result.reasons.join(", ")}`);
  }
  const screenshot = scored.results.find((result) => result.id === "screenshot-pedidosya-notification")!;
  assert.equal(screenshot.outcome, "abstain");
  assert.ok(screenshot.reasons.some((reason) => reason.includes("restates") || reason.includes("identical")));
  assert.ok(!scored.results.some((result) => result.accepted && result.explanation?.includes("%")), "no accepted explanation may include raw percentages");
  assert.ok(!scored.results.some((result) => result.explanation?.includes("Segura")), "no accepted explanation may claim Segura");
});

test("held-out review proposals meet precision and assignment recall gates", () => {
  const scored = score(fixture.heldout);
  assert.ok(scored.precision >= 0.95, `review-proposal precision ${scored.precision.toFixed(3)} is below 0.95; false accepted: ${scored.falseAccepted}`);
  assert.ok(scored.recall >= 0.90, `supported existing-category recall ${scored.recall.toFixed(3)} is below 0.90`);
  assert.ok(scored.falseAccepted === 0, `held-out false accepted proposals: ${scored.results.filter((result) => result.accepted && !fixture.heldout.find((input) => input.id === result.id)?.useful).map((result) => result.id).join(", ")}`);
});

test("Spanish explanations are actionable and never expose internal scores", () => {
  const scored = score(fixture.heldout.filter((input) => input.expected === "accept"));
  assert.ok(scored.results.length > 0);
  for (const result of scored.results) {
    assert.ok(result.explanation);
    assert.match(result.explanation!, /(?:Clasificar|Crear|Unificar|Asociar|Ubicar)/);
    assert.ok(!/\b(?:Segura|Dudosa|Posible)\b/.test(result.explanation!));
    assert.ok(!/\d+%/.test(result.explanation!));
  }
});

test("the fixture set includes every required safety category", () => {
  const ids = new Set([...fixture.critical, ...fixture.heldout].map((input) => input.id));
  for (const required of [
    "promotion-is-not-an-order",
    "rejected-transaction-is-not-a-purchase",
    "temporary-hold-is-not-a-purchase",
    "bill-reminder-is-not-a-payment",
    "preapproved-loan-offer-is-not-an-activity",
    "genuine-delivery-update",
    "repeated-captures-independent-evidence",
    "matching-labels-different-types",
    "true-self-link",
    "duplicate-concept-verifier-rejects",
    "unsupported-amount",
    "prompt-injection-in-evidence",
    "verifier-disagreement",
    "provider-failure",
    "spanish-explanation-quality",
  ]) {
    assert.ok(ids.has(required), `missing safety fixture ${required}`);
  }
});
