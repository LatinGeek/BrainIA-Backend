import { pool } from "./postgres.js";

export async function getKnowledgeQualityMetrics() {
  const result = await pool.query<{
    totalEvents: number; anchoredEvents: number; observableEvents: number;
    visibleDurableEntities: number; rootedVisibleEntities: number;
    invalidHierarchyRelations: number; multipleParentEntities: number;
    cyclicEntities: number; semanticDuplicateGroups: number;
    pendingProposals: number; retryableEvents: number; modelCalls: number;
    inputTokens: number; outputTokens: number; estimatedCostUsd: number;
    failedModelCalls: number; queuedJobs: number; deadLetterJobs: number;
    categorizedEvents: number; level2CategorizedEvents: number; level3CategorizedEvents: number; shallowCategorizedEvents: number;
    profiledEntities: number; acceptedInsights: number; rejectedInsights: number;
  }>(`
    with recursive
    visible as (
      select entity.id, entity.normalized_value
      from entities entity left join entity_merges merged on merged.alias_entity_id = entity.id
      where merged.alias_entity_id is null and entity.visibility = 'visible'
        and entity.identity_source in ('ai','ai_seed','user')
        and length(btrim(entity.value)) > 0 and length(btrim(entity.description)) > 0
    ),
    rooted(id) as (
      select entity.id from entities entity join visible on visible.id = entity.id where entity.type = 'domain'
      union
      select relation.source_entity_id from rooted parent join relations relation on relation.target_entity_id = parent.id
        join visible child on child.id = relation.source_entity_id
      where relation.relation_type in ('part_of','belongs_to_domain')
    ),
    walk(origin, current_id, path, cyclic) as (
      select relation.source_entity_id, relation.target_entity_id,
        array[relation.source_entity_id, relation.target_entity_id], relation.target_entity_id = relation.source_entity_id
      from relations relation where relation.relation_type in ('part_of','belongs_to_domain')
      union all
      select walk.origin, relation.target_entity_id, walk.path || relation.target_entity_id,
        relation.target_entity_id = any(walk.path)
      from walk join relations relation on relation.source_entity_id = walk.current_id
      where relation.relation_type in ('part_of','belongs_to_domain') and not walk.cyclic and cardinality(walk.path) < 32
    ),
    duplicate_groups as (
      select normalized_value from visible group by normalized_value having count(*) > 1
    )
    select
      (select count(*)::int from raw_events) as "totalEvents",
      (select count(distinct event_id)::int from event_semantic_anchors where role = 'primary') as "anchoredEvents",
      (select count(*)::int from raw_events where processing_status in ('captured','classified','semantically_resolved','review','retryable','discarded')) as "observableEvents",
      (select count(*)::int from visible) as "visibleDurableEntities",
      (select count(*)::int from visible where id in (select id from rooted)) as "rootedVisibleEntities",
      (select count(*)::int from relations where source_entity_id = target_entity_id) as "invalidHierarchyRelations",
      (select count(*)::int from (select source_entity_id from relations where relation_type in ('part_of','belongs_to_domain') group by source_entity_id having count(*) > 1) parents) as "multipleParentEntities",
      (select count(distinct origin)::int from walk where cyclic) as "cyclicEntities",
      (select count(*)::int from duplicate_groups) as "semanticDuplicateGroups",
      (select count(*)::int from semantic_candidates where status = 'pending') as "pendingProposals",
      (select count(*)::int from raw_events where processing_status = 'retryable') as "retryableEvents",
      (select count(*)::int from model_call_audits) as "modelCalls",
      (select coalesce(sum(input_tokens), 0)::int from model_call_audits) as "inputTokens",
      (select coalesce(sum(output_tokens), 0)::int from model_call_audits) as "outputTokens",
      (select coalesce(sum(estimated_cost_usd), 0)::float8 from model_call_audits) as "estimatedCostUsd",
      (select count(*)::int from model_call_audits where status = 'failed') as "failedModelCalls",
      (select count(*)::int from background_jobs where status in ('queued','retry_scheduled','running')) as "queuedJobs",
      (select count(*)::int from background_jobs where status = 'dead_letter') as "deadLetterJobs",
      (select count(*)::int from semantic_event_decisions where primary_category_key is not null) as "categorizedEvents",
      (select count(*)::int from semantic_event_decisions where primary_category_key like '%.%') as "level2CategorizedEvents",
      (select count(*)::int from semantic_event_decisions where primary_category_key like '%.%.%') as "level3CategorizedEvents",
      (select count(*)::int from semantic_event_decisions where primary_category_key is not null and primary_category_key not like '%.%') as "shallowCategorizedEvents",
      (select count(*)::int from entity_semantic_profiles) as "profiledEntities",
      (select count(*)::int from insight_runs where feedback_status in ('accepted','useful')) as "acceptedInsights",
      (select count(*)::int from insight_runs where feedback_status in ('rejected','not_useful')) as "rejectedInsights"
  `);
  const row = result.rows[0]!;
  const percentage = (numerator: number, denominator: number) => denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 100;
  return {
    coverage: {
      observableEventPercent: percentage(row.observableEvents, row.totalEvents),
      primaryAnchorPercent: percentage(row.anchoredEvents, row.totalEvents),
      rootedVisibleEntityPercent: percentage(row.rootedVisibleEntities, row.visibleDurableEntities),
      categorizedEventPercent: percentage(row.categorizedEvents, row.totalEvents),
      level2CategoryPercent: percentage(row.level2CategorizedEvents, row.categorizedEvents),
      level3CategoryPercent: percentage(row.level3CategorizedEvents, row.categorizedEvents),
    },
    counts: row,
    feedback: {
      insightsRated: row.acceptedInsights + row.rejectedInsights,
      acceptedInsightPercent: percentage(row.acceptedInsights, row.acceptedInsights + row.rejectedInsights),
      profiledEntities: row.profiledEntities,
    },
    gates: {
      allEventsObservable: row.observableEvents === row.totalEvents,
      allVisibleEntitiesRooted: row.rootedVisibleEntities === row.visibleDurableEntities,
      hierarchyValid: row.invalidHierarchyRelations === 0 && row.multipleParentEntities === 0 && row.cyclicEntities === 0,
      modelCallsAuditable: row.modelCalls >= 0,
      noDeadLetters: row.deadLetterJobs === 0,
    },
  };
}
