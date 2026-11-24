// Utilisation colours: one rule everywhere, and the heat shades keep the text readable (WCAG AA) in both themes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { utilTone, UTIL_WARN } from '../shared/kpis.js';

test('one tone rule: room up to 85 %, nearly full up to 100 %, red only when overbooked', () => {
  assert.equal(UTIL_WARN, 0.85);
  assert.equal(utilTone(0.34), 'ok', '11 h of 32 h is room, never a warning');
  assert.equal(utilTone(0), 'ok');
  assert.equal(utilTone(0.85), 'ok');
  assert.equal(utilTone(0.86), 'warn');
  assert.equal(utilTone(1), 'warn', 'exactly full is not overbooked');
  assert.equal(utilTone(1.01), 'bad');
  assert.equal(utilTone(Infinity), 'bad', 'work without any capacity');
  assert.equal(utilTone(null), null);
  assert.equal(utilTone(NaN), null);
});

test('no screen or export uses its own utilisation thresholds any more', () => {
  const files = ['static/cockpit/src/components/charts.jsx', 'static/cockpit/src/lib/pdf.js', 'static/cockpit/src/lib/askPdf.js', 'static/cockpit/src/views/Capacity.jsx', 'static/cockpit/src/views/Team.jsx'];
  for (const f of files) assert.ok(!/1\.15/.test(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')), `${f} still has the old 115 % threshold`);
});

// The shades used by views/Capacity.jsx heat(): the strongest mix per band, against the page's own tokens.
const css = readFileSync(new URL('../static/cockpit/src/styles.css', import.meta.url), 'utf8');
const block = (sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
const tok = (b, name) => new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(b)?.[1];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, p) => hex(a).map((v, i) => v * p + hex(b)[i] * (1 - p));
const lum = (c) => { const x = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('heat shades keep ≥ 4.5 : 1 text contrast in light and dark mode', () => {
  const light = block(':root'), dark = block("html[data-color-mode='dark']");
  for (const [mode, b] of [['light', light], ['dark', dark]]) {
    const ink = tok(b, 'ink'), sunk = tok(b, 'sunken');
    assert.ok(ink && sunk, `${mode}: tokens found`);
    for (const [tone, p] of [['ok', 0.4], ['warn', 0.42], ['bad', 0.56]]) {
      const c = tok(b, tone);
      assert.ok(c, `${mode} --${tone}`);
      const r = ratio(hex(ink), mix(c, sunk, p));
      assert.ok(r >= 4.5, `${mode} ${tone} at ${p * 100} %: ${r.toFixed(2)} : 1`);
    }
  }
});

// ---------- internal work ("Intern %"): deducted every week, like daily business ----------
import { buildModel, personCapacityIn, quarterCapacity, projectShare } from '../shared/engine.js';
import { ymdIdx } from '../shared/dates.js';
const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url)));
const withTeam = (team) => { const ds = structuredClone(golden); ds.capacity = { people: { boss: { weeklyHours: 40, location: 'NONE', teamId: 'int' } }, teams: { int: { name: 'Integration', ...team } }, absences: [] }; return buildModel(ds); };
const MON = ymdIdx(2026, 11, 9), FRI = ymdIdx(2026, 11, 13);

test("the boss's example: 40 h − 20 % Tagesgeschäft − 10 % intern = 28 h; 11 h of projects leave 17 h free", () => {
  const m = withTeam({ dailyBusinessPct: 20, internalPct: 10, absenceRatePct: 10 });
  const cap = personCapacityIn(m, { id: 'boss', weeklyHours: 40, location: 'NONE', teamId: 'int' }, MON, FRI);
  assert.equal(Math.round(cap * 100) / 100, 28);
  assert.equal(cap - 11, 17);
  assert.equal(utilTone(11 / cap), 'ok', '39 % is room');
});

test('without internal work nothing changes (existing installs): 40 h − 20 % = 32 h', () => {
  const m = withTeam({ dailyBusinessPct: 20, absenceRatePct: 10 });
  assert.equal(personCapacityIn(m, { id: 'boss', weeklyHours: 40, location: 'NONE', teamId: 'int' }, MON, FRI), 32);
});

test('quarters: weekly × 12 × (1 − daily − internal) × (1 − absence rate); the absence rate stays quarter-only', () => {
  const m = withTeam({ dailyBusinessPct: 20, internalPct: 10, absenceRatePct: 10 });
  assert.equal(Math.round(quarterCapacity(m, 'int') * 100) / 100, Math.round(40 * 12 * 0.7 * 0.9 * 100) / 100);
  const w = personCapacityIn(m, { id: 'boss', weeklyHours: 40, location: 'NONE', teamId: 'int' }, MON, FRI);
  assert.equal(Math.round(w), 28, 'the weekly view does not take the absence rate on top');
});

test('internal + daily business can never take the whole week', () => {
  assert.equal(projectShare({ dailyBusinessPct: 60, internalPct: 60 }), 0.05);
  assert.equal(projectShare({}), 1);
});
