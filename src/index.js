import ResolverModule from '@forge/resolver';
import { validAsk, validBoards } from './lib/askPrefs.js';
import { maintenanceMode, requireAvailable, kindOf, STATUS_PAGE_URL, siteWithdrawn, UnavailableError, WITHDRAWN_MESSAGE } from './lib/maintenance.js';
import { jira, confluence, searchAll, pool, chunk } from './lib/jira.js';
import { K, get, set, del, audit, recentAudit, addConfigVersion, listConfigVersions, getConfigVersion, countAiUsers } from './lib/store.js';
import { loadConfig, saveConfig, publicConfig, validateConfig, detectSetup, ValidationError, PERMISSION_KEYS, applySettings, DELEGATED_RULES, sizeKey, validQueues, supportJql, aiAllowed, staleFields, quarterChoices } from './lib/config.js';
import { resolveRoles, requireRole, AccessError, canEditIssue } from './lib/perms.js';
import { buildDataset, appFieldIds, resolvedFields, loadSupport, userOf } from './lib/dataset.js';
import { cLevelReport, computeAll } from '../shared/engine.js';
import { LOCATIONS } from '../shared/holidays.js';
import { storyCheck } from '../shared/storyCheck.js';
import { rankCandidates, keyPrefixOf, searchWords } from '../shared/projectSearch.js';
import { visiblePeople, responsibleTeams } from '../shared/roles.js';
import { allocationOf } from '../shared/allocation.js';
import { runSnapshotJob, planActual, fetchWorklogs } from './lib/snapshot.js';
import { freshAtlassianTeams, ATL_TEAMS_KEY, quickTeamStatus } from './lib/atlTeams.js';
import { logError, logWarn, safeError } from './lib/safeLog.js';
import { licenseBlocks } from './lib/license.js';
import { reportPersonalData } from './lib/privacy.js';
import { runNotices, runBookingNotices, remindPeople, REMIND_KEY } from './lib/notices.js';
import { bookingOverview } from '../shared/booking.js';
import { reportExtras, reportForViewer } from '../shared/reportKpis.js';
import { dayIdx } from '../shared/dates.js';
import { applyPlanMoves } from './lib/planApply.js';
import { setEven } from './lib/planEven.js';
import { assist } from './lib/aiAssist.js';
import { loadHistory, loadComments } from './lib/history.js';
import { listPlaybooks, savePlaybook, deletePlaybook } from './lib/playbooks.js';
import { dispatchTickets, undoDispatch, setSupportReserve } from './lib/dispatch.js';
import { mineWeek, mineBook, mineSearch, mineEvidence, MineError } from './lib/mine.js';
import { reportStorageHtml } from './lib/report-html.js';
import { ask as aiAsk, healthDraft as aiHealthDraft, reportSummary as aiReportSummary, takeQuota, forgetAiData, budgetStatus, purgeCache, spendHistory, llm, dropCached } from './lib/ai.js';
import { lotseReading } from '../shared/lotse/llm.js';
import { trackUsage, readUsage, compactUsage } from './lib/usage.js';
import { draftReport } from '../shared/lotse/report/compose.js';
import { cleanComposed, verifyComposed, composedStorage, withdrawnStorage, cleanDraft, PublishError } from '../shared/lotse/report/publish.js';
import { learnFromAi, listLearned, reviewLearned, learnChainFromAi } from './lib/learn.js';
import { lotsePlanAssist, lotseWriteAssist } from '../shared/lotse/act/chain/llm.js';
import { visibleRefs as callerVisible, callerScope, reportRefs, scopeDataset, scopedReport, hiddenTerms, mentions, scrubDraft } from './lib/reportScope.js';
// The configuration as the browser sees it, with this month's AI budget (used / limit / stopped) – read-only, never saved.
// ai.user = this person switched AI on for themselves (prefs; default off).
async function clientConfig(cfg, accountId, prefs) {
  const pc = publicConfig(cfg);
  const [budget, p] = await Promise.all([budgetStatus(cfg).catch(() => null), prefs ? prefs : accountId ? get(K.pref(accountId)).catch(() => null) : null]);
  return { ...pc, ai: { ...(pc.ai || {}), budget, user: p?.ai === true } };
}

// default export under both the Forge bundler and plain Node (tests)
const Resolver = ResolverModule.default ?? ResolverModule;
const resolver = new Resolver();
const LICENSE_FREE = new Set(['bootstrap', 'config.get', 'config.detect', 'config.save', 'config.history', 'config.version', 'config.restore', 'meta.groups', 'meta.projects', 'meta.versions', 'milestones.save', 'audit.list']);
const REF_RE = /^(issue|space):\d{1,18}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isStr = (v) => typeof v === 'string';
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const safeKey = (k, re) => isStr(k) && !BAD_KEYS.has(k) && re.test(k);
const Q_RE = /^\d{4}-Q[1-4]$/;
const HEALTH = ['onTrack', 'atRisk', 'critical'];

class BadRequest extends Error { constructor(m) { super(m); this.code = 'INVALID'; } }
const assert = (cond, msg) => { if (!cond) throw new BadRequest(msg); };
const jqlString = (s) => `"${String(s).replace(/["\\]/g, ' ').slice(0, 80)}"`;

// Every resolver: trusted accountId from the invocation context, fresh config and roles, uniform errors.
export const handlers = {};
function def(name, fn) {
  handlers[name] = fn;
  resolver.define(name, async (req) => {
    try {
      // A site the app was withdrawn from: nothing is read or written there (lib/maintenance.js WITHDRAWN_SITES)
      if (siteWithdrawn(req.context)) throw new UnavailableError(WITHDRAWN_MESSAGE);
      // Kill switch first: while SUPERPORT has paused the app nothing is read or written (see lib/maintenance.js).
      requireAvailable(kindOf(name));
      const ctx = { accountId: req.context?.accountId, moduleKey: req.context?.moduleKey, extension: req.context?.extension };
      if (!ctx.accountId) throw new AccessError('ANONYMOUS');
      // Marketplace licensing: an inactive licence blocks the cockpit; admins keep access to the configuration page.
      if (licenseBlocks(req.context) && !(ctx.moduleKey === 'pc-admin' && LICENSE_FREE.has(name))) {
        throw Object.assign(new Error('LICENSE_INACTIVE'), { code: 'LICENSE_INACTIVE' });
      }
      const cfg = await loadConfig();
      const roles = await resolveRoles(ctx.accountId, cfg);
      const payload = req.payload && typeof req.payload === 'object' ? req.payload : {};
      return { ok: true, data: await fn({ payload, ctx, cfg, roles }) };
    } catch (e) {
      const code = e.code || (e.status === 403 || e.status === 401 ? 'FORBIDDEN' : e.status === 404 ? 'NOT_FOUND' : e.status === 429 ? 'BUSY' : 'ERROR');
      if (code === 'BUSY') logWarn(`[${name}] Jira rate limit (429)`, e); // visible in the logs as load, not as a bug
      // Jira refused a call (401/403): the user sees "Jira does not allow you …" – the log says which call and why
      // (live 2026-11-24: the Portfolio arrows were refused while the same reorder through Lotse worked)
      if (code === 'FORBIDDEN' && (e.status === 401 || e.status === 403)) logWarn(`[${name}] Jira ${e.status} on ${e.where || '?'}`, e);
      if (code === 'ERROR') logError(`[${name}]`, e);
      return { ok: false, error: { code, message: code === 'ERROR' ? 'Unexpected error' : e.message } };
    }
  });
}
// Whether SUPERPORT has paused the app (signed-in callers only). Answers in every mode, touches no data.
resolver.define('availability', async (req) => (req.context?.accountId
  ? { ok: true, data: { mode: maintenanceMode(), statusUrl: STATUS_PAGE_URL } }
  : { ok: false, error: { code: 'ANONYMOUS', message: 'ANONYMOUS' } }));

async function withName(ctx) {
  if (!ctx.displayName) { try { ctx.displayName = (await jira('user', '/rest/api/3/myself')).displayName; } catch { ctx.displayName = null; } }
  return ctx;
}

// ---------- bootstrap & dataset ----------
// With { withDataset: true } the dataset comes back in the same invocation, which saves the UI a
// whole round trip on open. A dataset failure does not fail the bootstrap; the UI then asks again.
def('bootstrap', async ({ payload, ctx, cfg, roles }) => {
  const withData = payload.withDataset === true && cfg.setupComplete && ctx.moduleKey !== 'pc-admin';
  const [me, prefs, digest, data] = await Promise.all([
    jira('user', '/rest/api/3/myself').catch(() => null),
    get(K.pref(ctx.accountId)).then((p) => p || {}),
    digestBase(ctx.accountId).catch(() => null),
    // Large sites: stop waiting after 12 s and let the UI fetch the dataset in its own call (own time limit).
    withData ? Promise.race([loadDataset(ctx, cfg, roles).then((d) => ({ d }), (e) => ({ e })), new Promise((r) => setTimeout(() => r({ slow: true }), 12000))]) : null,
  ]);
  if (data?.e && !data.e.code) logError('[bootstrap:dataset]', data.e);
  return {
    me: me ? { id: me.accountId, name: me.displayName, avatar: me.avatarUrls?.['48x48'] || null, locale: me.locale || null } : { id: ctx.accountId },
    roles, config: await clientConfig(cfg, ctx.accountId, prefs), setupComplete: !!cfg.setupComplete, prefs, locations: LOCATIONS, digest,
    availability: { mode: maintenanceMode(), statusUrl: STATUS_PAGE_URL },
    projectContext: ctx.extension?.project ? { id: String(ctx.extension.project.id), key: ctx.extension.project.key } : null,
    dataset: data?.d || null,
  };
});

export const DATASET_BUDGET_MS = 17000;
async function loadDataset(ctx, cfg, roles) {
  if (!cfg.setupComplete) throw Object.assign(new Error('SETUP_REQUIRED'), { code: 'SETUP_REQUIRED' });
  // Forge gives a resolver 25 s: stop reading Jira after 17 s and answer with what is loaded (marked truncated)
  // Atlassian Teams are refreshed (at most every 5 min, as this user) while the data loads – never slower than the load
  const atlTeams = cfg.teams?.source === 'cockpit' ? null : freshAtlassianTeams(cfg).catch(() => null);
  const ds = await buildDataset({ as: 'user', cfg, roles, accountId: ctx.accountId, until: Date.now() + DATASET_BUDGET_MS, atlTeams });
  ds.config = await clientConfig(cfg, ctx.accountId);
  ds.supportComputed = await scopeSupport(ds.supportComputed, roles);
  return ds;
}
// Status of the Atlassian Teams connection, and a refresh on demand ("Jetzt abgleichen") for whoever maintains teams.
def('teams.atlassian', async ({ payload, cfg, roles }) => {
  const force = payload.refresh === true;
  if (force && !roles.admin && !roles.editCapacity) throw new AccessError('FORBIDDEN');
  const snap = cfg.teams?.source === 'cockpit' && !force ? await get(ATL_TEAMS_KEY) : await freshAtlassianTeams(cfg, { force, deadlineMs: 20000 });
  if (!snap) return { status: 'none' };
  return { at: snap.at, status: snap.status, failed: snap.failed || 0, lastError: snap.lastError || null, teams: Object.entries(snap.teams || {}).map(([id, t]) => ({ id, name: t.name || '', members: (t.members || []).length })) };
});
def('dataset', ({ ctx, cfg, roles }) => loadDataset(ctx, cfg, roles));

// ---------- Meine Arbeit (UC-20): own tasks and worklogs; booking as the user ----------
// Open to every signed-in user (it is their own data); Jira checks browse and "log work" permissions itself.
// mine.book only ever touches worklogs whose author is the caller (see src/lib/mine.js).
const mineErr = (e) => { if (e instanceof MineError) throw Object.assign(new BadRequest(e.message), { code: e.code }); throw e; };
def('mine.week', async ({ payload, ctx, cfg }) => {
  assert(cfg.setupComplete, 'setup required');
  return mineWeek(cfg, ctx.accountId, { from: payload.from, to: payload.to, extraIds: payload.extraIds }).catch(mineErr);
});
def('mine.book', async ({ payload, ctx, cfg }) => {
  assert(cfg.setupComplete, 'setup required');
  return mineBook(cfg, ctx.accountId, payload, new Date().toISOString().slice(0, 10)).catch(mineErr);
});
// What I did in the week (my status changes, edits, comments) – the raw material for the booking proposals.
def('mine.evidence', async ({ payload, ctx, cfg }) => {
  assert(cfg.setupComplete, 'setup required');
  return mineEvidence(cfg, ctx.accountId, { from: payload.from, to: payload.to }).catch(mineErr);
});
def('mine.search', async ({ payload, cfg }) => {
  assert(cfg.setupComplete, 'setup required');
  return mineSearch(payload.query);
});

// Planungs-Check on the Jira work item (module pc-story-check). Read-only. The work item comes from the trusted
// invocation context (never from the payload); the dataset is read AS THE USER, so only what they may see counts.
def('story.check', async ({ payload, ctx, cfg, roles }) => {
  const issueId = String(ctx.extension?.issue?.id ?? '');
  assert(/^\d{1,18}$/.test(issueId), 'work item context missing');
  const lang = payload.lang === 'en' ? 'en' : 'de';
  if (!cfg.setupComplete) return { known: false, setup: false };
  const ds = await loadDataset(ctx, cfg, roles);
  return storyCheck(computeAll(ds, { skipWeeks: true }), issueId, { lang });
});

// ---------- since your last visit ----------
// Per user: a compact summary of the portfolio as that user saw it. A new visit starts after 30 minutes
// without one; until then the comparison base stays put, so reloading does not wipe the digest.
// Only numbers, enums and refs are stored (no names); the UI shows changes only for items it can still see.
const VISIT_GAP_MS = 30 * 60 * 1000;
async function digestBase(accountId, now = Date.now()) {
  const latest = await get(K.digestLatest(accountId));
  if (latest && now - Date.parse(latest.at) > VISIT_GAP_MS) return latest;
  return get(K.digestBase(accountId));
}
const ENUM = (v, list) => (list.includes(v) ? v : null);
def('digest.save', async ({ payload, ctx }) => {
  const items = payload.items;
  assert(items && typeof items === 'object' && !Array.isArray(items), 'items');
  const refs = Object.keys(items);
  assert(refs.length <= 1500, 'too many items');
  const clean = {};
  for (const ref of refs) {
    assert(REF_RE.test(ref), 'ref');
    const v = items[ref];
    assert(v && typeof v === 'object', 'item');
    clean[ref] = {
      r: Number.isInteger(v.r) && v.r > 0 && v.r < 1e6 ? v.r : null,
      p: typeof v.p === 'number' && v.p >= 0 && v.p <= 1 ? Math.round(v.p * 1000) / 1000 : null,
      h: ENUM(v.h, HEALTH), s: ENUM(v.s, ['new', 'indeterminate', 'done']), w: ENUM(v.w, ['ok', 'partial', 'no']),
      d: isStr(v.d) && DATE_RE.test(v.d) ? v.d : null,
    };
  }
  const snap = { at: new Date().toISOString(), items: clean };
  if (payload.ack === true) {
    await Promise.all([set(K.digestBase(ctx.accountId), snap), set(K.digestLatest(ctx.accountId), snap)]);
    return { base: snap.at };
  }
  const base = await digestBase(ctx.accountId);
  if (base) await set(K.digestBase(ctx.accountId), base);
  await set(K.digestLatest(ctx.accountId), snap);
  return { base: base?.at || null };
});

// Ask canvas per user: the questions and where the cards sit. Answers are recomputed from live data
// (AI answers are kept as text). Bounded so a board can never grow without limit.
const HINT_KEYS = ['mine', 'admin'];
def('prefs.save', async ({ payload, ctx }) => {
  const cur = (await get(K.pref(ctx.accountId))) || {};
  const next = { ...cur };
  if (payload.selectedRef === null || (typeof payload.selectedRef === 'string' && REF_RE.test(payload.selectedRef))) next.selectedRef = payload.selectedRef;
  if (typeof payload.view === 'string' && /^[a-z-]{1,20}$/.test(payload.view)) next.view = payload.view;
  if (payload.lang === null || payload.lang === 'de' || payload.lang === 'en') next.lang = payload.lang;
  if (typeof payload.tourDone === 'boolean') next.tourDone = payload.tourDone;
  if (payload.motion === 'full' || payload.motion === 'reduced') next.motion = payload.motion; // the person's motion choice (lib/motion.js)
  // the person's own AI switch (default off); logged, because it decides whether this person's requests cost money
  if (typeof payload.ai === 'boolean' && payload.ai !== (cur.ai === true)) { next.ai = payload.ai; await audit(ctx, payload.ai ? 'ai.user.on' : 'ai.user.off', {}); }
  // one-time hints (seen or skipped = never again)
  if (payload.hints && typeof payload.hints === 'object') next.hints = { ...(cur.hints || {}), ...Object.fromEntries(HINT_KEYS.filter((k) => payload.hints[k] === true).map((k) => [k, true])) };
  if (payload.ask && typeof payload.ask === 'object') next.ask = validAsk(payload.ask);
  if (Array.isArray(payload.askBoards)) next.askBoards = validBoards(payload.askBoards);
  // the report composer's draft (shared/lotse/report/publish.js cleanDraft: validated, slim, ≤ 120 KB) – kept under its own
  // key so the bootstrap stays light; prefs only carry when it was saved. null deletes it.
  if ('reportDraft' in payload) {
    const d = cleanDraft(payload.reportDraft);
    assert(d !== undefined, 'reportDraft invalid or too large');
    if (d === null) { await del(K.reportDraft(ctx.accountId)); next.reportDraftAt = null; } else { await set(K.reportDraft(ctx.accountId), d); next.reportDraftAt = d.at; }
  }
  if (payload.filters && typeof payload.filters === 'object') {
    const f = payload.filters;
    next.filters = {
      status: ['all', 'open', 'new', 'indeterminate', 'done'].includes(f.status) ? f.status : 'all',
      team: typeof f.team === 'string' ? f.team.slice(0, 64) : 'all',
      assignee: typeof f.assignee === 'string' ? f.assignee.slice(0, 128) : 'all',
      onlyIssues: !!f.onlyIssues,
    };
  }
  await set(K.pref(ctx.accountId), next);
  return next;
});

// Support aggregates are computed as the app (everyone plans with all service spaces), but per-service
// detail is only shown for spaces the caller can browse, and per-person support hours only to capacity editors.
export async function scopeSupport(sup, roles) {
  if (!sup) return null;
  const visible = new Set();
  await pool(sup.services, 6, async (s) => {
    for (const pid of s.projectIds || [s.id]) { try { await jira('user', `/rest/api/3/project/${pid}`); visible.add(s.id); return; } catch { /* hidden */ } }
  });
  const services = roles.viewReport ? sup.services : sup.services.filter((s) => visible.has(s.id));
  const met = services.reduce((a, s) => a + s.met, 0), breached = services.reduce((a, s) => a + s.breached, 0);
  const rate = met + breached > 0 ? met / (met + breached) : null;
  return {
    ...sup, services,
    personWeekly: roles.editCapacity || roles.viewReport ? sup.personWeekly : {},
    slaRate: rate, breaches: breached, open: services.reduce((a, s) => a + s.open, 0), openRe: services.reduce((a, s) => a + s.openRe, 0),
    health: rate == null ? null : rate >= sup.slaTarget ? 'onTrack' : rate >= sup.slaTarget - 0.05 ? 'atRisk' : 'critical',
  };
}

// ---------- portfolio (UC-10, UC-16) ----------
async function portfolioState() { return (await get(K.portfolio)) || { items: [] }; }
async function visibleRefs(refs) {
  const issueIds = refs.filter((r) => r.startsWith('issue:')).map((r) => r.slice(6));
  const spaceIds = refs.filter((r) => r.startsWith('space:')).map((r) => r.slice(6));
  const ok = new Set();
  for (const c of chunk(issueIds, 100)) {
    const r = await searchAll('user', `id in (${c.join(',')})`, ['issuetype']);
    r.issues.forEach((i) => ok.add(`issue:${i.id}`));
  }
  await pool(spaceIds, 6, async (id) => { try { await jira('user', `/rest/api/3/project/${id}`); ok.add(`space:${id}`); } catch { /* hidden */ } });
  return ok;
}
async function writeRanks(cfg, items, prevRanks) {
  if (cfg.portfolio.source !== 'issue') return;
  const { rank: fieldId } = await appFieldIds();
  if (!fieldId) return;
  const updates = [];
  items.forEach((it, i) => {
    if (!it.ref.startsWith('issue:') || prevRanks.get(it.ref) === i + 1) return;
    updates.push({ issueIds: [Number(it.ref.slice(6))], value: i + 1 });
  });
  for (const c of chunk(updates, 50)) await jira('app', `/rest/api/3/app/field/${fieldId}/value`, { method: 'PUT', body: { updates: c } });
}
async function clearRank(cfg, ref) {
  if (cfg.portfolio.source !== 'issue' || !ref.startsWith('issue:')) return;
  const { rank: fieldId } = await appFieldIds();
  if (fieldId) await jira('app', `/rest/api/3/app/field/${fieldId}/value`, { method: 'PUT', body: { updates: [{ issueIds: [Number(ref.slice(6))], value: null }] } }).catch(() => {});
}

def('portfolio.reorder', async ({ payload, ctx, cfg, roles }) => {
  requireRole(roles, 'manageRanking');
  const order = payload.order;
  assert(Array.isArray(order) && order.length <= 2000 && order.every((r) => typeof r === 'string' && REF_RE.test(r)), 'order invalid');
  assert(new Set(order).size === order.length, 'duplicate refs');
  const state = await portfolioState();
  const current = state.items.map((x) => x.ref);
  assert(order.every((r) => current.includes(r)), 'unknown ref in order');
  const visible = await visibleRefs(order);
  assert(order.every((r) => visible.has(r)), 'cannot rank items you cannot browse');
  // The caller's order permutes the slots its items occupy; everything else keeps its place.
  const moving = new Set(order);
  const slots = current.map((r, i) => (moving.has(r) ? i : -1)).filter((i) => i >= 0);
  const next = [...current];
  slots.forEach((slot, k) => { next[slot] = order[k]; });
  const prevRanks = new Map(current.map((r, i) => [r, i + 1]));
  const byRef = new Map(state.items.map((x) => [x.ref, x]));
  const nextItems = next.map((r) => byRef.get(r));
  // Jira's rank field first, then the stored order: when Jira refuses, NOTHING has changed (live 2026-11-24 the order was
  // saved, the field write failed and the user saw "not allowed" – while the new order had in fact been kept)
  await writeRanks(cfg, nextItems, prevRanks);
  state.items = nextItems;
  await set(K.portfolio, state);
  await withName(ctx);
  const changes = next.map((r, i) => ({ ref: r, from: prevRanks.get(r), to: i + 1 })).filter((c) => c.from !== c.to);
  for (const c of changes) await audit(ctx, 'rank.change', c);
  return { changes: changes.filter((c) => moving.has(c.ref)).length };
});

// Add project: { pool: true } → { items, truncated } – the visible candidates (most recently updated first), filtered and
// ranked in the browser on every keystroke (instant, forgiving: partial keys, word starts, typos – shared/projectSearch.js).
// { query } → a ranked list from a server-side search, for sites with more candidates than the pool holds. Everything is
// read as the user: Jira decides what someone may see.
const POOL_MAX = 500;
def('portfolio.candidates', async ({ payload, cfg, roles }) => {
  requireRole(roles, 'manageRanking');
  const qtext = typeof payload.query === 'string' ? payload.query.trim().slice(0, 80) : '';
  const wantPool = payload.pool === true;
  const state = await portfolioState();
  const inPortfolio = new Set(state.items.map((x) => x.ref));
  let list = [];
  let truncated = false;
  if (cfg.portfolio.source === 'issue') {
    const types = cfg.portfolio.issueTypeIds;
    if (!types.length) return wantPool ? { items: [], truncated: false } : [];
    const base = `issuetype in (${types.join(',')})`;
    const ownerF = cfg.fields.owner || 'assignee';
    const fields = ['summary', 'status', ownerF, 'project', 'issuetype'];
    const run = (jql, limit) => searchAll('user', `${jql} ORDER BY updated DESC`, fields, { limit }).catch(() => ({ issues: [], truncated: false }));
    const map = (i) => ({
      ref: `issue:${i.id}`, key: i.key, name: i.fields.summary, status: i.fields.status?.name, statusCat: i.fields.status?.statusCategory?.key,
      owner: userOf(Array.isArray(i.fields[ownerF]) ? i.fields[ownerF][0] : i.fields[ownerF]), space: i.fields.project?.name, spaceKey: i.fields.project?.key, projectId: i.fields.project?.id, icon: i.fields.issuetype?.iconUrl,
    });
    if (wantPool || !qtext) {
      const r = await run(base, POOL_MAX);
      truncated = r.truncated || r.issues.length > POOL_MAX;
      list = r.issues.slice(0, POOL_MAX).map(map);
    } else {
      // a key ("PCX-5", "pcx") → that space; words → each word as a word start (all of them, then any of them – a typo in
      // one word still finds the others); the ranking below decides what fits
      const key = keyPrefixOf(qtext), ws = searchWords(qtext);
      const jqls = [];
      if (key) jqls.push(`${base} AND project = ${jqlString(key)}`);
      if (ws.length) jqls.push(`${base} AND ${ws.map((w) => `summary ~ ${jqlString(`${w}*`)}`).join(' AND ')}`);
      if (ws.length > 1) jqls.push(`${base} AND (${ws.map((w) => `summary ~ ${jqlString(`${w}*`)}`).join(' OR ')})`);
      if (!jqls.length) jqls.push(base);
      const seen = new Set();
      for (const r of await Promise.all(jqls.map((j) => run(j, 300)))) for (const i of r.issues) if (!seen.has(i.id)) { seen.add(i.id); list.push(map(i)); }
      list = rankCandidates(list, qtext, 200);
    }
  } else {
    const page = (startAt, query) => jira('user', '/rest/api/3/project/search', { query: { ...(query ? { query } : {}), startAt, maxResults: 100, expand: 'lead' } }).catch(() => ({ values: [], isLast: true }));
    const map = (p) => ({ ref: `space:${p.id}`, key: p.key, name: p.name, owner: userOf(p.lead), avatar: p.avatarUrls?.['24x24'] || null });
    if (wantPool || !qtext) {
      for (let at = 0; at < POOL_MAX; at += 100) {
        const r = await page(at);
        list.push(...(r.values || []).map(map));
        if (r.isLast !== false || !(r.values || []).length) break;
        if (at + 100 >= POOL_MAX) truncated = true;
      }
    } else {
      // Jira finds spaces whose key or name contains the text; the words alone catch the rest
      const qs = [...new Set([qtext, keyPrefixOf(qtext), ...searchWords(qtext)].filter(Boolean))].slice(0, 4);
      const seen = new Set();
      for (const r of await Promise.all(qs.map((q) => page(0, q)))) for (const p of r.values || []) if (!seen.has(p.id)) { seen.add(p.id); list.push(map(p)); }
      list = rankCandidates(list, qtext, 200);
    }
  }
  list = list.filter((c) => !inPortfolio.has(c.ref));
  return wantPool ? { items: list, truncated } : list.slice(0, 40);
});

def('portfolio.add', async ({ payload, ctx, cfg, roles }) => {
  requireRole(roles, 'manageRanking');
  const ref = payload.ref;
  assert(typeof ref === 'string' && REF_RE.test(ref), 'ref invalid');
  assert(ref.startsWith(cfg.portfolio.source === 'issue' ? 'issue:' : 'space:'), 'ref kind does not match the portfolio source');
  if (ref.startsWith('issue:')) {
    const i = await visibleIssue(ref.slice(6), ['issuetype']);
    assert(cfg.portfolio.issueTypeIds.includes(String(i.fields.issuetype.id)), 'only the configured portfolio issue type can be added');
  } else {
    await jira('user', `/rest/api/3/project/${ref.slice(6)}`);
  }
  const state = await portfolioState();
  if (state.items.some((x) => x.ref === ref)) return { added: false };
  assert(state.items.length < 2000, 'portfolio is full');
  state.items.push({ ref, addedAt: new Date().toISOString(), addedBy: ctx.accountId });
  // Jira's rank field first: when Jira refuses, the project is not added (no half-done change)
  await writeRanks(cfg, state.items, new Map(state.items.slice(0, -1).map((x, i) => [x.ref, i + 1])));
  await set(K.portfolio, state);
  await audit(await withName(ctx), 'portfolio.add', { ref, rank: state.items.length });
  return { added: true };
});

def('portfolio.remove', async ({ payload, ctx, cfg, roles }) => {
  requireRole(roles, 'manageRanking');
  const ref = payload.ref;
  assert(typeof ref === 'string' && REF_RE.test(ref), 'ref invalid');
  if (!(await visibleRefs([ref])).has(ref)) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  const state = await portfolioState();
  const prev = new Map(state.items.map((x, i) => [x.ref, i + 1]));
  if (!prev.has(ref)) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  state.items = state.items.filter((x) => x.ref !== ref);
  // the Jira rank fields first: when Jira refuses, the project stays (no half-done change)
  await writeRanks(cfg, state.items, prev);
  await clearRank(cfg, ref);
  await set(K.portfolio, state);
  await audit(await withName(ctx), 'portfolio.remove', { ref, rank: prev.get(ref) });
  return { removed: true };
});

// ---------- health (UC-12) ----------
// Visibility as the cockpit shows it: a JQL search as the user (the strictest and most consistent Jira check).
async function visibleIssue(issueId, fields) {
  const r = await searchAll('user', `id = ${issueId}`, fields, { limit: 1 });
  if (!r.issues.length) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  return r.issues[0];
}
async function ownerOf(cfg, ref) {
  if (ref.startsWith('issue:')) {
    // The project owner is the Assignee, or the custom field the admin mapped as "Owner".
    const fid = cfg.fields?.owner || 'assignee';
    const v = (await visibleIssue(ref.slice(6), [fid])).fields[fid];
    return (Array.isArray(v) ? v[0] : v)?.accountId || null;
  }
  return (await jira('user', `/rest/api/3/project/${ref.slice(6)}`, { query: { expand: 'lead' } })).lead?.accountId || null;
}
// Each update keeps the records before it (a few levels), so undo restores the earlier health exactly – status,
// comment, date and author – instead of writing it again as a new update. Only your own latest update can be undone.
const HEALTH_DEPTH = 5;
// the earlier records stay on the server – the browser only ever gets the current one
export const publicHealth = (h) => { if (!h) return null; const { prev, ...rest } = h; return rest; };
const keepPrev = (h, depth = HEALTH_DEPTH) => (h && depth > 0 ? { ...h, prev: keepPrev(h.prev, depth - 1) } : null);
def('health.set', async ({ payload, ctx, cfg, roles }) => {
  const { ref, status } = payload;
  assert(typeof ref === 'string' && REF_RE.test(ref), 'ref invalid');
  if (payload.restore === true) {
    await healthGuard(cfg, ref, ctx, roles);
    const health = (await get(K.health)) || {};
    const cur = health[ref] || null;
    assert(cur && cur.by === ctx.accountId, 'only your own latest health update can be undone');
    if (cur.prev) health[ref] = cur.prev; else delete health[ref];
    await set(K.health, health);
    await audit(await withName(ctx), 'health.undo', { ref, to: health[ref]?.status || null });
    return publicHealth(health[ref]);
  }
  const comment = typeof payload.comment === 'string' ? payload.comment.trim() : '';
  assert(HEALTH.includes(status), 'status invalid');
  assert(comment.length >= 1 && comment.length <= 280, 'comment must have 1-280 characters');
  await healthGuard(cfg, ref, ctx, roles); // proves the caller can see it and may update it
  await withName(ctx);
  const health = (await get(K.health)) || {};
  const prev = health[ref] || null;
  health[ref] = { status, comment, at: new Date().toISOString(), by: ctx.accountId, byName: ctx.displayName, prev: keepPrev(prev) };
  await set(K.health, health);
  await audit(ctx, 'health.update', { ref, from: prev?.status || null, to: status });
  return publicHealth(health[ref]);
});

async function healthGuard(cfg, ref, ctx, roles) {
  assert(typeof ref === 'string' && REF_RE.test(ref), 'ref invalid');
  const owner = await ownerOf(cfg, ref).catch(() => { throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' }); });
  const state = await portfolioState();
  if (!state.items.some((x) => x.ref === ref)) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  if (!(owner === ctx.accountId || roles.editHealth || roles.manageRanking)) throw new AccessError('NO_ACCESS:editHealth');
}
def('health.clear', async ({ payload, ctx, cfg, roles }) => {
  await healthGuard(cfg, payload.ref, ctx, roles);
  const health = (await get(K.health)) || {};
  const prev = health[payload.ref] || null;
  delete health[payload.ref];
  await set(K.health, health);
  await audit(await withName(ctx), 'health.update', { ref: payload.ref, from: prev?.status || null, to: null });
  return { ok: true };
});

// ---------- AI (Forge LLM, grounded in what the caller may see) ----------
// OFF unless a Jira admin switched it on (Configuration › KI & Datenschutz). The gate is the very first step:
// with AI off nothing is read, counted or sent – the call ends here.
const langOf = (v) => (v === 'en' ? 'en' : 'de');
function requireAi(cfg, feature) {
  if (!aiAllowed(cfg, feature)) throw Object.assign(new Error('AI_DISABLED'), { code: 'AI_DISABLED' });
}
def('ai.ask', async ({ payload, ctx, cfg, roles }) => {
  requireAi(cfg, 'ask');
  assert(cfg.setupComplete, 'setup required');
  const question = isStr(payload.question) ? payload.question.trim() : '';
  assert(question.length >= 2 && question.length <= 500, 'question must have 2-500 characters');
  const ref = isStr(payload.ref) && REF_RE.test(payload.ref) ? payload.ref : null;
  await takeQuota(ctx.accountId, cfg);
  const ds = await buildDataset({ as: 'user', cfg, roles, accountId: ctx.accountId });
  ds.config = publicConfig(cfg);
  ds.supportComputed = await scopeSupport(ds.supportComputed, roles);
  return aiAsk(ds, question, ref, langOf(payload.lang), cfg);
});
def('ai.healthDraft', async ({ payload, ctx, cfg, roles }) => {
  requireAi(cfg, 'healthDraft');
  await healthGuard(cfg, payload.ref, ctx, roles);
  await takeQuota(ctx.accountId, cfg);
  const ds = await buildDataset({ as: 'user', cfg, roles, accountId: ctx.accountId });
  ds.config = publicConfig(cfg);
  ds.supportComputed = await scopeSupport(ds.supportComputed, roles);
  return aiHealthDraft(ds, payload.ref, langOf(payload.lang), cfg);
});
def('ai.reportSummary', async ({ payload, ctx, cfg, roles }) => {
  requireAi(cfg, 'reportSummary');
  requireRole(roles, 'viewReport');
  const report = reportForViewer(await reportOfCaller(ctx, cfg), roles); // only the projects the caller may browse
  assert(report, 'no report yet');
  await takeQuota(ctx.accountId, cfg);
  return aiReportSummary(report, langOf(payload.lang), cfg);
});

// ---------- data quality fills (UC-13) ----------
const FILL_USAGES = ['team', 'originalEstimate', 'startDate', 'dueDate', 'tshirt', 'targetQuarters'];
function checkFillValue(usage, value, cfg) {
  switch (usage) {
    case 'team': return safeKey(value, /^[A-Za-z0-9:-]{1,64}$/);
    case 'originalEstimate': return typeof value === 'number' && value > 0 && value <= 10000;
    case 'startDate': case 'dueDate': return isStr(value) && DATE_RE.test(value);
    case 'tshirt': return typeof value === 'string' && cfg.tshirtSizes.some((t) => t.key === sizeKey(value));
    case 'targetQuarters': return Array.isArray(value) && value.length >= 1 && value.length <= 8 && value.every((q) => typeof q === 'string' && Q_RE.test(q));
    default: return false;
  }
}
async function optionFor(issueId, fieldId, wanted) {
  const meta = await jira('user', `/rest/api/3/issue/${issueId}/editmeta`);
  const f = meta.fields?.[fieldId];
  if (!f) throw new AccessError('FIELD_NOT_EDITABLE');
  const opts = f.allowedValues || [];
  const norm = (s) => String(s).toUpperCase().replace(/\s+/g, '');
  const pick = (w) => opts.find((o) => norm(o.value ?? o.name) === norm(w)) || opts.find((o) => norm(o.value ?? o.name).startsWith(norm(w)));
  return { multi: f.schema?.type === 'array', pick };
}
// A fill that would write what the field already holds (exact match; sizes and quarters as sets) – skipped.
function sameFill(prev, next) {
  if (prev == null || next == null) return prev == null && next == null;
  if (Array.isArray(prev) || Array.isArray(next)) return Array.isArray(prev) && Array.isArray(next) && [...new Set(prev)].sort().join('|') === [...new Set(next)].sort().join('|');
  if (typeof prev === 'object' || typeof next === 'object') return false; // estimates: original + remaining, always written
  return String(prev) === String(next);
}
def('issue.fill', async ({ payload, ctx, cfg, roles }) => {
  const { issueId, usage, value, ref } = payload;
  assert(FILL_USAGES.includes(usage), 'usage invalid');
  // Undo sends { restore } with the previous value this call returned (null = it was empty).
  const restoring = Object.prototype.hasOwnProperty.call(payload, 'restore');
  const restore = restoring ? payload.restore : undefined;
  const hours = (h) => h == null || (Number.isFinite(h) && h >= 0 && h <= 100000);
  if (restoring && restore !== null) {
    if (usage === 'originalEstimate') assert(typeof restore === 'object' && hours(restore.oe) && hours(restore.re), 'restore invalid');
    else assert(checkFillValue(usage, restore, cfg), 'restore invalid');
  }
  const clear = payload.clear === true || (restoring && usage !== 'originalEstimate' && restore === null);
  const val = restoring && !clear ? restore : value;
  assert(clear || restoring || checkFillValue(usage, value, cfg), 'value invalid');
  const app = await appFieldIds();
  const F = resolvedFields(cfg, app);
  // Space-mode rough planning lives on the portfolio item itself (app storage).
  if (ref) {
    assert(typeof ref === 'string' && /^space:\d{1,18}$/.test(ref) && ['tshirt', 'targetQuarters', 'team', 'dueDate'].includes(usage), 'item fill invalid');
    const owner = await ownerOf(cfg, ref).catch(() => { throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' }); });
    const state = await portfolioState();
    if (!state.items.some((x) => x.ref === ref)) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
    if (!(owner === ctx.accountId || roles.editPlan || roles.manageRanking)) throw new AccessError('NO_ACCESS:editPlan');
    const plans = (await get(K.spacePlans)) || {};
    const id = ref.slice(6);
    const p = { ...(plans[id] || {}) };
    const previous = usage === 'tshirt' ? p.tshirt ?? null : usage === 'targetQuarters' ? (p.quarters?.length ? p.quarters : null) : usage === 'dueDate' ? p.due ?? null : p.leadTeam?.id ?? null;
    if (sameFill(previous, clear ? null : val)) return { ok: true, previous, unchanged: true };
    if (usage === 'tshirt') p.tshirt = clear ? null : val;
    if (usage === 'targetQuarters') p.quarters = clear ? [] : [...new Set(val)].sort();
    if (usage === 'dueDate') p.due = clear ? null : val;
    if (usage === 'team') p.leadTeam = clear ? null : { id: val };
    plans[id] = p;
    await set(K.spacePlans, plans);
    await audit(await withName(ctx), restoring ? 'plan.update.undo' : 'plan.update', { ref, usage, from: previous, to: clear ? null : val });
    return { ok: true, previous };
  }
  assert(typeof issueId === 'string' && /^\d{1,18}$/.test(issueId), 'issueId invalid');
  const appOwnedField = (usage === 'tshirt' && cfg.fields.tshirt === 'app') ? app.tshirt : (usage === 'targetQuarters' && cfg.fields.targetQuarters === 'app') ? app.targetQuarters : null;
  const prevField = { team: F.team, startDate: F.startDate, dueDate: 'duedate', originalEstimate: 'timetracking', tshirt: appOwnedField || F.tshirt, targetQuarters: appOwnedField || F.targetQuarters }[usage];
  const issue = await visibleIssue(issueId, ['issuetype', prevField].filter(Boolean)); // NOT_FOUND unless the user can see it in search
  const pv = prevField ? issue.fields[prevField] : null;
  const asQuarters = (v) => (Array.isArray(v) ? v.map((o) => o?.value ?? o) : typeof v === 'string' ? v.split(/\s*,\s*/) : []).filter((q) => Q_RE.test(q));
  const previous = pv == null ? null
    : usage === 'team' ? pv.id ?? (isStr(pv) ? pv : null)
      : usage === 'originalEstimate' ? { oe: pv.originalEstimateSeconds ? pv.originalEstimateSeconds / 3600 : null, re: pv.remainingEstimateSeconds != null ? pv.remainingEstimateSeconds / 3600 : null }
        : usage === 'tshirt' ? (pv?.value ?? (isStr(pv) ? pv : null))
          : usage === 'targetQuarters' ? (asQuarters(pv).length ? asQuarters(pv) : null)
            : isStr(pv) ? pv : null;
  // a locked sub-task estimate says so – also when the value happens to be the same (live 2026-11-24: "unchanged" came
  // first and the lock was never mentioned)
  const level = (cfg.levels || []).find((l) => l.issueTypeIds.includes(String(issue.fields.issuetype.id)));
  const isTiny = level ? level.role === 'tiny' : issue.fields.issuetype.hierarchyLevel === -1;
  if (usage === 'originalEstimate' && isTiny && cfg.rules.lockSubtasks) throw Object.assign(new Error('SUBTASK_LOCKED'), { code: 'SUBTASK_LOCKED' });
  // the field already holds this value (the same fill sent twice): nothing to write, nothing to log
  if (sameFill(previous, clear ? null : val)) return { ok: true, previous, unchanged: true };
  const appOwned = (usage === 'tshirt' && cfg.fields.tshirt === 'app') || (usage === 'targetQuarters' && cfg.fields.targetQuarters === 'app');
  if (appOwned) {
    if (!(await canEditIssue(issueId))) throw new AccessError('NO_EDIT_PERMISSION');
    const fieldId = usage === 'tshirt' ? app.tshirt : app.targetQuarters;
    assert(fieldId, 'app field missing');
    const v = clear ? null : usage === 'tshirt' ? val : [...new Set(val)].sort().join(', ');
    await jira('app', `/rest/api/3/app/field/${fieldId}/value`, { method: 'PUT', body: { updates: [{ issueIds: [Number(issueId)], value: v }] } });
    await audit(await withName(ctx), restoring ? 'issue.fill.undo' : 'issue.fill', { issueId, usage, key: issue.key, from: previous, to: clear ? null : val });
    return { ok: true, previous };
  }
  const fields = {};
  let update;
  if (usage === 'team') { assert(F.team, 'no team field configured'); fields[F.team] = clear ? null : val; }
  if (usage === 'originalEstimate') {
    // Undo puts original AND remaining estimate back exactly as they were (filling an empty
    // estimate lets Jira copy it into the remaining estimate, so both may have changed).
    const m = (h) => `${Math.round(h * 60)}m`;
    if (restoring) update = { timetracking: [{ edit: { originalEstimate: restore?.oe ? m(restore.oe) : '', remainingEstimate: restore?.re != null ? m(restore.re) : '' } }] };
    else if (clear) update = { timetracking: [{ edit: { originalEstimate: '', remainingEstimate: '' } }] };
    else fields.timetracking = { originalEstimate: m(val) };
  }
  if (usage === 'startDate') { assert(F.startDate, 'no start date field configured'); fields[F.startDate] = clear ? null : val; }
  if (usage === 'dueDate') fields.duedate = clear ? null : val;
  if ((usage === 'tshirt' || usage === 'targetQuarters') && clear) fields[usage === 'tshirt' ? F.tshirt : F.targetQuarters] = null;
  else if (usage === 'tshirt' || usage === 'targetQuarters') {
    const fid = usage === 'tshirt' ? F.tshirt : F.targetQuarters;
    assert(fid, 'field not configured');
    const { multi, pick } = await optionFor(issueId, fid, val);
    const vals = (Array.isArray(val) ? val : [val]).map((v) => pick(v)).filter(Boolean).map((o) => ({ id: o.id }));
    assert(vals.length, 'no matching option');
    fields[fid] = multi ? vals : vals[0];
  }
  // Written as the user: Jira enforces edit permissions, screens and field configuration.
  const body = update ? { update } : { fields };
  await jira('user', `/rest/api/3/issue/${issueId}`, { method: 'PUT', body, query: { notifyUsers: false } }).catch(async (e) => {
    if (e.status === 400 && /notifyUsers/i.test(e.message)) return jira('user', `/rest/api/3/issue/${issueId}`, { method: 'PUT', body });
    throw e;
  });
  await audit(await withName(ctx), restoring ? 'issue.fill.undo' : 'issue.fill', { issueId, usage, key: issue.key, from: previous, to: clear ? null : val });
  return { ok: true, previous };
});

// ---------- the parent of a work item WITHOUT one (boss 2026-11-19: parentless stories belong in the project) ----------
// { issueId, parentId }: sets the parent – only when the work item has none (the cockpit never re-parents structure).
// { issueId, clear: true, expect }: the undo – removes the parent again, only while it is still the one that was set.
// Written AS THE USER: Jira checks edit permission and that the hierarchy fits (a story under an epic, …).
const ID_RE = /^\d{1,18}$/;
def('issue.parent', async ({ payload, ctx }) => {
  const { issueId, parentId, clear, expect } = payload;
  assert(typeof issueId === 'string' && ID_RE.test(issueId), 'issueId invalid');
  const undo = clear === true;
  assert(undo ? typeof expect === 'string' && ID_RE.test(expect) : typeof parentId === 'string' && ID_RE.test(parentId) && parentId !== issueId, 'parentId invalid');
  const issue = await visibleIssue(issueId, ['parent', 'issuetype']); // NOT_FOUND unless the user can see it
  const previous = issue.fields.parent?.id ? String(issue.fields.parent.id) : null;
  if (undo) {
    if (previous == null) return { ok: true, previous: null, unchanged: true };
    if (previous !== expect) throw Object.assign(new BadRequest('PARENT_CHANGED'), { code: 'PARENT_CHANGED' });
  } else {
    if (previous === parentId) return { ok: true, previous, unchanged: true };
    if (previous) throw Object.assign(new BadRequest('HAS_PARENT'), { code: 'HAS_PARENT' });
    await visibleIssue(parentId, ['issuetype']); // the parent must be visible to the user as well
  }
  if (!(await canEditIssue(issueId))) throw new AccessError('NO_EDIT_PERMISSION');
  const body = { fields: { parent: undo ? null : { id: parentId } } };
  await jira('user', `/rest/api/3/issue/${issueId}`, { method: 'PUT', body, query: { notifyUsers: false } }).catch(async (e) => {
    if (e.status === 400 && /notifyUsers/i.test(e.message)) return jira('user', `/rest/api/3/issue/${issueId}`, { method: 'PUT', body });
    throw e;
  });
  await audit(await withName(ctx), undo ? 'issue.parent.undo' : 'issue.parent', { issueId, key: issue.key, from: previous, to: undo ? null : parentId });
  return { ok: true, previous, key: issue.key };
});

// ---------- capacity (UC-14) ----------
def('capacity.get', async ({ cfg, roles }) => {
  requireRole(roles, 'editCapacity');
  const cap = (await get(K.capacity)) || { people: {}, teams: {}, absences: [] };
  // people with capacity plus the teams' responsible people (they may sit in another team or none)
  const ids = [...new Set([...Object.keys(cap.people || {}), ...Object.values(cap.teams || {}).flatMap((t) => t?.responsible || [])])];
  const people = {};
  for (const c of chunk(ids, 50)) {
    try { const r = await jira('user', '/rest/api/3/user/bulk', { query: { accountId: c, maxResults: 50 } }); for (const u of r.values || []) people[u.accountId] = userOf(u); } catch { /* ignore */ }
  }
  const app = await appFieldIds();
  const support = await loadSupport(cfg, app).catch(() => null);
  return { capacity: cap, people, supportByTeam: Object.fromEntries((support?.teams || []).map((t) => [t.teamId, t.weekly])), locations: LOCATIONS };
});
def('capacity.save', async ({ payload, ctx, cfg, roles }) => {
  requireRole(roles, 'editCapacity');
  const c = payload.capacity || {};
  assert(JSON.stringify(c).length < 200000, 'capacity too large');
  const people = {};
  // UC-09: a location is a calendar code (LOCATIONS) or the id of a location from the configuration
  const locIds = new Set((Array.isArray(cfg?.locations) ? cfg.locations : []).map((l) => l?.id).filter(Boolean));
  for (const [id, p] of Object.entries(c.people || {}).slice(0, 2000)) {
    assert(safeKey(id, /^[A-Za-z0-9:_-]{1,128}$/), 'person id invalid');
    // UC-14: split across teams [{ teamId, pct }] – whole 1–100 %, unique teams, at most 6, together at most 100 %
    const split = Array.isArray(p?.teams) ? p.teams.slice(0, 7) : [];
    const shares = split.filter((x) => safeKey(x?.teamId, /^[A-Za-z0-9:_-]{1,64}$/) && Number.isInteger(Number(x?.pct)) && Number(x.pct) >= 1 && Number(x.pct) <= 100).map((x) => ({ teamId: x.teamId, pct: Number(x.pct) }));
    assert(shares.length === split.length && shares.length <= 6 && new Set(shares.map((x) => x.teamId)).size === shares.length && shares.reduce((a, x) => a + x.pct, 0) <= 100, 'team shares invalid');
    const teamId = safeKey(p?.teamId, /^[A-Za-z0-9:_-]{1,64}$/) ? p.teamId : null;
    people[id] = {
      weeklyHours: Math.min(80, Math.max(0, Number(p?.weeklyHours) || 0)),
      location: Object.hasOwn(LOCATIONS, p?.location) || locIds.has(p?.location) ? p.location : 'NONE',
      // teamId stays the main team and is always one of the shares
      teamId: shares.length && !shares.some((x) => x.teamId === teamId) ? shares[0].teamId : teamId,
      ...(shares.length ? { teams: shares } : {}),
    };
  }
  const teams = {};
  for (const [id, t] of Object.entries(c.teams || {}).slice(0, 500)) {
    assert(safeKey(id, /^[A-Za-z0-9:_-]{1,64}$/), 'team id invalid');
    teams[id] = {
      name: typeof t?.name === 'string' ? t.name.slice(0, 120) : id,
      dailyBusinessPct: Math.min(95, Math.max(0, Number(t?.dailyBusinessPct) || 0)),
      // internal work is limited so Tagesgeschäft + intern never take more than 95 % of the week
      internalPct: Math.min(95 - Math.min(95, Math.max(0, Number(t?.dailyBusinessPct) || 0)), Math.max(0, Number(t?.internalPct) || 0)),
      absenceRatePct: Math.min(95, Math.max(0, Number(t?.absenceRatePct) || 0)),
      extraWeeklyHours: Math.min(4000, Math.max(0, Number(t?.extraWeeklyHours) || 0)),
      // UC-08/UC-14: who is responsible for the team (privacy scope "own teams", booking escalations)
      responsible: [...new Set((Array.isArray(t?.responsible) ? t.responsible : []).filter((x) => safeKey(x, /^[A-Za-z0-9:_-]{1,128}$/)))].slice(0, 20),
      // UC-17: support reserve set by hand (h/week); null = automatic (measured average)
      supportOverride: t?.supportOverride == null || t.supportOverride === '' ? null : Math.min(80 * 50, Math.max(0, Number(t.supportOverride) || 0)),
    };
  }
  const absences = (Array.isArray(c.absences) ? c.absences : []).slice(0, 5000).map((a) => {
    assert(a && safeKey(a.accountId, /^[A-Za-z0-9:_-]{1,128}$/) && isStr(a.from) && isStr(a.to) && DATE_RE.test(a.from) && DATE_RE.test(a.to) && a.from <= a.to, 'absence invalid');
    // Sickness is stored only as "absent" without a reason (GDPR).
    return { id: typeof a.id === 'string' ? a.id.slice(0, 40) : Math.random().toString(36).slice(2), accountId: a.accountId, from: a.from, to: a.to, type: ['vacation', 'training'].includes(a.type) ? a.type : 'absent' };
  });
  await set(K.capacity, { people, teams, absences });
  await audit(await withName(ctx), 'capacity.update', { people: Object.keys(people).length, teams: Object.keys(teams).length, absences: absences.length });
  return { ok: true };
});
def('users.search', async ({ payload, roles }) => {
  if (!roles.editCapacity && !roles.admin) throw new AccessError();
  const query = typeof payload.query === 'string' ? payload.query.slice(0, 60) : '';
  if (query.length < 2) return [];
  const r = await jira('user', '/rest/api/3/user/search', { query: { query, maxResults: 20 } });
  return (r || []).filter((u) => u.accountType === 'atlassian' && u.active).map(userOf);
});

// ---------- C-level report (UC-06) ----------
async function computeReportWith(cfg) {
  const ds = await buildDataset({ as: 'app', cfg });
  ds.config = publicConfig(cfg);
  const report = cLevelReport(ds);
  // the plan's six key figures and sections (UC-06): waits-for, capacity by rank per quarter, next 4 weeks, plan vs. actual
  try { Object.assign(report, reportExtras(computeAll(ds), cfg, await planActual({ weeks: 4, team: 'all' }, { cfg }).catch(() => null))); } catch (e) { logError('[report:extras]', e); }
  await set(K.report, report);
  await recordHistory(ds).catch(() => {}); // never let the record break the report
  return { report, ds };
}
async function computeReport(cfg) { return (await computeReportWith(cfg)).report; }

// ---------- what the caller may see of the app's snapshots (report, its history, plan vs. actual) ----------
// The snapshots are computed AS THE APP over every portfolio item. A caller only ever gets the items they may browse
// in Jira – the same items, in the same dense ranks, as their Portfolio (which reads as the user). Asked as the user,
// cached per account for a few minutes (src/lib/reportScope.js).
const visibleFor = (ctx, refs) => callerVisible(ctx.accountId, refs, { jira, searchAll });
async function scopeFor(ctx, refs = []) {
  const order = (await portfolioState()).items.map((x) => x.ref);
  const all = [...new Set([...order, ...refs])];
  return callerScope(order, await visibleFor(ctx, all), all);
}
const paScope = (ctx) => (refs) => scopeFor(ctx, refs);
// The report as the caller may see it (before reportForViewer): the stored snapshot when every item it covers is
// visible to them; otherwise recomputed as the app for their visible items only – every total, rank, the waterline and
// plan vs. actual from those items, never rows stripped from totals that still hold a hidden project. Never stored.
const SCOPED_TTL_MS = 10 * 60e3;
const scopedMemo = new Map();
async function reportOfCaller(ctx, cfg, { refresh = false } = {}) {
  let stored = await get(K.report);
  let fresh = null;
  if ((!stored || (refresh && !(Date.now() - Date.parse(stored.asOf) < 5 * 60e3))) && cfg.setupComplete) { fresh = await computeReportWith(cfg); stored = fresh.report; }
  if (!stored) return stored;
  const scope = await scopeFor(ctx, reportRefs(stored));
  if (!scope.hidden.size) return stored;
  const key = [ctx.accountId, stored.asOf, ...[...scope.hidden].sort()].join('|');
  const hit = scopedMemo.get(key);
  if (hit && Date.now() - hit.at < SCOPED_TTL_MS) return hit.report;
  const ds = fresh?.ds || Object.assign(await buildDataset({ as: 'app', cfg }), { config: publicConfig(cfg) });
  const pa = await planActual({ weeks: 4, team: 'all' }, { cfg, scope: paScope(ctx) }).catch(() => null);
  const report = scopedReport(scopeDataset(ds, scope.visible), cfg, pa);
  for (const [k, v] of scopedMemo) if (Date.now() - v.at >= SCOPED_TTL_MS || scopedMemo.size > 30) scopedMemo.delete(k);
  scopedMemo.set(key, { at: Date.now(), report });
  return report;
}
// Names, keys and refs of the items the caller may not browse (from the stored snapshot) – kept out of what they send on.
async function hiddenTermsFor(ctx) {
  const stored = await get(K.report);
  if (!stored) return [];
  return hiddenTerms(stored, (await scopeFor(ctx, reportRefs(stored))).hidden);
}
// A composer draft as the caller may see it now: sections that name an item they cannot browse are left out.
async function draftForCaller(d, ctx) {
  if (!d?.doc || !Array.isArray(d.doc.sections)) return d || null;
  return scrubDraft(d, await hiddenTermsFor(ctx));
}
// One line per project and day: [OE, TS, RE, open T-shirt, Reife, done]. Aggregates only, no people.
const r1 = (n) => Math.round((n || 0) * 10) / 10;
async function recordHistory(ds) {
  const c = computeAll(ds, { skipWeeks: true });
  const day = ds.today, key = K.history(day.slice(0, 7));
  const month = (await get(key)) || {};
  month[day] = Object.fromEntries([...c.metrics.entries()].map(([ref, m]) => [ref, [r1(m.OE), r1(m.TS), r1(m.RE), r1(m.openTshirt), m.maturity == null ? null : Math.round(m.maturity * 1000) / 1000, m.done ? 1 : 0]]));
  await set(key, month);
}
// The recorded days of the last 6 months (for "Nachweis › Treffsicherheit").
def('history.get', async ({ ctx, roles }) => {
  requireRole(roles, 'viewReport'); // recorded as the app over all projects – same audience as the C-level report
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, k) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1)); return d.toISOString().slice(0, 7); });
  const parts = await Promise.all(months.map((m) => get(K.history(m))));
  const all = Object.assign({}, ...parts.filter(Boolean).reverse());
  // only the projects the caller may browse (as in their Portfolio)
  const visible = await visibleFor(ctx, [...new Set(Object.values(all).flatMap((d) => Object.keys(d || {})))]);
  return Object.fromEntries(Object.entries(all).map(([day, m]) => [day, Object.fromEntries(Object.entries(m || {}).filter(([ref]) => visible.has(ref)))]));
});
// Only the projects the caller may browse (reportOfCaller); people only for viewers who may see individual values of all teams.
def('report.get', async ({ ctx, cfg, roles }) => {
  requireRole(roles, 'viewReport');
  return reportForViewer(await reportOfCaller(ctx, cfg), roles);
});
def('report.refresh', async ({ ctx, cfg, roles }) => {
  requireRole(roles, 'viewReport');
  return reportForViewer(await reportOfCaller(ctx, cfg, { refresh: true }), roles);
});
def('confluence.spaces', async ({ payload, cfg, roles }) => {
  requireRole(roles, 'viewReport');
  try {
    const allowed = new Set((cfg.report?.publishSpaces || []).map((x) => x.id));
    const r = await confluence('/wiki/api/v2/spaces', { query: { limit: 250, status: 'current' } });
    const q = typeof payload.query === 'string' ? payload.query.toLowerCase() : '';
    // R1: only admin-approved target spaces are offered (and only those the caller can see).
    return { available: true, approvedCount: allowed.size, spaces: (r.results || []).filter((s) => allowed.has(String(s.id))).filter((s) => !q || s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q)).map((s) => ({ id: s.id, key: s.key, name: s.name })) };
  } catch (e) {
    return { available: false, reason: e.status || e.message };
  }
});
def('report.publish', async ({ payload, ctx, cfg, roles }) => {
  requireRole(roles, 'viewReport');
  assert(typeof payload.spaceId === 'string' && /^\d{1,18}$/.test(payload.spaceId), 'space invalid');
  if (!(cfg.report?.publishSpaces || []).some((x) => x.id === payload.spaceId)) throw new AccessError('NO_ACCESS:publishSpace'); // R1
  const lang = payload.lang === 'en' ? 'en' : 'de';
  const report = reportForViewer(await reportOfCaller(ctx, cfg), roles); // what the caller may see, nothing more
  assert(report, 'no report yet');
  const title = (typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : `Portfolio Report ${report.today}`).slice(0, 200);
  const page = await confluence('/wiki/api/v2/pages', {
    method: 'POST',
    body: { spaceId: payload.spaceId, status: 'current', title, body: { representation: 'storage', value: reportStorageHtml(report, lang) } },
  });
  await audit(await withName(ctx), 'report.publish', { spaceId: payload.spaceId, pageId: page.id });
  return { id: page.id, url: page._links?.base ? page._links.base + page._links.webui : page._links?.webui || null };
});

// ---------- the report composer: draft per person, Confluence publishing of the COMPOSED report ----------
// The draft follows the person across devices (the browser keeps a copy as instant cache).
def('report.draft', async ({ ctx }) => draftForCaller((await get(K.reportDraft(ctx.accountId))) || null, ctx));

// The composer's document, published as a Confluence page. Nothing from the browser is trusted for numbers: the server
// drafts the same report again from a FRESH computation (the caller's dataset, the stored snapshot) and re-checks every
// section – a chip whose value changed, a number typed by hand that no fresh fact backs, a person's name anywhere: the
// page is not written and the problems come back (dryRun: only the check). Data blocks always come from the fresh draft.
// pageId (a page published from here before) updates that page; undo: report.unpublishComposed.
const PUB_BODY_MAX = 200_000;
async function planActualFor(payload, ctx, cfg, roles) {
  if (!(roles.admin || (roles.rights || []).includes('hours'))) throw new AccessError('NO_ACCESS:planActual');
  const logs = cfg.rules?.personLevel === false ? 'none' : roles.logs;
  const mine = logs === 'team' ? new Set(responsibleTeams({ accountId: ctx.accountId, capacity: await get(K.capacity) })) : null;
  // scope: only the projects the caller may browse, ranked as their Portfolio ranks them (hidden hours never appear)
  return planActual(payload, { cfg, canSeePerson: (teamId) => logs === 'all' || (logs === 'team' && !!teamId && mine.has(teamId)), scope: paScope(ctx) });
}
async function freshComposed(doc, ctx, cfg, roles) {
  const ds = await loadDataset(ctx, cfg, roles);
  const computed = computeAll(ds);
  const raw = await reportOfCaller(ctx, cfg); // only the projects the caller may browse
  // as the Report view does it: plan vs. actual only when the snapshot lacks it and the role may see it
  const pa = !raw.extra?.planActual && (roles.admin || (roles.rights || []).includes('hours')) ? await planActualFor({ weeks: 4, team: 'all' }, ctx, cfg, roles).catch(() => null) : null;
  let x = raw;
  if (!raw.extra) { try { x = { ...raw, ...reportExtras(computed, ds.config, pa) }; } catch { x = raw; } }
  const report = reportForViewer(x, roles);
  const lctx = { ds, computed, roles, me: { id: ctx.accountId }, config: ds.config, supportA: computed.supportA || null, cal: ds.config?.support?.sla, report, planActual: pa, now: Date.now(), lang: doc.lang };
  const fresh = draftReport({ ctx: lctx, audience: doc.audience, period: doc.quarter || 'current', teamId: doc.teamId, projectRef: doc.projectRef, lang: doc.lang, sections: doc.sections.map((s) => s.id) });
  const people = Object.values(ds.people || {}).map((p) => p?.name).filter(Boolean);
  return { fresh, people, hidden: await hiddenTermsFor(ctx) };
}
const cleanDoc = (d) => { try { return cleanComposed(d); } catch (e) { throw e instanceof PublishError ? new BadRequest(e.message) : e; } };
const pageUrl = (page) => (page?._links?.base ? page._links.base + page._links.webui : page?._links?.webui || null);
def('report.publishComposed', async ({ payload, ctx, cfg, roles }) => {
  requireRole(roles, 'viewReport');
  assert(cfg.setupComplete, 'setup required');
  const dryRun = payload.dryRun === true;
  if (!dryRun) {
    assert(typeof payload.spaceId === 'string' && /^\d{1,18}$/.test(payload.spaceId), 'space invalid');
    if (!(cfg.report?.publishSpaces || []).some((x) => x.id === payload.spaceId)) throw new AccessError('NO_ACCESS:publishSpace'); // R1
  }
  const doc = cleanDoc(payload.doc);
  assert(doc.sections.some((s) => s.on), 'nothing to publish');
  const { fresh, people, hidden } = await freshComposed(doc, ctx, cfg, roles);
  const v = verifyComposed(doc, fresh, { people });
  // a project the caller may not browse (e.g. from an older draft) never reaches the page – no fresh fact backs it
  const leaks = !hidden.length ? [] : [{ id: null, title: doc.title, text: [doc.title, doc.subtitle].join('\n') }, ...doc.sections.filter((x) => x.on).map((x) => ({ id: x.id, title: x.title, text: JSON.stringify([x.title, x.text, x.facts]) }))]
    .flatMap((x) => mentions(x.text, hidden).map((t) => ({ section: x.id, title: x.title, kind: 'unsourced', text: t })));
  if (leaks.length) { v.ok = false; v.problems = [...v.problems, ...leaks].slice(0, 40); }
  const checked = v.sections.length;
  if (!v.ok || dryRun) return { ok: v.ok, dryRun, checked, problems: v.problems };
  const html = composedStorage(v, { lang: doc.lang, subtitle: doc.subtitle, asOf: fresh.asOf, confidential: doc.confidential, people });
  assert(html.length <= PUB_BODY_MAX, 'report too large for one page');
  const title = (typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : doc.title || fresh.title).slice(0, 200);
  assert(!people.some((n) => n.length >= 4 && title.toLowerCase().includes(n.toLowerCase())), 'the page title names a person');
  const me = await withName(ctx);
  let page, rec;
  const pageId = typeof payload.pageId === 'string' && /^\d{1,18}$/.test(payload.pageId) ? payload.pageId : null;
  if (pageId) {
    // update a page published from here before: the previous body is kept for undo (restore the previous version)
    const old = await get(K.reportPage(pageId));
    if (!old || old.spaceId !== payload.spaceId) throw new AccessError('NO_ACCESS:reportPage');
    if (old.by !== ctx.accountId && !roles.admin) throw new AccessError('NO_ACCESS:reportPage');
    const prevBody = await get(K.reportPageBody(pageId, 'body'));
    page = await confluence(`/wiki/api/v2/pages/${pageId}`, { method: 'PUT', body: { id: pageId, status: 'current', title, body: { representation: 'storage', value: html }, version: { number: old.version + 1, message: 'Portfolio Cockpit – Lotse' } } });
    await set(K.reportPageBody(pageId, 'prev'), { title: old.title, html: prevBody || null });
    rec = { ...old, title, version: page?.version?.number || old.version + 1, at: new Date().toISOString(), withdrawn: false, mode: 'update' };
  } else {
    page = await confluence('/wiki/api/v2/pages', { method: 'POST', body: { spaceId: payload.spaceId, status: 'current', title, body: { representation: 'storage', value: html } } });
    await del(K.reportPageBody(String(page.id), 'prev')).catch(() => null);
    rec = { pageId: String(page.id), spaceId: payload.spaceId, title, version: page?.version?.number || 1, by: ctx.accountId, at: new Date().toISOString(), lang: doc.lang, url: pageUrl(page), mode: 'create' };
  }
  await set(K.reportPageBody(rec.pageId, 'body'), html);
  await set(K.reportPage(rec.pageId), rec);
  await audit(me, 'report.publishComposed', { spaceId: payload.spaceId, pageId: rec.pageId, mode: rec.mode, sections: checked, audience: doc.audience });
  return { ok: true, id: rec.pageId, pageId: rec.pageId, spaceId: rec.spaceId, url: pageUrl(page) || rec.url || null, mode: rec.mode, version: rec.version, checked };
});
// Undo of the last publish: an update → the previous version is restored (as a new version, Confluence keeps the
// history); a first publish → the page is withdrawn (title marked, content replaced by a note). The app may create
// and update pages but not delete them (no delete permission) – deleting stays in Confluence.
def('report.unpublishComposed', async ({ payload, ctx, roles }) => {
  requireRole(roles, 'viewReport');
  const pageId = typeof payload.pageId === 'string' && /^\d{1,18}$/.test(payload.pageId) ? payload.pageId : null;
  assert(pageId, 'pageId');
  const rec = await get(K.reportPage(pageId));
  if (!rec) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  if (rec.by !== ctx.accountId && !roles.admin) throw new AccessError('NO_ACCESS:reportPage');
  assert(!rec.withdrawn, 'already withdrawn');
  const prev = rec.mode === 'update' ? await get(K.reportPageBody(pageId, 'prev')) : null;
  const L = rec.lang === 'en' ? 'en' : 'de';
  // restoring a version that names a project the caller may not browse would publish it again: withdraw instead
  const hidden = prev?.html ? await hiddenTermsFor(ctx) : [];
  const restore = !!prev?.html && !mentions([prev.title || '', prev.html].join('\n'), hidden).length;
  const title = restore ? prev.title : `${rec.title} – ${L === 'en' ? 'withdrawn' : 'zurückgezogen'}`.slice(0, 255);
  const value = restore ? prev.html : withdrawnStorage(L);
  const page = await confluence(`/wiki/api/v2/pages/${pageId}`, { method: 'PUT', body: { id: pageId, status: 'current', title, body: { representation: 'storage', value }, version: { number: rec.version + 1, message: 'Portfolio Cockpit – undo' } } });
  const next = { ...rec, title, version: page?.version?.number || rec.version + 1, at: new Date().toISOString(), withdrawn: !restore, mode: restore ? 'create' : rec.mode };
  if (restore) { await set(K.reportPageBody(pageId, 'body'), prev.html); await del(K.reportPageBody(pageId, 'prev')); }
  await set(K.reportPage(pageId), next);
  await audit(await withName(ctx), 'report.publishComposed.undo', { pageId, mode: restore ? 'restore' : 'withdraw' });
  return { pageId, mode: restore ? 'restore' : 'withdraw', url: pageUrl(page) || rec.url || null };
});

// ---------- reminders on request (Lotse's notice.remind) ----------
// Capacity editors and Jira admins; only while a Jira admin switched notices on. The existing gap / booking reminder,
// at most one per person, kind and day, audited; dryRun = how many would get one (src/lib/notices.js remindPeople).
const ACC_RE = /^[A-Za-z0-9:_-]{1,128}$/;
def('notices.remind', async ({ payload, ctx, cfg, roles }) => {
  if (!(roles.admin || roles.editCapacity)) throw new AccessError('NO_ACCESS:a_cap');
  assert(cfg.setupComplete, 'setup required');
  assert(['booking', 'gaps'].includes(payload.kind), 'kind');
  const ids = Array.isArray(payload.accountIds) ? payload.accountIds : [];
  assert(ids.length >= 1 && ids.length <= 100 && ids.every((id) => isStr(id) && ACC_RE.test(id) && !BAD_KEYS.has(id)), 'accountIds');
  const me = payload.dryRun === true ? ctx : await withName(ctx);
  return remindPeople(cfg, { kind: payload.kind, accountIds: ids, dryRun: payload.dryRun === true }, {
    loadGaps: async () => computeAll({ ...(await buildDataset({ as: 'app', cfg })), config: cfg }).dq.gaps,
    loadData: async (period) => {
      const ds = { ...(await buildDataset({ as: 'app', cfg })), config: cfg };
      const { model } = computeAll(ds, { skipWeeks: true });
      const { worklogs } = await fetchWorklogs(period.from, period.to);
      return { ds, worklogs, model, overview: (m, booked, p) => bookingOverview(m, booked, dayIdx(p.from), dayIdx(p.to), cfg) };
    },
    audit: (details) => audit(me, 'notices.remind', details),
  });
});

// ---------- configuration (UC-07/08/09/15/17) — Jira admins only ----------
def('config.get', async ({ cfg, roles }) => {
  requireRole(roles, 'admin');
  const [types, fields, links] = await Promise.all([
    jira('user', '/rest/api/3/issuetype'), jira('user', '/rest/api/3/field'), jira('user', '/rest/api/3/issueLinkType').catch(() => ({ issueLinkTypes: [] })), // linking may be off
  ]);
  const app = await appFieldIds(true).catch(() => ({}));
  return {
    config: cfg, milestones: (await get(K.milestones)) || [],
    meta: {
      issueTypes: types.filter((t) => !t.scope).map((t) => ({ id: t.id, name: t.name, level: t.hierarchyLevel, icon: t.iconUrl })),
      fields: fields.filter((f) => f.custom).map((f) => ({ id: f.id, name: f.name, type: f.schema?.type || null, items: f.schema?.items || null, custom: f.schema?.custom || null })),
      staleFields: staleFields(cfg, fields),
      linkTypes: (links?.issueLinkTypes || []).map((l) => ({ id: l.id, name: l.name, outward: l.outward, inward: l.inward })),
      priorities: await jira('user', '/rest/api/3/priority/search', { query: { maxResults: 50 } }).then((p) => (p.values || []).map((x) => ({ id: x.id, name: x.name, icon: x.iconUrl }))).catch(() => []),
      appFields: app, locations: LOCATIONS,
      // statuses for the "Blocked" setting (one entry per name; ids of same-named statuses grouped)
      statuses: await jira('user', '/rest/api/3/status').then((list) => {
        const byName = new Map();
        for (const x of list || []) {
          const k = String(x.name || '').trim();
          const e = byName.get(k.toLowerCase()) || byName.set(k.toLowerCase(), { name: k, ids: [], category: x.statusCategory?.key || null }).get(k.toLowerCase());
          e.ids.push(String(x.id));
        }
        return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
      }).catch(() => []),
    },
  };
});

// ---------- booked time (Time Spent vs. Estimate › booking check) ----------
// Every worklog the user may see whose start lies in [from, to] – on any work item, not only portfolio work,
// so nobody is flagged for time booked elsewhere. Person-level values: only with the person level switched on
// and only for people who manage capacity, see the C-level report or administer the app.
const BOOK_MAX_DAYS = 124, BOOK_MAX_LOGS = 40000;
def('booking.worklogs', async ({ payload, ctx, cfg, roles }) => {
  // privacy (UC-08): individual values only for the teams the role may see; other teams come back as sums
  if (roles.logs === 'none') throw new AccessError('NO_ACCESS:booking');
  if (cfg.rules?.personLevel === false) throw new AccessError('NO_ACCESS:personLevel');
  const { from, to } = payload || {};
  assert(isStr(from) && isStr(to) && DATE_RE.test(from) && DATE_RE.test(to) && from <= to, 'range invalid');
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T23:59:59Z`);
  assert(b - a <= BOOK_MAX_DAYS * 864e5, 'range too long');
  // worklogs created or changed since the start (a day earlier for time zones), then their details
  const ids = [];
  let since = a - 864e5, lastPage = false, truncated = false;
  for (let guard = 0; !lastPage && guard < 60; guard++) {
    const r = await jira('user', '/rest/api/3/worklog/updated', { query: { since } });
    for (const v of r.values || []) ids.push(v.worklogId);
    lastPage = r.lastPage !== false;
    if (!r.until || r.until <= since) break;
    since = r.until;
    if (ids.length >= BOOK_MAX_LOGS) { truncated = true; break; }
  }
  const people = {};
  await pool(chunk([...new Set(ids)].slice(0, BOOK_MAX_LOGS), 1000).filter((c) => c.length), 3, async (c) => {
    const list = await jira('user', '/rest/api/3/worklog/list', { method: 'POST', body: { ids: c } });
    for (const w of list || []) {
      const d = isStr(w.started) ? w.started.slice(0, 10) : null;
      const acc = w.author?.accountId;
      if (!acc || !d || d < from || d > to) continue;
      const p = people[acc] || (people[acc] = { h: 0, last: null, byIssue: {} });
      const h = (w.timeSpentSeconds || 0) / 3600;
      p.h += h;
      if (!p.last || d > p.last) p.last = d;
      p.byIssue[w.issueId] = (p.byIssue[w.issueId] || 0) + h;
    }
  });
  const keep = visiblePeople({ logs: roles.logs, accountId: ctx.accountId, capacity: roles.logs === 'all' ? null : await get(K.capacity) });
  if (!keep) return { from, to, people, truncated, scope: 'all' };
  // hidden people: one "sum only" row per team (possible time is computed by the client from the team's people);
  // a person split across teams (UC-14) books into each team × their share there
  const cap = (await get(K.capacity)) || {};
  const hidden = {};
  for (const [acc, p] of Object.entries(people)) {
    if (keep.has(acc)) continue;
    const split = allocationOf(cap.people?.[acc]);
    for (const { teamId, pct } of split.length ? split : [{ teamId: '_none', pct: 100 }]) {
      const x = hidden[teamId] || (hidden[teamId] = { h: 0, n: 0 });
      x.h += (p.h * pct) / 100; x.n += 1;
    }
    delete people[acc];
  }
  return { from, to, people, truncated, scope: roles.logs, hidden };
});
def('config.detect', async ({ roles }) => { requireRole(roles, 'admin'); return detectSetup(); });
// How many people switched AI on for themselves (Jira admins only; a count, no names).
def('ai.users', async ({ roles }) => { requireRole(roles, 'admin'); return { on: await countAiUsers() }; });
// This site's AI spending (meter numbers of the last six months, forecast) – Jira admins only.
def('ai.spend', async ({ cfg, roles }) => { requireRole(roles, 'admin'); return spendHistory(cfg); });
// Saves a configuration, records it as a version (the very first save also keeps the version before it)
// and writes the audit entry. Shared by config.save, config.restore and settings.save.
async function commitConfig(ctx, cfg, next, action, note) {
  await withName(ctx);
  // AI switch: who changed it and when is set here (never taken from the request), and audited on its own line.
  const aiWas = cfg.ai?.enabled === true, aiNow = next.ai?.enabled === true;
  const aiChanged = !!next.ai && JSON.stringify({ ...next.ai, changedAt: null, changedBy: null }) !== JSON.stringify({ ...(cfg.ai || {}), changedAt: null, changedBy: null });
  if (next.ai && aiChanged) next = { ...next, ai: { ...next.ai, changedAt: new Date().toISOString(), changedBy: ctx.displayName || ctx.accountId } };
  // Compare independent of key order, so a re-validated but identical section does not count as changed.
  const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
  const changed = Object.keys(next).filter((k) => stable(next[k]) !== stable(cfg[k]));
  if (!changed.length) return next;
  const versions = await listConfigVersions().catch(() => []);
  if (!versions.length && cfg.setupComplete) await addConfigVersion({ accountId: 'app', displayName: null }, cfg, [], 'before-history');
  await saveConfig(next);
  await addConfigVersion(ctx, next, changed, note);
  await audit(ctx, action, { sections: changed, ...(changed.includes('permissions') ? { permissions: Object.fromEntries(PERMISSION_KEYS.map((k) => [k, next.permissions[k].map((g) => g.name)])) } : {}), ...(changed.includes('roles') ? { roles: { projectAdmin: next.roles.groups.projectAdmin.map((g) => g.name), management: next.roles.groups.management.map((g) => g.name), rights: next.roles.rights, adminPersonValues: next.roles.adminPersonValues } } : {}) });
  if (changed.includes('support')) await del(K.supportCache);
  if (aiChanged) {
    await audit(ctx, aiWas !== aiNow ? (aiNow ? 'ai.enabled' : 'ai.disabled') : 'ai.settings', { features: Object.entries(next.ai.features).filter(([, v]) => v).map(([k]) => k), shareNames: next.ai.shareNames, shareTexts: next.ai.shareTexts });
    if (!aiNow) await forgetAiData(); // nothing from earlier AI use stays behind
  }
  return next;
}
const validated = (fn) => { try { return fn(); } catch (e) { if (e instanceof ValidationError) throw new BadRequest(e.message); throw e; } };

def('config.save', async ({ payload, ctx, cfg, roles }) => {
  requireRole(roles, 'admin');
  return commitConfig(ctx, cfg, validated(() => validateConfig(payload.config, cfg)), 'config.update');
});

// ---------- support (queues, SLA, bridge to projects) ----------
// Live count for the admin while defining a queue (as the admin, so Jira permissions apply).
def('support.preview', async ({ payload, roles }) => {
  requireRole(roles, 'admin');
  const [q] = validQueues([payload.queue]);
  if (!q) return { total: 0, open: 0 };
  const jql = supportJql({ support: { queues: [q] } });
  const count = (extra) => jira('user', '/rest/api/3/search/approximate-count', { method: 'POST', body: { jql: `${jql}${extra}` } }).then((r) => r.count ?? 0).catch(() => null);
  const [total, open] = await Promise.all([count(''), count(' AND statusCategory != Done')]);
  return { total, open };
});
// "Link to project": connects a support ticket with a project work item (as the user, so Jira checks the
// link permission on both). Undo removes exactly that link.
async function linkType(cfg) {
  if (cfg.support?.escalationLinkTypeId) return { id: cfg.support.escalationLinkTypeId };
  const types = await jira('user', '/rest/api/3/issueLinkType').catch(() => ({ issueLinkTypes: [] }));
  const rel = types.issueLinkTypes.find((t) => /^relates$/i.test(t.name)) || types.issueLinkTypes[0];
  return rel ? { id: rel.id } : null;
}
def('support.link', async ({ payload, ctx, cfg }) => {
  const { ticketId, targetId } = payload;
  assert(isStr(ticketId) && /^\d{1,18}$/.test(ticketId) && isStr(targetId) && /^\d{1,18}$/.test(targetId) && ticketId !== targetId, 'ids');
  const type = await linkType(cfg);
  assert(type, 'no link type');
  await visibleIssue(ticketId, ['summary']);
  await visibleIssue(targetId, ['summary']);
  await jira('user', '/rest/api/3/issueLink', { method: 'POST', body: { type, inwardIssue: { id: ticketId }, outwardIssue: { id: targetId } } });
  await audit(await withName(ctx), 'support.link', { ticketId, targetId });
  return { ok: true };
});
def('support.unlink', async ({ payload, ctx }) => {
  const { ticketId, targetId } = payload;
  assert(isStr(ticketId) && /^\d{1,18}$/.test(ticketId) && isStr(targetId) && /^\d{1,18}$/.test(targetId), 'ids');
  const t = await visibleIssue(ticketId, ['issuelinks']);
  const link = (t.fields.issuelinks || []).find((l) => (l.outwardIssue || l.inwardIssue)?.id === targetId);
  if (!link) return { ok: true };
  await jira('user', `/rest/api/3/issueLink/${link.id}`, { method: 'DELETE' });
  await audit(await withName(ctx), 'support.unlink', { ticketId, targetId });
  return { ok: true };
});

// ---------- dependency links (smart action "PCX-12 blockiert PCX-47") ----------
// As the user (Jira checks "Link work items" on both), only with a link type the admin configured for dependencies.
// The direction is verified after creating – it must read "pre blocks dep" exactly as the cockpit reads links.
// Undo (deps.unlink) removes only that link id, and only if it still connects the same two work items.
const depLink = (l, selfId) => ({ id: String(l.id), typeId: String(l.type?.id), verb: l.type?.outward || '', inverse: l.type?.inward || '', outward: !!l.outwardIssue, otherId: (l.outwardIssue || l.inwardIssue)?.id, selfId });
def('deps.link', async ({ payload, ctx, cfg }) => {
  const { preId, depId } = payload || {};
  assert(isStr(preId) && /^\d{1,18}$/.test(preId) && isStr(depId) && /^\d{1,18}$/.test(depId) && preId !== depId, 'ids');
  const types = (cfg.dependencies?.linkTypeIds || []).map(String);
  assert(types.length, 'no dependency link type configured');
  const typeId = types.includes(String(payload.typeId)) ? String(payload.typeId) : types[0];
  const reversed = (cfg.dependencies?.reversedLinkTypeIds || []).map(String).includes(typeId);
  await visibleIssue(depId, ['summary']);
  // "pre blocks dep" as the cockpit reads it: on pre, the link points outward to dep (inward if the admin flipped the type)
  const right = (l) => String(l.type?.id) === typeId && (reversed ? l.inwardIssue?.id === depId : l.outwardIssue?.id === depId);
  const any = (l) => String(l.type?.id) === typeId && (l.outwardIssue || l.inwardIssue)?.id === depId;
  const linksOf = async () => (await visibleIssue(preId, ['issuelinks'])).fields.issuelinks || [];
  const before = await linksOf();
  const existing = before.find(right);
  if (existing) return { ok: true, existed: true, link: depLink(existing, preId) };
  assert(!before.some(any), 'the opposite dependency already exists');
  const create = (pre, dep) => jira('user', '/rest/api/3/issueLink', { method: 'POST', body: { type: { id: typeId }, inwardIssue: { id: pre }, outwardIssue: { id: dep } } });
  await create(reversed ? depId : preId, reversed ? preId : depId);
  let made = (await linksOf()).find(right);
  if (!made) {
    // the site stored it the other way round: remove exactly that new link and create the correct direction
    const wrong = (await linksOf()).find((l) => any(l) && !before.some((b) => b.id === l.id));
    if (wrong) await jira('user', `/rest/api/3/issueLink/${encodeURIComponent(String(wrong.id))}`, { method: 'DELETE' });
    await create(reversed ? preId : depId, reversed ? depId : preId);
    made = (await linksOf()).find(right);
  }
  assert(made, 'link not created');
  await audit(await withName(ctx), 'deps.link', { preId, depId, typeId });
  return { ok: true, existed: false, link: depLink(made, preId) };
});
def('deps.unlink', async ({ payload, ctx, cfg }) => {
  const { linkId, preId, depId } = payload || {};
  assert(isStr(linkId) && /^\d{1,18}$/.test(linkId) && isStr(preId) && /^\d{1,18}$/.test(preId) && isStr(depId) && /^\d{1,18}$/.test(depId), 'ids');
  let l;
  try { l = await jira('user', `/rest/api/3/issueLink/${linkId}`); } catch (e) { if (e.status === 404) return { ok: true, gone: true }; throw e; }
  const pair = [l.inwardIssue?.id, l.outwardIssue?.id].sort().join();
  assert((cfg.dependencies?.linkTypeIds || []).map(String).includes(String(l.type?.id)) && pair === [preId, depId].sort().join(), 'not this dependency');
  await jira('user', `/rest/api/3/issueLink/${linkId}`, { method: 'DELETE' });
  await audit(await withName(ctx), 'deps.unlink', { preId, depId });
  return { ok: true };
});

// ---------- work-item field editor (T-shirt size / target quarters on the issue view) ----------
def('field.options', async ({ cfg }) => ({ sizes: cfg.tshirtSizes, quarters: quarterChoices(cfg.quarterRange) })); // range: Konfiguration › T-Shirt-Größen & Quartale

// ---------- configuration versions (Jira admins) ----------
def('config.history', async ({ roles }) => {
  requireRole(roles, 'admin');
  return (await listConfigVersions()).map(({ config, ...v }) => ({ ...v, summary: { levels: config?.levels?.length || 0, sizes: (config?.tshirtSizes || []).map((t) => t.key).join(' · '), portfolioTypes: config?.portfolio?.issueTypeIds || [] } }));
});
def('config.version', async ({ payload, roles }) => {
  requireRole(roles, 'admin');
  assert(isStr(payload.id) && /^[0-9T:.Z-]{20,40}:[a-z0-9]{1,8}$/.test(payload.id), 'id');
  const v = await getConfigVersion(payload.id);
  if (!v) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  return v;
});
def('config.restore', async ({ payload, ctx, cfg, roles }) => {
  requireRole(roles, 'admin');
  assert(isStr(payload.id) && /^[0-9T:.Z-]{20,40}:[a-z0-9]{1,8}$/.test(payload.id), 'id');
  const v = await getConfigVersion(payload.id);
  if (!v?.config) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  return commitConfig(ctx, cfg, validated(() => validateConfig(v.config, cfg)), 'config.restore', `restored ${v.at}`);
});

// ---------- portfolio settings (Jira admins and the delegated "Portfolio settings" group) ----------
const canSettings = (roles) => roles.admin || roles.manageSettings;
def('settings.get', async ({ cfg, roles }) => {
  if (!canSettings(roles)) throw new AccessError('NO_ACCESS:manageSettings');
  return {
    tshirtSizes: cfg.tshirtSizes, rules: cfg.rules, capacityDefaults: cfg.capacityDefaults, delegatedRules: DELEGATED_RULES, supportSla: cfg.support.sla, slaTargetPct: cfg.support.slaTargetPct,
    fields: { tshirt: cfg.fields.tshirt, targetQuarters: cfg.fields.targetQuarters },
    milestones: (await get(K.milestones)) || [], locations: LOCATIONS, admin: !!roles.admin,
    priorities: await jira('user', '/rest/api/3/priority/search', { query: { maxResults: 50 } }).then((p) => (p.values || []).map((x) => ({ id: x.id, name: x.name }))).catch(() => []),
  };
});
def('settings.save', async ({ payload, ctx, cfg, roles }) => {
  if (!canSettings(roles)) throw new AccessError('NO_ACCESS:manageSettings');
  const next = validated(() => applySettings(cfg, { tshirtSizes: payload.tshirtSizes, rules: payload.rules, capacityDefaults: payload.capacityDefaults, supportSla: payload.supportSla, slaTargetPct: payload.slaTargetPct }));
  const saved = await commitConfig(ctx, cfg, next, 'settings.update');
  return { tshirtSizes: saved.tshirtSizes, rules: saved.rules, capacityDefaults: saved.capacityDefaults, supportSla: saved.support.sla, slaTargetPct: saved.support.slaTargetPct };
});

// ---------- Jira select fields used for T-shirt sizes / target quarters ----------
// Options are read the way Jira offers them to users (edit meta of a work item that has the field),
// so no admin-only scope is needed. Falls back to JQL suggestions.
const CF_RE = /^customfield_(\d{1,8})$/;
def('fields.options', async ({ payload, cfg, roles }) => {
  if (!canSettings(roles)) throw new AccessError('NO_ACCESS:manageSettings');
  const fieldId = payload.fieldId;
  assert(isStr(fieldId) && CF_RE.test(fieldId), 'fieldId');
  // Delegated users may only look at the fields the admin mapped.
  if (!roles.admin) assert([cfg.fields.tshirt, cfg.fields.targetQuarters].includes(fieldId), 'field not mapped');
  const num = CF_RE.exec(fieldId)[1];
  const types = [...(cfg.portfolio.issueTypeIds || []), ...cfg.levels.flatMap((l) => l.issueTypeIds)].filter((x) => /^\d+$/.test(x));
  const jqls = [`cf[${num}] is not EMPTY ORDER BY updated DESC`, ...(types.length ? [`issuetype in (${types.join(',')}) ORDER BY updated DESC`] : [])];
  for (const jql of jqls) {
    const r = await searchAll('user', jql, ['summary'], { limit: 3 }).catch(() => ({ issues: [] }));
    for (const i of r.issues) {
      const meta = await jira('user', `/rest/api/3/issue/${i.id}/editmeta`).catch(() => null);
      const f = meta?.fields?.[fieldId];
      if (f?.allowedValues) {
        return { source: 'editmeta', multi: f.schema?.type === 'array', manageUrl: `/secure/admin/ConfigureCustomField!default.jspa?customFieldId=${num}`,
          options: f.allowedValues.filter((o) => !o.disabled).map((o) => ({ id: String(o.id), value: String(o.value ?? o.name ?? '') })).slice(0, 200) };
      }
    }
  }
  const sug = await jira('user', '/rest/api/3/jql/autocompletedata/suggestions', { query: { fieldName: `cf[${num}]`, fieldValue: '' } }).catch(() => null);
  return { source: sug ? 'suggestions' : 'none', multi: null, manageUrl: `/secure/admin/ConfigureCustomField!default.jspa?customFieldId=${num}`,
    options: (sug?.results || []).map((o) => ({ id: null, value: String(o.value || '').replace(/^"|"$/g, '') })).filter((o) => o.value).slice(0, 200) };
});

// Copies values from the app-owned field into a Jira field the admin switched to (never overwrites a
// value already set; each write is done as the admin, so Jira checks screens and permissions).
def('fields.copyValues', async ({ payload, ctx, roles }) => {
  requireRole(roles, 'admin');
  const { usage, to, cursor } = payload;
  assert(usage === 'tshirt' || usage === 'targetQuarters', 'usage');
  assert(isStr(to) && CF_RE.test(to), 'to');
  assert(cursor == null || (isStr(cursor) && cursor.length < 2000), 'cursor');
  const app = await appFieldIds();
  const from = usage === 'tshirt' ? app.tshirt : app.targetQuarters;
  assert(from && from !== to, 'no app field');
  const fromNum = CF_RE.exec(from)[1];
  const page = await jira('user', '/rest/api/3/search/jql', { method: 'POST', body: { jql: `cf[${fromNum}] is not EMPTY ORDER BY key`, fields: [from, to], maxResults: 15, ...(cursor ? { nextPageToken: cursor } : {}) } });
  let copied = 0, skipped = 0;
  const failed = [], copiedIds = [];
  for (const i of page.issues || []) {
    const src = i.fields[from];
    const has = i.fields[to];
    if (has != null && !(Array.isArray(has) && !has.length)) { skipped++; continue; }
    try {
      const want = usage === 'tshirt' ? [String(src)] : String(src).split(/\s*,\s*/).filter(Boolean);
      const { multi, pick } = await optionFor(i.id, to, want);
      const vals = want.map((w) => pick(w)).filter(Boolean).map((o) => ({ id: o.id }));
      if (!vals.length) { failed.push({ key: i.key, reason: `no option "${want.join(', ')}"` }); continue; }
      await jira('user', `/rest/api/3/issue/${i.id}`, { method: 'PUT', body: { fields: { [to]: multi ? vals : vals[0] } }, query: { notifyUsers: false } })
        .catch((e) => (e.status === 400 && /notifyUsers/i.test(e.message) ? jira('user', `/rest/api/3/issue/${i.id}`, { method: 'PUT', body: { fields: { [to]: multi ? vals : vals[0] } } }) : Promise.reject(e)));
      copied++;
      copiedIds.push(String(i.id));
    } catch (e) { failed.push({ key: i.key, reason: e.code === 'FIELD_NOT_EDITABLE' ? 'field not on edit screen' : e.status === 403 ? 'no edit permission' : 'error' }); }
  }
  if (copied) await audit(await withName(ctx), 'fields.copyValues', { usage, to, copied });
  return { copied, skipped, failed: failed.slice(0, 50), copiedIds, nextCursor: page.nextPageToken || null };
});
// Undo of fields.copyValues: empties the Jira field again on the work items the copy filled (they were
// empty before), but only where the field still holds exactly the copied value – a later edit is kept.
def('fields.uncopyValues', async ({ payload, ctx, roles }) => {
  requireRole(roles, 'admin');
  const { usage, to, issueIds } = payload;
  assert(usage === 'tshirt' || usage === 'targetQuarters', 'usage');
  assert(isStr(to) && CF_RE.test(to), 'to');
  assert(Array.isArray(issueIds) && issueIds.length <= 50 && issueIds.every((x) => isStr(x) && /^\d{1,18}$/.test(x)), 'issueIds');
  const app = await appFieldIds();
  const from = usage === 'tshirt' ? app.tshirt : app.targetQuarters;
  assert(from && from !== to, 'no app field');
  if (!issueIds.length) return { cleared: 0, kept: 0, failed: [] };
  const page = await jira('user', '/rest/api/3/search/jql', { method: 'POST', body: { jql: `id in (${issueIds.join(',')})`, fields: [from, to], maxResults: 50 } });
  const names = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map((o) => String(o?.value ?? o).trim()).filter(Boolean).sort().join(', ');
  let cleared = 0, kept = 0;
  const failed = [];
  for (const i of page.issues || []) {
    const want = usage === 'tshirt' ? [String(i.fields[from] ?? '')] : String(i.fields[from] ?? '').split(/\s*,\s*/).filter(Boolean);
    if (names(i.fields[to]) !== want.map((w) => w.trim()).sort().join(', ')) { kept++; continue; }
    try {
      await jira('user', `/rest/api/3/issue/${i.id}`, { method: 'PUT', body: { fields: { [to]: null } }, query: { notifyUsers: false } })
        .catch((e) => (e.status === 400 && /notifyUsers/i.test(e.message) ? jira('user', `/rest/api/3/issue/${i.id}`, { method: 'PUT', body: { fields: { [to]: null } } }) : Promise.reject(e)));
      cleared++;
    } catch (e) { failed.push({ key: i.key, reason: e.status === 403 ? 'no edit permission' : 'error' }); }
  }
  if (cleared) await audit(await withName(ctx), 'fields.copyValues.undo', { usage, to, cleared });
  return { cleared, kept, failed };
});
def('meta.confluenceSpaces', async ({ roles }) => {
  requireRole(roles, 'admin');
  try {
    const r = await confluence('/wiki/api/v2/spaces', { query: { limit: 250, status: 'current' } });
    return { available: true, spaces: (r.results || []).map((s) => ({ id: String(s.id), key: s.key, name: s.name })) };
  } catch (e) { return { available: false, spaces: [] }; }
});
def('meta.groups', async ({ payload, roles }) => {
  requireRole(roles, 'admin');
  const r = await jira('user', '/rest/api/3/groups/picker', { query: { query: typeof payload.query === 'string' ? payload.query.slice(0, 60) : '', maxResults: 30 } });
  return (r.groups || []).map((g) => ({ id: g.groupId, name: g.name }));
});
def('meta.projects', async ({ payload, roles }) => {
  requireRole(roles, 'admin');
  const r = await jira('user', '/rest/api/3/project/search', { query: { query: typeof payload.query === 'string' ? payload.query.slice(0, 60) : '', maxResults: 50, typeKey: payload.service ? 'service_desk' : undefined } });
  return (r.values || []).map((p) => ({ id: p.id, key: p.key, name: p.name, type: p.projectTypeKey, avatar: p.avatarUrls?.['24x24'] || null }));
});
def('meta.versions', async ({ payload, roles }) => {
  requireRole(roles, 'admin');
  const query = typeof payload.query === 'string' ? payload.query.trim().slice(0, 60) : '';
  const projects = (await jira('user', '/rest/api/3/project/search', { query: { maxResults: 50, orderBy: 'lastIssueUpdatedTime' } })).values || [];
  const res = await pool(projects, 8, (p) => jira('user', `/rest/api/3/project/${p.id}/version`, { query: { query, maxResults: 20, status: 'unreleased,released' } })
    .then((r) => (r.values || []).map((v) => ({ id: String(v.id), name: v.name, releaseDate: v.releaseDate || null, released: !!v.released, projectKey: p.key, projectName: p.name }))).catch(() => []));
  return res.flat().slice(0, 60);
});
def('milestones.save', async ({ payload, ctx, roles }) => {
  if (!canSettings(roles)) throw new AccessError('NO_ACCESS:manageSettings');
  const list = Array.isArray(payload.milestones) ? payload.milestones.slice(0, 200) : null;
  assert(list, 'milestones invalid');
  const seen = new Set();
  const clean = list.map((m) => {
    const name = typeof m?.name === 'string' ? m.name.trim().slice(0, 120) : '';
    assert(name && isStr(m.date) && DATE_RE.test(m.date), 'milestone needs name and date');
    const v = [...new Set((m.fixVersionIds || []).map(String).filter((x) => /^\d{1,18}$/.test(x)))].slice(0, 100);
    for (const x of v) { assert(!seen.has(x), 'a fix version can belong to only one milestone'); seen.add(x); }
    return { id: typeof m.id === 'string' && /^[a-z0-9-]{1,40}$/.test(m.id) ? m.id : Math.random().toString(36).slice(2, 10), name, date: m.date, fixVersionIds: v };
  });
  await set(K.milestones, clean);
  await audit(await withName(ctx), 'milestones.update', { count: clean.length });
  return clean;
});
def('audit.list', async ({ roles }) => {
  if (!roles.admin && !roles.manageRanking) throw new AccessError();
  const all = await recentAudit(300);
  if (roles.admin) return all;
  const mine = all.filter((e) => /^(rank|portfolio|health)\./.test(e.action));
  const visible = await visibleRefs([...new Set(mine.map((e) => e.details?.ref).filter((r) => isStr(r) && REF_RE.test(r)))]);
  return mine.filter((e) => visible.has(e.details?.ref));
});

export const handler = resolver.getDefinitions();

// ---------- scheduled: daily report, auto-remove, health reminders ----------
// ---------- Wochenplanung (UC-05): moves written as the user ----------
def('plan.apply', async ({ payload, ctx, cfg, roles }) => applyPlanMoves(payload, { ...(await withName(ctx)), cfg, roles }));
// per-task distribution override ("gleichmäßig" instead of "nach Kapazität"), central for the whole team, audited, undoable
def('plan.even', async ({ payload, ctx, roles }) => setEven(payload, { ...(await withName(ctx)), roles }));
// ---------- Support (UC-17): dispatching and the support reserve ----------
def('support.dispatch', async ({ payload, ctx, cfg, roles }) => dispatchTickets(payload, { ...(await withName(ctx)), cfg, roles }));
def('support.undoDispatch', async ({ payload, ctx, cfg, roles }) => undoDispatch(payload, { ...(await withName(ctx)), cfg, roles }));
def('support.reserve', async ({ payload, ctx, cfg, roles }) => setSupportReserve(payload, { ...(await withName(ctx)), cfg, roles }));

// ---------- KI-Assistent (Forge LLM only; off unless a Jira admin switched AI and this feature on) ----------
// Suggestions only: nothing is written here – applying goes through the normal write paths, each with its own undo.
def('ai.assist', async ({ payload, ctx, cfg, roles }) => {
  requireAi(cfg, payload.feature);
  assert(cfg.setupComplete, 'setup required');
  // similarSummary: comment texts are only loaded inside assist() when the admin allowed texts (cfg.ai.shareTexts)
  const r = await assist(payload.feature, payload, { ...(await withName(ctx)), cfg, roles, loadDs: () => loadDataset(ctx, cfg, roles), loadComments: (ids) => loadComments(ids, { as: 'user', texts: true }) });
  // "LLM teaches Lotse": Lotse could not map this wish and the AI picked a card → only the phrase pattern (names, keys,
  // numbers masked; no account id) becomes a learning candidate for the Jira admins (src/lib/learn.js)
  if (payload.feature === 'intent' && payload.lotseMissed === true && r?.source === 'ai' && r.card) await learnFromAi({ wish: payload.wish, card: r.card }, { loadDs: () => loadDataset(ctx, cfg, roles) }).catch(() => null);
  return r;
});

// ---------- Lotse learns: approved phrase patterns for everyone; candidates reviewed by Jira admins ----------
def('lotse.learned', async ({ roles }) => listLearned({ admin: !!roles.admin }));
def('lotse.learn.review', async ({ payload, ctx, roles }) => {
  requireRole(roles, 'admin');
  const r = await reviewLearned(payload);
  await audit(await withName(ctx), 'lotse.learn', { id: r.item.id, decision: r.item.status, previous: r.previous });
  return r;
});

// ---------- Usage signals: counts only (event name → n) per site and day – no person, no content (shared/usage.js) ----------
def('usage.track', async ({ payload }) => trackUsage(payload));
def('usage.summary', async ({ roles }) => { requireRole(roles, 'admin'); return readUsage(); });

// ---------- Lotse (own agent): the AI's reading of Lotse's verified story; every claim is cross-checked in code ----------
// Sends ONLY the story's facts (validStory, ~12 KB cap; people as P1.. / projects as "#rank KEY" unless allowed). The
// person's own AI switch, the budget and the daily limit are enforced in lotseReading → takeQuota before the call.
// Chains (shared/lotse/act/chain/llm.js), same switch, quota, budget, cache and audit: mode 'plan' – the request (names
// masked unless allowed) + the tool catalogue's schema, no data → a JSON plan Lotse checks itself; mode 'write' – a short
// text from a verified story only, every number cross-checked; mode 'learn' – the clauses of an accepted AI plan become
// masked learning candidates for the admins (no AI call).
def('lotse.llm', async ({ payload, ctx, cfg, roles }) => {
  requireAi(cfg, 'lotse');
  assert(cfg.setupComplete, 'setup required');
  if (payload?.mode === 'plan') return lotsePlanAssist(payload, { accountId: ctx.accountId, cfg }, { llm, takeQuota, dropCached, audit });
  if (payload?.mode === 'write') return lotseWriteAssist(payload, { accountId: ctx.accountId, cfg }, { llm, takeQuota, dropCached, audit });
  if (payload?.mode === 'learn') return learnChainFromAi(payload, { loadDs: () => loadDataset(ctx, cfg, roles) });
  return lotseReading(payload, { accountId: ctx.accountId, cfg }, { llm, takeQuota, dropCached, audit });
});

// ---------- "Ich will …": history for the insights (shared/insights.js), read AS THE USER ----------
// Done stories and resolved support tickets (src/lib/history.js); people outside the caller's scope have no account id.
def('insights.history', async ({ payload, ctx, cfg, roles }) => {
  assert(cfg.setupComplete, 'setup required');
  return loadHistory({ cfg, as: 'user', months: payload.months, supportMonths: payload.supportMonths, roles, accountId: ctx.accountId });
});
// Comment counts of similar past work; texts only when the admin allowed texts for the AI (decided here, never by the browser).
def('insights.comments', async ({ payload, cfg }) => {
  assert(cfg.setupComplete, 'setup required');
  return loadComments(payload.ids, { as: 'user', texts: payload.texts === true && cfg.ai?.enabled === true && cfg.ai?.shareTexts === true });
});

// ---------- Support playbooks: help articles + standard replies in app storage (never posted to tickets) ----------
def('playbooks.list', async ({ ctx, roles }) => listPlaybooks({ ...ctx, roles }));
def('playbooks.save', async ({ payload, ctx, roles }) => savePlaybook(payload, { ...(await withName(ctx)), roles }));
def('playbooks.delete', async ({ payload, ctx, roles }) => deletePlaybook(payload, { ...(await withName(ctx)), roles }));

// ---------- Plan vs. Ist (UC-04) ----------
// Stored weekly plan snapshots and actuals; people only within the role's privacy scope (UC-08).
def('planActual.get', async ({ payload, ctx, cfg, roles }) => planActualFor(payload, ctx, cfg, roles));

// Hourly: the weekly plan snapshot (acts once its configured day and time have passed) and, only when a
// Jira admin switched them on, the reminders about missing values. Paused by SUPERPORT: nothing runs.
async function hourlyJobRun() {
  const mode = maintenanceMode();
  if (mode !== 'off') return { skipped: mode };
  const out = {};
  try { out.snapshot = await runSnapshotJob({ now: Date.now() }); } catch (e) { logError('[hourly:snapshot]', e); }
  try {
    const cfg = await loadConfig();
    if (cfg.setupComplete && cfg.notices?.enabled) {
      out.notices = await runNotices(cfg, { loadGaps: async () => computeAll({ ...(await buildDataset({ as: 'app', cfg })), config: cfg }).dq.gaps });
      out.booking = await runBookingNotices(cfg, {
        loadData: async (period) => {
          const ds = { ...(await buildDataset({ as: 'app', cfg })), config: cfg };
          const { model } = computeAll(ds, { skipWeeks: true });
          const { worklogs } = await fetchWorklogs(period.from, period.to);
          return { ds, worklogs, model, overview: (m, booked, p) => bookingOverview(m, booked, dayIdx(p.from), dayIdx(p.to), cfg) };
        },
        groupMembers: async (groupId) => ((await jira('app', '/rest/api/3/group/member', { query: { groupId, maxResults: 50 } })).values || []).map((u) => u.accountId),
      });
    }
  } catch (e) { logError('[hourly:notices]', e); }
  try { out.aiCachePurged = await purgeCache(); } catch { /* next hour */ }
  try { out.usage = await compactUsage(); } catch { /* next hour */ }
  // reminders on request: a day's marks (who was reminded today) are only needed that day
  try { for (const k of [1, 2]) await del(REMIND_KEY(new Date(Date.now() - k * 864e5).toISOString().slice(0, 10))); } catch { /* next hour */ }
  return out;
}

async function reportJobRun() {
  const mode = maintenanceMode();
  if (mode !== 'off') return { skipped: mode }; // paused by SUPERPORT: no reads, no writes, no notifications
  const cfg = await loadConfig();
  if (!cfg.setupComplete) return;
  if (cfg.portfolio.autoRemoveDone) {
    const ds = await buildDataset({ as: 'app', cfg });
    const done = new Set(ds.portfolio.filter((p) => p.statusCat === 'done').map((p) => p.ref));
    if (done.size) {
      const state = await portfolioState();
      const prev = new Map(state.items.map((x, i) => [x.ref, i + 1]));
      state.items = state.items.filter((x) => !done.has(x.ref));
      await writeRanks(cfg, state.items, prev); // the field first, as in portfolio.remove
      await set(K.portfolio, state);
      for (const ref of done) { await clearRank(cfg, ref); await audit({ accountId: 'system', displayName: 'Portfolio Cockpit' }, 'portfolio.autoRemove', { ref, rank: prev.get(ref) }); }
    }
  }
  const report = await computeReport(cfg);
  // Health reminders: notify owners once per rhythm when the update is due (issue mode: Jira notification) – like every
  // other notice only while a Jira admin switched reminders on (config.notices.enabled, default off).
  if (cfg.portfolio.source === 'issue' && cfg.notices?.enabled === true) {
    const health = (await get(K.health)) || {};
    const reminded = (await get('health:reminded')) || {};
    const rhythm = (cfg.rules.healthRhythmDays || 7) * 864e5;
    const state = await portfolioState();
    for (const { ref } of state.items) {
      const h = health[ref];
      const due = !h || Date.now() - Date.parse(h.at) > rhythm;
      if (!due || (reminded[ref] && Date.now() - reminded[ref] < rhythm)) continue;
      try {
        // Remind the owner: the Assignee, or the user in the mapped "Owner" custom field.
        let to = { assignee: true };
        if (cfg.fields?.owner) {
          const v = (await jira('app', `/rest/api/3/issue/${ref.slice(6)}`, { query: { fields: cfg.fields.owner } })).fields?.[cfg.fields.owner];
          const id = (Array.isArray(v) ? v[0] : v)?.accountId;
          if (!id) continue;
          to = { users: [{ accountId: id }] };
        }
        await jira('app', `/rest/api/3/issue/${ref.slice(6)}/notify`, { method: 'POST', body: {
          subject: 'Portfolio Cockpit: Health-Update fällig / health update due',
          textBody: 'Bitte aktualisiere den Health-Status dieses Projekts im Portfolio Cockpit. Please update the health of this project in Portfolio Cockpit.',
          to,
        } });
        reminded[ref] = Date.now();
      } catch (e) { logWarn('[health:reminder]', e); }
    }
    await set('health:reminded', reminded);
  }
  return { asOf: report.asOf };
}

// ---------- events: sub-task lock (UC-09) ----------
async function isTinyIssue(cfg, issueId) {
  const i = await jira('app', `/rest/api/3/issue/${issueId}`, { query: { fields: 'issuetype,timeoriginalestimate,timeestimate' } });
  const level = (cfg.levels || []).find((l) => l.issueTypeIds.includes(String(i.fields.issuetype.id)));
  return { tiny: level ? level.role === 'tiny' : i.fields.issuetype.hierarchyLevel === -1, issue: i };
}
const adf = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
async function lockEnforcerRun(event) {
  if (maintenanceMode() !== 'off') return; // paused by SUPERPORT: leave the work item alone
  const cfg = await loadConfig();
  if (!cfg.setupComplete || !cfg.rules.lockSubtasks) return;
  if (event.eventType === 'avi:jira:created:worklog' && event.worklog?.issueId) {
    const { tiny } = await isTinyIssue(cfg, event.worklog.issueId);
    if (!tiny) return;
    await jira('app', `/rest/api/3/issue/${event.worklog.issueId}/worklog/${event.worklog.id}`, { method: 'DELETE', query: { adjustEstimate: 'leave', notifyUsers: false } });
    const ck = `lock-comment:${event.worklog.issueId}`;
    if (Date.now() - ((await get(ck)) || 0) < 864e5) return;
    await set(ck, Date.now());
    await jira('app', `/rest/api/3/issue/${event.worklog.issueId}/comment`, { method: 'POST', body: { body: adf('Portfolio Cockpit: Zeiterfassung auf Sub-tasks ist gesperrt – bitte auf der Story buchen. Time tracking on sub-tasks is locked – please log time on the story.') } });
    return;
  }
  if (event.eventType === 'avi:jira:updated:issue') {
    const items = event.changelog?.items || [];
    if (!items.some((x) => ['timeoriginalestimate', 'timeestimate'].includes(x.field) && x.to)) return;
    const { tiny, issue } = await isTinyIssue(cfg, event.issue.id);
    if (!tiny || (!issue.fields.timeoriginalestimate && !issue.fields.timeestimate)) return;
    await jira('app', `/rest/api/3/issue/${event.issue.id}`, { method: 'PUT', query: { notifyUsers: false }, body: { fields: { timetracking: { originalEstimate: '0m', remainingEstimate: '0m' } } } });
  }
}

// Scheduled jobs and triggers: if one fails, the platform would log the raw error text (Jira's answers can carry
// customer values) where SUPERPORT can read it – log and rethrow only the scrubbed form (src/lib/safeLog.js).
function guarded(where, fn) {
  return async (...args) => {
    if (siteWithdrawn(...args)) return undefined; // withdrawn site: the job / event does nothing there
    try { return await fn(...args); } catch (e) { logError(where, e); throw new Error(safeError(e)); }
  };
}

// ---------- issue panel status (jira:issueContext dynamicProperties) ----------
// Boss feedback 2026-11-17: in the issue view, a note next to the assignee when they are not part of the work item's
// team. Jira asks this when it shows the "Planungs-Check" button in the issue's side bar; a red "Nicht im Team"
// lozenge appears there, the panel itself explains it. Reads one work item (as the app), the stored Atlassian Teams
// snapshot and the capacity – never the whole portfolio. Any problem: no lozenge (never an error in the issue view).
export async function storyStatus(payload, context) {
  try {
    if (maintenanceMode() !== 'off' || siteWithdrawn(payload, payload?.context, context)) return {};
    const issueId = String(payload?.extension?.issue?.id ?? '');
    if (!/^\d{1,18}$/.test(issueId)) return {};
    const cfg = await loadConfig();
    const teamF = /^customfield_\d{1,10}$/.test(cfg.fields?.team || '') ? cfg.fields.team : null;
    if (!cfg.setupComplete || !teamF) return {};
    const [issue, snap, capacity] = await Promise.all([
      jira('app', `/rest/api/3/issue/${issueId}`, { query: { fields: `assignee,${teamF}` } }),
      cfg.teams?.source === 'cockpit' ? null : get(ATL_TEAMS_KEY),
      get(K.capacity),
    ]);
    const team = issue?.fields?.[teamF];
    const teamId = team && typeof team === 'object' ? String(team.id || '') : typeof team === 'string' ? team : '';
    const st = quickTeamStatus({ cfg, snap, capacity, assigneeId: issue?.fields?.assignee?.accountId || null, teamId });
    if (st !== 'outside') return {};
    return { status: { type: 'lozenge', value: { label: 'Nicht im Team / Not in team', type: 'removed' } } };
  } catch (e) {
    return {};
  }
}

export const reportJob = guarded('[reportJob]', reportJobRun);
export const hourlyJob = guarded('[hourlyJob]', hourlyJobRun);
export const lockEnforcer = guarded('[lockEnforcer]', lockEnforcerRun);
// Atlassian's personal data reporting (lib/privacy.js): daily, reports every 6 days, on every site.
export const privacyJob = guarded('[privacyJob]', () => reportPersonalData());
