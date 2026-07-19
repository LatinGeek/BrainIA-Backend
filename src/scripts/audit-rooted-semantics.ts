import { normalizeEntityValue, type EntityDraft } from "../domain/entities.js";
import { SEMANTIC_GOVERNANCE_VERSION, SEMANTIC_PROMPT_VERSION } from "../domain/ontology.js";
import { buildModelSemanticDecision } from "../storage/semantic-enrichment.js";
import { pool } from "../storage/postgres.js";
import { enqueueSemanticCandidate } from "../storage/semantic-repository.js";

const entityId = process.argv.slice(2).find((argument) => argument.startsWith("--entity-id="))?.slice("--entity-id=".length);
const limit = Math.min(100, Math.max(1, Number.parseInt(process.argv.slice(2).find((argument) => argument.startsWith("--limit="))?.slice("--limit=".length) ?? "25", 10)));

const result = await pool.query<{
  id: string; type: string; value: string; normalizedValue: string; metadata: Record<string, unknown>;
  parentId: string; parentType: string; parentValue: string;
}>(`
  select entity.id, entity.type, entity.value, entity.normalized_value as "normalizedValue", entity.metadata,
    parent.id as "parentId", parent.type as "parentType", parent.value as "parentValue"
  from entities entity
  join relations hierarchy on hierarchy.source_entity_id = entity.id and hierarchy.relation_type in ('part_of', 'belongs_to_domain')
  join entities parent on parent.id = hierarchy.target_entity_id
  left join entity_merges merged on merged.alias_entity_id = entity.id
  where merged.alias_entity_id is null and entity.type in ('app', 'merchant', 'sender', 'recipient')
    and ($1::text is null or entity.id = $1)
  order by entity.created_at asc limit $2
`, [entityId ?? null, limit]);

let unchanged = 0;
let proposed = 0;
for (const row of result.rows) {
  const subject: EntityDraft = { type: row.type, value: row.value, normalizedValue: row.normalizedValue, metadata: row.metadata };
  const decision = await buildModelSemanticDecision({
    entities: [subject], source: "durable-entity-audit", inferredKind: "other", title: row.value,
    body: `Classify the durable ${row.type} independently by its ordinary real-world meaning. Do not infer its domain from a transaction, email, or notification that happened to mention it. Select the deepest existing semantic branch that fits.`,
    clientId: null, independentSubjectAudit: true,
  });
  const path = decision.paths.find((candidate) => candidate.subject.normalizedValue === row.normalizedValue);
  const targetValue = path?.hierarchyPath.at(-1);
  if (!path || !targetValue || normalizeEntityValue(targetValue) === normalizeEntityValue(row.parentValue)) {
    unchanged += 1;
    continue;
  }
  await enqueueSemanticCandidate(pool, {
    clientId: null, eventId: null, subjectEntityId: row.id,
    relationType: path.hierarchyPath.length === 1 ? "belongs_to_domain" : "part_of",
    targetType: path.hierarchyPath.length === 1 ? "domain" : "concept",
    targetValue, targetNormalizedValue: normalizeEntityValue(targetValue), confidence: path.confidence,
    rationale: `Independent entity audit: ${path.rationale} Current parent: ${row.parentValue}.`,
    extractor: "deepseek-v2-entity-audit", decisionKind: path.action, domainValue: path.domain, anchorRole: null,
    proposedPath: path.hierarchyPath, alternatives: path.steps.flatMap((step) => step.alternatives),
    associations: decision.associations, recurrenceCount: 1, governanceVersion: SEMANTIC_GOVERNANCE_VERSION,
    promptVersion: SEMANTIC_PROMPT_VERSION, model: decision.model,
  });
  proposed += 1;
}

console.log(JSON.stringify({ governanceVersion: SEMANTIC_GOVERNANCE_VERSION, inspected: result.rows.length, unchanged, proposed, entityId: entityId ?? null }));
await pool.end();
