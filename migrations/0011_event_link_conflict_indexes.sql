create unique index if not exists event_entities_event_id_entity_id_role_key
  on event_entities (event_id, entity_id, role);

create unique index if not exists event_relations_event_id_relation_id_key
  on event_relations (event_id, relation_id);
