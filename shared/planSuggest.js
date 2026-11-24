// Suggestions for red weeks on the board (tester + boss 2026-11-17): instead of planning automatically, the board says
// what does not fit and offers ONE concrete move – "Dev Team is absent in KW 52–53, PCX-34 (26 h) does not fit. Move it
// to KW 1–2" – with a preview of the result (load before → after in every touched week). Accepting only adds a pending
// move (moveTask); nothing reaches Jira until "In Jira übernehmen".
//
//   suggestShifts({ ds, computed, board, moves, target, horizon, max, today }) → [{
//     id, personId, personName, taskId, key, summary, ref, reason: 'noTime'|'over', weeks (shift), hours (task total),
//     full, conflictWeeks: [Monday ISO], from: [Monday ISO, Monday ISO], to: [...], newStart, newDue, pastProjectDue,
//     preview: [{ monday, before: { load, avail, util }, after: { … } }],
//     kind: 'shift' | 'split', change (what Accept stages: { weeks } or { start, due }), span (weeks after), perWeek }]
//
// Two kinds of advice (tester 2026-11-19: "80 h in one week – the advice moved it to another week where it is 250 % again;
// split it"): SHIFT keeps the task's shape and moves it by whole weeks; SPLIT keeps the start and stretches the due date
// week by week until the hours fit next to everything else (or starts later when the first weeks are full). The one
// that fits completely and ends first wins; when neither fits completely, the one with the lower peak.
//
// Every number comes from the board itself (consistency audit 2026-11-17): the search runs on the SAME board – same
// scope, same distribution (even / by capacity), same pending moves – extended by `horizon` weeks, and each suggestion's
// preview is that board re-built with the one move staged. So what the preview promises is exactly what the board shows
// after "Accept" – no approximation, also with the capacity distribution (where a moved task changes shape).
import { buildBoard, moveTask, datesInverted, shiftDates } from './weekPlan.js';
import { dayIdx, isoOf, dow } from './dates.js';

const EPS = 0.05;
const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
const ratio = (load, avail) => (avail > EPS ? load / avail : load > EPS ? Infinity : 0);
const usedOf = (hours) => hours.map((h, i) => (h > EPS ? i : -1)).filter((i) => i >= 0);
const MAX_TRIES = 30; // exact previews are whole boards – bound the work per render
const PER_WEEK = 3;   // overload: up to 3 candidates per red week (lowest priority first), the first real improvement wins
const MIN_GAIN = 0.1; // …and "real" = the red week drops by at least 10 percentage points (or below the target)

export function suggestShifts({ ds, computed, board, moves = {}, target = 1, horizon = 16, max = 8, today = null }) {
  if (!board || board.kind === 'teams') return [];
  const model = computed.model;
  const W = board.weeks;
  const personRows = board.rows.filter((r) => r.kind === 'person' && r.accountId && !board.isHidden?.(r.accountId));
  // the red weeks of a person on the board: no time at all, or above the target
  const redOf = (r) => r.cells.map((c, wi) => ({ c, wi })).filter(({ c }) => (c.own ?? c.load) > EPS && (!(c.avail > EPS) || c.util > target + 0.005));
  if (!personRows.some((r) => redOf(r).length)) return []; // nothing red – no extra boards to build
  const n = W.length + horizon;
  const build = (mv) => buildBoard({
    ds, computed, team: board.team, project: board.project, mode: board.kind === 'projects' ? 'projects' : 'people',
    weeks: n, moves: mv, distribution: board.distribution || 'even', today,
  });
  const ext = build(moves);
  const EW = ext.weeks;
  const rowOf = (b, pid) => b.rows.find((x) => x.kind === 'person' && x.accountId === pid);
  const rankOf = (ref) => model.itemByRef.get(ref)?.rank ?? 1e9;
  const issueById = new Map((ds.issues || []).map((i) => [i.id, i]));
  const out = [];
  const seen = new Set();
  let tries = 0;
  for (const r of personRows) {
    const red = redOf(r);
    if (!red.length) continue;
    const pid = r.accountId;
    const er = rowOf(ext, pid);
    if (!er) continue;
    const load = er.cells.map((c) => c.load || 0);
    const avail = er.cells.map((c) => c.avail || 0);
    for (const { c, wi } of red) {
      const noTime = !(c.avail > EPS);
      // which task to move: in a week without time every task of the scope; otherwise the lowest-ranked one
      const cards = c.cards.filter((k) => k.kind === 'task' && !k.locked && !k.hidden && !seen.has(k.id));
      const pick = noTime ? cards : cards.sort((a, b) => rankOf(b.ref) - rankOf(a.ref)).slice(0, PER_WEEK);
      for (const k of pick) {
        if (!noTime && out.some((x) => x.personId === pid && x.weekIdx === wi)) break; // this red week has its move
        const t = ext.taskById.get(k.id);
        const issue = issueById.get(k.id);
        if (!t || !issue || t.hours[n - 1] > EPS) continue; // runs past the horizon – no safe preview
        const used = usedOf(t.hours);
        if (!used.length) continue;
        // the two kinds of advice, the more promising first (see the header)
        const cur = moves[issue.id] || issue;
        const [cs, cd] = datesInverted(cur) ? [cur.due, cur.start] : [cur.start, cur.due];
        // Never past the project's due date (tester 2026-11-19: "do not recommend moves after the project due"): the search
        // only looks at results that end by then. Only when nothing fits by then – or the task already ends after it – the
        // best move past it comes back, marked (pastProjectDue); the board shows those only on request, with a warning.
        const pd = dayIdx(model.itemByRef.get(t.ref)?.due);
        const curEnd = used[used.length - 1];
        const pdIdx = pd == null ? -2 : EW.findIndex((w) => pd >= w.a && pd <= w.a + 6);
        const pdWeek = pd == null ? null : pd < EW[0].a ? -1 : pdIdx >= 0 ? pdIdx : EW.length - 1; // the week of the project due
        const bounded = pdWeek != null && curEnd <= pdWeek && (dayIdx(cd) == null || dayIdx(cd) <= pd);
        const search = (lim) => {
          const okK = lim == null ? null : (k) => { const d = dayIdx(shiftDates({ start: cs, due: cd }, k).due); return d == null || d <= pd; };
          return [
            fitShift(t, load, avail, target, horizon, { noTime, maxEnd: lim, okK }),
            fitSpread(t, load, avail, target, horizon, { distribution: board.distribution || 'even', startDay: dayIdx(cs), maxEnd: lim, endDay: lim == null ? null : pd }),
          ];
        };
        let [shift, split] = search(bounded ? pdWeek : null);
        if (bounded && !shift && !split) [shift, split] = search(null);
        const cands = [];
        if (shift) cands.push({ kind: 'shift', change: { weeks: shift.k }, full: shift.full, end: curEnd + shift.k, weeks: shift.k });
        if (split) {
          const keepStart = split.ws === used[0] && cs && dayIdx(cs) >= EW[split.ws].a && dayIdx(cs) <= EW[split.ws].a + 4;
          // in the project's due week the split ends ON the due date, not on the Friday after it
          const fri = EW[split.we].a + 4;
          const end = pd != null && pd >= EW[split.we].a && pd < fri ? Math.max(pd, keepStart ? dayIdx(cs) : EW[split.ws].a) : fri;
          cands.push({ kind: 'split', change: { start: keepStart ? cs : EW[split.ws].from, due: isoOf(end) }, full: split.full, end: split.we, weeks: split.we - curEnd });
        }
        if (!cands.length) continue;
        cands.sort((a, b) => b.full - a.full || a.end - b.end || (a.kind === 'split' ? -1 : 1));
        // the exact result: the board with the move staged – what the preview shows is what Accept gives
        const tryMove = (cand) => {
          const mv = moveTask(moves, issue, cand.change);
          const m = mv[issue.id];
          if (!m) return null;
          const b2 = build(mv);
          const r2 = rowOf(b2, pid);
          const t2 = b2.taskById.get(k.id);
          if (!r2 || !t2) return null;
          const used2 = usedOf(t2.hours);
          if (!used2.length) return null;
          const after = (i) => ({ load: r2.cells[i].load || 0, avail: r2.cells[i].avail || 0 });
          // never into a week without time, and never worse than today at the peak of the task's weeks
          if (used2.some((i) => !(after(i).avail > EPS))) return null;
          const peakNow = Math.max(...used.map((i) => ratio(load[i], avail[i])));
          const peakNew = Math.max(...used2.map((i) => ratio(after(i).load, after(i).avail)));
          if (!noTime && !(peakNew < peakNow - 0.005)) return null;
          // overload: the red week itself must get noticeably better – a 13-week move for 395 % → 386 % is no advice
          const redAfter = ratio(after(wi).load, after(wi).avail);
          if (!noTime && !(redAfter <= target + 0.005 || ratio(load[wi], avail[wi]) - redAfter >= MIN_GAIN)) return null;
          const full = used2.every((i) => ratio(after(i).load, after(i).avail) <= target + 0.005);
          return { cand, m, t2, used2, after, peakNow, peakNew, full };
        };
        let res = null;
        for (const cand of cands) {
          if (++tries > MAX_TRIES) return rank(out, max);
          const r1 = tryMove(cand);
          if (!r1) continue;
          if (!res || (r1.full && !res.full) || (r1.full === res.full && r1.peakNew < res.peakNew - 0.005)) res = r1;
          if (res.full) break; // the first exact full fit wins (the list is already in preference order)
        }
        if (!res) continue;
        const { cand, m, t2, used2, after, peakNow, peakNew, full } = res;
        seen.add(k.id);
        const touched = [...new Set([...used, ...used2])].sort((a, b) => a - b);
        const preview = touched.map((i) => {
          const a = after(i);
          return { monday: EW[i].from, before: { load: load[i], avail: avail[i], util: ratio(load[i], avail[i]) }, after: { ...a, util: ratio(a.load, a.avail) } };
        });
        const projDue = model.itemByRef.get(t.ref)?.due || null;
        // the red weeks this move really relieves (the cells that show it): no time → the task leaves; overload → the
        // week ends within the target or drops by ≥ MIN_GAIN
        const relieves = (i) => {
          if (!(t.hours[i] > EPS)) return false;
          if (!(avail[i] > EPS)) return true;
          if (!(load[i] > avail[i] * target + EPS)) return false;
          const u1 = ratio(after(i).load, after(i).avail);
          return u1 <= target + 0.005 || ratio(load[i], avail[i]) - u1 >= MIN_GAIN;
        };
        const conflictWeeks = W.map((w, i) => ({ w, i })).filter(({ i }) => i === wi || relieves(i)).map(({ w }) => w.from);
        out.push({
          id: `${pid}:${k.id}`, personId: pid, personName: r.name, taskId: k.id, key: k.key, summary: k.summary, ref: t.ref, issueKey: issue.key || k.key,
          reason: noTime ? 'noTime' : 'over', weeks: cand.weeks, hours: sum(t2.hours), full,
          kind: cand.kind, change: cand.change, fromStart: cs || null, span: used2.length, spanBefore: used.length, perWeek: Math.max(...used2.map((i) => t2.hours[i])),
          conflictWeeks,
          from: [EW[used[0]].from, EW[used[used.length - 1]].from], to: [EW[used2[0]].from, EW[used2[used2.length - 1]].from],
          newStart: m.start || null, newDue: m.due || null, pastProjectDue: !!(projDue && m.due && m.due > projDue), projectDue: projDue,
          rank: rankOf(t.ref), preview, weekIdx: wi, gain: Math.min(peakNow, 10) - Math.min(peakNew, 10),
        });
      }
    }
  }
  return rank(out, max);
}

// Most useful first: weeks without time, then moves that fit completely, then the biggest relief.
const rank = (list, max) => list
  .sort((a, b) => (a.pastProjectDue - b.pastProjectDue) || (a.reason === 'noTime' ? 0 : 1) - (b.reason === 'noTime' ? 0 : 1) || b.full - a.full || b.gain - a.gain || a.weeks - b.weeks)
  .slice(0, max);

// The smallest later shift k (whole weeks) after which the task's hours fit next to everything else → { k, full: true }.
// When nothing fits completely (a person booked for months – live on production 2026-11-17), the best honest move:
// • away from weeks WITHOUT time: the first shift where the person is present in every week (load may exceed 100 %);
// • away from OVERLOAD: the shift with the lowest peak, only if that peak is lower than today's.
// Both come back with full: false. This is only the SEARCH (the task keeps its shape); suggestShifts then checks the
// pick on the real board with the move staged and reports that result.
// maxEnd (board week index) / okK (k → boolean): only shifts that end by then – the project's due date.
export function fitShift(t, load, avail, target = 1, horizon = 16, { noTime = false, maxEnd = null, okK = null } = {}) {
  const n = load.length;
  const base = load.map((l, i) => l - t.hours[i]); // the person's week without this task
  const used = usedOf(t.hours);
  if (!used.length) return null;
  const peakAt = (k) => Math.max(...used.map((i) => (avail[i + k] > EPS ? (base[i + k] + t.hours[i]) / avail[i + k] : Infinity)));
  const nowPeak = peakAt(0);
  let best = null;
  for (let k = 1; k <= horizon; k++) {
    if (used[used.length - 1] + k >= n) break;
    if (maxEnd != null && used[used.length - 1] + k > maxEnd) break;
    if (okK && !okK(k)) continue;
    if (used.every((i) => avail[i + k] > EPS && base[i + k] + t.hours[i] <= avail[i + k] * target + EPS)) return { k, full: true };
    const present = used.every((i) => avail[i + k] > EPS);
    if (noTime && present && !best) best = { k, full: false };
    if (!noTime && present) { const p = peakAt(k); if (p < nowPeak - 0.05 && (!best || p < best.peak - 1e-9)) best = { k, full: false, peak: p }; }
  }
  return best ? { k: best.k, full: false } : null;
}

// SPLIT (tester 2026-11-19): spread the task over more weeks instead of moving the whole block. Keeps the start week
// (or starts later when the first weeks are full) and stretches the due date to the end of a later week; the window has
// at least one week more than today. The hours per week follow the board's distribution: even = the same share per
// working day (the first week counts from the start day), capacity = filled up to each week's free room.
// → { ws, we, full, peak } as board week indices – the smallest end week that fits completely; otherwise the window
// with the lowest peak if that is lower than today's; null when splitting does not help. Only the SEARCH –
// suggestShifts checks the pick on the real board with the move staged.
// maxEnd (board week index): the window ends by then; endDay (day index): the last day in that week (the project due).
export function fitSpread(t, load, avail, target = 1, horizon = 16, { distribution = 'even', startDay = null, maxEnd = null, endDay = null } = {}) {
  const n = load.length;
  const used = usedOf(t.hours);
  if (!used.length) return null;
  const H = sum(t.hours);
  if (!(H > EPS)) return null;
  const base = load.map((l, i) => l - t.hours[i]);
  const s0 = used[0], len0 = used[used.length - 1] - s0 + 1;
  const nowPeak = Math.max(...used.map((i) => ratio(load[i], avail[i])));
  const wd = startDay != null ? dow(startDay) : 1;
  const firstDays = wd >= 1 && wd <= 5 ? 6 - wd : 5;
  let best = null;
  const lastWe = maxEnd == null ? Infinity : maxEnd;
  const endDays = endDay != null ? (() => { const w = dow(endDay); return w >= 1 && w <= 5 ? w : 5; })() : 5;
  for (let we = s0 + len0; we < Math.min(n, s0 + len0 + horizon) && we <= lastWe; we++) {
    for (let ws = s0; ws <= we - len0; ws++) {
      let ok = true;
      for (let i = ws; i <= we; i++) if (!(avail[i] > EPS)) { ok = false; break; }
      if (!ok) continue;
      const days = [];
      for (let i = ws; i <= we; i++) days.push(Math.max(1, Math.min(i === ws && ws === s0 ? firstDays : 5, i === we && we === maxEnd ? endDays : 5)));
      const D = sum(days);
      let peak = 0, fits = true;
      for (let i = ws; i <= we; i++) {
        const u = (base[i] + (H * days[i - ws]) / D) / avail[i];
        peak = Math.max(peak, u);
        if (u > target + 0.005) fits = false;
      }
      if (distribution === 'capacity') {
        let roomSum = 0;
        for (let i = ws; i <= we; i++) roomSum += Math.max(0, avail[i] * target - base[i]);
        fits = roomSum >= H - EPS;
      }
      if (fits) return { ws, we, full: true, peak: Math.min(peak, target) };
      if (peak < nowPeak - 0.05 && (!best || peak < best.peak - 1e-9)) best = { ws, we, full: false, peak };
    }
  }
  return best;
}
