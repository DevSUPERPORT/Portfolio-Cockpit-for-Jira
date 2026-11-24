// Runs the cockpit's engine on the raw PCX export (same rules and assumptions as the independent workbook) and
// writes docs/proof/engine-values.json, then compares it with docs/proof/independent-values.json if present.
// Usage: node docs/proof/run-engine.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { computeAll, estimateVsSpent } from '../../shared/engine.js';
import { projectKpis } from '../../shared/kpis.js';
import { dayIdx } from '../../shared/dates.js';

const here = new URL('.', import.meta.url);
const raw = JSON.parse(readFileSync(new URL('raw-export-pcx.json', here)));
const C = Object.fromEntries(raw.cols.map((c, i) => [c.replace(/\[.*$/, ''), i]));
const rows = raw.rows.map((r) => Object.fromEntries(Object.entries(C).map(([k, i]) => [k, r[i]])));
const byKey = new Map(rows.map((r) => [r.key, r]));
const epics = rows.filter((r) => r.type === 'Epic' && r.rank != null).sort((a, b) => a.rank - b.rank);
const rootOf = (r) => { let cur = r; while (cur && cur.parent) cur = byKey.get(cur.parent); return cur; };
const ds = {
  today: raw.today, storyTotals: true,
  config: {
    levels: [{ key: 'story', name: 'Story', role: 'estimate', issueTypeIds: ['S'] }, { key: 'subtask', name: 'Sub-task', role: 'tiny', issueTypeIds: ['T'] }],
    tshirtSizes: [{ key: 'XS', hours: 40 }, { key: 'S', hours: 80 }, { key: 'M', hours: 160 }, { key: 'L', hours: 320 }, { key: 'XL', hours: 640 }],
    matrix: { portfolio: { owner: 'optional', dueDate: 'optional', tshirt: 'required', targetQuarters: 'required', team: 'required' }, story: { team: 'required', originalEstimate: 'required', startDate: 'required', dueDate: 'required' }, subtask: {} },
    dependencies: { linkTypeIds: [] }, rules: { distribution: 'linear', forecastThresholdPct: 10 },
  },
  portfolio: epics.map((e) => ({ ref: `issue:${e.id}`, rank: e.rank, kind: 'issue', id: e.id, key: e.key, name: e.key, statusCat: e.cat, due: e.due, start: e.start, tshirt: e.tshirt, quarters: e.quarters ? e.quarters.split(',') : [], leadTeam: e.team ? { id: e.team, name: e.team } : null, owner: { id: 'P1', name: 'P1' } })),
  issues: rows.filter((r) => r.type !== 'Epic').map((r) => ({
    id: r.id, key: r.key, summary: r.key, role: r.type === 'Story' ? 'estimate' : 'tiny', levelKey: r.type === 'Story' ? 'story' : 'subtask', type: { id: r.type === 'Story' ? 'S' : 'T', name: r.type },
    parentId: byKey.get(r.parent)?.id || null, rootRef: `issue:${rootOf(r).id}`, status: { name: r.status, cat: r.cat }, team: r.team ? { id: r.team, name: r.team } : null,
    assignee: r.assignee ? { id: r.assignee, name: r.assignee } : null, start: r.start, due: r.due, oe: r.aoe || 0, re: r.are || 0, ts: r.ats || 0,
    worklogs: (r.worklogs || []).map(([a, d, h]) => ({ a, d, h })), links: [], quarters: [], fixVersionIds: [],
  })),
  teams: [...new Set(rows.map((r) => r.team).filter(Boolean))].map((id) => ({ id, name: id })),
  capacity: { people: {}, teams: {}, absences: [] },
};
const c = computeAll(ds);
const fmt = { pct: (v) => (v == null ? '–' : `${Math.round(v * 100)} %`), signedPct: (v) => `${Math.round(v * 100)} %`, h: (v) => `${Math.round(v)} h`, n: (v) => String(v), date: (d) => d, quarter: (q) => q, week: (w) => w };
const out = {};
for (const e of epics) {
  const ref = `issue:${e.id}`, m = c.metrics.get(ref);
  const k = Object.fromEntries(projectKpis({ computed: c, ref, lang: 'en', fmt }).map((x) => [x.id, x]));
  const dq = /\((\d+) \+ (\d+)\) ÷ \((\d+) \+ (\d+)\)/.exec(k.dataQuality.calc);
  out[e.key] = { stories: m.storyCount, OE: m.OE, TS: m.TS, RE: m.RE, forecast: m.forecast, forecastDev: m.OE > 0 ? m.forecast / m.OE - 1 : null, tshirt: m.tshirtTotal, openTshirt: m.openTshirt, lapsed: m.expired,
    reife: m.maturity, progress: m.TS + m.RE + m.openTshirt > 0 ? m.progress : null, dqComplete: dq ? +dq[1] + +dq[2] : null, dqTotal: dq ? +dq[3] + +dq[4] : null, dq: k.dataQuality.value, pastDue: m.overdueCount };
}
const oct = estimateVsSpent(c.model, dayIdx('2026-10-01'), dayIdx('2026-10-31')), nov = estimateVsSpent(c.model, dayIdx('2026-11-01'), dayIdx('2026-11-04'));
out.booked = Object.fromEntries([...new Set([...oct.persons, ...nov.persons].map((p) => p.id))].map((id) => [id, { oct: oct.persons.find((p) => p.id === id)?.logged || 0, nov1to4: nov.persons.find((p) => p.id === id)?.logged || 0 }]));
writeFileSync(new URL('engine-values.json', here), JSON.stringify(out, null, 2));
console.log('engine values written');

// Compare with the independent workbook
const indepFile = new URL('independent-values.json', here);
if (existsSync(indepFile)) {
  const ind = JSON.parse(readFileSync(indepFile));
  const lines = [];
  let diffs = 0, total = 0;
  for (const key of Object.keys(out).filter((x) => x !== 'booked')) {
    for (const f of Object.keys(out[key])) {
      const a = out[key][f], b = ind[key]?.[f];
      const SIZE = { XS: 40, S: 80, M: 160, L: 320, XL: 640 };
      const num = (v) => (f === 'tshirt' ? (v == null ? 0 : SIZE[v] ?? Number(v)) : v == null || v === '–' || v === '' ? null : Number(v)); // the workbook keeps the size label
      const x = num(a), y = num(b);
      const tol = ['reife', 'progress', 'dq', 'forecastDev'].includes(f) ? 0.005 : 0.05;
      const same = (x == null && y == null) || (x != null && y != null && Math.abs(x - y) <= tol);
      total++;
      if (!same) { diffs++; lines.push(`${key} ${f}: engine ${a} · workbook ${b}`); }
    }
  }
  for (const p of Object.keys(out.booked)) for (const f of ['oct', 'nov1to4']) { total++; const a = out.booked[p][f], b = ind.booked?.[p]?.[f]; if (Math.abs((a || 0) - (b || 0)) > 0.05) { diffs++; lines.push(`booked ${p} ${f}: engine ${a} · workbook ${b}`); } }
  writeFileSync(new URL('reconciliation.txt', here), `${total - diffs} of ${total} values agree\n${lines.join('\n')}\n`);
  console.log(`${total - diffs} of ${total} values agree`);
  if (lines.length) console.log(lines.join('\n'));
}
