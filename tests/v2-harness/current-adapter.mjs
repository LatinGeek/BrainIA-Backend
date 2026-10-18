// Read-only observations of current application code; never copies golden answers.
import { parseLocalizedMoneyDecimal, decimalPlaces, currencyExponent, isSupportedCurrency } from '../../src/domain/money.ts';

export const revision = 'current-checkout-heuristic-v4';

const VALUE_PATTERN = /^(?:(U\$S|US\$|USD\$|[$€£])|([A-Za-z]{3}))?\s*(-?[\d.,]+)\s*(?:(U\$S|US\$|USD\$|[$€£])|([A-Za-z]{3}))?\.?$/u;

function resolveCurrency(prefix, suffix) {
  const token = (prefix ?? suffix ?? '').trim();
  if (!token) return 'UNKNOWN';
  const upper = token.toUpperCase();
  if (upper === 'U$S' || upper === 'US$' || upper === 'USD$') return 'USD';
  if (upper === '$') return 'UNKNOWN'; // A bare dollar is not a currency (B10).
  if (upper === '€') return 'EUR';
  if (upper === '£') return 'GBP';
  if (/^[A-Z]{3}$/.test(upper)) return upper;
  return 'UNKNOWN';
}

/**
 * Role is evidence, not an assumption: only the sentence directly containing
 * the amount may describe it. An unrecognised context stays `unresolved`
 * instead of being promoted to a purchase.
 */
function resolveRole(body, start) {
  const prefix = (body ?? '').slice(0, start);
  const sentence = prefix.split(/[.;\n]/u).at(-1) ?? prefix;
  if (/\b(?:saldo|balance|disponible|available)\b/iu.test(sentence)) return 'balance';
  if (/\b(?:comisi[oó]n|commission|fee|cargo|impuesto|tax)\b/iu.test(sentence)) return 'fee';
  if (/\b(?:gastaste|gasto|compra|purchase|pagaste|pago|payment)\b/iu.test(sentence)) return 'purchase';
  return 'unresolved';
}

/**
 * Value status follows the B10 finance rules: explicit currency evidence and a
 * valid, precision-safe amount are required before an observation is confirmed.
 * Ambiguous `$`, unsupported codes, unresolved roles and precision excess stay
 * `uncertain` and are excluded from confirmed money totals.
 */
function inspectValue(text, body, start, fallbackRole) {
  const match = VALUE_PATTERN.exec(text.trim());
  const currency = match ? resolveCurrency(match[1] ?? match[2], match[4] ?? match[5]) : 'UNKNOWN';
  const rawNumber = match?.[3] ?? '';
  // A sentence-final period is not part of the amount: drop it only when the
  // remaining text already contains a thousands/decimal separator.
  const numberText = rawNumber.endsWith('.') && /[.,]/u.test(rawNumber.slice(0, -1))
    ? rawNumber.slice(0, -1)
    : rawNumber;
  const decimal = numberText ? parseLocalizedMoneyDecimal(numberText) : null;
  const supported = isSupportedCurrency(currency);
  const precisionSafe = decimal !== null && supported && decimalPlaces(decimal) <= currencyExponent(currency);
  const inferred = resolveRole(body, start);
  const role = inferred === 'unresolved' && fallbackRole ? fallbackRole : inferred;
  const confirmed = currency !== 'UNKNOWN' && supported && precisionSafe && role !== 'unresolved';
  return { currency, role, status: confirmed ? 'confirmed' : 'uncertain' };
}

export async function evaluate(row) {
  if (row.suite !== 'E01') return { blocked: `No integrated ${row.suite} application adapter/instrumentation yet` };
  const [{ classifyEvent }, { buildEntityDrafts }, { buildFinancialTransactionCandidate }] = await Promise.all([
    import('../../src/domain/classification.ts'), import('../../src/domain/entities.ts'), import('../../src/domain/financial-transactions.ts'),
  ]);
  const classified = classifyEvent(row.input);
  const entityDrafts = buildEntityDrafts(classified);
  const candidate = buildFinancialTransactionCandidate({ event: row.input, classified, entityDrafts });
  const transaction = candidate ? { amount: candidate.amount.toFixed(2), currency: candidate.currency, merchant: candidate.merchantLabel } : null;
  const fallbackRole = candidate ? 'purchase' : null;
  const values = classified.entities.filter(entity => entity.type === 'amount').map(entity => {
    const start = row.input.body.indexOf(entity.value);
    const inspected = inspectValue(entity.value, row.input.body, start, fallbackRole);
    return { text: entity.value, start, end: start + entity.value.length,
      role: inspected.role, currency: inspected.currency, status: inspected.status };
  });
  return { transaction, values };
}
