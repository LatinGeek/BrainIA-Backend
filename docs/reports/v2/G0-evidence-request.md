# G0 evidence request — locally obtainable vs externally blocked

Date: 2026-10-18 (UTC). Repositories inspected read-only: `D:/Coding/BrainIA/BrainIA-Backend` and `D:/Coding/BrainIA/BrainIA-Mobile` (mobile metadata only). Authorized write: this file only.

**G0 status: BLOCKED. NOT APPROVED.** This report is an evidence inventory, not a gate approval, deployment proof, restore proof, or signing attestation. No deployed revision is asserted, no production database was queried by this worker, no backup was restored, no build or migration was run, and no secret value was read, printed, or hashed.

Scope note: two earlier artifacts are reused as *prior evidence*, not as current truth: `docs/reports/v2/baseline.md` (2026-10-15), its verification `B00-verification.md`, and the reviewed snapshot `baseline-snapshot.md` + `snapshot-backend.json` / `snapshot-mobile.json` (2026-10-17). Any earlier hash is labelled with its date; it is not re-verified here.

## 1. Prerequisite matrix

Legend: **Yes** = fact fully established from local files/artifacts; **Partial** = some local evidence exists but the gate-relevant fact is stale, unbound, or unapproved; **No** = requires external access or a human decision.

| # | Prerequisite | Locally available? | Evidence | Missing fact | Access needed | Blocks |
|---|---|---|---|---|---|---|
| 1 | Backend inspected source revision + dirty counts | **Yes** | `git rev-parse HEAD` = `b71c4cc82ca0faa636db656c729e79cb906a9114`; `main`, tracking `origin/main`; commit 2026-10-15T12:27:24-03:00; `git status --porcelain=v1 -uall` = 73 modified, 304 untracked, 1 deleted (378 lines; 252 in default porcelain) | Nothing for identity. Only the *approved* dirty-state baseline is missing (row 4) | none (local) | G0 identity criterion |
| 2 | Backend package/runtime versions | **Yes** | `package.json` `brainia-backend@0.1.0`, private ESM; deps fastify `^5.3.3`, pg `^8.16.3`, zod `^3.25.76`; no `engines`/`packageManager`; local `node v22.23.3`, `npm 10.9.9`; cached build output reports Fastify framework 5.10.0 | Deployed Node runtime (cached `.vc-config.json` says `nodejs24.x`, dated 2026-07-31 — not proof) | Vercel deployment metadata | G0, B00 runtime baseline |
| 3 | Deployment configuration (prefix, entry, cron, processing mode, DB variable names) | **Yes** | `vercel.json` v2 → `@vercel/node` on `serverless.ts`, all paths rewritten, crons `/api/v1/cron/process-jobs` `* * * * *` and `/api/v1/cron/daily-insights` `0 8 * * *`; `serverless.ts` exports a Fastify handler; `API_PREFIX` default `/api/v1`; `BRAINIA_PROCESSING_MODE` default `inline`; DB names `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `BACKUP_DATABASE_URL` | Which values are *effective in production* and whether both crons are enabled | `vercel env ls production` (names only) + Vercel Cron tab | G0, C3, release |
| 4 | Approved dirty-state baseline bound to current tree | **Partial** | `baseline-snapshot.md`: backend manifest `ea41cb127802a821d01e1991e0f1fd03684214d9342c47552c699695c25cb444` (450 files, 131 untracked), mobile `596cff0d…af68` (1774 files); B00 fingerprint tree `9bc7536e…2303`, index `ab2e7fa9…ff94`, diff `6f12d15e…4508`, baseline sha `8b8b1192…a7f1d` | Re-verification of the current 378-entry dirty tree and an explicit approval that this dirty state is the sanctioned G0 baseline | Owner/verifier rerun of the snapshot script (row 3 of §3) | G0, all future worktree attribution |
| 5 | Effective host limits (function duration, memory, region, concurrency, plan, cron entitlement) | **No** | `vercel.json` declares **no** `maxDuration`, `memory`, `regions`, `functions`, or Fluid Compute settings. Cached `.vercel/output` (2026-07-31) is build output only | Authenticated project plan/region/limits, effective function timeout, concurrency and connection ceiling, enabled cron schedules + execution history | Vercel console/CLI with read-only project access | G0, B08 capacity, C3, release |
| 6 | Application-level limits in source (worker batch, pool, timeouts) | **Yes** | `src/config.ts`: worker batch default 3, clamped 1–8, `queued` only when trimmed value is `queued`. `src/storage/postgres.ts`: pool `max: 4`, connection/idle/query/statement timeout 10 000 ms. Provider call default 15 000 ms (per B00) | Whether these app values fit the *actual* host limits (unknown until row 5) | none local / Vercel for comparison | informs G0 capacity |
| 7 | Configured database schema/migration catalog evidence | **Partial** | B00 verification (2026-10-15): PG 17.11, `current_user` `neondb_owner`, db `neondb`, `transaction_read_only=on`, 42 applied migrations matching 42 local files, 0 RLS policies at that time | A *current* read-only catalog snapshot and its binding to the production alias; this worker did not connect | Authorized read-only DSN + explicit approval to re-run catalog SQL | G0, B05/B06 schema claims |
| 8 | Restricted production runtime role (no owner/DDL/BYPASSRLS) | **No** | B00 observed `neondb_owner` with `rolbypassrls=true`, `rolcanlogin=true`, `rolsuper=false` | A deployed non-owner login, its grants, and negative access tests | DB/security owner creates restricted role; authorized read-only confirmation | G0, B06 RLS, E06/E11 |
| 9 | Isolated restore executed (RPO/RTO, tombstone replay, token quarantine) | **No** | Procedure documented (`baseline.md` §4, 9 steps; `docs/operations.md:132-134`). Helper `src/storage/backup-verification.ts` only counts 10 tables and writes `backup_verification_runs` via the runtime pool — it does not restore. `docs/runbooks.md:65-69` states backups are not yet automated. No restore evidence exists in `docs/reports/v2/` | Backup artifact identity/checksum/source timestamp, isolated destination, executed restore, tombstone reconciliation, connector-token quarantine, measured RPO/RTO | Provider backup console + isolated DB project + security owner authorization | G0, B11/E11, C8 release |
| 10 | Backup artifact identity and access | **No** | Per B00: no backup target configured in `.env.production.dbcheck`; `BACKUP_DATABASE_URL` is empty by template | Snapshot ID, checksum, timestamp, retention/expiry, encryption, restore permissions | Neon/provider console (read-only first) | G0 restore, C8 |
| 11 | Owner/device mapping + legacy quarantine approval | **No** | G1 owner decisions 30/30 confirmed 2026-10-17 (`execution-status.md:31`), but no mapping manifest, no quarantine counts, no G0/G1 mapping sign-off. `approvals.json` v3 contains only a `G1` gate entry and states *"No production, destructive action, runtime gate or deployment is approved by this ledger."* | Versioned mapping manifest hash, quarantine dispositions, named security/data owner approval, device-credential registry decision | Human security/data owner (+ authenticated enrollment evidence) | G0, B05/B09 promotion, C1 |
| 12 | Human G0 environment/safety approval | **No** | `baseline.md:7` BLOCKED; `B00-verification.md:6` "G0 remains BLOCKED / NOT APPROVED"; `execution-status.md:30` BLOCKED | Approval bound to exact baseline/manifest hashes and resolved essential facts | Responsible human/owner signature or ledger entry | G0 (all downstream) |
| 13 | Mobile inspected source revision + package identity | **Yes** | `a526b3498fff63df5374c72c11ab09ccc39d13fc`, `main`, tracking `origin/main`, commit 2026-09-20; status 58 modified, 47 untracked, 0 deleted (105 expanded; 73 default) | Approved dirty-state baseline (row 4) | none | G0/M00 |
| 14 | Mobile build identifiers | **Yes** | `app.json` + `android/app/build.gradle`: `com.brainia.mobile`, versionCode **8**, versionName **1.0.7**; `package.json` name `brainia-mobile@1.0.0`; expo `~57.0.4`, react-native `0.86.0`, reanimated `4.5.0`, screens `4.25.2`, secure-store `~57.0.0`; minSdk 24, target/compileSdk 36, `reactNativeArchitectures=arm64-v8a` | Nothing local; whether a distributed build uses these identifiers | Play Console | G0, C5 |
| 15 | APK artifact metadata (path/size/mtime/SHA-256) | **Yes** | Four local build outputs hashed (§2.2): release `1B6D65B8…E9A6` 51 196 192 B; debug `8CEC30A5…C1C3` 83 588 967 B; two archive copies. No `.aab` exists in the tree | That any of these is the *distributed* artifact | Play Console / distribution owner | G0, C5/G3 |
| 16 | APK signature validity + public certificate | **Yes** | `apksigner verify`: exit 0; v2 scheme true, v1/v3/v3.1/v4 false; 1 signer; cert DN `CN=BrainIA Mobile, OU=Mobile, O=BrainIA, L=Montevideo, ST=Montevideo, C=UY`; SHA-256 `54e983732909a3b27138569437fa19240bb7302fd815a3c774e3854a87e65739`; SHA-1 `52eb5cb625bf371e9e76244e7bbf4b48654ec1cf` | Certificate *custody/provenance*, Play app-signing vs upload-key relationship, continuity | Signing owner + Play Console → App integrity | G0, M02/G2, C5/G3 |
| 17 | Signing configuration and keystore presence (names only) | **Yes** | `build.gradle` defines `signingConfigs.release` resolving `BRAINIA_RELEASE_STORE_FILE/_STORE_PASSWORD/_KEY_ALIAS/_KEY_PASSWORD` from env or Gradle-home properties; `android/app/release.keystore` 2 794 B and `android/app/debug.keystore` 2 257 B exist and are **untracked**. HEAD's `android/gradle.properties` still contains those four definitions; the current worktree removes them as an uncommitted M02 change | Whether the prior in-HEAD credential exposure is remediated (rotation/history decision) and whether `release.keystore` matches the APK signer | Security owner / signing owner decision | G0, G2, release |
| 18 | APK ↔ source binding | **No** | Release APK mtime 2026-10-03T23:57:12Z; HEAD commit 2026-09-20 with 58 modified files; no build receipt, no embedded commit SHA, no reproducible-build comparison | A signed build receipt or rebuild-and-compare bound to a specific source hash | Distribution owner / reproducible build run (authorized) | G0, C5 |
| 19 | Play/CI distribution configuration | **No** | No `.github/`, no `eas.json`, no `app.config.*`, no Play/Fastlane config in mobile. `share:apk` is a local HTTP server script. Backend has only `.github/workflows/production-smoke.yml` (targets `https://brain-ia-six.vercel.app`, a config string, not a binding proof) | Track/channel of the current build, upload key ownership, rollout state, app-signing key | Play Console (read-only) | G0, C5, release |
| 20 | Device/OEM/runtime evidence (capture, encrypted outbox, backup, fonts, TalkBack) | **No** | M00/M02 reports: no durable outbox exists; `adb` not available here and no device attached; M02 recorded "device execution BLOCKED, ADB reported 0 devices" | Physical-device runs across API/OEM matrix, queue durability receipts, upgrade/rollback with pending rows | Provisioned devices + mobile QA owner | G2/G3, C5 |
| 21 | Deployed backend revision / alias / DB binding | **No** | `.vercel/project.json` exists (projectId/orgId present, values withheld). `.vercel-deploy.log` (54 B, 2026-09-23) holds only a preview URL `brain-4f5gr742m-latingeeks-projects.vercel.app`. `.vercel/.env.production.local` has `VERCEL_GIT_COMMIT_SHA` and `VERCEL_GIT_COMMIT_REF` present but **empty** (quoted-empty, length 2). No `vercel`/`psql`/`supabase` CLI on PATH | Current production Deployment ID, alias, Git SHA or artifact digest, and deployment→database binding | Vercel console/CLI authenticated read-only session | G0, C8 |
| 22 | Effective production env names (no values) | **Partial** | Names present in `.vercel/.env.production.local`: `BRAINIA_PROCESSING_MODE`, `BRAINIA_INTELLIGENCE_ENABLED`, `BRAINIA_LEARNING_ENABLED`, `BRAINIA_JEV_MODE`, `CRON_SECRET`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DEEPSEEK_*`, `JEV_*`, `POSTGRES_*`, `NEON_PROJECT_ID`, `VERCEL_*` (names only, no values read out) | Which names exist in the *deployed* production scope and their non-secret effective values (processing mode, flags) | `vercel env ls production` (names) + owner confirmation of flag states | G0, rollout safety |

**Count: 9 local (rows 1, 2, 3, 6, 13, 14, 15, 16, 17) · 3 partial (rows 4, 7, 22) · 10 missing (rows 5, 8, 9, 10, 11, 12, 18, 19, 20, 21) = 22 prerequisites.**

## 2. Exact local facts found (no invented deployment claims)

### 2.1 Backend revision and packaging

| Fact | Value |
|---|---|
| HEAD | `b71c4cc82ca0faa636db656c729e79cb906a9114` |
| Branch / upstream | `main` → `origin/main` (`https://github.com/LatinGeek/BrainIA-Backend.git`) |
| HEAD commit time / subject | 2026-10-15T12:27:24-03:00 — `docs: add Brain AI v2 architecture and cross-repository execution plan` |
| Dirty state now (expanded) | 73 modified, 304 untracked, 1 deleted (378 entries) |
| Dirty state at B00 capture (2026-10-15) | 83 porcelain entries; tree SHA-256 `9bc7536e660d4d6e7bb35b503065f9293d46fe7f18d3a967dac473cccc7e2303`; index `ab2e7fa9a7cb5dd113abfecc19d435a6738136985db2deeded728bf34464ff94` (321 entries); HEAD diff `6f12d15eb07dc9481c911443418f5041c6d4de7aca52a20fb0eec1a765f14508` |
| Snapshot 2026-10-17 | manifest `ea41cb127802a821d01e1991e0f1fd03684214d9342c47552c699695c25cb444` (450 files, 319 tracked, 131 untracked) |
| Package | `brainia-backend@0.1.0`, private, ESM; scripts `build`/`lint` = tsc, `verify:backup` = `tsx src/scripts/verify-backup.ts` |
| Local toolchain | Node `v22.23.3`, npm `10.9.9`; no `engines` field |

### 2.2 Mobile artifacts (hashes computed in this task)

| Path (relative to mobile repo) | Bytes | mtime (UTC) | SHA-256 |
|---|---:|---|---|
| `android/app/build/outputs/apk/release/app-release.apk` | 51 196 192 | 2026-10-03T23:57:12Z | `1B6D65B83F1768FF6CB1601EBC06531B7B10F5989AF13F6EA2BC2B083FDDE9A6` |
| `android/app/build/outputs/apk/debug/app-debug.apk` | 83 588 967 | 2026-10-15T17:29:31Z | `8CEC30A53419FD234D32CC667C781AAC2B22B0434ECA1341B0B3BCE6FBF8C1C3` |
| `android/app/build.rebuild-backup-20260803/outputs/apk/release/app-release.apk` | 113 264 555 | 2026-08-03T15:15:20Z | `918DD1D77A1F945DDD30F355927DE00F3D83F3A3850D64EB50308CDC58EBB2B6` |
| `android/app/build.rebuild-backup-20260803/outputs/apk/debug/app-debug.apk` | 239 306 416 | 2026-07-14T13:42:21Z | `822092062E81CE89DCD60549D86CB473A99FB94D4D44601599F109405AD9C49A` |

No `.aab` present. Local release APK signer certificate (public only): SHA-256 `54e983732909a3b27138569437fa19240bb7302fd815a3c774e3854a87e65739`. The B00-equivalent M00 verifier independently recorded the same APK SHA-256 and `apksigner` exit 0.

Keystores (paths/sizes only, contents never opened): `android/app/release.keystore` 2 794 B; `android/app/debug.keystore` 2 257 B; both untracked. HEAD `android/gradle.properties` contains four `BRAINIA_RELEASE_*` signing definitions; the working tree removes them (uncommitted M02-r1 change) — values were never printed.

### 2.3 Deployment configuration observed (names only)

- `vercel.json`: v2, `@vercel/node`, rewrite `/(.*) → serverless.ts`, crons `process-jobs` (every minute) and `daily-insights` (`0 8 * * *`); **no** `maxDuration`, memory, region, concurrency or Fluid Compute declarations.
- `serverless.ts`: builds the Fastify app once, re-emits HTTP requests.
- `.vercel/project.json` present (projectId/orgId withheld). `.vercel/output` cached 2026-07-31 (`nodejs24.x`; config lists only `daily-insights` cron) — stale build output, not deployment proof.
- `.vercel/.env.production.local`: `VERCEL_GIT_COMMIT_SHA` and `VERCEL_GIT_COMMIT_REF` are empty; `VERCEL_ENV`/`VERCEL_TARGET_ENV` set. Values not reproduced.
- `.vercel-deploy.log`: 54 bytes, only a **preview** deployment URL from 2026-09-23.
- `.github/workflows/production-smoke.yml`: `BRAINIA_BASE_URL=https://brain-ia-six.vercel.app` — a workflow configuration string, not proof the alias currently serves this revision.
- Effective host limits: **unknown**; no authenticated host session was established and no platform defaults are assumed.

### 2.4 Restore capability

- Documented procedure: `docs/operations.md:132-134` (restore into isolated Postgres, set `BACKUP_DATABASE_URL`, run `npm run verify:backup`); `baseline.md` §4 gives the full 9-step isolation/quarantine/tombstone procedure.
- Helper reality: `src/storage/backup-verification.ts` reads 10 critical tables, computes counts, inserts/updates `backup_verification_runs` through the runtime pool, and has a restore-gate function for tombstones. It **does not restore**, check snapshot completeness, quarantine tokens, or prove RPO/RTO.
- `docs/runbooks.md:63-69`: backups are a future production target, not automated.
- **An actual restore cannot be executed by this worker and cannot be executed locally at all**: it needs a provider backup artifact + checksum + credentials, an isolated destination project, and security-owner authorization. No backup target is configured locally.

### 2.5 Owner/schema mapping

G1 decisions are resolved (30/30, 2026-10-17) and `approvals.json` v3 records the B02-r3 contract approval, but it contains **no G0 gate entry** and explicitly disclaims runtime/deployment approval. No owner/device mapping manifest, quarantine ledger, or named security-owner sign-off exists. So: **schema decisions = resolved; G0 owner-mapping approval = absent.**

## 3. Minimal read-only evidence request (human/owner executable)

Each item is read-only. Do **not** paste secret values, connection strings, tokens, keystore contents, or `DATABASE_URL` into reports or chat — names, IDs, hashes, and timestamps only.

**E1 — Deployed backend identity (owner of the Vercel project).** Blocks G0, row 21.
```bash
vercel ls --scope <team>            # find the production deployment
vercel inspect <production-deployment-url>   # Deployment ID, commit SHA, created, regions
vercel env ls production            # variable NAMES only
```
Console alternative: Project → Deployments → production entry → copy Deployment ID, Git SHA, created time; Settings → General/Functions; Cron Jobs tab → schedules + last run status. Record: alias, deployment ID, Git SHA **or** uploaded artifact digest, created time, plan, region.

**E2 — Effective host limits (same owner).** Blocks G0, rows 5/6.
Console → Project → Settings → Functions: max duration, memory, regions, concurrency; Observability → function duration/timeout errors over a representative window; Cron Jobs → enabled schedules and execution history. Record numbers, not screenshots containing secrets.

**E3 — Current read-only schema re-check (DB owner authorizes; no writes).** Blocks G0, row 7. Reuse the B00 pattern: connect with `options='-c default_transaction_read_only=on'`, `BEGIN READ ONLY`, then:
```sql
select version(), current_user, current_database(), current_setting('transaction_read_only'), pg_is_in_recovery();
select version, applied_at from public.schema_migrations order by version;
select rolname, rolsuper, rolcanlogin, rolbypassrls from pg_roles where rolname = current_user;
select schemaname, tablename, policyname from pg_policies order by 1,2,3;
```
If a restricted runtime login already exists, report its role name and grants instead of using the owner login.

**E4 — Restore drill plan approval + artifact facts (DB/security owner).** Blocks G0, rows 9/10. Read-only first: provider console → Backups/Branches → snapshot ID, created timestamp, retention, checksum if shown. Then obtain written approval for an isolated destination (separate project, egress denied, workers/cron stopped) before any restore. Deliver: snapshot ID + checksum + timestamp, restore start/end, RPO/RTO, tombstone replay result, token-quarantine inventory (metadata only), independent verifier sign-off.

**E5 — Signing provenance (signing/Play owner).** Blocks G0, rows 16/17/19. Play Console → Test and release → App integrity → app-signing key certificate SHA-256; compare with local signer `54e98373…5739`. Confirm: upload-key custody, whether `android/app/release.keystore` is the upload key, whether the four historically committed `BRAINIA_RELEASE_*` values were live credentials, and the rotation/history decision. No keystore or password is to be shared.

**E6 — Distributed artifact + source binding (distribution owner).** Blocks G0, row 18. From Play Console, record the versionCode/versionName currently served (expected 8 / 1.0.7), the uploaded AAB/APK SHA-256, and the build's source SHA or CI run ID. If unavailable, authorize a rebuild from a pinned source hash and compare hashes; do not claim binding without it.

**E7 — Device evidence (mobile QA owner).** Blocks G2/G3, row 20. Provide a physical-device matrix (API level, OEM), install the distributed build, and record capture → queue → sync receipts, upgrade/rollback with pending rows, backup/restore behavior, and TalkBack/large-font checks. M00/M02 already establish that no encrypted durable outbox exists; this must not be reported as durable delivery.

**E8 — Owner mapping and G0 approval (human owner + security/data owner).** Blocks G0, rows 11/12. Approve a versioned mapping manifest hash, quarantine counts, device-to-owner enrollment policy, and the exact G0 baseline/manifest hash (`ea41cb12…cb444` backend, `596cff0d…af68` mobile), then record the approval in `approvals.json` as a `G0` gate entry with approver, timestamp, scope, and artifact hashes.

**E9 — Baseline re-verification (independent verifier).** Blocks G0, row 4. Re-run the snapshot script against both repositories and confirm the manifest still matches, or record every delta as attributable before approval.

## 4. Security handling notes

- No secret values were read or reproduced. `.env*` files were inspected for **variable names only**; `.vercel/.env.production.local` was used solely to record that the commit SHA/ref are empty.
- Keystore files were never opened, copied, or hashed. Only path, size, and presence are recorded.
- The APK certificate digest is public metadata. It proves what signed the artifact, not who controls the key or whether Play re-signed it.
- The four `BRAINIA_RELEASE_*` names in HEAD's `android/gradle.properties` indicate potential historical credential exposure. Removing them in the working tree is not remediation; key rotation and history decisions belong to the security owner.
- This report must not be extended with production data, personal records, connector tokens, or env values.

## 5. Gate statement

**G0 remains BLOCKED.** Locally, nine prerequisites are fully evidenced and three are partial; ten require external or human input. The local artifacts answer "what source and build outputs exist here" — they do **not** answer "what is deployed, what is backed up, who owns the signing key, or whether a restore works." No deployment, restore, signing, host-limit, or ownership fact in this report is inferred or fabricated. G0 may only be marked approved after E1–E9 are supplied, independently verified, and bound to the recorded baseline hashes.

## 6. Vercel evidence obtained 2026-10-18 (read-only)

Retrieved through the Vercel integration in Codex, read-only. No deploy, promotion, rollback, env change, or file write was performed.

| Fact | Value |
|---|---|
| Project | `brain-ia` (`prj_UTY2FxQt1TaclNkbvuNCb6yLrCJK`) |
| Team scope | `latingeeks-projects` (`team_VIU18sXii6mkmp6NhI4JpM5X`) |
| Latest production deployment | `https://brain-px4jb2zqh-latingeeks-projects.vercel.app` |
| State / target / created | `READY` / `production` / `2026-10-04 22:19:00 UTC` |
| Deployed commit | `e0ccc565ebd3c956fd138b5d5300010e8579245c` (2026-09-20, "feat: add event retrieval functionality to event routes") |
| Production aliases | `brain-ia-six.vercel.app`, `brain-ia-latingeeks-projects.vercel.app` |
| Framework / runtime / region | Fastify / Node 24.x / `iad1` (LAMBDAS, CLI source) |
| Local link | `.vercel/project.json` projectId/orgId match the deployment facts |

### Deployment lag

`e0ccc56` is the parent of inspected HEAD `b71c4cc`. The only later commit is docs-only; **all Brain AI v2 implementation (B04–B11) is uncommitted and therefore not deployed**. Production is v1-era code with no v2 authorization, privacy, job, deletion, or finance-safety changes. No capability is enabled by this observation.

### Still inaccessible (403 / not exposed)

- Environment variable names/counts per environment (values were never requested).
- Team plan, function memory/duration limits, regional quotas.
- Recent cron runs and detailed build logs.
- Read-only DB connection, backup/snapshot metadata, or restore destination.

### Effect on the gate

The deployed revision and project identity are now evidenced. DB alias/binding, restore/backup identity, effective host limits, cron history, signing/Play custody, owner mapping, device evidence, and APK↔source binding remain missing. **G0 remains BLOCKED**; no production or destructive action is authorized.
