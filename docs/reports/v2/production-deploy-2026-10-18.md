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
