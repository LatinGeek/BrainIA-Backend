# G1 decision resolution package

Date: 2026-10-17. Status: **APPROVED by the repository owner** — all 30 decisions confirmed. The authoritative record is the `gates[0].resolution_record` in `docs/reports/v2/approvals.json` (ledger v2). 17 decisions are confirmed; 13 endpoint decisions are provisionally authorized for strict schema publication, and the two `deletion.*` decisions (plus the excluded `POST /api/v2/deletions` operation) remain implementation-blocked.

Source decisions: `docs/reports/v2/approvals.json` → `gates[0].open_decisions` (30 entries).
Contract under decision: `docs/BRAIN_AI_V2_API_CONTRACT_v2.0.0.md` + `contracts/brain-ai/2.0.0/` (`312c92f8…abad6`).
Plan authority: `docs/BRAIN_AI_V2_EXECUTION_PLAN.md` §91-93; PRD §56; architecture data model.

## How to read this

Each row proposes a bounded resolution. "C" = can be confirmed now and is safe. "P" = provisional: authorize the B02 contract worker to publish strict schemas/fixtures, but the operation stays capability-blocked until that revision passes `contracts:verify` and independent review. "D" = stays deferred/disabled by design.

Recommended overall posture: confirm all C and P rows, keep all feature gates false, and keep destructive/production actions separately blocked. This unblocks Phase-1 backend work (B06/B08) without enabling any unapproved capture or connector capability.

## Wire and schema decisions (C)

| # | Decision | Proposed resolution | Effect |
|---|---|---|---|
| 1 | `activity.marker` | `activityMarker` enum `observed \| inferred`; `signalTypes[]` from a closed allowlist; `interval {start, end}` ISO-8601 with `end >= start`; `confidence` 0–1. Activity capability stays `false`. | Schema complete; no activity capture enabled. |
| 2 | `email.addresses` | Structured `{ address, displayName? }`, RFC 5322 address validation, max 320 chars. Email sender capability stays `false`. | Schema complete; no email capture. |
| 3 | `attachmentRefs.items` | `{ refId, provider?, mimeType?, sizeBytes?, sha256?, expiresAt? }`; only empty arrays accepted until connector approval; refs are opaque and never URLs with credentials. | Schema complete; no attachment fetch. |
| 4 | `error.details` | Strict discriminated union (`fieldErrors[]`, `retryAfterSeconds`, `conflictId`, `blockedCategory`); no free-form object; optional `details` forbidden until a variant is enumerated. | Stable error contract. |
| 5 | `receipt.processing` | Durable receipts are `queued` only in v2.0.0; later states require a versioned contract revision. | Prevents silent state expansion. |
| 6 | `capabilities.auth` | `GET /api/v2/capabilities` is bearer-protected; response contains no credentials, only booleans + limits. | Matches owner scoping. |
| 7 | `capabilities.featureGates` | Add `features: { email, activity, location, episodes, connectors }` booleans, all default `false`; a capability may only be advertised after its gate evidence exists. | Lets mobile fail closed. |
| 8 | `timestamp.presence` | `sourceOccurredAt` and `sourceUpdatedAt` are required on the wire; `null` means unknown (never “now”). | Deterministic ordering/backfill. |
| 9 | `raw.security` | Per-source raw allowlist: `capture.wallet` (`amount, currency, merchant, transactionType`) and `capture.notification` (`packageName, title, body`). Credential/token/password keys and unknown keys are rejected. Raw payloads only for approved sources. | Privacy boundary explicit. |
| 10 | `batch.minimumAndMalformedIdentity` | Batch must be non-empty (1–100); malformed items return `deliveryId: null` plus a per-item error and index; the valid items still process. | Predictable partial failure. |
| 11 | `decimal.storageAndFX` | Amounts: up to 18 integer digits, exactly ≤6 fractional digits (string); FX rate uses a separate `ConversionRate` DTO with ≤12 fractional digits; storage `NUMERIC(24,6)` for amounts, `NUMERIC(24,12)` for rates. | Matches DB without silent truncation. |
| 12 | `currency.registry` | ISO 4217 + CLDR exponents; round half-even to the currency exponent; unsupported ISO → `unsupported_currency` error; only UYU/USD have confirmed summary fixtures. | No invented FX totals. |
| 13 | `deletion.creationResponse` | 202 `{ deletionId, state: "queued", createdAt, remainingCategories: [] }`; operation remains excluded from implementation until #14 is approved and a deletion worker exists. | Exact response, still blocked. |
| 14 | `deletion.remainingCategories` | Allowlist: `raw_events, derived_knowledge, embeddings, financial_records, connectors, backups`; `blockedAt` nullable ISO timestamp meaning “waiting on the named category”. | Deletion contract complete. |
| 28 | `Fact` | Discriminated `Fact` schema: `factType`, `value` by variant, UTF-16 `evidence.spans[]`, `confidence`, `extractorVersion`, `visibility`; evidence must reference an existing event; no generic placeholder value. | Typed, auditable facts. |
| 30 | `summary.filters` | `from` and `to` required, `from <= to`, max range 366 days; conversion requires `fxRateId`; currency must be in the approved registry; defaults forbidden. | Exact, reproducible finance summaries. |

## Operation decisions (P — provisional authorization to publish strict schemas)

All 14 excluded operations stay excluded from mobile implementation until a B02 contract revision contains their strict request/response schemas, positive/negative fixtures and an independent review. The owner confirmation authorizes that contract work, not implementation.

| Operations |
|---|
| `GET /api/v2/observations/{id}`, `GET /api/v2/observations/{id}/revisions` |
| `GET /api/v2/events/{id}` |
| `GET /api/v2/episodes`, `GET /api/v2/episodes/{id}` |
| `GET /api/v2/financial/transactions` |
| `POST /api/v2/corrections` |
| `GET /api/v2/export` |
| `POST /api/v2/queries`, `GET /api/v2/queries/{id}` |
| `POST /api/v2/connectors/email/authorize`, `GET /api/v2/connectors/email/callback`, `POST /api/v2/connectors/{id}/revoke` |

## Enrollment and retention (C — owner-level)

| # | Decision | Proposed resolution |
|---|---|---|
| 29 | `enrollmentAndRetention` | Adopt the device-to-owner credential registry for the first release; no public enrollment/rotation/logout API. Admin issuance/revocation is owner-controlled and audited. Every capture requires explicit selection; an empty selection is valid and captures nothing. Retention: acknowledged mobile content ≤24 h; pending queue ≤30 days / 10,000 rows / 50 MiB with no silent eviction; backend raw data until user deletion; location 7 days and disabled until consent; online deletion ≤24 h with immediate tombstone; backups expire at 30 days; derived data cannot outlive its supporting permission. |

These are the plan's §93 bounded recommendations. Confirming them is a dated owner decision, not a substitute for production/destructive approval.

## Impact if confirmed

- **Unblocks:** B06 (authorization + RLS wiring), B08 (jobs), and the wire-neutral parts of M01.
- **Does not unblock:** email/activity/location capture, connectors, M07 retrieval UI, production migration, destructive cleanup. Those remain gated by later evidence (G2–G5).
- **Ledger work required after confirmation:** write a new `approvals.json` revision with `resolved_at`, decision references, the contract bundle hash, and the explicit note that operation schemas are provisional. Then re-run `npm run contracts:verify` and independent review before mobile imports the revision.

## Non-negotiables preserved

- Silence or draft status is never approval.
- Production and destructive actions remain separately blocked.
- Any material wire change invalidates dependent approvals until resealed.
- No capability is advertised before its gate evidence exists.
