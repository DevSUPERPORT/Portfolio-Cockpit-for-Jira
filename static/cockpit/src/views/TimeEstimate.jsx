import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { estimateVsSpent, resolvePeriod } from '@shared/engine.js';
import { isoOf, workdays } from '@shared/dates.js';
import { useApp } from '../state.jsx';
import { exportTime } from '../lib/books.js';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { Segmented, Stat, Empty, Avatar, stagger, spring, useTip, infoCard } from '../components/ui.jsx';
import BookingCard from '../components/BookingCard.jsx';

export default function TimeEstimate() {
  const app = useApp();
  const { computed, ds, config } = app;
  const { model } = computed;
  const tip = useTip();
  const [kind, setKind] = useState('month');
  const [level, setLevel] = useState('teams');
  const [from, setFrom] = useState(isoOf(model.today - 30));
  const [to, setTo] = useState(isoOf(model.today));
  const [open, setOpen] = useState(null);
  const personLevel = ds.personLevel !== false && config.rules?.personLevel !== false;
  const period = resolvePeriod(kind, model.today, from, to);
  const res = useMemo(() => (period.valid ? estimateVsSpent(model, period.a, period.b) : null), [model, period.a, period.b, period.valid]);
  const thr = (config.rules?.deviationThresholdPct ?? 15) / 100;
  const rows = res ? (level === 'persons' && personLevel ? res.persons : res.teams) : [];
  const max = Math.max(1, ...rows.flatMap((r) => [r.est, r.logged]));
  const name = (r) => (level === 'persons' ? ds.people?.[r.id]?.name || tr('Unbekannt', 'Unknown') : model.teams.get(r.id)?.name || (r.id === '_none' ? tr('Ohne Team', 'No team') : r.id));
  return (
    <div className="page">
      <section className="card card-pad">
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 14 }}>
          <div className="row wrap" style={{ gap: 12 }}>
            <Segmented value={kind} onChange={setKind} label={tr('Zeitraum', 'Period')} options={[
              { value: 'month', label: tr('Monat', 'Month') }, { value: 'quarter', label: tr('Quartal', 'Quarter') },
              { value: 'last4', label: tr('Letzte 4 Wochen', 'Last 4 weeks') }, { value: 'custom', label: tr('Eigener Zeitraum', 'Custom period') }]} />
            <AnimatePresence>
              {kind === 'custom' && (
                <motion.div className="row" style={{ gap: 8 }} initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }}>
                  <input type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={tr('Von', 'From')} />
                  <span className="muted">–</span>
                  <input type="date" className="input input-sm" value={to} onChange={(e) => setTo(e.target.value)} aria-label={tr('Bis', 'To')} />
                  {period.valid ? <span className="chip num">{period.workdays} {tr('Arbeitstage', 'working days')}</span> : <span className="chip chip-bad"><Icon name="alert" size={12} />{tr('Ungültiger Zeitraum', 'Invalid period')}</span>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="row" style={{ gap: 8 }}>{res && <button className="btn btn-sm" onClick={() => exportTime(app, res, `${fmt.dateLong(isoOf(period.a))} – ${fmt.dateLong(isoOf(period.b))}`).catch((e) => app.toast({ text: e.message, error: true }))} title={tr('Als Excel herunterladen', 'Download as Excel')}><Icon name="download" size={13} />Excel</button>}
          <Segmented value={level} onChange={setLevel} label={tr('Ebene', 'Level')} options={[{ value: 'teams', label: 'Teams', icon: 'users' }, { value: 'persons', label: tr('Personen', 'People'), icon: 'user', disabled: !personLevel, title: personLevel ? undefined : tr('Personenebene ist deaktiviert', 'Person level is disabled') }]} /></div>
        </div>
        {period.valid && <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{fmt.dateLong(isoOf(period.a))} – {fmt.dateLong(isoOf(period.b))} · {workdays(period.a, period.b)} {tr('Arbeitstage', 'working days')}
          {res?.undated > 0 && <span style={{ color: 'var(--warn)' }}> · {tr(`${res.undated} Stories ohne Termine nicht eingerechnet`, `${res.undated} stories without dates not counted`)}</span>}</div>}
      </section>

      {!res ? <div className="card"><Empty icon="calendar" title={tr('Bitte einen gültigen Zeitraum wählen', 'Please choose a valid period')}>{tr('„Bis" muss nach „Von" liegen.', '"To" must be after "From".')}</Empty></div> : <>
        <div className="stats">
          <Stat i={0} label={tr('Geschätzt', 'Estimated')} value={res.est} format={(v) => fmt.h(v)} foot={tr('Original Estimate der Stories, linear verteilt', 'Stories\' Original Estimate, spread linearly')}
            explain={{ text: tr('Der Teil des Original Estimate jeder Story, der in diesen Zeitraum fällt – gleichmäßig auf die Arbeitstage zwischen Start und Due Date verteilt.', 'The part of each story\'s original estimate that falls into this period – spread evenly over the working days between start and due date.'), calc: `${tr('Summe', 'Total')} = ${fmt.h(res.est, 1)}`, hint: res.undated ? tr(`${res.undated} Stories ohne Termine sind nicht eingerechnet`, `${res.undated} stories without dates are not counted`) : null }} />
          <Stat i={1} label={tr('Erfasst', 'Logged')} value={res.logged} format={(v) => fmt.h(v)} foot={tr('Worklogs mit Datum im Zeitraum', 'Worklogs dated in the period')}
            explain={{ text: tr('Alle in Jira gebuchten Worklogs mit einem Datum in diesem Zeitraum, auf den Stories des Portfolios.', 'All worklogs booked in Jira with a date in this period, on the portfolio\'s stories.'), calc: `${tr('Summe', 'Total')} = ${fmt.h(res.logged, 1)}` }} />
          <Stat i={2} label={tr('Abweichung', 'Deviation')} value={res.dev} format={(v) => fmt.signedH(v)} hot={Math.abs(res.devPct) >= thr} foot={fmt.signedPct(res.devPct)}
            explain={{ text: tr('Erfasst minus geschätzt. Ab der eingestellten Schwelle wird die Kachel orange.', 'Logged minus estimated. From the configured threshold on the tile turns orange.'), calc: `${fmt.h(res.logged, 1)} − ${fmt.h(res.est, 1)} = ${fmt.signedH(res.dev)} (${fmt.signedPct(res.devPct)})`, inputs: [[tr('Schwelle', 'Threshold'), fmt.pct(thr)]] }} />
        </div>
        <section className="card">
          <div className="card-head">
            <h2 className="card-title"><Icon name="clock" />{level === 'teams' ? tr('Je Team', 'Per team') : tr('Je Person', 'Per person')}</h2>
            <div className="bar-legend"><span><i style={{ border: '1.5px solid var(--ink)', background: 'transparent' }} />{tr('Geschätzt', 'Estimated')}</span><span><i style={{ background: 'var(--ink)' }} />{tr('Erfasst', 'Logged')}</span><span><i style={{ background: 'var(--accent)' }} />{tr(`Abweichung ab ${fmt.pct(thr)}`, `Deviation from ${fmt.pct(thr)}`)}</span></div>
          </div>
          {rows.length === 0 ? <Empty icon="clock" title={tr('Keine Schätzungen oder Worklogs in diesem Zeitraum', 'No estimates or worklogs in this period')} /> : (
            <div>
              {rows.map((r, i) => {
                const hot = Math.abs(r.devPct) >= thr && (r.est > 0 || r.logged > 0);
                const rowCard = infoCard({
                  title: name(r), sub: hot ? tr('über der Schwelle', 'above the threshold') : tr('im Rahmen', 'within range'),
                  text: tr('Geschätzt = Anteil des Original Estimate im Zeitraum; erfasst = Worklogs mit Datum im Zeitraum.', 'Estimated = share of the original estimate in the period; logged = worklogs dated in the period.'),
                  calc: `${fmt.h(r.logged, 1)} − ${fmt.h(r.est, 1)} = ${fmt.signedH(r.dev)} (${fmt.signedPct(r.devPct)})`,
                  inputs: [[tr('Geschätzt', 'Estimated'), fmt.h(r.est, 1)], [tr('Erfasst', 'Logged'), fmt.h(r.logged, 1)], [tr('Schwelle', 'Threshold'), fmt.pct(thr)]],
                  items: (r.byProject || []).filter((x) => x.logged > 0 || x.est > 0).map((x) => ({ text: computed.model.itemByRef.get(x.ref)?.name || x.ref, sub: `${fmt.h(x.logged || 0, 1)} ${tr('erfasst', 'logged')}${x.est != null ? ` · ${fmt.h(x.est, 1)} ${tr('geschätzt', 'estimated')}` : ''}`, tone: 'ok' })),
                  itemsTitle: tr('Je Projekt', 'Per project'),
                });
                const isOpen = open === r.id && level === 'teams';
                return (
                  <motion.div key={r.id} {...stagger(i, 0.03)} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '220px minmax(0,1fr) 110px 90px 120px', gap: 16, alignItems: 'center', padding: '12px 20px' }}>
                      <div className="row" style={{ gap: 8, minWidth: 0 }}>{level === 'persons' && <Avatar user={ds.people?.[r.id]} size={24} />}<b style={{ fontWeight: 540, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name(r)}</b></div>
                      <div tabIndex={0} {...tip(rowCard)}><TwinBar est={r.est} logged={r.logged} max={max} hot={hot} /></div>
                      <span className="num" style={{ textAlign: 'right', fontSize: 13 }}>{fmt.h(r.logged)} / {fmt.h(r.est)}</span>
                      <span className={`chip ${hot ? (r.dev > 0 ? 'chip-bad' : 'chip-warn') : 'chip-outline'} num`} style={{ justifySelf: 'end' }} tabIndex={0} {...tip(rowCard)}>{fmt.signedPct(r.devPct)}</span>
                      {level === 'teams' ? <button className="btn btn-ghost btn-sm" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>{tr('Nach Projekt', 'By project')}<motion.span animate={{ rotate: isOpen ? 180 : 0 }} style={{ display: 'grid' }}><Icon name="chevronDown" size={14} /></motion.span></button> : <span />}
                    </div>
                    <AnimatePresence>
                      {isOpen && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}><ByProject r={r} /></motion.div>}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>
      </>}
      <BookingCard period={period} />
    </div>
  );
}
function TwinBar({ est, logged, max, hot }) {
  return (
    <div style={{ position: 'relative', height: 22 }}>
      <motion.div initial={{ width: 0 }} animate={{ width: `${(est / max) * 100}%` }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} style={{ position: 'absolute', top: 0, height: 9, border: '1.5px solid var(--ink)', borderRadius: 5 }} />
      <motion.div initial={{ width: 0 }} animate={{ width: `${(logged / max) * 100}%` }} transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }} style={{ position: 'absolute', top: 12, height: 9, background: hot ? 'var(--accent)' : 'var(--ink)', borderRadius: 5 }} />
    </div>
  );
}
const PALETTE = ['#262729', '#E34B04', '#8F8B82', '#C98A06', '#3D5BA6', '#2F7D57', '#B05B8C', '#5E8C9A'];
function ByProject({ r }) {
  const { computed } = useApp();
  const tip = useTip();
  const total = r.byProject.reduce((a, p) => a + p.logged, 0) || 1;
  return (
    <div style={{ padding: '0 20px 16px 256px' }}>
      <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: 'var(--sunken)' }}>
        {r.byProject.filter((p) => p.logged > 0).map((p, i) => (
          <motion.div key={p.ref} initial={{ width: 0 }} animate={{ width: `${(p.logged / total) * 100}%` }} transition={{ ...spring, delay: i * 0.04 }} style={{ background: PALETTE[i % PALETTE.length] }}
            {...tip(<div><b>{computed.model.itemByRef.get(p.ref)?.name}</b> · {fmt.h(p.logged)} ({fmt.pct(p.logged / total)})</div>)} />
        ))}
      </div>
      <div className="row wrap" style={{ gap: 14, marginTop: 10, fontSize: 12.5 }}>
        {r.byProject.map((p, i) => (
          <span key={p.ref} className="row" style={{ gap: 6 }}>
            <i style={{ width: 8, height: 8, borderRadius: 3, background: PALETTE[i % PALETTE.length], display: 'inline-block' }} />
            {computed.model.itemByRef.get(p.ref)?.name || p.ref}<span className="muted num">{fmt.h(p.logged)} / {fmt.h(p.est)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
