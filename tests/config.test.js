import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateConfig, validateConfig, CONFIG_VERSION, DEFAULT_CONFIG, applySettings, sizeKey } from '../src/lib/config.js';

test('v1 configuration migrates to the current version without losing settings', () => {
  const v1 = { version: 1, setupComplete: true, portfolio: { source: 'issue', issueTypeIds: ['10000'] }, levels: [{ key: 'story', role: 'estimate', issueTypeIds: ['10008'] }], rules: { personLevel: false } };
  const c = migrateConfig(v1);
  assert.equal(c.version, CONFIG_VERSION);
  assert.equal(c.rules.personLevel, false, 'existing rule kept');
  assert.equal(c.rules.healthRhythmDays, DEFAULT_CONFIG.rules.healthRhythmDays, 'new rule defaulted');
  assert.deepEqual(c.capacityDefaults, DEFAULT_CONFIG.capacityDefaults);
  assert.deepEqual(c.portfolio.issueTypeIds, ['10000']);
});
test('a configuration from a newer app version is refused, not silently downgraded', () => {
  assert.throws(() => migrateConfig({ version: CONFIG_VERSION + 1 }), /NEWER_VERSION/);
});
test('validation drops unknown keys and rejects dangerous level keys', () => {
  const c = validateConfig({ portfolio: { source: 'space' }, levels: [{ key: '__proto__', role: 'estimate', issueTypeIds: ['1'] }, { key: 'constructor', role: 'tiny', issueTypeIds: ['2'] }], evil: 1 });
  assert.ok(!('evil' in c));
  assert.deepEqual(c.levels.map((l) => l.key), ['l1', 'l2']);
  assert.equal(c.version, CONFIG_VERSION);
});

const base = () => ({ portfolio: { source: 'issue', issueTypeIds: ['10000'] }, levels: [{ key: 'story', role: 'estimate', issueTypeIds: ['10008'] }] });
test('Owner and milestone can be mapped to custom fields, never to app fields', () => {
  const c = validateConfig({ ...base(), fields: { team: 'customfield_10001', startDate: 'customfield_10015', owner: 'customfield_10500', milestone: 'customfield_10600', tshirt: 'app', targetQuarters: 'app', note: '' } });
  assert.equal(c.fields.owner, 'customfield_10500');
  assert.equal(c.fields.milestone, 'customfield_10600');
  const bad = validateConfig({ ...base(), fields: { owner: 'app', milestone: 'assignee; DROP' } });
  assert.equal(bad.fields.owner, '');
  assert.equal(bad.fields.milestone, '');
});

test('Portfolio settings role: only sizes, safe rules and capacity defaults can change', () => {
  const cfg = validateConfig({ ...base(), rules: { personLevel: false, lockSubtasks: true, healthRhythmDays: 7 }, permissions: { manageRanking: [{ id: 'g-1', name: 'pmo' }] } });
  const next = applySettings(cfg, {
    tshirtSizes: [{ key: 'Small', hours: 80 }, { key: 'XL (1280 h)', hours: 1280 }],
    rules: { healthRhythmDays: 14, personLevel: true, lockSubtasks: false },
    capacityDefaults: { defaultWeeklyHours: 38 },
    permissions: { manageRanking: [{ id: 'evil', name: 'me' }] }, fields: { owner: 'customfield_1' }, levels: [],
  });
  assert.deepEqual(next.tshirtSizes.map((t) => t.key), ['SMALL', 'XL (1280 H)']);
  assert.equal(next.rules.healthRhythmDays, 14);
  assert.equal(next.rules.personLevel, false, 'privacy stays admin-only');
  assert.equal(next.rules.lockSubtasks, true, 'sub-task lock stays admin-only');
  assert.equal(next.capacityDefaults.defaultWeeklyHours, 38);
  assert.deepEqual(next.permissions.manageRanking, [{ id: 'g-1', name: 'pmo' }], 'permissions untouched');
  assert.equal(next.fields.owner, '', 'fields untouched');
  assert.equal(next.levels.length, cfg.levels.length, 'hierarchy untouched');
});
test('Size keys accept Jira option values but nothing executable', () => {
  assert.equal(sizeKey('  extra   large '), 'EXTRA LARGE');
  const c = validateConfig({ ...base(), tshirtSizes: [{ key: 'Größe M', hours: 1 }, { key: '<script>', hours: 1 }, { key: 'x'.repeat(60), hours: 1 }] });
  assert.deepEqual(c.tshirtSizes.map((t) => t.key), ['GRÖSSE M']);
});
test('manageSettings is a configurable permission group', () => {
  const c = validateConfig({ ...base(), permissions: { manageSettings: [{ id: 'abc-1', name: 'pmo' }, { id: 'bad id!', name: 'x' }] } });
  assert.deepEqual(c.permissions.manageSettings, [{ id: 'abc-1', name: 'pmo' }]);
});

test('Support queues: ids and labels only, JQL composed safely; SLA calendar validated', async () => {
  const { supportJql, ticketServices } = await import('../src/lib/config.js');
  const c = validateConfig({ ...base(), support: { queues: [{ name: 'IT', projectIds: ['10048', 'abc'], issueTypeIds: ['10009'], labels: ['support', 'x" OR 1=1'] }, { name: 'empty', projectIds: [] }], sla: { mode: 'weird', start: 30, end: 2, location: 'MARS', policies: [{ priority: 'Highest', hours: -5 }] } } });
  assert.equal(c.support.queues.length, 1);
  assert.deepEqual(c.support.queues[0].labels, ['support']);
  assert.equal(supportJql(c), '((project in (10048) AND issuetype in (10009) AND labels in ("support")))');
  assert.equal(c.support.sla.mode, 'business');
  assert.ok(c.support.sla.end > c.support.sla.start);
  assert.equal(c.support.sla.location, 'DE');
  assert.equal(c.support.sla.policies[0].hours, 0.5);
  assert.deepEqual(ticketServices(c, { projectId: '10048', typeId: '10009', labels: ['support'] }), ['q:q1']);
  assert.deepEqual(ticketServices(c, { projectId: '10048', typeId: '10009', labels: [] }), []);
});
test('Settings role may maintain SLA targets but not queues', () => {
  const cfg = validateConfig({ ...base(), support: { queues: [{ name: 'IT', projectIds: ['10048'] }] } });
  const next = applySettings(cfg, { supportSla: { mode: '24x7', policies: [{ priority: 'High', hours: 12 }] }, slaTargetPct: 90 });
  assert.equal(next.support.sla.mode, '24x7');
  assert.equal(next.support.slaTargetPct, 90);
  assert.deepEqual(next.support.queues, cfg.support.queues);
});

test('booking check settings: valid values kept, invalid ones fall back, stored configs get the defaults', () => {
  const base = { portfolio: { source: 'space' }, levels: [{ key: 's', role: 'estimate', issueTypeIds: ['1'] }] };
  const ok = validateConfig({ ...base, booking: { enabled: false, minPct: 85, escalatePct: 25, graceDays: 3, escalateTo: 'mgmt', schedule: 'day' } });
  assert.deepEqual(ok.booking, { enabled: false, minPct: 85, escalatePct: 25, graceDays: 3, escalateTo: 'mgmt', schedule: 'day' });
  const bad = validateConfig({ ...base, booking: { enabled: 'yes', minPct: 140, escalatePct: -1, graceDays: 2.5, escalateTo: 'hr', schedule: 'hourly' } });
  assert.deepEqual(bad.booking, DEFAULT_CONFIG.booking, 'nothing invalid survives');
  assert.deepEqual(migrateConfig({ version: CONFIG_VERSION, setupComplete: true }).booking, DEFAULT_CONFIG.booking, 'older stored configs read with the defaults');
});

test('Blocked status choice: only ids, at most 20, kept apart from the link types', () => {
  const base = { portfolio: { source: 'space' }, levels: [{ key: 's', role: 'estimate', issueTypeIds: ['1'] }] };
  const c = validateConfig({ ...base, dependencies: { linkTypeIds: ['10000'], blockedStatusIds: ['10100', 'drop table', 10101, ...Array.from({ length: 30 }, (_, i) => String(20000 + i))] } });
  assert.ok(c.dependencies.blockedStatusIds.includes('10100') && c.dependencies.blockedStatusIds.includes('10101'));
  assert.ok(!c.dependencies.blockedStatusIds.includes('drop table'));
  assert.ok(c.dependencies.blockedStatusIds.length <= 20);
  assert.deepEqual(c.dependencies.linkTypeIds, ['10000']);
  assert.deepEqual(validateConfig(base).dependencies.blockedStatusIds, [], 'none chosen = by name');
});
