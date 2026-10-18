import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "pg";
import { resolveMigrationDatabaseUrl } from "../storage/database-url.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = path.join(root, "migrations");
const contractDir = path.join(root, "contracts/schema");
export const checksum = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
type Database = Pick<PoolClient, "query">;
type Contract = { migrations: Record<string, string>; objects: Record<string, unknown> };
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

export async function schemaContract() {
  const contract = JSON.parse(await readFile(path.join(contractDir, "manifest.json"), "utf8")) as Contract;
  const files = (await readdir(migrationsDir)).filter(file => file.endsWith(".sql")).sort();
  const problems: string[] = [];
  for (const file of files) {
    if (contract.migrations[file] !== checksum(await readFile(path.join(migrationsDir, file), "utf8"))) problems.push(`source checksum: ${file}`);
  }
  for (const file of Object.keys(contract.migrations)) if (!files.includes(file)) problems.push(`missing migration source: ${file}`);
  if (problems.length) throw new Error(problems.join("\n"));
  return contract;
}

export async function reconcileObjects(db: Database, contract: Contract) {
  const rows = await db.query<{ key: string; definition: unknown }>(await readFile(path.join(contractDir, "catalog.sql"), "utf8"));
  const actual = Object.fromEntries(rows.rows.map(row => [row.key, row.definition]));
  const problems: string[] = [];
  for (const [key, expected] of Object.entries(contract.objects)) {
    if (!(key in actual)) problems.push(`missing object: ${key}`);
    else if (canonical(expected) !== canonical(actual[key])) problems.push(`object drift: ${key}`);
  }
  for (const key of Object.keys(actual)) if (!(key in contract.objects)) problems.push(`unexpected object: ${key}`);
  return problems;
}

export async function verifySchema(db: Database) {
  const contract = await schemaContract();
  const problems = await reconcileObjects(db, contract);
  const exists = await db.query("select to_regclass('public.schema_migrations') as ledger");
  if (!exists.rows[0]?.ledger) return [...problems, "missing migration ledger"];
  const columns = await db.query("select 1 from information_schema.columns where table_schema='public' and table_name='schema_migrations' and column_name='checksum'");
  const ledger = await db.query<{ version: string; checksum: string | null }>(columns.rows.length
    ? "select version, checksum from public.schema_migrations" : "select version, null::text as checksum from public.schema_migrations");
  const applied = new Map(ledger.rows.map(row => [row.version, row.checksum]));
  for (const [file, hash] of Object.entries(contract.migrations)) {
    if (!applied.has(file)) problems.push(`unapplied migration: ${file}`);
    else if (applied.get(file) !== hash) problems.push(`ledger checksum missing or mismatched: ${file}`);
  }
  for (const file of applied.keys()) if (!(file in contract.migrations)) problems.push(`unknown ledger migration: ${file}`);
  const attemptsExist = await db.query("select to_regclass('public.schema_migration_attempts') as attempts");
  if (attemptsExist.rows[0]?.attempts) {
    const attempts = await db.query("select version, status from public.schema_migration_attempts where status <> 'succeeded'");
    for (const row of attempts.rows) problems.push(`unfinished nontransactional migration: ${row.version} (${row.status})`);
  }
  return problems;
}

export async function applyConcurrentIndex(db: Database, file: string, hash: string, sql: string) {
  const statement = sql.replace(/^--[^\n]*(?:\n|$)/gm, "").trim();
  const index = statement.match(/^create\s+(?:unique\s+)?index\s+concurrently\s+(\w+)\s+on\s+[\s\S]+;$/i);
  if (!sql.replace(/\r\n/g,"\n").startsWith("-- brainia:nontransactional-index\n") || !index || statement.slice(0, -1).includes(";")) throw new Error(`Unsupported nontransactional migration: ${file}`);
  await db.query("insert into public.schema_migration_attempts(version,checksum,status) values($1,$2,'running') on conflict(version) do update set status='running',error=null,updated_at=now()", [file, hash]);
  try {
    const prior = await db.query("select i.indisvalid, i.indisready from pg_index i where i.indexrelid=to_regclass($1)", [`public.${index[1]}`]);
    if (prior.rows.length) throw new Error(`Existing index ${index[1]} requires operator review (valid=${prior.rows[0].indisvalid}); no automatic DROP or IF NOT EXISTS`);
    await db.query(statement);
    const valid = await db.query("select i.indisvalid and i.indisready as valid from pg_index i where i.indexrelid=to_regclass($1)", [`public.${index[1]}`]);
    if (!valid.rows[0]?.valid) throw new Error(`Invalid/not-ready index ${index[1]}`);
    await db.query("begin");
    await db.query("insert into public.schema_migrations(version,checksum) values($1,$2)", [file, hash]);
    await db.query("update public.schema_migration_attempts set status='succeeded',updated_at=now() where version=$1", [file]);
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    await db.query("update public.schema_migration_attempts set status='failed',error=$2,updated_at=now() where version=$1", [file, String(error)]);
    throw error;
  }
}

export async function migrate(db: Database) {
  const contract = await schemaContract();
  // One dedicated session owns both this lock and all migration queries.
  await db.query("select pg_advisory_lock(942017, 9)");
  try {
    await db.query(`create table if not exists public.schema_migrations(version text primary key, applied_at timestamptz not null default now());
      alter table public.schema_migrations add column if not exists checksum text;
      create table if not exists public.schema_migration_attempts(version text primary key, checksum text not null, status text not null, error text, updated_at timestamptz not null default now());
      alter table public.schema_migration_attempts enable row level security;`);
    const applied = await db.query<{ version: string; checksum: string | null }>("select version, checksum from public.schema_migrations");
    for (const row of applied.rows) {
      if (!(row.version in contract.migrations) || (row.checksum && row.checksum !== contract.migrations[row.version])) throw new Error(`Ledger/source drift: ${row.version}`);
    }
    const versions = new Set(applied.rows.map(row => row.version));
    for (const [file, hash] of Object.entries(contract.migrations)) {
      if (versions.has(file)) continue;
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      if (/\bconcurrently\b/i.test(sql)) {
        await applyConcurrentIndex(db, file, hash, sql);
      } else {
        await db.query("begin");
        try {
          await db.query(sql);
          await db.query("insert into public.schema_migrations(version,checksum) values($1,$2)", [file, hash]);
          await db.query("commit");
        } catch (error) { await db.query("rollback"); throw error; }
      }
      console.log(`Applied migration ${file}`);
    }
    const problems = await reconcileObjects(db, contract);
    if (problems.length) throw new Error(problems.join("\n"));
    // Attest legacy filename-only rows only AFTER complete reconciliation.
    for (const [file, hash] of Object.entries(contract.migrations)) await db.query("update public.schema_migrations set checksum=$2 where version=$1 and checksum is null", [file, hash]);
  } finally { await db.query("select pg_advisory_unlock(942017, 9)"); }
}

async function main() {
  const verify = process.argv.includes("--verify");
  if (verify && !process.argv.includes("--read-only")) throw new Error("schema:verify requires --read-only");
  const connectionString = verify ? process.env.SCHEMA_VERIFY_DATABASE_URL : resolveMigrationDatabaseUrl();
  if (!connectionString) throw new Error(verify ? "SCHEMA_VERIFY_DATABASE_URL must explicitly identify a disposable local instance" : "A direct migration database URL is required");
  if (verify) {
    const url = new URL(connectionString);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/brainia_b09_") || !process.env.SCHEMA_VERIFY_INSTANCE_ID) throw new Error("Refusing schema:verify: disposable loopback target and instance marker required");
  }
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    const db = await pool.connect();
    try {
      if (verify) {
        await db.query("begin isolation level repeatable read read only");
        try {
          const marker = await db.query("select instance_id from public.brainia_disposable_instance");
          if (marker.rows.length !== 1 || marker.rows[0]?.instance_id !== process.env.SCHEMA_VERIFY_INSTANCE_ID) throw new Error("Disposable instance marker mismatch");
          const problems = await verifySchema(db);
          console.log(JSON.stringify({ ok: !problems.length, readOnly: true, problems }, null, 2));
          if (problems.length) process.exitCode = 1;
        } finally { await db.query("rollback"); }
      } else await migrate(db);
    } finally { db.release(); }
  } finally { await pool.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main().catch(error => { console.error(String(error)); process.exitCode = 1; });
}
