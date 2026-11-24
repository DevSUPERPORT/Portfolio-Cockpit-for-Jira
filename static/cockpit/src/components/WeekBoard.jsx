// Wochenplanung (UC-05): the weekly planning board. Per person (or project, or team) and week: support share and
// tasks as cards, load against availability on top. Cards move by drag and drop (pointer events – mouse, pen,
// touch via long press) or from a small menu (click / Enter on a card). Moves are collected and only written with
// "Apply in Jira"; they are shared by every board on screen (Wochenplanung, Teams, Projects) through pendingStore.
//
// Embedding: <WeekBoard team="t1" />                       – one team, rows = people (mode 'projects': projects)
//            <WeekBoard project="issue:10001" />            – one project, rows = the people working on it
//            <WeekBoard />                                   – all teams, one row per team (read-only, onOpenTeam)
// Drag only with canEdit (see canPlan in shared/weekPlan.js); otherwise read-only with a hint.
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { enter, MS, EASE, cssEase, isReduced } from '../lib/motion.js';
import { suggestShifts } from '@shared/planSuggest.js';
import { buildBoard, taskParts, distributionOf, undoMoveOf, planDrop, moveTask, undoMove, rebaseMove, planPayload, pendingRows, conflicts as planConflicts, PLAN_WEEKS, datesInverted, shiftDates, pastProjectDue } from '@shared/weekPlan.js';
import { utilTone, noCapacityReason, NO_CAP_TEXT } from '@shared/kpis.js';
import { optimizeAll, optStore, suggestionMoves, suggestionsFor } from '@shared/optimize.js';
import { useApp, errText } from '../state.jsx';
import { tr, fmt, getLang } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call, openIssue } from '../lib/api.js';
import { Avatar, Empty, useTip, infoCard, Segmented } from './ui.jsx';
import { useProgressive } from '../lib/virtual.jsx';
import { OptimizerBar, menuLabel, MODE } from './PlanOptimizer.jsx';
import { FitBar, FitWords, fitOf, fitSentence } from './LoadFit.jsx';
import { distStore, useDistribution } from '../lib/distribution.js';
import { WhyCard, PlanLog, logStore, useLogState, reasonLine } from './PlanWhy.jsx';
import { OverWhy, WhyOverButton } from './OverWhy.jsx';
import './weekBoard.css';

// ---------- pending moves, shared by every board ----------
let snap = { moves: {}, errors: {} };
const subs = new Set();
export const pendingStore = {
  get: () => snap,
  set(next) { snap = typeof next === 'function' ? next(snap) : next; subs.forEach((f) => f()); },
  subscribe(f) { subs.add(f); return () => subs.delete(f); },
};
// fn: moves -> moves. A changed or removed move loses its last error.
const setMoves = (fn, touched = []) => pendingStore.set((s) => {
  const moves = fn(s.moves);
  const errors = { ...s.errors };
  for (const k of Object.keys(errors)) if (!moves[k] || touched.includes(k)) delete errors[k];
  return { moves, errors };
});
// One task's pending move back to an earlier state – the undo of one board action.
const restoreMove = (id, prev) => setMoves((mv) => { const out = { ...mv }; if (prev) out[id] = prev; else delete out[id]; return out; }, [id]);

const NO_SUG = [];
export function usePendingMoves() {
  const s = useSyncExternalStore(pendingStore.subscribe, pendingStore.get, pendingStore.get);
  return { moves: s.moves, errors: s.errors, count: Object.keys(s.moves).length, discardAll: () => pendingStore.set({ moves: {}, errors: {} }) };
}

// ---------- distribution: even or by free capacity (shared/weekPlan.js capacityFill) ----------
// The viewer's choice is remembered on this device; without one the admin default (rules.distribution) applies.
// Only the board view follows it – the weekly plan snapshot (Plan vs. actual) uses the admin default.
// the store lives in lib/distribution.js (also read by My work); re-exported for ProjectYear
export { useDistribution } from '../lib/distribution.js';
const distName = (v) => (v === 'capacity' ? tr('Nach freier Kapazität', 'By free capacity') : tr('Gleichmäßig', 'Even'));
function DistributionSwitch({ value, admin, tip }) {
  const card = infoCard({
    title: tr('Verteilung der Stunden', 'How hours are spread'),
    text: tr(
      'Nach freier Kapazität: Stunden innerhalb von Start und Due dorthin, wo Platz ist – Termine bleiben unverändert. Gleichmäßig: jede Woche bekommt denselben Anteil und kann dabei über 100 % kommen.',
      'By free capacity: hours go where there is room within start and due – the dates stay unchanged. Even: every week gets the same share and may go above 100 %.'),
    inputs: [[tr('Admin-Vorgabe', 'Admin default'), distName(admin)]],
    hint: tr('Nur deine Ansicht (auf diesem Gerät gemerkt). Plan vs. Ist vergleicht mit der Admin-Vorgabe.', 'Only your view (remembered on this device). Plan vs. actual compares against the admin default.'),
  });
  return (
    <span className="wb-dist" {...tip(card)}>
      <span className="faint" aria-hidden="true">{tr('Verteilung', 'Distribution')}</span>
      <Segmented size="sm" value={value} onChange={(v) => distStore.set(v)} label={tr('Verteilung der Stunden', 'How hours are spread')}
        options={[
          { value: 'even', label: tr('Gleichmäßig', 'Even'), title: tr('Gleicher Anteil in jeder Woche – kann über 100 % kommen', 'Same share every week – may go above 100 %') },
          { value: 'capacity', label: tr('Nach freier Kapazität', 'By free capacity'), title: tr('Stunden innerhalb von Start und Due dorthin, wo Platz ist – Termine bleiben unverändert', 'Hours go where there is room within start and due – the dates stay unchanged') },
        ]} />
    </span>
  );
}

// ---------- how many weeks the board shows (tester 2026-11-17: selectable, not fixed; more weeks scroll sideways) ----------
const RANGE_KEY = 'pc-wb-weeks';
export const WEEK_RANGES = [8, 12, 26];
let rangeSnap = (() => { try { const v = +localStorage.getItem(RANGE_KEY); return WEEK_RANGES.includes(v) ? v : null; } catch { return null; } })();
const rangeSubs = new Set();
const rangeStore = {
  get: () => rangeSnap,
  set(v) { rangeSnap = v; try { localStorage.setItem(RANGE_KEY, String(v)); } catch { /* private window */ } rangeSubs.forEach((f) => f()); },
  subscribe(f) { rangeSubs.add(f); return () => rangeSubs.delete(f); },
};
export function useWeekRange(fallback = PLAN_WEEKS) {
  return useSyncExternalStore(rangeStore.subscribe, rangeStore.get, rangeStore.get) || fallback;
}
function RangeSwitch({ value, tip }) {
  return (
    <span className="wb-dist" {...tip(infoCard({
      title: tr('Zeitraum', 'Time range'),
      text: tr('Wie viele Wochen die Planung zeigt. Ab 12 Wochen scrollt die Tafel seitlich (Maus­rad mit Shift oder wischen); die Personen bleiben links stehen.', 'How many weeks the plan shows. From 12 weeks the board scrolls sideways (shift + wheel or swipe); people stay on the left.'),
      hint: tr('Nur deine Ansicht (auf diesem Gerät gemerkt).', 'Only your view (remembered on this device).'),
    }))}>
      <span className="faint" aria-hidden="true">{tr('Wochen', 'Weeks')}</span>
      <Segmented size="sm" value={value} onChange={(v) => rangeStore.set(v)} label={tr('Anzahl Wochen', 'Number of weeks')}
        options={WEEK_RANGES.map((n) => ({ value: n, label: String(n), title: tr(`${n} Wochen ab dieser Woche`, `${n} weeks from this week`) }))} />
    </span>
  );
}

// ---------- formatting ----------
// capacity distribution: when a task's hours run out, against its due date
const finishText = (f) => (f.overflow
  ? tr('zu wenig Platz bis zum Due – der Rest ist gleichmäßig verteilt (Überlast)', 'not enough room by the due date – the rest is spread evenly (overload)')
  : f.early > 0 ? tr(`fertig in ${fmt.week(f.week)} – danach hat die Person bis zum Due keinen Platz`, `done in ${fmt.week(f.week)} – after that the person has no room until the due date`)
    : tr(`fertig in ${fmt.week(f.week)} – zum Due`, `done in ${fmt.week(f.week)} – by the due date`));
// Project colours as in Capacity › Weeks (same order: portfolio rank), the first one follows the theme.
const PAL = ['var(--ink)', '#E34B04', '#8F8B82', '#C98A06', '#3D5BA6', '#2F7D57', '#B05B8C', '#5E8C9A', '#9A3402', '#6B6860'];
export const projectColor = (i) => (i >= 0 ? PAL[i % PAL.length] : 'var(--line-strong)');
const dm = (iso) => (iso ? fmt.date(iso, { day: '2-digit', month: '2-digit' }) : '–');
const hrs = (v) => fmt.h(v, v > 0 && v < 9.95 && Math.abs(v - Math.round(v)) > 0.05 ? 1 : 0);
const pct = (u) => (u === Infinity ? '∞' : fmt.pct(u));
// the small percentage next to the words – never "0 %" (boss 2026-11-20: "28 h frei · 0 %" said nothing)
const pctTag = (u) => (u !== Infinity && !(Math.round((u || 0) * 100) >= 1) ? null : <b>{pct(u)}</b>);
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
const nobody = () => tr('nicht zugewiesen', 'unassigned');
const otherPerson = () => tr('weitere Person', 'other person');
const REFUSE = {
  support: () => tr('Projekt-Tasks lassen sich nicht in den Support verschieben.', 'Project tasks cannot be moved into support.'),
  project: () => tr('Das Projekt lässt sich hier nicht ändern – nur Woche und Assignee.', 'The project cannot be changed here – only week and assignee.'),
  readonly: () => tr('Hier lässt sich nichts verschieben.', 'Nothing can be moved here.'),
  unknown: () => tr('Dorthin lässt sich die Karte nicht ziehen.', 'The card cannot be dropped there.'),
  hidden: () => tr('Personen außerhalb deiner Sichtbarkeit lassen sich hier nicht planen.', 'People outside what you may see cannot be planned here.'),
};

// the Personen sum in lines (boss 2026-11-23): the people's time, what is planned, what does not fit person by person
// one decimal, as the calculations on the board – the sentence above a calculation uses the same (boss 2026-11-23)
const hCalc = (v) => fmt.h(v || 0, Math.abs((v || 0) - Math.round(v || 0)) < 0.05 ? 0 : 1);
function peopleSumCalc(f) {
  const h = hCalc;
  const lines = [tr(`${h(f.time)} Zeit der Personen`, `${h(f.time)} the people's time`),
    tr(`${h(f.load)} geplant${f.unassigned > 0.05 ? ` (davon ${h(f.unassigned)} ohne Assignee)` : ''}`, `${h(f.load)} planned${f.unassigned > 0.05 ? ` (${h(f.unassigned)} of it unassigned)` : ''}`)];
  if (f.over > 0.05) lines.push(tr(`${h(f.over)} zu viel (je Person zusammengezählt)`, `${h(f.over)} too much (added up person by person)`));
  if (f.free > 0.05) lines.push(tr(`${h(f.free)} noch frei${f.over > 0.05 ? ' – bei anderen Personen' : ''}`, `${h(f.free)} still free${f.over > 0.05 ? ' – with other people' : ''}`));
  lines.push(f.over > 0.05 && f.free > 0.05 ? tr(`${h(f.load)} ÷ ${h(f.avail)} passend = ${fmt.pct(f.util)}`, `${h(f.load)} ÷ ${h(f.avail)} that fit = ${fmt.pct(f.util)}`) : `${h(f.load)} ÷ ${h(f.avail)} = ${fmt.pct(f.util)}`);
  return lines.join('\n');
}

export default function WeekBoard({ team = null, project = null, mode = 'people', canEdit = false, onOpenTeam, weeks: weeksDefault = PLAN_WEEKS }) {
  const app = useApp();
  const weeks = useWeekRange(weeksDefault);
  const { ds, computed, toast, setDs, done, pushUndo, runUndo } = app;
  const pins = ds?.planEven || {};
  const [why, setWhy] = useState(null); // { task, rect } – the reasoning card
  const [over, setOver] = useState(null); // { rowId | foot, wi, rect } – "Warum zu viel?" (boss 2026-11-20)
  const log = useLogState();
  const distribution = useDistribution(app.config);
  const { moves, errors } = usePendingMoves();
  const tip = useTip();
  const rootRef = useRef(null), scrollerRef = useRef(null);
  const board = useMemo(() => (computed && ds ? buildBoard({ ds, computed, team, project, mode, weeks, moves, distribution }) : null), [ds, computed, team, project, mode, weeks, moves, distribution]);
  const boardRef = useRef(board);
  boardRef.current = board;
  const issueById = useMemo(() => new Map((ds?.issues || []).map((i) => [i.id, i])), [ds]);
  const canDrag = !!canEdit && board?.kind !== 'teams';
  // red weeks → one concrete move each, accepted by a click (only a pending change until "In Jira übernehmen")
  // Each suggestion's preview is an exact re-plan (whole boards), so it is computed off the drag path: deferred, and only
  // shown once it belongs to the board on screen – a stale suggestion is never offered for acceptance.
  const sugBoard = useDeferredValue(board);
  // the Projekte rows have no person rows: the advice comes from the same team's people board (same weeks, distribution,
  // pending moves) – a red project week gets the same one-click fix as the person's week (boss 2026-11-20)
  const sugAll = useMemo(() => {
    if (!sugBoard || !canDrag) return null;
    const base = sugBoard.kind === 'projects' ? buildBoard({ ds, computed, team: sugBoard.team, mode: 'people', weeks: sugBoard.weeks.length, moves, distribution: sugBoard.distribution }) : sugBoard;
    return { board: sugBoard, list: suggestShifts({ ds, computed, board: base, moves }) };
  }, [sugBoard, canDrag]); // keyed by sugBoard: ds/computed/moves are what it was built from
  const suggestions = sugAll && sugAll.board === board ? sugAll.list : NO_SUG;
  const [dismissed, setDismissed] = useState(() => new Set());
  const openSug = useMemo(() => suggestions.filter((x) => !dismissed.has(x.id)), [suggestions, dismissed]);
  const sugByCell = useMemo(() => { const m = new Map(); for (const x of openSug) { if (x.pastProjectDue) continue; for (const w of x.conflictWeeks) { if (!m.has(`${x.personId}:${w}`)) m.set(`${x.personId}:${w}`, x); if (!m.has(`t:${x.taskId}:${w}`)) m.set(`t:${x.taskId}:${w}`, x); } } return m; }, [openSug]); // never one past the project due (tester 2026-11-19)
  const sugForCell = (r, c, wi) => (r.kind === 'person' ? sugByCell.get(`${r.accountId}:${board.weeks[wi].from}`)
    : r.kind === 'projectRow' ? c.cards.map((k) => k.kind === 'task' && sugByCell.get(`t:${k.id}:${board.weeks[wi].from}`)).find(Boolean) : null);
  const openOver = (el, t) => setOver({ ...t, rect: el.getBoundingClientRect() });
  const [menu, setMenu] = useState(null); // { card, week, rect }
  const focusNext = useRef(null);
  const teamName = (id) => computed?.model.teams.get(id)?.name || id || '';
  const personName = (id) => ds?.people?.[id]?.name || board?.candidates.find((c) => c.id === id)?.name || '';

  // ---------- optimizer ----------
  // The panel keeps its own state in optStore (mode, target, selection – it survives a team switch), so switching
  // there re-renders only the panel; a card menu computes its suggestion on opening, with the panel's target.
  const menuOpt = useMemo(() => (menu && ds && computed ? optimizeAll({ ds, computed, team, project, moves, target: optStore.get().target, distribution }) : null),
    [menu, ds, computed, team, project, moves, distribution]);
  const fasterFor = (id) => (menuOpt ? suggestionsFor(menuOpt, id)[0] || null : null);
  const applySuggestions = (list, { ai = false } = {}) => {
    if (!list.length) return;
    const ids = list.map((s) => s.taskId);
    const prev = pendingStore.get().moves;
    setMoves((mv) => suggestionMoves(mv, ds.issues, list), ids);
    const entries = list.map((s) => pushUndo(`${s.key}: ${menuLabel(s)} – ${ai ? tr('KI-Vorschlag', 'AI suggestion') : tr('Vorschlag aus Optimieren', 'suggestion from Optimize')}`, () => restoreMove(s.taskId, prev[s.taskId] || null), [`move:${s.taskId}`]));
    toast({
      text: tr(`${list.length} ${list.length === 1 ? 'Vorschlag' : 'Vorschläge'} vorgemerkt – noch nicht in Jira${list.length > 1 ? ' · jeder einzeln im Verlauf rückgängig' : ''}`, `${list.length} ${list.length === 1 ? 'suggestion' : 'suggestions'} added – not in Jira yet${list.length > 1 ? ' · each undoable in the history' : ''}`),
      icon: 'sparkle', undo: async () => { for (const e of [...entries].reverse()) await runUndo(e, { quiet: true }); },
    });
  };

  // Moves that Jira already reflects (after apply or a reload), or whose work item is gone, are dropped.
  useEffect(() => {
    const s = pendingStore.get();
    const stale = Object.entries(s.moves).filter(([id, m]) => {
      const i = issueById.get(id);
      return !i || ((i.start || null) === m.start && (i.due || null) === m.due && (i.assignee?.id || null) === m.assignee);
    }).map(([id]) => id);
    if (stale.length) setMoves((mv) => stale.reduce((acc, id) => undoMove(acc, id), mv));
  }, [issueById]);

  // ---------- one move (drag, menu or conflict fix) ----------
  const commit = useCallback((id, change) => {
    const issue = issueById.get(id);
    if (!issue || !computed) return false;
    const before = pendingStore.get().moves;
    const prevMove = before[id] || null;
    const next = moveTask(before, issue, change);
    setMoves(() => next, [id]);
    const m = next[id];
    const undoEntry = (label) => pushUndo(label, () => restoreMove(id, prevMove), [`move:${id}`]);
    if (!m) { const e = undoEntry(tr(`${issue.key}: wieder wie in Jira – Änderung zurückgenommen`, `${issue.key}: back to what Jira has – change taken back`)); toast({ text: tr(`${issue.key}: wieder wie in Jira`, `${issue.key}: back to what Jira has`), icon: 'undo', undo: () => runUndo(e) }); return true; }
    const parts = [];
    if (change.weeks || change.due) parts.push(`Start ${dm(m.start)}, Due ${dm(m.due)}`);
    if (change.assignee !== undefined) parts.push(`Assignee ${m.assigneeName || nobody()}`);
    const hit = planConflicts({ model: computed.model, moves: next }).filter((c) => c.pre.id === id || c.dep.id === id);
    const fixed = change.weeks && datesInverted(prevMove || { start: issue.start, due: issue.due })
      ? tr(' · Start lag in Jira nach dem Due – jetzt in der richtigen Reihenfolge', ' · Start was after the due date in Jira – now in the right order') : '';
    const imp = change.assignee ? assignImpact(boardRef.current, id, change.assignee, prevMove?.assignee ?? issue.assignee?.id ?? null) : null;
    const overTxt = imp?.over.length ? tr(` · ${m.assigneeName || 'Die Person'} ist damit in ${imp.over.length} ${imp.over.length === 1 ? 'Woche' : 'Wochen'} über 100 % (${weekRange(imp.over)}, bis ${loadText(imp.peak1)})`, ` · ${m.assigneeName || 'This person'} is then above 100 % in ${imp.over.length} ${imp.over.length === 1 ? 'week' : 'weeks'} (${weekRange(imp.over)}, up to ${loadText(imp.peak1)})`) : '';
    const teamTxt = change.team !== undefined ? tr(` · Team ${teamName(change.team) || '–'}`, ` · team ${teamName(change.team) || '–'}`) : '';
    const proj = computed.model.itemByRef.get(computed.model.byId.get(id)?.rootRef);
    const lateTxt = proj?.due && m.due && m.due > proj.due ? tr(` · endet nach dem Projekt-Due (${dm(proj.due)})`, ` · ends after the project due (${dm(proj.due)})`) : '';
    const warn = lateTxt + (change.warn === 'notInTeam' ? tr(` · Achtung: ${m.assigneeName} ist nicht im Team ${teamName(issue.team?.id)}`, ` · Note: ${m.assigneeName} is not in team ${teamName(issue.team?.id)}`) : '') + overTxt + teamTxt + fixed;
    const entry = undoEntry(`${issue.key}: ${parts.join(' · ')} – ${change.why || tr('von Hand', 'by hand')}`);
    toast({
      undo: () => runUndo(entry),
      text: `${issue.key}: ${parts.join(' · ')}${warn}${hit.length
        ? tr(` – Konflikt mit ${hit.map((c) => (c.pre.id === id ? c.dep.key : c.pre.key)).join(', ')} (Blocks)`, ` – conflicts with ${hit.map((c) => (c.pre.id === id ? c.dep.key : c.pre.key)).join(', ')} (blocks)`)
        : tr(' – noch nicht in Jira', ' – not in Jira yet')}`,
      icon: hit.length || warn ? 'alert' : 'calendar',
    });
    return true;
  }, [issueById, computed, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  // a suggestion accepted: the same pending move as a drag, with its reason in the undo history
  const acceptSug = (x) => commit(x.taskId, { ...(x.change || { weeks: x.weeks }), why: x.reason === 'noTime'
    ? tr(`Vorschlag: ${x.personName || 'Person'} hat in ${weekRange(x.conflictWeeks)} keine Zeit`, `suggestion: ${x.personName || 'person'} has no time in ${weekRange(x.conflictWeeks)}`)
    : tr(`Vorschlag: ${x.personName || 'Person'} über 100 % in ${weekRange(x.conflictWeeks)}`, `suggestion: ${x.personName || 'person'} above 100 % in ${weekRange(x.conflictWeeks)}`) });

  // ---------- capacity split: per-task "even" overrides (central, plan.even), one undo entry per task ----------
  const setEvenFor = async (ids, toEven) => {
    const res = await call('plan.even', toEven ? { even: ids } : { auto: ids });
    setDs((d) => ({ ...d, planEven: res?.even || {} }));
  };
  const toggleEven = async (tasks, toEven) => {
    try {
      await setEvenFor(tasks.map((t) => t.id), toEven);
      const entries = tasks.map((t) => pushUndo(
        toEven ? tr(`${t.key} gleichmäßig verteilt – vorher nach Kapazität`, `${t.key} split evenly – before: by capacity`) : tr(`${t.key} wieder nach Kapazität – vorher gleichmäßig`, `${t.key} by capacity again – before: even`),
        () => setEvenFor([t.id], !toEven), [`even:${t.id}`]));
      toast({
        text: tasks.length === 1
          ? (toEven ? tr(`${tasks[0].key}: gleichmäßig verteilt – gilt für alle`, `${tasks[0].key}: split evenly – for everyone`) : tr(`${tasks[0].key}: wieder nach freier Kapazität`, `${tasks[0].key}: by free capacity again`))
          : tr(`${tasks.length} Aufgaben gleichmäßig verteilt – jede einzeln im Verlauf rückgängig`, `${tasks.length} tasks split evenly – each undoable in the history`),
        icon: 'undo', undo: async () => { for (const e of [...entries].reverse()) await runUndo(e, { quiet: true }); },
      });
    } catch (e) { toast({ text: errText(e), error: true }); }
  };
  const openWhy = (taskId, rect) => { const t = board?.taskById.get(taskId); if (t?.fill) setWhy({ task: t, rect }); };

  // ---------- drag and drop ----------
  const api = useRef({});
  api.current = {
    getBoard: () => boardRef.current, canDrag,
    onDrop: (card, v, cell) => {
      commit(card.id, { weeks: v.weeks, ...(v.assignee !== undefined ? { assignee: v.assignee, assigneeName: v.assigneeName || personName(v.assignee) } : {}), warn: v.warn });
    },
    onRefuse: (v) => toast({ text: (REFUSE[v.reason] || REFUSE.unknown)(), icon: 'info' }),
    // what a drop would do, shown in the target week before letting go: the new dates (computed exactly like the move) and person
    preview: (card, v) => {
      const t = boardRef.current?.taskById.get(card.id);
      const parts = [];
      if (v.weeks && t) { const nd = shiftDates({ start: t.start, due: t.due }, v.weeks); parts.push(nd.start && nd.due ? `${dm(nd.start)} – ${dm(nd.due)}` : nd.due ? `Due ${dm(nd.due)}` : `Start ${dm(nd.start)}`); }
      if (v.assignee !== undefined) parts.push(v.assignee ? `→ ${v.assigneeName || ''}` : tr('→ nicht zugewiesen', '→ unassigned'));
      return parts.join(' · ');
    },
  };
  const drag = useCardDrag({ rootRef, scrollerRef, api });

  // after a move: the dropped card glides from where it was let go to its place; keyboard focus follows the card
  useLayoutEffect(() => {
    const f = drag.flip.current;
    drag.flip.current = null;
    if (f) {
      f.fly.remove();
      f.src?.classList.remove('wb-src');
      const el = rootRef.current?.querySelector(`[data-card="${f.key}"]`);
      if (el && el.animate) {
        const r = el.getBoundingClientRect();
        el.style.animation = 'none';
        el.animate([{ transform: `translate(${f.rect.left - r.left}px, ${f.rect.top - r.top}px) scale(1.03)` }, { transform: 'none' }], { duration: isReduced() ? 0 : MS.gentle, easing: cssEase(EASE) });
      }
    }
    const k = focusNext.current;
    focusNext.current = null;
    // keyboard path (menu, Alt+arrows): the moved card keeps the focus
    if (k && (!document.activeElement || document.activeElement === document.body || document.activeElement.closest?.('.wb'))) rootRef.current?.querySelector(`[data-card="${k}"]`)?.focus();
  }, [board, drag.flip]);

  // ---------- menu ----------
  const openMenu = (el, card, week) => {
    if (drag.suppress.current) return;
    setMenu({ card, week, rect: el.getBoundingClientRect() });
  };
  const closeMenu = (refocus) => {
    const m = menu;
    setMenu(null);
    if (refocus && m) requestAnimationFrame(() => rootRef.current?.querySelector(`[data-card="${m.card.id}:${m.week}"]`)?.focus());
  };
  const shift = (card, week, delta) => {
    if (commit(card.id, { weeks: delta })) focusNext.current = `${card.id}:${Math.max(0, Math.min(board.weeks.length - 1, week + delta))}`;
  };
  // extra { team, teamName }: change the work item's team too (offered when the person is in another team)
  const reassign = (card, week, pid, extra = {}) => {
    const t = board.taskById.get(card.id);
    const warn = extra.team === undefined && pid && t?.teamId && board.personTeam(pid) && !board.inTeamOf(pid, t.teamId) ? 'notInTeam' : null;
    if (commit(card.id, { assignee: pid, assigneeName: pid ? personName(pid) : null, warn, ...extra })) focusNext.current = `${card.id}:${week}`;
  };

  // "Unassigned" stays as a drop target while dragging is possible; otherwise only when it holds something
  const showHead = (r) => r.kind !== 'unassigned' || canDrag || r.cells.some((c) => c.cards.length || c.ghosts.length);
  const rows = board ? board.rows.filter(showHead) : [];
  // the first rows render at once, the rest when the browser is idle (lib/virtual.jsx): a big team's board was one
  // 0.5–1.2 s render; the first screen now comes first and every click still gets through
  const rowsN = useProgressive(rows.length, { first: 4, reset: `${team}|${project}|${mode}` });

  if (!board) return null;
  const W = board.weeks;
  const empty = board.rows.every((r) => r.kind === 'unassigned' && !r.cells.some((c) => c.cards.length || c.ghosts.length));
  const projectsShown = [...new Set(board.rows.flatMap((r) => r.cells.flatMap((c) => c.cards.filter((x) => x.kind === 'task').map((x) => x.ref))))]
    .sort((a, b) => (board.colorIdx.get(a) ?? 1e9) - (board.colorIdx.get(b) ?? 1e9));

  return (
    <div className="wb" ref={rootRef}>
      {/* toolbar (read-only note, "Optimieren") and the optimizer panel above the board */}
      {/* an empty board still offers more weeks – later work may start beyond the first 8 (production check 2026-11-17) */}
      {empty && <div className="wb-range-only"><RangeSwitch value={weeks} tip={tip} /></div>}
      <OptimizerBar show={!empty} distribution={distribution} extra={<>
        <RangeSwitch value={weeks} tip={tip} />
        <DistributionSwitch value={distribution} admin={distributionOf(app.config?.rules?.distribution)} tip={tip} />
        {board.distribution === 'capacity' && (
          <button type="button" className={`btn btn-sm wb-log-btn ${log.open ? 'on' : ''}`} aria-expanded={log.open} onClick={() => logStore.set({ open: !log.open })}>
            <span aria-hidden="true">⇄</span>{tr('Was die Automatik getan hat', 'What the automation did')}<span className={`wb-opt-badge ${board.capTasks.length ? '' : 'zero'}`}>{board.capTasks.length}</span>
          </button>
        )}
      </>}
        note={!canEdit && board.kind !== 'teams' ? <div className="wb-note"><Icon name="lock" size={14} />{tr('Nur ansehen: Karten verschieben darf, wer die Berechtigung „Wochenplanung bearbeiten“ hat.', 'View only: moving cards needs the "Edit weekly planning" permission.')}</div> : null}
        ds={ds} computed={computed} team={team} project={project} moves={moves} canEdit={!!canEdit} tip={tip}
        color={(ref) => projectColor(board.colorIdx.get(ref) ?? -1)} onApply={applySuggestions} logTasks={board.capTasks?.length || 0} />

      {log.open && board.distribution === 'capacity' && !empty && (
        <PlanLog tasks={board.capTasks} pins={pins} canEdit={!!canEdit} color={(ref) => projectColor(board.colorIdx.get(ref) ?? -1)}
          onToggle={toggleEven} onWhy={(t, rect) => setWhy({ task: t, rect })} />
      )}
      {why && <WhyCard key={why.task.id} task={board.taskById.get(why.task.id) || why.task} pin={pins[why.task.id]} rect={why.rect} canEdit={!!canEdit}
        onToggle={(toEven) => { const t = why.task; setWhy(null); toggleEven([t], toEven); }} onClose={() => setWhy(null)} />}

      {over && (
        <OverWhy key={`${over.rowId || 'foot'}:${over.wi}`} target={over} board={board} model={computed.model} suggestions={openSug} canEdit={canDrag} teamName={teamName}
          sugLabel={(x) => `${x.key}: ${sugAction(x)}`} onAccept={acceptSug}
          onHandOver={(t, to) => commit(t.id, { assignee: to.id, assigneeName: to.name, why: tr(`Vorschlag: ${to.name} hat Platz`, `suggestion: ${to.name} has room`) })}
          onClose={(refocus) => { const o = over; setOver(null); if (refocus && o) requestAnimationFrame(() => rootRef.current?.querySelector(o.foot ? `.wb-row.foot .wb-cell:nth-child(${o.wi + 2}) .ow-open` : `[data-row="${o.rowId}"][data-week="${o.wi}"] .ow-open`)?.focus()); }} />
      )}
      {/* suggestions for red weeks: at the top, next to the tools – not in the floating dock (it covered the board) */}
      <Suggestions list={openSug} tip={tip} onAccept={(x) => acceptSug(x)} onAcceptAll={() => openSug.filter((x) => !x.pastProjectDue).forEach((x) => acceptSug(x))} onDismiss={(x) => setDismissed((d) => new Set([...d, x.id]))} />

      <section className="card wb-card-wrap">
        {!empty && <BoardLegend kind={board.kind} canDrag={canDrag} projects={board.kind === 'teams' ? [] : projectsShown.slice(0, 8).map((ref) => ({ ref, name: computed.model.itemByRef.get(ref)?.name || ref, color: projectColor(board.colorIdx.get(ref) ?? -1) }))} />}
        {empty ? (
          <Empty icon="calendar" title={tr(`Keine geplanten Tasks in den nächsten ${weeks} Wochen`, `No planned tasks in the next ${weeks} weeks`)}>
            {tr('Tasks erscheinen hier, sobald sie Original Estimate, Start und Due date haben.', 'Tasks appear here once they have an original estimate, a start and a due date.')}{weeks < 26 ? tr(' Oben lassen sich mehr Wochen zeigen.', ' More weeks can be shown above.') : ''}
          </Empty>
        ) : (
          <div className="wb-scroll" ref={scrollerRef} tabIndex={0} role="region" aria-label={tr('Wochenplanung, mit Pfeiltasten scrollbar', 'Weekly planning, scrollable with arrow keys')}>
            <div className="wb-grid" style={{ '--wb-cols': W.length }} role="grid" aria-rowcount={board.rows.length + 1}>
              <div className="wb-row" role="row">
                <div className="wb-corner" role="columnheader">{{ people: tr('Person', 'Person'), project: tr('Person', 'Person'), projects: tr('Projekt', 'Project'), teams: 'Team' }[board.kind]}</div>
                {W.map((w) => (
                  <div key={w.from} className={`wb-wk ${w.current ? 'cur' : ''}`} role="columnheader" aria-current={w.current ? 'date' : undefined}>
                    {fmt.week(w.from)}<span>{dm(w.from)} – {dm(w.to)}</span>
                  </div>
                ))}
              </div>
              {rows.slice(0, rowsN).map((r, ri) => (
                <div key={r.id} className="wb-row" role="row">
                  <RowHead r={r} board={board} onOpenTeam={onOpenTeam} teamName={teamName} tip={tip} />
                  {r.cells.map((c, wi) => (
                    <div key={wi} className={`wb-cell ${W[wi].current ? 'cur' : ''} ${noTime(r, c) ? 'no-time' : ''}`} role="gridcell" data-wb-cell="" data-row={r.id} data-week={wi}
                      style={{ '--row-i': ri }}>
                      <CellHead r={r} c={c} w={W[wi]} board={board} tip={tip} onWhy={(el) => openOver(el, { rowId: r.id, wi })} />
                      <AbsenceNote r={r} c={c} />
                      {sugForCell(r, c, wi) && <AutoFix s={sugForCell(r, c, wi)} tip={tip} onAccept={acceptSug} />}
                      <div className="wb-cards">
                        {c.cards.map((k) => (k.kind === 'task'
                          ? <TaskCard key={k.id} k={k} week={wi} board={board} canDrag={canDrag && !k.locked} drag={drag} tip={tip} openMenu={openMenu} shift={shift} first={board.taskById.get(k.id)?.hours.findIndex((h) => h > 0.05) === wi} />
                          : <InfoCardMini key={k.id} k={k} board={board} teamName={teamName} tip={tip} />))}
                        {c.ghosts.map((k) => <GhostCard key={`g:${k.id}`} k={k} />)}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {board.foot && (
                <div className="wb-row foot" role="row">
                  <div className="wb-foothead wb-total" style={{ alignSelf: 'center', padding: '4px 2px' }}><b>{board.kind === 'project' ? tr('In diesem Projekt', 'In this project') : tr('Summe', 'Total')}</b></div>
                  {board.foot.map((f, wi) => (
                    <div key={wi} className="wb-cell" role="gridcell">
                      {(() => {
                        const fit = f.avail == null ? null : fitOf(f.load, f.avail);
                        const plain = fit && f.load > 0.05 && f.util !== Infinity;
                        return (
                          <div className={`wb-head t-${f.avail == null || f.load <= 0.05 ? 'none' : f.util === Infinity ? 'bad' : utilTone(f.util)}${plain ? ' fit' : ''}`}
                            {...(plain ? { tabIndex: 0, ...tip(infoCard({ title: `${board.kind === 'project' ? tr('In diesem Projekt', 'In this project') : tr('Summe', 'Total')} · ${fmt.week(W[wi].from)}`, text: f.sumOf === 'people' ? `${fitSentence(fit, null, hCalc)} ${tr('Die Personen oben zusammen – jede mit ihrer ganzen Woche, auch Arbeit für andere Teams. Was eine Person zu viel hat, gleicht die freie Zeit einer anderen nicht aus – dafür braucht es eine Übergabe.', 'The people above together – each with their whole week, also work for other teams. What one person has too much is not offset by another person’s free time – that takes a hand-over.')}` : fitSentence(fit, board.kind === 'projects' ? tr('Team-Kapazität', 'team capacity') : null, hCalc), calc: f.sumOf === 'people' ? peopleSumCalc(f) : `${fmt.n(f.load, 1)} ÷ ${fmt.n(f.avail, 1)} = ${pct(f.util)}` })) } : {})}>
                            {f.avail == null ? <span>{hrs(f.load)}</span> : plain ? <><FitWords fit={fit} />{pctTag(f.util)}<FitBar fit={fit} />{fit.kind === 'over' && <WhyOverButton onOpen={(el) => openOver(el, { foot: true, wi })} />}</> : f.load <= 0.05 ? <span>{f.avail > 0.05 ? `${hrs(f.avail)} ${tr('frei', 'free')}` : '–'}</span> : <><span>{fmt.n(f.load)} / {hrs(f.avail)}</span><b title={f.util === Infinity ? noCapacityReason(f.load, getLang()) : undefined}>{f.util === Infinity ? NO_CAP_TEXT : pct(f.util)}</b></>}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* docked below the board (sticky), so the board never jumps when the first change or conflict appears */}
      <div className="wb-dock">
        <Conflicts list={board.conflicts} canEdit={canDrag || (canEdit && board.kind === 'teams')} onFix={(c) => commit(c.fix.issueId, { ...(c.fix.startOnly ? { start: c.fix.start, due: c.fix.due } : { weeks: c.fix.weeks }), why: tr(`Konflikt mit ${c.pre.key} gelöst`, `conflict with ${c.pre.key} resolved`) })} />
        <Pending canEdit={canEdit} board={board} moves={moves} errors={errors} app={app} issueById={issueById} setDs={setDs} done={done} toast={toast} />
      </div>

      {menu && (
        <CardMenu key={`${menu.card.id}:${menu.week}`} menu={menu} board={board} canEdit={canDrag && !menu.card.locked} pending={!!moves[menu.card.id]} teamName={teamName}
          faster={fasterFor(menu.card.id)} fill={menu.card.locked ? null : board.taskById.get(menu.card.id)?.fill || null} canToggle={!!canEdit && !menu.card.locked}
          onWhy={() => { const m = menu; setMenu(null); openWhy(m.card.id, m.rect); }}
          onToggleEven={(toEven) => { const m = menu; setMenu(null); toggleEven([board.taskById.get(m.card.id)], toEven); }}
          onFaster={(s) => {
            setMenu(null);
            // the dependent's start moves with it, so the blocks conflict is resolved, not left behind (tester 2026-11-19) –
            // committed first, so the confirmation of the card's own change already shows the resolved state
            for (const a of s.also || []) commit(a.taskId, { start: a.start, ...(a.due ? { due: a.due } : {}), why: tr(`wartet auf ${s.key} – startet nach dessen neuem Due`, `waits for ${s.key} – starts after its new due date`) });
            const ok = commit(menu.card.id, { ...s.move, why: tr(`Vorschlag aus Optimieren (${MODE[s.mode]?.label() || ''})`, `suggestion from Optimize (${MODE[s.mode]?.label() || ''})`) });
            if (ok) focusNext.current = `${menu.card.id}:${menu.week}`; // keeps focus when the card is still in that week
          }}
          onClose={closeMenu}
          onShift={(d) => { setMenu(null); shift(menu.card, menu.week, d); }}
          onAssign={(pid, extra) => { setMenu(null); reassign(menu.card, menu.week, pid, extra); }}
          onDiscard={() => {
            const { id, key } = menu.card;
            const prev = pendingStore.get().moves[id] || null;
            setMenu(null); setMoves((mv) => undoMove(mv, id), [id]);
            const e = pushUndo(tr(`${key}: Änderung verworfen`, `${key}: change discarded`), () => restoreMove(id, prev), [`move:${id}`]);
            toast({ text: tr(`Änderung an ${key} verworfen`, `Change to ${key} discarded`), icon: 'undo', undo: () => runUndo(e) });
          }}
          onOpen={() => { setMenu(null); openIssue(menu.card.key); }} />
      )}
    </div>
  );
}

// ---------- pointer drag (no React state per frame: a floating clone follows the pointer via transform) ----------
function useCardDrag({ rootRef, scrollerRef, api }) {
  const st = useRef(null);
  const suppress = useRef(false);
  const flip = useRef(null);
  const handlers = useMemo(() => {
    const scrollParent = (el) => {
      for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) return p;
      }
      return document.scrollingElement;
    };
    const blockTouch = (e) => { if (st.current?.active) e.preventDefault(); };
    const shake = (el) => { el.classList.remove('wb-shake'); void el.offsetWidth; el.classList.add('wb-shake'); setTimeout(() => el.classList.remove('wb-shake'), 460); };
    const end = (s) => {
      clearTimeout(s.timer);
      cancelAnimationFrame(s.raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('touchmove', blockTouch);
      document.documentElement.classList.remove('wb-dragging');
      s.target?.classList.remove('wb-ok', 'wb-no');
      if (s.target) delete s.target.dataset.wbPreview;
      if (st.current === s) st.current = null;
    };
    const flyBack = (s) => {
      end(s);
      const fly = s.fly;
      if (!fly) return;
      const back = s.el.isConnected ? s.el.getBoundingClientRect() : s.rect;
      const finish = () => { fly.remove(); s.el.classList.remove('wb-src'); };
      try {
        const a = fly.animate([{ transform: fly.style.transform }, { transform: `translate3d(${back.left - s.rect.left}px, ${back.top - s.rect.top}px, 0)` }], { duration: isReduced() ? 0 : MS.base, easing: cssEase(EASE), fill: 'forwards' });
        a.onfinish = finish;
      } catch { finish(); }
      setTimeout(finish, 420); // never leave a card floating (animations can stall inside the Jira frame)
    };
    const tick = (s) => {
      if (!s.active) return;
      s.fly.style.transform = `translate3d(${s.x - s.x0}px, ${s.y - s.y0}px, 0) rotate(-1deg) scale(1.03)`;
      // auto-scroll near the edges: sideways inside the board, up and down in the page
      const edge = 52, speed = (d) => Math.max(-20, Math.min(20, d * 0.4));
      const sc = s.scroller;
      if (sc) {
        const r = sc.getBoundingClientRect();
        const d = s.x < r.left + edge ? s.x - (r.left + edge) : s.x > r.right - edge ? s.x - (r.right - edge) : 0;
        if (d) sc.scrollLeft += speed(d);
      }
      const vs = s.vscroll;
      if (vs) {
        const r = vs === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : vs.getBoundingClientRect();
        const d = s.y < r.top + edge ? s.y - (r.top + edge) : s.y > r.bottom - edge ? s.y - (r.bottom - edge) : 0;
        if (d) vs.scrollBy({ top: speed(d), behavior: 'instant' });
      }
      const hit = document.elementFromPoint(s.x, s.y)?.closest?.('[data-wb-cell]');
      const cell = hit && rootRef.current?.contains(hit) ? hit : null;
      if (cell !== s.target) {
        if (s.target) { s.target.classList.remove('wb-ok', 'wb-no'); delete s.target.dataset.wbPreview; }
        s.target = cell;
        s.verdict = null;
        if (cell) {
          const v = planDrop(api.current.getBoard(), { id: s.card.id, fromWeek: s.card.week, toRow: cell.dataset.row, toWeek: +cell.dataset.week });
          s.verdict = v;
          if (!v.noop) cell.classList.add(v.ok ? 'wb-ok' : 'wb-no');
          const p = v.ok && !v.noop ? api.current.preview?.(s.card, v) : '';
          if (p) cell.dataset.wbPreview = p;
        }
      }
      s.raf = requestAnimationFrame(() => tick(s));
    };
    const begin = (s) => {
      if (s.active || st.current !== s || !api.current.canDrag) return;
      s.active = true;
      const r = s.el.getBoundingClientRect();
      s.rect = r;
      const fly = s.el.cloneNode(true);
      fly.classList.add('wb-fly');
      fly.removeAttribute('tabindex'); fly.removeAttribute('data-card'); fly.removeAttribute('data-has-tip');
      fly.setAttribute('aria-hidden', 'true');
      Object.assign(fly.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      document.body.appendChild(fly);
      s.fly = fly;
      s.el.classList.add('wb-src');
      document.documentElement.classList.add('wb-dragging');
      s.scroller = scrollerRef.current;
      s.vscroll = scrollParent(rootRef.current);
      if (s.type !== 'mouse') navigator.vibrate?.(8);
      s.raf = requestAnimationFrame(() => tick(s));
    };
    const drop = (s) => {
      end(s);
      suppress.current = true;
      setTimeout(() => { suppress.current = false; }, 0);
      const v = s.target ? s.verdict : null;
      if (v?.ok && !v.noop) {
        const f = { key: `${s.card.id}:${+s.target.dataset.week}`, rect: s.fly.getBoundingClientRect(), fly: s.fly, src: s.el };
        flip.current = f;
        setTimeout(() => { if (f.fly.isConnected) { f.fly.remove(); f.src.classList.remove('wb-src'); } if (flip.current === f) flip.current = null; }, 500);
        api.current.onDrop(s.card, v, s.target);
        return;
      }
      if (v && !v.ok) { shake(s.target); api.current.onRefuse(v); }
      flyBack(s);
    };
    function move(e) {
      const s = st.current;
      if (!s || e.pointerId !== s.pid) return;
      s.x = e.clientX; s.y = e.clientY;
      if (s.active) return;
      const d = Math.hypot(s.x - s.x0, s.y - s.y0);
      if (s.type === 'mouse') { if (d > 4 && api.current.canDrag) begin(s); } else if (d > 9) end(s); // a finger that moves first scrolls
    }
    function up(e) {
      const s = st.current;
      if (!s || e.pointerId !== s.pid) return;
      if (s.active) drop(s); else end(s); // no drag: the click opens the menu
    }
    function cancel(e) {
      const s = st.current;
      if (!s || e.pointerId !== s.pid) return;
      if (s.active) flyBack(s); else end(s);
    }
    const down = (e, card) => {
      if (st.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const s = { el: e.currentTarget, card, pid: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, active: false };
      st.current = s;
      if (e.pointerType === 'mouse') { e.preventDefault(); s.el.focus({ preventScroll: true }); } else if (api.current.canDrag) {
        s.timer = setTimeout(() => begin(s), 280); // touch and pen: hold briefly, then drag
        document.addEventListener('touchmove', blockTouch, { passive: false });
      }
      window.addEventListener('pointermove', move, { passive: true });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    };
    return { down, isTouchHold: () => !!st.current && st.current.type !== 'mouse', abort: () => { const s = st.current; if (s) { if (s.active) flyBack(s); else end(s); } } };
  }, [rootRef, scrollerRef, api]);
  useEffect(() => () => handlers.abort(), [handlers]);
  return { ...handlers, suppress, flip };
}

// ---------- rows ----------
function RowHead({ r, board, onOpenTeam, teamName, tip }) {
  const over = r.over > 0 && (
    <span className="wb-over"><Icon name="alert" size={12} />{tr(`${r.over} ${r.over === 1 ? 'Woche' : 'Wochen'} überlastet`, `${r.over} ${r.over === 1 ? 'week' : 'weeks'} overloaded`)}</span>
  );
  if (r.kind === 'person') {
    const s = r.summary;
    const days = s.absentDays + s.holidayDays;
    const meta = [
      `${fmt.n(s.weekly)} h/${tr('Woche', 'week')}`,
      !r.inTeam && board.kind === 'people' ? tr(`Team ${teamName(r.teamId) || '–'}`, `team ${teamName(r.teamId) || '–'}`) : null,
      board.kind === 'project' && r.teamId ? teamName(r.teamId) : null,
      days ? tr(`${days} ${days === 1 ? 'Tag' : 'Tage'} Urlaub/Feiertag`, `${days} ${days === 1 ? 'day' : 'days'} leave/holiday`) : null,
    ].filter(Boolean).join(' · ');
    // one distinct colour per part of the week (boss feedback 2026-11-11: two greys and an unlabelled "free" grey were unclear)
    const parts = [
      ['off', tr('Abwesend', 'Absent'), 'var(--wb-off)'],
      ['daily', tr('Tagesgeschäft', 'Daily business'), 'var(--wb-daily)'],
      ['support', 'Support', 'var(--wb-support)'],
      ['projects', tr('Projekte', 'Projects'), 'var(--wb-projects)'],
    ].filter(([k]) => k === 'support' || k === 'projects' || s[k] > 0);
    const used = parts.reduce((a, [k]) => a + (s[k] || 0), 0);
    const scale = Math.max(1, s.nominal, used); // overbooked: the bar grows past the 100 % mark
    const w = (h) => `${(Math.max(0, h) / scale) * 100}%`;
    // split across teams (UC-14): the share in this team; the bar and the numbers below stay the whole person
    const teamH = r.pct != null ? (s.weekly * r.pct) / 100 : null;
    const shareTip = r.pct != null ? tip(infoCard({
      title: tr(`Anteil im Team ${r.pct} %`, `Share in team ${r.pct} %`),
      text: tr('Die Person arbeitet in mehreren Teams. Teamsummen zählen nur diesen Anteil; ihre eigene Auslastung unten gilt über alle Teams.', 'This person works in several teams. Team totals count only this share; their own load below covers all teams.'),
      calc: `${fmt.n(s.weekly)} h × ${r.pct} % = ${fmt.n(teamH, 1)} h/${tr('Woche', 'week')}`,
    })) : null;
    // not part of this team (boss feedback 2026-11-17): a person outside the team, or one whose team is not maintained at all,
    // who still has this team's stories – clearly marked, with the stories and the ways out
    const outside = board.kind === 'people' && (r.member === 'outside' || r.member === 'unmaintained') ? r.member : null;
    const keys = outside ? [...new Set(r.cells.flatMap((c) => (c.cards || []).filter((x) => x.kind === 'task' && x.key).map((x) => x.key)))] : [];
    const outsideTip = outside ? tip(infoCard({
      title: outside === 'outside' ? tr(`${r.name || 'Person'} ist nicht im Team`, `${r.name || 'Person'} is not in the team`) : tr(`${r.name || 'Person'} ist keinem Team zugeordnet`, `${r.name || 'Person'} is in no team`),
      text: outside === 'outside' && r.memberSrc === 'atlassian'
        ? tr('Ist laut Atlassian Teams kein Mitglied dieses Teams, hat aber Stories des Teams. Die Stunden zählen hier als Bedarf und belasten trotzdem die Zeit, die in den eigenen Teams eingeplant ist.', "Not a member of this team according to Atlassian Teams, but has stories of the team. The hours count as demand here and still use time planned in the person's own teams.")
        : outside === 'outside'
          ? tr(`Gehört laut Kapazitäten zu ${teamName(r.teamId) || 'einem anderen Team'}, hat aber Stories dieses Teams. Die Stunden zählen hier als Bedarf und belasten trotzdem die Zeit, die dort eingeplant ist.`, `Belongs to ${teamName(r.teamId) || 'another team'} by capacity, but has stories of this team. The hours count as demand here and still use time planned there.`)
          : tr('Für diese Person ist keine Kapazität gepflegt – sie gehört formal zu keinem Team; gerechnet wird mit Standardwerten.', 'No capacity is maintained for this person – formally in no team; the cockpit uses default values.'),
      ...(keys.length ? { itemsTitle: tr('Stories dieses Teams', "This team's stories"), items: keys.slice(0, 8).map((k) => ({ text: k })) } : {}),
      hint: r.memberSrc === 'atlassian'
        ? tr('Lösen: die Person in Atlassian Teams ins Team aufnehmen, jemanden aus dem Team zuweisen oder die Story dem Team der Person geben.', "Fix: add the person to the team in Atlassian Teams, assign someone from the team, or give the story to the person's team.")
        : tr('Lösen: unter „Kapazitäten pflegen“ ins Team holen, jemanden aus dem Team zuweisen oder die Story dem Team der Person geben.', "Fix: add to the team under “Maintain capacities”, assign someone from the team, or give the story to the person's team."),
    })) : null;
    return (
      <div className={`wb-rowhead${outside ? ' is-outside' : ''}`} role="rowheader">
        <div className="wb-who">
          <Avatar user={{ id: r.accountId, name: r.name }} size={28} />
          <div>
            <span className="wb-name-line">
              <span className="wb-name">{r.name || tr('Person', 'Person')}{r.derived ? <span className="faint" title={tr('Standardwerte – noch nicht gepflegt', 'Default values – not maintained yet')}> *</span> : null}</span>
              {outside && <span className={`wb-outside ${outside}`} tabIndex={0} {...outsideTip}><Icon name="alert" size={11} />{outside === 'outside' ? tr('Nicht im Team', 'Not in team') : tr('Kein Team', 'No team')}</span>}
              {r.pct != null && <span className="wb-share" tabIndex={0} {...shareTip}>{r.pct} %</span>}
            </span>
            <span className="wb-meta">{meta}</span>
          </div>
        </div>
        {board.kind === 'people' ? (
          <>
            {r.pct != null && <div className="wb-share-line" {...shareTip}>{tr(`Anteil im Team ${r.pct} % · ${fmt.n(teamH)} h von ${fmt.n(s.weekly)} h`, `Share in team ${r.pct} % · ${fmt.n(teamH)} h of ${fmt.n(s.weekly)} h`)}</div>}
            <div className={`wb-bar ${s.free < 0 ? 'over' : ''}`} aria-hidden="true">
              {parts.map(([k, , c], i) => (s[k] > 0 ? <i key={k} style={{ width: w(s[k]), background: c, animationDelay: `${i * 60}ms` }} /> : null))}
              {s.free > 0 && <i className="free" style={{ width: w(s.free), animationDelay: `${parts.length * 60}ms` }} />}
              {s.free < 0 && <><b className="wb-bar-over" style={{ left: w(s.nominal), width: w(-s.free) }} /><b className="wb-100" style={{ left: w(s.nominal) }} /></>}
            </div>
            <dl className="wb-split" {...tip(infoCard({
              title: `${r.name} · ${board.weeks.length} ${tr('Wochen', 'weeks')}`,
              text: tr('Wochenstunden minus Abwesenheit, Feiertage, Tagesgeschäft, Support und Projekt-Tasks. Negativ = über der Kapazität.', 'Weekly hours minus absence, holidays, daily business, support and project tasks. Negative = over capacity.'),
              calc: `${fmt.n(s.nominal)} − ${fmt.n(s.off)} − ${fmt.n(s.daily)} − ${fmt.n(s.support)} − ${fmt.n(s.projects)} = ${fmt.n(s.free)} h`,
            }))}>
              <dt>{tr('Wochenstunden', 'Weekly hours')}</dt><dd>{fmt.h(s.nominal)}</dd><dd className="pct">100 %</dd>
              {parts.map(([k, label, c]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt><i style={{ background: c }} />{label}</dt><dd>{s[k] ? `−${fmt.h(s[k])}` : fmt.h(0)}</dd><dd className="pct">{s.pct[k]} %</dd>
                </div>
              ))}
              <dt className={`tot ${s.free < 0 ? 'neg' : ''}`}><i className={s.free < 0 ? 'sw-over' : 'sw-free'} />{s.free < 0 ? tr('Über', 'Over') : tr('Frei', 'Free')}</dt>
              <dd className={`tot ${s.free < 0 ? 'neg' : ''}`}>{s.free < 0 ? `−${fmt.h(-s.free)}` : fmt.h(s.free)}</dd>
              <dd className={`tot pct ${s.free < 0 ? 'neg' : ''}`}>{s.pct.free} %</dd>
            </dl>
          </>
        ) : <span className="wb-total"><b>{fmt.h(r.total)}</b> {tr('in diesem Projekt', 'in this project')}</span>}
        {over}
      </div>
    );
  }
  if (r.kind === 'hidden') {
    return (
      <div className="wb-rowhead" role="rowheader">
        <div className="wb-who"><span className="wb-badge"><Icon name="users" size={14} /></span><div><span className="wb-name">{tr('Weitere Personen (nur Summe)', 'Other people (sum only)')}</span><span className="wb-meta">{r.count} {r.count === 1 ? tr('Person', 'person') : tr('Personen', 'people')}{r.teamId ? ` · ${teamName(r.teamId)}` : ''}</span></div></div>
        <span className="wb-total"><b>{fmt.h(r.total)}</b> {board.kind === 'project' ? tr('in diesem Projekt', 'in this project') : tr(`in ${board.weeks.length} Wochen`, `in ${board.weeks.length} weeks`)}</span>
        {over}
      </div>
    );
  }
  if (r.kind === 'unassigned') {
    return (
      <div className="wb-rowhead" role="rowheader">
        <div className="wb-who"><span className="wb-badge"><Icon name="user" size={14} /></span><div><span className="wb-name">{tr('Nicht zugewiesen', 'Unassigned')}</span><span className="wb-meta">{tr('Tasks ohne Assignee', 'Tasks without an assignee')}</span></div></div>
        {r.total > 0.05 && <span className="wb-total"><b>{fmt.h(r.total)}</b> {tr(`in ${board.weeks.length} Wochen`, `in ${board.weeks.length} weeks`)}</span>}
      </div>
    );
  }
  if (r.kind === 'support') {
    return (
      <div className="wb-rowhead" role="rowheader">
        <div className="wb-who"><span className="wb-badge sup">S</span><div><span className="wb-name">Support</span><span className="wb-meta">{tr('Vorrang vor allen Projekten', 'Comes before all projects')}</span></div></div>
        <span className="wb-total"><b>{fmt.h(r.total)}</b> {tr(`in ${board.weeks.length} Wochen`, `in ${board.weeks.length} weeks`)}</span>
      </div>
    );
  }
  if (r.kind === 'projectRow') {
    return (
      <div className="wb-rowhead" role="rowheader">
        <div className="wb-who">
          <span className="wb-badge" style={{ boxShadow: `inset 3px 0 0 ${projectColor(r.color)}` }}>{r.rank ?? '–'}</span>
          <div><span className="wb-name">{r.name}</span><span className="wb-meta">{r.rank != null ? tr(`Rang ${r.rank}`, `Rank ${r.rank}`) : tr('ohne Rang', 'no rank')}{r.key ? ` · ${r.key}` : ''}</span></div>
        </div>
        <span className="wb-total"><b>{fmt.h(r.total)}</b> {tr(`in ${board.weeks.length} Wochen`, `in ${board.weeks.length} weeks`)}</span>
        {over}
      </div>
    );
  }
  // team (all teams)
  return (
    <div className="wb-rowhead" role="rowheader">
      <div className="wb-who"><span className="wb-badge"><Icon name="users" size={14} /></span><div><span className="wb-name">{r.name}</span><span className="wb-meta">{r.members} {r.members === 1 ? tr('Person', 'person') : tr('Personen', 'people')} · {fmt.h(r.weekly)}/{tr('Woche', 'week')}</span></div></div>
      <span className="wb-total"><b>{fmt.h(r.total)}</b> {tr(`Tasks in ${board.weeks.length} Wochen`, `tasks in ${board.weeks.length} weeks`)}</span>
      {over}
      {onOpenTeam && <button type="button" className="btn btn-xs" style={{ alignSelf: 'flex-start' }} onClick={() => onOpenTeam(r.teamId)}>{tr('Team öffnen', 'Open team')}<Icon name="arrowRight" size={12} /></button>}
    </div>
  );
}

// a person week with planned hours but no available time (absence, holidays, no capacity): never '∞' – a readable conflict
// (tester 2026-11-17: "0 h available or absence", highlighted like a conflict)
function noTime(r, c) { return (r.kind === 'person' || r.kind === 'hidden') && !(c.avail > 0.05) && (board0(c) > 0.05); }
const board0 = (c) => Math.max(c.load || 0, c.own || 0);
const noTimeText = (c) => (c.absent > 0 || c.holidays > 0 ? tr('0 h verfügbar · abwesend', '0 h available · absent') : tr('0 h verfügbar', '0 h available'));

function CellHead({ r, c, w, board, tip, onWhy }) {
  const wk = `${fmt.week(w.from)} · ${dm(w.from)} – ${dm(w.to)}`;
  const taskItems = c.cards.filter((k) => k.kind === 'task').map((k) => ({ text: `${k.key} ${k.summary || ''}`, sub: `${hrs(k.hours)}${k.project ? ` · ${k.project}` : ''}${k.assigneeName && r.kind !== 'person' ? ` · ${k.assigneeName}` : ''}`, tone: k.conflict ? 'bad' : k.pending ? 'warn' : 'ok' }));
  let cls = 't-none', body = null, card = null;
  if (r.kind === 'person') {
    const off = c.days === 0 && (c.absent > 0 || c.holidays > 0);
    const own = board.kind === 'project' ? c.own : c.load;
    const fit = fitOf(c.load, c.avail);
    const plain = !noTime(r, c) && c.load > 0.05; // words + bar (boss 2026-11-20), the percentage stays small
    cls = (noTime(r, c) ? 't-bad t-notime' : off && !own ? 't-off' : c.load > 0.05 ? `t-${c.tone || 'ok'}` : 't-none') + (plain ? ' fit' : '');
    body = off && c.load <= 0.05 ? <span>{tr('abwesend', 'absent')}</span>
      : board.kind === 'project'
        ? <><span>{c.own > 0.05 ? hrs(c.own) : '–'}</span>{noTime(r, c) ? <b>{noTimeText(c)}</b> : plain ? <><FitWords fit={fit} /><FitBar fit={fit} /></> : <b />}</>
        : c.load <= 0.05 ? <span>{hrs(c.avail)} {tr('frei', 'free')}</span> : noTime(r, c) ? <><span>{fmt.n(c.load)} / {hrs(c.avail)}</span><b>{noTimeText(c)}</b>{onWhy && <WhyOverButton onOpen={onWhy} />}</> : <><FitWords fit={fit} />{pctTag(c.util)}<FitBar fit={fit} />{fit.kind === 'over' && onWhy && <WhyOverButton onOpen={onWhy} />}</>;
    card = infoCard({
      title: `${r.name} · ${wk}`,
      sub: board.kind === 'project' ? tr('Stunden in diesem Projekt · Auslastung über alles', 'Hours in this project · utilization over everything') : null,
      calc: noTime(r, c) ? `${fmt.n(c.load, 1)} h ${tr('geplant', 'planned')} · 0 h ${tr('verfügbar', 'available')}` : `(${fmt.n(c.support, 1)} + ${fmt.n(c.tasks, 1)}) ÷ ${fmt.n(c.avail, 1)} = ${pct(c.util)}`,
      ...(noTime(r, c) ? { text: tr('Konflikt: In dieser Woche ist keine Zeit verfügbar – die geplanten Stunden passen hier nicht. Lotse schlägt oben eine Verschiebung vor.', 'Conflict: no time is available this week – the planned hours do not fit here. Lotse suggests a move above.') }
        : c.load > 0.05 ? { text: `${fitSentence(fit, null, hCalc)} ${tr('Immer die ganze Person: alle ihre Aufgaben gegen ihre Zeit für Projekte – dieselbe Zahl in Meine Arbeit, Teams und Wochenplanung.', 'Always the whole person: all their tasks against their time for projects – the same number in My work, Teams and Weekly planning.')}` } : {}),
      inputs: [
        [tr('Wochenstunden', 'Weekly hours'), fmt.h(r.summary.weekly)],
        ...(c.holidays ? [[tr('Feiertage', 'Public holidays'), String(c.holidays)]] : []),
        ...(c.absent ? [[tr('Abwesend (Tage)', 'Absent (days)'), String(c.absent)]] : []),
        [tr('Verfügbar', 'Available'), fmt.h(c.avail, 1)],
        ['Support', fmt.h(c.support, 1)],
        [tr('Tasks', 'Tasks'), fmt.h(c.tasks, 1)],
        ...(c.other > 0.05 ? [[board.kind === 'project' ? tr('davon andere Projekte', 'of which other projects') : tr('davon andere Teams', 'of which other teams'), fmt.h(c.other, 1)]] : []),
      ],
      items: taskItems, itemsTitle: board.kind === 'project' ? tr('Tasks in diesem Projekt', 'Tasks in this project') : tr('Tasks dieser Woche', 'Tasks this week'),
      hint: tr('Original Estimate gleichmäßig auf die Arbeitstage zwischen Start und Due date verteilt.', 'Original estimate spread evenly over the working days between start and due date.'),
    });
  } else if (r.kind === 'hidden') {
    const own = board.kind === 'project' ? c.own : c.load;
    cls = own > 0.05 || c.load > 0.05 ? `t-${c.tone || 'ok'}` : 't-none';
    body = board.kind === 'project'
      ? <><span>{c.own > 0.05 ? hrs(c.own) : '–'}</span><b>{noTime(r, c) ? noTimeText(c) : c.load > 0.05 ? `${tr('ges.', 'total')} ${pct(c.util)}` : ''}</b></>
      : c.load <= 0.05 ? <span>{hrs(c.avail)} {tr('frei', 'free')}</span> : <><span>{fmt.n(c.load)} / {hrs(c.avail)}</span><b>{noTime(r, c) ? noTimeText(c) : pct(c.util)}</b></>;
    card = infoCard({
      title: `${tr('Weitere Personen', 'Other people')} · ${wk}`,
      text: tr('Summe der Personen außerhalb deiner Sichtbarkeit (UC-08) – ohne Namen und Einzelwerte.', 'Sum of the people outside what you may see (UC-08) – no names, no individual values.'),
      calc: `(${fmt.n(c.support, 1)} + ${fmt.n(c.tasks, 1)}) ÷ ${fmt.n(c.avail, 1)} = ${pct(c.util)}`,
    });
  } else if (r.kind === 'unassigned') {
    body = c.load > 0.05 ? <span>{hrs(c.load)}</span> : null;
    if (taskItems.length) card = infoCard({ title: `${tr('Nicht zugewiesen', 'Unassigned')} · ${wk}`, items: taskItems, itemsTitle: tr('Tasks', 'Tasks') });
  } else if (r.kind === 'support') {
    cls = c.load > 0.05 ? 't-sup' : 't-none';
    body = <span>{hrs(c.load)}</span>;
    card = infoCard({
      title: `Support · ${wk}`, text: tr('Ø Time Spent der Support-Tickets je Person, nur an Tagen, an denen sie da ist. Zählt vor allen Projekten.', 'Average time spent on support tickets per person, only on days they are in. Comes before all projects.'),
      items: (c.cards[0]?.people || []).map((p) => ({ text: p.hidden ? tr('Weitere Personen', 'Other people') : p.name, sub: hrs(p.hours), tone: 'ok' })), itemsTitle: tr('Personen', 'People'),
    });
  } else if (r.kind === 'projectRow') {
    cls = c.noCapacity ? 't-bad' : c.load > 0.05 ? `t-${c.tone || 'ok'}` : 't-none';
    const fit = fitOf(c.load, c.avail);
    if (c.load > 0.05 && !c.noCapacity) cls += ' fit';
    body = c.load <= 0.05 ? <span>–</span> : c.noCapacity
      ? <><span>{hrs(c.load)}</span><b>{tr('keine Kapazität', 'no capacity')}</b>{onWhy && <WhyOverButton onOpen={onWhy} />}</>
      : <><FitWords fit={fit} />{pctTag(c.util)}<FitBar fit={fit} />{fit.kind === 'over' && onWhy && <WhyOverButton onOpen={onWhy} />}</>;
    card = infoCard({
      title: `${r.name} · ${wk}`,
      text: `${c.load > 0.05 && !c.noCapacity ? `${fitSentence(fit, tr('Zeit des Teams', 'the team\'s time'), hCalc)} ` : ''}${tr('Gerechnet gegen die Zeit des Teams nach Support und den Projekten mit höherem Rang. Wer auch in anderen Teams ist, bringt seinen Anteil mit – und dazu, was die anderen Teams in dieser Woche nicht brauchen. Darum steht hier dieselbe Überlast wie bei der Person selbst. „Warum?“ zeigt die Rechnung.', 'Counted against the team\'s time after support and the higher-ranked projects. Someone also in other teams brings their share – plus what the other teams do not need this week. So the overload here is the same as the person\'s own. "Why?" shows the calculation.')}`,
      inputs: [[tr('Noch verfügbar', 'Still available'), fmt.h(c.avail, 1)], [tr('Tasks dieses Projekts', 'Tasks of this project'), fmt.h(c.load, 1)], [tr('Auslastung', 'Utilization'), pct(c.util)]],
      items: taskItems, itemsTitle: tr('Tasks', 'Tasks'),
    });
  } else {
    cls = c.load > 0.05 || c.avail > 0.05 ? `t-${c.tone || 'ok'}` : 't-none';
    // a team without capacity: "–" and why (never "∞")
    const noCap = !(c.avail > 0.05);
    const fit = fitOf(c.load, c.avail);
    if (!noCap && c.load > 0.05) cls += ' fit';
    body = !noCap && c.load <= 0.05 ? <span>{hrs(c.avail)} {tr('frei', 'free')}</span> : noCap || c.load <= 0.05 ? <><span>{fmt.n(c.load)} / {hrs(c.avail)}</span><b title={noCap ? noCapacityReason(c.load, getLang()) : undefined}>{noCap ? NO_CAP_TEXT : pct(c.util)}</b></> : <><FitWords fit={fit} />{pctTag(c.util)}<FitBar fit={fit} />{fit.kind === 'over' && onWhy && <WhyOverButton onOpen={onWhy} />}</>;
    card = infoCard({
      title: `${r.name} · ${wk}`, calc: noCap ? `${fmt.n(c.load, 1)} h – ${noCapacityReason(c.load, getLang())}` : `${fmt.n(c.load, 1)} ÷ ${fmt.n(c.avail, 1)} = ${pct(c.util)}`,
      text: `${tr('Support plus Tasks des Teams gegen die Zeit seiner Personen nach Urlaub, Feiertagen und Tagesgeschäft. Wer auch in anderen Teams ist, zählt mit seinem Anteil – und dem, was die anderen Teams in dieser Woche nicht brauchen.', 'Support plus the team\'s tasks against its people\'s time after leave, holidays and daily business. Someone also in other teams counts with their share – plus what the other teams do not need this week.')}${c.guests > 0.05 ? tr(` ${fmt.n(c.guests, 1)} h davon von Personen außerhalb des Teams.`, ` ${fmt.n(c.guests, 1)} h of it by people outside the team.`) : ''}`,
      items: c.cards.map((k) => ({ text: k.hidden ? `${tr('Weitere', 'Others')} (${k.count})` : k.pct != null ? `${k.name} · ${tr('Anteil', 'share')} ${k.pct} %` : k.name, sub: `${fmt.n(k.load, 1)} / ${fmt.h(k.avail, 1)} · ${pct(k.util)}`, tone: k.tone || 'ok' })), itemsTitle: tr('Personen', 'People'),
    });
  }
  if (!body) return <div className="wb-head t-none" aria-hidden="true" />;
  return <div className={`wb-head ${cls}`} tabIndex={card ? 0 : undefined} {...(card ? tip(card) : {})}>{body}</div>;
}

function AbsenceNote({ r, c }) {
  if (r.kind === 'person') {
    if (!c.absent && !c.holidays) return null;
    const t = [
      c.absent ? tr(`${c.absent} ${c.absent === 1 ? 'Tag' : 'Tage'} abwesend`, `${c.absent} ${c.absent === 1 ? 'day' : 'days'} absent`) : null,
      c.holidays ? tr(`${c.holidays} ${c.holidays === 1 ? 'Feiertag' : 'Feiertage'}`, `${c.holidays} ${c.holidays === 1 ? 'holiday' : 'holidays'}`) : null,
    ].filter(Boolean).join(' · ');
    return <div className="wb-abs"><Icon name="calendar" size={11} />{t}</div>;
  }
  if (r.kind === 'team' && c.absentPeople?.length) {
    return <div className="wb-abs"><Icon name="calendar" size={11} />{c.absentPeople.slice(0, 3).map((p) => `${String(p.name).split(' ')[0]} ${p.absent + p.holidays} ${tr('T', 'd')}`).join(' · ')}{c.absentPeople.length > 3 ? ' …' : ''}</div>;
  }
  return null;
}

// ---------- cards ----------
// the hovered task's other parts on the board light up (tester: "with the current part highlighted")
function siblings(el, id, on) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(id))) return;
  el.closest('.wb')?.querySelectorAll(`[data-card^="${id}:"]`).forEach((x) => { if (x !== el) x.classList.toggle('sib', on); });
}
function TaskCard({ k, week, board, canDrag, drag, tip, openMenu, shift, first }) {
  const fill = board.taskById.get(k.id)?.fill;
  const who = k.hidden ? otherPerson() : k.assigneeName || nobody();
  const hot = board.kind === 'projects' && k.whoUtil > 1.0001;
  const sub = board.kind === 'people' ? k.project
    : board.kind === 'projects' ? `${who}${hot ? ` · ${k.whoUtil === Infinity ? tr('abwesend', 'absent') : `${pct(k.whoUtil)} ${tr('ausgelastet', 'loaded')}`}` : ''}`
      : null;
  // start after due (tester 2026-11-17): flagged on the card, not silently planned
  const inverted = datesInverted({ start: k.start, due: k.due });
  const label = tr(
    `${k.key} ${k.summary || ''}, ${hrs(k.hours)} in ${fmt.week(board.weeks[week].from)}, Woche ${k.idx} von ${k.len}, ${k.project}, ${who}${k.pending ? ', geändert, noch nicht in Jira' : ''}${k.conflict ? ', Konflikt' : ''}${inverted ? ', Start nach Due' : ''}`,
    `${k.key} ${k.summary || ''}, ${hrs(k.hours)} in ${fmt.week(board.weeks[week].from)}, week ${k.idx} of ${k.len}, ${k.project}, ${who}${k.pending ? ', changed, not in Jira yet' : ''}${k.conflict ? ', conflict' : ''}${inverted ? ', start after due' : ''}`);
  return (
    <div className={`wb-card task ${k.pending ? 'pending' : ''} ${k.conflict || inverted ? 'conflict' : ''} ${canDrag ? '' : 'ro'}`} style={{ '--pc': projectColor(k.color) }}
      role="button" tabIndex={0} aria-haspopup="menu" aria-label={label} data-card={`${k.id}:${week}`}
      {...tip(infoCard({
        title: `${k.key} · ${k.summary || ''}`,
        sub: `${k.project}${k.pending ? ` · ${tr('geändert, noch nicht in Jira', 'changed, not in Jira yet')}` : ''}`,
        inputs: [
          ['Assignee', who], ['Start', dm(k.start)], ['Due', dm(k.due)], ['Original Estimate', fmt.h(k.oe, 1)],
          [tr('In dieser Woche', 'This week'), `${fmt.h(k.hours, 1)}${k.len > 1 ? ` · ${k.idx}/${k.len}` : ''}`],
          ...(k.finish && (k.finish.overflow || k.finish.early > 0) ? [[tr('Nach Kapazität', 'By capacity'), finishText(k.finish)]] : []),
        ],
        text: k.byCapacity || k.forcedEven ? `⇄ ${reasonLine(fill)}` : null,
        // the whole task at a glance (tester 2026-11-17): every part with its hours, this one highlighted – "1/10" explains itself
        ...(k.len > 1 ? { partsTitle: tr('Alle Teile dieser Aufgabe', 'All parts of this task'), parts: () => {
          const t = board.taskById.get(k.id);
          const list = taskParts(t);
          const here = board.weeks[week].from;
          const total = list.reduce((a, p) => a + p.hours, 0);
          return [{ label: tr(`${list.length} Teile`, `${list.length} parts`), value: `${fmt.h(total, 1)}${k.due ? ` · Due ${dm(k.due)}` : ''}` }].concat(
            list.map((p) => ({ label: `${fmt.week(p.monday)}${p.late ? tr(' · nach Due', ' · after due') : ''}`, value: fmt.h(p.hours, 1), on: p.monday === here, late: p.late })));
        } } : {}),
        hint: inverted ? tr(`Start (${dm(k.start)}) liegt nach dem Due Date (${dm(k.due)}) – die Planung bucht alle Stunden in die Due-Woche. Termine in Jira korrigieren oder die Karte verschieben (dreht die Termine richtig herum).`, `Start (${dm(k.start)}) is after the due date (${dm(k.due)}) – planning books every hour into the due week. Fix the dates in Jira or move the card (puts the dates in the right order).`)
          : k.conflict ? tr('Konflikt mit einer Blocks-Abhängigkeit – siehe oben.', 'Conflict with a blocks dependency – see above.')
          : canDrag ? tr('Ziehen verschiebt Woche oder Person · Klick oder Enter: Menü', 'Drag to change week or person · click or Enter: menu') : tr('Klick: in Jira öffnen', 'Click: open in Jira'),
      }))}
      onMouseEnter={(e) => siblings(e.currentTarget, k.id, true)} onMouseLeave={(e) => siblings(e.currentTarget, k.id, false)}
      onPointerDown={(e) => drag.down(e, { id: k.id, week, key: k.key })}
      onClick={(e) => openMenu(e.currentTarget, k, week)}
      onContextMenu={(e) => { if (drag.isTouchHold()) e.preventDefault(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); openMenu(e.currentTarget, k, week); }
        else if (canDrag && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); shift(k, week, e.key === 'ArrowLeft' ? -1 : 1); }
      }}>
      <div className="wb-top"><span className="wb-key">{k.key}</span><span className="wb-h">{hrs(k.hours)}{k.len > 1 ? ` · ${k.idx}/${k.len}` : ''}</span></div>
      {first && inverted && <div className="wb-inv" data-inverted><Icon name="alert" size={10} />{tr('Start nach Due', 'Start after due')}</div>}
      {first && (k.byCapacity || k.forcedEven) && <div className={`wb-capm ${k.forcedEven ? 'even' : ''}`}>{k.forcedEven ? tr('= gleichmäßig', '= even') : tr('⇄ nach Kapazität', '⇄ by capacity')}</div>}
      <div className="wb-sum">{k.summary}</div>
      {sub ? <div className={`wb-sub ${hot ? 'hot' : ''}`}>{sub}</div> : null}
      {k.last && k.finish && !k.finish.overflow && k.finish.early > 0 && (
        <div className="wb-fin"><Icon name="check" size={10} />{tr(`fertig · ${k.finish.early} Wo. früher`, `done · ${k.finish.early} wk early`)}</div>
      )}
    </div>
  );
}
function GhostCard({ k }) {
  return (
    <div className="wb-card ghost" style={{ '--pc': projectColor(k.color) }} aria-hidden="true">
      <div className="wb-top"><span className="wb-key">{k.key}</span><span className="wb-h">{hrs(k.hours)}</span></div>
      <div className="wb-sum">{k.summary}</div>
    </div>
  );
}
function InfoCardMini({ k, board, teamName, tip }) {
  if (k.kind === 'support') {
    return (
      <div className="wb-card sup" {...tip(infoCard({ title: 'Support', text: tr('Support-Anteil laut Support-Auswertung (Ø Time Spent je Woche). Zählt vor allen Projekten und lässt sich nicht verschieben.', 'Support share from the support analysis (average time spent per week). Comes before all projects and cannot be moved.') }))}>
        <div className="wb-top"><b>Support</b><span className="wb-h">{hrs(k.hours)}</span></div>
        <div className="wb-sub">{k.people?.length ? k.people.map((p) => `${p.hidden ? tr('Weitere', 'Others') : initials(p.name)} ${fmt.n(p.hours)}`).join(' · ') : tr('Vorrang vor Projekten', 'Before projects')}</div>
      </div>
    );
  }
  if (k.kind === 'hiddenSum') {
    return (
      <div className="wb-card other" {...tip(infoCard({ title: tr('Weitere Personen (nur Summe)', 'Other people (sum only)'), text: tr('Personen außerhalb deiner Sichtbarkeit: nur die Summe ihrer Tasks, ohne Namen. Ihre Tasks lassen sich hier nicht verschieben.', 'People outside what you may see: only the sum of their tasks, without names. Their tasks cannot be moved here.') }))}>
        <div className="wb-top"><span>{k.count} {k.count === 1 ? 'Task' : 'Tasks'}</span><span className="wb-h">{hrs(k.hours)}</span></div>
      </div>
    );
  }
  if (k.kind === 'other') {
    const names = (k.teams || []).map(teamName).filter(Boolean);
    return (
      <div className="wb-card other" {...tip(infoCard({ title: tr('Andere Teams', 'Other teams'), text: tr('Tasks dieser Person in anderen Teams. Sie zählen in ihre Auslastung, werden aber dort geplant.', 'This person\'s tasks in other teams. They count towards the load but are planned there.') }))}>
        <div className="wb-top"><span>{tr('Andere Teams', 'Other teams')}</span><span className="wb-h">{hrs(k.hours)}</span></div>
        {names.length ? <div className="wb-sub">{names.join(' · ')}</div> : null}
      </div>
    );
  }
  // member (all teams)
  return (
    <div className={`wb-card member t-${k.tone || 'none'}`}>
      <span>{k.hidden ? `${tr('Weitere', 'Others')} (${k.count})` : String(k.name || '').split(' ')[0] || '–'}{k.pct != null && <i className="wb-share">{k.pct} %</i>}</span>
      <b>{(k.personAvail ?? k.avail) > 0.05 ? (Math.round((k.util || 0) * 100) >= 1 ? pct(k.util) : tr('frei', 'free')) : k.load > 0.05 ? '∞' : tr('abwesend', 'absent')}</b>
    </div>
  );
}

// ---------- menu: keyboard (and click) alternative to dragging ----------
function CardMenu({ menu, board, canEdit, pending, teamName, faster, onFaster, fill, canToggle, onWhy, onToggleEven, onClose, onShift, onAssign, onDiscard, onOpen }) {
  const ref = useRef(null);
  const [view, setView] = useState('main');
  const [q, setQ] = useState('');
  const [pos, setPos] = useState({ left: menu.rect.left, top: menu.rect.bottom + 6, visibility: 'hidden' });
  const c = menu.card;
  const t = board.taskById.get(c.id);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, menu.rect.left));
    let top = menu.rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, menu.rect.top - h - 6);
    setPos({ left, top });
  }, [menu, view]);
  useEffect(() => { ref.current?.querySelector('input, button:not(:disabled)')?.focus(); }, [view]);
  useEffect(() => {
    const h = (e) => { if (!ref.current?.contains(e.target)) onClose(false); };
    const s = () => onClose(false);
    window.addEventListener('pointerdown', h, true);
    window.addEventListener('resize', s);
    return () => { window.removeEventListener('pointerdown', h, true); window.removeEventListener('resize', s); };
  }, [onClose]);
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (view !== 'main') setView('main'); else onClose(true); return; }
    if (e.key === 'Tab') { e.preventDefault(); onClose(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...ref.current.querySelectorAll('button:not(:disabled)')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  };
  // who has room (tester 2026-11-17: "Change person shows only the team – hard to pick who should take it"): each
  // person's peak load in this task's weeks once they have it; the task's team first, then the most room
  const inTaskTeam = (pid) => !t?.teamId || board.inTeamOf(pid, t.teamId);
  const cands = board.candidates
    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
    .map((p) => ({ ...p, imp: assignImpact(board, c.id, p.id, c.assignee) }))
    .sort((a, b) => (inTaskTeam(b.id) - inTaskTeam(a.id)) || ((a.imp?.peak1 ?? 0) - (b.imp?.peak1 ?? 0)) || a.name.localeCompare(b.name, 'de'))
    .slice(0, 60);
  const pick = (pid) => (pid === c.assignee ? setView('main') : pid && t?.teamId && board.personTeam(pid) && !inTaskTeam(pid) ? setView({ confirm: pid }) : onAssign(pid));
  const conf = view?.confirm ? board.candidates.find((p) => p.id === view.confirm) : null;
  const confImp = conf ? assignImpact(board, c.id, conf.id, c.assignee) : null;
  const confTeam = conf ? board.personTeam(conf.id) : null;
  return createPortal(
    <div ref={ref} className="wb-menu" role="menu" aria-label={`${c.key} ${c.summary || ''}`} style={pos} onKeyDown={onKey}>
      <div className="wb-menu-head"><span className="wb-key">{c.key} · {hrs(c.hours)}</span><span className="wb-sum">{c.summary}</span></div>
      {conf ? (
        <div className="wb-confirm" data-assign-confirm>
          <p>{tr(`${conf.name} ist nicht im Team ${teamName(t.teamId)}, zu dem die Aufgabe gehört – sondern in ${teamName(confTeam)}.`, `${conf.name} is not in team ${teamName(t.teamId)}, which the task belongs to – but in ${teamName(confTeam)}.`)}</p>
          {confImp?.over.length ? <p className="wb-warn">{tr(`Damit in ${confImp.over.length} ${confImp.over.length === 1 ? 'Woche' : 'Wochen'} über 100 % (${weekRange(confImp.over)}, bis ${loadText(confImp.peak1)}).`, `Then above 100 % in ${confImp.over.length} ${confImp.over.length === 1 ? 'week' : 'weeks'} (${weekRange(confImp.over)}, up to ${loadText(confImp.peak1)}).`)}</p>
            : confImp ? <p className="faint">{tr(`Danach höchstens ${loadText(confImp.peak1)} ausgelastet.`, `Then at most ${loadText(confImp.peak1)} loaded.`)}</p> : null}
          <button type="button" role="menuitem" className="menu-item" onClick={() => onAssign(conf.id, { team: confTeam, teamName: teamName(confTeam) })}><Icon name="users" size={14} />{tr(`Zuweisen und Team auf ${teamName(confTeam)} ändern`, `Assign and change the team to ${teamName(confTeam)}`)}</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => onAssign(conf.id)}><Icon name="user" size={14} />{tr(`Nur zuweisen – Team bleibt ${teamName(t.teamId)}`, `Assign only – team stays ${teamName(t.teamId)}`)}</button>
          <button type="button" className="menu-item" onClick={() => setView('people')}><Icon name="arrowRight" size={14} style={{ transform: 'scaleX(-1)' }} />{tr('Zurück', 'Back')}</button>
        </div>
      ) : view === 'main' ? (
        <>
          {canEdit && (
            <>
              {faster && !pending && (
                <button type="button" role="menuitem" className="menu-item wb-menu-faster" onClick={() => onFaster(faster)}>
                  <Icon name={MODE[faster.mode]?.icon || 'sparkle'} size={14} /><span className="grow">{menuLabel(faster)}</span>
                </button>
              )}
              <button type="button" role="menuitem" className="menu-item" onClick={() => onShift(-1)}><Icon name="arrowRight" size={14} style={{ transform: 'scaleX(-1)' }} />{tr('1 Woche früher', '1 week earlier')}<span className="faint">Alt ←</span></button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => onShift(1)}><Icon name="arrowRight" size={14} />{tr('1 Woche später', '1 week later')}<span className="faint">Alt →</span></button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => setView('people')}><Icon name="user" size={14} />{tr('Person ändern …', 'Change person …')}<span className="faint">{c.assigneeName ? initials(c.assigneeName) : '–'}</span></button>
              {pending && <button type="button" role="menuitem" className="menu-item" onClick={onDiscard}><Icon name="undo" size={14} />{tr('Änderung verwerfen', 'Discard change')}</button>}
            </>
          )}
          {fill && <button type="button" role="menuitem" className="menu-item" onClick={onWhy}><span className="wb-menu-glyph" aria-hidden="true">⇄</span>{tr('Warum diese Stunden?', 'Why these hours?')}</button>}
          {fill && canToggle && (fill.forced || fill.why.weeks.some((x) => Math.abs(x.hours - fill.why.evenShare) > 0.05)) && (
            <button type="button" role="menuitem" className="menu-item" onClick={() => onToggleEven(!fill.forced)}><Icon name={fill.forced ? 'sparkle' : 'undo'} size={14} />{fill.forced ? tr('Wieder nach Kapazität verteilen', 'Split by capacity again') : tr('Für diese Aufgabe gleichmäßig verteilen', 'Split this task evenly')}</button>
          )}
          <button type="button" role="menuitem" className="menu-item" onClick={onOpen}><Icon name="external" size={14} />{tr('In Jira öffnen', 'Open in Jira')}</button>
        </>
      ) : (
        <>
          <button type="button" className="menu-item" onClick={() => setView('main')}><Icon name="arrowRight" size={14} style={{ transform: 'scaleX(-1)' }} />{tr('Zurück', 'Back')}</button>
          {board.candidates.length > 8 && <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Person suchen', 'Find person')} aria-label={tr('Person suchen', 'Find person')} />}
          <div className="wb-menu-list" role="group" aria-label={tr('Person wählen', 'Choose person')}>
            {cands.map((p) => (
              <button key={p.id} type="button" role="menuitemradio" aria-checked={p.id === c.assignee} className="menu-item wb-cand" onClick={() => pick(p.id)}
                aria-label={`${p.name}, ${teamName(p.teamId)}${p.imp ? `, ${tr('danach', 'then')} ${loadText(p.imp.peak1)}` : ''}`}>
                <Avatar user={p} size={20} />
                <span className="grow wb-cand-n"><span>{p.name}</span><span className="faint">{teamName(p.teamId)}{!inTaskTeam(p.id) ? tr(' · anderes Team', ' · other team') : ''}</span></span>
                {p.id === c.assignee ? <Icon name="check" size={14} /> : p.imp ? <span className={`wb-cand-load ${loadTone(p.imp.peak1)}`} title={tr(`In den Wochen dieser Aufgabe: jetzt bis ${loadText(p.imp.peak0)}, danach bis ${loadText(p.imp.peak1)}`, `In this task's weeks: now up to ${loadText(p.imp.peak0)}, then up to ${loadText(p.imp.peak1)}`)}>{loadText(p.imp.peak1)}</span> : null}
              </button>
            ))}
            <button type="button" role="menuitemradio" aria-checked={!c.assignee} className="menu-item" onClick={() => pick(null)}>
              <span className="avatar" style={{ width: 20, height: 20 }}><Icon name="user" size={11} /></span>{tr('Nicht zugewiesen', 'Unassigned')}
            </button>
          </div>
        </>
      )}
    </div>, document.body);
}

// ---------- blocks conflicts on the pending dates ----------
// ---------- suggestions for red weeks (shared/planSuggest.js) ----------
// "KW 52" or "KW 52–53" for a list of Mondays (ISO)
// What taking over a task means for a person, in the task's board weeks: peak load now and after (their other work
// from every team included), and the weeks that end above 100 %. prev = the current assignee (adds nothing).
function assignImpact(board, taskId, pid, prev) {
  const t = board?.taskById.get(taskId);
  if (!t || !pid || !board.personWeeks) return null;
  const used = t.hours.map((h, i) => (h > 0.05 ? i : -1)).filter((i) => i >= 0);
  if (!used.length) return null;
  const wk = board.personWeeks(pid);
  const u = (load, avail) => (avail > 0.05 ? load / avail : load > 0.05 ? Infinity : 0);
  let peak0 = 0, peak1 = 0;
  const over = [];
  for (const i of used) {
    const add = pid === prev ? 0 : t.hours[i];
    const a = u(wk[i].load, wk[i].avail), b = u(wk[i].load + add, wk[i].avail);
    peak0 = Math.max(peak0, a); peak1 = Math.max(peak1, b);
    if (b > 1.005) over.push(board.weeks[i].from);
  }
  return { peak0, peak1, over };
}
const loadText = (x) => (x === Infinity ? tr('keine Zeit', 'no time') : fmt.pct(x));
const loadTone = (x) => (x > 1.005 ? 'bad' : x > 0.85 ? 'warn' : 'ok');
function weekRange(mondays) {
  const l = [...new Set(mondays)].sort();
  if (!l.length) return '';
  if (l.length === 1 || l[0] === l[l.length - 1]) return fmt.week(l[0]);
  // same year: "KW 47–49"; across the new year: "KW 52 – KW 1"
  const a = fmt.week(l[0]), b = fmt.week(l[l.length - 1]);
  const n = (s) => +(String(s).match(/\d+/)?.[0] || 0);
  return n(b) > n(a) ? `${a}–${String(b).replace(/^\D+/, '')}` : `${a} – ${b}`;
}
const utilText = (u, load) => (u === Infinity || (!(u > 0) && load > 0.05) ? tr('keine Zeit', 'no time') : pct(u));
const sugText = (x) => (x.reason === 'noTime'
  ? tr(`${x.personName || 'Die Person'} hat in ${weekRange(x.conflictWeeks)} keine Zeit (abwesend oder Feiertage) – ${x.key} (${hrs(x.hours)}) passt dort nicht.`, `${x.personName || 'The person'} has no time in ${weekRange(x.conflictWeeks)} (absent or holidays) – ${x.key} (${hrs(x.hours)}) does not fit there.`)
  : tr(`${x.personName || 'Die Person'} liegt in ${weekRange(x.conflictWeeks)} über 100 % – ${x.key} (${hrs(x.hours)}, Rang ${x.rank}) hat dort keinen Platz.`, `${x.personName || 'The person'} is above 100 % in ${weekRange(x.conflictWeeks)} – ${x.key} (${hrs(x.hours)}, rank ${x.rank}) has no room there.`));
// a move that helps but does not fully fit (the person is booked beyond the horizon): said plainly, with the worst week after
// only the weeks the task moves INTO count (the old weeks may stay red because of other work – production check 2026-11-17)
const stillOver = (x) => { const o = x.preview.filter((p) => p.after.load > p.before.load + 0.05 && p.after.util > 1.005).sort((a, b) => b.after.util - a.after.util)[0]; return o ? tr(` · passt nicht ganz: danach ${utilText(o.after.util, o.after.load)} in ${fmt.week(o.monday)}`, ` · does not fully fit: then ${utilText(o.after.util, o.after.load)} in ${fmt.week(o.monday)}`) : ''; };
const isSplit = (x) => x.kind === 'split';
// split (tester 2026-11-19): "Split over W 48–50 · up to 27 h per week"; shift: "Move to W 51"
const sugAction = (x) => (isSplit(x)
  ? tr(`Auf ${weekRange([x.to[0], x.to[1]])} aufteilen · bis ${hrs(x.perWeek)} je Woche`, `Split over ${weekRange([x.to[0], x.to[1]])} · up to ${hrs(x.perWeek)} per week`)
  : tr(`Nach ${weekRange(x.to.length ? [x.to[0], x.to[1]] : [])} verschieben`, `Move to ${weekRange([x.to[0], x.to[1]])}`));
const sugTarget = (x) => (isSplit(x) ? tr(`aufteilen auf ${weekRange([x.to[0], x.to[1]])}`, `split over ${weekRange([x.to[0], x.to[1]])}`) : weekRange([x.to[0], x.to[1]]));
// the preview (boss: "with a preview in mouse over with the result"): every touched week before → after
// past the project's due date (tester 2026-11-19: "after project due" was easy to miss): a red chip with an icon
const DueWarn = ({ due }) => <span className="due-warn" data-due-warn><Icon name="alert" size={11} />{tr(`Nach Projekt-Due ${dm(due)}`, `After project due ${dm(due)}`)}</span>;
const sugCard = (x) => infoCard({
  title: `${tr('Auto-planen', 'Auto-schedule')}: ${x.key} → ${sugTarget(x)}`,
  sub: x.summary,
  text: isSplit(x)
    ? tr(`${hrs(x.hours)} auf ${x.span} Wochen statt ${x.spanBefore === 1 ? 'einer' : x.spanBefore} verteilt – bis ${hrs(x.perWeek)} je Woche. Neu ${dm(x.newStart)} – ${dm(x.newDue)}${x.newStart === x.fromStart ? ' (Start bleibt)' : ''}.`, `${hrs(x.hours)} spread over ${x.span} weeks instead of ${x.spanBefore === 1 ? 'one' : x.spanBefore} – up to ${hrs(x.perWeek)} per week. Now ${dm(x.newStart)} – ${dm(x.newDue)}${x.newStart === x.fromStart ? ' (start stays)' : ''}.`)
    : tr(`Start und Due rücken um ${x.weeks} ${x.weeks === 1 ? 'Woche' : 'Wochen'} – neu ${dm(x.newStart)} – ${dm(x.newDue)}. Die Stunden je Woche bleiben gleich.`, `Start and due move by ${x.weeks} ${x.weeks === 1 ? 'week' : 'weeks'} – now ${dm(x.newStart)} – ${dm(x.newDue)}. The hours per week stay the same.`),
  items: x.preview.map((p) => ({ text: `${fmt.week(p.monday)}: ${hrs(p.before.load)} → ${hrs(p.after.load)}`, sub: `${utilText(p.before.util, p.before.load)} → ${utilText(p.after.util, p.after.load)}`, tone: p.after.util > 1.005 ? 'bad' : p.after.util > 0.85 ? 'warn' : 'ok' })),
  itemsTitle: tr(`Auslastung von ${x.personName || 'der Person'} vorher → nachher`, `${x.personName || 'Person'}'s load before → after`),
  hint: (x.full === false ? (isSplit(x) ? tr('Passt nicht ganz – die Person ist auch in den Wochen danach voll; das ist die beste Aufteilung. ', 'Does not fully fit – the person is full in the following weeks too; this is the best split. ') : tr('Passt nicht ganz – die Person ist auch danach voll; das ist die beste Woche ohne Abwesenheit. ', 'Does not fully fit – the person is full afterwards too; this is the best week without absence. ')) : '')
    + (x.pastProjectDue ? tr(`Achtung: endet nach dem Projekt-Due (${dm(x.projectDue)}). `, `Note: ends after the project due date (${dm(x.projectDue)}). `) : '')
    + tr('Nur vorgemerkt – in Jira erst mit „In Jira übernehmen“.', 'Only staged – written to Jira only with "Apply to Jira".'),
});
function Suggestions({ list: every, tip, onAccept, onAcceptAll, onDismiss }) {
  const [all, setAll] = useState(false);
  const [late, setLate] = useState(false); // advice past the project due: hidden until asked for (tester 2026-11-19)
  const inDue = every.filter((x) => !x.pastProjectDue), pastDue = every.filter((x) => x.pastProjectDue);
  const list = late ? [...inDue, ...pastDue] : inDue;
  if (!every.length) return null;
  const shown = all ? list : list.slice(0, 3);
  return (
    <div className="wb-sug" role="region" aria-label={tr('Vorschläge für rote Wochen', 'Suggestions for red weeks')} data-wb-suggestions>
      <div className="wb-box-head"><Icon name="sparkle" size={16} /><b>{inDue.length ? tr(`${inDue.length} ${inDue.length === 1 ? 'Vorschlag' : 'Vorschläge'} für rote Wochen`, `${inDue.length} ${inDue.length === 1 ? 'suggestion' : 'suggestions'} for red weeks`) : tr('Rote Wochen – kein Vorschlag passt bis zum Projekt-Due', 'Red weeks – no suggestion fits by the project due')}</b>
        <span className="faint wb-sug-note">{tr('Nichts wird geschrieben, bis du „In Jira übernehmen“ klickst.', 'Nothing is written until you click "Apply to Jira".')}</span>
        {inDue.length > 1 && <div className="wb-box-actions"><button type="button" className="btn btn-xs" onClick={onAcceptAll}><Icon name="check" size={12} />{tr('Alle übernehmen', 'Accept all')}</button></div>}
      </div>
      <ul className="wb-list">
        {shown.map((x) => (
          <li key={x.id} data-sug={x.taskId}>
            <div><div className="wb-line"><span>{sugText(x)}</span></div>
              <div className="wb-detail">{sugAction(x)} · {tr('neu', 'new')} {dm(x.newStart)} – {dm(x.newDue)}{x.full === false ? stillOver(x) : ''} {x.pastProjectDue ? <DueWarn due={x.projectDue} /> : null}</div></div>
            <span className="wb-sug-btns">
              <button type="button" className={`btn btn-xs ${x.pastProjectDue ? '' : 'btn-primary'}`} {...tip(sugCard(x))} onClick={() => onAccept(x)}><Icon name="check" size={12} />{x.pastProjectDue ? tr('Trotzdem übernehmen', 'Accept anyway') : tr('Übernehmen', 'Accept')}</button>
              <button type="button" className="btn btn-xs btn-ghost" aria-label={tr(`Vorschlag für ${x.key} ausblenden`, `Hide suggestion for ${x.key}`)} onClick={() => onDismiss(x)}><Icon name="x" size={12} /></button>
            </span>
          </li>
        ))}
      </ul>
      {list.length > 3 && <button type="button" className="linkbtn" style={{ marginTop: 4 }} onClick={() => setAll((v) => !v)}>{all ? tr('Weniger anzeigen', 'Show less') : tr(`Alle ${list.length} anzeigen`, `Show all ${list.length}`)}</button>}
      {pastDue.length > 0 && (
        <button type="button" className="linkbtn wb-sug-more" aria-expanded={late} data-sug-pastdue onClick={() => setLate((v) => !v)}>
          <Icon name="alert" size={12} />{late ? tr('Vorschläge nach dem Projekt-Due ausblenden', 'Hide suggestions after the project due')
            : tr(`${pastDue.length} ${pastDue.length === 1 ? 'weiterer Vorschlag endet' : 'weitere Vorschläge enden'} erst nach dem Projekt-Due – nicht empfohlen, trotzdem zeigen`, `${pastDue.length} more ${pastDue.length === 1 ? 'suggestion ends' : 'suggestions end'} only after the project due – not recommended, show anyway`)}
        </button>
      )}
    </div>
  );
}
// the boss's "auto-schedule" right in the red cell: hover = the result, click = accept (staged only)
function AutoFix({ s, tip, onAccept }) {
  return (
    <button type="button" className="wb-autofix" data-autofix={s.taskId} {...tip(sugCard(s))} onClick={() => onAccept(s)}
      aria-label={`${tr('Auto-planen', 'Auto-schedule')}: ${s.key} – ${sugAction(s)}`} data-autofix-kind={s.kind || 'shift'}>
      <Icon name="sparkle" size={11} />{tr('Auto-planen', 'Auto-schedule')} · {s.key} → {sugTarget(s)}
    </button>
  );
}

function Conflicts({ list, canEdit, onFix }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(null); // null = automatic: open while a pending change causes a conflict
  if (!list.length) return null;
  const expanded = open ?? list.some((c) => c.pending);
  const shown = !expanded ? [] : all ? list : list.slice(0, 3);
  const nm = (x) => (x.hidden ? otherPerson() : x.assigneeName || nobody());
  return (
    <div className="wb-conf" role="alert">
      <div className="wb-box-head"><Icon name="alert" size={16} /><b>{tr(`${list.length} ${list.length === 1 ? 'Konflikt' : 'Konflikte'} durch Blocks-Abhängigkeiten`, `${list.length} ${list.length === 1 ? 'conflict' : 'conflicts'} from blocks dependencies`)}</b>
        <div className="wb-box-actions"><button type="button" className="btn btn-xs btn-ghost" aria-expanded={expanded} onClick={() => setOpen(!expanded)}>{expanded ? tr('Ausblenden', 'Hide') : tr('Anzeigen', 'Show')}<Icon name={expanded ? 'chevronDown' : 'chevron'} size={12} /></button></div></div>
      {shown.length > 0 && <ul className="wb-list">
        {shown.map((c) => (
          <li key={c.id}>
            <div>
              <div className="wb-line"><button type="button" className="tkey" onClick={() => openIssue(c.dep.key)} title={tr('In Jira öffnen', 'Open in Jira')}>{c.dep.key}</button><span>{tr('startet vor dem Ende von', 'starts before')} <button type="button" className="tkey" onClick={() => openIssue(c.pre.key)} title={tr('In Jira öffnen', 'Open in Jira')}>{c.pre.key}</button>{tr('', ' ends')}{c.pending ? <span className="chip chip-accent" style={{ height: 18, fontSize: 11, marginLeft: 6 }}>{tr('durch Änderung', 'from a change')}</span> : null}</span></div>
              <div className="wb-detail">
                {c.pre.key} {c.pre.summary ? `„${c.pre.summary}“` : ''} ({nm(c.pre)}) · Due {dm(c.pre.due)} → {c.dep.key} {c.dep.summary ? `„${c.dep.summary}“` : ''} ({nm(c.dep)}) · Start {c.dep.start ? dm(c.dep.start) : tr('ohne Startdatum (ab heute geplant)', 'no start date (planned from today)')}
              </div>
            </div>
            {c.fix && canEdit ? <button type="button" className="btn btn-xs" onClick={() => onFix(c)} title={tr('Nur vorgemerkt – erst „In Jira übernehmen“ schreibt es', 'Only staged – "Apply in Jira" writes it')}><Icon name="calendar" size={12} />{c.fix.startOnly ? tr(`${c.dep.key} ab ${dm(c.fix.start)} starten`, `Start ${c.dep.key} on ${dm(c.fix.start)}`) : tr(`${c.dep.key} auf ${dm(c.fix.start)} verschieben`, `Move ${c.dep.key} to ${dm(c.fix.start)}`)}</button>
              : !canEdit ? <span className="faint" style={{ fontSize: 11.5 }}>{tr('Ändern darf, wer die Wochenplanung pflegt', 'Changing needs the weekly planning right')}</span> : <span />}
          </li>
        ))}
      </ul>}
      {expanded && list.length > 3 && <button type="button" className="wb-more" onClick={() => setAll((v) => !v)}>{all ? tr('Weniger anzeigen', 'Show less') : tr(`+ ${list.length - 3} weitere anzeigen`, `+ ${list.length - 3} more`)}</button>}
    </div>
  );
}

// ---------- pending changes, written only with "Apply in Jira" ----------
function Pending({ canEdit, board, moves, errors, app, issueById, setDs, done, toast }) {
  const teamName = (id) => app.computed?.model.teams.get(id)?.name || id || '';
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => pendingRows(moves), [moves]);
  const pendConf = useMemo(() => (rows.length && app.computed ? planConflicts({ model: app.computed.model, moves }).filter((c) => c.pending) : []), [rows.length, moves, app.computed]);
  // tester 2026-11-19: warn before writing a change that ends after the project's due date
  const lateById = useMemo(() => pastProjectDue(app.computed?.model, moves), [app.computed, moves]);
  if (!rows.length) return null;
  const n = rows.length;
  const hasConf = board.conflicts.length > 0 || pendConf.length > 0;
  const late = [...lateById.values()];
  const names = (id) => app.ds?.people?.[id]?.name || null;
  const text = (r) => [
    r.start || r.due ? [r.start && `Start ${dm(r.start[0])} → ${dm(r.start[1])}`, r.due && `Due ${dm(r.due[0])} → ${dm(r.due[1])}`].filter(Boolean).join(', ') : null,
    r.assignee ? `Assignee ${r.assignee[0].name || nobody()} → ${r.assignee[1].name || nobody()}` : null,
    r.team ? `Team ${r.team[0].name || teamName(r.team[0].id) || '–'} → ${r.team[1].name || teamName(r.team[1].id) || '–'}` : null,
  ].filter(Boolean).join(' · ');
  const patch = (i, f) => ({
    ...i,
    ...('start' in f ? { start: f.start } : {}),
    ...('due' in f ? { due: f.due } : {}),
    ...('team' in f ? { team: f.team ? { id: f.team, name: teamName(f.team) || '' } : null } : {}),
    ...('assignee' in f ? { assignee: f.assignee ? { ...(i.assignee?.id === f.assignee ? i.assignee : { avatar: null }), id: f.assignee, name: names(f.assignee) || f.assigneeName || (i.assignee?.id === f.assignee ? i.assignee.name : '') } : null } : {}),
  });
  const patchDs = (byId) => setDs((d) => ({ ...d, issues: d.issues.map((i) => (byId.has(i.id) ? patch(i, byId.get(i.id)) : i)) }));
  const apply = async () => {
    if (busy) return;
    const sent = moves;
    const payload = planPayload(sent);
    setBusy(true);
    try {
      const res = await call('plan.apply', { moves: payload });
      const results = res?.results || [];
      const byPayload = new Map(payload.map((p) => [p.issueId, p]));
      const wrote = new Map();
      for (const r of results) {
        if (r.ok) wrote.set(r.issueId, { ...byPayload.get(r.issueId), assigneeName: sent[r.issueId]?.assigneeName });
        else if (r.partial && r.written) wrote.set(r.issueId, r.written);
      }
      if (wrote.size) patchDs(wrote);
      pendingStore.set((s) => {
        let mv = s.moves;
        const errs = { ...s.errors };
        for (const r of results) {
          if (r.ok) { mv = undoMove(mv, r.issueId); delete errs[r.issueId]; } else {
            if (r.partial && r.written) mv = rebaseMove(mv, r.issueId, r.written);
            errs[r.issueId] = r.error?.message || r.error?.code || tr('Nicht übernommen', 'Not applied');
          }
        }
        return { moves: mv, errors: errs };
      });
      const okList = results.filter((r) => r.ok || r.partial);
      const failed = results.filter((r) => !r.ok).length;
      if (okList.length) {
        // undo = the values Jira had before, written the same way – one entry per work item
        const entries = okList.map((r) => {
          const back = undoMoveOf(r);
          if (!back) return null;
          const key = r.key || sent[r.issueId]?.key || r.issueId;
          return app.pushUndo(tr(`${key} in Jira geändert – zurück auf die vorherigen Werte`, `${key} changed in Jira – back to the previous values`), async () => {
            const r2 = await call('plan.apply', { moves: [back], undo: true });
            const x = (r2?.results || [])[0];
            if (x?.ok) patchDs(new Map([[r.issueId, back]]));
            else throw new Error(tr(`${key} ließ sich nicht zurücksetzen: ${x?.error?.message || ''}`, `${key} could not be reset: ${x?.error?.message || ''}`));
          }, [`plan:${r.issueId}`, `fill:${r.issueId}:startDate`, `fill:${r.issueId}:dueDate`]);
        }).filter(Boolean);
        toast({
          text: tr(`${okList.length} ${okList.length === 1 ? 'Vorgang' : 'Vorgänge'} in Jira aktualisiert (Start, Due, Assignee)${entries.length > 1 ? ' · jeder einzeln im Verlauf rückgängig' : ''}`, `${okList.length} work ${okList.length === 1 ? 'item' : 'items'} updated in Jira (start, due, assignee)${entries.length > 1 ? ' · each undoable in the history' : ''}`),
          icon: 'calendar', undo: entries.length ? async () => { for (const e of [...entries].reverse()) await app.runUndo(e, { quiet: true }); } : undefined,
        });
      }
      if (failed) toast({ text: tr(`${failed} ${failed === 1 ? 'Änderung wurde' : 'Änderungen wurden'} nicht übernommen – Grund in der Liste.`, `${failed} ${failed === 1 ? 'change was' : 'changes were'} not applied – see the list for why.`), error: true });
    } catch (e) {
      toast({ text: errText(e), error: true });
    } finally { setBusy(false); }
  };
  return (
    <div className="wb-pend" role="region" aria-label={tr('Änderungen, noch nicht in Jira', 'Changes not in Jira yet')}>
      <div className="wb-box-head">
        <Icon name="calendar" size={16} />
        <b>{tr(`${n} ${n === 1 ? 'Änderung' : 'Änderungen'} noch nicht in Jira`, `${n} ${n === 1 ? 'change' : 'changes'} not in Jira yet`)}</b>
        <div className="wb-box-actions">
          <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => {
            const prev = pendingStore.get().moves;
            pendingStore.set({ moves: {}, errors: {} });
            const entries = Object.entries(prev).map(([id, m]) => app.pushUndo(tr(`${m.key}: Änderung verworfen (Alle verwerfen)`, `${m.key}: change discarded (discard all)`), () => restoreMove(id, m), [`move:${id}`]));
            toast({ text: tr('Alle Änderungen verworfen – jede einzeln im Verlauf rückgängig', 'All changes discarded – each undoable in the history'), icon: 'undo', undo: async () => { for (const e of [...entries].reverse()) await app.runUndo(e, { quiet: true }); } });
          }}>{tr('Alle verwerfen', 'Discard all')}</button>
          {canEdit && (
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} aria-busy={busy} onClick={apply}>
              <Icon name={busy ? 'refresh' : 'check'} size={14} />{hasConf ? tr(`Trotz Konflikten übernehmen (${n})`, `Apply despite conflicts (${n})`) : late.length ? tr(`Trotz Projekt-Due übernehmen (${n})`, `Apply despite project due (${n})`) : tr(`In Jira übernehmen (${n})`, `Apply in Jira (${n})`)}
            </button>
          )}
        </div>
      </div>
      {late.length > 0 && (
        <div className="wb-due-warn" role="alert" data-pending-pastdue>
          <Icon name="alert" size={16} />
          <div><b>{tr(`${late.length} ${late.length === 1 ? 'Änderung endet' : 'Änderungen enden'} nach dem Projekt-Due`, `${late.length} ${late.length === 1 ? 'change ends' : 'changes end'} after the project due date`)}</b>
            <ul>{late.map((x) => <li key={x.id}><span className="mono">{x.key}</span> {tr('endet', 'ends')} {dm(x.due)} · {x.project} {tr('fällig', 'due')} {dm(x.projectDue)} ({tr(`${x.days} T später`, `${x.days} d later`)})</li>)}</ul>
            <span className="faint">{tr('Das Projekt würde damit später fertig. Lieber aufteilen, jemand anderem geben oder die Prioritäten klären.', 'The project would finish later. Better split it, give it to someone else or clarify the priorities.')}</span></div>
        </div>
      )}
      <ul className="wb-list">
        {rows.map((r) => {
          const i = issueById.get(r.id);
          const tid = r.team ? r.team[1].id : i?.team?.id;
          const notInTeam = r.assignee?.[1]?.id && tid && board.personTeam(r.assignee[1].id) && !board.inTeamOf(r.assignee[1].id, tid);
          return (
            <li key={r.id}>
              <div>
                <div className="wb-line"><button type="button" className="tkey" onClick={() => openIssue(r.key)}>{r.key}</button><span>{r.summary}</span></div>
                <div className="wb-detail">{text(r)} {lateById.get(r.id) ? <DueWarn due={lateById.get(r.id).projectDue} /> : null}</div>
                {notInTeam ? <div className="wb-warn">{tr(`${r.assignee[1].name} ist nicht im Team dieses Tasks`, `${r.assignee[1].name} is not in this task's team`)}</div> : null}
                {errors[r.id] ? <div className="wb-err">{errors[r.id]}</div> : null}
              </div>
              <button type="button" className="btn btn-xs btn-ghost btn-icon" style={{ width: 28 }} disabled={busy} aria-label={tr(`Änderung an ${r.key} verwerfen`, `Discard change to ${r.key}`)}
                onClick={() => {
                  const prev = moves[r.id] || null;
                  setMoves((mv) => undoMove(mv, r.id), [r.id]);
                  const e = app.pushUndo(tr(`${r.key}: Änderung verworfen`, `${r.key}: change discarded`), () => restoreMove(r.id, prev), [`move:${r.id}`]);
                  toast({ text: tr(`Änderung an ${r.key} verworfen`, `Change to ${r.key} discarded`), icon: 'undo', undo: () => app.runUndo(e) });
                }}><Icon name="undo" size={14} /></button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------- legend (boss feedback 2026-11-11: make it clear) ----------
// Explains the three things on the board with the board's own elements: the head of each week, the cards
// in a week and the bar on the left. Can be folded away; the choice is remembered on this device.
const LEGEND_KEY = 'pc-wb-legend';
function BoardLegend({ kind, canDrag, projects }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(LEGEND_KEY) !== 'closed'; } catch { return true; } });
  const toggle = () => setOpen((o) => { try { localStorage.setItem(LEGEND_KEY, o ? 'closed' : 'open'); } catch { /* private window */ } return !o; });
  return (
    <div className={`wb-lg ${open ? 'open' : ''}`}>
      <button type="button" className="wb-lg-toggle" onClick={toggle} aria-expanded={open}>
        <Icon name="help" size={14} />{tr('So liest du die Wochenplanung', 'How to read the weekly planning')}
        <span className="wb-lg-chev" aria-hidden="true"><Icon name="chevronDown" size={13} /></span>
      </button>
      {open && (
        <motion.div className="wb-lg-body" {...enter(0, { y: -4 })}>
          <div className="wb-lg-col">
            <div className="wb-lg-h">{tr('Kopf jeder Woche', 'Head of each week')}</div>
            <div className="wb-head t-ok wb-lg-sample"><span>23 / 29 h</span><b>82 %</b></div>
            <p>{tr('geplant / verfügbar – und die Auslastung in %. Verfügbar = Wochenstunden minus Abwesenheit, Feiertage und Tagesgeschäft.', 'planned / available – and the load in %. Available = weekly hours minus absence, holidays and daily business.')}</p>
            <ul className="wb-lg-tones">
              <li><i className="t-ok" />{tr('bis 85 % – noch Luft', 'up to 85 % – room left')}</li>
              <li><i className="t-warn" />{tr('85–100 % – fast voll', '85–100 % – nearly full')}</li>
              <li><i className="t-bad" />{tr('über 100 % – überbucht', 'over 100 % – overbooked')}</li>
              <li><i className="t-none" />{tr('nichts geplant', 'nothing planned')}</li>
            </ul>
          </div>
          {kind !== 'teams' && (
            <div className="wb-lg-col">
              <div className="wb-lg-h">{tr('Karten in einer Woche', 'Cards in a week')}</div>
              <ul className="wb-lg-cards">
                <li><span className="wb-lg-card sup"><b>Support</b><em>2,9 h</em></span>{tr('Support-Reserve – kommt vor allen Projekten, fest', 'Support reserve – comes before every project, fixed')}</li>
                <li><span className="wb-lg-card task"><b>ABC-1</b><em>6,5 h · 3/7</em></span>{tr('Aufgabe: Stunden in dieser Woche · Woche 3 von 7', 'Task: hours in this week · week 3 of 7')}</li>
                <li><span className="wb-lg-card other"><b>{tr('Andere Teams', 'Other teams')}</b><em>14 h</em></span>{tr('Arbeit derselben Person in anderen Teams', 'the same person\'s work in other teams')}</li>
                <li><span className="wb-lg-card task conflict"><b>ABC-7</b><em>!</em></span>{tr('Konflikt: startet, bevor die Voraussetzung fertig ist', 'Conflict: starts before its prerequisite is done')}</li>
                {canDrag && <li><span className="wb-lg-card task pending"><b>ABC-9</b><em>{tr('neu', 'new')}</em></span>{tr('verschoben – noch nicht in Jira', 'moved – not in Jira yet')}</li>}
              </ul>
              <p className="faint">{tr('Gleichmäßig: ABC-1 mit 40 h über 7 Wochen bekommt 5,7 h in jeder Woche.', 'Even: ABC-1 with 40 h over 7 weeks gets 5.7 h in every week.')}</p>
              <p className="faint">{tr('Nach freier Kapazität: dieselben 40 h bleiben zwischen Start und Due, gehen aber dorthin, wo die Person Luft hat (z. B. 7 h, 7 h, 4 h in der vollen Woche, 7 h …, Rang 1 zuerst) – Termine bleiben, vergangene Wochen bleiben gleichmäßig; reicht der Platz nicht, bleibt die Überlast sichtbar.', 'By free capacity: the same 40 h stay between start and due but go where the person has room (e.g. 7 h, 7 h, 4 h in the full week, 7 h …, rank 1 first) – dates stay, past weeks stay even; if the room is not enough, the overload stays visible.')}</p>
            </div>
          )}
          {kind === 'people' && (
            <div className="wb-lg-col">
              <div className="wb-lg-h">{tr('Balken links: die Woche der Person', 'Bar on the left: the person\'s week')}</div>
              <div className="wb-bar over wb-lg-bar" aria-hidden="true">
                <i style={{ width: '10%', background: 'var(--wb-off)' }} /><i style={{ width: '18%', background: 'var(--wb-daily)' }} /><i style={{ width: '8%', background: 'var(--wb-support)' }} /><i style={{ width: '64%', background: 'var(--wb-projects)' }} />
                <b className="wb-bar-over" style={{ left: '84%', width: '16%' }} /><b className="wb-100" style={{ left: '84%' }} />
              </div>
              <ul className="wb-lg-tones">
                <li><i style={{ background: 'var(--wb-off)' }} />{tr('Abwesend & Feiertage', 'Absent & holidays')}</li>
                <li><i style={{ background: 'var(--wb-daily)' }} />{tr('Tagesgeschäft & intern', 'Daily business & internal')}</li>
                <li><i style={{ background: 'var(--wb-support)' }} />Support</li>
                <li><i style={{ background: 'var(--wb-projects)' }} />{tr('Projekt-Aufgaben', 'Project tasks')}</li>
                <li><i className="sw-free" />{tr('frei', 'free')}</li>
                <li><i className="sw-over" />{tr('über 100 % (rechts vom Strich)', 'over 100 % (right of the line)')}</li>
              </ul>
            </div>
          )}
          {projects.length > 0 && (
            <div className="wb-lg-projects">
              <span className="wb-lg-h">{tr('Projekte', 'Projects')}</span>
              {projects.map((p) => <span key={p.ref}><i style={{ background: p.color }} />{p.name}</span>)}
              {canDrag && <span className="faint">{tr('Karte ziehen = Start und Due verschieben · Enter öffnet das Menü', 'Drag a card = move start and due · Enter opens the menu')}</span>}
            </div>
          )}
          <p className="wb-lg-opt">
            <span className="wb-opt-glyph" aria-hidden="true"><Icon name="sparkle" size={12} /></span>
            <span><b>{tr('Optimieren', 'Optimize')}</b>{tr(
              ' – drei Vorschläge, nie über die gewählte Auslastung und nie in einen Blocks-Konflikt: Schneller fertig (wer Luft hat, bringt Aufgaben früher ins Ziel, Rang 1 zuerst) · Überlast glätten (Aufgaben mit niedrigem Rang später oder gestreckt, nie über Projekt-Due oder Meilenstein) · Umverteilen (an jemanden im selben Team mit Luft). Alles wird nur vorgemerkt.',
              ' – three kinds of suggestions, never above the chosen utilization and never into a blocks conflict: Finish sooner (people with room finish tasks earlier, rank 1 first) · Smooth overload (lower-ranked tasks later or stretched, never past the project due date or milestone) · Rebalance (to someone in the same team with room). Everything is only added as pending changes.')}</span>
          </p>
        </motion.div>
      )}
    </div>
  );
}
