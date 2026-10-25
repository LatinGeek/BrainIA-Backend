# Event explanation

`GET /api/v1/events/:id/explanation` is a read-only companion to the existing event detail route. It uses the same owner scope and returns 404 for missing or inaccessible events, with `Cache-Control: no-store`.

The response includes original title/body, source, occurrence (`timestamp`) and ingestion (`rawEventCreatedAt`) timestamps, current extracted fields, active human corrections, and visible entity/transaction destinations. Missing historical timestamps remain null; occurrence is never substituted for ingestion. Reused corrections are identified separately from corrections made on this event. Revoked corrections and corrections from protected evidence are excluded.

Classification metadata is explicitly allowlisted: version, provider, model, whether the suggestion was applied, and translated known operational reason codes. Prompts, model responses, rationale, arbitrary metadata, and private reasoning are never returned. No explanation is generated when a stored public reason is absent. Extracted fields identify matching human corrections; when applied corrections prevent reliable field attribution, their origin is unknown.

Private and hidden events omit evidence, fields, corrections and links. The mobile detail also suppresses protected content from the legacy detail response. Source processing policies govern model dispatch, not an expansion of content access.

Verification:

```powershell
node --import ./tests/pglite-setup.mjs --import tsx --test tests/event-explanation.test.ts tests/event-progress.test.ts
```

From the mobile repository, start `npm run web -- --port 8094`, then run `node scripts/event-detail-smoke.mjs`. This uses an isolated browser context with intercepted fixture responses; it does not write to any backend or device. Screenshots are saved under `output/playwright/event-*.png`.
