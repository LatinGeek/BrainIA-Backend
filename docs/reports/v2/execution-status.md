# Brain AI v2 execution status ledger

Historical verification baseline: 2026-10-18 (UTC). Repository: `D:/Coding/BrainIA/BrainIA-Backend` @ `9180904` (clean). Mobile @ `b4c8748` (untracked `untitled.md` only). Both pushed to `origin/main`.
This ledger records orchestrated execution after the baseline snapshot `docs/reports/v2/snapshot-backend.json` (`ea41cb12…cb444`) and `snapshot-mobile.json` (`596cff0d…af68`).

Current disposition updated 2026-10-19: the owner explicitly accepted G0/G2 with conditions and authorized implementation of the 19 published v2 operations; `POST /api/v2/deletions` stays excluded. This supersedes earlier implementation-blocked planning notes only within that scope. Historical test results below are not reruns or current deployed-state certification. See `G0-closure-2026-10-19.md`, `G2-closure-2026-10-19.md`, `V2-API-implementation-scope.md` and `approvals.json` v5.

## Task states

| Task | State | Evidence | Notes |
|---|---|---|---|
| B00 | accepted-with-conditions | `B00-verification.md` | G0 owner_accepted_with_conditions on 2026-10-19; restore and other technical evidence remain incomplete. |
| B01 | accepted-with-conditions | `B01-verification.md` | Synthetic corpus only. |
| B02 | **accepted-with-conditions — approved revision** | `B02-r2.md`, `B02-r3.md`, `B02-verification-r2.md`, `approvals.json` v3 | B02-r3 bundle `666af99f…bfb55`, 912 checks, 152 fixtures, 0 open decisions. Historical schema approval retained; 2026-10-19 owner authorization now permits the 19 published operations, excluding POST deletions. Mobile API review is signed off with conditions; native/live-v2 evidence remains incomplete. |
| B03 | accepted-with-conditions | `B03-verification.md` | G1 ledger; owner decisions now resolved (below). |
| B09 | accepted-with-conditions | `B09-verification.md` | E11 adapter still blocked. |
| B04 | **accepted-with-conditions** | `B04-r2.md`, `B04-verification-r2.md` | Rejection remediated: cross-domain/cross-generation anchors preserved, deferred transitions become review candidates, dormant global sweeps removed. LOW closed on re-verification. V2 adapters still blocked. |
| B05 | **accepted** | `B05-r1.md`, `B05-r2.md`, `B05-verification.md` | Additive owner schema, mapping/quarantine/split ledgers, 38 personal tables owner-keyed, cross-owner guards, RLS on new ledgers. |
| B06 | **accepted-with-conditions** | `B06-r1.md`, `B06-r2.md`, `B06-r3.md`, `B06-verification.md` | Principal-bound auth, spoof/fail-closed, owner-scoped routes, RLS role/policies/helper, 8 two-owner regressions. Three verification passes; all reproducible cross-owner leaks closed. Conditions: RLS not wired into routes, ownerless cron writers, public-taxonomy mutability, real PostgreSQL unverified, E06/E11 BLOCKED. |
| B07 | **accepted-with-conditions** | `B07-r1.md`, `B07-r2.md`, `B07-r3.md`, `B07-verification.md` | Central dispatch authorization, owner/purpose/evidence gates, fail-closed missing policy, revocation rechecks, mixed-source intersection, policy versioning, event-bound JEV, stale-embedding exclusion, 16 privacy-boundary tests. Conditions: R4 denied-neighbour over-blocks the summary, zero-source lineage for reconciliation, legacy null policy/client embeddings surface via full text, real PostgreSQL/RLS unverified, E08/E10 BLOCKED. |
| B08 | **accepted-with-conditions** | `B08-r1.md`, `B08-r2.md`, `B08-verification.md` | Additive lease/fence/attempt/replay schema, atomic capacity-bounded claims with shared advisory lock, fence-guarded heartbeat/complete/fail, transactional effects, jittered backoff, dead letters, replay, 11 job tests. Conditions: stale main-work projection before completion, real multi-connection PostgreSQL BLOCKED, pre-r2 revived-row repair, E07/E03 BLOCKED. |
| B11 | **accepted-with-conditions** | `B11-r1..r4.md`, `B11-verification.md` | Tombstone-first deletion, lineage traversal, read-time eligibility for legacy runs, replay guards, restore gate, export filtering, 15 deletion tests. Conditions: real PostgreSQL/restore BLOCKED, E06/E11/E12 BLOCKED, no revalidation workflow, conservative over-invalidation, prose resurrection undetectable, cross-instance cache TTL. |
| B10 | **accepted-with-conditions** | `B10-r1..r3.md`, `B10-verification.md` | Exact decimals, ambiguity-safe currency handling, identity-only merge, effective-owner account attach, distinct evidence counts, contract-exact summary, strict parsing, FX governance, 19 finance tests. Conditions: E01 still FAIL 50/450 (adapter/recall), FX not four-eyes, historical rows not remediated, real PostgreSQL BLOCKED, mandatory summary range is a breaking client change. |
| M00 | **blocked (audit complete)** | `BrainIA-Mobile/docs/reports/v2/mobile-baseline.md` | Read-only audit: 0 implemented, 2 partial (F11/F12), 1 missing (F14), 1 unverified (F13). |
| M01 | **accepted-with-conditions** | `M01-r1.md`, `M01-verification.md` | Approved bundle `666af99f…bfb55` imported byte-identically; 912 sealed + 204 mobile checks; transport blocked-auth/held; 111 defs / 19 paths. Conditions: offline classification fixed in M02, local extension trust root, contracts untracked, blocked operations reachable via generic request. |
| M02 | **accepted-with-conditions** | `M02-r2.md`, `M02-verification.md` | Secure token lifecycle, explicit empty vs unconfigured consent, sanitized logs/backup, JVM 21/21, credential probe 29/29, offline fix. Conditions: `lib/api.ts` scope ratification, untracked reproducibility artifacts, rotation metadata wording, settings epoch/confirmation polish, device/Play/signing/live-v2 blocked. |
| B13–B17 (v2 API) | **implemented — independent PASS** | `B13-B17-r1.md`, `B13-B17-schema-r1.md`, `V2-final-verification-2026-10-19.md` | All 19 published operations registered; `POST /api/v2/deletions` excluded/404; 55 migrations / 2,275 objects; 233/233 isolated tests; lint/build/contracts/schema green. Conditions: PGlite only, not deployed, no production v2 exercise, retention/deletion cleanup pending. |
| Semantic merge fix | **implemented — independently verified** | `B18-semantic-merge-fix.md`, `V2-final-verification-2026-10-19.md` | Cross-type candidates now skip/review instead of throwing; strict `mergeEntities` invariant retained; owned same-owner friendly-name/default-target flows fixed; regression genuinely fails at HEAD (7/10). |
| B18–B32 remaining backend | not started | — | B18 is the G3 milestone; later phase tasks remain dependency-blocked. |
| M01–M09 mobile | not started | — | Blocked by G1 mobile review + M00 conditions. |

## Gate status

| Gate | State | Basis |
|---|---|---|
| G0 | **owner_accepted_with_conditions (2026-10-19); technical PASS not certified** | `G0-closure-2026-10-19.md`, `G0-evidence-2026-10-18.md`, `production-deploy-2026-10-18.md`, `approvals.json` v5. Owner acceptance retains DSN-to-branch, durable backup/restore/RPO/RTO, concurrency, signing/device and Play conditions. |
| G1 decisions | **RESOLVED (30/30); implementation authorization updated 2026-10-19** | Historical owner decisions retained. The 19 published operations are now authorized for implementation; `POST /api/v2/deletions` remains excluded; no capability enabled by this record. |
| G1 contract | **APPROVED wire revision; B02-r4 metadata reseal** | Current ledger bundle `da2a989f…621c`; earlier G2 verification bound `666af99f…bfb55`. Mobile API review signed off with conditions; no new verifier/reseal asserted. |
| G2 | **owner_accepted_with_conditions (2026-10-19); technical BLOCKED** | `G2-closure-2026-10-19.md`, `G2.md`, `approvals.json` v5. Historical independent probes 26/26, isolated 202/202; E01 FAIL 250 pass / 250 fail of 500; E03/E05/E06/E07/E11/E12 BLOCKED. No real PostgreSQL/RLS/restore matrix; Q1-Q5/Q7-Q9 uncertified; Q6 deferred to G3. |
| G3-G5 | **BLOCKED / not certified by owner closure** | Bounded implementation authorization does not certify later gates or native/live-v2 behavior. |
| Production/destructive | **Production already deployed; no new action authorized here** | `production-deploy-2026-10-18.md` records READY initial deploy and October 19 corrected Neon runtime redeploy `brain-owra6uznl…`, auth and v1 capture verified (33 x 201). `production-migration-2026-10-18.md`: 54 migrations, production schema verification drift. Six-hour PITR/no snapshots/no restore drill; previous legacy secret unrecoverable. Destructive cleanup remains deferred. |

## What is ready next

1. **B02 approval — DONE** — bundle `666af99f…bfb55` recorded in ledger v3.
2. **Condition debt — first round closed** — B06 RLS routed reads/cron/legacy repair, B07 R4, B08 revived rows/fence, B10 E01 adapter, B11 revalidation, mobile trust/operation guards. Remaining: RLS opt-in not default, mutations/semantic/agent routes, mobile re-verification, real PostgreSQL.
3. **G2 closure** — E01 extraction/classification, E03/E05/E06/E07/E11/E12 adapters, fixture adjudication, real PostgreSQL, device/APK/signing/live-v2.
4. **M02 follow-ups** — fresh independent verification of `M01-r2`/`M02-r3`; device/connected tests, Play/signing custody, live v2.
5. **G0 evidence** — DB binding, backup/restore, env names/counts, host limits, cron history, signing/Play, owner mapping; `G0-evidence-request.md`.
6. **Phase 2 v2 API — implemented** — the 19 operations are served and independently verified; `POST /api/v2/deletions` remains excluded. Deployment, real PostgreSQL evidence, and mobile consumption remain separate actions. Later phase tasks are still dependency-blocked.

## Historical environment evidence (2026-10-18 verification)

- Backend: lint 0, build 0, isolated tests **202/202**, schema verify `problems: []`, schema contract **54 migrations / 1972 objects**, contracts:verify 0 (bundle `666af99f…bfb55`).
- B10 finance suite: E01 **FAIL** 250 pass / 250 fail of 500 (was 50/450; extraction/classification gaps remain); E03/E05 **BLOCKED**.
- Mobile: lint 0, typecheck 0, contracts:verify 0 (914 sealed + 221 mobile checks). JVM 21/21.
- Signing: new upload key `CN=BrainIA Upload` (`de1515ef…b15`); AAB `a903b871…b66`; APK `c5391404…592`; installed and launched on model 25069PTEBG (Android 16), listener connected.
- Play: SmartSnippet verification pending (identity submitted, device/phone outstanding); no app created.
- Mobile: 1774 files hashed, 72 dirty entries preserved; no writes except the M00 report.
- B04 suites E02/E03/E05: **BLOCKED** (550 cases, 0 pass/0 fail).
- B05 suites E06/E11: **BLOCKED** (270 cases, 0 pass/0 fail).
- Graphify updated: 2601 nodes / 4021 edges / 227 communities.

## Implementation evidence (2026-10-19)

- Backend: lint 0, build 0, isolated tests **233/233** on the final rerun (one first-run failure did not reproduce), contracts:verify 0 (**914 checks**, bundle `da2a989f…621c` unchanged), schema verify `problems: []`, schema contract **55 migrations / 2,275 objects**.
- V2 API: 19/19 published operations registered; `POST /api/v2/deletions` absent; independent HTTP probe 60/60; bearer/owner/header-spoof, foreign-ID 404, decimal money, feature-gate and error-enum checks passed.
- Semantic merge: targeted tests 22/22 before the final v2 integration; final suite 233/233; counterfactual against HEAD fails 7/10 with the production error, proving the regression is genuine.
- G0/G2: owner conditional acceptance recorded; no technical PASS, real PostgreSQL/restore, Play approval or new deployment is claimed.
- Not done in this iteration: production deployment of the v2/merge changes, production dead-letter replay, and real PostgreSQL/RLS/restore evidence.

## Explicit non-claims

- G0/G2 have owner conditional acceptance, not technical PASS; G2 technical evidence and G3-G5 remain blocked/uncertified. The live v1 backend does not certify complete gate readiness.
- This closure performed no mobile implementation and supplies no new mobile/native certification; prior M01/M02 work remains subject to its recorded conditions.
- B05's RLS policies, per-owner runtime role and FK validation are B06 work.
- The current ledger records the B02-r4 metadata reseal; this closure did not change contract bytes or rebind historical G2 verification.
- Historical pre-snapshot write attribution remains unprovable; post-snapshot writes are attributed in `B04-r2.md`, `B05-r2.md`, and the M00 report.

## Closure task notes (2026-10-19)

Owner decision: explicitly proceed with G0/G2 closure as `owner_accepted_with_conditions`, accepting the residual evidence debt in the two closure reports. Implementation authorization covers exactly the 19 operations in `V2-API-implementation-scope.md`; POST /api/v2/deletions is excluded. Earlier blocked-operation notes and production approval constraints are retained historically in `approvals.json`, with an explicit current authorization/reference; they do not become technical PASS claims.

The later production report supersedes earlier deployment-stop/configuration-pending observations: runtime was switched to migrated Neon and v1 auth/capture verified. It does not establish DSN-to-branch attestation or a real PostgreSQL/RLS/restore matrix. The signing report establishes signed artifacts; Play remains unapproved. Code rollback does not undo data/migrations, the old write-only DSN cannot be recovered, and six-hour PITR without an executed drill is not certified recovery. No tests, production operations, commit, push or deployment were performed for this documentation closure.
