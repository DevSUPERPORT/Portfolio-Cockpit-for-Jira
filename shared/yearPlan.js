// Jahresprognose (user 2026-11-17: "a projected timetable for up to a year+ just for projection purposes – super
// simple"): one project, the next 12 / 18 / 24 months. Built from the SAME weekly board (shared/weekPlan.js buildBoard
// over the whole horizon), so the year view never disagrees with the weekly plan – only summed per month.
//
//   projectYear({ ds, computed, project, months, distribution, moves }) → {   (moves: the board's pending moves)
//     months: [{ key: 'YYYY-MM', from (ISO), current }],
//     rows:   [{ id, kind: person|unassigned|hidden, name, accountId, total, cells: [{ own, load, avail, util }] }],
//     total:  [project hours per month], planned (all project hours in the horizon), lastMonth (key | null),
//     due (ISO | null), dueMonth, late: hours in months after the due month, remaining (RE of the project),
//     runsPast: work continues after the last month, pending: staged board moves of this project included }
//
// A week's hours are split onto its working days (Mon–Fri, 1/5 each), so a week across two months lands in both.
// own = this project's hours, load = everything the person has (support, other projects), avail = their time.
import { buildBoard, applyMoves } from './weekPlan.js';
import { spreadWindow } from './engine.js';
import { isoOf } from './dates.js';

const EPS = 0.05;
export const YEAR_RANGES = [12, 18, 24];

export function projectYear({ ds, computed, project, months = 12, distribution = 'even', today = null, moves = {} }) {
  const nWeeks = Math.ceil((months * 52) / 12) + 1;
  const board = buildBoard({ ds, computed, project, weeks: nWeeks, distribution, today, moves });
  const first = board.weeks[0].from.slice(0, 7);
  // the month list: from the current month on, `months` long
  const keys = [];
  let [y, m] = first.split('-').map(Number);
  for (let i = 0; i < months; i++) { keys.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  const idx = new Map(keys.map((k, i) => [k, i]));
  // per week: which month each working day belongs to (shares of 1/5)
  const split = board.weeks.map((w) => {
    const out = new Map();
    for (let d = 0; d < 5; d++) { const k = isoOf(w.a + d).slice(0, 7); if (idx.has(k)) out.set(idx.get(k), (out.get(idx.get(k)) || 0) + 0.2); }
    return out;
  });
  // weeks in the horizon where a person has this project's work but no time at all (absence, holidays, days off)
  const noTime = [];
  for (const r of board.rows) if (r.kind === 'person') r.cells.forEach((c, wi) => { if ((c.own ?? 0) > EPS && !(c.avail > EPS) && split[wi].size) noTime.push({ id: r.accountId, name: r.name || '', week: board.weeks[wi].from, hours: c.own }); });
  const rows = board.rows.filter((r) => ['person', 'unassigned', 'hidden'].includes(r.kind)).map((r) => {
    const cells = keys.map(() => ({ own: 0, load: 0, avail: 0, util: 0 }));
    r.cells.forEach((c, wi) => {
      const own = r.kind === 'unassigned' ? c.load || 0 : c.own ?? c.load ?? 0;
      for (const [mi, f] of split[wi]) {
        cells[mi].own += own * f;
        if (r.kind !== 'unassigned') { cells[mi].load += (c.load || 0) * f; cells[mi].avail += (c.avail || 0) * f; }
      }
    });
    for (const c of cells) c.util = c.avail > EPS ? c.load / c.avail : c.load > EPS ? Infinity : 0;
    return { id: r.id, kind: r.kind, name: r.name || '', accountId: r.accountId || null, total: cells.reduce((a, c) => a + c.own, 0), cells };
  }).filter((r) => r.total > EPS);
  const total = keys.map((_, i) => rows.reduce((a, r) => a + r.cells[i].own, 0));
  const planned = total.reduce((a, b) => a + b, 0);
  let last = -1;
  total.forEach((h, i) => { if (h > EPS) last = i; });
  const item = computed.model.itemByRef.get(project);
  const met = computed.metrics?.get?.(project) || null;
  const due = item?.due || met?.due || null;
  const dueMonth = due ? due.slice(0, 7) : null;
  const dueAt = dueMonth ? (idx.has(dueMonth) ? idx.get(dueMonth) : dueMonth < keys[0] ? -1 : keys.length) : keys.length;
  const late = total.reduce((a, h, i) => a + (i > dueAt ? h : 0), 0);
  // work that continues after the horizon: then "done per plan" is not the last month shown (E2E audit 2026-11-17)
  const endB = board.weeks[board.weeks.length - 1].b;
  // (from the stories' windows – a story wholly after the range is not on the board at all; the capacity split keeps
  // hours inside the window, so the window's end is enough)
  const runsPast = applyMoves(ds.issues || [], moves).some((s) => s.rootRef === project && s.role === 'estimate' && s.oe > 0 && (s.status?.cat ?? 'new') !== 'done' && (spreadWindow(s, 'oe', computed.model.today)?.[1] ?? -Infinity) > endB);
  const ids = new Set(Object.keys(moves || {}));
  const pending = ids.size ? (ds.issues || []).filter((i) => ids.has(i.id) && i.rootRef === project).length : 0;
  return {
    months: keys.map((k, i) => ({ key: k, from: `${k}-01`, current: i === 0 })),
    rows: rows.sort((a, b) => (a.kind === 'unassigned') - (b.kind === 'unassigned') || b.total - a.total),
    total, planned, lastMonth: last >= 0 ? keys[last] : null, due, dueMonth, late, noTime, runsPast, pending,
    remaining: Number.isFinite(met?.RE) ? met.RE : null,
  };
}
