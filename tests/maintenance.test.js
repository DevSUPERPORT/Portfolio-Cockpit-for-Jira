// SUPERPORT kill switch (APP_MAINTENANCE), driven through the real resolver and Rovo entry points.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { maintenanceMode, READ_RESOLVERS, kindOf } from '../src/lib/maintenance.js';

const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const RESOLVERS = [...src.matchAll(/def\('([^']+)'/g)].map((m) => m[1]);
const WRITES = ['plan.apply', 'plan.even', 'support.dispatch', 'support.undoDispatch', 'support.reserve', 'digest.save', 'prefs.save', 'portfolio.reorder', 'portfolio.add', 'portfolio.remove', 'health.set', 'health.clear', 'issue.fill', 'issue.parent', 'capacity.save',
  'report.publish', 'config.save', 'config.restore', 'support.link', 'support.unlink', 'settings.save', 'fields.copyValues', 'fields.uncopyValues', 'milestones.save', 'deps.link', 'deps.unlink', 'mine.book', 'playbooks.save', 'playbooks.delete', 'usage.track', 'lotse.learn.review',
  'report.publishComposed', 'report.unpublishComposed', 'notices.remind'];
const withMode = async (mode, fn) => {
  const before = process.env.APP_MAINTENANCE;
  if (mode == null) delete process.env.APP_MAINTENANCE; else process.env.APP_MAINTENANCE = mode;
  try { return await fn(); } finally { if (before == null) delete process.env.APP_MAINTENANCE; else process.env.APP_MAINTENANCE = before; }
};
const ctxOf = { accountId: '5b10a2844c20165700ede21g', moduleKey: 'pc-cockpit' };
// A minimal Forge runtime without credentials or proxy: any real data access fails locally, nothing leaves the machine.
globalThis.__forge_runtime__ = { appContext: { appId: 'ari:cloud:ecosystem::app/test', environmentType: 'DEVELOPMENT', environmentId: 'test', invocationId: 'test', installationId: 'test', moduleKey: 'pc-cockpit', permissions: { scopes: [] } }, lambdaContext: { getRemainingTimeInMillis: () => 25000 }, proxy: { token: '', url: 'http://127.0.0.1:9' }, metrics: { counter: () => ({ incr() {} }) }, tracing: {} };
let backend;
const load = async () => (backend ||= await import('../src/index.js'));
// The signed-in account comes from the trusted runtime payload, as in Forge (never from the browser's context).
const callResolver = async (name, payload = {}, principal = { accountId: ctxOf.accountId }) => (await load()).handler({ call: { functionKey: name, payload }, context: { moduleKey: ctxOf.moduleKey } }, { principal });

test('mode parsing fails closed', () => {
  assert.equal(maintenanceMode({}), 'off');
  assert.equal(maintenanceMode({ APP_MAINTENANCE: ' OFF ' }), 'off');
  assert.equal(maintenanceMode({ APP_MAINTENANCE: 'read-only' }), 'readonly');
  assert.equal(maintenanceMode({ APP_MAINTENANCE: 'on' }), 'on');
  assert.equal(maintenanceMode({ APP_MAINTENANCE: 'typo' }), 'on', 'unknown values count as "on"');
});

test('every resolver is classified; every write is outside the read allow-list', () => {
  assert.ok(RESOLVERS.length >= 40, `${RESOLVERS.length} resolvers found`);
  for (const r of READ_RESOLVERS) assert.ok(RESOLVERS.includes(r), `read allow-list names a real resolver: ${r}`);
  for (const w of WRITES) { assert.ok(RESOLVERS.includes(w), w); assert.equal(kindOf(w), 'write', w); }
  for (const r of RESOLVERS) assert.ok(READ_RESOLVERS.has(r) || WRITES.includes(r), `unclassified resolver ${r} – add it to WRITES here or READ_RESOLVERS`);
});

test('mode "on": every resolver is refused before anything is read or written', async () => {
  await withMode('on', async () => {
    for (const name of RESOLVERS) {
      const r = await callResolver(name, { APP_MAINTENANCE: 'off', ref: 'issue:1' }); // a payload cannot switch it off
      assert.equal(r.ok, false, name);
      assert.equal(r.error.code, 'UNAVAILABLE', `${name}: ${r.error.code}`);
    }
    const anon = await (await load()).handler({ call: { functionKey: 'availability', payload: {} }, context: { accountId: ctxOf.accountId } }, {});
    assert.equal(anon.error?.code, 'ANONYMOUS', 'an account id from the browser does not count');
    const a = await callResolver('availability');
    assert.deepEqual(a.data, { mode: 'on', statusUrl: 'https://superapps.statuspage.io' });
  });
});

test('mode "readonly": writes are refused, reads pass the switch', async () => {
  await withMode('readonly', async () => {
    for (const name of RESOLVERS) {
      const r = await callResolver(name, {});
      // reads go on (here they fail later, without a Forge runtime) – but never with UNAVAILABLE
      if (READ_RESOLVERS.has(name)) assert.notEqual(r.error?.code, 'UNAVAILABLE', `${name} should be readable`);
      else assert.equal(r.error?.code, 'UNAVAILABLE', `${name} must be refused`);
    }
    assert.equal((await callResolver('availability')).data.mode, 'readonly');
  });
});

test('mode "off": nothing is refused by the switch', async () => {
  await withMode(null, async () => {
    for (const name of RESOLVERS) assert.notEqual((await callResolver(name, {})).error?.code, 'UNAVAILABLE', name);
  });
});

test('scheduled job and event trigger follow the switch', async () => {
  const b = await load();
  await withMode('on', async () => {
    assert.deepEqual(await b.reportJob(), { skipped: 'on' });
    assert.equal(await b.lockEnforcer({ eventType: 'avi:jira:created:worklog', worklog: { issueId: '1', id: '2' } }), undefined);
  });
  await withMode('readonly', async () => {
    assert.deepEqual(await b.reportJob(), { skipped: 'readonly' }, 'the daily job writes, so it pauses too');
  });
});

test('the switch cannot be changed from the app: no resolver or payload sets APP_MAINTENANCE', () => {
  const all = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.ok(!/process\.env\.APP_MAINTENANCE\s*=/.test(all));
  assert.ok(!/APP_MAINTENANCE/.test(all.replace(/\/\/.*$/gm, '')), 'only lib/maintenance.js reads the variable');
});
