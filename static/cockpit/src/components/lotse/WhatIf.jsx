// "Was wäre wenn …" – one change (a project's rank, more time for a project, more weekly hours for a team); the engine
// re-runs on a copy of the data and returns a Story with a before/after compare. Nothing is written; the story's own
// actions (e.g. "Rang übernehmen") go through the usual preview + undo.
// Params (shared/lotse/skills/whatIf.js): { change: { kind: 'rank', ref, toRank } | { kind: 'due', ref, weeks }
//   | { kind: 'hours', personId, delta } | { kind: 'teamHours', teamId, weekly } }. A story action that carries a change is computed at once.
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { enter } from '../../lib/motion.js';
import { useApp } from '../../state.jsx';
import { tr } from '../../lib/i18n.js';
import { Icon } from '../../lib/icons.jsx';
import { Segmented } from '../ui.jsx';
import { run, useLotseCtx, validStory } from './engine.js';

const KINDS = () => [
  { value: 'rank', label: tr('Rang', 'Rank'), icon: 'ranking' },
  { value: 'due', label: tr('Mehr Zeit', 'More time'), icon: 'calendar' },
  { value: 'hours', label: tr('Person', 'Person'), icon: 'user' },
  { value: 'teamHours', label: 'Team', icon: 'users' },
];
const num = (v, lo, hi, d) => { const n = Math.round(+String(v).replace(',', '.')); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

// initial: the action payload ({ change: {...} }) or a subject ({ ref }) to start from.
export default function WhatIf({ initial = {}, onResult, onClose }) {
  const { ds, computed } = useApp();
  const ctx = useLotseCtx();
  const c0 = initial.change && typeof initial.change === 'object' ? initial.change : {};
  const projects = useMemo(() => [...(ds?.portfolio || [])].sort((a, b) => a.rank - b.rank), [ds]);
  const teams = useMemo(() => [...(computed?.model?.teams?.values() || [])].filter((t) => t.id !== '_none').map((t) => ({ id: t.id, name: t.name })), [computed]);
  const [kind, setKind] = useState(KINDS().some((k) => k.value === c0.kind) ? c0.kind : 'rank');
  const [ref, setRef] = useState(c0.ref || initial.ref || projects[0]?.ref || '');
  const cur = projects.find((p) => p.ref === ref);
  const [rank, setRank] = useState(String(c0.toRank ?? Math.max(1, (cur?.rank || 2) - 1)));
  const [weeks, setWeeks] = useState(String(c0.weeks ?? 2));
  const [teamId, setTeamId] = useState(c0.teamId || initial.team || teams[0]?.id || '');
  const [weekly, setWeekly] = useState(String(c0.weekly ?? 40));
  const people = useMemo(() => Object.entries(ds?.people || {}).map(([id, p]) => ({ id, name: p?.name || id })).sort((a, b) => a.name.localeCompare(b.name)), [ds]);
  const [personId, setPersonId] = useState(c0.personId || people[0]?.id || '');
  const [delta, setDelta] = useState(String(c0.delta ?? -8));
  const [err, setErr] = useState(null);

  const change = kind === 'rank' ? { kind, ref, toRank: num(rank, 1, projects.length || 1, 1) }
    : kind === 'due' ? { kind, ref, weeks: num(weeks, -26, 52, 2) }
      : kind === 'hours' ? { kind, personId, delta: num(delta, -60, 60, -8) }
        : { kind, teamId, weekly: num(weekly, -400, 400, 40) };
  const ready = kind === 'teamHours' ? !!teamId : kind === 'hours' ? !!personId : !!ref;
  const go = (e) => {
    e?.preventDefault();
    if (!ready || !ctx) return;
    const s = run('whatIf', { change }, ctx);
    if (!s || !validStory(s)) { setErr(tr('Für dieses Szenario konnte Lotse nichts rechnen – die Daten reichen dafür nicht.', 'Lotse could not compute this scenario – the data is not enough for it.')); return; }
    setErr(null); onResult?.(s, change);
  };
  // a scenario handed over by a story is computed at once – it changes nothing, so there is nothing to confirm
  useEffect(() => { if (c0.kind) go(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.form className="lw" onSubmit={go} {...enter(0, { y: 6 })} aria-label={tr('Was wäre wenn', 'What if')}>
      <div className="lw-head">
        <span className="lw-title"><Icon name="zap" size={14} />{tr('Was wäre wenn …', 'What if …')}</span>
        <span className="faint lw-note">{tr('nichts wird geändert', 'nothing is changed')}</span>
        {onClose && <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label={tr('Szenario schließen', 'Close scenario')}><Icon name="x" size={13} /></button>}
      </div>
      <Segmented size="sm" value={kind} onChange={setKind} options={KINDS()} label={tr('Was ändern?', 'What to change?')} />
      <div className="lw-row">
        {(kind === 'rank' || kind === 'due') && (
          <label className="lw-field grow"><span>{tr('Projekt', 'Project')}</span>
            <select className="input input-sm" value={ref} onChange={(e) => setRef(e.target.value)}>
              {projects.map((p) => <option key={p.ref} value={p.ref}>{p.rank} · {p.name}</option>)}
            </select>
          </label>
        )}
        {kind === 'rank' && <label className="lw-field"><span>{tr('Neuer Rang', 'New rank')}</span><input className="input input-sm num" type="number" min={1} max={projects.length} value={rank} onChange={(e) => setRank(e.target.value)} /></label>}
        {kind === 'due' && <label className="lw-field"><span>{tr('Wochen mehr (−: früher)', 'Weeks more (−: earlier)')}</span><input className="input input-sm num" type="number" min={-26} max={52} value={weeks} onChange={(e) => setWeeks(e.target.value)} /></label>}
        {kind === 'hours' && <>
          <label className="lw-field grow"><span>{tr('Person', 'Person')}</span>
            <select className="input input-sm" value={personId} onChange={(e) => setPersonId(e.target.value)}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </label>
          <label className="lw-field"><span>{tr('Stunden je Woche (+/−)', 'Hours per week (+/−)')}</span><input className="input input-sm num" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} /></label>
        </>}
        {kind === 'teamHours' && <>
          <label className="lw-field grow"><span>Team</span>
            <select className="input input-sm" value={teamId} onChange={(e) => setTeamId(e.target.value)}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </label>
          <label className="lw-field"><span>{tr('Stunden je Woche mehr (−: weniger)', 'Hours per week more (−: fewer)')}</span><input className="input input-sm num" inputMode="numeric" value={weekly} onChange={(e) => setWeekly(e.target.value)} /></label>
        </>}
        <button type="submit" className="btn btn-sm btn-dark lw-go" disabled={!ready}><Icon name="arrowRight" size={13} />{tr('Durchrechnen', 'Compute')}</button>
      </div>
      {err && <p className="lw-err" role="status"><Icon name="info" size={13} />{err}</p>}
    </motion.form>
  );
}
