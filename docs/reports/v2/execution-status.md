# Brain AI v2 execution status ledger

Date: 2026-10-18 (UTC). Repository: `D:/Coding/BrainIA/BrainIA-Backend` @ `9180904` (clean). Mobile @ `b4c8748` (untracked `untitled.md` only). Both pushed to `origin/main`.
This ledger records orchestrated execution after the baseline snapshot `docs/reports/v2/snapshot-backend.json` (`ea41cb12…cb444`) and `snapshot-mobile.json` (`596cff0d…af68`).

## Task states

| Task | State | Evidence | Notes |
|---|---|---|---|
| B00 | accepted-with-conditions | `B00-verification.md` | G0 remains blocked on deployed/APK/restore facts. |
| B01 | accepted-with-conditions | `B01-verification.md` | Synthetic corpus only. |
| B02 | **accepted-with-conditions — approved revision** | `B02-r2.md`, `B02-r3.md`, `B02-verification-r2.md`, `approvals.json` v3 | B02-r3 bundle `666af99f…bfb55`, 912 checks, 152 fixtures, 0 open decisions. 13 operations have strict schemas but remain implementation-blocked; deletions excluded. Mobile reviewer sign-off still required. |
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
| B05…B32 backend | not started except above | — | B06/B08 are now dependency-ready. |
| M01–M09 mobile | not started | — | Blocked by G1 mobile review + M00 conditions. |

## Gate status

| Gate | State | Basis |
|---|---|---|
| G0 | **BLOCKED (deployed revision now evidenced)** | `G0-evidence-request.md`, `G2.md` | Production `brain-ia` is READY at commit `e0ccc56` (2026-10-04), region `iad1`, Node 24.x, Fastify; local link matches. All v2 code is uncommitted and **not deployed**. Still missing: DB alias/binding, backup/restore identity, env names/counts, host limits, cron history, signing/Play custody, owner mapping, device/APK↔source evidence. |
| G1 decisions | **RESOLVED (30/30)** | Owner confirmed all 30 on 2026-10-17. 17 confirmed; 13 endpoint decisions provisionally authorize strict schema publication. `POST /api/v2/deletions` remains implementation-blocked. Feature gates stay false. |
| G1 contract | **APPROVED (B02-r3)** | Bundle `666af99f…bfb55`, 0 open decisions, independently verified. Mobile API reviewer sign-off is still missing; 13 operations remain implementation-blocked. |
| G2–G5 | **G2 BLOCKED; G3–G5 BLOCKED** | `G2.md` (`4aea895c…7c05`), `snapshot-2026-10-18-*.json` | G2 re-bound to backend `9180904` / mobile `b4c8748` / contract `666af99f…bfb55`. Independent probes 26/26. E01 improved to 250/500 but still FAIL; E03/E05/E06/E07/E11/E12 BLOCKED; no real PostgreSQL/restore; no device/APK/signing/live-v2; G0 missing. Q1–Q5/Q7–Q9 unsatisfied; Q6 deferred to G3. |
| Production/destructive | **BLOCKED** | Not approved by this session. |

## What is ready next

1. **B02 approval — DONE** — bundle `666af99f…bfb55` recorded in ledger v3.
2. **Condition debt — first round closed** — B06 RLS routed reads/cron/legacy repair, B07 R4, B08 revived rows/fence, B10 E01 adapter, B11 revalidation, mobile trust/operation guards. Remaining: RLS opt-in not default, mutations/semantic/agent routes, mobile re-verification, real PostgreSQL.
3. **G2 closure** — E01 extraction/classification, E03/E05/E06/E07/E11/E12 adapters, fixture adjudication, real PostgreSQL, device/APK/signing/live-v2.
4. **M02 follow-ups** — fresh independent verification of `M01-r2`/`M02-r3`; device/connected tests, Play/signing custody, live v2.
5. **G0 evidence** — DB binding, backup/restore, env names/counts, host limits, cron history, signing/Play, owner mapping; `G0-evidence-request.md`.
6. **Phase 2–4** — B13–B32 remain dependency-blocked by G2; mobile M03–M09 blocked by M02/B14.

## Environment evidence (this session)

- Backend: lint 0, build 0, isolated tests **202/202**, schema verify `problems: []`, schema contract **54 migrations / 1972 objects**, contracts:verify 0 (bundle `666af99f…bfb55`).
- B10 finance suite: E01 **FAIL** 250/250 (was 50/450; extraction/classification gaps remain); E03/E05 **BLOCKED**.
- Mobile: lint 0, typecheck 0, contracts:verify 0 (912 sealed + 221 mobile checks).
- Mobile: 1774 files hashed, 72 dirty entries preserved; no writes except the M00 report.
- B04 suites E02/E03/E05: **BLOCKED** (550 cases, 0 pass/0 fail).
- B05 suites E06/E11: **BLOCKED** (270 cases, 0 pass/0 fail).
- Graphify updated: 2601 nodes / 4021 edges / 227 communities.

## Explicit non-claims

- No task is production-ready; G0 and G2–G5 remain blocked.
- No mobile implementation was performed or approved.
- B05's RLS policies, per-owner runtime role and FK validation are B06 work.
- The contract bundle has not been resealed; owner decisions are recorded in the ledger, not in `open-items.json`.
- Historical pre-snapshot write attribution remains unprovable; post-snapshot writes are attributed in `B04-r2.md`, `B05-r2.md`, and the M00 report.
