create table if not exists entity_aliases (
  id text primary key,
  entity_id text not null references entities (id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  category_path text[] not null default '{}'::text[],
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_alias)
);

create index if not exists entity_aliases_entity_id_idx on entity_aliases (entity_id);
create index if not exists entity_aliases_normalized_alias_idx on entity_aliases (normalized_alias);

create table if not exists entity_review_queue (
  id text primary key,
  entity_id text not null references entities (id) on delete cascade,
  event_id text references raw_events (id) on delete set null,
  source text not null,
  original_value text not null,
  normalized_value text not null,
  status text not null default 'pending',
  suggested_alias text,
  suggested_category_path text[] not null default '{}'::text[],
  alias_id text references entity_aliases (id) on delete set null,
  reason text not null default 'merchant_candidate',
  resolved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id)
);

alter table entity_review_queue
  add constraint entity_review_queue_status_check
  check (status in ('pending', 'resolved', 'ignored'));

create index if not exists entity_review_queue_status_idx on entity_review_queue (status);
create index if not exists entity_review_queue_created_at_idx on entity_review_queue (created_at desc);
