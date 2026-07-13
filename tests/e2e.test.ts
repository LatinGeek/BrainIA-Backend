import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

async function createApp() {
  const { buildApp } = await import("../src/app.ts");
  return buildApp();
}

test("end-to-end capture, retrieval, insight, and digest flow stays coherent", async () => {
  const app = await createApp();
  try {
    const suffix = crypto.randomUUID().slice(0, 8);
    const batchId = `batch_${suffix}`;
    const merchant = "Spotify";
    const noteId = `evt_note_${suffix}`;
    const emailId = `evt_email_${suffix}`;
    const notificationId = `evt_notification_${suffix}`;
    const walletId = `evt_wallet_${suffix}`;

    const captureResponse = await app.inject({
      method: "POST",
      url: "/api/v1/capture/batch",
      payload: {
        batchId,
        captures: [
          {
            type: "note",
            data: {
              id: noteId,
              source: "tasker",
              title: `Follow up ${merchant} ${suffix}`,
              body: `Remember to review ${merchant} ${suffix}`,
              idempotencyKey: `${noteId}-retry`,
              raw: { channel: "notes" },
              tags: ["journal", "memory"],
            },
          },
          {
            type: "email",
            data: {
              id: emailId,
              source: "mail",
              subject: `${merchant} receipt ${suffix}`,
              body: `Your receipt for ${merchant} was processed.`,
              from: "billing@example.com",
              to: "me@example.com",
              idempotencyKey: `${emailId}-retry`,
              raw: { channel: "email" },
              tags: ["receipt", "finance"],
            },
          },
          {
            type: "notification",
            data: {
              id: notificationId,
              source: "tasker",
              appName: "Wallet",
              packageName: "com.example.wallet",
              title: `${merchant} payment approved ${suffix}`,
              body: `Approved for $12.40`,
              idempotencyKey: `${notificationId}-retry`,
              raw: { channel: "notification" },
              tags: ["finance", "mobile"],
            },
          },
          {
            type: "wallet",
            data: {
              id: walletId,
              source: "wallet",
              merchant,
              amount: "12.40",
              currency: "USD",
              note: `Expense at ${merchant} ${suffix}`,
              idempotencyKey: `${walletId}-retry`,
              raw: { channel: "wallet" },
              tags: ["expense", "mobile"],
            },
          },
        ],
      },
    });

    assert.equal(captureResponse.statusCode, 201);
    const captureBody = captureResponse.json() as {
      batchId: string | null;
      count: number;
      items: Array<{ id: string; source: string; inferredKind: string }>;
    };
    assert.equal(captureBody.batchId, batchId);
    assert.equal(captureBody.count, 4);
    assert.equal(new Set(captureBody.items.map((item) => item.id)).size, 4);

    const retryResponse = await app.inject({
      method: "POST",
      url: "/api/v1/capture/batch",
      payload: {
        batchId,
        captures: [
          {
            type: "note",
            data: {
              id: noteId,
              source: "tasker",
              title: `Follow up ${merchant} ${suffix}`,
              body: `Remember to review ${merchant} ${suffix}`,
              idempotencyKey: `${noteId}-retry`,
              raw: { channel: "notes" },
              tags: ["journal", "memory"],
            },
          },
          {
            type: "email",
            data: {
              id: emailId,
              source: "mail",
              subject: `${merchant} receipt ${suffix}`,
              body: `Your receipt for ${merchant} was processed.`,
              from: "billing@example.com",
              to: "me@example.com",
              idempotencyKey: `${emailId}-retry`,
              raw: { channel: "email" },
              tags: ["receipt", "finance"],
            },
          },
          {
            type: "notification",
            data: {
              id: notificationId,
              source: "tasker",
              appName: "Wallet",
              packageName: "com.example.wallet",
              title: `${merchant} payment approved ${suffix}`,
              body: `Approved for $12.40`,
              idempotencyKey: `${notificationId}-retry`,
              raw: { channel: "notification" },
              tags: ["finance", "mobile"],
            },
          },
          {
            type: "wallet",
            data: {
              id: walletId,
              source: "wallet",
              merchant,
              amount: "12.40",
              currency: "USD",
              note: `Expense at ${merchant} ${suffix}`,
              idempotencyKey: `${walletId}-retry`,
              raw: { channel: "wallet" },
              tags: ["expense", "mobile"],
            },
          },
        ],
      },
    });

    assert.equal(retryResponse.statusCode, 201);
    const retryBody = retryResponse.json() as {
      count: number;
      items: Array<{ id: string }>;
    };
    assert.equal(retryBody.count, 4);
    assert.equal(new Set(retryBody.items.map((item) => item.id)).size, 4);

    const eventsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/events",
    });

    assert.equal(eventsResponse.statusCode, 200);
    const events = eventsResponse.json() as Array<{ id: string; source: string; kind: string }>;
    const capturedIds = new Set([noteId, emailId, notificationId, walletId]);
    const storedCapturedEvents = events.filter((event) => capturedIds.has(event.id));
    assert.equal(storedCapturedEvents.length, 4);

    const searchResponse = await app.inject({
      method: "GET",
      url: `/api/v1/search?q=${encodeURIComponent(merchant)}`,
    });

    assert.equal(searchResponse.statusCode, 200);
    const searchBody = searchResponse.json() as {
      query: string;
      entities: Array<{ id: string; value: string; matchHint?: { explanation: string } }>;
    };
    assert.equal(searchBody.query, merchant);
    assert.ok(searchBody.entities.some((entity) => entity.value.toLowerCase().includes(merchant.toLowerCase())));

    const resolveResponse = await app.inject({
      method: "GET",
      url: `/api/v1/entities/resolve?q=${encodeURIComponent(merchant)}`,
    });

    assert.equal(resolveResponse.statusCode, 200);
    const resolveBody = resolveResponse.json() as {
      matches: Array<{ id: string; canonicalEntityId: string; isCanonical: boolean }>;
    };
    assert.ok(resolveBody.matches.length > 0);
    const canonicalEntityId = resolveBody.matches[0]?.canonicalEntityId;
    assert.ok(canonicalEntityId);

    const graphResponse = await app.inject({
      method: "GET",
      url: `/api/v1/entities/${canonicalEntityId}/graph?depth=2&maxNodes=50&maxRelations=50`,
    });

    assert.equal(graphResponse.statusCode, 200);
    const graphBody = graphResponse.json() as {
      rootEntity: { id: string; value: string };
      nodes: Array<{ id: string }>;
      relations: Array<{ id: string }>;
    };
    assert.equal(graphBody.rootEntity.id, canonicalEntityId);
    assert.ok(graphBody.nodes.length > 0);
    assert.ok(graphBody.relations.length > 0);

    const inspectResponse = await app.inject({
      method: "GET",
      url: `/api/v1/agent/inspect?q=${encodeURIComponent(merchant)}&depth=2&maxNodes=50&maxRelations=50`,
    });

    assert.equal(inspectResponse.statusCode, 200);
    const inspectBody = inspectResponse.json() as {
      resolution: { canonicalEntityId: string | null };
      graphSummary: { nodesCount: number; relationsCount: number } | null;
    };
    assert.equal(inspectBody.resolution.canonicalEntityId, canonicalEntityId);
    assert.ok((inspectBody.graphSummary?.nodesCount ?? 0) > 0);

    const insightResponse = await app.inject({
      method: "GET",
      url: `/api/v1/insights?q=${encodeURIComponent(merchant)}&depth=2&maxNodes=50&maxRelations=50`,
    });

    assert.equal(insightResponse.statusCode, 200);
    const insightBody = insightResponse.json() as {
      query: string | null;
      resolution: { canonicalEntityId: string | null };
      audit: { id: string } | null;
      model: string | null;
      summaryAvailable: boolean;
    };
    assert.equal(insightBody.query, merchant);
    assert.equal(insightBody.resolution.canonicalEntityId, canonicalEntityId);
    assert.ok(insightBody.audit?.id);
    assert.equal(typeof insightBody.summaryAvailable, "boolean");

    const insightHistoryResponse = await app.inject({
      method: "GET",
      url: "/api/v1/insights/history?limit=10",
    });

    assert.equal(insightHistoryResponse.statusCode, 200);
    const insightHistory = insightHistoryResponse.json() as { runs: Array<{ id: string }> };
    assert.ok(insightHistory.runs.some((run) => run.id === insightBody.audit?.id));

    const digestResponse = await app.inject({
      method: "GET",
      url: "/api/v1/digests?days=30&eventLimit=50",
    });

    assert.equal(digestResponse.statusCode, 200);
    const digestBody = digestResponse.json() as {
      audit: { id: string } | null;
      metrics: { totalEvents: number };
      recentEvents: Array<{ id: string }>;
      highlights: string[];
      summary: string | null;
      summaryAvailable: boolean;
    };
    assert.ok(digestBody.audit?.id);
    assert.ok(digestBody.metrics.totalEvents >= 4);
    assert.ok(digestBody.recentEvents.some((event) => capturedIds.has(event.id)));
    assert.ok(digestBody.highlights.length > 0);
    assert.equal(typeof digestBody.summaryAvailable, "boolean");

    const digestHistoryResponse = await app.inject({
      method: "GET",
      url: "/api/v1/digests/history?limit=10",
    });

    assert.equal(digestHistoryResponse.statusCode, 200);
    const digestHistory = digestHistoryResponse.json() as { runs: Array<{ id: string }> };
    assert.ok(digestHistory.runs.some((run) => run.id === digestBody.audit?.id));

    const toolsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/agent/tools",
    });

    assert.equal(toolsResponse.statusCode, 200);
    const toolsBody = toolsResponse.json() as { tools: Array<{ name: string }> };
    const toolNames = toolsBody.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes("generate_digest"));
    assert.ok(toolNames.includes("list_digest_runs"));
    assert.ok(toolNames.includes("get_digest_run"));
    assert.ok(toolNames.includes("generate_insight"));

    const dashboardResponse = await app.inject({
      method: "GET",
      url: "/dashboard",
    });

    assert.equal(dashboardResponse.statusCode, 200);
    assert.match(dashboardResponse.body, /BrainIA Ops Dashboard/);
  } finally {
    await app.close();
  }
});
