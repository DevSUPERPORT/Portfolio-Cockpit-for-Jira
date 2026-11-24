// The header pill while a Lotse job waits for the person (or is being applied): title, where it stands, one click back
// into the run. Tiny on purpose – App imports it directly (runStore, no engine).
import { useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { enter, hoverLift } from '../../lib/motion.js';
import { tr } from '../../lib/i18n.js';
import { runStore, activeRun } from './runStore.js';
import { progressOf } from './acts.js';
import { openLotse } from './open.js';
import { LotseMark } from './LotseChip.jsx';
import './lotse.css';
import './acts.css';

export default function RunPill() {
  const snap = useSyncExternalStore(runStore.subscribe, runStore.get, runStore.get);
  const r = activeRun(snap);
  if (!r) return null;
  const p = progressOf(r.state);
  const applying = r.phase === 'applying';
  const where = applying ? tr('wird ausgeführt', 'applying') : p.total ? tr(`Schritt ${Math.min(p.done + 1, p.total)} von ${p.total}`, `step ${Math.min(p.done + 1, p.total)} of ${p.total}`) : tr('läuft', 'running');
  return (
    <motion.button type="button" className="lx-pill" data-lotse-run={r.id} title={`${r.state.title} · ${where}`} onClick={() => openLotse({ run: r.id })} aria-label={tr(`Lotse-Aufgabe fortsetzen: ${r.state.title}, ${where}`, `Continue the Lotse job: ${r.state.title}, ${where}`)}
      {...enter(0, { y: 0, scale: 0.9, spring: 'chip' })} {...hoverLift(-1)}>
      <span className="lx-pill-dot" aria-hidden="true" />
      <LotseMark size={14} spin={applying} />
      <span className="lx-pill-t">{r.state.title}</span>
      <span className="lx-pill-n num">{applying ? '…' : p.total ? `${Math.min(p.done + 1, p.total)}/${p.total}` : ''}</span>
    </motion.button>
  );
}
