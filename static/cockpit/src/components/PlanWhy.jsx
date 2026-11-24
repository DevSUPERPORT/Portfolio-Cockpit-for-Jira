// Wochenplanung › transparency for the capacity distribution (shared/weekPlan.js capacityFill / waterFill):
//   whySteps     – "Warum diese Stunden?" step by step, with the board's own numbers (fill.why)
//   WhyCard      – the reasoning card (opened from the card menu; Escape closes) with the per-task switch
//                  "Für diese Aufgabe gleichmäßig verteilen" / "Wieder nach Kapazität"
//   PlanLog      – "Was die Automatik getan hat": one line per redistributed task with its own undo, plus "Alle gleichmäßig"
// Motion: transform/opacity only, enter animations only.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { enter } from '../lib/motion.js';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';

const h1 = (v) => fmt.h(v, Math.abs(v - Math.round(v)) > 0.05 ? 1 : 0);
const dm = (iso) => (iso ? fmt.date(iso, { day: '2-digit', month: '2-digit' }) : '–');
const wk = (iso) => fmt.week(iso);
const wkJoin = (isos) => isos.map(wk).join(', ');
const EPS = 0.05;

// panel state (survives a team switch)
let logSnap = { open: false };
const logSubs = new Set();
export const logStore = { get: () => logSnap, set(v) { logSnap = { ...logSnap, ...v }; logSubs.forEach((f) => f()); }, subscribe(f) { logSubs.add(f); return () => logSubs.delete(f); } };
export const useLogState = () => useSyncExternalStore(logStore.subscribe, logStore.get, logStore.get);

// What the split changed against the even share, in one line: "KW 48 −3 h → KW 46, KW 47, KW 49".
export function changeLine(fill) {
  const w = fill.why;
  if (fill.forced) return tr('gleichmäßig (von Hand festgelegt)', 'even (set by hand)');
  const less = w.weeks.filter((x) => x.hours < w.evenShare - EPS);
  const more = w.weeks.filter((x) => x.hours > w.evenShare + EPS);
  const minus = less.map((x) => `${wk(x.week)} −${h1(w.evenShare - x.hours)}`).join(', ');
  return more.length ? `${minus} → ${wkJoin(more.map((x) => x.week))}` : minus;
}
// One sentence why.
export function reasonLine(fill) {
  const w = fill.why;
  if (fill.forced) return tr('Jemand hat diese Aufgabe auf gleichmäßige Verteilung gestellt.', 'Someone set this task to the even split.');
  if (w.missing > EPS) return tr(`Im Zeitraum fehlen ${h1(w.missing)} – jede Woche ist bis 100 % gefüllt, der Rest gleichmäßig verteilt${w.over.length ? `; ${wkJoin(w.over)} bleibt überbucht` : ''}.`, `The window lacks ${h1(w.missing)} – every week is filled to 100 %, the rest spread evenly${w.over.length ? `; ${wkJoin(w.over)} stays overbooked` : ''}.`);
  const capped = w.weeks.filter((x) => x.hours < w.evenShare - EPS);
  return tr(`${wkJoin(capped.map((x) => x.week))} ${capped.length === 1 ? 'hat' : 'haben'} weniger frei als der gleichmäßige Anteil (${h1(w.evenShare)}) – die anderen Wochen übernehmen den Rest.`, `${wkJoin(capped.map((x) => x.week))} ${capped.length === 1 ? 'has' : 'have'} less free time than the even share (${h1(w.evenShare)}) – the other weeks take the rest.`);
}

// The steps of the reasoning card: [{ title, text, items?, calc? }].
export function whySteps(fill, pin) {
  const w = fill.why;
  const steps = [];
  const pastShare = w.oe / w.touched;
  steps.push({
    title: tr('Zeitraum', 'Window'),
    text: tr(`Start ${dm(w.start)} – Due ${dm(w.due)}: ${w.touched} ${w.touched === 1 ? 'Woche' : 'Wochen'}. Die Termine ändert die Automatik nie.`, `Start ${dm(w.start)} – due ${dm(w.due)}: ${w.touched} ${w.touched === 1 ? 'week' : 'weeks'}. The automation never changes the dates.`),
  });
  steps.push({
    title: tr('Zu verteilen', 'To place'),
    text: w.past
      ? tr(`${h1(w.oe)} Original Estimate − ${w.past} vergangene ${w.past === 1 ? 'Woche' : 'Wochen'} × ${h1(pastShare)} (bleiben gleichmäßig) = ${h1(w.rest)} ab dieser Woche.`, `${h1(w.oe)} original estimate − ${w.past} past ${w.past === 1 ? 'week' : 'weeks'} × ${h1(pastShare)} (stay even) = ${h1(w.rest)} from this week on.`)
      : tr(`${h1(w.rest)} Original Estimate auf ${w.weeks.length} ${w.weeks.length === 1 ? 'Woche' : 'Wochen'}.`, `${h1(w.rest)} original estimate over ${w.weeks.length} ${w.weeks.length === 1 ? 'week' : 'weeks'}.`),
  });
  if (fill.forced) {
    steps.push({
      title: tr('Gleichmäßig festgelegt', 'Set to even'),
      text: tr(`${pin?.byName ? `${pin.byName} hat` : 'Jemand hat'} diese Aufgabe${pin?.at ? ` am ${dm(pin.at)}` : ''} auf gleichmäßige Verteilung gestellt: ${h1(w.evenShare)} je Woche, unabhängig von der freien Zeit.`, `${pin?.byName || 'Someone'} set this task to the even split${pin?.at ? ` on ${dm(pin.at)}` : ''}: ${h1(w.evenShare)} per week, whatever the free time.`),
    });
  } else {
    steps.push({
      title: tr('Freie Zeit je Woche', 'Free time per week'),
      text: tr('Verfügbar − Support − was Aufgaben mit höherem Rang schon belegt haben.', 'Available − support − what higher-ranked tasks already took.'),
      items: w.weeks.map((x) => ({
        text: `${wk(x.week)}: ${h1(x.room)} ${tr('frei', 'free')}`,
        sub: `${h1(x.avail)} − ${h1(x.support)} Support${x.taken.map((t) => ` − ${t.key} ${h1(t.h)}`).join('')}`,
        tone: x.room > EPS ? 'ok' : 'bad',
      })),
    });
    const r = w.rounds;
    const parts = [];
    if (w.missing > EPS) {
      parts.push(tr(`Im Zeitraum sind nur ${h1(w.rest - w.missing)} frei: jede Woche bekommt ihre freie Zeit, die fehlenden ${h1(w.missing)} gleichmäßig dazu (je ${h1(w.missing / w.weeks.length)}).`, `The window has only ${h1(w.rest - w.missing)} free: every week gets its free time, the missing ${h1(w.missing)} spread evenly on top (${h1(w.missing / w.weeks.length)} each).`));
    } else {
      const roomOf = (c) => w.weeks.find((y) => y.week === c).room;
      r.forEach((round, i) => {
        if (i === 0) parts.push(tr(`Gleichmäßig ${h1(round.share)} je Woche`, `Even: ${h1(round.share)} per week`));
        else {
          // the excess of the weeks capped in the round before goes evenly to the weeks still open
          const prev = r[i - 1];
          const excess = prev.capped.reduce((a, c) => a + prev.share - roomOf(c), 0);
          const capSoFar = new Set(r.slice(0, i).flatMap((x) => x.capped));
          const open = w.weeks.filter((x) => !capSoFar.has(x.week)).map((x) => x.week);
          parts.push(open.length === 1
            ? tr(`die übrigen ${h1(excess)} gehen auf ${wkJoin(open)} → ${h1(round.share)}`, `the remaining ${h1(excess)} go to ${wkJoin(open)} → ${h1(round.share)}`)
            : tr(`die übrigen ${h1(excess)} gehen gleichmäßig auf ${wkJoin(open)} → je ${h1(round.share)}`, `the remaining ${h1(excess)} go evenly to ${wkJoin(open)} → ${h1(round.share)} each`));
        }
        for (const c of round.capped) {
          const x = w.weeks.find((y) => y.week === c);
          parts.push(tr(`${wk(c)} hat nur ${h1(x.room)} frei → ${h1(x.room)}`, `${wk(c)} has only ${h1(x.room)} free → ${h1(x.room)}`));
        }
      });
    }
    steps.push({
      title: tr('Verteilung', 'Split'),
      text: `${parts.join(' – ')}.`,
      calc: w.weeks.map((x) => `${wk(x.week)} ${fmt.n(x.hours, 1)}`).join(' · ') + ` = ${fmt.n(w.rest, 1)} h`,
    });
  }
  steps.push({
    title: tr('Ergebnis', 'Outcome'),
    // only blame this task when it really lacks room; a week that higher-ranked work already fills is named as such
    text: w.missing > EPS
      ? tr(`${wkJoin(w.over)} bleibt überbucht: im Zeitraum fehlen ${h1(w.missing)}. Mehr Zeit (Due später), eine andere Person oder weniger Arbeit davor lösen das.`, `${wkJoin(w.over)} stays overbooked: the window lacks ${h1(w.missing)}. More time (a later due date), another person or less work before it would solve it.`)
      : w.over.length
        ? tr(`Diese Aufgabe passt vollständig – keine Woche geht durch sie über 100 %. ${wkJoin(w.over)} ist schon durch höher priorisierte Arbeit voll; dort bekommt sie 0 h.`, `This task fits completely – no week goes above 100 % because of it. ${wkJoin(w.over)} is already full with higher-ranked work; it gets 0 h there.`)
        : tr('Passt vollständig – keine Woche über 100 % durch diese Aufgabe.', 'Fits completely – no week above 100 % because of this task.'),
    tone: w.missing > EPS ? 'bad' : 'ok',
  });
  return steps;
}

// The reasoning card, near the task card (like the card menu).
export function WhyCard({ task, pin, rect, canEdit, onToggle, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: rect.left, top: rect.bottom + 6, visibility: 'hidden' });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left));
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
    setPos({ left, top });
  }, [rect]);
  useEffect(() => { ref.current?.querySelector('button')?.focus(); }, []);
  useEffect(() => {
    const h = (e) => { if (!ref.current?.contains(e.target)) onClose(false); };
    window.addEventListener('pointerdown', h, true);
    return () => window.removeEventListener('pointerdown', h, true);
  }, [onClose]);
  const fill = task.fill;
  const steps = whySteps(fill, pin);
  const id = `wb-why-${task.id}`;
  return createPortal(
    <motion.div ref={ref} className="wb-why" role="dialog" aria-labelledby={id} style={pos}
      {...enter(0, { y: -4, scale: 0.985 })}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); } }}>
      <div className="wb-why-head">
        <span className="wb-why-glyph" aria-hidden="true">⇄</span>
        <div><b id={id}>{tr('Warum diese Stunden?', 'Why these hours?')}</b><span className="wb-key">{task.key} · {task.summary}</span></div>
        <button type="button" className="btn btn-xs btn-ghost btn-icon" style={{ width: 26 }} aria-label={tr('Schließen', 'Close')} onClick={() => onClose(true)}><Icon name="x" size={13} /></button>
      </div>
      <ol className="wb-why-steps">
        {steps.map((s, i) => (
          <li key={i} className={s.tone ? `t-${s.tone}` : ''}>
            <span className="wb-why-n" aria-hidden="true">{i + 1}</span>
            <div>
              <b>{s.title}</b>
              <p>{s.text}</p>
              {s.items && <ul>{s.items.map((x, j) => <li key={j}><i className={`t-${x.tone}`} /><span>{x.text}</span><em>{x.sub}</em></li>)}</ul>}
              {s.calc && <code>{s.calc}</code>}
            </div>
          </li>
        ))}
      </ol>
      {canEdit && (
        <div className="wb-why-foot">
          <button type="button" className="btn btn-sm" onClick={() => onToggle(!fill.forced)}>
            <Icon name={fill.forced ? 'sparkle' : 'undo'} size={13} />
            {fill.forced ? tr('Wieder nach Kapazität verteilen', 'Split by capacity again') : tr('Für diese Aufgabe gleichmäßig verteilen', 'Split this task evenly')}
          </button>
          <span className="faint">{tr('Gilt für alle · einzeln rückgängig', 'Applies to everyone · undoable')}</span>
        </div>
      )}
    </motion.div>, document.body);
}

// "Was die Automatik getan hat" – one line per task, each with its own undo.
export function PlanLog({ tasks, pins, canEdit, onToggle, onWhy, color }) {
  const auto = tasks.filter((t) => !t.fill.forced);
  const forced = tasks.filter((t) => t.fill.forced);
  return (
    <motion.section className="wb-log" aria-label={tr('Was die Automatik getan hat', 'What the automation did')}
      {...enter(0, { y: -8, d: 'gentle' })}>
      <div className="wb-log-head">
        <span className="wb-why-glyph" aria-hidden="true">⇄</span>
        <div>
          <b>{tr(`${auto.length} ${auto.length === 1 ? 'Aufgabe' : 'Aufgaben'} nach freier Kapazität verteilt`, `${auto.length} ${auto.length === 1 ? 'task' : 'tasks'} split by free capacity`)}</b>
          <p>{tr('Die Stunden bleiben zwischen Start und Due; Wochen mit wenig Luft bekommen weniger, die anderen gleichmäßig mehr. Jede Zeile lässt sich einzeln zurücknehmen.', 'Hours stay between start and due; weeks with little room get less, the others evenly more. Each line can be taken back on its own.')}</p>
        </div>
        <button type="button" className="btn btn-xs btn-ghost btn-icon" style={{ width: 26, marginLeft: 'auto' }} aria-label={tr('Schließen', 'Close')} onClick={() => logStore.set({ open: false })}><Icon name="x" size={13} /></button>
      </div>
      {tasks.length ? (
        <ul className="wb-log-list">
          {[...auto, ...forced].map((t, i) => (
            <motion.li key={t.id} className={t.fill.forced ? 'forced' : ''} {...enter(i, { y: 4 })}>
              <div className="wb-log-what">
                <span className="wb-opt-line"><span className="wb-key">{t.key}</span><span className="wb-opt-sum">{t.summary}</span></span>
                <span className="wb-opt-meta"><i style={{ background: color(t.ref) }} />{t.assigneeName}{t.fill.forced && pins?.[t.id]?.byName ? ` · ${tr('festgelegt von', 'set by')} ${pins[t.id].byName}` : ''}</span>
              </div>
              <div className="wb-log-change">
                <b>{changeLine(t.fill)}</b>
                <span>{reasonLine(t.fill)}</span>
              </div>
              <div className="wb-log-act">
                <button type="button" className="btn btn-xs btn-ghost" onClick={(e) => onWhy(t, e.currentTarget.getBoundingClientRect())}>{tr('Warum?', 'Why?')}</button>
                {canEdit && (
                  <button type="button" className="btn btn-xs" onClick={() => onToggle([t], !t.fill.forced)}>
                    <Icon name={t.fill.forced ? 'sparkle' : 'undo'} size={12} />{t.fill.forced ? tr('nach Kapazität', 'by capacity') : tr('gleichmäßig', 'even')}
                  </button>
                )}
              </div>
            </motion.li>
          ))}
        </ul>
      ) : <p className="faint wb-log-empty">{tr('Auf diesem Board hat die Automatik nichts umverteilt – alle Aufgaben liegen gleichmäßig.', 'On this board the automation moved nothing – every task is spread evenly.')}</p>}
      {canEdit && auto.length > 1 && (
        <div className="wb-log-foot">
          <span className="faint">{tr('Jede Aufgabe bekommt ihren eigenen Eintrag im Verlauf (rückgängig).', 'Each task gets its own entry in the history (undo).')}</span>
          <button type="button" className="btn btn-sm" onClick={() => onToggle(auto, true)}><Icon name="undo" size={13} />{tr(`Alle gleichmäßig (${auto.length})`, `All even (${auto.length})`)}</button>
        </div>
      )}
    </motion.section>
  );
}
