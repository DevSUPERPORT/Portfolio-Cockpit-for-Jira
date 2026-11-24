// Result fingerprints: a stable hash of every hot path's OUTPUT on the big datasets (tools/bigDataset.js), so a speed-up
// can prove it changed nothing. Recorded once before the performance work (tests/perf/fingerprints.json); the test
// tests/perfResults.test.js recomputes S (and M with PERF_RESULTS=M) and compares.
//
// Serialization: Maps / Sets / objects with sorted keys, arrays in order, numbers to 10 significant digits (summation
// order may differ in the last bit), functions and keys starting with "_" (caches) skipped, cycles cut.
import { createHash } from 'node:crypto';
import { bigDataset } from '../../tools/bigDataset.js';
import { computeAll } from '../../shared/engine.js';
import { buildBoard } from '../../shared/weekPlan.js';
import { optimizeAll } from '../../shared/optimize.js';
import { realisticCapacity } from '../../shared/insights.js';
import { ask, briefing, run } from '../../shared/lotse/index.js';
import { contextFor, typicalQuestions } from './harness.js';

export function digest(value) {
  const h = createHash('sha1');
  const stack = new Set();
  const put = (s) => h.update(s);
  const walk = (v) => {
    if (v === null || v === undefined) return put(String(v));
    const t = typeof v;
    if (t === 'number') return put(Number.isFinite(v) ? String(Number(v.toPrecision(10))) : String(v));
    if (t === 'string') return put(JSON.stringify(v));
    if (t === 'boolean' || t === 'bigint') return put(String(v));
    if (t === 'function' || t === 'symbol') return put('ƒ');
    if (stack.has(v)) return put('↺');
    stack.add(v);
    if (Array.isArray(v) || ArrayBuffer.isView(v)) { put('['); for (const x of v) { walk(x); put(','); } put(']'); }
    else if (v instanceof Map) { put('M{'); for (const k of [...v.keys()].sort(cmp)) { walk(k); put(':'); walk(v.get(k)); put(','); } put('}'); }
    else if (v instanceof Set) { put('S['); for (const k of [...v].map(key).sort()) { put(k); put(','); } put(']'); }
    else if (v instanceof Date) put(v.toISOString());
    else { put('{'); for (const k of Object.keys(v).filter((k) => !k.startsWith('_')).sort()) { if (typeof v[k] === 'function') continue; put(JSON.stringify(k)); put(':'); walk(v[k]); put(','); } put('}'); }
    stack.delete(v);
  };
  const key = (x) => (x && typeof x === 'object' ? JSON.stringify(x.id ?? x.ref ?? x.key ?? '') : String(x));
  const cmp = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
  walk(value);
  return h.digest('hex').slice(0, 16);
}

const biggestTeam = (ds) => { const c = new Map(); for (const i of ds.issues) if (i.team) c.set(i.team.id, (c.get(i.team.id) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0][0]; };

// Every output a user sees from the hot paths: computeAll, the boards, the optimizer, realistic capacity, Lotse.
// Date.now is pinned to the dataset's "today" 10:00 UTC while it runs (open tickets' SLA clocks run on the wall clock).
export function fingerprints(size, { optimizer = true, log = () => {} } = {}) {
  const ds = bigDataset(size);
  const realNow = Date.now;
  Date.now = () => Date.parse(`${ds.today}T10:00:00Z`);
  try { return prints(ds, size, optimizer, log); } finally { Date.now = realNow; }
}
function prints(ds, size, optimizer, log) {
  const out = {};
  const t = (label, fn) => { const t0 = performance.now(); const v = fn(); out[label] = digest(v); log(`${size} ${label} ${Math.round(performance.now() - t0)} ms ${out[label]}`); return v; };
  const computed = t('computeAll', () => computeAll(ds));
  for (const k of ['model', 'support', 'supportA', 'supportSum', 'metrics', 'wl', 'deps', 'dq', 'weeks', 'milestones']) out[`computeAll.${k}`] = digest(computed[k]);
  const team = biggestTeam(ds);
  t('buildBoard team', () => buildBoard({ ds, computed, team }));
  t('buildBoard all', () => buildBoard({ ds, computed }));
  if (optimizer) t('optimizeAll team', () => optimizeAll({ ds, computed, team }));
  const ctx = contextFor(ds, computed);
  t('realisticCapacity', () => realisticCapacity(computed, { weeks: 12, history: ctx.history }));
  const fresh = () => ({ ...ctx, computed: { ...computed } });
  const c1 = fresh();
  t('lotse answers', () => typicalQuestions(ds).map((q) => ask(q, c1)));
  t('lotse answers again', () => typicalQuestions(ds).map((q) => ask(q, c1)));
  t('lotse briefing', () => briefing(fresh(), 'management'));
  const items = [...ds.portfolio].sort((a, b) => a.rank - b.rank);
  t('lotse whatIf', () => run('whatIf', { change: { kind: 'rank', ref: items[Math.floor(items.length / 2)].ref, toRank: 1 } }, fresh()));
  return out;
}
