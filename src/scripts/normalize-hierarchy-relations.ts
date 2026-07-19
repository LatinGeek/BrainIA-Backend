import { pool, withTransaction } from "../storage/postgres.js";

const result = await withTransaction(async (db) => db.query(`
  with recursive inherited_domains as (
    select r.source_entity_id as entity_id, r.target_entity_id as domain_id
    from relations r
    join entities d on d.id = r.target_entity_id and d.type = 'domain'
    where r.relation_type = 'belongs_to_domain'
    union
    select child.source_entity_id, parent.domain_id
    from relations child
    join inherited_domains parent on parent.entity_id = child.target_entity_id
    where child.relation_type = 'part_of'
  ),
  redundant_shortcuts as (
    select direct.id
    from relations direct
    join inherited_domains inherited
      on inherited.entity_id = direct.source_entity_id
     and inherited.domain_id = direct.target_entity_id
    where direct.relation_type = 'belongs_to_domain'
      and exists (
        select 1
        from relations parent
        where parent.source_entity_id = direct.source_entity_id
          and parent.relation_type = 'part_of'
      )
  ),
  redundant_event_concepts as (
    select r.id
    from relations r
    join entities source on source.id = r.source_entity_id
    join entities target on target.id = r.target_entity_id
    where r.relation_type = 'part_of'
      and r.metadata ->> 'source' = 'semantic-heuristic'
      and source.type in ('activity_instance', 'notification')
      and target.type = 'concept'
  )
  delete from relations
  where id in (
    select id from redundant_shortcuts
    union
    select id from redundant_event_concepts
  )
  returning id
`));

console.log(JSON.stringify({ removedRedundantAncestorRelations: result.rowCount ?? 0 }));
await pool.end();
