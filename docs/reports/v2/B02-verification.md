# B02 independent verification

Date: 2026-10-15. Target: `D:/Coding/BrainIA/BrainIA-Backend`. Branch: `main`; HEAD: `b71c4cc82ca0faa636db656c729e79cb906a9114`. Verifier task: `task_53b6a179eebe`; dispatch: `ctx_21cbee72fda8`; terminal: `term_5ac409c8-8e63-48de-afff-87d37ec999c5`. Environment: Node v22.23.3, npm 10.9.9, Windows PowerShell. The verifier independently read the artifacts and executed checks; B02-r1 conclusions were treated as claims, not proof.

**Verdict: B02 accepted-with-conditions as a proposed, unapproved subset. Full B02 completion and G1 approval remain blocked.** The published hash is reproducible and corruption fails closed. This verdict does not resolve required wire decisions, approve application/mobile implementation, or certify E02/E06/E12 runtime behavior.

## Original B02 acceptance criteria

Source: `docs/BRAIN_AI_V2_TASK_SPECIFICATIONS.md:112-118`.

| Exact criterion | Assessment | Independent evidence |
|---|---|---|
| Both repository reviewers resolve all required wire fields | **FAIL** | `open-items.json` contains 30 distinct entries, all `status: open`, `approvalReady: false`, and `status: PROPOSED_UNAPPROVED_SUBSET`. Fourteen operations are excluded. No dual-review resolution evidence was supplied. This is consistent with a draft subset, but does not satisfy the original criterion. |
| Positive/negative fixtures validate including actual hashes | **PASS for published subset** | `npm run contracts:verify` exits 0: `PASS 382 contract checks; 58 positive/negative schema+semantic fixtures; 7 identity sequences.` Independent Node crypto recomputation confirms every manifest file, four valid canonical-string/UTF-8/hash cases, and all four positive Envelope fingerprints. The fifth canonical case tests rejection of invalid Unicode in the bundled verifier. Stale correction and deletion replay are expressly deferred, not executable passing wire tests. |
| No application implementation in contract task | **UNVERIFIABLE as historical authorship; PASS for artifact separation inspected** | Bundle scripts perform generation, hashing, validation and pure reference oracles; they do not implement/register application routes. `rg -n 'brain-ai/2\.0\.0|contracts:verify|/api/v2/' src package.json` finds only `package.json:38` (contracts verifier script), no source import or v2 route match. However, the entry working tree already had extensive changes in src/, migrations/, tests/, package-lock.json and package.json, and there is no independent pre-B02 snapshot/change receipt identifying its writes. These cannot be attributed to or cleared on behalf of B02 from current Git state alone. |

The coordinator-authorized subset claim in B02-r1 is compatible with the normative document's explicit subset/exclusion rules. It is not evidence that all original acceptance criteria passed.

## Required verification checks

### 1. Normal verification

Executed from the backend root:

```text
npm run contracts:verify
> node contracts/brain-ai/2.0.0/verify.mjs
PASS 382 contract checks; 58 positive/negative schema+semantic fixtures; 7 identity sequences.
Bundle manifest SHA-256: 312c92f8f71c9f98ad3d2d6986e26bd941485332ded516b4052ca14b052abad6
PROPOSED / UNAPPROVED SUBSET: 30 open G1 decisions.
VERIFY_EXIT=0
```

The command loads the checked-in standalone validators and Node built-ins; no dependency installation, generation, network, database, or application endpoint invocation was performed. Source review confirms fixture generation is not invoked by verification.

### 2. Independent bundle hash

Used `node:crypto.createHash('sha256')` directly, without importing `canonical.mjs`, `seal.mjs`, or `verify.mjs`. Read exact file bytes using `fs.readFileSync`. Iterated all entries in `SHA256SUMS.json.files`, recomputed each digest, compared to the manifest, and separately hashed the manifest itself.

```text
INDEPENDENT_MANIFEST_SHA256=312c92f8f71c9f98ad3d2d6986e26bd941485332ded516b4052ca14b052abad6
INDEPENDENT_FILES_VERIFIED=15
SPEC_SNAPSHOT_EQUAL=true
```

Thus the independently computed hash exactly equals the claimed hash; discrepancy: none. The identifier hashes exact manifest bytes, not a concatenation of bundle files. Fifteen per-file hashes bind every other bundle file, and `spec.md` equals the normative documentation byte-for-byte. A separate independent recursive UTF-16-key-sorted serializer verified the four positive canonical fixtures against their literal strings, UTF-8 hex and SHA-256; it also recomputed the four positive envelope fingerprints over exactly `{changeKind,content,sourceOccurredAt,sourceUpdatedAt}`.

### 3. Fails-closed corruption experiments

To obey the prohibition on fixture/spec/source writes, corruption was injected into file reads **in memory only**, using a Node `--import=data:text/javascript;base64,...` preload passed through `NODE_OPTIONS` to a child `cmd.exe /d /s /c npm run contracts:verify`. The preload wrapped `fs.readFileSync` and returned altered JSON only for the target bundle filename. No fixture was overwritten, no resealing command ran, and no restoration write was necessary.

| Probe | Exact mutation | Result |
|---|---|---|
| Fixture integrity | `fixtures.schemaCases[0].value.contractVersion = 999`; disk manifest unchanged | **PASS: rejects**; npm exits 1, `AssertionError [ERR_ASSERTION]: checksum fixtures.json`. |
| Fixture semantics past integrity gate | Same mutation; preload also replaces only `manifest.files['fixtures.json']` with the mutated bytes' SHA-256 in the manifest returned in memory | **PASS: rejects**; npm exits 1, `AssertionError [ERR_ASSERTION]: fixture new-notification`. This proves the positive fixture's known field is validated, independently of checksum rejection. |
| Approval marker past integrity gate | `openItems.approvalReady = true`; preload replaces its per-file manifest digest in memory | **PASS: rejects**; npm exits 1, `AssertionError [ERR_ASSERTION]: approval cannot silently pass`. |

The runner asserted exit status 1 for every probe. Before/after SHA-256 maps for every on-disk bundle file, including the manifest, were equal: `ALL_BUNDLE_FILES_UNCHANGED=true`. The verifier script and schemas themselves remained unchanged even in the probes.

### 4. Open G1 decisions and unresolved fields

**PASS for explicit disclosure and safe draft status.** Independently checked 30 unique named entries, all open, each with nonempty `name`, `where`, `why`, and `decision`; all 14 excluded operations have corresponding decisions and no matching OpenAPI operation. Inspected all 31 schema definitions and the six published operations:

- GET capabilities; POST observations; POST observations/batch.
- PUT sources/{id}/policy; GET deletions/{id}; GET financial/summary.

Compared the checklist with the normative sections on content, receipts, facts, finance, corrections, answers, episodes, privacy, enrollment and compatibility. The 30 entries cover activity marker, email addresses, attachments, error details, receipt processing, capabilities auth/features, timestamp presence, raw security, batch identity, decimal/FX bounds, currency registry, deletion creation/state categories, 13 other excluded operations, Fact, enrollment/retention, and summary filters.

Confirmed `Activity: false`; required `Email.sender: false` makes Email unsatisfiable; both attachment arrays allow only empty lists; optional `ErrorObject.details: false`; and strict object definitions use `additionalProperties: false`. No Fact placeholder exists. Episodes, corrections, queries, export, connectors, observation detail/history, event detail, financial transactions and deletion creation are omitted rather than invented. `blockedMobileTasks` retains M07, activity/email capture and connectors.

Some schemas deliberately retain provisional structural interpretations: bearer capabilities, nullable-but-required source timestamps, queued-only receipt processing, nonempty batches, required summary from/to, unrestricted three-uppercase-letter currency structure, raw extension object, and string deletion category entries. Each is explicitly associated with an unresolved decision; successful structural validation must not be interpreted as resolution, authorization, ISO registry validation or approved feature support. Raw credential restrictions, summary query cross-field rules, deletion state semantics and decimal storage/FX precision still need decisions and subsequent implementation checks.

### 5. Application and repository boundary

**PASS for this verifier's boundary; UNVERIFIABLE for complete historical B02 write attribution.** This worker accessed only BrainIA-Backend, did not enumerate/read/write BrainIA-Mobile, made no commit, and wrote only this report. No application build, live DB/provider operation, fixture regeneration or dependency install was performed. The existing package diff includes the contracts:verify script plus numerous other changes already present at entry; no claim is made that the entire HEAD diff belongs to B02.

BrainIA-Mobile is forbidden, so its Git/filesystem state was deliberately not inspected. This independently establishes that this verification did not touch it; proving the implementer's historical non-access or unchanged mobile state requires a coordinator-owned prior snapshot or an authorized mobile-repository reviewer receipt. B02-r1's assertion alone is insufficient.

## Discrepancies, conditions and limits

| Severity | Finding | Required disposition |
|---|---|---|
| High / acceptance blocker | Original dual-review/all-required-wire-fields criterion is not met: 30 open decisions and no completed two-repository resolution. | Keep full B02 completion/G1 and dependent implementation blocked; obtain decisions, both reviewer receipts and explicit human approval bound to exact artifacts. Accepted subset status must not close the full task criterion. |
| Medium / evidence limitation | Extensive pre-existing dirty state prevents independent attribution of all B02 writes; mobile historical state cannot be proved without crossing the forbidden boundary. | Coordinator should compare its pre-B02 reservation/snapshot and obtain the mobile review receipt before marking the scope criterion fully verified. |
| Informational / declared limitation | Pure policy, identity and grounding oracles are not E02/E06/E12 application execution; stale correction and deletion replay are deferred. | Preserve explicit deferred status; run later approved endpoint/database/native verification. |
| Informational / integrity model | Verification trusts the supplied manifest; an attacker changing artifacts and resealing can change the bundle identifier. | Preserve the reviewed exact hash in the external G1 approval ledger. Successful local verification alone is not approval. |

No hash mismatch or demonstrated corruption-acceptance defect was found. Conditions for accepting the present deliverable are to retain PROPOSED/UNAPPROVED status, preserve exclusions and blocked tasks, avoid treating this report as G1 approval, and resolve the authorship/reviewer evidence gaps before claiming complete B02 acceptance. Rollback of this verification is removal of this report only; the bundle and application were not changed.
