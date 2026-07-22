import { linkEventRelation } from "../storage/relation-repository.js";
import { setImmediateHierarchyParent } from "../storage/semantic-repository.js";
import { pool } from "../storage/postgres.js";

type EvidenceRow = {
  eventId: string;
  evidenceId: string;
  evidenceType: string;
  evidenceValue: string;
  evidenceNormalizedValue: string;
  anchorId: string;
  anchorType: string;
  anchorValue: string;
  anchorNormalizedValue: string;
  confidence: number;
};

// Historical event instances predate the invariant that evidence always sits
// directly beneath the canonical meaning selected for its event. The semantic
// anchor is that approved meaning, so this repair does not classify anything
// again or create a new relationship from raw notification text.
const result = await pool.query<EvidenceRow>(`
  select distinct on (e.id)
    event_entity.event_id as "eventId",
    e.id as "evidenceId", e.type as "evidenceType", e.value as "evidenceValue", e.normalized_value as "evidenceNormalizedValue",
    anchor.id as "anchorId", anchor.type as "anchorType", anchor.value as "anchorValue", anchor.normalized_value as "anchorNormalizedValue",
    semantic_anchor.confidence::float8 as confidence
  from entities e
  join event_entities event_entity on event_entity.entity_id = e.id
  join event_semantic_anchors semantic_anchor on semantic_anchor.event_id = event_entity.event_id and semantic_anchor.role = 'primary'
  left join entity_merges anchor_merge on anchor_merge.alias_entity_id = semantic_anchor.anchor_entity_id
  join entities anchor on anchor.id = coalesce(anchor_merge.canonical_entity_id, semantic_anchor.anchor_entity_id)
  where e.type in ('activity_instance', 'financial_event', 'email_message')
    and not exists (
      select 1 from relations relation
      where relation.source_entity_id = e.id and relation.relation_type in ('part_of', 'belongs_to_domain')
    )
  order by e.id, semantic_anchor.confidence desc, anchor.created_at asc
`);

let linked = 0;
for (const row of result.rows) {
  if (row.evidenceId === row.anchorId) continue;
  const relation = await setImmediateHierarchyParent(pool, {
    child: { id: row.evidenceId, type: row.evidenceType, value: row.evidenceValue, normalizedValue: row.evidenceNormalizedValue },
    parent: { id: row.anchorId, type: row.anchorType, value: row.anchorValue, normalizedValue: row.anchorNormalizedValue },
    confidence: row.confidence,
    metadata: { source: "event-evidence-parent-backfill", governanceVersion: "semantic-governance-v4" },
  });
  await linkEventRelation(pool, row.eventId, relation.id, row.confidence);
  linked += 1;
}

console.log(JSON.stringify({ inspected: result.rows.length, linked }));
await pool.end();
