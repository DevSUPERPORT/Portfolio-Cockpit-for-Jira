import { memo, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { waterline, supportTicketAnalytics } from '@shared/engine.js';
import { targetHours, DEFAULT_SLA } from '@shared/sla.js';
import { dispatchSettings, canDispatch, incomingTickets, availableDims, meanResolveByService } from '@shared/dispatch.js';
import { useApp, errText } from '../state.jsx';
import { tr, fmt, healthName, getLang } from '../lib/i18n.js';
import { noCapacityReason, NO_CAP_TEXT } from '@shared/kpis.js';
import { Icon } from '../lib/icons.jsx';
import { call, openIssue } from '../lib/api.js';
import { Stat, Empty, stagger, Segmented, Modal, Avatar, useTip, infoCard, spring } from '../components/ui.jsx';
import { LotseChip } from '../components/lotse/LotseChip.jsx';
import { Columns, Donut, HBars, Line, SlaBar } from '../components/charts.jsx';
import SupportDispatch from '../components/SupportDispatch.jsx';
import SupportReserve, { SupportTeams } from '../components/SupportReserve.jsx';
import SupportTime from '../components/SupportTime.jsx';
import SupportPlaybooks from '../components/SupportPlaybooks.jsx';
import { canReadPlaybooks } from '@shared/playbooks.js';
import '../components/Support.css';
import { useWindowedRows, SpacerRow, FindNote, Prof } from '../lib/virtual.jsx';

// Support & SLAs (UC-17): one place where support work and project work meet. Tickets come from service spaces
// (Jira Service Management) and/or app-defined queues in any space, read as the signed-in user.
// Flow: service chips → four KPIs → rising banner → Verteilen · Kapazität · Zeit · SLA · Tickets · Projekte.
// A selected service space only changes this view; capacity and reserve always use all service spaces.

// Business-hour durations: minutes under an hour, hours up to two days, then days of opening hours.
export function dur(h, cal = DEFAULT_SLA) {
  if (h == null || !Number.isFinite(h)) return '–';
  const a = Math.abs(h);
  const day = cal.mode === '24x7' ? 24 : Math.max(1, (cal.end ?? 17) - (cal.start ?? 8));
  if (a < 1) return `${Math.max(1, Math.round(a * 60))} min`;
  if (a < day * 2) return fmt.h(a, a < 10 ? 1 : 0);
  return `${fmt.n(a / day, 1)} ${tr('AT', 'bd')}`;
}
export const slaLeft = (sla, cal) => {
  if (sla?.status === 'none') return tr('kein SLA', 'no SLA');
  if (!sla || sla.remainingH == null) return '–';
  if (sla.status === 'met') return tr('erfüllt', 'met');
  return sla.remainingH >= 0 ? tr(`noch ${dur(sla.remainingH, cal)}`, `${dur(sla.remainingH, cal)} left`) : tr(`${dur(-sla.remainingH, cal)} drüber`, `${dur(-sla.remainingH, cal)} over`);
};
const STATUS_CHIP = { breached: 'chip-bad', atRisk: 'chip-warn', ok: 'chip-ok', met: 'chip-ok' };
const statusName = (s) => ({ breached: tr('Verletzt', 'Breached'), atRisk: tr('Gefährdet', 'At risk'), ok: tr('Im Ziel', 'On target'), met: tr('Erfüllt', 'Met'), none: tr('Kein SLA', 'No SLA') }[s] || s);
const EASE = [0.22, 1, 0.36, 1];
const healthOf = (rate, target) => (rate == null ? null : rate >= target ? 'onTrack' : rate >= target - 0.05 ? 'atRisk' : 'critical');

function useSupport(svcSel) {
  const { ds, computed, config } = useApp();
  const tickets = ds?.supportTickets?.tickets || null;
  const cal = config?.support?.sla || DEFAULT_SLA;
  const target = (config?.support?.slaTargetPct ?? 95) / 100;
  const { model } = computed;
  // The ticket analytics of the selected service space (same rule as the whole view), or of all.
  const a = useMemo(() => {
    if (!svcSel || !tickets || !computed.supportA) return computed.supportA;
    return supportTicketAnalytics({ config: ds.config, supportTickets: { tickets: tickets.filter((t) => (t.services || []).includes(svcSel)) } }, model);
  }, [svcSel, tickets, computed.supportA, ds?.config, model]);
  return { tickets, a, aAll: computed.supportA, sum: computed.supportSum, cal, target, model, s: computed.support, truncated: !!ds?.supportTickets?.truncated };
}

// Another screen (e.g. the "Ich will …" card on recurring topics) can open Support on a given section.
let requestedTab = null;
export const requestSupportTab = (tab) => { requestedTab = tab; };

export default function Support() {
  const { config, setView, roles, computed } = useApp();
  const tip = useTip();
  const [svcSel, setSvcSel] = useState(null);
  const sup = useSupport(svcSel);
  const [tab, setTab] = useState(() => { const t = requestedTab; requestedTab = null; return t; });
  const [filter, setFilter] = useState(null); // null = automatic: urgent when SLAs exist, else all open
  const settings = useMemo(() => dispatchSettings(config), [config]);
  const mayDispatch = canDispatch(roles);
  const canEditReserve = !!(roles?.editCapacity || roles?.admin);
  const { s, a, aAll, model } = sup;
  // Service spaces: from the support numbers (scoped to what the user may see), else from the configuration.
  const services = useMemo(() => {
    if (s?.services?.length) return s.services.map((x) => ({ id: x.id, key: x.key, name: x.name }));
    const out = (config?.support?.queues || []).filter((q) => q.id !== 'spaces').map((q) => ({ id: `q:${q.id}`, key: 'Queue', name: q.name }));
    for (const id of (config?.support?.queues || []).filter((q) => q.id === 'spaces').flatMap((q) => q.projectIds)) {
      const t = (sup.tickets || []).find((x) => x.projectId === id);
      out.push({ id, key: t?.projectKey || id, name: t?.projectName || t?.projectKey || id });
    }
    for (const id of config?.support?.serviceProjectIds || []) {
      const t = (sup.tickets || []).find((x) => x.projectId === id);
      out.push({ id, key: t?.projectKey || id, name: t?.projectKey || id });
    }
    return out;
  }, [s, config, sup.tickets]);
  const serviceName = (id) => services.find((x) => x.id === id)?.name || null;
  const health = useMemo(() => new Map(services.map((x) => {
    const rows = (aAll?.rows || []).filter((r) => (r.services || []).includes(x.id));
    const met = rows.filter((r) => r.sla?.status === 'met').length, br = rows.filter((r) => r.sla?.status === 'breached').length;
    const sv = s?.services?.find((y) => y.id === x.id);
    return [x.id, aAll ? healthOf(met + br ? met / (met + br) : null, sup.target) : sv?.health ?? null];
  })), [services, aAll, s, sup.target]);
  const incomingN = useMemo(() => (a ? incomingTickets(a.rows, settings).incoming.length : 0), [a, settings]);
  const ignoreLabels = useMemo(() => [...new Set((config?.support?.queues || []).flatMap((q) => q.labels || []))], [config]);
  const timeOk = useMemo(() => Object.values(availableDims(sup.tickets, { causeFieldId: settings.causeFieldId, ignoreLabels })).some(Boolean), [sup.tickets, settings.causeFieldId, ignoreLabels]);

  const configured = (config?.support?.serviceProjectIds || []).length || (config?.support?.queues || []).length;
  if (!configured || (!s && !sup.tickets)) {
    return <div className="page"><div className="card"><Empty icon="headset" title={tr('Noch keine Support-Arbeit verbunden', 'No support work connected yet')}>
      {configured ? tr('Die Support-Tickets konnten nicht geladen werden. Prüfe, ob du die Service-Spaces sehen darfst.', 'Support tickets could not be loaded. Check that you may browse the service spaces.')
        : tr('Ein Jira-Admin verbindet unter Konfiguration › Support & SLAs Service-Spaces oder legt Support-Queues in beliebigen Spaces an – Jira Service Management ist nicht nötig.', 'A Jira admin connects service spaces or defines support queues in any space under Configuration › Support & SLAs – Jira Service Management is not required.')}
    </Empty></div></div>;
  }
  const k = a?.kpis;
  const tabs = [
    ...(mayDispatch && a ? [{ value: 'dispatch', icon: 'send', label: `${tr('Verteilen', 'Dispatch')}${incomingN ? ` · ${incomingN}` : ''}` }] : []),
    { value: 'capacity', icon: 'users', label: tr('Kapazität', 'Capacity') },
    ...(timeOk ? [{ value: 'time', icon: 'target', label: tr('Zeit', 'Time') }] : []),
    { value: 'sla', icon: 'shield', label: 'SLA' },
    ...(a ? [{ value: 'tickets', icon: 'headset', label: `${tr('Tickets', 'Tickets')}${k.breachedOpen + k.atRisk ? ` · ${k.breachedOpen + k.atRisk}` : ''}` }, { value: 'projects', icon: 'project', label: tr('Projekte', 'Projects') }] : []),
    ...(sup.tickets && canReadPlaybooks(roles) ? [{ value: 'playbooks', icon: 'bookmark', label: tr('Playbooks', 'Playbooks') }] : []),
  ];
  const cur = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;
  const go = (f) => { setFilter(f); setTab('tickets'); };
  // E2E 2026-11-20: without any JSM SLA in the selection nothing can be "urgent" – Tickets opened on an empty
  // "Nothing is burning" while 73 tickets were open. Then the list starts with all open tickets.
  const noSlaSel = !!k && k.withSla === 0;
  const ticketFilter = filter ?? (noSlaSel ? 'open' : 'urgent');

  // ---------- KPIs (selection) ----------
  const rate = k ? k.slaRate : s?.slaRate ?? null;
  // no ticket in the selection has a JSM SLA (e.g. only software spaces): the SLA figures say so instead of 0 %
  const noSla = !!k && k.withSla === 0;
  const target = k?.target ?? s?.slaTarget ?? sup.target;
  const svs = (s?.services || []).filter((x) => !svcSel || x.id === svcSel);
  const openRe = svs.reduce((acc, x) => acc + (x.openRe || 0), 0);
  const open = k ? k.open : svs.reduce((acc, x) => acc + (x.open || 0), 0);
  const breached = k ? k.breached : svs.reduce((acc, x) => acc + (x.breached || 0), 0);
  const capTotal = computed.weeks?.totalCap || 0;
  const share = s && capTotal > 0 ? (s.weeklyTotal * 8) / (capTotal + s.weeklyTotal * 8) : null;
  // Rising support: last 2 weeks > 20 % above the average (engine supportMetrics); per service when one is selected.
  const rising = (svcSel ? (s?.services?.find((x) => x.id === svcSel)?.teams || []) : (s?.teams || [])).filter((t) => t.spike && t.avg > 0);
  const tname = (id) => model.teams.get(id)?.name || id;
  const manualOf = (id) => s?.teams?.find((t) => t.teamId === id)?.override != null;

  return (
    <div className="page">
      <div className="row wrap" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        {services.length > 1 ? (
          <div className="sp-chips" role="group" aria-label={tr('Service-Space', 'Service space')}>
            {[{ id: null, name: tr('Alle Service-Spaces', 'All service spaces') }, ...services].map((x) => {
              const on = svcSel === x.id;
              const h = x.id ? health.get(x.id) : sup.sum?.health;
              return (
                <button key={x.id || 'all'} type="button" className="sp-chip" aria-pressed={on} onClick={() => setSvcSel(x.id)}
                  {...tip(infoCard({ title: x.name, text: x.id ? tr('Zeigt nur diesen Service-Space. Kapazität und Reserve rechnen weiter mit allen.', 'Shows only this service space. Capacity and reserve keep using all of them.') : tr('Alle Service-Spaces zusammen.', 'All service spaces together.'), inputs: [[tr('SLA-Stand', 'SLA health'), healthName(h)]] }))}>
                  {on && <motion.span layoutId="sp-svc-pill" className="sp-chip-pill" transition={spring} />}
                  <span className={`sp-dot ${h || ''}`} aria-hidden="true" />{x.name}
                </button>
              );
            })}
          </div>
        ) : <span />}
        <span className="sp-note"><Icon name="clock" size={13} />{tr('SLAs aus Jira Service Management – je Service-Space', 'SLAs from Jira Service Management – per service space')}</span>
      </div>
      {svcSel && <span className="sp-note" style={{ marginTop: -10 }}><Icon name="info" size={12} />{tr('Nur die Ansicht ist gefiltert – Kapazität, Reserve, Portfolio und Wochenplanung rechnen immer mit allen Service-Spaces.', 'Only the view is filtered – capacity, reserve, portfolio and weekly planning always use all service spaces.')}</span>}
      {sup.truncated && <div className="callout warn"><Icon name="alert" /><div>{tr('Mehr als 2.000 Tickets – es werden die neuesten gezeigt.', 'More than 2,000 tickets – showing the newest.')}</div></div>}

      <div className="stats">
        <Stat i={0} label={tr('SLA erfüllt', 'SLA met')} value={rate ?? 0} format={(v) => (rate == null ? '–' : fmt.pct(v, 1))} hot={rate != null && rate < target}
          foot={noSla ? tr('kein SLA – nur JSM-Spaces haben SLAs', 'no SLA – only JSM spaces have SLAs') : `${tr('Ziel', 'Target')} ${fmt.pct(target)}${rate != null ? ` · ${healthName(healthOf(rate, target))}` : ''}`}
          explain={{ text: tr('Anteil der Tickets, die innerhalb ihrer SLA-Zeit gelöst wurden (8 Wochen).', 'Share of tickets resolved within their SLA time (8 weeks).'), calc: k && k.met + k.breached > 0 ? tr(`${k.met} eingehalten ÷ (${k.met} + ${k.breached} verletzt) = ${fmt.pct(rate, 1)}`, `${k.met} met ÷ (${k.met} + ${k.breached} breached) = ${fmt.pct(rate, 1)}`) : tr('Noch keine gelösten Tickets mit SLA', 'No resolved tickets with an SLA yet'), inputs: [[tr('Ziel', 'Target'), fmt.pct(target)]] }} />
        <Stat i={1} label={tr('SLA-Verletzungen', 'SLA breaches')} value={breached} format={noSla ? () => '–' : undefined} hot={breached > 0} onClick={a && !noSla ? () => go('urgent') : undefined}
          foot={noSla ? tr('kein SLA in dieser Auswahl', 'no SLA in this selection') : k ? tr(`${k.breachedOpen} davon noch offen`, `${k.breachedOpen} of them still open`) : tr('letzte 8 Wochen', 'last 8 weeks')}
          explain={{ text: tr('Tickets, deren SLA-Zeit (in Geschäftszeiten) abgelaufen ist – gelöste und offene.', 'Tickets whose SLA time (in business hours) ran out – resolved and open.'), calc: k ? tr(`${breached} verletzt = ${breached - k.breachedOpen} gelöst + ${k.breachedOpen} offen`, `${breached} breached = ${breached - k.breachedOpen} resolved + ${k.breachedOpen} open`) : null, hint: a ? tr('Klick: dringende Tickets zeigen', 'Click: show urgent tickets') : null }} />
        <Stat i={2} label={tr('Offene Tickets', 'Open tickets')} value={open} onClick={a ? () => go('open') : undefined}
          foot={openRe > 0 ? tr(`${fmt.h(openRe)} Restaufwand`, `${fmt.h(openRe)} remaining`) : k ? tr(`${k.atRisk} gefährdet`, `${k.atRisk} at risk`) : null}
          explain={{ text: tr('Tickets in den Support-Queues, die noch nicht erledigt sind, mit dem geschätzten Restaufwand (Remaining Estimate).', 'Tickets in the support queues not done yet, with their remaining estimate.'), calc: k ? tr(`${k.open} offen = ${Math.max(0, k.open - k.atRisk - k.breachedOpen)} im Plan + ${k.atRisk} gefährdet + ${k.breachedOpen} verletzt`, `${k.open} open = ${Math.max(0, k.open - k.atRisk - k.breachedOpen)} on track + ${k.atRisk} at risk + ${k.breachedOpen} breached`) : null, inputs: [[tr('Restaufwand', 'Remaining'), fmt.h(openRe)]], hint: a ? tr('Klick: Liste öffnen', 'Click: open the list') : null }} />
        <Stat i={3} label={tr('Anteil an der Kapazität', 'Share of capacity')} value={share ?? 0} format={(v) => (share == null ? '–' : fmt.pct(v))} onClick={() => setTab('capacity')}
          foot={s ? tr(`${fmt.h(s.weeklyTotal)} je Woche · alle Spaces`, `${fmt.h(s.weeklyTotal)} per week · all spaces`) : null}
          explain={{ text: tr('Wie viel der Teamzeit der Support in den nächsten 8 Wochen vorab bekommt – er geht vor allen Projekten. Rechnet immer mit allen Service-Spaces.', 'How much of the teams\' time support gets first over the next 8 weeks – it comes before every project. Always uses all service spaces.'), calc: s && share != null ? `${fmt.h(s.weeklyTotal)} × 8 ÷ (${fmt.h(capTotal)} + ${fmt.h(s.weeklyTotal)} × 8) = ${fmt.pct(share)}` : null, hint: tr('Klick: Kapazität je Team', 'Click: capacity per team') }} />
      </div>

      {rising.length > 0 && (
        <motion.div className="sp-banner" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
          <Icon name="zap" size={15} />
          <div>{rising.map((t) => tr(`Team ${tname(t.teamId)}: letzte 2 Wochen ${fmt.signedPct(t.recentAvg / t.avg - 1)} über dem Durchschnitt (${fmt.h(t.recentAvg, 1)} statt ${fmt.h(t.avg, 1)} je Woche)`, `Team ${tname(t.teamId)}: last 2 weeks ${fmt.signedPct(t.recentAvg / t.avg - 1)} above average (${fmt.h(t.recentAvg, 1)} instead of ${fmt.h(t.avg, 1)} per week)`)).join(' · ')}.{' '}
            {rising.every((t) => manualOf(t.teamId)) ? tr('Die Reserve ist manuell festgelegt und folgt nicht automatisch.', 'The reserve is set manually and does not follow automatically.') : tr('Die Reserve folgt automatisch – die Projekte mit dem niedrigsten Rang verlieren zuerst Kapazität.', 'The reserve follows automatically – the lowest-ranked projects lose capacity first.')}
            {' '}<button className="linkbtn" style={{ textDecoration: 'underline' }} onClick={() => setTab('capacity')}>{tr('Reserve prüfen', 'Check the reserve')}</button>
          </div>
        </motion.div>
      )}

      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <Segmented value={cur} onChange={setTab} label={tr('Bereich', 'Section')} options={tabs} />
        <LotseChip skill="supportTopics" params={{ serviceId: svcSel || null }} label={tr('Lotse: Support-Themen', 'Lotse: support topics')} />
      </div>
      <motion.div key={cur} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } }} className="stack" style={{ gap: 20 }}>
        {cur === 'dispatch' && <Prof id="sup:dispatch"><SupportDispatch rows={aAll.rows} settings={settings} svcSel={svcSel} serviceName={serviceName} cal={sup.cal} slaText={(x) => slaLeft(x, sup.cal)} canAssign={mayDispatch} teamField={config?.fields?.team || null} /></Prof>}
        {cur === 'capacity' && <>
          <SupportTeams s={s} a={aAll} />
          {s && <SupportReserve s={s} canEdit={canEditReserve} />}
          <Impact sup={sup} />
        </>}
        {cur === 'time' && <SupportTime tickets={sup.tickets} settings={settings} svcSel={svcSel} serviceName={serviceName} ignoreLabels={ignoreLabels} />}
        {cur === 'sla' && <>
          <SlaTable sup={sup} services={services} svcSel={svcSel} />
          {a && <Trends sup={sup} go={go} />}
        </>}
        {cur === 'tickets' && a && <Prof id="sup:tickets"><Tickets sup={sup} filter={ticketFilter} setFilter={setFilter} /></Prof>}
        {cur === 'projects' && a && <Projects sup={sup} go={go} setView={setView} />}
        {cur === 'playbooks' && <SupportPlaybooks tickets={sup.tickets} />}
      </motion.div>
    </div>
  );
}

// ---------- SLA per service space ----------
function SlaTable({ sup, services, svcSel }) {
  const tip = useTip();
  const { s, aAll, model, target } = sup;
  const resolve = useMemo(() => meanResolveByService(aAll?.rows), [aAll]);
  const rows = services.map((x) => {
    const sv = s?.services?.find((y) => y.id === x.id);
    const ts = (aAll?.rows || []).filter((r) => (r.services || []).includes(x.id));
    const met = aAll ? ts.filter((r) => r.sla?.status === 'met').length : sv?.met || 0;
    const breached = aAll ? ts.filter((r) => r.sla?.status === 'breached').length : sv?.breached || 0;
    return { ...x, weekly: sv?.avgWeekly ?? null, teams: (sv?.teams || []).map((t) => model.teams.get(t.teamId)?.name || (t.teamId === '_none' ? tr('ohne Team', 'no team') : t.teamId)), rising: sv?.rising || [], tickets: aAll ? ts.length : null, met, breached, rate: met + breached ? met / (met + breached) : null, resolveH: resolve.get(x.id) ?? null };
  });
  const hasResolve = rows.some((r) => r.resolveH != null);
  return (
    <section className="card" style={{ overflow: 'hidden' }}>
      <div className="sp-head">
        <h2 className="card-title"><Icon name="shield" />{tr('SLA je Service-Space', 'SLA per service space')}</h2>
        <span className="sp-info" tabIndex={0} {...tip(infoCard({ title: tr('SLA je Service-Space', 'SLA per service space'), text: tr('Tickets der letzten 8 Wochen mit ihrem SLA-Stand (Jira Service Management, sonst die SLA-Ziele der App). Ø h/Woche = gebuchte Support-Zeit je Woche. Geht ins C-Level-Reporting.', 'Tickets of the last 8 weeks with their SLA state (Jira Service Management, else the app\'s SLA targets). Ø h/week = support time logged per week. Feeds the C-level report.') }))}><Icon name="info" size={14} /></span>
      </div>
      <div className="sp-scroll" tabIndex={0}>
        <div className={`sp-grid-sla sp-thead ${hasResolve ? '' : 'no-res'}`}>
          <span>Service-Space</span><span className="sp-r">Ø h/{tr('Woche', 'week')}</span><span>Teams</span><span className="sp-r">Tickets</span><span>{tr('SLA erfüllt', 'SLA met')}</span><span className="sp-r">{tr('Verletzungen', 'Breaches')}</span>{hasResolve && <span className="sp-r">Ø {tr('Lösung', 'resolution')}</span>}
        </div>
        {rows.map((r, i) => (
          <motion.div key={r.id} className={`sp-grid-sla sp-row ${hasResolve ? '' : 'no-res'}`}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: svcSel && svcSel !== r.id ? 0.45 : 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.32, ease: EASE }}>
            <span style={{ display: 'flex', flexDirection: 'column' }}><b style={{ fontWeight: 560 }}>{r.name}</b><span className="mono faint">{r.key}</span></span>
            <span className="sp-r" style={{ fontWeight: 560 }}>{r.weekly == null ? '–' : fmt.h(r.weekly, 1)}</span>
            <span style={{ fontSize: 13 }}>{r.teams.join(', ') || '–'}{r.rising.length > 0 && <span className="sp-flag" style={{ marginLeft: 6 }}><Icon name="zap" size={11} />{tr('steigt', 'rising')}</span>}</span>
            <span className="sp-r">{r.tickets ?? '–'}</span>
            <span><span className={`chip num ${r.rate == null ? '' : r.rate >= target ? 'chip-ok' : 'chip-bad'}`}>{r.rate == null ? '–' : fmt.pct(r.rate, 1)}</span></span>
            <span className="sp-r">{r.breached}</span>
            {hasResolve && <span className="sp-r">{r.resolveH == null ? '–' : dur(r.resolveH, sup.cal)}</span>}
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ---------- trends (the former "Lage" charts) ----------
function Trends({ sup, go }) {
  const { a, cal, model } = sup;
  const k = a.kpis;
  const target = k.target;
  const top = a.byProject[0];
  const sentence = [
    k.breachedOpen ? tr(`${k.breachedOpen} ${k.breachedOpen === 1 ? 'offenes Ticket hat' : 'offene Tickets haben'} das SLA verletzt`, `${k.breachedOpen} open ${k.breachedOpen === 1 ? 'ticket has' : 'tickets have'} breached the SLA`) : tr('Kein offenes Ticket über dem SLA', 'No open ticket past its SLA'),
    k.atRisk ? tr(`${k.atRisk} ${k.atRisk === 1 ? 'weiteres wird' : 'weitere werden'} knapp`, `${k.atRisk} more ${k.atRisk === 1 ? 'is' : 'are'} close`) : null,
    k.backlogTrendPerWeek > 0.5 ? tr(`der Rückstand wächst um ${fmt.n(k.backlogTrendPerWeek, 1)} je Woche`, `the backlog grows by ${fmt.n(k.backlogTrendPerWeek, 1)} per week`) : k.backlogTrendPerWeek < -0.5 ? tr(`der Rückstand sinkt um ${fmt.n(-k.backlogTrendPerWeek, 1)} je Woche`, `the backlog shrinks by ${fmt.n(-k.backlogTrendPerWeek, 1)} per week`) : null,
    k.medianResolveH != null ? tr(`Lösungszeit im Median ${dur(k.medianResolveH, cal)}`, `median resolution ${dur(k.medianResolveH, cal)}`) : null,
    top ? tr(`am meisten betroffen: ${model.itemByRef.get(top.ref)?.name || top.ref} (${top.open} offen)`, `most affected: ${model.itemByRef.get(top.ref)?.name || top.ref} (${top.open} open)`) : null,
  ].filter(Boolean).join(' · ');
  const openByPrio = a.byPriority.filter((p) => p.open > 0);
  return (
    <>
      <div className="callout"><Icon name="sparkle" /><div><b style={{ fontWeight: 600 }}>{tr('Kurz gesagt: ', 'In short: ')}</b>{sentence}.</div></div>
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2 className="card-title"><Icon name="waves" />{tr('Eingang und Erledigung je Woche', 'Created and resolved per week')}</h2></div>
          <div style={{ padding: 20 }}><Columns label={tr('Tickets je Woche', 'Tickets per week')} labels={a.trend.map((w) => fmt.week(w.week))} series={[{ name: tr('Neu', 'Created'), values: a.trend.map((w) => w.created), color: 'var(--accent)' }, { name: tr('Gelöst', 'Resolved'), values: a.trend.map((w) => w.resolved), color: 'var(--ink)' }]} /></div>
        </section>
        <section className="card">
          <div className="card-head"><h2 className="card-title"><Icon name="shield" />{tr('SLA-Quote je Woche', 'SLA rate per week')}</h2><span className="card-sub">{tr('gestrichelt: Ziel', 'dashed: target')} {fmt.pct(target)}</span></div>
          <div style={{ padding: 20 }}><Line label={tr('SLA-Quote', 'SLA rate')} labels={a.trend.map((w) => fmt.week(w.week))} series={[{ name: tr('Quote', 'Rate'), values: a.trend.map((w) => w.rate), color: 'var(--ink)' }]} target={target} domain={[Math.min(0.5, ...a.trend.map((w) => w.rate ?? 1)), 1]} format={(v) => fmt.pct(v)} /></div>
        </section>
        <section className="card">
          <div className="card-head"><h2 className="card-title"><Icon name="flag" />{tr('Offen nach Priorität', 'Open by priority')}</h2></div>
          <div style={{ padding: 20 }}>{openByPrio.length ? <Donut label={tr('Offen nach Priorität', 'Open by priority')} center={fmt.n(k.open)} parts={openByPrio.map((p, i) => ({ label: `${p.priority}${p.breachedOpen ? ` · ${p.breachedOpen} ${tr('über SLA', 'past SLA')}` : ''}`, value: p.open, color: ['var(--bad)', 'var(--accent)', 'var(--warn)', 'var(--ink)', 'var(--line-strong)'][Math.min(i, 4)] }))} onPick={() => go('open')} /> : <div className="muted">{tr('Nichts offen.', 'Nothing open.')}</div>}</div>
        </section>
        <section className="card">
          <div className="card-head"><h2 className="card-title"><Icon name="clock" />{tr('Alter der offenen Tickets (Tage)', 'Age of open tickets (days)')}</h2></div>
          <div style={{ padding: 20 }}><HBars large label={tr('Alter', 'Age')} items={a.aging.map((b, i) => ({ label: `${b.label} ${tr('Tage', 'days')}`, value: b.count, tone: i >= 3 ? 'bad' : i === 2 ? 'warn' : 'ink' }))} /></div>
        </section>
      </div>
    </>
  );
}


// ---------- tickets ----------
function Tickets({ sup, filter, setFilter }) {
  const { setDs, done, toast } = useApp();
  const { a, cal, model } = sup;
  const [q, setQ] = useState('');
  const [linkFor, setLinkFor] = useState(null);
  const rows = useMemo(() => {
    const all = filter === 'resolved' ? a.rows.filter((r) => r.statusCat === 'done') : a.queue;
    const f = { urgent: (r) => r.sla.status === 'breached' || r.sla.status === 'atRisk', open: () => true, unlinked: (r) => !r.project, resolved: () => true }[filter] || (() => true);
    const n = q.trim().toLowerCase();
    return all.filter(f).filter((r) => !n || `${r.key} ${r.summary} ${r.assignee?.name || ''}`.toLowerCase().includes(n));
  }, [a, filter, q]);
  // long lists render only the rows near the viewport (lib/virtual.jsx); up to 200 rows everything, as before
  const win = useWindowedRows(rows.length, { estimate: 49 });
  const patchLinks = (ticketId, fn) => setDs((d) => ({ ...d, supportTickets: { ...d.supportTickets, tickets: d.supportTickets.tickets.map((t) => (t.id === ticketId ? { ...t, links: fn(t.links || []) } : t)) } }));
  const link = async (ticket, target) => {
    try {
      await call('support.link', { ticketId: ticket.id, targetId: target.id });
      patchLinks(ticket.id, (l) => [...new Set([...l, target.id])]);
      setLinkFor(null);
      done(tr(`${ticket.key} mit ${target.key} verknüpft`, `${ticket.key} linked to ${target.key}`), 'link', tr('Verknüpfung', 'link'), async () => {
        await call('support.unlink', { ticketId: ticket.id, targetId: target.id });
        patchLinks(ticket.id, (l) => l.filter((x) => x !== target.id));
      }, [`support:${ticket.id}:${target.id}`]);
    } catch (e) { toast({ text: errText(e), error: true }); }
  };
  return (
    <section className="card">
      <div className="card-head">
        <Segmented value={filter} onChange={setFilter} label={tr('Filter', 'Filter')} size="sm" options={[
          { value: 'urgent', label: tr('Dringend', 'Urgent') }, { value: 'open', label: tr('Alle offenen', 'All open') },
          { value: 'unlinked', label: tr('Ohne Projekt', 'No project') }, { value: 'resolved', label: tr('Gelöst', 'Resolved') },
        ]} />
        <label className="row" style={{ gap: 6 }}><Icon name="search" size={14} /><input className="input input-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Ticket, Titel, Person …', 'Ticket, title, person …')} aria-label={tr('Tickets durchsuchen', 'Search tickets')} style={{ width: 220 }} /></label>
      </div>
      {rows.length === 0 ? <Empty icon="check" title={filter === 'urgent' ? tr('Nichts brennt', 'Nothing is burning') : tr('Keine Tickets', 'No tickets')}>{filter === 'urgent' ? tr('Kein offenes Ticket ist verletzt oder knapp.', 'No open ticket is breached or close.') : null}</Empty> : (
        <div className="table-scroll" tabIndex={0}>
          <table className="table sp-ticket-table">
            <thead><tr><th>{tr('Priorität', 'Priority')}</th><th>Ticket</th><th>Status</th><th>{tr('Bearbeitung', 'Assignee')}</th><th style={{ minWidth: 170 }}>SLA</th><th>{tr('Projekt', 'Project')}</th></tr></thead>
            <tbody ref={win.ref}><SpacerRow height={win.before} cols={6} />{rows.slice(win.start, win.end).map((r, k) => {
              const i = win.start + k;
              return <TicketRow key={r.id} r={r} i={i} cal={cal} item={r.project ? model.itemByRef.get(r.project) : null} onLink={setLinkFor} />;
            })}<SpacerRow height={win.after} cols={6} /></tbody>
          </table>
          {win.on && <FindNote count={rows.length} />}
        </div>
      )}
      <LinkPicker ticket={linkFor} model={model} onClose={() => setLinkFor(null)} onPick={(t) => link(linkFor, t)} />
    </section>
  );
}
// One ticket row. Memoized (a scroll step renders only the rows that come into the window); the entrance motion only
// for the first rows (as before) – rows scrolled in are plain, their SLA bar too (the same markup without the grow).
const TicketRow = memo(function TicketRow({ r, i, cal, item, onLink }) {
  const Row = i < 60 ? motion.tr : 'tr';
  const th = targetHours(r.priority, cal);
  return (
    <Row {...(i < 60 ? stagger(i, 0.015) : {})}>
      <td><span className={`chip ${th <= 8 ? 'chip-bad' : th <= 24 ? 'chip-accent' : ''}`}>{r.priority || '–'}</span></td>
      <td style={{ maxWidth: 380 }}><button className="tkey" onClick={() => openIssue(r.key)}>{r.key}</button> <span title={r.summary}>{r.summary}</span>{r.sla?.source === 'jsm' && <span className="chip chip-outline" style={{ marginLeft: 6 }} title={tr('SLA aus Jira Service Management', 'SLA from Jira Service Management')}>JSM</span>}</td>
      <td><span className="muted">{r.status}</span></td>
      <td>{r.assignee ? <span className="row" style={{ gap: 6 }}><Avatar user={r.assignee} size={20} />{r.assignee.name}</span> : <span className="faint">{tr('niemand', 'nobody')}</span>}</td>
      <td>{r.sla ? <span className="row" style={{ gap: 8 }}><span className={`chip ${STATUS_CHIP[r.sla.status]}`}>{statusName(r.sla.status)}</span>{i < 60 ? <SlaBar share={r.sla.share} status={r.sla.status} remaining={slaLeft(r.sla, cal)} /> : <PlainSlaBar share={r.sla.share} status={r.sla.status} remaining={slaLeft(r.sla, cal)} />}</span> : '–'}</td>
      <td>{item ? <span className="chip" title={item.name}><b className="num">#{item.rank}</b> {item.name}</span>
        : <button className="btn btn-sm" onClick={() => onLink(r)}><Icon name="link" size={13} />{tr('Projekt zuordnen', 'Link project')}</button>}</td>
    </Row>
  );
});
// charts.jsx SlaBar at its end state, without the motion component (one per row adds up while scrolling 19k rows)
function PlainSlaBar({ share, status, remaining }) {
  const w = Math.min(100, Math.max(3, (share || 0) * 100));
  const c = status === 'breached' ? 'var(--bad)' : status === 'atRisk' ? 'var(--warn)' : 'var(--ok)';
  return (
    <span className="slabar" title={remaining}>
      <span className="slabar-track"><span className="slabar-fill" style={{ width: `${w}%`, background: c }} /></span>
      <span className="slabar-text num" style={{ color: status === 'breached' ? 'var(--bad)' : undefined }}>{remaining}</span>
    </span>
  );
}

// Link target: a portfolio project (if it is a work item) or one of its rough/structure items (e.g. epics).
// Mounted only while a ticket is chosen: closed, it filtered every project and built every target button on each
// render of the ticket list – about 70 ms per scroll step on a big site (the closed Modal shows nothing anyway).
function LinkPicker(props) {
  return props.ticket ? <LinkPickerOpen {...props} /> : null;
}
function LinkPickerOpen({ ticket, model, onClose, onPick }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const groups = useMemo(() => model.items.map((p) => ({
    item: p,
    targets: [
      ...(p.kind === 'issue' ? [{ id: p.id, key: p.key, name: p.name, top: true }] : []),
      ...(model.byRoot.get(p.ref) || []).filter((i) => i.role === 'rough' || i.role === 'structure').map((i) => ({ id: i.id, key: i.key, name: i.summary })),
    ],
  })), [model]);
  const n = q.trim().toLowerCase();
  const shown = groups.map((g) => ({ ...g, targets: g.targets.filter((t) => !n || `${t.key} ${t.name} ${g.item.name}`.toLowerCase().includes(n)).slice(0, n ? 30 : 6) })).filter((g) => g.targets.length);
  return (
    <Modal open={!!ticket} onClose={onClose} icon="link" title={tr('Mit Projekt verknüpfen', 'Link to project')} sub={ticket ? `${ticket.key} · ${ticket.summary}` : ''} width={620}>
      <div className="stack" style={{ gap: 12 }}>
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Projekt oder Epic suchen …', 'Search project or epic …')} aria-label={tr('Ziel suchen', 'Search target')} />
        <div className="faint" style={{ fontSize: 12.5 }}>{tr('Legt in Jira eine Vorgangsverknüpfung an (mit deinen Rechten). Rückgängig jederzeit über die Meldung oder Strg+Z.', 'Creates a Jira issue link (with your permissions). Undo any time via the toast or Ctrl+Z.')}</div>
        <div className="stack" style={{ gap: 10, maxHeight: 380, overflow: 'auto' }}>
          {shown.map((g) => (
            <div key={g.item.ref}>
              <div className="label" style={{ marginBottom: 4 }}>#{g.item.rank} {g.item.name}</div>
              <div className="stack" style={{ gap: 4 }}>{g.targets.map((t) => (
                <button key={t.id} className="pick-row" disabled={!!busy} onClick={async () => { setBusy(t.id); try { await onPick(t); } finally { setBusy(null); } }}>
                  <span className="mono faint">{t.key}</span><span style={{ flex: 1, textAlign: 'left' }}>{t.name}</span>{t.top && <span className="chip">{tr('Projekt', 'Project')}</span>}{busy === t.id ? <Icon name="refresh" size={13} /> : <Icon name="arrowRight" size={13} />}
                </button>
              ))}</div>
            </div>
          ))}
          {!shown.length && <div className="muted">{tr('Nichts gefunden.', 'Nothing found.')}</div>}
        </div>
      </div>
    </Modal>
  );
}

// ---------- projects ----------
function Projects({ sup, go, setView }) {
  const { a, model } = sup;
  const rows = a.byProject.map((p) => ({ ...p, item: model.itemByRef.get(p.ref) })).filter((p) => p.item);
  const k = a.kpis;
  return (
    <>
      {k.unlinked > 0 && <div className="callout warn"><Icon name="link" /><div>{tr(`${k.unlinked} offene Tickets hängen an keinem Projekt. Ordne sie zu, damit Projektleitungen sehen, was ihr Projekt im Betrieb kostet.`, `${k.unlinked} open tickets are not linked to any project. Link them so project leads see what their project costs in operations.`)} <button className="linkbtn" onClick={() => go('unlinked')}>{tr('Jetzt zuordnen', 'Link now')}</button></div></div>}
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2 className="card-title"><Icon name="project" />{tr('Support-Last je Projekt', 'Support load per project')}</h2><span className="card-sub">{tr('offene Tickets', 'open tickets')}</span></div>
          <div style={{ padding: 20 }}>{rows.length ? <HBars large label={tr('Offene Tickets je Projekt', 'Open tickets per project')} items={rows.map((p) => ({ label: `#${p.item.rank} ${p.item.name}`, value: p.open, tone: p.breached ? 'bad' : 'ink', sub: tr(`${p.tickets} Tickets in 8 Wochen · ${fmt.h(p.hours)} gebucht`, `${p.tickets} tickets in 8 weeks · ${fmt.h(p.hours)} logged`), ref: p.ref }))} onPick={(it) => setView('project', { ref: it.ref })} /> : <div className="muted">{tr('Noch keine Tickets mit Projekten verknüpft.', 'No tickets linked to projects yet.')}</div>}</div>
        </section>
        <section className="card">
          <div className="card-head"><h2 className="card-title"><Icon name="shield" />{tr('SLA-Verletzungen je Projekt', 'SLA breaches per project')}</h2></div>
          <div className="table-scroll" tabIndex={0}>
            <table className="table">
              <thead><tr><th>{tr('Projekt', 'Project')}</th><th className="r">{tr('Tickets', 'Tickets')}</th><th className="r">{tr('Offen', 'Open')}</th><th className="r">{tr('Verletzt', 'Breached')}</th><th className="r">{tr('Gebucht', 'Logged')}</th></tr></thead>
              <tbody>{rows.map((p) => (
                <tr key={p.ref}>
                  <td><button className="linkbtn" onClick={() => setView('project', { ref: p.ref })}><b className="num">#{p.item.rank}</b> {p.item.name}</button></td>
                  <td className="r num">{p.tickets}</td><td className="r num">{p.open}</td>
                  <td className="r"><span className={`chip ${p.breached ? 'chip-bad' : 'chip-ok'} num`}>{p.breached}</span></td>
                  <td className="r num">{fmt.h(p.hours)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}


// ---------- what support costs the portfolio (waterline with and without the reserve) ----------
function Impact({ sup }) {
  const tip = useTip();
  const { computed } = useApp();
  const { s, model } = sup;
  const tname = (id) => model.teams.get(id)?.name || (id === '_none' ? tr('Ohne Team', 'No team') : id);
  const impact = useMemo(() => {
    if (!s) return [];
    const without = waterline(model, computed.metrics, null);
    const q = computed.wl.quarters[0];
    return computed.wl.teamIds.map((t) => {
      const w = computed.wl.cells[t]?.[q], o = without.cells[t]?.[q];
      if (!w || !(w.support > 0)) return null;
      const lost = (w.rows.filter((r) => r.kind === 'project' && r.status !== 'ok').length) - (o?.rows.filter((r) => r.kind === 'project' && r.status !== 'ok').length || 0);
      return { teamId: t, cap: w.capacity, support: w.support, util: w.util, utilWithout: o?.util ?? null, demand: w.demand, demandWithout: o?.demand ?? null, lost, firstHit: w.waterRank };
    }).filter(Boolean).sort((x, y) => y.support - x.support);
  }, [s, computed, model]);
  if (!impact.length) return null;
  return (
    <section className="card">
      <div className="card-head"><h2 className="card-title"><Icon name="waves" />{tr(`Was Support die Projekte kostet (${fmt.quarter(computed.wl.quarters[0])})`, `What support costs the projects (${fmt.quarter(computed.wl.quarters[0])})`)}</h2><span className="card-sub">{tr('Wasserlinie mit und ohne Support-Reserve', 'Waterline with and without the support reserve')}</span></div>
      <div className="table-scroll" tabIndex={0}>
        <table className="table">
          <thead><tr><th>Team</th><th className="r">{tr('Kapazität', 'Capacity')}</th><th className="r">{tr('Support-Reserve', 'Support reserve')}</th><th className="r">{tr('Auslastung ohne Support', 'Load without support')}</th><th className="r">{tr('mit Support', 'with support')}</th><th>{tr('Folge', 'Effect')}</th></tr></thead>
          <tbody>{impact.map((r) => (
            <tr key={r.teamId}>
              <td><b style={{ fontWeight: 540 }}>{tname(r.teamId)}</b></td>
              <td className="r num">{fmt.h(r.cap)}</td><td className="r num">{fmt.h(r.support)} <span className="faint">({fmt.pct(r.cap ? r.support / r.cap : 0)})</span></td>
              <td className="r"><span className={`chip num ${r.utilWithout > 1 ? 'chip-bad' : 'chip-ok'}`} tabIndex={0} {...tip(infoCard({ title: `${tname(r.teamId)} · ${tr('ohne Support', 'without support')}`, text: tr('Auslastung, wenn das Team keinen Support hätte: Projektbedarf ÷ Kapazität.', 'Utilization if the team had no support: project demand ÷ capacity.'), calc: r.demandWithout == null ? '–' : r.cap > 0 ? `${fmt.h(r.demandWithout)} ÷ ${fmt.h(r.cap)} = ${fmt.pct(r.utilWithout)}` : noCapacityReason(r.demandWithout, getLang()) }))}>{r.cap > 0 ? fmt.pct(r.utilWithout) : NO_CAP_TEXT}</span></td>
              <td className="r"><span className={`chip num ${r.util > 1 ? 'chip-bad' : r.util > 0.85 ? 'chip-warn' : 'chip-ok'}`} tabIndex={0} {...tip(infoCard({ title: `${tname(r.teamId)} · ${tr('mit Support', 'with support')}`, text: tr('Auslastung mit Support: Support-Reserve und Projektbedarf zusammen ÷ Kapazität. Der Support geht vor, deshalb fallen zuerst die Projekte mit niedrigem Rang heraus.', 'Utilization with support: support reserve and project demand together ÷ capacity. Support comes first, so the lowest-ranked projects drop out first.'), calc: r.cap > 0 ? `${fmt.h(r.demand)} ÷ ${fmt.h(r.cap)} = ${fmt.pct(r.util)}` : `${fmt.h(r.demand)} – ${noCapacityReason(r.demand, getLang())}`, inputs: [[tr('Kapazität', 'Capacity'), fmt.h(r.cap)], [tr('Support-Reserve', 'Support reserve'), fmt.h(r.support)], [tr('Bedarf inkl. Support', 'Demand incl. support'), fmt.h(r.demand)]] }))}>{r.cap > 0 ? fmt.pct(r.util) : NO_CAP_TEXT}</span></td>
              <td>{r.lost > 0 ? <span style={{ color: 'var(--bad)' }}>{tr(`${r.lost} ${r.lost > 1 ? 'Projekte fallen' : 'Projekt fällt'} unter die Wasserlinie${r.firstHit ? ` (ab Rang ${r.firstHit})` : ''}`, `${r.lost} ${r.lost > 1 ? 'projects drop' : 'project drops'} below the waterline${r.firstHit ? ` (from rank ${r.firstHit})` : ''}`)}</span> : <span className="muted">{tr('kein Projekt verdrängt', 'no project displaced')}</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
