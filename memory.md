# Memory

## Purpose

Short-term memory for the BrainIA project.

This file should reflect the current state, not the full history.

## Usage

Update this file when:

- a technical decision changes
- relevant documentation is added, removed, or updated
- a new workflow appears
- some documentation becomes obsolete

## Current state

- backend-first project
- stack base: Node.js + Fastify + TypeScript + Zod
- API versioned under `/api/v1`
- optional mobile and web shells exist
- documentation centralized under `docs/`
- `docs/agent.md` is the persistent context document
- `memory.md` is the short-term working memory
- storage is Postgres
- optional API-key or client-scoped auth is active
- event contract versioning and idempotency are active
- event ingestion contract is documented
- SQL migrations are versioned
- knowledge model is split across raw events, classified events, entities, relations, and financial transaction evidence
- runtime writes to raw events and classified events
- entity extraction and event-to-entity links are active
- relation extraction and event-to-relation links are active
- entity canonicalization and manual merge are active
- single-event reprocessing is active
- lightweight metrics are available through `/api/v1/metrics`
- entity and relation query endpoints are active
- textual search is active for assistant retrieval with basic filters
- graph-by-entity retrieval is active with depth and limits
- agent tool manifest is active
- MCP-like registry and JSON-RPC endpoint are active
- merge-aware entity resolve and merge routes are active
- entity resolution is separate from graph expansion
- inspect now aligns its query resolution with the entity resolver
- graph responses include root distance, direction, importance scores, and path hints
- graph roots resolve to canonical entities when aliases are used
- inspect endpoint is active for resolve + expand + explain with structured resolution and graph summaries
- insight endpoint is active for compact conclusions and supporting evidence
- insight generations are persisted as audit snapshots in `insight_runs`
- digest endpoint is active for time-window summaries and related insight context
- digest generations are persisted as audit snapshots in `digest_runs`
- a concrete future feature list exists in `docs/future-features.md`
- an end-to-end test covers capture, search, graph, inspect, insight, digest, and agent surfaces
- the agent catalog is grouped into non-financial extraction, general ingestion, and financial alias review sections
- DeepSeek can generate a natural-language summary via `DEEPSEEK_API_KEY`
- the public agent tool catalog now includes resolve, merge, insight, reprocess, and metrics helpers
- a minimal test suite is active
- the MVP scope is documented in `docs/mvp.md`
- the post-MVP backlog is documented in `docs/backlog.md` and now prioritizes observability, graph projections, retrieval quality, relation/entity quality, and the agent surface before mobile UI work
- request IDs are echoed on responses and slow requests are logged
- graph traversal caching is active for repeated bounded expansions
- search results include local relevance hints and explanation fields
- Vercel deployment now uses a serverless entrypoint (`serverless.ts`) compiled to `dist/serverless.js` with a rewrite for the full backend surface
- production backend is reachable at `https://brain-ia-six.vercel.app/`, `/health` returns 200, and the remote smoke POST succeeds after applying the Postgres migrations
- production smoke verification is automated through `.github/workflows/production-smoke.yml`
- entity drafts are deduplicated and noisy merchant candidates are filtered
- notification events can surface a source entity for `received_from` relations
- financial merchant and legal-name candidates can be queued for alias review and categorization
- canonical financial transactions now group wallet, notification, and email evidence across one canonical expense or income view
- ambiguous classifications can be upgraded by DeepSeek when configured
- model-assisted classification metadata is stored for audit and replay
- quick capture routes are active for notes, email, notifications, wallet events, and offline batches
- a cleanup script exists for test data and is dry-run by default unless `--apply` is passed; it also handles `financial_transactions` and `financial_transaction_events`
- a thin mobile shell scaffold exists in `mobile/`
- a thin web dashboard scaffold exists for exploration and debugging
- operational runbooks now live in `docs/runbooks.md`
- the post-MVP backlog is closed and residual ideas live in `docs/future-roadmap.md`

## Active decisions

- the mobile app is a backend client, not the place where core logic lives
- the system must capture generic events and classify them later
- project documentation is part of the product and should stay current
- every important change should evaluate whether `memory.md` needs an update

## Operating rules

- keep `memory.md` brief and actionable
- reflect only active or recent decisions
- if a document is obsolete, fix it or remove it
- if a decision affects architecture or workflow, document it before moving on

## Next immediate steps

1. refine relation/entity quality
2. consider scheduling, retention, or graph projection work on top of the current retrieval layer
