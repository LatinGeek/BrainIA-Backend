export type EntityDraft = {
  type: string;
  value: string;
  normalizedValue: string;
  metadata?: Record<string, unknown>;
};

export function normalizeEntityValue(value: string) {
  return value.trim().toLowerCase();
}

export function buildEntityDrafts(input: {
  title?: string;
  body?: string;
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
      metadata: {
        source: "classifier",
      },
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
        metadata: {
          source: "heuristic",
        },
      });
    }
    const merchantMatch = text.match(/\b([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ0-9&.\- ]{2,})\b/);
    if (merchantMatch?.[1]) {
      drafts.push({
        type: "merchant",
        value: merchantMatch[1].trim(),
        normalizedValue: normalizeEntityValue(merchantMatch[1]),
        metadata: {
          source: "heuristic",
        },
      });
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
        metadata: {
          source: "heuristic",
        },
      });
    }
    drafts.push({
      type: "message",
      value: input.title ?? input.body ?? "email message",
      normalizedValue: normalizeEntityValue(input.title ?? input.body ?? "email message"),
      metadata: {
        source: "heuristic",
      },
    });
  }

  if (input.inferredKind === "notification") {
    drafts.push({
      type: "notification",
      value: input.title ?? input.body ?? "notification",
      normalizedValue: normalizeEntityValue(input.title ?? input.body ?? "notification"),
      metadata: {
        source: "heuristic",
      },
    });
  }

  return drafts;
}
