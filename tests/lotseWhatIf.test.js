// What-if (live finding 2026-11-12): numbers on one card must never contradict each other – a project's missing hours
// can't exceed "missing hours" of all projects, and re-ranking moves the shortfall between projects without changing it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotseDataset } from './lotseFixture.js';
import { computeAll } from '../shared/engine.js';
import { run } from '../shared/lotse/index.js';

test('what-if by rank: totals ≥ every project row, total unchanged, the moved project closes its gap, the trade-off is said', () => {
  const ds = lotseDataset();
  const c = computeAll(ds);
  for (const it of c.model.items.slice(2)) {
    const s = run('whatIf', { change: { kind: 'rank', ref: it.ref, toRank: 1 } }, { ds, computed: c, lang: 'de', roles: { admin: true } });
    const rows = s.visual.data.rows;
    const total = rows.find((r) => /^Fehlende Stunden/.test(r.label));
    const projects = rows.filter((r) => /: fehlt /.test(r.label));
    for (const p of projects) { assert.ok(p.a <= total.a + 0.1 && p.b <= total.b + 0.1, `${p.label}: ${p.a}/${p.b} vs total ${total.a}/${total.b}`); }
    assert.ok(Math.abs(total.a - total.b) <= 0.1, 'a different rank creates no capacity');
    const own = projects.find((p) => p.label.startsWith(it.name.slice(0, 40)));
    if (own && own.a > 0) assert.ok(own.b <= own.a, `${it.name} at rank 1 is not worse off`);
    if (total.a > 0.05) assert.ok(s.findings.some((f) => /schafft keine Kapazität/.test(f.text)), 'the trade-off is explained');
  }
});
