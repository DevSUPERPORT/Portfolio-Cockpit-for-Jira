// Wochenplanung (UC-05): who works on which task in which week, and does it fit the capacity?
// Pure functions over the normalized dataset and computeAll() – no React, no Forge. Used by the board (UI), by the
// plan.apply resolver (payload validation) and by the tests.
//
// Planning basis (UC-05 acceptance criteria):
//   task hours per week = Original Estimate spread evenly over the working days between Start and Due date
//                         (engine spreadWindow 'oe' + shareIn 'linear' – the same distribution the rest of the app uses)
//   available per week  = weekly hours × (working days − public holidays − absences) ÷ 5, minus daily business and
//                         internal work (the team's project share, as in Capacity)
//   load                = the person's support share (Ø time spent, only on days they are there) + their task hours
//   utilisation         = load ÷ available; traffic light via utilTone (≤ 85 % ok, ≤ 100 % warn, > 100 % bad)
//
// Moves are collected client-side as { [issueId]: { start, due, assignee, assigneeName, orig, key, summary } } and
// only written with "Apply in Jira" (plan.apply). Every view (Wochenplanung, Teams, Projects) shares the same moves.
import { capacityPeople, teamSettings, projectShare, spreadWindow, weekShare, dependencies } from './engine.js';
import { teamIds } from './team.js';
import { personDays, daysOffOf } from './locations.js';
import { inTeam, shareOf, allocationOf } from './allocation.js';
import { memberStatus, membershipSource } from './teamMembership.js';
import { utilTone } from './kpis.js';
import { dayIdx, isoOf, weeksFrom, mondayOf, isWeekday, workdays } from './dates.js';

export const PLAN_WEEKS = 8;
export const MAX_MOVES = 100;
export const ACCOUNT_RE = /^[A-Za-z0-9:_-]{1,128}$/;
export const ISSUE_ID_RE = /^\d{1,18}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EPS = 0.05;
const isOpen = (i) => (i?.status?.cat ?? i?.statusCat ?? 'new') !== 'done';
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const ratio = (load, avail) => (avail > EPS ? load / avail : load > EPS ? Infinity : 0);
const toIdx = (d) => (d == null ? null : typeof d === 'number' ? d : dayIdx(d));

// Who may move cards: the editPlan permission; while that is not configured, ranking managers and Jira admins.
// (The server writes as the user anyway, so Jira has the last word on every work item.)
export const canPlan = (roles) => !!roles && (roles.editPlan !== undefined ? !!roles.editPlan : !!(roles.manageRanking || roles.admin));
// Privacy (UC-08): people outside the viewer's scope arrive pseudonymized (anon-… ids, empty names). They never
// get a row of their own – one "other people (sum only)" row per team – and their cards cannot be dragged.
export const isAnonId = (id) => typeof id === 'string' && id.startsWith('anon-');

// ---------- weeks ----------
// n ISO weeks from the current one: a = Monday, b = Sunday (day indices), from/to = Monday/Friday (ISO).
export function planWeeks(today, n = PLAN_WEEKS) {
  return weeksFrom(toIdx(today), n).map(([a, b], i) => ({ i, a, b, from: isoOf(a), to: isoOf(a + 4), current: i === 0 }));
}

// ---------- dates ----------
export const validIso = (s) => typeof s === 'string' && DATE_RE.test(s) && isoOf(dayIdx(s)) === s;
// Shift start and due by whole weeks (duration and weekday kept). A date that would land on a weekend moves to the
// nearest working day inside the task (start forward, due backward); due never ends up before start.
// Start after due in Jira (live: PCX-27, start Sun 20.12., due Tue 15.12.): the board shows the window between the two
// dates (spreadWindow sorts them), so the move works on that same window – earlier date = start, later = due. Before,
// the Sunday start rolled forward into the NEXT week and the first drag landed one column right of the drop.
export const datesInverted = ({ start, due } = {}) => !!(start && due && dayIdx(start) != null && dayIdx(due) != null && dayIdx(start) > dayIdx(due));
export function shiftDates(dates = {}, weeks = 0) {
  const { start = null, due = null } = datesInverted(dates) ? { start: dates.due, due: dates.start } : dates;
  const d = Math.round(weeks) * 7;
  const mv = (iso, forward) => {
    const x = dayIdx(iso);
    if (x == null) return iso ?? null;
    let y = x + d;
    while (!isWeekday(y)) y += forward ? 1 : -1;
    return isoOf(y);
  };
  const s = mv(start, true);
  let e = mv(due, false);
  if (s && e && dayIdx(e) < dayIdx(s)) e = s;
  return { start: s, due: e };
}

// ---------- moves ----------
const origOf = (issue) => ({ start: issue.start || null, due: issue.due || null, assignee: issue.assignee?.id || null, assigneeName: issue.assignee?.name || null, team: issue.team?.id || null, teamName: issue.team?.name || null });
// a move from before team changes (tester 2026-11-17) has no team – it keeps the work item's team
const teamOfMove = (m) => (m.team === undefined ? m.orig?.team ?? null : m.team);
const sameAsOrig = (m) => m.start === m.orig.start && m.due === m.orig.due && m.assignee === m.orig.assignee && teamOfMove(m) === (m.orig.team ?? null);
// The effective issue list: every pending move laid over the dataset (start, due, assignee).
export function applyMoves(issues, moves = {}) {
  if (!moves || !Object.keys(moves).length) return issues || [];
  return (issues || []).map((i) => {
    const m = moves[i.id];
    if (!m) return i;
    const assignee = m.assignee ? { ...(i.assignee?.id === m.assignee ? i.assignee : {}), id: m.assignee, name: m.assigneeName || (i.assignee?.id === m.assignee ? i.assignee.name : '') } : null;
    const team = m.team !== undefined && m.team !== (m.orig?.team ?? null) ? (m.team ? { id: m.team, name: m.teamName || '' } : null) : i.team;
    return { ...i, start: m.start, due: m.due, assignee, team };
  });
}
// Record a move. `issue` is the dataset (not the effective) work item; weeks are relative to its current pending
// position; assignee undefined = unchanged, null = unassigned. A move back to the original values disappears.
// start / due (ISO): set that date directly instead (the plan optimizer shortens a task by moving only its due date).
// team (id) + teamName: change the work item's team too (reassigning to someone from another team – tester 2026-11-17).
export function moveTask(moves, issue, { weeks = 0, assignee, assigneeName, start, due, team, teamName } = {}) {
  const cur = moves?.[issue.id];
  const orig = cur?.orig || origOf(issue);
  const base = cur || orig;
  const dates = weeks ? shiftDates(base, weeks) : { start: base.start, due: base.due };
  if (start !== undefined) dates.start = start || null;
  if (due !== undefined) dates.due = due || null;
  const changeA = assignee !== undefined;
  const next = {
    ...dates, assignee: changeA ? assignee || null : base.assignee, assigneeName: changeA ? (assignee ? assigneeName || null : null) : base.assigneeName,
    team: team !== undefined ? team || null : base.team === undefined ? orig.team ?? null : base.team, teamName: team !== undefined ? (team ? teamName || null : null) : base.teamName ?? orig.teamName ?? null,
    orig, key: issue.key, summary: issue.summary,
  };
  const out = { ...(moves || {}) };
  if (sameAsOrig(next)) delete out[issue.id];
  else out[issue.id] = next;
  return out;
}
export function undoMove(moves, id) { const out = { ...(moves || {}) }; delete out[id]; return out; }
// After a partial write: the written fields become the new original, the rest stays pending.
export function rebaseMove(moves, id, written = {}) {
  const m = moves?.[id];
  if (!m) return moves;
  const orig = { ...m.orig };
  if ('start' in written) orig.start = written.start;
  if ('due' in written) orig.due = written.due;
  if ('assignee' in written) { orig.assignee = written.assignee; orig.assigneeName = m.assigneeName; }
  if ('team' in written) { orig.team = written.team; orig.teamName = m.teamName; }
  const out = { ...moves, [id]: { ...m, orig } };
  if (sameAsOrig(out[id])) delete out[id];
  return out;
}
// What changes per work item (for the pending list): [before, after] pairs, null when unchanged.
export function pendingRows(moves = {}) {
  return Object.entries(moves || {}).map(([id, m]) => ({
    id, key: m.key, summary: m.summary,
    start: m.start !== m.orig.start ? [m.orig.start, m.start] : null,
    due: m.due !== m.orig.due ? [m.orig.due, m.due] : null,
    assignee: m.assignee !== m.orig.assignee ? [{ id: m.orig.assignee, name: m.orig.assigneeName }, { id: m.assignee, name: m.assigneeName }] : null,
    team: teamOfMove(m) !== (m.orig.team ?? null) ? [{ id: m.orig.team ?? null, name: m.orig.teamName || null }, { id: teamOfMove(m), name: m.teamName || null }] : null,
  }));
}
// The plan.apply payload: only the fields that change.
export function planPayload(moves = {}) {
  return pendingRows(moves).map((r) => ({
    issueId: r.id,
    ...(r.start ? { start: r.start[1] } : {}),
    ...(r.due ? { due: r.due[1] } : {}),
    ...(r.assignee ? { assignee: r.assignee[1].id || null } : {}),
    ...(r.team ? { team: r.team[1].id || null } : {}),
  }));
}
class PlanError extends Error { constructor(msg) { super(msg); this.code = 'INVALID'; } }
// Server-side validation of plan.apply: at most 100 moves, numeric issue ids (each once), ISO dates or null,
// account ids or null, start not after due. Returns clean moves with only the known fields.
export function validatePlanMoves(payload) {
  const list = payload?.moves;
  if (!Array.isArray(list) || !list.length) throw new PlanError('moves missing');
  if (list.length > MAX_MOVES) throw new PlanError(`at most ${MAX_MOVES} moves`);
  const seen = new Set();
  return list.map((m, k) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new PlanError(`move ${k} invalid`);
    const has = (f) => Object.prototype.hasOwnProperty.call(m, f);
    if (Object.keys(m).some((f) => !['issueId', 'start', 'due', 'assignee', 'team'].includes(f))) throw new PlanError(`move ${k}: unknown field`);
    if (typeof m.issueId !== 'string' || !ISSUE_ID_RE.test(m.issueId)) throw new PlanError(`move ${k}: issueId invalid`);
    if (seen.has(m.issueId)) throw new PlanError(`move ${k}: duplicate issue`);
    seen.add(m.issueId);
    if (!has('start') && !has('due') && !has('assignee') && !has('team')) throw new PlanError(`move ${k}: nothing to change`);
    if (has('team') && m.team !== null && (typeof m.team !== 'string' || !/^[A-Za-z0-9:-]{1,64}$/.test(m.team))) throw new PlanError(`move ${k}: team invalid`);
    for (const f of ['start', 'due']) if (has(f) && m[f] !== null && !validIso(m[f])) throw new PlanError(`move ${k}: ${f} invalid`);
    if (has('assignee') && m.assignee !== null && (typeof m.assignee !== 'string' || !ACCOUNT_RE.test(m.assignee))) throw new PlanError(`move ${k}: assignee invalid`);
    if (has('start') && has('due') && m.start && m.due && m.start > m.due) throw new PlanError(`move ${k}: start after due`);
    return { issueId: m.issueId, ...(has('start') ? { start: m.start } : {}), ...(has('due') ? { due: m.due } : {}), ...(has('assignee') ? { assignee: m.assignee } : {}), ...(has('team') ? { team: m.team } : {}) };
  });
}

// ---------- capacity per person and week ----------
// One person in one week: holidays of their location and recorded absences reduce the working days; daily
// business and internal work come off as in Capacity; support only counts on days the person is there.
// Working days, holidays and company days off come from the person's location (shared/locations.js).
export function personWeekAvail(model, person, a, b, supportWeekly = 0) {
  const { all, work, absent, days, perWeek } = personDays(model.cfg, person, model.ds.capacity?.absences, a, b);
  const weekly = +person.weeklyHours || 0;
  const nominal = (weekly * all) / perWeek;
  const gross = (weekly * days) / perWeek;
  const share = projectShare(teamSettings(model, person.teamId));
  const avail = gross * share;
  return { weekly, nominal, holidays: all - work, absent, days, gross, off: nominal - gross, daily: gross - avail, avail, support: (supportWeekly * days) / perWeek };
}
// ---------- people in several teams: whose time is it this week? ----------
// Boss 2026-11-20: "This is my capacity – why does the project view show 250 %? 2 × 125 %? It is always me – a
// calculation bug." It was: the team views counted ALL of a person's 40 h against only their 50 % share in the team (16 h),
// although his other team had nothing planned for him that week. The share is a GUARANTEE, not a cap:
//   entitled  = share × the person's time for projects (the same "available" as the person row)
//   load      = that team's tasks of the person + their support × share
//   a team that needs more than its share BORROWS what the person's other teams leave unused this week (shared out in
//   proportion to the need when several teams want it); a team never loses what it needs of its own share.
// So the teams' times always add up to the person's time, and the hours "too much" over all teams are exactly the
// person's own overload – one person-week, one number (40 h on 32 h = 8 h too much = 125 %, everywhere).
// Work in a team the person has no share in counts there with nothing entitled (it can only borrow); time not given to
// any team (shares below 100 %) is the REST bucket, like a team of its own.
export const REST = '_rest';
export function shareSplit({ alloc = [], avail = 0, support = 0, loads = {} } = {}) {
  const A = Math.max(0, +avail || 0);
  const shares = new Map();
  for (const x of alloc || []) if (x?.teamId && +x.pct > 0) shares.set(x.teamId, (shares.get(x.teamId) || 0) + x.pct / 100);
  const given = Math.min(1, sum([...shares.values()]));
  const rest = Math.max(0, 1 - given);
  const ids = [...shares.keys()];
  for (const k of Object.keys(loads || {})) if (!ids.includes(k)) ids.push(k);
  if (rest > 1e-9 && !ids.includes(REST)) ids.push(REST);
  const sh = (tid) => (tid === REST ? rest : given > 1 ? (shares.get(tid) || 0) / given : shares.get(tid) || 0);
  const list = ids.map((teamId) => {
    const share = sh(teamId);
    const sup = (+support || 0) * share;
    const load = (loads?.[teamId] || 0) + sup;
    const entitled = share * A;
    return { teamId, share, entitled, support: sup, tasks: loads?.[teamId] || 0, load, unused: Math.max(0, entitled - load), need: Math.max(0, load - entitled) };
  });
  const U = sum(list, (b) => b.unused), X = sum(list, (b) => b.need);
  const fB = X > 1e-9 ? Math.min(1, U / X) : 0; // the part of each need the unused time covers
  const fL = U > 1e-9 ? Math.min(1, X / U) : 0; // the part of each unused share that is lent
  const lenders = list.filter((b) => b.unused * fL > 1e-9);
  const borrowers = list.filter((b) => b.need * fB > 1e-9);
  const moved = sum(borrowers, (b) => b.need * fB);
  for (const b of list) {
    b.borrowed = b.need * fB;
    b.lent = b.unused * fL;
    b.time = b.entitled + b.borrowed - b.lent;
    b.over = b.need - b.borrowed;
    b.free = b.unused - b.lent;
    // who gave to whom (the explanation names the team the hours came from)
    b.from = b.borrowed > 1e-9 ? lenders.map((l) => ({ teamId: l.teamId, hours: (l.unused * fL * b.borrowed) / moved })) : [];
    b.to = b.lent > 1e-9 ? borrowers.map((x) => ({ teamId: x.teamId, hours: (b.lent * x.need * fB) / moved })) : [];
  }
  const byTeam = Object.fromEntries(list.map((b) => [b.teamId, b]));
  return { avail: A, support: +support || 0, list, byTeam, over: sum(list, (b) => b.over) };
}
const NO_PART = Object.freeze({ teamId: null, share: 0, entitled: 0, support: 0, tasks: 0, load: 0, unused: 0, need: 0, borrowed: 0, lent: 0, time: 0, over: 0, free: 0, from: [], to: [] });

// The 8-week summary of a person row – rounded first so hours and percentages add up in every column
// (weekly hours − absent − daily business − support − projects = free; negative = over).
export function personSummary(weeksAvail, taskHours) {
  const nominal = Math.round(sum(weeksAvail, (w) => w.nominal));
  const off = Math.max(0, Math.round(sum(weeksAvail, (w) => w.off)));
  const daily = Math.round(sum(weeksAvail, (w) => w.daily));
  const support = Math.round(sum(weeksAvail, (w) => w.support));
  const projects = Math.round(sum(taskHours));
  const free = nominal - off - daily - support - projects;
  const pc = (h) => (nominal ? Math.round((h / nominal) * 100) : 0);
  const pct = { off: pc(off), daily: pc(daily), support: pc(support), projects: pc(projects) };
  pct.free = nominal ? 100 - pct.off - pct.daily - pct.support - pct.projects : 0;
  return {
    weekly: weeksAvail[0]?.weekly || 0, nominal, off, daily, support, projects, free, pct,
    absentDays: sum(weeksAvail, (w) => w.absent), holidayDays: sum(weeksAvail, (w) => w.holidays),
  };
}

// ---------- distribution ----------
// Two ways to spread a task's Original Estimate over its weeks (the board's switch; admin default rules.distribution):
//   even      ('linear' / 'start' / 'due' in the config): the same share in every week of the window (weekShare)
//   capacity  ('capacity'): the hours stay strictly inside the task's start..due window – the dates never change –
//             "as even as possible, capped at each week's free room" (water-filling). Weeks before the current one
//             keep their even share (history unchanged). The rest (OE − those shares) starts as an even share per
//             week; a week whose free room (available × target − support − what higher-ranked tasks already placed,
//             never below 0) is smaller gets exactly its room; the excess goes evenly to the other weeks; repeat
//             until stable. Not enough room in the window: every week is filled to its room and the remainder is
//             spread evenly over all of them (the overload stays visible). Rank order (portfolio rank, then earlier
//             due) decides who gets the room first. Boss case: 32 h over 4 weeks with 16/16/5/15 h free → 9/9/5/9.
//             evenIds: tasks someone set back to the even share (central override, ds.planEven) – they keep it and
//             still use up room in rank order.
//             spread 'front' (inside the optimizer's "Finish sooner" only): fill the earliest weeks first – the week
//             the hours run out is the earliest due date that fits.
export const DISTRIBUTIONS = ['even', 'capacity'];
export const distributionOf = (rule) => (rule === 'capacity' ? 'capacity' : 'even');

// Water-filling: rest hours over weeks with the given free room (≥ 0). → { hours, rounds: [{ share, capped: [k] }],
// overflow, missing }. rounds explain it: the even share of each round and the weeks capped at their room.
export function waterFill(rest, rooms) {
  const n = rooms.length;
  const free = rooms.map((r) => Math.max(0, r));
  const total = free.reduce((x, y) => x + y, 0);
  if (!n) return { hours: [], rounds: [], overflow: rest > EPS, missing: rest };
  if (total < rest - 1e-9) {
    const each = (rest - total) / n;
    return { hours: free.map((r) => r + each), rounds: [{ share: rest / n, capped: free.map((r, k) => k) }], overflow: rest - total > EPS, missing: rest - total };
  }
  const hours = new Array(n).fill(0);
  let active = free.map((r, k) => k), left = rest;
  const rounds = [];
  for (let guard = 0; guard <= n && active.length; guard++) {
    const share = left / active.length;
    const capped = active.filter((k) => free[k] < share - 1e-9);
    rounds.push({ share, capped });
    if (!capped.length) { for (const k of active) hours[k] = share; break; }
    for (const k of capped) { hours[k] = free[k]; left -= free[k]; }
    active = active.filter((k) => !capped.includes(k));
  }
  return { hours, rounds, overflow: false, missing: 0 };
}

// → Map(task id → { byMonday: Map(Monday → hours, current week on), from (this Monday), finishWeek, dueWeek (Mondays),
//   weeksEarly, overflow, forced, why }). why = everything the reasoning card shows, with the board's own numbers:
//   { start, due, touched, past, oe, evenShare, rest, weeks: [{ week, avail, support, taken: [{ key, h }], room,
//   hours }], rounds: [{ share, capped: [week] }], missing, over: [week], forced }.
// Tasks without an assignee or without a working day keep the even share.
export function capacityFill(model, support, issues, { today = model.today, target = 1, maxWeeks = 104, spread = 'water', evenIds = null } = {}) {
  const t0 = mondayOf(toIdx(today));
  const forcedEven = evenIds instanceof Set ? evenIds : new Set(Object.keys(evenIds || {}));
  const list = [];
  let last = t0;
  for (const s of issues || []) {
    if (s.role !== 'estimate' || !isOpen(s) || !(s.oe > 0) || !s.assignee?.id) continue;
    const win = spreadWindow(s, 'oe', model.today);
    if (!win || win[1] < t0) continue;
    list.push({ s, win });
    last = Math.max(last, win[1]);
  }
  const H = Math.max(1, Math.min(maxWeeks, Math.floor((mondayOf(last) - t0) / 7) + 1));
  const W = weeksFrom(t0, H);
  const people = capacityPeople(model);
  const rank = (ref) => model.itemByRef.get(ref)?.rank ?? 1e9;
  const byPerson = new Map();
  for (const x of list) (byPerson.get(x.s.assignee.id) || byPerson.set(x.s.assignee.id, []).get(x.s.assignee.id)).push(x);
  const out = new Map();
  for (const [pid, ts] of byPerson) {
    const p = people.get(pid) || { id: pid, weeklyHours: 0, location: 'NONE', teamId: null };
    const av = W.map(([a, b]) => personWeekAvail(model, p, a, b, support?.personWeekly?.[pid] || 0));
    const room = av.map((x) => x.avail * target - x.support);
    const placed = W.map(() => []); // who took room in that week: [{ key, h }]
    ts.sort((x, y) => rank(x.s.rootRef) - rank(y.s.rootRef) || x.win[1] - y.win[1] || String(x.s.key).localeCompare(String(y.s.key)));
    for (const { s, win } of ts) {
      const [ws, we] = win;
      const touched = [];
      for (let m = mondayOf(ws); m <= we; m += 7) if (workdays(Math.max(m, ws), Math.min(m + 6, we)) > 0) touched.push(m);
      if (!touched.length) continue; // no working day in the window: stays as it is (all in the due week)
      const future = touched.filter((m) => m >= t0).map((m) => (m - t0) / 7).filter((wi) => wi < H);
      if (!future.length) continue;
      const rest = (s.oe * future.length) / touched.length; // OE minus the even shares of the past weeks
      const forced = forcedEven.has(String(s.id));
      const before = future.map((wi) => ({ week: isoOf(W[wi][0]), avail: av[wi].avail * target, support: av[wi].support, taken: placed[wi].slice(), room: Math.max(0, room[wi]) }));
      let h, rounds = [], overflow = false, missing = 0;
      if (forced) h = future.map(() => rest / future.length);
      else if (spread === 'front') {
        let left = rest;
        h = future.map((wi) => { const take = Math.min(left, Math.max(0, room[wi])); left -= take; return take; });
        overflow = left > EPS; missing = left;
        if (left > 1e-9) h = h.map((x) => x + left / future.length);
      } else ({ hours: h, rounds, overflow, missing } = waterFill(rest, future.map((wi) => room[wi])));
      const hours = new Map();
      future.forEach((wi, k) => { if (h[k] > 1e-9) { hours.set(wi, h[k]); room[wi] -= h[k]; placed[wi].push({ key: s.key, h: h[k] }); } });
      const fin = Math.max(...[...hours.entries()].filter(([, x]) => x > EPS).map(([wi]) => wi), future[0]);
      const dueWi = (mondayOf(we) - t0) / 7;
      out.set(s.id, {
        from: t0, byMonday: new Map([...hours].map(([wi, x]) => [W[wi][0], x])), finishWeek: W[fin][0], dueWeek: mondayOf(we),
        weeksEarly: overflow || forced ? 0 : Math.max(0, dueWi - fin), overflow, forced,
        why: {
          start: isoOf(ws), due: isoOf(we), touched: touched.length, past: touched.length - future.length, oe: s.oe, evenShare: rest / future.length, rest,
          weeks: before.map((x, k) => ({ ...x, hours: h[k] })),
          rounds: rounds.map((r) => ({ share: r.share, capped: r.capped.map((k) => before[k].week) })),
          missing, over: future.filter((wi) => room[wi] < -EPS).map((wi) => isoOf(W[wi][0])), forced,
        },
      });
    }
  }
  return out;
}
// Does the capacity split differ from the even share (worth a marker / a plan-log line)?
export const fillDiffers = (f) => !!f && !f.forced && f.why.weeks.some((w) => Math.abs(w.hours - f.why.evenShare) > EPS);

// Per-task "even" overrides (central, ds.planEven): { even: [issueId], auto: [issueId] }, at most 200 ids per call.
export const MAX_EVEN = 200;
export function validateEvenPayload(payload) {
  const list = (k) => {
    const v = payload?.[k] ?? [];
    if (!Array.isArray(v)) throw new PlanError(`${k} must be a list`);
    for (const id of v) if (typeof id !== 'string' || !ISSUE_ID_RE.test(id)) throw new PlanError(`${k}: issue id invalid`);
    return [...new Set(v)];
  };
  const even = list('even'), auto = list('auto');
  if (!even.length && !auto.length) throw new PlanError('nothing to change');
  if (even.length + auto.length > MAX_EVEN) throw new PlanError(`at most ${MAX_EVEN} work items`);
  if (even.some((id) => auto.includes(id))) throw new PlanError('an issue cannot be in both lists');
  return { even, auto };
}
// The exact undo of an applied plan move (plan.apply result row): the fields it wrote, with the values Jira had before.
export function undoMoveOf(result) {
  if (!result || !(result.ok || result.partial)) return null;
  const keys = result.ok ? Object.keys(result.before || {}) : Object.keys(result.written || {});
  if (!keys.length) return null;
  return { issueId: result.issueId, ...Object.fromEntries(keys.map((k) => [k, result.before?.[k] ?? null])) };
}

// ---------- tasks ----------
// Open stories with an Original Estimate and a start or due date, with their hours per board week.
// fill (optional, capacityFill): the capacity distribution from the current week on; earlier weeks stay even.
export function planTasks(model, issues, weeks, fill = null) {
  const out = [];
  // a window wholly before the first or after the last board week has no hours in any of them (weekShare is 0 for
  // e < a or s > b) – skipped before the per-week work (most stories of a big site lie outside the 8 weeks)
  let minA = Infinity, maxB = -Infinity;
  for (const w of weeks) { if (w.a < minA) minA = w.a; if (w.b > maxB) maxB = w.b; }
  for (const s of issues || []) {
    if (s.role !== 'estimate' || !isOpen(s) || !(s.oe > 0)) continue;
    const win = spreadWindow(s, 'oe', model.today);
    if (!win) continue;
    const f = fill?.get(s.id) || null;
    if (!f && (win[1] < minA || win[0] > maxB)) continue;
    const hours = weeks.map((w) => (f && w.a >= f.from ? f.byMonday.get(w.a) || 0 : weekShare(s.oe, w.a, w.b, win))); // evenly per week (UC-05) or by free capacity
    if (sum(hours) <= EPS) continue;
    const m0 = mondayOf(win[0]);
    out.push({
      id: s.id, key: s.key, summary: s.summary, ref: s.rootRef, teamId: s.team?.id || null,
      assignee: s.assignee?.id || null, assigneeName: s.assignee?.name || null, start: s.start || null, due: s.due || null, oe: s.oe, win, hours,
      len: (mondayOf(win[1]) - m0) / 7 + 1, idxOf: (w) => (w.a - m0) / 7 + 1, fill: f,
    });
  }
  return out;
}

// Every part of one task (planTasks entry), not only the board's weeks – for the hover card ("PCX-45, 38 h in
// 10 parts: KW 50 3,8 h … KW 7 3,7 h"): even per week inside the window, or the capacity split from its first week on
// (which may run past the due week – then those weeks are marked late). → [{ idx, monday (ISO), hours, late }]
export function taskParts(t) {
  if (!t?.win) return [];
  const m0 = mondayOf(t.win[0]), m1 = mondayOf(t.win[1]);
  const byMonday = new Map();
  for (let a = m0, n = 0; a <= m1 && n < 156; a += 7, n++) byMonday.set(a, t.fill && a >= t.fill.from ? t.fill.byMonday.get(a) || 0 : weekShare(t.oe, a, a + 6, t.win));
  if (t.fill) for (const [a, h] of t.fill.byMonday) if (a > m1 && h > EPS) byMonday.set(a, h);
  return [...byMonday.entries()].sort((x, y) => x[0] - y[0]).filter(([, h]) => h > EPS)
    .map(([a, h], i) => ({ idx: i + 1, monday: isoOf(a), hours: h, late: a > m1 }));
}

// ---------- dependencies on the effective dates ----------
// The engine's own dependency check (configured link types, reversed types, open items only), run on the dates as
// they would be after the pending moves. Conflict = the prerequisite's due date is after the dependent's start.
// deps: the engine's dependencies(model, null) of this model (computed.deps), reused when nothing is pending and the
// configuration is the model's – then the effective work items ARE the model's and the list is the same.
const depsByModel = new WeakMap();
export function conflicts({ model, moves = {}, config = null, scope = null, deps = null }) {
  const plain = (!moves || !Object.keys(moves).length) && (!config || config === model.cfg);
  const eff = plain ? model.ds.issues || [] : applyMoves(model.ds.issues || [], moves);
  const byId = plain && model.byId ? model.byId : new Map(eff.map((i) => [i.id, i]));
  const m = { ...model, cfg: config || model.cfg, ds: { ...model.ds, issues: eff }, byId };
  let list;
  if (plain) {
    list = deps?.list || depsByModel.get(model);
    if (!list) { list = dependencies(m, null).list; depsByModel.set(model, list); }
  } else list = dependencies(m, null).list;
  const info = (id) => {
    const i = byId.get(id) || model.external.get(id);
    if (!i) return null;
    const hidden = !!(i.assignee?.anon || isAnonId(i.assignee?.id));
    return { id, key: i.key, summary: i.summary, assignee: i.assignee?.id || null, assigneeName: hidden ? null : i.assignee?.name || null, hidden, teamId: i.team?.id || null, ref: i.rootRef || null, start: i.start || null, due: i.due || null, internal: byId.has(id) };
  };
  const out = [];
  for (const d of list) {
    if (!d.conflict) continue;
    const pre = info(d.pre), dep = info(d.dep);
    if (!pre || !dep) continue;
    const c = { id: String(d.id), pre, dep, days: d.conflictDays, pending: !!(moves?.[pre.id] || moves?.[dep.id]) };
    if (scope && !scope(c)) continue;
    c.fix = fixFor(c);
    out.push(c);
  }
  return out.sort((a, b) => (b.pending - a.pending) || (b.days - a.days));
}
// Fix: move the dependent work item to the week after the prerequisite's due date (whole weeks, duration kept).
// Without a start date (tester 2026-11-17: "PCX-2 starts before PCX-1 ends" had no action): start on the first working
// day after the prerequisite's due date; the due date moves along only when it would come before that start.
export function fixFor(c) {
  if (!c?.dep?.internal || !c.pre?.due) return null;
  if (!c.dep.start) {
    let s = dayIdx(c.pre.due) + 1;
    while (!isWeekday(s)) s++;
    const due = c.dep.due && dayIdx(c.dep.due) >= s ? c.dep.due : isoOf(s);
    return { issueId: c.dep.id, start: isoOf(s), due, startOnly: true };
  }
  const weeks = (mondayOf(dayIdx(c.pre.due)) + 7 - mondayOf(dayIdx(c.dep.start))) / 7;
  if (!(weeks > 0)) return null;
  return { issueId: c.dep.id, weeks, ...shiftDates(c.dep, weeks) };
}

// The split of every story over the board weeks, kept per model + work-item array (+ weeks, distribution, overrides):
// the year view, Lotse's year check and the board ask for the same split many times (one board per project) – the
// arrays are immutable per data state (a reload or a pending move makes new ones), so a hit is always current.
// The task objects are shared read-only; nothing downstream writes to them.
const splitCache = new WeakMap();
function splitOf(model, support, eff, W, byCapacity, evenIds) {
  let perModel = splitCache.get(model);
  if (!perModel) splitCache.set(model, (perModel = new WeakMap()));
  let perEff = perModel.get(eff);
  if (!perEff) perModel.set(eff, (perEff = new Map()));
  const key = `${W[0].a}|${W.length}|${byCapacity ? 'c' : 'e'}`;
  const hit = perEff.get(key);
  if (hit && hit.support === support && hit.evenIds === evenIds) return hit;
  const fill = byCapacity ? capacityFill(model, support, eff, { today: W[0].a, evenIds }) : null;
  const out = { fill, tasks: planTasks(model, eff, W, fill), support, evenIds };
  perEff.set(key, out);
  if (perEff.size > 8) perEff.delete(perEff.keys().next().value);
  return out;
}

// ---------- the board ----------
// team: one team (rows = people, or with mode 'projects' = support + projects in rank order); project: one
// project (rows = the people working on it); neither: all teams (one row per team, read-only).
// distribution: 'even' (default) or 'capacity' (capacityFill – the board's switch).
export function buildBoard({ ds, computed, config = null, team = null, project = null, mode = 'people', weeks: nWeeks = PLAN_WEEKS, today = null, moves = {}, distribution = 'even' }) {
  const model = computed.model;
  const support = computed.support;
  const W = planWeeks(today == null ? model.today : toIdx(today), nWeeks);
  const people = capacityPeople(model);
  const names = ds.people || {};
  const eff = applyMoves(ds.issues || model.ds.issues || [], moves);
  const byCapacity = distribution === 'capacity';
  const { fill, tasks } = splitOf(model, support, eff, W, byCapacity, ds.planEven);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const rankOf = (ref) => model.itemByRef.get(ref)?.rank ?? 1e9;
  const colorIdx = new Map(model.items.map((p, i) => [p.ref, i]));
  const kind = project ? 'project' : team ? (mode === 'projects' ? 'projects' : 'people') : 'teams';
  const inScope = (t) => (project ? t.ref === project : team ? t.teamId === team : true);
  const scopeTasks = tasks.filter(inScope);
  const anon = new Set();
  for (const i of ds.issues || []) if (i.assignee?.anon && i.assignee.id) anon.add(i.assignee.id);
  const hidden = (id) => !!id && (anon.has(id) || isAnonId(id));
  const nameOf = (id) => (hidden(id) ? '' : names[id]?.name || tasks.find((t) => t.assignee === id)?.assigneeName || people.get(id)?.name || '');

  // conflicts within the scope; their work items get a red ring
  const conf = conflicts({
    model, moves, config, deps: computed.model === model ? computed.deps : null,
    scope: kind === 'teams' ? null : (c) => [c.pre, c.dep].some((x) => (project ? x.ref === project : x.teamId === team)),
  });
  const conflictIds = new Set(conf.flatMap((c) => [c.pre.id, c.dep.id]));

  const byPerson = new Map();
  for (const t of tasks) if (t.assignee) (byPerson.get(t.assignee) || byPerson.set(t.assignee, []).get(t.assignee)).push(t);
  for (const l of byPerson.values()) l.sort((x, y) => x.win[0] - y.win[0] || String(x.key).localeCompare(String(y.key)));
  const avail = new Map();
  const weeksOf = (id) => {
    if (!avail.has(id)) {
      const p = people.get(id) || { id, weeklyHours: 0, location: 'NONE', teamId: null };
      avail.set(id, W.map((w) => personWeekAvail(model, p, w.a, w.b, support?.personWeekly?.[id] || 0)));
    }
    return avail.get(id);
  };
  const loadOf = (id, wi) => { const a = weeksOf(id)[wi]; const h = a.support + sum(byPerson.get(id) || [], (t) => t.hours[wi]); return { load: h, avail: a.avail, util: ratio(h, a.avail) }; };
  // a person's week split over their teams (shareSplit): what a team may count of them this week
  const splitCache = new Map();
  const splitWeek = (id, wi) => {
    const k = `${id}|${wi}`;
    let s = splitCache.get(k);
    if (!s) {
      const a = weeksOf(id)[wi];
      const loads = {};
      for (const t of byPerson.get(id) || []) { const h = t.hours[wi]; if (h > 0) { const tid = t.teamId || REST; loads[tid] = (loads[tid] || 0) + h; } }
      s = shareSplit({ alloc: allocationOf(people.get(id)), avail: a.avail, support: a.support, loads });
      splitCache.set(k, s);
    }
    return s;
  };
  const partOf = (id, wi, tid) => splitWeek(id, wi).byTeam[tid] || NO_PART;
  // everyone who counts for a team this week: its members, and whoever works on its tasks. Someone from another team
  // brings what their own teams leave unused that week (shareSplit: no share here, they can only borrow) – production
  // 2026-11-20: a helper (Dev Team) did all of Zahlungsverkehr's work with room to spare, yet the Integration row said
  // "22 h too much" because his hours counted and his time did not. Their own team keeps its guarantee.
  const membersOf = (tid) => [...people.values()].filter((p) => inTeam(p, tid)).map((p) => p.id);
  const crewOf = (tid) => { const ids = new Set(membersOf(tid)); for (const t of tasks) if (t.teamId === tid && t.assignee) ids.add(t.assignee); return [...ids]; };
  // A team's week PERSON BY PERSON (production 2026-11-20): each person's work for the team against the time the team may
  // count of them; what does not fit a person is "too much" – another person's spare hours do not make it fit (that takes
  // a hand-over), so the team's number is always the sum of its people's. Work nobody is assigned to draws on what is left.
  //   over = Σ what does not fit · free = Σ room left · avail (for the words and the %) = what fits (when something is
  //   over) or planned + room left; time = the team's whole time this week
  const unassignedOf = (tid, wi) => sum(tasks, (t) => (t.teamId === tid && !t.assignee ? t.hours[wi] : 0));
  const fitCell = (load, over, free, time) => { const avail = over > EPS ? Math.max(0, load - over) : load + free; return { load, avail, over, free, time, util: ratio(load, avail) }; };
  // unassigned: only the Projekte board adds work nobody is assigned to (its rows show it); the people board and the Teams
  // overview count the people's work, as before
  const teamWeek = (tid, crew, wi, { unassigned = false } = {}) => {
    let load = 0, over = 0, free = 0, time = 0;
    for (const id of crew) { const b = partOf(id, wi, tid); load += b.load; time += b.time; over += b.over; free += b.free; }
    const u = unassigned ? unassignedOf(tid, wi) : 0, used = Math.min(u, free);
    return fitCell(load + u, over + u - used, free - used, time);
  };
  const card = (t, w, wi) => ({
    kind: 'task', id: t.id, key: t.key, summary: t.summary, ref: t.ref, project: model.itemByRef.get(t.ref)?.name || '', color: colorIdx.get(t.ref) ?? -1,
    hours: t.hours[wi], idx: t.idxOf(w), len: t.len, pending: !!moves?.[t.id], conflict: conflictIds.has(t.id),
    assignee: t.assignee, assigneeName: t.assignee ? nameOf(t.assignee) || null : null, teamId: t.teamId, start: t.start, due: t.due, oe: t.oe,
    hidden: hidden(t.assignee), locked: hidden(t.assignee),
    // capacity distribution: when the hours run out (done before the due week?) and whether this is the last week
    finish: t.fill ? { week: isoOf(t.fill.finishWeek), early: t.fill.weeksEarly, overflow: t.fill.overflow } : null, last: !!t.fill && w.a === t.fill.finishWeek,
    byCapacity: fillDiffers(t.fill), forcedEven: !!t.fill?.forced,
    whoUtil: t.assignee && !hidden(t.assignee) ? loadOf(t.assignee, wi).util : null,
  });
  const cellBase = (wi) => ({ week: wi, cards: [], ghosts: [] });
  const tone = (u) => (u === Infinity ? 'bad' : u > 0 ? utilTone(u) : null);
  const overCount = (cells) => cells.filter((c) => c.avail != null && (c.util > 1.0001 || (c.noCapacity && c.load > EPS))).length;

  // one person row: support card first, then the scope's tasks, then what the person does elsewhere
  const personRow = (id, scopeFilter) => {
    const wa = weeksOf(id);
    const mine = byPerson.get(id) || [];
    const cells = W.map((w, wi) => {
      const a = wa[wi];
      const c = { ...cellBase(wi), avail: a.avail, support: a.support, absent: a.absent, holidays: a.holidays, days: a.days };
      let own = 0, other = 0;
      const otherKeys = new Set();
      for (const t of mine) {
        const h = t.hours[wi];
        if (h <= EPS) continue;
        if (scopeFilter(t)) { own += h; c.cards.push(card(t, w, wi)); } else { other += h; otherKeys.add(project ? (t.ref || '') : (t.teamId || '')); }
      }
      c.tasks = own + other; c.own = own; c.other = other;
      c.load = a.support + own + other;
      c.util = ratio(c.load, a.avail);
      c.tone = tone(c.util);
      c.absentAll = a.days === 0 && a.weekly > 0;
      if (!project && a.support > 0.4) c.cards.unshift({ kind: 'support', id: `sup:${id}:${wi}`, hours: a.support });
      // other teams' work (team board) counts in the load and shows as one quiet card; on a project board the
      // head's overall % says it (support and other projects), the cell keeps only this project's cards
      if (!project && other > 0.4) c.cards.push({ kind: 'other', id: `oth:${id}:${wi}`, hours: other, teams: [...otherKeys].filter(Boolean) });
      return c;
    });
    const p = people.get(id);
    // share = the person's share in this team (split across teams); the cells stay the person's whole week
    const share = team ? shareOf(p, team) : 1;
    return {
      id: `p:${id}`, kind: 'person', accountId: id, name: nameOf(id), teamId: p?.teamId || null, derived: !!p?.derived, inTeam: team ? share > 0 : true,
      member: team ? memberStatus(model, id, team, people) : null, memberSrc: team ? membershipSource(model, team) : null,
      share, pct: team && share > 0 && share < 1 ? Math.round(share * 100) : null,
      summary: personSummary(wa, cells.map((c) => c.tasks)), total: sum(cells, (c) => c.own), over: overCount(cells), cells,
    };
  };
  // people outside the viewer's privacy scope: one row per team with the sums only, no cards to drag
  const hiddenRow = (tid, ids, scopeFilter) => {
    const each = ids.map((id) => personRow(id, scopeFilter));
    // 2026-11-23 (boss: "the sum … is not correct, or?"): like every person row, the whole week – the sum row below
    // adds the rows up, so the hidden people count exactly as they would with names
    const w8 = () => 1;
    const cells = W.map((w, wi) => {
      const f = (k) => sum(each, (r) => r.cells[wi][k] * w8(r));
      const c = { ...cellBase(wi), avail: f('avail'), support: f('support'), tasks: f('tasks'), own: sum(each, (r) => r.cells[wi].own), other: f('other'), load: f('load'), absent: 0, holidays: 0, days: sum(each, (r) => r.cells[wi].days) };
      const cs = each.map((r) => r.cells[wi]);
      c.util = ratio(c.load, c.avail);
      c.tone = tone(c.util);
      const n = sum(cs, (x) => x.cards.filter((k) => k.kind === 'task').length);
      if (c.own > 0.4) c.cards.push({ kind: 'hiddenSum', id: `hid:${tid}:${wi}`, hours: c.own, count: n });
      return c;
    });
    return {
      id: `h:${tid}`, kind: 'hidden', teamId: tid === '_none' ? null : tid, name: '', count: ids.length, inTeam: team ? tid === team : true,
      total: sum(cells, (c) => c.own), over: overCount(cells), cells,
    };
  };
  const unassignedRow = (list) => ({
    id: 'u', kind: 'unassigned', name: '', total: sum(list, (t) => sum(t.hours)), over: 0,
    cells: W.map((w, wi) => {
      const c = { ...cellBase(wi), avail: null };
      for (const t of list) if (t.hours[wi] > EPS) c.cards.push(card(t, w, wi));
      c.load = sum(c.cards, (x) => x.hours);
      return c;
    }),
  });

  const rows = [];
  let foot = null;
  let footIds = [];
  if (kind === 'teams') {
    for (const tid of teamIds(computed)) {
      // people split across teams: the team's own work of each person against the time the team may count of them this
      // week (their share, plus what their other teams leave unused – shareSplit); helpers from outside count with their
      // work for this team and the time they can give it
      const members = [...people.values()].filter((p) => inTeam(p, tid)).map((p) => p.id);
      const shareIn = new Map(members.map((id) => [id, shareOf(people.get(id), tid)]));
      const teamTasks = tasks.filter((t) => t.teamId === tid);
      if (!members.length && !teamTasks.length) continue;
      const crew = crewOf(tid);
      const cells = W.map((w, wi) => {
        const ls = crew.map((id) => { const x = loadOf(id, wi), f = shareIn.get(id) || 0, part = partOf(id, wi, tid); return { id, load: part.load, avail: part.time, util: x.util, personAvail: x.avail, pct: f > 0 && f < 1 ? Math.round(f * 100) : null, guest: !(f > 0), absent: weeksOf(id)[wi].absent, holidays: weeksOf(id)[wi].holidays }; })
          .filter((x) => !x.guest || x.load > EPS); // helpers only in the weeks they work for the team
        const guests = sum(ls.filter((x) => x.guest), (x) => x.load);
        const tw = teamWeek(tid, crew, wi);
        const load = tw.load, av = tw.avail, util = tw.util;
        const shown = ls.filter((x) => !hidden(x.id)), folded = ls.filter((x) => hidden(x.id));
        const fl = sum(folded, (x) => x.load), fa = sum(folded, (x) => x.avail);
        return {
          ...cellBase(wi), load, avail: av, util, tone: tone(util), guests, over: tw.over, free: tw.free, time: tw.time,
          absentPeople: shown.filter((x) => x.absent > 0 || x.holidays > 0).map((x) => ({ id: x.id, name: nameOf(x.id), absent: x.absent, holidays: x.holidays })),
          cards: [
            ...shown.map((x) => ({ kind: 'member', id: `m:${x.id}:${wi}`, accountId: x.id, name: nameOf(x.id), load: x.load, avail: x.avail, util: x.util, personAvail: x.personAvail, tone: tone(x.util), pct: x.pct, guest: x.guest })),
            ...(folded.length ? [{ kind: 'member', id: `m:hidden:${tid}:${wi}`, hidden: true, count: folded.length, name: '', load: fl, avail: fa, util: ratio(fl, fa), tone: tone(ratio(fl, fa)) }] : []),
          ],
        };
      });
      rows.push({
        id: `t:${tid}`, kind: 'team', teamId: tid, name: model.teams.get(tid)?.name || tid, members: members.length,
        weekly: sum(members, (id) => (+people.get(id)?.weeklyHours || 0) * shareIn.get(id)), total: sum(teamTasks, (t) => sum(t.hours)), over: overCount(cells), cells,
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    foot = W.map((w, wi) => { const load = sum(rows, (r) => r.cells[wi].load), av = sum(rows, (r) => r.cells[wi].avail); return { load, avail: av, util: ratio(load, av) }; });
  } else if (kind === 'people' || kind === 'project') {
    const ids = new Set();
    if (kind === 'people') for (const p of people.values()) if (inTeam(p, team)) ids.add(p.id);
    for (const t of scopeTasks) if (t.assignee) ids.add(t.assignee);
    const list = [...ids].filter((id) => !hidden(id)).map((id) => personRow(id, inScope));
    const hiddenByTeam = new Map();
    for (const id of ids) if (hidden(id)) { const tid = (team && inTeam(people.get(id), team) ? team : people.get(id)?.teamId) || '_none'; (hiddenByTeam.get(tid) || hiddenByTeam.set(tid, []).get(tid)).push(id); }
    for (const [tid, hs] of hiddenByTeam) list.push(hiddenRow(tid, hs, inScope));
    const tname = (r) => String(model.teams.get(r.teamId)?.name || '~');
    list.sort((a, b) => (kind === 'project' ? tname(a).localeCompare(tname(b), 'de') : 0) || ((a.kind === 'hidden') - (b.kind === 'hidden')) || a.name.localeCompare(b.name, 'de') || tname(a).localeCompare(tname(b), 'de'));
    rows.push(...list);
    const un = scopeTasks.filter((t) => !t.assignee);
    if (kind === 'people' || un.length) rows.push(unassignedRow(un));
    // Personen board, "Summe" = the rows above added up (boss 2026-11-23, dev KW 48: one person 73 h on 28 h = 261 %, the sum
    // said "fast voll 100 %" – it counted only the CEO team's slice of him, whose unused time his other teams had borrowed).
    // Each person with their whole week (all teams, as the row shows it), person by person: what does not fit one person
    // is too much – another person's free hours do not make it fit (that takes a hand-over). Work nobody is assigned to
    // draws on what is left. The team's own slice stays in the Teams overview and on the Projekte board.
    footIds = kind === 'project' ? [] : [...ids];
    foot = kind === 'project'
      ? W.map((w, wi) => ({ load: sum(scopeTasks, (t) => t.hours[wi]), avail: null, util: null }))
      : W.map((w, wi) => {
        let load = 0, over = 0, free = 0, time = 0;
        for (const id of ids) { const x = loadOf(id, wi); load += x.load; time += x.avail; over += Math.max(0, x.load - x.avail); free += Math.max(0, x.avail - x.load); }
        const u = sum(un, (t) => t.hours[wi]), used = Math.min(u, free);
        return { ...fitCell(load + u, over + u - used, free - used, time), people: ids.size, unassigned: u, sumOf: 'people' };
      });
  } else {
    // projects: support first, then the projects in portfolio rank, each consuming what the ones above left
    // the team's time this week: per person their share plus what their other teams leave unused (shareSplit – boss
    // 2026-11-20: a 50 % member with nothing to do in the other team is NOT capped at 50 %)
    const members = crewOf(team);
    const part = (id, wi) => partOf(id, wi, team);
    const teamAvail = W.map((w, wi) => sum(members, (id) => part(id, wi).time));
    const sup = W.map((w, wi) => sum(members, (id) => part(id, wi).support));
    // what each person has left for the team's projects after support – used up in portfolio rank, person by person
    const rem = W.map((w, wi) => new Map(members.map((id) => [id, part(id, wi).time - part(id, wi).support])));
    rows.push({
      id: 's', kind: 'support', name: '', total: sum(sup), over: 0,
      cells: W.map((w, wi) => ({
        ...cellBase(wi), load: sup[wi], avail: teamAvail[wi], util: ratio(sup[wi], teamAvail[wi]), tone: null,
        cards: sup[wi] > 0.4 ? [{ kind: 'support', id: `sup:team:${wi}`, hours: sup[wi], people: [
          ...members.filter((id) => !hidden(id)).map((id) => ({ id, name: nameOf(id), hours: part(id, wi).support })),
          { id: 'hidden', name: '', hidden: true, hours: sum(members.filter(hidden), (id) => part(id, wi).support) },
        ].filter((x) => x.hours > 0.4) }] : [],
      })),
    });
    const refs = [...new Set(scopeTasks.map((t) => t.ref))].sort((a, b) => rankOf(a) - rankOf(b) || String(a).localeCompare(String(b)));
    for (const ref of refs) {
      const ts = scopeTasks.filter((t) => t.ref === ref).sort((x, y) => x.win[0] - y.win[0] || String(x.key).localeCompare(String(y.key)));
      const cells = W.map((w, wi) => {
        const c = cellBase(wi);
        for (const t of ts) if (t.hours[wi] > EPS) c.cards.push(card(t, w, wi));
        c.load = sum(c.cards, (x) => x.hours);
        // person by person: their hours here against what they have left after support and the higher-ranked projects
        const r = rem[wi];
        const byP = new Map();
        let u = 0;
        for (const t of ts) { const h = t.hours[wi]; if (h <= EPS) continue; if (t.assignee) byP.set(t.assignee, (byP.get(t.assignee) || 0) + h); else u += h; }
        const ppl = [...byP].map(([id, h]) => {
          const b = part(id, wi), cur = r.has(id) ? r.get(id) : 0;
          const before = Math.max(0, cur);
          r.set(id, cur - h);
          return { id, hours: h, before, over: Math.max(0, h - before), time: b.time, support: b.support, higher: Math.max(0, b.time - b.support - before) };
        });
        // work nobody is assigned to: what is left in the team
        const pool = sum([...r.values()], (v) => Math.max(0, v));
        const usedU = Math.min(u, pool);
        if (usedU > 0) for (const [id, v] of r) if (v > 0) r.set(id, v - (usedU * v) / pool);
        const over = sum(ppl, (p) => p.over) + (u - usedU);
        const free = sum([...r.values()], (v) => Math.max(0, v));
        const fc = fitCell(c.load, over, free, teamAvail[wi]);
        c.avail = fc.avail; c.util = fc.util; c.over = over; c.free = free;
        // for "Warum?": who works on it, what they had left, the unassigned part and the pool it drew on
        c.people = ppl.map((p) => ({ ...p, hidden: hidden(p.id) }));
        c.unassigned = { hours: u, pool, over: u - usedU };
        c.basis = { team: teamAvail[wi], support: sup[wi], higher: sum(ppl, (p) => p.higher), here: sum(ppl, (p) => p.before) + (u > EPS ? pool : 0) };
        c.tone = c.load > EPS ? tone(c.util) : null;
        c.noCapacity = c.avail <= EPS && c.load > EPS;
        return c;
      });
      const item = model.itemByRef.get(ref);
      rows.push({ id: `r:${ref}`, kind: 'projectRow', ref, name: item?.name || ref, rank: item?.rank ?? null, key: item?.key || null, color: colorIdx.get(ref) ?? -1, total: sum(ts, (t) => sum(t.hours)), over: overCount(cells), cells });
    }
    foot = W.map((w, wi) => teamWeek(team, members, wi, { unassigned: true }));
  }

  // ghosts: where a pending task was before (faded), unless it is still there
  if (kind !== 'teams') {
    const rowById = new Map(rows.map((r) => [r.id, r]));
    const origIssues = (ds.issues || []).filter((i) => moves?.[i.id]);
    const origFill = byCapacity && origIssues.length ? capacityFill(model, support, ds.issues || [], { today: W[0].a, evenIds: ds.planEven }) : null;
    for (const o of planTasks(model, origIssues, W, origFill)) {
      if (!inScope(o)) continue;
      const rid = kind === 'projects' ? `r:${o.ref}` : o.assignee ? `p:${o.assignee}` : 'u';
      const row = rowById.get(rid);
      if (!row) continue;
      W.forEach((w, wi) => {
        if (o.hours[wi] <= EPS) return;
        const cell = row.cells[wi];
        if (cell.cards.some((c) => c.id === o.id)) return;
        cell.ghosts.push({ ...card({ ...o, hours: o.hours }, w, wi), ghost: true, pending: true, conflict: false });
      });
    }
  }

  return {
    kind, team, project, distribution: byCapacity ? 'capacity' : 'even', weeks: W, rows,
    // the plan log: every task on this board the capacity split moved (or someone set back to even)
    capTasks: byCapacity ? scopeTasks.filter((t) => t.fill && t.assignee && !hidden(t.assignee) && (fillDiffers(t.fill) || t.fill.forced))
      .map((t) => ({ id: t.id, key: t.key, summary: t.summary, ref: t.ref, assignee: t.assignee, assigneeName: nameOf(t.assignee), fill: t.fill })) : [], foot, conflicts: conf, taskById, colorIdx,
    pending: Object.keys(moves || {}).length,
    // people to offer in "Change person …": the team (or project) rows first, then everyone else with capacity
    candidates: [...people.values()].map((p) => ({ id: p.id, name: nameOf(p.id), teamId: p.teamId || null })).filter((p) => p.name)
      .sort((a, b) => (inTeam(people.get(b.id), team) - inTeam(people.get(a.id), team)) || a.name.localeCompare(b.name, 'de')),
    personTeam: (id) => people.get(id)?.teamId || null,
    inTeamOf: (id, tid) => inTeam(people.get(id), tid),
    // any person's load per board week ({ load, avail, util }) – all their tasks, every team (person picker, warnings)
    personWeeks: (id) => W.map((w, wi) => loadOf(id, wi)),
    // a person's week split over their teams (shareSplit) – "Warum zu viel?" explains a team's number with it
    splitWeek: (id, wi) => (hidden(id) ? null : splitWeek(id, wi)),
    teamPart: (id, wi, tid) => partOf(id, wi, tid), // numbers only – callers show hidden people as one sum
    members: (tid) => crewOf(tid),
    // the people the Personen board's sum row adds up (its person and hidden rows)
    footPeople: () => footIds,
    personAvail: (id, wi) => (hidden(id) ? null : weeksOf(id)[wi]),
    isHidden: hidden,
  };
}

// ---------- drops ----------
// What dropping a card onto (row, week) means: shift by whole weeks and/or change the assignee. Refused: support,
// another project's row, the all-teams overview, read-only boards. warn 'notInTeam' when the new person is in
// another team than the task.
export function planDrop(board, { id, fromWeek, toRow, toWeek, canEdit = true }) {
  if (!canEdit || board.kind === 'teams') return { ok: false, reason: 'readonly' };
  const t = board.taskById.get(id);
  const row = board.rows.find((r) => r.id === toRow);
  if (!t || !row) return { ok: false, reason: 'unknown' };
  if (row.kind === 'support') return { ok: false, reason: 'support' };
  if (row.kind === 'projectRow' && row.ref !== t.ref) return { ok: false, reason: 'project' };
  if (row.kind === 'team') return { ok: false, reason: 'readonly' };
  if (row.kind === 'hidden' || board.isHidden?.(t.assignee)) return { ok: false, reason: 'hidden' };
  const weeks = (toWeek ?? fromWeek) - fromWeek;
  let assignee;
  if (row.kind === 'person' && row.accountId !== t.assignee) assignee = row.accountId;
  if (row.kind === 'unassigned' && t.assignee) assignee = null;
  if (!weeks && assignee === undefined) return { ok: true, noop: true, weeks: 0 };
  const warn = assignee && t.teamId && board.personTeam(assignee) && !(board.inTeamOf ? board.inTeamOf(assignee, t.teamId) : board.personTeam(assignee) === t.teamId) ? 'notInTeam' : null;
  return { ok: true, weeks, ...(assignee !== undefined ? { assignee, assigneeName: row.name || null } : {}), warn };
}

// Staged changes whose new due date lies after their project's due date (tester 2026-11-19: the warning was easy to
// miss and "Apply to Jira" said nothing). Only changes that move the due date count – a task that is already late in
// Jira and only gets a new assignee is no news. → Map issueId → { id, key, due, projectDue, project, days }
export function pastProjectDue(model, moves = {}) {
  const out = new Map();
  if (!model) return out;
  for (const [id, m] of Object.entries(moves || {})) {
    if (!m?.due || m.due === m.orig?.due) continue;
    const i = model.byId.get(id);
    const p = i ? model.itemByRef.get(i.rootRef) : null;
    const a = dayIdx(m.due), b = dayIdx(p?.due);
    if (a == null || b == null || a <= b) continue;
    out.set(id, { id, key: m.key || i.key, due: m.due, projectDue: p.due, project: p.name, days: a - b });
  }
  return out;
}

// One person's weeks exactly as the weekly board shows them (boss 2026-11-20: "139 % / 125 % – but it is always me"):
// My work used its own spread (remaining estimate from today) and showed other numbers than Teams and Weekly planning.
// Now it reads the person's row of the board of their team – same distribution, same capacity, same tasks.
// → [{ from, load, avail, util }] or null (not on any team board)
// My work's 8-week strip: the person's row of their team board. Besides load and time, each week carries the whole
// period and where the time went (boss 2026-11-23: "add the calculation in the box", "the complete period and the free
// days – holidays etc."): weekly hours − days off − daily business = time for projects; support + tasks = planned.
export function personBoardWeeks({ ds, computed, personId, weeks = PLAN_WEEKS, distribution = 'even', today = null, lang = 'de', reasons = false }) {
  if (!computed?.model || !personId) return null;
  const p = capacityPeople(computed.model).get(personId);
  const team = p?.teamId || p?.teams?.[0]?.teamId || null;
  if (!team) return null;
  const board = buildBoard({ ds, computed, team, mode: 'people', weeks, distribution, today });
  const row = board.rows.find((r) => r.kind === 'person' && r.accountId === personId);
  if (!row) return null;
  const absences = computed.model.ds?.capacity?.absences;
  return board.weeks.map((w, i) => {
    const c = row.cells[i];
    const a = board.personAvail(personId, i) || {};
    return {
      from: w.from, to: w.to, load: c.load || 0, avail: c.avail || 0, util: c.util,
      weekly: a.weekly || 0, nominal: a.nominal || 0, off: Math.max(0, a.off || 0), daily: Math.max(0, a.daily || 0),
      support: c.support || 0, tasks: c.tasks || 0, holidays: a.holidays || 0, absent: a.absent || 0, days: a.days || 0,
      daysOff: daysOffOf(computed.model.cfg, p, absences, w.a, w.b, { lang, reasons }),
    };
  });
}
