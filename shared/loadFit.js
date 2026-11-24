// Load in plain words (boss 2026-11-20: "139 % / 125 % / 250 % – but it is always me. Not so easy to understand with the
// numbers – simpler, with better visuals for inexperienced users; keep the percentage, add simple cues").
// The same tone as everywhere (kpis.js utilTone: ≤ 85 % room · ≤ 100 % nearly full · above overbooked), said as what a
// person can act on: how many hours do not fit, or how many are still free.
//   fitOf(load, avail) → { kind: 'none' | 'ok' | 'full' | 'over' | 'noTime', util, over, free, load, avail }
//   barOf(fit)         → the bar: { fill, over } as shares of the bar's width (the capacity line sits at `cap`)
import { utilTone } from './kpis.js';

export function fitOf(load, avail) {
  const l = Math.max(0, +load || 0), a = Math.max(0, +avail || 0);
  if (l <= 0.05 && a <= 0.05) return { kind: 'none', util: null, over: 0, free: 0, load: l, avail: a };
  if (a <= 0.05) return { kind: 'noTime', util: Infinity, over: l, free: 0, load: l, avail: a };
  const util = l / a;
  const tone = utilTone(util);
  if (tone === 'bad') return { kind: 'over', util, over: l - a, free: 0, load: l, avail: a };
  return { kind: tone === 'warn' ? 'full' : 'ok', util, over: 0, free: Math.max(0, a - l), load: l, avail: a };
}

// The bar is drawn on max(load, capacity): the capacity line at `cap`, the planned part up to it (`fill`) and what does
// not fit beyond it (`over`, striped red) – so 125 % reads as "a quarter more than fits" without any arithmetic.
export function barOf(f) {
  if (!f || f.kind === 'none') return { cap: 1, fill: 0, over: 0 };
  if (f.kind === 'noTime') return { cap: 0, fill: 0, over: 1 };
  const total = Math.max(f.load, f.avail);
  return { cap: f.avail / total, fill: Math.min(f.load, f.avail) / total, over: Math.max(0, f.load - f.avail) / total };
}

// Round hours for words: whole hours from 10 h, one decimal below (never "0 h too much")
export const roundH = (h) => (h >= 9.95 ? Math.round(h) : Math.max(0.1, Math.round(h * 10) / 10));
