# V2 final independent verification - 2026-10-19

Target: `D:/Coding/BrainIA/BrainIA-Backend`, uncommitted checkout on `main` over HEAD `583a3a5c61a9a3e93bc20e19e90140b5a7ff234f`.
Mode: report-only. I edited no source, tests, migrations, contracts, docs, package or mobile files, and ran nothing against production. I made no commit, push, deploy or migration. This file is the only file written to the repository. Temporary probes, a `git archive HEAD` export used for counterfactual runs, and logs were kept in the session scratchpad, outside the repository. `npm run build` regenerated the git-ignored `dist/`.

I recomputed every result below myself. Worker reports were used only as claims to check.

## Verdict: **PASS WITH CONDITIONS**

All required commands pass. All 19 published operations are registered and `POST /api/v2/deletions` is absent. Bearer owner resolution resisted every header-spoof probe. Every error code observed stays inside the sealed enum. The contract bundle bytes are unchanged. The schema manifest delta matches the brief exactly, and the closure docs do not over-claim.

Three defects block an unconditional PASS:

| # | Severity | Finding | Location |
|---|---|---|---|
| C1 | Medium | A v2 POST/PUT with a missing or unsupported `Content-Type` returns **503 `unavailable`, `retryable:true`, `Retry-After: 5`** and logs at error level. It should be a non-retryable 4xx. Fastify's 415 `FST_ERR_CTP_INVALID_MEDIA_TYPE` falls through to the 503 default. | `src/routes/v2/index.ts:20` (only `statusCode === 400` is mapped), `src/routes/v2/index.ts:28` (`return 503`) |
| C2 | Medium | **Owner-scoped behavior change that B18 does not disclose.** For entities that have an `owner_id` (the normal state after the ownership backfill), two flows now always stay `pending` with `entity_owner_mismatch` and leave a stray ownerless entity row behind: (a) a friendly-name alias review with an explicit same-owner, same-type target; (b) a semantic merge approval with a default (non-explicit) target. The cause: `upsertEntity` never sets `owner_id`, so the freshly upserted entity is ownerless and the new owner check rejects it. At HEAD both flows "succeeded" by merging an owned entity into an ownerless root, which was a latent owner-boundary bug. The new behavior is therefore fail-closed and safer, but it makes these review actions non-functional for owned data. The v1 routes still return 200 with `status:"pending"`. | `src/storage/entity-alias-repository.ts:450` (upsert) then `:459` (skip); `src/storage/semantic-repository.ts:347` (upsert) then `:353` (skip) |
| C3 | Low (docs) | Mojibake: `…` was rendered as `?` in `da2a989f?621c`, `666af99f?bfb55` and `brain-owra6uznl?`. | `docs/reports/v2/execution-status.md:36`, `:39` |

## Command table (independent runs)

| Command | Exit | Result |
|---|---|---|
| `npm run lint` | 0 | `tsc --noEmit`, no diagnostics |
| `npm run build` | 0 | `tsc -p tsconfig.json` |
| `npm run test:isolated` | 0 | **229 tests / 229 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo**, 307,192 ms, 24 test files. Includes all 17 `v2 API` tests and all 10 `semantic-merge-types` tests. |
| `npm run contracts:verify` | 0 | `PASS 914 contract checks; 152 positive/negative schema+semantic fixtures; 7 identity sequences.` Bundle manifest SHA-256 `da2a989f6a607439bec3dabc21fbb4331efa58b2765f94e71a6b213ed2fd621c`. The verifier's own banner still prints `PROVISIONAL OPERATIONS IMPLEMENTATION-BLOCKED ... 13 provisional operation schemas; deletion creation remains excluded` (see residual R1). |
| `NODE_OPTIONS=--import=./contracts/schema/preload-isolated.mjs npm run schema:verify -- --read-only` | 0 | `{"ok":true,"readOnly":true,"problems":[]}` |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | Applied all 55 migrations including `20261019120000_v2_api.sql`. `PASS fresh migration and read-only reconciliation`, 4/4 nontransactional index control-flow PASS. Reports `realPostgresConcurrency: BLOCKED`, `isolatedPgDumpRestore: BLOCKED`. |
| `git diff --check` | 0 | No whitespace errors. I also grepped all untracked files for trailing whitespace: none. |
| Independent HTTP probe (`probe.mts`, PGlite preload) | 0 | **19/19 operations registered**, **60/60 checks OK** (details below) |
| Media-type/body-limit probe (`probe2.mts`, `probe3.mts`) | 0 | JSON bodies over 1 MiB → 413 `payload_too_large` (single, batch, corrections). `text/plain` small body → 400. **No content-type or `application/xml` → 503 `unavailable` retryable** (C1). |
| Counterfactual: new `tests/semantic-merge-types.test.ts` run against a `git archive HEAD` export | 1 (expected) | 10 tests: **3 pass / 7 fail at HEAD**. The semantic-enrichment job test fails at HEAD with `Only entities of the same type can be merged`. |
| Owner-scoped probe (`probe4.mts`), checkout vs HEAD | 0 | Checkout: (A) friendly-name review → `pending/entity_owner_mismatch`; (B) default-target merge → `pending/entity_owner_mismatch`; (A2) alias equals target → resolved; (C) explicit same-owner target → approved. HEAD: A resolved, B approved, both merging into an ownerless root (C2). |

## 1. Semantic merge fix

- **The invariant is unchanged.** `git diff` shows no change to `src/storage/entity-repository.ts`. `mergeEntities` still throws `Only entities of the same type can be merged` on resolved roots (`entity-repository.ts:520-522`). The test `mergeEntities retains its strict cross-type invariant` passes in both checkout and HEAD.
- **Callers.** Every storage-level caller now goes through `semanticMergeSkipReason` (`semantic-repository.ts:14-27`). That helper checks canonical root type and owner before merging:
  - `consolidateProviderIdentity` (`:91`): records skips in `providerIdentityMergeSkips` and adds a same-owner filter (`:84`).
  - `resolveSemanticCandidate` (`:344`, `:353`): pending, plus an idempotent rationale marker; no rule or relation is created.
  - `resolveEntityReview`: all alias, target and friendly paths are preflighted before the first merge.
  - The reconciler: owner filter in selection, plus a recheck that counts a skipped pair as `review` (`semantic-reconciler.ts:223-226`).
  - `src/routes/entity-merge.ts` and `data-controls.ts` are unchanged and still rely on the invariant. `src/scripts/reconcile-semantic-governance.ts:58` is still an unconditional concept-to-app merge; B18 discloses this.
- **Observation.** `entities` has `UNIQUE (type, normalized_value)` (`constraint:entities.entities_type_normalized_value_key`). So every match in `consolidateProviderIdentity` necessarily has a different type, and its `mergeEntities` branch is now effectively unreachable: it only records skips. This is not a regression, because at HEAD the same matches threw.
- **Taxonomy.** `domain`/`concept` stay excluded from provider matching, and the concept-to-domain `belongs_to_domain` hierarchy test still passes. No taxonomy regression found.
- **Owner.** No cross-owner merge is possible through the patched paths (probe C and test 8). However, see **C2** for the fail-closed functional regression on owned data. B18's same-type friendly-name success test uses ownerless entities only, so it does not show this.
- **The regression test is genuine.** It inserts a raw event, enqueues a real `semantic_enrichment` job, claims it, runs `executeBackgroundJob` and completes the job with its effects. It then asserts `succeeded`, a null `last_error`, no merge and a recorded skip. At HEAD this exact test fails with the production error string.
- **Undocumented behavior change.** The reconciler's verification call now receives `privacy: authorization` (`semantic-reconciler.ts:183`). B18 discloses this. It is a behavior change: previously the second call failed closed.

## 2. V2 API

### Operation-by-operation check (19/19)

"Registered" means `app.hasRoute(...)` on the built app. "No auth" is the status from an unauthenticated inject. The scope column is from `src/routes/v2/index.ts`.

| # | Operation | Registered | No auth | Scope | Independent behavior check |
|---|---|---|---|---|---|
| 1 | GET /api/v2/capabilities | yes | 401 | capture:read | 200. `email/activity/location/episodes/connectors` all `false`. |
| 2 | POST /api/v2/observations | yes | 401 | capture:write | 201, stored under the bearer owner. Owner B into A's source → 404. >1 MiB JSON → 413. Missing content type → **503 (C1)**. |
| 3 | POST /api/v2/observations/batch | yes | 401 | capture:write | 200 with per-item `invalid_request` / `fingerprint_mismatch`. >1 MiB → 413. |
| 4 | GET /api/v2/observations/{id} | yes | 401 | capture:read | Owner 200. Foreign → 404 `not_found`. |
| 5 | GET /api/v2/observations/{id}/revisions | yes | 401 | evidence:read | Foreign → 404. |
| 6 | GET /api/v2/events/{id} | yes | 401 | evidence:read | Owner 200. Foreign → 404. |
| 7 | GET /api/v2/episodes | yes | 401 | evidence:read | `{"items":[],"nextCursor":null}` (gated). |
| 8 | GET /api/v2/episodes/{id} | yes | 401 | evidence:read | 404 (gated). |
| 9 | GET /api/v2/financial/transactions | yes | 401 | finance:read | 200. Amounts are `::text` and sign-stripped strings. |
| 10 | GET /api/v2/financial/summary | yes | 401 | finance:read | 200. Totals are SQL `numeric::text`. Invalid FX → 422 `unsupported_currency`. `from=x` → 400. |
| 11 | POST /api/v2/corrections | yes | 401 | corrections:write | Foreign event → 404. >1 MiB → 413. |
| 12 | PUT /api/v2/sources/{id}/policy | yes | 401 | privacy:write | Foreign source → 404. |
| 13 | GET /api/v2/deletions/{id} | yes | 401 | privacy:read | Owner-scoped tombstone lookup (`controls.ts`). Unknown → 404 (suite). |
| 14 | GET /api/v2/export | yes | 401 | privacy:export | Owner B export contains none of A's IDs. Garbage cursor → 400. |
| 15 | POST /api/v2/queries | yes | 401 | intelligence:read | 200, `modelCalls: 0`. |
| 16 | GET /api/v2/queries/{id} | yes | 401 | intelligence:read | Owner 200. Foreign → 404. |
| 17 | POST /api/v2/connectors/email/authorize | yes | 401 | connectors:write | 403 `forbidden` (feature disabled). |
| 18 | GET /api/v2/connectors/email/callback | yes | **302** (public, `security: []` in OpenAPI) | none | Redirects to `brainia://connectors/email/callback?error=<uuid>`. Does not echo `code`/`state`. Lookalike `/callbackx` → 401. |
| 19 | POST /api/v2/connectors/{id}/revoke | yes | 401 | connectors:write | 403 `forbidden`. |

**Deletion creation is absent.** `hasRoute` is false for POST, PUT, PATCH and DELETE on `/api/v2/deletions`, and for DELETE on `/api/v2/deletions/:id`. Injecting POST, PUT, PATCH or DELETE at `/api/v2/deletions` returns 404. The OpenAPI document has exactly 19 operations, and none of them creates a deletion.

### Auth, owner and error checks

- **Bearer owner cannot be spoofed.** Results:
  - Bearer A plus `x-owner-id: B` → 403. Bearer A plus `x-brainia-owner-id: B` → 403. An empty owner header → 403.
  - The global key as bearer → 403. An unknown bearer, `Basic` scheme or `Bearer tok extra` → 401.
  - v1 `x-brainia-client-id` / `x-brainia-api-key` headers on v2 → 401.
  - In a multi-client installation, a legacy client key is not accepted as a v2 bearer → 401.
  - The owner always comes from the server-configured token map (`auth.ts:342-370`). Capture stored `owner_id = ownerA`.
- **v1 header auth is unchanged.** The only v1 diff is the `/api/v2` early return (`auth.ts:261-262`). Probe results: valid headers → 200; missing client id → 401 `missing_client_id`; wrong key → 401 `invalid_api_key`; unknown client → 403 `unknown_client`; bearer-only → 401; `x-owner-id` on v1 → 403 `owner_header_not_accepted`. v1 is served under `/api/v1` (`config.ts:4`), so a v1 route cannot be reached through the `/api/v2/` bypass.
- **Error codes.** Every code observed (`unauthenticated`, `not_found`, `forbidden`, `invalid_request`, `unsupported_contract`, `fingerprint_mismatch`, `unsupported_currency`, `unavailable`) is in the sealed `ErrorObject.code` enum. Statically, every `ApiError` code in `src/` is either in the enum or is `feature_disabled` / `insufficient_scope`, which `errorObject` rewrites to `forbidden` (`index.ts:15`). `AuthzError` collapses to `forbidden` or `unauthenticated`.
- **Money.** The sealed decimal pattern is `^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$`. All money leaves SQL as `numeric::text`, and conversion uses `round(..., 6)::text`. There is no JavaScript arithmetic on amounts.
- **Contract bytes.** `git diff --quiet -- contracts/brain-ai` is clean, there are no untracked files under `contracts/`, and `contracts:verify` reproduces bundle `da2a989f…621c`.

## 3. Schema manifest

Comparison of `git show HEAD:contracts/schema/manifest.json` with the working tree:

| Check | Result |
|---|---|
| Migrations | 54 → **55**. The only addition is `20261019120000_v2_api.sql`, checksum `b7d463bb…a4c3`. |
| Prior migration checksums | **54/54 unchanged**, 0 removed. All 55 on-disk SHA-256 values match the manifest. |
| Objects | 1,972 → **2,275**: 303 added, **0 removed**, **2 modified**. |
| Modified objects | `function:brainia_bump_source_policy_version()`, which adds comparisons for `external_models_allowed` and `external_embeddings_allowed`. `relation:privacy_policy_changes`: `rls false → true`, `forceRls` unchanged. These are exactly the two exceptions named in B13-B17-schema-r1. |
| Added objects by prefix | acl 43 (2 function + 41 relation), column 95, constraint 115, function 2, index 25, policy 12, relation 10, trigger 1. This matches the report's table. |
| Artifact hashes | `manifest.json` `75384e60…48d8` and `catalog.sql` `50015c86…0873`. Both match the report. |

Provenance note: B13-B17-schema-r1 says the coordinator relayed the authorization for the two changes as a quote. This brief calls them "owner-authorized". I found no separate owner artifact; the record is the coordinator relay.

## 4. G0/G2 closure documents

`G0-closure-2026-10-19.md`, `G2-closure-2026-10-19.md`, `approvals.json` (v5, parses) and `execution-status.md` consistently record:

- `owner_accepted_with_conditions` with `technical_pass: false` and `independent_verification: false`.
- That the closure does **NOT** certify any of these: technical G0/G2 PASS, Play approval (SmartSnippet unverified, no app or upload), real PostgreSQL/RLS, restore/RPO/RTO (six-hour PITR, no snapshots, no drill), or G3-G5.
- That E01 is still FAIL (250/250 of 500) and E03/E05/E06/E07/E11/E12 are still BLOCKED.

The production figures I spot-checked against their sources all match: 1967 events, 33 × 201, `brainia-personal`, 32 policies, `owra6uznl`, `gelak8cb6`, the merge error string, 42 → 54 migrations, and schema drift. The claim "Mobile API review signed off with conditions" is backed by HEAD `approvals.json:69,79`.

No over-claim was found. The one defect is the mojibake in C3.

## Diff-scope findings

- **Modified files (8):** `contracts/schema/manifest.json`, `docs/reports/v2/approvals.json`, `docs/reports/v2/execution-status.md`, `src/app.ts` (+2 lines: import and registration), `src/auth.ts` (+83: bearer and v2 bypass), and the 3 semantic storage files.
- **Untracked files (16):** 6 reports, 1 migration, `src/domain/v2/contracts.ts`, `src/routes/v2/index.ts`, 5 `src/storage/v2/*` files, and 2 test files. All are within the declared scopes.
- No v1 test file, contract bundle file, package file or mobile file was changed.
- **Secrets:** a regex scan of the diff and all untracked files found no DSNs with credentials, provider keys, private keys or Neon/Vercel tokens. The test credentials are obvious fixtures (`global-api-secret`, `test-key`, random UUIDs).
- **Junk:** no temporary, log or generated files were added to the tracked or untracked set. Ignored files such as `.env.*`, `*.log` and `dist/` predate this work or are build output, and are excluded by `.gitignore`.

## Residual limitations

- **R1. Owner authorization is not a contract change.** The sealed verifier still prints `PROVISIONAL OPERATIONS IMPLEMENTATION-BLOCKED`. Implementation rests on the 2026-10-19 owner authorization in `approvals.json` v5, not on a resealed contract.
- **R2. Scopes do not restrict anything yet.** Every v2 bearer is granted all 10 `V2_SCOPES` (`auth.ts:370`). Per-route scope checks exist but cannot deny until per-token scopes are configurable. `rate_limited`/429 is never emitted.
- **R3. Evidence comes from an in-memory engine only.** All runtime evidence is PGlite in memory. Real PostgreSQL concurrency, multi-connection advisory locking and pg_dump/restore remain BLOCKED. No deployed v2, mobile client or OAuth provider was exercised.
- **R4. Production schema drift.** Production `schema:verify` already fails on pre-existing drift (`production-migration-2026-10-18.md:23`). Applying migration 55 there will not by itself produce a verifiable schema.
- **R5. The v2 backfill is a one-time snapshot.** The legacy observation backfill runs once inside the migration. v1 captures after the migration do not appear as v2 observations. New sources need manual `v2_source_instances` provisioning.
- **R6. Cursor secret.** Without `BRAINIA_CURSOR_SECRET`, cursors become invalid on each restart or instance change.
- **R7. Outstanding semantic-merge risks.** The `reconcile-semantic-governance.ts:58` cross-type merge is still outstanding, and dead-lettered production semantic jobs have not been reprocessed. Separately, C2 creates stray ownerless entities as a side effect of skipped approvals.
- **R8. Implicit HEAD routes.** Fastify exposes HEAD for each v2 GET. They are not in OpenAPI but are auth-protected; HEAD on the callback requires a bearer.

---

## Addendum A - remediation and re-verification (2026-10-19)

Dispatch `task_db47ad01412c` / `ctx_defe66e564fc` fixed exactly C1-C3 and nothing else. It made no edits to migrations, `contracts/schema`, the API bundle, mobile files or production. There was no commit, push or deploy.

### Findings and exact fixes

| # | Fix | Files |
|---|---|---|
| C1 | `isBodyShapeError` now covers `FST_ERR_CTP_INVALID_MEDIA_TYPE`, `FST_ERR_CTP_EMPTY_JSON_BODY` and `FST_ERR_CTP_INVALID_JSON_BODY`, plus HTTP 400 and 415. All of these map to a non-retryable **400 `invalid_request`** in the sealed envelope, with no `Retry-After` header and no error-level log. The batch route uses the same `statusFor`. No enum value was added, and the 413 handling is unchanged. | `src/routes/v2/index.ts:16-20`, `:27`, `:34` |
| C2 | `upsertEntity(db, draft, { ownerId })` writes `owner_id` only on insert. It never changes an existing row's owner. `domain`/`concept` are forced ownerless. Existing callers pass no owner and keep their prior behavior. The friendly-name entity inherits the canonical target's owner. A default merge target inherits the subject root's owner. Before the upsert, an existing `(type, normalized_value)` identity is preflighted with `semanticMergeSkipReason`, so a cross-owner match is skipped **without** rewriting the other owner's description or metadata. That last change closes a pre-existing cross-owner write found while fixing C2. `mergeEntities` and the type/owner preflight are unchanged. | `src/storage/entity-repository.ts:250-283`; `src/storage/entity-alias-repository.ts:437`, `:457`; `src/storage/semantic-repository.ts:342-358`; B18 report "Revision 2" |
| C3 | Replaced `da2a989f?621c` → `da2a989f…621c`, `666af99f?bfb55` → `666af99f…bfb55` and `brain-owra6uznl?` → `brain-owra6uznl…`, matching the file's existing `…` convention. A full-file scan found no other `?`, U+FFFD, `â€` or `Ã` damage, and no claims were changed. The file is UTF-8 with no CR characters. | `docs/reports/v2/execution-status.md:36`, `:39` |

### New regression tests

- **`tests/v2-api.test.ts`: `v2 API missing, unsupported and empty request media types are non-retryable invalid requests`.** Covers POST observations, batch, corrections and queries, and PUT source policy. Each is sent with no content type, `application/xml`, and an empty JSON body. Each must return 400 `invalid_request` validated by the sealed `Error` schema, with `retryable:false`, no `Retry-After`, and no observation stored.
- **`tests/semantic-merge-types.test.ts`:**
  - `owned friendly-name review with an explicit same-owner target merges without an ownerless entity`
  - `owned default-target semantic merge approval creates a same-owner target and merges`
  - `owner-aware creation still fails closed across owners and keeps public taxonomy ownerless`. Checks a cross-owner default target and a cross-owner friendly name, both `pending/entity_owner_mismatch`; that the foreign owner and description are untouched; that no merges happen; and that an owner-supplied `concept` stays ownerless.

### Re-verification command results

| Command | Exit | Result |
|---|---|---|
| `npm run lint` | 0 | No diagnostics |
| `npm run build` | 0 | - |
| `npm run test:isolated` | 0 | **233 / 233 pass**, 0 fail / cancelled / skipped / todo, 306,706 ms. That is the previous 229 plus the 4 new regressions; they ran as ok 123, 124, 125 and 143. |
| Targeted: `node --import ./tests/pglite-setup.mjs --import tsx --test --test-concurrency=1 tests/semantic-merge-types.test.ts tests/semantic-governance.test.ts tests/v2-api.test.ts` | 0 | 43 / 43 pass |
| `npm run contracts:verify` | 0 | PASS 914 checks, 152 fixtures, 7 identity sequences. Bundle unchanged. |
| `NODE_OPTIONS=--import=./contracts/schema/preload-isolated.mjs npm run schema:verify -- --read-only` | 0 | `ok: true`, `problems: []` |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | Fresh migration/reconciliation PASS, 4/4 index control-flow PASS |
| `git diff --check` | 0 | - |
| Independent probe re-run (`probe.mts`) | 0 | 19/19 operations registered, **60/60 checks OK**. Observed error codes are all in the enum, and `unavailable` no longer appears. |
| C1 probe (`probe2/3.mts`) | 0 | Missing content type and `application/xml` on observations and corrections → 400 `invalid_request`, `retryable:false`, no `Retry-After`. JSON over 1 MiB → 413 is still unchanged. |
| C2 probe (`probe4.mts`) | 0 | Owned friendly-name review → `resolved`, with the friendly entity owned by the owner. Owned default-target merge → `approved`, with the target owned by the owner. Explicit same-owner target → `approved`. |

The diff scope is unchanged except for `src/storage/entity-repository.ts`, which this dispatch allows "only if required" and which was needed to make `upsertEntity` owner-aware. No secrets or temporary files were added.

### Updated verdict: **PASS**

C1, C2 and C3 are fixed, and each has a regression test or a direct re-check. Every acceptance command exits 0. Residual limitations R1-R8 from the original report still apply. They are not certification gaps closed by this addendum: in-memory PGlite evidence only, production schema drift, all-scope bearer tokens, and the unfixed `reconcile-semantic-governance.ts:58` cross-type maintenance script. R7's "stray ownerless entities" note is resolved for the two C2 flows. A friendly name or default target that matches an existing *ownerless* legacy identity still fails closed as `entity_owner_mismatch` for owned data; this is intentional, because an upsert never reassigns an owner.
