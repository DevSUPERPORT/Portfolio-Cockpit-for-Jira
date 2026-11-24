// Projekt › Kapazität › "Jahresprognose": when this project's hours fall over the next 12 / 18 / 24 months, per
// person, coloured by how full that person is in total – and whether the work ends before the project's due date.
// Projection only: built from the weekly plan (shared/yearPlan.js), nothing can be moved here.
import { useMemo, useState } from 'react';
import { useApp } from '../state.jsx';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { Segmented, Empty, useTip, infoCard } from './ui.jsx';
import { projectYear, YEAR_RANGES } from '@shared/yearPlan.js';
import { useDistribution, usePendingMoves } from './WeekBoard.jsx';
import { LotseChip } from './lotse/LotseChip.jsx';
import { openLotse } from './lotse/open.js';

const KEY = 'pc-year-months';
const readMonths = () => { try { const v = +localStorage.getItem(KEY); return YEAR_RANGES.includes(v) ? v : 12; } catch { return 12; } };
const monthName = (key) => fmt.date(`${key}-01`, { month: 'short', year: '2-digit' });
const tone = (c) => (c.own <= 0.05 ? '' : c.util === Infinity || c.util > 1.005 ? 'bad' : c.util > 0.85 ? 'warn' : 'ok');
const h0 = (v) => fmt.h(v, v > 0 && v < 9.95 ? 1 : 0);

export default function ProjectYear({ p }) {
  const { ds, computed, config } = useApp();
  const distribution = useDistribution(config);
  const { moves } = usePendingMoves(); // staged board moves count here too – the year view never disagrees with the board
  const tip = useTip();
  const [months, setMonthsState] = useState(readMonths);
  const setMonths = (v) => { setMonthsState(v); try { localStorage.setItem(KEY, String(v)); } catch { /* private window */ } };
  const y = useMemo(() => projectYear({ ds, computed, project: p.ref, months, distribution, moves }), [ds, computed, p.ref, months, distribution, moves]);
  const dueIdx = y.dueMonth ? y.months.findIndex((m) => m.key === y.dueMonth) : -1;
  const lateEnd = (y.lastMonth && y.dueMonth && y.lastMonth > y.dueMonth) || (y.runsPast && !!y.due);
  const unplanned = y.remaining != null ? Math.max(0, y.remaining - y.planned) : 0;
  const maxT = Math.max(1, ...y.total);

  return (
    <div className="py" data-project-year>
      <div className="py-top">
        <p className="py-note"><Icon name="info" size={13} />{tr('Prognose aus Start, Due und Schätzungen – so wie die Wochenplanung rechnet, je Monat zusammengefasst. Hier wird nichts verschoben.', 'Projection from start, due and estimates – calculated like the weekly planning, summed per month. Nothing is moved here.')}</p>
        <div className="py-tools">
          {/* Lotse checks the year (and Forge LLM reads its verified result when AI is on); an unforeseen closure re-plans */}
          <LotseChip skill="yearCheck" params={{ ref: p.ref }} label={tr('Lotse: Jahr prüfen', 'Lotse: check the year')} title={tr('Lotse prüft die nächsten 12 Monate: Arbeit nach dem Due, Wochen ohne Zeit (Urlaub, Feiertage), Überlast', 'Lotse checks the next 12 months: work after the due date, weeks without time (leave, holidays), overload')} />
          <button type="button" className="chip lotse-chip" onClick={() => openLotse({ text: tr('Die Arbeit fällt aus – plane neu', 'Work is cancelled – re-plan') })} title={tr('Schnee, Stromausfall, Büro zu: Tage austragen und die Arbeit neu einplanen – mit Vorschau', 'Snow, power cut, office closed: take the days out and re-plan the work – with a preview')}><Icon name="calendar" size={13} />{tr('Ausfall melden', 'Report a closure')}</button>
          <Segmented size="sm" value={months} onChange={setMonths} label={tr('Zeitraum', 'Time range')}
            options={YEAR_RANGES.map((n) => ({ value: n, label: tr(`${n} Monate`, `${n} months`) }))} />
        </div>
      </div>
      <div className="py-facts">
        <span className="chip chip-outline num">{tr(`${h0(y.planned)} geplant in ${months} Monaten`, `${h0(y.planned)} planned in ${months} months`)}</span>
        {y.runsPast ? <span className={`chip num ${lateEnd ? 'chip-bad' : 'chip-warn'}`}>{tr(`Läuft über ${months} Monate hinaus`, `Runs beyond ${months} months`)}</span>
          : y.lastMonth && <span className={`chip num ${lateEnd ? 'chip-bad' : 'chip-ok'}`}>{tr(`Fertig laut Plan: ${monthName(y.lastMonth)}`, `Done per plan: ${monthName(y.lastMonth)}`)}</span>}
        {y.due && <span className="chip chip-outline num">Due {fmt.dateLong(y.due)}</span>}
        {y.late > 0.5 && <span className="chip chip-bad num">{tr(`${h0(y.late)} nach dem Due`, `${h0(y.late)} after the due date`)}</span>}
        {y.pending > 0 && <span className="chip chip-outline num" {...tip(infoCard({ title: tr('Vorgemerkte Verschiebungen', 'Pending moves'), text: tr('Die Prognose rechnet schon mit den Verschiebungen aus der Wochenplanung, die noch nicht in Jira übernommen sind.', 'The projection already includes the moves from the weekly planning that are not in Jira yet.') }))}><Icon name="clock" size={12} />{tr(`inkl. ${y.pending} vorgemerkte Verschiebung${y.pending === 1 ? '' : 'en'}`, `incl. ${y.pending} pending move${y.pending === 1 ? '' : 's'}`)}</span>}
        {unplanned > 0.5 && <span className="chip chip-warn num" {...tip(infoCard({ title: tr('Noch ohne Zeitraum', 'No time frame yet'), text: tr('Restschätzung, die in keinem Monat auftaucht: Stories ohne Start/Due oder nach dem gewählten Zeitraum. Termine setzen, damit die Prognose stimmt.', 'Remaining estimate that appears in no month: stories without start/due or beyond the chosen range. Set dates so the projection is right.') }))}>{tr(`${h0(unplanned)} noch ohne Zeitraum`, `${h0(unplanned)} without a time frame`)}</span>}
      </div>
      {!y.rows.length ? (
        <Empty icon="calendar" title={tr('Keine geplanten Stunden im Zeitraum', 'No planned hours in this range')}>{tr('Stories brauchen Original Estimate, Start und Due date.', 'Stories need an original estimate, a start and a due date.')}</Empty>
      ) : (
        <div className="py-scroll" tabIndex={0} role="region" aria-label={tr('Jahresprognose, seitlich scrollbar', 'Year projection, scrolls sideways')}>
          <div className="py-grid" style={{ '--py-n': y.months.length }} role="table">
            <div className="py-row py-head" role="row">
              <div className="py-name" role="columnheader">{tr('Person', 'Person')}</div>
              {y.months.map((m, i) => (
                <div key={m.key} role="columnheader" className={`py-mh ${m.current ? 'cur' : ''} ${i === dueIdx ? 'due' : ''} ${dueIdx >= 0 && i > dueIdx ? 'after' : ''}`}>
                  {monthName(m.key)}{i === dueIdx && <span className="py-due">Due</span>}
                </div>
              ))}
            </div>
            {y.rows.map((r) => (
              <div key={r.id} className="py-row" role="row">
                <div className="py-name" role="rowheader"><b>{r.kind === 'unassigned' ? tr('Nicht zugewiesen', 'Unassigned') : r.kind === 'hidden' ? tr('Weitere Personen', 'Other people') : r.name || tr('Person', 'Person')}</b><span className="faint num">{h0(r.total)}</span></div>
                {r.cells.map((c, i) => (
                  <div key={i} role="cell" tabIndex={c.own > 0.05 ? 0 : -1} className={`py-c ${tone(c)} ${dueIdx >= 0 && i > dueIdx && c.own > 0.05 ? 'late' : ''}`}
                    {...(c.own > 0.05 ? tip(infoCard({
                      title: `${r.kind === 'unassigned' ? tr('Nicht zugewiesen', 'Unassigned') : r.name || tr('Person', 'Person')} · ${monthName(y.months[i].key)}`,
                      inputs: [[tr('Dieses Projekt', 'This project'), fmt.h(c.own, 1)], ...(r.kind !== 'unassigned' ? [[tr('Alles zusammen', 'Everything'), fmt.h(c.load, 1)], [tr('Verfügbar', 'Available'), fmt.h(c.avail, 1)], [tr('Auslastung', 'Load'), c.util === Infinity ? tr('keine Zeit', 'no time') : fmt.pct(c.util)]] : [])],
                      hint: dueIdx >= 0 && i > dueIdx ? tr('Liegt nach dem Due des Projekts.', 'Lies after the project due date.') : null,
                    })) : {})}>
                    {c.own > 0.05 ? h0(c.own) : ''}
                  </div>
                ))}
              </div>
            ))}
            <div className="py-row py-foot" role="row">
              <div className="py-name" role="rowheader"><b>{tr('Projekt gesamt', 'Project total')}</b></div>
              {y.total.map((v, i) => (
                <div key={i} role="cell" className="py-t"><i style={{ height: `${Math.round((v / maxT) * 100)}%` }} aria-hidden="true" /><span className="num">{v > 0.05 ? h0(v) : ''}</span></div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="py-legend faint"><i className="ok" />{tr('bis 85 % ausgelastet', 'up to 85 % loaded')}<i className="warn" />{tr('85–100 %', '85–100 %')}<i className="bad" />{tr('über 100 % oder keine Zeit', 'over 100 % or no time')}<i className="late" />{tr('nach dem Due', 'after the due date')}</div>
    </div>
  );
}
