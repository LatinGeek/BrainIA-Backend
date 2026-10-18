# B11 final re-verification (r4, current)

Status: **accepted-with-conditions**. The r4 `relatedInsights` fix removes the
last reproducible served-content path found in r3. No source/test/migration/
manifest/mobile write was made by this verifier.

## R4 echo path: PASS

Reproduced the exact r3 shape: old event (2020) + entity E + entity-only legacy
insight created before a ledger-only tombstone; live event B in the digest
window; source policy permitting synthesis.

- Legacy insight is ineligible first: `loadInsightRunById` null, absent from
  `listInsightRuns`, `/insights/history/:id` 404.
- `createKnowledgeDigest` (direct, `apiKey: "test-key"`):
  - `relatedInsights` is empty;
  - `highlights` contains no hidden marker;
  - exactly **1** provider call occurred;
  - the provider request body contains neither the hidden marker nor the legacy
    insight id.
- `GET /api/v1/digests` persisted exactly **1** new digest run and returned no
  hidden marker or legacy id in `relatedInsights`/`highlights`/body.
- `GET /api/v1/digests/history` served the new (allowed) digest but not the
  hidden summary or legacy id.
- Live event B remains standard/processable; the new digest is eligible and
  readable. The r3 echo is closed.

The route used the configured runtime key (empty in this isolated setup), so its
provider spy count was 0; the direct synthesis call with a test key exercises the
same `loadDigestData`/prompt path and proves the payload is clean.

## Commands and exact exits (r4)

| # | Command | Exit | Observed |
|---:|---|---:|---|
| 1 | `npm run lint` | 0 | no diagnostics |
| 2 | `npm run build` | 0 | no diagnostics |
| 3 | `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-deletion.test.ts` | 0 | 15/15 pass |
| 4 | `npm run test:isolated` | 0 | 174/174 on the first clean run; no B07 flake observed |
| 5 | `$env:NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'; npm run schema:verify -- --read-only` | 0 | `{"ok":true,"readOnly":true,"problems":[]}` |
| 6 | `node --import tsx contracts/schema/verify.test.mjs` | 0 | 52 migrations / 1 906 objects; real PG + pg_dump BLOCKED |
| 7 | `npm run contracts:verify` | 0 | 382 checks / 58 fixtures; 30 open G1 decisions |
| 8 | `npm run test:v2 -- --suite E06,E11,E12` | **2** | E06/E11/E12 all BLOCKED |

## Regression after the r4 predicate change

- Prior D1–D7 probe: **31/31 PASS**.
- R1/R2/R3 targeted probe: **10/10 PASS** (legacy read eligibility, strictly
  later revalidation, unlinked replay rejection + live-lineage control, and
  relatedInsights clean).
- Separate-restored-copy gate: **3/3 PASS** (unverified/expired/empty-ledger fail
  closed; verified apply).
- No regression found in search/entities/relations/graph/export/insights/digests,
  replay guards, finance preservation or owner isolation.

## Scope

r4 changes are only `src/storage/digests.ts`, `tests/v2-deletion.test.ts` and
`docs/reports/v2/B11-r4.md` (plus the generated harness artifact). No migration,
manifest, route, server, auth, mobile or B08 source change. No out-of-bound r4
write found.

## Conditions / unverified

- Real PostgreSQL RLS/multi-connection and `pg_dump` restore remain BLOCKED;
  E06/E11/E12 remain BLOCKED with no adapter credit.
- `revalidated_at` has no operator/UI workflow.
- Over-invalidation is intentional: all pre-tombstone runs for an owner are
  hidden after any tombstone; related insights inherit it.
- Text/prose copied from deleted content into a new live-lineage run remains
  undetectable by id.
- Cross-instance graph cache TTL remains 30 s.

## New defects

None found in the r4 echo path or the re-run regressions.

---

# B11 r3 re-verification (historical)

Status: **REJECTED** against the current source and `docs/reports/v2/B11-r3.md`.

R1 and R2 are fixed: legacy r1 window/entity runs are hidden from every probed
read path, unlinked summary replay is rejected by both repository and direct SQL,
and the live-lineage control still inserts. A separate-restored-copy gate also
passes. The verdict is still rejected because the disclosed `digests.ts`
`relatedInsights` residual is reproducible: a legacy insight that is hidden by
the r3 predicate (404 by-id, absent from `/insights/history`) is echoed into a
new digest response and persisted in `/digests/history`.

## R1 — legacy r1 tombstone read eligibility: PASS

Setup: event A (old timestamp), window digest with no event id but a window
containing A, entity-only insight linked to A, and a live event B; all created
before a ledger-only `recordDeletionTombstone(event A)`.

| Read path | Result |
|---|---|
| `listInsightRuns` / `listDigestRuns` | both legacy runs absent |
| `loadInsightRunById` / `loadDigestRunById` | both `null` |
| `hybridRetrieve` text + vector branches (insight/digest object types) | no legacy ids |
| `GET /retrieval/hybrid` post-filter | `count:0` |
| `GET /insights/history`, `/digests/history` | 200, no marker |
| `GET /insights/history/:id`, `/digests/history/:id` | 404 / 404 |
| `exportPersonalData` | no marker or run ids |

`revalidated_at` semantics: a live-lineage run created before the tombstone is
hidden when `revalidated_at = tombstone.created_at` (strictly-later rule), and
becomes visible in list/by-id/hybrid and `/insights/history/:id` when set to
`tombstone.created_at + 1 second`. A summary-only legacy run is **not**
re-enabled by `revalidated_at` alone because the predicate still requires live
event lineage; this matches the r3 report's conservative rule.

## R2 — unlinked summary replay: PASS

After `deletePersonalData(mode="delete_all")`:

- `insertInsightRun` summary-only (`query:null`, `evidence:[]`) returned `null`.
- `insertDigestRun` summary-only returned `null`.
- Direct SQL inserts into `insight_runs` and `digest_runs` returned 0 rows.
- `/insights/history`, `/digests/history` and `/retrieval/hybrid` showed no
  replay marker.
- Control insert with explicit live event lineage was accepted and readable; a
  control digest with live lineage and a non-overlapping window was also
  accepted.

## R3 — `relatedInsights` legacy echo: FAIL (served deleted content)

Setup: event A (2020), entity E linked to A, live event B in the current window,
and a legacy entity-only insight created before a ledger-only tombstone for A.
The legacy insight is correctly ineligible: `/insights/history/:id` returns 404
and it is absent from `/insights/history`.

However:

- `createKnowledgeDigest` returned `relatedInsights` containing the legacy
  insight summary `R3E_… legacy entity insight`.
- `GET /api/v1/digests?from=…&to=…` returned HTTP 200 with the same summary in
  `relatedInsights` and persisted a new digest run
  (`digest_87d18e9d-…`).
- `GET /api/v1/digests/history` returned the new digest with the legacy summary.
- `src/storage/digests.ts:297-317` selects `insight_runs` with only a direct
  `insight` tombstone filter; it does not apply
  `derivedRunReadEligibilitySql`. The same related summaries are also placed in
  the digest synthesis prompt, so this can echo ineligible content into a new
  derived run (and potentially external synthesis when policy allows).

This is a reproducible serving path for content that the r3 read predicate
itself marks ineligible. It is disclosed in `B11-r3.md` as outside the r3 write
boundary, but it is still a defect under the B11 “no eligible deleted derived
content” criterion. A follow-up must apply the same predicate in
`digests.ts` related-insight selection (and ideally exclude those summaries from
the synthesis prompt).

## Commands and exact exits (r3)

| # | Command | Exit | Observed |
|---:|---|---:|---|
| 1 | `npm run lint` | 0 | no diagnostics |
| 2 | `npm run build` | 0 | no diagnostics |
| 3 | `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-deletion.test.ts` | 0 | 14/14 pass |
| 4 | `npm run test:isolated` | 0 | 173/173 pass |
| 5 | `$env:NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'; npm run schema:verify -- --read-only` | 0 | `{"ok":true,"readOnly":true,"problems":[]}` |
| 6 | `node --import tsx contracts/schema/verify.test.mjs` | 0 | 52 migrations / 1 906 objects; real PG + pg_dump BLOCKED |
| 7 | `npm run contracts:verify` | 0 | 382 checks / 58 fixtures; 30 open G1 decisions |
| 8 | `npm run test:v2 -- --suite E06,E11,E12` | **2** | E06/E11/E12 all BLOCKED |

## Regression D1–D7 and A–I

The r2 probes were re-run against current source: 31/31 pass for D1–D7 fresh
flows (search/entities/relations/graph/export/insights/digests, replay guards,
preservation, owner isolation), and 3/3 pass for the separate-restored-copy
restore gate (unverified/expired/empty-ledger fail-closed, verified apply).
Focused R1/R2 probe: 9/10 pass; the only failure is the R3 residual above.
A–I findings remain as in the r2 section: fresh flows pass; R3 is the remaining
served-content defect.

## Scope

r3 time cluster (`2026-10-18T01:07–01:15Z`) contains exactly the declared files:
`src/storage/search-repository.ts`, `src/storage/insight-repository.ts`,
`src/storage/digest-repository.ts`, `src/storage/hybrid-retrieval.ts`,
`src/storage/data-controls.ts`,
`migrations/20261017190000_deletion_run_read_eligibility.sql`,
`contracts/schema/manifest.json`, `tests/v2-deletion.test.ts`,
`docs/reports/v2/B11-r3.md`. No r3-attributable route, server, mobile, auth or
B08 source write was found. `tests/v2-harness/artifacts/latest.json` was
regenerated by the mandated command.

## Remaining conditions / unverified

- Fix the `digests.ts` `relatedInsights` predicate and exclude ineligible
  summaries from the synthesis prompt.
- Real PostgreSQL RLS/multi-connection and `pg_dump` restore remain BLOCKED;
  E06/E11/E12 remain BLOCKED.
- Revalidation has no operator workflow (column only).
- Cross-instance graph cache TTL and the text/prose resurrection limitation
  remain as disclosed.

No source, test, migration, manifest, mobile or production write was made by
this verifier. Only this report was updated.

---

# B11 r2 re-verification (historical)

Status: **REJECTED** against the current source and `docs/reports/v2/B11-r2.md`.

The r2 remediation resolves D1–D7 for **fresh, evidence-linked deletions**:
31/31 independent route/storage probes and 3/3 separate-restored-copy probes
passed, including immediate tombstone quarantine, delete_all entity hiding,
window/entity-only digest and insight cleanup, guarded replay, export filtering,
and a fail-closed restore gate wired before `listen()`. The verdict is still
rejected because two reproducible serving paths remain:

1. **Unlinked derived replay after `delete_all`.** After the raw event is
   physically deleted, an owner-scoped `insight_runs` row whose only payload is a
   summary (no event/entity/relation id, no window) is accepted by the r2 guard.
   `/insights/history` returns its summary and `/retrieval/hybrid` returns it as
   an insight excerpt. Exact probe: inserted `insight_3dba2620-…` with summary
   `REPLAY_… resurrected summary`, `evidence=[]`, `query=null`, after
   `deletePersonalData(mode="delete_all")`; `history:200`, marker present;
   hybrid `count:1`, excerpt equals the marker; `raw_events` count 0. This is a
   resurrection in retrieval and contradicts D4's “nothing resurrects in
   retrieval”, even though the r2 report admits the text/ID matching limitation.
2. **Legacy r1 tombstones are not backfilled or re-evaluated at read time.** A
   tombstone + hidden event + a window digest and an entity-only insight (the
   exact rows r1's heuristic missed) still return their marker through
   `/digests/history`, `/insights/history`, `/retrieval/hybrid` and
   `/privacy/export`. Exact probe: both history endpoints 200 with marker;
   hybrid `count:2` (`insight:insight_09d4…`, `digest:digest_f744…`); export
   contains the marker; both rows still exist. The r2 read filters only reject
   runs with a direct `insight`/`digest` tombstone; they do not re-check a run's
   persisted window or entity lineage against an existing event tombstone.

These are not fresh-flow failures of D1–D7; they are the remaining upgrade and
unlinked-replay surfaces. Under the task rule (“rejection requires reproducible
served deleted content or resurrection”) they are rejection-level. The prior r1
report below is retained as history.

## Commands and exact exits (final r2)

| # | Command | Exit | Observed |
|---:|---|---:|---|
| 1 | `npm run lint` | 0 | no diagnostics |
| 2 | `npm run build` | 0 | no diagnostics |
| 3 | `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-deletion.test.ts` | 0 | 12/12 pass |
| 4 | `npm run test:isolated` | 0 | 171/171 pass |
| 5 | `$env:NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'; npm run schema:verify -- --read-only` | 0 | `{"ok":true,"readOnly":true,"problems":[]}` |
| 6 | `node --import tsx contracts/schema/verify.test.mjs` | 0 | 51 migrations / 1 904 objects; real PG + pg_dump BLOCKED |
| 7 | `npm run contracts:verify` | 0 | 382 checks / 58 fixtures; 30 open G1 decisions |
| 8 | `npm run test:v2 -- --suite E06,E11,E12` | **2** | E06 180, E11 90, E12 100 all BLOCKED |

## D1–D7 (fresh-flow result)

| Item | Result | Evidence |
|---|---|---|
| **D1** legacy/read routes after `delete_all` and tombstone-only | **PASS (fresh)** | `/search`, `/entities`, `/relations`, `/entities/:id/graph` (404), `/retrieval/hybrid` (route), `/privacy/export`, `/insights`, `/digests` returned no deleted event/entity/relation/digest/insight marker before or after cleanup. Entity-only hidden path (entity-only insight, hidden entity) also excluded. |
| **D2** hidden entities after `delete_all` | **PASS** | raw event 0, entity `visibility=hidden`, `listEntities` absent, `getEntityGraph` null, `searchKnowledge` absent. |
| **D3** window digests / entity-only insights | **PASS (fresh)** | Cleanup counts `digestRuns:2`, `insightRuns:2`; the window-only digest and entity-only insight rows were 0 after deletion. Exact event/source lineage is persisted for new digests/insights. Legacy rows are the residual in the rejection evidence above. |
| **D4** replay guards | **PASS for evidence-linked rows; FAIL for unlinked rows** | Direct inserts into `classified_events`, `event_entities`, `event_relations`, `insight_runs`, `digest_runs`, `intelligence_artifacts`, `insight_candidates` with a tombstoned event/entity/window were all rejected (0 rows). An unlinked `insight_runs` insert with only a summary was accepted and served (rejection evidence 1). |
| **D5** post-deletion generation | **PASS** | `/insights?id=<hidden>` returned `audit:null`; `/digests` returned `recentEvents:0`; no new insight run and no new event-referencing digest row. The digest insert for a window containing a retained hidden event is also blocked by the r2 trigger. |
| **D6** export | **PASS** | Export excluded event/entity/marker; `data_deletion_audit` count 2 and `deletion_tombstones` count 2 remained. |
| **D7** restore gate | **PASS** | Empty ledger: default false, `restoreVerified` only false, both flags true. Non-empty separate restored copy: unverified false (`restore_not_explicitly_verified`), verified true (`tombstones_applied`); event hidden/removed, fact removed. Expired backup false (`expired_backup_requires_review`). `src/server.ts` calls the gate before `buildApp`/`listen()` under `BRAINIA_RESTORE_MODE=true`; blocked gate throws and sets exit code 1. |

## Regression A–I

| Probe | Result |
|---|---|
| A tombstone ordering | PASS: hidden/discarded immediately; search/entities/relations/graph/hybrid/history/export excluded; dispatch `target_tombstoned`; embedding spy 0; post-deletion insight/digest created no row from hidden evidence. |
| B lineage | PASS (fresh): `classifiedEvents:1`, `insightRuns:2`, `digestRuns:2` cleaned; embeddings 5; finance 1; no fresh survivor found. |
| C resurrection | PASS for guarded tables; FAIL for unlinked insight summary (above). |
| D preservation | PASS: transaction retained, anchor moved, `evidence_count=1`, other event standard, shared entity visible. |
| E restore | PASS: separate restored copy applied; flags/expiry/empty-ledger behavior as above. |
| F owner isolation | PASS: foreign, ownerless and cross-owner deletion reject with no tombstone/mutation. |
| G retrieval leaks | PASS fresh at all probed routes; residual legacy/unlinked paths above. |
| H migration | PASS: additive 20261017180000, guards now 20 trigger rows, RLS/policies intact. |
| I scope | See below. |

## Scope / changed paths

Snapshot baseline is still `snapshot-backend.json` at `2026-10-17T18:18:16Z`; the
tree contains concurrent B05–B08 work. B11-r2 time cluster (≈00:18–00:52 on
2026-10-18) contains the declared B11 files: `src/server.ts`,
`src/storage/backup-verification.ts`, `src/storage/data-controls.ts`,
`src/storage/digests.ts`, `src/storage/insights.ts`,
`src/storage/search-repository.ts`, `src/storage/entity-repository.ts`,
`src/storage/relation-repository.ts`, `src/storage/graph-repository.ts`,
`src/routes/search.ts`, `src/routes/digests.ts`, `src/routes/insights.ts`,
`migrations/20261017180000_deletion_replay_guards.sql`,
`contracts/schema/manifest.json`, `tests/v2-deletion.test.ts`,
`docs/reports/v2/B11-r2.md`.

Also changed in the same r2 time window but **not declared** in the B11-r2
“What changed” table or the amended boundary list:
`src/storage/hybrid-retrieval.ts`, `src/storage/digest-repository.ts`,
`src/storage/insight-repository.ts`. Their visible diffs are owner/policy
changes (B07-era), with no tombstone logic in hybrid-retrieval; hash comparison
alone cannot attribute them to B11. Flagged for Supervisor scope confirmation.

No B11-attributable mobile, auth/app or B08 job source change was found.
`tests/v2-harness/artifacts/latest.json` was regenerated by the mandated
`test:v2` command; it is an untracked generated artifact.

## Remaining conditions

- Add a lineage requirement or read-time eligibility check for
  `insight_runs`/`digest_runs`/`intelligence_artifacts` so an unlinked summary
  cannot be served after a tombstone; or explicitly narrow D4/acceptance to
  evidence-linked replays and record that decision.
- Backfill/re-evaluate rows from r1 tombstones (window/entity lineage) or add a
  startup/reconciliation pass; the current read filters do not do this.
- Real PostgreSQL RLS/multi-connection and `pg_dump` restore remain BLOCKED;
  E06/E11/E12 remain BLOCKED with no adapter credit.
- Cross-instance graph cache TTL and the in-process invalidation limitation
  remain.

No source, test, migration, manifest, mobile or production write was made by
this verifier. Only this report was updated.

---

# B11 verification (r1, historical, superseded)

Independent verification of `docs/BRAIN_AI_V2_TASK_SPECIFICATIONS.md` B11.
Verifier is distinct from the implementer (`B11-r1.md`).

- Repository: `D:/Coding/BrainIA/BrainIA-Backend`
- Branch/HEAD: `main` / `b71c4cc82ca0faa636db656c729e79cb906a9114`
- Working tree: dirty (pre-existing B04–B08 work preserved); B11 does not commit.
- Environment: isolated PGlite 0.5.8, in-memory per process, no TCP, no production DB,
  no external provider/network, no mobile change.
- B11 inputs reviewed: task spec lines 445–475, `BRAIN_AI_V2_PRD.md` (retention/user
  control), `BRAIN_AI_V2_EVALUATION.md` E06/E11/E12 and Q2/Q9, `B11-r1.md`,
  `migrations/20261017170000_deletion_tombstones.sql`, `data-controls.ts`,
  `privacy.ts`, `embeddings.ts`, `intelligence.ts`, `graph-cache.ts`,
  `backup-verification.ts`, `tests/v2-deletion.test.ts`, `snapshot-backend.json`,
  B06/B07/B08 reports, and the read/publication paths under `src/routes` and
  `src/storage` that can expose deleted evidence.
- Read-only rule: no source, test, migration, manifest, contract, mobile or
  production change was made by this verifier. The only repository file written is
  this report. Probe scripts were kept in
  `C:/Users/germa/AppData/Local/Temp/opencode/` outside the repository.
- Side effect to disclose: the mandated `npm run test:v2 -- --suite E06,E11,E12`
  rewrote the generated artifact `tests/v2-harness/artifacts/latest.json` (its E11
  result was already BLOCKED before this run). No source file changed.

## VERDICT: REJECTED

Rejection is based on reproducible **served deleted content** and a reproducible
**resurrection**, not on missing future evidence alone:

1. **Immediate ineligibility is not enforced by all read paths.** After a tombstone
   commits and before cleanup, `GET /api/v1/search?q=<marker>` still returns the
   deleted event (title/body), its entities and its relation; `GET /api/v1/entities`
   and `/api/v1/relations` still return them; `GET /api/v1/entities/:id/graph`
   returns 200 with the deleted entity's graph. After cleanup in `delete_knowledge`
   mode the same routes still serve the retained hidden event and hidden entities.
2. **`delete_all` still leaves hidden derived entities served.** With the raw event
   physically deleted, a now-hidden entity (solely derived from the deleted event)
   is still returned by `listEntities`, by `getEntityGraph`, and by legacy
   `searchKnowledge`.
3. **Derived lineage is incomplete, and an unlinked digest survives and is served.**
   `eventDigestIds` only finds digests whose request/response/summary text contains
   the event id. A window digest with no persisted event id survives cleanup and is
   returned by `/api/v1/digests/history` and by `/retrieval/hybrid`.
4. **Replay resurrection is possible.** The tombstone trigger set does not cover
   `classified_events`, `event_entities` or `event_relations`. A replayed insight
   run inserted after deletion (the shape written by `insertInsightRun`, including
   the `/insights` route) is not blocked and is returned by `hybridRetrieve`.
   `/insights?id=<hidden entity>` and `/digests` themselves create new derived rows
   containing hidden entity/event content after the tombstone.
5. `/api/v1/privacy/export` returns the retained hidden raw event after
   `delete_knowledge`, and `exportPersonalData` has no hidden/tombstone filter.

These are acceptance failures for “Immediate ineligibility and no replay
resurrection” and “No eligible deleted derived content”. They are not cosmetic:
they expose the deleted event body, entity descriptions and relation text through
authenticated owner routes.

## Required commands and exact exits

Run from `D:/Coding/BrainIA/BrainIA-Backend`.

| # | Command (exact) | Exit | Observed |
|---:|---|---:|---|
| 1 | `npm run lint` | 0 | `tsc -p tsconfig.json --noEmit`; no diagnostics. |
| 2 | `npm run build` | 0 | `tsc -p tsconfig.json`; no diagnostics. |
| 3 | `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-deletion.test.ts` | 0 | 5 tests / 5 pass / 0 fail. |
| 4 | `npm run test:isolated` | 0 | 164 tests / 164 pass / 0 fail. |
| 5 | `$env:NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'; npm run schema:verify -- --read-only` | 0 | `{"ok":true,"readOnly":true,"problems":[]}`. |
| 6 | `node --import tsx contracts/schema/verify.test.mjs` | 0 | Fresh migration/reconciliation PASS, 50 checksummed migrations, 1 895 catalog objects; real PostgreSQL and pg_dump restore print BLOCKED. |
| 7 | `npm run contracts:verify` | 0 | 382 checks / 58 fixtures / 7 identity sequences; bundle SHA `312c92f8…abad6`; 30 open G1 decisions; not resealed. |
| 8 | `npm run test:v2 -- --suite E06,E11,E12` | **2** | `E06: BLOCKED 0/180`, `E11: BLOCKED 0/90`, `E12: BLOCKED 0/100`. No adapter credit. |

`B11-r1.md` records exit `1` for command 8; the observed exit is **2**. All other
reported exits match. The green focused suite is consistent with the
implementation but does not exercise the legacy routes or the unlinked-digest
case; it cannot establish the acceptance criteria.

## Independent probes

All probes used the repository’s isolated PGlite harness
(`tests/pglite-setup.mjs`) with fresh in-memory databases and the real Fastify
app (`buildApp`) with owner-bound client credentials. No probe used the
implementation tests as its oracle.

### A. Tombstone ordering / immediate ineligibility — FAIL

Setup: event, merchant entity, a second entity and relation, fact, correction,
decision, classified row, semantic rows, insight run, linked digest, window digest
(no event id in request/response), artifact + dependency + revision, finance
transaction + evidence link, diagnostic, feedback, and event/fact/entity/insight/
digest embeddings. `tombstoneDeletion({mode:"delete_knowledge"})` only (no cleanup),
then routes were called.

| Check | Result |
|---|---|
| Raw event forced `privacy_status=hidden`, `processing_allowed=false`, `processing_status=discarded` | PASS |
| Fact visibility hidden, insight/artifact summaries redacted | PASS |
| `authorizeModelDispatch` for the event | PASS: denied `target_tombstoned` |
| Embedding dispatch spy | PASS: 0 provider calls |
| `GET /api/v1/search?q=<marker>` | **FAIL: event id, both entity ids and relation id returned** |
| `GET /api/v1/entities` | **FAIL: hidden entity returned** |
| `GET /api/v1/relations` | **FAIL: relation for deleted event returned** |
| `GET /api/v1/entities/<hidden>/graph?depth=1` | **FAIL: HTTP 200, root + neighbour graph served** |
| `GET /api/v1/retrieval/hybrid?q=<marker>` | **FAIL: relation candidate carries the deleted event id; unlinked window digest returned** |
| `GET /api/v1/digests/history` | linked digest redacted (PASS); **unlinked window digest summary survives (FAIL)** |
| `GET /api/v1/insights/history` | linked insight redacted at this point (PASS) |
| `GET /api/v1/insights?id=<hidden entity>` | **FAIL: 200 with hidden entity marker in response; new run created** |
| `GET /api/v1/digests?from=…&to=…` | **FAIL: `recentEvents` contains the tombstoned event id and body; `summaryAvailable=true`** |
| `GET /api/v1/privacy/export` | **FAIL: hidden deleted event id present in export** |

Exact legacy-search result after the tombstone (owner scope, marker query):
`events:[<deleted event id>]`, `entities:[<hidden entity id>, <target entity id>]`,
`relations:[<relation id>]`. This is direct proof that the tombstone/quarantine
flags are not an egress barrier for the legacy read surface.

### B. Lineage completeness — FAIL

After `deletePersonalData({mode:"delete_knowledge"})` (raw event intentionally
retained hidden) the cleanup counts were:

`facts:1, classificationCorrections:1, classificationDecisions:1,
semanticCandidates:1, semanticObservations:1, semanticDecisions:1,
semanticAnchors:1, intelligenceArtifacts:1, insightCandidates:1, insightRuns:1,
digestRuns:2, clientDiagnostics:1, financialTransactions:1, embeddings:6,
evidenceRetainedHidden:1`.

Remaining rows tied to the deleted event:

| Class | Remaining | Why |
|---|---:|---|
| `classified_events` | 1 | Cleanup has no delete/redact for classification output; it survives whenever the raw row is retained, and the read path serves its `inferredKind`. |
| `digest_runs` | 1 | Window digest is only discovered by text containment; a digest with no event id in request/response/summary is missed. Its summary contains the event marker and is returned by `/digests/history` and `/retrieval/hybrid`. |
| hidden `entities` / relations | entity rows remain (hidden) | Intended “hide rather than delete”, but every read path listed in A/G ignores `visibility`, so hiding is ineffective. |

All fact/correction/decision/semantic/embedding/artifact/insight/diagnostic/finance
rows that the traversal did discover were removed in this mode. Lineage is
therefore **partially complete**, not complete as claimed.

For `delete_all`, the raw row and its cascades are removed, but the hidden entity
still survives: a focused probe returned `rawCount=0`, `visibility=hidden`,
`listEntities` count `1`, `getEntityGraph` served (1 node) and
`searchKnowledge` returned the entity id.

### C. Replay / resurrection — FAIL (trigger guards partial; application replay succeeds)

Guarded direct inserts after `delete_all` were correctly rejected:

| Replay | Result |
|---|---|
| `raw_events` insert | blocked (`RETURNING` 0 rows) |
| `knowledge_facts` insert | blocked |
| `classification_corrections` insert | blocked |
| `semantic_candidates` insert | blocked |
| `financial_transactions` insert (anchored to tombstoned event) | blocked |
| `upsertEmbedding(event)` | returns `null` |
| `refreshEventEmbeddings(event)` | `[]` |
| `UPDATE raw_events SET privacy_status='standard', processing_allowed=true` | forced back to hidden/discarded by the update trigger |
| `authorizeModelDispatch(eventIds)` | denied `target_tombstoned` |

But the barrier is not complete:

- `insertInsightRun(... evidence:[{eventIds:[deleted]}])` is accepted after the
  tombstone and its summary is returned by `hybridRetrieve` (probe
  `C.replay.insight.excluded` FAIL). Insight runs have no event column and no
  trigger; the text branch only checks policy version.
- `classified_events`, `event_entities` and `event_relations` are not in the
  trigger array (`migrations/20261017170000_deletion_tombstones.sql:175-181`).
  After a tombstone, direct inserts for all three were accepted (`1` row each).
  For `delete_knowledge` this re-creates associations for a retained hidden event;
  for `delete_all` the raw FK blocks them, but `classified_events`/`event_entities`
  remain guardable only by the raw cascade.
- The `/insights` route creates a new insight run after deletion from a hidden
  entity (A), and `/digests` creates a new digest run whose response contains the
  tombstoned event (A). Neither is blocked by the trigger or the repository.

### D. Preservation of other supporting observations — PASS

Two events supported one canonical transaction. Deleting event A:

- transaction retained, `anchor_event_id` moved to event B, `evidence_count=1`;
- the event-B `financial_transaction_events` row remains, the event-A link is gone;
- event B remains `standard`/processable and searchable/retrievable;
- a shared entity remains `visible` because event B is still eligible;
- an unrelated event remains searchable and hybrid-retrievable.

This matches the acceptance criterion and the reported finance semantics.

### E. Restore — PARTIAL

A separate second PGlite database was migrated to the same schema and treated as
the “restored copy”, with the live database as ledger. The restored copy had a
standard event, fact, dependency and entity graph. `applyDeletionTombstonesAfterRestore({target, ledger})`:

- replayed the ledger into the restored copy inside one transaction;
- made the event hidden and unprocessable, removed the fact, set the target
  tombstone to `restore_applied`;
- returned `trafficBlocked=true` and `applied=1`;
- an expired-backup tombstone was reported in `expiredBackups` and was still
  applied; `trafficBlocked=true`.
- The function **is not wired into server startup**: the only call sites are the
  storage unit test and `backup-verification.ts` itself. `src/app.ts` and server
  startup never call it, so the control is not operational in deployment.

New condition: **empty ledger is treated as traffic-safe.** With an empty ledger
and a restored copy containing a still-standard deleted event, the gate returns
`trafficBlocked=true` (`backup-verification.ts:59-65`) and does not inspect the
restored row. A pre-deletion/absent ledger backup therefore silently passes. The
default arguments use the same pool for target and ledger, so an operator who
calls the function against a restored database alone also gets the vacuous pass.
This is fail-open unless deployment enforces a complete live ledger and treats
`expiredBackups` as a hard block.

### F. Owner isolation — PASS

- Owner A deletion of an owner-B event: `null`, no tombstone, no mutation.
- Ownerless deletion of an owned event: `null`, no mutation.
- Cross-owner (`ownerId=A`, `clientId=B`) deletion: `null`, no mutation.
- Event stays standard/processable; owner-B fact stays visible; tombstone count 0.

The owner-scoped `FOR UPDATE` lookup and the “anonymous only” legacy branch work
as reported.

### G. Retrieval leak check — FAIL

After `delete_all` (raw event physically gone) and after `delete_knowledge`
(raw retained hidden):

| Path | Result |
|---|---|
| `GET /api/v1/search` | **LEAK**: hidden event, hidden entity, relation (delete_knowledge); hidden entity (delete_all) |
| `GET /api/v1/retrieval/hybrid` | Text branch excludes event/entity/fact, but **returns the unlinked window digest**; relation candidate carries the deleted event id |
| `GET /api/v1/entities` | **LEAK**: hidden entities |
| `GET /api/v1/relations` | **LEAK** before cleanup: relation linked only to the deleted event is still returned. Cleanup later deletes a sole-evidence relation; a relation shared with another event is legitimately retained. |
| `GET /api/v1/entities/:id/graph` | **LEAK**: 200 for a hidden root entity, including node/relation text |
| `GET /api/v1/insights/history` | **LEAK** after `/insights` creates a post-deletion run from a hidden entity (marker present) |
| `GET /api/v1/digests/history` | **LEAK**: unlinked window digest summary survives; `/digests` also returns hidden event `recentEvents` |
| `GET /api/v1/privacy/export` | **LEAK**: hidden deleted raw event (delete_knowledge) |
| Admin `/graph` explore/taxonomy | Explore has no visibility filter (and is admin-only); taxonomy is global. Not used as the primary rejection evidence. |

The primary hybrid vector/text filters (`hybrid-retrieval.ts:91,110,131,181-226`)
are a real mitigating control for event/entity/fact/insight/digest embeddings, but
they are bypassed by the legacy SQL routes and by digest runs that never got an
event link.

### H. Migration — PASS with a coverage gap

- Additive only: no `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM`,
  `ALTER COLUMN` or schema drop in the new migration; only new tables/indexes,
  RLS/policies, revokes and `DROP POLICY/TRIGGER IF EXISTS` before recreate.
- Schema verify and 50-migration verification are clean (commands 5–6).
- Both new tables have RLS enabled (`relrowsecurity=true`) and `anon`/
  `authenticated` have no SELECT on either table
  (`has_table_privilege=false` for both roles and both tables).
- `FORCE ROW LEVEL SECURITY` is false; the table owner bypasses RLS. That is
  acceptable only if every runtime writer uses the owner role deliberately.
- Trigger count is 13 (two raw-event guards, ten event-derived insert guards, one
  embedding guard). The event-derived guard list omits `classified_events`,
  `event_entities` and `event_relations`, which is the coverage gap demonstrated
  in C.

### I. Scope — PASS for B11-attributable paths, with process conditions

Snapshot `snapshot-backend.json` was captured at `2026-10-17T18:18:16Z`; B11-r1
was written at ~23:57 local. Hash comparison shows many concurrent B05–B08 files
changed after the snapshot, so hash diff alone cannot attribute them to B11.
Files in the B11 time cluster (≈23:42–23:57) are exactly:

`src/storage/data-controls.ts`, `src/storage/privacy.ts`,
`src/storage/embeddings.ts`, `src/storage/intelligence.ts`,
`src/storage/graph-cache.ts`, `src/storage/backup-verification.ts`,
`migrations/20261017170000_deletion_tombstones.sql`, `contracts/schema/manifest.json`,
`tests/v2-deletion.test.ts`, `docs/reports/v2/B11-r1.md`.

No B11-attributable route, job, event-store, mobile or production change was found.
Process conditions:

- `contracts/schema/manifest.json` and `tests/v2-deletion.test.ts` are shared
  files outside the six-file write reservation; `B11-r1.md` does not record a
  Supervisor reservation/approval hash for them.
- `B11-r1.md` claims “per-entity traversal-cache invalidation”, but
  `quarantineDeletedTarget` calls `invalidateGraphTraversalCache()` (clear all);
  the per-entity helper `invalidateGraphTraversalCacheForEntities` is unused.
- The report’s `test:v2` exit is wrong (1 vs observed 2).

## Acceptance criteria assessment

| Criterion | Result | Evidence |
|---|---|---|
| Immediate ineligibility | **FAIL** | A/G: hidden event/entities/relations served by `/search`, `/entities`, `/relations`, graph; `/digests` and `/insights` create or serve content after the tombstone. |
| No replay resurrection | **FAIL** | C: insight replay accepted and returned by hybrid; classified/event-entity/event-relation guards missing. Direct guarded tables pass. |
| No eligible deleted derived content | **FAIL** | B/G: unlinked digest survives; `classified_events` survives in retained mode; hidden entities served under all modes. |
| Other supporting observations preserved | **PASS** | D. |
| Backup expiry documented | **PASS** | 30-day constant, column default, restore result, expired list; empty-ledger fail-open condition remains. |
| Restore tombstones applied before traffic | **PARTIAL** | E: function works on a separate restored copy; not wired into startup; empty ledger vacuously unblocks. |
| Real PostgreSQL/RLS/restore evidence | **BLOCKED** | PGlite only; real server and pg_dump restore unavailable. |
| E06/E11/E12 harness | **BLOCKED** | Exit 2; all cases BLOCKED, no adapter credit. |

## Classified findings

### Confirmed defects (acceptance-failing)

1. **D1 — Legacy read routes ignore hidden/tombstone state.**
   `searchKnowledge` (`src/storage/search-repository.ts:104-218`) queries
   `raw_events`, `entities` and `relations` with owner filters but no
   `privacy_status`/`visibility` filter; `listEntities`
   (`src/storage/entity-repository.ts:288-299`) and `listRelations`
   (`src/storage/relation-repository.ts:93-118`) filter only owner;
   `getEntityGraph` (`src/storage/graph-repository.ts:417+`) has no visibility or
   tombstone check. `/search` is registered at `src/routes/search.ts:36`;
   `/entities`/`/relations` at `src/routes/knowledge.ts:7-8`.
2. **D2 — Hidden entities remain served after `delete_all`.**
   Cleanup hides entities instead of deleting them and never checks their
   remaining eligibility before the read path returns them. Reproduced with
   `rawCount=0`, `visibility=hidden`, `listEntities` 1, `getEntityGraph` 200,
   `searchKnowledge` entity returned.
3. **D3 — Digest lineage is heuristic and under-deletes.**
   `eventDigestIds` (`src/storage/data-controls.ts:133-142`) only matches text
   containment. The real `/digests` response persists only the newest ten
   `recentEvents` and its request carries a window, not event ids
   (`src/storage/digests.ts:177,384`), so an event outside that set (or content
   named only in the model summary) has no persisted id to find. Such a digest
   survives cleanup and is returned by `/digests/history` and hybrid retrieval.
   The probe reproduced exactly this shape: a window digest with no event id in
   request/response/summary survived and served the marker while the linked
   digest was deleted.
4. **D4 — Replay barrier misses insight/digest runs and three event-derived
   tables.** `insertInsightRun` (`src/storage/insight-repository.ts:58`) and
   `insertDigestRun` have no tombstone check; the migration guard array
   (`migrations/20261017170000_deletion_tombstones.sql:175-181`) omits
   `classified_events`, `event_entities` and `event_relations`. Replayed insight
   is returned by `hybridRetrieve`; direct inserts for the three tables succeed.
5. **D5 — Post-deletion derived creation from hidden entities/events.**
   `/insights?id=<hidden entity>` (`src/routes/insights.ts` → `agent-inspect.ts:156-169`
   → `listEntities`/`getEntityGraph`) returns hidden entity content and stores a
   new run; `/digests` returns tombstoned `recentEvents` and stores a new run.
   `insertInsightRun`/`insertDigestRun` do not consult the tombstone.
6. **D6 — Export ignores deletion state.**
   `exportPersonalData` (`src/storage/data-controls.ts:497-518`) selects all
   `raw_events` by client id; a retained hidden deleted event is exported. The
   legacy export has no hidden/private/tombstone filter.
7. **D7 — `classified_events` is never cleaned.**
   `applyDeletionTombstoneCleanup` (`data-controls.ts:319-476`) deletes facts,
   corrections, decisions, semantic rows, artifacts, insights, digests, links and
   diagnostics but not `classified_events`; in `delete_knowledge` the row survives
   with the retained hidden event and is exposed by `/search`.

### Conditional vulnerabilities

1. **Restore wiring absent.** `applyDeletionTombstonesAfterRestore` is never
   called by `src/app.ts`/server startup. Deployment must add a pre-traffic gate;
   otherwise the restore control is documentation only.
2. **Empty/absent ledger is fail-open.** It returns `trafficBlocked=true` with zero
   tombstones and does not verify that the restored copy has a complete ledger.
3. **Real PostgreSQL not tested.** RLS, `SECURITY DEFINER` trigger behavior,
   pooled role/session state, deadlocks and `pg_dump` restore remain unverified.
   `FORCE RLS` is off; owner-role bypass is assumed.
4. **Cross-instance graph cache.** Invalidation clears only the deleting process;
   other instances can serve a pre-deletion graph for up to the 30 s TTL. The
   admitted condition is real, though the read routes already serve hidden
   entities without the cache.
5. **Finance sole-evidence deletion.** Transactions whose evidence was never
   linked are treated as sole-evidence and deleted with the anchor; the documented
   preservation rule only protects rows with another `financial_transaction_events`
   link.
6. **Legacy local mode.** Only fully anonymous rows are reachable without a
   principal; this is not an authenticated owner path and did not fail the probe.

### Mitigating controls observed

- The tombstone and quarantine flags commit before cleanup; direct facts,
  corrections, semantic rows, insights, artifacts, finance links, diagnostics and
  embeddings are removed/redacted for discovered lineage.
- `authorizeModelDispatch` denies a tombstoned event with `target_tombstoned`
  before source-policy evaluation; the embedding spy observed zero calls.
- Hybrid retrieval filters hidden events/entities/facts and policy-stale vectors;
  its event text branch and vector branch did not return the deleted event.
- Shared finance evidence is preserved and `evidence_count`/anchor recomputed.
- Owner-scoped deletion rejects foreign and ownerless targets without writes.
- Migration is additive, RLS is enabled and anon/authenticated privileges are
  revoked; the 30-day expiry is consistent across constant, column default and
  restore result.
- `intelligence.ts` marks artifacts stale/null on tombstoned artifact or dependency
  event, and the revisions route exposes metadata only.

### Unverified assumptions

- Real PostgreSQL concurrency, RLS with non-owner roles and a real pg_dump restore.
- E06/E11/E12 adapter evidence and gate instrumentation (BLOCKED).
- Operations will call the restore gate before traffic and will treat
  `expiredBackups` as a hard stop.
- All external writers go through the guarded tables; a writer that inserts an
  unguarded insight/digest run can resurrect content.
- Mobile clients do not call the legacy `/search`, `/entities` or `/relations`
  routes. This is not sufficient for E06: the routes are registered and reachable
  by authenticated owners, and the task’s endpoint matrix includes them.

## What would change the verdict

A re-verification can move to `accepted-with-conditions` only when:

1. every read/publication path that can return event/entity/relation/fact/
   insight/digest content applies the same eligibility rule (hidden/tombstoned),
   including `/search`, `/entities`, `/relations`, `/entities/:id/graph`,
   `/insights`, `/digests` and export;
2. digest/insight lineage is canonical or the post-deletion creation paths are
   blocked; window digests and new runs cannot be served for a tombstoned event;
3. the guard set and repository writes cover `insight_runs`, `digest_runs`,
   `classified_events`, `event_entities` and `event_relations`, or those tables
   gain a canonical deletion link;
4. restore startup wiring and an empty/expired-ledger hard block are in place;
5. real PostgreSQL and the E06/E11/E12 adapter evidence are available.

No commit, dependency install or production database was used.
