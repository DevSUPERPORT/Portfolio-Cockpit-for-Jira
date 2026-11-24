// Tester + boss feedback 2026-11-17 on the weekly plan: every part of a task in the hover, readable "no time" weeks
// instead of "∞", and suggestions (with a before → after preview) for red weeks that only stage a move when accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotseDataset } from './lotseFixture.js';
import { computeAll } from '../shared/engine.js';
import { buildBoard, taskParts, planWeeks, moveTask, applyMoves } from '../shared/weekPlan.js';
import { suggestShifts, fitShift, fitSpread } from '../shared/planSuggest.js';
import { isoOf, mondayOf } from '../shared/dates.js';

const EPS = 0.05;

// a person with one multi-week task, then absent for the task's first two weeks
function absentScenario() {
  const ds = lotseDataset();
  const c0 = computeAll(ds);
  const today = c0.model.today;
  const W = planWeeks(today, 8);
  // the first open story of a maintained person that starts within the board and spans 2–4 weeks
  const people = ds.capacity.people;
  const story = ds.issues.find((i) => i.role === 'estimate' && i.status?.cat !== 'done' && i.oe > 8 && i.assignee?.id && people[i.assignee.id] && i.start && i.due
    && mondayOf(Date.parse(i.start) / 864e5) >= W[1].a && mondayOf(Date.parse(i.start) / 864e5) <= W[3].a);
  assert.ok(story, 'fixture has a suitable story');
  const pid = story.assignee.id;
  const teamId = story.team?.id || people[pid].teamId; // the story's own team: its board shows the task
  const s0 = mondayOf(Date.parse(story.start) / 864e5);
  ds.capacity = { ...ds.capacity, absences: [...(ds.capacity.absences || []), { id: 'abs-test', accountId: pid, from: isoOf(s0), to: isoOf(s0 + 11), type: 'vacation' }] };
  return { ds, story, pid, teamId, s0 };
}

test('taskParts lists every week of a task with its hours; they add up to the estimate', () => {
  const ds = lotseDataset();
  const computed = computeAll(ds);
  const board = buildBoard({ ds, computed, team: ds.teams[0].id });
  const multi = [...board.taskById.values()].find((t) => t.len > 2);
  assert.ok(multi);
  const parts = taskParts(multi);
  assert.ok(parts.length >= 2);
  assert.ok(Math.abs(parts.reduce((a, p) => a + p.hours, 0) - multi.oe) < 0.1, `${parts.map((p) => p.hours).join('+')} vs ${multi.oe}`);
  assert.deepEqual(parts.map((p) => p.idx), parts.map((_, i) => i + 1));
  assert.ok(parts.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.monday)));
});

test('a week without time (absence) gets a suggestion: the smallest later shift that fits, with a before → after preview', () => {
  const { ds, story, pid, teamId, s0 } = absentScenario();
  const computed = computeAll(ds);
  const board = buildBoard({ ds, computed, team: teamId });
  const row = board.rows.find((r) => r.accountId === pid);
  const wi = board.weeks.findIndex((w) => w.a === s0);
  assert.ok(row && wi >= 0);
  assert.ok(!(row.cells[wi].avail > EPS), 'the absent week has no time');
  const sug = suggestShifts({ ds, computed, board });
  const mine = sug.find((x) => x.taskId === story.id);
  assert.ok(mine, JSON.stringify(sug.map((x) => [x.key, x.reason])));
  assert.equal(mine.reason, 'noTime');
  assert.ok(mine.weeks >= 1 && mine.weeks <= 16);
  assert.ok(mine.conflictWeeks.includes(isoOf(s0)));
  // the preview: after the move no touched week of this person is above 100 % or without time with hours in it
  for (const p of mine.preview) if (p.after.load > EPS) assert.ok(p.after.avail > EPS && p.after.util <= 1.005 + 1e-9 || p.before.util > 1.005, `${p.monday} ${p.after.util}`);
  // accepting = the same pending move a drag makes: dates shift by whole weeks, nothing else changes
  const moves = moveTask({}, story, { weeks: mine.weeks });
  const eff = applyMoves(ds.issues, moves).find((i) => i.id === story.id);
  assert.equal(eff.start, mine.newStart);
  assert.equal(eff.due, mine.newDue);
  assert.equal(eff.assignee?.id, pid);
  // with the move staged, the suggestion for this task is gone
  const board2 = buildBoard({ ds, computed, team: teamId, moves });
  assert.ok(!suggestShifts({ ds, computed, board: board2, moves }).some((x) => x.taskId === story.id));
});

test('fitShift: smallest full fit; otherwise the best honest partial move; null when nothing helps', () => {
  const t = { hours: [10, 10, 0, 0, 0, 0] };
  const load = [10, 10, 30, 5, 0, 0], avail = [0, 0, 30, 30, 30, 30];
  assert.deepEqual(fitShift(t, load, avail, 1, 4), { k: 3, full: true }); // week 2 is full (30/30) → weeks 3–4
  // nothing fits fully (booked for months – live on production): away from weeks without time anyway, said as partial
  assert.deepEqual(fitShift(t, [10, 10, 30, 30, 30, 30], avail, 1, 4, { noTime: true }), { k: 2, full: false });
  assert.deepEqual(fitShift(t, [10, 10, 30, 30, 30, 30], avail, 1, 4), { k: 2, full: false }, 'lower peak than now');
  // nowhere present / no improvement → no suggestion
  assert.equal(fitShift(t, [10, 10, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], 1, 4, { noTime: true }), null);
  assert.equal(fitShift({ hours: [0, 10, 0, 0] }, [0, 40, 50, 50], [30, 30, 30, 30], 1, 2), null, 'later weeks would be worse');
});

test('no suggestions on the read-only all-teams board or for hidden people', () => {
  const ds = lotseDataset();
  const computed = computeAll(ds);
  assert.deepEqual(suggestShifts({ ds, computed, board: buildBoard({ ds, computed }) }), []);
});

// E2E consistency audit 2026-11-17: the preview is exactly what the board shows after "Accept" – also with the
// capacity distribution, where a moved task changes shape – and every suggestion is real relief.
test('preview = the board after accepting, in both distributions; overload suggestions improve their red week by ≥ 10 points', () => {
  const ds = lotseDataset();
  const c = computeAll(ds);
  let checked = 0;
  for (const distribution of ['even', 'capacity']) {
    for (const team of [...c.model.teams.keys()]) {
      const board = buildBoard({ ds, computed: c, team, distribution });
      const list = suggestShifts({ ds, computed: c, board });
      assert.ok(list.length <= 8);
      for (const s of list) {
        const issue = ds.issues.find((i) => i.id === s.taskId);
        const after = buildBoard({ ds, computed: c, team, distribution, moves: moveTask({}, issue, s.change || { weeks: s.weeks }) });
        const row0 = board.rows.find((r) => r.accountId === s.personId), row1 = after.rows.find((r) => r.accountId === s.personId);
        if (!row1) continue; // an outsider whose only task in the scope left the visible weeks – no row any more
        for (const p of s.preview) {
          const wi = board.weeks.findIndex((w) => w.from === p.monday);
          if (wi < 0) continue;
          assert.ok(Math.abs(row0.cells[wi].load - p.before.load) < 1e-6, `${distribution} ${s.key} before ${p.monday}`);
          assert.ok(Math.abs(row1.cells[wi].load - p.after.load) < 1e-6, `${distribution} ${s.key} after ${p.monday}`);
          checked++;
        }
        // every red cell that shows the suggestion gets real relief
        for (const wk of s.conflictWeeks) {
          const wi = board.weeks.findIndex((w) => w.from === wk);
          const c0 = row0.cells[wi], c1 = row1.cells[wi];
          if (!(c0.avail > EPS)) continue; // no time: the task leaves that week
          const u0 = c0.load / c0.avail, u1 = c1.avail > EPS ? c1.load / c1.avail : Infinity;
          assert.ok(u1 <= 1.005 || u0 - u1 >= 0.1 - 1e-9, `${distribution} ${s.key} ${wk}: ${u0} → ${u1}`);
        }
      }
      // most useful first: weeks without time, then complete fits
      const order = list.map((s) => (s.pastProjectDue ? 10 : 0) + (s.reason === 'noTime' ? 0 : s.full ? 1 : 2)); // within the project due first (tester 2026-11-19)
      assert.deepEqual(order, [...order].sort((a, b) => a - b), `${distribution} ${team} ranking`);
    }
  }
  assert.ok(checked > 50, `only ${checked} preview weeks checked`);
});
