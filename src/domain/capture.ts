import type { EventInput } from "./event.js";

function trimOrNull(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildBaseEvent(input: {
  id: string;
  source: string;
  kind: EventInput["kind"];
  title?: string | null;
  body?: string | null;
  timestamp?: string;
  externalId?: string | null;
  idempotencyKey?: string | null;
  contractVersion?: number;
  raw?: Record<string, unknown>;
  tags?: string[];
}): EventInput {
  return {
    id: input.id,
    source: input.source,
    contractVersion: input.contractVersion ?? 1,
    kind: input.kind,
    title: trimOrNull(input.title) ?? undefined,
    body: trimOrNull(input.body) ?? undefined,
    timestamp: input.timestamp,
    externalId: trimOrNull(input.externalId) ?? undefined,
    idempotencyKey: trimOrNull(input.idempotencyKey) ?? undefined,
    raw: input.raw ?? {},
    tags: input.tags ?? [],
  };
}

export function buildNoteCaptureEvent(input: {
  id: string;
  source?: string;
  title?: string;
  body?: string;
  timestamp?: string;
  externalId?: string;
  idempotencyKey?: string;
  contractVersion?: number;
  raw?: Record<string, unknown>;
  tags?: string[];
}) {
  return buildBaseEvent({
    ...input,
    source: input.source?.trim() || "capture.note",
    kind: "note",
  });
}

export function buildEmailCaptureEvent(input: {
  id: string;
  source?: string;
  subject?: string;
  body?: string;
  from?: string;
  to?: string;
  cc?: string[];
  timestamp?: string;
  externalId?: string;
  idempotencyKey?: string;
  contractVersion?: number;
  raw?: Record<string, unknown>;
  tags?: string[];
}) {
  const envelope = [
    input.from ? `from: ${input.from}` : null,
    input.to ? `to: ${input.to}` : null,
    input.cc?.length ? `cc: ${input.cc.join(", ")}` : null,
    input.body ? `body: ${input.body}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return buildBaseEvent({
    ...input,
    source: input.source?.trim() || "capture.email",
    kind: "email",
    title: input.subject ?? input.body ?? "email capture",
    body: envelope || input.body || input.subject || undefined,
  });
}

export function buildNotificationCaptureEvent(input: {
  id: string;
  source?: string;
  appName?: string;
  packageName?: string;
  title?: string;
  body?: string;
  timestamp?: string;
  externalId?: string;
  idempotencyKey?: string;
  contractVersion?: number;
  raw?: Record<string, unknown>;
  tags?: string[];
}) {
  return buildBaseEvent({
    ...input,
    source: input.source?.trim() || input.appName?.trim() || input.packageName?.trim() || "capture.notification",
    kind: "notification",
    title: input.title ?? input.appName ?? input.packageName ?? "notification capture",
    body: input.body ?? undefined,
  });
}

export function buildWalletCaptureEvent(input: {
  id: string;
  source?: string;
  merchant?: string;
  amount?: string;
  currency?: string;
  note?: string;
  timestamp?: string;
  externalId?: string;
  idempotencyKey?: string;
  contractVersion?: number;
  raw?: Record<string, unknown>;
  tags?: string[];
}) {
  const details = [
    input.merchant?.trim() || null,
    input.amount?.trim() ? `${input.amount.trim()} ${input.currency?.trim() ?? ""}`.trim() : null,
    input.note?.trim() || null,
  ]
    .filter(Boolean)
    .join(" ");

  return buildBaseEvent({
    ...input,
    source: input.source?.trim() || "capture.wallet",
    kind: "expense",
    title: input.merchant ?? input.note ?? "wallet capture",
    body: details || input.note || input.merchant || undefined,
    raw: {
      ...input.raw,
      merchant: input.merchant ?? null,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      note: input.note ?? null,
    },
  });
}

export type CaptureBatchItem =
  | {
      type: "note";
      data: Parameters<typeof buildNoteCaptureEvent>[0];
    }
  | {
      type: "email";
      data: Parameters<typeof buildEmailCaptureEvent>[0];
    }
  | {
      type: "notification";
      data: Parameters<typeof buildNotificationCaptureEvent>[0];
    }
  | {
      type: "wallet";
      data: Parameters<typeof buildWalletCaptureEvent>[0];
    };

export function buildCaptureBatchEvents(input: {
  batchId?: string;
  captures: CaptureBatchItem[];
}) {
  return input.captures.map((capture) => {
    const raw = {
      ...capture.data.raw,
      captureType: capture.type,
      captureBatchId: input.batchId ?? null,
    };

    switch (capture.type) {
      case "note":
        return buildNoteCaptureEvent({
          ...capture.data,
          raw,
        });
      case "email":
        return buildEmailCaptureEvent({
          ...capture.data,
          raw,
        });
      case "notification":
        return buildNotificationCaptureEvent({
          ...capture.data,
          raw,
        });
      case "wallet":
        return buildWalletCaptureEvent({
          ...capture.data,
          raw,
        });
    }
  });
}
