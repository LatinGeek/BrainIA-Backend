# Interpretation configuration comparison

Status: FAIL. Dataset: interpretation-comparison-synthetic-1.
Baseline: checkout-rules-baseline (78fa31036cd20d26f3529ff1d64511738e30793d28cbcfc1fcabed34b70f34d7).
Candidate: deliberate-amount-regression (102ce376d0d484d67fbfec4ef37b1214afed1578717b795fba66ca94ce2796cd).

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
