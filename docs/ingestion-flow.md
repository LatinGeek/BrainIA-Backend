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
