import { useState } from 'react';
import { motion } from 'framer-motion';
import { sp } from '../lib/motion.js';
import { useApp } from '../state.jsx';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { Menu, useTip } from './ui.jsx';

// Top-right button (cockpit and configuration): always visible, with the number of actions that can be reverted.
// Every change of this session with its exact inverse, newest first.
// One click undoes one action; when a newer action changed the same thing, the row offers
// "back to here" instead, which undoes the newer ones first – never out of order.
export default function UndoHistory() {
  const { undoList, runUndo, undoUntil, blockedBy } = useApp();
  const [anchor, setAnchor] = useState(null);
  const [busy, setBusy] = useState(null);
  const tip = useTip();
  const top = undoList[0];
  const go = async (e, fn) => { setBusy(e.id); try { await fn(e); } finally { setBusy(null); } };
  const n = undoList.length;
  return (
    <div style={{ display: 'flex' }} data-undo>
          <button className={`btn btn-ghost undo-btn ${n ? 'has' : 'is-zero'}`} onClick={(ev) => { if (n) setAnchor(anchor ? null : ev.currentTarget); }} aria-expanded={!!anchor} aria-haspopup="menu" aria-disabled={!n}
            aria-label={n ? tr(`Rückgängig – ${n} ${n === 1 ? 'Aktion lässt' : 'Aktionen lassen'} sich zurücksetzen`, `Undo – ${n} ${n === 1 ? 'action' : 'actions'} can be reverted`) : tr('Rückgängig – noch nichts zu tun', 'Undo – nothing to undo yet')}
            {...tip(n
              ? <div><b>{tr('Rückgängig', 'Undo')}</b>: {top.label}<div style={{ opacity: 0.7 }}>{tr(`${n} ${n === 1 ? 'Aktion' : 'Aktionen'} in dieser Sitzung · Ctrl / ⌘ + Z · Klick zeigt den Verlauf`, `${n} ${n === 1 ? 'action' : 'actions'} this session · Ctrl / ⌘ + Z · click for history`)}</div></div>
              : <div><b>{tr('Rückgängig', 'Undo')}</b><div style={{ opacity: 0.75 }}>{tr('Jede Änderung, die du hier machst, landet hier und lässt sich mit einem Klick exakt zurücksetzen.', 'Every change you make here lands here and can be reverted exactly with one click.')}</div></div>)}>
            <Icon name="undo" size={20} />{/* no exit animation: inside the Jira frame it can stall and leave the old number on screen */}<motion.span key={n} className="undo-count num" initial={{ scale: 1.35 }} animate={{ scale: 1 }} transition={sp('pop')}>{n}</motion.span>
          </button>
          <Menu anchor={anchor} onClose={() => setAnchor(null)}>
            <div className="undo-pop">
              <div className="undo-head">
                <b>{tr('Verlauf dieser Sitzung', 'This session’s history')}</b>
                <span className="faint">{tr('Jede Aktion lässt sich exakt zurücksetzen.', 'Every action can be reverted exactly.')}</span>
              </div>
              <ul className="undo-list">
                {undoList.map((e, i) => {
                  const newer = blockedBy(e);
                  return (
                    <li key={e.id} className="undo-row">
                      <div className="undo-main">
                        <span className="undo-label">{e.label}</span>
                        <span className="faint">{fmt.ago(new Date(e.at).toISOString())}{i === 0 ? ' · Ctrl / ⌘ + Z' : ''}</span>
                      </div>
                      {newer ? (
                        <button className="btn btn-xs" disabled={!!busy} onClick={() => go(e, undoUntil)} title={tr(`„${newer.label}“ hat dasselbe geändert – macht alles bis hierher rückgängig`, `"${newer.label}" changed the same thing – undoes everything back to here`)}>
                          {busy === e.id ? '…' : tr('Bis hierher', 'Back to here')}
                        </button>
                      ) : (
                        <button className="btn btn-xs" disabled={!!busy} onClick={() => go(e, runUndo)}>{busy === e.id ? '…' : tr('Rückgängig', 'Undo')}</button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {undoList.length > 1 && (
                <button className="menu-item danger" disabled={!!busy} onClick={() => go(undoList.at(-1), undoUntil)}>
                  <Icon name="history" size={14} />{tr(`Alle ${undoList.length} rückgängig machen`, `Undo all ${undoList.length}`)}
                </button>
              )}
            </div>
          </Menu>
    </div>
  );
}
