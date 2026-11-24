// Performance on customer-sized datasets (tools/bigDataset.js): S ≈ 2k, M ≈ 10k, L ≈ 50k work items. Slow (minutes) –
// not part of `npm test`; run with `npm run perf` (all sizes) or `PERF_SIZES=S,M npm run perf`.
// Prints the p50 / p95 / heap table (copy it into tests/perf/BASELINE.md) and writes tests/perf/last-run.json.
// Guards: every Lotse story is valid, and no operation got slower than 3× its recorded baseline (tests/perf/baseline.json)
// – a regression guard, not the budget (the budgets are the goal; BASELINE.md says how far away we are).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { perfSuite, perfTable } from './harness.js';

const SIZES = (process.env.PERF_SIZES || 'S,M,L').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const BASE_FILE = new URL('./baseline.json', import.meta.url);
const baseline = existsSync(BASE_FILE) ? JSON.parse(readFileSync(BASE_FILE, 'utf8')) : {};
const results = [];

for (const size of SIZES) {
  test(`perf ${size}`, { timeout: 900_000 }, () => {
    const r = perfSuite(size, { log: (x) => console.log(x) });
    results.push(r);
    assert.deepEqual(r.invalid, [], 'every Lotse story on the big dataset is valid');
    for (const row of r.rows) {
      const b = baseline[size]?.[row.label];
      if (b != null) assert.ok(row.p50 <= b * 3 + 50, `${size} ${row.label}: p50 ${row.p50.toFixed(0)} ms vs baseline ${b} ms (more than 3× slower)`);
    }
  });
}

test('perf table', () => {
  const table = perfTable(results);
  console.log(`\n${table}\n`);
  for (const r of results) for (const row of r.rows) if (row.slowest) console.log(`[${r.size}] slowest warm questions: ${row.slowest.join(' · ')}`);
  writeFileSync(new URL('./last-run.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), node: process.version, results: results.map((r) => ({ size: r.size, info: r.info, rows: r.rows })) }, null, 1));
  if (process.env.PERF_WRITE_BASELINE) {
    const out = { ...baseline };
    for (const r of results) out[r.size] = Object.fromEntries(r.rows.map((x) => [x.label, Math.round(x.p50)]));
    writeFileSync(BASE_FILE, `${JSON.stringify(out, null, 1)}\n`);
  }
});
