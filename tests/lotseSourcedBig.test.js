// Live E2E 2026-11-23 on 1,400 demo work items: with a lot of data Lotse's texts named numbers whose source had been cut
// (a story keeps 4 key figures, 4 findings, 8 sources per finding) – the year check's "48 Personen über 100 %", My week's
// overdue count, a project name with a number ("Identity 2.0"), a person in 6 teams. On the big dataset every number in
// these skills' texts must have its source, in German and English.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bigDataset } from '../tools/bigDataset.js';
import { computeAll } from '../shared/engine.js';
import * as L from '../shared/lotse/index.js';

test('big data: year check, My week, portfolio briefing and multi-team check – every number sourced (de + en)', { timeout: 300_000 }, () => {
  const ds = bigDataset('S');
  const computed = computeAll(ds);
  const me = { id: Object.keys(ds.capacity?.people || {})[0] || null, name: 'Probe' };
  for (const lang of ['de', 'en']) {
    const ctx = { ds, computed, lang, me, roles: { admin: true, editCapacity: true, logs: 'all' } };
    for (const sk of ['yearCheck', 'myWeek', 'portfolioBrief', 'splitCheck']) {
      const s = L.run(sk, {}, ctx);
      assert.ok(L.validStory(s), `${sk} ${lang}: valid`);
      assert.deepEqual(L.selfCheck(s), [], `${sk} ${lang}: every number sourced`);
    }
  }
});

// Live E2E 2026-11-25: when even rank 1 cannot be staffed, the briefing says «… from rank 1 (…)» – that rank is sourced too.
test('portfolio briefing and its why: «from rank N» is sourced, also when rank 1 is the first bottleneck (de + en)', { timeout: 300_000 }, () => {
  const ds = bigDataset('S');
  for (const p of Object.values(ds.capacity?.people || {})) p.weeklyHours = 1; // almost no capacity: rank 1 is short
  const computed = computeAll(ds);
  for (const lang of ['de', 'en']) {
    const ctx = { ds, computed, lang, me: { id: null, name: 'Probe' }, roles: { admin: true, editCapacity: true, logs: 'all' } };
    const s = L.run('portfolioBrief', {}, ctx);
    const text = JSON.stringify(s.findings || []);
    assert.ok(/(ab Rang|from rank) 1 /.test(text), `${lang}: rank 1 is the first bottleneck in this data`);
    assert.deepEqual(L.selfCheck(s), [], `${lang}: every number sourced`);
  }
});
