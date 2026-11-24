// AI switch (management request 2026-11-10): Forge LLM and every AI function are OFF unless a Jira admin switches
// them on; while off, nothing is read, counted or sent. When on, names and free texts stay out unless allowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG, migrateConfig, validateConfig, aiAllowed, validAi, AI_FEATURES } from '../src/lib/config.js';

// A minimal Forge runtime without credentials or proxy: any real data access fails locally, nothing leaves the machine.
globalThis.__forge_runtime__ = { appContext: { appId: 'ari:cloud:ecosystem::app/test', environmentType: 'DEVELOPMENT', environmentId: 'test', invocationId: 'test', installationId: 'test', moduleKey: 'pc-cockpit', permissions: { scopes: [] } }, lambdaContext: { getRemainingTimeInMillis: () => 25000 }, proxy: { token: '', url: 'http://127.0.0.1:9' }, metrics: { counter: () => ({ incr() {} }) }, tracing: {} };
const ai = await import('../src/lib/ai.js');
const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url), 'utf8'));
const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const aiSrc = readFileSync(new URL('../src/lib/ai.js', import.meta.url), 'utf8');

const on = (over = {}) => ({ ...DEFAULT_CONFIG, ai: { ...DEFAULT_CONFIG.ai, enabled: true, features: { ask: true, healthDraft: true, reportSummary: true }, ...over } });

test('off by default – for new installs and for installs saved before the setting existed', () => {
  assert.equal(DEFAULT_CONFIG.ai.enabled, false);
  assert.equal(DEFAULT_CONFIG.ai.shareNames, false);
  assert.equal(DEFAULT_CONFIG.ai.shareTexts, false);
  const legacy = { ...structuredClone(DEFAULT_CONFIG), setupComplete: true };
  delete legacy.ai;
  assert.equal(migrateConfig(legacy).ai.enabled, false, 'an existing install without the key is off');
  for (const f of AI_FEATURES) assert.equal(aiAllowed(migrateConfig(legacy), f), false);
});

test('only an explicit true switches it on; each feature can be switched off on its own', () => {
  assert.equal(validAi({ enabled: 'true' }).enabled, false, 'no truthy strings');
  assert.equal(validAi({ enabled: 1 }).enabled, false);
  assert.equal(aiAllowed(on(), 'ask'), true);
  assert.equal(aiAllowed(on({ features: { ask: false, healthDraft: true, reportSummary: true } }), 'ask'), false);
  assert.equal(aiAllowed(on(), 'somethingElse'), false, 'unknown features are never allowed');
  assert.equal(aiAllowed(null, 'ask'), false);
  assert.equal(aiAllowed({}, 'ask'), false);
});

test('the request can not forge who switched it; a save without the section keeps the stored switch', () => {
  const prev = { ...DEFAULT_CONFIG, ai: { ...DEFAULT_CONFIG.ai, enabled: true, changedAt: '2026-11-10T08:00:00Z', changedBy: 'Admin A' } };
  const v = validAi({ enabled: true, changedBy: 'Mallory', changedAt: '1999-01-01' }, prev.ai);
  assert.equal(v.changedBy, 'Admin A');
  assert.equal(v.changedAt, '2026-11-10T08:00:00Z');
  assert.equal(validAi(undefined, prev.ai).enabled, true, 'missing section → unchanged');
  // a full validateConfig round trip keeps the section
  const input = { ...structuredClone(DEFAULT_CONFIG), levels: [{ key: 'st', name: 'Story', role: 'estimate', issueTypeIds: ['1'] }] };
  delete input.ai;
  assert.equal(validateConfig(input, prev).ai.enabled, true);
});

test('with AI off every entry point refuses BEFORE any data access or LLM call', async () => {
  const off = { ...DEFAULT_CONFIG };
  // the error is AI_DISABLED – not a network/storage error – so the gate ran first
  await assert.rejects(ai.ask(golden, 'Was ist los?', null, 'de', off), { code: 'AI_DISABLED' });
  await assert.rejects(ai.healthDraft(golden, golden.portfolio[0].ref, 'de', off), { code: 'AI_DISABLED' });
  await assert.rejects(ai.reportSummary({ asOf: 'x', kpis: {}, rows: [], teamUtil: [] }, 'de', off), { code: 'AI_DISABLED' });
  await assert.rejects(ai.llm('s', 'u', { cfg: off, feature: 'ask' }), { code: 'AI_DISABLED' });
  await assert.rejects(ai.llm('s', 'u'), { code: 'AI_DISABLED' }, 'no policy = no call');
  await assert.rejects(ai.llm('s', 'u', { cfg: on({ features: { ask: false, healthDraft: true, reportSummary: true } }), feature: 'ask' }), { code: 'AI_DISABLED' });
});

test('every AI resolver checks the switch as its very first step; every LLM call carries the policy', () => {
  for (const [name, feature] of [['ai.ask', 'ask'], ['ai.healthDraft', 'healthDraft'], ['ai.reportSummary', 'reportSummary']]) {
    const body = src.slice(src.indexOf(`def('${name}'`));
    const firstLine = body.split('\n')[1].trim();
    assert.equal(firstLine, `requireAi(cfg, '${feature}');`, `${name} starts with the AI gate`);
  }
  const calls = [...aiSrc.matchAll(/await llm\(([^;]+)\);/g)].map((m) => m[1]);
  assert.ok(calls.length >= 3);
  for (const c of calls) assert.match(c, /\{ cfg, feature: '(ask|healthDraft|reportSummary)' \}/, 'llm(...) without a policy');
  // @forge/llm is only touched inside llm()/pickModel(), which sit behind the gate
  assert.equal((aiSrc.match(/\bchat\(/g) || []).length, 1);
  assert.equal((aiSrc.match(/\blist\(\)/g) || []).length, 1);
  assert.ok(aiSrc.indexOf('if (!aiAllowed(policy?.cfg, policy?.feature)) throw disabled();') < aiSrc.indexOf('const model = await pickModel();'));
});

test('data minimisation: without permission no person names and no free texts leave the app', () => {
  const ds = structuredClone(golden);
  ds.portfolio[0].owner = { id: 'u-own', name: 'Erika Mustermann' };
  ds.portfolio[0].health = { status: 'atRisk', comment: 'Geheimes Übernahmeprojekt Phoenix', at: new Date().toISOString() };
  const closed = JSON.stringify(ai.factSheet(ds, ds.portfolio[0].ref, { names: false, texts: false }).facts);
  assert.ok(!closed.includes('Erika'), 'owner name');
  assert.ok(!closed.includes('Phoenix'), 'health comment');
  assert.ok(!closed.includes(ds.portfolio[0].name), 'project name');
  for (const i of ds.issues) if (i.summary) assert.ok(!closed.includes(i.summary), `issue summary ${i.key}`);
  assert.ok(closed.includes(`#${ds.portfolio[0].rank} ${ds.portfolio[0].key}`), 'projects are referred to by rank and key');
  const open = JSON.stringify(ai.factSheet(ds, ds.portfolio[0].ref, { names: true, texts: true }).facts);
  assert.ok(open.includes('Erika') && open.includes('Phoenix') && open.includes(ds.portfolio[0].name), 'with permission the texts are there');
  assert.deepEqual(ai.sharing(DEFAULT_CONFIG), { names: false, texts: false });
});
