import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool } from "../src/storage/postgres.ts";
import { insertRawEvent, linkEventEntity } from "../src/storage/event-repository.ts";
import { upsertEntity } from "../src/storage/entity-repository.ts";
import { enqueueSemanticCandidate, listSemanticCandidates, resolveSemanticCandidate, SemanticCandidateConflictError } from "../src/storage/semantic-repository.ts";
import { DECISION_POLICY_VERSION } from "../src/domain/decision-policy.ts";
import { SEMANTIC_GOVERNANCE_VERSION, SEMANTIC_PROMPT_VERSION } from "../src/domain/ontology.ts";

process.env.DEEPSEEK_API_KEY = "";
process.env.BRAINIA_EVIDENCE_POLICY = "enforce";

async function fixture() {
  const clientId = randomUUID();
  const event = {
    id: randomUUID(), source: "Santander", contractVersion: 1, kind: "notification" as const,
    title: "Aviso", body: "Consumo UYU 1.733,00 en SODIMAC SAYAGO.", raw: {}, tags: [],
    timestamp: "2026-10-20T12:00:00Z",
  };
  await insertRawEvent(pool, event, clientId, `${clientId}:${event.id}`);
  const subjectValue = `Compra en Sodimac ${randomUUID().slice(0, 8)}`;
  const subject = await upsertEntity(pool, {
    type: "activity_instance", value: subjectValue, normalizedValue: subjectValue.toLowerCase(),
    description: "Una compra realizada en Sodimac.", identitySource: "ai",
    metadata: { instance: true, eventId: event.id, aiIdentity: true, eventTimestamp: event.timestamp },
  }, { ownerId: clientId });
  await linkEventEntity(pool, event.id, subject.id, 1);
  const targetValue = `Card purchases ${randomUUID().slice(0, 8)}`;
  const target = await upsertEntity(pool, {
    type: "concept", value: targetValue, normalizedValue: targetValue.toLowerCase(),
    description: "Compras pagadas con tarjeta.", identitySource: "ai",
  }, { ownerId: clientId });
  const candidate = await enqueueSemanticCandidate(pool, {
    clientId, eventId: event.id, subjectEntityId: subject.id, relationType: "part_of",
    targetType: "concept", targetValue, targetNormalizedValue: targetValue.toLowerCase(),
    confidence: 0.92, rationale: "La evidencia confirma una compra con tarjeta.",
    extractor: "deepseek-v2", decisionKind: "reuse", domainValue: "Finances", anchorRole: "primary",
    proposedPath: ["Finances", "Financial activity", "Spending", targetValue],
    alternatives: [], associations: [], recurrenceCount: 1,
    governanceVersion: SEMANTIC_GOVERNANCE_VERSION, promptVersion: SEMANTIC_PROMPT_VERSION, model: "test",
    actionKind: "assign_existing_category",
    evidence: [{ ref: "event.body", excerpt: "SODIMAC SAYAGO", eventId: event.id, source: "Santander", occurredAt: event.timestamp }],
    evidenceEventIds: [event.id], verifiedEventCount: 1,
    verificationStatus: "verified", verification: { status: "verified" },
    policyVersion: DECISION_POLICY_VERSION, changeExplanation: `Clasificar la compra en ${targetValue}.`,
    decisionFingerprint: `fp_${randomUUID()}`,
  });
  return { clientId, event, subject, subjectValue, target, targetValue, candidate };
}

async function expectConflict(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(fn, (error: unknown) => {
    assert.ok(error instanceof SemanticCandidateConflictError);
    assert.equal(error.code, code);
    return true;
  });
}

test("approval revalidates ownership, verification, policy and no-effect state", async () => {
  const { clientId, candidate } = await fixture();
  const approved = await resolveSemanticCandidate(pool, candidate.id, { action: "approve", clientId, createRule: false });
  assert.equal(approved?.status, "approved");
  assert.equal(approved?.ruleCreated, false);
  const relation = await pool.query(`select 1 from relations where source_entity_id = $1 and relation_type = 'part_of'`, [candidate.subjectEntityId]);
  assert.equal(relation.rows.length, 1);
  const rules = await pool.query(`select 1 from semantic_rules where created_from_candidate_id = $1`, [candidate.id]);
  assert.equal(rules.rows.length, 0);
});

test("rule creation only happens for eligible repeatable assignments and when explicitly requested", async () => {
  const { clientId, candidate } = await fixture();
  const approved = await resolveSemanticCandidate(pool, candidate.id, { action: "approve", clientId, createRule: true });
  assert.equal(approved?.ruleEligible, true);
  assert.equal(approved?.ruleCreated, true);
  const rules = await pool.query(`select 1 from semantic_rules where created_from_candidate_id = $1`, [candidate.id]);
  assert.equal(rules.rows.length, 1);
});

test("an unverified candidate cannot be approved", async () => {
  const { clientId, candidate } = await fixture();
  await pool.query(`update semantic_candidates set verification_status = 'rejected' where id = $1`, [candidate.id]);
  await expectConflict(() => resolveSemanticCandidate(pool, candidate.id, { action: "approve", clientId }), "semantic_candidate_unverified");
  const still = await pool.query(`select status from semantic_candidates where id = $1`, [candidate.id]);
  assert.equal(still.rows[0]?.status, "pending");
});

test("a candidate from an older policy cannot be approved", async () => {
  const { clientId, candidate } = await fixture();
  await pool.query(`update semantic_candidates set policy_version = 'evidence-grounded-v0' where id = $1`, [candidate.id]);
  await expectConflict(() => resolveSemanticCandidate(pool, candidate.id, { action: "approve", clientId }), "semantic_candidate_stale_policy");
});

test("a true self-link cannot be approved", async () => {
  const { clientId, candidate, subjectValue } = await fixture();
  await pool.query(`update semantic_candidates set target_type = 'activity_instance', target_value = $2, target_normalized_value = lower($2) where id = $1`, [candidate.id, subjectValue]);
  await expectConflict(() => resolveSemanticCandidate(pool, candidate.id, { action: "approve", clientId }), "semantic_candidate_self_link");
});

test("an already-applied change cannot be approved twice", async () => {
  const { clientId, candidate } = await fixture();
  await resolveSemanticCandidate(pool, candidate.id, { action: "approve", clientId });
  await pool.query(`update semantic_candidates set status = 'pending', resolved_at = null, resolved_target_entity_id = null where id = $1`, [candidate.id]);
  await expectConflict(() => resolveSemanticCandidate(pool, candidate.id, { action: "approve", clientId }), "semantic_candidate_no_effect");
});

test("a rejection is persisted as scoped negative feedback", async () => {
  const { candidate, clientId } = await fixture();
  const rejected = await resolveSemanticCandidate(pool, candidate.id, { action: "reject", clientId, reason: "No corresponde" });
  assert.equal(rejected?.status, "rejected");
  const feedback = await pool.query(`select 1 from semantic_candidate_feedback where candidate_id = $1 and decision_fingerprint = $2 and reason = 'user_rejected'`, [candidate.id, candidate.decisionFingerprint]);
  assert.equal(feedback.rows.length, 1);
});

test("candidate listing exposes additive evidence and verification fields", async () => {
  const { candidate } = await fixture();
  const items = await listSemanticCandidates(pool, candidate.clientId, "pending");
  const listed = items.find((item) => item.id === candidate.id);
  assert.ok(listed);
  assert.equal(listed?.actionKind, "assign_existing_category");
  assert.equal(listed?.verificationStatus, "verified");
  assert.equal(listed?.verifiedEventCount, 1);
  assert.ok(Array.isArray(listed?.evidence));
});
