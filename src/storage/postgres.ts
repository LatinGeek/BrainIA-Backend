import { Pool, type PoolClient } from "pg";
import { resolveRuntimeDatabaseUrl } from "./database-url.js";

const connectionString = resolveRuntimeDatabaseUrl();

if (!connectionString) {
  throw new Error("DATABASE_URL or a compatible Postgres URL is required");
}

export const pool = new Pool({
  connectionString,
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
