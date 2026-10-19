# V2 API implementation scope (2026-10-19)

Status: implementation authorization recorded by the repository owner on 2026-10-19.
This is an engineering scope, not a gate certification or a contract reseal. The
approved wire contract remains `contracts/brain-ai/2.0.0/` (bundle
`da2a989f…621c`). No wire field may be invented here.

## Goal

Serve the published `/api/v2` operations from the existing v1 storage and
processing pipeline, with additive v2 evidence tables where the contract requires
immutable revisions and receipts. `/api/v1` must keep working unchanged.

## Feature gates (do not widen)

- `captureVersions: [1, 2]`
- `observationRevisions: true`
- `decimalFinance: true`
- `email: false`, `activity: false`, `location: false`, `episodes: false`,
  `connectors: false`
- `POST /api/v2/deletions` is **excluded** and must not be registered.
- Email connector authorize/revoke return `403 feature_disabled` while the gate
  is false. The OAuth callback must still be registered and return a safe 302
  redirect with an opaque error marker; it never receives a token.

## Authentication

Add a v2 bearer path without weakening v1:

- `Authorization: Bearer <opaque-token>` resolves to an owner. Accepted token
  sources: `BRAINIA_DEVICE_TOKENS` (`ownerId:token,ownerId2:token2`) and, as the
  single-owner bootstrap, a configured v1 client key mapped to its `clientId`.
- Owner identity always comes from the token, never from a header or body.
- Owner principals receive the published scopes. Global/admin principals must
  not silently borrow a data owner. Missing scope -> `403 insufficient_scope`.
- v1 `x-brainia-client-id` + `x-brainia-api-key` behavior is unchanged.
- Responses set `Cache-Control: no-store` and `X-Request-Id`.

## Storage (one additive migration)

Create `migrations/20261019120000_v2_api.sql` (name may shift if the migration
ledger requires it):

- `v2_observations` — owner, source instance, source observation key, content
  type, latest revision, revision count, stage, timestamps, deleted flag, optional
  `raw_event_id` link. Unique `(owner_id, source_instance_id,
  source_observation_key)`.
- `v2_observation_revisions` — immutable revision per observation with producer
  revision/sequence, delivery UUID, change kind, canonicalization version,
  content fingerprint, source timestamps, content JSONB, optional raw event link.
  Unique delivery per owner; unique producer revision per observation; unique
  `(observation_id, revision_number)`.
- `v2_corrections` — idempotency key per owner, target type/id, expected version,
  field, typed value, scope, rule match, status, version, affected count,
  reprocessing, review reasons.
- `v2_queries` — owner, status, request JSONB, result JSONB, timestamps.
- `v2_export_snapshots` — owner, filters, cursor state, expiry.
- `v2_connectors` — owner, provider, status, version, opaque token reference,
  revoke timestamp. No plaintext token.
- Extend `source_processing_policies` only if the contract fields cannot be
  mapped to existing columns (`external_models_allowed`,
  `external_embeddings_allowed`, `policy_version`, `retention_days`). Prefer
  additive `alter table ... add column if not exists`.
- Enable RLS on every new table and add owner policies/grants consistent with the
  existing B05/B06 pattern.
- Backfill one immutable revision per legacy `raw_events` row, idempotently.
  Never invent historical revisions; preserve the raw content and timestamps.

Do not drop, rename, or rewrite existing tables or data.

## Operations

Implement all published paths in `contracts/brain-ai/2.0.0/openapi.json`:

1. `GET /api/v2/capabilities`
2. `POST /api/v2/observations`
3. `POST /api/v2/observations/batch`
4. `GET /api/v2/observations/{id}`
5. `GET /api/v2/observations/{id}/revisions`
6. `GET /api/v2/events/{id}`
7. `GET /api/v2/episodes`
8. `GET /api/v2/episodes/{id}`
9. `GET /api/v2/financial/transactions`
10. `GET /api/v2/financial/summary`
11. `POST /api/v2/corrections`
12. `PUT /api/v2/sources/{id}/policy`
13. `GET /api/v2/deletions/{id}`
14. `GET /api/v2/export`
15. `POST /api/v2/queries`
16. `GET /api/v2/queries/{id}`
17. `POST /api/v2/connectors/email/authorize`
18. `GET /api/v2/connectors/email/callback`
19. `POST /api/v2/connectors/{id}/revoke`

`/api/v2/deletions` (POST) is intentionally absent.

### Capture semantics

- Strict per-type content validation, UTF-8 byte limits, batch 1..100 and
  <=1 MiB, item <=64 KiB, title <=1 KiB, body <=48 KiB.
- `jcs-sha256-v1` fingerprint over exactly
  `{changeKind,content,sourceOccurredAt,sourceUpdatedAt}`; reject a mismatch
  with 422.
- Exact delivery replay returns the same 200 receipt; a new delivery for the
  same producer revision returns a duplicate receipt; conflicting content under
  a reused delivery/revision identity returns 409. Never discard a revision.
- v2 capture must enter the existing classification/job pipeline. A stored
  receipt is durable even if downstream processing fails.
- Batch is per-item transactional and returns ordered results.

### Read semantics

- Owner scoping is mandatory; foreign IDs return 404.
- Decimal money is JSON text, never a float. Currency status is explicit.
- Page size defaults to 50, max 100; cursors are opaque, owner-bound, exclusive.
- Episodes return an empty page / 404 while the `episodes` gate is false.
- Export is snapshot-bound and audit-logged. Expired cursor -> 409
  `export_snapshot_expired`.
- Queries are grounded, owner-scoped, evidence-only when synthesis is not
  configured. Never fabricate claims or citations. `externalSynthesisAllowed`
  defaults to false and must never upload source text without an explicit
  configured provider.
- Corrections enforce allowlisted fields, expected versions, idempotency, and
  owner checks. Broad rule changes return `review`.

## Error envelope

All v2 errors use:

```json
{"error":{"code":"invalid_request","message":"…","requestId":"…","retryable":false,"details":{}}}
```

Common codes are limited to the approved contract enum: `invalid_request` 400,
`unauthenticated` 401, `forbidden` 403, `not_found` 404, `identity_conflict` 409,
`payload_too_large` 413, `unsupported_contract` / `fingerprint_mismatch` 422,
`rate_limited` 429, `unavailable` 503. Insufficient scope and disabled features
must use `forbidden` with an explanatory message; do not add new error codes.
Details must not contain source content or secrets.

## File ownership (V2 core worker)

- `migrations/20261019120000_v2_api.sql`
- `src/domain/v2/**`
- `src/storage/v2/**`
- `src/routes/v2/**`
- `src/auth.ts` (bearer only; preserve v1 behavior)
- `src/app.ts` (register v2 only)
- `tests/v2-api*.test.ts`
- `docs/reports/v2/B13-B17-r1.md`

No mobile files, no contract bundle bytes, no production database, no deploy.

## Acceptance

- `npm run lint` and `npm run build` exit 0.
- `npm run test:isolated` passes with added v2 tests.
- New tests cover: bearer owner resolution, cross-owner 404, fingerprint
  mismatch, exact replay, duplicate revision, conflicting identity, batch
  partial success, observation/revision read, finance decimal shape, correction
  version conflict, export cursor, query owner scope, policy version, connector
  feature gate, and absence of `POST /api/v2/deletions`.
- `npm run contracts:verify` still exits 0.
- The v1 suite remains green.
- Report exact commands, counts and residual limitations. Do not claim a gate.

## Rollback

The migration is additive. Disable v2 registration in `src/app.ts` to stop
serving it; existing v1 routes and tables remain untouched. New v2 tables may
remain without affecting v1.
