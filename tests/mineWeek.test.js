// Meine Arbeit (UC-20) acceptance criteria on the week sheet: groups, order, support first, targets, low days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAll } from '../shared/engine.js';
import { buildWeek, isEmployee, parseHours, roundQuarter, weekOf, myProfile } from '../shared/mine.js';

const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url), 'utf8'));
const ME = 'uMe';
// Week of Mon 2026-11-09; today Wednesday 2026-11-11
function setup() {
  const ds = structuredClone(golden);
  ds.today = '2026-11-11';
  ds.config = { ...(ds.config || {}), booking: { minPct: 90, graceDays: 0 } };
  ds.capacity = { people: { [ME]: { weeklyHours: 40, teamId: 't1', location: 'DE-NW' } }, teams: {}, absences: [] };
  return computeAll(ds);
}
const iss = (id, o = {}) => ({ id, key: `PCX-${id}`, summary: `Task ${id}`, type: { name: 'Story', subtask: false }, status: { id: '1', name: 'To Do', cat: 'new' }, project: { id: '10048', key: 'PCX', name: 'Sandbox' }, assignee: { id: ME, name: 'Me' }, mine: true, start: null, due: null, oe: 8, re: 8, ts: 0, hasEstimate: true, parent: null, support: false, ...o });
const data = {
  from: '2026-11-09', to: '2026-11-13',
  issues: [
    iss('1', { start: '2026-11-10', due: '2026-11-20', status: { id: '3', name: 'In Progress', cat: 'indeterminate' } }),
    iss('2', { due: '2026-11-02' }), // overdue (before the week) → assigned in the current week
    iss('3', { start: '2026-11-09', due: '2026-11-12', status: { id: '9', name: 'Done', cat: 'done' } }), // done, in the week → stays
    iss('4', { start: '2026-12-01', due: '2026-12-20', mine: false, assignee: { id: 'x', name: 'Other' } }), // booked by me, assigned to someone else
    iss('5', { support: true, status: { id: '3', name: 'In Progress', cat: 'indeterminate' } }), // support without dates
    iss('6', {}), // mine, open, no dates → "Ohne Termin"
    iss('7', { start: '2026-11-10', due: '2026-11-12', status: { id: '77', name: 'Blocked', cat: 'indeterminate' } }),
    iss('8', { type: { name: 'Sub-task', subtask: true }, start: '2026-11-10', due: '2026-11-12' }),
  ],
  worklogs: [
    { id: 'w1', issueId: '1', d: '2026-11-09', h: 3, c: 'a' }, { id: 'w2', issueId: '4', d: '2026-11-09', h: 2, c: '' },
    { id: 'w3', issueId: '1', d: '2026-11-10', h: 8, c: '' }, { id: 'w4', issueId: '5', d: '2026-11-10', h: 1, c: '' },
  ],
};

test('groups: support first, assigned (incl. overdue + done in the week), more, undated', () => {
  const w = buildWeek({ computed: setup(), data, meId: ME, today: '2026-11-11' });
  assert.deepEqual(w.groups.map((g) => g.kind), ['support', 'assigned', 'more', 'undated']);
  assert.deepEqual(w.groups[0].rows.map((r) => r.key), ['PCX-5']);
  const assigned = w.groups[1].rows.map((r) => r.key);
  assert.ok(assigned.includes('PCX-2'), 'overdue in the current week');
  assert.ok(assigned.includes('PCX-3'), 'done task with dates in the week');
  assert.deepEqual(w.groups[2].rows.map((r) => r.key), ['PCX-4'], 'booked by me but assigned to someone else');
  assert.deepEqual(w.groups[3].rows.map((r) => r.key), ['PCX-6']);
});

test('order: Blocked, overdue, In Progress, To Do, Done', () => {
  const w = buildWeek({ computed: setup(), data, meId: ME, today: '2026-11-11' });
  const keys = w.groups[1].rows.map((r) => r.key);
  assert.ok(keys.indexOf('PCX-7') < keys.indexOf('PCX-2'), 'blocked before overdue');
  assert.ok(keys.indexOf('PCX-2') < keys.indexOf('PCX-1'), 'overdue before in progress');
  assert.equal(keys.at(-1), 'PCX-3', 'done last');
});

test('sub-tasks are not bookable; cells and totals come from the own worklogs', () => {
  const w = buildWeek({ computed: setup(), data, meId: ME, today: '2026-11-11' });
  const sub = w.rowsById.get('8');
  assert.equal(sub.bookable, false);
  const r1 = w.rowsById.get('1');
  assert.deepEqual(r1.cells.map((c) => c.h), [3, 8, 0, 0, 0]);
  assert.equal(r1.total, 11);
  assert.deepEqual(w.dayTotals.map((d) => d.h), [5, 9, 0, 0, 0]);
});

test('targets: 40 h / 5 per working day; past days under the minimum are marked; KPI up to today', () => {
  const w = buildWeek({ computed: setup(), data, meId: ME, today: '2026-11-11' });
  assert.deepEqual(w.dayTotals.map((d) => d.possible), [8, 8, 8, 8, 8]);
  assert.deepEqual(w.dayTotals.map((d) => d.low), [true, false, false, false, false], 'Mon 5 of 8 h < 90 %; today is not "past"');
  assert.equal(w.booked.ist, 14);
  assert.equal(w.booked.soll, 24, 'Mon–Wed (grace 0)');
  assert.equal(Math.round(w.booked.pct * 100), 58);
  assert.equal(w.booked.below, true);
  assert.equal(w.open.n, 5, 'open and mine in the week: 1, 2, 7, 8 and the support ticket 5');
  assert.equal(w.open.overdue, 1);
  assert.equal(w.open.blocked, 1, 'no Blocked status configured → a status named "Blocked" counts');
});

test('public holidays and absences have no target', () => {
  const c = setup();
  c.model.ds.capacity.absences = [{ accountId: ME, from: '2026-11-12', to: '2026-11-13' }];
  const w = buildWeek({ computed: c, data, meId: ME, today: '2026-11-11' });
  assert.deepEqual(w.dayTotals.map((d) => d.possible), [8, 8, 8, 0, 0]);
  const xmas = buildWeek({ computed: setup(), data: { ...data, from: '2026-12-21', to: '2026-12-25' }, meId: ME, today: '2026-11-11' });
  assert.equal(xmas.days[4].holiday, true, 'Christmas Day');
  assert.equal(xmas.days[4].possible, 0);
});

test('project filter and the Jira-space tab: totals only for that project', () => {
  const w = buildWeek({ computed: setup(), data, meId: ME, today: '2026-11-11', ctx: 'support' });
  assert.ok(w.groups.every((g) => g.rows.every((r) => r.support)));
  assert.deepEqual(w.dayTotals.map((d) => d.h), [0, 1, 0, 0, 0]);
  assert.equal(w.booked.filtered, true);
  const sp = buildWeek({ computed: setup(), data, meId: ME, today: '2026-11-11', ctx: 'proj:PCX' });
  assert.equal(sp.ctx, 'proj:PCX');
  assert.ok(sp.groups.some((g) => g.rows.length));
});

test('who is "Mitarbeiter": no admin, no configured group, owner of no project', () => {
  const none = { admin: false, viewReport: false, manageRanking: false, editCapacity: false, editHealth: false, manageSettings: false };
  assert.equal(isEmployee(none, { portfolio: [] }, ME), true);
  assert.equal(isEmployee({ ...none, editHealth: true }, { portfolio: [] }, ME), false);
  assert.equal(isEmployee({ ...none, admin: true }, { portfolio: [] }, ME), false);
  assert.equal(isEmployee(none, { portfolio: [{ owner: { id: ME } }] }, ME), false, 'project owners keep the cockpit');
});

test('input: 1,5 / 1:30 / 90m / 2h 30m → quarter hours; nonsense refused', () => {
  assert.equal(roundQuarter(parseHours('1,5')), 1.5);
  assert.equal(roundQuarter(parseHours('1:30')), 1.5);
  assert.equal(roundQuarter(parseHours('90m')), 1.5);
  assert.equal(roundQuarter(parseHours('2h 30m')), 2.5);
  assert.equal(roundQuarter(parseHours('')), 0);
  assert.equal(roundQuarter(parseHours('abc')), null);
  assert.equal(roundQuarter(parseHours('30')), null, 'more than 24 h');
  assert.equal(weekOf('2026-11-11').from, '2026-11-09');
  assert.equal(myProfile(setup(), ME).forProjects, 40 * 0.8, 'default 20 % daily business');
});
