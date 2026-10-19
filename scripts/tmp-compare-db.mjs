import { readFileSync } from 'node:fs';
const map = {};
for (const line of readFileSync('.env.production.local','utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/); if (m) map[m[1]] = m[2].trim().replace(/^"|"$/g,'');
}
for (const key of ['DATABASE_URL','DATABASE_URL_UNPOOLED','POSTGRES_URL','POSTGRES_URL_NON_POOLING','POSTGRES_URL_NO_SSL','PGHOST','PGHOST_UNPOOLED']) {
  const v = map[key]; if (!v || v === '[SENSITIVE]') { console.log(key, 'MISSING_OR_SENSITIVE'); continue; }
  try { const u = new URL(v); console.log(key, 'host='+u.hostname, 'db='+u.pathname.slice(1)); }
  catch { console.log(key, 'NOT_A_URL len='+v.length); }
}
