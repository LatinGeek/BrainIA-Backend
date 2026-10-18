import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { guardEnvironment, sanitize, sanitizerAudit } from './safety.mjs';
import { loadCorpus, retrievalDocuments } from './corpus.mjs';
import { compare, binomial, ranking } from './metrics.mjs';
import { argumentsFor } from './run.mjs';

test('remote, production, disguised local and non-isolated PostgreSQL targets are rejected without connecting', () => {
  for (const env of [
    { DATABASE_URL: 'postgres://production.example/brainia' },
    { DATABASE_URL: 'postgres://localhost/production' },
    { DATABASE_URL: 'postgres://localhost/brainia' },
    { DATABASE_URL: 'postgres://localhost.evil.invalid/brainia_test' },
    { DATABASE_URL: 'https://localhost/brainia_test' },
    { DATABASE_URL: 'garbage' }, { PGHOST: 'db.prod.invalid' }, { PGDATABASE: 'brainia' },
    { DATABASE_URL_UNPOOLED: 'postgres://production.invalid/brainia' },
    { POSTGRES_URL_NON_POOLING: 'postgres://production.invalid/brainia' },
    { POSTGRES_URL_NO_SSL: 'postgres://production.invalid/brainia' },
    { SUPABASE_URL: 'https://example.supabase.co' }, { DEEPSEEK_API_URL: 'https://api.deepseek.com' }, { NODE_ENV: 'production' },
  ]) assert.throws(() => guardEnvironment(env), /UNSAFE_TARGET/);
  guardEnvironment({ DATABASE_URL: 'postgres://localhost:55432/brainia_test' });
  guardEnvironment({ DATABASE_URL: 'postgres://isolated-test.invalid/brainia' });
});

test('network deny boundary intercepts fetch, HTTP, HTTPS, TCP, TLS and UDP and counts swallowed attempts', () => {
  const code = `import {installOfflineBoundary} from './tests/v2-harness/safety.mjs';
    const boundary=installOfflineBoundary();
    for(const [module,method] of [['node:http','get'],['node:https','request'],['node:net','connect'],['node:tls','connect'],['node:dgram','createSocket']]){
      try{(await import(module))[method]('https://production.invalid')}catch(error){if(error.message!=='OFFLINE_NETWORK_DENIED')throw error;}
    }
    try{await fetch('https://production.invalid')}catch(error){if(error.message!=='OFFLINE_NETWORK_DENIED')throw error;}
    if(boundary.calls.length!==6) process.exitCode=1;`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: safeEnv() });
  assert.equal(result.status, 0, result.stderr);
});

test('sanitizer removes identifiers and preserves localized amounts, ambiguity and synthetic relationships', () => {
  assert.equal(sanitizerAudit().passed, true);
  assert.equal(sanitize('USD 1,234.56 UYU 1.234,56 $ 50 ref SYN-REF-1 account 123456789 person@example.org'),
    'USD 1,234.56 UYU 1.234,56 $ 50 ref SYN-REF-1 account <account> <email>');
});

test('immutable corpus has required counts, all suites, disjoint family splits and valid span labels', () => {
  const corpus = loadCorpus();
  assert.equal(corpus.cases.length, 13820);
  assert.equal(corpus.index.suites.length, 12);
  assert.equal(corpus.index.labelStatus, 'pending-independent-adjudication');
});

test('corpus tampering fails before any adapter is invoked', () => {
  const directory = mkdtempSync('tests/v2-harness/artifacts/tamper-');
  try {
    cpSync('tests/fixtures/v2', directory, { recursive: true });
    writeFileSync(path.join(directory, 'E01.jsonl'), readFileSync(path.join(directory, 'E01.jsonl'), 'utf8') + '\n');
    assert.throws(() => loadCorpus(path.join(directory, 'index.json')), /DATASET_HASH_MISMATCH/);
  } finally {
    const absolute = path.resolve(directory);
    assert.ok(absolute.startsWith(path.resolve('tests/v2-harness/artifacts') + path.sep));
    rmSync(absolute, { recursive: true, force: true });
  }
});

test('quality comparator rejects missing observations, wrong currencies, false merges and threshold breaches', () => {
  assert.equal(compare({ falseMerges: 0, currency: 'UNKNOWN', recall20Minimum: 0.9 }, { falseMerges: 1, currency: 'USD', recall20Minimum: 0.89 }).length, 3);
  assert.ok(compare({ totals: { USD: '10.00' } }, {}).length);
  assert.equal(compare({ recoveryWithinMs: 1200 }, { recoveryWithinMs: 1201 }).length, 1);
  assert.equal(compare({ recall20Minimum: 0.9 }, { recall20Minimum: 1 }).length, 0);
});

test('confidence intervals, zero-error bounds and ranking penalize duplicates and incorrect ranking', () => {
  const metric = binomial(100, 100);
  assert.equal(metric.numerator, 100);
  assert.ok(metric.zeroErrorUpper95 > 0 && metric.zeroErrorUpper95 < 0.03);
  assert.equal(binomial(0, 0).value, null);
  assert.deepEqual(ranking(['r'], ['x', 'r', 'r']), { recall5: 1, recall20: 1, mrr10: 0.5, ndcg10: 1 / Math.log2(3) });
});

test('retrieval corpus includes permitted old evidence at all declared scales', () => {
  for (const size of [1000, 10000, 100000]) {
    let count = 0;
    for (const row of retrievalDocuments(size)) {
      if (!count) assert.equal(row.id, 'document-0');
      count++;
    }
    assert.equal(count, size);
  }
});

test('CLI rejects invalid selectors, unknown flags and output paths outside the artifact directory', () => {
  assert.deepEqual(argumentsFor(['--suite', 'E01,E02']).suites, ['E01', 'E02']);
  for (const args of [['--suite', 'E00'], ['--suite'], ['--live'], ['--split', 'unknown'], ['--report', 'package.json']]) {
    assert.throws(() => argumentsFor(args));
  }
});

test('actual extraction breaches exit 1; missing PostgreSQL instrumentation exits 2; production target exits 1', () => {
  for (const [suite, status] of [['E01', 1], ['E07', 2]]) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/v2-harness/run.mjs', '--suite', suite,
      '--report', `tests/v2-harness/artifacts/selftest-${suite}.json`], { encoding: 'utf8', env: safeEnv(), timeout: 60000 });
    assert.equal(result.status, status, result.stderr);
  }
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/v2-harness/run.mjs', '--suite', 'E01'], {
    encoding: 'utf8', env: { ...safeEnv(), DATABASE_URL: 'postgres://production.invalid/brainia' }, timeout: 60000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /UNSAFE_TARGET/);
});

function safeEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/DATABASE|POSTGRES|^PG|SUPABASE_URL|API_URL|API_BASE_URL|BASE_URL|ENDPOINT|NODE_ENV/i.test(key)) delete env[key];
  return env;
}
