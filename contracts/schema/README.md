# Reviewed schema contract

`manifest.json` records normalized UTF-8/LF SHA-256 migration checksums and the
expected final catalog definitions. `catalog.sql` enumerates relations and RLS,
columns/defaults, constraints, index definitions/validity/readiness, function
definitions, enabled triggers, policies, table/sequence/function/column grants.
It detects missing objects, changed definitions and unexpected objects/access.
Owner ACL entries, physical storage, data, migration metadata tables and the
test instance marker are excluded. The platform-owned optional `rls_auto_enable`
function body is excluded; its nonowner execution grants are still checked.
Current migrations create no policies; policy and grant omission behavior is
tested with an isolated contract extension.

## Read-only verification

The command has **no fallback** to application or production URLs. It requires
`SCHEMA_VERIFY_DATABASE_URL` naming a loopback database whose name starts with
`brainia_b09_`, `SCHEMA_VERIFY_INSTANCE_ID`, and exactly one matching row in
`public.brainia_disposable_instance(instance_id text primary key)`. Provision
this marker only when creating a disposable database. Verification never creates
the marker and executes inside a repeatable-read, read-only transaction.

```powershell
# Fully in-memory, no TCP; fixture setup happens before verifier execution.
$env:NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'
npm run schema:verify -- --read-only
Remove-Item Env:NODE_OPTIONS

# Catalog omission, runtime read-only checks, fresh/partial upgrade and index
# failure control-flow evidence. This is NOT a real PostgreSQL concurrency test.
node --import tsx contracts/schema/verify.test.mjs
```

To update the contract, review migration SQL, then explicitly run
`node --import tsx contracts/schema/generate.mjs --write` and review the manifest
diff. The generator always builds a new PGlite database; it never snapshots a
configured/live instance. Do not bless drift by regenerating from a target DB.
PGlite catalog formatting is the current baseline; real PostgreSQL major-version
compatibility remains a required deployment check, with drift failing closed.

## Migration runner

One dedicated PostgreSQL session holds advisory lock `(942017, 9)` from before
ledger inspection until reconciliation completes. All transactional migration
SQL and its checksum ledger insertion commit together. Historical filename-only
rows receive checksums only after the final catalog reconciles successfully.
The runner does not discard or overwrite an existing non-null checksum mismatch.

A nontransactional migration must contain exactly one simple named
`CREATE [UNIQUE] INDEX CONCURRENTLY name ON ...;` and start with the literal
header `-- brainia:nontransactional-index`. Mixed scripts and `IF NOT EXISTS`
are refused. `schema_migration_attempts` persists running/failed/succeeded state;
the main ledger is written only after `indisvalid` and `indisready` are true.
An existing index after interruption requires operator inspection; the runner
never automatically drops it or mistakes its name for successful creation.
Keep schema-owner migration credentials separate from a nonowner runtime role.
Runtime permissions on an existing deployment require separate verification.
