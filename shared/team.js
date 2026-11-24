// Teamdetails: one team at a glance – support first, then its projects in portfolio rank, per quarter the
// team's open demand (Remaining Estimate + open T-shirt size) against its capacity after support, its people
// week by week, and what is blocked or past due. Every number is the one the waterline and capacity views use.
import { capacityPeople, weeksUtilizationShared, teamSettings, projectShare, spreadWindow, shareIn, isTeamShown } from './engine.js';
import { personDays } from './locations.js';
import { inTeam, shareOf } from './allocation.js';
import { dayIdx, quarterRange, nextWorkday } from './dates.js';

const EPS = 0.01;
const isOpen = (i) => (i?.status?.cat ?? i?.statusCat ?? 'new') !== 'done';
const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);

// Teams that appear anywhere: capacity, waterline, stories, support.
export function teamIds(computed) {
  const { model, wl, support } = computed;
  const ids = new Set([...model.teams.keys()]);
  for (const t of wl.teamIds || []) ids.add(t);
  for (const t of support?.teams || []) ids.add(t.teamId);
  ids.delete('_none');
  for (const t of [...ids]) if (!isTeamShown(model, t)) ids.delete(t); // Configuration › Teams
  return [...ids].sort((a, b) => (model.teams.get(a)?.name || a).localeCompare(model.teams.get(b)?.name || b, 'de'));
}

// The story-level team of an issue (sub-tasks without their own team take the story's).
function teamOf(model, i) {
  if (i.team) return i.team.id;
  let cur = i.parentId ? model.byId.get(i.parentId) : null;
  while (cur) { if (cur.team && cur.role === 'estimate') return cur.team.id; cur = cur.parentId ? model.byId.get(cur.parentId) : null; }
  return null;
}

// Per model, once: each team's open stories / sub-tasks (story-level team, dataset order) and each project's stories
// by team – teamDetails runs for every team of the Team view and every compare, and scanned all work items each time.
const teamIndex = new WeakMap();
function indexOf(model) {
  let x = teamIndex.get(model);
  if (x) return x;
  const openByTeam = new Map(), storiesBy = new Map();
  for (const i of model.ds.issues || []) {
    if ((i.role === 'estimate' || i.role === 'tiny') && isOpen(i)) { const t = teamOf(model, i); (openByTeam.get(t) || openByTeam.set(t, []).get(t)).push(i); }
  }
  for (const [ref, list] of model.byRoot) {
    const m = new Map();
    for (const i of list) if (i.role === 'estimate' && i.team?.id) (m.get(i.team.id) || m.set(i.team.id, []).get(i.team.id)).push(i);
    storiesBy.set(ref, m);
  }
  x = { openByTeam, storiesBy };
  teamIndex.set(model, x);
  return x;
}
// Once per computed result and team (the Team view asks for every team, Lotse's team skills again): the result is
// shared – read it only. Recomputed when the parts it reads were replaced.
const detailsMemo = new WeakMap();
// Per model, once: the open stories (dataset order) by assignee and by team, and each assignee's projects – the person
// and team weeks scanned all work items on every call (8 weeks of "Meine Arbeit", every heatmap cell).
const openIx = new WeakMap();
function openIndex(model) {
  let x = openIx.get(model);
  if (x) return x;
  const byAssignee = new Map(), byTeam = new Map(), projectsOf = new Map();
  for (const s of model.ds.issues || []) {
    if (s.role !== 'estimate' || !isOpen(s)) continue;
    const a = s.assignee?.id;
    if (a) (projectsOf.get(a) || projectsOf.set(a, new Set()).get(a)).add(s.rootRef);
    if (!s.re) continue;
    if (a) (byAssignee.get(a) || byAssignee.set(a, []).get(a)).push(s);
    const t = s.team?.id || '_none';
    (byTeam.get(t) || byTeam.set(t, []).get(t)).push(s);
  }
  x = { byAssignee, byTeam, projectsOf };
  openIx.set(model, x);
  return x;
}
export function teamDetails(computed, teamId) {
  const { model, metrics, wl, support } = computed;
  let c = detailsMemo.get(computed);
  if (!c || c.model !== model || c.metrics !== metrics || c.wl !== wl || c.support !== support) { c = { model, metrics, wl, support, byTeam: new Map() }; detailsMemo.set(computed, c); }
  if (!c.byTeam.has(teamId)) c.byTeam.set(teamId, teamDetailsOf(computed, teamId));
  return c.byTeam.get(teamId);
}
// the waterline rows of one team and quarter by project (the first row of each project, as rows.find gives it)
const rowsIx = new WeakMap();
function wlRow(wl, teamId, q, ref) {
  const cell = wl.cells[teamId]?.[q];
  if (!cell) return undefined;
  let m = rowsIx.get(cell.rows || cell);
  if (!m) { m = new Map(); for (const r of cell.rows || []) if (r.kind === 'project' && !m.has(r.ref)) m.set(r.ref, r); rowsIx.set(cell.rows || cell, m); }
  return m.get(ref);
}
function teamDetailsOf(computed, teamId) {
  const { model, metrics, wl, support } = computed;
  const people = capacityPeople(model);
  // people split across teams count with their share (weekly hours × share)
  const members = [...people.values()].filter((p) => inTeam(p, teamId));
  const weeklyHours = sum(members, (p) => (+p.weeklyHours || 0) * shareOf(p, teamId));
  const ranked = [...model.items].filter((p) => metrics.has(p.ref)).sort((a, b) => a.rank - b.rank);
  const quarters = wl.quarters;
  const supTeam = (support?.teams || []).find((t) => t.teamId === teamId) || null;
  // the waterline reserves support per quarter (weekly × 12); the tiles show the same number per week
  const supportWeekly = supTeam?.weekly ?? ((support?.reserveQuarter?.[teamId] || 0) / 12);

  // support rows: one per service space the team works for
  const spaces = (support?.services || []).map((sv) => {
    const t = (sv.teams || []).find((x) => x.teamId === teamId);
    return t ? { id: sv.id, key: sv.key || null, name: sv.name || sv.key || sv.id, weekly: t.weekly, avg: t.avg, spike: t.spike, open: sv.open } : null;
  }).filter(Boolean);

  // capacity after support, project demand and what is left, per quarter (the waterline cells)
  const cells = Object.fromEntries(quarters.map((q) => {
    const c = wl.cells[teamId]?.[q];
    const cap = c ? Math.max(0, c.capacity - c.support) : 0;
    const demand = c ? Math.max(0, c.demand - c.support) : 0;
    return [q, { capacity: c?.capacity || 0, support: c?.support || 0, cap, demand, free: cap - demand, util: cap > 0 ? demand / cap : demand > 0 ? Infinity : 0 }];
  }));

  // project rows in rank: per quarter the team's demand, cumulative, and whether it still fits
  const projects = [];
  for (const p of ranked) {
    const m = metrics.get(p.ref);
    const stories = indexOf(model).storiesBy.get(p.ref)?.get(teamId) || [];
    const q = {};
    let any = false;
    for (const qq of quarters) {
      const d = m.demand[qq]?.[teamId] || 0;
      const row = wlRow(wl, teamId, qq, p.ref);
      q[qq] = { demand: d, cum: row ? row.cum - (wl.cells[teamId]?.[qq]?.support || 0) : null, status: row?.status || 'ok', staffed: row?.staffed ?? d };
      if (d > EPS) any = true;
    }
    const leadUnits = (m.units || []).filter((u) => u.team?.id === teamId);
    if (!any && !stories.length && !leadUnits.length && p.leadTeam?.id !== teamId) continue;
    projects.push({
      ref: p.ref, rank: p.rank, name: p.name, key: p.key, health: p.health || null,
      leadEpics: leadUnits.filter((u) => !u.isItem).map((u) => u.name), isLead: p.leadTeam?.id === teamId || leadUnits.some((u) => u.isItem),
      ts: sum(stories, (s) => s.ts), oe: sum(stories, (s) => s.oe), re: sum(stories.filter(isOpen), (s) => s.re), stories: stories.length, q,
    });
  }

  // blocked or past due: the team's open stories and sub-tasks
  const watch = [];
  for (const i of indexOf(model).openByTeam.get(teamId) || []) {
    const blocked = model.isBlocked(i);
    const due = dayIdx(i.due);
    const overdue = due != null && due < model.today;
    if (!blocked && !overdue) continue;
    watch.push({ id: i.id, blocked, overdue, days: overdue ? model.today - due : 0, since: i.blockedSince || null, rootRef: i.rootRef });
  }
  watch.sort((a, b) => (b.blocked - a.blocked) || (b.days - a.days));

  const cur = cells[quarters[0]];
  return {
    teamId, members: members.map((p) => p.id), shares: Object.fromEntries(members.map((p) => [p.id, Math.round(shareOf(p, teamId) * 100)])), weeklyHours, supportWeekly, supportShare: weeklyHours > 0 ? supportWeekly / weeklyHours : 0,
    spaces, projects, cells, quarters, watch,
    kpis: { members: members.length, projects: projects.length, spaces: spaces.length, utilCur: cur ? cur.util : 0, demandCur: cur?.demand || 0, capCur: cur?.cap || 0, watch: watch.length },
  };
}

// The team's people, week by week until the end of the current quarter: planned hours over all projects
// against their availability after support, holidays and absences (the capacity view's numbers).
export function teamWeeks(computed, teamId) {
  const { model, support } = computed;
  const end = quarterRange(model.curQ)[1];
  const n = Math.max(1, Math.min(14, Math.ceil((end - model.today + 1) / 7)));
  const wu = weeksUtilizationShared(model, support, n);
  const t = wu.teams.find((x) => x.teamId === teamId);
  const { projectsOf } = openIndex(model);
  return {
    weeks: wu.weeks,
    rows: (t?.members || []).map((m) => ({ ...m, projects: [...(projectsOf.get(m.id) || [])], support: support?.personWeekly?.[m.id] || 0, absent: m.cap.map((c, i) => c <= EPS && m.plan[i] > EPS) })),
    plan: t?.plan || [], cap: t?.cap || [],
  };
}

// ---------- one cell of the weekly heatmap, explained (the same arithmetic as personCapacityIn / weeksUtilization) ----------
// person week: gross hours (working days after holidays and absences) − daily business − internal − support = available;
// planned = the person's open stories' remaining estimate spread evenly up to their due dates; utilisation = planned ÷ available.
export function personWeek(computed, personId, a, b) {
  const { model, support } = computed;
  const p = capacityPeople(model).get(personId);
  if (!p) return null;
  const st = teamSettings(model, p.teamId);
  const share = projectShare(st);
  // working days, holidays and company days off of the person's location (shared/locations.js)
  const { all, work, absent, days, perWeek } = personDays(model.cfg, p, model.ds.capacity?.absences, a, b);
  const weekly = +p.weeklyHours || 0;
  const gross = (weekly * days) / perWeek;
  const dPct = +st.dailyBusinessPct || 0, iPct = +st.internalPct || 0;
  const sup = (support?.personWeekly?.[p.id] || 0) * (all / perWeek || 1);
  const cap = Math.max(0, gross * share - sup);
  const items = [];
  for (const s of openIndex(model).byAssignee.get(p.id) || []) {
    const win = spreadWindow(s, 're', model.today) || [nextWorkday(model.today), nextWorkday(model.today)];
    const h = shareIn(s.re, a, b, win, 'linear');
    if (h > 0.05) items.push({ id: s.id, key: s.key, summary: s.summary, project: model.itemByRef.get(s.rootRef)?.name || '', h, re: s.re, due: s.due || null, overdue: win[0] === win[1] && dayIdx(s.due) != null && dayIdx(s.due) < model.today });
  }
  items.sort((x, y) => y.h - x.h);
  const plan = items.reduce((t, x) => t + x.h, 0);
  return { weekly, all, perWeek, holidays: all - work, absent, days, gross, dPct, iPct, daily: (gross * dPct) / 100, internal: (gross * iPct) / 100, support: sup, cap, plan, util: cap > 0 ? plan / cap : plan > 0 ? Infinity : 0, items };
}
// team week: the team's stories (by team field) in that week, against the summed capacity of its people
export function teamWeekItems(computed, teamId, a, b) {
  const { model } = computed;
  const items = [];
  for (const s of openIndex(model).byTeam.get(teamId) || []) {
    const win = spreadWindow(s, 're', model.today) || [nextWorkday(model.today), nextWorkday(model.today)];
    const h = shareIn(s.re, a, b, win, 'linear');
    if (h > 0.05) items.push({ id: s.id, key: s.key, summary: s.summary, assignee: s.assignee?.id || null, project: model.itemByRef.get(s.rootRef)?.name || '', h });
  }
  return items.sort((x, y) => y.h - x.h);
}
