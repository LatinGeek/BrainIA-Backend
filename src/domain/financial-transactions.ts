import type { EventInput } from "./event.js";
import { normalizeEntityValue, type EntityDraft } from "./entities.js";
import { FINANCIAL_CATEGORIES } from "./financial-categories.js";
import {
  CONFIRMED_CURRENCY_STATUSES,
  KNOWN_CURRENCY_CODES,
  MONEY_NUMBER_SOURCE,
  type AmountRole,
  type CurrencyStatus,
  absDecimal,
  decimalPlaces,
  decimalToLegacyNumber,
  isDecimalString,
  currencyExponent,
  isSupportedCurrency,
  normalizeDecimal,
  parseLocalizedMoneyDecimal,
  quantizeDecimal,
} from "./money.js";

export type FinancialTransactionCandidate = {
  kind: "expense" | "income" | "transfer";
  /** Legacy numeric projection for older callers. Never used for storage. */
  amount: number;
  /** Exact decimal amount used for storage, matching and reports. */
  amountDecimal: string;
  amountRole: AmountRole;
  amountText: string;
  /** Raw source decimal string, preserved even when display precision differs. */
  rawAmountText: string;
  currency: string;
  currencyStatus: CurrencyStatus;
  currencyProvenance: string;
  amountConfirmed: boolean;
  convertedAmount: string | null;
  convertedCurrency: string | null;
  fxRateId: string | null;
  nativeReference: string | null;
  referenceNamespace: string | null;
  reviewReasons: string[];
  merchantLabel: string;
  normalizedMerchant: string;
  merchantEntityId: string | null;
  observedAt: string;
  source: string;
  eventId: string;
  confidence: number;
  matchStrategy: string;
  accountId: string | null;
  destinationAccountId: string | null;
  /** Legacy numeric destination projection. */
  destinationAmount: number | null;
  destinationAmountDecimal: string | null;
  destinationCurrency: string | null;
  destinationCurrencyStatus: CurrencyStatus | null;
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

type CurrencyHint = {
  currency: string;
  status: CurrencyStatus;
  provenance: string;
};

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

function paymentRecipientFromBody(body: string | undefined) {
  if (!body) return null;
  // Choose the final "a/para Name" phrase: it is normally the transfer
  // recipient, while the heading may itself contain generic transport words.
  const matches = Array.from(body.matchAll(/\b(?:a|para)\s+((?!la\s+cuenta\b|cuenta\b)[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,4})/giu));
  const recipient = matches.at(-1)?.[1]?.trim().replace(/[.,;:]+$/u, "");
  if (!recipient || /^(?:la\s+cuenta|cuenta|transferencia|realizada|enviada)$/iu.test(recipient)) return null;
  return recipient;
}

/**
 * Resolve a caller-provided currency hint. A bare "$" is deliberately not a
 * currency: only an explicit ISO code/symbol, a verified account, or an
 * explicit user confirmation can confirm a currency.
 */
function parseCurrencyHint(value: string | null | undefined): CurrencyHint | null {
  if (!value) return null;

  const normalized = value.trim().toUpperCase();
  if (normalized === "U$S" || normalized === "US$" || normalized === "USD$") {
    return { currency: "USD", status: "explicit", provenance: "explicit_usd_notation" };
  }
  if (KNOWN_CURRENCY_CODES.has(normalized)) {
    return isSupportedCurrency(normalized)
      ? { currency: normalized, status: "explicit", provenance: "explicit_currency_code" }
      : { currency: normalized, status: "unsupported", provenance: "unsupported_currency_code" };
  }

  const symbol = normalized[0];
  if (symbol && symbol in CURRENCY_SYMBOLS) {
    return { currency: CURRENCY_SYMBOLS[symbol], status: "explicit", provenance: "explicit_currency_symbol" };
  }
  if (symbol === "$") {
    // A bare dollar is not a currency. It stays ambiguous/UNKNOWN and is never
    // displayed or totalled as the local currency.
    return { currency: "UNKNOWN", status: "ambiguous", provenance: "ambiguous_dollar_symbol" };
  }

  return null;
}

const AMOUNT_ROLE_ALIASES: Record<string, AmountRole> = {
  purchase: "purchase",
  posted: "posted",
  settled: "posted",
  authorization: "authorized",
  authorized: "authorized",
  balance: "balance",
  available_credit: "available_credit",
  availablecredit: "available_credit",
  tax: "tax",
  fee: "fee",
  installment: "installment",
  refund: "refund",
  transfer_debit: "transfer_debit",
  transferdebit: "transfer_debit",
  debit: "transfer_debit",
  transfer_credit: "transfer_credit",
  transfercredit: "transfer_credit",
  credit: "transfer_credit",
  converted: "converted",
  destination: "destination",
};

function parseAmountRole(raw: Record<string, unknown> | undefined): { role: AmountRole; unknown: boolean } {
  const explicit = readRawString(raw, ["amountRole", "amount_role", "amountType", "amount_type"]);
  if (explicit) {
    const normalized = explicit.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const role = AMOUNT_ROLE_ALIASES[normalized];
    if (role) return { role, unknown: false };
    // An unrecognised role is evidence, not a licence to assume `posted`.
    return { role: "posted", unknown: true };
  }
  const status = readRawString(raw, ["status", "lifecycle", "stage"])?.toLowerCase() ?? "";
  if (/authoriz|preauth/.test(status)) return { role: "authorized", unknown: false };
  if (/balance/.test(status)) return { role: "balance", unknown: false };
  return { role: "posted", unknown: false };
}

function parseAmountText(
  value: string,
  currencyHint: CurrencyHint | null,
  options: { allowBareNumber?: boolean } = {},
) {
  // Prex uses the local `U$S` notation. Normalize it before matching the
  // canonical ISO-code forms below so dollar payments materialize normally.
  const trimmed = collapseText(value).replace(/^u\$s\s*/iu, "USD ");
  if (!trimmed) return null;

  const reviewReasons: string[] = [];

  const symbolMatch = trimmed.match(new RegExp(String.raw`^([$€£])\s*(-?${MONEY_NUMBER_SOURCE})$`, "u"));
  if (symbolMatch) {
    const decimal = parseLocalizedMoneyDecimal(symbolMatch[2]);
    if (decimal === null) return null;
    const symbol = symbolMatch[1];
    const resolved = symbol === "$"
      ? (currencyHint ?? { currency: "UNKNOWN", status: "ambiguous" as const, provenance: "ambiguous_dollar_symbol" })
      : { currency: CURRENCY_SYMBOLS[symbol], status: "explicit" as const, provenance: "explicit_currency_symbol" };
    return finalizeParsedAmount(decimal, trimmed, resolved, reviewReasons);
  }

  const suffixMatch = trimmed.match(new RegExp(String.raw`^(-?${MONEY_NUMBER_SOURCE})\s*([a-z]{3}|u\$s)$`, "iu"));
  if (suffixMatch) {
    const decimal = parseLocalizedMoneyDecimal(suffixMatch[1]);
    if (decimal === null) return null;
    const code = suffixMatch[2].toUpperCase();
    const resolved = code === "U$S"
      ? { currency: "USD", status: "explicit" as const, provenance: "explicit_usd_notation" }
      : parseCurrencyHint(code);
    if (!resolved) return null;
    return finalizeParsedAmount(decimal, trimmed, resolved, reviewReasons);
  }

  const prefixMatch = trimmed.match(new RegExp(String.raw`^([a-z]{3}|u\$s)\s*(-?${MONEY_NUMBER_SOURCE})$`, "iu"));
  if (prefixMatch) {
    const decimal = parseLocalizedMoneyDecimal(prefixMatch[2]);
    if (decimal === null) return null;
    const code = prefixMatch[1].toUpperCase();
    const resolved = code === "U$S"
      ? { currency: "USD", status: "explicit" as const, provenance: "explicit_usd_notation" }
      : parseCurrencyHint(code);
    if (!resolved) return null;
    return finalizeParsedAmount(decimal, trimmed, resolved, reviewReasons);
  }

  if (!options.allowBareNumber) {
    return null;
  }

  const plainAmountMatch = trimmed.match(new RegExp(String.raw`^-?${MONEY_NUMBER_SOURCE}$`));
  if (!plainAmountMatch) return null;

  const decimal = parseLocalizedMoneyDecimal(plainAmountMatch[0]);
  if (decimal === null) return null;

  const resolved = currencyHint ?? { currency: "UNKNOWN", status: "ambiguous" as const, provenance: "bare_number_without_currency" };
  return finalizeParsedAmount(decimal, plainAmountMatch[0], resolved, reviewReasons);
}

function finalizeParsedAmount(
  decimal: string,
  amountText: string,
  resolved: CurrencyHint,
  reviewReasons: string[],
) {
  const supportedExponent = currencyExponent(resolved.currency);
  const precisionExcess = decimalPlaces(decimal) > supportedExponent;
  if (precisionExcess) reviewReasons.push("amount_precision_excess");

  return {
    decimal,
    amountDecimal: precisionExcess ? quantizeDecimal(decimal, supportedExponent) : normalizeDecimal(decimal) ?? decimal,
    amountText,
    currency: resolved.currency,
    currencyStatus: resolved.status,
    currencyProvenance: resolved.provenance,
    amountConfirmed: !precisionExcess,
    reviewReasons,
  };
}

function parseExplicitDecimal(value: string | null | undefined) {
  if (!value) return null;
  const direct = normalizeDecimal(value);
  if (direct !== null) return direct;
  return parseLocalizedMoneyDecimal(value);
}

function pickEntity(entities: EntityLike[], type: string) {
  return entities.find((entity) => entity.type === type) ?? null;
}

function pickMerchantLabel(input: {
  event: Pick<EventInput, "kind" | "title" | "body" | "source" | "raw">;
  merchantEntity: EntityLike | null;
}) {
  const raw = input.event.raw ?? {};
  const recipient = paymentRecipientFromBody(input.event.body);
  const genericTransferTitle = /^(?:transferencia|pago)\s+(?:realizada|enviado|enviada|efectuado|efectuada|confirmado|confirmada)\.?$/iu.test(input.event.title?.trim() ?? "");
  if (recipient && genericTransferTitle) return `Pago a ${recipient}`;
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
  if (/^(?:aviso|alerta|notification|notificaci(?:o|ó)n|movimiento|transaction|transacci(?:o|ó)n|transferencia\s+realizada|pago\s+realizado|realizada|realizado)$/iu.test(collapsed)) return null;
  return collapsed;
}

function findRawAmountText(raw: Record<string, unknown> | undefined) {
  if (!raw) return null;

  return readRawString(raw, ["amount", "total", "value", "transactionAmount", "moneyAmount"]);
}

function parseNativeReference(raw: Record<string, unknown> | undefined, source: string, accountId: string | null) {
  const nativeReference = readRawString(raw, [
    "nativeReference",
    "native_reference",
    "providerReference",
    "provider_reference",
    "transactionReference",
    "transaction_reference",
    "reference",
  ]);
  if (!nativeReference) return { nativeReference: null, referenceNamespace: null };
  const namespace = readRawString(raw, ["referenceNamespace", "reference_namespace", "provider"]) ??
    accountId ??
    source.trim().toLowerCase();
  return {
    nativeReference: collapseText(nativeReference).slice(0, 200),
    referenceNamespace: collapseText(namespace).toLowerCase().slice(0, 120),
  };
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

  // A bare number from free text without any currency evidence is retained as
  // ambiguous evidence, never promoted to the local currency. Only server-
  // verified currency evidence (explicit ISO/symbol or an owned account, later)
  // can confirm it; caller-supplied `currencyConfirmed` booleans are ignored.
  const reviewReasons = [...parsedAmount.reviewReasons];
  const currencyStatus: CurrencyStatus = parsedAmount.currencyStatus;
  if (currencyStatus === "unsupported") reviewReasons.push("unsupported_currency");
  if (currencyStatus === "ambiguous") reviewReasons.push("ambiguous_currency");

  const category = readRawString(raw, ["category", "categoryName", "category_name"]);
  // Categories chosen in Capture carry an explicit money direction. Respect that
  // direction when it conflicts with a stale/default transaction toggle.
  const kind = category && FINANCIAL_CATEGORIES.income.includes(category as never)
    ? "income"
    : input.classified.inferredKind as FinancialTransactionCandidate["kind"];
  const merchantLabel = kind === "transfer"
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

  const accountId = readRawString(raw, ["accountId", "account_id"]) ?? null;
  const accountName = readRawString(raw, ["accountName", "account_name", "accountLabel"]) ?? null;
  const destinationAccountId = readRawString(raw, ["destinationAccountId", "destination_account_id"]) ?? null;
  const parsedAmountRole = parseAmountRole(raw);
  const amountRole = parsedAmountRole.role;
  if (parsedAmountRole.unknown) reviewReasons.push("unknown_amount_role");

  // Contract v2 amounts are nonnegative magnitudes; kind carries the direction.
  // A captured debit written as "-100,00" is normalized by its kind instead of
  // producing a negative expense (and an inverted net) in reports.
  let amountDecimal = parsedAmount.amountDecimal;
  if (amountDecimal.startsWith("-") && amountDecimal !== "-0") {
    amountDecimal = absDecimal(amountDecimal);
    reviewReasons.push("negative_amount_normalized_by_kind");
  }

  const convertedAmountText = readRawString(raw, ["convertedAmount", "converted_amount"]);
  const convertedAmount = parseExplicitDecimal(convertedAmountText);
  const convertedCurrencyHint = parseCurrencyHint(readRawString(raw, ["convertedCurrency", "converted_currency"]));
  const fxRateId = readRawString(raw, ["fxRateId", "fx_rate_id"]);
  if (convertedAmountText && !convertedAmount) reviewReasons.push("conversion_amount_invalid");
  if (convertedAmount && (!convertedCurrencyHint || convertedCurrencyHint.status === "ambiguous")) {
    reviewReasons.push("conversion_currency_unconfirmed");
  }
  if (convertedAmount && !fxRateId) reviewReasons.push("conversion_without_approved_rate");

  const destinationAmountText = readRawString(raw, ["destinationAmount", "destination_amount"]);
  const destinationAmountDecimal = parseExplicitDecimal(destinationAmountText);
  const destinationCurrencyHint = parseCurrencyHint(readRawString(raw, ["destinationCurrency", "destination_currency"]));
  if (destinationAmountText && !destinationAmountDecimal) reviewReasons.push("destination_amount_invalid");
  if (destinationAmountDecimal && !destinationCurrencyHint) reviewReasons.push("destination_currency_unconfirmed");
  if (destinationCurrencyHint?.status === "unsupported") reviewReasons.push("destination_currency_unsupported");

  const { nativeReference, referenceNamespace } = parseNativeReference(raw, input.event.source, accountId);

  return {
    kind,
    amount: decimalToLegacyNumber(amountDecimal),
    amountDecimal,
    amountRole,
    amountText: parsedAmount.amountText,
    rawAmountText: parsedAmount.amountText,
    currency: parsedAmount.currency,
    currencyStatus,
    currencyProvenance: parsedAmount.currencyProvenance,
    // An unrecognised amount role is stored for review but cannot be treated as
    // a confirmed posted movement: it may describe a balance, fee or
    // authorization rather than spendable money.
    amountConfirmed:
      parsedAmount.amountConfirmed &&
      !reviewReasons.includes("amount_precision_excess") &&
      !parsedAmountRole.unknown,
    convertedAmount,
    convertedCurrency: convertedAmount && convertedCurrencyHint && CONFIRMED_CURRENCY_STATUSES.has(convertedCurrencyHint.status)
      ? convertedCurrencyHint.currency
      : null,
    fxRateId: convertedAmount ? fxRateId : null,
    nativeReference,
    referenceNamespace,
    reviewReasons: [...new Set(reviewReasons)],
    merchantLabel: collapseText(merchantLabel),
    normalizedMerchant,
    merchantEntityId: merchantDraft?.id ?? null,
    observedAt,
    source: input.event.source.trim(),
    eventId: input.event.id,
    confidence: input.classified.confidence,
    matchStrategy: merchantDraft?.id ? "merchant_entity_match" : "merchant_text_match",
    accountId,
    destinationAccountId,
    destinationAmount: destinationAmountDecimal === null ? null : decimalToLegacyNumber(destinationAmountDecimal),
    destinationAmountDecimal,
    destinationCurrency: destinationCurrencyHint?.currency ?? null,
    destinationCurrencyStatus: destinationCurrencyHint?.status ?? null,
    accountName,
    category,
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

/** True only when the observation carries strong identity/amount evidence. */
export function canAutoLinkFinancialCandidate(candidate: FinancialTransactionCandidate) {
  const confirmedCurrency = CONFIRMED_CURRENCY_STATUSES.has(candidate.currencyStatus);
  return confirmedCurrency && candidate.amountConfirmed && isDecimalString(candidate.amountDecimal);
}
