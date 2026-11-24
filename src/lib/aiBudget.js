// AI budget – server part: the monthly meter in this site's app storage, the gate before every Forge LLM call and the
// shared answer cache. The rules (budget variable, prices, thresholds) live in shared/aiBudget.js.
//
//   vendorStop()            → throws AI_BUDGET (superportStop) while SUPERPORT has stopped AI for every site – no I/O,
//                             the very first gate in llm()
//   checkBudget(cfg)        → throws AI_BUDGET when this month's budget is used up, the monthly cap of Forge LLM calls /
//                             tokens for this site is reached (SUPERPORT's values from AI_BUDGET v2, defaults in
//                             shared/llmLimits.js), a cap is 0 for this site, or SUPERPORT stopped AI – before every call
//   recordSpend(cfg, …)     → adds one answer's real cost to the meter; logs 50 % / 80 % / stop once per month
//   budgetStatus(cfg)       → what the configuration shows (used / limit / % / resets on)
//   cacheGet / cacheSet     → identical prompt (same model, same instructions, same facts) → the stored answer, free
//
// Nothing here holds prompt contents except the cache, which keeps the ANSWER under a hash of the prompt for at most
// CACHE_HOURS and is deleted when AI is switched off. Same facts = same data the asker was allowed to see, so a cached
// answer never shows anyone more than their own request would have.
import { createHash } from 'node:crypto';
import { kvs, WhereConditions } from '@forge/kvs';
import { jira } from './jira.js';
import { audit } from './store.js';
import { parseBudget, effectiveBudget, budgetState, addSpend, monthOf, nextMonthStart, WARN_AT, spendView } from '../../shared/aiBudget.js';

export const CACHE_HOURS = 12;
const SPEND = (ym) => `ai:spend:${ym}`;
const SITE = 'meta:site';
const SYSTEM_CTX = { accountId: 'system', displayName: 'AI budget' };

// This site's host (e.g. "bigcorp.atlassian.net") – the key for SUPERPORT's per-site budgets (v1 `sites`) and caps (v2
// `siteCaps`). Cached for a day in app storage; unknown (lookup failed, nothing cached) → the app-wide values apply.
export async function siteHost(deps = {}) {
  const get = deps.get || ((k) => kvs.get(k)), set = deps.set || ((k, v) => kvs.set(k, v)), fetchInfo = deps.serverInfo || (() => jira('app', '/rest/api/3/serverInfo'));
  const c = await get(SITE);
  if (c?.host && Date.now() - c.at < 24 * 3600e3) return c.host;
  try {
    const info = await fetchInfo();
    const host = String(info?.baseUrl || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
    if (host) await set(SITE, { host, at: Date.now() });
    return host || c?.host || null;
  } catch { return c?.host || null; }
}

// The variable, read defensively: anything SUPERPORT's value has that this app can't use is ignored (that field takes its
// default, never "unlimited") and logged once per value – not on every call.
let warnedFor = null;
export function envBudget(env = process.env, warn = (m) => console.warn(m)) {
  const raw = env?.AI_BUDGET ?? '';
  const b = parseBudget(raw);
  if (b.problems.length && warnedFor !== raw) {
    warnedFor = raw;
    try { warn(`[ai-budget] AI_BUDGET: ignored ${b.problems.slice(0, 8).join(', ')}${b.problems.length > 8 ? ', …' : ''} – the defaults apply there`); } catch { /* logging never blocks */ }
  }
  return b;
}

// SUPERPORT's emergency stop for every site – the first gate before Forge LLM, before the site's own switch. Reads only
// the variable (no storage, no Jira call) and never touches the site's stored settings.
export function vendorStop({ env = process.env, now = new Date() } = {}) {
  if (envBudget(env).stop) throw Object.assign(new Error('AI_BUDGET:superportStop'), { code: 'AI_BUDGET', budget: { reason: 'superportStop', resetsOn: nextMonthStart(now) } });
}

export async function budgetStatus(cfg, { env = process.env, now = new Date(), deps = {} } = {}) {
  const get = deps.get || ((k) => kvs.get(k));
  const host = await siteHost(deps);
  const b = envBudget(env);
  const eff = effectiveBudget(b, host, cfg?.ai, now);
  const meter = await get(SPEND(monthOf(now)));
  return { ...budgetState(meter, eff, now), host, invalidVariable: b.invalid };
}

export async function checkBudget(cfg, opts = {}) {
  const s = await budgetStatus(cfg, opts);
  if (s.stopped) throw Object.assign(new Error(`AI_BUDGET:${s.reason}`), { code: 'AI_BUDGET', budget: { reason: s.reason, resetsOn: s.resetsOn } });
  return s;
}

// One answer's cost onto this month's meter. Read-modify-write: two parallel answers may race for the same key and one
// increment can be lost – the 98 % stop leaves room for that, and the next answer reads the newer total.
export async function recordSpend(cfg, { model, usage, feature }, { env = process.env, now = new Date(), deps = {} } = {}) {
  const get = deps.get || ((k) => kvs.get(k)), set = deps.set || ((k, v) => kvs.set(k, v)), log = deps.audit || audit;
  const key = SPEND(monthOf(now));
  const host = await siteHost(deps);
  const eff = effectiveBudget(envBudget(env), host, cfg?.ai, now);
  const before = await get(key);
  let meter = addSpend(before, { model, usage, feature, eurPerUsd: eff.eurPerUsd, day: new Date(now).toISOString().slice(8, 10) });
  const state = budgetState(meter, eff, now);
  const warned = { ...(meter.warned || {}) };
  const marks = [...WARN_AT.map((w) => [`${Math.round(w * 100)}`, state.sharePct >= w * 100]), ['stop', state.stopped]];
  const fresh = marks.filter(([k, hit]) => hit && !warned[k]).map(([k]) => k);
  for (const k of fresh) warned[k] = new Date(now).toISOString();
  meter = { ...meter, warned, stoppedAt: state.stopped ? meter.stoppedAt || new Date(now).toISOString() : null };
  await set(key, meter);
  for (const k of fresh) await log(SYSTEM_CTX, k === 'stop' ? 'ai.budget.stopped' : `ai.budget.${k}`, { month: state.month, usedEur: state.usedEur, limitEur: state.limitEur, calls: state.calls, callLimit: state.callLimit, tokens: state.tokens, tokenLimit: state.tokenLimit, ...(k === 'stop' ? { reason: state.reason } : {}) }).catch(() => null);
  return state;
}

export async function recordCacheHit({ now = new Date(), deps = {} } = {}) {
  const get = deps.get || ((k) => kvs.get(k)), set = deps.set || ((k, v) => kvs.set(k, v));
  const key = SPEND(monthOf(now));
  const m = (await get(key)) || {};
  await set(key, { ...m, cacheHits: (m.cacheHits || 0) + 1 });
}

// The last six months of this site's meter (numbers only) for the spending charts – Jira admins only (see index.js).
export async function spendHistory(cfg, { now = new Date(), months = 6, deps = {} } = {}) {
  const get = deps.get || ((k) => kvs.get(k));
  const list = [];
  for (let i = months - 1; i >= 0; i--) {
    const ym = monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
    list.push({ month: ym, meter: (await get(SPEND(ym))) || {} });
  }
  const status = await budgetStatus(cfg, { now, deps });
  return { view: spendView(list, { now, limitEur: status.limitEur }), budget: status };
}

// ---------- shared answer cache ----------
export const cacheKey = (model, system, user) => `ai:cache:${createHash('sha256').update(`${model}\n${system}\n${user}`).digest('hex').slice(0, 48)}`;
export async function cacheGet(key, { now = Date.now(), deps = {} } = {}) {
  const get = deps.get || ((k) => kvs.get(k));
  const v = await get(key);
  return v?.text && now - v.at < CACHE_HOURS * 3600e3 ? v : null;
}
export const cacheSet = (key, value, { deps = {} } = {}) => (deps.set || ((k, v) => kvs.set(k, v)))(key, { ...value, at: Date.now() });

// Old cache entries (hourly job) – or all of them (AI switched off).
export async function purgeCache({ all = false, now = Date.now() } = {}) {
  let cursor, n = 0;
  for (let i = 0; i < 50; i++) {
    let q = kvs.query().where('key', WhereConditions.beginsWith('ai:cache:')).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    for (const r of page.results) if (all || !r.value?.at || now - r.value.at >= CACHE_HOURS * 3600e3) { await kvs.delete(r.key).catch(() => null); n++; }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return n;
}
