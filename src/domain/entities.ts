export type EntityDraft = {
  type: string;
  value: string;
  normalizedValue: string;
  metadata?: Record<string, unknown>;
};

type RawRecord = Record<string, unknown>;

export function normalizeEntityValue(value: string) {
  return value.trim().toLowerCase();
}

const NOISY_ENTITY_VALUES = new Set([
  "compra",
  "gasto",
  "pago",
  "pagado",
  "payment",
  "transferencia",
  "alert",
  "alerta",
  "notification",
  "notificacion",
  "mensaje",
  "message",
  "note",
  "nota",
]);

const GENERIC_MERCHANT_PREFIXES = new Set([
  "compra",
  "gasto",
  "pago",
  "pagado",
  "payment",
  "transferencia",
  "en",
  "de",
  "del",
  "por",
  "para",
  "with",
  "to",
  "at",
  "from",
  "via",
  "la",
  "el",
  "los",
  "las",
]);

const MERCHANT_TERMINATORS = new Set([
  "payment",
  "receipt",
  "recibo",
  "approved",
  "processed",
  "charged",
  "paid",
  "debit",
  "credit",
  "invoice",
  "transaction",
  "notification",
  "alert",
  "expense",
  "gasto",
  "compra",
  "pago",
  "payment",
]);

function buildDraftMetadata(source: string, extras: Record<string, unknown> = {}) {
  return {
    source,
    ...extras,
  };
}

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

function readRawString(raw: RawRecord | undefined, keys: string[]) {
  for (const key of keys) {
    const extracted = extractStringValue(readRawField(raw, key));
    if (extracted) {
      return extracted;
    }
  }

  return null;
}

function readEnvelopeField(text: string | undefined, label: string) {
  if (!text) {
    return null;
  }

  const match = text.match(new RegExp(`(?:^|\\n)${label}:\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() || null;
}

function isMeaningfulDraft(draft: EntityDraft) {
  if (!draft.normalizedValue) {
    return false;
  }

  if (draft.normalizedValue.length < 2 && draft.type !== "amount") {
    return false;
  }

  if (!/[a-z0-9]/i.test(draft.normalizedValue)) {
    return false;
  }

  if (draft.type === "merchant" && NOISY_ENTITY_VALUES.has(draft.normalizedValue)) {
    return false;
  }

  if (draft.type === "notification" && NOISY_ENTITY_VALUES.has(draft.normalizedValue)) {
    return false;
  }

  return true;
}

function dedupeEntityDrafts(drafts: EntityDraft[]) {
  const seen = new Set<string>();
  const deduped: EntityDraft[] = [];

  for (const draft of drafts) {
    const key = `${draft.type}:${draft.normalizedValue}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(draft);
  }

  return deduped;
}

function cleanMerchantCandidate(value: string) {
  const words = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  while (words.length > 0 && GENERIC_MERCHANT_PREFIXES.has(normalizeEntityValue(words[0]))) {
    words.shift();
  }

  const stopIndex = words.findIndex((word, index) => index > 0 && MERCHANT_TERMINATORS.has(normalizeEntityValue(word)));
  if (stopIndex > 0) {
    words.length = stopIndex;
  }

  return words.join(" ").trim();
}

export function buildEntityDrafts(input: {
  title?: string;
  body?: string;
  source?: string;
  raw?: RawRecord;
  inferredKind: string;
  entities: Array<{ type: string; value: string }>;
}): EntityDraft[] {
  const drafts: EntityDraft[] = [];

  for (const entity of input.entities) {
    const normalizedValue = normalizeEntityValue(entity.value);
    if (!normalizedValue) continue;

    drafts.push({
      type: entity.type,
      value: entity.value,
      normalizedValue,
      metadata: buildDraftMetadata("classifier"),
    });
  }

  if (input.inferredKind === "expense" || input.inferredKind === "notification") {
    const text = `${input.title ?? ""} ${input.body ?? ""}`;
    const expenseMatch = text.match(/\b(gasto|compra|pag[oó])\b/i);
    if (expenseMatch?.[1]) {
      drafts.push({
        type: "expense",
        value: expenseMatch[1],
        normalizedValue: normalizeEntityValue(expenseMatch[1]),
        metadata: buildDraftMetadata("heuristic", {
          signal: "expense_keyword",
        }),
      });
    }

    const merchantMatch = text.match(/\b([\p{L}\p{N}][\p{L}\p{N}&.\-*/ ]{2,})\b/iu);
    if (merchantMatch?.[1]) {
      const value = cleanMerchantCandidate(merchantMatch[1]);
      if (value) {
        const normalizedValue = normalizeEntityValue(value);
        if (!NOISY_ENTITY_VALUES.has(normalizedValue)) {
          drafts.push({
            type: "merchant",
            value,
            normalizedValue,
            metadata: buildDraftMetadata("heuristic", {
              signal: "merchant_candidate",
              originalCandidate: merchantMatch[1].trim(),
            }),
          });
        }
      }
    }
  }

  if (input.inferredKind === "email") {
    const senderValue =
      readRawString(input.raw, ["fromName", "senderName"]) ??
      readRawString(input.raw, ["from", "sender"]) ??
      readEnvelopeField(input.body, "from");
    const senderAddress =
      readRawString(input.raw, ["fromEmail", "senderEmail"]) ??
      readEnvelopeField(input.body, "from");

    if (senderValue) {
      drafts.push({
        type: "sender",
        value: senderValue,
        normalizedValue: normalizeEntityValue(senderValue),
        metadata: buildDraftMetadata("heuristic", {
          signal: "email_sender",
          emailAddress: senderAddress ?? null,
        }),
      });
    }

    const recipientValue =
      readRawString(input.raw, ["to", "recipient", "toName"]) ??
      readEnvelopeField(input.body, "to");
    const recipientAddress =
      readRawString(input.raw, ["toEmail", "recipientEmail"]) ??
      readEnvelopeField(input.body, "to");

    if (recipientValue) {
      drafts.push({
        type: "recipient",
        value: recipientValue,
        normalizedValue: normalizeEntityValue(recipientValue),
        metadata: buildDraftMetadata("heuristic", {
          signal: "recipient_hint",
          emailAddress: recipientAddress ?? null,
        }),
      });
    }

    drafts.push({
      type: "message",
      value: input.title ?? input.body ?? "email message",
      normalizedValue: normalizeEntityValue(input.title ?? input.body ?? "email message"),
      metadata: buildDraftMetadata("heuristic", {
        signal: "email_message",
      }),
    });
  }

  if (input.inferredKind === "notification") {
    drafts.push({
      type: "notification",
      value: input.title ?? input.body ?? "notification",
      normalizedValue: normalizeEntityValue(input.title ?? input.body ?? "notification"),
      metadata: buildDraftMetadata("heuristic", {
        signal: "notification_payload",
      }),
    });

    if (input.source?.trim()) {
      drafts.push({
        type: "source",
        value: input.source.trim(),
        normalizedValue: normalizeEntityValue(input.source),
        metadata: buildDraftMetadata("heuristic", {
          signal: "notification_source",
        }),
      });
    }
  }

  return dedupeEntityDrafts(drafts.filter(isMeaningfulDraft));
}
