// Roles and rights (UC-08): matrix, migration from the old per-action groups, privacy scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rightsFor, migrateRoles, validRoles, visiblePeople, cleanRights, DEFAULT_ROLES } from '../shared/roles.js';
import { migrateConfig, validateConfig, publicConfig, CONFIG_VERSION } from '../src/lib/config.js';
import { rolesOf } from '../src/lib/perms.js';

const g = (id, name = id) => ({ id, name });

test('employee sees only "Meine Arbeit"; a group adds its role, several groups add up', () => {
  const roles = { ...DEFAULT_ROLES, groups: { projectAdmin: [g('pa')], management: [g('mg')] } };
  assert.deepEqual(rightsFor({ groupIds: [], roles }).rights, ['mine']);
  const pa = rightsFor({ groupIds: ['pa'], roles });
  assert.ok(pa.rights.includes('plan') && pa.rights.includes('a_cap') && !pa.rights.includes('report') && !pa.rights.includes('a_rank'));
  assert.equal(pa.logs, 'team');
  const both = rightsFor({ groupIds: ['pa', 'mg'], roles });
  assert.ok(both.rights.includes('report') && both.rights.includes('a_rank'));
  assert.equal(both.logs, 'all', 'the wider privacy level wins');
});

test('Jira admin: every tab and action, but individual values only when granted deliberately', () => {
  const r = rightsFor({ admin: true, roles: DEFAULT_ROLES });
  assert.ok(['report', 'plan', 'a_rank', 'a_disp'].every((x) => r.rights.includes(x)));
  assert.equal(r.logs, 'none');
  assert.equal(rightsFor({ admin: true, roles: { ...DEFAULT_ROLES, adminPersonValues: true } }).logs, 'all');
});

test('person-level values switched off globally: nobody sees individual values', () => {
  const roles = { ...DEFAULT_ROLES, groups: { projectAdmin: [], management: [g('mg')] }, adminPersonValues: true };
  assert.equal(rightsFor({ groupIds: ['mg'], roles, personLevel: false }).logs, 'none');
  assert.equal(rightsFor({ admin: true, roles, personLevel: false }).logs, 'none');
});

test('project owners without a group keep the project-admin tabs (not its actions)', () => {
  const r = rightsFor({ roles: DEFAULT_ROLES, owner: true });
  assert.ok(r.rights.includes('projects') && r.rights.includes('plan'));
  assert.ok(!r.rights.includes('a_cap') && !r.rights.includes('a_logs_team'));
});

test('rights are sanitised: unknown ids dropped, "mine" always on, employees never get privacy rights', () => {
  assert.deepEqual(cleanRights(['report', 'evil', 'a_logs_team', 'a_logs_all']), ['mine', 'report', 'a_logs_all']);
  const v = validRoles({ rights: { employee: ['a_logs_all', 'portfolio'] }, groups: { management: [g('ok-1'), g('bad id!')] } });
  assert.deepEqual(v.rights.employee, ['mine', 'portfolio']);
  assert.deepEqual(v.groups.management, [g('ok-1')]);
});

test('migration v2 -> v3: nobody loses what they had', () => {
  const v2 = {
    version: 2, setupComplete: true, rules: { personLevel: true },
    permissions: { viewReport: [g('mg')], manageRanking: [g('mg')], editCapacity: [g('pa'), g('mg')], editHealth: [g('pa')], manageSettings: [g('st')] },
  };
  const c = migrateConfig(v2);
  assert.equal(c.version, CONFIG_VERSION);
  assert.deepEqual(c.roles.groups.management.map((x) => x.id), ['mg']);
  assert.deepEqual(c.roles.groups.projectAdmin.map((x) => x.id), ['pa']);
  assert.equal(c.roles.adminPersonValues, true, 'admins keep seeing people when that was on');
  const pa = rolesOf({ admin: false, groupIds: ['pa'], cfg: c });
  assert.ok(pa.editCapacity && pa.editHealth && pa.editPlan);
  assert.equal(pa.logs, 'all', 'no "responsible" teams yet -> keep seeing everyone');
  const mg = rolesOf({ admin: false, groupIds: ['mg'], cfg: c });
  assert.ok(mg.viewReport && mg.manageRanking);
  assert.ok(rolesOf({ admin: false, groupIds: ['st'], cfg: c }).manageSettings, 'delegated settings untouched');
  const off = migrateRoles({ ...v2, rules: { personLevel: false } });
  assert.ok(!off.rights.management.includes('a_logs_all') && off.adminPersonValues === false);
});

test('saving keeps a legacy permission mirror and never hands group lists to the browser', () => {
  const c = validateConfig({ portfolio: { source: 'issue', issueTypeIds: ['10000'] }, levels: [{ key: 'story', role: 'estimate', issueTypeIds: ['10008'] }],
    roles: { groups: { projectAdmin: [g('pa')], management: [g('mg')] }, rights: DEFAULT_ROLES.rights } });
  assert.deepEqual(c.permissions.viewReport.map((x) => x.id), ['mg']);
  assert.deepEqual(c.permissions.editCapacity.map((x) => x.id).sort(), ['mg', 'pa']);
  const pub = publicConfig(c);
  assert.equal(pub.permissions, undefined);
  assert.equal(pub.roles.groups, undefined);
  assert.ok(pub.roles.rights.management.includes('report'));
});

test('privacy scope "team": members of the teams I am responsible for, plus myself', () => {
  const capacity = { teams: { t1: { responsible: ['me'] }, t2: { responsible: ['other'] } }, people: { a: { teamId: 't1' }, b: { teamId: 't2' }, me: { teamId: 't2' } } };
  assert.equal(visiblePeople({ logs: 'all', accountId: 'me', capacity }), null);
  assert.deepEqual([...visiblePeople({ logs: 'team', accountId: 'me', capacity })].sort(), ['a', 'me']);
  assert.deepEqual([...visiblePeople({ logs: 'none', accountId: 'me', capacity })], ['me']);
});

test('privacy scope "team" includes people with only a share in my team', () => {
  const capacity = { teams: { t1: { responsible: ['me'] } }, people: { s: { teamId: 't2', teams: [{ teamId: 't2', pct: 60 }, { teamId: 't1', pct: 40 }] }, o: { teamId: 't2' } } };
  assert.deepEqual([...visiblePeople({ logs: 'team', accountId: 'me', capacity })].sort(), ['me', 's']);
});
