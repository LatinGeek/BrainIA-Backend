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
- email capture now normalizes sender and recipient metadata before graph extraction
- financial merchant and legal-name candidates can be queued for alias review and categorization only when they look descriptor-like rather than already cleanly branded
- canonical financial transactions now group wallet, notification, and email evidence across one canonical expense or income view
- live data review found that reprocessing can leave orphan entities and relations behind in the graph layer if those derived rows are not cleaned explicitly, and the reprocess path now prunes those event-local rows
- email and notification heuristics still produce noisy merchant candidates in some cases, so merchant gating was tightened and email merchant heuristics were removed
- ambiguous classifications can be upgraded by DeepSeek when configured
- model-assisted classification metadata is stored for audit and replay
- quick capture routes are active for notes, email, notifications, wallet events, and offline batches
- a cleanup script exists for test data and is dry-run by default unless `--apply` is passed; it also handles `financial_transactions` and `financial_transaction_events`
- the cleanup script can also target `insight_runs` and `digest_runs` when explicit run filters are provided
- a live event analysis report now exists at `docs/reports/live-event-analysis-2026-07-13.md`
- a thin mobile shell scaffold exists in `mobile/`
- a thin web dashboard scaffold exists for exploration and debugging
- operational runbooks now live in `docs/runbooks.md`
- the post-MVP backlog is closed and residual ideas live in `docs/future-roadmap.md`
- the knowledge-platform action plan is implemented through migration 0028
- observable event lifecycle, KnowledgeFact, model-call audits, hybrid retrieval, versioned embeddings, proactive insights, transactional jobs, privacy controls, retention, and backup verification are active
- Vercel runs a protected daily knowledge evaluation at 08:00 UTC
- evidence-grounded decision policy v1 is active in code (`BRAINIA_EVIDENCE_POLICY` = off/shadow/enforce); semantic, classification and generated-content stages now carry evidence references and independent verifier metadata
- semantic review candidates expose action kind, typed endpoints, evidence previews, verified event counts and Spanish change explanations; approvals are revalidated server-side and stale/invalid approvals return 409
- historical interpretation generations stage snapshots without mutating the graph; activation is batched/resumable and the previous generation remains available for rollback
- legacy pending semantic candidates from the pre-policy generation were superseded rather than silently approved
- the mobile review card removes raw confidence/"Segura" and shows action-specific, evidence-backed copy; rule creation defaults off and is limited to eligible assignments
- historical generation `a3f6dc01-3473-4b0b-9d81-a2eea1570235` is active: 2022 snapshots staged, 1687 applied, 335 blocked (260 revalidation abstentions, 75 human semantic decisions preserved), 0 failed; a pre-evidence baseline is available for rollback
- production runs with `BRAINIA_EVIDENCE_POLICY=enforce`; the review queue was reduced to 10 high-utility proposals after verified existing-category assignments were applied automatically
- Motorola `moto g04s` installed and exercised with the release APK, including evidence display, approval, rejection, and rule creation; the Xiaomi device was reachable but locked, so only install/launch could be verified
- comparison report: `output/evidence-generation-a3f6dc01-3473-4b0b-9d81-a2eea1570235-pre-activation.md` (pre-activation) and `output/evidence-generation-a3f6dc01-3473-4b0b-9d81-a2eea1570235.md` (post-activation); production deployment `brain-eyc06jgca-latingeeks-projects.vercel.app`, alias `https://brain-ia-six.vercel.app`

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

1. monitor production quality gates, dead letters, detector precision, and token cost
2. tune embeddings and detector thresholds from explicit user feedback
