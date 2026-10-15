# Brain AI v2 delegated task specifications

Version 2.0.0-draft.1. Master/repository manifests are normative for dependency IDs. Every task below is future delegated work. Estimates exclude access/approval waits and independent verification; XL workers may propose local subtasks without weakening parent gates.

## B00 — Deployment, schema, dirty-state and recovery baseline

Target repository: **BrainIA-Backend**. Phase 0; priority P0; workstreams WS02, WS04, WS13. Dependencies: none. Role: Operations investigator. Size M, 3–5 engineer-days.

Exclusive write reservation: `docs/reports/v2/baseline.md`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Preserve/fingerprint dirty checkouts and record approved baseline for future worktrees
- Read deployed schema, roles, APK/backend revisions and host limits with authorized access
- Prove isolated restore and quarantine restored connector tokens
- Obtain G0 environment/safety approval or record blocked facts

Migration: M00 catalog inventory only.

Acceptance:

- Exact inspected and deployed revisions distinguished
- Missing production/Android facts block relevant gates
- Restore procedure and owner mapping approval process documented

Verification suites: E06, E11. Distinct verifier; record `docs/reports/v2/B00-<revision>.md`.

Commands: `Read-only evidence review and hash comparison; no application build or implementation in this audit/approval task`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Deployment, schema, dirty-state and recovery baseline reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## M00 — Read-only mobile capture and signing feasibility audit

Target repository: **BrainIA-Mobile**. Phase 0; priority P0; workstreams WS02, WS05, WS13. Dependencies: none. Role: Mobile architecture investigator. Size M, 3–5 engineer-days.

Exclusive write reservation: `docs/reports/v2/mobile-baseline.md`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Inspect mobile dirty source and APK metadata read-only
- Validate F11-F14, key lifecycle, empty selection and native credential path
- Privately assess signing provenance without key material
- Review Room/SQLite encryption and contract feasibility with Android/OEM gaps

Migration: None.

Acceptance:

- Static findings distinguished from native evidence
- Every mobile uncertainty resolved or assigned gate blocker
- No application edits or native implementation before G1

Verification suites: E06, E10. Distinct verifier; record `docs/reports/v2/M00-<revision>.md`.

Commands: `Read-only evidence review and hash comparison; no application build or implementation in this audit/approval task`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Read-only mobile capture and signing feasibility audit reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B01 — Golden corpus and offline evaluation harness

Target repository: **BrainIA-Backend**. Phase 0; priority P0; workstreams WS13. Dependencies: B00. Role: Evaluation engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `tests/fixtures/v2/`; `tests/v2-harness/`; `package.json`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Implement E01-E12 fixture index/splits/labels and sanitizer audit
- Add test:v2/eval:v2 with provider stubs and isolated PostgreSQL guard
- Capture baseline failures before fixes

Migration: None.

Acceptance:

- Immutable dataset hashes and baseline report
- Harness exits nonzero on quality gate breach
- Production URLs rejected

Verification suites: E01, E02, E03, E04, E05, E06, E07, E08, E09, E10, E11, E12. Distinct verifier; record `docs/reports/v2/B01-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E01,E02,E03,E04,E05,E06,E07,E08,E09,E10,E11,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Golden corpus and offline evaluation harness reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B02 — Publish strict shared API schemas and fixture bundle

Target repository: **BrainIA-Backend**. Phase 0; priority P0; workstreams WS02, WS05, WS06, WS07. Dependencies: B00, M00. Role: API contract engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `contracts/brain-ai/2.0.0/`; `docs/BRAIN_AI_V2_API_CONTRACT_v2.0.0.md`; `package.json`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Translate normative specification into OpenAPI3.1/JSON Schema including strict content variants
- Publish exact JCS Unicode/hash/decimal/receipt/error fixtures
- Review v1 compatibility and owner/device enrollment
- Produce immutable bundle hashes and contracts:verify

Migration: None.

Acceptance:

- Both repository reviewers resolve all required wire fields
- Positive/negative fixtures validate including actual hashes
- No application implementation in contract task

Verification suites: E02, E06, E12. Distinct verifier; record `docs/reports/v2/B02-<revision>.md`.

Commands: `npm run contracts:verify`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Publish strict shared API schemas and fixture bundle reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B03 — Record explicit human API approval G1

Target repository: **BrainIA-Backend**. Phase 0; priority P0; workstreams WS02, WS05. Dependencies: B02, B01, M00. Role: Human approval coordinator. Size S, 1–2 engineer-days.

Exclusive write reservation: `docs/reports/v2/approvals.json`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Present concrete bundle hashes, auth, limits, retention and mobile review
- Record human approval timestamp and both reviewers
- Block unapproved capabilities and all mobile implementation

Migration: None.

Acceptance:

- G1 approval binds exact current contract hashes
- Silence or draft status never counts as approval
- Unresolved decisions retain blocked state

Verification suites: approval-record. Distinct verifier; record `docs/reports/v2/B03-<revision>.md`.

Commands: `Read-only evidence review and hash comparison; no application build or implementation in this audit/approval task`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Record explicit human API approval G1 reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B09 — Verify schema objects and replace runtime table-sentinel repair

Target repository: **BrainIA-Backend**. Phase 1; priority P0; workstreams WS04. Dependencies: B01. Role: PostgreSQL migration engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `src/scripts/migrate.ts`; `src/storage/intelligence-schema.ts`; `src/storage/pending-financial-schema.ts`; `src/routes/operations.ts`; `migrations/`; `contracts/schema/`; `package.json`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Build read-only object/checksum/ledger verifier and schema:verify
- Reproduce partial ledger-applied tables/indexes/policies/grants
- Serialize migrations and track nontransactional index validity
- Stage readiness then remove runtime DDL after reviewed roll-forward

Migration: M00 verified object manifest and additive repairs; exclusive migration owner.

Acceptance:

- Every omitted object detected despite applied filename
- Fresh/upgrade/partial/concurrent real PostgreSQL tests pass
- Runtime role cannot DDL and isolated restore proven

Verification suites: E11. Distinct verifier; record `docs/reports/v2/B09-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E11`; `npm run schema:verify -- --read-only`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Verify schema objects and replace runtime table-sentinel repair reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B04 — Separate projection cleanup and preserve financial/correction identity

Target repository: **BrainIA-Backend**. Phase 1; priority P0; workstreams WS01. Dependencies: B01, B09. Role: Backend finance correctness engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `src/storage/event-store.ts`; `src/storage/event-repository.ts`; `src/storage/job-worker.ts`; `src/storage/correction-projection.ts`; `tests/v2-projections.test.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Replace generic cleanup with domain/generation-scoped replacement
- Remove finance deletion from semantic stage and unrelated global orphan sweep
- Preserve classified decision and user overlays
- Replay retries/consolidation and distinct evidence counts

Migration: Optional producer metadata through migration owner; no destructive DDL.

Acceptance:

- Same canonical finance ID through classify/semantics/retry
- All active user fields and unrelated-domain/owner hashes preserved
- EvidenceCount is distinct observations and revisions counted separately

Verification suites: E02, E03, E05. Distinct verifier; record `docs/reports/v2/B04-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E02,E03,E05`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Separate projection cleanup and preserve financial/correction identity reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B05 — Add owner schema and quarantine legacy personal identities

Target repository: **BrainIA-Backend**. Phase 1; priority P0; workstreams WS02, WS04. Dependencies: B09, B03. Role: PostgreSQL security migration engineer. Size XL, 8–12 engineer-days.

Exclusive write reservation: `migrations/`; `src/storage/ownership.ts`; `contracts/schema/`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Inventory ownership for every object
- Backfill approved client mapping and split shared personal entities with scoped mapping
- Quarantine unresolved legacy rows
- Add owner indexes/composite FKs before compatible RLS enforcement

Migration: M01 additive owner columns/backfill/indexes; destruction separately approved.

Acceptance:

- Ordinary APIs cannot see quarantined rows
- Personal entities/edges belong to one owner
- Public taxonomy has no personal content
- Idempotent backfill preserves evidence and transaction IDs

Verification suites: E06, E11. Distinct verifier; record `docs/reports/v2/B05-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E06,E11`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Add owner schema and quarantine legacy personal identities reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## M01 — Import approved contract and mobile conformance validation

Target repository: **BrainIA-Mobile**. Phase 1; priority P0; workstreams WS05, WS13. Dependencies: B03, M00. Role: Mobile API engineer. Size M, 3–5 engineer-days.

Exclusive write reservation: `contracts/brain-ai/2.0.0/`; `lib/api.ts`; `lib/domain.ts`; `package.json`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Import exact G1 bundle bytes through mobile worker
- Verify hashes and strict response/request validation
- Add contracts:verify for Unicode/hash/receipts/decimals/errors
- Hold v2 queue on unsupported server

Migration: None.

Acceptance:

- Imported hash matches G1
- Cross-language positive/negative fixtures pass
- No runtime backend filesystem dependency or writes

Verification suites: E02, E06, E10. Distinct verifier; record `docs/reports/v2/M01-<revision>.md`.

Commands: `npm run lint`; `npm run typecheck`; `npm run contracts:verify`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Import approved contract and mobile conformance validation reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B06 — Principal-bound authorization across all APIs and repository queries

Target repository: **BrainIA-Backend**. Phase 1; priority P0; workstreams WS02. Dependencies: B05, B04. Role: Authorization engineer. Size XL, 8–12 engineer-days.

Exclusive write reservation: `src/auth.ts`; `src/app.ts`; `src/routes/`; `src/storage/*repository.ts`; `src/storage/data-controls.ts`; `src/storage/intelligence.ts`; `src/storage/postgres.ts`; `src/storage/hybrid-retrieval.ts`; `src/storage/embeddings.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Attach server-resolved principal/scopes
- Reject spoofed owner/client headers and deployed anonymous/global access
- Inventory and scope every read/write/export/correction/finance/graph/admin route including every hybrid retrieval and embedding branch
- Apply owner/source/visibility eligibility before limits now and defer ranking/performance to B21
- Enforce restricted DB role and transaction-local owner with RLS

Migration: M01 RLS/grants/default privileges after compatible queries; schema worker owns migration.

Acceptance:

- Complete two-owner endpoint/query matrix including FTS/vector/graph/artifacts passes
- Foreign IDs are inaccessible
- Pooled owner context never leaks
- Exact cron/admin credential scopes enforced

Verification suites: E06, E11. Distinct verifier; record `docs/reports/v2/B06-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E06,E11`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Principal-bound authorization across all APIs and repository queries reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B08 — Leased fenced SQL jobs and bounded workers

Target repository: **BrainIA-Backend**. Phase 1; priority P0; workstreams WS03. Dependencies: B04, B09. Role: Distributed job engineer. Size XL, 8–12 engineer-days.

Exclusive write reservation: `src/storage/job-repository.ts`; `src/storage/job-worker.ts`; `src/storage/event-store.ts`; `src/storage/postgres.ts`; `src/scripts/process-jobs.ts`; `src/routes/operations.ts`; `vercel.json`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Add lease/fence/attempt/replay history
- Atomically claim ready/expired jobs only to execution capacity
- Fence heartbeat/complete/fail and effect publication in same transaction as downstream enqueue
- Unify inline claims
- Bound host deadline/backoff/dead letters/cron overlap

Migration: M05 additive lease/fence/indexes; reserve migration integration window.

Acceptance:

- Every E07 crash recovers within lease plus two polls
- Stale attempt publishes zero effects
- Finance side effects not duplicated
- No serial overclaim backlog

Verification suites: E07, E03. Distinct verifier; record `docs/reports/v2/B08-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E07,E03`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Leased fenced SQL jobs and bounded workers reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## M02 — Secure native credentials and explicit capture consent

Target repository: **BrainIA-Mobile**. Phase 1; priority P0; workstreams WS02. Dependencies: M01. Role: Android security engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `lib/storage.ts`; `lib/notification-bridge.ts`; `app/settings.tsx`; `android/app/src/main/java/com/brainia/mobile/notification/NotificationBridgeConfig.kt`; `android/app/src/main/java/com/brainia/mobile/notification/NotificationBridgeModule.kt`; `android/app/src/main/java/com/brainia/mobile/notification/NotificationBridgeService.kt`; `android/app/build.gradle`; `android/app/src/main/AndroidManifest.xml`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Unify Keystore-backed credentials with JS storage and remove preference secret copy
- Separate unconfigured from explicit empty selection
- Exclude secrets from backup/logs
- Privately assess signing/Play relationship and externalize release credentials

Migration: Versioned local credential/consent migration only.

Acceptance:

- Empty selection captures zero notifications
- No plaintext key in prefs/logs/backup
- Secure migration preserves session or prompts visible reauth
- Rotation/history rewrite only with human approval

Verification suites: E06, E10. Distinct verifier; record `docs/reports/v2/M02-<revision>.md`.

Commands: `npm run lint`; `npm run typecheck`; `npm run agent:harness`; `npm run contracts:verify`; `android/: .\gradlew.bat testDebugUnitTest`; `android/: .\gradlew.bat connectedDebugAndroidTest (security/consent fixtures created by this task)`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Secure native credentials and explicit capture consent reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B07 — Provider/source privacy at every external model boundary

Target repository: **BrainIA-Backend**. Phase 1; priority P0; workstreams WS02, WS12. Dependencies: B06. Role: Privacy and AI boundary engineer. Size XL, 8–12 engineer-days.

Exclusive write reservation: `src/storage/privacy.ts`; `src/storage/deepseek.ts`; `src/storage/embeddings.ts`; `src/storage/semantic-enrichment.ts`; `src/storage/semantic-reconciler.ts`; `src/storage/classification-assistant.ts`; `src/storage/intelligence.ts`; `src/storage/agent-inspect.ts`; `src/storage/digests.ts`; `src/storage/proactive-insights.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Inventory direct and indirect model/embedding callers
- Require owner/purpose/evidence eligibility before dispatch including retrieval context and query text
- Version policy and invalidate work/caches
- Recheck after semaphore wait and before publish
- Remove payload/error-body logs

Migration: Policy version and eligibility metadata via migration owner.

Acceptance:

- Network spies observe zero forbidden payload bytes
- Revocation while queued prevents dispatch/stale publish
- Mixed-source summaries use intersection permissions

Verification suites: E06, E12. Distinct verifier; record `docs/reports/v2/B07-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E06,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Provider/source privacy at every external model boundary reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B10 — Currency ambiguity and current financial evidence safety

Target repository: **BrainIA-Backend**. Phase 1; priority P0; workstreams WS06, WS07. Dependencies: B06, B04. Role: Financial domain engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `src/domain/money.ts`; `src/domain/financial-transactions.ts`; `src/storage/financial-transaction-repository.ts`; `src/routes/financial-transactions.ts`; `tests/v2-finance-safety.test.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Use exact decimal and amount-role/currency evidence
- Remove UNKNOWN wildcard and unverified bare-dollar promotion
- Unify distinct evidence count and scoped native-reference locking
- Group reports by original currency

Migration: M04 preparatory status/lineage through migration owner.

Acceptance:

- All hard currency fixtures correct
- Unsupported/uncertain excluded from confirmed totals
- Same amount/time cannot auto-merge
- Evidence join count cannot inflate totals

Verification suites: E01, E03, E05. Distinct verifier; record `docs/reports/v2/B10-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E01,E03,E05`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Currency ambiguity and current financial evidence safety reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B11 — Deletion/retention across raw and derived knowledge

Target repository: **BrainIA-Backend**. Phase 1; priority P0; workstreams WS02, WS04. Dependencies: B07, B08. Role: Privacy lifecycle engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `src/storage/data-controls.ts`; `src/storage/privacy.ts`; `src/storage/embeddings.ts`; `src/storage/intelligence.ts`; `src/storage/graph-cache.ts`; `src/storage/backup-verification.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Tombstone before async cleanup
- Traverse lineage to vector text/facts/corrections/graph/finance/cache/artifacts
- Recompute from remaining permitted evidence
- Apply deletion tombstones before restored DB traffic

Migration: Deletion lineage/tombstones/audit metadata with approved policy.

Acceptance:

- Immediate ineligibility and no replay resurrection
- No eligible deleted derived content
- Other supporting observations preserved
- Backup expiry documented

Verification suites: E06, E11, E12. Distinct verifier; record `docs/reports/v2/B11-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E06,E11,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Deletion/retention across raw and derived knowledge reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B12 — Independent Phase1 gate G2

Target repository: **BrainIA-Backend**. Phase 1; priority P0; workstreams WS01, WS02, WS03, WS04, WS07, WS13. Dependencies: B10, B11, B08, M02. Role: Independent security/finance verifier. Size L, 5–8 engineer-days.

Exclusive write reservation: `docs/reports/v2/G2.md`; `tests/v2-security-regressions.test.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Run PostgreSQL projection/ownership/provider/crash/migration suites
- Review M02 immutable report without editing mobile
- Compare v1 functionality/corrections with baseline
- Delegate failing fixes through Supervisor

Migration: None.

Acceptance:

- Q1-Q5 and Q7-Q9 pass existing flows
- Q6 explicitly deferred to G3
- Gate binds backend hash and mobile report hash
- Unknown deployed state not certified

Verification suites: E01, E03, E05, E06, E07, E11, E12. Distinct verifier; record `docs/reports/v2/B12-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E01,E03,E05,E06,E07,E11,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Independent Phase1 gate G2 reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B13 — Observation/revision storage and safe legacy backfill

Target repository: **BrainIA-Backend**. Phase 2; priority P1; workstreams WS05, WS04. Dependencies: B12, B03. Role: Evidence data engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `migrations/`; `src/storage/observation-repository.ts`; `src/domain/observation.ts`; `contracts/schema/`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Create M02 immutable observations/revisions/receipts
- Backfill one imported revision per legacy raw row
- Preserve out-of-order producer sequence and A-B-A
- Checkpoint owner-keyset backfill with hash reconciliation

Migration: M02 additive schema/mapping with exclusive migration ownership.

Acceptance:

- All legacy content hashes/IDs preserved
- Duplicate replay stable
- Latest content follows producer sequence
- Missing historical revisions never invented

Verification suites: E02, E11. Distinct verifier; record `docs/reports/v2/B13-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E02,E11`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Observation/revision storage and safe legacy backfill reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B14 — Capture v2 and compatible v1 adapters

Target repository: **BrainIA-Backend**. Phase 2; priority P1; workstreams WS05. Dependencies: B13, B08. Role: Ingestion API engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `src/routes/capture.ts`; `src/routes/observations.ts`; `src/domain/capture.ts`; `src/app.ts`; `src/storage/event-store.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Implement capability/limits/hash/schema validation
- Commit revision/receipt/job atomically
- Per-item batch transaction and conflict errors
- Keep v1 adapter and prohibit lossy v2 downgrade

Migration: None beyond M02.

Acceptance:

- Bundle conformance passes
- Lost ack replays same revision
- Partial batch only acks stored items
- Current v1 response compatibility retained

Verification suites: E02, E06, E10. Distinct verifier; record `docs/reports/v2/B14-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E02,E06,E10`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Capture v2 and compatible v1 adapters reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B15 — Typed fact validation and persistent correction overlays

Target repository: **BrainIA-Backend**. Phase 2; priority P1; workstreams WS06, WS01. Dependencies: B14. Role: Extraction provenance engineer. Size XL, 8–12 engineer-days.

Exclusive write reservation: `src/domain/knowledge-fact.ts`; `src/domain/classification.ts`; `src/storage/classification-assistant.ts`; `src/storage/event-store.ts`; `src/storage/knowledge-fact-repository.ts`; `src/storage/correction-memory.ts`; `src/storage/correction-projection.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Implement strict discriminated facts and UTF16 evidence span checks
- Stage parse/classify/extract/optional model/validate/ambiguity/normalize/persist
- Retain competing deterministic/model facts
- Apply exact user overlays and fenced current-generation publication

Migration: M03 extraction/fact/generation lineage via migration worker.

Acceptance:

- Every promoted fact has valid immutable source lineage
- Balance/generic-title/merchant hallucination cases abstain
- All corrected fields/rule revocation survive replay

Verification suites: E01, E05, E12. Distinct verifier; record `docs/reports/v2/B15-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E01,E05,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Typed fact validation and persistent correction overlays reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## M03 — Encrypted durable Android outbox

Target repository: **BrainIA-Mobile**. Phase 2; priority P1; workstreams WS05. Dependencies: M02, B14. Role: Android persistence engineer. Size XL, 8–12 engineer-days.

Exclusive write reservation: `android/app/src/main/java/com/brainia/mobile/notification/NotificationOutbox.kt`; `android/app/src/main/java/com/brainia/mobile/notification/NotificationBridgeService.kt`; `android/app/build.gradle`; `android/app/src/main/AndroidManifest.xml`; `package.json`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Select pinned Room/SQLite and Keystore encryption from M00 feasibility
- Persist content/source mapping/sequence before HTTP or scheduling
- Add delivery states/restart recovery and test:outbox
- Enforce queue bounds without silent pending eviction

Migration: Versioned local outbox schema and upgrade tests only.

Acceptance:

- Process death between commit/schedule loses zero persisted items
- Storage full pauses capture visibly
- Acked content removed <=24h
- Backup excludes payload and keys

Verification suites: E10, E02, E06. Distinct verifier; record `docs/reports/v2/M03-<revision>.md`.

Commands: `npm run lint`; `npm run typecheck`; `npm run agent:harness`; `npm run contracts:verify`; `npm run test:outbox`; `android/: .\gradlew.bat testDebugUnitTest`; `android/: .\gradlew.bat connectedDebugAndroidTest`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Encrypted durable Android outbox reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B16 — Canonical financial matching and lifecycle extension

Target repository: **BrainIA-Backend**. Phase 2; priority P1; workstreams WS07. Dependencies: B15, B10. Role: Financial reconciliation engineer. Size XL, 8–12 engineer-days.

Exclusive write reservation: `src/domain/financial-transactions.ts`; `src/storage/financial-transaction-repository.ts`; `src/storage/event-store.ts`; `src/routes/financial-transactions.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Strong scoped reference matching and scored review candidates
- Preserve IDs across observation updates
- Lock unique reference/effect keys
- Add authorization/settlement/refund/reversal/transfer/installment semantics
- Shadow before projection switch

Migration: M04 additive canonical/evidence/lifecycle/adjustment schema.

Acceptance:

- Zero confirmed false merges/duplicate totals in E03/E04
- Same observation update keeps finance ID
- Ambiguity requires review
- Signed adjustments and corrections auditable/undoable

Verification suites: E02, E03, E04, E05. Distinct verifier; record `docs/reports/v2/B16-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E02,E03,E04,E05`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Canonical financial matching and lifecycle extension reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## M04 — Revision identity and single WorkManager delivery pipeline

Target repository: **BrainIA-Mobile**. Phase 2; priority P1; workstreams WS05. Dependencies: M03, B14. Role: Android background engineer. Size XL, 8–12 engineer-days.

Exclusive write reservation: `android/app/src/main/java/com/brainia/mobile/notification/NotificationBridgeService.kt`; `android/app/src/main/java/com/brainia/mobile/notification/NotificationReconciliationWorker.kt`; `android/app/src/main/java/com/brainia/mobile/notification/NotificationDeliveryWorker.kt`; `android/app/src/main/java/com/brainia/mobile/notification/NotificationOutbox.kt`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Persist Android key lifecycle generations/fingerprint/sequence
- Record updates/removals
- Unique drain work/network constraints/jitter and separate health recovery
- Ack only supported matching receipt
- Reconcile active snapshots with queue history

Migration: Local outbox migration if needed; no backend DDL.

Acceptance:

- Offline update+dismiss survives process death
- A-B-A/key reuse correct
- Retries retain producer/delivery IDs
- Malformed2xx stays pending
- Android force-stop/Doze gaps surfaced

Verification suites: E02, E10, E06. Distinct verifier; record `docs/reports/v2/M04-<revision>.md`.

Commands: `npm run lint`; `npm run typecheck`; `npm run agent:harness`; `npm run contracts:verify`; `npm run test:outbox`; `android/: .\gradlew.bat testDebugUnitTest`; `android/: .\gradlew.bat connectedDebugAndroidTest`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Revision identity and single WorkManager delivery pipeline reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B17 — Canonical evidence, corrections and exact finance DTOs

Target repository: **BrainIA-Backend**. Phase 2; priority P1; workstreams WS05, WS07, WS09. Dependencies: B16, B11. Role: API compatibility engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `src/routes/events.ts`; `src/routes/financial-transactions.ts`; `src/routes/intelligence.ts`; `src/routes/privacy.ts`; `src/routes/observations.ts`; `src/domain/intelligence.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Serve approved decimal/canonical/correction/deletion/export DTOs
- Validate scope and expected versions
- Distinguish stage from real-world lifecycle
- Keep v1 adapter/read flags and conformance evidence

Migration: None beyond reviewed prerequisites.

Acceptance:

- No v2 monetary JSON float
- Foreign/stale corrections rejected
- Evidence revision links resolvable
- No mobile dependence on internal joins

Verification suites: E02, E03, E05, E06, E12. Distinct verifier; record `docs/reports/v2/B17-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E02,E03,E05,E06,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Canonical evidence, corrections and exact finance DTOs reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## M05 — Capture state, provenance, corrections and exact-money UI

Target repository: **BrainIA-Mobile**. Phase 2; priority P1; workstreams WS05, WS06, WS07. Dependencies: M04, B17. Role: React Native product engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `lib/api.ts`; `lib/domain.ts`; `lib/financial-summary.ts`; `lib/format.ts`; `lib/app-state.tsx`; `app/(tabs)/capture.tsx`; `app/(tabs)/financials.tsx`; `app/(tabs)/review.tsx`; `app/settings.tsx`; `components/`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Render delivery/processing/review independently
- Use decimal server summaries and remove fixed implicit FX
- Handle corrections/stale versions and distinguish facts/interpretations
- Follow mobile UI skill notes/accessibility/runtime harness

Migration: None.

Acceptance:

- No mixed-currency total without explicit rate/time
- Offline/auth/full queue/unknown enum states clear
- TalkBack/font scaling/compact-large/native-web checks pass

Verification suites: E03, E05, E10, E12. Distinct verifier; record `docs/reports/v2/M05-<revision>.md`.

Commands: `npm run lint`; `npm run typecheck`; `npm run agent:harness`; `npm run contracts:verify`; `npm run test:outbox`; `android/: .\gradlew.bat testDebugUnitTest`; `android/: .\gradlew.bat connectedDebugAndroidTest`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Capture state, provenance, corrections and exact-money UI reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## M06 — Independent native capture and contract certification

Target repository: **BrainIA-Mobile**. Phase 2; priority P1; workstreams WS05, WS02, WS13. Dependencies: M05. Role: Independent Android verifier. Size L, 5–8 engineer-days.

Exclusive write reservation: `docs/reports/v2/mobile-G3.md`; `android/app/src/androidTest/`; `android/app/src/test/`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Run 10k persisted captures through offline/kill/reboot/ack-loss/update/dismiss
- Verify two-owner/security/backup/consent
- Test old/new backend contract matrix on approved test service
- Record physical OEM coverage and exact APK/contract hashes

Migration: None.

Acceptance:

- Zero persisted capture loss/revision discard
- Receipt/count reconciliation exact
- No private/foreign data path
- OS-unobserved gaps explicitly separate

Verification suites: E02, E06, E10. Distinct verifier; record `docs/reports/v2/M06-<revision>.md`.

Commands: `npm run lint`; `npm run typecheck`; `npm run agent:harness`; `npm run contracts:verify`; `npm run test:outbox`; `android/: .\gradlew.bat testDebugUnitTest`; `android/: .\gradlew.bat connectedDebugAndroidTest`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Independent native capture and contract certification reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B18 — Independent observation milestone G3

Target repository: **BrainIA-Backend**. Phase 2; priority P1; workstreams WS05, WS06, WS07, WS13. Dependencies: B17, M06, M05. Role: Independent backend integration verifier. Size L, 5–8 engineer-days.

Exclusive write reservation: `docs/reports/v2/G3.md`; `tests/v2-end-to-end.test.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Run v1/v2 compatibility and receipt reconciliation
- Consume mobile report without accessing mobile writes
- Recheck correction/currency/privacy/crash/restore
- Compare authorized shadow against baseline

Migration: None.

Acceptance:

- Q1-Q10 pass relevant capture flows
- 10k local persisted items reconcile with server/pending
- Both repo hashes and API bundle bound
- Missing physical report blocks

Verification suites: E01, E02, E03, E05, E06, E07, E10, E11, E12. Distinct verifier; record `docs/reports/v2/B18-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E01,E02,E03,E05,E06,E07,E10,E11,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Independent observation milestone G3 reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B19 — Measured learned embedding and indexing decision

Target repository: **BrainIA-Backend**. Phase 3; priority P1; workstreams WS08, WS13. Dependencies: B18. Role: Retrieval benchmark engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `tests/benchmarks/v2-embeddings/`; `docs/reports/v2/embedding-decision.md`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Compare hash/E5-small/BGE-M3/permitted external model on Spanish/English held-out
- Measure RSS/CPU/cold-warm latency/token cost
- Benchmark exact and optional filtered pgvector ANN at measured plus synthetic scales
- Record simplest passing model/index decision

Migration: Optional isolated extension trial only; no production install assumed.

Acceptance:

- Recall/ranking/latency/memory/cost measured not guessed
- Host extension availability proven or blocked
- External dataset/provider use approved

Verification suites: E08, E06. Distinct verifier; record `docs/reports/v2/B19-<revision>.md`.

Commands: `npm run eval:v2 -- --dataset tests/fixtures/v2/index.json --offline`; `Run documented model/index benchmark with authorized sanitized data; record CPU/RSS/latency/cost`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Measured learned embedding and indexing decision reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B20 — Isolated incremental embedding lifecycle

Target repository: **BrainIA-Backend**. Phase 3; priority P1; workstreams WS08. Dependencies: B19, B07. Role: Embedding engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `src/storage/embeddings.ts`; `src/storage/job-worker.ts`; `src/storage/model-audit.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Persist full embedding-space descriptor
- Hash-before-generation
- Apply privacy/correction/deletion invalidation
- Incremental owner/revision indexing with isolated fallback
- Checkpoint reindex/read rollback

Migration: M06 space/lineage schema through reserved migration worker.

Acceptance:

- Unchanged content/space/policy calls provider zero times
- No incompatible comparisons/overwrites
- Deleted vector and stored text ineligible/removed

Verification suites: E08, E06, E11. Distinct verifier; record `docs/reports/v2/B20-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E08,E06,E11`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Isolated incremental embedding lifecycle reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B21 — Uniform hybrid retrieval and complete eligible corpus recall

Target repository: **BrainIA-Backend**. Phase 3; priority P1; workstreams WS09. Dependencies: B20, B17. Role: Retrieval engineer. Size XL, 8–12 engineer-days.

Exclusive write reservation: `src/storage/hybrid-retrieval.ts`; `src/storage/search-repository.ts`; `src/storage/graph-repository.ts`; `src/storage/intelligence-evidence.ts`; `src/routes/search.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Share owner/source/time/type/visibility eligibility before every branch limit
- SQL finance/exact routing and FTS/alias/vector RRF
- Scoped bounded graph and final evidence recheck
- Remove newest1000 cutoff with measured indexing
- Explicit incomplete budget response

Migration: Reviewed indexes from B19 only through migration worker.

Acceptance:

- Branch filter parity and zero forbidden evidence
- Relevant older-than1000 item retrieved
- Recall20 >=0.90 and p95<=1s at declared load
- Totals equal exact SQL

Verification suites: E08, E06, E12. Distinct verifier; record `docs/reports/v2/B21-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E08,E06,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Uniform hybrid retrieval and complete eligible corpus recall reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B22 — Bounded LLM routing, caching and scoped publication

Target repository: **BrainIA-Backend**. Phase 3; priority P1; workstreams WS12, WS09. Dependencies: B21, B08. Role: LLM efficiency engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `src/storage/deepseek.ts`; `src/storage/model-audit.ts`; `src/storage/intelligence.ts`; `src/storage/classification-assistant.ts`; `src/storage/semantic-enrichment.ts`; `src/storage/semantic-reconciler.ts`; `src/storage/postgres.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Fast paths and owner/context/policy/prompt cache keys
- Full-body deadlines and shared retry/repair token/call caps
- Concurrency and scheduled jitter with dispatch recheck
- Move model work outside global locks with optimistic fenced publish

Migration: Cache/budget metadata through migration owner if durable.

Acceptance:

- Every call audited/budgeted
- Stalled response body times out
- No cross-owner/stale cache
- <=1 average interpretation/governance call with no quality regression

Verification suites: E01, E06, E07, E12. Distinct verifier; record `docs/reports/v2/B22-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E01,E06,E07,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Bounded LLM routing, caching and scoped publication reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B23 — Revisioned asynchronous episodes and temporal reasoning

Target repository: **BrainIA-Backend**. Phase 3; priority P1; workstreams WS10. Dependencies: B21, B15. Role: Temporal intelligence engineer. Size XL, 8–12 engineer-days.

Exclusive write reservation: `src/domain/episode.ts`; `src/storage/episode-repository.ts`; `src/storage/episode-worker.ts`; `src/routes/episodes.ts`; `src/storage/job-worker.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Implement proposed windows/reference membership and overlapping episodes
- Preserve membership/user split-merge-exclude overlays
- Revise on late/corrected/deleted evidence
- Version summaries and policy lineage
- Review any new mobile wire fields before consumption

Migration: M07 episode/revision/membership schema via migration worker.

Acceptance:

- Pairwise precision>=0.95 recall>=0.85
- No causal claim from similarity
- Stable episode IDs/history and corrections
- Deleted source invalidates memberships/summaries

Verification suites: E09, E06, E05. Distinct verifier; record `docs/reports/v2/B23-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E09,E06,E05`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Revisioned asynchronous episodes and temporal reasoning reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## M07 — Grounded retrieval and episodic UI

Target repository: **BrainIA-Mobile**. Phase 3; priority P1; workstreams WS09, WS10. Dependencies: M06, B21, B23, B22. Role: Mobile intelligence UX engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `lib/api.ts`; `lib/intelligence.ts`; `app/(tabs)/search.tsx`; `app/(tabs)/index.tsx`; `components/`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Use approved query DTO/capabilities
- Obtain reapproval for any new episode wire schema before coding dependent UI
- Show citations/coverage/uncertainty/asynchronous state
- Handle revoked/deleted evidence and local query privacy

Migration: None.

Acceptance:

- No fabricated citation/causal/financial statement
- Unknown/pending/incomplete states handled
- Independent QA evidence for G4
- No query upload without authorization

Verification suites: E06, E08, E09, E12. Distinct verifier; record `docs/reports/v2/M07-<revision>.md`.

Commands: `npm run lint`; `npm run typecheck`; `npm run agent:harness`; `npm run contracts:verify`; `npm run test:outbox`; `android/: .\gradlew.bat testDebugUnitTest`; `android/: .\gradlew.bat connectedDebugAndroidTest`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Grounded retrieval and episodic UI reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B24 — Independent semantic/temporal milestone G4

Target repository: **BrainIA-Backend**. Phase 3; priority P1; workstreams WS08, WS09, WS10, WS12, WS13. Dependencies: B22, B23, M07. Role: Independent retrieval verifier. Size L, 5–8 engineer-days.

Exclusive write reservation: `docs/reports/v2/G4.md`; `tests/v2-intelligence-regression.test.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Run held-out quality and privacy filters
- Verify budgets/cache/episodes/deletion
- Review mobile M07 report
- Collect explicit model/provider/cost decision and shadow/rollback proof

Migration: None.

Acceptance:

- Q1-Q10 pass integrated Phase3
- Retrieval/episode/grounding/cost targets met or blocked
- G4 production model/privacy approval recorded

Verification suites: E05, E06, E08, E09, E11, E12. Distinct verifier; record `docs/reports/v2/B24-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E05,E06,E08,E09,E11,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Independent semantic/temporal milestone G4 reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B25 — Reusable connector lifecycle and secure cursor storage

Target repository: **BrainIA-Backend**. Phase 4; priority P2; workstreams WS11, WS02. Dependencies: B24. Role: Connector security engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `src/storage/connectors/`; `src/domain/connector.ts`; `src/routes/connectors.ts`; `src/storage/job-worker.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Authorize/revoke/initial/delta/normalize/delete interface
- Encrypt token references
- Commit cursor CAS with durable per-page observations
- Bound initial history/pages/attachments
- Reuse capture not competing writers

Migration: M08 connectors/cursors/token-reference schema.

Acceptance:

- Crash replay loses zero durable messages
- Revoked credentials cancel work
- Tokens absent from evidence/logs
- Identical source privacy enforcement

Verification suites: E04, E06, E07. Distinct verifier; record `docs/reports/v2/B25-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E04,E06,E07`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Reusable connector lifecycle and secure cursor storage reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B26 — Least-privilege Gmail synchronization

Target repository: **BrainIA-Backend**. Phase 4; priority P2; workstreams WS11. Dependencies: B25. Role: Email OAuth engineer. Size XL, 8–12 engineer-days.

Exclusive write reservation: `src/storage/connectors/gmail.ts`; `src/routes/connectors.ts`; `tests/fixtures/v2/email/`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- PKCE/state/account binding and refresh revocation
- Bounded 1..90 day initial sync
- Message identity independent of thread
- History delta/push hints/catch-up and expired cursor resync
- Safe attachment allowlist/size handling

Migration: M08 only unless additional reviewed objects required.

Acceptance:

- Wrong-state/account rejected
- Push/delta/full-resync duplicate idempotency
- Revocation and attachment source policy pass
- Human scope/distribution approval

Verification suites: E04, E06, E07. Distinct verifier; record `docs/reports/v2/B26-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E04,E06,E07`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Least-privilege Gmail synchronization reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B28 — Activity/location normalization with explicit uncertainty

Target repository: **BrainIA-Backend**. Phase 4; priority P2; workstreams WS10, WS11. Dependencies: B25, B23. Role: Signals privacy engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `src/storage/connectors/signals.ts`; `src/domain/observation.ts`; `src/storage/episode-worker.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Validate approved source types/consent
- Preserve precision/time uncertainty
- Seven-day proposed location retention
- Separate inferred activity from observed coordinates
- No proximity causality

Migration: M08 source metadata only.

Acceptance:

- No consent or revocation means zero ingest/provider derivation
- Uncertainty visible in retrieval
- Retention/deletion reaches episode descendants

Verification suites: E06, E09, E11. Distinct verifier; record `docs/reports/v2/B28-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E06,E09,E11`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Activity/location normalization with explicit uncertainty reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## M08 — Granular email/activity/location consent and adapters

Target repository: **BrainIA-Mobile**. Phase 4; priority P2; workstreams WS11, WS02. Dependencies: B25, M07. Role: Mobile permissions engineer. Size XL, 8–12 engineer-days.

Exclusive write reservation: `lib/api.ts`; `lib/notification-bridge.ts`; `app/settings.tsx`; `android/app/src/main/AndroidManifest.xml`; `android/app/src/main/java/com/brainia/mobile/signals/`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Approved OAuth handoff with no provider refresh tokens
- Granular opt-ins/revoke/capability checks
- Validate background permission and coarse sampling
- Reuse encrypted signal outbox
- Measure daily battery against control

Migration: Local signal settings only.

Acceptance:

- Absent/revoked consent captures zero signals
- No provider tokens in return links
- Battery<=2 percentage points/day over control or feature remains off
- Contract hash current

Verification suites: E06, E09, E10. Distinct verifier; record `docs/reports/v2/M08-<revision>.md`.

Commands: `npm run lint`; `npm run typecheck`; `npm run agent:harness`; `npm run contracts:verify`; `npm run test:outbox`; `android/: .\gradlew.bat testDebugUnitTest`; `android/: .\gradlew.bat connectedDebugAndroidTest`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Granular email/activity/location consent and adapters reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B27 — Receipt/notification correlation without duplicate totals

Target repository: **BrainIA-Backend**. Phase 4; priority P2; workstreams WS07, WS11. Dependencies: B26, B16. Role: Receipt financial engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `src/storage/connectors/receipts.ts`; `src/domain/financial-transactions.ts`; `src/storage/financial-transaction-repository.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Extract typed receipt roles/order/payment evidence
- Strong confirmed payment references only
- Preserve multiple charges per order
- Review conflicts/refunds/currency
- Shadow results and retain user decisions

Migration: No parallel ledger; reuse M04.

Acceptance:

- Zero E04 false merges/duplicates
- New evidence count cannot inflate amount/count
- Source opt-out/deletion propagates

Verification suites: E01, E03, E04, E05, E06. Distinct verifier; record `docs/reports/v2/B27-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E01,E03,E04,E05,E06`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Receipt/notification correlation without duplicate totals reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B29 — Extend grounded proactive cross-source intelligence

Target repository: **BrainIA-Backend**. Phase 4; priority P2; workstreams WS09, WS10, WS11, WS12. Dependencies: B27, B28, B22. Role: Grounded intelligence engineer. Size L, 5–8 engineer-days.

Exclusive write reservation: `src/storage/proactive-insights.ts`; `src/storage/intelligence.ts`; `src/storage/intelligence-evidence.ts`; `src/storage/generated-content.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Reuse detectors and plan-draft-citation-repair-verify
- Apply novelty/utility/model budgets
- Scoped episode/connector evidence and dependency invalidation
- Withhold unsupported finance/causal claims

Migration: Reuse intelligence revisions.

Acceptance:

- Numeric claims trace to SQL/facts
- No forbidden source in output
- Policy changes invalidate stored answer
- Bounded model/retrieval calls only

Verification suites: E04, E06, E09, E12. Distinct verifier; record `docs/reports/v2/B29-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E04,E06,E09,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Extend grounded proactive cross-source intelligence reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## M09 — Mobile integration and independent final certification

Target repository: **BrainIA-Mobile**. Phase 4; priority P2; workstreams WS11, WS13. Dependencies: M08, B26, B27, B28, B29. Role: Mobile integration worker plus distinct verifier. Size L, 5–8 engineer-days.

Exclusive write reservation: `docs/reports/v2/mobile-G5.md`; `tests/`; `android/app/src/androidTest/`; `lib/`; `app/`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Integrate reviewed mobile-only commits
- Fix mobile compatibility and request backend fixes through Supervisor
- Distinct verifier checks OAuth/revoke/deletion/receipts/battery/UX/native flows
- Publish APK/source/contract hashes and outbox-safe rollback

Migration: Local upgrade/backward compatibility only.

Acceptance:

- All applicable Q1-Q10 evidence current
- No backend writes
- Independent final verifier after integration
- Rollback preserves queue or safely pauses

Verification suites: E02, E03, E05, E06, E09, E10, E12. Distinct verifier; record `docs/reports/v2/M09-<revision>.md`.

Commands: `npm run lint`; `npm run typecheck`; `npm run agent:harness`; `npm run contracts:verify`; `npm run test:outbox`; `android/: .\gradlew.bat testDebugUnitTest`; `android/: .\gradlew.bat connectedDebugAndroidTest`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Mobile integration and independent final certification reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B30 — Independent multi-source milestone G5

Target repository: **BrainIA-Backend**. Phase 4; priority P2; workstreams WS11, WS13. Dependencies: B29, M09. Role: Independent connector verifier. Size L, 5–8 engineer-days.

Exclusive write reservation: `docs/reports/v2/G5.md`; `tests/v2-connectors-integration.test.ts`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Run OAuth/cursor/attachment/cross-source/episode suites
- Consume mobile consent/battery report
- Recheck Q1-Q10 and rollback on integrated candidate
- Record human connector/retention approval

Migration: None.

Acceptance:

- Zero false merges/forbidden dispatch
- Recovery/opt-out/deletion pass
- Both revisions/current contract/mandatory gates bound

Verification suites: E01, E02, E03, E04, E05, E06, E07, E08, E09, E10, E11, E12. Distinct verifier; record `docs/reports/v2/B30-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E01,E02,E03,E04,E05,E06,E07,E08,E09,E10,E11,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Independent multi-source milestone G5 reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B31 — Delegate final backend integration fixes

Target repository: **BrainIA-Backend**. Phase 4; priority P2; workstreams WS01, WS02, WS03, WS04, WS05, WS06, WS07, WS08, WS09, WS10, WS11, WS12, WS13. Dependencies: B30. Role: Backend integration worker, never Supervisor. Size L, 5–8 engineer-days.

Exclusive write reservation: `src/`; `tests/`; `migrations/`; `contracts/`; `package.json`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Integrate backend-only reviewed results in dependency order
- Fix delegated backend conflicts/tests only
- Reconcile schema/order/contract hashes
- Request mobile fixes through mobile work queue
- Reverify changed behavior independently

Migration: Migration conflict fixes assigned reserved migration specialist.

Acceptance:

- No mobile file modified
- Integrated hash independently certified
- No silent requirement/contract change
- Schema objects match ledger

Verification suites: E01, E02, E03, E04, E05, E06, E07, E08, E09, E10, E11, E12. Distinct verifier; record `docs/reports/v2/B31-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E01,E02,E03,E04,E05,E06,E07,E08,E09,E10,E11,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Delegate final backend integration fixes reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.

## B32 — Final independent release evidence and deployment decision

Target repository: **BrainIA-Backend**. Phase 4; priority P2; workstreams WS04, WS13. Dependencies: B31. Role: Independent release verifier. Size M, 3–5 engineer-days.

Exclusive write reservation: `docs/reports/v2/release-readiness.md`; `docs/runbooks.md`. Other repository forbidden. Isolated repository-local worktree preferred; otherwise exclusive checkout. Parallel only after approvals/dependencies and no file overlap.

Required steps:

- Re-run integrated release acceptance after B31 fixes
- Check exact repo/APK/contract/schema hashes
- Confirm shadow/backup/restore/deletion/monitor/rollback
- Present deployment and destructive actions separately for human approval
- Stop at readiness report

Migration: Preflight only; no production execution.

Acceptance:

- Q1-Q10 all pass at integrated hashes
- Missing approval blocks deployment
- No Supervisor coding
- No deployment under planning instruction

Verification suites: E01, E02, E03, E04, E05, E06, E07, E08, E09, E10, E11, E12. Distinct verifier; record `docs/reports/v2/B32-<revision>.md`.

Commands: `npm run lint`; `npm run build`; `npm run test:isolated`; `npm run test:v2 -- --suite E01,E02,E03,E04,E05,E06,E07,E08,E09,E10,E11,E12`. Future command availability and environment restrictions are defined in EVALUATION.

Deliverables: Final independent release evidence and deployment decision reviewed change/report; Independent verification evidence; Repository-local rollback and compatibility notes.

Risk/rollback: Shared files must be serialized under Supervisor reservation; no cross-repository edits; Disable new read/publication flags on failure; retain immutable evidence/additive tables; Do not let old writers destroy new projections; pause incompatible writes; Preserve queue/correction data; do not downgrade local DB destructively; Delegate fixes and independent re-verification; never ask Supervisor to implement.

Definition of Done: All acceptance criteria pass with current independent evidence; Prerequisites and exact approval hashes recorded; No changes outside target repository/reserved paths; Migration/compatibility/rollback reviewed; Update graphify after application code edits; do not claim planning-only validation as product verification.
