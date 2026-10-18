-- B08 / M05: additive lease, fence, attempt and replay history for background
-- jobs. Existing jobs, identifiers, attempts and statuses are preserved. No
-- destructive DDL and no data rewrite: legacy running rows simply have a null
-- lease and are treated as expired by the claim query.

alter table background_jobs
  add column if not exists lease_id text,
  add column if not exists fence_token bigint not null default 0,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists last_attempt_finished_at timestamptz,
  add column if not exists replay_generation integer not null default 0;

-- Queue order for ready work and a separate lookup for lease reaping. Both are
-- partial indexes so terminal history does not bloat the claim path.
create index if not exists background_jobs_ready_lease_idx
  on background_jobs (priority, run_after, id)
  where status in ('queued', 'retry_scheduled');
create index if not exists background_jobs_lease_expiry_idx
  on background_jobs (lease_expires_at, id)
  where status = 'running';
create index if not exists background_jobs_fence_idx
  on background_jobs (id, fence_token);

alter table background_job_attempts
  add column if not exists lease_id text,
  add column if not exists fence_token bigint not null default 0,
  add column if not exists replay_generation integer not null default 0,
  add column if not exists heartbeat_at timestamptz;

-- An attempt can now end as abandoned when its lease expires and another worker
-- reclaims the job. This widens an existing check; it does not rewrite rows.
alter table background_job_attempts drop constraint if exists background_job_attempts_status_check;
alter table background_job_attempts add constraint background_job_attempts_status_check
  check (status in ('running', 'succeeded', 'failed', 'dead_letter', 'abandoned'));

create index if not exists background_job_attempts_fence_idx
  on background_job_attempts (job_id, fence_token);

-- Immutable lease history. One row is written per successful claim and is
-- released (completed/failed/expired/replayed) without deleting history.
create table if not exists background_job_leases (
  id text primary key,
  job_id text not null references background_jobs (id) on delete cascade,
  worker_id text not null,
  fence_token bigint not null,
  attempt integer not null,
  replay_generation integer not null default 0,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  heartbeat_at timestamptz,
  released_at timestamptz,
  release_reason text check (release_reason in (
    'completed', 'failed', 'retry_scheduled', 'dead_letter',
    'expired', 'abandoned', 'replayed'
  )),
  unique (job_id, fence_token)
);
create index if not exists background_job_leases_job_idx
  on background_job_leases (job_id, acquired_at desc);
create index if not exists background_job_leases_open_idx
  on background_job_leases (expires_at)
  where released_at is null;

-- Operator replay ledger. Replays preserve the attempts table and the current
-- fence; they increment replay_generation and extend the attempt budget by one
-- full max_attempts window.
create table if not exists background_job_replays (
  id text primary key,
  job_id text not null references background_jobs (id) on delete cascade,
  previous_replay_generation integer not null,
  replay_generation integer not null,
  previous_status text not null,
  previous_attempt_count integer not null,
  previous_fence_token bigint not null,
  previous_max_attempts integer not null,
  reason text,
  requested_by text,
  created_at timestamptz not null default now(),
  unique (job_id, replay_generation)
);
create index if not exists background_job_replays_job_idx
  on background_job_replays (job_id, created_at desc);
