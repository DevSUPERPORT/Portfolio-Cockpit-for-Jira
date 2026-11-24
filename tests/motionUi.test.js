// The motion system (static/cockpit/src/lib/motion.js): one set of tokens for framer and CSS, no exit animations
// anywhere (they stall in the Jira frame), transform / opacity only, and a reduced-motion path (the system setting or the
// person's own "Bewegung: voll / reduziert") that degrades every helper to opacity-only and instant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../static/cockpit/src/', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const walk = (d) => readdirSync(join(ROOT, d)).flatMap((f) => (statSync(join(ROOT, d, f)).isDirectory() ? walk(`${d}/${f}`) : [`${d}/${f}`]));
const code = [...walk('components').filter((f) => /\.jsx?$/.test(f)), 'App.jsx'];
const css = ['styles.css', ...walk('components').filter((f) => f.endsWith('.css'))];
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const M = read('lib/motion.js');

test('tokens: durations, easings and springs live in lib/motion.js – and CSS mirrors them', () => {
  assert.match(M, /export const DUR = Object\.freeze\(\{ instant: 0\.09, quick: 0\.16, base: 0\.24, gentle: 0\.36/);
  assert.match(M, /export const EASE = \[0\.22, 1, 0\.36, 1\];/);
  assert.match(M, /export const EASE_EMPH = \[0\.16, 1, 0\.3, 1\];/);
  for (const k of ['panel', 'card', 'chip', 'pop']) assert.match(M, new RegExp(`${k}: Object\\.freeze\\(\\{ type: 'spring'`), `spring preset ${k}`);
  assert.match(M, /STAGGER = Object\.freeze\(\{ step: 0\.03, cap: 12 \}\)/, 'stagger capped to the first 12 items');
  const s = read('styles.css');
  for (const [k, ms] of [['instant', 90], ['quick', 160], ['base', 240], ['gentle', 360]]) assert.match(s, new RegExp(`--dur-${k}: ${ms}ms`), `--dur-${k}`);
  assert.match(s, /--ease-standard: cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  assert.match(s, /--ease-emphasized: cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
});

test('no exit animations anywhere in components/** and App.jsx (AnimatePresence exits stall in the Jira frame)', () => {
  for (const f of code) {
    const src = strip(read(f));
    assert.ok(!/AnimatePresence/.test(src), `${f} uses AnimatePresence`);
    assert.ok(!/\bexit=\{/.test(src) && !/\bexit:\s*\{/.test(src), `${f} has an exit animation`);
  }
});

test('timings come from the tokens: no literal durations, springs or easing curves in components/** and App.jsx', () => {
  for (const f of code) {
    const src = strip(read(f));
    for (const m of src.matchAll(/duration:\s*([\d.]+)/g)) assert.equal(Number(m[1]), 0, `${f}: literal duration ${m[0]} – use DUR / tween()`);
    assert.ok(!/stiffness:\s*\d/.test(src), `${f}: literal spring – use SPRING / sp()`);
    assert.ok(!/\[0\.\d+, 1, 0\.\d+, 1\]/.test(src), `${f}: literal easing curve – use EASE`);
    assert.ok(!/cubic-bezier\(/.test(src), `${f}: literal cubic-bezier – use cssEase(EASE)`);
    assert.ok(!/const (EASE|ease) = \[/.test(src), `${f}: a local easing constant`);
  }
});

test('60 fps: framer animates transform / opacity only – no width, height, layout offsets, box-shadow or blur', () => {
  for (const f of code) {
    // SVG geometry is exempt: the tour's spotlight cut-out (<motion.rect> inside its mask) never lays out the page
    const src = strip(read(f)).replace(/<motion\.rect\b[^>]*\/>/g, '');
    for (const m of src.matchAll(/(?:initial|animate|whileHover|whileTap|whileDrag)=\{\{([^}]*)\}\}/g)) {
      assert.ok(!/\b(width|height|top|left|right|bottom|margin|padding|boxShadow|filter)\s*:/.test(m[1]), `${f} animates a layout / paint property: ${m[1]}`);
    }
  }
  // charts grow by scale (the existing gap fix: lines fade, never pathLength)
  const charts = read('components/charts.jsx');
  assert.match(charts, /grow\('x', i\)/);
  assert.match(charts, /grow\('y', i \+ k\)/);
  assert.ok(!/pathLength:\s*[0-9[]/.test(charts), 'lines fade in – pathLength left gaps with a non-scaling stroke');
  assert.match(read('styles.css'), /\.col-bar \{ transform-origin: 50% 100%; \}/);
});

test('CSS transitions use the duration tokens and never animate box-shadow or layout properties', () => {
  for (const f of css) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/transition\s*:\s*([^;}]+)[;}]/g)) {
      const v = m[1];
      if (/^\s*none\s*$/.test(v)) continue;
      assert.ok(!/(^|[\s,])\d*\.?\d+m?s\b/.test(v.replace(/var\([^)]*\)/g, '')), `${f}: literal duration in "transition: ${v}"`);
      assert.ok(!/(^|,)\s*(box-shadow|width|height|top|left|margin|padding)\b/.test(v), `${f}: transition on a layout / paint property: ${v}`);
    }
  }
  assert.ok(!/\.scrim \{[^}]*backdrop-filter/.test(read('styles.css')), 'no blurred full-window backdrop under fading overlays');
});

test('reduced motion: the system setting and the person\'s choice both reach framer, the helpers and CSS', () => {
  assert.match(M, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(M, /export function useReducedMotion\(\)/);
  assert.match(M, /try \{ const v = window\.localStorage\.getItem\(KEY\)/, 'localStorage fallback in try/catch');
  assert.match(M, /export function initMotionPref\(p\)/);
  const app = read('App.jsx');
  assert.match(app, /initMotionPref\(b\.prefs\?\.motion\)/, 'boot.prefs.motion wins');
  assert.match(app, /<MotionConfig reducedMotion=\{mo\.reduced \? 'always' : 'never'\}>/);
  const s = read('styles.css');
  assert.match(s, /html\[data-motion="reduced"\] \*, html\[data-motion="reduced"\] \*::before/);
  assert.match(s, /@media \(prefers-reduced-motion: reduce\)/);
});

test('the person\'s switch "Bewegung: voll / reduziert": header menu and Ctrl K, bilingual, saved per person', () => {
  const app = read('App.jsx');
  assert.match(app, /function PersonalPrefs\(\)/);
  assert.match(app, /tr\('Bewegung', 'Motion'\)/);
  assert.match(app, /tr\('voll', 'full'\)/);
  assert.match(app, /tr\('reduziert', 'reduced'\)/);
  assert.match(app, /call\('prefs\.save', \{ motion: v \}\)/);
  assert.match(app, /<Avatar user=\{boot\.me\} size=\{30\} onClick=/, 'the avatar opens the personal menu');
  assert.match(app.slice(app.indexOf('function Palette(')), /kw\('bewegung', 'motion'/, 'also in the search');
});

test('helpers degrade to opacity-only and instant when motion is reduced', async () => {
  globalThis.window = globalThis.window || { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
  const m = await import('../static/cockpit/src/lib/motion.js');
  m.setMotionPref('full');
  const full = m.enter(3, { y: 8 });
  assert.equal(full.initial.y, 8);
  assert.ok(full.transition.delay > 0, 'staggered');
  assert.equal(m.delayOf(40), m.delayOf(12), 'stagger capped to the first 12');
  assert.equal(m.tween('quick').duration, 0.16);
  assert.ok(m.hoverLift().whileHover);
  m.setMotionPref('reduced');
  assert.equal(m.isReduced(), true);
  const red = m.enter(3, { y: 8, scale: 0.9, spring: 'card' });
  assert.deepEqual(Object.keys(red.initial), ['opacity'], 'opacity only');
  assert.equal(red.transition.delay, 0);
  assert.equal(m.tween('gentle').duration, 0);
  assert.equal(m.sp('panel').duration, 0);
  assert.equal(m.delayOf(5), 0);
  assert.deepEqual(m.hoverLift(), {});
  assert.equal(m.grow('x').initial, false, 'bars appear at their size');
  assert.equal(m.countMode(), 'set', 'numbers show at once');
  m.setMotionPref(null);
});
