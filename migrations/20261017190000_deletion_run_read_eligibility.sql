-- B11 r3: close the two residual serving paths left after r2.
--
-- Additive only. No row is rewritten and no backfill is required.
--
--   1. `revalidated_at` records an explicit post-tombstone revalidation. Read
--      paths treat a run as eligible again only when this timestamp is strictly
--      after the covering tombstone. Existing rows stay null (not revalidated).
--   2. `brainia_block_deleted_derived_run` now rejects an unlinked summary-only
--      insert once the owner has any tombstone. A legitimate post-deletion run
--      must persist explicit live-event lineage in evidence/request/response.
--
-- Read-time eligibility itself lives in
-- `src/storage/search-repository.ts#derivedRunReadEligibilitySql` and is applied
-- by the insight/digest repositories, hybrid retrieval and export. Doing it at
-- read time (rather than backfilling rows) is what makes legacy r1 tombstones
-- effective for already-persisted window digests and entity-only insights.

alter table insight_runs add column if not exists revalidated_at timestamptz;
alter table digest_runs add column if not exists revalidated_at timestamptz;

comment on column insight_runs.revalidated_at is
  'B11 r3: explicit post-tombstone revalidation. Null means never revalidated.';
comment on column digest_runs.revalidated_at is
  'B11 r3: explicit post-tombstone revalidation. Null means never revalidated.';

create or replace function public.brainia_block_deleted_derived_run()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payload text;
  lineage_payload text;
  owner_scope text;
  row_id text;
  window_from timestamptz;
  window_to timestamptz;
  blocked boolean := false;
begin
  payload := concat_ws(' ',
    to_jsonb(new)->>'id',
    to_jsonb(new)->>'evidence',
    to_jsonb(new)->>'request',
    to_jsonb(new)->>'response',
    to_jsonb(new)->>'summary',
    to_jsonb(new)->>'query',
    to_jsonb(new)->>'scope',
    to_jsonb(new)->>'objective',
    to_jsonb(new)->>'content',
    to_jsonb(new)->>'checkpoint',
    to_jsonb(new)->>'title',
    to_jsonb(new)->>'explanation'
  );
  -- Lineage is deliberately narrower than the redaction payload: a summary is
  -- not evidence. Only persisted evidence/request/response can carry lineage.
  lineage_payload := concat_ws(' ',
    to_jsonb(new)->>'evidence',
    to_jsonb(new)->>'request',
    to_jsonb(new)->>'response'
  );
  owner_scope := coalesce(to_jsonb(new)->>'owner_id', to_jsonb(new)->>'client_id');
  row_id := to_jsonb(new)->>'id';

  if exists (
    select 1 from deletion_tombstones tombstone
    where tombstone.target_id is not null
      and tombstone.target_id <> coalesce(row_id, '')
      and (owner_scope is null or tombstone.owner_id = owner_scope or tombstone.owner_id = 'anonymous')
      and strpos(payload, tombstone.target_id) > 0
  ) then
    blocked := true;
  end if;

  if not blocked and owner_scope is not null and exists (
    select 1 from raw_events event
    where coalesce(event.owner_id, event.client_id) = owner_scope
      and (event.privacy_status = 'hidden' or not event.processing_allowed)
      and strpos(payload, event.id) > 0
  ) then
    blocked := true;
  end if;

  if not blocked and owner_scope is not null and exists (
    select 1 from entities entity
    where entity.owner_id = owner_scope
      and entity.visibility = 'hidden'
      and strpos(payload, entity.id) > 0
  ) then
    blocked := true;
  end if;

  if not blocked and tg_table_name = 'digest_runs' then
    window_from := nullif(to_jsonb(new)->>'window_from', '')::timestamptz;
    window_to := nullif(to_jsonb(new)->>'window_to', '')::timestamptz;
    if window_from is not null and window_to is not null and exists (
      select 1 from deletion_tombstones tombstone
      join raw_events event on event.id = tombstone.target_id
      where tombstone.target_type = 'event'
        and (owner_scope is null or tombstone.owner_id = owner_scope or tombstone.owner_id = 'anonymous')
        and coalesce(event.timestamp, event.created_at) between window_from and window_to
    ) then
      blocked := true;
    end if;
  end if;

  -- B11 r3 / R2: once the owner has an active tombstone, an inserted derived run
  -- must carry explicit lineage to a still-live event. A summary-only row with
  -- no evidence/query/window lineage can no longer be replayed into serving.
  if tg_op = 'INSERT' and not blocked and exists (
    select 1 from deletion_tombstones tombstone
    where tombstone.owner_id = coalesce(owner_scope, 'anonymous')
  ) and not exists (
    select 1 from raw_events event
    where (
      (owner_scope is not null and coalesce(event.owner_id, event.client_id) = owner_scope)
      or (owner_scope is null and event.owner_id is null and event.client_id is null)
    )
      and event.privacy_status = 'standard'
      and event.processing_allowed
      and strpos(coalesce(lineage_payload, ''), event.id) > 0
  ) then
    return null;
  end if;

  if blocked then
    if tg_op = 'INSERT' then
      return null;
    end if;
    if tg_table_name = 'insight_runs' then
      new.summary := null;
      new.query := null;
      new.evidence := '[]'::jsonb;
      new.response := '{}'::jsonb;
      new.request := '{}'::jsonb;
    elsif tg_table_name = 'digest_runs' then
      new.summary := null;
      new.scope := null;
      new.request := '{}'::jsonb;
      new.response := '{}'::jsonb;
    elsif tg_table_name = 'intelligence_artifacts' then
      new.status := 'stale';
      new.content := null;
      new.evidence := '[]'::jsonb;
      new.checkpoint := '{}'::jsonb;
    elsif tg_table_name = 'insight_candidates' then
      new.status := 'expired';
      new.evidence := '[]'::jsonb;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists deletion_insight_run_guard on insight_runs;
create trigger deletion_insight_run_guard
  before insert or update on insight_runs
  for each row execute function public.brainia_block_deleted_derived_run();

drop trigger if exists deletion_digest_run_guard on digest_runs;
create trigger deletion_digest_run_guard
  before insert or update on digest_runs
  for each row execute function public.brainia_block_deleted_derived_run();

drop trigger if exists deletion_artifact_guard on intelligence_artifacts;
create trigger deletion_artifact_guard
  before insert or update on intelligence_artifacts
  for each row execute function public.brainia_block_deleted_derived_run();

drop trigger if exists deletion_insight_candidate_guard on insight_candidates;
create trigger deletion_insight_candidate_guard
  before insert or update on insight_candidates
  for each row execute function public.brainia_block_deleted_derived_run();
