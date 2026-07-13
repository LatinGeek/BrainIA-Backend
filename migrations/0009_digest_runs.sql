create table if not exists digest_runs (
  id text primary key,
  tool_name text not null,
  scope text null,
  window_from timestamptz null,
  window_to timestamptz null,
  request jsonb not null,
  response jsonb not null,
  summary text null,
  model text null,
  created_at timestamptz not null default now()
);

create index if not exists digest_runs_tool_name_idx on digest_runs (tool_name);
create index if not exists digest_runs_scope_idx on digest_runs (scope);
create index if not exists digest_runs_window_from_idx on digest_runs (window_from desc);
create index if not exists digest_runs_window_to_idx on digest_runs (window_to desc);
create index if not exists digest_runs_created_at_idx on digest_runs (created_at desc);
