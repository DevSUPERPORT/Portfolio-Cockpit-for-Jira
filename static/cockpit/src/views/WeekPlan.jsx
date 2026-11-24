// Wochenplanung (UC-05): for the teams' weekly – who works when on which tasks, and does it fit the capacity?
// Team pills ("All teams" + each team), rows by people or by projects, and the board (components/WeekBoard.jsx).
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { teamIds } from '@shared/team.js';
import { canPlan } from '@shared/weekPlan.js';
import { useApp } from '../state.jsx';
import { tr } from '../lib/i18n.js';
import { Segmented, Empty, spring } from '../components/ui.jsx';
import WeekBoard, { usePendingMoves } from '../components/WeekBoard.jsx';

const ALL = '__all';

export default function WeekPlan() {
  const { computed, roles, teamSel, setTeamSel } = useApp();
  const ids = useMemo(() => (computed ? teamIds(computed) : []), [computed]);
  const [pick, setPick] = useState(null);
  const [mode, setMode] = useState('people');
  const { count } = usePendingMoves();
  if (!computed) return null;
  const name = (id) => computed.model.teams.get(id)?.name || id;
  // the team chosen here, else the one chosen in Teams, else the first
  const team = pick === ALL ? ALL : ids.includes(pick) ? pick : ids.includes(teamSel) ? teamSel : ids[0] || ALL;
  const choose = (id) => { setPick(id); if (id !== ALL) setTeamSel(id); };
  const all = team === ALL;
  return (
    <div className="page">
      <div className="row wrap" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <h1 className="h1">{tr('Wochenplanung', 'Weekly planning')}</h1>
          <div className="muted" style={{ marginTop: 4, fontSize: 13.5 }}>
            {tr('Wer arbeitet wann an welchen Tasks – und passt das in die Kapazität?', 'Who works on which tasks when – and does it fit the capacity?')}
            {count > 0 && <span className="tab-badge hot" style={{ marginLeft: 8 }}>{count}</span>}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="faint" style={{ fontSize: 12.5 }} aria-hidden="true">{tr('Zeilen', 'Rows')}</span>
          <Segmented value={all ? 'people' : mode} onChange={setMode} label={tr('Zeilen', 'Rows')}
            options={[
              { value: 'people', label: tr('Personen', 'People'), icon: 'users', disabled: all, title: all ? tr('Bei „Alle Teams“ eine Zeile je Team', 'With "All teams" one row per team') : undefined },
              { value: 'projects', label: tr('Projekte', 'Projects'), icon: 'project', disabled: all, title: all ? tr('Bei „Alle Teams“ eine Zeile je Team', 'With "All teams" one row per team') : undefined },
            ]} />
        </div>
      </div>

      {!ids.length ? (
        <div className="card"><Empty icon="users" title={tr('Noch keine Teams', 'No teams yet')}>{tr('Teams erscheinen, sobald Stories ein Team haben oder Kapazitäten gepflegt sind.', 'Teams appear once stories have a team or capacities are maintained.')}</Empty></div>
      ) : (
        <>
          <div className="pills" role="group" aria-label={tr('Team wählen', 'Choose team')}>
            {[ALL, ...ids].map((id) => (
              <button key={id} type="button" className="pill" aria-pressed={id === team} onClick={() => choose(id)}>
                {id === team && <motion.span layoutId="wp-pill-bg" className="pill-bg" transition={spring} />}
                <span>{id === ALL ? tr('Alle Teams', 'All teams') : name(id)}</span>
              </button>
            ))}
          </div>
          {/* fades in on every switch (no exit animation – it can stall inside the Jira frame) */}
          <motion.div key={`${team}:${all ? '' : mode}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}>
            <WeekBoard team={all ? null : team} mode={all ? 'people' : mode} canEdit={canPlan(roles)} onOpenTeam={(id) => { choose(id); setMode('people'); }} />
          </motion.div>
        </>
      )}
    </div>
  );
}
