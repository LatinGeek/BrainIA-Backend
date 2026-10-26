# Evidence-grounded decisions

BrainIA treats every model output as a proposal until it is supported by the
evidence that was actually supplied, checked deterministically, and accepted by
an independent verifier.

## Policy version

`DECISION_POLICY_VERSION = evidence-grounded-v1`

The server switch is `BRAINIA_EVIDENCE_POLICY`:

| Mode | Behavior |
| --- | --- |
| `off` | Legacy behavior. Verification is not dispatched. |
| `shadow` | Verification runs when a verifier is available; the verdict is recorded but legacy decisions continue to apply. Deterministic failures always block. |
| `enforce` | A decision applies only when deterministic validation and the verifier both accept it. Rejected or unavailable verification leaves the model result unapplied. |

The default is `shadow` so a deploy is additive and can be observed before
activation. Production activation sets `enforce` only after the release gates
below pass.

`DEEPSEEK_VERIFIER_MODEL` selects a verifier model independent of the generator.
It defaults to the configured generator model. Both model identities and both
prompt versions are stored with the decision.

## Decision shape

A generated decision must carry:

- the proposed action and result;
- explicit `evidence` references into the supplied input;
- alternatives considered;
- an abstention reason written in Spanish when evidence is insufficient.

References are resolved against a server-built evidence index. An invented
reference, or an excerpt that is not a literal substring of that reference,
invalidates the decision. Captured notifications, emails and retrieved text are
untrusted data, never instructions. The verifier prompt marks them as such and
never receives the generator's confidence or rationale.

`decision_verifications` stores one row per independent verifier attempt:
generator and verifier models, prompt versions, deterministic outcome,
evidence fingerprint, proposal, verdict, unsupported claims, latency and token
estimate. `semantic_event_decisions.verification` and
`semantic_candidates.verification` carry the decision-level summary.

## Stages covered

- event classification and extraction (`classification-assistant`, JEV);
- semantic placement, identity/path decisions and inferred associations
  (`semantic-enrichment`, `semantic-resolver`);
- digests, proactive insights, inspect summaries and intelligence artifacts;
- post-ingestion graph reconciliation (`semantic-reconciler`).

## What is automatic

Automatic actions are limited to verified assignments to established
categories. New concepts, merges and inferred associations always enter the
review queue. Background reconciliation follows the same rule.

A provider being present in a notification never proves that an order, purchase
or delivery occurred. Concepts that merely restate the provider or notification
heading are rejected deterministically before a verifier is called. True
self-links, duplicate concepts, cycles, unsupported amounts and changes with no
effect never reach the queue. A declined or rejected card attempt is never
placed under spending or card purchases.

Rejections are scoped negative feedback (`semantic_candidate_feedback`). An
equivalent proposal cannot reappear through reprocessing unless its evidence
fingerprint changes.

## Review API

`GET /api/v1/semantic/candidates` keeps every legacy field and adds:

```json
{
  "actionKind": "assign_existing_category",
  "endpoints": {
    "subject": { "id": "...", "canonicalId": "...", "type": "financial_event", "label": "...", "kind": "event" },
    "target": { "id": "...", "canonicalId": "...", "type": "concept", "label": "...", "kind": "category" }
  },
  "evidence": [{ "eventId": "...", "source": "...", "occurredAt": "...", "title": "...", "excerpt": "...", "ref": "event.body" }],
  "verifiedEventCount": 3,
  "verificationStatus": "verified",
  "changeExplanation": "Clasificar «...» en «...». No se crea ningún concepto nuevo.",
  "ruleEligible": true,
  "policyVersion": "evidence-grounded-v1"
}
```

`POST /semantic/candidates/:id/resolve` defaults `createRule` to **false** and
revalidates ownership, policy version, current graph state, evidence availability
and no-effect/cycle/self-link conditions. Stale or invalid approvals return
`409` with `{ error, message, conflict }` and perform no writes. Rules are only
created for eligible repeatable assignments.

The mobile card shows action-specific wording, the source excerpt, date,
destination hierarchy and affected event count. Raw percentages and "Segura" are
not shown. Identically labelled endpoints are distinguished by type. A card
whose verification is rejected or unavailable has no approve path.

## Historical generations

`interpretation_generations` and `event_interpretation_snapshots` stage a full
history without mutating the live graph.

```
npm run reprocess:generations -- create --label "evidence v1"
npm run reprocess:generations -- stage --generation <id> --batch 50 --concurrency 4
# Large histories can be sharded across resumable processes:
#   --shard-index 0 --shard-count 4 (repeat for 0..3)
npm run reprocess:generations -- compare --generation <id>
# Take a rollback baseline immediately before activation.
npm run reprocess:generations -- baseline --label "pre-evidence baseline"
npm run reprocess:generations -- activate --generation <id> --batch 25
npm run reprocess:generations -- rollback
# After activation, verified assignments to established categories can be
# applied automatically; new concepts/merges/associations remain in review.
npx tsx src/scripts/auto-approve-verified-assignments.ts
npx tsx src/scripts/auto-approve-verified-assignments.ts --apply
```

Staging is chronological, resumable and idempotent. It preserves privacy
exclusions and marks blocked events explicitly. Deterministic catalog evidence
(financial, email, trusted smart-home/playback signals) is retained without a
new model call; events without a deterministic category go through generation,
deterministic validation and verification.

The comparison report records changed classifications, changed primary
categories, proposed concepts and associations, abstentions, verifier
disagreements, blocked/failed events and estimated latency/token usage. It is
stored on the generation and written to `output/` as JSON and Markdown.

Activation applies snapshots in batches. Events with a human-approved semantic
decision are not overwritten; the snapshot is blocked with
`human_semantic_decision_preserved` and remains auditable. Human rules and
corrections are preserved. Obsolete machine proposals are marked `superseded`
with a replacement mapping when a new candidate exists. The previous generation
stays available for rollback.

## Current rollout

- Active historical generation: `a3f6dc01-3473-4b0b-9d81-a2eea1570235`.
- 2022 retained events staged, 1687 applied, 335 blocked (260 revalidation
  abstentions, 75 human semantic decisions preserved), 0 failed.
- A pre-evidence baseline generation is retained for rollback.
- Pre-activation comparison: `output/evidence-generation-a3f6dc01-3473-4b0b-9d81-a2eea1570235-pre-activation.md`.
- Production runs with `BRAINIA_EVIDENCE_POLICY=enforce`.
- 80 verified assignments to established categories were applied after
  activation; the remaining queue contains only new concepts and inferred
  associations for human review.
- The screenshot case `PedidosYa notification → PedidosYa notification` is
  superseded and its event is `unclassified` with an explicit abstention. It has
  no semantic relation and never appears as a review card.

## Release gates

- every critical safety fixture passes (`tests/fixtures/evidence-policy/cases.json`);
- held-out review-proposal precision is at least 95%;
- supported existing-category assignment recall is at least 90%;
- existing financial regression tests remain green;
- staging comparison reviewed and approved before activation.

The screenshot case (`PedidosYa notification → PedidosYa notification`) is a
critical negative fixture: BrainIA must abstain or make a verified assignment to
an established category, never show that card.

## Current limitations

- Confidence scores remain in the database for audit and compatibility; clients
  must not present them as human confidence.
- Agent-inspect runs the verifier in enforce mode (or through a test seam);
  shadow mode preserves the historical single-dispatch behavior.
- Intelligence keeps one bounded repair and a six-call cap. The verifier model
  is configurable, but the legacy adapter shape is still accepted.
- Provider usage is estimated when the provider does not return token counts.
