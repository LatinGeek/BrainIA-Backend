import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { pool } from "../src/storage/postgres.ts";
import {
  authorizeModelDispatch,
  derivedCacheGeneration,
  setProviderConcurrencyForTests,
  upsertSourceProcessingPolicy,
} from "../src/storage/privacy.ts";
import { generateNaturalLanguageSummary } from "../src/storage/deepseek.ts";
import { generateEmbedding, upsertEmbedding } from "../src/storage/embeddings.ts";
import { hybridRetrieve } from "../src/storage/hybrid-retrieval.ts";
import { createKnowledgeDigest } from "../src/storage/digests.ts";
import {
  insertInsightRun,
  listInsightRuns,
} from "../src/storage/insight-repository.ts";
import {
  insertDigestRun,
  listDigestRuns,
} from "../src/storage/digest-repository.ts";
import { reconcileSemanticGraph } from "../src/storage/semantic-reconciler.ts";

type FetchCall = { url: unknown; body: string };

function spyFetch(handler?: (call: FetchCall) => Promise<Response>) {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  (globalThis as { fetch: typeof fetch }).fetch = (async (url: unknown, init?: RequestInit) => {
    const call = { url, body: String(init?.body ?? "") };
    calls.push(call);
    if (handler) return handler(call);
    return new Response(JSON.stringify({ choices: [{ message: { content: "safe summary" } }], usage: {} }), { status: 200 });
  }) as typeof fetch;
  return {
    calls,
    restore() { (globalThis as { fetch: typeof fetch }).fetch = original; },
  };
}

async function seedEvent(ownerId: string, source: string, marker: string) {
  const id = randomUUID();
  await pool.query(`
    insert into raw_events (id, source, kind, title, body, client_id, owner_id, dedupe_key)
    values ($1,$2,'note',$3,$4,$5,$5,$1)
  `, [id, source, marker, `${marker} body`, ownerId]);
  return id;
}

async function seedEntity(ownerId: string, description: string, value?: string) {
  const id = randomUUID();
  const entityValue = value ?? `Entity ${randomUUID()}`;
  await pool.query(`
    insert into entities (id, type, value, normalized_value, description, owner_id)
    values ($1, 'merchant', $2, $3, $4, $5)
  `, [id, entityValue, entityValue.toLowerCase(), description, ownerId]);
  return { id, value: entityValue };
}

async function linkEventEntity(eventId: string, entityId: string, ownerId: string) {
  await pool.query(`
    insert into event_entities (id, event_id, entity_id, role, confidence, owner_id)
    values ($1, $2, $3, 'merchant', 1, $4)
  `, [randomUUID(), eventId, entityId, ownerId]);
}

async function setPolicy(ownerId: string, source: string, sendToLlm: boolean) {
  return upsertSourceProcessingPolicy(pool, {
    ownerId,
    clientId: ownerId,
    source,
    enabled: true,
    sendToLlm,
    redactEmails: true,
    redactFinancialIdentifiers: true,
    retentionDays: null,
  });
}

test("B07 denied source/owner never reaches the network and logs no payload", async () => {
  const owner = `privacy-owner-${randomUUID()}`;
  const other = `privacy-other-${randomUUID()}`;
  const source = `mail.denied.${randomUUID()}`;
  const marker = `FORBIDDEN_PAYLOAD_${randomUUID()}`;
  const eventId = await seedEvent(owner, source, marker);
  await setPolicy(owner, source, false);

  const foreignDecision = await authorizeModelDispatch(pool, {
    ownerId: other, purpose: "event_classification", sources: [source], eventIds: [eventId],
  });
  assert.equal(foreignDecision.allowed, false);
  if (!foreignDecision.allowed) assert.equal(foreignDecision.reason, "cross_owner_evidence");

  const deniedDecision = await authorizeModelDispatch(pool, {
    ownerId: owner, purpose: "event_classification", sources: [source], eventIds: [eventId],
  });
  assert.equal(deniedDecision.allowed, false);
  if (!deniedDecision.allowed) assert.equal(deniedDecision.reason, "source_llm_denied");

  const noOwner = await authorizeModelDispatch(pool, { ownerId: null, purpose: "event_classification" });
  assert.equal(noOwner.allowed, false);
  const noPurpose = await authorizeModelDispatch(pool, { ownerId: owner });
  assert.equal(noPurpose.allowed, false);

  const spy = spyFetch();
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  const previousKey = process.env.EMBEDDING_API_KEY;
  const previousUrl = process.env.EMBEDDING_API_URL;
  process.env.EMBEDDING_API_KEY = "test-embedding-key";
  process.env.EMBEDDING_API_URL = "https://embedding.invalid/v1";
  try {
    const summary = await generateNaturalLanguageSummary({
      apiKey: "test-key",
      model: "test-model",
      systemPrompt: "system",
      userPrompt: marker,
      privacy: deniedDecision,
    });
    assert.equal(summary, null);

    const embedding = await generateEmbedding({
      text: marker, ownerId: owner, purpose: "embedding", authorization: deniedDecision,
    });
    assert.equal(embedding.model, "brainia-semantic-hash");

    // A caller with no authorization at all is also fail-closed.
    const summaryWithoutAuthorization = await generateNaturalLanguageSummary({
      apiKey: "test-key", model: "test-model", systemPrompt: "system", userPrompt: marker,
    });
    assert.equal(summaryWithoutAuthorization, null);
  } finally {
    spy.restore();
    console.warn = originalWarn;
    if (previousKey === undefined) delete process.env.EMBEDDING_API_KEY; else process.env.EMBEDDING_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.EMBEDDING_API_URL; else process.env.EMBEDDING_API_URL = previousUrl;
  }
  assert.equal(spy.calls.length, 0, `unexpected provider transport: ${spy.calls.map((call) => call.body).join("|")}`);
  assert.ok(!warnings.join("\n").includes(marker));
  assert.ok(!warnings.join("\n").includes(owner));
  assert.ok(!warnings.join("\n").includes(source));
});

test("B07 revocation while queued prevents dispatch and stale publication", async () => {
  const owner = `queue-owner-${randomUUID()}`;
  const source = `capture.queue.${randomUUID()}`;
  const eventId = await seedEvent(owner, source, "QUEUE_MARKER");
  await setPolicy(owner, source, true);

  const authorization = await authorizeModelDispatch(pool, {
    ownerId: owner, purpose: "event_classification", sources: [source], eventIds: [eventId],
  });
  assert.equal(authorization.allowed, true);
  if (!authorization.allowed) return;

  setProviderConcurrencyForTests(1, 1);
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const spy = spyFetch(async () => {
    await firstResponse;
    return new Response(JSON.stringify({ choices: [{ message: { content: "stale generated summary" } }], usage: {} }), { status: 200 });
  });
  try {
    const first = generateNaturalLanguageSummary({
      apiKey: "test-key", model: "test-model", systemPrompt: "system", userPrompt: "first payload", privacy: authorization,
    });
    while (spy.calls.length < 1) await new Promise((resolve) => setTimeout(resolve, 5));

    let secondDispatched = false;
    const second = generateNaturalLanguageSummary({
      apiKey: "test-key", model: "test-model", systemPrompt: "system", userPrompt: "second payload",
      privacy: authorization,
    }).then((value) => { secondDispatched = spy.calls.length > 1; return value; });

    // The second call is queued behind the first provider slot. Revoke the
    // policy while it waits: the queued call must never dispatch.
    await setPolicy(owner, source, false);
    releaseFirst();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult, null, "post-response policy change must not publish stale content");
    assert.equal(secondResult, null);
    assert.equal(secondDispatched, false);
    assert.equal(spy.calls.length, 1);
    const current = await pool.query<{ policyVersion: number }>(
      "select policy_version::int as \"policyVersion\" from source_processing_policies where owner_id=$1 and lower(source)=lower($2)",
      [owner, source],
    );
    assert.ok((current.rows[0]?.policyVersion ?? 0) > (authorization.policyVersion ?? 0));
  } finally {
    spy.restore();
    setProviderConcurrencyForTests(4, 1);
  }
});

test("B07 mixed-source summaries use intersection permissions", async () => {
  const owner = `mixed-owner-${randomUUID()}`;
  const allowedSource = `capture.allowed.${randomUUID()}`;
  const deniedSource = `mail.denied.${randomUUID()}`;
  const allowedEvent = await seedEvent(owner, allowedSource, "ALLOWED_MIXED");
  const deniedEvent = await seedEvent(owner, deniedSource, "DENIED_MIXED");
  await setPolicy(owner, allowedSource, true);
  await setPolicy(owner, deniedSource, false);

  const mixed = await authorizeModelDispatch(pool, {
    ownerId: owner,
    purpose: "knowledge_digest_synthesis",
    sources: [allowedSource, deniedSource],
    eventIds: [allowedEvent, deniedEvent],
  });
  assert.equal(mixed.allowed, false);
  if (!mixed.allowed) assert.equal(mixed.reason, "source_llm_denied");

  const single = await authorizeModelDispatch(pool, {
    ownerId: owner, purpose: "knowledge_digest_synthesis", sources: [allowedSource], eventIds: [allowedEvent],
  });
  assert.equal(single.allowed, true);

  const spy = spyFetch();
  try {
    const digest = await createKnowledgeDigest({
      ownerId: owner,
      apiKey: "test-key",
      model: "test-model",
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 60_000).toISOString(),
      source: null,
    });
    assert.equal(digest.model, null, "denied mixed sources must not publish model output");
  } finally {
    spy.restore();
  }
  assert.equal(spy.calls.length, 0);
});

test("B07 allowed input keeps dispatching and policy changes invalidate derived work", async () => {
  const owner = `allowed-owner-${randomUUID()}`;
  const source = `capture.allowed.${randomUUID()}`;
  const marker = `ALLOWED_PAYLOAD_${randomUUID()}`;
  const eventId = await seedEvent(owner, source, marker);
  const policy = await setPolicy(owner, source, true);
  assert.ok(policy?.policyVersion);

  const authorization = await authorizeModelDispatch(pool, {
    ownerId: owner, purpose: "event_classification", sources: [source], eventIds: [eventId],
  });
  assert.equal(authorization.allowed, true);
  if (!authorization.allowed) return;

  const spy = spyFetch();
  try {
    const summary = await generateNaturalLanguageSummary({
      apiKey: "test-key", model: "test-model", systemPrompt: "system", userPrompt: marker, privacy: authorization,
    });
    assert.equal(summary, "safe summary");
  } finally {
    spy.restore();
  }
  assert.equal(spy.calls.length, 1);
  assert.ok(spy.calls[0]!.body.includes(marker));

  await pool.query(`
    insert into knowledge_embeddings (id, client_id, owner_id, object_type, object_id, embedding,
      dimensions, model, embedding_version, content_hash, content, metadata, policy_version)
    values ($1,$2,$2,'event',$3,array[0.1]::float8[],1,'test','embedding-v1','hash','content',$4::jsonb,$5)
  `, [`embedding_${randomUUID()}`, owner, eventId, JSON.stringify({ source }), authorization.policyVersion]);

  const before = derivedCacheGeneration(owner);
  await setPolicy(owner, source, false);
  const after = derivedCacheGeneration(owner);
  assert.ok(after > before);

  const embeddingRow = await pool.query<{ policyVersion: number; policyStale: boolean }>(`
    select policy_version::int as "policyVersion", (metadata->>'policyStale')::boolean as "policyStale"
    from knowledge_embeddings where owner_id=$1 and object_id=$2
  `, [owner, eventId]);
  assert.equal(embeddingRow.rows[0]?.policyStale, true);
  assert.ok((embeddingRow.rows[0]?.policyVersion ?? 0) > authorization.policyVersion);

  const changes = await pool.query<{ count: number }>(
    "select count(*)::int as count from privacy_policy_changes where owner_id=$1", [owner],
  );
  assert.ok((changes.rows[0]?.count ?? 0) >= 1);
});

test("B07 provider error bodies are not logged or echoed", async () => {
  const owner = `error-owner-${randomUUID()}`;
  const source = `capture.error.${randomUUID()}`;
  const marker = `ERROR_BODY_SECRET_${randomUUID()}`;
  const eventId = await seedEvent(owner, source, marker);
  await setPolicy(owner, source, true);
  const authorization = await authorizeModelDispatch(pool, {
    ownerId: owner, purpose: "event_classification", sources: [source], eventIds: [eventId],
  });
  assert.equal(authorization.allowed, true);
  if (!authorization.allowed) return;

  const spy = spyFetch(async () => new Response(JSON.stringify({ error: marker }), { status: 500 }));
  const logs: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  console.warn = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  let thrown = "";
  try {
    await generateNaturalLanguageSummary({
      apiKey: "test-key", model: "test-model", systemPrompt: "system", userPrompt: "prompt", privacy: authorization,
    });
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  } finally {
    spy.restore();
    console.error = originalError;
    console.warn = originalWarn;
  }
  assert.match(thrown, /HTTP 500/);
  assert.ok(!thrown.includes(marker));
  assert.ok(!logs.join("\n").includes(marker));
});

test("B07 entity-only inspect authorizes the entity event lineage", async () => {
  const owner = `inspect-owner-${randomUUID()}`;
  const deniedSource = `mail.denied.${randomUUID()}`;
  const allowedSource = `capture.allowed.${randomUUID()}`;
  const deniedMarker = `FOCUS_ENTITY_SECRET_${randomUUID()}`;
  const allowedMarker = `ALLOWED_ENTITY_SECRET_${randomUUID()}`;

  const deniedEntity = await seedEntity(owner, deniedMarker);
  // Search resolves this entity but not the event: the event title/body are
  // deliberately unrelated so only the entity/lineage path can find it.
  const deniedEvent = await seedEvent(owner, deniedSource, "Ordinary notification heading");
  await linkEventEntity(deniedEvent, deniedEntity.id, owner);
  await setPolicy(owner, deniedSource, false);

  const allowedEntity = await seedEntity(owner, allowedMarker);
  const allowedEvent = await seedEvent(owner, allowedSource, "Another ordinary heading");
  await linkEventEntity(allowedEvent, allowedEntity.id, owner);
  await setPolicy(owner, allowedSource, true);

  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  const { inspectKnowledge } = await import("../src/storage/agent-inspect.ts");
  try {
    const deniedSpy = spyFetch();
    let deniedResult;
    try {
      deniedResult = await inspectKnowledge({
        q: deniedEntity.value, clientId: owner, depth: 2, maxNodes: 100, maxRelations: 100,
      });
    } finally {
      deniedSpy.restore();
    }
    assert.equal(deniedResult.summary, null);
    assert.equal(deniedResult.summaryAvailable, false);
    assert.equal(deniedSpy.calls.length, 0, `denied entity dispatched: ${deniedSpy.calls.map((call) => call.body).join("|")}`);
    assert.ok(!deniedSpy.calls.some((call) => call.body.includes(deniedMarker)));

    const allowedSpy = spyFetch();
    let allowedResult;
    try {
      allowedResult = await inspectKnowledge({
        q: allowedEntity.value, clientId: owner, depth: 2, maxNodes: 100, maxRelations: 100,
      });
    } finally {
      allowedSpy.restore();
    }
    assert.equal(allowedResult.summary, "safe summary");
    assert.equal(allowedSpy.calls.length, 1);
    assert.ok(allowedSpy.calls[0]!.body.includes(allowedMarker));
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

test("B07 entity-only inspect blocks an entity with no event lineage", async () => {
  const owner = `inspect-empty-owner-${randomUUID()}`;
  const marker = `NO_LINEAGE_SECRET_${randomUUID()}`;
  const entity = await seedEntity(owner, marker);

  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  const { inspectKnowledge } = await import("../src/storage/agent-inspect.ts");
  const spy = spyFetch();
  try {
    const result = await inspectKnowledge({
      q: entity.value, clientId: owner, depth: 2, maxNodes: 100, maxRelations: 100,
    });
    assert.equal(result.summary, null);
    assert.equal(result.summaryAvailable, false);
  } finally {
    spy.restore();
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
  assert.equal(spy.calls.length, 0);
});

test("B07 proactive insight embedding stays local when a source denies egress", async () => {
  const owner = `proactive-owner-${randomUUID()}`;
  const source = `mail.denied.${randomUUID()}`;
  const eventId = await seedEvent(owner, source, "PROACTIVE_DENIED_EVIDENCE");
  await setPolicy(owner, source, false);

  const candidateId = `insight_candidate_${randomUUID()}`;
  await pool.query(`
    insert into insight_candidates (
      id, client_id, detector, status, score, novelty, impact, confidence,
      recurrence, utility, evidence, dedupe_key, window_from, window_to,
      severity, title, explanation, expires_at
    ) values (
      $1, $2, 'spending_variation', 'pending', 0.9, 0.9, 0.9, 0.95,
      0.5, 0.9, $3::jsonb, $4, now() - interval '1 day', now(),
      'medium', 'Spending changed', 'Deterministic denied-derived explanation', now() + interval '7 days'
    )
  `, [candidateId, owner, JSON.stringify({ eventIds: [eventId, `${eventId}-secondary`] }), `dedupe-${randomUUID()}`]);

  const previousKey = process.env.EMBEDDING_API_KEY;
  const previousUrl = process.env.EMBEDDING_API_URL;
  const previousModel = process.env.EMBEDDING_MODEL;
  const previousDeepseek = process.env.DEEPSEEK_API_KEY;
  process.env.EMBEDDING_API_KEY = "test-embedding-key";
  process.env.EMBEDDING_API_URL = "https://embedding.invalid/v1";
  process.env.EMBEDDING_MODEL = "text-embedding-test";
  delete process.env.DEEPSEEK_API_KEY;
  const { synthesizeTopInsightCandidates } = await import("../src/storage/proactive-insights.ts");
  const spy = spyFetch(async () => new Response(JSON.stringify({
    data: [{ embedding: [0.1, 0.2] }], usage: {},
  }), { status: 200 }));
  try {
    const run = await synthesizeTopInsightCandidates({ clientId: owner, limit: 5 });
    assert.ok(run);
    assert.equal(run?.model, null);
  } finally {
    spy.restore();
    if (previousKey === undefined) delete process.env.EMBEDDING_API_KEY; else process.env.EMBEDDING_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.EMBEDDING_API_URL; else process.env.EMBEDDING_API_URL = previousUrl;
    if (previousModel === undefined) delete process.env.EMBEDDING_MODEL; else process.env.EMBEDDING_MODEL = previousModel;
    if (previousDeepseek === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousDeepseek;
  }
  assert.equal(spy.calls.length, 0, `derived embedding dispatched: ${spy.calls.map((call) => call.body).join("|")}`);
});

test("B07 insight and digest runs persist policy_version and become stale after a policy bump", async () => {
  const owner = `derived-owner-${randomUUID()}`;
  const source = `capture.derived.${randomUUID()}`;
  const eventId = await seedEvent(owner, source, "DERIVED_POLICY_EVIDENCE");
  await setPolicy(owner, source, true);

  const insight = await insertInsightRun(pool, {
    toolName: "test_insight", ownerId: owner, request: {}, response: {},
    summary: "derived insight", candidateIds: [eventId],
  });
  const digest = await insertDigestRun(pool, {
    toolName: "test_digest", ownerId: owner, request: {}, response: {},
    summary: "derived digest",
  });
  assert.ok((insight?.policyVersion ?? 0) >= 1);
  assert.ok((digest?.policyVersion ?? 0) >= 1);

  const beforeInsight = (await listInsightRuns(10, owner)).find((run) => run.id === insight?.id);
  const beforeDigest = (await listDigestRuns(10, owner)).find((run) => run.id === digest?.id);
  assert.equal(beforeInsight?.stale, false);
  assert.equal(beforeDigest?.stale, false);

  await setPolicy(owner, source, false);

  const afterInsight = (await listInsightRuns(10, owner)).find((run) => run.id === insight?.id);
  const afterDigest = (await listDigestRuns(10, owner)).find((run) => run.id === digest?.id);
  assert.equal(afterInsight?.stale, true);
  assert.equal(afterDigest?.stale, true);
});

test("B07 embedding provenance stays local when EMBEDDING_MODEL is unset", async () => {
  const owner = `provenance-owner-${randomUUID()}`;
  const source = `capture.provenance.${randomUUID()}`;
  const marker = `PROVENANCE_MARKER_${randomUUID()}`;
  const eventId = await seedEvent(owner, source, marker);
  await setPolicy(owner, source, true);
  const authorization = await authorizeModelDispatch(pool, {
    ownerId: owner, purpose: "embedding", sources: [source], eventIds: [eventId],
  });
  assert.equal(authorization.allowed, true);
  if (!authorization.allowed) return;

  const previousKey = process.env.EMBEDDING_API_KEY;
  const previousUrl = process.env.EMBEDDING_API_URL;
  const previousModel = process.env.EMBEDDING_MODEL;
  process.env.EMBEDDING_API_KEY = "test-embedding-key";
  process.env.EMBEDDING_API_URL = "https://embedding.invalid/v1";
  delete process.env.EMBEDDING_MODEL;
  const spy = spyFetch(async () => new Response(JSON.stringify({
    data: [{ embedding: [0.1, 0.2] }], usage: {},
  }), { status: 200 }));
  try {
    const local = await generateEmbedding({
      text: marker, ownerId: owner, purpose: "embedding", authorization,
    });
    assert.equal(local.model, "brainia-semantic-hash");
    assert.equal(spy.calls.length, 0);

    process.env.EMBEDDING_MODEL = "text-embedding-test";
    const external = await generateEmbedding({
      text: marker, ownerId: owner, purpose: "embedding", authorization,
    });
    assert.equal(external.model, "text-embedding-test");
    assert.equal(spy.calls.length, 1);
  } finally {
    spy.restore();
    if (previousKey === undefined) delete process.env.EMBEDDING_API_KEY; else process.env.EMBEDDING_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.EMBEDDING_API_URL; else process.env.EMBEDDING_API_URL = previousUrl;
    if (previousModel === undefined) delete process.env.EMBEDDING_MODEL; else process.env.EMBEDDING_MODEL = previousModel;
  }
});

test("B07 semantic reconciliation only sends the caller's own nodes", async () => {
  const ownerA = `reconcile-a-${randomUUID()}`;
  const ownerB = `reconcile-b-${randomUUID()}`;
  const markerB = `FOREIGN_RECONCILE_NODE_${randomUUID()}`;
  const entity = async (ownerId: string, description: string) => {
    const id = randomUUID();
    await pool.query(`
      insert into entities (id, type, value, normalized_value, description, identity_source, owner_id)
      values ($1, 'merchant', $2, $3, $4, 'ai', $5)
    `, [id, `Merchant ${randomUUID()}`, `merchant-${randomUUID()}`, description, ownerId]);
  };
  await entity(ownerA, `OWN_NODE_${randomUUID()}`);
  await entity(ownerB, markerB);

  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  const spy = spyFetch();
  try {
    await reconcileSemanticGraph({ ownerId: ownerA });
  } finally {
    spy.restore();
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousKey;
  }
  assert.ok(spy.calls.length >= 1);
  assert.ok(spy.calls.every((call) => !call.body.includes(markerB)));
});

test("B07 missing source policy fails closed for external dispatch", async () => {
  const owner = `missing-policy-owner-${randomUUID()}`;
  // No source_processing_policies row is seeded for this source.
  const source = `capture.unconfigured.${randomUUID()}`;
  const marker = `MISSING_POLICY_PAYLOAD_${randomUUID()}`;
  const eventId = await seedEvent(owner, source, marker);

  const decision = await authorizeModelDispatch(pool, {
    ownerId: owner, purpose: "event_classification", sources: [source], eventIds: [eventId],
  });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.reason, "source_policy_missing");

  const previousKey = process.env.EMBEDDING_API_KEY;
  const previousUrl = process.env.EMBEDDING_API_URL;
  const previousModel = process.env.EMBEDDING_MODEL;
  process.env.EMBEDDING_API_KEY = "test-embedding-key";
  process.env.EMBEDDING_API_URL = "https://embedding.invalid/v1";
  process.env.EMBEDDING_MODEL = "text-embedding-test";
  const spy = spyFetch();
  try {
    const summary = await generateNaturalLanguageSummary({
      apiKey: "test-key", model: "test-model", systemPrompt: "system", userPrompt: marker,
      privacy: decision,
    });
    assert.equal(summary, null);
    const embedding = await generateEmbedding({
      text: marker, ownerId: owner, purpose: "embedding", authorization: decision,
    });
    assert.equal(embedding.model, "brainia-semantic-hash");
  } finally {
    spy.restore();
    if (previousKey === undefined) delete process.env.EMBEDDING_API_KEY; else process.env.EMBEDDING_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.EMBEDDING_API_URL; else process.env.EMBEDDING_API_URL = previousUrl;
    if (previousModel === undefined) delete process.env.EMBEDDING_MODEL; else process.env.EMBEDDING_MODEL = previousModel;
  }
  assert.equal(spy.calls.length, 0, `missing-policy source dispatched: ${spy.calls.map((call) => call.body).join("|")}`);
});

test("B07 stale insight/digest embeddings are excluded from vector retrieval after a policy bump", async () => {
  const owner = `derived-vector-owner-${randomUUID()}`;
  const source = `capture.derived-vector.${randomUUID()}`;
  const insightMarker = `STALE_INSIGHT_MARKER_${randomUUID()}`;
  const digestMarker = `STALE_DIGEST_MARKER_${randomUUID()}`;
  const eventId = await seedEvent(owner, source, "DERIVED_VECTOR_EVIDENCE");
  await setPolicy(owner, source, true);

  const insight = await insertInsightRun(pool, {
    toolName: "test_stale_vector_insight", ownerId: owner, request: {}, response: {},
    summary: `insight ${insightMarker}`, candidateIds: [eventId],
  });
  const digest = await insertDigestRun(pool, {
    toolName: "test_stale_vector_digest", ownerId: owner, request: {}, response: {},
    summary: `digest ${digestMarker}`,
  });
  assert.ok(insight);
  assert.ok(digest);

  const authorization = await authorizeModelDispatch(pool, {
    ownerId: owner, purpose: "embedding", sources: [source], eventIds: [eventId],
  });
  assert.equal(authorization.allowed, true);
  if (!authorization.allowed) return;

  await upsertEmbedding(pool, {
    objectType: "insight", objectId: insight.id, content: `insight ${insightMarker}`,
    clientId: owner, ownerId: owner, metadata: { title: "Insight" }, authorization,
  });
  await upsertEmbedding(pool, {
    objectType: "digest", objectId: digest.id, content: `digest ${digestMarker}`,
    clientId: owner, ownerId: owner, metadata: { title: "Digest" }, authorization,
  });

  // Derived embeddings are joinable to their run and carry owner/policy data.
  const linked = await pool.query<{
    objectId: string; ownerId: string | null; runId: string | null; policyVersion: number | null;
  }>(`
    select object_id as "objectId", metadata->>'ownerId' as "ownerId",
      metadata->>'runId' as "runId", (metadata->>'policyVersion')::int as "policyVersion"
    from knowledge_embeddings
    where owner_id = $1 and object_id = any($2::text[])
  `, [owner, [insight.id, digest.id]]);
  assert.equal(linked.rows.length, 2);
  for (const row of linked.rows) {
    assert.equal(row.ownerId, owner);
    assert.equal(row.runId, row.objectId);
    assert.ok((row.policyVersion ?? 0) >= 1);
  }

  await setPolicy(owner, source, false);

  const staleEmbeddings = await pool.query<{ policyStale: boolean; policyVersion: number }>(`
    select (metadata->>'policyStale')::boolean as "policyStale",
      coalesce((metadata->>'policyVersion')::int, policy_version::int) as "policyVersion"
    from knowledge_embeddings
    where owner_id = $1 and object_id = any($2::text[])
  `, [owner, [insight.id, digest.id]]);
  assert.equal(staleEmbeddings.rows.length, 2);
  for (const row of staleEmbeddings.rows) {
    assert.equal(row.policyStale, true);
    assert.ok(row.policyVersion >= 2);
  }
  const afterInsight = (await listInsightRuns(10, owner)).find((run) => run.id === insight.id);
  const afterDigest = (await listDigestRuns(10, owner)).find((run) => run.id === digest.id);
  assert.equal(afterInsight?.stale, true);
  assert.equal(afterDigest?.stale, true);

  const insightRetrieval = await hybridRetrieve(insightMarker, {
    clientId: owner, objectTypes: ["insight", "digest"],
  }, pool);
  assert.equal(insightRetrieval.results.some((result) => result.objectId === insight.id), false);
  assert.ok(insightRetrieval.results.every((result) => !result.excerpt.includes(insightMarker)));

  const digestRetrieval = await hybridRetrieve(digestMarker, {
    clientId: owner, objectTypes: ["insight", "digest"],
  }, pool);
  assert.equal(digestRetrieval.results.some((result) => result.objectId === digest.id), false);
  assert.ok(digestRetrieval.results.every((result) => !result.excerpt.includes(digestMarker)));
});

test("B07 JEV authorization is bound to the event id and its stored owner/source", async () => {
  const owner = `jev-owner-${randomUUID()}`;
  const source = `mail.jev.${randomUUID()}`;
  const eventA = await seedEvent(owner, source, "JEV_AUTHORIZED_EVENT");
  const eventB = await seedEvent(owner, source, "JEV_OTHER_EVENT");
  await setPolicy(owner, source, true);
  const authorization = await authorizeModelDispatch(pool, {
    ownerId: owner, purpose: "event_classification", sources: [source], eventIds: [eventA],
  });
  assert.equal(authorization.allowed, true);
  if (!authorization.allowed) return;

  const loadEvent = async (id: string) => {
    const row = (await pool.query<{ id: string; source: string; title: string | null; body: string | null }>(
      "select id, source, title, body from raw_events where id=$1", [id],
    )).rows[0]!;
    return {
      id: row.id, source: row.source, contractVersion: 1, kind: "note" as const,
      title: row.title ?? undefined, body: row.body ?? undefined, raw: {}, tags: [],
    };
  };
  const { classifyWithJev } = await import("../src/storage/jev.ts");
  const { classifyEvent } = await import("../src/domain/classification.ts");
  const eventAInput = await loadEvent(eventA);
  const eventBInput = await loadEvent(eventB);

  const previousMode = process.env.BRAINIA_JEV_MODE;
  const previousKey = process.env.JEV_API_KEY;
  const previousBase = process.env.JEV_BASE_URL;
  process.env.BRAINIA_JEV_MODE = "active";
  process.env.JEV_API_KEY = "test-jev-key";
  process.env.JEV_BASE_URL = "https://jev.invalid";
  const spy = spyFetch(async () => new Response(JSON.stringify({
    model: "jev-test",
    answers: {
      kind: {
        choice: "note", confidence: 0.99,
        probabilities: { email: 0, expense: 0, income: 0, note: 1, notification: 0, task: 0, transfer: 0, other: 0 },
      },
    },
  }), { status: 200 }));
  try {
    const otherEvent = await classifyWithJev({
      event: eventBInput, base: classifyEvent(eventBInput), clientId: owner, authorization,
    });
    assert.equal(otherEvent, null);
    assert.equal(spy.calls.length, 0);

    const mismatchedSource = await classifyWithJev({
      event: { ...eventAInput, source: `${source}.other` }, base: classifyEvent(eventAInput),
      clientId: owner, authorization,
    });
    assert.equal(mismatchedSource, null);
    assert.equal(spy.calls.length, 0);

    const boundEvent = await classifyWithJev({
      event: eventAInput, base: classifyEvent(eventAInput), clientId: owner, authorization,
    });
    assert.ok(boundEvent);
    assert.equal(spy.calls.length, 1);
  } finally {
    spy.restore();
    if (previousMode === undefined) delete process.env.BRAINIA_JEV_MODE; else process.env.BRAINIA_JEV_MODE = previousMode;
    if (previousKey === undefined) delete process.env.JEV_API_KEY; else process.env.JEV_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.JEV_BASE_URL; else process.env.JEV_BASE_URL = previousBase;
  }
});

test("B07 inspect omits unlineaged graph neighbours from the external payload", async () => {
  const owner = `inspect-neighbour-owner-${randomUUID()}`;
  const source = `capture.allowed-neighbour.${randomUUID()}`;
  const rootMarker = `INSPECT_ROOT_SECRET_${randomUUID()}`;
  const neighbourMarker = `INSPECT_NEIGHBOUR_NOLINEAGE_${randomUUID()}`;
  const root = await seedEntity(owner, rootMarker);
  const neighbour = await seedEntity(owner, neighbourMarker);
  const eventId = await seedEvent(owner, source, "Root evidence heading");
  await linkEventEntity(eventId, root.id, owner);
  await setPolicy(owner, source, true);
  await pool.query(`
    insert into relations (id, source_entity_id, target_entity_id, relation_type, label, description, confidence, owner_id)
    values ($1,$2,$3,'related_to','Related to','Related entity',1,$4)
  `, [randomUUID(), root.id, neighbour.id, owner]);

  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
  const { inspectKnowledge } = await import("../src/storage/agent-inspect.ts");
  const spy = spyFetch();
  let result: Awaited<ReturnType<typeof inspectKnowledge>> | undefined;
  try {
    result = await inspectKnowledge({
      id: root.id, clientId: owner, depth: 2, maxNodes: 100, maxRelations: 100,
    });
  } finally {
    spy.restore();
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
  assert.ok(result);
  assert.equal(result.summary, "safe summary");
  assert.equal(spy.calls.length, 1);
  assert.ok(spy.calls[0]!.body.includes(rootMarker));
  assert.ok(!spy.calls[0]!.body.includes(neighbourMarker), "unlineaged neighbour description was dispatched");
  // Deterministic local output still contains the graph for inspection.
  assert.ok(result.graph?.nodes.some((node) => node.id === neighbour.id));
});

test("B07 evaluate-laya refuses ungated direct provider dispatch", () => {
  const env = { ...process.env };
  delete env.LAYA_EVALUATION_OWNER;
  delete env.LAYA_EVALUATION_EXTERNAL_APPROVED;
  delete env.LAYA_EVALUATION_REASON;
  const child = spawnSync(process.execPath, ["--import", "tsx", "src/scripts/evaluate-laya.ts"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(child.status, 1);
  assert.match(`${child.stdout}${child.stderr}`, /evaluate-laya refused/);
});
