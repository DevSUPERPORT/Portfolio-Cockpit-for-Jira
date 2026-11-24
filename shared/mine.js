// "Meine Arbeit" (UC-20): the week sheet of the signed-in person, from their own Jira data (mine.week) and the
// cockpit model (portfolio, capacity, holidays, absences, booking rules). Pure – the view and the tests use it.
//
//   Support            – always first: support has priority over projects
//   Mir zugewiesen     – assigned to me, start or due date in the week (done ones too); open support tickets without
//                        dates; in the current week also everything overdue
//   Weitere Aufgaben   – booked by me in the week or added by hand, but not in the first group
//   Ohne Termin        – open, assigned to me, no start and no due date (folded; not part of the week by the rules)
//   order              – Blocked, overdue, In Progress, To Do, Done; then by due date
//   target per day     – weekly hours ÷ 5 on working days, 0 on public holidays and absences (as the booking check);
//                        with named locations: ÷ the location's working days, 0 on its days off and free weekdays
import { dayIdx, isoOf, mondayOf } from './dates.js';
import { holidaysFor, resolveLocation, isoWeekday } from './locations.js';
import { holidayName, HOLIDAY_NAMES } from './holidays.js';
import { capacityPeople, teamSettings, projectShare } from './engine.js';
import { bookingRange, BOOKING_DEFAULTS } from './booking.js';

export const WEEKDAYS = { de: ['Mo', 'Di', 'Mi', 'Do', 'Fr'], en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] };
const RANK = (r) => (r.blocked ? 0 : r.overdue ? 1 : r.statusCat === 'indeterminate' ? 2 : r.statusCat === 'done' ? 4 : 3);
export const sortRows = (a, b) => RANK(a) - RANK(b) || String(a.due || '9999').localeCompare(String(b.due || '9999')) || String(a.key).localeCompare(String(b.key), undefined, { numeric: true });
export const weekOf = (iso) => { const m = mondayOf(dayIdx(iso)); return { from: isoOf(m), to: isoOf(m + 4), monday: m }; };
const r2 = (v) => Math.round(v * 100) / 100;

// Who is "Mitarbeiter": no Jira admin, in no group of the configuration and owner of no portfolio project.
export function isEmployee(roles, ds, meId) {
  if (!roles || roles.admin) return false;
  // role matrix (UC-08): an employee has no tab besides "Meine Arbeit"
  if (Array.isArray(roles.rights) && roles.rights.some((r) => r !== 'mine' && !r.startsWith('a_'))) return false;
  if (['viewReport', 'manageRanking', 'editCapacity', 'editHealth', 'manageSettings'].some((k) => roles[k])) return false;
  return !(ds?.portfolio || []).some((p) => p.owner?.id && p.owner.id === meId);
}

// The person's capacity facts (the same numbers the cockpit plans with).
export function myProfile(computed, meId) {
  const { model } = computed;
  const p = capacityPeople(model).get(meId) || null;
  const st = teamSettings(model, p?.teamId);
  const weekly = p ? +p.weeklyHours || 0 : +(model.ds.capacity?.defaultWeeklyHours ?? 40);
  const loc = p?.location || model.ds.capacity?.defaultLocation || 'NONE';
  const today = model.today;
  const absences = (model.ds.capacity?.absences || []).filter((a) => a.accountId === meId && dayIdx(a.to) != null && dayIdx(a.to) >= today)
    .sort((a, b) => String(a.from).localeCompare(String(b.from))).slice(0, 5).map((a) => ({ from: a.from, to: a.to, type: a.type || 'absent' }));
  const L = resolveLocation(model.cfg, loc);
  const hol = [...holidaysFor(model.cfg, loc, today, today + 60)].filter((d) => L.days.has(isoWeekday(d))).sort((a, b) => a - b).slice(0, 4).map(isoOf);
  return {
    known: !!p, derived: !p || !!p.derived, teamId: p?.teamId || null, team: p?.teamId ? model.teams.get(p.teamId)?.name || p.teamId : null,
    weekly, location: loc, locationName: L.name || loc, workdays: L.workdays, perWeek: L.perWeek, dailyPct: +st.dailyBusinessPct || 0, internalPct: +st.internalPct || 0, share: projectShare(st),
    forProjects: weekly * projectShare(st), absences, holidays: hol,
  };
}

export function buildWeek({ computed, data, meId, today, ctx = 'all', group = 'assign', pins = [], lang = 'de', bookingCfg }) {
  const { model } = computed;
  const bk = { ...BOOKING_DEFAULTS, ...(bookingCfg || model.cfg?.booking || {}) };
  const from = data.from, to = data.to;
  const a = dayIdx(from), b = dayIdx(to), t = dayIdx(today);
  const days = [0, 1, 2, 3, 4].map((i) => a + i);
  const prof = myProfile(computed, meId);
  const hol = holidaysFor(model.cfg, prof.location, a, b);
  const L = resolveLocation(model.cfg, prof.location);
  const absent = new Set();
  for (const ab of model.ds.capacity?.absences || []) {
    if (ab.accountId !== meId) continue;
    for (let d = Math.max(a, dayIdx(ab.from)); d <= Math.min(b, dayIdx(ab.to)); d++) absent.add(d);
  }
  const perDay = prof.weekly / (L.perWeek || 5);
  // the name of a day off: a company day off of the location, otherwise the public holiday's name
  const offName = (d) => {
    if (!hol.has(d)) return null;
    if (L.own?.has(d)) return L.own.get(d) || null;
    const k = holidayName(L.calendar, d);
    return k && HOLIDAY_NAMES[k] ? HOLIDAY_NAMES[k][lang === 'en' ? 1 : 0] : null;
  };
  const dayInfo = days.map((d, i) => {
    const free = !L.days.has(isoWeekday(d)); // a weekday the location does not work (e.g. a 4-day week)
    const holiday = hol.has(d);
    return { iso: isoOf(d), idx: d, wd: WEEKDAYS[lang === 'en' ? 'en' : 'de'][i], isToday: d === t, isPast: d < t, isFuture: d > t, holiday, holidayName: offName(d), company: holiday && !!L.own?.has(d), absent: absent.has(d), free, possible: holiday || absent.has(d) || free ? 0 : perDay };
  });
  const isCur = t >= a && t <= b + 2;

  // worklogs by issue and day
  const wl = new Map(); // `${issueId}|${iso}` → { h, c[], n }
  for (const w of data.worklogs || []) {
    const k = `${w.issueId}|${w.d}`;
    const e = wl.get(k) || wl.set(k, { h: 0, c: [], n: 0 }).get(k);
    e.h = r2(e.h + w.h); e.n++; if (w.c) e.c.push(w.c);
  }
  const bookedIn = (id) => dayInfo.some((d) => (wl.get(`${id}|${d.iso}`)?.h || 0) > 0);

  const pinned = new Set((pins || []).map(String));
  const rows = (data.issues || []).map((i) => {
    const local = model.byId.get(i.id);
    const item = local ? model.itemByRef.get(local.rootRef) : model.itemByRef.get(`issue:${i.id}`) || null;
    const open = i.status.cat !== 'done';
    const blocked = open && model.isBlocked({ status: i.status });
    const overdue = open && !!i.due && dayIdx(i.due) < t;
    const ctxKey = i.support ? 'support' : item ? `item:${item.ref}` : `space:${i.project.key}`;
    const ctxLabel = i.support ? 'Support' : item ? item.name : i.project.name || i.project.key;
    const cells = dayInfo.map((d) => { const e = wl.get(`${i.id}|${d.iso}`); return { d: d.iso, h: e?.h || 0, c: e ? e.c.join(' / ') : '', n: e?.n || 0 }; });
    const s = dayIdx(i.start), e = dayIdx(i.due);
    const inWeek = i.mine && (s != null || e != null ? (s ?? e) <= b && (e ?? s) >= a : i.support && open);
    const overdueHere = i.mine && isCur && open && e != null && e < a;
    return {
      id: i.id, key: i.key, summary: i.summary, type: i.type.name, subtask: i.type.subtask, bookable: !i.type.subtask,
      statusName: i.status.name, statusCat: i.status.cat, blocked, overdue, open, support: i.support, mine: i.mine,
      assignee: i.assignee, parent: i.parent, start: i.start, due: i.due, oe: i.oe, re: i.re, ts: i.ts, hasEstimate: i.hasEstimate,
      ctxKey, ctxLabel, rank: item?.rank ?? null, project: i.project,
      cells, total: r2(cells.reduce((x, c) => x + c.h, 0)),
      group: inWeek || overdueHere ? 'assigned' : bookedIn(i.id) || pinned.has(i.id) ? 'more' : i.mine && open && s == null && e == null ? 'undated' : null,
    };
  }).filter((r) => r.group);

  // filter options (counted before filtering)
  const optMap = new Map();
  for (const r of rows) if (r.group !== 'undated') { const o = optMap.get(r.ctxKey) || optMap.set(r.ctxKey, { key: r.ctxKey, label: r.ctxLabel, rank: r.support ? -1 : r.rank ?? 999, n: 0 }).get(r.ctxKey); o.n++; }
  const options = [...optMap.values()].sort((x, y) => x.rank - y.rank || x.label.localeCompare(y.label));
  // ctx: 'all' | an option key | 'proj:<Jira space key>' (the Meine-Arbeit tab inside a Jira project)
  const ctxOk = ctx === 'all' || optMap.has(ctx) || /^(space|proj):/.test(ctx) ? ctx : 'all';
  const inCtx = (r) => ctxOk === 'all' || r.ctxKey === ctxOk || (ctxOk.startsWith('proj:') && r.project.key === ctxOk.slice(5));
  const vis = rows.filter(inCtx);
  const sum = (list) => r2(list.reduce((x, r) => x + r.total, 0));

  const groups = [];
  const sup = vis.filter((r) => r.support && r.group !== 'undated').sort(sortRows);
  if (sup.length) groups.push({ id: 'support', kind: 'support', rows: sup, sum: sum(sup) });
  const proj = vis.filter((r) => !r.support && r.group !== 'undated');
  if (group === 'proj') {
    const keys = [...new Set(proj.map((r) => r.ctxKey))].sort((x, y) => (optMap.get(x)?.rank ?? 999) - (optMap.get(y)?.rank ?? 999) || String(optMap.get(x)?.label).localeCompare(String(optMap.get(y)?.label)));
    for (const k of keys) { const list = proj.filter((r) => r.ctxKey === k).sort((x, y) => (x.group === 'more') - (y.group === 'more') || sortRows(x, y)); groups.push({ id: k, kind: 'project', label: optMap.get(k)?.label || k, rank: optMap.get(k)?.rank, rows: list, sum: sum(list) }); }
  } else {
    const A = proj.filter((r) => r.group === 'assigned').sort(sortRows), B = proj.filter((r) => r.group === 'more').sort(sortRows);
    groups.push({ id: 'assigned', kind: 'assigned', rows: A, sum: sum(A), withOverdue: isCur });
    if (B.length) groups.push({ id: 'more', kind: 'more', rows: B, sum: sum(B) });
  }
  const undated = vis.filter((r) => r.group === 'undated').sort(sortRows);
  if (undated.length) groups.push({ id: 'undated', kind: 'undated', rows: undated, sum: sum(undated), folded: true });

  // totals per day: all of my bookings that day (with a filter: only that project)
  const shown = new Set(vis.map((r) => r.id));
  const dayTotals = dayInfo.map((d) => {
    let h = 0;
    for (const w of data.worklogs || []) if (w.d === d.iso && (ctxOk === 'all' || shown.has(w.issueId))) h += w.h;
    h = r2(h);
    const low = ctxOk === 'all' && d.isPast && d.possible > 0 && h < d.possible * (bk.minPct / 100) - 0.001;
    return { ...d, h, low };
  });

  // KPIs – the booking check's own rule: up to today minus the grace workdays
  const range = bookingRange(a, b, t, bk.graceDays);
  const inRange = range.valid ? dayTotals.filter((d) => d.idx <= range.b) : [];
  const ist = r2(dayTotals.reduce((x, d) => x + d.h, 0));
  const istSoll = r2(inRange.reduce((x, d) => x + d.h, 0));
  const soll = r2(inRange.reduce((x, d) => x + d.possible, 0));
  const pct = soll > 0 ? istSoll / soll : null;
  const weekPossible = r2(dayInfo.reduce((x, d) => x + d.possible, 0));
  const openRows = vis.filter((r) => r.group === 'assigned' && r.open && r.mine);
  const booked = { ist, istSoll, soll, pct, minPct: bk.minPct, weekPossible, untilIso: range.valid ? isoOf(range.b) : null, graced: range.graced, future: a > t, filtered: ctxOk !== 'all', below: ctxOk === 'all' && pct != null && pct * 100 < bk.minPct };
  const open = { n: openRows.length, overdue: openRows.filter((r) => r.overdue).length, blocked: openRows.filter((r) => r.blocked).length, remaining: r2(openRows.reduce((x, r) => x + (r.re || 0), 0)) };
  return { from, to, days: dayInfo, groups, dayTotals, booked, open, options, ctx: ctxOk, profile: prof, isCurrentWeek: isCur, rowsById: new Map(rows.map((r) => [r.id, r])) };
}

// What people type into a cell: "1,5", "1.5", "1:30", "90m", "2h", "2h 30m", "" (= remove). Returns hours or null.
export function parseHours(input) {
  const s = String(input ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (s === '' || s === '-' || s === '0') return 0;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (m) return +m[1] + +m[2] / 60;
  m = /^(?:(\d+(?:[.,]\d+)?)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/.exec(s);
  if (m && (m[1] || m[2])) return (m[1] ? +m[1].replace(',', '.') : 0) + (m[2] ? +m[2] / 60 : 0);
  m = /^\d+(?:[.,]\d+)?$/.exec(s);
  if (m) return +s.replace(',', '.');
  return null;
}
// Quarter hours, 0–24 – the same rounding the server applies.
export const roundQuarter = (h) => (h == null || !Number.isFinite(h) || h < 0 || h > 24 ? null : Math.round(h * 4) / 4);
