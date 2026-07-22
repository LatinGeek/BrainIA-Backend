alter table semantic_event_decisions
  drop constraint if exists semantic_event_decisions_status_check;

alter table semantic_event_decisions
  add constraint semantic_event_decisions_status_check
  check (status in ('resolved', 'review', 'unclassified', 'model_unavailable', 'retryable'));
