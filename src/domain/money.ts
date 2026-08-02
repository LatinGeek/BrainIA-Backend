export const CURRENCY_CODE_SOURCE = "(?:ars|brl|clp|cop|eur|gbp|mxn|pen|usd|uyu)";

// Accept simple decimals plus Spanish and English thousands/decimal layouts:
// 1733,00 · 1.733,00 · 1733.00 · 1,733.00.
export const MONEY_NUMBER_SOURCE = String.raw`(?:\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;

const MONEY_TEXT_PATTERN = new RegExp(
  String.raw`(?:${CURRENCY_CODE_SOURCE}\s*${MONEY_NUMBER_SOURCE}|[$€£]\s*${MONEY_NUMBER_SOURCE}|${MONEY_NUMBER_SOURCE}\s*${CURRENCY_CODE_SOURCE})`,
  "iu",
);

export function findMoneyText(value: string) {
  return value.match(MONEY_TEXT_PATTERN)?.[0] ?? null;
}

export function parseLocalizedMoneyNumber(value: string) {
  const compact = value.replace(/\s+/g, "");
  const lastDot = compact.lastIndexOf(".");
  const lastComma = compact.lastIndexOf(",");

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSeparator = lastDot > lastComma ? "." : ",";
    const thousandsSeparator = decimalSeparator === "." ? "," : ".";
    return Number(compact.replaceAll(thousandsSeparator, "").replace(decimalSeparator, "."));
  }

  const separator = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
  if (!separator) return Number(compact);
  const fractionLength = compact.length - compact.lastIndexOf(separator) - 1;
  return fractionLength === 3
    ? Number(compact.replaceAll(separator, ""))
    : Number(compact.replace(separator, "."));
}
