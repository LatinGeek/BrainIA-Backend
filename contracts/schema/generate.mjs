// Review the generated diff; never regenerate the expected manifest from a live DB.
import { readFile, writeFile } from 'node:fs/promises';
import { isolated } from './isolated.mjs';
if (!process.argv.includes('--write')) throw new Error('Explicit --write required to update the reviewed contract');
const { engine, db, migrations } = await isolated();
try {
  const rows = await db.query(await readFile(new URL('./catalog.sql', import.meta.url), 'utf8'));
  const objects = Object.fromEntries(rows.rows.map(row => [row.key, row.definition]));
  await writeFile(new URL('./manifest.json', import.meta.url), JSON.stringify({ format: 1, engine: 'PGlite 0.5.8 PostgreSQL catalog; real PostgreSQL validation pending', migrations, objects }, null, 2) + '\n', 'utf8');
  console.log(`Contract: ${Object.keys(migrations).length} migrations, ${Object.keys(objects).length} objects`);
} finally { await engine.close(); }
