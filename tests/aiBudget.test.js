// AI budget (2026-11-12): Forge LLM is billed to SUPERPORT per token. SUPERPORT sets a monthly EUR budget per site
// (Forge variable AI_BUDGET), the site admin may only lower it, every answer is priced from Atlassian's token figures,
// and from 98 % no new AI call starts until the 1st. These tests pin the money rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBudget, effectiveBudget, budgetState, addSpend, costUsd, priceOf, usageOf, monthOf, nextMonthStart, DEFAULT_BUDGET, STOP_AT } from '../shared/aiBudget.js';
import { validAi } from '../src/lib/config.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the variable: valid JSON → clean values; anything broken → the defaults, never "unlimited"', () => {
  const b = parseBudget('{"eurPerMonth":500,"eurPerUsd":0.92,"dailyPerPerson":40,"stop":false,"sites":{"https://BigCorp.atlassian.net/":2000,"bad host":5,"x.atlassian.net":-1}}');
  assert.deepEqual([b.eurPerMonth, b.eurPerUsd, b.dailyPerPerson, b.stop, b.sites, b.set, b.invalid], [500, 0.92, 40, false, { 'bigcorp.atlassian.net': 2000 }, true, false]);
  const unset = parseBudget('');
  assert.deepEqual([unset.eurPerMonth, unset.eurPerUsd, unset.dailyPerPerson, unset.set], [DEFAULT_BUDGET.eurPerMonth, 1, 60, false]);
  const broken = parseBudget('{eurPerMonth: 1e9');
  assert.equal(broken.invalid, true);
  assert.equal(broken.eurPerMonth, DEFAULT_BUDGET.eurPerMonth, 'a typo never removes the limit');
  assert.equal(parseBudget('{"eurPerMonth":99999999}').eurPerMonth, DEFAULT_BUDGET.eurPerMonth, 'out of range → default');
  assert.equal(parseBudget('{"eurPerUsd":7}').eurPerUsd, 1);
  assert.equal(parseBudget('{"stop":"yes"}').stop, false, 'only a real true stops');
});

test('per site: SUPERPORT\'s override wins over the default; the site admin can only LOWER, never raise', () => {
  const b = parseBudget('{"eurPerMonth":100,"dailyPerPerson":60,"sites":{"bigcorp.atlassian.net":2000}}');
  assert.equal(effectiveBudget(b, 'BigCorp.atlassian.net', {}).limitEur, 2000);
  assert.equal(effectiveBudget(b, 'other.atlassian.net', {}).limitEur, 100);
  const lowered = effectiveBudget(b, 'other.atlassian.net', { budgetEur: 30, dailyLimit: 10 });
  assert.deepEqual([lowered.limitEur, lowered.lowered, lowered.dailyPerPerson], [30, true, 10]);
  const raised = effectiveBudget(b, 'other.atlassian.net', { budgetEur: 5000, dailyLimit: 400 });
  assert.deepEqual([raised.limitEur, raised.lowered, raised.dailyPerPerson], [100, false, 60], 'a higher own value has no effect');
  assert.equal(effectiveBudget(b, null, {}).limitEur, 100, 'unknown host → default budget');
});

test('the admin\'s own limits are saved only as numbers in range (the status is never saved)', () => {
  const v = validAi({ enabled: true, budgetEur: 42.555, dailyLimit: 12, budget: { usedEur: 1, stopped: true } }, null);
  assert.deepEqual([v.budgetEur, v.dailyLimit, 'budget' in v], [42.56, 12, false]);
  const bad = validAi({ enabled: true, budgetEur: -1, dailyLimit: 1.5 }, null);
  assert.deepEqual([bad.budgetEur, bad.dailyLimit], [null, null]);
});

test('prices: Atlassian\'s list per 1M tokens; an unknown model is priced like the most expensive one', () => {
  assert.deepEqual(priceOf('anthropic.claude-sonnet-4-5-20250929'), { inUsd: 3, outUsd: 15 });
  assert.deepEqual(priceOf('claude-haiku-4-5'), { inUsd: 1, outUsd: 5 });
  assert.deepEqual(priceOf('claude-opus-4-6'), { inUsd: 5, outUsd: 25 });
  assert.deepEqual(priceOf('some-new-model'), { inUsd: 5, outUsd: 25 });
  // 1 000 in + 500 out with Sonnet = 0.003 + 0.0075 = 0.0105 $
  assert.equal(Math.round(costUsd('claude-sonnet-4-5', { inTok: 1000, outTok: 500 }) * 1e6) / 1e6, 0.0105);
});

test('tokens: Atlassian\'s figures when reported, otherwise a generous estimate that is marked', () => {
  assert.deepEqual(usageOf({ usage: { input_tokens: 812, output_tokens: 233 } }, 9999, 9999), { inTok: 812, outTok: 233, estimated: false, reported: 1045 });
  assert.deepEqual(usageOf({}, 3000, 600), { inTok: 1000, outTok: 200, estimated: true, reported: 0 }, 'estimates never count as reported tokens (monthly cap)');
});

test('the meter adds real cost in EUR, per feature; warnings at 50 / 80 %, stop at 98 %', () => {
  const eff = effectiveBudget(parseBudget('{"eurPerMonth":1,"eurPerUsd":0.9}'), 'x.atlassian.net', {});
  let m = null;
  m = addSpend(m, { model: 'claude-sonnet-4-5', usage: { inTok: 100000, outTok: 10000 }, feature: 'ask', eurPerUsd: eff.eurPerUsd }); // 0.3 + 0.15 = 0.45 $ → 0.405 €
  assert.equal(m.eur, 0.405);
  assert.equal(m.calls, 1);
  assert.equal(m.byFeature.ask, 0.405);
  assert.equal(budgetState(m, eff).level, 'ok');
  m = addSpend(m, { model: 'claude-sonnet-4-5', usage: { inTok: 40000, outTok: 2000 }, feature: 'teamBrief', eurPerUsd: 0.9 }); // +0.15 $ → 0.135 € = 0.54 €
  assert.equal(budgetState(m, eff).level, 'warn50');
  m = addSpend(m, { model: 'claude-sonnet-4-5', usage: { inTok: 100000, outTok: 0 }, feature: 'ask', eurPerUsd: 0.9 }); // +0.27 € = 0.81 €
  assert.equal(budgetState(m, eff).level, 'warn80');
  assert.equal(budgetState({ eur: 0.979 }, eff).stopped, false);
  assert.equal(budgetState({ eur: 0.98 }, eff).stopped, true, `stop at ${STOP_AT * 100} %`);
  assert.equal(budgetState({ eur: 0 }, effectiveBudget(parseBudget('{"eurPerMonth":0}'), 'x', {})).reason, 'zero');
  assert.equal(budgetState({ eur: 0 }, effectiveBudget(parseBudget('{"stop":true}'), 'x', {})).reason, 'superportStop');
});

test('months: UTC calendar month; resets on the 1st', () => {
  assert.equal(monthOf(new Date('2026-11-30T23:59:00Z')), '2026-11');
  assert.equal(nextMonthStart(new Date('2026-11-12T10:00:00Z')), '2026-12-01');
  assert.equal(nextMonthStart(new Date('2026-12-31T10:00:00Z')), '2027-01-01');
});

test('server: recordSpend logs each threshold once, checkBudget stops a used-up site, the host picks the site budget', async () => {
  const { recordSpend, checkBudget, budgetStatus, siteHost } = await import('../src/lib/aiBudget.js');
  const store = new Map(), logs = [];
  const deps = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); }, audit: async (_c, a) => { logs.push(a); }, serverInfo: async () => ({ baseUrl: 'https://BigCorp.atlassian.net' }) };
  const env = { AI_BUDGET: '{"eurPerMonth":100,"eurPerUsd":1,"sites":{"bigcorp.atlassian.net":1}}' };
  const now = new Date('2026-11-12T10:00:00Z');
  assert.equal(await siteHost(deps), 'bigcorp.atlassian.net');
  assert.equal((await budgetStatus({ ai: {} }, { env, now, deps })).limitEur, 1, 'site override, not the default 100');
  const call = (outTok) => recordSpend({ ai: {} }, { model: 'claude-sonnet-4-5', usage: { inTok: 0, outTok }, feature: 'ask' }, { env, now, deps });
  await call(40000); // 0.6 €
  await call(1000);  // 0.615 €
  assert.deepEqual(logs, ['ai.budget.50'], '50 % logged once');
  await call(20000); // 0.915 €
  assert.deepEqual(logs, ['ai.budget.50', 'ai.budget.80']);
  await checkBudget({ ai: {} }, { env, now, deps }); // 91.5 % – still allowed
  await call(5000);  // 0.99 € → stop
  assert.deepEqual(logs, ['ai.budget.50', 'ai.budget.80', 'ai.budget.stopped']);
  await assert.rejects(() => checkBudget({ ai: {} }, { env, now, deps }), { code: 'AI_BUDGET' });
  // next month starts at zero
  await checkBudget({ ai: {} }, { env, now: new Date('2026-12-01T00:00:01Z'), deps });
  // SUPERPORT's emergency stop wins over everything
  await assert.rejects(() => checkBudget({ ai: {} }, { env: { AI_BUDGET: '{"stop":true}' }, now: new Date('2027-01-05T00:00:00Z'), deps }), { code: 'AI_BUDGET' });
});

test('the gateway: switch → budget → cache → call → cost recorded (also on timeout); nothing reaches Forge LLM past the budget', () => {
  const ai = read('src/lib/ai.js');
  const body = ai.slice(ai.indexOf('export async function llm('), ai.indexOf('export const dropCached'));
  const order = ['aiAllowed(', 'checkBudget(', 'cacheGet(', 'chat({', 'recordSpend(', 'cacheSet('].map((s) => body.indexOf(s));
  assert.ok(order.every((i) => i > 0), 'all steps present');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in this order');
  assert.match(body, /e\.code === 'AI_TIMEOUT'\) await recordSpend/, 'a timed-out request is still counted');
  assert.equal((ai.match(/\bchat\(/g) || []).length, 1, 'Forge LLM is called in exactly one place');
  // the per-person quota checks the budget first and uses SUPERPORT's / the admin's daily value
  assert.match(ai, /export async function takeQuota\(accountId, cfg\) \{\n[^\n]*AI_USER_OFF[^\n]*\n\s+const limit = cfg \? \(await checkBudget\(cfg\)\)\.dailyPerPerson : DAILY_LIMIT;/, 'own switch, then budget, then daily limit');
  const index = read('src/index.js');
  assert.equal((index.match(/await takeQuota\(ctx\.accountId, cfg\)/g) || []).length, 3);
  assert.match(read('src/lib/aiAssist.js'), /await D\.takeQuota\(ctx\.accountId, cfg\)/);
  // switching AI off also deletes the shared answer cache; the hourly job drops entries older than 12 h
  assert.match(ai, /purgeCache\(\{ all: true \}\)/);
  assert.match(index, /out\.aiCachePurged = await purgeCache\(\)/);
});

test('the browser: a used-up budget hides every AI entry point; the budget is shown to admins', () => {
  assert.match(read('static/cockpit/src/lib/aiFlags.js'), /config\.ai\.budget\?\.stopped !== true/);
  assert.match(read('src/index.js'), /config: await clientConfig\(cfg, ctx\.accountId, prefs\)/);
  assert.match(read('src/index.js'), /ds\.config = await clientConfig\(cfg, ctx\.accountId\)/);
  assert.match(read('static/cockpit/src/components/AiSettings.jsx'), /<AiBudget budget=\{budget\}/);
  assert.match(read('static/cockpit/src/state.jsx'), /AI_BUDGET/);
});

test('AI per person (2026-11-12): off by default, the server refuses before anything is read; the switch is logged and undoable', async () => {
  const ai = read('src/lib/ai.js');
  // first line of takeQuota – every AI path calls it before reading data or calling Forge LLM
  assert.match(ai, /export async function takeQuota\(accountId, cfg\) \{\n\s+if \(cfg && cfg\.ai\?\.access !== 'all' && !\(await userAiOn\(accountId\)\)\) throw Object\.assign\(new Error\('AI_USER_OFF'\)/);
  assert.match(ai, /export const userAiOn = async \(accountId\) => \(await get\(`pref:\$\{accountId\}`\)\)\?\.ai === true;/, 'only an explicit true counts – default off');
  const index = read('src/index.js');
  assert.match(index, /if \(typeof payload\.ai === 'boolean' && payload\.ai !== \(cur\.ai === true\)\) \{ next\.ai = payload\.ai; await audit\(ctx, payload\.ai \? 'ai\.user\.on' : 'ai\.user\.off', \{\}\); \}/);
  assert.match(index, /user: p\?\.ai === true/);
  assert.match(index, /def\('ai\.users', async \(\{ roles \}\) => \{ requireRole\(roles, 'admin'\);/, 'the count is for Jira admins only');
  // the browser shows AI entry points only to people who switched it on; the header switch has undo
  const { aiOn } = await import('../static/cockpit/src/lib/aiFlags.js');
  const cfg = (user) => ({ ai: { enabled: true, features: {}, user } });
  assert.equal(aiOn(cfg(undefined), 'ask'), false, 'default: off');
  assert.equal(aiOn(cfg(false), 'ask'), false);
  assert.equal(aiOn(cfg(true), 'ask'), true);
  assert.equal(aiOn({ ai: { enabled: false, features: {}, user: true } }, 'ask'), false, 'the site switch still rules');
  const app = read('static/cockpit/src/App.jsx');
  assert.match(app, /<AiMineSwitch \/>\n\s+<LangSwitch \/>/);
  assert.match(app, /pushUndo\(to \? tr\('KI für mich eingeschaltet'/);
  assert.match(read('static/cockpit/src/state.jsx'), /AI_USER_OFF/);
});

test('spending view: day by day, cumulative, month-end forecast, cost per answer, savings by reuse, six months', async () => {
  const { spendView, addSpend } = await import('../shared/aiBudget.js');
  let m = addSpend(null, { model: 'claude-sonnet-4-5', usage: { inTok: 100000, outTok: 0 }, feature: 'ask', day: '01' }); // 0.30 €
  m = addSpend(m, { model: 'claude-sonnet-4-5', usage: { inTok: 0, outTok: 20000 }, feature: 'teamBrief', day: '05' }); // 0.30 €
  m = { ...m, cacheHits: 4 };
  const v = spendView([{ month: '2026-10', meter: { eur: 9, calls: 900 } }, { month: '2026-11', meter: m }], { now: new Date('2026-11-11T00:00:00Z'), limitEur: 1 });
  assert.equal(v.daily.length, 11);
  assert.deepEqual([v.daily[0].eur, v.daily[4].eur, v.cumulative[3], v.cumulative[10]], [0.3, 0.3, 0.3, 0.6]);
  assert.equal(v.forecastEur, 1.8, '0.60 € in 10 days → 1.80 € in 30');
  assert.equal(v.forecastOver, true);
  assert.equal(v.perAnswerEur, 0.3);
  assert.equal(v.savedEur, 1.2, '4 reused answers × 0.30 €');
  assert.deepEqual(v.byFeature.map((x) => x.feature), ['ask', 'teamBrief']);
  assert.deepEqual(v.months.map((x) => [x.month, x.eur]), [['2026-10', 9], ['2026-11', 0.6]]);
  assert.equal(spendView([{ month: '2026-11', meter: m }], { now: new Date('2026-11-02T10:00:00Z'), limitEur: 1 }).forecastEur, null, 'no forecast before day 3');
});

test('spending: admins only; the page links to Atlassian\'s own figures (developer console of THIS app, price lists, alerts)', () => {
  assert.match(read('src/index.js'), /def\('ai\.spend', async \(\{ cfg, roles \}\) => \{ requireRole\(roles, 'admin'\); return spendHistory\(cfg\); \}\);/);
  const spend = read('static/cockpit/src/components/AiSpend.jsx');
  const appId = /app:\s*\n\s*runtime:[\s\S]*?id: ari:cloud:ecosystem::app\/([0-9a-f-]{36})/.exec(read('manifest.yml'))?.[1];
  assert.ok(appId, 'app id in the manifest');
  assert.match(spend, new RegExp(`const APP_ID = '${appId}';`), 'the console link points at this app');
  for (const u of ['https://developer.atlassian.com/console/myapps/', 'https://developer.atlassian.com/platform/forge/runtime-reference/forge-llms-api-pricing/', 'https://developer.atlassian.com/platform/forge/forge-platform-pricing/', 'https://developer.atlassian.com/platform/forge/usage-alerts/']) assert.ok(spend.includes(u), u);
  assert.match(spend, /Andere Forge-Kosten \(Rechenzeit, Speicher\) misst die App nicht selbst/, 'says what it does NOT measure');
});

test('who uses AI is the admin\'s choice: each person (default) or everyone – the server follows it', async () => {
  const { validAi } = await import('../src/lib/config.js');
  assert.equal(validAi({ enabled: true }, null).access, 'self', 'default: each person decides');
  assert.equal(validAi({ enabled: true, access: 'all' }, null).access, 'all');
  assert.equal(validAi({ enabled: true, access: 'everyone!' }, null).access, 'self', 'anything else → self');
  assert.match(read('src/lib/ai.js'), /if \(cfg && cfg\.ai\?\.access !== 'all' && !\(await userAiOn\(accountId\)\)\) throw/);
  const { aiOn, aiPerPerson } = await import('../static/cockpit/src/lib/aiFlags.js');
  const all = { ai: { enabled: true, features: {}, access: 'all' } };
  assert.equal(aiOn(all, 'ask'), true, 'everyone: no personal switch needed');
  assert.equal(aiPerPerson(all), false, 'and no header switch');
  assert.equal(aiPerPerson({ ai: { enabled: true, features: {} } }), true);
  assert.equal(aiOn({ ai: { ...all.ai, budget: { stopped: true } } }, 'ask'), false, 'the budget still rules');
  assert.match(read('static/cockpit/src/components/AiSettings.jsx'), /role="radiogroup" aria-label=\{tr\('Wer nutzt die KI\?'/);
});

// 2026-11-24: default monthly budget 20 € per site where App Status set none – from December 2026 (November keeps 50 €).
const NOV = new Date('2026-11-24T12:00:00Z'), DEC = new Date('2026-12-01T00:00:00Z');
test('default monthly budget: 20 € per site from December 2026, the former 50 € in November 2026', () => {
  assert.equal(DEFAULT_BUDGET.eurPerMonth, 20);
  for (const raw of ['', null, '{}', '{"stop":false}', '{eurPerMonth: 1e9', '{"eurPerMonth":-1}']) {
    assert.equal(effectiveBudget(parseBudget(raw), 'customer.atlassian.net', {}, DEC).limitEur, 20, String(raw));
    assert.equal(effectiveBudget(parseBudget(raw), 'customer.atlassian.net', {}, NOV).limitEur, 50, String(raw));
  }
  assert.equal(effectiveBudget(parseBudget(''), 'x.atlassian.net', {}, new Date('2027-03-15T00:00:00Z')).limitEur, 20);
  const eff = effectiveBudget(parseBudget(''), 'customer.atlassian.net', {}, DEC);
  assert.equal(budgetState({ eur: 19.5 }, eff, DEC).stopped, false);
  assert.equal(budgetState({ eur: 19.6 }, eff, DEC).stopped, true, 'stop from 98 % = 19.60 €');
  assert.equal(effectiveBudget(parseBudget(''), 'x.atlassian.net', { budgetEur: 30 }, DEC).limitEur, 20, 'the site admin can only lower it');
  assert.equal(effectiveBudget(parseBudget(''), 'x.atlassian.net', { budgetEur: 10 }, DEC).limitEur, 10);
});

test('a limit set in App Status (AI_BUDGET eurPerMonth / sites) always wins over the default – higher, lower, 0 = off', () => {
  for (const now of [NOV, DEC]) {
    assert.equal(effectiveBudget(parseBudget('{"eurPerMonth":100}'), 'x.atlassian.net', {}, now).limitEur, 100);
    assert.equal(effectiveBudget(parseBudget('{"eurPerMonth":5}'), 'x.atlassian.net', {}, now).limitEur, 5);
    assert.equal(effectiveBudget(parseBudget('{"eurPerMonth":50}'), 'x.atlassian.net', {}, now).limitEur, 50);
    assert.equal(effectiveBudget(parseBudget('{"sites":{"x.atlassian.net":100}}'), 'x.atlassian.net', {}, now).limitEur, 100, 'site override');
    assert.equal(budgetState({ eur: 0 }, effectiveBudget(parseBudget('{"eurPerMonth":0}'), 'x', {}, now), now).stopped, true);
  }
  assert.equal(effectiveBudget(parseBudget('{"sites":{"x.atlassian.net":100}}'), 'y.atlassian.net', {}, DEC).limitEur, 20, 'other sites keep the default');
});

test('the server passes the request time to the budget (November vs December default)', async () => {
  const { budgetStatus } = await import('../src/lib/aiBudget.js');
  const deps = { get: async () => null, set: async () => {}, audit: async () => {}, serverInfo: async () => ({ baseUrl: 'https://acme.atlassian.net' }) };
  const cfg = { ai: { enabled: true, access: 'all', features: { ask: true } } };
  assert.equal((await budgetStatus(cfg, { env: {}, now: NOV, deps })).limitEur, 50);
  assert.equal((await budgetStatus(cfg, { env: {}, now: DEC, deps })).limitEur, 20);
});
