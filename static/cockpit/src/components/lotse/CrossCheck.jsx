// "KI-Lesart" – only while AI is on for Lotse (aiOn(config, 'lotse')). The LLM gets the verified story and nothing
// else (call('lotse.llm', { story })), writes its reading, and the server cross-checks every number, key, team and date
// it mentions against the story. Shown side by side: Lotse's verified facts and the AI's reading, then the verdict –
// "Lotse und KI stimmen überein" or each claim ✓ / ✗ with the verified value. The verified story always wins.
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { enter } from '../../lib/motion.js';
import { useApp, errText } from '../../state.jsx';
import { call } from '../../lib/api.js';
import { tr, getLang } from '../../lib/i18n.js';
import { Icon } from '../../lib/icons.jsx';
import { aiOn } from '../../lib/aiFlags.js';
import { payloadHash } from '../AiAssist.jsx';
import { engineCrossCheck } from './engine.js';
import { splitUnit } from './visuals.jsx';
import Marked from './Marked.jsx';
import { track } from '../../lib/usage.js';

const CACHE_MS = 15 * 60e3;
const PREFIX = 'pc-lotse-llm:v1:';
function cacheGet(key) { try { const v = JSON.parse(sessionStorage.getItem(key) || 'null'); return v && Date.now() - v.at < CACHE_MS ? v.r : null; } catch { return null; } }
function cachePut(key, r) { try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), r })); } catch { /* no cache */ } }

export default function CrossCheck({ story }) {
  const { config, boot } = useApp();
  const [st, setSt] = useState({ phase: 'idle' });
  const [sent, setSent] = useState(false);
  const [all, setAll] = useState(false);
  const req = useRef(0);
  useEffect(() => () => { req.current++; }, []);
  if (!aiOn(config, 'lotse') || !story) return null; // AI off: no button, no hint – Lotse works fully without it

  const ask = async ({ fresh = false } = {}) => {
    if (!aiOn(config, 'lotse')) return;
    const id = ++req.current;
    const key = `${PREFIX}${boot?.me?.id || 'me'}:${payloadHash(JSON.stringify([story.id, story.headline, story.kpis, getLang()]))}`;
    const hit = !fresh && cacheGet(key);
    if (hit) { setSt({ phase: 'done', r: hit, cached: true }); return; }
    setSt({ phase: 'loading' });
    try {
      const r = await call('lotse.llm', { story, lang: getLang(), ...(fresh ? { fresh: true } : {}) });
      if (id !== req.current) return;
      // the server sends its cross-check along; the shared one is the fallback (same code, pure)
      const cc = r?.crossCheck || (engineCrossCheck && r?.text ? engineCrossCheck(story, r.text) : null);
      const out = { ...r, crossCheck: cc };
      track('ai:lotse');
      if (cc?.verdict === 'agrees' || cc?.verdict === 'differs') track(`lotse:ai:${cc.verdict}`);
      cachePut(key, out);
      setSt({ phase: 'done', r: out });
    } catch (e) { if (id === req.current) setSt({ phase: 'error', e }); }
  };

  if (st.phase === 'idle') {
    return (
      <button type="button" className="lx-btn" onClick={() => ask()} data-lotse-ai title={tr('Die KI liest dieselbe Story – das Cockpit prüft jede Zahl ihrer Antwort', 'The AI reads the same story – the cockpit checks every number of its answer')}>
        <Icon name="sparkle" size={13} />{tr('KI-Lesart', 'AI reading')}
      </button>
    );
  }
  const { r, e } = st;
  const cc = r?.crossCheck;
  const claims = cc?.claims || [];
  const wrong = claims.filter((c) => c.verified === false);
  const shown = all ? [...wrong, ...claims.filter((c) => c.verified !== false)] : wrong;
  const verdict = !r?.text ? 'none' : !cc ? 'unverifiable' : cc.verdict || (wrong.length ? 'differs' : claims.length ? 'agrees' : 'unverifiable');
  return (
    <motion.section className="lx" role="region" aria-label={tr('KI-Lesart mit Gegenprüfung', 'AI reading with cross-check')} aria-busy={st.phase === 'loading'} data-lotse-verdict={st.phase === 'done' ? verdict : ''}
      {...enter(0, { y: 6, d: 'gentle' })}>
      <div className="lx-grid">
        <div className="lx-side lotse">
          <div className="lx-tag"><Icon name="shield" size={11} />{tr('Lotse · geprüft', 'Lotse · verified')}</div>
          <p className="lx-head">{story.headline}</p>
          <dl className="lx-facts">{(story.kpis || []).slice(0, 4).map((k) => { const [n, u] = splitUnit(k.unit, k.value); return <div key={k.id || k.label}><dt>{k.label}</dt><dd className="num">{n}{u ? ` ${u}` : ''}</dd></div>; })}</dl>
        </div>
        <div className="lx-side ai">
          <div className="lx-tag ai"><Icon name="sparkle" size={11} />{tr('KI-Lesart', 'AI reading')}</div>
          {st.phase === 'loading' && <div className="lx-wait" aria-live="polite"><span className="lx-shimmer" aria-hidden="true"><i /><i /><i /></span>{tr('Die KI liest die Story …', 'The AI is reading the story …')}</div>}
          {st.phase === 'error' && <div className="lx-err" role="alert"><Icon name="alert" size={13} /><span>{errText(e)}</span>{!['AI_DISABLED', 'AI_QUOTA', 'AI_BUDGET', 'AI_USER_OFF'].includes(e?.code) && <button type="button" className="btn btn-xs" onClick={() => ask({ fresh: true })}>{tr('Erneut', 'Retry')}</button>}</div>}
          {st.phase === 'done' && r?.text && <Marked text={String(r.text)} claims={claims} />}
          {st.phase === 'done' && r?.extra && <div className="lx-extra"><b>{tr('Zusätzlich', 'Also consider')}</b><Marked text={String(r.extra)} claims={claims} /></div>}
          {st.phase === 'done' && !r?.text && <p className="lx-ai-text faint">{tr('Die KI war gerade nicht erreichbar – es gilt Lotses geprüfte Story.', 'The AI was not reachable just now – the verified Lotse story applies.')}</p>}
        </div>
      </div>
      {st.phase === 'done' && verdict !== 'none' && (
        <div className={`lx-verdict ${verdict}`} role="status">
          {verdict === 'agrees' && <><Icon name="check" size={14} /><b>{tr('Lotse und KI stimmen überein', 'Lotse and the AI agree')}</b><span className="faint">{tr(`${claims.length} ${claims.length === 1 ? 'Angabe' : 'Angaben'} geprüft`, `${claims.length} ${claims.length === 1 ? 'claim' : 'claims'} checked`)}</span></>}
          {verdict === 'differs' && <><Icon name="alert" size={14} /><b>{tr(`Die KI weicht in ${wrong.length} ${wrong.length === 1 ? 'Angabe' : 'Angaben'} ab – es gilt die geprüfte Story`, `The AI differs in ${wrong.length} ${wrong.length === 1 ? 'claim' : 'claims'} – the verified story applies`)}</b></>}
          {verdict === 'unverifiable' && <><Icon name="info" size={14} /><b>{tr('Keine prüfbaren Zahlen in der KI-Antwort', 'No checkable figures in the AI answer')}</b></>}
        </div>
      )}
      {/* the differences first; the claims that agree are marked in the text and listed on request */}
      {st.phase === 'done' && shown.length > 0 && (
        <ul className="lx-claims" aria-label={tr('Geprüfte Angaben', 'Checked claims')}>
          {shown.map((c, i) => (
            <li key={i} className={c.verified === true ? 'ok' : c.verified === false ? 'bad' : ''}>
              <span className="lx-ic" aria-hidden="true">{c.verified === true ? '✓' : c.verified === false ? '✗' : '?'}</span>
              <span className="lx-claim">„{c.text}“</span>
              <span className="lx-claim-v faint">{c.verified === false ? (c.expected ? tr(`geprüft: ${c.expected}`, `verified: ${c.expected}`) : tr('steht so nicht in den Daten', 'not in the data')) : c.verified === true ? tr('stimmt', 'correct') : tr('nicht prüfbar', 'not checkable')}</span>
            </li>
          ))}
        </ul>
      )}
      {st.phase === 'done' && claims.length > wrong.length && <button type="button" className="ai-link lx-link lx-all" aria-expanded={all} onClick={() => setAll(!all)}>{all ? tr('Nur Abweichungen zeigen', 'Show differences only') : tr(`Alle ${claims.length} geprüften Angaben zeigen`, `Show all ${claims.length} checked claims`)}</button>}
      {st.phase !== 'loading' && (
        <div className="lx-foot faint">
          <span><Icon name="shield" size={11} /> {tr('Gesendet: nur diese Story (Zahlen, Keys, Teams, Termine). KI-generiert – bitte prüfen.', 'Sent: only this story (figures, keys, teams, dates). AI-generated – please verify.')}{r?.model ? ` · ${r.model}` : ''}{st.cached || r?.cached ? ` · ${tr('wiederverwendet', 'reused')}` : ''}</span>
          <span className="row" style={{ gap: 4 }}>
            {st.phase === 'done' && r?.usedFacts && <button type="button" className="ai-link lx-link" aria-expanded={sent} onClick={() => setSent(!sent)}>{tr('Was wurde gesendet?', 'What was sent?')}</button>}
            {st.phase === 'done' && <button type="button" className="ai-link lx-link" onClick={() => ask({ fresh: true })}>{tr('neu fragen', 'ask again')}</button>}
            <button type="button" className="ai-link lx-link" onClick={() => { req.current++; setSt({ phase: 'idle' }); }}>{tr('schließen', 'close')}</button>
          </span>
        </div>
      )}
      {sent && r?.usedFacts && <pre className="lx-sent mono" tabIndex={0} aria-label={tr('Gesendete Daten', 'Sent data')}>{JSON.stringify(r.usedFacts, null, 1)}</pre>}
    </motion.section>
  );
}
