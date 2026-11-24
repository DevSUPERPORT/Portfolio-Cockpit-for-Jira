// Lotse chains – the query language: a small, safe language over the cockpit's own numbers that produces SETS later
// steps work with ("everyone over 100 %", "the projects not staffable in Q4", "the tickets at SLA risk"). Pure; no code
// is ever evaluated – a query is plain data, checked against a fixed list of entities, metrics and operators.
//
//   Query = { entity: 'people'|'projects'|'teams'|'stories'|'tickets',
//             where: [{ m: metric, op: '>'|'>='|'<'|'<='|'='|'!='|'in'|'is', v: number|string|string[]|true|'target' }],
//             window?: { next?: 1–12, past?: 1–12, quarter?: 'YYYY-Qn' }, scope?: { kind: 'project'|'team'|'person', ref },
//             limit?: 1–100 }
//   Text form (formatQuery / parseQuerySyntax):  people where load > 100 next 4w
//                                                 projects where staffable != ok in 2026-Q4
//                                                 stories where overdue > 0 in project ERP-1
//   runQuery(q, ctx) → { q, entity, members: [{ id, kind, name, values: { metric: number|string|bool }, evidence[], keys[] }],
//                         checked, label: [de, en], window }        every member WITH the numbers that qualified it
//   parseQuery(text, ctx) → Query | null                            DE/EN natural language ("Wer liegt unter dem Buchungsziel?")
//   setStory(ctx, res) → Story                                      the set as a story (bars + findings, selfCheck-clean)
//
// The numbers are the cockpit's: load = engine.weeksUtilization (as Kapazität / "Meine Arbeit", via orchestrate/data.js
// personData), booking = booking.bookingOverview (the booking check), staffable = engine.waterline (projectQ), overdue =
// engine.projectMetrics, SLA = sla.ticketSla. Members are capped (limit, default 50); `checked` says how many were looked at.
import { capacityPeople, weeksUtilizationShared } from '../../engine.js';
import { ticketSla, DEFAULT_SLA } from '../../sla.js';
export { teamSupport };
import { inTeam } from '../../allocation.js';
import { dayIdx, isoOf, mondayOf } from '../../dates.js';
import { fold, findProject, findTeam } from '../../ask.js';
import { numberWords } from '../numbers.js';
import { newStory, kpi, ev, finding, follow, done as doneStory, infoStory, sum, memo, addPerson, addTeam, addProject } from '../kit.js';
import { T, plural, computedOf, dsOf, langOf, fmt, invalid } from './kit.js';
import { personData, jobWeeks, weekLabel, teamSupport } from './orchestrate/data.js';

export const ENTITIES = ['people', 'projects', 'teams', 'stories', 'tickets'];
export const OPS = ['>', '>=', '<', '<=', '=', '!=', 'in', 'is'];
export const MAX_LIMIT = 100;
const NUM_OPS = ['>', '>=', '<', '<=', '=', '!='];
// metric → { unit, kind: 'num'|'enum'|'bool', values?, win: 'next'|'past'|'quarter'|null, name: [de, en] }
export const METRICS = {
  people: {
    load: { unit: '%', kind: 'num', win: 'next', name: ['höchste Auslastung', 'peak load'] },
    overWeeks: { unit: 'n', kind: 'num', win: 'next', name: ['Wochen über 100 %', 'weeks over 100%'] },
    booking: { unit: '%', kind: 'num', win: 'past', name: ['Buchungsquote', 'booking rate'] },
    absentPlanned: { unit: 'h', kind: 'num', win: 'next', name: ['geplant während Abwesenheit', 'planned while away'] },
    planned: { unit: 'h', kind: 'num', win: 'next', name: ['geplant', 'planned'] },
    free: { unit: 'h', kind: 'num', win: 'next', name: ['frei', 'free'] },
    overdue: { unit: 'n', kind: 'num', win: null, name: ['überfällige Stories', 'overdue stories'] },
  },
  projects: {
    staffable: { unit: null, kind: 'enum', values: ['ok', 'partial', 'no'], win: 'quarter', name: ['besetzbar', 'staffable'] },
    missing: { unit: 'h', kind: 'num', win: 'quarter', name: ['fehlende Stunden', 'missing hours'] },
    daysOverdue: { unit: 'd', kind: 'num', win: null, name: ['Tage über dem Termin', 'days past due'] },
    overdueStories: { unit: 'n', kind: 'num', win: null, name: ['überfällige Stories', 'overdue stories'] },
    noTshirt: { unit: 'n', kind: 'num', win: null, name: ['ohne T-Shirt-Größe', 'without T-shirt size'] },
    progress: { unit: '%', kind: 'num', win: null, name: ['Fortschritt', 'progress'] },
    rank: { unit: 'n', kind: 'num', win: null, name: ['Rang', 'rank'] },
  },
  teams: {
    load: { unit: '%', kind: 'num', win: 'next', name: ['höchste Auslastung', 'peak load'] },
    overWeeks: { unit: 'n', kind: 'num', win: 'next', name: ['Wochen über 100 %', 'weeks over 100%'] },
    support: { unit: 'h', kind: 'num', win: 'past', name: ['Support-Last', 'support load'] },
    slaRisk: { unit: 'n', kind: 'num', win: null, name: ['Tickets mit SLA-Risiko', 'tickets at SLA risk'] },
  },
  stories: {
    overdue: { unit: 'd', kind: 'num', win: null, name: ['Tage überfällig', 'days overdue'] },
    blocked: { unit: null, kind: 'bool', win: null, name: ['blockiert', 'blocked'] },
    noEstimate: { unit: null, kind: 'bool', win: null, name: ['ohne Schätzung', 'without estimate'] },
    remaining: { unit: 'h', kind: 'num', win: null, name: ['Rest', 'remaining'] },
  },
  tickets: {
    sla: { unit: null, kind: 'enum', values: ['breached', 'atRisk', 'ok'], win: null, name: ['SLA-Status', 'SLA status'] },
    slaLeft: { unit: 'h', kind: 'num', win: null, name: ['SLA übrig', 'SLA left'] },
  },
};
export const ENTITY_NAMES = { people: ['Personen', 'people'], projects: ['Projekte', 'projects'], teams: ['Teams', 'teams'], stories: ['Stories', 'stories'], tickets: ['Tickets', 'tickets'] };

// The named queries – what people ask for most, each a plain Query (tools.js offers them as query.<id>).
export const PRESETS = {
  overloaded: { entity: 'people', where: [{ m: 'load', op: '>', v: 100 }], window: { next: 4 }, name: ['Personen über 100 %', 'People over 100%'] },
  belowBooking: { entity: 'people', where: [{ m: 'booking', op: '<', v: 'target' }], window: { past: 4 }, name: ['Personen unter dem Buchungsziel', 'People below the booking target'] },
  absentWithWork: { entity: 'people', where: [{ m: 'absentPlanned', op: '>', v: 0 }], window: { next: 4 }, name: ['Abwesend mit geplanter Arbeit', 'Away with planned work'] },
  notStaffable: { entity: 'projects', where: [{ m: 'staffable', op: '!=', v: 'ok' }], window: { quarter: null }, name: ['Projekte nicht voll besetzbar', 'Projects not fully staffable'] },
  projectsOverdue: { entity: 'projects', where: [{ m: 'daysOverdue', op: '>', v: 0 }], name: ['Projekte über dem Termin', 'Projects past their due date'] },
  noTshirt: { entity: 'projects', where: [{ m: 'noTshirt', op: '>', v: 0 }], name: ['Projekte ohne T-Shirt-Größe', 'Projects without T-shirt size'] },
  teamsOverCapacity: { entity: 'teams', where: [{ m: 'load', op: '>', v: 100 }], window: { next: 4 }, name: ['Teams über Kapazität', 'Teams over capacity'] },
  teamsSupport: { entity: 'teams', where: [{ m: 'support', op: '>', v: 0 }], window: { past: 4 }, name: ['Support-Last je Team', 'Support load per team'] },
  storiesOverdue: { entity: 'stories', where: [{ m: 'overdue', op: '>', v: 0 }], name: ['Überfällige Stories', 'Overdue stories'] },
  storiesBlocked: { entity: 'stories', where: [{ m: 'blocked', op: 'is', v: true }], name: ['Blockierte Stories', 'Blocked stories'] },
  storiesNoEstimate: { entity: 'stories', where: [{ m: 'noEstimate', op: 'is', v: true }], name: ['Stories ohne Schätzung', 'Stories without estimate'] },
  ticketsSla: { entity: 'tickets', where: [{ m: 'sla', op: 'in', v: ['breached', 'atRisk'] }], name: ['Tickets mit SLA-Risiko', 'Tickets at SLA risk'] },
};
export const PRESET_IDS = Object.keys(PRESETS);

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
const pct = (u) => (Number.isFinite(u) ? Math.round(u * 100) : null);
const isOpen = (i) => (i?.status?.cat ?? i?.statusCat ?? 'new') !== 'done';
const keyCmp = (a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true });
const clampW = (n) => Math.max(1, Math.min(12, Math.round(+n || 0)));

// ---------- checking a query (plain data from anywhere: the parser, the plan editor, the LLM) ----------
export function cleanQuery(q, ctx) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) throw invalid('query');
  if (!ENTITIES.includes(q.entity)) throw invalid('query.entity');
  const M = METRICS[q.entity];
  const where = [];
  for (const w of [].concat(q.where || []).slice(0, 4)) {
    if (!w || typeof w !== 'object') throw invalid('query.where');
    const meta = M[w.m];
    if (!meta) throw invalid('query.where.m', String(w.m).slice(0, 40));
    if (!OPS.includes(w.op)) throw invalid('query.where.op');
    let v = w.v;
    if (meta.kind === 'num') {
      if (!NUM_OPS.includes(w.op)) throw invalid('query.where.op');
      if (v === 'target' && w.m === 'booking') v = 'target';
      else { v = typeof v === 'string' ? Number(v.replace(',', '.')) : v; if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e6) throw invalid('query.where.v'); }
    } else if (meta.kind === 'enum') {
      const list = [].concat(v);
      if (!list.length || !list.every((x) => meta.values.includes(x))) throw invalid('query.where.v');
      if (w.op === 'in') v = [...new Set(list)];
      else if (w.op === '=' || w.op === '!=') { if (list.length !== 1) throw invalid('query.where.v'); v = list[0]; } else throw invalid('query.where.op');
    } else if (meta.kind === 'bool') {
      if (w.op !== 'is' && w.op !== '=') throw invalid('query.where.op');
      v = v !== false && v !== 'false';
    }
    where.push({ m: w.m, op: meta.kind === 'bool' ? 'is' : w.op, v });
  }
  const out = { entity: q.entity, where };
  const wins = new Set(where.map((w) => M[w.m].win).filter(Boolean));
  const w = q.window && typeof q.window === 'object' ? q.window : {};
  const win = {};
  if (wins.has('next') || w.next != null) win.next = clampW(w.next ?? 4);
  if (wins.has('past') || w.past != null) win.past = clampW(w.past ?? 4);
  if (wins.has('quarter')) {
    const qs = computedOf(ctx).wl.quarters;
    const k = typeof w.quarter === 'string' && /^\d{4}-Q[1-4]$/.test(w.quarter) ? w.quarter : null;
    if (k && !qs.includes(k)) throw invalid('query.window.quarter', 'outside the waterline');
    win.quarter = k || qs[0];
  }
  if (Object.keys(win).length) out.window = win;
  if (q.scope != null) {
    const s = q.scope;
    const { model } = computedOf(ctx);
    if (!s || typeof s !== 'object' || !['project', 'team', 'person'].includes(s.kind)) throw invalid('query.scope');
    if (s.kind === 'project' && !model.itemByRef.has(s.ref)) throw invalid('query.scope');
    if (s.kind === 'team' && !model.teams.has(s.ref)) throw invalid('query.scope');
    if (s.kind === 'person' && !dsOf(ctx).people?.[s.ref]) throw invalid('query.scope');
    if (s.kind === 'person' && !['stories', 'tickets'].includes(q.entity)) throw invalid('query.scope', 'a person scopes stories and tickets');
    out.scope = { kind: s.kind, ref: s.ref };
  }
  if (q.limit != null) { const n = Math.round(+q.limit); if (!(n >= 1 && n <= MAX_LIMIT)) throw invalid('query.limit'); out.limit = n; }
  return out;
}
export const queryKey = (q) => JSON.stringify([q.entity, q.where, q.window || null, q.scope || null, q.limit || null]);

// ---------- evaluating ----------
function test(meta, w, val, row) {
  if (val == null) return false;
  if (meta.kind === 'bool') return !!val === !!w.v;
  if (meta.kind === 'enum') return w.op === 'in' ? w.v.includes(val) : w.op === '=' ? val === w.v : val !== w.v;
  const v = w.v === 'target' ? row.target : w.v;
  if (v == null) return false;
  switch (w.op) { case '>': return val > v; case '>=': return val >= v; case '<': return val < v; case '<=': return val <= v; case '=': return val === v; default: return val !== v; }
}
const winOf = (q) => ({ past: q.window?.past || 0, next: q.window?.next || 0 });

function peopleRows(ctx, q) {
  const c = computedOf(ctx);
  const { model } = c;
  const ds = dsOf(ctx);
  const L = langOf(ctx);
  const ids = new Set([...capacityPeople(model).keys()].filter((id) => ds.people?.[id]));
  for (const s of ds.issues || []) if (s.role === 'estimate' && isOpen(s) && s.assignee?.id && ds.people?.[s.assignee.id]) ids.add(s.assignee.id);
  const cap = capacityPeople(model);
  let list = [...ids].filter((id) => !String(id).startsWith('anon'));
  if (q.scope?.kind === 'team') list = list.filter((id) => cap.get(id) && inTeam(cap.get(id), q.scope.ref));
  if (q.scope?.kind === 'project') { const on = new Set((ds.issues || []).filter((s) => s.rootRef === q.scope.ref && s.role === 'estimate' && isOpen(s) && s.assignee?.id).map((s) => s.assignee.id)); list = list.filter((id) => on.has(id)); }
  const job = { scope: { kind: 'portfolio', ref: null, name: 'Portfolio' }, subjects: 'people', blocks: ['weeks', 'bookings', 'tasks', 'absences'], window: winOf(q) };
  return list.map((id) => {
    const d = personData(ctx, job, id);
    const coming = d.weeks.filter((w) => !w.past), past = d.weeks.filter((w) => w.past && w.possible > 0);
    const fin = coming.filter((w) => Number.isFinite(w.util));
    const peakW = [...fin].sort((a, b) => b.util - a.util)[0] || null;
    const noTime = coming.filter((w) => !Number.isFinite(w.util));
    const poss = sum(past, (w) => w.possible), booked = sum(past, (w) => w.booked);
    const minPct = past[0]?.minPct ?? dsOf(ctx).config?.booking?.minPct ?? 80;
    const awayWeeks = d.absences.length ? coming.filter((w) => d.absences.some((a) => a.from <= w.to && a.to >= w.from)) : [];
    const values = {
      load: noTime.length && !(peakW && pct(peakW.util) > 100) ? 999 : peakW ? pct(peakW.util) : 0,
      overWeeks: coming.filter((w) => w.util > 1.0001).length,
      booking: past.length && poss > 0 ? Math.round((booked / poss) * 100) : null,
      absentPlanned: r1(sum(awayWeeks, (w) => w.planScope || 0)),
      planned: r1(sum(coming, (w) => w.plan)),
      free: r1(sum(coming, (w) => Math.max(0, (w.cap || 0) - (w.plan || 0)))),
      overdue: d.tasks.filter((t) => t.overdue).length,
    };
    const evidence = [];
    if (peakW) evidence.push(ev(T(L, `Spitze ${weekLabel(L, peakW)}`, `peak ${weekLabel(L, peakW)}`), pct(peakW.util), '%'), ev(T(L, 'geplant', 'planned'), peakW.plan, 'h'), ev(T(L, 'verfügbar', 'available'), peakW.cap, 'h'));
    if (noTime.length) evidence.push(ev(T(L, 'Wochen ohne freie Zeit', 'weeks without free time'), noTime.length, 'n'));
    if (past.length) evidence.push(ev(T(L, 'gebucht', 'booked'), booked, 'h'), ev(T(L, 'möglich', 'possible'), poss, 'h'), ev(T(L, 'Ziel', 'target'), minPct, '%'));
    if (d.absences.length) evidence.push(ev(T(L, 'abwesend ab', 'away from'), d.absences[0].from, 'date'), ev(T(L, 'Arbeitstage', 'working days'), sum(d.absences, (a) => a.days), 'd'));
    return { id, kind: 'person', name: d.name, values, target: minPct, evidence, keys: d.tasks.filter((t) => t.overdue).map((t) => t.key).slice(0, 12), noTime: noTime.length, peakWeek: peakW ? weekLabel(L, peakW) : null, teamId: d.teamId, weeks: coming.length, pastWeeks: past.length, booked: r1(booked), possible: r1(poss) };
  });
}
function projectRows(ctx, q) {
  const c = computedOf(ctx);
  const { model, metrics, wl, dq } = c;
  const L = langOf(ctx);
  const qk = q.window?.quarter || wl.quarters[0];
  const noSize = new Map();
  for (const g of dq.gaps || []) if (g.severity === 'gap' && g.field === 'tshirt' && String(g.rule || '').startsWith('missing:') && g.rootRef) noSize.set(g.rootRef, (noSize.get(g.rootRef) || 0) + 1);
  let items = model.items.filter((it) => !metrics.get(it.ref)?.done && it.statusCat !== 'done');
  if (q.scope?.kind === 'project') items = items.filter((it) => it.ref === q.scope.ref);
  if (q.scope?.kind === 'team') items = items.filter((it) => (wl.projectQ[it.ref]?.[qk]?.teams || []).some((t) => t.teamId === q.scope.ref) || it.leadTeam === q.scope.ref);
  return items.map((it) => {
    const m = metrics.get(it.ref) || {};
    const cell = wl.projectQ[it.ref]?.[qk] || null;
    const missing = cell ? r1(sum(cell.teams || [], (t) => Math.max(0, t.demand - t.staffed))) : 0;
    const values = { staffable: cell ? cell.status : null, missing, daysOverdue: m.daysOverdue || 0, overdueStories: m.overdueCount || 0, noTshirt: noSize.get(it.ref) || 0, progress: Number.isFinite(m.progress) ? Math.round(m.progress * 100) : 0, rank: it.rank };
    const short = (cell?.teams || []).filter((t) => t.demand - t.staffed > 0.5).map((t) => model.teams.get(t.teamId)?.name || t.teamId);
    const evidence = [ev(T(L, 'Rang', 'rank'), it.rank, 'n'), ...(cell ? [ev(T(L, 'fehlt', 'missing'), missing, 'h'), ev(T(L, 'Quartal', 'quarter'), qk, 'quarter')] : []), ...(m.daysOverdue ? [ev(T(L, 'Tage über Termin', 'days late'), m.daysOverdue, 'd'), ...(m.due ? [ev(T(L, 'Termin', 'due'), m.due, 'date')] : [])] : [])];
    return { id: it.ref, kind: 'project', name: it.name, key: it.key, rank: it.rank, owner: it.owner ? { id: it.owner.id, name: it.owner.name || null } : null, values, evidence, keys: [it.key].filter(Boolean), short, quarter: qk };
  });
}
function teamRows(ctx, q) {
  const c = computedOf(ctx);
  const { model } = c;
  const L = langOf(ctx);
  const n = q.window?.next || 4, past = q.window?.past || 4;
  const W = jobWeeks(ctx, { past: 0, next: n });
  const util = teamUtil(ctx, n);
  let teams = [...model.teams.values()];
  if (q.scope?.kind === 'team') teams = teams.filter((t) => t.id === q.scope.ref);
  return teams.map((t) => {
    const u = util.get(t.id);
    const weeks = W.map((w, i) => ({ w, plan: u ? u.plan[i] || 0 : 0, cap: u ? u.cap[i] || 0 : 0 })).map((x) => ({ ...x, util: x.cap > 0 ? x.plan / x.cap : x.plan > 0 ? Infinity : 0 }));
    const fin = weeks.filter((x) => Number.isFinite(x.util));
    const pk = [...fin].sort((a, b) => b.util - a.util)[0] || null;
    const sup = teamSupport(ctx, t.id, past);
    const values = { load: pk ? pct(pk.util) : 0, overWeeks: weeks.filter((x) => x.util > 1.0001).length, support: sup.booked, slaRisk: sup.risk.length };
    const evidence = [...(pk ? [ev(T(L, `Spitze ${weekLabel(L, pk.w)}`, `peak ${weekLabel(L, pk.w)}`), pct(pk.util), '%'), ev(T(L, 'geplant', 'planned'), pk.plan, 'h'), ev(T(L, 'verfügbar', 'available'), pk.cap, 'h')] : []),
      ev(T(L, 'Support gebucht', 'support booked'), sup.booked, 'h'), ev(T(L, 'Wochen', 'weeks'), past, 'n'), ev(T(L, 'Tickets mit SLA-Risiko', 'tickets at SLA risk'), sup.risk.length, 'n')];
    return { id: t.id, kind: 'team', name: t.name, values, evidence, keys: [...sup.risk.map((x) => x.key), ...sup.keys].slice(0, 12), members: u?.members?.length || 0, hasWork: !!(u && (u.members?.length || u.planTotal > 0)) || sup.booked > 0 || sup.risk.length > 0 };
  }).filter((r) => r.hasWork);
}
// the engine's team weeks for n weeks (the same numbers as Kapazität)
function teamUtil(ctx, n) {
  return memo(ctx, `chain:teamutil:${n}`, () => {
    const c = computedOf(ctx);
    const out = new Map();
    const wu = weeksOf(c, n);
    for (const t of wu.teams || []) out.set(t.teamId, t);
    return out;
  });
}
const weeksOf = (c, n) => weeksUtilizationShared(c.model, c.support, Math.max(1, n));

function storyRows(ctx, q) {
  const c = computedOf(ctx);
  const { model } = c;
  const ds = dsOf(ctx);
  const L = langOf(ctx);
  const today = model.today;
  const s = q.scope;
  return (ds.issues || []).filter((i) => i.role === 'estimate' && isOpen(i) && (!s || (s.kind === 'project' ? i.rootRef === s.ref : s.kind === 'team' ? i.team?.id === s.ref : i.assignee?.id === s.ref))).sort(keyCmp).map((i) => {
    const od = i.due && dayIdx(i.due) < today ? today - dayIdx(i.due) : 0;
    const values = { overdue: od, blocked: !!model.isBlocked?.(i), noEstimate: !(i.oe > 0) && !(i.re > 0), remaining: r1(i.re || 0) };
    return { id: i.id, kind: 'story', name: `${i.key} · ${String(i.summary || '').slice(0, 60)}`, key: i.key, ref: i.rootRef, values, evidence: [ev(i.key, od || null, od ? 'd' : null, { key: i.key, text: String(i.summary || '').slice(0, 120) }), ...(i.due ? [ev(T(L, 'Due', 'due'), i.due, 'date')] : [])], keys: [i.key], assignee: i.assignee?.id || null, team: i.team?.id || null };
  });
}
function ticketRows(ctx, q) {
  const ds = dsOf(ctx);
  const L = langOf(ctx);
  const cal = ds.config?.support?.sla || DEFAULT_SLA;
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const s = q.scope;
  return (ds.supportTickets?.tickets || []).filter((t) => t.statusCat !== 'done' && (!s || (s.kind === 'team' ? t.team?.id === s.ref : s.kind === 'person' ? t.assignee?.id === s.ref : true))).map((t) => {
    const sla = ticketSla(t, cal, now);
    const values = { sla: sla.status === 'met' ? 'ok' : sla.status, slaLeft: r1(sla.remainingH ?? 0) };
    return { id: t.id, kind: 'ticket', name: `${t.key} · ${String(t.summary || '').slice(0, 60)}`, key: t.key, values, evidence: [ev(T(L, 'SLA übrig', 'SLA left'), r1(sla.remainingH ?? 0), 'h', { key: t.key, text: String(t.summary || '').slice(0, 120) })], keys: [t.key], team: t.team?.id || null, teamName: t.team?.name || null, priority: t.priority || null };
  }).sort((a, b) => a.values.slaLeft - b.values.slaLeft || keyCmp(a, b));
}
const ROWS = { people: peopleRows, projects: projectRows, teams: teamRows, stories: storyRows, tickets: ticketRows };

export function runQuery(query, ctx) {
  const q = cleanQuery(query, ctx);
  return memo(ctx, `chain:q:${langOf(ctx)}:${queryKey(q)}`, () => {
    const rows = ROWS[q.entity](ctx, q);
    const M = METRICS[q.entity];
    const members = rows.filter((r) => q.where.every((w) => test(M[w.m], w, r.values[w.m], r)));
    // the first condition orders the set: "over" largest first, "below" smallest first, enums by the next number
    const w0 = q.where[0];
    const numKey = w0 && M[w0.m].kind === 'num' ? w0.m : Object.keys(M).find((k) => M[k].kind === 'num');
    const asc = w0 && (w0.op === '<' || w0.op === '<=') || (q.entity === 'tickets');
    if (numKey) members.sort((a, b) => ((a.values[numKey] ?? 0) - (b.values[numKey] ?? 0)) * (asc ? 1 : -1) || String(a.name).localeCompare(String(b.name)));
    const limit = q.limit || 50;
    return { q, entity: q.entity, members: members.slice(0, limit), total: members.length, checked: rows.length, more: Math.max(0, members.length - limit), label: queryLabel(q, ctx) };
  });
}

// ---------- words ----------
const OPW = { '>': ['über', 'over'], '>=': ['mindestens', 'at least'], '<': ['unter', 'below'], '<=': ['höchstens', 'at most'], '=': ['gleich', 'equal to'], '!=': ['nicht', 'not'] };
const ENUMW = { ok: ['voll besetzbar', 'fully staffable'], partial: ['teilweise besetzbar', 'partly staffable'], no: ['nicht besetzbar', 'not staffable'], breached: ['SLA gerissen', 'SLA breached'], atRisk: ['SLA knapp', 'SLA at risk'] };
export function queryLabel(q, ctx) {
  const F = fmt({ ...ctx, lang: 'de' }), FE = fmt({ ...ctx, lang: 'en' });
  const one = (L, F2) => {
    const M = METRICS[q.entity];
    const parts = q.where.map((w) => {
      const m = M[w.m];
      const n = m.name[L === 'en' ? 1 : 0];
      if (m.kind === 'bool') return n;
      if (m.kind === 'enum') { const vs = [].concat(w.v).map((x) => ENUMW[x]?.[L === 'en' ? 1 : 0] || x); return w.op === '!=' ? T(L, `nicht ${vs[0]}`, `not ${vs[0]}`) : vs.join(T(L, ' oder ', ' or ')); }
      const v = w.v === 'target' ? T(L, 'Ziel', 'target') : m.unit === '%' ? (L === 'en' ? `${w.v}%` : `${w.v} %`) : m.unit === 'h' ? F2.h(w.v, 1) : String(w.v);
      if (w.op === '>' && w.v === 0) return n;
      return `${n} ${OPW[w.op][L === 'en' ? 1 : 0]} ${v}`;
    });
    const win = q.window ? [q.window.next ? T(L, `nächste ${q.window.next} Wochen`, `next ${q.window.next} weeks`) : null, q.window.past ? T(L, `letzte ${q.window.past} Wochen`, `last ${q.window.past} weeks`) : null, q.window.quarter ? F2.quarter(q.window.quarter) : null].filter(Boolean) : [];
    const en0 = ENTITY_NAMES[q.entity][L === 'en' ? 1 : 0];
    return `${en0.charAt(0).toUpperCase()}${en0.slice(1)}: ${parts.join(', ') || T(L, 'alle', 'all')}${win.length ? ` · ${win.join(', ')}` : ''}`;
  };
  return [one('de', F), one('en', FE)];
}
// the text form – what the plan editor shows and accepts, and what the LLM may write
export function formatQuery(q) {
  const where = q.where.map((w) => `${w.m} ${w.op} ${Array.isArray(w.v) ? w.v.join('|') : w.v}`).join(' and ');
  const win = q.window ? [q.window.next ? `next ${q.window.next}w` : null, q.window.past ? `past ${q.window.past}w` : null, q.window.quarter ? `in ${q.window.quarter}` : null].filter(Boolean).join(' ') : '';
  const sc = q.scope ? ` scope ${q.scope.kind}:${q.scope.ref}` : '';
  return `${q.entity}${where ? ` where ${where}` : ''}${win ? ` ${win}` : ''}${sc}`.trim();
}
export function parseQuerySyntax(text, ctx) {
  const t = String(text || '').trim().slice(0, 300);
  const m = /^(people|projects|teams|stories|tickets)\b(.*)$/i.exec(t);
  if (!m) return null;
  const q = { entity: m[1].toLowerCase(), where: [], window: {} };
  let rest = m[2];
  const sc = /\bscope\s+(project|team|person):(\S+)/i.exec(rest);
  if (sc) { q.scope = { kind: sc[1].toLowerCase(), ref: sc[2] }; rest = rest.replace(sc[0], ' '); }
  const nx = /\bnext\s+(\d{1,2})\s*w/i.exec(rest); if (nx) q.window.next = +nx[1];
  const ps = /\bpast\s+(\d{1,2})\s*w/i.exec(rest); if (ps) q.window.past = +ps[1];
  const qq = /\bin\s+(\d{4}-Q[1-4])\b/i.exec(rest); if (qq) q.window.quarter = qq[1].toUpperCase();
  const wh = /\bwhere\s+(.*?)(?=\s+(?:next\s+\d|past\s+\d|in\s+\d{4}-Q)|$)/i.exec(rest);
  if (wh) for (const part of wh[1].split(/\s+and\s+/i)) {
    const c = /^\s*([a-zA-Z]+)\s*(>=|<=|!=|>|<|=|in|is)\s*(.+?)\s*$/.exec(part);
    if (!c) return null;
    const raw = c[3];
    const v = c[2] === 'in' ? raw.split('|').map((x) => x.trim()) : raw === 'true' ? true : raw === 'false' ? false : /^-?\d+([.,]\d+)?$/.test(raw) ? Number(raw.replace(',', '.')) : raw;
    q.where.push({ m: c[1], op: c[2], v });
  }
  if (!Object.keys(q.window).length) delete q.window;
  try { return cleanQuery(q, ctx); } catch { return null; }
}

// ---------- natural language (DE/EN) → a query ----------
const qText = (text) => numberWords(fold(String(text || '').slice(0, 400)).replace(/[?!.,;:„“"”()]+/g, ' ').replace(/\s+/g, ' ').trim());
function windowIn(q) {
  const n = /\b(naechste[nrms]?|kommende[nrms]?|next|coming|upcoming|folgende[nrms]?)\s+(\d{1,2})\s+(wochen?|weeks?)\b/.exec(q);
  const p = /\b(letzte[nrms]?|vergangene[nrms]?|past|last|previous)\s+(\d{1,2})\s+(wochen?|weeks?)\b/.exec(q);
  const one = /\b(naechste|next|kommende) (woche|week)\b/.test(q) ? 2 : /\b(diese|this) (woche|week)\b/.test(q) ? 1 : null;
  return { next: n ? clampW(+n[2]) : one, past: p ? clampW(+p[2]) : /\b(letzte[nrms]?|vergangene[nrms]?|last|previous) (monat|month)\b/.test(q) ? 4 : null };
}
export function quarterIn(q, ctx) {
  const qs = computedOf(ctx).wl.quarters;
  const m = /\bq([1-4])\s*[/ -]?\s*(20\d\d)\b|\b(20\d\d)\s*-?\s*q([1-4])\b/.exec(q);
  if (m) { const k = `${m[2] || m[3]}-Q${m[1] || m[4]}`; return qs.includes(k) ? k : null; }
  const s = /\b(?:im |in |fuer |for |)q([1-4])\b/.exec(q);
  if (s) return qs.find((k) => k.endsWith(`-Q${s[1]}`)) || null;
  if (/\b(naechste[sn]?|next|kommende[sn]?) (quartal|quarter)\b/.test(q)) return qs[1] || null;
  if (/\b(dieses|diesem|this|current|laufende[nm]?|aktuelle[nm]?) (quartal|quarter)\b/.test(q)) return qs[0];
  return null;
}
function scopeIn(q, ctx) {
  const { model } = computedOf(ctx);
  const p = findProject(q, model);
  const t = findTeam(p ? q.replace(fold(p.name), ' ') : q, model);
  const teamSaid = t && new RegExp(`\\bteams? ${fold(t.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(q);
  if (p && !(t && teamSaid)) return { kind: 'project', ref: p.ref };
  if (t) return { kind: 'team', ref: t.id };
  return null;
}
const R = {
  people: /\b(wer|who|whom|everyone|everybody|jede[rn]?|alle|leute|personen|people|person|kolleg\w*|colleagues?|mitarbeit\w*|staff|members?)\b/,
  over100: /\b(ueber|over|above|more than|mehr als)\s+(\d{2,3}|hundert)\s*(%|prozent|percent)|\b(ueber|over|above)\s+(100|hundert)\b|\b(ueberlast\w*|overload\w*|overbooked|ueberbucht\w*|over capacity|ueber (der |ihrer )?kapazitaet)\b/,
  belowBooking: /\b(unter|below|under|beneath)\s+(dem |the |ihrem |their )?(buchungs-?ziel|booking target|buchungsquote|target)\b|\b(zu wenig|not enough|too little|nicht genug|too few hours)\b.{0,20}\b(gebucht|booked|logged|erfasst)\b|\bbuchungsziel\b.{0,20}\b(nicht|unter|verfehlt|missed)\b/,
  absent: /\b(abwesen\w*|absent|away|im urlaub|on (leave|vacation)|urlaub)\b.{0,40}\b(geplant\w*|planned|arbeit|work|aufgaben|tasks?)\b|\b(geplant\w*|planned) (arbeit|work)\b.{0,30}\b(abwesen\w*|absent|away|urlaub)\b/,
  projects: /\b(projekte?n?|projects?)\b/,
  notStaffable: /\b(nicht|not|un)\s?(voll |fully )?(besetzbar|staffable|staffed|besetzt)\b|\bunstaffable\b|\bkapazitaet reicht nicht\b|\bwasserlinie\b.{0,20}\b(unter|below)\b/,
  pastDue: /\b(ueber (dem |ihrem )?termin|past (their |the )?(due|deadline)|ueberfaellig\w*|overdue|verspaetet\w*|late)\b/,
  noTshirt: /\b(ohne|without|no|missing|fehlende?|keine?)\s+(t-?shirt|groesse|size)\w*/,
  teams: /\b(teams?)\b/,
  overCap: /\b(ueber|over|above)\s+(der |ihrer |their |)?(kapazitaet|capacity)\b|\b(ueberlast\w*|overload\w*|ueber 100|over 100)\b/,
  support: /\bsupport-?(last|load|aufwand|stunden|hours)?\b|\bsupport\b/,
  stories: /\b(stor(y|ies)|aufgaben|tasks?|vorgaeng\w*|work items?)\b/,
  blocked: /\b(blockiert\w*|blocked|blocker\w*)\b/,
  noEstimate: /\b(ohne|without|no|missing|fehlende?|keine?)\s+(an?\s+|eine?\s+)?(schaetzung\w*|estimates?|aufwand)\b|\bunestimated\b/,
  tickets: /\b(tickets?|anfragen|support-?faelle|cases)\b/,
  sla: /\bsla\b/,
  findVerb: /\b(finde[nt]?|finde?|find|zeig\w*|show|list\w*|liste?|wer|who|which|welche[rsn]?|pruef\w*|check\w*|identifiz\w*|identify|suche?|search|alle|all|everyone|ermittle?|determine)\b/,
};
// → { query, why } | null. Only sentences that ask for a SET (who / which / find / all … that …) – the rest is left to the
// skills and workflows (understand.js / route.js).
export function parseQuery(text, ctx) {
  const q = qText(text);
  if (!q) return null;
  const w = windowIn(q);
  const scope = scopeIn(q, ctx);
  const find = R.findVerb.test(q);
  const mk = (preset, over = {}) => {
    const base = PRESETS[preset];
    const out = { entity: base.entity, where: base.where.map((x) => ({ ...x })), ...(base.window ? { window: { ...base.window } } : {}), ...over };
    return out;
  };
  let query = null, why = null;
  if (R.tickets.test(q) && R.sla.test(q)) { query = mk('ticketsSla', scope?.kind === 'team' ? { scope } : {}); why = 'ticketsSla'; }
  else if (R.teams.test(q) && R.support.test(q) && !R.stories.test(q)) { query = mk('teamsSupport', { window: { past: w.past || 4 }, ...(scope?.kind === 'team' ? { scope } : {}) }); why = 'teamsSupport'; }
  else if (R.teams.test(q) && R.overCap.test(q) && !R.people.test(q.replace(/\bteams?\b/g, ' '))) { query = mk('teamsOverCapacity', { window: { next: w.next || 4 } }); why = 'teamsOverCapacity'; }
  else if (R.belowBooking.test(q)) { query = mk('belowBooking', { window: { past: w.past || 4 }, ...(scope?.kind === 'team' || scope?.kind === 'project' ? { scope } : {}) }); why = 'belowBooking'; }
  else if (R.absent.test(q) && (R.people.test(q) || find)) { query = mk('absentWithWork', { window: { next: w.next || 4 }, ...(scope?.kind === 'team' || scope?.kind === 'project' ? { scope } : {}) }); why = 'absentWithWork'; }
  else if (R.over100.test(q) && (R.people.test(q) || find) && !R.projects.test(q) && !R.teams.test(q.replace(/\bteam ?\w+\b/, ' '))) {
    const th = /\b(?:ueber|over|above|more than|mehr als)\s+(\d{2,3})\s*(?:%|prozent|percent)/.exec(q);
    query = mk('overloaded', { window: { next: w.next || 4 }, ...(scope?.kind === 'team' || scope?.kind === 'project' ? { scope } : {}) });
    if (th && +th[1] !== 100 && +th[1] >= 50 && +th[1] <= 400) query.where = [{ m: 'load', op: '>', v: +th[1] }];
    why = 'overloaded';
  }
  else if (R.projects.test(q) && R.notStaffable.test(q)) { const qk = quarterIn(q, ctx); query = mk('notStaffable', { window: { quarter: qk } }); why = 'notStaffable'; }
  else if (R.projects.test(q) && R.noTshirt.test(q)) { query = mk('noTshirt'); why = 'noTshirt'; }
  else if (R.projects.test(q) && R.pastDue.test(q) && !R.stories.test(q)) { query = mk('projectsOverdue'); why = 'projectsOverdue'; }
  else if (R.stories.test(q) && (R.blocked.test(q) || R.noEstimate.test(q) || R.pastDue.test(q)) && find) {
    const preset = R.blocked.test(q) ? 'storiesBlocked' : R.noEstimate.test(q) ? 'storiesNoEstimate' : 'storiesOverdue';
    query = mk(preset, scope ? { scope } : {}); why = preset;
  }
  if (!query) return null;
  try { return { query: cleanQuery(query, ctx), why }; } catch { return null; }
}

// ---------- the set as a story ----------
const unitText = (F, L, v, u) => (v == null ? '–' : u === '%' ? (v >= 999 ? T(L, 'keine freie Zeit', 'no free time') : L === 'en' ? `${v}%` : `${v} %`) : u === 'h' ? F.h(v, 1) : u === 'd' ? `${v} ${T(L, plural(v, 'Tag', 'Tage'), plural(v, 'day', 'days'))}` : String(v));
// what a member "is" in words, with the number that qualified it ("411 %", "nicht besetzbar, 554,9 h fehlen", "SLA gerissen, 91 h drüber")
export function memberText(F, L, q, m) {
  const M = METRICS[q.entity];
  const w0 = q.where[0];
  const main = w0 ? w0.m : null;
  if (q.entity === 'tickets') { const left = m.values.slaLeft; return left < 0 ? T(L, `SLA gerissen, ${F.h(-left, 1)} drüber`, `SLA breached, ${F.h(-left, 1)} over`) : T(L, `SLA knapp, ${F.h(left, 1)} übrig`, `SLA at risk, ${F.h(left, 1)} left`); }
  if (q.entity === 'projects' && (main === 'staffable' || main === 'missing')) return m.values.staffable === 'ok' ? T(L, 'voll besetzbar', 'fully staffable') : T(L, `${ENUMW[m.values.staffable]?.[0] || ''}, ${F.h(m.values.missing, 1)} fehlen`, `${ENUMW[m.values.staffable]?.[1] || ''}, ${F.h(m.values.missing, 1)} missing`);
  if (main && M[main].kind === 'bool') return q.entity === 'stories' ? T(L, `${M[main].name[0]}, ${F.h(m.values.remaining, 1)} Rest`, `${M[main].name[1]}, ${F.h(m.values.remaining, 1)} remaining`) : M[main].name[L === 'en' ? 1 : 0];
  const k = main && M[main].kind === 'num' ? main : barMetric(q);
  const t = unitText(F, L, m.values[k], M[k].unit);
  if (k === 'booking') return T(L, `${t} gebucht, Ziel ${m.target} %`, `${t} booked, target ${m.target}%`);
  if (M[k].unit === 'n') return `${t} ${M[k].name[L === 'en' ? 1 : 0]}`;
  return t;
}
// the number the bars show: the condition's own number, else the entity's natural measure
export function barMetric(q) {
  const M = METRICS[q.entity];
  const w0 = q.where[0];
  if (w0 && M[w0.m].kind === 'num') return w0.m;
  return { projects: 'missing', stories: 'remaining', tickets: 'slaLeft', teams: 'load', people: 'load' }[q.entity];
}
function memberEvidence(L, q, m) {
  const M = METRICS[q.entity];
  const k = barMetric(q);
  const v = m.values[k];
  const out = [];
  if (q.entity === 'tickets') out.push(ev(v < 0 ? T(L, 'über SLA', 'over SLA') : T(L, 'SLA übrig', 'SLA left'), Math.abs(v), 'h', m.key ? { key: m.key } : {}));
  else if (Number.isFinite(v) && v < 999) out.push(ev(M[k].name[L === 'en' ? 1 : 0], v, M[k].unit === '%' ? '%' : M[k].unit === 'h' ? 'h' : M[k].unit === 'd' ? 'd' : 'n', m.key ? { key: m.key } : {}));
  if (q.entity === 'projects' && m.values.missing != null) out.push(ev(T(L, 'fehlt', 'missing'), m.values.missing, 'h'));
  if (q.entity === 'stories') out.push(ev(T(L, 'Rest', 'remaining'), m.values.remaining, 'h'));
  if (m.target != null && k === 'booking') out.push(ev(T(L, 'Ziel', 'target'), m.target, '%'));
  return [...out, ...m.evidence].slice(0, 8);
}
export function setStory(ctx, res) {
  const L = langOf(ctx);
  const { q, members } = res;
  const M = METRICS[q.entity];
  const main = barMetric(q);
  const unit = M[main]?.unit || 'n';
  const label = res.label[L === 'en' ? 1 : 0];
  const cond = label.split(': ').slice(1).join(': ');
  const { model } = computedOf(ctx);
  const subj = q.scope ? { kind: q.scope.kind, ref: q.scope.ref, name: q.scope.kind === 'project' ? model.itemByRef.get(q.scope.ref)?.name || '' : q.scope.kind === 'team' ? model.teams.get(q.scope.ref)?.name || '' : dsOf(ctx).people?.[q.scope.ref]?.name || '' } : { kind: 'portfolio', ref: null, name: 'Portfolio' };
  const ent = ENTITY_NAMES[q.entity][L === 'en' ? 1 : 0];
  // the query's own thresholds ("über 100 %") are facts of the story too – an empty result names them as well
  // (live finding 2026-11-18: "Keine Personen gefunden – Personen über 100 %" had no source for the 100 %)
  const condEv = (q.where || []).filter((w) => typeof w.v === 'number').map((w) => ev(T(L, 'Schwelle', 'threshold'), w.v, M[w.m]?.unit === '%' ? '%' : M[w.m]?.unit === 'h' ? 'h' : M[w.m]?.unit === 'd' ? 'd' : 'n'));
  const winEv = [...condEv, ...(q.window?.next ? [ev(T(L, 'Wochen voraus', 'weeks ahead'), q.window.next, 'n')] : []), ...(q.window?.past ? [ev(T(L, 'Wochen zurück', 'weeks back'), q.window.past, 'n')] : []), ...(q.window?.quarter ? [ev(T(L, 'Quartal', 'quarter'), q.window.quarter, 'quarter')] : [])];
  if (!members.length) {
    return infoStory(ctx, { skill: 'query', lang: L, subject: subj, headline: T(L, `Keine ${ent} gefunden – ${cond}.`, `No ${ent} found – ${cond}.`),
      finding: T(L, `Lotse hat ${res.checked} ${ent} geprüft; keine erfüllt die Bedingung. Spätere Schritte für diese Menge haben nichts zu tun.`, `Lotse checked ${res.checked} ${ent}; none meets the condition. Later steps for this set have nothing to do.`),
      evidence: [ev(T(L, 'geprüft', 'checked'), res.checked, 'n'), ...winEv], how: { text: howText(L, q), inputs: [[T(L, 'Abfrage', 'Query'), formatQuery(q)], [T(L, 'Geprüft', 'Checked'), String(res.checked)]] } });
  }
  const s = newStory(ctx, { skill: 'query', subject: subj, lang: L });
  s.id = `query:${q.entity}:${q.where.map((w) => w.m).join('+') || 'all'}:${s.subject.ref ?? 'all'}`;
  const F = s.fmt;
  for (const m of members.slice(0, 24)) {
    if (m.kind === 'person') addPerson(s, ctx, m.id);
    else if (m.kind === 'team') addTeam(s, model, m.id);
    else if (m.kind === 'project') addProject(s, model.itemByRef.get(m.id));
  }
  const val = (m) => (q.entity === 'tickets' ? Math.abs(m.values.slaLeft) : m.values[main]);
  const toneOf = (m) => (q.entity === 'tickets' ? (m.values.sla === 'breached' ? 'bad' : 'warn') : q.entity === 'projects' ? (m.values.staffable === 'no' || m.values.daysOverdue > 14 ? 'bad' : 'warn') : q.where[0]?.op === '<' ? 'warn' : (val(m) ?? 0) >= 120 ? 'bad' : 'warn');
  const shown = members.slice(0, 24);
  s.visual = { kind: 'bars', data: { unit: unit === 'd' ? 'd' : unit === '%' ? '%' : unit === 'h' ? 'h' : 'n', items: shown.map((m) => ({ label: m.name, value: Math.min(999, Math.max(0, +(val(m) ?? 0))), tone: toneOf(m), ...(m.key ? { key: m.key } : {}), ...(m.kind === 'project' ? { ref: m.id, rank: m.rank } : {}) })), ...(main === 'load' ? { target: 100 } : main === 'booking' ? { target: members[0].target ?? 80 } : {}) },
    caption: q.entity === 'tickets' ? T(L, `Stunden über bzw. bis zum SLA je Ticket – ${label}.`, `Hours over or until the SLA per ticket – ${label}.`) : T(L, `${M[main].name[0].charAt(0).toUpperCase()}${M[main].name[0].slice(1)} je Treffer – ${label}.`, `${M[main].name[1].charAt(0).toUpperCase()}${M[main].name[1].slice(1)} per match – ${label}.`) };
  const n = res.total;
  s.kpis.push(kpi('found', T(L, 'Gefunden', 'Found'), n, 'n', { tone: n ? 'warn' : 'ok' }));
  s.kpis.push(kpi('checked', T(L, 'Geprüft', 'Checked'), res.checked, 'n'));
  for (const e of winEv) if (e.unit === 'n') s.kpis.push(kpi(`win${s.kpis.length}`, e.label.charAt(0).toUpperCase() + e.label.slice(1), e.value, 'n'));
  const top = members[0];
  s.headline = T(L, `${n} von ${res.checked} ${ent}: ${cond} – zuerst ${top.name} (${memberText(F, L, q, top)}).`, `${n} of ${res.checked} ${ent}: ${cond} – first ${top.name} (${memberText(F, L, q, top)}).`);
  for (const m of members.slice(0, 3)) s.findings.push(finding(`${m.name}: ${memberText(F, L, q, m)}.`, toneOf(m), 70 - members.indexOf(m), [...memberEvidence(L, q, m), ...winEv].slice(0, 8)));
  if (members.length > 3) s.findings.push(finding(T(L, `Dazu ${members.length - 3} weitere – alle mit ihren Zahlen in der Liste.`, `Plus ${members.length - 3} more – all with their numbers in the list.`), 'info', 20, [ev(T(L, 'weitere', 'more'), members.length - 3, 'n')]));
  s.tone = members.some((m) => toneOf(m) === 'bad') ? 'bad' : 'warn';
  s.how = { text: howText(L, q), inputs: [[T(L, 'Abfrage', 'Query'), formatQuery(q)], [T(L, 'Geprüft', 'Checked'), String(res.checked)]] };
  s.followUps.push(follow(T(L, 'Lagebild Portfolio', 'Portfolio briefing'), T(L, 'Wie steht das Portfolio?', 'How is the portfolio doing?')));
  s.confidence = 'high';
  s.sources = q.entity === 'tickets' ? ['Jira Service Management', 'SLA'] : ['Jira', T(L, 'Kapazitäten', 'Capacity')];
  return doneStory(s);
}
function howText(L, q) {
  const base = {
    people: T(L, 'Je Person die Zahlen des Cockpits: Auslastung = geplant ÷ verfügbar je Woche (wie Kapazität), Buchungsquote = Σ gebucht ÷ Σ möglich der vergangenen Wochen (wie der Buchungscheck), Abwesenheit aus den Kapazitäten.', 'Per person the cockpit\'s numbers: load = planned ÷ available per week (as in Capacity), booking rate = Σ booked ÷ Σ possible of the past weeks (as the booking check), absences from Capacity.'),
    projects: T(L, 'Je Projekt die Wasserlinie (besetzbar je Quartal, fehlend = Bedarf − besetzbar), der Termin und die Datenlücken wie im Portfolio.', 'Per project the waterline (staffable per quarter, missing = demand − staffable), the due date and the data gaps as in the portfolio.'),
    teams: T(L, 'Je Team die Auslastung wie Kapazität und die Support-Last = Worklogs auf Support-Tickets des Teams in den vergangenen Wochen; SLA-Risiko = offene Tickets mit gerissenem oder knappem SLA.', 'Per team the load as in Capacity and the support load = worklogs on the team\'s support tickets in the past weeks; SLA risk = open tickets with a breached or tight SLA.'),
    stories: T(L, 'Offene Stories im Rahmen; überfällig = Due Date vor heute; blockiert wie im Cockpit; ohne Schätzung = weder Original- noch Rest-Schätzung.', 'Open stories in the scope; overdue = due date before today; blocked as in the cockpit; without estimate = neither original nor remaining estimate.'),
    tickets: T(L, 'Offene Support-Tickets; SLA aus Jira Service Management oder der SLA-Regel der Konfiguration (knapp = 75 % der Zeit verbraucht).', 'Open support tickets; SLA from Jira Service Management or the configuration\'s SLA policy (at risk = 75% of the time used).'),
  }[q.entity];
  return `${base} ${T(L, 'Abfrage:', 'Query:')} ${formatQuery(q)}`;
}
// a frozen copy of a result for later steps (ids + the numbers that qualified them), small enough for a plan step
export function setOf(res) {
  return { entity: res.entity, query: res.q, total: res.total, checked: res.checked, label: res.label, members: res.members.map((m) => ({ id: m.id, kind: m.kind, name: m.name, values: m.values, ...(m.key ? { key: m.key } : {}), ...(m.team ? { team: m.team } : {}), ...(m.teamName ? { teamName: m.teamName } : {}), ...(m.owner ? { owner: m.owner } : {}), ...(m.target != null ? { target: m.target } : {}), keys: (m.keys || []).slice(0, 12) })) };
}
