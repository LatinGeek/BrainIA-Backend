export type EntityDraft = {
  type: string;
  value: string;
  normalizedValue: string;
  metadata?: Record<string, unknown>;
};

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
  "notificación",
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

function buildDraftMetadata(source: string, extras: Record<string, unknown> = {}) {
  return {
    source,
    ...extras,
  };
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

  return words.join(" ").trim();
}

export function buildEntityDrafts(input: {
  title?: string;
  body?: string;
  source?: string;
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

  if (input.inferredKind === "expense") {
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

    const merchantMatch = text.match(/\b([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9&.\- ]{2,})\b/);
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
    const text = `${input.title ?? ""} ${input.body ?? ""}`;
    const recipientMatch = text.match(/\bto:\s*([^\s,;]+)|para:\s*([^\s,;]+)/i);
    if (recipientMatch?.[1] || recipientMatch?.[2]) {
      const value = recipientMatch[1] ?? recipientMatch[2];
      drafts.push({
        type: "recipient",
        value,
        normalizedValue: normalizeEntityValue(value),
        metadata: buildDraftMetadata("heuristic", {
          signal: "recipient_hint",
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
