// Wochenplanung › "Optimieren": three calm helpers over the weekly plan. Pure – no React, no Forge.
// The board (components/PlanOptimizer.jsx) shows the suggestions; accepting them only records the board's normal
// pending moves (moveTask) – nothing is written to Jira here.
//
//   smooth    ("Überlast glätten")  weeks where a person is over the target: lower-ranked tasks first (rank order
//                                    reversed) are stretched over more weeks or moved later (even share per week),
//                                    never past the project's due date / the milestone date, never into a conflict
//   rebalance ("Umverteilen")       what is still over: give a task to a colleague in the same team who has room in
//                                    every week of the task (lowest load first) – visible people only (privacy)
//   sooner    ("Schneller fertig")  room left: finish tasks sooner (rank 1 first) – keep or bring forward the start
//                                    (never before this week, never before a prerequisite's due date), find the
//                                    earliest due whose even share OE ÷ n fits every week
//
// Capacity per person and week = available hours (personWeekAvail: weekly hours − absence, holidays, daily
// business/internal) × target − support reserve − every task of that person (all teams and projects).
// The modes run in that order on one shared reservation: hours a suggestion adds are reserved, hours it frees are
// never handed to another suggestion – so ANY selection of suggestions stays within the target (pre-existing
// overload aside). Every task appears in at most one mode. Tasks with a pending move, done or unassigned tasks
// and pseudonymised people are left alone. All of a person's tasks take part (also outside the board's scope), so a
// task gets the same suggestion on every board; only the scope's are returned.
import { capacityPeople, spreadWindow, dependencies, milestoneOf } from './engine.js';
import { planWeeks, planTasks, personWeekAvail, capacityFill, applyMoves, moveTask, isAnonId, shiftDates } from './weekPlan.js';
import { isWorkday, locationsOf } from './locations.js';
import { inTeam } from './allocation.js';
import { dayIdx, isoOf, mondayOf, workdays, isWeekday } from './dates.js';

export const OPT_TARGETS = [0.85, 1];
export const OPT_MODES = ['sooner', 'smooth', 'rebalance'];
export const HORIZON_MIN = 8;
export const HORIZON_MAX = 104;
export const HORIZON_PAD = 8;
const MAX_EARLIER = 8; // how many weeks a start may come forward
const MAX_LATER = 8; // how many weeks smoothing may move or stretch a task
const SPAN_MAX = 16; // weeks shown in a row's sparkline
const EPS = 0.05;
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const toIdx = (d) => (d == null ? null : typeof d === 'number' ? d : dayIdx(d));
const isOpen = (i) => (i?.status?.cat ?? i?.statusCat ?? 'new') !== 'done';
const num = (v, lang, d = 1) => {
  const r = Math.round(v * 10 ** d) / 10 ** d;
  const s = Number.isInteger(r) ? String(r) : r.toFixed(d);
  return lang === 'de' ? s.replace('.', ',') : s;
};
const ddmm = (iso, lang = 'de') => (lang === 'de' ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : `${iso.slice(8, 10)}/${iso.slice(5, 7)}`);
const pc = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)} %` : '∞');
const wks = (n, lang) => (lang === 'de' ? (n === 1 ? 'Woche' : 'Wochen') : n === 1 ? 'week' : 'weeks');

// ---------- helpers ----------
// The weeks a window [s, e] spreads over – the same count weekShare divides by (weeks with at least one working day).
export function weeksTouched(win) {
  if (!win) return 0;
  const [s, e] = win;
  let n = 0;
  for (let m = mondayOf(s); m <= e; m += 7) if (workdays(Math.max(m, s), Math.min(m + 6, e)) > 0) n += 1;
  return n;
}
// The last / first working day of the week [a, a+6] at the person's location (holidays and company days off
// included); null when the person has no working day in that week. from: not before this day.
// The optimizer asks these for every task × candidate week: cached per locations list (an edited list is a new array,
// so it never sees stale days), location and week.
const wdCache = new WeakMap(); // locations list → Map(kind|location → Map(number → day | null))
const NO_LOCATIONS = {};
function wdMemo(cfg, kind, location, key, fn) {
  const list = locationsOf(cfg);
  const owner = list.length ? list : NO_LOCATIONS;
  const byLoc = wdCache.get(owner) || wdCache.set(owner, new Map()).get(owner);
  const lk = kind + (location || 'NONE');
  const m = byLoc.get(lk) || byLoc.set(lk, new Map()).get(lk);
  let v = m.get(key);
  if (v === undefined) { v = fn(); if (m.size > 50000) m.clear(); m.set(key, v); }
  return v;
}
export function lastWorkday(cfg, location, a) {
  return wdMemo(cfg, 'L', location, a, () => {
    for (let d = a + 6; d >= a; d--) if (isWorkday(cfg, location || 'NONE', d)) return d;
    return null;
  });
}
export function firstWorkday(cfg, location, a, from = a) {
  // a start before the week is the week's Monday, one after its Sunday finds nothing: 8 cases per week
  return wdMemo(cfg, 'F', location, a * 8 + Math.min(7, Math.max(0, from - a)), () => {
    for (let d = Math.max(a, from); d <= a + 6; d++) if (isWorkday(cfg, location || 'NONE', d)) return d;
    return null;
  });
}
// one collator for the many German name comparisons (the same order as String#localeCompare(…, 'de'))
const deColl = new Intl.Collator('de');
// the default collator: exactly String#localeCompare without arguments (the key tie-breaks in the mode sorts)
const defColl = new Intl.Collator();
// Per data state (the work items array – a new array after every reload or move), kept between calls: the board's
// panel asks twice (target and 100 %), the card menu again. Only the last horizon per array is kept.
const dataCache = new WeakMap(); // issues → { byIssue, anon, tasks: { key, list } | null }
const availCache = new WeakMap(); // model → WeakMap(configuration → Map(person|support → Map(week start → { b, v })))
const dataOf = (issues) => {
  let d = dataCache.get(issues);
  if (!d) {
    const anon = new Set();
    for (const i of issues) if (i.assignee?.anon && i.assignee.id) anon.add(i.assignee.id);
    d = { byIssue: new Map(issues.map((i) => [i.id, i])), anon, tasks: null };
    dataCache.set(issues, d);
  }
  return d;
};
// Weeks to look at: up to the latest open due date + 8 weeks (at least 8, at most 104).
export function planHorizon(issues, today) {
  const t = toIdx(today);
  let last = t;
  for (const i of issues || []) {
    if (i.role !== 'estimate' || !isOpen(i)) continue;
    const d = toIdx(i.due);
    if (d != null && d > last) last = d;
  }
  const weeks = Math.floor((mondayOf(last) - mondayOf(t)) / 7) + 1 + HORIZON_PAD;
  return Math.max(HORIZON_MIN, Math.min(HORIZON_MAX, weeks));
}
// shiftDates on day indices for a valid window (start ≤ due): both move by whole weeks, the start forward and the due
// backward to a weekday, the due never before the start – exactly the days shiftDates gives for the ISO dates.
function shiftIdx(s, e, weeks) {
  const d = Math.round(weeks) * 7;
  let a = s + d, b = e + d;
  while (!isWeekday(a)) a += 1;
  while (!isWeekday(b)) b -= 1;
  return [a, b < a ? a : b];
}
// ISO week number of a day index (for the reason texts; the UI formats its own).
function isoWeekNo(idx) {
  const d = new Date(idx * 86400000);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

// ---------- shared context ----------
function context({ ds, computed, board, team, project, moves, config, target, horizonWeeks, today, distribution }) {
  const model = computed.model;
  const cfg = config || model.cfg;
  const mcfg = { ...model, cfg };
  const scopeTeam = board ? board.team : team;
  const scopeProject = board ? board.project : project;
  const inScope = (t) => (scopeProject ? t.ref === scopeProject : scopeTeam ? t.teamId === scopeTeam : true);
  const tIdx = today == null ? model.today : toIdx(today);
  const issues = ds.issues || model.ds.issues || [];
  const eff = applyMoves(issues, moves);
  const H = horizonWeeks ? Math.max(1, Math.min(HORIZON_MAX, horizonWeeks)) : planHorizon(eff, tIdx);
  const W = planWeeks(tIdx, H);
  const weekOf = (d) => Math.floor((mondayOf(d) - W[0].a) / 7);
  const people = capacityPeople(model);
  const data = dataOf(issues);
  const byIssue = data.byIssue;
  const W0 = W[0].a, NW = W.length;
  // Hours of OE over a window in the horizon weeks: Map(week index → hours). The engine's weekShare rule (every week
  // with a working day in the window gets the same share; none → all in the due week) in one pass over the window.
  // The weeks with a working day in [s, e], as horizon week indices (may lie outside 0 … NW-1), kept per window.
  // key: a small integer (a fast Map key) for every window near the horizon, a string for anything else
  const touchedOf = new Map();
  const touchedFor = (s, e) => {
    const ks = s - W0 + 8192, ke = e - s + 1024;
    const k = ks >= 0 && ks < 16384 && ke >= 0 && ke < 32768 ? ks * 32768 + ke : `${s}|${e}`;
    let touched = touchedOf.get(k);
    if (!touched) {
      touched = [];
      // workdays(max(mo, s), min(mo + 6, e)) > 0 (weekdays, no holidays) ⇔ the week's part of the window starts by Friday
      for (let mo = mondayOf(s); mo <= e; mo += 7) if (Math.max(mo, s) <= mo + 4) touched.push((mo - W0) / 7);
      touchedOf.set(k, touched);
    }
    return touched;
  };
  // fits(st, t, windowHours(oe, win)) without building the Map – the optimizer tries hundreds of thousands of windows
  const fitsWin = (st, t, oe, win) => fitsSE(st, t, oe, win[0], win[1]);
  const fitsSE = (st, t, oe, s, e) => { // the same on the window [s, e] (no array per try)
    const touched = touchedFor(s, e);
    const res = st.reserve, cap = st.cap, th = t.hours;
    if (!touched.length) {
      const wi = weekOf(e);
      if (!(wi >= 0 && wi < NW)) return true;
      const d = oe - th[wi];
      return !(d > 1e-9 && res[wi] + d > cap[wi] + 1e-6);
    }
    const h = oe / touched.length;
    for (let k = 0; k < touched.length; k++) {
      const wi = touched[k];
      if (wi >= 0 && wi < NW) { const d = h - th[wi]; if (d > 1e-9 && res[wi] + d > cap[wi] + 1e-6) return false; }
    }
    return true;
  };
  const windowHours = (oe, win) => {
    const [s, e] = win;
    const m = new Map();
    const touched = touchedFor(s, e);
    if (!touched.length) { const wi = weekOf(e); if (wi >= 0 && wi < NW) m.set(wi, oe); return m; }
    const h = oe / touched.length;
    for (const wi of touched) if (wi >= 0 && wi < NW) m.set(wi, h);
    return m;
  };
  const fullHours = (m) => W.map((w, wi) => m.get(wi) || 0);
  // fullHours(windowHours(oe, win)) in one array
  const hoursOf = (oe, win) => {
    const out = new Array(NW).fill(0);
    const touched = touchedFor(win[0], win[1]);
    if (!touched.length) { const wi = weekOf(win[1]); if (wi >= 0 && wi < NW) out[wi] = oe || 0; return out; }
    const h = oe / touched.length;
    for (const wi of touched) if (wi >= 0 && wi < NW) out[wi] = h || 0;
    return out;
  };
  // the open stories with an Original Estimate and dates – as planTasks (weekPlan.js), hours per horizon week
  // distribution 'capacity': the board's split by availability (100 %) is the load; fillT = the earliest-first fill
  // at the target – the week its hours run out is the earliest due date that fits (Finish sooner)
  const byCapacity = distribution === 'capacity';
  const fill = byCapacity ? capacityFill(mcfg, computed.support, eff, { today: tIdx, evenIds: ds.planEven }) : null;
  const fillT = byCapacity ? capacityFill(mcfg, computed.support, eff, { today: tIdx, target, spread: 'front', evenIds: ds.planEven }) : null;
  // the even split only depends on the work items, the model's today and the horizon: kept for the next call
  const effData = byCapacity ? null : dataOf(eff);
  const taskKey = `${model.today}|${W0}|${NW}`;
  let tasks = effData?.tasks?.key === taskKey ? effData.tasks.list : null;
  if (!tasks) {
    tasks = [];
    for (const s of eff) {
      if (s.role !== 'estimate' || !isOpen(s) || !(s.oe > 0)) continue;
      const win = spreadWindow(s, 'oe', model.today);
      if (!win) continue;
      const f = fill?.get(s.id);
      const hours = f ? W.map((w) => f.byMonday.get(w.a) || 0) : hoursOf(s.oe, win);
      if (sum(hours) <= EPS) continue;
      // s0 / e0: the start and due as day indices, read once (the modes sort and compare them thousands of times)
      tasks.push({ id: s.id, key: s.key, summary: s.summary, ref: s.rootRef, teamId: s.team?.id || null, assignee: s.assignee?.id || null, assigneeName: s.assignee?.name || null, start: s.start || null, due: s.due || null, oe: s.oe, win, hours, s0: toIdx(s.start || null), e0: toIdx(s.due || null) });
    }
    if (effData) effData.tasks = { key: taskKey, list: tasks };
  }
  const anon = data.anon;
  const hiddenMemo = new Map();
  const hidden = (id) => { if (!id) return false; let v = hiddenMemo.get(id); if (v === undefined) { v = anon.has(id) || isAnonId(id); hiddenMemo.set(id, v); } return v; };
  const rankOf = (ref) => model.itemByRef.get(ref)?.rank ?? 1e9;
  const names = new Map();
  const nameOf = (id) => { let v = names.get(id); if (v === undefined) { v = hidden(id) ? '' : ds.people?.[id]?.name || tasks.find((t) => t.assignee === id)?.assigneeName || people.get(id)?.name || ''; names.set(id, v); } return v; };

  const skipped = { pending: 0, hidden: 0, unassigned: 0 };
  const cands = [];
  for (const t of tasks) {
    const i = byIssue.get(t.id);
    if (!i || !isOpen(i)) continue;
    const skip = (k) => { if (inScope(t)) skipped[k]++; };
    if (moves?.[t.id]) { skip('pending'); continue; }
    if (!t.assignee) { skip('unassigned'); continue; }
    if (hidden(t.assignee) || i.assignee?.anon) { skip('hidden'); continue; }
    const s = t.s0, e = t.e0;
    if (s == null || e == null || e < s || weekOf(e) < 0) continue;
    cands.push(t);
  }
  const byPerson = new Map();
  for (const t of tasks) if (t.assignee) (byPerson.get(t.assignee) || byPerson.set(t.assignee, []).get(t.assignee)).push(t);
  const candsOf = new Map();
  for (const t of cands) (candsOf.get(t.assignee) || candsOf.set(t.assignee, []).get(t.assignee)).push(t);

  // capacity per person: real = the load as it would be with the suggestions; reserve = never lower than today
  const states = new Map();
  // personWeekAvail per person and week, kept per model and configuration (the panel's second call, the card menu)
  const availByCfg = availCache.get(model) || availCache.set(model, new WeakMap()).get(model);
  const avail = availByCfg.get(cfg) || availByCfg.set(cfg, new Map()).get(cfg);
  const stateOf = (pid) => {
    if (!states.has(pid)) {
      const p = people.get(pid) || { id: pid, weeklyHours: 0, location: 'NONE', teamId: null };
      const sw = computed.support?.personWeekly?.[pid] || 0;
      const byWeek = avail.get(`${pid}|${sw}`) || avail.set(`${pid}|${sw}`, new Map()).get(`${pid}|${sw}`);
      const wa = W.map((w) => {
        const hit = byWeek.get(w.a);
        if (hit && hit.b === w.b) return hit.v;
        const v = personWeekAvail(mcfg, p, w.a, w.b, sw);
        byWeek.set(w.a, { b: w.b, v });
        return v;
      });
      // support + the sum of the person's task hours per week – the tasks added in the same order as sum() did
      const acc = new Array(NW).fill(0);
      for (const t of byPerson.get(pid) || []) { const h = t.hours; for (let wi = 0; wi < NW; wi++) acc[wi] += h[wi] || 0; }
      const base = W.map((w, wi) => wa[wi].support + acc[wi]);
      states.set(pid, { id: pid, p, wa, avail: wa.map((a) => a.avail), cap: wa.map((a) => a.avail * target), real: [...base], reserve: [...base] });
    }
    return states.get(pid);
  };
  const isOver = (st, wi) => st.real[wi] > st.cap[wi] + EPS;
  const overWeeks = (st) => { const out = [], real = st.real, cap = st.cap; for (let wi = 0; wi < NW; wi++) if (real[wi] > cap[wi] + EPS) out.push(wi); return out; };

  // dependencies: the engine's open blocks links, checked on the effective dates plus every accepted suggestion
  // no pending moves: the effective work items are the work items (the same Map)
  const effById = eff === issues ? byIssue : new Map(eff.map((i) => [i.id, i]));
  const itemOf = (id) => effById.get(id) || model.external?.get(id) || null;
  const newStart = new Map(), newDue = new Map();
  const startOf = (id) => (newStart.has(id) ? newStart.get(id) : toIdx(itemOf(id)?.start));
  const dueOf = (id) => (newDue.has(id) ? newDue.get(id) : toIdx(itemOf(id)?.due));
  const linksOf = new Map();
  // the engine already computed them for this model and configuration
  const depsAll = cfg === model.cfg && computed.deps?.list ? computed.deps : dependencies(mcfg, null);
  for (const d of depsAll.list || []) {
    if (!d.open) continue;
    for (const id of [d.pre, d.dep]) (linksOf.get(id) || linksOf.set(id, []).get(id)).push(d);
  }
  const conflictOf = (d, id, s, e) => {
    const pd = d.pre === id ? e : dueOf(d.pre);
    const sd = d.dep === id ? s : startOf(d.dep);
    return pd != null && sd != null && pd > sd;
  };
  // { creates, resolved: [keys] } for task id on the window [s, e]
  const depCheck = (id, s, e) => {
    const links = linksOf.get(id);
    if (!links) return { creates: false, startBeforePre: false, resolved: [] }; // no open blocks link (most tasks)
    const s0 = startOf(id), e0 = dueOf(id);
    return {
      creates: links.some((d) => !conflictOf(d, id, s0, e0) && conflictOf(d, id, s, e)),
      // a start earlier than a prerequisite's due date (even where a conflict already exists)
      startBeforePre: links.some((d) => d.dep === id && conflictOf(d, id, s, e)),
      resolved: links.filter((d) => conflictOf(d, id, s0, e0) && !conflictOf(d, id, s, e)).map((d) => itemOf(d.pre === id ? d.dep : d.pre)?.key).filter(Boolean),
    };
  };

  // A conflict the new window still leaves (tester 2026-11-19: "Finish sooner" moved PCX-1 to 04.12, PCX-2 still started on
  // 16.11 – the conflict stayed). Where this task is the prerequisite, the dependent's start moves to the first working
  // day after the new due date – as a second pending change of the same suggestion – unless that would put its start
  // after its own due date. Where this task waits for another, or the start cannot move, the conflict is named as staying.
  const chainFix = (id, s, e) => {
    const also = [], keeps = [];
    for (const d of linksOf.get(id) || []) {
      if (!conflictOf(d, id, s, e)) continue;
      if (d.pre === id) {
        // only a work item of this board's data can become a pending change; one outside it (another project, not in
        // the portfolio) keeps its date – the conflict is then named as staying
        const D = effById.get(d.dep) || null;
        const open = D && (D.status?.cat ?? 'new') !== 'done';
        if (!D) { const X = itemOf(d.dep); if (X?.key) keeps.push(X.key); continue; }
        let ns = e + 1;
        while (!isWeekday(ns)) ns++;
        const de = dueOf(d.dep);
        if (open && D.key && (de == null || de >= ns)) also.push({ taskId: D.id, key: D.key, start: isoOf(ns), from: D.start || null, due: de != null ? isoOf(de) : null });
        else if (D?.key) keeps.push(D.key);
      } else { const P = itemOf(d.pre); if (P?.key) keeps.push(P.key); }
    }
    return { also, keeps };
  };
  const chainText = (ch, lang) => [
    ...ch.also.map((a) => (lang === 'de' ? ` ${a.key} wartet darauf und startet dann am ${ddmm(a.start)} – der Terminkonflikt ist damit gelöst.` : ` ${a.key} waits for it and then starts on ${ddmm(a.start, 'en')} – that resolves the date conflict.`)),
    ...(ch.keeps.length ? [lang === 'de' ? ` Der Terminkonflikt mit ${ch.keeps.join(', ')} bleibt – unten unter „Konflikte“ lösen.` : ` The date conflict with ${ch.keeps.join(', ')} stays – resolve it below under "Conflicts".`] : []),
  ].join('');
  // the new window fits when every week that gets more hours stays within the target (on the reservation)
  const fits = (st, t, m) => {
    for (const [wi, h] of m) { const d = h - t.hours[wi]; if (d > 1e-9 && st.reserve[wi] + d > st.cap[wi] + 1e-6) return false; }
    return true;
  };
  const commit = (st, t, after) => {
    for (let wi = 0; wi < W.length; wi++) {
      const d = after[wi] - t.hours[wi];
      st.real[wi] += d;
      if (d > 0) st.reserve[wi] += d;
    }
  };
  const used = new Set(); // tasks that already have a suggestion
  // The hard limit of a task: the earlier of the project's due date and the milestone date (the project first on the
  // same day). Read once per project and milestone (the dates never change during a run); each task gets its own copy.
  const limits = new Map(), projLim = new Map(), msLim = new Map();
  const limitOf = (t) => {
    let v = limits.get(t.id);
    if (v !== undefined) return v;
    let p = projLim.get(t.ref);
    if (p === undefined) {
      const pd = model.itemByRef.get(t.ref)?.due;
      p = pd && toIdx(pd) != null ? { kind: 'project', iso: String(pd).slice(0, 10), idx: toIdx(pd) } : null;
      projLim.set(t.ref, p);
    }
    const ms = milestoneOf(model, byIssue.get(t.id) || {});
    let m = null;
    if (ms) {
      m = msLim.get(ms);
      if (m === undefined) { m = ms.date && toIdx(ms.date) != null ? { kind: 'milestone', iso: String(ms.date).slice(0, 10), idx: toIdx(ms.date), name: ms.name || '' } : null; msLim.set(ms, m); }
    }
    const pick = p && m ? (m.idx < p.idx ? m : p) : p || m;
    v = pick ? { ...pick } : null;
    limits.set(t.id, v);
    return v;
  };
  const wkNos = W.map((w) => isoWeekNo(w.a)); // once per horizon week
  const wkList = (list, lang) => {
    const nums = list.map((wi) => wkNos[wi]);
    return `${lang === 'de' ? 'KW' : 'W'} ${nums.length > 3 ? `${nums.slice(0, 3).join(', ')} (+${nums.length - 3})` : nums.join(', ')}`;
  };
  // the weeks a row shows: everything the task (or the load) touches before and after, at most SPAN_MAX
  const spanOf = (...arrs) => {
    let a = Infinity, b = -1;
    for (const arr of arrs) arr.forEach((h, wi) => { if (h > EPS) { a = Math.min(a, wi); b = Math.max(b, wi); } });
    if (b < 0) return [];
    return W.slice(a, Math.min(b, a + SPAN_MAX - 1) + 1).map((w) => w.i);
  };
  const base = (t, mode) => ({
    id: `${mode}:${t.id}`, mode, taskId: t.id, key: t.key, summary: t.summary, personId: t.assignee, personName: nameOf(t.assignee),
    ref: t.ref, project: model.itemByRef.get(t.ref)?.name || '', rank: model.itemByRef.get(t.ref)?.rank ?? null, teamId: t.teamId, oe: t.oe,
    start: t.start, due: t.due, newStart: t.start, newDue: t.due, resolves: [],
  });

  return {
    teamPeople: (() => { const m = new Map(); return (teamId) => m.get(teamId) || m.set(teamId, [...people.values()].filter((p) => !hidden(p.id) && inTeam(p, teamId) && nameOf(p.id))).get(teamId); })(),
    lastWdOf: (() => { const m = new Map(); return (loc) => m.get(loc) || m.set(loc, W.map((w) => lastWorkday(cfg, loc, w.a))).get(loc); })(),
    model, cfg, target, tIdx, W, H, weekOf, people, tasks, cands, candsOf, skipped, inScope, hidden, rankOf, nameOf, byIssue,
    byCapacity, fillT, mcfg, support: computed.support, eff, evenIds: ds.planEven, stateOf, isOver, overWeeks, depCheck, chainFix, chainText, newStart, newDue, windowHours, fullHours, fits, fitsWin, fitsSE, commit, used, limitOf, wkList, spanOf, base,
  };
}

// ---------- smooth: overload → stretch or move lower-ranked tasks later ----------
function runSmooth(c) {
  const out = [];
  const pct = Math.round(c.target * 100);
  const persons = [...c.candsOf.keys()].sort((a, b) => deColl.compare(c.nameOf(a), c.nameOf(b)));
  for (const pid of persons) {
    const st = c.stateOf(pid);
    if (!c.overWeeks(st).length) continue;
    const list = c.candsOf.get(pid).filter((t) => !c.used.has(t.id))
      .sort((x, y) => c.rankOf(y.ref) - c.rankOf(x.ref) || y.e0 - x.e0 || defColl.compare(String(y.key), String(x.key)));
    let blocked = null; // first task that could not move, for the person's note
    const overStart = c.overWeeks(st);
    for (const t of list) {
      const over = c.overWeeks(st);
      if (!over.length) break;
      const mine = over.filter((wi) => t.hours[wi] > EPS);
      if (!mine.length) continue;
      const s = t.s0, e = t.e0;
      const wl = c.weekOf(e);
      const limit = c.limitOf(t);
      const loc = st.p.location;
      let pick = null;
      const whys = new Set();
      for (let j = 1; j <= MAX_LATER && wl + j < c.H && !pick; j++) {
        if (limit && c.W[wl + j].a > limit.idx) { whys.add('limit'); break; } // later only gets later
        const opts = [];
        const se = lastWorkday(c.cfg, loc, c.W[wl + j].a);
        if (se != null) opts.push({ kind: 'stretch', j, s, e: se });
        const sh = shiftIdx(s, e, j);
        opts.push({ kind: 'shift', j, s: sh[0], e: sh[1] });
        for (const o of opts) {
          if (o.s == null || o.e == null || (o.s !== s && o.s < c.tIdx)) continue;
          if (limit && o.e > limit.idx) { whys.add('limit'); continue; }
          const dep = c.depCheck(t.id, o.s, o.e);
          if (dep.creates) { whys.add('conflict'); continue; }
          if (!c.fitsSE(st, t, t.oe, o.s, o.e)) { whys.add('room'); continue; }
          const m = c.windowHours(t.oe, [o.s, o.e]);
          // it must fix its part: each over week it is in becomes fine or the task leaves it
          const ok = mine.every((wi) => !(m.get(wi) > EPS) || st.real[wi] - t.hours[wi] + (m.get(wi) || 0) <= st.cap[wi] + EPS);
          if (!ok) { whys.add('room'); continue; }
          pick = { ...o, m, dep };
          break;
        }
      }
      // why it cannot move: the hard limit first, then a conflict, then no room
      const why = ['limit', 'conflict', 'room'].find((k) => whys.has(k)) || (limit ? 'limit' : 'room');
      if (!pick) { if (!blocked && c.inScope(t)) blocked = { t, why, limit }; continue; }
      const before = [...st.real];
      const after = c.fullHours(pick.m);
      c.commit(st, t, after);
      c.used.add(t.id);
      c.newStart.set(t.id, pick.s); c.newDue.set(t.id, pick.e);
      if (!c.inScope(t)) continue;
      const fixed = mine.filter((wi) => before[wi] > st.cap[wi] + EPS && st.real[wi] <= st.cap[wi] + EPS);
      const span = c.spanOf(t.hours, after, before.map((x, wi) => (x > st.cap[wi] + EPS ? x : 0)));
      const fromN = weeksTouched([s, e]), toN = weeksTouched([pick.s, pick.e]);
      const how = (lang) => (pick.kind === 'stretch'
        ? (lang === 'de' ? `auf ${toN} statt ${fromN} Wochen gestreckt` : `stretched over ${toN} instead of ${fromN} weeks`)
        : (lang === 'de' ? `um ${pick.j} ${wks(pick.j, 'de')} verschoben` : `moved ${pick.j} ${wks(pick.j, 'en')} later`));
      const lim = (lang) => (limit ? (lang === 'de' ? ` Bleibt vor ${limit.kind === 'project' ? 'dem Projekt-Due' : 'dem Meilenstein'} ${ddmm(limit.iso)}` : ` Stays before the ${limit.kind === 'project' ? 'project due date' : 'milestone'} ${ddmm(limit.iso, 'en')}.`) : '');
      out.push({
        ...c.base(t, 'smooth'), kind: pick.kind, shiftWeeks: pick.kind === 'shift' ? pick.j : 0, fromWeeks: fromN, toWeeks: toN,
        newStart: isoOf(pick.s), newDue: isoOf(pick.e), weeksLater: c.weekOf(pick.e) - wl, fixed: fixed.map((wi) => c.W[wi].from), limit,
        move: pick.kind === 'shift' ? { start: isoOf(pick.s), due: isoOf(pick.e) } : { due: isoOf(pick.e) },
        weeks: span.map((wi) => c.W[wi].from), before: span.map((wi) => before[wi]), after: span.map((wi) => st.real[wi]), cap: span.map((wi) => st.cap[wi]),
        taskBefore: span.map((wi) => t.hours[wi]), taskAfter: span.map((wi) => after[wi]), unit: 'load',
        reason: {
          de: `${c.nameOf(pid)} ist in ${c.wkList(mine, 'de')} über ${pct} %. ${t.key} hat den niedrigsten Rang dort und wird ${how('de')}${fixed.length ? ` – danach passen ${c.wkList(fixed, 'de')}` : ''}.${lim('de')}`,
          en: `${c.nameOf(pid)} is over ${pct}% in ${c.wkList(mine, 'en')}. ${t.key} has the lowest rank there and is ${how('en')}${fixed.length ? ` – then ${c.wkList(fixed, 'en')} fit` : ''}.${lim('en')}`,
        },
      });
    }
    // one honest note per person when overload is left that this mode cannot remove
    const left = c.overWeeks(st);
    if (left.length && blocked) {
      const { t, why, limit } = blocked;
      const r = {
        limit: [`${t.key} passt nicht vor ${limit?.kind === 'milestone' ? 'den Meilenstein' : 'das Projekt-Due'} ${limit ? ddmm(limit.iso) : ''}`, `${t.key} does not fit before the ${limit?.kind === 'milestone' ? 'milestone' : 'project due date'} ${limit ? ddmm(limit.iso, 'en') : ''}.`],
        conflict: [`Später ginge ${t.key} nur mit einem Blocks-Konflikt.`, `Moving ${t.key} later would create a blocks conflict.`],
        room: [`In den Wochen danach ist auch kein Platz für ${t.key}.`, `The weeks after have no room for ${t.key} either.`],
      }[why];
      out.push({
        ...c.base(t, 'smooth'), id: `smooth-note:${pid}`, note: true, why, limit, overWeeks: left.map((wi) => c.W[wi].from), overStart: overStart.length,
        reason: {
          de: `${c.nameOf(pid)} bleibt in ${c.wkList(left, 'de')} über ${pct} %. ${r[0]}`,
          en: `${c.nameOf(pid)} stays over ${pct}% in ${c.wkList(left, 'en')}. ${r[1]}`,
        },
      });
    }
  }
  return out;
}

// ---------- rebalance: what is still over goes to a colleague in the same team with room ----------
function runRebalance(c) {
  const out = [];
  const pct = Math.round(c.target * 100);
  const persons = [...c.candsOf.keys()].sort((a, b) => deColl.compare(c.nameOf(a), c.nameOf(b)));
  for (const pid of persons) {
    const st = c.stateOf(pid);
    if (!c.overWeeks(st).length) continue;
    const list = c.candsOf.get(pid).filter((t) => !c.used.has(t.id))
      .sort((x, y) => c.rankOf(y.ref) - c.rankOf(x.ref) || y.e0 - x.e0 || defColl.compare(String(y.key), String(x.key)));
    for (const t of list) {
      const over = c.overWeeks(st);
      if (!over.length) break;
      const mine = over.filter((wi) => t.hours[wi] > EPS);
      if (!mine.length) continue;
      const teamId = t.teamId || st.p.teamId;
      if (!teamId) continue;
      const weeks = t.hours.map((h, wi) => (h > EPS ? wi : -1)).filter((wi) => wi >= 0);
      let best = null;
      for (const p of c.teamPeople(teamId)) {
        if (p.id === pid) continue;
        const o = c.stateOf(p.id);
        let okAll = true, peak = 0;
        for (const wi of weeks) {
          const h = t.hours[wi];
          if (o.reserve[wi] + h > o.cap[wi] + 1e-6) { okAll = false; break; }
          peak = Math.max(peak, o.avail[wi] > EPS ? (o.reserve[wi] + h) / o.avail[wi] : Infinity);
        }
        if (!okAll) continue;
        if (!best || peak < best.peak - 1e-9 || (Math.abs(peak - best.peak) < 1e-9 && deColl.compare(c.nameOf(p.id), c.nameOf(best.st.id)) < 0)) best = { st: o, peak };
      }
      if (!best) continue;
      const to = best.st;
      const util = (x, wi) => (x.avail[wi] > EPS ? x.real[wi] / x.avail[wi] : x.real[wi] > EPS ? Infinity : 0);
      const fromBefore = weeks.map((wi) => util(st, wi)), toBefore = weeks.map((wi) => util(to, wi));
      const beforeLoad = [...st.real];
      for (const wi of weeks) { st.real[wi] -= t.hours[wi]; to.real[wi] += t.hours[wi]; to.reserve[wi] += t.hours[wi]; }
      c.used.add(t.id);
      if (!c.inScope(t)) continue;
      const fixed = mine.filter((wi) => st.real[wi] <= st.cap[wi] + EPS);
      const peakOf = (arr) => arr.reduce((a, x) => Math.max(a, x), 0);
      const fromAfter = weeks.map((wi) => util(st, wi)), toAfter = weeks.map((wi) => util(to, wi));
      const span = c.spanOf(t.hours).filter((wi) => wi >= 0);
      const toName = c.nameOf(to.id), fromName = c.nameOf(pid);
      out.push({
        ...c.base(t, 'rebalance'), toPersonId: to.id, toPersonName: toName,
        fromLoad: [peakOf(fromBefore), peakOf(fromAfter)], toLoad: [peakOf(toBefore), peakOf(toAfter)],
        fixed: fixed.map((wi) => c.W[wi].from),
        move: { assignee: to.id, assigneeName: toName },
        weeks: span.map((wi) => c.W[wi].from), before: span.map((wi) => beforeLoad[wi]), after: span.map((wi) => st.real[wi]), cap: span.map((wi) => st.cap[wi]),
        toBefore: span.map((wi) => to.real[wi] - t.hours[wi]), toAfter: span.map((wi) => to.real[wi]), toCap: span.map((wi) => to.cap[wi]), unit: 'load',
        reason: {
          de: `${fromName} ist in ${c.wkList(mine, 'de')} über ${pct} %. ${toName} ist im selben Team und hat in allen Wochen von ${t.key} Luft (danach höchstens ${pc(peakOf(toAfter))}).${fixed.length ? ` Danach passen bei ${fromName} ${c.wkList(fixed, 'de')}.` : ''}`,
          en: `${fromName} is over ${pct}% in ${c.wkList(mine, 'en')}. ${toName} is in the same team and has room in every week of ${t.key} (at most ${pc(peakOf(toAfter))} after).${fixed.length ? ` Then ${c.wkList(fixed, 'en')} fit for ${fromName}.` : ''}`,
        },
      });
    }
  }
  return out;
}

// ---------- sooner: room left → finish tasks sooner ----------
// With the capacity distribution the split already uses the free room: a task is done in the week its hours run out.
// Finish sooner then proposes that week's last working day as the due date (hours stay as the board shows them).
function runSoonerByCapacity(c) {
  const out = [];
  const pct = Math.round(c.target * 100);
  const list = [...c.candsOf.values()].flat().filter((t) => !c.used.has(t.id))
    .sort((x, y) => c.rankOf(x.ref) - c.rankOf(y.ref) || x.e0 - y.e0 || defColl.compare(String(x.key), String(y.key)));
  for (const t of list) {
    const f = c.fillT.get(t.id);
    if (!f || f.overflow || !(f.weeksEarly >= 1)) continue;
    const st = c.stateOf(t.assignee);
    const s = t.s0, e = t.e0;
    const due = lastWorkday(c.cfg, st.p.location, f.finishWeek);
    if (due == null || due < c.tIdx || due < s || due >= e) continue;
    const dep = c.depCheck(t.id, s, due);
    if (dep.creates) continue;
    c.used.add(t.id);
    c.newDue.set(t.id, due);
    if (!c.inScope(t)) continue;
    const even = c.fullHours(c.windowHours(t.oe, [s, e]));
    const after = c.W.map((w) => f.byMonday.get(w.a) || 0);
    const span = c.spanOf(even, after);
    const fin = c.weekOf(due);
    const saved = c.weekOf(e) - fin;
    const curN = weeksTouched([s, e]), n = weeksTouched([s, due]);
    const name = c.nameOf(t.assignee);
    const chain = c.chainFix(t.id, s, due);
    for (const a of chain.also) { c.newStart.set(a.taskId, dayIdx(a.start)); c.used.add(a.taskId); }
    const res = (lang) => (dep.resolved.length ? (lang === 'de' ? ` Löst außerdem den Konflikt mit ${dep.resolved.join(', ')}.` : ` Also resolves the conflict with ${dep.resolved.join(', ')}.`) : '') + c.chainText(chain, lang);
    out.push({
      ...c.base(t, 'sooner'), fromWeeks: curN, toWeeks: n, newStart: t.start, newDue: isoOf(due), weeksSaved: saved, startMoved: false, byCapacity: true, ...(chain.also.length ? { also: chain.also } : {}), ...(chain.keeps.length ? { keeps: chain.keeps } : {}),
      move: { due: isoOf(due) },
      weeks: span.map((wi) => c.W[wi].from), before: span.map((wi) => even[wi]), after: span.map((wi) => after[wi]),
      free: span.map((wi) => Math.max(0, after[wi])), cap: span.map((wi) => st.cap[wi]), unit: 'task', resolves: dep.resolved,
      reason: {
        de: `${name || 'Die Person'} hat genug Luft (bis ${pct} %), um ${t.key} früher zu schaffen – fertig in ${c.wkList([fin], 'de')}, ${saved} ${wks(saved, 'de')} vor dem Due. Due auf ${ddmm(isoOf(due))} setzen; die Stunden verteilen sich dann nach freier Kapazität innerhalb des kürzeren Zeitraums.${res('de')}`,
        en: `${name || 'This person'} has enough room (up to ${pct}%) to finish ${t.key} sooner – done in ${c.wkList([fin], 'en')}, ${saved} ${wks(saved, 'en')} before the due date. Set the due date to ${ddmm(isoOf(due), 'en')}; the hours are then split by free capacity within the shorter window.${res('en')}`,
      },
    });
  }
  return out.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || defColl.compare(a.newDue, b.newDue) || defColl.compare(String(a.key), String(b.key)));
}

function runSooner(c) {
  const out = [];
  const pct = Math.round(c.target * 100);
  const persons = [...c.candsOf.keys()].sort((a, b) => deColl.compare(c.nameOf(a), c.nameOf(b)));
  for (const pid of persons) {
    const st = c.stateOf(pid);
    const loc = st.p.location;
    const list = c.candsOf.get(pid).filter((t) => !c.used.has(t.id))
      .sort((x, y) => c.rankOf(x.ref) - c.rankOf(y.ref) || x.e0 - y.e0 || defColl.compare(String(x.key), String(y.key)));
    for (const t of list) {
      const s = t.s0, e = t.e0;
      const w0 = c.weekOf(s);
      const wl = c.weekOf(e);
      // start options: keep it; or – for a start still ahead – the first working day of up to 8 earlier weeks
      const starts = [s];
      if (s > c.tIdx) {
        for (let wk = Math.min(w0, c.H) - 1; wk >= Math.max(0, w0 - MAX_EARLIER); wk--) {
          const d = firstWorkday(c.cfg, loc, c.W[wk].a, c.tIdx);
          if (d != null && d < s) starts.push(d);
        }
      }
      let pick = null;
      const lastWd = c.lastWdOf(loc);
      for (let k = 0; k < Math.min(wl, c.H) && !pick; k++) {
        const due = lastWd[k];
        if (due == null || due < c.tIdx || due >= e) continue;
        for (const ns of starts) {
          if (ns > due) continue;
          if (!c.fitsSE(st, t, t.oe, ns, due)) continue;
          const m = c.windowHours(t.oe, [ns, due]);
          const dep = c.depCheck(t.id, ns, due);
          if (dep.creates || (ns !== s && dep.startBeforePre)) continue;
          pick = { k, s: ns, due, m, dep, n: weeksTouched([ns, due]) };
          break;
        }
      }
      if (!pick) continue;
      const after = c.fullHours(pick.m);
      const free = c.W.map((w, wi) => st.cap[wi] - (st.reserve[wi] - t.hours[wi]));
      c.commit(st, t, after);
      c.used.add(t.id);
      c.newStart.set(t.id, pick.s); c.newDue.set(t.id, pick.due);
      if (!c.inScope(t)) continue;
      const curN = weeksTouched([s, e]);
      const moved = pick.s !== s;
      const span = c.spanOf(t.hours, after);
      const firstWk = Math.max(0, c.weekOf(pick.s));
      const minFree = Math.min(...free.slice(firstWk, pick.k + 1));
      const perWeek = t.oe / pick.n;
      const name = c.nameOf(pid);
      const wkRange = (lang) => c.wkList([...new Set([firstWk, pick.k])], lang).replace(', ', '–');
      const chain = c.chainFix(t.id, pick.s, pick.due);
      for (const a of chain.also) { c.newStart.set(a.taskId, dayIdx(a.start)); c.used.add(a.taskId); }
      const res = (lang) => (pick.dep.resolved.length ? (lang === 'de' ? ` Löst außerdem den Konflikt mit ${pick.dep.resolved.join(', ')}.` : ` Also resolves the conflict with ${pick.dep.resolved.join(', ')}.`) : '') + c.chainText(chain, lang);
      const st_ = (lang) => (moved ? (lang === 'de' ? ` Start rückt auf ${ddmm(isoOf(pick.s))} vor.` : ` The start moves up to ${ddmm(isoOf(pick.s), 'en')}.`) : '');
      out.push({
        ...c.base(t, 'sooner'), fromWeeks: curN, toWeeks: pick.n, newStart: isoOf(pick.s), newDue: isoOf(pick.due), weeksSaved: wl - pick.k, startMoved: moved, ...(chain.also.length ? { also: chain.also } : {}), ...(chain.keeps.length ? { keeps: chain.keeps } : {}),
        move: moved ? { start: isoOf(pick.s), due: isoOf(pick.due) } : { due: isoOf(pick.due) },
        weeks: span.map((wi) => c.W[wi].from), before: span.map((wi) => t.hours[wi]), after: span.map((wi) => after[wi]),
        free: span.map((wi) => free[wi]), cap: span.map((wi) => st.cap[wi]), unit: 'task', resolves: pick.dep.resolved,
        reason: {
          de: `${name || 'Die Person'} hat in ${wkRange('de')} mindestens ${num(minFree, 'de')} h je Woche frei: ${num(t.oe, 'de')} h ÷ ${pick.n} ${wks(pick.n, 'de')} = ${num(perWeek, 'de')} h je Woche passt bei ${pct} % Auslastung.${st_('de')}${res('de')}`,
          en: `${name || 'This person'} has at least ${num(minFree, 'en')} h free per week in ${wkRange('en')}: ${num(t.oe, 'en')} h ÷ ${pick.n} ${wks(pick.n, 'en')} = ${num(perWeek, 'en')} h per week fits at ${pct} % utilization.${st_('en')}${res('en')}`,
        },
      });
    }
  }
  return out.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || defColl.compare(a.newDue, b.newDue) || defColl.compare(String(a.key), String(b.key)));
}

// ---------- by capacity: check every suggestion on the board's real split ----------
// With the capacity distribution the board re-splits ALL of a person's tasks after a change (rank, then due, decides
// who gets the room first). An earlier due moves a task ahead of its siblings, a new assignee re-orders the
// colleague's weeks – the modes' own forecast does not see that (E2E audit 2026-11-17: "Finish sooner" proposals that
// pushed the person to 131 %). So each suggestion is re-split exactly like the board (capacityFill) for every person
// it touches – alone and together with the suggestions kept before it – and dropped when any week of those people
// would end above max(today, target). What stays keeps the panel's promise: accepting never creates new overload.
function verifyByCapacity(c, lists) {
  const avOf = new Map();
  const weeksOf = (pid) => {
    if (avOf.has(pid)) return avOf.get(pid);
    const p = c.people.get(pid) || { id: pid, weeklyHours: 0, location: 'NONE', teamId: null };
    const m = new Map(c.W.map((w) => [w.a, personWeekAvail(c.mcfg, p, w.a, w.b, c.support?.personWeekly?.[pid] || 0)]));
    avOf.set(pid, m);
    return m;
  };
  // exactly the board's numbers: planTasks with the capacity fill (tasks the fill skips – e.g. a window without a
  // working day – keep the board's even rule, all in the due week)
  const loadOf = (issues, pid) => {
    const mine = issues.filter((i) => i.assignee?.id === pid);
    const fill = capacityFill(c.mcfg, c.support, mine, { today: c.tIdx, evenIds: c.evenIds });
    const tasks = planTasks(c.mcfg, mine, c.W, fill);
    const av = weeksOf(pid);
    return new Map(c.W.map((w, wi) => [w.a, av.get(w.a).support + tasks.reduce((x, t) => x + t.hours[wi], 0)]));
  };
  const byId = new Map(c.eff.map((i) => [i.id, i]));
  const apply = (issues, sug) => issues.map((i) => {
    if (i.id !== sug.taskId) return i;
    const m = sug.move || { due: sug.newDue };
    const out = { ...i };
    if (m.start !== undefined) out.start = m.start;
    if (m.due !== undefined) out.due = m.due;
    if (m.assignee !== undefined) out.assignee = m.assignee ? { ...(i.assignee || {}), id: m.assignee, name: m.assigneeName || null } : null;
    return out;
  });
  const peopleOf = (sug) => [byId.get(sug.taskId)?.assignee?.id, sug.move?.assignee].filter(Boolean);
  const before = new Map();
  const baseLoad = (pid) => before.get(pid) || before.set(pid, loadOf(c.eff, pid)).get(pid);
  const ok = (issues, pids) => pids.every((pid) => {
    const b = baseLoad(pid), a = loadOf(issues, pid), av = weeksOf(pid);
    for (const [mo, x] of av) {
      const lim = Math.max(b.get(mo) || 0, x.avail * c.target) + 0.05;
      if ((a.get(mo) || 0) > lim) return false;
    }
    return true;
  });
  let kept = c.eff;
  const keptPeople = new Set();
  for (const list of lists) {
    for (let k = list.length - 1; k >= 0; k--) list[k]._order = k;
    const all = [...list].sort((x, y) => x._order - y._order);
    for (const sug of all) {
      if (sug.note) continue;
      const pids = peopleOf(sug);
      const alone = apply(c.eff, sug);
      const together = apply(kept, sug);
      if (ok(alone, pids) && ok(together, [...new Set([...pids, ...keptPeople])])) { kept = together; pids.forEach((x) => keptPeople.add(x)); continue; }
      list.splice(list.indexOf(sug), 1);
    }
    for (const sug of list) delete sug._order;
  }
}

// ---------- entry points ----------
const emptyMode = () => ({ suggestions: [], notes: [], count: 0, summary: {} });
// All three modes on one shared reservation: { sooner, smooth, rebalance, target, horizon, considered, skipped }.
// Each mode: { suggestions (selectable, with .move), notes (smooth: overload that cannot be removed), count, summary }.
// distribution: 'even' (default) or 'capacity' – as the board shows it (buildBoard / capacityFill).
export function optimizeAll({ ds, computed, board = null, team = null, project = null, moves = {}, config = null, target = 1, horizonWeeks = null, today = null, distribution = 'even' } = {}) {
  const none = { sooner: emptyMode(), smooth: emptyMode(), rebalance: emptyMode(), target, horizon: 0, considered: 0, overloaded: 0, skipped: { pending: 0, hidden: 0, unassigned: 0 } };
  if (!ds || !computed?.model) return none;
  const c = context({ ds, computed, board, team, project, moves, config, target, horizonWeeks, today, distribution: board?.distribution || distribution });
  const considered = c.cands.filter(c.inScope).length;
  if (!considered) return { ...none, horizon: c.H, skipped: c.skipped };
  // overloaded people on this board before any suggestion
  const overloaded = [...c.candsOf.keys()].filter((pid) => c.candsOf.get(pid).some(c.inScope) && c.overWeeks(c.stateOf(pid)).length).length;
  const smooth = runSmooth(c);
  const rebalance = runRebalance(c);
  const sooner = c.byCapacity ? runSoonerByCapacity(c) : runSooner(c);
  if (c.byCapacity) verifyByCapacity(c, [smooth, rebalance, sooner]);
  const fixedWeeks = (list) => new Set(list.flatMap((s) => (s.fixed || []).map((w) => `${s.personId}:${w}`))).size;
  const pack = (list, summary) => {
    const sel = list.filter((s) => !s.note);
    return { suggestions: sel, notes: list.filter((s) => s.note), count: sel.length, summary: { tasks: sel.length, people: new Set(sel.map((x) => x.personId)).size, ...summary } };
  };
  return {
    sooner: pack(sooner, { weeksSaved: sum(sooner, (x) => x.weeksSaved) }),
    smooth: pack(smooth, { weeksFixed: fixedWeeks(smooth) }),
    rebalance: pack(rebalance, { weeksFixed: fixedWeeks(rebalance) }),
    target, horizon: c.H, considered, overloaded, skipped: c.skipped, distribution: c.byCapacity ? 'capacity' : 'even',
  };
}
// "Finish sooner" alone (the first version's shape): { suggestions, summary: { tasks, weeksSaved, people, considered, skipped }, target }.
export function optimizePlan(args = {}) {
  const r = optimizeAll(args);
  return {
    suggestions: r.sooner.suggestions,
    summary: { tasks: r.sooner.count, weeksSaved: r.sooner.summary.weeksSaved || 0, people: r.sooner.summary.people || 0, considered: r.considered, skipped: r.skipped },
    target: r.target,
  };
}
// Every selectable suggestion of a task, whatever the mode (for the card menu).
export function suggestionsFor(all, taskId) {
  return OPT_MODES.flatMap((m) => all?.[m]?.suggestions || []).filter((s) => s.taskId === taskId);
}

// The pending moves for a set of accepted suggestions (the board's normal moves – undo, apply and discard all work).
export function suggestionMoves(moves, issues, suggestions) {
  const byId = new Map((issues || []).map((i) => [i.id, i]));
  return (suggestions || []).reduce((mv, s) => {
    const i = byId.get(s.taskId);
    if (!i || s.note) return mv;
    let next = moveTask(mv, i, s.move || { due: s.newDue });
    for (const a of s.also || []) { const d = byId.get(a.taskId); if (d) next = moveTask(next, d, { start: a.start }); }
    return next;
  }, moves || {});
}

// ---------- panel state (survives a team switch, like the pending moves) ----------
export function createOptStore(init = {}) {
  let snap = { open: false, mode: 'sooner', target: 1, off: {}, ...init };
  const subs = new Set();
  return {
    get: () => snap,
    set(next) { snap = { ...snap, ...(typeof next === 'function' ? next(snap) : next) }; subs.forEach((f) => f()); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    toggleRow(id) { const off = { ...snap.off }; if (off[id]) delete off[id]; else off[id] = true; this.set({ off }); },
  };
}
export const optStore = createOptStore();
