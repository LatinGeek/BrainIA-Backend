// Test-only pg transport replacement; setup finishes before the read-only CLI starts.
import pg from 'pg';
import { isolated } from './isolated.mjs';
const { db, engine, id } = await isolated();
if (process.env.B09_SCHEMA_DROP_INDEX === 'true') await engine.exec('drop index pending_financial_transactions_active_due_idx');
process.env.SCHEMA_VERIFY_DATABASE_URL = 'postgres://127.0.0.1/brainia_b09_pglite';
process.env.SCHEMA_VERIFY_INSTANCE_ID = id;
pg.Pool.prototype.connect = async () => ({ query: async (sql,args) => {
  if (!/^\s*(?:--[^\n]*\n\s*)*(select|begin|rollback)\b/i.test(sql)) throw new Error('Verifier attempted a non-read-only statement');
  return db.query(sql,args);
}, release() {} });
pg.Pool.prototype.end = async () => engine.close();
