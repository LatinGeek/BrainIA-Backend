import { isDeepStrictEqual } from 'node:util';

export function binomial(correct, total) {
  if (!Number.isInteger(correct) || !Number.isInteger(total) || total < 0 || correct < 0 || correct > total) throw new Error('INVALID_METRIC_COUNTS');
  if (!total) return { numerator: correct, denominator: total, value: null, confidence95: null, zeroErrorUpper95: null };
  const z = 1.959963984540054;
  const p = correct / total;
  const center = (p + z * z / (2 * total)) / (1 + z * z / total);
  const margin = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / (1 + z * z / total);
  return { numerator: correct, denominator: total, value: p, confidence95: [Math.max(0, center - margin), Math.min(1, center + margin)],
    zeroErrorUpper95: correct === total ? 1 - Math.pow(0.05, 1 / total) : null };
}

export function compare(expected, observed, prefix = '') {
  const failures = [];
  for (const [key, value] of Object.entries(expected)) {
    const field = prefix ? `${prefix}.${key}` : key;
    const actual = observed?.[key];
    if (key.endsWith('Minimum')) {
      if (!Number.isFinite(actual) || actual < value) failures.push({ field, expected: `>=${value}`, observed: actual ?? null });
    } else if (key.endsWith('Maximum') || key === 'recoveryWithinMs') {
      if (!Number.isFinite(actual) || actual < 0 || actual > value) failures.push({ field, expected: `0..${value}`, observed: actual ?? null });
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      failures.push(...compare(value, actual, field));
    } else if (!isDeepStrictEqual(value, actual)) failures.push({ field, expected: value, observed: actual ?? null });
  }
  return failures;
}

export function ranking(relevant, retrieved, grades = {}) {
  const permitted = new Set(relevant);
  const unique = [...new Set(retrieved)];
  const hits = unique.slice(0, 20).filter(id => permitted.has(id)).length;
  const first = unique.slice(0, 10).findIndex(id => permitted.has(id));
  const gain = id => grades[id] ?? (permitted.has(id) ? 1 : 0);
  const dcg = values => values.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  const ideal = dcg([...permitted].map(gain).sort((a, b) => b - a).slice(0, 10));
  return { recall5: relevant.length ? unique.slice(0, 5).filter(id => permitted.has(id)).length / relevant.length : null,
    recall20: relevant.length ? hits / relevant.length : null, mrr10: first < 0 ? 0 : 1 / (first + 1),
    ndcg10: ideal ? dcg(unique.slice(0, 10).map(gain)) / ideal : null };
}

export function extractionMetrics(rows) {
  const fields = {};
  for (const field of ['amount', 'currency', 'merchant']) {
    let promoted = 0, recoverable = 0, correct = 0;
    for (const { expected, observed } of rows) {
      const target = expected?.transaction?.[field];
      const actual = observed?.transaction?.[field];
      if (target !== undefined && target !== 'UNKNOWN') recoverable++;
      if (actual !== undefined && actual !== 'UNKNOWN') {
        promoted++;
        if (actual === target && target !== 'UNKNOWN') correct++;
      }
    }
    fields[field] = { precision: binomial(correct, promoted), recall: binomial(correct, recoverable),
      gate: { precision: promoted ? correct / promoted >= 0.99 : recoverable === 0,
        recall: recoverable ? correct / recoverable >= 0.97 : true } };
  }
  const ambiguous = rows.filter(row => row.expected.values.some(value => value.currency === 'UNKNOWN'));
  const abstained = ambiguous.filter(row => !row.observed?.transaction || row.observed.transaction.currency === 'UNKNOWN').length;
  return { fields, unknownCurrencyAbstention: binomial(abstained, ambiguous.length),
    currencyHardGate: fields.currency.precision.numerator === fields.currency.precision.denominator && abstained === ambiguous.length };
}
