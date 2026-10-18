# B02-r2 independent verification (r3 re-review appended)

Date: 2026-10-18. Target: `D:/Coding/BrainIA/BrainIA-Backend`. Branch: `main`; HEAD: `b71c4cc82ca0faa636db656c729e79cb906a9114`. Verifier: independent subagent, distinct from the B02-r2 implementer. Read-only: no bundle, source, test, migration, mobile or ledger file was modified. The only file written by this verification is this report.

**B02-r3 update (2026-10-18): the r2 verdict below is historical. B02-r3 fixes F1–F4. Re-verification verdict: accepted-with-conditions.** See "B02-r3 re-verification" at the end of this file for the current hash, checks, and owner-confirmation items. The r2 rejection text below is retained for audit history and must not be read as the current status.

**Verdict (r2): rejected.** The bundle is hash-reproducible and structurally strict, and the exclusion of `POST /api/v2/deletions` is correct, but one schema **widens an owner-confirmed decision**: `Email.attachmentRefs` and `ReceiptContent.attachmentRefs` now accept up to 20 items, while the G1 decision package (#3) and the owner-confirmed `open_decisions` entry in `approvals.json` both say attachment arrays are **empty-only until connector approval**. No connector approval exists in this revision. Under the stated rejection rule ("a widened approved decision"), this revision cannot be accepted as-is. The remaining findings are conditions, not additional rejection triggers.

## Checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | `npm run contracts:verify`; independent SHA-256 recomputation; claimed bundle hash `96a61c0d…c480` | **PASS (integrity)** | Exit 0; 865 checks; every one of the 15 manifest files and the manifest itself independently hashed; all match. See command and hash table below. |
| 2 | `docs/BRAIN_AI_V2_API_CONTRACT_v2.0.0.md` byte-identical to bundle `spec.md` | **PASS** | Both 32,599 bytes; both SHA-256 `7f078a4d…fba7`; `Buffer.equals()` true. |
| 3 | 13 provisional operations have strict paths, scopes, request/response schemas, pagination, error variants, positive/negative fixtures; 17 confirmed decisions encoded | **FAIL (partial)** | All 13 operations are present with scopes and schemas; 17 decisions are mostly encoded. Attachment decision is widened (D1); batch limit conflicts with the owner-confirmed 1–100 (D2); summary filter decision is only partially encoded (D3); callback has no 302 success fixture (D4). See matrix. |
| 4 | `POST /api/v2/deletions` excluded; `openDecisionCount=0`; `approvalReady=false`; 13 operations `implementationBlocked=true` | **PASS** | `openapi.json` has `GET /api/v2/deletions/{id}` but no `post`; `open-items.json` says `excludedOperations:["POST /api/v2/deletions"]`, `approvalReady:false`, `openDecisionCount:0`; all 13 provisional entries have `implementationBlocked:true`. |
| 5 | No forbidden vagueness: `additionalProperties:false`, no free-form objects/placeholders, required fields pinned, closed enums, no silent widening | **PASS structurally; FAIL on widening** | Recursive audit of all 108 `$defs` found 0 object schemas without `additionalProperties:false`; 0 free-form object placeholders. All named enums are closed. The attachment widening is a decision mismatch, not a structural `additionalProperties` defect. |
| 6 | No application/server implementation added; no unrelated files changed | **PASS for B02 window** | `src/` contains no `/api/v2` or `api/v2` match; no `src/routes` change in the B02 write window. B02-window mtimes cover only bundle files, the normative contract doc and `B02-r2.md`. |
| 7 | Six explicitly chosen values review | **CONDITIONAL** | Activity signal types, event types, Fact allowlist/visibility, and currency registry label are new/ambiguous and need owner confirmation. Episode roles match the normative contract. Return route uses the real mobile scheme but the route itself is unverified. See chosen-value review. |
| 8 | Fixture coverage counts; fixtures fail closed | **PASS with one coverage gap** | 136 schema cases = 63 positive / 73 negative; 5 canonical; 7 acknowledgement; 7 identity; 4 policy; 4 grounding; 2 money; 2 deferred. Independent Ajv 2020-12 run matched 61/61 pure-schema negative cases; the 12 semantic negatives are rejected by explicit verifier predicates. Callback has no 302 positive fixture. |
| 9 | Deletion/creation DTOs do not authorize implementation | **PASS** | `DeletionRequest` and `DeletionCreationResponse` are published but have zero `$ref` occurrences in `openapi.json`; only `DeletionState` is referenced by the existing `GET /api/v2/deletions/{id}`. No `POST` operation, route or handler exists. |
| 10 | Scope attribution vs `snapshot-backend.json` | **PASS for B02; broader dirty tree unattributed** | Snapshot (2026-10-17T18:18:16Z): 450 files. 364 unchanged, 86 changed, 58 added relative to snapshot, mostly from other v2 tasks. B02-window edits are limited to the bundle, the contract document and the B02 report. See scope attribution. |

## Command output

Executed from `D:/Coding/BrainIA/BrainIA-Backend`:

```text
> brainia-backend@0.1.0 contracts:verify
> node contracts/brain-ai/2.0.0/verify.mjs

PASS 865 contract checks; 136 positive/negative schema+semantic fixtures; 7 identity sequences.
Bundle manifest SHA-256: 96a61c0d209a6a387bbbd7f3ede5b3dd323b52f2cd77c5223a957d66c253c480
PROPOSED REVISION PENDING REVIEW: 0 open G1 decisions; 13 provisional operation schemas; deletion creation remains excluded. Pure fixture oracles do not certify runtime privacy, database, native capture or grounded synthesis.
```

Exit code: **0** (measured with `$LASTEXITCODE`). Verification itself does not run bundle generators, install dependencies, start the server or touch a database.

## Independent hash table

Computed with `node:crypto.createHash('sha256')` over exact `fs.readFileSync` bytes. No bundle helper (`canonical.mjs`, `seal.mjs`, `verify.mjs`) was imported for this table.

| File | SHA-256 | Manifest match |
|---|---|---|
| `README.md` | `6bbbb4e1c4408724a6826171e8ca462625085c645e6de950893524f90f53617e` | yes |
| `ajv-formats.LICENSE` | `9df3bb69929a3b650ed73b3bfa1756725aaff0ac296461605753547004eafeaf` | yes |
| `ajv.LICENSE` | `a05350a88e318e4f5f2c2a1ff1e2e88daa4dd38e6e78b71cccae422bdc762cc3` | yes |
| `build-bundle.mjs` | `db27608ce103333041e66163683ec5ff498242c1a62a96a94e6105de0bccc905` | yes |
| `build-fixtures.mjs` | `dd0bd35f66933e80a43cb8cd576a83374206ce2a8b79652d002580be3877f78e` | yes |
| `canonical.mjs` | `6be30ad2aa4c48ce3bcbe3f76eb9677592a19c9058e00053116b36c48951c61a` | yes |
| `fixtures.json` | `d2c15f29371cc2337aadc86c99f2e8ece7b38ea07fcce12936bc95045554b154` | yes |
| `open-items.json` | `b8570e14848482a3a617e39e3e395660d602a0e2bd0db9e6c744c3b2c7de57b0` | yes |
| `openapi.json` | `086bfcc7cfeb10d70c1267ba673775887bfca308cc384e8582526e8616b1cfac` | yes |
| `schema.json` | `240b61f9b6777c976ec64dadaade8535a48077613ae1516cce688ae330ad948f` | yes |
| `seal.mjs` | `9618ae503a31ba6bcd1143409f7d687290ff139161f9e55ec65c7ad1d991ad1b` | yes |
| `spec.md` | `7f078a4dc570e335b8fe35e93b0b745962aab1337765f687732cbe39dfb2fba7` | yes |
| `validator-provenance.json` | `32924ea89523951a1d1c51ec63f35daa276c89921e4dfa0f7f5728978f0e7091` | yes |
| `validators.cjs` | `f5cb21ba9e27008ba13eda817c58435f6989c9154ece79ea32fdd2170f02ff65` | yes |
| `verify.mjs` | `5d7ba777af5e3530f9f17506e327906c8524310ece48b4381874b2105144514a` | yes |
| `SHA256SUMS.json` (manifest itself) | `96a61c0d209a6a387bbbd7f3ede5b3dd323b52f2cd77c5223a957d66c253c480` | matches claimed bundle hash |

`SHA256SUMS.json` lists exactly the 15 other files, with no path separators and no self-entry. Manifest file set and actual directory file set are identical. The normative contract equals `spec.md` byte-for-byte.

## Operation coverage matrix

Common error responses for the 13 provisional operations are `400, 401, 403, 404, 409, 413, 422, 429, 503`, each with `Error` body and `X-Request-Id`; 429/503 require `Retry-After`. The callback additionally defines `302` with a required `Location` header and omits `413` (no request body).

| # | Operation | Scope | Security | Request | Success | Pagination | Fixtures (operation DTOs) |
|---|---|---|---|---|---|---|---|
| 1 | `GET /api/v2/observations/{id}` | `capture:read` | global bearer; owner | path `id` | 200 `ObservationDetail` | `revisionsCursor` in response | 1 pos / 1 neg |
| 2 | `GET /api/v2/observations/{id}/revisions` | `evidence:read` | global bearer; owner | path `id`; query `cursor`, `limit` 1–100 | 200 `ObservationRevisionPage` | cursor + limit + `nextCursor` | 2 pos / 2 neg (revision + page) |
| 3 | `GET /api/v2/events/{id}` | `evidence:read` | global bearer; owner | path `id` | 200 `Event` | none required | 1 pos / 1 neg; nested evidence/uncertainty/interpretation exercised in positive |
| 4 | `GET /api/v2/episodes` | `evidence:read` | global bearer; owner | query `sourceInstanceId`, `from`, `to`, `type`, `status`, `cursor`, `limit` | 200 `EpisodePage` | cursor + limit + `nextCursor` | 2 pos / 3 neg (episode + page) |
| 5 | `GET /api/v2/episodes/{id}` | `evidence:read` | global bearer; owner | path `id` | 200 `EpisodeDetail` | none required | 1 pos / 1 neg; member shape nested |
| 6 | `GET /api/v2/financial/transactions` | `finance:read` | global bearer; owner | query `from`, `to` required; `currency`, `lifecycle`, `accountId`, `cursor`, `limit` | 200 `FinancialTransactionPage` | cursor + limit + `nextCursor` | 2 pos / 2 neg (transaction + page); adjustment/evidence nested |
| 7 | `POST /api/v2/corrections` | `corrections:write` | global bearer; owner | body `CorrectionRequest` (18 strict variants) | 200/201 `CorrectionResponse` | n/a | 5 pos / 2 neg request; 1 pos / 1 neg response |
| 8 | `GET /api/v2/export` | `privacy:export` | global bearer; owner | query `types[]`, `from`, `to`, `cursor`, `limit` | 200 `ExportResponse` | cursor + limit + `nextCursor` | 1 pos / 2 neg response; item/record variants nested |
| 9 | `POST /api/v2/queries` | `intelligence:read` | global bearer; owner | body `QueryRequest` | 200 `QueryResult` or 202 `QueryAccepted` | n/a | 1 pos / 2 neg request; 4 pos / 1 neg result; 1 pos / 1 neg accepted |
| 10 | `GET /api/v2/queries/{id}` | `intelligence:read` | global bearer; owner | path `id` | 200 `QueryResult` | none required | 4 pos / 1 neg result; evidence/claim/coverage nested |
| 11 | `POST /api/v2/connectors/email/authorize` | `connectors:write` | global bearer; owner | body `EmailAuthorizeRequest` | 200 `EmailAuthorizeResponse` | n/a | 1 pos / 1 neg request; 1 pos / 1 neg response |
| 12 | `GET /api/v2/connectors/email/callback` | `oauth:callback` | **no bearer** (`security: []`) | query `code` required, `state` required, `error` optional | 302 `Location` | n/a | **no dedicated 302 fixture**; only `ErrorObject` coverage (12 pos / 1 neg error) |
| 13 | `POST /api/v2/connectors/{id}/revoke` | `connectors:write` | global bearer; owner | path `id`; body `ConnectorRevokeRequest` | 200 `ConnectorRevokeResponse` | n/a | 1 pos / 1 neg request; 1 pos / 1 neg response |

The callback is the only operation with `security: []`; all others inherit the global `deviceBearer` scheme. No operation exposes a caller-supplied owner ID.

## Chosen-value review

| Value | Where | Assessment |
|---|---|---|
| Activity `signalTypes`: `still,walking,running,cycling,driving,transit,unknown` | `ActivitySignalType` | **Needs owner confirmation.** No PRD/data-model enum pins these values. Reasonable closed set, but it is a new product taxonomy; `transit`/`driving` collapse platform-specific modes and there is no `on_foot`/`tilting` value. The owner resolution only approved "a closed signalTypes allowlist", not these specific strings. |
| Event `eventType`: `purchase,payment,income,transfer,refund,adjustment,delivery,appointment,communication,other` | `EventType` | **Needs owner confirmation.** The data model mentions purchase/delivery/appointment and financial lifecycle, but no closed canonical event-type enum exists in the PRD/data model. `payment` vs `purchase` boundaries and the `other` fallback need product confirmation. |
| Fact `field` allowlist and `visibility: visible|internal` | `FactField`, `Fact` | **Needs owner confirmation for the exact allowlist and visibility values.** The data model's `extracted_facts` supports `field`, typed value, spans, excerpt hash, method, extractor version, confidence, uncertainty and validation status; it does not pin these 18 field names or the two visibility values. `visibility` is consistent with the privacy boundary (hidden/internal evidence excluded from normal retrieval), but the value set is new. |
| Episode membership roles: `primary,supporting,context` | `MembershipRole` | **Consistent with the normative contract.** `BRAIN_AI_V2_API_CONTRACT_v2.0.0.md` line 105 and the G1 operation note both specify `primary|supporting|context`. No new owner decision appears necessary for this value set. |
| Connector return route: `brainia://connectors/email/callback` | `EmailReturnRoute` | **Needs owner/mobile confirmation.** The mobile app scheme is `brainia` (verified read-only from `BrainIA-Mobile/app.json`), so the scheme is plausible. The exact `connectors/email/callback` route is newly chosen and its mobile handler is not implemented or exercised; the route must be confirmed by the mobile owner before connector work starts. |
| Currency registry label: `ISO4217-CLDR-45` | `Capabilities.currencyRegistryVersion` | **Needs owner confirmation and a runtime registry binding.** The label is only a constant string; the bundle contains no CLDR 45/ISO 4217 table, and `Currency` is only `^[A-Z]{3}$`. The registry version, exponent source and unsupported-code behavior must be confirmed and enforced server-side. |

## Fixture coverage

| Family | Count | Notes |
|---|---|---|
| Schema + semantic cases | 136 | 63 positive / 73 negative |
| Canonical JCS cases | 5 | 4 valid + 1 invalid lone-surrogate case |
| Acknowledgement cases | 7 | matched, replay, arbitrary 2xx, wrong delivery/revision/hash, conflict |
| Identity sequences | 7 | exact replay, duplicate delivery, A-B-A-removed, reordered, reused key, conflicting delivery/producer sequence |
| Policy oracles | 4 | wrong owner, revoked source, private provider denied, private local permitted |
| Grounding oracles | 4 | UTF-16 emoji, wrong owner, fabricated quote, forbidden source |
| Money oracles | 2 | UYU and USD exact decimal refund/net cases |
| Deferred cases | 2 | stale correction, deletion replay; explicitly `runtimeVerified:false` |

Positive/negative operation coverage exists for all 13 operations except the callback success path: there is no fixture for the `302 Location` contract, only `ErrorObject` cases (D4). Several operation entries list nested DTOs (`EventEvidence`, `EpisodeMember`, `FinancialAdjustment`, `ExportItem`, `QueryClaim`, etc.) that are exercised through parent positive fixtures rather than named standalone schema cases; that is acceptable for structural coverage but is weaker than a dedicated negative case per DTO. The `ErrorObject` fixture names use the `Error` schema alias, not a literal `ErrorObject` case.

All 73 negative cases are asserted rejected by `contracts:verify`. An independent Ajv 2020-12 compilation of `schema.json` (installed Ajv 8.20.0 + ajv-formats 3.0.1, no bundle helper) matched 61/61 pure-schema negatives and all pure-schema positives. The remaining 12 negatives are semantic checks that JSON Schema cannot express (UTF-8 byte limits, signed-int64 overflow, fingerprint recomputation, interval ordering, coordinate ranges, policy consistency, query range pairing, Fact span pairing); the bundle verifier rejects them through explicit predicates, and their fixture values were inspected and are genuinely invalid.

## Scope attribution

`docs/reports/v2/snapshot-backend.json` records 450 files (319 tracked, 131 untracked) at `2026-10-17T18:18:16Z`. Comparison against the current tree (excluding `.git`, `node_modules`, `dist`, `.laya-venv`, `.vercel`, `graphify-out`, `supabase/.temp` and `*.log`):

- 364 files unchanged
- 86 files changed since the snapshot
- 58 files added since the snapshot
- 0 files missing

The 86/58 delta is dominated by earlier B04–B11 work (source, tests, migrations, `contracts/schema`, reports, graphify artifacts). The B02-r2 write window (mtimes 2026-10-18 00:14–00:17 local) is limited to:

- `contracts/brain-ai/2.0.0/`: `README.md`, `build-bundle.mjs`, `build-fixtures.mjs`, `fixtures.json`, `open-items.json`, `openapi.json`, `schema.json`, `SHA256SUMS.json`, `spec.md`, `validator-provenance.json`, `validators.cjs`, `verify.mjs`
- `docs/BRAIN_AI_V2_API_CONTRACT_v2.0.0.md`
- `docs/reports/v2/B02-r2.md`

`package.json`, `approvals.json`, `src/`, `tests/`, `migrations/` and mobile were not written in that window. The earlier `package.json`/`contracts/schema` changes are from other tasks, not B02-r2. No `/api/v2` implementation exists in `src/`.

## Confirmed defects

### D1 — Attachment decision widened (rejection trigger, high)

- **Approved text:** G1 decision package #3: "`{ refId, provider?, mimeType?, sizeBytes?, sha256?, expiresAt? }`; **only empty arrays accepted until connector approval**". Owner-confirmed `approvals.json` `open_decisions["attachmentRefs.items"].resolution_detail`: "**empty arrays only until connector approval**; no credentialed URLs."
- **Published schema:** `Email.properties.attachmentRefs.maxItems = 20` and `ReceiptContent.properties.attachmentRefs.maxItems = 20`; no `maxItems: 0`.
- **Effect:** a caller can submit 1–20 attachment refs even though connectors are blocked and no connector approval exists. The r1 verification explicitly observed "both attachment arrays allow only empty lists"; r2 silently widened this.
- **Aggravating ledger inconsistency:** `resolution_record` and `open-items.json` say "max 20 refs", contradicting the G1 package and the owner-confirmed `open_decisions` entry. The implementer followed the wider summary, not the approved decision.
- **Disposition:** reject until the owner explicitly resolves the conflict. If the owner confirms max 20, update the G1 package, `open_decisions` and the ledger in the same approval action and reseal; otherwise restore `maxItems: 0` on both arrays.

### D2 — Batch maximum conflicts with the owner-confirmed limit (medium, not itself a rejection trigger)

- **Approved text:** G1 #10 and `open_decisions["batch.minimumAndMalformedIdentity"]`: "non-empty **1–100**".
- **Published schema:** `BatchRequest.items.maxItems = 50`, `BatchItem.index.maximum = 49`, `BatchResponse.results.maxItems = 50`, `Capabilities.maxBatchItems = 50`.
- **Effect:** this is a narrowing, not a widening, but it changes an owner-confirmed bound; clients that obey the approved 1–100 contract would be rejected above 50. `resolution_record` says 1–50, so the ledger itself is inconsistent.
- **Disposition:** owner must confirm 50 or 100, then align the G1 package, `open_decisions`, `resolution_record`, capabilities and schema.

### D3 — Summary filter decision only partially encoded (medium condition)

- **Approved text:** G1 #30 and `open_decisions["summary.filters"]`: `from`/`to` required, `from <= to`, maximum 366-day range, conversion requires `fxRateId`, currency must be in the approved registry, no defaults.
- **Published contract:** `GET /api/v2/financial/summary` requires `from`/`to`, but `from <= to`, the 366-day maximum, `conversionTo ⇒ fxRateId`, and registry membership are not expressed by any parameter constraint or extension. `conversionTo` and `fxRateId` are untyped `string` parameters; `accountId` is also an untyped `string` rather than `Id`.
- **Fixtures:** the only summary response cases are `original-currency-refund-summary` (positive) and `numeric-money` (negative); no negative fixture covers a reversed range, >366 days, or missing `fxRateId`.
- **Disposition:** before approval, encode the cross-field rules in the operation (or a documented `x-` constraint plus fixtures) and add the missing negatives. This is under-encoding, not a widening.

### D4 — Callback has no success fixture (medium condition)

- The callback operation declares a 302 `Location` contract but `open-items.json` lists only `ErrorObject` fixtures, and `fixtures.json` has no `302`, `Location`, or callback success case. The error path is covered; the success redirect is not.
- The callback also requires `code` unconditionally while allowing an `error` query parameter. A provider error callback normally contains `error` and `state` but no `code`, so that legal error path cannot satisfy the declared parameter schema. The contract text only says "missing/expired state" is invalid; it should explicitly define the provider-error shape.
- **Disposition:** add positive/negative callback fixtures (success Location and provider error) or explicitly narrow the operation to code-bearing callbacks in the normative contract.

### D5 — Minor contract precision items (low)

- `EmailAddress.address` uses `format: "email"`, not a full RFC 5322 validator; the owner text says "RFC 5322 address validation". Ajv's `email` format is a practical subset and may reject/accept differently from RFC 5322.
- `Currency` is only `^[A-Z]{3}$`; it does not enforce ISO 4217 registry membership. Unsupported codes are expected to return `unsupported_currency` at runtime, but the schema itself accepts arbitrary three-letter codes.
- `reviewReasons` is an unconstrained `string[]` in `Event`, `Episode`, `FinancialTransaction`, `CorrectionResponse`, and `QueryResult`; acceptable as human-readable reasons, but it is not a closed enum. If mobile needs stable rendering, an enum or documented vocabulary is preferable.

## Conditions

1. Resolve D1 and reseal; do not approve or import this revision while attachment arrays accept non-empty refs.
2. Resolve the batch-limit conflict (D2) and make the G1 package, `open_decisions`, `resolution_record`, `Capabilities` and `BatchRequest` agree.
3. Encode summary filter cross-field rules and fixtures (D3).
4. Add callback success/error fixtures and clarify the provider-error query shape (D4).
5. Obtain explicit owner confirmation for the six chosen values (activity signals, event types, Fact field/visibility, return route, currency registry label; episode roles are already consistent with the normative contract).
6. Obtain the second repository (mobile) review receipt and a hash-bound owner approval entry. `approvalReady:false` is correct; this verification is not an approval.
7. Keep all 13 provisional operations `implementationBlocked:true`, `POST /api/v2/deletions` absent, capabilities `email/activity/location/episodes/connectors=false`, and M07/email/activity/connectors blocked.

## Unverified assumptions and limitations

- `npm run contracts:verify` uses the bundle's own `verify.mjs` and bundled `validators.cjs`; that is appropriate for the task command, but it is not independent of the bundle. The independent evidence here is the `node:crypto` hash recomputation and the separate Ajv 2020-12 run for pure-schema cases.
- The semantic negatives (byte limits, int64, fingerprint, interval, coordinates, policy, range, span pairing) are verified by the bundle's explicit predicates plus manual inspection, not by a fully independent semantic implementation.
- No ownership/RLS, HTTP handler, database locking, batch atomicity, OAuth provider, mobile import, native capture or grounded synthesis runtime behavior was tested. No production database, server, migration or destructive action was used.
- The mobile repository was not modified; only `app.json`'s `scheme: "brainia"` was read to sanity-check the return route. Mobile route handling remains unverified.
- `contracts:verify` trusts the supplied manifest; a changed bundle could be resealed with a new identifier. The owner must bind the reviewed hash externally in G1.
- Mtime is weaker evidence than a signed change receipt. The snapshot comparison supports scope attribution, but the broader dirty tree contains work from multiple tasks; this report does not claim the entire delta belongs to B02.
- `open-items.json`'s fixture lists name several nested DTOs that do not have standalone schema cases; coverage is through parent positive fixtures. That is structurally adequate but should not be represented as one named case per DTO.

---

# B02-r3 re-verification

Date: 2026-10-18. Re-review of `docs/reports/v2/B02-r3.md` and the resealed bundle. Read-only except this report. The prior r2 rejection was re-tested against the current bytes, not trusted from the r3 report.

**Verdict: accepted-with-conditions.** The r2 rejection trigger is fixed: both attachment arrays are empty-only. F2–F4 are also implemented and fixture-covered. I found no hash mismatch, structural schema defect, widened-approved-decision, authorized excluded operation, or application/server implementation. Acceptance is conditional on the six explicit owner-confirmation items below, the mobile review/hash-bound ledger entry, and the residual conditions and limitations.

## r3 checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | `npm run contracts:verify`; independent 15-file + manifest hash; claimed `666af99f…fb55` | **PASS** | Exit 0; 912 checks; every manifest entry and the manifest itself independently hashed with `node:crypto`; all match. Exact output below. |
| 2 | Normative contract md byte-identical to `spec.md` | **PASS** | Both 34,291 bytes; both SHA-256 `461864a300fd3eb6a611f6f911ef5d111a8ba4e2e013b458858cf08ed31769f1`; `Buffer.equals()` true. |
| 3 | F1: attachment arrays `maxItems: 0`; non-empty negatives rejected | **PASS** | `Email.attachmentRefs.maxItems = 0`; `ReceiptContent.attachmentRefs.maxItems = 0`; `attachment-receipt-nonempty` and `attachment-email-nonempty` each contain one ref and are rejected. `AttachmentRef` remains published as an unreferenced-by-capture DTO. |
| 4 | F2: batch 1–100; 100 valid; 101 invalid; capability 100; 50-invalid fixture | **PASS** | `BatchRequest.items.maxItems = 100`; `BatchResponse.results.maxItems = 100`; both `BatchItem.index.maximum = 99`; `Capabilities.maxBatchItems.const = 100`. `batch-count-max` = 100 valid; `batch-count-limit` = 101 invalid; `capabilities-old-batch-limit` = 50 invalid. |
| 5 | F3: summary `from<=to`, 366-day max, `conversionTo ⇒ fxRateId`, registry membership; negatives present | **PASS with verifier-only note** | Structural: `FinancialSummaryQuery` required `from`/`to`; typed `accountId`/`fxRateId`; `conversionTo` enum `USD,UYU`; `dependentRequired: {conversionTo:[fxRateId]}`; `additionalProperties:false`. Verifier-only: `from<=to` and 366-day maximum in `verify.mjs` semantic predicate, documented by `x-query-constraints`. Structural negatives: conversion-without-rate, unsupported currency, owner field. Verifier-only negatives: reversed range, >366 days. |
| 6 | F4: callback 302 success `Location` fixture and error-without-code shape | **PASS** | `EmailCallbackQuery` requires `state` and exactly one of `code`/`error`; `callbackCases` has 2 valid 302 redirects (success, provider error) and 4 invalid cases (missing state, missing code+error, code+error, insecure location). OpenAPI has required `Location` on 302 and `security: []`. |
| 7 | F5: six chosen values reviewed | **CONDITIONAL** | All six are internally consistent/enumerated, but none is pinned by the PRD/data model as an owner decision. They remain explicit owner-confirmation items. See table. |
| 8 | 13 operations strict/blocked; deletions excluded; no application implementation; spec/openapi consistency; negative rejection | **PASS with one doc condition** | All 13 operations present with scopes and `provisional-operation-schema-unapproved`; all 13 `implementationBlocked:true`; no `POST /api/v2/deletions`; no `/api/v2` in `src/`; 83 negatives rejected. Residual doc issue: spec line 74 still describes singular `signalType`/`intervalStart`/`intervalEnd`/nullable confidence, while line 121 and the schema use `signalTypes[]`/`interval`/required confidence. |
| 9 | Scope attribution | **PASS for B02-r3 window** | Snapshot 450 files; 364 unchanged, 86 changed, 60 added overall. B02-r3-window mtimes cover only bundle files, the contract doc, and the B02-r3 report; no `src/`, `tests/`, migrations, mobile or ledger changes in that window. |

## r3 command output

```text
> brainia-backend@0.1.0 contracts:verify
> node contracts/brain-ai/2.0.0/verify.mjs

PASS 912 contract checks; 152 positive/negative schema+semantic fixtures; 7 identity sequences.
Bundle manifest SHA-256: 666af99fd84d08d43217c380993abcd1540dac66e9a99f618b43a79b2bebfb55
PROPOSED REVISION PENDING REVIEW: 0 open G1 decisions; 13 provisional operation schemas; deletion creation remains excluded. Pure fixture oracles do not certify runtime privacy, database, native capture or grounded synthesis.
```

Exit code: **0**.

## r3 independent hash table

Computed with `node:crypto` over exact file bytes; no bundle helper imported.

| File | SHA-256 | Match |
|---|---|---|
| `README.md` | `57d6743a99881bb988513fc58c1004efbcf3751f0b620b6dce837c88772f6af9` | yes |
| `ajv-formats.LICENSE` | `9df3bb69929a3b650ed73b3bfa1756725aaff0ac296461605753547004eafeaf` | yes |
| `ajv.LICENSE` | `a05350a88e318e4f5f2c2a1ff1e2e88daa4dd38e6e78b71cccae422bdc762cc3` | yes |
| `build-bundle.mjs` | `af4650faa553585a3c85a740e728fd5f217b2d6f31ef9200b4cf44a764d3b208` | yes |
| `build-fixtures.mjs` | `1b25ba03234e0ae442c0b191930b178bd79bc4d615d02e4f56f002eae94ce4a5` | yes |
| `canonical.mjs` | `6be30ad2aa4c48ce3bcbe3f76eb9677592a19c9058e00053116b36c48951c61a` | yes |
| `fixtures.json` | `cfc5b5b063438cb5733de445e971249f6f28b3cfbdaebe5e526b4211c9b1b541` | yes |
| `open-items.json` | `a9bbd64880170914b1e98bac80abce77da21cf66a65b303f8716c158fd5e7cf5` | yes |
| `openapi.json` | `40c4ea56ac31246863811712e555541e195e76c27b2a930ad566ce6f2610cc2c` | yes |
| `schema.json` | `5654550269532eb1515c0633d55515813cece9a096a6722c7a541807351e7113` | yes |
| `seal.mjs` | `9618ae503a31ba6bcd1143409f7d687290ff139161f9e55ec65c7ad1d991ad1b` | yes |
| `spec.md` | `461864a300fd3eb6a611f6f911ef5d111a8ba4e2e013b458858cf08ed31769f1` | yes |
| `validator-provenance.json` | `f75145fbfe85ff53ec58db005ba92fa05bc340bc88ecf03aba4cdb3aebc4d171` | yes |
| `validators.cjs` | `f051ad351d0105e5ef5c19dc54946b482c1667872c756041596765fed9f960db` | yes |
| `verify.mjs` | `fa1617d25bd201af472e03cf49be366250da45038b9783efe647375f7bdc0203` | yes |
| `SHA256SUMS.json` (manifest itself) | `666af99fd84d08d43217c380993abcd1540dac66e9a99f618b43a79b2bebfb55` | yes |

The manifest lists exactly the 15 other files, with no path separators and no self-entry. The reported bundle identifier is the SHA-256 of exact `SHA256SUMS.json` bytes.

## r3 operation counts and fixture coverage

- OpenAPI: 19 paths; 13 provisional operations plus 6 `proposed-subset` operations.
- Schema: 111 `$defs`; recursive object audit found 0 object schemas without `additionalProperties:false` and 0 free-form object placeholders.
- Fixtures: 152 schema cases = 69 positive / 83 negative; 6 callback redirect cases; 5 canonical; 7 acknowledgement; 7 identity; 4 policy; 4 grounding; 2 money; 2 deferred.
- Independent Ajv 2020-12 run: all 69 positives and 69 pure-schema negatives matched. The remaining 14 negatives are semantic (byte limits, int64, fingerprint, interval, coordinates, summary range, policy, query range, Fact span pairing) and are rejected by the bundle verifier's explicit predicates. Their values were manually inspected and are invalid for the stated reason.
- All 13 provisional operations remain `implementationBlocked:true`; `openDecisionCount=0`; `approvalReady=false`; `excludedOperations:["POST /api/v2/deletions"]`.

## r3 chosen-value review — owner confirmation required

| # | Value | Assessment |
|---|---|---|
| 1 | Activity `signalTypes`: `still,walking,running,cycling,driving,transit,unknown` | **Owner confirmation.** The PRD/data model define activity as an interpreted fact but no signal enum. The closed set is a chosen taxonomy; `transit`/`driving` collapse platform modes. |
| 2 | Event `eventType`: `purchase,payment,income,transfer,refund,adjustment,delivery,appointment,communication,other` | **Owner confirmation.** The data model has `canonical_events.event_type` but no closed enum. `payment` vs `purchase` boundaries and the `other` fallback need product confirmation. |
| 3 | Fact `field` allowlist and `visibility: visible|internal` | **Owner confirmation.** The data model defines `extracted_facts.field`, typed value, spans, excerpt hash and validation status, but not this 18-value allowlist or a `visibility` value set. The visibility split is consistent with the privacy boundary but is new. |
| 4 | Episode membership roles: `primary,supporting,context` | **Owner confirmation, with a consistency note.** The data model has `episode_memberships.role` but no enumerated values; the normative contract explicitly lists `primary|supporting|context`. Consistent with the contract, but not pinned by the PRD/data model, so it still needs owner sign-off. |
| 5 | Connector `returnRoute`: `brainia://connectors/email/callback` | **Owner/mobile confirmation.** The mobile scheme `brainia` is real (read-only `BrainIA-Mobile/app.json`), but the exact route is newly chosen and its mobile handler is unverified. |
| 6 | Currency registry label `ISO4217-CLDR-45` with `USD`/`UYU` subset | **Owner confirmation.** No PRD/data model document pins CLDR 45, and the schema restricts summary conversion to `USD`/`UYU` rather than the full ISO 4217 table. Confirm the label, the subset, and the runtime registry binding. |

## r3 conditions

1. Six owner confirmations above; record them in the hash-bound ledger before mobile import.
2. Mobile repository review and explicit owner approval bound to `666af99f…fb55`; `approvalReady:false` is correct and this review is not approval.
3. Confirm whether summary conversion registry membership is intentionally the `USD`/`UYU` subset or the full ISO 4217 registry. This is a narrowing, not a widening, but it changes the approved summary decision if the owner intended full ISO.
4. Confirm the newly added callback provider-error path (`error` without `code` → 302) as part of the provisional callback operation; it is necessary OAuth behavior but was not in the original callback decision text.
5. Fix the stale spec line 74 activity description (`signalType`/`intervalStart`/`intervalEnd`/nullable confidence) so the normative contract is internally consistent with line 121 and the schema. This is a documentation defect, not a schema defect.
6. Keep the verifier-only summary constraints (`from<=to`, 366 days) on the future HTTP handler; `x-query-constraints` documents them, but portable OpenAPI tooling will not enforce them.
7. Keep all 13 operations blocked, deletion creation absent, capability gates false, and M07/email/activity/connectors blocked.

## r3 limitations

- `contracts:verify` uses the bundle's own verifier and bundled validators; independent evidence is the `node:crypto` hash table and the separate Ajv run.
- The 14 semantic negatives are checked by the bundle's predicates plus manual inspection, not by a fully independent semantic implementation.
- No RLS/ownership, HTTP handler, database, OAuth provider, mobile import, native capture or synthesis runtime was exercised.
- The mobile repository was not modified; only its app scheme was read. The callback route and mobile handler remain unverified.
- The manifest is not externally signed; a resealed bundle could get a new identifier. The owner must bind `666af99f…fb55` in G1.
- Mtime and the snapshot comparison support scope attribution but are not a signed change receipt; the broader dirty tree contains work from multiple tasks.
