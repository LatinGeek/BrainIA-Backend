// Read-only observations of current application code; never copies golden answers.
export const revision = 'current-checkout-heuristic-v3';
export async function evaluate(row) {
  if (row.suite !== 'E01') return { blocked: `No integrated ${row.suite} application adapter/instrumentation yet` };
  const [{ classifyEvent }, { buildEntityDrafts }, { buildFinancialTransactionCandidate }] = await Promise.all([
    import('../../src/domain/classification.ts'), import('../../src/domain/entities.ts'), import('../../src/domain/financial-transactions.ts'),
  ]);
  const classified = classifyEvent(row.input);
  const entityDrafts = buildEntityDrafts(classified);
  const candidate = buildFinancialTransactionCandidate({ event: row.input, classified, entityDrafts });
  const transaction = candidate ? { amount: candidate.amount.toFixed(2), currency: candidate.currency, merchant: candidate.merchantLabel } : null;
  const values = classified.entities.filter(entity => entity.type === 'amount').map(entity => {
    const start = row.input.body.indexOf(entity.value);
    return { text: entity.value, start, end: start + entity.value.length, role: candidate ? 'purchase' : 'unresolved',
      currency: candidate?.currency ?? 'UNKNOWN', status: candidate ? 'confirmed' : 'uncertain' };
  });
  return { transaction, values };
}
