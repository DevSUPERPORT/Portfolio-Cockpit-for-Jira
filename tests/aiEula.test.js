// EULA §8.4 (2026-11-16): AI features are off by default and only a site's Jira administrators can switch them on, in
// the app. Forge LLM is billed to SUPERPORT, so on top of the EUR budget every site has a hard monthly cap of Forge LLM
// calls and tokens (shared/llmLimits.js), counted per calendar month (UTC) and checked before every call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { MONTHLY_LLM_CALLS, MONTHLY_LLM_TOKENS } from '../shared/llmLimits.js';
import { parseBudget, effectiveBudget, budgetState, addSpend, usageOf, meterTokens } from '../shared/aiBudget.js';
import { DEFAULT_CONFIG, migrateConfig, applySettings, aiAllowed, AI_FEATURES } from '../src/lib/config.js';
import { rolesOf } from '../src/lib/perms.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const eff = () => effectiveBudget(parseBudget('{"eurPerMonth":1000000}'), 'x.atlassian.net', {}); // EUR budget out of the way

test('the limits live in one module: 1 000 calls and 2 000 000 tokens per site and month, billed to SUPERPORT', () => {
  assert.equal(MONTHLY_LLM_CALLS, 1000);
  assert.equal(MONTHLY_LLM_TOKENS, 2_000_000);
  const src = read('shared/llmLimits.js');
  assert.match(src, /billed to SUPERPORT/);
  assert.match(src, /change the limits HERE/);
  // nobody else defines them: the budget re-exports the module's values
  for (const f of ['shared/aiBudget.js', 'src/lib/aiBudget.js', 'src/lib/ai.js']) assert.doesNotMatch(read(f), /const MONTHLY_LLM_|\b2_?000_?000\b/, f);
  assert.match(read('shared/aiBudget.js'), /import \{ MONTHLY_LLM_CALLS, MONTHLY_LLM_TOKENS \} from '\.\/llmLimits\.js';/);
});

test('default off – for new installs and for existing installs without the setting', () => {
  assert.equal(DEFAULT_CONFIG.ai.enabled, false);
  const legacy = { ...structuredClone(DEFAULT_CONFIG), setupComplete: true };
  delete legacy.ai;
  const cfg = migrateConfig(legacy);
  assert.equal(cfg.ai.enabled, false);
  for (const f of AI_FEATURES) assert.equal(aiAllowed(cfg, f), false, f);
  // a stored section without "enabled" (or with anything but a real true) is off as well
  assert.equal(migrateConfig({ ...legacy, ai: { features: {} } }).ai.enabled, false);
  assert.equal(migrateConfig({ ...legacy, ai: { enabled: 'yes' } }).ai.enabled, false);
});

test('only Jira administrators (ADMINISTER) can switch AI on – checked on the server', () => {
  // the admin flag comes from Jira's mypermissions ADMINISTER, asked as the user, never from the payload
  assert.match(read('src/lib/perms.js'), /permissions: 'ADMINISTER'[\s\S]*admin: !!perm\?\.permissions\?\.ADMINISTER\?\.havePermission/);
  assert.equal(rolesOf({ admin: false, groupIds: [], cfg: DEFAULT_CONFIG }).admin, false);
  const index = read('src/index.js');
  // the only writer of the configuration is commitConfig; config.save and config.restore require the admin role
  assert.equal((index.match(/await saveConfig\(/g) || []).length, 1);
  for (const name of ['config.save', 'config.restore']) {
    const body = index.slice(index.indexOf(`def('${name}'`));
    assert.equal(body.split('\n')[1].trim(), "requireRole(roles, 'admin');", `${name} is for Jira admins only`);
  }
  // the delegated "Portfolio settings" group (no Jira admin) can not touch the AI section
  const cfg = { ...structuredClone(DEFAULT_CONFIG), setupComplete: true, levels: [{ key: 'st', name: 'Story', role: 'estimate', issueTypeIds: ['1'] }] };
  const next = applySettings(cfg, { ai: { enabled: true }, rules: { dueDateWarning: false } });
  assert.equal(next.ai.enabled, false, 'settings.save keeps the stored switch');
  assert.match(index, /def\('settings\.save'[\s\S]{0,400}applySettings\(cfg, \{ tshirtSizes: payload\.tshirtSizes, rules: payload\.rules, capacityDefaults: payload\.capacityDefaults, supportSla: payload\.supportSla, slaTargetPct: payload\.slaTargetPct \}\)/);
  // switching it on or off is audited with who and when (set by the server)
  assert.match(index, /aiNow \? 'ai\.enabled' : 'ai\.disabled'/);
});

test('every Forge LLM call is gated: one call site, switch and monthly cap before it', () => {
  const ai = read('src/lib/ai.js');
  assert.equal((ai.match(/\bchat\(/g) || []).length, 1);
  assert.equal((ai.match(/from '@forge\/llm'/g) || []).length, 1);
  const body = ai.slice(ai.indexOf('export async function llm('), ai.indexOf('export const dropCached'));
  const [gate, cap, model, call] = ['aiAllowed(', 'await checkBudget(', 'await pickModel()', 'chat({'].map((s) => body.indexOf(s));
  assert.ok(gate > 0 && gate < cap && cap < model && model < call, 'switch → monthly cap → model list → call');
  // no other server file touches @forge/llm
  const users = ['src', 'shared'].flatMap((dir) => readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true })
    .filter((f) => /\.js$/.test(f)).map((f) => `${dir}/${String(f).replace(/\\/g, '/')}`)).filter((f) => /@forge\/llm/.test(read(f)));
  assert.deepEqual(users, ['src/lib/ai.js']);
});

test('cap: the call that would be call no. 1 001 is refused; so is anything past 2 000 000 tokens', () => {
  const e = eff();
  assert.equal(budgetState({ calls: MONTHLY_LLM_CALLS - 1, tokens: 0 }, e).stopped, false);
  const calls = budgetState({ calls: MONTHLY_LLM_CALLS, tokens: 0 }, e);
  assert.deepEqual([calls.stopped, calls.reason, calls.level, calls.callLimit], [true, 'calls', 'stopped', MONTHLY_LLM_CALLS]);
  assert.equal(budgetState({ calls: 1, tokens: MONTHLY_LLM_TOKENS - 1 }, e).stopped, false);
  const tok = budgetState({ calls: 1, tokens: MONTHLY_LLM_TOKENS }, e);
  assert.deepEqual([tok.stopped, tok.reason, tok.tokens, tok.tokenLimit], [true, 'tokens', MONTHLY_LLM_TOKENS, MONTHLY_LLM_TOKENS]);
  // warnings follow the highest share of EUR budget, calls and tokens
  assert.equal(budgetState({ calls: 850, tokens: 0 }, e).level, 'warn80');
  assert.equal(budgetState({ calls: 1, tokens: 1_100_000 }, e).level, 'warn50');
  // SUPERPORT's emergency stop and a zero budget keep their reasons
  assert.equal(budgetState({ calls: MONTHLY_LLM_CALLS }, effectiveBudget(parseBudget('{"stop":true}'), 'x', {})).reason, 'superportStop');
});

test('token counting: Atlassian\'s response usage only (total, else input + output); nothing reported counts 0 tokens but 1 call', () => {
  assert.equal(usageOf({ usage: { input_tokens: 800, output_tokens: 200, total_tokens: 1000 } }).reported, 1000);
  assert.equal(usageOf({ usage: { input_tokens: 800, output_tokens: 200 } }).reported, 1000);
  assert.equal(usageOf({ usage: { output_tokens: 50 } }, 300, 30).reported, 50);
  assert.equal(usageOf({}, 3000, 600).reported, 0, 'no usage → no tokens counted');
  let m = addSpend(null, { model: 'claude-sonnet-4-5', usage: usageOf({ usage: { input_tokens: 800, output_tokens: 200 } }), feature: 'ask' });
  m = addSpend(m, { model: 'claude-sonnet-4-5', usage: usageOf({}, 3000, 600), feature: 'ask' });
  assert.deepEqual([m.calls, m.tokens], [2, 1000]);
  // the timeout path (estimate, nothing reported) adds a call but no tokens
  m = addSpend(m, { model: 'claude-sonnet-4-5', usage: { inTok: 1000, outTok: 700, estimated: true }, feature: 'ask' });
  assert.deepEqual([m.calls, m.tokens], [3, 1000]);
  // a meter from before the cap counts its recorded tokens (never under-count)
  assert.equal(meterTokens({ inTok: 300, outTok: 200 }), 500);
  assert.equal(addSpend({ calls: 5, inTok: 300, outTok: 200 }, { model: 'x', usage: { reported: 10 }, feature: 'ask' }).tokens, 510);
});

test('server: counted per calendar month (UTC) in app storage, refused before the call, fresh on the 1st', async () => {
  const { recordSpend, checkBudget, budgetStatus } = await import('../src/lib/aiBudget.js');
  const store = new Map(), logs = [];
  const deps = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); }, audit: async (_c, a, d) => { logs.push([a, d]); }, serverInfo: async () => ({ baseUrl: 'https://x.atlassian.net' }) };
  const env = { AI_BUDGET: '{"eurPerMonth":1000000}' };
  const nov = new Date('2026-11-30T23:59:00Z');
  store.set('ai:spend:2026-11', { calls: MONTHLY_LLM_CALLS - 1, tokens: 5000, eur: 1 });
  await checkBudget({ ai: {} }, { env, now: nov, deps }); // call no. 1 000 may start
  await recordSpend({ ai: {} }, { model: 'claude-sonnet-4-5', usage: usageOf({ usage: { input_tokens: 10, output_tokens: 5 } }), feature: 'ask' }, { env, now: nov, deps });
  assert.deepEqual([store.get('ai:spend:2026-11').calls, store.get('ai:spend:2026-11').tokens], [MONTHLY_LLM_CALLS, 5015]);
  await assert.rejects(() => checkBudget({ ai: {} }, { env, now: nov, deps }), (e) => e.code === 'AI_BUDGET' && e.budget.reason === 'calls' && e.budget.resetsOn === '2026-12-01');
  const stop = logs.find(([a]) => a === 'ai.budget.stopped');
  assert.ok(stop, 'the stop is logged once');
  assert.deepEqual([stop[1].reason, stop[1].calls, stop[1].callLimit], ['calls', MONTHLY_LLM_CALLS, MONTHLY_LLM_CALLS]);
  // what admins see in KI-Einstellungen
  const s = await budgetStatus({ ai: {} }, { env, now: nov, deps });
  assert.deepEqual([s.calls, s.callLimit, s.tokens, s.tokenLimit, s.month, s.resetsOn], [MONTHLY_LLM_CALLS, MONTHLY_LLM_CALLS, 5015, MONTHLY_LLM_TOKENS, '2026-11', '2026-12-01']);
  // month rollover: 1 December 00:00 UTC is a new month with a new key
  const dec = new Date('2026-12-01T00:00:00Z');
  await checkBudget({ ai: {} }, { env, now: dec, deps });
  await recordSpend({ ai: {} }, { model: 'claude-sonnet-4-5', usage: usageOf({ usage: { total_tokens: 42 } }), feature: 'ask' }, { env, now: dec, deps });
  assert.deepEqual([store.get('ai:spend:2026-12').calls, store.get('ai:spend:2026-12').tokens], [1, 42]);
  assert.equal(store.get('ai:spend:2026-11').calls, MONTHLY_LLM_CALLS, 'November stays as it was');
  // and the token cap refuses the same way
  store.set('ai:spend:2026-12', { calls: 3, tokens: MONTHLY_LLM_TOKENS });
  await assert.rejects(() => checkBudget({ ai: {} }, { env, now: dec, deps }), (e) => e.code === 'AI_BUDGET' && e.budget.reason === 'tokens');
});

test('cap reached → the app\'s own rules answer (fallback), the AI entry points hide, admins see the usage', async () => {
  globalThis.__forge_runtime__ ??= { appContext: { appId: 'ari:cloud:ecosystem::app/test', environmentType: 'DEVELOPMENT', environmentId: 'test', invocationId: 'test', installationId: 'test', moduleKey: 'pc-cockpit', permissions: { scopes: [] } }, lambdaContext: { getRemainingTimeInMillis: () => 25000 }, proxy: { token: '', url: 'http://127.0.0.1:9' }, metrics: { counter: () => ({ incr() {} }) }, tracing: {} };
  const { assist } = await import('../src/lib/aiAssist.js');
  const cfg = { ...DEFAULT_CONFIG, setupComplete: true, ai: { ...DEFAULT_CONFIG.ai, enabled: true, features: { ...DEFAULT_CONFIG.ai.features } } };
  const audit = [];
  const r = await assist('intent', { wish: 'Wer ist überlastet?', cards: [] }, { accountId: 'acc-1', cfg }, {
    llm: async () => { throw Object.assign(new Error('AI_BUDGET:calls'), { code: 'AI_BUDGET' }); },
    takeQuota: async () => {}, audit: async (_c, a, d) => { audit.push(d); },
  });
  assert.equal(r.source, 'fallback');
  assert.equal(r.reason, 'AI_BUDGET');
  const { aiOn } = await import('../static/cockpit/src/lib/aiFlags.js');
  assert.equal(aiOn({ ai: { enabled: true, features: {}, access: 'all', budget: { stopped: true, reason: 'calls' } } }, 'ask'), false);
  const ui = read('static/cockpit/src/components/AiBudget.jsx');
  assert.match(ui, /Das monatliche KI-Kontingent ist aufgebraucht/);
  assert.match(ui, /The monthly AI quota is used up/);
  assert.match(ui, /data-ai-quota-calls/);
  assert.match(ui, /data-ai-quota-tokens/);
});
