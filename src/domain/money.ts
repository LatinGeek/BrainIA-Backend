// Exact money helpers. Amounts are handled as decimal strings and BigInt
// arithmetic; no monetary value or FX rate may pass through IEEE-754
// arithmetic. `Number` is only retained for the legacy candidate field used by
// older callers and is never used for storage, matching or totals.

export const SUPPORTED_CURRENCIES = {
  ARS: 2,
  BRL: 2,
  CLP: 0,
  COP: 2,
  EUR: 2,
  GBP: 2,
  MXN: 2,
  PEN: 2,
  USD: 2,
  UYU: 2,
} as const;

// Known ISO codes are recognised so an unsupported currency can be recorded as
// explicit-but-unsupported evidence instead of being silently treated as the
// local currency. The list intentionally excludes common 3-letter words.
export const KNOWN_CURRENCY_CODES = new Set([
  "AED", "ARS", "AUD", "BOB", "BRL", "CAD", "CHF", "CLP", "CNY", "COP",
  "CRC", "CZK", "DKK", "DOP", "EGP", "EUR", "GBP", "GTQ", "HKD", "HNL",
  "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NIO",
  "NOK", "NZD", "PAB", "PEN", "PHP", "PLN", "PYG", "RON", "RSD", "RUB",
  "SAR", "SEK", "SGD", "THB", "TRY", "TWD", "UAH", "USD", "UYU", "VES",
  "ZAR",
]);

export const CURRENCY_CODE_SOURCE = `(?:${[...KNOWN_CURRENCY_CODES]
  .map((code) => code.toLowerCase())
  .join("|")}|u\\$s)`;

// Accept simple decimals plus Spanish and English thousands/decimal layouts:
// 1733,00 · 1.733,00 · 1733.00 · 1,733.00. Up to six fractional digits are
// retained so no source precision is discarded while parsing.
export const MONEY_NUMBER_SOURCE = String.raw`(?:\d{1,3}(?:\.\d{3})+(?:,\d{1,6})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,6})?|\d+(?:[.,]\d{1,6})?)`;

const MONEY_TEXT_PATTERN = new RegExp(
  String.raw`(?:${CURRENCY_CODE_SOURCE}\s*${MONEY_NUMBER_SOURCE}|[$€£]\s*${MONEY_NUMBER_SOURCE}|${MONEY_NUMBER_SOURCE}\s*${CURRENCY_CODE_SOURCE})`,
  "iu",
);

export type CurrencyStatus = "explicit" | "account_confirmed" | "user_confirmed" | "ambiguous" | "unsupported";

export type AmountRole =
  | "purchase"
  | "posted"
  | "authorized"
  | "balance"
  | "available_credit"
  | "tax"
  | "fee"
  | "installment"
  | "refund"
  | "transfer_debit"
  | "transfer_credit"
  | "converted"
  | "destination";

export const AMOUNT_ROLES: ReadonlySet<AmountRole> = new Set([
  "purchase", "posted", "authorized", "balance", "available_credit", "tax",
  "fee", "installment", "refund", "transfer_debit", "transfer_credit",
  "converted", "destination",
]);

export const CONFIRMED_CURRENCY_STATUSES: ReadonlySet<CurrencyStatus> = new Set([
  "explicit", "account_confirmed", "user_confirmed",
]);

export function isSupportedCurrency(currency: string | null | undefined): boolean {
  return Boolean(currency && Object.hasOwn(SUPPORTED_CURRENCIES, currency.trim().toUpperCase()));
}

export function currencyExponent(currency: string | null | undefined): number {
  const code = currency?.trim().toUpperCase() ?? "";
  return isSupportedCurrency(code) ? SUPPORTED_CURRENCIES[code as keyof typeof SUPPORTED_CURRENCIES] : 2;
}

export function isConfirmedCurrencyStatus(status: string | null | undefined): boolean {
  return Boolean(status && CONFIRMED_CURRENCY_STATUSES.has(status as CurrencyStatus));
}

type DecimalParts = { negative: boolean; integer: string; fraction: string };

function parseDecimalParts(value: string): DecimalParts | null {
  const match = value.trim().match(/^([+-]?)(\d*)(?:\.(\d*))?$/);
  if (!match) return null;
  const integerRaw = match[2] ?? "";
  const fractionRaw = match[3] ?? "";
  if (!integerRaw && !fractionRaw) return null;
  const integer = integerRaw.replace(/^0+(?=\d)/, "") || "0";
  return {
    negative: match[1] === "-" && (integerRaw.replace(/0/g, "") !== "" || fractionRaw.replace(/0/g, "") !== ""),
    integer,
    fraction: fractionRaw,
  };
}

function formatDecimalParts(parts: DecimalParts, fractionDigits?: number) {
  const fraction = fractionDigits === undefined
    ? parts.fraction
    : parts.fraction.padEnd(fractionDigits, "0").slice(0, fractionDigits);
  const sign = parts.negative && (parts.integer !== "0" || /[1-9]/.test(fraction)) ? "-" : "";
  return fraction ? `${sign}${parts.integer}.${fraction}` : `${sign}${parts.integer}`;
}

function align(left: DecimalParts, right: DecimalParts) {
  const scale = Math.max(left.fraction.length, right.fraction.length);
  return {
    scale,
    left: BigInt(`${left.integer}${left.fraction.padEnd(scale, "0")}`) * (left.negative ? -1n : 1n),
    right: BigInt(`${right.integer}${right.fraction.padEnd(scale, "0")}`) * (right.negative ? -1n : 1n),
  };
}

function partsFromScaled(value: bigint, scale: number): DecimalParts {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const integer = digits.slice(0, digits.length - scale) || "0";
  const fraction = scale ? digits.slice(digits.length - scale) : "";
  return { negative, integer, fraction };
}

/** Canonical decimal string: no leading zeros, no insignificant negative zero. */
export function normalizeDecimal(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parts = parseDecimalParts(String(value));
  return parts ? formatDecimalParts(parts) : null;
}

/** Canonical decimal string with an optional fixed scale (truncating only). */
export function decimalWithScale(value: string, scale: number): string | null {
  const parts = parseDecimalParts(value);
  return parts ? formatDecimalParts(parts, scale) : null;
}

export function decimalPlaces(value: string): number {
  return parseDecimalParts(value)?.fraction.length ?? 0;
}

export function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && parseDecimalParts(value) !== null;
}

export function compareDecimal(left: string, right: string): -1 | 0 | 1 {
  const a = parseDecimalParts(left);
  const b = parseDecimalParts(right);
  if (!a || !b) throw new Error("Invalid decimal value");
  const aligned = align(a, b);
  return aligned.left === aligned.right ? 0 : aligned.left < aligned.right ? -1 : 1;
}

export function addDecimal(left: string, right: string): string {
  const a = parseDecimalParts(left);
  const b = parseDecimalParts(right);
  if (!a || !b) throw new Error("Invalid decimal value");
  const aligned = align(a, b);
  return formatDecimalParts(partsFromScaled(aligned.left + aligned.right, aligned.scale));
}

export function subtractDecimal(left: string, right: string): string {
  const a = parseDecimalParts(left);
  const b = parseDecimalParts(right);
  if (!a || !b) throw new Error("Invalid decimal value");
  const aligned = align(a, b);
  return formatDecimalParts(partsFromScaled(aligned.left - aligned.right, aligned.scale));
}

export function negateDecimal(value: string): string {
  const parts = parseDecimalParts(value);
  if (!parts) throw new Error("Invalid decimal value");
  return formatDecimalParts({ ...parts, negative: !parts.negative });
}

export function multiplyDecimal(left: string, right: string): string {
  const a = parseDecimalParts(left);
  const b = parseDecimalParts(right);
  if (!a || !b) throw new Error("Invalid decimal value");
  const scale = a.fraction.length + b.fraction.length;
  const product = BigInt(a.integer + a.fraction) * BigInt(b.integer + b.fraction);
  return formatDecimalParts(partsFromScaled(a.negative !== b.negative ? -product : product, scale));
}

export function absDecimal(value: string): string {
  const parts = parseDecimalParts(value);
  if (!parts) throw new Error("Invalid decimal value");
  return formatDecimalParts({ ...parts, negative: false });
}

/**
 * Round to a fixed scale using half-up (away from zero) at the requested
 * boundary. Used only for presentation/currency-exponent normalisation; the
 * raw source string remains stored separately.
 */
export function quantizeDecimal(value: string, scale = 2): string {
  const parts = parseDecimalParts(value);
  if (!parts) throw new Error("Invalid decimal value");
  if (parts.fraction.length <= scale) return formatDecimalParts(parts, scale);
  const kept = parts.fraction.slice(0, scale);
  const next = Number(parts.fraction[scale] ?? "0");
  const base = BigInt(`${parts.integer}${kept.padEnd(scale, "0")}`) * (parts.negative ? -1n : 1n);
  const rounded = next >= 5 ? base + (parts.negative ? -1n : 1n) : base;
  return formatDecimalParts(partsFromScaled(rounded, scale));
}

export function sumDecimals(values: readonly string[], initial = "0"): string {
  return values.reduce((total, value) => addDecimal(total, value), initial);
}

/** Legacy-only conversion for older callers; never use for storage or totals. */
export function decimalToLegacyNumber(value: string): number {
  return Number(value);
}

export function findMoneyText(value: string) {
  return value.match(MONEY_TEXT_PATTERN)?.[0] ?? null;
}

function isGroupedPositiveInteger(value: string, separator: string) {
  const groups = value.split(separator);
  if (groups.length < 2) return false;
  return /^\d{1,3}$/.test(groups[0] ?? "") && groups.slice(1).every((group) => /^\d{3}$/.test(group));
}

/**
 * Parse a localized money number into an exact decimal string. Returns null for
 * malformed input and for layouts whose separator meaning is genuinely
 * ambiguous. In particular a single separator followed by exactly three digits
 * (`1.733`, `100.000`) is rejected instead of being silently rescaled: it may
 * be either a thousands group or a three-decimal fraction. Grouping is accepted
 * only when every group is explicit (`1.733.000`, `1,733,000`).
 */
export function parseLocalizedMoneyDecimal(value: string): string | null {
  const compact = value.replace(/\s+/g, "").replace(/^\+/, "");
  if (!compact || /[^\d.,-]/.test(compact)) return null;
  if ((compact.match(/-/g) ?? []).length > 1 || (compact.includes("-") && !compact.startsWith("-"))) return null;

  const negative = compact.startsWith("-");
  const unsigned = negative ? compact.slice(1) : compact;
  if (!unsigned) return null;

  const dots = (unsigned.match(/\./g) ?? []).length;
  const commas = (unsigned.match(/,/g) ?? []).length;

  let integerPart = unsigned;
  let fractionPart = "";

  if (dots && commas) {
    const decimalSeparator = unsigned.lastIndexOf(".") > unsigned.lastIndexOf(",") ? "." : ",";
    const thousandsSeparator = decimalSeparator === "." ? "," : ".";
    const splitAt = unsigned.lastIndexOf(decimalSeparator);
    const integerRaw = unsigned.slice(0, splitAt);
    const fractionRaw = unsigned.slice(splitAt + 1);
    if (!/^\d{1,6}$/.test(fractionRaw)) return null;
    if (!isGroupedPositiveInteger(integerRaw, thousandsSeparator)) return null;
    integerPart = integerRaw.replaceAll(thousandsSeparator, "");
    fractionPart = fractionRaw;
  } else if (dots || commas) {
    const separator = dots ? "." : ",";
    const parts = unsigned.split(separator);
    if (parts.length > 2) {
      // Multiple separators can only be thousands grouping. A malformed group
      // (`1.2.3`) is rejected rather than collapsed into `12.3`.
      if (!isGroupedPositiveInteger(unsigned, separator)) return null;
      integerPart = parts.join("");
      fractionPart = "";
    } else {
      const [integerRaw = "", fractionRaw = ""] = parts;
      if (!/^\d+$/.test(integerRaw) || !/^\d{1,6}$/.test(fractionRaw)) return null;
      // A single separator with a three-digit tail is locale-ambiguous.
      if (fractionRaw.length === 3) return null;
      integerPart = integerRaw;
      fractionPart = fractionRaw;
    }
  }

  if (integerPart === "") integerPart = "0";
  if (!/^\d+$/.test(integerPart) || !/^\d*$/.test(fractionPart)) return null;
  const decimal = normalizeDecimal(`${negative ? "-" : ""}${integerPart}${fractionPart ? `.${fractionPart}` : ""}`);
  if (!decimal) return null;
  return decimal;
}

/** @deprecated Legacy numeric projection; use parseLocalizedMoneyDecimal. */
export function parseLocalizedMoneyNumber(value: string) {
  const decimal = parseLocalizedMoneyDecimal(value);
  return decimal === null ? Number.NaN : decimalToLegacyNumber(decimal);
}
