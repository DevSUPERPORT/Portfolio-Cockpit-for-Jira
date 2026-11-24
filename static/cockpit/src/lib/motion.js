// The cockpit's ONE motion system. Every animated thing in components/** and App.jsx takes its timing from here, so the
// whole app moves with one rhythm – and "reduced" (the person's choice or the system's) degrades everything at once.
//
// Rules (the Jira iframe and 60 fps):
//   • enter animations only – never exit animations (AnimatePresence exits stall inside the Jira frame)
//   • transform and opacity only (layout via framer `layout` where it helps) – no width/height/top/left/box-shadow
//   • nothing waits for an animation: content is usable at once, a hidden tab never blocks anything
//   • reduced motion: opacity only, instant, no stagger, no count-up
//
// CSS mirrors the tokens as custom properties (styles.css :root): --dur-instant/quick/base/gentle, --ease-standard,
// --ease-emphasized. html[data-motion='reduced'] switches CSS transitions and keyframes off as well.

import { useSyncExternalStore } from 'react';

// ---------- tokens ----------
/** durations in seconds (framer) – instant 90 ms, quick 160, base 240, gentle 360; countUp for first-time numbers */
export const DUR = Object.freeze({ instant: 0.09, quick: 0.16, base: 0.24, gentle: 0.36, countUp: 0.9 });
/** the same durations in milliseconds (Web Animations API, timers) */
export const MS = Object.freeze({ instant: 90, quick: 160, base: 240, gentle: 360, countUp: 900 });
/** standard: most things (fast out, soft landing) · emphasized: big moves and numbers · accelerate: leaving things */
export const EASE = [0.22, 1, 0.36, 1];
export const EASE_EMPH = [0.16, 1, 0.3, 1];
export const EASE_OUT = [0.4, 0, 1, 1];
export const EASINGS = Object.freeze({ standard: EASE, emphasized: EASE_EMPH, accelerate: EASE_OUT });
export const cssEase = (e) => `cubic-bezier(${e.join(', ')})`;
/** spring presets: panel (side sheets, dialogs) · card (thread cards, tiles) · chip (pills, indicators, highlights) · pop (icons, badges) */
export const SPRING = Object.freeze({
  panel: Object.freeze({ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }),
  card: Object.freeze({ type: 'spring', stiffness: 300, damping: 30, mass: 0.9 }),
  chip: Object.freeze({ type: 'spring', stiffness: 520, damping: 40, mass: 0.7 }),
  pop: Object.freeze({ type: 'spring', stiffness: 440, damping: 24, mass: 0.8 }),
});
/** list stagger: 30 ms per item, only the first 12 items wait – a long list never makes anyone wait */
export const STAGGER = Object.freeze({ step: 0.03, cap: 12 });
/** ambient loops (spinners, an idle glance) – switched off when motion is reduced */
export const LOOP = Object.freeze({ spin: 1.1, idle: 2.6 });
export const PREFS = ['full', 'reduced'];

// ---------- the reduced-motion gate ----------
const KEY = 'pc.motion';
const subs = new Set();
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let os = !!mq?.matches;
let pref = (() => { try { const v = window.localStorage.getItem(KEY); return PREFS.includes(v) ? v : null; } catch { return null; } })();
// the person's explicit choice wins; without one, the system setting decides
const compute = () => pref === 'reduced' || (pref !== 'full' && os);
let snap = { pref: pref || (os ? 'reduced' : 'full'), reduced: compute(), os };
function emit() {
  snap = { pref: pref || (os ? 'reduced' : 'full'), reduced: compute(), os };
  try { document.documentElement.dataset.motion = snap.reduced ? 'reduced' : 'full'; } catch { /* no document (tests) */ }
  subs.forEach((f) => f());
}
mq?.addEventListener?.('change', (e) => { os = e.matches; emit(); });
emit();

export const motionStore = {
  get: () => snap,
  subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
};
/** true when motion is reduced (by the person or the system) – read at render time by every helper below */
export const isReduced = () => snap.reduced;
/** the gate as a hook – components re-render when the person or the system changes it */
export function useReducedMotion() {
  return useSyncExternalStore(motionStore.subscribe, () => snap.reduced, () => snap.reduced);
}
/** boot: the person's saved preference (prefs.motion) wins over the browser's copy */
export function initMotionPref(p) {
  if (!PREFS.includes(p) || p === pref) return;
  pref = p;
  try { window.localStorage.setItem(KEY, p); } catch { /* storage blocked in the frame */ }
  emit();
}
/** the person's switch: kept in this browser at once; the caller saves it to the person's preferences */
export function setMotionPref(p) {
  pref = PREFS.includes(p) ? p : null;
  try { if (pref) window.localStorage.setItem(KEY, pref); else window.localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  emit();
}

// ---------- transitions ----------
const REDUCED_T = Object.freeze({ duration: 0, delay: 0 });
/** a tween on the token scale: tween('quick'), tween('base', { delay }) – reduced: instant */
export function tween(d = 'base', extra) {
  if (snap.reduced) return REDUCED_T;
  return { duration: DUR[d] ?? DUR.base, ease: d === 'gentle' ? EASE_EMPH : EASE, ...extra };
}
/** a spring preset: sp('card'), sp('chip', { delay }) – reduced: instant */
export function sp(kind = 'card', extra) {
  if (snap.reduced) return REDUCED_T;
  return { ...(SPRING[kind] || SPRING.card), ...extra };
}
/** delay of the i-th list item – capped to the first 12; reduced: none */
export function delayOf(i = 0, step = STAGGER.step) {
  if (snap.reduced) return 0;
  return Math.min(Math.max(0, i), STAGGER.cap) * step;
}
/** layout transitions (framer `layout` / `layoutId`): shared pills, reordering – reduced: instant */
export const layoutT = (kind = 'chip') => sp(kind);

// ---------- enter variants (spread onto a motion element) ----------
// enter(i, { y, x, scale, d, spring, delay }): fade + a short move. Reduced: opacity only, instant.
export function enter(i = 0, { y = 6, x = 0, scale = 1, d = 'base', spring, delay = 0 } = {}) {
  if (snap.reduced) return { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: DUR.instant, delay: 0 } };
  const from = { opacity: 0 }, to = { opacity: 1 };
  if (y) { from.y = y; to.y = 0; }
  if (x) { from.x = x; to.x = 0; }
  if (scale !== 1) { from.scale = scale; to.scale = 1; }
  const base = spring ? sp(spring) : tween(d);
  // with a spring, opacity still uses a short tween (a springy fade overshoots nothing but looks late)
  const transition = spring ? { ...base, opacity: { duration: DUR.quick, ease: EASE }, delay: delay + delayOf(i) } : { ...base, delay: delay + delayOf(i) };
  if (spring) transition.opacity.delay = transition.delay;
  return { initial: from, animate: to, transition };
}
/** a list item: enter(i) with the list's small rise */
export const listItem = (i, o) => enter(i, { y: 6, d: 'base', ...o });
/** a card arriving in a thread or a grid */
export const cardIn = (i = 0, o) => enter(i, { y: 12, scale: 0.985, spring: 'card', ...o });
/** a side sheet / drawer sliding in from the right */
export const panelIn = (o) => enter(0, { x: 28, y: 0, spring: 'panel', ...o });
/** a menu, popover, tooltip or info card – quick */
export const popIn = (o) => enter(0, { y: -4, scale: 0.98, d: 'quick', ...o });
/** a scrim / overlay background */
export const fadeIn = (d = 'base') => (snap.reduced ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: DUR.instant } } : { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: tween(d) });
/** an icon or badge popping in (success marks) */
export const popMark = (delay = 0) => enter(0, { y: 0, scale: 0.6, spring: 'pop', delay });
/** bars and columns grow from their base by transform (never width/height): grow('x', i) */
export function grow(axis = 'x', i = 0, to = 1, d = 'gentle') {
  const k = axis === 'y' ? 'scaleY' : 'scaleX';
  if (snap.reduced) return { initial: false, animate: { [k]: to }, transition: REDUCED_T };
  return { initial: { [k]: 0 }, animate: { [k]: to }, transition: tween(d, { delay: delayOf(i) }) };
}

// ---------- interaction (hover / press) ----------
/** cards that lift on hover and give on press – nothing when reduced */
export const hoverLift = (y = -2) => (snap.reduced ? {} : { whileHover: { y }, whileTap: { scale: 0.98 } });
/** buttons that give on press */
export const press = (s = 0.97) => (snap.reduced ? {} : { whileTap: { scale: s } });

// ---------- numbers ----------
// Count-up policy: numbers count up from zero only the FIRST time the cockpit shows them (the first screen after the
// app opens); numbers that appear later show their value at once, and a changing number glides to its new value
// (base). Reduced motion or a hidden tab: always the value at once – a number never waits for an animation.
const COUNT_WINDOW_MS = 2500;
let countStart = null;
export function countMode() {
  if (snap.reduced || (typeof document !== 'undefined' && document.hidden)) return 'set';
  const now = Date.now();
  if (countStart == null) countStart = now;
  return now - countStart <= COUNT_WINDOW_MS ? 'count' : 'set';
}
export const countUpT = () => (snap.reduced ? REDUCED_T : { duration: DUR.countUp, ease: EASE_EMPH });
export const countChangeT = () => tween('base');

// ---------- will-change only while interacting ----------
/** props that set will-change: transform for the duration of a drag / press and remove it afterwards */
export const willChangeWhile = {
  onPointerDown: (e) => { e.currentTarget.style.willChange = 'transform'; },
  onPointerUp: (e) => { e.currentTarget.style.willChange = ''; },
  onPointerCancel: (e) => { e.currentTarget.style.willChange = ''; },
};
