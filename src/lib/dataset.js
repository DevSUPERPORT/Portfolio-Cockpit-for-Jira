import { getAppContext } from '@forge/api';
import { jira, searchAll, chunk, pool } from './jira.js';
import { K, get, set } from './store.js';
import { visiblePeople } from '../../shared/roles.js';
import { getEven } from './planEven.js';
import { parseQuarter } from '../../shared/dates.js';
import { supportMetrics, blockedMatcher } from '../../shared/engine.js';
import { supportJql, ticketServices } from './config.js';
import { withAtlassianTeams, storedAtlassianTeams } from './atlTeams.js';

export const APP_FIELD_KEYS = { rank: 'pc-portfolio-rank', tshirt: 'pc-tshirt-size', targetQuarters: 'pc-target-quarters' };
const SLA_TYPE = 'com.atlassian.servicedesk:sd-sla-field';

// ---------- field resolution ----------
const appUuid = () => {
  try { const c = getAppContext(); return String(c.appAri?.appId || c.appAri || '').match(/[0-9a-f-]{36}/)?.[0] || null; } catch { return null; }
};
export async function appFieldIds(force = false) {
  const uuid = appUuid();
  let env = null;
  // getAppContext() has no `environmentId` – it is environmentAri.environmentId (live 2026-11-24: the old read was always
  // null, so the environment filter below never applied and the dev install used the production install's fields)
  try { const c = getAppContext(); env = c.environmentAri?.environmentId || c.environmentId || null; } catch { /* outside runtime */ }
  const cached = !force && (await get(K.appFields));
  // the cache belongs to one environment: live 2026-11-24 the dev install still held the PRODUCTION field ids (cached by
  // an older version before the environment check) – every rank write went to production's field and Jira said 403
  if (cached && cached.rank && 'requestType' in cached && (cached.env ?? null) === env) return cached;
  const fields = await jira('app', '/rest/api/3/field');
  const out = { env };
  for (const [usage, key] of Object.entries(APP_FIELD_KEYS)) {
    const f = fields.find((x) => {
      const c = String(x.schema?.custom || '');
      return c.endsWith(`/static/${key}`) && (!uuid || c.includes(uuid)) && (!env || c.includes(env));
    });
    out[usage] = f?.id || null;
  }
  out.sla = fields.filter((f) => f.schema?.custom === SLA_TYPE).map((f) => f.id);
  // JSM request type (Support › "Wo geht die Support-Zeit hin?")
  out.requestType = fields.find((f) => f.schema?.custom === 'com.atlassian.servicedesk:vp-origin')?.id || null;
  if (out.rank) await set(K.appFields, out);
  return out;
}
export function resolvedFields(cfg, app) {
  const pick = (v, appKey) => (v === 'app' ? app[appKey] : v) || null;
  return {
    team: cfg.fields.team || null,
    startDate: cfg.fields.startDate || null,
    tshirt: pick(cfg.fields.tshirt, 'tshirt'),
    targetQuarters: pick(cfg.fields.targetQuarters, 'targetQuarters'),
    note: cfg.fields.note || null,
    owner: cfg.fields.owner || null,
    milestone: cfg.fields.milestone || null,
    rank: app.rank,
  };
}

// ---------- value parsing ----------
// A milestone custom field may hold a date, an option, a version or text; we keep a name and/or a date.
export function milestoneValueOf(v) {
  const x = Array.isArray(v) ? v[0] : v;
  if (x == null || x === '') return null;
  if (typeof x === 'string') return /^\d{4}-\d{2}-\d{2}/.test(x) ? { name: null, date: x.slice(0, 10) } : { name: x.slice(0, 120), date: null };
  if (typeof x === 'object') {
    const name = x.value ?? x.name ?? null;
    const date = typeof x.releaseDate === 'string' ? x.releaseDate.slice(0, 10) : null;
    return name || date ? { name: name ? String(name).slice(0, 120) : null, date } : null;
  }
  return null;
}
const firstUser = (v) => (Array.isArray(v) ? v[0] : v);
const H = (sec) => (sec ? Math.round((sec / 3600) * 100) / 100 : 0);
const cat = (k) => (k === 'done' ? 'done' : k === 'indeterminate' ? 'indeterminate' : 'new');
export const userOf = (u) => (u?.accountId ? { id: u.accountId, name: u.displayName || '', avatar: u.avatarUrls?.['24x24'] || null } : null);
const teamOf = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return { id: v, name: v };
  return v.id ? { id: String(v.id), name: v.name || v.title || String(v.id) } : null;
};
const dateOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const tshirtOf = (v) => {
  if (!v) return null;
  const s = typeof v === 'object' ? v.value ?? v.name ?? '' : String(v);
  return s.trim().replace(/\s+/g, ' ').toUpperCase() || null; // whole option value; sizeHours also tries the first word
};
const quartersOf = (v) => {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v).split(/[,;]/);
  return [...new Set(arr.map(parseQuarter).filter(Boolean))].sort();
};
export function adfText(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  const parts = [];
  const walk = (n) => { if (!n) return; if (n.text) parts.push(n.text); (n.content || []).forEach(walk); if (n.type === 'paragraph') parts.push(' '); };
  walk(v);
  return parts.join('').replace(/\s+/g, ' ').trim() || null;
}

export function roleResolver(cfg) {
  const map = new Map();
  for (const l of cfg.levels || []) for (const t of l.issueTypeIds) map.set(String(t), l);
  const off = new Set((cfg.levelsOff || []).flatMap((l) => l.issueTypeIds.map(String)));
  const offH = new Set((cfg.levelsOff || []).map((l) => l.hierarchy).filter(Number.isInteger));
  const onH = new Map((cfg.levels || []).filter((l) => Number.isInteger(l.hierarchy)).map((l) => [l.hierarchy, l]));
  return (type) => {
    const l = map.get(String(type.id));
    if (l) return { role: l.role, levelKey: l.key };
    // a type of a switched-off level – or of a switched-off hierarchy level – is passed through
    if (off.has(String(type.id))) return { role: 'skip', levelKey: 'skip' };
    const h = type.hierarchyLevel ?? 0;
    if (onH.has(h)) return { role: onH.get(h).role, levelKey: onH.get(h).key };
    if (offH.has(h)) return { role: 'skip', levelKey: 'skip' };
    const role = h <= -1 ? 'tiny' : h === 0 ? 'estimate' : h === 1 ? 'structure' : 'rough';
    const lv = (cfg.levels || []).find((x) => x.role === role);
    return { role, levelKey: lv?.key || role };
  };
}

function baseFields(F) {
  return ['summary', 'issuetype', 'parent', 'status', 'assignee', 'duedate', 'timeoriginalestimate', 'timeestimate', 'timespent',
    'aggregatetimeoriginalestimate', 'aggregatetimeestimate', 'aggregatetimespent',
    'project', 'fixVersions', 'issuelinks', 'worklog', 'created', F.team, F.startDate, F.tshirt, F.targetQuarters, F.note, F.owner, F.milestone, F.rank].filter(Boolean);
}

function normalize(raw, F, roleOf, rootRef) {
  const f = raw.fields || {};
  const { role, levelKey } = roleOf(f.issuetype || {});
  const wl = f.worklog || {};
  return {
    id: raw.id, key: raw.key, summary: f.summary || '', role, levelKey, rootRef,
    type: { id: f.issuetype?.id, name: f.issuetype?.name, icon: f.issuetype?.iconUrl || null },
    parentId: f.parent?.id || null,
    status: { id: f.status?.id ? String(f.status.id) : null, name: f.status?.name || '', cat: cat(f.status?.statusCategory?.key) },
    assignee: userOf(f.assignee), team: F.team ? teamOf(f[F.team]) : null,
    owner: F.owner ? userOf(firstUser(f[F.owner])) : userOf(f.assignee),
    milestone: F.milestone ? milestoneValueOf(f[F.milestone]) : null,
    start: F.startDate ? dateOf(f[F.startDate]) : null, due: dateOf(f.duedate),
    // Stories: Jira's totals (the story plus its sub-tasks) – if a team estimates and logs on sub-tasks, the
    // cockpit reads the story totals (structure spec). Everything else: its own values.
    ...(role === 'estimate'
      ? { oe: H(f.aggregatetimeoriginalestimate ?? f.timeoriginalestimate), re: H(f.aggregatetimeestimate ?? f.timeestimate), ts: H(f.aggregatetimespent ?? f.timespent) }
      : { oe: H(f.timeoriginalestimate), re: H(f.timeestimate), ts: H(f.timespent) }),
    fixVersionIds: (f.fixVersions || []).map((v) => String(v.id)),
    _versions: f.fixVersions || [],
    tshirt: F.tshirt ? tshirtOf(f[F.tshirt]) : null,
    quarters: F.targetQuarters ? quartersOf(f[F.targetQuarters]) : [],
    note: F.note ? adfText(f[F.note]) : null,
    links: (f.issuelinks || []).map((l) => ({ id: l.id, typeId: String(l.type?.id), verb: l.type?.outward || '', inverse: l.type?.inward || '', outward: !!l.outwardIssue, otherId: (l.outwardIssue || l.inwardIssue)?.id })).filter((l) => l.otherId),
    worklogs: (wl.worklogs || []).map((w) => ({ a: w.author?.accountId || null, an: w.author?.displayName || null, d: dateOf(w.started), h: H(w.timeSpentSeconds) })),
    _wlTotal: wl.total || 0,
    projectKey: f.project?.key || '', projectId: f.project?.id || '',
    created: dateOf(f.created),
  };
}

// ---------- portfolio items ----------
async function loadItems(as, cfg, state, F, roleOf) {
  const refs = (state.items || []).map((x) => x.ref);
  const rank = new Map(refs.map((r, i) => [r, i + 1]));
  const items = [];
  if (cfg.portfolio.source === 'issue') {
    const ids = refs.filter((r) => r.startsWith('issue:')).map((r) => r.slice(6));
    const pages = await pool(chunk(ids, 100), 4, (c) => searchAll(as, `id in (${c.join(',')})`, baseFields(F)));
    for (const p of pages) for (const raw of p.issues) {
      const n = normalize(raw, F, roleOf, `issue:${raw.id}`);
      items.push({
        ref: `issue:${raw.id}`, rank: rank.get(`issue:${raw.id}`), kind: 'issue', id: raw.id, key: raw.key, name: n.summary,
        owner: n.owner, statusCat: n.status.cat, status: n.status, due: n.due, start: n.start, tshirt: n.tshirt,
        quarters: n.quarters, leadTeam: n.team, projectKey: n.projectKey, projectId: n.projectId, type: n.type, parentId: n.parentId,
      });
    }
  } else {
    const plans = (await get(K.spacePlans)) || {};
    const ids = refs.filter((r) => r.startsWith('space:')).map((r) => r.slice(6));
    const res = await pool(ids, 6, (id) => jira(as, `/rest/api/3/project/${encodeURIComponent(id)}`, { query: { expand: 'lead' } }).catch(() => null));
    for (const p of res) {
      if (!p) continue; // not browsable: excluded, not even counted
      const pl = plans[p.id] || {};
      items.push({
        ref: `space:${p.id}`, rank: rank.get(`space:${p.id}`), kind: 'space', id: p.id, key: p.key, name: p.name,
        owner: userOf(p.lead), statusCat: pl.done ? 'done' : 'indeterminate', due: pl.due || null, start: pl.start || null,
        tshirt: pl.tshirt || null, quarters: pl.quarters || [], leadTeam: pl.leadTeam || null, avatar: p.avatarUrls?.['24x24'] || null, projectKey: p.key,
      });
    }
  }
  // Dense ranks over what this user can see (unique, 1..n) while keeping the global order.
  // D20: visible ranks are dense (1..n); the global rank (the Jira field value) is shown on hover when it differs.
  items.sort((a, b) => a.rank - b.rank).forEach((p, i) => { p.globalRank = p.rank; p.rank = i + 1; });
  return items;
}

// ---------- descendants ----------
// Jira Plans (Premium) answers "every descendant of X" in one search: portfolioChildIssuesOf. Live on superportdev
// 2026-11-23 it returned exactly the walk's work items (sub-tasks included) in half the time – the walk needs one round
// trip per level. Without Plans the function is unknown (HTTP 400): this instance remembers it and walks.
let plansSearch = true;
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
export const _plansSearch = { reset: () => { plansSearch = true; }, get: () => plansSearch }; // tests

async function loadIssues(as, cfg, items, F, roleOf, until, timing = {}) {
  const fields = baseFields(F);
  const out = [];
  let truncated = false;
  let orphans = [];
  let orphanInfo = null;
  if (cfg.portfolio.source === 'issue') {
    const seen = new Set(items.map((p) => p.id));
    // every descendant of the given roots (a parent search per level, up to 8 levels)
    const walk = async (roots) => {
    let frontier = roots;
    let perParent = 3; // expected children per parent – the level above tells (first level: a guess)
    for (let depth = 0; depth < 8 && frontier.length; depth++) {
      if (until && Date.now() > until) { truncated = true; break; } // out of time: what is loaded so far, marked partial
      const rootOf = new Map(frontier.map((x) => [x.id, x.rootRef]));
      // scale (2026-11-23, 1,400 demo items): a search returns 100 per page and pages come one after another, so
      // ~90 expected children per search and more searches side by side – the same results with fewer round trips
      const size = Math.max(5, Math.min(50, Math.floor(90 / Math.max(0.5, perParent))));
      const pages = await pool(chunk(frontier.map((x) => x.id), size), 8, (c) => searchAll(as, `parent in (${c.join(',')})`, fields, { limit: 4000, until }));
      const next = [];
      for (const p of pages) {
        truncated ||= p.truncated;
        for (const raw of p.issues) {
          if (seen.has(raw.id)) continue;
          seen.add(raw.id);
          const rootRef = rootOf.get(raw.fields?.parent?.id);
          const n = normalize(raw, F, roleOf, rootRef);
          out.push(n);
          next.push({ id: raw.id, rootRef });
        }
      }
      perParent = next.length / frontier.length;
      frontier = next;
    }
    };
    // the fast path: one Plans search per root (side by side), plus one search for the roots' direct children as a guard
    // – each of them must be in the result, otherwise (or on any error) the walk does it. Every work item gets the
    // NEAREST root above it (as the walk: it never descends through another root) and the walk's depth limit (8).
    const descend = async (roots) => {
      if (!plansSearch || !roots.length || !roots.every((r) => KEY_RE.test(r.key || ''))) return walk(roots);
      const rootIds = new Set(roots.map((r) => r.id));
      const directP = pool(chunk([...rootIds], 50), 4, (c) => searchAll(as, `parent in (${c.join(',')})`, ['parent'], { limit: 4000, until }));
      let res, direct;
      try {
        [res, direct] = await Promise.all([pool(roots, 8, (r) => searchAll(as, `issue in portfolioChildIssuesOf("${r.key}")`, fields, { limit: 4000, until })), directP]);
      } catch (e) {
        directP.catch(() => {});
        if (e?.status === 400) plansSearch = false; // no Plans on this site
        timing.plans = `off: ${e?.status || 'error'}`;
        return walk(roots);
      }
      const byId = new Map();
      let cut = false;
      for (const p of res) { cut ||= p.truncated; for (const raw of p.issues) if (!byId.has(raw.id)) byId.set(raw.id, raw); }
      const missing = direct.flatMap((p) => p.issues).filter((x) => !rootIds.has(x.id) && !byId.has(x.id)).length;
      if (missing || cut) { timing.plans = missing ? `guard: ${missing} direct children missing` : 'cut'; return walk(roots); }
      const refOf = new Map(roots.map((r) => [r.id, r.rootRef]));
      const memo = new Map();
      const place = (id, hop = 0) => {
        if (rootIds.has(id)) return { root: id, depth: 0 };
        if (memo.has(id)) return memo.get(id);
        const pid = byId.get(id)?.fields?.parent?.id;
        const up = pid && hop < 40 ? place(pid, hop + 1) : null;
        const v = up ? { root: up.root, depth: up.depth + 1 } : null;
        memo.set(id, v);
        return v;
      };
      const list = [];
      for (const [id, raw] of byId) { if (seen.has(id)) continue; const v = place(id); if (v && v.depth <= 8) list.push({ raw, v }); }
      list.sort((a, b) => a.v.depth - b.v.depth); // level by level, like the walk
      for (const { raw, v } of list) { seen.add(raw.id); out.push(normalize(raw, F, roleOf, refOf.get(v.root))); }
      timing.plans = 'on';
    };
    // parentless items are never a descendant of a root, so their search runs alongside the walk (scale, 2026-11-23)
    const t1 = Date.now();
    const orphansP = loadOrphans(as, cfg, items, F, roleOf, seen, until).catch(() => ({ own: [], unclear: [], truncated: false }));
    await descend(items.map((p) => ({ id: p.id, key: p.key, rootRef: p.ref })));
    timing.walk = Date.now() - t1;
    // Work items WITHOUT a parent in the projects' spaces (boss 2026-11-19: "stories without parent are not part of the
    // structure and Action needed – only visible on My work"). A space with exactly one portfolio project: they belong to
    // it (and so does everything below them). Several projects in the space: which one is unclear – they are listed
    // (ds.orphans, with the candidate projects) and count nowhere until someone sets a parent.
    if (!(until && Date.now() > until)) {
      const found = await orphansP;
      timing.orphans = Date.now() - t1;
      truncated ||= found.truncated;
      for (const n of found.own) { seen.add(n.id); out.push(n); }
      await walk(found.own.map((n) => ({ id: n.id, rootRef: n.rootRef })));
      orphans = found.unclear;
      orphanInfo = found.info || null;
    } else orphansP.catch(() => {});
  } else {
    const pages = await pool(items, 4, (p) => searchAll(as, `project = ${p.id} ORDER BY created ASC`, fields, { limit: 4000, until }).then((r) => ({ ...r, ref: p.ref })));
    for (const p of pages) {
      truncated ||= p.truncated;
      for (const raw of p.issues) out.push(normalize(raw, F, roleOf, p.ref));
    }
  }
  passThrough(out);
  // Complete worklogs where the search only returned the first page.
  const partial = out.filter((i) => i._wlTotal > i.worklogs.length);
  const t2 = Date.now();
  timing.worklogItems = partial.length;
  await pool(partial, 6, async (i) => {
    if (until && Date.now() > until) { truncated = true; return; }
    try {
      const r = await jira(as, `/rest/api/3/issue/${i.id}/worklog`, { query: { maxResults: 5000 } });
      i.worklogs = (r.worklogs || []).map((w) => ({ a: w.author?.accountId || null, an: w.author?.displayName || null, d: dateOf(w.started), h: H(w.timeSpentSeconds) }));
    } catch { /* keep what the search returned */ }
  });
  timing.worklogs = Date.now() - t2;
  return { issues: out, truncated, orphans, orphanInfo };
}

// The parentless work items of the portfolio projects' spaces (issue mode): open ones and those done in the last
// 90 days, of a level below the projects (the project and theme types and sub-tasks never), support work excluded.
// → { own: normalized items with rootRef + orphan: true, unclear: [{ …small item, candidates: [refs] }], truncated }
export async function loadOrphans(as, cfg, items, F, roleOf, seen, until) {
  const bySpace = new Map();
  for (const p of items) if (p.projectId) (bySpace.get(String(p.projectId)) || bySpace.set(String(p.projectId), []).get(String(p.projectId))).push(p.ref);
  if (!bySpace.size) return { own: [], unclear: [], truncated: false };
  const skipTypes = new Set([...(cfg.portfolio?.issueTypeIds || []), ...(cfg.portfolio?.group?.issueTypeIds || [])].map(String));
  const support = supportJql(cfg);
  const ids = [...bySpace.keys()].filter((id) => /^\d{1,18}$/.test(id));
  if (!ids.length) return { own: [], unclear: [], truncated: false };
  const jql = `project in (${ids.join(',')}) AND parent is EMPTY AND issuetype in standardIssueTypes()`
    + (skipTypes.size ? ` AND issuetype not in (${[...skipTypes].filter((t) => /^\d{1,18}$/.test(t)).join(',')})` : '')
    + (support ? ` AND NOT ${support}` : '')
    + ' AND (statusCategory != Done OR updated >= -90d) ORDER BY created DESC';
  const res = await searchAll(as, jql.replace(' AND issuetype not in ()', ''), baseFields(F), { limit: 500, until });
  // How many project work items each space holds – also those NOT in the portfolio (live on dev 2026-11-19: PCX holds
  // five, one of them in the portfolio – its parentless bugs are not automatically that one's). Only a space with exactly
  // one project work item gives its parentless items to it.
  const pTypes = [...(cfg.portfolio?.issueTypeIds || [])].map(String).filter((t) => /^\d{1,18}$/.test(t));
  const spaceCount = new Map();
  let countError = null;
  if (pTypes.length && (res.issues || []).length) {
    const cnt = await searchAll(as, `project in (${ids.join(',')}) AND issuetype in (${pTypes.join(',')})`, ['project'], { limit: 2000, until }).catch((e) => { countError = String(e?.status || e?.code || 'error'); return { issues: [] }; });
    // distinct project work items per space: the portfolio's own there plus every work item of the project type (live on
    // dev: the portfolio holds the epic PCX-3 while the configured project type is "Project" – PCX-56 – two projects)
    const sets = new Map(ids.map((id) => [id, new Set(items.filter((p) => String(p.projectId) === id).map((p) => String(p.id)))]));
    for (const x of cnt.issues || []) sets.get(String(x.fields?.project?.id || ''))?.add(String(x.id));
    for (const [id, set] of sets) spaceCount.set(id, set.size);
  }
  const own = [], unclear = [];
  for (const raw of res.issues || []) {
    if (seen.has(raw.id)) continue;
    const space = String(raw.fields?.project?.id || '');
    const refs = bySpace.get(space) || [];
    if (!refs.length) continue;
    const { role } = roleOf(raw.fields?.issuetype || {});
    if (!['rough', 'structure', 'estimate'].includes(role)) continue;
    const projects = Math.max(refs.length, spaceCount.get(space) || 0);
    if (projects === 1) { const n = normalize(raw, F, roleOf, refs[0]); n.orphan = true; own.push(n); continue; }
    const n = normalize(raw, F, roleOf, null);
    unclear.push({ id: n.id, key: n.key, summary: n.summary, role: n.role, levelKey: n.levelKey, type: n.type, status: n.status, assignee: n.assignee, team: n.team,
      start: n.start, due: n.due, oe: n.oe, re: n.re, ts: n.ts, projectKey: n.projectKey, projectId: n.projectId, candidates: refs, spaceProjects: projects });
  }
  // what the attribution was based on (space id → project work items) – ids and counts only, shown by the live test
  return { own, unclear, truncated: !!res.truncated, info: { found: (res.issues || []).length, spaces: Object.fromEntries(ids.map((id) => [id, { portfolio: (bySpace.get(id) || []).length, projects: spaceCount.get(id) || 0 }])), countError } };
}

// Work items of a switched-off level leave the list; their children hang on the next item above (the tree closes up).
export function passThrough(list) {
  const skipped = new Map(list.filter((i) => i.role === 'skip').map((i) => [i.id, i.parentId]));
  if (!skipped.size) return list;
  const up = (id) => { let p = id; for (let k = 0; k < 10 && skipped.has(p); k++) p = skipped.get(p); return p; };
  for (let k = list.length - 1; k >= 0; k--) if (list[k].role === 'skip') list.splice(k, 1);
  for (const i of list) if (skipped.has(i.parentId)) i.parentId = up(i.parentId);
  return list;
}

// The themes (the level above the projects): the projects' parents the user can see. A project without one, or with a
// parent of another type than the configured theme types, has no theme. Read as the same principal as the projects.
async function loadThemes(as, cfg, items) {
  const g = cfg.portfolio?.group;
  if (cfg.portfolio?.source !== 'issue' || g?.active === false) return [];
  const ids = [...new Set(items.map((p) => p.parentId).filter(Boolean))];
  if (!ids.length) return [];
  const pages = await pool(chunk(ids, 100), 4, (c) => searchAll(as, `id in (${c.join(',')})`, ['summary', 'issuetype', 'status']).catch(() => ({ issues: [] })));
  const types = new Set((g?.issueTypeIds || []).map(String));
  const out = [];
  for (const p of pages) for (const raw of p.issues || []) {
    const f = raw.fields || {};
    if (types.size && !types.has(String(f.issuetype?.id))) continue;
    out.push({ id: raw.id, key: raw.key, name: f.summary || raw.key, type: { id: f.issuetype?.id || null, name: f.issuetype?.name || '' }, status: { name: f.status?.name || '', cat: cat(f.status?.statusCategory?.key) } });
  }
  const known = new Set(out.map((t) => t.id));
  for (const p of items) p.themeId = known.has(p.parentId) ? p.parentId : null;
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- blocked stories and sub-tasks ----------
// For work items in the Blocked status: the day of the last change to Blocked (Jira history) and the
// latest comment as the reason. Read as the same principal as the issues; at most 60 items.
const MAX_BLOCKED = 60;
async function enrichBlocked(as, cfg, issues, until) {
  const isBlocked = blockedMatcher(cfg);
  const list = issues.filter((i) => (i.role === 'estimate' || i.role === 'tiny') && i.status.cat !== 'done' && isBlocked(i)).slice(0, MAX_BLOCKED);
  await pool(list, 6, async (i) => {
    if (until && Date.now() > until) return; // out of time: no "blocked since" for the rest
    try {
      let r = await jira(as, `/rest/api/3/issue/${i.id}/changelog`, { query: { maxResults: 100 } });
      if ((r.total || 0) > 100) r = await jira(as, `/rest/api/3/issue/${i.id}/changelog`, { query: { startAt: r.total - 100, maxResults: 100 } });
      let last = null;
      for (const h of r.values || []) {
        for (const it of h.items || []) {
          if (it.field === 'status' && isBlocked({ status: { id: it.to, name: it.toString } }) && (!last || h.created > last)) last = h.created;
        }
      }
      i.blockedSince = last ? dateOf(last) : null;
    } catch { i.blockedSince = null; }
    try {
      const c = await jira(as, `/rest/api/3/issue/${i.id}/comment`, { query: { orderBy: '-created', maxResults: 1 } });
      const body = c.comments?.[0]?.body;
      i.blockedReason = body ? adfText(body).slice(0, 240) || null : null;
    } catch { i.blockedReason = null; }
  });
}

// ---------- support (aggregated as the app: everyone computes with all service spaces) ----------
// Ticket list for the Support view, read AS THE USER: Jira decides which tickets someone may see.
export async function loadSupportTickets(cfg, appFields, as = 'user') {
  const jql = supportJql(cfg);
  if (!jql) return null;
  const teamF = cfg.fields.team || null;
  const slaF = appFields.sla || [];
  const rtF = appFields.requestType || null;
  const causeF = /^customfield_\d{1,10}$/.test(cfg.support?.causeFieldId || '') ? cfg.support.causeFieldId : null;
  const { issues, truncated } = await searchAll(as, `${jql} AND (statusCategory != Done OR resolved >= -56d) ORDER BY created DESC`,
    ['summary', 'priority', 'created', 'resolutiondate', 'status', 'issuetype', 'labels', 'issuelinks', 'project', 'assignee', 'timespent', 'components', teamF, rtF, causeF, ...slaF].filter(Boolean), { limit: 2000 });
  return { truncated: !!truncated, tickets: issues.map((raw) => {
    const f = raw.fields || {};
    let jsm = null;
    for (const id of slaF) {
      const v = f[id];
      const c = v?.ongoingCycle || (v?.completedCycles || []).at(-1);
      if (!c) continue;
      jsm = { goalMs: c.goalDuration?.millis ?? null, elapsedMs: c.elapsedTime?.millis ?? null, remainingMs: c.remainingTime?.millis ?? null, breached: !!c.breached, paused: !!c.paused };
      break;
    }
    const t = {
      id: raw.id, key: raw.key, summary: String(f.summary || '').slice(0, 140), priority: f.priority?.name || null, priorityIcon: f.priority?.iconUrl || null,
      created: f.created || null, resolved: f.resolutiondate || null, statusCat: cat(f.status?.statusCategory?.key), status: f.status?.name || '',
      typeId: String(f.issuetype?.id || ''), type: f.issuetype?.name || '', labels: f.labels || [], projectId: String(f.project?.id || ''), projectKey: f.project?.key || '', projectName: String(f.project?.name || '').slice(0, 120),
      assignee: f.assignee ? userOf(f.assignee) : null, team: teamF ? teamOf(f[teamF]) : null, spentH: H(f.timespent), jsm,
      links: (f.issuelinks || []).map((l) => (l.outwardIssue || l.inwardIssue)?.id).filter(Boolean),
      // dispatching and "where does support time go" (UC-17)
      statusId: String(f.status?.id || ''), components: (f.components || []).map((c) => c.name).slice(0, 10),
      requestType: rtF ? f[rtF]?.requestType?.name ?? null : null, cause: causeF ? (f[causeF]?.value ?? null) : null,
    };
    t.services = ticketServices(cfg, t);
    return t;
  }) };
}

export async function loadSupport(cfg, appFields, { force = false } = {}) {
  const ids = cfg.support?.serviceProjectIds || [];
  const queues = cfg.support?.queues || [];
  if (!ids.length && !queues.length) return null;
  const cached = !force && (await get(K.supportCache));
  const cacheKey = JSON.stringify(['v3', ids, queues, cfg.support.averagingWeeks, cfg.support.slaTargetPct]); // v2: per-team numbers per service space
  if (cached && cached.key === cacheKey && Date.now() - cached.at < 30 * 60e3) return cached.data;
  const teamF = cfg.fields.team || null;
  const slaF = appFields.sla || [];
  const spaceIds = queues.filter((q) => q.id === 'spaces').flatMap((q) => q.projectIds).filter((id) => !ids.includes(id));
  const services = [
    ...(await pool([...ids, ...spaceIds], 4, (id) => jira('app', `/rest/api/3/project/${id}`).catch(() => null))),
    ...queues.filter((q) => q.id !== 'spaces').map((q) => ({ id: `q:${q.id}`, key: 'Queue', name: q.name, projectIds: q.projectIds })),
  ];
  const { issues } = await searchAll('app', `${supportJql(cfg)} AND (statusCategory != Done OR updated >= -63d)`,
    ['status', 'assignee', 'timeestimate', 'worklog', 'project', 'issuetype', 'labels', teamF, ...slaF].filter(Boolean), { limit: 5000 });
  const winStart = Date.now() - 63 * 864e5;
  const tickets = issues.map((raw) => {
    const f = raw.fields;
    let met = 0, breached = 0;
    for (const id of slaF) {
      const v = f[id];
      if (!v) continue;
      for (const c of v.completedCycles || []) {
        const at = Date.parse(c.stopTime?.iso8601 || c.stopTime?.jira || 0);
        if (!at || at < winStart) continue;
        if (c.breached) breached++; else met++;
      }
      if (v.ongoingCycle?.breached) breached++;
    }
    const svc = ticketServices(cfg, { projectId: String(f.project?.id || ''), typeId: String(f.issuetype?.id || ''), labels: f.labels || [] });
    return {
      serviceId: svc[0] || f.project?.id, team: teamF ? teamOf(f[teamF]) : null, assignee: f.assignee?.accountId || null,
      statusCat: cat(f.status?.statusCategory?.key), re: H(f.timeestimate), sla: { met, breached },
      worklogs: (f.worklog?.worklogs || []).map((w) => ({ a: w.author?.accountId || null, d: dateOf(w.started), h: H(w.timeSpentSeconds) })),
    };
  });
  const today = new Date().toISOString().slice(0, 10);
  const data = supportMetrics({
    averagingWeeks: cfg.support.averagingWeeks, slaTargetPct: cfg.support.slaTargetPct,
    services: services.filter(Boolean).map((p) => ({ id: p.id, key: p.key, name: p.name, ...(p.projectIds ? { projectIds: p.projectIds } : {}) })), tickets,
  }, today);
  await set(K.supportCache, { at: Date.now(), key: cacheKey, data });
  return data;
}

// ---------- the whole dataset ----------
// until: a Date.now() deadline (resolvers have 25 s in Forge) – past it no further page is read and the dataset is marked
// truncated, so a very large portfolio loads partially (the UI says so) instead of failing with a time-out.
export async function buildDataset({ as = 'user', cfg, roles = {}, accountId = null, until = null, atlTeams = null }) {
  // how long each stage took (ms) – read by the live scale test; numbers only
  const t0 = Date.now();
  const timing = {};
  const lap = (k, start) => { timing[k] = Date.now() - start; };
  const app = await appFieldIds();
  const F = resolvedFields(cfg, app);
  const roleOf = roleResolver(cfg);
  // scale (2026-11-23): support, capacity, health and milestones do not depend on the work items – they load while
  // the hierarchy walk runs instead of after it
  const supportP = Promise.all([
    loadSupport(cfg, app).catch(() => null),
    // the report (as app) only aggregates them, so its SLA rate matches the cockpit's
    loadSupportTickets(cfg, app, as).catch(() => null),
  ]).then((r) => { lap('support', t0); return r; });
  const storeP = Promise.all([get(K.milestones), get(K.health), get(K.capacity), getEven().catch(() => ({}))]);
  supportP.catch(() => {}); storeP.catch(() => {});
  const state = (await get(K.portfolio)) || { items: [] };
  const items = await loadItems(as, cfg, state, F, roleOf);
  lap('items', t0);
  const [{ issues, truncated, orphans = [], orphanInfo = null }, themes] = await Promise.all([loadIssues(as, cfg, items, F, roleOf, until, timing), loadThemes(as, cfg, items)]);
  lap('issues', t0);
  const blockedP = enrichBlocked(as, cfg, issues, until).then(() => lap('blocked', t0));
  const known = new Set(issues.map((i) => i.id));
  const depTypes = new Set(cfg.dependencies?.linkTypeIds || []);
  const extIds = [...new Set(issues.flatMap((i) => i.links.filter((l) => depTypes.has(l.typeId) && !known.has(l.otherId)).map((l) => l.otherId)))];
  const extPages = await pool(chunk(extIds, 100), 4, (c) => searchAll(as, `id in (${c.join(',')})`, baseFields(F)).catch(() => ({ issues: [] })));
  const external = extPages.flatMap((p) => p.issues).map((raw) => {
    const n = normalize(raw, F, roleOf, null);
    return { id: n.id, key: n.key, summary: n.summary, status: n.status, start: n.start, due: n.due, team: n.team, assignee: n.assignee, note: n.note, projectKey: n.projectKey, rootRef: null, type: n.type };
  });
  const versions = {};
  for (const i of issues) for (const v of i._versions) versions[v.id] = { id: String(v.id), name: v.name, releaseDate: v.releaseDate || null, released: !!v.released, projectKey: i.projectKey };
  const [milestonesRaw, healthRaw, capStored, planEven] = await storeP;
  const milestones = milestonesRaw || [];
  const missingV = [...new Set(milestones.flatMap((m) => m.fixVersionIds))].filter((id) => !versions[id]);
  await pool(missingV, 6, async (id) => {
    try { const v = await jira(as, `/rest/api/3/version/${id}`); versions[id] = { id: String(v.id), name: v.name, releaseDate: v.releaseDate || null, released: !!v.released, projectId: String(v.projectId) }; } catch { /* not visible */ }
  });
  await blockedP;
  lap('linked', t0);
  for (const i of issues) { delete i._versions; delete i._wlTotal; }

  const health = healthRaw || {};
  for (const p of items) { const h = health[p.ref]; p.health = h ? (({ prev, ...rest }) => rest)(h) : null; } // earlier records (for exact undo) stay on the server

  const teams = new Map();
  for (const i of [...issues, ...external]) if (i.team) teams.set(i.team.id, i.team);
  for (const p of items) if (p.leadTeam) p.leadTeam = teams.get(p.leadTeam.id) || { id: p.leadTeam.id, name: p.leadTeam.name || p.leadTeam.id };
  for (const p of items) if (p.leadTeam && !teams.has(p.leadTeam.id)) teams.set(p.leadTeam.id, p.leadTeam);
  const capRaw = capStored || { people: {}, teams: {}, absences: [] };
  for (const [id, t] of Object.entries(capRaw.teams || {})) if (!teams.has(id) && t.name) teams.set(id, { id, name: t.name });

  const people = {};
  for (const i of issues) {
    if (i.assignee) people[i.assignee.id] = i.assignee;
    for (const w of i.worklogs) if (w.a && !people[w.a]) people[w.a] = { id: w.a, name: w.an || '', avatar: null };
  }
  for (const p of items) if (p.owner) people[p.owner.id] = p.owner;
  const unknown = Object.keys(capRaw.people || {}).filter((id) => !people[id]);
  for (const c of chunk(unknown, 50)) {
    try {
      const r = await jira(as, '/rest/api/3/user/bulk', { query: { accountId: c, maxResults: 50 } });
      for (const u of r.values || []) people[u.accountId] = userOf(u);
    } catch { /* names stay unknown */ }
  }
  const capacity = {
    defaultWeeklyHours: cfg.capacityDefaults?.defaultWeeklyHours ?? 40,
    defaultLocation: cfg.capacityDefaults?.defaultLocation || 'DE',
    teams: capRaw.teams || {},
    people: capRaw.people || {},
    // Absence reasons are only for capacity editors (GDPR minimisation); everyone else sees "absent".
    absences: (capRaw.absences || []).map((a) => (roles.editCapacity ? a : { accountId: a.accountId, from: a.from, to: a.to, type: 'absent' })),
  };
  const [support, supportTickets] = await supportP;

  const ds = {
    today: new Date().toISOString().slice(0, 10),
    storyTotals: true, // story oe/re/ts already include their sub-tasks
    config: null, portfolio: items, themes, issues, orphans, orphanInfo, external, versions, milestones, teams: [...teams.values()], people, capacity,
    supportComputed: support, supportTickets, truncated, timing,
  };
  // tasks whose hours are split evenly although the board distributes by capacity (Wochenplanung override)
  ds.planEven = planEven || {};
  for (const i of ds.issues) for (const w of i.worklogs) delete w.an;
  // Atlassian Teams (membership): the snapshot the caller refreshed, else the stored one (jobs run as the app)
  if (cfg.teams?.source !== 'cockpit') withAtlassianTeams(ds, (atlTeams ? await atlTeams : null) || await storedAtlassianTeams());
  lap('total', t0);
  // Privacy (UC-08): as the user, people outside the role's scope become pseudonyms (the user always sees themself).
  if (as === 'user') {
    const keep = cfg.rules?.personLevel === false ? new Set(accountId ? [accountId] : []) : visiblePeople({ logs: roles.logs ?? 'all', accountId, capacity: capRaw });
    if (keep) pseudonymize(ds, keep);
  }
  return ds;
}

// Person-level values off: replace people with stable-per-response pseudonyms, drop names.
// Project owners stay visible (they are accountable for the project, not a person-level metric).
function pseudonymize(ds, keep = new Set()) {
  const map = new Map();
  const ps = (id) => { if (!id || keep.has(id)) return id || null; if (!map.has(id)) map.set(id, `anon-${Math.random().toString(36).slice(2, 10)}`); return map.get(id); };
  const anonUser = (u) => (u ? (keep.has(u.id) ? u : { id: ps(u.id), name: '', avatar: null, anon: true }) : null);
  for (const i of ds.issues) {
    i.assignee = anonUser(i.assignee);
    for (const w of i.worklogs) w.a = ps(w.a);
  }
  for (const x of ds.external) x.assignee = anonUser(x.assignee);
  for (const x of ds.orphans || []) x.assignee = anonUser(x.assignee);
  for (const t of ds.supportTickets?.tickets || []) t.assignee = anonUser(t.assignee);
  const owners = Object.fromEntries(ds.portfolio.filter((p) => p.owner).map((p) => [p.owner.id, p.owner]));
  ds.people = { ...owners, ...Object.fromEntries(Object.entries(ds.people || {}).filter(([id]) => keep.has(id))) };
  ds.capacity.people = Object.fromEntries(Object.entries(ds.capacity.people).map(([id, p]) => [ps(id), keep.has(id) ? p : { weeklyHours: p.weeklyHours, location: p.location, teamId: p.teamId, teams: p.teams }]));
  ds.capacity.absences = ds.capacity.absences.map((a) => (keep.has(a.accountId) ? a : { accountId: ps(a.accountId), from: a.from, to: a.to, type: 'absent' }));
  if (ds.supportComputed) ds.supportComputed = { ...ds.supportComputed, personWeekly: Object.fromEntries(Object.entries(ds.supportComputed.personWeekly || {}).map(([k, v]) => [ps(k), v])) };
  for (const p of ds.portfolio) if (p.health && !keep.has(p.health.by)) p.health = { ...p.health, by: null, byName: null };
  // team membership uses the same pseudonyms, so a person is still counted once and judged in the right team
  for (const t of Object.values(ds.atlTeams?.teams || {})) t.members = (t.members || []).map((m) => (keep.has(m.accountId) ? m : { accountId: ps(m.accountId), name: '' }));
  ds.personLevel = false;
  ds.privacy = { scope: keep.size > 1 ? 'team' : 'none', visible: keep.size };
}
