# Operations

## Local development

Current prototype is a Node.js service.

Expected commands:

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run migrate`

## Environment variables

- `PORT`
- `HOST`
- `API_PREFIX`
- `DATABASE_URL`
- `BRAINIA_API_KEY`
- `BRAINIA_CLIENT_KEYS`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL`

## Storage behavior

Current state:

- Postgres-backed storage
- `raw_events` and `classified_events` as the active durable record
- entities and event links are persisted during ingestion
- relations and event relations are persisted during ingestion
- entity merges and same_as provenance are persisted when manual canonicalization is performed
- schema managed by explicit SQL migrations
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
- entity graph endpoint is available for bounded neighborhood retrieval
- agent tool manifest endpoint is available for MCP-like discovery
- agent tool registry endpoint is available with schemas, examples, and errors
- graph payload includes reconstruction hints for agents
- agent inspect endpoint is available for resolve+expand+explain
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
- send `x-brainia-client-id` and `x-brainia-api-key` when auth is enabled

## Operational rules

- keep the API backward compatible where possible
- version breaking payload changes
- document every architecture change
- keep current decisions reflected in `docs/agent.md`
- keep the public agent surface minimal until the MVP is frozen
- keep the MVP scope aligned with [`docs/mvp.md`](mvp.md)
- keep the backlog aligned with [`docs/backlog.md`](backlog.md)
- prefer canonical entity roots when performing graph or search driven workflows
