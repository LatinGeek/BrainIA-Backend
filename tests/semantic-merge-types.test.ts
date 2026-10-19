import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool, withTransaction } from "../src/storage/postgres.ts";
import { mergeEntities, upsertEntity } from "../src/storage/entity-repository.ts";
import { consolidateProviderIdentity, enqueueSemanticCandidate, resolveSemanticCandidate } from "../src/storage/semantic-repository.ts";
import { createEntityAlias, enqueueEntityReview, resolveEntityReview } from "../src/storage/entity-alias-repository.ts";
import { reconcileSemanticGraph } from "../src/storage/semantic-reconciler.ts";
import { insertRawEvent } from "../src/storage/event-repository.ts";
import { claimBackgroundJob, completeBackgroundJob, enqueueBackgroundJob } from "../src/storage/job-repository.ts";
import { executeBackgroundJob } from "../src/storage/job-worker.ts";

const unique = (tag: string) => `${tag}-${randomUUID()}`;
async function entity(type: string, value = unique(type), ownerId: string | null = null) {
  const record = await upsertEntity(pool, { type, value, normalizedValue: value.toLowerCase(), description: `Durable identity for ${value}.`, identitySource: "ai" });
  if (ownerId) await pool.query(`update entities set owner_id = $2 where id = $1`, [record.id, ownerId]);
  return record;
}
async function review(entityId: string) {
  const record = await enqueueEntityReview(pool, { entityId, source: "test", originalValue: unique("ACME / LEGAL"), reason: "test" });
  assert.ok(record);
  return record;
}
async function candidate(subjectEntityId: string, target: { type: string; value: string; normalizedValue: string }, decisionKind = "merge") {
  return enqueueSemanticCandidate(pool, {
    clientId: null, eventId: null, subjectEntityId, decisionKind,
    relationType: decisionKind === "merge" ? "same_as" : "part_of",
    targetType: target.type, targetValue: target.value, targetNormalizedValue: target.normalizedValue,
    confidence: 0.99, rationale: "Review this proposed identity.",
  });
}
async function noMerges(ids: string[]) {
  const rows = await pool.query(`select * from entity_merges where alias_entity_id = any($1::text[])`, [ids]);
  assert.equal(rows.rows.length, 0);
}

test("mergeEntities retains its strict cross-type invariant", async () => {
  const app = await entity("app");
  const merchant = await entity("merchant");
  await assert.rejects(mergeEntities(pool, merchant.id, app.id), /Only entities of the same type can be merged/);
  await noMerges([app.id, merchant.id]);
});

test("provider normalization records cross-type skips and preserves taxonomy and owner boundaries", async () => {
  const name = unique("Provider");
  const app = await entity("app", name);
  const merchant = await entity("merchant", name);
  const concept = await entity("concept", name);
  const domain = await entity("domain", name);
  const foreign = await entity("sender", name, unique("other-owner"));
  const canonical = await withTransaction((db) => consolidateProviderIdentity(db, { type: "app", value: name, normalizedValue: name.toLowerCase() }));
  assert.equal(canonical.id, app.id);
  const metadata = await pool.query<{ metadata: { providerIdentityMergeSkips: unknown[] } }>(`select metadata from entities where id = $1`, [app.id]);
  assert.deepEqual(metadata.rows[0].metadata.providerIdentityMergeSkips, [{ entityId: merchant.id, type: "merchant", reason: "entity_type_mismatch" }]);
  await noMerges([app.id, merchant.id, concept.id, domain.id, foreign.id]);
  const types = await pool.query<{ type: string }>(`select type from entities where id = any($1::text[]) order by type`, [[concept.id, domain.id]]);
  assert.deepEqual(types.rows.map((row) => row.type), ["concept", "domain"]);
});

test("semantic merge approval leaves incompatible default and explicit targets pending without rules", async () => {
  const merchant = await entity("merchant");
  const app = await entity("app");
  for (const explicit of [false, true]) {
    const pending = await candidate(merchant.id, explicit ? merchant : app);
    const result = await withTransaction((db) => resolveSemanticCandidate(db, pending.id, { action: "approve", createRule: true, ...(explicit ? { targetEntityId: app.id } : {}) }));
    assert.equal(result?.status, "pending");
    assert.equal(result?.skipReason, "entity_type_mismatch");
    const stored = await pool.query<{ status: string; rationale: string; resolvedTarget: string | null }>(`select status, rationale, resolved_target_entity_id as "resolvedTarget" from semantic_candidates where id = $1`, [pending.id]);
    assert.equal(stored.rows[0].status, "pending");
    assert.match(stored.rows[0].rationale, /Merge skipped: entity_type_mismatch/);
    assert.equal(stored.rows[0].resolvedTarget, null);
    assert.equal((await pool.query(`select id from semantic_rules where created_from_candidate_id = $1`, [pending.id])).rows.length, 0);
  }
  await noMerges([merchant.id, app.id]);
});

test("same-type semantic merges and public concept-to-domain hierarchy still apply", async () => {
  const source = await entity("merchant");
  const target = await entity("merchant");
  const pending = await candidate(source.id, target);
  assert.equal((await withTransaction((db) => resolveSemanticCandidate(db, pending.id, { action: "approve" })))?.status, "approved");
  const concept = await entity("concept");
  const domain = await entity("domain");
  const hierarchy = await candidate(concept.id, domain, "reuse");
  assert.equal((await withTransaction((db) => resolveSemanticCandidate(db, hierarchy.id, { action: "approve" })))?.status, "approved");
  assert.equal((await pool.query(`select id from relations where source_entity_id = $1 and target_entity_id = $2 and relation_type = 'belongs_to_domain'`, [concept.id, domain.id])).rows.length, 1);
});

test("alias review skips explicit cross-type targets and shared aliases before any merge", async () => {
  const source = await entity("merchant");
  const target = await entity("merchant");
  const app = await entity("app");
  const pending = await review(source.id);
  const alias = unique("Shared alias");
  await createEntityAlias(pool, { entityId: app.id, alias });
  for (const input of [{ alias: unique("Friendly"), targetEntityId: app.id }, { alias }, { alias, targetEntityId: target.id }]) {
    const result = await resolveEntityReview(pool, pending.id, input);
    assert.equal(result?.status, "pending");
    assert.equal(result?.skipReason, "entity_type_mismatch");
    await noMerges([source.id, target.id, app.id]);
  }
  assert.equal((await pool.query<{ reason: string }>(`select reason from entity_review_queue where id = $1`, [pending.id])).rows[0].reason, "entity_type_mismatch");
  assert.equal((await pool.query<{ entityId: string }>(`select entity_id as "entityId" from entity_aliases where normalized_alias = $1`, [alias.toLowerCase()])).rows[0].entityId, app.id);
});

test("alias review preserves same-type friendly-name merges", async () => {
  const source = await entity("merchant");
  const target = await entity("merchant");
  const pending = await review(source.id);
  const result = await resolveEntityReview(pool, pending.id, { alias: unique("Friendly merchant"), targetEntityId: target.id });
  assert.equal(result?.review?.status, "resolved");
  assert.ok(result?.alias);
  assert.equal((await pool.query(`select alias_entity_id from entity_merges where alias_entity_id = any($1::text[])`, [[source.id, target.id]])).rows.length, 2);
});

test("friendly-name review checks legacy canonical root types before mutating either identity", async () => {
  const source = await entity("app");
  const target = await entity("app");
  const friendly = await entity("app");
  const legacyRoot = await entity("merchant");
  // Simulate legacy data that predates the same-type invariant. New storage
  // merges must never create this cross-type redirect themselves.
  await pool.query(`insert into entity_merges (alias_entity_id, canonical_entity_id, reason, confidence) values ($1,$2,'legacy_fixture',1)`, [friendly.id, legacyRoot.id]);
  const pending = await review(source.id);
  const result = await resolveEntityReview(pool, pending.id, { alias: friendly.value, targetEntityId: target.id });
  assert.equal(result?.status, "pending");
  assert.equal(result?.skipReason, "entity_type_mismatch");
  await noMerges([source.id, target.id]);
  const stored = await pool.query<{ identitySource: string }>(`select identity_source as "identitySource" from entities where id = $1`, [friendly.id]);
  assert.equal(stored.rows[0].identitySource, "ai");
});

test("same-type review candidates cannot merge across owners", async () => {
  const source = await entity("merchant", unique("Owned source"), unique("owner-a"));
  const target = await entity("merchant", unique("Owned target"), unique("owner-b"));
  const pending = await candidate(source.id, target);
  const result = await resolveSemanticCandidate(pool, pending.id, { action: "approve", targetEntityId: target.id });
  assert.equal(result?.status, "pending");
  assert.equal(result?.skipReason, "entity_owner_mismatch");
  const queued = await review(source.id);
  const aliasResult = await resolveEntityReview(pool, queued.id, { alias: target.value, targetEntityId: target.id });
  assert.equal(aliasResult?.status, "pending");
  assert.equal(aliasResult?.skipReason, "entity_owner_mismatch");
  await noMerges([source.id, target.id]);
});

test("reconciliation applies same-type pairs and reports a cross-type sibling for review", async () => {
  const owner = unique("owner");
  const app = await entity("app", unique("Application"), owner);
  const copy = await entity("app", unique("Application copy"), owner);
  const merchant = await entity("merchant", unique("Merchant"), owner);
  const originalKey = process.env.DEEPSEEK_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.DEEPSEEK_API_KEY = "test-key";
  let calls = 0;
  globalThis.fetch = async () => {
    const content = calls++ === 0
      ? { merges: [{ canonicalId: app.id, duplicateIds: [copy.id, merchant.id], confidence: 0.99, rationale: "Same identity." }], demotions: [] }
      : { mergeVerdicts: [copy.id, merchant.id].map((duplicateId) => ({ canonicalId: app.id, duplicateId, sameIdentity: true, confidence: 0.99, rationale: "Same identity." })), demotionVerdicts: [] };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
  };
  try {
    const result = await reconcileSemanticGraph({ ownerId: owner });
    assert.equal(result.status, "applied");
    assert.equal(result.merged, 1);
    assert.equal(result.review, 1);
    assert.equal(calls, 2);
    await noMerges([merchant.id]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test("semantic-enrichment job completes when a merchant has the provider app's name", async () => {
  const provider = unique("Merge regression provider");
  const merchant = await entity("merchant", provider);
  const eventId = unique("event");
  const owner = unique("job-owner");
  await insertRawEvent(pool, {
    id: eventId, source: provider, contractVersion: 1, kind: "notification",
    title: "Device offline", body: "The home sensor is offline.", timestamp: "2026-10-18T12:00:00Z", raw: {}, tags: [],
  }, owner, `${owner}:${eventId}`);
  const job = await enqueueBackgroundJob(pool, { clientId: owner, eventId, jobType: "semantic_enrichment", idempotencyKey: unique("semantic-merge"), payload: { eventId } });
  const claim = await claimBackgroundJob({ id: job.id, workerId: "semantic-merge-regression", leaseMs: 60_000 });
  assert.ok(claim);
  const execution = await executeBackgroundJob(claim);
  await completeBackgroundJob(claim, async (db) => {
    for (const effect of execution.effects) await effect(db);
  });
  const stored = await pool.query<{ status: string; lastError: string | null }>(`select status, last_error as "lastError" from background_jobs where id = $1`, [job.id]);
  assert.equal(stored.rows[0].status, "succeeded");
  assert.equal(stored.rows[0].lastError, null);
  await noMerges([merchant.id]);
  const app = await pool.query<{ metadata: { providerIdentityMergeSkips: Array<{ entityId: string }> } }>(`select metadata from entities where type = 'app' and normalized_value = $1`, [provider.toLowerCase()]);
  assert.ok(app.rows[0].metadata.providerIdentityMergeSkips.some((skip) => skip.entityId === merchant.id));
});

async function ownerOf(id: string) {
  return (await pool.query<{ ownerId: string | null }>(`select owner_id as "ownerId" from entities where id = $1`, [id])).rows[0]?.ownerId ?? null;
}

test("owned friendly-name review with an explicit same-owner target merges without an ownerless entity", async () => {
  const owner = unique("owner");
  const source = await entity("merchant", unique("Owned review source"), owner);
  const target = await entity("merchant", unique("Owned review target"), owner);
  const pending = await review(source.id);
  const friendly = unique("Owned friendly merchant");
  const result = await resolveEntityReview(pool, pending.id, { alias: friendly, targetEntityId: target.id });
  assert.equal(result?.review?.status, "resolved");
  assert.equal(result?.skipReason, undefined);
  const created = await pool.query<{ id: string; ownerId: string | null }>(`select id, owner_id as "ownerId" from entities where normalized_value = $1`, [friendly.toLowerCase()]);
  assert.equal(created.rows.length, 1);
  assert.equal(created.rows[0].ownerId, owner);
  const merges = await pool.query<{ alias: string; canonical: string }>(`select alias_entity_id as alias, canonical_entity_id as canonical from entity_merges where alias_entity_id = any($1::text[]) order by alias_entity_id`, [[source.id, target.id]]);
  assert.deepEqual(new Set(merges.rows.map((row) => row.alias)), new Set([source.id, target.id]));
  assert.equal(await ownerOf(source.id), owner);
  assert.equal(await ownerOf(target.id), owner);
});

test("owned default-target semantic merge approval creates a same-owner target and merges", async () => {
  const owner = unique("owner");
  const subject = await entity("merchant", unique("Owned semantic subject"), owner);
  const value = unique("Owned semantic target");
  const pending = await candidate(subject.id, { type: "merchant", value, normalizedValue: value.toLowerCase() });
  const result = await withTransaction((db) => resolveSemanticCandidate(db, pending.id, { action: "approve" }));
  assert.equal(result?.status, "approved");
  assert.equal(result && "skipReason" in result ? result.skipReason : undefined, undefined);
  const created = await pool.query<{ id: string; ownerId: string | null }>(`select id, owner_id as "ownerId" from entities where type = 'merchant' and normalized_value = $1`, [value.toLowerCase()]);
  assert.equal(created.rows.length, 1);
  assert.equal(created.rows[0].ownerId, owner);
  const merge = await pool.query<{ canonical: string }>(`select canonical_entity_id as canonical from entity_merges where alias_entity_id = $1`, [subject.id]);
  assert.equal(merge.rows[0]?.canonical, created.rows[0].id);
});

test("owner-aware creation still fails closed across owners and keeps public taxonomy ownerless", async () => {
  const ownerA = unique("owner-a");
  const ownerB = unique("owner-b");
  // Default merge target text already names another owner's identity.
  const subject = await entity("merchant", unique("Owner A subject"), ownerA);
  const foreign = await entity("merchant", unique("Owner B identity"), ownerB);
  const pending = await candidate(subject.id, foreign);
  const result = await withTransaction((db) => resolveSemanticCandidate(db, pending.id, { action: "approve" }));
  assert.equal(result?.status, "pending");
  assert.equal(result?.skipReason, "entity_owner_mismatch");
  assert.equal(await ownerOf(foreign.id), ownerB);
  const untouched = await pool.query<{ description: string }>(`select description from entities where id = $1`, [foreign.id]);
  assert.equal(untouched.rows[0].description, `Durable identity for ${foreign.value}.`);
  // A friendly name that already belongs to another owner is not unified.
  const source = await entity("merchant", unique("Owner A source"), ownerA);
  const target = await entity("merchant", unique("Owner A target"), ownerA);
  const queued = await review(source.id);
  const aliasResult = await resolveEntityReview(pool, queued.id, { alias: foreign.value, targetEntityId: target.id });
  assert.equal(aliasResult?.status, "pending");
  assert.equal(aliasResult?.skipReason, "entity_owner_mismatch");
  await noMerges([subject.id, foreign.id, source.id, target.id]);
  // Public taxonomy never inherits a personal owner.
  const concept = await upsertEntity(pool, { type: "concept", value: unique("Public concept"), normalizedValue: unique("public concept"), description: "Shared concept.", identitySource: "ai" }, { ownerId: ownerA });
  assert.equal(await ownerOf(concept.id), null);
});
