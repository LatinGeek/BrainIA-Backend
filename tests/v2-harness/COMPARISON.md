# Reproducible interpretation comparisons

Run from `BrainIA-Backend` with the existing Node dependencies installed (`npm ci` for a fresh checkout):

```powershell
npm run eval:interpretation
npm run test:eval:interpretation
npm run eval:interpretation -- --candidate tests/v2-harness/compare-configs/regression-demo.json --report tests/v2-harness/artifacts/comparison-regression-verification.json
npm run eval:interpretation -- --candidate tests/v2-harness/compare-configs/synthetic-replay.json --report tests/v2-harness/artifacts/comparison-replay-verification.json
```

Exit 0 means the candidate satisfies the supplied policy. Exit 1 means a policy breach, adapter error, unsafe environment, or invalid input. The current checkout intentionally fails the strict default policy: do not treat `FAIL` as a broken evaluation tool. Read the JSON and Markdown pair written to `tests/v2-harness/artifacts/interpretation-comparison.{json,md}`. Regression-demo must fail with exactly one newly regressed field: case `expense-uyu`, `amount`, expected `1733.00`, observed `1.73`, configuration `deliberate-amount-regression`. Other baseline deficiencies remain visible separately.

No API key, server, database, device, or paid service is required. The existing `safety.mjs` boundary installs before application imports, rejects inherited production/remote targets, strips credentials, blocks network transports, and uses a never-connected database sentinel. It does not read `.env`. Run in a clean test shell if inherited production settings are rejected. A caught network denial still fails the comparison. Adapters are reviewed repository code, not a security sandbox for hostile modules. This workflow never migrates, starts workers, or changes stored events.

## Dataset and labels

`tests/fixtures/interpretation-comparison/v1.json` contains 17 hand-specified synthetic scenarios and 20 observations covering expenses, income, own-account transfers, email messages/receipts, irrelevant and rejected notifications, balance-only ambiguity, unknown dollar currency, missing merchants, explicit categories, repeated captures, distinct same-value purchases, and shared references across bank/email sources. Accented Spanish, UYU `1.733,00`, USD `1,733.00`, decimals and bare `$` are preserved as UTF-8. Names, account IDs and references are synthetic; email domains use `.invalid`. There are no production samples.

Every case includes input events, expected output, and the reason for that expectation. These are machine-authored labels awaiting independent review; the corpus is a small regression suite, not a representative statistical estimate of user traffic. Create a new version for approved label changes; never tune expectations merely to turn failures green. Dataset byte hashes are recorded in every report. The much larger existing v2 corpus, its adjudication requirements, and E01–E12 instrumentation gates are unchanged.

## Baseline and candidate contracts

`--baseline`, `--candidate`, `--dataset`, `--criteria`, and `--report` select JSON files. Relative paths resolve from the backend root. Reports must be directly inside the existing artifacts directory. Preserve useful evidence under distinct report names before subsequent runs.

Configurations require a distinct `id`, `mode`, reviewed `.mjs` `adapter` under `tests/v2-harness`, and explicit `model`/`promptVersion` (null for rules). A rules adapter exports `revision` and `async evaluate(input, config)`; optional `classificationVersion` identifies the existing classifier. The runner passes cloned inputs/configuration only, never expected answers. Return `{ observations, crossRelationships, usage, cost, prompts, limitations }`. Each observation has its event ID and all seven scored fields. Unknown/unavailable values must be explicit null, not fabricated measurements. Return prompts as `{ version, systemPrompt }` for hashing. Usage and costs may be null; only measured adapter values are retained, with no price multiplication or inferred costs. The default adapter reports null for both.

The default baseline and candidate both run the current checkout. To compare an actual rule or prompt change, preserve the baseline implementation as a reviewed, self-contained adapter (including its dependencies), then point the candidate to its changed implementation. Changing a configuration label does not load historical Git code. Both configurations record the actual source checkout hash; the runner cannot reconstruct an old version from a version string. Archive the checkout or commit and its dependency lockfile alongside reports. The source manifest hashes all TypeScript under `src`, harness modules, package manifest and lockfile, including dirty source bytes. Every result references its full configuration ID/hash; complete configuration snapshots, adapter revision/hash, classifier version, source file hashes, Git HEAD/dirty flag, Node version, dataset hash and criteria are in the report.

`mode: replay` uses the existing `createClassificationAssistant` with an injected deterministic completion function. Supply `model`, the executed `promptVersion` (currently `classification-v3`), and `responses: { eventId: "JSON response text" }`. The checked-in replay deliberately returns a generic synthetic notification suggestion; these responses are not the oracle and are not model-quality evidence. It exercises parsing, merge protection, the production prompt and subsequent domain projection. Missing responses and mismatched prompt versions fail. Executed system-prompt hashes are recorded per case; the complete prompt implementation is covered by source hashes. To change prompt wording, use a reviewed candidate adapter/implementation; a version string alone does not change prompt execution.

## Metrics and acceptance policy

The runner measures exact-case accuracy and exact field agreement for event type, exact decimal amount string, currency, merchant, category, typed relationships with endpoints, and review requirement. Each field includes numerator/denominator, Wilson interval, and a nonempty-expected slice to expose inflation from null/empty expectations. Relationships include a separate cross-capture observation per case. Arrays use exact canonical order; adapters should sort relationships consistently. Merchant/category strings are exact: normalization changes should be intentional and reviewed. Null means no projected value; it is not equivalent to a missing field. Extra or duplicate observations fail exact-case accuracy. An adapter exception fails all its case fields.

A regression is a field that matched the oracle in baseline and fails in candidate. Reports also retain all pre-existing failures and improvements. Each failed case lists expected and observed values; JSON retains baseline and candidate observations/configuration references. Local adapter latency samples and p95 include lazy imports and are not production-stage or provider latency. Quality scores are deterministic; timings and an optional timing gate vary by host and warmup.

`compare-configs/acceptance.json` is the configurable acceptance policy: maximum regressed fields, minimum exact-case accuracy, minimum accuracy for every field, and an optional maximum local candidate p95 in milliseconds. Defaults require perfect fixture agreement and zero introduced regressions, with no latency gate. A team may choose reviewed lower absolute thresholds to grandfather known deficits; error and network-denial gates always apply. Never weaken the corpus to approve a candidate. Small-sample confidence intervals do not establish release readiness.

For comparison-tool verification, `--criteria tests/v2-harness/compare-configs/regression-only.json` accepts unchanged field quality and rejects the deliberate amount fault solely because it regressed. This policy disables absolute quality floors and is not a release approval policy.

The read-only default adapter calls the same classification, entity, relation, and financial projection functions as the existing interpretation harness. Category observations come from the actual candidate, including user-captured categories. Review requirement is explicitly the candidate's review reasons, or unresolved financial/other evidence when no candidate exists. It does not claim to observe the semantic governor's final review queue or UI. Cross-capture consolidation requires storage integration; the default adapter returns no cross links, and the two cases expecting links fail visibly. No simulated deduplicator is substituted. Use a separately reviewed isolated adapter for that capability; never connect this runner to production.

## Optional real-provider work is separate

This command has no live mode, never calls real providers, and rejects `--live`. Existing exploratory provider scripts such as `src/scripts/evaluate-laya.ts` and `src/scripts/evaluate-jev.ts` are separate workflows and are not invoked by this runner. Any future live capture must be an explicit, reviewed command using only synthetic/anonymized inputs, no production database, and observed provider model/prompt revision, request parameters, latency and usage receipts. Do not add live calls to the default adapter. Persist those responses and provenance as immutable, reviewed replay configuration/evidence, then evaluate them offline here. Replay execution latency is not the original provider latency; do not substitute one for the other. No real-provider quality or cost result is claimed by these verification artifacts.

## Verification results (2026-10-25)

- `npm run test:eval:interpretation`: 17 tests passed, including existing v2 safety/corpus tests, deterministic reruns, production-prompt replay and configurable policy checks.
- `npm run lint`: passed.
- Default comparison: 12/17 exact cases, zero introduced field regressions. The strict policy correctly exits 1 for existing oracle mismatches: irrelevant weather, balance-only notification, captured merchant relationship, repeated capture linking, and multi-source evidence linking.
- Deliberate regression: 11/17 candidate exact cases and exactly one new regression, `expense-uyu.amount` (`1733.00` → `1.73`), with candidate ID/hash in both report formats. The regression-only policy rejects this solely for the new fault; it accepts the unchanged candidate with exit 0.
- Synthetic prompt replay: current assistant executed with `classification-v3` and system prompt hashes; no real model ran. Quality changes, including a relationship regression, remain visible.
- All recorded comparisons report zero provider calls and zero denied network attempts. Usage and cost are unavailable/null. No production data or device was accessed.

Retained JSON/Markdown evidence: `artifacts/interpretation-comparison`, `artifacts/comparison-regression-verification`, `artifacts/comparison-replay-verification`, and `artifacts/comparison-policy-{pass,fail}`. The repeat-run artifacts are generated by tests to compare stable scores; latency is deliberately excluded from equality checks.
