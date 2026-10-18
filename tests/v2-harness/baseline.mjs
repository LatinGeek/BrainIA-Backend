import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import os from 'node:os';

const hash = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
export function fingerprint() {
  const paths = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean).sort();
  const files = paths.map(path => {
    try { return [path, hash(readFileSync(path))]; } catch { return [path, 'DELETED']; }
  });
  return { head: git(['rev-parse', 'HEAD']).trim(), branch: git(['branch', '--show-current']).trim(),
    status: git(['status', '--porcelain=v1']), sha256: hash(JSON.stringify(files)), files };
}
export function environment() {
  const migrations = readdirSync('migrations').filter(name => name.endsWith('.sql')).sort()
    .map(name => [name, hash(readFileSync(`migrations/${name}`))]);
  return { node: process.version, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ramBytes: os.totalmem(),
    flags: Object.keys(process.env).filter(key => /^(BRAINIA_|.*API_KEY$|DATABASE_URL$)/.test(key)).sort()
      .map(key => ({ name: key, value: '<redacted>' })),
    migrationsSha256: hash(JSON.stringify(migrations)), installedDatabaseSchema: 'UNAVAILABLE: offline, no database connected',
    deploymentSha256: null, apkSha256: null, provider: 'offline stub; no external provider',
    providerRevision: 'v2-stub-1', modelRevision: null, jobPollFrequency: 'not measured; no worker started' };
}
if (process.argv.includes('--capture')) {
  writeFileSync(new URL('./artifacts/before-checkout.json', import.meta.url),
    JSON.stringify({ capturedAt: new Date().toISOString(), checkout: fingerprint(), environment: environment() }, null, 2) + '\n');
}
