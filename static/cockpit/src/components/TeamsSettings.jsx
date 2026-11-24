// Configuration › Teams: membership from Atlassian Teams (home.atlassian.com › Teams) and which teams the cockpit
// shows at all (boss feedback 2026-11-17).
import { useEffect, useMemo, useState } from 'react';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call } from '../lib/api.js';
import { useApp } from '../state.jsx';

export default function TeamsSettings({ cfg, upd, computed }) {
  const [conn, setConn] = useState(null);
  const [busy, setBusy] = useState(false);
  const { reload } = useApp();
  // "Sync now": a fresh read of Atlassian Teams, then the cockpit data again – so every view shows the new members
  const load = (refresh = false) => {
    setBusy(true);
    return call('teams.atlassian', refresh ? { refresh: true } : {})
      .then((r) => { setConn(r); if (refresh && r?.status === 'ok') reload?.(true); }, () => setConn({ status: 'error' }))
      .finally(() => setBusy(false));
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const t = cfg.teams || { source: 'atlassian', show: null };
  const model = computed?.model;
  // every team the cockpit knows: Atlassian Teams with members, plus the teams set on work items (shown or hidden)
  const rows = useMemo(() => {
    const by = new Map();
    for (const x of conn?.teams || []) by.set(x.id, { id: x.id, name: x.name, members: x.members, items: 0 });
    const known = model ? [...model.teams.values(), ...(model.teams.hidden ? model.teams.hidden.values() : [])] : [];
    for (const x of known) if (!by.has(x.id)) by.set(x.id, { id: x.id, name: x.name, members: null, items: 0 });
    for (const i of model?.ds.issues || []) { const r = i.team?.id && by.get(i.team.id); if (r && i.status?.cat !== 'done') r.items++; }
    return [...by.values()].map((r) => ({ ...r, name: r.name || model?.teams.get(r.id)?.name || r.id }))
      .sort((a, b) => (b.items > 0) - (a.items > 0) || a.name.localeCompare(b.name, 'de'));
  }, [conn, model]);
  const shown = (id) => !t.show || t.show.includes(id);
  const setTeams = (fn) => upd((c) => { c.teams = fn({ source: c.teams?.source || 'atlassian', show: c.teams?.show || null }); });
  const setShow = (id, on) => setTeams((cur) => {
    const list = cur.show || rows.map((r) => r.id);
    const next = on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
    return { ...cur, show: rows.every((r) => next.includes(r.id)) ? null : next };
  });
  const st = conn?.status;
  const synced = conn?.at ? fmt.ago(new Date(conn.at).toISOString()) : '';
  const chip = !conn ? <span className="faint">{tr('prüfe Verbindung …', 'checking connection …')}</span>
    : st === 'ok' ? <span className="chip chip-ok" data-teams-status="ok"><Icon name="check" size={12} />{tr(`Verbunden · ${conn.teams.length} Teams · abgeglichen ${synced}`, `Connected · ${conn.teams.length} teams · synced ${synced}`)}</span>
      : st === 'noField' ? <span className="chip chip-warn" data-teams-status={st}><Icon name="alert" size={12} />{tr('Kein Team-Feld zugeordnet (Felder › Team)', 'No Team field mapped (Fields › Team)')}</span>
        : st === 'empty' ? <span className="chip chip-warn" data-teams-status={st}><Icon name="alert" size={12} />{tr('Teams gefunden, aber keine Mitglieder lesbar', 'Teams found, but no members readable')}</span>
          : <span className="chip chip-warn" data-teams-status={st || 'error'}><Icon name="alert" size={12} />{tr('Atlassian Teams gerade nicht erreichbar', 'Atlassian Teams not reachable right now')}</span>;
  // one source only (boss 2026-11-18: "reduce complexity"): Atlassian Teams. An older configuration set to
  // "cockpit maintenance only" keeps working and gets one button back to Atlassian Teams.
  const atl = t.source !== 'cockpit';
  const [showIdle, setShowIdle] = useState(false);
  const active = rows.filter((r) => r.items > 0);
  const idle = rows.filter((r) => !(r.items > 0));
  return (
    <div className="stack" style={{ gap: 16 }} data-teams-cfg>
      <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
        {!atl && <button className="btn btn-sm" onClick={() => setTeams((cur) => ({ ...cur, source: 'atlassian' }))}><Icon name="users" size={13} />{tr('Mitglieder aus Atlassian Teams übernehmen', 'Take members from Atlassian Teams')}</button>}
        {atl && <b style={{ fontWeight: 560 }}>{tr('Mitglieder aus Atlassian Teams', 'Members from Atlassian Teams')}</b>}
        {atl && chip}
        {atl && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => load(true)}><Icon name="refresh" size={13} />{busy ? tr('gleiche ab …', 'syncing …') : tr('Jetzt abgleichen', 'Sync now')}</button>}
      </div>
      <div className="muted" style={{ fontSize: 12.5, maxWidth: 780 }}>
        {atl
          ? tr('Wer zu einem Team gehört, pflegt ihr in Atlassian Teams (home.atlassian.com › Teams) – das Cockpit gleicht alle 5 Minuten ab. Im Cockpit pflegt ihr nur Stunden, Standort und Anteile (Teams › Kapazitäten pflegen). Hier wählt ihr, welche Teams im Cockpit erscheinen.',
            'Who belongs to a team is maintained in Atlassian Teams (home.atlassian.com › Teams) – the cockpit syncs every 5 minutes. In the cockpit you only maintain hours, location and shares (Teams › Maintain capacities). Here you choose which teams appear in the cockpit.')
          : tr('Gerade gilt noch die Cockpit-Pflege (Mitglied ist, wer unter Teams › Kapazitäten pflegen einen Anteil hat). Mit dem Knopf oben kommen die Mitglieder aus Atlassian Teams.', 'Cockpit maintenance still applies right now (a member is whoever has a share under Teams › Maintain capacities). The button above takes the members from Atlassian Teams.')}
      </div>
      {atl && st === 'empty' && (
        <div className="callout warn"><Icon name="alert" /><div>{tr('Die App darf die Mitglieder nicht lesen. Ein Organisations-Admin muss beim Installieren oder Aktualisieren der App den Zugriff auf Teams (Teamwork Graph) erlauben. Bis dahin gilt die Cockpit-Pflege.', 'The app may not read the members. An organization admin has to allow access to Teams (Teamwork Graph) when installing or updating the app. Until then the cockpit maintenance applies.')}</div></div>
      )}
      <div>
        <div className="row wrap" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <span className="label" style={{ margin: 0 }}>{tr('Im Cockpit anzeigen', 'Show in the cockpit')} · <span className="num">{rows.filter((r) => shown(r.id)).length}/{rows.length}</span></span>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setTeams((cur) => ({ ...cur, show: null }))}>{tr('Alle', 'All')}</button>
            <button className="btn btn-ghost btn-sm" disabled={!rows.some((r) => r.items > 0)} onClick={() => setTeams((cur) => ({ ...cur, show: rows.filter((r) => r.items > 0).map((r) => r.id) }))}>{tr('Nur Teams mit Aufgaben', 'Only teams with tasks')}</button>
          </span>
        </div>
        <div className="team-cfg-grid" role="group" aria-label={tr('Teams im Cockpit', 'Teams in the cockpit')}>
          {[...active, ...(showIdle || !active.length ? idle : [])].map((r) => (
            <label key={r.id} className="team-cfg" data-on={shown(r.id)}>
              <input type="checkbox" checked={shown(r.id)} onChange={(e) => setShow(r.id, e.target.checked)} />
              <span className="team-cfg-name">{r.name}</span>
              <span className="team-cfg-meta">
                {r.members != null ? tr(`${r.members} ${r.members === 1 ? 'Mitglied' : 'Mitglieder'}`, `${r.members} ${r.members === 1 ? 'member' : 'members'}`) : tr('nicht in Atlassian Teams', 'not in Atlassian Teams')}
                {' · '}{r.items ? tr(`${r.items} offene Aufgaben`, `${r.items} open tasks`) : tr('keine Aufgaben', 'no tasks')}
              </span>
            </label>
          ))}
          {!rows.length && <div className="faint">{tr('Noch keine Teams gefunden.', 'No teams found yet.')}</div>}
        </div>
        {active.length > 0 && idle.length > 0 && <button type="button" className="linkbtn" style={{ marginTop: 8 }} data-idle-teams aria-expanded={showIdle} onClick={() => setShowIdle((v) => !v)}>{showIdle ? tr('Teams ohne Aufgaben ausblenden', 'Hide teams without tasks') : tr(`${idle.length} ${idle.length === 1 ? 'Team' : 'Teams'} ohne Aufgaben zeigen (${idle.filter((r) => shown(r.id)).length} davon im Cockpit)`, `Show ${idle.length} ${idle.length === 1 ? 'team' : 'teams'} without tasks (${idle.filter((r) => shown(r.id)).length} of ${idle.length === 1 ? 'it' : 'them'} in the cockpit)`)}</button>}
        <div className="faint" style={{ fontSize: 12, marginTop: 8 }}>{tr('Ausgeblendete Teams verschwinden aus Teams, Wochenplanung, Kapazität und Kennzahlen. Ihre Aufgaben bleiben in den Projekten und zählen dort weiter.', 'Hidden teams disappear from Teams, weekly planning, capacity and KPIs. Their tasks stay in the projects and still count there.')}</div>
      </div>
    </div>
  );
}
