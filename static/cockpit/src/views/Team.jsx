// Teamdetails: one team in detail – support first, then its projects in portfolio rank, its people week by week,
// and what is blocked or past due. Every number comes from the same engine as Portfolio, Capacity and Waterline.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { teamDetails, teamWeeks, teamIds } from '@shared/team.js';
import { personWeekCard, teamWeekCard, quarterCard } from '../lib/cards.js';
import { useApp } from '../state.jsx';
import { Prof } from '../lib/virtual.jsx';
import { tr, fmt, getLang } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { openIssue, openUrl } from '../lib/api.js';
import { Segmented, Empty, HealthDot, useTip, stagger, infoCard } from '../components/ui.jsx';
import { heat, ink, HeatLegend, EditCapacity } from './Capacity.jsx';
import GapBox from '../components/GapBox.jsx';
import AiAssist from '../components/AiAssist.jsx';
import { LotseChip } from '../components/lotse/LotseChip.jsx';
import { KpiTiles, Legend } from '../components/KpiTiles.jsx';
import WeekBoard from '../components/WeekBoard.jsx';
import { canPlan } from '@shared/weekPlan.js';
import { teamKpis, teamDefinitions, noCapacityReason, NO_CAP_TEXT } from '@shared/kpis.js';
import { teamOutsiders, capacityDrift, membershipSource } from '@shared/teamMembership.js';
import { splitConflicts, realConflicts } from '@shared/splitPeople.js';
import { capacityPeople } from '@shared/engine.js';
import { inTeam } from '@shared/allocation.js';
import { openLotse } from '../components/lotse/open.js';

// the hours left (or missing) in plain words, next to the percentage

export default function Team() {
  const app = useApp();
  const { computed, ds, teamSel, setTeamSel, config, lang, roles } = app;
  const [area, setArea] = useState('overview');
  const [watchKind, setWatchKind] = useState('all');
  const [legend, setLegend] = useState(false);
  const { model } = computed;
  const ids = useMemo(() => teamIds(computed), [computed]);
  const all = useMemo(() => Object.fromEntries(ids.map((id) => [id, teamDetails(computed, id)])), [ids, computed]);
  const fallback = ids.find((id) => all[id].projects.length) || ids[0];
  const team = ids.includes(teamSel) ? teamSel : fallback;
  const [mode, setMode] = useState('weeks');
  const [open, setOpen] = useState(() => new Set());
  const tip = useTip();
  // the team's tiles once per data state and team (not on every toggle of the view)
  const tkpis = useMemo(() => (team ? teamKpis({ computed, teamId: team, lang, fmt, people: ds.people || {} }) : null), [computed, team, lang, ds.people]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ids.length) return <div className="page"><div className="card"><Empty icon="users" title={tr('Noch keine Teams', 'No teams yet')}>{tr('Teams erscheinen, sobald Stories ein Team haben oder Kapazitäten gepflegt sind.', 'Teams appear once stories have a team or capacities are maintained.')}</Empty></div></div>;
  const td = all[team];
  const name = (id) => model.teams.get(id)?.name || id;
  const person = (id) => ds.people?.[id]?.name || tr('Person', 'Person');
  const q0 = td.quarters[0];
  const rhythm = config.rules?.healthRhythmDays || 7;
  const gapScope = useMemo(() => ({ team }), [team]);
  const watch = td.watch.filter((w) => watchKind === 'all' || (watchKind === 'blocked' ? w.blocked : w.overdue));
  const toggle = (ref) => setOpen((s) => { const n = new Set(s); if (n.has(ref)) n.delete(ref); else n.add(ref); return n; });
  return (
    <div className="page">
      <div className="team-picker" role="group" aria-label={tr('Team wählen', 'Choose team')}>
        {ids.map((id) => {
          const t = all[id];
          return (
            <button key={id} type="button" className={`team-pill ${id === team ? 'on' : ''}`} aria-pressed={id === team} onClick={() => setTeamSel(id)}
              {...tip(<div>{t.projects.map((p) => <div key={p.ref}>{p.rank} · {p.name}</div>)}{t.spaces.length ? <div>+ {t.spaces.length} {tr('Service-Spaces', 'service spaces')}</div> : null}{!t.projects.length && !t.spaces.length && tr('Keine Projekte', 'No projects')}</div>)}>
              <b>{name(id)}</b><span>{t.projects.length} {t.projects.length === 1 ? tr('Projekt', 'project') : tr('Projekte', 'projects')} · {t.kpis.members} {tr('Pers.', 'ppl')}</span>
            </button>
          );
        })}
      </div>

      <div className="row wrap" style={{ justifyContent: 'space-between', gap: 10 }}>
        {roles.editCapacity ? <Segmented value={area} onChange={setArea} label={tr('Bereich', 'Area')} options={[{ value: 'overview', label: tr('Übersicht', 'Overview'), icon: 'layers' }, { value: 'edit', label: tr('Kapazitäten pflegen', 'Maintain capacities'), icon: 'users' }]} /> : <span />}
        <span className="row" style={{ gap: 6 }}>
          <LotseChip skill="teamBrief" params={{ team }} label={tr('Lotse: Team-Lage', 'Lotse: team briefing')} />
          <button className="btn btn-sm btn-ghost" onClick={() => setLegend(true)}><Icon name="help" />{tr('Legende', 'Legend')}</button>
        </span>
      </div>
      {area !== 'edit' && tkpis?.find((k) => k.id === 'util')?.noCap && (
        <div className="callout warn team-nocap" role="status">
          <Icon name="alert" />
          <div className="grow">
            <b>{tr(`${name(team)}: ${noCapacityReason(td.cells[q0]?.demand || 0, 'de')}`, `${name(team)}: ${noCapacityReason(td.cells[q0]?.demand || 0, 'en')}`)}.</b>{' '}
            {(td.cells[q0]?.demand || 0) > 0.05
              ? tr(`${fmt.h(td.cells[q0].demand)} Bedarf in ${fmt.quarter(q0)}, aber niemand mit Wochenstunden im Team – eine Auslastung lässt sich nicht berechnen.`, `${fmt.h(td.cells[q0].demand)} demand in ${fmt.quarter(q0)}, but nobody with weekly hours in the team – utilization cannot be calculated.`)
              : tr('Dem Team ist niemand mit Wochenstunden zugeordnet – deshalb steht bei der Auslastung „–“.', 'Nobody with weekly hours is assigned to the team – so utilization shows “–”.')}
            {' '}{roles.editCapacity ? tr('Personen und Wochenstunden unter „Kapazitäten pflegen“ eintragen.', 'Add people and weekly hours under “Maintain capacities”.') : tr('Kapazitäten pflegen Personen mit Kapazitätsrechten (Teams › Kapazitäten pflegen).', 'People with capacity rights maintain capacities (Teams › Maintain capacities).')}
          </div>
          {roles.editCapacity && <button type="button" className="btn btn-sm" onClick={() => setArea('edit')}><Icon name="users" size={13} />{tr('Kapazitäten pflegen', 'Maintain capacities')}</button>}
        </div>
      )}
      {area !== 'edit' && <Outsiders model={computed.model} team={team} teamName={name(team)} onEdit={roles.editCapacity ? () => setArea('edit') : null} />}
      {area !== 'edit' && <MultiTeam computed={computed} team={team} teamName={name(team)} canFix={!!(roles.editCapacity || canPlan(roles))} />}
      {area === 'edit' && roles.editCapacity ? (
        <motion.div key={`edit-${team}`} className="stack" style={{ gap: 20 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="callout"><Icon name="info" /><div>{tr(`Wochenstunden, Standort und Abwesenheiten der Mitglieder von ${name(team)} – und wer für das Team verantwortlich ist. Änderungen wirken sofort auf Auslastung und Wasserlinie.`, `Weekly hours, location and absences of ${name(team)}'s members – and who is responsible for the team. Changes take effect on utilisation and the waterline at once.`)}</div></div>
          <EditCapacity teamId={team} />
        </motion.div>
      ) : <>
      <div className="stack" style={{ gap: 8 }}>
        {/* every tile, its breakdown and the legend come from the one KPI registry (shared/kpis.js), as on the portfolio */}
        <KpiTiles kpis={tkpis} subject={name(team)} onJump={(area) => document.querySelector(`[data-team-area="${area}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
      </div>
      {/* KI-Assistent: a one-paragraph briefing for the team lead (from the caller's own dataset, minimised) */}
      <AiAssist key={team} feature="teamBrief" label={tr('Team-Lagebild', 'Team briefing')} title={`${tr('Lagebild', 'Briefing')} · ${name(team)}`}
        build={() => ({ teamId: team })} copy={(r) => [r.text, ...(r.points || []).map((x) => `- ${x}`)].join('\n')} />
      <Legend open={legend} onClose={() => setLegend(false)} title={`${tr('Teamdetails', 'Team details')} · ${name(team)}`} sub={tr('Unter jeder Definition steht die Rechnung mit den aktuellen Zahlen.', 'Under each definition is the calculation with the current numbers.')}
        defs={teamDefinitions(lang)} kpis={tkpis} subject={name(team)} />

      {(td.spaces.length > 0 || td.projects.length > 0) && (
        <section className="card card-pad">
          <div className="eyebrow" style={{ marginBottom: 8 }}>{tr('Beteiligte Projekte und Service-Spaces', 'Projects and service spaces involved')}</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {td.spaces.map((s) => <button key={s.id} type="button" className="chip chip-outline team-chip" onClick={() => app.setView('support')} {...tip(spaceCard(s, name(team)))}><span className="badge s">S</span>{s.name}</button>)}
            {td.projects.map((p) => <button key={p.ref} type="button" className="chip chip-outline team-chip" onClick={() => app.setView('project', { ref: p.ref })} {...tip(projectCard(p, td, team, name(team), computed, person))}><span className="badge">{p.rank}</span>{p.name}</button>)}
          </div>
        </section>
      )}

      <TeamCapacity td={td} team={team} name={name} person={person} mode={mode} setMode={setMode} onPlan={() => { setTeamSel(team); app.setView('plan'); }} />

      <section className="card" data-team-area="watch">
        <div className="card-head">
          <div>
            <h2 className="card-title"><Icon name="alert" />{tr('Blockiert und überfällig', 'Blocked and past due')}</h2>
            <div className="card-sub" style={{ marginTop: 3 }}>{tr('Stories und Sub-tasks des Teams im Status Blocked oder über dem Due Date.', 'Stories and sub-tasks of the team in the Blocked status or past their due date.')}</div>
          </div>
          {td.watch.length > 0 && <Segmented size="sm" value={watchKind} onChange={setWatchKind} label={tr('Filter', 'Filter')} options={[
            { value: 'all', label: `${tr('Alle', 'All')} (${td.watch.length})` },
            { value: 'blocked', label: `${tr('Blockiert', 'Blocked')} (${td.watch.filter((w) => w.blocked).length})` },
            { value: 'overdue', label: `${tr('Überfällig', 'Past due')} (${td.watch.filter((w) => w.overdue).length})` }]} />}
        </div>
        {watch.length === 0 ? <Empty icon="check" title={tr('Nichts blockiert oder überfällig.', 'Nothing blocked or past due.')} /> : (
          <ul className="watch-list">
            {watch.slice(0, 40).map((w, i) => {
              const it = model.byId.get(w.id);
              const proj = model.itemByRef.get(w.rootRef);
              return (
                <motion.li key={w.id} {...stagger(i, 0.02)}>
                  <span className={`chip ${w.blocked ? 'chip-accent' : 'chip-outline'}`}>{w.blocked ? 'Blocked' : tr('Überfällig', 'Past due')}</span>
                  <button type="button" className="tkey" onClick={() => openIssue(it.key)}>{it.key}</button>
                  <span className="watch-sum">{it.summary}</span>
                  <span className="faint">{proj?.name}{it.assignee ? ` · ${it.assignee.name}` : ''}{w.overdue ? ` · Due ${fmt.date(it.due)} (+${w.days} ${tr('T', 'd')})` : ''}{w.blocked && w.since ? ` · ${tr('seit', 'since')} ${fmt.date(w.since)}` : ''}</span>
                </motion.li>
              );
            })}
          </ul>
        )}
      </section>

      <div data-team-area="gaps"><GapBox scope={gapScope} title={tr(`Fehlende Werte im Team ${name(team)}`, `Missing values in team ${name(team)}`)} /></div>

      <section className="card" data-team-area="projects">
        <div className="card-head">
          <div>
            <h2 className="card-title"><Icon name="layers" />{tr(`Woran ${name(team)} arbeitet`, `What ${name(team)} works on`)}</h2>
            <div className="card-sub" style={{ marginTop: 3, maxWidth: 820 }}>{tr('Support zuerst, danach die Projekte in Portfolio-Rangfolge. Je Quartal der offene Bedarf des Teams (Remaining Estimate + offene T-Shirt Size). Orange = passt nicht mehr in die Kapazität. Klick auf ein Projekt zeigt die Vorgänge des Teams.', 'Support first, then the projects in portfolio rank. Per quarter the team\'s open demand (remaining estimate + open T-shirt size). Orange = no longer fits the capacity. Click a project to see the team\'s work items.')}</div>
          </div>
        </div>
        <div className="tw-scroll">
          <div className="tw" style={{ '--qs': td.quarters.length }}>
            <div className="tw-row tw-head"><span>{tr('Rang', 'Rank')}</span><span>{tr('Projekt', 'Project')}</span><span className="num">Time Spent</span>{td.quarters.map((q) => <span key={q} className="num">{fmt.quarter(q)}</span>)}</div>
            {td.spaces.map((s) => (
              <div key={s.id} className="tw-row">
                <span className="rank-num s" style={{ width: 28, height: 28, fontSize: 13 }}>S</span>
                <button type="button" className="tw-name" onClick={() => app.setView('support')}><b>Support · {s.name}</b><span className="faint">{s.key ? `${s.key} · ` : ''}Ø {fmt.h(s.weekly)} {tr('/ Woche', '/ week')} · {s.open} {tr('offene Tickets', 'open tickets')}</span></button>
                <span className="num muted tw-ts">Ø {fmt.h(s.weekly)}{tr('/W.', '/wk')}</span>
                {td.quarters.map((q) => <span key={q} className="tw-cell" data-q={fmt.quarter(q)} {...tip(<div>{tr('Reserviert vor allen Projekten', 'Reserved before all projects')}: {fmt.h(s.weekly * 12)}</div>)}>{fmt.h(s.weekly * 12)}</span>)}
              </div>
            ))}
            {td.projects.map((p) => (
              <div key={p.ref}>
                <div className="tw-row">
                  <span className="rank-num" style={{ fontSize: 16 }}>{p.rank}</span>
                  <button type="button" className="tw-name" aria-expanded={open.has(p.ref)} onClick={() => toggle(p.ref)}>
                    <b className="row" style={{ gap: 6 }}><Icon name={open.has(p.ref) ? 'chevronDown' : 'chevron'} size={12} /><HealthDot health={p.health} rhythmDays={rhythm} size={8} />{p.name}</b>
                    <span className="faint">{p.leadEpics.length ? p.leadEpics.slice(0, 3).join(', ') + (p.leadEpics.length > 3 ? ' …' : '') : p.isLead ? tr('Lead-Team', 'lead team') : tr('Zuarbeit für andere Lead-Teams', 'contributing to other lead teams')}</span>
                  </button>
                  <span className="num tw-ts" data-label="Time Spent">{p.ts > 0 ? fmt.h(p.ts) : '–'}</span>
                  {td.quarters.map((q) => {
                    const c = p.q[q];
                    if (!(c.demand > 0.5)) return <span key={q} className="tw-cell empty" data-q={fmt.quarter(q)}>–</span>;
                    const over = c.status !== 'ok';
                    return <span key={q} className={`tw-cell ${over ? 'over' : 'fill'}`} data-q={fmt.quarter(q)} {...tip(<div><b>{fmt.quarter(q)}</b>: {fmt.h(c.demand)} {tr('offener Bedarf (Remaining Estimate + offene T-Shirt Size)', 'open demand (remaining estimate + open T-shirt size)')}{over ? <div>{tr(`passt nicht mehr in die Kapazität – ${fmt.h(c.demand - c.staffed)} fehlen`, `no longer fits the capacity – ${fmt.h(c.demand - c.staffed)} missing`)}</div> : null}</div>)}>{fmt.h(c.demand)}</span>;
                  })}
                </div>
                {/* no exit animation (it stalls in the Jira frame): closing simply unmounts */}
                {open.has(p.ref) && <TeamIssues refId={p.ref} team={team} name={name} onOpenProject={() => app.setView('project', { ref: p.ref })} />}
              </div>
            ))}
            {!td.projects.length && !td.spaces.length && <Empty icon="layers" title={tr('Dieses Team hat keinen offenen Bedarf.', 'This team has no open demand.')} />}
            <div className="tw-row tw-foot"><span /><span>{tr('Kapazität nach Support', 'Capacity after support')}</span><span />{td.quarters.map((q) => <span key={q} className="num" data-q={fmt.quarter(q)}>{fmt.h(td.cells[q].cap)}</span>)}</div>
            <div className="tw-row tw-foot"><span /><span>{tr('Projektbedarf', 'Project demand')}</span><span />{td.quarters.map((q) => <span key={q} className="num" data-q={fmt.quarter(q)}>{fmt.h(td.cells[q].demand)}</span>)}</div>
            <div className="tw-row tw-foot"><span /><b>{tr('Frei / fehlt', 'Free / missing')}</b><span />{td.quarters.map((q) => { const f = td.cells[q].free; return <b key={q} className="num" data-q={fmt.quarter(q)} style={{ color: f < -0.5 ? 'var(--bad)' : 'var(--ok)' }}>{f < -0.5 ? `−${fmt.h(-f)}` : fmt.h(f)}</b>; })}</div>
          </div>
        </div>
      </section>
      </>}
    </div>
  );
}

// The team's capacity: per person, week by week until the end of the quarter, or per quarter against demand.
function TeamCapacity({ td, team, name, person, mode, setMode, onPlan }) {
  const { computed, roles } = useApp();
  const tip = useTip();
  const tw0 = useMemo(() => teamWeeks(computed, team), [computed, team]);
  const tw = { ...tw0, teamId: team };
  const problems = td.quarters.filter((q) => td.cells[q].free < -0.5);
  return (
    <section className="card" data-team-area="capacity">
      <div className="card-head">
        <div>
          <h2 className="card-title"><Icon name="gauge" />{tr('Kapazität des Teams', 'Team capacity')}</h2>
          <div className="card-sub" style={{ marginTop: 3 }}>{mode === 'weeks'
            ? tr(`Restliches Quartal ${fmt.quarter(td.quarters[0])}: geplante Stunden je Person über alle Projekte, Farbe = Auslastung nach Support`, `Rest of ${fmt.quarter(td.quarters[0])}: planned hours per person over all projects, colour = utilization after support`)
            : tr('Projektbedarf des Teams je Quartal gegen die Kapazität nach Support', 'The team\'s project demand per quarter against its capacity after support')}</div>
        </div>
        <div className="row" style={{ gap: 8 }}>{onPlan && <button className="btn btn-sm" onClick={onPlan}><Icon name="calendar" size={13} />{tr('In Wochenplanung öffnen', 'Open in weekly planning')}</button>}<Segmented size="sm" value={mode} onChange={setMode} label={tr('Zeithorizont', 'Horizon')} options={[{ value: 'weeks', label: tr('Kommende Wochen', 'Coming weeks') }, { value: 'quarters', label: tr('Quartale', 'Quarters') }]} /></div>
      </div>
      {mode === 'quarters' && (
        <div className={`callout ${problems.length ? 'accent' : ''}`} style={{ margin: '12px 20px 0' }}>
          <Icon name={problems.length ? 'alert' : 'check'} />
          {problems.length
            ? tr(`Engpass in ${problems.map((q) => `${fmt.quarter(q)} (${fmt.h(-td.cells[q].free)} fehlen)`).join(', ')}. Projekte mit niedrigem Rang werden nicht voll besetzt.`, `Bottleneck in ${problems.map((q) => `${fmt.quarter(q)} (${fmt.h(-td.cells[q].free)} missing)`).join(', ')}. Lower-ranked projects are not fully staffed.`)
            : tr('In allen Quartalen reicht die Kapazität für alle Projekte.', 'In every quarter the capacity covers all projects.')}
        </div>
      )}
      {mode !== 'weeks' && <div style={{ padding: '12px 20px 0' }}><HeatLegend /></div>}
      <div style={{ overflowX: 'auto', padding: '10px 20px 16px' }} tabIndex={0} role="region" aria-label={tr('Kapazität des Teams, mit Pfeiltasten scrollbar', 'Team capacity, scrollable with arrow keys')}>
        {mode === 'weeks' ? <Prof id="team:weekboard"><WeekBoard team={team} mode="people" canEdit={canPlan(roles)} /></Prof> : (
          <>
          <div className="heat" style={{ '--cols': td.quarters.length, minWidth: 200 + td.quarters.length * 90 + 90 }}>
            <div className="heat-row"><span /> {td.quarters.map((q) => <span key={q} className="heat-head">{fmt.quarter(q)}</span>)}<span /></div>
            <div className="heat-row">
              <span className="heat-label">{name(team)}</span>
              {td.quarters.map((q) => {
                const c = td.cells[q];
                return <span key={q} className={`heat-cell q ${c.util > 1 ? 'over' : ''}`} style={{ background: heat(c.util), color: ink(c.util), height: 56 }} tabIndex={0} {...tip(quarterCard(td, q, name(team)))}>
                  <span style={{ display: 'grid', textAlign: 'center', lineHeight: 1.25 }}><b>{fmt.h(c.demand)}</b><span style={{ fontSize: 10.5, fontWeight: 500 }}>{tr('von', 'of')} {fmt.h(c.cap)}</span><span style={{ fontSize: 10.5, fontWeight: 500 }}>{c.cap > 0 ? fmt.pct(c.util) : `${NO_CAP_TEXT} · ${noCapacityReason(c.demand, getLang())}`}{c.cap > 0 && c.free < -0.5 ? ` · ${fmt.h(-c.free)} ${tr('fehlen', 'missing')}` : ''}</span></span>
                </span>;
              })}
              <span />
            </div>
          </div>
          </>
        )}
      </div>
      <div className="card-foot faint" style={{ padding: '0 20px 14px', fontSize: 12 }}>{mode === 'weeks'
        ? tr('Remaining Estimate der zugewiesenen Stories gleichmäßig auf die Arbeitstage bis zum Due Date verteilt; Verfügbarkeit nach Support-Anteil, Urlaub und Feiertagen. Gleiche Rechnung wie unter Kapazität.', 'Remaining estimate of assigned stories spread evenly over the workdays until the due date; availability after support share, leave and public holidays. Same calculation as under Capacity.')
        : tr('Bedarf = Remaining Estimate + offene T-Shirt Size der Projekte, Kapazität nach Support, Tagesgeschäft, interner Arbeit und Ausfallquote. Gleiche Zahlen wie in der Wasserlinie.', 'Demand = remaining estimate + open T-shirt size of the projects, capacity after support, daily business, internal work and absence rate. Same numbers as the waterline.')}</div>
    </section>
  );
}

// The team's work items in one project, as in Plans: the team's stories and sub-tasks, with the levels above in grey.
function TeamIssues({ refId, team, name, onOpenProject }) {
  const { computed } = useApp();
  const { model } = computed;
  const rows = useMemo(() => {
    const issues = model.byRoot.get(refId) || [];
    const mine = (i) => (i.role === 'estimate' || i.role === 'tiny') && (i.team?.id === team || (i.role === 'tiny' && !i.team && model.byId.get(i.parentId)?.team?.id === team));
    const keep = new Set();
    for (const i of issues) {
      if (!mine(i)) continue;
      keep.add(i.id);
      let cur = i.parentId ? model.byId.get(i.parentId) : null;
      while (cur) { keep.add(cur.id); cur = cur.parentId ? model.byId.get(cur.parentId) : null; }
    }
    const out = [];
    const walk = (list, depth) => {
      for (const i of list) {
        if (!keep.has(i.id)) continue;
        out.push({ i, depth, mine: mine(i) || (i.role === 'rough' && i.team?.id === team) });
        walk(model.children.get(i.id) || [], depth + 1);
      }
    };
    walk(issues.filter((i) => !i.parentId || !model.byId.has(i.parentId)), 0);
    return out;
  }, [model, refId, team]);
  const n = rows.filter((r) => r.mine).length;
  return (
    <motion.div className="tw-issues" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
      {rows.length === 0 ? <div className="faint" style={{ padding: '10px 16px' }}>{tr('Keine Vorgänge dieses Teams.', 'No work items of this team.')}</div> : (
        <table className="table tw-table" role="table" aria-label={tr('Vorgänge des Teams', 'Work items of the team')}>
          <thead role="rowgroup"><tr role="row"><th role="columnheader">{tr('Typ', 'Type')}</th><th role="columnheader">Key</th><th role="columnheader">Summary</th><th role="columnheader">Team</th><th role="columnheader">Assignee</th><th role="columnheader">Status</th><th role="columnheader" className="num">Time Spent / OE</th></tr></thead>
          <tbody role="rowgroup">
            {rows.slice(0, 120).map(({ i, depth, mine }) => (
              <tr key={i.id} role="row" className={mine ? 'mine' : 'ctx'} style={{ '--d': depth }}>
                <td role="cell" className="tw-type">{i.type?.name || ''}</td>
                <td role="cell" className="tw-key"><button type="button" className="tkey" onClick={() => openIssue(i.key)}>{i.key}</button></td>
                <td role="cell" className="tw-sum">{i.summary}{i.role === 'rough' && i.tshirt ? <span className="faint"> · T-Shirt {i.tshirt}{(i.quarters || []).length ? ` · ${i.quarters.map(fmt.quarter).join(', ')}` : ''}</span> : null}</td>
                <td role="cell" className="tw-team">{i.team ? (i.team.id === team ? <span className="chip chip-accent" style={{ height: 20 }}>{name(i.team.id)}</span> : name(i.team.id)) : '–'}</td>
                <td role="cell" className="tw-who">{i.assignee?.name || '–'}</td>
                <td role="cell" className="tw-st">{(i.role === 'estimate' || i.role === 'tiny') ? <span className={`chip ${model.isBlocked(i) ? 'chip-accent' : i.status.cat === 'done' ? 'chip-ok' : 'chip-outline'}`} style={{ height: 20 }}>{i.status.name}</span> : ''}</td>
                <td role="cell" className="num tw-oe">{i.role === 'estimate' && i.oe > 0 ? `${fmt.n(i.ts || 0)} / ${fmt.h(i.oe)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row wrap" style={{ justifyContent: 'space-between', padding: '8px 16px 12px', fontSize: 12 }}>
        <span className="faint">{tr(`${n} Vorgänge mit Team ${name(team)}. Grau: übergeordnete Ebenen ohne dieses Team.`, `${n} work items with team ${name(team)}. Grey: levels above without this team.`)}</span>
        <button type="button" className="btn btn-sm" onClick={onOpenProject}><Icon name="project" size={13} />{tr('Projektdetails öffnen', 'Open project details')}</button>
      </div>
    </motion.div>
  );
}

// ---------- hover: how a project / service space involves this team ----------
const STATUS_WORD = { ok: ['besetzbar', 'staffable'], partial: ['teilweise besetzbar', 'partly staffable'], no: ['nicht besetzbar', 'not staffable'] };
function projectCard(p, td, teamId, teamName, computed, person) {
  const stories = (computed.model.byRoot.get(p.ref) || []).filter((i) => i.role === 'estimate' && i.team?.id === teamId);
  const open = stories.filter((s) => (s.status?.cat ?? s.statusCat) !== 'done');
  const byPerson = new Map();
  for (const s of open) { const k = s.assignee?.id || '_none'; const x = byPerson.get(k) || byPerson.set(k, { n: 0, re: 0 }).get(k); x.n++; x.re += s.re || 0; }
  const qs = td.quarters.filter((q) => (p.q[q]?.demand || 0) > 0.05);
  const worst = qs.map((q) => p.q[q].status).find((s) => s !== 'ok');
  return infoCard({
    title: `#${p.rank} ${p.name}`,
    sub: p.isLead ? tr(`${teamName} ist Lead-Team`, `${teamName} is the lead team`) : tr(`${teamName} arbeitet mit`, `${teamName} contributes`),
    text: tr(
      `${teamName} hat hier ${p.stories} ${p.stories === 1 ? 'Story' : 'Stories'} (${open.length} offen): ${fmt.h(p.re, 1)} Rest, ${fmt.h(p.ts, 1)} erfasst von ${fmt.h(p.oe, 1)} geschätzt.${p.leadEpics.length ? ` Führt: ${p.leadEpics.slice(0, 3).join(', ')}.` : ''}`,
      `${teamName} has ${p.stories} ${p.stories === 1 ? 'story' : 'stories'} here (${open.length} open): ${fmt.h(p.re, 1)} remaining, ${fmt.h(p.ts, 1)} logged of ${fmt.h(p.oe, 1)} estimated.${p.leadEpics.length ? ` Leads: ${p.leadEpics.slice(0, 3).join(', ')}.` : ''}`),
    inputs: qs.length
      ? qs.map((q) => [`${fmt.quarter(q)} – ${tr('Bedarf des Teams', 'team demand')}`, `${fmt.h(p.q[q].demand)} · ${tr(...STATUS_WORD[p.q[q].status || 'ok'])}`])
      : [[tr('Bedarf in den nächsten Quartalen', 'Demand in the coming quarters'), tr('keiner terminiert', 'none scheduled')]],
    items: [...byPerson.entries()].sort((a, b) => b[1].re - a[1].re).map(([id, x]) => ({ text: id === '_none' ? tr('Ohne Bearbeiter', 'Unassigned') : person(id), sub: tr(`${x.n} offene ${x.n === 1 ? 'Story' : 'Stories'} · ${fmt.h(x.re, 1)} Rest`, `${x.n} open ${x.n === 1 ? 'story' : 'stories'} · ${fmt.h(x.re, 1)} remaining`), tone: id === '_none' ? 'warn' : 'ok' })),
    itemsTitle: tr('Wer aus dem Team daran arbeitet', 'Who in the team works on it'),
    hint: worst ? tr(`Achtung: in mindestens einem Quartal ${STATUS_WORD[worst][0]} – siehe Kapazität › Quartale. Klick öffnet die Projektdetails.`, `Note: ${STATUS_WORD[worst][1]} in at least one quarter – see Capacity › Quarters. Click opens the project details.`) : tr('Klick öffnet die Projektdetails.', 'Click opens the project details.'),
  });
}
function spaceCard(s, teamName) {
  return infoCard({
    title: s.name, sub: tr('Service-Space · Support hat Vorrang', 'Service space · support comes first'),
    text: tr(`${teamName} arbeitet hier Support-Tickets ab. Diese Zeit wird vor allen Projekten von der Team-Kapazität abgezogen.`, `${teamName} works support tickets here. This time is taken from the team's capacity before any project.`),
    inputs: [
      [tr('Support je Woche (dieses Team)', 'Support per week (this team)'), fmt.h(s.weekly, 1)],
      ...(s.avg != null ? [[tr('Ø gebucht je Woche', 'Avg. logged per week'), fmt.h(s.avg, 1)]] : []),
      ...(s.open != null ? [[tr('Offene Tickets im Space', 'Open tickets in the space'), String(s.open)]] : []),
      ...(s.spike ? [[tr('Trend', 'Trend'), tr('steigt deutlich', 'rising sharply')]] : []),
    ],
    hint: tr('Klick öffnet den Bereich Support.', 'Click opens the Support area.'),
  });
}

// Assignees who are not part of this team (boss feedback 2026-11-17): who, which of the team's stories, and the three ways
// out – take the person into the team, assign someone from the team, or move the story to the person's team.
// Atlassian Teams keep the members; the cockpit links there instead of changing them itself.
const openTeamPage = (id) => openUrl(`/jira/people/team/${encodeURIComponent(id)}`);

function Outsiders({ model, team, teamName, onEdit }) {
  const list = useMemo(() => teamOutsiders(model, team), [model, team]);
  const drift = useMemo(() => capacityDrift(model, team), [model, team]);
  const atl = membershipSource(model, team) === 'atlassian';
  const tName = (id) => model.teams.get(id)?.name || id;
  const n = list.reduce((a, x) => a + x.tasks.length, 0);
  const driftN = drift ? drift.missing.length + drift.extra.length : 0;
  return (
    <>
      {list.length > 0 && <OutsiderCallout {...{ list, n, tName, teamName, team, atl, onEdit }} />}
      {driftN > 0 && (
        <div className="callout team-drift" role="status" aria-label={tr('Kapazität weicht von Atlassian Teams ab', 'Capacity differs from Atlassian Teams')}>
          <Icon name="users" />
          <div className="grow">
            <b>{tr(`Die gepflegte Kapazität von ${teamName} weicht von Atlassian Teams ab.`, `The maintained capacity of ${teamName} differs from Atlassian Teams.`)}</b>{' '}
            <ul className="outsider-list">
              {drift.missing.map((p) => <li key={`m${p.id}`}><span className="outsider-name">{p.name || tr('Person', 'Person')}</span><span className="chip chip-info">{tr('Mitglied, aber 0 % Anteil hier', 'member, but 0 % share here')}</span></li>)}
              {drift.extra.map((p) => <li key={`e${p.id}`}><span className="outsider-name">{p.name || tr('Person', 'Person')}</span><span className="chip chip-warn">{tr(`${p.pct} % Anteil, aber kein Mitglied`, `${p.pct} % share, but not a member`)}</span></li>)}
            </ul>
            <span className="faint">{tr('Atlassian Teams bestimmt, wer im Team ist; die Kapazität bestimmt die Stunden. Passt die Anteile an oder ändert die Mitglieder in Atlassian Teams.', 'Atlassian Teams decides who is in the team; capacity decides the hours. Adjust the shares or change the members in Atlassian Teams.')}</span>
          </div>
          <span className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {onEdit && <button type="button" className="btn btn-sm" onClick={onEdit}><Icon name="edit" size={13} />{tr('Anteile anpassen', 'Adjust shares')}</button>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openTeamPage(team)}><Icon name="external" size={13} />{tr('Team in Atlassian', 'Team in Atlassian')}</button>
          </span>
        </div>
      )}
    </>
  );
}
// People in several teams (user 2026-11-17): what concerns THIS team – double booked weeks with this team's work, this
// team taking more than its share of someone (or counting hours another team uses), a better-ranked project losing
// time – with the multi-team check and the automatic fix (Lotse mission splitResolve, preview before anything changes).
function MultiTeam({ computed, team, teamName, canFix }) {
  const { model, support } = computed;
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    const ids = new Set([...capacityPeople(model).values()].filter((p) => inTeam(p, team)).map((p) => p.id));
    for (const i of model.ds.issues || []) if (i.team?.id === team && i.assignee?.id) ids.add(i.assignee.id);
    const r = splitConflicts(model, support, { only: ids });
    const out = [];
    for (const p of r.people) for (const c of p.conflicts) {
      if (c.severity === 'info') continue;
      if (c.kind === 'overbooked' && c.teams.includes(team)) out.push({ p, c, tone: 'bad' });
      else if (c.kind === 'shareDrift' && [...c.takers, ...c.givers].some((x) => x.teamId === team)) out.push({ p, c, tone: 'warn' });
      else if (c.kind === 'priority' && (c.first.teamId === team || c.second.some((x) => x.teamId === team))) out.push({ p, c, tone: 'warn' });
      else if (c.kind === 'sharesOff' && p.teams.some((t) => t.teamId === team)) out.push({ p, c, tone: 'warn' });
    }
    return { list: out, phantom: r.phantomByTeam[team] || 0, total: realConflicts(r).length };
  }, [model, support, team]);
  if (!rows.list.length) return null;
  const tn = (id) => model.teams.get(id)?.name || (id === '_none' ? tr('ohne Team', 'no team') : id);
  const nm = (p) => p.name || tr('Person', 'Person');
  const line = ({ p, c }) => {
    if (c.kind === 'overbooked') { const w = c.weeks.find((x) => x.from === c.peak.from); return tr(`${nm(p)} ist in ${c.weeks.length} ${c.weeks.length === 1 ? 'Woche' : 'Wochen'} doppelt verplant – ${fmt.week(c.peak.from)}: ${Object.entries(w.byTeam).map(([t, h]) => `${tn(t)} ${fmt.h(h, 1)}`).join(' + ')} bei ${fmt.h(c.peak.cap, 1)}`, `${nm(p)} is double booked in ${c.weeks.length} ${c.weeks.length === 1 ? 'week' : 'weeks'} – ${fmt.week(c.peak.from)}: ${Object.entries(w.byTeam).map(([t, h]) => `${tn(t)} ${fmt.h(h, 1)}`).join(' + ')} with ${fmt.h(c.peak.cap, 1)}`); }
    if (c.kind === 'shareDrift') { const g = c.givers.find((x) => x.teamId === team); const t = c.takers.find((x) => x.teamId === team); return g ? tr(`${teamName} rechnet mit ${fmt.h(g.phantom)} von ${nm(p)}, die ${c.takers.map((x) => tn(x.teamId)).join(', ')} schon nutzt`, `${teamName} counts ${fmt.h(g.phantom)} of ${nm(p)} that ${c.takers.map((x) => tn(x.teamId)).join(', ')} already uses`) : tr(`${teamName} braucht von ${nm(p)} ${fmt.h(t.actual)} statt ${fmt.h(t.expected)} (${t.pct} % Anteil)`, `${teamName} needs ${fmt.h(t.actual)} of ${nm(p)} instead of ${fmt.h(t.expected)} (${t.pct} % share)`); }
    if (c.kind === 'priority') return tr(`Bei ${nm(p)} nimmt Rang ${c.second[0].rank} (${tn(c.second[0].teamId)}) Zeit, die Rang ${c.first.rank} (${tn(c.first.teamId)}) braucht`, `For ${nm(p)}, rank ${c.second[0].rank} (${tn(c.second[0].teamId)}) takes time that rank ${c.first.rank} (${tn(c.first.teamId)}) needs`);
    return tr(`${nm(p)}: Anteile ergeben ${c.total} % statt 100 %`, `${nm(p)}: shares add up to ${c.total} % instead of 100 %`);
  };
  const SHOW = 4;
  const people = new Set(rows.list.map((x) => x.p.id)).size;
  return (
    <div className={`callout ${rows.list.some((x) => x.tone === 'bad') ? 'bad' : 'warn'} team-multi`} role="status" data-multiteam aria-label={tr('Mehrteam-Konflikte', 'Multi-team conflicts')}>
      <Icon name="users" />
      <div className="grow">
        <b>{tr(`Mehrteam: ${rows.list.length} ${rows.list.length === 1 ? 'Konflikt' : 'Konflikte'} bei ${people} ${people === 1 ? 'Person, die auch für andere Teams arbeitet' : 'Personen, die auch für andere Teams arbeiten'}.`, `Multi-team: ${rows.list.length} ${rows.list.length === 1 ? 'conflict' : 'conflicts'} for ${people} ${people === 1 ? 'person who also works' : 'people who also work'} for other teams.`)}</b>{' '}
        {rows.phantom > 0.5 && tr(`${fmt.h(rows.phantom)} der freien Kapazität von ${teamName} sind nur scheinbar frei.`, `${fmt.h(rows.phantom)} of ${teamName}'s free capacity is only seemingly free.`)}
        <ul className="outsider-list">{(all ? rows.list : rows.list.slice(0, SHOW)).map((x, k) => <li key={k}><span className={`chip chip-${x.tone}`}>{{ overbooked: tr('doppelt verplant', 'double booked'), shareDrift: tr('Anteil passt nicht', 'share off'), priority: tr('Rangfolge', 'ranking'), sharesOff: tr('Anteile', 'shares') }[x.c.kind]}</span><span>{line(x)}</span></li>)}</ul>
        {rows.list.length > SHOW && <button type="button" className="linkbtn outsider-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? tr('Weniger anzeigen', 'Show less') : tr(`Alle ${rows.list.length} anzeigen`, `Show all ${rows.list.length}`)}</button>}
        <span className="faint">{tr('Lotse plant über alle Teams der Person nach Projektrang neu, übergibt, was nicht passt, und setzt die Anteile auf die echte Arbeit – mit Vorschau, nichts ändert sich vorher.', 'Lotse re-plans across all the person\'s teams by project rank, hands over what does not fit and sets the shares to the real work – with a preview, nothing changes before.')}</span>
      </div>
      <span className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <LotseChip skill="splitCheck" params={{ team }} label={tr('Lotse: Mehrteam-Check', 'Lotse: multi-team check')} />
        {canFix && <button type="button" className="btn btn-sm btn-primary" data-multiteam-fix onClick={() => openLotse({ text: tr(`Löse die Mehrteam-Konflikte für Team ${teamName} automatisch`, `Resolve the multi-team conflicts for team ${teamName} automatically`) })}><Icon name="zap" size={13} />{tr('Automatisch lösen', 'Resolve automatically')}</button>}
      </span>
    </div>
  );
}
function OutsiderCallout({ list, n, tName, teamName, team, atl, onEdit }) {
  const [all, setAll] = useState(false);
  const SHOW = 5;
  return (
    <div className="callout warn team-outsiders" role="status" aria-label={tr('Bearbeiter außerhalb des Teams', 'Assignees outside the team')}>
      <Icon name="alert" />
      <div className="grow">
        <b>{tr(`${list.length} ${list.length === 1 ? 'Person bearbeitet' : 'Personen bearbeiten'} ${n} ${n === 1 ? 'Story' : 'Stories'} von ${teamName}, ohne zum Team zu gehören.`, `${list.length} ${list.length === 1 ? 'person works' : 'people work'} on ${n} ${n === 1 ? 'story' : 'stories'} of ${teamName} without being part of the team.`)}</b>{' '}
        {tr('Ihre Stunden zählen als Bedarf dieses Teams, belasten aber Zeit, die anderswo eingeplant ist.', "Their hours count as this team's demand but use time that is planned elsewhere.")}
        <ul className="outsider-list">
          {(all ? list : list.slice(0, SHOW)).map((p) => (
            <li key={p.id}>
              <span className="outsider-name">{p.name || tr('Person', 'Person')}</span>
              <span className="chip chip-warn">{p.status === 'unmaintained' ? tr('keinem Team zugeordnet', 'in no team') : tr('nicht im Team', 'not in team')}</span>
              {p.teams.length > 0 && <span className="faint">{tr('gehört zu', 'belongs to')} {p.teams.map((t) => `${tName(t.teamId)}${t.pct > 0 && t.pct < 100 ? ` (${t.pct} %)` : ''}`).join(', ')}</span>}
              <span className="outsider-keys">{p.tasks.slice(0, 6).map((t) => <button key={t.id} type="button" className="linkbtn mono" title={`${t.key} ${t.summary}`} onClick={() => openIssue(t.key)}>{t.key}</button>)}{p.tasks.length > 6 ? <span className="faint"> {tr(`+ ${p.tasks.length - 6} weitere`, `+ ${p.tasks.length - 6} more`)}</span> : null}</span>
            </li>
          ))}
        </ul>
        {list.length > SHOW && <button type="button" className="linkbtn outsider-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>{all ? tr("Weniger anzeigen", "Show less") : tr(`Alle ${list.length} Personen anzeigen`, `Show all ${list.length} people`)}</button>}
        <span className="faint">{atl
          ? tr('Lösen: die Person in Atlassian Teams ins Team aufnehmen, jemanden aus dem Team zuweisen oder die Story dem Team der Person geben.', "Fix: add the person to the team in Atlassian Teams, assign someone from the team, or give the story to the person's team.")
          : tr('Lösen: die Person ins Team holen (Kapazitäten pflegen), jemanden aus dem Team zuweisen oder die Story dem Team der Person geben.', "Fix: take the person into the team (maintain capacities), assign someone from the team, or give the story to the person's team.")}</span>
        {atl && <span className="faint team-src"> {tr('Mitglieder laut Atlassian Teams.', 'Members according to Atlassian Teams.')}</span>}
      </div>
      {atl
        ? <button type="button" className="btn btn-sm" onClick={() => openTeamPage(team)}><Icon name="external" size={13} />{tr('Team in Atlassian öffnen', 'Open team in Atlassian')}</button>
        : onEdit && <button type="button" className="btn btn-sm" onClick={onEdit}><Icon name="users" size={13} />{tr('Ins Team holen', 'Add to team')}</button>}
    </div>
  );
}
