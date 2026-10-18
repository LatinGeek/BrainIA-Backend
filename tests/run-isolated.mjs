import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files=readdirSync('tests').filter(file=>file.endsWith('.test.ts')).map(file=>`tests/${file}`);
const result=spawnSync(process.execPath,['--import','./tests/pglite-setup.mjs','--import','tsx','--test','--test-concurrency=1',...files],{stdio:'inherit',env:process.env});
process.exitCode=result.status ?? 1;
