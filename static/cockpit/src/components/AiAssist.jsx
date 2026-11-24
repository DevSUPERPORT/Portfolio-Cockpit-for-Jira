// KI-Assistent × Lotse: one calm, reusable entry point for every screen (Wochenplanung, Fehlende Werte, Support, Plan vs.
// Ist, Teams, Projekte, Meine Arbeit, Playbooks, Schätzen wie früher). Lotse and the AI WORK TOGETHER on the same task
// (shared/lotse/teamwork.js): one panel, Lotse's verified answer first (instant, no AI), the AI's answer arriving next to
// it, compared in code – narratives claim by claim (✓ / ✗ against Lotse's facts), suggestions side by side ("Beide
// schlagen … vor" or both options with their reasons). The person picks; the pick goes through the screen's existing
// write path (onApply), which records its own undo entries. AI off or budget stopped: Lotse alone, same panel, no empty
// slot (narratives whose view already has a Lotse chip stay hidden then – the chip is Lotse's way in).
// Nothing is written without a click. Motion: transform/opacity only, enter animations only.
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { enter } from '../lib/motion.js';
import { useApp, errText } from '../state.jsx';
import { call } from '../lib/api.js';
import { tr, getLang, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { aiOn } from '../lib/aiFlags.js';
import { track } from '../lib/usage.js';
import { lotseDraft, compareDrafts, textCheck, pickResult, isNarrative } from '@shared/lotse/teamwork.js';
import { paritySkill } from '@shared/lotse/parity.js';
import { narrate } from '@shared/lotse/narrate.js';
import { useLotseCtx } from './lotse/engine.js';
import { LotseMark } from './lotse/LotseChip.jsx';
import Marked from './lotse/Marked.jsx';
import { AiProof } from './ProofLotse.jsx';
import './AiAssist.css';

const SENT = {
  planning: () => tr('die Vorschläge des Optimierers (Keys, Wochen, Auslastung)', 'the optimizer\'s suggestions (keys, weeks, load)'),
  gaps: () => tr('der Vorgang und ähnliche Vorgänge (Keys, Stunden, Teams, Termine)', 'the work item and similar ones (keys, hours, teams, dates)'),
  dispatch: () => tr('die Tickets (Key, Priorität, SLA, Komponenten) und die Team-Auslastung', 'the tickets (key, priority, SLA, components) and team load'),
  planActual: () => tr('die Plan-vs.-Ist-Zahlen dieses Zeitraums', 'the plan vs. actual figures of this period'),
  teamBrief: () => tr('die Kennzahlen dieses Teams', 'this team\'s figures'),
  projectBrief: () => tr('die Kennzahlen dieses Projekts', 'this project\'s figures'),
  myWeek: () => tr('nur deine eigenen Buchungen und deine Jira-Aktivität dieser Woche', 'only your own bookings and Jira activity of this week'),
  intent: () => tr('dein Wunsch, die Kartenliste und die Team-Namen', 'your wish, the list of cards and the team names'),
  similarSummary: () => tr('die ähnlichen erledigten Vorgänge (Keys, Stunden, Überzug) mit Titeln und letzten Kommentaren', 'the similar finished work items (keys, hours, overrun) with summaries and last comments'),
  playbookDraft: () => tr('das Support-Thema (Anzahl, Zeit, Tendenz) und die Beispiel-Tickets', 'the support topic (count, time, trend) and the example tickets'),
};
// narratives whose views carry a Lotse chip: with AI off the chip is Lotse's way in (no second button)
const CHIP_FEATURES = new Set(['teamBrief', 'projectBrief', 'planActual']);

// Names for the handles the model used ("P2", "T1", "C3") – resolved here, from data the screen already shows. Without
// shared texts the model only knows projects as "#rank key"; the user sees "Name (#rank)" again.
export function useHandleNames() {
  const { ds, computed } = useApp();
  return useCallback((handles, shared) => {
    const byRank = new Map((computed?.model?.items || []).map((i) => [i.rank, i]));
    const projects = (s) => (shared?.texts ? s : s.replace(/#(\d{1,4})(?:\s[A-Z][A-Z0-9_]*-\d+)?/g, (m, rk) => (byRank.has(+rk) ? `${byRank.get(+rk).name} (#${rk})` : m)));
    const nameOf = (h) => {
      const x = handles?.[h];
      if (!x) return h;
      if (x.kind === 'person') return ds?.people?.[x.id]?.name || tr('eine Person', 'a person');
      if (x.kind === 'team') return computed?.model?.teams?.get(x.id)?.name || x.id;
      return x.id; // component name
    };
    const text = (s) => projects(String(s || '').replace(/\b[PTC]\d{1,3}\b/g, (h) => (handles?.[h] ? nameOf(h) : h)));
    return { nameOf, text };
  }, [ds, computed]);
}

// Answers are kept for 15 minutes in this browser tab (sessionStorage, per account, feature, language and exact
// payload): asking again about the same data shows the earlier answer at once ("Antwort von vor 3 Min · neu fragen").
// Answers of other accounts are dropped on sight; storage errors (private mode, full) just mean "no cache".
const CACHE_MS = 15 * 60e3;
const PREFIX = 'pc-ai:v1:';
export const payloadHash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };
function cacheGet(key, account) {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX) && !k.startsWith(`${PREFIX}${account}:`)) sessionStorage.removeItem(k);
    }
    const v = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (v && Date.now() - v.at < CACHE_MS) return v;
    sessionStorage.removeItem(key);
  } catch { /* no cache */ }
  return null;
}
function cachePut(key, r) { try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), r })); } catch { /* no cache */ } }

// State of one assistant: idle → loading → done | error → applied; st.lotse = Lotse's draft for the same payload (instant).
// run({ fresh }) skips the AI cache. lotseExtra: view data Lotse's skill reads from its context (e.g. { planActual }).
export function useAiAssist({ feature, build, lotseExtra = null }) {
  const { config, boot } = useApp();
  const lctx = useLotseCtx();
  const [st, setSt] = useState({ phase: 'idle' });
  const req = useRef(0);
  const aiEnabled = aiOn(config, feature);
  const hasLotse = !!paritySkill(feature) && !!lctx;
  const lotseOf = (payload, extra = {}) => {
    if (!hasLotse) return null;
    try { const d = lotseDraft(feature, payload, { ...lctx, lang: getLang(), ...(lotseExtra || {}), ...extra }); return d.result || d.story ? d : null; } catch { return null; }
  };
  const run = async ({ fresh = false } = {}) => {
    const id = ++req.current;
    let payload, key = null;
    try {
      payload = { ...build(), feature, lang: getLang() };
      key = `${PREFIX}${boot?.me?.id || 'me'}:${feature}:${payloadHash(JSON.stringify(payload))}`;
    } catch (e) { setSt({ phase: 'error', e }); return; }
    const lotse = lotseOf(payload);
    if (lotse) track(`lotse:story:${paritySkill(feature)}`);
    // "Was half damals?": the comment words only when texts may be loaded (the server decides: insights.comments)
    if (lotse && feature === 'similarSummary' && config?.ai?.enabled === true && config.ai.shareTexts === true) {
      const ids = (payload.items || []).map((x) => String(x?.id ?? '')).filter((x) => /^\d{1,18}$/.test(x)).slice(0, 20);
      if (ids.length) call('insights.comments', { ids, texts: true }).then((comments) => { if (id === req.current) { const l2 = lotseOf(payload, { comments }); if (l2) setSt((s) => ({ ...s, lotse: l2 })); } }, () => null);
    }
    if (!aiEnabled) { setSt({ phase: 'done', r: null, lotse }); return; }
    const hit = !fresh && cacheGet(key, boot?.me?.id || 'me');
    if (hit) { setSt({ phase: 'done', r: hit.r, cachedAt: hit.at, lotse }); return; }
    setSt({ phase: 'loading', startedAt: Date.now(), lotse });
    try {
      const r = await call('ai.assist', fresh ? { ...payload, fresh: true } : payload);
      if (id !== req.current) return; // cancelled meanwhile
      track(`ai:${feature}`);
      cachePut(key, r);
      setSt((s) => ({ phase: 'done', r, lotse: s.lotse || lotse }));
    } catch (e) { if (id === req.current) setSt((s) => ({ phase: 'error', e, lotse: s.lotse || lotse })); }
  };
  const close = () => { req.current++; setSt({ phase: 'idle' }); };
  return { feature, enabled: aiEnabled || hasLotse, aiEnabled, hasLotse, st, setSt, run, close, open: st.phase !== 'idle' };
}

// Honest waiting: the seconds so far, what usually happens, and where we are (the data is compiled and sent at once;
// the rest happens on the server – the model answers, then the app checks the answer).
function AiProgress({ startedAt, onCancel }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((now - (startedAt || now)) / 1000));
  const steps = [tr('Daten zusammenstellen', 'Compiling data'), tr('KI denkt nach', 'AI is thinking'), tr('Antwort prüfen', 'Checking the answer')];
  const at = s < 1 ? 0 : 1;
  return (
    <div className="ai-loading" aria-live="polite">
      <ol className="ai-steps">
        {steps.map((x, i) => <li key={x} className={i < at ? 'done' : i === at ? 'now' : ''}>{i < at ? <Icon name="check" size={11} /> : <i />}{x}</li>)}
      </ol>
      <div className="ai-shimmer" aria-hidden="true"><i /><i /><i /></div>
      <div className="ai-wait">
        <span className="faint num">{tr(`${s} s · meist 5–15 s`, `${s} s · usually 5–15 s`)}{s >= 20 ? tr(' – dauert heute länger', ' – taking longer today') : ''} · {tr('nichts wird geändert', 'nothing is changed')}</span>
        <button type="button" className="btn btn-xs btn-ghost" onClick={onCancel}>{tr('Abbrechen', 'Cancel')}</button>
      </div>
    </div>
  );
}

// "Hilfreich?" – counted only in this browser (localStorage), nothing is sent anywhere.
function Feedback({ feature }) {
  const [given, setGiven] = useState(null);
  const give = (v) => {
    setGiven(v);
    try { const all = JSON.parse(localStorage.getItem('pc-ai-feedback') || '{}') || {}; const f = all[feature] || { up: 0, down: 0 }; f[v]++; all[feature] = f; localStorage.setItem('pc-ai-feedback', JSON.stringify(all)); } catch { /* private mode */ }
  };
  if (given) return <span className="ai-fb done">{tr('Danke!', 'Thanks!')}</span>;
  return (
    <span className="ai-fb" role="group" aria-label={tr('War das hilfreich?', 'Was this helpful?')}>
      {tr('Hilfreich?', 'Helpful?')}
      <button type="button" className="ai-fb-btn" onClick={() => give('up')} aria-label={tr('Hilfreich', 'Helpful')}><Icon name="thumb" size={12} /></button>
      <button type="button" className="ai-fb-btn down" onClick={() => give('down')} aria-label={tr('Nicht hilfreich', 'Not helpful')}><Icon name="thumb" size={12} /></button>
    </span>
  );
}
const agoMin = (at) => Math.max(1, Math.round((Date.now() - at) / 60e3));
// the label without "KI" when Lotse works alone ("KI-Entwurf" → "Entwurf")
const lotseLabelOf = (label) => { const t = String(label || '').replace(/^(KI|AI)[- ]\s*/i, ''); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };

export function AiButton({ ai, label, compact = false, disabled = false, lotseLabel }) {
  if (!ai.enabled) return null;
  if (!ai.aiEnabled && CHIP_FEATURES.has(ai.feature)) return null;
  const busy = ai.st.phase === 'loading';
  const shown = ai.aiEnabled ? label : lotseLabel || lotseLabelOf(label);
  return (
    <motion.button type="button" data-ai-feature={ai.feature} data-ai-mode={ai.aiEnabled ? 'team' : 'lotse'} className={`ai-btn ${compact ? 'compact' : ''} ${ai.open ? 'on' : ''} ${ai.aiEnabled ? '' : 'lotse'}`} whileTap={{ scale: 0.96 }}
      aria-expanded={ai.open} disabled={disabled || busy} onClick={() => (ai.open && !busy ? ai.close() : ai.run())}
      title={ai.aiEnabled ? tr('Lotse antwortet sofort, die KI ergänzt – beide werden verglichen; nichts wird ohne deinen Klick geändert', 'Lotse answers at once, the AI adds its view – both are compared; nothing changes without your click') : tr('Lotse schlägt vor – aus euren Daten, ohne KI; nichts wird ohne deinen Klick geändert', 'Lotse suggests – from your data, without AI; nothing changes without your click')}>
      <span className={`ai-btn-glyph ${busy ? 'busy' : ''} ${ai.aiEnabled ? '' : 'lotse'}`} aria-hidden="true">{ai.aiEnabled ? <Icon name="sparkle" size={13} /> : <LotseMark size={13} />}</span>
      <span className="ai-btn-ki">{ai.aiEnabled ? (ai.hasLotse ? tr('Lotse + KI', 'Lotse + AI') : 'KI') : 'Lotse'}</span>
      {shown && <span className="ai-btn-label">{shown}</span>}
    </motion.button>
  );
}

// "Beide schlagen 50 h vor" – a structured value in the screen's words
function useValueText() {
  const { computed, ds } = useApp();
  return (feature, v, usage) => {
    if (v == null) return '–';
    if (feature === 'gaps') {
      if (usage === 'team') return computed?.model?.teams?.get(v)?.name || String(v);
      if (usage === 'originalEstimate') return fmt.h(v, v % 1 ? 1 : 0);
      if (usage === 'startDate' || usage === 'dueDate') return fmt.date(v);
      if (Array.isArray(v)) return v.map((q) => fmt.quarter(q)).join(', ');
      return String(v);
    }
    if (feature === 'dispatch') return `${computed?.model?.teams?.get(v.teamId)?.name || v.teamId}${v.accountId ? ` · ${ds?.people?.[v.accountId]?.name || tr('Person', 'person')}` : ''}`;
    if (feature === 'myWeek') return `„${v}“`;
    return String(v);
  };
}

// The verdict of the comparison: one sentence, coloured, with the items that differ.
function Verdict({ feature, cmp, check, lotse }) {
  const valueText = useValueText();
  const [all, setAll] = useState(false);
  if (check) {
    const claims = check.claims || [];
    const wrong = claims.filter((c) => c.verified === false);
    return (
      <div className="tw-verdict-wrap">
        <div className={`lx-verdict ${check.verdict}`} role="status" data-tw-verdict={check.verdict}>
          {check.verdict === 'agrees' && <><Icon name="check" size={14} /><b>{tr('Lotse und KI stimmen überein', 'Lotse and the AI agree')}</b><span className="faint">{tr(`${claims.length} ${claims.length === 1 ? 'Angabe' : 'Angaben'} geprüft`, `${claims.length} ${claims.length === 1 ? 'claim' : 'claims'} checked`)}</span></>}
          {check.verdict === 'differs' && <><Icon name="alert" size={14} /><b>{tr(`Die KI weicht in ${wrong.length} ${wrong.length === 1 ? 'Angabe' : 'Angaben'} ab – es gilt Lotses geprüfte Zahl`, `The AI differs in ${wrong.length} ${wrong.length === 1 ? 'claim' : 'claims'} – Lotse's verified figure applies`)}</b></>}
          {check.verdict === 'unverifiable' && <><Icon name="info" size={14} /><b>{tr('Keine prüfbaren Zahlen in der KI-Antwort', 'No checkable figures in the AI answer')}</b></>}
        </div>
        {(all ? claims : wrong).length > 0 && (
          <ul className="lx-claims" aria-label={tr('Geprüfte Angaben', 'Checked claims')}>
            {(all ? claims : wrong).map((c, i) => (
              <li key={i} className={c.verified === true ? 'ok' : c.verified === false ? 'bad' : ''}>
                <span className="lx-ic" aria-hidden="true">{c.verified === true ? '✓' : c.verified === false ? '✗' : '?'}</span>
                <span className="lx-claim">„{c.text}“</span>
                <span className="lx-claim-v faint">{c.verified === false ? (c.expected ? tr(`Lotse: ${c.expected}`, `Lotse: ${c.expected}`) : tr('steht so nicht in den Daten', 'not in the data')) : c.verified === true ? tr('stimmt', 'correct') : tr('nicht prüfbar', 'not checkable')}</span>
              </li>
            ))}
          </ul>
        )}
        {claims.length > wrong.length && <button type="button" className="ai-link" aria-expanded={all} onClick={() => setAll(!all)}>{all ? tr('Nur Abweichungen zeigen', 'Show differences only') : tr(`Alle ${claims.length} geprüften Angaben zeigen`, `Show all ${claims.length} checked claims`)}</button>}
      </div>
    );
  }
  if (!cmp || cmp.verdict === 'none') return null;
  const usage = lotse?.suggestion?.usage;
  const one = cmp.items.length === 1 ? cmp.items[0] : null;
  const what = {
    planning: () => tr(`${cmp.same} gleiche Vorschläge`, `${cmp.same} identical picks`),
    dispatch: () => tr(`für ${cmp.same} von ${cmp.total} Tickets dasselbe Team und dieselbe Person`, `the same team and person for ${cmp.same} of ${cmp.total} tickets`),
    myWeek: () => tr(`für ${cmp.same} von ${cmp.total} Buchungen denselben Kommentar`, `the same comment for ${cmp.same} of ${cmp.total} bookings`),
  }[feature];
  const head = cmp.verdict === 'same'
    ? (one ? tr(`Beide schlagen ${valueText(feature, one.lotse, usage)} vor`, `Both suggest ${valueText(feature, one.lotse, usage)}`) : tr(`Beide schlagen dasselbe vor${what ? ` – ${what()}` : ''}`, `Both suggest the same${what ? ` – ${what()}` : ''}`))
    : cmp.verdict === 'partial' ? tr(`Teilweise einig – ${cmp.same} von ${cmp.total} gleich; du wählst`, `Partly agreed – ${cmp.same} of ${cmp.total} the same; you choose`)
      : cmp.verdict === 'lotseOnly' ? tr('Nur Lotse hat einen Vorschlag', 'Only Lotse has a suggestion')
        : cmp.verdict === 'aiOnly' ? tr('Nur die KI hat einen Vorschlag – Lotse fand keine sichere Grundlage', 'Only the AI has a suggestion – Lotse found no sound basis')
          : one ? tr(`Lotse: ${valueText(feature, one.lotse, usage)} · KI: ${valueText(feature, one.ai, usage)} – du wählst`, `Lotse: ${valueText(feature, one.lotse, usage)} · AI: ${valueText(feature, one.ai, usage)} – you choose`) : tr('Lotse und KI schlagen Verschiedenes vor – du wählst', 'Lotse and the AI suggest different things – you choose');
  const diff = cmp.items.filter((x) => !x.same && x.lotse != null && x.ai != null && (feature === 'dispatch' || feature === 'planning')).slice(0, 6);
  return (
    <div className="tw-verdict-wrap">
      <div className={`lx-verdict ${cmp.verdict === 'same' ? 'agrees' : cmp.verdict === 'lotseOnly' || cmp.verdict === 'aiOnly' ? 'unverifiable' : 'differs'}`} role="status" data-tw-verdict={cmp.verdict}>
        <Icon name={cmp.verdict === 'same' ? 'check' : cmp.verdict === 'lotseOnly' || cmp.verdict === 'aiOnly' ? 'info' : 'alert'} size={14} /><b>{head}</b>
      </div>
      {diff.length > 0 && feature === 'dispatch' && (
        <ul className="lx-claims" aria-label={tr('Unterschiede je Ticket', 'Differences per ticket')}>
          {diff.map((x) => <li key={x.id} className="bad"><span className="lx-ic" aria-hidden="true">✗</span><span className="lx-claim tkey">{x.key}</span><span className="lx-claim-v faint">{tr('Lotse', 'Lotse')}: {valueText(feature, x.lotse)} · {tr('KI', 'AI')}: {valueText(feature, x.ai)}</span></li>)}
        </ul>
      )}
    </div>
  );
}

// Lotse's side: the story (narratives) or the suggestion in the screen's own rendering.
function LotseSide({ lotse, render, n, narrative }) {
  const s = lotse?.story, r = lotse?.result;
  if (!r && !s) return <p className="ai-text faint">{tr('Lotse hat dafür gerade keine eigene Antwort – die Daten reichen nicht.', 'Lotse has no answer of its own for this right now – the data is not enough.')}</p>;
  if (narrative && s) {
    return (
      <>
        <p className="ai-text twk-head">{s.headline}</p>
        {(s.kpis || []).length > 0 && <dl className="lx-facts">{s.kpis.slice(0, 4).map((k) => <div key={k.id || k.label}><dt>{k.label}</dt><dd className="num">{fmt.n(k.value, k.unit === 'h' && Math.abs(k.value) < 10 ? 1 : 0)}{k.unit === '%' ? ' %' : k.unit === 'h' ? ' h' : k.unit === 'd' ? tr(' T', ' d') : ''}</dd></div>)}</dl>}
        {(s.findings || []).length > 1 && <ul className="ai-points">{s.findings.slice(1, 4).map((f, i) => <li key={i}><Icon name="arrowRight" size={12} />{f.text}</li>)}</ul>}
      </>
    );
  }
  return (
    <>
      {r.text && <p className="ai-text">{r.text}</p>}
      {render?.(r, n)}
      {r.points?.length > 0 && <ul className="ai-points">{r.points.map((p, i) => <li key={i}><Icon name="arrowRight" size={12} />{p}</li>)}</ul>}
    </>
  );
}

// render(r, names) – the feature's own body (a list of picks, a value, …); onApply(r) – the existing write path;
// canApply(r) – whether there is anything to take; copy(r) – text for "Kopieren" (narratives).
export function AiPanel({ ai, title, render, onApply, canApply = () => true, applyLabel, copy, copyLabel }) {
  const { toast } = useApp();
  const names = useHandleNames();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const counted = useRef(null);
  const { phase, r, e, lotse } = ai.st;
  const L = lotse?.result || null;
  const narrative = isNarrative(ai.feature);
  const done = phase === 'done';
  const cmp = done && r && L && !narrative ? compareDrafts(ai.feature, L, r) : null;
  const check = done && r && narrative && lotse?.story ? textCheck(lotse.story, r, getLang()) : null;
  useEffect(() => {
    if (!done || !r || counted.current === r) return;
    counted.current = r;
    const v = cmp?.verdict || check?.verdict;
    if (v === 'same' || v === 'agrees') track('teamwork:same'); else if (v === 'differs' || v === 'partial') track('teamwork:differs');
  }, [done, r]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ai.enabled || !ai.open) return null;
  if (!ai.aiEnabled && CHIP_FEATURES.has(ai.feature)) return null;
  const n = r ? names(r.handles, r.shared) : null;
  const n0 = names({}, { texts: true });
  const lotseOk = !!L && (!onApply || canApply(L));
  const aiOk = !!r && (!onApply || canApply(r));
  const both = lotseOk && aiOk && cmp && cmp.verdict !== 'same';
  const apply = async (choice) => {
    const res = pickResult(L, r, choice);
    if (!res) return;
    setBusy(true);
    try {
      await onApply(res);
      if (L && r) track(`teamwork:pick:${choice}`);
      ai.setSt({ phase: 'applied', r, lotse });
      setTimeout(() => ai.close(), 1600);
    } catch (err) { toast({ text: errText(err), error: true }); } finally { setBusy(false); }
  };
  const doCopy = async (choice) => {
    const res = choice === 'ai' ? r : L || (lotse?.story ? { text: narrate(lotse.story) } : null);
    try { await navigator.clipboard.writeText((choice === 'ai' ? n : n0).text(copy(res))); toast({ text: tr('Kopiert', 'Copied'), icon: 'check' }); }
    catch { toast({ text: tr('Kopieren nicht möglich – Text bitte markieren.', 'Copy not possible – please select the text.'), error: true }); }
  };
  const single = !ai.aiEnabled;
  // one apply when both agree or only one has something; two when they differ (the person picks)
  const applyOne = !both && onApply ? (lotseOk ? 'lotse' : aiOk && done ? 'ai' : null) : null;
  return (
    <motion.section className={`ai-panel tw ${single ? 'tw-single' : ''}`} data-ai-feature={ai.feature} data-ai-phase={phase} data-ai-source={r?.source || (L ? 'lotse' : '')} data-ai-model={r?.model || ''} role="region" aria-label={ai.aiEnabled ? tr('Lotse und KI', 'Lotse and AI') : tr('Lotse-Vorschlag', 'Lotse suggestion')} aria-busy={phase === 'loading'}
      {...enter(0, { y: -6, d: 'gentle' })}>
      <header className="ai-panel-head">
        <span className="ai-tag tw-tag-lotse"><LotseMark size={11} />Lotse{ai.aiEnabled && <><span aria-hidden="true">+</span><Icon name="sparkle" size={11} />{tr('KI', 'AI')}</>}</span>
        <b className="ai-panel-title">{title}</b>
        {r?.source === 'fallback' && <span className="ai-tag soft" title={tr('Die KI war nicht erreichbar oder ihre Antwort war ungültig – rechts steht der Vorschlag nach den Regeln der App.', 'The AI was unreachable or its answer was invalid – on the right is the suggestion by the app\'s rules.')}>{tr('KI: Regel der App', 'AI: app rule')}</span>}
        {r?.cached && r?.source !== 'fallback' && <span className="ai-tag soft" data-ai-cached title={tr('Dieselbe Frage mit genau denselben Daten wurde hier in den letzten 12 Stunden schon beantwortet – die Antwort wird wiederverwendet und kostet nichts. „neu fragen“ holt eine frische.', 'The same question with exactly the same data was answered here in the last 12 hours – the answer is reused and costs nothing. "Ask again" gets a fresh one.')}>{tr('Wiederverwendet · kostenlos', 'Reused · free')}</span>}
        <button type="button" className="btn btn-xs btn-ghost btn-icon ai-x" aria-label={tr('Schließen', 'Close')} onClick={ai.close}><Icon name="x" size={13} /></button>
      </header>

      {phase === 'applied' && (
        <motion.div className="ai-applied" {...enter(0, { y: 0, scale: 0.97 })}>
          <Icon name="check" size={14} />{tr('Übernommen – jede Änderung einzeln im Verlauf rückgängig.', 'Applied – each change undoable in the history.')}
        </motion.div>
      )}
      {phase !== 'applied' && (
        <div className="ai-body">
          <div className={`tw-grid ${single ? 'one' : ''}`}>
            <motion.div className="tw-side lotse" {...enter(0, { y: 4 })} data-tw-side="lotse">
              <div className="lx-tag"><Icon name="shield" size={11} />{tr('Lotse · geprüft · sofort', 'Lotse · verified · instant')}</div>
              <LotseSide lotse={lotse} render={render} n={n0} narrative={narrative} />
              {both && <button type="button" className="btn btn-sm tw-pick" disabled={busy} onClick={() => apply('lotse')} data-tw-pick="lotse"><Icon name="check" size={13} />{tr('Lotse übernehmen', 'Use Lotse\'s')}</button>}
            </motion.div>
            {ai.aiEnabled && (
              <div className="tw-side ai" data-tw-side="ai">
                <div className="lx-tag ai"><Icon name="sparkle" size={11} />{tr('KI', 'AI')}{r?.model ? <span className="faint tw-model"> · {r.model}</span> : null}</div>
                {phase === 'loading' && <AiProgress startedAt={ai.st.startedAt} onCancel={ai.close} />}
                {phase === 'error' && (
                  <div className="ai-error" role="alert">
                    <Icon name="alert" size={14} /><span>{errText(e)}{L ? tr(' – Lotses Vorschlag gilt.', ' – Lotse\'s suggestion applies.') : ''}</span>
                    {e?.code !== 'AI_DISABLED' && e?.code !== 'AI_QUOTA' && e?.code !== 'AI_BUDGET' && <button type="button" className="btn btn-xs" onClick={() => ai.run()}><Icon name="refresh" size={12} />{tr('Erneut', 'Retry')}</button>}
                  </div>
                )}
                {done && r && (
                  <motion.div className="tw-ai-body" {...enter(0, { y: 0 })}>
                    {r.text && (check ? <Marked text={n.text(r.text)} claims={check.claims} className="ai-text" /> : <p className="ai-text">{n.text(r.text)}</p>)}
                    {render?.(r, n)}
                    {r.points?.length > 0 && <ul className="ai-points">{r.points.map((p, i) => <motion.li key={i} {...enter(i, { y: 4, delay: 0.05 })}><Icon name="arrowRight" size={12} />{check ? <Marked text={n.text(p)} claims={check.claims} className="tw-inline" /> : n.text(p)}</motion.li>)}</ul>}
                    {r.reasoning && (
                      <div className="ai-why">
                        <span className="ai-why-label">{tr('Warum?', 'Why?')}{r.confidence && <span className={`ai-conf ${r.confidence}`}>{{ high: tr('sicher', 'confident'), medium: tr('eher sicher', 'fairly sure'), low: tr('unsicher', 'unsure') }[r.confidence]}</span>}</span>
                        <p>{n.text(r.reasoning)}</p>
                      </div>
                    )}
                    {both && <button type="button" className="btn btn-sm tw-pick" disabled={busy} onClick={() => apply('ai')} data-tw-pick="ai"><Icon name="check" size={13} />{tr('KI übernehmen', 'Use the AI\'s')}</button>}
                  </motion.div>
                )}
              </div>
            )}
          </div>
          {done && r && <Verdict feature={ai.feature} cmp={cmp} check={check} lotse={L} />}
          {/* Nachprüfen: Lotse's check in one line and the work items the suggestion relies on, as links */}
          {(done || phase === 'error') && (L || lotse?.story || r) && <AiProof lotse={lotse} r={r} cmp={cmp} check={check} aiOn={ai.aiEnabled} />}
          <div className="ai-foot">
            <div className="ai-policy">
              <Icon name="shield" size={12} />
              {ai.aiEnabled && r
                ? <><span>{tr('An die KI gesendet', 'Sent to the AI')}: {SENT[ai.feature]?.()} · {tr('Namen', 'names')} {r.shared?.names ? tr('ja', 'yes') : tr('nein', 'no')}, {tr('Texte', 'texts')} {r.shared?.texts ? tr('ja', 'yes') : tr('nein', 'no')} ({tr('nach Einstellung', 'per setting')})</span>
                  <button type="button" className="ai-link" aria-expanded={sent} onClick={() => setSent((v) => !v)}>{tr('Was wurde gesendet?', 'What was sent?')}</button></>
                : <span>{tr('Lotse rechnet in deinem Browser aus euren Daten – an eine KI geht nichts.', 'Lotse computes in your browser from your data – nothing goes to an AI.')}</span>}
            </div>
            <div className="ai-actions">
              <button type="button" className="btn btn-sm btn-ghost" onClick={ai.close}>{tr('Verwerfen', 'Discard')}</button>
              {applyOne && <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => apply(applyOne)} data-tw-pick={applyOne}><Icon name="check" size={13} />{busy ? tr('Übernehme …', 'Applying …') : applyLabel || tr('Übernehmen', 'Apply')}</button>}
              {copy && (L || lotse?.story) && <button type="button" className={`btn btn-sm ${onApply ? 'btn-ghost' : ''}`} onClick={() => doCopy('lotse')}>{ai.aiEnabled ? tr('Lotse kopieren', 'Copy Lotse') : copyLabel || tr('Kopieren', 'Copy')}</button>}
              {copy && r && <button type="button" className="btn btn-sm btn-ghost" onClick={() => doCopy('ai')}>{tr('KI kopieren', 'Copy AI')}</button>}
            </div>
          </div>
          {sent && r && (
            <motion.pre className="ai-sent mono" tabIndex={0} aria-label={tr('Gesendete Daten', 'Sent data')} {...enter(0, { y: -4 })}>
              {JSON.stringify(r.usedFacts, null, 1)}
            </motion.pre>
          )}
          {ai.aiEnabled && done && r && (
            <div className="ai-note faint">
              <span>{tr('KI-generiert – bitte prüfen. Lotses Zahlen sind geprüft.', 'AI-generated – please verify. Lotse\'s figures are verified.')}</span>
              {(ai.st.cachedAt || ai.st.r?.cached) && <span>· {!ai.st.cachedAt ? tr('Antwort wiederverwendet', 'Answer reused') : Date.now() - ai.st.cachedAt < 60e3 ? tr('Antwort von gerade eben', 'Answer from just now') : tr(`Antwort von vor ${agoMin(ai.st.cachedAt)} Min`, `Answer from ${agoMin(ai.st.cachedAt)} min ago`)} · <button type="button" className="ai-link" onClick={() => ai.run({ fresh: true })}>{tr('neu fragen', 'ask again')}</button></span>}
              <Feedback feature={ai.feature} />
            </div>
          )}
        </div>
      )}
    </motion.section>
  );
}

// Button and panel together (the usual case). lotseExtra: view data Lotse reads (e.g. { planActual }).
export default function AiAssist({ feature, build, label, lotseLabel, title, render, onApply, canApply, applyLabel, copy, copyLabel, compact, className = '', lotseExtra = null }) {
  const ai = useAiAssist({ feature, build, lotseExtra });
  if (!ai.enabled || (!ai.aiEnabled && CHIP_FEATURES.has(feature))) return null; // neither: the screen works as before
  return (
    <div className={`ai-assist ${ai.open ? 'open' : ''} ${className}`}>
      <AiButton ai={ai} label={label} lotseLabel={lotseLabel} compact={compact} />
      <AiPanel ai={ai} title={title || label} render={render} onApply={onApply} canApply={canApply} applyLabel={applyLabel} copy={copy} copyLabel={copyLabel} />
    </div>
  );
}
