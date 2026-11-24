// Lotse's mark (a compass needle) and the small "Lotse" chip the views place next to their KI buttons.
// The chip only opens the panel with one skill – the views stay free of Lotse's code (see open.js).
import { motion } from 'framer-motion';
import { LOOP, isReduced, hoverLift } from '../../lib/motion.js';
import { tr } from '../../lib/i18n.js';
import { openLotse } from './open.js';
import './lotse.css';

export function LotseMark({ size = 16, spin = false }) {
  return (
    <motion.svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="lotse-mark"
      animate={spin && !isReduced() ? { rotate: [0, 18, -10, 0] } : undefined} transition={spin ? { duration: LOOP.idle, repeat: Infinity, repeatDelay: 4, ease: 'easeInOut' } : undefined}>
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M14.9 9.1 10.6 10.6 9.1 14.9 13.4 13.4Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12 2.8v1.6M12 19.6v1.6M2.8 12h1.6M19.6 12h1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </motion.svg>
  );
}

// skill + params: what Lotse should show (projectBrief { ref }, teamBrief { team }, myWeek { person }, portfolioBrief,
// planActualExplain { team }, supportTopics). extra: data the view already loaded that the skill reads from its context
// (planActual: the planActual.get payload, mine: the mine.week payload). label: the visible text (defaults to "Lotse").
export function LotseChip({ skill, params, extra = null, label, title, className = '' }) {
  return (
    <motion.button type="button" className={`chip lotse-chip ${className}`} data-lotse-skill={skill} {...hoverLift(-1)}
      onClick={() => openLotse({ skill, params: params || {}, ...(extra ? { extra } : {}) })}
      title={title || tr('Lotse zeigt die Lage als Bild – aus euren Daten, ohne KI', 'Lotse shows the situation as a picture – from your data, without AI')}>
      <LotseMark size={13} />{label || 'Lotse'}
    </motion.button>
  );
}
