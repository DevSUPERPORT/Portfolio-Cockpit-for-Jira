// Tester 2026-11-19 (screenshot, Weekly planning): an 80 h task booked into ONE week (258 %) got the advice "move it 3
// weeks later" – where it was 250 % again. The advice now SPLITS the task over the following weeks (start stays, due
// stretches) when that fits better, and Accept stages exactly that change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lotseDataset } from './lotseFixture.js';
import { computeAll } from '../shared/engine.js';
import { buildBoard, planWeeks, moveTask, applyMoves } from '../shared/weekPlan.js';
import { suggestShifts, fitSpread, fitShift } from '../shared/planSuggest.js';
import { isoOf, dayIdx } from '../shared/dates.js';

const EPS = 0.05;

test('fitSpread: the smallest window from the start week that fits; later start when the first weeks are full; honest partial', () => {
  // 80 h in week 0, about 30 h free every week → 3 weeks (26.7 h each), start week kept
  const t = { hours: [80, 0, 0, 0, 0, 0, 0, 0] };
  const avail = [32, 32, 32, 32, 32, 32, 32, 32];
  const load = [82, 2, 2, 2, 0, 0, 0, 0];
  assert.deepEqual(fitSpread(t, load, avail, 1, 6), { ws: 0, we: 2, full: true, peak: (2 + 80 / 3) / 32 });
  // a plain shift cannot help: every single week holds at most 32 h
  assert.equal(fitShift(t, load, avail, 1, 6).full, false);
  // week 1 is full → it cannot be part of the window from week 0 → start later (weeks 2–4)
  const r = fitSpread(t, [82, 32, 2, 2, 2, 0, 0, 0], avail, 1, 6);
  assert.equal(r.full, true);
  assert.ok(r.ws >= 1 && r.we - r.ws + 1 >= 3, JSON.stringify(r));
  // a week without time is never inside the window
  const r2 = fitSpread(t, load, [32, 0, 32, 32, 32, 32, 32, 32], 1, 6);
  assert.ok(r2 && r2.ws >= 2, JSON.stringify(r2));
  // booked for months: no full fit, but the window with the lowest peak (lower than today's) – or null when nothing helps
  const p = fitSpread(t, [82, 30, 30, 30, 30, 30, 30, 30], avail, 1, 6);
  assert.equal(p.full, false);
  assert.ok(p.peak < 82 / 32);
  assert.equal(fitSpread({ hours: [10, 0, 0] }, [20, 40, 40], [30, 30, 30], 1, 2), null, 'splitting would only make it worse');
  // by capacity: fits as soon as the free room adds up
  assert.deepEqual(fitSpread(t, [82, 2, 30, 2, 0, 0, 0, 0], avail, 1, 6, { distribution: 'capacity' }).we, 3);
});

// the screenshot case on the fixture: one person, one big task squeezed into a single week
function bigTaskScenario() {
  const ds = lotseDataset();
  const c0 = computeAll(ds);
  const W = planWeeks(c0.model.today, 8);
  const people = ds.capacity.people;
  // the person with the most free room in weeks 2–6 (someone booked for months gets a later split – tested above)
  const free = new Map();
  for (const team of c0.model.teams.keys()) {
    for (const r of buildBoard({ ds, computed: c0, team, weeks: 8 }).rows) {
      if (r.kind !== 'person' || free.has(r.accountId)) continue;
      free.set(r.accountId, r.cells.slice(2, 7).reduce((a, x) => a + (x.avail > EPS ? x.avail - x.load : -99), 0));
    }
  }
  const cands = ds.issues.filter((i) => i.role === 'estimate' && i.status?.cat !== 'done' && i.assignee?.id && people[i.assignee.id] && i.start && i.due && free.has(i.assignee.id));
  const story = cands.sort((a, b) => free.get(b.assignee.id) - free.get(a.assignee.id))[0];
  assert.ok(story, 'fixture has an assigned open story');
  const wk = W[2];
  story.start = isoOf(wk.a); story.due = isoOf(wk.a + 4);
  story.oe = 80; // hours, as the engine reads Original Estimate
  return { ds, story, pid: story.assignee.id, teamId: story.team?.id || people[story.assignee.id].teamId, wk };
}

test('an 80 h task in one week is split over the next weeks – the preview is the board after Accept', () => {
  const { ds, story, pid, teamId, wk } = bigTaskScenario();
  const computed = computeAll(ds);
  for (const distribution of ['even', 'capacity']) {
    const board = buildBoard({ ds, computed, team: teamId, distribution });
    const row = board.rows.find((r) => r.accountId === pid);
    const wi = board.weeks.findIndex((w) => w.a === wk.a);
    assert.ok(row && wi >= 0, 'the person and the week are on the board');
    assert.ok(row.cells[wi].util > 1.005, `the week is red (${row.cells[wi].util})`);
    const mine = suggestShifts({ ds, computed, board }).find((x) => x.taskId === story.id);
    assert.ok(mine, `${distribution}: a suggestion for the big task`);
    assert.equal(mine.kind, 'split', `${distribution}: split, not just moved (${mine.kind} ${JSON.stringify(mine.change)})`);
    assert.ok(mine.span > mine.spanBefore, 'more weeks than before');
    assert.ok(mine.perWeek < 80 - 1, `less per week (${mine.perWeek})`);
    assert.equal(mine.change.start, story.start, 'the start stays when the start week has room');
    assert.ok(dayIdx(mine.change.due) > dayIdx(story.due), 'the due date stretches');
    // the red week itself is relieved, and no touched week ends up worse than the red week was
    const red = mine.preview.find((p) => p.monday === wk.from);
    assert.ok(red && red.after.util < red.before.util - 0.1, JSON.stringify(red));
    // Accept stages exactly this change: the same dates, the same hours per week as the preview
    const moves = moveTask({}, story, mine.change);
    const eff = applyMoves(ds.issues, moves).find((i) => i.id === story.id);
    assert.equal(eff.start, mine.newStart);
    assert.equal(eff.due, mine.newDue);
    const after = buildBoard({ ds, computed, team: teamId, distribution, moves });
    const row1 = after.rows.find((r) => r.accountId === pid);
    for (const p of mine.preview) {
      const i = after.weeks.findIndex((w) => w.from === p.monday);
      if (i >= 0) assert.ok(Math.abs(row1.cells[i].load - p.after.load) < 1e-6, `${distribution} ${p.monday}`);
    }
    if (mine.full) for (const p of mine.preview) if (p.after.load > p.before.load + EPS) assert.ok(p.after.util <= 1.005, `${distribution} ${p.monday} ${p.after.util}`);
  }
});

test('the board says "split" in the cell button, the action line and the hover card; Accept stages the change', () => {
  const src = readFileSync(new URL('../static/cockpit/src/components/WeekBoard.jsx', import.meta.url), 'utf8');
  assert.ok(src.includes("...(x.change || { weeks: x.weeks })"), 'Accept stages the suggestion\'s own change');
  assert.ok(/Split over \$\{weekRange/.test(src) && /Auf \$\{weekRange/.test(src), 'bilingual split action');
  assert.ok(src.includes('data-autofix-kind'), 'the red-cell button knows its kind');
  assert.ok(/spread over \$\{x\.span\} weeks/.test(src), 'the hover card explains the split');
});
