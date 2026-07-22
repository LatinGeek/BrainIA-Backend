# Ingestion Flow

## Goal

Describe the full path from a mobile-originated event to durable storage and future knowledge processing.

## Flow

### 1. Event capture on mobile

The mobile client or automation tool observes something relevant:

- notification
- email
- expense
- note
- reminder

It converts that observation into a generic event payload.

For email, the same idea applies to a provider-agnostic bridge:

- Gmail, Outlook, or another mail source normalizes a message into one canonical email payload
- the bridge posts it to the backend
- provider-specific details stay inside `raw`

### 2. HTTP ingestion

The client sends the payload to:

`POST /api/v1/events`

Source-specific bridges may also use the thin capture routes, such as `POST /api/v1/capture/email`, when they want the backend to normalize a mail event before the generic event pipeline stores it.

### 3. Validation

The backend validates the payload shape.

If validation fails:

- the request is rejected
- no storage occurs
- the response contains validation issues

### 4. Classification

The backend classifies the event.

This is where the system may infer:

- `inferredKind`
- `confidence`
- detected entities

### 5. Persistence

The backend stores the raw event and the derived classification in Postgres within a single transaction.

For email events, the backend also preserves bridge metadata such as provider, account id, message id, folder, and labels inside the raw payload so the system can remain provider-agnostic.

In the split model:

- `raw_events` stores the original input
- `classified_events` stores backend interpretation
- entities extracted during ingest are upserted into `entities`
- links between events and entities are written to `event_entities`
- relation records are upserted into `relations`
- links between events and relations are written to `event_relations`

### 6. Response

The backend returns the stored event as confirmation.

### 7. Downstream use

Later systems can consume the stored data to:

- query history
- build insights
- generate summaries
- create knowledge graph projections
- power a future assistant

## Persistence split

### Governed event interpretation

Raw provider titles and bodies remain immutable in `raw_events`. Model-assisted enrichment writes a separate user-facing `display_title` and `display_description` to `classified_events`, together with status, source, confidence, model, prompt version, and failure reason. Generic headings such as `Aviso` are never promoted as interpreted identity.

Deterministic financial parsing remains authoritative for event kind, amount, and currency, while the model normalizes the merchant and explains what happened. If model output is missing or invalid, the event is marked `retryable`; clients show the original content and explicitly state that interpretation is unavailable.

Meaningful event instances keep an event-scoped normalized identity (`event:<raw-event-id>`), so repeated events with similar generated labels remain distinct graph leaves. Explore can include these governed `financial_event`, `email_message`, and `activity_instance` nodes and route them back to the exact captured event.

Before placing an event instance, the semantic model compares its meaning—not only its wording—against existing described concepts. A matching concept is reused; otherwise a high-confidence reusable event class is created once. Individual occurrences remain evidence below that canonical meaning. The Explore overview hides those evidence leaves by default to avoid visual duplication, while entity and event details preserve exact navigation and provenance.

### Reprocessing safety

Semantic backfills run with one materialization worker by default. This prevents multiple model decisions from creating synonymous concepts against the same stale graph snapshot. Parallel materialization is available only through the explicit `--unsafe-concurrency` diagnostic flag. A PostgreSQL advisory lock also serializes the complete graph-read/model/write cycle across API calls and backend instances, closing the same race outside the CLI script.

Every successful CLI backfill ends with an LLM-assisted reconciliation pass unless `--skip-reconciliation` is explicitly supplied. The protected backfill endpoint also runs it automatically after its final successful page; failed events must be retried first. The pass re-reads the completed canonical graph, proposes exact-identity merges and non-durable concept demotions, and then submits every proposal to a second adversarial model verification. Automatic mutation requires agreement from both passes at 95% confidence plus structural validation: types must match, concept duplicates must share an immediate parent, user-owned nodes cannot be merged away, and only AI concepts can be demoted. Related-but-distinct nodes remain review proposals. Accepted merges rewire hierarchy and event relations to the canonical entity before aliases are hidden.

Pending semantic candidates are lifecycle state, not permanent graph content. Target lookup follows entity merges and aliases to the canonical node. Reusing an existing concept for an event instance attaches the occurrence as evidence at the primary-root confidence threshold. Candidates whose canonical relation already exists are automatically approved, and an event is marked for review only while at least one unresolved candidate actually remains. A proposed event concept that merely restates its existing parent is reused instead of materializing another node.

Reconciliation also repairs historical event evidence deterministically: when an unparented event already has an approved semantic anchor, the occurrence is attached directly beneath that canonical anchor. This repair never creates a concept and excludes old event nodes that themselves have hierarchy children, preserving cycle safety.

The ingestion pipeline should not assume a single denormalized table forever.

Instead it should evolve toward:

1. raw event capture
2. classification storage
3. entity extraction
4. relation extraction
5. graph projection

### Runtime note

BrainIA now writes the split model directly from the API:

- first insert `raw_events`
- then insert `classified_events`
- then upsert extracted entities
- then write `event_entities`
- then upsert derived relations
- then write `event_relations`
- finally return the joined representation

When relation extraction becomes active:

- relation records will be inserted into `relations`
- event-level relation links will be written to `event_relations`

## Ingestion principles

- preserve raw input
- derive meaning separately
- do not depend on the client to know the knowledge schema
- keep the server as the source of truth
