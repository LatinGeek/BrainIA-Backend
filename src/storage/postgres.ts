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
