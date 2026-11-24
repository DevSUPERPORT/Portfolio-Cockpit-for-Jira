// Konfiguration › KI & Datenschutz › "Lotse lernt": phrasings Lotse did not understand and the AI mapped to an answer.
// Only the phrase pattern is kept ({name} = a name removed) – no person, no data. Approve → Lotse understands it for
// everyone, without AI; reject → it is ignored. Every decision can be undone (toast, Ctrl Z, history).
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { enter } from '../lib/motion.js';
import { useApp, errText } from '../state.jsx';
import { tr, fmt, getLang } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call } from '../lib/api.js';
import { SKILLS } from '@shared/lotse/skills/index.js';
import { learnedStore } from '../lib/lotseLearned.js';
import { LotseMark } from './lotse/LotseChip.jsx';
import { track } from '../lib/usage.js';
import './Usage.css';

const STATUS = { pending: ['offen', 'open'], approved: ['freigegeben', 'approved'], rejected: ['abgelehnt', 'rejected'] };

export default function LotseLearned() {
  const { toast, pushUndo, runUndo } = useApp();
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => { let alive = true; call('lotse.learned').then((r) => alive && setItems(r?.items || []), () => alive && setErr(true)); return () => { alive = false; }; }, []);
  const put = (item) => setItems((xs) => (xs || []).map((x) => (x.id === item.id ? item : x)));
  const decide = async (x, decision) => {
    setBusy(x.id);
    try {
      const r = await call('lotse.learn.review', { id: x.id, decision });
      put(r.item);
      learnedStore.refresh();
      track(decision === 'approve' ? 'learn:approve' : 'learn:reject');
      const label = tr(`Lotse lernt: „${x.pattern}“ ${decision === 'approve' ? 'freigegeben' : 'abgelehnt'}`, `Lotse learns: "${x.pattern}" ${decision === 'approve' ? 'approved' : 'rejected'}`);
      const entry = pushUndo(label, async () => { const u = await call('lotse.learn.review', { id: x.id, decision: r.previous }); put(u.item); learnedStore.refresh(); }, [`learn:${x.id}`]);
      toast({ text: label, icon: 'check', undo: () => runUndo(entry) });
    } catch (e) { toast({ text: errText(e), error: true }); } finally { setBusy(null); }
  };
  const open = (items || []).filter((x) => x.status === 'pending').length;
  return (
    <section className="ll" data-lotse-learned aria-labelledby="ll-title">
      <div className="us-head">
        <span className="aib-icon"><LotseMark size={16} /></span>
        <div><b id="ll-title">{tr('Lotse lernt von der KI', 'Lotse learns from the AI')}{open ? <span className="ll-count">{open}</span> : null}</b>
          <div className="muted aib-sub">{tr('Fragen, die Lotse nicht verstand und die KI einer Antwort zuordnete. Gespeichert ist nur das Satzmuster – Namen, Keys und Zahlen sind entfernt, keine Person. Freigegeben versteht Lotse sie für alle, ohne KI.', 'Questions Lotse did not understand and the AI mapped to an answer. Only the phrase pattern is stored – names, keys and numbers removed, no person. Once approved, Lotse understands it for everyone, without AI.')}</div></div>
      </div>
      {err && <div className="aib-note warn" role="status"><Icon name="info" size={14} /><span>{tr('Die Lernvorschläge konnten gerade nicht geladen werden.', 'The learning suggestions could not be loaded right now.')}</span></div>}
      {items && !items.length && <p className="faint ll-empty">{tr('Noch keine Vorschläge. Sie entstehen, wenn jemand mit eingeschalteter KI eine Frage stellt, die Lotse noch nicht kennt.', 'No suggestions yet. They appear when someone with AI on asks a question Lotse does not know yet.')}</p>}
      {items && items.length > 0 && (
        <ul className="ll-list" aria-label={tr('Lernvorschläge', 'Learning suggestions')}>
          {items.slice(0, 50).map((x, i) => (
            <motion.li key={x.id} className={`ll-item ${x.status}`} {...enter(i, { y: 4 })}>
              <div className="ll-main">
                <span className="ll-pattern">{tr(`„${x.pattern}“`, `"${x.pattern}"`)}</span>
                <span className="muted ll-to"><Icon name="arrowRight" size={11} />{SKILLS[x.skill]?.title(getLang()) || x.skill}</span>
              </div>
              <span className="faint ll-meta num">{tr(`${x.n}× · zuletzt ${fmt.date(x.last)}`, `${x.n}× · last ${fmt.date(x.last)}`)}</span>
              <span className={`ll-status ${x.status}`}>{tr(...STATUS[x.status])}</span>
              <span className="ll-acts">
                {x.status !== 'approved' && <button type="button" className="btn btn-xs" disabled={busy === x.id} onClick={() => decide(x, 'approve')} aria-label={tr(`„${x.pattern}“ freigeben`, `Approve "${x.pattern}"`)}><Icon name="check" size={12} />{tr('Freigeben', 'Approve')}</button>}
                {x.status !== 'rejected' && <button type="button" className="btn btn-xs btn-ghost" disabled={busy === x.id} onClick={() => decide(x, 'reject')} aria-label={tr(`„${x.pattern}“ ablehnen`, `Reject "${x.pattern}"`)}><Icon name="x" size={12} />{tr('Ablehnen', 'Reject')}</button>}
              </span>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}
