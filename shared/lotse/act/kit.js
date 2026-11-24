// Lotse acts – shared helpers of the command registry, the bulk parser and the workflow engine.
// Pure: no React, no Forge. Everything that writes goes through the injected io (see commands.js).
import { fold } from '../../ask.js';
import { canPlan } from '../../weekPlan.js';
import { canDispatch } from '../../dispatch.js';
import { dayIdx, isoOf, mondayOf } from '../../dates.js';
import { isoWeekNo } from '../story.js';
import { T, hash, fmtOf, plural, list, healthName } from '../narrate.js';
import { computedOf, dsOf } from '../kit.js';

export { T, fold, plural, list, healthName, computedOf, dsOf, isoWeekNo };
export const langOf = (ctx) => (ctx?.lang === 'en' ? 'en' : 'de');
export const fmt = (ctx) => fmtOf(ctx, langOf(ctx));
export const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
export const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);

// ---------- errors ----------
// code: INVALID (params) · NO_ACCESS (rights) · PREVIEW_REQUIRED · STALE_PREVIEW (data or params changed since the
// preview) · BLOCKED (the preview said no) · UNKNOWN_COMMAND · NOT_READY (workflow step) · NO_IO
export class ActError extends Error {
  constructor(code, message, extra = {}) { super(message || code); this.code = code; Object.assign(this, extra); }
}
export const invalid = (what, why = '') => new ActError('INVALID', `invalid ${what}${why ? `: ${why}` : ''}`, { field: what });

// ---------- the preview token ----------
// stable JSON (sorted keys) – the same params give the same token whatever order the UI built them in
export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined && typeof v[k] !== 'function').map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export function tokenOf(...parts) {
  const s = parts.map(stable).join('|');
  return hash(s).toString(16).padStart(8, '0') + hash(`${s.length}#${s}`).toString(16).padStart(8, '0');
}

// ---------- rights (mirror of the server's checks; the server decides in the end) ----------
const rolesOf = (ctx) => ctx?.roles || {};
export const meId = (ctx) => ctx?.me?.id || null;
const hasRight = (ctx, flag, right) => { const r = rolesOf(ctx); return !!(r[flag] || (right && (r.rights || []).includes(right)) || r.admin); };
export const ownsProject = (ctx, ref) => { const it = computedOf(ctx).model.itemByRef.get(ref); return !!(it && meId(ctx) && it.owner?.id === meId(ctx)); };
export const can = {
  rank: (ctx) => hasRight(ctx, 'manageRanking', 'a_rank'),
  plan: (ctx) => canPlan(rolesOf(ctx)) || hasRight(ctx, 'editPlan', 'a_plan'),
  capacity: (ctx) => hasRight(ctx, 'editCapacity', 'a_cap'),
  dispatch: (ctx) => canDispatch(rolesOf(ctx)) || hasRight(ctx, 'dispatch', 'a_disp'),
  healthAny: (ctx) => hasRight(ctx, 'editHealth', 'a_health') || hasRight(ctx, 'manageRanking', 'a_rank'),
  health: (ctx, ref) => ownsProject(ctx, ref) || can.healthAny(ctx),
  report: (ctx) => hasRight(ctx, 'viewReport', 'report'),
  // issue edits: Jira decides per work item; the cockpit lets planners, capacity editors, the project's owner and the
  // assignee (own work) do it – a plain viewer is refused before anything is sent
  edit: (ctx, issue) => can.plan(ctx) || can.capacity(ctx) || (issue && (ownsProject(ctx, issue.rootRef) || (meId(ctx) && issue.assignee?.id === meId(ctx)))),
  remind: (ctx) => !!rolesOf(ctx).admin || can.capacity(ctx),
};
export const noAccess = (L, what) => T(L, `Dafür fehlt dir das Recht „${what[0]}“.`, `You lack the right "${what[1]}" for this.`);

// ---------- names ----------
export const teamLabel = (ctx, id) => (id ? computedOf(ctx).model.teams.get(id)?.name || null : null);
export const personLabel = (ctx, id) => (id ? dsOf(ctx).people?.[id]?.name || null : null);
export const projectLabel = (ctx, ref) => computedOf(ctx).model.itemByRef.get(ref)?.name || null;
export function issueOf(ctx, idOrKey) {
  if (idOrKey == null) return null;
  const s = String(idOrKey);
  const { model } = computedOf(ctx);
  return model.byId.get(s) || byKeyIndex(dsOf(ctx).issues || [], s.toUpperCase()) || null;
}
// key → the first work item with that key, indexed once per issues array (rebuilt when its length changes)
const keyIndex = new WeakMap();
export function byKeyIndex(list, key) {
  let ix = keyIndex.get(list);
  if (!ix || ix.n !== list.length) {
    ix = { n: list.length, map: new Map() };
    for (const i of list) if (i && !ix.map.has(i.key)) ix.map.set(i.key, i);
    keyIndex.set(list, ix);
  }
  const hit = ix.map.get(key);
  return hit && hit.key === key ? hit : hit ? list.find((i) => i.key === key) || null : null;
}

// ---------- fields (human words only – never a Jira field id) ----------
export const FIELDS = {
  estimate: { usage: 'originalEstimate', kind: 'hours', name: ['Schätzung', 'Estimate'], get: (i) => (i.oe > 0 ? i.oe : null) },
  team: { usage: 'team', kind: 'team', name: ['Team', 'Team'], get: (i) => i.team?.id || null },
  assignee: { usage: null, kind: 'person', name: ['Bearbeiter', 'Assignee'], get: (i) => i.assignee?.id || null },
  start: { usage: 'startDate', kind: 'date', name: ['Startdatum', 'Start date'], get: (i) => i.start || null },
  due: { usage: 'dueDate', kind: 'date', name: ['Fälligkeitsdatum', 'Due date'], get: (i) => i.due || null },
  tshirt: { usage: 'tshirt', kind: 'tshirt', name: ['T-Shirt-Größe', 'T-shirt size'], get: (i) => i.tshirt || null },
  quarters: { usage: 'targetQuarters', kind: 'quarters', name: ['Ziel-Quartale', 'Target quarters'], get: (i) => (i.quarters?.length ? [...i.quarters].sort() : null) },
};
export const FIELD_IDS = Object.keys(FIELDS);
export const fieldOfUsage = (usage) => FIELD_IDS.find((f) => FIELDS[f].usage === usage) || null;
export const fieldName = (f, L) => (FIELDS[f] ? FIELDS[f].name[L === 'en' ? 1 : 0] : f);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const validIso = (s) => typeof s === 'string' && DATE_RE.test(s) && isoOf(dayIdx(s)) === s;
const Q_RE = /^\d{4}-Q[1-4]$/;
// A value for a field, cleaned – or throws INVALID. null = clear the field.
export function cleanValue(ctx, field, v) {
  const meta = FIELDS[field];
  if (!meta) throw invalid('field');
  if (v === null || v === undefined || v === '') return null;
  const { model } = computedOf(ctx);
  switch (meta.kind) {
    case 'hours': { const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.')); if (!Number.isFinite(n) || n <= 0 || n > 10000) throw invalid('value', 'hours 0–10000'); return Math.round(n * 4) / 4; }
    case 'team': { if (typeof v !== 'string' || !model.teams.has(v)) throw invalid('value', 'unknown team'); return v; }
    case 'person': { if (typeof v !== 'string' || !dsOf(ctx).people?.[v]) throw invalid('value', 'unknown person'); return v; }
    case 'date': { if (!validIso(v)) throw invalid('value', 'ISO date'); return v; }
    case 'tshirt': {
      const sizes = (model.cfg.tshirtSizes || []).map((t) => String(t.key).toUpperCase());
      const k = String(v).trim().toUpperCase();
      if (!sizes.includes(k)) throw invalid('value', 'unknown size');
      return k;
    }
    case 'quarters': {
      const a = (Array.isArray(v) ? v : [v]).map(String);
      if (!a.length || a.length > 8 || !a.every((q) => Q_RE.test(q))) throw invalid('value', 'quarters');
      return [...new Set(a)].sort();
    }
    default: throw invalid('field');
  }
}
export function valueText(ctx, field, v) {
  const L = langOf(ctx), F = fmt(ctx);
  if (v == null || (Array.isArray(v) && !v.length)) return T(L, 'leer', 'empty');
  switch (FIELDS[field]?.kind) {
    case 'hours': return F.h(v, 1);
    case 'team': return teamLabel(ctx, v) || T(L, 'unbekanntes Team', 'unknown team');
    case 'person': return personLabel(ctx, v) || T(L, 'unbekannte Person', 'unknown person');
    case 'date': return F.date(v);
    case 'quarters': return v.map((q) => F.quarter(q)).join(', ');
    default: return String(v);
  }
}

// ---------- ISO weeks ----------
export function weekKeyOf(idx) {
  const thu = mondayOf(idx) + 3;
  return `${isoOf(thu).slice(0, 4)}-W${String(isoWeekNo(isoOf(idx))).padStart(2, '0')}`;
}
export function weekRangeOf(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const jan4 = dayIdx(`${m[1]}-01-04`);
  const a = mondayOf(jan4) + (+m[2] - 1) * 7;
  return [a, a + 6];
}

// ---------- selecting work items ----------
export const LEVEL_ROLES = { story: ['estimate'], epic: ['structure'], workstream: ['rough'], subtask: ['tiny'], any: null };
const LEVEL_NAME = { story: ['Stories', 'stories'], epic: ['Epics', 'epics'], workstream: ['Workstreams', 'workstreams'], subtask: ['Sub-Tasks', 'sub-tasks'], any: ['Vorgänge', 'work items'] };
// filter = { project: ref|ref[], team: id|'_none', assignee: accountId|'_none'|'me', missing: field, status: 'open'|'new'|
//            'indeterminate'|'done'|'blocked'|'all', week: 'YYYY-Www', overdue: true, keys: [], issueIds: [], level: 'story'|… }
export function cleanFilter(ctx, f) {
  if (f == null) return null;
  if (typeof f !== 'object' || Array.isArray(f)) throw invalid('filter');
  const { model } = computedOf(ctx);
  const out = {};
  if (f.project != null) { const refs = [].concat(f.project).map(String); if (!refs.length || refs.some((r) => !model.itemByRef.has(r))) throw invalid('filter.project'); out.project = refs.length === 1 ? refs[0] : refs; }
  if (f.team != null) { if (f.team !== '_none' && !model.teams.has(f.team)) throw invalid('filter.team'); out.team = f.team; }
  if (f.assignee != null) { if (!['_none', 'me'].includes(f.assignee) && !dsOf(ctx).people?.[f.assignee]) throw invalid('filter.assignee'); out.assignee = f.assignee; }
  if (f.missing != null) { if (!FIELDS[f.missing]) throw invalid('filter.missing'); out.missing = f.missing; }
  if (f.status != null) { if (!['open', 'new', 'indeterminate', 'done', 'blocked', 'all'].includes(f.status)) throw invalid('filter.status'); out.status = f.status; }
  if (f.week != null) { if (!weekRangeOf(f.week)) throw invalid('filter.week'); out.week = f.week; }
  if (f.overdue) out.overdue = true;
  if (f.level != null) { if (!Object.hasOwn(LEVEL_ROLES, f.level)) throw invalid('filter.level'); out.level = f.level; }
  if (f.keys != null) { if (!Array.isArray(f.keys) || f.keys.length > 500) throw invalid('filter.keys'); out.keys = f.keys.map((k) => String(k).toUpperCase()); }
  if (f.issueIds != null) { if (!Array.isArray(f.issueIds) || f.issueIds.length > 500) throw invalid('filter.issueIds'); out.issueIds = f.issueIds.map(String); }
  if (!Object.keys(out).length) throw invalid('filter', 'empty – a filter must narrow the selection');
  return out;
}
// the same order as String(a).localeCompare(String(b), undefined, { numeric: true }) – one collator instead of one per call
const KEY_COLLATOR = new Intl.Collator(undefined, { numeric: true });
const byKey = (a, b) => KEY_COLLATOR.compare(String(a.key), String(b.key));
export function selectIssues(ctx, f = {}) {
  const ds = dsOf(ctx);
  const { model } = computedOf(ctx);
  const explicit = !!(f.keys || f.issueIds);
  const roles = explicit && !f.level ? null : LEVEL_ROLES[f.level || 'story'];
  const refs = f.project ? new Set([].concat(f.project)) : null;
  const keys = f.keys ? new Set(f.keys) : null, ids = f.issueIds ? new Set(f.issueIds) : null;
  const status = f.status || (explicit ? 'all' : 'open');
  const wk = f.week ? weekRangeOf(f.week) : null;
  const me = meId(ctx);
  return (ds.issues || []).filter((i) => {
    if (explicit && !(keys?.has(i.key) || ids?.has(i.id))) return false;
    if (roles && !roles.includes(i.role)) return false;
    if (refs && !refs.has(i.rootRef)) return false;
    if (f.team !== undefined && (i.team?.id || '_none') !== f.team) return false;
    if (f.assignee !== undefined && (i.assignee?.id || '_none') !== (f.assignee === 'me' ? me : f.assignee)) return false;
    const cat = i.status?.cat ?? i.statusCat ?? 'new';
    if (status === 'open' && cat === 'done') return false;
    if (['new', 'indeterminate', 'done'].includes(status) && cat !== status) return false;
    if (status === 'blocked' && !(cat !== 'done' && model.isBlocked(i))) return false;
    if (f.missing && FIELDS[f.missing].get(i) != null) return false;
    if (wk) {
      const s = dayIdx(i.start || i.due), e = dayIdx(i.due || i.start);
      if (s == null || e == null || Math.max(s, e) < wk[0] || Math.min(s, e) > wk[1]) return false;
    }
    if (f.overdue && !(i.due && dayIdx(i.due) < model.today && cat !== 'done')) return false;
    return true;
  }).sort(byKey);
}
// "offene Stories ohne Team in Glasfaser-Netzausbau, Bearbeiter Anna Becker, KW 48"
export function describeFilter(ctx, f = {}) {
  const L = langOf(ctx);
  if (f.keys || f.issueIds) {
    const ks = f.keys || f.issueIds.map((id) => issueOf(ctx, id)?.key || id);
    return list(ks, L, 4);
  }
  const lv = LEVEL_NAME[f.level || 'story'][L === 'en' ? 1 : 0];
  const st = { open: T(L, 'offene', 'open'), done: T(L, 'erledigte', 'done'), blocked: T(L, 'blockierte', 'blocked'), new: T(L, 'neue', 'new'), indeterminate: T(L, 'laufende', 'in-progress'), all: T(L, 'alle', 'all') }[f.status || 'open'];
  const bits = [`${st} ${lv}`];
  if (f.missing) bits.push(T(L, `ohne ${fieldName(f.missing, L)}`, `without ${fieldName(f.missing, L).toLowerCase()}`));
  if (f.project) bits.push(T(L, `in ${[].concat(f.project).map((r) => projectLabel(ctx, r)).join(', ')}`, `in ${[].concat(f.project).map((r) => projectLabel(ctx, r)).join(', ')}`));
  if (f.team) bits.push(f.team === '_none' ? T(L, 'ohne Team', 'without a team') : T(L, `von Team ${teamLabel(ctx, f.team)}`, `of team ${teamLabel(ctx, f.team)}`));
  if (f.assignee) bits.push(f.assignee === '_none' ? T(L, 'ohne Bearbeiter', 'unassigned') : f.assignee === 'me' ? T(L, 'von mir', 'of mine') : T(L, `von ${personLabel(ctx, f.assignee)}`, `of ${personLabel(ctx, f.assignee)}`));
  if (f.week) bits.push(T(L, `in KW ${+f.week.slice(-2)}`, `in week ${+f.week.slice(-2)}`));
  if (f.overdue) bits.push(T(L, 'überfällig', 'overdue'));
  return bits.join(' ');
}

// ---------- numbers in texts must stand in the facts (the selfCheck idea for decide steps and previews) ----------
// Removes what is not a measured number (keys, dates, quarters, week numbers), then every number left must be one of
// the facts' values (rounded the way the text shows it).
export function unsourcedNumbers(text, facts = []) {
  const t = String(text || '')
    .replace(/\b[A-Z][A-Z0-9_]{0,19}-\d{1,9}\b/g, ' ')
    .replace(/\bQ[1-4] \d{4}\b|\b\d{4}-Q[1-4]\b|\b\d{4}-W\d{2}\b|\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b(KW|week|Woche|W)\s?\d{1,2}\b/gi, ' ')
    .replace(/\b\d{1,2}\.? (Jan|Feb|Mär|Mar|Apr|Mai|May|Jun|Jul|Aug|Sep|Sept|Okt|Oct|Nov|Dez|Dec)\.?( \d{4})?/g, ' ')
    // US order ("Oct 22", "Oct 22, 2026") – an en-US Jira locale formats dates this way (live finding 2026-11-19)
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? \d{1,2}(, \d{4})?\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, ' ')
    .replace(/\b\d{1,2}\.\d{1,2}\.(\d{2,4})?/g, ' ');
  const vals = facts.map((f) => (typeof f === 'number' ? f : f?.value)).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const bad = [];
  for (const m of t.matchAll(/(?<![\w.,])(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?![\w])/g)) {
    const raw = m[1];
    const cands = new Set([Number(raw.replace(/\./g, '').replace(',', '.')), Number(raw.replace(/,/g, '')), Number(raw.replace(',', '.'))].filter(Number.isFinite));
    const ok = [...cands].some((n) => vals.some((v) => Math.abs(v - n) < 0.051 || Math.abs(Math.round(v) - n) < 0.001 || Math.abs(Math.abs(v) - n) < 0.051));
    if (!ok) bad.push(raw);
  }
  return bad;
}
export const fact = (label, value, unit) => ({ label, value, unit });
