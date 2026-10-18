# B00 deployment, schema, dirty-state and recovery baseline

Captured 2026-10-15T15:54:33.039412+00:00. Target: `D:/Coding/BrainIA/BrainIA-Backend`. Task `task_ae39b5c96255`, dispatch `ctx_94622e616178`. Only this report is an authorized filesystem write; no application build, dependency install, migration, commit, backup restore, application startup, or production mutation was performed. BrainIA-Mobile was not accessed.

## G0 verdict

**BLOCKED / NOT APPROVED.** The investigation/report is complete, but G0 is not satisfied by producing a report. Local dirty-state and configured-database catalog evidence are verified below. Current production revision/binding, host limits, isolated restore proof, legacy ownership approval, and Android facts remain blocked. No human approval or independent verification is implied.

“Verified” means observed in the named local files or the explicitly read-only catalog session. “Unverified/blocked” means the stated access, artifact, or approval is missing. Proposed procedures below are requirements to be executed later, not completed controls.

## 1. Verified inspected revision and dirty-state fingerprint

Evidence commands: `git rev-parse --show-toplevel`, `git rev-parse HEAD`, `git branch --show-current`, `git status --porcelain=v1`, `git status --porcelain=v1 --untracked-files=all`, `git diff --stat`, `git diff --cached --stat`, `git ls-files -s -z`, and the read-only Python fingerprint script below.

- HEAD: `b71c4cc82ca0faa636db656c729e79cb906a9114`; branch: `main`.
- Working tree SHA-256: `9bc7536e660d4d6e7bb35b503065f9293d46fe7f18d3a967dac473cccc7e2303`.
- Raw Git index listing SHA-256: `ab2e7fa9a7cb5dd113abfecc19d435a6738136985db2deeded728bf34464ff94`; 321 entries; all mode `100644`, all stage 0. `git diff --cached --stat` returned no output.
- `git diff --no-ext-diff --binary HEAD -- . :(exclude)docs/reports/v2/baseline.md` SHA-256: `6f12d15eb07dc9481c911443418f5041c6d4de7aca52a20fb0eec1a765f14508`. Raw diff contents are deliberately not published because configuration diffs can contain sensitive material.
- Working-tree manifest: 371 paths, including deleted-file markers and 50 individual untracked files. The report itself is excluded to avoid a self-referential fingerprint.
- This is a content fingerprint, not an archived recovery snapshot or a Git tree object. It does not preserve ACLs, timestamps, ignored files, databases, or credentials outside the enumerated paths. Index modes/stages are separately fingerprinted. No `stash` operation or temporary index was used, and no Git objects were written by the fingerprint.

### Full porcelain v1 output at capture

```text
 M .env.example
 M .gitignore
 M .vercelignore
 D agent.md
 M graphify-out/.graphify_labels.json
 M graphify-out/GRAPH_REPORT.md
 M graphify-out/cache/stat-index.json
 M graphify-out/graph.html
 M graphify-out/graph.json
 M graphify-out/manifest.json
 M package-lock.json
 M package.json
 M src/app.ts
 M src/domain/classification.ts
 M src/domain/entities.ts
 M src/domain/financial-transactions.ts
 M src/domain/money.ts
 M src/routes/events.ts
 M src/routes/financial-transactions.ts
 M src/routes/insights.ts
 M src/routes/operations.ts
 M src/storage/classification-assistant.ts
 M src/storage/classification-learning.ts
 M src/storage/deepseek.ts
 M src/storage/event-store.ts
 M src/storage/financial-transaction-repository.ts
 M src/storage/job-repository.ts
 M src/storage/job-worker.ts
 M src/storage/model-audit.ts
 M src/storage/postgres.ts
 M src/storage/proactive-insights.ts
 M src/storage/semantic-enrichment.ts
 M tests/api-contracts.test.ts
 M tests/domain.test.ts
?? .env.laya.example
?? .env.production.dbcheck
?? AGENTS.md
?? docs/brainia-next.md
?? docs/laya-local.md
?? docs/reports/laya-calibration-2026-09-23.md
?? graphify-out/2026-10-02/
?? graphify-out/2026-10-03/
?? graphify-out/2026-10-04/
?? graphify-out/cache/ast/v0.9.4/01fbc8b5e81828c3d214f8ae82cbcb37b51be4b683243f9bac628456cb26f418.json
?? graphify-out/cache/ast/v0.9.4/1df4ede6f6baac86246d4babe2c4278876c143b0193dbb2cb5a8332e694525d2.json
?? graphify-out/cache/ast/v0.9.4/2b94045d0b9be04f3dcc80894f886f019fcdd014a9df3d167b9d9baf41dc4f07.json
?? graphify-out/cache/ast/v0.9.4/35e54e16819f582bd39570df539be819e78a8ba106a5299769112ea7b58a61fe.json
?? graphify-out/cache/ast/v0.9.4/6841023246322429964546a3da5b008ad105f82ce62ef5c7fda8f20fed8aae1d.json
?? graphify-out/cache/ast/v0.9.4/81a6453de904bb26736de39f82956e230d6d0ef848531c01cb82c43b130b9bf0.json
?? graphify-out/cache/ast/v0.9.4/83b2d6da5edad53823fc1bce62aceacba0a6d35bd6a2d25de07869c7a5872cd1.json
?? graphify-out/cache/ast/v0.9.4/e862e469012c1ff7a300c18905e7a9db4fe6e71f12518bc6ef921b2ea8030a1c.json
?? migrations/0037_lockdown_supabase_public_api.sql
?? migrations/0038_revoke_public_rls_helper.sql
?? migrations/0039_financial_transaction_detail_performance.sql
?? migrations/20260922200339_brainia_next_intelligence.sql
?? migrations/20261003000000_pending_financial_transactions.sql
?? migrations/20261004000000_expand_classification_learning_fields.sql
?? scripts/
?? src/domain/intelligence.ts
?? src/routes/intelligence.ts
?? src/scripts/evaluate-jev.ts
?? src/scripts/evaluate-laya.ts
?? src/scripts/validate-live-intelligence.ts
?? src/storage/correction-memory.ts
?? src/storage/correction-projection.ts
?? src/storage/intelligence-evidence.ts
?? src/storage/intelligence-schema.ts
?? src/storage/intelligence.ts
?? src/storage/jev.ts
?? src/storage/pending-financial-schema.ts
?? tests/intelligence.test.ts
?? tests/pending-financial-transactions.test.ts
?? tests/pglite-setup.mjs
?? tests/run-isolated.mjs
```

### Explicit files a fresh HEAD-based worktree would not reproduce

The following full expansion is the pre-existing modified/deleted/untracked inventory. A fresh HEAD checkout contains older versions of every ` M` file, contains the deleted `agent.md`, and omits every `??` file; these differences must not be mistaken for worker-created changes. Directory entries in the first listing are expanded here.

```text
 M .env.example
 M .gitignore
 M .vercelignore
 D agent.md
 M graphify-out/.graphify_labels.json
 M graphify-out/GRAPH_REPORT.md
 M graphify-out/cache/stat-index.json
 M graphify-out/graph.html
 M graphify-out/graph.json
 M graphify-out/manifest.json
 M package-lock.json
 M package.json
 M src/app.ts
 M src/domain/classification.ts
 M src/domain/entities.ts
 M src/domain/financial-transactions.ts
 M src/domain/money.ts
 M src/routes/events.ts
 M src/routes/financial-transactions.ts
 M src/routes/insights.ts
 M src/routes/operations.ts
 M src/storage/classification-assistant.ts
 M src/storage/classification-learning.ts
 M src/storage/deepseek.ts
 M src/storage/event-store.ts
 M src/storage/financial-transaction-repository.ts
 M src/storage/job-repository.ts
 M src/storage/job-worker.ts
 M src/storage/model-audit.ts
 M src/storage/postgres.ts
 M src/storage/proactive-insights.ts
 M src/storage/semantic-enrichment.ts
 M tests/api-contracts.test.ts
 M tests/domain.test.ts
?? .env.laya.example
?? .env.production.dbcheck
?? AGENTS.md
?? docs/brainia-next.md
?? docs/laya-local.md
?? docs/reports/laya-calibration-2026-09-23.md
?? graphify-out/2026-10-02/.graphify_labels.json
?? graphify-out/2026-10-02/GRAPH_REPORT.md
?? graphify-out/2026-10-02/graph.json
?? graphify-out/2026-10-02/manifest.json
?? graphify-out/2026-10-03/.graphify_labels.json
?? graphify-out/2026-10-03/GRAPH_REPORT.md
?? graphify-out/2026-10-03/graph.json
?? graphify-out/2026-10-03/manifest.json
?? graphify-out/2026-10-04/.graphify_labels.json
?? graphify-out/2026-10-04/GRAPH_REPORT.md
?? graphify-out/2026-10-04/graph.json
?? graphify-out/2026-10-04/manifest.json
?? graphify-out/cache/ast/v0.9.4/01fbc8b5e81828c3d214f8ae82cbcb37b51be4b683243f9bac628456cb26f418.json
?? graphify-out/cache/ast/v0.9.4/1df4ede6f6baac86246d4babe2c4278876c143b0193dbb2cb5a8332e694525d2.json
?? graphify-out/cache/ast/v0.9.4/2b94045d0b9be04f3dcc80894f886f019fcdd014a9df3d167b9d9baf41dc4f07.json
?? graphify-out/cache/ast/v0.9.4/35e54e16819f582bd39570df539be819e78a8ba106a5299769112ea7b58a61fe.json
?? graphify-out/cache/ast/v0.9.4/6841023246322429964546a3da5b008ad105f82ce62ef5c7fda8f20fed8aae1d.json
?? graphify-out/cache/ast/v0.9.4/81a6453de904bb26736de39f82956e230d6d0ef848531c01cb82c43b130b9bf0.json
?? graphify-out/cache/ast/v0.9.4/83b2d6da5edad53823fc1bce62aceacba0a6d35bd6a2d25de07869c7a5872cd1.json
?? graphify-out/cache/ast/v0.9.4/e862e469012c1ff7a300c18905e7a9db4fe6e71f12518bc6ef921b2ea8030a1c.json
?? migrations/0037_lockdown_supabase_public_api.sql
?? migrations/0038_revoke_public_rls_helper.sql
?? migrations/0039_financial_transaction_detail_performance.sql
?? migrations/20260922200339_brainia_next_intelligence.sql
?? migrations/20261003000000_pending_financial_transactions.sql
?? migrations/20261004000000_expand_classification_learning_fields.sql
?? scripts/start-brainia-with-laya.ps1
?? scripts/start-laya.ps1
?? src/domain/intelligence.ts
?? src/routes/intelligence.ts
?? src/scripts/evaluate-jev.ts
?? src/scripts/evaluate-laya.ts
?? src/scripts/validate-live-intelligence.ts
?? src/storage/correction-memory.ts
?? src/storage/correction-projection.ts
?? src/storage/intelligence-evidence.ts
?? src/storage/intelligence-schema.ts
?? src/storage/intelligence.ts
?? src/storage/jev.ts
?? src/storage/pending-financial-schema.ts
?? tests/intelligence.test.ts
?? tests/pending-financial-transactions.test.ts
?? tests/pglite-setup.mjs
?? tests/run-isolated.mjs
```

### Diff summary

```text
 .env.example                                    |   13 +
 .gitignore                                      |    4 +
 .vercelignore                                   |    5 +
 agent.md                                        |   37 -
 graphify-out/.graphify_labels.json              |   10 +-
 graphify-out/GRAPH_REPORT.md                    |  171 +-
 graphify-out/cache/stat-index.json              |    2 +-
 graphify-out/graph.html                         |    8 +-
 graphify-out/graph.json                         | 6847 +++++++++++++++++++----
 graphify-out/manifest.json                      |  229 +-
 package-lock.json                               |    8 +
 package.json                                    |   12 +-
 src/app.ts                                      |    4 +-
 src/domain/classification.ts                    |   31 +
 src/domain/entities.ts                          |    4 +
 src/domain/financial-transactions.ts            |   19 +-
 src/domain/money.ts                             |    2 +-
 src/routes/events.ts                            |   39 +-
 src/routes/financial-transactions.ts            |  104 +
 src/routes/insights.ts                          |   25 +-
 src/routes/operations.ts                        |    9 +-
 src/storage/classification-assistant.ts         |   21 +-
 src/storage/classification-learning.ts          |    1 +
 src/storage/deepseek.ts                         |    9 +-
 src/storage/event-store.ts                      |   49 +-
 src/storage/financial-transaction-repository.ts |  430 +-
 src/storage/job-repository.ts                   |    2 +-
 src/storage/job-worker.ts                       |   12 +-
 src/storage/model-audit.ts                      |   10 +-
 src/storage/postgres.ts                         |   11 +-
 src/storage/proactive-insights.ts               |    2 +-
 src/storage/semantic-enrichment.ts              |   15 +-
 tests/api-contracts.test.ts                     |   30 +
 tests/domain.test.ts                            |   60 +
 34 files changed, 7038 insertions(+), 1197 deletions(-)
```

### Reproduction and future isolated worktrees

**Verified algorithm:** run the following in the repository root with Python and Git. It reads bytes without altering the checkout, hashes sorted tracked plus nonignored untracked paths, represents a missing tracked file explicitly, and hashes symlink text without following it. The output contains hashes and paths, never file contents. All bytes, including line endings, must match for a future worktree to match; record/retain the repository's checkout encoding and Git line-ending settings when preparing a snapshot.

```python
import subprocess,pathlib,hashlib,json,datetime,collections,os
def git(*args): return subprocess.check_output(['git',*args])
excluded='docs/reports/v2/baseline.md'
paths=sorted(set(git('ls-files','-z').split(b'\0')+git('ls-files','--others','--exclude-standard','-z').split(b'\0'))-{b'',excluded.encode()})
entries=[]
for raw in paths:
 p=pathlib.Path(os.fsdecode(raw))
 if p.is_symlink(): kind='symlink'; payload=os.fsencode(os.readlink(p))
 elif p.is_file(): kind='file'; payload=p.read_bytes()
 elif not p.exists(): kind='missing'; payload=b''
 else: raise RuntimeError('Unsupported path type: '+str(p))
 entries.append([raw.decode('utf-8'),kind,hashlib.sha256(payload).hexdigest()])
canonical=json.dumps(entries,ensure_ascii=False,separators=(',',':')).encode('utf-8')
index=git('ls-files','-s','-z')
diff=git('diff','--no-ext-diff','--binary','HEAD','--','.',':(exclude)'+excluded)
result={'timestamp_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'head':git('rev-parse','HEAD').decode().strip(),'branch':git('branch','--show-current').decode().strip(),'status_porcelain':git('status','--porcelain=v1').decode(),'status_porcelain_all':git('status','--porcelain=v1','--untracked-files=all').decode(),'working_tree_sha256':hashlib.sha256(b'B00-WORKTREE-v1\n'+canonical).hexdigest(),'manifest':entries,'index_sha256':hashlib.sha256(index).hexdigest(),'index_entries':len(index.split(b'\0'))-1,'index_modes':dict(collections.Counter(line.split(b' ')[0].decode() for line in index.split(b'\0') if line)),'diff_head_binary_sha256':hashlib.sha256(diff).hexdigest(),'diff_stat':git('diff','--stat').decode(),'diff_cached_stat':git('diff','--cached','--stat').decode(),'migrations_local':sorted(p.name for p in pathlib.Path('migrations').glob('*.sql'))}
print(json.dumps(result,ensure_ascii=False))
```

**Unverified/blocked snapshot approval:** a HEAD-only worktree is insufficient. A future baseline/integration owner must review the inventory, preserve the existing checkout, create an approved snapshot of needed source changes under separate write authorization, and record the new snapshot revision plus exclusions. Do not blindly commit/copy untracked files: `.env.production.dbcheck` is secret-bearing and untracked. Transfer required credentials only through the approved secret mechanism, never a patch/report/archive committed to Git. The full-tree hash will intentionally differ if sensitive or generated paths are excluded; approve and fingerprint that sanitized snapshot separately rather than claim equality with this complete local fingerprint.

**Verified ignored-state limitations:** `.gitignore` ignores `.env.local`, `.env.*.local`, `.vercel/`, `node_modules/`, `dist/`, `.laya-venv/`, logs, coverage and data. Existing credential/config files include `.env.local`, `.env.laya.local`, and `.vercel/.env.production.local`; they are not part of the nonignored-untracked fingerprint. Their values are not reproduced here. A fresh worktree will not contain these local files or the ignored compiled Vercel output.

## 2. Verified configured database facts; deployment binding blocked

### Access method and limits of attribution

**Verified:** existing installed `pg` allowed a direct catalog session using only `.env.production.dbcheck`. The query client selected `DATABASE_URL_UNPOOLED || POSTGRES_URL_NON_POOLING || DATABASE_URL`; the selected nonempty field was `POSTGRES_URL_NON_POOLING`. Runtime resolution in `src/storage/database-url.ts` chooses `DATABASE_URL || POSTGRES_URL || POSTGRES_URL_NO_SSL`; in this file the selected field is `POSTGRES_URL`. A safe in-memory URL comparison verified the same database, login, and normalized host (pooler suffix removed) for runtime and direct targets. The resolved runtime URL also matches `.vercel/.env.production.local`. These comparisons reveal no connection values and establish local configuration agreement only.

The client used `options: '-c default_transaction_read_only=on'`, `application_name: 'brainia-b00-readonly-catalog'`, 10-second connection/statement timeouts, `BEGIN READ ONLY`, catalog SELECTs, and `ROLLBACK`. No application module was imported. The session returned `transaction_read_only=on`, database `neondb`, role `neondb_owner`, PostgreSQL `17.11`, `pg_is_in_recovery()=false`. No user records or connector tokens were selected.

**Unverified/blocked:** a filename or locally pulled environment does not establish that the current public production alias uses this target today. Missing: authenticated host deployment metadata showing current production alias, deployment ID, exact Git SHA or immutable upload/artifact digest, deployed configuration and database-target binding. Locally cached production metadata has empty Git commit SHA/ref fields. Do not equate inspected HEAD, local compiled output, configured database, and current deployed code.

### Catalog query evidence (verified on configured target)

Run equivalent SELECTs in a read-only transaction with the same connection procedure to independently verify. Queries used:

```sql
BEGIN READ ONLY;
SELECT version(), current_user, current_database(),
       current_setting('transaction_read_only'), pg_is_in_recovery();
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
       rolcanlogin, rolreplication, rolbypassrls
FROM pg_roles ORDER BY rolname;
SELECT r.rolname AS granted_role, m.rolname AS member
FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid
JOIN pg_roles m ON m.oid=a.member ORDER BY 1,2;
SELECT n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner),
       c.relrowsecurity, c.relforcerowsecurity,
       has_table_privilege(current_user,c.oid,'SELECT'),
       has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE')
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m')
ORDER BY 1,2;
SELECT version, applied_at FROM public.schema_migrations ORDER BY version;
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check
FROM pg_policies ORDER BY schemaname,tablename,policyname;
SELECT nspname,has_schema_privilege(current_user,oid,'USAGE'),
       has_schema_privilege(current_user,oid,'CREATE')
FROM pg_namespace WHERE nspname NOT LIKE 'pg_%'
  AND nspname <> 'information_schema' ORDER BY 1;
SELECT n.nspname,p.proname,pg_get_userbyid(p.proowner),
       p.prosecdef,p.proconfig,p.proacl::text
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND (p.prosecdef OR p.proname IN ('next_sequence_value','rls_auto_enable'))
ORDER BY 1,2;
SELECT table_name,column_name,data_type,is_nullable
FROM information_schema.columns
WHERE table_schema='public'
  AND (column_name LIKE '%owner%' OR column_name IN ('client_id','user_id','device_id'))
ORDER BY table_name,column_name;
ROLLBACK;
```

### Roles and restrictions

**Verified:** 20 catalog roles exist. Role flags below are observed metadata, not an authorization test against application endpoints. The queried login owns all public tables, can CREATE in `public` and `neon_auth`, has `BYPASSRLS`, role/database creation and replication flags, and memberships in `neon_auth` and `neon_superuser`. A restricted non-DDL runtime role is **not** demonstrated by this configuration; using this login in production would bypass owner RLS. No DDL or writes were attempted.

| Role | Superuser | Inherit | Create role | Create DB | Login | Replication | Bypass RLS |
|---|---|---|---|---|---|---|---|
| cloud_admin | true | true | true | true | true | true | true |
| neon_auth | false | false | false | false | true | false | false |
| neon_service | false | true | true | true | true | true | true |
| neon_superuser | false | true | true | true | false | true | true |
| neondb_owner | false | true | true | true | true | true | true |
| pg_checkpoint | false | true | false | false | false | false | false |
| pg_create_subscription | false | true | false | false | false | false | false |
| pg_database_owner | false | true | false | false | false | false | false |
| pg_execute_server_program | false | true | false | false | false | false | false |
| pg_maintain | false | true | false | false | false | false | false |
| pg_monitor | false | true | false | false | false | false | false |
| pg_read_all_data | false | true | false | false | false | false | false |
| pg_read_all_settings | false | true | false | false | false | false | false |
| pg_read_all_stats | false | true | false | false | false | false | false |
| pg_read_server_files | false | true | false | false | false | false | false |
| pg_signal_backend | false | true | false | false | false | false | false |
| pg_stat_scan_tables | false | true | false | false | false | false | false |
| pg_use_reserved_connections | false | true | false | false | false | false | false |
| pg_write_all_data | false | true | false | false | false | false | false |
| pg_write_server_files | false | true | false | false | false | false | false |

**Verified memberships** (distinct role/member pairs; catalog returned a duplicate neon_auth/neon_service grant):
```text
neon_service -> neon_auth
neondb_owner -> neon_auth
neon_service -> neon_superuser
neondb_owner -> neon_superuser
neon_superuser -> pg_create_subscription
neon_superuser -> pg_maintain
neon_superuser -> pg_monitor
neon_superuser -> pg_read_all_data
pg_monitor -> pg_read_all_settings
pg_monitor -> pg_read_all_stats
neon_superuser -> pg_signal_backend
pg_monitor -> pg_stat_scan_tables
neon_superuser -> pg_write_all_data
```

### Public object and RLS baseline

**Verified:** 49 public ordinary tables; all owned by `neondb_owner`, all `FORCE ROW LEVEL SECURITY=false`, all readable/writable by the queried login. 48 enable RLS; `pending_financial_transactions` does not. `pg_policies` returned **zero rows**. This is not verified tenant isolation: RLS-enabled tables without applicable policies deny ordinary roles by default, while this BYPASSRLS login bypasses the restriction.

| Public table | RLS enabled |
|---|---|
| background_job_attempts | true |
| background_jobs | true |
| backup_verification_runs | true |
| classification_corrections | true |
| classification_decisions | true |
| classified_events | true |
| client_diagnostic_logs | true |
| client_domain_preferences | true |
| data_deletion_audit | true |
| digest_runs | true |
| entities | true |
| entity_aliases | true |
| entity_merges | true |
| entity_review_queue | true |
| entity_semantic_profiles | true |
| entity_sequences | true |
| event_entities | true |
| event_processing_history | true |
| event_relations | true |
| event_semantic_anchors | true |
| events | true |
| financial_accounts | true |
| financial_custom_categories | true |
| financial_transaction_events | true |
| financial_transactions | true |
| insight_candidates | true |
| insight_runs | true |
| intelligence_artifacts | true |
| intelligence_confirmations | true |
| intelligence_dependencies | true |
| intelligence_feedback | true |
| intelligence_revisions | true |
| interaction_daily | true |
| interaction_events | true |
| knowledge_embeddings | true |
| knowledge_facts | true |
| knowledge_feedback | true |
| model_call_audits | true |
| pending_financial_transactions | false |
| raw_events | true |
| reclassification_runs | true |
| relations | true |
| schema_migrations | true |
| semantic_backfill_runs | true |
| semantic_candidates | true |
| semantic_event_decisions | true |
| semantic_observations | true |
| semantic_rules | true |
| source_processing_policies | true |

**Verified:** the catalog additionally contains nine `neon_auth` tables: `account`, `invitation`, `jwks`, `member`, `organization`, `project_config`, `session`, `user`, `verification`. Their owner is `neon_auth`; RLS and FORCE RLS are false. Authentication-row contents were not read.

**Verified:** `public.next_sequence_value` exists, is security invoker (`prosecdef=false`), has `search_path=public, pg_temp`, and null explicit ACL. The query found no public security-definer function and no `public.rls_auto_enable`. No `anon` or `authenticated` roles appear in this database's role catalog. Thus the Supabase wording in migrations 0037/0038 does not prove the configured deployment uses Supabase or that the future owner isolation gate passes.

**Verified ownership-column metadata:** no public column matched `%owner%`, `user_id`, or `device_id`. `client_id` exists in the following tables; it is nullable everywhere listed except `client_domain_preferences`. This is column evidence only; no assumption is made about actual owner assignments or NULL-row counts.
```text
background_jobs.client_id text nullable=YES
classification_corrections.client_id text nullable=YES
classification_decisions.client_id text nullable=YES
classified_events.client_id text nullable=YES
client_diagnostic_logs.client_id text nullable=YES
client_domain_preferences.client_id text nullable=NO
data_deletion_audit.client_id text nullable=YES
entity_semantic_profiles.client_id text nullable=YES
insight_candidates.client_id text nullable=YES
intelligence_artifacts.client_id text nullable=YES
intelligence_feedback.client_id text nullable=YES
interaction_events.client_id text nullable=YES
knowledge_embeddings.client_id text nullable=YES
knowledge_facts.client_id text nullable=YES
knowledge_feedback.client_id text nullable=YES
model_call_audits.client_id text nullable=YES
raw_events.client_id text nullable=YES
reclassification_runs.client_id text nullable=YES
semantic_backfill_runs.client_id text nullable=YES
semantic_candidates.client_id text nullable=YES
semantic_event_decisions.client_id text nullable=YES
semantic_observations.client_id text nullable=YES
semantic_rules.client_id text nullable=YES
```

### Applied migration ledger versus local source

**Verified:** 42 applied filenames exactly equal the 42 local SQL filenames. Latest lexicographic entry is `20261004000000_expand_classification_learning_fields.sql`, recorded applied at `2026-10-04T21:46:33.055Z`. This ledger stores filenames/timestamps, not source checksums: equal filenames do **not** prove deployed SQL bytes match local SQL or that runtime-created objects have no drift. Full object/index/constraint reconciliation belongs to the separately scoped schema inventory/repair gate; it is not certified here.

| Applied filename | Applied at (UTC) |
|---|---|
| 0001_create_events.sql | 2026-07-13T20:14:32.635Z |
| 0002_split_knowledge_model.sql | 2026-07-13T20:14:33.213Z |
| 0003_entities_and_event_links.sql | 2026-07-13T20:14:33.838Z |
| 0004_relations_and_event_relations.sql | 2026-07-13T20:14:34.437Z |
| 0005_event_contract_versioning_and_idempotency.sql | 2026-07-13T20:14:35.004Z |
| 0006_entity_merges.sql | 2026-07-13T20:14:35.588Z |
| 0007_classification_model_metadata.sql | 2026-07-13T20:14:36.163Z |
| 0008_insight_runs.sql | 2026-07-13T20:14:36.750Z |
| 0009_digest_runs.sql | 2026-07-13T20:14:37.352Z |
| 0010_relations_and_link_columns.sql | 2026-07-13T20:14:37.935Z |
| 0011_event_link_conflict_indexes.sql | 2026-07-13T20:14:38.499Z |
| 0012_relation_natural_key_index.sql | 2026-07-13T20:14:39.063Z |
| 0013_entity_aliases_and_review_queue.sql | 2026-07-13T21:08:17.015Z |
| 0014_financial_transaction_correlations.sql | 2026-07-13T22:10:03.917Z |
| 0015_financial_transaction_context.sql | 2026-07-15T02:10:55.198Z |
| 0016_financial_account_currency.sql | 2026-07-16T01:11:26.567Z |
| 0017_backfill_uyu_finance_currency.sql | 2026-07-16T01:11:27.355Z |
| 0018_semantic_knowledge_layer.sql | 2026-07-17T03:07:34.190Z |
| 0019_semantic_candidate_parent.sql | 2026-07-17T12:05:41.209Z |
| 0020_semantic_governance_v2.sql | 2026-07-18T14:54:04.087Z |
| 0021_single_hierarchy_parent.sql | 2026-07-18T16:48:48.745Z |
| 0022_entity_semantic_identity.sql | 2026-07-19T14:10:08.456Z |
| 0023_event_interpretation.sql | 2026-07-19T16:29:59.002Z |
| 0024_semantic_retryable_status.sql | 2026-07-19T16:32:20.803Z |
| 0025_financial_transfer_accounts.sql | 2026-07-21T10:31:04.011Z |
| 0026_prevent_cross_type_entity_merges.sql | 2026-07-21T19:13:14.997Z |
| 0027_financial_account_balances.sql | 2026-07-22T11:56:06.795Z |
| 0028_knowledge_platform.sql | 2026-07-30T20:59:37.314Z |
| 0029_financial_transaction_consolidation.sql | 2026-07-30T20:59:38.351Z |
| 0030_financial_account_colors.sql | 2026-07-31T11:27:15.457Z |
| 0031_client_diagnostic_logs.sql | 2026-07-31T19:54:43.513Z |
| 0032_financial_cross_currency_transfers.sql | 2026-08-01T17:29:34.112Z |
| 0033_versioned_event_taxonomy.sql | 2026-08-02T14:55:04.105Z |
| 0034_financial_transaction_title_override.sql | 2026-08-06T18:07:38.606Z |
| 0035_financial_custom_categories.sql | 2026-09-03T00:34:20.392Z |
| 0036_entity_semantic_profiles.sql | 2026-09-03T02:19:57.450Z |
| 0037_lockdown_supabase_public_api.sql | 2026-09-23T17:19:58.854Z |
| 0038_revoke_public_rls_helper.sql | 2026-09-23T17:20:11.338Z |
| 0039_financial_transaction_detail_performance.sql | 2026-10-03T23:52:19.429Z |
| 20260922200339_brainia_next_intelligence.sql | 2026-09-23T17:20:11.937Z |
| 20261003000000_pending_financial_transactions.sql | 2026-10-03T23:52:20.064Z |
| 20261004000000_expand_classification_learning_fields.sql | 2026-10-04T21:46:33.055Z |

**Verified local-only files relevant to drift:** the six migrations after 0036 are untracked in this checkout yet are present in the queried database ledger. Source `src/storage/intelligence-schema.ts` and `src/storage/pending-financial-schema.ts` contain runtime DDL; operations cron routes can call schema repair. A fresh HEAD worktree omits these files/migrations and is not a faithful schema baseline. No repair endpoint was invoked.

## 3. Backend runtime, deployment configuration and host limits

Evidence commands: UTF-8 `Get-Content` of `package.json`, `package-lock.json`, `tsconfig.json`, `vercel.json`, `serverless.ts`, `src/config.ts`, `src/storage/postgres.ts`, `src/routes/operations.ts`, `src/storage/deepseek.ts`, `.vercelignore`; parsed selected nonsecret fields in ignored compiled config; `node --version`; `Get-Item` timestamps; command discovery via `shutil.which`.

| Finding | Classification and evidence |
|---|---|
| Stack | **Verified local:** private ESM package `brainia-backend@0.1.0`; Fastify, pg, Zod, TypeScript; `tsconfig.json` ES2022/NodeNext, strict mode. Lockfile/installed Fastify 5.10.0. |
| Runtime requirements | **Verified local:** root package has no `engines` or `packageManager` field. Current local `node --version` = v22.23.3. No root version pin was demonstrated; deployed runtime remains blocked. |
| Build/dev/start | **Verified local:** `build=tsc -p tsconfig.json`, `lint=tsc -p tsconfig.json --noEmit`, `dev=tsx watch src/server.ts`, `start=node dist/server.js`; these were read, not run. |
| Scripts with possible external writes | **Verified source:** `migrate`, backfills, normalizers, worker execution, cleanup/apply and backup verification are not appropriate read-only audit commands. Existing isolated/intelligence tests and harness scripts are present but were not run for this task. |
| Hosting config | **Verified local:** Vercel config v2, build command `npm run build`, `@vercel/node` build entry `serverless.ts`, all paths rewrite to that entry. `serverless.ts` constructs Fastify and forwards HTTP requests. |
| Cron declarations | **Verified local:** `/api/v1/cron/process-jobs` every minute (`* * * * *`); `/api/v1/cron/daily-insights` at `0 8 * * *`. Actual enabled production schedules/timezone/execution history are **blocked** pending host evidence. |
| Cron and operations guard | **Verified source:** operations routes compare operations-token header, cron compares bearer secret. This does not prove deployed credentials or cron invocation success. |
| Worker bound | **Verified source:** `src/config.ts` worker batch default 3, clamped 1–8; queued mode requires trimmed value `queued`, otherwise inline. Invalid numeric env inputs are not proven safe by the clamp alone. Actual production values are **unverified**. |
| Database pool | **Verified source:** maximum 4 connections per pool, connection/idle/query/statement timeout 10,000 ms. These are application settings, not account-wide database limits. |
| Provider timeout | **Verified source:** DeepSeek call default timeout 15,000 ms; its actual full-body and deployment deadline behavior is not established by this baseline. |
| Function resource limits | **Verified local:** `vercel.json` declares no `maxDuration`, memory, region, concurrency or Fluid Compute settings. **Blocked:** effective deployment timeout, memory/CPU, plan, region, cron quota/cadence entitlement and capacity require authenticated project/deployment metadata. No platform defaults are assumed. |
| Cached build output | **Verified local artifact only:** `.vercel/output/functions/serverless.ts.func/.vc-config.json` says `nodejs24.x`; timestamp 2026-07-31T19:57:39Z. Cached `.vercel/output/config.json` timestamp 2026-07-31T19:57:40Z lists only daily-insights cron. It omits today's process-jobs declaration. Neither cache proves the deployed runtime or schedules. |
| Available access clients | **Verified local:** Node/Python available; `psql`, `vercel` and `supabase` not found on PATH. Existing pg was used without installing anything. No authenticated host management session was established. |
| Secret-file handling | **Verified local:** `.env.production.dbcheck` appears as untracked rather than ignored; `.vercelignore` omits a matching rule for that filename. **Unverified exposure:** actual deployed upload/bundle contents were not inspected. Require private packaging/security review before any future release; no secret value is included in this report. |

**Unverified/blocked current deployed backend revision:** missing authenticated production alias/deployment receipt plus exact source/artifact hash. Local environment metadata contains production labels but empty commit SHA/ref. A CLI-uploaded dirty build may have no meaningful HEAD correspondence; require artifact digest and approved source-snapshot mapping rather than inventing a SHA.

**Unverified/blocked Android/APK facts:** no access to installed/distributed APK revision, APK SHA-256, signing-certificate fingerprint/provenance, device API/OEM matrix, encrypted outbox/backup behavior, or mobile/backend compatibility evidence. The forbidden repository was not accessed. An authorized separate mobile investigator must supply a signed/hash-bound evidence handoff to the coordinator; absent that, relevant G0/release compatibility and mobile safety gates remain blocked.

## 4. Isolated restore and restored connector-token quarantine

**Verified existing procedure and limitation:** `docs/operations.md` recommends restoring to isolated Postgres, setting `BACKUP_DATABASE_URL`, and running `npm run verify:backup`. Source `src/storage/backup-verification.ts` inserts/updates `backup_verification_runs` through the normal runtime pool and reads ten named critical tables plus backup migration metadata. It does not perform a restore, prove snapshot consistency/completeness, compare all tables/constraints/roles, enforce token quarantine or verify tombstone reconciliation. Therefore it was **not run** against the production-configured environment. `docs/runbooks.md` describes external backups rather than proving current provider backups are configured.

**Unverified/blocked restore evidence:** no approved backup/snapshot artifact, checksum, source timestamp/PITR target, encrypted storage access, restore destination, retention/expiry evidence, isolation/egress controls, or restoration approval was supplied. No backup target is configured in `.env.production.dbcheck`. No isolated restore or RPO/RTO measurement was executed; no deletion-tombstone or restored-token safety test is claimed.

**Required future procedure (proposed; not executed):**

1. Obtain environment/security owner approval for a named isolated destination, source backup identity/checksum and timestamp, data handling/retention and destroy-after date, restore operator, independent verifier and recovery acceptance criteria. Confirm the source snapshot maps to the captured schema/revision or document differences.
2. Provision a separate non-production database/project under explicit authorization. Verify source and destination are distinct through provider resource IDs and database identities, not just different connection strings. Deny production network routes and outbound provider calls; keep web serving, cron, queue consumers, schedulers, email delivery, ingestion, model calls and connector sync stopped.
3. Load credentials only from a secret manager. Production connector refresh/access tokens, API credentials, webhook secrets, sessions and key references must not be exported into reports or accessible to application workers. Treat any restored credential/token records or references as **quarantined and unusable**; inventory only metadata. Network denial must already be in place before restore, including for references resolving through an external vault.
4. Restore the approved encrypted backup into that destination with the provider-supported procedure and a compatible PostgreSQL toolchain. This is a future authorized sandbox write, never a command to execute against production. Capture tool versions, snapshot checksum, start/end times and errors without payloads.
5. Before starting any process, apply and verify the deletion/tombstone ledger accumulated after backup time. Reconcile owner scope, revoked consent, retention/expiry, unpublished/queued work, connector cursors, leases and in-flight actions. Fail closed if authoritative post-snapshot deletion/revocation history is unavailable.
6. Keep restored connector tokens/references disabled and isolated even if decryption works. Do not replay provider actions or re-enable sync on restored cursors. Reauthorize each connector with fresh non-production credentials, owner consent and reconciled cursor/revoke state before selectively releasing quarantine; production restoration requires its own human decision.
7. Compare actual catalog objects, migration versions plus source checksums, indexes, constraints, roles/grants/RLS, critical-table counts and approved content hashes, raw evidence, financial totals per known currency, aliases/merge history, owner relationships and deletion exclusions. Distinguish snapshot-time counts from legitimate later live writes. Test two synthetic owners and orphan/quarantined rows with a restricted non-DDL runtime role.
8. If using the existing backup verification helper at all, explicitly point **both** its normal runtime pool and backup pool at authorized isolated resources, verify identities first, and obtain authorization for its audit writes there. Its ten-table readability result is supplementary, not restore-drill proof.
9. An independent verifier records artifact/hash comparison, quarantine checks, blocked egress/worker evidence, measured RPO/RTO and failure/rollback findings. Obtain human G0 environment/safety approval bound to those artifacts. Retain encrypted evidence only under policy and clean up the sandbox later under explicit authorization. Restoring over production or rolling back live data remains a separate decision.

## 5. Owner mapping and legacy-identity quarantine approval

**Verified source constraints:** `docs/BRAIN_AI_V2_EXECUTION_PLAN.md` requires approval of device-to-owner enrollment and legacy mapping/quarantine, forbids guessing ownership of null/global entities, and separates production/destructive approvals. `docs/entity-identity-governance.md` requires durable identity/description/hierarchy/provenance and excludes legacy identities from Explore until governed. Source `src/auth.ts` supports disabled/global/client auth modes; global mode accepts the supplied client-id header, while configured client mode matches registered client/key pairs. This source behavior is not proof of authenticated owner mapping in deployment.

**Unverified/blocked:** no approved owner registry, device-to-owner enrollment proof, personal/shared/global identity classification, ambiguous-row disposition, review ledger, G0/G1 sign-off, restricted-role matrix, or verified exclusion of quarantined legacy rows was provided. No personal row inventory/backfill or policy change was performed.

**Required approval process (proposed; not executed):**

1. Designated security/data owner approves the mapping policy, authorized reviewers and minimum acceptable evidence. Build a metadata-only inventory of each owned object and its dependencies: events, entities, aliases, edges, accounts/transactions, corrections, embeddings, insights/artifacts, jobs, caches, exports and connector state. Source client/device IDs are evidence inputs, not automatically trusted owners.
2. Produce a versioned mapping manifest containing record/cluster references, proposed stable owner ID, authenticated enrollment/provenance, reason/confidence, classification and reviewer decision. Keep private evidence outside Git/report payloads. Prove referentially connected personal objects map consistently; never infer ownership from a common name, merchant, email fragment, model guess, or null/global scope alone.
3. Quarantine missing/conflicting/ambiguous identity mappings and legacy personal/global mixtures; do not assign a default owner or merge across owners. Quarantined rows retain raw evidence, aliases, links, corrections and merge history but are excluded from ordinary API reads, FTS/vector/graph retrieval, model/provider dispatch, insights, exports, sync and worker publication until approved.
4. Security/data owner and the responsible human approve the **exact mapping-manifest hash**, quarantine policy/counts, retention, rollback plan and device-credential registry. Record approver, timestamp, scope and exceptions. This report is a proposal and grants no enrollment, backfill, unquarantine or production authority.
5. After separate implementation authorization, one migration owner applies an additive mapping approach in an approved isolated environment; an independent verifier checks two-owner and unowned-row access, composite ownership links, restricted DB role/RLS, pooled-context isolation, indexes/query limits, quarantine exclusion and unchanged raw-evidence hashes.
6. Promote only individually approved mappings/identities; ambiguous rows remain quarantined. Bind G0/G1 approval to reviewed artifacts and resulting baseline hashes. Keep production deployment/migration, secret rotation, destructive cleanup and actual unquarantine as separately approved actions.

## 6. Gate blocker ledger and verification handoff

| Fact/gate | Status | Exact missing evidence/access to resolve |
|---|---|---|
| Inspected local revision and dirty tree | **Verified** | Hashes, full inventories and reproduction script above; independent verifier acceptance still pending. |
| Approved future-worktree baseline | **Blocked** | Reviewed snapshot including required dirty changes, explicit sensitive/generated exclusions, approved source hash and safe credential provisioning. |
| Configured database schema/roles | **Verified, limited attribution** | Catalog session and migration filename equality above; complete object/source-checksum reconciliation remains a separate gate. |
| Current production backend/DB binding | **Blocked** | Authenticated host receipt with current alias/deployment ID, Git SHA or uploaded artifact digest, deployment-to-DB binding and nonsecret effective config. |
| Restricted production runtime login | **Blocked / current configured login unsuitable** | Actual deployed login proof and role/grant/RLS evidence showing no DDL, role ownership or BYPASSRLS; independent negative access tests in authorized isolation. |
| Effective host capacity and cron | **Blocked** | Authenticated deployment/project runtime, plan/region, max duration/memory/CPU/concurrency/connection quotas, enabled schedules and execution history/capacity measurements. |
| Isolated restore safety and recoverability | **Blocked** | Approved backup identity/checksum/access, destination and egress controls, executed restore/tombstone/token-quarantine evidence, independent comparison and RPO/RTO. |
| Owner mapping/legacy quarantine | **Blocked** | Authenticated enrollment evidence, approved mapping/quarantine artifact hash, designated human/security owner decisions and independent isolation matrix. |
| Android/APK/signing/compatibility | **Blocked** | Separately authorized mobile investigator handoff with installed/distributed APK and signing hashes, device facts and compatibility/security evidence; no forbidden-repo access authorized. |
| G0 environment/safety approval | **Blocked** | Independent report/hash review plus responsible human approval of exact baseline and resolved essential facts. Report completion is not gate approval. |

Verification performed: read-only source/config review, nonsecret configuration comparisons, read-only configured-database catalog transaction and Git byte-hash capture. No application test/build/restore was run. The final working-tree/index/diff hash comparison is recorded below after writing this report; independent verification is not yet performed. Only the authorized report may differ from the capture. Any external concurrent changes must be reported rather than reverted.

## Appendix A. Full byte-hash manifest

Rows are `[repository-relative UTF-8 path, file|symlink|missing, SHA-256(payload)]`. Missing payload is empty bytes. The manifest is exact input to the canonical serialization in the reproduction script; ignored nontracked state is excluded.

```json
[
  [
    ".env.example",
    "file",
    "12866e9fc9038c967ada9cf6d4dc249ef2e0edf0bed5eaa9178f159524321d73"
  ],
  [
    ".env.laya.example",
    "file",
    "ad7f84ebf8458ee69c4d2d20454004756a35b97739fc278c8d0e8f62a39c93fd"
  ],
  [
    ".env.production.dbcheck",
    "file",
    "cd3b4f92c2497c692ca342e1dfbd0074454018697cdf301c5500d64eada0b5d4"
  ],
  [
    ".github/workflows/production-smoke.yml",
    "file",
    "e75c532b79fc97ea9e1bdb30425384807f869b35cff1d4e9714d03c23af196be"
  ],
  [
    ".gitignore",
    "file",
    "cc7c52e1e4d0e745fad8628ae1a16505ed6609736d1be1fa4f5c8a815b5eaf80"
  ],
  [
    ".vercelignore",
    "file",
    "5d2997160aef00c3eecc7901c62fe4746de1c71fa0aee5f615281560ff2e890a"
  ],
  [
    "AGENTS.md",
    "file",
    "3cf5b08de12fa6b0ea229a994951457e08ea5fff4a503407aef93567c92f96b8"
  ],
  [
    "README.md",
    "file",
    "39ecfaa2a072fa18210e947d214c8f557fcbe8131ebac2e54ed3ef924bf0978a"
  ],
  [
    "agent.md",
    "missing",
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  ],
  [
    "docs/BRAIN_AI_V2_API_CONTRACT_v2.0.0.md",
    "file",
    "7ff0fb5fe0209513bce536aa067779457b5a2af9d0b5ec14c81f35ad5248eeb5"
  ],
  [
    "docs/BRAIN_AI_V2_ARCHITECTURE.md",
    "file",
    "1ca457395cee00d323743cdac6b10821c45b0750d5c4a593760bbf42a51ed9e2"
  ],
  [
    "docs/BRAIN_AI_V2_BACKEND_TASKS.json",
    "file",
    "8effbfd79a23cd2621e3cb89c89e0311aedd982eb87f1a8a438f4c9c92ed98ba"
  ],
  [
    "docs/BRAIN_AI_V2_DATA_MODEL.md",
    "file",
    "273f0d03da7104364072f1b2585a523a1a6f8523277a358d97fd2b2b2ce09a23"
  ],
  [
    "docs/BRAIN_AI_V2_EVALUATION.md",
    "file",
    "94eb844cc0b1eeca5cff8679d6a3819cd358e58d7fb4a064116de21c0fcc1acd"
  ],
  [
    "docs/BRAIN_AI_V2_EXECUTION_PLAN.md",
    "file",
    "2f2ad98eb8221e9140c67dbb60da09ae5c942b58932b9f5933047e39a9ea73df"
  ],
  [
    "docs/BRAIN_AI_V2_MOBILE_TASKS.json",
    "file",
    "6b61aba2fbc4596224e18be752ce71e6f783da23463de4921ab6c0c556861048"
  ],
  [
    "docs/BRAIN_AI_V2_PLANNING_VALIDATION.md",
    "file",
    "1a357ab82ec50c16ebc4f21170689f85849767c05de9b77ec4eba51c163182ad"
  ],
  [
    "docs/BRAIN_AI_V2_PRD.md",
    "file",
    "68f717778003c91a73b80fd906d6696e2dc3fc60a1e4229445cfd1e00e3369e3"
  ],
  [
    "docs/BRAIN_AI_V2_TASKS.json",
    "file",
    "154addaa651c8f6e6fc8521578df9454cf73b0a64e588d20081b078722c8a4ef"
  ],
  [
    "docs/BRAIN_AI_V2_TASK_SPECIFICATIONS.md",
    "file",
    "02073fab3e4dbfa383cbe0d3a00db8de1ed01b27ec25e7feab4d1df59fa00f06"
  ],
  [
    "docs/agent.md",
    "file",
    "b8d4534cfa445a7d51c8e73056860d08e573323cdc4dd2ba292735357b1327ca"
  ],
  [
    "docs/api.md",
    "file",
    "0dfdfa3ca2a1cd1417d7d450bbfe0ef92434a497612ee1b4439ef2d1100d21d4"
  ],
  [
    "docs/architecture.md",
    "file",
    "4900355661a3a953efb0d9cfcb447c8021fda5cf2fd51250e248f29a36977d09"
  ],
  [
    "docs/backlog.md",
    "file",
    "6dec1988405a9d879ab069d18e2a681e0f71f573d205a78db34feb0b3df0fefb"
  ],
  [
    "docs/brainia-next.md",
    "file",
    "7ff657acf277966dde7f9991ec9a6345b8b7589bc61dff1adde6bd86e1d44642"
  ],
  [
    "docs/changelog.md",
    "file",
    "367e447b95c5efc4305386e30aad7b08e3aa924fa6e707960e8f866c4c14804e"
  ],
  [
    "docs/domain.md",
    "file",
    "521c6418319f5294aaceb58dd50fb1821847acd33e42189ea60dfdd3719166a3"
  ],
  [
    "docs/entity-identity-governance.md",
    "file",
    "8de46cfe1649fddbbd4226d5702914101593301e4719c2b053145e22a692a651"
  ],
  [
    "docs/future-features.md",
    "file",
    "47664e3f4b38476796c44acfd069ba6dc7f4b716310040d8f7361d156828ffce"
  ],
  [
    "docs/future-roadmap.md",
    "file",
    "9af55dd42b557c1a8c358bc70ef66609b01c9cd713e283f8ad2b9cbacb17cb6e"
  ],
  [
    "docs/ingestion-flow.md",
    "file",
    "ecf4c23473be6045b5753951c4c185043b9e2dd185f7b06437e235e02001f60f"
  ],
  [
    "docs/insights-digests.md",
    "file",
    "5a3d4560f76895b7f238e9b292ab83d6d71c481b9a5684813ee3a2cc32468a20"
  ],
  [
    "docs/knowledge-platform-action-plan.md",
    "file",
    "647178d0e33ecf0c8fc46e8a38041408ec4402dac269b9a324d4d245046ff74f"
  ],
  [
    "docs/laya-local.md",
    "file",
    "eeb907c6d5ceda95a29149da19215ab667da87fa5cfe53e7f221e95db66d8332"
  ],
  [
    "docs/mvp.md",
    "file",
    "9f3d16662d80175e1a6c7f7330e85fbcde7d3a83f8b9163ce7b480d73eba4efb"
  ],
  [
    "docs/operations.md",
    "file",
    "21d1bea2a55241716a19bdd80e35ab370aa5a3ebb9f4b7b4e693afb8b9bd85e3"
  ],
  [
    "docs/postgres-schema.md",
    "file",
    "5825cd89ab4da4b942c0f938db76ab3cbd5f855409e2bcce4713f358d65b6fab"
  ],
  [
    "docs/reports/laya-calibration-2026-09-23.md",
    "file",
    "e12ae2742ac23491e96561e16868b737beed014b462c569743ae21bec387b7db"
  ],
  [
    "docs/reports/live-event-analysis-2026-07-13.md",
    "file",
    "07b61271bbe7ffdc9b1868570676b5d734749439f98df80c42eabb9ab94fc2ef"
  ],
  [
    "docs/runbooks.md",
    "file",
    "4034f2c92addd8dca82dfa21d8f17511fa58477b1e45aa69de08cd2d7042d3ec"
  ],
  [
    "docs/semantic-governance.md",
    "file",
    "0950befdfac868065ab9de671435270815bf414fff02dbacf7f6ce8fcef462a9"
  ],
  [
    "graphify-out/.graphify_labels.json",
    "file",
    "640bcd18d077a8dd7b3b0aa0deb09a92b80b4f99cc2b3c24b5df386c53752ab0"
  ],
  [
    "graphify-out/.graphify_root",
    "file",
    "cdb4ee2aea69cc6a83331bbe96dc2caa9a299d21329efb0336fc02a82e1839a8"
  ],
  [
    "graphify-out/2026-07-15/.graphify_labels.json",
    "file",
    "5358f2fdf450bb288498e0c0cf2e9dee641941e82a7151b49eaa56ab81b2c58a"
  ],
  [
    "graphify-out/2026-07-15/GRAPH_REPORT.md",
    "file",
    "4bb7da82dbd92529486e16ddb25c8f82542d9a0c815b1167caad3fff9a79c74a"
  ],
  [
    "graphify-out/2026-07-15/graph.json",
    "file",
    "5a35bd9b4e931e980b6165b77101abf0219e132ba85c7bfb6f0bc455d0856a24"
  ],
  [
    "graphify-out/2026-07-15/manifest.json",
    "file",
    "f146f077b53314f13f53d6606879e4acfcbd66474a57bc8e6d8adf18fa2f3fa6"
  ],
  [
    "graphify-out/2026-07-16/.graphify_labels.json",
    "file",
    "26aa333bb7141547f205c237c7af7116ce5814c23f5d6f265ef16bac5bd42a5c"
  ],
  [
    "graphify-out/2026-07-16/GRAPH_REPORT.md",
    "file",
    "fcfd100e60fb1efd44407eaa20795c867d3bf72ee7e3bb6acfe4be8279a85722"
  ],
  [
    "graphify-out/2026-07-16/graph.json",
    "file",
    "83fc1c451cd7f06dbe6766a11df30fc56668bc81754f00d71892202ab0f8dd7d"
  ],
  [
    "graphify-out/2026-07-16/manifest.json",
    "file",
    "d8bc4c536164500f5325b2a8117d7e46c5f9fff15a81cbe819fa936f29edaba3"
  ],
  [
    "graphify-out/2026-07-17/.graphify_labels.json",
    "file",
    "62b98a03efb78e9a1aaf32b15627d15b43f4ee0beab383c1eb7567a0cedcc979"
  ],
  [
    "graphify-out/2026-07-17/GRAPH_REPORT.md",
    "file",
    "9e48ba877231b05e0ca25e1cd973b2438642c1c3d8e340bf232b39250d83345b"
  ],
  [
    "graphify-out/2026-07-17/graph.json",
    "file",
    "ca86820f2b716d2f5152c32f161d434c6d3e610d52201448c6f40aa0b7cfb077"
  ],
  [
    "graphify-out/2026-07-17/manifest.json",
    "file",
    "2c04b444ac35d6e2aa8644cf21e683e60061e19351cf2f584b1dc7b1e9fc4f5d"
  ],
  [
    "graphify-out/2026-07-18/.graphify_labels.json",
    "file",
    "62b98a03efb78e9a1aaf32b15627d15b43f4ee0beab383c1eb7567a0cedcc979"
  ],
  [
    "graphify-out/2026-07-18/GRAPH_REPORT.md",
    "file",
    "c230667c266b0f9eca8b80e0d4b012dcaf16859e5797456b1444aec00a45c633"
  ],
  [
    "graphify-out/2026-07-18/graph.json",
    "file",
    "a63665130d089bcb28f680482178e3152cb9df07deb80db6a9f76c808188536e"
  ],
  [
    "graphify-out/2026-07-18/manifest.json",
    "file",
    "6435aea3fd4988acd0982e23d03eff2adc393eae3f4ff71b85ab3eee86d928f2"
  ],
  [
    "graphify-out/2026-07-19/.graphify_labels.json",
    "file",
    "a4b0cd53b8ffef7f835ba3339395df2b198d0a6aeac5b042f290570b6edf7d8d"
  ],
  [
    "graphify-out/2026-07-19/GRAPH_REPORT.md",
    "file",
    "338a24ac2375d698e4fd428fa10067d2ad426ca8ac0d6398d3983954ea54f1b0"
  ],
  [
    "graphify-out/2026-07-19/graph.json",
    "file",
    "94e41302e7e9874b91944286e9e1476cc37a487b82779db361b7ddaa57344664"
  ],
  [
    "graphify-out/2026-07-19/manifest.json",
    "file",
    "d091ec40bce1c892ebbb71db725c84667cdfd367d6667104c9a406b35bc6240a"
  ],
  [
    "graphify-out/2026-07-20/.graphify_labels.json",
    "file",
    "4418d850d1240dff1e0cf4fed9ef780f7cf974996840d0122504648debfdebca"
  ],
  [
    "graphify-out/2026-07-20/GRAPH_REPORT.md",
    "file",
    "02f964ba40aea83baa45d65d8fa2a1a532e0d6225d8ef39aa6ecbad7ce28170b"
  ],
  [
    "graphify-out/2026-07-20/graph.json",
    "file",
    "15954bc21381a0ca9789b64360f070ce1dc192ec720e73d75db93da0141cbfe8"
  ],
  [
    "graphify-out/2026-07-20/manifest.json",
    "file",
    "70c06592d83aa8f444874961999e4f1aa4e8b0f348ad4309d7a3118b7e45dcc6"
  ],
  [
    "graphify-out/2026-07-21/.graphify_labels.json",
    "file",
    "30462107a81fd001aa0ff9d5834e69f63a1d0d4d1ff4991e8e2fc1ba758f9b02"
  ],
  [
    "graphify-out/2026-07-21/GRAPH_REPORT.md",
    "file",
    "853a4fb04b1b600d6ff922ac6c245e849b4a94590d6dee77ca103995aba4114d"
  ],
  [
    "graphify-out/2026-07-21/graph.json",
    "file",
    "2317be52cbb465e60c7eba6511fd925e9aa3894679edc5983a685ddf408fe3ab"
  ],
  [
    "graphify-out/2026-07-21/manifest.json",
    "file",
    "b86022a65c111b54d2ba1b3e9fd420ded278611ece0e020c563b9b4f5db792e6"
  ],
  [
    "graphify-out/2026-07-22/.graphify_labels.json",
    "file",
    "a4eac1fb35a55f140d08d84e68c4396080eb36eb5afc4bafe0d4152ddf57e4f9"
  ],
  [
    "graphify-out/2026-07-22/GRAPH_REPORT.md",
    "file",
    "f96966f7c8141931895b33f01d994c243bd980ce7487c709011484f9e90bbbaa"
  ],
  [
    "graphify-out/2026-07-22/graph.json",
    "file",
    "7a9f531f20cb9e381832b88be5e8c026e4ffb94d80ea41170ad2c46eda6dc1ee"
  ],
  [
    "graphify-out/2026-07-22/manifest.json",
    "file",
    "8b2984a8991cf1733a0ad39cb2c602101c8f7f6ffecb145c7d533b39e133e3ca"
  ],
  [
    "graphify-out/2026-07-31/.graphify_labels.json",
    "file",
    "1b1126e0273c0f6549b7e798b9113827c1d7d759c1d1155df288fc57b0d45a7d"
  ],
  [
    "graphify-out/2026-07-31/GRAPH_REPORT.md",
    "file",
    "db59f7998c35d8b11fae76eb5d011832bcbd9658f62e0c30b81dd5f0876e1dd1"
  ],
  [
    "graphify-out/2026-07-31/graph.json",
    "file",
    "d312671f0527a3c482bf8ea440e24dcb5989b7832ebe18c6d0763236d2f85eeb"
  ],
  [
    "graphify-out/2026-07-31/manifest.json",
    "file",
    "898be167121dc0be7d282ff28e03529151aca783bd5489d71b9b7406badefd46"
  ],
  [
    "graphify-out/2026-08-01/.graphify_labels.json",
    "file",
    "d43f2ec7ff14d78c4c4aa3573d4b2900016e3b55b065d8a1a0dd633d14b48820"
  ],
  [
    "graphify-out/2026-08-01/GRAPH_REPORT.md",
    "file",
    "08ddae021c840372e0b05fe1a1ea1045d7c38cdedb163c4357bdaa705047f4a5"
  ],
  [
    "graphify-out/2026-08-01/graph.json",
    "file",
    "2493a6da6dde18c8898e1a59889a02736a83ffceb9a4cd79eb301e754440877f"
  ],
  [
    "graphify-out/2026-08-01/manifest.json",
    "file",
    "9ab66ea330af3266e4781db940f3d01f7e01b51b3f90c2d2bb29c11c7c8920a7"
  ],
  [
    "graphify-out/2026-08-02/.graphify_labels.json",
    "file",
    "560c958c7d8e07f0e09594743ffc141513dfd7721ccb2618432b12e127d925e5"
  ],
  [
    "graphify-out/2026-08-02/GRAPH_REPORT.md",
    "file",
    "e465aeabeaf20a18a4495a603a7dd39c87c9bc8b579cf5d35066fdda43b4f770"
  ],
  [
    "graphify-out/2026-08-02/graph.json",
    "file",
    "2ac6fa15eb0ed4c1e12fd31bb0576ab21a4fd500278842e79c8472b458181a08"
  ],
  [
    "graphify-out/2026-08-02/manifest.json",
    "file",
    "daf54440a2d4759ea2524f36fad49233a095e9f388c0e246b6a6058ae0ebcf1e"
  ],
  [
    "graphify-out/2026-08-03/.graphify_labels.json",
    "file",
    "486b06beb69f2845540378f4a21a3d5754f5cc7d2a83f3354b775f1322f1a8ae"
  ],
  [
    "graphify-out/2026-08-03/GRAPH_REPORT.md",
    "file",
    "a6ecbb9d3b7785fdae712187cfc8b7d7ab908b415e547c9ff7fde9f92162f3e8"
  ],
  [
    "graphify-out/2026-08-03/graph.json",
    "file",
    "489be780230bbe06db080fd15a710ee7af8b4cbc9ce0285cda5810bc6e8e0caa"
  ],
  [
    "graphify-out/2026-08-03/manifest.json",
    "file",
    "6cbd3c5c1702c34668872981b53a529131c443d5144e93ef0eddffbc0f80156f"
  ],
  [
    "graphify-out/2026-08-07/.graphify_labels.json",
    "file",
    "0a40b579e026ac98db9e7f0d199533875d570603505fa37bd20db11430a75901"
  ],
  [
    "graphify-out/2026-08-07/GRAPH_REPORT.md",
    "file",
    "7d09640635e822df9695385026e55080e8cd613a1a0a3ee76f6677500df11021"
  ],
  [
    "graphify-out/2026-08-07/graph.json",
    "file",
    "cf0b9f3169b7e5ce00ca7b4fe7f9323e51949f133f549adca3075b1abdbc89fe"
  ],
  [
    "graphify-out/2026-08-07/manifest.json",
    "file",
    "e5dbeddfca9d1a504218b727f735d80f6e3a5e0da11934ffcc413d41963c07ef"
  ],
  [
    "graphify-out/2026-08-28/.graphify_labels.json",
    "file",
    "0a40b579e026ac98db9e7f0d199533875d570603505fa37bd20db11430a75901"
  ],
  [
    "graphify-out/2026-08-28/GRAPH_REPORT.md",
    "file",
    "b9736a9fb321324546ca23363f83c68637f1a0ebc07ec62c3f203a446eae4204"
  ],
  [
    "graphify-out/2026-08-28/graph.json",
    "file",
    "e52d8c930baf032af5f3b6861ec34d65f952527c52ebeaee22255ae7c5c113d5"
  ],
  [
    "graphify-out/2026-08-28/manifest.json",
    "file",
    "5dd1b7fe6f77516480d4b72eabc39b94a7e9791cb0bbf13047c367ff85de30e8"
  ],
  [
    "graphify-out/2026-09-02/.graphify_labels.json",
    "file",
    "ef7c8b44a4dce4b6f490cc0813cb3cb6cdd27cd5380f05652227b734ecffa156"
  ],
  [
    "graphify-out/2026-09-02/GRAPH_REPORT.md",
    "file",
    "5c8993eb465f8d30aa93e75ab8a38b0931609f2dad7fd1436049537c33734428"
  ],
  [
    "graphify-out/2026-09-02/graph.json",
    "file",
    "162f7c8440f46787bc8bf67cb9f22009718d1576c23741d302671f59edf826d0"
  ],
  [
    "graphify-out/2026-09-02/manifest.json",
    "file",
    "b8462f34a2f67cd3851ec6133600a250ed3e0123c70ab81d6067546b9fd76679"
  ],
  [
    "graphify-out/2026-10-02/.graphify_labels.json",
    "file",
    "2353b044ffbad10b93c6eef971cc16b7808fb5759b46feb3df3164907fc3f521"
  ],
  [
    "graphify-out/2026-10-02/GRAPH_REPORT.md",
    "file",
    "c5710c1141f3146779e939b43204817642b248a0bc51fd03e5fc15af192fd1d8"
  ],
  [
    "graphify-out/2026-10-02/graph.json",
    "file",
    "61c0a79299e4df3976d7bf14d2e06afde9de4a749f2d344f757684000154a319"
  ],
  [
    "graphify-out/2026-10-02/manifest.json",
    "file",
    "b05a86757d401fe96365401d7595274e0fb584c081841e7604c40834c6525717"
  ],
  [
    "graphify-out/2026-10-03/.graphify_labels.json",
    "file",
    "bacff4acfbcc6edb63be63de7211b910e36065ec9ca8928b5f368cc749c01311"
  ],
  [
    "graphify-out/2026-10-03/GRAPH_REPORT.md",
    "file",
    "1220f29f661c5dbcd1dd68b3d501199d0568a5ec56b8541133e3f78775929823"
  ],
  [
    "graphify-out/2026-10-03/graph.json",
    "file",
    "087fc55180d19a8700e3f5a1fa1a0a8e036bc3a7d33e2382f209d1fb0a21bef3"
  ],
  [
    "graphify-out/2026-10-03/manifest.json",
    "file",
    "a996f228926dcf0b36de702546459ce86956d4191c34ab2dc67b7b4769d4ffd5"
  ],
  [
    "graphify-out/2026-10-04/.graphify_labels.json",
    "file",
    "dd10038ef0e22f5fab43ca991754592d1980490093550e5f4d9c8d3669bb6e54"
  ],
  [
    "graphify-out/2026-10-04/GRAPH_REPORT.md",
    "file",
    "7582400ac8ca36a02d0370228fbafd4f962057bebb1ae6f25f49c1d89f07251b"
  ],
  [
    "graphify-out/2026-10-04/graph.json",
    "file",
    "cb1fd123bde626c4ed78a0cda6b216840e1a4d0e493a02153643e146ade11157"
  ],
  [
    "graphify-out/2026-10-04/manifest.json",
    "file",
    "200aaff881476a6fb11675aff360264a119fdf519f694487c6f5773df3e11514"
  ],
  [
    "graphify-out/GRAPH_REPORT.md",
    "file",
    "81b3709297e9d8c16bb2ed8678ecf6b5064de843e222279588fde492b1d37b5a"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/01fbc8b5e81828c3d214f8ae82cbcb37b51be4b683243f9bac628456cb26f418.json",
    "file",
    "08861bcc4decaafbd743ab23230f79e7d656eb4d8d1075aef63c58e7b39e10b2"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/0a2793da2a824775f0e593861d3d842f277476a29b73c394ea1216f68867ad4f.json",
    "file",
    "2d16b14d95a829e91e400cc882f461cb9109b04052193c0da4e4205285c97c12"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/0b6df146e8ee301b88d154be8ff0a8013f33f08e5e10cc55598c76f07d93bf0a.json",
    "file",
    "c4ffaca0f8e0afab3b592df11c5a0b7b0d1b8630e275924a8287f381ff19ba60"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/0d8fd99908cf52413e1800975d55179c74c0d9269c7426e98024fcb63a808d4b.json",
    "file",
    "cbe70d3993766ed873cf4232f07f46ac66c5ea4c39d5c651cd1554a4ac513899"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/154c59a137c41557c9126258e39b4585713c3981eca188c51725d8051a1337d6.json",
    "file",
    "e3d45e9adffdee9b2852fa975f7c581fec8483b1c42e19cd5bfa35b1e4da9e14"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/1581d51c13d4173b26a7b4622d1f289c9f4f32a6e7ec1d9a9bd32ef56223b6f1.json",
    "file",
    "097b4e67506fca5313fad87903c72858c2cb5c064cb9ebabc0b28230c06fb914"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/1a11251d213617917aa9468811d8617ce476d1cbbc308b05d2d18b0e19705eb5.json",
    "file",
    "cd4068a7f2302326a9646096b73c0d7e40980f31fd67a75966bb5cfaf7bc34f2"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/1df4ede6f6baac86246d4babe2c4278876c143b0193dbb2cb5a8332e694525d2.json",
    "file",
    "1772e13c76711541422d815a514cfca23935f87bc5543eec7bc7f32525d305b0"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/261b092546a1120ad4347deea81c7d206c820e845a84d84bb137d2268eb926f7.json",
    "file",
    "800d75b22b68993ff0086eec453515b0bf36632edb7f67615c22aae0e0a26080"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/266cf9b70edcd3aea2d6665ec5a4b70c0b0b3254d8a6bf2d1e1fa1ea3911e4f3.json",
    "file",
    "d1b34ce2f8fbe8bd37fdc21447151d8a67c13f8904d5ec3486db8c3cedc9ae6e"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/28799aff958409300a828a73bf84e742d96bd97ff8d1aede45481d9929053912.json",
    "file",
    "52f0ce097ea370143ea959c298011bc7292241c1a6d2090a4b7ab2e1237c97b9"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/2b94045d0b9be04f3dcc80894f886f019fcdd014a9df3d167b9d9baf41dc4f07.json",
    "file",
    "952892c2b0a9a67f06c06687e97880c5b552fa6aeee47ad1e760a4a7f9450ce7"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/30d1e16ae8611b104e4bfe51d12de0f52c80dd78e1942855a271d81dc30f07bb.json",
    "file",
    "8da36cb5956c2fcffe6789eee09c5c8e25848fbac5240601cce3321e2117d7fd"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/35e54e16819f582bd39570df539be819e78a8ba106a5299769112ea7b58a61fe.json",
    "file",
    "55b712fe86f9250331d87112f878fe19a3bd302cdaff02538ce654830de6a6b3"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/37c72687d5a84e9e42c1c8121c8b22dd1405555ba8cec1e2f04281925e66c0dc.json",
    "file",
    "1532bc3e526adf497786f1e96b1b73295db630edb260e3f43b46d55befa9fb57"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/43e3de67fb68af02a7fec85a4088821199e4255b2ca76a7ca6d3038a78dc115f.json",
    "file",
    "9dd10315831c0c90e20bb51772cecb0340e38f82334bea98fc54f95a2234f144"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/46f583dfbd198ab1b25b0e125094fa0e21f9de306889c446f2a8b73f645a6384.json",
    "file",
    "d8fa2b3531e0f3bc2b13a3e6518d8c6ca49dcf2442dd0cc82419ff01df76fbea"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/4711b1d980b0e9a1145ec943d0418444c3fd5fd8d1ec7f684f62e6eb4225a23c.json",
    "file",
    "f7786a484a1fcb5e84029cb452639f61d4253a93f730bc7bf894442b566e3bcd"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/4865520ad4dff333d1414fec6cdb1db3c6b5677fa5885d4ad86d2f1d525a28e9.json",
    "file",
    "00b822fd1424a1e446c38c87e327edc3d529d5de5bebe3b998fe252536c11d0a"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/4a1e2c83f2a0a19df944aa301d025ccb168bb5476400075e42b0879bd31d6d0a.json",
    "file",
    "1a5916360c1bf95f1b33ee5683eb65ac45c49e68beb3df39c766adb1a6b0fb35"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/4b4adb80f35119ff5e5d6330b257fe40d1047a12f5c9bbe284ca58350a32f935.json",
    "file",
    "de82d72610feb5b1778c4cfa2f75acbb0011ad09264e30ad784affb9dfd1c733"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/4c7a91f3c4432c283d7e32d6975509fabb34c2bf609239cbf060a1cc6bd119b4.json",
    "file",
    "d6abf5e4a6662878da0e96c0bb1adae178d32fd6fd96251c3ccd9a1cb3fbdd3a"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/4ce7061360d8303994201e6e339c3476d595fa92c7a940dba72a075fa023910d.json",
    "file",
    "08861bcc4decaafbd743ab23230f79e7d656eb4d8d1075aef63c58e7b39e10b2"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/516882d43c233a2a8ff8f4edb32e11cd9c63edc2755a3fb835f2f5e0779b4ded.json",
    "file",
    "a2fb5b94275d3eb24d6773628f4826d3cb0b0d9b9a6585209a577023c3f74274"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/51d25a37fb1a9fc70a61e8c520510f3ce1fefc9547e0fff76c8e6601d4145f91.json",
    "file",
    "448736b20af474cdbc919cf750a2418c44a66aecffeafc309cab0ffaaffcf36f"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/56607f0f7086dafd705c608ef54d1fba3e5e1e5fdad0f24d26f5fd184c869a86.json",
    "file",
    "8f8d490352f2e3578a31729647ce5b6ac009b626032235e86929f78640a2b3a0"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/5ac598053acf9b47bdde0d0e37eed6a1b8df8d703cb2f167ae1fd44dfcf6363c.json",
    "file",
    "08861bcc4decaafbd743ab23230f79e7d656eb4d8d1075aef63c58e7b39e10b2"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/6288123027904b7a7fc88369510a630627734f3a30b1a205aaccc8b33472f2ea.json",
    "file",
    "097b4e67506fca5313fad87903c72858c2cb5c064cb9ebabc0b28230c06fb914"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/63d1d02f5a9201f17c7d3c34c9f1735dc4342714768dc51401af07474a20cba4.json",
    "file",
    "158b1bf317818fdc80711470a2df7155a5a9fce747879a6ff2e52e54ca35534e"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/6841023246322429964546a3da5b008ad105f82ce62ef5c7fda8f20fed8aae1d.json",
    "file",
    "f31094a7689eb93a61a3854487cb1002213fd6af9bcee264a74ffbbb04e8e54f"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/68c069939c817c852ad7919de2014bd90c9129fec97b3d61e36f0812ac3c330d.json",
    "file",
    "8a0b43d5802cfcac27b5ab6a8bcd6682bc9494430ebec5b21337a7cf4c7f6ded"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/6c58783058f4c10c586e73cd074ef3a57817fe2ffc01b5fd85dabbaca9936f6a.json",
    "file",
    "5cf6d7cc9b12843a4d2158600cf651ea521cc6b53ffb630e373f48e88000a261"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/6f042d753bad8fbf603a06b5b4990f2868adfecc4abbde87a1ff7760864a3c32.json",
    "file",
    "f983e344ac85c1ed09c86076a6c73f2cc45344b990e612140b40a862f36545fb"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/71d03f81b27191681ed318b8b324baa0c6f58af65c4c6e4cc3fce1ce35609a6d.json",
    "file",
    "05f19f12496401c73d1c6f08e917caa5ee723332d64f2bd7f96e41b27e2c2165"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/7a3c980752b71415dbbf3815dc2affb2882274b05ee7406d1747b878e0f2401c.json",
    "file",
    "233dc69430c67302190709e6a7ddc0b4ba83420cb7583bbde3ca175d214e76a8"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/7b3c2485eb86e9ce16518cb97d8b0c402131fb03ebb97cf9184b71a2a256e596.json",
    "file",
    "7e5aeef58bef7edc86961d35669c9d9cdd7062e854e6f045456a4d31c4bc5c23"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/7e042404844d0f1bb989c0fa3a74116d953b060ec4a39dce2be5bd530c2d041b.json",
    "file",
    "1cd73afe29eeacf0153b648b1a00de5c366558609547ffc25966db8a5df7659e"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/81a6453de904bb26736de39f82956e230d6d0ef848531c01cb82c43b130b9bf0.json",
    "file",
    "c179f0bd51270fe4e54d2ae81eee2124d866c8db2bbcceca1388afb7d966df0c"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/83b2d6da5edad53823fc1bce62aceacba0a6d35bd6a2d25de07869c7a5872cd1.json",
    "file",
    "f31094a7689eb93a61a3854487cb1002213fd6af9bcee264a74ffbbb04e8e54f"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/8ecbac724a95ff9ed3c22f24b2d44575cc785cb2b2e70cdc9ba68f93f14e49d0.json",
    "file",
    "60b779a7a55b1a67265232d74ffd8b4703e4d2306d732986140209b4f3616e41"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/9e9830048a16bad7e8c01f5a1454a89416947efb3e00fc2d601ac3836a311681.json",
    "file",
    "8ddafebae41bfc3af6a74d3329d957c313699054c09919ae5425370d37a740f4"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/a90ed0846b0b79b0828aa34e0234d59ba6cd3a0294b2ff84b8d403ababe6ad35.json",
    "file",
    "96eed5234e7ff3d3db69d9b6701b073ab51f5d1232f4740dee1d0d7af36561cf"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/aba1a68802c901e7b0cc92f347265e52536d317b193e6eaa3e6edcce9a5247ff.json",
    "file",
    "99616da75c05085200b7ab523346d058e053a66f592ea7d710e7807875358356"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/ac84aaf8bbd19db8c426a965dee421e6241a8c458823411bc73b42d0761c78fb.json",
    "file",
    "b1ba1e77242e546b015227d035ee5c0847822fae11b4047db6c13cb6c28afc2f"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/ae8ec642a13057516feda2d69bd1186696832b4f36fe82fc53b835f3842a5a6a.json",
    "file",
    "469c1a2b0798d8f6c40016b15ba0f95ceb1089f28896dd97b4e5917992658c5e"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/af429a19cdda9b97fa5e8997b3637e18c3108f76913c7738f907c6baaeba4be6.json",
    "file",
    "5864d3743a652a9fd5925fc8bc56727c85f84bf12a1ec752ea8e510a391174b5"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/b09007ea54d7047cdb1844c94fc170b5356c9e3e0d528d0e355e8b94a71c874b.json",
    "file",
    "feb3227f3dc013516e567d582c7957201eb212de72caf566c7bd7e4f8add0bf0"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/b2f731284e5a5e7d40947abab8fefc26f333f131e11bdc80c2c6cac284c1c7be.json",
    "file",
    "522cd22b18a452d3ccc2eed9da44b3c0ca6bafbda9cfc9ac2aa70d52dce7ac71"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/bb39f5758be6cdd6d6b220805ca64ee297668f0dd7262de42a72e71cddd1dedc.json",
    "file",
    "2fd9c409451e01838e2f7a23dc19bc6c5701c7d58d11cfda4f716c21afc73877"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/c39522cb1401391d9e08d51e5cd32ab19fce4c7bd65ec5d6d77ba443aa1bec08.json",
    "file",
    "19a65ef5531513ead6f6ee5c408a29f15d8794024df15a8870d49f43f7b9b666"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/d2a2835d80b013fbc26e820e6b038368b324bb73ac56130c700a46f8d735aef1.json",
    "file",
    "d893426b0c642de1e263cd4d7b2755a69cbc5f6b5126d3b7c1b60450cdfedbc2"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/d428d6c335701c51c1eb4804d6bb8d0c2ab851837410ddeb06dc4f6861834555.json",
    "file",
    "3d274d222c0f33edcbafa75f37cf26cd6f4e488b458ebd7edb06c59f6924b46a"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/d94024aa03faa7f59c1edd2e05edd6b6f3df1e022b1d2b5207e9e522a60fc69c.json",
    "file",
    "f1830d3e25cb4f61c2cc59713ec05de793dafe8138717d73a786c4c017024621"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/dab4f22860991dceda12e02b664b3d20d16af0c0ef032a2e956604e609672de4.json",
    "file",
    "c91afd386e89c63af361b08ad3817708a8469a39ae0b15f586957c817440540e"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/df3190e14f9b662844d298865186e600fae9654e2a1710bb09bc360c3a3f6ee2.json",
    "file",
    "6e55051840707dbb1f00a09142713edbe16df6331bec23814181f5a49d320539"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/df3e0d23f0a6943b74222612c7a938110d9f56eb708d624cef9a08f498eded4b.json",
    "file",
    "7803b7260bdbf55c0783fb83d2b4a356870ba87067c285ce0a8bcb44b9ae363c"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/e2f62a376ae86e9b6567fbae2ada6ba3ea1ebdd8ac4de31517b845c38e92d612.json",
    "file",
    "542a8b4c81107db62191200f558f814618c7486413f247ec9a2af85d20833791"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/e3afa4de95b441a7038d92ec34c65b0e02e8bd07d03eb6ac175d09caf39c482c.json",
    "file",
    "07871c50f8c7dd7c0f62bc9f82826925435d88863818ec95c096d8500d73e04a"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/e780ab8a7f81c37c9e3648d1179e54317b0048a5474f51145ccf8f4c8a2cd941.json",
    "file",
    "c91afd386e89c63af361b08ad3817708a8469a39ae0b15f586957c817440540e"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/e80d0c4331faad3e1c7b4f142ffc87cf63d9919ebdad936e78f282dfd10884b2.json",
    "file",
    "071f344a885852b50b0abd72c0d87db4b02e294fabaf0038170f8ddb7afb921c"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/e862e469012c1ff7a300c18905e7a9db4fe6e71f12518bc6ef921b2ea8030a1c.json",
    "file",
    "b372f1dee89e76b3b550942763a702a653fa6e5069670efb124f31032785ab5c"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/e9df87721b1bb319a37b237dcf8916712d5341ed877de7b87057ee55ec11758c.json",
    "file",
    "171812c74001bb0c80b65c42ccdcce0a919514ca8f07aa2d07b6964c5d288db3"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/ee048ef305d3770252f79b29dacb53387ce393e77e8d16085a896c4dadf033dc.json",
    "file",
    "aba183b7b7b8d7b24cc64eab4dab38d509fc68cc174d921885370202baf232ad"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/f02f42d7f3452b0eb6e2b2f8d9cdedb3431b9b0430afee97115767fee6e65cf6.json",
    "file",
    "cf7c0fbbf72b4ef78076d53083a8be84ee8ee6ec6d7453808de48753c3880fb0"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/f3b62fc32f1c014f21a3ae39df6d2792bf9b5a99463f3e7eb614c3f39b8c4ca1.json",
    "file",
    "a82ab70bb6f7c71185c6aef32503f52cab3fb880635b52900dbf64acad1c803e"
  ],
  [
    "graphify-out/cache/ast/v0.9.4/f90a9b2a21e76c55f11955bc25cf48fe2032d94196335e891f22fea1a1ce11a1.json",
    "file",
    "edd30cbb40fdd2e394c2ff5437d1290414f2634e3833408f1d91546353043a95"
  ],
  [
    "graphify-out/cache/stat-index.json",
    "file",
    "7e0e9654c71895c13560fb3945fe0f63b7b79d00459d592be293ace1f3eb5984"
  ],
  [
    "graphify-out/graph.html",
    "file",
    "4a33c152d107bfb724a77c0db6292667ac3fcd70101cfb562c80b0f2c3882fbf"
  ],
  [
    "graphify-out/graph.json",
    "file",
    "e198a5d917fa29da61d8f3eae6dc6f29f7e3ac79a67b85af7d78e7fa3bd55373"
  ],
  [
    "graphify-out/manifest.json",
    "file",
    "4c25c75101427c8836f94dd00fce1524c36752a27a8566a6140e96e0852cbb30"
  ],
  [
    "logs-backend-live.err",
    "file",
    "f95ffa0b10c565a57bc3732ff54855444644fd923e399624d09fdf73bd52d942"
  ],
  [
    "memory.md",
    "file",
    "e3734f5b4dc0ec6321e894861067d55b4c6ed5d50b55f634479093ffd384508c"
  ],
  [
    "migrations/0001_create_events.sql",
    "file",
    "97a20db2b6bf38025f67635d125a8341e2c648187b11e1ce6ceb8b6716155c7a"
  ],
  [
    "migrations/0002_split_knowledge_model.sql",
    "file",
    "f0532ce45ec383cb771712a238d7e820da00bd35841fdcb66aa10859b5f4a9ee"
  ],
  [
    "migrations/0003_entities_and_event_links.sql",
    "file",
    "df5110084815b072d8a64bb7f27b46c5f953dedd4d5e9c07e80f0cbbbda3b4e4"
  ],
  [
    "migrations/0004_relations_and_event_relations.sql",
    "file",
    "d414a12623debfc57df5d51014286f906d3856cb1c3f7745eb2945b9a0af987f"
  ],
  [
    "migrations/0005_event_contract_versioning_and_idempotency.sql",
    "file",
    "3feb74354925cba68992189a345674ef28b0b412c5083ad893e9689d3b238168"
  ],
  [
    "migrations/0006_entity_merges.sql",
    "file",
    "01dc9b5fb94032b80e6fb5d83b6b613072c6dfabe9eee8f0f38ddc1a94ddd859"
  ],
  [
    "migrations/0007_classification_model_metadata.sql",
    "file",
    "a6dc660e1a6ba7b29bc406d6047090a4782635ddcf69b82a2529f694d9e4e8e5"
  ],
  [
    "migrations/0008_insight_runs.sql",
    "file",
    "85b89af5e507a921f377f4ed7f42dd5d2bf5a570eaf289f89692fb06800c29a9"
  ],
  [
    "migrations/0009_digest_runs.sql",
    "file",
    "662f8530a64df7a853680c1840a61dc93974f81c3ef2caa84bbb33f23d219014"
  ],
  [
    "migrations/0010_relations_and_link_columns.sql",
    "file",
    "c7ed57905f140a3f1e108f8084a6cc9b75779f6af77a17bcd77b99f6b2faa985"
  ],
  [
    "migrations/0011_event_link_conflict_indexes.sql",
    "file",
    "116040c3e4538fd7f6fcdd2eb906f585f18805260744bbb97467b8c0f8343220"
  ],
  [
    "migrations/0012_relation_natural_key_index.sql",
    "file",
    "2ebd3d34cdb9b6b355d8640a52a4e737e6bc71ebaf087b954616dc7d1a1540f4"
  ],
  [
    "migrations/0013_entity_aliases_and_review_queue.sql",
    "file",
    "dcd65f4d9161edf7752561b0efc399ba698ebe1f6bb6cfd1a781fdcfc96c0dec"
  ],
  [
    "migrations/0014_financial_transaction_correlations.sql",
    "file",
    "aa8977c4123f0812b8904919eb9892843733b2cf9ce37ab0b5a9787ce244f292"
  ],
  [
    "migrations/0015_financial_transaction_context.sql",
    "file",
    "569fe47bb7ee9a741c86f745b1e2edfa9e6a36cb1f8912b82f1007b7d9a47672"
  ],
  [
    "migrations/0016_financial_account_currency.sql",
    "file",
    "795343c06afdeec43ed555bd5d5a086abcee017d7a99ec9bbcbab1a0b9a0ba92"
  ],
  [
    "migrations/0017_backfill_uyu_finance_currency.sql",
    "file",
    "c15d2e57385bb6bc8581895f2b42779c4e8a0e9d880261b83ea9d638bcec706e"
  ],
  [
    "migrations/0018_semantic_knowledge_layer.sql",
    "file",
    "ec5b29076ef3523d8adf2e916ec7cd09c27f5aaee2f6b588db3e2c085cc43282"
  ],
  [
    "migrations/0019_semantic_candidate_parent.sql",
    "file",
    "0e5d002984ae008db89749cc541484fa36eeaedbf3b34fd11b53b6ba1c85b17c"
  ],
  [
    "migrations/0020_semantic_governance_v2.sql",
    "file",
    "f914da248ea568b6129a55fe35e90e4bd00b9d48b9f898d42843c72ece7e34c1"
  ],
  [
    "migrations/0021_single_hierarchy_parent.sql",
    "file",
    "ab41dab31a5d04fea6769c2882aaf5677c838e626ad8205cc4348fca7867635c"
  ],
  [
    "migrations/0022_entity_semantic_identity.sql",
    "file",
    "966e96db1429de87f8f2bd8322cc8917e767dff3f3d9e773981b5781843beb30"
  ],
  [
    "migrations/0023_event_interpretation.sql",
    "file",
    "044dd9052696d9efb30e5cc5eb171b86467cf6ec0fe31cb95492f2d06b95d88a"
  ],
  [
    "migrations/0024_semantic_retryable_status.sql",
    "file",
    "83b4ef68fbcb378bf7656d2d5d1fe3f78b5031eecdcc93fe7fe891f0e94162ae"
  ],
  [
    "migrations/0025_financial_transfer_accounts.sql",
    "file",
    "8acaefa9491d345f0b0298a1ca8e7859f59f224ec0510641021ad000a4190c91"
  ],
  [
    "migrations/0026_prevent_cross_type_entity_merges.sql",
    "file",
    "d09046f0f206d1e9d5fb1a601820a93877ec5173c88be3d67349ec6d832f53db"
  ],
  [
    "migrations/0027_financial_account_balances.sql",
    "file",
    "b30baba5fb09819f60b2b813a15136cbdefb3e3d111d71f1b0de74b73d5df990"
  ],
  [
    "migrations/0028_knowledge_platform.sql",
    "file",
    "e1dba17de72c15a5d4c38a2bb839513ec4cc0e6a7f1dbe5a8d7c1f0ded065421"
  ],
  [
    "migrations/0029_financial_transaction_consolidation.sql",
    "file",
    "d9dde607280a3223a1286367c2fda070e79c5230f98e522e8b292d48f4e532de"
  ],
  [
    "migrations/0030_financial_account_colors.sql",
    "file",
    "7fba2e1086a521094401a93aad6dbe6e2c317ef93e246e733556f85a0c44c6bb"
  ],
  [
    "migrations/0031_client_diagnostic_logs.sql",
    "file",
    "137053816a31095d97616759f155481b6fc5c34b6642240026093cdc7535fa38"
  ],
  [
    "migrations/0032_financial_cross_currency_transfers.sql",
    "file",
    "113c745a73281b499deb28604b3455f68a9b2c945c07ec4579b6569e18445cd4"
  ],
  [
    "migrations/0033_versioned_event_taxonomy.sql",
    "file",
    "edef75fabb2577d2eae20d1b2ab0c8da20e13e5f1c3fd1fa1c48c232bcd50265"
  ],
  [
    "migrations/0034_financial_transaction_title_override.sql",
    "file",
    "123258cede8df99062d6c18b8124bba90e7c7c3d485d8a361be5f04ac131a1c2"
  ],
  [
    "migrations/0035_financial_custom_categories.sql",
    "file",
    "2d30db07241b6ab67027b3c788797966ee7498afc429c6547b32c57d457329fc"
  ],
  [
    "migrations/0036_entity_semantic_profiles.sql",
    "file",
    "8c96424aed9ba95541d0ff9b84bbcddecd16fb1bfd3a6971cb385d56cb8afb84"
  ],
  [
    "migrations/0037_lockdown_supabase_public_api.sql",
    "file",
    "a4ccf438364ae397f5c7f56912c6b90d9ea7a32e26151a456661b6d63385f1cc"
  ],
  [
    "migrations/0038_revoke_public_rls_helper.sql",
    "file",
    "e31f1bbf477aead9a44d90639ee9ce461ebb4c68e8f376837b8c14839441aff6"
  ],
  [
    "migrations/0039_financial_transaction_detail_performance.sql",
    "file",
    "c4ee2ea0ac93dcbbf8dffb2b9a298fea3424f7aa7a78b34b651fba9f5f2f3018"
  ],
  [
    "migrations/20260922200339_brainia_next_intelligence.sql",
    "file",
    "663a3141f835075d003b37d9803d31adf806514c417d8993078a2219e0d1343e"
  ],
  [
    "migrations/20261003000000_pending_financial_transactions.sql",
    "file",
    "4d18ebd9faf816ed7a4dd66b6f5097a33c4e31549d104df89902bcb225c5f913"
  ],
  [
    "migrations/20261004000000_expand_classification_learning_fields.sql",
    "file",
    "b7477d17ccd1dc3460ad4af2a2dafb8ad42b26fcdb3c983da7e390ecff9cd9a2"
  ],
  [
    "mobile/App.tsx",
    "file",
    "8defc0b258d2cbfad05b63be29c80fd923d1d9ff4ee7c85d5823f4398ce367a1"
  ],
  [
    "mobile/README.md",
    "file",
    "8f151acc71fdc13614a02fcdcec0a1ac68fa936420dc87b22a8a44e0e1618fe9"
  ],
  [
    "mobile/app.json",
    "file",
    "67153be9e1e31372014a8697861b04580ce78547f9cccc8f8e37f36d63298cf6"
  ],
  [
    "mobile/package.json",
    "file",
    "a443148e6cedf899e1c3b7e2aa35ec29110cf208ba456e5506341e500be66b76"
  ],
  [
    "mobile/src/components/MetricCard.tsx",
    "file",
    "fc2d81ad4c2b9d777b4fdef27acacafd0f98fca634a4238b540cea8eda4d7681"
  ],
  [
    "mobile/src/lib/api.ts",
    "file",
    "d1317de1a3ccc34ed9282c583d080f9f861ca98089ad27d0c931728c351454a0"
  ],
  [
    "mobile/src/screens/HomeScreen.tsx",
    "file",
    "e7da8079ee9790733fe79e3d3b4fe7c5eff921f32fe5bc68bb9ff4b3feb80115"
  ],
  [
    "mobile/tsconfig.json",
    "file",
    "6d837d6330651c31e76922390dbd636c252cb4c48fbdb02d2d812542bff7d00a"
  ],
  [
    "package-lock.json",
    "file",
    "4f9658090d39bc824df3455426db407bdde3810f5b66c86d3b1d5bdadf1ed75a"
  ],
  [
    "package.json",
    "file",
    "59f800fced04daac3c3aed4ac18ad024ee03a776b2f224daee6868c15bb8a12f"
  ],
  [
    "scripts/start-brainia-with-laya.ps1",
    "file",
    "61c7b86319a430e2cdc903488a7446762212c031e36950e9ebf006d542a52ad9"
  ],
  [
    "scripts/start-laya.ps1",
    "file",
    "81768f34445d69f81f5aca88135226a99749a18113efd01e056e54de64efbcb3"
  ],
  [
    "serverless.ts",
    "file",
    "a0e5ec9c7e83c064789fbd9aeb5208802009c8ad0c82b425fcb1cca0354837ec"
  ],
  [
    "src/app.ts",
    "file",
    "5386cedb8d5515c35606f14cee65b70593520c6af491703e5cec4a7bbd7b02f5"
  ],
  [
    "src/auth.ts",
    "file",
    "fda2cfda59504bcb8591d279a3a4639029de952135d5d54ca5745164eb24e5f1"
  ],
  [
    "src/config.ts",
    "file",
    "86e77a77624216b7ea2a2969cf15a8d809bc548b9c2ee770f24e1383fddc0e9f"
  ],
  [
    "src/domain/capture.ts",
    "file",
    "83e1cd6e47c3f5ccfd41729bcee85df63e75146698bfd03d7b23741ff4be523a"
  ],
  [
    "src/domain/classification.ts",
    "file",
    "e59168638a00df2ed9e02f39ece943016b05512c253ae69ec67077e67441d77e"
  ],
  [
    "src/domain/entities.ts",
    "file",
    "89cc0c77d98b00ec55577c376259523fb541b0faf75b9569e59a00ad6e4a40f6"
  ],
  [
    "src/domain/event-interpretation.ts",
    "file",
    "8bfbe88a6c8fc2316d1a47af3e7d836f5938a1391957d2de494ae5a0104c404c"
  ],
  [
    "src/domain/event.ts",
    "file",
    "9d4808769fa266bf6271bbed1214bc305d39f8e5b0c188429d12d5d54a54530e"
  ],
  [
    "src/domain/financial-categories.ts",
    "file",
    "58c27c0a37c6f58031e2a12e8fa87c9e87a4846c5b255730c0296f6834daf979"
  ],
  [
    "src/domain/financial-transactions.ts",
    "file",
    "76f013ff82d57a2f9db0cdbb69b20505ad9bcef8492f239228009cd563be1f1e"
  ],
  [
    "src/domain/graph-options.ts",
    "file",
    "ae83d83cd4c1d331a4a8ffe3cbec9ebf8bdd5c8ab67b22c83aa4e3ae8305411b"
  ],
  [
    "src/domain/intelligence.ts",
    "file",
    "2542d4b6c77001a0924589dd1ba797b3a0fd2858b4fe78ef1d57f3e759c85033"
  ],
  [
    "src/domain/knowledge-fact.ts",
    "file",
    "7e70e8faf730b16c244b7dbc473db5788a6bb6091242e0cdf69d95894bf97ff2"
  ],
  [
    "src/domain/money.ts",
    "file",
    "c0a4dc04013b8a40cab133910be145000fc467abf7e84ad2eaf838109227ccf7"
  ],
  [
    "src/domain/ontology.ts",
    "file",
    "ebe69f0c24ab0b453702ed00ce213306716fec13a5f4d37ef5472600675ff83f"
  ],
  [
    "src/domain/relations.ts",
    "file",
    "f8de9485a35329af5a495cbadf89562eacef9851e61242c57f6a3a44f4b5d0cb"
  ],
  [
    "src/routes/agent-inspect.ts",
    "file",
    "f4fd685711373df68961ee0547f298101b0af905b355a083c71097bfd843fc22"
  ],
  [
    "src/routes/agent.ts",
    "file",
    "7443f7e4710a20bccefc10fa5722777c3e5b2b0ac016de5e8e79304b1e13ea7c"
  ],
  [
    "src/routes/capture.ts",
    "file",
    "156dc29f78219788dc781e3a150bb27e3bf84230cdf14b04c2ef0b54a8cbb806"
  ],
  [
    "src/routes/client-diagnostics.ts",
    "file",
    "bf98a63c4f5e41e1125915f0a64165f5e0e5c3c578077a1f9a29da851ee5b226"
  ],
  [
    "src/routes/dashboard.ts",
    "file",
    "6008c2251c54c7a1d1aa49ddeef266ab67f6053cb736e01ebf5976d6c35a7f83"
  ],
  [
    "src/routes/digests.ts",
    "file",
    "bfe1add200270c9a2b1a3f282976637c61e9325f4cc4cbb8a0e00a77baa0749d"
  ],
  [
    "src/routes/entity-aliases.ts",
    "file",
    "b645ffba348017f69f2e3e9f50f991e758db1d6e94fe815d73619a868fa443e9"
  ],
  [
    "src/routes/entity-merge.ts",
    "file",
    "9dbf44527256d02e427aec7f0bb6245b35a024a53ca12d7394008a49a08d658e"
  ],
  [
    "src/routes/entity-resolve.ts",
    "file",
    "30ea4445ca20dfc97d504f60fa70578f85ccd46a6e873ab3499db7e0364d10b0"
  ],
  [
    "src/routes/entity-semantic-profile.ts",
    "file",
    "4289fbc5f24903a2e1f5039c72837266c236f7f2caa1b6fc1cc5140f29c94799"
  ],
  [
    "src/routes/events.ts",
    "file",
    "1c9f34a1ca815e54e993d0f599de888d6e348b2b89279dadacc81fb870c2d0af"
  ],
  [
    "src/routes/financial-transactions.ts",
    "file",
    "ad00245fc6d704989d85818a728e70491425f50a2eb403deafcd337a1affa954"
  ],
  [
    "src/routes/graph.ts",
    "file",
    "683ad8592ae58c61af3a2280e6ba2cd5eb867a0c6c71160d66b603b3372ff9eb"
  ],
  [
    "src/routes/insights.ts",
    "file",
    "5b4415a15968da2cac88de80234aaada2898d0108467f3cfa2cffc1878cda312"
  ],
  [
    "src/routes/intelligence.ts",
    "file",
    "ff5743c5ff19c4f30267f3472536684f24288673f0ea521348ce73f5713d272d"
  ],
  [
    "src/routes/knowledge.ts",
    "file",
    "a9157bda03958083b4a86928b93f068edfa06c4fe221e720c4f3a0db741fceda"
  ],
  [
    "src/routes/metrics.ts",
    "file",
    "10327ba4c1cb852bf2878a639cf93d91b91d08ed804e82a3a8f490d7843fc1a5"
  ],
  [
    "src/routes/operations.ts",
    "file",
    "4684b00c11f877ae1a1864e2993e15f070457bb6965ac4e9b474c50ea2800948"
  ],
  [
    "src/routes/privacy.ts",
    "file",
    "56b16e1960dae41f29e04307ce4251bc22f21e81e660f2f18185c81adedb08c5"
  ],
  [
    "src/routes/search.ts",
    "file",
    "5ad2f7650d1f6d9381b26fb528069898780b0c1d3576d618eb3098cd2f573fb9"
  ],
  [
    "src/routes/semantic.ts",
    "file",
    "35aa7a66f1a61f754e30aa045cb0096616a63a016edae8ae91572d9409eba91a"
  ],
  [
    "src/scripts/audit-rooted-semantics.ts",
    "file",
    "b839308c8bd77431987a1377b0952d6a22e1950011bf61c1f8037a1088838a0e"
  ],
  [
    "src/scripts/audit-semantic-graph.ts",
    "file",
    "9d6c3d96d1352987c4d0dffeb0127d1a8990006ccc6d893c80cef34480812df1"
  ],
  [
    "src/scripts/backfill-event-evidence-parents.ts",
    "file",
    "c18db6f67090a2ab593d789d4cbfe880faf6ee125b98415b5b5b78ab9e554486"
  ],
  [
    "src/scripts/backfill-event-taxonomy.ts",
    "file",
    "a5e39a2a962e23a406190106f5dac7adbf19dd1cf30330299c1af912868ec4ae"
  ],
  [
    "src/scripts/backfill-financial-merchant-links.ts",
    "file",
    "e7d2dceaa2715f2523ea0f47b7c3d607b0ab5ceae502db47bc8f6d365a752b6a"
  ],
  [
    "src/scripts/backfill-missing-semantic-subjects.ts",
    "file",
    "9211cc32799ca05f5b21d38ebbc6e624588f2653528043b296bfb02a4645d861"
  ],
  [
    "src/scripts/backfill-orphan-semantics.ts",
    "file",
    "76f9eb0e691cced68cfd51c25d6f26885a1f0e8c03e0c92c5dd4c552d1e68d76"
  ],
  [
    "src/scripts/backfill-semantics.ts",
    "file",
    "242821ad8d9d4d7d988d8d813d0571b8e36f8c4474e8cd08e0091bb23fcdb9ad"
  ],
  [
    "src/scripts/cleanup-test-data.ts",
    "file",
    "9a216c9b08e0b515b060de395bcfc90fcec0b0d9ecb6720e6e3c67602189ea3e"
  ],
  [
    "src/scripts/evaluate-jev.ts",
    "file",
    "ace67b07e5cc6e675c5d81dc49df4d74a02d8793d87b6878e92cb0aed4ac5ca6"
  ],
  [
    "src/scripts/evaluate-laya.ts",
    "file",
    "f7ac94c29dbaf25bd5522fca6a261ae8c73aa217dc311220c8768d5b4c0c2941"
  ],
  [
    "src/scripts/inspect-semantic-proposals.ts",
    "file",
    "8910071b6e2232fa53dc80902894dfc09f8b73be1ed96bcbf82b94c7efd9c7cb"
  ],
  [
    "src/scripts/migrate.ts",
    "file",
    "b98b5c3344d7526208f188a231fe245bea99fb9ee937a1f339318ba16506edb3"
  ],
  [
    "src/scripts/normalize-hierarchy-relations.ts",
    "file",
    "4bac3d60b6d2d01305ad98a0ec9727f884370782552cc8eff5a02535871f5b77"
  ],
  [
    "src/scripts/normalize-provider-identities.ts",
    "file",
    "6c2166c5e09e4a6f12551ed130fe96b3ac33e6a2a2bfc00f774704e5ac363380"
  ],
  [
    "src/scripts/probe-deepseek-semantic.ts",
    "file",
    "76f4b06fcad611c198cf8627139b26fda51c1ec6d764bc08e2d8b541c376ec7c"
  ],
  [
    "src/scripts/process-jobs.ts",
    "file",
    "318a74c0ee0d1f86c67a456fda108cd5d580248d19062b548e13775b2b6fff8b"
  ],
  [
    "src/scripts/reconcile-semantic-governance.ts",
    "file",
    "da1b3f45399440732a4d3af224cb54eea4f1ac6bf34424a46eebe94009969119"
  ],
  [
    "src/scripts/remote-smoke.ts",
    "file",
    "b564cc663321c3dd1b87070b009d2edd9d537964afd948326c5854a53212ebb3"
  ],
  [
    "src/scripts/reprocess-pending-semantics.ts",
    "file",
    "9146dd17e0dfe8f252417869f4e9fac65b069c42a0ead2f186498bb4135502ab"
  ],
  [
    "src/scripts/semantic-harness.ts",
    "file",
    "dec4a12352cd8839888599f0594cf06ea7acb1c1319d1d742257f195289e6e94"
  ],
  [
    "src/scripts/validate-live-intelligence.ts",
    "file",
    "2d8109f97d764411625b2aad7c2dec9bfd33a64ae2a944fb7db999a9ed6ddd96"
  ],
  [
    "src/scripts/verify-backup.ts",
    "file",
    "55d9a57b8e4606e2f91d45b394befc878d639a799e67c8f7acacdcab039d098d"
  ],
  [
    "src/server.ts",
    "file",
    "779e839d584b2ac183f813fe26a7c7fba960fb21281b5908f17cdf749e019317"
  ],
  [
    "src/storage/agent-inspect.ts",
    "file",
    "b4924bc073ae0e019e5f069effea287e9d6dc70f12f9122ad3a56e30faa1f1a0"
  ],
  [
    "src/storage/backup-verification.ts",
    "file",
    "d5881a539db19f0b6acb4b47f73189b97e84b4a274ba68661fc7949a1a677226"
  ],
  [
    "src/storage/classification-assistant.ts",
    "file",
    "160255a39e1a23f00277f3e94abf7bd6716cfb162a0c26a144f2c8863e29e193"
  ],
  [
    "src/storage/classification-learning.ts",
    "file",
    "81ce8c0c9308fd9c6af38b179031118a3b3261b8546b268d4427ea5e23d6ea87"
  ],
  [
    "src/storage/client-diagnostic-repository.ts",
    "file",
    "7f9733933a9f51c6cbcc4475c89755f6165c75eb6e7e068934c0f0f689e2ccb7"
  ],
  [
    "src/storage/correction-memory.ts",
    "file",
    "71148b1c969eaeffcc67c3e41cc8bf03f796a62048fc532cb5552c1a880fe51a"
  ],
  [
    "src/storage/correction-projection.ts",
    "file",
    "ceb6353d31b6b35b98737289ab5ca928b375fbc82be3ba92612938d3b7a78442"
  ],
  [
    "src/storage/data-controls.ts",
    "file",
    "87b287ae258b064fff155ec7c01e0e4c1496826bc8ed3914358bfe48c774a115"
  ],
  [
    "src/storage/database-url.ts",
    "file",
    "b5e37c0931dca7282adbf120a7de99a8304fa119e1cf9fa131caf09e934b5278"
  ],
  [
    "src/storage/deepseek.ts",
    "file",
    "fff54eff1e99e6eac5dbd0b3386483b2dfb80f1ce81943dccbc612a97719e128"
  ],
  [
    "src/storage/digest-repository.ts",
    "file",
    "c82c5e8940eec32af17e4432b52a27eb83adac6e2f470df4571765b7e3b4aa7d"
  ],
  [
    "src/storage/digests.ts",
    "file",
    "5210e91a622d6076bf90aa340037a69d78c5a90b921a3843af239bba83d7c5d2"
  ],
  [
    "src/storage/embeddings.ts",
    "file",
    "850e80ada5b8d8c152194e1348c603691ea108721fdf1e5d070dcc3070bd7a76"
  ],
  [
    "src/storage/entity-alias-repository.ts",
    "file",
    "1d5fea4985dfe98b0462eb828e13f2df4afcb78a7bf6d3492899b5a7cf3eec63"
  ],
  [
    "src/storage/entity-repository.ts",
    "file",
    "98dd4a3d6d323809ae36c25f24428796f2608e2022dbd40d4c08323a17ef4a02"
  ],
  [
    "src/storage/entity-semantic-profile.ts",
    "file",
    "96c59043087f2bdc21f514e4e401e3871518873e5a3e6f1d6ce0ce2d7865bcba"
  ],
  [
    "src/storage/event-repository.ts",
    "file",
    "4ac68d1b6eb4ef06989bcfeaa1b7681c456315ae2ad5fc552f57525d96b60ff0"
  ],
  [
    "src/storage/event-store.ts",
    "file",
    "0b9df4e13669f3a8925c24e6b6bea164dbc7791b7855ccd11cabc7dd726018d0"
  ],
  [
    "src/storage/financial-transaction-repository.ts",
    "file",
    "99d91cb62ec0f59db49f20dc60f349846be5e3138e16deef02fa9a4f784f9c17"
  ],
  [
    "src/storage/generated-content.ts",
    "file",
    "e465177d221e92c65eb40b28a587f41e1b70369ca217d63231b3d07207b1eaa1"
  ],
  [
    "src/storage/graph-cache.ts",
    "file",
    "3df7e26084760839c47fc6dfac65b114be75377809e01369b1d4f10d58740db8"
  ],
  [
    "src/storage/graph-repository.ts",
    "file",
    "3e64f8106997c83d031d9b4f661bdab6770ac87d1bf6798037667c7131d88633"
  ],
  [
    "src/storage/hybrid-retrieval.ts",
    "file",
    "5221b228a9be67e65f8351ad20e2af70fa094dbfae0778a93bb36a17143beb6f"
  ],
  [
    "src/storage/insight-repository.ts",
    "file",
    "b4163341a5034c0fc2626c0f0ae58d1d9d33a33d009e0283452814e3a5d39472"
  ],
  [
    "src/storage/insights.ts",
    "file",
    "f700bd3547699837e9c2a27fef999ce153232318bad9979dfaab8366796d6bb2"
  ],
  [
    "src/storage/intelligence-evidence.ts",
    "file",
    "a63a37c8b9a8e5646703a74d5386d40c0ca580d358fc954e69d532e58ea19a7f"
  ],
  [
    "src/storage/intelligence-schema.ts",
    "file",
    "29c741fc41950916aa1d3dc865b48b353a09a90afd29de046a9c6b09608426af"
  ],
  [
    "src/storage/intelligence.ts",
    "file",
    "e575cf6fe6cd3471eb07cf367a52d63018ea1868fa1e5b1b9cc0c6df9b54a560"
  ],
  [
    "src/storage/jev.ts",
    "file",
    "8cb51bb5d0e4b6d8967a2ab19da1837b0ece9900667b82ec544368c458b56903"
  ],
  [
    "src/storage/job-repository.ts",
    "file",
    "acb9f77956d039f1fa6b8124d870a8fb7c2144c5a64788223892a6c1f09ab59a"
  ],
  [
    "src/storage/job-worker.ts",
    "file",
    "1fe4980f6112abedf7749b0410cbb8aa9fb97b0fa1c4791fbcaa7bee234ab4cc"
  ],
  [
    "src/storage/knowledge-fact-repository.ts",
    "file",
    "786b7e32660a4e178a1f11770fcb9eb22643922e124b62ec5317a416d19cfa4b"
  ],
  [
    "src/storage/model-audit.ts",
    "file",
    "84139cb37bd819d642bbbf72c4de63ffb016130ac8eb38e2817b06821acd6efb"
  ],
  [
    "src/storage/pending-financial-schema.ts",
    "file",
    "2367960f5efff10dd87dece169fcdc1d94e9b8a8487508375da383588ac3919b"
  ],
  [
    "src/storage/postgres.ts",
    "file",
    "0644059c2e786e6de6e7885f30a9803c27e89fd7df3fb191dc4cfad53ad554bc"
  ],
  [
    "src/storage/privacy.ts",
    "file",
    "bc3978a394813ecf9c639f4facbca248df2ab9629e835d3d5f936ee39500c573"
  ],
  [
    "src/storage/proactive-insights.ts",
    "file",
    "22cbded78f9aeeadf689549b0aed52e42713d3358f58b14eda1fecac814fe8e7"
  ],
  [
    "src/storage/quality-metrics.ts",
    "file",
    "3b84c2f40efdc92604f013875d7c052685361e21988c2a827f0490d17d642e14"
  ],
  [
    "src/storage/relation-repository.ts",
    "file",
    "cef380dce895879de3ea1e90b2e415693c175499ca8a519b13754ff62f4e35a6"
  ],
  [
    "src/storage/search-repository.ts",
    "file",
    "8e1af1a342640b1d44ff1178aa6b7e900e49e738786e8dcbf12a5f51ff1a7662"
  ],
  [
    "src/storage/semantic-enrichment.ts",
    "file",
    "86806a746276cb39df76deed7bace2ed7b6f8aea47422504fb462c2bc8e59a57"
  ],
  [
    "src/storage/semantic-reconciler.ts",
    "file",
    "89c748a69ba920b0438dae34c518f176d743d89d5f145c35228b88c332c156d2"
  ],
  [
    "src/storage/semantic-repository.ts",
    "file",
    "4b1b864643c3fe395830a5fa9a1f3a453e522cbad722dd1f68a21e8a0979a799"
  ],
  [
    "src/storage/semantic-resolver.ts",
    "file",
    "460b8550276c8ebb522e7ec44ef327fb559b3d2dd21c65df8e28b84f6eabcd77"
  ],
  [
    "tests/api-contracts.test.ts",
    "file",
    "f89c39a37f22a66a8f066ec9b5a92450da4b3f1c7b80e6365a19a633160ef7c0"
  ],
  [
    "tests/capture.test.ts",
    "file",
    "ad146f743d3297bb5fa65c9dfa279e0322db1a55f8697350cc06d13db092ce23"
  ],
  [
    "tests/domain.test.ts",
    "file",
    "917e85d3cdbdc877febc76425b54a74ae6d7183250b6af449e2a0773a20d3386"
  ],
  [
    "tests/e2e.test.ts",
    "file",
    "6ed436a9379f37d145bfeb409c82c7741b2149d7d60b9c475637702c8a5c93d1"
  ],
  [
    "tests/financial-consolidation.test.ts",
    "file",
    "d985d4aab602e2c997ef66c8b27db00c3edbd0c599b69f19b9092986e13fa7e6"
  ],
  [
    "tests/fixtures/semantic-events.jsonl",
    "file",
    "e84df22e4af534fa810d44a6372f657c85689f05dd0d478bb50e4dc996c16af8"
  ],
  [
    "tests/generated-content.test.ts",
    "file",
    "8c6972757ead76390cb0cd572952e05f297f8a4e063d71281fe64cf06f304d36"
  ],
  [
    "tests/graph-explore-options.test.ts",
    "file",
    "3996593a67fe4f057e75c521321fe1a438a877813d747ec38e1ca9581d0da389"
  ],
  [
    "tests/inspect.test.ts",
    "file",
    "df60d53a1e858aaebd83e0cab43abf992ed129226d13f606a3505e64f788173d"
  ],
  [
    "tests/intelligence.test.ts",
    "file",
    "bc0c4bd34b9846092575c5014a7f754a75eb0a500d4d16b2338eb1a7e2aeb139"
  ],
  [
    "tests/interpretation-harness.test.ts",
    "file",
    "608f93d6a7ffc8e2163b6294c3419fff202ef09b8008b6a6bd6916a608b6203a"
  ],
  [
    "tests/knowledge-platform.test.ts",
    "file",
    "ac517223ed344008b5d13509c2523bd790636e197c289f08092839115369c7a5"
  ],
  [
    "tests/p0-foundation.test.ts",
    "file",
    "c33a663497768380899c877e64ab2379cb19b71051e5ca6d1c5e5685e362bebb"
  ],
  [
    "tests/p1-knowledge.test.ts",
    "file",
    "9832ff0056a3443cb934c79fb1ce715f794fed235027e86e758da380c4bb6037"
  ],
  [
    "tests/pending-financial-transactions.test.ts",
    "file",
    "32e8549358c3cb872273f6a388d6f3548bb3639db3f2123eb2d9195d45a961ec"
  ],
  [
    "tests/pglite-setup.mjs",
    "file",
    "a9fe077837cbd88cec6c3e0eec519c88bf4d468757622b3a204559325533c021"
  ],
  [
    "tests/run-isolated.mjs",
    "file",
    "4cded9fde2c92cacea376addc1676b1e6ee46dc133013aee8f14ddcce9adbc94"
  ],
  [
    "tests/semantic-governance.test.ts",
    "file",
    "29094e5ec4125d3329b72ce18b4e2e30a96ddd42b9f3e1d962738dc8e14f1bd0"
  ],
  [
    "tsconfig.json",
    "file",
    "5ab18a2012015cebebb78d24796c0e58876aca9a8c76141690f220e250114e04"
  ],
  [
    "vercel.json",
    "file",
    "522483170d116df9e0eeab664712e26cf02a3b14825496b71c636bd4265dd227"
  ],
  [
    "web/app.js",
    "file",
    "3ede28e8bbeecc30a6f2a10f29ed780c3d377fc1459d2bf307137d2a7fb5db3c"
  ],
  [
    "web/index.html",
    "file",
    "48fee2d81ef7a525c1274747d43ea4561d3cd2d35e49833573c00e183ea88532"
  ],
  [
    "web/styles.css",
    "file",
    "bee3b47cff9a9566e118b563e2a9839b19a6848a00c638bed091b4fdd5569a34"
  ]
]
```

## Appendix B. Final read-only verification

**Verified at 2026-10-15T15:58:31.757887+00:00:** reran the exact reproduction script after creating this report. HEAD, raw index-list hash, binary HEAD-diff hash and working-tree byte hash all matched the pre-write capture. Full porcelain expansion differed only by `?? docs/reports/v2/baseline.md`; no pre-existing status entry disappeared. Thus no observed tracked/nonignored source or user file changed during this task, apart from the authorized report addition.

- Worktree SHA-256: `9bc7536e660d4d6e7bb35b503065f9293d46fe7f18d3a967dac473cccc7e2303` (match).
- Index-list SHA-256: `ab2e7fa9a7cb5dd113abfecc19d435a6738136985db2deeded728bf34464ff94` (match).
- Binary HEAD-diff SHA-256: `6f12d15eb07dc9481c911443418f5041c6d4de7aca52a20fb0eec1a765f14508` (match).
- HEAD: `b71c4cc82ca0faa636db656c729e79cb906a9114` (match).

**Verified report checks:** bytes decoded as UTF-8 with no replacement characters. An in-memory scan against nonempty sensitive credential values from `.env.production.dbcheck`, `.env.local`, `.env.laya.local`, and `.vercel/.env.production.local` found zero matching values of at least 12 characters in this report. No values were printed by that check. This is a bounded disclosure check, not a substitute for independent security review.

**Unverified/blocked independent acceptance:** the coordinator must assign a distinct read-only verifier to review this evidence and recompute hashes; human G0 approval and the blocker ledger remain pending. No application build/test was requested or executed.
