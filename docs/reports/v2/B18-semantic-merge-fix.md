# B18 — Same-type semantic merge fix

Date: 2026-10-18 (America/Montevideo). Base: `main`, `583a3a5c61a9a3e93bc20e19e90140b5a7ff234f`.

## Root cause

`mergeEntities` correctly rejects canonical roots with different entity types. `consolidateProviderIdentity` selected every unmerged non-taxonomy entity with a matching normalized name and attempted to merge it into the app, including merchants, senders, and notifications. Semantic enrichment calls this function while materializing graph drafts, so one such match aborted the transaction and failed the background job. The query also lacked a same-owner restriction.

Candidate approval and alias review had additional unguarded paths. Reconciliation already checked snapshot types during selection, but its prompts did not prohibit cross-type proposals, application did not recheck resolved roots, and proposal-level review counts lost rejected siblings in partially accepted merge batches.

## Exact caller audit

| Caller | Finding and disposition |
| --- | --- |
| `src/storage/semantic-repository.ts`, `consolidateProviderIdentity`, reason `provider_identity_normalization` | Confirmed cross-type producer: matching name across every non-domain/non-concept type. Now selects only same-owner matches, checks current root types, and records incompatible matches in canonical entity metadata `providerIdentityMergeSkips`. Taxonomy records remain excluded. |
| `src/storage/semantic-repository.ts`, `resolveSemanticCandidate`, reason `semantic_review` | Candidate target type or explicitly selected target could differ from the subject. Now checks current canonical roots; incompatible approvals remain pending with an idempotent `[Merge skipped: entity_type_mismatch]` rationale and `skipReason` response. No relation, rule, competing-candidate rejection, or approval follows a skip. Default mismatched targets are skipped before target creation. |
| `src/storage/entity-alias-repository.ts`, `resolveEntityReview`, reason `review_entity_match` (review to explicit target) | Arbitrary target could differ in type. Preflight before graph merges; queue remains pending with mismatch reason. |
| Same function, reason `review_friendly_name` | Draft uses target type, but upsert resolves canonical IDs and can return a different legacy root. Check actual friendly root before applying either selected-target merge or friendly-name merge. |
| Same function, reason `review_entity_match` (existing alias to selected/friendly target) | Existing alias could belong to a different type. Preflight all existing alias identities before the first merge to prevent a partial unification. |
| Same function, reason `shared_alias` | Shared alias is not evidence of same type. Preflight review and alias canonical roots before choosing merge direction or reassigning the alias. |
| `src/storage/semantic-reconciler.ts`, reason `llm_post_ingestion_reconciliation` | Existing snapshot type filter retained; owner matching and self-merge exclusion added. Both prompts require equal types and owners. Application rechecks roots and counts incompatible pairs as review instead of invoking merge. Review counts now include rejected siblings of partially accepted proposals. |
| `src/routes/entity-merge.ts` | Explicit user merge endpoint can accept arbitrary entity pairs. Existing owner checks and strict repository rejection remain unchanged; outside worker write scope and not an automatic enrichment producer. |
| `src/storage/data-controls.ts`, `recordKnowledgeFeedback`, reason `user_feedback` | Explicit user feedback can supply arbitrary canonical ID. Existing ownership checks and invariant remain unchanged; outside worker write scope and not an automatic enrichment producer. |
| `src/scripts/reconcile-semantic-governance.ts`, reason `identity_concept_duplicate` | Confirmed unconditional concept-to-app merge at the audited line 58. Standalone maintenance script is outside authorized files; not changed or run. Reported to coordinator. It still requires a separate design decision rather than relaxing the invariant or coercing types. |
| `src/storage/classification-assistant.ts`, local `mergeEntities` | Unrelated local function combines draft lists; does not call the storage merge API. |

The shared `semanticMergeSkipReason` helper lives in semantic-repository and checks canonical root types and owner equality. The storage invariant in `entity-repository.ts` is unchanged. Public domain/concept hierarchy links remain valid cross-type relations and are not mistaken for identity merges.

Reconciliation's independent verification request also now receives the existing privacy authorization. Previously that second request omitted it, causing the model wrapper to fail closed and reconciliation to stop at verification. The authorization, recheck, confidence, independent agreement, concept-parent, and user-identity protections are preserved; the integration regression exercises both authorized model passes with a local fetch stub.

## Files changed by this worker

- `src/storage/semantic-repository.ts`
- `src/storage/semantic-reconciler.ts`
- `src/storage/entity-alias-repository.ts`
- `tests/semantic-merge-types.test.ts`
- `docs/reports/v2/B18-semantic-merge-fix.md`

No entity types, migrations, contracts, v2 implementation files, mobile files, production data, or Git index were changed by this worker. Other workers changed shared-worktree files during execution; those changes were left intact.

## Verification

All integration tests use `tests/pglite-setup.mjs`, which creates an in-memory PostgreSQL engine and overrides the configured connection. No production database or external model request is used.

| Command | Result |
| --- | --- |
| `npm run lint` | Retried after a concurrent worker supplied missing `src/domain/v2/contracts.ts`; exit 0, no TypeScript diagnostics. Initial attempt exited 1 for missing contracts imports in out-of-scope v2 files; reported to coordinator without editing them. |
| `npm run build` | Exit 0. |
| `node --import ./tests/pglite-setup.mjs --import tsx --test tests/semantic-merge-types.test.ts tests/semantic-governance.test.ts` | Exit 0: 22 tests, 22 passed, 0 failed (10 new merge regressions and 12 existing governance tests). |
| `npm run test:isolated` | Exit 0: 212 tests, 212 passed, 0 failed, 0 skipped; 311,877 ms. Includes all 10 new merge regressions. |

The new regression explicitly seeds a merchant sharing a provider app's name, claims a real `semantic_enrichment` job, executes it, publishes downstream effects through completion, and asserts stored job status `succeeded`, null error, a recorded provider skip, and no merchant merge. Additional cases cover the unchanged strict invariant, default and explicit candidate mismatches, all alias-review branches, valid friendly-name and same-type merges, cross-owner skips, public concept-to-domain hierarchy, a legacy app-to-merchant canonical redirect checked before friendly-name mutation, and a malicious cross-type reconciliation sibling that receives positive model verification but still remains review while its valid same-type sibling applies.

An initial new-test run passed 8/9: the compatibility assertion incorrectly read the existing alias success response at `status` instead of `review.status`. The assertion was corrected without changing that public response, and the full targeted rerun passed.

## Revision 2 - owned-entity creation (verification finding C2, 2026-10-19)

### Behavior root cause

The independent verification (`V2-final-verification-2026-10-19.md`, C2) showed a fail-closed regression on owned data. `upsertEntity` never set `owner_id`, so any entity it newly created was ownerless. Two flows create such an entity and then compare it with an owned identity:

- **Friendly-name alias review with an explicit target.** `resolveEntityReview` creates the friendly-name entity.
- **Default-target semantic merge approval.** `resolveSemanticCandidate` creates the merge target.

The new owner check (`semanticMergeSkipReason`) correctly rejected the owner mismatch. As a result, both flows stayed `pending` with `entity_owner_mismatch` for any owned subject or target, and left a stray ownerless entity behind. At the base commit both flows had instead merged the owned identity into the ownerless root, which was a latent owner-boundary defect. The original regression tests did not show the problem because they used only ownerless entities.

### Fix

- **`src/storage/entity-repository.ts`.** `upsertEntity(db, draft, { ownerId })` writes `owner_id` only when it inserts a new row. On a conflict it never changes an existing row's owner, so it cannot claim or reassign another identity. `domain`/`concept` drafts always stay ownerless, which matches the public-taxonomy trigger. Existing callers pass no owner and keep their exact prior behavior.
- **`src/storage/entity-alias-repository.ts`.** The friendly-name entity is created with the canonical target's `owner_id`.
- **`src/storage/semantic-repository.ts`.** For a merge with a default target, the new target inherits the owner of the subject's canonical root. Before the upsert, an existing `(type, normalized_value)` identity is checked with `semanticMergeSkipReason`. A cross-owner (or cross-type) match is therefore skipped without the upsert rewriting the other owner's value, description or metadata. Association, reuse and hierarchy targets are unchanged and remain public/ownerless as before.
- **Unchanged:** the strict `mergeEntities` invariant, the owner/type preflight, and public taxonomy handling.

### Tests added (`tests/semantic-merge-types.test.ts`)

- **Owned friendly-name review with an explicit same-owner target.** Resolves the review. Exactly one friendly entity is created, owned by the owner. The review entity and the target both merge, and no ownerless entity remains.
- **Owned default-target semantic merge approval.** The candidate is approved. Exactly one same-owner target is created, and the subject merges into it.
- **Cross-owner rejection.** A default target that names another owner's identity stays `pending/entity_owner_mismatch`, and the foreign entity's owner and description are untouched. A friendly name that belongs to another owner also stays `pending/entity_owner_mismatch`, with no merges. A `concept` upserted with an owner stays ownerless.

The results of the targeted and full runs are recorded in the addendum to `V2-final-verification-2026-10-19.md`.

## Residual risk

- The standalone governance maintenance script still explicitly requests a cross-type merge and must not be treated as fixed by this patch.
- Explicit manual merge/feedback endpoints still rely on the strict invariant for invalid cross-type requests; their response semantics are outside this task.
- Incompatible identities remain distinct and pending review; no historical data repair, type coercion, reprocessing, deployment, commit, or push was performed.
- Provider skip metadata represents observed same-owner legacy matches; reconciliation review counts are returned through its existing result rather than introducing a new review table or migration.
- Canonical compatibility is checked immediately before semantic merges using the existing transaction/semantic-lock behavior. Arbitrary concurrent type mutations outside that coordination still have the strict repository invariant as their final guard.
