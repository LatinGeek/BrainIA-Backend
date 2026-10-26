import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";
process.env.DEEPSEEK_API_KEY = "";

async function createApp() {
  const { buildApp } = await import("../src/app.ts");
  return buildApp();
}

test("end-to-end capture, retrieval, insight, and digest flow stays coherent", async () => {
  const app = await createApp();
  try {
    const suffix = crypto.randomUUID().slice(0, 8);
    const batchId = `batch_${suffix}`;
    const merchant = `Spotify ${suffix}`;
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
              body: `Approved for USD 12.40`,
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
    assert.equal(
      captureBody.items.some((item) => item.id === noteId),
      true,
    );

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
              body: `Approved for USD 12.40`,
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

    const financialTransactionsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/financial/transactions?limit=10",
    });

    assert.equal(financialTransactionsResponse.statusCode, 200);
    const financialTransactionsBody = financialTransactionsResponse.json() as {
      count: number;
      items: Array<{
        id: string;
        kind: string;
        amount: string;
        currency: string;
        merchantLabel: string;
        evidence: Array<{ rawEventId: string; source: string }>;
      }>;
    };
    const flowTransactions = financialTransactionsBody.items.filter((transaction) =>
      transaction.evidence.some((evidence) => evidence.rawEventId === notificationId || evidence.rawEventId === walletId),
    );

    assert.equal(flowTransactions.length, 2);
    assert.ok(flowTransactions.every((transaction) => transaction.kind === "expense"));
    assert.ok(flowTransactions.every((transaction) => transaction.evidence.length === 1));
    assert.ok(flowTransactions.every((transaction) =>
      transaction.merchantLabel.toLowerCase().includes(merchant.toLowerCase()),
    ));

    const preReviewQueueResponse = await app.inject({
      method: "GET",
      url: "/api/v1/review/aliases?status=pending",
    });

    assert.equal(preReviewQueueResponse.statusCode, 200);
    const preReviewQueueBody = preReviewQueueResponse.json() as {
      items: Array<{ eventId: string | null }>;
    };
    assert.equal(
      preReviewQueueBody.items.some((item) => item.eventId === emailId),
      false,
    );

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

    const reviewMerchant = `Las Acacias SRL ${suffix}`;
    const reviewAlias = `kiosco-${suffix}`;
    const reviewNotificationId = `evt_review_notification_${suffix}`;

    const reviewCaptureResponse = await app.inject({
      method: "POST",
      url: "/api/v1/capture/notification",
      payload: {
        id: reviewNotificationId,
        source: "tasker",
        appName: "Google Wallet",
        packageName: "com.google.android.apps.walletnfcrel",
        title: `Compra en ${reviewMerchant}`,
        body: "Pago aprobado por Google Wallet.",
        idempotencyKey: `${reviewNotificationId}-retry`,
        raw: { channel: "notification" },
        tags: ["finance", "alias-review"],
      },
    });

    assert.equal(reviewCaptureResponse.statusCode, 201);

    const reviewQueueResponse = await app.inject({
      method: "GET",
      url: "/api/v1/review/aliases?status=pending",
    });

    assert.equal(reviewQueueResponse.statusCode, 200);
    const reviewQueueBody = reviewQueueResponse.json() as {
      items: Array<{ id: string; eventId: string | null; originalValue: string; entityId: string; status: string }>;
    };
    assert.equal(
      reviewQueueBody.items.some((item) => item.eventId === noteId),
      false,
    );
    const pendingReview = reviewQueueBody.items.find((item) => item.eventId === reviewNotificationId);
    if (!pendingReview) {
      assert.fail(`No pending review found for ${reviewNotificationId}`);
    }

    const pendingReviewId = pendingReview.id;
    const pendingReviewEntityId = pendingReview.entityId;
    assert.equal(pendingReview.status, "pending");

    const resolveReviewResponse = await app.inject({
      method: "POST",
      url: `/api/v1/review/aliases/${pendingReviewId}/resolve`,
      payload: {
        alias: reviewAlias,
        categoryPath: ["gastos", "supermercado"],
        notes: "Alias manual para pruebas",
      },
    });

    assert.equal(resolveReviewResponse.statusCode, 200);
    const resolveReviewBody = resolveReviewResponse.json() as {
      review: { id: string; status: string; aliasId: string | null } | null;
      alias: { id: string; entityId: string; alias: string; categoryPath: string[] } | null;
      alreadyResolved: boolean;
    };
    assert.equal(resolveReviewBody.alreadyResolved, false);
    assert.equal(resolveReviewBody.review?.status, "resolved");
    assert.equal(resolveReviewBody.alias?.alias, reviewAlias);
    assert.equal(resolveReviewBody.alias?.entityId, pendingReviewEntityId);

    const aliasListResponse = await app.inject({
      method: "GET",
      url: `/api/v1/aliases?entityId=${encodeURIComponent(pendingReviewEntityId)}`,
    });

    assert.equal(aliasListResponse.statusCode, 200);
    const aliasListBody = aliasListResponse.json() as {
      aliases: Array<{ alias: string; categoryPath: string[] }>;
    };
    assert.ok(aliasListBody.aliases.some((alias) => alias.alias === reviewAlias));

    const aliasResolveResponse = await app.inject({
      method: "GET",
      url: `/api/v1/entities/resolve?q=${encodeURIComponent(reviewAlias)}`,
    });

    assert.equal(aliasResolveResponse.statusCode, 200);
    const aliasResolveBody = aliasResolveResponse.json() as {
      matches: Array<{ canonicalEntityId: string; matchedEntityId: string }>;
    };
    assert.ok(aliasResolveBody.matches.some((match) => match.canonicalEntityId === pendingReviewEntityId));

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
    assert.ok(Array.isArray(graphBody.relations));

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
    assert.ok(toolNames.includes("list_entity_aliases"));
    assert.ok(toolNames.includes("list_alias_reviews"));
    assert.ok(toolNames.includes("resolve_alias_review"));
    assert.ok(toolNames.includes("ignore_alias_review"));

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
