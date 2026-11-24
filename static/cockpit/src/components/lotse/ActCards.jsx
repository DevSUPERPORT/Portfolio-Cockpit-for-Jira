// Lotse acts in the thread: the visual diff of a preview, the command card (preview → apply → undo) and the decision
// card (question, option cards, free text, keys 1–9). Nothing here writes without the preview the person just saw:
// apply always sends that preview's token, and the engine refuses a token the data no longer matches.
// Motion: transform / opacity only, enter animations only (no exit animations – they stall in the Jira frame).
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { enter, press, popMark } from '../../lib/motion.js';
import { errText } from '../../state.jsx';
import { tr, fmt } from '../../lib/i18n.js';
import { Icon } from '../../lib/icons.jsx';
import { useTip, infoCard } from '../ui.jsx';
import { previewCommand, applyCommand } from './engine.js';
import { useActs } from './hooks.js';
import { runStore } from './runStore.js';
import { groupChanges, subjectOf, FREE_HINT } from './acts.js';
import './lotse.css';
import './acts.css';

const KIND_ICON = { rank: 'ranking', set: 'edit', clear: 'x', move: 'calendar', assign: 'user', health: 'heart', reserve: 'headset', link: 'link', unlink: 'link', book: 'clock', notify: 'send', capacity: 'users', playbook: 'bookmark' };
const L2 = (pair) => (Array.isArray(pair) ? tr(pair[0], pair[1]) : pair);
export const useRun = (id) => {
  useSyncExternalStore(runStore.subscribe, runStore.get, runStore.get);
  return runStore.run(id) || {};
};
const nWord = (n, de1, deN, en1, enN) => tr(`${fmt.n(n)} ${n === 1 ? de1 : deN}`, `${fmt.n(n)} ${n === 1 ? en1 : enN}`);
// The step the person acts on next takes the focus (its main button / the recommended option): keys work at once and
// the card scrolls into view. Never steals a field the person is typing in (the composer excepted).
export function useTakeFocus(root, selector, on, key) {
  useEffect(() => {
    if (!on) return undefined;
    const t = setTimeout(() => {
      const el = [].concat(selector).map((s) => root.current?.querySelector(s)).find(Boolean);
      const ae = document.activeElement;
      const typing = /input|textarea/i.test(ae?.tagName || '') && !ae.closest?.('.lp-compose');
      if (el && !typing) { el.focus({ preventScroll: true }); root.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    }, 320);
    return () => clearTimeout(t);
  }, [on, key]); // eslint-disable-line react-hooks/exhaustive-deps
}
export const changesWord = (n) => nWord(n, 'Änderung', 'Änderungen', 'change', 'changes');

// ---------- the visual diff ----------
function Row({ c, i }) {
  const up = c.kind === 'rank' && Number(c.toValue) < Number(c.fromValue);
  const down = c.kind === 'rank' && Number(c.toValue) > Number(c.fromValue);
  const empty = c.fromValue == null || (Array.isArray(c.fromValue) && !c.fromValue.length);
  return (
    <motion.li className="lx-row" {...enter(i, { y: 0, x: -4 })}>
      <span className={`lx-subj ${c.key ? 'mono' : ''}`} title={c.label}>{subjectOf(c)}</span>
      <span className="lx-from" aria-label={tr(`vorher ${c.from}`, `before ${c.from}`)}>{empty ? '–' : c.from}</span>
      <span className={`lx-arrow ${up ? 'up' : down ? 'down' : ''}`} aria-hidden="true">→</span>
      <b className="lx-to" aria-label={tr(`nachher ${c.to}`, `after ${c.to}`)}>{c.to}</b>
    </motion.li>
  );
}
function Group({ g, gi }) {
  const [all, setAll] = useState(false);
  const rows = all ? g.rows : g.rows.slice(0, 6);
  return (
    <section className="lx-group" aria-label={`${g.field || tr('Änderungen', 'Changes')}: ${g.n}`}>
      <header><Icon name={KIND_ICON[g.kind] || 'edit'} size={12} /><span>{g.field || tr('Änderung', 'Change')}</span><span className="lx-n num">{fmt.n(g.n)}</span></header>
      <ul>{rows.map((c, i) => <Row key={`${c.id || c.ref || c.key}-${i}`} c={c} i={gi * 3 + i} />)}</ul>
      {g.rows.length > 6 && <button type="button" className="lx-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? tr('Weniger zeigen', 'Show less') : tr(`Alle ${g.rows.length} zeigen`, `Show all ${g.rows.length}`)}</button>}
    </section>
  );
}
// pv: one command's preview or a workflow's aggregated preview step ({ changes, count, more, totals?, warnings, blocked? })
export function ChangeDiff({ pv, blockedItems = [] }) {
  const groups = useMemo(() => groupChanges(pv?.changes || []), [pv]);
  const totals = pv?.totals || {};
  return (
    <div className="lx-diff">
      <div className="lx-totals" role="list" aria-label={tr('Summen', 'Totals')}>
        <span role="listitem" className="lx-total strong"><b className="num">{fmt.n(pv?.count || 0)}</b>{(pv?.count || 0) === 1 ? tr('Änderung', 'change') : tr('Änderungen', 'changes')}</span>
        {groups.length > 1 && groups.map((g) => <span role="listitem" key={`${g.kind}${g.field}`} className="lx-total"><b className="num">{fmt.n(g.n)}</b>{g.field || g.kind}</span>)}
        {Number.isFinite(totals.hours) && <span role="listitem" className="lx-total"><b className="num">{fmt.h(totals.hours, 1)}</b>{tr('zusammen', 'in total')}</span>}
      </div>
      {groups.map((g, gi) => <Group key={`${g.kind}|${g.field}`} g={g} gi={gi} />)}
      {pv?.more > 0 && <p className="lx-rest faint">{tr(`+ ${fmt.n(pv.more)} weitere Änderungen – alle gezählt, hier nicht einzeln gezeigt.`, `+ ${fmt.n(pv.more)} more changes – all counted, not listed one by one here.`)}</p>}
      {(pv?.warnings || []).length > 0 && (
        <ul className="lx-warn" aria-label={tr('Hinweise', 'Warnings')}>{pv.warnings.map((w, i) => <li key={i}><Icon name="alert" size={13} /><span>{w}</span></li>)}</ul>
      )}
      {(pv?.blocked || blockedItems.length > 0) && (
        <ul className="lx-blocked" aria-label={tr('Nicht möglich', 'Not possible')}>
          {pv?.blocked && <li><Icon name="lock" size={13} /><span>{pv.blocked}</span></li>}
          {blockedItems.map((b, i) => <li key={i}><Icon name="lock" size={13} /><span><b>{b.title}</b> – {b.reason}</span></li>)}
        </ul>
      )}
    </div>
  );
}

// ---------- one command: preview → apply → undo ----------
// item = { id, command, params, describe }. The preview is recomputed from the live data on every render – the button
// always applies exactly what is on screen (its token); a change in between is refused by the engine and re-shown.
export function CommandCard({ item, ctx }) {
  const run = useRun(item.id);
  const acts = useActs();
  const phase = run.phase || 'preview'; // preview | busy | applied | undone | cancelled
  const live = useMemo(() => {
    if (phase !== 'preview' && phase !== 'busy') return null;
    if (!ctx) return { error: tr('Die Daten laden noch.', 'The data is still loading.') };
    try { return previewCommand(item.command, item.params, ctx); } catch (e) { return { error: e?.code === 'INVALID' ? tr('Diese Änderung passt nicht zu den aktuellen Daten.', 'This change does not fit the current data.') : errText(e) }; }
  }, [ctx, item, phase]);
  // remember the token the person first saw – a different one later means the data changed and the preview was redone
  useEffect(() => { if (live?.token && !run.firstToken) runStore.set(item.id, { firstToken: live.token }); }, [live?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  const pv = phase === 'preview' || phase === 'busy' ? live : run.shown;
  const redone = phase === 'preview' && run.firstToken && live?.token && live.token !== run.firstToken;
  const write = !!pv?.write;
  const apply = async () => {
    if (!live || live.error || (write && (!live.token || live.blocked))) return;
    const shown = live;
    runStore.set(item.id, { phase: 'busy', notice: null });
    try {
      const done = await applyCommand(item.command, item.params, acts.io, { ctx, token: shown.token });
      acts.counted(item.command);
      const label = `${shown.title}: ${shown.summary || ''}`.slice(0, 90).replace(/[:\s]+$/, '');
      const entry = done.run ? acts.record(tr(`${label} (Lotse)`, `${label} (Lotse)`), done.run, done.keys, () => runStore.set(item.id, { phase: 'undone' })) : null;
      // in the preview's unit (change rows) when all went through; with failures, honestly the work items written
      const changed = done.failed ? done.applied : shown.count;
      runStore.set(item.id, { phase: 'applied', shown, entry, done: { applied: changed, failed: done.failed, errors: done.errors || [], irreversible: !!done.irreversible, write: shown.write } });
      if (!acts.follow(done) && shown.write) acts.say(tr(`Übernommen: ${changesWord(changed)}`, `Applied: ${changesWord(changed)}`), 'check', entry);
    } catch (e) {
      const stale = e?.code === 'STALE_PREVIEW';
      runStore.set(item.id, { phase: 'preview', notice: stale ? tr('Die Daten haben sich gerade geändert – Lotse hat die Vorschau neu berechnet. Bitte noch einmal prüfen.', 'The data just changed – Lotse recomputed the preview. Please check it again.') : errText(e) });
    }
  };
  const undo = async () => { if (run.entry && (await acts.undo(run.entry))) runStore.set(item.id, { phase: 'undone' }); };
  const n = pv?.count || 0;
  const busy = phase === 'busy';
  const tone = phase === 'applied' ? (run.done?.failed ? 'warn' : 'ok') : phase === 'undone' || phase === 'cancelled' ? 'info' : pv?.blocked || pv?.error ? 'bad' : 'act';
  const root = useRef(null);
  useTakeFocus(root, ['.lx-go:not(:disabled)'], phase === 'preview', item.id);
  return (
    <motion.article ref={root} className={`lx-card is-${tone}`} aria-label={`${pv?.title || tr('Aktion', 'Action')}: ${pv?.summary || ''}`} data-act="command" data-command={item.command} data-phase={phase}
      {...enter(0, { y: 12, scale: 0.985, spring: 'card' })}>
      <header className="lx-head">
        <span className="lx-kicker"><Icon name="zap" size={12} />{write ? tr('Änderung – mit Vorschau', 'Change – with preview') : tr('Aktion', 'Action')}</span>
        {redone && <span className="lx-badge info" role="status">{tr('Vorschau aktualisiert', 'Preview updated')}</span>}
        {phase === 'applied' && <span className="lx-badge ok"><Icon name="check" size={11} />{tr('Übernommen', 'Applied')}</span>}
        {phase === 'undone' && <span className="lx-badge"><Icon name="undo" size={11} />{tr('Rückgängig gemacht', 'Undone')}</span>}
        {phase === 'cancelled' && <span className="lx-badge">{tr('Abgebrochen', 'Cancelled')}</span>}
      </header>
      {item.q && <p className="ls-q">„{item.q}“</p>}
      <h3 className="lx-title">{pv?.title || item.describe}</h3>
      {pv?.error ? <p className="lx-blocked-line" role="alert"><Icon name="lock" size={13} />{pv.error}</p> : pv?.summary && <p className="lx-summary">{pv.summary}</p>}
      {pv && !pv.error && (n > 0 || pv.blocked || (pv.warnings || []).length > 0) && phase !== 'undone' && phase !== 'cancelled' && <ChangeDiff pv={pv} />}
      {run.notice && phase === 'preview' && <p className="lx-notice" role="status"><Icon name="refresh" size={13} />{run.notice}</p>}
      {(phase === 'preview' || busy) && pv && !pv.error && (
        <div className="lx-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => runStore.set(item.id, { phase: 'cancelled' })} disabled={busy}>{tr('Abbrechen', 'Cancel')}</button>
          <motion.button type="button" className="btn btn-primary btn-sm lx-go" onClick={apply} disabled={busy || (write && (!pv.token || !!pv.blocked))} {...press()} aria-busy={busy}>
            <Icon name={busy ? 'refresh' : write ? 'check' : item.command === 'report.compose' ? 'report' : 'arrowRight'} size={14} className={busy ? 'lx-spin' : ''} />
            {write ? tr(`Ausführen (${changesWord(n)})`, `Apply (${changesWord(n)})`) : item.command === 'report.compose' ? tr('Report-Baukasten öffnen', 'Open the report composer') : tr('Öffnen', 'Open')}
          </motion.button>
        </div>
      )}
      {phase === 'applied' && run.done?.write && <AppliedNote done={run.done} entry={run.entry} onUndo={undo} />}
    </motion.article>
  );
}
function errorsList(errors) {
  return errors.slice(0, 8).map((e, i) => <li key={i}><span className="mono">{e.key || '–'}</span><span>{e.code === 'NOT_FOUND' ? tr('nicht gefunden oder nicht sichtbar', 'not found or not visible') : e.code === 'FORBIDDEN' || e.code === 'NO_EDIT_PERMISSION' ? tr('Jira erlaubt diese Änderung nicht', 'Jira does not allow this change') : e.message || e.code}</span></li>);
}
export function AppliedNote({ done, entry, onUndo }) {
  return (
    <motion.div className="lx-done" role="status" {...enter(0, { y: 4 })}>
      <div className="lx-done-line">
        <span className="lx-done-ic" aria-hidden="true"><Icon name="check" size={14} /></span>
        <span className="grow">{tr(`${changesWord(done.applied)} übernommen`, `${changesWord(done.applied)} applied`)}{done.failed ? tr(` · ${done.failed} fehlgeschlagen`, ` · ${done.failed} failed`) : ''}</span>
        {entry && <button type="button" className="btn btn-sm" onClick={onUndo}><Icon name="undo" size={13} />{tr('Rückgängig', 'Undo')}</button>}
      </div>
      {done.irreversible && <p className="faint lx-small">{tr('Gesendete Erinnerungen lassen sich nicht zurückholen.', 'Sent reminders cannot be taken back.')}</p>}
      {(done.errors || []).length > 0 && <ul className="lx-errors" aria-label={tr('Nicht übernommen', 'Not applied')}>{errorsList(done.errors)}</ul>}
      {entry && <p className="faint lx-small">{tr('Auch über Strg/⌘ + Z oder den Verlauf oben rechts.', 'Also with Ctrl/⌘ + Z or the history at the top right.')}</p>}
    </motion.div>
  );
}

// ---------- a decision ----------
// step = { id, question, options: [{ id, label, detail?, recommended?, disabled?, facts?, order? }], multi?, freeText?,
//          project?, issue?, draft?, proposals? }. onAnswer(value) may throw (INVALID) – the card shows why.
// answered: the recorded answer → a compact line. active: keys 1–9 pick while no field has the focus.
function Option({ o, i, picked, multi, onPick, disabled }) {
  const tip = useTip();
  const order = (o.order || []).slice(0, 8);
  const card = infoCard({ title: o.label, text: o.detail || (o.recommended ? tr('Lotse empfiehlt diese Wahl.', 'Lotse recommends this choice.') : undefined),
    ...(order.length ? { itemsTitle: tr('Rangfolge', 'Ranking'), items: order.map((x, k) => ({ text: `${k + 1}. ${x.name}` })) } : {}),
    hint: o.disabled ? tr('Gerade nicht möglich', 'Not possible right now') : i < 9 ? tr(`Taste ${i + 1}`, `Key ${i + 1}`) : undefined });
  return (
    <motion.button type="button" role={multi ? 'checkbox' : undefined} aria-checked={multi ? picked : undefined} className={`lx-opt ${o.recommended ? 'rec' : ''} ${picked ? 'on' : ''}`} disabled={disabled || o.disabled} onClick={() => onPick(o.id)}
      {...(order.length || o.disabled ? tip(card) : {}) /* the card repeats label + detail: only where it adds a ranking or why it is not possible – otherwise it covers the table above (live finding) */}
      {...enter(i, { y: 6 })} {...press(0.98)}>
      {i < 9 && <kbd className="lx-key" aria-hidden="true">{i + 1}</kbd>}
      <span className="lx-opt-text">
        <span className="lx-opt-label">{o.label}{o.recommended && !o.disabled && <span className="lx-rec">{tr('Empfohlen', 'Recommended')}</span>}</span>
        {o.detail && <span className="lx-opt-detail">{o.detail}</span>}
      </span>
      {multi && <span className={`lx-check ${picked ? 'on' : ''}`} aria-hidden="true">{picked && <motion.span style={{ display: 'grid' }} {...popMark()}><Icon name="check" size={12} /></motion.span>}</span>}
    </motion.button>
  );
}
export function answerText(step, a) {
  if (a == null) return '';
  const label = (id) => step.options?.find((o) => o.id === id)?.label || id;
  if (Array.isArray(a)) return a.map(label).join(', ');
  if (typeof a === 'string') return label(a);
  return [a.option != null ? label(a.option) : null, a.text ? `„${a.text}“` : null].filter(Boolean).join(' · ');
}
export function DecisionCard({ step, onAnswer, answered, active = true, busy = false, compactLabel }) {
  const opts = step.options || [];
  const [sel, setSel] = useState(() => (step.multi ? opts.filter((o) => o.recommended && !o.disabled).map((o) => o.id) : []));
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  const root = useRef(null);
  const ft = step.freeText || null;
  const send = (value) => {
    setErr(null);
    try { onAnswer(value); }
    catch (e) { setErr(e?.field === 'text' || e?.code === 'INVALID' ? L2(FREE_HINT[ft?.kind] || FREE_HINT.text) : errText(e)); }
  };
  const pick = (id) => {
    if (busy) return;
    if (step.multi) { setSel((s) => (id === 'nothing' ? ['nothing'] : s.includes(id) ? s.filter((x) => x !== id) : [...s.filter((x) => x !== 'nothing'), id])); return; }
    send(ft && text.trim() ? { option: id, text: text.trim() } : id);
  };
  // keys 1–9 pick an option, Enter confirms a multiple choice – only while no field has the focus
  useEffect(() => {
    if (!active || answered !== undefined) return undefined;
    const h = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test(document.activeElement?.tagName || '')) return;
      const panel = document.querySelector('[data-lotse-panel]');
      if (!panel?.contains(root.current)) return;
      // several jobs can wait at once: the keys belong to ONE decision – the one holding the focus, else the newest
      // (live finding: one key press answered the decisions of two jobs)
      const focused = document.activeElement?.closest?.('[data-act="decide"]');
      const owner = focused && panel.contains(focused) ? focused : [...panel.querySelectorAll('[data-act="decide"]')].pop();
      if (owner !== root.current) return;
      const k = Number(e.key);
      if (k >= 1 && k <= 9 && opts[k - 1] && !opts[k - 1].disabled) { e.preventDefault(); pick(opts[k - 1].id); }
      // multiple choice: Space toggles the focused option, Enter confirms the selection
      else if (e.key === 'Enter' && step.multi && sel.length && (document.activeElement === document.body || root.current?.contains(document.activeElement)) && !document.activeElement?.classList?.contains('btn')) { e.preventDefault(); send(sel); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }); // re-bound every render: sees the current selection and text
  // a new decision takes the focus (the recommended option)
  useTakeFocus(root, ['.lx-opt.rec:not(:disabled)', '.lx-opt:not(:disabled)'], active && answered === undefined, step.id);
  if (answered !== undefined) {
    return (
      <motion.div className="lx-answered" role="group" aria-label={step.question} {...enter(0, { y: 0, d: 'quick' })}>
        <span className="lx-answered-q">{compactLabel || step.question}</span>
        <span className="lx-answered-a"><Icon name="check" size={12} />{answerText(step, answered)}</span>
      </motion.div>
    );
  }
  const hint = ft ? L2(FREE_HINT[ft.kind] || FREE_HINT.text) : null;
  const errId = `lx-err-${String(step.id).replace(/[^a-z0-9]/gi, '')}`;
  return (
    <motion.section ref={root} className="lx-card lx-decide is-act" aria-label={step.question} data-act="decide" data-step={step.id}
      {...enter(0, { y: 12, scale: 0.985, spring: 'card' })}>
      <span className="lx-kicker"><Icon name="target" size={12} />{tr('Deine Entscheidung', 'Your decision')}</span>
      <h3 className="lx-title">{step.question}</h3>
      {step.issue && <p className="lx-context"><span className="mono">{step.issue.key}</span> {step.issue.summary}</p>}
      {step.draft?.steps ? (
        <div className="lx-pb">
          <b className="lx-pb-t"><Icon name="bookmark" size={12} />{step.draft.title}</b>
          {(step.draft.symptoms || []).length > 0 && <p className="faint">{step.draft.symptoms.join(' · ')}</p>}
          <ol>{step.draft.steps.slice(0, 6).map((x, i) => <li key={i}>{x}</li>)}</ol>
          {step.draft.reply && <blockquote className="lx-draft"><Icon name="send" size={12} /><span>{tr('Standardantwort an Kund:innen:', 'Standard reply to customers:')} „{step.draft.reply}“</span></blockquote>}
        </div>
      ) : step.draft?.comment && <blockquote className="lx-draft"><Icon name="edit" size={12} /><span>{tr('Entwurf aus den Zahlen:', 'Draft from the numbers:')} „{step.draft.comment}“</span></blockquote>}
      {(step.proposals || []).length > 0 && (
        <table className="lx-props"><caption className="sr">{tr('Vorschläge', 'Proposals')}</caption>
          <thead><tr><th scope="col">{tr('Vorgang', 'Work item')}</th>{step.proposals.some((p) => p.date) && <th scope="col">{tr('Tag', 'Day')}</th>}<th scope="col" className="num">{tr('Stunden', 'Hours')}</th></tr></thead>
          <tbody>{step.proposals.slice(0, 6).map((p, i) => <tr key={i}><td className="mono">{p.key}</td>{step.proposals.some((x) => x.date) && <td>{fmt.date(p.date)}</td>}<td className="num">{fmt.h(p.hours, 2)}</td></tr>)}</tbody>
        </table>
      )}
      {(step.stories || []).length > 0 && (
        <table className="lx-props"><caption className="sr">{tr('Betroffene Stories', 'Stories affected')}</caption>
          <thead><tr><th scope="col">{tr('Story', 'Story')}</th><th scope="col">{tr('Neues Ende', 'New end')}</th><th scope="col">{tr('Termin', 'Due')}</th><th scope="col" className="num">{tr('Später', 'Late')}</th></tr></thead>
          <tbody>{step.stories.slice(0, 8).map((p, i) => <tr key={i}><td><span className="mono">{p.key}</span> <span className="faint">{p.summary}</span></td><td>{fmt.date(p.due)}</td><td>{fmt.date(p.limit)}</td><td className="num">{tr(`${p.days} AT`, `${p.days} wd`)}</td></tr>)}</tbody>
        </table>
      )}
      <div className={`lx-opts ${opts.length > 3 ? 'many' : ''}`} role="group" aria-label={tr('Möglichkeiten', 'Options')}>
        {opts.map((o, i) => <Option key={o.id} o={o} i={i} multi={step.multi} picked={sel.includes(o.id)} onPick={pick} disabled={busy} />)}
      </div>
      {ft && (
        <form className="lx-free" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send({ text: text.trim(), ...(step.multi ? {} : {}) }); }}>
          <label className="lx-free-label" htmlFor={`${errId}-in`}>{ft.kind === 'text' ? tr('Eigener Satz (optional)', 'Your own sentence (optional)') : tr('Oder ein eigener Wert', 'Or your own value')}</label>
          <div className="lx-free-row">
            <input id={`${errId}-in`} value={text} onChange={(e) => { setText(e.target.value); setErr(null); }} placeholder={ft.placeholder || ''} maxLength={ft.max || 280}
              aria-invalid={!!err} aria-describedby={err ? errId : `${errId}-hint`} />
            <button type="submit" className="btn btn-sm" disabled={!text.trim() || busy}>{tr('Übernehmen', 'Use')}</button>
          </div>
          {err ? <p id={errId} className="lx-err" role="alert">{err}</p> : <p id={`${errId}-hint`} className="faint lx-small">{hint}{ft.kind === 'text' && !step.multi ? tr(' Danach eine Möglichkeit oben wählen – oder hier übernehmen.', ' Then pick an option above – or use it here.') : ''}</p>}
        </form>
      )}
      {step.multi && (
        <div className="lx-actions">
          <span className="faint lx-small grow">{tr('Mehrere möglich · Tasten 1–9, Enter', 'Several possible · keys 1–9, Enter')}</span>
          <motion.button type="button" className="btn btn-primary btn-sm" disabled={!sel.length || busy} onClick={() => send(sel)} {...press()}>
            <Icon name="arrowRight" size={14} />{tr(`Weiter (${sel.length})`, `Continue (${sel.length})`)}
          </motion.button>
        </div>
      )}
      {!step.multi && !ft && err && <p className="lx-err" role="alert">{err}</p>}
    </motion.section>
  );
}
