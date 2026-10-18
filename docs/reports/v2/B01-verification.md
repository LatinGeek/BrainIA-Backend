# B01 independent verification

Date: 2026-10-15 UTC. Repository: BrainIA-Backend, branch `main`, HEAD `b71c4cc82ca0faa636db656c729e79cb906a9114`. Node `v22.23.3`, npm `10.9.9`, Windows x64 / PowerShell. Verifier task `task_7b326409a3cd`, dispatch `ctx_16e1a002307a`, distinct from the B01 implementer.

**Verdict: B01 accepted-with-conditions as offline harness infrastructure. Product/release gates remain FAIL/BLOCKED.** The three manifest acceptance criteria pass independently; a fully adjudicated golden corpus, E02–E12 application adapters, real PostgreSQL evidence and native-device evidence remain unavailable. Acceptance does not satisfy the broader release Definition of Done or approve G0/deployment.

Normative contract: B01 in `docs/BRAIN_AI_V2_TASKS.json` and lines 67–89 of `docs/BRAIN_AI_V2_TASK_SPECIFICATIONS.md`, read independently in UTF-8. Implementation report and README claims were checked against source and fresh executions, not accepted as test evidence.

## Acceptance assessment

| Exact B01 acceptance criterion | Result | Independent evidence |
|---|---|---|
| Immutable dataset hashes and baseline report | PASS for the pinned seed; adjudicated golden status UNVERIFIABLE | C5 recomputed index and all 12 fixture hashes; all matched. C6 reproduced the frozen baseline's dataset identity, per-case statuses/errors and E01 observations. Baseline SHA-256 remains `969191bbefbe31ed7ff8e9b050a06fbe394544597c65c88ee7cd27ed47c755bd`. |
| Harness exits nonzero on quality gate breach | PASS | C4 exited **1**, with E01 50 pass / 450 fail. C7 independently passed its subprocess assertion that E01 exits 1 and missing E07 instrumentation exits 2. These are observed subprocess exits, not a report-only status. |
| Production URLs rejected | PASS for the reviewed runner/configuration/transport scope | C8's fresh npm subprocess exited **1**, printing `UNSAFE_TARGET: DATABASE_URL must be an isolated local target`; C9 rejected four production/remote configurations with **0 transport attempts**. C7 passed all 14 negative configuration cases and six network boundary intercepts. |

Implementation steps: E01–E12 fixture index, exact 60/20/20 family splits, required seed counts/spans and sanitizer audit PASS for the synthetic corpus (C5/C7); two npm entry points and provider/network guard PASS by source inspection and execution; frozen pre-fix observations PASS as reproducible evidence, while historical timing/provenance is limited to the recorded pre-implementation manifest. No claim is made that the seed constitutes independently adjudicated human labels.

## Fresh command results and actual output

Commands ran from the repository root. No dependency installation, commit, remote service, production DB or native device was used. The isolated runner's preload was inspected first: it constructs an in-memory PGlite database, overrides `pg.Pool.query/connect/end`, sets the nonconnecting sentinel URL, empties provider keys and disables intelligence/Jev before tests import application modules. Applying local migration text to that in-memory engine is isolated test setup, not a production migration.

| ID | Exact command | Actual exit | Output/result |
|---|---|---:|---|
| C1 | `npm run lint` | 0 | `tsc -p tsconfig.json --noEmit`; no diagnostics. |
| C2 | `npm run build` | 0 | `tsc -p tsconfig.json`; no diagnostics; normal ignored `dist/` output. |
| C3 | `npm run test:isolated` | 0 | `1..112`, `tests 112`, `pass 112`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`; duration 183313.2941 ms. |
| C4 | `npm run test:v2 -- --suite E01,E02,E03,E04,E05,E06,E07,E08,E09,E10,E11,E12` | 1 | Actual complete suite summary below. |
| C5 | PowerShell stdin Node script using `createHash('sha256').update(readFileSync(path)).digest('hex')` for the index and every `index.suites[].file` | 0 | Index equals `index.sha256`; 12/12 JSONL hashes equal their index entries. Exact reproduction below. |
| C6 | PowerShell stdin Node script comparing `baseline-evaluation.json` and fresh `latest.json` | 0 | Dataset identity, normalized case statuses/errors, and all E01 observations match. E08 now additionally records `observed: {blocked: ...}`; no baseline outcome changed. |
| C7 | `node --test tests/v2-harness/harness.test.mjs` | 0 | `tests 10`, `pass 10`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`; duration 1801.4892 ms. |
| C8 | `npm run test:v2 -- --suite E01` in a fresh subprocess with `DATABASE_URL=postgres://production.invalid/brainia` | **1 (child)** | `UNSAFE_TARGET: DATABASE_URL must be an isolated local target`; driver assertion exited 0. No suite execution/report write occurred. |
| C9 | PowerShell stdin Node script importing `guardEnvironment`, installing throwing/counting transport traps, then exercising remote/local-production DB, remote Supabase and remote provider targets | 0 | Each rejected as `UNSAFE_TARGET`; `TRANSPORT_ATTEMPTS 0`. |
| C10 | PowerShell stdin Node script comparing `fingerprint()` with `before-checkout.json`, plus byte-hash restoration of package after removing the two B01 script lines | 0 | Existing manifest paths changed: only `package.json`; new paths all within B01 test directories or the authorized implementer report. Restored package hash exactly matches the baseline. |

C4 stdout (excluding npm's two command-header lines):

```text
E01: FAIL; 50 pass / 450 fail / 0 blocked of 500
E02: BLOCKED; 0 pass / 0 fail / 250 blocked of 250
E03: BLOCKED; 0 pass / 0 fail / 200 blocked of 200
E04: BLOCKED; 0 pass / 0 fail / 100 blocked of 100
E05: BLOCKED; 0 pass / 0 fail / 100 blocked of 100
E06: BLOCKED; 0 pass / 0 fail / 180 blocked of 180
E07: BLOCKED; 0 pass / 0 fail / 2000 blocked of 2000
E08: BLOCKED; 0 pass / 0 fail / 200 blocked of 200
E09: BLOCKED; 0 pass / 0 fail / 100 blocked of 100
E10: BLOCKED; 0 pass / 0 fail / 10000 blocked of 10000
E11: BLOCKED; 0 pass / 0 fail / 90 blocked of 90
E12: BLOCKED; 0 pass / 0 fail / 100 blocked of 100
Evidence: tests\v2-harness\artifacts\latest.json; FAIL
```

C7 independently exercised environment rejection, network denial, sanitizer preservation, corpus validation, tamper rejection, comparator breaches, confidence/ranking helpers, retrieval scales, invalid selectors/report paths, and actual CLI exit codes. Its temporary corpus copy was removed by its reviewed test cleanup. The negative targets use reserved `.invalid`/example names; no real production endpoint was supplied.

Reproduction of C5 (PowerShell `@' ... '@ | node --input-type=module`):

```javascript
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const base = 'tests/fixtures/v2/';
const hash = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const index = JSON.parse(fs.readFileSync(base + 'index.json', 'utf8'));
console.log('index', hash(base + 'index.json'), fs.readFileSync(base + 'index.sha256', 'utf8').trim());
for (const s of index.suites) console.log(s.id, hash(base + s.file), s.sha256, hash(base + s.file) === s.sha256);
```

Observed index: `9224cee8483242c8b949bf5d7d7592e4d25ebe892f76eda8324b3877e26581fd`. All fixture digests match the table in `B01-b71c4cc.md` and their index entries; no fixture was regenerated or changed.

Exact C6/C10 reproduction (same PowerShell stdin Node invocation; all operations read-only):

```javascript
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fingerprint} from './tests/v2-harness/baseline.mjs';
const a = JSON.parse(fs.readFileSync('tests/v2-harness/artifacts/baseline-evaluation.json'));
const b = JSON.parse(fs.readFileSync('tests/v2-harness/artifacts/latest.json'));
const normalize = r => r.map(({observed, ...rest}) => rest);
console.log('dataset', a.datasetSha256 === b.datasetSha256);
console.log('statuses/errors', JSON.stringify(normalize(a.results)) === JSON.stringify(normalize(b.results)));
console.log('E01 observations', JSON.stringify(a.results.filter(x => x.suite === 'E01')) === JSON.stringify(b.results.filter(x => x.suite === 'E01')));
const baseline = JSON.parse(fs.readFileSync('tests/v2-harness/artifacts/before-checkout.json')).checkout;
const current = fingerprint();
const old = new Map(baseline.files), now = new Map(current.files);
console.log('changed', baseline.files.filter(([p,h]) => now.get(p) !== h).map(([p]) => p));
console.log('new', current.files.filter(([p]) => !old.has(p)).map(([p]) => p));
const restored = fs.readFileSync('package.json','utf8')
  .replace(/^    "test:v2":.*\r?\n/m, '').replace(/^    "eval:v2":.*\r?\n/m, '');
const hash = createHash('sha256').update(restored).digest('hex');
console.log('package baseline', hash, hash === old.get('package.json'));
```

Observed before this report existed: three comparison booleans `true`; `changed ["package.json"]`; all new paths within the two test directories plus the authorized implementer report; package baseline `true`. Running after verification additionally lists this authorized verifier report among new paths. Historical before-checkout comparisons do not depend on timestamp-varying generated reports.

C8's driver used `spawnSync(process.env.ComSpec, ['/d','/s','/c','npm run test:v2 -- --suite E01'], {encoding:'utf8', env:{...process.env,DATABASE_URL:'postgres://production.invalid/brainia'}})`, printed `CHILD_EXIT 1`, and asserted both status 1 and the exact unsafe-target error. C9 replaced fetch, HTTP/HTTPS request/get, TCP/Socket connect, TLS connect and UDP creation before calling the pure guard. Source inspection confirms `installOfflineBoundary()` calls the guard before corpus loading or application adapter imports. The boundary is reviewed-code accidental-network protection, as documented; it is not an adversarial JavaScript sandbox.

## Scope, package changes and preservation

The tree was substantially dirty before verification. B01 must be compared with its captured dirty baseline, not assumed to own every difference from HEAD. `git diff -- package.json` shows pre-existing dependency/default-test/script differences against HEAD; these must not be attributed to B01. Independently removing only the `test:v2` and `eval:v2` lines from the current package yields SHA-256 `59f800fced04daac3c3aed4ac18ad024ee03a776b2f224daee6868c15bb8a12f`, **exactly** the package hash in B01's before-checkout manifest. Thus B01's package delta is limited to the two script additions, without even needing newline normalization.

Every other pre-existing manifest file still matches its recorded byte hash. New files since that capture are confined to `tests/fixtures/v2/`, `tests/v2-harness/` and `docs/reports/v2/B01-b71c4cc.md`. This independently reproduces the scope result rather than trusting `scope-audit.json`. The capture already includes the baseline helper/early logs, as the implementer discloses; modifications preceding that capture cannot be independently reconstructed from it. No unexplained later source change was found.

Coordinator message `msg_f1b4306057e4` explicitly resolved the initial write-scope conflict by authorizing normal generated ignored build outputs and regenerated `tests/v2-harness/artifacts/` files while prohibiting source, fixtures, README and package edits. This report is the only authored deliverable. The before/after verifier fingerprint comparison found only three regenerated existing nonignored files: `artifacts/latest.json`, `artifacts/selftest-E01.json`, `artifacts/selftest-E07.json`, all under `tests/v2-harness/`; no added/deleted files before this report and no porcelain-status delta. `git check-ignore dist/server.js` confirms ignored build output. The frozen baseline and fixtures were preserved. Final report-only status delta is checked before completion.

No command accessed or traversed BrainIA-Mobile; it was neither inspected nor edited. No production mutation was performed: the evaluation adapter imports only current domain extraction code behind the offline boundary; application integration tests used the inspected in-memory PGlite preload. This is evidence about this verification session and reviewed execution paths, not an audit of unrelated concurrent processes or a remote production-state comparison.

Final fingerprint check after C3 completed: exactly those three generated JSON files changed, exactly `docs/reports/v2/B01-verification.md` was added, and no path was deleted. No other existing file changed. Porcelain status remained identical because the report directory was already summarized as untracked; the expanded content fingerprint detected the new report. The Git index remained unchanged (`git diff --cached --stat` empty). UTF-8 report validation found no replacement character or pending result cell.

## Findings, discrepancies and remaining conditions

No blocking discrepancy was found between the implementer's stated limited infrastructure result and fresh verification.

| Severity | Finding | Consequence |
|---|---|---|
| High, existing product gate | E01 has 450/500 exact-case failures; unknown-currency abstention 0/100. Amount precision/recall 350/350 and 350/400; currency 250/350 and 250/300; merchant 150/350 and 150/400. | Fresh measurements reproduce the report. The harness correctly fails; product gates cannot pass. Pending synthetic labels do not establish real-world defect prevalence. |
| High, declared incompleteness | All 13,820 cases are synthetic seed data pending independent adjudication; E02–E12 have no integrated adapter. | Dataset integrity passes, but a fully adjudicated golden corpus and executable product-wide validation remain UNVERIFIABLE/BLOCKED. Human review must assess semantic family independence and labels. |
| High, declared external evidence gap | E06/E07/E11 require real PostgreSQL role/RLS/locking/crash/restore evidence; E10 requires independently verified native receipts/APK identity. | Observed BLOCKED states are accurate. PGlite success cannot replace this evidence. No destructive Q10 action is authorized. |
| Medium, prerequisite/Definition-of-Done gap | B00/G0 external facts and approval hashes remain blocked; the report does not establish deployed schema/revision or mobile state. | Infrastructure acceptance does not approve release, environment safety gates, or all manifest Definition-of-Done items. |
| Low, evidence format difference | Frozen E08 blocked rows omit the newer `observed` field present in the fresh report. | Normalizing that additive blocked observation produces identical per-case status/error results; E01 observations are byte-equivalent as JSON values. No oracle or product outcome drift. |
| Low, historical provenance limit | Pre-implementation manifest was captured after helper/early-log creation. | Later scope is independently reproducible; earlier history cannot be proven solely from that manifest. The implementer accurately discloses this. |

Conditions for broader acceptance: independently adjudicate/version the seed; supply real application adapters and the complete endpoint/catalog inventories; add the separately approved PostgreSQL/native evidence; retain the immutable failure baseline and nonzero quality/missing-evidence gates. Rollback instructions are scoped to removing the two B01 script additions and new test assets after retaining evidence; no application/schema rollback is required by B01.
