-- B11 r2: close the remaining replay/resurrection gaps.
--
-- Additive only. The previous migration guarded the main event-derived tables
-- and embeddings. This migration:
--   1. teaches the event-derived guard that classified_events uses raw_event_id;
--   2. adds classified_events, event_entities and event_relations to the guard;
--   3. guards insight_runs, digest_runs, intelligence_artifacts and
--      insight_candidates, which have no event_id column but persist evidence
--      or a digest window that can still reference a tombstoned event.
--
-- A replayed row is rejected on insert. On update it is forced ineligible
-- (summary/scope/content/evidence cleared), so an old writer cannot make a
-- quarantined derived row publishable again.

create or replace function public.brainia_block_event_derived_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_event_id text;
  source_owner_id text;
begin
  -- to_jsonb avoids resolving columns that do not exist on every trigger table.
  source_event_id := case tg_table_name
    when 'financial_transaction_events' then to_jsonb(new)->>'raw_event_id'
    when 'financial_transactions' then to_jsonb(new)->>'anchor_event_id'
    when 'classified_events' then to_jsonb(new)->>'raw_event_id'
    else to_jsonb(new)->>'event_id'
  end;

  if source_event_id is null then
    return new;
  end if;

  source_owner_id := coalesce(to_jsonb(new)->>'owner_id', to_jsonb(new)->>'client_id');

  if exists (
    select 1 from deletion_tombstones tombstone
    where tombstone.target_type = 'event'
      and tombstone.target_id = source_event_id
      and (source_owner_id is null or tombstone.owner_id = source_owner_id)
  ) then
    return null;
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'knowledge_facts', 'classification_corrections', 'classification_decisions',
    'classified_events', 'event_entities', 'event_relations',
    'semantic_candidates', 'semantic_observations', 'semantic_event_decisions',
    'event_semantic_anchors', 'intelligence_dependencies',
    'financial_transaction_events', 'financial_transactions'
  ] loop
    execute format('drop trigger if exists deletion_event_derived_guard on %I', table_name);
    execute format(
      'create trigger deletion_event_derived_guard before insert on %I for each row execute function public.brainia_block_event_derived_insert()',
      table_name
    );
  end loop;
end $$;

-- Derived rows without an event_id column. Any persisted payload that names a
-- tombstoned target, a hidden event/entity, or (for digests) a window that
-- contains a tombstoned event is rejected or forced ineligible.
create or replace function public.brainia_block_deleted_derived_run()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payload text;
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
