# B05 — Independent verification (owner schema and legacy identity quarantine)

Verifier: independent subagent (not the implementer).
Repository: `D:/Coding/BrainIA/BrainIA-Backend`; branch `main`; HEAD `b71c4cc82ca0faa636db656c729e79cb906a9114`; dirty tree.
Mode: read-only. No source, test, migration, manifest or mobile edits. Only this report was created.
Baseline compared against: `docs/reports/v2/snapshot-backend.json` (`ea41cb12…cb444`).
Runtime: Windows, Node 22.23.3, in-memory PGlite 0.5.8 through the repository's isolated harness. No production DB, no TCP Postgres, no mobile access.

## Final verdict (r3 delta) — ACCEPTED

The r3 delta closes the last r2 condition. `knowledge_embeddings` and `knowledge_feedback` now have `owner_id` plus owner indexes in the B05 migration, appear in both `PERSONAL_TABLES` and `CLIENT_ID_TABLES`, are covered by backfill/quarantine, and every table with `client_id` or `client_scope` now has `owner_id` (26/26, zero missing). The inventory test reports zero personal tables without an owner key (38 personal tables). Durable release also now holds for an ownerless `knowledge_embeddings` row: after release and a subsequent `backfillOwnership`, the row stays `released` and visible, and `result.quarantined` no longer counts it.

No new blocking defect was found. One minor test-quality note remains: the inventory test proves completeness only over the hardcoded `PERSONAL_TABLES` list, so a future table omitted from both lists would not be caught by the test alone; the independent runtime probe in this report checks all client-key tables directly.

The r2 evidence is in the **Remediation addendum (r2)** below; it is retained for history and is superseded by the **r3 final delta** section at the end. The original r1 verdict is also retained and superseded.

## Verdict (r1, superseded)

> This is the original r1 verdict, retained for history. The current r2 remediation verdict is **ACCEPTED WITH CONDITIONS** in the section above.

**REJECTED.**

The additive schema, quarantine ledger, taxonomy guard and idempotent backfill are largely sound, and all eight required commands pass (E06/E11 honestly BLOCKED). However, one explicit B05 acceptance criterion fails with a reproducible defect: **a personal event can be linked to an entity owned by another owner**, and a **relation can connect two different owners' entities without rejection or quarantine**. The migration comment claims cross-owner event links are impossible (`migrations/20261017100000_owner_identity.sql:115-133`), but the guard only compares `event_entities.owner_id` with `raw_events.owner_id`; it never reads `entities.owner_id`, and no composite FK from `event_entities(entity_id, owner_id)` to `entities(id, owner_id)` exists. Secondary defects: unresolved ownerless events/facts/entities are never quarantined and remain visible, and the "inventory every object" requirement covers only 14 hardcoded tables while 21 tables still carry `client_id` without `owner_id`.

## Acceptance table

| B05 acceptance criterion | Assessment | Evidence |
|---|---|---|
| Ordinary APIs cannot see quarantined rows | **NOT MET — foundation only** (route wiring deferred to B06) | `ownerVisiblePredicate`/`owner_row_visible` hide a quarantined account in isolated SQL (Probe C), but neither is imported by any route/repository (`src/` grep: only `src/scripts/backfill-ownership.ts` imports `ownership.js`; zero route references). The three new ledger tables also have `relrowsecurity=false` (Probe G), unlike pre-B05 tables covered by `0037`'s one-time loop. |
| Personal entities/edges belong to one owner | **NOT MET — reproducible cross-owner write** | Probe E: `event_entities` insert with the event's own owner and a foreign-owned entity succeeds; Probe E2: explicit owner also succeeds; cross-owner `relations` insert succeeds, stays `owner_id=null`, is not quarantined. Probe H: ownerless personal entity/event/fact remain unowned and visible. |
| Public taxonomy has no personal content | **PARTIALLY PROVEN** (ownership marker only) | Probe D: owned `domain`/`concept` insert and update raise `public_taxonomy_cannot_be_owned`; backfill clears a simulated leaked owner and writes a `remediated` audit row. Content purity is not enforced: a `domain`/`concept` with personal text and `owner_id null` is accepted, so "no personal content" is not provable from this schema alone. |
| Idempotent backfill preserves evidence and transaction IDs | **PASS in isolated PGlite** | Probe B: two owners, shared entity, two transactions with evidence links, two classification facts; two runs; exactly one `entity_owner_splits` row for the one extra owner; second run `splitEntities=0`, `quarantined=0`, no new mappings/splits; transaction/evidence/fact/event snapshots byte-identical across runs. |

## Required command results

| # | Command | Exit | Actual output |
|---|---|---:|---|
| 1 | `npm run lint` | 0 | `tsc -p tsconfig.json --noEmit`; no diagnostics. |
| 2 | `npm run build` | 0 | `tsc -p tsconfig.json`; no diagnostics. |
| 3 | `npm run test:isolated` | 0 | `# tests 123`, `# pass 123`, `# fail 0`, `# skipped 0`, duration 204664.4211 ms. |
| 4 | `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-ownership.test.ts` | 0 | `# tests 5`, `# pass 5`, `# fail 0`, duration 12393.6928 ms. |
| 5 | `npm run test:v2 -- --suite E06,E11` | 2 | `E06: BLOCKED; 0 pass / 0 fail / 180 blocked of 180`; `E11: BLOCKED; 0 pass / 0 fail / 90 blocked of 90`; `Evidence: tests\v2-harness\artifacts\latest.json; BLOCKED`. Honest BLOCKED, not pass. |
| 6 | `$env:NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'; npm run schema:verify -- --read-only` | 0 | `{ "ok": true, "readOnly": true, "problems": [] }` |
| 7 | `node --import tsx contracts/schema/verify.test.mjs` | 0 | `PASS baseline 44 applied checksummed migrations / 1409 catalog objects`; exhaustive reconciliation 1409 identities; `PASS fresh migration and read-only reconciliation`; index control-flow scenarios all PASS. |
| 8 | `npm run contracts:verify` | 0 | `PASS 382 contract checks; 58 positive/negative schema+semantic fixtures; 7 identity sequences.` Bundle SHA-256 `312c92f8…abad6`. |

## Probe A — migration safety

Command: case-insensitive search of `migrations/20261017100000_owner_identity.sql` for `drop table|delete from|truncate|drop column|alter column|drop constraint|rename`.

Actual output: **no matches**.

Findings:
- The migration is additive: `create table if not exists`, `alter table … add column if not exists`, `create index if not exists`, `create or replace function`, `drop trigger if exists` followed by `create trigger`.
- Intentional non-destructive schema change: four composite FKs declared `NOT VALID` (`migrations/20261017100000_owner_identity.sql:80-98`). This is additive and documented as a later validation step; it is not destructive but it also means legacy rows are not yet validated.
- Intentional intentional-data change is in the backfill, not the migration: step 9 clears `entities.owner_id` for `domain`/`concept` and writes a `remediated` quarantine/audit row (`src/storage/ownership.ts:330-343`). This is a justified correction of leaked personal ownership and preserves entity content/IDs. Step 5 also re-points `event_entities.entity_id` to split copies and rewrites the copy's `normalized_value` (`src/storage/ownership.ts:260-271`); original entities and all evidence/transaction IDs are preserved.
- No `DROP TABLE`, `DELETE FROM`, `TRUNCATE`, or column removal exists in the migration.

## Probe B — idempotency and evidence preservation

Independent stdin script (not the implementer's test) created:
- two legacy client ids `legacyA`, `legacyB`, mapping only `legacyA -> ownerA`;
- one event per client, one shared `merchant` entity linked to both events;
- one transaction per event with a `financial_transaction_events` evidence row (`amount=12.34`, `evidence_count=3`);
- one `event_classification` knowledge fact per event.

Actual first-run output:

```
PROBE_B first_result: {"dryRun":false,"mappings":2,"ownersAssigned":{"raw_events":2,"event_entities":2,"event_relations":0,"event_semantic_anchors":0,"financial_transaction_events":2,"knowledge_facts":2,"entities":1,"relations":0,"financial_transactions":2},"splitEntities":1,"quarantined":0,"publicTaxonomyCleared":0,"unresolved":{"financial_transactions":0,"financial_accounts":0,"pending_financial_transactions":0,"entities":0}}
PROBE_B mappings: [{"legacy_client_id":"legacyA-…","owner_id":"ownerA-…","status":"approved"},{"legacy_client_id":"legacyB-…","owner_id":"legacyB-…","status":"approved"}]
PROBE_B splits: [{"original_entity_id":"29aa442f-…","owner_id":"ownerA-…","new_entity_id":"d54f7d64-…"}]
PROBE_B second_result: {"dryRun":false,"mappings":2,…,"splitEntities":0,"quarantined":0,…}
PROBE_B preserved_snapshots: {"txns":2,"fte":2,"facts":2,"events":2,"entityCount":2}
PROBE_B RESULT: PASS
```

Verified:
- Mapping is correct; unmapped `legacyB` is recorded as its own provisional owner with `requires_owner_confirmation=true` evidence.
- Shared entity split: exactly **one** `entity_owner_splits` row for the one extra owner; each event now points to a distinct entity; each entity's event links carry exactly one owner.
- Second run performs no new split, no new mapping row, no new quarantine row.
- Full rows (including `owner_id`) are byte-identical between run 1 and run 2; transaction ids, amounts (12.34), currencies, `evidence_count`, evidence links and classification fact ids are unchanged across both runs and across the initial evidence snapshot.

Minor observation: `result.mappings` reports 2 on every run because mappings are re-upserted, not because rows are duplicated; row count is stable.

## Probe C — quarantine

Actual output:

```
PROBE_C backfill_result: {"…","quarantined":1,"unresolved":{"financial_accounts":1,…}}
PROBE_C active_quarantine_rows: [{"table_name":"financial_accounts","row_id":"231fd314-…","status":"quarantined","reason":"unresolved_account_owner"}]
PROBE_C scoped_visible_rows: 0
PROBE_C unscoped_row_still_present: [{"id":"231fd314-…","owner_id":null}]
PROBE_C released_row: [{"status":"released","released_at":"2026-10-17T19:01:21.204Z"}]
PROBE_C scoped_visible_after_release: 1
PROBE_C after_release_second_backfill: {"quarantined":1,"status":"quarantined"}
PROBE_C RESULT: PASS
```

Verified: one active quarantine row, `owner_row_visible=false`, scoped predicate returns zero rows, underlying row not deleted, release makes it visible. Operational note: a later backfill re-quarantines a released but still ownerless account (`releaseQuarantinedRow` sets `released`, then `quarantineRow` flips it back to `quarantined`); release is not durable while the row remains unresolved.

## Probe D — taxonomy purity

Actual output:

```
PROBE_D insert_owned_domain_error: "public_taxonomy_cannot_be_owned"
PROBE_D update_domain_owner_error: "public_taxonomy_cannot_be_owned"
PROBE_D update_concept_owner_error: "public_taxonomy_cannot_be_owned"
PROBE_D leaked_owner_before_backfill: "leaked-owner"
PROBE_D backfill_result: {"publicTaxonomyCleared":1,"quarantined":0}
PROBE_D owner_after_backfill: null
PROBE_D taxonomy_audit_rows: [{"table_name":"entities","row_id":"7211228d-…","reason":"public_taxonomy_owner_removed","status":"remediated","evidence":{"removed_owner_id":"leaked-owner"}}]
PROBE_D reassign_after_clear_error: "public_taxonomy_cannot_be_owned"
PROBE_D RESULT: PASS
```

Verified for the owner marker: trigger blocks insert and update on both `domain` and `concept`; a simulated legacy leak (trigger temporarily disabled) is cleared by backfill and audited with status `remediated`. Limit: the trigger checks only `owner_id`, not taxonomy content, so personal text in a public taxonomy row is still possible.

## Probe E — cross-owner edge (DEFECT)

Actual output (event owner `legacyA-…`, entity owner `legacyB-…`):

```
PROBE_E omit_owner_insert_error: null
PROBE_E omit_owner_inserted_row: [{"id":"06d388c6-…","event_id":"c8cb0d45-…","entity_id":"2d909000-…","owner_id":"legacyA-…"}]
PROBE_E explicit_event_owner_insert_error: null
PROBE_E explicit_event_owner_inserted_row: [{"id":"8d900114-…","owner_id":"legacyA-…","entity_id":"87e8f118-…"}]
PROBE_E mismatched_owner_insert_error: "event_entity_owner_mismatch"
PROBE_E cross_owner_links_present: [{"id":"06d388c6-…","edge_owner":"legacyA-…","entity_owner":"legacyB-…"}]
PROBE_E RESULT: FAIL cross-owner link accepted
```

Second independent case:

```
PROBE_E2 cross_owner_relation_insert_error: null
PROBE_E2 cross_owner_relation: {"before":{"id":"7de306e0-…","owner_id":null},"after":{"id":"7de306e0-…","owner_id":null},"quarantine":[],"ownersAssignedRelations":0}
```

Interpretation:
- `enforce_event_entity_owner()` (`migrations/20261017100000_owner_identity.sql:117-133`) only checks `new.owner_id` against the event owner. When the caller omits `owner_id`, the trigger fills it from the event and accepts the foreign entity. Cross-owner linkage is therefore possible with an ordinary insert.
- There is no `(entity_id, owner_id)` composite FK to `entities(id, owner_id)`; the migration only adds event children → `raw_events` FKs (`:80-98`), and `entities` has no `(id, owner_id)` unique index.
- `relations` has no owner guard at all; step 7 of the backfill only assigns an owner when exactly one distinct endpoint owner exists (`src/storage/ownership.ts:291-313`), so a cross-owner relation stays `owner_id=null` and is not quarantined (quarantine targets are finance rows and ambiguous entities only, `:345-375`).
- The implementer's cross-owner test (`tests/v2-ownership.test.ts:104-108`) passes `owner_id='other-owner-mismatch'`, which exercises the event-owner mismatch path, not an entity owned by another owner. It does not cover the defect.

## Probe F — migration contract

Actual output:

```
PROBE_F manifest_migrations: 44
PROBE_F migration_files: 44
PROBE_F schema_contract_migrations: 44
PROBE_F manifest_names_match_files: true
PROBE_F objects: 1409
PROBE_F reconcile_problems: []
PROBE_F fresh_reconcile_problems: []
PROBE_F applied_ledger_count: 44
PROBE_F RESULT: PASS
```

Verified: manifest, migration files and `schemaContract()` agree on 44 migrations; object count 1409; both an isolated roll-forward and a brand-new in-memory DB reconcile with zero problems.

## Supplementary probes (not in the required A–F list)

### Probe G — RLS/ACL on new ledger tables

```
PROBE_G rls [{"client_owner_mappings",relrowsecurity:false},{"entity_owner_splits",false},{"owner_quarantine",false},{"entities",true},{"financial_transactions",true},{"raw_events",true}]
PROBE_G acl []
PROBE_G policies []
PROBE_G owner_not_null_count 2   (only client_owner_mappings.owner_id and entity_owner_splits.owner_id)
```

The three tables created by B05 do not enable RLS, while pre-existing tables do via `migrations/0037_lockdown_supabase_public_api.sql:4-17` (its loop only sees tables that existed at that time). The migration also does not revoke/`alter default privileges` for `anon`/`authenticated`. In an environment where Supabase default grants apply, the mapping and quarantine ledgers could be exposed outside the backend. No grants/policies were present in the isolated PGlite fixture, so this is an environment-dependent exposure, not an isolated-fixture failure.

### Probe H — unresolved legacy rows are not quarantined

```
PROBE_H result: {…,"quarantined":0,"unresolved":{"financial_transactions":0,"financial_accounts":0,"pending_financial_transactions":0,"entities":0}}
PROBE_H unresolved_rows: {
  "event":{"client_id":null,"owner_id":null},
  "entity":{"owner_id":null},
  "fact":{"client_id":null,"owner_id":null},
  "quarantine":[]
}
PROBE_H visibility: {"event":true,"entity":true,"fact":true}
```

Rows that cannot be resolved are left unowned and visible rather than quarantined. The backfill only quarantines ownerless finance rows and ambiguous multi-owner entities; it does not quarantine ownerless `raw_events`, `knowledge_facts`, unlinked personal `entities`, `entity_aliases`, or `relations`. This contradicts the required step "Quarantine unresolved legacy rows" and weakens the "cannot see quarantined rows" boundary (these rows are never marked quarantined at all).

### Probe I — inventory completeness

```
PROBE_I personal_tables_with_client_but_no_owner: 21 tables
  background_jobs, classification_corrections, classification_decisions, classified_events,
  client_diagnostic_logs, client_domain_preferences, data_deletion_audit, entity_semantic_profiles,
  insight_candidates, intelligence_artifacts, intelligence_feedback, interaction_events,
  knowledge_embeddings, knowledge_feedback, model_call_audits, reclassification_runs,
  semantic_backfill_runs, semantic_candidates, semantic_event_decisions, semantic_observations,
  semantic_rules
```

`ownerInventory()` classifies `personal` only by the hardcoded 14-entry `PERSONAL_TABLES` list (`src/storage/ownership.ts:9-24`, `:58-81`). The inventory test asserts only that those 14 have owner keys (`tests/v2-ownership.test.ts:32-39`); it cannot detect the 21 tables above. Required step "Inventory ownership for every object" is therefore incomplete.

## Defects (reproducible)

1. **Cross-owner event↔entity link accepted** — `migrations/20261017100000_owner_identity.sql:117-133` (guard ignores `entities.owner_id`), `:80-98` (no `(entity_id, owner_id)` composite FK to `entities`). Probe E: insert with `event_entities.owner_id = event.owner_id` and a foreign-owned entity succeeds. This directly falsifies acceptance criterion "Personal entities/edges belong to one owner".
2. **Cross-owner relations accepted and unowned** — no guard on `relations`; `src/storage/ownership.ts:291-313` leaves mixed-owner relations `null`; `:345-375` does not quarantine them. Probe E2.
3. **Unresolved ownerless rows never quarantined** — `src/storage/ownership.ts:345-375` targets only finance rows and ambiguous entities. Probe H shows ownerless event/entity/fact remain visible.
4. **Inventory is not exhaustive** — `src/storage/ownership.ts:9-24` hardcodes 14 tables; 21 tables with `client_id` still lack `owner_id`. Probe I.
5. **New B05 ledgers not covered by RLS lockdown** — `migrations/20261017100000_owner_identity.sql:7-40`; `migrations/0037_lockdown_supabase_public_api.sql:4-17` only covered tables existing at 0037. Probe G.
6. **Minor:** unused `OWNER_KEY_BY_TABLE` constant (`src/storage/ownership.ts:53-56`); release is not durable against a later backfill (Probe C).

## Scope attribution vs `docs/reports/v2/snapshot-backend.json`

Snapshot: 450 files, manifest SHA-256 `ea41cb12…cb444`; current comparison found 15 changed and 102 added paths (excluding `.git`, `node_modules`, `dist`, `.vercel`, `.laya-venv`, `supabase`).

Changed since snapshot:

| Path | Attribution |
|---|---|
| `migrations/20261017100000_owner_identity.sql` (added) | In B05 reservation (`migrations/`). |
| `src/storage/ownership.ts` (added) | In B05 reservation. |
| `contracts/schema/manifest.json`, `contracts/schema/verify.test.mjs` | In B05 reservation (`contracts/schema/`). |
| `src/scripts/backfill-ownership.ts` (added) | Delivered by B05 but **outside the literal reservation** (no `src/scripts/` entry); adjacent and arguably necessary. |
| `tests/v2-ownership.test.ts` (added) | **Outside reservation**; required by B05 verification. |
| `package.json` | **Outside reservation**; adds `backfill:ownership`, `test:isolated`, `test:v2`, etc. |
| `docs/reports/v2/B05-r1.md`, `tests/v2-harness/artifacts/B05-r1.json` | **Outside reservation**; report/evidence artifacts. |
| `graphify-out/*` (graph.html/json, report, labels, cache) | **Outside reservation**; claimed `graphify update` output. |
| `scripts/tmp-owner-inventory.mjs` (added) | **Out-of-bound scratch/debug artifact**, untracked, not part of B05 deliverables; should be removed. |
| `src/storage/financial-transaction-repository.ts`, `src/storage/knowledge-fact-repository.ts`, `src/storage/semantic-repository.ts`, `src/storage/semantic-resolver.ts`, `tests/v2-projections.test.ts` | Changed after snapshot but **not listed in B05-r1 scope**; likely earlier B04 work. Cannot be attributed to B05; flagged as unattributed overlap. |
| `tests/v2-harness/artifacts/latest.json` | **Verifier-caused** by required command #5 (`test:v2` rewrites `latest.json`), not an implementer write. |

No mobile repository files were accessed or modified. Numerous untracked logs, `.env.*` files and `graphify-out/2026-10-17/*` predate or accompany the environment; they are not part of B05 and sensitive `.env.*` files must not be committed.

## Remaining blockers and conditions

1. Add a real single-owner invariant for event↔entity edges: composite FK `event_entities(entity_id, owner_id) → entities(id, owner_id)` (with `entities(id, owner_id)` unique index) and/or extend the trigger to compare against `entities.owner_id`; mirror for `event_relations`/`relations`.
2. Quarantine or owner-scope every unresolved personal row (`raw_events`, `knowledge_facts`, unlinked `entities`, aliases, relations), not only finance and ambiguous entities.
3. Complete the ownership inventory and add `owner_id` for the remaining personal tables (at minimum `classified_events`, `classification_corrections`, `background_jobs`, `entity_semantic_profiles`, `knowledge_embeddings`, `intelligence_artifacts`).
4. Enable RLS and/or revoke `anon`/`authenticated` privileges on the three new ledger tables, or extend the `0037` lockdown to future tables.
5. B06 must wire `ownerVisiblePredicate`/`owner_row_visible` into routes/repositories and introduce the restricted DB role. That remains out of B05 and is not claimed here.
6. Validate the `NOT VALID` composite FKs only after remediation/backfill evidence review; production mapping approval remains a human decision.
7. E06/E11 remain BLOCKED (0 pass, 270 blocked combined).

## Limitations

- PGlite 0.5.8 in-memory only; no real PostgreSQL TCP, no concurrency, role/RLS or crash semantics, no `pg_dump`/restore. `verify.test.mjs` itself records these as BLOCKED.
- No production DB, credentials, mobile app, or external services were used.
- The implementer's report (`B05-r1.md`) is treated as claims; this report is based on independent commands and probes above.
- Snapshot comparison is hash/size based; it cannot prove historical authorship of the five unattributed source/test changes.
- Content-level taxonomy purity (personal text inside a `domain`/`concept`) is not testable from the current schema and was not proven.

---

# Remediation addendum (r2, historical)

> Superseded for defect 4 and the release counter by the **r3 final delta** at the end of this report.

Verified delta only, per the r2 request. Inputs: current migration, `src/storage/ownership.ts`, `tests/v2-ownership.test.ts`, `docs/reports/v2/B05-r2.md`, and the r1 report above. The full r1 audit was not repeated.

## r2 command results

| Command | Exit | Actual output |
|---|---:|---|
| `npm run lint` | 0 | `tsc -p tsconfig.json --noEmit`; no diagnostics. |
| `npm run build` | 0 | `tsc -p tsconfig.json`; no diagnostics. |
| `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-ownership.test.ts` | 0 | `# tests 6`, `# pass 6`, `# fail 0`, duration 12905.6789 ms. |
| `npm run test:isolated` | 0 | `# tests 124`, `# pass 124`, `# fail 0`, `# skipped 0`, duration 206787.3105 ms. |
| `$env:NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'; npm run schema:verify -- --read-only` | 0 | `{ "ok": true, "readOnly": true, "problems": [] }` |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | `PASS baseline 44 applied checksummed migrations / 1456 catalog objects`; exhaustive reconciliation 1456 identities; `PASS fresh migration and read-only reconciliation`; index control-flow scenarios PASS. |

Scratch-file check: `Test-Path scripts/tmp-owner-inventory.mjs` → `False` (file removed).

## r2 defect status

| # | Defect | Status | r2 evidence |
|---|---|---|---|
| 1 | Cross-owner event↔entity link accepted | **CLOSED** | Probe 1: both omitted-owner and explicit-event-owner inserts against a foreign-owned entity raise `event_entity_entity_owner_mismatch`; zero rows inserted. Public-taxonomy link still succeeds and inherits the event owner. |
| 2 | Cross-owner relations accepted / mixed-owner edges unowned | **CLOSED** | Probe 2: cross-owner personal relation rejected with `relation_owner_mismatch` (implicit and explicit owner); personal↔public relation accepted with `owner_id` inferred from the personal endpoint; public↔public stays `null`; backfill quarantines neither valid relation. |
| 3 | Unresolved rows never quarantined | **CLOSED** | Probe 3: anonymous `raw_events`, ownerless `knowledge_facts`, two unlinked personal `entities` and one personal `relations` row are all quarantined (5 rows, reasons `unresolved_*`); `isOwnerRowVisible=false` and `ownerVisiblePredicate` returns 0 for all four types; underlying rows still present. |
| 4 | Inventory incomplete | **NOT CLOSED (partial)** | Probe 4: 26 tables now have a `client_id`/`client_scope` key; **`knowledge_embeddings` and `knowledge_feedback` still have no `owner_id`**, are absent from `PERSONAL_TABLES`, and no exception is documented in `B05-r2.md`. Migration/PERSONAL_TABLES otherwise cover the other 24 tables. |
| 5 | New ledger tables lacked RLS | **CLOSED** | Probe 5: `relrowsecurity=true` for all three ledgers; `has_table_privilege` for `anon` and `authenticated` across SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER returns no grants; ACL contains only `postgres`; no policies. |
| 6 | Unused constant; release not durable | **CLOSED** | Constant removed. Probe 6: release → `released`/visible; second `backfillOwnership` keeps `status='released'`, `released_at` stable, `isOwnerRowVisible=true`, scoped predicate returns 1. |

## r2 probe details

### Probe 1 — cross-owner event↔entity

```
PROBE1 event_owner: "ownerA-9da44dc3-…"
PROBE1 omit_owner_error: "event_entity_entity_owner_mismatch"
PROBE1 explicit_event_owner_error: "event_entity_entity_owner_mismatch"
PROBE1 public_taxonomy_link: {"id":"fc200e8f-…","event_id":"2079dd40-…","entity_id":"a0ceaed9-…","owner_id":"ownerA-9da44dc3-…"}
PROBE1 RESULT: PASS
```

### Probe 2 — relations

```
PROBE2 cross_owner_relation_error: "relation_owner_mismatch"
PROBE2 cross_owner_explicit_owner_error: "relation_owner_mismatch"
PROBE2 personal_public_relation: {"id":"b66c71c4-…","owner_id":"ownerA-660d0871-…",…}
PROBE2 public_public_relation_owner: null
PROBE2 backfill_quarantine_of_valid_relations: {"result":0,"rows":[]}
PROBE2 RESULT: PASS
```

### Probe 3 — unresolved rows

```
PROBE3 backfill_unresolved: {"raw_events":1,"knowledge_facts":1,…,"entities":2,"relations":1}
PROBE3 backfill_quarantined: 5
PROBE3 quarantine_rows: [
 {"table_name":"entities","reason":"unresolved_entity_owner","status":"quarantined"},
 {"table_name":"entities","reason":"unresolved_entity_owner","status":"quarantined"},
 {"table_name":"knowledge_facts","reason":"unresolved_fact_owner","status":"quarantined"},
 {"table_name":"raw_events","reason":"unresolved_event_owner","status":"quarantined"},
 {"table_name":"relations","reason":"unresolved_relation_owner","status":"quarantined"}
]
PROBE3 visible_flags: {"event":false,"fact":false,"entity":false,"relation":false}
PROBE3 scoped_visible_counts: {"event":0,"fact":0,"entity":0,"relation":0}
PROBE3 underlying_rows_still_present: {"event":1,"fact":1,"entity":1,"relation":1}
PROBE3 RESULT: PASS
```

### Probe 4 — inventory (residual gap)

```
PROBE4 tables_with_client_key: 26
PROBE4 missing_owner_id: ["knowledge_embeddings","knowledge_feedback"]
PROBE4 missing_rows: [
 {"table_name":"knowledge_embeddings","has_client_id":true,"has_client_scope":false,"has_owner_id":false},
 {"table_name":"knowledge_feedback","has_client_id":true,"has_client_scope":false,"has_owner_id":false}
]
PROBE4 personal_tables: 36
PROBE4 client_key_tables_not_personal: ["knowledge_embeddings","knowledge_feedback"]
PROBE4 personal_tables_without_owner_key: []
PROBE4 knowledge_embeddings_in_personal: false
PROBE4 knowledge_feedback_in_personal: false
PROBE4 documented_exception_mention: false
PROBE4 RESULT: FAIL missing owner_id for ["knowledge_embeddings","knowledge_feedback"]
```

The r2 inventory test (`tests/v2-ownership.test.ts:32-39`) still cannot detect this: it only checks that every table in the hardcoded `PERSONAL_TABLES` list has an owner key and that the list has ≥30 entries. A table omitted from the list is invisible to it.

### Probe 5 — RLS and grants

```
PROBE5 rls [{"client_owner_mappings",relrowsecurity:true},{"entity_owner_splits",true},{"owner_quarantine",true}]
PROBE5 anon_authenticated_grants []
PROBE5 acl_entries [ … only grantee "postgres" … ]
PROBE5 policies []
PROBE5 RESULT: PASS
```

Note: `relforcerowsecurity=false`; the table owner still bypasses RLS. This matches the stated B06 deferral and does not affect the r2 condition.

### Probe 6 — durable release

```
PROBE6 initial_status: {"status":"quarantined"}
PROBE6 after_release: {"visible":true,"status":{"status":"released","released_at":"2026-10-17T19:16:37.948Z"}}
PROBE6 after_second_backfill: {"resultQuarantined":1,"status":"released","releasedAtStable":true,"visible":true,"scopedVisible":1}
PROBE6 RESULT: PASS
```

Minor new observation: the second backfill reports `result.quarantined=1` even though the row remains `released` and visible; the counter records the re-evaluation attempt, not a new active quarantine. This is a reporting/counter semantics issue only, not a security regression.

## r2 scope delta

- Changed by r2 (per `B05-r2.md`): `migrations/20261017100000_owner_identity.sql`, `src/storage/ownership.ts`, `tests/v2-ownership.test.ts`, `contracts/schema/manifest.json`, `docs/reports/v2/B05-r2.md`, B05 harness artifact.
- `scripts/tmp-owner-inventory.mjs` is gone (`Test-Path` → `False`).
- The five B04 source/test paths previously flagged as unattributed are now explicitly attributed to B04 by the implementer; I did not re-audit them in this delta.
- No mobile files were accessed or modified.

## r2 conditions

1. Add `knowledge_embeddings` and `knowledge_feedback` to the migration (`owner_id`, index, backfill/quarantine/RLS as appropriate) and to `PERSONAL_TABLES`, **or** record a documented, approved exception and extend the inventory test to assert it. Without this, B05's "inventory ownership for every object" step remains incomplete.
2. B06 still owns route/repository wiring of `ownerVisiblePredicate`/`owner_row_visible`, per-owner RLS policies and the restricted runtime role.
3. Validate the `NOT VALID` composite FKs after approved backfill review; production mapping approval remains a human decision.
4. E06/E11 remain BLOCKED (0 pass; 180 + 90 blocked).

## r2 limitations

- PGlite 0.5.8 in-memory only; no real PostgreSQL, no concurrency, no production migration/rollback.
- The r2 delta was verified with independent stdin probes, not by re-running the implementer's test assertions alone.
- The r2 inventory gap is a schema fact; whether the two tables are intentionally out of scope is a product decision not documented in the inputs.

---

# r3 final delta (B05 close-out)

Scope: final delta only. Checked the two previously missing tables, all client-key tables, durable release for `knowledge_embeddings`, and the required command suite. The r2 addendum above is retained for history; its unresolved defect 4 is closed by this section.

## r3 command results

| Command | Exit | Actual output |
|---|---:|---|
| `npm run lint` | 0 | `tsc -p tsconfig.json --noEmit`; no diagnostics. |
| `npm run build` | 0 | `tsc -p tsconfig.json`; no diagnostics. |
| `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-ownership.test.ts` | 0 | `# tests 6`, `# pass 6`, `# fail 0`, duration 12989.9403 ms. |
| `npm run test:isolated` | 0 | `# tests 124`, `# pass 124`, `# fail 0`, `# skipped 0`, duration 207566.2865 ms. |
| `$env:NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'; npm run schema:verify -- --read-only` | 0 | `{ "ok": true, "readOnly": true, "problems": [] }` |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | `PASS baseline 44 applied checksummed migrations / 1460 catalog objects`; exhaustive reconciliation 1460 identities; `PASS fresh migration and read-only reconciliation`; index control-flow scenarios PASS. |

## r3 defect closure

| # | Defect | Status |
|---|---|---|
| 4 | Inventory incomplete | **CLOSED** — `knowledge_embeddings` and `knowledge_feedback` now have `owner_id` (`migrations/20261017100000_owner_identity.sql:59-60`) and owner indexes (`:98-99`); both appear in `PERSONAL_TABLES` (`src/storage/ownership.ts:24-25`) and `CLIENT_ID_TABLES` (`:69-70`); both are quarantine targets (`:416-417`). All 26 tables with `client_id`/`client_scope` have `owner_id`; all are classified personal; 38 personal tables, zero without an owner key. |
| 6 | Durable release / counter | **CLOSED** — release durability now holds for `knowledge_embeddings`; the second backfill reports `result.quarantined=0` and `unresolved.knowledge_embeddings=0` while status stays `released` and visible. |

## r3 probe details

### Probe 1 — embedding/feedback owner coverage

```
PROBE1 owner_columns [{"knowledge_embeddings","owner_id","is_nullable":"YES"},{"knowledge_feedback","owner_id","is_nullable":"YES"}]
PROBE1 owner_indexes [{"knowledge_embeddings","knowledge_embeddings_owner_idx"},{"knowledge_feedback","knowledge_feedback_owner_idx"}]
PROBE1 in_PERSONAL_TABLES {"knowledge_embeddings":true,"knowledge_feedback":true}
PROBE1 personal_count 38
PROBE1 personal_without_owner_key []
PROBE1 RESULT: PASS
```

Static source confirmation: `knowledge_embeddings` and `knowledge_feedback` are listed in both `PERSONAL_TABLES` and `CLIENT_ID_TABLES` (`src/storage/ownership.ts:24-25`, `:69-70`), and both are in the quarantine target list (`:416-417`).

### Probe 2 — every client-key table

```
PROBE2 client_key_tables 26
PROBE2 missing_owner_id []
PROBE2 client_key_tables_not_personal []
PROBE2 RESULT: PASS
```

No intentional exception is needed: zero tables with `client_id`/`client_scope` lack `owner_id`, and zero are outside `PERSONAL_TABLES`.

### Probe 3 — durable release for `knowledge_embeddings`

```
PROBE3 first_backfill: {"resultQuarantined":1,"unresolvedEmbeddings":1,"quarantine":{"status":"quarantined","reason":"unresolved_embedding_owner"},"visible":false,"scopedVisible":0}
PROBE3 after_release: {"status":"released","visible":true}
PROBE3 after_second_backfill: {"resultQuarantined":0,"unresolvedEmbeddings":0,"status":"released","releasedAtStable":true,"visible":true,"scopedVisible":1}
PROBE3 RESULT: PASS
```

The released row is not re-selected or re-counted by the next backfill; `ownerVisiblePredicate('knowledge_embeddings', 'e.id')` returns it after release.

## r3 final status

- **Defect 4: CLOSED.** **Defect 6: CLOSED.** Defects 1, 2, 3 and 5 remain closed from r2.
- **Final verdict: ACCEPTED.**
- New defects: none blocking. Minor residual test-quality note: the inventory test asserts zero missing owner keys only across the hardcoded `PERSONAL_TABLES` list; a future table omitted from both the migration and that list would not be detected by the test alone. The independent probe above closes that gap for the current schema (26/26 client-key tables, 38/38 personal tables).
- Remaining non-B05 deferrals are unchanged: B06 route/repository wiring, per-owner RLS policies, restricted runtime role, `NOT VALID` FK validation after approved backfill review, and E06/E11 (still BLOCKED).
