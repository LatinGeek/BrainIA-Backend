# Interpretation configuration comparison

Status: FAIL. Dataset: interpretation-comparison-synthetic-1.
Baseline: checkout-rules-baseline (4fbf08c14a13ea7ded7337fd264cbd5b92af59c05228724b4315d3ef645282eb).
Candidate: synthetic-prompt-replay (367331516db87c9389f10d104e91fdcd74cfef0ce07d6cb752d20796650afb07).

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
