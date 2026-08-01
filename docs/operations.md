# Operations

## Local development

Current prototype is a Node.js service.

Expected commands:

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run migrate`
- `npm run cleanup:test-data`
- `npm run worker:once`
- `npm run verify:backup`

## Environment variables

- `PORT`
- `HOST`
- `API_PREFIX`
- `DATABASE_URL`
- `DATABASE_URL_UNPOOLED`
- `BRAINIA_API_KEY`
- `BRAINIA_CLIENT_KEYS`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL`
- `DEEPSEEK_API_URL`
- `DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS`
- `DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS`
- `BRAINIA_PROCESSING_MODE` (`inline` or `queued`)
- `BRAINIA_WORKER_BATCH_SIZE`
- `BRAINIA_OPERATIONS_TOKEN`
- `CRON_SECRET`
- `EMBEDDING_API_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_VERSION`
- `BACKUP_DATABASE_URL`
- `INSIGHT_DEDUPE_DAYS`

On Vercel with the Neon integration, `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are injected for you.
For local development, keep the localhost values in `.env.example` or override them in `.env.local`.

`PORT`, `HOST`, and `API_PREFIX` are local defaults for the direct Node process. Vercel uses the `serverless.ts` entrypoint and a rewrite to `dist/serverless.js`, so those three variables do not need to be set in the Vercel dashboard unless you want custom overrides.

The production smoke check is automated in `.github/workflows/production-smoke.yml` and runs `npm run smoke:remote` against `https://brain-ia-six.vercel.app`.

The cleanup utility is intentionally dry-run by default. Use `--apply` only after verifying the matched rows, add `--prune-orphans` only when you want to remove now-unused graph records after deleting test rows, and pass `--include-runs` only when you also provide explicit filters for `insight_runs` and `digest_runs`. It also knows how to clear `financial_transactions` and `financial_transaction_events` when those rows are part of the selected test scope. For a complete data reset, use `--full-purge --apply`, which truncates all application tables except `schema_migrations`.

## Storage behavior

Current state:

- Postgres-backed storage
- `raw_events` and `classified_events` as the active durable record
- entities and event links are persisted during ingestion
- relations and event relations are persisted during ingestion
- entity merges and same_as provenance are persisted when manual canonicalization is performed
- schema managed by explicit SQL migrations
- runtime uses the pooled Postgres URL while migrations prefer the unpooled URL
- migrations run inside real database transactions
- split knowledge model documented for future rollout
- first entity extraction pass active during ingestion
- first relation extraction pass active during ingestion
- email extraction now normalizes sender and recipient metadata before entity and relation building
- relation descriptions are part of the canonical schema
- event ingestion is idempotent through a dedupe key
- reprocessing is available for a single stored event and prunes the event-local graph surface when rerun
- a lightweight metrics endpoint is available
- knowledge query endpoints are available for entities and relations
- entity resolve endpoint is available for resolving ids or textual hints
- entity merge endpoint is available for canonicalization
- textual search endpoint is available for assistant retrieval
- search accepts basic relevance filters for source, kind, and time window
- search results include local relevance hints and explanation fields
- entity graph endpoint is available for bounded neighborhood retrieval
- quick capture routes are available for notes, email, notifications, wallet events, and offline batches
- financial merchant and legal-name candidates can be queued for alias review and categorization when they look descriptor-like rather than already cleanly branded
- the `mobile/` package contains a thin native shell scaffold wired to metrics, inspect, and capture flows
- agent tool manifest endpoint is available for MCP-like discovery
- agent tool registry endpoint is available with schemas, examples, and errors
- agent tool MCP JSON-RPC endpoint is available for initialize and tools/list
- graph payload includes reconstruction hints for agents
- graph payload includes confidence-based ranking and readable path summaries
- agent inspect endpoint is available for resolve+expand+explain with structured summaries
- insight endpoint is available for compact agent conclusions and supporting evidence
- insight generations are persisted as audit snapshots in `insight_runs`
- digest endpoint is available for time-window summaries and related insight context
- digest generations are persisted as audit snapshots in `digest_runs`
- request IDs are echoed back on responses and slow requests are logged explicitly
- graph traversal caching is active for repeated bounded expansions
- ambiguous classifications can be upgraded by DeepSeek when `DEEPSEEK_API_KEY` is set
- model-assisted classification metadata is stored for later audit and replay
- DeepSeek integration is enabled through `DEEPSEEK_API_KEY`
- the cleanup utility can also target `insight_runs` and `digest_runs` when explicit run filters are supplied
- primary agent surface is intentionally compact and self-describing

Production target:

- Postgres backed persistence
- migrations
- backups
- retention rules
- separation of raw events, classified events, entities, and relations

## Background processing and recovery

- Capture and outbox insertion commit together. DeepSeek failure cannot roll back a raw event.
- Run one bounded worker batch with `npm run worker:once`.
- Inspect failures with `GET /api/v1/operations/jobs` and retry one with `POST /api/v1/operations/jobs/:id/retry`.
- Operations routes require `x-brainia-operations-token` matching `BRAINIA_OPERATIONS_TOKEN`.
- Claims use `FOR UPDATE SKIP LOCKED`; workers may run concurrently without claiming the same job.
- Retry delay is exponential and bounded at 30 minutes. Exhausted work becomes `dead_letter`.

## Scheduled insights

Vercel calls `GET /api/v1/cron/daily-insights` at `08:00 UTC` from `vercel.json`. The request is accepted only when `Authorization` exactly matches `Bearer ${CRON_SECRET}`. The route runs deterministic detectors, deduplicates recent candidates, optionally synthesizes the best candidates with DeepSeek, and persists a daily digest when relevant activity exists.

## Quality gates

`GET /api/v1/metrics/quality` reports observable-event coverage, primary-anchor coverage, rooted visible entities, invalid hierarchy edges, multiple parents, cycles, semantic duplicate groups, pending proposals, model usage/cost, queued jobs, and dead letters.

## Privacy, retention, export, and deletion

- Configure source processing with `PUT /api/v1/privacy/sources/:source`.
- Export scoped personal data with `GET /api/v1/privacy/export`.
- Mark evidence standard/private/hidden with `PATCH /api/v1/privacy/events/:id`.
- Control knowledge visibility with `PATCH /api/v1/privacy/entities/:id`.
- Delete evidence, derived knowledge, or both with `DELETE /api/v1/privacy/events/:id`.
- Apply configured retention rules through `POST /api/v1/operations/retention/run`.
- Model-bound text redacts email addresses, card numbers, account identifiers, and security codes according to source policy.

## Backup verification

Restore a backup into an isolated Postgres database, set `BACKUP_DATABASE_URL`, and run `npm run verify:backup`. Verification checks migration readability and critical-table row access, then stores a `backup_verification_runs` audit. A backup may trail production; the check proves that the restored schema is readable rather than requiring identical live counts.

## Migration workflow

Migrations live in `migrations/` and are applied with:

```bash
npm run migrate
```

The runner tracks applied versions in `schema_migrations`.

## Mobile client integration

The mobile client should:

- send generic event payloads
- include a stable `source`
- include unique `id` or `externalId`
- preserve raw notification content when possible
- include `contractVersion` and an `idempotencyKey` when the client can generate one
- use `/api/v1/capture/*` routes for source-specific shortcuts when they simplify the client
- the mobile shell reads `EXPO_PUBLIC_BRAINIA_API_BASE_URL`
- send `x-brainia-client-id` and `x-brainia-api-key` when auth is enabled
- use `/api/v1/insights` when a compact conclusion is preferred over full inspect output

## Web dashboard integration

- the optional web dashboard is served from `/dashboard`
- it is intended for exploration and debugging, not as the primary product surface

## Operational rules

- keep the API backward compatible where possible
- version breaking payload changes
- document every architecture change
- keep current decisions reflected in `docs/agent.md`
- keep the public agent surface minimal until the MVP is frozen
- keep the MVP scope aligned with [`docs/mvp.md`](mvp.md)
- keep the backlog aligned with [`docs/backlog.md`](backlog.md)
- prefer canonical entity roots when performing graph or search driven workflows

## Runbooks

- importing data, reprocessing, recovery, and slow-request handling are documented in [`docs/runbooks.md`](runbooks.md)
