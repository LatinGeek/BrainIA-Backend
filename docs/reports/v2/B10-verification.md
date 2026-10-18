# B10 independent verification — currency ambiguity and financial evidence safety

**Verdict: ACCEPTED WITH CONDITIONS (third pass, r3).**

The r3 remediation closes N1–N3. Independent probes reproduced the requested behavior:

- **N1:** a real authenticated wallet/event capture with `raw_events.owner_id = null` and `client_id = owner-a` attaches the transaction to owner-a's account, sets `financial_transactions.owner_id = owner-a`, updates owner-a's balance, and confirms a bare `$` from the owned account's currency. A foreign account is still rejected, stores no account, leaves the foreign balance at `0`, and exposes no foreign label.
- **N2:** `GET /financial/summary` now validates against the v2 `FinancialSummary` schema: exact top-level keys, `excluded` exactly `ambiguous/unsupported/pending`, string `from`/`to`, and HTTP 400 `invalid_financial_summary_query` when the range is missing.
- **N3:** an unknown amount role remains reviewable as `posted` with `unknown_amount_role`, but `amount_confirmed=false`; it is excluded from confirmed totals, balances, proactive insights and intelligence aggregates.

D1–D9 and the A–H regression set remain sound. No reproducible wrong-currency total, unsafe merge, cross-owner leak, inflated evidence count, contract violation on the summary response, or destructive migration was found.

Date: 2026-10-18. Repository: `D:/Coding/BrainIA/BrainIA-Backend`, branch `main`, HEAD `b71c4cc82ca0faa636db656c729e79cb906a9114`, worktree dirty. Inputs: `docs/reports/v2/B10-r3.md`, prior r1/r2 verification, task specification lines 413–443, PRD/data model/evaluation, API contract v2.0.0, current source/migrations/tests, snapshot, B04/B06 reports.

No source, test, migration, manifest, mobile, auth, privacy, job, or deletion file was edited. No commit, dependency install, production database, or external model call was used. All database execution used `tests/pglite-setup.mjs` (in-memory PGlite, provider keys blanked). Probe scripts were written outside the repository under `C:/Users/germa/AppData/Local/Temp/opencode/`. Required runs rewrote ignored `tests/v2-harness/artifacts/latest.json`; `build` wrote ignored `dist`; the only repository file updated by this verification is this report.

## Required command results

| Command | Exit | Independent observation |
|---|---:|---|
| `npm run lint` | 0 | `tsc -p tsconfig.json --noEmit`; no diagnostics. |
| `npm run build` | 0 | `tsc -p tsconfig.json`; no diagnostics. |
| `node --import ./tests/pglite-setup.mjs --import tsx --test tests/v2-finance-safety.test.ts` | 0 | 19 tests / 19 pass / 0 fail / 0 skipped. |
| `npm run test:isolated` | 0 | 193 tests / 193 pass / 0 fail / 0 skipped, including 8 B06 and all B10/D1–D9/N1–N3 regressions. |
| `NODE_OPTIONS='--import ./contracts/schema/preload-isolated.mjs'; npm run schema:verify -- --read-only` | 0 | `{"ok":true,"readOnly":true,"problems":[]}`. |
| `node --import tsx contracts/schema/verify.test.mjs` | 0 | PASS baseline 54 applied checksummed migrations / 1972 catalog objects; reconciliation/ACL/drift/partial-roll-forward/idempotency PASS. Real-Postgres and `pg_dump` restore remain BLOCKED. |
| `npm run contracts:verify` | 0 | PASS 382 contract checks; 58 fixtures; 7 identity sequences. Bundle SHA-256 `312c92f8…abad6` unchanged. |
| `npm run test:v2 -- --suite E01,E03,E05` | 1 | `E01: FAIL; 50 pass / 450 fail / 0 blocked of 500`; `E03: BLOCKED; 0/0/200`; `E05: BLOCKED; 0/0/100`. |

The r3 report's stated exits match these exactly.

## N1 — real HTTP capture with owner-scoped accounts

Independent authenticated probe (owner-a and owner-b, accounts inserted directly; no manual `raw_events.owner_id` update):

```json
{
  "ownWallet": {
    "status": 201,
    "raw": { "owner_id": null, "client_id": "owner-a" },
    "row": {
      "owner_id": "owner-a",
      "account_id": "account_a_...",
      "amount": "55.00",
      "currency": "UYU",
      "currency_status": "explicit",
      "review_reasons": []
    },
    "balance": "-55.00",
    "foreignLabelExposed": false
  },
  "ownEvent": {
    "status": 201,
    "row": { "owner_id": "owner-a", "account_id": "account_a_...", "amount": "10.00", "review_reasons": [] }
  },
  "ownAmbiguous": {
    "status": 201,
    "row": {
      "owner_id": "owner-a",
      "account_id": "account_a_...",
      "amount": "12.00",
      "currency": "UYU",
      "currency_status": "account_confirmed",
      "review_reasons": []
    }
  },
  "foreignWallet": {
    "status": 201,
    "row": { "owner_id": "owner-a", "account_id": null, "amount": "77.00", "review_reasons": ["foreign_account_ignored"] },
    "ownerBBalance": "0",
    "foreignLabelExposed": false
  }
}
```

Both `POST /api/v1/capture/wallet` and `POST /api/v1/events` attach owner-a's own account. The materialized rows carry the effective owner, so the owner-scoped balance join counts them. The foreign path stores no account ID, keeps the review reason, leaves owner-b's balance unchanged, and does not expose owner-b's label to owner-a. `listFinancialAccounts` also has a read-only fallback for historical `owner_id`-null transactions whose evidence event carries the same `client_id`.

## N2 — summary contract conformance

Authenticated `GET /api/v1/financial/summary?from=…&to=…`:

```json
{
  "status": 200,
  "topKeys": ["asOf", "conversion", "excluded", "from", "to", "totals"],
  "excludedKeys": ["ambiguous", "pending", "unsupported"],
  "fromType": "string",
  "toType": "string",
  "contractValid": true
}
```

The response was validated with the v2 bundle's own `FinancialSummary` validator (`contracts/brain-ai/2.0.0/validators.cjs`) and passed with no additional properties. `excluded` no longer exposes `unknown` or `unconfirmedAmount`; legacy accounting is retained only through the internal `getFinancialSummaryExclusionDiagnostics` helper (verified: legacy UNKNOWN row still reports `unknown=1` internally while the wire response omits it).

Missing range behavior:

- no `from`/`to`: HTTP 400 `invalid_financial_summary_query`;
- only `from`: HTTP 400 `invalid_financial_summary_query`;
- only `to`: HTTP 400 `invalid_financial_summary_query`.

The mandatory-range change is a documented client-visible behavior change, consistent with the v2 contract.

## N3 — unknown amount roles

```json
{
  "unknownCandidate": { "role": "posted", "confirmed": false, "reasons": ["unknown_amount_role"] },
  "unknownRow": { "amountConfirmed": false, "reviewReasons": ["unknown_amount_role"], "amount": "80.00" },
  "totals": [{ "currency": "UYU", "expense": "80.00", "transactionCount": 1 }],
  "balance": "-80.00"
}
```

Two 80.00 UYU rows were created, one explicit `posted` and one `amountType: "mystery_adjustment"`. Only the explicit row contributes to the confirmed summary and account balance. The unknown-role row remains listable with its review reason. No migration/role-value change was required.

## D1–D9 regression

| Item | Result | Evidence |
|---|---|---|
| D1 cross-owner account | **PASS** | Foreign repository/HTTP attach stores `account_id=null`, `foreign_account_ignored`, B balance `0`; own account attaches and updates A balance; no foreign label exposed. |
| D2 unsafe auto-merge | **PASS** | Three same-shape clear observations stay three rows (`300.00`, count 3, `possible_duplicate_pending_review` on repeats); shared native reference merges (`native_reference_match`, evidence 2); unknown role separate. |
| D3 bare `$` / `currencyConfirmed` | **PASS** | `UNKNOWN`/`ambiguous`; summary totals empty, `excluded.ambiguous=1`; E01 abstention 100/100, currency precision 100%, hard gate true. |
| D4 insight/LLM aggregates | **PASS** | Prior 100 UYU; current 200+50 UYU plus ambiguous `$300` → insight/aggregate current 250, previous 100; no 400/550 total. |
| D5 negative amounts | **PASS** | `-100,00 UYU` stores `100.00`, adds `negative_amount_normalized_by_kind`, reports expense 100.00 / net -100.00. |
| D6 strict decimals | **PASS** | Rejects `1.733`, `1,733`, `100.000`, `1.2.3`, `12.34.56`; accepts `1.733,00`, `1,733.00`, `1733,00`, `1.733.000,00`; malformed candidate null. |
| D7 uncertain evidence | **PASS** | Same-reference `100.0000` precision-excess observation keeps confirmed 100.00, `amountConfirmed=true`, review reason retained, unconfirmed wire count absent. |
| D8 legacy UNKNOWN | **PASS (diagnostic)** | Totals exclude it; wire contract omits the internal bucket; `getFinancialSummaryExclusionDiagnostics` reports `unknown=1`. |
| D9 FX governance | **PASS with condition** | RLS true; anon/authenticated revoked; unapproved 409; approved conversion -2.50; approved update/delete immutable. Four-eyes remains unenforced. |

## A–H regression

- **A — fixtures:** exact adds/subtracts/multiplies, quantize and FX rounding pass; converted evidence persists only with a rate id; without one it is null with `conversion_without_approved_rate`.
- **B — ambiguity:** candidate/stored/display `UNKNOWN`; excluded from summary, balances, matching, insights and intelligence; E01 transaction currency `UNKNOWN`.
- **C — evidence/merge:** merge evidence count 2, one canonical 40.00 total; three reference observations count 3; replay counts once; no inflation.
- **D — reports:** USD `income 10.00 / expense 4.00 / net 6.00`; UYU `income 25.50 / expense 100.00 / net -74.50`; implicit conversion `fx_rate_required`; multi-currency `fx_rate_scope_unsupported`; single approved conversion -2.50.
- **E — owner scope:** A cannot read B's transaction/summary; B06 8/8 pass; foreign account rejected; own account now works via route.
- **F — migration/schema:** 54 migrations / 1972 objects; no migration in r3; additive prior migrations; schema and contract verify pass. Real-PG remains BLOCKED.
- **G — E01:** FAIL 50/450, not BLOCKED. Unknown-currency abstention 100/100, currency precision 250/250, `currencyHardGate=true`; 100 ambiguous cases still fail on value status, 200 on merchant/value recall, 50 have no extracted transaction. E03/E05 remain BLOCKED. The r3 report states this honestly.
- **H — scope:** r3 changed only `src/domain/financial-transactions.ts`, `src/storage/financial-transaction-repository.ts`, `src/routes/financial-transactions.ts`, `tests/v2-finance-safety.test.ts`, and `docs/reports/v2/B10-r3.md` in the 23:53–00:01 window. No migration, manifest, contract bundle, mobile, auth, privacy, job, or deletion file changed. `event-store.ts` was not edited by r3. No out-of-bound production write found. Snapshot attribution remains limited by concurrent B05–B11 work.

## Remaining conditions

1. **E01 still FAIL (50/450).** Currency abstention and precision pass, but the read-only adapter still hard-codes extracted value status `confirmed` and has merchant/amount recall gaps. E01 is a required verification suite; E03/E05 remain BLOCKED.
2. **FX approval is not four-eyes.** `approved_by` is recorded but not policy-enforced; any table writer can approve a rate. `fx_rates` RLS has no policy for a restricted runtime role.
3. **Historical data not remediated.** Pre-r2 foreign-account rows, legacy bare-dollar rows rewritten to UYU, and ambiguous evidence rows are not reclassified. The new balance fallback only covers `owner_id`-null transactions with matching `client_id`.
4. **Real PostgreSQL BLOCKED.** PGlite cannot certify production RLS, role behavior, concurrency, locking or restore.
5. **Mandatory summary range is a breaking client change.** It matches the v2 contract and returns the documented 400, but clients that omitted `from`/`to` must be updated.

## Disposition

**ACCEPTED WITH CONDITIONS.** N1–N3 are independently verified, and the prior rejection criteria are not reproducible: no wrong-currency total, unsafe merge, cross-owner leak on new writes, inflated evidence, contract-violating summary response, or destructive migration. Remaining conditions are E01/E03/E05 gate status, real-PostgreSQL evidence, historical-data remediation, and FX approval governance. Fixes and gate exceptions must be delegated/approved by the implementation owner and Supervisor; this verifier does not edit code or tests.
