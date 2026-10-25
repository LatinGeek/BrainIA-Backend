# Interpretation configuration comparison

Status: PASS. Dataset: interpretation-comparison-synthetic-1.
Baseline: checkout-rules-baseline (78fa31036cd20d26f3529ff1d64511738e30793d28cbcfc1fcabed34b70f34d7).
Candidate: checkout-rules-candidate (711e0eb08ac092860b1c3971fa0129e3294085e81cd4ca12a14a2d15a93a4cc3).

| Field | Baseline correct/total | Candidate correct/total |
| --- | --- | --- |
| eventType | 18/20 | 18/20 |
| amount | 19/20 | 19/20 |
| currency | 19/20 | 19/20 |
| merchant | 19/20 | 19/20 |
| category | 20/20 | 20/20 |
| relationships | 33/37 | 33/37 |
| reviewRequired | 19/20 | 19/20 |

Regressed fields: 0. Exact cases: baseline 12/17, candidate 12/17.


## Case failures and regressions

### irrelevant-weather (checkout-rules-candidate)

- FAIL irrelevant-weather.eventType: expected "notification"; observed "other"
- FAIL irrelevant-weather.reviewRequired: expected false; observed true

### balance-only (checkout-rules-candidate)

- FAIL balance-only.eventType: expected "notification"; observed "expense"
- FAIL balance-only.amount: expected null; observed "8000.00"
- FAIL balance-only.currency: expected null; observed "UYU"
- FAIL balance-only.merchant: expected null; observed "Banco Sintético"
- FAIL balance-only.relationships: expected []; observed [{"type":"spent_at","from":"amount:uyu 8.000,00","to":"merchant:saldo"}]

### capture-category (checkout-rules-candidate)

- FAIL capture-category.relationships: expected [{"type":"spent_at","from":"amount:uyu 120,00","to":"merchant:cafe norte"}]; observed [{"type":"spent_at","from":"amount:uyu 120,00","to":"merchant:almuerzo"}]

### repeated-capture (checkout-rules-candidate)

- FAIL crossRelationships: expected [{"type":"same_as","from":"repeat-b","to":"repeat-a"}]; observed []

### multiple-source-evidence (checkout-rules-candidate)

- FAIL crossRelationships: expected [{"type":"evidence_for","from":"receipt-b","to":"repeat-a"}]; observed []

Synthetic labels await independent review. This comparison does not certify production quality, consolidation, or app UI. Latency is measured locally and varies; usage/cost remain null when unavailable.
