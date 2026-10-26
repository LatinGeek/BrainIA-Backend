import assert from "node:assert/strict";
import test from "node:test";
import type { AuthConfig } from "../src/auth.ts";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

const { buildApp } = await import("../src/app.ts");
const { resolveAuthContext } = await import("../src/auth.ts");
const { buildEventDedupeKey } = await import("../src/storage/event-store.ts");

test("health remains public even when api auth is enabled", async () => {
  const authConfig: AuthConfig = {
    globalApiKey: "secret",
    clientKeys: new Map(),
  };

  const app = await buildApp({ authConfig });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    assert.equal(response.statusCode, 200);
  } finally {
    await app.close();
  }
});

test("api routes reject missing credentials when auth is enabled", async () => {
  const authConfig: AuthConfig = {
    globalApiKey: "secret",
    clientKeys: new Map(),
  };

  const app = await buildApp({ authConfig });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: {
        id: "evt_1",
        source: "tasker",
      },
    });

    assert.equal(response.statusCode, 401);
    const body = response.json() as { error: string };
    assert.equal(body.error, "invalid_api_key");
  } finally {
    await app.close();
  }
});

test("client-scoped auth resolves the configured identity", () => {
  const authConfig: AuthConfig = {
    globalApiKey: null,
    clientKeys: new Map([["mobile", "secret"]]),
  };

  const result = resolveAuthContext(
    {
      "x-brainia-client-id": "mobile",
      "x-brainia-api-key": "secret",
    },
    authConfig,
  );

  assert.equal("ok" in result, false);
  const authContext = result as { clientId: string | null; mode: string };
  assert.equal(authContext.clientId, "mobile");
  assert.equal(authContext.mode, "client");
});

test("global key without a client header resolves the single production owner", () => {
  const authConfig: AuthConfig = {
    globalApiKey: "global-test-key",
    clientKeys: new Map([["mobile", "client-test-key"]]),
  };

  assert.deepEqual(resolveAuthContext({ "x-brainia-api-key": "global-test-key" }, authConfig), {
    clientId: null,
    ownerId: "brainia-personal",
    mode: "client",
    scopes: ["owner"],
    authenticated: true,
  });

  for (const headers of [{}, { "x-brainia-api-key": "wrong-test-key" }, { "x-brainia-api-key": "client-test-key" }]) {
    const result = resolveAuthContext(headers, authConfig);
    assert.ok("ok" in result && !result.ok);
    assert.equal(result.statusCode, 401);
    assert.equal(result.error, "missing_client_id");
  }

  const noGlobalKey = resolveAuthContext({ "x-brainia-api-key": "global-test-key" }, { ...authConfig, globalApiKey: null });
  assert.ok("ok" in noGlobalKey && !noGlobalKey.ok);
  assert.equal(noGlobalKey.statusCode, 401);
});

test("global fallback preserves explicit client authentication and rejection paths", () => {
  const authConfig: AuthConfig = {
    globalApiKey: "global-test-key",
    clientKeys: new Map([["mobile", "client-test-key"]]),
  };
  assert.deepEqual(resolveAuthContext({
    "x-brainia-client-id": "mobile",
    "x-brainia-api-key": "client-test-key",
  }, authConfig), {
    clientId: "mobile", ownerId: "mobile", mode: "client", scopes: ["owner"], authenticated: true,
  });

  for (const clientId of ["unknown", "", "   "]) {
    const result = resolveAuthContext({
      "x-brainia-client-id": clientId,
      "x-brainia-api-key": "global-test-key",
    }, authConfig);
    assert.ok("ok" in result && !result.ok);
    assert.equal(result.statusCode, clientId === "unknown" ? 403 : 401);
    assert.equal(result.error, clientId === "unknown" ? "unknown_client" : "missing_client_id");
  }
  for (const apiKey of ["global-test-key", "wrong-test-key", undefined]) {
    const result = resolveAuthContext({
      "x-brainia-client-id": "mobile",
      "x-brainia-api-key": apiKey,
    }, authConfig);
    assert.ok("ok" in result && !result.ok);
    assert.equal(result.statusCode, 401);
    assert.equal(result.error, "invalid_api_key");
  }
});

test("event dedupe keys scope identities by client and source", () => {
  const dedupeKey = buildEventDedupeKey(
    {
      id: "evt_1",
      source: "tasker",
      contractVersion: 2,
      kind: "notification",
      externalId: "mail-123",
      raw: {},
      tags: [],
    },
    "mobile",
  );

  assert.equal(dedupeKey, '["capture-v2","mobile","tasker","external","mail-123"]');
});

test("event dedupe keys prefer an explicit idempotency key", () => {
  const dedupeKey = buildEventDedupeKey(
    {
      id: "evt_1",
      source: "tasker",
      contractVersion: 1,
      kind: "notification",
      externalId: "mail-123",
      idempotencyKey: "retry-abc",
      raw: {},
      tags: [],
    },
    null,
  );

  assert.equal(dedupeKey, '["capture-v2",null,"tasker","idempotency","retry-abc"]');
});
