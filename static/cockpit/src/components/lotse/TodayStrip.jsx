// "Heute für dich" – Lotse's three most important stories for the person's role, compact, at the top of
// "Meine Arbeit" and the portfolio. A click opens the full story in the Lotse panel. Dismissible for the day
// (this browser, localStorage – blocked storage just means it shows again). Enter animations only.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { enter, hoverLift } from '../../lib/motion.js';
import { useApp } from '../../state.jsx';
import { tr } from '../../lib/i18n.js';
import { Icon } from '../../lib/icons.jsx';
import { briefing, validStory, useLotseCtx } from './engine.js';
import { openLotse } from './open.js';
import { LotseMark } from './LotseChip.jsx';
import { splitUnit, TONE } from './visuals.jsx';
import { toneWord } from './StoryCard.jsx';
import './lotse.css';

const todayIso = () => new Date().toISOString().slice(0, 10);
const keyOf = (me, where) => `pc-lotse-today:${me || 'me'}:${where}`;
const hiddenToday = (k) => { try { return localStorage.getItem(k) === todayIso(); } catch { return false; } };
const hide = (k, on) => { try { if (on) localStorage.setItem(k, todayIso()); else localStorage.removeItem(k); } catch { /* private window */ } };

// where: 'mine' | 'portfolio' – each place remembers its own "hidden today".
export default function TodayStrip({ where = 'mine' }) {
  const { boot, pushUndo, runUndo, toast, lang } = useApp();
  const ctx = useLotseCtx();
  const k = keyOf(boot?.me?.id, where);
  const [hidden, setHidden] = useState(() => hiddenToday(k));
  const stories = useMemo(() => (ctx && !hidden ? (briefing(ctx) || []).filter(validStory).slice(0, 3) : []), [ctx, hidden, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  if (hidden || !stories.length) return null;
  const dismiss = () => {
    hide(k, true); setHidden(true);
    const e = pushUndo(tr('„Heute für dich“ ausgeblendet', '"Today for you" hidden'), async () => { hide(k, false); setHidden(false); }, [`lotse:today:${where}`]);
    toast({ text: tr('Für heute ausgeblendet – morgen ist es wieder da', 'Hidden for today – back tomorrow'), icon: 'check', undo: () => runUndo(e) });
  };
  return (
    <motion.section className="lt" aria-labelledby={`lt-${where}`} data-lotse-today={where} {...enter(0, { y: 8, d: 'gentle' })}>
      <header className="lt-head">
        <span className="lt-mark"><LotseMark size={14} /></span>
        <h2 id={`lt-${where}`}>{tr('Heute für dich', 'Today for you')}</h2>
        <span className="faint lt-sub">{tr('Lotse · aus euren Daten von jetzt', 'Lotse · from your data right now')}</span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => openLotse()}>{tr('Lotse fragen', 'Ask Lotse')}</button>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={dismiss} aria-label={tr('Für heute ausblenden', 'Hide for today')}><Icon name="x" size={14} /></button>
      </header>
      <div className="lt-list">
        {stories.map((s, i) => {
          const k0 = (s.kpis || [])[0];
          const [n, u] = k0 ? splitUnit(k0.unit, k0.value) : [null, null];
          return (
            <motion.button key={s.id || i} type="button" className={`lt-item is-${s.tone}`} onClick={() => openLotse({ story: s })}
              aria-label={`${toneWord(s.tone)}: ${s.headline} ${tr('– öffnen', '– open')}`}
              {...enter(i, { y: 8, d: 'gentle', delay: 0.08 })} {...hoverLift()}>
              <span className="lt-top">
                <span className={`ls-verdict ${s.tone}`}><i aria-hidden="true" />{toneWord(s.tone)}</span>
                {s.subject?.name && s.subject.kind !== 'portfolio' && <span className="lt-subj">{s.subject.name}</span>}
              </span>
              <span className="lt-h">{s.headline}</span>
              {k0 && (
                <span className="lt-kpi">
                  <b className="num" style={{ color: k0.tone && k0.tone !== 'info' ? TONE[k0.tone] : undefined }}>{n}{u && <small>{u}</small>}</b>
                  <span className="faint">{k0.label}</span>
                  <Icon name="arrowRight" size={13} />
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </motion.section>
  );
}
