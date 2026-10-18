-- B11: durable deletion tombstones and derived-content lineage.
--
-- A tombstone is written before any asynchronous physical cleanup. It keeps
-- the owner, target, mode and policy that justified the deletion, and every
-- derived row touched by the traversal is recorded in
-- deletion_tombstone_targets. The target is made ineligible in the same
-- transaction as the tombstone, so a queued cleanup worker cannot expose it.
--
-- Backup expiry: the default retention window is 30 days. Backups older than
-- BACKUP_EXPIRY_DAYS must not be restored without an explicit privacy review,
-- because the tombstone ledger may no longer cover them. A restore must apply
-- this ledger before the database accepts traffic.
--
-- Additive only: existing tables, rows, constraints and policies are kept.

create table if not exists deletion_tombstones (
  id text primary key,
  owner_id text not null,
  target_type text not null,
  target_id text not null,
  mode text not null check (mode in ('delete_evidence', 'delete_knowledge', 'delete_all', 'retention')),
  policy jsonb not null default '{}'::jsonb,
  reason text,
  status text not null default 'tombstoned'
    check (status in ('tombstoned', 'cleanup_running', 'cleaned', 'restore_applied')),
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  cleanup_started_at timestamptz,
  cleaned_at timestamptz,
  restore_applied_at timestamptz,
  backup_expires_at timestamptz not null default (now() + interval '30 days'),
  unique (owner_id, target_type, target_id)
);

create index if not exists deletion_tombstones_owner_idx
  on deletion_tombstones (owner_id, created_at desc);
create index if not exists deletion_tombstones_target_idx
  on deletion_tombstones (target_type, target_id);
create index if not exists deletion_tombstones_backup_expiry_idx
  on deletion_tombstones (backup_expires_at);

create table if not exists deletion_tombstone_targets (
  id text primary key,
  tombstone_id text not null references deletion_tombstones (id) on delete cascade,
  owner_id text not null,
  target_type text not null,
  target_id text not null,
  disposition text not null
    check (disposition in ('tombstoned', 'deleted', 'invalidated', 'detached', 'retained')),
  reason text,
  created_at timestamptz not null default now(),
  unique (tombstone_id, target_type, target_id)
);

create index if not exists deletion_tombstone_targets_tombstone_idx
  on deletion_tombstone_targets (tombstone_id);
create index if not exists deletion_tombstone_targets_target_idx
  on deletion_tombstone_targets (target_type, target_id);

-- Personal ledgers are owner-scoped. Service-internal writers run as the table
-- owner; anonymous/authenticated API roles remain default-deny.
alter table deletion_tombstones enable row level security;
alter table deletion_tombstone_targets enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'brainia_current_owner') then
    null;
  end if;
end $$;

drop policy if exists owner_isolation on deletion_tombstones;
create policy owner_isolation on deletion_tombstones
  using (owner_id = public.brainia_current_owner())
  with check (owner_id = public.brainia_current_owner());

drop policy if exists owner_isolation on deletion_tombstone_targets;
create policy owner_isolation on deletion_tombstone_targets
  using (owner_id = public.brainia_current_owner())
  with check (owner_id = public.brainia_current_owner());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table deletion_tombstones from anon';
    execute 'revoke all on table deletion_tombstone_targets from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table deletion_tombstones from authenticated';
    execute 'revoke all on table deletion_tombstone_targets from authenticated';
  end if;
end $$;

-- Replay guard: a logically deleted event cannot be inserted again. Updates
-- force the event to remain hidden and unprocessable.
create or replace function public.brainia_block_deleted_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from deletion_tombstones tombstone
    where tombstone.target_type = 'event'
      and tombstone.target_id = new.id
      and (
        tombstone.owner_id = coalesce(new.owner_id, new.client_id)
        or (tombstone.owner_id = 'anonymous' and new.owner_id is null and new.client_id is null)
      )
  ) then
    if tg_op = 'INSERT' then
      return null;
    end if;
    new.privacy_status := 'hidden';
    new.processing_allowed := false;
    new.processing_status := 'discarded';
  end if;
  return new;
end;
$$;

drop trigger if exists deletion_raw_event_insert_guard on raw_events;
create trigger deletion_raw_event_insert_guard
  before insert on raw_events
  for each row execute function public.brainia_block_deleted_event();

drop trigger if exists deletion_raw_event_update_guard on raw_events;
create trigger deletion_raw_event_update_guard
  before update on raw_events
  for each row execute function public.brainia_block_deleted_event();

-- Any event-derived row is rejected when its source event is tombstoned. This
-- is the replay/backfill barrier: old workers cannot re-create eligible derived
-- content after the tombstone has committed.
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

-- Embeddings have polymorphic object types; block every resurrectable shape.
create or replace function public.brainia_block_deleted_embedding()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (
    (new.object_type = 'event' and exists (
      select 1 from deletion_tombstones tombstone
      where tombstone.target_type = 'event' and tombstone.target_id = new.object_id
        and (new.owner_id is null or tombstone.owner_id = new.owner_id or tombstone.owner_id = new.client_id)
    ))
    or (new.object_type = 'entity' and exists (
      select 1 from event_entities link
      join deletion_tombstones tombstone
        on tombstone.target_type = 'event' and tombstone.target_id = link.event_id
      where link.entity_id = new.object_id
        and (new.owner_id is null or tombstone.owner_id = new.owner_id or tombstone.owner_id = new.client_id)
    ))
    or (new.object_type = 'fact' and exists (
      select 1 from knowledge_facts fact
      join deletion_tombstones tombstone
        on tombstone.target_type = 'event' and tombstone.target_id = fact.event_id
      where fact.id = new.object_id
        and (new.owner_id is null or tombstone.owner_id = coalesce(fact.owner_id, fact.client_id))
    ))
    or (new.object_type in ('insight', 'digest') and exists (
      select 1 from deletion_tombstones tombstone
      where tombstone.target_type = new.object_type and tombstone.target_id = new.object_id
        and (new.owner_id is null or tombstone.owner_id = new.owner_id)
    ))
  ) then
    if tg_op = 'INSERT' then
      return null;
    end if;
    -- Existing rows must remain updatable so quarantine/cleanup can mark or
    -- delete them; an update can never make a tombstoned embedding eligible.
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || '{"deleted":true,"policyStale":true}'::jsonb;
  end if;

  return new;
end;
$$;

drop trigger if exists deletion_embedding_guard on knowledge_embeddings;
create trigger deletion_embedding_guard
  before insert or update on knowledge_embeddings
  for each row execute function public.brainia_block_deleted_embedding();
