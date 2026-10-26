# Evidence policy for generated content

BrainIA routes generated digests, proactive insights, agent-inspect summaries,
intelligence briefs and semantic reconciliation through the shared evidence
policy in `src/domain/decision-policy.ts` and
`src/storage/decision-verification.ts`.

## Modes

`BRAINIA_EVIDENCE_POLICY` selects `off`, `shadow` (default) or `enforce`.

- `off`: no verifier call; deterministic checks still run.
- `shadow`: the verifier runs and the verdict is recorded, but a rejection does
  not block publication unless deterministic validation fails.
- `enforce`: content is applied only when deterministic checks pass and the
  independent verifier accepts it. `rejected` and `unavailable` verdicts fall
  back to deterministic content.

The verifier model is selected once by `verifierModel()`:
`DEEPSEEK_VERIFIER_MODEL`, then the generator model, then `DEEPSEEK_MODEL`.

## Stage behaviour

| Stage | Evidence | Fallback when not applied |
| --- | --- | --- |
| `digests.ts` | Stable aggregates (`aggregate:total-events`, `aggregate:top-source`, `aggregate:top-kind`, `aggregate:window`, `aggregate:metrics`) plus `event:<id>:title` / `event:<id>:body` excerpts. | `baseDigest.content` (deterministic digest), `model = null`, `summaryAvailable = true`. |
| `proactive-insights.ts` | `candidate:<id>:title`, `candidate:<id>:explanation`, `candidate:<id>:evidence`. Scores and confidence are not evidence. | `buildInsightContent(candidates)`, `model = null`; verification metadata is stored in the insight-run response. |
| `agent-inspect.ts` | Requested query, resolution, authorized root entity/nodes, graph summary and authorized search excerpts. | `summary = null`, `summaryAvailable = false`; structured data is unchanged. The verifier is dispatched in `enforce` (or through the injected test seam); `shadow` keeps the legacy single summary dispatch. |
| `intelligence.ts` | `evidence:<id>:title` and `evidence:<id>:text` from artifact evidence; deterministic citation validation runs first. | Existing bounded repair, then an `insufficient` artifact. The 6-call cap is unchanged. |
| `semantic-reconciler.ts` | Existing independent reconciliation verifier, now using the shared verifier model. | Existing retry/review behaviour; merges and demotions still require accepted verdicts. |

## Invariants

- Numbers in generated prose must match deterministic metrics or supplied
  event/evidence text; the schema `version` field is not checked as a claim.
- Evidence text is untrusted data. Injection instructions inside event titles,
  bodies, entity descriptions or candidate evidence are never system
  instructions; the verifier prompt states this explicitly.
- Privacy authorization, redaction, deletion lineage and tombstone checks are
  evaluated before any generation or verification dispatch. No stage gains a
  new egress path.
- Verification records include status, verifier model, reason and policy
  version. Digest responses expose this as an additive `verification` field;
  intelligence and reconciliation persist model identities in their
  existing checkpoint/result metadata without schema migrations.
- A rejected or unavailable verdict never marks content as published in
  `enforce` mode. Deterministic fallbacks remain available and are preferred
  over unsupported prose.

## Tests

`tests/generated-content-policy.test.ts` covers unsupported totals, verifier
disagreement, proactive fallback, inspect summary omission and prompt
injection. It uses injected completions and an isolated PGlite database; it
does not call the network.
