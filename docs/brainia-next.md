# Brain IA next

This release adds three independently controlled capabilities: a Spanish graphite workspace, correction-driven classification with Jev shadow evaluation, and source-grounded personal intelligence.

## Rollout

1. Apply `migrations/20260922200339_brainia_next_intelligence.sql` through the existing migration runner.
2. Set `BRAINIA_LEARNING_ENABLED=true` to enable confirmed corrections and reviewed historical application.
3. Configure `TYPESAFE_API_KEY` and set `BRAINIA_JEV_MODE=shadow`. Keep `JEV_VALIDATED_KINDS` empty while collecting decisions.
4. Add confirmed type corrections, then run `npm run evaluate:jev`. This observational report counts one prediction per event, made before its first type correction. Its correction-selected sample is not a held-out benchmark. Independently validate candidate classes on a representative held-out set before adding them to `JEV_VALIDATED_KINDS`; financial classes still require a completed-status decision and 0.99 probability.
5. Change `BRAINIA_JEV_MODE=active`. DeepSeek remains the failure fallback and ambiguous cases remain reviewable.
6. Configure `DEEPSEEK_API_KEY`, optionally `DEEPSEEK_KNOWLEDGE_MODEL`, and set `BRAINIA_INTELLIGENCE_ENABLED=true` after the worker is running.

The knowledge pipeline allows at most six model calls per artifact, uses only source-policy-approved personal evidence, validates exact citation quotes and calculation numbers, runs an independent support check, and fails closed. Hiding or deleting source evidence invalidates dependent content. Inferred claims only become confirmed knowledge after an explicit action tied to that artifact revision.

The UI sends content-free interaction events for screen/action/duration aggregates. Use at least seven days of these aggregates before changing navigation based on measured behavior.

## Release gates

- Run `npm run test:isolated`, `npm run test:intelligence`, and `npm run build` in the backend.
- Run `npm run agent:harness` in the mobile app. It covers loading, empty, editing, capture, transaction, account deletion, and the intelligence flow at 390, 1024, 1440, and 1920 pixels with a mocked local API.
- Complete live Jev evaluation with real shadow decisions, a live DeepSeek run, and physical Android accessibility/performance QA before enabling the corresponding production flags.
