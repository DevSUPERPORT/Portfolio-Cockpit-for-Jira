// Tab bar with scroll arrows: when not every tab fits, an arrow appears on the side where tabs are hidden.
// A click scrolls by most of the visible width; the active tab always scrolls into view; ← / → move between
// tabs from the keyboard (standard tablist behaviour). The arrows are hidden from screen readers because every
// tab is reachable with the keyboard anyway.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { enter } from '../lib/motion.js';
import { tr } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';

export default function TabScroller({ children, active, label, tour }) {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 });
  }, []);
  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return undefined;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); el.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
  }, [measure]);
  // keep the active tab in view (after a jump from search, a deep link or the keyboard). Read after the next paint:
  // right after the commit the new area is not laid out yet, and reading offsetLeft / scrollLeft then forced the whole
  // page's layout in the middle of the tab switch (measured: 230–380 ms on a big site). A paint later it is free.
  useEffect(() => {
    let t = 0;
    const raf = requestAnimationFrame(() => { t = setTimeout(() => {
      const el = ref.current;
      const tab = el?.querySelector('[aria-selected="true"]');
      if (!el || !tab) return;
      const l = tab.offsetLeft, r = l + tab.offsetWidth;
      if (l < el.scrollLeft + 32) el.scrollTo({ left: Math.max(0, l - 48), behavior: 'smooth' });
      else if (r > el.scrollLeft + el.clientWidth - 32) el.scrollTo({ left: r - el.clientWidth + 48, behavior: 'smooth' });
    }, 0); });
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [active]);
  const page = (dir) => { const el = ref.current; if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' }); };
  // ← / → between tabs, Home / End to the first / last
  const onKeyDown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...ref.current.querySelectorAll('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  };
  return (
    <div className={`tabs-wrap ${edge.left ? 'fade-l' : ''} ${edge.right ? 'fade-r' : ''}`}>
      {edge.left && (
        <motion.button key="l" type="button" className="tabs-arrow l" aria-hidden="true" tabIndex={-1} title={tr('Weitere Bereiche links', 'More areas to the left')}
          {...enter(0, { y: 0, x: 6, d: 'quick' })} onClick={() => page(-1)}>
          <Icon name="chevron" size={15} style={{ transform: 'rotate(180deg)' }} />
        </motion.button>
      )}
      <nav ref={ref} className="tabs" role="tablist" aria-label={label} data-tour={tour} onKeyDown={onKeyDown}>{children}</nav>
      {edge.right && (
        <motion.button key="r" type="button" className="tabs-arrow r" aria-hidden="true" tabIndex={-1} title={tr('Weitere Bereiche rechts', 'More areas to the right')}
          {...enter(0, { y: 0, x: -6, d: 'quick' })} onClick={() => page(1)}>
          <Icon name="chevron" size={15} />
        </motion.button>
      )}
    </div>
  );
}
