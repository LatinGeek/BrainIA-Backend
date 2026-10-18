import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installOfflineBoundary } from './safety.mjs';
import { loadCorpus, sha256, retrievalDocuments } from './corpus.mjs';
import { compare, binomial, ranking, extractionMetrics } from './metrics.mjs';
import { environment } from './baseline.mjs';

const validSuites = Array.from({ length: 12 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`);
export function argumentsFor(args) {
  const result = { suites: validSuites, split: 'all', dataset: 'tests/fixtures/v2/index.json', adapter: 'tests/v2-harness/current-adapter.mjs', report: 'tests/v2-harness/artifacts/latest.json' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--offline') continue;
    if (!['--suite', '--split', '--dataset', '--adapter', '--report'].includes(arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`INVALID_ARGUMENT: ${arg}`);
    const value = args[++i];
    if (arg === '--suite') result.suites = value === 'all' ? validSuites : [...new Set(value.split(','))];
    else result[arg.slice(2)] = value;
  }
  if (!result.suites.length || result.suites.some(suite => !validSuites.includes(suite))) throw new Error('INVALID_SUITE');
  if (!['all', 'train', 'calibration', 'held-out'].includes(result.split)) throw new Error('INVALID_SPLIT');
  const report = path.resolve(result.report);
  const allowed = realpathSync('tests/v2-harness/artifacts');
  // Restrict evidence writes; cannot overwrite source/fixtures via --report.
  if (path.dirname(report) !== allowed || !report.endsWith('.json')) throw new Error('UNSAFE_REPORT_PATH');
  result.report = report;
  return result;
}

function sliceResults(rows, dimension) {
  return Object.fromEntries([...new Set(rows.map(row => row[dimension]))].sort().map(value => {
    const slice = rows.filter(row => row[dimension] === value);
    return [value, { cases: slice.length, passed: slice.filter(row => row.status === 'PASS').length,
      failed: slice.filter(row => row.status === 'FAIL').length, blocked: slice.filter(row => row.status === 'BLOCKED').length,
      exactCaseAccuracy: binomial(slice.filter(row => row.status === 'PASS').length, slice.filter(row => row.status !== 'BLOCKED').length) }];
  }));
}

export async function run(options) {
  const boundary = installOfflineBoundary();
  const corpus = loadCorpus(options.dataset);
  const adapterPath = realpathSync(options.adapter);
  if (!adapterPath.startsWith(realpathSync('tests/v2-harness') + path.sep)) throw new Error('UNSAFE_ADAPTER_PATH');
  const adapter = await import(pathToFileURL(adapterPath));
  if (typeof adapter.evaluate !== 'function' || !adapter.revision) throw new Error('INVALID_ADAPTER');
  const selected = corpus.cases.filter(row => options.suites.includes(row.suite) && (options.split === 'all' || row.split === options.split));
  const results = [];
  const suiteResults = [];
  for (const suite of options.suites) {
    const info = corpus.index.suites.find(item => item.id === suite);
    const rows = selected.filter(row => row.suite === suite);
    const suiteCases = [];
    const extractionRows = [];
    const durations = [];
    for (const row of rows) {
      const started = performance.now();
      let actual;
      let errors = [];
      try {
        // Adapters receive inputs only. Expected answers and labels never enter the provider boundary.
        actual = await adapter.evaluate(structuredClone({ id: row.id, suite: row.suite, scenario: row.scenario, input: row.input }),
          { provider: boundary.provider, retrievalDocuments });
        if (!actual || typeof actual !== 'object') throw new Error('Adapter returned no observation');
        if (!actual.blocked && suite === 'E08') {
          const { relevantIds, ...expected } = row.expected;
          const measured = ranking(relevantIds, actual.retrievedIds ?? []);
          const exact = ranking(relevantIds, actual.exactRetrievedIds ?? []);
          actual = { ...actual, measuredRanking: measured, recall20Minimum: measured.recall20,
            annExactRatioMinimum: exact.recall20 ? measured.recall20 / exact.recall20 : null,
            rankingRegressionMaximum: Number.isFinite(actual.baselineMrr10) && Number.isFinite(actual.baselineNdcg10)
              ? Math.max(0, actual.baselineMrr10 - measured.mrr10, actual.baselineNdcg10 - measured.ndcg10) : null };
          errors = compare(expected, actual);
        } else if (!actual.blocked) errors = compare(row.expected, actual);
      } catch (error) { errors = [{ field: 'adapter', expected: 'observation', observed: String(error.message) }]; }
      durations.push(performance.now() - started);
      if (suite === 'E01') extractionRows.push({ expected: row.expected, observed: actual });
      const entry = { id: row.id, suite, split: row.split, source: row.source, language: row.language,
        status: actual?.blocked ? 'BLOCKED' : errors.length ? 'FAIL' : 'PASS',
        ...(actual?.blocked ? { reason: actual.blocked } : {}), errors,
        ...(['E01', 'E08'].includes(suite) ? { observed: actual } : {}) };
      suiteCases.push(entry); results.push(entry);
    }
    const passed = suiteCases.filter(row => row.status === 'PASS').length;
    const failed = suiteCases.filter(row => row.status === 'FAIL').length;
    const blocked = suiteCases.filter(row => row.status === 'BLOCKED').length;
    const blockers = [];
    if (!rows.length) blockers.push('No fixtures selected');
    if (rows.some(row => row.labels.status !== 'adjudicated')) blockers.push('Synthetic labels await independent adjudication; no human-label claim');
    const independent = ['E02', 'E03', 'E04', 'E09', 'E12'].includes(suite);
    if (independent && rows.some(row => new Set(row.labels.labelers).size < 2 || !row.labels.adjudicator || row.labels.labelers.includes(row.labels.adjudicator))) blockers.push('Two independent labelers and separate adjudicator required');
    if (suite === 'E08' && rows.some(row => !row.labels.labelers.length)) blockers.push('Human-labelled query relevance unavailable');
    if (info.instrumentation !== 'offline-adapter') blockers.push(`${info.instrumentation}: offline execution cannot certify this suite`);
    if (blocked) blockers.push(`${blocked} cases lack application observations`);
    const status = failed ? 'FAIL' : blockers.length ? 'BLOCKED' : 'PASS';
    suiteResults.push({ suite, status, cases: rows.length, passed, failed, blocked, blockers,
      exactCaseAccuracy: binomial(passed, passed + failed),
      ...(suite === 'E01' ? { extractionMetrics: extractionMetrics(extractionRows),
        extractionBySplit: Object.fromEntries(['train', 'calibration', 'held-out'].map(split => [split,
          extractionMetrics(extractionRows.filter((_, i) => rows[i].split === split))])) } : {}),
      adapterObservationLatencyMs: { p95: durations.sort((a, b) => a - b)[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] ?? null, productStageLatency: 'not instrumented' },
      slices: { language: sliceResults(suiteCases, 'language'), source: sliceResults(suiteCases, 'source'), split: sliceResults(suiteCases, 'split') } });
    console.log(`${suite}: ${status}; ${passed} pass / ${failed} fail / ${blocked} blocked of ${rows.length}`);
  }
  const status = suiteResults.some(suite => suite.status === 'FAIL') ? 'FAIL' : suiteResults.some(suite => suite.status === 'BLOCKED') ? 'BLOCKED' : 'PASS';
  const report = { formatVersion: 1, generatedAt: new Date().toISOString(), status, offline: true,
    datasetVersion: corpus.index.datasetVersion, datasetSha256: corpus.indexHash, fixtureHashes: corpus.index.suites.map(({ id, sha256 }) => ({ id, sha256 })),
    seed: corpus.index.seed, split: options.split, selectedSuites: options.suites,
    adapter: { path: path.relative(process.cwd(), adapterPath), revision: adapter.revision, sha256: sha256(readFileSync(adapterPath)) },
    environment: environment(), corpusSize: corpus.cases.length, selectedCases: selected.length, tenants: 2, devicesPerTenant: 2,
    sanitizerAudit: corpus.audit, network: { externalCalls: 0, blockedAttempts: boundary.calls.filter(call => call.denied).length, stubCalls: boundary.calls.filter(call => !call.denied).length },
    costs: { externalProviderCharges: 0, currency: 'USD', reason: 'offline network denied; no external calls', productionEstimate: null, reductionAgainstLiveBaseline: null },
    qualityGates: { Q1: ['E02', 'E03', 'E05'], Q2: ['E06'], Q3: ['E06', 'E12'], Q4: ['E01', 'E03'], Q5: ['E07'], Q6: ['E02', 'E10'], Q7: ['E03', 'E04'], Q8: ['E05'], Q9: ['E06', 'E08', 'E12'], Q10: ['E11'] },
    limitations: ['Offline fixtures are not PostgreSQL role/RLS/locking/crash evidence.', 'E10 is simulated transport only; native reports and receipt hashes remain required.', 'Synthetic labels are not two independently adjudicated human labels.', 'Q10 additionally requires explicit human approval and backup/restore proof before any destructive operation.'],
    suites: suiteResults, results };
  // Denied transmission attempts always breach the harness gate, even if swallowed by an adapter.
  if (report.network.blockedAttempts) { report.status = 'FAIL'; report.network.gate = 'Forbidden network attempt observed'; }
  writeFileSync(options.report, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`Evidence: ${path.relative(process.cwd(), options.report)}; ${report.status}`);
  return report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await run(argumentsFor(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
