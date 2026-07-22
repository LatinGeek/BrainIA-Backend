alter table classified_events
  add column if not exists display_title text,
  add column if not exists display_description text,
  add column if not exists interpretation_status text not null default 'pending',
  add column if not exists interpretation_source text,
  add column if not exists interpretation_confidence numeric(5,4),
  add column if not exists interpretation_model text,
  add column if not exists interpretation_prompt_version text,
  add column if not exists interpretation_failure_reason text;

create index if not exists classified_events_interpretation_status_idx
  on classified_events (interpretation_status, created_at desc);
