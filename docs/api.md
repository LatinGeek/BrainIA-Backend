# API

## Base URL

`/api/v1`

## Design rules

- all client-facing endpoints are versioned
- the backend preserves raw input
- derived interpretation is stored separately from the source payload
- event ingestion must be idempotent when possible
- mobile clients should be able to retry safely
- optional API-key or client-scoped auth can protect the API surface

When auth is enabled, clients should send:

- `x-brainia-api-key`
- `x-brainia-client-id` when client-scoped keys are configured

## Health

### `GET /health`

Returns a simple readiness response.

Response:

```json
{ "ok": true }
```

## Event ingestion

### `POST /api/v1/events`

Ingests a generic event produced by a client such as a mobile notification reader, shortcut app, automation tool, or future integration.

### Request contract

The request body must contain:

- `id`
- `source`

The request body may contain:

- `contractVersion`
- `kind`
- `title`
- `body`
- `timestamp`
- `externalId`
- `idempotencyKey`
- `raw`
- `tags`

### Field semantics

- `id`: stable identifier for the event in the client or ingestion layer
- `source`: origin of the event, for example `tasker`, `mobile`, `email`, `wallet`
- `contractVersion`: explicit version of the request contract, defaults to `1`
- `kind`: client-provided coarse hint, defaulting to `other`
- `title`: short human-readable summary
- `body`: longer body or payload text
- `timestamp`: ISO 8601 timestamp if the client can provide it
- `externalId`: identifier from the external system, if any
- `idempotencyKey`: stable retry key when the client can supply one
- `raw`: original unmodified payload or a structured representation of it
- `tags`: free-form client tags

### Canonical ingestion example

```json
{
  "id": "evt_123",
  "source": "tasker",
  "contractVersion": 1,
  "kind": "notification",
  "title": "Compra en supermercado",
  "body": "Visa $12.40",
  "timestamp": "2026-07-13T12:00:00.000Z",
  "externalId": "abc-123",
  "idempotencyKey": "notif-abc-123",
  "raw": {
    "packageName": "com.example.wallet",
    "notificationTitle": "Compra en supermercado"
  },
  "tags": ["expense", "mobile"]
}
```

### Server behavior

When the API receives a valid event, it must:

1. validate the payload
2. preserve the raw input
3. classify the event
4. attach derived metadata
5. persist the result transactionally
6. deduplicate retries using the event id or stable retry keys
7. return the stored record

See also:

- [`docs/ingestion-flow.md`](ingestion-flow.md)
- [`docs/postgres-schema.md`](postgres-schema.md)

### Response contract

On success, the endpoint returns the stored and classified event.

The stored record now includes:

- `contractVersion`
- `idempotencyKey`
- `dedupeKey`
- `classificationVersion`
- linked entities and relations

### Error contract

Validation failures return HTTP `400` with a payload shaped like:

```json
{
  "error": "invalid_event",
  "issues": {}
}
```

## List events

### `GET /api/v1/events`

Returns the stored events in append order.

## Event reprocessing

### `POST /api/v1/events/:id/reprocess`

Rebuilds the derived knowledge for a stored event using the current heuristics.

This is the first reprocessing primitive. It deletes the previous derived links for that event and rebuilds them from the raw source record.

Response shape:

```json
{
  "id": "evt_123",
  "source": "tasker",
  "inferredKind": "expense",
  "classificationVersion": "heuristic-v1"
}
```

## Knowledge queries

### `GET /api/v1/entities`

Returns canonical entities stored in Postgres.

### `GET /api/v1/relations`

Returns canonical relations stored in Postgres, including their human-readable `label` and `description`.

These endpoints are meant to support:

- assistant retrieval
- UI exploration
- debugging of the knowledge graph

For the MVP, the primary agent entrypoint is `GET /api/v1/agent/inspect`.
The lower-level entity resolve and graph routes are support helpers.

### `GET /api/v1/entities/resolve?id=...`

or

### `GET /api/v1/entities/resolve?q=...`

Resolves a canonical entity before graph traversal.

This is useful when the agent:

- already knows the exact id
- only has a textual hint

Response shape:

```json
{
  "matches": []
}
```

### `GET /api/v1/entities/:id/graph?depth=2&maxNodes=100&maxRelations=100`

Returns the neighborhood of a canonical entity as a bounded graph expansion.

Query params:

- `depth`: how many relationship hops to traverse, defaults to `2`
- `maxNodes`: maximum number of entity nodes to return, defaults to `100`
- `maxRelations`: maximum number of relations to return, defaults to `100`

Response shape:

```json
{
  "rootEntity": {},
  "depthRequested": 2,
  "depthReturned": 2,
  "stats": {
    "nodesCount": 0,
    "relationsCount": 0,
    "maxDepthReached": 0,
    "truncated": false
  },
  "nodes": [],
  "relations": [],
  "paths": []
}
```

This endpoint is the main retrieval primitive for agent reasoning around a single entity.

The graph expansion tool is intentionally separate from entity resolution:

- `resolve` finds the entity
- `graph` expands the entity

Graph nodes include `rootDistance` and graph relations include `direction` so the agent can reconstruct the traversal.

The response also includes `paths` as a lightweight reconstruction hint.

## Agent tools

### `GET /api/v1/agent/tools`

Returns an agent-readable tool manifest.

This endpoint is intentionally MCP-like:

- each entry names a tool
- each entry explains what it does
- each entry maps to a concrete HTTP method and path

It is useful for:

- agent discovery
- future MCP adapters
- UI generation
- prompt/tool orchestration

The public catalog is intentionally compact:

- `inspect_knowledge`
- `ingest_event`
- `reprocess_event`
- `list_events`
- `view_metrics`
- `search_knowledge`

### `GET /api/v1/agent/mcp`

Returns the same tool catalog with a shape closer to a tool registry.

It is intended as a bridge for future MCP adapters and external agent runtimes.

Each tool includes:

- `inputSchema`
- `outputSchema`
- `examples`
- `expectedErrors`

This lets agents and adapters understand not just the route, but how to use it.

### `GET /api/v1/agent/inspect?id=...`

or

### `GET /api/v1/agent/inspect?q=...`

Combines resolution, bounded graph expansion, and optional natural-language explanation.

If `DEEPSEEK_API_KEY` is configured, the backend also returns a short textual summary generated by DeepSeek.

Query params:

- `id` or `q`
- `depth`
- `maxNodes`
- `maxRelations`

Response shape:

```json
{
  "query": "spotify",
  "rootEntity": {},
  "graph": {},
  "searchResult": {},
  "summary": "Natural language explanation",
  "model": "deepseek-v4-flash",
  "summaryAvailable": true
}
```

This is the most agent-friendly single-call retrieval path.

## Metrics

### `GET /api/v1/metrics`

Returns lightweight counts for raw events, classified events, entities, relations, and event links.

This endpoint is intended for basic observability and agent-side sanity checks.

## Search

### `GET /api/v1/search?q=...`

Performs a simple textual search across:

- events
- entities
- relations

This is the first retrieval layer for the assistant.

Response shape:

```json
{
  "events": [],
  "entities": [],
  "relations": []
}
```

## Contract notes

- this API is intentionally generic
- the client should not need to know the eventual graph schema
- all specialization happens in the backend
- the raw event is the source of truth
- derived classification can change over time without losing the original event
- event retries should be deduplicated by a stable dedupe key whenever possible
- the knowledge layer is queryable independently from the ingestion path
- the search layer is textual for now and can later evolve to embeddings or hybrid retrieval
- graph expansion should be bounded by depth and maximum result sizes
- agent-facing routes should be self-describing and easy to adapt to MCP
- agent tool manifests should include schemas, examples, and expected errors
- entity resolution and entity expansion should remain separate tools
- a single inspect tool should combine retrieval and explanation for agent use
- reprocessing should rebuild derived knowledge from the raw source without losing the source record
