create unique index if not exists relations_source_entity_id_target_entity_id_relation_type_key
  on relations (source_entity_id, target_entity_id, relation_type);
