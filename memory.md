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
- no UI yet
- documentation centralized under `docs/`
- `docs/agent.md` is the persistent context document
- `memory.md` is the short-term working memory
- storage is Postgres
- optional API-key or client-scoped auth is active
- event contract versioning and idempotency are active
- event ingestion contract is documented
- SQL migrations are versioned
- knowledge model is split across raw events, classified events, entities, and relations
- runtime writes to raw events and classified events
- entity extraction and event-to-entity links are active
- relation extraction and event-to-relation links are active
- single-event reprocessing is active
- lightweight metrics are available through `/api/v1/metrics`
- entity and relation query endpoints are active
- textual search is active for assistant retrieval
- graph-by-entity retrieval is active with depth and limits
- agent tool manifest is active
- MCP-like registry endpoint is active
- entity resolution is separate from graph expansion
- graph responses include root distance, direction, and path hints
- inspect endpoint is active for resolve + expand + explain
- DeepSeek can generate a natural-language summary via `DEEPSEEK_API_KEY`
- the public agent tool catalog now includes reprocess and metrics helpers
- a minimal test suite is active
- the MVP scope is documented in `docs/mvp.md`
- the post-MVP backlog is documented in `docs/backlog.md`

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

1. improve heuristic entity and relation extraction
2. refine the reprocess pipeline into a broader rebuild flow
3. formalize the MCP server surface if needed
4. expand observability and durability notes
