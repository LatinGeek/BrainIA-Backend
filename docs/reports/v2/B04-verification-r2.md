# B04 independent verification — remediation round 2

**Verdict: accepted-with-conditions.** The HIGH defect from `docs/reports/v2/B04-verification.md` is fixed: a resolved Finance primary path no longer deletes an unrelated older-generation Health primary anchor, and the attempted transition is durably recorded as a pending `semantic_candidates` review path. The two dormant global-sweep helpers named in the prior LOW finding are gone. All three B04 acceptance criteria pass under isolated PGlite execution. Acceptance is conditional because E02/E03/E05 remaining BLOCKED, real PostgreSQL multi-connection/crash behavior, and production deployment are outside what this environment can certify.

Date: 2026-10-17. Repository: `D:/Coding/BrainIA/BrainIA-Backend`, branch `main`, HEAD `b71c4cc82ca0faa636db656c729e79cb906a9114`, dirty working tree (unchanged HEAD before and after this verification).
Inputs re-read independently: B04 spec (lines 189–218), `B04-verification.md`, `B04-r1.md`, `B04-r2.md`, `snapshot-backend.json`. Implementer claims were treated as claims.
No source, test, migration, package-file, or mobile edit was made. No dependency installation, commit, production database access, or external model call occurred. The only file this verifier created is this report. All database execution used `tests/pglite-setup.mjs` (in-memory PGlite; provider keys blanked). The implementation probes were JavaScript piped through stdin, not the new regression test.

---

## 1. Required commands

| Command | Exit | Actual output (verbatim essentials) |
| --- | ---: | --- |
| `npm run lint` | **0** | `> tsc -p tsconfig.json --noEmit` — completed with no diagnostics. |
| `npm run build` | **0** | `> tsc -p tsconfig.json` — completed with no diagnostics. |
| `npm run test:isolated` | **0** | `# tests 118` / `# pass 118` / `# fail 0` / `# cancelled 0` / `# skipped 0` / `# todo 0` / `# duration_ms 191398.4473` |
| `npm run test:v2 -- --suite E02,E03,E05` | **2** | `E02: BLOCKED; 0 pass / 0 fail / 250 blocked of 250`<br>`E03: BLOCKED; 0 pass / 0 fail / 200 blocked of 200`<br>`E05: BLOCKED; 0 pass / 0 fail / 100 blocked of 100`<br>`Evidence: tests\v2-harness\artifacts\latest.json; BLOCKED` |

The V2 result is an honest adapter block, not a pass: `tests/v2-harness/current-adapter.mjs:4` returns `{blocked: 'No integrated <suite> application adapter/instrumentation yet'}` for every suite other than E01. The regenerated `latest.json` records `"status": "BLOCKED"`, `"offline": true`, generated during this run. **E02/E03/E05 status: BLOCKED (550 cases; 0 pass, 0 fail).** It is neither a PASS nor a FAIL of B04.

---

## 2. Acceptance assessment

| Exact criterion (B04 spec) | Result | Exact evidence |
| --- | --- | --- |
| **Same canonical finance ID through classify/semantics/retry** | **PASS** (sequential tested paths) | `test:isolated` test 113 `B04 canonical finance identity and every user ledger field survive classification, semantics and retries` passes. Source: `src/storage/event-store.ts:582-595` returns the existing/merged canonical transaction (`retained_observation`) instead of re-matching; `src/storage/event-repository.ts:192-195` updates the classified row `on conflict (id)` so the classification row identity is retained; `src/storage/job-worker.ts:55` runs semantic jobs with `reuseClassification:true, skipFinancial:true`. Test 118 also confirms an identical observation from another owner cannot consolidate or mutate the original owner's transaction. |
| **All active user fields and unrelated-domain/owner hashes preserved** | **PASS** (tested fields, isolated sequential paths) | Test 113 preserves merchant/category/explanation/kind, amount/currency, account/destination, exclusion and hidden/merge state across reprocess+retry. Test 114 preserves unrelated-domain and other-owner rows during scoped semantic replacement. Test 117 preserves the original owner's row hash and gives a different owner an independent transaction. Independent resolved-path probe below: Health anchor SHA-256 **`e5c17af8…5f189` before = after**, one row retained. Same-domain older-generation probe: **`deaf8e1a…41a4` before = after**. Cross-domain/owner financial matching is owner-scoped at `src/storage/financial-transaction-repository.ts:883-885` (`client_id is not distinct from`). |
| **EvidenceCount is distinct observations and revisions counted separately** | **PASS** (isolated sequential paths) | Test 116 asserts `{evidenceCount:2, revisionCount:3}` for 2 raw events / 3 decision revisions, then `{evidenceCount:3, revisionCount:3}` after consolidation+retry; `financial_transactions.evidence_count` equals 3. Source: `src/storage/event-repository.ts:332-344` counts `count(distinct e.raw_event_id)` for observations and `count(distinct id)` from `classification_decisions` for revisions; `src/storage/financial-transaction-repository.ts:1185-1192` recomputes the canonical `evidence_count` **after** the evidence upsert with `count(distinct evidence.raw_event_id)`, and merge counting at lines 1248-1249 also uses distinct raw events. |

### Required-step checks (supporting the criteria)

| Spec step | Result | Evidence |
| --- | --- | --- |
| Replace generic cleanup with domain/generation-scoped replacement | **PASS** | `src/storage/event-repository.ts:279-309` deletes only pending candidates, observations and anchors matching `event $1`, exact owner (`is not distinct from`), `governance_version = $3` and explicit `domains = any($4)`; guarded by raw-event owner existence. |
| Remove finance deletion from semantic stage and unrelated global orphan sweep | **PASS** | `deleteFinancialTransactionsForEvent` and `replaceEventKnowledgeFacts` have **0 matches** across `src/`, `tests/`, `scripts/` (recursive literal search). `deleteDerivedDataForEvent` remains only as the explicit data-controls path (`event-repository.ts:266-274`). |
| Preserve classified decision and user overlays | **PASS** | `tests/v2-projections.test.ts:32-64` (test 113) and `correction-projection` integration; classification row updated in place (`event-repository.ts:192-195`). |
| Replay retries/consolidation and distinct evidence counts | **PASS** | Tests 116 and 118; distinct-count source cited above. |
| Resolver must not delete unrelated/cross-generation anchors | **PASS (defect fixed)** | `src/storage/semantic-repository.ts:120-146` no longer deletes; it takes a per-event advisory lock, reads the primary `FOR UPDATE`, and returns `{applied:false, preservedPrimary:true}` when domain **or** governance generation differs. `src/storage/semantic-resolver.ts:122-139` enqueues the refused transition via `enqueuePathCandidate`. Independent probe below confirms. |

---

## 3. Independent reproduction of the originally rejected probe

Script source was piped to `node --import ./tests/pglite-setup.mjs --import tsx --input-type=module`; no file was written. Procedure: unique raw event + unique canonical `Health` and `Finance` domain entities via direct canonical inserts; Health `primary` anchor with `governance_version = 'older-generation'`; `replaceSemanticProjection` scoped to the Finance domain/generation; then `resolveEventSemantics` with a single resolved Finance `reuse` primary path whose subject **is** the Finance domain entity (the ordinary `subject.id === parent.id` branch, `semantic-resolver.ts:159-171`). Rows were selected in deterministic order and JSON-serialized before SHA-256.

```json
{
  "beforeCount": 1,
  "afterScopedCleanupCount": 1,
  "afterResolverCount": 1,
  "beforeHash": "e5c17af85550df759fcc5d2743f1bb151c5cd38b59891d1d85eb0210ee05f189",
  "afterCleanupHash": "e5c17af85550df759fcc5d2743f1bb151c5cd38b59891d1d85eb0210ee05f189",
  "afterHash": "e5c17af85550df759fcc5d2743f1bb151c5cd38b59891d1d85eb0210ee05f189",
  "preservedIdenticalToBefore": true,
  "anchor": {"role":"primary","confidence":0.9,"rationale":"original health anchor","governance_version":"older-generation"},
  "reviewCandidates": [{"domain_value":"<Finance>","governance_version":"verifier-v2","anchor_role":"primary","decision_kind":"reuse","status":"pending","proposed_path":["<Finance>"]}]
}
```

The Health anchor is byte-identical after both stages (`e5c17af8…5f189`), exactly one anchor remains, and exactly one pending review candidate is recorded for the Finance transition. This is the inverse of the rejected result (`1 → 0`, `afterHash 4f53cda1…b945`).

Additional independent probes:

| Scenario | Before count/hash | After count/hash | Outcome |
| --- | --- | --- | --- |
| Same domain **and** same governance generation (normal path) | 1 / `d12cc7574cb334ee2cf8770c7c03aa10a321ad60a5d6547e99a03a501d5b1ab9` | 1 / `0048ceb19e85011dd8c2dce6db471691f8c291af7e40709ffe62a556d3eb5959` | **Updated**: `anchor_entity_id` changed from the seeded domain row to the resolved subject `entity_2`; confidence `0.4 → 1`; `appliedPaths: 1`. No regression to normal semantics. |
| Same domain, **older** governance generation | 1 / `deaf8e1a054c1f7d1bb5cd8fa1529657042fe134d36f90c595d6ae7b6ee041a4` | 1 / `deaf8e1a054c1f7d1bb5cd8fa1529657042fe134d36f90c595d6ae7b6ee041a4` | **Preserved byte-identical**, older-generation row intact, pending candidate recorded with the new generation `semantic-governance-v5`. |

The reprocess path wraps cleanup and resolution in `withTransaction` (`src/storage/event-store.ts:446-451`), so the per-event `pg_advisory_xact_lock` at `semantic-repository.ts:126` spans both the read and the write on the production reprocess path.

### Discrepancy observed (LOW, not a rejection)

For a deferred anchor transition, `resolveEventSemantics` returned `{appliedPaths: 1, reviewPaths: 0}` while the anchor was **not** applied and one pending candidate exists. The durable decision row was correct (`semantic_event_decisions.status = 'review'`; pending candidates = 1), and production callers ignore the return value (`event-store.ts:228` and `:542` just `await`). **Status: CLOSED by the delta re-check in §9** — the anchor write sites now propagate `SemanticAnchorWrite.applied`, deferred transitions report `appliedPaths: 0 / reviewPaths: 1`, and normal same-generation updates still report `appliedPaths: 1 / reviewPaths: 0`.

---

## 4. Normal-path regression evidence

- Probe 2 above: same-domain, same-generation primary write still updates the existing anchor in place (`anchor_entity_id`, confidence, rationale, `updated_at`) and reports `appliedPaths: 1`.
- `test:isolated` test 113: canonical Finance ID and every active user ledger field survive classify → semantic reprocess → retry.
- `test:isolated` test 116: consolidation/retry preserves the canonical row and recomputes distinct evidence.
- No anchor is silently deleted anywhere in the new write path; `event_semantic_anchors_one_primary_idx` is satisfied by refusing rather than deleting.
- The full 118-test isolated suite passes, so ingestion, classification, financial, semantic-governance and API suites were not regressed by the change.

---

## 5. Scope attribution

Baseline compared: `docs/reports/v2/snapshot-backend.json` (`captured_at_utc 2026-10-17T18:18:16Z`, HEAD `b71c4cc8…`, 450 files, `manifest_sha256 ea41cb12…cb444`). This verifier hashed every current tracked/untracked non-ignored backend file (SHA-256; `mobile/` deliberately excluded per instructions; verifier did not access the mobile repo, so its 8 snapshot entries were not re-hashed).

Paths whose content differs from the snapshot (6):

| Path | Classification |
| --- | --- |
| `src/storage/semantic-repository.ts` | B04 amended boundary (fix) |
| `src/storage/semantic-resolver.ts` | B04 amended boundary (fix) |
| `src/storage/financial-transaction-repository.ts` | Authorized scope extension (LOW remediation removal) |
| `src/storage/knowledge-fact-repository.ts` | Authorized scope extension (LOW remediation removal) |
| `tests/v2-projections.test.ts` | B04 boundary (new regression) |
| `tests/v2-harness/artifacts/latest.json` | Generated output of the required V2 command (authorized artifact) |

Paths present now but absent from the snapshot (authorized reports/artifacts): `docs/reports/v2/B04-r2.md`, `docs/reports/v2/B04-r2.json`, `docs/reports/v2/baseline-snapshot.md`, `docs/reports/v2/snapshot-backend.json`, `docs/reports/v2/snapshot-mobile.json`.

`src/storage/event-store.ts`, `event-repository.ts`, `job-worker.ts`, `correction-projection.ts` are **not** in the changed set: r2 did not touch them, consistent with `B04-r2.md`. No migration, package file, lockfile, or mobile file changed. The pre-existing tracked deletion of root `agent.md` exists in the worktree and in arrival `git status`; it is not in the snapshot and was not touched by this verifier. **No out-of-bound write attributable to B04 r2 was found.** This attribution is exact for changes since the snapshot; earlier history remains unattributable, as the snapshot itself notes a substantially dirty tree.

---

## 6. Remaining blockers and conditions of acceptance

1. **E02/E03/E05 are BLOCKED, not verified.** 550 application observations cannot run because `tests/v2-harness/current-adapter.mjs` has no integrated adapters for those suites. A full V2 application gate must not be claimed.
2. **Real PostgreSQL concurrency/crash is unverified.** PGlite certifies query semantics only. Multi-connection behavior of the per-event anchor advisory lock, the owner advisory lock and matched-row lock, unique-index races, and crash recovery require a real PostgreSQL deployment test.
3. **Production deployment and migration are unexercised.** No live database, no destructive DDL, no production migration or rollback rehearsal was performed.
4. **Cross-domain/generation transitions require a review approval path that does not yet exist.** The remediation correctly parks them as `semantic_candidates`, but no endpoint/UI was in scope, so such transitions cannot yet be promoted. This is intentional product behavior, not a hidden overwrite.
5. **Return-value semantics discrepancy (LOW).** `appliedPaths`/`reviewPaths` do not reflect a deferred anchor as described in §3. Durable state is correct; no current production caller consumes the counters.
6. **Historical ownership mistakes and pre-snapshot write attribution** remain outside this verification.
7. **Synthetic evidence.** The independent probes use synthetic rows and PGlite; they prove the deletion/preservation invariant but not migrated production data shapes.

---

## 7. Limitations

- All runtime evidence is PGlite (PostgreSQL query compatibility), not a real PostgreSQL server; no multi-connection concurrency, lock-release-on-crash, or isolation-level behavior was exercised.
- The zero-match helper search is a recursive literal file search over `src/`, `tests/`, `scripts/` (equivalent in intent to `rg`); no other references were found.
- Hash comparisons use the snapshot's SHA-256 values; `mobile/` was not read. The snapshot contains 450 files including 8 `mobile/` paths; backend-only comparison covers 442 baseline paths.
- V2 adapters are absent by design in this checkout; BLOCKED is reported as BLOCKED and is not counted as pass or fail.
- No commit was created. The report is the only verifier-authored file.

---

## 8. Disposition

The prior rejection was driven by one reproducible HIGH defect (`semantic-repository.ts:111` deleting an unrelated primary anchor) plus a LOW dormant-cleanup finding. Both are remediated and independently reproduced against this revision. B04's three acceptance criteria pass on the available isolated evidence. B04 is **accepted-with-conditions** subject to the real-PostgreSQL concurrency/crash, V2 adapter integration, and production deployment work listed in §6. E02/E03/E05 must continue to be reported as **BLOCKED**.

---

## 9. Delta re-check — LOW discrepancy #1 closure (2026-10-17, post-report)

Scope: only the post-report delta was re-verified; the full audit above was not redone. HEAD remains `b71c4cc82ca0faa636db656c729e79cb906a9114`. Mtimes and content comparison show the delta touched exactly two paths: `src/storage/semantic-resolver.ts` (15:36:36) and `tests/v2-projections.test.ts` (15:36:39); no other source/test file was modified after the original report. No file was installed, committed, or created by this re-check other than amending this report.

### Fix under review

`applyPath` now propagates the anchor outcome. Every one of the eight anchor write sites returns `(await applyEventAnchor(...)).applied` instead of unconditional `true`, and the `eventAnchor === false` branches still return `true` separately: `src/storage/semantic-resolver.ts:159-172` (self-leaf), `:182-192`, `:194-200`, `:202-210`, `:228-235`, `:236-241`, `:242-261`, `:282-307`. `applyEventAnchor` itself is unchanged and still enqueues the pending candidate when `applied` is false (`:122-139`). `persistSemanticDecision` still computes `reviewPaths = paths.length - appliedPaths` (`:353-354`, `:403`).

### Re-run commands

| Command | Exit | Actual output |
| --- | ---: | --- |
| `npm run lint` | **0** | `> tsc -p tsconfig.json --noEmit` — no diagnostics. |
| `npm run build` | **0** | `> tsc -p tsconfig.json` — no diagnostics. |
| `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-projections.test.ts` | **0** | `# tests 6` / `# pass 6` / `# fail 0` / `# cancelled 0` / `# skipped 0` / `# duration_ms 12649.5754` |
| `npm run test:isolated` | **0** | `# tests 118` / `# pass 118` / `# fail 0` / `# cancelled 0` / `# skipped 0` / `# duration_ms 191091.1726` |

### Independent count probe (stdin, PGlite, not the regression test)

| Scenario | `appliedPaths` | `reviewPaths` | Durable outcome |
| --- | ---: | ---: | --- |
| Deferred cross-domain/cross-generation primary (Health `older-generation` preserved, Finance path resolved) | **0** | **1** | Health anchor retained (`governance_version = older-generation`); `semantic_event_decisions.status = 'review'`; 1 pending candidate. |
| Normal same-domain/same-generation primary | **1** | **0** | Anchor updated in place: `anchor_entity_id = entity_2` (resolved subject), confidence `1`, generation `semantic-governance-v5`. |

The regression test now asserts `result.appliedPaths === 0` and `result.reviewPaths === 1` at `tests/v2-projections.test.ts:135-136`, while retaining the byte-identical anchor and pending-candidate assertions at `:137-143`.

### Anchor deletion check

Recursive source search for `delete from event_semantic_anchors` returns exactly **one** match: `src/storage/event-repository.ts:305`, inside the domain/generation/owner-scoped cleanup of `replaceSemanticProjection` (`:279-309`). No deletion path exists in `src/storage/semantic-repository.ts` or `semantic-resolver.ts`, and no new deletion was introduced by the delta.

### Disposition of the LOW

**LOW discrepancy #1 is CLOSED.** Deferred transitions now report separately from applied transitions, normal semantics are unchanged, the durable review state was already correct, and no new deletion path exists. No new defect was found.

**Final verdict: accepted-with-conditions (unchanged).** Conditions in §6 remain: E02/E03/E05 are BLOCKED (550 cases), real PostgreSQL multi-connection/crash behavior and production deployment/migration remain unverified, and cross-domain/generation transitions still require a future review-approval path. E02/E03/E05 must continue to be reported as **BLOCKED**, not pass or fail.
