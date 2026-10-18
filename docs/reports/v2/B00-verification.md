# B00 independent verification

Date: 2026-10-15 UTC. Repository: `D:/Coding/BrainIA/BrainIA-Backend`.
Verifier dispatch: `task_7509e3d952fd` / `ctx_e0032ed2ee15`, distinct from baseline author `task_ae39b5c96255` / `ctx_94622e616178`.

**Verdict: B00 accepted-with-conditions as an investigation artifact. G0 remains BLOCKED / NOT APPROVED.** No factual discrepancy was found in the required independently repeatable checks. This verdict does not certify deployment, restoration, tenant isolation, mobile compatibility, or completion of missing G0 prerequisites.

Only this verification report was written. No dependencies were installed, application modules imported, application tests/builds run, commits created, or database writes/DDL attempted. No commands targeted or traversed BrainIA-Mobile. Existing dirty state was preserved.

## Acceptance assessment

Normative inputs were read in UTF-8 using `Get-Content -Encoding UTF8 docs/BRAIN_AI_V2_TASK_SPECIFICATIONS.md -TotalCount 35`, B00 selected from `docs/BRAIN_AI_V2_TASKS.json` with `ConvertFrom-Json`, and `Get-Content -Encoding UTF8 docs/BRAIN_AI_V2_EXECUTION_PLAN.md -TotalCount 108`.

| B00 acceptance criterion (exact wording) | Result | Exact command / output evidence |
|---|---|---|
| Exact inspected and deployed revisions distinguished | PASS | `git rev-parse HEAD` returned `b71c4cc82ca0faa636db656c729e79cb906a9114`; C1 independently reproduced the tree hash. C3 printed baseline sections 2/3: inspected HEAD is explicit, current deployment revision is explicitly `Unverified/blocked`, with authenticated alias/deployment receipt and exact source/artifact hash missing. No deployed SHA is invented. |
| Missing production/Android facts block relevant gates | PASS | C3 printed `**BLOCKED / NOT APPROVED.**` and sections 3/6. Production revision/DB binding, effective host limits, Android APK/signing/device/compatibility evidence and human approval are explicitly blockers. Execution plan line 93 requires unresolved deployed DB/APK facts to block G0/release; the baseline follows that requirement. |
| Restore procedure and owner mapping approval process documented | PASS | C3 printed sections 4/5: nine-step isolated restore/token quarantine/tombstone/restricted-role verification procedure and six-step owner enrollment/mapping/quarantine/hash-bound approval procedure, each expressly proposed and not executed. `Get-Content -Encoding UTF8 src/storage/backup-verification.ts` independently confirmed the existing helper writes audit rows to the runtime pool and reads ten tables; it is not restore proof. |

The implementation steps requiring an approved future snapshot, deployed revision/host/APK evidence, executed isolated restore and human G0 approval remain UNVERIFIABLE / blocked, not passed. The explicit allowance to record blocked facts makes the investigation acceptable; the broader Definition of Done requiring prerequisite/approval hashes and actual gate evidence is not fully satisfied. E06/E11 executable privacy/restore tests were not run: B00's exact verification command is read-only evidence review/hash comparison, and EVALUATION requires isolated resources for those tests.

## C1 — Recomputed content fingerprint and status (PASS within stated coverage)

Executed in PowerShell as a Python stdin script (`@' ... '@ | python -`), exit 0, before creating this report:

```python
import pathlib,re,json,subprocess,hashlib
b=pathlib.Path('docs/reports/v2/baseline.md').read_text(encoding='utf-8')
s=re.search(r'```python\n(.*?)\n```',b,re.S).group(1)
s=s.replace('print(json.dumps(result,ensure_ascii=False))','')
exec(s)
claimed=json.loads(re.search(r'## Appendix A.*?```json\n(.*?)\n```',b,re.S).group(1))
pre=re.search(r'### Full porcelain v1 output at capture\n\n```text\n(.*?)\n```',b,re.S).group(1).splitlines()
cur=result['status_porcelain'].splitlines()
expanded=result['status_porcelain_all'].splitlines()
print(json.dumps({k:result[k] for k in ['timestamp_utc','head','branch','working_tree_sha256','index_sha256','index_entries','index_modes','diff_head_binary_sha256','diff_cached_stat']},indent=2))
print('manifest_entries',len(result['manifest']),'manifest_exact_match',claimed==result['manifest'])
print('porcelain_added',json.dumps(sorted(set(cur)-set(pre))))
print('porcelain_removed',json.dumps(sorted(set(pre)-set(cur))))
print('report_directory_expanded',json.dumps([x for x in expanded if 'docs/reports/v2/' in x]))
print('baseline_file_sha256',hashlib.sha256(pathlib.Path('docs/reports/v2/baseline.md').read_bytes()).hexdigest())
print('has_replacement_char', '\ufffd' in b)
```

The extracted algorithm was reviewed before execution. It runs only Git read operations and byte reads: sorted union of tracked and nonignored untracked paths, excludes `docs/reports/v2/baseline.md`, records missing tracked paths and symlink targets, hashes each payload and canonical compact JSON with prefix `B00-WORKTREE-v1\n`. It does not follow symlinks or print file contents. Relevant exact Git commands inside it: `git ls-files -z`, `git ls-files --others --exclude-standard -z`, `git ls-files -s -z`, `git diff --no-ext-diff --binary HEAD -- . :(exclude)docs/reports/v2/baseline.md`, `git status --porcelain=v1`, `git status --porcelain=v1 --untracked-files=all`.

Observed output:

```text
timestamp_utc: 2026-10-15T16:01:47.240488+00:00
head: b71c4cc82ca0faa636db656c729e79cb906a9114
branch: main
working_tree_sha256: 9bc7536e660d4d6e7bb35b503065f9293d46fe7f18d3a967dac473cccc7e2303
index_sha256: ab2e7fa9a7cb5dd113abfecc19d435a6738136985db2deeded728bf34464ff94
index_entries: 321
index_modes: {"100644":321}
diff_head_binary_sha256: 6f12d15eb07dc9481c911443418f5041c6d4de7aca52a20fb0eec1a765f14508
diff_cached_stat: ""
manifest_entries 371 manifest_exact_match True
porcelain_added ["?? docs/reports/v2/"]
porcelain_removed []
report_directory_expanded ["?? docs/reports/v2/baseline.md"]
baseline_file_sha256 8b8b11928ded595e367e929fb0ec4c615db72a77b287931d8514be8d213a7f1d
has_replacement_char False
```

All claimed hashes match. Appendix A matches all 371 recomputed path/kind/digest tuples, not just the aggregate. Default porcelain collapses the new directory; expanded porcelain proves its only file before this verifier's write was baseline.md. Existing default status entries have no removals or additions except that directory. This independently supports that the only observed tracked/nonignored content delta since B00 capture is baseline.md. It cannot prove absence of transient writes, modifications to ignored files, timestamps/ACLs, or activity before the captured list; the baseline explicitly discloses those limits.

## C2 — Independent read-only catalog checks (PASS)

Executed as a Node ESM stdin script (`@' ... '@ | node --input-type=module -`), exit 0. Credentials were parsed in memory from the existing authorized file and never printed. No new access was requested or provisioned. Exact connection setup:

```javascript
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import pg from 'pg';
const env=parseEnv(fs.readFileSync('.env.production.dbcheck','utf8'));
const key=['DATABASE_URL_UNPOOLED','POSTGRES_URL_NON_POOLING','DATABASE_URL'].find(k=>env[k]);
const client=new pg.Client({connectionString:env[key],options:'-c default_transaction_read_only=on',application_name:'brainia-b00-v-readonly-catalog',connectionTimeoutMillis:10000,statement_timeout:10000});
await client.connect();
await client.query('BEGIN READ ONLY');
```

Each following SQL query ran through `client.query(sql)`; only catalog/ledger metadata was selected. The session ended with `await client.query('ROLLBACK')` and `await client.end()`.

| Check | Exact SQL | Observed output |
|---|---|---|
| Identity/read-only/version | `SELECT version(), current_user, current_database(), current_setting('transaction_read_only'), pg_is_in_recovery()` | `PostgreSQL 17.11 (59c914d) on aarch64-unknown-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit`; `neondb_owner`; `neondb`; `on`; `false`. |
| Empty policies | `SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies ORDER BY schemaname,tablename,policyname` | `[]` (zero rows). |
| Pending-table RLS | `SELECT n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='pending_financial_transactions'` | One row: `public`, `pending_financial_transactions`, `false`, `false`. |
| Login bypass | `SELECT rolname,rolsuper,rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname=current_user` | One row: `neondb_owner`, `false`, `true`, `true`. |
| Applied migrations | `SELECT version,applied_at FROM public.schema_migrations ORDER BY version` | 42 rows; first `0001_create_events.sql`, last `20261004000000_expand_classification_learning_fields.sql`, last applied `2026-10-04T21:46:33.055Z`. |

The selected field was `POSTGRES_URL_NON_POOLING`, matching the baseline. All 42 filenames AND timestamps were compared to the baseline table, and all filenames to local SQL files, using:

```javascript
const local=fs.readdirSync('migrations').filter(x=>x.endsWith('.sql')).sort();
const baseline=fs.readFileSync('docs/reports/v2/baseline.md','utf8');
const applied=out.migrations.map(x=>x.version);
const reportRows=[...baseline.matchAll(/^\| ([^|]+\.sql) \| ([^|]+) \|$/gm)].map(x=>({version:x[1].trim(),applied_at:x[2].trim()}));
out.migrationCount=applied.length;out.localMigrationCount=local.length;
out.filenamesExactlyMatchLocal=JSON.stringify(applied)===JSON.stringify(local);
out.migrationsExactlyMatchReport=JSON.stringify(out.migrations)===JSON.stringify(reportRows);
```

Observed: `migrationCount=42`, `localMigrationCount=42`, `filenamesExactlyMatchLocal=true`, `migrationsExactlyMatchReport=true`, `transactionEnd=ROLLBACK`. `out.migrations` contains query rows, serialized dates as ISO UTC. The installed driver emitted an SSL-mode future-behavior warning; the connection and checks succeeded without changing configuration.

These observations certify the configured target at verification time, not its current production-alias binding. Filename equality does not establish deployed SQL source checksum equality, drift freedom, or restricted-role isolation. No user records, token contents, or personal data were read.

## C3 — Gate and source review (PASS for report accuracy; execution remains blocked)

Exact inspection commands:

```powershell
$b = Get-Content -Encoding UTF8 docs/reports/v2/baseline.md
$b[494..537]
Get-Content -Encoding UTF8 docs/BRAIN_AI_V2_EXECUTION_PLAN.md -TotalCount 108
Get-Content -Encoding UTF8 src/storage/backup-verification.ts
Get-Content -Encoding UTF8 src/storage/database-url.ts
Get-Content -Encoding UTF8 vercel.json
rg -n 'client|global|disabled' src/auth.ts
rg -n 'E06|E11|restore|backup' docs/BRAIN_AI_V2_EVALUATION.md
```

Earlier UTF-8 report reads also inspected lines 232–570 and the G0 heading. Exact output excerpts: baseline line 7 `**BLOCKED / NOT APPROVED.**`; execution-plan line 93 `If deployed DB/APK facts cannot be read, finish source planning but leave G0/release blocked with the exact missing access and evidence.` Backup helper output contains `insert into backup_verification_runs`, updates through `pool.query`, a separate `BACKUP_DATABASE_URL` pool, ten table names, and no restore/quarantine mechanism. Runtime resolver output selects `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_URL_NO_SSL`; Vercel JSON declares the two schedules but no effective deployed resource limits. Auth source lines 83/84, 121/122 and 136/137 show disabled/client/global modes. EVALUATION lines 9/56/60 require isolated tests and explain the backup helper is insufficient.

The baseline's blocker ledger identifies exact missing evidence, rather than treating absence as success:

- Approved future snapshot: review required dirty source, exclusions for sensitive/generated paths, approved source hash and credential provisioning.
- Current deployment/DB binding: authenticated current production alias/deployment ID, Git SHA or artifact digest, deployed target binding and nonsecret effective configuration.
- Restricted production login: actual deployed login/role/grant/RLS proof without ownership/DDL/BYPASSRLS, plus isolated negative access tests.
- Host capacity/cron: authenticated runtime/plan/region, duration/memory/CPU/concurrency/connection quotas, enabled schedules, execution history and measured capacity.
- Restore: approved backup identity/checksum/access, isolated destination/egress controls, actual restore/tombstone/token-quarantine comparison and RPO/RTO evidence.
- Legacy ownership: authenticated enrollment, approved mapping/quarantine artifact hash, human/security decisions and independent isolation matrix.
- Android: separate authorized investigator handoff with APK/signing hashes, device facts, compatibility/security evidence.
- G0: independent review plus responsible human approval bound to the exact baseline and resolved essential facts.

No unsupported claim of completed deployment, restore, approved mapping, mobile inspection, or gate approval was found. Other detailed local/cache/catalog statements outside the required spot checks were not exhaustively re-audited and are not certified by this report.

## C4 — Boundaries, discrepancies and conditions

1. **Medium — historical forbidden-repository access is UNVERIFIABLE.** This verifier did not access or modify BrainIA-Mobile. B00 states it did not, but neither this checkout's Git status nor content hashes can independently prove another worker's historical absence of reads/writes in a different repository. No external repository was opened to attempt that proof. The coordinator should use B00 execution telemetry if a stronger access attestation is required; the assertion remains bounded to worker attestation here.
2. **Low — filesystem coverage limitation, not a detected mismatch.** The only observed tracked/nonignored delta is baseline.md. Ignored files, transient operations and earlier access are not covered; the baseline correctly discloses that limitation. An unqualified claim about every filesystem byte would be unsupported.
3. **Informational — G0 evidence remains absent.** Production/host/mobile/restore/ownership approvals are explicitly blocked; no test success or human approval is inferred. Accepting this report does not unblock downstream work whose prerequisites require those facts.
4. **Informational — report naming.** The generic contract suggests `B00-<revision>.md`; this dispatch explicitly authorizes only `B00-verification.md`, which takes precedence. No additional report was created.

No high/critical report defect or failed repeatable check was found. Acceptance conditions are to retain G0/release blockers until the listed artifacts and approvals exist, preserve the fingerprint's stated scope, and avoid treating the historical cross-repository attestation as independently proven. A later baseline change requires fresh hash-bound review.

## Final state verification

Final read-only Python recomputation used C1, filtering only the newly authorized `docs/reports/v2/B00-verification.md` tuple before canonical hashing; the original required pre-write hash was already reproduced with only baseline.md excluded. All assertions passed, exit 0. Baseline bytes are unchanged, and all original 371 manifest tuples, index and HEAD-diff hashes still match. The only new nonignored file during this verifier task is this verification report.

```json
{
  "time_utc": "2026-10-15T16:04:07.457898+00:00",
  "head": "b71c4cc82ca0faa636db656c729e79cb906a9114",
  "tree_excluding_baseline_and_verification": "9bc7536e660d4d6e7bb35b503065f9293d46fe7f18d3a967dac473cccc7e2303",
  "manifest_exact_match": true,
  "index_sha256": "ab2e7fa9a7cb5dd113abfecc19d435a6738136985db2deeded728bf34464ff94",
  "diff_head_binary_sha256": "6f12d15eb07dc9481c911443418f5041c6d4de7aca52a20fb0eec1a765f14508",
  "baseline_sha256": "8b8b11928ded595e367e929fb0ec4c615db72a77b287931d8514be8d213a7f1d",
  "expanded_report_status": [
    "?? docs/reports/v2/B00-verification.md",
    "?? docs/reports/v2/baseline.md"
  ]
}
```

