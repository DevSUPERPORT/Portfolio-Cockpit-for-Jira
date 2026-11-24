// AI budget – pure part (server and tests). Forge LLM is billed to SUPERPORT (the app developer) per token, with no
// spend cap from Atlassian. So every site gets a monthly budget in EUR that SUPERPORT sets in the Forge variable
// AI_BUDGET (from the "SUPERPORT App Status" app); the site's Jira admin may only LOWER it. Every answer is priced from
// the tokens Atlassian reports and added to the site's monthly meter. From 98 % of the budget no new AI call starts
// until the 1st of the next month – the cockpit then works with its own rules, as it does with AI switched off.
// On top of the EUR budget, a cap of Forge LLM calls and tokens per site and month applies, counted on the same meter.
// Its defaults live in shared/llmLimits.js (MONTHLY_LLM_CALLS, MONTHLY_LLM_TOKENS); SUPERPORT overrides them per app
// and per site with the v2 fields below (effectiveCaps).
//
// AI_BUDGET, contract v2, kind "eur" (compact JSON; source of truth: SUPERPORT-OPS jira-app/src/aibudget.js):
//   {"eurPerMonth":50,"eurPerUsd":1,"dailyPerPerson":60,"stop":false,"sites":{"bigcorp.atlassian.net":2000},
//    "callsPerMonth":500,"tokensPerMonth":1000000,"siteCaps":{"bigcorp.atlassian.net":{"callsPerMonth":5000}}}
//   v1 fields (unchanged): eurPerMonth 0–1,000,000 · eurPerUsd 0.5–2 · dailyPerPerson 1–500 · stop · sites host → EUR
//   v2 fields: callsPerMonth 0–1,000,000 · tokensPerMonth 0–1,000,000,000 (whole numbers, per site and UTC month;
//              0 = AI off) · siteCaps host → { callsPerMonth?, tokensPerMonth? } (a missing field = the app-wide value)
// A v1 value (without the v2 fields) reads exactly as before; the v2 fields take their defaults. Every field is read on
// its own: an invalid one falls back to its default (never "unlimited") and is listed in `problems` (the server logs
// them once per value); nothing here throws.
import { MONTHLY_LLM_CALLS, MONTHLY_LLM_TOKENS } from './llmLimits.js';

export { MONTHLY_LLM_CALLS, MONTHLY_LLM_TOKENS };
// Default monthly EUR budget per site where SUPERPORT set none in App Status (AI_BUDGET unset, no eurPerMonth, or a broken
// value): 20 € from December 2026 (decided 2026-11-24). November 2026 keeps the former 50 €, so AI already used this month
// is not cut off. A value App Status writes always wins (higher or lower).
export const DEFAULT_EUR = 20;
export const DEFAULT_EUR_FROM = '2026-12';
const FORMER_DEFAULT_EUR = 50;
/** The default monthly EUR budget for a calendar month 'YYYY-MM'. */
export const defaultEurFor = (month) => (String(month) >= DEFAULT_EUR_FROM ? DEFAULT_EUR : FORMER_DEFAULT_EUR);
export const DEFAULT_BUDGET = Object.freeze({ eurPerMonth: DEFAULT_EUR, eurPerUsd: 1, dailyPerPerson: 60, stop: false, sites: Object.freeze({}) });
/** The v2 usage fields: defaults (contract DEFAULTS_USAGE = shared/llmLimits.js) and ranges (contract LIMITS). */
export const DEFAULT_CAPS = Object.freeze({ callsPerMonth: MONTHLY_LLM_CALLS, tokensPerMonth: MONTHLY_LLM_TOKENS, siteCaps: Object.freeze({}) });
export const CAP_MAX = Object.freeze({ callsPerMonth: 1e6, tokensPerMonth: 1e9 });
const CAP_KEYS = Object.freeze(['callsPerMonth', 'tokensPerMonth']);
const KNOWN = Object.freeze(['eurPerMonth', 'eurPerUsd', 'dailyPerPerson', 'stop', 'sites', ...CAP_KEYS, 'siteCaps']);
const MAX_SITES = 200;
export const STOP_AT = 0.98; // a burst of parallel calls may each pass the check – stop a little early
export const WARN_AT = [0.5, 0.8];
const MAX_EUR = 1e6;

// Atlassian's price list (USD per 1M tokens, input / output) – developer.atlassian.com › Forge LLMs pricing.
// An unknown model is priced like the most expensive one, so the meter never under-counts.
export const PRICES = Object.freeze([
  [/opus/i, 5, 25],
  [/sonnet/i, 3, 15],
  [/haiku/i, 1, 5],
]);
const MOST_EXPENSIVE = [null, 5, 25];
export const priceOf = (model) => { const p = PRICES.find(([re]) => re.test(String(model || ''))) || MOST_EXPENSIVE; return { inUsd: p[1], outUsd: p[2] }; };

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
export const siteKey = (s) => String(s || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

// The variable as SUPERPORT wrote it → a clean object. Anything invalid falls back to the defaults (never "unlimited").
// `problems` lists what was ignored (empty for every value App Status writes); `invalid` = not a JSON object at all.
export function parseBudget(raw) {
  let x = raw;
  if (typeof raw === 'string') { try { x = raw.trim() ? JSON.parse(raw) : {}; } catch { x = null; } }
  const ok = isObj(x);
  const src = ok ? x : {};
  const problems = [];
  if (typeof raw === 'string' && raw.trim() !== '' && !ok) problems.push('not a JSON object');
  const unknown = Object.keys(src).filter((k) => !KNOWN.includes(k));
  if (unknown.length) problems.push(`unknown field(s) ${unknown.slice(0, 5).join(', ')}`);
  const eurPerMonth = num(src.eurPerMonth, 0, MAX_EUR), eurPerUsd = num(src.eurPerUsd, 0.5, 2);
  const daily = Number.isInteger(src.dailyPerPerson) && src.dailyPerPerson >= 1 && src.dailyPerPerson <= 500 ? src.dailyPerPerson : null;
  for (const [k, bad] of [['eurPerMonth', eurPerMonth == null], ['eurPerUsd', eurPerUsd == null], ['dailyPerPerson', daily == null], ['stop', typeof src.stop !== 'boolean']]) if (src[k] !== undefined && bad) problems.push(k);
  const sites = {};
  if (isObj(src.sites)) {
    for (const [k, v] of Object.entries(src.sites).slice(0, MAX_SITES)) { const e = num(v, 0, MAX_EUR); const h = siteKey(k); if (e != null && HOST.test(h)) sites[h] = e; else problems.push(`sites["${String(k).slice(0, 80)}"]`); }
  } else if (src.sites !== undefined) problems.push('sites');
  // v2: Forge LLM calls / tokens per site and month – app-wide, and per site
  const caps = {};
  for (const k of CAP_KEYS) {
    if (src[k] === undefined) caps[k] = DEFAULT_CAPS[k];
    else if (isCount(src[k], CAP_MAX[k])) caps[k] = src[k];
    else { caps[k] = DEFAULT_CAPS[k]; problems.push(k); }
  }
  const siteCaps = {};
  if (isObj(src.siteCaps)) {
    for (const [k, v] of Object.entries(src.siteCaps).slice(0, MAX_SITES)) {
      const h = siteKey(k), c = {};
      if (HOST.test(h) && isObj(v)) for (const f of CAP_KEYS) { if (isCount(v[f], CAP_MAX[f])) c[f] = v[f]; else if (v[f] !== undefined) problems.push(`siteCaps["${h}"].${f}`); }
      if (Object.keys(c).length) siteCaps[h] = c; // a bad entry is left out: that site gets the app-wide values
      else problems.push(`siteCaps["${String(k).slice(0, 80)}"]`);
    }
  } else if (src.siteCaps !== undefined) problems.push('siteCaps');
  return {
    eurPerMonth: eurPerMonth ?? DEFAULT_BUDGET.eurPerMonth,
    eurDefault: eurPerMonth == null, // no valid value from App Status → the default of the month applies (effectiveBudget)
    eurPerUsd: eurPerUsd ?? DEFAULT_BUDGET.eurPerUsd,
    dailyPerPerson: daily ?? DEFAULT_BUDGET.dailyPerPerson,
    stop: src.stop === true,
    sites,
    callsPerMonth: caps.callsPerMonth, tokensPerMonth: caps.tokensPerMonth, siteCaps,
    set: typeof raw === 'string' ? raw.trim() !== '' && ok : !!raw,
    invalid: typeof raw === 'string' && raw.trim() !== '' && !ok,
    problems,
  };
}

// The calls / tokens per month that apply on one site (contract effectiveCaps): the site's own cap where SUPERPORT set
// one, else the app-wide value, else the default. Works defensively on raw objects too. `off` = AI off on this site
// (stop, or either cap 0); `siteCap` = SUPERPORT set a value for this very site. Unknown host → the app-wide values.
export function effectiveCaps(budget, host) {
  const b = isObj(budget) ? budget : {};
  const h = siteKey(host);
  const all = isObj(b.siteCaps) ? b.siteCaps : {};
  const cap = h && Object.hasOwn(all, h) && isObj(all[h]) ? all[h] : {};
  const pick = (k) => (isCount(cap[k], CAP_MAX[k]) ? cap[k] : isCount(b[k], CAP_MAX[k]) ? b[k] : DEFAULT_CAPS[k]);
  const callsPerMonth = pick('callsPerMonth'), tokensPerMonth = pick('tokensPerMonth');
  return { callsPerMonth, tokensPerMonth, stop: b.stop === true, off: b.stop === true || callsPerMonth === 0 || tokensPerMonth === 0, siteCap: CAP_KEYS.some((k) => isCount(cap[k], CAP_MAX[k])) };
}

// What applies on this site: SUPERPORT's cap (site override or default), lowered by the site admin if they chose to.
// cfgAi.budgetEur / cfgAi.dailyLimit come from Konfiguration › KI & Datenschutz (null = SUPERPORT's value). The calls /
// tokens per month are SUPERPORT's alone (effectiveCaps); the admin's stored values are only read here, never changed.
export function effectiveBudget(budget, host, cfgAi = {}, now = new Date()) {
  const b = budget || parseBudget(null);
  const h = siteKey(host);
  const base = b.eurDefault === true ? defaultEurFor(monthOf(now)) : b.eurPerMonth;
  const cap = h && b.sites[h] != null ? b.sites[h] : base;
  const own = num(cfgAi?.budgetEur, 0, MAX_EUR);
  const ownDaily = Number.isInteger(cfgAi?.dailyLimit) && cfgAi.dailyLimit >= 1 ? cfgAi.dailyLimit : null;
  const caps = effectiveCaps(b, h);
  return {
    capEur: cap, limitEur: own != null ? Math.min(own, cap) : cap, lowered: own != null && own < cap,
    capDaily: b.dailyPerPerson, dailyPerPerson: ownDaily != null ? Math.min(ownDaily, b.dailyPerPerson) : b.dailyPerPerson,
    stop: b.stop, eurPerUsd: b.eurPerUsd, siteOverride: !!(h && b.sites[h] != null), set: b.set,
    callLimit: caps.callsPerMonth, tokenLimit: caps.tokensPerMonth, siteCaps: caps.siteCap,
  };
}

export const monthOf = (d = new Date()) => d.toISOString().slice(0, 7); // UTC calendar month
export const nextMonthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);

// Tokens of one answer: what Atlassian reports; if it reports nothing, a generous estimate (≈ 3 characters per token)
// for the EUR meter. `reported` = the tokens Atlassian reported in the response `usage` (total_tokens, else input +
// output) – only these count towards MONTHLY_LLM_TOKENS; nothing reported → 0 (the call itself still counts).
export function usageOf(res, promptChars = 0, answerChars = 0) {
  const u = res?.usage || {};
  const i = Number.isFinite(u.input_tokens) ? u.input_tokens : null, o = Number.isFinite(u.output_tokens) ? u.output_tokens : null;
  const reported = Number.isFinite(u.total_tokens) && u.total_tokens >= 0 ? u.total_tokens : (i ?? 0) + (o ?? 0);
  if (i != null && o != null) return { inTok: i, outTok: o, estimated: false, reported };
  return { inTok: i ?? Math.ceil(promptChars / 3), outTok: o ?? Math.ceil(answerChars / 3), estimated: true, reported };
}
// Tokens on a meter that count towards MONTHLY_LLM_TOKENS. A meter written before the token cap existed has no
// `tokens` yet: its recorded tokens count instead (estimates included – never under-count what SUPERPORT pays).
export const meterTokens = (m) => (Number.isFinite(m?.tokens) ? m.tokens : (m?.inTok || 0) + (m?.outTok || 0));
export const costUsd = (model, { inTok = 0, outTok = 0 } = {}) => { const p = priceOf(model); return (inTok * p.inUsd + outTok * p.outUsd) / 1e6; };

// The meter after one more answer (immutable; keys stay small).
export function addSpend(meter, { model, usage, feature, eurPerUsd = 1, day = null }) {
  const m = meter && typeof meter === 'object' ? meter : {};
  const usd = costUsd(model, usage);
  const eur = usd * eurPerUsd;
  const by = { ...(m.byFeature || {}) };
  by[feature || 'other'] = round6((by[feature || 'other'] || 0) + eur);
  const days = { ...(m.byDay || {}) };
  if (day) days[day] = round6((days[day] || 0) + eur); // day of the month ("01" … "31", UTC)
  return {
    eur: round6((m.eur || 0) + eur), usd: round6((m.usd || 0) + usd), calls: (m.calls || 0) + 1,
    inTok: (m.inTok || 0) + (usage?.inTok || 0), outTok: (m.outTok || 0) + (usage?.outTok || 0),
    tokens: meterTokens(m) + (Number.isFinite(usage?.reported) && usage.reported > 0 ? usage.reported : 0),
    estimated: (m.estimated || 0) + (usage?.estimated ? 1 : 0), cacheHits: m.cacheHits || 0, byFeature: by, byDay: days,
    warned: m.warned || {}, stoppedAt: m.stoppedAt || null,
  };
}
const round6 = (v) => Math.round(v * 1e6) / 1e6;

// Where the site stands this month – shown in the configuration, used by every gate. Stops on SUPERPORT's stop, on a
// cap of 0 for this site (reason capZero: SUPERPORT switched AI off here), on the EUR budget (98 %) and on the monthly
// cap of calls / tokens (100 %; SUPERPORT's values for this site, defaults in shared/llmLimits.js). `sharePct` is the
// highest of the three shares.
export function budgetState(meter, eff, now = new Date()) {
  const used = meter?.eur || 0;
  const limit = eff.limitEur;
  const pct = limit > 0 ? used / limit : used > 0 ? Infinity : 1;
  const callLimit = Number.isInteger(eff.callLimit) ? eff.callLimit : MONTHLY_LLM_CALLS;
  const tokenLimit = Number.isInteger(eff.tokenLimit) ? eff.tokenLimit : MONTHLY_LLM_TOKENS;
  const capZero = callLimit === 0 || tokenLimit === 0;
  const calls = meter?.calls || 0, tokens = meterTokens(meter);
  const callsOut = calls >= callLimit, tokensOut = tokens >= tokenLimit;
  const share = capZero ? 1 : Math.max(pct, calls / callLimit, tokens / tokenLimit);
  const stopped = eff.stop || capZero || limit <= 0 || callsOut || tokensOut || used >= limit * STOP_AT;
  return {
    month: monthOf(now), resetsOn: nextMonthStart(now), usedEur: round4(used), limitEur: round2(limit), capEur: round2(eff.capEur),
    pct: Number.isFinite(pct) ? Math.round(pct * 1000) / 10 : 100, sharePct: Number.isFinite(share) ? Math.round(share * 1000) / 10 : 100,
    level: stopped ? 'stopped' : share >= WARN_AT[1] ? 'warn80' : share >= WARN_AT[0] ? 'warn50' : 'ok',
    stopped, reason: eff.stop ? 'superportStop' : capZero ? 'capZero' : limit <= 0 ? 'zero' : callsOut ? 'calls' : tokensOut ? 'tokens' : stopped ? 'used' : null,
    calls, callLimit, tokens, tokenLimit, siteCaps: eff.siteCaps === true,
    cacheHits: meter?.cacheHits || 0, estimated: meter?.estimated || 0, byFeature: meter?.byFeature || {},
    dailyPerPerson: eff.dailyPerPerson, capDaily: eff.capDaily, lowered: eff.lowered, siteOverride: eff.siteOverride, set: eff.set, eurPerUsd: eff.eurPerUsd,
  };
}
const round2 = (v) => Math.round(v * 100) / 100;
const round4 = (v) => Math.round(v * 10000) / 10000; // a single answer costs fractions of a cent – keep them visible

// ---------- spending view (Konfiguration › KI & Datenschutz › Ausgaben) ----------
const daysIn = (ym) => { const [y, mo] = ym.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
// months: [{ month: 'YYYY-MM', meter }] (oldest first, this month last). Everything the charts and figures need – and
// the forecast: today's pace continued to the month's end (shown only after 3 days, before that it says too little).
export function spendView(months, { now = new Date(), limitEur = null } = {}) {
  const cur = monthOf(now);
  const list = (months || []).filter((x) => /^\d{4}-\d{2}$/.test(x?.month || '')).sort((a, b) => a.month.localeCompare(b.month));
  const me = list.find((x) => x.month === cur)?.meter || {};
  const dim = daysIn(cur), today = now.getUTCDate();
  const daily = Array.from({ length: today }, (_, i) => { const d = String(i + 1).padStart(2, '0'); return { day: d, eur: round2(me.byDay?.[d] || 0) }; });
  let run = 0;
  const cumulative = daily.map((d) => (run = round2(run + d.eur)));
  const used = me.eur || 0;
  const elapsed = (today - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440) || 0.01;
  const forecastEur = today >= 3 ? round2((used / elapsed) * dim) : null;
  const calls = me.calls || 0, hits = me.cacheHits || 0;
  const perAnswer = calls ? used / calls : null;
  return {
    month: cur, daysInMonth: dim, today, daily, cumulative,
    usedEur: round4(used), limitEur, forecastEur, forecastOver: forecastEur != null && limitEur != null && forecastEur > limitEur,
    perAnswerEur: perAnswer == null ? null : Math.round(perAnswer * 10000) / 10000, calls, cacheHits: hits,
    savedEur: perAnswer == null ? 0 : round2(hits * perAnswer), tokens: { in: me.inTok || 0, out: me.outTok || 0 },
    byFeature: Object.entries(me.byFeature || {}).map(([k, v]) => ({ feature: k, eur: round2(v) })).sort((a, b) => b.eur - a.eur),
    months: list.map((x) => ({ month: x.month, eur: round2(x.meter?.eur || 0), calls: x.meter?.calls || 0, cacheHits: x.meter?.cacheHits || 0 })),
  };
}
