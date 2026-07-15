# Live Event Analysis Report

## Scope

This report reviews the current live Postgres state for the two real event flows already ingested into the system:

- one mobile notification for a real food delivery expense
- one provider-agnostic email test

The goal is to identify which fields were generated, how the data was classified, and which system optimizations should come next.

## Evidence snapshot

Current live counts at the time of the review:

| Table | Rows | Notes |
| --- | ---: | --- |
| `raw_events` | 2 | one expense notification, one email |
| `classified_events` | 2 | both events were classified |
| `entities` | 14 | includes historical orphan graph nodes from reprocess cycles |
| `event_entities` | 9 | current event-to-entity links |
| `relations` | 4 | includes historical orphan graph edges from reprocess cycles |
| `event_relations` | 2 | current event-to-relation links |
| `entity_review_queue` | 3 | two useful financial candidates and one noisy candidate |
| `financial_transactions` | 1 | one canonical expense transaction |
| `financial_transaction_events` | 1 | one evidence row for that transaction |
| `insight_runs` | 3 | audit/support data, not core event flow |

## Event 1: Santander food-delivery expense

### Raw event

- `id`: `md_1783983499458`
- `source`: `macrodroid`
- `kind`: `notification`
- `title`: `Aviso: uso de tarjeta de débito`
- `body`: transaction alert for `UYU 277,87` at `MONTEVIDEO/DLO*PedidosYa Dragon VIS3`
- `tags`: `["mobile", "notification"]`

### Classification

- `inferred_kind`: `expense`
- `confidence`: `0.9000`
- `classification_version`: `heuristic-v1+llm`
- model metadata is stored, including the DeepSeek upgrade decision

This is a good result. The base heuristic started as `other`, then the model-assisted layer upgraded it to `expense` with a clear rationale.

### Derived entities

Current live graph contains the latest cleaned-up entity set for this event:

- `amount`: `UYU 277.87`
- `merchant`: `PedidosYa`
- `card_last_four`: `5343`
- `card_type`: `VISA`
- `location`: `Montevideo`
- `merchant`: `Aviso`  -> noisy false positive

Historical reprocess artifacts also remain in `entities`:

- `payment-method`: `VISA terminada en 5343`
- `amount`: `UYU 277,87`
- `merchant`: `MONTEVIDEO/DLO*PedidosYa Dragon VIS3`

Those older nodes are no longer linked to the event, but they still exist as orphan rows.

### Derived relations

Current live relation:

- `relation_type`: `spent_at`
- `label`: `se gastó en`
- `description`: `UYU 277.87 se gastó en PedidosYa`

Historical orphan relations also remain:

- `relation_1`: `277.87 se gastó en PedidosYa`
- `relation_2`: `UYU 277,87 se gastó en MONTEVIDEO/DLO*PedidosYa Dragon VIS3`

### Financial projection

The expense was correctly materialized as a canonical financial transaction:

- `kind`: `expense`
- `amount`: `277.87`
- `currency`: `UYU`
- `merchant_label`: `PedidosYa`
- `normalized_merchant`: `pedidosya`
- `match_strategy`: `merchant_entity_match`
- `match_score`: `0.9500`

This is the strongest part of the current system: the transaction layer successfully collapses the notification into a canonical expense record.

### Review queue output

Current queue rows tied to this event:

- `PedidosYa`
- `Aviso`
- `MONTEVIDEO/DLO*PedidosYa Dragon VIS3`

Interpretation:

- `MONTEVIDEO/DLO*PedidosYa Dragon VIS3` is useful as a raw merchant descriptor and should likely become an alias or a category input.
- `PedidosYa` is already a clean merchant label and should probably not require human review.
- `Aviso` is noise and should be filtered earlier.

## Event 2: provider-agnostic email test

### Raw event

- `id`: `gmail:germanlamela98@gmail.com:<LV3P222MB0987BD84C3A7F98BC8A85EFDC6F92@LV3P222MB0987.NAMP222.PROD.OUTLOOK.COM>`
- `source`: `make.gmail`
- `kind`: `email`
- `title`: `Hola`
- `body`: `from: germanlamela@outlook.com`
  `to: germanlamela98@gmail.com`

The normalized raw payload preserves the upstream bridge and provider data inside `raw.providerPayload`.

### Classification

- `inferred_kind`: `email`
- `confidence`: `0.8000`
- `classification_version`: `heuristic-v1`

This is correct and stable.

### Derived entities

Current live entities for the email:

- `recipient`: `germanlamela98@gmail.com`
- `message`: `Hola`
- `merchant`: `Hola from`  -> false positive

The `merchant` entity is the clearest quality issue in the email flow. It is a heuristic artifact that should not be there.

### Derived relation

- `relation_type`: `sent_to`
- `label`: `se envía a`
- `description`: `Hola se envía a germanlamela98@gmail.com`

This relation is structurally correct, but it is too thin for downstream agent use because there is no sender entity and the message node is just the subject line.

### Storage footprint

Observed payload sizes:

- notification raw payload: `517` bytes
- notification model metadata: `1782` bytes
- email raw payload: `7548` bytes
- email model metadata: `4` bytes

The email bridge is storing a large provider payload, which is fine for auditability, but it should be normalized more aggressively if this grows with volume.

## System-level findings

### 1. Reprocess leaves orphan graph rows

The current reprocess path clears:

- `classified_events`
- `event_entities`
- `event_relations`
- `financial_transaction_events`
- `financial_transactions`

It does not clear:

- `entities`
- `relations`

Because of that, reprocessing the notification created historical orphan nodes and edges in the graph layer. This is the most important structural issue found in this review.

Impact:

- search can surface stale variants
- graph traversal can get noisy if it ever includes orphan rows
- entity counts drift upward even when the event is reprocessed cleanly

### 2. Heuristic entity extraction is too permissive

Observed false positives:

- `Aviso`
- `Hola from`

These come from generic capitalized substring detection and email-body concatenation. They are not useful knowledge nodes.

### 3. Alias review is too eager for obvious labels

The alias queue currently accepts rows that should probably be auto-handled:

- `PedidosYa` should be auto-accepted or at least not require human action
- only raw merchant descriptors like `MONTEVIDEO/DLO*PedidosYa Dragon VIS3` should reach human review
- obvious noise should be dropped before queueing

### 4. Email extraction should be provider-aware but bridge-agnostic

The backend is correctly bridge-agnostic, but it still needs a richer normalization layer for email-specific fields:

- sender
- recipient
- message id
- thread id
- account id
- folder/labels

Those fields should live in normalized metadata, not just inside a large raw JSON blob.

### 5. Financial dedupe should be multi-source by design

The current financial layer is already useful, but it should be pushed one step further:

- match by amount + merchant + approximate time window
- allow wallet, bank notification, and receipt email evidence to converge into one transaction
- keep a stable fingerprint for dedupe across bridges

### 6. Cleanup coverage should extend to support/audit tables

The database still had support-table residue before the latest cleanup, and the review found remaining audit rows in `insight_runs`.

Non-core tables should be covered by explicit cleanup paths when running smoke tests or when doing a full purge in a non-production scenario.

## What is already good

Not everything needs changes.

The current schema and indexes already cover the core access paths reasonably well:

- event lookup by id and dedupe key
- entity lookup by normalized value
- relation lookup by source/target
- review queue lookup by status
- transaction lookup by merchant and time

So the main optimization area is data quality and lifecycle management, not immediate indexing work.

## Recommended priorities

### P0

- Fix reprocess cleanup so stale graph rows do not survive as orphans.
- Tighten merchant heuristic filtering for emails and notifications.

### P1

- Split alias review into:
  - auto-accepted clean merchant labels
  - human-review candidate descriptors
  - early noise rejection
- Add sender extraction and normalized provider metadata for email events.
- Add a stronger cross-source transaction fingerprint.

### P2

- Reduce raw email payload bloat by normalizing stable fields out of `raw.providerPayload`.
- Extend cleanup scripts and operational runbooks to include support tables such as `insight_runs`.

## Implemented follow-up

The current codebase now addresses the highest-impact issues identified in this report:

- reprocess prunes the event-local graph surface so orphan entities and relations do not survive the rerun
- email capture normalizes sender and recipient metadata before graph extraction
- email extraction no longer invents merchant candidates from email text
- alias review only queues descriptor-like financial merchant candidates

## Conclusion

The system is working end to end:

- the notification became a canonical expense
- the email became a canonical email event
- the financial transaction layer correctly collapsed the expense

The main quality gaps are now clear:

- reprocess leaves orphaned graph data
- heuristic entity extraction is too permissive
- alias review needs stricter gating

Those are the next optimizations that will improve retrieval quality and keep the knowledge graph trustworthy.
