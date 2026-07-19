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
- canonical entities should be preferred for graph and search responses
- every response echoes `x-request-id` for correlation when the client supplies one or the server generates one

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

## Capture workflows

The capture routes are thin adapters over the same event contract.

They are intended for mobile clients or source-specific integrations that want a smaller payload surface than the generic `/api/v1/events` route.

### `POST /api/v1/capture/note`

Captures a note-like payload and maps it to a `note` event.

### `POST /api/v1/capture/email`

Captures a provider-agnostic email payload and maps it to an `email` event.

The backend does not care whether the payload came from Gmail, Outlook, another mail provider, or a custom bridge. The bridge should normalize the message into one canonical email capture request and send it here.

Recommended fields:

- `id`
- `provider`
- `accountId`
- `messageId`
- `threadId`
- `subject`
- `snippet`
- `body`
- `from`
- `to`
- `cc`
- `bcc`
- `folder`
- `labels`
- `timestamp`
- `externalId`
- `idempotencyKey`
- `raw`
- `tags`

Field notes:

- `provider` is optional and can be used for analytics or debugging
- `accountId` should identify the mailbox account inside the bridge
- `messageId` should be the stable message identifier from the provider
- `threadId` can be used when the bridge wants to group conversation threads
- `raw` should preserve provider-specific payloads, headers, and any extra metadata
- if `source` is omitted, the backend can fall back to `provider` or `capture.email`

Example:

```json
{
  "id": "mail_123",
  "provider": "gmail",
  "accountId": "acc_123",
  "messageId": "msg_123",
  "threadId": "thread_123",
  "subject": "Receipt from store",
  "snippet": "Your receipt is ready",
  "from": "billing@example.com",
  "to": "me@example.com",
  "labels": ["INBOX", "IMPORTANT"],
  "raw": {
    "sourceSystem": "gmail-api"
  }
}
```

The bridge should keep the message id stable across retries so the backend can deduplicate safely.

### `POST /api/v1/capture/notification`

Captures a notification payload and maps it to a `notification` event.

### `POST /api/v1/capture/wallet`

Captures a wallet or expense payload and maps it to an `expense` event.

### `POST /api/v1/capture/batch`

Flushes an offline batch of mixed capture items.

Batch response shape:

```json
{
  "batchId": "batch_1",
  "count": 2,
  "items": []
}
```

These routes preserve raw payloads while still producing the generic ingestion contract expected by the backend.

## Financial transactions

### `GET /api/v1/financial/transactions?limit=50`

Returns the canonical financial transaction layer derived from expense and income events.

Each item includes:

- normalized merchant label
- amount and currency
- observed window
- evidence rows that point back to the contributing raw events

The endpoint is useful when an agent wants to see the same real-world payment grouped across wallet notifications, bank notifications, and related receipts.

### `GET /api/v1/financial/transactions/:id`

Returns one canonical transaction and all of its evidence rows.

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

Returns canonical entities stored in Postgres. Entity records include a canonical `value`, standalone `description`, and `identitySource` provenance.

The interactive Explore graph is stricter than raw entity storage: it only exposes rooted entities with a non-empty description whose identity was produced by the semantic model, seeded by the governed ontology, or explicitly named by the user. Extracted event text remains evidence and is not automatically promoted into a visible node.

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
  "matches": [
    {
      "id": "entity_1",
      "matchedEntityId": "entity_4",
      "canonicalEntityId": "entity_1",
      "isCanonical": true
    }
  ]
}
```

Matches are merge-aware and return canonical entities rather than raw aliases.

### `POST /api/v1/entities/:id/merge`

Merges the entity referenced by `:id` into a canonical root supplied in the request body.

Request body:

```json
{
  "canonicalEntityId": "entity_1",
  "reason": "manual cleanup",
  "confidence": 1
}
```

Response shape:

```json
{
  "aliasEntityId": "entity_4",
  "canonicalEntityId": "entity_1",
  "reason": "manual cleanup",
  "confidence": 1,
  "alreadyMerged": false,
  "sameAsRelation": {}
}
```

## Alias review queue

### `GET /api/v1/aliases?entityId=...`

Lists the manual aliases attached to one canonical entity.

Aliases are the user-facing labels that help retrieval work with merchant names or other legal names that should be normalized into a friendlier concept.

Each alias can also store a `categoryPath` breadcrumb such as:

```json
["gastos", "supermercado"]
```

### `GET /api/v1/review/aliases?status=pending|resolved|ignored`

Lists financial merchant-style candidates waiting for human review.

These queue items are created when the backend detects a likely merchant or legal name inside a financial event but still needs a user to decide:

- the alias to store
- the category breadcrumb to attach
- whether the candidate should be ignored

### `POST /api/v1/review/aliases/:id/resolve`

Resolves one pending review by creating or updating an alias and attaching a category breadcrumb.

Request body:

```json
{
  "alias": "kiosco",
  "categoryPath": ["gastos", "supermercado"],
  "notes": "Alias manual para Las Acacias SRL"
}
```

This endpoint creates the alias record, marks the queue item as resolved, and makes the alias available to search and entity resolution.

### `POST /api/v1/review/aliases/:id/ignore`

Marks a queue item as ignored when the candidate should not become an alias.

This is useful for false positives or for merchant names inside financial events that should be normalized in a later pass.

### `GET /api/v1/entities/:id/graph?depth=2&maxNodes=100&maxRelations=100`

Returns the neighborhood of a canonical entity as a bounded graph expansion.

Query params:

- `depth`: how many relationship hops to traverse, defaults to `2`
- `maxNodes`: maximum number of entity nodes to return, defaults to `100`
- `maxRelations`: maximum number of relations to return, defaults to `100`

Response shape:

```json
{
  "resolvedFromEntityId": "entity_4",
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
  "relations": [
    {
      "id": "relation_1",
      "sourceEntityId": "entity_2",
      "targetEntityId": "entity_1",
      "relationType": "spent_at",
      "label": "se gastó en",
      "description": "$12.40 se gastó en Spotify",
      "confidence": 0.8,
      "importanceScore": 0.4,
      "explanation": "$12.40 se gastó en Spotify",
      "depth": 1,
      "direction": "incoming"
    }
  ],
  "paths": [
    {
      "nodeIds": ["entity_1", "entity_2"],
      "relationIds": ["relation_1"],
      "summary": "$12.40 se gastó en Spotify",
      "depth": 1,
      "direction": "incoming"
    }
  ]
}
```

This endpoint is the main retrieval primitive for agent reasoning around a single entity.

The graph expansion tool is intentionally separate from entity resolution:

- `resolve` finds the entity
- `graph` expands the entity

Graph nodes include `rootDistance` and graph relations include `direction` so the agent can reconstruct the traversal.

If the requested id is an alias, the response resolves to the canonical root and exposes `resolvedFromEntityId`.

The response also includes `paths` as a lightweight reconstruction hint.

Graph relations also include an `importanceScore` and a human-readable `explanation` so the agent can rank and narrate edges more easily.

## Agent tools

### `GET /api/v1/agent/tools`

Returns an agent-readable tool manifest.

This endpoint is intentionally MCP-like:

- each entry names a tool
- each entry explains what it does
- each entry maps to a concrete HTTP method and path
- the manifest is grouped into workflow sections

It is useful for:

- agent discovery
- future MCP adapters
- UI generation
- prompt/tool orchestration

The public catalog is intentionally compact:

It is also grouped into three workflow sections so agents can reason about the API surface without mixing unrelated concerns:

- `non_financial_entity_extraction`
- `general_event_ingestion`
- `financial_alias_review`

Each section is exposed in the manifest and in the MCP-like registry.

- `inspect_knowledge`
- `generate_insight`
- `list_insight_runs`
- `get_insight_run`
- `generate_digest`
- `list_digest_runs`
- `get_digest_run`
- `resolve_entity`
- `merge_entity`
- `list_entity_aliases`
- `list_alias_reviews`
- `resolve_alias_review`
- `ignore_alias_review`
- `ingest_event`
- `reprocess_event`
- `list_events`
- `view_metrics`
- `search_knowledge`

The financial alias review section contains the alias queue and resolution tools.
The general event ingestion section contains generic capture and replay helpers.
The non-financial extraction section contains the knowledge retrieval and graph-facing tools.

### `GET /api/v1/agent/mcp`

Returns the same tool catalog with a shape closer to a tool registry.

It is intended as a bridge for future MCP adapters and external agent runtimes.

The registry also includes the same workflow sections used by `GET /api/v1/agent/tools`.

Each tool includes:

- `inputSchema`
- `outputSchema`
- `examples`
- `expectedErrors`

This lets agents and adapters understand not just the route, but how to use it.

### `POST /api/v1/agent/mcp`

Implements a minimal JSON-RPC 2.0 MCP transport for agent discovery.

Supported methods:

- `initialize`
- `tools/list`

`tools/list` returns the grouped sections and the flat tool list, so agents can either scan the whole catalog or focus on one workflow.

Initialize response shape:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "serverInfo": {
      "name": "BrainIA",
      "version": "0.1.0"
    },
    "capabilities": {
      "tools": {
        "listChanged": false
      }
    }
  }
}
```

`tools/list` returns the same manifest used by the GET registry endpoint.

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
  "resolution": {
    "requestedEntityId": null,
    "requestedQuery": "spotify",
    "matchedEntityId": "entity_1",
    "canonicalEntityId": "entity_1",
    "mode": "search_match",
    "explanation": "The query matched a canonical entity through textual retrieval."
  },
  "rootEntity": {},
  "graph": {},
  "graphSummary": {},
  "searchResult": {},
  "summary": "Natural language explanation",
  "model": "deepseek-v4-flash",
  "summaryAvailable": true
}
```

This is the most agent-friendly single-call retrieval path.

The response includes a structured `resolution` object and a lightweight `graphSummary` so an agent can understand both the selection and the expansion at a glance.

## Insights

### `GET /api/v1/insights?id=...`

or

### `GET /api/v1/insights?q=...`

Builds a structured insight from an entity or textual hint.

The endpoint wraps resolution, graph expansion, and summary generation into a more opinionated response for agent consumption.

Response shape:

```json
{
  "query": "spotify",
  "resolution": {},
  "summary": "Spotify is a merchant entity linked to expense activity.",
  "takeaways": [
    "Spotify is a merchant entity linked to expense activity.",
    "The graph expands to 3 nodes and 2 relations."
  ],
  "graphSummary": {},
  "supportingEntities": [],
  "supportingRelations": [],
  "model": "deepseek-v4-flash",
  "summaryAvailable": true,
  "audit": {
    "id": "insight_1",
    "createdAt": "2026-07-13T12:05:00.000Z",
    "model": "deepseek-v4-flash",
    "toolName": "generate_insight"
  }
}
```

This is the preferred endpoint when the agent wants a compact conclusion instead of the full structured inspect payload.

Each insight generation is also persisted as an audit snapshot so agents can replay or inspect the exact request and response later.

### `GET /api/v1/insights/history?limit=25`

Lists stored insight generations in reverse chronological order.

Response shape:

```json
{
  "limit": 25,
  "count": 1,
  "runs": [
    {
      "id": "insight_1",
      "toolName": "generate_insight",
      "query": "spotify",
      "request": {},
      "response": {},
      "summary": "Spotify is a merchant entity linked to expense activity.",
      "model": "deepseek-v4-flash",
      "createdAt": "2026-07-13T12:05:00.000Z"
    }
  ]
}
```

### `GET /api/v1/insights/history/:id`

Returns one stored insight generation by id, including the original request and full response snapshot.

If the run id does not exist, the API returns HTTP `404` with:

```json
{
  "error": "insight_run_not_found",
  "message": "No stored insight run matches the provided id"
}
```

## Digests

### `GET /api/v1/digests`

Generates a time-window digest over recent events, aggregate metrics, and related insight history.

Query params:

- `from`
- `to`
- `days`
- `source`
- `kind`
- `eventLimit`

If `from` is omitted, the backend uses `days` to derive a default window ending at `to` or `now`.

Response shape:

```json
{
  "scope": "window 2026-07-06T00:00:00.000Z -> 2026-07-13T00:00:00.000Z, source=tasker",
  "window": {
    "from": "2026-07-06T00:00:00.000Z",
    "to": "2026-07-13T00:00:00.000Z"
  },
  "filters": {
    "source": "tasker",
    "kind": null
  },
  "metrics": {
    "totalEvents": 12,
    "classifiedEvents": 12,
    "uniqueEntities": 8,
    "uniqueRelations": 4,
    "eventsBySource": [],
    "eventsByKind": [],
    "eventsByInferredKind": []
  },
  "recentEvents": [],
  "relatedInsights": [],
  "highlights": [],
  "summary": "Tasker produced 12 events in the requested window.",
  "model": "deepseek-v4-flash",
  "summaryAvailable": true,
  "audit": {
    "id": "digest_1",
    "createdAt": "2026-07-13T12:20:00.000Z",
    "model": "deepseek-v4-flash",
    "toolName": "generate_digest"
  }
}
```

Digests are broader than insights:

- insights focus on a single entity or query
- digests focus on a time window and event trends

The digest response always includes a human-readable summary; DeepSeek enriches it when configured, otherwise the backend falls back to a deterministic summary.

### `GET /api/v1/digests/history?limit=25`

Lists stored digest generations in reverse chronological order.

### `GET /api/v1/digests/history/:id`

Returns one stored digest generation by id, including the original request and response snapshot.

If the digest id does not exist, the API returns HTTP `404` with:

```json
{
  "error": "digest_run_not_found",
  "message": "No stored digest run matches the provided id"
}
```

## Metrics

### `GET /api/v1/metrics`

Returns lightweight counts for raw events, classified events, entities, relations, and event links.

This endpoint is intended for basic observability and agent-side sanity checks.

## Web dashboard

### `GET /dashboard`

Returns the optional operations dashboard HTML shell.

Supporting assets:

- `GET /dashboard/styles.css`
- `GET /dashboard/app.js`

## Search

### `GET /api/v1/search?q=...`

Performs a simple textual search across:

- events
- entities
- relations

Optional filters:

- `source`
- `kind`
- `from`
- `to`

This is the first retrieval layer for the assistant.

Response shape:

```json
{
  "query": "spotify",
  "searchHints": {},
  "events": [],
  "entities": [],
  "relations": []
}
```

The entity results are canonicalized and deduplicated by their canonical root.
Each result now includes a `matchHint` with `matchedFields`, `relevanceScore`, and a short explanation of why it matched.

## Contract notes

- this API is intentionally generic
- the client should not need to know the eventual graph schema
- all specialization happens in the backend
- the raw event is the source of truth
- derived classification can change over time without losing the original event
- event retries should be deduplicated by a stable dedupe key whenever possible
- the knowledge layer is queryable independently from the ingestion path
- merchant or legal-name notifications can be queued for alias review
- the search layer is textual for now and can later evolve to embeddings or hybrid retrieval
- graph expansion should be bounded by depth and maximum result sizes
- agent-facing routes should be self-describing and easy to adapt to MCP
- agent tool manifests should include schemas, examples, and expected errors
- entity resolution and entity expansion should remain separate tools
- a single inspect tool should combine retrieval and explanation for agent use
- reprocessing should rebuild derived knowledge from the raw source without losing the source record
- canonical graph and search results should prefer merged entity roots

## Semantic governance

- `GET /api/v1/semantic/candidates?status=pending` returns reviewable v2 decisions, including `decisionKind`, `domainValue`, `anchorRole`, `proposedPath`, per-step alternatives, recurrence count, model, and governance version.
- `POST /api/v1/semantic/candidates/:id/resolve` accepts `{ "action": "approve" | "reject", "targetEntityId"?: string, "createRule"?: boolean }`.
- `POST /api/v1/semantic/backfill` accepts `{ "batchSize"?: 25, "cursor"?: string, "dryRun"?: false, "governanceVersion"?: "semantic-governance-v3" }` and returns a persisted run ID, counts, failures, and the next cursor.
- An event has exactly one primary semantic anchor and at most one anchor per life domain. Anchors always point to the most-specific selected entity.
