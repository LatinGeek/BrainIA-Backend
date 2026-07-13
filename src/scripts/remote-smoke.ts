import crypto from "node:crypto";

type SmokeResponse = {
  status: number;
  body: unknown;
};

function readBaseUrl() {
  const value = process.env.BRAINIA_BASE_URL ?? process.argv[2];
  if (!value?.trim()) {
    throw new Error("Provide BRAINIA_BASE_URL or pass the base URL as the first argument");
  }

  return value.trim().replace(/\/+$/, "");
}

function buildHeaders() {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  const apiKey = process.env.BRAINIA_API_KEY?.trim();
  if (apiKey) {
    headers["x-brainia-api-key"] = apiKey;
  }

  const clientId = process.env.BRAINIA_CLIENT_ID?.trim();
  if (clientId) {
    headers["x-brainia-client-id"] = clientId;
  }

  return headers;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function postSmokeNotification(baseUrl: string): Promise<SmokeResponse> {
  const runId = crypto.randomUUID().slice(0, 8);
  const eventId = `smoke_notif_${runId}`;
  const response = await fetch(`${baseUrl}/api/v1/capture/notification`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      id: eventId,
      source: "codex-smoke",
      appName: "BrainIA Smoke Test",
      packageName: "com.brainia.smoke",
      title: `Smoke test ${runId}`,
      body: "Verifying deployed backend capture endpoint",
      idempotencyKey: eventId,
      raw: {
        origin: "codex",
        kind: "smoke-notification",
      },
      tags: ["smoke", "test", "notification"],
    }),
  });

  return {
    status: response.status,
    body: await readJsonResponse(response),
  };
}

async function verifyEventStored(baseUrl: string, eventId: string): Promise<SmokeResponse> {
  const response = await fetch(`${baseUrl}/api/v1/events`, {
    headers: buildHeaders(),
  });

  const body = await readJsonResponse(response);
  if (!response.ok) {
    return {
      status: response.status,
      body,
    };
  }

  if (!Array.isArray(body)) {
    return {
      status: 500,
      body: { error: "unexpected_events_shape", body },
    };
  }

  const matched = body.find((item) => item && typeof item === "object" && "id" in item && (item as { id?: string }).id === eventId);

  return {
    status: matched ? 200 : 404,
    body: matched ?? { error: "event_not_found", eventId },
  };
}

async function main() {
  const baseUrl = readBaseUrl();
  const healthResponse = await fetch(`${baseUrl}/health`);
  if (!healthResponse.ok) {
    throw new Error(`Health check failed with ${healthResponse.status}`);
  }

  const smokeResult = await postSmokeNotification(baseUrl);
  if (smokeResult.status !== 201) {
    throw new Error(`Smoke POST failed with ${smokeResult.status}: ${JSON.stringify(smokeResult.body)}`);
  }

  const eventId = (smokeResult.body as { id?: string } | null)?.id;
  if (!eventId) {
    throw new Error(`Smoke POST response did not include an event id: ${JSON.stringify(smokeResult.body)}`);
  }

  const verification = await verifyEventStored(baseUrl, eventId);
  if (verification.status !== 200) {
    throw new Error(`Smoke verification failed with ${verification.status}: ${JSON.stringify(verification.body)}`);
  }

  console.log(
    JSON.stringify(
      {
        baseUrl,
        health: healthResponse.status,
        post: smokeResult.status,
        verify: verification.status,
        eventId,
      },
      null,
      2,
    ),
  );
}

await main();
