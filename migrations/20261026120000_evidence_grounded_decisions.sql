-- Evidence-grounded LLM decisions.
--
-- Additive only: existing rows keep their current values, and every new column
-- is nullable/defaulted so the previous generation and older clients remain
-- readable. The evidence policy never stores a proposal as verified merely
-- because it parsed: verification, deterministic checks and evidence references
-- are recorded separately and revalidated when a human approves a candidate.

alter table semantic_candidates
  add column if not exists action_kind text,
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists evidence_event_ids jsonb not null default '[]'::jsonb,
  add column if not exists verified_event_count integer not null default 0,
  add column if not exists verification_status text not null default 'not_required',
  add column if not exists verification jsonb not null default '{}'::jsonb,
  add column if not exists policy_version text,
  add column if not exists change_explanation text,
  add column if not exists decision_fingerprint text,
  add column if not exists superseded_by_candidate_id text,
  add column if not exists generation_id text;

alter table semantic_candidates drop constraint if exists semantic_candidates_status_check;
alter table semantic_candidates add constraint semantic_candidates_status_check
  check (status in ('pending', 'approved', 'rejected', 'superseded'));

create index if not exists semantic_candidates_fingerprint_idx
  on semantic_candidates (client_id, decision_fingerprint)
  where decision_fingerprint is not null;

create index if not exists semantic_candidates_generation_idx
  on semantic_candidates (generation_id, status)
  where generation_id is not null;

-- A rejection is scoped negative feedback. Reprocessing may only surface an
-- equivalent proposal again when the evidence fingerprint changes, which means
-- materially new evidence entered the decision.
create table if not exists semantic_candidate_feedback (
  id text primary key,
  client_id text,
  candidate_id text references semantic_candidates (id) on delete set null,
  decision_fingerprint text not null,
  action_kind text,
  policy_version text,
  reason text not null default 'user_rejected',
  evidence_event_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists semantic_candidate_feedback_scope_idx
  on semantic_candidate_feedback (coalesce(client_id, ''), decision_fingerprint, reason);

alter table semantic_event_decisions
  add column if not exists verification_status text not null default 'not_required',
  add column if not exists verification jsonb not null default '{}'::jsonb,
  add column if not exists policy_version text,
  add column if not exists abstained boolean not null default false,
  add column if not exists abstention_reason text,
  add column if not exists evidence_fingerprint text,
  add column if not exists generation_id text,
  add column if not exists superseded_by_generation_id text;

alter table semantic_event_decisions drop constraint if exists semantic_event_decisions_status_check;
alter table semantic_event_decisions add constraint semantic_event_decisions_status_check
  check (status in ('resolved', 'review', 'unclassified', 'model_unavailable', 'retryable', 'discarded'));

-- One row per independent verifier attempt. The generator's confidence and
-- rationale are deliberately not stored here as inputs: they are not evidence.
create table if not exists decision_verifications (
  id text primary key,
  client_id text,
  event_id text references raw_events (id) on delete set null,
  operation text not null,
  action_kind text not null,
  policy_version text not null,
  generator_model text,
  verifier_model text,
  generator_prompt_version text,
  verifier_prompt_version text not null,
  deterministic_status text not null check (deterministic_status in ('passed', 'failed')),
  deterministic_errors jsonb not null default '[]'::jsonb,
  verifier_status text not null check (verifier_status in ('verified', 'rejected', 'unavailable', 'not_required')),
  decision_status text not null check (decision_status in ('applied', 'shadowed', 'blocked')),
  verdict text,
  reason text,
  unsupported jsonb not null default '[]'::jsonb,
  evidence_fingerprint text,
  evidence_refs jsonb not null default '[]'::jsonb,
  proposal jsonb not null default '{}'::jsonb,
  verifier_response jsonb not null default '{}'::jsonb,
  latency_ms integer,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists decision_verifications_event_idx
  on decision_verifications (event_id, created_at desc);
create index if not exists decision_verifications_operation_idx
  on decision_verifications (operation, verifier_status, created_at desc);

-- Historical interpretation generations. Snapshots are computed first and only
-- applied on activation; the previous generation stays available for rollback.
create table if not exists interpretation_generations (
  id text primary key,
  label text,
  status text not null default 'staging'
    check (status in ('staging', 'staged', 'activating', 'active', 'superseded', 'rolled_back', 'failed')),
  policy_version text not null,
  governance_version text not null,
  prompt_version text not null,
  previous_generation_id text references interpretation_generations (id) on delete set null,
  cursor_value text,
  requested integer not null default 0,
  staged integer not null default 0,
  blocked integer not null default 0,
  failed integer not null default 0,
  comparison jsonb not null default '{}'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  staged_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists interpretation_generations_one_active_idx
  on interpretation_generations (status) where status = 'active';

create table if not exists event_interpretation_snapshots (
  id text primary key,
  generation_id text not null references interpretation_generations (id) on delete cascade,
  event_id text not null references raw_events (id) on delete cascade,
  client_id text,
  processing_allowed boolean not null default true,
  privacy_status text,
  status text not null default 'staged'
    check (status in ('staged', 'blocked', 'failed', 'applied', 'superseded')),
  blocked_reason text,
  classification jsonb not null default '{}'::jsonb,
  semantic_decision jsonb not null default '{}'::jsonb,
  interpretation jsonb not null default '{}'::jsonb,
  verification_status text not null default 'not_required',
  abstained boolean not null default false,
  evidence_event_ids jsonb not null default '[]'::jsonb,
  latency_ms integer,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (generation_id, event_id)
);
create index if not exists event_interpretation_snapshots_cursor_idx
  on event_interpretation_snapshots (generation_id, created_at, event_id);

create table if not exists interpretation_generation_control (
  id integer primary key default 1 check (id = 1),
  active_generation_id text references interpretation_generations (id) on delete set null,
  mode text not null default 'shadow' check (mode in ('off', 'shadow', 'enforce')),
  updated_at timestamptz not null default now()
);
insert into interpretation_generation_control (id, mode) values (1, 'shadow') on conflict (id) do nothing;
