import { pool, withTransaction } from "../storage/postgres.js";
import { ensureOntology } from "../storage/semantic-repository.js";
import { setImmediateHierarchyParent } from "../storage/semantic-repository.js";
import { mergeEntities } from "../storage/entity-repository.js";

const result = await withTransaction(async (db) => {
  await ensureOntology(db, null);
  const discardedHeuristicMerchants = await db.query<{ count: number }>(`
    with discarded as (
      update entities set metadata = metadata || '{"semanticState":"discarded","discardReason":"notification_text_is_not_merchant"}'::jsonb
      where type = 'merchant' and metadata ->> 'signal' = 'merchant_candidate'
        and value ~* '^(Notificaci[oó]n|Notification|Movimiento detectado|Estado del dispositivo)'
      returning id
    ), removed_relations as (
      delete from relations relation using discarded
      where relation.source_entity_id = discarded.id and relation.relation_type in ('part_of', 'belongs_to_domain')
      returning relation.id
    )
    , rejected as (
      update semantic_candidates candidate set status = 'rejected', resolved_at = now(), updated_at = now()
      where candidate.subject_entity_id in (select id from discarded) and candidate.status = 'pending'
      returning candidate.id
    ) select count(*)::int as count from discarded
  `);
  const identityDuplicates = await db.query<{
    conceptId: string; conceptValue: string; appId: string; appValue: string;
  }>(`
    select concept.id as "conceptId", concept.value as "conceptValue", app.id as "appId", app.value as "appValue"
    from entities concept join entities app on app.type = 'app'
      and regexp_replace(concept.normalized_value, '\\s+(app|application)$', '') = app.normalized_value
    left join entity_merges merged on merged.alias_entity_id = concept.id
    where concept.type = 'concept' and concept.normalized_value ~ '\\s+(app|application)$'
      and merged.alias_entity_id is null
  `);
  let consolidatedIdentityConcepts = 0;
  for (const duplicate of identityDuplicates.rows) {
    const parentResult = await db.query<{ id: string; type: string; value: string; normalizedValue: string }>(`
      select parent.id, parent.type, parent.value, parent.normalized_value as "normalizedValue"
      from relations relation join entities parent on parent.id = relation.target_entity_id
      where relation.source_entity_id = $1 and relation.relation_type in ('part_of', 'belongs_to_domain') limit 1
    `, [duplicate.conceptId]);
    const appResult = await db.query<{ id: string; type: string; value: string; normalizedValue: string }>(`
      select id, type, value, normalized_value as "normalizedValue" from entities where id = $1
    `, [duplicate.appId]);
    const parent = parentResult.rows[0];
    const app = appResult.rows[0];
    if (!parent || !app) continue;
    const children = await db.query<{ id: string; type: string; value: string; normalizedValue: string }>(`
      select child.id, child.type, child.value, child.normalized_value as "normalizedValue"
      from relations relation join entities child on child.id = relation.source_entity_id
      where relation.target_entity_id = $1 and relation.relation_type in ('part_of', 'belongs_to_domain') and child.id <> $2
    `, [duplicate.conceptId, duplicate.appId]);
    await setImmediateHierarchyParent(db, { child: app, parent, confidence: 1, metadata: { source: "semantic-identity-consolidation", governanceVersion: "semantic-governance-v2" } });
    for (const child of children.rows) {
      await setImmediateHierarchyParent(db, { child, parent: app, confidence: 1, metadata: { source: "semantic-identity-consolidation", governanceVersion: "semantic-governance-v2" } });
    }
    await db.query(`delete from relations where source_entity_id = $1 and relation_type in ('part_of', 'belongs_to_domain')`, [duplicate.conceptId]);
    await mergeEntities(db, duplicate.conceptId, duplicate.appId, { reason: "identity_concept_duplicate", confidence: 1 });
    consolidatedIdentityConcepts += 1;
  }
  const durableTypes = "'domain', 'concept', 'app', 'merchant', 'sender', 'recipient', 'email_message', 'financial_event', 'activity_instance'";
  const normalizedEvidenceLinks = await db.query(`
    update relations relation set relation_type = 'evidence_for', label = 'Evidence for event',
      metadata = relation.metadata || '{"source":"event-evidence","governanceVersion":"semantic-governance-v2"}'::jsonb
    from entities target
    where target.id = relation.target_entity_id
      and target.type in ('email_message', 'financial_event', 'activity_instance')
      and relation.relation_type = 'part_of'
      and relation.metadata ->> 'source' = 'event-hierarchy'
    returning relation.id
  `);
  const removedRules = await db.query(`
    delete from semantic_rules rule
    using entities target
    where target.id = rule.target_entity_id
      and (rule.source_type not in ('app', 'merchant', 'sender', 'recipient', 'email_message', 'financial_event', 'activity_instance')
        or target.type not in (${durableTypes}))
    returning rule.id
  `);
  await db.query(`
    delete from relations hierarchy
    using entities target
    where target.id = hierarchy.target_entity_id and target.type = 'app'
      and hierarchy.relation_type = 'part_of' and hierarchy.metadata ->> 'source' = 'event-hierarchy'
      and exists (select 1 from relations association where association.source_entity_id = hierarchy.source_entity_id
        and association.target_entity_id = hierarchy.target_entity_id and association.relation_type = 'produced_by_app')
  `);
  const normalizedProviderLinks = await db.query(`
    update relations hierarchy set relation_type = 'produced_by_app', label = 'Produced by app',
      metadata = hierarchy.metadata || '{"governanceVersion":"semantic-governance-v2"}'::jsonb
    from entities target
    where target.id = hierarchy.target_entity_id and target.type = 'app'
      and hierarchy.relation_type = 'part_of' and hierarchy.metadata ->> 'source' = 'event-hierarchy'
    returning hierarchy.id
  `);
  const removedSupersededHeuristics = await db.query(`
    delete from relations heuristic
    where heuristic.relation_type in ('part_of', 'belongs_to_domain')
      and heuristic.metadata ->> 'source' = 'semantic-heuristic'
      and exists (
        select 1 from relations governed where governed.source_entity_id = heuristic.source_entity_id
          and governed.id <> heuristic.id and governed.relation_type in ('part_of', 'belongs_to_domain')
          and governed.metadata ->> 'source' in ('semantic-review', 'semantic-deepseek')
      )
    returning heuristic.id
  `);
  const removedRelations = await db.query(`
    delete from relations r
    using entities source, entities target
    where source.id = r.source_entity_id
      and target.id = r.target_entity_id
      and (source.type not in (${durableTypes}) or target.type not in (${durableTypes}))
    returning r.id
  `);

  const removedAncestorShortcuts = await db.query(`
    delete from relations direct
    where direct.relation_type in ('part_of', 'belongs_to_domain')
      and exists (
        select 1 from relations first_hop
        where first_hop.source_entity_id = direct.source_entity_id
          and first_hop.id <> direct.id
          and first_hop.relation_type in ('part_of', 'belongs_to_domain')
          and exists (
            with recursive upward(entity_id) as (
              select first_hop.target_entity_id union
              select r.target_entity_id from upward u join relations r on r.source_entity_id = u.entity_id
              where r.relation_type in ('part_of', 'belongs_to_domain')
            ) select 1 from upward where entity_id = direct.target_entity_id
          )
      )
    returning direct.id
  `);
  const removedRedundantAssociations = await db.query(`
    delete from relations association
    where association.relation_type not in ('part_of', 'belongs_to_domain', 'same_as') and (
      exists (
        with recursive upward(entity_id) as (
          select association.source_entity_id
          union
          select hierarchy.target_entity_id from upward current
          join relations hierarchy on hierarchy.source_entity_id = current.entity_id
          where hierarchy.relation_type in ('part_of', 'belongs_to_domain')
        ) select 1 from upward where entity_id = association.target_entity_id
      ) or exists (
        with recursive upward(entity_id) as (
          select association.target_entity_id
          union
          select hierarchy.target_entity_id from upward current
          join relations hierarchy on hierarchy.source_entity_id = current.entity_id
          where hierarchy.relation_type in ('part_of', 'belongs_to_domain')
        ) select 1 from upward where entity_id = association.source_entity_id
      ))
    returning association.id
  `);
  const reopenedParentConflicts = await db.query(`
    with conflicts as (
      select source_entity_id from relations where relation_type in ('part_of', 'belongs_to_domain')
      group by source_entity_id having count(distinct target_entity_id) > 1
    ), removed as (
      delete from relations r using conflicts c
      where r.source_entity_id = c.source_entity_id and r.relation_type in ('part_of', 'belongs_to_domain')
      returning r.source_entity_id, r.metadata ->> 'candidateId' as candidate_id
    ), reopened as (
      update semantic_candidates candidate set status = 'pending', resolved_at = null, resolved_target_entity_id = null, updated_at = now()
      where candidate.id in (select candidate_id from removed where candidate_id is not null)
      returning candidate.id
    ) select distinct source_entity_id from removed
  `);

  const detachedEvidence = await db.query(`
    delete from event_entities ee
    using entities e
    where e.id = ee.entity_id
      and e.type not in (${durableTypes})
    returning ee.entity_id
  `);

  const removedNodes = await db.query(`
    delete from entities e
    where e.type not in (${durableTypes})
      and not exists (select 1 from event_entities ee where ee.entity_id = e.id)
      and not exists (select 1 from relations r where r.source_entity_id = e.id or r.target_entity_id = e.id)
      and not exists (select 1 from entity_merges m where m.alias_entity_id = e.id or m.canonical_entity_id = e.id)
    returning e.id
  `);

  return {
    removedRelations: removedRelations.rowCount ?? 0,
    detachedEvidence: detachedEvidence.rowCount ?? 0,
    removedNodes: removedNodes.rowCount ?? 0,
    removedRules: removedRules.rowCount ?? 0,
    discardedHeuristicMerchants: discardedHeuristicMerchants.rows[0]?.count ?? 0,
    normalizedProviderLinks: normalizedProviderLinks.rowCount ?? 0,
    normalizedEvidenceLinks: normalizedEvidenceLinks.rowCount ?? 0,
    removedSupersededHeuristics: removedSupersededHeuristics.rowCount ?? 0,
    removedAncestorShortcuts: removedAncestorShortcuts.rowCount ?? 0,
    removedRedundantAssociations: removedRedundantAssociations.rowCount ?? 0,
    consolidatedIdentityConcepts,
    reopenedParentConflicts: reopenedParentConflicts.rowCount ?? 0,
  };
});

console.log(JSON.stringify({ governanceVersion: "semantic-governance-v2", ...result }));
await pool.end();
