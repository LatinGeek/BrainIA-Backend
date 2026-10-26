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
2. choose only the stages that are stale and call `POST /api/v1/events/:id/reprocess` with `{ "stages": [...] }`
3. use the returned job id with `GET /api/v1/events/:id/jobs` (or the event's `progress`) to follow the execution
4. inspect the regenerated entities and relations
5. compare the before and after output if the event was previously misclassified

Queued selective reprocessing is transactional at stage level and rebuilds only the requested derived knowledge for a single stored event. A bodyless call still runs the legacy synchronous full reprocess.

Repeated requests with the same stage selection coalesce into the active or completed job. Send `execution: "new"` only when a later execution is intentionally required after the previous one completed.

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

## 6. Cleaning test data

Use the cleanup script when smoke runs or endpoint tests leave rows behind in Postgres.

Procedure:

1. run a dry-run first with `npm run cleanup:test-data -- --preset smoke`
2. review the matched counts in the JSON output
3. if the scope looks correct, rerun with `--apply`
4. add `--prune-orphans` only when you want to remove now-unused `relations` and `entities`
5. when cleaning a custom test batch, combine filters such as `--tag test`, `--source-prefix endpoint-`, `--id-prefix smoke_`, or a time window
6. pass `--include-runs` only when you also provide explicit run filters such as `--tool`, `--since`, `--before`, or `--contains`
7. the cleanup flow also removes `financial_transactions` and `financial_transaction_events` for the selected scope
8. if you need a total reset of the app data in a non-production or explicitly approved production scenario, use `npm run cleanup:test-data -- --full-purge --apply`

Examples:

```bash
npm run cleanup:test-data -- --preset smoke
npm run cleanup:test-data -- --preset smoke --apply
npm run cleanup:test-data -- --tag test --source-prefix endpoint- --since 2026-07-13T00:00:00.000Z --apply
```

The script refuses to run without filters and stays in dry-run mode unless `--apply` is present.
Audit rows in `insight_runs` and `digest_runs` are only touched when `--include-runs` is passed together with explicit run filters.

## 7. Evidence-policy historical generations

Use a separate versioned generation for a full historical reprocess. Staging is
read-only with respect to the live graph; activation is the only mutating step.

```bash
export BRAINIA_EVIDENCE_POLICY=enforce
npm run reprocess:generations -- create --label "evidence v1"
npm run reprocess:generations -- stage --generation <id> --batch 100 --concurrency 8
npm run reprocess:generations -- compare --generation <id>
# Capture a rollback baseline immediately before activation.
npm run reprocess:generations -- baseline --label "pre-evidence baseline"
npm run reprocess:generations -- activate --generation <id> --batch 25
npm run reprocess:generations -- rollback
```

Before activation:

1. confirm every critical safety fixture passes;
2. confirm held-out precision is at least 95% and assignment recall at least 90%;
3. keep the financial regression suite green;
4. review the comparison report in `output/evidence-generation-<id>.md`;
5. confirm the active generation control is the one you intend to expose.

Activation pauses on events with human-approved semantic decisions and marks
them `human_semantic_decision_preserved` instead of overwriting them. The
previous generation remains available for `rollback`.

