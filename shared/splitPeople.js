// People who work for more than one team (user 2026-11-17: "one member that belongs to two teams can cause time
// conflicts, or other peculiar and complex conflicts – make sure that never happens, and if it does, Lotse and AI
// resolve it"). Pure – the same numbers as Kapazität / Teams / Lotse (engine weeksUtilization: Remaining Estimate spread
// evenly over the working days of each story, against the person's capacity after holidays, absences, daily business,
// internal work and the support reserve).
//
// Why this needs its own check: a person in two teams counts in each team with their SHARE (team capacity = capacity ×
// share). If team A's stories take more of the person than A's share, team A looks over while team B still shows the
// person's other share as free – hours that do not exist ("phantom capacity"). B can plan into them and nothing in B's
// own numbers turns red. And when both teams plan the same week, the person is double booked although each team looks fine.
//
//   splitConflicts(model, support, { weeks, people, only }) → {
//     weeks: [Monday ISO], people: [{ id, name, teams: [{ teamId, pct }], cap[], total[], byTeam: { teamId: hours[] },
//       actual: { teamId: h }, expected: { teamId: h }, conflicts: [conflict] }],
//     conflicts: [conflict + { personId }], phantomByTeam: { teamId: h } }
//
// conflict kinds (severity bad > warn > info):
//   overbooked   bad   weeks where the work of ≥ 2 teams together is more than the person's time (or they have no time)
//   priority     warn  in those weeks a lower-ranked project of one team takes time a better-ranked project of the other needs
//   shareDrift   warn  a team takes clearly more than its share – the other team counts phantom capacity; suggested shares
//   outsideWork  warn  work in a team the person is not a member of (Atlassian Teams / capacity) – it counts nowhere
//   sharesOff    warn  maintained shares that do not add up to 100 %
//   defaults     info  split across teams on default values (nobody maintained the hours yet)
import { capacityPeople, personCapacityIn, spreadWindow, shareIn } from './engine.js';
import { allocationOf, allocationOff } from './allocation.js';
import { weeksFrom, nextWorkday, isoOf } from './dates.js';

export const SPLIT_WEEKS = 12;
export const DRIFT_MIN_H = 8; // a share is "off" from 8 h over the horizon …
export const DRIFT_MIN_PCT = 0.15; // … and 15 % of the person's capacity in it
const EPS = 0.05;
const isOpen = (i) => (i?.status?.cat ?? i?.statusCat ?? 'new') !== 'done';
const hiddenId = (id) => !id || String(id).startsWith('anon') || String(id).startsWith('_');
const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);
const SEV = { bad: 3, warn: 2, info: 1 };

// Shares that follow where the hours really go: member teams only, multiples of 5, at least 5 % each (membership is
// Atlassian's – a share never drops to 0 here), together exactly 100.
export function sharesFromHours(actual, memberTeams) {
  const ids = memberTeams.filter(Boolean);
  if (ids.length < 2) return null;
  const tot = sum(ids.map((t) => actual[t] || 0));
  if (!(tot > EPS)) return null;
  let list = ids.map((teamId) => ({ teamId, pct: Math.max(5, Math.round(((actual[teamId] || 0) / tot) * 20) * 5) }));
  let diff = 100 - sum(list.map((x) => x.pct));
  // put the difference on the biggest share (never below 5)
  list.sort((a, b) => b.pct - a.pct);
  while (diff !== 0) {
    const step = diff > 0 ? 5 : -5;
    const k = diff > 0 ? 0 : list.findIndex((x) => x.pct - 5 >= 5);
    if (k < 0) break;
    list[k] = { ...list[k], pct: list[k].pct + step };
    diff -= step;
  }
  return list.sort((a, b) => b.pct - a.pct);
}

export function splitConflicts(model, support, { weeks: n = SPLIT_WEEKS, people = capacityPeople(model), only = null } = {}) {
  const W = weeksFrom(model.today, n);
  const rankOf = (ref) => model.itemByRef.get(ref)?.rank ?? 1e9;
  const plan = new Map(); // person → team → hours per week
  const tasks = new Map(); // person → [{ id, key, summary, ref, rank, teamId, hours }]
  for (const s of model.ds.issues || []) {
    if (s.role !== 'estimate' || !isOpen(s) || !(s.re > 0) || !s.assignee?.id || s.assignee.anon) continue;
    const pid = s.assignee.id;
    if (only && !only.has(pid)) continue;
    const win = spreadWindow(s, 're', model.today) || [nextWorkday(model.today), nextWorkday(model.today)];
    const hours = W.map(([a, b]) => shareIn(s.re, a, b, win, 'linear'));
    if (!hours.some((h) => h > 1e-9)) continue;
    const tid = s.team?.id || '_none';
    const byT = plan.get(pid) || plan.set(pid, new Map()).get(pid);
    const arr = byT.get(tid) || byT.set(tid, new Array(n).fill(0)).get(tid);
    hours.forEach((h, w) => { arr[w] += h; });
    (tasks.get(pid) || tasks.set(pid, []).get(pid)).push({ id: s.id, key: s.key, summary: s.summary, ref: s.rootRef, rank: rankOf(s.rootRef), teamId: tid, hours });
  }
  const cand = new Set();
  for (const p of people.values()) if (allocationOf(p).length >= 2) cand.add(p.id);
  for (const [pid, byT] of plan) if ([...byT.keys()].filter((t) => t !== '_none').length >= 2) cand.add(pid);
  const out = [];
  const flat = [];
  const phantomByTeam = {};
  for (const pid of cand) {
    if (hiddenId(pid) || (only && !only.has(pid))) continue;
    const p = people.get(pid);
    if (!p) continue;
    const alloc = allocationOf(p);
    const members = alloc.map((x) => x.teamId);
    const byT = plan.get(pid) || new Map();
    const supW = support?.personWeekly?.[pid] || 0;
    const cap = W.map(([a, b]) => personCapacityIn(model, p, a, b, supW));
    const teamIds = [...new Set([...members, ...byT.keys()])].filter((t) => t !== '_none' || byT.has('_none'));
    const total = W.map((_, w) => sum(teamIds.map((t) => byT.get(t)?.[w] || 0)));
    const capSum = sum(cap);
    const actual = Object.fromEntries(teamIds.map((t) => [t, sum(byT.get(t) || [])]));
    const expected = Object.fromEntries(alloc.map((x) => [x.teamId, (capSum * x.pct) / 100]));
    const conflicts = [];
    // 1. double booked: ≥ 2 teams' work in a week that holds less time
    const over = [];
    W.forEach(([a], w) => {
      const busy = teamIds.filter((t) => (byT.get(t)?.[w] || 0) > EPS);
      if (busy.length < 2 || !(total[w] > cap[w] + EPS)) return;
      over.push({ week: w, from: isoOf(a), load: total[w], cap: cap[w], util: cap[w] > EPS ? total[w] / cap[w] : Infinity, byTeam: Object.fromEntries(busy.map((t) => [t, byT.get(t)[w]])) });
    });
    if (over.length) {
      const peak = over.reduce((x, y) => (y.util > x.util ? y : x));
      conflicts.push({ kind: 'overbooked', severity: 'bad', weeks: over, peak: { from: peak.from, util: peak.util, load: peak.load, cap: peak.cap }, excess: sum(over.map((x) => Math.max(0, x.load - x.cap))), teams: [...new Set(over.flatMap((x) => Object.keys(x.byTeam)))] });
      // 2. priority: a better-ranked project of one team loses time to a worse-ranked one of another team in those weeks
      const inOver = (tasks.get(pid) || []).filter((t) => over.some((o) => t.hours[o.week] > EPS));
      const best = inOver.reduce((x, t) => (!x || t.rank < x.rank ? t : x), null);
      if (best) {
        const worse = inOver.filter((t) => t.teamId !== best.teamId && t.rank > best.rank);
        if (worse.length) {
          const h = sum(worse.map((t) => sum(over.map((o) => t.hours[o.week] || 0))));
          if (h > EPS) conflicts.push({ kind: 'priority', severity: 'warn', first: { ref: best.ref, rank: best.rank, teamId: best.teamId, key: best.key }, second: worse.slice(0, 5).map((t) => ({ ref: t.ref, rank: t.rank, teamId: t.teamId, key: t.key })), hours: h });
        }
      }
    }
    // 3. a team takes more than its share – the other team counts hours that are not there
    if (alloc.length >= 2 && capSum > EPS) {
      const lim = Math.max(DRIFT_MIN_H, DRIFT_MIN_PCT * capSum);
      const takers = alloc.filter((x) => (actual[x.teamId] || 0) - expected[x.teamId] > lim).map((x) => ({ teamId: x.teamId, pct: x.pct, actual: actual[x.teamId] || 0, expected: expected[x.teamId] }));
      const givers = alloc.filter((x) => expected[x.teamId] - (actual[x.teamId] || 0) > lim).map((x) => ({ teamId: x.teamId, pct: x.pct, actual: actual[x.teamId] || 0, expected: expected[x.teamId] }));
      if (takers.length && givers.length) {
        // phantom = the giver's "free" hours that the takers' extra work already uses
        let extra = sum(takers.map((x) => x.actual - x.expected));
        for (const g of givers) { g.phantom = Math.min(g.expected - g.actual, extra); extra -= g.phantom; phantomByTeam[g.teamId] = (phantomByTeam[g.teamId] || 0) + g.phantom; }
        conflicts.push({ kind: 'shareDrift', severity: 'warn', takers, givers, suggested: sharesFromHours(actual, members), current: alloc.map((x) => ({ teamId: x.teamId, pct: Math.round(x.pct) })) });
      }
    }
    // 4. work for a team the person is not in – it counts in no team's capacity
    for (const t of teamIds) if (t !== '_none' && !members.includes(t) && actual[t] > EPS) {
      conflicts.push({ kind: 'outsideWork', severity: 'warn', teamId: t, hours: actual[t], tasks: (tasks.get(pid) || []).filter((x) => x.teamId === t).map((x) => ({ id: x.id, key: x.key, ref: x.ref, hours: sum(x.hours) })) });
    }
    // 5. shares that do not add up; 6. split on default values
    if (!p.derived && allocationOff(p)) conflicts.push({ kind: 'sharesOff', severity: 'warn', total: Math.round(sum(alloc.map((x) => x.pct))), current: alloc.map((x) => ({ teamId: x.teamId, pct: Math.round(x.pct) })) });
    if (p.derived && alloc.length >= 2) conflicts.push({ kind: 'defaults', severity: 'info', weeklyHours: p.weeklyHours, teams: alloc.map((x) => ({ teamId: x.teamId, pct: Math.round(x.pct) })) });
    if (!conflicts.length && alloc.length < 2) continue;
    const rec = { id: pid, name: model.ds.people?.[pid]?.name || '', derived: !!p.derived, teams: alloc.map((x) => ({ teamId: x.teamId, pct: Math.round(x.pct) })), cap, total, byTeam: Object.fromEntries([...byT].map(([t, a]) => [t, a])), actual, expected, conflicts: conflicts.sort((a, b) => SEV[b.severity] - SEV[a.severity]) };
    out.push(rec);
    for (const c of rec.conflicts) flat.push({ ...c, personId: pid });
  }
  out.sort((a, b) => (SEV[b.conflicts[0]?.severity] || 0) - (SEV[a.conflicts[0]?.severity] || 0) || a.name.localeCompare(b.name, 'de'));
  return { weeks: W.map(([a]) => isoOf(a)), people: out, conflicts: flat, phantomByTeam };
}
// Only what needs fixing (info like "defaults" is advice, not a conflict).
export const realConflicts = (r) => (r?.conflicts || []).filter((c) => c.severity !== 'info');
