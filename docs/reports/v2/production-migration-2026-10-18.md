# Production migration attempt and deploy stop — 2026-10-18

## What was executed

- Pulled production env through the authenticated Vercel CLI into an ignored local file (deleted after use; no values printed).
- Connected to the Neon production database via `POSTGRES_URL_NON_POOLING` (`neondb`, user `neondb_owner`).
- Production was at **42** migrations with latest `20261004000000_expand_classification_learning_fields.sql`.
- Created inert `anon` and `authenticated` roles because the production schema (Neon) lacked the Supabase roles expected by `20261015000000_reconcile_runtime_schema.sql`.
- Applied **12 additive migrations**. Production is now at **54** migrations, latest `20261017220000_fx_rate_governance.sql`.

### Applied in this run

`20261015000000_reconcile_runtime_schema.sql`, `20261017100000_owner_identity.sql`, `20261017110000_owner_rls.sql`, `20261017120000_owner_runs.sql`, `20261017130000_privacy_policy_versioning.sql`, `20261017140000_job_leases_fences.sql`, `20261017160000_job_service_table_lockdown.sql`, `20261017170000_deletion_tombstones.sql`, `20261017180000_deletion_replay_guards.sql`, `20261017190000_deletion_run_read_eligibility.sql`, `20261017200000_finance_currency_safety.sql`, `20261017220000_fx_rate_governance.sql`.

### Verified present

- Tables: `client_owner_mappings`, `owner_quarantine`, `entity_owner_splits`, `deletion_tombstones`, `fx_rates`, `background_job_attempts`.
- Columns: `raw_events.owner_id`, `entities.owner_id`, `financial_transactions.owner_id`, `source_processing_policies.policy_version`, `insight_runs.policy_version`.
- RLS enabled on `entities`, `raw_events`, `owner_quarantine`, `client_owner_mappings`.

### Schema verification result

The migration runner applied all files, then `verifySchema` failed on **pre-existing production drift**: the production database is missing many named `NOT NULL` constraints that the expected catalog contract includes (semantic tables, source policies, and others). This is not caused by the new migrations; the ledger is complete at 54. It does mean `schema:verify` cannot pass against production until the drift is reconciled.

## Why the backend deploy was stopped

1. **Auth fail-closed would take production down.** Production env contains neither `BRAINIA_API_KEY` nor `BRAINIA_CLIENT_KEYS`. The new code treats `VERCEL=1` as requiring auth and returns `503 auth_not_configured` for every `/api` route. Deploying now would break every API call.
2. **Auth model mismatch.** Mobile v2 sends `Authorization: Bearer <token>`, while the backend auth hook validates `x-brainia-client-id` + `x-brainia-api-key`. There is no bearer-token validation path for the v2 transport.
3. **No `/api/v2` implementation.** B13+ are not started. Deploying the current code does not provide the v2 endpoints the mobile contract expects.
4. **Privacy fail-closed source policies are unverified.** B07 denies external model/embedding dispatch when a source has no approved policy row. Production policy rows were not seeded or audited, so deploying could silently stop classification/enrichment.
5. **No durable backup/snapshot.** Neon has 6-hour history and no snapshots; the only rollback is point-in-time within that window.
6. **Native/device evidence is incomplete.** The signed APK runs, but capture→queue→sync, migration behavior, and v2 auth were not exercised end-to-end.

## Current production state

- Deployed code: **unchanged** at `e0ccc565ebd3c956fd138b5d5300010e8579245c` (v1-era).
- Database: migrated to **54** additive migrations.
- No backend deployment, promotion, rollback, or env change was performed.
- `anon`/`authenticated` roles were created as inert (NOLOGIN) placeholders.

## Safe next options

1. **Configure auth first:** issue a client key / bearer-token validation path, set `BRAINIA_REQUIRE_AUTH=true` with real credentials, and verify old v1 clients still work.
2. **Seed/approve source processing policies** and verify classification still runs.
3. **Reconcile production schema drift** or explicitly accept the `schema:verify` failure before release.
4. **Deploy with flags off** only after 1–3, then smoke-test health and one capture.
5. Rollback available only via Neon PITR (6 hours) unless a child branch is created first.
