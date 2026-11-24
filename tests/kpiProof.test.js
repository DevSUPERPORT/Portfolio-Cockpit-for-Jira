// "Nachprüfen": every KPI computed from records carries those records (proof.rows), and the rows add up to the
// figures of its calculation (proof.totals) – recounted here independently of recountProof, on the Lotse fixture
// (the demo company) and on the S-size customer dataset. Also: the final step gives the tile's value, every
// summed figure is the one written in calc / inputs, and the maturity rows open to the stories they are made of.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAll } from '../shared/engine.js';
import { projectKpis, portfolioKpis, teamKpis, recountProof } from '../shared/kpis.js';
import { teamIds } from '../shared/team.js';
import { lotseDataset } from './lotseFixture.js';
import { bigDataset } from '../tools/bigDataset.js';

const n = (v, d = 0) => (v == null || !Number.isFinite(v) ? '–' : (Math.round(v * 10 ** d) / 10 ** d).toString());
const fmt = { pct: (v) => (v == null ? '–' : `${Math.round(v * 100)} %`), signedPct: (v) => (v == null ? '–' : `${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)} %`), h: (v, d = 0) => `${n(v, d)} h`, n, date: (d) => String(d).slice(0, 10), quarter: (q) => q, week: (w) => w };
const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b)), `${what}: ${a} ≠ ${b}`);

// the independent recount: plain loops, no shared code
function check(k, where) {
  const p = k.proof;
  assert.ok(p, `${where} ${k.id}: has a proof`);
  assert.ok(Array.isArray(p.columns) && p.columns.length, `${where} ${k.id}: columns`);
  assert.ok(Array.isArray(p.rows), `${where} ${k.id}: rows`);
  assert.ok(Array.isArray(p.steps) && p.steps.length, `${where} ${k.id}: plain steps`);
  const ids = new Set(p.columns.map((c) => c.id));
  for (const c of p.columns) assert.ok(['h', 'n', 'pct', 'date', 'text'].includes(c.unit), `${k.id}: unit ${c.unit}`);
  for (const r of p.rows) {
    assert.ok(typeof r.label === 'string', `${k.id}: row label`);
    for (const c of Object.keys(r.values)) assert.ok(ids.has(c), `${k.id}: value ${c} has a column`);
  }
  const got = new Map();
  for (const t of p.totals) {
    if (t.given) { got.set(t.id, t.value); continue; }
    let v = 0;
    for (const r of p.rows) {
      if (t.where && Object.entries(t.where).some(([kk, vv]) => (r[kk] ?? r.values[kk]) !== vv)) continue;
      v += t.agg === 'rows' ? 1 : Number(r.values[t.col]) || 0;
    }
    near(v, t.value, `${where} ${k.id} total ${t.id}`);
    got.set(t.id, v);
    // the figure is the one the tile shows in its calculation (or, for the parts not in the formula, its inputs)
    const unit = t.agg === 'rows' ? 'n' : p.columns.find((c) => c.id === t.col)?.unit;
    const shown = unit === 'n' ? [String(t.value)] : unit === 'h' ? [fmt.h(t.value), fmt.h(t.value, 1)] : [];
    const text = [k.calc, k.foot, k.display, ...(k.inputs || []).map(([, x]) => String(x))].join(' | ');
    if (shown.length && !(p.final?.clamp0 && t.value < 0)) assert.ok(shown.some((x) => text.includes(x)), `${where} ${k.id}: ${t.id}=${shown[0]} appears in "${text}"`);
  }
  if (p.final) {
    let v;
    if (p.final.op === 'ratio') {
      const add = (xs) => xs.reduce((a, id) => a + (id[0] === '-' ? -got.get(id.slice(1)) : got.get(id)), 0);
      v = add(p.final.num) / add(p.final.den) + (p.final.offset || 0);
    } else if (p.final.op === 'total') v = p.final.clamp0 ? Math.max(0, got.get(p.final.id)) : got.get(p.final.id);
    else v = p.final.value;
    near(v, p.final.value, `${where} ${k.id} final`);
    if (Number.isFinite(k.value)) near(v, k.value, `${where} ${k.id} final = tile value`);
  }
  const rc = recountProof(p, k.value);
  assert.equal(rc.ok, true, `${where} ${k.id}: recountProof agrees`);
}

const datasets = [['fixture', () => lotseDataset()], ['S', () => bigDataset('S')]];
for (const [name, make] of datasets) {
  const c = computeAll(make());
  const ranked = [...c.model.items].sort((a, b) => a.rank - b.rank);

  test(`${name}: every project KPI has proof rows that add up to its calculation`, () => {
    let n = 0;
    for (const p of ranked) {
      for (const lang of ['de', 'en']) {
        for (const k of projectKpis({ computed: c, ref: p.ref, lang, fmt })) { check(k, `${p.name}/${lang}`); n++; }
      }
    }
    assert.ok(n >= ranked.length * 7);
  });

  test(`${name}: every portfolio KPI has proof rows that add up to its calculation`, () => {
    for (const lang of ['de', 'en']) {
      for (const k of portfolioKpis({ computed: c, lang, fmt, ranked, wl: c.wl, quarter: c.wl.quarters[0], now: Date.parse(`${c.model.ds.today}T10:00:00Z`) })) check(k, `portfolio/${lang}`);
    }
  });

  test(`${name}: every team KPI has proof rows that add up to its calculation`, () => {
    const ids = teamIds(c);
    assert.ok(ids.length > 0);
    for (const teamId of ids) for (const k of teamKpis({ computed: c, teamId, lang: 'de', fmt })) check(k, `team ${teamId}`);
  });

  test(`${name}: maturity rows open to their epics and stories, and those add up too`, () => {
    const k = portfolioKpis({ computed: c, lang: 'de', fmt, ranked, wl: c.wl, quarter: c.wl.quarters[0] }).find((x) => x.id === 'maturity');
    // every item row of the drawer has its proof row (same text), and every project row its key
    for (const it of k.items) assert.ok(k.proof.rows.some((r) => r.label === it.text), `item ${it.text} has a proof row`);
    for (const r of k.proof.rows) {
      assert.ok(r.ref && r.children, `${r.label}: expandable`);
      const m = c.metrics.get(r.ref);
      // the project's epics: open size and counted original estimate add up to the project's figures
      near(r.children.rows.reduce((a, u) => a + u.values.open, 0), m.openTshirt, `${r.label} open`);
      near(r.children.rows.reduce((a, u) => a + u.values.oe, 0), r.values.oe, `${r.label} oe`);
      near(r.children.rows.reduce((a, u) => a + u.values.oe + u.values.oeOut, 0), m.OE, `${r.label} OE`);
      for (const u of r.children.rows) {
        // an epic's stories carry exactly its original estimate
        near(u.children.rows.reduce((a, s) => a + s.values.oe, 0), u.values.oe + u.values.oeOut, `${u.label} stories`);
        for (const s of u.children.rows) assert.ok(s.key && s.issueId, `${s.label}: opens in Jira`);
        if (u.id !== '_none') assert.ok(u.key, `${u.label}: key to open`);
      }
    }
    // the project tile: epic rows with their stories, the same numbers
    for (const p of ranked) {
      const pk = projectKpis({ computed: c, ref: p.ref, lang: 'de', fmt }).find((x) => x.id === 'maturity');
      for (const it of pk.items) assert.ok(pk.proof.rows.some((r) => r.label === it.text), `${p.name}: item ${it.text} has a proof row`);
    }
  });
}

test('the proof does not change any existing field of a KPI', () => {
  const c = computeAll(lotseDataset());
  const ref = c.model.items[0].ref;
  const ks = projectKpis({ computed: c, ref, lang: 'de', fmt });
  for (const k of ks) {
    const { proof, ...rest } = k;
    assert.ok(proof);
    for (const f of ['value', 'display', 'foot', 'calc', 'inputs', 'items', 'itemsTitle']) assert.ok(f in rest, `${k.id}.${f} still there`);
  }
});

test('recountProof flags a row that does not add up', () => {
  const c = computeAll(lotseDataset());
  const k = projectKpis({ computed: c, ref: c.model.items[0].ref, lang: 'de', fmt }).find((x) => x.id === 'progress');
  assert.equal(recountProof(k.proof, k.value).ok, true);
  const broken = structuredClone(k.proof);
  broken.rows[0].values.ts += 5;
  const r = recountProof(broken, k.value);
  assert.equal(r.ok, false);
  assert.equal(r.totals.find((t) => t.id === 'ts').ok, false);
});
