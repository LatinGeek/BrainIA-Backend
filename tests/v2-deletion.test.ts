import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  applyDeletionTombstoneCleanup,
  deletePersonalData,
  exportPersonalData,
  recordDeletionTombstone,
  tombstoneDeletion,
} from "../src/storage/data-controls.ts";
import { applyDeletionTombstonesAfterRestore } from "../src/storage/backup-verification.ts";
import { generateEmbedding, refreshEventEmbeddings, upsertEmbedding } from "../src/storage/embeddings.ts";
import { hybridRetrieve } from "../src/storage/hybrid-retrieval.ts";
import { insertDigestRun, listDigestRuns, loadDigestRunById } from "../src/storage/digest-repository.ts";
import { insertInsightRun, listInsightRuns, loadInsightRunById } from "../src/storage/insight-repository.ts";
import { createKnowledgeDigest } from "../src/storage/digests.ts";
import { createKnowledgeInsight } from "../src/storage/insights.ts";
import { listEntities } from "../src/storage/entity-repository.ts";
import { listRelations } from "../src/storage/relation-repository.ts";
import { getEntityGraph } from "../src/storage/graph-repository.ts";
import { searchKnowledge, filterEligibleRetrievalResults } from "../src/storage/search-repository.ts";
import { buildApp } from "../src/app.ts";
import { pool } from "../src/storage/postgres.ts";
import { authorizeModelDispatch, upsertSourceProcessingPolicy } from "../src/storage/privacy.ts";

function spyFetch() {
  const original = globalThis.fetch;
  const calls: Array<{ url: unknown; body: string }> = [];
  (globalThis as { fetch: typeof fetch }).fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ data: [{ embedding: Array.from({ length: 8 }, () => 0.1) }], usage: {} }), { status: 200 });
  }) as typeof fetch;
  return {
    calls,
    restore() { (globalThis as { fetch: typeof fetch }).fetch = original; },
  };
}

async function seedPolicy(ownerId: string, source: string) {
  return upsertSourceProcessingPolicy(pool, {
    ownerId, clientId: ownerId, source, enabled: true, sendToLlm: true,
    redactEmails: true, redactFinancialIdentifiers: true, retentionDays: null,
  });
}

async function seedEvent(ownerId: string, source: string, marker: string) {
  const id = randomUUID();
  await pool.query(`
    insert into raw_events (id, source, kind, title, body, client_id, owner_id, dedupe_key)
    values ($1,$2,'note',$3,$4,$5,$5,$1)
  `, [id, source, marker, `${marker} body`, ownerId]);
  return id;
}

async function seedEntity(ownerId: string, marker: string) {
  const id = randomUUID();
  await pool.query(`
    insert into entities (id, type, value, normalized_value, description, owner_id)
    values ($1,'merchant',$2,$3,$4,$5)
  `, [id, `${marker} merchant`, `${marker}-merchant`, `${marker} entity`, ownerId]);
  return id;
}

async function linkEventEntity(eventId: string, entityId: string, ownerId: string) {
  await pool.query(`
    insert into event_entities (id, event_id, entity_id, role, confidence, owner_id)
    values ($1,$2,$3,'merchant',1,$4)
  `, [randomUUID(), eventId, entityId, ownerId]);
}

async function seedRelation(input: {
  ownerId: string;
  sourceEntityId: string;
  targetEntityId: string;
  label: string;
  eventId?: string;
}) {
  const id = randomUUID();
  await pool.query(`
    insert into relations (id, source_entity_id, target_entity_id, relation_type, label, description, owner_id)
    values ($1,$2,$3,'related_to',$4,$5,$6)
  `, [id, input.sourceEntityId, input.targetEntityId, input.label, `${input.label} description`, input.ownerId]);
  if (input.eventId) {
    await pool.query(`
      insert into event_relations (id, event_id, relation_id, role, confidence, owner_id)
      values ($1,$2,$3,'implied',1,$4)
    `, [randomUUID(), input.eventId, id, input.ownerId]);
  }
  return id;
}

async function seedDerived(input: {
  ownerId: string;
  eventId: string;
  entityId: string;
  marker: string;
  source: string;
}) {
  const { ownerId, eventId, entityId, marker, source } = input;
  const factId = randomUUID();
  await pool.query(`
    insert into knowledge_facts (id, client_id, owner_id, event_id, fact_type, value,
      normalized_value, confidence, evidence, extractor_version)
    values ($1,$2,$2,$3,'merchant',$4::jsonb,$5,0.9,'{"quote":"x"}'::jsonb,'v2-test')
  `, [factId, ownerId, eventId, JSON.stringify({ marker }), marker]);

  await pool.query(`
    insert into classification_corrections (id, client_id, owner_id, event_id, source, descriptor, field, value)
    values ($1,$2,$2,$3,$4,$5,'merchant',$6)
  `, [randomUUID(), ownerId, eventId, source, `${marker} descriptor`, `${marker} corrected`]);
  await pool.query(`
    insert into classification_decisions (id, event_id, client_id, owner_id, provider, model, policy_version, result)
    values ($1,$2,$3,$3,'deepseek','deepseek-flash','v1','{"marker":"x"}'::jsonb)
  `, [randomUUID(), eventId, ownerId]);
  await pool.query(`
    insert into semantic_candidates (id, client_id, owner_id, event_id, subject_entity_id,
      relation_type, target_type, target_value, target_normalized_value, confidence, extractor)
    values ($1,$2,$2,$3,$4,'related_to','merchant',$5,$6,0.8,'semantic-v1')
  `, [randomUUID(), ownerId, eventId, entityId, `${marker} candidate`, `${marker}-candidate`]);
  await pool.query(`
    insert into semantic_observations (id, client_id, owner_id, event_id, subject_entity_id,
      proposed_value, proposed_normalized_value, parent_entity_id, confidence)
    values ($1,$2,$2,$3,$4,$5,$6,$4,0.8)
  `, [randomUUID(), ownerId, eventId, entityId, `${marker} observation`, `${marker}-observation`]);
  await pool.query(`
    insert into semantic_event_decisions (event_id, client_id, owner_id, status, decision)
    values ($1,$2,$2,'resolved','{"marker":"x"}'::jsonb)
  `, [eventId, ownerId]);
  await pool.query(`
    insert into event_semantic_anchors (event_id, domain_entity_id, anchor_entity_id, role, confidence, owner_id)
    values ($1,$2,$2,'primary',0.9,$3)
  `, [eventId, entityId, ownerId]);

  const insight = await insertInsightRun(pool, {
    ownerId, toolName: "knowledge_insight",
    query: marker,
    request: { eventIds: [eventId] },
    response: { summary: `${marker} insight summary` },
    summary: `${marker} insight summary`,
    evidence: [{ eventIds: [eventId], source }],
  });
  const digest = await insertDigestRun(pool, {
    ownerId, toolName: "knowledge_digest", scope: marker,
    request: { eventIds: [eventId] },
    response: { summary: `${marker} digest summary` },
    summary: `${marker} digest summary`,
  });
  const artifactId = randomUUID();
  await pool.query(`
    insert into intelligence_artifacts (id, client_id, owner_id, kind, objective, status, content, evidence)
    values ($1,$2,$2,'answer',$3,'ready',$4::jsonb,$5::jsonb)
  `, [artifactId, ownerId, `${marker} objective`,
    JSON.stringify({ title: `${marker} artifact`, summary: marker }),
    JSON.stringify([{ id: `event:${eventId}`, eventIds: [eventId], source }])]);
  await pool.query(`
    insert into intelligence_dependencies (artifact_id, event_id) values ($1,$2)
  `, [artifactId, eventId]);
  await pool.query(`
    insert into intelligence_feedback (id, artifact_id, client_id, owner_id, value)
    values ($1,$2,$3,$3,'useful')
  `, [randomUUID(), artifactId, ownerId]);

  const transactionId = randomUUID();
  const now = new Date().toISOString();
  await pool.query(`
    insert into financial_transactions (id, owner_id, kind, amount, currency, merchant_label,
      normalized_merchant, observed_at, window_start, window_end, evidence_count, primary_source, anchor_event_id)
    values ($1,$2,'expense',10.00,'UYU',$3,$4,$5,$5,$5,1,$6,$7)
  `, [transactionId, ownerId, `${marker} merchant`, `${marker}-merchant`, now, source, eventId]);
  await pool.query(`
    insert into financial_transaction_events (id, transaction_id, raw_event_id, owner_id, source, kind,
      amount, currency, merchant_label, normalized_merchant, observed_at, match_reason)
    values ($1,$2,$3,$4,$5,'expense',10.00,'UYU',$6,$7,$8,'exact')
  `, [randomUUID(), transactionId, eventId, ownerId, source, `${marker} merchant`, `${marker}-merchant`, now]);

  await pool.query(`
    insert into client_diagnostic_logs (id, client_id, owner_id, platform, component, level, event, message, occurred_at, metadata)
    values ($1,$2,$2,'android','capture','info','capture_failed','capture failed for event',$3,$4::jsonb)
  `, [randomUUID(), ownerId, now, JSON.stringify({ eventId })]);

  await upsertEmbedding(pool, {
    clientId: ownerId, ownerId, objectType: "event", objectId: eventId,
    content: `${marker} event embedding`,
  });
  await upsertEmbedding(pool, {
    clientId: ownerId, ownerId, objectType: "fact", objectId: factId,
    content: `${marker} fact embedding`,
  });
  await upsertEmbedding(pool, {
    clientId: ownerId, ownerId, objectType: "entity", objectId: entityId,
    content: `${marker} entity embedding`,
  });
  await upsertEmbedding(pool, {
    clientId: ownerId, ownerId, objectType: "insight", objectId: insight!.id,
    content: `${marker} insight embedding`,
  });
  await upsertEmbedding(pool, {
    clientId: ownerId, ownerId, objectType: "digest", objectId: digest!.id,
    content: `${marker} digest embedding`,
  });

  return { factId, insightId: insight!.id, digestId: digest!.id, artifactId, transactionId };
}

async function count(sql: string, params: unknown[] = []) {
  const result = await pool.query<{ count: number }>(sql, params);
  return Number(result.rows[0]?.count ?? 0);
}

test("B11/E11 tombstone makes the event and every derived family ineligible before cleanup", async () => {
  const ownerId = `deletion-owner-${randomUUID()}`;
  const source = `mail.deletion.${randomUUID()}`;
  const marker = `DELETION_MARKER_${randomUUID()}`;
  await seedPolicy(ownerId, source);
  const eventId = await seedEvent(ownerId, source, marker);
  const entityId = await seedEntity(ownerId, marker);
  await linkEventEntity(eventId, entityId, ownerId);
  const derived = await seedDerived({ ownerId, eventId, entityId, marker, source });

  const before = await hybridRetrieve(marker, { clientId: ownerId, includeGraph: false });
  assert.ok(before.results.some((row) => row.objectId === eventId), "control: event is retrievable before tombstone");

  const tombstone = await tombstoneDeletion({
    ownerId, eventId, clientId: ownerId, mode: "delete_all", reason: "acceptance-test",
  });
  assert.ok(tombstone);
  assert.equal(tombstone.status, "tombstoned");
  assert.ok(Date.parse(tombstone.backupExpiresAt) > Date.now());

  const event = await pool.query<{ privacyStatus: string; processingAllowed: boolean; processingStatus: string }>(`
    select privacy_status as "privacyStatus", processing_allowed as "processingAllowed",
      processing_status as "processingStatus" from raw_events where id = $1
  `, [eventId]);
  assert.equal(event.rows[0]?.privacyStatus, "hidden");
  assert.equal(event.rows[0]?.processingAllowed, false);
  assert.equal(event.rows[0]?.processingStatus, "discarded");

  const visibleFacts = await count(`select count(*)::int as count from knowledge_facts where event_id = $1 and visibility <> 'hidden'`, [eventId]);
  assert.equal(visibleFacts, 0);
  const staleEmbeddings = await count(`
    select count(*)::int as count from knowledge_embeddings
    where coalesce(metadata->>'policyStale','false') <> 'true'
      and ((object_type='event' and object_id=$1) or (object_type='entity' and object_id=$2))
  `, [eventId, entityId]);
  assert.equal(staleEmbeddings, 0);
  const insight = await pool.query<{ summary: string | null }>(`select summary from insight_runs where id = $1`, [derived.insightId]);
  assert.equal(insight.rows[0]?.summary, null);
  const artifact = await pool.query<{ status: string; content: unknown }>(`select status, content from intelligence_artifacts where id = $1`, [derived.artifactId]);
  assert.equal(artifact.rows[0]?.status, "stale");
  assert.equal(artifact.rows[0]?.content, null);

  const after = await hybridRetrieve(marker, { clientId: ownerId, includeGraph: false });
  const leaks = after.results.filter((row) => [eventId, entityId, derived.factId, derived.insightId, derived.digestId].includes(row.objectId));
  assert.deepEqual(leaks.map((row) => `${row.objectType}:${row.objectId}:${row.title}`), []);

  const decision = await authorizeModelDispatch(pool, {
    ownerId, purpose: "event_classification", sources: [source], eventIds: [eventId],
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.reason, "target_tombstoned");

  process.env.EMBEDDING_API_KEY = "test-key";
  process.env.EMBEDDING_API_URL = "http://127.0.0.1:9/embed";
  process.env.EMBEDDING_MODEL = "test-model";
  const spy = spyFetch();
  try {
    await generateEmbedding({ text: `${marker} forbidden`, clientId: ownerId, ownerId, authorization: decision });
    assert.equal(spy.calls.length, 0, "no model/embedding dispatch for tombstoned evidence");
  } finally {
    spy.restore();
    delete process.env.EMBEDDING_API_KEY;
    delete process.env.EMBEDDING_API_URL;
    delete process.env.EMBEDDING_MODEL;
  }

  // Cleanup is the second step and is allowed to run asynchronously.
  const cleanup = await withCleanup(derived, eventId, ownerId);
  assert.ok(cleanup.counts.facts >= 1);
});

async function withCleanup(derived: { insightId: string; digestId: string; artifactId: string; transactionId: string }, eventId: string, ownerId: string) {
  const result = await deletePersonalData({ ownerId, clientId: ownerId, eventId, mode: "delete_all", reason: "acceptance-cleanup" });
  assert.ok(result);
  assert.equal(await count(`select count(*)::int as count from raw_events where id = $1`, [eventId]), 0);
  assert.equal(await count(`select count(*)::int as count from knowledge_facts where event_id = $1`, [eventId]), 0);
  assert.equal(await count(`select count(*)::int as count from classification_corrections where event_id = $1`, [eventId]), 0);
  assert.equal(await count(`select count(*)::int as count from classification_decisions where event_id = $1`, [eventId]), 0);
  assert.equal(await count(`select count(*)::int as count from semantic_candidates where event_id = $1`, [eventId]), 0);
  assert.equal(await count(`select count(*)::int as count from semantic_observations where event_id = $1`, [eventId]), 0);
  assert.equal(await count(`select count(*)::int as count from event_semantic_anchors where event_id = $1`, [eventId]), 0);
  assert.equal(await count(`select count(*)::int as count from insight_runs where id = $1`, [derived.insightId]), 0);
  assert.equal(await count(`select count(*)::int as count from digest_runs where id = $1`, [derived.digestId]), 0);
  assert.equal(await count(`select count(*)::int as count from intelligence_artifacts where id = $1`, [derived.artifactId]), 0);
  assert.equal(await count(`select count(*)::int as count from financial_transactions where id = $1`, [derived.transactionId]), 0);
  assert.equal(await count(`select count(*)::int as count from knowledge_embeddings where object_type='event' and object_id=$1`, [eventId]), 0);
  return result;
}

test("B11/E11 replay/backfill cannot resurrect eligible deleted derived content", async () => {
  const ownerId = `deletion-replay-${randomUUID()}`;
  const source = `mail.replay.${randomUUID()}`;
  const marker = `REPLAY_MARKER_${randomUUID()}`;
  await seedPolicy(ownerId, source);
  const eventId = await seedEvent(ownerId, source, marker);
  const entityId = await seedEntity(ownerId, marker);
  await linkEventEntity(eventId, entityId, ownerId);
  await seedDerived({ ownerId, eventId, entityId, marker, source });
  const deleted = await deletePersonalData({ ownerId, clientId: ownerId, eventId, mode: "delete_all" });
  assert.ok(deleted);

  // Direct replay attempts of each derived family are blocked by the tombstone.
  const raw = await pool.query(`
    insert into raw_events (id, source, kind, title, body, client_id, owner_id, dedupe_key)
    values ($1,$2,'note',$3,$4,$5,$5,$1) returning id
  `, [eventId, source, marker, `${marker} body`, ownerId]);
  assert.equal(raw.rows.length, 0);
  const fact = await pool.query(`
    insert into knowledge_facts (id, client_id, owner_id, event_id, fact_type, value,
      normalized_value, confidence, evidence, extractor_version)
    values ($1,$2,$2,$3,'merchant','{"marker":"replay"}'::jsonb,'replay',0.9,'{}'::jsonb,'v2-test') returning id
  `, [randomUUID(), ownerId, eventId]);
  assert.equal(fact.rows.length, 0);
  const correction = await pool.query(`
    insert into classification_corrections (id, client_id, owner_id, event_id, source, descriptor, field, value)
    values ($1,$2,$2,$3,$4,'replay','merchant','x') returning id
  `, [randomUUID(), ownerId, eventId, source]);
  assert.equal(correction.rows.length, 0);
  const candidate = await pool.query(`
    insert into semantic_candidates (id, client_id, owner_id, event_id, subject_entity_id,
      relation_type, target_type, target_value, target_normalized_value, confidence, extractor)
    values ($1,$2,$2,$3,$4,'related_to','merchant','x','x',0.8,'semantic-v1') returning id
  `, [randomUUID(), ownerId, eventId, entityId]);
  assert.equal(candidate.rows.length, 0);
  const transaction = await pool.query(`
    insert into financial_transactions (id, owner_id, kind, amount, currency, merchant_label,
      normalized_merchant, observed_at, window_start, window_end, evidence_count, primary_source, anchor_event_id)
    values ($1,$2,'expense',10,'UYU','x','x',now(),now(),now(),1,$3,$4) returning id
  `, [randomUUID(), ownerId, source, eventId]);
  assert.equal(transaction.rows.length, 0);
  const embedding = await upsertEmbedding(pool, {
    clientId: ownerId, ownerId, objectType: "event", objectId: eventId, content: `${marker} replay`,
  });
  assert.equal(embedding, null);
  assert.deepEqual(await refreshEventEmbeddings(pool, eventId), []);
  assert.equal(await count(`select count(*)::int as count from knowledge_embeddings where object_type='event' and object_id=$1`, [eventId]), 0);
});

test("B11/E11 a second supporting observation keeps the canonical finance row and evidence", async () => {
  const ownerId = `deletion-finance-${randomUUID()}`;
  const source = `mail.finance.${randomUUID()}`;
  const marker = `FINANCE_MARKER_${randomUUID()}`;
  await seedPolicy(ownerId, source);
  const eventA = await seedEvent(ownerId, source, `${marker} A`);
  const eventB = await seedEvent(ownerId, source, `${marker} B`);
  const transactionId = randomUUID();
  const now = new Date().toISOString();
  await pool.query(`
    insert into financial_transactions (id, owner_id, kind, amount, currency, merchant_label,
      normalized_merchant, observed_at, window_start, window_end, evidence_count, primary_source, anchor_event_id)
    values ($1,$2,'expense',42.00,'UYU',$3,$4,$5,$5,$5,2,$6,$7)
  `, [transactionId, ownerId, `${marker} merchant`, `${marker}-merchant`, now, source, eventA]);
  for (const eventId of [eventA, eventB]) {
    await pool.query(`
      insert into financial_transaction_events (id, transaction_id, raw_event_id, owner_id, source, kind,
        amount, currency, merchant_label, normalized_merchant, observed_at, match_reason)
      values ($1,$2,$3,$4,$5,'expense',42.00,'UYU',$6,$7,$8,'exact')
    `, [randomUUID(), transactionId, eventId, ownerId, source, `${marker} merchant`, `${marker}-merchant`, now]);
  }

  const result = await deletePersonalData({ ownerId, clientId: ownerId, eventId: eventA, mode: "delete_all" });
  assert.ok(result);
  const retained = await pool.query<{ anchorEventId: string; evidenceCount: number }>(`
    select anchor_event_id as "anchorEventId", evidence_count as "evidenceCount"
    from financial_transactions where id = $1
  `, [transactionId]);
  assert.equal(retained.rows[0]?.anchorEventId, eventB);
  assert.equal(retained.rows[0]?.evidenceCount, 1);
  assert.equal(await count(`select count(*)::int as count from financial_transaction_events where transaction_id=$1 and raw_event_id=$2`, [transactionId, eventB]), 1);
  assert.equal(await count(`select count(*)::int as count from financial_transaction_events where transaction_id=$1 and raw_event_id=$2`, [transactionId, eventA]), 0);
  const supporting = await pool.query<{ privacyStatus: string }>(`select privacy_status as "privacyStatus" from raw_events where id = $1`, [eventB]);
  assert.equal(supporting.rows[0]?.privacyStatus, "standard");
});

test("B11/E11 restore applies the tombstone ledger before traffic is exposed", async () => {
  const ownerId = `deletion-restore-${randomUUID()}`;
  const source = `mail.restore.${randomUUID()}`;
  const marker = `RESTORE_MARKER_${randomUUID()}`;
  await seedPolicy(ownerId, source);
  // Simulate an older restored copy: the event and derived rows still look
  // eligible because the restored snapshot predates the deletion.
  const eventId = await seedEvent(ownerId, source, marker);
  const entityId = await seedEntity(ownerId, marker);
  await linkEventEntity(eventId, entityId, ownerId);
  await seedDerived({ ownerId, eventId, entityId, marker, source });
  await recordDeletionTombstone(pool, {
    ownerId, targetType: "event", targetId: eventId, mode: "delete_all",
    reason: "restored-ledger",
  });
  const before = await pool.query<{ privacyStatus: string }>(`select privacy_status as "privacyStatus" from raw_events where id = $1`, [eventId]);
  assert.equal(before.rows[0]?.privacyStatus, "standard");

  const gate = await applyDeletionTombstonesAfterRestore({
    restoreVerified: true,
    ledgerComplete: true,
  });
  assert.equal(gate.trafficBlocked, true);
  assert.ok(gate.applied >= 1);
  assert.equal(await count(`select count(*)::int as count from raw_events where id=$1 and (privacy_status <> 'hidden' or processing_allowed)`, [eventId]), 0);
  assert.equal(await count(`select count(*)::int as count from knowledge_facts where event_id=$1`, [eventId]), 0);
  const after = await hybridRetrieve(marker, { clientId: ownerId, includeGraph: false });
  assert.equal(after.results.some((row) => row.objectId === eventId), false);
});

test("B11/E11 foreign or ownerless deletion is rejected and mutates nothing", async () => {
  const ownerA = `deletion-owner-a-${randomUUID()}`;
  const ownerB = `deletion-owner-b-${randomUUID()}`;
  const source = `mail.foreign.${randomUUID()}`;
  const marker = `FOREIGN_MARKER_${randomUUID()}`;
  await seedPolicy(ownerA, source);
  await seedPolicy(ownerB, source);
  const eventId = await seedEvent(ownerB, source, marker);
  const factId = randomUUID();
  await pool.query(`
    insert into knowledge_facts (id, client_id, owner_id, event_id, fact_type, value,
      normalized_value, confidence, evidence, extractor_version)
    values ($1,$2,$2,$3,'merchant','{"marker":"foreign"}'::jsonb,'foreign',0.9,'{}'::jsonb,'v2-test')
  `, [factId, ownerB, eventId]);

  const tombstone = await tombstoneDeletion({ ownerId: ownerA, clientId: ownerA, eventId, mode: "delete_all" });
  assert.equal(tombstone, null);
  const deleted = await deletePersonalData({ ownerId: ownerA, clientId: ownerA, eventId, mode: "delete_all" });
  assert.equal(deleted, null);
  const ownerless = await deletePersonalData({ ownerId: null, clientId: null, eventId, mode: "delete_all" });
  assert.equal(ownerless, null);

  assert.equal(await count(`select count(*)::int as count from deletion_tombstones where target_id=$1`, [eventId]), 0);
  const event = await pool.query<{ privacyStatus: string; processingAllowed: boolean }>(`
    select privacy_status as "privacyStatus", processing_allowed as "processingAllowed" from raw_events where id=$1
  `, [eventId]);
  assert.equal(event.rows[0]?.privacyStatus, "standard");
  assert.equal(event.rows[0]?.processingAllowed, true);
  assert.equal(await count(`select count(*)::int as count from knowledge_facts where id=$1 and visibility='visible'`, [factId]), 1);
});

test("B11 r2/D1+D6 legacy reads and export exclude tombstoned and hidden content", async () => {
  const ownerId = `deletion-read-${randomUUID()}`;
  const source = `mail.read.${randomUUID()}`;
  const marker = `READ_MARKER_${randomUUID()}`;
  await seedPolicy(ownerId, source);
  const eventId = await seedEvent(ownerId, source, marker);
  const entityId = await seedEntity(ownerId, marker);
  const targetEntityId = await seedEntity(ownerId, `${marker}-target`);
  await linkEventEntity(eventId, entityId, ownerId);
  const relationId = await seedRelation({
    ownerId, sourceEntityId: entityId, targetEntityId, label: `${marker} relation`, eventId,
  });
  const now = Date.now();
  const windowDigest = await insertDigestRun(pool, {
    ownerId, toolName: "knowledge_digest", scope: marker,
    windowFrom: new Date(now - 86_400_000).toISOString(),
    windowTo: new Date(now + 86_400_000).toISOString(),
    request: { from: "window-only", to: "window-only" },
    response: { summary: `${marker} unlinked digest` },
    summary: `${marker} unlinked digest`,
  });
  const entityInsight = await insertInsightRun(pool, {
    ownerId, toolName: "knowledge_insight",
    request: { id: entityId },
    response: { summary: `${marker} entity insight` },
    summary: `${marker} entity insight`,
    evidence: [],
  });
  assert.ok(windowDigest);
  assert.ok(entityInsight);

  // Only the tombstone/quarantine step runs: no physical cleanup yet.
  const tombstone = await tombstoneDeletion({
    ownerId, clientId: ownerId, eventId, mode: "delete_knowledge", reason: "read-regression",
  });
  assert.ok(tombstone);

  const search = await searchKnowledge(marker, { clientId: ownerId });
  assert.equal(search.events.length, 0, "search must not return the hidden event");
  assert.equal(search.entities.some((entity) => entity.id === entityId), false, "search must not return the hidden entity");
  assert.equal(search.relations.length, 0, "search must not return a deleted-evidence relation");

  const entities = await listEntities(ownerId);
  assert.equal(entities.some((entity) => entity.id === entityId), false);
  const relations = await listRelations(ownerId);
  assert.equal(relations.some((relation) => relation.id === relationId), false);
  assert.equal(await getEntityGraph(entityId, 1, 50, 50), null);

  const retrieval = await filterEligibleRetrievalResults(
    await hybridRetrieve(marker, { clientId: ownerId, includeGraph: false }),
    ownerId,
  );
  assert.deepEqual(retrieval.results, []);
  assert.equal(retrieval.results.some((result) => result.objectId === windowDigest!.id), false);
  assert.equal(retrieval.results.some((result) => result.objectId === entityInsight!.id), false);

  const exported = await exportPersonalData(ownerId);
  assert.equal(exported.data.rawEvents.some((event) => (event as { id: string }).id === eventId), false);
  assert.equal(exported.data.entities.some((entity) => (entity as { id: string }).id === entityId), false);
  assert.equal(exported.data.relations.some((relation) => (relation as { id: string }).id === relationId), false);
  assert.equal(exported.data.digests.some((digest) => (digest as { id: string }).id === windowDigest!.id), false);
  assert.equal(exported.data.insights.some((insight) => (insight as { id: string }).id === entityInsight!.id), false);
});

test("B11 r2/D2 delete_all hides personal entities from lists, graph and search", async () => {
  const ownerId = `deletion-hidden-${randomUUID()}`;
  const source = `mail.hidden.${randomUUID()}`;
  const marker = `HIDDEN_MARKER_${randomUUID()}`;
  await seedPolicy(ownerId, source);
  const eventId = await seedEvent(ownerId, source, marker);
  const entityId = await seedEntity(ownerId, marker);
  await linkEventEntity(eventId, entityId, ownerId);

  const deleted = await deletePersonalData({ ownerId, clientId: ownerId, eventId, mode: "delete_all" });
  assert.ok(deleted);
  const entity = await pool.query<{ visibility: string }>(`select visibility from entities where id = $1`, [entityId]);
  assert.equal(entity.rows[0]?.visibility, "hidden");

  assert.equal((await listEntities(ownerId)).some((row) => row.id === entityId), false);
  assert.equal(await getEntityGraph(entityId, 1, 50, 50), null);
  const search = await searchKnowledge(marker, { clientId: ownerId });
  assert.equal(search.entities.some((row) => row.id === entityId), false);
});

test("B11 r2/D3 deletion removes unlinked window digests and entity-only insights", async () => {
  const ownerId = `deletion-lineage-${randomUUID()}`;
  const source = `mail.lineage.${randomUUID()}`;
  const marker = `LINEAGE_MARKER_${randomUUID()}`;
  await seedPolicy(ownerId, source);
  const eventId = await seedEvent(ownerId, source, marker);
  const entityId = await seedEntity(ownerId, marker);
  await linkEventEntity(eventId, entityId, ownerId);
  const now = Date.now();

  // Window digest with no persisted event id: only the time window references it.
  const digest = await insertDigestRun(pool, {
    ownerId, toolName: "knowledge_digest", scope: marker,
    windowFrom: new Date(now - 86_400_000).toISOString(),
    windowTo: new Date(now + 86_400_000).toISOString(),
    request: { from: "window-only", to: "window-only" },
    response: { summary: `${marker} unlinked digest` },
    summary: `${marker} unlinked digest`,
  });
  assert.ok(digest);
  // Insight whose only lineage is the entity id, not the event id.
  const insight = await insertInsightRun(pool, {
    ownerId, toolName: "knowledge_insight",
    request: { id: entityId },
    response: { summary: `${marker} entity insight` },
    summary: `${marker} entity insight`,
    evidence: [],
  });
  assert.ok(insight);

  const deleted = await deletePersonalData({ ownerId, clientId: ownerId, eventId, mode: "delete_knowledge" });
  assert.ok(deleted);
  assert.equal(await count(`select count(*)::int as count from digest_runs where id=$1`, [digest.id]), 0);
  assert.equal(await count(`select count(*)::int as count from insight_runs where id=$1`, [insight.id]), 0);
  assert.equal((await listDigestRuns(10, ownerId)).some((run) => run.id === digest.id), false);
  assert.equal((await listInsightRuns(10, ownerId)).some((run) => run.id === insight.id), false);
});

test("B11 r2/D4 replay guards cover classified rows, event links and derived runs", async () => {
  const ownerId = `deletion-replay2-${randomUUID()}`;
  const source = `mail.replay2.${randomUUID()}`;
  const marker = `REPLAY2_MARKER_${randomUUID()}`;
  await seedPolicy(ownerId, source);
  const eventId = await seedEvent(ownerId, source, marker);
  const entityId = await seedEntity(ownerId, marker);
  const targetEntityId = await seedEntity(ownerId, `${marker}-target`);
  await linkEventEntity(eventId, entityId, ownerId);
  const relationId = await seedRelation({
    ownerId, sourceEntityId: entityId, targetEntityId, label: `${marker} relation`,
  });
  const deleted = await deletePersonalData({ ownerId, clientId: ownerId, eventId, mode: "delete_knowledge" });
  assert.ok(deleted);

  const classified = await pool.query(`
    insert into classified_events (id, raw_event_id, inferred_kind, confidence, owner_id)
    values ($1,$2,'note',0.9,$3) returning id
  `, [randomUUID(), eventId, ownerId]);
  assert.equal(classified.rows.length, 0);

  const entityLink = await pool.query(`
    insert into event_entities (id, event_id, entity_id, role, confidence, owner_id)
    values ($1,$2,$3,'merchant',1,$4) returning id
  `, [randomUUID(), eventId, entityId, ownerId]);
  assert.equal(entityLink.rows.length, 0);

  const relationLink = await pool.query(`
    insert into event_relations (id, event_id, relation_id, role, confidence, owner_id)
    values ($1,$2,$3,'implied',1,$4) returning id
  `, [randomUUID(), eventId, relationId, ownerId]);
  assert.equal(relationLink.rows.length, 0);

  const insight = await pool.query(`
    insert into insight_runs (id, tool_name, query, request, response, summary, owner_id, evidence)
    values ($1,'replay','replay',$2::jsonb,'{}'::jsonb,'replay',$3,$2::jsonb) returning id
  `, [randomUUID(), JSON.stringify({ eventIds: [eventId] }), ownerId]);
  assert.equal(insight.rows.length, 0);

  const digest = await pool.query(`
    insert into digest_runs (id, tool_name, scope, window_from, window_to, request, response, summary, owner_id)
    values ($1,'replay','replay',$2::timestamptz,$3::timestamptz,'{}'::jsonb,'{}'::jsonb,'replay',$4) returning id
  `, [randomUUID(), new Date(Date.now() - 86_400_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString(), ownerId]);
  assert.equal(digest.rows.length, 0);

  assert.equal(await insertInsightRun(pool, {
    ownerId, toolName: "replay", request: { eventIds: [eventId] }, response: { summary: "replay" },
    summary: "replay", evidence: [{ eventIds: [eventId], source }],
  }), null);
  assert.equal(await insertDigestRun(pool, {
    ownerId, toolName: "replay", scope: "replay",
    windowFrom: new Date(Date.now() - 86_400_000).toISOString(),
    windowTo: new Date(Date.now() + 86_400_000).toISOString(),
    request: { eventIds: [eventId] }, response: { summary: "replay" }, summary: "replay",
  }), null);
});

test("B11 r2/D5 post-deletion generation cannot use hidden evidence", async () => {
  const ownerId = `deletion-generate-${randomUUID()}`;
  const source = `mail.generate.${randomUUID()}`;
  const marker = `GENERATE_MARKER_${randomUUID()}`;
  await seedPolicy(ownerId, source);
  const eventId = await seedEvent(ownerId, source, marker);
  const entityId = await seedEntity(ownerId, marker);
  await linkEventEntity(eventId, entityId, ownerId);
  const deleted = await deletePersonalData({ ownerId, clientId: ownerId, eventId, mode: "delete_knowledge" });
  assert.ok(deleted);

  const now = Date.now();
  const digest = await createKnowledgeDigest({
    ownerId,
    from: new Date(now - 86_400_000).toISOString(),
    to: new Date(now + 86_400_000).toISOString(),
    eventLimit: 50,
  });
  assert.equal(digest.metrics.totalEvents, 0);
  assert.equal(digest.recentEvents.some((event) => event.id === eventId), false);
  assert.deepEqual(digest.lineage?.eventIds ?? [], []);
  assert.equal(await insertDigestRun(pool, {
    ownerId, toolName: "post_deletion", scope: "post_deletion",
    windowFrom: new Date(now - 86_400_000).toISOString(),
    windowTo: new Date(now + 86_400_000).toISOString(),
    request: { eventIds: [eventId] }, response: { summary: marker }, summary: marker,
  }), null);

  const insight = await createKnowledgeInsight({ id: entityId, clientId: ownerId });
  assert.equal(insight.resolution.mode, "not_found");
  assert.equal(insight.supportingEntities.some((entity) => entity.id === entityId), false);
  assert.deepEqual(insight.lineage?.eventIds ?? [], []);
  assert.equal(await insertInsightRun(pool, {
    ownerId, toolName: "post_deletion", request: { id: entityId },
    response: { summary: marker }, summary: marker, evidence: [],
  }), null);
  assert.deepEqual(await listInsightRuns(10, ownerId), []);
  assert.deepEqual(await listDigestRuns(10, ownerId), []);
});

test("B11 r2/D1+D5 HTTP routes stop serving and generating from hidden evidence", async () => {
  const ownerId = `deletion-http-${randomUUID()}`;
  const source = `mail.http.${randomUUID()}`;
  const marker = `HTTP_MARKER_${randomUUID()}`;
  await seedPolicy(ownerId, source);
  const eventId = await seedEvent(ownerId, source, marker);
  const entityId = await seedEntity(ownerId, marker);
  const targetEntityId = await seedEntity(ownerId, `${marker}-target`);
  await linkEventEntity(eventId, entityId, ownerId);
  const relationId = await seedRelation({
    ownerId, sourceEntityId: entityId, targetEntityId, label: `${marker} relation`, eventId,
  });
  const now = Date.now();
  const windowDigest = await insertDigestRun(pool, {
    ownerId, toolName: "knowledge_digest", scope: marker,
    windowFrom: new Date(now - 86_400_000).toISOString(),
    windowTo: new Date(now + 86_400_000).toISOString(),
    request: { from: "window-only", to: "window-only" },
    response: { summary: `${marker} unlinked digest` },
    summary: `${marker} unlinked digest`,
  });
  assert.ok(windowDigest);
  await tombstoneDeletion({
    ownerId, clientId: ownerId, eventId, mode: "delete_knowledge", reason: "http-regression",
  });

  const app = await buildApp();
  const headers = { "x-brainia-client-id": ownerId };
  try {
    const search = await app.inject({ method: "GET", url: `/api/v1/search?q=${encodeURIComponent(marker)}`, headers });
    assert.equal(search.statusCode, 200);
    const searchBody = search.json() as {
      events: Array<{ id: string }>; entities: Array<{ id: string }>; relations: Array<{ id: string }>;
    };
    assert.equal(searchBody.events.some((row) => row.id === eventId), false);
    assert.equal(searchBody.entities.some((row) => row.id === entityId), false);
    assert.equal(searchBody.relations.some((row) => row.id === relationId), false);

    const entities = await app.inject({ method: "GET", url: "/api/v1/entities", headers });
    assert.equal((entities.json() as Array<{ id: string }>).some((row) => row.id === entityId), false);
    const relations = await app.inject({ method: "GET", url: "/api/v1/relations", headers });
    assert.equal((relations.json() as Array<{ id: string }>).some((row) => row.id === relationId), false);

    const graph = await app.inject({ method: "GET", url: `/api/v1/entities/${entityId}/graph?depth=1`, headers });
    assert.equal(graph.statusCode, 404);

    const hybrid = await app.inject({
      method: "GET", url: `/api/v1/retrieval/hybrid?q=${encodeURIComponent(marker)}&limit=20`, headers,
    });
    assert.equal(hybrid.statusCode, 200);
    const hybridBody = hybrid.json() as { results: Array<{ objectType: string; objectId: string }> };
    assert.equal(hybridBody.results.some((row) => row.objectId === eventId || row.objectId === relationId || row.objectId === windowDigest!.id), false);

    const digest = await app.inject({
      method: "GET", url: `/api/v1/digests?from=${encodeURIComponent(new Date(now - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(now + 86_400_000).toISOString())}`,
      headers,
    });
    assert.equal(digest.statusCode, 200);
    const digestBody = digest.json() as { metrics: { totalEvents: number }; recentEvents: Array<{ id: string }> };
    assert.equal(digestBody.metrics.totalEvents, 0);
    assert.equal(digestBody.recentEvents.some((row) => row.id === eventId), false);

    const insight = await app.inject({
      method: "GET", url: `/api/v1/insights?id=${encodeURIComponent(entityId)}`, headers,
    });
    assert.equal(insight.statusCode, 200);
    const insightBody = insight.json() as {
      audit: unknown; supportingEntities: Array<{ id: string }>; resolution: { mode: string };
    };
    assert.equal(insightBody.supportingEntities.some((row) => row.id === entityId), false);
    assert.equal(insightBody.resolution.mode, "not_found");
    assert.equal(insightBody.audit, null);

    const exported = await app.inject({ method: "GET", url: "/api/v1/privacy/export", headers });
    assert.equal(exported.statusCode, 200);
    const exportBody = exported.json() as { data: { rawEvents: Array<{ id: string }> } };
    assert.equal(exportBody.data.rawEvents.some((row) => row.id === eventId), false);
  } finally {
    await app.close();
  }
});

test("B11 r2/D7 empty ledger is not traffic-safe without explicit restore verification", async () => {
  const emptyLedger = { query: async () => ({ rows: [] }) } as unknown as Pick<typeof pool, "query">;
  const defaultGate = await applyDeletionTombstonesAfterRestore({ ledger: emptyLedger });
  assert.equal(defaultGate.tombstones, 0);
  assert.equal(defaultGate.trafficBlocked, false);
  assert.equal(defaultGate.reason, "empty_ledger_not_traffic_safe_without_explicit_verification");

  const verifiedGate = await applyDeletionTombstonesAfterRestore({
    ledger: emptyLedger,
    restoreVerified: true,
    ledgerComplete: true,
  });
  assert.equal(verifiedGate.trafficBlocked, true);
});

test("B11 r3/R1 legacy r1 tombstones are re-evaluated at read time for derived runs", async () => {
  const ownerId = `deletion-legacy-runs-${randomUUID()}`;
  const source = `mail.legacy-runs.${randomUUID()}`;
  const marker = `LEGACY_RUN_MARKER_${randomUUID()}`;
  await seedPolicy(ownerId, source);
  const eventId = await seedEvent(ownerId, source, marker);
  const entityId = await seedEntity(ownerId, marker);
  await linkEventEntity(eventId, entityId, ownerId);

  const now = Date.now();
  // Exact shape r1's heuristic missed: a window digest with no persisted event
  // id and an insight that only references an entity id.
  const legacyDigest = await insertDigestRun(pool, {
    ownerId, toolName: "legacy_digest", scope: marker,
    windowFrom: new Date(now - 86_400_000).toISOString(),
    windowTo: new Date(now + 86_400_000).toISOString(),
    request: { from: "window-only", to: "window-only" },
    response: { summary: `${marker} legacy window digest` },
    summary: `${marker} legacy window digest`,
  });
  const legacyInsight = await insertInsightRun(pool, {
    ownerId, toolName: "legacy_insight",
    request: { id: entityId },
    response: { summary: `${marker} legacy entity insight` },
    summary: `${marker} legacy entity insight`,
    evidence: [],
  });
  assert.ok(legacyDigest);
  assert.ok(legacyInsight);

  // A legacy r1 tombstone is the ledger row without the r2 quarantine/cleanup.
  // It must still be honored at read time, with no migration or backfill.
  const tombstone = await recordDeletionTombstone(pool, {
    ownerId, targetType: "event", targetId: eventId, mode: "delete_knowledge",
    reason: "legacy-r1-ledger",
  });
  assert.ok(tombstone);
  assert.equal(await count(`select count(*)::int as count from digest_runs where id=$1`, [legacyDigest.id]), 1);
  assert.equal(await count(`select count(*)::int as count from insight_runs where id=$1`, [legacyInsight.id]), 1);

  const digests = await listDigestRuns(25, ownerId);
  assert.equal(digests.some((run) => run.id === legacyDigest.id), false, "list must hide the legacy window digest");
  const insights = await listInsightRuns(25, ownerId);
  assert.equal(insights.some((run) => run.id === legacyInsight.id), false, "list must hide the legacy entity insight");
  assert.equal(await loadDigestRunById(legacyDigest.id, ownerId), null);
  assert.equal(await loadInsightRunById(legacyInsight.id, ownerId), null);

  const hybrid = await hybridRetrieve(marker, { clientId: ownerId, includeGraph: false });
  const hybridIds = hybrid.results.map((result) => result.objectId);
  assert.equal(hybridIds.includes(legacyDigest.id), false, "hybrid text retrieval must hide the legacy digest");
  assert.equal(hybridIds.includes(legacyInsight.id), false, "hybrid text retrieval must hide the legacy insight");
  const filtered = await filterEligibleRetrievalResults(hybrid, ownerId);
  assert.equal(filtered.results.some((result) => result.objectId === legacyDigest.id || result.objectId === legacyInsight.id), false);

  const exported = await exportPersonalData(ownerId);
  assert.equal(exported.data.digests.some((digest) => (digest as { id: string }).id === legacyDigest.id), false);
  assert.equal(exported.data.insights.some((insight) => (insight as { id: string }).id === legacyInsight.id), false);

  const app = await buildApp();
  const headers = { "x-brainia-client-id": ownerId };
  try {
    const digestHistory = await app.inject({ method: "GET", url: "/api/v1/digests/history", headers });
    assert.equal(digestHistory.statusCode, 200);
    const digestBody = digestHistory.json() as { count: number; runs: Array<{ id: string }> };
    assert.equal(digestBody.runs.some((run) => run.id === legacyDigest.id), false);
    const insightHistory = await app.inject({ method: "GET", url: "/api/v1/insights/history", headers });
    assert.equal(insightHistory.statusCode, 200);
    const insightBody = insightHistory.json() as { count: number; runs: Array<{ id: string }> };
    assert.equal(insightBody.runs.some((run) => run.id === legacyInsight.id), false);

    const digestById = await app.inject({ method: "GET", url: `/api/v1/digests/history/${legacyDigest.id}`, headers });
    assert.equal(digestById.statusCode, 404);
    const insightById = await app.inject({ method: "GET", url: `/api/v1/insights/history/${legacyInsight.id}`, headers });
    assert.equal(insightById.statusCode, 404);

    const hybridRoute = await app.inject({
      method: "GET", url: `/api/v1/retrieval/hybrid?q=${encodeURIComponent(marker)}&limit=20`, headers,
    });
    assert.equal(hybridRoute.statusCode, 200);
    const hybridBody = hybridRoute.json() as { results: Array<{ objectType: string; objectId: string }> };
    assert.equal(hybridBody.results.some((row) => row.objectId === legacyDigest.id || row.objectId === legacyInsight.id), false);

    const exportRoute = await app.inject({ method: "GET", url: "/api/v1/privacy/export", headers });
    assert.equal(exportRoute.statusCode, 200);
    const exportBody = exportRoute.json() as {
      data: { insights: Array<{ id: string }>; digests: Array<{ id: string }> };
    };
    assert.equal(exportBody.data.insights.some((row) => row.id === legacyInsight.id), false);
    assert.equal(exportBody.data.digests.some((row) => row.id === legacyDigest.id), false);
  } finally {
    await app.close();
  }
});

test("B11 r3/R2 an unlinked summary replay after a tombstone is rejected and never served", async () => {
  const ownerId = `deletion-unlinked-replay-${randomUUID()}`;
  const source = `mail.unlinked-replay.${randomUUID()}`;
  const marker = `UNLINKED_REPLAY_${randomUUID()}`;
  await seedPolicy(ownerId, source);
  const eventId = await seedEvent(ownerId, source, marker);
  const entityId = await seedEntity(ownerId, marker);
  await linkEventEntity(eventId, entityId, ownerId);
  const deleted = await deletePersonalData({ ownerId, clientId: ownerId, eventId, mode: "delete_all" });
  assert.ok(deleted);
  assert.equal(await count(`select count(*)::int as count from raw_events where id=$1`, [eventId]), 0);

  // The exact r2 replay shape: a summary-only run with no evidence, no query
  // and no digest window. Both the repository and a direct SQL write are denied.
  const replayInsight = await insertInsightRun(pool, {
    ownerId, toolName: "replay", query: null, request: {}, response: {},
    summary: `${marker} resurrected summary`, evidence: [],
  });
  assert.equal(replayInsight, null);
  const replayDigest = await insertDigestRun(pool, {
    ownerId, toolName: "replay", request: {}, response: {},
    summary: `${marker} resurrected digest`,
  });
  assert.equal(replayDigest, null);

  const directInsight = await pool.query(`
    insert into insight_runs (id, tool_name, query, request, response, summary, owner_id, evidence)
    values ($1,'replay',null,'{}'::jsonb,'{}'::jsonb,$2,$3,'[]'::jsonb) returning id
  `, [randomUUID(), `${marker} resurrected summary`, ownerId]);
  assert.equal(directInsight.rows.length, 0);
  const directDigest = await pool.query(`
    insert into digest_runs (id, tool_name, scope, window_from, window_to, request, response, summary, owner_id)
    values ($1,'replay',null,null,null,'{}'::jsonb,'{}'::jsonb,$2,$3) returning id
  `, [randomUUID(), `${marker} resurrected digest`, ownerId]);
  assert.equal(directDigest.rows.length, 0);

  assert.equal(await count(`select count(*)::int as count from insight_runs where owner_id=$1`, [ownerId]), 0);
  assert.equal(await count(`select count(*)::int as count from digest_runs where owner_id=$1`, [ownerId]), 0);
  assert.deepEqual(await listInsightRuns(25, ownerId), []);
  assert.deepEqual(await listDigestRuns(25, ownerId), []);

  const hybrid = await hybridRetrieve(marker, { clientId: ownerId, includeGraph: false });
  assert.equal(hybrid.count, 0);
  const retrieval = await filterEligibleRetrievalResults(hybrid, ownerId);
  assert.equal(retrieval.results.some((result) => result.excerpt.includes(marker) || result.title.includes(marker)), false);

  const app = await buildApp();
  const headers = { "x-brainia-client-id": ownerId };
  try {
    const insightHistory = await app.inject({ method: "GET", url: "/api/v1/insights/history", headers });
    assert.equal(insightHistory.statusCode, 200);
    const insightBody = insightHistory.json() as { count: number; runs: Array<{ summary: string | null }> };
    assert.equal(insightBody.count, 0);
    assert.equal(insightBody.runs.some((run) => String(run.summary ?? "").includes(marker)), false);
    const digestHistory = await app.inject({ method: "GET", url: "/api/v1/digests/history", headers });
    assert.equal(digestHistory.statusCode, 200);
    const digestBody = digestHistory.json() as { count: number; runs: Array<{ summary: string | null }> };
    assert.equal(digestBody.count, 0);

    const hybridRoute = await app.inject({
      method: "GET", url: `/api/v1/retrieval/hybrid?q=${encodeURIComponent(marker)}&limit=20`, headers,
    });
    assert.equal(hybridRoute.statusCode, 200);
    const hybridBody = hybridRoute.json() as { count: number; results: Array<{ excerpt: string; title: string }> };
    assert.equal(hybridBody.count, 0);
    assert.equal(hybridBody.results.some((row) => row.excerpt.includes(marker) || row.title.includes(marker)), false);
  } finally {
    await app.close();
  }

  // Control: a legitimate post-tombstone run with explicit live event lineage is
  // still writable and readable, so the guard is not a blanket freeze.
  const liveMarker = `${marker}_LIVE`;
  const liveEventId = await seedEvent(ownerId, source, liveMarker);
  const legitimate = await insertInsightRun(pool, {
    ownerId, toolName: "legitimate", query: liveMarker,
    request: { eventIds: [liveEventId] },
    response: { summary: `${liveMarker} live summary` },
    summary: `${liveMarker} live summary`,
    evidence: [{ eventIds: [liveEventId], source }],
  });
  assert.ok(legitimate);
  assert.equal((await listInsightRuns(25, ownerId)).some((run) => run.id === legitimate!.id), true);
});

test("B11 r4/R3 digest related insights exclude tombstoned legacy runs from response and prompt", async () => {
  const ownerId = `deletion-digest-echo-${randomUUID()}`;
  const source = `mail.digest-echo.${randomUUID()}`;
  const marker = `DIGEST_ECHO_MARKER_${randomUUID()}`;
  const liveMarker = `DIGEST_ECHO_LIVE_${randomUUID()}`;
  await seedPolicy(ownerId, source);

  // Legacy evidence: event A is old (outside the digest window), has an entity,
  // and backs an entity-only insight created before the ledger tombstone.
  const eventId = await seedEvent(ownerId, source, marker);
  await pool.query(`update raw_events set timestamp = '2020-01-02T03:04:05Z' where id = $1`, [eventId]);
  const entityId = await seedEntity(ownerId, marker);
  await linkEventEntity(eventId, entityId, ownerId);

  const legacyInsight = await insertInsightRun(pool, {
    ownerId, toolName: "legacy_entity_insight",
    request: { id: entityId },
    response: { summary: `${marker} legacy entity insight` },
    summary: `${marker} legacy entity insight`,
    evidence: [],
  });
  assert.ok(legacyInsight);

  // Live evidence in the current digest window keeps the synthesis path real.
  const liveEventId = await seedEvent(ownerId, source, liveMarker);

  const tombstone = await recordDeletionTombstone(pool, {
    ownerId, targetType: "event", targetId: eventId, mode: "delete_knowledge",
    reason: "r4-digest-echo",
  });
  assert.ok(tombstone);
  // The legacy insight is ineligible on every other derived read path.
  assert.equal(await loadInsightRunById(legacyInsight.id, ownerId), null);
  assert.equal((await listInsightRuns(25, ownerId)).some((run) => run.id === legacyInsight.id), false);

  const now = Date.now();
  const from = new Date(now - 86_400_000).toISOString();
  const to = new Date(now + 86_400_000).toISOString();

  // Direct generation: the hidden summary must not reach the response, the
  // highlights, or any provider prompt/body.
  const spy = spyFetch();
  let storedDigestId: string | null = null;
  try {
    const digest = await createKnowledgeDigest({
      ownerId, from, to, eventLimit: 50, insightLimit: 10, apiKey: "test-key",
    });
    assert.equal(
      digest.relatedInsights.some((insight) => insight.id === legacyInsight.id),
      false,
      "relatedInsights must not include the ineligible legacy insight",
    );
    assert.equal(
      digest.relatedInsights.some((insight) => String(insight.summary ?? "").includes(marker)),
      false,
      "relatedInsights must not include the hidden summary text",
    );
    assert.equal(digest.highlights.some((line) => line.includes(marker)), false);

    assert.equal(spy.calls.length, 1, "control: the synthesis provider path was exercised");
    assert.equal(
      spy.calls.some((call) => call.body.includes(marker) || call.body.includes(`legacy entity insight`)),
      false,
      "no provider prompt may contain the ineligible legacy summary",
    );

    // HTTP generation persists a new digest; the same summary must not be
    // served by the response or by `/digests/history`.
    const app = await buildApp();
    const headers = { "x-brainia-client-id": ownerId };
    try {
      const generated = await app.inject({
        method: "GET",
        url: `/api/v1/digests?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        headers,
      });
      assert.equal(generated.statusCode, 200);
      const generatedBody = generated.json() as {
        relatedInsights: Array<{ id: string; summary: string | null }>;
        highlights: string[];
        audit: { id: string } | null;
      };
      assert.equal(
        generatedBody.relatedInsights.some((insight) => insight.id === legacyInsight.id),
        false,
        "route response must not echo the ineligible legacy insight",
      );
      assert.equal(
        generatedBody.relatedInsights.some((insight) => String(insight.summary ?? "").includes(marker)),
        false,
      );
      assert.equal(generatedBody.highlights.some((line) => line.includes(marker)), false);
      storedDigestId = generatedBody.audit?.id ?? null;
      assert.ok(storedDigestId, "control: a new digest run was persisted");

      const history = await app.inject({ method: "GET", url: "/api/v1/digests/history", headers });
      assert.equal(history.statusCode, 200);
      const historyBody = history.json() as {
        runs: Array<{ id: string; summary: string | null; response: unknown }>;
      };
      assert.equal(
        historyBody.runs.some((run) => run.id === storedDigestId),
        true,
        "control: the new digest is served by history",
      );
      assert.equal(
        historyBody.runs.some((run) =>
          run.id === legacyInsight.id
          || String(run.summary ?? "").includes(marker)
          || JSON.stringify(run.response ?? {}).includes(marker)),
        false,
        "history must not serve the ineligible legacy summary",
      );

      const insightHistory = await app.inject({
        method: "GET", url: `/api/v1/insights/history/${legacyInsight.id}`, headers,
      });
      assert.equal(insightHistory.statusCode, 404);
    } finally {
      await app.close();
    }
  } finally {
    spy.restore();
  }

  assert.equal(
    spy.calls.some((call) => call.body.includes(marker)),
    false,
    "no provider payload from either generation path may contain the hidden summary",
  );
  assert.ok(storedDigestId);
  // The persisted run carries the live event lineage only.
  assert.equal(await count(`select count(*)::int as count from digest_runs where id = $1`, [storedDigestId]), 1);
  assert.equal(await count(`select count(*)::int as count from digest_runs where owner_id = $1`, [ownerId]), 1);
  assert.equal(await count(`select count(*)::int as count from raw_events where id = $1`, [eventId]), 1);
  assert.equal(await count(`select count(*)::int as count from raw_events where id = $1`, [liveEventId]), 1);
});

// Keep an explicit reference so the exported cleanup helper remains covered by
// the TypeScript build even when the acceptance path uses deletePersonalData.
void applyDeletionTombstoneCleanup;
