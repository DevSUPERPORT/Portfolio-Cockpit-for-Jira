// People split across teams (UC-14) in the remaining places: support reserve override, plan snapshot and the
// Plan vs. Ist split, the Planungs-Check member list, the "sum only" rows – and the waterline sentences.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSupportOverrides, computeAll, waterlineSentence } from '../shared/engine.js';
import { buildPayload, analyzePlanActual, splitOf } from '../shared/planActual.js';
import { computePlan, computeActuals, teamRecord } from '../src/lib/snapshot.js';
import { storyCheck } from '../shared/storyCheck.js';
import { buildBoard } from '../shared/weekPlan.js';
import { dayIdx } from '../shared/dates.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} ≠ ${b}`);
const SPLIT = { weeklyHours: 40, location: 'NONE', teamId: 't1', teams: [{ teamId: 't1', pct: 60 }, { teamId: 't2', pct: 40 }] };

// ---------- 3. support reserve override ----------
test('support override: a team\'s reserve goes to its members × their share there; one team stays as before', () => {
  const support = { teams: [{ teamId: 't1', weekly: 10 }, { teamId: 't2', weekly: 10 }], personWeekly: { u1: 10, u2: 5, u3: 5 }, reserveQuarter: { t1: 120, t2: 120 }, weeklyTotal: 20 };
  const people = { u1: SPLIT, u2: { weeklyHours: 40, teamId: 't1' }, u3: { weeklyHours: 40, teamId: 't2' } };
  // override t2 (measured there: u1 10 × 40 % = 4 + u3 5 = 9) to 18 h → everything in t2 doubles
  const r = withSupportOverrides(support, { people, teams: { t2: { supportOverride: 18 } } });
  near(r.personWeekly.u1, 10 * 0.6 + 4 * 2, 'u1: t1 part stays 6 h, t2 part 4 h → 8 h');
  near(r.personWeekly.u3, 10, 'u3 only in t2: 5 h → 10 h');
  assert.equal(r.personWeekly.u2, 5, 'other teams untouched');
  near((r.personWeekly.u1 - 10 * 0.6) + r.personWeekly.u3, 18, 'the people of t2 carry exactly the override');
  assert.equal(r.reserveQuarter.t2, 18 * 12);
  // single-team people: exactly the old rule (measured × override ÷ team measured)
  const one = withSupportOverrides({ ...support, personWeekly: { u2: 5, u4: 15 } }, { people: { u2: { teamId: 't1' }, u4: { teamId: 't1' } }, teams: { t1: { supportOverride: 10 } } });
  assert.deepEqual([one.personWeekly.u2, one.personWeekly.u4], [2.5, 7.5]);
  // nothing measured: the override is shared by share (60 % and 100 % → 6/16 and 10/16)
  const zero = withSupportOverrides({ ...support, personWeekly: { x: 0 } }, { people: { u1: SPLIT, u2: { teamId: 't1' } }, teams: { t1: { supportOverride: 16 } } });
  near(zero.personWeekly.u1, 6); near(zero.personWeekly.u2, 10);
});

// ---------- 4. plan snapshot and the Plan vs. Ist split ----------
const story = (o) => ({ role: 'estimate', status: { name: 'x', cat: 'indeterminate' }, worklogs: [], links: [], fixVersionIds: [], quarters: [], ts: 0, re: 0, ...o });
function snapDs() {
  return {
    today: '2026-11-09', storyTotals: true, config: { levels: [], rules: { distribution: 'linear' } },
    portfolio: [{ ref: 'issue:1', rank: 1, name: 'ERP', key: 'ERP-1' }],
    teams: [{ id: 't1', name: 'Integration' }, { id: 't2', name: 'Web' }],
    people: { u1: { id: 'u1', name: 'Paul' }, u2: { id: 'u2', name: 'Sara' } },
    capacity: { defaultWeeklyHours: 40, people: { u1: SPLIT, u2: { weeklyHours: 40, location: 'NONE', teamId: 't2' } }, teams: { t1: { dailyBusinessPct: 0, internalPct: 0 }, t2: { dailyBusinessPct: 0, internalPct: 0 } }, absences: [] },
    issues: [story({ id: '11', key: 'ERP-11', rootRef: 'issue:1', oe: 20, start: '2026-11-09', due: '2026-11-13', assignee: { id: 'u1' }, team: { id: 't1' } })],
    supportComputed: { personWeekly: {} },
  };
}

test('snapshot: a split person keeps the main team and stores the shares; one team keeps the old record', () => {
  assert.deepEqual(teamRecord({ teamId: 't2' }), { t: 't2' });
  assert.deepEqual(teamRecord(SPLIT), { t: 't1', teams: [{ t: 't1', pct: 60 }, { t: 't2', pct: 40 }] });
  const ds = snapDs();
  const [a, b] = [dayIdx('2026-11-09'), dayIdx('2026-11-15')];
  const plan = computePlan(ds, a, b);
  assert.equal(plan.people.u1.t, 't1');
  assert.deepEqual(plan.people.u1.teams, [{ t: 't1', pct: 60 }, { t: 't2', pct: 40 }]);
  assert.equal(computePlan({ ...ds, issues: [{ ...ds.issues[0], assignee: { id: 'u2' } }] }, a, b).people.u2.teams, undefined, 'one team: no shares stored');
  const act = computeActuals(ds, [{ a: 'u1', i: '11', d: '2026-11-10', h: 10 }], a, b, plan);
  assert.deepEqual(act.people.u1.teams, plan.people.u1.teams);
});

const weekRec = (people, act) => ({
  plans: [{ week: '2026-W46', from: '2026-11-09', to: '2026-11-15', projects: { 'issue:1': { n: 'ERP', r: 1 } }, teams: { t1: 'Integration', t2: 'Web' }, names: { u1: 'Paul', u2: 'Sara' }, people }],
  acts: [{ week: '2026-W46', final: true, people: act }],
});
const PEOPLE = { u1: { t: 't1', teams: [{ t: 't1', pct: 60 }, { t: 't2', pct: 40 }], p: { 'issue:1': 20 } }, u2: { t: 't2', p: { 'issue:1': 10 } } };
const ACT = { u1: { t: 't1', teams: [{ t: 't1', pct: 60 }, { t: 't2', pct: 40 }], b: { 'issue:1': 10 } }, u2: { t: 't2', b: { 'issue:1': 10 } } };

test('Plan vs. Ist: a split person counts once over all teams and × share when a team is selected', () => {
  const data = buildPayload({ ...weekRec(PEOPLE, ACT), canSee: () => true });
  assert.deepEqual(data.teams.map((t) => t.id).sort(), ['t1', 't2']);
  const all = analyzePlanActual(data, { team: 'all' });
  assert.equal(all.kpis.plan, 30, 'all teams: never counted twice');
  const t1 = analyzePlanActual(data, { team: 't1' }), t2 = analyzePlanActual(data, { team: 't2' });
  near(t1.kpis.plan, 12); near(t2.kpis.plan, 8 + 10);
  near(t1.kpis.plan + t2.kpis.plan, all.kpis.plan, 'the team views add up to all teams');
  near(t2.people.find((p) => p.id === 'u1').plan, 8);
  assert.equal(t2.people.find((p) => p.id === 'u1').teamName, 'Web');
  // one team per person: exactly as before
  assert.deepEqual(splitOf({ teamId: 't2' }), [{ t: 't2', s: 1 }]);
  assert.deepEqual(splitOf({ teamId: 't1', teams: [{ t: 't1', pct: 50 }, { t: 't2', pct: 30 }] }), [{ t: 't1', s: 0.7 }, { t: 't2', s: 0.3 }], 'an unassigned share stays with the main team');
});

// ---------- 6. "sum only" rows ----------
test('sum-only rows: a hidden split person adds to each team × share', () => {
  const data = buildPayload({ ...weekRec(PEOPLE, ACT), canSee: () => false });
  const sum = (t) => data.units.find((u) => u.id === `team:${t}`);
  assert.equal(sum('t1').plan['issue:1'], 12);
  assert.equal(sum('t2').plan['issue:1'], 18, '8 h from Paul + 10 h from Sara');
  assert.equal(sum('t2').book['issue:1'], 14);
  assert.deepEqual([sum('t1').n, sum('t2').n], [1, 2]);
  const t2 = analyzePlanActual(data, { team: 't2' });
  assert.equal(t2.kpis.plan, 18, 'sum rows are split already – not scaled twice');
  assert.equal(analyzePlanActual(data, { team: 'all' }).kpis.plan, 30);
});

test('weekly board: the hidden sum row shows whole weeks, like a person row – the Summe adds the rows up', () => {
  const ds = {
    today: '2026-11-11', config: {}, portfolio: [{ ref: 'issue:1', rank: 1, kind: 'issue', id: '1', key: 'P-1', name: 'Alpha', statusCat: 'indeterminate' }],
    teams: [{ id: 't1', name: 'Web' }, { id: 't2', name: 'Data' }], people: {},
    capacity: { people: { 'anon-a': { ...SPLIT }, 'anon-b': { weeklyHours: 40, location: 'NONE', teamId: 't2' } }, absences: [], teams: { t1: { dailyBusinessPct: 0, internalPct: 0, absenceRatePct: 0 }, t2: { dailyBusinessPct: 0, internalPct: 0, absenceRatePct: 0 } } },
    supportComputed: { personWeekly: {}, teams: [], services: [], reserveQuarter: {} }, issues: [], personLevel: false,
  };
  const computed = computeAll(ds);
  const b = buildBoard({ ds, computed, team: 't2' });
  const h = b.rows.find((r) => r.kind === 'hidden');
  assert.ok(h, 'one sum row');
  // 2026-11-23 (boss: "the sum … is not correct, or?"): the split person counts with their whole week, as with a name
  near(h.cells[1].avail, 40 + 40, 'the split person\'s 40 h + 40 h');
  near(b.foot[1].time, 80, 'the sum row = the rows above');
});

// ---------- 5. Planungs-Check ----------
test('Planungs-Check: "Personen im Team" lists everyone with a share, "(40 %)" when part-time there', () => {
  const ds = snapDs();
  ds.today = '2026-11-10';
  ds.issues.push(story({ id: '12', key: 'ERP-12', summary: 'Web', rootRef: 'issue:1', oe: 8, start: '2026-11-16', due: '2026-11-20', assignee: { id: 'u1' }, team: { id: 't2', name: 'Web' } }));
  const r = storyCheck(computeAll(ds), '12', { lang: 'de' });
  const row = r.team.rows.find(([k]) => /^Personen im Team/.test(k));
  assert.equal(row[1], 'Paul (40 %), Sara');
  assert.ok(!r.team.notes.some((n) => n.key === 'teamMismatch'), 'Paul works 40 % in Web: no mismatch');
  assert.ok(r.team.notes.some((n) => n.tone === 'ok' && /Paul gehört zu 40 % zum Team Web/.test(n.text)));
  const en = storyCheck(computeAll(ds), '11', { lang: 'en' });
  assert.equal(en.team.rows.find(([k]) => /^People in team/.test(k))[1], 'Paul (60 %)');
});

// ---------- 7. waterline sentences ----------
const model = { itemByRef: new Map([['a', { name: 'Alpha' }], ['b', { name: 'Beta' }], ['c', { name: 'Gamma' }]]) };
const cell = (rows, capacity = 100, support = 0) => {
  const demand = support + rows.reduce((x, r) => x + r.demand, 0);
  return { capacity, support, util: capacity > 0 ? demand / capacity : 0, rows: [{ kind: 'support', demand: support }, ...rows.map((r) => ({ kind: 'project', ...r }))] };
};
test('waterline sentence: bottleneck at rank 1, one project, no projects, singular and plural hours', () => {
  const first = cell([{ ref: 'a', rank: 1, demand: 130, cum: 130, status: 'partial' }]);
  assert.equal(waterlineSentence(first, model, 'de'), 'Schon Rang 1 (Alpha) ist nicht voll besetzbar – es fehlen 30 h.');
  assert.equal(waterlineSentence(first, model, 'en'), 'Already rank 1 (Alpha) cannot be fully staffed – 30 h are missing.');
  const one = cell([{ ref: 'a', rank: 1, demand: 50, cum: 50, status: 'ok' }]);
  assert.equal(waterlineSentence(one, model, 'de'), 'Das Projekt ist voll besetzbar; Auslastung 50 %.');
  assert.equal(waterlineSentence(one, model, 'en'), 'The project can be fully staffed; utilization 50 %.');
  const none = cell([]);
  assert.equal(waterlineSentence(none, model, 'de'), 'Kein Projektbedarf in diesem Quartal.');
  assert.equal(waterlineSentence(none, model, 'en'), 'No project demand this quarter.');
  assert.match(waterlineSentence(cell([], 10, 15), model, 'de'), /^Kein Projektbedarf in diesem Quartal; schon die Support-Reserve übersteigt die Kapazität um 5 h\.$/);
  const two = cell([{ ref: 'a', rank: 1, demand: 40, cum: 40, status: 'ok' }, { ref: 'b', rank: 2, demand: 30, cum: 70, status: 'ok' }]);
  assert.equal(waterlineSentence(two, model, 'de'), 'Alle 2 Projekte sind besetzbar; Auslastung 70 %.');
  assert.equal(waterlineSentence(two, model, 'en'), 'All 2 projects can be staffed; utilization 70 %.');
  const later = cell([{ ref: 'a', rank: 1, demand: 60, cum: 60, status: 'ok' }, { ref: 'b', rank: 2, demand: 30, cum: 90, status: 'ok' }, { ref: 'c', rank: 3, demand: 11, cum: 101, status: 'partial' }]);
  assert.equal(waterlineSentence(later, model, 'de'), 'Bis Rang 2 ist alles besetzbar; ab Rang 3 (Gamma) fehlt 1 h.');
  assert.equal(waterlineSentence(later, model, 'en'), 'Everything up to rank 2 can be staffed; from rank 3 (Gamma) 1 h is missing.');
  // the first project of this team has rank 4 (ranks 1–3 need nothing here): still "already"
  const firstHere = cell([{ ref: 'c', rank: 4, demand: 120.2, cum: 120.2, status: 'partial' }]);
  assert.equal(waterlineSentence(firstHere, model, 'de'), 'Schon Rang 4 (Gamma) ist nicht voll besetzbar – es fehlen 20 h.');
  // a tiny gap is never "0 h"
  assert.match(waterlineSentence(cell([{ ref: 'a', rank: 1, demand: 100.2, cum: 100.2, status: 'partial' }]), model, 'de'), /es fehlt 1 h\.$/);
  assert.equal(waterlineSentence(null, model), '');
});
