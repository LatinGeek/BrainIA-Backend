import { Pool, type PoolClient } from "pg";
import { resolveRuntimeDatabaseUrl } from "./database-url.js";

/**
 * Minimal query surface shared by the pool and an owner-scoped transaction
 * client. Repositories accept this so a route can run a read on the
 * transaction that carries `brainia.owner_id` (and, when enforced, the
 * `brainia_runtime` role) instead of the legacy table-owner pool.
 */
export type Queryable = Pick<Pool, "query">;

const connectionString = resolveRuntimeDatabaseUrl();

if (!connectionString) {
  throw new Error("DATABASE_URL or a compatible Postgres URL is required");
}

export const pool = new Pool({
  connectionString,
  // Detail editors load accounts and categories alongside telemetry and
  // background work. Keep enough connections for that normal overlap while
  // still bounding serverless connection use.
  max: 4,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 10_000,
  query_timeout: 10_000,
  statement_timeout: 10_000,
});

export async function withTransactionOnPool<T>(
  activePool: Pool,
  fn: (client: PoolClient) => Promise<T>,
) {
  const client = await activePool.connect();

  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
  return withTransactionOnPool(pool, fn);
}

// Owner-scoped transaction. Sets the owner for RLS policies and, when the
// caller opts in (or BRAINIA_DB_ENFORCE_RLS=true), switches to the restricted
// runtime role. The owner setting is transaction-local so pooled connections
// cannot leak one owner's context into the next request.
export async function withOwnerTransaction<T>(
  ownerId: string,
  fn: (client: PoolClient) => Promise<T>,
  options: { enforceRls?: boolean } = {},
) {
  if (!ownerId.trim()) throw new Error("owner_scope_required");
  const enforceRls = options.enforceRls ?? process.env.BRAINIA_DB_ENFORCE_RLS === "true";
  return withTransaction(async (client) => {
    await client.query("select set_config('brainia.owner_id', $1, true)", [ownerId]);
    if (enforceRls) await client.query("set local role brainia_runtime");
    return fn(client);
  });
}

/**
 * Runs an owner-facing repository read on an owner-scoped transaction.
 *
 * - A resolved owner always gets `withOwnerTransaction`, so every query sees
 *   the transaction-local owner setting and, when `BRAINIA_DB_ENFORCE_RLS`
 *   (or an explicit override) is on, the restricted runtime role.
 * - The legacy local/test mode has no owner (`undefined`). It deliberately
 *   falls back to the plain pool so existing fixtures that run as the table
 *   owner keep their bypass.
 */
export async function withOwnerRead<T>(
  ownerId: string | undefined,
  fn: (db: Queryable) => Promise<T>,
  options: { enforceRls?: boolean } = {},
): Promise<T> {
  if (!ownerId) return fn(pool);
  return withOwnerTransaction(ownerId, fn, options);
}

/**
 * Serializes the graph read/model/write cycle across backend instances.
 */
export async function withSemanticMaterializationLock<T>(fn: () => Promise<T>) {
  const client = await pool.connect();
  const lockName = "brainia:semantic-materialization";
  try {
    await client.query("select pg_advisory_lock(hashtextextended($1, 0))", [lockName]);
    return await fn();
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [lockName]);
    } finally {
      client.release();
    }
  }
}
