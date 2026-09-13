import { Pool, type PoolClient } from "pg";
import { resolveRuntimeDatabaseUrl } from "./database-url.js";

const connectionString = resolveRuntimeDatabaseUrl();

if (!connectionString) {
  throw new Error("DATABASE_URL or a compatible Postgres URL is required");
}

export const pool = new Pool({
  connectionString,
  // Serverless instances can scale during notification bursts. Keeping one
  // reusable connection per instance prevents a burst from exhausting the
  // database connection limit, while bounded waits turn saturation into an
  // observable error rather than an invocation timeout.
  max: 1,
  connectionTimeoutMillis: 5_000,
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
