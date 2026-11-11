# Interpretation configuration comparison

Status: FAIL. Dataset: interpretation-comparison-synthetic-1.
Baseline: checkout-rules-baseline (4fbf08c14a13ea7ded7337fd264cbd5b92af59c05228724b4315d3ef645282eb).
Candidate: deliberate-amount-regression (6a808f9e21c36c2c607bba4f12faf98831b8158ca0da30e9c3ae6b57825ca9d6).

| Field | Baseline correct/total | Candidate correct/total |
| --- | --- | --- |
| eventType | 18/20 | 18/20 |
| amount | 19/20 | 18/20 |
| currency | 19/20 | 19/20 |
| merchant | 19/20 | 19/20 |
| category | 20/20 | 20/20 |
| relationships | 33/37 | 33/37 |
| reviewRequired | 19/20 | 19/20 |

Regressed fields: 1. Exact cases: baseline 12/17, candidate 11/17.

- Regressed fields 1 > 0

## Case failures and regressions

### expense-uyu (deliberate-amount-regression)

- REGRESSION expense-uyu.amount: expected "1733.00"; observed "1.73"

### irrelevant-weather (deliberate-amount-regression)

- FAIL irrelevant-weather.eventType: expected "notification"; observed "other"
- FAIL irrelevant-weather.reviewRequired: expected false; observed true

### balance-only (deliberate-amount-regression)

- FAIL balance-only.eventType: expected "notification"; observed "expense"
- FAIL balance-only.amount: expected null; observed "8000.00"
- FAIL balance-only.currency: expected null; observed "UYU"
- FAIL balance-only.merchant: expected null; observed "Banco Sintético"
- FAIL balance-only.relationships: expected []; observed [{"type":"spent_at","from":"amount:uyu 8.000,00","to":"merchant:saldo"}]

### capture-category (deliberate-amount-regression)

- FAIL capture-category.relationships: expected [{"type":"spent_at","from":"amount:uyu 120,00","to":"merchant:cafe norte"}]; observed [{"type":"spent_at","from":"amount:uyu 120,00","to":"merchant:almuerzo"}]

### repeated-capture (deliberate-amount-regression)

- FAIL crossRelationships: expected [{"type":"same_as","from":"repeat-b","to":"repeat-a"}]; observed []

### multiple-source-evidence (deliberate-amount-regression)

- FAIL crossRelationships: expected [{"type":"evidence_for","from":"receipt-b","to":"repeat-a"}]; observed []

Synthetic labels await independent review. This comparison does not certify production quality, consolidation, or app UI. Latency is measured locally and varies; usage/cost remain null when unavailable.
