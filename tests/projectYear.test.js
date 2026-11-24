// Projekt › Jahresprognose (user 2026-11-17): the next 12 / 18 / 24 months per person, from the weekly plan's numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotseDataset } from './lotseFixture.js';
import { computeAll } from '../shared/engine.js';
import { projectYear, YEAR_RANGES } from '../shared/yearPlan.js';
import { buildBoard } from '../shared/weekPlan.js';

test('months from the current month on; hours per month add up to the same hours as the weekly board', () => {
  const ds = lotseDataset();
  const computed = computeAll(ds);
  const ref = computed.model.items[0].ref;
  const y = projectYear({ ds, computed, project: ref, months: 12 });
  assert.equal(y.months.length, 12);
  assert.ok(y.months[0].current);
  assert.match(y.months[0].key, /^\d{4}-\d{2}$/);
  // the same board over the horizon: every working day of the 12 months is counted exactly once
  const board = buildBoard({ ds, computed, project: ref, weeks: Math.ceil((12 * 52) / 12) + 1 });
  const weekly = board.rows.filter((r) => ['person', 'unassigned', 'hidden'].includes(r.kind))
    .reduce((a, r) => a + r.cells.reduce((b, c, wi) => {
      const days = [0, 1, 2, 3, 4].filter((d) => { const k = new Date((board.weeks[wi].a + d) * 864e5).toISOString().slice(0, 7); return y.months.some((m) => m.key === k); }).length;
      return b + (r.kind === 'unassigned' ? c.load || 0 : c.own ?? c.load ?? 0) * (days / 5);
    }, 0), 0);
  assert.ok(Math.abs(weekly - y.planned) < 0.5, `${weekly} vs ${y.planned}`);
  assert.ok(Math.abs(y.total.reduce((a, b) => a + b, 0) - y.planned) < 1e-6);
  for (const r of y.rows) for (const c of r.cells) assert.ok(Number.isFinite(c.own) && c.own >= 0);
});

test('longer ranges hold at least as many hours; hours after the due month are counted as late', () => {
  const ds = lotseDataset();
  const computed = computeAll(ds);
  const ref = computed.model.items[0].ref;
  const ys = YEAR_RANGES.map((months) => projectYear({ ds, computed, project: ref, months }));
  assert.deepEqual(ys.map((y) => y.months.length), YEAR_RANGES);
  assert.ok(ys[1].planned >= ys[0].planned - 1e-6 && ys[2].planned >= ys[1].planned - 1e-6);
  const y = ys[2];
  if (y.dueMonth) {
    const dueAt = y.months.findIndex((m) => m.key === y.dueMonth);
    const expect = dueAt < 0 ? (y.dueMonth < y.months[0].key ? y.planned : 0) : y.total.slice(dueAt + 1).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(y.late - expect) < 1e-6, `${y.late} vs ${expect}`);
  }
});

// E2E audit 2026-11-17: the year view includes the board's pending moves (and says so), and never claims "done in
// <last month>" when the work runs past the range
test('pending moves count in the year view; runsPast when work continues after the range', async () => {
  const { moveTask } = await import('../shared/weekPlan.js');
  const ds = lotseDataset();
  const computed = computeAll(ds);
  const ref = computed.model.items[0].ref;
  const story = ds.issues.find((i) => i.rootRef === ref && i.role === 'estimate' && i.start && i.due && i.oe > 0 && i.status?.cat !== 'done');
  const moves = moveTask({}, story, { weeks: 6 });
  const y0 = projectYear({ ds, computed, project: ref });
  const y1 = projectYear({ ds, computed, project: ref, moves });
  assert.equal(y0.pending, 0);
  assert.equal(y1.pending, 1);
  assert.notDeepEqual(y1.total, y0.total, 'the staged move changes the months');
  const b = buildBoard({ ds, computed, project: ref, weeks: 54, moves });
  const boardHours = b.rows.filter((r) => ['person', 'unassigned', 'hidden'].includes(r.kind)).reduce((a, r) => a + r.cells.reduce((x, c) => x + (r.kind === 'unassigned' ? c.load || 0 : c.own ?? c.load ?? 0), 0), 0);
  assert.ok(y1.planned <= boardHours + 1e-6);
  // a story far beyond 12 months → runsPast, and no "done per plan" month claim in that case
  const far = { ...story, id: 'far-1', key: 'FAR-1', start: '2028-06-01', due: '2028-09-29' };
  const ds2 = { ...ds, issues: [...ds.issues, far] };
  const y2 = projectYear({ ds: ds2, computed: computeAll(ds2), project: ref, months: 12 });
  assert.equal(y2.runsPast, true);
  assert.equal(y0.runsPast, ds.issues.some((i) => i.rootRef === ref && i.role === 'estimate' && i.status?.cat !== 'done' && i.oe > 0 && i.due > y0.months.at(-1).key + '-31'));
});
