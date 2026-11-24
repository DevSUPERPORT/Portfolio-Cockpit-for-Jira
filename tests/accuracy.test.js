// Forecast accuracy: half-time forecast rebuilt from worklogs + remaining-estimate history, never guessed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, remainingAt } from '../shared/accuracy.js';
import { dayIdx } from '../shared/dates.js';

const d = (s) => dayIdx(s);
test('remaining at a day: the last change before it, else the value before the first change', () => {
  const ch = [{ day: d('2026-10-05'), from: 40, to: 30 }, { day: d('2026-10-10'), from: 30, to: 50 }];
  assert.equal(remainingAt(ch, d('2026-10-01')), 40);
  assert.equal(remainingAt(ch, d('2026-10-07')), 30);
  assert.equal(remainingAt(ch, d('2026-10-20')), 50);
  assert.equal(remainingAt([], d('2026-10-20')), null);
});

test('plan vs half-time forecast against the outcome', () => {
  // planned 40 h, really 60 h; at half-time (Oct 8) 20 h spent and 40 h left → forecast 60 h = exact
  const s = { id: '1', oe: 40, final: 60, worklogs: [{ d: '2026-10-01', h: 10 }, { d: '2026-10-06', h: 10 }, { d: '2026-10-15', h: 40 }], changes: [{ day: d('2026-10-07'), from: 20, to: 40 }] };
  const r = evaluate([s]);
  assert.equal(r.n, 1);
  assert.equal(r.rows[0].forecast, 60);
  assert.equal(r.rows[0].errForecast, 0);
  assert.ok(Math.abs(r.rows[0].errPlan - (-1 / 3)) < 1e-9, 'plan 40 vs 60 = −33 %');
  assert.equal(r.forecastBetter, 1);
});

test('nothing is guessed: no remaining history or a one-day story is left out', () => {
  assert.equal(evaluate([{ id: '1', oe: 10, final: 12, worklogs: [{ d: '2026-10-01', h: 6 }, { d: '2026-10-09', h: 6 }], changes: [] }]).n, 0);
  assert.equal(evaluate([{ id: '2', oe: 10, final: 12, worklogs: [{ d: '2026-10-01', h: 12 }], changes: [{ day: d('2026-10-01'), from: 10, to: 0 }] }]).n, 0);
});
