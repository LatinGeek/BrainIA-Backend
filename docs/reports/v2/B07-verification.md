# B07 independent verification — provider/source privacy at external model boundaries

Status after r3 remediation: **accepted-with-conditions**. R1–R3 pass independent re-probing. R4 is only partially fixed: unlineaged neighbours are omitted and allowed neighbours dispatch, but a **denied-source neighbour still blocks the entire external summary** instead of being omitted (zero dispatch, no leak). The second-pass addendum and first-pass report are retained below as history.

## Third-pass verification (r3 addendum)

- Repository/HEAD: `D:/Coding/BrainIA/BrainIA-Backend` / `b71c4cc82ca0faa636db656c729e79cb906a9114` (unchanged). Tree dirty; no source/test/migration/manifest/mobile edit by this verifier.
- Inputs: `docs/reports/v2/B07-r3.md`, current source, `tests/v2-privacy-boundary.test.ts`, `snapshot-backend.json`.
- Independent probes: `C:/Users/germa/AppData/Local/Temp/opencode/b07-verify3/*.mjs` (outside the repository). Isolated PGlite + in-process transport spies; no real provider, production DB or external HTTP call.

### Verdict rationale

`accepted-with-conditions`: no reproducible forbidden dispatch or payload leak was found in the r3 paths. The condition is functional: R4's denied-neighbour case over-blocks instead of omitting the blocked neighbour while dispatching the allowed root/allowed neighbours. The carried zero-explicit-source derived-lineage gap and the legacy/route-created embedding limitations also remain.

### Command exits (third pass)

| Command | Exit | Observed |
|---|---:|---|
| `npm run lint` | 0 | no diagnostics |
| `npm run build` | 0 | no diagnostics |
| `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-privacy-boundary.test.ts` | 0 | 16 tests / 16 pass / 0 fail |
| `npm run test:isolated` | 0 | 148 tests / 148 pass / 0 fail |
| `$env:NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'; npm run schema:verify -- --read-only` | 0 | `{"ok":true,"readOnly":true,"problems":[]}` |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | 47 migrations / 1742 objects; ACL/drift/idempotency PASS; real-PG BLOCKED |
| `npm run contracts:verify` | 0 | 382 checks; 58 fixtures; 7 identity sequences; bundle `312c92f8…abad6` |
| `npm run test:v2 -- --suite E08,E10` | 2 | E08 BLOCKED 200/200; E10 BLOCKED 10 000/10 000 (expected) |

### R1 — missing source policy fails closed

`probe-r1.mjs` and `probe-r1b.mjs`:

```
PASS R1 missing policy denied :: reason=source_policy_missing
PASS R1 evidence-derived missing policy denied
PASS R1 missing policy summary null
PASS R1 missing policy embedding local
PASS R1 missing policy zero transport :: calls=0
PASS R1 missing policy classifier no dispatch :: calls=0
PASS R1 missing policy semantic no dispatch :: calls=0 status=review
PASS R1 ingest default remains permissive
PASS R1 denial log has no marker/source
PASS R1 explicit policy authorizes
PASS R1 allowed summary exactly one call :: calls=1
PASS R1 allowed embedding exactly one call :: calls=1 model=text-embedding-r1
PASS R1 foreign owner still denied
PASS R1 missing owner still denied
PASS R1 missing purpose still denied
PASS R1b missing-policy proactive: zero dispatch :: calls=0
PASS R1b missing-policy proactive: deterministic run
PASS R1b allowed proactive dispatches LLM+embedding :: calls=2
PASS R1b allowed proactive run published
```

The gate now denies `source_policy_missing` for explicit and evidence-derived sources; ingest-time policy resolution remains permissive but does not dispatch. Allowed explicit policies dispatch exactly once per boundary (classification/semantic/embedding/proactive). Denial logs remain metadata-only.

### R2 — stale derived embeddings and vector retrieval

`probe-r2.mjs`:

```
PASS R2 embeddings linked to run metadata
PASS R2 linkage metadata persisted :: runId/derivedFrom/ownerId/policyVersion
PASS R2 fresh derived runs retrievable
PASS R2 bump increments version :: 1->2
PASS R2 derived embeddings marked stale :: policy_version=2, stale=true
PASS R2 runs stale
PASS R2 no stale excerpt after deny (text+vector)
PASS R2 outdated embedding excluded from vector :: vectorScore=0
PASS R2 unjoinable derived embedding excluded
PASS R2 legacy null documented :: present=true vectorScore=0
PASS R2 route-created embedding with null client_id documented :: present=true vectorScore=0
```

The previous D4 vector defect is fixed: a policy bump links through `metadata.runId`/`derivedFrom` and marks insight/digest embeddings stale even without `metadata.source`; the vector branch excludes stale, outdated and unjoinable derived embeddings. Carried limitations, as declared by r3:

- A legacy run with `policy_version = null` still appears in the **full-text** branch (vector excludes it when the owner has a newer policy). r3's statement that it is treated as non-stale by *both* branches is inaccurate; the vector branch is stricter.
- Route-created embeddings with `client_id = null` are omitted from the owner-scoped vector branch but still surface through the run-linked full-text branch.

### R3 — JEV event binding

`probe-r3.mjs`:

```
PASS R3 valid authorization includes event id
PASS R3 no authorization: no dispatch :: calls=0
PASS R3 source-only authorization: no dispatch :: calls=0
PASS R3 exact event authorization: one dispatch :: calls=1
PASS R3 valid payload contains marker
PASS R3 same-source different-event blocked :: calls=0
PASS R3 stored owner mismatch blocked :: calls=0
PASS R3 stored private event blocked :: calls=0
PASS R3 stored processing-denied event blocked :: calls=0
PASS R3 live policy change after authorization blocked :: calls=0
PASS R3 wrapper allowed dispatches each boundary once :: jev=1 deepseek=1
PASS R3 wrapper missing policy no dispatch :: calls=0
```

The same-source/different-event bypass is closed. JEV requires the event id in the authorization, verifies the stored owner/source/privacy/processing, and re-evaluates the live policy before `fetch`. The wrapper passes the event id and still dispatches each boundary exactly once.

### R4 — inspect graph neighbours (partial)

`probe-r4b.mjs`:

```
PASS R4b root+unlineaged: dispatch once :: calls=1
PASS R4b root+unlineaged: root present
PASS R4b root+unlineaged: neighbour omitted
PASS R4b root+allowed: dispatch once :: calls=1
PASS R4b root+allowed: both present
FAIL R4b root+denied: root still dispatches :: calls=0
PASS R4b root+denied: denied neighbour omitted
FAIL R4b root+allowed+denied+unlineaged: dispatch once :: calls=0
FAIL R4b mixed: root and allowed present
PASS R4b mixed: denied and unlineaged omitted
```

Root cause: `loadInspectEntityLineage` marks per-entity eligibility using owner, privacy status and processing permission, but **does not apply source policy**. A neighbour whose source denies egress is therefore classified `eligible`, its denied event is added to the authorization, `authorizeModelDispatch` denies the whole intersection, and no external summary is produced. The denied neighbour is indeed omitted, but the allowed root and allowed neighbour are also suppressed. This is an over-blocking regression, not a payload leak.

The external payload filtering itself works for unlineaged and allowed neighbours; local `graph`/`searchResult` still contain the blocked nodes. r3's admitted gap that `searchResult.relations` are not individually lineage-gated remains.

### Regression

- Prior B/C/D/G probe: 32/32 pass (denied/foreign/missing owner/purpose, queued revocation, in-flight revoke, mixed digest, allowed DeepSeek+embedding, redaction).
- Prior D2 proactive probe: 9/9 pass.
- Prior D3 `evaluate-laya`: refusal exit 1 with 0 spy lines; opt-in exit 0, requested 3/evaluated 2, redacted, foreign/denied rows skipped.
- Prior D4 core probe: all pass except the old “deleted policy falls back to permissive” assertion, which now correctly returns `source_policy_missing` (R1 improvement). Deletion still clears the computed stale flag.
- Prior D4 vector probe: 2/2 pass (the r2 defect is fixed).
- Prior D5 provenance: 10/10 pass.
- Prior E logs/errors: 9/9 pass. Prior F missing-policy assertions now deny, as expected under R1.

### Scope (r3)

All amended-boundary files are changed/added versus `snapshot-backend.json`. r3-attributable files outside the amended boundary:

| Path | Status | Assessment |
|---|---|---|
| `src/storage/privacy.ts` | changed | Outside the amended r2 boundary, but inside the **original B07 exclusive reservation**; not an out-of-bound write for B07. |
| `tests/intelligence.test.ts` | changed | Outside the amended boundary; declared by r3 as an R1 fixture deviation. Flag as a declared out-of-bound test write. |
| `graphify-out/*` | changed | Generated by `graphify update .`; declared, out-of-bound artifact. |
| `contracts/schema/manifest.json` | still differs from snapshot | Carried from r1; r3 says it was not regenerated. |
| `tests/v2-harness/artifacts/latest.json` | changed | Rewritten by the required `test:v2` command, not a source edit. |

`src/storage/classification-assistant.ts` is inside the amended boundary and the original reservation; r3's "boundary deviation" label is conservative.

### Conditions for clean acceptance

1. Apply source-policy eligibility per entity in `loadInspectEntityLineage` (or exclude blocked entities before building the authorization), so a denied neighbour is omitted without poisoning the allowed root/allowed neighbours. Add the missing R4 regression for the denied-neighbour case.
2. Close or explicitly accept the carried zero-explicit-source derived-lineage gap (reconciler/node descriptions with unattributable sources).
3. Decide legacy `policy_version = null` run semantics and route-created embeddings with null `client_id`; both currently surface via the full-text branch.
4. Reconcile r3's claim that legacy null is non-stale in both retrieval branches with the observed stricter vector behavior.
5. Real PostgreSQL/RLS/concurrency/restore and E06/E08/E10/E12 remain BLOCKED.

---

## Second-pass verification (r2 addendum, historical)

- Repository/HEAD: `D:/Coding/BrainIA/BrainIA-Backend` / `b71c4cc82ca0faa636db656c729e79cb906a9114` (unchanged). Tree dirty; no source/test/migration/manifest/mobile edit by this verifier.
- Inputs: `docs/reports/v2/B07-r2.md`, current source, `tests/v2-privacy-boundary.test.ts`, `snapshot-backend.json`.
- Independent probes: `C:/Users/germa/AppData/Local/Temp/opencode/b07-verify2/*.mjs` (outside the repository). Isolated PGlite + in-process transport spies; no real provider or production DB call.

### Verdict rationale

`accepted-with-conditions`, not `accepted`: the remediated paths pass, but the following are reproducible and still outside the B07 acceptance bar:

1. **Carried (not remediated) missing-policy default.** A source with no `source_processing_policies` row authorizes at `policyVersion = 0` and the real capture classifier + semantic enrichment dispatch raw event bytes. Reproduced in this pass. `B07-r2.md` admits this remains a separate architecture/backfill decision.
2. **New D4 residual: stale derived embeddings are not invalidated and are still returned by the vector branch.** A policy bump marks the `insight_runs`/`digest_runs` rows stale and the text branch excludes them, but the corresponding `knowledge_embeddings` rows have no `metadata.source`, so `invalidateDerivedWorkForPolicyChange` skips them; the hybrid vector query has no stale/policy filter. After denying the source, `hybridRetrieve` still returned both stale insight and digest excerpts.
3. **New D1 residual: partial lineage.** The inspected root entity is now correctly gated, but graph neighbours with no event lineage are still included in the external prompt. A root with allowed lineage plus an unlineaged neighbour dispatched the neighbour description in one call.
4. **Policy-row deletion.** Deleting a source-policy row clears the computed stale flags and falls back to the permissive default. There is no application deletion path today; this is a direct-DB behavior.
5. **JEV public API source scope.** A valid authorization for owner A + source S admits any event object with source S, including a different event not present in `raw_events`. Direct-call only; no in-repo caller passes such an object.

No reproducible route-level denied-source provider dispatch remains after r2. The conditions above should be resolved before B07 is treated as a clean acceptance.

### Command exits (second pass)

| Command | Exit | Observed |
|---|---:|---|
| `npm run lint` | 0 | no diagnostics |
| `npm run build` | 0 | no diagnostics |
| `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-privacy-boundary.test.ts` | 0 | 12 tests / 12 pass / 0 fail |
| `npm run test:isolated` | 0 | 144 tests / 144 pass / 0 fail |
| `$env:NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'; npm run schema:verify -- --read-only` | 0 | `{"ok":true,"readOnly":true,"problems":[]}` |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | 47 migrations / 1742 objects; ACL/drift/idempotency PASS; real-PG BLOCKED |
| `npm run contracts:verify` | 0 | 382 checks; 58 fixtures; 7 identity sequences; bundle `312c92f8…abad6` |
| `npm run test:v2 -- --suite E08,E10` | 2 | E08 BLOCKED 200/200; E10 BLOCKED 10 000/10 000 (expected) |

### D1 — entity-only inspect (independent)

`probe-d1.mjs`:

```
PASS D1 denied entity id: zero calls :: calls=0
PASS D1 denied entity id: summary null
PASS D1 denied entity q: zero calls :: calls=0
PASS D1 event-bearing denied: zero calls :: calls=0
PASS D1 event-bearing denied: no marker
PASS D1 no-lineage entity: zero calls :: calls=0
PASS D1 no-lineage entity: no marker
PASS D1 cross-owner lineage link blocked by owner constraint :: blocked_by_db: event_entity_entity_owner_mismatch
PASS D1 private lineage: zero calls :: calls=0
PASS D1 processing-denied lineage: zero calls :: calls=0
PASS D1 allowed entity: exactly one call :: calls=1
PASS D1 allowed entity: marker present
PASS D1 allowed entity: summary published
PASS D1 partial-lineage graph dispatches :: calls=1
PASS D1 partial-lineage neighbour bytes dispatched without lineage :: {..."description": "D1G_NEIGHBOUR_NOLINEAGE..." ...}
```

The root entity/denied-source case is fixed. The residual is node-granularity: the lineage resolver marks ambiguity when *no* event exists or any *returned* event is ineligible; an unlineaged graph neighbour alongside an allowed root does not set `ambiguous`, so its description is still sent. The DB owner triggers prevent cross-owner event/entity links (`event_entity_entity_owner_mismatch`), so the cross-owner case is defence-in-depth plus a constraint, not a reachable path.

### D2 — proactive insight embedding

`probe-d2.mjs`:

```
PASS D2 denied source: zero external calls :: calls=0
PASS D2 denied source: no denied bytes dispatched
PASS D2 denied source: run published deterministic
PASS D2 denied source: local embedding stored :: {"model":"brainia-semantic-hash", ...}
PASS D2 allowed source: external embedding dispatched once :: embedding=1 total=1
PASS D2 allowed source: embedding carries explanation
PASS D2 allowed source: external model recorded :: {"model":"text-embedding-test"}
PASS D2 denied auth is denied
PASS D2 explicit denied authorization keeps embedding local :: calls=0
```

The synthesis authorization is now the single embedding gate; a denied derivation never reaches the embedding provider.

### D3 — evaluate-laya

Refusal run without the three opt-in variables (data seeded in the same isolated process, spy appends to a file):

```
evaluate-laya refused: set LAYA_EVALUATION_OWNER, ...
REFUSE_EXIT=1
SPY_LINES=0
```

Opt-in run with owner A, one denied row for A and one foreign row for B:

```
APPROVE_EXIT=0
SPY_LINES=2
FOREIGN_PRESENT=0
requested=3 evaluated=2
body: ... contact [redacted-email]@example.com card [redacted-card] ...
```

The query is owner-scoped, denied rows are skipped, redaction is applied per authorized row, and the foreign/denied markers never reach the spy. No ungated direct dispatch remains in this script.

### D4 — derived-run policy versions and retrieval

Core (`probe-d4.mjs`):

```
PASS D4 insight persists policy version :: run=1 policy=1
PASS D4 digest persists policy version :: run=1
PASS D4 fresh runs not stale
PASS D4 hybrid includes fresh runs :: digest:...,insight:...
PASS D4 policy bump increments version :: 1 -> 2
PASS D4 stale after bump (list) :: {"i":true,"d":true}
PASS D4 stale after bump (load by id)
PASS D4 hybrid excludes stale runs
PASS D4 explicit policy version honored :: 99
PASS D4 deleting policy row clears stale detection :: {"i":false,"d":false}
PASS D4 deleted policy falls back to permissive default
```

Residual (`probe-d4-vector.mjs`):

```
FAIL D4 vector embeddings marked stale after bump :: [{"object_type":"digest","stale":null,"policy_version":1},{"object_type":"insight","stale":null,"policy_version":1}]
FAIL D4 hybrid text+vector excludes stale derived runs :: digest:... excerpt=digest D4VSTALEMARKER... | insight:... excerpt=insight D4VSTALEMARKER...
```

Cause: `invalidateDerivedWorkForPolicyChange` only updates embeddings whose `metadata->>'source'` matches; insight/digest embeddings created by routes/proactive paths carry no `source`. Even if marked, the vector branch of `hybridRetrieve` (unlike the text branch) has no `policyStale`/`policy_version` filter. Therefore “hybrid retrieval excludes stale runs” holds for full-text candidates but not for vector candidates. This is the main new defect from the second pass.

Deletion behavior: no application path deletes a policy row; direct deletion clears stale detection and restores the permissive default. `B07-r2.md` admits the stale-detection limitation.

### D5 — embedding provenance

`probe-d5.mjs`:

```
PASS D5 unset model: zero calls :: calls=0
PASS D5 unset model: local label :: brainia-semantic-hash
PASS D5 blank model: zero calls :: calls=0
PASS D5 blank model: local label
PASS D5 explicit model: one call :: calls=1
PASS D5 explicit model: body carries model :: {"model":"text-embedding-d5", ...}
PASS D5 explicit model: provenance label :: text-embedding-d5
PASS D5 audit records external model :: {"model":"text-embedding-d5", ...}
PASS D5 missing key: zero calls and local
```

### Latent — reconciler and JEV

`probe-latent.mjs`:

```
PASS Reconciler ownerless denied :: reason=missing_owner
PASS Reconciler owner A dispatches :: calls=2
PASS Reconciler owner A includes A node
PASS Reconciler owner A excludes B node
PASS Reconciler denied-source intersection blocks :: reason=source_llm_denied
PASS JEV no authorization: no dispatch :: calls=0
PASS JEV wrong purpose: no dispatch :: calls=0
PASS JEV wrong owner: no dispatch :: calls=0
PASS JEV valid authorization: one dispatch :: calls=1
PASS JEV wrapper with denied source: no dispatch :: calls=0
PASS JEV source-scoped auth admits a same-source different-event payload :: calls=1
```

The reconciler is owner-filtered and uses the conservative denied-source intersection. JEV now requires an owner-scoped, purpose-scoped authorization. Residual: the JEV check accepts `authorization.sources.includes(event.source)` without binding the event id to the DB owner, so a direct caller with a valid source-level authorization can submit a different event with the same source name. No in-repo caller does this (the wrapper passes the real event).

### Regression probes

`probe-bcd.mjs` (prior B/C/D/G) exits 0: denied source/foreign owner/missing owner/purpose → 0 calls; queued revocation → 1 in-flight call, second blocked; in-flight revoke → no stale publish; digest intersection → 0 calls; allowed path → 1 DeepSeek + 1 embedding with redaction. `probe-ef.mjs` exits 0: provider error bodies absent from thrown errors/logs/audits; policy bump invalidates event embeddings and cache generation; missing-policy still authorizes and dispatches (carried condition).

### Scope (r2)

Boundary files are all `changed`/`added` relative to `snapshot-backend.json`: `src/routes/agent-inspect.ts`, `src/storage/{agent-inspect,embeddings,proactive-insights,jev,classification-assistant,semantic-reconciler,insight-repository,digest-repository,hybrid-retrieval}.ts`, `src/scripts/evaluate-laya.ts`, `tests/v2-privacy-boundary.test.ts`, `docs/reports/v2/B07-{r1,r2,verification}.md`. No r2-attributable write was found outside the amended boundary. Carried r1 artifacts outside it: `src/storage/privacy.ts`, `migrations/20261017130000_privacy_policy_versioning.sql`, `contracts/schema/manifest.json` (still differs from snapshot). `graphify-out/*` was regenerated by r2 but is outside the amended boundary (generated artifact); `tests/v2-harness/artifacts/latest.json` was rewritten by the required `test:v2` command, not by a source edit.

### Conditions for clean acceptance

1. Fail closed (or backfill explicit policy rows) for missing source policy, to match `BRAIN_AI_V2_ARCHITECTURE.md`.
2. Mark insight/digest `knowledge_embeddings` stale on policy change (do not rely on `metadata.source`) and filter stale/policy-versioned embeddings in the hybrid vector branch.
3. Treat partial/absent lineage for any personal graph node as ambiguous, or exclude unlineaged personal nodes from the external prompt.
4. Decide and document policy-row deletion semantics (tombstone or deny), since deletion clears stale detection and restores the permissive default.
5. Bind JEV authorizations to the event id (or verify event ownership) for direct callers; keep the wrapper path.
6. Real PostgreSQL/RLS/concurrency and E06/E08/E10/E12 remain BLOCKED.

---

## First-pass verification (r1, historical; verdict superseded)

- Repository: `D:/Coding/BrainIA/BrainIA-Backend`
- Branch/HEAD: `main` / `b71c4cc82ca0faa636db656c729e79cb906a9114` (matches `snapshot-backend.json`)
- Tree: dirty; pre-existing/concurrent v2 changes preserved. No source, test, migration, manifest or mobile file was modified by this verifier. The only repository file created is this report.
- Probe scripts: `C:/Users/germa/AppData/Local/Temp/opencode/b07-verify/*.mjs` (outside the repository, deleted/kept outside Git). No production DB, no real provider call, no install, no commit.
- Inputs: task spec lines 381–415, PRD, EVALUATION (E06/E08/E10/E12, provider procedure), B07-r1, current source, migration `20261017130000_privacy_policy_versioning.sql`, `tests/v2-privacy-boundary.test.ts`, snapshot.

## First-pass verdict (rejected, superseded)

**rejected** — reproducible forbidden dispatch with exact evidence:

`GET /api/v1/agent/inspect?id=<entity>` (also `?q=<entity-name>`) for an owner whose only contributing source has `send_to_llm = false`, and where the search returns the entity but no event, calls `https://api.deepseek.com/chat/completions` with the entity description derived from that denied source. The authorization at `src/storage/agent-inspect.ts:141-150` sends `sources: input.events.map(...)`; when `searchResult.events` is empty the source intersection is empty, `authorizeModelDispatch` authorizes with `policyVersion = 0` and no source-policy loop iteration (`src/storage/privacy.ts:256-269`), and the summary prompt at `:91-105` includes `rootEntity` and `graph`.

The same request with the denied event present in the search result is correctly blocked. Contrast probe:

```
withEventCalls: 0, entityOnlyCalls: 1, entityOnlyBodyHasSecret: true
```

Focused reproduction (temp probe `probe-inspect.mjs`, isolated PGlite):

```
policy: owner=<focus-owner> source=<mail.focus.denied...> send_to_llm=false
denied event title: "Ordinary notification heading"
linked entity description: "FOCUS_ENTITY_SECRET_<uuid>"
q-path calls 1 contains marker true
id-path calls 1 contains marker true
id-path body excerpt: ... "description": "FOCUS_ENTITY_SECRET_<uuid>" ...
```

This violates the B07 acceptance criterion "network spies observe zero forbidden payload bytes" and the requirement to authorize "retrieval context" before dispatch. The central gate is not at fault; the caller's evidence set is incomplete and the gate permits data-bearing purposes with zero sources/evidence.

## Acceptance table

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Inventory every direct/indirect model + embedding caller | PARTIAL | 79 static matches; call graph enumerated below. Three ungated paths found (`evaluate-laya`, direct `classifyWithJev`, entity-only inspect). |
| 2 | Owner + purpose + evidence eligibility before dispatch | FAIL | Event-attributed paths pass; entity-only inspect, missing-policy sources, direct JEV and the `evaluate-laya` script do not. |
| 3 | Denied source / foreign owner / missing owner / missing purpose → zero transport | PASS on tested paths | `probe-bcd.mjs`: 0 calls, no marker in logs. See B. |
| 4 | Revocation while queued prevents dispatch | PASS | 1 in-flight call only, second returns `null`, no second fetch. See C. |
| 5 | Revocation during in-flight request prevents stale publish | PASS | Response returned after revoke was suppressed (`null`), no stale content. See C. |
| 6 | Mixed-source summaries use intersection permissions | PASS for event-attributed digest; FAIL for entity-only/derived | Digest denied, 0 calls; entity-only inspect dispatched denied bytes. See D and the verdict. |
| 7 | No provider body/personal payload in logs, audits or thrown errors | PASS | 500 body with marker absent from thrown error, console, `model_call_audits`; embedding 500 and malformed-vector bodies also absent. See E. |
| 8 | Version policy; invalidate derived work/caches; mark stale | PARTIAL | Version bump, trigger, embedding re-stamp, cache generation and metadata-only audit pass. `insight_runs.policy_version` / `digest_runs.policy_version` exist but are never written or re-evaluated. See F. |
| 9 | Allowed path still dispatches exactly once and publishes | PASS | 1 DeepSeek call, 1 embedding call, redaction applied. See G. |
| 10 | Network spies observe zero forbidden payload bytes | **FAIL** | Entity-only inspect and (owner-invoked) proactive embedding dispatch denied-source-derived text. |
| 11 | Migration additive and schema contract matches | PASS | 4 columns, trigger, audit table; `schema:verify` and `contracts:verify` pass; migration has no destructive statement. |
| 12 | No out-of-bound writes | **FAIL / deviation** | `contracts/schema/manifest.json` and `tests/v2-privacy-boundary.test.ts` are outside the exclusive write reservation; no approval hash recorded. See H. |
| 13 | Required v2 suites | BLOCKED (expected) | E06/E12 and E08/E10 exit 2; no adapter credit. |

## Command table (exact exits)

| Command | Exit | Observed |
|---|---:|---|
| `npm run lint` | 0 | `tsc --noEmit`, no diagnostics. |
| `npm run build` | 0 | `tsc`, no diagnostics. |
| `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-privacy-boundary.test.ts` | 0 | 5 tests / 5 pass / 0 fail. |
| `npm run test:isolated` | 0 | 137 tests / 137 pass / 0 fail (includes the 5 B07 tests). |
| `$env:NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'; npm run schema:verify -- --read-only` | 0 | `{"ok":true,"readOnly":true,"problems":[]}`. |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | 47 migrations, 1742 objects; ACL/drift/idempotency PASS; real-PostgreSQL lines BLOCKED. |
| `npm run contracts:verify` | 0 | 382 checks; 58 fixtures; 7 identity sequences; bundle `312c92f8…abad6`; 30 open G1 decisions. |
| `npm run test:v2 -- --suite E08,E10` | 2 | E08 BLOCKED 200/200; E10 BLOCKED 10 000/10 000. Expected. |
| `npm run test:v2 -- --suite E06,E12` | 2 | E06 BLOCKED 180/180; E12 BLOCKED 100/100. Expected. |

## Probe A — call-site inventory

Method: static search for `fetch(`, `generateNaturalLanguageSummary`, `generateEmbedding`, `classifyWithJev`, `requestSemanticJson`, `authorizeModelDispatch`, plus manual call-graph review of routes/jobs/scripts. There are exactly two provider `fetch` primitives in runtime storage: `deepseek.ts:73` and `embeddings.ts:116`; JEV owns a third at `jev.ts:66`; `evaluate-laya.ts:22` owns a fourth; `remote-smoke.ts` calls this repository's HTTP API, not a provider.

| Boundary | Payload | Gate on the actual dispatch path | Result |
|---|---|---|---|
| `deepseek.generateNaturalLanguageSummary` | prompts/evidence | requires `PrivacyAuthorization`; owner/purpose/source/evidence checked by caller | PASS |
| `embeddings.generateEmbedding` | event/entity/insight/digest text; query text | requires authorization; hybrid retrieval passes none → local | PASS (fails closed) |
| `classification-assistant` → DeepSeek | event title/body/tags/raw | owner + `event_classification` + source policy | PASS with explicit policy; missing policy permissive (defect) |
| `classification-assistant` → JEV | same | indirect: wrapper authorizes, passes `allowModel:false` on deny; `jev.ts` itself only checks source policy by `clientId` | conditional bypass |
| `semantic-enrichment` | title/body/subjects/context | owner + `semantic_enrichment` + source + optional audit event | PASS |
| `semantic-reconciler` | **global** graph nodes | owner + `semantic_reconciliation`, no sources/evidence; nodes query not owner-filtered | ownerless callers denied; owner-supplied latent cross-owner leak |
| `agent-inspect` | query, resolution, entity, graph, search results | owner + `agent_inspect` + **only returned event sources** | **entity-only leak confirmed** |
| `digests` | event highlights, insights | owner + `knowledge_digest_synthesis` + event sources + all denied owner sources when insights present | PASS for events; insight lineage conservative but bounded |
| `proactive-insights` | candidate titles/explanations | `proactive_insight_synthesis` + denied-source list | LLM blocked; derived summary later sent to embeddings on owner path |
| `intelligence` | objective/history/evidence | owner + plan/synthesis purposes + evidence events; recheck before publish | PASS by review (not separately probed) |
| `embeddings.upsertEmbedding` | summaries with no `metadata.source` | owner + `embedding`, zero sources allowed | ownerless callers local; owner callers can send derived text |
| `hybrid-retrieval` | query text | none → local vector | PASS (mitigating control) |
| `jev.classifyWithJev` direct export | full event | only legacy source policy by `clientId`; no owner/purpose/evidence | **bypass reproduced** |
| `scripts/evaluate-laya.ts` | 25–500 raw events across owners | **none**; direct fetch | **bypass reproduced** |
| `scripts/probe-deepseek-semantic.ts`, `validate-live-intelligence.ts` | prompts | `generateNaturalLanguageSummary` without authorization | fail closed (`null`) |
| ownerless cron/digest/insight | deterministic content | `missing_owner` | PASS (0 calls) |

## Probe B — denied dispatch

`probe-bcd.mjs` (PGlite, transport spy, denied policy `send_to_llm=false`):

```
PASS B denied policy decision :: reason=source_llm_denied
PASS B denied dispatch summary null
PASS B denied dispatch embedding local
PASS B denied dispatch semantic structural :: status=review reason=privacy_policy
PASS B denied dispatch classifier no model
PASS B denied paths made zero transport calls :: calls=0
PASS B denied payload never logged
PASS B foreign owner denied :: reason=cross_owner_evidence
PASS B missing owner denied
PASS B missing purpose denied
PASS B unknown purpose denied
PASS B non-standard evidence denied :: reason=evidence_not_standard
PASS B processing-denied evidence denied
PASS B legacy unowned evidence denied
PASS B missing evidence denied
PASS B evidence-only denied source discovered :: reason=source_llm_denied
PASS B probes made zero transport calls :: calls=0
```

## Probe C — revocation

`probe-bcd.mjs`:

```
PASS C queued dispatch blocked after revocation
PASS C in-flight result suppressed after revocation
PASS C only the in-flight request reached transport :: calls=1
PASS C in-flight response not published after revoke
PASS C in-flight transport count
```

Queued call: authorization obtained, first request occupies the per-owner semaphore slot, policy revoked to `send_to_llm=false`, semaphore released. Second request never fetched; first response discarded (`null`). In-flight case: revoke after `fetch()` starts and before the response resolves; result suppressed. Matches B07-r1.

## Probe D — intersection

`probe-bcd.mjs`:

```
PASS D mixed intersection denied :: reason=source_llm_denied
PASS D mixed digest publishes no model output
PASS D mixed digest dispatches nothing
PASS D denied bytes absent from transport
PASS D allowed subset authorizes
```

Both explicit sources and evidence-only source discovery (no `sources` array, only denied event id) deny correctly. The digest over mixed sources makes zero calls and keeps deterministic content.

**But intersection is not applied to retrieval context:** the entity-only inspect path has no event, so the source intersection is empty and authorization succeeds. This is the core failure.

## Probe E — logs, errors, audits

`probe-ef.mjs`:

```
PASS E summary request reached provider
PASS E thrown error has no provider body :: DeepSeek request failed with HTTP 500
PASS E error not logged
PASS E error body not stored in audit
PASS E error audit metadata bounded :: result_metadata={httpStatus:500}
PASS E embedding error falls back local
PASS E embedding error body not stored
PASS E embedding invalid vector falls back and does not leak
PASS E total logs clean
```

Denial logs are metadata-only (`reason`, `purpose`, `sourceCount`) and contain neither owner id, source name, nor marker. No provider body reaches `model_call_audits`.

## Probe F — policy versioning / invalidation

`probe-ef.mjs`:

```
PASS F policy starts at version 1
PASS F policy version increments on egress change :: 1 -> 2
PASS F embedding re-stamped with new version
PASS F embedding marked policyStale
PASS F derived rows preserved
PASS F in-process cache generation invalidated
PASS F policy change audited metadata-only
PASS F policy audit contains no payload
PASS F insight/digest runs are not re-stamped or marked stale :: both stay policy_version=1
PASS F all four policy_version columns exist
PASS F version-bump trigger installed
PASS F policy change audit table installed
PASS F no-op update keeps version
PASS F missing policy currently authorizes (compatibility default)
PASS F missing policy dispatches bytes :: calls=1
PASS F policy insert after authorization revokes recheck
```

Migration review: `alter table ... add column if not exists`, `create index if not exists`, `create table if not exists`, one `drop trigger if exists` for its own trigger, `create or replace function`, an idempotent `update ... where policy_version is null`, and role revokes. No existing row/column/object is removed. Contract manifest contains `20261017130000_privacy_policy_versioning.sql`, the new columns, the table and the bump function.

**Gap:** the new `insight_runs.policy_version` and `digest_runs.policy_version` columns are dead. No code writes or reads them (grep finds them only in the migration and the snapshot). A policy change does not mark insight/digest runs stale or re-derive them. B07-r1 says "marks stale work" but only embeddings and the in-process generation are invalidated.

## Probe G — allowed path

`probe-bcd.mjs`:

```
PASS G allowed authorization
PASS G allowed dispatch returns content
PASS G allowed dispatch exactly once :: calls=1
PASS G allowed payload redacted :: contact [redacted-email]@example.com card [redacted-card]
PASS G allowed embedding external once :: calls=1 model=text-embedding-test
```

No over-blocking regression for event-attributed DeepSeek/embedding paths. One observation: if `EMBEDDING_API_URL`/`EMBEDDING_API_KEY` are set but `EMBEDDING_MODEL` is unset, an external vector is labelled `brainia-semantic-hash`. This mixes vector spaces despite the architecture requirement; it is a provenance defect, not an egress leak.

## Probe H — scope attribution

Snapshot (`captured_at_utc 2026-10-17T18:18:16Z`, HEAD `b71c4cc`) compared by SHA-256 over the non-`.git`/`node_modules`/`dist`/`.laya-venv` tree:

```
currentFileCount: 551
addedCount: 101
removedCount: 0
changedCount: 58
manifest SHA-256: ea41cb1278…c444
```

All files declared by B07-r1 are detected as changed/added, including the 10 reserved storage files, the migration, `contracts/schema/manifest.json`, `tests/v2-privacy-boundary.test.ts` and `docs/reports/v2/B07-r1.md`. No deletions. The tree also contains many unrelated v2 task changes (B04/B05/B06, routes, graphify, logs, snapshots); hash comparison alone cannot attribute those to B07, and B07-r1 declares that they are pre-existing/concurrent. I do not attribute them to B07.

Out-of-reservation B07-attributable writes:

| Path | Reservation status | Assessment |
|---|---|---|
| `src/storage/privacy.ts`, `deepseek.ts`, `embeddings.ts`, `semantic-enrichment.ts`, `semantic-reconciler.ts`, `classification-assistant.ts`, `intelligence.ts`, `agent-inspect.ts`, `digests.ts`, `proactive-insights.ts` | reserved | In scope. |
| `migrations/20261017130000_privacy_policy_versioning.sql` | not reserved; spec says "via migration owner" | Expected, but no migration-owner approval hash is recorded in B07-r1. |
| `contracts/schema/manifest.json` | **not reserved** | Contract manifest regenerated; 266 KB; contains the new objects. Needs explicit supervisor approval or reseal decision. |
| `tests/v2-privacy-boundary.test.ts` | **not reserved** | New test file outside the exclusive write list. Useful, but a scope deviation unless the task's test exception is approved. |
| `docs/reports/v2/B07-r1.md` | not reserved (deliverable) | Required report. |

No out-of-bound write to mobile, job-repository, job-worker, operations, Vercel, auth, app, postgres or financial files is attributable to B07 from the declared list.

## Bypass matrix

| # | Path | Gate on actual path | Reproduction | Classification |
|---|---|---|---|---|
| 1 | `/api/v1/agent/inspect?id=entity` / `?q=<entity>` with no returned event | `agent_inspect` + owner, **sources = returned event sources only** | `probe-inspect.mjs`: 1 DeepSeek call, body contains denied entity description; event-bearing query 0 calls | **Confirmed defect (P0, route-reachable)** |
| 2 | Owner-invoked `synthesizeTopInsightCandidates` | LLM denied correctly; `upsertEmbedding` uses `embedding` + owner, **no source** | `probe-special.mjs`: LLM calls 0, embedding calls 1, body `{"input":"PROACTIVE_DENIED_EXPLANATION"}` | **Conditional vulnerability** (no current route passes an owner; cron is ownerless) |
| 3 | `classifyWithJev` direct export | only `loadSourceProcessingPolicy(clientId)`; no owner/purpose/evidence | `probe-special.mjs`: no `clientId` → 1 call with `JEV_OWNER_SECRET`; wrong-owner `clientId` → 1 call with the same denied owner's bytes | **Conditional vulnerability** (no in-repo direct caller; exported API) |
| 4 | `scripts/evaluate-laya.ts` | **none**; direct `fetch` over `raw_events` across owners, filtered only by `privacy_status='standard'`/`processing_allowed` | `probe-special.mjs`: 1 JEV call with `LAYAYA_BYPASS_SECRET` although that source is `send_to_llm=false` | **Confirmed defect (script, manual execution)**; contradicts B07-r1's "now fail closed" |
| 5 | New source with no policy row | `DEFAULT_SOURCE_POLICY` = enabled/sendToLlm true | `probe-missing-policy.mjs`: 0 policy rows, authorization allowed at version 0, 1 classification + 2 semantic calls, marker in bodies | **Confirmed defect** vs architecture ("legacy missing-policy rows do not inherit today's permissive default"); admitted by r1 |
| 6 | `reconcileSemanticGraph({ownerId})` | owner + purpose, no sources; node query unfiltered | `probe-special.mjs`: ownerless → `privacy_denied` 0 calls; with owner A → 2 calls containing owner B's node | **Conditional vulnerability** (no current caller passes owner; would be cross-owner if wired) |
| 7 | Hybrid retrieval query embedding | none → local | 0 embedding calls | **Mitigating control** |
| 8 | Ownerless cron/daily evaluation | `missing_owner` | 0 external calls | **Mitigating control** |
| 9 | Routes `/insights`, `/digests` embedding of summaries | no owner id passed → local | By code: `missing_owner` → local | **Mitigating control** (but data loses owner attribution) |

## Assessment of B07-r1 limitations

| Admitted limitation | Verifier finding | Classification |
|---|---|---|
| Hybrid-retrieval query embedding has no purpose token | Confirmed: `generateEmbedding` without authorization returns the local vector; 0 calls even with provider configured. No query payload leaves the process. | **Mitigating control**, accurately described |
| Semantic reconciler callers do not pass `ownerId` | Confirmed: route/job/script callers denied (`privacy_denied`, 0 calls). However, the function accepts `ownerId` and then sends unfiltered global nodes; proved owner B's node in an owner-A request. | **Mitigating control for current callers; conditional cross-owner vulnerability if owner propagation is added without an owner filter** |
| JEV direct callers rely on existing policy check | Confirmed: `classifyWithJev` has no owner/purpose/evidence gate. Direct call with no `clientId`, or with a different owner's `clientId`, dispatches a denied owner's event. No in-repo direct caller today. | **Conditional vulnerability**, accurately described but understated |
| Scripts with direct provider calls now fail closed | **Inaccurate.** `probe-deepseek-semantic.ts` and `validate-live-intelligence.ts` fail closed; `evaluate-laya.ts` does not use the gate at all and dispatches raw event titles/bodies directly. `remote-smoke.ts` calls this API, not a provider. | **Confirmed defect for evaluate-laya; report statement is wrong** |
| Missing-policy compatibility default is permissive | Confirmed: authorization allowed at version 0; real capture classifier and semantic enrichment dispatch raw marker with no policy row. Contradicts `BRAIN_AI_V2_ARCHITECTURE.md` security/privacy requirement. | **Confirmed defect**, accurately admitted |
| Ownerless cron/empty-body paths keep deterministic content | Confirmed: `runDailyKnowledgeEvaluation()` made 0 external calls; `missing_owner` denials logged. | **Mitigating control**, accurately described |
| Proactive candidates have no reliable source lineage | Confirmed and worse on the owner path: LLM synthesis is blocked, but the deterministic denied-derived summary is then sent to external embeddings under `embedding` with zero sources. Current cron passes no owner, so this is latent. | **Conditional vulnerability**, not fully described |
| `(client_scope, source)` uniqueness can collide across owners | Not re-proved in this pass; schema still has the legacy unique key. | **Unverified assumption** (plausible; needs owner-key migration) |
| RLS not wired into request routes | Out of B07 scope; schema verify passes with restricted-role checks. | **Unverified assumption** for production enforcement |

## New defects (not in B07-r1)

1. **P0 — Entity-only agent inspect bypasses source egress policy.** Route-reachable, zero-to-one fetch with denied-source-derived entity/graph bytes. Root cause: the authorize call only includes returned event sources, and `authorizeModelDispatch` allows data-bearing purposes with zero sources/evidence (`privacy.ts:256-269`).
2. **P1 — Proactive insight embedding sends denied-derived deterministic content.** `proactive-insights.ts:427` calls `upsertEmbedding` with owner + summary but no source; `embeddings.ts:168-171` authorizes with an empty source set. Latent because the owner path is not route-wired today.
3. **P1 — `evaluate-laya.ts` is an ungated direct provider call site.** Contradicts the r1 "scripts now fail closed" claim.
4. **P2 — `insight_runs.policy_version` / `digest_runs.policy_version` are dead columns.** Policy changes do not invalidate or mark stale derived insight/digest runs.
5. **P2 — External embedding vectors can be labelled `brainia-semantic-hash` when `EMBEDDING_MODEL` is unset**, mixing local and external vector spaces (provenance/correctness, not egress).

## Required follow-up (for a re-verification)

1. Gate agent-inspect on the full retrieval context: include entity/graph supporting evidence with owner and source lineage, or fail closed when no event/source evidence is available for a data-bearing purpose.
2. Require at least one source or evidence item for data-bearing purposes (`agent_inspect`, `embedding`, `semantic_reconciliation`, `knowledge_digest_synthesis`, `intelligence_*`, `proactive_insight_synthesis`); make "no evidence" an explicit data-free purpose, not a default allow.
3. Propagate owner/source into `synthesizeTopInsightCandidates` → embedding, and into the reconciler's node query (owner filter) before any caller passes `ownerId`.
4. Make `classifyWithJev` accept and enforce a `PrivacyAuthorization`, or make it non-exported/require an already-authorized token; keep the indirect wrapper.
5. Remove or gate the direct provider call in `evaluate-laya.ts` (authorization, owner filter, or explicit offline-only guard).
6. Fail closed on missing source policy for external egress (or require an approved backfill that creates explicit policy rows) to match the architecture.
7. Persist and re-evaluate `insight_runs.policy_version` / `digest_runs.policy_version` on policy change, or delete the unused columns from the contract.
8. Record explicit supervisor approval for the out-of-reservation `contracts/schema/manifest.json` and `tests/v2-privacy-boundary.test.ts` writes (and the migration-owner approval hash).

## Notes on evidence quality

- All runtime probes used PGlite via `tests/pglite-setup.mjs`, with `globalThis.fetch` replaced by an in-process transport spy returning synthetic 200/500 responses. No request reached a real provider.
- Real PostgreSQL concurrency, RLS deployment, `pg_dump`/restore and multi-process job-claim behavior remain **BLOCKED**; the isolated PGlite results cannot certify them.
- The required `test:v2` invocation rewrote `tests/v2-harness/artifacts/latest.json`; this is harness-generated output, not a source edit by the verifier.
