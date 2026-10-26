# Evidence generation comparison (pre-activation)

- Generation: `a3f6dc01-3473-4b0b-9d81-a2eea1570235`
- Baseline: `c5f2337d-b1a2-403e-951d-9b58a8435801`
- Policy: `evidence-grounded-v1`

| Metric | Value |
| --- | ---: |
| requested | 2022 |
| snapshots | 2022 |
| abstentions | 299 |
| changedClassifications | 18 |
| changedPrimaryCategories | 1173 |
| proposedConcepts | 9 |
| proposedAssociations | 80 |
| revalidationDroppedPaths | 3 |
| verified | 73 |
| rejected | 38 |
| unavailable | 0 |
| notRequired | 1911 |
| inputTokens | 496126 |
| outputTokens | 44301 |
| latencyMs | 5282665 |
| blocked | 335 |
| applied | 1687 |
| failed | 0 |

## Samples

- `0|com.xiaomi.smarthome|0|FCM-Notification:36748284|10310`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":"home.automation.device_alert","abstained":false,"verificationStatus":"not_required"}
- `md_1783983499458`: {"inferredKind":"expense","primaryCategoryKey":null} → {"inferredKind":"expense","primaryCategoryKey":"finances.spending.card_purchase","abstained":false,"verificationStatus":"not_required"}
- `gmail:germanlamela98@gmail.com:<40324b74-a2ca-45cf-bfe4-06f8412b3455@priority.instagram.com>`: {"inferredKind":"email","primaryCategoryKey":null} → {"inferredKind":"email","primaryCategoryKey":"communication.email.activity","abstained":false,"verificationStatus":"not_required"}
- `gmail:germanlamela98@gmail.com:<0100019f65706f4b-69a73c21-8cbd-445a-b185-57e62aa4e221-000000@email.amazonses.com>`: {"inferredKind":"email","primaryCategoryKey":null} → {"inferredKind":"email","primaryCategoryKey":"communication.email.activity","abstained":false,"verificationStatus":"not_required"}
- `gmail:germanlamela98@gmail.com:<818b32f0-f30e-4ccf-997d-8484a5556d41@us2.make.com>`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"}
- `0|com.xiaomi.smarthome|0|FCM-Notification:36052798|10310`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":"home.automation.device_alert","abstained":false,"verificationStatus":"not_required"}
- `0|paganza.android|0|FCM-Notification:251788995|10338`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"verified"}
- `gmail:germanlamela98@gmail.com:`: {"inferredKind":"email","primaryCategoryKey":null} → {"inferredKind":"email","primaryCategoryKey":"communication.email.activity","abstained":false,"verificationStatus":"not_required"}
- `gmail:germanlamela98@gmail.com:<66de117f-3ada-43dc-a159-83fbbe9229f7@make.com>`: {"inferredKind":"email","primaryCategoryKey":null} → {"inferredKind":"email","primaryCategoryKey":"communication.email.activity","abstained":false,"verificationStatus":"not_required"}
- `md_1784134187686`: {"inferredKind":"expense","primaryCategoryKey":null} → {"inferredKind":"expense","primaryCategoryKey":"finances.spending.card_purchase","abstained":false,"verificationStatus":"not_required"}
- `0|com.xiaomi.smarthome|0|FCM-Notification:219740417|10310`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":"home.automation.device_alert","abstained":false,"verificationStatus":"not_required"}
- `0|com.xiaomi.smarthome|0|FCM-Notification:39843869|10310`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":"home.automation.device_alert","abstained":false,"verificationStatus":"not_required"}
- `0|paganza.android|0|FCM-Notification:251802519|10338`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"verified"}
- `gmail:germanlamela98@gmail.com:19f6718ce2411927`: {"inferredKind":"other","primaryCategoryKey":null} → {"inferredKind":"other","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"}
- `md_1784163736234`: {"inferredKind":"expense","primaryCategoryKey":null} → {"inferredKind":"expense","primaryCategoryKey":"finances.spending.card_purchase","abstained":false,"verificationStatus":"not_required"}
- `md_1784167734053`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"verified"}
- `0|com.xiaomi.smarthome|0|FCM-Notification:251309852|10310`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":"home.automation.device_alert","abstained":false,"verificationStatus":"not_required"}
- `0|com.spotify.music|2131430294|null|10316`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":"entertainment.music","abstained":false,"verificationStatus":"not_required"}
- `0|uy.com.Santander|0|FCM-Notification:143243092|10328`: {"inferredKind":"expense","primaryCategoryKey":null} → {"inferredKind":"expense","primaryCategoryKey":"finances.spending.card_purchase","abstained":false,"verificationStatus":"not_required"}
- `0|com.xiaomi.smarthome|1064701965|null|10310`: {"inferredKind":"other","primaryCategoryKey":null} → {"inferredKind":"other","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"}
- `0|uy.com.Santander|0|FCM-Notification:143278169|10328`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"rejected"}
- `0|com.mercadolibre|-938013950|null|10325`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"}
- `0|com.xiaomi.smarthome|0|FCM-Notification:6305223|10310`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":"home.automation.device_alert","abstained":false,"verificationStatus":"not_required"}
- `0|com.ubercab|3|d9843777-c75f-46ee-8a60-6ab71eeacb3e||switchboard-no-prefer-local|switchboard|10326`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"verified"}
- `0|com.mercadolibre|-1404125593|null|10325`: {"inferredKind":"notification","primaryCategoryKey":null} → {"inferredKind":"notification","primaryCategoryKey":null,"abstained":true,"verificationStatus":"not_required"}
