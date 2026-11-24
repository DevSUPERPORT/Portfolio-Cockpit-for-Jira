// "Gebuchte Stunden je Mitarbeiter": possible working time vs. booked time per person, with status.
// Person-level values (UC-08): the role's privacy scope decides – all teams, own teams (others as one
// "nur Summe" row per team) or none. The server enforces the same rule and never sends hidden people.
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { bookingOverview, bookingRange, BOOKING_DEFAULTS } from '@shared/booking.js';
import { isoOf } from '@shared/dates.js';
import { allocationOf } from '@shared/allocation.js';
import { useApp, errText } from '../state.jsx';
import { call } from '../lib/api.js';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { Segmented, Empty, Avatar, Skeleton, useTip, stagger } from './ui.jsx';

export default function BookingCard({ period }) {
  const { computed, ds, config, roles } = useApp();
  const { model } = computed;
  const tip = useTip();
  const bk = { ...BOOKING_DEFAULTS, ...(config.booking || {}) };
  const personLevel = ds.personLevel !== false && config.rules?.personLevel !== false;
  const allowed = roles.logs ? roles.logs !== 'none' : (roles.editCapacity || roles.viewReport || roles.admin);
  const range = useMemo(() => (period.valid ? bookingRange(period.a, period.b, model.today, bk.graceDays) : null), [period.a, period.b, period.valid, model.today, bk.graceDays]);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('all');
  const [team, setTeam] = useState('all');
  const from = range?.valid ? isoOf(range.a) : null, to = range?.valid ? isoOf(range.b) : null;
  useEffect(() => {
    if (!personLevel || !allowed || !from) return undefined;
    let live = true;
    setData(null); setErr(null);
    call('booking.worklogs', { from, to }).then((r) => { if (live) setData(r); }).catch((e) => { if (live) setErr(e); });
    return () => { live = false; };
  }, [from, to, personLevel, allowed]);

  if (!personLevel) return <section className="card card-pad"><div className="callout"><Icon name="lock" />{tr('Gebuchte Stunden je Mitarbeiter sind ausgeblendet, weil Werte auf Personenebene in der Konfiguration deaktiviert sind.', 'Booked hours per person are hidden because person-level values are switched off in the configuration.')}</div></section>;
  if (!allowed) return null;
  const ov = data ? foldHidden(bookingOverview(model, data, range.a, range.b, config), data, bk, ds.capacity?.people) : null;
  const teamName = (id) => model.teams.get(id)?.name || tr('Ohne Team', 'No team');
  const teams = ov ? [...new Set(ov.rows.map((r) => r.teamId).filter(Boolean))].sort((a, b) => teamName(a).localeCompare(teamName(b), 'de')) : [];
  const rows = ov ? ov.rows.filter((r) => (team === 'all' || r.teamId === team) && (filter === 'all' || r.level === 'esc' || r.level === 'info') && (r.possible > 0 || r.booked > 0)) : [];
  const esc = ov ? ov.rows.filter((r) => r.level === 'esc').length : 0, info = ov ? ov.rows.filter((r) => r.level === 'info').length : 0;
  const sentence = !bk.enabled ? tr('Buchungskontrolle ist in der Konfiguration ausgeschaltet – Werte nur zur Ansicht, keine Hinweise oder Eskalationen.', 'The booking check is switched off in the configuration – values for viewing only, no hints or escalations.')
    : !esc && !info ? tr(`Alle Mitarbeiter haben mindestens ${bk.minPct} % ihrer möglichen Arbeitszeit gebucht.`, `Everyone has booked at least ${bk.minPct}% of their possible working time.`)
      : [info ? tr(`${info} ${info === 1 ? 'Person' : 'Personen'} unter ${bk.minPct} % – Hinweis`, `${info} ${info === 1 ? 'person' : 'people'} below ${bk.minPct}% – hint`) : null,
        esc ? tr(`${esc} ${esc === 1 ? 'Person' : 'Personen'} mit ${bk.escalatePct} % oder mehr fehlend – Eskalation`, `${esc} ${esc === 1 ? 'person' : 'people'} with ${bk.escalatePct}% or more missing – escalation`) : null].filter(Boolean).join(' · ') + '.';
  const mark = (bk.minPct / 110) * 100;
  return (
    <section className="card" aria-label={tr('Gebuchte Stunden je Mitarbeiter', 'Booked hours per person')}>
      <div className="card-head">
        <div>
          <h2 className="card-title"><Icon name="user" />{tr('Gebuchte Stunden je Mitarbeiter', 'Booked hours per person')}</h2>
          <div className="card-sub" style={{ marginTop: 3 }}>{range?.valid ? `${fmt.date(isoOf(range.a))} – ${fmt.date(isoOf(range.b))}` : '–'} · {tr(`Mindestquote ${bk.minPct} % der möglichen Arbeitszeit · Eskalation ab ${bk.escalatePct} % fehlend`, `minimum ${bk.minPct}% of possible working time · escalation from ${bk.escalatePct}% missing`)}</div>
        </div>
        <Segmented size="sm" value={filter} onChange={setFilter} label={tr('Filter', 'Filter')} options={[{ value: 'all', label: tr('Alle', 'All') }, { value: 'flag', label: tr('Nur Auffällige', 'Flagged only') }]} />
      </div>
      {!range?.valid ? <Empty icon="calendar" title={tr('Kein Zeitraum bis heute', 'No period up to today')}>{tr('Der gewählte Zeitraum liegt in der Zukunft oder in der Nachbuchfrist.', 'The chosen period lies in the future or within the grace period.')}</Empty>
        : err ? <div className="card-pad"><div className="callout accent"><Icon name="alert" />{errText(err)}</div></div>
          : !ov ? <div className="card-pad stack" style={{ gap: 8 }}>{[0, 1, 2, 3].map((k) => <Skeleton key={k} h={34} />)}</div> : <>
            <div className="row wrap" style={{ gap: 6, padding: '12px 20px 0' }} role="group" aria-label="Team">
              {['all', ...teams].map((t) => <button key={t} type="button" className={`chip ${team === t ? 'chip-accent' : 'chip-outline'}`} style={{ height: 28 }} aria-pressed={team === t} onClick={() => setTeam(t)}>{t === 'all' ? tr('Alle', 'All') : teamName(t)}</button>)}
            </div>
            <div className={`callout ${bk.enabled && (esc || info) ? 'accent' : ''}`} style={{ margin: '12px 20px 0' }}><Icon name={bk.enabled && (esc || info) ? 'alert' : 'check'} />{sentence}</div>
            {data?.truncated && <div className="callout" style={{ margin: '8px 20px 0' }}><Icon name="info" />{tr('Sehr viele Worklogs im Zeitraum – nur ein Teil wurde gelesen. Bitte einen kürzeren Zeitraum wählen.', 'Very many worklogs in the period – only part was read. Please choose a shorter period.')}</div>}
            {rows.length === 0 ? <Empty icon="check" title={tr('Niemand in dieser Auswahl', 'Nobody in this selection')} /> : (
              <div className="table-scroll" tabIndex={0} role="region" aria-label={tr('Gebuchte Stunden, mit Pfeiltasten scrollbar', 'Booked hours, scrollable with arrow keys')} style={{ marginTop: 10 }}>
                <table className="table book-table">
                  <thead><tr><th>{tr('Person', 'Person')}</th><th>Team</th><th className="num">{tr('Möglich', 'Possible')}</th><th className="num">{tr('Gebucht', 'Booked')}</th><th>{tr('Quote', 'Quote')}</th><th className="num">{tr('Fehlend', 'Missing')}</th><th>{tr('Letzte Buchung', 'Last booking')}</th><th>Status</th></tr></thead>
                  <tbody>
                    {rows.map((r, k) => {
                      const st = !bk.enabled ? null : r.level;
                      const statusEl = st === 'esc' ? <span className="chip chip-accent" {...tip(<div>{tr(`${r.missPct} % der möglichen Arbeitszeit fehlen (Schwelle ${bk.escalatePct} %) – Eskalation`, `${r.missPct}% of the possible working time missing (threshold ${bk.escalatePct}%) – escalation`)}</div>)}>{tr('Eskalation', 'Escalation')}</span>
                        : st === 'info' ? <span className="chip chip-outline book-hint" {...tip(<div>{tr(`Unter ${bk.minPct} % der möglichen Arbeitszeit gebucht – Hinweis`, `Below ${bk.minPct}% of the possible working time booked – hint`)}</div>)}>{tr('Hinweis', 'Hint')}</span>
                          : st === 'none' ? <span className="chip chip-outline">{tr('keine Sollzeit', 'no target time')}</span>
                            : st === 'ok' ? <span className="chip chip-ok" {...tip(<div>{tr('Mindestquote erreicht', 'Minimum reached')}</div>)}>OK</span> : <span className="faint">–</span>;
                      const fill = r.level === 'esc' ? 'var(--accent)' : r.level === 'info' ? 'color-mix(in srgb, var(--accent) 45%, var(--sunken))' : 'var(--ink)';
                      return (
                        <motion.tr key={r.id} {...stagger(k, 0.012)} className={bk.enabled && r.level === 'esc' ? 'book-esc' : undefined}>
                          <td>{r.sum ? <span className="row" style={{ gap: 8 }}><span className="sum-ico"><Icon name="users" size={12} /></span><span>{tr('nur Summe', 'sum only')} <span className="faint">· {r.n} {r.n === 1 ? tr('Person', 'person') : tr('Personen', 'people')}</span></span></span> : <span className="row" style={{ gap: 8 }}><Avatar user={ds.people?.[r.id]} size={22} />{ds.people?.[r.id]?.name || tr('Unbekannt', 'Unknown')}</span>}</td>
                          <td>{r.teamId ? teamName(r.teamId) : <span className="faint">–</span>}</td>
                          <td className="num">{fmt.h(r.possible)}<div className="faint" style={{ fontSize: 11.5 }}>{r.days} {tr('Arbeitstage', 'workdays')}{r.off ? ` · ${r.off} ${tr('abwesend/Feiertag', 'absent/holiday')}` : ''}</div></td>
                          <td className="num">{fmt.h(r.booked)}<div className="faint" style={{ fontSize: 11.5 }}>{tr('davon Support', 'of which support')} {fmt.h(r.support)}</div></td>
                          <td style={{ minWidth: 150 }}>
                            {r.pct == null ? <span className="faint">–</span> : (
                              <div className="book-quote">
                                <div className="book-track"><span style={{ width: `${Math.min(100, (r.pct / 110) * 100)}%`, background: fill }} /><i style={{ left: `${mark}%` }} /></div>
                                <b className="num" style={{ color: r.level === 'ok' ? undefined : 'var(--accent-strong)' }}>{r.pct} %</b>
                              </div>
                            )}
                          </td>
                          <td className="num" style={{ color: bk.enabled && r.level === 'esc' ? 'var(--bad)' : 'var(--ink-2)', fontWeight: bk.enabled && r.level === 'esc' ? 600 : undefined }}>{r.missing > 0.5 ? `${fmt.h(r.missing)} (${r.missPct} %)` : '–'}</td>
                          <td>{r.last ? fmt.date(r.last) : <span className="faint">–</span>}</td>
                          <td>{statusEl}</td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="faint" style={{ fontSize: 12, padding: '10px 20px 14px' }}>{tr(`Mögliche Arbeitszeit = Wochenstunden laut Kapazität ÷ 5 × Arbeitstage im Zeitraum, ohne Feiertage und Abwesenheiten${range.graced ? `, bis heute abzüglich ${range.graced} Arbeitstage Nachbuchfrist` : ''}. Gebucht = alle Worklogs der Person, die du sehen darfst (Projekte, Support und andere Arbeit). Fehlend = mögliche Arbeitszeit minus gebucht. Strich = Mindestquote ${bk.minPct} %.`,
              `Possible working time = weekly hours from capacity ÷ 5 × workdays in the period, without public holidays and absences${range.graced ? `, up to today minus a ${range.graced}-workday grace period` : ''}. Booked = all of the person's worklogs you may see (projects, support and other work). Missing = possible working time minus booked. Line = minimum ${bk.minPct}%.`)}</div>
          </>}
    </section>
  );
}

// Teams outside the viewer's privacy scope: their members arrive as pseudonyms without bookings – fold them
// into one "nur Summe" row per team (possible from capacity, booked from the server's team totals). A person split
// across teams (UC-14) adds their possible time to each team × their share there – the server splits the booked
// hours the same way.
function foldHidden(ov, data, bk, capPeople = {}) {
  if (!ov || !data?.hidden) return ov;
  const rows = [], sums = new Map();
  for (const r of ov.rows) {
    if (!String(r.id).startsWith('anon-')) { rows.push(r); continue; }
    const split = allocationOf({ teamId: r.teamId, teams: capPeople?.[r.id]?.teams });
    for (const { teamId, pct } of split.length ? split : [{ teamId: '_none', pct: 100 }]) {
      const x = sums.get(teamId) || { possible: 0, n: 0, days: 0 };
      x.possible += (r.possible * pct) / 100; x.n += 1; x.days = Math.max(x.days, r.days);
      sums.set(teamId, x);
    }
  }
  for (const [t, x] of sums) {
    const booked = data.hidden[t]?.h || 0;
    const pct = x.possible > 0 ? Math.round((booked / x.possible) * 100) : null;
    const missPct = pct == null ? 0 : Math.max(0, 100 - pct);
    rows.push({ id: `sum:${t}`, sum: true, n: x.n, teamId: t === '_none' ? null : t, days: x.days, off: 0, possible: x.possible, booked, support: 0, pct, missing: Math.max(0, x.possible - booked), missPct, last: null,
      level: x.possible <= 0 ? 'none' : pct >= bk.minPct ? 'ok' : missPct >= bk.escalatePct ? 'esc' : 'info' });
  }
  return { ...ov, rows };
}
