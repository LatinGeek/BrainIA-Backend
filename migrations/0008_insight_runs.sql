create table if not exists insight_runs (
  id text primary key,
  tool_name text not null,
  query text null,
  request jsonb not null,
  response jsonb not null,
  summary text null,
  model text null,
  created_at timestamptz not null default now()
);

create index if not exists insight_runs_tool_name_idx on insight_runs (tool_name);
create index if not exists insight_runs_query_idx on insight_runs (query);
create index if not exists insight_runs_created_at_idx on insight_runs (created_at desc);
