# Play Console status — read-only inspection

Inspected: 2026-10-18, America/Montevideo (2026-10-19 approximately 00:54–00:59 UTC).
Target package: `com.brainia.mobile`.

## Result

**SmartSnippet is not yet verified and cannot currently create an app. No app exists in that account.** A separate open account, Latin, is closed for inactivity. Neither account currently provides a usable path to upload the target app.

All Console operations were navigation and reading. No app was created, no AAB/APK was uploaded, no release was started, no settings or credentials were changed, no agreements were accepted, and no verification workflow was started. This report contains no secrets or private contact details.

## 1. Developer accounts and verification

Two different developer IDs were present in the existing Chrome tabs; their findings are kept separate.

| Account | Developer ID | Observed status |
| --- | --- | --- |
| SmartSnippet | 8739377994840750731 | Personal account; setup incomplete; identity, Android-device access, and contact-phone verification each show action required. |
| Latin | 6667662254116094197 | Closed for inactivity. Identity-verification status was not shown on the accessible policy page. |

### SmartSnippet — primary account

Source: [Console home / app list](https://play.google.com/console/u/1/developers/8739377994840750731/app-list?onboardingflow=signup).

Observed account-verification requirements:

1. **Identity:** action required. Console requests an official identity document and says verification may take several days. The identity-start button was not used.
2. **Android-device access:** action required. Console instructs the owner to sign into the Play Console mobile app to demonstrate access to a real Android device. [Device-verification details link shown by Console](https://play.google.com/console/u/1/developers/8739377994840750731/account/issues/device-verification/details).
3. **Contact phone:** action required. Console explicitly says identity verification and Google's approval of identity documents must be completed before phone verification. [Phone-verification details link shown by Console](https://play.google.com/console/u/1/developers/8739377994840750731/account/phone-verification-issue-details).

Those detail links are recorded as visible navigation targets, not as separately inspected forms. Exact document types, identity-form fields, and phone verification method were not inspected.

### Latin — separate existing account

Source: [Policy status](https://play.google.com/console/u/0/developers/6667662254116094197/policy-center). The developer-account selector identified the account as Latin.

Console reports account closure for inactivity, with these displayed dates:

- Warning sent: 8 February 2026.
- Warning deadline: 9 April 2026.
- Closed: 16 April 2026, 1:37 p.m. (page timezone not specified).

The policy page states that publishing requires creating a new account. Home navigation and the Console logo did not leave the policy page; the app list was therefore inaccessible. No assumption is made about historical apps or identity verification for Latin.

## 2. Apps, versions, releases, and signing

| Requested information | SmartSnippet | Latin |
| --- | --- | --- |
| App list | Empty. Console displays its first-app onboarding state. | Inaccessible through the closed-account policy page. Historical app count unknown. |
| Package name | No app/package registered is shown; `com.brainia.mobile` is the requested target only. | Not observable. |
| versionCode / versionName | Not applicable: no Console app or uploaded artifact is shown. | Not observable. |
| Track / release status | No app and no release/track to inspect. | Not observable. |
| App integrity: app-signing certificate SHA-256 | Unavailable: no app-specific App integrity page exists to inspect in the empty account. | App integrity inaccessible. |
| Upload-key information / certificate SHA-256 | Unavailable in Console for the empty account. No key enrollment, certificate, or reset status could be inspected. | Inaccessible. |

No certificate fingerprint was inferred or fabricated. These findings do not establish whether a local signing keystore exists; local keys and secrets were outside this inspection.

## 3. Current creation and upload eligibility

**SmartSnippet — create app: blocked, directly confirmed.** Console explicitly instructs the user to complete account verification before creating new apps, and its Create app control is disabled. Identity is one confirmed blocker; Android-device and phone checks are also outstanding.

**SmartSnippet — upload: currently unavailable for this target.** There is no app to upload into, and app creation is blocked. This conclusion follows from the observed empty account and disabled creation control; no upload endpoint or artifact submission was tested. The page also says account setup must be completed to publish.

**Latin — create/upload: unavailable under the closed account.** The policy page states that a new developer account is required to resume publishing. No bypass was attempted.

## 4. Next fields and decisions for com.brainia.mobile

### Immediate prerequisite

The owner must complete SmartSnippet's outstanding account verification, including identity-document approval, Android-device verification, and contact-phone verification. Phone verification depends on identity approval. No verification information was submitted during this inspection.

### Creation form after the block is cleared

**The live creation form is inaccessible because Create app is disabled. Its exact account-specific labels, defaults, and any additional requirements cannot be confirmed.** The following is Google's current documented creation sequence, not a claim that the blocked form was opened.

| Field / decision | Input or decision still needed |
| --- | --- |
| App name | Choose the public display name; BrainIA is a proposed value only. |
| Default language | Choose the initial listing language. |
| App or game | Choose the application type; App is the proposed choice. |
| Free or paid | Owner must decide pricing. |
| User contact email | Supply an app-support email. |
| Declarations | Review Developer Program Policies, US export-law declarations, and Play App Signing Terms of Service. Owner acceptance is required in a future authorized creation session. |
| Create app | Final submission, only after verification and the above decisions. Not performed. |

Source: [Google Play Console Help — Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en), checked during inspection.

Google's documented initial form does not list a package-name field. The Android artifact must identify the app with `applicationId = "com.brainia.mobile"`; Android documents that this ID identifies the app on Google Play and becomes the final manifest package. Package availability/ownership was not validated by an upload. [Android Developers — Set the application ID](https://developer.android.com/build/configure-app-module#set-application-id).

Signing configuration is a later first-release decision: Google documents choosing a Google-generated app-signing key or an app-signing key supplied by the developer. No choice was made. [Google Play Console Help — Configure Play App Signing](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en#zippy=%2Cconfigure-play-app-signing).

## 5. Verification and limitations

- Findings were read from the signed-in Console accessibility state; SmartSnippet's name, ID, verification tasks, empty app state, and disabled creation control were directly visible.
- Existing secondary Console tabs timed out when being selected. Their already observed policy URL was successfully inspected through the responsive primary tab instead. That tab was then restored to its original SmartSnippet home URL and checked.
- Latin's app list and app-specific pages were inaccessible through its closed-account navigation. SmartSnippet's creation form and app-specific pages were unavailable as described above.
- Only this report was written. No source changes, dependency installation, tests, or commits were needed. Existing untracked `docs/reports/v2/G0-evidence-2026-10-18.md` was preserved.
- Repository at inspection: branch `main`, HEAD `e9952fd2e88ea0659770b04aa7e42acd9ad7401d`.
