import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { aiOn } from '../lib/aiFlags.js';
import { useApp, errText } from '../state.jsx';
import { tr, getLang } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call } from '../lib/api.js';
import { Drawer, spring } from '../components/ui.jsx';

// Tiny, safe markdown: bullets and **bold** only, rendered as React nodes (never as HTML).
export function Md({ text }) {
  const lines = String(text || '').split('\n').map((l) => l.trimEnd()).filter((l, i, a) => l || (i > 0 && a[i - 1]));
  const inline = (s) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));
  const out = [];
  let list = null;
  lines.forEach((l, i) => {
    const m = /^\s*(?:[-•*]|\d+\.)\s+(.*)$/.exec(l);
    if (m) { if (!list) { list = []; out.push(<ul key={`u${i}`} style={{ margin: '4px 0', paddingLeft: 18 }}>{list}</ul>); } list.push(<li key={i} style={{ margin: '3px 0' }}>{inline(m[1])}</li>); }
    else { list = null; const h = /^#+\s*/.test(l); if (l.trim()) out.push(<p key={i} style={{ margin: h ? '8px 0 4px' : '4px 0', fontWeight: h ? 600 : undefined }}>{inline(l.replace(/^#+\s*/, ''))}</p>); }
  });
  return <>{out}</>;
}

function Typewriter({ text }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const words = text.split(/(\s+)/);
    let i = 0;
    const t = setInterval(() => { i += 3; setN(i); if (i >= words.length) clearInterval(t); }, 28);
    return () => clearInterval(t);
  }, [text]);
  const shown = text.split(/(\s+)/).slice(0, n).join('');
  return <Md text={shown} />;
}

const THINKING = [['Lese Rangfolge …', 'Reading the ranking …'], ['Prüfe die Wasserlinie …', 'Checking the waterline …'], ['Suche Terminkonflikte …', 'Looking for schedule conflicts …'], ['Formuliere die Antwort …', 'Writing the answer …']];

export default function Assistant() {
  const { assistant, openAssistant, computed, lang, config } = useApp();
  const allowed = aiOn(config, 'ask');
  const open = !!assistant && allowed;
  const [ref, setRef] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(0);
  const listRef = useRef(null);
  const asked = useRef(null);
  const project = ref ? computed?.model.itemByRef.get(ref) : null;
  const suggestions = useMemo(() => (project ? [
    tr(`Wie steht ${project.name} und was ist jetzt zu tun?`, `How is ${project.name} doing and what should happen now?`),
    tr('Welche Abhängigkeiten gefährden den Termin?', 'Which dependencies put the date at risk?'),
    tr('Reicht die Kapazität im nächsten Quartal?', 'Is there enough capacity next quarter?'),
  ] : [
    tr('Was braucht diese Woche meine Aufmerksamkeit?', 'What needs my attention this week?'),
    tr('Welche Teams sind überlastet und wodurch?', 'Which teams are overloaded and why?'),
    tr('Ab welchem Rang reicht die Kapazität nicht mehr?', 'From which rank does capacity run out?'),
    tr('Fasse den Portfolio-Status in 3 Sätzen zusammen.', 'Summarize the portfolio status in 3 sentences.'),
  ]), [project, lang]);

  const send = async (question) => {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setQ('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true); setPhase(0);
    const timer = setInterval(() => setPhase((p) => Math.min(THINKING.length - 1, p + 1)), 1600);
    try {
      const r = await call('ai.ask', { question: text, ref, lang: getLang() });
      setMsgs((m) => [...m, { role: 'ai', text: r.text, source: r.source }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'ai', text: errText(e), source: 'error' }]);
    } finally { clearInterval(timer); setBusy(false); }
  };
  useEffect(() => {
    if (!assistant) return;
    setRef(assistant.ref || null);
    if (assistant.question && asked.current !== assistant) { asked.current = assistant; send(assistant.question); }
  }, [assistant]); // eslint-disable-line
  useEffect(() => { listRef.current?.scrollTo({ top: 1e6, behavior: 'smooth' }); }, [msgs, busy]);

  return (
    <Drawer open={open} onClose={() => openAssistant(null)} title={tr('Cockpit-Assistent', 'Cockpit assistant')} sub={tr('KI-Antworten nur aus Daten, die du sehen darfst', 'AI answers only from data you are allowed to see')}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
        {project && (
          <div className="row"><span className="chip chip-accent"><Icon name="target" size={12} />{tr('Fokus', 'Focus')}: {project.name} (#{project.rank})
            <button style={{ border: 0, background: 'none', padding: 0, display: 'grid', color: 'inherit' }} onClick={() => setRef(null)} aria-label={tr('Fokus entfernen', 'Remove focus')}><Icon name="x" size={12} /></button></span></div>
        )}
        <div ref={listRef} style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 6 }}>
          {msgs.length === 0 && !busy && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="stack" style={{ gap: 10 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <motion.div animate={{ rotate: [0, 12, -8, 0], scale: [1, 1.08, 1] }} transition={{ duration: 3.2, repeat: Infinity }} style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--ink)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}><Icon name="sparkle" size={22} /></motion.div>
                <div className="muted" style={{ fontSize: 13 }}>{tr('Frag in normaler Sprache – ich kenne Rangfolge, Kapazitäten, Abhängigkeiten und Datenqualität.', 'Ask in plain language – I know the ranking, capacities, dependencies and data quality.')}</div>
              </div>
              {suggestions.map((s, i) => (
                <motion.button key={s} className="action" style={{ gridTemplateColumns: '20px 1fr', borderRadius: 12, border: '1px solid var(--line)' }} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0, transition: { delay: 0.05 * i } }} onClick={() => send(s)}>
                  <Icon name="arrowRight" size={14} style={{ color: 'var(--accent)', marginTop: 2 }} /><span>{s}</span>
                </motion.button>
              ))}
            </motion.div>
          )}
          <AnimatePresence initial={false}>
            {msgs.map((m, i) => (
              <motion.div key={i} layout initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}
                style={m.role === 'user'
                  ? { alignSelf: 'flex-end', maxWidth: '85%', background: 'var(--ink)', color: 'var(--ink-inv)', padding: '9px 13px', borderRadius: '14px 14px 4px 14px', fontSize: 13.5 }
                  : { alignSelf: 'stretch', background: 'var(--surface-2)', border: '1px solid var(--line)', padding: '12px 14px', borderRadius: '4px 14px 14px 14px', fontSize: 13.5, lineHeight: 1.5 }}>
                {m.role === 'user' ? m.text : <>
                  <div className="row" style={{ gap: 6, marginBottom: 6, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: m.source === 'ai' ? 'var(--accent-strong)' : 'var(--ink-3)' }}>
                    <Icon name={m.source === 'ai' ? 'sparkle' : 'info'} size={12} />
                    {m.source === 'ai' ? tr('KI-generiert · bitte prüfen', 'AI-generated · please verify') : m.source === 'fallback' ? tr('Automatische Zusammenfassung', 'Automatic summary') : tr('Hinweis', 'Notice')}
                  </div>
                  {i === msgs.length - 1 ? <Typewriter text={m.text} /> : <Md text={m.text} />}
                </>}
              </motion.div>
            ))}
          </AnimatePresence>
          {busy && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="row" style={{ gap: 10, color: 'var(--ink-2)', fontSize: 13 }}>
              <span className="row" style={{ gap: 4 }}>{[0, 1, 2].map((k) => <motion.i key={k} style={{ width: 6, height: 6, borderRadius: 9, background: 'var(--accent)', display: 'inline-block' }} animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.9, repeat: Infinity, delay: k * 0.15 }} />)}</span>
              <AnimatePresence mode="wait"><motion.span key={phase} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>{tr(...THINKING[phase])}</motion.span></AnimatePresence>
            </motion.div>
          )}
        </div>
        <form className="row" style={{ gap: 8, paddingTop: 6, borderTop: '1px solid var(--line-soft)' }} onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder={tr('Frag das Cockpit …', 'Ask the cockpit …')} aria-label={tr('Frage', 'Question')} />
          <motion.button whileTap={{ scale: 0.92 }} className="btn btn-primary btn-icon" type="submit" disabled={!q.trim() || busy} aria-label={tr('Senden', 'Send')}><Icon name="send" /></motion.button>
        </form>
      </div>
    </Drawer>
  );
}
