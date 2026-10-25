# Interpretation configuration comparison

Status: FAIL. Dataset: interpretation-comparison-synthetic-1.
Baseline: checkout-rules-baseline (78fa31036cd20d26f3529ff1d64511738e30793d28cbcfc1fcabed34b70f34d7).
Candidate: synthetic-prompt-replay (32396ae5f274ad391d65efec13c5f2a74dfc52afc6ec12dd812eeae1f9984de7).

| Field | Baseline correct/total | Candidate correct/total |
| --- | --- | --- |
| eventType | 18/20 | 19/20 |
| amount | 19/20 | 19/20 |
| currency | 19/20 | 19/20 |
| merchant | 19/20 | 19/20 |
| category | 20/20 | 20/20 |
| relationships | 33/37 | 32/37 |
| reviewRequired | 19/20 | 20/20 |

Regressed fields: 1. Exact cases: baseline 12/17, candidate 12/17.

- Regressed fields 1 > 0
- Candidate exact-case accuracy below minimum
- Candidate eventType accuracy below minimum
- Candidate amount accuracy below minimum
- Candidate currency accuracy below minimum
- Candidate merchant accuracy below minimum
- Candidate relationships accuracy below minimum

## Case failures and regressions

### irrelevant-weather (synthetic-prompt-replay)

- REGRESSION irrelevant-weather.relationships: expected []; observed [{"type":"received_from","from":"notification:clima","to":"app:clima sintético"}]

### balance-only (synthetic-prompt-replay)

- FAIL balance-only.eventType: expected "notification"; observed "expense"
- FAIL balance-only.amount: expected null; observed "8000.00"
- FAIL balance-only.currency: expected null; observed "UYU"
- FAIL balance-only.merchant: expected null; observed "Banco Sintético"
- FAIL balance-only.relationships: expected []; observed [{"type":"spent_at","from":"amount:uyu 8.000,00","to":"merchant:saldo"}]

### capture-category (synthetic-prompt-replay)

- FAIL capture-category.relationships: expected [{"type":"spent_at","from":"amount:uyu 120,00","to":"merchant:cafe norte"}]; observed [{"type":"spent_at","from":"amount:uyu 120,00","to":"merchant:almuerzo"}]

### repeated-capture (synthetic-prompt-replay)

- FAIL crossRelationships: expected [{"type":"same_as","from":"repeat-b","to":"repeat-a"}]; observed []

### multiple-source-evidence (synthetic-prompt-replay)

- FAIL crossRelationships: expected [{"type":"evidence_for","from":"receipt-b","to":"repeat-a"}]; observed []

Synthetic labels await independent review. This comparison does not certify production quality, consolidation, or app UI. Latency is measured locally and varies; usage/cost remain null when unavailable.
