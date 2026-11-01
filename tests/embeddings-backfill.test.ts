import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { pool } from "../src/storage/postgres.js";
import { upsertSourceProcessingPolicy } from "../src/storage/privacy.js";

const OWNER = "backfill-a";

test("operations backfill: protected, dry-run first, resumable, uses the provider", async () => {
  await upsertSourceProcessingPolicy(pool, { clientId: OWNER, ownerId: OWNER, source: "bank", enabled: true, sendToLlm: true });
  for (let index = 0; index < 5; index += 1) {
    await pool.query("insert into raw_events(id,source,kind,title,body,client_id,owner_id,dedupe_key,timestamp) values($1,'bank','note',$2,'cuerpo',$3,$3,$1,$4)",
      [`bf_${index}`, `Evento ${index}`, OWNER, new Date(Date.UTC(2026, 9, 1 + index)).toISOString()]);
  }
  process.env.BRAINIA_OPERATIONS_TOKEN = "ops-token";
  const app = await buildApp({ authConfig: { globalApiKey: null, clientKeys: new Map() } });
  const call = (body: unknown, token = "ops-token") => app.inject({
    method: "POST", url: "/api/v1/operations/embeddings/backfill",
    headers: { "x-brainia-operations-token": token }, payload: body as Record<string, unknown>,
  });
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  try {
    assert.equal((await call({}, "wrong")).statusCode, 401);

    const dry = (await call({ ownerId: OWNER })).json();
    assert.equal(dry.dryRun, true);
    assert.equal(dry.pendingBefore, 5);
    assert.equal(dry.processed, 0);

    delete process.env.OPENAI_EMBEDDING_API_KEY;
    assert.equal((await call({ ownerId: OWNER, dryRun: false })).statusCode, 409);

    process.env.OPENAI_EMBEDDING_API_KEY = "test-openai";
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      assert.match(String(url), /api\.openai\.com\/v1\/embeddings/);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "text-embedding-3-small");
      assert.equal(body.dimensions, 512);
      providerCalls += 1;
      const vector = Array.from({ length: 512 }, (_, index) => Math.sin(index + providerCalls));
      return new Response(JSON.stringify({ data: [{ embedding: vector }], usage: { prompt_tokens: 5 } }), { status: 200 });
    }) as typeof fetch;

    const first = (await call({ ownerId: OWNER, dryRun: false, limit: 2 })).json();
    assert.equal(first.processed, 2);
    assert.equal(first.done, false);
    assert.equal(first.writtenByModel["text-embedding-3-small"], 2);
    let cursor = first.nextCursor;
    let rounds = 0;
    let last = first;
    while (!last.done && rounds < 5) {
      last = (await call({ ownerId: OWNER, dryRun: false, limit: 2, cursor })).json();
      cursor = last.nextCursor;
      rounds += 1;
    }
    assert.equal(last.done, true);
    assert.equal(last.pendingAfter, 0);
    assert.ok(last.byModel.some((row: { model: string; count: number }) => row.model === "text-embedding-3-small" && row.count >= 5));
    // Rerun is idempotent: nothing pending, no new provider calls.
    const before = providerCalls;
    const rerun = (await call({ ownerId: OWNER, dryRun: false })).json();
    assert.equal(rerun.processed, 0);
    assert.equal(providerCalls, before);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OPENAI_EMBEDDING_API_KEY;
    delete process.env.BRAINIA_OPERATIONS_TOKEN;
    await app.close();
  }
});

test("operations token passes the API-key layer only on /operations routes", async () => {
  process.env.BRAINIA_OPERATIONS_TOKEN = "ops-token";
  // Auth enabled, as in production: every /api route needs a client key.
  const app = await buildApp({ authConfig: { globalApiKey: null, clientKeys: new Map([["someone", "client-secret"]]) } });
  try {
    const backfill = (token?: string) => app.inject({
      method: "POST", url: "/api/v1/operations/embeddings/backfill",
      headers: token ? { "x-brainia-operations-token": token } : {}, payload: { dryRun: true },
    });
    assert.equal((await backfill("ops-token")).statusCode, 200);
    assert.equal((await backfill("wrong")).statusCode, 401);
    assert.equal((await backfill()).statusCode, 401);
    // The token must not unlock owner data routes.
    const owner = await app.inject({ method: "GET", url: "/api/v1/financial/transactions", headers: { "x-brainia-operations-token": "ops-token" } });
    assert.equal(owner.statusCode, 401);
    const ask = await app.inject({ method: "POST", url: "/api/v1/ask", headers: { "x-brainia-operations-token": "ops-token" }, payload: { question: "hola" } });
    assert.equal(ask.statusCode, 401);
  } finally {
    delete process.env.BRAINIA_OPERATIONS_TOKEN;
    await app.close();
  }
});
