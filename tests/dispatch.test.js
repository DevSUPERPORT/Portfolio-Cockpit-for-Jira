// UC-17 support upgrade: dispatching suggestions, reserve check, "where does support time go", manual reserve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dispatchSettings, validSupportDispatch, canDispatch, incomingTickets, sortBySla, isCritical, isHighPriority,
  componentHistory, suggestTeam, suggestAssignees, filterDispatch, reserveCheck, timeByGroup, availableDims,
  isGenericRequestType, meanResolveByService, validDispatchItems, validReserve, personLoad,
} from '../shared/dispatch.js';
import { withSupportOverrides, supportMetrics, computeAll } from '../shared/engine.js';
import { dayIdx } from '../shared/dates.js';

const sla = (remainingH, status = 'ok') => ({ remainingH, status });

test('dispatch settings: defaults, sanitising and permission fallback', () => {
  assert.deepEqual(dispatchSettings({}), { incomingStatusIds: [], afterStatusId: null, componentTeams: {}, groupBy: 'requestType', causeFieldId: null });
  const s = dispatchSettings({ support: { dispatch: { incomingStatusIds: ['1', 2, 'x'], afterStatusId: 3, componentTeams: { Export: 't1' } }, timeGroupBy: 'component', causeFieldId: 'customfield_100' } });
  assert.deepEqual(s.incomingStatusIds, ['1', '2']);
  assert.equal(s.afterStatusId, '3');
  assert.equal(s.groupBy, 'component');
  assert.equal(s.causeFieldId, 'customfield_100');
  const v = validSupportDispatch({ dispatch: { incomingStatusIds: ['5', '5', 'a'], afterStatusId: 'drop table', componentTeams: { ' Export ': 't-1', __proto__: 'x', Bad: 'no spaces!' } }, timeGroupBy: 'nope', causeFieldId: 'summary' });
  assert.deepEqual(v.dispatch, { incomingStatusIds: ['5'], afterStatusId: null, componentTeams: { Export: 't-1' } });
  assert.equal(v.timeGroupBy, 'requestType');
  assert.equal(v.causeFieldId, null);
  assert.equal(canDispatch({ dispatch: true }), true);
  assert.equal(canDispatch({ dispatch: false, admin: true }), false, 'an explicit dispatch right wins');
  assert.equal(canDispatch({ editCapacity: true }), true);
  assert.equal(canDispatch({ admin: true }), true);
  assert.equal(canDispatch({}), false);
});

test('incoming: configured statuses, else status category To Do; others counted as a hint', () => {
  const ts = [
    { id: '1', statusId: '10', statusCat: 'new' }, { id: '2', statusId: '11', statusCat: 'new' },
    { id: '3', statusId: '12', statusCat: 'indeterminate' }, { id: '4', statusId: '10', statusCat: 'done' },
  ];
  const a = incomingTickets(ts, { incomingStatusIds: ['10', '12'] });
  assert.deepEqual(a.incoming.map((t) => t.id), ['1', '3']);
  assert.equal(a.otherNew, 1, 'ticket 2 is To Do but not in an incoming status');
  assert.equal(a.mode, 'status');
  const b = incomingTickets(ts, { incomingStatusIds: [] });
  assert.deepEqual(b.incoming.map((t) => t.id), ['1', '2']);
  assert.equal(b.mode, 'category');
  const c = incomingTickets(ts.map(({ statusId, ...t }) => t), { incomingStatusIds: ['10'] }); // eslint-disable-line no-unused-vars
  assert.equal(c.mode, 'noStatusIds', 'without status ids in the data: falls back to the category');
});

test('sorting by remaining SLA time, critical and high priority', () => {
  const rows = [{ id: 'a', key: 'A', sla: sla(5) }, { id: 'b', key: 'B', sla: sla(-2, 'breached') }, { id: 'c', key: 'C', sla: null }, { id: 'd', key: 'D', sla: sla(0.5, 'atRisk') }];
  assert.deepEqual(sortBySla(rows).map((r) => r.id), ['b', 'd', 'a', 'c']);
  assert.equal(isCritical(rows[1]), true);
  assert.equal(isCritical(rows[3]), true);
  assert.equal(isCritical(rows[0]), false);
  assert.equal(isHighPriority('High'), true);
  assert.equal(isHighPriority('Hoch'), true);
  assert.equal(isHighPriority('Medium'), false);
  assert.equal(isHighPriority(null), false);
});

test('team suggestion: mapping, then history of resolved tickets, then the current team', () => {
  const tickets = [
    { statusCat: 'done', team: { id: 'web' }, components: ['Checkout'] }, { statusCat: 'done', team: { id: 'web' }, components: [{ name: 'Checkout' }] },
    { statusCat: 'done', team: { id: 'int' }, components: ['Checkout'] }, { statusCat: 'new', team: { id: 'int' }, components: ['Checkout'] },
  ];
  const history = componentHistory(tickets);
  assert.equal(history.get('Checkout'), 'web');
  assert.deepEqual(suggestTeam({ components: ['Export'] }, { componentTeams: { Export: 'int' }, history }), { teamId: 'int', source: 'mapping', component: 'Export' });
  assert.equal(suggestTeam({ components: ['Checkout'] }, { history }).source, 'history');
  assert.equal(suggestTeam({ components: [], team: { id: 'data' } }, { history }).teamId, 'data');
  assert.equal(suggestTeam({ components: ['Checkout'] }, { history, teamIds: new Set(['int']) }).teamId, null, 'unknown teams are not suggested');
  assert.equal(suggestTeam({ components: ['toString'] }, { componentTeams: {} }).teamId, null, 'no prototype keys');
});

test('assignee suggestion: lowest load this week, spread by 4 h per suggested ticket', () => {
  const members = new Map([['web', [{ id: 'anna', plan: 10, cap: 40 }, { id: 'ben', plan: 14, cap: 40 }, { id: 'away', plan: 0, cap: 0 }]]]);
  const rows = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
  const s = suggestAssignees(rows, () => 'web', members);
  // anna 25 % → +4 h = 35 %, ben 35 % → tie broken by id: anna again? 14/40 = 35 % = ben 14/40 → 'anna' < 'ben'
  assert.equal(s.get('1'), 'anna');
  assert.equal(s.get('2'), 'anna', 'anna 14 h vs ben 14 h: tie → id order');
  assert.equal(s.get('3'), 'ben');
  assert.equal(s.get('4'), 'anna');
  assert.ok(![...s.values()].includes('away'), 'nobody without capacity this week');
  assert.equal(personLoad({ plan: 31, cap: 50 }), 0.62);
  assert.equal(suggestAssignees([{ id: 'x' }], () => 'none', members).size, 0);
});

test('dispatch filters and search', () => {
  const rows = [
    { id: '1', key: 'SUP-1', summary: 'Export bricht ab', priority: 'High', sla: sla(0.4), components: ['Export'], team: { id: 'int' } },
    { id: '2', key: 'SUP-2', summary: 'Passwort', priority: 'Low', sla: sla(30), components: ['Konto'], team: { id: 'web' } },
  ];
  assert.deepEqual(filterDispatch(rows, { filter: 'critical' }).map((r) => r.id), ['1']);
  assert.deepEqual(filterDispatch(rows, { filter: 'high' }).map((r) => r.id), ['1']);
  assert.deepEqual(filterDispatch(rows, { filter: 'team:web' }).map((r) => r.id), ['2']);
  assert.deepEqual(filterDispatch(rows, { q: 'konto' }).map((r) => r.id), ['2'], 'components are searchable');
});

test('reserve check: ±10 % fits, otherwise too tight / too high with a recommendation', () => {
  const support = { teams: [
    { teamId: 'a', weekly: 10, trend: [0, 0, 0, 0, 14, 14, 14, 14] }, // 14 vs 10 → too tight
    { teamId: 'b', weekly: 20, trend: [0, 0, 0, 0, 10, 10, 10, 10] }, // 10 vs 20 → too high
    { teamId: 'c', weekly: 10, trend: [0, 0, 0, 0, 10, 11, 10, 10] }, // fits
    { teamId: 'd', weekly: 12, override: 12, autoWeekly: 6, trend: [0, 0, 0, 0, 12, 12, 12, 12] },
    { teamId: '_none', weekly: 5, trend: [5, 5, 5, 5, 5, 5, 5, 5] },
  ] };
  const r = Object.fromEntries(reserveCheck(support).map((x) => [x.teamId, x]));
  assert.equal(r.a.verdict, 'low'); assert.equal(r.a.recommend, 14); assert.equal(r.a.canApply, true);
  assert.equal(r.b.verdict, 'high'); assert.equal(r.b.recommend, 10);
  assert.equal(r.c.verdict, 'ok'); assert.equal(r.c.canApply, false);
  assert.equal(r.d.manual, true); assert.equal(r.d.auto, 6);
  assert.equal(r._none, undefined, 'no team = nothing to set');
});

test('where does support time go: grouping, generic request types, split multi values, recurring', () => {
  const today = '2026-11-11'; // window: Mon 2026-10-12 … Sun 2026-11-08
  const w = (d, h) => ({ d, h });
  const t = (o) => ({ team: { id: 'web' }, services: ['s1'], labels: [], components: [], ...o });
  const tickets = [
    ...Array.from({ length: 6 }, (_, i) => t({ requestType: 'Passwort zurücksetzen', components: ['Konto'], worklogs: [w('2026-10-20', 1.5)], id: `p${i}` })),
    t({ requestType: 'Email request', worklogs: [w('2026-10-21', 3)] }),
    t({ requestType: { name: 'Get IT help' }, worklogs: [w('2026-10-22', 1)] }),
    t({ requestType: 'Export-Problem', components: ['Export', 'SAP'], worklogs: [w('2026-10-23', 4), w('2026-11-10', 50), w('2026-09-01', 50)] }),
  ];
  const g = timeByGroup(tickets, { dim: 'requestType', today });
  assert.equal(g.total, 17, 'only worklogs inside the last 4 full weeks');
  assert.deepEqual(g.rows.map((r) => r.key), ['Passwort zurücksetzen', 'Export-Problem', '']);
  const pw = g.rows[0];
  assert.equal(pw.tickets, 6); assert.equal(pw.hours, 9); assert.equal(pw.recurring, true);
  assert.deepEqual(pw.sub, ['Konto']);
  assert.equal(g.none.hours, 4); assert.equal(g.none.none, true); assert.equal(g.none.recurring, false);
  const c = timeByGroup(tickets, { dim: 'component', today });
  assert.equal(c.rows.find((r) => r.key === 'Export').hours, 2, 'two components share the ticket\'s hours');
  assert.ok(Math.abs(c.rows.reduce((a, r) => a + r.share, 0) - 1) < 1e-9, 'shares add up to 100 %');
  const l = timeByGroup([t({ labels: ['support', 'vpn'], worklogs: [w('2026-10-20', 2)] })], { dim: 'label', today, ignoreLabels: ['support'] });
  assert.deepEqual(l.rows.map((r) => r.key), ['vpn'], 'queue labels are ignored');
  assert.equal(isGenericRequestType('E-Mail-Anfrage'), true);
  assert.equal(isGenericRequestType('Neuen Mitarbeiter ausstatten'), false);
  // without dated worklogs: Time Spent of open or recently resolved tickets, flagged as approximate
  const approx = timeByGroup([t({ requestType: 'X', spentH: 3, statusCat: 'new' }), t({ requestType: 'X', spentH: 9, statusCat: 'done', resolved: '2026-08-01T10:00:00Z' })], { dim: 'requestType', today });
  assert.equal(approx.total, 3); assert.equal(approx.exact, false);
  assert.deepEqual(availableDims([{ labels: ['support'] }], { causeFieldId: 'customfield_1', ignoreLabels: ['support'] }), { requestType: false, component: false, label: false, cause: false }, 'only queue labels: nothing to group by');
  assert.equal(availableDims([{ labels: ['vpn'], cause: null }], { causeFieldId: 'customfield_1' }).label, true);
  assert.equal(availableDims([{ labels: [], cause: null }], { causeFieldId: 'customfield_1' }).cause, true);
  assert.equal(dayIdx(today) > g.to, true);
});

test('Ø resolution per service space', () => {
  const m = meanResolveByService([{ resolved: 'x', services: ['a'], sla: { elapsedH: 2 } }, { resolved: 'y', services: ['a', 'b'], sla: { elapsedH: 4 } }, { resolved: null, services: ['a'], sla: { elapsedH: 99 } }]);
  assert.equal(m.get('a'), 3); assert.equal(m.get('b'), 4);
});

test('server input validation: items and reserve', () => {
  assert.throws(() => validDispatchItems([]));
  assert.throws(() => validDispatchItems(Array.from({ length: 51 }, (_, i) => ({ issueId: String(i + 1), teamId: 't' }))));
  assert.throws(() => validDispatchItems([{ issueId: '1 OR 1=1', teamId: 't' }]));
  assert.throws(() => validDispatchItems([{ issueId: '1', accountId: 'a b' }]));
  assert.throws(() => validDispatchItems([{ issueId: '1' }]), /required/);
  assert.throws(() => validDispatchItems([{ issueId: '1', teamId: 't' }, { issueId: '1', teamId: 't' }]), /issueId/);
  assert.deepEqual(validDispatchItems([{ issueId: 12, teamFieldValue: 'team-1', accountId: '5b10:abc' }]), [{ issueId: '12', teamId: 'team-1', accountId: '5b10:abc' }]);
  assert.deepEqual(validDispatchItems([{ issueId: '12', teamId: null, accountId: null, statusId: '3' }], { undo: true })[0], { issueId: '12', teamId: null, accountId: null, statusId: '3', restoreTeam: true, restoreAssignee: true });
  assert.deepEqual(validReserve({ teamId: 't1', hours: 12.3 }), { teamId: 't1', hours: 12.5 });
  assert.deepEqual(validReserve({ teamId: 't1', hours: null }), { teamId: 't1', hours: null });
  assert.throws(() => validReserve({ teamId: 't1', hours: 81 }));
  assert.throws(() => validReserve({ teamId: 't1', hours: '12' }));
  assert.throws(() => validReserve({ teamId: '__proto__', hours: 1 }));
});

// ---------- engine: the manual reserve reaches every consumer ----------
test('engine: a manual support reserve replaces the measured one (waterline, weekly views, totals) and is idempotent', () => {
  const support = {
    teams: [{ teamId: 'web', weekly: 10, trend: [] }, { teamId: 'int', weekly: 6, trend: [] }],
    reserveQuarter: { web: 120, int: 72 }, personWeekly: { anna: 6, ben: 4, cleo: 6 }, weeklyTotal: 16, services: [],
  };
  const capacity = { people: { anna: { teamId: 'web' }, ben: { teamId: 'web' }, cleo: { teamId: 'int' }, dora: { teamId: 'data' } }, teams: { web: { supportOverride: 20 }, data: { supportOverride: 4 }, int: { supportOverride: null } } };
  const s = withSupportOverrides(support, capacity);
  assert.equal(s.reserveQuarter.web, 240);
  assert.equal(s.reserveQuarter.int, 72, 'null = automatic');
  assert.equal(s.reserveQuarter.data, 48, 'a team without measured support can get a reserve');
  assert.equal(s.teams.find((t) => t.teamId === 'web').autoWeekly, 10);
  assert.equal(s.weeklyTotal, 30);
  assert.equal(s.personWeekly.anna, 12); assert.equal(s.personWeekly.ben, 8, 'the team\'s people scaled to the override');
  assert.equal(s.personWeekly.cleo, 6);
  assert.equal(s.personWeekly.dora, 4, 'nobody measured: spread evenly');
  assert.deepEqual(withSupportOverrides(s, capacity), s, 'applying twice changes nothing');
  const back = withSupportOverrides(s, { teams: {} });
  assert.equal(back.reserveQuarter.web, 120); assert.equal(back.weeklyTotal, 16);
  assert.equal(withSupportOverrides(support, null), support);
  assert.deepEqual(withSupportOverrides({ ...support, personWeekly: {} }, capacity).personWeekly, {}, 'hidden person values stay hidden');
});

test('engine: supportMetrics and computeAll honour capacity.teams[team].supportOverride', () => {
  const sup = { averagingWeeks: 4, services: [{ id: 'sv', key: 'SUP', name: 'Support' }],
    tickets: [{ serviceId: 'sv', team: { id: 't1' }, statusCat: 'new', sla: { met: 1, breached: 0 }, worklogs: [{ a: 'u1', d: '2026-10-06', h: 8 }] }] };
  assert.equal(supportMetrics(sup, '2026-11-02').reserveQuarter.t1, 24);
  assert.equal(supportMetrics(sup, '2026-11-02', { teams: { t1: { supportOverride: 5 } } }).reserveQuarter.t1, 60);
  const ds = {
    today: '2026-11-02', config: { levels: [], fields: {}, rules: {} }, portfolio: [], issues: [], external: [], versions: {}, milestones: [], teams: [{ id: 't1', name: 'Web' }], people: {},
    capacity: { defaultWeeklyHours: 40, teams: { t1: { supportOverride: 7 } }, people: { u1: { weeklyHours: 40, teamId: 't1', location: 'NONE' } }, absences: [] },
    supportComputed: supportMetrics(sup, '2026-11-02'),
  };
  const c = computeAll(ds);
  assert.equal(c.support.reserveQuarter.t1, 84);
  assert.equal(c.support.personWeekly.u1, 7);
  const q = c.wl.quarters[0];
  assert.equal(c.wl.cells.t1[q].support, 84, 'the waterline deducts the manual reserve');
});

// ---------- server: dispatch and reserve with a fake Jira ----------
const { dispatchTickets, undoDispatch, setSupportReserve } = await import('../src/lib/dispatch.js');
function fakeJira(state) {
  const calls = [];
  const jira = async (as, path, opts = {}) => {
    calls.push({ as, path, method: opts.method || 'GET', body: opts.body, query: opts.query });
    if (path === '/rest/api/3/search/jql') return { issues: state.visible.map((id) => ({ id })) };
    const m = /^\/rest\/api\/3\/issue\/(\d+)(\/(transitions|assignee))?$/.exec(path);
    const it = state.issues[m[1]];
    if (!m[2] && (opts.method || 'GET') === 'GET') return { fields: { assignee: it.assignee ? { accountId: it.assignee } : null, status: { id: it.status }, customfield_team: it.team } };
    if (!m[2] && opts.method === 'PUT') {
      if (state.noNotifyRight && opts.query?.notifyUsers === false) throw Object.assign(new Error('notifyUsers: not allowed'), { status: 400 });
      const f = opts.body.fields;
      if ('assignee' in f) it.assignee = f.assignee?.accountId || null;
      if ('customfield_team' in f) it.team = f.customfield_team;
      return null;
    }
    if (m[3] === 'transitions' && (opts.method || 'GET') === 'GET') return { transitions: (state.flow[it.status] || []).map((to) => ({ id: `t${to}`, to: { id: to, name: `S${to}`, statusCategory: { key: 'indeterminate' } } })) };
    if (m[3] === 'transitions') { it.status = opts.body.transition.id.slice(1); return null; }
    throw new Error(`unexpected ${path}`);
  };
  return { jira, calls };
}
const cfg = { fields: { team: 'customfield_team' }, support: { serviceProjectIds: ['200'], queues: [], dispatch: { afterStatusId: '3' } } };
const ctx = { accountId: 'me', cfg, roles: { dispatch: true } };

test('server: dispatch sets assignee + team as the user without notifications, transitions, and undo restores', async () => {
  const state = { visible: ['11', '12'], issues: { 11: { assignee: null, team: null, status: '1' }, 12: { assignee: 'old', team: 'x', status: '5' } }, flow: { 1: ['3'], 3: ['1'], 5: [] }, noNotifyRight: true };
  const { jira, calls } = fakeJira(state);
  const audits = [];
  const deps = { jira, audit: async (c, a, d) => audits.push([a, d]) };
  const r = await dispatchTickets({ items: [{ issueId: '11', teamId: 'web', accountId: 'anna' }, { issueId: '12', teamId: 'web', accountId: 'ben' }, { issueId: '99', teamId: 'web' }] }, ctx, deps);
  const [a, b, c] = r.results;
  assert.equal(a.ok, true); assert.equal(a.statusChanged, true); assert.deepEqual(a.before, { accountId: null, teamId: null, statusId: '1' });
  assert.equal(state.issues[11].assignee, 'anna'); assert.equal(state.issues[11].team, 'web'); assert.equal(state.issues[11].status, '3');
  assert.equal(b.ok, true); assert.equal(b.statusChanged, false); assert.equal(b.statusNote, 'NO_TRANSITION', 'no way to the target status: reported, status unchanged');
  assert.equal(c.ok, false); assert.equal(c.error.code, 'NOT_FOUND', 'only visible support tickets');
  assert.ok(calls.every((x) => x.as === 'user'), 'everything as the user');
  assert.ok(calls.some((x) => x.method === 'PUT' && x.query?.notifyUsers === false), 'tries without notifications first');
  assert.equal(audits[0][0], 'support.dispatch');
  const u = await undoDispatch({ items: [{ issueId: '11', ...a.before }, { issueId: '12', ...b.before }] }, ctx, deps);
  assert.ok(u.results.every((x) => x.ok));
  assert.deepEqual(state.issues[11], { assignee: null, team: null, status: '1' });
  assert.deepEqual(state.issues[12], { assignee: 'old', team: 'x', status: '5' });
  assert.equal(u.results[1].statusNote, 'ALREADY');
});

test('server: dispatch needs the right and valid input', async () => {
  const { jira } = fakeJira({ visible: [], issues: {}, flow: {} });
  await assert.rejects(dispatchTickets({ items: [{ issueId: '1', teamId: 't' }] }, { ...ctx, roles: { dispatch: false } }, { jira }), /NO_ACCESS/);
  await assert.rejects(dispatchTickets({ items: [{ issueId: 'abc', teamId: 't' }] }, ctx, { jira }), (e) => e.code === 'INVALID');
});

test('server: support reserve writes only capacity.teams[team].supportOverride', async () => {
  let store = { people: { u1: { weeklyHours: 40 } }, teams: { web: { name: 'Web', dailyBusinessPct: 20 } }, absences: [{ id: 'a' }] };
  const deps = { get: async () => structuredClone(store), set: async (k, v) => { assert.equal(k, 'capacity'); store = v; }, audit: async () => {} };
  const ed = { accountId: 'me', roles: { editCapacity: true } };
  assert.deepEqual(await setSupportReserve({ teamId: 'web', hours: 14 }, ed, deps), { teamId: 'web', hours: 14, previous: null });
  assert.deepEqual(store.teams.web, { name: 'Web', dailyBusinessPct: 20, supportOverride: 14 });
  assert.deepEqual(store.people, { u1: { weeklyHours: 40 } }); assert.equal(store.absences.length, 1);
  assert.deepEqual(await setSupportReserve({ teamId: 'web', hours: null }, ed, deps), { teamId: 'web', hours: null, previous: 14 });
  assert.deepEqual(store.teams.web, { name: 'Web', dailyBusinessPct: 20, supportOverride: null });
  await setSupportReserve({ teamId: 'new', hours: 3, teamName: 'Neu' }, ed, deps);
  assert.deepEqual(store.teams.new, { name: 'Neu', dailyBusinessPct: 20, internalPct: 0, absenceRatePct: 10, extraWeeklyHours: 0, supportOverride: 3 }, 'created with the editor defaults');
  await setSupportReserve({ teamId: 'ghost', hours: null }, ed, deps);
  assert.equal('ghost' in store.teams, false, 'resetting a team without entry creates nothing');
  await assert.rejects(setSupportReserve({ teamId: 'web', hours: 5 }, { accountId: 'me', roles: {} }, deps), /NO_ACCESS/);
  await assert.rejects(setSupportReserve({ teamId: 'web', hours: 500 }, ed, deps), (e) => e.code === 'INVALID');
});
