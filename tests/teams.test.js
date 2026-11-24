// Prototype update: Blocked status, per-space support numbers, Teamdetails and the booking check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAll, blockedMatcher, supportMetrics, dependencies } from '../shared/engine.js';
import { teamDetails, teamWeeks, teamIds } from '../shared/team.js';
import { bookingOverview, bookingRange } from '../shared/booking.js';
import { dayIdx } from '../shared/dates.js';

const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url)));
const fresh = () => structuredClone(golden);

test('Blocked: the configured statuses, otherwise every status named Blocked / Blockiert', () => {
  const byName = blockedMatcher({});
  assert.equal(byName({ status: { id: '1', name: 'Blocked' } }), true);
  assert.equal(byName({ status: { id: '2', name: 'blockiert' } }), true);
  assert.equal(byName({ status: { id: '3', name: 'In Progress' } }), false);
  assert.equal(byName({ status: { id: '4', name: 'Unblocked work' } }), false, 'whole name only');
  const byId = blockedMatcher({ dependencies: { blockedStatusIds: ['77'] } });
  assert.equal(byId({ status: { id: '77', name: 'Wartet' } }), true);
  assert.equal(byId({ status: { id: '1', name: 'Blocked' } }), false, 'a choice in the configuration wins over the name');
});

test('Blocked list: open stories in Blocked, oldest first, with what they wait for via configured links', () => {
  const ds = fresh();
  const [s1, s2] = ds.issues.filter((i) => i.role === 'estimate');
  s1.status = { id: '9', name: 'Blocked', cat: 'new' }; s1.blockedSince = '2026-10-20'; s1.blockedReason = 'Wartet auf API';
  s2.status = { id: '9', name: 'Blocked', cat: 'new' }; s2.blockedSince = '2026-10-30';
  s1.links = [{ id: 'L1', typeId: '10000', verb: 'is blocked by', inverse: 'blocks', outward: false, otherId: s2.id }];
  const c = computeAll(ds);
  const b = dependencies(c.model, null).blocked;
  assert.deepEqual(b.map((x) => x.id), [s1.id, s2.id], 'oldest first');
  assert.equal(b[0].days, dayIdx(ds.today) - dayIdx('2026-10-20'));
  assert.equal(b[0].reason, 'Wartet auf API');
  assert.deepEqual(b[0].waitsOn, [s2.id]);
  assert.deepEqual(b[1].blocks, [s1.id]);
  s1.status.cat = 'done';
  assert.equal(dependencies(computeAll(ds).model, null).blocked.length, 1, 'done items are not blocked any more');
});

test('support per service space: Ø per team, rising teams, SLA health', () => {
  const today = '2026-11-02';
  const mon = dayIdx('2026-11-02'); // a Monday
  const day = (n) => new Date((mon - n) * 864e5).toISOString().slice(0, 10);
  const tickets = [
    { serviceId: 'S', statusCat: 'new', re: 5, team: { id: 'web' }, sla: { met: 9, breached: 1 }, worklogs: [{ d: day(20), h: 4 }, { d: day(3), h: 8 }, { d: day(10), h: 8 }] },
    { serviceId: 'S', statusCat: 'done', team: { id: 'data' }, sla: { met: 1, breached: 0 }, worklogs: [{ d: day(25), h: 4 }] },
  ];
  const s = supportMetrics({ services: [{ id: 'S', key: 'SUP', name: 'Support' }], tickets, averagingWeeks: 4, slaTargetPct: 95 }, today);
  const sv = s.services[0];
  const web = sv.teams.find((t) => t.teamId === 'web');
  assert.equal(web.avg, 20 / 4, 'Ø over the 4-week window');
  assert.equal(web.recentAvg, 16 / 2, 'last 2 weeks');
  assert.equal(web.spike, true, '8 h > 1.2 × 5 h');
  assert.deepEqual(sv.rising, ['web']);
  assert.equal(sv.open, 1);
  assert.equal(sv.slaRate, 10 / 11);
  assert.equal(sv.health, 'atRisk', '90.9 % is within 5 points below the 95 % goal');
});

test('Teamdetails: capacity after support, project demand in rank order, free / missing', () => {
  const c = computeAll(fresh());
  assert.ok(teamIds(c).includes('web'));
  const td = teamDetails(c, 'web');
  for (const q of td.quarters) {
    const cell = c.wl.cells.web?.[q];
    if (!cell) continue;
    assert.equal(td.cells[q].cap, Math.max(0, cell.capacity - cell.support), 'capacity after support');
    assert.ok(Math.abs(td.cells[q].demand - (cell.demand - cell.support)) < 1e-9, 'project demand = waterline demand without support');
    assert.ok(Math.abs(td.cells[q].free - (td.cells[q].cap - td.cells[q].demand)) < 1e-9);
    // the project rows add up to the demand
    const rows = td.projects.reduce((a, p) => a + (p.q[q]?.demand || 0), 0);
    assert.ok(Math.abs(rows - td.cells[q].demand) < 1e-6, `${q}: rows ${rows} = demand ${td.cells[q].demand}`);
  }
  assert.deepEqual(td.projects.map((p) => p.rank), [...td.projects.map((p) => p.rank)].sort((a, b) => a - b), 'rank order');
  const tw = teamWeeks(c, 'web');
  assert.ok(tw.weeks.length >= 1 && tw.rows.every((r) => r.plan.length === tw.weeks.length));
});

test('Teamdetails: blocked or past-due stories of the team', () => {
  const ds = fresh();
  const s = ds.issues.find((i) => i.role === 'estimate' && i.team?.id === 'web');
  s.status = { id: '9', name: 'Blocked', cat: 'new' };
  const td = teamDetails(computeAll(ds), 'web');
  assert.ok(td.watch.some((w) => w.id === s.id && w.blocked));
  assert.equal(td.kpis.watch, td.watch.length);
});

test('booking check: possible time, quote, missing and status (90 % / 20 %)', () => {
  const ds = fresh();
  ds.capacity.people = { a: { weeklyHours: 40, location: 'NONE', teamId: 'web' }, b: { weeklyHours: 40, location: 'NONE', teamId: 'web' }, c: { weeklyHours: 40, location: 'NONE', teamId: 'web' }, d: { weeklyHours: 40, location: 'NONE', teamId: 'web' } };
  ds.capacity.absences = [{ accountId: 'd', from: '2026-10-05', to: '2026-10-09' }];
  const c = computeAll(ds);
  const a = dayIdx('2026-10-05'), b = dayIdx('2026-10-16'); // two weeks, 10 workdays → 80 h possible
  const booked = { people: { a: { h: 78, last: '2026-10-16', byIssue: {} }, b: { h: 70, byIssue: {} }, c: { h: 60, byIssue: {} }, d: { h: 40, byIssue: {} } } };
  const o = bookingOverview(c.model, booked, a, b, { booking: { minPct: 90, escalatePct: 20 } });
  const r = Object.fromEntries(o.rows.map((x) => [x.id, x]));
  assert.equal(r.a.possible, 80); assert.equal(r.a.pct, 98); assert.equal(r.a.level, 'ok');
  assert.equal(r.b.pct, 88); assert.equal(r.b.level, 'info', '12 % missing: a hint');
  assert.equal(r.c.pct, 75); assert.equal(r.c.level, 'esc', '25 % missing: escalation');
  assert.equal(r.c.missing, 20);
  assert.equal(r.d.possible, 40, 'a week of absence is not possible time');
  assert.equal(r.d.level, 'ok');
  assert.equal(o.rows[0].id, 'c', 'lowest quote first');
});

test('booking range: never beyond today, the last grace workdays left out', () => {
  const today = dayIdx('2026-11-06'); // Friday
  const r = bookingRange(dayIdx('2026-11-01'), dayIdx('2026-11-30'), today, 2);
  assert.equal(r.b, dayIdx('2026-11-04'), 'Friday minus 2 workdays = Wednesday');
  const past = bookingRange(dayIdx('2026-10-01'), dayIdx('2026-10-31'), today, 2);
  assert.equal(past.b, dayIdx('2026-10-31'), 'a period in the past keeps its end');
});
