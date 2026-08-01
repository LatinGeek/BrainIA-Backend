-- BrainIA personal knowledge platform: observable processing, auditable model
-- calls, governed facts, hybrid retrieval, proactive insights, reliable jobs,
-- and user-controlled privacy.

alter table raw_events
  add column if not exists processing_status text not null default 'captured',
  add column if not exists processing_status_reason text,
  add column if not exists processing_status_updated_at timestamptz not null default now(),
  add column if not exists privacy_status text not null default 'standard',
  add column if not exists processing_allowed boolean not null default true;

alter table raw_events drop constraint if exists raw_events_processing_status_check;
alter table raw_events add constraint raw_events_processing_status_check
  check (processing_status in ('captured', 'classified', 'semantically_resolved', 'review', 'retryable', 'discarded'));
alter table raw_events drop constraint if exists raw_events_privacy_status_check;
alter table raw_events add constraint raw_events_privacy_status_check
  check (privacy_status in ('standard', 'private', 'hidden'));

update raw_events event
set processing_status = case
  when not event.processing_allowed or event.privacy_status = 'hidden' then 'discarded'
  when exists (select 1 from semantic_event_decisions decision where decision.event_id = event.id and decision.status = 'resolved') then 'semantically_resolved'
  when exists (select 1 from semantic_event_decisions decision where decision.event_id = event.id and decision.status = 'review') then 'review'
  when exists (select 1 from semantic_event_decisions decision where decision.event_id = event.id and decision.status in ('retryable', 'model_unavailable', 'unclassified')) then 'retryable'
  when exists (select 1 from classified_events classified where classified.raw_event_id = event.id) then 'classified'
  else 'captured'
end,
processing_status_updated_at = now();

create index if not exists raw_events_processing_status_idx
  on raw_events (processing_status, processing_status_updated_at);
create index if not exists raw_events_privacy_status_idx
  on raw_events (privacy_status, created_at desc);

alter table semantic_event_decisions
  drop constraint if exists semantic_event_decisions_status_check;
alter table semantic_event_decisions
  add constraint semantic_event_decisions_status_check
  check (status in ('resolved', 'review', 'unclassified', 'model_unavailable', 'retryable', 'discarded'));

alter table entities
  add column if not exists visibility text not null default 'visible';
alter table entities drop constraint if exists entities_visibility_check;
alter table entities add constraint entities_visibility_check
  check (visibility in ('visible', 'private', 'hidden'));
create index if not exists entities_visibility_idx on entities (visibility, type);

create table if not exists event_processing_history (
  id text primary key,
  event_id text not null references raw_events (id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  job_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (from_status is null or from_status in ('captured', 'classified', 'semantically_resolved', 'review', 'retryable', 'discarded')),
  check (to_status in ('captured', 'classified', 'semantically_resolved', 'review', 'retryable', 'discarded'))
);
create index if not exists event_processing_history_event_idx
  on event_processing_history (event_id, created_at desc);

create table if not exists knowledge_facts (
  id text primary key,
  client_id text,
  event_id text not null references raw_events (id) on delete cascade,
  fact_type text not null,
  value jsonb not null,
  normalized_value text not null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  evidence jsonb not null,
  model text,
  model_version text,
  prompt_version text,
  extractor_version text not null,
  visibility text not null default 'visible' check (visibility in ('visible', 'private', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, fact_type, normalized_value, extractor_version)
);
create index if not exists knowledge_facts_event_idx on knowledge_facts (event_id);
create index if not exists knowledge_facts_type_idx on knowledge_facts (fact_type, normalized_value);
create index if not exists knowledge_facts_visibility_idx on knowledge_facts (visibility, created_at desc);

create table if not exists model_call_audits (
  id text primary key,
  client_id text,
  event_id text references raw_events (id) on delete set null,
  provider text not null,
  operation text not null,
  model text not null,
  prompt_version text not null,
  status text not null check (status in ('started', 'succeeded', 'failed', 'cancelled')),
  attempt integer not null default 1,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(14,8) not null default 0,
  latency_ms integer,
  request_fingerprint text not null,
  result_metadata jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists model_call_audits_event_idx on model_call_audits (event_id, created_at desc);
create index if not exists model_call_audits_status_idx on model_call_audits (status, created_at desc);
create index if not exists model_call_audits_operation_idx on model_call_audits (operation, created_at desc);

-- PostgreSQL arrays provide a portable vector store when pgvector is not
-- available. The application performs bounded cosine reranking and keeps the
-- model/version/content hash alongside every vector.
create table if not exists knowledge_embeddings (
  id text primary key,
  client_id text,
  object_type text not null check (object_type in ('event', 'entity', 'insight', 'digest', 'fact')),
  object_id text not null,
  embedding double precision[] not null,
  dimensions integer not null check (dimensions > 0),
  model text not null,
  embedding_version text not null,
  content_hash text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (object_type, object_id, embedding_version),
  check (coalesce(array_length(embedding, 1), 0) = dimensions)
);
create index if not exists knowledge_embeddings_object_idx
  on knowledge_embeddings (object_type, object_id);
create index if not exists knowledge_embeddings_version_idx
  on knowledge_embeddings (embedding_version, updated_at desc);

-- Dedicated full-text indexes for evidence, canonical knowledge, aliases,
-- relations, and generated conclusions.
alter table raw_events add column if not exists search_vector tsvector
  generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, '') || ' ' || source || ' ' || kind)) stored;
alter table entities add column if not exists search_vector tsvector
  generated always as (to_tsvector('simple', value || ' ' || normalized_value || ' ' || description || ' ' || type)) stored;
alter table entity_aliases add column if not exists search_vector tsvector
  generated always as (to_tsvector('simple', alias || ' ' || normalized_alias)) stored;
alter table relations add column if not exists search_vector tsvector
  generated always as (to_tsvector('simple', relation_type || ' ' || label || ' ' || description)) stored;
alter table insight_runs add column if not exists search_vector tsvector
  generated always as (to_tsvector('simple', coalesce(query, '') || ' ' || coalesce(summary, ''))) stored;
alter table digest_runs add column if not exists search_vector tsvector
  generated always as (to_tsvector('simple', coalesce(scope, '') || ' ' || coalesce(summary, ''))) stored;

create index if not exists raw_events_search_vector_idx on raw_events using gin (search_vector);
create index if not exists entities_search_vector_idx on entities using gin (search_vector);
create index if not exists entity_aliases_search_vector_idx on entity_aliases using gin (search_vector);
create index if not exists relations_search_vector_idx on relations using gin (search_vector);
create index if not exists insight_runs_search_vector_idx on insight_runs using gin (search_vector);
create index if not exists digest_runs_search_vector_idx on digest_runs using gin (search_vector);

create table if not exists insight_candidates (
  id text primary key,
  client_id text,
  detector text not null,
  status text not null default 'pending' check (status in ('pending', 'selected', 'delivered', 'dismissed', 'expired')),
  score numeric(8,6) not null,
  novelty numeric(5,4) not null,
  impact numeric(5,4) not null,
  confidence numeric(5,4) not null,
  recurrence numeric(5,4) not null,
  utility numeric(5,4) not null,
  evidence jsonb not null,
  dedupe_key text not null,
  window_from timestamptz not null,
  window_to timestamptz not null,
  severity text not null check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  title text not null,
  explanation text not null,
  suggested_action text,
  expires_at timestamptz not null,
  delivered_at timestamptz,
  feedback_status text check (feedback_status in ('accepted', 'rejected', 'useful', 'not_useful')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists insight_candidates_dedupe_idx
  on insight_candidates (coalesce(client_id, ''), dedupe_key);
create index if not exists insight_candidates_status_score_idx
  on insight_candidates (status, score desc, created_at desc);
create index if not exists insight_candidates_expiry_idx on insight_candidates (expires_at);

alter table insight_runs
  add column if not exists candidate_ids text[] not null default '{}',
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists confidence numeric(5,4),
  add column if not exists suggested_action text,
  add column if not exists delivery_status text not null default 'generated',
  add column if not exists delivered_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists feedback_status text,
  add column if not exists prompt_version text;

create table if not exists background_jobs (
  id text primary key,
  client_id text,
  event_id text references raw_events (id) on delete cascade,
  job_type text not null check (job_type in ('classification', 'semantic_enrichment', 'embedding', 'financial_correlation', 'insight_detection', 'semantic_reconciliation', 'retention', 'backup_verification')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'retry_scheduled', 'succeeded', 'dead_letter', 'cancelled')),
  idempotency_key text not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts > 0),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  cursor_value text,
  provider text,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (job_type, idempotency_key)
);
create index if not exists background_jobs_claim_idx
  on background_jobs (status, run_after, priority, created_at)
  where status in ('queued', 'retry_scheduled');
create index if not exists background_jobs_event_idx on background_jobs (event_id, created_at desc);

create table if not exists background_job_attempts (
  id text primary key,
  job_id text not null references background_jobs (id) on delete cascade,
  attempt integer not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'dead_letter')),
  worker_id text not null,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (job_id, attempt)
);
create index if not exists background_job_attempts_job_idx on background_job_attempts (job_id, attempt desc);

create table if not exists source_processing_policies (
  id text primary key,
  client_scope text not null,
  source text not null,
  enabled boolean not null default true,
  send_to_llm boolean not null default true,
  redact_emails boolean not null default true,
  redact_financial_identifiers boolean not null default true,
  retention_days integer check (retention_days is null or retention_days > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_scope, source)
);

create table if not exists knowledge_feedback (
  id text primary key,
  client_id text,
  action text not null check (action in ('accept', 'reject', 'merge', 'rename', 'categorize')),
  target_type text not null check (target_type in ('event', 'entity', 'relation', 'fact', 'insight', 'candidate')),
  target_id text not null,
  payload jsonb not null default '{}'::jsonb,
  semantic_rule_id text,
  created_at timestamptz not null default now()
);
create index if not exists knowledge_feedback_target_idx
  on knowledge_feedback (target_type, target_id, created_at desc);

create table if not exists data_deletion_audit (
  id text primary key,
  client_id text,
  target_type text not null,
  target_fingerprint text not null,
  mode text not null check (mode in ('hide', 'private', 'delete_evidence', 'delete_knowledge', 'delete_all')),
  reason text,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists backup_verification_runs (
  id text primary key,
  status text not null check (status in ('running', 'verified', 'failed')),
  source_fingerprint text not null,
  table_counts jsonb not null default '{}'::jsonb,
  verification jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
