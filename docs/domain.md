# Domain Model

## Core idea

BrainIA treats everything as an event first.

An event is something observed from a client source that might later become:

- an expense
- an email
- a note
- a task
- a notification
- a knowledge node

## Event

The canonical event is the source record that enters the system.

### Required fields

- `id`
- `source`

### Optional fields

- `contractVersion`
- `kind`
- `title`
- `body`
- `timestamp`
- `externalId`
- `idempotencyKey`
- `raw`
- `tags`

### Semantics

- `id` identifies the record in the ingestion layer
- `source` identifies where it came from
- `contractVersion` identifies the payload contract version
- `idempotencyKey` can be used for stable retries when the client has one
- `raw` preserves the original payload
- `kind` is a coarse client hint, not the final truth

## Classified event

A classified event is the event plus backend interpretation.

### Derived fields

- `classificationVersion`
- `inferredKind`
- `confidence`
- `entities`

### Classification intent

The backend should infer meaning without destroying the original event.

Examples of derived knowledge:

- money amount detected
- merchant detected
- email-like content detected
- task-like intent detected

## Event kinds

Current supported kinds:

- `email`
- `expense`
- `note`
- `notification`
- `task`
- `other`

## Classification policy

Classification is a derived process.

The system should:

- preserve the raw event
- attach a derived interpretation
- keep confidence scores where possible
- allow future reclassification
- keep track of the classification version used to derive the interpretation

## Future domain entities

Planned knowledge objects include:

- people
- merchants
- organizations
- places
- amounts
- topics
- projects
- tasks

## First entity pass

The first extraction pass currently targets:

- amounts
- merchants

These are heuristic and can be expanded later with richer extraction and NLP/LLM support.

## Future relations

Planned relation types include:

- `sent_by`
- `mentions`
- `belongs_to`
- `spends_at`
- `related_to`
- `happened_before`
- `same_as`

## Relation as text

Relations should not only exist as technical edges.

Each relation should also store:

- a canonical `relation_type`
- a human-readable `label`
- a full `description`

Example:

- `relation_type`: `spends_at`
- `label`: `se extrae de`
- `description`: `Gastos se extraen de Email y Mobile notifications`

That lets the graph remain usable both as structured data and as readable knowledge.

## Entity canonicalization

Entities can be merged into a canonical root when the system determines they represent the same knowledge node.

Canonicalization should preserve:

- the canonical entity record
- the alias entity identity
- the reason for the merge
- merge confidence
- a `same_as` relation for provenance and traversal

The system should favor canonical entities for:

- ingestion-time links
- search results
- graph traversal
- agent resolution

## Heuristic entity quality

The first pass now tries to keep entities useful instead of noisy.

Current quality rules include:

- duplicate entity drafts are deduplicated per event
- generic merchant-like prefixes are stripped from merchant candidates
- obviously noisy merchant or notification candidates are dropped
- notification events can surface the event source as an entity so `received_from` relations stay materializable

## Model-assisted classification

The heuristic classifier remains the default.

When an event is ambiguous and DeepSeek is configured, the backend may upgrade the classification with a structured model-assisted suggestion.

That fallback should:

- keep the raw event intact
- only override the heuristic when the model is more confident
- preserve the original classification trail through the classification version
- store audit metadata about the prompt, response, and application decision

## Capture adapters

The API now includes thin capture adapters for common mobile sources.

They normalize input into the generic event contract:

- notes map to `note`
- email-like payloads map to `email`
- notifications map to `notification`
- wallet events map to `expense`

Batch capture is also supported for offline queue flushes. The capture routes are intentionally thin wrappers around the same event ingestion model.

## First relation pass

The first heuristic relation extractor currently targets:

- expenses linked to merchants with `spent_at`
- emails linked to recipients with `sent_to`
- notifications linked to sources with `received_from`

Each relation is stored both as:

- a technical relation record
- a textual, human-readable description

## Merge provenance

Manual or heuristic entity merges should create a `same_as` relation so the knowledge graph keeps the relationship visible.

That keeps aliasing transparent for agents and lets traversal explain why two entities were collapsed into one canonical root.

## Event-to-entity links

Events should link to entities through a dedicated join table.

That lets a single entity be referenced by many events without duplication.

## Data philosophy

The project should store raw observations first and derive structure later.

That gives us flexibility to:

- improve classifiers
- reprocess past events
- change the knowledge model
- build a graph view without losing original data

## Persistence model direction

The long-term persistence model should separate:

- raw events
- classified events
- entities
- relations
- event-to-entity links
- event-to-relation links

Relations should preserve both machine meaning and human-readable text.

This avoids coupling the original observation to one fixed interpretation.

## Entity graph retrieval

When the assistant asks for an entity, the system should be able to return:

- the root entity
- reachable nodes up to a requested depth
- the relations connecting those nodes
- statistics about the expansion

Graph responses should also provide:

- `rootDistance` on nodes
- `direction` on relations
- `importanceScore` on relations
- readable path summaries for explanation
- lightweight `paths` for reconstruction

This allows the assistant to reason over a bounded subgraph instead of only retrieving first-degree links.

## Insight audit history

Insight generation is itself a durable knowledge artifact.

Each generated insight is stored with:

- the originating tool name
- the normalized query used to produce it
- the full request snapshot
- the full response snapshot
- the summary returned to the caller
- the model name used, when available

That audit trail makes it easier to:

- replay past conclusions
- compare outputs after model or heuristic changes
- inspect what an agent actually saw at generation time
- keep a lightweight history without building a separate analytics system too early

## Digests

Digests summarize a time window of recent activity instead of a single entity or query.

The digest model includes:

- a normalized time window
- optional source and kind filters
- event counts by source, kind, and inferred kind
- unique entity and relation counts
- recent events from the selected window
- related insight runs from the same window
- a generated summary and audit snapshot

Digests are meant to help agents answer operational questions like:

- what changed this week
- which source is producing the most events
- what recent insights are related to the current activity
