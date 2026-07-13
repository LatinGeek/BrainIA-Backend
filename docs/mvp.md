# MVP Scope

## Goal

Ship a first solid version of BrainIA that is useful for agent-driven retrieval and event ingestion.

## In scope

- generic event ingestion
- Postgres persistence
- explicit SQL migrations
- heuristic classification
- heuristic entity extraction
- heuristic relation extraction
- textual search over events, entities, and relations
- entity resolution
- bounded entity graph expansion
- agent inspect flow with optional natural-language summary
- minimal agent tool catalog
- documentation of the live system state
- minimal test coverage for the critical paths

## Primary agent flow

1. inspect a target with `GET /api/v1/agent/inspect`
2. retrieve structured graph data
3. optionally generate a natural-language summary with DeepSeek

## Support flows

- `GET /api/v1/entities/resolve`
- `GET /api/v1/entities/:id/graph`
- `GET /api/v1/entities`
- `GET /api/v1/relations`
- `GET /api/v1/search`
- `POST /api/v1/events/:id/reprocess`
- `GET /api/v1/metrics`

These exist to support the primary agent flow and debugging, but they are not the main product surface.

## Explicitly out of scope for the MVP

- authentication
- mobile app
- web app
- vector embeddings
- hybrid retrieval
- graph database dependency
- advanced relation extraction
- production migration tooling beyond the current SQL versioning approach

## MVP exit criteria

- build passes
- tests pass
- the public agent surface is minimal and self-explanatory
- the docs match the runtime behavior
- the repository can be cloned and configured using `.env.example`

## Post-MVP backlog

The evolving post-MVP backlog now lives in [`docs/backlog.md`](backlog.md).

This MVP document stays focused on the shipped baseline and should not become the planning surface for future work.
