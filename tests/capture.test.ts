import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/brainia_test";

const { registerCaptureRoutes } = await import("../src/routes/capture.ts");
const { buildCaptureBatchEvents } = await import("../src/domain/capture.ts");

async function createCaptureApp(ingestEvent: (event: any, context?: { clientId?: string | null }) => Promise<any>) {
  const app = Fastify({ logger: false });
  await app.register(registerCaptureRoutes({
    authConfig: { globalApiKey: null, clientKeys: new Map() },
    ingestEvent,
  }), { prefix: "/api/v1" });
  return app;
}

test("capture note route normalizes note payloads into the base event contract", async () => {
  const calls: any[] = [];
  const app = await createCaptureApp(async (event, context) => {
    calls.push({ event, context });
    return {
      id: event.id,
      source: event.source,
      inferredKind: event.kind,
      dedupeKey: `${event.source}:${event.id}`,
    };
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/capture/note",
      payload: {
        id: "note_1",
        title: "Daily note",
        body: "Capture this",
        raw: { origin: "mobile" },
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.event.source, "capture.note");
    assert.equal(calls[0]?.event.kind, "note");
    assert.equal(calls[0]?.event.raw.origin, "mobile");
  } finally {
    await app.close();
  }
});

test("capture batch route expands source-specific payloads into events", async () => {
  const events = buildCaptureBatchEvents({
    batchId: "batch_1",
    captures: [
      {
        type: "notification",
        data: {
          id: "notif_1",
          appName: "Wallet",
          title: "Compra aprobada",
          body: "Visa 12.40",
          raw: { packageName: "com.wallet.app" },
        },
      },
      {
        type: "wallet",
        data: {
          id: "wallet_1",
          merchant: "Spotify",
          amount: "12.40",
          currency: "USD",
          raw: { transactionId: "txn_1" },
        },
      },
    ],
  });

  assert.equal(events.length, 2);
  assert.equal(events[0]?.source, "Wallet");
  assert.equal(events[0]?.kind, "notification");
  assert.equal(events[0]?.raw.captureBatchId, "batch_1");
  assert.equal(events[0]?.raw.captureType, "notification");
  assert.equal(events[1]?.kind, "expense");
  assert.equal(events[1]?.body?.includes("Spotify"), true);
});
