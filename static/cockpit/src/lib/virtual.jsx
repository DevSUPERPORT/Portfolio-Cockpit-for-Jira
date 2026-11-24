// Windowed rendering for long lists (more than VIRTUAL_MIN rows): only the rows near the viewport are in the DOM,
// spacers keep the scroll height, so the list looks and scrolls exactly as before. Works with the page scroll and any
// scrolling parent (one capturing scroll listener), keeps sticky table headers (the header row stays in the table),
// and keyboard focus: tabbing to the last rendered row scrolls it into view, which renders the next ones.
import { Profiler, startTransition, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { tr } from './i18n.js';

export const VIRTUAL_MIN = 200;
const OVERSCAN = 12;
const STEP = 8;

// count rows of about `estimate` px; returns { on, start, end, before, after, ref } – ref goes on the element the rows
// start in (tbody or a div); render rows [start, end) between a spacer of `before` px and one of `after` px.
export function useWindowedRows(count, { estimate = 44, min = VIRTUAL_MIN } = {}) {
  const on = count > min;
  const ref = useRef(null);
  const [h, setH] = useState(estimate);
  const measured = useRef(0); // rows are measured a few times, not on every scroll (it forces a layout)
  const [range, setRange] = useState([0, Math.min(count, 40)]);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el || !on) return;
    const top = el.getBoundingClientRect().top;
    const vh = window.innerHeight || 800;
    // snapped to blocks of STEP rows: the window changes every STEP rows of scrolling, not every row – each change
    // renders the list again, so 8× fewer renders while the overscan still covers the viewport
    const start = Math.max(0, Math.floor((Math.floor(-top / h) - OVERSCAN) / STEP) * STEP);
    const end = Math.min(count, Math.ceil((Math.ceil((vh - top) / h) + OVERSCAN) / STEP) * STEP);
    setRange((r) => (r[0] === start && r[1] === Math.max(start, end) ? r : [start, Math.max(start, end)]));
  }, [on, h, count]);
  // row height from the rendered rows (the first real row after the top spacer)
  useLayoutEffect(() => {
    if (!on || !ref.current || measured.current >= 3) return;
    const rows = [...ref.current.children].filter((c) => !c.hasAttribute('data-spacer'));
    if (rows.length >= 3) {
      measured.current += 1;
      const avg = rows.slice(0, Math.min(rows.length, 20)).reduce((a, c) => a + c.getBoundingClientRect().height, 0) / Math.min(rows.length, 20);
      if (avg > 8 && Math.abs(avg - h) > 1) setH(avg);
    }
  });
  useEffect(() => {
    if (!on) return undefined;
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; measure(); }); };
    measure();
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // a focused row outside the window (keyboard, find) is brought in
    const onFocus = () => onScroll();
    ref.current?.addEventListener('focusin', onFocus);
    const el = ref.current;
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll, { capture: true }); window.removeEventListener('resize', onScroll); el?.removeEventListener('focusin', onFocus); };
  }, [on, measure]);
  if (!on) return { on, start: 0, end: count, before: 0, after: 0, ref };
  const start = Math.min(range[0], count), end = Math.min(Math.max(range[1], start), count);
  return { on, start, end, before: start * h, after: Math.max(0, (count - end) * h), ref };
}

// A list that is costly per item (motion, drag) but not long enough to window: the first `first` items render at once,
// then twice as many each time the browser is idle (a transition: React yields to input while it renders them), so the
// first paint and every click never wait for the whole list. Doubling keeps the total work under twice the list even
// when every step renders the rendered items again (a drag group's context does). Returns how many items to render now.
const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 150 }) : setTimeout(fn, 16));
const unIdle = (id) => (typeof cancelIdleCallback === 'function' ? cancelIdleCallback(id) : clearTimeout(id));
// reset: a value (e.g. the team shown) – when it changes, the list starts again with `first` items (a new list of the
// same component must not mount all its items in one go either).
export function useProgressive(total, { first = 16, reset = null } = {}) {
  const [st, setSt] = useState(() => ({ n: Math.min(total, first), reset }));
  const n = st.reset === reset ? st.n : Math.min(total, first);
  if (st.reset !== reset) setSt({ n, reset }); // during render: React re-renders at once, before the commit
  useEffect(() => {
    if (n >= total) return undefined;
    const id = idle(() => startTransition(() => setSt((x) => (x.reset === reset ? { n: Math.min(total, Math.max(first, x.n * 2)), reset } : x))));
    return () => unIdle(id);
  }, [n, total, first, reset]);
  return Math.min(n, total);
}

// Spacers: a table row (colSpan) or a div.
export function SpacerRow({ height, cols }) {
  if (!height) return null;
  return <tr data-spacer="" aria-hidden="true" style={{ height }}><td colSpan={cols} style={{ padding: 0, border: 0 }} /></tr>;
}
export function SpacerDiv({ height }) {
  if (!height) return null;
  return <div data-spacer="" aria-hidden="true" style={{ height }} />;
}
// Browser find (Ctrl/⌘+F) only sees the rendered rows – say so under a windowed list.
export function FindNote({ count }) {
  return (
    <div className="faint" style={{ padding: '8px 12px', fontSize: 12 }}>
      {tr(`${count.toLocaleString('de-DE')} Zeilen – die Browser-Suche (Strg+F) findet nur sichtbare Zeilen; nutze die Suche oben.`, `${count.toLocaleString('en-GB')} rows – the browser's find (Ctrl+F) only sees visible rows; use the search above.`)}
    </div>
  );
}

// dev only: React commits of ≥ 16 ms with the id of the nearest <Prof> (window.__pcRenders, read by the perf check in the
// preview: which part of which view took how long). In production builds <Prof> is just its children.
export function devRender(id, phase, ms, base, start) {
  if (ms < 16 || typeof window === 'undefined') return;
  window.__pcRenders = [...(window.__pcRenders || []).slice(-300), { id, phase, ms: Math.round(ms), at: Math.round(start) }];
}
export function Prof({ id, children }) {
  return import.meta.env?.DEV ? <Profiler id={id} onRender={devRender}>{children}</Profiler> : children;
}
