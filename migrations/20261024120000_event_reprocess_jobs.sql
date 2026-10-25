-- Selective event reprocessing runs as one queue job per request so admission,
-- dependencies, fencing and duplicate prevention share the existing job
-- infrastructure. This only widens the job type constraint; no row is rewritten.
alter table background_jobs drop constraint if exists background_jobs_job_type_check;
alter table background_jobs add constraint background_jobs_job_type_check check (job_type in
  ('classification','semantic_enrichment','embedding','financial_correlation','event_reprocess',
   'insight_detection','semantic_reconciliation','retention','backup_verification','intelligence_generation'));

-- Admission looks up active reprocess executions by event, and the owner-facing
-- jobs endpoint renders one event's history.
create index if not exists background_jobs_event_reprocess_idx
  on background_jobs (event_id, created_at desc)
  where job_type = 'event_reprocess';
