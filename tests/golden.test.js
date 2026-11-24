import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAll } from '../shared/engine.js';
import { isoOf, dayIdx } from '../shared/dates.js';

// ---------- golden: engine vs. the independent spreadsheet recomputation (tests/golden/golden.xlsx) ----------
const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url)));
const expected = JSON.parse(readFileSync(new URL('./golden/expected.json', import.meta.url)));

test('golden dataset: engine equals the spreadsheet on every metric', () => {
  const c = computeAll(golden);
  const m1 = c.metrics.get('issue:p1'), m2 = c.metrics.get('issue:p2');
  const web = c.wl.cells.web['2026-Q4'], data = c.wl.cells.data['2027-Q1'];
  const actual = {
    'P1 Original Estimate': m1.OE, 'P1 Time Spent': m1.TS, 'P1 Remaining': m1.RE,
    'P1 open T-shirt Q4': m1.openByQ['2026-Q4'], 'P1 open T-shirt Q1': m1.openByQ['2027-Q1'],
    'P1 progress': m1.progress, 'P1 maturity': m1.maturity, 'P1 forecast': m1.forecast,
    'P1 Web demand Q4': m1.demand['2026-Q4'].web, 'P1 no-team demand Q4': m1.demand['2026-Q4']._none,
    'P2 Original Estimate': m2.OE, 'P2 open T-shirt Q4': m2.openByQ['2026-Q4'], 'P2 progress': m2.progress, 'P2 maturity': m2.maturity,
    'P2 Web demand Q4': m2.demand['2026-Q4'].web, 'P2 Data demand Q1': m2.demand['2027-Q1'].data,
    'Web Q4 capacity': web.capacity, 'Web Q4 cumulative after #2': web.rows[2].cum, 'Data Q1 capacity': data.capacity,
    'Web Q4 status #1': web.rows[1].status, 'Web Q4 status #2': web.rows[2].status, 'Data Q1 status #2': data.rows[1].status,
  };
  assert.equal(expected.length, Object.keys(actual).length);
  for (const e of expected) {
    const a = actual[e.metric];
    if (typeof e.spreadsheet === 'string') assert.equal(a, e.spreadsheet, e.metric);
    else assert.ok(Math.abs(a - Number(e.spreadsheet)) < 1e-6, `${e.metric}: engine ${a} vs spreadsheet ${e.spreadsheet}`);
  }
});

// ---------- property-based: invariants over random portfolios ----------
function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
function randomPortfolio(seed) {
  const r = rng(seed);
  const today = dayIdx('2026-11-02');
  const teams = ['a', 'b', 'c'].map((id) => ({ id, name: id.toUpperCase() }));
  const nP = 2 + Math.floor(r() * 5);
  const portfolio = [], issues = [];
  for (let p = 0; p < nP; p++) {
    const ref = `issue:p${p}`;
    portfolio.push({ ref, rank: p + 1, kind: 'issue', id: `p${p}`, key: `P-${p}`, name: `P${p}`, statusCat: 'indeterminate' });
    const qs = ['2026-Q3', '2026-Q4', '2027-Q1', '2027-Q2'].filter(() => r() > 0.4);
    issues.push({ id: `w${p}`, key: `W-${p}`, summary: '', role: 'rough', levelKey: 'ws', parentId: `p${p}`, rootRef: ref, status: { cat: 'indeterminate' }, team: r() > 0.2 ? teams[Math.floor(r() * 3)] : null, tshirt: ['S', 'M', 'L', null][Math.floor(r() * 4)], quarters: qs });
    const nS = Math.floor(r() * 8);
    for (let s = 0; s < nS; s++) {
      const start = today - 60 + Math.floor(r() * 200), len = 1 + Math.floor(r() * 40);
      const oe = Math.round(r() * 80), ts = Math.round(r() * oe), done = r() > 0.85;
      issues.push({ id: `s${p}-${s}`, key: `S-${p}-${s}`, summary: '', role: 'estimate', levelKey: 'st', parentId: `w${p}`, rootRef: ref,
        status: { cat: done ? 'done' : 'indeterminate' }, team: r() > 0.15 ? teams[Math.floor(r() * 3)] : null,
        start: r() > 0.15 ? isoOf(start) : null, due: r() > 0.1 ? isoOf(start + len) : null, oe, ts, re: done ? 0 : Math.max(0, oe - ts) });
    }
  }
  const people = {};
  teams.forEach((t, i) => { if (r() > 0.2) people[`u${i}`] = { weeklyHours: Math.round(r() * 40), teamId: t.id, location: 'NONE' }; });
  return {
    today: '2026-11-02', portfolio, issues, teams,
    config: { levels: [{ key: 'ws', role: 'rough', issueTypeIds: ['1'] }, { key: 'st', role: 'estimate', issueTypeIds: ['2'] }], tshirtSizes: [{ key: 'S', hours: 80 }, { key: 'M', hours: 200 }, { key: 'L', hours: 500 }] },
    capacity: { people, teams: Object.fromEntries(teams.map((t) => [t.id, { dailyBusinessPct: Math.round(r() * 30), absenceRatePct: Math.round(r() * 15), extraWeeklyHours: r() > 0.5 ? Math.round(r() * 60) : 0 }])) },
    supportComputed: { reserveQuarter: { a: Math.round(r() * 80) }, personWeekly: {}, teams: [], services: [] },
  };
}
const SEVERITY = { ok: 0, partial: 1, no: 2 };

test('invariants hold for 400 random portfolios', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const ds = randomPortfolio(seed);
    const c = computeAll(ds);
    for (const m of c.metrics.values()) {
      assert.ok(m.progress >= 0 && m.progress <= 1, `progress in [0,1] (seed ${seed})`);
      assert.ok(m.maturity === null || (m.maturity >= 0 && m.maturity <= 1), `maturity in [0,1] (seed ${seed})`);
      assert.ok(m.openTshirt >= -1e-9 && m.expired >= -1e-9, `open/expired T-shirt never negative (seed ${seed})`);
      for (const q of Object.keys(m.demand)) for (const v of Object.values(m.demand[q])) assert.ok(v >= -1e-9, `demand >= 0 (seed ${seed})`);
    }
    for (const t of Object.keys(c.wl.cells)) for (const cell of Object.values(c.wl.cells[t])) {
      let prevCum = -Infinity, prevSev = 0;
      for (const row of cell.rows) {
        assert.ok(row.cum >= prevCum - 1e-9, `cumulative demand never decreases (seed ${seed})`);
        if (row.kind === 'project') {
          assert.ok(SEVERITY[row.status] >= prevSev, `once a rank is not staffable, lower ranks are not better (seed ${seed})`);
          prevSev = SEVERITY[row.status];
          assert.ok(row.staffed >= -1e-9 && row.staffed <= row.demand + 1e-9, `staffed within [0, demand] (seed ${seed})`);
        }
        prevCum = row.cum;
      }
    }
  }
});

test('reordering never changes total demand and moving a project up never worsens it', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const ds = randomPortfolio(seed);
    const before = computeAll(ds);
    const n = ds.portfolio.length;
    const target = ds.portfolio[n - 1];
    const reordered = { ...ds, portfolio: ds.portfolio.map((p) => ({ ...p, rank: p.ref === target.ref ? 1 : p.rank + 1 })) };
    const after = computeAll(reordered);
    for (const t of Object.keys(before.wl.cells)) for (const q of Object.keys(before.wl.cells[t])) {
      const a = before.wl.cells[t][q], b = after.wl.cells[t]?.[q];
      assert.ok(b && Math.abs(a.demand - b.demand) < 1e-6, `total demand unchanged by ranking (seed ${seed})`);
      const sa = a.rows.find((r) => r.ref === target.ref), sb = b.rows.find((r) => r.ref === target.ref);
      if (sa && sb) assert.ok(SEVERITY[sb.status] <= SEVERITY[sa.status], `moving to rank 1 never worsens the project (seed ${seed})`);
    }
  }
});
