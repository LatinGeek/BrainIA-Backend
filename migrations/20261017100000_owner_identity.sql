-- B05 / M01: additive owner schema, legacy mapping, quarantine and scoped
-- ownership invariants. No destructive DDL: existing rows and identifiers are
-- preserved. RLS enforcement itself is deferred to B06 (compatible queries
-- first); this migration only adds the columns, indexes, ownership checks and
-- the quarantine/mapping ledger needed to backfill safely.

create table if not exists client_owner_mappings (
  legacy_client_id text primary key,
  owner_id text not null,
  status text not null default 'approved' check (status in ('approved', 'quarantined', 'split')),
  approved_by text,
  approved_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists owner_quarantine (
  id text primary key,
  table_name text not null,
  row_id text not null,
  owner_candidate text,
  reason text not null,
  status text not null default 'quarantined' check (status in ('quarantined', 'released', 'remediated')),
  evidence jsonb not null default '{}'::jsonb,
  quarantined_at timestamptz not null default now(),
  released_at timestamptz,
  unique (table_name, row_id)
);

create index if not exists owner_quarantine_status_idx on owner_quarantine (status, table_name);

create table if not exists entity_owner_splits (
  original_entity_id text not null references entities (id) on delete cascade,
  owner_id text not null,
  new_entity_id text not null references entities (id) on delete cascade,
  reason text not null default 'shared_personal_entity',
  created_at timestamptz not null default now(),
  primary key (original_entity_id, owner_id)
);

-- Owner key on every table that carries personal content. Public taxonomy
-- (entities.type in domain/concept) must keep owner_id null; a trigger below
-- enforces that.
alter table raw_events add column if not exists owner_id text;
alter table entities add column if not exists owner_id text;
alter table relations add column if not exists owner_id text;
alter table event_entities add column if not exists owner_id text;
alter table event_relations add column if not exists owner_id text;
alter table event_semantic_anchors add column if not exists owner_id text;
alter table entity_aliases add column if not exists owner_id text;
alter table entity_merges add column if not exists owner_id text;
alter table entity_review_queue add column if not exists owner_id text;
alter table financial_transactions add column if not exists owner_id text;
alter table financial_transaction_events add column if not exists owner_id text;
alter table financial_accounts add column if not exists owner_id text;
alter table pending_financial_transactions add column if not exists owner_id text;
alter table knowledge_facts add column if not exists owner_id text;
alter table knowledge_embeddings add column if not exists owner_id text;
alter table knowledge_feedback add column if not exists owner_id text;
alter table background_jobs add column if not exists owner_id text;
alter table classification_corrections add column if not exists owner_id text;
alter table classification_decisions add column if not exists owner_id text;
alter table classified_events add column if not exists owner_id text;
alter table client_diagnostic_logs add column if not exists owner_id text;
alter table client_domain_preferences add column if not exists owner_id text;
alter table data_deletion_audit add column if not exists owner_id text;
alter table entity_semantic_profiles add column if not exists owner_id text;
alter table insight_candidates add column if not exists owner_id text;
alter table intelligence_artifacts add column if not exists owner_id text;
alter table intelligence_feedback add column if not exists owner_id text;
alter table interaction_events add column if not exists owner_id text;
alter table model_call_audits add column if not exists owner_id text;
alter table reclassification_runs add column if not exists owner_id text;
alter table semantic_backfill_runs add column if not exists owner_id text;
alter table semantic_candidates add column if not exists owner_id text;
alter table semantic_event_decisions add column if not exists owner_id text;
alter table semantic_observations add column if not exists owner_id text;
alter table semantic_rules add column if not exists owner_id text;
alter table financial_custom_categories add column if not exists owner_id text;
alter table interaction_daily add column if not exists owner_id text;
alter table source_processing_policies add column if not exists owner_id text;

create index if not exists raw_events_owner_idx on raw_events (owner_id, created_at desc);
create index if not exists entities_owner_type_idx on entities (owner_id, type);
create index if not exists relations_owner_source_idx on relations (owner_id, source_entity_id);
create index if not exists event_entities_owner_event_idx on event_entities (owner_id, event_id);
create index if not exists event_relations_owner_event_idx on event_relations (owner_id, event_id);
create index if not exists event_semantic_anchors_owner_idx on event_semantic_anchors (owner_id, event_id);
create index if not exists entity_aliases_owner_idx on entity_aliases (owner_id, entity_id);
create index if not exists entity_merges_owner_idx on entity_merges (owner_id, canonical_entity_id);
create index if not exists entity_review_queue_owner_idx on entity_review_queue (owner_id, status);
create index if not exists financial_transactions_owner_observed_idx on financial_transactions (owner_id, observed_at desc);
create index if not exists financial_transaction_events_owner_idx on financial_transaction_events (owner_id, raw_event_id);
create index if not exists financial_accounts_owner_idx on financial_accounts (owner_id);
create index if not exists pending_financial_transactions_owner_idx on pending_financial_transactions (owner_id);
create index if not exists knowledge_facts_owner_event_idx on knowledge_facts (owner_id, event_id);
create index if not exists knowledge_embeddings_owner_idx on knowledge_embeddings (owner_id, object_type, object_id);
create index if not exists knowledge_feedback_owner_idx on knowledge_feedback (owner_id, created_at desc);
create index if not exists background_jobs_owner_idx on background_jobs (owner_id, status);
create index if not exists classification_corrections_owner_idx on classification_corrections (owner_id, event_id);
create index if not exists classification_decisions_owner_idx on classification_decisions (owner_id, event_id);
create index if not exists classified_events_owner_idx on classified_events (owner_id, raw_event_id);
create index if not exists client_diagnostic_logs_owner_idx on client_diagnostic_logs (owner_id, occurred_at desc);
create index if not exists client_domain_preferences_owner_idx on client_domain_preferences (owner_id, domain_entity_id);
create index if not exists data_deletion_audit_owner_idx on data_deletion_audit (owner_id, created_at desc);
create index if not exists entity_semantic_profiles_owner_idx on entity_semantic_profiles (owner_id, entity_id);
create index if not exists insight_candidates_owner_idx on insight_candidates (owner_id, status);
create index if not exists intelligence_artifacts_owner_idx on intelligence_artifacts (owner_id, status);
create index if not exists intelligence_feedback_owner_idx on intelligence_feedback (owner_id, artifact_id);
create index if not exists interaction_events_owner_idx on interaction_events (owner_id, occurred_at desc);
create index if not exists model_call_audits_owner_idx on model_call_audits (owner_id, created_at desc);
create index if not exists reclassification_runs_owner_idx on reclassification_runs (owner_id, created_at desc);
create index if not exists semantic_backfill_runs_owner_idx on semantic_backfill_runs (owner_id, created_at desc);
create index if not exists semantic_candidates_owner_idx on semantic_candidates (owner_id, status);
create index if not exists semantic_event_decisions_owner_idx on semantic_event_decisions (owner_id, event_id);
create index if not exists semantic_observations_owner_idx on semantic_observations (owner_id, event_id);
create index if not exists semantic_rules_owner_idx on semantic_rules (owner_id, source_type);
create index if not exists financial_custom_categories_owner_idx on financial_custom_categories (owner_id, kind);
create index if not exists interaction_daily_owner_idx on interaction_daily (owner_id, day);
create index if not exists source_processing_policies_owner_idx on source_processing_policies (owner_id, source);

-- Composite ownership references. NOT VALID keeps the migration additive over
-- legacy rows; every new write is checked, and validation is a later,
-- explicitly approved deployment step once backfill evidence is reviewed.
create unique index if not exists raw_events_id_owner_id_uidx on raw_events (id, owner_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'event_entities_owner_event_fk') then
    alter table event_entities add constraint event_entities_owner_event_fk
      foreign key (event_id, owner_id) references raw_events (id, owner_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_relations_owner_event_fk') then
    alter table event_relations add constraint event_relations_owner_event_fk
      foreign key (event_id, owner_id) references raw_events (id, owner_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'event_semantic_anchors_owner_event_fk') then
    alter table event_semantic_anchors add constraint event_semantic_anchors_owner_event_fk
      foreign key (event_id, owner_id) references raw_events (id, owner_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'financial_transaction_events_owner_event_fk') then
    alter table financial_transaction_events add constraint financial_transaction_events_owner_event_fk
      foreign key (raw_event_id, owner_id) references raw_events (id, owner_id) not valid;
  end if;
end $$;

-- Public taxonomy is shared. It must never carry an owner.
create or replace function public.enforce_public_taxonomy_owner() returns trigger
language plpgsql as $$
begin
  if new.type in ('domain', 'concept') and new.owner_id is not null then
    raise exception 'public_taxonomy_cannot_be_owned';
  end if;
  return new;
end $$;

drop trigger if exists entities_public_taxonomy_owner on entities;
create trigger entities_public_taxonomy_owner
  before insert or update of owner_id, type on entities
  for each row execute function public.enforce_public_taxonomy_owner();

-- A personal event may only link entities of the same owner. The trigger also
-- fills the owner from the event when a caller omits it.
create or replace function public.enforce_event_entity_owner() returns trigger
language plpgsql as $$
declare event_owner text; entity_owner text;
begin
  select owner_id into event_owner from raw_events where id = new.event_id;
  select owner_id into entity_owner from entities where id = new.entity_id;
  if event_owner is not null and entity_owner is not null and event_owner <> entity_owner then
    raise exception 'event_entity_entity_owner_mismatch';
  end if;
  if new.owner_id is null then
    new.owner_id := event_owner;
  elsif event_owner is not null and new.owner_id <> event_owner then
    raise exception 'event_entity_owner_mismatch';
  end if;
  return new;
end $$;

drop trigger if exists event_entities_owner_guard on event_entities;
create trigger event_entities_owner_guard
  before insert or update of owner_id, event_id, entity_id on event_entities
  for each row execute function public.enforce_event_entity_owner();

-- Relations cannot connect two personal identities owned by different owners.
-- Public taxonomy endpoints are allowed; an owner is inferred when exactly one
-- endpoint is personal.
create or replace function public.enforce_relation_owner() returns trigger
language plpgsql as $$
declare source_owner text; target_owner text;
begin
  select owner_id into source_owner from entities where id = new.source_entity_id;
  select owner_id into target_owner from entities where id = new.target_entity_id;
  if source_owner is not null and target_owner is not null and source_owner <> target_owner then
    raise exception 'relation_owner_mismatch';
  end if;
  if new.owner_id is null then
    new.owner_id := coalesce(source_owner, target_owner);
  elsif source_owner is not null and new.owner_id <> source_owner then
    raise exception 'relation_owner_mismatch';
  elsif target_owner is not null and new.owner_id <> target_owner then
    raise exception 'relation_owner_mismatch';
  end if;
  return new;
end $$;

drop trigger if exists relations_owner_guard on relations;
create trigger relations_owner_guard
  before insert or update of owner_id, source_entity_id, target_entity_id on relations
  for each row execute function public.enforce_relation_owner();

-- Canonical personal entities are owned. Public taxonomy remains null.
create or replace function public.enforce_entity_owner_visibility() returns trigger
language plpgsql as $$
begin
  if new.owner_id is null and coalesce(new.visibility, 'private') = 'private'
     and new.type not in ('domain', 'concept') then
    new.owner_id := null; -- unresolved legacy rows are quarantined by backfill
  end if;
  return new;
end $$;

drop trigger if exists entities_owner_visibility_guard on entities;
create trigger entities_owner_visibility_guard
  before insert or update of owner_id, visibility on entities
  for each row execute function public.enforce_entity_owner_visibility();

-- Ordinary API scoping helper: a row is visible when it has no active
-- quarantine entry. B06 wires this into every route/repository query.
create or replace function public.owner_row_visible(p_table text, p_row_id text) returns boolean
language sql stable as $$
  select not exists (
    select 1 from owner_quarantine q
    where q.table_name = p_table and q.row_id = p_row_id and q.status = 'quarantined'
  )
$$;

-- New ledger tables are created after 0037's table loop, so lock them down
-- explicitly: no policy means default-deny for anon/authenticated.
alter table client_owner_mappings enable row level security;
alter table owner_quarantine enable row level security;
alter table entity_owner_splits enable row level security;
revoke all on table client_owner_mappings from anon, authenticated;
revoke all on table owner_quarantine from anon, authenticated;
revoke all on table entity_owner_splits from anon, authenticated;
