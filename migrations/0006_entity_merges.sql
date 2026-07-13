create table if not exists entity_merges (
  alias_entity_id text primary key references entities (id) on delete cascade,
  canonical_entity_id text not null references entities (id) on delete cascade,
  reason text not null,
  confidence numeric(5,4) not null default 1.0,
  created_at timestamptz not null default now()
);

create index if not exists entity_merges_canonical_entity_id_idx on entity_merges (canonical_entity_id);
create index if not exists entity_merges_created_at_idx on entity_merges (created_at desc);
