import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";
process.env.DEEPSEEK_API_KEY = "";

const { knowledgeFactSchema, normalizeFactValue } = await import("../src/domain/knowledge-fact.ts");
const { buildLocalEmbedding, cosineSimilarity } = await import("../src/storage/embeddings.ts");
const { redactForModel } = await import("../src/storage/privacy.ts");
const { retryDelayMs } = await import("../src/storage/job-repository.ts");
const { rerankRetrievalCandidate } = await import("../src/storage/hybrid-retrieval.ts");
const { scoreInsightCandidate } = await import("../src/storage/proactive-insights.ts");
const { buildApp } = await import("../src/app.ts");
const { pool } = await import("../src/storage/postgres.ts");

test("KnowledgeFact enforces normalized, evidenced, versioned facts", () => {
  const fact = knowledgeFactSchema.parse({
    factType: "merchant",
    value: { name: "Spotify" },
    normalizedValue: normalizeFactValue({ name: "Spotify" }),
    confidence: 0.92,
    evidence: { eventId: "evt_fact", source: "wallet", fields: ["merchant"] },
    model: "deepseek-test",
    modelVersion: "deepseek-test",
    promptVersion: "classification-v1",
  });
  assert.equal(fact.extractorVersion, "knowledge-fact-v1");
  assert.equal(fact.evidence.eventId, "evt_fact");
  assert.throws(() => knowledgeFactSchema.parse({ ...fact, confidence: 2 }));
});

test("local embeddings recover bilingual semantic equivalents", () => {
  const spanish = buildLocalEmbedding("gastos y compras recurrentes");
  const english = buildLocalEmbedding("recurring expense purchases");
  const unrelated = buildLocalEmbedding("email contacts and messages");
  assert.ok(cosineSimilarity(spanish, english) > cosineSimilarity(spanish, unrelated));
});

test("model redaction removes email and financial identifiers", () => {
  const redacted = redactForModel("Mail me@example.com, card 4111 1111 1111 1111, account: ABCDEF123456");
  assert.doesNotMatch(redacted, /me@example\.com|4111 1111|ABCDEF123456/);
  assert.match(redacted, /redacted-email|redacted-card|redacted-account/);
});

test("retry backoff is exponential and bounded", () => {
  assert.equal(retryDelayMs(1), 2_000);
  assert.equal(retryDelayMs(2), 4_000);
  assert.equal(retryDelayMs(100), 30 * 60_000);
});

test("retrieval and insight scoring prioritize relevant, confident evidence", () => {
  const high = rerankRetrievalCandidate({
    objectType: "event", objectId: "one", title: "one", excerpt: "one",
    eventId: "one", entityId: null, occurredAt: new Date().toISOString(),
    confidence: 0.95, frequency: 4, textScore: 0.9, vectorScore: 0.9,
    graphScore: 0.7, evidence: {},
  });
  const low = rerankRetrievalCandidate({
    objectType: "event", objectId: "two", title: "two", excerpt: "two",
    eventId: "two", entityId: null, occurredAt: "2020-01-01T00:00:00.000Z",
    confidence: 0.3, frequency: 1, textScore: 0.1, vectorScore: 0,
    graphScore: 0, evidence: {},
  });
  assert.ok(high > low);
  assert.ok(scoreInsightCandidate({ novelty: 1, impact: 1, confidence: 1, recurrence: 1, utility: 1 }) > 0.99);
});

test("captured evidence remains observable and hybrid-retrievable", async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const eventId = `evt_platform_${suffix}`;
  const source = `platform-source-${suffix}`;
  const marker = `KnowledgeMarker${suffix}`;
  const app = await buildApp();
  try {
    const capture = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: {
        id: eventId,
        source,
        kind: "note",
        title: `${marker} planning note`,
        body: `Remember the ${marker} implementation review`,
        raw: { category: "engineering" },
      },
    });
    assert.equal(capture.statusCode, 201);
    const captured = capture.json() as { processingStatus: string };
    assert.ok(["semantically_resolved", "review", "retryable"].includes(captured.processingStatus));

    const facts = await pool.query<{ count: number }>(`select count(*)::int as count from knowledge_facts where event_id = $1`, [eventId]);
    const history = await pool.query<{ status: string }>(`select to_status as status from event_processing_history where event_id = $1 order by created_at`, [eventId]);
    assert.ok((facts.rows[0]?.count ?? 0) >= 1);
    assert.ok(history.rows.some((row) => row.status === "captured"));
    assert.ok(history.rows.some((row) => row.status === "classified"));

    const retrieval = await app.inject({ method: "GET", url: `/api/v1/retrieval/hybrid?q=${marker}&limit=20` });
    assert.equal(retrieval.statusCode, 200);
    const retrieved = retrieval.json() as { results: Array<{ objectId: string }>; evidencePackage: unknown[] };
    assert.ok(retrieved.results.some((result) => result.objectId === eventId));
    assert.ok(retrieved.evidencePackage.length > 0);

    const quality = await app.inject({ method: "GET", url: "/api/v1/metrics/quality" });
    assert.equal(quality.statusCode, 200);
    assert.equal((quality.json() as { gates: { allEventsObservable: boolean } }).gates.allEventsObservable, true);

    const makePrivate = await app.inject({
      method: "PATCH", url: `/api/v1/privacy/events/${eventId}`,
      payload: { privacyStatus: "private" },
    });
    assert.equal(makePrivate.statusCode, 200);
    const privateFacts = await pool.query<{ visibility: string }>(`select distinct visibility from knowledge_facts where event_id = $1`, [eventId]);
    assert.deepEqual(privateFacts.rows.map((row) => row.visibility), ["private"]);

    const remove = await app.inject({
      method: "DELETE", url: `/api/v1/privacy/events/${eventId}`,
      payload: { mode: "delete_all", reason: "test cleanup" },
    });
    assert.equal(remove.statusCode, 200);
    const remaining = await pool.query<{ count: number }>(`select count(*)::int as count from raw_events where id = $1`, [eventId]);
    assert.equal(remaining.rows[0]?.count, 0);
  } finally {
    await app.close();
  }
});

test("cron and operations surfaces reject unauthenticated callers", async () => {
  const app = await buildApp();
  try {
    const cron = await app.inject({ method: "GET", url: "/api/v1/cron/daily-insights" });
    const operations = await app.inject({ method: "GET", url: "/api/v1/operations/jobs" });
    assert.equal(cron.statusCode, 401);
    assert.equal(operations.statusCode, 401);
  } finally {
    await app.close();
  }
});

