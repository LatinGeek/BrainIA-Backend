-- Snapshot activation/retry timestamps are operationally useful and were
-- omitted from the first additive schema. This is a metadata-only change.
alter table event_interpretation_snapshots
  add column if not exists updated_at timestamptz not null default now();
