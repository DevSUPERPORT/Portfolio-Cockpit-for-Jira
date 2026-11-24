// Wochenplanung › Optimieren: shorten tasks where the person still has room – rank order, target, dependencies,
// privacy, pending moves, location working days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAll } from '../shared/engine.js';
import { buildBoard, conflicts, moveTask } from '../shared/weekPlan.js';
import { optimizePlan, optimizeAll, suggestionMoves, suggestionsFor, weeksTouched, lastWorkday, planHorizon, createOptStore, HORIZON_MAX } from '../shared/optimize.js';
import { dayIdx } from '../shared/dates.js';
import { capacityFill, planTasks, planWeeks, waterFill, undoMoveOf, validateEvenPayload } from '../shared/weekPlan.js';
import { getEven, setEven } from '../src/lib/planEven.js';
import { computePlan } from '../src/lib/snapshot.js';

const st = { name: 'Offen', cat: 'new' };
const story = (o) => ({ role: 'estimate', status: st, links: [], worklogs: [], parentId: o.rootRef.slice(6), team: { id: 't1' }, ...o });
const dev = { id: 'u1', name: 'Dev Team' };
// Today is Wednesday 11 Nov 2026; week 0 starts Monday 9 Nov. PCX-1: 40 h over 7 weeks (9 Nov – 25 Dec) = 5.7 h a week.
// Dev Team: 40 h, no daily business, 5 h support, another task with 24.5 h a week → 10.5 h free next to PCX-1.
function fixture() {
  return {
    today: '2026-11-11',
    config: { dependencies: { linkTypeIds: ['10000'] } },
    portfolio: [
      { ref: 'issue:1', rank: 1, kind: 'issue', id: '1', key: 'PCR-1', name: 'Partnerportal', statusCat: 'indeterminate' },
      { ref: 'issue:2', rank: 2, kind: 'issue', id: '2', key: 'PCR-2', name: 'ERP', statusCat: 'indeterminate' },
    ],
    teams: [{ id: 't1', name: 'Web' }, { id: 't2', name: 'Data' }],
    people: { u1: { name: 'Dev Team' }, u2: { name: 'Ben' } },
    capacity: {
      people: { u1: { weeklyHours: 40, location: 'NONE', teamId: 't1' }, u2: { weeklyHours: 40, location: 'NONE', teamId: 't1' } },
      absences: [],
      teams: { t1: { dailyBusinessPct: 0, internalPct: 0 }, t2: { dailyBusinessPct: 0, internalPct: 0 } },
    },
    supportComputed: { personWeekly: { u1: 5 }, teams: [], services: [], reserveQuarter: {} },
    issues: [
      story({ id: '201', key: 'PCX-1', summary: 'Schnittstelle Partner-Login', assignee: dev, oe: 40, re: 40, start: '2026-11-09', due: '2026-12-25', rootRef: 'issue:1' }),
      story({ id: '202', key: 'ERP-1', summary: 'Buchungen', team: { id: 't2' }, assignee: dev, oe: 171.5, re: 171.5, start: '2026-11-09', due: '2026-12-25', rootRef: 'issue:2' }),
    ],
  };
}
const setup = (mut) => { const ds = fixture(); mut?.(ds); return { ds, computed: computeAll(ds) }; };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg || ''} ${a} ≈ ${b}`);

test('helpers: weeks a window spreads over, last working day of a week by location', () => {
  assert.equal(weeksTouched([dayIdx('2026-11-09'), dayIdx('2026-12-25')]), 7);
  assert.equal(weeksTouched([dayIdx('2026-11-11'), dayIdx('2026-11-17')]), 2);
  const mon = dayIdx('2026-11-30');
  assert.equal(lastWorkday({}, 'NONE', mon), dayIdx('2026-12-04'));
  const cfg = { locations: [{ id: 'hh', name: 'HH', calendar: 'NONE', workdays: [1, 2, 3, 4], off: [], own: [{ d: '2026-12-03', name: 'Betriebsausflug' }] }] };
  assert.equal(lastWorkday(cfg, 'hh', mon), dayIdx('2026-12-02'), 'Mon–Thu, Thursday off → Wednesday');
});

test('PCX-1: 7 weeks of 5.7 h with ~10 h free per week → 4 weeks, due on the Friday of week 4', () => {
  const { ds, computed } = setup();
  const r = optimizePlan({ ds, computed, team: 't1' });
  assert.equal(r.suggestions.length, 1);
  const s = r.suggestions[0];
  assert.equal(s.key, 'PCX-1');
  assert.deepEqual([s.fromWeeks, s.toWeeks, s.weeksSaved], [7, 4, 3]);
  assert.equal(s.start, '2026-11-09', 'start kept');
  assert.equal(s.newDue, '2026-12-04');
  assert.equal(s.personName, 'Dev Team');
  assert.equal(s.before.length, 7);
  near(s.before[0], 40 / 7);
  assert.deepEqual(s.after.map((h) => Math.round(h * 10) / 10), [10, 10, 10, 10, 0, 0, 0]);
  assert.match(s.reason.de, /40 h ÷ 4 Wochen = 10 h/);
  assert.deepEqual(r.summary, { tasks: 1, weeksSaved: 3, people: 1, considered: 1, skipped: { pending: 0, hidden: 0, unassigned: 0 } });
  // ERP-1 (other team) is not in the t1 board's scope; all teams sees both but ERP-1 cannot be shortened
  const all = optimizePlan({ ds, computed });
  assert.deepEqual(all.suggestions.map((x) => x.key), ['PCX-1']);
  assert.equal(all.summary.considered, 2);
  // the project board finds the same; another project nothing
  assert.equal(optimizePlan({ ds, computed, project: 'issue:1' }).suggestions[0]?.newDue, '2026-12-04');
  assert.equal(optimizePlan({ ds, computed, project: 'issue:2' }).suggestions.length, 0);
  // board scope works as well
  const b = buildBoard({ ds, computed, team: 't1' });
  assert.equal(optimizePlan({ ds, computed, board: b }).suggestions.length, 1);
});

test('accepted suggestions become normal pending moves – never over the target', () => {
  const { ds, computed } = setup();
  const r = optimizePlan({ ds, computed, team: 't1' });
  const moves = suggestionMoves({}, ds.issues, r.suggestions);
  assert.deepEqual(Object.keys(moves), ['201']);
  assert.equal(moves['201'].start, '2026-11-09');
  assert.equal(moves['201'].due, '2026-12-04');
  assert.equal(moves['201'].orig.due, '2026-12-25');
  const b = buildBoard({ ds, computed, team: 't1', moves });
  const row = b.rows.find((x) => x.id === 'p:u1');
  for (const c of row.cells) assert.ok(c.util <= 1 + 1e-9, `week ${c.week}: ${c.util}`);
  const card = row.cells[0].cards.find((c) => c.key === 'PCX-1');
  assert.deepEqual([card.len, card.pending], [4, true]);
  // with the suggestion pending, the optimizer skips the task (only effective dates count)
  const again = optimizePlan({ ds, computed, team: 't1', moves });
  assert.equal(again.suggestions.length, 0);
  assert.equal(again.summary.skipped.pending, 1);
});

test('target 85 %: the same person has no room – nothing to suggest', () => {
  const { ds, computed } = setup();
  const r = optimizePlan({ ds, computed, team: 't1', target: 0.85 });
  assert.equal(r.suggestions.length, 0);
  assert.equal(r.summary.considered, 1);
  // with less other work the 85 % target still allows a shorter plan, and stays within it
  const { ds: ds2, computed: c2 } = setup((d) => { d.issues[1].oe = 140; }); // 20 h a week
  const r2 = optimizePlan({ ds: ds2, computed: c2, team: 't1', target: 0.85 });
  const s = r2.suggestions[0];
  assert.ok(s, 'a suggestion at 85 %');
  for (let i = 0; i < s.after.length; i++) if (s.after[i] > s.before[i]) assert.ok(s.after[i] <= s.free[i] + 1e-6);
  const b = buildBoard({ ds: ds2, computed: c2, team: 't1', moves: suggestionMoves({}, ds2.issues, r2.suggestions) });
  for (const c of b.rows.find((x) => x.id === 'p:u1').cells) assert.ok(c.util <= 0.85 + 1e-9, `week ${c.week}: ${c.util}`);
});

test('no free capacity: nothing to suggest', () => {
  const { ds, computed } = setup((d) => { d.issues[1].oe = 7 * 29.5 + 50; });
  const r = optimizePlan({ ds, computed });
  assert.equal(r.suggestions.length, 0);
});

test('capacity is consumed in portfolio rank order', () => {
  // support 10 h; A (rank 1) 30 h and B (rank 2) 33 h, both over weeks 0–2 → A takes the room, B gets nothing
  const mk = (rankA) => setup((d) => {
    d.supportComputed.personWeekly.u1 = 10;
    d.portfolio[0].rank = rankA; d.portfolio[1].rank = 3 - rankA;
    d.issues = [
      story({ id: '301', key: 'A-1', summary: 'A', assignee: dev, oe: 30, re: 30, start: '2026-11-09', due: '2026-11-27', rootRef: 'issue:1' }),
      story({ id: '302', key: 'B-1', summary: 'B', assignee: dev, oe: 33, re: 33, start: '2026-11-09', due: '2026-11-27', rootRef: 'issue:2' }),
    ];
  });
  const one = mk(1);
  const r1 = optimizePlan({ ...one, team: 't1' });
  assert.deepEqual(r1.suggestions.map((s) => [s.key, s.toWeeks]), [['A-1', 2]]);
  const two = mk(2);
  const r2 = optimizePlan({ ...two, team: 't1' });
  assert.deepEqual(r2.suggestions.map((s) => [s.key, s.toWeeks]), [['B-1', 2]], 'B ranks first now and takes the room');
});

test('dependencies: no conflict is introduced; shortening a prerequisite resolves one (and says so)', () => {
  // PCX-1 blocks PCX-2 (Ben), which starts Mon 30 Nov – before PCX-1's due date → conflict today
  const { ds, computed } = setup((d) => {
    d.issues[0].links = [{ id: 'L1', typeId: '10000', outward: true, otherId: '203', verb: 'blocks' }];
    d.issues.push(story({ id: '203', key: 'PCX-2', summary: 'Login UI', assignee: { id: 'u2', name: 'Ben' }, oe: 8, re: 8, start: '2026-11-30', due: '2026-12-04', rootRef: 'issue:1', links: [{ id: 'L1', typeId: '10000', outward: false, otherId: '201', verb: 'blocks' }] }));
  });
  const before = conflicts({ model: computed.model });
  assert.equal(before.length, 1);
  const r = optimizePlan({ ds, computed, team: 't1' });
  const s = r.suggestions.find((x) => x.key === 'PCX-1');
  assert.equal(s.newDue, '2026-12-04');
  const after = conflicts({ model: computed.model, moves: suggestionMoves({}, ds.issues, r.suggestions) });
  const ids = new Set(before.map((c) => c.id));
  assert.ok(after.every((c) => ids.has(c.id)), 'no new conflict');
  // 4 weeks end on 4 Dec, still after 30 Nov: not resolved yet. With room for 3 weeks it is.
  const { ds: ds2, computed: c2 } = setup((d) => {
    d.issues[1].oe = 7 * 20; // 20 h a week other work → 15 h free next to PCX-1
    d.issues[0].links = [{ id: 'L1', typeId: '10000', outward: true, otherId: '203', verb: 'blocks' }];
    d.issues.push(story({ id: '203', key: 'PCX-2', summary: 'Login UI', assignee: { id: 'u2', name: 'Ben' }, oe: 8, re: 8, start: '2026-11-30', due: '2026-12-04', rootRef: 'issue:1', links: [{ id: 'L1', typeId: '10000', outward: false, otherId: '201', verb: 'blocks' }] }));
  });
  const r2 = optimizePlan({ ds: ds2, computed: c2, team: 't1' });
  const s2 = r2.suggestions.find((x) => x.key === 'PCX-1');
  assert.equal(s2.newDue, '2026-11-27');
  assert.deepEqual(s2.resolves, ['PCX-2']);
  assert.match(s2.reason.de, /Konflikt mit PCX-2/);
  assert.equal(conflicts({ model: c2.model, moves: suggestionMoves({}, ds2.issues, r2.suggestions) }).length, 0);
});

test('skips pseudonymised people, unassigned, done and pending tasks', () => {
  const { ds, computed } = setup((d) => {
    d.issues.push(story({ id: '204', key: 'PCX-3', summary: 'Anon', assignee: { id: 'anon-7', name: '', anon: true }, oe: 40, re: 40, start: '2026-11-09', due: '2026-12-25', rootRef: 'issue:1' }));
    d.issues.push(story({ id: '205', key: 'PCX-4', summary: 'Nobody', assignee: null, oe: 40, re: 40, start: '2026-11-09', due: '2026-12-25', rootRef: 'issue:1' }));
    d.issues.push(story({ id: '206', key: 'PCX-5', summary: 'Done', assignee: { id: 'u2', name: 'Ben' }, oe: 40, re: 0, start: '2026-11-09', due: '2026-12-25', rootRef: 'issue:1', status: { name: 'Fertig', cat: 'done' } }));
  });
  const r = optimizePlan({ ds, computed, team: 't1' });
  assert.deepEqual(r.suggestions.map((s) => s.key), ['PCX-1']);
  assert.equal(r.summary.skipped.hidden, 1);
  assert.equal(r.summary.skipped.unassigned, 1);
  // a manual move on PCX-1 (one week later): the optimizer leaves it alone
  const moves = moveTask({}, ds.issues[0], { weeks: 1 });
  const r2 = optimizePlan({ ds, computed, team: 't1', moves });
  assert.equal(r2.suggestions.length, 0);
  assert.equal(r2.summary.skipped.pending, 1);
});

test('location working days: Monday–Thursday → new due on Thursday', () => {
  const { ds, computed } = setup((d) => {
    d.config.locations = [{ id: 'hh', name: 'Hamburg', calendar: 'NONE', workdays: [1, 2, 3, 4], off: [], own: [] }];
    d.capacity.people.u1.location = 'hh';
  });
  const r = optimizePlan({ ds, computed, team: 't1' });
  assert.equal(r.suggestions[0]?.newDue, '2026-12-03');
  assert.equal(r.suggestions[0].toWeeks, 4);
});

test('moveTask sets a due date directly and keeps the start', () => {
  const { ds } = setup();
  const m = moveTask({}, ds.issues[0], { due: '2026-12-04' });
  assert.deepEqual([m['201'].start, m['201'].due, m['201'].orig.due], ['2026-11-09', '2026-12-04', '2026-12-25']);
  assert.deepEqual(moveTask(m, ds.issues[0], { due: '2026-12-25' }), {}, 'back to the original disappears');
});

// ---------- finish sooner: the start may come forward ----------
const ben = { id: 'u2', name: 'Ben' };
test('finish sooner: the start comes forward – but never before a prerequisite is due', () => {
  const add = (d, linked) => {
    d.issues.push(story({ id: '211', key: 'LAT-1', summary: 'Later', assignee: ben, oe: 30, re: 30, start: '2026-11-30', due: '2026-12-18', rootRef: 'issue:1',
      links: linked ? [{ id: 'L9', typeId: '10000', outward: false, otherId: '210', verb: 'blocks' }] : [] }));
    if (linked) d.issues.push(story({ id: '210', key: 'PRE-1', summary: 'Prerequisite', assignee: null, oe: 4, re: 4, start: '2026-11-16', due: '2026-11-18', rootRef: 'issue:1', links: [{ id: 'L9', typeId: '10000', outward: true, otherId: '211', verb: 'blocks' }] }));
  };
  const free = setup((d) => add(d, false));
  const s1 = optimizePlan({ ...free, team: 't1' }).suggestions.find((s) => s.key === 'LAT-1');
  assert.deepEqual([s1.newStart, s1.newDue, s1.startMoved, s1.weeksSaved], ['2026-11-11', '2026-11-13', true, 5], 'from today, all in this week');
  assert.deepEqual(s1.move, { start: '2026-11-11', due: '2026-11-13' });
  const linked = setup((d) => add(d, true));
  const s2 = optimizePlan({ ...linked, team: 't1' }).suggestions.find((s) => s.key === 'LAT-1');
  assert.deepEqual([s2.newStart, s2.newDue, s2.weeksSaved], ['2026-11-23', '2026-11-27', 3], 'not before PRE-1 is due (18 Nov)');
  const before = conflicts({ model: linked.computed.model }).length;
  const all = optimizeAll({ ...linked, team: 't1' });
  assert.equal(conflicts({ model: linked.computed.model, moves: suggestionMoves({}, linked.ds.issues, all.sooner.suggestions) }).length, before);
});

// ---------- smooth overload ----------
// Ben: A (rank 1) 30 h and B (rank 2) 20 h a week in weeks 0–1 → 50 of 40 h.
const overloaded = (mut) => setup((d) => {
  d.issues.push(story({ id: '221', key: 'A-1', summary: 'A', assignee: ben, oe: 60, re: 60, start: '2026-11-09', due: '2026-11-20', rootRef: 'issue:1' }));
  d.issues.push(story({ id: '222', key: 'B-1', summary: 'B', assignee: ben, oe: 40, re: 40, start: '2026-11-09', due: '2026-11-20', rootRef: 'issue:2' }));
  mut?.(d);
});
test('smooth overload: the lower-ranked task is stretched until every week fits', () => {
  const { ds, computed } = overloaded();
  const r = optimizeAll({ ds, computed, team: 't1' });
  assert.equal(r.overloaded, 1);
  const s = r.smooth.suggestions;
  assert.deepEqual(s.map((x) => [x.key, x.kind, x.newStart, x.newDue, x.fromWeeks, x.toWeeks]), [['B-1', 'stretch', '2026-11-09', '2026-12-04', 2, 4]]);
  assert.deepEqual(s[0].fixed, ['2026-11-09', '2026-11-16'], 'says which weeks become OK');
  assert.match(s[0].reason.de, /KW 46, 47/);
  assert.deepEqual(s[0].move, { due: '2026-12-04' });
  const b = buildBoard({ ds, computed, team: 't1', moves: suggestionMoves({}, ds.issues, s) });
  for (const c of b.rows.find((x) => x.id === 'p:u2').cells) assert.ok(c.util <= 1 + 1e-9, `week ${c.week}: ${c.util}`);
  assert.equal(r.rebalance.count, 0, 'nothing left to hand over');
  assert.equal(suggestionsFor(r, '222')[0].mode, 'smooth');
});
test('smooth overload: never past the project due date – and says so', () => {
  const { ds, computed } = overloaded((d) => { d.portfolio[0].due = '2026-11-20'; d.portfolio[1].due = '2026-11-27'; });
  const r = optimizeAll({ ds, computed, team: 't1' });
  assert.equal(r.smooth.count, 0);
  assert.equal(r.smooth.notes.length, 1);
  const n = r.smooth.notes[0];
  assert.deepEqual([n.key, n.why, n.limit.iso], ['B-1', 'limit', '2026-11-27']);
  assert.match(n.reason.de, /Ben bleibt in KW 46, 47 über 100 %.*Projekt-Due 27\.11\./);
});
test('smooth overload: never into a blocks conflict – the next task moves instead', () => {
  const { ds, computed } = overloaded((d) => {
    d.issues.find((i) => i.id === '222').links = [{ id: 'L7', typeId: '10000', outward: true, otherId: '223', verb: 'blocks' }];
    d.issues.push(story({ id: '223', key: 'C-1', summary: 'C', assignee: null, oe: 8, re: 8, start: '2026-11-23', due: '2026-11-27', rootRef: 'issue:2', links: [{ id: 'L7', typeId: '10000', outward: false, otherId: '222', verb: 'blocks' }] }));
  });
  const r = optimizeAll({ ds, computed, team: 't1' });
  assert.deepEqual(r.smooth.suggestions.map((x) => x.key), ['A-1']);
  const before = conflicts({ model: computed.model }).length;
  assert.equal(conflicts({ model: computed.model, moves: suggestionMoves({}, ds.issues, r.smooth.suggestions) }).length, before);
});

// ---------- rebalance ----------
test('rebalance: to a visible colleague in the same team with room, lowest load first', () => {
  const { ds, computed } = overloaded((d) => {
    d.portfolio[0].due = '2026-11-20'; d.portfolio[1].due = '2026-11-27'; // smoothing cannot help
    Object.assign(d.people, { u3: { name: 'Cleo' }, u5: { name: 'Eva' }, u6: { name: 'Finn' } });
    Object.assign(d.capacity.people, {
      u3: { weeklyHours: 40, location: 'NONE', teamId: 't2' }, // other team
      'anon-9': { weeklyHours: 40, location: 'NONE', teamId: 't1' }, // not visible
      u5: { weeklyHours: 40, location: 'NONE', teamId: 't1' },
      u6: { weeklyHours: 40, location: 'NONE', teamId: 't1' },
    });
    d.issues.push(story({ id: '230', key: 'F-1', summary: 'Finn', assignee: { id: 'u6', name: 'Finn' }, oe: 20, re: 20, start: '2026-11-09', due: '2026-11-20', rootRef: 'issue:1' }));
  });
  const r = optimizeAll({ ds, computed, team: 't1' });
  const s = r.rebalance.suggestions;
  assert.deepEqual(s.map((x) => [x.key, x.personId, x.toPersonId]), [['B-1', 'u2', 'u5']], 'Eva (empty) before Finn; never Cleo or the pseudonymised person');
  assert.deepEqual(s[0].fromLoad.map((x) => Math.round(x * 100)), [125, 75]);
  assert.deepEqual(s[0].toLoad.map((x) => Math.round(x * 100)), [0, 50]);
  assert.deepEqual(s[0].fixed, ['2026-11-09', '2026-11-16']);
  assert.deepEqual(s[0].move, { assignee: 'u5', assigneeName: 'Eva' });
  const mv = suggestionMoves({}, ds.issues, s);
  assert.equal(mv['222'].assignee, 'u5');
  const b = buildBoard({ ds, computed, team: 't1', moves: mv });
  for (const id of ['p:u2', 'p:u5']) for (const c of b.rows.find((x) => x.id === id).cells) assert.ok(c.util <= 1 + 1e-9);
  // nobody with room in the team → nothing
  const { ds: ds2, computed: c2 } = overloaded((d) => { d.portfolio[0].due = '2026-11-20'; d.portfolio[1].due = '2026-11-27'; });
  assert.equal(optimizeAll({ ds: ds2, computed: c2, team: 't1' }).rebalance.count, 0, 'Dev Team (t1) has no 20 h free');
});

// ---------- horizon, state ----------
test('horizon: the latest open due date + 8 weeks, at most 104', () => {
  assert.equal(planHorizon([], '2026-11-11'), 9);
  assert.equal(planHorizon([{ role: 'estimate', status: st, due: '2026-12-25' }], '2026-11-11'), 15);
  assert.equal(planHorizon([{ role: 'estimate', status: st, due: '2030-01-01' }], '2026-11-11'), HORIZON_MAX);
  assert.equal(planHorizon([{ role: 'estimate', status: { cat: 'done' }, due: '2030-01-01' }], '2026-11-11'), 9, 'done work does not count');
  // a task due in 45 weeks is still optimised (no fixed 26 weeks)
  const { ds, computed } = setup((d) => d.issues.push(story({ id: '240', key: 'FAR-1', summary: 'Far', assignee: ben, oe: 40, re: 40, start: '2026-11-09', due: '2027-09-24', rootRef: 'issue:2' })));
  const r = optimizeAll({ ds, computed, team: 't1' });
  assert.ok(r.horizon >= 46);
  assert.equal(r.sooner.suggestions.find((s) => s.key === 'FAR-1')?.newDue, '2026-11-13');
});
test('panel state survives a board switch (module store)', () => {
  const store = createOptStore();
  let calls = 0;
  const off = store.subscribe(() => { calls++; });
  store.set({ open: true, mode: 'smooth', target: 0.85 });
  store.toggleRow('smooth:222');
  off(); // the team board unmounts …
  const next = store.get(); // … and the next one reads the same state
  assert.deepEqual([next.open, next.mode, next.target, next.off], [true, 'smooth', 0.85, { 'smooth:222': true }]);
  store.toggleRow('smooth:222');
  assert.deepEqual(store.get().off, {});
  assert.equal(calls, 2);
});
test('every task appears in one mode only; pending tasks drop out', () => {
  const { ds, computed } = overloaded();
  const r = optimizeAll({ ds, computed });
  const ids = ['sooner', 'smooth', 'rebalance'].flatMap((m) => r[m].suggestions.map((s) => s.taskId));
  assert.equal(new Set(ids).size, ids.length);
  const mv = suggestionMoves({}, ds.issues, r.smooth.suggestions);
  const again = optimizeAll({ ds, computed, moves: mv });
  assert.ok(!['sooner', 'smooth', 'rebalance'].some((m) => again[m].suggestions.some((s) => s.taskId === '222')));
});

// ---------- distribution by free capacity (boss feedback 2026-11-11) ----------
// Hours stay inside start..due (dates never change) and go where the person has room, in proportion to it.
// Dev Team (15 h a week, 5 h support): 10 h free in W46/W47/W49, away in W48 and W50 (no room).
// PCX-1 (rank 2): 40 h from Mon 26 Oct (W44) to Fri 11 Dec (W50) = 7 weeks × 5.7 h when spread evenly.
const boss = (mut) => setup((d) => {
  d.portfolio.push({ ref: 'issue:3', rank: 3, kind: 'issue', id: '3', key: 'PCR-3', name: 'Später', statusCat: 'indeterminate' });
  d.capacity.people.u1.weeklyHours = 15;
  d.capacity.absences = [{ accountId: 'u1', from: '2026-11-23', to: '2026-11-27' }, { accountId: 'u1', from: '2026-12-07', to: '2026-12-11' }];
  d.issues = [
    story({ id: '201', key: 'PCX-1', summary: 'Schnittstelle Partner-Login', assignee: dev, oe: 40, re: 40, start: '2026-10-26', due: '2026-12-11', rootRef: 'issue:2' }),
  ];
  mut?.(d);
});
const personRow = (b) => b.rows.find((x) => x.id === 'p:u1');
const hoursOf = (b, key) => personRow(b).cells.map((c) => Math.round((c.cards.find((k) => k.key === key)?.hours || 0) * 100) / 100);
const r2 = (x) => Math.round(x * 100) / 100;

// The boss's numbers: PCX-1 32 h over W46–W49, free room 16 / 16 / 5 / 15 h → even would be 8 / 8 / 8 / 8;
// "as even as possible, capped at the room": W48 gets its 5 h, the other 3 h go evenly to W46, W47, W49 → 9 / 9 / 5 / 9.
const boss2 = (mut) => setup((d) => {
  d.capacity.people.u1.weeklyHours = 21; // 21 h − 5 h support = 16 h free
  d.issues = [
    story({ id: '311', key: 'X-1', summary: 'Higher, W48', assignee: dev, oe: 11, re: 11, start: '2026-11-23', due: '2026-11-27', rootRef: 'issue:1' }),
    story({ id: '312', key: 'Z-1', summary: 'Higher, W49', assignee: dev, oe: 1, re: 1, start: '2026-11-30', due: '2026-12-04', rootRef: 'issue:1' }),
    story({ id: '201', key: 'PCX-1', summary: 'Schnittstelle Partner-Login', assignee: dev, oe: 32, re: 32, start: '2026-11-09', due: '2026-12-04', rootRef: 'issue:2' }),
  ];
  mut?.(d);
});

test('capacity distribution – boss case: 32 h, room 16/16/5/15 → 9/9/5/9, sum 32, nothing above 100 %, dates unchanged', () => {
  const { ds, computed } = boss2();
  const even = buildBoard({ ds, computed, team: 't1' });
  assert.deepEqual(hoursOf(even, 'PCX-1').slice(0, 4), [8, 8, 8, 8], 'even: 8 h each');
  assert.ok(personRow(even).cells[2].util > 1, 'even: W48 above 100 %');
  const cap = buildBoard({ ds, computed, team: 't1', distribution: 'capacity' });
  assert.deepEqual(hoursOf(cap, 'PCX-1').slice(0, 4), [9, 9, 5, 9]);
  for (const c of personRow(cap).cells) assert.ok(c.util <= 1 + 1e-9, `week ${c.week}: ${c.util}`);
  assert.equal(r2(personRow(cap).cells[2].util), 1, 'W48 filled to exactly 100 %');
  const t = cap.taskById.get('201');
  near(t.hours.reduce((a, h) => a + h, 0), 32, 'sum = OE');
  assert.deepEqual([t.start, t.due], ['2026-11-09', '2026-12-04'], 'dates unchanged');
  const card = personRow(cap).cells[0].cards.find((k) => k.key === 'PCX-1');
  assert.deepEqual([card.byCapacity, card.forcedEven, card.finish.early], [true, false, 0], 'marker on, no early flag');
  assert.deepEqual(cap.capTasks.map((x) => x.key), ['PCX-1'], 'the plan log lists it');
});

test('capacity distribution: the reasoning numbers are the board numbers', () => {
  const { ds, computed } = boss2();
  const cap = buildBoard({ ds, computed, team: 't1', distribution: 'capacity' });
  const why = cap.taskById.get('201').fill.why;
  assert.deepEqual([why.start, why.due, why.touched, why.past, why.rest, why.evenShare], ['2026-11-09', '2026-12-04', 4, 0, 32, 8]);
  assert.deepEqual(why.weeks.map((w) => [w.week, r2(w.room), r2(w.hours)]), [['2026-11-09', 16, 9], ['2026-11-16', 16, 9], ['2026-11-23', 5, 5], ['2026-11-30', 15, 9]]);
  assert.deepEqual(why.weeks[2].taken, [{ key: 'X-1', h: 11 }], 'names the higher-ranked task that took the room');
  assert.deepEqual(why.weeks.map((w) => [r2(w.avail), r2(w.support)]), [[21, 5], [21, 5], [21, 5], [21, 5]]);
  assert.deepEqual(why.rounds.map((x) => [r2(x.share), x.capped]), [[8, ['2026-11-23']], [9, []]], 'even 8 h – W48 capped – the rest 9 h each');
  assert.deepEqual([why.missing, why.over], [0, []]);
  // every board card equals the reasoning
  personRow(cap).cells.slice(0, 4).forEach((c, i) => near(c.cards.find((k) => k.key === 'PCX-1').hours, why.weeks[i].hours, `week ${i}`));
});

test('water-filling: capped weeks, repeated rounds, not enough room', () => {
  const w = waterFill(32, [16, 16, 5, 15]);
  assert.deepEqual(w.hours, [9, 9, 5, 9]);
  const w2 = waterFill(40, [20, 3, 11, 20]); // 10 each → 3 capped → 37/3 = 12.3 → 11 capped → 26/2 = 13
  assert.deepEqual([w2.hours.map(r2), w2.rounds.length], [[13, 3, 11, 13], 3]);
  const w3 = waterFill(30, [10, 5, 5]); // only 20 free → filled, 10 missing spread evenly
  assert.deepEqual([w3.hours.map(r2), w3.overflow, w3.missing], [[13.33, 8.33, 8.33], true, 10]);
});

test('per-task override "even": the task keeps 8 h a week – on the board and in the plan snapshot', () => {
  const { ds, computed } = boss2((d) => { d.planEven = { 201: { by: 'u9', byName: 'Boss', at: '2026-11-11T09:00:00Z' } }; });
  const cap = buildBoard({ ds, computed, team: 't1', distribution: 'capacity' });
  assert.deepEqual(hoursOf(cap, 'PCX-1').slice(0, 4), [8, 8, 8, 8]);
  const t = cap.taskById.get('201');
  assert.equal(t.fill.forced, true);
  assert.equal(personRow(cap).cells[0].cards.find((k) => k.key === 'PCX-1').forcedEven, true);
  assert.deepEqual(cap.capTasks.map((x) => [x.key, x.fill.forced]), [['PCX-1', true]], 'the plan log shows it as set by hand');
  const a = dayIdx('2026-11-09'), b = dayIdx('2026-11-15');
  const snap = boss2((d) => { d.config.rules = { distribution: 'capacity' }; d.planEven = { 201: { by: 'u9' } }; });
  near(computePlan(snap.ds, a, b).people.u1.p['issue:2'], 8, 'snapshot honours the override');
  const free = boss2((d) => { d.config.rules = { distribution: 'capacity' }; });
  near(computePlan(free.ds, a, b).people.u1.p['issue:2'], 9, 'without it: the capacity split');
  // the optimizer does not front-fill an overridden task either
  assert.ok(!optimizeAll({ ds, computed, team: 't1', distribution: 'capacity' }).sooner.suggestions.some((s) => s.key === 'PCX-1'));
});

test('undo payloads: plan.apply rows, plan.even validation and storage', async () => {
  assert.deepEqual(undoMoveOf({ issueId: '201', ok: true, before: { due: '2026-12-04', start: '2026-11-09' } }), { issueId: '201', due: '2026-12-04', start: '2026-11-09' });
  assert.deepEqual(undoMoveOf({ issueId: '201', ok: false, partial: true, written: { due: '2026-11-27' }, before: { due: '2026-12-04', assignee: 'u1' } }), { issueId: '201', due: '2026-12-04' }, 'only what was written');
  assert.equal(undoMoveOf({ issueId: '201', ok: false }), null);
  assert.deepEqual(validateEvenPayload({ even: ['201', '201'], auto: ['202'] }), { even: ['201'], auto: ['202'] });
  for (const bad of [{}, { even: ['x1'] }, { even: 'nope' }, { even: ['1'], auto: ['1'] }, { even: Array.from({ length: 201 }, (_, i) => String(i)) }]) assert.throws(() => validateEvenPayload(bad));
  const store = new Map();
  const audits = [];
  const deps = { get: async (k) => store.get(k), set: async (k, v) => store.set(k, v), audit: async (ctx, action, d) => audits.push([action, d]), now: () => new Date('2026-11-11T10:00:00Z') };
  const ctx = { accountId: 'u1', displayName: 'Anna', roles: { editPlan: true } };
  const r1 = await setEven({ even: ['201'] }, ctx, deps);
  assert.deepEqual(r1.even, { 201: { by: 'u1', byName: 'Anna', at: '2026-11-11T10:00:00.000Z' } });
  const r2_ = await setEven({ auto: ['201'] }, ctx, deps);
  assert.deepEqual(r2_.even, {});
  assert.deepEqual(audits.map((x) => x[0]), ['plan.distribution', 'plan.distribution']);
  assert.deepEqual(await getEven(deps), {});
  await assert.rejects(() => setEven({ even: ['201'] }, { accountId: 'u2', roles: { editPlan: false } }, deps), /NO_ACCESS/);
  await assert.rejects(() => setEven({ even: ['abc'] }, ctx, deps), (e) => e.code === 'INVALID');
});

test('capacity distribution: weeks without room get nothing; a task only ends early when its last weeks have no room', () => {
  const { ds, computed } = boss();
  const even = buildBoard({ ds, computed, team: 't1' });
  assert.deepEqual(hoursOf(even, 'PCX-1').slice(0, 5), [5.71, 5.71, 5.71, 5.71, 5.71], 'even: 7 weeks × 5.7 h');
  const cap = buildBoard({ ds, computed, team: 't1', distribution: 'capacity' });
  assert.deepEqual(hoursOf(cap, 'PCX-1').slice(0, 5), [9.52, 9.52, 0, 9.52, 0], '28.6 h over the 30 h of room');
  const last = personRow(cap).cells[3].cards.find((k) => k.key === 'PCX-1');
  assert.deepEqual([last.last, last.finish], [true, { week: '2026-11-30', early: 1, overflow: false }], 'W50 has no room at all');
  for (const c of personRow(cap).cells) assert.ok(c.util <= 1 + 1e-9);
  // even mode: Finish sooner finds nothing (the even share does not fit W48/W50) …
  assert.equal(optimizeAll({ ds, computed, team: 't1' }).sooner.suggestions.length, 0);
  // … by capacity it proposes the earliest due that fits
  const r = optimizeAll({ ds, computed, team: 't1', distribution: 'capacity' });
  const s = r.sooner.suggestions.find((x) => x.key === 'PCX-1');
  assert.deepEqual([s.newDue, s.weeksSaved, s.move], ['2026-12-04', 1, { due: '2026-12-04' }]);
  assert.match(s.reason.de, /fertig in KW 49, 1 Woche vor dem Due/);
  // with that due date the hours still fit (the past weeks now count 40 h ÷ 6 each)
  const after = buildBoard({ ds, computed, team: 't1', distribution: 'capacity', moves: suggestionMoves({}, ds.issues, [s]) });
  assert.deepEqual(hoursOf(after, 'PCX-1').slice(0, 5), [8.89, 8.89, 0, 8.89, 0]);
  for (const c of personRow(after).cells) assert.ok(c.util <= 1 + 1e-9);
});

test('capacity distribution: weeks before the current one keep the even share', () => {
  const { ds, computed } = boss();
  const fill = capacityFill(computed.model, computed.support, ds.issues);
  const W = planWeeks('2026-10-26', 7); // W44 … W50
  const t = planTasks(computed.model, ds.issues, W, fill).find((x) => x.key === 'PCX-1');
  assert.deepEqual(t.hours.map(r2), [5.71, 5.71, 9.52, 9.52, 0, 9.52, 0]);
  near(t.hours.reduce((a, h) => a + h, 0), 40, 'the whole OE');
});

test('capacity distribution: rank order takes the room first; what does not fit is spread evenly (overload visible)', () => {
  const y = (d) => d.issues.push(story({ id: '304', key: 'Y-1', summary: 'Lower', assignee: dev, oe: 20, re: 20, start: '2026-11-09', due: '2026-11-27', rootRef: 'issue:3' }));
  const { ds, computed } = boss(y);
  const f = capacityFill(computed.model, computed.support, ds.issues);
  const h = (id) => [...f.get(id).byMonday.values()].map(r2);
  assert.deepEqual(h('201'), [9.52, 9.52, 9.52], 'PCX-1 (rank 2) first');
  // Y-1 (rank 3): 0.48 h room left in W46 and W47 → used, the rest spread evenly → overloaded
  assert.equal(f.get('304').overflow, true);
  assert.deepEqual(h('304'), [6.83, 6.83, 6.35]);
  near(h('304').reduce((a, x) => a + x, 0), 20, 'still the whole OE');
  // swap the ranks: Y-1 takes the room of W46/W47 (W48 has none – it ends a week early), PCX-1 overflows
  const { ds: ds2, computed: c2 } = boss((d) => { y(d); d.portfolio[1].rank = 3; d.portfolio[2].rank = 2; });
  const f2 = capacityFill(c2.model, c2.support, ds2.issues);
  assert.deepEqual([[...f2.get('304').byMonday.values()].map(r2), f2.get('304').weeksEarly], [[10, 10], 1]);
  assert.equal(f2.get('201').overflow, true);
  near([...f2.get('201').byMonday.values()].reduce((a, x) => a + x, 0), (40 * 5) / 7, 'still the whole rest of the OE');
});

test('capacity distribution: no room at all → the even share (the overload stays visible)', () => {
  const { ds, computed } = boss((d) => { d.capacity.absences = [{ accountId: 'u1', from: '2026-11-09', to: '2026-12-11' }]; });
  const f = capacityFill(computed.model, computed.support, ds.issues);
  assert.equal(f.get('201').overflow, true);
  assert.deepEqual([...f.get('201').byMonday.values()].map(r2), [5.71, 5.71, 5.71, 5.71, 5.71]);
});

test('plan snapshot follows the admin default: rules.distribution capacity', () => {
  const a = dayIdx('2026-11-09'), b = dayIdx('2026-11-15');
  const even = boss();
  near(computePlan(even.ds, a, b).people.u1.p['issue:2'], 5.7, 'linear: even share');
  const cap = boss((d) => { d.config.rules = { distribution: 'capacity' }; });
  const p = computePlan(cap.ds, a, b);
  assert.equal(p.rule, 'capacity');
  near(p.people.u1.p['issue:2'], 9.5, 'capacity: the same split as the board');
});

// E2E consistency audit 2026-11-17: with the capacity distribution the board re-splits ALL of a person's tasks after a
// change, so an earlier due or a new assignee can push siblings over 100 %. Every suggestion is now checked on the
// board's real split: accepting all of them never creates new overload nor makes an over week worse.
test('by capacity: accepting every suggestion never creates or worsens overload on the board (demo data, both targets)', async () => {
  const { lotseDataset } = await import('./lotseFixture.js');
  const { OPT_MODES } = await import('../shared/optimize.js');
  const ds = lotseDataset();
  const c = computeAll(ds);
  const U = (x) => (x.avail > 0.05 ? x.load / x.avail : x.load > 0.05 ? 99 : 0);
  let offered = 0;
  for (const target of [0.85, 1]) {
    for (const team of [...c.model.teams.keys()]) {
      const board = buildBoard({ ds, computed: c, team, distribution: 'capacity', weeks: 26 });
      const all = optimizeAll({ ds, computed: c, board, team, target, distribution: 'capacity' });
      const sel = OPT_MODES.flatMap((m) => all[m].suggestions);
      offered += sel.length;
      const after = buildBoard({ ds, computed: c, team, distribution: 'capacity', weeks: 26, moves: suggestionMoves({}, ds.issues, sel) });
      for (const r of board.rows.filter((x) => x.kind === 'person')) {
        const r2 = after.rows.find((x) => x.accountId === r.accountId);
        if (!r2) continue;
        r.cells.forEach((cell, i) => {
          const u0 = U(cell), u1 = U(r2.cells[i]);
          assert.ok(u1 <= Math.max(u0, target) + 0.02, `t${target} ${team} ${r.name} ${board.weeks[i].from}: ${Math.round(u0 * 100)} → ${Math.round(u1 * 100)} %`);
        });
      }
    }
  }
  assert.ok(offered > 20, `only ${offered} suggestions left – the check must not remove everything`);
});
