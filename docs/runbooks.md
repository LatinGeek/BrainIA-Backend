# Runbooks

This file collects the operational procedures for the current backend phase.

## 1. Importing data

Use this flow when a new client, adapter, or source starts sending events:

1. confirm the payload matches the event contract in `docs/api.md`
2. verify `source`, `id`, and `contractVersion`
3. add an `idempotencyKey` when the source can retry
4. ingest a small sample batch
5. inspect `GET /api/v1/metrics`
6. inspect `GET /api/v1/search?q=...`
7. inspect `GET /api/v1/agent/inspect?q=...`

If the sample batch produces duplicate or low-quality entities, adjust the source normalization before increasing volume.

## 2. Reprocessing

Use event reprocessing when the stored raw event is correct but the derived knowledge is stale.

Procedure:

1. confirm the raw event still looks valid
2. call `POST /api/v1/events/:id/reprocess`
3. inspect the regenerated entities and relations
4. compare the before and after output if the event was previously misclassified

Reprocessing is transactional and rebuilds the derived knowledge for a single stored event.

## 3. Recovery

Use recovery when a derived write fails or a source sends malformed data.

Current behavior:

- raw events remain the source of truth
- derived writes are transactionally coupled to ingest
- a failed ingest does not partially persist derived state
- a failed derived classification can be retried through the normal ingest or reprocess path
- request IDs are echoed back in responses to help correlate logs

Practical steps:

1. identify the request by `x-request-id`
2. inspect the application logs for the failing route
3. fix the source payload or heuristic
4. retry ingestion
5. reprocess existing raw events when the fix affects derived interpretation

## 4. Slow requests

Requests slower than roughly one second are logged as warnings.

If a route becomes slow:

1. identify the slow request through its request ID
2. inspect the route-specific logs
3. determine whether the bottleneck is the database, the classifier, or graph expansion
4. add caching or projection only after the repeated slow path is confirmed

## 5. Backups and retention

The long-term production target includes backups and retention rules, but those are not yet automated in this prototype.

Until automation exists:

- keep Postgres backups outside the app
- treat raw events as immutable
- avoid deleting source records when changing heuristics
