// One Lotse answer = one Story card. Reading order: verdict (one sentence, coloured), the key numbers, the chart
// (the hero), 2–4 findings with clickable evidence, up to 3 actions (preview → apply → undo), follow-up questions,
// "So ermittelt" (how it was computed, from what), "Nachprüfen" (every number with its source, keys open Jira) and –
// with AI on – the AI reading with its cross-check.
// Motion: transform/opacity only, enter animations only (no exit animations – they stall in the Jira frame).
import { useState } from 'react';
import { motion } from 'framer-motion';
import { enter } from '../../lib/motion.js';
import { useApp, errText } from '../../state.jsx';
import { tr, fmt } from '../../lib/i18n.js';
import { Icon } from '../../lib/icons.jsx';
import { Counter, useTip, infoCard } from '../ui.jsx';
import { Visual, splitUnit, signed, evValue, TONE } from './visuals.jsx';
import { useStoryActions, isWrite } from './actions.js';
import CrossCheck from './CrossCheck.jsx';
import WhatIf from './WhatIf.jsx';
import { track } from '../../lib/usage.js';
import { StoryProof, StoryProofButton } from '../ProofLotse.jsx';
import './lotse.css';

const SUBJECT_ICON = { project: 'project', team: 'users', person: 'user', portfolio: 'ranking', ticket: 'headset', topic: 'layers' };
export const toneWord = (t) => ({ ok: tr('Im Plan', 'On track'), warn: tr('Achtung', 'Watch'), bad: tr('Kritisch', 'Critical'), info: tr('Hinweis', 'Note') }[t] || tr('Hinweis', 'Note'));
const kindWord = (k) => ({ project: tr('Projekt', 'Project'), team: 'Team', person: tr('Person', 'Person'), portfolio: 'Portfolio', ticket: 'Ticket', topic: tr('Thema', 'Topic') }[k] || '');
const confWord = (c) => ({ high: tr('sicher', 'confident'), medium: tr('eher sicher', 'fairly sure'), low: tr('unsicher – wenig Daten', 'unsure – little data') }[c] || null);

function Kpi({ k, i }) {
  const tip = useTip();
  const [, unit] = splitUnit(k.unit, k.value);
  const shown = k.value; // '%' is in percent points already (shared/lotse/story.js)
  const delta = signed(k.unit, k.delta);
  const deltaGood = k.delta == null ? null : k.tone === 'ok' || (k.tone !== 'bad' && k.tone !== 'warn');
  return (
    <motion.div className={`lk ${k.tone || ''}`} tabIndex={k.hint ? 0 : undefined} {...(k.hint ? tip(infoCard({ title: k.label, text: k.hint })) : {})}
      {...enter(i, { y: 6, d: 'gentle', delay: 0.05 })}>
      <span className="lk-label">{k.label}</span>
      <span className="lk-value" style={{ color: k.tone && k.tone !== 'info' ? TONE[k.tone] : undefined }}>
        {Number.isFinite(shown) ? <Counter value={shown} format={(v) => fmt.n(v, k.unit === 'h' && Math.abs(k.value) < 10 ? 1 : 0)} /> : '–'}
        {unit && <span className="lk-unit">{unit}</span>}
      </span>
      {delta && <span className={`lk-delta ${deltaGood ? '' : 'neutral'}`}>{delta}</span>}
    </motion.div>
  );
}

function Evidence({ ev, onGo }) {
  const tip = useTip();
  const can = !!(ev.key || ev.ref);
  const v = evValue(ev);
  const text = <>{ev.key && <span className="mono">{ev.key}</span>}{ev.label && ev.label !== ev.key && <span>{ev.label}</span>}{v != null && <b className="num">{v}</b>}</>;
  // evidence.text is the Jira text behind it (a summary, a reason) – shown on hover
  if (!can) return <span className="le static" tabIndex={ev.text ? 0 : undefined} {...(ev.text ? tip(infoCard({ title: ev.label, text: ev.text })) : {})}>{text}</span>;
  return (
    <button type="button" className="le" onClick={() => onGo(ev)} {...tip(infoCard({ title: ev.label || ev.key, sub: ev.key, text: ev.text, hint: ev.key ? tr('Klick: in Jira öffnen', 'Click: open in Jira') : tr('Klick: im Cockpit öffnen', 'Click: open in the cockpit') }))}>
      {text}<Icon name={ev.key ? 'external' : 'arrowRight'} size={11} />
    </button>
  );
}

function Action({ a, onWhatIf }) {
  const { apply, undo } = useStoryActions();
  const { toast } = useApp();
  const [phase, setPhase] = useState('idle'); // idle | preview | busy | applied
  const [entry, setEntry] = useState(null);
  // dispatch has no write path of its own here: its preview leads to the Support dispatch, which keeps its review step
  const handoff = a.kind === 'dispatch';
  const write = isWrite(a) || handoff;
  const icon = { open: 'external', navigate: 'arrowRight', whatIf: 'zap', rank: 'ranking', fill: 'edit', move: 'calendar', assign: 'user', dispatch: 'headset' }[a.kind] || 'arrowRight';
  const click = async () => {
    if (a.kind === 'whatIf') { track('lotse:action:whatIf'); onWhatIf(a.payload || {}); return; }
    if (write) { setPhase(phase === 'preview' ? 'idle' : 'preview'); return; }
    try { await apply(a); track(`lotse:action:${a.kind}`); } catch (e) { toast({ text: errText(e), error: true }); }
  };
  const doApply = async () => {
    setPhase('busy');
    try { const e = await apply(a); track(`lotse:action:${a.kind}`); setEntry(e); setPhase(handoff ? 'idle' : 'applied'); }
    catch (e) { toast({ text: errText(e), error: true }); setPhase('preview'); }
  };
  const doUndo = async () => { if (entry && (await undo(entry))) { setEntry(null); setPhase('idle'); } };
  return (
    <div className={`la ${phase}`}>
      <button type="button" className={`la-btn ${write ? 'write' : ''}`} onClick={click} aria-expanded={write ? phase === 'preview' : undefined} disabled={phase === 'busy' || phase === 'applied'} title={!write ? a.preview : undefined}>
        <Icon name={icon} size={13} /><span>{a.label}</span>{write && phase === 'idle' && <span className="la-hint">{tr('Vorschau', 'Preview')}</span>}
      </button>
      {phase === 'preview' && (
        <motion.div className="la-preview" {...enter(0, { y: -4 })}>
          <p><Icon name="eye" size={13} />{a.preview || a.label}</p>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => setPhase('idle')}>{tr('Abbrechen', 'Cancel')}</button>
            <button type="button" className="btn btn-xs btn-primary" onClick={doApply}><Icon name={handoff ? 'headset' : 'check'} size={12} />{handoff ? tr('Im Support prüfen', 'Review in Support') : tr('Übernehmen', 'Apply')}</button>
          </div>
        </motion.div>
      )}
      {phase === 'applied' && (
        <motion.div className="la-done" role="status" {...enter(0, { y: 0, scale: 0.97 })}>
          <Icon name="check" size={13} />{tr('Übernommen', 'Applied')}
          {entry && <button type="button" className="btn btn-xs" onClick={doUndo}><Icon name="undo" size={12} />{tr('Rückgängig', 'Undo')}</button>}
        </motion.div>
      )}
    </div>
  );
}

// The job Lotse can do next from this story (a mission sentence – it routes to the workflow like typed text).
// Kept in the UI so the engine's answers stay exactly as they are (tests/lotseResultsUnchanged.test.js).
export function missionFor(s) {
  if (!s?.skill) return null;
  const team = s.subject?.kind === 'team' && s.subject.name ? s.subject.name : null;
  // people in several teams: the check's conflicts → the mission, no questions ("automatisch" → mode auto)
  if (s.skill === 'splitCheck' && s.tone !== 'ok' && s.tone !== 'info') {
    const who = s.subject?.kind === 'team' && s.subject.name ? tr(` für Team ${s.subject.name}`, ` for team ${s.subject.name}`) : s.subject?.kind === 'person' && s.subject.name ? tr(` für ${s.subject.name}`, ` for ${s.subject.name}`) : '';
    return { label: tr('Mehrteam-Konflikte automatisch lösen', 'Resolve the multi-team conflicts automatically'), text: tr(`Löse die Mehrteam-Konflikte${who} automatisch`, `Resolve the multi-team conflicts${who} automatically`) };
  }
  if (s.skill === 'myWeek') return { label: tr('Woche auf 100 % planen', 'Plan my week to 100%'), text: tr('Plane meine Woche auf 100 %', 'Plan my week to 100%') };
  if (['teamBrief', 'realCapacity', 'overtime', 'planningAdvice'].includes(s.skill)) return team
    ? { label: tr(`Team ${team} realistisch planen`, `Plan team ${team} realistically`), text: tr(`Plane Team ${team} realistisch`, `Plan team ${team} realistically`) }
    : { label: tr('Ein Team realistisch planen', 'Plan a team realistically'), text: tr('Plane ein Team realistisch', 'Plan a team realistically') };
  if (['supportTopics', 'playbookDraft'].includes(s.skill)) return { label: tr('Playbooks für wiederkehrende Themen anlegen', 'Create playbooks for recurring topics'), text: tr('Erstelle Playbooks für wiederkehrende Support-Themen', 'Create playbooks for recurring support topics') };
  if (['similarSummary', 'estimate'].includes(s.skill) || (s.skill === 'projectBrief' && s.subject?.name)) {
    const p = s.subject?.kind === 'project' && s.subject.name ? s.subject.name : null;
    return { label: tr('Aus früheren Projekten lernen', 'Learn from past projects'), text: p ? tr(`Lerne aus früheren Projekten für ${p}`, `Learn from past projects for ${p}`) : tr('Lerne aus früheren Projekten', 'Learn from past projects') };
  }
  return null;
}

// story: the Story; onAsk(text): a follow-up question; nested: inside a what-if result (no second what-if, no AI).
export default function StoryCard({ story, onAsk, nested = false, q }) {
  const { go } = useStoryActions();
  const [how, setHow] = useState(false);
  const [proof, setProof] = useState(false);
  const [whatIf, setWhatIf] = useState(null); // the payload the scenario starts from
  const [scenario, setScenario] = useState(null); // the scenario's Story
  if (!story) return null;
  const s = story;
  const findings = [...(s.findings || [])].sort((a, b) => (b.impact || 0) - (a.impact || 0)).slice(0, 4);
  const actions = (s.actions || []).slice(0, 3);
  const empty = !s.visual?.data || s.tone === 'info' && !(s.kpis || []).length;
  const mission = !nested && onAsk ? missionFor(s) : null;
  return (
    <motion.article className={`ls is-${s.tone || 'info'} ${nested ? 'nested' : ''}`} aria-label={`${kindWord(s.subject?.kind)} ${s.subject?.name || ''}: ${s.headline}`} data-story={s.skill} data-visual={s.visual?.kind}
      {...enter(0, { y: 14, scale: 0.985, spring: 'card' })}>
      <header className="ls-head">
        <span className="ls-subject"><Icon name={SUBJECT_ICON[s.subject?.kind] || 'layers'} size={12} />{kindWord(s.subject?.kind)}{s.subject?.name && s.subject.kind !== 'portfolio' ? <b>{s.subject.name}</b> : null}</span>
        <span className={`ls-verdict ${s.tone || 'info'}`}><i aria-hidden="true" />{toneWord(s.tone)}</span>
      </header>
      {q && <p className="ls-q">„{q}“</p>}
      <h3 className="ls-headline">{s.headline}</h3>

      {(s.kpis || []).length > 0 && <div className="ls-kpis">{s.kpis.slice(0, 4).map((k, i) => <Kpi key={k.id || k.label} k={k} i={i} />)}</div>}

      {!empty && <div className="ls-hero"><Visual visual={s.visual} onEvidence={go} /></div>}

      {findings.length > 0 && (
        <ol className="ls-findings">
          {findings.map((f, i) => (
            <motion.li key={i} {...enter(i, { y: 0, x: -6, d: 'gentle', delay: 0.15 })}>
              <i className="ls-dot" aria-hidden="true" style={{ background: TONE[f.tone] || 'var(--line-strong)' }} />
              <div>
                <p>{f.text}</p>
                {(f.evidence || []).length > 0 && <div className="ls-ev">{f.evidence.slice(0, 6).map((ev, j) => <Evidence key={j} ev={ev} onGo={go} />)}</div>}
              </div>
            </motion.li>
          ))}
        </ol>
      )}

      {actions.length > 0 && <div className="ls-actions" role="group" aria-label={tr('Mögliche Schritte', 'Possible steps')}>{actions.map((a) => <Action key={a.id || a.label} a={a} onWhatIf={(p) => { setWhatIf(p); setScenario(null); }} />)}</div>}

      {whatIf && !nested && (
        <div className="ls-whatif">
          <WhatIf initial={{ ...whatIf, ref: whatIf.ref || s.subject?.ref }} onResult={(st) => setScenario(st)} onClose={() => { setWhatIf(null); setScenario(null); }} />
          {scenario && <StoryCard story={scenario} nested onAsk={onAsk} />}
        </div>
      )}

      {mission && (
        <button type="button" className="ls-mission" data-mission onClick={() => onAsk(mission.text)}>
          <span className="ls-mission-ic" aria-hidden="true"><Icon name="zap" size={14} /></span>
          <span className="ls-mission-t"><b>{mission.label}</b><small>{tr('Lotse erledigt das mit dir – Schritt für Schritt, mit Vorschau und Rückgängig', 'Lotse does it with you – step by step, with a preview and undo')}</small></span>
          <Icon name="arrowRight" size={14} />
        </button>
      )}

      {!nested && (s.followUps || []).length > 0 && onAsk && (
        <div className="ls-follow" role="group" aria-label={tr('Weiterfragen', 'Ask next')}>
          {s.followUps.slice(0, 4).map((f) => <button key={f.text} type="button" className="ls-chip" onClick={() => onAsk(f.text)}><Icon name="arrowRight" size={11} />{f.label || f.text}</button>)}
        </div>
      )}

      <footer className="ls-foot">
        <button type="button" className="ls-how-btn" aria-expanded={how} onClick={() => setHow(!how)}><Icon name="info" size={12} />{tr('So ermittelt', 'How it was found')}</button>
        <StoryProofButton open={proof} onToggle={() => setProof(!proof)} />
        <span className="faint ls-meta">{(s.sources || []).join(' · ')}{confWord(s.confidence) ? ` · ${confWord(s.confidence)}` : ''}{s.computedAt ? ` · ${fmt.time(s.computedAt)}` : ''}</span>
        {!nested && <CrossCheck story={s} />}
      </footer>
      {how && s.how && (
        <motion.div className="ls-how" {...enter(0, { y: -4 })}>
          {s.how.text && <p>{s.how.text}</p>}
          {(s.how.inputs || []).length > 0 && <dl>{s.how.inputs.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd className="num">{v}</dd></div>)}</dl>}
          <p className="faint">{tr('Gerechnet vom Cockpit nach festen Regeln – ohne KI, aus den Daten, die du sehen darfst.', 'Computed by the cockpit with fixed rules – without AI, from the data you may see.')}</p>
        </motion.div>
      )}
      {proof && <StoryProof story={s} onGo={go} />}
    </motion.article>
  );
}
