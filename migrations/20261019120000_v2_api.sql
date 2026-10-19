-- Additive v2 evidence and receipts. Application transactions set
-- brainia.owner_id and use brainia_runtime, as in B05/B06.
create table if not exists v2_source_instances (
  owner_id text not null,
  id text not null,
  content_type text,
  source text not null,
  enabled boolean not null default false,
  primary key (owner_id, id)
);

create table if not exists v2_observations (
  id text primary key,
  owner_id text,
  source_instance_id text not null,
  source_observation_key text not null,
  content_type text,
  latest_revision_id text,
  latest_revision_number integer not null default 1 check (latest_revision_number > 0),
  revision_count integer not null default 0 check (revision_count >= 0),
  stage text not null default 'captured' check (stage in
    ('captured','queued','running','succeeded','review','retry_scheduled','dead_letter','cancelled')),
  stage_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  -- Logical legacy link: deleting v1 evidence must not rewrite revisions.
  raw_event_id text,
  unique (owner_id, source_instance_id, source_observation_key),
  unique (id, owner_id)
);
create index if not exists v2_observations_owner_updated_idx
  on v2_observations (owner_id, updated_at, id);
create unique index if not exists v2_observations_raw_event_idx
  on v2_observations (raw_event_id) where raw_event_id is not null;

create table if not exists v2_observation_revisions (
  id text primary key,
  owner_id text,
  observation_id text not null references v2_observations(id),
  revision_number integer not null check (revision_number > 0),
  producer_revision_id uuid,
  producer_sequence text check (producer_sequence ~ '^[1-9][0-9]{0,18}$'),
  delivery_id uuid,
  change_kind text not null check (change_kind in ('posted','updated','removed','imported')),
  canonicalization_version text not null,
  content_fingerprint text,
  source_occurred_at timestamptz,
  source_updated_at timestamptz,
  device_observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  content jsonb not null,
  legacy_payload jsonb,
  raw_event_id text,
  unique (owner_id, delivery_id),
  unique (observation_id, producer_revision_id),
  unique (observation_id, revision_number),
  unique (id, observation_id, owner_id),
  foreign key (observation_id, owner_id) references v2_observations(id, owner_id),
  -- Null producer identity is reserved for legacy evidence, never v2 capture.
  check (canonicalization_version = 'legacy-jsonb-v1' or
    (canonicalization_version = 'jcs-sha256-v1' and owner_id is not null
      and producer_revision_id is not null and producer_sequence is not null
      and delivery_id is not null and content_fingerprint is not null))
);
create index if not exists v2_revisions_owner_observation_idx
  on v2_observation_revisions (owner_id, observation_id, revision_number);

create table if not exists v2_delivery_receipts (
  owner_id text not null,
  delivery_id uuid not null,
  request_hash text not null,
  receipt jsonb not null,
  primary key (owner_id, delivery_id)
);

create table if not exists v2_target_versions (
  owner_id text not null,
  target_type text not null check (target_type in ('event','transaction','fact','episode')),
  target_id text not null,
  version integer not null default 1 check (version > 0),
  overrides jsonb not null default '{}'::jsonb,
  primary key (owner_id, target_type, target_id)
);

create table if not exists v2_corrections (
  id text primary key,
  owner_id text not null,
  idempotency_key text not null,
  target_type text not null check (target_type in ('event','transaction','fact','episode')),
  target_id text not null,
  expected_version integer not null check (expected_version > 0),
  field text not null,
  value jsonb not null,
  scope text not null check (scope in ('once','rule')),
  rule_match jsonb,
  reason text,
  status text not null check (status in ('applied','review')),
  version integer not null default 1 check (version > 0),
  affected_count integer not null default 0 check (affected_count >= 0),
  reprocessing text not null default 'not_required' check (reprocessing in ('queued','not_required')),
  review_reasons jsonb not null default '[]'::jsonb,
  request jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  applied_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (owner_id, idempotency_key),
  check (scope <> 'rule' or (rule_match is not null and rule_match <> 'null'::jsonb))
);
create index if not exists v2_corrections_owner_target_idx
  on v2_corrections (owner_id, target_type, target_id, created_at);

create table if not exists v2_queries (
  id text primary key,
  owner_id text not null,
  status text not null default 'queued' check (status in ('queued','running','completed','review','failed')),
  request jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists v2_queries_owner_created_idx on v2_queries (owner_id, created_at, id);

create table if not exists v2_export_snapshots (
  id text primary key,
  owner_id text not null,
  filters jsonb not null default '{}'::jsonb,
  cursor_state jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);
create index if not exists v2_export_snapshots_owner_expiry_idx on v2_export_snapshots (owner_id, expires_at);

create table if not exists v2_export_audit (
  id text primary key,
  owner_id text not null,
  snapshot_id text not null,
  created_at timestamptz not null default now(),
  page_count integer not null default 1 check (page_count >= 0)
);
create index if not exists v2_export_audit_owner_snapshot_idx
  on v2_export_audit (owner_id, snapshot_id, created_at);

create table if not exists v2_connectors (
  id text primary key,
  owner_id text not null,
  provider text not null,
  status text not null,
  version integer not null default 1 check (version > 0),
  -- Reference to an external secret store only; never put tokens in this column.
  token_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists v2_connectors_owner_idx on v2_connectors (owner_id, provider);

alter table source_processing_policies
  add column if not exists external_models_allowed boolean not null default false,
  add column if not exists external_embeddings_allowed boolean not null default false,
  add column if not exists policy_version bigint not null default 1,
  add column if not exists retention_days integer;

-- V2 source-policy updates reuse B07's metadata-only invalidation audit while
-- running as the restricted owner role. Grant only owner-bound insertion.
alter table privacy_policy_changes enable row level security;
grant insert on privacy_policy_changes to brainia_runtime;
drop policy if exists v2_owner_policy_audit_insert on privacy_policy_changes;
create policy v2_owner_policy_audit_insert on privacy_policy_changes
  for insert to brainia_runtime
  with check (owner_id = public.brainia_current_owner());

grant select on deletion_tombstones to brainia_runtime;
grant select on fx_rates to brainia_runtime;
drop policy if exists v2_approved_fx_read on fx_rates;
create policy v2_approved_fx_read on fx_rates for select to brainia_runtime
  using (approved = true);

-- The quarantine ledger is service-private. Expose a boolean check only;
-- granting the runtime role that ledger would expose other owners' metadata.
create or replace function public.brainia_v2_row_visible(p_table text, p_id text, p_owner text)
returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
  select p_owner = public.brainia_current_owner()
    and p_table in ('raw_events','financial_transactions','knowledge_facts')
    and not exists(select 1 from public.owner_quarantine q
      where q.table_name=p_table and q.row_id=p_id and q.status='quarantined')
$$;
revoke all on function public.brainia_v2_row_visible(text,text,text) from public, anon, authenticated;
grant execute on function public.brainia_v2_row_visible(text,text,text) to brainia_runtime;

-- Preserve B07's existing bump semantics and cover both new egress controls.
create or replace function public.brainia_bump_source_policy_version()
returns trigger language plpgsql as $$
begin
  if new.enabled is distinct from old.enabled
    or new.send_to_llm is distinct from old.send_to_llm
    or new.redact_emails is distinct from old.redact_emails
    or new.redact_financial_identifiers is distinct from old.redact_financial_identifiers
    or new.retention_days is distinct from old.retention_days
    or new.owner_id is distinct from old.owner_id
    or new.external_models_allowed is distinct from old.external_models_allowed
    or new.external_embeddings_allowed is distinct from old.external_embeddings_allowed then
    new.policy_version := coalesce(old.policy_version, 0) + 1;
  else
    new.policy_version := coalesce(old.policy_version, 1);
  end if;
  return new;
end;
$$;

-- Source registration requires an approved identity mapping, never an arbitrary
-- source ID supplied by a capture request. Unknown legacy types stay disabled.
insert into v2_source_instances (owner_id, id, content_type, source, enabled)
select distinct e.owner_id, e.source,
  case e.source when 'capture.note' then 'note' when 'capture.notification' then 'notification'
    when 'capture.wallet' then 'receipt' end,
  e.source, e.source in ('capture.note','capture.notification','capture.wallet')
from raw_events e join client_owner_mappings m
  on m.legacy_client_id = e.client_id and m.owner_id = e.owner_id and m.status = 'approved'
where e.owner_id is not null
  and public.owner_row_visible('raw_events', e.id)
on conflict (owner_id, id) do nothing;

-- Exactly one known historical revision per raw row, without fabricating
-- producer UUIDs, canonical fingerprints, source update times or receipts.
-- Ownerless evidence remains ownerless and invisible to the runtime role.
insert into v2_observations (
  id, owner_id, source_instance_id, source_observation_key, content_type,
  latest_revision_id, latest_revision_number, revision_count, stage,
  stage_updated_at, created_at, updated_at, deleted, raw_event_id)
select 'legacy-observation:' || e.id,
  case when public.owner_row_visible('raw_events', e.id) then e.owner_id end,
  e.source, e.id,
  case e.source when 'capture.note' then 'note' when 'capture.notification' then 'notification'
    when 'capture.wallet' then 'receipt' else 'note' end,
  'legacy-revision:' || e.id, 1, 1,
  case e.processing_status when 'review' then 'review' when 'retryable' then 'retry_scheduled'
    when 'discarded' then 'cancelled' when 'captured' then 'captured' else 'succeeded' end,
  e.processing_status_updated_at, e.created_at, e.created_at, false, e.id
from raw_events e
where not exists (select 1 from v2_observation_revisions captured
  where captured.raw_event_id = e.id)
on conflict do nothing;

insert into v2_observation_revisions (
  id, owner_id, observation_id, revision_number, change_kind,
  canonicalization_version, source_occurred_at, source_updated_at,
  device_observed_at, received_at, content, legacy_payload, raw_event_id)
select 'legacy-revision:' || e.id, o.owner_id, 'legacy-observation:' || e.id, 1,
  'imported', 'legacy-jsonb-v1', e.timestamp, null,
  coalesce(e.timestamp, e.created_at), e.created_at,
  jsonb_build_object('type', coalesce(o.content_type, 'note'),
    'title', e.title, 'body', e.body, 'raw', '{}'::jsonb)
  || case o.content_type
    when 'notification' then jsonb_build_object('packageName', coalesce(nullif(e.raw->>'packageName',''), e.source))
    when 'receipt' then jsonb_build_object('merchantText', null, 'reference', null, 'attachmentRefs', '[]'::jsonb)
    else '{}'::jsonb end,
  to_jsonb(e), e.id
from raw_events e join v2_observations o on o.id = 'legacy-observation:' || e.id
on conflict do nothing;

-- Immutable evidence, including against administrative accidental updates.
-- Privacy erasure is an explicit privileged DELETE, never a runtime setting.
create or replace function public.brainia_v2_revision_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE'
    and current_setting('brainia.v2_privacy_cleanup', true) = 'on'
    and current_user = pg_get_userbyid((select relowner from pg_class where oid = tg_relid)) then
    return old;
  end if;
  raise exception 'v2_revision_immutable' using errcode = '55000';
end;
$$;
drop trigger if exists v2_revision_immutable on v2_observation_revisions;
create trigger v2_revision_immutable before update or delete on v2_observation_revisions
  for each row execute function public.brainia_v2_revision_immutable();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'v2_source_instances','v2_observations','v2_observation_revisions',
    'v2_delivery_receipts','v2_target_versions','v2_corrections','v2_queries',
    'v2_export_snapshots','v2_export_audit','v2_connectors'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format('drop policy if exists owner_isolation on %I', table_name);
    execute format('create policy owner_isolation on %I to brainia_runtime using
      (owner_id = public.brainia_current_owner()) with check
      (owner_id = public.brainia_current_owner())', table_name);
    execute format('revoke all on table %I from public, anon, authenticated', table_name);
    execute format('grant select, insert, update, delete on table %I to brainia_runtime', table_name);
  end loop;
end;
$$;
-- No mutation grant is necessary for runtime revision reads/capture.
revoke update, delete on v2_observation_revisions from brainia_runtime;
