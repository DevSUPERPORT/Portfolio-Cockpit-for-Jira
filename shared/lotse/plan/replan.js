// Lotse plans – re-plan open work so every week stays at the target, with the cockpit's own numbers.
//
//   replan(ctx, { people, team, target, order, realistic, handover, pull, lock, fixWeeks, horizonWeeks, showWeeks, focus })
//   focus [fromISO, toISO] (closures): minimal change around those days – only the weeks touching them are fixed, only
//   work in those weeks leaves, and overdue / undated work moves only when it lands in them; the rest keeps its dates.
//   focusBase (the model WITHOUT the closure): then only the overload the closure itself causes is resolved – a week
//   that was already over keeps its old excess (fixing that is a normal re-plan, not this one)
//     → { weeks, people: [{ id, name, before, after, … }], moves, unplaced, warnings, settings }
//
// What it measures is exactly what "Meine Arbeit" and Kapazität show (engine.weeksUtilization): the Remaining
// Estimate of every open story, spread evenly over the working days from max(start, today) to the due date (overdue or
// undated work lands on the next working day), against personCapacityIn (holidays, absences, daily business, internal
// work and the support reserve taken off). `realistic` swaps two inputs for what the past says: the support reserve
// becomes the person's 80th percentile of booked support, and every remaining estimate is multiplied by the team's
// estimate factor (time spent ÷ estimate of finished stories) – both from shared/insights.js, as in "Realistische
// Kapazität".
//
// How it plans (minimal change – work that fits keeps its dates):
//   1. overdue, undated and inverted work (start after due) must get a real window; everything else stays where it is
//   2. a week still over the target: the lowest-priority story touching it leaves its window (repeat until it fits)
//   3. everything that left is placed again, highest priority first, into the free room per working day: the shortest
//      window from the earliest allowed day whose even share fits every day of it (never before today, never before
//      its planned start when it was only moved for room, never before a prerequisite's due date)
//   4. `pull`: room left in the coming weeks – later work moves forward when it then finishes no later than before
//   5. `handover`: work that would end after its own or its project's due date (or finds no room at all) is offered to
//      the team colleague whose free room finishes it earliest – visible people only
// Linear spread is per working day, so "fits every day" is the same as "every week stays within the target" in the
// engine's weekly sums. Pure – no React, no Forge, nothing is written here.
import { capacityPeople, personCapacityIn, spreadWindow, shareIn } from '../../engine.js';
import { inTeam } from '../../allocation.js';
import { isAnonId } from '../../weekPlan.js';
import { dayIdx, isoOf, mondayOf, isWeekday, nextWorkday, workdays, weeksFrom } from '../../dates.js';
import { computedOf, dsOf, rcOf } from '../kit.js';

export const REPLAN_ORDERS = ['rank', 'due'];
const ROOM_MIN = 0.25; // a working day with less free room than this cannot carry a window
const MAX_DAYS = 130; // a story is spread over at most 26 weeks
const EPS = 0.05;
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + (f(x) || 0), 0);
const isOpen = (i) => (i?.status?.cat ?? i?.statusCat ?? 'new') !== 'done';
const keyCmp = (a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true });

function comparator(order, rankOf) {
  const due = (t) => (t.e0 == null ? Infinity : t.e0);
  if (order === 'due') return (a, b) => due(a) - due(b) || rankOf(a.ref) - rankOf(b.ref) || keyCmp(a, b);
  return (a, b) => rankOf(a.ref) - rankOf(b.ref) || due(a) - due(b) || keyCmp(a, b);
}

export function replan(ctx, opts = {}) {
  const c = computedOf(ctx);
  const ds = dsOf(ctx);
  const { model } = c;
  const today = model.today;
  const target = Number.isFinite(+opts.target) && +opts.target > 0 ? +opts.target : 1;
  const order = REPLAN_ORDERS.includes(opts.order) ? opts.order : 'rank';
  const realistic = !!opts.realistic;
  const showWeeks = Math.max(4, Math.min(12, opts.showWeeks || 8));
  const H = Math.max(showWeeks, Math.min(104, opts.horizonWeeks || 52));
  const W = weeksFrom(today, H);
  const FIX = Math.max(1, Math.min(H, opts.fixWeeks || H)); // weeks whose overload is resolved (later weeks stay as they are)
  const focus = Array.isArray(opts.focus) && opts.focus[0] ? [dayIdx(opts.focus[0]), dayIdx(opts.focus[1] || opts.focus[0])] : null;
  const inFocusWeek = (w) => !focus || (W[w][0] <= focus[1] && W[w][1] >= focus[0]);
  const touchesFocus = (win) => !focus || W.some(([a, b], w) => inFocusWeek(w) && win[0] <= b && win[1] >= a);
  const lang = ctx.lang === 'en' ? 'en' : 'de';
  const capPeople = capacityPeople(model);
  const rankOf = (ref) => model.itemByRef.get(ref)?.rank ?? 1e9;
  const cmp = comparator(order, rankOf);

  // the working days of the horizon, from today on (days already behind us cannot take work)
  const D = [];
  for (let d = today; d <= W[H - 1][1]; d++) if (isWeekday(d)) D.push(d);
  const N = D.length;
  const posOf = (d) => { // first grid position at or after day d
    if (d <= D[0]) return 0;
    let lo = 0, hi = N;
    while (lo < hi) { const m = (lo + hi) >> 1; if (D[m] < d) lo = m + 1; else hi = m; }
    return lo;
  };
  const weekOfPos = D.map((d) => (mondayOf(d) - W[0][0]) / 7);
  const weekDays = W.map(([a, b]) => workdays(a, b));

  // the people this plan is for, and the colleagues who may take work over
  const anon = new Set();
  for (const i of ds.issues || []) if (i.assignee?.anon && i.assignee.id) anon.add(i.assignee.id);
  const hidden = (id) => !id || anon.has(id) || isAnonId(id);
  const ids = [...new Set((opts.people || []).filter((id) => capPeople.has(id) && !hidden(id)))];
  if (opts.team) for (const p of capPeople.values()) if (inTeam(p, opts.team) && !hidden(p.id) && !ids.includes(p.id)) ids.push(p.id);
  const rc = realistic ? rcOf(ctx, lang) : null;
  const rcPerson = new Map((rc?.people || []).map((x) => [x.id, x]));
  const factorOf = (pid) => (realistic ? Math.max(0.5, Math.min(3, +rcPerson.get(pid)?.estimate?.factor || 1)) : 1);
  const supportOf = (pid) => (realistic ? +rcPerson.get(pid)?.support?.p80 || 0 : c.support?.personWeekly?.[pid] || 0);

  // open stories with a remaining estimate, per assignee (as weeksUtilization reads them)
  // opts.estimates { issueId: hours }: stories without an estimate that get one in the same run – planned as if set
  const est = opts.estimates || {};
  const byPerson = new Map();
  for (const s0 of ds.issues || []) {
    const s = !(s0.re > 0) && +est[s0.id] > 0 ? { ...s0, re: +est[s0.id], _virtual: true } : s0;
    if (s.role !== 'estimate' || !isOpen(s) || !(s.re > 0) || !s.assignee?.id) continue;
    (byPerson.get(s.assignee.id) || byPerson.set(s.assignee.id, []).get(s.assignee.id)).push(s);
  }
  const preOf = new Map(), depOf = new Map();
  for (const d of c.deps?.list || []) {
    if (!d.open) continue;
    (preOf.get(d.dep) || preOf.set(d.dep, []).get(d.dep)).push(d.pre);
    (depOf.get(d.pre) || depOf.set(d.pre, []).get(d.pre)).push(d.dep);
  }
  const projectDue = (ref) => dayIdx(c.metrics?.get?.(ref)?.due || model.itemByRef.get(ref)?.due || null);

  const lockSet = new Set((opts.lock || []).map(String)); // stories the person chose to keep where they are
  const states = new Map();
  const taskOf = (s, pid) => {
    const factor = factorOf(pid);
    const win = spreadWindow(s, 're', today) || [nextWorkday(today), nextWorkday(today)];
    const s0 = dayIdx(s.start), e0 = dayIdx(s.due);
    return { id: s.id, key: s.key, summary: s.summary, ref: s.rootRef, teamId: s.team?.id || null, owner: pid, re: s.re, h: s.re * factor, start: s.start || null, due: s.due || null, s0, e0, win, overdue: e0 != null && e0 < today, undated: e0 == null,
      // start after the due date (data error): the cockpit books all hours into the due week – it needs a real window too
      inverted: s0 != null && e0 != null && s0 > e0 && e0 >= today, locked: hidden(pid) || !!s.assignee?.anon || lockSet.has(s.id), virtual: !!s._virtual };
  };
  // the day loads of a window [a, b] spread evenly over its working days (the engine's linear share)
  const spread = (st, t, win, sign) => {
    const n = workdays(win[0], win[1]);
    if (!n) { const k = posOf(nextWorkday(win[1])); if (k < N) { st.load[k] += sign * t.h; st.wload[weekOfPos[k]] += sign * t.h; } return; }
    const per = t.h / n;
    for (let k = posOf(win[0]); k < N && D[k] <= win[1]; k++) { st.load[k] += sign * per; st.wload[weekOfPos[k]] += sign * per; }
  };
  const stateOf = (pid) => {
    if (states.has(pid)) return states.get(pid);
    const p = capPeople.get(pid);
    if (!p) return null;
    const sup = supportOf(pid);
    const cap = W.map(([a, b]) => personCapacityIn(model, p, a, b, sup));
    const limit = cap.map((x) => x * target);
    const dayLimit = D.map((d, k) => (weekDays[weekOfPos[k]] ? limit[weekOfPos[k]] / weekDays[weekOfPos[k]] : 0));
    // the engine measures per WEEK: a placement must fit every day of its window AND every week it touches (a busy
    // Monday inside a week that still fits leaves less room on Wednesday than the day alone says – live finding)
    const wlim = new Array(H).fill(0);
    D.forEach((d, k) => { wlim[weekOfPos[k]] += dayLimit[k]; });
    const st = { id: pid, p, name: ds.people?.[pid]?.name || '', cap, limit, dayLimit, wlim, wload: new Array(H).fill(0), load: new Array(N).fill(0), tasks: (byPerson.get(pid) || []).map((s) => taskOf(s, pid)), support: sup, factor: factorOf(pid) };
    for (const t of st.tasks) if (!t.virtual) spread(st, t, t.win, 1);
    // focusBase: the week limit as it was before the closure – its excess load stays allowed
    st.allow = new Array(H).fill(0);
    if (focus && opts.focusBase) {
      const cap0 = W.map(([a, b]) => personCapacityIn(opts.focusBase, p, a, b, sup));
      const wlim0 = new Array(H).fill(0);
      D.forEach((d, k) => { const w = weekOfPos[k]; if (weekDays[w]) wlim0[w] += (cap0[w] * target) / weekDays[w]; });
      for (let w = 0; w < H; w++) if (inFocusWeek(w)) st.allow[w] = Math.max(0, st.wload[w] - wlim0[w]);
    }
    st.before = weekly({ ...st, tasks: st.tasks.filter((t) => !t.virtual) }, (t) => t.win);
    states.set(pid, st);
    return st;
  };
  // engine-equal weekly sums for a person with the given windows (before or after)
  const weekly = (st, winOf, measure = 'plan') => W.slice(0, showWeeks).map(([a, b], w) => {
    const plan = sum(st.tasks, (t) => shareIn(measure === 'nominal' ? t.re : t.h, a, b, winOf(t), 'linear'));
    const rest = w === 0 ? workdays(Math.max(a, today), b) : weekDays[w];
    const capRest = weekDays[w] ? (st.cap[w] * rest) / weekDays[w] : 0;
    return { from: isoOf(a), to: isoOf(b), plan, cap: st.cap[w], capRest, util: capRest > 0 ? plan / capRest : plan > 0 ? Infinity : 0, restDays: rest };
  });

  const planned = ids.map(stateOf).filter(Boolean);

  // 1 + 2: what must move, and what leaves an over-full week
  const toPlace = [];
  const fixed = new Set();
  for (const st of planned) {
    for (const t of st.tasks) {
      if (t.virtual) { if (t.locked) spread(st, t, t.win, 1); else { t.reason = 'estimated'; toPlace.push(t); } continue; }
      if (t.locked) continue;
      if ((t.overdue || t.undated || t.inverted) && touchesFocus(t.win)) { spread(st, t, t.win, -1); t.reason = t.overdue ? 'overdue' : t.undated ? 'undated' : 'inverted'; toPlace.push(t); }
      else fixed.add(t);
    }
    for (let w = 0; w < FIX; w++) {
      if (!inFocusWeek(w)) continue;
      for (let guard = 0; guard < 200 && st.wload[w] > st.wlim[w] + st.allow[w] + EPS; guard++) {
        const [a, b] = W[w];
        const cand = st.tasks.filter((t) => fixed.has(t) && t.win[0] <= b && t.win[1] >= a).sort(cmp);
        const worst = cand[cand.length - 1];
        if (!worst) break;
        fixed.delete(worst);
        spread(st, worst, worst.win, -1);
        worst.reason = 'overload';
        toPlace.push(worst);
      }
    }
  }

  // 3: place again, highest priority first
  const newWin = new Map(); // task id → [a, b]
  const winOf = (t) => newWin.get(t.id) || t.win;
  const dueNow = (id) => { const w = newWin.get(id); if (w) return w[1]; for (const st of states.values()) { const t = st.tasks.find((x) => x.id === id); if (t) return t.win[1]; } return dayIdx(model.byId.get(id)?.due || model.external?.get(id)?.due || null); };
  const earliestOf = (t) => {
    let e = today;
    if ((t.reason === 'overload' || t.reason === 'estimated') && t.s0 != null) e = Math.max(e, t.s0);
    if (t.reason === 'sooner') e = today;
    for (const pre of preOf.get(t.id) || []) { const pd = dueNow(pre); if (pd != null && pd >= e) e = pd + 1; }
    return e;
  };
  // the window that FINISHES earliest: for every start day the shortest window whose even share fits every day of it;
  // a later start may finish sooner (a thin 80-day spread loses to 18 full days after a busy stretch)
  const blocked = (st, k) => st.dayLimit[k] - st.load[k] < ROOM_MIN || st.wlim[weekOfPos[k]] - st.wload[weekOfPos[k]] < ROOM_MIN;
  const pack = (st, h, from) => {
    let best = null;
    const s0 = posOf(from);
    // free hours left in the horizon: not enough → no window anywhere (cheap exit for colleagues without room)
    let free = 0;
    for (let w = weekOfPos[Math.min(s0, N - 1)] ?? H; w < H; w++) free += Math.max(0, st.wlim[w] - st.wload[w]);
    if (free + 1e-6 < h) return null;
    for (let s = s0; s < N && (!best || s <= best[3]); s++) {
      if (blocked(st, s)) continue;
      // start candidates (speed): the earliest day, each Monday and the first free day after a blocked one – a start in the
      // middle of an open week is skipped; the result may then end a day or two later than the very best, never over the target
      if (s > s0 && weekOfPos[s] === weekOfPos[s - 1] && !blocked(st, s - 1)) continue;
      let min = Infinity, n = 0, hit = false;
      const days = new Map(); // week → working days of the window in it
      for (; n < MAX_DAYS && s + n < N && (!best || s + n < best[3]); n++) {
        const k = s + n;
        if (blocked(st, k)) break;
        const r = st.dayLimit[k] - st.load[k];
        if (r < min) min = r;
        days.set(weekOfPos[k], (days.get(weekOfPos[k]) || 0) + 1);
        const per = h / (n + 1);
        if (per > min + 1e-9) continue;
        let ok = true;
        for (const [w, c] of days) if (st.wload[w] + per * c > st.wlim[w] + 1e-6) { ok = false; break; }
        if (ok) { hit = true; break; }
      }
      if (hit) best = [D[s], D[s + n], s, s + n];
      else if (s + n < N && n < MAX_DAYS && blocked(st, s + n)) s += n; // a blocked day ends every window from here
    }
    return best;
  };
  const place = (st, t, win) => { newWin.set(t.id, win); spread(st, t, win, 1); };
  const limitDue = (t) => {
    const own = t.overdue || t.undated ? null : t.e0;
    const pd = projectDue(t.ref);
    const cands = [own, pd != null && pd >= today ? pd : null].filter((x) => x != null);
    return cands.length ? Math.min(...cands) : null;
  };
  const moves = [];
  const unplaced = [];
  const handoverPool = (t) => {
    if (!opts.handover || !t.teamId) return [];
    const out = [];
    for (const p of capPeople.values()) if (p.id !== t.owner && inTeam(p, t.teamId) && !hidden(p.id) && (+p.weeklyHours || 0) > 0) { const st = stateOf(p.id); if (st) out.push(st); }
    return out;
  };
  toPlace.sort(cmp);
  for (const t of toPlace) {
    const own = states.get(t.owner);
    const from = earliestOf(t);
    const hit = pack(own, t.h, from);
    const lim = limitDue(t);
    const late = !hit || (lim != null && hit[1] > lim);
    let to = null;
    if (late) {
      // a colleague with room that finishes it in time (or at least sooner)
      let best = null;
      for (const st of handoverPool(t)) {
        const h2 = t.re * st.factor;
        const x = pack(st, h2, from);
        if (x && (!best || x[1] < best.x[1])) best = { st, x, h2 };
      }
      if (best && (!hit || best.x[1] < hit[1]) && (lim == null || best.x[1] <= lim || !hit)) {
        to = { st: best.st, win: [best.x[0], best.x[1]] };
        const moved = { ...t, h: best.h2, owner: best.st.id };
        best.st.tasks.push(moved);
        newWin.set(t.id, to.win); spread(best.st, moved, to.win, 1);
        moves.push(moveOut(t, to.win, best.st, lim, 'handover'));
        continue;
      }
    }
    if (!hit) { unplaced.push({ id: t.id, key: t.key, summary: t.summary, ref: t.ref, owner: t.owner, h: t.h, reason: t.reason }); continue; }
    place(own, t, [hit[0], hit[1]]);
    moves.push(moveOut(t, [hit[0], hit[1]], null, lim, t.reason));
  }

  // 4: pull later work forward into free room (finishes no later than before)
  if (opts.pull) {
    for (const st of planned) {
      const later = st.tasks.filter((t) => fixed.has(t) && !newWin.has(t.id) && t.win[0] > W[0][1]).sort(cmp);
      for (const t of later) {
        const free = sum(D.map((d, k) => (weekOfPos[k] <= 1 ? Math.max(0, st.dayLimit[k] - st.load[k]) : 0)));
        if (free < 1) break;
        spread(st, t, t.win, -1);
        t.reason = 'sooner';
        const x = pack(st, t.h, earliestOf(t));
        if (x && x[0] < t.win[0] && x[1] <= t.win[1]) { place(st, t, [x[0], x[1]]); moves.push(moveOut(t, [x[0], x[1]], null, limitDue(t), 'sooner')); }
        else { spread(st, t, t.win, 1); delete t.reason; }
      }
    }
  }

  function moveOut(t, win, toSt, lim, reason) {
    const to = { start: isoOf(win[0]), due: isoOf(win[1]) };
    if (toSt) { to.assignee = toSt.id; to.assigneeName = toSt.name; }
    const lateBy = lim != null && win[1] > lim ? workdays(lim + 1, win[1]) : 0;
    return {
      issueId: t.id, key: t.key, summary: t.summary, ref: t.ref, reason, hours: t.h, re: t.re, owner: t.owner, ownerName: states.get(t.owner)?.name || '',
      from: { start: t.start, due: t.due, window: [isoOf(t.win[0]), isoOf(t.win[1])] }, to,
      late: lateBy > 0 ? { days: lateBy, limit: isoOf(lim), kind: lim === t.e0 && !t.overdue ? 'own' : 'project' } : null,
    };
  }

  // dependents that would now start before their prerequisite ends
  const warnings = [];
  for (const m of moves) for (const dep of depOf.get(m.issueId) || []) {
    const ds_ = newWin.get(dep)?.[0] ?? dayIdx(model.byId.get(dep)?.start || null);
    if (ds_ != null && dayIdx(m.to.due) >= ds_) warnings.push({ kind: 'dependent', key: m.key, depKey: model.byId.get(dep)?.key || model.external?.get(dep)?.key || null });
  }

  const helpers = [...states.values()].filter((st) => !planned.includes(st) && moves.some((m) => m.to.assignee === st.id));
  const outPerson = (st, role) => {
    const keepTasks = st.tasks.filter((t) => !moves.some((m) => m.issueId === t.id && m.to.assignee && m.to.assignee !== st.id && t.owner === st.id));
    const view = { ...st, tasks: keepTasks };
    const after = weekly(view, (t) => winOf(t));
    const afterNominal = weekly(view, (t) => winOf(t), 'nominal');
    return {
      id: st.id, name: st.name, role, teamId: st.p.teamId || null, factor: st.factor, support: st.support,
      before: st.before, after, afterNominal,
      overWeeksBefore: st.before.filter((w) => w.util > target + 0.005).length,
      overWeeksAfter: after.filter((w) => w.util > target + 0.005).length,
    };
  };
  return {
    weeks: W.slice(0, showWeeks).map(([a, b]) => ({ from: isoOf(a), to: isoOf(b) })),
    people: [...planned.map((st) => outPerson(st, 'planned')), ...helpers.map((st) => outPerson(st, 'helper'))],
    moves, unplaced, warnings,
    settings: { target, order, realistic, handover: !!opts.handover, pull: !!opts.pull, today: isoOf(today), horizonWeeks: H, focus: focus ? opts.focus : null },
  };
}
