// Wochenplanung › "Optimieren": an inline panel above the board with three calm helpers (shared/optimize.js):
//   Schneller fertig (finish sooner) · Überlast glätten (smooth overload) · Umverteilen (rebalance).
// Accepting records the board's normal pending moves (dashed cards, "Apply in Jira", per-row undo, "Discard all") –
// the optimizer itself never writes to Jira. Panel state (open, mode, target, deselected rows) lives in a small
// module store (optStore), so it survives a team switch. Motion: transform/opacity only, enter animations only
// (exit animations stall inside the Jira frame).
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { enter, tween } from '../lib/motion.js';
import { optimizeAll, optStore, OPT_MODES } from '@shared/optimize.js';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { Counter, Segmented, infoCard } from './ui.jsx';
import AiAssist from './AiAssist.jsx';
import { planningPayload } from '@shared/aiPayload.js';
import { planningSelection } from '../lib/aiApply.js';

const dm = (iso) => (iso ? fmt.date(iso, { day: '2-digit', month: '2-digit' }) : '–');
const weeksWord = (n) => (n === 1 ? tr('Woche', 'week') : tr('Wochen', 'weeks'));
const h1 = (v) => fmt.h(v, v > 0 && v < 9.95 ? 1 : 0);
const pct = (u) => (Number.isFinite(u) ? fmt.pct(u) : '∞');
const wkList = (isos) => (isos.length > 3 ? `${isos.slice(0, 3).map(fmt.week).join(', ')} …` : isos.map(fmt.week).join(', '));
const first = (name) => String(name || '').split(' ')[0] || '–';

export const MODE = {
  sooner: { icon: 'zap', label: () => tr('Schneller fertig', 'Finish sooner') },
  smooth: { icon: 'waves', label: () => tr('Überlast glätten', 'Smooth overload') },
  rebalance: { icon: 'users', label: () => tr('Umverteilen', 'Rebalance') },
};
export const useOptState = () => useSyncExternalStore(optStore.subscribe, optStore.get, optStore.get);

// What a card menu offers for a suggestion of any mode.
export function menuLabel(s) {
  if (s.mode === 'smooth') {
    return s.kind === 'stretch'
      ? tr(`Überlast glätten: auf ${s.toWeeks} Wochen strecken (Due ${dm(s.newDue)})`, `Smooth overload: stretch over ${s.toWeeks} weeks (due ${dm(s.newDue)})`)
      : tr(`Überlast glätten: ${s.shiftWeeks} ${s.shiftWeeks === 1 ? 'Woche' : 'Wochen'} später (Due ${dm(s.newDue)})`, `Smooth overload: ${s.shiftWeeks} ${s.shiftWeeks === 1 ? 'week' : 'weeks'} later (due ${dm(s.newDue)})`);
  }
  if (s.mode === 'rebalance') return tr(`An ${first(s.toPersonName)} geben (${first(s.toPersonName)} hat Luft)`, `Give to ${first(s.toPersonName)} (${first(s.toPersonName)} has room)`);
  const chained = (s.also || []).map((a) => tr(` · ${a.key} startet ${dm(a.start)}`, ` · ${a.key} starts ${dm(a.start)}`)).join('');
  const stays = (s.keeps || []).length ? tr(` · Konflikt mit ${s.keeps.join(', ')} bleibt`, ` · conflict with ${s.keeps.join(', ')} stays`) : '';
  return tr(`Schneller fertig: Due auf ${dm(s.newDue)} (${s.toWeeks} statt ${s.fromWeeks} Wochen)`, `Finish sooner: due ${dm(s.newDue)} (${s.toWeeks} instead of ${s.fromWeeks} weeks)`) + chained + stays;
}

// The board's toolbar (note on the left, "Optimieren" on the right) and the panel below it. show: whether the board
// has anything to optimise. Opening re-renders only this bar, not the board.
// extra: more toolbar controls next to the button (the distribution switch).
export function OptimizerBar({ note, show, extra = null, ...panel }) {
  const { open } = useOptState();
  if (!note && !show) return null;
  return (
    <>
      <div className="wb-tools">
        {note || <span />}
        {show && <div className="wb-tools-right">{extra}<OptimizeButton open={open} onClick={() => optStore.set({ open: !open, openedAt: Date.now() })} /></div>}
      </div>
      {open && show && <PlanOptimizer {...panel} />}
    </>
  );
}

export function OptimizeButton({ open, onClick }) {
  return (
    <button type="button" className={`btn btn-sm wb-opt-btn ${open ? 'on' : ''}`} aria-expanded={open} aria-controls="wb-opt-panel" onClick={onClick}>
      <span className="wb-opt-glyph" aria-hidden="true"><Icon name="sparkle" size={14} /></span>
      {tr('Optimieren', 'Optimize')}
    </button>
  );
}

// Before (faint) and after (solid) per week on one scale; for a person's load with a tick at the target.
function Spark({ s, tip }) {
  const load = s.unit === 'load';
  const n = s.before.length;
  if (!n) return <span />;
  const max = Math.max(1, ...s.before, ...s.after, ...(load ? s.cap : []));
  const bw = 7, gap = 3, H = 26;
  const W = n * bw + (n - 1) * gap;
  const y = (v) => H - (v / max) * (H - 2);
  const items = s.weeks.map((w, i) => ({
    text: `${fmt.week(w)} · ${h1(s.before[i])} → ${h1(s.after[i])}${load ? ` ${tr('von', 'of')} ${h1(s.cap[i])}` : ''}`,
    sub: load ? null : tr(`frei für diese Aufgabe ${fmt.h(Math.max(0, s.free?.[i] || 0), 1)}`, `free for this task ${fmt.h(Math.max(0, s.free?.[i] || 0), 1)}`),
    tone: load ? (s.after[i] > s.cap[i] + 0.05 ? 'bad' : s.before[i] > s.cap[i] + 0.05 ? 'ok' : undefined) : s.after[i] > 0.05 ? 'ok' : undefined,
  }));
  const who = s.mode === 'rebalance' ? first(s.personName) : s.personName;
  const card = infoCard({
    title: `${s.key} · ${tr('vorher und nachher', 'before and after')}`,
    sub: load ? tr(`Auslastung von ${who} je Woche`, `${who}'s load per week`) : tr('Stunden dieser Aufgabe je Woche', 'Hours of this task per week'),
    text: tr(s.reason.de, s.reason.en),
    calc: s.mode === 'sooner' ? `${fmt.n(s.oe, 1)} h ÷ ${s.toWeeks} ${weeksWord(s.toWeeks)} = ${fmt.n(s.oe / s.toWeeks, 1)} h/${tr('Woche', 'week')}` : null,
    items, itemsTitle: tr('Je Woche', 'Per week'),
    hint: load ? tr('Hell: heute · kräftig: mit Vorschlag · Strich: Ziel-Auslastung', 'Light: today · solid: with the suggestion · tick: target') : tr('Hell: heute · kräftig: mit Vorschlag · gleiche Skala', 'Light: today · solid: with the suggestion · same scale'),
  });
  return (
    <span className="wb-opt-spark" tabIndex={0} role="img" aria-label={tr(s.reason.de, s.reason.en)} {...tip(card)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        {s.before.map((v, i) => {
          const x = i * (bw + gap);
          const a = s.after[i];
          const over = load && a > s.cap[i] + 0.05;
          return (
            <g key={i}>
              <rect className="b" x={x} y={Math.min(H - 1.5, y(v))} width={bw} height={Math.max(1.5, H - y(v))} rx={2} />
              {a > 0.05 && <rect className={`a ${load ? (over ? 'over' : 'fine') : ''}`} x={x + 1} y={y(a)} width={bw - 2} height={H - y(a)} rx={1.5} style={{ animationDelay: `${120 + i * 40}ms` }} />}
              {load && <rect className="cap" x={x - 1} y={y(s.cap[i]) - 0.75} width={bw + 2} height={1.5} rx={0.75} />}
            </g>
          );
        })}
      </svg>
    </span>
  );
}

function Row({ s, i, on, canEdit, tip, color }) {
  const what = (
    <span className="wb-opt-what">
      <span className="wb-opt-line"><span className="wb-key">{s.key}</span><span className="wb-opt-sum">{s.summary}</span></span>
      <span className="wb-opt-meta"><i style={{ background: color(s.ref) }} />{s.project || '–'}{s.mode === 'rebalance' ? '' : ` · ${s.personName}`}</span>
      {s.fixed?.length > 0 && <span className="wb-opt-ok"><Icon name="check" size={11} />{tr(`${wkList(s.fixed)} wieder ok`, `${wkList(s.fixed)} fine again`)}</span>}
    </span>
  );
  let mid, dates;
  if (s.mode === 'rebalance') {
    mid = <span className="wb-opt-who">{tr('von', 'from')} <b>{first(s.personName)}</b><Icon name="arrowRight" size={12} />{tr('an', 'to')} <b className="to">{first(s.toPersonName)}</b></span>;
    dates = (
      <span className="wb-opt-loads">
        <span>{first(s.personName)} {pct(s.fromLoad[0])} <Icon name="arrowRight" size={10} /> <b className="fine">{pct(s.fromLoad[1])}</b></span>
        <span>{first(s.toPersonName)} {pct(s.toLoad[0])} <Icon name="arrowRight" size={10} /> <b>{pct(s.toLoad[1])}</b></span>
      </span>
    );
  } else {
    mid = s.mode === 'smooth' && s.kind === 'shift'
      ? <span className="wb-opt-weeks">{tr(`${s.shiftWeeks} ${s.shiftWeeks === 1 ? 'Woche' : 'Wochen'} später`, `${s.shiftWeeks} ${s.shiftWeeks === 1 ? 'week' : 'weeks'} later`)}</span>
      : s.mode === 'sooner' && s.toWeeks >= s.fromWeeks
        ? <span className="wb-opt-weeks"><b className="to">{s.weeksSaved}</b> {s.weeksSaved === 1 ? tr('Woche früher', 'week sooner') : tr('Wochen früher', 'weeks sooner')}</span>
        : <span className="wb-opt-weeks"><b>{s.fromWeeks}</b><Icon name="arrowRight" size={12} /><b className="to">{s.toWeeks}</b> {weeksWord(s.toWeeks)}</span>;
    dates = (
      <span className="wb-opt-dates">
        {s.newStart !== s.start && <span className="wb-opt-due">Start {dm(s.start)} <Icon name="arrowRight" size={11} /> <b>{dm(s.newStart)}</b></span>}
        <span className="wb-opt-due">Due {dm(s.due)} <Icon name="arrowRight" size={11} /> <b>{dm(s.newDue)}</b></span>
      </span>
    );
  }
  const body = (
    <>
      {canEdit && <input type="checkbox" className="pick" checked={on} onChange={() => optStore.toggleRow(s.id)} aria-label={tr(`${s.key} vormerken`, `Include ${s.key}`)} />}
      {what}{mid}{dates}<Spark s={s} tip={tip} />
    </>
  );
  return (
    <motion.li className={on ? '' : 'off'} {...enter(i, { y: 6, delay: 0.04 })}>
      {canEdit ? <label className="wb-opt-row">{body}</label> : <div className="wb-opt-row ro">{body}</div>}
    </motion.li>
  );
}

// ds, computed, team, project, moves: what the board shows.
export default function PlanOptimizer({ ds, computed, team, project, moves, distribution = 'even', canEdit, onApply, tip, color, logTasks = 0 }) {
  const st = useOptState();
  const [moreNotes, setMoreNotes] = useState(false);
  const { mode, target, off } = st;
  const animate = useRef(Date.now() - (st.openedAt || 0) < 1200).current; // animate when opened, not on a team switch
  const all = useMemo(() => optimizeAll({ ds, computed, team, project, moves, target, distribution }), [ds, computed, team, project, moves, target, distribution]);
  const alt = useMemo(() => (target < 1 ? optimizeAll({ ds, computed, team, project, moves, target: 1, distribution }) : null), [ds, computed, team, project, moves, target, distribution]);
  const cur = all[mode] || all.sooner;
  const list = cur.suggestions;
  const n = list.length;
  const chosen = OPT_MODES.flatMap((m) => all[m].suggestions).filter((s) => !off[s.id]);
  const p = Math.round(target * 100);
  const big = mode === 'sooner' ? cur.summary.weeksSaved || 0 : cur.summary.weeksFixed || 0;
  const people = cur.summary.people || 0;
  const head = {
    sooner: n ? [tr(`${n} ${n === 1 ? 'Aufgabe kann' : 'Aufgaben können'} früher fertig sein`, `${n} ${n === 1 ? 'task can' : 'tasks can'} finish sooner`), tr(`zusammen ${big} ${weeksWord(big)} schneller`, `${big} ${weeksWord(big)} faster together`)]
      : [tr('Der Plan ist schon dicht', 'The plan is already tight'), null],
    smooth: n ? [tr(`${big} überlastete ${big === 1 ? 'Woche wird' : 'Wochen werden'} wieder ok`, `${big} overloaded ${big === 1 ? 'week becomes' : 'weeks become'} fine again`), tr(`${n} ${n === 1 ? 'Aufgabe' : 'Aufgaben'} später oder gestreckt`, `${n} ${n === 1 ? 'task' : 'tasks'} later or stretched`)]
      : [all.overloaded ? tr('Überlast lässt sich so nicht glätten', 'Overload cannot be smoothed this way') : tr('Keine Überlast', 'No overload'), null],
    rebalance: n ? [tr(`${n} ${n === 1 ? 'Aufgabe kann' : 'Aufgaben können'} an Kolleg:innen mit Luft gehen`, `${n} ${n === 1 ? 'task can' : 'tasks can'} go to colleagues with room`), tr(`${big} ${weeksWord(big)} wieder ok`, `${big} ${weeksWord(big)} fine again`)]
      : [all.overloaded ? tr('Niemand im Team hat genug Luft', 'Nobody in the team has enough room') : tr('Keine Überlast', 'No overload'), null],
  }[mode];
  const sub = n ? {
    sooner: all.distribution === 'capacity'
      ? tr(`Nach freier Kapazität verteilt sind diese Aufgaben vor ihrem Due fertig – das Due date rückt auf die Woche, in der die Stunden aufgebraucht sind. ${people} ${people === 1 ? 'Person' : 'Personen'} · Auslastung bis ${p} %.`, `Spread by free capacity these tasks are done before their due date – the due date moves to the week the hours run out. ${people} ${people === 1 ? 'person' : 'people'} · utilization up to ${p}%.`)
      : tr(`Die Personen haben in den Wochen ihrer Aufgaben noch Luft – Start bleibt oder rückt vor. ${people} ${people === 1 ? 'Person' : 'Personen'} · Auslastung bleibt bis ${p} %.`, `Their people still have room in those weeks – the start stays or moves up. ${people} ${people === 1 ? 'person' : 'people'} · utilization stays up to ${p}%.`),
    smooth: tr(`Aufgaben mit niedrigem Rang zuerst – nie über Projekt-Due oder Meilenstein, nie in einen Konflikt. Auslastung bis ${p} %.`, `Lowest rank first – never past the project due date or milestone, never into a conflict. Utilization up to ${p}%.`),
    rebalance: tr(`Nur an sichtbare Personen im selben Team, die in allen Wochen der Aufgabe Luft haben. Auslastung bis ${p} %.`, `Only to visible people in the same team with room in every week of the task. Utilization up to ${p}%.`),
  }[mode] : {
    sooner: !all.considered ? tr('Keine offenen Aufgaben mit Assignee, Start und Due in diesen Wochen.', 'No open tasks with an assignee, start and due date in these weeks.')
      : tr('Alle Personen sind in den Wochen ihrer Aufgaben schon voll ausgelastet – nichts zu beschleunigen.', 'Everyone is already fully loaded in the weeks of their tasks – nothing to speed up.'),
    smooth: all.overloaded ? tr('Die Überlast bleibt – Gründe unten. „Umverteilen“ kann helfen.', 'The overload stays – reasons below. "Rebalance" may help.')
      : tr(`Niemand ist über ${p} % – nichts zu glätten.`, `Nobody is over ${p}% – nothing to smooth.`),
    rebalance: all.overloaded ? tr('Für die Überlast gibt es im selben Team niemanden mit Luft in allen Wochen der Aufgabe.', 'For the overload nobody in the same team has room in every week of the task.')
      : tr(`Niemand ist über ${p} % – nichts umzuverteilen.`, `Nobody is over ${p}% – nothing to rebalance.`),
  }[mode];
  const altCount = alt && !n ? alt[mode].count : 0;
  const pend = all.skipped?.pending || 0;

  return (
    <motion.section id="wb-opt-panel" className="wb-opt" aria-label={tr('Plan optimieren', 'Optimize plan')}
      initial={animate ? { opacity: 0, y: -10, scale: 0.985 } : false} animate={{ opacity: 1, y: 0, scale: 1 }} transition={tween('gentle')}>
      <div className="wb-opt-top">
        <Segmented size="sm" value={mode} onChange={(m) => optStore.set({ mode: m })} label={tr('Art der Vorschläge', 'Kind of suggestions')}
          options={OPT_MODES.map((m) => ({ value: m, icon: MODE[m].icon, label: <>{MODE[m].label()}<span className={`wb-opt-badge ${all[m].count ? '' : 'zero'}`}>{all[m].count}</span></> }))} />
        <div className="wb-opt-ctl">
          <span className="faint" aria-hidden="true">{tr('Auslastung bis', 'Utilization up to')}</span>
          <Segmented size="sm" value={target} onChange={(v) => optStore.set({ target: v })} label={tr('Auslastung bis', 'Utilization up to')}
            options={[{ value: 0.85, label: '85 %' }, { value: 1, label: '100 %' }]} />
          <button type="button" className="btn btn-xs btn-ghost btn-icon wb-opt-x" aria-label={tr('Schließen', 'Close')} onClick={() => optStore.set({ open: false })}><Icon name="x" size={14} /></button>
        </div>
      </div>

      <motion.div key={mode} className="wb-opt-head" {...enter(0, { y: 4 })}>
        <div className={`wb-opt-figure ${n ? '' : 'calm'}`} aria-hidden="true">
          {n ? <><span className="wb-opt-big"><Counter value={big} /></span><span className="wb-opt-unit">{mode === 'sooner' ? tr(big === 1 ? 'Woche früher' : 'Wochen früher', big === 1 ? 'week sooner' : 'weeks sooner') : tr(big === 1 ? 'Woche wieder ok' : 'Wochen wieder ok', big === 1 ? 'week fine again' : 'weeks fine again')}</span></>
            : <Icon name={mode !== 'sooner' && all.overloaded ? 'info' : 'check'} size={22} />}
        </div>
        <div className="wb-opt-title">
          <h3 aria-live="polite">{head[0]}{head[1] ? <span className="wb-opt-dash"> – {head[1]}</span> : null}</h3>
          <p>{sub}</p>
        </div>
      </motion.div>

      {/* KI-Assistent: explains the situation and picks the best combination among these suggestions (never new dates) */}
      <AiAssist feature="planning" className="wb-opt-ai" label={tr('Beste Kombination vorschlagen', 'Suggest the best combination')} title={tr('Wochenplanung', 'Weekly planning')}
        build={() => planningPayload(all, { target, distribution: all.distribution || distribution, logTasks, pending: Object.keys(moves || {}).length })}
        render={(r, nm) => <AiPicks r={r} all={all} nm={nm} />}
        onApply={canEdit ? async (r) => onApply(planningSelection(r, all), { ai: r.source !== 'lotse' }) : undefined}
        canApply={(r) => planningSelection(r, all).length > 0} applyLabel={tr('Vorschläge übernehmen', 'Take suggestions')} />

      {n > 0 && (
        <ul key={`${mode}:${p}`} className="wb-opt-list" aria-label={tr('Vorschläge', 'Suggestions')}>
          {list.map((s, i) => <Row key={s.id} s={s} i={i} on={!off[s.id]} canEdit={canEdit} tip={tip} color={color} />)}
        </ul>
      )}
      {cur.notes.length > 0 && (
        <ul className="wb-opt-notes" aria-label={tr('Hinweise', 'Notes')}>
          {(moreNotes ? cur.notes : cur.notes.slice(0, 2)).map((x) => <li key={x.id}><Icon name="info" size={13} /><span>{tr(x.reason.de, x.reason.en)}</span></li>)}
          {cur.notes.length > 2 && (
            <li className="more"><button type="button" className="wb-more" aria-expanded={moreNotes} onClick={() => setMoreNotes((v) => !v)}>
              {moreNotes ? tr('Weniger Hinweise', 'Fewer notes') : (cur.notes.length - 2 === 1 ? tr('+ 1 weiterer Hinweis', '+ 1 more note') : tr(`+ ${cur.notes.length - 2} weitere Hinweise`, `+ ${cur.notes.length - 2} more notes`))}
            </button></li>
          )}
        </ul>
      )}
      {!n && altCount > 0 && (
        <div className="wb-opt-empty">
          <button type="button" className="btn btn-xs" onClick={() => optStore.set({ target: 1 })}>
            {tr(`Mit 100 % ${altCount === 1 ? 'gäbe es 1 Vorschlag' : `gäbe es ${altCount} Vorschläge`} – ansehen`, `At 100% there ${altCount === 1 ? 'is 1 suggestion' : `are ${altCount} suggestions`} – show`)}
          </button>
        </div>
      )}

      <div className="wb-opt-foot">
        <span className="faint">
          {canEdit
            ? tr('Vorgemerkt wird nichts in Jira geschrieben – erst mit „In Jira übernehmen“.', 'Nothing is written to Jira until "Apply in Jira".')
            : <><Icon name="lock" size={12} /> {tr('Nur ansehen: Vorschläge vormerken darf, wer die Berechtigung „Wochenplanung bearbeiten“ hat.', 'View only: adding suggestions needs the "Edit weekly planning" permission.')}</>}
          {pend > 0 ? tr(` ${pend} ${pend === 1 ? 'Aufgabe mit vorgemerkter Änderung bleibt' : 'Aufgaben mit vorgemerkten Änderungen bleiben'} unberührt.`, ` ${pend} ${pend === 1 ? 'task with a pending change is' : 'tasks with pending changes are'} left alone.`) : ''}
        </span>
        <div className="wb-opt-actions">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => optStore.set({ open: false })}>{tr('Schließen', 'Close')}</button>
          {canEdit && (
            <button type="button" className="btn btn-sm btn-primary" disabled={!chosen.length} onClick={() => { optStore.set({ open: false, off: {} }); onApply(chosen); }}>
              <Icon name="sparkle" size={14} />{tr(`Ausgewählte Vorschläge vormerken (${chosen.length})`, `Add selected suggestions (${chosen.length})`)}
            </button>
          )}
        </div>
      </div>
    </motion.section>
  );
}

// The AI's picks, shown with the optimizer's own wording and the AI's reason per pick.
function AiPicks({ r, all, nm }) {
  const chosen = planningSelection(r, all);
  const why = new Map((r.picks || []).map((p) => [p.id, p.why]));
  if (!chosen.length) return <div className="faint" style={{ fontSize: 12.5 }}>{tr('Keine Änderung empfohlen – der Plan bleibt, wie er ist.', 'No change recommended – the plan stays as it is.')}</div>;
  return (
    <ul className="ai-list" aria-label={tr('Vorgeschlagene Kombination', 'Suggested combination')}>
      {chosen.map((s, i) => (
        <motion.li key={s.id} className="ai-item" {...enter(i, { y: 4, delay: 0.04 })}>
          <span className="wb-key">{s.key}</span><b>{menuLabel(s)}</b>
          {why.get(s.id) && <span className="ai-item-why">{nm.text(why.get(s.id))}</span>}
        </motion.li>
      ))}
    </ul>
  );
}
