# B09 independent verification

Date: 2026-10-15. Repository: `D:/Coding/BrainIA/BrainIA-Backend`; branch `main`; HEAD `b71c4cc82ca0faa636db656c729e79cb906a9114`.
Verifier dispatch: `task_f768b7a5d8c8` / `ctx_4edd02aec70a`. Reviewed implementer report: `docs/reports/v2/B09-r1.md`.

## Verdict

**B09 accepted-with-conditions.** The code and isolated evidence satisfy the local schema reconciliation and runtime-DDL retirement requirements. This is not deployment acceptance: real PostgreSQL concurrency/crash recovery, snapshot restore, actual runtime-role permissions, and integrated E11 evidence remain BLOCKED or unverifiable below. No blocking implementation defect was established in the verified scope.

## Independent commands and actual exits

| Command | Exit | Observed evidence |
| --- | ---: | --- |
| `npm run lint` | 0 | TypeScript no-emit check completed. |
| `npm run build` | 0 | TypeScript build completed. |
| `npm run test:isolated` | 0 | 112 tests; 112 passed; zero failures, skips, cancellations or todos; 182397.1401 ms. |
| `npm run test:v2 -- --suite E11` | 1 | BLOCKED: zero passed, zero failed, 90 blocked; generated `tests/v2-harness/artifacts/latest.json`. |
| `npm run schema:verify -- --read-only`, with both `SCHEMA_VERIFY_DATABASE_URL` and `SCHEMA_VERIFY_INSTANCE_ID` unset in that child shell | 1 | `Error: SCHEMA_VERIFY_DATABASE_URL must explicitly identify a disposable local instance`. Refusal precedes pool construction. |
| Same npm verifier command, with `NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'` in that child shell | 0 | `{"ok":true,"readOnly":true,"problems":[]}`. In-memory PGlite transport only. |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | Fresh/partial/repeat migration, runtime SELECT-only assertions, catalog omissions, grants/RLS/checksums, isolated role and mocked concurrent-index control flow all passed. |
| Independent stdin fixture invoking the actual CLI entry point, complete schema | 0 | 43 applied ledger rows; roll-forward filename present; read-only verifier reports no problems. |
| Same independently constructed fixture, pending due index dropped | 1 | Same 43 applied filenames and checksums; `missing object: index:pending_financial_transactions_active_due_idx`. |
| Independent direct replay of roll-forward SQL twice, seeded data | 0 | All public-table row snapshots unchanged, including 43 migration ledger rows and seeded artifact/pending rows. |

The E11 JSON records `externalCalls: 0`, `blockedAttempts: 0`, `stubCalls: 0`; its first case says `No integrated E11 application adapter/instrumentation yet`. Its suite blockers also identify unadjudicated synthetic labels, `real-postgresql-required`, and missing observations for all 90 cases. The nonzero exit is accurately reported as BLOCKED, not a passing migration suite.

## Acceptance assessment

| Criterion | Status | Exact evidence and limits |
| --- | --- | --- |
| Required static/build/isolated commands | PASS | Actual exits and 112-test summary above. |
| Integrated E11 schema/safety certification | BLOCKED | Exit 1; 90/90 cases blocked; no application observations or real PostgreSQL adapter. |
| Explicit disposable-target gate; no configured-URL fallback | PASS | `src/scripts/migrate.ts:125` selects only `SCHEMA_VERIFY_DATABASE_URL` in verify mode; lines 126–129 refuse absent/nonloopback/nonmatching targets before connecting. Missing-target command exits 1. |
| Read-only verification | PASS | `src/scripts/migrate.ts:136` begins repeatable-read/read-only transaction, checks the instance marker, and always rolls back. Independent transport rejects statements other than SELECT/BEGIN/ROLLBACK, after removing SQL line comments. Complete CLI succeeds within that boundary. |
| Applied filenames cannot hide omitted objects | PASS | Independent actual CLI reproduction below retains all 43 rows, including the new migration, but dropping the pending index produces exit 1. |
| Catalog-level reconciliation, definitions and access | PASS (isolated) | 1309 expected catalog identities; implementation suite independently rerun successfully. Real PGlite omissions of table/index/function/trigger, disabled RLS, unexpected table/column/function grants, and changed ledger checksum are detected. Policy/grant omission uses a deliberately extended isolated contract, since current migrations create no policies. The 1309-identity filtered-result test is not 1309 actual DDL mutations. |
| Intelligence runtime schema mutation removed | PASS | `src/storage/intelligence-schema.ts:6` performs one SELECT over catalogs, checks tables/RLS/functions/triggers/indexes/learning constraint and throws `schema_not_ready` at line 30; no DDL, ledger write, dynamic SQL, or migration-file execution. |
| Pending runtime table-sentinel repair removed | PASS | `src/storage/pending-financial-schema.ts:5` SELECT checks table/RLS plus valid/ready due index; line 13 throws without repair. |
| Operations routes cannot invoke former schema repair | PASS | `src/routes/operations.ts:26` retains authenticated legacy URL but calls only the SELECT assertion; process-jobs also calls that assertion. No DDL or alternate schema-repair implementation occurs in this file. Other operations retain their existing business-data work. |
| Additive, idempotent roll-forward; no migration-time data/ledger deletion | PASS (isolated) | New SQL creates omitted objects, replaces functions, recreates triggers/constraints, expands learning values and enforces RLS/revocations. Independent direct SQL replay twice preserves every public-table row snapshot. Runner repeat and partial upgrade tests also pass. See qualification below concerning trigger bodies and access changes. |
| Migration serialization and checksum safety | PASS (source/isolated); BLOCKED (real concurrency) | Dedicated client owns advisory lock `(942017,9)` before ledger inspection through reconciliation (`migrate.ts:89–119`); migration and ledger insert share transaction; legacy checksums filled only after catalog comparison. Real multi-process behavior remains untested. |
| Nontransactional index completion safety | PASS (source/mock); BLOCKED (real PostgreSQL) | Main ledger insert follows `indisvalid && indisready`; existing index requires operator review, with no automatic DROP; failed/invalid cases have no main-ledger write. Four control-flow scenarios passed. No actual concurrent-index/crash test was run. |
| Real PostgreSQL fresh/upgrade/concurrency and dump/restore | BLOCKED | `Get-Command postgres,initdb,pg_ctl,psql,pg_dump -ErrorAction SilentlyContinue` found none on PATH. `docker info` exits 1: missing `//./pipe/dockerDesktopLinuxEngine`. No server installed or daemon started. PATH discovery does not prove binaries exist nowhere else. |
| Actual deployed runtime role cannot CREATE/ALTER | unverifiable | Isolated nonowner role rejects both statements, but ownership, memberships, CREATE grants and effective DML/RLS of the deployed role were not queried. |
| Production/configured databases untouched | PASS (this verifier execution) | No production URL or secret file read; `.env.production.dbcheck` not opened. Tests use reviewed in-memory transports or offline network denial; the untargeted verifier refuses before connection. No network DB connection or production migration was attempted. Cannot independently attest another worker's historical actions. |
| Authorized writes only; preserve existing changes; no commit | PASS (this verifier execution) | Initial dirty tree recorded. Before report creation, full `git status --porcelain=v1 -uall`, `git diff --numstat`, and SHA-256 inventory of `src/`, `migrations/`, `contracts/` matched the baseline exactly. Only this report was authored; normal build and E11 generated outputs were allowed. No source edit, dependency install, commit or forbidden repository access. |
| Implementer limitations accurately stated | PASS | B09-r1 explicitly identifies PGlite/catalog-format limits, mocked index evidence, real-PG/restore/E11 blockers and unverified production permissions. Independent observations reproduce these limitations. |

## Independent omitted-object reproduction

The verifier did not rely only on the implementer's preload or test assertions. A separate transient stdin JavaScript program (`node --import tsx --input-type=module`) performed the following, without writing another file:

1. Created `new PGlite()` with no storage path or network transport, provisioned dummy `anon`/`authenticated` roles and the platform event-trigger stub.
2. Read all 43 migration SQL files in sorted order, executed them, and inserted each filename in `schema_migrations`.
3. Added checksum metadata; independently computed SHA-256 over UTF-8 SQL with CRLF normalized to LF; populated checksums; created the marker table with `b09-independent-verifier`.
4. For the second process only, executed `drop index pending_financial_transactions_active_due_idx`.
5. Queried ledger counts and the new roll-forward filename: output was `ledgerBefore:43`, `ledgerAfter:43`, `rollForwardApplied:1` in both cases.
6. Set a synthetic URL `postgres://127.0.0.1/brainia_b09_independent` and matching marker; replaced `pg.Pool.prototype.connect/end` to route directly to that engine. No TCP service exists at this URL. The transport accepted only SELECT, BEGIN and ROLLBACK after stripping line comments.
7. Set `process.argv` to the absolute actual `src/scripts/migrate.ts` path plus `--verify --read-only` and dynamically imported it, activating its own CLI main and exit-code handling.

Complete fixture output:

```json
{"engine":"independent in-memory PGlite; no TCP","ledgerBefore":43,"ledgerAfter":43,"rollForwardApplied":1,"omitted":false}
{"ok":true,"readOnly":true,"problems":[]}
```

Process exit: **0**.

Omitted-object fixture output:

```json
{"engine":"independent in-memory PGlite; no TCP","ledgerBefore":43,"ledgerAfter":43,"rollForwardApplied":1,"omitted":true}
{"ok":false,"readOnly":true,"problems":["missing object: index:pending_financial_transactions_active_due_idx"]}
```

Process exit: **1**. An initial version of this independent boundary rejected the leading comments of the catalog SELECT and exited 1 for both cases; the boundary was corrected to strip line comments and both cases were rerun with the results above. That preliminary harness failure was not counted as successful drift detection.

## Data preservation and findings

The independent replay fixture inserted a ready answer artifact (`b09_keep`, nonempty JSON content) and a UYU 12.34 pending expense (`b09_pending_keep`), then enumerated every public table and sorted serialized complete row snapshots. It executed `20261015000000_reconcile_runtime_schema.sql` directly twice and required exact equality after each replay. Both comparisons passed, including original ledger timestamps and checksums. This goes beyond a runner retry that merely skips an applied filename; it is still isolated fixture evidence, not arbitrary production-data compatibility or restore evidence.

- **No blocking discrepancy found:** runtime assertions and fail-closed omitted-index detection work as reported.
- **Deployment blocker:** real PostgreSQL multi-process advisory locks, concurrent-index interruption/recovery, version-specific catalog formatting, and isolated `pg_dump`/restore are not certified. Complete them on a matching disposable PostgreSQL before rollout.
- **Deployment blocker:** verify actual nonowner runtime-role ownership, memberships, DDL denial and required DML/RLS behavior before enabling the assertion-only runtime.
- **Verification blocker:** integrate E11 application instrumentation and independently adjudicate its fixtures; 90 blocked cases provide no passing certification.
- **Informational qualification:** “additive” means no migration-time deletion of user tables, rows or ledger history. The SQL deliberately replaces trigger/function/constraint definitions and revokes public API access; it is not access-neutral. Restored invalidation function bodies contain DELETE statements for later privacy-event handling; those bodies are not executed simply by defining the functions. Existing deployments depending on revoked REST-role access require compatibility work, as B09-r1 already states.
- **Informational scope limit:** catalog reconciliation excludes owners/owner ACL entries, ledger/attempt metadata tables, row contents, physical attributes and the platform helper body as documented. Runtime readiness assertions inspect a targeted subset, not the full contract; retain the full read-only verifier as a rollout gate. Production permission certification cannot be inferred from those assertions.

No unresolved discrepancy warrants rejecting the local implementation. Conditions above remain explicit release gates; this verdict does not authorize production access or migration.
