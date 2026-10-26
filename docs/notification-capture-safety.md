# Notification capture and financial classification safety

## Immutable Android observations

The Android notification key identifies a mutable notification slot. The native bridge retains it in `raw.notificationKey` and derives a separate immutable observation identity for `id`, `externalId`, and `idempotencyKey`.

Observation IDs use the `notif:v2:` namespace and SHA-256 over UTF-8 length-framed fields: a version marker, a persisted installation UUID, the original slot key, app/package names, title, body, occurrence timestamp, notification tag, and complete raw snapshot. The native raw object is constructed in a fixed field order. Identical reconciliation reads and retries retain the same ID across process restarts; text/raw changes at the same timestamp, later occurrences, and different installations get separate IDs. Changing only one of the three identity fields would still conflict with the backend's other identity checks.

The installation UUID persists in the existing private notification preferences. No evidence is overwritten and no database migration is required. Existing legacy IDs remain unchanged; the first v2 observation of a legacy notification is a separate capture, with financial consolidation remaining responsible for linking evidence to an existing transaction. The generic capture contract version remains 1; the identity namespace version is independent.

A 409 conflict is terminal for that exact observation. The bridge retains a bounded set of 128 conflicted IDs instead of retrying them every reconciliation cycle. A changed notification produces a different ID and remains eligible. Transient errors still follow existing retry behavior. Conflicts are recorded as diagnostics, not marked as successful forwarding.

## Offers and completed payments

The deterministic classifier is versioned as `heuristic-v4`. Promotional offers, subscription invitations, currency-exchange advertising, balance notices, and order follow-ups remain notifications. A standalone amount does not establish spending. Explicit settlement signals still recognize short payment notifications, including Prex `Gastaste`, card transactions, and `payment approved`.

Completed payment evidence takes precedence over promotional footers in a real receipt. The classification assistant cannot turn a recognized non-transactional notice into a financial event. It can correct an unconfirmed heuristic expense into a notification, including an equal-confidence correction. Confidence follows the retained answer; a rejected model answer cannot inflate it. Explicit financial captures and completed transactions stay protected, and durable human corrections are applied after automated classification as before.

No historical classification or ledger record is rewritten by this change. Historical cleanup requires a separately scoped review and must preserve hidden transactions and human decisions.

## Verification

- `tests/notification-safety.test.ts` checks revision ingestion/retries, immutable legacy evidence, promotional ledger suppression, adversarial model suggestions, completed payments, confidence ownership, and human overrides. It is included in the default test command and discovered by `test:isolated`.
- Android JVM tests cover stable observation IDs, every snapshot field, same-time changes, installation isolation, UTF-8, and unambiguous field boundaries.
- `npm run test:isolated` uses an isolated PostgreSQL-compatible engine. It does not certify real multi-connection concurrency.
- Run Android notification tests with `gradlew.bat :app:testReleaseUnitTest --tests "com.brainia.mobile.notification.*"` and build with `:app:assembleRelease`.

Rollout requires the backend classification change and the rebuilt Android app. Installing the APK alone does not update the hosted classifier. No paid provider evaluation or bulk reprocessing is part of verification.
