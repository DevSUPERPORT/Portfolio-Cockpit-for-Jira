import test from 'node:test';
import assert from 'node:assert/strict';
import { digestDiff, digestSummary } from '../shared/digest.js';

const item = (r, extra = {}) => ({ r, p: 0.5, h: 'onTrack', s: 'indeterminate', w: 'ok', d: '2026-12-01', ...extra });
const snap = (items) => ({ at: '2026-10-30T08:00:00.000Z', items });

test('digest: no base means no digest', () => {
  assert.equal(digestDiff(null, { 'issue:1': item(1) }), null);
});

test('digest: unchanged portfolio reports nothing', () => {
  const now = { 'issue:1': item(1), 'issue:2': item(2) };
  const d = digestDiff(snap(now), now);
  assert.deepEqual(d.changes, []);
  assert.deepEqual(d.added, []);
  assert.equal(d.removed, 0);
});

test('digest: one project dragged to the top is the only rank change', () => {
  const base = {}, now = {};
  for (let i = 1; i <= 10; i++) base[`issue:${i}`] = item(i);
  for (let i = 1; i <= 10; i++) now[`issue:${i}`] = item(i === 10 ? 1 : i + 1);
  const ranks = digestDiff(snap(base), now).changes.filter((c) => c.kind === 'rank');
  assert.equal(ranks.length, 1);
  assert.deepEqual(ranks[0], { ref: 'issue:10', kind: 'rank', from: 10, to: 1, worse: false });
});

test('digest: rank uses visible positions, so hidden projects do not create noise', () => {
  // issue:2 vanished from view between visits (global ranks have gaps).
  const base = { 'issue:1': item(1), 'issue:2': item(2), 'issue:3': item(3) };
  const now = { 'issue:1': item(1), 'issue:3': item(3) };
  const d = digestDiff(snap(base), now);
  assert.deepEqual(d.changes, []);
  assert.equal(d.removed, 1);
});

test('digest: health, waterline, due, progress and completion are reported, worse news first', () => {
  const base = { 'issue:1': item(1), 'issue:2': item(2), 'issue:3': item(3) };
  const now = {
    'issue:1': item(1, { p: 0.62, s: 'done' }),
    'issue:2': item(2, { h: 'critical', w: 'no' }),
    'issue:3': item(3, { d: '2027-01-15' }),
    'issue:4': item(4),
  };
  const d = digestDiff(snap(base), now);
  const kinds = d.changes.map((c) => `${c.ref}:${c.kind}:${c.worse}`);
  assert.deepEqual(kinds, ['issue:2:health:true', 'issue:2:waterline:true', 'issue:3:due:true', 'issue:1:done:false', 'issue:1:progress:false']);
  assert.deepEqual(d.added, ['issue:4']);
});

test('digest: small progress moves stay quiet', () => {
  const base = { 'issue:1': item(1, { p: 0.5 }) };
  assert.deepEqual(digestDiff(snap(base), { 'issue:1': item(1, { p: 0.53 }) }).changes, []);
});

test('digest: summary is compact and bounded', () => {
  const portfolio = Array.from({ length: 5 }, (_, i) => ({ ref: `issue:${i + 1}`, rank: i + 1, globalRank: i + 3, statusCat: 'new', health: i === 0 ? { status: 'atRisk' } : null }));
  const metrics = new Map(portfolio.map((p) => [p.ref, { progress: 1.4, due: '2026-12-24' }]));
  const wl = { quarters: ['2026-Q4'], projectQ: { 'issue:1': { '2026-Q4': { status: 'partial' } } } };
  const s = digestSummary({ portfolio }, { metrics, wl }, 3);
  assert.deepEqual(Object.keys(s), ['issue:1', 'issue:2', 'issue:3']);
  assert.deepEqual(s['issue:1'], { r: 3, p: 1, h: 'atRisk', s: 'new', w: 'partial', d: '2026-12-24' });
  assert.equal(s['issue:2'].w, null);
});
