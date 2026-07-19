import { normalizeEntityValue } from "../domain/entities.js";
import { SEMANTIC_GOVERNANCE_VERSION, SEMANTIC_PROMPT_VERSION } from "../domain/ontology.js";
import { pool } from "../storage/postgres.js";
import { enqueueSemanticCandidate } from "../storage/semantic-repository.js";

type DecisionJson = {
  model?: string;
  paths?: Array<{ role?: string; domain?: string; hierarchyPath?: string[]; confidence?: number }>;
  rootAlternatives?: Array<{ value: string; confidence: number }>;
};

const result = await pool.query<{
  entityId: string; entityType: string; entityValue: string; eventId: string; clientId: string | null; decision: DecisionJson;
}>(`
  with recursive rooted(entity_id) as (
    select id from entities where type = 'domain' union
    select r.source_entity_id from rooted parent join relations r on r.target_entity_id = parent.entity_id
    where r.relation_type in ('part_of', 'belongs_to_domain')
  )
  select distinct on (e.id) e.id as "entityId", e.type as "entityType", e.value as "entityValue",
    event.id as "eventId", event.client_id as "clientId", decision.decision
  from entities e join event_entities ee on ee.entity_id = e.id join raw_events event on event.id = ee.event_id
  join semantic_event_decisions decision on decision.event_id = event.id
  left join entity_merges merged on merged.alias_entity_id = e.id
  where merged.alias_entity_id is null and e.type in ('app','merchant','sender','recipient')
    and not exists (select 1 from rooted where rooted.entity_id = e.id)
    and not exists (select 1 from semantic_candidates candidate where candidate.subject_entity_id = e.id and candidate.status = 'pending')
  order by e.id, event.created_at desc
`);

let queued = 0;
let deferred = 0;
for (const row of result.rows) {
  const decision = row.decision ?? {};
  const primary = decision.paths?.find((path) => path.role === "primary") ?? decision.paths?.[0];
  const path = ["sender", "recipient"].includes(row.entityType)
    ? ["Communication", "Email"]
    : primary?.hierarchyPath?.length
      ? primary.hierarchyPath
      : decision.rootAlternatives?.[0]?.value
        ? [decision.rootAlternatives[0].value]
        : [];
  if (!path.length) {
    await pool.query(`update semantic_event_decisions set status = 'review', updated_at = now() where event_id = $1`, [row.eventId]);
    deferred += 1;
    continue;
  }
  const targetValue = path[path.length - 1]!;
  await enqueueSemanticCandidate(pool, {
    clientId: row.clientId, eventId: row.eventId, subjectEntityId: row.entityId,
    relationType: path.length === 1 ? "belongs_to_domain" : "part_of", targetType: path.length === 1 ? "domain" : "concept",
    targetValue, targetNormalizedValue: normalizeEntityValue(targetValue), confidence: primary?.confidence ?? decision.rootAlternatives?.[0]?.confidence ?? 0,
    rationale: `Existing entity ${row.entityValue} has no validated hierarchy path. Review the closest event-level proposal before it becomes visible in Explore.`,
    extractor: "semantic-subject-backfill", decisionKind: "classify", domainValue: path[0], proposedPath: path,
    alternatives: decision.rootAlternatives ?? [], associations: [], recurrenceCount: 1,
    governanceVersion: SEMANTIC_GOVERNANCE_VERSION, promptVersion: SEMANTIC_PROMPT_VERSION, model: decision.model ?? null,
  });
  await pool.query(`update semantic_event_decisions set status = 'review', updated_at = now() where event_id = $1`, [row.eventId]);
  queued += 1;
}

console.log(JSON.stringify({ governanceVersion: SEMANTIC_GOVERNANCE_VERSION, inspected: result.rows.length, queued, deferred }));
await pool.end();
