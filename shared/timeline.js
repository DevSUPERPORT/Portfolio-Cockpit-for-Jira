// Projects › Structure as a timeline (Gantt) and as a list – the pure part: bars, roll-ups, periods, scale ticks.
// Boss 2026-11-19: "a Gantt chart based on start and due date, also as a list with columns – for project admins and
// above; very easy to interpret; define the period; quality-of-life features that help decide".
// Dates are day indices (shared/dates.js). Start and due are the same fields Jira's own timeline uses.
import { dayIdx, ymdIdx, isoOf, mondayOf, dow } from './dates.js';

const DAY = 864e5;
const ymd = (idx) => { const d = new Date(idx * DAY); return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]; };

// What each work item's subtree spans and adds up to: { a, b, oe, ts, re, n, done, lateChild } per id.
// a/b = earliest start (or due) and latest due (or start) of the item and everything below it.
export function rollups(issues, kidsOf) {
  const out = new Map();
  const walk = (i) => {
    if (out.has(i.id)) return out.get(i.id);
    const s = dayIdx(i.start), d = dayIdx(i.due);
    const own = [s, d].filter((v) => v != null);
    const r = { a: own.length ? Math.min(...own) : null, b: own.length ? Math.max(...own) : null, oe: i.role === 'estimate' ? +i.oe || 0 : 0, ts: i.role === 'estimate' ? +i.ts || 0 : 0, re: i.role === 'estimate' ? +i.re || 0 : 0, n: 0, done: 0, childEnd: null };
    out.set(i.id, r);
    for (const c of kidsOf(i.id) || []) {
      const x = walk(c);
      if (x.a != null) r.a = r.a == null ? x.a : Math.min(r.a, x.a);
      if (x.b != null) { r.b = r.b == null ? x.b : Math.max(r.b, x.b); r.childEnd = r.childEnd == null ? x.b : Math.max(r.childEnd, x.b); }
      r.oe += x.oe; r.ts += x.ts; r.re += x.re; r.n += 1 + x.n; r.done += (c.status?.cat === 'done' ? 1 : 0) + x.done;
    }
    return r;
  };
  for (const i of issues) walk(i);
  return out;
}

// The bar of one work item.
//   kind: own (start → due) · invalid (start after due) · dueOnly / startOnly (one date: a marker) ·
//         rollup (no own dates: the span of what is below) · none
//   overdue: days past due (open items) · late: a child ends after this item's due · progress 0…1 or null
export function barOf(i, roll, today) {
  const s = dayIdx(i.start), d = dayIdx(i.due);
  const r = roll?.get(i.id);
  const done = i.status?.cat === 'done';
  let kind = 'none', a = null, b = null;
  if (s != null && d != null) { kind = s > d ? 'invalid' : 'own'; a = Math.min(s, d); b = Math.max(s, d); }
  else if (d != null) { kind = 'dueOnly'; a = b = d; }
  else if (s != null) { kind = 'startOnly'; a = b = s; }
  else if (r && r.a != null && r.b != null && r.n > 0) { kind = 'rollup'; a = r.a; b = r.b; }
  const oe = i.role === 'estimate' ? +i.oe || 0 : r?.oe || 0;
  const ts = i.role === 'estimate' ? +i.ts || 0 : r?.ts || 0;
  const progress = done ? 1 : oe > 0 ? Math.min(1, ts / oe) : r?.n ? r.done / r.n : null;
  return {
    kind, a, b, start: s, due: d, done,
    overdue: !done && d != null && d < today ? today - d : 0,
    late: d != null && r?.childEnd != null && r.childEnd > d ? r.childEnd - d : 0,
    progress, oe, ts, re: i.role === 'estimate' ? +i.re || 0 : r?.re || 0,
  };
}

// Calendar days a bar covers (inclusive) and its working days (Mon–Fri)
export const spanDays = (a, b) => (a == null || b == null ? null : b - a + 1);
export function workdaysBetween(a, b) {
  if (a == null || b == null || b < a) return null;
  let n = 0;
  for (let x = a; x <= b; x++) { const w = dow(x); if (w !== 0 && w !== 6) n++; }
  return n;
}

// ---------- the period on screen ----------
export const PERIODS = ['fit', 'month', 'quarter', 'next3', 'next6', 'year', 'custom'];
export function periodRange(kind, today, bars = [], custom = {}) {
  const [y, m] = ymd(today);
  const q0 = Math.floor((m - 1) / 3) * 3 + 1;
  switch (kind) {
    case 'month': return [ymdIdx(y, m, 1), ymdIdx(y, m + 1, 1) - 1];
    case 'quarter': return [ymdIdx(y, q0, 1), ymdIdx(y, q0 + 3, 1) - 1];
    case 'next3': return [mondayOf(today) - 7, today + 91];
    case 'next6': return [mondayOf(today) - 7, today + 183];
    case 'year': return [ymdIdx(y, 1, 1), ymdIdx(y + 1, 1, 1) - 1];
    case 'custom': {
      const a = dayIdx(custom.from), b = dayIdx(custom.to);
      if (a != null && b != null && b >= a) return [a, b];
      return periodRange('fit', today, bars);
    }
    default: { // fit: everything with a date, plus today, a little air on both sides
      const xs = bars.flatMap((x) => [x.a, x.b]).filter((v) => v != null);
      if (!xs.length) return [mondayOf(today) - 14, today + 76];
      const a = Math.min(today, ...xs), b = Math.max(today, ...xs);
      const pad = Math.max(7, Math.round((b - a) * 0.04));
      return [mondayOf(a - pad), b + pad];
    }
  }
}

// ---------- the scale ----------
// zoom: week (days visible, weeks labelled) · month · quarter. Base pixels per day; the chart widens to fill the screen.
export const ZOOM_PX = { week: 26, month: 6, quarter: 2.2 };
// Header ticks for [a, b]: top tier and bottom tier as { a, b, kind, y, m, q, w } (labels are made by the screen).
export function ticks(a, b, zoom) {
  const months = [], quarters = [], years = [], weeks = [];
  let [y, m] = ymd(a);
  for (let x = ymdIdx(y, m, 1); x <= b;) {
    const [yy, mm] = ymd(x);
    const next = ymdIdx(yy, mm + 1, 1);
    months.push({ a: Math.max(x, a), b: Math.min(next - 1, b), kind: 'month', y: yy, m: mm });
    x = next;
  }
  for (const mo of months) {
    const q = Math.floor((mo.m - 1) / 3) + 1;
    const last = quarters[quarters.length - 1];
    if (last && last.y === mo.y && last.q === q) last.b = mo.b; else quarters.push({ a: mo.a, b: mo.b, kind: 'quarter', y: mo.y, q });
    const ly = years[years.length - 1];
    if (ly && ly.y === mo.y) ly.b = mo.b; else years.push({ a: mo.a, b: mo.b, kind: 'year', y: mo.y });
  }
  for (let x = mondayOf(a); x <= b; x += 7) weeks.push({ a: Math.max(x, a), b: Math.min(x + 6, b), kind: 'week', w: isoWeek(x), monday: x });
  if (zoom === 'week') return { top: months, bottom: weeks };
  if (zoom === 'quarter') return { top: years, bottom: quarters };
  return { top: quarters, bottom: months };
}
export function isoWeek(idx) {
  const thursday = mondayOf(idx) + 3;
  const [y] = ymd(thursday);
  const jan4 = ymdIdx(y, 1, 4);
  return 1 + Math.round((thursday - (mondayOf(jan4) + 3)) / 7);
}

// ---------- quick filters (the summary strip) ----------
// overdue · soon (ends in the next 14 days) · unscheduled (no start and no due) · conflict (a date conflict) ·
// invalid (start after due) · late (a child ends after the due date) – unscheduled counts open work only
export function quickFlags(i, bar, today, conflictIds) {
  return {
    overdue: bar.overdue > 0,
    soon: !bar.done && bar.due != null && bar.due >= today && bar.due <= today + 14,
    unscheduled: !bar.done && bar.start == null && bar.due == null, // open work only – the same count Lotse names
    conflict: conflictIds.has(i.id),
    invalid: bar.kind === 'invalid',
    late: bar.late > 0 && !bar.done,
  };
}
export const isoDay = isoOf;
