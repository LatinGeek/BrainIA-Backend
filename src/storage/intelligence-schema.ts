import { pool } from './postgres.js';

/** Compatibility entry point. Runtime credentials only inspect catalogs;
 * schema changes belong to the reviewed migration runner, never a request. */
export async function ensureIntelligenceSchema() {
  const result = await pool.query<{ ready: boolean }>(`
    select
      (select count(*) = 10 from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='r' and c.relrowsecurity and c.relname = any(array[
        'classification_corrections','classification_decisions','intelligence_artifacts','intelligence_revisions',
        'intelligence_dependencies','intelligence_feedback','intelligence_confirmations','interaction_events',
        'interaction_daily','reclassification_runs']))
      and (select count(*) = 4 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.pronargs=0 and p.proname = any(array[
        'invalidate_intelligence_event','invalidate_intelligence_scope','invalidate_intelligence_finance','mark_knowledge_pages_stale']))
      and (select count(*) = 6 from pg_trigger t join pg_class c on c.oid=t.tgrelid
        join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and t.tgenabled='O'
        and (c.relname,t.tgname) in (('raw_events','intelligence_raw_invalidation'),
        ('classified_events','intelligence_classified_invalidation'),('classification_corrections','intelligence_correction_invalidation'),
        ('source_processing_policies','intelligence_policy_invalidation'),('financial_transactions','intelligence_finance_invalidation'),
        ('raw_events','intelligence_new_evidence')))
      and (select count(*) = 3 from pg_index i join pg_class c on c.oid=i.indexrelid
        join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and i.indisvalid and i.indisready
        and c.relname = any(array['classification_corrections_lookup','intelligence_schedule_unique','intelligence_artifacts_scope']))
      and exists(select 1 from pg_constraint where conrelid=to_regclass('public.classification_corrections')
        and conname='classification_corrections_field_check' and pg_get_constraintdef(oid) like '%financialCategory%'
        and pg_get_constraintdef(oid) like '%eventCategory%' and pg_get_constraintdef(oid) like '%humanExplanation%')
      as ready
  `);
  if (!result.rows[0]?.ready) throw new Error('schema_not_ready: intelligence requires reviewed migrations and schema:verify');
  return { repaired: false, verified: true };
}
