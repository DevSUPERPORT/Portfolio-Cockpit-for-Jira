// Admin › "Plan-Snapshot": when the weekly plan for Plan vs. Ist is frozen and how long it is kept.
// Props: value (cfg.snapshot, may be undefined → defaults), onChange(next) with the complete { day, time, keepMonths }.
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { tween } from '../lib/motion.js';
import { validSnapshot, snapshotDue, SNAPSHOT_DAYS, SNAPSHOT_TIMES, SNAPSHOT_KEEP } from '@shared/planActual.js';
import { ymdIdx } from '@shared/dates.js';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { Segmented } from './ui.jsx';

const DAY_SHORT = { mon: ['Mo', 'Mon'], tue: ['Di', 'Tue'], wed: ['Mi', 'Wed'], thu: ['Do', 'Thu'], fri: ['Fr', 'Fri'] };

export default function SnapshotSettings({ value, onChange }) {
  const v = validSnapshot(value);
  const set = (k, x) => onChange({ ...v, [k]: x });
  // the next slot, in this browser's clock (the job itself uses the Jira site's time zone)
  const next = useMemo(() => {
    const d = new Date();
    return snapshotDue(v, { day: ymdIdx(d.getFullYear(), d.getMonth() + 1, d.getDate()), min: d.getHours() * 60 + d.getMinutes() });
  }, [v.day, v.time]); // eslint-disable-line react-hooks/exhaustive-deps
  const times = SNAPSHOT_TIMES.includes(v.time) ? SNAPSHOT_TIMES : [...SNAPSHOT_TIMES, v.time].sort();
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="muted" style={{ fontSize: 13 }}>
        {tr('Einmal pro Woche speichert die App den Stand der Wochenplanung: Original Estimate der Tasks je Person und Woche, Support-Reserve und bekannte Abwesenheiten. „Plan vs. Ist“ vergleicht diesen Stand mit den Worklogs – spätere Änderungen an Start und Due date ändern den Plan vergangener Wochen nicht.',
          'Once a week the app saves the state of the weekly plan: the tasks\' Original Estimate per person and week, the support reserve and known absences. "Plan vs. actual" compares it with the worklogs – later changes to start and due dates do not change the plan of past weeks.')}
      </div>
      <div className="row wrap" style={{ gap: 20, alignItems: 'flex-end' }}>
        <div>
          <span className="label">{tr('Tag', 'Day')}</span>
          <Segmented size="sm" label={tr('Tag', 'Day')} value={v.day} onChange={(x) => set('day', x)}
            options={SNAPSHOT_DAYS.map((d) => ({ value: d, label: tr(DAY_SHORT[d][0], DAY_SHORT[d][1]) }))} />
        </div>
        <div>
          <span className="label">{tr('Uhrzeit', 'Time')}</span>
          <Segmented size="sm" label={tr('Uhrzeit', 'Time')} value={v.time} onChange={(x) => set('time', x)} options={times.map((t) => ({ value: t, label: t }))} />
        </div>
        <div>
          <span className="label">{tr('Aufbewahren', 'Keep for')}</span>
          <Segmented size="sm" label={tr('Aufbewahren', 'Keep for')} value={v.keepMonths} onChange={(x) => set('keepMonths', x)}
            options={SNAPSHOT_KEEP.map((m) => ({ value: m, label: tr(`${m} Monate`, `${m} months`) }))} />
        </div>
      </div>
      <motion.div key={`${v.day}${v.time}`} className="callout" initial={{ opacity: 0.4, y: 2 }} animate={{ opacity: 1, y: 0 }} transition={tween('base')}>
        <Icon name="calendar" />
        <span>
          <b style={{ fontWeight: 560 }}>{tr('Nächster Snapshot', 'Next snapshot')}: </b>
          {fmt.date(next.nextIso, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} {tr('um', 'at')} {v.time}
          <span className="muted"> · {tr('Zeitzone der Jira-Site', 'Jira site time zone')} · {tr(`ältere Wochen werden nach ${v.keepMonths} Monaten gelöscht`, `older weeks are deleted after ${v.keepMonths} months`)}</span>
        </span>
      </motion.div>
    </div>
  );
}
