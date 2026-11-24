// Booking check ("Gebuchte Stunden je Mitarbeiter"): did everyone book enough of their possible working time?
//   possible  = weekly hours ÷ 5 × (workdays − public holidays − absences) in the period (÷ the location's working
//               days per week and its own holidays / company days off when named locations are set up)
//   booked    = every worklog of the person in the period (all work items they can see, projects and support)
//   quote     = booked ÷ possible; missing = possible − booked
//   status    = OK from the minimum quote, escalation when at least the escalation share is missing, otherwise a hint
// When the period reaches today, the last "grace" workdays are left out so late bookings do not trigger at once.
import { isoOf, isWeekday } from './dates.js';
import { personDays } from './locations.js';
import { capacityPeople } from './engine.js';

export const BOOKING_DEFAULTS = { enabled: true, minPct: 90, escalatePct: 20, graceDays: 2, escalateTo: 'lead', schedule: 'week' };

// The period actually checked: never beyond today; ending today → minus the grace workdays.
export function bookingRange(a, b, today, graceDays = 2) {
  let end = Math.min(b, today);
  let graced = 0;
  if (b >= today && graceDays > 0) {
    let n = 0, d = today;
    while (n < graceDays && d > a) { d--; if (isWeekday(d)) n++; }
    graced = graceDays;
    end = Math.min(end, d);
    while (end > a && !isWeekday(end)) end--; // end on a workday
  }
  return { a, b: end, graced, valid: end >= a };
}

// booked: { people: { [accountId]: { h, last, byIssue } } } from the booking.worklogs resolver.
export function bookingOverview(model, booked, a, b, cfg = {}) {
  const bk = { ...BOOKING_DEFAULTS, ...(cfg.booking || {}) };
  const people = capacityPeople(model);
  const cap = model.ds.capacity || {};
  // people who booked time but have no capacity entry yet: default weekly hours and location
  for (const id of Object.keys(booked?.people || {})) {
    if (!people.has(id)) people.set(id, { id, weeklyHours: cap.defaultWeeklyHours ?? 40, location: cap.defaultLocation || 'NONE', teamId: null, derived: true });
  }
  const locSrc = Array.isArray(cfg?.locations) ? cfg.locations : model.cfg;
  const supportIds = new Set((model.ds.supportTickets?.tickets || []).map((t) => String(t.id)));
  const rows = [];
  for (const p of people.values()) {
    const { all, days, perWeek } = personDays(locSrc, p, model.ds.capacity?.absences, a, b);
    const off = all - days;
    const poss = ((+p.weeklyHours || 0) / perWeek) * days;
    const mine = booked?.people?.[p.id] || { h: 0, last: null, byIssue: {} };
    const h = mine.h || 0;
    const sup = Object.entries(mine.byIssue || {}).reduce((s, [id, x]) => s + (supportIds.has(String(id)) ? x : 0), 0);
    const pct = poss > 0 ? Math.round((h / poss) * 100) : null;
    const missPct = pct == null ? 0 : Math.max(0, 100 - pct);
    const level = poss <= 0 ? 'none' : pct >= bk.minPct ? 'ok' : missPct >= bk.escalatePct ? 'esc' : 'info';
    rows.push({ id: p.id, teamId: p.teamId || null, derived: !!p.derived, days, off, possible: poss, booked: h, support: Math.min(h, sup), pct, missing: Math.max(0, poss - h), missPct, last: mine.last || null, level });
  }
  rows.sort((x, y) => (x.pct ?? 1e9) - (y.pct ?? 1e9) || y.possible - x.possible);
  return {
    rows, settings: bk, from: isoOf(a), to: isoOf(b),
    counts: { esc: rows.filter((r) => r.level === 'esc').length, info: rows.filter((r) => r.level === 'info').length, ok: rows.filter((r) => r.level === 'ok').length },
  };
}
