// KPI registry: every tile shows its base and its calculation, and the calculation reproduces the number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAll, dataQuality } from '../shared/engine.js';
import { projectKpis, portfolioKpis, definitions, portfolioDefinitions, projectWeeks } from '../shared/kpis.js';

const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url)));
const n = (v, d = 0) => (v == null || !Number.isFinite(v) ? '–' : (Math.round(v * 10 ** d) / 10 ** d).toString());
const fmt = { pct: (v) => (v == null ? '–' : `${Math.round(v * 100)} %`), signedPct: (v) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)} %`), h: (v) => `${n(v)} h`, n, date: (d) => String(d).slice(0, 10), quarter: (q) => q, week: (w) => w };

test('every project tile has a definition, a base line, a calculation and inputs', () => {
  const c = computeAll(structuredClone(golden));
  for (const p of c.model.items) {
    const ks = projectKpis({ computed: c, ref: p.ref, lang: 'de', fmt });
    assert.deepEqual(ks.map((k) => k.id), ['progress', 'forecast', 'maturity', 'dataQuality', 'dependencies', 'overdue', 'capacity']);
    for (const k of ks) {
      assert.ok(k.label && k.text && k.foot && k.calc, `${p.name}/${k.id} explains itself`);
      assert.ok(Array.isArray(k.inputs) && k.inputs.length > 0, `${k.id} inputs`);
      if (k.display !== '–' && /%/.test(k.display)) assert.ok(k.calc.endsWith(k.display) || k.calc.includes(k.display), `${k.id}: calculation "${k.calc}" ends in the shown value ${k.display}`);
    }
  }
  const ids = definitions('de').map((d) => d.id);
  for (const id of ['progress', 'forecast', 'maturity', 'openTshirt', 'dataQuality', 'dependencies', 'overdue', 'capacity']) assert.ok(ids.includes(id), `legend has ${id}`);
});

test('the numbers are the engine numbers (one definition each)', () => {
  const c = computeAll(structuredClone(golden));
  const p = c.model.items[0];
  const m = c.metrics.get(p.ref);
  const k = Object.fromEntries(projectKpis({ computed: c, ref: p.ref, lang: 'en', fmt }).map((x) => [x.id, x]));
  assert.equal(k.progress.value, m.progress);
  assert.equal(k.maturity.value, m.OE + m.openTshirt > 0 ? m.OE / (m.OE + m.openTshirt) : null);
  // prototype wording: what of the T-shirt size is not yet estimated as stories, or "fully estimated from <quarter>"
  assert.equal(k.maturity.foot, m.openTshirt > 0.5 ? `${fmt.h(m.openTshirt)} of T-shirt size not yet estimated as stories` : `T-shirt size fully estimated from ${c.model.curQ}`);
  assert.equal(k.forecast.value, m.OE > 0 ? m.forecast / m.OE - 1 : null);
  assert.equal(k.overdue.value, m.overdueCount);
  // data quality = (complete epics + complete stories) ÷ (epics + stories), the data-quality page's own level counts
  const dq = dataQuality(c.model, new Set([p.ref]));
  const roleOf = new Map(c.model.cfg.levels.map((l) => [l.key, l.role]));
  const lv = dq.levels.filter((l) => ['estimate', 'rough'].includes(roleOf.get(l.levelKey)));
  const total = lv.reduce((a, l) => a + l.total, 0), complete = lv.reduce((a, l) => a + l.complete, 0);
  assert.ok(total > complete, 'the fixture has incomplete work items');
  assert.equal(k.dataQuality.foot, `${complete} of ${total} work items with all required fields`);
  assert.equal(k.dataQuality.value, complete / total);
  assert.equal(k.dataQuality.items.length, total - complete, 'every incomplete work item is listed with what is missing');
  assert.equal(k.dataQuality.hot, complete / total < 0.7, 'red below 70 %');
});

test('capacity = team quarters not fully staffable + people with a week problem (OK when none)', () => {
  const c = computeAll(structuredClone(golden));
  for (const p of c.model.items) {
    const k = projectKpis({ computed: c, ref: p.ref, lang: 'en', fmt }).find((x) => x.id === 'capacity');
    const pw = projectWeeks(c.model, p.ref, c.support);
    const people = pw.rows.filter((r) => r.hours.some((h, i) => h > 0.05 && (r.id === '_none' || (r.cap && r.cap[i] <= 0.01) || (r.util && r.util[i] > 1.0001)))).length;
    const quarters = c.wl.quarters.reduce((a, q) => a + (c.wl.projectQ[p.ref]?.[q]?.teams || []).filter((t) => t.status !== 'ok').length, 0);
    assert.equal(k.value, people + quarters, p.name);
    assert.equal(k.display, k.value ? String(k.value) : 'OK');
    assert.equal(k.items.length, k.value, 'every bottleneck is listed');
  }
});

test('portfolio tiles: totals over active projects, waterline follows the given (live) order', () => {
  const c = computeAll(structuredClone(golden));
  const ranked = [...c.model.items];
  const ks = Object.fromEntries(portfolioKpis({ computed: c, lang: 'de', fmt, ranked, wl: c.wl, quarter: c.wl.quarters[0] }).map((x) => [x.id, x]));
  const ms = ranked.filter((p) => !c.metrics.get(p.ref).done).map((p) => c.metrics.get(p.ref));
  const OE = ms.reduce((a, m) => a + m.OE, 0), OT = ms.reduce((a, m) => a + m.openTshirt, 0);
  assert.equal(ks.maturity.value, OE + OT > 0 ? OE / (OE + OT) : null);
  assert.equal(ks.maturity.foot, `offene T-Shirt Size ${fmt.h(OT)}`);
  assert.equal(ks.waterline.items.length, ms.length);
  assert.ok(portfolioDefinitions('en').every((d) => d.label && d.text));
});

test('Reife without a T-shirt size is unknown – never 100 % (PCX-32 case)', () => {
  const ds = structuredClone(golden);
  for (const i of ds.issues) if (i.role === 'rough' && i.rootRef === 'issue:p2') { i.tshirt = null; i.quarters = []; }
  const c = computeAll(ds);
  const m = c.metrics.get('issue:p2');
  assert.equal(m.maturity, null, 'no rough estimate → no percentage');
  const k = projectKpis({ computed: c, ref: 'issue:p2', lang: 'de', fmt }).find((x) => x.id === 'maturity');
  assert.equal(k.display, '–');
  assert.match(k.foot, /T-Shirt Size fehlt/);
  assert.match(k.calc, /keine Prozentzahl/);
  assert.ok(k.items.some((x) => x.fix?.usage === 'tshirt' && x.fix.issueId), 'the epic/workstream without a size can be fixed in place');
  // the portfolio tile counts only what has a size and names the project without one
  const p = portfolioKpis({ computed: c, lang: 'de', fmt, ranked: [...c.model.items], wl: c.wl, quarter: c.wl.quarters[0] }).find((x) => x.id === 'maturity');
  const m1 = c.metrics.get('issue:p1');
  assert.equal(p.value, m1.maturity, 'only the sized project counts');
  assert.match(p.foot, /1 Projekt ohne T-Shirt Size/);
});

test('Reife with some units unsized: only the sized ones count, the rest is named', () => {
  const ds = structuredClone(golden);
  const ws = ds.issues.filter((i) => i.role === 'rough' && i.rootRef === 'issue:p1');
  if (ws.length < 2) { // add a second, unsized workstream with an estimated story below it
    ds.issues.push({ ...ws[0], id: 'w9', key: 'P-99', summary: 'WS ohne Größe', tshirt: null, quarters: [] });
    const st = ds.issues.find((i) => i.role === 'estimate' && i.rootRef === 'issue:p1');
    ds.issues.push({ ...st, id: 's99', key: 'P-98', parentId: 'w9', oe: 50, re: 50, ts: 0, links: [] });
  } else ws[1].tshirt = null;
  const m = computeAll(ds).metrics.get('issue:p1');
  assert.ok(m.maturity != null && m.maturityBasis.missing.length === 1);
  assert.ok(Math.abs(m.maturity - m.maturityBasis.oeCovered / (m.maturityBasis.oeCovered + m.openTshirt)) < 1e-12);
  assert.ok(m.maturityBasis.oeUncovered >= 50, 'the unsized part is reported, not hidden');
});

test('story totals: with ds.storyTotals the sub-tasks\' time is not counted twice', () => {
  const ds = structuredClone(golden);
  const st = ds.issues.find((i) => i.role === 'estimate');
  ds.issues.push({ ...st, id: 'x1', key: 'P-X1', role: 'tiny', levelKey: 'sub', parentId: st.id, oe: 0, re: 0, ts: 7, links: [] });
  const before = computeAll(ds).metrics.get(st.rootRef).TS;
  ds.storyTotals = true; // the story's ts already contains the sub-task (Jira aggregate)
  const after = computeAll(ds).metrics.get(st.rootRef).TS;
  assert.equal(before - after, 7);
});

test('structure rules: the spec\'s checks report counts and the work items behind them', async () => {
  const { structureChecks } = await import('../shared/kpis.js');
  const ds = structuredClone(golden);
  const st = ds.issues.find((i) => i.role === 'estimate');
  ds.issues.push({ ...st, id: 'x2', key: 'P-X2', role: 'tiny', levelKey: 'sub', parentId: st.id, oe: 0, re: 0, ts: 3, links: [] }); // time on a sub-task
  for (const i of ds.issues) if (i.role === 'rough' && i.rootRef === 'issue:p2') i.tshirt = null; // epic level without size
  ds.supportTickets = { tickets: [{ id: 't1', key: 'X-1', summary: 'Login', projectKey: st.projectKey, statusCat: 'new', priority: 'High', created: '2026-10-01T00:00:00Z', links: [] }] };
  const c = computeAll(ds);
  const checks = Object.fromEntries(structureChecks({ computed: c, ds, lang: 'de', fmt }).map((x) => [x.id, x]));
  assert.equal(checks.logOnStories.count, 1);
  assert.equal(checks.logOnStories.items[0].key, 'P-X2');
  assert.ok(checks.roughSize.count >= 1 && checks.roughSize.items.some((x) => x.fix?.usage === 'tshirt'));
  if (st.projectKey) assert.equal(checks.supportSpace.count, 1, 'a support ticket in a project space is named');
  for (const x of Object.values(checks)) assert.equal(x.ok, x.count === 0);
});
