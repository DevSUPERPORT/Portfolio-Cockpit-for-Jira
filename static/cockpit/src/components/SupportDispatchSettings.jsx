import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { tr } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { useTip, infoCard, spring } from './ui.jsx';
import { dispatchSettings } from '@shared/dispatch.js';
import './Support.css';

// Admin section "Verteilen & Auswertung" (UC-17) inside Configuration › Support.
// props:
//   value      – the whole cfg.support object
//   onChange   – (nextSupport) => void; only `dispatch`, `timeGroupBy` and `causeFieldId` are changed:
//                dispatch = { incomingStatusIds: string[], afterStatusId: string|null, componentTeams: { [componentName]: teamId } }
//   statuses   – [{ id, name, category? ('new'|'indeterminate'|'done') }] of the service spaces' workflows
//   teams      – [{ id, name }]
//   components – [string | { id, name }] of the service spaces
//   fields     – [{ id: 'customfield_…', name }] single/multi select custom fields (candidates for "Ursache")
// Validate on save with validSupportDispatch() from shared/dispatch.js.
const ORDER = { new: 0, indeterminate: 1, done: 2 };

export default function SupportDispatchSettings({ value, onChange, statuses = [], teams = [], components = [], fields = [] }) {
  const tip = useTip();
  const s = dispatchSettings({ support: value });
  const [q, setQ] = useState('');
  const put = (patch) => onChange({ ...(value || {}), dispatch: { incomingStatusIds: s.incomingStatusIds, afterStatusId: s.afterStatusId, componentTeams: s.componentTeams, ...(patch.dispatch || {}) }, ...(patch.top || {}) });
  const sts = useMemo(() => [...statuses].sort((a, b) => (ORDER[a.category] ?? 1) - (ORDER[b.category] ?? 1) || String(a.name).localeCompare(String(b.name))), [statuses]);
  const comps = useMemo(() => [...new Set(components.map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [components]);
  const n = q.trim().toLowerCase();
  const shownComps = comps.filter((c) => !n || c.toLowerCase().includes(n));
  const toggle = (id) => {
    const set = new Set(s.incomingStatusIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    put({ dispatch: { incomingStatusIds: [...set] } });
  };
  const mapTeam = (comp, teamId) => {
    const m = { ...s.componentTeams };
    if (teamId) m[comp] = teamId; else delete m[comp];
    put({ dispatch: { componentTeams: m } });
  };
  const help = (title, text) => <span className="sp-info" tabIndex={0} {...tip(infoCard({ title, text }))}><Icon name="info" size={13} /></span>;
  return (
    <div className="sp-set">
      <div className="sp-set-block">
        <span className="label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 0 }}>{tr('Eingangs-Status (zu verteilen)', 'Incoming statuses (to dispatch)')}{help(tr('Eingangs-Status', 'Incoming statuses'), tr('Nur Tickets in diesen Status erscheinen unter „Verteilen“. Ohne Auswahl gelten alle offenen Tickets im Status „Zu erledigen“.', 'Only tickets in these statuses appear under "Dispatching". Without a selection every open ticket in the "To Do" category counts.'))}</span>
        {sts.length ? (
          <div className="sp-chips" role="group" aria-label={tr('Eingangs-Status', 'Incoming statuses')}>
            {sts.map((st) => {
              const on = s.incomingStatusIds.includes(String(st.id));
              return (
                <button key={st.id} type="button" className="sp-chip sm" aria-pressed={on} onClick={() => toggle(String(st.id))}>
                  {on && <motion.span layoutId={`sp-set-in-${st.id}`} className="sp-chip-pill" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={spring} />}
                  {on && <Icon name="check" size={12} />}{st.name}
                </button>
              );
            })}
          </div>
        ) : <span className="faint" style={{ fontSize: 12.5 }}>{tr('Zuerst Service-Spaces auswählen – dann erscheinen hier ihre Status.', 'Pick service spaces first – their statuses appear here.')}</span>}
        {!s.incomingStatusIds.length && sts.length > 0 && <span className="sp-note"><Icon name="info" size={12} />{tr('Keine Auswahl: es zählen alle offenen Tickets im Status „Zu erledigen“.', 'No selection: every open ticket in the "To Do" category counts.')}</span>}
      </div>

      <div className="sp-set-block" style={{ maxWidth: 360 }}>
        <label className="label" htmlFor="sp-after" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{tr('Status nach Zuweisung', 'Status after assignment')}{help(tr('Status nach Zuweisung', 'Status after assignment'), tr('„Zuweisen“ führt den Übergang in diesen Status aus, wenn der Workflow einen anbietet. Sonst bleibt der Status, und die App sagt es.', '"Assign" runs the transition into this status when the workflow offers one. Otherwise the status stays and the app says so.'))}</label>
        <select id="sp-after" className="select" value={s.afterStatusId || ''} onChange={(e) => put({ dispatch: { afterStatusId: e.target.value || null } })}>
          <option value="">{tr('– Status nicht ändern –', '– keep the status –')}</option>
          {sts.filter((st) => st.category !== 'done').map((st) => <option key={st.id} value={String(st.id)}>{st.name}</option>)}
        </select>
      </div>

      <div className="sp-set-block">
        <span className="label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 0 }}>{tr('Komponente → Team', 'Component → team')}{help(tr('Komponente → Team', 'Component → team'), tr('Welches Team ein Ticket mit dieser Komponente vorgeschlagen bekommt. „Automatisch“ = das Team, das solche Tickets zuletzt meist gelöst hat.', 'Which team is suggested for a ticket with this component. "Automatic" = the team that mostly resolved such tickets recently.'))}</span>
        {comps.length > 10 && <label className="input-wrap" style={{ maxWidth: 280 }}><Icon name="search" size={14} /><input className="input input-sm" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Komponente suchen …', 'Search component …')} aria-label={tr('Komponente suchen', 'Search component')} /></label>}
        {comps.length ? (
          <div className="sp-set-map">
            {shownComps.map((c) => (
              <div key={c} className="sp-set-map-row">
                <span>{c}</span>
                <select className="select select-sm" value={Object.hasOwn(s.componentTeams, c) ? s.componentTeams[c] : ''} onChange={(e) => mapTeam(c, e.target.value)} aria-label={tr(`Team für Komponente ${c}`, `Team for component ${c}`)}>
                  <option value="">{tr('Automatisch (aus dem Verlauf)', 'Automatic (from history)')}</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            ))}
            {!shownComps.length && <div className="faint" style={{ padding: 10, fontSize: 12.5 }}>{tr('Nichts gefunden.', 'Nothing found.')}</div>}
          </div>
        ) : <span className="faint" style={{ fontSize: 12.5 }}>{tr('Die Service-Spaces haben keine Komponenten – vorgeschlagen wird das Team am Ticket.', 'The service spaces have no components – the team on the ticket is suggested.')}</span>}
      </div>

      <div className="row wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div className="sp-set-block" style={{ minWidth: 240 }}>
          <label className="label" htmlFor="sp-group">{tr('„Wo geht die Support-Zeit hin?“ gruppieren nach', '"Where does support time go?" group by')}</label>
          <select id="sp-group" className="select" value={s.groupBy} onChange={(e) => put({ top: { timeGroupBy: e.target.value } })}>
            <option value="requestType">Request Type</option>
            <option value="component">{tr('Komponente', 'Component')}</option>
            <option value="label">Labels</option>
            <option value="cause" disabled={!s.causeFieldId}>{tr('Ursache', 'Cause')}</option>
          </select>
          <span className="sp-note">{tr('Standard im Tab Support; dort jederzeit umschaltbar.', 'Default in the Support tab; switchable there any time.')}</span>
        </div>
        <div className="sp-set-block" style={{ minWidth: 240 }}>
          <label className="label" htmlFor="sp-cause" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{tr('Feld „Ursache“', 'Field "Cause"')}{help(tr('Ursache', 'Cause'), tr('Ein eigenes Auswahlfeld, das Agents beim Lösen setzen (z. B. „Bedienung“, „Fehler im Release“).', 'A custom select field agents set when resolving (e.g. "Usage", "Release bug").'))}</label>
          <select id="sp-cause" className="select" value={s.causeFieldId || ''} onChange={(e) => put({ top: { causeFieldId: e.target.value || null, ...(!e.target.value && s.groupBy === 'cause' ? { timeGroupBy: 'requestType' } : {}) } })}>
            <option value="">{tr('– kein Feld –', '– no field –')}</option>
            {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
