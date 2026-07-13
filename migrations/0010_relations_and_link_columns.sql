alter table relations
  add column if not exists label text not null default '';

alter table relations
  add column if not exists description text not null default '';

update relations
set
  label = case when coalesce(nullif(label, ''), '') = '' then relation_type else label end,
  description = case when coalesce(nullif(description, ''), '') = '' then relation_type else description end;

alter table event_entities
  add column if not exists id text null;

alter table event_entities
  add column if not exists created_at timestamptz not null default now();

alter table event_relations
  add column if not exists id text null;

alter table event_relations
  add column if not exists role text not null default 'implied';

alter table event_relations
  add column if not exists confidence numeric(5,4) not null default 1.0;

alter table event_relations
  add column if not exists created_at timestamptz not null default now();
