# B06 independent verification (principal-bound authorization + RLS foundation)

Verifier: independent subagent (not the implementer).
Repository: `D:/Coding/BrainIA/BrainIA-Backend`.
Branch: `main`. HEAD: `b71c4cc82ca0faa636db656c729e79cb906a9114`. Tree: dirty.
Date: 2026-10-17.
Inputs: B06 specification (lines 283-314), `docs/reports/v2/B06-r1.md`, `docs/reports/v2/B06-r2.md`, `docs/reports/v2/B06-r3.md`, `src/auth.ts`, `src/app.ts`, changed routes/storage, migrations `20261017100000_owner_identity.sql` / `20261017110000_owner_rls.sql` / `20261017120000_owner_runs.sql`, `tests/v2-authorization.test.ts`, `docs/reports/v2/snapshot-backend.json`.

**THIRD-PASS VERDICT (2026-10-17): ACCEPTED-WITH-CONDITIONS.**

Reason: N1–N4 are fixed in source and independently reproduced as clean. `GET /digests` excludes every owner-B event/insight/relation/fact marker; `GET /insights?q=<owner-B entity>` returns no B match (and no B id), while own-id and public-taxonomy resolution still work; foreign `rename`/`reject` feedback returns 404 with unchanged rows and no feedback entry, while own-target feedback succeeds; manual/pending creation with owner B's `accountId` returns 404 with no row, no balance change, and no foreign account reference, while own-account creation succeeds and persists `owner_id`. The legacy null-owner account/pending rows are invisible and immutable to both scoped owners; only truly unscoped local/test mode still sees them. The full prior clean matrix and auth/RLS probes also pass. Remaining conditions are listed at the end: RLS not wired into routes, ownerless cron/empty-body digest writers, public-taxonomy mutability by design, real-PostgreSQL evidence still BLOCKED, and E06/E11 still BLOCKED (270 cases).

Historical verdicts retained: **second pass REJECTED** for N1–N4 (all now remediated); **first pass REJECTED** for the original eleven defects (all remediated in r2). Detailed evidence for each pass remains in the sections below.

Original first-pass verdict text: a reproducible cross-owner data leak and a reproducible cross-owner mutation were found. With valid owner-a credentials, owner-b data is returned by multiple endpoints, and owner-a can merge owner-b's financial transaction into its own ledger and can mutate owner-b's entity visibility and review queue. Exact requests/outputs are in probes D/E below. The B06-r1 report is honest that several surfaces are unscoped, but it also overstates coverage for `/retrieval/hybrid`, `/privacy/export`, and financial mutation pre-checks, and it misses several unscoped endpoints. The task's own acceptance criteria are therefore not met.

## Acceptance table

| B06 acceptance criterion | Result | Evidence |
|---|---|---|
| Attach server-resolved principal/scopes | PASS | `request.principal` set by hook; client/global/cron modes; probes A/B/C. |
| Reject spoofed owner/client headers and deployed anonymous/global access | PASS for owner identity | Owner headers always 403 when auth enabled; global key is ownerless and gets 403 `owner_scope_required`; required-auth fail-closed. No owner-identity bypass found. |
| Inventory and scope every read/write/export/correction/finance/graph/admin route, including every retrieval and embedding branch | **FAIL** | Hybrid retrieval leaks entities/relations/insights/digests; export leaks insight/digest runs; graph, metrics, resolve, alias/review, insight/digest history, privacy entity mutation remain unscoped. See matrix. |
| Apply owner/source/visibility eligibility before limits | **FAIL/PARTIAL** | Events, FTS search and financial list do; hybrid non-event branches, graph and aggregates do not. |
| Complete two-owner endpoint/query matrix including FTS/vector/graph/artifacts | **FAIL** | FTS events and financial isolate; vector/text hybrid leaks; graph leaks; insight/digest artifacts leak. |
| Enforce restricted DB role and transaction-local owner with RLS | **PASS as isolated foundation, FAIL as deployed authorization** | `withOwnerTransaction(..., {enforceRls:true})` works in PGlite, but it is not used by any route (only defined in `src/storage/postgres.ts`). |
| Foreign IDs inaccessible | **FAIL** | `GET /entities/:ownerBId/graph` and `GET /entities/resolve?id=ownerBId` return B rows; B transactions can be merged by A. |
| Pooled owner context never leaks | PASS in isolated test | Owner setting empty after transaction; B insert under A rejected. |
| Exact cron/admin credential scopes enforced | **FAIL (conditional)** | Any `/api` URL containing `/cron/` (including `?x=/cron/`) with `Authorization: Bearer CRON_SECRET` receives the `cron` principal; unscoped routes then run with that jobs credential. |

## Command table (executed by verifier)

| Command | Exit | Observed output |
|---|---:|---|
| `npm run lint` | 0 | `tsc -p tsconfig.json --noEmit`, no diagnostics. |
| `npm run build` | 0 | `tsc -p tsconfig.json`, no diagnostics. |
| `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-authorization.test.ts` | 0 | `tests 4 / pass 4 / fail 0` (all four subtests ok). |
| `npm run test:isolated` | 0 | `tests 128 / pass 128 / fail 0 / skipped 0`. |
| `NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs' npm run schema:verify -- --read-only` | 0 | `{"ok":true,"readOnly":true,"problems":[]}`. |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | All 17 PASS lines: 45 migrations / 1709 catalog objects; reconciliation, ACL, drift, nonowner role, partial-ledger and idempotency checks pass. |
| `npm run contracts:verify` | 0 | `PASS 382 contract checks; 58 positive/negative schema+semantic fixtures; 7 identity sequences.` Bundle SHA-256 `312c92f8...abad6`. |
| `npm run test:v2 -- --suite E06,E11` | 2 | `E06: BLOCKED; 180 blocked of 180`; `E11: BLOCKED; 90 blocked of 90`; 0 pass / 0 fail. Expected BLOCKED. |

No production database, dependency install, commit, or source/test/migration edits were made. The only repository file created by this verification is this report. Probe scripts were executed through stdin.

## Probe A - fail-closed required auth

Configuration: `BRAINIA_REQUIRE_AUTH=true`, `buildApp({authConfig:{globalApiKey:null,clientKeys:new Map()}})`.

| Request | Status | Body error |
|---|---:|---|
| `GET /api/v1/events` | 503 | `auth_not_configured` |
| `GET /api/v1/search?q=x` | 503 | `auth_not_configured` |
| `GET /api/v1/financial/transactions` | 503 | `auth_not_configured` |
| `GET /api/v1/entities` | 503 | `auth_not_configured` |
| `GET /api/v1/relations` | 503 | `auth_not_configured` |
| `GET /api/v1/privacy/export` | 503 | `auth_not_configured` |
| `GET /api/v1/insights?limit=1` | 503 | `auth_not_configured` |
| `GET /api/v1/intelligence/artifacts` | 503 | `auth_not_configured` |
| `GET /api/v1/metrics` | 503 | `auth_not_configured` |
| `GET /api/v1/graph` | 503 | `auth_not_configured` |
| `GET /api/v1/aliases` | 503 | `auth_not_configured` |
| `GET /api/v1/review/aliases` | 503 | `auth_not_configured` |
| `GET /api/v1/entities/resolve?q=x` | 503 | `auth_not_configured` |
| `GET /api/v1/digests/history` | 503 | `auth_not_configured` |
| `GET /health` | 200 | `{"ok":true}` |

Conclusion: PASS for every sampled `/api` route and for `/health`.

## Probe B - owner/header spoofing

Starting from valid owner-a client-key headers, each variant requested `GET /api/v1/events`:

| Variant | Status | Leak of owner-b event | Body |
|---|---:|---|---|
| `x-brainia-owner-id: owner-b` | 403 | no | `owner_header_not_accepted` |
| `x-owner-id: owner-b` | 403 | no | `owner_header_not_accepted` |
| `x-brainia-owner-id: [owner-b]` (array) | 403 | no | `owner_header_not_accepted` |
| `X-Brainia-Owner-Id: owner-b` | 403 | no | `owner_header_not_accepted` |
| `x-client-id: owner-b` | 200 | no | owner-a list only |
| `x-api-key: key-b` | 200 | no | owner-a list only |
| `X-Owner-Id + x-client-id` | 403 | no | `owner_header_not_accepted` |

Conclusion: no header spoofing bypass found. Only the documented credential headers are honored; mixed-case and array owner headers are still rejected.

## Probe C - global key

Global-key app (`globalApiKey`, no client keys):

| Request | Status | Leak | Body |
|---|---:|---|---|
| `x-brainia-api-key: global-secret` | 403 | no | `owner_scope_required` |
| global key + `x-brainia-owner-id: owner-a` | 403 | no | `owner_header_not_accepted` |
| global key + `x-brainia-client-id: owner-a` | 403 | no | `owner_scope_required` |
| wrong global key | 401 | no | `invalid_api_key` |

Conclusion: global key cannot read owner data and cannot be combined with an owner/client header to impersonate. PASS.

## Probe D - two-owner endpoint matrix

Fixture: owners A/B with `raw_events` (unique text markers), entities, relations, financial accounts/transactions, pending transaction, alias, review queue item, intelligence artifact, insight run, digest run, and embeddings. All tests used valid A credentials against B-owned IDs.

| Endpoint (as A, targeting B) | A sees B data? | Status | Evidence |
|---|---|---:|---|
| `GET /events` | no | 200 | only A events |
| `GET /events/:B` | no | 404 | `event_not_found` |
| `GET /search?q=Bmarker` | no | 200 | events/entities/relations empty |
| `GET /retrieval/hybrid?q=Bmarker` | **YES** | 200 | see below |
| `GET /financial/transactions` | no | 200 | only A transaction |
| `GET /financial/transactions/:B` | no | 404 | `financial_transaction_not_found` |
| `GET /financial/accounts` | no for B-owned row | 200 | only A account |
| `GET /financial/pending-transactions` | no for B-owned row | 200 | empty for A |
| `GET /entities` | no | 200 | only A entity + public taxonomy |
| `GET /relations` | no | 200 | only A relation |
| `GET /privacy/export` | **YES (insight/digest)** | 200 | see probe D2 |
| `GET /insights?limit=10` | **YES** | 200 | B insight summary returned |
| `GET /insights/history?limit=10` | **YES** | 200 | B insight returned |
| `GET /insights/history/:B` | **YES** | 200 | B insight returned |
| `GET /digests/history?limit=10` | **YES** | 200 | B digest returned |
| `GET /digests/history/:B` | **YES** | 200 | B digest returned |
| `GET /intelligence/artifacts` | no | 200 | empty for A |
| `GET /intelligence/artifacts/:B` | no | 404 | `not_found` |
| `GET /entities/:B/graph` | **YES** | 200 | `rootEntity.value = "BravoMerchantB"` |
| `GET /graph?projection=taxonomy` | public taxonomy only in probe | 200 | empty taxonomy fixture; explore mode not owner-scoped by code |
| `GET /metrics` | **YES (aggregate)** | 200 | `rawEventsCount:2, entitiesCount:2, relationsCount:1, financialTransactionsCount:2` |
| `GET /metrics/quality` | **YES (aggregate)** | 200 | `totalEvents:2, invalidHierarchyRelations:1` |
| `GET /entities/resolve?id=:B` | **YES** | 200 | returns `BravoMerchantB` |
| `GET /aliases?entityId=:B` | **YES** | 200 | returns `BravoAliasB` |
| `GET /review/aliases?status=pending` | **YES** | 200 | returns `BravoReviewB` |

### D1 - hybrid retrieval leak (most important)

With A credentials, querying B's text returns B's entity/relation/insight/digest rows:

```
GET /api/v1/retrieval/hybrid?q=BravoHybridEntityB&limit=30   -> 200 count=1 objectTypes=["entity"]  title "BravoHybridEntityB"
GET /api/v1/retrieval/hybrid?q=BravoHybridRelationB&limit=30 -> 200 count=2 objectTypes=["entity","relation"] titles ["BravoHybridEntityB","BravoHybridRelationB"]
GET /api/v1/retrieval/hybrid?q=BravoHybridInsightB&limit=30  -> 200 count=1 objectTypes=["insight"]  title "BravoHybridInsightB"
GET /api/v1/retrieval/hybrid?q=BravoHybridDigestB&limit=30   -> 200 count=1 objectTypes=["digest"]   title "BravoHybridDigestB"
```

Cause: in `src/storage/hybrid-retrieval.ts`, only the event and fact branches apply `client_id`; the entity, relation, insight and digest branches do not. Insight/digest tables also have no owner column. The vector branch explicitly admits `client_id is null`; a null-owner embedding for B's entity/insight was returned to A:

```
GET /retrieval/hybrid?q=BravoNullOwnerEmbeddingB        -> 200 objectType entity title "BravoNullEmbeddingB"
GET /retrieval/hybrid?q=BravoNullOwnerInsightEmbeddingB -> 200 objectType insight title "BravoNullInsightEmbeddingB"
knowledge_embeddings rows: (entity, entity_b_..., client_id=NULL), (insight, insight_b_..., client_id=NULL)
```

This directly contradicts B06-r1's claim that `/retrieval/hybrid` filters events, entities and relations by owner.

### D2 - privacy export leak

`GET /api/v1/privacy/export` as A returned B's insight and digest rows in full:

```
data.insights: [{ id:"insight_b_7d47443a", query:"ExportLeakInsightB", summary:"ExportLeakInsightSummaryB", ... }]
data.digests:  [{ id:"digest_b_714a1287", scope:"ExportLeakDigestB", summary:"ExportLeakDigestSummaryB", ... }]
```

Cause: `src/storage/data-controls.ts` filters events/facts/entities/relations/feedback/policies, but runs `select * from insight_runs` and `select * from digest_runs` with no filter. B06-r1 lists `/privacy/*` as owner-scoped; that is false for the export payload.

## Probe E - mutation isolation

| Attempt as A | Status | Row change / result |
|---|---:|---|
| `PATCH /financial/transactions/:B` | 404 | no change |
| `DELETE /financial/transactions/:B` | 404 | no change |
| `PATCH /financial/accounts/:B` | 404 | no change |
| `DELETE /financial/accounts/:B` | 404 | no change |
| `PATCH /financial/pending-transactions/:B` | 404 | no change |
| `DELETE /financial/pending-transactions/:B` | 404 | no change |
| `POST /financial/transactions/:A/merge {"duplicateId":":B"}` | **200** | **B transaction hidden and merged into A** |
| `PATCH /privacy/entities/:B {"visibility":"hidden"}` | **200** | **B entity visibility changed to hidden** |
| `POST /review/aliases/:B/resolve {"alias":"HijackedAliasByA"}` | **200** | **B review resolved; alias created** |
| `POST /entities/:B/merge {"canonicalEntityId":":A"}` | 404 | DB `relation_owner_mismatch` rejected the cross-owner same_as relation; route itself has no owner check |
| `POST /financial/accounts` as A | 201 | created row has `owner_id = NULL`; visible to B |
| `POST /financial/pending-transactions` as A | 201 | created row has `owner_id = NULL`; visible and patchable by B |

Evidence for the financial merge (reproducible):

```
POST /api/v1/financial/transactions/txn_a_4611f8f9/merge
body {"duplicateId":"txn_b_c6bb720c"}
response 200 {"id":"txn_a_4611f8f9", ...}

DB after: txn_b_c6bb720c -> {"hidden_at":"2026-10-17T20:08:37.587Z",
                            "merged_into_transaction_id":"txn_a_4611f8f9"}
```

Evidence for the ownerless write (reproducible):

```
POST /financial/accounts as A -> 201, financial_accounts.owner_id = NULL
GET  /financial/accounts as B -> includes account_fd0a821e-...
PATCH /financial/accounts/account_fd0a821e-... as B -> 200 (renamed)
POST /financial/pending-transactions as A -> 201, owner_id = NULL
GET  /financial/pending-transactions as B -> includes pending_financial_dd6b13d1-...
PATCH /financial/pending-transactions/pending_financial_dd6b13d1-... as B -> 200
```

The ownerless behavior comes from `accountOwnedBy`/`pendingOwnedBy` and the list queries accepting `owner_id is null`, combined with create functions that never write `owner_id`.

## Probe F - RLS foundation

Using `withOwnerTransaction(ownerA, ..., {enforceRls:true})` against the migrated PGlite schema:

| Check | Actual output |
|---|---|
| Owner A sees only A rows | `hasA=true, hasB=false, count=1` |
| Insert B row under A | rejected: `new row violates row-level security policy for table "raw_events"` |
| Public taxonomy readable | `publicTaxonomyReadable=true` (domain row with `owner_id NULL`) |
| Owner cannot own public taxonomy | rejected: `public_taxonomy_cannot_be_owned` |
| Owner setting after transaction | `current_setting('brainia.owner_id', true) = ""` (no pooled leak) |
| Legacy pool outside the scoped transaction | sees all rows (`legacyPoolSeesRows=2`) |

Conclusion: RLS helper and policies work in isolation. However `withOwnerTransaction` has no call sites outside its definition; routes keep using `pool` with the table-owner role, so RLS is not part of the deployed request path. The B05 `NOT VALID` ownership FKs also remain unvalidated.

## Probe G - auth bypass and scope attribution

| Scenario | Status | Result |
|---|---:|---|
| `GET /api/v1/events` with CRON bearer, no `/cron/` in URL, required-unconfigured | 503 | `auth_not_configured` |
| `GET /api/v1/cron/daily-insights` with CRON bearer | 200 | cron route runs (expected) |
| `GET /api/v1/metrics?x=/cron/` with CRON bearer, no API credentials | **200** | **cron principal reaches an unscoped non-cron route** |
| `POST /api/v1/aliases?x=/cron/` with CRON bearer | **409** | reached handler; failed only because the entity was absent, not because of scope |
| `GET /api/v1/metrics?x=/cron/` with wrong CRON bearer | 503 | `auth_not_configured` |
| Required auth + configured credentials, client-id header only | 401 | `invalid_api_key`; disabled branch not used |
| `POST /events` body with `clientId/ownerId/owner_id = owner-b` | 201 | stored `client_id=owner-a, owner_id=NULL`; body cannot select owner |

No owner-identity bypass was found. The cron finding is a credential-scope confusion: the check is `url.includes("/cron/")`, so a query parameter can trigger the cron principal on an arbitrary `/api` route, and unscoped routes never call `requireScope("jobs")`. The disabled (`mode: "disabled"`) branch is unreachable when auth is required because the hook returns 503 before `resolveAuthContext`.

## Endpoint leak matrix (summary)

| Surface | Scoped? | Leak / mutation found |
|---|---|---|
| `/events`, `/events/:id`, reprocess, reconcile | yes | none |
| `/search` (FTS events/entities/relations) | yes | none |
| `/retrieval/hybrid` | **partial** | **entities, relations, insights, digests, null-owner embeddings** |
| `/financial/transactions` (list/detail/patch/delete/false-positive) | yes | none for B-owned rows |
| `/financial/accounts` (list/patch/delete/adjustments) | list yes, writes unsafe | ownerless created accounts visible/mutable across owners |
| `/financial/pending-transactions` | list yes, writes unsafe | ownerless created pending rows visible/mutable across owners |
| `/financial/transactions/:id/merge` | **no duplicate check** | **A can hide/merge B transaction** |
| `/entities`, `/relations` | yes | none |
| `/entities/:id/graph`, `/graph` | **no** | **B entity/relationship graph returned** |
| `/entities/resolve` | **no** | **B entity returned** |
| `/aliases`, `/review/aliases`, resolve/ignore | **no** | **B alias/review returned; B review mutated** |
| `/entities/:id/merge` | **no route check** | cross-owner merge blocked by DB trigger in probe, not by authorization |
| `/privacy/export` | **partial** | **all insight_runs + digest_runs exported** |
| `/privacy/events/:id` | yes | none |
| `/privacy/entities/:id` | **no** | **B entity visibility mutated** |
| `/insights`, `/insights/history`, `/insights/history/:id` | **no** | **B insight runs returned** |
| `/digests/history`, `/digests/history/:id` | **no** | **B digest runs returned** |
| `/intelligence/artifacts` (list/detail/mutations) | yes | none |
| `/metrics`, `/metrics/quality` | **no** | **global counts** |
| `/semantic/*`, `/knowledge/*` | yes per code | not exhaustively probed |
| `/operations/*`, `/cron/*` | separate token/secret | cron scope issue above |

## Scope attribution against `snapshot-backend.json`

Snapshot baseline: `ea41cb12...cb444`, captured 2026-10-17T18:18:16Z. Changed paths since the snapshot (excluding `graphify-out/`) were computed by SHA-256. Some of these changes belong to B04/B05 work that also happened after the snapshot; attribution to B06 alone is not proven.

Changed (32):

```
contracts/schema/manifest.json
contracts/schema/verify.test.mjs
docs/reports/v2/approvals.json
package.json
src/app.ts
src/auth.ts
src/routes/agent-inspect.ts
src/routes/capture.ts
src/routes/client-diagnostics.ts
src/routes/entity-semantic-profile.ts
src/routes/events.ts
src/routes/financial-transactions.ts
src/routes/insights.ts
src/routes/intelligence.ts
src/routes/knowledge.ts
src/routes/privacy.ts
src/routes/search.ts
src/routes/semantic.ts
src/storage/agent-inspect.ts
src/storage/entity-repository.ts
src/storage/event-repository.ts
src/storage/event-store.ts
src/storage/financial-transaction-repository.ts
src/storage/insights.ts
src/storage/knowledge-fact-repository.ts
src/storage/postgres.ts
src/storage/relation-repository.ts
src/storage/search-repository.ts
src/storage/semantic-repository.ts
src/storage/semantic-resolver.ts
tests/v2-harness/artifacts/latest.json
tests/v2-projections.test.ts
```

Added since snapshot (business paths, excluding generated harness logs):

```
docs/reports/v2/B04-r2.md, B04-verification-r2.md, B05-r1.md, B05-r2.md, B05-verification.md,
B06-r1.md, baseline-snapshot.md, execution-status.md, G1-decision-package.md,
snapshot-backend.json, snapshot-mobile.json
migrations/20261017100000_owner_identity.sql
migrations/20261017110000_owner_rls.sql
src/scripts/backfill-ownership.ts
src/storage/ownership.ts
tests/v2-authorization.test.ts
tests/v2-ownership.test.ts
tests/v2-harness/artifacts/*.json|*.log
```

Paths outside B06's declared reservation (not `src/auth.ts`, `src/app.ts`, `src/routes/`, `src/storage/*repository.ts`, `data-controls.ts`, `intelligence.ts`, `postgres.ts`, `hybrid-retrieval.ts`, `embeddings.ts`):

- `src/storage/agent-inspect.ts`
- `src/storage/event-store.ts`
- `src/storage/insights.ts`
- `src/storage/semantic-resolver.ts`
- `contracts/schema/verify.test.mjs`
- `package.json` (scripts/dependency changes)
- `docs/reports/v2/approvals.json`
- `tests/v2-projections.test.ts`
- `tests/v2-harness/artifacts/latest.json`

`B06-r1.md` also under-reports its changed files: it omits `src/storage/knowledge-fact-repository.ts`, `src/storage/semantic-repository.ts`, `src/storage/semantic-resolver.ts`, `src/storage/event-store.ts` (partially), `src/storage/agent-inspect.ts`, and `src/storage/insights.ts` even though they differ from the snapshot. `contracts/schema/verify.test.mjs` and `package.json` changes are also not in the report's file list.

## B06-r1 "PARTIAL" claims - accuracy

| B06-r1 claim | Verifier finding |
|---|---|
| Events, search, financial reads/mutations scoped | Mostly true; financial **merge duplicate** is not ownership-checked and create endpoints lose owner. |
| `/retrieval/hybrid` scoped (events, entities, relations filtered by owner) | **False.** Event branch is scoped; entity/relation/insight/digest and null-owner embedding branches leak. |
| `/privacy/*` owner-scoped | **False for export** (insights/digests global) and **false for `PATCH /privacy/entities/:id`**. |
| Graph traversal/taxonomy not yet scoped | True; verified `/entities/:id/graph` leaks. |
| Metrics aggregates not yet scoped | True; verified global counts. |
| Digest/insight history not yet scoped | True; verified list/detail leaks. |
| Alias/review/merge not yet scoped | True for alias/review reads and resolve. Entity merge has no route check but DB trigger blocked the cross-owner probe. |
| Embedding maintenance branches not scoped | True; null-owner embeddings leak through hybrid vector matching. |
| Export-by-entity internals listed as not scoped | True, plus a larger export leak: insight/digest runs. |
| "Removed every direct request.headers[x-brainia-client-id] trust" | True in route code; no raw client-id trust found. |
| RLS foundation only, routes not wired | True and confirmed: no `withOwnerTransaction` call sites. |

Additional unscoped surfaces missed by B06-r1: `/entities/resolve`, `PATCH /privacy/entities/:id`, financial merge duplicate check, ownerless financial writes, aggregate metrics in `/metrics/quality`, and cron scope via `/cron/` substring.

## Confirmed defects

1. **Hybrid retrieval cross-owner read leak** - entities, relations, insight runs and digest runs are returned without owner/client predicates; null-owner embeddings are globally searchable. Reproducible with exact requests above.
2. **Privacy export cross-owner read leak** - all `insight_runs` and `digest_runs` returned regardless of owner.
3. **Insight/digest history endpoints unscoped** - list and by-id return other owners' runs.
4. **Entity graph unscoped** - `GET /entities/:B/graph` returns B's entity graph.
5. **Entity resolve unscoped** - `GET /entities/resolve?id=:B` returns B's entity.
6. **Alias/review read and mutation unscoped** - aliases and review queue list B rows; A resolved B's pending review with A-selected alias.
7. **Privacy entity mutation unscoped** - A changed B entity visibility to hidden (200).
8. **Financial merge duplicate bypass** - A hid/merged B's transaction into A's transaction (200); only the canonical ID is ownership-checked.
9. **Ownerless writes** - financial account/pending create functions write `owner_id = NULL`; list/mutation helpers accept `owner_id IS NULL`, so rows are shared across owners. Raw event/entity/relation writes also do not set `owner_id` (verified: POST /events stored `owner_id = NULL`), so the RLS foundation does not cover new application writes.
10. **Metrics aggregate leak** - `/metrics` and `/metrics/quality` return global counts.
11. **Cron credential scope confusion** - `url.includes("/cron/")` allows a cron bearer to reach arbitrary `/api` routes, including via `?x=/cron/`; unscoped routes never enforce `jobs` scope.

## Conditional risks

- Disabled auth mode trusts caller-supplied `x-brainia-client-id` when auth is not configured and not required. Defaults protect production (`NODE_ENV=production` or `VERCEL=1`), but an explicit `BRAINIA_REQUIRE_AUTH=false` in a deployed environment would allow anonymous owner selection.
- RLS is not wired into routes. If `withOwnerTransaction` were enabled without fixing owner_id writes, owners could lose visibility of their own newly created rows (all new rows have `owner_id NULL`).
- `NOT VALID` ownership FKs from B05 remain unvalidated.
- Operation endpoints use a separate token and were not exhaustively tested; they can expose all owners once authorized by design.

## Unverified assumptions / limitations

- PGlite is in-memory and not a real Postgres server. Real concurrency, pool role persistence, `pg_dump`/restore, and production RLS behavior remain blocked (`realPostgresConcurrency: BLOCKED`, `isolatedPgDumpRestore: BLOCKED`).
- E06/E11 are BLOCKED (270 cases), so the required v2 harness does not establish coverage; all evidence here is from direct PGlite + Fastify inject probes.
- `/graph` explore projection, `/semantic/*`, `/operations/*`, and some embedding-maintenance write paths were not exhaustively probed.
- Snapshot diff mixes B04/B05/B06 changes; exact B06 attribution outside the report's file list is inferred, not proven by commit history.
- The verifier did not modify any source, test, migration, manifest, or mobile file.

---

# Re-verification (second pass)

Date: 2026-10-17. Repository: `D:/Coding/BrainIA/BrainIA-Backend`. HEAD unchanged: `b71c4cc82ca0faa636db656c729e79cb906a9114`. Worktree dirty. Input: `docs/reports/v2/B06-r2.md`. Method: source inspection plus fresh Fastify `inject` probes against a freshly migrated in-memory PGlite schema (`tests/pglite-setup.mjs`), all probe scripts supplied on stdin. The prior conclusions were treated as hypotheses and re-executed, not copied. No source, test, migration, manifest, or mobile file was edited; the only repository write is this section.

**Re-verification verdict: REJECTED.** All eleven first-pass defects are fixed and independently confirmed fixed. Four new cross-owner defects were reproduced outside the originally probed surfaces, including a read leak that returns another owner's event titles and insight summaries and two write bypasses that mutate another owner's rows.

## Prior-defect retest (all eleven first-pass defects)

Fixtures: owner-a and owner-b, each with an event, entity, relation, alias, review item, insight run, digest run, financial account/transaction, and pending transaction; one public `domain` entity; one embedding with `client_id = NULL`; one embedding owned by each owner. All requests used valid owner-a client credentials unless stated otherwise.

| # | First-pass defect | Fresh result | Assessment |
|---|---|---|---|
| 1 | Hybrid retrieval leaks entities/relations/insights/digests and null-owner embeddings | `GET /retrieval/hybrid?q=BravoHybridEntityB` -> 200 `count:0`; same for relation, insight and digest markers. `q=BravoNullEmbeddingB` -> 200 `count:0`; `q=BravoNullInsightEmbeddingB` -> 200 `count:0`. Owner-a's own entity/insight markers -> 200 `count:1`, owner-b querying its own null-client embedding -> 200 `count:1`. | **FIXED**. Entity/relation/insight/digest text branches filter `owner_id`; vector branch uses `client_id is not distinct from $2`, so `NULL` no longer matches owner-a. |
| 2 | Privacy export leaks `insight_runs` / `digest_runs` | `GET /privacy/export` as owner-a returned only owner-a's event and insight; no owner-b `insight_runs` or `digest_runs`. A focused probe with an owner-b insight summary marker (`BRAVO_INSIGHT_SUMMARY_SECRET`) found no such marker in owner-a's export. | **FIXED** for this surface. |
| 3 | Insight/digest history and by-id unscoped | `/insights?limit=10`, `/insights/history?limit=10`, `/digests/history?limit=10` each returned only owner-a rows (`count:1`). `/insights/history/{ownerB}` -> 404 `insight_run_not_found`; `/digests/history/{ownerB}` -> 404 `digest_run_not_found`. | **FIXED**. |
| 4 | Entity graph unscoped | `GET /entities/{ownerB}/graph?depth=1` -> 404 `entity_not_found`; own root -> 200 with own data. | **FIXED** at the route. |
| 5 | Entity resolve unscoped | `GET /entities/resolve?id={ownerB}` and `?q=BravoEntityB` -> 200 `{"matches":[]}`. | **FIXED** by canonical post-filter. |
| 6 | Alias/review read and mutation unscoped | `/aliases?entityId={ownerB}` -> `{"aliases":[]}`; `/aliases` (owner-a) returned only owner-a; `/review/aliases?status=pending` returned only owner-a; resolve and ignore against owner-b review -> 404 `review_not_found`; owner-b row remained `pending` with `notes:null`. | **FIXED**. |
| 7 | Privacy entity mutation unscoped | `PATCH /privacy/entities/{ownerB}` -> 404 `entity_not_found`; DB `visibility` remained `visible`. | **FIXED**. |
| 8 | Financial merge duplicate bypass | `POST /financial/transactions/{ownerA}/merge {duplicateId: ownerB}` -> 404 `financial_transaction_not_found`; reverse direction also 404; owner-b transaction remained `hidden_at:null, merged_into_transaction_id:null`. | **FIXED**. |
| 9 | Ownerless financial writes | New account/manual transaction/pending transaction as owner-a -> 201 and DB `owner_id='owner-a'`. Owner-b read of the manual transaction -> 404; owner-b PATCH of manual transaction -> 404; owner-b PATCH of pending -> 404. New insight and digest runs also persisted `owner_id='owner-a'`; owner-b `/insights/history/{A}` -> 404 `insight_run_not_found` and `/digests/history/{A}` -> 404 `digest_run_not_found`. | **FIXED for new writes**. Legacy null-owner rows remain shared (see conditional risk C1). |
| 10 | Metrics aggregate leak | `GET /metrics` and `/metrics/quality` as owner-a -> 403 `insufficient_scope`. Global admin key -> 200. Explore graph as owner-a -> 403; taxonomy -> 200. | **FIXED** for non-admin principals. |
| 11 | Cron `?x=/cron/` bypass | Configured-auth app, `GET /api/v1/metrics?x=/cron/` with `Authorization: Bearer CRON_SECRET` -> 401 `missing_client_id` (not a cron principal). Same for `/aliases?x=/cron/` and `/retrieval/hybrid?x=/cron/`. Real `GET /api/v1/cron/daily-insights` with the same bearer -> 200. Wrong bearer -> 401. | **FIXED**; parsed pathname used. |

## Claim-by-claim verification of B06-r2

| B06-r2 claim | Verified? | Evidence / limit |
|---|---|---|
| Hybrid retrieval owner filters (entities, relations, insights, digests, embeddings, graph expansion) | **Yes** | `src/storage/hybrid-retrieval.ts:113,124,139,146,165,201-203`; fresh probes above. |
| Privacy export filters insight/digest runs by owner | **Yes** | `src/storage/data-controls.ts:20-21`; focused marker probe. |
| `insight_runs`/`digest_runs` migration, writes, list/load by owner | **Yes** | `migrations/20261017120000_owner_runs.sql`; `src/storage/insight-repository.ts:44-174`; `src/storage/digest-repository.ts:30-124`; `npm run schema:verify` clean at 46 migrations. |
| Explore graph admin; detail graph filters foreign nodes/relations/paths and 404s foreign root | **Yes** | `src/routes/graph.ts:12-19,32-59`; probes. Filtering is route-level only. |
| `/entities/resolve` filters matches by owner | **Yes** | `src/routes/entity-resolve.ts:31-40`; probes. |
| Aliases/review lists filter; create/resolve/ignore pre-check ownership | **Yes** | `src/storage/entity-alias-repository.ts:97-119,218-255`; `src/routes/entity-aliases.ts:40-62,83,125,165`; probes. |
| `/metrics`, `/metrics/quality` admin scope | **Yes** | `src/routes/metrics.ts:8-13`; probes. Disabled dev mode still bypasses by design. |
| Financial merge duplicate owner; entity visibility; review resolve refuses foreign rows | **Yes** | `src/routes/financial-transactions.ts:339-358`; `src/storage/data-controls.ts:65-84`; `src/routes/entity-aliases.ts:125`; probes. |
| Financial account/manual/pending/balance-adjustment writes persist `owner_id` | **Yes for account/manual/pending by execution; balance adjustment by source inspection only** | `src/storage/financial-transaction-repository.ts:249-257,323-381,400-437,472-490`; probes. |
| Cron uses parsed pathname | **Yes** | `src/auth.ts:253-260`; probes. |

## New confirmed defects (fresh execution)

### N1. `GET /digests` returns every owner's events and insight summaries (cross-owner read leak)

`GET /api/v1/digests?days=7` with owner-a credentials returned owner-b's event and an owner-b insight summary:

```
STATUS=200
TOTAL_EVENTS=2
RECENT_TITLES=AlphaDigestMarker|BravoDigestSecretMarker
RELATED=BravoInsightQuerySecret/BRAVO_INSIGHT_SUMMARY_SECRET
HAS_B_EVENT_TITLE=true
HAS_B_INSIGHT_QUERY=true
HAS_B_INSIGHT_SUMMARY=true
```

Cause: `src/storage/digests.ts:224-289` (`loadDigestData`) selects from `raw_events` and `insight_runs` with only a time window; no `owner_id`/`client_id` predicate. `src/routes/digests.ts:55-87` passes only the generated run's owner to `insertDigestRun`, not to digest selection. The response exposes titles, event ids, sources, kinds, timestamps, counts, and related insight queries/summaries. This is the same class as the original hybrid/export leaks and is reproducible on every call.

### N2. `GET /insights?q=` resolves another owner's entity (cross-owner read leak)

`GET /api/v1/insights?q=BravoSecretEntity&depth=1&maxNodes=10&maxRelations=10` as owner-a:

```
200
"resolution":{"matchedEntityId":"ce42f080-...","canonicalEntityId":"ce42f080-...","mode":"search_match"}
"supportingEntities":[{"id":"ce42f080-...","value":"BravoSecretEntity","type":"merchant"}]
```

`/insights?id={ownerB}` correctly returns `not_found`, but the query path falls back to the unfiltered `resolveEntityMatches` result: `src/storage/agent-inspect.ts:31-42` uses `allEntities` (owner-filtered) only when the match is found there, otherwise `?? selectedMatch` (the unfiltered match) and then calls `getEntityGraph` on it. The generated insight run is stored under owner-a, so owner-b's entity name/id is persisted into owner-a's history/export.

### N3. `POST /knowledge/feedback` mutates other owners' entities and insight runs

Owner-a, targeting owner-b rows:

```
POST /api/v1/knowledge/feedback
{"action":"rename","targetType":"entity","targetId":"<ownerB entity>","payload":{"value":"RenamedByA","description":"hacked"}}
-> 200 {"result":{"id":"<ownerB entity>","value":"RenamedByA","description":"hacked"}}

DB: entities.id=<ownerB entity> value="RenamedByA" description="hacked" owner_id="owner-b"
```

```
POST /api/v1/knowledge/feedback
{"action":"reject","targetType":"insight","targetId":"<ownerB insight>"}
-> 200 {"result":{"id":"<ownerB insight>","feedbackStatus":"rejected"}}

DB: insight_runs.feedback_status="rejected", owner_id="owner-b"
```

Cause: `src/storage/data-controls.ts:123-194` (`recordKnowledgeFeedback`) uses the caller's owner only when inserting the feedback row/semantic rule; the `rename` and `insight` accept/reject updates match by id alone, and the `candidate` accept/reject branch has the same unguarded shape by inspection. Cross-owner `merge`/`categorize` are blocked incidentally by the `relation_owner_mismatch` trigger (409), not by authorization. This route is absent from B06-r2's remediation list.

### N4. Manual/pending financial writes accept a foreign `accountId` (cross-owner integrity write and balance tampering)

Owner-a creating a manual transaction and a pending transaction with owner-b's account id:

```
POST /api/v1/financial/transactions
{"title":"CrossLinkedA","kind":"expense","amount":3,"currency":"UYU","accountId":"<ownerB account>","observedAt":"2026-10-17T12:00:00Z"}
-> 201 {"id":"financial_0c07...","accountId":"<ownerB account>","account":"Bravo Account"}

DB: financial_transactions.owner_id="owner-a", account_id="<ownerB account>"
GET /api/v1/financial/accounts as owner-b -> [{"id":"<ownerB account>","balance":"-3.00"}]
```

`POST /financial/pending-transactions` behaves the same (201, owner-a, foreign `accountId`, `account:"Bravo Account"`). Cause: `assertAccountCurrency` (`src/storage/financial-transaction-repository.ts:387-398`) checks only that the account exists and has the same currency; it never checks `owner_id`. Effects: owner-a learns owner-b's account name, changes owner-b's computed balance, and attaches a foreign ledger entry to owner-b's account. The account id is not returned by owner-scoped list endpoints, so exploitation requires prior knowledge of the id, but the authorization boundary is still absent.

## Conditional vulnerabilities (reproduced)

### C1. Legacy `owner_id IS NULL` financial rows remain mutually visible and mutable

Inserted one pre-fix-style null-owner account and pending transaction, then used owner-a/owner-b credentials:

```
GET /financial/accounts as owner-a -> includes "Legacy Null Account"
GET /financial/accounts as owner-b -> includes the same account
PATCH /financial/accounts/{null-owner} as owner-b -> 200, renamed "B took it"
GET /financial/pending-transactions as owner-a -> includes "Legacy Null Pending"
PATCH /financial/pending-transactions/{null-owner} as owner-b -> 200, renamed "B took pending"
```

This is the residual risk B06-r2 acknowledges: `listFinancialAccounts`, pending list/patch helpers and transaction loads still accept `owner_id IS NULL`. Any production row created by the pre-fix bug remains shared until a reviewed backfill/quarantine is applied. New writes are correctly owned.

Other carried conditions (source-inspected, not newly exploited here):

- No route calls `withOwnerTransaction`; RLS remains an isolated foundation, not the deployed request path.
- `POST /insights/daily` empty-body and `/cron/daily-insights` still write owner-null insight/digest runs (`src/storage/proactive-insights.ts`), which scoped owners cannot see and admins can.
- Entity graph filtering is in `src/routes/graph.ts`, not `graph-repository.ts`; a future direct caller of `getEntityGraph` bypasses it.
- Cron keeps a valid principal on any path containing a `cron` segment; a future route that omits `ownerScope` would accept it.
- Disabled auth mode (`mode:"disabled"`) trusts `x-brainia-client-id` and bypasses `requireScope`; production defaults and `BRAINIA_REQUIRE_AUTH=true` close this, as the fail-closed probe confirms.

## Command table (re-executed by this verifier)

| Command | Exit | Observed |
|---|---:|---|
| `npm run lint` | 0 | `tsc -p tsconfig.json --noEmit`, no diagnostics. |
| `npm run build` | 0 | `tsc -p tsconfig.json`, no diagnostics. |
| `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-authorization.test.ts` | 0 | 4 tests / 4 pass / 0 fail / 0 skipped. |
| `npm run test:isolated` | 0 | 128 tests / 128 pass / 0 fail / 0 skipped. |
| `NODE_OPTIONS=--import ./contracts/schema/preload-isolated.mjs npm run schema:verify -- --read-only` | 0 | `{"ok":true,"readOnly":true,"problems":[]}` (46 migrations / 1715 catalog objects in the generated manifest). |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | All checks PASS, including fresh migration, read-only reconciliation, ACL/drift/idempotency; the real-Postgres lines remain BLOCKED. |
| `npm run contracts:verify` | 0 | `PASS 382 contract checks; 58 positive/negative schema+semantic fixtures; 7 identity sequences.` Bundle SHA-256 `312c92f8…abad6`; 30 open G1 decisions. |
| `npm run test:v2 -- --suite E06,E11` | 2 | `E06: BLOCKED; 0 pass / 0 fail / 180 blocked of 180`; `E11: BLOCKED; 0 pass / 0 fail / 90 blocked of 90`. Expected BLOCKED. |

## Leak matrix after remediation

Legend: **scoped** = owner predicate or admin/denied gate verified; **leak** = fresh reproducible cross-owner exposure; **conditional** = legacy/background path.

| Surface | Result | Note |
|---|---|---|
| `/events`, `/events/:id` | scoped | unchanged, probes in test suite |
| `/search` (FTS) | scoped | unchanged |
| `/retrieval/hybrid` (all branches incl. NULL embeddings) | scoped | N=0 for every owner-b marker |
| `/privacy/export` | scoped | insights/digests filtered |
| `/privacy/entities/:id`, `/privacy/events/:id` | scoped | foreign -> 404 |
| `/insights`, `/insights/history`, `/insights/history/:id` | scoped | list/by-id owner-filtered |
| `/insights?q=` generation path | **LEAK (N2)** | unfiltered `resolveEntityMatches` fallback |
| `/insights/daily` empty-body / `/cron/daily-insights` | **conditional** | owner-null writes |
| `/digests/history`, `/digests/history/:id` | scoped | list/by-id owner-filtered |
| `/digests` generation | **LEAK (N1)** | all owners' events + insight summaries |
| `/entities/:id/graph` | scoped | foreign root 404; foreign nodes stripped |
| `/graph?projection=explore` | admin-only | owner 403; global 200 |
| `/graph?projection=taxonomy` | public | by design |
| `/entities/resolve` | scoped | foreign id/q -> `matches:[]` |
| `/aliases`, `/review/aliases` | scoped | foreign rows absent |
| `/aliases` create, review resolve/ignore | scoped | foreign -> 404; merge target blocked by trigger |
| `/knowledge/feedback` | **LEAK/MUTATION (N3)** | foreign rename and insight feedback succeed |
| `/metrics`, `/metrics/quality` | admin-only | owner/cron 403 |
| `/financial/transactions` (list/detail/patch/delete/merge/false-positive) | scoped | foreign -> 404; merge both directions 404 |
| `/financial/accounts` (list/patch/delete/adjust) | scoped for new rows; **conditional legacy** | null-owner rows shared |
| `/financial/pending-transactions` (list/patch/delete/execute) | scoped for new rows; **conditional legacy** | null-owner rows shared |
| `/financial/transactions` + `/pending-transactions` create with foreign `accountId` | **BYPASS (N4)** | foreign account referenced and its balance altered |
| `/cron/*`, `?x=/cron/` | scoped | fake path 401; real path 200 |
| `/operations/*`, `/semantic/*`, `/agent/*` | not exhaustively probed | carried limitation |

## Scope attribution vs `snapshot-backend.json`

Snapshot `ea41cb12…cb444` was captured before the B06 remediation. Comparing current hashes to the snapshot (excluding generated logs and `graphify-out/`): 43 tracked/business files changed, including the remediation set claimed in B06-r2 — `src/auth.ts`; `src/routes/{graph,entity-resolve,entity-aliases,entity-merge,metrics,privacy,insights,digests,financial-transactions}.ts`; `src/storage/{hybrid-retrieval,data-controls,insight-repository,digest-repository,financial-transaction-repository}.ts`; and added `migrations/20261017120000_owner_runs.sql`, `contracts/schema/manifest.json`.

Attribution remains **inferred, not proven**, because the same diff also contains B04/B05 changes (`src/routes/knowledge.ts`, `src/storage/{insights,entity-repository,event-store,search-repository,semantic-*}.ts`, tests, package.json, schema files) that predate or overlap B06. Documentation accuracy: B06-r2's "Files changed" list omits `src/storage/entity-alias-repository.ts`, which changed for item 6, and it does not attribute the other overlapping paths. This is a reporting gap, not a security defect.

## Mitigating controls

- DB ownership triggers block cross-owner `relations`, `event_entities`, entity merges and hierarchy relations even where route checks are missing (observed `relation_owner_mismatch` 409).
- Cross-owner merge via `/entities/:id/merge` is both route-checked and trigger-blocked.
- Production auth defaults to required; required-but-unconfigured fails closed with 503 on every sampled `/api` route.
- Owner headers are rejected before credential resolution; global key is ownerless and receives `owner_scope_required`.
- RLS helper and policies work in isolation; a backfill/quarantine toolset exists, so C1 is remediable without redesign.

## Unverified assumptions / limitations

- PGlite, not real PostgreSQL: concurrency, pool-role persistence, restore, and production RLS behavior remain BLOCKED. The harness itself reports `realPostgresConcurrency: BLOCKED` and `isolatedPgDumpRestore: BLOCKED`.
- E06/E11 remain BLOCKED (270 cases); no v2 conformance credit is claimed.
- Balance-adjustment owner persistence was only source-inspected, not executed.
- `/operations/*`, `/semantic/*`, `/agent/*`, background job/worker paths and live LLM synthesis were not exhaustively probed.
- The digest/insight generation leaks were reproducible without an LLM key; with a key, the same unscoped context is sent to the model, which would widen the exposure.
- The verifier did not modify source, tests, migrations, manifests, or mobile files; probes ran through stdin against fresh in-memory databases.

---

# Third-pass re-verification (N1–N4 remediation)

Date: 2026-10-17. HEAD unchanged: `b71c4cc82ca0faa636db656c729e79cb906a9114`. Input: `docs/reports/v2/B06-r3.md`. Method: source inspection of the changed functions plus fresh Fastify `inject` probes against a newly migrated in-memory PGlite schema. Every probe used owner-a and owner-b credentials with distinct markers; no worker output or test result was reused as evidence. No source, test, migration, manifest, or mobile file was edited by this verifier.

**Result: ACCEPTED-WITH-CONDITIONS.** N1–N4 are fixed as claimed, the legacy null-owner condition is closed for both scoped owners, and the prior clean matrix plus auth/RLS probes still pass. No reproducible cross-owner leak or mutation was found. Remaining conditions are architectural/coverage items, not new B06 regressions.

## N1 — `GET /digests` owner isolation: PASS

Fixture: owner-a event `AlphaN1EventMarker` + insight `AlphaN1InsightQuery`; owner-b event `BravoN1EventMarker`, entity, relation `BravoN1RelationMarker`, fact `BravoN1FactMarker`, and insight `BravoN1InsightQuery` / `BRAVO_N1_INSIGHT_SUMMARY`.

`GET /api/v1/digests?days=7` as owner-a:

```
status 200
totalEvents 1
recentTitles ["AlphaN1EventMarker"]
relatedInsights ["AlphaN1InsightQuery"]
AlphaN1EventMarker present           = true
BravoN1EventMarker present           = false
owner-b event id present             = false
owner-b insight query/summary/id      = false
BravoN1RelationMarker present        = false
BravoN1FactMarker present            = false
```

Owner-b's own digest contained `BravoN1EventMarker` and not `AlphaN1EventMarker`. `digest_runs` rows created by the calls were owned by the calling owner. The event/metrics query uses `coalesce(r.owner_id, r.client_id) = $n`; related insights use `insight_runs.owner_id = $n` (`src/storage/digests.ts:231-289`), and the route passes `ownerScope(request)` to both selection and persistence (`src/routes/digests.ts:55-70`). **Fixed.**

## N2 — `GET /insights?q=` foreign resolution: PASS

Unique marker fixture: owner-a `AlphaQuxUnique`, owner-b `ZebraBlastBOnly`.

```
GET /api/v1/insights?q=ZebraBlastBOnly&depth=1  as owner-a
-> 200, resolution.matchedEntityId=null, mode="not_found",
   supportingEntities=[], body contains owner-b entity id=false

GET /api/v1/entities/resolve?q=ZebraBlastBOnly   as owner-a
-> 200, matches=[]

GET /api/v1/insights?id=<owner-a entity>          as owner-a
-> 200, matchedEntityId=<owner-a entity>, own value present

GET /api/v1/insights?id=<owner-b entity>          as owner-a
-> 200 with resolution.mode="not_found", matchedEntityId=null
```

Public taxonomy still resolves (`PublicDomainN2` -> 200). Important nuance: with two similar names (`BravoN1Entity` and `AlphaN1Entity`), the approximate matcher returns the caller's **own** `AlphaN1Entity`, not the foreign one; no owner-b id or value was present. `resolveEntityMatches` now applies `e.owner_id = $n or (owner_id is null and type in ('domain','concept'))` to entity, alias and approximate queries (`src/storage/entity-repository.ts:336-431`); `agent-inspect` passes `ownerId` on the query path (`src/storage/agent-inspect.ts:33-34`). **Fixed for the route-reachable paths.** The raw `id` branch of `resolveEntityMatches` remains unfiltered for direct storage callers, but both routes post-filter or use `listEntities`; that is a latent condition, not a reachable leak.

## N3 — `POST /knowledge/feedback` foreign targets: PASS

As owner-a targeting owner-b rows:

```
POST /api/v1/knowledge/feedback
{"action":"rename","targetType":"entity","targetId":"<ownerB entity>",
 "payload":{"value":"RenamedByA3","description":"hacked3"}}
-> 404 {"error":"feedback_target_not_found"}
DB entity value/description unchanged = true

POST /api/v1/knowledge/feedback
{"action":"reject","targetType":"insight","targetId":"<ownerB insight>"}
-> 404
DB insight feedback_status still null = true
knowledge_feedback rows for both foreign targets = 0

POST /api/v1/knowledge/feedback
{"action":"merge","targetType":"entity","targetId":"<ownerA>",
 "payload":{"canonicalEntityId":"<ownerB>"}}
-> 404; entity_merges count unchanged

POST /api/v1/knowledge/feedback
{"action":"categorize","targetType":"entity","targetId":"<ownerA>",
 "payload":{"parentEntityId":"<ownerB>"}}
-> 404
```

Own-target feedback still works: owner-a rename -> 200 and the entity value changed; owner-a insight reject -> 200 and `feedback_status="rejected"`. `feedbackTargetOwnedBy` runs before any mutation inside the transaction (`src/storage/data-controls.ts:137-181`), and the route maps `null` to 404 (`src/routes/privacy.ts:59-61`). **Fixed.**

## N4 — foreign `accountId` on financial writes: PASS

Owner-b account with zero activity; owner-a attempts:

```
POST /api/v1/financial/transactions
{"title":"CrossLinkedA3","kind":"expense","amount":3,"currency":"UYU",
 "accountId":"<ownerB account>","observedAt":"2026-10-17T12:00:00Z"}
-> 404 {"error":"financial_account_not_found"}

POST /api/v1/financial/pending-transactions
{"title":"CrossLinkedPendingA3",...,"accountId":"<ownerB account>"}
-> 404 {"error":"financial_account_not_found"}

rows referencing owner-b account: financial_transactions=0, pending=0
owner-b account balance = "0"
POST /financial/accounts/<ownerB>/adjustments -> 404
PATCH own transaction with accountId=<ownerB> -> 404, account unchanged
PATCH own pending with accountId=<ownerB> -> 409, account unchanged
```

Own-account creation still succeeds: manual and pending -> 201, both with `owner_id="owner-a"` and `account_id=<ownerA account>`; owner-b's transaction list does not contain the owner-a row. `assertAccountCurrency` now compares `account.owner_id` against the scoped owner and throws `Financial account not found` (`src/storage/financial-transaction-repository.ts:390-406`), and creation/balance-adjustment/update paths pass `ownerId`. **Fixed.** Minor discrepancy: `PATCH /financial/pending-transactions/:id` with a foreign account returns **409** `pending_financial_transaction_failed`, not the 404 claimed in B06-r3; no mutation occurs and the account id is unchanged, so this is a status-code/documentation issue only.

## Legacy `owner_id IS NULL` accounts and pending rows

Tested with a null-owner account and null-owner pending row.

| Caller | List account | List pending | PATCH account | PATCH pending | Row after |
|---|---|---|---|---|---|
| owner-a (scoped) | hidden | hidden | 404 | 404 | unchanged |
| owner-b (scoped) | hidden | hidden | 404 | 404 | unchanged |
| global API key | 403 `owner_scope_required` | 403 `owner_scope_required` | n/a | n/a | unchanged |
| disabled mode, no client-id header (unscoped) | visible | visible | 200 (renamed) | n/a | mutable by design |

So the second-pass legacy exposure is closed for scoped callers; only the explicitly unscoped local/test mode still sees or mutates those rows. The global admin key cannot reach them because financial routes require an owner scope. Consequence to record: legitimate pre-fix ownerless accounts are now invisible to their real owners until a reviewed backfill assigns ownership (availability, not confidentiality).

## Regression matrix and auth/RLS re-probe

| Check | Result |
|---|---|
| `GET /events` owner-a | 200, owner-a only |
| `GET /events/:ownerB` | 404 `event_not_found` |
| `GET /search?q=BravoN1EventMarker` | 200, events/entities/relations empty |
| `GET /retrieval/hybrid?q=BravoN1Entity` | 200, count 0; no owner-b id |
| `GET /privacy/export` | no owner-b marker |
| `GET /insights/history/:ownerB` | 404 |
| `GET /digests/history/:ownerB` | 404 |
| `GET /entities/:ownerB/graph` | 404 |
| `GET /entities/resolve?id=:ownerB` | 200, `matches:[]` |
| `GET /aliases?entityId=:ownerB` | 200, `aliases:[]` |
| `GET /review/aliases` | 200, owner-a only |
| `POST /review/aliases/:ownerB/resolve` | 404 |
| `GET /metrics` owner-a | 403 `insufficient_scope` |
| `POST /financial/transactions/:ownerA/merge {duplicateId:ownerB}` | 404; owner-b row unchanged |
| `GET /metrics?x=/cron/` with CRON bearer | 401 `missing_client_id` |
| `GET /cron/daily-insights` with CRON bearer | 200 |
| owner header spoof | 403 `owner_header_not_accepted` |
| global key on `/events` | 403 `owner_scope_required` |
| global key on `/metrics` | 200 |
| required-but-unconfigured `/api/v1/events` | 503 `auth_not_configured` |
| required-but-unconfigured `/health` | 200 |
| RLS: owner sees own, hides other, foreign insert rejected, pool setting `""` | PASS |

## Command table (third pass)

| Command | Exit | Observed |
|---|---:|---|
| `npm run lint` | 0 | `tsc -p tsconfig.json --noEmit`; no diagnostics. |
| `npm run build` | 0 | `tsc -p tsconfig.json`; no diagnostics. |
| `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-authorization.test.ts` | 0 | 8 tests / 8 pass / 0 fail / 0 skipped (four N1–N4 regressions included). |
| `npm run test:isolated` | 0 | 132 tests / 132 pass / 0 fail / 0 skipped. |
| `NODE_OPTIONS=--import ./contracts/schema/preload-isolated.mjs npm run schema:verify -- --read-only` | 0 | `{"ok":true,"readOnly":true,"problems":[]}`. |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | PASS baseline 46 migrations / 1715 catalog objects; real-Postgres cases BLOCKED. |
| `npm run contracts:verify` | 0 | 382 contract checks; 58 fixtures; 7 identity sequences; bundle `312c92f8…abad6`. |
| `npm run test:v2 -- --suite E06,E11` | 2 | E06 BLOCKED 180/180; E11 BLOCKED 90/90; 0 pass / 0 fail. |

## Scope attribution

Snapshot `ea41cb12…cb444` predates B06 remediation. Current hash comparison (excluding `graphify-out/`, `node_modules`, `dist`, and log files) finds **44 changed** and **28 added** paths.

Changed (44):

```
contracts/schema/manifest.json
contracts/schema/verify.test.mjs
docs/reports/v2/approvals.json
package.json
src/app.ts
src/auth.ts
src/routes/agent-inspect.ts
src/routes/capture.ts
src/routes/client-diagnostics.ts
src/routes/digests.ts
src/routes/entity-aliases.ts
src/routes/entity-merge.ts
src/routes/entity-resolve.ts
src/routes/entity-semantic-profile.ts
src/routes/events.ts
src/routes/financial-transactions.ts
src/routes/graph.ts
src/routes/insights.ts
src/routes/intelligence.ts
src/routes/knowledge.ts
src/routes/metrics.ts
src/routes/privacy.ts
src/routes/search.ts
src/routes/semantic.ts
src/storage/agent-inspect.ts
src/storage/data-controls.ts
src/storage/digest-repository.ts
src/storage/digests.ts
src/storage/entity-alias-repository.ts
src/storage/entity-repository.ts
src/storage/event-repository.ts
src/storage/event-store.ts
src/storage/financial-transaction-repository.ts
src/storage/hybrid-retrieval.ts
src/storage/insight-repository.ts
src/storage/insights.ts
src/storage/knowledge-fact-repository.ts
src/storage/postgres.ts
src/storage/relation-repository.ts
src/storage/search-repository.ts
src/storage/semantic-repository.ts
src/storage/semantic-resolver.ts
tests/v2-harness/artifacts/latest.json
tests/v2-projections.test.ts
```

Added (29 including this report; the hash comparison above deliberately skipped this report):

```
.env.example
.env.laya.example
.env.laya.local
.env.local
.env.production.dbcheck
docs/reports/v2/B04-r2.md
docs/reports/v2/B04-verification-r2.md
docs/reports/v2/B05-r1.md
docs/reports/v2/B05-r2.md
docs/reports/v2/B05-verification.md
docs/reports/v2/B06-r1.md
docs/reports/v2/B06-r2.md
docs/reports/v2/B06-r3.md
docs/reports/v2/B06-verification.md
docs/reports/v2/G1-decision-package.md
docs/reports/v2/baseline-snapshot.md
docs/reports/v2/execution-status.md
docs/reports/v2/snapshot-mobile.json
migrations/20261017100000_owner_identity.sql
migrations/20261017110000_owner_rls.sql
migrations/20261017120000_owner_runs.sql
src/scripts/backfill-ownership.ts
src/storage/ownership.ts
supabase/.temp/cli-latest
tests/v2-authorization.test.ts
tests/v2-harness/artifacts/B04-r2.json
tests/v2-harness/artifacts/B05-r1.json
tests/v2-harness/artifacts/B06-r1.json
tests/v2-ownership.test.ts
```

Out-of-bound writes: **none attributable to r3.** File mtimes and the r3 report agree on exactly ten touched paths: `src/routes/{digests,entity-resolve,financial-transactions,privacy}.ts`, `src/storage/{agent-inspect,data-controls,digests,entity-repository,financial-transaction-repository}.ts`, and `tests/v2-authorization.test.ts`. No migration, schema manifest, contract bundle, or unrelated source file was written during r3. The snapshot-level diff still mixes B04/B05/B06 work (for example `src/storage/insights.ts`, `src/storage/semantic-resolver.ts`, `contracts/schema/verify.test.mjs`, `package.json`, `src/routes/knowledge.ts`), so attribution outside the r3 mtime set remains inferred rather than proven by commit history.

## Remaining conditions for acceptance

1. **RLS is still not wired into request routes.** `withOwnerTransaction` works in isolation (fresh probe: own visible, foreign hidden and insert-rejected, pool setting empty), but routes continue to use the table-owner pool. RLS is defense-in-depth only.
2. **Ownerless background digest/insight writers remain global.** `/cron/daily-insights` and the empty-body `/insights/daily` path call `runDailyKnowledgeEvaluation`, which calls `createKnowledgeDigest` without an owner (`src/storage/proactive-insights.ts:421-438`); those runs are owner-null and can summarize multiple owners. This is outside the scoped `GET /digests` path and must be closed or explicitly accepted before cron is enabled in multi-owner production.
3. **Public taxonomy is writable by any authenticated owner by design.** `POST /knowledge/feedback` rename/categorize/merge on a `domain`/`concept` entity succeeds for any owner (probe: public domain rename -> 200). If shared taxonomy must be immutable to tenants, this needs an admin gate.
4. **Real PostgreSQL remains unverified.** PGlite only; concurrency, pool-role persistence, restore, and production policy behavior are BLOCKED (`realPostgresConcurrency`, `isolatedPgDumpRestore`).
5. **E06/E11 remain BLOCKED** (180 + 90 cases), so the v2 harness provides no conformance evidence.
6. **Legacy null-owner financial rows are hidden, not backfilled.** They are invisible to scoped owners and to the global admin key (403 owner scope); only unscoped local/test mode sees them. A reviewed backfill/quarantine is still required for real owners to regain access.
7. **Residual route-level protections.** Graph owner filtering and the `resolveEntityMatches` id branch remain route-level/defense-in-depth; direct storage callers bypass them. `/operations/*`, `/semantic/*`, `/agent/*`, event-ingested finance (`createFinancialTransaction` owner persistence), and background workers were not exhaustively re-probed.
8. **Minor status discrepancy:** pending-transaction update with a foreign account returns 409 instead of 404; no mutation or leak. B06-r3's statement that pending-update maps not-found to 404 should be corrected.

## New defects found in this pass

None security-relevant. No reproducible cross-owner read, mutation, or credential-scope bypass was found in N1–N4, the legacy paths, or the regression matrix. The only discrepancy is the 409-vs-404 pending-update status code above.
