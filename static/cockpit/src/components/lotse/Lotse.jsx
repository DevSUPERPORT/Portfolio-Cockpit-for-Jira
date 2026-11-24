// Lotse – the panel. A calm side sheet with a thread (newest at the bottom), follow-up chips and a composer (typed or
// spoken). A sentence becomes what Lotse understood: a Story (questions – recomputed from live data and the current
// language on every render, so numbers never go stale), a command card (preview → apply → undo), a whole job as a
// workflow run, or a decision when the sentence could mean two things. Esc or the scrim closes; focus stays inside.
// No exit animations (they stall in the Jira frame): closing simply unmounts – runs go on in runStore.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { enter, press } from '../../lib/motion.js';
import { useApp } from '../../state.jsx';
import { tr, getLang } from '../../lib/i18n.js';
import { Icon } from '../../lib/icons.jsx';
import { lotseStore, closeLotse } from './open.js';
import { ask, run, briefing, remember, validStory, useLotseCtx, route, resolveDecide } from './engine.js';
import { LotseMark } from './LotseChip.jsx';
import StoryCard, { toneWord } from './StoryCard.jsx';
import { CommandCard, DecisionCard, useRun } from './ActCards.jsx';
import { WorkflowRunner, Gallery, beginRun } from './Workflow.jsx';
import { runStore } from './runStore.js';
import { jobOf } from './acts.js';
import AiRoute from '../LotseAiRoute.jsx';
import { track } from '../../lib/usage.js';
import { usePlaybooks } from '../../lib/playbooksList.js';
import { usePlanActual } from '../../lib/planActualCache.js';
import { useInsightsHistory } from '../../lib/insightsHistory.js';
import './lotse.css';

const MAX = 12;
// a story whose job Lotse can also do (a sentence the engine read as a question: "Verteile die neuen Support-Tickets")
const SKILL_JOB = { dispatchAdvice: 'supportTriage', gapsFix: 'fillGaps', blockers: 'fixConflicts', planningAdvice: 'weeklyPrep', healthDraft: 'healthRound', overtime: 'resolveOverload', waterline: 'reRankQuarter', portfolioBrief: 'cLevelReport', planActualExplain: 'bookingCheck', myWeek: 'bookingCheck' };
let thread = []; // this session's conversation: [{ id, req: { text } | { skill, params } | { story }, q }] and acts [{ id, act: 'command' | 'workflow' | 'decide' | 'gallery', … }]
const uid = () => Math.random().toString(36).slice(2, 10);
const SKILL_Q = {
  projectBrief: () => tr('Lagebild Projekt', 'Project briefing'), teamBrief: () => tr('Lagebild Team', 'Team briefing'), myWeek: () => tr('Meine Woche', 'My week'),
  portfolioBrief: () => tr('Lagebild Portfolio', 'Portfolio briefing'), planActualExplain: () => tr('Plan vs. Ist erklärt', 'Plan vs. actual explained'), supportTopics: () => tr('Support-Themen', 'Support topics'),
  whatIf: () => tr('Was wäre wenn …', 'What if …'),
};

const STARTERS = () => [tr('Wie steht das Portfolio?', 'How is the portfolio doing?'), tr('Wer ist überlastet?', 'Who is overloaded?'), tr('Wie sieht meine Woche aus?', 'What does my week look like?'), tr('Was wäre wenn …', 'What if …')];

// An honest notice when a question has no story (never filler): what Lotse can answer instead.
function notice(q) {
  return {
    id: `notice:${q}`, skill: 'notice', subject: { kind: 'topic', ref: null, name: '' }, lang: getLang(), computedAt: new Date().toISOString(), tone: 'info',
    headline: tr('Dazu kann ich aus euren Daten nichts Belastbares sagen.', 'I cannot say anything reliable about that from your data.'),
    kpis: [], visual: { kind: 'bars', data: null, caption: '' }, findings: [], actions: [],
    followUps: [{ label: tr('Lage im Portfolio', 'Portfolio situation'), text: tr('Wie steht das Portfolio?', 'How is the portfolio doing?') }, { label: tr('Meine Woche', 'My week'), text: tr('Wie sieht meine Woche aus?', 'What does my week look like?') }, { label: tr('Wer ist überlastet?', 'Who is overloaded?'), text: tr('Welche Teams sind überlastet?', 'Which teams are overloaded?') }],
    how: { text: tr(`Gefragt: „${q}“ – keine passende Auswertung gefunden.`, `Asked: "${q}" – no matching analysis found.`), inputs: [] }, confidence: 'low', sources: [],
  };
}

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
function Composer({ onAsk, inputRef }) {
  const [draft, setDraft] = useState('');
  const [listening, setListening] = useState(false);
  const [msg, setMsg] = useState(null);
  const rec = useRef(null);
  useEffect(() => () => { try { rec.current?.abort(); } catch { /* noop */ } }, []);
  const send = (text) => { const t = String(text || '').trim().slice(0, 300); if (!t) return; setDraft(''); onAsk(t); };
  const listen = () => {
    if (listening) { try { rec.current?.stop(); } catch { /* stopped */ } setListening(false); return; }
    setMsg(null);
    if (!SR) { setMsg(tr('Spracheingabe gibt es hier nicht – die Diktierfunktion deines Systems geht (Windows: Win + H, macOS: zweimal Fn).', 'Voice input is not available here – your system dictation works (Windows: Win + H, macOS: press Fn twice).')); inputRef.current?.focus(); return; }
    const r = new SR();
    r.lang = getLang() === 'de' ? 'de-DE' : 'en-US'; r.interimResults = true; r.continuous = false;
    r.onresult = (e) => { const t = [...e.results].map((x) => x[0].transcript).join(''); setDraft(t); if (e.results[e.results.length - 1].isFinal) { setListening(false); send(t); } };
    r.onerror = (e) => { setListening(false); setMsg(e.error === 'no-speech' ? tr('Nichts gehört – noch einmal?', 'Heard nothing – try again?') : tr('Jira erlaubt hier kein Mikrofon – die Diktierfunktion deines Systems geht.', 'Jira does not allow the microphone here – your system dictation works.')); inputRef.current?.focus(); };
    r.onend = () => setListening(false);
    rec.current = r;
    try { r.start(); setListening(true); } catch { setListening(false); }
  };
  return (
    <form className="lp-compose" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
      {msg && <div className="lp-msg" role="status"><Icon name="info" size={13} />{msg}</div>}
      <div className="lp-input">
        <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={300} aria-label={tr('Frage an Lotse', 'Question for Lotse')}
          placeholder={listening ? tr('Ich höre zu …', 'Listening …') : tr('Frag Lotse – z. B. „Wie steht Glasfaser?“ oder „Was wäre wenn …“', 'Ask Lotse – e.g. "How is the portfolio?" or "What if …"')} />
        <button type="button" className={`lp-mic ${listening ? 'on' : ''}`} onClick={listen} aria-pressed={listening} aria-label={listening ? tr('Zuhören beenden', 'Stop listening') : tr('Frage sprechen', 'Speak a question')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </button>
        <button type="submit" className="btn btn-primary btn-icon btn-sm" disabled={!draft.trim()} aria-label={tr('Fragen', 'Ask')}><Icon name="send" size={15} /></button>
      </div>
    </form>
  );
}


// A sentence that could mean two things ("Was genau soll Lotse tun?"): the person picks, then the act starts.
function DecideItem({ item, ctx, onResolved }) {
  const r = useRun(item.id);
  const answer = (v) => {
    const value = ctx ? resolveDecide(item.decide, v, ctx) : null;
    if (!value) throw Object.assign(new Error('INVALID'), { code: 'INVALID', field: 'text' });
    runStore.set(item.id, { answer: v });
    onResolved(value);
  };
  return <DecisionCard step={{ id: item.id, ...item.decide }} answered={r.answer} onAnswer={answer} />;
}

export default function Lotse() {
  const st = useSyncExternalStore(lotseStore.subscribe, lotseStore.get, lotseStore.get);
  const { toast, pushUndo, runUndo, lang } = useApp();
  const ctx = useLotseCtx();
  // jobs know more than single answers: the history of finished work (insights.history, read as the person – loaded once per
  // session when the panel opens) and the support playbooks (to skip topics that already have one)
  const hist = useInsightsHistory(st.open);
  const pbs = usePlaybooks(st.open);
  const pa = usePlanActual(st.open);
  const jobCtx = useMemo(() => (ctx ? { ...ctx, history: hist.state === 'ready' ? hist.data : null, playbooks: pbs, ...(pa ? { planActual: pa } : {}) } : null), [ctx, hist, pbs, pa]);
  const [items, setItems] = useState(thread);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const lastRef = useRef(null);
  const opener = useRef(null);
  const handled = useRef(0);
  const focusId = useRef(null);
  useEffect(() => { thread = items; }, [items]);

  const add = (it) => setItems((xs) => [...xs, { id: it.id || uid(), ...it }].slice(-MAX));
  const push = (req, q) => { track(req.text ? 'lotse:ask' : 'lotse:open'); add({ req, q }); };
  // acts: a whole job (workflow run) or one command (preview card); the run starts here, once
  const startJob = (workflow, params = {}, q = null, state = null) => {
    if (!ctx) return;
    const id = uid();
    try { beginRun(id, { goal: { id: workflow, params }, state, ctx: jobCtx }); } catch (e) { console.error('[lotse] workflow', e); return; }
    const job = jobOf(workflow);
    runStore.remember({ label: q || (job ? tr(job.title[0], job.title[1]) : workflow), icon: job?.icon || 'layers', req: q ? { text: q } : { act: { kind: 'workflow', workflow, params } } });
    add({ id, act: 'workflow', q });
  };
  const addCommand = (command, params, describe, q) => {
    runStore.remember({ label: q || describe || command, icon: 'zap', req: q ? { text: q } : { act: { kind: 'command', command, params } } });
    add({ act: 'command', command, params, describe, q });
  };
  const gallery = () => add({ act: 'gallery' });
  // a typed / spoken / chip sentence: what Lotse understood decides the card
  const onAsk = (t) => {
    const prevStory = [...items].reverse().find((x) => x.req);
    const r = ctx ? route(t, ctx, prevStory ? remember(storyOf(prevStory)) : {}) : null;
    if (r?.kind === 'workflow') { track('lotse:ask'); startJob(r.workflow, r.params, t, null); return; }
    if (r?.kind === 'command') { track('lotse:ask'); addCommand(r.command, r.params, r.describe, t); return; }
    if (r?.kind === 'decide') { track('lotse:ask'); add({ act: 'decide', decide: r, q: t }); return; }
    push({ text: t }, t);
  };
  // a request from a chip, the header, Ctrl K, the pill or the Today strip
  useEffect(() => {
    if (!st.open || !st.req || handled.current === st.at || !ctx) return; // acts and stories need the data
    handled.current = st.at;
    const r = st.req;
    if (r.text) onAsk(r.text);
    else if (r.act?.kind === 'workflow') startJob(r.act.workflow, r.act.params || {});
    else if (r.act?.kind === 'command') addCommand(r.act.command, r.act.params || {}, r.act.describe || null, null);
    else if (r.gallery) gallery();
    else if (r.run) { focusId.current = r.run; setTimeout(() => panelRef.current?.querySelector(`[data-item="${r.run}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); }
    else if (r.skill) push({ skill: r.skill, params: r.params || {}, ...(r.extra ? { extra: r.extra } : {}) }, SKILL_Q[r.skill]?.() || null);
    else if (r.story) push({ story: r.story }, null);
  }, [st, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  // The thread's stories from live data; each question sees the story before it as its memory (follow-ups).
  const storyCache = useRef(new Map());
  const stories = useMemo(() => {
    const out = new Map();
    if (!ctx) return out;
    let prev = null;
    for (const it of items) {
      if (!it.req) continue;
      let s = null;
      if (it.req.story) s = it.req.story;
      else if (it.req.skill) s = run(it.req.skill, it.req.params, it.req.extra ? { ...ctx, ...it.req.extra } : ctx); // view data (planActual, mine) the skill reads
      else if (it.req.text) s = ask(it.req.text, ctx, remember(prev)); // the story before is the memory ("und für Team Web?", "warum?")
      if (!s || !validStory(s)) s = notice(it.q || it.req.text || '');
      out.set(it.id, s); prev = s;
    }
    storyCache.current = out;
    return out;
  }, [items, ctx, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  function storyOf(it) { return storyCache.current.get(it.id) || null; }
  // usage: the skill of each new answer (counts only)
  const seenTurns = useRef(0);
  useEffect(() => { if (stories.size > seenTurns.current) { const s = [...stories.values()].at(-1); if (s?.skill) track(`lotse:story:${s.skill}`); if (s?.understood?.learned) track('lotse:learned'); } seenTurns.current = stories.size; }, [stories.size]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = useMemo(() => (ctx && st.open && !items.length ? (briefing(ctx) || []).filter(validStory).slice(0, 3) : []), [ctx, st.open, items.length, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // open: remember who opened, focus the composer; close: focus goes back
  useEffect(() => {
    if (st.open) { opener.current = document.activeElement; setTimeout(() => inputRef.current?.focus(), 40); }
    else if (opener.current?.isConnected) { opener.current.focus?.(); opener.current = null; }
  }, [st.open]);
  // the newest turn scrolls into view
  useEffect(() => { if (st.open && items.length) setTimeout(() => lastRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }, [items.length, st.open]);
  // Esc closes; Tab stays inside the panel
  useEffect(() => {
    if (!st.open) return undefined;
    const h = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.popover, .modal')) { e.preventDefault(); closeLotse(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const f = [...panelRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!panelRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [st.open]);

  if (!st.open) return null;
  const clear = () => {
    const prev = items;
    const ids = prev.map((x) => x.id);
    setItems([]);
    runStore.hide(ids);
    const e = pushUndo(tr('Lotse-Verlauf geleert', 'Lotse thread cleared'), async () => { runStore.hide(ids, false); setItems(prev); }, ['lotse:thread']);
    toast({ text: tr('Verlauf geleert', 'Thread cleared'), icon: 'trash', undo: () => runUndo(e) });
  };
  const turn = (it) => {
    if (it.act === 'command') return <CommandCard item={it} ctx={ctx} />;
    if (it.act === 'workflow') return <WorkflowRunner item={it} ctx={jobCtx} onAsk={onAsk} onGallery={gallery} />;
    if (it.act === 'decide') return <DecideItem item={it} ctx={ctx} onResolved={(v) => (v.workflow ? startJob(v.workflow, v.params || {}, null) : addCommand(v.command, v.params || {}, null, null))} />;
    if (it.act === 'gallery') return <div className="lx-card is-info"><Gallery onPick={(id) => startJob(id)} compact /></div>;
    const s = stories.get(it.id);
    if (!s) return null;
    const job = SKILL_JOB[s.skill] ? jobOf(SKILL_JOB[s.skill]) : null;
    const p = s.understood?.params || {};
    return <>
      <StoryCard story={s} q={it.q} onAsk={onAsk} />
      {/* the picture of a job Lotse can also do: one click starts it (decisions and preview follow, nothing written before) */}
      {job && it === items.at(-1) && (
        <motion.button type="button" className="lx-bridge" data-bridge={job.id} onClick={() => startJob(job.id, { ...(p.ref ? { ref: p.ref } : {}), ...(p.team ? { team: p.team } : {}) }, it.q)}
          {...enter(0, { y: 6, delay: 0.25 })} {...press(0.98)}>
          <span className="lx-job-ic" aria-hidden="true"><Icon name={job.icon} size={15} /></span>
          <span className="grow"><b>{tr(`Mit Lotse erledigen: ${job.title[0]}`, `Get it done with Lotse: ${job.title[1]}`)}</b><span className="faint">{tr('Schritt für Schritt mit Vorschau – alles rückgängig zu machen', 'Step by step with a preview – everything can be undone')}</span></span>
          <Icon name="arrowRight" size={14} />
        </motion.button>
      )}
      {s.skill === 'help' && it.req.text && it === items.at(-1) && <AiRoute text={it.req.text} onRoute={(skill, params) => push({ skill, params }, it.req.text)} />}
    </>;
  };
  return (
    <>
      <motion.div className="lp-scrim" onClick={closeLotse} {...enter(0, { y: 0, d: 'quick' })} aria-hidden="true" />
      <motion.div ref={panelRef} className="lp" role="dialog" aria-modal="true" aria-labelledby="lp-title" data-lotse-panel
        {...enter(0, { y: 0, x: 32, spring: 'panel' })}>
        <div className="lp-head">
          <span className="lp-mark"><LotseMark size={20} /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <h2 id="lp-title">Lotse</h2>
            <p className="lp-sub">{tr('Rechnet und handelt mit euren echten Jira-Daten – sofort, ohne KI, immer mit Vorschau.', 'Works and acts on your real Jira data – instantly, without AI, always with a preview.')}</p>
          </div>
          {items.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={gallery} data-lotse-gallery><Icon name="layers" size={13} />{tr('Aufgaben', 'Jobs')}</button>}
          {items.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={clear}><Icon name="trash" size={13} />{tr('Neu', 'New')}</button>}
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={closeLotse} aria-label={tr('Lotse schließen (Esc)', 'Close Lotse (Esc)')}><Icon name="x" /></button>
        </div>

        <div className="lp-body">
          {!items.length && (
            <motion.div className="lp-hello" {...enter(0, { y: 8, d: 'gentle' })}>
              <h3>{tr('Wohin soll\'s gehen?', 'Where to?')}</h3>
              <p className="muted">{tr('Frag in deinen Worten oder gib Lotse eine Aufgabe – jede Antwort ist ein Bild mit den echten Zahlen, jede Änderung kommt mit Vorschau und lässt sich rückgängig machen.', 'Ask in your own words or give Lotse a job – every answer is a picture with the real numbers, every change comes with a preview and can be undone.')}</p>
              {today.length > 0 && (
                <div className="lp-today" role="group" aria-label={tr('Heute wichtig für dich', 'Important for you today')}>
                  {today.map((s, i) => (
                    <motion.button key={s.id || i} type="button" className={`lp-today-item is-${s.tone}`} onClick={() => push({ story: s }, null)}
                      {...enter(i, { y: 6 })}>
                      <span className={`ls-verdict ${s.tone}`}><i aria-hidden="true" />{toneWord(s.tone)}</span>
                      <span className="lp-today-h">{s.headline}</span>
                      <Icon name="arrowRight" size={13} />
                    </motion.button>
                  ))}
                </div>
              )}
              <Gallery onPick={(id) => startJob(id)} />
            </motion.div>
          )}
          {items.map((it, i) => (
            <div key={it.id} data-item={it.id} ref={i === items.length - 1 ? lastRef : undefined} className="lp-turn">{turn(it)}</div>
          ))}
        </div>

        <div className="lp-foot">
          {!items.length && (
            <div className="lp-chips" role="group" aria-label={tr('Vorschläge', 'Suggestions')}>
              {STARTERS().map((t) => <button key={t} type="button" className="ls-chip" onClick={() => onAsk(t)}>{t}</button>)}
            </div>
          )}
          <Composer onAsk={onAsk} inputRef={inputRef} />
        </div>
      </motion.div>
    </>
  );
}
