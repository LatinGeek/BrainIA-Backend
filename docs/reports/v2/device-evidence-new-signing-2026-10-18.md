# Device evidence — new signing identity (2026-10-18)

## Device

| Fact | Value |
|---|---|
| Model | `25069PTEBG` (goya_global) |
| OS | HyperOS 3.0 / MIUI V816, Android 16 (API 36) |
| ADB | `SSU8MVXS65BED64L` |
| App package | `com.brainia.mobile` |

## Install and signing

- Previous app (versionCode 8, old `CN=BrainIA Mobile` certificate) was uninstalled; app-local data cleared.
- New APK installed successfully after enabling HyperOS **Install via USB**.
- Installed version: **8 / 1.0.7**.
- Pulled installed `base.apk` and verified with `apksigner`:
  - `Signer #1 certificate DN: CN=BrainIA Upload, OU=Personal, O=BrainIA, L=Montevideo, ST=Montevideo, C=UY`
  - `SHA-256: de1515ef88c67b0500ef92ac465a4da69a18b24e14d9d0e37f47b952322a8b15`
- APK artifact SHA-256: `c53914047b2f46c16c777b7aff597f91d375945fa07fc82f78fc53d635caa592`.

## Launch

- `topResumedActivity=com.brainia.mobile/.MainActivity`, process alive.
- 300-line PID log window: no `FATAL EXCEPTION`, no ANR, no app-origin crash. Only platform warnings (`HWUI` pipeline cache, MIUI resource reload, SELinux denials for Xiaomi sysfs).
- Screenshot: `docs/reports/v2/device-evidence/new-signing-2026-10-18.png`
  - 299,987 bytes, SHA-256 `2464190407723cfa4f9a7143c5db787a3157adae743f8950f65f4320cc2dbfed`.

## Notification capture readiness

- Notification listener enabled and connected:
  `com.brainia.mobile/com.brainia.mobile.notification.NotificationBridgeService`
- `dumpsys notification` shows the listener registered for user 0.
- The app is a **fresh install**: no enrollment token, no capture consent selection, and no configured API credentials. Actual capture → queue → sync was not exercised.

## What this proves / does not prove

**Proves:** the new upload key produces a valid APK; the APK installs and launches on Android 16/HyperOS; the notification listener component binds and connects; the device is available for further testing.

**Does not prove:** end-to-end capture delivery, durable outbox behavior, v2 auth/enrollment, Play distribution, or signing custody (the key is local and accepted by the owner).

## Remaining device work

1. Configure the app (API base URL + credential/token) and select at least one notification package.
2. Trigger a notification and verify capture → queue → sync receipt.
3. Test upgrade with pending rows, backup/restore, and large-font/TalkBack behavior.
4. Play upload remains blocked by SmartSnippet account verification.
