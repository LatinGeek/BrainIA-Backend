-- Semantic governance v2 requires one immediate hierarchy parent per entity.
-- Remove transitive shortcuts first, then retain the strongest/deepest parent
-- for legacy conflicts before enforcing the invariant at database level.
delete from relations direct
where direct.relation_type in ('part_of', 'belongs_to_domain')
  and exists (
    select 1 from relations first_hop
    where first_hop.source_entity_id = direct.source_entity_id
      and first_hop.id <> direct.id
      and first_hop.relation_type in ('part_of', 'belongs_to_domain')
      and exists (
        with recursive upward(entity_id) as (
          select first_hop.target_entity_id
          union
          select relation.target_entity_id
          from upward current
          join relations relation on relation.source_entity_id = current.entity_id
          where relation.relation_type in ('part_of', 'belongs_to_domain')
        ) select 1 from upward where entity_id = direct.target_entity_id
      )
  );

with ranked as (
  select relation.id,
    row_number() over (
      partition by relation.source_entity_id
      order by
        case target.type when 'concept' then 0 when 'app' then 1 when 'domain' then 3 else 2 end,
        case relation.metadata ->> 'source'
          when 'semantic-review' then 0
          when 'semantic-deepseek' then 1
          when 'semantic-recurrence' then 2
          when 'ontology' then 3
          else 4
        end,
        relation.confidence desc,
        relation.created_at desc,
        relation.id
    ) as position
  from relations relation
  join entities target on target.id = relation.target_entity_id
  where relation.relation_type in ('part_of', 'belongs_to_domain')
)
delete from relations relation
using ranked
where relation.id = ranked.id and ranked.position > 1;

create unique index if not exists relations_single_hierarchy_parent_key
  on relations (source_entity_id)
  where relation_type in ('part_of', 'belongs_to_domain');
