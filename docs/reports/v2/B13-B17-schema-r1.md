# B13–B17 reviewed schema catalog update, revision 1

Date: 2026-10-19. Repository: `D:/Coding/BrainIA/BrainIA-Backend`.

Status: reviewed generator update complete; full isolated regression rerun is
pending below. No migrations, application code, tests, published API contract,
mobile files or production data were edited in this dispatch. No commit, push
or deployment was performed.

## Generator and complete semantic diff review

Read `contracts/schema/README.md`, `generate.mjs`, `catalog.sql`, `isolated.mjs`,
`preload-isolated.mjs` and `verify.test.mjs`. Preserved an exact pre-generation
copy of the manifest outside the repository, then used only the reviewed command:

```text
node --import tsx contracts/schema/generate.mjs --write
```

The generator created a fresh in-memory PGlite instance and reported
`Contract: 55 migrations, 2275 objects`. It did not connect to a configured/live
database. The generated manifest was not hand-edited.

The complete keyed comparison against the pre-generation manifest found:

| Check | Result |
| --- | ---: |
| Previous migration entries | 54 |
| Previous migration checksums unchanged | 54 |
| New migration entries | 1 |
| Migration entries removed | 0 |
| Previous object definitions | 1,972 |
| Previous definitions unchanged | 1,970 |
| Explicitly approved definition changes | 2 |
| Unexpected definition changes | 0 |
| New catalog object identities | 303 |
| Object identities removed | 0 |
| Final migration entries | 55 |
| Final catalog object identities | 2,275 |

Initial generation exposed two intentional existing-object changes from the
already implemented v2 migration. Acceptance was paused and the coordinator
explicitly authorized exactly these two exceptions to the initial preservation
constraint: “Authorize exactly these two definition changes; they are the
intended v2 delta.” No third change was accepted:

1. `function:brainia_bump_source_policy_version()` retains its prior behavior and
   adds comparisons for `external_models_allowed` and
   `external_embeddings_allowed`. A direct string comparison confirmed that
   removing only those added comparisons reproduces the prior definition.
2. `relation:privacy_policy_changes` changes only `rls: false` to `rls: true`.
   Its kind and force-RLS values are unchanged. This is paired with the new
   owner-bound insert policy and runtime insert grant in the same migration.

All 303 additions were inspected/classified as v2-related, including the two
new source-policy columns and their NOT NULL constraints, narrow existing-table
grants/policies, and the new v2 functions/tables:

| Added category | Count |
| --- | ---: |
| Function ACLs | 2 |
| Relation ACLs | 41 |
| Columns | 95 |
| Constraints | 115 |
| Functions | 2 |
| Indexes | 25 |
| Policies | 12 |
| Relations | 10 |
| Triggers | 1 |
| Total | 303 |

The new migration entry is `20261019120000_v2_api.sql`, with normalized UTF-8/LF
SHA-256 `b7d463bb656ec4f2e242dd59c4ba2172ee230c3a1dd61dd94968789cdc85a4c3`.

`contracts/schema/catalog.sql` remains byte-identical and has no Git diff: its
existing generic public-catalog query already enumerates the new objects. The
reviewed generator consumes that query and writes only `manifest.json`; no
query change or manual object list was necessary.

## Verification commands and results

The read-only command used the documented isolated preload in a dedicated shell:

```powershell
$env:NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'
npm run schema:verify -- --read-only
```

The preload provisions a new in-memory disposable fixture and configures the
loopback `brainia_b09_pglite` marker before verification. It cannot fall back to
application or production URLs. The verifier itself returned:

```json
{"ok":true,"readOnly":true,"problems":[]}
```

| Exact command | Result |
| --- | --- |
| `node --import tsx contracts/schema/generate.mjs --write` | PASS, exit 0; 55 migrations, 2,275 objects. |
| `npm run schema:verify -- --read-only` with the preload above | PASS, exit 0; readOnly true, problems []. |
| `node --import tsx contracts/schema/verify.test.mjs` | PASS, exit 0; baseline 55 applied checksummed migrations / 2,275 catalog objects and 2,275 independent omission checks. |
| `npm run lint` | PASS, exit 0; zero TypeScript diagnostics. |
| `npm run build` | PASS, exit 0. |
| `npm run test:isolated` | Full rerun pending; includes unchanged v1 and B07 policy tests as requested. |
| `git diff --check` | PASS, exit 0. |

The schema verifier test also passed nine applied-ledger mutation cases,
independent omitted-policy/grant detection, runtime SELECT-only readiness,
nonowner CREATE/ALTER denial, partial-ledger roll-forward, repeat migration
idempotency, fresh migration/reconciliation and four nontransactional index
control-flow cases. It emitted 22 PASS checkpoints and no failed checkpoint.

Real PostgreSQL concurrency and pg_dump/restore remain unverified, as the
existing test explicitly reports; these in-memory checks do not claim those
deployment capabilities.

## Files and final artifact identities

Changed only:

- `contracts/schema/manifest.json`
- `docs/reports/v2/B13-B17-schema-r1.md`

Reviewed without modification: `contracts/schema/catalog.sql`.

Manifest SHA-256:
`75384e60e93781e63db01898f81845a2f5ed719fae276b381da20907ab7548d8`.

Unchanged catalog SQL SHA-256:
`50015c86ae67b2406a0e6417799b0e8a7671af940056304022ef750656640873`.

Git's textual manifest diff reports 1,139 insertions and 26 deletions because
adjacent generated sections are coalesced into hunks; the complete keyed
comparison proves that only the 303 additions and two authorized existing
definition changes affect catalog semantics. All other concurrent checkout
changes were preserved and are outside this dispatch.
