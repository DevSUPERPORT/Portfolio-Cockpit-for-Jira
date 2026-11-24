import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { enter, tween, delayOf } from '../lib/motion.js';
import { useApp } from '../state.jsx';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { Empty, Segmented, useTip, infoCard } from './ui.jsx';
import { timeByGroup, availableDims, GROUP_DIMS } from '@shared/dispatch.js';
import './Support.css';

// "Wo geht die Support-Zeit hin?": the last 4 full weeks of support time by request type (default), component, label
// or cause; recurring topics (≥ 6 tickets and ≥ 8 h) flagged; empty / generic values as "Ohne Zuordnung".
const DIM_LABEL = { requestType: () => 'Request Type', component: () => tr('Komponente', 'Component'), label: () => 'Labels', cause: () => tr('Ursache', 'Cause') };

export default function SupportTime({ tickets, settings, svcSel, serviceName, ignoreLabels }) {
  const tip = useTip();
  const { computed, ds } = useApp();
  const { model } = computed;
  const avail = useMemo(() => availableDims(tickets, { causeFieldId: settings.causeFieldId, ignoreLabels }), [tickets, settings.causeFieldId, ignoreLabels]);
  const dims = GROUP_DIMS.filter((d) => avail[d]);
  const [pick, setPick] = useState(null);
  const dim = pick && avail[pick] ? pick : avail[settings.groupBy] ? settings.groupBy : dims[0];
  const scoped = useMemo(() => (tickets || []).filter((t) => !svcSel || (t.services || []).includes(svcSel)), [tickets, svcSel]);
  const g = useMemo(() => (dim ? timeByGroup(scoped, { dim, today: ds.today, weeks: 4, ignoreLabels }) : null), [scoped, dim, ds.today, ignoreLabels]);
  const tname = (id) => model.teams.get(id)?.name || (id === '_none' ? tr('ohne Team', 'no team') : id);
  if (!dims.length || !g) return null;
  const max = Math.max(1, ...g.rows.map((r) => r.hours));
  const noneMeta = dim === 'requestType' ? tr('allgemeiner Request Type (z. B. „Email request“) oder leer', 'generic request type (e.g. "Email request") or empty') : tr('Feld nicht gepflegt', 'field not maintained');
  return (
    <section className="card" style={{ overflow: 'hidden' }}>
      <div className="sp-head">
        <h2 className="card-title"><Icon name="target" />{tr('Wo geht die Support-Zeit hin?', 'Where does support time go?')}</h2>
        <span className="sp-info" tabIndex={0} {...tip(infoCard({
          title: tr('Wo geht die Support-Zeit hin?', 'Where does support time go?'),
          text: tr('Gebuchte Zeit der letzten 4 vollen Wochen auf Support-Tickets, gruppiert nach Request Type (Anliegen aus Kundensicht), Komponente, Labels oder Ursache. Orange = wiederkehrend (ab 6 Tickets und 8 h): Ursache beheben oder Self-Service anbieten senkt den Support dauerhaft.', 'Time logged in the last 4 full weeks on support tickets, grouped by request type (the customer\'s concern), component, labels or cause. Orange = recurring (6+ tickets and 8+ h): fixing the cause or offering self-service lowers support for good.'),
          hint: g.exact ? null : tr('Ohne datierte Buchungen: gezählt wird die ganze gebuchte Zeit offener und kürzlich gelöster Tickets (Näherung).', 'Without dated worklogs: the whole time spent of open and recently resolved tickets counts (approximation).'),
        }))}><Icon name="info" size={14} /></span>
        {g.none && <span className="chip num">{tr(`${fmt.pct(g.none.share)} ohne Zuordnung`, `${fmt.pct(g.none.share)} unassigned`)}</span>}
        {!g.exact && <span className="chip chip-outline">{tr('Näherung', 'approximation')}</span>}
        {dims.length > 1 && <div className="sp-head-end"><Segmented size="sm" value={dim} onChange={setPick} label={tr('Gruppieren nach', 'Group by')} options={dims.map((d) => ({ value: d, label: DIM_LABEL[d]() }))} /></div>}
      </div>
      {g.rows.length === 0 ? <Empty icon="clock" title={tr('Keine Support-Zeit in den letzten 4 Wochen', 'No support time in the last 4 weeks')} /> : (
        <div className="sp-scroll" tabIndex={0}>
          <div className="sp-grid-time sp-thead"><span>{DIM_LABEL[dim]()}</span><span>Team</span><span className="sp-r">Tickets</span><span className="sp-r">{tr('Zeit', 'Time')}</span><span>{tr('Anteil', 'Share')}</span></div>
          {g.rows.map((r, i) => (
            <motion.div key={`${dim}:${r.key}`} className={`sp-grid-time sp-row sp-time-row ${r.none ? 'none' : ''}`} {...enter(i, { y: 6, d: 'gentle' })}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <b style={{ fontWeight: 560 }}>{r.none ? tr('Ohne Zuordnung', 'Unassigned') : dim === 'label' ? `#${r.key}` : r.key}</b>
                <span className="sp-meta">{[r.none ? noneMeta : r.sub.length ? `${g.subDim === 'component' ? tr('Komponenten', 'Components') : 'Request Types'}: ${r.sub.join(', ')}` : null, r.services.map(serviceName).filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</span>
                {r.recurring && <span className="sp-flag"><Icon name="zap" size={11} />{tr('wiederkehrend – Ursache beheben oder Self-Service prüfen', 'recurring – fix the cause or consider self-service')}</span>}
                {r.none && <span className="sp-sub">{tr('Zuordnung pflegen, damit die Auswertung aussagekräftig ist', 'Maintain the field so the analysis is meaningful')}</span>}
              </span>
              <span className="muted" style={{ fontSize: 13 }}>{r.teams.slice(0, 3).map(tname).join(', ')}{r.teams.length > 3 ? ` +${r.teams.length - 3}` : ''}</span>
              <span className="sp-r">{r.tickets}</span>
              <span className="sp-r" style={{ fontWeight: 560 }}>{fmt.h(r.hours, r.hours < 10 ? 1 : 0)}</span>
              <span className="sp-share">
                <span className="sp-share-track"><motion.span className={`sp-share-fill ${r.none ? 'none' : r.recurring ? 'recurring' : ''}`} style={{ display: 'block' }} initial={{ scaleX: 0 }} animate={{ scaleX: r.hours / max }} transition={tween('gentle', { delay: delayOf(i) })} /></span>
                <span className="sp-share-pct">{fmt.pct(r.share)}</span>
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}
