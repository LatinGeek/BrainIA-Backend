# Brain AI v2 evaluation and release evidence

Version 2.0.0-draft.1 · Proposed. No benchmarks or application tests were executed during planning. A passing planning validator is not a passing product release gate.

## Dataset and baseline protocol

Backend task B01 owns `tests/fixtures/v2/` and an index with dataset version, seed, sanitizer version, source provenance, licence/consent, labeler, adjudicator and SHA-256. Use synthetic fixtures by default. Sanitization must preserve money separators, currency ambiguity, identities and lifecycle relationships without retaining identifying account/email content. Two independent labelers adjudicate finance identity, grounding and episode membership; unresolved labels remain explicitly ambiguous. Split 60/20/20 train/calibration/held-out by source template AND merchant/reference family; variants of one purchase stay in one split. Report Spanish, English, mixed language and source-specific slices. Never send personal evaluation samples to external providers without authorization.

Baseline: exact dirty checkout fingerprint, deployment/APK hashes, configuration flags (values redacted), installed DB schema fingerprint, machine CPU/RAM, provider/model revisions, corpus/tenant/source sizes, job poll frequency and test seed. Baseline runs only against isolated restored or synthetic DBs and test Android accounts. PGlite is useful for fast repository tests; it cannot certify production RLS, roles, SKIP LOCKED/locking, extensions or multi-process crash semantics. Use real PostgreSQL matching deployed major version for those suites. Report baseline failures as failures, never hide by changing expected answers.

| Suite | Minimum coverage | Required expected behavior |
|---|---|---|
| E01 extraction | 500 notifications: 200 multi-amount, 100 currency-ambiguous, 50 generic titles, 50 multilingual, 100 other | Label all value roles/spans/status; balances not purchases, merchant not hallucinated, uncertainty retained. |
| E02 identity/revisions | 250 sequences: duplicates, updates, out-of-order, A-B-A, key reuse, same amount repeated | Stable observation/event IDs; meaningful updates retained, repeated purchases distinct. |
| E03 finance lifecycle | 200 scenarios: authorization/settlement, declined/posted, partial/full refunds, reversals, transfers, installments, concurrent references | Correct signed totals by original currency; one count per canonical event/posted leg; no fuzzy auto-merge. |
| E04 source correlation | 100 email/receipt/notification groups including shared order with several charges | Only strong confirmed mappings auto-link; ambiguous candidates reviewable. |
| E05 correction replay | 100 field combinations: merchant/title/category/account/kind/description + rule revoke | Corrected field remains active after classification/semantics/embedding/retry; raw remains unchanged. |
| E06 privacy/ownership | At least two owners, two devices/owner, null legacy rows, shared taxonomy, conflicting policies | Full route/query/object matrix, zero leaks or unauthorized model/embedding dispatches. |
| E07 jobs/crashes | >=20 interruption schedules x 100 repetitions, two+ concurrent workers | Recovery and fencing at every transaction boundary; no duplicate finance effects or false successful stale attempts. |
| E08 retrieval | >=200 human-labelled queries, 1k/10k/100k corpora, relevant evidence older than newest 1k | Filter parity and exact SQL totals; Recall@K/MRR/nDCG by source/language, exact vs ANN comparison. |
| E09 episodes | >=100 sequences, overlapping activities, timezone/DST, late arrivals, split/merge/exclude | No causal inference from similarity, persistent user membership decisions, revision history. |
| E10 Android durability | 10,000 generated captured items across offline/process kills/reboot/ack loss, update+dismiss | Every persisted item is acknowledged once or visibly pending/blocked; no silent eviction. |
| E11 migration/deletion | Clean/upgrade/partial catalog states, restores, invalid indexes, old ledger with new tables missing policies | Verifier detects every deliberate omission; tombstones applied before restore serves; zero remaining eligible deleted content. |
| E12 grounded synthesis | >=100 questions incl prompt injection, wrong citations, conflicting facts, forbidden source, budget exhaustion | Citation existence/ownership/span verified; unsupported amounts withheld; data never becomes instructions. |

## Metrics and targets

Use numerator/denominator and confidence intervals, not only a point estimate. Zero false merges on fixtures is a hard gate, not a statistical claim of zero real-world risk. For 0/n errors report upper 95% binomial bound. Compare baseline and target on identical immutable held-out fixtures; two repeated benchmark runs only when variance/material changes justify them.

| Metric | Calculation | Proposed target |
|---|---|---|
| Field precision/recall | correct promoted field values / all promoted; correct recovered / labelled recoverable | >=99% / >=97% finance, report by field |
| Currency accuracy | correctly confirmed currency / promoted money facts | 100% hard fixtures; unknown correctly abstains |
| Duplicate rate | extra confirmed transactions / labelled real transactions | 0 hard fixtures |
| False merge rate | wrongly coalesced distinct transactions / labelled distinct pairs | 0 hard fixtures |
| Capture loss | persisted captures neither acked nor visible pending / persisted | 0; OS-unseen measured separately |
| Job recovery | successfully reclaimed eligible abandoned / injected abandoned | 100%; reclaim <=lease+two polls |
| Retrieval Recall@5/20 | relevant permitted retrieved / relevant permitted | Recall@20 >=0.90; ANN >=0.95 vs exact |
| Ranking | MRR@10, nDCG@10 on labelled relevance | no regression >0.02 vs baseline, by language |
| Grounding | supported atomic claims / emitted claims | numeric/citation 100%; other >=98% |
| Model calls | all dispatched calls incl repair/retries / successful interpretations | <=1 on golden mix and >=30% reduction vs baseline |
| Cost | estimated+actual provider charges / processed observation (including failures) | proposed <=$0.01; complex answer <=$0.05 pending approval |
| Latency | ingest commit, queue wait, extraction, index, retrieval and answer separately | PRD p95 targets under declared load |
| Episode quality | pairwise membership precision/recall plus boundary error | precision >=0.95, recall >=0.85; causal false claims 0 |

## Critical regression procedures

Projection test: create two owners' unrelated nonfinancial and financial rows; capture purchase; classify; snapshot transaction ID, correction overlay, evidence count and hashes; run semantic enrichment with reused classification; inject retry; run concurrent replay. Assert same canonical finance ID and facts, one distinct observation count, revision count as expected, all user fields, other-owner/unrelated-domain rows unchanged. Classification-changing reprocess retires only its own generation and preserves financial decision history. Include merged transaction and manual adjustment cases.

Provider test: instrument fake network transport at the shared provider boundary and legacy direct embedding HTTP. Test every listed caller, query embedding, retrieved semantic context, inspector, repair and verifier. Denied source content and cross-owner correction examples never appear in dispatched bytes. Revoke policy after job claim and while waiting for provider semaphore, then assert denied dispatch/stale publication. Test mixed-source derived summaries and caches; delete one support source and re-evaluate all descendants. Query prompts themselves may be private.

Job test: use two PostgreSQL connections/processes and controllable clock/poll, terminate worker after claim/model return/effect commit. Advance lease, reclaim, deliver old heartbeat/complete/fail/publish. Old fences must affect zero rows and commit zero effects. Verify inline/queued race, downstream enqueue atomically with completion, max attempt/dead-letter/replay preserving history, crash of reaper and overlapping cron. Terminal review is not a recoverable job left stranded.

Android test: enqueue before HTTP, kill process between local commit/schedule and between remote commit/local ack, dismiss offline then reboot, post update with same Android key, recycle key after removal, exhaust queue bounds, rotate/revoke credential and disable all sources. Verify exact contract acknowledgement matching, WorkManager unique jobs, encrypted database/credential backups excluded and no content in logs. Cover supported minimum Android, latest supported Android and at least one aggressive OEM physical device; force-stop/Doze/permission gaps must be explicitly reported rather than claimed fixed. Release APK SHA/signing certificate fingerprint must be recorded privately by security verifier, never secret key bytes.

Migration test: clone production schema safely into isolated DB after approved snapshot, omit one constraint/index/policy/grant/function at a time while marking ledger applied; verifier fails with named object. Repair roll-forward only on test DB, reverify object definitions. Runtime role cannot DDL or cross tenant; pooled transaction context never persists. Backup restore checks evidence, correction, finance and deletion manifests, then quarantines source tokens and disables external calls before any restored processing.

## Verification commands and missing infrastructure

Existing backend commands: `npm run lint`, `npm run build`, `npm run test:isolated`, `npm run harness:interpretation`, `npm run harness:generated-content`. Existing default `npm test` is an explicit file list and misses some newer tests; workers must update inclusion or use isolated discovery. `npm run verify:backup` is existing but does not by itself establish isolated restore proof. Inspect all scripts for DB/env behavior before running; do not run `npm run migrate`, worker/remote/live evaluation or cleanup scripts against production as verification.

Future backend verification interface created by B01/B09: `npm run test:v2 -- --suite <E01..E12|all>`, `npm run schema:verify -- --read-only`, `npm run eval:v2 -- --dataset tests/fixtures/v2/index.json --offline`, `npm run contracts:verify`. These commands **do not exist yet**; task acceptance includes creating the harness/commands and documenting required isolated DB/ports/provider stubs. Test command must fail nonzero on gate breach. Never count a command name in this plan as proof of implementation.

`--suite` also accepts a comma-separated list as used in task manifests. Backend E10 verification consumes immutable native report/receipt fixtures; only the mobile worker executes native device tests. Early harness work can create simulated transport fixtures, but may not certify physical device behavior before M06.

Existing mobile commands: `npm run lint`, `npm run typecheck`, `npm run agent:harness`; Android from `android/`: `.\gradlew.bat testDebugUnitTest` and `.\gradlew.bat connectedDebugAndroidTest` after a worker establishes instrumentation prerequisites. Future mobile `npm run contracts:verify` and `npm run test:outbox` are created by M01/M03. Browser harness cannot certify native notification capture or secure storage. Emulator/physical-device artifacts are mandatory. External providers use stubs by default; separately approved sanitized live benchmark records model/provider/date/cost.

Independent verifier writes `docs/reports/v2/<task-id>-<revision>.md` in its own repository (or equivalent mobile reports), with exact commit/working-tree fingerprint, environment, fixture hash, commands/exit codes, measured metrics, failures and pass/fail. Implementer cannot verify their own work as sole evidence. A failing verifier reports to Supervisor; Supervisor delegates fixes to repository-appropriate workers and re-verification to a different worker. Supervisor never edits tests/code.

## Shadow and promotion

Shadow copies use new generation/algorithm tags and cannot mutate current finance/corrections. Compare by owner/source/day/currency, inspect every changed canonical identity or total, label corrections and false merges. Initial minimum: full golden suites plus seven consecutive days of authorized staging shadow at baseline-shaped volume, >=1,000 observations or synthetic equivalent; no live personal shadow export by default. Promote by flag per owner/source, one repository release at a time, with v1 coexistence tests. Roll back read/publish flags on any hard-gate failure; preserve evidence and pause incompatible writers. New phase completion requires gate report, not just elapsed shadow time.

## Mandatory gate ledger

| Gate | Required evidence / blocker |
|---|---|
| Q1 financial evidence loss | E02/E03/E05 projection replay exact ID/count preservation; missing fixture blocks. |
| Q2 unauthorized data access | E06 complete endpoint/repository/worker matrix, restricted-role PostgreSQL tests. |
| Q3 forbidden provider transmission | E06/E12 network dispatch spies for every provider call site. |
| Q4 currency contamination | E01/E03 SQL totals, unsupported/UNKNOWN/FX exclusions and mobile summary parity. |
| Q5 stranded recoverable jobs | E07 crashes/cron/lease metrics; max observed recovery time. |
| Q6 discarded notification revisions | E02/E10 immutable revisions, duplicate/update/A-B-A and malformed acknowledgement. |
| Q7 ambiguous auto-merges | E03/E04 distinct identical purchases and candidates; strong-identity rule audit. |
| Q8 correction regression | E05 all corrected fields/rules through full pipeline. |
| Q9 retrieval permissions | E06/E08/E12 every FTS/vector/graph/SQL/artifact branch and caches. |
| Q10 destructive migration | Explicit human approval ID + backup/restore proof for any destructive step; otherwise step blocked. |

G2/G3 enforce relevant suites when features first ship; final G5/release requires Q1–Q10 together against the integrated release. Missing DB/device/provider instrumentation yields BLOCKED, never pass or assumed safe.
