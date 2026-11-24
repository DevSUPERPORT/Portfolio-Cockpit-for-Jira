// Kapazität › Quartale: the numbers shown in the calculation box must add up exactly
// (management question 2026-11-09: "27 + 67 + 161 is not 336" – the running total was read as amounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAll, quarterCapacityParts, buildModel } from '../shared/engine.js';

const ds = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url), 'utf8'));

test('capacity line = weekly hours × 12 weeks × project share × (1 − absence)', () => {
  const d = structuredClone(ds);
  d.capacity = { ...(d.capacity || {}), people: { u1: { weeklyHours: 40, teamId: 't1' } }, teams: { t1: { dailyBusinessPct: 20, internalPct: 10, absenceRatePct: 0 } } };
  const p = quarterCapacityParts(buildModel(d), 't1');
  assert.equal(p.weekly, 40);
  assert.equal(p.weeks, 12);
  assert.equal(Math.round(p.share * 100), 70);
  assert.equal(Math.round(p.total), 336, 'the Integration example: 40 h × 12 × 70 % = 336 h');
  assert.deepEqual(p.members, [{ id: 'u1', weeklyHours: 40 }]);
  d.capacity.teams.t1.absenceRatePct = 10;
  assert.equal(Math.round(quarterCapacityParts(buildModel(d), 't1').total * 10) / 10, 302.4);
});

test('every waterline cell: total demand = sum of its rows, running total ends at the total, free = capacity − demand', () => {
  const { wl } = computeAll(ds);
  let cells = 0;
  for (const t of wl.teamIds) for (const q of wl.quarters) {
    const c = wl.cells[t]?.[q];
    if (!c) continue;
    cells++;
    const sum = c.rows.reduce((a, r) => a + r.demand, 0);
    assert.ok(Math.abs(sum - c.demand) < 1e-6, `${t} ${q}: rows add up to the total`);
    assert.ok(Math.abs(c.rows[c.rows.length - 1].cum - c.demand) < 1e-6, `${t} ${q}: last running total is the total demand`);
    if (t !== '_none') assert.ok(Math.abs(c.capParts.total - c.capacity) < 1e-6, `${t} ${q}: capacity parts give the capacity`);
    if (c.capacity > 0) assert.ok(Math.abs(c.util - c.demand / c.capacity) < 1e-9);
  }
  assert.ok(cells > 0);
});

test('roundParts: whole hours whose shown parts add up exactly to the shown total', async () => {
  const { roundParts } = await import('../shared/engine.js');
  const v = [120, 222.8, 54.7, 58, 80, 227.7]; // 763.2 h – the plain rounding showed 764 h for the parts
  const r = roundParts(v);
  assert.equal(r.reduce((a, x) => a + x, 0), 763);
  r.forEach((x, i) => assert.ok(Math.abs(x - v[i]) < 1, 'each part moves less than one hour'));
  assert.deepEqual(roundParts([27, 40, 94]), [27, 40, 94]);
  assert.deepEqual(roundParts([]), []);
  const { wl } = computeAll(ds);
  for (const t of wl.teamIds) for (const q of wl.quarters) {
    const c = wl.cells[t]?.[q];
    if (!c) continue;
    const p = roundParts(c.rows.map((x) => x.demand));
    assert.equal(p.reduce((a, x) => a + x, 0), Math.round(c.demand), `${t} ${q}`);
  }
});
