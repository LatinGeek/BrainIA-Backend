import type { EventInput } from "./event.js";

export class EventCaptureConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "event_identity_conflict";
  constructor() {
    super("A capture identity is already in use. Retry the original payload or submit a new capture with new identities.");
  }
}

// JSON objects are unordered; arrays (including tags) retain their order.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}

export function captureContent(event: EventInput) {
  return JSON.stringify(canonical({
    source: event.source, contractVersion: event.contractVersion, kind: event.kind,
    title: event.title ?? null, body: event.body ?? null,
    timestamp: event.timestamp == null ? null : new Date(event.timestamp).toISOString(),
    externalId: event.externalId ?? null, idempotencyKey: event.idempotencyKey ?? null,
    raw: event.raw ?? {}, tags: event.tags ?? [],
  }));
}

// Structured encoding avoids separator, anonymous-owner and identity-type collisions.
export function captureDedupeKey(event: EventInput, clientId: string | null | undefined) {
  const identity = event.idempotencyKey != null ? ["idempotency", event.idempotencyKey]
    : event.externalId != null ? ["external", event.externalId] : ["id", event.id];
  return JSON.stringify(["capture-v2", clientId ?? null, event.source, ...identity]);
}
