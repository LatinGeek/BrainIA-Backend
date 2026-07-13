create table if not exists relations (
  id text primary key,
  source_entity_id text not null references entities (id) on delete cascade,
  target_entity_id text not null references entities (id) on delete cascade,
  relation_type text not null,
  label text not null,
  description text not null,
  confidence numeric(5,4) not null default 1.0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_entity_id, target_entity_id, relation_type)
);

create index if not exists relations_source_entity_id_idx on relations (source_entity_id);
create index if not exists relations_target_entity_id_idx on relations (target_entity_id);
create index if not exists relations_relation_type_idx on relations (relation_type);

create table if not exists event_relations (
  id text primary key,
  event_id text not null references raw_events (id) on delete cascade,
  relation_id text not null references relations (id) on delete cascade,
  role text not null default 'implied',
  confidence numeric(5,4) not null default 1.0,
  created_at timestamptz not null default now(),
  unique (event_id, relation_id, role)
);

create index if not exists event_relations_event_id_idx on event_relations (event_id);
create index if not exists event_relations_relation_id_idx on event_relations (relation_id);
