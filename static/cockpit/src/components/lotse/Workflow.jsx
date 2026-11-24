// A whole job with Lotse, in the thread: the stepper (overview · decide · preview · apply · result), the stories as
// they come, one decision card at a time, the aggregated preview, the commands applied one by one with progress, and
// the summary with per-change undo and "undo all". The run lives in runStore, so it goes on while the panel is closed
// and resumes where it was; the header shows a small pill while a run waits for the person.
// Writes: only after the preview step was answered "apply" (the engine stamps each command with its preview token);
// before that, the preview is checked against the live data – changed data means a fresh preview, never a stale write.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { enter, sp, tween, hoverLift, press } from '../../lib/motion.js';
import { errText, useApp } from '../../state.jsx';
import { tr, fmt } from '../../lib/i18n.js';
import { Icon } from '../../lib/icons.jsx';
import { track } from '../../lib/usage.js';
import { useTip, infoCard } from '../ui.jsx';
import { previewCommand, startWorkflow, answerWorkflow, nextWorkflow, applyWorkflowStep, cancelWorkflow, currentStep, refreshWorkflow } from './engine.js';
import { useActs } from './hooks.js';
import { runStore } from './runStore.js';
import { phasesOf, staleItems, replayAnswers, JOBS } from './acts.js';
import { ChangeDiff, DecisionCard, useRun, useTakeFocus, changesWord, answerText } from './ActCards.jsx';
import StoryCard, { toneWord } from './StoryCard.jsx';
import { JobPlan, JobSections, JobOutline, JobResult } from './JobCards.jsx';
import { ChainPlanCard, ChainGraph, SectionHead, SetTable, GateCard, NoteCard, ChainResult } from './ChainCards.jsx';
import { chainSections } from '@shared/lotse/act/chain/run.js';
import { changedKeys } from '../ProofLotse.jsx';
import { ProofIcon, JiraKeysButton } from '../ProofPanel.jsx';
import { openJql } from '../../lib/api.js';
import './lotse.css';
import './acts.css';

const API = { start: startWorkflow, answer: answerWorkflow, next: nextWorkflow, current: currentStep };
const L2 = (p) => tr(p[0], p[1]);
// a copy of a workflow state that keeps the engine's (non-enumerable) ctx – for the UI's own marks (undone)
function markStep(state, stepId, patch) {
  const s = { ...state, steps: state.steps.map((x) => (x.id === stepId ? { ...x, ...patch } : x)), applied: state.applied.filter((id) => !(id === stepId && patch.status === 'undone')) };
  Object.defineProperty(s, 'ctx', { value: state.ctx, enumerable: false, writable: true, configurable: true });
  return s;
}
// Starts a run for a thread item (state: the one Engine.lotse already started, else a fresh one).
export function beginRun(id, { goal, state, ctx }) {
  if (runStore.run(id)) return;
  const s = state || startWorkflow(goal, ctx);
  runStore.set(id, { kind: 'workflow', goal: s.goal || goal, state: s, at: Date.now(), phase: 'idle', entries: {} });
  track(`lotse:workflow:${s.goal?.id || goal?.id}:start`);
}

function Stepper({ state, id }) {
  const phases = phasesOf(state);
  return (
    <ol className="lx-steps" aria-label={tr('Schritte', 'Steps')}>
      {phases.map((p, i) => (
        <li key={p.kind} className={`${p.current ? 'cur' : ''} ${p.complete ? 'ok' : ''}`} aria-current={p.current ? 'step' : undefined}>
          <span className="lx-step-dot" aria-hidden="true">{p.complete ? <Icon name="check" size={11} /> : i + 1}</span>
          <span className="lx-step-name">{L2(p.name)}{p.kind === 'decide' && p.total > 1 ? <span className="num faint"> {Math.min(p.done + (p.current ? 1 : 0), p.total)}/{p.total}</span> : null}</span>
          {p.current && <motion.span layoutId={`lx-step-${id}`} className="lx-step-hl" transition={sp('chip')} />}
        </li>
      ))}
    </ol>
  );
}

function StoryLine({ step, open, onToggle }) {
  return (
    <button type="button" className="lx-storyline" aria-expanded={open} onClick={onToggle}>
      <span className={`ls-verdict ${step.story?.tone || 'info'}`}><i aria-hidden="true" />{toneWord(step.story?.tone)}</span>
      <span className="grow">{step.title}</span>
      <Icon name={open ? 'up' : 'chevronDown'} size={13} />
    </button>
  );
}

function PreviewStep({ step, busy, onApply, onSkip, notice }) {
  const blockedItems = (step.items || []).filter((x) => x.preview?.blocked).map((x) => ({ title: x.title, reason: x.preview.blocked }));
  const writes = (step.items || []).some((x) => x.preview?.write && !x.preview.blocked);
  const ok = !step.options?.find((o) => o.id === 'apply')?.disabled;
  const report = (step.items || []).some((x) => x.command === 'report.compose');
  const doc = (step.items || []).some((x) => x.command === 'doc.pdf' || x.command === 'doc.chain');
  const goLabel = step.options?.find((o) => o.id === 'apply')?.label;
  const pv = { changes: step.changes, count: step.count, more: step.more, warnings: (step.items || []).flatMap((x) => x.preview?.warnings || []), totals: {} };
  const root = useRef(null);
  useTakeFocus(root, ['.lx-go:not(:disabled)'], true, step.id);
  return (
    <motion.section ref={root} className="lx-card is-act" aria-label={`${step.title}: ${step.summary}`} data-act="preview" {...enter(0, { y: 12, scale: 0.985, spring: 'card' })}>
      <span className="lx-kicker"><Icon name="eye" size={12} />{step.title}</span>
      {/* a step that writes nothing (the report composer) says what it opens, not "0 changes" */}
      <h3 className="lx-title">{writes || doc || !step.items?.[0]?.preview?.summary ? step.summary : step.items[0].preview.summary}</h3>
      {doc && <JobOutline outline={step.outline} />}
      {(step.items || []).length > 1 && (
        <ul className="lx-items" aria-label={tr('Schritte dieser Vorschau', 'Steps of this preview')}>
          {step.items.map((x) => <li key={x.stepId} className={x.preview?.blocked ? 'off' : ''}><Icon name={x.preview?.blocked ? 'lock' : 'check'} size={12} /><span className="grow">{x.title}</span><span className="num faint">{changesWord(x.preview?.count || 0)}</span></li>)}
        </ul>
      )}
      {(step.count > 0 || blockedItems.length > 0 || pv.warnings.length > 0) && <ChangeDiff pv={pv} blockedItems={blockedItems} />}
      {notice && <p className="lx-notice" role="status"><Icon name="refresh" size={13} />{notice}</p>}
      <div className="lx-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onSkip} disabled={busy}>{doc ? step.options?.find((o) => o.id === 'skip')?.label || tr('Nicht erstellen', 'Do not create') : tr('Nicht übernehmen', 'Do not apply')}</button>
        <motion.button type="button" className="btn btn-primary btn-sm lx-go" onClick={onApply} disabled={busy || !ok} {...press()} aria-busy={busy}>
          <Icon name={doc ? 'pdf' : writes ? 'check' : report ? 'report' : 'arrowRight'} size={14} />{doc && goLabel ? goLabel : writes ? tr(`Ausführen (${changesWord(step.count)})`, `Apply (${changesWord(step.count)})`) : report ? tr('Report-Baukasten öffnen', 'Open the report composer') : tr('Weiter', 'Continue')}
        </motion.button>
      </div>
    </motion.section>
  );
}

function Progress({ k, n }) {
  return (
    <div className="lx-progress" role="progressbar" aria-valuemin={0} aria-valuemax={n} aria-valuenow={k} aria-label={tr('Wird ausgeführt', 'Applying')}>
      <span className="lx-progress-text"><Icon name="refresh" size={13} className="lx-spin" />{tr(`Wird ausgeführt – Schritt ${Math.min(k + 1, n)} von ${n}`, `Applying – step ${Math.min(k + 1, n)} of ${n}`)}</span>
      <span className="lx-bar"><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: n ? Math.max(0.06, k / n) : 1 }} transition={tween('gentle')} /></span>
    </div>
  );
}

const STATUS_ICON = { applied: 'check', undone: 'undo', skipped: 'x', failed: 'alert', cancelled: 'x', todo: 'clock' };
function Summary({ state, entries, onUndo, onUndoAll, onMore, busy, ctx }) {
  const { computed, ds } = useApp();
  // Nachprüfen: exactly the work items this run wrote, in Jira's issue search (JQL, 100 per search)
  const written = useMemo(() => changedKeys(state, computed?.model, ds?.supportTickets?.tickets), [state, computed, ds]);
  const sm = state.steps.find((x) => x.kind === 'summary');
  const cmds = state.steps.filter((x) => x.kind === 'command');
  const applied = cmds.filter((x) => x.status === 'applied');
  const undone = cmds.filter((x) => x.status === 'undone');
  const undoable = applied.filter((x) => entries[x.id]);
  // the same unit as the preview the person confirmed (change rows); with failures, honestly the work items written
  const shownCount = (id) => state.steps.find((p) => p.kind === 'preview' && (p.covers || []).includes(id))?.items?.find((i) => i.stepId === id)?.preview?.count;
  const changesOf = (x) => (x.result?.failed ? x.result?.applied || 0 : shownCount(x.id) ?? (x.result?.applied || 0));
  const changes = applied.reduce((a, x) => a + changesOf(x), 0);
  const failed = cmds.some((x) => x.status === 'failed' || x.result?.failed);
  const nFailed = cmds.filter((x) => x.status === 'failed').length + cmds.reduce((a, x) => a + (x.result?.failed || 0), 0);
  const tone = failed ? 'warn' : applied.length ? 'ok' : 'info';
  const writes = applied.filter((x) => !x.result?.open && !x.result?.navigate);
  const text = undone.length && !applied.length ? tr('Alles rückgängig gemacht – die Daten sind wie vorher.', 'Everything undone – the data is as before.')
    : undone.length ? tr(`${undone.length} ${undone.length === 1 ? 'Schritt' : 'Schritte'} rückgängig gemacht, ${changesWord(changes)} bleiben.`, `${undone.length} ${undone.length === 1 ? 'step' : 'steps'} undone, ${changesWord(changes)} stay.`)
      : writes.length && !failed ? tr(`Übernommen: ${changesWord(changes)} in ${writes.length} ${writes.length === 1 ? 'Schritt' : 'Schritten'}.`, `Applied: ${changesWord(changes)} in ${writes.length} ${writes.length === 1 ? 'step' : 'steps'}.`)
        : failed ? tr(`${changesWord(changes)} übernommen, ${nFailed} nicht – die Gründe stehen unten.`, `${changesWord(changes)} applied, ${nFailed} not – the reasons are below.`)
          : sm?.text || sm?.note || tr('Fertig.', 'Done.');
  return (
    <motion.section className={`lx-card lx-summary-card is-${tone}`} aria-label={`${tr('Ergebnis', 'Result')}: ${state.title}`} data-act="summary" role="status" {...enter(0, { y: 12, scale: 0.985, spring: 'card' })}>
      <div className="lx-sum-head">
        <motion.span className={`lx-sum-ic ${tone}`} aria-hidden="true" {...enter(0, { y: 0, scale: 0.6, spring: 'pop', delay: 0.05 })}><Icon name={tone === 'info' ? 'info' : 'check'} size={18} /></motion.span>
        <div className="grow"><span className="lx-kicker">{tr('Ergebnis', 'Result')}</span><h3 className="lx-title">{text}</h3>{sm?.note && sm.text && <p className="lx-summary">{sm.note}</p>}</div>
      </div>
      {sm?.job && <JobResult job={sm.job} ctx={ctx} />}
      {state.goal?.id === 'chain' && <ChainResult state={state} ctx={ctx} />}
      {cmds.length > 0 && (
        <ul className="lx-lines">
          {cmds.map((x) => (
            <li key={x.id} className={`st-${x.status}`}>
              <Icon name={STATUS_ICON[x.status] || 'info'} size={13} />
              <div className="grow">
                <span>{x.title}</span>
                <span className="faint lx-small">
                  {x.status === 'applied' ? (x.result?.open ? tr('geöffnet', 'opened') : tr(`${changesWord(changesOf(x))} übernommen`, `${changesWord(changesOf(x))} applied`)) : x.status === 'undone' ? tr('rückgängig gemacht', 'undone') : x.status === 'failed' ? `${tr('fehlgeschlagen', 'failed')}: ${x.error?.message || x.error?.code || ''}` : x.reason === 'declined' ? tr('nicht übernommen', 'not applied') : tr('übersprungen', 'skipped')}
                  {x.result?.failed ? tr(` · ${x.result.failed} fehlgeschlagen`, ` · ${x.result.failed} failed`) : ''}
                  {x.status === 'applied' && x.result?.irreversible ? tr(' · nicht rückgängig zu machen', ' · cannot be undone') : ''}
                </span>
                {(x.result?.errors || []).length > 0 && <ul className="lx-errors">{x.result.errors.slice(0, 6).map((e, i) => <li key={i}><span className="mono">{e.key || '–'}</span><span>{e.message || e.code}</span></li>)}</ul>}
              </div>
              {x.status === 'applied' && entries[x.id] && cmds.length > 1 && <button type="button" className="btn btn-xs" onClick={() => onUndo(x.id)} disabled={busy}><Icon name="undo" size={12} />{tr('Rückgängig', 'Undo')}</button>}
            </li>
          ))}
        </ul>
      )}
      <div className="lx-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onMore}><Icon name="layers" size={13} />{tr('Weitere Aufgabe', 'Another job')}</button>
        {written.length > 0 && written.length <= 100 && <button type="button" className="btn btn-sm" data-proof-written={written.length} onClick={() => { track('proof:workflow'); openJql(written); }} title={tr('Öffnet genau die geänderten Vorgänge in der Jira-Suche, damit du die Änderungen prüfen kannst', 'Opens exactly the changed work items in Jira search so you can verify the changes')}><ProofIcon size={13} />{tr(`In Jira ansehen (${written.length})`, `View in Jira (${written.length})`)}</button>}
        {written.length > 100 && <span data-proof-written={written.length}><JiraKeysButton keys={written} className="btn btn-sm" /></span>}
        {undoable.length > 0 && <button type="button" className="btn btn-sm" onClick={onUndoAll} disabled={busy}><Icon name="undo" size={13} />{tr('Alles rückgängig', 'Undo all')}</button>}
      </div>
    </motion.section>
  );
}

export function WorkflowRunner({ item, ctx, onAsk, onGallery }) {
  const run = useRun(item.id);
  const acts = useActs();
  const [open, setOpen] = useState({}); // older stories the person expanded
  const s = run.state;
  const cur = s ? currentStep(s) : null;
  const set = (patch) => runStore.set(item.id, patch);
  const wfId = s?.goal?.id;
  // stories are read alongside the next decision (no extra click); the summary closes the run
  useEffect(() => {
    if (!s || run.phase === 'applying') return;
    if (cur?.kind === 'story') set({ state: nextWorkflow(s) });
    else if (cur?.kind === 'summary') set({ state: nextWorkflow(s) });
    else if (s.status === 'done' && !run.counted) { set({ counted: true }); track(`lotse:workflow:${wfId}:done`); }
  }, [s, run.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = (stepId, value) => { set({ state: answerWorkflow(s, stepId, value, ctx), notice: null }); };
  const skip = (stepId) => set({ state: answerWorkflow(s, stepId, 'skip'), notice: null });
  const apply = async (stepId) => {
    const pvStep = s.steps.find((x) => x.id === stepId);
    // changed data since this preview → plan again with the earlier answers; the person sees the fresh preview first
    // a chain re-plans in place (its finished steps and writes stay); a single job is replayed with the earlier answers
    if (ctx && s.goal?.id === 'chain' && staleItems(pvStep, s.steps, ctx, previewCommand).length) {
      set({ state: refreshWorkflow(s, ctx), notice: tr('Die Daten haben sich geändert – Lotse hat die Vorschau neu berechnet. Bitte noch einmal prüfen.', 'The data changed – Lotse recomputed the preview. Please check it again.') });
      return;
    }
    if (ctx && staleItems(pvStep, s.steps, ctx, previewCommand).length) {
      set({ state: replayAnswers(s.goal, s.answers, ctx, API), notice: tr('Die Daten haben sich geändert – Lotse hat die Vorschau neu berechnet. Bitte noch einmal prüfen.', 'The data changed – Lotse recomputed the preview. Please check it again.') });
      return;
    }
    let st = answerWorkflow(s, stepId, 'apply'); // the plan's own data: every command carries the token of what was shown
    const n = st.steps.filter((x) => x.kind === 'command' && x.token && !['applied', 'skipped', 'failed', 'undone'].includes(x.status)).length;
    const entries = { ...(run.entries || {}) };
    let after = null;
    set({ state: st, phase: 'applying', progress: { k: 0, n }, notice: null });
    for (let k = 0; currentStep(st)?.kind === 'command'; k++) {
      const id = currentStep(st).id;
      st = await applyWorkflowStep(st, acts.io);
      const done = st.steps.find((x) => x.id === id);
      if (done?.status === 'applied') {
        acts.counted(done.command);
        if (done.undo) entries[id] = acts.record(tr(`${s.title}: ${done.title} (Lotse)`, `${s.title}: ${done.title} (Lotse)`), done.undo.run, done.undo.keys, () => runStore.set(item.id, (r) => ({ ...r, state: markStep(r.state, id, { status: 'undone' }) })));
        if (done.result?.open || done.result?.navigate) after = done.result;
      }
      set({ state: st, progress: { k: k + 1, n }, entries });
    }
    set({ phase: 'idle' });
    if (after) acts.follow(after);
  };
  const cancel = () => { set({ state: cancelWorkflow(s) }); track(`lotse:workflow:${wfId}:cancel`); };
  const undoOne = async (stepId) => { const e = run.entries?.[stepId]; if (e) await acts.runUndo(e); };
  const undoAll = async () => {
    set({ phase: 'undoing' });
    // newest first, through the global history (the same order undoWorkflow uses) – Ctrl/⌘ + Z stays in step
    const ids = [...(s.applied || [])].reverse().filter((id) => run.entries?.[id]);
    let n = 0;
    for (const id of ids) { if (!(await acts.runUndo(run.entries[id], { quiet: true }))) break; n++; }
    set({ phase: 'idle' });
    if (n) acts.say(tr(`${n} ${n === 1 ? 'Schritt' : 'Schritte'} rückgängig gemacht`, `${n} ${n === 1 ? 'step' : 'steps'} undone`), 'history');
  };

  const visible = useMemo(() => {
    if (!s) return [];
    const k = cur ? s.steps.indexOf(cur) : s.steps.length;
    return s.steps.filter((x, i) => (i <= k || x.status !== 'todo') && x.kind !== 'command' && x.kind !== 'summary' && x.status !== 'cancelled');
  }, [s, cur]);
  if (!s) return null;
  const lastStory = [...visible].reverse().find((x) => x.kind === 'story');
  const live = ['running', 'waiting', 'ready'].includes(s.status);
  const applying = run.phase === 'applying';
  const decisions = visible.filter((x) => x.kind === 'decide').length;
  const isChain = wfId === 'chain';
  const secs = isChain ? chainSections(s) : null;
  let lastSec = null;
  // a chain's steps come in sections: a header where a new one starts (its number, title and live status)
  const head = (x) => {
    const sid = x.meta?.section;
    if (!isChain || !sid || sid === 'plan' || sid === lastSec) return null;
    lastSec = sid;
    const k = secs.sections.findIndex((y) => y.id === sid);
    return k >= 0 ? <SectionHead key={`h:${sid}`} sec={secs.sections[k]} index={k} ctx={ctx} /> : null;
  };
  const render = (x) => {
          if (isChain && x.kind === 'decide' && x.edit === 'chain') return <ChainPlanCard key={x.id} step={x} ctx={ctx} active={x === cur && live} answered={x === cur ? undefined : x.answer} onAnswer={(v) => answer(x.id, v)} />;
          if (isChain && x.kind === 'decide' && x.gate) return x === cur && live ? <GateCard key={x.id} step={x} state={s} active onAnswer={(v) => answer(x.id, v)} /> : <DecisionCard key={x.id} step={x} answered={x.answer} active={false} onAnswer={() => {}} />;
          if (isChain && x.kind === 'decide' && x.custom === 'note') return <NoteCard key={x.id} step={x} active={x === cur && live} answered={x === cur ? undefined : x.answer} onAnswer={(v) => answer(x.id, v)} />;
          if (isChain && x.kind === 'story' && x.set && (x === lastStory && live || open[x.id])) return <div key={x.id} className="lx-run-story"><StoryCard story={x.story} onAsk={onAsk} /><SetTable set={x.set} /></div>;
          if (x.kind === 'story' && x.group === 'sections') {
            // the personal sections: one tabbed block at the first of them
            const all = visible.filter((y) => y.kind === 'story' && y.group === 'sections');
            return all[0] === x ? <JobSections key="lj-sections" steps={all} onAsk={onAsk} /> : null;
          }
          if (x.kind === 'story' && x.plan) {
            const full = x === lastStory && live || open[x.id];
            return <div key={x.id} className="lx-run-story"><JobPlan plan={x.plan} />{full ? <StoryCard story={x.story} onAsk={onAsk} /> : <StoryLine step={x} open={!!open[x.id]} onToggle={() => setOpen((o) => ({ ...o, [x.id]: !o[x.id] }))} />}</div>;
          }
          if (x.kind === 'story') {
            const full = x === lastStory && live || open[x.id];
            return <div key={x.id} className="lx-run-story">{full ? <StoryCard story={x.story} onAsk={onAsk} /> : <StoryLine step={x} open={!!open[x.id]} onToggle={() => setOpen((o) => ({ ...o, [x.id]: !o[x.id] }))} />}{full && x !== lastStory && <StoryLine step={x} open onToggle={() => setOpen((o) => ({ ...o, [x.id]: false }))} />}</div>;
          }
          if (x.kind === 'decide') return <DecisionCard key={x.id} step={x} answered={x === cur ? undefined : x.answer} active={x === cur && live} onAnswer={(v) => answer(x.id, v)} />;
          if (x.kind === 'preview') {
            if (x === cur) return <PreviewStep key={x.id} step={x} busy={applying} notice={run.notice} onApply={() => apply(x.id).catch((e) => { set({ phase: 'idle', notice: errText(e) }); })} onSkip={() => skip(x.id)} />;
            return <div key={x.id} className="lx-answered"><span className="lx-answered-q">{x.summary}</span><span className="lx-answered-a"><Icon name={x.answer === 'apply' ? 'check' : 'x'} size={12} />{answerText(x, x.answer)}</span></div>;
          }
          return null;
  };
  return (
    <motion.article className={`lx-run ${live ? 'live' : ''}`} aria-label={s.title} data-act="workflow" data-workflow={wfId} data-status={s.status}
      {...enter(0, { y: 12, d: 'gentle' })}>
      <header className="lx-run-head">
        <span className="lx-run-ic" aria-hidden="true"><Icon name={JOBS.find((j) => j.id === wfId)?.icon || 'layers'} size={16} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <span className="lx-kicker">{live ? tr('Aufgabe mit Lotse', 'Job with Lotse') : s.status === 'cancelled' ? tr('Abgebrochen', 'Cancelled') : tr('Erledigt', 'Done')}{decisions ? ` · ${decisions} ${decisions === 1 ? tr('Entscheidung', 'decision') : tr('Entscheidungen', 'decisions')}` : ''}</span>
          <h3 className="lx-run-title">{s.title}</h3>
        </div>
        {live && !applying && <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}><Icon name="x" size={13} />{tr('Abbrechen', 'Cancel')}</button>}
      </header>
      {item.q && <p className="ls-q">„{item.q}“</p>}
      {isChain ? <ChainGraph state={s} ctx={ctx} /> : <Stepper state={s} id={item.id} />}
      <div className="lx-run-body">
        {visible.flatMap((x) => [head(x), render(x)])}
        {applying && run.progress && <Progress k={run.progress.k} n={run.progress.n} />}
        {s.status === 'done' && !applying && <Summary state={s} ctx={ctx} entries={run.entries || {}} busy={run.phase === 'undoing'} onUndo={undoOne} onUndoAll={undoAll} onMore={onGallery} />}
        {s.status === 'cancelled' && (
          <p className="lx-cancelled" role="status"><Icon name="info" size={13} />{(s.applied || []).length ? tr('Abgebrochen – bereits übernommene Schritte bleiben; rückgängig über den Verlauf oben rechts.', 'Cancelled – steps already applied stay; undo them from the history at the top right.') : tr('Abgebrochen – nichts wurde geändert.', 'Cancelled – nothing was changed.')}</p>
        )}
      </div>
    </motion.article>
  );
}

// "Was möchtest du erledigen?" – the ten jobs as cards; a card starts its workflow in the thread.
export function Gallery({ onPick, compact = false }) {
  const tip = useTip();
  const hid = useId();
  return (
    <section className={`lx-gallery ${compact ? 'compact' : ''}`} aria-labelledby={hid}>
      <h3 id={hid} className="lx-gal-h">{tr('Was möchtest du erledigen?', 'What do you want to get done?')}</h3>
      <div className="lx-gal-grid" role="group" aria-labelledby={hid}>
        {JOBS.map((j, i) => (
          <motion.button key={j.id} type="button" className="lx-job" data-job={j.id} onClick={() => onPick(j.id)}
            {...tip(infoCard({ title: L2(j.title), text: L2(j.line), hint: tr('Schritt für Schritt mit Vorschau – alles rückgängig zu machen', 'Step by step with a preview – everything can be undone') }))}
            {...enter(i, { y: 8 })} {...hoverLift()}>
            <span className="lx-job-ic" aria-hidden="true"><Icon name={j.icon} size={16} /></span>
            <span className="lx-job-t">{L2(j.title)}</span>
            <span className="lx-job-l">{L2(j.line)}</span>
            <span className="lx-job-d faint"><Icon name="clock" size={11} />{tr(`≈ ${fmt.n(j.minutes)} Min.`, `≈ ${fmt.n(j.minutes)} min`)}</span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
