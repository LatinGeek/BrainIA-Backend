import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { sanitizerAudit, sanitize } from './safety.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const minimums = { E01: 500, E02: 250, E03: 200, E04: 100, E05: 100, E06: 16, E07: 2000, E08: 200, E09: 100, E10: 10000, E11: 9, E12: 100 };
export function loadCorpus(dataset = 'tests/fixtures/v2/index.json') {
  const filename = realpathSync(dataset);
  const base = path.dirname(filename);
  const indexBytes = readFileSync(filename);
  const index = JSON.parse(indexBytes);
  const indexHash = sha256(indexBytes);
  if (readFileSync(path.join(base, 'index.sha256'), 'utf8').trim() !== indexHash) throw new Error('DATASET_HASH_MISMATCH: index');
  if (!index.datasetVersion || !Number.isInteger(index.seed) || !index.provenance || !index.licence || !index.consent || !index.sanitizerVersion) throw new Error('DATASET_METADATA_MISSING');
  if (index.suites.length !== 12 || new Set(index.suites.map(s => s.id)).size !== 12) throw new Error('DATASET_SUITE_COVERAGE');
  const cases = [];
  const ids = new Set();
  const familySplits = new Map();
  for (const suite of index.suites) {
    if (!Object.hasOwn(minimums, suite.id)) throw new Error('DATASET_UNKNOWN_SUITE');
    const file = realpathSync(path.resolve(base, suite.file));
    if (path.dirname(file) !== base) throw new Error('DATASET_PATH_ESCAPE');
    const bytes = readFileSync(file);
    if (sha256(bytes) !== suite.sha256) throw new Error(`DATASET_HASH_MISMATCH: ${suite.id}`);
    const rows = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    if (rows.length !== suite.count || rows.length < minimums[suite.id]) throw new Error(`DATASET_COUNT: ${suite.id}`);
    const splits = { train: 0, calibration: 0, 'held-out': 0 };
    for (const row of rows) {
      if (ids.has(row.id) || row.suite !== suite.id || !Object.hasOwn(splits, row.split) || !row.input || !row.expected || !row.labels || !row.language || !row.source) throw new Error(`DATASET_INVALID_CASE: ${row.id}`);
      ids.add(row.id); splits[row.split]++;
      for (const key of ['sourceTemplateFamily', 'merchantFamily', 'referenceFamily', 'purchaseFamily']) {
        if (!row[key]) throw new Error(`DATASET_FAMILY_MISSING: ${row.id}`);
        const family = `${key}:${row[key]}`;
        if (familySplits.has(family) && familySplits.get(family) !== row.split) throw new Error(`DATASET_SPLIT_LEAK: ${family}`);
        familySplits.set(family, row.split);
      }
      const inputText = JSON.stringify(row.input);
      if (sanitize(inputText) !== inputText) throw new Error(`SANITIZER_AUDIT_FAILED: ${row.id}`);
    }
    for (const [split, ratio] of [['train', 0.6], ['calibration', 0.2], ['held-out', 0.2]]) {
      if (splits[split] !== rows.length * ratio || suite.splits[split] !== splits[split]) throw new Error(`DATASET_SPLIT_RATIO: ${suite.id}`);
    }
    if (suite.scenarios.some(scenario => !rows.some(row => row.scenario === scenario))) throw new Error(`DATASET_SCENARIO_COVERAGE: ${suite.id}`);
    cases.push(...rows);
  }
  const extraction = cases.filter(row => row.suite === 'E01');
  for (const [scenario, count] of Object.entries({ 'multi-amount': 200, 'currency-ambiguous': 100, 'generic-title': 50, multilingual: 50, other: 100 })) {
    if (extraction.filter(row => row.scenario === scenario).length < count) throw new Error(`E01_COVERAGE: ${scenario}`);
  }
  for (const row of extraction) for (const value of row.expected.values) {
    if (row.input.body.slice(value.start, value.end) !== value.text || !value.role || !value.status || !value.currency) throw new Error(`E01_SPAN_LABEL: ${row.id}`);
  }
  const jobs = cases.filter(row => row.suite === 'E07');
  if (new Set(jobs.map(row => row.input.schedule)).size < 20 || jobs.some(row => row.input.workers < 2)) throw new Error('E07_SCHEDULE_COVERAGE');
  for (let schedule = 0; schedule < 20; schedule++) if (new Set(jobs.filter(row => row.input.schedule === schedule).map(row => row.input.repetition)).size < 100) throw new Error('E07_REPETITION_COVERAGE');
  const audit = sanitizerAudit();
  if (!audit.passed || !JSON.parse(readFileSync(path.join(base, 'sanitizer-audit.json'), 'utf8')).passed) throw new Error('SANITIZER_AUDIT_FAILED');
  return { index, indexHash, cases, audit };
}

// Stream a declared synthetic retrieval corpus without storing 100k documents in Git.
export function* retrievalDocuments(size) {
  if (![1000, 10000, 100000].includes(size)) throw new Error('Unsupported retrieval corpus size');
  for (let i = 0; i < size; i++) yield { id: `document-${i}`, owner: i % 2 ? 'SYN-OWNER-1' : 'SYN-OWNER-0',
    source: i === 0 ? 'receipt' : 'notification', text: i === 0 ? 'Historical purchase UYU 10.00' : `Synthetic unrelated item ${i}`,
    timestamp: new Date(Date.UTC(2020, 0, 1) + i * 60000).toISOString() };
}
