# Reviewed baseline snapshot — backend + mobile

Date: 2026-10-17 (UTC capture). Purpose: establish a reviewed, hash-pinned pre-dispatch snapshot of both repositories so later workers have an attributable starting point. This snapshot records bytes only; it does **not** commit, approve, deploy or migrate anything.

## Snapshot identities

| Repository | Branch | HEAD | Files hashed | Tracked | Untracked (non-ignored) | Manifest SHA-256 |
|---|---|---|---:|---:|---:|---|
| BrainIA-Backend | `main` | `b71c4cc82ca0faa636db656c729e79cb906a9114` | 450 | 319 | 131 | `ea41cb127802a821d01e1991e0f1fd03684214d9342c47552c699695c25cb444` |
| BrainIA-Mobile | `main` | `a526b3498fff63df5374c72c11ab09ccc39d13fc` | 1774 | 1729 | 45 | `596cff0d5dd850bc3798003b6197e2483274b40d0bca6456c860971a4de3af68` |

Machine-readable manifests: `docs/reports/v2/snapshot-backend.json`, `docs/reports/v2/snapshot-mobile.json`. Each entry records repository-relative path, SHA-256, byte size and tracked status. `manifest_sha256` is the SHA-256 of the compact JSON file array, so the file list can be re-verified without trusting the wrapper.

The mobile manifest is stored in the backend report directory deliberately: M00 is read-only in BrainIA-Mobile and may not write there before G1. A mobile coordinator may copy it into the mobile repository later.

## Excluded material

Backend exclusions (names only): `.env.example`, `.env.laya.example`, `.env.production.dbcheck`. No secret values were read or hashed. Tracked templates are reproducible from HEAD; `.env.production.dbcheck` is untracked and must not be committed without an explicit secrets review.

Mobile exclusions: none matched the sensitive-path filter; ignored build output (`android/**/build`, `node_modules`, `dist`) is excluded by `git` ignore rules, not by this snapshot.

## Dirty-state statement

Both working trees were already dirty when the snapshot was taken: backend 83 porcelain entries, mobile 72. All existing uncommitted work is preserved. This snapshot is a baseline for attribution only; it is not a commit, a merge, or an approval of any pending change.

## Re-verification

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File <snapshot-script> -Repo D:/Coding/BrainIA/BrainIA-Backend -OutJson <new>.json
```

Compare `manifest_sha256` before and after a worker's changes; any difference outside that worker's reserved paths is an attributable scope violation.

## Limitations

- Hash equality proves byte identity, not correctness, review or approval.
- Ignored files (secrets, native build output, graphify caches outside git) are not covered.
- `HEAD` remains `b71c4cc`; nothing in this snapshot is committed.

## Post-implementation snapshot — 2026-10-18

After committing the v2 safety foundation and mobile M01/M02, and closing the first condition-debt round:

| Repository | Backend commit | Mobile commit | Files hashed | Manifest SHA-256 |
|---|---|---|---|---|
| Backend | `ccc960d` (plus working changes) | — | 493 | `f537e1c6b375fda662cf20b1ed0c9339c7f1170085072d5eff8793b63afba8a3` |
| Mobile | — | `cd39363` (plus working changes) | 1775 | `a8219cc11e3538f35757230cfea602430dcbaefd55e9f99e00584bea179dd727` |

Machine-readable: `snapshot-2026-10-18-backend.json`, `snapshot-2026-10-18-mobile.json`. Sensitive `.env*` files are excluded by name and now ignored by git. These snapshots are attribution baselines, not approvals.
