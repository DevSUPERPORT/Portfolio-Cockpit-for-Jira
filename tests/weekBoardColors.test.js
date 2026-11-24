// Weekly board (boss feedback 2026-11-24): the coloured stripe on a task card is the project – explained in the legend,
// the hover card and the tour, and never one of the person bar's colours; the head of an absent week is never clipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const jsx = read('static/cockpit/src/components/WeekBoard.jsx');
const css = read('static/cockpit/src/components/weekBoard.css');
const tour = read('static/cockpit/src/components/Tour.jsx');

const hex = (s) => { const m = /^#([0-9a-f]{6})$/i.exec(s); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
const dist = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));

test('project colours never look like the person bar (absent, daily business, support, projects, over)', () => {
  const pal = [...(/export const PAL = \[([^\]]+)\]/.exec(jsx)[1].matchAll(/'([^']+)'/g))].map((m) => m[1]);
  assert.ok(pal.length >= 8);
  const bar = /:root \{ (--wb-off[^}]+)\}/.exec(css)[1];
  const barColours = ['--wb-off', '--wb-daily', '--wb-support', '--wb-projects', '--wb-over'].map((v) => hex(new RegExp(`${v}: (#[0-9A-Fa-f]{6})`).exec(bar)[1]));
  for (const c of pal.filter((x) => x.startsWith('#'))) {
    for (const b of barColours) assert.ok(dist(hex(c), b) > 60, `${c} is too close to a bar colour`);
  }
});

test('the stripe is explained: legend entry, hover card line, tour sentence (DE and EN)', () => {
  assert.match(jsx, /data-legend="stripe"[\s\S]{0,200}Farbstreifen links = das Projekt der Aufgabe/);
  assert.match(jsx, /Colour stripe on the left = the task\\'s project/);
  assert.match(jsx, /\[tr\('Projekt \(Farbstreifen links\)', 'Project \(colour stripe on the left\)'\), k\.project \|\| '–'\]/);
  assert.match(tour, /Der farbige Streifen an einer Karte zeigt ihr Projekt/);
  assert.match(tour, /The coloured stripe on a card shows its project/);
});

test('a week without time wraps: planned / available, the reason, then "Why?" – nothing clipped', () => {
  assert.match(css, /\.wb-head\.t-notime \{ flex-wrap: wrap;[^}]*white-space: normal; \}/);
  assert.match(css, /\.wb-head\.t-notime b \{ flex: 1 0 100%; white-space: normal;/);
});
