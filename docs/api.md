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

### `POST /api/v1/financial/transactions/:id/merge`

Keeps the transaction referenced by `:id` as the canonical financial record and
consolidates another same-kind transaction supplied as `{ "duplicateId": "..." }`.
The duplicate projection is retained for provenance but is hidden from transaction
lists, account balances, reports, monthly income and expense totals, and proactive
financial insights. Its evidence appears on the canonical transaction, and event
reprocessing does not recreate the duplicate.

Balance adjustments cannot be consolidated.

### `DELETE /api/v1/financial/transactions/:id`

Hides an incorrect financial projection without deleting its captured source event.
Hidden projections are excluded from the same lists and calculations as merged
duplicates.

## List events

### `GET /api/v1/events`

The response shape depends on whether the request has a query string.

**Without query parameters (legacy, deprecated).** Returns every stored event of the
caller as a full-record array in append order (`created_at asc`), including `raw`,
`body`, `entities` and `relations`. The response carries `Deprecation: true` and a
`Link: </api/v1/events?limit=25>; rel="successor-version"` header. Existing consumers keep
working unchanged; new code should use the paginated form.

**With any query parameter (paginated history).** Returns summaries only. Unknown or
invalid parameters are rejected with `400 invalid_event_query`.

| Parameter | Meaning |
| --- | --- |
| `limit` | 1-100, default 25. May change between pages. |
| `cursor` | Opaque `page.nextCursor` from the previous response. |
| `order` | `desc` (default, newest first) or `asc`. |
| `dateField` | `occurredAt` (default) or `ingestedAt`; selects the time used by `from`, `to` and ordering. |
| `from` / `to` | ISO-8601 date-times with timezone; `from` inclusive, `to` exclusive. |
| `source` | Exact source(s); repeat or comma-separate (max 20). |
| `category` | Primary semantic category key(s); repeat or comma-separate. |
| `status` | `captured`, `classified`, `semantically_resolved`, `review`, `retryable`, `discarded`; repeat or comma-separate. |

Filters combine with AND; values inside one filter combine with OR.

Time semantics: `occurredAt` is the event's own `timestamp`, falling back to the ingestion
time when the producer sent none. `ingestedAt` is when BrainIA stored the event.

Ordering is `(dateField, id)` in the requested direction, so equal timestamps are broken by
event id and paging a stable dataset yields no duplicates or gaps. Rows inserted while paging
may appear or not, but never cause duplicates of already-seen rows.

```json
{
  "items": [
    {
      "id": "...", "source": "capture.wallet", "kind": "expense", "inferredKind": "expense",
      "title": "...", "displayTitle": null, "bodyPreview": "first 200 chars of body",
      "occurredAt": "2026-03-01T10:00:00.000Z", "ingestedAt": "2026-03-02T00:00:00.000Z",
      "processingStatus": "classified", "primaryCategoryKey": "finance",
      "interpretationStatus": "pending", "privacyStatus": "standard"
    }
  ],
  "page": { "limit": 25, "hasMore": true, "nextCursor": "eyJ2Ijox..." },
  "query": { "order": "desc", "dateField": "occurredAt" }
}
```

`nextCursor` is `null` on the last page. Cursors are bound to the owner and to the filter/order
set that produced them; replaying one for another owner or with different filters returns
`400 invalid_cursor`. Fetch full detail (entities, relations, raw payload) with
`GET /api/v1/events/:id`. `bodyPreview` is the only body text in list entries.

## Event processing progress

`GET /api/v1/events/:id` and the `201` response of `POST /api/v1/events` carry an additive `progress` object. `processingStatus` and every other existing field are unchanged. The list endpoints (`GET /events` in both shapes) do **not** include `progress`; fetch the detail when you need it.

`progress` is a read-only projection. Nothing is stored for it: each stage is derived on every request from records that already exist, so it cannot disagree with them. Source: `src/domain/event-progress.ts` (pure derivation) and `src/storage/event-progress.ts` (reads).

### Shape

```json
{
  "version": 1,
  "summary": { "status": "pending", "partial": true, "message": "Expense recorded; interpretation pending." },
  "stages": {
    "classification":         { "status": "completed", "code": "classified", "message": "Event classified.", "evidence": "record", "job": { "status": "succeeded", "attempt": 1, "maxAttempts": 5, "nextAttemptAt": null } },
    "semanticInterpretation": { "status": "pending", "code": "job_queued", "message": "Waiting in the queue for interpretation.", "evidence": "job", "job": { "status": "queued", "attempt": 1, "maxAttempts": 5, "nextAttemptAt": null } },
    "financialProjection":    { "status": "completed", "code": "ledger_linked", "message": "Transaction recorded in the ledger.", "evidence": "record", "job": null },
    "searchIndexing":         { "status": "pending", "code": "waiting_for_semanticInterpretation", "message": "Search indexing is waiting for interpretation.", "evidence": "dependency", "job": null }
  },
  "derivedAt": "2026-10-24T12:00:00.000Z"
}
```

- `stages.<name>.status` is one of `pending`, `running`, `completed`, `awaiting_review`, `recoverable_failure`, `terminal_failure`, `not_applicable`.
- `code` is stable and safe to branch on or localize. `message` is an English fallback; do not parse it.
- `evidence` says what decided the status: `record` (a produced row), `job` (the newest background job for the stage), `policy` (privacy or processing policy), `dependency` (an upstream stage), `none` (nothing exists yet).
- `job` is present only when a job row informed the stage. `nextAttemptAt` is set only for `retry_scheduled`. Raw job errors (`last_error`) are never exposed.
- `summary.status` is the most severe open stage (`terminal_failure` > `recoverable_failure` > `awaiting_review` > `running` > `pending`); it is `completed` when every applicable stage is done and `not_applicable` when none applies. `partial` is `true` when at least one stage is completed while another is still open.

### Stages and where each status comes from

| Stage | `completed` when | Otherwise |
| --- | --- | --- |
| `classification` | a `classified_events` row exists | newest `classification` job: `queued` → pending, `running` with a live lease → running, `running` with an expired lease → pending (`lease_expired`), `retry_scheduled` → recoverable_failure, `dead_letter`/`cancelled` → terminal_failure. No job: `processing_status = retryable` → recoverable_failure, else pending (`not_scheduled`). A succeeded job with no row stays pending (`awaiting_record`). |
| `semanticInterpretation` | `classified_events.interpretation_status = resolved` | `review` (or `processing_status = review`) → awaiting_review. Pending/retryable/unclassified: newest `semantic_enrichment` job decides as above; with no job, `retryable`/`unclassified` → recoverable_failure, `pending` → pending (`not_scheduled`). Blocked by classification: pending while it is open, terminal_failure if it is (`blocked_by_classification`). `discarded` by the semantic decision → not_applicable. |
| `financialProjection` | a `financial_transaction_events` row links the event to a visible transaction (merged observations follow their canonical transaction) | Linked transaction hidden by the user (`hidden_at`) → not_applicable (`ledger_removed`). Classified and not financial (`expense`/`income`/`transfer`) → not_applicable. Classified as financial but no ledger row → terminal_failure (`ledger_not_derived`). Not classified yet → pending (`waiting_for_classification` for a financial raw kind, `applicability_unknown` otherwise). There is no separate financial job: the ledger row is written inside the classification transaction. |
| `searchIndexing` | a `knowledge_embeddings` row (`object_type = event`) exists at the current embedding version | `discarded` → not_applicable. Newest `embedding` job decides; a succeeded job that stored nothing → not_applicable (`not_indexable`, privacy policy). No job: pending (`not_scheduled`) once interpretation is completed or awaiting review, pending (`waiting_for_semanticInterpretation`) before, terminal_failure (`blocked_by_semanticInterpretation`) if interpretation failed terminally. |

Every stage is `not_applicable` when `processing_allowed = false` (codes `processing_disabled`) or `privacy_status = hidden` (`hidden_event`).

### Precedence rules

1. A produced record always wins over job state: a stage with its record is `completed` even if a later job is running (for example a reprocess). The `job` object still shows the later job.
2. A queued job is never `completed`. `completed` requires the record the stage produces; a job that merely succeeded without it is `pending`/`awaiting_record`.
3. Failures are split by the job: `retry_scheduled` is `recoverable_failure` (more attempts will run), `dead_letter` and `cancelled` are `terminal_failure` (retries exhausted; an operator replay re-queues the job and the stage returns to `pending`).
4. Downstream stages follow an upstream terminal failure with `blocked_by_<stage>` instead of staying `pending` forever.
5. Historical events (captured before the queue existed, or with no job rows) are judged by their records alone. With neither a record nor a job a stage is `pending` with `not_scheduled`, never `completed`.

### More examples

Retry scheduled, attempt 2 of 5 (summary `recoverable_failure`, `"Interpretation failed and will retry."`):

```json
"semanticInterpretation": { "status": "recoverable_failure", "code": "retry_scheduled",
  "message": "Interpretation failed (attempt 2 of 5); a retry is scheduled.", "evidence": "job",
  "job": { "status": "retry_scheduled", "attempt": 2, "maxAttempts": 5, "nextAttemptAt": "2026-10-24T12:05:00.000Z" } }
```

Classification exhausted (summary `terminal_failure`, `"Classification failed."`; interpretation and financialProjection report `blocked_by_classification`):

```json
"classification": { "status": "terminal_failure", "code": "retries_exhausted",
  "message": "Classification failed after 5 attempts and will not retry automatically.", "evidence": "job",
  "job": { "status": "dead_letter", "attempt": 5, "maxAttempts": 5, "nextAttemptAt": null } }
```

Historical, fully processed, no job rows (summary `completed`, `"Expense recorded; processing complete."`): classification `classified`, semanticInterpretation `interpreted`, financialProjection `ledger_linked`, searchIndexing `indexed`, all `evidence: "record"` and `job: null`.

### Stable codes

`classified`, `interpreted`, `ledger_linked`, `indexed`, `job_queued`, `job_running`, `lease_expired`, `retry_scheduled`, `retries_exhausted`, `job_cancelled`, `needs_review`, `not_scheduled`, `awaiting_record`, `retryable_without_job`, `interpretation_retryable`, `interpretation_unresolved`, `waiting_for_classification`, `waiting_for_semanticInterpretation`, `applicability_unknown`, `blocked_by_classification`, `blocked_by_semanticInterpretation`, `ledger_not_derived`, `not_financial`, `ledger_removed`, `not_indexable`, `discarded`, `discarded_by_semantic_decision`, `hidden_event`, `processing_disabled`. Treat unknown codes as their `status`.

### Known limitations

- Events whose `interpretation_status` is still the migration default `pending` but whose `processing_status` is `semantically_resolved` (resolved before the column existed) are reported as interpreted.
- `financial_correlation` jobs are not read by the progress projection; the ledger link itself is the only evidence for `financialProjection`.
- Selective reprocessing runs as a single `event_reprocess` job. `progress` still reports the latest stage-specific job (classification/semantic/embedding) and the produced records; use `GET /events/:id/jobs` to follow the reprocessing execution itself.
- `/capture/*` routes do not return `progress`; use `GET /events/:id` or `POST /events`.

### Consumer notes

- Backward compatibility: clients that ignore `progress` keep working. The mobile app parses it tolerantly (`lib/event-progress.ts`) and renders it in the event detail ("Procesamiento"); the Spanish copy is client side and keyed by `status`, not by `message`.
- Operational note: `background_jobs` and `knowledge_embeddings` are under owner RLS. The progress read runs in the same owner-scoped transaction as the event read, so it has the same visibility as the event itself. Legacy raw events and most enqueued jobs are still written with a null `owner_id`; selective reprocess jobs persist the resolved owner. If `BRAINIA_DB_ENFORCE_RLS=true` is enabled before legacy rows are backfilled, the event detail itself is hidden, and a job hidden from the read would show its stage as `not_scheduled`.

## Event reprocessing

### `POST /api/v1/events/:id/reprocess`

Rebuilds derived knowledge for a stored event.

The endpoint has two modes:

1. **Legacy synchronous mode (preserved).** A request with no `stages` and no `mode: "queued"` runs the previous inline semantic reprocess and returns `200` with the stored event record. Existing clients (including the mobile detail action, which posts `{}`) keep working unchanged.
2. **Queued selective mode.** Sending `stages`, or `mode: "queued"`, validates the selection, queues one fenced `event_reprocess` job, and returns `202` with queryable job identifiers. No expensive reprocessing runs in the HTTP request.

```json
{
  "stages": ["semanticInterpretation", "embeddings"],
  "execution": "coalesce",
  "idempotencyKey": "manual-recovery-2026-10-24-42",
  "mode": "queued"
}
```

| Field | Meaning |
| --- | --- |
| `stages` | Non-empty selection from `classification`, `semanticInterpretation`, `financialCorrelation`, `embeddings`. Duplicates are removed and execution always follows the canonical order. Omit only with `mode: "queued"` to request all stages. |
| `execution` | `coalesce` (default) reuses an active or already-completed equivalent request. `new` intentionally creates a fresh execution after a previous one completed. It never overrides an active execution. |
| `idempotencyKey` | Optional caller key (8-200 characters). In `coalesce` mode, the same key and stage selection always return the same job. A different stage selection with the same key is a `409 reprocess_idempotency_key_conflict`. |
| `mode` | `queued` requests the queue without listing stages (all stages); `legacy` explicitly asks for the synchronous path and therefore rejects `stages`. |

#### Stage prerequisites

| Stage | Job type | Prerequisite |
| --- | --- | --- |
| `classification` | `classification` | stored raw event, `processing_allowed = true`, `privacy_status <> 'hidden'` |
| `semanticInterpretation` | `semantic_enrichment` | a classification record, or `classification` in the same request |
| `financialCorrelation` | `financial_correlation` | a classification record, or `classification` in the same request |
| `embeddings` | `embedding` | a classification record, or `classification` in the same request |

A missing prerequisite rejects the request with `409 reprocess_prerequisites_missing` and is never auto-added, so a selective request does not trigger expensive stages the caller did not ask for:

```json
{
  "error": "reprocess_prerequisites_missing",
  "message": "The requested stages have unmet prerequisites; include the prerequisite stage or run it first",
  "missing": [
    { "stage": "semanticInterpretation", "requires": ["classification"], "reason": "classification_record_missing" }
  ]
}
```

If a prerequisite disappears between acceptance and execution, the worker treats it as a permanent `reprocess_prerequisite_missing` failure and dead-letters the job rather than silently running classification. Classification in the same job always runs first, so including it satisfies the dependency for later stages.

`classification` already materializes the financial projection in its own transaction. When a request includes both `classification` and `financialCorrelation`, the correlation stage is reported as skipped (`satisfied_by_classification`) instead of duplicating that work.

#### Accepted response (`202`)

```json
{
  "accepted": true,
  "eventId": "evt_123",
  "requestedStages": ["semanticInterpretation", "embeddings"],
  "executionStages": ["semanticInterpretation", "embeddings"],
  "disposition": "queued",
  "created": true,
  "coalesced": false,
  "revived": false,
  "job": {
    "id": "job_...",
    "jobType": "event_reprocess",
    "status": "queued",
    "attemptCount": 0,
    "maxAttempts": 5,
    "runAfter": "2026-10-24T12:00:00.000Z",
    "createdAt": "2026-10-24T12:00:00.000Z",
    "idempotencyKey": "reprocess:evt_123:semanticInterpretation+embeddings"
  },
  "jobIds": ["job_..."],
  "stages": [
    { "stage": "semanticInterpretation", "jobId": "job_...", "status": "queued", "prerequisites": ["classification"] },
    { "stage": "embeddings", "jobId": "job_...", "status": "queued", "prerequisites": ["classification"] }
  ],
  "links": {
    "event": "/api/v1/events/evt_123",
    "jobs": "/api/v1/events/evt_123/jobs"
  }
}
```

`disposition` is one of:

| Value | Meaning |
| --- | --- |
| `queued` | A new job was created (`created: true`). |
| `coalesced` | An active job covers the request, or the same coalesced request already exists; its identifiers are returned. |
| `already_completed` | The equivalent coalesced request already succeeded; no new work was queued. Use `execution: "new"` to run it again. |
| `revived` | A previous dead-lettered/cancelled equivalent job was re-queued with its attempt and fence history preserved. |

`executionStages` can be a superset of `requestedStages` when an active job already covers a broader selection. An overlapping but non-covering selection while a job is active returns `409 reprocess_in_progress` with the active job id and its stages; it is never queued in parallel.

#### Coalescing and duplicate prevention

- At most one `event_reprocess` job can be active (`queued`, `running`, `retry_scheduled`) per event.
- Repeated `coalesce` requests return the same job id, including after success. Effects therefore cannot be duplicated by a repeated button press.
- `execution: "new"` is the explicit path for a later intentional execution. If a job is still active, the active job still wins.
- A dead-lettered equivalent job is revived on the next `coalesce` request; attempt and fence history are preserved.
- Job admission is serialized per event with a transaction-scoped advisory lock, so concurrent repeated requests produce one row.

#### Querying jobs

`GET /api/v1/events/:id/jobs` lists the event owner's job history (newest first, up to 50) with `id`, `jobType`, `status`, `attemptCount`, `maxAttempts`, `runAfter`, timestamps, and the requested `stages` for reprocess jobs. Raw job errors are not exposed. `GET /api/v1/events/:id` continues to return the additive `progress` projection for stage-level outcomes.

#### Authorization and preservation

- Both endpoints use the same owner scope and 404 behavior as `GET /api/v1/events/:id`; a caller cannot see or queue work for another owner's event.
- Every stage writes under the job's current fence and live lease. A worker whose lease expired after a newer claim cannot commit classification, semantic, financial, or embedding writes, and its job result is reported as `stale`.
- Classification and semantic stages preserve correction overlays before replacing projections. Financial correlation retains the canonical transaction identity and observation row; reprocessing does not create a second ledger transaction for the same event.

#### Compatibility summary

- `POST {}` / no body: unchanged synchronous `200` response (legacy).
- `POST` with `stages` or `mode: "queued"`: new `202` queue contract.
- `POST /events/:id/reconcile-financial`: unchanged narrow synchronous recovery operation.

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

### `GET /api/v1/graph?projection=taxonomy&depth=1&root=finances`

Returns the progressive category projection used by the mobile knowledge map.
Without `root`, the response starts at all life domains; `root` accepts a stable
taxonomy key and `depth` is clamped to 1-4. Category nodes add `taxonomyKey`,
`parentEntityId`, `breadcrumb`, `childCount`, `evidenceCount`, and `hasMore`.
The existing network projection remains the default for backward compatibility.

Identity and event-evidence exploration remains explicit through the network
projection and `includeEventEvidence=true`; evidence never becomes a category.

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

## Hybrid retrieval

### `GET /api/v1/retrieval/hybrid?q=...`

Returns a reranked 10-30 item evidence package. Optional filters are `source`, `kind`, `from`, `to`, `currency`, `account`, `category`, `limit`, and `includeGraph`. The strategy combines structured filtering, GIN full-text search, versioned embeddings, canonical aliases/merges, a bounded graph neighborhood, recency, confidence, and frequency.

## Processing and quality

- Event responses expose `processingStatus`, `processingStatusReason`, `processingStatusUpdatedAt`, `privacyStatus`, and `processingAllowed`.
- `GET /api/v1/metrics/quality` returns semantic coverage, hierarchy integrity, model-call usage/cost, and job health gates.
- Protected operations routes under `/api/v1/operations/*` list/retry jobs, run a bounded worker, apply retention, and verify a restored backup.

## Proactive insights

`GET /api/v1/cron/daily-insights` is the Vercel Cron target. It requires `Authorization: Bearer ${CRON_SECRET}`, runs deterministic detectors, suppresses duplicate candidates, synthesizes only the highest-ranked evidence, and persists an auditable insight and daily digest when activity is relevant.

## Privacy and feedback

- `GET /api/v1/privacy/export`
- `PUT /api/v1/privacy/sources/:source`
- `PATCH /api/v1/privacy/events/:id`
- `DELETE /api/v1/privacy/events/:id`
- `PATCH /api/v1/privacy/entities/:id`
- `POST /api/v1/knowledge/feedback`

Evidence and derived knowledge can be hidden/deleted independently. Feedback actions are `accept`, `reject`, `merge`, `rename`, and `categorize`; applied decisions are audited and categorization can create a local semantic rule.

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
- hybrid retrieval combines indexed text, versioned embeddings, canonical identity, graph context, and structured filters
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
