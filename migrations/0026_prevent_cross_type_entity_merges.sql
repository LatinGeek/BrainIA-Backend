-- A same-as merge represents one identity, never a relationship. Keep it
-- within one entity type so a merchant cannot become an event node.
delete from relations relation
using entities source_entity, entities target_entity
where relation.relation_type = 'same_as'
  and source_entity.id = relation.source_entity_id
  and target_entity.id = relation.target_entity_id
  and source_entity.type <> target_entity.type;

delete from entity_merges merge
using entities alias_entity, entities canonical_entity
where alias_entity.id = merge.alias_entity_id
  and canonical_entity.id = merge.canonical_entity_id
  and alias_entity.type <> canonical_entity.type;
