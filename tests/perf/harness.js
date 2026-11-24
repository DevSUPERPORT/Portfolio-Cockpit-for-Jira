// Performance harness: times the cockpit's hot paths on the customer-sized datasets of tools/bigDataset.js (S/M/L) and
// prints p50 / p95 / heap. Used by tests/perf/perf.test.js (npm run perf) and the fast S smoke (tests/perfSmoke.test.js).
import { bigDataset, bigHistory, summarize, SIZES } from '../../tools/bigDataset.js';
import { computeAll } from '../../shared/engine.js';
import { buildBoard } from '../../shared/weekPlan.js';
import { optimizeAll } from '../../shared/optimize.js';
import { realisticCapacity } from '../../shared/insights.js';
import { ask, briefing, run, validStory } from '../../shared/lotse/index.js';
import { routeAct } from '../../shared/lotse/act/route.js';
import { packResult, unpackResult } from '../../static/cockpit/src/lib/computeWorker.js';

// Budgets we aim for (ms). interaction < 100 ms, panel open < 300 ms, board < 1 s on L (product goals 2026-11-12).
export const BUDGETS = {
  'computeAll': { kind: 'load', ms: { S: 300, M: 1000, L: 2000 } },
  'buildBoard team': { kind: 'board', ms: { S: 300, M: 500, L: 1000 } },
  'buildBoard all': { kind: 'board', ms: { S: 300, M: 500, L: 1000 } },
  'optimizeAll team': { kind: 'action', ms: { S: 300, M: 1000, L: 1000 } },
  'optimizeAll all': { kind: 'action', ms: { S: 500, M: 1000, L: 2000 } },
  'realisticCapacity': { kind: 'panel', ms: { S: 300, M: 300, L: 300 } },
  'lotse ask cold': { kind: 'panel', ms: { S: 300, M: 300, L: 300 } },
  'lotse ask warm (20 q)': { kind: 'interaction', ms: { S: 100, M: 100, L: 100 } },
  'lotse briefing': { kind: 'panel', ms: { S: 300, M: 300, L: 300 } },
  'lotse whatIf': { kind: 'panel', ms: { S: 300, M: 300, L: 300 } },
  // the browser path (static/cockpit/src/lib/computeWorker.js): the worker ships the result with realistic capacity and
  // the support topics; the main thread assembles it in steps (each step must stay under 50 ms) and Lotse answers first
  'worker pack (in worker)': { kind: 'load', ms: { S: 300, M: 1000, L: 1500 } },
  'main assemble total': { kind: 'load', ms: { S: 300, M: 500, L: 1000 } },
  'main assemble max step': { kind: 'interaction', ms: { S: 50, M: 50, L: 50 } },
  'lotse ask first (after worker)': { kind: 'panel', ms: { S: 300, M: 300, L: 300 } },
  // the same first question in the other language than the worker computed (realistic capacity / topics re-worded)
  'lotse ask other language (after worker)': { kind: 'panel', ms: { S: 300, M: 300, L: 300 } },
  // "new data": a new computeAll result per run (nothing of this data state is cached yet – the worst case of a panel open
  // without the worker's head start); the plain rows above use a new computed object of the same data state
  'realisticCapacity (new data)': { kind: 'panel', ms: { S: 300, M: 300, L: 300 } },
  'lotse ask cold (new data)': { kind: 'panel', ms: { S: 300, M: 300, L: 300 } },
  'lotse briefing (new data)': { kind: 'panel', ms: { S: 300, M: 300, L: 300 } },
  // every keystroke of the search and every ask goes through the act router (commands in plain language)
  'lotse act route (23 q)': { kind: 'interaction', ms: { S: 50, M: 50, L: 50 } },
};
const COMMANDS = (ds) => [`Gib allen Stories ohne Team in ${[...ds.portfolio].sort((a, b) => a.rank - b.rank)[0].name} das Team ${ds.teams[0].name}`, `verschiebe alles von ${Object.values(ds.people)[3].name} in KW 48 eine Woche später`, 'set the estimate of all stories without estimate to 8 h'];

// 20 typical questions across the personas (DE), as people type them into the Lotse panel
export const TYPICAL = ['Was ist heute wichtig?', 'Lagebild Portfolio', 'Ab welchem Rang reicht die Kapazität nicht?', 'Wer macht bald Überstunden?', 'Wie viel Kapazität bleibt nach Support?',
  'Was passt ohne Überstunden?', 'Was ist blockiert?', 'Wo fehlen Daten?', 'Wer soll die neuen Tickets bekommen?', 'Welche Support-Themen kommen immer wieder?', 'Meine Woche',
  'Planungsvorschläge', '{P0}', 'Lagebild {P1}', 'Was blockiert {P2}?', 'Wie geht es Team {T0}?', 'Überstunden Team {T1}', 'Vergleiche Team {T0} mit Team {T1}', 'Health-Entwurf für {P0}', 'Schätze wie früher: Export der Rechnungen als PDF'];

const gc = () => { if (typeof globalThis.gc === 'function') { globalThis.gc(); globalThis.gc(); } };
const heapMB = () => process.memoryUsage().heapUsed / 1048576;
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// fn(i) is called `runs` times after `warmup` calls; prepare(i) (not timed) builds the input of run i.
export function measure(label, fn, { runs = 3, warmup = 0, prepare = null } = {}) {
  const times = [];
  let heap = 0, out;
  for (let i = 0; i < warmup + runs; i++) {
    const input = prepare ? prepare(i) : undefined;
    gc();
    const h0 = heapMB();
    const t0 = performance.now();
    out = fn(input, i);
    const ms = performance.now() - t0;
    if (i >= warmup) { times.push(ms); heap = Math.max(heap, heapMB() - h0); }
  }
  return { label, runs: times.length, p50: q(times, 0.5), p95: q(times, 0.95), min: Math.min(...times), max: Math.max(...times), heapMB: heap, out };
}

export function contextFor(ds, computed) {
  const me = ds.people.u1 ? { id: 'u1', name: ds.people.u1.name } : null;
  return { ds, computed, lang: 'de', me, roles: { admin: true, viewReport: true, manageRanking: true, editCapacity: true, dispatch: true, editPlan: true, rights: ['mine', 'portfolio', 'projects', 'teams', 'plan', 'hours', 'support', 'report'] },
    history: bigHistory(ds), planActual: null, now: Date.parse(`${ds.today}T10:00:00Z`) };
}
export function typicalQuestions(ds) {
  const items = [...ds.portfolio].sort((a, b) => a.rank - b.rank);
  const teams = ds.teams;
  return TYPICAL.map((t) => t.replace('{P0}', items[0].name).replace('{P1}', items[1].name).replace('{P2}', items[2].name).replace('{T0}', teams[0].name).replace('{T1}', teams[1].name));
}
// the biggest team: the realistic worst case for a team board
const biggestTeam = (ds) => { const c = new Map(); for (const i of ds.issues) if (i.team) c.set(i.team.id, (c.get(i.team.id) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0][0]; };

// The whole suite for one size. `runs` per size; `ops` to restrict (smoke).
export function perfSuite(size, { runs = SIZES[size] ? { S: 5, M: 3, L: 2 }[size] : 3, ops = null, log = () => {} } = {}) {
  const want = (k) => !ops || ops.includes(k);
  const rows = [];
  gc();
  const h0 = heapMB();
  const g = measure('generate dataset', () => bigDataset(size), { runs: 1 });
  const ds = g.out;
  gc();
  const dsHeap = heapMB() - h0;
  const info = summarize(ds);
  log(`[${size}] ${info.workItems} work items, ${info.projects} projects, ${info.teams} teams, ${info.people} people, ${info.tickets} tickets – generated in ${Math.round(g.p50)} ms, ~${Math.round(dsHeap)} MB heap`);
  const push = (r) => { rows.push({ size, ...r, out: undefined, budget: BUDGETS[r.label]?.ms[size] ?? null, kind: BUDGETS[r.label]?.kind || '' }); log(`[${size}] ${r.label}: p50 ${r.p50.toFixed(0)} ms, p95 ${r.p95.toFixed(0)} ms`); };

  const ca = measure('computeAll', () => computeAll(ds), { runs, warmup: 1 });
  push(ca);
  const computed = ca.out;
  const team = biggestTeam(ds);
  if (want('buildBoard team')) push(measure('buildBoard team', () => buildBoard({ ds, computed, team }), { runs, warmup: 1 }));
  if (want('buildBoard all')) push(measure('buildBoard all', () => buildBoard({ ds, computed }), { runs, warmup: 1 }));
  if (want('optimizeAll team')) push(measure('optimizeAll team', () => optimizeAll({ ds, computed, team }), { runs: Math.min(runs, 2), warmup: size === 'L' ? 0 : 1 }));
  if (want('optimizeAll all')) push(measure('optimizeAll all', () => optimizeAll({ ds, computed }), { runs: Math.min(runs, 2), warmup: 0 }));
  const ctx = contextFor(ds, computed);
  // a new computed object per run (realistic capacity is kept per computed result; the per-model parts stay)
  if (want('realisticCapacity')) push(measure('realisticCapacity', (c) => realisticCapacity(c, { weeks: 12, history: ctx.history }), { runs, warmup: 1, prepare: () => ({ ...computed }) }));
  const newData = () => ({ ...ctx, computed: computeAll(ds) });
  if (want('realisticCapacity (new data)')) push(measure('realisticCapacity (new data)', (c) => realisticCapacity(c.computed, { weeks: 12, history: c.history }), { runs: Math.min(runs, 2), prepare: newData }));
  // cold = a fresh `computed` object: Lotse's per-dataset memo (realistic capacity, overtime) starts empty, as on panel open
  const cold = () => ({ ...ctx, computed: { ...computed } });
  const qs = typicalQuestions(ds);
  let stories = [];
  if (want('lotse ask cold')) push(measure('lotse ask cold', (c) => ask(qs[0], c), { runs, prepare: cold }));
  if (want('lotse ask cold (new data)')) push(measure('lotse ask cold (new data)', (c) => ask(qs[0], c), { runs: Math.min(runs, 2), prepare: newData }));
  if (want('lotse ask warm (20 q)')) {
    const warm = cold();
    for (const x of qs) ask(x, warm); // fill the memo once
    const times = [];
    for (let r = 0; r < runs; r++) for (const x of qs) { const t0 = performance.now(); const s = ask(x, warm); times.push(performance.now() - t0); if (r === 0) stories.push(s); }
    const slow = qs.map((x, i) => [x, Math.max(...times.filter((_, k) => k % qs.length === i))]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    push({ label: 'lotse ask warm (20 q)', runs: times.length, p50: q(times, 0.5), p95: q(times, 0.95), min: Math.min(...times), max: Math.max(...times), heapMB: 0, slowest: slow.map(([x, ms]) => `${x} ${Math.round(ms)} ms`) });
  }
  if (want('lotse ask first (after worker)')) {
    const pk = measure('worker pack (in worker)', () => packResult(computed, { ds, lang: 'de' }).map((m) => structuredClone(m)), { runs: 1 });
    push(pk);
    const steps = [];
    const asm = measure('main assemble total', () => { const g = unpackResult(ds, pk.out); let t = performance.now(), r = g.next(); while (!r.done) { const n = performance.now(); steps.push(n - t); t = n; r = g.next(); } steps.push(performance.now() - t); return r.value; }, { runs: 1 });
    push(asm);
    push({ label: 'main assemble max step', runs: steps.length, p50: q(steps, 0.5), p95: Math.max(...steps), min: Math.min(...steps), max: Math.max(...steps), heapMB: 0 });
    const fresh = () => ({ ...ctx, history: null, computed: (() => { const g = unpackResult(ds, pk.out); let r = g.next(); while (!r.done) r = g.next(); return r.value; })() });
    push(measure('lotse ask first (after worker)', (c) => ask(qs[0], c), { runs, prepare: fresh }));
    // the worker computed in English; the question comes in German
    const pkEn = packResult(computed, { ds, lang: 'en' }).map((m) => structuredClone(m));
    const freshEn = () => ({ ...ctx, history: null, lang: 'de', computed: (() => { const g = unpackResult(ds, pkEn); let r = g.next(); while (!r.done) r = g.next(); return r.value; })() });
    push(measure('lotse ask other language (after worker)', (c) => ask(qs[0], c), { runs, prepare: freshEn }));
  }
  if (want('lotse briefing')) push(measure('lotse briefing', (c) => briefing(c, 'management'), { runs, prepare: cold }));
  if (want('lotse briefing (new data)')) push(measure('lotse briefing (new data)', (c) => briefing(c, 'management'), { runs: Math.min(runs, 2), prepare: newData }));
  if (want('lotse act route (23 q)')) {
    const c = cold();
    const all = [...qs, ...COMMANDS(ds)];
    for (const x of all) routeAct(x, c); // indexes once per data state
    const times = [];
    for (let r = 0; r < runs; r++) for (const x of all) { const t0 = performance.now(); routeAct(x, c); times.push(performance.now() - t0); }
    push({ label: 'lotse act route (23 q)', runs: times.length, p50: q(times, 0.5), p95: q(times, 0.95), min: Math.min(...times), max: Math.max(...times), heapMB: 0 });
  }
  if (want('lotse whatIf')) {
    const items = [...ds.portfolio].sort((a, b) => a.rank - b.rank);
    const mid = items[Math.floor(items.length / 2)];
    push(measure('lotse whatIf', (c) => run('whatIf', { change: { kind: 'rank', ref: mid.ref, toRank: 1 } }, c), { runs, prepare: cold }));
  }
  return { size, info: { ...info, generateMs: g.p50, datasetHeapMB: dsHeap }, rows, stories, invalid: stories.filter((s) => { try { validStory(s); return false; } catch { return true; } }).map((s) => s.skill) };
}

export function perfTable(results) {
  const L = ['| size | operation | p50 ms | p95 ms | heap Δ MB | budget ms | status |', '|---|---|---:|---:|---:|---:|---|'];
  for (const r of results.flatMap((x) => x.rows)) {
    const st = r.budget == null ? '' : r.p95 <= r.budget ? 'ok' : r.p50 <= r.budget ? 'p95 over' : `**${(r.p50 / r.budget).toFixed(1)}× over**`;
    L.push(`| ${r.size} | ${r.label} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.heapMB ? r.heapMB.toFixed(0) : '–'} | ${r.budget ?? '–'} | ${st} |`);
  }
  return L.join('\n');
}
