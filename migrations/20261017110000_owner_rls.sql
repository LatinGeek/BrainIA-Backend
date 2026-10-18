-- B06: restricted runtime role and owner isolation policies.
-- This is additive: existing connections keep their current role and are not
-- affected. Application code opts in through withOwnerTransaction(), which
-- sets brainia.owner_id transaction-locally and switches to brainia_runtime.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'brainia_runtime') then
    create role brainia_runtime nologin;
  end if;
end $$;

grant usage on schema public to brainia_runtime;
grant select, insert, update, delete on all tables in schema public to brainia_runtime;
grant usage, select on all sequences in schema public to brainia_runtime;

create or replace function public.brainia_current_owner() returns text
language sql stable as $$
  select nullif(current_setting('brainia.owner_id', true), '')
$$;

grant execute on function public.brainia_current_owner() to brainia_runtime;

-- Every personal table is visible only to the transaction-local owner. Public
-- taxonomy (entities.type domain/concept with no owner) has an additional read
-- policy below so shared ontology stays readable.
do $$
declare
  table_name text;
  personal_tables text[] := array[
    'raw_events', 'entities', 'relations', 'event_entities', 'event_relations',
    'event_semantic_anchors', 'entity_aliases', 'entity_merges', 'entity_review_queue',
    'financial_transactions', 'financial_transaction_events', 'financial_accounts',
    'pending_financial_transactions', 'knowledge_facts', 'knowledge_embeddings',
    'knowledge_feedback', 'background_jobs', 'classification_corrections',
    'classification_decisions', 'classified_events', 'client_diagnostic_logs',
    'client_domain_preferences', 'data_deletion_audit', 'entity_semantic_profiles',
    'insight_candidates', 'intelligence_artifacts', 'intelligence_feedback',
    'interaction_events', 'model_call_audits', 'reclassification_runs',
    'semantic_backfill_runs', 'semantic_candidates', 'semantic_event_decisions',
    'semantic_observations', 'semantic_rules', 'financial_custom_categories',
    'interaction_daily', 'source_processing_policies'
  ];
begin
  foreach table_name in array personal_tables loop
    execute format('alter table %I enable row level security', table_name);
    execute format('drop policy if exists owner_isolation on %I', table_name);
    execute format(
      'create policy owner_isolation on %I using (owner_id = public.brainia_current_owner()) with check (owner_id = public.brainia_current_owner())',
      table_name
    );
  end loop;
end $$;

drop policy if exists public_taxonomy_read on entities;
create policy public_taxonomy_read on entities
  for select using (owner_id is null and type in ('domain', 'concept'));

-- Owner-facing ledgers are service-internal: no policy means default-deny for
-- the restricted role unless it is the table owner.
alter table client_owner_mappings enable row level security;
alter table owner_quarantine enable row level security;
alter table entity_owner_splits enable row level security;

grant execute on function public.owner_row_visible(text, text) to brainia_runtime;
