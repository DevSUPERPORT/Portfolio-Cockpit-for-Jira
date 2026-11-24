// People split across teams (UC-14): capacity.people[id].teams = [{ teamId, pct }]. Team capacity counts weekly hours ×
// share in every team the person works in; the person's own utilisation stays across all teams.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validAllocation, allocationOf, allocationSum, allocationOff, shareOf, inTeam, setShare, joinTeam, moveMainTeam } from '../shared/allocation.js';
import { computeAll, quarterCapacityParts, weeksUtilization } from '../shared/engine.js';
import { teamDetails } from '../shared/team.js';
import { teamKpis } from '../shared/kpis.js';
import { buildBoard } from '../shared/weekPlan.js';

test('validAllocation: whole shares 1–100 %, unique teams, at most 6, together at most 100 %', () => {
  assert.deepEqual(validAllocation([{ teamId: 'a', pct: 60 }, { teamId: 'b', pct: '40' }]), [{ teamId: 'a', pct: 60 }, { teamId: 'b', pct: 40 }]);
  assert.equal(validAllocation([{ teamId: 'a', pct: 60 }, { teamId: 'b', pct: 50 }]), null, 'more than 100 %');
  assert.equal(validAllocation([{ teamId: 'a', pct: 0 }]), null);
  assert.equal(validAllocation([{ teamId: 'a', pct: 101 }]), null);
  assert.equal(validAllocation([{ teamId: 'a', pct: 50 }, { teamId: 'a', pct: 10 }]), null, 'twice the same team');
  assert.equal(validAllocation([{ teamId: 'a b', pct: 50 }]), null);
  assert.equal(validAllocation(Array.from({ length: 7 }, (_, i) => ({ teamId: `t${i}`, pct: 10 }))), null, 'more than 6 teams');
  assert.equal(validAllocation([]), null);
});

test('allocationOf: without teams 100 % in the main team; shares and membership', () => {
  assert.deepEqual(allocationOf({ teamId: 'a' }), [{ teamId: 'a', pct: 100 }]);
  assert.deepEqual(allocationOf({}), []);
  const p = { teamId: 'a', teams: [{ teamId: 'a', pct: 60 }, { teamId: 'b', pct: 40 }] };
  assert.equal(shareOf(p, 'a'), 0.6); assert.equal(shareOf(p, 'b'), 0.4); assert.equal(shareOf(p, 'c'), 0);
  assert.equal(inTeam(p, 'b'), true); assert.equal(inTeam(p, 'c'), false);
  assert.equal(allocationOff(p), false);
  assert.equal(allocationOff({ teamId: 'a', teams: [{ teamId: 'a', pct: 60 }] }), true, 'a gentle hint below 100 %');
  assert.equal(allocationSum(allocationOf({ teamId: 'a', teams: [{ teamId: 'a', pct: 90 }, { teamId: 'b', pct: 90 }] })), 100, 'broken data is scaled, never counted twice');
});

test('editing: set a share, join a team without leaving the other, change the main team', () => {
  const p = { weeklyHours: 40, location: 'DE', teamId: 'a' };
  const j = joinTeam(p, 'b');
  assert.equal(j.pct, 20, 'no free share: 20 % taken from the largest team');
  assert.deepEqual(j.person.teams, [{ teamId: 'a', pct: 80 }, { teamId: 'b', pct: 20 }]);
  assert.equal(j.person.teamId, 'a', 'the main team stays');
  const k = setShare(j.person, 'a', 60);
  assert.deepEqual(k.teams, [{ teamId: 'a', pct: 60 }, { teamId: 'b', pct: 20 }]);
  assert.equal(joinTeam(k, 'c').pct, 20, 'the free 20 % first');
  assert.equal(setShare(k, 'b', 90).teams[1].pct, 40, 'never above 100 % together');
  const back = setShare(j.person, 'b', 0);
  assert.equal(back.teams, undefined, 'back to one team at 100 %: the plain old form');
  assert.equal(back.teamId, 'a');
  const m = moveMainTeam(j.person, 'b');
  assert.deepEqual([m.teamId, m.teams], ['b', undefined], 'the main share joins the share already there');
  const m2 = moveMainTeam(j.person, 'c');
  assert.deepEqual([m2.teamId, m2.teams], ['c', [{ teamId: 'c', pct: 80 }, { teamId: 'b', pct: 20 }]]);
  const left = setShare({ teamId: 'a', teams: [{ teamId: 'a', pct: 60 }, { teamId: 'b', pct: 40 }] }, 'a', 0);
  assert.equal(left.teamId, 'b', 'leaving the main team: the other one becomes the main team');
});

const st = { name: 'Offen', cat: 'new' };
function fixture() {
  return {
    today: '2026-11-11',
    config: {},
    portfolio: [{ ref: 'issue:1', rank: 1, kind: 'issue', id: '1', key: 'P-1', name: 'Alpha', statusCat: 'indeterminate' }],
    teams: [{ id: 't1', name: 'Web' }, { id: 't2', name: 'Data' }],
    people: { u1: { name: 'Anna' }, u2: { name: 'Ben' } },
    capacity: {
      people: {
        u1: { weeklyHours: 40, location: 'NONE', teamId: 't1', teams: [{ teamId: 't1', pct: 60 }, { teamId: 't2', pct: 40 }] },
        u2: { weeklyHours: 40, location: 'NONE', teamId: 't2' },
      },
      absences: [], teams: { t1: { dailyBusinessPct: 0, internalPct: 0, absenceRatePct: 0 }, t2: { dailyBusinessPct: 0, internalPct: 0, absenceRatePct: 0 } },
    },
    supportComputed: { personWeekly: {}, teams: [], services: [], reserveQuarter: {} },
    issues: [
      { id: '101', key: 'A-1', summary: 'API', role: 'estimate', status: st, links: [], worklogs: [], parentId: '1', team: { id: 't1' }, assignee: { id: 'u1', name: 'Anna' }, oe: 20, re: 20, start: '2026-11-09', due: '2026-11-13', rootRef: 'issue:1' },
    ],
  };
}

test('team capacity: weekly hours × share in every team (quarter, weeks, team details, team KPIs)', () => {
  const c = computeAll(fixture());
  const q1 = quarterCapacityParts(c.model, 't1'), q2 = quarterCapacityParts(c.model, 't2');
  assert.equal(q1.weekly, 24); assert.equal(q2.weekly, 56, '40 × 40 % + 40');
  assert.deepEqual(q1.members, [{ id: 'u1', weeklyHours: 24, pct: 60, fullWeeklyHours: 40 }]);
  const wu = weeksUtilization(c.model, c.support, 2);
  const t1 = wu.teams.find((t) => t.teamId === 't1'), t2 = wu.teams.find((t) => t.teamId === 't2');
  assert.equal(t1.cap[1], 24); assert.equal(t2.cap[1], 56);
  const anna = t2.members.find((m) => m.id === 'u1');
  assert.equal(anna.pct, 40);
  assert.equal(anna.cap[1], 40, 'the person\'s own capacity and utilisation stay across all teams');
  const td = teamDetails(c, 't2');
  assert.deepEqual(td.members.sort(), ['u1', 'u2']);
  assert.equal(td.weeklyHours, 56);
  assert.equal(td.shares.u1, 40);
  const k = teamKpis({ computed: c, teamId: 't2', lang: 'en', fmt: { h: (v, d = 0) => `${Math.round(v * 10 ** d) / 10 ** d} h`, pct: (v) => (v == null ? '–' : `${Math.round(v * 100)} %`), quarter: (q) => q, date: (d) => String(d).slice(0, 10) } });
  assert.equal(k[0].value, 2);
  assert.match(k[0].calc, /16 h \+ 40 h = 56 h/);
});

test('weekly board: the person appears in each team with their share; the team sums use it', () => {
  const ds = fixture();
  const computed = computeAll(ds);
  const all = buildBoard({ ds, computed });
  const rowT1 = all.rows.find((r) => r.teamId === 't1'), rowT2 = all.rows.find((r) => r.teamId === 't2');
  const m1 = rowT1.cells[0].cards.find((x) => x.accountId === 'u1'), m2 = rowT2.cells[0].cards.find((x) => x.accountId === 'u1');
  assert.equal(m1.pct, 60); assert.equal(m2.pct, 40);
  assert.equal(m1.avail + m2.avail, 40, 'split, never counted twice');
  assert.equal(m1.util, m2.util, 'the person\'s utilisation is the same in both teams');
  assert.equal(rowT2.weekly, 56);
  const b2 = buildBoard({ ds, computed, team: 't2' });
  const anna = b2.rows.find((r) => r.id === 'p:u1');
  assert.equal(anna.inTeam, true); assert.equal(anna.pct, 40);
  const other = anna.cells[0].cards.find((x) => x.kind === 'other');
  assert.equal(other.hours, 20, 'her Web task shows as "other teams" on the Data board');
  // the Personen sum adds up the rows above: each person's whole week (boss 2026-11-23), here Anna 40 h + the Data member 40 h
  assert.equal(b2.foot[0].time, 80);
  const shown = b2.rows.filter((r) => r.kind === 'person');
  assert.equal(b2.foot[0].load, shown.reduce((s, r) => s + r.cells[0].load, 0), 'the sum of the person rows');
  assert.equal(b2.inTeamOf('u1', 't2'), true);
});
