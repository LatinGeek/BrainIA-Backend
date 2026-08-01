import type { EventInput } from "./event.js";
import { normalizeEntityValue, type EntityDraft } from "./entities.js";

export type FinancialTransactionCandidate = {
  kind: "expense" | "income" | "transfer";
  amount: number;
  amountText: string;
  currency: string;
  merchantLabel: string;
  normalizedMerchant: string;
  merchantEntityId: string | null;
  observedAt: string;
  source: string;
  eventId: string;
  confidence: number;
  matchStrategy: string;
  accountId: string | null;
  accountName: string | null;
  category: string | null;
};

type EntityLike = Pick<EntityDraft, "type" | "value" | "normalizedValue"> & {
  id?: string;
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  "\u20ac": "EUR",
  "\u00a3": "GBP",
};

// A bare "$" is ambiguous. For this Uruguay-focused capture flow it denotes
// pesos unless the source explicitly provides a currency code or hint. Never
// silently turn a local debit notification into USD just because it uses "$".
const DEFAULT_LOCAL_CURRENCY = "UYU";

const CURRENCY_CODES = new Set([
  "ARS",
  "BRL",
  "CLP",
  "COP",
  "EUR",
  "GBP",
  "MXN",
  "PEN",
  "USD",
  "UYU",
]);

function readRawString(raw: Record<string, unknown> | undefined, keys: string[]) {
  if (!raw) return null;

  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function toIsoTimestamp(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  return null;
}

function collapseText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMerchantLabel(value: string) {
  return normalizeEntityValue(
    collapseText(
      value
        .replace(/[^\p{L}\p{N}\s&./-]+/gu, " ")
        .replace(/\b(compra|purchase|payment|pago|gasto|wallet|notification|notificacion|notificación)\b/giu, " "),
    ),
  );
}

function parseCurrencyHint(value: string | null | undefined) {
  if (!value) return null;

  const normalized = value.trim().toUpperCase();
  if (CURRENCY_CODES.has(normalized)) {
    return normalized;
  }

  const symbol = normalized[0];
  if (symbol && symbol in CURRENCY_SYMBOLS) {
    return CURRENCY_SYMBOLS[symbol];
  }

  return null;
}

function parseAmountText(
  value: string,
  currencyHint?: string | null,
  options: { allowBareNumber?: boolean } = {},
) {
  const trimmed = collapseText(value);
  if (!trimmed) return null;

  const symbolMatch = trimmed.match(/^([$€£])\s*(-?\d+(?:[.,]\d{1,2})?)$/u);
  if (symbolMatch) {
    const amount = Number(symbolMatch[2].replace(",", "."));
    if (!Number.isFinite(amount)) return null;
    return {
      amount,
      amountText: trimmed,
      currency: currencyHint ?? CURRENCY_SYMBOLS[symbolMatch[1]] ?? DEFAULT_LOCAL_CURRENCY,
    };
  }

  const suffixMatch = trimmed.match(/^(-?\d+(?:[.,]\d{1,2})?)\s*(ars|brl|clp|cop|eur|gbp|mxn|pen|usd|uyu)$/iu);
  if (suffixMatch) {
    const amount = Number(suffixMatch[1].replace(",", "."));
    if (!Number.isFinite(amount)) return null;
    return {
      amount,
      amountText: trimmed,
      currency: suffixMatch[2].toUpperCase(),
    };
  }

  const prefixMatch = trimmed.match(/^(ars|brl|clp|cop|eur|gbp|mxn|pen|usd|uyu)\s*(-?\d+(?:[.,]\d{1,2})?)$/iu);
  if (prefixMatch) {
    const amount = Number(prefixMatch[2].replace(",", "."));
    if (!Number.isFinite(amount)) return null;
    return {
      amount,
      amountText: trimmed,
      currency: prefixMatch[1].toUpperCase(),
    };
  }

  if (!options.allowBareNumber) {
    return null;
  }

  const plainAmountMatch = trimmed.match(/^-?\d+(?:[.,]\d{1,2})?$/);
  if (!plainAmountMatch) return null;

  const amount = Number(plainAmountMatch[0].replace(",", "."));
  if (!Number.isFinite(amount)) return null;

  return {
    amount,
    amountText: plainAmountMatch[0],
    currency: currencyHint ?? DEFAULT_LOCAL_CURRENCY,
  };
}

function pickEntity(entities: EntityLike[], type: string) {
  return entities.find((entity) => entity.type === type) ?? null;
}

function pickMerchantLabel(input: {
  event: Pick<EventInput, "kind" | "title" | "body" | "source" | "raw">;
  merchantEntity: EntityLike | null;
}) {
  const raw = input.event.raw ?? {};
  const titleMerchant = input.event.kind === "notification"
    ? input.event.title?.trim().match(/^(?:pagaste\s+a|pago\s+a|compra\s+en)\s+(.+)$/iu)?.[1]?.trim()
    : null;
  const candidate = (
    readRawString(raw, [
      "merchant",
      "merchantName",
      "merchant_label",
      "payee",
      "business",
      "businessName",
      "counterparty",
      "store",
      "company",
      "legalName",
    ]) ||
    titleMerchant ||
    input.merchantEntity?.value?.trim() ||
    null
  );
  if (!candidate) return null;
  const collapsed = collapseText(candidate);
  if (/^(?:aviso|alerta|notification|notificaci(?:o|ó)n|movimiento|transaction|transacci(?:o|ó)n)$/iu.test(collapsed)) return null;
  return collapsed;
}

function findRawAmountText(raw: Record<string, unknown> | undefined) {
  if (!raw) return null;

  return readRawString(raw, ["amount", "total", "value", "transactionAmount", "moneyAmount"]);
}

export function buildFinancialTransactionCandidate(input: {
  event: Pick<EventInput, "id" | "kind" | "source" | "title" | "body" | "timestamp" | "raw">;
  classified: {
    inferredKind: string;
    confidence: number;
  };
  entityDrafts: EntityDraft[];
  merchantEntity?: EntityLike | null;
  amountEntity?: EntityLike | null;
  observedAt?: string | null;
}): FinancialTransactionCandidate | null {
  if (!(["expense", "income", "transfer"] as const).includes(input.classified.inferredKind as "expense" | "income" | "transfer")) {
    return null;
  }

  const amountDraft = input.amountEntity ?? pickEntity(input.entityDrafts, "amount");
  const merchantDraft = input.merchantEntity ?? pickEntity(input.entityDrafts, "merchant");
  const raw = input.event.raw ?? {};
  const currencyHint = parseCurrencyHint(readRawString(raw, ["currency", "moneyCurrency", "ccy"]));
  const amountSource = amountDraft?.value?.trim() || findRawAmountText(raw);
  const amountText = amountSource || collapseText(`${input.event.title ?? ""} ${input.event.body ?? ""}`);

  const parsedAmount = parseAmountText(amountText, currencyHint, {
    allowBareNumber: Boolean(amountSource),
  });
  if (!parsedAmount) {
    return null;
  }

  if (!amountSource && parsedAmount.currency === "UNKNOWN") {
    return null;
  }

  const merchantLabel = input.classified.inferredKind === "transfer"
    ? "Transfer between accounts"
    : pickMerchantLabel({ event: input.event, merchantEntity: merchantDraft });
  if (!merchantLabel) {
    return null;
  }
  const normalizedMerchant = normalizeMerchantLabel(merchantLabel);

  if (!normalizedMerchant) {
    return null;
  }

  const observedAt =
    toIsoTimestamp(input.observedAt) ||
    toIsoTimestamp(input.event.timestamp) ||
    new Date().toISOString();

  return {
    kind: input.classified.inferredKind as FinancialTransactionCandidate["kind"],
    amount: Number(parsedAmount.amount.toFixed(2)),
    amountText: parsedAmount.amountText,
    currency: parsedAmount.currency,
    merchantLabel: collapseText(merchantLabel),
    normalizedMerchant,
    merchantEntityId: merchantDraft?.id ?? null,
    observedAt,
    source: input.event.source.trim(),
    eventId: input.event.id,
    confidence: input.classified.confidence,
    matchStrategy: merchantDraft?.id ? "merchant_entity_match" : "merchant_text_match",
    accountId: readRawString(raw, ["accountId", "account_id"]) ?? null,
    accountName: readRawString(raw, ["accountName", "account_name", "accountLabel"]) ?? null,
    category: readRawString(raw, ["category", "categoryName", "category_name"]) ?? null,
  };
}

export function candidateWindowBounds(observedAt: string, windowHours = 6) {
  const date = new Date(observedAt);
  const windowMs = windowHours * 60 * 60 * 1000;
  return {
    start: new Date(date.getTime() - windowMs).toISOString(),
    end: new Date(date.getTime() + windowMs).toISOString(),
  };
}
