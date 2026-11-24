// AI_BUDGET contract v2 (2026-11-16), kind "eur": on top of the v1 EUR budget, SUPERPORT sets Forge LLM calls and
// tokens per site and month – app-wide (callsPerMonth, tokensPerMonth) and per site (siteCaps); a cap of 0 = AI off
// there. Defaults 1000 calls / 2,000,000 tokens (shared/llmLimits.js). v1 values read exactly as before; anything
// invalid falls back to the defaults with one warning and never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBudget, effectiveBudget, effectiveCaps, budgetState, DEFAULT_CAPS, CAP_MAX } from '../shared/aiBudget.js';
import { MONTHLY_LLM_CALLS, MONTHLY_LLM_TOKENS } from '../shared/llmLimits.js';
import { validAi } from '../src/lib/config.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NOW = new Date('2026-11-16T10:00:00Z');

// Real strings, generated with node from SUPERPORT-OPS jira-app/src/aibudget.js serialiseAiBudget(…, 'eur') – exactly
// what App Status writes into the Forge variable. Do not edit by hand; regenerate from the serialiser if it changes.
const FIXTURES = Object.freeze({
  // serialiseAiBudget({ eurPerMonth: 50, eurPerUsd: 1, dailyPerPerson: 60 })
  defaults: '{"eurPerMonth":50,"eurPerUsd":1,"dailyPerPerson":60,"stop":false,"sites":{},"callsPerMonth":1000,"tokensPerMonth":2000000,"siteCaps":{}}',
  // … callsPerMonth: 500, tokensPerMonth: 1000000, siteCaps: { 'BigCorp.atlassian.net': { 5000 / 10000000 }, acme: { callsPerMonth: 0 }, tiny: { tokensPerMonth: 20000 } }
  siteCaps: '{"eurPerMonth":50,"eurPerUsd":1,"dailyPerPerson":60,"stop":false,"sites":{},"callsPerMonth":500,"tokensPerMonth":1000000,"siteCaps":{"acme.atlassian.net":{"callsPerMonth":0},"bigcorp.atlassian.net":{"callsPerMonth":5000,"tokensPerMonth":10000000},"tiny.atlassian.net":{"tokensPerMonth":20000}}}',
  // … eurPerMonth: 100, eurPerUsd: 0.92, dailyPerPerson: 40, sites: { bigcorp: 2000, acme: 0 } (a v1 budget re-saved by v2)
  v1sites: '{"eurPerMonth":100,"eurPerUsd":0.92,"dailyPerPerson":40,"stop":false,"sites":{"acme.atlassian.net":0,"bigcorp.atlassian.net":2000},"callsPerMonth":1000,"tokensPerMonth":2000000,"siteCaps":{}}',
  // … stop: true, siteCaps: { bigcorp: { callsPerMonth: 5000 } }
  stop: '{"eurPerMonth":50,"eurPerUsd":1,"dailyPerPerson":60,"stop":true,"sites":{},"callsPerMonth":1000,"tokensPerMonth":2000000,"siteCaps":{"bigcorp.atlassian.net":{"callsPerMonth":5000}}}',
});
// The same v1 budget as App Status v1 wrote it (no v2 fields).
const V1 = '{"eurPerMonth":100,"eurPerUsd":0.92,"dailyPerPerson":40,"stop":false,"sites":{"acme.atlassian.net":0,"bigcorp.atlassian.net":2000}}';

const state = (raw, host, meter = {}, cfgAi = {}) => budgetState(meter, effectiveBudget(parseBudget(raw), host, cfgAi), NOW);
const v1Fields = (b) => ({ eurPerMonth: b.eurPerMonth, eurPerUsd: b.eurPerUsd, dailyPerPerson: b.dailyPerPerson, stop: b.stop, sites: b.sites, set: b.set, invalid: b.invalid });

test('defaults equal the contract (DEFAULTS_USAGE: 1000 calls, 2,000,000 tokens) and come from shared/llmLimits.js', () => {
  assert.deepEqual([DEFAULT_CAPS.callsPerMonth, DEFAULT_CAPS.tokensPerMonth, DEFAULT_CAPS.siteCaps], [MONTHLY_LLM_CALLS, MONTHLY_LLM_TOKENS, {}]);
  assert.deepEqual([MONTHLY_LLM_CALLS, MONTHLY_LLM_TOKENS], [1000, 2000000]);
  assert.deepEqual(CAP_MAX, { callsPerMonth: 1000000, tokensPerMonth: 1000000000 }, 'contract LIMITS.callsMax / tokensMax');
  for (const raw of ['', undefined, null, '{}']) {
    const b = parseBudget(raw);
    assert.deepEqual([b.callsPerMonth, b.tokensPerMonth, b.siteCaps, b.problems], [1000, 2000000, {}, []], String(raw));
  }
});

test('v1 compatibility: a v1 value reads exactly as before; the v2 fields take their defaults', () => {
  const v1 = parseBudget(V1);
  assert.deepEqual(v1Fields(v1), { eurPerMonth: 100, eurPerUsd: 0.92, dailyPerPerson: 40, stop: false, sites: { 'acme.atlassian.net': 0, 'bigcorp.atlassian.net': 2000 }, set: true, invalid: false });
  assert.deepEqual([v1.callsPerMonth, v1.tokensPerMonth, v1.siteCaps, v1.problems], [1000, 2000000, {}, []]);
  // the v2 serialisation of the same budget behaves identically on every site
  assert.deepEqual(v1Fields(parseBudget(FIXTURES.v1sites)), v1Fields(v1));
  for (const host of ['bigcorp.atlassian.net', 'acme.atlassian.net', 'other.atlassian.net', null]) {
    for (const meter of [{}, { eur: 1, calls: 999, tokens: 5 }, { calls: 1000 }, { tokens: 2000000 }]) {
      assert.deepEqual(state(FIXTURES.v1sites, host, meter, { budgetEur: 30 }), state(V1, host, meter, { budgetEur: 30 }), `${host} ${JSON.stringify(meter)}`);
    }
  }
  // what v1 did: site override, EUR 0 off, defaults for the caps
  assert.equal(state(V1, 'bigcorp.atlassian.net').limitEur, 2000);
  assert.equal(state(V1, 'acme.atlassian.net').reason, 'zero');
  assert.deepEqual([state(V1, 'x.atlassian.net').callLimit, state(V1, 'x.atlassian.net').tokenLimit, state(V1, 'x.atlassian.net').siteCaps], [1000, 2000000, false]);
});

test('fixture "defaults": every site gets 1000 calls / 2,000,000 tokens, nothing stopped', () => {
  const b = parseBudget(FIXTURES.defaults);
  assert.deepEqual([b.set, b.invalid, b.problems, b.stop], [true, false, [], false]);
  assert.deepEqual(effectiveCaps(b, 'bigcorp.atlassian.net'), { callsPerMonth: 1000, tokensPerMonth: 2000000, stop: false, off: false, siteCap: false });
  // App Status wrote 50 € explicitly: its value wins over the app's own default (20 €); everything else as unset
  assert.deepEqual(state(FIXTURES.defaults, 'x.atlassian.net'), { ...state('', 'x.atlassian.net'), set: true, limitEur: 50, capEur: 50 }, 'App Status value wins, the rest as unset');
  assert.equal(state(FIXTURES.defaults, 'x.atlassian.net', { calls: 999 }).stopped, false);
  assert.equal(state(FIXTURES.defaults, 'x.atlassian.net', { calls: 1000 }).reason, 'calls');
});

test('fixture "siteCaps": the site\'s own cap wins, a missing field falls back to the app-wide value, 0 = AI off there', () => {
  const b = parseBudget(FIXTURES.siteCaps);
  assert.deepEqual(b.problems, []);
  assert.deepEqual([b.callsPerMonth, b.tokensPerMonth], [500, 1000000]);
  assert.deepEqual(effectiveCaps(b, 'BigCorp.atlassian.net'), { callsPerMonth: 5000, tokensPerMonth: 10000000, stop: false, off: false, siteCap: true }, 'host case ignored');
  assert.deepEqual(effectiveCaps(b, 'https://bigcorp.atlassian.net/jira'), effectiveCaps(b, 'bigcorp.atlassian.net'));
  assert.deepEqual(effectiveCaps(b, 'tiny.atlassian.net'), { callsPerMonth: 500, tokensPerMonth: 20000, stop: false, off: false, siteCap: true });
  assert.deepEqual(effectiveCaps(b, 'acme.atlassian.net'), { callsPerMonth: 0, tokensPerMonth: 1000000, stop: false, off: true, siteCap: true });
  assert.deepEqual(effectiveCaps(b, 'other.atlassian.net'), { callsPerMonth: 500, tokensPerMonth: 1000000, stop: false, off: false, siteCap: false });
  assert.deepEqual(effectiveCaps(b, null), { callsPerMonth: 500, tokensPerMonth: 1000000, stop: false, off: false, siteCap: false }, 'host unknown → app-wide');
  // the meter is checked against the site's caps
  assert.equal(state(FIXTURES.siteCaps, 'bigcorp.atlassian.net', { calls: 4999 }).stopped, false, 'bigcorp may go past the app-wide 500');
  const big = state(FIXTURES.siteCaps, 'bigcorp.atlassian.net', { calls: 5000 });
  assert.deepEqual([big.stopped, big.reason, big.callLimit, big.tokenLimit, big.siteCaps], [true, 'calls', 5000, 10000000, true]);
  assert.equal(state(FIXTURES.siteCaps, 'other.atlassian.net', { calls: 500 }).reason, 'calls', 'others stop at the app-wide 500');
  assert.equal(state(FIXTURES.siteCaps, 'tiny.atlassian.net', { calls: 1, tokens: 20000 }).reason, 'tokens');
  assert.equal(state(FIXTURES.siteCaps, 'tiny.atlassian.net', { calls: 1, tokens: 10000 }).level, 'warn50', 'warnings follow the site\'s caps');
  // cap 0: off from the first call, with its own reason (not "used up")
  const acme = state(FIXTURES.siteCaps, 'acme.atlassian.net');
  assert.deepEqual([acme.stopped, acme.reason, acme.level, acme.callLimit], [true, 'capZero', 'stopped', 0]);
});

test('fixture "v1sites": the EUR site overrides keep working next to the default caps', () => {
  assert.deepEqual(parseBudget(FIXTURES.v1sites).problems, []);
  const big = state(FIXTURES.v1sites, 'bigcorp.atlassian.net');
  assert.deepEqual([big.limitEur, big.siteOverride, big.callLimit, big.tokenLimit, big.dailyPerPerson, big.eurPerUsd], [2000, true, 1000, 2000000, 40, 0.92]);
  assert.equal(state(FIXTURES.v1sites, 'acme.atlassian.net').reason, 'zero', 'EUR 0 for a site still switches AI off there');
  assert.equal(state(FIXTURES.v1sites, 'x.atlassian.net').limitEur, 100);
});

test('fixture "stop": SUPERPORT\'s stop wins everywhere, also on a site with its own caps', () => {
  const b = parseBudget(FIXTURES.stop);
  assert.equal(b.stop, true);
  for (const host of ['bigcorp.atlassian.net', 'x.atlassian.net', null]) {
    const s = state(FIXTURES.stop, host);
    assert.deepEqual([s.stopped, s.reason], [true, 'superportStop'], String(host));
  }
  assert.equal(state(FIXTURES.stop, 'bigcorp.atlassian.net').callLimit, 5000, 'the caps still show what will apply after the stop');
});

test('cap 0 app-wide = AI off on every site without its own cap; a site cap may open it for that site', () => {
  for (const raw of ['{"callsPerMonth":0}', '{"tokensPerMonth":0}']) {
    assert.equal(state(raw, 'x.atlassian.net').reason, 'capZero', raw);
    assert.equal(effectiveCaps(parseBudget(raw), 'x.atlassian.net').off, true);
  }
  const raw = '{"callsPerMonth":0,"siteCaps":{"pilot.atlassian.net":{"callsPerMonth":50}}}';
  assert.equal(state(raw, 'pilot.atlassian.net').stopped, false);
  assert.equal(state(raw, 'pilot.atlassian.net').callLimit, 50);
  assert.equal(state(raw, 'x.atlassian.net').reason, 'capZero');
  // EUR budget 0 and SUPERPORT's stop keep their own reasons
  assert.equal(state('{"eurPerMonth":0}', 'x.atlassian.net').reason, 'zero');
  assert.equal(state('{"stop":true,"callsPerMonth":0}', 'x.atlassian.net').reason, 'superportStop');
});

test('invalid v2 fields: that field falls back (default / app-wide), listed as a problem – never "unlimited", never a throw', () => {
  const cases = [
    ['{"callsPerMonth":-1}', 'callsPerMonth'], ['{"callsPerMonth":1.5}', 'callsPerMonth'], ['{"callsPerMonth":"500"}', 'callsPerMonth'],
    ['{"callsPerMonth":1000001}', 'callsPerMonth'], ['{"callsPerMonth":null}', 'callsPerMonth'], ['{"tokensPerMonth":1000000001}', 'tokensPerMonth'],
    ['{"tokensPerMonth":true}', 'tokensPerMonth'],
  ];
  for (const [raw, field] of cases) {
    const b = parseBudget(raw);
    assert.deepEqual([b.callsPerMonth, b.tokensPerMonth, b.invalid], [1000, 2000000, false], raw);
    assert.deepEqual(b.problems, [field], raw);
  }
  // site caps: a bad entry is left out (that site gets the app-wide values), a bad field inside an entry too
  const b = parseBudget('{"callsPerMonth":300,"siteCaps":{"bad host":{"callsPerMonth":9},"a.atlassian.net":{"callsPerMonth":-4,"tokensPerMonth":77},"b.atlassian.net":5,"c.atlassian.net":{"callsPerMonth":"x"},"d.atlassian.net":{}}}');
  assert.deepEqual(b.siteCaps, { 'a.atlassian.net': { tokensPerMonth: 77 } });
  assert.deepEqual(effectiveCaps(b, 'a.atlassian.net'), { callsPerMonth: 300, tokensPerMonth: 77, stop: false, off: false, siteCap: true });
  for (const h of ['b.atlassian.net', 'c.atlassian.net', 'd.atlassian.net']) assert.equal(effectiveCaps(b, h).callsPerMonth, 300, h);
  assert.equal(b.problems.length, 6);
  assert.deepEqual(parseBudget('{"siteCaps":[1,2]}').siteCaps, {});
  assert.deepEqual(parseBudget('{"siteCaps":[1,2]}').problems, ['siteCaps']);
  assert.deepEqual(parseBudget('{"callPerMonth":5}').problems, ['unknown field(s) callPerMonth'], 'a typo is reported');
  // a broken value: everything default, the v1 flag as before
  for (const raw of ['{callsPerMonth: 0', '[]', '42', 'null', '"x"', 'true']) {
    const x = parseBudget(raw);
    assert.deepEqual([x.eurPerMonth, x.callsPerMonth, x.tokensPerMonth, x.stop, x.invalid, x.problems.length > 0], [20, 1000, 2000000, false, true, true], raw);
  }
  // the other fields stay valid: an invalid cap never drops SUPERPORT's stop or a valid site cap
  const mixed = parseBudget('{"stop":true,"callsPerMonth":"lots","siteCaps":{"a.atlassian.net":{"callsPerMonth":0}}}');
  assert.deepEqual([mixed.stop, mixed.siteCaps], [true, { 'a.atlassian.net': { callsPerMonth: 0 } }]);
  // effectiveCaps on raw / odd input never throws and never returns "unlimited"
  for (const odd of [null, undefined, 42, 'x', [], { siteCaps: null }, { siteCaps: { 'a.atlassian.net': null } }, { callsPerMonth: Infinity, tokensPerMonth: -1 }]) {
    assert.deepEqual(effectiveCaps(odd, 'a.atlassian.net'), { callsPerMonth: 1000, tokensPerMonth: 2000000, stop: false, off: false, siteCap: false }, JSON.stringify(odd));
  }
  assert.equal(state('{"callsPerMonth":-1}', 'x').callLimit, 1000);
});

test('the server logs an unusable value once (per value), not on every call; valid values log nothing', async () => {
  const { envBudget } = await import('../src/lib/aiBudget.js');
  const logs = [];
  const warn = (m) => logs.push(m);
  envBudget({ AI_BUDGET: FIXTURES.siteCaps }, warn);
  envBudget({ AI_BUDGET: V1 }, warn);
  envBudget({}, warn);
  assert.deepEqual(logs, []);
  const bad = '{"callsPerMonth":-7,"siteCaps":{"x.atlassian.net":{"tokensPerMonth":"many"}}}';
  for (let i = 0; i < 3; i++) envBudget({ AI_BUDGET: bad }, warn);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /callsPerMonth/);
  assert.match(logs[0], /defaults apply/);
  envBudget({ AI_BUDGET: '{nope' }, warn);
  assert.equal(logs.length, 2, 'a different value is logged again');
  assert.doesNotThrow(() => envBudget({ AI_BUDGET: '{nope' }, () => { throw new Error('logger down'); }));
});

test('server: the site host picks the site caps; an unknown host falls back to the app-wide caps', async () => {
  const { checkBudget, budgetStatus, recordSpend } = await import('../src/lib/aiBudget.js');
  const mk = (serverInfo) => { const store = new Map(), logs = []; return { store, logs, deps: { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); }, audit: async (_c, a, d) => { logs.push([a, d]); }, serverInfo } }; };
  const env = { AI_BUDGET: FIXTURES.siteCaps };
  const big = mk(async () => ({ baseUrl: 'https://BigCorp.atlassian.net' }));
  big.store.set('ai:spend:2026-11', { calls: 4999, tokens: 0, eur: 0 });
  const s = await checkBudget({ ai: {} }, { env, now: NOW, deps: big.deps });
  assert.deepEqual([s.host, s.callLimit, s.tokenLimit, s.siteCaps], ['bigcorp.atlassian.net', 5000, 10000000, true]);
  await recordSpend({ ai: {} }, { model: 'claude-sonnet-4-5', usage: { inTok: 1, outTok: 1, reported: 2 }, feature: 'ask' }, { env, now: NOW, deps: big.deps });
  await assert.rejects(() => checkBudget({ ai: {} }, { env, now: NOW, deps: big.deps }), (e) => e.code === 'AI_BUDGET' && e.budget.reason === 'calls');
  const stop = big.logs.find(([a]) => a === 'ai.budget.stopped');
  assert.deepEqual([stop[1].reason, stop[1].callLimit], ['calls', 5000], 'the audit names the site\'s cap');
  // acme: cap 0 → refused before the first call
  const acme = mk(async () => ({ baseUrl: 'https://acme.atlassian.net/' }));
  await assert.rejects(() => checkBudget({ ai: {} }, { env, now: NOW, deps: acme.deps }), (e) => e.code === 'AI_BUDGET' && e.budget.reason === 'capZero');
  // the host lookup fails and nothing is cached → app-wide caps (500 calls), not "unlimited", not the default 1000
  const lost = mk(async () => { throw new Error('serverInfo down'); });
  const l = await budgetStatus({ ai: {} }, { env, now: NOW, deps: lost.deps });
  assert.deepEqual([l.host, l.callLimit, l.tokenLimit, l.siteCaps, l.stopped], [null, 500, 1000000, false, false]);
  lost.store.set('ai:spend:2026-11', { calls: 500 });
  await assert.rejects(() => checkBudget({ ai: {} }, { env, now: NOW, deps: lost.deps }), (e) => e.budget.reason === 'calls');
  // v1 `sites` and v2 `siteCaps` use the same host (one lookup, cached for a day in app storage)
  assert.equal(big.store.get('meta:site').host, 'bigcorp.atlassian.net');
});

test('gate order: SUPERPORT\'s stop → the site\'s switch → caps; the stop needs no storage and no Jira call', async () => {
  const ai = read('src/lib/ai.js');
  const body = ai.slice(ai.indexOf('export async function llm('), ai.indexOf('export const dropCached'));
  const order = ['vendorStop()', 'aiAllowed(', 'await checkBudget(', 'await pickModel()', 'chat({'].map((s) => body.indexOf(s));
  assert.ok(order.every((i) => i > 0), 'all steps present');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in this order');
  const { vendorStop } = await import('../src/lib/aiBudget.js');
  assert.throws(() => vendorStop({ env: { AI_BUDGET: FIXTURES.stop }, now: NOW }), (e) => e.code === 'AI_BUDGET' && e.message === 'AI_BUDGET:superportStop' && e.budget.reason === 'superportStop');
  for (const raw of [FIXTURES.defaults, FIXTURES.siteCaps, V1, '', '{broken']) assert.equal(vendorStop({ env: { AI_BUDGET: raw } }), undefined, raw);
});

test('SUPERPORT\'s stop and caps never change the site\'s stored settings (switch, own limits)', async () => {
  const { checkBudget, budgetStatus, recordSpend } = await import('../src/lib/aiBudget.js');
  const store = new Map();
  const deps = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); }, audit: async () => {}, serverInfo: async () => ({ baseUrl: 'https://acme.atlassian.net' }) };
  const cfg = { ai: { enabled: true, access: 'all', budgetEur: 10, dailyLimit: 5, features: { ask: true } } };
  const before = structuredClone(cfg);
  for (const raw of [FIXTURES.stop, FIXTURES.siteCaps, '{"callsPerMonth":0}']) {
    await assert.rejects(() => checkBudget(cfg, { env: { AI_BUDGET: raw }, now: NOW, deps }), { code: 'AI_BUDGET' });
    await recordSpend(cfg, { model: 'claude-sonnet-4-5', usage: { inTok: 1, outTok: 1 }, feature: 'ask' }, { env: { AI_BUDGET: raw }, now: NOW, deps });
    const s = await budgetStatus(cfg, { env: { AI_BUDGET: raw }, now: NOW, deps });
    assert.deepEqual([s.limitEur, s.lowered, s.dailyPerPerson], [10, true, 5], 'the admin\'s own values still apply and show');
  }
  assert.deepEqual(cfg, before, 'the configuration object is untouched');
  assert.deepEqual([...store.keys()].sort(), ['ai:spend:2026-11', 'meta:site'], 'only the meter and the host cache are written');
  // the status the browser gets is never saved back with the configuration
  const saved = validAi({ ...cfg.ai, budget: { stopped: true, reason: 'capZero', callLimit: 0 } }, null);
  assert.deepEqual([saved.enabled, saved.budgetEur, saved.dailyLimit, 'budget' in saved], [true, 10, 5, false]);
});

test('browser: effective limits shown to admins; vendor-off texts; nothing names the internal variable or tool', async () => {
  const { aiOn, vendorOff, VENDOR_OFF } = await import('../static/cockpit/src/lib/aiFlags.js');
  assert.deepEqual([...VENDOR_OFF], ['Die KI-Funktionen sind vorübergehend vom App-Anbieter ausgeschaltet. Bitte versuchen Sie es später erneut.', 'AI features are temporarily turned off by the app vendor. Please try again later.']);
  const cfg = (budget) => ({ ai: { enabled: true, features: {}, access: 'all', budget } });
  assert.equal(aiOn(cfg({ stopped: true, reason: 'capZero' }), 'ask'), false, 'cap 0 hides every AI entry point');
  assert.equal(vendorOff({ stopped: true, reason: 'capZero' }), true);
  assert.equal(vendorOff({ stopped: true, reason: 'superportStop' }), true);
  assert.equal(vendorOff({ stopped: true, reason: 'calls' }), false, 'a used-up quota is not the vendor switching AI off');
  const ui = read('static/cockpit/src/components/AiBudget.jsx');
  assert.match(ui, /data-ai-limits/);
  assert.match(ui, /KI-Kontingent dieser Site pro Monat: \$\{fmt\.n\(b\.callLimit\)\} KI-Aufrufe und \$\{fmt\.n\(b\.tokenLimit\)\} Tokens/);
  assert.match(ui, /AI quota for this site per month: \$\{fmt\.n\(b\.callLimit\)\} AI calls and \$\{fmt\.n\(b\.tokenLimit\)\} tokens/);
  assert.match(ui, /b\.reason === 'capZero'\n\s+\? tr\(\.\.\.VENDOR_OFF\)/);
  assert.match(ui, /SUPERPORT hat die KI vorübergehend für alle Sites angehalten/, 'the existing stop text stays');
  assert.match(read('static/cockpit/src/state.jsx'), /e\?\.code === 'AI_BUDGET' && \/:\(superportStop\|capZero\)\$\/\.test\(e\.message \|\| ''\)\) return tr\(\.\.\.VENDOR_OFF\)/);
  assert.match(read('static/cockpit/src/components/AiSettings.jsx'), /on && vendorOff\(budget\) \? tr\(\.\.\.VENDOR_OFF\)/);
  // customer-facing strings (every string literal outside comments) never name App Status or AI_BUDGET
  const files = ['components/AiBudget.jsx', 'components/AiSettings.jsx', 'components/AiSpend.jsx', 'state.jsx', 'App.jsx', 'lib/aiFlags.js'];
  for (const f of files) {
    const src = read(`static/cockpit/src/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
    const literals = [...src.matchAll(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g)].map((m) => m[0]);
    for (const s of literals) {
      if (s === "'AI_BUDGET'") continue; // the error code the client compares against
      assert.doesNotMatch(s, /App[ -]?Status|AI_BUDGET/i, `${f}: ${s.slice(0, 120)}`);
    }
  }
});
