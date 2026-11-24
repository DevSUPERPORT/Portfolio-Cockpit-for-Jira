// computeAll off the main thread for customer-sized datasets (Web Worker), with the main thread never blocked for
// long: the dataset goes to the worker in slices, the worker computes everything (plus what Lotse's first answer needs:
// realistic capacity, the overtime outlook, the support topics) and ships it back in slices; the main thread builds
// the model from its own dataset objects between frames and puts the rows back together. The result is the same
// object computeAll(ds) returns (tests/lotseComputeWorker.test.js compares the two).
//
// This one file is both sides: the worker entry (bottom, runs only inside a worker) and the client (createComputeClient).
// Pure helpers (packResult / unpackResult / dsSlices) are exported for the Node test.
import { computeAll, buildModelSteps } from '../../../../shared/engine.js';
import { ROW_TICKET } from '../../../../shared/sla.js';
import { realisticCapacity, overtimeOutlook, supportTopics, seedSupportTopics, capacityRooms, seedRealisticCapacity } from '../../../../shared/insights.js';
import { ticketsOf } from '../../../../shared/ask.js';
import { seedMemo } from '../../../../shared/lotse/kit.js';

// From this many work items on, the browser computes in the worker (below it, computeAll takes < 0.3 s in place).
export const WORKER_MIN_ITEMS = 6000;
const SLICE = 1000; // result array items per message (the worker clones, the main thread only reads them)
const DS_SLICE = 250; // dataset items per message: the main thread clones these (≈ 10–20 ms per slice of work items)
const SLICE_BUDGET_MS = 12; // main-thread work per task before yielding to input and paint

// ---------- dataset → messages ----------
// Only the top-level keys whose value changed since the last send (an edit replaces `portfolio`, not `issues`).
export function dsSlices(ds, sent = new Map()) {
  const out = [];
  for (const key of Object.keys(ds)) {
    const v = ds[key];
    if (sent.has(key) && sent.get(key) === v) continue;
    if (Array.isArray(v) && v.length > DS_SLICE) {
      const n = Math.ceil(v.length / DS_SLICE);
      for (let i = 0; i < n; i++) out.push({ t: 'part', key, i, n, items: v.slice(i * DS_SLICE, (i + 1) * DS_SLICE) });
    } else if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).some((x) => Array.isArray(x) && x.length > DS_SLICE)) {
      // one level down (supportTickets.tickets): the object without its big arrays, then the arrays in slices
      const shell = {};
      for (const [k2, x] of Object.entries(v)) shell[k2] = Array.isArray(x) && x.length > DS_SLICE ? [] : x; // same key order
      out.push({ t: 'put', key, value: shell });
      for (const [k2, x] of Object.entries(v)) {
        if (!(Array.isArray(x) && x.length > DS_SLICE)) continue;
        const n = Math.ceil(x.length / DS_SLICE);
        for (let i = 0; i < n; i++) out.push({ t: 'part', key, sub: k2, i, n, items: x.slice(i * DS_SLICE, (i + 1) * DS_SLICE) });
      }
    } else out.push({ t: 'put', key, value: v });
  }
  for (const key of sent.keys()) if (!(key in ds)) out.push({ t: 'drop', key });
  return out;
}
// The worker's copy of the dataset, from those messages.
export function dsReceiver() {
  const ds = {}, parts = new Map();
  return {
    ds,
    take(m) {
      if (m.t === 'put') ds[m.key] = m.value;
      else if (m.t === 'drop') delete ds[m.key];
      else if (m.t === 'part') {
        const pk = m.sub ? `${m.key}.${m.sub}` : m.key;
        const p = m.i === 0 ? [] : parts.get(pk) || [];
        for (const x of m.items) p.push(x);
        if (m.i !== m.n - 1) { parts.set(pk, p); return; }
        parts.delete(pk);
        if (m.sub) ds[m.key][m.sub] = p; else ds[m.key] = p;
      }
    },
  };
}

// ---------- result → messages (in the worker) ----------
// Everything but the model (the main thread builds that from its own objects), large arrays in slices, support rows
// as per-ticket SLA + project and the row / queue order (the rows are copies of the main thread's tickets).
export function packResult(computed, { ds, lang = 'de', lotse = true } = {}) {
  const { model, supportA, dq, ...rest } = computed; // eslint-disable-line no-unused-vars
  const big = {};
  const slice = (name, arr) => { big[name] = arr; return { $slices: name, length: arr.length }; };
  let sa = null;
  if (supportA) {
    const { rows, queue, ...agg } = supportA;
    const n = rows.length;
    const sla = new Array(n), project = new Array(n);
    for (const r of rows) { const i = ROW_TICKET.get(r); sla[i] = r.sla; project[i] = r.project; }
    sa = { ...agg, rowOrder: rows.map((r) => ROW_TICKET.get(r)), queueOrder: queue.map((r) => ROW_TICKET.get(r)), sla: slice('sla', sla), project: slice('project', project) };
  }
  const head = { ...rest, supportA: sa, dq: dq ? { ...dq, gaps: slice('gaps', dq.gaps) } : dq };
  // what Lotse's first answer needs (kit.js memo keys of a context without history / plan vs. actual)
  if (lotse) {
    const rc = realisticCapacity(computed, { weeks: 12, history: null, planActual: null, lang });
    const tickets = ticketsOf({ ds });
    // rooms: the unrounded realistic rooms, so the main thread can write the other language's sentences exactly
    head.lotse = { lang, rc, rooms: capacityRooms(rc), oo: overtimeOutlook(rc, { lang }), st: tickets.length ? supportTopics(tickets, { minCount: 3, lang, today: ds.today }) : null };
  }
  // the head without Lotse's part (it travels in its own messages: one clone each stays short on the main thread)
  const { lotse: lp, ...headOnly } = head;
  const msgs = [{ t: 'head', head: headOnly }];
  if (lp) {
    const { people, teams, ...rcRest } = lp.rc;
    msgs.push({ t: 'lotse', part: 'meta', value: { lang: lp.lang, rc: rcRest, rooms: lp.rooms } }, { t: 'lotse', part: 'teams', value: teams }, { t: 'lotse', part: 'oo', value: lp.oo }, { t: 'lotse', part: 'st', value: lp.st });
    for (let i = 0; i < people.length; i += 100) msgs.push({ t: 'lotse', part: 'people', i: i / 100, value: people.slice(i, i + 100) });
  }
  for (const [name, arr] of Object.entries(big)) {
    const n = Math.max(1, Math.ceil(arr.length / SLICE));
    for (let i = 0; i < n; i++) msgs.push({ t: 'slice', name, i, n, items: arr.slice(i * SLICE, (i + 1) * SLICE) });
  }
  msgs.push({ t: 'end' });
  return msgs;
}

// ---------- messages → computed (main thread, in steps) ----------
// A generator: yields between pieces of work; its return value is the computed object (as computeAll(ds) returns it).
export function* unpackResult(ds, msgs, { every = 1000 } = {}) {
  const head = msgs.find((m) => m.t === 'head').head;
  const slices = new Map();
  for (const m of msgs) if (m.t === 'slice') (slices.get(m.name) || slices.set(m.name, []).get(m.name))[m.i] = m.items;
  const whole = (ref) => { const arr = []; for (const part of slices.get(ref.$slices) || []) for (const x of part) arr.push(x); return arr; };
  const steps = buildModelSteps(ds, every);
  let r = steps.next();
  while (!r.done) { yield 'model'; r = steps.next(); }
  const model = r.value;
  let supportA = null;
  if (head.supportA) {
    const { rowOrder, queueOrder, sla: slaRef, project: projRef, ...agg } = head.supportA;
    const tickets = ds.supportTickets?.tickets || [];
    const sla = whole(slaRef), project = whole(projRef);
    const rowOf = new Array(tickets.length);
    for (let i = 0; i < tickets.length; i++) {
      rowOf[i] = { ...tickets[i], sla: sla[i], project: project[i] };
      if (i % every === every - 1) yield 'rows';
    }
    supportA = { ...agg, rows: rowOrder.map((i) => rowOf[i]), queue: queueOrder.map((i) => rowOf[i]) };
  }
  const { dq, ...rest } = head;
  // Lotse's part (packResult splits it): realistic capacity in its original key order
  let lotse = null;
  const lm = msgs.filter((m) => m.t === 'lotse');
  if (lm.length) {
    const part = (k) => lm.find((m) => m.part === k)?.value;
    const meta = part('meta');
    const people = lm.filter((m) => m.part === 'people').sort((a, b) => a.i - b.i).flatMap((m) => m.value);
    const { asOf, lang, weeks, ...after } = meta.rc;
    lotse = { lang: meta.lang, rc: { asOf, lang, weeks, teams: part('teams'), people, ...after }, rooms: meta.rooms || null, oo: part('oo'), st: part('st') };
  }
  // the same key order as computeAll's result
  const computed = { model, support: rest.support, supportA, supportSum: rest.supportSum, metrics: rest.metrics, wl: rest.wl, deps: rest.deps, dq: dq ? { ...dq, gaps: whole(dq.gaps) } : dq, weeks: rest.weeks, milestones: rest.milestones };
  if (lotse) {
    seedMemo(computed, `rc:${lotse.lang}|-|-`, lotse.rc);
    seedRealisticCapacity(computed, { weeks: 12, history: null, planActual: null, lang: lotse.lang }, lotse.rc, lotse.rooms);
    seedMemo(computed, `oo:${lotse.lang}|-|-`, lotse.oo);
    if (lotse.st) seedSupportTopics(ticketsOf({ ds }), { minCount: 3, lang: lotse.lang, today: ds.today }, lotse.st);
  }
  return computed;
}

// ---------- client (main thread) ----------
// Runs `gen` in slices of SLICE_BUDGET_MS, yielding to the browser in between (a macrotask, so input and paint go first).
const nextTask = () => new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); });
async function drive(gen, alive) {
  let t0 = performance.now();
  let r = gen.next();
  while (!r.done) {
    if (!alive()) return null;
    if (performance.now() - t0 > SLICE_BUDGET_MS) { await nextTask(); t0 = performance.now(); }
    r = gen.next();
  }
  return r.value;
}

export const workerSupported = () => typeof Worker !== 'undefined' && typeof MessageChannel !== 'undefined';

// compute(ds, lang) → Promise<computed | null> (null when a newer compute overtook it). onState({ phase, ms }).
export function createComputeClient({ onState = () => {} } = {}) {
  const worker = new Worker(new URL('./computeWorker.js', import.meta.url), { type: 'module' });
  const sent = new Map();
  let run = 0;
  const waiting = new Map(); // run id → { msgs, resolve, reject }
  worker.onmessage = (e) => {
    const m = e.data;
    const w = waiting.get(m.id);
    if (!w) return;
    if (m.t === 'error') { waiting.delete(m.id); w.reject(Object.assign(new Error(m.message), { code: 'COMPUTE_WORKER' })); return; }
    w.msgs.push(m);
    if (m.t === 'end') { waiting.delete(m.id); w.resolve(w.msgs); }
  };
  worker.onerror = (e) => { for (const [id, w] of waiting) { waiting.delete(id); w.reject(Object.assign(new Error(e.message || 'worker failed'), { code: 'COMPUTE_WORKER' })); } };

  async function compute(ds, lang = 'de') {
    const id = ++run;
    const alive = () => id === run;
    const t0 = performance.now();
    onState({ phase: 'send', id });
    // the changed keys of the dataset, a few slices per task
    let tt = performance.now();
    for (const m of dsSlices(ds, sent)) {
      if (!alive()) return null;
      worker.postMessage(m);
      if (performance.now() - tt > SLICE_BUDGET_MS) { await nextTask(); tt = performance.now(); }
    }
    for (const k of [...sent.keys()]) if (!(k in ds)) sent.delete(k);
    for (const k of Object.keys(ds)) sent.set(k, ds[k]);
    if (!alive()) return null;
    const result = new Promise((resolve, reject) => waiting.set(id, { msgs: [], resolve, reject }));
    worker.postMessage({ t: 'run', id, lang });
    onState({ phase: 'compute', id });
    const msgs = await result;
    if (!alive()) return null;
    onState({ phase: 'assemble', id });
    const computed = await drive(unpackResult(ds, msgs), alive);
    if (computed) onState({ phase: 'done', id, ms: Math.round(performance.now() - t0), workerMs: msgs.find((m) => m.t === 'head')?.ms });
    return computed;
  }
  return { compute, terminate: () => worker.terminate() };
}

// ---------- worker entry ----------
const inWorker = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope; // eslint-disable-line no-undef
if (inWorker) {
  const rx = dsReceiver();
  self.onmessage = (e) => {
    const m = e.data;
    if (m.t !== 'run') { rx.take(m); return; }
    try {
      const t0 = performance.now();
      const computed = computeAll(rx.ds);
      const msgs = packResult(computed, { ds: rx.ds, lang: m.lang });
      msgs[0].ms = Math.round(performance.now() - t0);
      for (const x of msgs) self.postMessage({ ...x, id: m.id });
    } catch (err) {
      self.postMessage({ t: 'error', id: m.id, message: String(err?.message || err) });
    }
  };
}
