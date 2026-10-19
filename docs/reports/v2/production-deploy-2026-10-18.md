# Production deployment — 2026-10-18

## Deployment

| Item | Value |
|---|---|
| URL | `https://brain-gelak8cb6-latingeeks-projects.vercel.app` |
| Production alias | `https://brain-ia-six.vercel.app` |
| State | READY |
| Source | local working tree at commit `fca5cf3` + uncommitted docs (deployed by CLI) |
| Region/runtime | iad1, Node 24.x, Fastify |
| Database | Neon, 54 migrations (42→54 applied this session) |

## Auth configuration

- `BRAINIA_REQUIRE_AUTH=true` set in Vercel Production.
- `BRAINIA_CLIENT_KEYS` set as a production secret for the personal owner.
- Local copy of the credentials: `C:\Users\germa\.brainia\production-client.txt` (ACL restricted, not committed).

## Source policies seeded

For `client_scope = brainia-personal`, enabled + send-to-LLM + redaction:

- `capture.wallet`
- `capture.note`
- `capture.email`
- `capture.notification`

Package-specific notification sources (for example a bank app package) still need their own policy rows before their evidence can be sent to a model.

## Smoke tests

| Check | Result |
|---|---|
| `GET /health` | **200** |
| `GET /api/v1/events` without credentials | **401** |
| `GET /api/v1/events` with client credentials | **200** |
| `GET /api/v1/metrics` with owner credentials | **403** (admin-only) |
| `GET /api/v1/intelligence/capabilities` with owner credentials | **200** |

## Rollback

- Code: `vercel rollback` / redeploy the previous deployment (`brain-px4jb2zqh…`).
- Database: additive migrations; rollback is forward-fix, or Neon point-in-time within the 6-hour window. No snapshots exist.

## Remaining app configuration

The installed APK needs Base URL, Client ID, and API key entered in **Ajustes → Avanzado**. MIUI blocks `adb shell input` injection (`INJECT_EVENTS`), so this is either manual on the phone or requires enabling **USB debugging (Security settings)**.

Until configured, the app can reach `/health` but data requests return 401.

## Not done

- Google Play upload (SmartSnippet verification pending; no app created).
- v2 API endpoints (B13+) are not implemented; the app uses v1 routes.
- No database snapshot/restore drill.
- Native capture → queue → sync not yet exercised with the production credentials.

## Notification package policies (2026-10-18)

Seeded for `client_scope = brainia-personal` with `enabled=true`, `send_to_llm=true`, email/financial redaction:

- `uy.com.Santander` (Santander, installed version 11.1.0)
- `com.mercadopago.wallet` (MercadoPago, installed version 2.457.2)

IBKR is **not installed** on the device, so no package name could be verified. The policy will be added once the app is installed and its package name is read from the device.

Note: the app's capture consent selection is separate from these backend policies. The selected packages must also be chosen in **Ajustes → Elegir aplicaciones**.

## IBKR policy

Interactive Brokers is installed as `atws.app` (version 8.4.943). Policy seeded for `client_scope = brainia-personal` with enabled/send-to-LLM/redaction.

Active package policies now: `uy.com.Santander`, `com.mercadopago.wallet`, `atws.app`, plus the four capture channels.

## Device automation limit

The HyperOS developer toggle **Depuración USB (ajustes de seguridad)** is enabled (`checked=true`), but `adb shell input` still fails with `INJECT_EVENTS` even after an adb server restart. Low-level `/dev/input/event5` writes are SELinux-denied. App credential entry and package selection therefore require either a phone reboot/retry or manual entry on the device.

## Runtime database correction and data ownership (2026-10-19)

The first deploy pointed at the legacy `DATABASE_URL`, which still had the old schema and produced 500s (`column amount_role/policy_version/q.owner_id does not exist`). Vercel stores `DATABASE_URL` as a write-only secret, so it could not be read or revealed.

Fix applied:
- Overwrote production `DATABASE_URL` and `DATABASE_URL_UNPOOLED` with the Neon URLs (`POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`) that already had all 54 migrations.
- Redeployed production (`brain-owra6uznl-latingeeks-projects.vercel.app`).

Legacy data claim (single-owner mapping `brainia-personal`, transactional):
- raw_events 1958, classified_events 1955, financial_transaction_events 314, financial_transactions 377, financial_accounts 11, knowledge_facts 4659, event_entities 485, event_relations 1080, event_semantic_anchors 745, personal entities 1096, personal relations 391, aliases 81, merges 63, review queue 101, insight_runs 30, digest_runs 52, diagnostics 7608, model audits 3697.
- Public taxonomy (`entities.type in domain/concept`) was left unowned.

Source policies:
- Seeded for every observed notification source name (e.g. `Santander`, `Mercado Pago`, `IBKR Mobile`, `PedidosYa`, `Prex`, `PayPal`, plus all historical sources). 32 owner policies total.
- Package-name policies remain but capture uses app display names.

## Verified after the fix

| Check | Result |
|---|---|
| `GET /api/v1/events` | 200, **1967** events |
| `GET /api/v1/financial/transactions` | 200, data returned |
| `GET /api/v1/insights/history` | 200 |
| `GET /api/v1/digests/history` | 200 |
| `GET /api/v1/review/aliases` | 200 |
| `POST /api/v1/capture/notification` | **33× 201** in a 10-minute window |
| `POST /api/v1/client-diagnostics` | 202 |
| `GET /api/v1/cron/process-jobs` | **200** after the DB switch |
| Jobs | classification/embedding/semantic succeeded; a few semantic retries fail with `Only entities of the same type can be merged` |

## Remaining known issue

Three semantic-enrichment jobs are dead-lettered and several retry with `Only entities of the same type can be merged`. This is a semantic merge bug, not auth/privacy/DB. It does not block capture or finance.

## Rollback

- Code: previous deployment `brain-gelak8cb6…` or older.
- DB: the legacy database was not modified by the Neon migration; runtime now uses Neon. Reverting `DATABASE_URL` to the previous secret is not possible (write-only); the previous value is not recoverable from Vercel. Neon has 6-hour PITR only.
