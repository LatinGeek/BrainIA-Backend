import type { EventInput } from "./event.js";

function trimOrNull(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function joinEnvelopeLines(values: Array<string | null | undefined>) {
  return values
    .map((value) => value?.trim() ?? null)
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

type RawRecord = Record<string, unknown>;

function readRawField(raw: RawRecord | undefined, key: string) {
  if (!raw) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(raw, key)) {
    return raw[key];
  }

  const providerPayload = raw.providerPayload;
  if (providerPayload && typeof providerPayload === "object" && !Array.isArray(providerPayload)) {
    const providerRecord = providerPayload as RawRecord;
    if (Object.prototype.hasOwnProperty.call(providerRecord, key)) {
      return providerRecord[key];
    }
  }

  return undefined;
}

function extractStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractStringValue(item);
      if (extracted) {
        return extracted;
      }
    }
  }

  if (value && typeof value === "object") {
    const record = value as RawRecord;
    for (const key of ["displayName", "name", "email", "address", "value", "text"]) {
      const extracted = extractStringValue(record[key]);
      if (extracted) {
        return extracted;
      }
    }
  }

  return null;
}

function readEmailField(raw: RawRecord | undefined, keys: string[]) {
  for (const key of keys) {
    const extracted = extractStringValue(readRawField(raw, key));
    if (extracted) {
      return extracted;
    }
  }

  return null;
}

function buildStableEmailIdempotencyKey(input: {
  provider?: string;
  accountId?: string;
  messageId?: string;
  threadId?: string;
  externalId?: string;
  idempotencyKey?: string;
}) {
  if (input.idempotencyKey?.trim()) {
    return input.idempotencyKey.trim();
  }

  const parts = [
    input.provider?.trim(),
    input.accountId?.trim(),
    input.messageId?.trim() || input.externalId?.trim(),
    input.threadId?.trim(),
  ].filter(Boolean);

  return parts.length ? parts.join(":") : null;
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
  provider?: string;
  accountId?: string;
  messageId?: string;
  threadId?: string;
  folder?: string;
  labels?: string[];
  subject?: string;
  snippet?: string;
  body?: string;
  from?: string;
  to?: string;
  cc?: string[];
  bcc?: string[];
  timestamp?: string;
  externalId?: string;
  idempotencyKey?: string;
  contractVersion?: number;
  raw?: Record<string, unknown>;
  tags?: string[];
}) {
  const normalizedSender =
    readEmailField(input.raw, ["fromName", "fromEmail", "senderName", "senderEmail", "from", "sender"]) ??
    input.from ??
    null;
  const normalizedRecipient =
    readEmailField(input.raw, ["to", "recipient", "recipientEmail", "toEmail"]) ??
    input.to ??
    null;
  const envelope = joinEnvelopeLines([
    input.provider ? `provider: ${input.provider}` : null,
    input.accountId ? `accountId: ${input.accountId}` : null,
    input.messageId ? `messageId: ${input.messageId}` : null,
    input.threadId ? `threadId: ${input.threadId}` : null,
    input.folder ? `folder: ${input.folder}` : null,
    input.from ? `from: ${input.from}` : null,
    input.to ? `to: ${input.to}` : null,
    input.cc?.length ? `cc: ${input.cc.join(", ")}` : null,
    input.bcc?.length ? `bcc: ${input.bcc.join(", ")}` : null,
    input.snippet ? `snippet: ${input.snippet}` : null,
    input.body ? `body: ${input.body}` : null,
  ]);

  return buildBaseEvent({
    ...input,
    source: input.source?.trim() || input.provider?.trim() || "capture.email",
    kind: "email",
    title: input.subject ?? input.snippet ?? input.body ?? "email capture",
    body: envelope || input.body || input.snippet || input.subject || undefined,
    externalId: trimOrNull(input.externalId ?? input.messageId ?? null) ?? undefined,
    idempotencyKey: buildStableEmailIdempotencyKey(input) ?? undefined,
    raw: {
      ...input.raw,
      provider: input.provider ?? null,
      accountId: input.accountId ?? null,
      messageId: input.messageId ?? null,
      threadId: input.threadId ?? null,
      folder: input.folder ?? null,
      labels: input.labels ?? [],
      snippet: input.snippet ?? null,
      from: normalizedSender,
      sender: normalizedSender,
      to: normalizedRecipient,
      recipient: normalizedRecipient,
      cc: input.cc ?? [],
      bcc: input.bcc ?? [],
    },
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
  transactionType?: "income" | "expense";
  accountId?: string;
  category?: string;
  timestamp?: string;
  externalId?: string;
  idempotencyKey?: string;
  contractVersion?: number;
  raw?: Record<string, unknown>;
  tags?: string[];
}) {
  const transactionType = input.transactionType ?? "expense";
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
    kind: transactionType,
    title: input.merchant ?? input.note ?? transactionType,
    body: details || input.note || input.merchant || undefined,
    raw: {
      ...input.raw,
      merchant: input.merchant ?? null,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      note: input.note ?? null,
      transactionType,
      accountId: input.accountId?.trim() || null,
      category: input.category?.trim() || null,
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
