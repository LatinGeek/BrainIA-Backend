create table if not exists entity_sequences (
  name text primary key,
  value bigint not null
);

insert into entity_sequences (name, value)
values ('entity', 0), ('relation', 0)
on conflict (name) do nothing;

create or replace function next_sequence_value(sequence_name text)
returns text
language plpgsql
as $$
declare
  next_value bigint;
begin
  update entity_sequences
  set value = value + 1
  where name = sequence_name
  returning value into next_value;

  return sequence_name || '_' || next_value::text;
end;
$$;

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

create table if not exists event_entities (
  id text primary key,
  event_id text not null references raw_events (id) on delete cascade,
  entity_id text not null references entities (id) on delete cascade,
  role text not null default 'mentioned',
  confidence numeric(5,4) not null default 1.0,
  created_at timestamptz not null default now(),
  unique (event_id, entity_id, role)
);

create index if not exists event_entities_event_id_idx on event_entities (event_id);
create index if not exists event_entities_entity_id_idx on event_entities (entity_id);
