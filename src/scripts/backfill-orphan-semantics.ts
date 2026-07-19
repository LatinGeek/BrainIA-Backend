import { normalizeEntityValue, type EntityDraft } from "../domain/entities.js";
import { SEMANTIC_GOVERNANCE_VERSION, SEMANTIC_PROMPT_VERSION } from "../domain/ontology.js";
import { buildModelSemanticDecision } from "../storage/semantic-enrichment.js";
import { pool } from "../storage/postgres.js";
import { enqueueSemanticCandidate } from "../storage/semantic-repository.js";

const result = await pool.query<{ id: string; type: string; value: string; normalizedValue: string; metadata: Record<string, unknown> }>(`
  with recursive rooted(entity_id) as (
    select id from entities where type = 'domain' union
    select r.source_entity_id from rooted parent join relations r on r.target_entity_id = parent.entity_id
    where r.relation_type in ('part_of', 'belongs_to_domain')
  )
  select e.id, e.type, e.value, e.normalized_value as "normalizedValue", e.metadata
  from entities e left join entity_merges merged on merged.alias_entity_id = e.id
  where merged.alias_entity_id is null and e.type in ('app','merchant','sender','recipient')
    and not exists (select 1 from rooted where rooted.entity_id = e.id)
    and not exists (select 1 from semantic_candidates candidate where candidate.subject_entity_id = e.id and candidate.status = 'pending')
  order by e.created_at asc
`);

let cursor = 0;
let queued = 0;
let deferred = 0;
const concurrency = Math.min(4, Math.max(1, result.rows.length));
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (true) {
    const row = result.rows[cursor++];
    if (!row) return;
    const subject: EntityDraft = { type: row.type, value: row.value, normalizedValue: row.normalizedValue, metadata: row.metadata };
    const decision = await buildModelSemanticDecision({ entities: [subject], source: "legacy-orphan-reconciliation", inferredKind: "other", title: row.value, clientId: null });
    const path = decision.paths.find((candidate) => candidate.subject.normalizedValue === row.normalizedValue);
    if (!path) {
      const root = decision.rootAlternatives[0];
      if (!root) {
        await pool.query(`update entities set metadata = metadata || $2::jsonb where id = $1`, [row.id, JSON.stringify({ semanticState: "deferred_review", governanceVersion: SEMANTIC_GOVERNANCE_VERSION, reason: "model_returned_no_valid_root" })]);
        deferred += 1;
        continue;
      }
      await enqueueSemanticCandidate(pool, {
        clientId: null, eventId: null, subjectEntityId: row.id, relationType: "belongs_to_domain", targetType: "domain",
        targetValue: root.value, targetNormalizedValue: normalizeEntityValue(root.value), confidence: root.confidence,
        rationale: `DeepSeek could not validate a complete hierarchy for legacy entity ${row.value}. Review its strongest root-domain proposal before it becomes visible in Explore.`,
        extractor: "deepseek-v2-orphan", decisionKind: "root_classification", domainValue: root.value, anchorRole: null,
        proposedPath: [root.value], alternatives: decision.rootAlternatives.slice(1), associations: [], recurrenceCount: 1,
        governanceVersion: SEMANTIC_GOVERNANCE_VERSION, promptVersion: SEMANTIC_PROMPT_VERSION, model: decision.model,
      });
      queued += 1;
      continue;
    }
    const targetValue = path.hierarchyPath[path.hierarchyPath.length - 1]!;
    await enqueueSemanticCandidate(pool, {
      clientId: null, eventId: null, subjectEntityId: row.id,
      relationType: path.hierarchyPath.length === 1 ? "belongs_to_domain" : "part_of",
      targetType: path.hierarchyPath.length === 1 ? "domain" : "concept", targetValue, targetNormalizedValue: normalizeEntityValue(targetValue),
      confidence: path.confidence, rationale: `Legacy orphan reconciliation: ${path.rationale}`, extractor: "deepseek-v2-orphan",
      decisionKind: path.action, domainValue: path.domain, anchorRole: null, proposedPath: path.hierarchyPath,
      alternatives: path.steps.flatMap((step) => step.alternatives), associations: decision.associations, recurrenceCount: 1,
      governanceVersion: SEMANTIC_GOVERNANCE_VERSION, promptVersion: SEMANTIC_PROMPT_VERSION, model: decision.model,
    });
    queued += 1;
  }
}));

console.log(JSON.stringify({ governanceVersion: SEMANTIC_GOVERNANCE_VERSION, inspected: result.rows.length, queued, deferred }));
await pool.end();
