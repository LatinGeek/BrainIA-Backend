# B04 independent verification

**Verdict: B04 rejected.** The new cleanup helper is scoped, but the subsequent semantic resolver still deletes an unrelated domain's anchor. Required automated checks otherwise passed or returned the expected adapter BLOCKED status.

Date: 2026-10-15. Repository: BrainIA-Backend, branch `main`, HEAD `b71c4cc82ca0faa636db656c729e79cb906a9114`.
Verifier task: `task_3b3b8e973436`; dispatch: `ctx_52473aae8948`. Input implementation report: `docs/reports/v2/B04-r1.md`.
No source edits, dependency installation, commit, production database, external model calls, or BrainIA-Mobile access. All database execution used `tests/pglite-setup.mjs`, which substitutes an in-memory PGlite connection and disables provider credentials.

## Required command results

| Command | Exit code | Independent result |
| --- | ---: | --- |
| `npm run lint` | 0 | TypeScript no-emit validation passed. |
| `npm run build` | 0 | TypeScript compilation passed; normal ignored `dist` outputs generated. |
| `npm run test:isolated` | 0 | 117 tests passed, 0 failed, 0 skipped; duration 205094.9137 ms. |
| `npm run test:v2 -- --suite E02,E03,E05` | 2 | BLOCKED: E02 250, E03 200, E05 100; 0 pass, 0 fail, 550 blocked. Exit independently captured as PowerShell `$LASTEXITCODE=2`. |
| `node --import tsx tests/v2-harness/run.mjs --suite E02,E03,E05 --report tests/v2-harness/artifacts/B04-verification.json` | 2 | Same BLOCKED result, durable independent artifact. |
| `git diff --check -- src/storage/event-store.ts src/storage/event-repository.ts src/storage/job-worker.ts src/storage/financial-transaction-repository.ts` | 0 | No whitespace errors in checked tracked paths. |

V2 evidence: `tests/v2-harness/artifacts/B04-verification.json`; exact required npm command also rewrote authorized `latest.json`. Both report zero external calls, blocked network attempts, and stub calls. `tests/v2-harness/current-adapter.mjs:4` explicitly blocks every non-E01 suite; BLOCKED is not a passing integrated gate.

## Acceptance assessment

| Criterion | Assessment | Exact evidence and limits |
| --- | --- | --- |
| Projection replacement is domain/generation/owner scoped throughout rebuilding | **FAIL** | `event-repository.ts:279-308` scopes the cleanup, but `event-store.ts:542` subsequently calls `resolveEventSemantics`; `semantic-resolver.ts:143-151` calls `upsertEventSemanticAnchor`; `semantic-repository.ts:111` deletes other-domain primary anchors without governance filtering. Independent isolated resolved-path reproduction below confirms loss. |
| Rebuild does not delete financial evidence or canonical rows | **PASS** for exercised paths | No finance deletion in scoped helper; `deleteDerivedDataForEvent` is called only by explicit data controls (`data-controls.ts:91`), not reprocessing. B04 isolated test 114 preserves financial orphans; test 116 preserves rows created after a correction snapshot. A dormant global sweep still exists, described below. |
| Canonical financial ID is stable across classification, semantics, and retry | **PASS** for sequential tested paths | `event-store.ts:587-595` retains an existing observation link, resolving a merge target before rematching; semantic jobs specify `reuseClassification:true, skipFinancial:true` at `job-worker.ts:55`. Tests 113 and 115 pass classification/semantic/retry and consolidated retry identity checks. `event-repository.ts:192-195` updates classification in place. |
| Financial matching is owner scoped | **PASS** | `financial-transaction-repository.ts:883-885` requires anchor owner to equal candidate event owner using `is not distinct from` (including NULL). Test 117 gives identical observations different owners, verifies different transaction IDs, unchanged original-owner row hash, and independent observation counts. This is matching evidence, not an audit of every financial API or historical ownership. |
| Distinct observations and decision revisions are counted independently; no pre-upsert count increment race | **PASS**, with concurrency limitation | Evidence upsert uses raw-event uniqueness (`financial-transaction-repository.ts:943`); count is recomputed **after** upsert using `count(distinct evidence.raw_event_id)` at lines 1178-1192. Owner advisory lock at lines 1129-1130 serializes matching/create/count and matched row is locked at line 908. Merge count also uses distinct raw events at lines 1270-1275. `event-repository.ts:335-341` separates observation count from decision IDs. Test 115 verifies 2 observations versus 3 revisions, then 3 observations after consolidation/retry. PGlite does not certify real multi-connection lock/crash behavior. |
| User financial/classification correction overlays survive reprocessing | **PASS** for tested fields and sequential paths | `correction-projection.ts` loads latest active exact-owner corrections, preserves classification fields before replacement, and reapplies after processing; inferred-kind replay does not clear later exclusion. `event-store.ts:600-619` restores corrected canonical ledger fields after linking a new observation. Test 113 preserves merchant/category/explanation/kind, amount/currency, account/destination fields, exclusion, hidden/merge state while learning is disabled. Test 116 checks snapshot restoration retention. |
| Unrelated-domain/owner hashes remain unchanged | **FAIL** overall | Tests 114, 116, and 117 pass their scoped-helper, other-extractor, and other-owner hash assertions. Independent resolved semantic probe changes an unrelated older-generation Health anchor from one row to none; see exact hashes below. |
| Only authorized implementation paths changed | **UNVERIFIABLE** historically; **PASS** for verifier writes | Repository was substantially dirty on arrival; no pre-B04 filesystem manifest or clean implementation patch was supplied. HEAD diff cannot distinguish earlier/concurrent changes from B04. Implementer's report claims five source/test paths and authorized reports, with no B04 change needed in `job-worker.ts`; this cannot independently prove historical write scope. Verifier captured SHA-256 of all 443 existing tracked/untracked nonignored backend files, excluding `mobile/`, before tests; comparison after tests found only authorized `latest.json` changed before this report and the new independent artifact were written. Final comparison is recorded below. |
| Full E02/E03/E05 application gate | **BLOCKED** | 550 missing application observations; adapters/instrumentation absent. This expected blocker is separate from the confirmed rejection defect. |

## Discrepancies

### HIGH: resolver bypasses cleanup scoping and deletes other-domain/generation anchors

The cleanup itself retains rows outside the selected scope. The following resolver write breaks that invariant:

```sql
-- src/storage/semantic-repository.ts:111
delete from event_semantic_anchors
where event_id = $1 and role = 'primary' and domain_entity_id <> $2
```

It has neither domain authorization nor generation filtering. The same helper's conflict target at lines 115-116 is `(event_id, domain_entity_id)` and overwrites `governance_version`, so older-generation same-domain rows are also not independently preserved on insertion. This is an existing downstream implementation reached by the newly scoped reprocess path, not a source modification by this verifier.

Independent reproduction executed JavaScript through stdin with:

```powershell
# Script passed through stdin, no persistent source/test file created:
... | node --import ./tests/pglite-setup.mjs --import tsx --input-type=module
```

Reproduction procedure:

1. Insert a raw event with a unique owner, plus canonical domain entities `Verifier Health` and `Verifier Finance` using `upsertEntity`.
2. Insert a Health anchor for that event with role `primary`, confidence `0.9`, governance version `older-generation`.
3. Run `replaceSemanticProjection(pool, {eventId, clientId:owner, generation:'verifier-v2', domains:['Verifier Finance']})`.
4. Call `resolveEventSemantics` for the same event/owner with `drafts:[]` and a resolved decision containing one `reuse` path: subject is the existing Finance domain entity, `domain:'Verifier Finance'`, `hierarchyPath:['Verifier Finance']`, `role:'primary'`, `confidence:1`, `steps:[]`, governance/prompt version `verifier-v2`, empty associations/root alternatives/facets/secondary category keys, and null model/primary category. This selects the ordinary `subject.id === parent.id` resolved branch at `semantic-resolver.ts:140`.
5. Query the original Health anchor after each stage.

Observed successful process output:

```json
{"beforeCount":1,"afterScopedCleanupCount":1,"afterResolverCount":0,"beforeHash":"a4d979f2110f500f51c4d91c8acc3fdacf5a163a0dc49564e5867560c3d3e3df","afterHash":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"}
```

Hashes are SHA-256 of JSON-serialized query rows; the second hash is the empty array. An earlier ordinary financial reprocess probe produced no resolved Finance path and retained the Health anchor, illustrating why unresolved-path coverage cannot establish this invariant. The failing resolved-path probe completed with exit 0 because it measured the defect rather than asserting success.

Test coverage gap: `tests/v2-projections.test.ts:65-108` calls only `replaceSemanticProjection` and seeds secondary anchors. It never applies a resolved primary path after cleanup, which explains why all five B04 tests pass despite this defect. Add a regression through cleanup **and** semantic persistence that checks other-domain and older-generation anchor hashes, then define scoped handling compatible with the current single-primary constraint.

### LOW: unused generic/global cleanup remains in source

`financial-transaction-repository.ts:1201-1223` still exports `deleteFinancialTransactionsForEvent`; its second DELETE globally removes eligible orphan financial transactions without event or owner filtering. Repository search found no callers, so this was **not** observed on the rebuild path and is not a second proven runtime failure. `knowledge-fact-repository.ts:66` likewise retains an unused broad fact replacement helper. The implementer's report statement that the broad finance orphan sweep is removed should be understood as removed from the active projection cleanup path, not removed from the codebase.

## Scope, remaining verification, and disposition

Verifier-authored durable outputs: this report and `tests/v2-harness/artifacts/B04-verification.json`; `latest.json` is a normal generated output of the required command. No source files were changed. Final SHA-256 comparison found exactly these three changed/new paths and no others among the captured backend files; historical B04 write attribution remains unverifiable without the implementer's starting snapshot.

Rejection is driven by the reproducible domain/generation preservation failure, not by missing V2 adapters. Required next work: fix the downstream anchor replacement semantics, add resolved-path isolation coverage, repeat B04 verification, and integrate E02/E03/E05 adapters before claiming their full gate. Real PostgreSQL multi-session concurrency and crash behavior remain unverified.
