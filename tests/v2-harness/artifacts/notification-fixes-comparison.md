# Interpretation configuration comparison

Status: FAIL. Dataset: interpretation-comparison-synthetic-1.
Baseline: checkout-rules-baseline (b4bbe36f61ff0ee1b7d258ad4d6b06cd2fb4eb49ecb1283a5823aa2824b36f44).
Candidate: checkout-rules-candidate (1536e7d032baab4d191b5d6c6900ebbf0f9f9a4a80498afe69a19852c9c7af5b).

| Field | Baseline correct/total | Candidate correct/total |
| --- | --- | --- |
| eventType | 19/20 | 19/20 |
| amount | 20/20 | 20/20 |
| currency | 20/20 | 20/20 |
| merchant | 20/20 | 20/20 |
| category | 20/20 | 20/20 |
| relationships | 33/37 | 33/37 |
| reviewRequired | 19/20 | 19/20 |

Regressed fields: 0. Exact cases: baseline 12/17, candidate 12/17.

- Candidate exact-case accuracy below minimum
- Candidate eventType accuracy below minimum
- Candidate relationships accuracy below minimum
- Candidate reviewRequired accuracy below minimum

## Case failures and regressions

### irrelevant-weather (checkout-rules-candidate)

- FAIL irrelevant-weather.eventType: expected "notification"; observed "other"
- FAIL irrelevant-weather.reviewRequired: expected false; observed true

### balance-only (checkout-rules-candidate)

- FAIL balance-only.relationships: expected []; observed [{"type":"received_from","from":"notification:saldo","to":"app:banco sintético"}]

### capture-category (checkout-rules-candidate)

- FAIL capture-category.relationships: expected [{"type":"spent_at","from":"amount:uyu 120,00","to":"merchant:cafe norte"}]; observed [{"type":"spent_at","from":"amount:uyu 120,00","to":"merchant:almuerzo"}]

### repeated-capture (checkout-rules-candidate)

- FAIL crossRelationships: expected [{"type":"same_as","from":"repeat-b","to":"repeat-a"}]; observed []

### multiple-source-evidence (checkout-rules-candidate)

- FAIL crossRelationships: expected [{"type":"evidence_for","from":"receipt-b","to":"repeat-a"}]; observed []

Synthetic labels await independent review. This comparison does not certify production quality, consolidation, or app UI. Latency is measured locally and varies; usage/cost remain null when unavailable.
