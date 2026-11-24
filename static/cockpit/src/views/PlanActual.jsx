// "Plan vs. Ist" (UC-04): the weekly plan snapshots against the worklogs – where did the hours go, and why did a
// project get fewer than planned? Below: booked hours per person (UC-19) for the same weeks.
// Data: call('planActual.get', { weeks, team: 'all' }) – one fetch per period; switching teams filters on the client
// (instant). People of teams the user may not see arrive as one "sum only" row per team.
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { analyzePlanActual, snapshotDue, validSnapshot, weekNo, isProjectKey, withPortfolioRanks } from '@shared/planActual.js';
import { dayIdx, ymdIdx } from '@shared/dates.js';
import { useApp, errText } from '../state.jsx';
import { call } from '../lib/api.js';
import { tr, fmt, getLang } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { Segmented, Stat, Avatar, Skeleton, useTip, infoCard } from '../components/ui.jsx';
import BookingCard from '../components/BookingCard.jsx';
import TimeEstimate from './TimeEstimate.jsx';
import AiAssist from '../components/AiAssist.jsx';
import { LotseChip } from '../components/lotse/LotseChip.jsx';
import { planActualPayload } from '@shared/aiPayload.js';
import './PlanActual.css';

const EASE = [0.22, 1, 0.36, 1];
const DAY_LONG = { mon: ['Montag', 'Monday'], tue: ['Dienstag', 'Tuesday'], wed: ['Mittwoch', 'Wednesday'], thu: ['Donnerstag', 'Thursday'], fri: ['Freitag', 'Friday'] };
const rise = (i = 0, base = 0.04) => ({ initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.42, ease: EASE, delay: Math.min(i * base, 0.4) } });
const hOrDash = (v) => (v >= 0.5 ? fmt.h(v) : '–');
const signed = (v) => fmt.signedH(Math.round(v));
const causeKind = (k) => (k === 'SUP' ? 'sup' : k === 'ABS' ? 'abs' : k === 'INT' ? 'int' : k === 'REST' ? 'rest' : k === 'OTHER' ? 'other' : 'proj');
const CAUSE_TEXT = {
  sup: () => tr('Support-Stunden über der geplanten Reserve – bei den Personen, die für dieses Projekt eingeplant waren.', 'Support hours above the planned reserve – booked by the people planned for this project.'),
  abs: () => tr('Abwesenheiten, die beim Snapshot noch nicht eingetragen waren (z. B. Krankheit).', 'Absences that were not entered yet when the snapshot was taken (e.g. sick leave).'),
  int: () => tr('Buchungen auf Work Items außerhalb des Portfolios und außerhalb des Supports.', 'Bookings on work items outside the portfolio and outside support.'),
  other: () => tr('Mehrere kleine Abflüsse unter 2 h – in andere Projekte, Support oder interne Arbeit.', 'Several small flows below 2 h – into other projects, support or internal work.'),
  rest: () => tr('Der Rest: Stunden, die weder hier noch anderswo gebucht wurden.', 'The rest: hours that were booked neither here nor anywhere else.'),
  proj: () => tr('Die eingeplanten Personen haben stattdessen mehr als geplant auf diesem Projekt gebucht.', 'The planned people booked more than planned on this project instead.'),
};

export default function PlanActual() {
  const { ds, lang } = useApp();
  const [weeks, setWeeks] = useState(4);
  const [team, setTeam] = useState('all');
  const [level, setLevel] = useState('projects');
  const [res, setRes] = useState({ data: null, err: null, busy: true });
  useEffect(() => {
    let live = true;
    setRes((r) => ({ ...r, busy: true }));
    call('planActual.get', { weeks, team: 'all' })
      .then((data) => { if (live) setRes({ data, err: null, busy: false }); })
      .catch((err) => { if (live) setRes((r) => ({ data: r.data, err, busy: false })); });
    return () => { live = false; };
  }, [weeks]);
  // ranks exactly as this viewer's Portfolio numbers them (same source: the dataset's portfolio)
  const data = useMemo(() => withPortfolioRanks(res.data, ds?.portfolio), [res.data, ds?.portfolio]);
  const { err, busy } = res;
  const summaries = useMemo(() => new Map((ds?.issues || []).map((i) => [i.key, i.summary])), [ds]);
  const teams = data?.teams || [];
  const sel = team === 'all' || teams.some((t) => t.id === team) ? team : 'all';
  const a = useMemo(() => (data?.state === 'ready' ? analyzePlanActual(data, { lang: getLang(), team: sel, summaryOf: (k) => summaries.get(k) || null }) : null), [data, sel, summaries, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data && busy) return <Loading />;
  if (!data && err) {
    return (
      <div className="pa-fallback">
        {err.code !== 'NO_ACCESS' && <div className="page pa-page" style={{ paddingBottom: 0 }}><div className="callout accent"><Icon name="alert" />{errText(err)}</div></div>}
        <TimeEstimate />
      </div>
    );
  }
  if (data.state !== 'ready') return <NotYet data={data} />;

  const first = data.weeks[0], last = data.weeks.at(-1);
  const period = { a: dayIdx(first.from), b: dayIdx(last.to), valid: true };
  const provisional = a.provisional.map(weekNo);
  return (
    <div className="page pa-page">
      <Header a={a} data={data} weeks={weeks} setWeeks={setWeeks} busy={busy} provisional={provisional} />
      <TeamPills teams={teams} value={sel} onChange={setTeam} />
      <div className={`pa-dim ${busy ? 'is-busy' : ''}`}>
        <Kpis a={a} />
        <div className="row" style={{ justifyContent: 'flex-end' }}><LotseChip skill="planActualExplain" params={{ team: sel === 'all' ? null : sel }} extra={{ planActual: data }} label={tr('Lotse: Plan vs. Ist erklärt', 'Lotse: plan vs. actual explained')} /></div>
        {/* KI-Assistent: what happened and what to do – a narrative from the numbers above, nothing is changed */}
        <AiAssist feature="planActual" className="pa-ai" label={tr('Was ist passiert – und was tun?', 'What happened – and what to do?')} title={`Plan vs. ${tr('Ist', 'actual')} · ${a.period}`}
          build={() => planActualPayload(a, { weeks, teamName: sel === 'all' ? null : teams.find((t) => t.id === sel)?.name })}
          lotseExtra={{ planActual: data, teamId: sel === 'all' ? null : sel }}
          copy={(r) => [r.text, ...(r.points || []).map((x) => `- ${x}`)].join('\n')} />
        <Flow a={a} data={data} level={level} setLevel={setLevel} />
        <Why a={a} />
      </div>
      <BookingCard period={period} />
    </div>
  );
}

function InfoDot({ card, label }) {
  const tip = useTip();
  return <span className="pa-info" tabIndex={0} role="img" aria-label={label || tr('Erklärung', 'Explanation')} {...tip(infoCard(card))}><Icon name="info" size={14} /></span>;
}

function Header({ a, data, weeks, setWeeks, busy, provisional }) {
  const s = validSnapshot(data.schedule);
  const first = data.weeks[0], last = data.weeks.at(-1);
  return (
    <motion.header className="pa-head" {...rise(0)}>
      <div className="pa-headline">
        <div className="row" style={{ gap: 8 }}>
          <h2 className="pa-title">Plan vs. {tr('Ist', 'actual')} <span className="pa-sep">·</span> <span className="num">{a.period}</span></h2>
          <InfoDot card={{
            title: tr('Plan vs. Ist', 'Plan vs. actual'),
            text: tr('Geplant = Stand der Wochenplanung, den die App einmal pro Woche speichert (Snapshot), inklusive Support-Reserve. Gebucht = Worklogs der Woche. So bleibt nachvollziehbar, wohin Stunden statt des Plans geflossen sind – auch wenn Start und Due date später geändert wurden.',
              'Planned = the state of the weekly plan the app saves once a week (snapshot), including the support reserve. Booked = the week\'s worklogs. So you can trace where hours went instead of the plan – even when start and due dates changed later.'),
            inputs: [[tr('Snapshot', 'Snapshot'), `${tr(DAY_LONG[s.day][0], DAY_LONG[s.day][1])} ${s.time}`], [tr('Wochen', 'Weeks'), String(data.weeks.length)]],
          }} />
          {busy && <span className="pa-spin" aria-hidden="true" />}
        </div>
        <div className="pa-subline">
          {fmt.date(first.from, { day: '2-digit', month: 'short' })} – {fmt.dateLong(last.to)}
          {provisional.length > 0 && <span> · {tr(`KW ${provisional.join(', ')} noch vorläufig – nachgetragene Buchungen fließen nächste Woche ein`, `W ${provisional.join(', ')} still provisional – late bookings are added next week`)}</span>}
        </div>
      </div>
      <Segmented value={weeks} onChange={setWeeks} label={tr('Zeitraum', 'Period')} options={[{ value: 4, label: tr('Letzte 4 Wochen', 'Last 4 weeks') }, { value: 8, label: tr('Letzte 8 Wochen', 'Last 8 weeks') }]} />
    </motion.header>
  );
}

function TeamPills({ teams, value, onChange }) {
  const opts = [...teams.map((t) => ({ id: t.id, label: t.name || tr('Ohne Team', 'No team') })), { id: 'all', label: tr('Alle Teams', 'All teams') }];
  return (
    <motion.div className="pa-teams" role="group" aria-label="Team" {...rise(1)}>
      <span className="eyebrow" style={{ marginRight: 4 }}>Team</span>
      {opts.map((o) => (
        <button key={o.id} type="button" className="pa-pill" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {value === o.id && <motion.span layoutId="pa-team-pill" className="pa-pill-bg" transition={{ type: 'spring', stiffness: 380, damping: 34 }} />}
          <span className="pa-pill-text">{o.label}</span>
        </button>
      ))}
    </motion.div>
  );
}

function Kpis({ a }) {
  const k = a.kpis;
  return (
    <div className="stats pa-stats">
      <Stat i={0} label={tr('Geplant', 'Planned')} value={k.plan} format={(v) => fmt.h(v)} foot={tr('laut Wochen-Snapshot, inkl. Support-Reserve', 'per weekly snapshot, incl. support reserve')}
        explain={{ text: tr('Original Estimate der Tasks, gleichmäßig auf die Arbeitstage zwischen Start und Due date verteilt – so, wie die Woche beim Snapshot geplant war – plus Support-Reserve und geplante interne Arbeit.', 'The tasks\' Original Estimate spread evenly over the working days between start and due date – as the week was planned at the snapshot – plus support reserve and planned internal work.'), calc: `${tr('Summe', 'Total')} = ${fmt.h(k.plan)}` }} />
      <Stat i={1} label={tr('Gebucht', 'Booked')} value={k.book} format={(v) => fmt.h(v)} foot={tr('Worklogs im Zeitraum', 'Worklogs in the period')}
        explain={{ text: tr('Alle Worklogs der Wochen: auf Projekten des Portfolios, im Support und auf Work Items ohne Projekt.', 'All worklogs of the weeks: on portfolio projects, in support and on work items without a project.'), calc: `${tr('Summe', 'Total')} = ${fmt.h(k.book)}` }} />
      <Stat i={2} label={tr('Wie geplant', 'As planned')} value={k.asPlannedPct ?? 0} format={(v) => fmt.pct(v)} foot={tr(`${fmt.h(k.asPlanned)} dort gebucht, wo sie geplant waren`, `${fmt.h(k.asPlanned)} booked where they were planned`)}
        explain={{ text: tr('Der Anteil der geplanten Stunden, der auch dort gebucht wurde – je Projekt, Support und intern höchstens so viel wie geplant.', 'The share of planned hours that was booked where it was planned – per project, support and internal at most the planned amount.'), calc: `Σ min(${tr('geplant', 'planned')}, ${tr('gebucht', 'booked')}) ÷ Σ ${tr('geplant', 'planned')} = ${fmt.h(k.asPlanned)} ÷ ${fmt.h(k.plan)} = ${fmt.pct(k.asPlannedPct)}` }} />
      <Stat i={3} label={tr('Umgeleitet', 'Diverted')} value={k.diverted} format={(v) => fmt.h(v)} hot={k.divertedHot}
        foot={`${tr('mehr Support, andere Projekte, intern', 'more support, other projects, internal')}${k.absU >= 0.5 ? ` · ${fmt.h(k.absU)} ${tr('ungeplant abwesend', 'unplanned absence')}` : ''}`}
        explain={{ text: tr('Stunden, die nicht dort gelandet sind, wo sie geplant waren: mehr gebucht als geplant (je Bereich) plus ungeplante Abwesenheit.', 'Hours that did not land where they were planned: booked above plan (per area) plus unplanned absence.'), calc: `${fmt.h(k.divertedBooked)} + ${fmt.h(k.absU)} = ${fmt.h(k.diverted)}`,
          items: a.rows.filter((r) => r.book - r.plan >= 0.5).map((r) => ({ text: r.name, sub: `+${fmt.h(r.book - r.plan)}`, tone: r.kind === 'support' ? 'warn' : 'ok' })), itemsTitle: tr('Mehr als geplant', 'Above plan') }} />
    </div>
  );
}

function Flow({ a, data, level, setLevel }) {
  return (
    <section className="card pa-card">
      <div className="card-head">
        <div className="row" style={{ gap: 8 }}>
          <h3 className="card-title"><Icon name="waves" />{tr('Wohin sind die Stunden geflossen?', 'Where did the hours go?')}</h3>
          <InfoDot card={{ text: tr('Je Projekt, Support und interne Buchungen: was laut Snapshot geplant war und was tatsächlich gebucht wurde. Heller Balken = geplant, dunkler Balken = gebucht. Hervorgehoben ab 4 h und 5 % Abweichung. „Ungeplant“ = gebucht, ohne dass es geplant war.', 'Per project, support and internal bookings: what the snapshot planned and what was actually booked. Light bar = planned, dark bar = booked. Highlighted from 4 h and 5 % difference. "Unplanned" = booked without being planned.') }} />
        </div>
        <div className="row wrap" style={{ gap: 16 }}>
          <div className="bar-legend"><span><i className="pa-lg-plan" />{tr('Geplant', 'Planned')}</span><span><i style={{ background: 'var(--ink)' }} />{tr('Gebucht', 'Booked')}</span><span><i style={{ background: 'var(--accent)' }} />Support</span></div>
          <Segmented size="sm" value={level} onChange={setLevel} label={tr('Ebene', 'Level')} options={[{ value: 'projects', label: tr('Projekte', 'Projects'), icon: 'layers' }, { value: 'people', label: tr('Personen', 'People'), icon: 'user' }]} />
        </div>
      </div>
      <motion.div key={level} className="pa-scroll" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
        {level === 'projects' ? <FlowRows a={a} data={data} /> : <PeopleRows a={a} data={data} />}
      </motion.div>
    </section>
  );
}

function Bars({ plan, book, max, sup, delay = 0 }) {
  return (
    <div className="pa-bars" aria-hidden="true">
      <span className="pa-track"><motion.i className="pa-bar is-plan" initial={{ scaleX: 0 }} animate={{ scaleX: Math.min(1, plan / max) }} transition={{ duration: 0.75, ease: EASE, delay }} /></span>
      <span className="pa-track"><motion.i className={`pa-bar is-book ${sup ? 'is-sup' : ''}`} initial={{ scaleX: 0 }} animate={{ scaleX: Math.min(1, book / max) }} transition={{ duration: 0.75, ease: EASE, delay: delay + 0.06 }} /></span>
    </div>
  );
}

function FlowRows({ a, data }) {
  const tip = useTip();
  const k = a.kpis;
  const nameOf = (u) => (u.kind === 'team' ? tr(`Team ${teamLabel(data, u.teamId)} (Summe)`, `Team ${teamLabel(data, u.teamId)} (sum)`) : u.name || tr('Unbekannt', 'Unknown'));
  const unitsSel = (data.units || []).filter((u) => a.people.some((p) => p.id === u.id));
  if (!a.rows.length) return <div className="pa-calm"><Icon name="clock" />{tr('Keine geplanten oder gebuchten Stunden in diesem Zeitraum.', 'No planned or booked hours in this period.')}</div>;
  return (
    <div className="pa-grid pa-grid-flow" role="table" aria-label={tr('Wohin sind die Stunden geflossen?', 'Where did the hours go?')}>
      <div className="pa-row pa-row-head" role="row">
        <span role="columnheader">{tr('Bereich', 'Area')}</span><span role="columnheader">{tr('Vergleich', 'Comparison')}</span>
        <span role="columnheader" className="pa-num">{tr('Geplant', 'Planned')}</span><span role="columnheader" className="pa-num">{tr('Gebucht', 'Booked')}</span><span role="columnheader" className="pa-num">{tr('Differenz', 'Difference')}</span>
      </div>
      {a.rows.map((r, i) => {
        const who = unitsSel.map((u) => ({ u, p: u.plan?.[r.key] || 0, b: u.book?.[r.key] || 0 })).filter((x) => x.p >= 0.5 || x.b >= 0.5).sort((x, y) => Math.abs(y.b - y.p) - Math.abs(x.b - x.p));
        const card = infoCard({
          title: r.name, sub: r.sub,
          text: r.unplanned ? tr('Gebucht, ohne dass es geplant war.', 'Booked without being planned.') : r.sig ? tr('Die Abweichung liegt bei mindestens 4 h und 5 % – deshalb hervorgehoben.', 'The difference is at least 4 h and 5 % – hence highlighted.') : tr('Im Rahmen des Plans (unter 4 h oder 5 % Abweichung).', 'Within the plan (below 4 h or 5 % difference).'),
          calc: `${fmt.h(r.book)} − ${fmt.h(r.plan)} = ${signed(r.diff)}${r.share != null ? ` (${fmt.signedPct(r.share)})` : ''}`,
          items: who.map((x) => ({ text: nameOf(x.u), sub: `${tr('geplant', 'planned')} ${fmt.h(x.p)} · ${tr('gebucht', 'booked')} ${fmt.h(x.b)}`, tone: x.b + 2 < x.p ? 'warn' : 'ok' })),
          itemsTitle: tr('Wer', 'Who'),
        });
        return (
          <motion.div key={r.key} role="row" className={`pa-row ${r.kind === 'support' ? 'is-support' : ''}`} {...rise(i, 0.035)} tabIndex={0} {...tip(card)}>
            <span role="cell" className="pa-cell-name">
              <span className="pa-name"><b>{r.name}</b>{r.unplanned && <span className="pa-tag">{tr('ungeplant', 'unplanned')}</span>}</span>
              <span className="pa-sub">{r.sub}</span>
            </span>
            <span role="cell"><Bars plan={r.plan} book={r.book} max={a.max} sup={r.kind === 'support'} delay={Math.min(i * 0.035, 0.4)} /></span>
            <span role="cell" className="pa-num" data-label={tr('Geplant', 'Planned')}>{hOrDash(r.plan)}</span>
            <span role="cell" className="pa-num pa-strong" data-label={tr('Gebucht', 'Booked')}>{fmt.h(r.book)}</span>
            <span role="cell" className="pa-num" data-label={tr('Differenz', 'Difference')}><span className={`pa-diff tone-${r.tone}`}>{Math.round(r.diff) ? signed(r.diff) : '0 h'}</span></span>
          </motion.div>
        );
      })}
      <div className="pa-row pa-row-foot" role="row">
        <span role="cell"><b>{tr('Summe', 'Total')}</b>{k.absU >= 0.5 && <span className="pa-sub"> · {tr(`dazu ${fmt.h(k.absU)} ungeplant abwesend`, `plus ${fmt.h(k.absU)} unplanned absence`)}</span>}</span>
        <span role="cell" />
        <span role="cell" className="pa-num pa-strong" data-label={tr('Geplant', 'Planned')}>{fmt.h(k.plan)}</span>
        <span role="cell" className="pa-num pa-strong" data-label={tr('Gebucht', 'Booked')}>{fmt.h(k.book)}</span>
        <span role="cell" className="pa-num pa-strong" data-label={tr('Differenz', 'Difference')}>{signed(k.book - k.plan)}</span>
      </div>
    </div>
  );
}

const teamLabel = (data, id) => (id === '_none' ? tr('ohne Team', 'no team') : data.teams.find((t) => t.id === id)?.name || id);

function PeopleRows({ a, data }) {
  const tip = useTip();
  const { ds } = useApp();
  const byId = new Map((data.units || []).map((u) => [u.id, u]));
  const bucket = (k) => (k === 'SUP' ? 'Support' : k === 'INT' ? tr('Intern', 'Internal') : data.projects[k]?.name || k);
  if (!a.people.length) return <div className="pa-calm"><Icon name="user" />{tr('Keine Personen mit Plan oder Buchungen in diesem Zeitraum.', 'No people with a plan or bookings in this period.')}</div>;
  const onlySums = a.people.every((p) => p.kind === 'team');
  return (
    <>
      {onlySums && <div className="pa-note"><Icon name="lock" size={13} />{tr('Werte einzelner Personen siehst du nur für Teams, für die du freigegeben bist – alle anderen erscheinen als Summe.', 'You see individual values only for teams you are cleared for – all others appear as a sum.')}</div>}
      <div className="pa-grid pa-grid-people" role="table" aria-label={tr('Personen', 'People')}>
        <div className="pa-row pa-row-head" role="row">
          <span role="columnheader">{tr('Person', 'Person')}</span><span role="columnheader" className="pa-num">{tr('Geplant', 'Planned')}</span><span role="columnheader" className="pa-num">{tr('Gebucht', 'Booked')}</span>
          <span role="columnheader">{tr('Wie geplant', 'As planned')}</span><span role="columnheader" className="pa-num">{tr('Ungepl. abwesend', 'Unpl. absent')}</span><span role="columnheader">{tr('Größte Abweichung', 'Largest deviation')}</span>
        </div>
        {a.people.map((p, i) => {
          const u = byId.get(p.id) || {};
          const keys = [...new Set([...Object.keys(u.plan || {}), ...Object.keys(u.book || {})])].sort((x, y) => (x === 'SUP' ? -1 : y === 'SUP' ? 1 : isProjectKey(y) - isProjectKey(x)));
          const card = infoCard({
            title: p.name, sub: p.kind === 'team' ? tr('Summe ohne Einzelwerte', 'Sum without individual values') : p.teamName,
            calc: `Σ min(${tr('geplant', 'planned')}, ${tr('gebucht', 'booked')}) ÷ Σ ${tr('geplant', 'planned')} = ${fmt.h(p.asPlanned)} ÷ ${fmt.h(p.plan)} = ${fmt.pct(p.pct)}`,
            items: keys.map((x) => ({ text: bucket(x), sub: `${tr('geplant', 'planned')} ${fmt.h(u.plan?.[x] || 0)} · ${tr('gebucht', 'booked')} ${fmt.h(u.book?.[x] || 0)}`, tone: (u.book?.[x] || 0) + 2 < (u.plan?.[x] || 0) ? 'warn' : 'ok' })),
            itemsTitle: tr('Je Bereich', 'Per area'),
          });
          const low = p.pct != null && p.pct < 0.9;
          return (
            <motion.div key={p.id} role="row" className={`pa-row ${p.kind === 'team' ? 'is-sum' : ''}`} {...rise(i, 0.03)} tabIndex={0} {...tip(card)}>
              <span role="cell" className="pa-cell-person">
                {p.kind === 'team' ? <span className="pa-sum-ico"><Icon name="users" size={13} /></span> : <Avatar user={{ id: p.id, name: p.name || ds?.people?.[p.id]?.name }} size={26} />}
                <span className="pa-cell-name"><b>{p.name}</b>{p.kind !== 'team' && <span className="pa-sub">{p.teamName}</span>}</span>
              </span>
              <span role="cell" className="pa-num" data-label={tr('Geplant', 'Planned')}>{hOrDash(p.plan)}</span>
              <span role="cell" className="pa-num pa-strong" data-label={tr('Gebucht', 'Booked')}>{fmt.h(p.book)}</span>
              <span role="cell" className="pa-meter-cell" data-label={tr('Wie geplant', 'As planned')}>
                <span className="pa-meter"><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: Math.min(1, p.pct ?? 0) }} transition={{ duration: 0.7, ease: EASE, delay: Math.min(i * 0.03, 0.4) }} className={low ? 'is-low' : ''} /></span>
                <span className={`pa-num ${low ? 'pa-low' : ''}`}>{p.pct == null ? '–' : fmt.pct(p.pct)}</span>
              </span>
              <span role="cell" className="pa-num" data-label={tr('Ungepl. abwesend', 'Unpl. absent')}>{hOrDash(p.absU)}</span>
              <span role="cell" className={p.deviates ? 'pa-main' : 'pa-main is-calm'}>{p.main}</span>
            </motion.div>
          );
        })}
      </div>
    </>
  );
}

function Why({ a }) {
  return (
    <section className="card pa-card">
      <div className="card-head">
        <div className="row" style={{ gap: 8 }}>
          <h3 className="card-title"><Icon name="help" />{tr('Warum hat sich etwas verschoben?', 'Why did something shift?')}</h3>
          <InfoDot card={{ text: tr('Für jedes Projekt, das mindestens 4 h und 5 % weniger bekommen hat als geplant: wohin die Stunden der eingeplanten Personen stattdessen geflossen sind. Dazu Tasks, bei denen Time Spent plus Remaining Estimate mehr als 10 % über dem Original Estimate liegt.', 'For every project that got at least 4 h and 5 % fewer hours than planned: where the planned people\'s hours went instead. Plus tasks whose Time Spent plus Remaining Estimate exceeds the Original Estimate by more than 10 %.') }} />
        </div>
      </div>
      {a.why.length === 0
        ? <div className="pa-calm"><Icon name="check" />{tr('Alle Projekte haben im Zeitraum die geplanten Stunden bekommen.', 'Every project got its planned hours in this period.')}</div>
        : <div className="pa-why">{a.why.map((w, i) => <WhyCard key={w.key} w={w} i={i} />)}</div>}
    </section>
  );
}

function WhyCard({ w, i }) {
  const tip = useTip();
  const total = w.parts.reduce((s, p) => s + p.h, 0) || 1;
  return (
    <motion.article className="pa-why-card" {...rise(i, 0.06)}>
      <header className="pa-why-head">
        <div className="pa-cell-name"><b className="pa-why-name">{w.name}</b><span className="pa-sub">{w.rankText} · {w.planBook}</span></div>
        <span className="pa-why-diff num">{signed(w.diff)}</span>
      </header>
      <motion.div className="pa-parts" aria-hidden="true" initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} transition={{ duration: 0.7, ease: EASE, delay: 0.1 + Math.min(i * 0.06, 0.4) }}>
        {w.parts.map((p) => <i key={p.k} className={`k-${causeKind(p.k)}`} style={{ flexGrow: p.h / total }} />)}
      </motion.div>
      <p className="pa-sentence">{w.sentence}</p>
      <div className="pa-chips">
        {w.parts.map((p) => (
          <span key={p.k} className={`pa-chip k-${causeKind(p.k)}`} tabIndex={0} {...tip(infoCard({ title: p.chip, text: CAUSE_TEXT[causeKind(p.k)]() }))}><i />{p.chip}</span>
        ))}
      </div>
      {w.whoText && <div className="pa-meta"><Icon name="users" size={13} /><span>{w.whoText}</span></div>}
      {w.overText && <div className="pa-meta"><Icon name="clock" size={13} /><span>{w.overText}</span></div>}
    </motion.article>
  );
}

// Before the first evaluation: when the plan will be (or was) saved – and meanwhile the estimate-vs-spent view.
function NotYet({ data }) {
  const s = validSnapshot(data.schedule);
  const d = new Date();
  const next = snapshotDue(s, { day: ymdIdx(d.getFullYear(), d.getMonth() + 1, d.getDate()), min: d.getHours() * 60 + d.getMinutes() });
  const day = tr(DAY_LONG[s.day][0], DAY_LONG[s.day][1]);
  const when = fmt.date(next.nextIso, { weekday: 'long', day: '2-digit', month: '2-digit' });
  const none = data.state === 'none';
  return (
    <div className="pa-fallback">
      <div className="page pa-page" style={{ paddingBottom: 0 }}>
        <motion.section className="card pa-hello" {...rise(0)}>
          <motion.div className="pa-hello-ico" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.05 }}><Icon name="calendar" size={22} /></motion.div>
          <div className="stack" style={{ gap: 6 }}>
            <h2 className="pa-title" style={{ fontSize: 18 }}>Plan vs. {tr('Ist', 'actual')}</h2>
            <p className="pa-hello-text">
              {none
                ? tr(`Der erste Wochenplan wird am ${day} um ${s.time} gespeichert – ab dann siehst du hier, wohin die Zeit geflossen ist.`, `The first weekly plan will be saved on ${day} at ${s.time} – from then on you'll see here where the time went.`)
                : tr(`Der Wochenplan für KW ${weekNo(data.firstWeek)} ist gespeichert. Die erste Auswertung erscheint am ${when} um ${s.time}, sobald die Woche gebucht ist.`, `The weekly plan for W ${weekNo(data.firstWeek)} is saved. The first evaluation appears on ${when} at ${s.time}, once the week has been booked.`)}
            </p>
            <span className="pa-sub">{tr('Bis dahin: Schätzung gegen erfasste Zeit, wie bisher.', 'Until then: estimate against logged time, as before.')}</span>
          </div>
        </motion.section>
      </div>
      <TimeEstimate />
    </div>
  );
}

function Loading() {
  return (
    <div className="page pa-page">
      <div className="pa-head"><Skeleton h={26} w={260} /><Skeleton h={34} w={250} r={11} /></div>
      <div className="stats">{[0, 1, 2, 3].map((i) => <div key={i} className="stat"><Skeleton h={11} w={80} /><Skeleton h={30} w={110} style={{ marginTop: 10 }} /><Skeleton h={10} w={150} style={{ marginTop: 'auto' }} /></div>)}</div>
      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={44} style={{ opacity: 1 - i * 0.15 }} />)}</div>
    </div>
  );
}
