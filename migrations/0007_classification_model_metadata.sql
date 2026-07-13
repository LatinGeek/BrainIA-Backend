alter table classified_events
  add column if not exists model_metadata jsonb null;
