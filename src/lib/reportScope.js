// The C-level report, its history and plan vs. actual are computed AS THE APP over every portfolio item (one snapshot
// for everyone). Each caller may only get the portfolio items they can browse – exactly what the Portfolio shows them
// (it reads as the user). This module decides that and recomputes the report for the visible items.
//
//   visibleRefs(accountId, refs, deps)  which refs ('issue:<id>' / 'space:<id>') the caller may browse – asked AS THE
//                                       USER (one JQL search per 100 work items, one project read per space), cached
//                                       per account for a few minutes; any doubt counts as hidden (fail closed)
//   callerScope(order, visible, refs)   { visible, hidden, rank } – rank = the dense rank the Portfolio shows the caller
//   reportRefs(report)                  every portfolio ref a stored report mentions
//   scopeDataset(ds, visible)           the app dataset restricted to the visible items, their work items and their
//                                       dependencies; ranks dense again (1..n) – as the Portfolio numbers them
//   scopedReport(ds, cfg, pa)           cLevelReport + reportExtras of such a dataset: every total, rank, the waterline
//                                       and plan vs. actual recomputed – never rows stripped from the full totals
//   hiddenTerms(report, hidden)         names, keys and refs of hidden items (to keep them out of what a caller sends on)
//   mentions(text, terms)               the terms a text contains
//
// Pure except visibleRefs, whose Jira access comes in as deps (tests pass a fake Jira).
import { cLevelReport, computeAll } from '../../shared/engine.js';
import { reportExtras } from '../../shared/reportKpis.js';

export const VISIBILITY_TTL_MS = 3 * 60e3;
const MAX_ACCOUNTS = 500;
const memo = new Map(); // accountId → Map(ref → { v, at })

const chunkOf = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
async function poolOf(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } }));
}
const definite = (e) => [400, 401, 403, 404].includes(e?.status);

// deps: { jira(as, path, opts), searchAll(as, jql, fields), now?, cache? (a Map, tests), ttl? }
export async function visibleRefs(accountId, refs, deps) {
  const { jira, searchAll, now = Date.now(), ttl = VISIBILITY_TTL_MS } = deps;
  const cache = deps.cache || memo;
  const list = [...new Set((refs || []).filter((r) => typeof r === 'string' && /^(issue|space):\d{1,18}$/.test(r)))];
  const out = new Set();
  if (!accountId || !list.length) return out;
  let mine = cache.get(accountId);
  if (!mine) {
    if (cache.size >= MAX_ACCOUNTS) for (const [k, m] of cache) if ([...m.values()].every((x) => now - x.at > ttl)) cache.delete(k);
    mine = new Map();
    cache.set(accountId, mine);
  }
  const todo = [];
  for (const r of list) {
    const c = mine.get(r);
    if (c && now - c.at <= ttl) { if (c.v) out.add(r); } else todo.push(r);
  }
  const remember = (r, v, keep = true) => { if (v) out.add(r); if (keep) mine.set(r, { v, at: now }); };
  const issueIds = todo.filter((r) => r.startsWith('issue:')).map((r) => r.slice(6));
  const spaceIds = todo.filter((r) => r.startsWith('space:')).map((r) => r.slice(6));
  for (const c of chunkOf(issueIds, 100)) {
    try {
      const r = await searchAll('user', `id in (${c.join(',')})`, []);
      const seen = new Set((r?.issues || []).map((i) => String(i.id)));
      for (const id of c) remember(`issue:${id}`, seen.has(id));
    } catch {
      // one unknown id can fail the whole query: ask one by one, every failure counts as hidden
      await poolOf(c, 4, async (id) => {
        try { const r = await searchAll('user', `id = ${id}`, []); remember(`issue:${id}`, (r?.issues || []).some((i) => String(i.id) === id)); } catch (e) { remember(`issue:${id}`, false, definite(e)); }
      });
    }
  }
  await poolOf(spaceIds, 6, async (id) => {
    try { await jira('user', `/rest/api/3/project/${id}`); remember(`space:${id}`, true); } catch (e) { remember(`space:${id}`, false, definite(e)); }
  });
  return out;
}
export const forgetVisibility = (accountId) => (accountId ? memo.delete(accountId) : memo.clear());

// order: the portfolio's refs in global rank order; refs: every ref that was checked.
export function callerScope(order, visible, refs = order) {
  const rank = new Map();
  let n = 0;
  for (const r of order) if (visible.has(r)) rank.set(r, ++n);
  const hidden = new Set([...new Set([...order, ...refs])].filter((r) => !visible.has(r)));
  return { visible, hidden, rank };
}

export function reportRefs(report) {
  const out = new Set();
  for (const r of report?.rows || []) if (r?.ref) out.add(r.ref);
  for (const [ref, w] of Object.entries(report?.extra?.waits || {})) { out.add(ref); for (const e of w?.list || []) if (e?.ref) out.add(e.ref); }
  return [...out];
}

// ---------- the dataset of the visible items ----------
export function scopeDataset(ds, visible) {
  const keep = (ref) => !!ref && visible.has(ref);
  const hiddenItems = (ds.portfolio || []).filter((p) => !keep(p.ref));
  if (!hiddenItems.length) return ds;
  const globalOf = (p) => p.globalRank ?? p.rank ?? 1e9;
  const portfolio = ds.portfolio.filter((p) => keep(p.ref)).sort((a, b) => globalOf(a) - globalOf(b)).map((p, i) => ({ ...p, rank: i + 1, globalRank: globalOf(p) }));
  const hiddenIds = new Set((ds.issues || []).filter((i) => !keep(i.rootRef)).map((i) => String(i.id)));
  for (const p of hiddenItems) if (p.id) hiddenIds.add(String(p.id));
  // a hidden SPACE is a whole Jira project: its work items stay out even as dependencies of visible ones
  const hiddenKeys = new Set(hiddenItems.filter((p) => p.kind === 'space').map((p) => p.projectKey || p.key).filter(Boolean));
  for (const x of ds.external || []) if (x.projectKey && hiddenKeys.has(x.projectKey)) hiddenIds.add(String(x.id));
  const issues = (ds.issues || []).filter((i) => keep(i.rootRef)).map((i) => (Array.isArray(i.links) && i.links.some((l) => hiddenIds.has(String(l.otherId)))
    ? { ...i, links: i.links.filter((l) => !hiddenIds.has(String(l.otherId))) } : i));
  const external = (ds.external || []).filter((x) => !hiddenIds.has(String(x.id)) && !(x.projectKey && hiddenKeys.has(x.projectKey)));
  const usedV = new Set(issues.flatMap((i) => i.fixVersionIds || []).map(String));
  const hiddenV = new Set((ds.issues || []).filter((i) => !keep(i.rootRef)).flatMap((i) => i.fixVersionIds || []).map(String));
  const versions = Object.fromEntries(Object.entries(ds.versions || {}).filter(([id, v]) => usedV.has(id) || (!hiddenV.has(id) && !(v?.projectKey && hiddenKeys.has(v.projectKey)))));
  const teamIds = new Set([...issues, ...external].map((i) => i.team?.id).filter(Boolean));
  for (const p of portfolio) if (p.leadTeam?.id) teamIds.add(p.leadTeam.id);
  for (const id of Object.keys(ds.capacity?.teams || {})) teamIds.add(id);
  const teams = (ds.teams || []).filter((t) => teamIds.has(t.id));
  const planEven = ds.planEven ? Object.fromEntries(Object.entries(ds.planEven).filter(([id]) => !hiddenIds.has(String(id)))) : ds.planEven;
  // unclear parentless work items: only with the candidate projects this viewer may see
  const orphans = (ds.orphans || []).map((o) => ({ ...o, candidates: (o.candidates || []).filter(keep) })).filter((o) => o.candidates.length);
  return { ...ds, portfolio, issues, orphans, external, versions, teams, planEven };
}

// cfg: the full configuration (as computeReport passes it to reportExtras); pa: plan vs. actual of the visible items.
export function scopedReport(ds, cfg, pa = null) {
  const report = cLevelReport(ds);
  try { Object.assign(report, reportExtras(computeAll(ds), cfg, pa)); } catch { /* the report stands without its extras */ }
  return report;
}

// ---------- hidden items in free text ----------
export function hiddenTerms(report, hidden) {
  const terms = new Set();
  if (!hidden?.size) return [];
  for (const r of report?.rows || []) {
    if (!hidden.has(r.ref)) continue;
    terms.add(r.ref);
    if (r.name && String(r.name).trim().length >= 3) terms.add(String(r.name).trim());
    if (r.key) terms.add(String(r.key));
  }
  for (const w of Object.values(report?.extra?.waits || {})) for (const e of w?.list || []) if (hidden.has(e.ref) && e.name && String(e.name).trim().length >= 3) terms.add(String(e.name).trim());
  for (const ref of hidden) terms.add(ref);
  return [...terms];
}
// A composer draft (cleanDraft shape) without what names a hidden item: such sections are left out, a hidden project
// as the draft's subject is cleared, a title naming one is emptied.
export function scrubDraft(d, terms) {
  if (!d?.doc || !Array.isArray(d.doc.sections) || !terms?.length) return d || null;
  const sections = d.doc.sections.filter((x) => !mentions(JSON.stringify(x), terms).length);
  const clean = (t) => (mentions(t, terms).length ? '' : t);
  const ref = (r) => (r && terms.includes(r) ? null : r);
  return { ...d, settings: { ...(d.settings || {}), projectRef: ref(d.settings?.projectRef ?? null) },
    doc: { ...d.doc, projectRef: ref(d.doc.projectRef ?? null), title: clean(d.doc.title), subtitle: clean(d.doc.subtitle), sections } };
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function mentions(text, terms) {
  const s = String(text || '');
  if (!s || !terms?.length) return [];
  return terms.filter((t) => new RegExp(`(^|[^\\p{L}\\p{N}_-])${escRe(t)}($|[^\\p{L}\\p{N}_])`, 'iu').test(s));
}
