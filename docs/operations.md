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
- relation descriptions are part of the canonical schema
- event ingestion is idempotent through a dedupe key
- reprocessing is available for a single stored event
- a lightweight metrics endpoint is available
- knowledge query endpoints are available for entities and relations
- entity resolve endpoint is available for resolving ids or textual hints
- entity merge endpoint is available for canonicalization
- textual search endpoint is available for assistant retrieval
- search accepts basic relevance filters for source, kind, and time window
- search results include local relevance hints and explanation fields
- entity graph endpoint is available for bounded neighborhood retrieval
- quick capture routes are available for notes, email, notifications, wallet events, and offline batches
- financial merchant and legal-name candidates can be queued for alias review and categorization
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
- primary agent surface is intentionally compact and self-describing

Production target:

- Postgres backed persistence
- migrations
- backups
- retention rules
- separation of raw events, classified events, entities, and relations

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
