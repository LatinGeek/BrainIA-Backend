import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { argumentsFor, score, validateCorpus, validateCriteria } from './compare.mjs';

const corpus = JSON.parse(readFileSync('tests/fixtures/interpretation-comparison/v1.json', 'utf8'));
const criteria = JSON.parse(readFileSync('tests/v2-harness/compare-configs/acceptance.json', 'utf8'));
function execute(candidate, report, extra = []) {
  // Preserve only system execution variables; never import operator credentials.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|HOME|USERPROFILE)$/i.test(key)));
  return spawnSync(process.execPath, ['--import', 'tsx', 'tests/v2-harness/compare.mjs', '--candidate',
    `tests/v2-harness/compare-configs/${candidate}.json`, '--report', `tests/v2-harness/artifacts/${report}.json`, ...extra], { encoding: 'utf8', env });
}

test('synthetic corpus covers required scenarios and preserves UTF-8 evidence', () => {
  validateCorpus(corpus);
  for (const scenario of ['expense', 'income', 'transfer', 'email', 'irrelevant', 'ambiguous', 'repeated', 'multi-source']) assert.ok(corpus.cases.some(row => row.scenario === scenario));
  assert.ok(corpus.cases[0].input.events[0].body.includes('realizó una transacción'));
  const duplicate = structuredClone(corpus); duplicate.cases.push(duplicate.cases[0]);
  assert.throws(() => validateCorpus(duplicate), /duplicate/);
  const incomplete = structuredClone(corpus); delete incomplete.cases[0].expected.observations[0].amount;
  assert.throws(() => validateCorpus(incomplete), /Incomplete oracle/);
});

test('criteria fail closed for missing, negative or out-of-range limits', () => {
  validateCriteria(criteria);
  assert.throws(() => validateCriteria({ ...criteria, maxRegressedFields: -1 }));
  assert.throws(() => validateCriteria({ ...criteria, minimumExactCaseAccuracy: 1.01 }));
  assert.throws(() => validateCriteria({ ...criteria, minimumFieldAccuracy: {} }));
  assert.throws(() => argumentsFor(['--live']));
  assert.throws(() => argumentsFor(['--report', 'package.json']));
});

test('missing observations and adapter errors cannot pass null expected fields', () => {
  const target = corpus.cases.find(row => row.id === 'irrelevant-weather').expected;
  assert.equal(score(target, null, 'failure').units.every(unit => !unit.correct), true);
  assert.equal(score(target, { observations: [], crossRelationships: [] }).exact, false);
  const extra = structuredClone(target); extra.observations.push({ ...extra.observations[0], id: 'unexpected' });
  assert.equal(score(target, extra).exact, false);
});

test('deliberate regression fails and reports the affected case, amount and configuration', () => {
  const result = execute('regression-demo', 'comparison-regression-verification');
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(readFileSync('tests/v2-harness/artifacts/comparison-regression-verification.json', 'utf8'));
  assert.deepEqual(report.regressedCases, ['expense-uyu']);
  assert.equal(report.regressedFields, 1);
  const row = report.results.find(row => row.id === 'expense-uyu');
  assert.equal(row.candidate.configuration.id, 'deliberate-amount-regression');
  assert.equal(row.candidate.configuration.sha256, report.configurations.candidate.sha256);
  assert.equal(row.regressions[0].key, 'expense-uyu.amount');
  assert.equal(row.regressions[0].expected, '1733.00');
  assert.equal(row.regressions[0].observed, '1.73');
  assert.equal(report.network.deniedAttempts, 0);
  assert.equal(report.network.providerCalls, 0);
});

test('same configuration has stable quality scores and no introduced regressions', () => {
  for (const report of ['comparison-repeat-a', 'comparison-repeat-b']) {
    const result = execute('candidate', report);
    assert.equal(result.status, 1, result.stderr); // Existing oracle failures remain visible.
  }
  const [a, b] = ['a', 'b'].map(suffix => JSON.parse(readFileSync(`tests/v2-harness/artifacts/comparison-repeat-${suffix}.json`, 'utf8')));
  assert.equal(a.regressedFields, 0);
  assert.deepEqual(a.results.map(row => row.candidate.score), b.results.map(row => row.candidate.score));
  assert.deepEqual(a.metrics.candidate.fields, b.metrics.candidate.fields);
  assert.equal(a.configurations.candidate.sha256, b.configurations.candidate.sha256);
});

test('offline synthetic replay executes the existing classification assistant prompt', () => {
  const result = execute('synthetic-replay', 'comparison-replay-verification');
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(readFileSync('tests/v2-harness/artifacts/comparison-replay-verification.json', 'utf8'));
  assert.ok(report.results.every(row => !row.candidate.score.error));
  assert.ok(report.results.every(row => row.candidate.promptHashes.every(prompt => prompt.version === 'classification-v3' && prompt.sha256.length === 64)));
  assert.ok(report.results.every(row => row.candidate.promptHashes.length));
  assert.equal(report.configurations.candidate.model, 'synthetic-notification-model-v1');
  assert.equal(report.network.providerCalls, 0);
});

test('configurable regression-only policy accepts unchanged quality and rejects an introduced fault', () => {
  const extra = ['--criteria', 'tests/v2-harness/compare-configs/regression-only.json'];
  const unchanged = execute('candidate', 'comparison-policy-pass', extra);
  assert.equal(unchanged.status, 0, unchanged.stderr);
  const fault = execute('regression-demo', 'comparison-policy-fail', extra);
  assert.equal(fault.status, 1, fault.stderr);
  const report = JSON.parse(readFileSync('tests/v2-harness/artifacts/comparison-policy-fail.json', 'utf8'));
  assert.deepEqual(report.breaches, ['Regressed fields 1 > 0']);
});
