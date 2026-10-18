# B08 independent verification - leased fenced SQL jobs and bounded workers

Status: **accepted-with-conditions** (r2 re-verification, current). The r1 verification is retained below as history.

## Final r2 re-verification (current)

- Repository/HEAD: `D:/Coding/BrainIA/BrainIA-Backend` / `b71c4cc82ca0faa636db656c729e79cb906a9114` (unchanged); tree dirty, concurrent v2 work preserved.
- Inputs: `docs/reports/v2/B08-r2.md`, current `job-repository.ts`/migration/schema, `tests/v2-jobs.test.ts`, `snapshot-backend.json`, and the prior B08 verification.
- Read-only: no source/test/migration/manifest/mobile write. The only repository file updated by this verifier's edits is this report (the required `test:v2` command rewrote its own harness artifact, `tests/v2-harness/artifacts/latest.json`).
- Probes were written by this verifier and run from stdin with `node --import ./tests/pglite-setup.mjs --import tsx --input-type=module -`. No real PostgreSQL, Docker daemon, production DB or external provider was contacted.
- Real multi-connection PostgreSQL remains **BLOCKED** (`realPostgresConcurrency: BLOCKED`; Docker daemon unreachable). PGlite is a single in-memory engine.

### Command exits (r2)

| Command | Exit | Observed |
|---|---:|---|
| `npm run lint` | 0 | no diagnostics |
| `npm run build` | 0 | no diagnostics |
| `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-jobs.test.ts` | 0 | 11 tests / 11 pass / 0 fail |
| `npm run test:isolated` | 0 | 159 tests / 159 pass / 0 fail / 0 skipped |
| schema verify with `NODE_OPTIONS` preload | 0 | `{"ok":true,"readOnly":true,"problems":[]}` |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | 49 migrations / 1816 catalog objects; ACL/drift/partial-ledger/idempotency PASS; real-PG and pg_dump/restore BLOCKED |
| `npm run contracts:verify` | 0 | 382 checks; 58 fixtures; 7 identity sequences; bundle `312c92f8...abad6` |
| `npm run test:v2 -- --suite E07,E03` | 2 | E07 0/0/2000 blocked; E03 0/0/200 blocked; exit correctly recorded as 2 |

### R1 - serialized claims and live-lease re-check: PASS at repository/SQL level

Both claim paths now take `pg_advisory_xact_lock(hashtextextended('brainia:job-claim', 0))` before their statement, and both outer `UPDATE`s re-check `CLAIMABLE_JOB_SQL`, not only the selected id.

Independent guarded snapshot model (snapshot while queued, inline claim commits at fence 1, then the production-shaped guarded outer `UPDATE`):

```
before={"status":"running","fence":1,"attempt_count":1,"locked_by":"inline-racer"}
guardedRowCount=0
after ={"status":"running","fence":1,"attempt_count":1,"locked_by":"inline-racer"}
```

Control with the pre-fix id-only predicate: `rowCount=1`, fence advanced to 2, attempt_count 2. This proves the guard is the discriminator.

Five interleaved `Promise.all([claimBackgroundJobs, claimBackgroundJob])` rounds each produced exactly one winner, `attempt_count=1`, `fence=1`, and one attempt row; the winner completed. The advisory lock is code-visible in both paths. **Real multi-connection PostgreSQL remains BLOCKED**, so this is a function/SQL-level reproduction, not two independent sessions with snapshots.

### R2 - service table lockdown: PASS

```
background_job_leases:  relrowsecurity=true,  forceRls=false, policies=0, public grants=0, brainia_runtime grants=0
background_job_replays: relrowsecurity=true,  forceRls=false, policies=0, public grants=0, brainia_runtime grants=0
ACL: owner-only (postgres=arwdDxtm/postgres)
```

The new migration `20261017160000_job_service_table_lockdown.sql` enables RLS and explicitly revokes from `public`, `anon` and `authenticated` (the latter guarded by `pg_roles`). It intentionally creates no owner policy and no `brainia_runtime` grant. Migration review: no destructive data DDL; the only DROP across the two B08 migrations is the check-constraint replacement in `20261017140000`. Schema contract: 49 migrations / 1816 objects, both relation entries `rls:true`, no new ACL/policy objects. `schema:verify` and `contracts:verify` pass.

### R3 - reviveFailed preserves history: PASS (new compatibility note)

Dead-lettered attempt 1 at fence 1, then `reviveFailed:true`:

```
reviveRow={"status":"queued","attempt_count":1,"fence":1,"max_attempts":2,"dead_lettered_at":null}
history after revive=[{"attempt":1,"status":"dead_letter","fence":1}]
new claim={"attempt":2,"fence":2}
final history=[{"attempt":1,"status":"dead_letter","fence":1},{"attempt":2,"status":"succeeded","fence":2}]
```

Attempt count and fence are preserved, budget is extended, and history is intact. `recordClaim` no longer upserts `(job_id, attempt)`.

**New compatibility note:** a row revived by the pre-r2 code and never claimed can have `attempt_count=0` while attempt 1 history exists. Under the new no-upsert rule, the next claim fails with `23505 duplicate key ... background_job_attempts_job_id_attempt_key` and leaves the job queued. `reviveFailed` has no route caller, so this is latent, but such rows need a one-time repair (`attempt_count = max(attempt)`) before a poll can claim them.

### R4 - report corrections and authorization: PASS

- `B08-r2.md` records `test:v2` exit **2**, matching the observed exact exit; the r1 table entry (`1`) is explicitly superseded.
- `contracts/schema/manifest.json` and `tests/v2-jobs.test.ts` are documented as out-of-reservation, supervisor-authorized writes, with manifest regeneration required by `schema:verify` drift.
- This verifier found no additional out-of-bound B08 source write.

### Regression A-I (current)

- **A lease expiry: PASS.** First poll after real expiry claimed/succeeded; second poll 0; old completion `StaleJobClaimError`; attempts `[1 abandoned, 2 succeeded]`; fences 1 -> 2.
- **B stale fence: PASS** for fenced effects. Zero effect callbacks; heartbeat `null`; complete/fail `StaleJobClaimError`; job state unchanged at fence 2.
- **C capacity: PASS in PGlite.** One claim per owner, zero while busy, parallel claims distinct, global cap wins, per-owner cap holds; legacy null-owner jobs share one scope and one per-owner slot. Five interleaved rounds one winner (R1).
- **D atomic completion: PASS.** Failed effect rolled back status/lease/downstream enqueue; retry completion succeeded.
- **E finance: PASS on idempotency; stale projection still disclosed.** E1 retry produced 1 canonical transaction, 1 evidence row, 1 semantic job. E2 stale execution after fence 2 still created 1 transaction + 1 evidence row, published no downstream effect (`semantic=0`), and the live attempt produced no duplicate (`1/1/1`).
- **F dead letter/replay: PASS.** Dead-letter, replay ledger, preserved attempts/fence, new attempt and one downstream effect.
- **G inline settlement: PASS.** Live cron attempt untouched; after expiry inline took fence 2 and completed; old cron completion stale.
- **H migration: PASS.** Additive; only the check-constraint replacement; RLS/ACL as R2; schema verify clean.
- **I scope: PASS with authorized deviations.** See scope list below.

### Scope vs snapshot

94 changed paths versus `snapshot-backend.json` after excluding `node_modules`, `.git`, `dist`, `graphify-out`, `.laya-venv`, `.vercel`, logs, env files and `supabase/.temp`. B08 r2-attributable writes are `src/storage/job-repository.ts` (reserved), `migrations/20261017160000_job_service_table_lockdown.sql` (B08 migration), `contracts/schema/manifest.json` (out-of-reservation, supervisor-authorized), `tests/v2-jobs.test.ts` (out-of-reservation, supervisor-authorized), `docs/reports/v2/B08-r2.md` and this report. `graphify-out/*` was regenerated by the r2 `graphify update` (generated artifact); `tests/v2-harness/artifacts/latest.json` was rewritten by the required `test:v2` command. No B08-attributable write to mobile, auth, app, other routes, financial files or another repository was found. The remaining paths are concurrent B04/B05/B06/B07 or pre-existing uncommitted work and are not attributed to B08.

Full changed-path list (all categories):

```text
A docs/reports/v2/B04-r2.md
A docs/reports/v2/B04-verification-r2.md
A docs/reports/v2/B05-r1.md
A docs/reports/v2/B05-r2.md
A docs/reports/v2/B05-verification.md
A docs/reports/v2/B06-r1.md
A docs/reports/v2/B06-r2.md
A docs/reports/v2/B06-r3.md
A docs/reports/v2/B06-verification.md
A docs/reports/v2/B07-r1.md
A docs/reports/v2/B07-r2.md
A docs/reports/v2/B07-r3.md
A docs/reports/v2/B07-verification.md
A docs/reports/v2/B08-r1.md
A docs/reports/v2/B08-r2.md
A docs/reports/v2/B08-verification.md
A docs/reports/v2/G1-decision-package.md
A docs/reports/v2/baseline-snapshot.md
A docs/reports/v2/execution-status.md
A docs/reports/v2/snapshot-backend.json
A docs/reports/v2/snapshot-mobile.json
A migrations/20261017100000_owner_identity.sql
A migrations/20261017110000_owner_rls.sql
A migrations/20261017120000_owner_runs.sql
A migrations/20261017130000_privacy_policy_versioning.sql
A migrations/20261017140000_job_leases_fences.sql
A migrations/20261017160000_job_service_table_lockdown.sql
A src/scripts/backfill-ownership.ts
A src/storage/ownership.ts
A tests/v2-authorization.test.ts
A tests/v2-harness/artifacts/B04-r2.json
A tests/v2-harness/artifacts/B05-r1.json
A tests/v2-harness/artifacts/B06-r1.json
A tests/v2-jobs.test.ts
A tests/v2-ownership.test.ts
A tests/v2-privacy-boundary.test.ts
M contracts/schema/manifest.json
M contracts/schema/verify.test.mjs
M docs/reports/v2/approvals.json
M package.json
M src/app.ts
M src/auth.ts
M src/routes/agent-inspect.ts
M src/routes/capture.ts
M src/routes/client-diagnostics.ts
M src/routes/digests.ts
M src/routes/entity-aliases.ts
M src/routes/entity-merge.ts
M src/routes/entity-resolve.ts
M src/routes/entity-semantic-profile.ts
M src/routes/events.ts
M src/routes/financial-transactions.ts
M src/routes/graph.ts
M src/routes/insights.ts
M src/routes/intelligence.ts
M src/routes/knowledge.ts
M src/routes/metrics.ts
M src/routes/operations.ts
M src/routes/privacy.ts
M src/routes/search.ts
M src/routes/semantic.ts
M src/scripts/evaluate-laya.ts
M src/storage/agent-inspect.ts
M src/storage/classification-assistant.ts
M src/storage/data-controls.ts
M src/storage/deepseek.ts
M src/storage/digest-repository.ts
M src/storage/digests.ts
M src/storage/embeddings.ts
M src/storage/entity-alias-repository.ts
M src/storage/entity-repository.ts
M src/storage/event-repository.ts
M src/storage/event-store.ts
M src/storage/financial-transaction-repository.ts
M src/storage/hybrid-retrieval.ts
M src/storage/insight-repository.ts
M src/storage/insights.ts
M src/storage/intelligence.ts
M src/storage/jev.ts
M src/storage/job-repository.ts
M src/storage/job-worker.ts
M src/storage/knowledge-fact-repository.ts
M src/storage/postgres.ts
M src/storage/privacy.ts
M src/storage/proactive-insights.ts
M src/storage/relation-repository.ts
M src/storage/search-repository.ts
M src/storage/semantic-enrichment.ts
M src/storage/semantic-reconciler.ts
M src/storage/semantic-repository.ts
M src/storage/semantic-resolver.ts
M tests/intelligence.test.ts
M tests/v2-harness/artifacts/latest.json
M tests/v2-projections.test.ts
```

### Updated conditions and verdict

The four r2 conditions are resolved at repository/SQL level: R1 guarded claims and shared lock; R2 RLS plus explicit revokes; R3 preserved revive history; R4 corrected exit and documented authorization. No reproducible double-claim, stale fenced effect, duplicate finance effect or atomicity failure was observed in PGlite. The stale main-work projection from probe E2 remains open and disclosed (idempotent, no duplicate); real multi-connection PostgreSQL and E07/E03 remain BLOCKED; cooperative stage cancellation remains. The pre-r2 revived-row compatibility edge above is a new latent condition. Therefore the verdict remains **accepted-with-conditions**, with the remaining conditions being the stale projection acceptance/closure, real-PG E07 validation, and repair of pre-r2 revived rows.

## Historical r1 verification

Verifier is distinct from the implementer. No source, test source, migration, manifest, mobile or production database was modified. The only repository file created is this report (the required `test:v2` command rewrote its own harness artifact). All probes used isolated PGlite and in-process scripts from stdin; no real PostgreSQL, Docker daemon, external provider or production database was contacted.

## Repository and method

- Repository: `D:/Coding/BrainIA/BrainIA-Backend`
- Branch/HEAD: `main` / `b71c4cc82ca0faa636db656c729e79cb906a9114` (matches `snapshot-backend.json`)
- Tree: dirty; pre-existing/concurrent v2 changes preserved.
- Snapshot reference: `captured_at_utc 2026-10-17T18:18:16Z`, `manifest_sha256 ea41cb127802a821d01e1991e0f1fd03684214d9342c47552c699695c25cb444`.
- Inputs: task specification lines 316-347; `docs/BRAIN_AI_V2_EVALUATION.md` (E07/E03); `docs/reports/v2/B08-r1.md`; migration `20261017140000_job_leases_fences.sql`; `src/storage/job-repository.ts`, `job-worker.ts`, `event-store.ts`; `src/routes/operations.ts`; `tests/v2-jobs.test.ts`; B06/B07 owner/privacy models; snapshot.
- Independent probes were written by this verifier and passed to `node --import ./tests/pglite-setup.mjs --import tsx --input-type=module -`. They do not reuse the implementer's test file.
- Real multi-process PostgreSQL is **BLOCKED**: `contracts/schema/verify.test.mjs` reports `realPostgresConcurrency: BLOCKED`, and `docker info` cannot reach a daemon (`//./pipe/dockerDesktopLinuxEngine` absent). PGlite is a single in-memory engine.

## Command exits (exact)

| Command | Exit | Observed |
|---|---:|---|
| `npm run lint` | 0 | `tsc -p tsconfig.json --noEmit`; no diagnostics. |
| `npm run build` | 0 | `tsc -p tsconfig.json`; no diagnostics. |
| `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-jobs.test.ts` | 0 | `tests 7 / pass 7 / fail 0`. |
| `npm run test:isolated` | 0 | `tests 155 / pass 155 / fail 0 / skipped 0`. |
| `$env:NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'; npm run schema:verify -- --read-only` | 0 | `{"ok":true,"readOnly":true,"problems":[]}`. |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | `PASS fresh migration and read-only reconciliation`; 48 migrations / 1816 catalog objects; ACL/drift/partial-ledger/idempotency PASS; real-PostgreSQL and pg_dump/restore BLOCKED. |
| `npm run contracts:verify` | 0 | `PASS 382 contract checks; 58 positive/negative schema+semantic fixtures; 7 identity sequences.` Bundle SHA-256 `312c92f8...abad6`. |
| `npm run test:v2 -- --suite E07,E03` | 2 | `E07: BLOCKED; 0 pass / 0 fail / 2000 blocked of 2000`; `E03: BLOCKED; 0 pass / 0 fail / 200 blocked of 200`. Expected BLOCKED, but r1's table records exit **1**; the observed exact exit is **2**. |

## Independent probes A-I

### A. Lease expiry recovery (PASS in PGlite)

Claimed a `retention` job with worker A (`fence=1`, `attempt=1`, 1 s lease), waited until the lease was actually expired (`now() > lease_expires_at`), then ran the real worker poll (`processBackgroundJobs`) for the retention type.

```
poll1 claimed=1 results=[{"status":"succeeded"}] elapsed=19ms
poll2 claimed=0
oldAttemptSettle=StaleJobClaimError
job={"status":"succeeded","attempt_count":2,"fence":2}
attempts=[{"attempt":1,"status":"abandoned","fence":1},{"attempt":2,"status":"succeeded","fence":2}]
leases=[{"fence":1,"release_reason":"expired"},{"fence":2,"release_reason":"completed"}]
```

Recovery happened on the first poll after expiry (well within lease plus two polls), the old attempt could not settle, and the fence advanced. This is repository-level PGlite evidence, not the E07 20x100 multi-process matrix.

### B. Stale fence has zero fenced effects (PASS)

Worker A claimed at fence 1, the lease was expired, worker B reclaimed at fence 2. Then, using the stale claim object:

- `completeBackgroundJob(stale, effect)` threw `StaleJobClaimError`; the effect callback was never invoked (`effectCalls=0`) and zero downstream rows were created.
- `failBackgroundJob(stale, ...)` threw `StaleJobClaimError`.
- `heartbeatBackgroundJob(stale, ...)` returned `null`.
- Job state before and after the stale calls was identical: `status=running`, `fence=2`, `locked_by=worker-b`, same `lease_id`, `attempt_count=2`.
- Attempts: `[1 abandoned fence1, 2 running fence2]`; lease 1 closed, lease 2 open.

This proves the fenced completion/fail/heartbeat/downstream-enqueue paths publish zero effects. It does not cover `executeBackgroundJob` main-work writes; see probe E2.

### C. Capacity and double-claim limits (PASS in PGlite; real PG BLOCKED)

Two owners x five retention jobs, `globalCapacity=4`, `perOwnerCapacity=1`:

```
firstClaim=2 (one per owner)
whileBusy=0
parallelClaims=2 distinct=2 owners=2
activeByScope=[{ownerA:1},{ownerB:1}]
globalCapacityWin=1
perOwnerBound=2 (one per owner)
```

Five rounds of interleaved same-job claims (`Promise.all` of an inline claim and a poller claim) produced exactly one winner per round, one attempt, one fence.

PGlite is a single engine. The real `SKIP LOCKED`/multi-process claim behavior is **BLOCKED**, and a predicate-level inline/poller race is flagged below as a conditional vulnerability.

### D. Atomic completion plus effect (PASS)

Completion with an effect that enqueued a downstream job and then threw rolled back everything:

```
effectRan=1 downstream=0
before={"status":"running","fence":1,"lease_id":"lease_...","attempt_count":1}
after ={"status":"running","fence":1,"lease_id":"lease_...","attempt_count":1}
attempt=running leaseOpen=true
retryCompletion=succeeded
```

The guarded status update, effect and downstream enqueue are one transaction; a failed effect leaves the job running and the attempt/lease open.

### E. Finance idempotency and the admitted projection gap

**E1 - retry idempotency (PASS):** classified an expense event, executed attempt A, expired its lease, reclaimed with attempt B, re-executed and completed B. Result:

```
counts={"tx":1,"evidence":1,"semantic":1} status=succeeded
```

One canonical financial transaction, one evidence row, one downstream semantic job across crash/retry.

**E2 - stale execution projection (confirmed gap):** with attempt A at fence 1, the lease was expired and attempt B claimed at fence 2. Then the stale attempt A's `executeBackgroundJob` was invoked while fence 2 was current:

```
pre={"tx":0,"evidence":0,"semantic":0}
postStaleExec={"tx":1,"evidence":1,"semantic":0}
execution.effects.length=1 (returned but never invoked; semantic job count stayed 0)
live={"status":"running","fence":2,"locked_by":"e-b"}
postLiveComplete={"tx":1,"evidence":1,"semantic":1}
```

The stale attempt committed a financial transaction and evidence row after losing its fence. It published no downstream `JobEffect` (semantic count stayed 0), and the live attempt later produced no duplicate (still one canonical row and one evidence row). This is exactly the limitation admitted in `B08-r1.md`; it is a confirmed out-of-fence main-work write, not a duplicate finance effect.

### F. Dead letters and replay (PASS)

`maxAttempts=1`, claim, deterministic failure:

```
dead={"status":"dead_letter","attempts":1,"fence":1,"gen":0,"maxAttempts":1,"dead_lettered_at":...}
replayed={"status":"queued","attempts":1,"fence":1,"gen":1,"max":2}
replay={"previousStatus":"dead_letter","previousAttemptCount":1,"previousFenceToken":1,...}
newFence=2
history=[{"attempt":1,"status":"dead_letter","fence":1,"gen":0},
         {"attempt":2,"status":"succeeded","fence":2,"gen":1}]
leases=[{"fence":1,"release_reason":"dead_letter"},{"fence":2,"release_reason":"completed"}]
downstream=1
```

Dead-letter state, attempt/fence history and the replay ledger are preserved; replay creates a new attempt and does not duplicate the downstream effect.

### G. Inline path (PASS for fencing)

A cron worker claimed at fence 1. `settleInlineBackgroundJob` while the lease was live left the attempt untouched:

```
inlineWhileLive status=running lockedBy=cron-worker fence=1
attemptsAfterLive=1
```

After the cron lease was expired, inline settlement claimed fence 2 and completed; the old cron completion then threw `StaleJobClaimError`:

```
inlineAfterExpiry status=succeeded fence=2
oldCronSettle=StaleJobClaimError
attempts=[{"attempt":1,"status":"abandoned","fence":1},{"attempt":2,"status":"succeeded","fence":2}]
```

Inline settlement shares the same lease/fence contract and cannot settle another worker's live attempt.

### H. Migration, schema and ACLs

Migration text review:

```
destructivePatterns=[]            (no DROP TABLE, TRUNCATE, DELETE FROM, DROP COLUMN, DROP SCHEMA, ALTER COLUMN TYPE)
drops=["drop constraint if exists background_job_attempts_status_check"]
adds=11  creates=2  indexes=7
```

The only DROP is a check-constraint replacement that widens the attempt status enum to include `abandoned`; no data is deleted or rewritten. All new columns are nullable or defaulted; new tables are additive. Schema verify is clean.

ACL/RLS state in the isolated schema:

```
background_job_leases:  relrowsecurity=false, runtime_select=false, runtime_insert=false, anon_select=false, auth_select=false
background_job_replays: relrowsecurity=false, runtime_select=false, runtime_insert=false, anon_select=false, auth_select=false
in B06 owner policy list: false
```

The new service tables are **not** in the B06 owner-isolation policy list and have no RLS. In isolated PGlite they also have no `anon`/`authenticated` grants, and `brainia_runtime` has no grants on them (the `grant ... on all tables` in `20261017110000_owner_rls.sql` ran before these tables existed). The report's "access remains through the existing worker/admin DB role" is accurate, but the migration does not explicitly `revoke` from `anon`/`authenticated`; in a Supabase deployment with the standard default privileges for new public tables, those roles could receive grants and the tables would be readable/writable because RLS is off. The schema verifier's ACL drift cases would flag unexpected grants if run against the deployed schema, which is a mitigating control, not a substitute for an explicit revoke.

### I. Scope

Files modified in the B08 work window (19:40-20:10 local) versus the snapshot:

```
migrations/20261017140000_job_leases_fences.sql
src/storage/job-worker.ts
src/storage/event-store.ts
src/routes/operations.ts
contracts/schema/manifest.json
tests/v2-jobs.test.ts
src/storage/job-repository.ts
docs/reports/v2/B08-r1.md
```

All code files are inside the B08 exclusive reservation. `contracts/schema/manifest.json` and `tests/v2-jobs.test.ts` are outside the literal reservation but are declared in r1; the manifest is required because `schema:verify` fails closed on drift, and the test is the declared regression evidence. No mobile, auth, app, financial or other-task source write is attributable to B08. `src/storage/postgres.ts` (in reservation), `src/scripts/process-jobs.ts` and `vercel.json` were not modified by B08. The rest of the dirty tree contains concurrent B04/B05/B06/B07 work, generated graphify output, local venv/deploy artifacts and logs; hash comparison cannot attribute those to B08 and this verifier does not.

## Acceptance assessment

| Acceptance criterion | Result | Evidence |
|---|---|---|
| Every E07 crash recovers within lease plus two polls | PASS in PGlite | Probe A: first poll after expiry reclaimed and succeeded; old attempt stale. E07 suite itself is BLOCKED. |
| Stale attempt publishes zero effects | PASS for fenced effect publication; condition on main-work projection | Probe B: stale complete/fail/heartbeat/downstream all zero-effect. Probe E2: stale execution can still commit a financial projection/evidence row (admitted). |
| Finance side effects not duplicated | PASS | Probe E1/E2: one canonical transaction, one evidence row, one semantic job; stale write remains idempotent. |
| No serial overclaim backlog | PASS in PGlite; real-PG condition | Probe C: global/per-owner bounds and interleaved claims hold. Probe C race model: inline/poller predicate is unguarded; real multi-connection reproduction BLOCKED. |
| Additive lease/fence migration and schema | PASS | Probe H and `schema:verify` / `verify.test.mjs`: no destructive data DDL, 11 columns, 2 tables, 7 indexes, 48 migrations/1816 objects. |
| Dead letters, replay and history | PASS | Probe F: dead-letter, replay generation, attempt/fence preservation, new attempt, one downstream effect. |
| Inline claims share lease/fence | PASS for fencing | Probe G: inline cannot settle a live cron attempt and takes a new fence after expiry. Capacity is intentionally bypassed by inline claims. |
| No out-of-bound writes | PASS with declared deviations | Probe I: only reserved code files plus the declared manifest/test/report. |

## Assessment of B08-r1 limitations

| Admitted limitation | Verifier finding | Classification |
|---|---|---|
| E07/E03 still BLOCKED; no crash-schedule adapter or finance lifecycle corpus | Confirmed: `test:v2` exits 2 with E07 2000/2000 and E03 200/200 blocked. r1's exit column says 1; exact exit is 2. | Accurate, minor reporting error. |
| PGlite cannot certify real PostgreSQL concurrency | Confirmed: Docker daemon absent; `verify.test.mjs` marks real-PG BLOCKED. | Accurate. |
| Host cancellation is cooperative | Confirmed by code: `Promise.race` does not cancel the underlying provider/DB promise; fenced completion/publication is suppressed, but pre-completion writes can continue. | Accurate but understated: any `executeBackgroundJob` DB write can outlive the stage deadline. |
| Finance projection is not fully inside the completion transaction | Confirmed by probe E2: a stale fence created `financial_transactions` and `financial_transaction_events` after fence 2 was current. It remains idempotent; no duplicate canonical row. | Accurate; confirmed out-of-fence write, not a duplicate effect. |
| Legacy owner scope uses `coalesce(owner_id, client_id, '<global>')` | Confirmed: `enqueueBackgroundJob` never sets `owner_id`; null-owner jobs share the `'<global>'` scope and are capped together. | Accurate. |
| New internal tables have no RLS policy | Confirmed, and additionally: no explicit `anon`/`authenticated` revoke; `brainia_runtime` has no privileges on the new tables because the grant-all predates them. | Accurate but incomplete; see conditions. |
| No real dead-letter/operator replay runbook test | Confirmed: repository-level replay/dead-letter passes; no operational runbook/alerting evidence. | Accurate. |

## Confirmed defects, conditional vulnerabilities, mitigating controls, unverified assumptions

### Confirmed defects

1. **Stale execution can write finance projection/evidence outside the fence (admitted).** Probe E2 is a full function-level reproduction: stale fence 1, current fence 2, `executeBackgroundJob` created one canonical transaction and one evidence row. This is a deviation from a strict "old fence affects zero rows" reading of E07, but not from the task's effect-callback/downstream-enqueue definition, and it did not duplicate finance.
2. **New service tables are outside the B06 RLS/grant model.** `background_job_leases` and `background_job_replays` have `relrowsecurity=false`, no owner policy, no explicit `revoke` from `anon`/`authenticated`, and no `brainia_runtime` grants. Isolated PGlite has no public grants, so exposure is conditional on the deployment's default privileges; in standard Supabase defaults, public roles could inherit grants and read/write these rows because RLS is off.
3. **r1 exit table mismatch.** `npm run test:v2 -- --suite E07,E03` exits 2, not 1. BLOCKED is expected; the recorded exit is inaccurate.

### Conditional vulnerabilities

1. **Inline/poller claim race can overclaim the same job.** `claimBackgroundJob` does not take the `brainia:job-claim` advisory lock used by `claimBackgroundJobs`. The poller's `selected` CTE is evaluated from the statement snapshot, and its outer `UPDATE ... FROM selected` predicate is only `job.id = selected.id`, with no `status`/`lease_expires_at` guard. A SQL-level interleaving model (snapshot while queued, inline claim, then the exact outer UPDATE) re-claimed the already-running live-lease row from fence 1/attempt 1 to fence 2/attempt 2. Real two-connection reproduction is BLOCKED; the function-level race is therefore conditional, but the missing guard is code-visible. This is the highest-priority condition.
2. **Cooperative stage timeout.** An underlying `executeBackgroundJob` promise can continue after `StageDeadlineError`; its classification/embedding/correlation/insight writes are not cancelled. The worker fences completion, not the in-flight work.
3. **Other job types also write before completion.** `embedding`, `financial_correlation`, `insight_detection`, `semantic_reconciliation`, `retention` and `backup_verification` execute their main work before `completeBackgroundJob`; a stale attempt can commit those writes even though its effect callbacks are fenced. The r1 limitation mentions only classification/finance.
4. **Supabase default ACL exposure.** As above, the absence of an explicit revoke is only safe if deployment defaults do not grant public roles, or if `schema:verify` is run against the deployed schema and fails closed.

### Mitigating controls

- Fence-guarded `complete`/`fail`/`heartbeat` with `running` status, current fence, worker id and unexpired lease; zero-row updates raise `StaleJobClaimError` before effects.
- Transaction-scoped `pg_advisory_xact_lock` serializes poller capacity/claim statements; `FOR UPDATE SKIP LOCKED` on the inline target.
- Completion effect and downstream enqueue run in the same transaction (probe D).
- Finance linking uses a per-owner advisory lock and idempotent evidence/canonical lookup (probe E1).
- Unique `(job_type, idempotency_key)` and lease `(job_id, fence_token)` constraints.
- `schema:verify` fails closed on schema/ACL drift; `contracts:verify` passes.
- B06 RLS covers `background_jobs`; operations/cron endpoints require their configured tokens.

### Unverified assumptions

- Real PostgreSQL multi-process `SKIP LOCKED`, lease races, advisory-lock behavior, server restart and RLS role persistence; all BLOCKED.
- E07 20x100 interruption matrix with two workers and E03 finance lifecycle corpus; adapters are absent, so no suite credit.
- Supabase's actual default privileges for new public tables.
- Deployed Vercel duration limit versus the default 45 s host deadline.
- `enqueueBackgroundJob(..., reviveFailed:true)` is unused, but it resets `attempt_count` to 0 and the next claim's `on conflict (job_id, attempt) do update` overwrites the historical attempt 1 row (observed: `dead_letter` attempt 1 became `running` fence 2). This is pre-existing, not B08-attributable, but it conflicts with the new attempt-history goal if that API is ever used.

## New defects

1. **New (conditional) - inline/poller double-claim predicate.** Exact SQL-level evidence above; not reproducible through two real connections because real PostgreSQL is BLOCKED. Fix by taking the same advisory lock in `claimBackgroundJob`, or by adding a `status`/`expired-lease` predicate to the poller's outer `UPDATE`, and add a two-connection regression.
2. **New (conditional) - new tables outside RLS and public-role grants.** r1 mentions RLS but not the missing explicit revoke or the absent `brainia_runtime` grants. Add `revoke all ... from anon, authenticated` and either owner columns/policies or a documented default-deny, and grant the runtime role only if an owner-scoped path needs it.
3. **New (latent, pre-existing) - reviveFailed overwrites attempt 1 history.** Unused today; document or remove.
4. **New (minor) - r1 command exit mismatch.** `test:v2` exits 2, not 1.

## Conditions for clean acceptance

1. Close or explicitly accept the stale main-work projection gap: move classification/finance projection (and the other pre-completion writers) under the completion fence, or record an approved scope exception with a stale-execute E07 regression. Do not claim "stale attempt affects zero rows" until then.
2. Fix and test inline/poller claim serialization on real PostgreSQL. Add a two-connection regression that claims the same job inline and via the poller at the snapshot/update boundary. If the race is confirmed, this is a rejection-level double-claim.
3. Add an explicit `revoke all on background_job_leases, background_job_replays from anon, authenticated`; decide RLS/owner-column treatment; grant `brainia_runtime` only if needed. Add schema checks for these ACL/RLS expectations.
4. Run the real-PostgreSQL E07 (>=20 schedules x 100 repetitions, two workers) and E03 lifecycle suites; record exact exits. Current E07/E03 are BLOCKED, not passed.
5. Correct the r1 command-exit table (2 vs 1) and record supervisor approval for the out-of-reservation `contracts/schema/manifest.json` and `tests/v2-jobs.test.ts` writes.
6. Decide the `reviveFailed` history semantics before it is used operationally.

## Verdict rationale

**accepted-with-conditions**, not rejected. Under the task's effect-publication definition (the guarded completion/fail/heartbeat path and the downstream `JobEffect` enqueue), no stale fence published an effect, no finance row was duplicated, and completion plus effect rolled back atomically when forced to fail. The reproducible stale write is the admitted finance/main-work projection, which is idempotent and does not meet the duplicate-finance or atomicity triggers. The inline/poller race is the most serious new finding; its predicate is unguarded, but without a real two-connection reproduction it remains a condition, not a confirmed double-claim. If real PostgreSQL confirms that race, the verdict flips to **rejected**. If acceptance requires literal zero row writes by an old fence, the stale projection in probe E2 is also rejection-level.

## Notes on evidence quality

- All runtime probes used isolated PGlite via `tests/pglite-setup.mjs`; no configured/live database, production database, provider or external HTTP call was used.
- The PGlite pool adapter shares one engine, so `Promise.all` interleaving is not true isolation. The inline/poller SQL model is explicitly labelled as a predicate-level model, not a two-connection reproduction.
- No dependency install, commit, migration application to production, or source/test edit was performed by this verifier.
- The required `npm run test:v2 -- --suite E07,E03` rewrote `tests/v2-harness/artifacts/latest.json`; this is harness-generated output, not a source edit by this verifier.
