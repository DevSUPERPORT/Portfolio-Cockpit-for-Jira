// Support dispatching, "Reicht die Reserve?" and "Wo geht die Support-Zeit hin?" (UC-17). Pure: shared by UI, server and tests.
import { targetHours, DEFAULT_SLA } from './sla.js';
import { dayIdx, mondayOf } from './dates.js';

export const GROUP_DIMS = ['requestType', 'component', 'label', 'cause'];
export const PER_TICKET_H = 4; // every suggested ticket counts with Ø 4 h for the person until it is solved
export const CRITICAL_H = 1; // "SLA kritisch": less than 60 min left (or already breached)
export const RESERVE_MAX_H = 80;
const TEAM_RE = /^[A-Za-z0-9:_-]{1,64}$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isNumId = (v) => typeof v === 'string' && /^\d{1,18}$/.test(v);

// ---------- configuration ----------
// cfg.support.dispatch = { incomingStatusIds: [], afterStatusId: null, componentTeams: { [componentName]: teamId } }
// cfg.support.timeGroupBy = 'requestType' | 'component' | 'label' | 'cause'   (default grouping of "Wo geht die Zeit hin?")
// cfg.support.causeFieldId = 'customfield_12345' | null                      (custom select field "Ursache")
export function dispatchSettings(cfg) {
  const s = cfg?.support || {};
  const d = s.dispatch && typeof s.dispatch === 'object' ? s.dispatch : {};
  return {
    incomingStatusIds: Array.isArray(d.incomingStatusIds) ? d.incomingStatusIds.map(String).filter(isNumId) : [],
    afterStatusId: isNumId(String(d.afterStatusId ?? '')) ? String(d.afterStatusId) : null,
    componentTeams: d.componentTeams && typeof d.componentTeams === 'object' ? d.componentTeams : {},
    groupBy: GROUP_DIMS.includes(s.timeGroupBy) ? s.timeGroupBy : 'requestType',
    causeFieldId: typeof s.causeFieldId === 'string' && /^customfield_\d{1,12}$/.test(s.causeFieldId) ? s.causeFieldId : null,
  };
}
// Admin write validation for exactly these keys (for validateConfig): returns { dispatch, timeGroupBy, causeFieldId }.
export function validSupportDispatch(input = {}) {
  const d = input.dispatch && typeof input.dispatch === 'object' ? input.dispatch : {};
  const componentTeams = {};
  if (d.componentTeams && typeof d.componentTeams === 'object' && !Array.isArray(d.componentTeams)) {
    for (const [k, v] of Object.entries(d.componentTeams).slice(0, 500)) {
      const name = String(k).trim().slice(0, 255);
      if (!name || BAD_KEYS.has(name) || typeof v !== 'string' || !TEAM_RE.test(v)) continue;
      componentTeams[name] = v;
    }
  }
  return {
    dispatch: {
      incomingStatusIds: [...new Set((Array.isArray(d.incomingStatusIds) ? d.incomingStatusIds : []).map(String).filter(isNumId))].slice(0, 50),
      afterStatusId: isNumId(String(d.afterStatusId ?? '')) ? String(d.afterStatusId) : null,
      componentTeams,
    },
    timeGroupBy: GROUP_DIMS.includes(input.timeGroupBy) ? input.timeGroupBy : 'requestType',
    causeFieldId: typeof input.causeFieldId === 'string' && /^customfield_\d{1,12}$/.test(input.causeFieldId) ? input.causeFieldId : null,
  };
}
// Who may assign tickets ("Support-Tickets verteilen").
export const canDispatch = (roles) => !!(roles?.dispatch ?? roles?.editCapacity ?? roles?.admin);

// ---------- which tickets are waiting to be dispatched ----------
export const componentNames = (t) => (t?.components || []).map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean);
// Open tickets in the configured incoming statuses. Without configured statuses (or without status ids in the data)
// every open ticket in the status category "To Do" counts. `otherNew` = open To-Do tickets in other statuses (hint).
export function incomingTickets(tickets, settings) {
  const open = (tickets || []).filter((t) => t.statusCat !== 'done');
  const ids = settings?.incomingStatusIds || [];
  const byId = ids.length > 0 && open.some((t) => t.statusId != null);
  const isIn = byId ? (t) => ids.includes(String(t.statusId)) : (t) => t.statusCat === 'new';
  const incoming = open.filter(isIn);
  return { incoming, otherNew: open.filter((t) => !isIn(t) && t.statusCat === 'new').length, mode: byId ? 'status' : ids.length ? 'noStatusIds' : 'category' };
}

// Most urgent first: least SLA time left (breached = negative), unknown last, then oldest.
export function sortBySla(rows) {
  const rem = (r) => (r.sla?.status === 'met' ? null : r.sla?.remainingH ?? null);
  return [...rows].sort((a, b) => {
    const x = rem(a), y = rem(b);
    if (x == null && y != null) return 1;
    if (y == null && x != null) return -1;
    return (x ?? 0) - (y ?? 0) || String(a.created || '').localeCompare(String(b.created || '')) || String(a.key).localeCompare(String(b.key));
  });
}
export const isCritical = (r) => r?.sla?.remainingH != null && r.sla.status !== 'met' && r.sla.remainingH < CRITICAL_H;
const HIGH_RE = /^(highest|high|critical|blocker|urgent|hoch|höchste|sehr hoch|kritisch|dringend)$/i;
export const isHighPriority = (priority, cal = DEFAULT_SLA) => !!priority && (HIGH_RE.test(String(priority).trim()) || targetHours(priority, cal) <= 24);

// ---------- suggestions ----------
// The team that most often resolved tickets with this component (in the loaded tickets).
export function componentHistory(tickets) {
  const m = new Map();
  for (const t of tickets || []) {
    if (t.statusCat !== 'done' || !t.team?.id) continue;
    for (const c of componentNames(t)) {
      const x = m.get(c) || m.set(c, new Map()).get(c);
      x.set(t.team.id, (x.get(t.team.id) || 0) + 1);
    }
  }
  return new Map([...m].map(([c, x]) => [c, [...x].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0][0]]));
}
// ---------- similar tickets (Lotse, tester 2026-11-17: "more smart functions for the support team") ----------
// Words of the summary (≥ 4 letters, no numbers, no filler words) plus the labels – the same words in tickets that
// already have a team point to that team. Rare words weigh more (idf), one matching ticket is named as the reason.
const STOP = new Set(['bitte', 'nicht', 'kein', 'keine', 'eine', 'einen', 'einem', 'einer', 'oder', 'und', 'with', 'from', 'that', 'this', 'have', 'does', 'what', 'when', 'wird', 'werden', 'kann', 'können', 'auch', 'noch', 'mehr', 'beim', 'nach', 'über', 'unter', 'test', 'issue', 'ticket', 'problem', 'fehler', 'error', 'help', 'hilfe', 'frage', 'question', 'request', 'anfrage', 'please', 'there', 'their', 'into', 'about', 'neue', 'neuer', 'neues', 'new']);
export function ticketTokens(t) {
  const words = String(t?.summary || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOP.has(w));
  return [...new Set([...words, ...(t?.labels || []).map((l) => `label:${String(l).toLowerCase()}`)])];
}
export function similarIndex(tickets) {
  const docs = (tickets || []).filter((t) => t.team?.id).map((t) => ({ id: t.id, key: t.key, teamId: t.team.id, tok: new Set(ticketTokens(t)) })).filter((d) => d.tok.size);
  const df = new Map();
  for (const d of docs) for (const w of d.tok) df.set(w, (df.get(w) || 0) + 1);
  return { docs, df, n: docs.length };
}
// → { teamId, key (the most similar ticket), words } | null. Needs two shared words, or one rare one (in ≤ 2 tickets).
export function similarTeam(t, idx, valid = () => true) {
  if (!idx?.n) return null;
  const tok = ticketTokens(t);
  if (!tok.length) return null;
  const byTeam = new Map();
  for (const d of idx.docs) {
    if (d.id === t.id || !valid(d.teamId)) continue;
    const shared = tok.filter((w) => d.tok.has(w));
    if (!shared.length) continue;
    const strong = shared.length >= 2 || shared.some((w) => idx.df.get(w) <= 2);
    if (!strong) continue;
    const s = shared.reduce((a, w) => a + Math.log(1 + idx.n / idx.df.get(w)), 0);
    const cur = byTeam.get(d.teamId) || { score: 0, best: null };
    cur.score += s;
    if (!cur.best || s > cur.best.s) cur.best = { s, key: d.key, words: shared.filter((w) => !w.startsWith('label:')).slice(0, 3) };
    byTeam.set(d.teamId, cur);
  }
  const ranked = [...byTeam].sort((a, b) => b[1].score - a[1].score || String(a[0]).localeCompare(String(b[0])));
  if (!ranked.length) return null;
  // a near tie between two teams is no hint
  if (ranked[1] && ranked[1][1].score > ranked[0][1].score * 0.8) return null;
  return { teamId: ranked[0][0], key: ranked[0][1].best.key, words: ranked[0][1].best.words };
}
// The team with the most free time this week (members: Map teamId → [{ plan, cap }]) – the last resort, said as such.
export function freestTeam(members, valid = () => true) {
  let best = null;
  for (const [tid, list] of members || []) {
    if (!valid(tid)) continue;
    const free = (list || []).reduce((a, p) => a + Math.max(0, (p.cap || 0) - (p.plan || 0)), 0);
    if (free > 0.5 && (!best || free > best.free)) best = { teamId: tid, free };
  }
  return best;
}

// Team: the admin's component → team mapping, else the most frequent team of resolved tickets with that component,
// else the team already on the ticket, else the team of similar tickets, else the assignee's team, else (only when
// asked for) the team with the most free time this week. `source` says which – the UI and Lotse explain it.
export function suggestTeam(t, { componentTeams = {}, history = new Map(), teamIds = null, similar = null, personTeam = null, fallback = null } = {}) {
  const valid = (id) => typeof id === 'string' && id && (!teamIds || teamIds.has(id));
  const comps = componentNames(t);
  for (const c of comps) if (Object.hasOwn(componentTeams, c) && valid(componentTeams[c])) return { teamId: componentTeams[c], source: 'mapping', component: c };
  for (const c of comps) if (valid(history.get(c))) return { teamId: history.get(c), source: 'history', component: c };
  if (valid(t.team?.id)) return { teamId: t.team.id, source: 'current', component: null };
  const sim = similar ? similarTeam(t, similar, valid) : null;
  if (sim) return { teamId: sim.teamId, source: 'similar', component: null, basis: sim.key, words: sim.words };
  const at = t.assignee?.id && personTeam ? personTeam(t.assignee.id) : null;
  if (valid(at)) return { teamId: at, source: 'assignee', component: null };
  if (fallback && valid(fallback.teamId)) return { teamId: fallback.teamId, source: 'capacity', component: null, free: fallback.free };
  return { teamId: null, source: null, component: null };
}
// Load of a person this week as in the weekly planning: planned hours ÷ capacity after support.
export const personLoad = (p, extraH = 0) => (p && p.cap > 0 ? ((p.plan || 0) + extraH) / p.cap : null);
// Assignee: the team member with the lowest load this week. Suggestions are spread – every ticket already
// suggested to someone adds PER_TICKET_H to that person. `rows` must already be sorted (most urgent first).
// members: Map teamId → [{ id, plan, cap }]. Returns Map ticketId → accountId.
export function suggestAssignees(rows, teamOf, members, perTicketH = PER_TICKET_H) {
  const extra = new Map(), out = new Map();
  for (const r of rows) {
    const list = (members.get(teamOf(r)) || []).filter((p) => p.cap > 0);
    if (!list.length) continue;
    const load = (p) => personLoad(p, extra.get(p.id) || 0);
    const best = [...list].sort((a, b) => load(a) - load(b) || String(a.id).localeCompare(String(b.id)))[0];
    out.set(r.id, best.id);
    extra.set(best.id, (extra.get(best.id) || 0) + perTicketH);
  }
  return out;
}
// Filters of the dispatch list: 'all' | 'critical' | 'high' | 'team:<id>', plus a free-text search.
export function filterDispatch(rows, { filter = 'all', q = '', teamOf = (r) => r.team?.id, cal } = {}) {
  const n = String(q || '').trim().toLowerCase();
  const f = filter === 'critical' ? isCritical
    : filter === 'high' ? (r) => isHighPriority(r.priority, cal)
      : filter.startsWith('team:') ? (r) => teamOf(r) === filter.slice(5) : () => true;
  return rows.filter(f).filter((r) => !n || `${r.key} ${r.summary} ${componentNames(r).join(' ')} ${r.status || ''}`.toLowerCase().includes(n));
}

// ---------- "Reicht die Reserve?" ----------
// Reserved h/week (automatic or manual) against Ø of the last 4 full weeks. Within ±10 % (at least 1 h) it fits.
export function reserveCheck(support, { tolerance = 0.1 } = {}) {
  return (support?.teams || []).filter((t) => t.teamId !== '_none' && (t.weekly > 0 || t.override != null || (t.trend || []).some((h) => h > 0))).map((t) => {
    const manual = t.override != null;
    const reserved = +t.weekly || 0;
    const auto = manual ? +t.autoWeekly || 0 : reserved;
    const last4 = (t.trend || []).slice(-4);
    const recent = last4.length ? last4.reduce((a, x) => a + (x || 0), 0) / 4 : 0;
    const diff = recent - reserved;
    const band = Math.max(1, reserved * tolerance);
    const verdict = Math.abs(diff) <= band ? 'ok' : diff > 0 ? 'low' : 'high';
    const recommend = Math.max(0, Math.min(RESERVE_MAX_H, Math.round(recent)));
    return { teamId: t.teamId, reserved, auto, manual, recent, diff, verdict, recommend, canApply: verdict !== 'ok' && recommend !== reserved, spike: !!t.spike, avg: t.avg || 0 };
  });
}

// ---------- "Wo geht die Support-Zeit hin?" ----------
const GENERIC_RT = /^(e-?mail[ -]?(request|anfrage)|anfrage per e-?mail|get it help|it-hilfe( (anfordern|erhalten))?|sonstiges|other|others|general (request|question)|allgemeine (anfrage|frage))$/i;
export const isGenericRequestType = (s) => GENERIC_RT.test(String(s || '').trim());
const nameOf = (v) => (v && typeof v === 'object' ? v.value ?? v.name ?? null : v);
export function valuesOf(t, dim, ignoreLabels = new Set()) {
  if (dim === 'requestType') { const v = nameOf(t.requestType); return v && !isGenericRequestType(v) ? [String(v)] : []; }
  if (dim === 'component') return componentNames(t);
  if (dim === 'label') return (t.labels || []).filter((l) => !ignoreLabels.has(l));
  if (dim === 'cause') { const v = Array.isArray(t.cause) ? t.cause.map(nameOf) : [nameOf(t.cause)]; return v.filter(Boolean).map(String); }
  return [];
}
// Which groupings the data supports (a grouping without data is hidden in the UI).
export function availableDims(tickets, { causeFieldId, ignoreLabels = [] } = {}) {
  const ts = tickets || [];
  const ign = new Set(ignoreLabels);
  return {
    requestType: ts.some((t) => t.requestType !== undefined),
    component: ts.some((t) => t.components !== undefined),
    label: ts.some((t) => (t.labels || []).some((l) => !ign.has(l))), // only queue labels = nothing to group by
    cause: !!causeFieldId && ts.some((t) => t.cause !== undefined),
  };
}
// Hours of one ticket in [from, to] (day indices). Exact with dated worklogs; otherwise the whole Time Spent of
// tickets still open or resolved in the window (approximation, flagged).
export function hoursInWindow(t, from, to) {
  if (Array.isArray(t.worklogs)) {
    let h = 0;
    for (const w of t.worklogs) { const d = dayIdx(w.d); if (d != null && d >= from && d <= to) h += +w.h || 0; }
    return { h, exact: true };
  }
  const r = dayIdx(t.resolved);
  const inWin = t.statusCat !== 'done' ? true : r != null && r >= from && r <= to;
  return { h: inWin ? +t.spentH || 0 : 0, exact: false };
}
// Groups the support time of the last `weeks` full weeks. Multi-valued fields (components, labels) split a ticket's
// hours evenly, so the shares add up to 100 %. Empty field or a generic request type = "Ohne Zuordnung" (key '').
export function timeByGroup(tickets, { dim = 'requestType', today, weeks = 4, ignoreLabels = [] } = {}) {
  const t0 = typeof today === 'number' ? today : dayIdx(today);
  const to = mondayOf(t0) - 1, from = mondayOf(t0) - weeks * 7;
  const ign = new Set(ignoreLabels);
  const subDim = dim === 'component' ? 'requestType' : 'component';
  const groups = new Map();
  let exact = true;
  for (const t of tickets || []) {
    const { h, exact: ex } = hoursInWindow(t, from, to);
    if (!(h > 0)) continue;
    if (!ex) exact = false;
    const vals = [...new Set(valuesOf(t, dim, ign))];
    const keys = vals.length ? vals : [''];
    const part = h / keys.length;
    const subs = valuesOf(t, subDim, ign);
    for (const k of keys) {
      const g = groups.get(k) || groups.set(k, { key: k, tickets: 0, hours: 0, teams: new Map(), services: new Set(), sub: new Map() }).get(k);
      g.tickets++; g.hours += part;
      const tid = t.team?.id || '_none';
      g.teams.set(tid, (g.teams.get(tid) || 0) + part);
      for (const s of t.services || []) g.services.add(s);
      for (const s of subs) g.sub.set(s, (g.sub.get(s) || 0) + part / subs.length);
    }
  }
  const total = [...groups.values()].reduce((a, g) => a + g.hours, 0);
  const rows = [...groups.values()].map((g) => ({
    key: g.key, none: g.key === '', tickets: g.tickets, hours: g.hours, share: total > 0 ? g.hours / total : 0,
    teams: [...g.teams].sort((a, b) => b[1] - a[1]).map(([id]) => id), services: [...g.services],
    sub: [...g.sub].sort((a, b) => b[1] - a[1]).map(([s]) => s).slice(0, 4),
    recurring: g.key !== '' && g.tickets >= 6 && g.hours >= 8,
  })).sort((a, b) => (a.none - b.none) || b.hours - a.hours || a.key.localeCompare(b.key));
  return { rows, total, none: rows.find((r) => r.none) || null, exact, dim, subDim, from, to };
}

// ---------- SLA per service space ----------
// Ø resolution time (SLA hours) of resolved tickets per service, from the ticket analytics rows.
export function meanResolveByService(rows) {
  const m = new Map();
  for (const r of rows || []) {
    if (!r.resolved || r.sla?.elapsedH == null) continue;
    for (const s of r.services || []) { const x = m.get(s) || m.set(s, { n: 0, h: 0 }).get(s); x.n++; x.h += r.sla.elapsedH; }
  }
  return new Map([...m].map(([s, x]) => [s, x.h / x.n]));
}

// ---------- server-side input validation ----------
export const ACCOUNT_RE = /^[A-Za-z0-9:_-]{1,128}$/;
export const DISPATCH_MAX = 50;
// dispatch items: { issueId, teamId?, accountId? } (at least one of team/assignee). Throws Error('...') on bad input.
export function validDispatchItems(items, { undo = false } = {}) {
  if (!Array.isArray(items) || !items.length || items.length > DISPATCH_MAX) throw new Error(`items: 1–${DISPATCH_MAX} required`);
  const seen = new Set();
  return items.map((x) => {
    if (!x || typeof x !== 'object') throw new Error('item invalid');
    const issueId = String(x.issueId ?? '');
    if (!isNumId(issueId) || seen.has(issueId)) throw new Error('issueId invalid');
    seen.add(issueId);
    const teamId = x.teamId ?? x.teamFieldValue;
    const team = teamId == null ? null : String(teamId);
    if (team != null && !TEAM_RE.test(team)) throw new Error('teamId invalid');
    const acc = x.accountId == null ? null : String(x.accountId);
    if (acc != null && !ACCOUNT_RE.test(acc)) throw new Error('accountId invalid');
    if (!undo) {
      if (team == null && acc == null) throw new Error('teamId or accountId required');
      return { issueId, teamId: team, accountId: acc };
    }
    // undo: the exact values before (null = was empty); statusId = the status to go back to
    const statusId = x.statusId == null ? null : String(x.statusId);
    if (statusId != null && !isNumId(statusId)) throw new Error('statusId invalid');
    return { issueId, teamId: team, accountId: acc, statusId, restoreTeam: x.restoreTeam !== false, restoreAssignee: x.restoreAssignee !== false };
  });
}
export function validReserve(p) {
  const teamId = String(p?.teamId ?? '');
  if (!TEAM_RE.test(teamId) || BAD_KEYS.has(teamId)) throw new Error('teamId invalid');
  const hours = p?.hours;
  if (hours === null) return { teamId, hours: null };
  const h = Number(hours);
  if (typeof hours !== 'number' || !Number.isFinite(h) || h < 0 || h > RESERVE_MAX_H) throw new Error(`hours: 0–${RESERVE_MAX_H} or null`);
  return { teamId, hours: Math.round(h * 2) / 2 };
}
