create table if not exists raw_events (
  id text primary key,
  source text not null,
  kind text not null,
  title text null,
  body text null,
  timestamp timestamptz null,
  external_id text null,
  raw jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

create index if not exists raw_events_source_idx on raw_events (source);
create index if not exists raw_events_kind_idx on raw_events (kind);
create index if not exists raw_events_created_at_idx on raw_events (created_at desc);

create table if not exists classified_events (
  id text primary key,
  raw_event_id text not null references raw_events (id) on delete cascade,
  inferred_kind text not null,
  confidence numeric(5,4) not null,
  entities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists classified_events_raw_event_id_idx on classified_events (raw_event_id);
create index if not exists classified_events_inferred_kind_idx on classified_events (inferred_kind);

create table if not exists entities (
  id text primary key,
  type text not null,
  value text not null,
  normalized_value text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (type, normalized_value)
);

create index if not exists entities_type_idx on entities (type);
create index if not exists entities_normalized_value_idx on entities (normalized_value);

create table if not exists relations (
  id text primary key,
  source_entity_id text not null references entities (id) on delete cascade,
  target_entity_id text not null references entities (id) on delete cascade,
  relation_type text not null,
  confidence numeric(5,4) not null default 1.0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists relations_source_entity_id_idx on relations (source_entity_id);
create index if not exists relations_target_entity_id_idx on relations (target_entity_id);
create index if not exists relations_relation_type_idx on relations (relation_type);

create table if not exists event_entities (
  event_id text not null references raw_events (id) on delete cascade,
  entity_id text not null references entities (id) on delete cascade,
  role text not null default 'mentioned',
  confidence numeric(5,4) not null default 1.0,
  primary key (event_id, entity_id, role)
);

create table if not exists event_relations (
  event_id text not null references raw_events (id) on delete cascade,
  relation_id text not null references relations (id) on delete cascade,
  primary key (event_id, relation_id)
);
