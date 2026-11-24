// Golden set – the EXPECTED facts, computed independently of Lotse: straight from the dataset and the engine's primitives
// (computeAll metrics / waterline cells, insights.realisticCapacity, engine.dataQuality). Nothing here calls a Lotse skill,
// so a passing fact check is a real cross-check "what Lotse says" vs. "what the data says".
import { computeAll, dataQuality, capacityPeople, quarterCapacityParts } from '../../shared/engine.js';
import { realisticCapacity } from '../../shared/insights.js';
import { dayIdx, isoOf } from '../../shared/dates.js';

const EPS = 1e-6;
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + (f(x) || 0), 0);
// a data gap = a missing required value (severity gap); hints and the overdue rule are not gaps
const realGaps = (dq) => dq.gaps.filter((g) => g.severity === 'gap' && g.rule !== 'overdue');
const isOpen = (i) => (i?.status?.cat ?? i?.statusCat ?? 'new') !== 'done';

// Waterline recomputed from scratch for one team and quarter: capacity from the team settings (weekly hours × 12 ×
// project share × (1 − absence rate)), support reserve first, then the projects in rank order with their demand.
export function teamWaterline(c, teamId, q) {
  const { model, metrics, support } = c;
  const cap = teamId === '_none' ? 0 : quarterCapacityParts(model, teamId, capacityPeople(model)).total;
  const sup = support?.reserveQuarter?.[teamId] || 0;
  let cum = sup, firstRank = null;
  const rows = [];
  for (const p of [...model.items].sort((a, b) => a.rank - b.rank)) {
    const d = metrics.get(p.ref)?.demand?.[q]?.[teamId] || 0;
    if (d <= EPS) continue;
    const prev = cum; cum += d;
    const status = cum <= cap + EPS ? 'ok' : prev >= cap - EPS ? 'no' : 'partial';
    if (status !== 'ok' && firstRank == null) firstRank = p.rank;
    rows.push({ ref: p.ref, rank: p.rank, demand: d, status, missing: Math.max(0, Math.min(d, cum - cap)) });
  }
  return { teamId, q, capacity: cap, support: sup, demand: cum, missing: Math.max(0, cum - cap), free: cap - cum, firstRank, rows };
}

export function goldenEnv(ctx) {
  const ds = ctx.ds;
  const c = ctx.computed || computeAll(ds);
  const { model, metrics, wl, deps } = c;
  const q0 = wl.quarters[0], q1 = wl.quarters[1];
  const teams = (ds.teams || []).map((t) => ({ id: t.id, name: t.name }));
  const items = [...model.items].sort((a, b) => a.rank - b.rank);
  const today = dayIdx(ds.today);

  // ---------- projects ----------
  const project = (ref) => {
    const it = model.itemByRef.get(ref), m = metrics.get(ref);
    const issues = (ds.issues || []).filter((i) => i.rootRef === ref);
    const stories = issues.filter((i) => i.role === 'estimate');
    const TS = sum(stories, (s) => s.ts), RE = sum(stories.filter(isOpen), (s) => s.re);
    const overdue = stories.filter((s) => isOpen(s) && s.due && dayIdx(s.due) < today).length;
    const blocked = issues.filter((i) => isOpen(i) && model.isBlocked(i)).length;
    const conflicts = deps.list.filter((d) => d.conflict && [d.pre, d.dep].some((id) => model.byId.get(id)?.rootRef === ref)).length;
    return { ref, name: it.name, key: it.key, rank: it.rank, progressPct: Math.round(m.progress * 100), forecast: TS + RE, TS, RE, overdue, daysOverdue: m.daysOverdue, blocked, conflicts,
      gaps: realGaps(dataQuality(model, new Set([ref]))).length };
  };
  const projects = items.map((p) => project(p.ref));
  const byName = Object.fromEntries(projects.map((p) => [p.name, p]));
  const active = items.filter((p) => !metrics.get(p.ref).done);
  const late = projects.filter((p) => p.daysOverdue > 0 && !metrics.get(p.ref).done);
  const activeAgg = (() => { const TS = sum(active, (p) => metrics.get(p.ref).TS), RE = sum(active, (p) => metrics.get(p.ref).RE), OT = sum(active, (p) => metrics.get(p.ref).openTshirt); return TS + RE + OT > 0 ? Math.round((TS / (TS + RE + OT)) * 100) : 0; })();

  // ---------- teams: recomputed waterline per quarter ----------
  const team = (id, q = q0) => ({ ...teamWaterline(c, id, q), name: teams.find((t) => t.id === id)?.name || id, members: [...capacityPeople(model).values()].filter((p) => p.teamId === id || (p.teams || []).some((x) => x.teamId === id)).length });
  const waterlineQ = (q, { withNone = false } = {}) => {
    const ids = [...new Set([...teams.map((t) => t.id), ...(withNone ? ['_none'] : [])])];
    const cells = ids.map((id) => teamWaterline(c, id, q)).filter((x) => x.demand > EPS || x.capacity > EPS);
    const short = cells.filter((x) => x.missing > EPS);
    const ranks = short.map((x) => x.firstRank).filter((r) => r != null);
    return { q, missing: sum(short, (x) => x.missing), teamsShort: short.filter((x) => x.teamId !== '_none').length, firstRank: ranks.length ? Math.min(...ranks) : null, cells };
  };
  const notStaffed = (cc, q) => cc.model.items.filter((p) => { const s = cc.wl.projectQ[p.ref]?.[q]?.status; return s && s !== 'ok'; }).length;

  // ---------- weekly utilisation (next 8 weeks, engine) ----------
  const teamsOver100 = (c.weeks?.teams || []).filter((t) => t.teamId !== '_none' && t.capTotal > 0 && t.planTotal / t.capTotal > 1).length;

  // ---------- realistic capacity / overtime (insights, not Lotse) ----------
  const rc = realisticCapacity(c, { weeks: 12, history: ctx.history || null, planActual: ctx.planActual || null, lang: ctx.lang || 'de' });
  const rcTeam = (id) => rc.teams.find((t) => t.teamId === id) || null;
  const overtime = { teams: rc.teams.filter((t) => t.overWeeks > 0).length, people: rc.people.filter((p) => p.overWeeks > 0).length, hours: sum(rc.teams, (t) => t.totals.overtime) };
  const realCap = { available: sum(rc.teams, (t) => t.avg.nominal), support: sum(rc.teams, (t) => t.support.p80), room: sum(rc.teams, (t) => t.avg.room), planned: sum(rc.teams, (t) => t.avg.plannedAdj) };

  // ---------- blockers / conflicts / data quality ----------
  const blockedAll = (ds.issues || []).filter((i) => isOpen(i) && model.isBlocked(i));
  const conflictsAll = deps.list.filter((d) => d.conflict).length;
  const dq = dataQuality(model, null);

  // ---------- me (u1): bookings this week ----------
  const me = ctx.me?.id || 'u1';
  const dow = ((today + 3) % 7 + 7) % 7; // 0 = Monday (day 0 = 1970-01-01, a Thursday)
  const monday = today - dow;
  const bookedThisWeek = sum((ds.issues || []).flatMap((i) => i.worklogs || []).filter((w) => w.a === me && dayIdx(w.d) >= monday && dayIdx(w.d) <= today), (w) => w.h);
  const myOpenThisWeek = (ds.issues || []).filter((i) => i.role === 'estimate' && isOpen(i) && i.assignee?.id === me);

  // ---------- support ----------
  const tickets = ds.supportTickets?.tickets || [];
  const incoming = tickets.filter((t) => t.statusCat !== 'done' && t.statusCat === 'new').length;
  const unassigned = tickets.filter((t) => t.statusCat !== 'done' && !t.assignee).length;
  const topicTickets = tickets.length + (ctx.history?.support?.length || 0);
  const slaPct = c.supportSum?.slaRate != null ? Math.round(c.supportSum.slaRate * 100) : null;

  // ---------- plan vs. actual (raw payload sums) ----------
  const pa = ctx.planActual;
  const paTotals = (() => {
    if (!pa) return null;
    let plan = 0, book = 0;
        for (const u of pa.units || []) { plan += sum(Object.values(u.plan || {})); book += sum(Object.values(u.book || {})); }
    return { plan, book };
  })();

  return {
    ds, c, model, q0, q1, teams, projects, byName, items, active: active.length, late, portfolioProgressPct: activeAgg,
    project, team, waterlineQ, notStaffed, teamsOver100, rc, rcTeam, overtime, realCap,
    blocked: blockedAll.length, conflicts: conflictsAll, dq: { gaps: realGaps(dq).length, urgent: realGaps(dq).filter((g) => g.urgent).length, all: dq.gaps.length },
    me, monday: isoOf(monday), bookedThisWeek, myOpen: myOpenThisWeek.length,
    support: { incoming, unassigned, topicTickets, slaPct, tickets: tickets.length }, planActual: paTotals,
  };
}

// What-if expectations: re-run the ENGINE on a changed dataset (no Lotse) and read before/after.
export function scenario(ds, change) {
  const d = structuredClone(ds);
  if (change.kind === 'rank') {
    const items = [...d.portfolio].sort((a, b) => a.rank - b.rank);
    const i = items.findIndex((p) => p.ref === change.ref);
    const [moved] = items.splice(i, 1);
    items.splice(change.toRank - 1, 0, moved);
    items.forEach((p, k) => { p.rank = k + 1; });
  } else if (change.kind === 'teamHours') {
    const t = (d.capacity.teams[change.teamId] ||= {});
    t.extraWeeklyHours = (+t.extraWeeklyHours || 0) + change.weekly;
  } else if (change.kind === 'hours') {
    const p = d.capacity.people[change.personId];
    p.weeklyHours = Math.max(0, (+p.weeklyHours || 0) + change.delta);
  }
  return computeAll(d);
}
// "Fehlende Stunden <quarter>": the sum over every team cell (stories without a team included) of demand above capacity.
export const missingIn = (c, q) => sum(Object.values(c.wl.cells).map((cells) => cells[q]).filter(Boolean), (cell) => Math.max(0, cell.demand - cell.capacity));
