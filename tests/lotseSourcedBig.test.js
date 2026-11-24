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
