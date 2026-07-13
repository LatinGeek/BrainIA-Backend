create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists events (
  id text primary key,
  source text not null,
  kind text not null,
  title text null,
  body text null,
  timestamp timestamptz null,
  external_id text null,
  raw jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}'::text[],
  inferred_kind text not null,
  confidence numeric(5,4) not null,
  entities jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_source_idx on events (source);
create index if not exists events_kind_idx on events (kind);
create index if not exists events_inferred_kind_idx on events (inferred_kind);
create index if not exists events_created_at_idx on events (created_at desc);
