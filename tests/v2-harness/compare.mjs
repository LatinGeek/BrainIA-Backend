import { readFileSync, writeFileSync, realpathSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { installOfflineBoundary } from './safety.mjs';
import { binomial } from './metrics.mjs';

export const fields = ['eventType', 'amount', 'currency', 'merchant', 'category', 'relationships', 'reviewRequired'];
const root = fileURLToPath(new URL('../../', import.meta.url));
const harness = path.join(root, 'tests/v2-harness');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
const defaults = {
  dataset: 'tests/fixtures/interpretation-comparison/v1.json',
  baseline: 'tests/v2-harness/compare-configs/baseline.json',
  candidate: 'tests/v2-harness/compare-configs/candidate.json',
  criteria: 'tests/v2-harness/compare-configs/acceptance.json',
  report: 'tests/v2-harness/artifacts/interpretation-comparison.json',
};
export function argumentsFor(args) {
  const result = { ...defaults };
  for (let i = 0; i < args.length; i++) {
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || !Object.hasOwn(defaults, key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid argument: ${args[i]}`);
    result[key] = args[++i];
  }
  for (const key of Object.keys(result)) result[key] = path.resolve(root, result[key]);
  const artifacts = realpathSync(path.join(harness, 'artifacts'));
  if (path.dirname(result.report) !== artifacts || !result.report.endsWith('.json')) throw new Error('Report must be a JSON file directly in tests/v2-harness/artifacts');
  return result;
}

export function validateCorpus(corpus) {
  if (!corpus.version || corpus.provenance !== 'synthetic' || !corpus.cases?.length) throw new Error('Invalid synthetic corpus');
  const ids = new Set();
  for (const row of corpus.cases) {
    if (!row.id || ids.has(row.id) || !row.scenario || !row.rationale || !row.input?.events?.length) throw new Error('Invalid/duplicate case');
    ids.add(row.id);
    const eventIds = row.input.events.map(event => event.id);
    if (new Set(eventIds).size !== eventIds.length || row.expected?.observations?.length !== eventIds.length || !Array.isArray(row.expected.crossRelationships)) throw new Error(`Invalid expectations: ${row.id}`);
    for (const [index, event] of row.input.events.entries()) {
      const expected = row.expected.observations[index];
      if (!event.id || !event.source || !event.kind || !event.timestamp || !Number.isFinite(Date.parse(event.timestamp)) || expected.id !== event.id || fields.some(field => !Object.hasOwn(expected, field))) throw new Error(`Incomplete oracle: ${row.id}`);
      if (typeof expected.eventType !== 'string' || typeof expected.reviewRequired !== 'boolean' || !Array.isArray(expected.relationships) ||
          ['amount', 'currency', 'merchant', 'category'].some(field => expected[field] !== null && typeof expected[field] !== 'string')) throw new Error(`Invalid oracle types: ${row.id}`);
    }
  }
}

export function validateCriteria(criteria) {
  if (!Number.isInteger(criteria.maxRegressedFields) || criteria.maxRegressedFields < 0) throw new Error('Invalid regression allowance');
  for (const value of [criteria.minimumExactCaseAccuracy, ...fields.map(field => criteria.minimumFieldAccuracy?.[field])]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Accuracy criteria must be in [0,1] for every field');
  }
  if (criteria.maxCandidateP95Ms !== null && (!Number.isFinite(criteria.maxCandidateP95Ms) || criteria.maxCandidateP95Ms < 0)) throw new Error('Invalid latency criterion');
}

// Hash actual checkout bytes, including dirty/untracked source; a version label
// alone cannot distinguish two edited prompts or two rule implementations.
function sourceFingerprint() {
  const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : /\.(ts|mjs)$/.test(file) ? [[path.relative(root, file).replaceAll('\\', '/'), hash(readFileSync(file))]] : [];
  });
  const files = [...walk(path.join(root, 'src')), ...walk(harness), ...['package.json', 'package-lock.json'].map(file => [file, hash(readFileSync(path.join(root, file)))])].sort(([a], [b]) => a.localeCompare(b));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  return { sha256: hash(JSON.stringify(files)), files, head: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])) };
}

async function loadConfiguration(file, source) {
  const config = json(file);
  if (!config.id || !['rules', 'replay'].includes(config.mode)) throw new Error('Config requires id and mode rules/replay; live providers are not supported here');
  if (config.mode === 'replay' && (!config.model || !config.promptVersion || !config.responses || typeof config.responses !== 'object')) throw new Error('Replay requires model, promptVersion and responses');
  if (config.mode === 'rules' && (config.model !== null || config.promptVersion !== null)) throw new Error('Rules configuration must declare null model/promptVersion');
  const adapterPath = realpathSync(path.resolve(root, config.adapter));
  if (!adapterPath.startsWith(realpathSync(harness) + path.sep) || !adapterPath.endsWith('.mjs')) throw new Error('Adapters must be reviewed modules in tests/v2-harness');
  const adapter = await import(pathToFileURL(adapterPath));
  if (typeof adapter.evaluate !== 'function' || !adapter.revision) throw new Error('Invalid adapter');
  const recorded = { ...config, adapterSha256: hash(readFileSync(adapterPath)), adapterRevision: adapter.revision,
    classificationVersion: adapter.classificationVersion ?? null, sourceSha256: source.sha256,
    configFileSha256: hash(readFileSync(file)) };
  return { config, adapter, recorded: { ...recorded, sha256: hash(JSON.stringify(recorded)) } };
}

export function score(expected, actual, error = null) {
  const units = [];
  for (const target of expected.observations) {
    const observed = actual?.observations?.find(event => event.id === target.id);
    for (const field of fields) units.push({ key: `${target.id}.${field}`, field, expected: target[field], observed: observed?.[field] ?? null,
      correct: !error && Boolean(observed) && Object.hasOwn(observed, field) && isDeepStrictEqual(target[field], observed[field]) });
  }
  units.push({ key: 'crossRelationships', field: 'relationships', expected: expected.crossRelationships,
    observed: actual?.crossRelationships ?? null, correct: !error && isDeepStrictEqual(expected.crossRelationships, actual?.crossRelationships) });
  const unexpectedEvents = actual?.observations?.filter(event => !expected.observations.some(target => target.id === event.id)).map(event => event.id) ?? [];
  const duplicateEvents = actual?.observations && new Set(actual.observations.map(event => event.id)).size !== actual.observations.length;
  return { units, exact: !error && !unexpectedEvents.length && !duplicateEvents && units.every(unit => unit.correct),
    error, unexpectedEvents, duplicateEvents: Boolean(duplicateEvents), failures: units.filter(unit => !unit.correct) };
}

const percentile95 = values => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * .95) - 1] : null;
export function aggregate(rows, side) {
  const units = rows.flatMap(row => row[side].score.units);
  return { exactCaseAccuracy: binomial(rows.filter(row => row[side].score.exact).length, rows.length),
    fields: Object.fromEntries(fields.map(field => {
      const selected = units.filter(unit => unit.field === field);
      const nonNull = selected.filter(unit => unit.expected !== null && (!Array.isArray(unit.expected) || unit.expected.length));
      return [field, { accuracy: binomial(selected.filter(unit => unit.correct).length, selected.length),
        nonEmptyExpectedAccuracy: binomial(nonNull.filter(unit => unit.correct).length, nonNull.length) }];
    })),
    adapterLatencyMs: { samples: rows.map(row => row[side].latencyMs), p95: percentile95(rows.map(row => row[side].latencyMs)), scope: 'adapter invocation including lazy imports; not production latency' },
    usage: rows.map(row => ({ caseId: row.id, value: row[side].usage })),
    cost: rows.map(row => ({ caseId: row.id, value: row[side].cost })),
    costReason: 'Only adapter-reported measurements retained; no token prices or production estimates inferred' };
}

export async function run(options) {
  const boundary = installOfflineBoundary();
  const corpus = json(options.dataset);
  validateCorpus(corpus);
  const criteria = json(options.criteria);
  validateCriteria(criteria);
  const source = sourceFingerprint();
  const baseline = await loadConfiguration(options.baseline, source);
  const candidate = await loadConfiguration(options.candidate, source);
  const rows = [];
  for (const row of corpus.cases) {
    const result = { id: row.id, scenario: row.scenario, expected: row.expected };
    for (const [side, loaded] of [['baseline', baseline], ['candidate', candidate]]) {
      const start = performance.now();
      let actual = null;
      let error = null;
      try {
        // The oracle is never passed to application code, adapters or replay.
        actual = await loaded.adapter.evaluate(structuredClone(row.input), structuredClone(loaded.config));
        if (!Array.isArray(actual?.observations)) throw new Error('Adapter missing observations');
        const observedIds = actual.observations.map(observation => observation.id).sort();
        const expectedIds = row.input.events.map(event => event.id).sort();
        if (!isDeepStrictEqual(observedIds, expectedIds)) throw new Error('Adapter returned missing, duplicate or unexpected event observations');
        const versions = actual.prompts?.map(prompt => prompt.version) ?? [];
        if (loaded.config.mode === 'replay' && (!versions.length || versions.some(version => version !== loaded.config.promptVersion))) throw new Error('Configured promptVersion does not match executed prompt');
      } catch (failure) { error = String(failure.message); }
      result[side] = { configuration: { id: loaded.recorded.id, sha256: loaded.recorded.sha256 },
        latencyMs: performance.now() - start, usage: actual?.usage ?? null, cost: actual?.cost ?? null,
        promptHashes: actual?.prompts?.map(prompt => ({ version: prompt.version, sha256: hash(prompt.systemPrompt) })) ?? [],
        limitations: actual?.limitations ?? [], observed: actual?.observations ?? null,
        crossRelationships: actual?.crossRelationships ?? null, score: score(row.expected, actual, error) };
    }
    result.regressions = result.candidate.score.units.filter((unit, index) => !unit.correct && result.baseline.score.units[index].correct);
    result.improvements = result.candidate.score.units.filter((unit, index) => unit.correct && !result.baseline.score.units[index].correct);
    rows.push(result);
  }
  const metrics = { baseline: aggregate(rows, 'baseline'), candidate: aggregate(rows, 'candidate') };
  const regressedFields = rows.reduce((sum, row) => sum + row.regressions.length, 0);
  const breaches = [];
  if (regressedFields > criteria.maxRegressedFields) breaches.push(`Regressed fields ${regressedFields} > ${criteria.maxRegressedFields}`);
  if (metrics.candidate.exactCaseAccuracy.value < criteria.minimumExactCaseAccuracy) breaches.push('Candidate exact-case accuracy below minimum');
  for (const field of fields) if (metrics.candidate.fields[field].accuracy.value < criteria.minimumFieldAccuracy[field]) breaches.push(`Candidate ${field} accuracy below minimum`);
  if (criteria.maxCandidateP95Ms !== null && metrics.candidate.adapterLatencyMs.p95 > criteria.maxCandidateP95Ms) breaches.push('Candidate adapter p95 latency above maximum');
  if (rows.some(row => row.baseline.score.error || row.candidate.score.error)) breaches.push('Adapter execution error');
  if (boundary.calls.some(call => call.denied)) breaches.push('Forbidden network attempt');
  const report = { formatVersion: 1, mode: 'offline', status: breaches.length ? 'FAIL' : 'PASS',
    dataset: { version: corpus.version, sha256: hash(readFileSync(options.dataset)), provenance: corpus.provenance, labelStatus: corpus.labelStatus },
    runnerSha256: hash(readFileSync(fileURLToPath(import.meta.url))), node: process.version, source,
    configurations: { baseline: baseline.recorded, candidate: candidate.recorded }, criteria,
    criteriaSha256: hash(readFileSync(options.criteria)), breaches, regressedFields,
    regressedCases: rows.filter(row => row.regressions.length).map(row => row.id),
    network: { deniedAttempts: boundary.calls.filter(call => call.denied).length, providerCalls: 0 }, metrics, results: rows };
  writeFileSync(options.report, JSON.stringify(report, null, 2) + '\n', 'utf8');
  const markdown = [`# Interpretation configuration comparison`, '', `Status: ${report.status}. Dataset: ${corpus.version}.`,
    `Baseline: ${baseline.config.id} (${baseline.recorded.sha256}).`, `Candidate: ${candidate.config.id} (${candidate.recorded.sha256}).`, '',
    '| Field | Baseline correct/total | Candidate correct/total |', '| --- | --- | --- |',
    ...fields.map(field => { const b = metrics.baseline.fields[field].accuracy; const c = metrics.candidate.fields[field].accuracy; return `| ${field} | ${b.numerator}/${b.denominator} | ${c.numerator}/${c.denominator} |`; }), '',
    `Regressed fields: ${regressedFields}. Exact cases: baseline ${metrics.baseline.exactCaseAccuracy.numerator}/${rows.length}, candidate ${metrics.candidate.exactCaseAccuracy.numerator}/${rows.length}.`, '',
    ...breaches.map(breach => `- ${breach}`), '', '## Case failures and regressions', '',
    ...rows.filter(row => !row.candidate.score.exact).flatMap(row => [`### ${row.id} (${candidate.config.id})`, '',
      ...(row.candidate.score.error ? [`Error: ${row.candidate.score.error}`, ''] : []),
      ...row.candidate.score.failures.map(unit => `- ${row.regressions.some(regression => regression.key === unit.key) ? 'REGRESSION' : 'FAIL'} ${unit.key}: expected ${JSON.stringify(unit.expected)}; observed ${JSON.stringify(unit.observed)}`), '']),
    'Synthetic labels await independent review. This comparison does not certify production quality, consolidation, or app UI. Latency is measured locally and varies; usage/cost remain null when unavailable.', ''];
  writeFileSync(options.report.replace(/\.json$/, '.md'), markdown.join('\n'), 'utf8');
  console.log(`${report.status}: ${rows.length} cases; ${regressedFields} regressed fields; ${options.report}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = (await run(argumentsFor(process.argv.slice(2)))).status === 'PASS' ? 0 : 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
