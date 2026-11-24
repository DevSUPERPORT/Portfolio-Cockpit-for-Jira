// Lotse – small helpers every skill shares: the story builder, entities, the per-dataset cache and lookups.
import { computeAll } from '../engine.js';
import { realisticCapacity, overtimeOutlook } from '../insights.js';
import { fmtOf, T, say } from './narrate.js';

export { T, say };
export const r0 = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
export const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
export const pctPts = (f) => (Number.isFinite(f) ? Math.round(f * 100) : 0); // fraction → whole percent points
export const sum = (a, f = (x) => x) => a.reduce((s, x) => s + (f(x) || 0), 0);
export const isOpen = (i) => (i?.status?.cat ?? i?.statusCat ?? 'new') !== 'done';
export const TONE_RANK = { info: 0, muted: 0, ink: 0, ok: 1, warn: 2, bad: 3 };
export const worst = (...ts) => ts.flat().filter(Boolean).reduce((a, t) => (TONE_RANK[t] > TONE_RANK[a] ? t : a), 'ok');
export const utilTone = (u) => (u == null || !Number.isFinite(u) ? 'bad' : u > 1.0001 ? 'bad' : u > 0.85 ? 'warn' : 'ok');

// ---------- context ----------
const cache = new WeakMap();
export function computedOf(ctx) {
  if (ctx.computed) return ctx.computed;
  if (!ctx.__computed) Object.defineProperty(ctx, '__computed', { value: computeAll(ctx.ds), enumerable: false });
  return ctx.__computed;
}
export const dsOf = (ctx) => ctx.ds || computedOf(ctx).model.ds;
// A value computed elsewhere for exactly this data state (the browser's compute worker computes realistic capacity
// and the overtime outlook next to computeAll, lib/computeWorker.js), so the first question does not wait for it.
// key as memo builds it: `${key}|${history ? 'h' : '-'}|${planActual ? 'p' : '-'}`.
export function seedMemo(computed, fullKey, value) {
  if (!computed || value == null) return;
  const m = cache.get(computed) || cache.set(computed, new Map()).get(computed);
  if (!m.has(fullKey)) m.set(fullKey, value);
}
export function memo(ctx, key, fn) {
  const c = computedOf(ctx);
  const m = cache.get(c) || cache.set(c, new Map()).get(c);
  const k = `${key}|${ctx.history ? 'h' : '-'}|${ctx.planActual ? 'p' : '-'}`;
  if (!m.has(k)) m.set(k, fn());
  return m.get(k);
}
export const rcOf = (ctx, lang) => memo(ctx, `rc:${lang}`, () => realisticCapacity(computedOf(ctx), { weeks: 12, history: ctx.history || null, planActual: ctx.planActual || null, lang }));
export const ooOf = (ctx, lang) => memo(ctx, `oo:${lang}`, () => overtimeOutlook(rcOf(ctx, lang), { lang }));
export const todayIso = (ctx) => dsOf(ctx).today;
export const nowIso = (ctx) => new Date(Number.isFinite(ctx?.now) ? ctx.now : Date.now()).toISOString();

// ---------- names ----------
export const teamName = (model, id) => (id === '_none' || !id ? null : model.teams.get(id)?.name || id);
export const personName = (ctx, id) => (id ? dsOf(ctx).people?.[id]?.name || null : null);
export const projectOf = (model, ref) => model.itemByRef.get(ref) || null;
export const isLatin = (s) => typeof s === 'string' && s.trim().length > 0;

// A sentence continued after a dash: German keeps its capitals (nouns), English lowercases an ordinary first word –
// never a name, a key or an acronym.
export function lc1(text, s, lang) {
  const t = String(text || '');
  if (lang !== 'en' || !/^[A-Z][a-z]/.test(t)) return t;
  const e = s.entities || {};
  const names = [...(e.projects || []).map((p) => p.name), ...(e.teams || []).map((x) => x.name), ...(e.people || []).map((x) => x.name), ...(e.texts || [])];
  if (names.some((n) => n && t.startsWith(n)) || /^Team\b/.test(t)) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

// ---------- the story builder ----------
export function newStory(ctx, { skill, subject, lang }) {
  const sub = { kind: subject.kind, ref: subject.ref ?? null, name: subject.name };
  return {
    id: `${skill}:${sub.ref ?? sub.kind}`, skill, subject: sub, lang, computedAt: nowIso(ctx), tone: 'info', headline: '', kpis: [],
    visual: null, findings: [], actions: [], followUps: [], how: { text: '', inputs: [] }, confidence: 'medium', sources: ['Jira'],
    entities: { projects: [], teams: [], people: [] },
    fmt: fmtOf(ctx, lang),
  };
}
export function addProject(s, it) {
  if (it && !s.entities.projects.some((p) => p.ref === it.ref)) s.entities.projects.push({ ref: it.ref, key: it.key || null, rank: it.rank ?? null, name: it.name });
  return it?.name || '';
}
export function addTeam(s, model, id) {
  const name = teamName(model, id);
  if (name && !s.entities.teams.some((t) => t.id === id)) s.entities.teams.push({ id, name });
  return name;
}
export function addPerson(s, ctx, id) {
  const name = personName(ctx, id);
  if (name && !s.entities.people.some((p) => p.id === id)) s.entities.people.push({ id, name });
  return name;
}
export const kpi = (id, label, value, unit, extra = {}) => ({ id, label, value: unit === 'h' ? r1(value) : Math.round(value * 10) / 10, unit, ...extra });
export const ev = (label, value, unit, extra = {}) => ({ label, ...(value !== undefined && value !== null ? { value: typeof value === 'number' ? (unit === 'n' ? Math.round(value * 100) / 100 : r1(value)) : value } : {}), ...(unit ? { unit } : {}), ...extra });
export const finding = (text, tone, impact, evidence = []) => ({ text: String(text).replace(/\.\.$/, '.'), tone, impact: Math.max(0, Math.min(100, Math.round(impact))), evidence: evidence.slice(0, 8) });
export const action = (id, label, kind, payload, preview) => ({ id, label, kind, payload, preview, undoable: true });
export const follow = (label, text) => ({ label, text });

// Sorted, capped, clean – the last step of every skill.
export function done(s) {
  const out = { ...s };
  delete out.fmt;
  out.findings = [...s.findings].sort((a, b) => b.impact - a.impact).slice(0, 4);
  out.actions = s.actions.slice(0, 3);
  const seen = new Set();
  out.followUps = s.followUps.filter((f) => (seen.has(f.text) ? false : seen.add(f.text))).slice(0, 4);
  out.kpis = s.kpis.slice(0, 4);
  out.headline = String(s.headline).replace(/\.\.$/, '.');
  const e = s.entities;
  if (!e.projects.length && !e.teams.length && !e.people.length && !(e.texts || []).length) delete out.entities;
  return out;
}

// An honest story when data is missing: tone info, what is missing and where to get it – never filler.
export function infoStory(ctx, { skill, lang, subject, headline, finding: text, evidence = [], why, followUps = [], actions = [], visual = null, how = null }) {
  const s = newStory(ctx, { skill, subject: subject || { kind: 'topic', ref: null, name: skill }, lang });
  s.tone = 'info';
  s.headline = headline;
  s.visual = visual || { kind: 'donut', data: { unit: 'n', total: 0, items: [{ label: T(lang, 'keine Daten', 'no data'), value: 0, tone: 'muted' }] }, caption: T(lang, 'Für diese Frage liegen noch keine Daten vor.', 'There is no data for this question yet.') };
  s.findings = [finding(text, 'info', 10, evidence)];
  s.actions = actions;
  s.followUps = followUps;
  s.how = how || { text: why || text, inputs: [] };
  s.confidence = 'low';
  return done(s);
}

// A project from params / memory / the person's own projects / the most urgent one – in that order.
export function pickProject(ctx, params) {
  const { model, metrics } = computedOf(ctx);
  if (params?.ref && model.itemByRef.has(params.ref)) return model.itemByRef.get(params.ref);
  if (params?.key) { const it = model.items.find((p) => p.key === params.key); if (it) return it; }
  return null;
}
export function urgentProject(ctx) {
  const { model, metrics, wl } = computedOf(ctx);
  const q0 = wl.quarters[0];
  const score = (p) => { const m = metrics.get(p.ref); return (m.daysOverdue > 0 ? 100 + m.daysOverdue : 0) + (p.health?.status === 'critical' ? 60 : p.health?.status === 'atRisk' ? 20 : 0) + (wl.projectQ[p.ref]?.[q0]?.status === 'no' ? 40 : wl.projectQ[p.ref]?.[q0]?.status === 'partial' ? 15 : 0) + m.overdueCount * 3; };
  const open = model.items.filter((p) => !metrics.get(p.ref)?.done);
  const mine = ctx.me?.id ? open.filter((p) => p.owner?.id === ctx.me.id) : [];
  return [...(mine.length ? mine : open)].sort((a, b) => score(b) - score(a) || a.rank - b.rank)[0] || null;
}
