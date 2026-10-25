// No TCP, configured database URLs or credentials are used by this fixture.
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
const checksum = text => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
export async function isolated({ beforeRollForward = false } = {}) {
  const engine = new PGlite();
  await engine.exec(`create role anon; create role authenticated;
    create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin end $$;`);
  const files = (await readdir(new URL('../../migrations/', import.meta.url))).filter(f => f.endsWith('.sql')).sort();
  const migrations = {};
  let rollForwardPending = false;
  for (const file of files) {
    const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
    migrations[file] = checksum(sql);
    // "Before roll-forward" means the database predates this migration and
    // every later one, so migrate() applies the whole suffix in real order.
    if (beforeRollForward && file === '20261015000000_reconcile_runtime_schema.sql') rollForwardPending = true;
    if (rollForwardPending) continue;
    await engine.exec(sql);
    await engine.query('insert into schema_migrations(version) values($1)', [file]);
  }
  await engine.exec(`alter table schema_migrations add column checksum text;
    create table brainia_disposable_instance(instance_id text primary key);`);
  const id = randomUUID();
  await engine.query('insert into brainia_disposable_instance values($1)', [id]);
  for (const [file, hash] of Object.entries(migrations)) await engine.query('update schema_migrations set checksum=$2 where version=$1', [file, hash]);
  const db = { query: async (sql, args) => {
    // PGlite prepared execution permits one statement only.
    if (!args && sql.includes(';')) { const results = await engine.exec(sql); return results.at(-1) ?? { rows: [] }; }
    return engine.query(sql, args);
  }};
  return { engine, db, migrations, id };
}
