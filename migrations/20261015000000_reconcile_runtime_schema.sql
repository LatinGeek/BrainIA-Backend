-- B09 roll-forward: restore omitted objects even when historical ledger rows exist.
-- No existing rows or historical ledger entries are deleted. Structural drift fails verification.
-- Backend-only tables. Legacy NULL client IDs are a distinct personal scope.
create table if not exists classification_corrections (
  id text primary key, client_id text, event_id text not null references raw_events(id) on delete cascade,
  source text not null, descriptor text not null, field text not null
    check(field in ('inferredKind','merchant','category','entity')),
  value text not null, previous_value text, reusable boolean not null default true,
  created_at timestamptz not null default now(), revoked_at timestamptz
);
create index if not exists classification_corrections_lookup on classification_corrections(source, descriptor, created_at desc) where revoked_at is null;
insert into classification_corrections(id,client_id,event_id,source,descriptor,field,value)
select 'review_'||r.id,e.client_id,e.id,r.source,
 lower(trim(regexp_replace(coalesce(e.title,'')||' '||coalesce(e.body,''),'\s+',' ','g'))),
 'merchant',coalesce(a.alias,r.suggested_alias,n.value)
from entity_review_queue r join raw_events e on e.id=r.event_id join entities n on n.id=r.entity_id
left join entity_aliases a on a.id=r.alias_id
where r.status='resolved' and n.type='merchant' and e.privacy_status='standard' and e.processing_allowed on conflict (id) do nothing;
create table if not exists classification_decisions (
  id text primary key, event_id text references raw_events(id) on delete cascade, client_id text,
  provider text not null, model text not null, policy_version text not null,
  result jsonb not null, applied boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists intelligence_artifacts (
  id text primary key, client_id text, kind text not null check(kind in ('answer','page','daily','weekly')),
  objective text not null, conversation_id text, parent_id text references intelligence_artifacts(id),
  status text not null default 'queued' check(status in ('queued','running','ready','insufficient','failed','cancelled','stale')),
  content jsonb, evidence jsonb not null default '[]', checkpoint jsonb not null default '{}',
  model text, prompt_version text not null default 'intelligence-v1', failure_reason text,
  user_notes text not null default '', saved boolean not null default false, revision integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  completed_at timestamptz, schedule_key text
);
create unique index if not exists intelligence_schedule_unique on intelligence_artifacts(coalesce(client_id,''),schedule_key) where schedule_key is not null;
create index if not exists intelligence_artifacts_scope on intelligence_artifacts(client_id,created_at desc);
create table if not exists intelligence_revisions (
  artifact_id text not null references intelligence_artifacts(id) on delete cascade,
  revision integer not null, content jsonb, evidence jsonb not null, created_at timestamptz not null default now(),
  primary key(artifact_id,revision)
);
create table if not exists intelligence_dependencies (
  artifact_id text not null references intelligence_artifacts(id) on delete cascade,
  event_id text not null references raw_events(id) on delete cascade, primary key(artifact_id,event_id)
);
create table if not exists intelligence_feedback (
  id text primary key, artifact_id text not null references intelligence_artifacts(id) on delete cascade,
  client_id text, value text not null check(value in ('useful','irrelevant','incorrect','known')),
  created_at timestamptz not null default now()
);
create table if not exists intelligence_confirmations (
  artifact_id text not null references intelligence_artifacts(id) on delete cascade,
  revision integer not null, claim_id text not null, confirmed_at timestamptz not null default now(),
  primary key(artifact_id,revision,claim_id)
);
create table if not exists interaction_events (
  id text primary key, client_id text, session_id text not null, screen text not null, action text not null,
  outcome text, duration_ms integer check(duration_ms >= 0), occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);
create table if not exists interaction_daily (
  day date not null, client_scope text not null, screen text not null, action text not null,
  count bigint not null, total_duration_ms bigint not null default 0,
  primary key(day,client_scope,screen,action)
);
create table if not exists reclassification_runs (
  id text primary key, client_id text, correction_id text not null references classification_corrections(id),
  status text not null default 'preview' check(status in ('preview','applied','reverted')),
  changes jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table background_jobs drop constraint if exists background_jobs_job_type_check;
alter table background_jobs add constraint background_jobs_job_type_check check(job_type in
 ('classification','semantic_enrichment','embedding','financial_correlation','insight_detection',
  'semantic_reconciliation','retention','backup_verification','intelligence_generation'));

-- Conservative invalidation protects summaries even when an old route changes a projection.
create or replace function invalidate_intelligence_event() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare affected text;
begin
  if TG_TABLE_NAME = 'raw_events' then affected := OLD.id;
  elsif TG_TABLE_NAME = 'classified_events' then affected := coalesce(NEW.raw_event_id,OLD.raw_event_id);
  else affected := coalesce(NEW.event_id,OLD.event_id); end if;
  update intelligence_artifacts set status='stale',updated_at=now()
    where status in ('ready','insufficient','running') and id in
      (select artifact_id from intelligence_dependencies where event_id=affected);
  if TG_TABLE_NAME='raw_events' then
    if TG_OP='DELETE' or NEW.privacy_status<>'standard' then
      delete from intelligence_confirmations where artifact_id in(select artifact_id from intelligence_dependencies where event_id=affected);
      delete from intelligence_revisions where artifact_id in(select artifact_id from intelligence_dependencies where event_id=affected);
      update intelligence_artifacts set content=null,evidence='[]',checkpoint='{}',status='stale'
        where id in(select artifact_id from intelligence_dependencies where event_id=affected);
      update classification_corrections set revoked_at=now() where event_id=affected and revoked_at is null;
    end if;
  end if;
  return coalesce(NEW,OLD);
end $$;
drop trigger if exists intelligence_raw_invalidation on raw_events;
create trigger intelligence_raw_invalidation before update or delete on raw_events for each row execute function invalidate_intelligence_event();
drop trigger if exists intelligence_classified_invalidation on classified_events;
create trigger intelligence_classified_invalidation after update or delete on classified_events for each row execute function invalidate_intelligence_event();
drop trigger if exists intelligence_correction_invalidation on classification_corrections;
create trigger intelligence_correction_invalidation after insert or update on classification_corrections for each row execute function invalidate_intelligence_event();

do $$ declare t text; r text; begin
  foreach t in array array['classification_corrections','classification_decisions','intelligence_artifacts',
    'intelligence_revisions','intelligence_dependencies','intelligence_feedback','intelligence_confirmations','interaction_events','interaction_daily','reclassification_runs'] loop
    execute format('alter table %I enable row level security',t);
    foreach r in array array['anon','authenticated'] loop
      if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on table %I from %I',t,r); end if;
    end loop;
  end loop;
end $$;
revoke all on function invalidate_intelligence_event() from public;

create or replace function invalidate_intelligence_scope() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  update intelligence_artifacts set status='stale',updated_at=now()
    where status in ('ready','insufficient','running') and coalesce(client_id,'anonymous')=coalesce(NEW.client_scope,OLD.client_scope);
  return coalesce(NEW,OLD);
end $$;
drop trigger if exists intelligence_policy_invalidation on source_processing_policies;
create trigger intelligence_policy_invalidation after insert or update or delete on source_processing_policies for each row execute function invalidate_intelligence_scope();
revoke all on function invalidate_intelligence_scope() from public;

create or replace function invalidate_intelligence_finance() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  update intelligence_artifacts set status='stale',updated_at=now() where status in ('ready','insufficient','running')
    and id in(select artifact_id from intelligence_dependencies where event_id=coalesce(NEW.anchor_event_id,OLD.anchor_event_id));
  return coalesce(NEW,OLD);
end $$;
drop trigger if exists intelligence_finance_invalidation on financial_transactions;
create trigger intelligence_finance_invalidation after update or delete on financial_transactions for each row execute function invalidate_intelligence_finance();
revoke all on function invalidate_intelligence_finance() from public;

create or replace function mark_knowledge_pages_stale() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 update intelligence_artifacts set status='stale',updated_at=now() where kind='page' and saved
   and client_id is not distinct from NEW.client_id and status in ('ready','insufficient');
 return NEW;
end $$;
drop trigger if exists intelligence_new_evidence on raw_events;
create trigger intelligence_new_evidence after insert on raw_events for each row execute function mark_knowledge_pages_stale();
revoke all on function mark_knowledge_pages_stale() from public;

-- Planned income and expenses live outside the posted ledger. This keeps
-- account balances and reporting based exclusively on executed movements.
create table if not exists pending_financial_transactions (
  id text primary key,
  title text not null,
  kind text not null check (kind in ('expense', 'income')),
  amount numeric(18,2) not null check (amount > 0),
  currency text not null check (upper(currency) in ('UYU', 'USD')),
  category text,
  account_id text references financial_accounts (id) on delete set null,
  estimated_execution_date date not null,
  status text not null default 'pending' check (status in ('pending', 'executed', 'cancelled')),
  executed_at timestamptz,
  cancelled_at timestamptz,
  executed_transaction_id text references financial_transactions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'pending' and executed_at is null and cancelled_at is null and executed_transaction_id is null)
    or (status = 'executed' and executed_at is not null and cancelled_at is null and executed_transaction_id is not null)
    or (status = 'cancelled' and executed_at is null and cancelled_at is not null and executed_transaction_id is null)
  )
);

create index if not exists pending_financial_transactions_active_due_idx
  on pending_financial_transactions (estimated_execution_date asc, created_at desc)
  where status = 'pending';

-- The teach endpoint persists these three explicit user decisions alongside
-- the inferred kind. The original intelligence migration predated them.
alter table classification_corrections
  drop constraint if exists classification_corrections_field_check;

alter table classification_corrections
  add constraint classification_corrections_field_check
  check(field in (
    'inferredKind', 'merchant', 'category', 'entity',
    'financialCategory', 'eventCategory', 'humanExplanation'
  ));

alter table pending_financial_transactions enable row level security;
do $$ declare r text; begin foreach r in array array['anon','authenticated'] loop if exists(select 1 from pg_roles where rolname=r) then execute format('revoke all on table pending_financial_transactions from %I',r); end if; end loop; end $$;
