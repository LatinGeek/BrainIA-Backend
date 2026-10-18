import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

async function createApp() {
  const { buildApp } = await import("../src/app.ts");
  return buildApp();
}

test("browser preflight allows canonical Brain IA auth headers", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({ method: "OPTIONS", url: "/api/v1/intelligence/artifacts" });
    assert.equal(response.statusCode, 204);
    const allowed = response.headers["access-control-allow-headers"];
    assert.match(String(allowed), /x-brainia-api-key/);
    assert.match(String(allowed), /x-brainia-client-id/);
  } finally {
    await app.close();
  }
});

test("financial consolidation route is registered and validates its payload", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/financial/transactions/financial_primary/merge",
      payload: {},
    });

    assert.equal(response.statusCode, 400);
    assert.equal((response.json() as { error: string }).error, "invalid_financial_transaction_merge");
  } finally {
    await app.close();
  }
});

test("reclassifying a transaction as a transfer requires complete transfer context", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/financial/transactions/financial_expense",
      payload: { kind: "transfer", accountId: "account_uyu" },
    });

    assert.equal(response.statusCode, 400);
    assert.equal((response.json() as { error: string }).error, "invalid_financial_transaction_context");
  } finally {
    await app.close();
  }
});

test("agent tool manifest is minimal and self-describing", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/agent/tools",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      tools: Array<{ name: string }>;
      sections: Array<{ id: string; tools: Array<{ name: string }> }>;
    };
    assert.deepEqual(body.sections.map((section) => section.id), [
      "non_financial_entity_extraction",
      "general_event_ingestion",
      "financial_alias_review",
    ]);
    assert.deepEqual(body.sections[2]?.tools.map((tool) => tool.name), [
      "list_entity_aliases",
      "list_alias_reviews",
      "resolve_alias_review",
      "ignore_alias_review",
    ]);
    assert.deepEqual(body.tools.map((tool) => tool.name), [
      "inspect_knowledge",
      "generate_insight",
      "list_insight_runs",
      "get_insight_run",
      "generate_digest",
      "list_digest_runs",
      "get_digest_run",
      "resolve_entity",
      "merge_entity",
      "list_entity_aliases",
      "list_alias_reviews",
      "resolve_alias_review",
      "ignore_alias_review",
      "ingest_event",
      "reprocess_event",
      "list_events",
      "view_metrics",
      "search_knowledge",
    ]);
  } finally {
    await app.close();
  }
});

test("agent mcp registry mirrors the minimal public tools", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/agent/mcp",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      tools: Array<{ name: string }>;
      sections: Array<{ id: string; tools: Array<{ name: string }> }>;
    };
    assert.deepEqual(body.sections.map((section) => section.id), [
      "non_financial_entity_extraction",
      "general_event_ingestion",
      "financial_alias_review",
    ]);
    assert.deepEqual(body.tools.map((tool) => tool.name), [
      "inspect_knowledge",
      "generate_insight",
      "list_insight_runs",
      "get_insight_run",
      "generate_digest",
      "list_digest_runs",
      "get_digest_run",
      "resolve_entity",
      "merge_entity",
      "list_entity_aliases",
      "list_alias_reviews",
      "resolve_alias_review",
      "ignore_alias_review",
      "ingest_event",
      "reprocess_event",
      "list_events",
      "view_metrics",
      "search_knowledge",
    ]);
  } finally {
    await app.close();
  }
});

test("agent mcp json-rpc initialize and tools list are available", async () => {
  const app = await createApp();
  try {
    const initializeResponse = await app.inject({
      method: "POST",
      url: "/api/v1/agent/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      },
    });

    assert.equal(initializeResponse.statusCode, 200);
    const initializeBody = initializeResponse.json() as {
      jsonrpc: string;
      result: { protocolVersion: string; serverInfo: { name: string; version: string } };
    };
    assert.equal(initializeBody.jsonrpc, "2.0");
    assert.equal(initializeBody.result.serverInfo.name, "BrainIA");

    const listResponse = await app.inject({
      method: "POST",
      url: "/api/v1/agent/mcp",
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      },
    });

    assert.equal(listResponse.statusCode, 200);
    const listBody = listResponse.json() as {
      result: {
        tools: Array<{ name: string }>;
        sections: Array<{ id: string; tools: Array<{ name: string }> }>;
      };
    };
    assert.deepEqual(listBody.result.sections.map((section) => section.id), [
      "non_financial_entity_extraction",
      "general_event_ingestion",
      "financial_alias_review",
    ]);
    assert.deepEqual(listBody.result.tools.map((tool) => tool.name), [
      "inspect_knowledge",
      "generate_insight",
      "list_insight_runs",
      "get_insight_run",
      "generate_digest",
      "list_digest_runs",
      "get_digest_run",
      "resolve_entity",
      "merge_entity",
      "list_entity_aliases",
      "list_alias_reviews",
      "resolve_alias_review",
      "ignore_alias_review",
      "ingest_event",
      "reprocess_event",
      "list_events",
      "view_metrics",
      "search_knowledge",
    ]);
  } finally {
    await app.close();
  }
});

test("ingest rejects invalid payloads before touching storage", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      payload: {
        source: "tasker",
      },
    });

    assert.equal(response.statusCode, 400);
    const body = response.json() as { error: string };
    assert.equal(body.error, "invalid_event");
  } finally {
    await app.close();
  }
});

test("health responses echo a request id for correlation", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        "x-request-id": "req-test-123",
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["x-request-id"], "req-test-123");
  } finally {
    await app.close();
  }
});

test("dashboard routes are available as an optional web surface", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/dashboard",
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /BrainIA Ops Dashboard/);

    const cssResponse = await app.inject({
      method: "GET",
      url: "/dashboard/styles.css",
    });

    assert.equal(cssResponse.statusCode, 200);
    assert.match(String(cssResponse.headers["content-type"]), /text\/css/);

    const jsResponse = await app.inject({
      method: "GET",
      url: "/dashboard/app.js",
    });

    assert.equal(jsResponse.statusCode, 200);
    assert.match(String(jsResponse.headers["content-type"]), /javascript/);
  } finally {
    await app.close();
  }
});

test("search rejects empty queries", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/search",
    });

    assert.equal(response.statusCode, 400);
    const body = response.json() as { error: string };
    assert.equal(body.error, "invalid_search_query");
  } finally {
    await app.close();
  }
});

test("insights rejects empty queries", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/insights",
    });

    assert.equal(response.statusCode, 400);
    const body = response.json() as { error: string };
    assert.equal(body.error, "invalid_insight_query");
  } finally {
    await app.close();
  }
});

test("insight history is available for agent audit and replay", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/insights/history?limit=25",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { limit: number; count: number; runs: unknown[] };
    assert.equal(body.limit, 25);
    assert.ok(Array.isArray(body.runs));
  } finally {
    await app.close();
  }
});

test("legacy mobile insight list requests remain compatible", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/insights?limit=3",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { limit: number; count: number; runs: unknown[] };
    assert.equal(body.limit, 3);
    assert.ok(Array.isArray(body.runs));
  } finally {
    await app.close();
  }
});

test("insight history returns a clear not-found error for unknown ids", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/insights/history/insight_missing",
    });

    assert.equal(response.statusCode, 404);
    const body = response.json() as { error: string };
    assert.equal(body.error, "insight_run_not_found");
  } finally {
    await app.close();
  }
});

test("digest generation is available and persists an audit snapshot", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/digests?days=7",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as {
      scope: string;
      summary: string | null;
      highlights: string[];
      audit: { id: string } | null;
    };
    assert.match(body.scope, /window/);
    assert.ok(Array.isArray(body.highlights));
    assert.ok(body.audit?.id);

    const historyResponse = await app.inject({
      method: "GET",
      url: "/api/v1/digests/history?limit=25",
    });

    assert.equal(historyResponse.statusCode, 200);
    const historyBody = historyResponse.json() as { count: number; runs: Array<{ id: string }> };
    assert.ok(historyBody.count >= 1);
    assert.ok(historyBody.runs.length >= 1);

    const digestId = body.audit?.id;
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/v1/digests/history/${digestId}`,
    });

    assert.equal(detailResponse.statusCode, 200);
    const detailBody = detailResponse.json() as { id: string };
    assert.equal(detailBody.id, digestId);
  } finally {
    await app.close();
  }
});

test("digest history returns a clear not-found error for unknown ids", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/digests/history/digest_missing",
    });

    assert.equal(response.statusCode, 404);
    const body = response.json() as { error: string };
    assert.equal(body.error, "digest_run_not_found");
  } finally {
    await app.close();
  }
});
