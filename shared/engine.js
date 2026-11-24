// Portfolio Cockpit engine: every number the cockpit shows comes from here.
// Pure functions over the normalized dataset; used by the UI (live) and the backend (daily report).
import { atlIndex, evenSplit, teamScope } from './atlTeams.js';
import {
  dayIdx, isoOf, workdays, nextWorkday, quarterKeyOf, quarterRange, quartersFrom,
  weeksFrom, mondayOf, compareQuarter,
} from './dates.js';
import { personDays } from './locations.js';
import { allocationOf, shareOf, inTeam } from './allocation.js';
import { supportAnalytics } from './sla.js';

export const ROLES = ['portfolio', 'rough', 'structure', 'estimate', 'tiny'];
export const USAGES = ['owner', 'team', 'assignee', 'originalEstimate', 'startDate', 'dueDate', 'milestone', 'tshirt', 'targetQuarters', 'parent'];
// Hours per T-shirt size from the company's Jira structure spec (example values, changeable in the app).
export const DEFAULT_TSHIRTS = [
  { key: 'XS', hours: 40 }, { key: 'S', hours: 80 }, { key: 'M', hours: 160 },
  { key: 'L', hours: 320 }, { key: 'XL', hours: 640 },
];
export const DEFAULT_MATRIX = {
  portfolio: { owner: 'required', dueDate: 'optional', tshirt: 'required', targetQuarters: 'required', team: 'optional' },
  rough: { team: 'required', tshirt: 'required', targetQuarters: 'required', parent: 'required' },
  structure: { team: 'optional', parent: 'optional', startDate: 'optional', dueDate: 'optional' },
  estimate: { team: 'required', assignee: 'optional', originalEstimate: 'required', startDate: 'required', dueDate: 'required', milestone: 'optional', parent: 'required' },
  tiny: { assignee: 'optional' },
};
const EPS = 0.01;
const SEVERITY = { ok: 0, partial: 1, no: 2 };
const isOpen = (i) => (i?.status?.cat ?? i?.statusCat) !== 'done';
const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const round1 = (n) => Math.round(n * 10) / 10;

// ---------- distribution ----------
// Window over which an amount is spread. kind: 'oe' (plan) or 're' (remaining, from today on).
export function spreadWindow(issue, kind, today) {
  const s = dayIdx(issue.start), e = dayIdx(issue.due);
  if (kind === 'oe') {
    if (e == null && s == null) return null;
    return [s ?? e, e ?? s].sort((a, b) => a - b);
  }
  if (e == null) return null;
  if (e < today) { const n = nextWorkday(today); return [n, n]; } // overdue work is booked now
  return [Math.max(s ?? today, today), e];
}
export function shareIn(amount, a, b, win, rule = 'linear') {
  if (!win || !amount) return 0;
  const [s, e] = win;
  if (rule === 'start') return s >= a && s <= b ? amount : 0;
  if (rule === 'due') return e >= a && e <= b ? amount : 0;
  const total = workdays(s, e);
  if (total === 0) return e >= a && e <= b ? amount : 0;
  const lo = Math.max(a, s), hi = Math.min(b, e);
  return hi < lo ? 0 : (amount * workdays(lo, hi)) / total;
}
// Weekly planning (UC-05): "Original Estimate spread evenly over the weeks between start and due date" –
// every week the task touches (with at least one working day in the window) gets the same share.
// 80 h from Wed W47 to Tue W48 = 40 h + 40 h (by working days it would be 67 h + 13 h).
export function weekShare(amount, a, b, win) {
  if (!win || !amount) return 0;
  const [s, e] = win;
  if (e < a || s > b) return 0;
  const mon = (d) => d - ((((d + 3) % 7) + 7) % 7); // day index of the Monday (day 0 = Thursday 1970-01-01)
  const touches = (m) => workdays(Math.max(m, s), Math.min(m + 6, e)) > 0;
  let n = 0;
  for (let m = mon(s); m <= e; m += 7) if (touches(m)) n += 1;
  if (!n) return e >= a && e <= b ? amount : 0; // window without a working day: all in the due week
  // the board's week [a, b] may be any Monday..Sunday span; it counts once when it touches the window
  for (let m = mon(a); m <= b; m += 7) if (m <= e && m + 6 >= s && touches(m)) return amount / n;
  return 0;
}

// ---------- model ----------
// "Blocked" (company workflow): the statuses an admin chose in the configuration; without a choice every
// status named "Blocked" (or "Blockiert") counts. Used for stories and sub-tasks.
export function blockedMatcher(cfg) {
  const ids = new Set((cfg?.dependencies?.blockedStatusIds || []).map(String));
  if (ids.size) return (i) => ids.has(String(i?.status?.id ?? ''));
  return (i) => /^(blocked|blockiert)$/i.test(String(i?.status?.name || '').trim());
}

// The teams the cockpit shows: iterating (keys/values/size/for…of) yields only the chosen teams, while get()/has()
// still answer for a hidden team, so a work item of a hidden team keeps its name everywhere it is mentioned.
class ScopedTeams extends Map {
  constructor(entries, hidden) { super(entries); this.hidden = hidden; }
  get(id) { return super.get(id) ?? this.hidden.get(id); }
  has(id) { return super.has(id) || this.hidden.has(id); }
}
function scopedTeams(all, scope) {
  if (!scope) return all;
  const shown = [], hidden = new Map();
  for (const [id, t] of all) (scope.has(id) ? shown.push([id, t]) : hidden.set(id, t));
  return new ScopedTeams(shown, hidden);
}
export const isTeamShown = (model, id) => !(model.teams instanceof ScopedTeams) || model.teams.hidden.has(id) === false;

export function buildModel(ds) {
  const steps = buildModelSteps(ds, Infinity);
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}
// The same model, built in slices: yields after every `every` work items, so the browser can build it between frames
// (lib/computeWorker.js) – the generator's return value is the model.
export function* buildModelSteps(ds, every = 4000) {
  const today = dayIdx(ds.today);
  const cfg = ds.config || {};
  const levels = cfg.levels || [];
  const hasRough = levels.some((l) => l.role === 'rough');
  const sizes = new Map((cfg.tshirtSizes || DEFAULT_TSHIRTS).map((t) => [String(t.key).trim().replace(/\s+/g, ' ').toUpperCase(), +t.hours || 0]));
  const byId = new Map(), children = new Map(), byRoot = new Map();
  let n = 0;
  for (const i of ds.issues || []) {
    if (++n % every === 0) yield n;
    byId.set(i.id, i);
    if (i.parentId) (children.get(i.parentId) || children.set(i.parentId, []).get(i.parentId)).push(i);
    (byRoot.get(i.rootRef) || byRoot.set(i.rootRef, []).get(i.rootRef)).push(i);
  }
  const items = [...(ds.portfolio || [])].sort((a, b) => a.rank - b.rank);
  const itemByRef = new Map(items.map((p) => [p.ref, p]));
  const external = new Map((ds.external || []).map((x) => [x.id, x]));
  const versions = ds.versions || {};
  const milestoneOfVersion = new Map();
  for (const m of ds.milestones || []) for (const v of m.fixVersionIds || []) milestoneOfVersion.set(String(v), m);
  const milestoneByName = new Map((ds.milestones || []).map((m) => [String(m.name).trim().toLowerCase(), m]));
  const msField = !!cfg.fields?.milestone;
  const all = new Map((ds.teams || []).map((t) => [t.id, t]));
  for (const i of ds.issues || []) if (i.team && !all.has(i.team.id)) all.set(i.team.id, i.team);
  for (const p of items) if (p.leadTeam && !all.has(p.leadTeam.id)) all.set(p.leadTeam.id, p.leadTeam);
  // Configuration › Teams: only the chosen teams are listed anywhere (views, capacity, KPIs); work items keep their team
  const teams = scopedTeams(all, teamScope(cfg));
  return {
    ds, cfg, today, levels, hasRough, sizes, byId, children, byRoot, items, itemByRef, external, versions,
    milestoneOfVersion, milestoneByName, msField, msCache: new Map(), teams, rule: cfg.rules?.distribution || 'linear',
    curQ: quarterKeyOf(today), isBlocked: blockedMatcher(cfg),
  };
}
// Sizes match the whole option value ("MEDIUM") or, for values like "M (320 h)", their first word.
export const sizeHours = (model, key) => {
  if (!key) return 0;
  const k = String(key).trim().replace(/\s+/g, ' ').toUpperCase();
  return model.sizes.get(k) ?? model.sizes.get(k.split(/[\s(]/)[0]) ?? 0;
};

export function ancestor(model, issue, role) {
  let cur = issue.parentId ? model.byId.get(issue.parentId) : null;
  while (cur) { if (cur.role === role) return cur; cur = cur.parentId ? model.byId.get(cur.parentId) : null; }
  return null;
}
// Milestone of a work item: from the mapped custom field (a configured milestone by name, or the
// field's own date), otherwise from its fix versions.
export const milestoneOf = (model, issue) => {
  if (model.msField) {
    const v = issue.milestone;
    if (!v) return null;
    const named = v.name ? model.milestoneByName.get(v.name.trim().toLowerCase()) : null;
    if (named) return named;
    if (!v.date) return null;
    const key = `${v.name || ''}|${v.date}`;
    if (!model.msCache.has(key)) model.msCache.set(key, { id: `field:${key}`, name: v.name || v.date, date: v.date, fixVersionIds: [], fromField: true });
    return model.msCache.get(key);
  }
  for (const v of issue.fixVersionIds || []) { const m = model.milestoneOfVersion.get(String(v)); if (m) return m; }
  return null;
};

// Rough-planning units of a project: the rough-level items below it (e.g. epics under a project), or – when
// there are none, e.g. because the portfolio items ARE the epics – the portfolio item itself with its own
// T-shirt size. (Before, such items fell through and their T-shirt size was ignored.)
export function roughUnits(model, item) {
  if (model.hasRough) {
    const below = (model.byRoot.get(item.ref) || []).filter((i) => i.role === 'rough');
    if (below.length) return below;
  }
  return [{ id: `item:${item.ref}`, tshirt: item.tshirt, quarters: item.quarters || [], team: item.leadTeam, isItem: true }];
}
function roughOf(model, item, story, itemIsUnit) {
  if (itemIsUnit) return `item:${item.ref}`;
  return ancestor(model, story, 'rough')?.id ?? null;
}

// ---------- project metrics (UC-01, UC-06, UC-10) ----------
export function projectMetrics(model, item, horizonQuarters = 4) {
  const { today, curQ, rule } = model;
  const issues = model.byRoot.get(item.ref) || [];
  const stories = issues.filter((i) => i.role === 'estimate');
  // D1: Time Spent is the aggregate of stories and their sub-tasks.
  const OE = sum(stories, (s) => s.oe), RE = sum(stories.filter(isOpen), (s) => s.re);
  // story totals already include sub-tasks (ds.storyTotals); older datasets add the sub-tasks' time here
  const TS = sum(stories, (s) => s.ts) + (model.ds.storyTotals ? 0 : sum(issues.filter((i) => i.role === 'tiny'), (i) => i.ts));
  const quarters = quartersFrom(curQ, horizonQuarters);
  const qRanges = new Map(quarters.map((q) => [q, quarterRange(q)]));
  const units = roughUnits(model, item);
  const itemIsUnit = units.length === 1 && units[0].isItem;
  const storiesByUnit = new Map();
  for (const s of stories) {
    const u = roughOf(model, item, s, itemIsUnit) ?? '_none';
    (storiesByUnit.get(u) || storiesByUnit.set(u, []).get(u)).push(s);
  }
  let tshirtTotal = 0, openTshirt = 0, expired = 0;
  const openByQ = {}, demand = {}, unscheduled = {}; // demand[q][teamId] = hours; unscheduled[teamId] = RE without due date
  const addDemand = (q, teamId, h) => {
    if (!h) return;
    const d = (demand[q] ||= {});
    d[teamId] = (d[teamId] || 0) + h;
  };
  const unitInfo = [];
  for (const u of units) {
    const hours = sizeHours(model, u.tshirt);
    tshirtTotal += hours;
    const qs = [...new Set((u.quarters || []).filter(Boolean))].sort(compareQuarter);
    const us = storiesByUnit.get(u.id) || [];
    const firstOpenQ = qs.find((q) => compareQuarter(q, curQ) >= 0) ?? curQ;
    const consumedIn = (q) => {
      const r = quarterRange(q);
      return sum(us, (s) => {
        const w = spreadWindow(s, 'oe', today);
        if (!w) return q === firstOpenQ ? s.oe || 0 : 0;
        return shareIn(s.oe || 0, r[0], r[1], w, rule);
      });
    };
    let uOpen = 0, uExpired = 0;
    if (hours > 0 && qs.length === 0) {
      uOpen = Math.max(0, hours - sum(us, (s) => s.oe));
      openByQ[curQ] = (openByQ[curQ] || 0) + uOpen;
      addDemand(curQ, u.team?.id || '_none', uOpen);
    } else if (hours > 0) {
      const per = hours / qs.length;
      for (const q of qs) {
        const open = Math.max(0, per - consumedIn(q));
        if (compareQuarter(q, curQ) < 0) uExpired += open;
        else {
          uOpen += open;
          openByQ[q] = (openByQ[q] || 0) + open;
          addDemand(q, u.team?.id || '_none', open);
        }
      }
    }
    openTshirt += uOpen; expired += uExpired;
    unitInfo.push({ id: u.id, isItem: !!u.isItem, key: u.isItem ? item.key : u.key, name: u.isItem ? item.name : u.summary, tshirt: u.tshirt || null, hours, quarters: qs, team: u.team || null, open: uOpen, expired: uExpired, tooLong: qs.length > 2, oe: sum(us, (s) => s.oe) });
  }
  for (const s of stories) {
    if (!isOpen(s) || !s.re) continue;
    const w = spreadWindow(s, 're', today);
    const tid = s.team?.id || '_none';
    if (!w) { addDemand(curQ, tid, s.re); unscheduled[tid] = (unscheduled[tid] || 0) + s.re; continue; } // D7: counts now, shown as 'unscheduled'
    for (const q of quarters) { const r = qRanges.get(q); addDemand(q, tid, shareIn(s.re, r[0], r[1], w, 'linear')); }
  }
  const forecast = TS + RE;
  const denom = TS + RE + openTshirt;
  const progress = denom > 0 ? TS / denom : 0;
  const estimatedShare = stories.length ? stories.filter((s) => s.oe > 0).length / stories.length : null;
  // Reife compares the detailed estimate with the rough one, so it only covers units WITH a T-shirt size.
  // Without any T-shirt size it is unknown how much is still missing: no percentage (not 100 %).
  const covered = unitInfo.filter((u) => u.hours > 0);
  const oeCovered = sum(covered, (u) => u.oe);
  const maturity = covered.length ? maturityOf(oeCovered, openTshirt) : null;
  const maturityBasis = { units: unitInfo.length, withTshirt: covered.length, missing: unitInfo.filter((u) => !(u.hours > 0)).map((u) => u.id), oeCovered, oeUncovered: OE - oeCovered };
  const thr = (model.cfg.rules?.forecastThresholdPct ?? 10) / 100;
  const warnings = [];
  if (OE > 0 && forecast > OE * (1 + thr)) warnings.push({ kind: 'forecastOverPlan', pct: forecast / OE - 1 });
  if (tshirtTotal > 0 && OE > tshirtTotal * (1 + thr)) warnings.push({ kind: 'planOverRough', pct: OE / tshirtTotal - 1 }); // same threshold as the forecast warning
  if (expired > EPS) warnings.push({ kind: 'expiredTshirt', hours: expired });
  const dueIdx = dayIdx(item.due) ?? stories.reduce((m, s) => Math.max(m, dayIdx(s.due) ?? -Infinity), -Infinity);
  const due = Number.isFinite(dueIdx) ? isoOf(dueIdx) : null;
  const overdueIssues = stories.filter((i) => isOpen(i) && dayIdx(i.due) != null && dayIdx(i.due) < today);
  const openStoryCount = stories.filter(isOpen).length;
  const itemOpen = (item.statusCat ?? 'new') !== 'done';
  const daysOverdue = itemOpen && due && dayIdx(due) < today ? today - dayIdx(due) : 0;
  return {
    ref: item.ref, rank: item.rank, OE, RE, TS, forecast, tshirtTotal, openTshirt, expired, progress, maturity, maturityBasis,
    warnings, openByQ, demand, quarters, units: unitInfo, due, daysOverdue, overdueCount: overdueIssues.length,
    overdueIssues: overdueIssues.map((i) => i.id), storyCount: stories.length, openStoryCount, issueCount: issues.length,
    estimatedShare, done: !itemOpen, unscheduled,
  };
}

// Planning maturity ("Reife"): how reliable the numbers are –
// Original Estimate ÷ (Original Estimate + open T-shirt size). Null while nothing is planned.
export function maturityOf(OE, openTshirt) {
  return OE + openTshirt > 0 ? OE / (OE + openTshirt) : null;
}

// ---------- capacity ----------
// dailyBusinessPct (Tagesgeschäft) and internalPct (internal work) are taken off every week, as shares of the
// gross hours: 40 h − 20 % − 10 % = 28 h. absenceRatePct (Ausfallquote) only applies to quarter planning, where
// holidays and absences are not known yet – the weekly view deducts the real ones instead.
const DEFAULT_TEAM = { dailyBusinessPct: 20, internalPct: 0, absenceRatePct: 10 };
export function teamSettings(model, teamId) {
  return { ...DEFAULT_TEAM, ...(model.ds.capacity?.teams?.[teamId] || {}) };
}
// The share of the gross hours left for projects every week (never below 5 %).
export const projectShare = (st) => Math.max(0.05, 1 - ((+st.dailyBusinessPct || 0) + (+st.internalPct || 0)) / 100);
// People with capacity: saved entries plus every assignee (derived defaults), each with a team.
const primaryCache = new WeakMap(); // model → Map(person → primary team id | null)
function primaryTeams(model) {
  let out = primaryCache.get(model);
  if (out) return out;
  const reByTeam = new Map(); // person -> team -> remaining hours
  for (const i of model.ds.issues || []) {
    if (!i.assignee?.id || i.role !== 'estimate') continue;
    const m = reByTeam.get(i.assignee.id) || reByTeam.set(i.assignee.id, new Map()).get(i.assignee.id);
    if (i.team?.id) m.set(i.team.id, (m.get(i.team.id) || 0) + (i.re || 0) + 0.001);
  }
  out = new Map();
  for (const [pid, m] of reByTeam) out.set(pid, [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null);
  primaryCache.set(model, out);
  return out;
}
// A maintained person's teams, made to match Atlassian Teams: teams Atlassian judges and the person is not in are
// dropped, Atlassian teams missing from the capacity are added. Kept teams keep their maintained shares (scaled into
// what is left), added teams get an even share; teams Atlassian does not know stay as maintained.
export function syncMaintained(p, atl) {
  const mine = atl.byPerson.get(p.id) || []; // the shown teams the person is a member of
  const alloc = allocationOf(p);
  const keep = alloc.filter((x) => !atl.judged(x.teamId) || atl.isMember(p.id, x.teamId));
  const add = mine.filter((t) => !keep.some((x) => x.teamId === t));
  if (!add.length && keep.length === alloc.length) return;
  p.maintainedTeams = alloc.map((x) => ({ teamId: x.teamId, pct: Math.round(x.pct) }));
  p.syncedFromAtlassian = true;
  const n = keep.length + add.length;
  if (!n) { p.teamId = null; p.teams = []; return; }
  const addPct = keep.length ? Math.floor(100 / n) : 0;
  const keepSum = keep.reduce((a, x) => a + x.pct, 0) || 1;
  const room = 100 - addPct * add.length;
  let list = [...keep.map((x) => ({ teamId: x.teamId, pct: Math.max(1, Math.round((x.pct / keepSum) * room)) })), ...add.map((teamId) => ({ teamId, pct: addPct }))];
  if (!keep.length) list = evenSplit(add, add.includes(p.teamId) ? p.teamId : add[0]);
  const diff = 100 - list.reduce((a, x) => a + x.pct, 0);
  list[0] = { ...list[0], pct: list[0].pct + diff };
  const main = list.some((x) => x.teamId === p.teamId) ? p.teamId : list.slice().sort((x, y) => y.pct - x.pct)[0].teamId;
  p.teamId = main;
  p.teams = list.length === 1 ? undefined : list;
}
export function capacityPeople(model) {
  const cap = model.ds.capacity || {};
  const saved = cap.people || {};
  const out = new Map();
  for (const [id, p] of Object.entries(saved)) out.set(id, { id, ...p, derived: false });
  // the primary team of every assignee (one scan over all work items, once per model – capacityPeople is called by
  // every capacity view; the returned Map and its objects stay fresh per call, callers may change them)
  const primary = primaryTeams(model);
  const fresh = (pid, teamId) => ({ id: pid, weeklyHours: cap.defaultWeeklyHours ?? 40, location: cap.defaultLocation || 'NONE', teamId, derived: true });
  for (const [pid, main] of primary) {
    const cur = out.get(pid);
    if (!cur) out.set(pid, fresh(pid, main));
    else if (!cur.teamId) cur.teamId = main;
  }
  // Atlassian Teams: a person without maintained capacity belongs to exactly their Atlassian teams (hours split
  // evenly), and team members without any work item yet count too. Maintained capacity is never changed here.
  const atl = atlIndex(model.ds);
  if (atl) {
    for (const [pid, tids] of atl.byPerson) {
      const cur = out.get(pid);
      if (cur && !cur.derived) continue;
      const main = tids.includes(primary.get(pid)) ? primary.get(pid) : tids[0];
      out.set(pid, { ...(cur || fresh(pid, main)), teamId: main, teams: evenSplit(tids, main), fromAtlassian: true });
    }
    // Maintained people too (boss 2026-11-17: someone added to "CEO" in Atlassian Teams was not listed there): the
    // TEAMS come from Atlassian, the maintained values stay – weekly hours, location, and the shares of teams they keep.
    for (const p of out.values()) if (!p.derived) syncMaintained(p, atl);
  }
  return out;
}
// Quarter capacity with every input kept, so the UI can show the exact calculation:
// weekly hours × 12 weeks × project share (100 % − daily business − internal) × (100 % − absence rate).
export const QUARTER_WEEKS = 12;
export function quarterCapacityParts(model, teamId, people = capacityPeople(model)) {
  const st = teamSettings(model, teamId);
  const members = [];
  let weekly = 0;
  // a person split across teams counts with their share here (weekly hours × share)
  for (const p of people.values()) {
    const sh = shareOf(p, teamId);
    if (sh <= 0) continue;
    weekly += (+p.weeklyHours || 0) * sh;
    members.push({ id: p.id, weeklyHours: (+p.weeklyHours || 0) * sh, ...(sh < 1 ? { pct: Math.round(sh * 100), fullWeeklyHours: +p.weeklyHours || 0 } : {}) });
  }
  const teamWeekly = !weekly && model.ds.capacity?.teamWeekly?.[teamId] ? +model.ds.capacity.teamWeekly[teamId] : 0;
  const extra = +st.extraWeeklyHours || 0; // unnamed capacity (headcount not yet assigned to people)
  const weeklyTotal = weekly + teamWeekly + extra;
  const share = projectShare(st);
  const absencePct = +st.absenceRatePct || 0;
  const total = weeklyTotal * QUARTER_WEEKS * share * (1 - absencePct / 100);
  return { members, peopleWeekly: weekly, teamWeekly, extra, weekly: weeklyTotal, weeks: QUARTER_WEEKS, share, dailyPct: +st.dailyBusinessPct || 0, internalPct: +st.internalPct || 0, absencePct, total };
}
export function quarterCapacity(model, teamId, people = capacityPeople(model)) {
  return quarterCapacityParts(model, teamId, people).total;
}
// Capacity of one person in [a, b] (concrete: holidays and absences deducted, plus daily business, internal work and support share).
// Holidays, company days off and working days come from the person's location (shared/locations.js).
export function personCapacityIn(model, person, a, b, supportWeekly = 0) {
  const { all, days, perWeek } = personDays(model.cfg, person, model.ds.capacity?.absences, a, b);
  const st = teamSettings(model, person.teamId);
  const weeks = all / perWeek || 1;
  const gross = ((+person.weeklyHours || 0) * days) / perWeek;
  return Math.max(0, gross * projectShare(st) - supportWeekly * weeks);
}

// Whole hours that still add up: each value rounded so that the shown parts sum exactly to the rounded total
// (largest remainder). Every number in the waterline panel is taken from here, so any sum a reader checks works out.
export function roundParts(values) {
  const total = Math.round(values.reduce((a, v) => a + v, 0));
  const floors = values.map((v) => Math.floor(v));
  let rest = total - floors.reduce((a, v) => a + v, 0);
  const order = values.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const out = [...floors];
  for (const [, i] of order) { if (rest <= 0) break; out[i] += 1; rest -= 1; }
  return out;
}
// ---------- waterline (UC-11) ----------
export function waterline(model, metricsByRef, support, horizonQuarters = 4) {
  const quarters = quartersFrom(model.curQ, horizonQuarters);
  const people = capacityPeople(model);
  const teamIds = new Set([...model.teams.keys()]);
  for (const m of metricsByRef.values()) for (const q of Object.keys(m.demand)) for (const t of Object.keys(m.demand[q])) if (isTeamShown(model, t)) teamIds.add(t);
  const ranked = [...model.items].filter((p) => metricsByRef.has(p.ref)).sort((a, b) => a.rank - b.rank);
  const cells = {}; // cells[teamId][q]
  const projectQ = {}; // projectQ[ref][q] = { status, teams: [{teamId, status, demand, staffed}] }
  for (const t of teamIds) {
    cells[t] = {};
    for (const q of quarters) {
      const capParts = t === '_none' ? null : quarterCapacityParts(model, t, people);
      const cap = capParts ? capParts.total : 0;
      const sup = support?.reserveQuarter?.[t] || 0;
      let cum = sup;
      const rows = [{ kind: 'support', demand: sup, cum, status: sup <= cap + EPS ? 'ok' : 'no' }];
      let waterRank = null;
      for (const p of ranked) {
        const d = metricsByRef.get(p.ref).demand[q]?.[t] || 0;
        if (d <= EPS) continue;
        const prev = cum; cum += d;
        const status = cum <= cap + EPS ? 'ok' : prev >= cap - EPS ? 'no' : 'partial';
        const staffed = Math.max(0, Math.min(d, cap - prev));
        if (status !== 'ok' && waterRank == null) waterRank = p.rank;
        rows.push({ kind: 'project', ref: p.ref, rank: p.rank, demand: d, cum, staffed, status });
        const pq = ((projectQ[p.ref] ||= {})[q] ||= { status: 'ok', teams: [] });
        pq.teams.push({ teamId: t, status, demand: d, staffed });
        if (SEVERITY[status] > SEVERITY[pq.status]) pq.status = status;
      }
      const demandTotal = cum;
      if (demandTotal <= EPS && cap <= EPS) continue;
      const unsched = q === quarters[0] ? ranked.reduce((a, p) => a + (metricsByRef.get(p.ref).unscheduled?.[t] || 0), 0) : 0;
      cells[t][q] = { teamId: t, q, capacity: cap, capParts, support: sup, demand: demandTotal, util: cap > 0 ? demandTotal / cap : demandTotal > 0 ? Infinity : 0, rows, waterRank, unscheduled: unsched };
    }
  }
  return { quarters, cells, projectQ, teamIds: [...teamIds].filter((t) => Object.keys(cells[t] || {}).length) };
}
// One plain sentence for a waterline cell (DE/EN), singular and plural right: no project demand, one project, all
// projects staffed, the bottleneck already at the first project, or "up to rank N … from rank N+1 X h missing".
export function waterlineSentence(cell, model, lang = 'de') {
  if (!cell) return '';
  const de = lang === 'de';
  const name = (r) => model.itemByRef.get(r)?.name || r;
  const projects = cell.rows.filter((r) => r.kind === 'project');
  const ok = projects.filter((r) => r.status === 'ok').length;
  const firstIdx = projects.findIndex((r) => r.status !== 'ok');
  const first = projects[firstIdx];
  const pct = Math.round((cell.util === Infinity ? 0 : cell.util) * 100);
  const whole = (h) => Math.max(1, Math.round(h)); // a gap is never shown as "0 h"
  const missing = (h) => { const n = whole(h); return de ? `${n === 1 ? 'fehlt' : 'fehlen'} ${n} h` : `${n} h ${n === 1 ? 'is' : 'are'} missing`; };
  if (!projects.length) {
    const over = (cell.support || 0) - (cell.capacity || 0);
    if (over > EPS) return de ? `Kein Projektbedarf in diesem Quartal; schon die Support-Reserve übersteigt die Kapazität um ${whole(over)} h.`
      : `No project demand this quarter; the support reserve alone exceeds capacity by ${whole(over)} h.`;
    return de ? 'Kein Projektbedarf in diesem Quartal.' : 'No project demand this quarter.';
  }
  if (!first) {
    if (ok === 1) return de ? `Das Projekt ist voll besetzbar; Auslastung ${pct} %.` : `The project can be fully staffed; utilization ${pct} %.`;
    return de ? `Alle ${ok} Projekte sind besetzbar; Auslastung ${pct} %.` : `All ${ok} projects can be staffed; utilization ${pct} %.`;
  }
  const miss = first.cum - cell.capacity;
  if (firstIdx === 0 || !(first.rank > 1)) {
    return de ? `Schon Rang ${first.rank} (${name(first.ref)}) ist nicht voll besetzbar – es ${missing(miss)}.`
      : `Already rank ${first.rank} (${name(first.ref)}) cannot be fully staffed – ${missing(miss)}.`;
  }
  return de ? `Bis Rang ${first.rank - 1} ist alles besetzbar; ab Rang ${first.rank} (${name(first.ref)}) ${missing(miss)}.`
    : `Everything up to rank ${first.rank - 1} can be staffed; from rank ${first.rank} (${name(first.ref)}) ${missing(miss)}.`;
}

// ---------- weeks utilization (UC-05) ----------
// Shared per model, support and number of weeks for readers that only read the result (realistic capacity, the team
// weeks): computed once per data state instead of once per question / view. computeAll keeps its own fresh copy.
const wuMemo = new WeakMap();
export function weeksUtilizationShared(model, support, nWeeks = 8) {
  const m = wuMemo.get(model) || wuMemo.set(model, new Map()).get(model);
  const bySupport = m.get(nWeeks) || m.set(nWeeks, new Map()).get(nWeeks);
  const k = support ?? null;
  if (!bySupport.has(k)) bySupport.set(k, weeksUtilization(model, support, nWeeks));
  return bySupport.get(k);
}
export function weeksUtilization(model, support, nWeeks = 8) {
  const weeks = weeksFrom(model.today, nWeeks);
  const people = capacityPeople(model);
  const personPlan = new Map(), teamPlan = new Map(), teamProject = new Map(), projectTeam = new Map();
  const add = (map, k, w, h) => { const a = map.get(k) || map.set(k, new Array(nWeeks).fill(0)).get(k); a[w] += h; };
  for (const s of model.ds.issues || []) {
    if (s.role !== 'estimate' || !isOpen(s) || !s.re) continue;
    const win = spreadWindow(s, 're', model.today) || [nextWorkday(model.today), nextWorkday(model.today)];
    weeks.forEach(([a, b], w) => {
      const h = shareIn(s.re, a, b, win, 'linear');
      if (!h) return;
      if (s.assignee?.id) add(personPlan, s.assignee.id, w, h);
      const tid = s.team?.id || '_none';
      add(teamPlan, tid, w, h);
      const tp = teamProject.get(tid) || teamProject.set(tid, new Map()).get(tid);
      tp.set(s.rootRef, (tp.get(s.rootRef) || 0) + h);
      const pt = projectTeam.get(s.rootRef) || projectTeam.set(s.rootRef, new Map()).get(s.rootRef);
      pt.set(tid, (pt.get(tid) || 0) + h);
    });
  }
  const personCap = new Map(), teamCap = new Map();
  for (const p of people.values()) {
    const supW = support?.personWeekly?.[p.id] || 0;
    const caps = weeks.map(([a, b]) => personCapacityIn(model, p, a, b, supW));
    personCap.set(p.id, caps);
    // team capacity: the person's capacity × their share in each of their teams
    for (const { teamId, pct } of allocationOf(p)) { const t = teamCap.get(teamId) || teamCap.set(teamId, new Array(nWeeks).fill(0)).get(teamId); caps.forEach((c, i) => { t[i] += (c * pct) / 100; }); }
  }
  // Unnamed team capacity: weekly hours × working-day share, minus daily business and internal work (no person-specific holidays).
  for (const [tid, st] of Object.entries(model.ds.capacity?.teams || {})) {
    const extra = +st.extraWeeklyHours || 0;
    if (!extra) continue;
    const t = teamCap.get(tid) || teamCap.set(tid, new Array(nWeeks).fill(0)).get(tid);
    weeks.forEach(([a, b], i) => { t[i] += (extra * workdays(a, b)) / 5 * projectShare(teamSettings(model, tid)); });
  }
  const teamIds = [...new Set([...teamPlan.keys(), ...teamCap.keys()])].filter((t) => isTeamShown(model, t));
  const teamsOut = teamIds.map((t) => {
    const plan = teamPlan.get(t) || new Array(nWeeks).fill(0), cap = teamCap.get(t) || new Array(nWeeks).fill(0);
    const members = [...people.values()].filter((p) => inTeam(p, t)).map((p) => {
      const pl = personPlan.get(p.id) || new Array(nWeeks).fill(0), c = personCap.get(p.id);
      // plan, cap and util stay the person's own (across all teams); pct = their share in this team
      return { id: p.id, derived: p.derived, pct: Math.round(shareOf(p, t) * 100), plan: pl, cap: c, util: pl.map((h, i) => (c[i] > 0 ? h / c[i] : h > 0 ? Infinity : 0)) };
    });
    return {
      teamId: t, plan, cap, util: plan.map((h, i) => (cap[i] > 0 ? h / cap[i] : h > 0 ? Infinity : 0)), members,
      byProject: [...(teamProject.get(t) || new Map()).entries()].map(([ref, h]) => ({ ref, hours: h })).sort((a, b) => b.hours - a.hours),
      planTotal: sum(plan, (x) => x), capTotal: sum(cap, (x) => x),
    };
  });
  const totalCap = sum(teamsOut, (t) => t.capTotal);
  const projects = [...projectTeam.entries()].map(([ref, m]) => {
    const total = sum([...m.values()], (x) => x);
    return { ref, total, share: totalCap > 0 ? total / totalCap : 0, teams: [...m.entries()].map(([teamId, hours]) => ({ teamId, hours })).sort((a, b) => b.hours - a.hours) };
  }).sort((a, b) => (model.itemByRef.get(a.ref)?.rank ?? 1e9) - (model.itemByRef.get(b.ref)?.rank ?? 1e9));
  return { weeks: weeks.map(([a, b]) => ({ from: isoOf(a), to: isoOf(b) })), teams: teamsOut, projects, totalCap };
}

// ---------- estimate vs time spent (UC-04) ----------
export function resolvePeriod(kind, today, from, to) {
  const t = typeof today === 'number' ? today : dayIdx(today);
  if (kind === 'month') { const d = new Date(t * 864e5); const a = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 864e5); const b = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 864e5) - 1; return { a, b, valid: true }; }
  if (kind === 'quarter') { const [a, b] = quarterRange(quarterKeyOf(t)); return { a, b, valid: true }; }
  if (kind === 'last4') { const a = mondayOf(t) - 28; return { a, b: mondayOf(t) - 1, valid: true }; }
  const a = dayIdx(from), b = dayIdx(to);
  if (a == null || b == null || b < a) return { a, b, valid: false };
  return { a, b, valid: true, workdays: workdays(a, b) };
}
export function estimateVsSpent(model, a, b) {
  const rule = model.rule;
  const teams = new Map(), persons = new Map();
  const ensure = (map, k) => map.get(k) || map.set(k, { id: k, est: 0, logged: 0, byProject: new Map() }).get(k);
  for (const i of model.ds.issues || []) {
    const storyTeam = i.role === 'estimate' ? i.team : ancestor(model, i, 'estimate')?.team || i.team;
    if (i.role === 'estimate' && i.oe) {
      const w = spreadWindow(i, 'oe', model.today);
      const h = w ? shareIn(i.oe, a, b, w, rule) : 0;
      if (h) {
        const t = ensure(teams, i.team?.id || '_none'); t.est += h;
        t.byProject.set(i.rootRef, { est: (t.byProject.get(i.rootRef)?.est || 0) + h, logged: t.byProject.get(i.rootRef)?.logged || 0 });
        if (i.assignee?.id) ensure(persons, i.assignee.id).est += h;
      }
    }
    for (const wl of i.worklogs || []) {
      const d = dayIdx(wl.d);
      if (d == null || d < a || d > b) continue;
      const t = ensure(teams, storyTeam?.id || '_none'); t.logged += wl.h;
      const bp = t.byProject.get(i.rootRef) || { est: 0, logged: 0 }; bp.logged += wl.h; t.byProject.set(i.rootRef, bp);
      if (wl.a) ensure(persons, wl.a).logged += wl.h;
    }
  }
  const fin = (r) => ({
    id: r.id, est: round1(r.est), logged: round1(r.logged), dev: round1(r.logged - r.est),
    devPct: r.est > 0 ? (r.logged - r.est) / r.est : r.logged > 0 ? Infinity : 0,
    byProject: [...r.byProject.entries()].map(([ref, v]) => ({ ref, est: round1(v.est), logged: round1(v.logged) })).sort((x, y) => y.logged - x.logged),
  });
  const T = [...teams.values()].map(fin).sort((x, y) => y.logged + y.est - (x.logged + x.est));
  const P = [...persons.values()].map(fin).sort((x, y) => y.logged + y.est - (x.logged + x.est));
  const est = sum(T, (x) => x.est), logged = sum(T, (x) => x.logged);
  const undated = (model.ds.issues || []).filter((i) => i.role === 'estimate' && i.oe > 0 && !i.start && !i.due).length; // D14
  return { teams: T, persons: P, est, logged, dev: logged - est, devPct: est > 0 ? (logged - est) / est : 0, workdays: workdays(a, b), undated };
}

// ---------- dependencies (UC-03) ----------
export function dependencies(model, refs) {
  const types = new Set((model.cfg.dependencies?.linkTypeIds || []).map(String));
  const reversed = new Set((model.cfg.dependencies?.reversedLinkTypeIds || []).map(String));
  const inScope = (i) => i && (!refs || refs.has(i.rootRef));
  const seen = new Set(), out = [];
  const get = (id) => model.byId.get(id) || model.external.get(id);
  for (const i of model.ds.issues || []) {
    for (const l of i.links || []) {
      if (!types.has(String(l.typeId)) || seen.has(l.id)) continue;
      const other = get(l.otherId);
      if (!other) continue;
      const fwd = reversed.has(String(l.typeId)) ? !l.outward : l.outward; // D16: admins can flip a link type's direction
      const pre = fwd ? i : other, dep = fwd ? other : i;
      if (!inScope(pre) && !inScope(dep)) continue;
      seen.add(l.id);
      const open = isOpen(pre) && isOpen(dep);
      const pd = dayIdx(pre.due), ds_ = dayIdx(dep.start);
      const conflict = open && pd != null && ds_ != null && pd > ds_;
      const note = dep.note || pre.note || null;
      out.push({
        id: l.id, typeId: l.typeId, relation: (reversed.has(String(l.typeId)) ? l.inverse : l.verb) || l.verb || 'blocks', pre: pre.id, dep: dep.id, open, conflict,
        conflictDays: conflict ? pd - ds_ : 0, note, missingNote: open && !note,
      });
    }
  }
  // Stories and sub-tasks in the Blocked status: since when (last change to Blocked, from the Jira history),
  // the reason (latest comment) and what they wait for / hold up – only via the configured link types.
  const blocked = [];
  for (const i of model.ds.issues || []) {
    if ((i.role !== 'estimate' && i.role !== 'tiny') || !isOpen(i) || !inScope(i) || !model.isBlocked(i)) continue;
    const since = i.blockedSince || null;
    blocked.push({
      id: i.id, since, days: since && dayIdx(since) != null ? Math.max(0, model.today - dayIdx(since)) : null, reason: i.blockedReason || null,
      waitsOn: out.filter((d) => d.dep === i.id).map((d) => d.pre), blocks: out.filter((d) => d.pre === i.id).map((d) => d.dep),
    });
  }
  blocked.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  return {
    blocked,
    list: out.sort((a, b) => (b.conflict - a.conflict) || (b.open - a.open) || (b.conflictDays - a.conflictDays)),
    open: out.filter((d) => d.open).length, conflicts: out.filter((d) => d.conflict).length,
    missingNotes: out.filter((d) => d.missingNote).length,
    issueIds: new Set(out.filter((d) => d.open).flatMap((d) => [d.pre, d.dep])),
  };
}

// ---------- data quality (UC-13) ----------
const FIXABLE = new Set(['team', 'originalEstimate', 'tshirt', 'startDate', 'dueDate', 'targetQuarters']);
function missing(model, issue, usage) {
  switch (usage) {
    case 'team': return !issue.team;
    case 'assignee': return !issue.assignee;
    case 'owner': return !issue.owner;
    case 'originalEstimate': return !(issue.oe > 0);
    case 'startDate': return !issue.start;
    case 'dueDate': return !issue.due;
    case 'tshirt': return !issue.tshirt || !model.sizes.has(String(issue.tshirt).toUpperCase());
    case 'targetQuarters': return !(issue.quarters || []).length;
    case 'milestone': return model.msField ? !issue.milestone : model.milestoneOfVersion.size ? !milestoneOf(model, issue) : !(issue.fixVersionIds || []).length;
    case 'parent': return !issue.parentId;
    default: return false;
  }
}
export function responsibleFor(model, issue) {
  const named = (u) => u && !u.anon;
  if (named(issue.assignee)) return issue.assignee;
  let cur = issue.parentId ? model.byId.get(issue.parentId) : null;
  while (cur) { if (named(cur.assignee)) return cur.assignee; cur = cur.parentId ? model.byId.get(cur.parentId) : null; }
  return model.itemByRef.get(issue.rootRef)?.owner || null;
}
export function dataQuality(model, refs) {
  const matrix = model.cfg.matrix || DEFAULT_MATRIX;
  // the required usages of a matrix row, in the row's order (read once per row instead of once per work item)
  const req = new Map();
  const requiredOf = (m) => req.get(m) || req.set(m, Object.entries(m).filter(([u, mode]) => mode === 'required' && u !== 'owner').map(([u]) => u)).get(m);
  const today = model.today, soon = today + 28;
  const gaps = [];
  const perLevel = new Map();
  const urgentOf = (i) => [dayIdx(i.start), dayIdx(i.due)].some((d) => d != null && d >= today && d <= soon);
  const push = (i, rule, field, severity = 'gap', extra = {}) => gaps.push({
    id: `${i.id}:${rule}`, issueId: i.id, key: i.key, summary: i.summary, levelKey: i.levelKey, role: i.role, rule, field,
    severity, urgent: severity === 'gap' && urgentOf(i), responsible: responsibleFor(model, i), rootRef: i.rootRef,
    fixable: !!field && FIXABLE.has(field) && severity === 'gap', ...extra,
  });
  // Portfolio items themselves
  for (const p of model.items) {
    if (refs && !refs.has(p.ref)) continue;
    const m = matrix.portfolio || {};
    const pseudo = { id: `item:${p.ref}`, key: p.key, summary: p.name, levelKey: 'portfolio', role: 'portfolio', rootRef: p.ref, owner: p.owner, due: p.due, tshirt: p.tshirt, quarters: p.quarters, team: p.leadTeam, assignee: p.owner };
    let complete = true;
    // the item carries the rough estimate itself when nothing below it does (e.g. epics as portfolio items)
    const itemIsRough = roughUnits(model, p)[0]?.isItem;
    for (const u of ['owner', 'dueDate', ...(itemIsRough ? ['tshirt', 'targetQuarters', 'team'] : [])]) {
      if (m[u] === 'required' && missing(model, pseudo, u)) { complete = false; push(pseudo, `missing:${u}`, u, 'gap', { isItem: true }); }
    }
    const lv = perLevel.get('portfolio') || perLevel.set('portfolio', { total: 0, complete: 0 }).get('portfolio');
    lv.total++; if (complete) lv.complete++;
  }
  // one project: its work items in dataset order (model.byRoot) instead of a scan over all of them
  const scope = refs && refs.size === 1 ? model.byRoot.get([...refs][0]) || [] : model.ds.issues || [];
  for (const i of scope) {
    if (refs && !refs.has(i.rootRef)) continue;
    const m = matrix[i.levelKey] || matrix[i.role] || {};
    let complete = true;
    const open = isOpen(i);
    for (const u of requiredOf(m)) {
      if (!open && u !== 'originalEstimate') continue; // closed items only matter for estimates
      if (missing(model, i, u)) { complete = false; push(i, `missing:${u}`, u); }
    }
    if (open) {
      const due = dayIdx(i.due);
      const ms = i.role === 'estimate' ? milestoneOf(model, i) : null;
      if (ms && due != null && due > dayIdx(ms.date)) { complete = false; push(i, 'dueAfterMilestone', 'dueDate', 'gap', { milestone: ms.name }); }
      // start after the due date (tester 2026-11-17: PCX-36 start 28.12., due 15.12. was planned anyway): a data error –
      // the plan books every hour into the due week until someone fixes the dates
      const st0 = dayIdx(i.start);
      if (st0 != null && due != null && st0 > due) { complete = false; push(i, 'datesInverted', 'dueDate', 'gap', { start: i.start, due: i.due }); }
      if (model.cfg.rules?.dueDateWarning !== false && due != null && due < today) push(i, 'overdue', 'dueDate', 'gap', { days: today - due });
      const par = i.parentId ? model.byId.get(i.parentId) : null;
      if (par && par.role === 'structure' && (par.start || par.due)) {
        const ps = dayIdx(par.start), pe = dayIdx(par.due), s = dayIdx(i.start);
        if ((ps != null && s != null && s < ps) || (pe != null && due != null && due > pe)) push(i, 'outsideParent', 'dueDate', 'gap');
      }
      if (i.role === 'rough' && (i.quarters || []).length > 2) push(i, 'roughTooLong', null, 'hint');
    }
    const lk = i.levelKey || i.role;
    const lv = perLevel.get(lk) || perLevel.set(lk, { total: 0, complete: 0 }).get(lk);
    lv.total++; if (complete) lv.complete++;
  }
  const rules = new Map();
  for (const g of gaps) {
    const r = rules.get(g.rule) || rules.set(g.rule, { rule: g.rule, severity: g.severity, count: 0, urgent: 0 }).get(g.rule);
    r.count++; if (g.urgent) r.urgent++;
  }
  const stories = scope.filter((i) => i.role === 'estimate' && (!refs || refs.has(i.rootRef)));
  return {
    gaps: gaps.sort((a, b) => (b.urgent - a.urgent) || (a.severity === 'hint') - (b.severity === 'hint')),
    rules: [...rules.values()].sort((a, b) => b.urgent - a.urgent || b.count - a.count),
    levels: [...perLevel.entries()].map(([k, v]) => ({ levelKey: k, ...v, pct: v.total ? v.complete / v.total : 1 })),
    basis: { stories: stories.length, estimated: stories.filter((s) => s.oe > 0).length, scheduled: stories.filter((s) => s.start && s.due).length, teamed: stories.filter((s) => s.team).length },
    score: (() => { const t = sum([...perLevel.values()], (v) => v.total), c = sum([...perLevel.values()], (v) => v.complete); return t ? c / t : 1; })(),
  };
}

// ---------- milestones (UC-15) ----------
export function milestoneStatus(model) {
  if (model.msField) {
    // Custom-field milestones: stories are grouped by the milestone their field points to.
    const groups = new Map((model.ds.milestones || []).map((m) => [m, []]));
    for (const s of model.ds.issues || []) {
      if (s.role !== 'estimate') continue;
      const m = milestoneOf(model, s);
      if (m) (groups.get(m) || groups.set(m, []).get(m)).push(s);
    }
    return [...groups].map(([m, stories]) => {
      const late = stories.filter((s) => isOpen(s) && s.due && s.due > m.date);
      return { ...m, versions: [], atRisk: late.length > 0, stories: stories.map((s) => s.id), late: late.map((s) => s.id), spaces: [...new Set(stories.map((s) => s.projectKey).filter(Boolean))] };
    }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }
  // one pass over the issues: fix version → positions of its stories (was one full scan per milestone)
  const issues = model.ds.issues || [];
  const byVersion = new Map();
  issues.forEach((i, k) => {
    if (i.role !== 'estimate') return;
    for (const v of i.fixVersionIds || []) { const key = String(v); (byVersion.get(key) || byVersion.set(key, []).get(key)).push(k); }
  });
  return (model.ds.milestones || []).map((m) => {
    const vs = (m.fixVersionIds || []).map((id) => model.versions[id] || { id, name: `#${id}`, releaseDate: null });
    const atRisk = vs.some((v) => !v.releaseDate || v.releaseDate > m.date);
    const set = new Set((m.fixVersionIds || []).map(String));
    // the same stories in the same (dataset) order as a filter over all issues
    const at = new Set();
    for (const v of set) for (const k of byVersion.get(v) || []) at.add(k);
    const stories = [...at].sort((a, b) => a - b).map((k) => issues[k]);
    const late = stories.filter((s) => isOpen(s) && s.due && s.due > m.date);
    return { ...m, versions: vs, atRisk: atRisk || late.length > 0, stories: stories.map((s) => s.id), late: late.map((s) => s.id), spaces: [...new Set(vs.map((v) => v.projectKey).filter(Boolean))] };
  });
}

// ---------- support (UC-17) ----------
// A manual support reserve ("Reicht die Reserve?" › "Auf X h übernehmen"): capacity.teams[teamId].supportOverride
// (h/week, null = automatic) replaces the measured reserve of that team for every consumer – waterline (reserveQuarter),
// weekly views (personWeekly: the team's people scaled to the override) and the report (weeklyTotal).
// Pure and idempotent: the measured values stay in `auto`, so applying it twice gives the same result.
export function withSupportOverrides(support, capacity) {
  if (!support) return support;
  const base = support.auto || { teams: support.teams || [], personWeekly: support.personWeekly || {}, reserveQuarter: support.reserveQuarter || {}, weeklyTotal: support.weeklyTotal || 0 };
  const ov = new Map(Object.entries(capacity?.teams || {})
    .filter(([, t]) => t && t.supportOverride != null && t.supportOverride !== '' && Number.isFinite(+t.supportOverride) && +t.supportOverride >= 0)
    .map(([id, t]) => [id, +t.supportOverride]));
  if (!ov.size) return support.auto ? { ...support, ...base, overrides: {}, auto: undefined } : support;
  const teams = base.teams.map((t) => (ov.has(t.teamId) ? { ...t, autoWeekly: t.weekly, override: ov.get(t.teamId), weekly: ov.get(t.teamId) } : t));
  for (const [id, h] of ov) if (!teams.some((t) => t.teamId === id)) teams.push({ teamId: id, win: 0, recent: 0, trend: new Array(8).fill(0), avg: 0, recentAvg: 0, spike: false, weekly: h, autoWeekly: 0, override: h });
  const reserveQuarter = { ...base.reserveQuarter };
  const personWeekly = { ...base.personWeekly };
  const people = Object.entries(capacity?.people || {});
  const known = Object.keys(base.personWeekly).length > 0; // empty = not shown to this caller (scopeSupport): keep it empty
  // A person split across teams (UC-14) carries each team's override by their share there: their measured hours
  // count for a team × share, the team's part is scaled to the override, the parts of other teams stay measured.
  // One team at 100 % gives exactly the old result (measured × override ÷ team measured, or override ÷ members).
  const parts = new Map(); // person → { keep: share not overridden, add: overridden hours }
  for (const [id, h] of ov) {
    reserveQuarter[id] = h * 12;
    if (!known) continue;
    const members = people.map(([pid, p]) => [pid, shareOf(p, id)]).filter(([, s]) => s > 0);
    const measured = sum(members, ([pid, s]) => (base.personWeekly[pid] || 0) * s);
    const shares = sum(members, ([, s]) => s);
    for (const [pid, s] of members) {
      const x = parts.get(pid) || parts.set(pid, { keep: 1, add: 0 }).get(pid);
      x.keep -= s;
      x.add += measured > 0 ? ((base.personWeekly[pid] || 0) * s * h) / measured : (h * s) / shares;
    }
  }
  for (const [pid, x] of parts) personWeekly[pid] = (base.personWeekly[pid] || 0) * Math.max(0, x.keep) + x.add;
  return { ...support, teams, reserveQuarter, personWeekly, weeklyTotal: sum(teams, (t) => t.weekly), overrides: Object.fromEntries(ov), auto: base };
}
export function supportMetrics(sup, todayIso, capacity = null) {
  if (!sup || !(sup.services || []).length) return null;
  const today = dayIdx(todayIso);
  const W = sup.averagingWeeks === 8 ? 8 : 4;
  const winStart = mondayOf(today) - W * 7, winEnd = mondayOf(today) - 1, recentStart = mondayOf(today) - 14;
  const trendWeeks = Array.from({ length: 8 }, (_, k) => mondayOf(today) - (8 - k) * 7);
  const team = new Map(), person = new Map(), service = new Map();
  const T = (k) => team.get(k) || team.set(k, { teamId: k, win: 0, recent: 0, trend: new Array(8).fill(0) }).get(k);
  for (const s of sup.services) service.set(s.id, { ...s, met: 0, breached: 0, open: 0, openRe: 0, hours: 0, teamMap: new Map() });
  for (const t of sup.tickets || []) {
    const sv = service.get(t.serviceId);
    if (sv) {
      sv.met += t.sla?.met || 0; sv.breached += t.sla?.breached || 0;
      if (t.statusCat !== 'done') { sv.open++; sv.openRe += t.re || 0; }
    }
    for (const wl of t.worklogs || []) {
      const d = dayIdx(wl.d);
      if (d == null) continue;
      const tm = T(t.team?.id || '_none');
      const st = sv ? (sv.teamMap.get(tm.teamId) || sv.teamMap.set(tm.teamId, { teamId: tm.teamId, win: 0, recent: 0 }).get(tm.teamId)) : null;
      if (d >= winStart && d <= winEnd) { tm.win += wl.h; if (sv) { sv.hours += wl.h; st.win += wl.h; } if (wl.a) person.set(wl.a, (person.get(wl.a) || 0) + wl.h); }
      if (d >= recentStart && d <= winEnd) { tm.recent += wl.h; if (st) st.recent += wl.h; }
      const k = trendWeeks.findIndex((m) => d >= m && d < m + 7);
      if (k >= 0) tm.trend[k] += wl.h;
    }
  }
  const reserveQuarter = {}, teamsOut = [];
  for (const tm of team.values()) {
    const avg = tm.win / W, recent = tm.recent / 2;
    const spike = avg > 0 && recent > avg * 1.2;
    const weekly = spike ? recent : avg;
    reserveQuarter[tm.teamId] = weekly * 12;
    teamsOut.push({ ...tm, avg, recentAvg: recent, spike, weekly });
  }
  const personWeekly = Object.fromEntries([...person.entries()].map(([k, h]) => [k, h / W]));
  // Per service space: Ø weekly time spent per team, rising teams (last 2 weeks > 1.2 × Ø) and the SLA health.
  const target0 = (sup.slaTargetPct ?? 95) / 100;
  for (const sv of service.values()) {
    sv.teams = [...sv.teamMap.values()].map((x) => {
      const avg = x.win / W, recent = x.recent / 2, spike = avg > 0 && recent > avg * 1.2;
      return { teamId: x.teamId, avg, recentAvg: recent, spike, weekly: spike ? recent : avg };
    }).filter((x) => x.avg > 0 || x.recentAvg > 0);
    delete sv.teamMap;
    sv.avgWeekly = sum(sv.teams, (x) => x.avg);
    sv.weekly = sum(sv.teams, (x) => x.weekly);
    sv.rising = sv.teams.filter((x) => x.spike).map((x) => x.teamId);
    sv.slaRate = sv.met + sv.breached > 0 ? sv.met / (sv.met + sv.breached) : null;
    sv.health = sv.slaRate == null ? null : sv.slaRate >= target0 ? 'onTrack' : sv.slaRate >= target0 - 0.05 ? 'atRisk' : 'critical';
  }
  const met = sum([...service.values()], (s) => s.met), breached = sum([...service.values()], (s) => s.breached);
  const target = (sup.slaTargetPct ?? 95) / 100;
  const rate = met + breached > 0 ? met / (met + breached) : null;
  const health = rate == null ? null : rate >= target ? 'onTrack' : rate >= target - 0.05 ? 'atRisk' : 'critical';
  return withSupportOverrides({
    averagingWeeks: W, services: [...service.values()], teams: teamsOut, reserveQuarter, personWeekly,
    slaRate: rate, slaTarget: target, breaches: breached, health,
    open: sum([...service.values()], (s) => s.open), openRe: sum([...service.values()], (s) => s.openRe),
    hoursWindow: sum(teamsOut, (t) => t.win), weeklyTotal: sum(teamsOut, (t) => t.weekly),
  }, capacity);
}

// ---------- action list (UC-01) ----------
// capacityPeople once per model for readers that never change it (capacityPeople itself returns a fresh Map per call)
const peopleRO = new WeakMap();
const peopleReadOnly = (model) => peopleRO.get(model) || peopleRO.set(model, capacityPeople(model)).get(model);
const absIx = new WeakMap();
function absencesByPerson(abs) {
  let m = absIx.get(abs);
  if (m && m.n === abs.length) return m.map;
  const map = new Map();
  for (const a of abs) (map.get(a.accountId) || map.set(a.accountId, []).get(a.accountId)).push({ a, from: dayIdx(a.from), to: dayIdx(a.to) });
  absIx.set(abs, { n: abs.length, map });
  return map;
}
export function actionItems(model, item, metrics, wl, deps, dq) {
  const out = [];
  const today = model.today;
  for (const id of metrics.overdueIssues) {
    const i = model.byId.get(id);
    out.push({ kind: 'overdue', issueId: id, key: i.key, summary: i.summary, days: today - dayIdx(i.due), responsible: responsibleFor(model, i), score: 100 + Math.min(60, today - dayIdx(i.due)) });
  }
  // start after due: a data error the plan cannot honour – first in the list, it falsifies every week of the plan
  for (const s of model.byRoot.get(item.ref) || []) {
    if (!isOpen(s) || !s.start || !s.due) continue;
    const a = dayIdx(s.start), b = dayIdx(s.due);
    if (a != null && b != null && a > b) out.push({ kind: 'dates', issueId: s.id, key: s.key, summary: s.summary, start: s.start, due: s.due, days: a - b, responsible: s.assignee || responsibleFor(model, s), score: 110 });
  }
  for (const d of deps.list) {
    if (!d.conflict) continue;
    const pre = model.byId.get(d.pre) || model.external.get(d.pre), dep = model.byId.get(d.dep) || model.external.get(d.dep);
    if (pre?.rootRef !== item.ref && dep?.rootRef !== item.ref) continue;
    out.push({ kind: 'conflict', issueId: dep.id, key: dep.key, summary: dep.summary, other: pre.key, days: d.conflictDays, responsible: dep.assignee || responsibleFor(model, dep), score: 85 + Math.min(10, d.conflictDays) });
  }
  // work items without a parent (boss 2026-11-19): they belong to this project (its space has only this project) but
  // hang outside its hierarchy – and ones in a shared space whose project is unclear, listed in every candidate
  for (const s of model.byRoot.get(item.ref) || []) {
    if (!s.orphan || !isOpen(s)) continue;
    out.push({ kind: 'noParent', issueId: s.id, key: s.key, summary: s.summary, role: s.role, levelKey: s.levelKey, responsible: s.assignee || responsibleFor(model, s), score: 60 });
  }
  for (const o of model.ds?.orphans || []) {
    if (!(o.candidates || []).includes(item.ref) || o.status?.cat === 'done') continue;
    out.push({ kind: 'noParent', unclear: true, issueId: o.id, key: o.key, summary: o.summary, role: o.role, levelKey: o.levelKey, projectKey: o.projectKey, candidates: o.candidates, spaceProjects: o.spaceProjects || o.candidates.length, responsible: o.assignee || item.owner, score: 58 });
  }
  const pq = wl?.projectQ?.[item.ref] || {};
  for (const [q, v] of Object.entries(pq)) {
    for (const t of v.teams) {
      if (t.status === 'ok') continue;
      const team = model.teams.get(t.teamId);
      out.push({ kind: 'capacity', q, teamId: t.teamId, teamName: team?.name || '—', missing: t.demand - t.staffed, status: t.status, responsible: item.owner, score: q === model.curQ ? 75 : 55 - wl.quarters.indexOf(q) * 5 });
    }
  }
  for (const g of dq.gaps) {
    if (g.rootRef !== item.ref || g.severity !== 'gap' || g.rule === 'overdue') continue;
    out.push({ kind: 'gap', issueId: g.isItem ? null : g.issueId, key: g.key, summary: g.summary, rule: g.rule, field: g.field, responsible: g.responsible, urgent: g.urgent, score: g.urgent ? 65 : 30 });
  }
  // Absent assignees during open stories, with a suggested substitute from the same team
  const abs = model.ds.capacity?.absences || [];
  if (abs.length) {
    const people = peopleReadOnly(model);
    const horizon = today + 56;
    // absences per person, in list order, with their day indices (the Projects view asks this for every project)
    const byPerson = absencesByPerson(abs);
    const absentIn = (id, a0, b0) => (byPerson.get(id) || []).find((x) => x.from <= a0 && x.to >= b0)?.a;
    for (const s of model.byRoot.get(item.ref) || []) {
      if (s.role !== 'estimate' || !isOpen(s) || !s.assignee?.id) continue;
      const w = spreadWindow(s, 're', today);
      if (!w) continue;
      const hit = absentIn(s.assignee.id, Math.min(w[1], horizon), w[0]);
      if (!hit) continue;
      const teamId = people.get(s.assignee.id)?.teamId;
      // the first colleague in the same team who is not away then (the substitute)
      let substitute = null;
      for (const p of people.values()) if (inTeam(p, teamId) && p.id !== s.assignee.id && !absentIn(p.id, w[1], w[0])) { substitute = p; break; }
      out.push({ kind: 'absence', issueId: s.id, key: s.key, summary: s.summary, person: s.assignee, from: hit.from, to: hit.to, substitute: substitute?.id || null, responsible: item.owner, score: 70 });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

// ---------- everything at once ----------
// Ticket-level support analytics (JSM SLA data where it exists, the app's targets otherwise).
export function supportTicketAnalytics(ds, model) {
  const tickets = ds?.supportTickets?.tickets;
  if (!tickets) return null;
  const sup = ds.config?.support || {};
  const rootOf = (id) => model.byId.get(id)?.rootRef || (model.itemByRef.has(`issue:${id}`) ? `issue:${id}` : null);
  return supportAnalytics(tickets, { cal: sup.sla || undefined, target: (sup.slaTargetPct ?? 95) / 100, rootOf });
}
// The headline support numbers. With tickets loaded they come from the tickets; otherwise from JSM's SLA fields.
export function supportSummary(support, a) {
  if (!support && !a) return null;
  if (a) {
    const k = a.kpis;
    const health = k.slaRate == null ? null : k.slaRate >= k.target ? 'onTrack' : k.slaRate >= k.target - 0.05 ? 'atRisk' : 'critical';
    return { source: 'tickets', open: k.open, breachedOpen: k.breachedOpen, atRisk: k.atRisk, urgent: k.breachedOpen + k.atRisk, slaRate: k.slaRate, target: k.target, health, met: k.met, breached: k.breached };
  }
  return { source: 'jsm', open: support.open, breachedOpen: null, atRisk: null, urgent: null, slaRate: support.slaRate, target: support.slaTarget, health: support.health, met: null, breached: support.breaches };
}

export function computeAll(ds, opts = {}) {
  const model = buildModel(ds);
  const support = withSupportOverrides(ds.supportComputed ?? supportMetrics(ds.support, ds.today), ds.capacity); // manual reserves (UC-17)
  const metrics = new Map(model.items.map((p) => [p.ref, projectMetrics(model, p)]));
  const wl = waterline(model, metrics, support);
  const deps = dependencies(model, null);
  const dq = dataQuality(model, null);
  const weeks = opts.skipWeeks ? null : weeksUtilization(model, support);
  const supportA = supportTicketAnalytics(ds, model);
  return { model, support, supportA, supportSum: supportSummary(support, supportA), metrics, wl, deps, dq, weeks, milestones: milestoneStatus(model) };
}

// ---------- C-level report (UC-06) ----------
export function cLevelReport(ds) {
  const { model, support, supportSum, metrics, wl, deps, weeks, dq, milestones } = computeAll(ds);
  const today = model.today;
  const active = model.items.filter((p) => !metrics.get(p.ref).done);
  const rows = active.map((p) => {
    const m = metrics.get(p.ref);
    const openDeps = deps.list.filter((d) => d.open && [d.pre, d.dep].some((id) => (model.byId.get(id) || model.external.get(id))?.rootRef === p.ref)).length;
    const conflicts = deps.list.filter((d) => d.conflict && [d.pre, d.dep].some((id) => model.byId.get(id)?.rootRef === p.ref)).length;
    const pq = wl.projectQ[p.ref] || {};
    const schedule = m.daysOverdue > 0 ? 'late' : conflicts > 0 || Object.values(pq).some((v) => v.status !== 'ok') ? 'atRisk' : 'onTrack';
    return { healthComment: p.health?.comment || null, healthAt: p.health?.at || null, tshirt: p.tshirt || null, quarters: p.quarters || [], team: p.leadTeam?.name || null, start: p.start || null,
      waterline: Object.fromEntries(wl.quarters.map((q) => [q, pq[q]?.status || 'ok'])), storyCount: m.storyCount, RE: m.RE, openTshirt: m.openTshirt,
      ref: p.ref, rank: p.rank, key: p.key, name: p.name, owner: p.owner?.name || null, health: p.health?.status || null, progress: m.progress, due: m.due, daysOverdue: m.daysOverdue, overdueCount: m.overdueCount, openDeps, conflicts, schedule, maturity: m.maturity, forecast: m.forecast, OE: m.OE, TS: m.TS };
  });
  const TS = sum(active, (p) => metrics.get(p.ref).TS), RE = sum(active, (p) => metrics.get(p.ref).RE), OT = sum(active, (p) => metrics.get(p.ref).openTshirt);
  const nextQ = wl.quarters[1];
  const teamUtil = weeks.teams.filter((t) => t.teamId !== '_none' && t.capTotal > 0).map((t) => ({ teamId: t.teamId, name: model.teams.get(t.teamId)?.name || t.teamId, util: t.planTotal / t.capTotal }));
  return {
    asOf: new Date().toISOString(), today: isoOf(today),
    kpis: {
      activeProjects: active.length, progress: TS + RE + OT > 0 ? TS / (TS + RE + OT) : 0,
      projectsOverdue: rows.filter((r) => r.daysOverdue > 0).length, issuesOverdue: sum(rows, (r) => r.overdueCount),
      // D19: capacity-weighted (total planned ÷ total capacity), so a tiny team cannot skew the headline.
      avgUtil: (() => { const ts = weeks.teams.filter((t) => t.teamId !== '_none' && t.capTotal > 0); const c = sum(ts, (t) => t.capTotal); return c > 0 ? sum(ts, (t) => t.planTotal) / c : 0; })(), teamsOver100: teamUtil.filter((t) => t.util > 1).length,
      slaRate: supportSum?.slaRate ?? null, supportShare: support && weeks.totalCap > 0 ? (support.weeklyTotal * 8) / (weeks.totalCap + support.weeklyTotal * 8) : null,
    },
    rows, teamUtil, quarters: wl.quarters,
    // Weekly utilisation per team (next 8 weeks) for the heatmap.
    weeks: weeks.weeks.map((w) => w.from),
    teamWeeks: weeks.teams.filter((t) => t.teamId !== '_none' && (t.capTotal > 0 || t.planTotal > 0)).map((t) => ({ name: model.teams.get(t.teamId)?.name || t.teamId, util: t.util.map((u) => (Number.isFinite(u) ? u : null)), plan: t.planTotal, cap: t.capTotal })),
    // Open date conflicts: project names and work-item keys only (the report covers all projects).
    conflicts: deps.list.filter((d) => d.conflict).slice(0, 25).map((d) => {
      const pre = model.byId.get(d.pre) || model.external.get(d.pre) || {}, dep = model.byId.get(d.dep) || {};
      return { preKey: pre.key || null, preProject: model.itemByRef.get(pre.rootRef)?.name || null, depKey: dep.key || null, depProject: model.itemByRef.get(dep.rootRef)?.name || null, days: d.conflictDays };
    }),
    milestones: (milestones || []).map((m) => ({ name: m.name, date: m.date, atRisk: m.atRisk, stories: m.stories.length, late: m.late.length })),
    dataQuality: { score: dq.score, urgent: dq.gaps.filter((g) => g.urgent).length, gaps: dq.gaps.length, rules: dq.rules.filter((r) => r.severity !== 'hint').slice(0, 6).map((r) => ({ rule: r.rule, count: r.count, urgent: r.urgent })) },
    support: supportSum ? { slaRate: supportSum.slaRate ?? null, breaches: supportSum.breachedOpen ?? supportSum.breached ?? null, open: supportSum.open ?? null, weeklyTotal: support?.weeklyTotal ?? null, target: supportSum.target ?? null } : null,
    healthCounts: { onTrack: active.filter((p) => p.health?.status === 'onTrack').length, atRisk: active.filter((p) => p.health?.status === 'atRisk').length, critical: active.filter((p) => p.health?.status === 'critical').length, none: active.filter((p) => !p.health).length },
    waterlineNextQ: { quarter: nextQ, teams: wl.teamIds.filter((t) => t !== '_none' && wl.cells[t]?.[nextQ]).map((t) => { const c = wl.cells[t][nextQ]; return { teamId: t, name: model.teams.get(t)?.name || t, util: c.util === Infinity ? null : c.util, waterRank: c.waterRank, capacity: c.capacity, demand: c.demand }; }) },
  };
}
