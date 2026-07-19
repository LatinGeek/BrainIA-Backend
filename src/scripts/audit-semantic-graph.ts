import { pool } from "../storage/postgres.js";

const result = await pool.query<{
  totalNodes: string;
  domains: string;
  concepts: string;
  lowValue: string;
  unrootedDurable: string;
  pendingUnrootedEvidence: string;
  deferredUnrootedEvidence: string;
  duplicateCanonicalValues: string;
  crossTypeNameCollisions: string;
  multipleImmediateParents: string;
  hierarchyCycles: string;
  ancestorShortcuts: string;
  duplicateEventDomainAnchors: string;
  redundantHierarchyAssociations: string;
  identityConceptDuplicates: string;
  eventsWithoutSemanticDecision: string;
  relations: string;
  events: string;
}>(`
  with recursive rooted as (
    select id as entity_id from entities where type = 'domain'
    union
    select r.source_entity_id
    from rooted
    join relations r on r.target_entity_id = rooted.entity_id
    where r.relation_type in ('part_of', 'belongs_to_domain')
  ),
  durable as (
    select e.id
    from entities e
    left join entity_merges merged on merged.alias_entity_id = e.id
    where merged.alias_entity_id is null
      and e.type in ('app', 'merchant', 'sender', 'recipient')
  ),
  immediate_parents as (
    select r.source_entity_id, count(distinct r.target_entity_id) as parent_count
    from relations r
    where r.relation_type in ('part_of', 'belongs_to_domain')
    group by r.source_entity_id
  ),
  hierarchy_walk as (
    select r.source_entity_id as origin, r.target_entity_id as current, array[r.source_entity_id, r.target_entity_id] as visited, false as cycle
    from relations r where r.relation_type in ('part_of', 'belongs_to_domain')
    union all
    select walk.origin, r.target_entity_id, walk.visited || r.target_entity_id, r.target_entity_id = any(walk.visited)
    from hierarchy_walk walk join relations r on r.source_entity_id = walk.current
    where r.relation_type in ('part_of', 'belongs_to_domain') and not walk.cycle and cardinality(walk.visited) < 20
  ),
  shortcuts as (
    select distinct direct.id
    from relations direct join relations first_hop on first_hop.source_entity_id = direct.source_entity_id and first_hop.id <> direct.id
    where direct.relation_type in ('part_of', 'belongs_to_domain') and first_hop.relation_type in ('part_of', 'belongs_to_domain')
      and exists (
        with recursive upward(entity_id) as (
          select first_hop.target_entity_id union
          select r.target_entity_id from upward u join relations r on r.source_entity_id = u.entity_id
          where r.relation_type in ('part_of', 'belongs_to_domain')
        ) select 1 from upward where entity_id = direct.target_entity_id
      )
  )
  select
    (select count(*) from entities)::text as "totalNodes",
    (select count(*) from entities where type = 'domain')::text as domains,
    (select count(*) from entities where type = 'concept')::text as concepts,
    (select count(*) from entities where type in ('amount', 'expense', 'notification', 'income'))::text as "lowValue",
    (select count(*) from durable d where not exists (select 1 from rooted where rooted.entity_id = d.id)
      and not exists (select 1 from semantic_candidates candidate where candidate.subject_entity_id = d.id and candidate.status = 'pending')
      and not exists (select 1 from event_entities ee join semantic_event_decisions decision on decision.event_id = ee.event_id where ee.entity_id = d.id and decision.status in ('review','unclassified','model_unavailable'))
      and not exists (select 1 from entities deferred where deferred.id = d.id and deferred.metadata ->> 'semanticState' = 'deferred_review'))::text as "unrootedDurable",
    (select count(*) from durable d where not exists (select 1 from rooted where rooted.entity_id = d.id)
      and (exists (select 1 from semantic_candidates candidate where candidate.subject_entity_id = d.id and candidate.status = 'pending')
        or exists (select 1 from event_entities ee join semantic_event_decisions decision on decision.event_id = ee.event_id where ee.entity_id = d.id and decision.status in ('review','unclassified','model_unavailable'))))::text as "pendingUnrootedEvidence",
    (select count(*) from durable d join entities deferred on deferred.id = d.id where not exists (select 1 from rooted where rooted.entity_id = d.id)
      and deferred.metadata ->> 'semanticState' = 'deferred_review')::text as "deferredUnrootedEvidence",
    (select count(*) from (
      select e.type, normalized_value from entities e left join entity_merges merged on merged.alias_entity_id = e.id
      where merged.alias_entity_id is null and e.type not in ('domain', 'concept')
      group by e.type, normalized_value having count(*) > 1
    ) duplicates)::text as "duplicateCanonicalValues",
    (select count(*) from (
      select normalized_value from entities e left join entity_merges merged on merged.alias_entity_id = e.id
      where merged.alias_entity_id is null and e.type not in ('domain', 'concept')
      group by normalized_value having count(distinct e.type) > 1
    ) collisions)::text as "crossTypeNameCollisions",
    (select count(*) from immediate_parents where parent_count > 1)::text as "multipleImmediateParents",
    (select count(distinct origin) from hierarchy_walk where cycle)::text as "hierarchyCycles",
    (select count(*) from shortcuts)::text as "ancestorShortcuts",
    (select count(*) from (select event_id, domain_entity_id from event_semantic_anchors group by event_id, domain_entity_id having count(*) > 1) duplicate_anchors)::text as "duplicateEventDomainAnchors",
    (select count(*) from relations association
      where association.relation_type not in ('part_of', 'belongs_to_domain', 'same_as')
        and (exists (
          with recursive upward(entity_id) as (
            select association.source_entity_id union
            select hierarchy.target_entity_id from upward current join relations hierarchy on hierarchy.source_entity_id = current.entity_id
            where hierarchy.relation_type in ('part_of', 'belongs_to_domain')
          ) select 1 from upward where entity_id = association.target_entity_id
        ) or exists (
          with recursive upward(entity_id) as (
            select association.target_entity_id union
            select hierarchy.target_entity_id from upward current join relations hierarchy on hierarchy.source_entity_id = current.entity_id
            where hierarchy.relation_type in ('part_of', 'belongs_to_domain')
          ) select 1 from upward where entity_id = association.source_entity_id
        )))::text as "redundantHierarchyAssociations",
    (select count(*) from entities concept join entities app on app.type = 'app'
      and regexp_replace(concept.normalized_value, '\\s+(app|application)$', '') = app.normalized_value
      left join entity_merges merged on merged.alias_entity_id = concept.id
      where concept.type = 'concept' and concept.normalized_value ~ '\\s+(app|application)$'
        and merged.alias_entity_id is null)::text as "identityConceptDuplicates",
    (select count(*) from raw_events event where not exists (select 1 from semantic_event_decisions decision where decision.event_id = event.id))::text as "eventsWithoutSemanticDecision",
    (select count(*) from relations)::text as relations,
    (select count(*) from raw_events)::text as events
`);

const typeResult = await pool.query<{ type: string; count: string; unrooted: string }>(`
  with recursive rooted as (
    select id as entity_id from entities where type = 'domain'
    union
    select r.source_entity_id
    from rooted join relations r on r.target_entity_id = rooted.entity_id
    where r.relation_type in ('part_of', 'belongs_to_domain')
  )
  select e.type, count(*)::text as count,
    count(*) filter (where e.type not in ('domain', 'concept', 'amount', 'expense', 'notification', 'income') and not exists (select 1 from rooted where rooted.entity_id = e.id))::text as unrooted
  from entities e left join entity_merges merged on merged.alias_entity_id = e.id
  where merged.alias_entity_id is null
  group by e.type order by count(*) desc, e.type asc
`);

console.log(JSON.stringify({ auditVersion: "semantic-governance-v2", ...result.rows[0], byType: typeResult.rows }));
await pool.end();
