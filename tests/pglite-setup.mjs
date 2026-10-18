// Isolated PostgreSQL engine for integration tests. Never connects to configured/live DBs.
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readdir,readFile } from 'node:fs/promises';
process.env.DATABASE_URL='postgres://isolated-test.invalid/brainia';
process.env.DEEPSEEK_API_KEY='';
process.env.TYPESAFE_API_KEY='';
process.env.BRAINIA_JEV_MODE='off';
process.env.BRAINIA_INTELLIGENCE_ENABLED='false';
const database=new PGlite();
await database.exec(`create role anon; create role authenticated;
create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin end $$;`);
for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){
  await database.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
}
async function query(text,values){
  const sql=typeof text==='string'?text:text.text;
  const params=values ?? (typeof text==='object'?text.values:undefined);
  const result=await database.query(sql,params);
  return {...result,rowCount:result.affectedRows || result.rows.length};
}
pg.Pool.prototype.query=query;
pg.Pool.prototype.connect=async function(){return {query,release(){}};};
pg.Pool.prototype.end=async function(){};

