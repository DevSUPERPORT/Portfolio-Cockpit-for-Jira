// Invariants: rules every number must obey on ANY portfolio, checked on hundreds of generated portfolios
// (seeded, reproducible – a failure prints its seed). No new dependency: a small generator of our own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAll, projectMetrics, dataQuality, buildModel, waterline } from '../shared/engine.js';
import { projectKpis } from '../shared/kpis.js';
import { teamDetails, teamIds } from '../shared/team.js';
import { bookingOverview } from '../shared/booking.js';
import { smartSuggestions } from '../shared/smart.js';
import { isoOf, dayIdx } from '../shared/dates.js';

const RUNS = Number(process.env.INVARIANT_RUNS || 300);
const EPS = 1e-6;
const fmt = { pct: (v) => (v == null ? '–' : `${Math.round(v * 100)} %`), signedPct: (v) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)} %`), h: (v) => `${Math.round(v)} h`, n: (v) => String(Math.round(v)), date: (d) => String(d), quarter: (q) => q, week: (w) => w };

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

// A random but valid portfolio: projects > rough (epics, T-shirt + quarters) > stories > sub-tasks, teams,
// people with capacity and absences, support reservation, links, Blocked statuses.
export function generate(seed) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const today = '2026-11-06';
  const t0 = dayIdx(today);
  const teams = ['web', 'data', 'ux', 'int'].slice(0, int(1, 4)).map((id) => ({ id, name: id.toUpperCase() }));
  const sizes = [{ key: 'XS', hours: 40 }, { key: 'S', hours: 80 }, { key: 'M', hours: 160 }, { key: 'L', hours: 320 }, { key: 'XL', hours: 640 }];
  const quarters = ['2026-Q3', '2026-Q4', '2027-Q1', '2027-Q2', '2027-Q3'];
  const cats = ['new', 'indeterminate', 'done'];
  const people = Array.from({ length: int(1, 6) }, (_, i) => `u${i}`);
  const portfolio = [], issues = [];
  let n = 0;
  const nP = int(1, 5);
  const epicsAsItems = r() < 0.3;
  for (let p = 0; p < nP; p++) {
    const pid = `p${p}`, ref = `issue:${pid}`;
    portfolio.push({ ref, rank: p + 1, kind: 'issue', id: pid, key: `P-${p}`, name: `Projekt ${p}`, owner: { id: 'o', name: 'O' }, statusCat: r() < 0.1 ? 'done' : 'indeterminate', due: r() < 0.7 ? isoOf(t0 + int(-20, 200)) : null,
      ...(epicsAsItems ? { tshirt: r() < 0.7 ? pick(sizes).key : null, quarters: r() < 0.8 ? [...new Set([pick(quarters), pick(quarters)])].sort() : [], leadTeam: pick(teams) } : {}) });
    const nE = epicsAsItems ? 0 : int(0, 3);
    const parents = [];
    for (let e = 0; e < nE; e++) {
      const id = `e${n++}`;
      issues.push({ id, key: `K-${id}`, summary: id, role: 'rough', levelKey: 'ep', parentId: pid, rootRef: ref, status: { id: '1', name: 'Open', cat: pick(['new', 'indeterminate']) }, team: r() < 0.8 ? pick(teams) : null,
        tshirt: r() < 0.7 ? pick(sizes).key : null, quarters: r() < 0.8 ? [...new Set([pick(quarters), pick(quarters)])].sort() : [], links: [], worklogs: [] });
      parents.push(id);
    }
    const nS = int(0, 8);
    for (let s = 0; s < nS; s++) {
      const id = `s${n++}`;
      const cat = pick(cats);
      const start = r() < 0.8 ? t0 + int(-60, 150) : null;
      const due = r() < 0.85 ? (start ?? t0) + int(-10, 60) : null;
      const oe = r() < 0.85 ? int(1, 120) : 0;
      const ts = cat === 'new' ? 0 : int(0, 140);
      const blocked = cat !== 'done' && r() < 0.1;
      const st = { id: blocked ? '9' : '1', name: blocked ? 'Blocked' : cat === 'done' ? 'Done' : 'In Progress', cat: blocked ? 'new' : cat };
      issues.push({ id, key: `K-${id}`, summary: id, role: 'estimate', levelKey: 'st', parentId: parents.length && r() < 0.85 ? pick(parents) : pid, rootRef: ref, status: st, team: r() < 0.85 ? pick(teams) : null,
        assignee: r() < 0.85 ? { id: pick(people), name: 'X' } : null, start: start != null ? isoOf(start) : null, due: due != null ? isoOf(due) : null, oe, re: cat === 'done' ? 0 : int(0, 100), ts,
        links: [], worklogs: ts ? [{ a: pick(people), d: isoOf(t0 - int(0, 40)), h: ts }] : [], blockedSince: blocked ? isoOf(t0 - int(0, 30)) : null });
      if (r() < 0.3) issues.push({ id: `t${n++}`, key: `K-t${n}`, summary: 'sub', role: 'tiny', levelKey: 'sub', parentId: id, rootRef: ref, status: { id: '1', name: 'Open', cat: 'new' }, team: null, links: [], worklogs: [] });
    }
  }
  const stories = issues.filter((i) => i.role === 'estimate');
  for (let k = 0; k < int(0, 6) && stories.length > 1; k++) {
    const a = pick(stories), b = pick(stories);
    if (a === b) continue;
    const id = `L${k}`;
    a.links.push({ id, typeId: '10000', verb: 'blocks', inverse: 'is blocked by', outward: true, otherId: b.id });
    b.links.push({ id, typeId: '10000', verb: 'blocks', inverse: 'is blocked by', outward: false, otherId: a.id });
  }
  const capacity = { defaultWeeklyHours: 40, defaultLocation: 'NONE', teams: Object.fromEntries(teams.map((t) => [t.id, { name: t.name, dailyBusinessPct: int(0, 30), absenceRatePct: int(0, 15) }])),
    people: Object.fromEntries(people.filter(() => r() < 0.8).map((id) => [id, { weeklyHours: pick([20, 32, 40]), location: 'NONE', teamId: pick(teams).id }])),
    absences: people.filter(() => r() < 0.3).map((id) => ({ accountId: id, from: isoOf(t0 + int(-10, 20)), to: isoOf(t0 + int(21, 40)) })) };
  const supportTeams = teams.filter(() => r() < 0.5).map((t) => ({ teamId: t.id, weekly: int(1, 30), avg: 0, spike: false }));
  return {
    today, storyTotals: true,
    config: { levels: [...(epicsAsItems ? [] : [{ key: 'ep', name: 'Epic', role: 'rough', issueTypeIds: ['3'] }]), { key: 'st', name: 'Story', role: 'estimate', issueTypeIds: ['4'] }, { key: 'sub', name: 'Sub-task', role: 'tiny', issueTypeIds: ['5'] }],
      tshirtSizes: sizes, dependencies: { linkTypeIds: ['10000'] }, rules: { distribution: 'linear', forecastThresholdPct: 10 } },
    portfolio, issues, teams, capacity,
    supportComputed: supportTeams.length ? { reserveQuarter: Object.fromEntries(supportTeams.map((t) => [t.teamId, t.weekly * 12])), personWeekly: {}, teams: supportTeams, services: [] } : null,
  };
}

const each = (fn) => { for (let seed = 1; seed <= RUNS; seed++) { try { fn(generate(seed), seed); } catch (e) { e.message = `seed ${seed}: ${e.message}`; throw e; } } };
const close = (a, b, tol = EPS) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

test('project numbers: sums of the stories, shares between 0 and 1, open T-shirt within the T-shirt size', () => {
  each((ds) => {
    const c = computeAll(ds);
    for (const p of c.model.items) {
      const m = c.metrics.get(p.ref);
      const st = ds.issues.filter((i) => i.rootRef === p.ref && i.role === 'estimate');
      assert.ok(close(m.OE, st.reduce((a, s) => a + (s.oe || 0), 0)), 'OE = Σ story OE');
      assert.ok(close(m.TS, st.reduce((a, s) => a + (s.ts || 0), 0)), 'TS = Σ story TS');
      assert.ok(close(m.RE, st.filter((s) => s.status.cat !== 'done').reduce((a, s) => a + (s.re || 0), 0)), 'RE = Σ open story RE');
      assert.ok(m.progress >= 0 && m.progress <= 1 + EPS, `progress ${m.progress}`);
      assert.ok(m.maturity == null || (m.maturity >= 0 && m.maturity <= 1 + EPS), `maturity ${m.maturity}`);
      assert.ok(m.openTshirt >= -EPS && m.openTshirt <= m.tshirtTotal + EPS, `open T-shirt ${m.openTshirt} ≤ ${m.tshirtTotal}`);
      assert.ok(m.expired >= -EPS && m.openTshirt + m.expired <= m.tshirtTotal + EPS, 'open + lapsed ≤ T-shirt');
      // no Reife exactly when there is no T-shirt size, or nothing at all to compare (sized only in past quarters, nothing estimated)
      assert.equal(m.maturity == null, !(m.maturityBasis.withTshirt > 0) || m.maturityBasis.oeCovered + m.openTshirt === 0, 'no Reife exactly when unknown');
      assert.ok(close(m.forecast, m.TS + m.RE), 'forecast = TS + RE');
      // demand per quarter = remaining estimate in the window + open T-shirt in it (never negative)
      for (const q of Object.keys(m.demand)) for (const h of Object.values(m.demand[q])) assert.ok(h >= -EPS);
    }
  });
});

test('rank changes nothing but the waterline: project numbers are independent of the order', () => {
  each((ds, seed) => {
    if (ds.portfolio.length < 2) return;
    const a = computeAll(ds);
    const rev = structuredClone(ds);
    rev.portfolio.forEach((p, i) => { p.rank = rev.portfolio.length - i; });
    const b = computeAll(rev);
    for (const p of ds.portfolio) {
      const x = a.metrics.get(p.ref), y = b.metrics.get(p.ref);
      for (const k of ['OE', 'TS', 'RE', 'openTshirt', 'progress', 'tshirtTotal']) assert.ok(close(x[k], y[k]), `seed ${seed} ${p.ref} ${k}`);
      assert.equal(x.maturity, y.maturity);
    }
  });
});

test('waterline: support first, rows add up, once a project does not fit every later one does not either', () => {
  each((ds) => {
    const c = computeAll(ds);
    for (const t of Object.keys(c.wl.cells)) {
      for (const q of Object.keys(c.wl.cells[t])) {
        const cell = c.wl.cells[t][q];
        assert.equal(cell.rows[0].kind, 'support', 'support is the first row');
        const sum = cell.rows.reduce((a, r) => a + r.demand, 0);
        assert.ok(close(sum, cell.demand), 'rows add up to the demand');
        let broken = false;
        let prevRank = 0;
        for (const r of cell.rows.slice(1)) {
          assert.ok(r.rank > prevRank, 'rank order'); prevRank = r.rank;
          assert.ok(r.staffed >= -EPS && r.staffed <= r.demand + EPS, 'staffed within demand');
          if (broken) assert.equal(r.status, 'no', 'after the waterline nothing fits');
          if (r.status !== 'ok') broken = true;
        }
      }
    }
  });
});

test('Teamdetails: project rows add up to the demand, free = capacity after support − demand', () => {
  each((ds) => {
    const c = computeAll(ds);
    for (const id of teamIds(c)) {
      const td = teamDetails(c, id);
      for (const q of td.quarters) {
        const rows = td.projects.reduce((a, p) => a + (p.q[q]?.demand || 0), 0);
        assert.ok(close(rows, td.cells[q].demand, 1e-6), `${id} ${q}: rows ${rows} vs demand ${td.cells[q].demand}`);
        assert.ok(close(td.cells[q].free, td.cells[q].cap - td.cells[q].demand), 'free');
      }
      assert.ok(td.watch.every((w) => w.blocked || w.overdue), 'only blocked or past due');
    }
  });
});

test('data quality and the seven boxes: shares in [0,1], every listed item explains a gap, counts match lists', () => {
  each((ds) => {
    const c = computeAll(ds);
    const dq = dataQuality(c.model, null);
    assert.ok(dq.score >= 0 && dq.score <= 1);
    for (const l of dq.levels) assert.ok(l.complete <= l.total);
    for (const p of c.model.items) {
      const ks = Object.fromEntries(projectKpis({ computed: c, ref: p.ref, lang: 'en', fmt }).map((k) => [k.id, k]));
      assert.ok(ks.dataQuality.value == null || (ks.dataQuality.value >= 0 && ks.dataQuality.value <= 1));
      assert.equal(ks.overdue.value, ks.overdue.items.length, 'past due: count = list');
      assert.equal(ks.capacity.value, ks.capacity.items.length, 'capacity: count = list');
      assert.equal(ks.capacity.display, ks.capacity.value ? String(ks.capacity.value) : 'OK');
      for (const k of Object.values(ks)) assert.ok(k.label && k.foot && k.calc, `${k.id} explains itself`);
      const m = c.metrics.get(p.ref);
      if (m.maturity == null && m.maturityBasis.withTshirt > 0) assert.ok(!/missing/.test(ks.maturity.foot), 'a lapsed T-shirt size is not called missing');
    }
  });
});

test('Blocked: only open stories/sub-tasks in the Blocked status, oldest first', () => {
  each((ds) => {
    const c = computeAll(ds);
    const b = c.deps.blocked;
    for (const x of b) {
      const i = c.model.byId.get(x.id);
      assert.ok(i.status.name === 'Blocked' && i.status.cat !== 'done');
    }
    for (let k = 1; k < b.length; k++) assert.ok((b[k - 1].days ?? -1) >= (b[k].days ?? -1), 'oldest first');
    const expected = ds.issues.filter((i) => (i.role === 'estimate' || i.role === 'tiny') && i.status.name === 'Blocked' && i.status.cat !== 'done').length;
    assert.equal(b.length, expected);
  });
});

test('booking check: quote, missing and status follow the thresholds exactly', () => {
  each((ds, seed) => {
    const c = computeAll(ds);
    const r = rng(seed * 7);
    const booked = { people: Object.fromEntries(Object.keys(ds.capacity.people).map((id) => [id, { h: Math.round(r() * 200), last: ds.today, byIssue: {} }])) };
    const a = dayIdx('2026-10-01'), b = dayIdx('2026-10-31');
    const o = bookingOverview(c.model, booked, a, b, { booking: { minPct: 90, escalatePct: 20 } });
    for (const x of o.rows) {
      assert.ok(x.possible >= 0 && x.booked >= 0 && x.missing >= 0);
      if (x.possible <= 0) { assert.equal(x.level, 'none'); continue; }
      assert.equal(x.pct, Math.round((x.booked / x.possible) * 100));
      assert.equal(x.level, x.pct >= 90 ? 'ok' : 100 - x.pct >= 20 ? 'esc' : 'info');
    }
  });
});

test('smart suggestions: every one targets a fixable gap, says why, and applying it closes that gap', () => {
  each((ds) => {
    const c = computeAll(ds);
    for (const s of smartSuggestions(c, { lang: 'en' })) {
      assert.ok(s.gap.fixable && s.why.length > 10);
      if (s.gap.isItem) continue;
      const after = structuredClone(ds);
      const i = after.issues.find((x) => x.id === s.gap.issueId);
      const field = { team: 'team', tshirt: 'tshirt', targetQuarters: 'quarters', originalEstimate: 'oe', startDate: 'start', dueDate: 'due' }[s.usage];
      i[field] = s.usage === 'team' ? (after.teams.find((t) => t.id === s.value) || { id: s.value }) : s.value;
      const gaps = dataQuality(buildModel(after), null).gaps;
      assert.ok(!gaps.some((g) => g.id === s.gap.id), `applying ${s.usage}=${JSON.stringify(s.value)} closes ${s.gap.id}`);
    }
  });
});

test('generator sanity: the runs cover the interesting cases', () => {
  let blocked = 0, noShirt = 0, overflow = 0, items = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const ds = generate(seed), c = computeAll(ds);
    blocked += c.deps.blocked.length > 0;
    noShirt += [...c.metrics.values()].some((m) => m.maturity == null);
    overflow += Object.values(c.wl.cells).some((t) => Object.values(t).some((x) => x.rows.some((r) => r.status !== 'ok')));
    items += !ds.config.levels.some((l) => l.role === 'rough');
  }
  assert.ok(blocked > 10 && noShirt > 10 && overflow > 10 && items > 10, `blocked ${blocked}, no T-shirt ${noShirt}, waterline hit ${overflow}, epics as items ${items}`);
  void waterline; void projectMetrics;
});
