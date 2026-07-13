# BrainIA

BrainIA is a backend-first system for capturing generic events from mobile or automation sources, classifying them, and turning them into a queryable knowledge base.

## Current shape

- Fastify + TypeScript backend
- Postgres-backed event and knowledge storage
- generic event ingestion under `/api/v1/events`
- source-specific capture adapters under `/api/v1/capture/*`
- graph, search, inspect, and insight endpoints for agent retrieval
- insight audit history for replaying generated conclusions
- a thin mobile shell scaffold in `mobile/`
- a thin web dashboard scaffold at `/dashboard`
- persistent project context under `docs/`

## Design

- mobile clients stay thin
- the backend owns classification, enrichment, persistence, and retrieval
- knowledge is modeled with entities, relations, canonical roots, and traversal hints
- agent-facing routes stay compact and self-describing

## Docs

- [`docs/agent.md`](docs/agent.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/api.md`](docs/api.md)
- [`docs/domain.md`](docs/domain.md)
- [`docs/insights-digests.md`](docs/insights-digests.md)
- [`docs/operations.md`](docs/operations.md)
- [`docs/changelog.md`](docs/changelog.md)
- [`docs/mvp.md`](docs/mvp.md)
- [`docs/backlog.md`](docs/backlog.md)
- [`docs/future-features.md`](docs/future-features.md)

## Mobile shell

The `mobile/` package is a thin native client scaffold.

It can:

- read backend metrics
- run inspect queries
- send quick capture events

Set `EXPO_PUBLIC_BRAINIA_API_BASE_URL` to point it at the backend.

## Backend commands

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run test`
- `npm run migrate`
