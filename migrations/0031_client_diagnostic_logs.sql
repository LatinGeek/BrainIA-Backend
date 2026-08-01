create table if not exists client_diagnostic_logs (
  id text primary key,
  client_id text,
  platform text not null,
  component text not null,
  level text not null check (level in ('debug', 'info', 'warning', 'error')),
  event text not null,
  message text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists client_diagnostic_logs_occurred_at_idx
  on client_diagnostic_logs (occurred_at desc);

create index if not exists client_diagnostic_logs_component_event_idx
  on client_diagnostic_logs (component, event, occurred_at desc);
