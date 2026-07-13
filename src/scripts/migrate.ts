import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, withTransaction } from "../storage/postgres.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../migrations");

async function ensureMigrationTable() {
  await pool.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
  `);
}

async function getAppliedVersions() {
  const result = await pool.query<{ version: string }>(
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
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query("insert into schema_migrations (version) values ($1)", [file]);
    });
    console.log(`Applied migration ${file}`);
  }

  await pool.end();
}

await run();
