// Fast performance smoke (part of `npm test`): the S-size customer dataset (≈ 2k work items, tools/bigDataset.js) is
// deterministic, has the right shape, and the hot paths stay within generous ceilings (10× the budget – catches an
// accidental O(n²), not normal noise). The full S/M/L measurement: `npm run perf` (tests/perf/perf.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bigDataset, summarize, SIZES } from '../tools/bigDataset.js';
import { perfSuite, BUDGETS } from './perf/harness.js';

const hash = (x) => createHash('sha1').update(JSON.stringify(x)).digest('hex');

test('big dataset: deterministic and customer-shaped (S)', () => {
  const a = bigDataset('S'), b = bigDataset('S');
  assert.equal(hash(a), hash(b), 'same seed, same dataset');
  const s = summarize(a);
  assert.ok(Math.abs(s.workItems - SIZES.S.items) / SIZES.S.items < 0.05, `≈ 2k work items (${s.workItems})`);
  assert.equal(s.projects, SIZES.S.projects);
  assert.equal(s.teams, SIZES.S.teams);
  assert.equal(s.people, SIZES.S.people);
  assert.equal(s.tickets, SIZES.S.tickets);
  assert.ok(s.worklogs > s.stories && s.links > 0 && s.absences > 0 && s.openTickets > 0);
  for (const i of a.issues) assert.ok(i.id && i.key && i.rootRef && i.role && i.status?.cat, 'issue shape');
  assert.notEqual(hash(bigDataset('S', { seed: 9 })), hash(a), 'another seed, another dataset');
});

test('perf smoke S: hot paths within 10× budget, Lotse stories valid', { timeout: 120_000 }, () => {
  const r = perfSuite('S', { runs: 1, ops: ['buildBoard team', 'buildBoard all', 'realisticCapacity', 'lotse ask cold', 'lotse ask warm (20 q)', 'lotse briefing', 'lotse whatIf'] });
  assert.deepEqual(r.invalid, []);
  const lines = [];
  for (const row of r.rows) {
    lines.push(`${row.label} ${row.p50.toFixed(0)} ms`);
    const budget = BUDGETS[row.label]?.ms.S;
    if (budget) assert.ok(row.p50 <= budget * 10, `${row.label}: ${row.p50.toFixed(0)} ms > 10× budget ${budget} ms`);
  }
  console.log(`perf smoke S (${r.info.workItems} work items): ${lines.join(' · ')}`);
});
