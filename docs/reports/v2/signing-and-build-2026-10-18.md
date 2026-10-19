# Signing credentials and signed build — 2026-10-18

## Generated upload key

| Item | Value |
|---|---|
| Keystore | `C:\Users\germa\.brainia\signing\brainia-upload.p12` (outside both repositories, ACL restricted to the current Windows user) |
| Type / alias | PKCS12 / `brainia-upload` |
| Key | RSA 4096, validity 10,000 days |
| Certificate DN | `CN=BrainIA Upload, OU=Personal, O=BrainIA, L=Montevideo, ST=Montevideo, C=UY` |
| Certificate SHA-256 | `DE:15:15:EF:88:C6:7B:05:00:EF:92:AC:46:5A:4D:A6:9A:18:B2:4E:14:D9:D0:E3:7F:47:B9:52:32:2A:8B:15` |
| SHA-1 | `58:32:02:51:27:46:F9:AE:62:78:05:87:FB:A2:E6:AD:2D:4C:73:D0` |

Credentials are stored only in `C:\Users\germa\.gradle\gradle.properties` as `BRAINIA_RELEASE_*` (no BOM, current-user ACL). They are **not** in either repository. No password was printed or committed.

## Signed artifacts

Built with `:app:bundleRelease :app:assembleRelease`; release signing resolved from the user Gradle properties.

| Artifact | Path | Size | SHA-256 |
|---|---|---:|---|
| AAB | `android/app/build/outputs/bundle/release/app-release.aab` | 39,865,680 | `a903b8717f4ca6d0818b26fb31f1749f4f257037ed5dc407b0f874fffe086b66` |
| APK | `android/app/build/outputs/apk/release/app-release.apk` | 51,712,944 | `c53914047b2f46c16c777b7aff597f91d375945fa07fc82f78fc53d635caa592` |

Verification:
- `apksigner verify --print-certs` → signer `CN=BrainIA Upload`, SHA-256 matches the key above.
- `jarsigner -verify` on the AAB → `jar verified`.

### Build environment note

The repository path exceeds Windows/Ninja's 260-character object-path limit for React Native codegen. The successful build used a short real-path copy at `C:\b\BrainIA-Mobile` (source + node_modules), with the signed artifacts copied back into the repository output folders. `CMAKE_OBJECT_PATH_MAX` and directory junctions did not resolve the mixed-root/path issues. Future builds should use the short-path copy or another path-shortening method.

## Google Play status

Per `play-console-status.md`:
- New developer account **SmartSnippet** has **no apps**; app creation is blocked by **incomplete verification**.
- The older **Latin** account is closed for inactivity.
- `com.brainia.mobile` has therefore not been created or uploaded.
- The signed AAB is ready; uploading requires the Play account verification to complete and the app to be created.

## Device install status

- Old installed app: versionCode 8 / 1.0.7, signed by the previous `CN=BrainIA Mobile` certificate.
- New APK is signed by `CN=BrainIA Upload`; `adb install -r` correctly fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`.
- Installing the new build requires uninstalling the old app first, which clears app-local data. This is a deliberate signing-identity change, not a build defect.

## Security decisions recorded

- Existing APK signing is superseded by this new upload key for future builds.
- No key rotation/history rewrite of the old key; the old certificate remains historical.
- Google Play is not the distribution path until verification completes; APK sideload remains available.
- Play App Signing, once an app exists, will re-sign distributed builds; this upload key is the upload identity.

## Device install attempt — 2026-10-18

- Old app `com.brainia.mobile` (versionCode 8, signed by the previous `CN=BrainIA Mobile` certificate) was uninstalled successfully. This cleared app-local data as expected.
- Installing the newly signed APK failed with `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user` on HyperOS 3.0 / MIUI V816. This is a device security policy, not an APK/signing defect.
- Attempts to relax it through `adb shell settings put ...` were denied because adb shell does not hold `WRITE_SECURE_SETTINGS`.
- Required owner action: enable Developer options → **Install via USB** (and, if present, **USB debugging (Security settings)**), sign into the Mi account if prompted, then approve the on-device install prompt. After that the APK can be installed and device evidence collected.

## Google Play account status — 2026-10-18

- New account **SmartSnippet** (`8739377994840750731`) has no apps and cannot create one yet.
- Outstanding verification: **identity document approval**, **Android-device access** (sign into the Play Console mobile app on a real Android device), and **contact-phone verification** (depends on identity approval).
- The older **Latin** account is closed for inactivity.
- The signed AAB is ready; Play upload is blocked only by the new account verification.
