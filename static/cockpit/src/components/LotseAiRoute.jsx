// "LLM teaches Lotse" – in the Lotse panel: when Lotse could not map a question (a 'help' story) and AI is allowed for the
// person (aiOn 'intent'), the AI picks ONE answer card of the catalogue (ai.assist 'intent', lotseMissed: true). Lotse
// then answers it with its own numbers; the server keeps only the masked phrase pattern as a learning candidate for the
// Jira admins (shared/lotse/learn.js). AI off: nothing here – the help story's closest questions stay the way on.
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { enter } from '../lib/motion.js';
import { useApp } from '../state.jsx';
import { call } from '../lib/api.js';
import { tr, getLang } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { aiOn } from '../lib/aiFlags.js';
import { skillOfCard } from '@shared/lotse/learn.js';
import { track } from '../lib/usage.js';

export default function AiRoute({ text, onRoute }) {
  const { config, computed } = useApp();
  const [st, setSt] = useState({ phase: 'idle' });
  const asked = useRef(false);
  const on = aiOn(config, 'intent') && !!computed && !!text;
  useEffect(() => {
    if (!on || asked.current) return;
    asked.current = true;
    setSt({ phase: 'loading' });
    call('ai.assist', { feature: 'intent', lang: getLang(), wish: String(text).slice(0, 300), lotseMissed: true,
      teams: [...computed.model.teams.values()].filter((t) => t.id !== '_none').map((t) => ({ id: t.id, name: t.name })),
      projects: computed.model.items.slice(0, 40).map((x) => ({ ref: x.ref, key: x.key, name: x.name, rank: x.rank })) })
      .then((r) => { track('ai:intent'); setSt({ phase: 'done', r, skill: skillOfCard(r?.card) }); }, () => setSt({ phase: 'error' }));
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!on || st.phase === 'idle' || st.phase === 'error') return null;
  if (st.phase === 'loading') return <div className="lx-wait lr" aria-live="polite"><span className="lx-shimmer" aria-hidden="true"><i /><i /><i /></span>{tr('Die KI sucht die passende Antwort …', 'The AI is looking for the right answer …')}</div>;
  if (!st.skill) return <p className="lr faint" role="status"><Icon name="info" size={12} /> {tr('Auch die KI fand keine passende Antwortkarte.', 'The AI found no fitting answer card either.')}</p>;
  const r = st.r;
  const params = { ...(r.teamId ? { team: r.teamId } : {}), ...(r.projectRef ? { ref: r.projectRef } : {}), ...(r.subject ? { text: r.subject } : {}) };
  return (
    <motion.div className="lr lr-card" role="status" {...enter(0, { y: 4 })}>
      <span className="lx-tag ai"><Icon name="sparkle" size={11} />{tr('KI-Zuordnung', 'AI mapping')}</span>
      <p>{tr('Die KI ordnet die Frage einer Antwort zu – die Zahlen rechnet Lotse selbst. Gibt ein Admin die Formulierung frei, versteht Lotse sie künftig ohne KI.', 'The AI maps the question to an answer – Lotse computes the numbers itself. Once an admin approves the phrasing, Lotse understands it without AI.')}</p>
      {r.why && <p className="faint">{r.why}</p>}
      <button type="button" className="btn btn-sm btn-primary" onClick={() => onRoute(st.skill, params)}><Icon name="arrowRight" size={13} />{tr('Antwort zeigen', 'Show the answer')}</button>
    </motion.div>
  );
}
