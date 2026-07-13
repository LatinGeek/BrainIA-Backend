# Postgres Schema

## Purpose

Postgres is the durable system of record for BrainIA.

It stores:

- raw events
- derived classification
- extracted entities
- links between events and entities
- metadata for future knowledge extraction

## Legacy table

### `events`

Legacy denormalized table from the early prototype.

Current runtime no longer writes here.

## Active runtime tables

### `raw_events`

Stores the unmodified input from the client.

Current columns:

- `id text primary key`
- `source text not null`
- `contract_version integer not null`
- `client_id text null`
- `idempotency_key text null`
- `dedupe_key text not null unique`
- `kind text not null`
- `title text null`
- `body text null`
- `timestamp timestamptz null`
- `external_id text null`
- `raw jsonb not null`
- `tags text[] not null`
- `created_at timestamptz not null default now()`

### `classified_events`

Stores derived interpretation linked to one raw event.

Current columns:

- `id text primary key`
- `raw_event_id text not null`
- `client_id text null`
- `contract_version integer not null`
- `classification_version text not null`
- `inferred_kind text not null`
- `confidence numeric(5,4) not null`
- `entities jsonb not null`
- `created_at timestamptz not null default now()`

### `entities`

Stores canonical knowledge nodes such as people, merchants, places, and amounts.

### `event_entities`

Links events to entities they mention or imply.

## Current columns

### `entities`

- `id text primary key`
- `type text not null`
- `value text not null`
- `normalized_value text not null`
- `metadata jsonb not null`
- `created_at timestamptz not null default now()`

### `event_entities`

- `id text primary key`
- `event_id text not null`
- `entity_id text not null`
- `role text not null`
- `confidence numeric(5,4) not null`
- `created_at timestamptz not null default now()`

### `relations`

- `id text primary key`
- `source_entity_id text not null`
- `target_entity_id text not null`
- `relation_type text not null`
- `label text not null`
- `description text not null`
- `confidence numeric(5,4) not null`
- `metadata jsonb not null`
- `created_at timestamptz not null default now()`

### `event_relations`

- `id text primary key`
- `event_id text not null`
- `relation_id text not null`
- `role text not null`
- `confidence numeric(5,4) not null`
- `created_at timestamptz not null default now()`

## Migration tracking

### `schema_migrations`

Tracks applied migration files.

### Columns

- `version text primary key`
- `applied_at timestamptz not null default now()`

## Why this shape

This schema is intentionally relational, but it preserves enough structure to:

- query quickly
- keep auditability
- evolve toward graph-like projections later
- support reclassification without losing the raw event
- support retry deduplication and explicit contract versioning

## Why split the model

This separation gives us:

- auditability of the raw source
- independent reclassification
- reusable canonical entities
- reusable relations
- a clearer path toward a knowledge graph projection

## Current runtime target

The active ingestion path writes to:

- `raw_events`
- `classified_events`
- `entities`
- `event_entities`
- `relations`
- `event_relations`

The API reads back a joined view of these tables.

## Future tables

Planned next tables include:

None for the current relationship phase. Those tables are now part of the modeled schema.

Those tables will let us materialize a knowledge graph on top of the raw event stream.

## Entity phase

The first entity phase adds:

- `entity_sequences`
- `entities`
- `event_entities`
- `next_sequence_value(sequence_name)`

This phase lets the runtime:

- upsert canonical entities
- link them to events
- avoid duplicating entity values across events

## Idempotency phase

The current foundation pass adds:

- `contract_version`
- `client_id`
- `idempotency_key`
- `dedupe_key`
- `classification_version`

This lets the runtime:

- accept explicit contract evolution
- deduplicate retries safely
- track the classification version used for a derived event
- reprocess a raw event while preserving its original source record

## Relation phase

Relations now store:

- canonical machine type
- human-readable label
- full description

This allows outputs like:

- entity: `Gastos`
- relation label: `se extrae de`
- target entities: `Email`, `Mobile notifications`

## Relation extraction output

The current heuristic extractor materializes relations for:

- expenses to merchants
- emails to recipients
- notifications to sources

Each relation keeps:

- `relation_type`
- `label`
- `description`
- `confidence`
