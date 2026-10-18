-- B07: versioned privacy policy and derived-work invalidation metadata.
-- Additive only: no existing row, column or policy is removed or rewritten.

alter table source_processing_policies
  add column if not exists policy_version bigint not null default 1;

alter table knowledge_embeddings
  add column if not exists policy_version bigint not null default 0;

alter table insight_runs
  add column if not exists policy_version bigint;

alter table digest_runs
  add column if not exists policy_version bigint;

create index if not exists knowledge_embeddings_policy_version_idx
  on knowledge_embeddings (owner_id, object_type, policy_version);

create index if not exists source_processing_policies_owner_version_idx
  on source_processing_policies (owner_id, source, policy_version);

-- Metadata-only audit of policy changes. No prompt, payload, query or provider
-- response body may be stored here.
create table if not exists privacy_policy_changes (
  id text primary key,
  owner_id text,
  source text,
  previous_version bigint not null default 0,
  next_version bigint not null,
  reason text not null default 'policy_updated',
  created_at timestamptz not null default now()
);
create index if not exists privacy_policy_changes_owner_idx
  on privacy_policy_changes (owner_id, created_at desc);

-- Any update to an egress-relevant policy field increments the version. The
-- application never trusts a version supplied by a caller.
create or replace function public.brainia_bump_source_policy_version()
returns trigger
language plpgsql
as $$
begin
  if new.enabled is distinct from old.enabled
    or new.send_to_llm is distinct from old.send_to_llm
    or new.redact_emails is distinct from old.redact_emails
    or new.redact_financial_identifiers is distinct from old.redact_financial_identifiers
    or new.retention_days is distinct from old.retention_days
    or new.owner_id is distinct from old.owner_id then
    new.policy_version := coalesce(old.policy_version, 0) + 1;
  else
    new.policy_version := coalesce(old.policy_version, 1);
  end if;
  return new;
end;
$$;

drop trigger if exists source_processing_policies_version_bump on source_processing_policies;
create trigger source_processing_policies_version_bump
  before update on source_processing_policies
  for each row execute function public.brainia_bump_source_policy_version();

-- Backfill an initial, explicit version for legacy rows so a later update is
-- detectable without treating the absence of a version as a denial.
update source_processing_policies
set policy_version = 1
where policy_version is null;

-- Keep the policy-change audit private from the public API roles.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table privacy_policy_changes from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table privacy_policy_changes from authenticated';
  end if;
end $$;
