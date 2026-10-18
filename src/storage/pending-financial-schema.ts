import { pool } from './postgres.js';

/** Retained for existing callers; this function never executes DDL or writes a ledger. */
export async function ensurePendingFinancialTransactionsSchema() {
  const result = await pool.query<{ ready: boolean }>(`
    select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='pending_financial_transactions' and c.relkind='r' and c.relrowsecurity)
    and exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
      and c.relname='pending_financial_transactions_active_due_idx' and i.indisvalid and i.indisready)
    as ready
  `);
  if (!result.rows[0]?.ready) throw new Error('schema_not_ready: pending financial transactions require reviewed migrations and schema:verify');
  return { repaired: false, verified: true };
}
