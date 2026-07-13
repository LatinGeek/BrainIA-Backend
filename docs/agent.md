# BrainIA Agent Context

## Project

BrainIA is a backend-first system for capturing generic events from a mobile client, classifying them, and turning them into a queryable knowledge base for future AI use.

## Design principle

The mobile app must not process business logic. It only captures and sends events.

The backend is the source of truth for:

- ingestion
- normalization
- classification
- persistence
- queries
- graph preparation

## Functional goal

The system should accept events such as:

- emails
- expenses
- notes
- notifications
- reminders
- any other generic event

And then:

- classify them
- enrich them
- relate them to each other
- expose them to an assistant or AI layer

## Current stack

- Node.js
- Fastify
- TypeScript
- Zod

## Architecture decision

The base of the project is a pure API.

No web UI is assumed as the primary product.
The future target UI is mobile.

## API convention

- base version: `/api/v1`
- healthcheck: `/health`

## Current state

- a minimal API is already working
- heuristic classification is active
- Postgres persistence is active
- optional API-key or client-scoped auth is active for API routes
- event contract versioning and idempotency are active
- raw events and derived knowledge are split
- entity extraction and event-to-entity links are active
- relation extraction and event-to-relation links are active
- entity canonicalization and manual merge are active
- single-event reprocessing is active
- a lightweight metrics endpoint is active
- text search is active with basic relevance filters
- bounded graph expansion is active
- entity resolution is separated from graph expansion
- the agent tool catalog stays compact and self-describing
- formal MCP discovery is available over GET and JSON-RPC POST
- inspect returns structured resolution and graph summaries
- insight generation is available as a focused agent endpoint
- insight generations are persisted as audit snapshots and can be replayed by id
- digest generation is available as a time-window summary endpoint
- digest generations are persisted as audit snapshots and can be replayed by id
- DeepSeek can generate a short natural-language summary when configured
- the project keeps a concrete future feature list in `docs/future-features.md`
- an end-to-end test now covers capture, search, graph, inspect, insight, digest, and agent surfaces
- the post-MVP backlog now prioritizes observability, graph projections, retrieval quality, relation/entity quality, and the agent surface before mobile UI work
- request IDs are echoed on responses and slow requests are logged for correlation
- graph traversal caching is active for repeated bounded expansions
- search results include local relevance hints and explanation fields
- entity drafts are deduplicated and noisy merchant candidates are filtered
- notification events can surface a source entity for `received_from` relations
- ambiguous classifications can be upgraded by DeepSeek when configured
- model-assisted classification metadata is stored for audit and replay
- quick capture routes are active for notes, email, notifications, wallet events, and offline batches
- a thin mobile shell scaffold exists in `mobile/`
- a thin web dashboard scaffold exists for exploration and debugging
- runbooks for import, replay, recovery, and slow requests live in `docs/runbooks.md`
- the post-MVP backlog has been closed and residual ideas live in `docs/future-roadmap.md`

## Recommended next steps

1. refine relation/entity quality
2. expand retrieval quality or add richer digesting and scheduling on top of the audit trail

## What must stay updated

This file should always reflect:

- the project objective
- the current architecture
- technical decisions
- the system state
- the next steps

## Short-term memory

Before closing a session or introducing a new decision, evaluate whether `memory.md` should be updated.

`memory.md` is the short-term working memory and should:

- summarize active decisions
- reflect recent changes
- point to documentation that should be created, updated, or removed
- act as operational memory for the current phase

Practical rule:

- if an important decision changes, review whether `memory.md` should change too
- if a document becomes obsolete, fix or remove it
- if a new flow or module appears, document it explicitly

The long-term planning surface lives in `docs/backlog.md`.
