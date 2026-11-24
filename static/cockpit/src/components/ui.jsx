import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, animate, useMotionValue, useTransform } from 'framer-motion';
import { Icon } from '../lib/icons.jsx';
import { tr, fmt, healthName } from '../lib/i18n.js';
import { SPRING, enter, tween, sp, delayOf, popIn, fadeIn, panelIn, countMode, countUpT, countChangeT, layoutT, hoverLift } from '../lib/motion.js';

// Shared with the views (lib/motion.js is the source of every timing): spring = the chip preset (pills, indicators),
// softSpring = the card preset. fadeUp / stagger are reduced-motion aware (read when spread) and never have an exit.
export const spring = SPRING.chip;
export const softSpring = SPRING.card;
export const fadeUp = {
  get initial() { return enter(0, { y: 8, d: 'gentle' }).initial; },
  get animate() { const e = enter(0, { y: 8, d: 'gentle' }); return { ...e.animate, transition: e.transition }; },
};
export const stagger = (i, step) => {
  const e = enter(i, { y: 8, d: 'gentle' });
  if (step && e.transition.delay) e.transition = { ...e.transition, delay: delayOf(i, step) };
  return { initial: e.initial, animate: { ...e.animate, transition: e.transition } };
};

// ---------- animated number ----------
// Count-up only the first time (lib/motion.js countMode): on the cockpit's first screen numbers count up from zero;
// later they show at once and glide to a changed value. Reduced motion or a hidden tab: the value at once.
export function Counter({ value, format = (v) => fmt.n(v), className }) {
  const [mode] = useState(countMode);
  const mv = useMotionValue(mode === 'count' || !Number.isFinite(value) ? 0 : value);
  const text = useTransform(mv, (v) => format(v));
  const first = useRef(true);
  useEffect(() => {
    if (value == null || !Number.isFinite(value)) return undefined;
    const isFirst = first.current;
    first.current = false;
    if ((isFirst && mode !== 'count') || document.hidden) { mv.set(value); return undefined; }
    const c = animate(mv, value, isFirst ? countUpT() : countChangeT());
    return () => c.stop();
  }, [value, mv]); // eslint-disable-line react-hooks/exhaustive-deps
  if (value == null || !Number.isFinite(value)) return <span className={className}>–</span>;
  return <motion.span className={`num ${className || ''}`}>{text}</motion.span>;
}

// ---------- progress ring ----------
export function Ring({ value = 0, size = 44, stroke = 5, color = 'var(--ink)', track = 'var(--sunken)', label, children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - v) }} transition={tween('gentle')} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: size > 60 ? 15 : 11 }} className="ring-label">
        {children ?? label}
      </div>
    </div>
  );
}

// ---------- segmented control ----------
export function Segmented({ value, onChange, options, size, label }) {
  const id = useId();
  return (
    <div className={`seg ${size === 'sm' ? 'seg-sm' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="seg-btn" aria-pressed={value === o.value} disabled={o.disabled} onClick={() => onChange(o.value)} title={o.title}>
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="seg-pill" transition={layoutT()} />}
          {o.icon && <Icon name={o.icon} size={14} />}{o.label}
        </button>
      ))}
    </div>
  );
}

// One button for the whole control (track and text), so every click toggles exactly once.
export function Switch({ on, onChange, label, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} disabled={disabled} className="switch" data-on={!!on} onClick={() => onChange(!on)}>
      <span className="switch-track" aria-hidden="true">
        <motion.span className="switch-thumb" initial={false} animate={{ x: on ? 15 : 0 }} transition={sp('chip')} />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}

// Initials on a stable warm tone per person. No external images: the app makes no egress calls (Runs on Atlassian).
const AVATAR_TONES = [['#F3D9C9', '#7A3410'], ['#E4E0D6', '#3F3C36'], ['#D9E6DD', '#24563D'], ['#DCE3F2', '#2E447C'], ['#F2E3C4', '#6B4A00'], ['#EAD9E8', '#5E2F5A']];
// onClick + label: the avatar becomes a button (the header's personal menu)
export function Avatar({ user, size = 24, onClick, label, expanded }) {
  if (!user) return <span className="avatar" style={{ width: size, height: size }}><Icon name="user" size={size * 0.55} /></span>;
  const name = user.name || '';
  const initials = name.split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  let h = 0;
  for (const ch of user.id || name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATAR_TONES[h % AVATAR_TONES.length];
  if (onClick) {
    return (
      <button type="button" className="avatar avatar-btn" style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38), background: bg, color: fg }} onClick={onClick} aria-label={label || name} aria-haspopup="dialog" aria-expanded={!!expanded}>
        {initials || '·'}
      </button>
    );
  }
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.max(9, size * 0.38), background: bg, color: fg }} title={name || undefined} aria-label={name || undefined}>
      {initials || '·'}
    </span>
  );
}

export function Lozenge({ status }) {
  if (!status) return null;
  return <span className={`lozenge ${status.cat}`}>{status.name}</span>;
}

export function Skeleton({ h = 16, w = '100%', r, style }) {
  return <div className="skel" style={{ height: h, width: w, borderRadius: r, ...style }} />;
}

export function Empty({ icon = 'sparkle', title, children, action }) {
  return (
    <motion.div className="empty" {...enter(0, { y: 8, d: 'gentle' })}>
      <motion.div {...enter(0, { y: 0, scale: 0.7, spring: 'pop', delay: 0.05 })}
        style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--sunken)', display: 'grid', placeItems: 'center', color: 'var(--ink-2)' }}>
        <Icon name={icon} size={24} />
      </motion.div>
      {title && <h3>{title}</h3>}
      {children && <p>{children}</p>}
      {action}
    </motion.div>
  );
}

export function Stat({ label, value, format, unit, foot, hot, i = 0, children, onClick, explain }) {
  const Tag = onClick ? motion.button : motion.div;
  const tip = useContext(TipCtx);
  return (
    <Tag className={`stat ${hot ? 'hot' : ''} ${onClick ? 'is-click' : ''}`} {...enter(i, { y: 8, d: 'gentle' })} onClick={onClick} style={onClick ? { textAlign: 'left', cursor: 'pointer' } : undefined}
      {...(explain ? { tabIndex: onClick ? undefined : 0, ...tip(infoCard({ title: label, ...explain })) } : {})}
      {...(onClick ? hoverLift() : {})}>
      <div className="eyebrow">{label}</div>
      <div className="stat-value">{typeof value === 'number' ? <Counter value={value} format={format} /> : value}{unit && <span className="stat-unit">{unit}</span>}</div>
      {foot && <div className="stat-foot">{foot}</div>}
      {children}
    </Tag>
  );
}

export function Spark({ values, w = 90, h = 28, color = 'var(--accent)' }) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * (w - 4) + 2, h - 3 - (v / max) * (h - 6)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} aria-hidden="true">
      <motion.path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...fadeIn('gentle')} />{/* a fade, not pathLength: the dash pattern can leave gaps */}
      <circle cx={pts.at(-1)?.[0]} cy={pts.at(-1)?.[1]} r={2.8} fill={color} />
    </svg>
  );
}

// ---------- tooltip ----------
const TipCtx = createContext(() => ({}));
// Input state shared by every tip: touch never opens hover cards (a tap would leave them standing), focus opens them only
// from the keyboard (a mouse click focuses too – that card stayed after the pointer left: the "ghost" over the page).
const input = { touchAt: 0, keyboard: false };
const fromTouch = () => Date.now() - input.touchAt < 900;
const stillWanted = (el) => {
  if (!el || !el.isConnected) return false;
  try { return el.matches(':hover') || (input.keyboard && el.matches(':focus-within')); } catch { return true; }
};
export function TipProvider({ children }) {
  const [tip, setTip] = useState(null);
  // data-has-tip marks every explained element (the UI audit and the live harness check that nothing is left unexplained)
  const bind = useCallback((content) => ({
    ...(content ? { 'data-has-tip': 'true' } : {}),
    // mouseover/mouseout (plain bubbling events) instead of React's derived mouseenter: the derived event was not
    // delivered when the pointer moved onto an element from another element inside the app (live finding 2026-11-10)
    onMouseOver: (e) => { const el = e.currentTarget; if (e.target.closest?.('[data-has-tip]') !== el) return; /* the innermost explained element wins */ if (fromTouch()) return; const r = el.getBoundingClientRect(); setTip((t) => (t && !t.auto && t.el === el ? t : { content, r, el })); },
    onMouseOut: (e) => { const el = e.currentTarget; if (!e.relatedTarget || !el.contains(e.relatedTarget)) setTip((t) => (t && t.el && t.el !== el ? t : null)); },
    onMouseLeave: () => setTip(null),
    onFocus: (e) => { if (!input.keyboard) return; const el = e.currentTarget; const r = el.getBoundingClientRect(); setTip({ content, r, el }); },
    onBlur: () => setTip(null),
  }), []);
  // Every icon-only control explains itself: hovering or focusing a button/link without visible text shows its
  // aria-label (nothing to remember for new buttons). Elements with their own explanation are left alone.
  useEffect(() => {
    const iconOnly = (t) => {
      const el = t?.closest?.('button, a, [role="button"], [role="switch"]');
      if (!el || el.getAttribute('data-has-tip') || el.closest('[data-has-tip]') || el.title) return null;
      const label = el.getAttribute('aria-label');
      if (!label || (el.innerText || '').replace(/\s+/g, '').length > 2) return null;
      return { el, label };
    };
    let cur = null;
    const show = (e) => { if (fromTouch() || (e.type === 'focusin' && !input.keyboard)) return; const x = iconOnly(e.target); if (!x || x.el === cur) return; cur = x.el; setTip({ content: <span>{x.label}</span>, r: x.el.getBoundingClientRect(), auto: true, el: x.el }); };
    const hide = (e) => { if (cur && (!e.relatedTarget || !cur.contains(e.relatedTarget))) { cur = null; setTip((t) => (t?.auto ? null : t)); } };
    // a hover card never outlives the gesture that opened it: any press, scroll, wheel, resize, Escape or hidden tab closes it
    const closeAll = () => { cur = null; setTip(null); };
    const onDown = (e) => { input.keyboard = false; if (e.pointerType && e.pointerType !== 'mouse') input.touchAt = Date.now(); closeAll(); };
    const onKey = (e) => { if (e.key === 'Escape') closeAll(); else if (e.key === 'Tab' || e.key.startsWith('Arrow')) input.keyboard = true; };
    const onVis = () => { if (document.hidden) closeAll(); };
    document.addEventListener('mouseover', show); document.addEventListener('focusin', show);
    document.addEventListener('mouseout', hide); document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', closeAll, true); window.addEventListener('wheel', closeAll, { passive: true }); window.addEventListener('resize', closeAll);
    window.addEventListener('blur', closeAll); document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('mouseover', show); document.removeEventListener('focusin', show); document.removeEventListener('mouseout', hide); document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', closeAll, true); window.removeEventListener('wheel', closeAll); window.removeEventListener('resize', closeAll);
      window.removeEventListener('blur', closeAll); document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  // A card whose element left the page (tab switch, list re-render) or is neither hovered nor keyboard-focused any more
  // (a missed mouseout – the pointer left the Jira frame, the view changed under it) closes itself.
  useEffect(() => {
    if (!tip?.el) return undefined;
    const t = setInterval(() => { if (!stillWanted(tip.el)) setTip((x) => (x === tip ? null : x)); }, 200);
    return () => clearInterval(t);
  }, [tip]);
  return (
    <TipCtx.Provider value={bind}>
      {children}
      {createPortal(tip ? <TipBox key={`${tip.r.x}:${tip.r.y}`} tip={tip} /> : null, document.body) /* no exit animation: it can stall in the Jira frame and leave old cards on screen */}
    </TipCtx.Provider>
  );
}
function TipBox({ tip }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: tip.r.left, top: tip.r.bottom + 8 });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = tip.r.left + tip.r.width / 2 - w / 2;
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    let top = tip.r.top - h - 8;
    if (top < 8) top = tip.r.bottom + 8;
    // a tall card that fits neither above nor below stays inside the window
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    setPos({ left, top });
  }, [tip]);
  const card = tip.content && typeof tip.content === 'object' && tip.content.__card ? tip.content.__card : null;
  return (
    <motion.div ref={ref} className={card ? 'tooltip tip-card' : 'tooltip'} style={pos} role="tooltip" {...popIn({ y: 4 })}>
      {card ? <InfoCard k={card} /> : tip.content}
    </motion.div>
  );
}
export const useTip = () => useContext(TipCtx);

// The white/grey explanation card (the same look as the KPI tiles) for ANY hover: tip(infoCard({ ... })).
//   title, sub       – what this is
//   text             – what it means, in one or two sentences
//   calc             – the calculation with the real numbers
//   inputs           – [label, value] pairs
//   items, itemsTitle – what is behind the number ({ text, sub, tone: ok|warn|bad })
export const infoCard = (k) => ({ __card: k });
const CARD_TONE = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' };
export function InfoCard({ k: k0, max = 8 }) {
  // parts may be a function: computed only when the card is actually shown (boards render hundreds of cards)
  const k = typeof k0.parts === 'function' ? { ...k0, parts: k0.parts() } : k0;
  const items = k.items || [];
  return (
    <div className="kpi-breakdown">
      {(k.title || k.sub) && <div className="tip-card-head">{k.title && <b>{k.title}</b>}{k.sub && <span>{k.sub}</span>}</div>}
      {k.text && <div className="kpi-pop-def">{k.text}</div>}
      {k.calc && <div className="kpi-calc"><span>{tr('Rechnung', 'Calculation')}</span><code>{k.calc}</code></div>}
      {(k.inputs || []).length > 0 && <dl className="kpi-inputs">{k.inputs.map(([a, b]) => <div key={a}><dt>{a}</dt><dd className="num">{b}</dd></div>)}</dl>}
      {k.parts?.length > 0 && (
        // all parts of one task, the hovered one highlighted (WeekBoard task cards)
        <div className="kpi-parts">
          {k.partsTitle && <div className="label" style={{ margin: '0 0 6px' }}>{k.partsTitle}</div>}
          <ol>{k.parts.map((p) => <li key={p.label} className={`${p.on ? 'on' : ''} ${p.late ? 'late' : ''}`} aria-current={p.on || undefined}><span>{p.label}</span><b className="num">{p.value}</b></li>)}</ol>
        </div>
      )}
      {items.length > 0 && (
        <div className="kpi-items">
          {k.itemsTitle && <div className="label" style={{ margin: '0 0 6px' }}>{k.itemsTitle} · {items.length}</div>}
          <ul>{items.slice(0, max).map((x, j) => <li key={j}><i style={{ background: CARD_TONE[x.tone] || 'var(--line-strong)' }} /><div><span>{x.text}</span>{x.sub && <div className="faint">{x.sub}</div>}</div></li>)}</ul>
          {items.length > max && <div className="faint" style={{ fontSize: 12 }}>{tr(`+ ${items.length - max} weitere`, `+ ${items.length - max} more`)}</div>}
        </div>
      )}
      {k.hint && <div className="kpi-hint"><span>{k.hint}</span></div>}
    </div>
  );
}

// facts (optional): { progress, overdue, daysOverdue, conflicts, staffable } – what usually explains a colour, so
// "88 % done but critical" is never a riddle: health is the owner's judgement, the facts are calculated.
export function HealthDot({ health, rhythmDays = 7, size, facts }) {
  const tip = useTip();
  // UC-12: no update rhythm and no reminder – the card shows the age; only a project without any update is marked
  const due = !health; void rhythmDays;
  const why = facts ? [
    facts.overdue > 0 ? [tr('Stories über Due Date', 'Stories past due'), String(facts.overdue)] : null,
    facts.daysOverdue > 0 ? [tr('Projekt über Due Date', 'Project past due'), tr(`${facts.daysOverdue} Tage`, `${facts.daysOverdue} days`)] : null,
    facts.conflicts > 0 ? [tr('Terminkonflikte', 'Date conflicts'), String(facts.conflicts)] : null,
    facts.staffable === false ? [tr('Kapazität', 'Capacity'), tr('nicht voll besetzbar', 'not fully staffable')] : null,
    facts.progress != null ? [tr('Fortschritt', 'Progress'), `${Math.round(facts.progress * 100)} %`] : null,
  ].filter(Boolean) : [];
  return (
    <span tabIndex={0} {...tip(infoCard({
      title: `Health: ${healthName(health?.status)}`,
      sub: health ? `${health.byName ? `${tr('gesetzt von', 'set by')} ${health.byName} · ` : ''}${fmt.ago(health.at)}` : tr('noch kein Health-Update', 'no health update yet'),
      text: [health?.comment ? `„${health.comment}“` : null, tr('Health ist die Einschätzung des Owners – nicht berechnet. Der Fortschritt misst nur gebuchte gegen offene Stunden; ein fast fertiges Projekt kann trotzdem kritisch sein, z. B. wegen Verzug.', 'Health is the owner\'s judgement – not calculated. Progress only measures logged against open hours; a nearly finished project can still be critical, e.g. because it is late.')].filter(Boolean).join(' '),
      inputs: why,
      hint: why.length ? tr('Das sind die berechneten Fakten dazu.', 'These are the calculated facts.') : null,
    }))} className={`health ${health?.status || 'none'} ${due ? 'due' : ''}`} style={size ? { width: size, height: size } : undefined} />
  );
}

// ---------- overlays ----------
function useEscape(open, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}
export function Modal({ open, onClose, title, sub, icon, children, footer, width }) {
  useEscape(open, onClose);
  return createPortal(
    // no exit animations (they stall in the Jira frame): closing simply unmounts
    open ? <>
        <motion.div className="scrim" {...fadeIn()} onClick={onClose} />
        <div className="modal-wrap">
          <motion.div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { width: `min(${width}px, 100%)` } : undefined}
            {...enter(0, { y: 16, scale: 0.97, spring: 'panel' })}>
            <div className="modal-head">
              {icon && <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--accent-soft)', color: 'var(--accent-strong)', display: 'grid', placeItems: 'center', flex: 'none' }}><Icon name={icon} size={20} /></div>}
              <div className="grow"><div className="h2">{title}</div>{sub && <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>{sub}</div>}</div>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label={tr('Schließen', 'Close')}><Icon name="x" /></button>
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-foot">{footer}</div>}
          </motion.div>
        </div>
      </> : null, document.body);
}
export function Drawer({ open, onClose, title, sub, children }) {
  useEscape(open, onClose);
  return createPortal(
    open ? <>
        <motion.div className="scrim" {...fadeIn()} onClick={onClose} />
        <motion.aside className="drawer" role="dialog" aria-modal="true" aria-label={title} {...panelIn({ x: 48 })}>
          <div className="drawer-head">
            <div className="grow"><div className="h2">{title}</div>{sub && <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{sub}</div>}</div>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label={tr('Schließen', 'Close')}><Icon name="x" /></button>
          </div>
          <div className="drawer-body">{children}</div>
        </motion.aside>
      </> : null, document.body);
}
export function Menu({ anchor, onClose, children, align = 'end', role = 'menu', label }) {
  useEscape(!!anchor, onClose);
  useEffect(() => {
    if (!anchor) return undefined;
    const h = () => onClose();
    const t = setTimeout(() => window.addEventListener('click', h), 0);
    return () => { clearTimeout(t); window.removeEventListener('click', h); };
  }, [anchor, onClose]);
  const r = anchor?.getBoundingClientRect();
  return createPortal(
    anchor ? (
        <motion.div className="popover" role={role} aria-label={label} style={{ top: Math.min(r.bottom + 6, window.innerHeight - 220), ...(align === 'end' ? { right: window.innerWidth - r.right } : { left: r.left }) }}
          {...popIn({ y: -6 })}
          onClick={(e) => e.stopPropagation()}>
          {children}
        </motion.div>
      ) : null, document.body);
}

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [list, setList] = useState([]);
  const push = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setList((l) => [...l.slice(-2), { id, ...t }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.ms || (t.undo ? 6500 : 3800));
    return id;
  }, []);
  const dismiss = (id) => setList((l) => l.filter((x) => x.id !== id));
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {/* enter only – a dismissed toast unmounts at once (exits stall in the Jira frame); the others glide into place */}
          {list.map((t) => (
              <motion.div key={t.id} layout="position" className={`toast ${t.error ? 'err' : ''}`} {...enter(0, { y: 16, scale: 0.96, spring: 'card' })}>
                <Icon name={t.error ? 'alert' : t.icon || 'check'} size={16} />
                <span>{t.text}</span>
                {t.undo && <button className="btn btn-xs" onClick={() => { t.undo(); dismiss(t.id); }}>{tr('Rückgängig', 'Undo')}</button>}
                <button className="btn btn-xs btn-icon" style={{ width: 28 }} onClick={() => dismiss(t.id)} aria-label={tr('Schließen', 'Close')}><Icon name="x" size={13} /></button>
              </motion.div>
          ))}
        </div>, document.body)}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
