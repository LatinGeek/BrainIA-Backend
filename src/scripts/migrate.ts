import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { resolveMigrationDatabaseUrl } from "../storage/database-url.js";
import { withTransactionOnPool } from "../storage/postgres.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../migrations");

const migrationConnectionString = resolveMigrationDatabaseUrl();

if (!migrationConnectionString) {
  throw new Error("DATABASE_URL_UNPOOLED or a compatible direct Postgres URL is required for migrations");
}

const migrationPool = new Pool({
  connectionString: migrationConnectionString,
});

async function ensureMigrationTable() {
  await migrationPool.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}

async function getAppliedVersions() {
  const result = await migrationPool.query<{ version: string }>(
    "select version from schema_migrations order by version asc",
  );
  return new Set(result.rows.map((row: { version: string }) => row.version));
}

async function run() {
  await ensureMigrationTable();
  const applied = await getAppliedVersions();

  const migrationFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    if (applied.has(file)) continue;

    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await withTransactionOnPool(migrationPool, async (client) => {
      await client.query(sql);
      await client.query("insert into schema_migrations (version) values ($1)", [file]);
    });
    console.log(`Applied migration ${file}`);
  }

  await migrationPool.end();
}

await run();
