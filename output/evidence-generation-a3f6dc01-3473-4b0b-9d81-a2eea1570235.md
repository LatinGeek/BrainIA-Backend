# Evidence generation comparison

- Generation: `a3f6dc01-3473-4b0b-9d81-a2eea1570235`
- Generated: 2026-10-26T04:57:28.642Z
- Policy: `evidence-grounded-v1`

## Counts

| Metric | Value |
| --- | ---: |
| Requested events | 2022 |
| Snapshots | 2022 |
| Staged | 1687 |
| Applied | 1687 |
| Blocked | 335 |
| Failed | 0 |
| Abstentions | 299 |
| Changed classifications | 0 |
| Changed primary categories | 53 |
| Proposed concepts | 9 |
| Proposed associations | 80 |
| Paths dropped by activation revalidation | 3 |
| Existing pending machine proposals for these events | 10 |
| Verifier verified | 73 |
| Verifier rejected | 38 |
| Verifier unavailable | 0 |
| Verification not required | 1911 |
| Estimated input tokens | 496126 |
| Estimated output tokens | 44301 |
| Staging latency (ms) | 5282665 |

## Samples

- `gmail:germanlamela98@gmail.com:<40324b74-a2ca-45cf-bfe4-06f8412b3455@priority.instagram.com>`: {"inferredKind":"email","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"email","primaryCategoryKey":"communication.email.activity","abstained":false,"verificationStatus":"not_required"} (human_semantic_decision_preserved)
- `gmail:germanlamela98@gmail.com:<818b32f0-f30e-4ccf-997d-8484a5556d41@us2.make.com>`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"} (human_semantic_decision_preserved)
- `gmail:germanlamela98@gmail.com:<18540acb-4452-4aba-bfba-00359f6685c1@us2.make.com>`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"} (activation_revalidation_abstained)
- `gmail:germanlamela98@gmail.com:`: {"inferredKind":"email","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"email","primaryCategoryKey":"communication.email.activity","abstained":false,"verificationStatus":"not_required"} (human_semantic_decision_preserved)
- `md_1784134187686`: {"inferredKind":"expense","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"expense","primaryCategoryKey":"finances.spending.card_purchase","abstained":false,"verificationStatus":"not_required"} (human_semantic_decision_preserved)
- `0|com.xiaomi.smarthome|0|0|com.xiaomi.smarthome|g:Aggregate_AlertingSection|10310|0|com.xiaomi.smarthome|g:Aggregate_AlertingSection`: {"inferredKind":"other","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"other","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"} (activation_revalidation_abstained)
- `gmail:germanlamela98@gmail.com:19f6756653f113c9`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"} (human_semantic_decision_preserved)
- `gmail:germanlamela98@gmail.com:19f6718ce2411927`: {"inferredKind":"other","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"other","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"} (activation_revalidation_abstained)
- `md_1784163736234`: {"inferredKind":"expense","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"expense","primaryCategoryKey":"finances.spending.card_purchase","abstained":false,"verificationStatus":"not_required"} (human_semantic_decision_preserved)
- `md_1784167734053`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"verified"} (human_semantic_decision_preserved)
- `md_1784163799335`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"rejected"} (human_semantic_decision_preserved)
- `0|com.xiaomi.smarthome|1064701965|null|10310`: {"inferredKind":"other","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"other","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"} (activation_revalidation_abstained)
- `0|uy.com.Santander|0|FCM-Notification:143278169|10328`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"rejected"} (human_semantic_decision_preserved)
- `0|com.xiaomi.smarthome|0|FCM-Notification:145070961|10310`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":"home.automation.device_alert","abstained":false,"verificationStatus":"not_required"} (human_semantic_decision_preserved)
- `0|com.mercadolibre|-1404125593|null|10325`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"} (activation_revalidation_abstained)
- `0|com.ubercab|5|191955c1bde63e55cf4362533d5b7b15|10326`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"} (activation_revalidation_abstained)
- `0|com.mercadolibre|-1120933960|null|10325`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"rejected"} (activation_revalidation_abstained)
- `0|com.xiaomi.smarthome|0|FCM-Notification:219370886|10310`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"verified"} (activation_revalidation_abstained)
- `0|com.xiaomi.smarthome|0|FCM-Notification:219999247|10310`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":"home.automation.device_alert","abstained":false,"verificationStatus":"not_required"} (human_semantic_decision_preserved)
- `0|com.xiaomi.smarthome|0|FCM-Notification:221641015|10310`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":"home.automation.device_alert","abstained":false,"verificationStatus":"not_required"} (human_semantic_decision_preserved)
- `0|com.mercadolibre|1674564424|null|10325`: {"inferredKind":"other","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"other","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"} (activation_revalidation_abstained)
- `0|com.amazon.mShop.android.shopping|1|null|10367`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"} (activation_revalidation_abstained)
- `0|com.instagram.android|64278|newstab|57161165992_new_follower&656d365e83694Hd4f122ca8H656d3af7e3966H65|10318`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"verified"} (activation_revalidation_abstained)
- `0|com.xiaomi.smarthome|0|FCM-Notification:238823851|10310`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":"home.automation.device_alert","abstained":false,"verificationStatus":"not_required"} (human_semantic_decision_preserved)
- `0|com.instagram.android|64278|276413868-ig_new_followers-newstab|10318`: {"inferredKind":"notification","primaryCategoryKey":null,"processingStatus":"classified"} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"} (activation_revalidation_abstained)
