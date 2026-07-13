import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

async function createApp() {
  const { buildApp } = await import("../src/app.ts");
  return buildApp();
}

test("agent tool manifest is minimal and self-describing", async () => {
  const app = await createApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/agent/tools",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { tools: Array<{ name: string }> };
    assert.deepEqual(body.tools.map((tool) => tool.name), [
      "inspect_knowledge",
      "ingest_event",
      "list_events",
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
    const body = response.json() as { tools: Array<{ name: string }> };
    assert.deepEqual(body.tools.map((tool) => tool.name), [
      "inspect_knowledge",
      "ingest_event",
      "list_events",
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
