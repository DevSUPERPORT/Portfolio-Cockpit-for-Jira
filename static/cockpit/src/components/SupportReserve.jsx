import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { enter, tween, delayOf } from '../lib/motion.js';
import { useApp, errText } from '../state.jsx';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call } from '../lib/api.js';
import { Empty, useTip, infoCard } from './ui.jsx';
import { reserveCheck } from '@shared/dispatch.js';
import './Support.css';

// "Support je Team" (8 weeks with trend) and "Reicht die Reserve?" (reserved h/week against the last 4 weeks, with a
// one-click recommendation). A manual reserve lives in capacity.teams[teamId].supportOverride and the engine applies
// it everywhere (portfolio, waterline, weekly planning, report) – patched locally so every view updates at once.
const VERDICT = {
  low: { chip: 'chip-bad', label: () => tr('Reserve zu knapp', 'Reserve too low') },
  high: { chip: 'chip-warn', label: () => tr('Reserve zu hoch', 'Reserve too high') },
  ok: { chip: 'chip-ok', label: () => tr('passt', 'fits') },
};

export function SupportTeams({ s, a }) {
  const tip = useTip();
  const { computed } = useApp();
  const { model } = computed;
  const tname = (id) => model.teams.get(id)?.name || (id === '_none' ? tr('Ohne Team', 'No team') : id);
  const openBy = useMemo(() => { const m = new Map(); for (const r of a?.queue || []) m.set(r.team?.id || '_none', (m.get(r.team?.id || '_none') || 0) + 1); return m; }, [a]);
  const teams = [...(s?.teams || [])].filter((t) => t.weekly > 0 || t.trend.some((h) => h > 0)).sort((x, y) => y.weekly - x.weekly);
  const total = teams.reduce((acc, t) => acc + t.weekly, 0) || 1;
  if (!teams.length) return null;
  const W = s.averagingWeeks || 4;
  return (
    <section className="card">
      <div className="sp-head">
        <h2 className="card-title"><Icon name="users" />{tr('Support je Team', 'Support per team')}</h2>
        <span className="sp-info" tabIndex={0} {...tip(infoCard({ title: tr('Support je Team', 'Support per team'), text: tr(`Gebuchte Zeit auf Support-Tickets der letzten 8 Wochen. Dunkle Balken = Basis der Reservierung (Ø ${W} Wochen), orange = deutlich gestiegen.`, `Time logged on support tickets over the last 8 weeks. Dark bars = basis of the reservation (Ø ${W} weeks), orange = clearly risen.`) }))}><Icon name="info" size={14} /></span>
      </div>
      <div className="sp-tiles">
        {teams.map((t, i) => {
          const max = Math.max(1, ...t.trend);
          const up = t.spike && t.avg > 0;
          return (
            <motion.div key={t.teamId} className={`sp-tile ${up ? 'hot' : ''}`} {...enter(i, { y: 8, d: 'gentle' })}>
              <div className="sp-tile-top"><b style={{ fontWeight: 560 }}>{tname(t.teamId)}</b><span className="sp-sub num">{fmt.pct(t.weekly / total)}</span></div>
              <div className="sp-tile-value">{fmt.h(t.weekly, 1)}<span className="sp-sub" style={{ marginLeft: 4, fontSize: 12 }}>{tr('/ Woche', '/ week')}</span></div>
              <div className="sp-bars" aria-hidden="true">
                {t.trend.map((h, k) => (
                  <motion.span key={k} className={`sp-bar ${up && k >= 6 ? 'hot' : k >= 8 - W ? 'base' : ''}`} title={`${fmt.week(isoWeek(k))}: ${fmt.h(h, 1)}`}
                    initial={{ scaleY: 0 }} animate={{ scaleY: Math.max(0.06, h / max) }} transition={tween('gentle', { delay: delayOf(k + i) })} />
                ))}
              </div>
              <span className={`sp-trend ${up ? 'up' : ''}`}>
                {up ? <><Icon name="zap" size={12} />{tr(`letzte 2 Wochen ${fmt.signedPct(t.recentAvg / t.avg - 1)} über Ø`, `last 2 weeks ${fmt.signedPct(t.recentAvg / t.avg - 1)} above Ø`)}</>
                  : t.override != null ? <><Icon name="lock" size={12} />{tr('manuell festgelegt', 'set manually')}</> : tr(`Ø ${W} Wochen`, `Ø ${W} weeks`)}
              </span>
              <span className="sp-sub">{tr(`${openBy.get(t.teamId) || 0} offene Tickets`, `${openBy.get(t.teamId) || 0} open tickets`)}</span>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
// Monday of the k-th of the last 8 full weeks (as supportMetrics' trend).
function isoWeek(k) {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow - (8 - k) * 7);
  return d.toISOString().slice(0, 10);
}

export default function SupportReserve({ s, canEdit }) {
  const tip = useTip();
  const { computed, setDs, done, toast } = useApp();
  const { model } = computed;
  const [busy, setBusy] = useState(null);
  const rows = useMemo(() => reserveCheck(s).sort((x, y) => String(model.teams.get(x.teamId)?.name || x.teamId).localeCompare(String(model.teams.get(y.teamId)?.name || y.teamId))), [s, model]);
  const tname = (id) => model.teams.get(id)?.name || id;
  const W = s?.averagingWeeks || 4;
  const patch = (teamId, hours) => setDs((d) => {
    const teams = { ...(d.capacity?.teams || {}) };
    teams[teamId] = { ...(teams[teamId] || {}), supportOverride: hours };
    return { ...d, capacity: { ...d.capacity, teams } };
  });
  async function setReserve(r, hours) {
    setBusy(r.teamId);
    try {
      const res = await call('support.reserve', { teamId: r.teamId, hours, teamName: tname(r.teamId) });
      patch(r.teamId, res.hours);
      {
        const prev = res.previous ?? null;
        done(hours == null
          ? tr(`Reserve ${tname(r.teamId)} wieder automatisch (Ø ${W} Wochen)`, `Reserve ${tname(r.teamId)} automatic again (Ø ${W} weeks)`)
          : tr(`Support-Reserve ${tname(r.teamId)} auf ${fmt.h(hours, 1)}/Woche gesetzt – wirkt sofort auf Portfolio und Wochenplanung`, `Support reserve ${tname(r.teamId)} set to ${fmt.h(hours, 1)}/week – takes effect in portfolio and weekly planning at once`),
        'shield', tr(`Support-Reserve ${tname(r.teamId)}`, `support reserve ${tname(r.teamId)}`), async () => {
          const back = await call('support.reserve', { teamId: r.teamId, hours: prev, teamName: tname(r.teamId) });
          patch(r.teamId, back.hours);
        }, [`reserve:${r.teamId}`]);
      }
    } catch (e) { toast({ text: errText(e), error: true }); } finally { setBusy(null); }
  }
  if (!rows.length) return <section className="card"><Empty icon="shield" title={tr('Noch keine Support-Stunden', 'No support hours yet')}>{tr('Sobald im Support Zeit gebucht wird, erscheint hier die Reserve je Team.', 'As soon as time is logged on support work, the reserve per team appears here.')}</Empty></section>;
  return (
    <section className="card" style={{ overflow: 'hidden' }}>
      <div className="sp-head">
        <h2 className="card-title"><Icon name="shield" />{tr('Reicht die Reserve?', 'Is the reserve enough?')}</h2>
        <span className="sp-info" tabIndex={0} {...tip(infoCard({ title: tr('Reicht die Reserve?', 'Is the reserve enough?'), text: tr(`Reserviert = Support-Stunden je Woche, die vor den Projekten von der Team-Kapazität abgehen (automatisch Ø ${W} Wochen oder manuell). Zuletzt = Ø gebuchte Support-Zeit der letzten 4 Wochen. Innerhalb ±10 % passt es.`, `Reserved = support hours per week taken from team capacity before projects (automatic Ø ${W} weeks or manual). Recent = Ø support time logged in the last 4 weeks. Within ±10 % it fits.`), hint: tr('„Übernehmen“ setzt die Reserve manuell – wirkt sofort auf Portfolio, Wochenplanung und Plan vs. Ist. „Automatisch“ nimmt es zurück.', '"Apply" sets the reserve manually – takes effect in portfolio, weekly planning and plan vs. actual at once. "Automatic" reverts it.') }))}><Icon name="info" size={14} /></span>
        {!canEdit && <span className="sp-head-end sp-note"><Icon name="lock" size={12} />{tr('Ändern dürfen Kapazitäts-Verantwortliche', 'Capacity editors can change it')}</span>}
      </div>
      <div className="sp-scroll" tabIndex={0}>
        <div className="sp-grid-res sp-thead">
          <span>Team</span><span className="sp-r">{tr('Reserviert/Woche', 'Reserved/week')}</span><span className="sp-r">{tr('Zuletzt Ø', 'Recent Ø')}</span><span className="sp-r">{tr('Differenz', 'Difference')}</span><span>{tr('Bewertung', 'Verdict')}</span><span>{tr('Empfehlung', 'Recommendation')}</span><span />
        </div>
        {rows.map((r, i) => {
          const v = VERDICT[r.verdict];
          return (
            <motion.div key={r.teamId} className="sp-grid-res sp-row" {...enter(i, { y: 6, d: 'gentle' })}>
              <b style={{ fontWeight: 560 }}>{tname(r.teamId)}</b>
              <span className="sp-r" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <motion.span key={r.reserved} {...enter(0, { y: -4 })} style={{ fontWeight: 560 }}>{fmt.h(r.reserved, 1)}</motion.span>
                <span className="sp-sub">{r.manual ? tr(`manuell festgelegt · auto ${fmt.h(r.auto, 1)}`, `set manually · auto ${fmt.h(r.auto, 1)}`) : tr(`Ø ${W} Wochen${r.spike ? ', gestiegen' : ''}`, `Ø ${W} weeks${r.spike ? ', risen' : ''}`)}</span>
              </span>
              <span className="sp-r" style={{ fontWeight: 560 }}>{fmt.h(r.recent, 1)}</span>
              <span className="sp-r" style={{ fontWeight: 560, color: r.verdict === 'low' ? 'var(--bad)' : 'inherit' }}>{fmt.signedH(Math.round(r.diff * 10) / 10)}</span>
              <span><span className={`chip ${v.chip}`}>{v.label()}</span></span>
              <span className="muted" style={{ fontSize: 13 }}>{r.verdict === 'low'
                ? tr(`Auf ${fmt.h(r.recommend)}/Woche anheben – sonst fehlen den Projekten real ${fmt.h(r.diff, 1)} je Woche.`, `Raise to ${fmt.h(r.recommend)}/week – otherwise projects really lack ${fmt.h(r.diff, 1)} per week.`)
                : r.verdict === 'high' ? tr(`Auf ${fmt.h(r.recommend)}/Woche senken – gibt ${fmt.h(-r.diff, 1)} je Woche für Projekte frei.`, `Lower to ${fmt.h(r.recommend)}/week – frees ${fmt.h(-r.diff, 1)} per week for projects.`)
                  : tr('Die Reserve deckt den aktuellen Support.', 'The reserve covers current support.')}</span>
              <span className="sp-actions">
                {canEdit && r.canApply && <button type="button" className="btn btn-sm" disabled={busy === r.teamId} onClick={() => setReserve(r, r.recommend)}>{tr(`Auf ${fmt.h(r.recommend)} übernehmen`, `Apply ${fmt.h(r.recommend)}`)}</button>}
                {canEdit && r.manual && <button type="button" className="btn btn-sm btn-ghost" disabled={busy === r.teamId} onClick={() => setReserve(r, null)}>{tr('Automatisch', 'Automatic')}</button>}
              </span>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
