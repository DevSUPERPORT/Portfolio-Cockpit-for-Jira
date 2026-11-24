import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { waterlineSentence, projectShare, syncMaintained, capacityPeople } from '@shared/engine.js';
import { atlIndex, evenSplit } from '@shared/atlTeams.js';
import { allocationOf, allocationSum, allocationOff, shareOf, inTeam, setShare, joinTeam, moveMainTeam, MAX_TEAMS } from '@shared/allocation.js';
import { resolveLocation } from '@shared/locations.js';
import { CALENDAR_CHOICES } from '@shared/holidays.js';
import { utilTone, UTIL_WARN, noCapacityReason, NO_CAP_TEXT } from '@shared/kpis.js';
import { personWeekCard, teamWeekCard, waterCellCard, waterSteps, waterShown } from '../lib/cards.js';
import { useApp, errText } from '../state.jsx';
import { tr, fmt, getLang } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call, openUrl } from '../lib/api.js';
import { exportCapacity } from '../lib/books.js';
import { Segmented, Empty, Avatar, useTip, stagger, spring, Skeleton, infoCard } from '../components/ui.jsx';

// Heat colour = traffic light: green while there is room (≤ 85 %), amber when nearly full (≤ 100 %), red only when
// overbooked (> 100 %, also striped). Within a band the shade deepens with the load. The intensities are capped so the
// normal text colour keeps ≥ 4.8 : 1 contrast in light and dark mode (WCAG AA).
export function heat(util) {
  if (util === Infinity) return 'color-mix(in srgb, var(--bad) 56%, var(--sunken))';
  if (!util || !Number.isFinite(util)) return 'var(--sunken)';
  const t = utilTone(util);
  const p = t === 'ok' ? 14 + 26 * (util / UTIL_WARN) : t === 'warn' ? 30 + 12 * ((util - UTIL_WARN) / (1 - UTIL_WARN)) : 44 + 12 * Math.min(1, (util - 1) / 0.5);
  return `color-mix(in srgb, var(--${t}) ${Math.round(p)}%, var(--sunken))`;
}
export const ink = () => 'var(--ink)';
// What the colours mean – shown next to every heatmap.
export function HeatLegend() {
  const items = [
    [0, tr('keine Arbeit', 'no work')],
    [0.5, tr('≤ 85 % Luft', '≤ 85 % room')],
    [0.95, tr('85–100 % fast voll', '85–100 % nearly full')],
    [1.2, tr('> 100 % überbucht', '> 100 % overbooked')],
  ];
  return (
    <div className="heat-legend" role="note" aria-label={tr('Farblegende der Auslastung', 'Utilization colour legend')}>
      {items.map(([u, label]) => <span key={label}><i className={u > 1 ? 'over' : ''} style={{ background: heat(u) }} />{label}</span>)}
    </div>
  );
}

export default function Capacity() {
  const app = useApp();
  const { roles, capView, setCapView } = app;
  const opts = [
    { value: 'weeks', label: tr('Wochen (Auslastung)', 'Weeks (utilization)'), icon: 'grid' },
    { value: 'quarters', label: tr('Quartale (Wasserlinie)', 'Quarters (waterline)'), icon: 'waves' },
    ...(roles.editCapacity ? [{ value: 'edit', label: tr('Kapazitäten bearbeiten', 'Edit capacities'), icon: 'edit' }] : []),
  ];
  const v = opts.some((o) => o.value === capView) ? capView : 'weeks';
  return (
    <div className="page">
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <Segmented value={v} onChange={setCapView} options={opts} label={tr('Kapazitätsansicht', 'Capacity view')} />
        <button className="btn btn-sm" onClick={() => exportCapacity(app).catch((e) => app.toast({ text: e.message, error: true }))} title={tr('Kapazität als Excel herunterladen', 'Download capacity as Excel')}><Icon name="download" size={13} />Excel</button>
        {!roles.editCapacity && <span className="muted row" style={{ gap: 6, fontSize: 12.5 }}><Icon name="lock" size={13} />{tr('Kapazitäten pflegen nur freigegebene Gruppen.', 'Only enabled groups maintain capacities.')}</span>}
      </div>
      <>
        <motion.div key={v} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }} className="stack" style={{ gap: 20 }}>
          {v === 'weeks' && <Weeks />}
          {v === 'quarters' && <Waterline />}
          {v === 'edit' && <EditCapacity />}
        </motion.div>
      </>
    </div>
  );
}

// ---------- weeks (UC-05) ----------
function Weeks() {
  const { computed, ds } = useApp();
  const { weeks, model } = computed;
  const tip = useTip();
  const [open, setOpen] = useState(() => new Set());
  const personLevel = ds.personLevel !== false;
  const teams = weeks.teams.filter((t) => t.planTotal > 0 || t.capTotal > 0).sort((a, b) => (b.planTotal / (b.capTotal || 1)) - (a.planTotal / (a.capTotal || 1)));
  const tname = (id) => model.teams.get(id)?.name || (id === '_none' ? tr('Ohne Team', 'No team') : id);
  const cols = weeks.weeks.length;
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const maxBar = Math.max(1, ...teams.map((t) => Math.max(t.planTotal, t.capTotal)));
  const PAL = ['#262729', '#E34B04', '#8F8B82', '#C98A06', '#3D5BA6', '#2F7D57', '#B05B8C', '#5E8C9A', '#9A3402', '#6B6860'];
  const color = new Map([...model.items].map((p, i) => [p.ref, PAL[i % PAL.length]]));
  if (!teams.length) return <div className="card"><Empty icon="gauge" title={tr('Noch keine geplante Arbeit', 'No planned work yet')}>{tr('Sobald Stories Remaining Estimate und Due Date haben, erscheint hier die Auslastung.', 'Utilization appears once stories have a remaining estimate and a due date.')}</Empty></div>;
  return <>
    <section className="card">
      <div className="card-head">
        <h2 className="card-title"><Icon name="grid" />{tr('Auslastung der nächsten 8 Wochen', 'Utilization of the next 8 weeks')}</h2>
        <HeatLegend />
      </div>
      <div style={{ padding: '14px 20px 18px', overflowX: 'auto' }}>
        <div className="heat" style={{ '--cols': cols, minWidth: 820 }}>
          <div className="heat-row">
            <span />
            {weeks.weeks.map((w) => <span key={w.from} className="heat-head">{fmt.week(w.from)}<div style={{ fontWeight: 450, opacity: 0.8 }}>{fmt.date(w.from)}</div></span>)}
            <span className="heat-head">Ø</span>
          </div>
          {teams.map((t, ti) => {
            const avg = t.capTotal > 0 ? t.planTotal / t.capTotal : t.planTotal > 0 ? Infinity : 0;
            const isOpen = open.has(t.teamId);
            return (
              <div key={t.teamId} style={{ display: 'contents' }}>
                <div className="heat-row">
                  <button className="heat-label" style={{ border: 0, background: 'none', cursor: personLevel ? 'pointer' : 'default', textAlign: 'left' }} onClick={() => personLevel && toggle(t.teamId)} aria-expanded={isOpen}>
                    {personLevel && <motion.span animate={{ rotate: isOpen ? 90 : 0 }} transition={spring} style={{ display: 'grid', color: 'var(--ink-3)' }}><Icon name="chevron" size={14} /></motion.span>}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tname(t.teamId)}</span>
                    <span className="faint num" style={{ fontSize: 11.5, marginLeft: 'auto' }}>{t.members.length}</span>
                  </button>
                  {t.util.map((u, k) => (
                    <motion.div key={k} className={`heat-cell ${u > 1 ? 'over' : ''}`} style={{ background: heat(u), color: ink(u) }}
                      initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: (ti + k) * 0.022, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      tabIndex={0} {...tip(teamWeekCard(computed, weeks.weeks[k], k, { teamId: t.teamId, plan: t.plan, cap: t.cap, rows: t.members }, tname(t.teamId), (id) => ds.people?.[id]?.name || tr('Person', 'Person')))}
                      aria-label={t.cap[k] > 0 ? undefined : `${tname(t.teamId)}, ${fmt.week(weeks.weeks[k].from)}: ${noCapacityReason(t.plan[k], getLang())}`}>
                      {t.cap[k] > 0 ? fmt.pct(u).replace(' ', '') : NO_CAP_TEXT}
                    </motion.div>
                  ))}
                  <div className={`heat-cell ${avg > 1 ? 'over' : ''}`} style={{ background: heat(avg), color: ink(avg), boxShadow: 'inset 0 0 0 1.5px var(--surface)' }}
                    title={t.capTotal > 0 ? undefined : noCapacityReason(t.planTotal, getLang())}>{t.capTotal > 0 ? fmt.pct(avg).replace(' ', '') : NO_CAP_TEXT}</div>
                </div>
                <AnimatePresence>
                  {isOpen && t.members.map((mb, mi) => (
                    <motion.div key={mb.id} className="heat-row" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto', transition: { delay: mi * 0.03 } }} exit={{ opacity: 0, height: 0 }}>
                      <span className="heat-label sub"><Avatar user={ds.people?.[mb.id]} size={20} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ds.people?.[mb.id]?.name || '—'}</span>{mb.derived && <span className="faint" title={tr('Standardwerte – noch nicht gepflegt', 'Default values – not maintained yet')}>*</span>}</span>
                      {mb.util.map((u, k) => (
                        <div key={k} className={`heat-cell sub ${u > 1 ? 'over' : ''}`} style={{ background: heat(u), color: ink(u) }} tabIndex={0}
                          {...tip(personWeekCard(computed, weeks.weeks[k], mb.id, ds.people?.[mb.id]?.name || tr('Person', 'Person')))}>
                          {u === Infinity ? '∞' : fmt.pct(u).replace(' ', '')}
                        </div>
                      ))}
                      <span />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 12 }}>{tr('Auslastung = Remaining Estimate (bis zum Due Date verteilt) ÷ Kapazität (Wochenstunden abzüglich Feiertage, Abwesenheiten, Tagesgeschäft, interner Arbeit und Support).', 'Utilization = remaining estimate (spread up to the due date) ÷ capacity (weekly hours minus holidays, absences, daily business, internal work and support).')} {personLevel && tr('* Standardwerte', '* default values')}</div>
      </div>
    </section>
    <div className="grid-2">
      <section className="card">
        <div className="card-head"><h2 className="card-title"><Icon name="ranking" />{tr('Geplante Stunden je Team nach Projekt', 'Planned hours per team by project')}</h2><span className="faint" style={{ fontSize: 12 }}>8 {tr('Wochen', 'weeks')}</span></div>
        <div className="stack" style={{ padding: '14px 20px 18px', gap: 12 }}>
          {teams.map((t, ti) => (
            <motion.div key={t.teamId} {...stagger(ti, 0.04)}>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}><b style={{ fontWeight: 540 }}>{tname(t.teamId)}</b><span className="num muted">{fmt.h(t.planTotal)} / {fmt.h(t.capTotal)}</span></div>
              <div style={{ position: 'relative', height: 16, borderRadius: 6, background: 'var(--sunken)' }}>
                <div style={{ display: 'flex', height: '100%', borderRadius: 6, overflow: 'hidden', width: `${(t.planTotal / maxBar) * 100}%` }}>
                  {t.byProject.map((bp, k) => <motion.div key={bp.ref} initial={{ flexGrow: 0 }} animate={{ flexGrow: bp.hours }} transition={{ duration: 0.8, delay: k * 0.03 }} style={{ flexBasis: 0, background: color.get(bp.ref) || '#999' }} {...tip(<div><b>{model.itemByRef.get(bp.ref)?.name}</b> · {fmt.h(bp.hours)}</div>)} />)}
                </div>
                <span style={{ position: 'absolute', top: -4, bottom: -4, left: `${(t.capTotal / maxBar) * 100}%`, width: 2, background: 'var(--accent)', borderRadius: 2 }} title={tr('Kapazität', 'Capacity')} />
              </div>
            </motion.div>
          ))}
          <div className="bar-legend" style={{ marginTop: 6 }}>{model.items.filter((p) => color.has(p.ref)).slice(0, 10).map((p) => <span key={p.ref}><i style={{ background: color.get(p.ref) }} />{p.name}</span>)}<span><i style={{ background: 'var(--accent)', width: 3 }} />{tr('Kapazität', 'Capacity')}</span></div>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2 className="card-title"><Icon name="project" />{tr('Projektsicht', 'Project view')}</h2><span className="faint" style={{ fontSize: 12 }}>{tr('Anteil an der Gesamtkapazität', 'Share of total capacity')}</span></div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={tr('Tabelle, mit Pfeiltasten scrollbar', 'Table, scrollable with arrow keys')}><table className="table">
          <thead><tr><th>{tr('Projekt', 'Project')}</th><th>{tr('Teams', 'Teams')}</th><th className="r">{tr('Stunden', 'Hours')}</th><th className="r">{tr('Anteil', 'Share')}</th></tr></thead>
          <tbody>{weeks.projects.map((p) => (
            <tr key={p.ref}>
              <td><span className="row" style={{ gap: 8 }}><i style={{ width: 8, height: 8, borderRadius: 3, background: color.get(p.ref) }} />{model.itemByRef.get(p.ref)?.name || p.ref}</span></td>
              <td><div className="row wrap" style={{ gap: 4 }}>{p.teams.slice(0, 4).map((t) => <span key={t.teamId} className="chip" style={{ height: 20, fontSize: 11 }}>{tname(t.teamId)} {fmt.n(t.hours)}</span>)}</div></td>
              <td className="r">{fmt.h(p.total)}</td>
              <td className="r"><b>{fmt.pct(p.share, 1)}</b></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>
    </div>
  </>;
}

// ---------- waterline (UC-11) ----------
function Waterline() {
  const { computed, capCell, setCapCell } = useApp();
  const { wl, model } = computed;
  const tip = useTip();
  const tname = (id) => model.teams.get(id)?.name || (id === '_none' ? tr('Ohne Team', 'No team') : id);
  const pname = (id) => model.ds.people?.[id]?.name || tr('Person', 'Person');
  const teams = wl.teamIds;
  const first = teams.flatMap((t) => wl.quarters.map((q) => wl.cells[t]?.[q] && { t, q })).find(Boolean);
  const sel = capCell && wl.cells[capCell.t]?.[capCell.q] ? capCell : first;
  const cell = sel ? wl.cells[sel.t][sel.q] : null;
  if (!teams.length) return <div className="card"><Empty icon="waves" title={tr('Noch kein Bedarf', 'No demand yet')} /></div>;
  return (
    <div className="split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <section className="card">
        <div className="card-head"><h2 className="card-title"><Icon name="waves" />{tr('Auslastung je Team und Quartal', 'Utilization per team and quarter')}</h2></div>
        <div style={{ padding: '14px 18px 18px', overflowX: 'auto' }}>
          <div className="wl-grid" style={{ gridTemplateColumns: `130px repeat(${wl.quarters.length}, minmax(96px, 1fr))` }}>
            <span />{wl.quarters.map((q) => <span key={q} className="heat-head" style={{ alignSelf: 'end' }}>{fmt.quarter(q)}</span>)}
            {teams.map((t, ti) => (
              <div key={t} style={{ display: 'contents' }}>
                <span style={{ fontWeight: 540, alignSelf: 'center', fontSize: 13 }}>{tname(t)}</span>
                {wl.quarters.map((q, qi) => {
                  const c = wl.cells[t]?.[q];
                  if (!c) return <span key={q} className="faint" style={{ alignSelf: 'center', textAlign: 'center' }}>–</span>;
                  const u = waterShown(c).util;
                  const pressed = sel?.t === t && sel?.q === q;
                  return (
                    <motion.button key={q} className="wl-cell" aria-pressed={pressed} onClick={() => setCapCell({ t, q })} {...stagger(ti * 4 + qi, 0.015)}
                      {...tip(waterCellCard(c, tname(t), pname))}>
                      <motion.span className="wl-fill" initial={{ height: 0 }} animate={{ height: `${Math.min(1, Number.isFinite(u) ? u : 1) * 100}%` }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 + qi * 0.05 }} style={{ background: u > 1 ? 'var(--bad)' : 'var(--accent)' }} />
                      <span style={{ fontSize: 20, fontWeight: 560, letterSpacing: '-0.02em', color: u > 1 ? 'var(--bad)' : 'var(--ink)' }} className="num">{waterShown(c).capacity > 0 ? fmt.pct(u) : NO_CAP_TEXT}</span>
                      {!(waterShown(c).capacity > 0) ? <span className={`chip ${waterShown(c).demand > 0.05 ? 'chip-accent' : ''}`} style={{ height: 'auto', minHeight: 20, fontSize: 11, alignSelf: 'flex-start', whiteSpace: 'normal', textAlign: 'left' }}>{noCapacityReason(waterShown(c).demand, getLang())}</span> : c.waterRank ?<span className="chip chip-accent" style={{ height: 20, fontSize: 11, alignSelf: 'flex-start' }}>{tr('ab Rang', 'from rank')} {c.waterRank}</span> : <span className="chip chip-ok" style={{ height: 20, fontSize: 11, alignSelf: 'flex-start' }}><Icon name="check" size={11} />{tr('alles besetzbar', 'all staffable')}</span>}
                    </motion.button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>
      <>
        {cell && <motion.div key={`${sel.t}-${sel.q}`} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}><CellDetail cell={cell} team={tname(sel.t)} /></motion.div>}
      </>
    </div>
  );
}

function CellDetail({ cell, team }) {
  const { computed, setView } = useApp();
  const { model } = computed;
  const tip = useTip();
  const H = 330;
  const scale = Math.max(cell.capacity, cell.demand, 1) * 1.12;
  const y = (h) => (h / scale) * H;
  const capY = y(cell.capacity);
  const name = (r) => (r.kind === 'support' ? tr('Support (Vorrang)', 'Support (priority)') : model.itemByRef.get(r.ref)?.name || r.ref);
  const ws = waterSteps(cell);
  const free = ws.free;
  const shown = ws.shown;
  return (
    <section className="card">
      <div className="card-head">
        <div><h2 className="card-title">{team} · {fmt.quarter(cell.q)}</h2><div className="card-sub" style={{ marginTop: 3 }}>{waterlineSentence(cell, model, getLang())}</div>
          {cell.unscheduled > 0 && <div className="chip chip-warn" style={{ marginTop: 6 }}><Icon name="calendar" size={12} />{tr(`davon ${fmt.h(cell.unscheduled)} ohne Due Date (unterminiert)`, `incl. ${fmt.h(cell.unscheduled)} without due date (unscheduled)`)}</div>}</div>
      </div>
      {/* The whole calculation in four lines, so nobody has to add up the table themselves. */}
      <div className="wl-calc" data-wl-calc aria-label={tr('So wird gerechnet', 'How it is calculated')}>
        <div className="label">{tr('So wird gerechnet', 'How it is calculated')}</div>
        {ws.lines.map((l) => (
          <div key={l.key} className={`wl-calc-row ${l.key === 'util' ? 'is-result' : ''}`} data-line={l.key}
            {...(l.key === 'cap' && ws.shareWhy ? tip(<div>{tr('Projektanteil', 'Project share')} = {ws.shareWhy}{cell.capParts?.absencePct ? '' : tr(' · Ausfall 0 %', ' · absence 0 %')}. {tr('Ein Quartal = 12 Wochen. Änderbar unter Kapazitäten bearbeiten.', 'One quarter = 12 weeks. Change it under Edit capacities.')}</div>) : {})} tabIndex={l.key === 'cap' ? 0 : undefined}>
            <span className="wl-calc-label">{l.label}</span>
            <code className="wl-calc-expr">{l.expr}</code>
            <b className={`num wl-calc-res ${l.tone ? `tone-${l.tone}` : ''}`}>{l.approx ? '≈' : '='} {l.result}</b>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '170px minmax(0,1fr)', gap: 18, padding: '16px 20px 20px' }}>
        <div className="tank" style={{ height: H }} aria-label={tr('Wasserlinie', 'Waterline')}>
          {(() => {
            let acc = 0;
            return cell.rows.filter((r) => r.demand > 0).map((r, i) => {
              const bottom = y(acc); const h = Math.max(3, y(r.demand) - 2); acc += r.demand;
              const over = r.status !== 'ok';
              return (
                <motion.div key={`${r.kind}-${r.ref || 's'}`} className="tank-block" initial={{ opacity: 0, y: -40 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 240, damping: 22, delay: i * 0.08 }}
                  style={{ bottom: bottom + 1, height: h, background: r.kind === 'support' ? 'var(--ink)' : over ? 'repeating-linear-gradient(-45deg, var(--accent) 0 5px, color-mix(in srgb, var(--accent) 60%, transparent) 5px 10px)' : 'color-mix(in srgb, var(--ink) 18%, var(--surface))', color: r.kind === 'support' || over ? '#fff' : 'var(--ink)' }}
                  {...tip(<div><b>{r.kind === 'project' ? `#${r.rank} ` : ''}{name(r)}</b><div className="tt-grid"><span>{tr('Bedarf', 'Demand')}</span><span>{fmt.h(shown.rows[cell.rows.indexOf(r)].shownDemand)}</span><span>{tr('Stand im Tank (mit allem darunter)', 'Level in the tank (incl. everything below)')}</span><span>{fmt.h(shown.rows[cell.rows.indexOf(r)].shownCum)}</span><span>{tr('Kapazitätslinie', 'Capacity line')}</span><span>{fmt.h(shown.capacity)}</span></div></div>)}>
                  {h > 18 && <><span>{r.kind === 'support' ? 'S' : `#${r.rank}`}</span><span className="num" style={{ opacity: 0.8 }}>{fmt.n(shown.rows[cell.rows.indexOf(r)].shownDemand)}</span></>}
                </motion.div>
              );
            });
          })()}
          <motion.div className="tank-line" initial={{ bottom: 0 }} animate={{ bottom: capY }} transition={{ type: 'spring', stiffness: 90, damping: 16, delay: 0.3 }}>
            <svg className="tank-wave" style={{ top: -7 }} viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 7 Q12.5 0 25 7 T50 7 T75 7 T100 7 T125 7 T150 7 T175 7 T200 7" fill="none" stroke="var(--info)" strokeWidth="2.2" />
            </svg>
            <span style={{ position: 'absolute', right: 6, top: -24, fontSize: 10.5, fontWeight: 650, color: 'var(--info)', background: 'var(--surface)', padding: '1px 6px', borderRadius: 6 }}>{fmt.h(shown.capacity)}</span>
          </motion.div>
          <motion.div initial={{ height: 0 }} animate={{ height: Math.min(H, capY) }} transition={{ type: 'spring', stiffness: 90, damping: 16, delay: 0.3 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'color-mix(in srgb, var(--info) 9%, transparent)', zIndex: 0, pointerEvents: 'none' }} />
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={tr('Tabelle, mit Pfeiltasten scrollbar', 'Table, scrollable with arrow keys')} style={{ maxHeight: H + 20 }}>
          <table className="table">
            <thead><tr><th>{tr('Rang', 'Rank')}</th><th>{tr('Projekt', 'Project')}</th><th className="r">{tr('Bedarf', 'Demand')}</th><th className="r"><span tabIndex={0} className="th-help" {...tip(<div><b>{tr('Stand bis hier', 'Running total')}</b><div style={{ marginTop: 4 }}>{tr('Bedarf dieser Zeile plus aller Zeilen darüber – wie hoch der Tank bis hier gefüllt ist. Die Werte dieser Spalte nicht addieren: die letzte Zeile ist bereits der gesamte Bedarf.', 'Demand of this row plus all rows above – how full the tank is up to here. Do not add up this column: the last row already is the total demand.')}</div><div style={{ marginTop: 4 }}>{tr('Eine Zeile ist besetzbar, solange ihr Stand unter der Kapazitätslinie bleibt.', 'A row is staffable as long as its level stays below the capacity line.')}</div></div>)}>{tr('Stand bis hier', 'Running total')} <Icon name="info" size={11} /></span></th><th>Status</th></tr></thead>
            <tbody>
              {shown.rows.map((r, i) => {
                const crossing = i > 0 && cell.rows[i - 1].status === 'ok' && r.status !== 'ok';
                return (
                  <tr key={`${r.kind}-${r.ref || 's'}`} style={crossing ? { boxShadow: 'inset 0 2px 0 var(--info)' } : undefined}>
                    <td>{r.kind === 'support' ? <span className="rank-num s" style={{ width: 24, height: 24, fontSize: 12 }}>S</span> : <b className="num">{r.rank}</b>}</td>
                    <td>{r.kind === 'project' ? <button style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left' }} onClick={() => setView('project', { ref: r.ref })}>{name(r)}</button> : name(r)}</td>
                    <td className="r">{fmt.h(r.shownDemand)}</td>
                    <td className="r">{fmt.h(r.shownCum)}</td>
                    <td>{r.status === 'ok' ? <span className="chip chip-ok">{tr('besetzbar', 'staffable')}</span> : r.status === 'partial' ? <span className="chip chip-warn">{tr('teilweise', 'partial')}</span> : <span className="chip chip-bad">{tr('nicht besetzbar', 'not staffable')}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="wl-foot">
              <tr data-foot="demand"><td /><td>{tr('Bedarf gesamt', 'Total demand')}</td><td className="r"><b>{fmt.h(shown.demand)}</b></td><td colSpan={2} className="faint">{tr('= Summe der Spalte Bedarf', '= sum of the demand column')}</td></tr>
              <tr data-foot="cap"><td /><td>{tr('Kapazität (Wasserlinie)', 'Capacity (waterline)')}</td><td className="r"><b>{fmt.h(shown.capacity)}</b></td><td colSpan={2} className="faint">{tr('siehe Rechnung oben', 'see calculation above')}</td></tr>
              <tr data-foot="free"><td /><td>{free >= 0 ? tr('Frei', 'Free') : tr('Fehlt', 'Missing')}</td><td className="r"><b className={free >= 0 ? 'tone-ok' : 'tone-bad'}>{fmt.h(Math.abs(free))}</b></td><td colSpan={2} className="faint">{fmt.h(shown.capacity)} − {fmt.h(shown.demand)}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  );
}

// A share in % (1 – max): typing may pass through an empty field; only whole valid values are taken over.
function PctInput({ value, max, onCommit, label, style, className = 'input input-sm num', disabled }) {
  const [draft, setDraft] = useState(null);
  const ok = (v) => v !== '' && Number.isFinite(+v) && +v >= 1 && +v <= max;
  return (
    <input className={className} style={style} type="number" min={0} max={max} step={5} disabled={disabled} value={draft ?? value} aria-label={label}
      onChange={(e) => { const v = e.target.value; setDraft(v); if (ok(v)) onCommit(Math.round(+v)); }}
      onBlur={() => setDraft(null)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

// ---------- edit capacities (UC-14) ----------
// teamId: scoped to one team (Teams › Kapazitäten pflegen) – that team's row, its people and their absences.
export function EditCapacity({ teamId = null }) {
  const { ds, reload, toast, boot, done, config, computed } = useApp();
  // Atlassian Teams decide who belongs to a team (boss 2026-11-17): maintained people get their teams synced, members
  // without maintained values appear with the defaults (marked) and become maintained as soon as a value is changed
  const atl = atlIndex(computed?.model?.ds || ds);
  const judged = !!(teamId && atl?.judged(teamId));
  const tip = useTip();
  const [data, setData] = useState(null);
  const [cap, setCap] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [abs, setAbs] = useState({ accountId: '', from: '', to: '', type: 'vacation' });
  const [rq, setRq] = useState('');
  const [rFound, setRFound] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const syncNow = () => {
    setSyncing(true);
    call('teams.atlassian', { refresh: true })
      .then((r) => { if (r?.status === 'ok') { reload(true); toast({ text: tr('Mit Atlassian Teams abgeglichen', 'Synced with Atlassian Teams') }); } else toast({ text: tr('Atlassian Teams gerade nicht erreichbar', 'Atlassian Teams not reachable right now'), error: true }); })
      .catch((e) => toast({ text: errText(e), error: true }))
      .finally(() => setSyncing(false));
  };
  useEffect(() => { call('capacity.get').then((d) => { setData(d); setCap(synced(d.capacity)); }).catch((e) => toast({ text: errText(e), error: true })); }, [toast]); // eslint-disable-line react-hooks/exhaustive-deps
  // the saved capacity with every maintained person's teams matched to Atlassian Teams (what all views count)
  function synced(capacity) {
    const c = structuredClone(capacity);
    if (atl) for (const [id, p] of Object.entries(c.people || {})) {
      const x = { id, ...p };
      syncMaintained(x, atl);
      if (!x.syncedFromAtlassian) continue;
      const { id: _i, maintainedTeams: _m, syncedFromAtlassian: _s, ...rest } = x;
      if (rest.teams === undefined) delete rest.teams;
      c.people[id] = rest;
    }
    return c;
  }
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => call('users.search', { query: q }).then(setFound).catch(() => setFound([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (rq.trim().length < 2) { setRFound([]); return; }
    const t = setTimeout(() => call('users.search', { query: rq }).then(setRFound).catch(() => setRFound([])), 250);
    return () => clearTimeout(t);
  }, [rq]);
  // a team's weekly hours as every view counts them: maintained people AND members still on default values (Atlassian
  // Teams, assignees). Before, the team row counted only maintained people – "0 h" for a team whose member shows
  // "Standardwerte" (boss 2026-11-20, SUPERPORT #1)
  const counted = useMemo(() => (cap ? [...capacityPeople({ ds: { ...(computed?.model?.ds || ds), capacity: cap } }).values()] : []), [cap, ds, computed]);
  if (!cap) return <div className="card card-pad stack">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={44} />)}</div>;
  const people = { ...ds.people, ...data.people };
  for (const [pid, n] of atl?.names || []) if (!people[pid]) people[pid] = { id: pid, name: n };
  const virtual = {};
  if (judged) for (const pid of atl.byTeam.get(teamId) || []) if (!cap.people[pid]) {
    const list = evenSplit(atl.byPerson.get(pid) || [teamId], teamId);
    virtual[pid] = { weeklyHours: ds.capacity?.defaultWeeklyHours ?? 40, location: ds.capacity?.defaultLocation || 'NONE', teamId, ...(list.length > 1 ? { teams: list } : {}) };
  }
  const rowsOf = { ...virtual, ...cap.people };
  // the record to change: a member shown with the defaults becomes maintained on the first change
  const P = (c, id) => (c.people[id] ||= structuredClone(virtual[id]));
  const allTeams = [...new Map([...ds.teams, ...Object.entries(cap.teams).map(([id, t]) => ({ id, name: t.name }))].map((t) => [t.id, t])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const teams = teamId ? allTeams.filter((t) => t.id === teamId).concat(allTeams.some((t) => t.id === teamId) ? [] : [{ id: teamId, name: teamId }]) : allTeams;
  // people split across teams (UC-14) belong to every team they have a share in; team hours = weekly hours × share
  const inScope = (id) => !teamId || inTeam(rowsOf[id], teamId);
  const upd = (fn) => { setCap((c) => { const n = structuredClone(c); fn(n); return n; }); setDirty(true); };
  const team = (id) => cap.teams[id] || { name: teams.find((t) => t.id === id)?.name || id, dailyBusinessPct: 20, internalPct: 0, absenceRatePct: 10 };
  const weekly = (tid) => counted.reduce((a, p) => a + (+p.weeklyHours || 0) * shareOf(p, tid), 0) + (+team(tid).extraWeeklyHours || 0);
  const teamName = (id) => allTeams.find((t) => t.id === id)?.name || cap.teams[id]?.name || id;
  // the team a row's "Anteil im Team" refers to: the scoped team, otherwise the person's main team
  const ctxTeam = (p) => teamId || p.teamId || allocationOf(p)[0]?.teamId || null;
  const pctIn = (p, tid) => Math.round(shareOf(p, tid) * 100);
  const setPct = (id, tid, v) => upd((c) => { c.people[id] = setShare(P(c, id), tid, Math.max(1, Math.round(+v) || 1)); });
  const addTeam = (id, tid) => {
    const r = joinTeam(rowsOf[id], tid);
    if (!r.pct) { toast({ text: tr('Kein Anteil frei – erst einen anderen Anteil verringern.', 'No share left – lower another share first.'), error: true }); return; }
    upd((c) => { c.people[id] = r.person; });
    return r.pct;
  };
  const removeRow = (id) => upd((c) => {
    const p = c.people[id];
    // in a team's view: only leave this team when the person also works in others
    if (teamId && allocationOf(p).length > 1) c.people[id] = setShare(p, teamId, 0);
    else delete c.people[id];
  });
  // locations (UC-09): the named locations first; the calendars only while none are defined
  const named = Array.isArray(config?.locations) ? config.locations : [];
  const locValue = (p) => (named.length ? resolveLocation(named, p.location).id : p.location);
  const locsFor = (p) => {
    const base = named.length ? named.map((l) => [l.id, l.name]) : locs;
    const v = locValue(p);
    return base.some(([k]) => k === v) ? base : [...base, [v, (data.locations || boot.locations || {})[v] || v]];
  };
  const save = async () => {
    setSaving(true);
    const before = structuredClone(data.capacity);
    try {
      await call('capacity.save', { capacity: cap });
      setData((d) => ({ ...d, capacity: structuredClone(cap) })); setDirty(false); reload(true);
      done(tr('Kapazitäten gespeichert – Auslastung und Wasserlinie aktualisiert', 'Capacities saved – utilization and waterline updated'), 'users', tr('Kapazitäten', 'capacities'), async () => {
        await call('capacity.save', { capacity: before });
        setData((d) => ({ ...d, capacity: structuredClone(before) })); setCap(structuredClone(before)); setDirty(false); reload(true);
      }, ['capacity']);
    }
    catch (e) { toast({ text: errText(e), error: true }); } finally { setSaving(false); }
  };
  // every country (no German states any more – a person who still has one keeps it, see locsFor)
  const locs = CALENDAR_CHOICES.map((o) => [o.value, o.label]);
  return <>
    <section className="card">
      <div className="card-head"><h2 className="card-title"><Icon name="users" />{tr('Teams', 'Teams')}</h2><span className="card-sub row wrap" style={{ gap: 8 }}>{atl ? tr(`Mitglieder aus Atlassian Teams${atl.at ? ` · abgeglichen ${fmt.ago(new Date(atl.at).toISOString())}` : ''}; Support wird gemessen und ist nicht editierbar.`, `Members from Atlassian Teams${atl.at ? ` · synced ${fmt.ago(new Date(atl.at).toISOString())}` : ''}; support is measured and not editable.`) : tr('Mitglieder aus der Cockpit-Pflege; Support wird gemessen und ist nicht editierbar.', 'Members from cockpit maintenance; support is measured and not editable.')}
        {atl && <button type="button" className="btn btn-ghost btn-sm" data-teams-sync disabled={syncing} onClick={syncNow}><Icon name="refresh" size={13} />{syncing ? tr('gleiche ab …', 'syncing …') : tr('Jetzt abgleichen', 'Sync now')}</button>}</span></div>
      {/* fits its card from 1024 px on: compact inputs, headers that wrap; on phones every team becomes a card (labels from data-label) */}
      <div className="table-scroll cap-scroll" tabIndex={0} role="region" aria-label={tr('Teams und ihre Kapazitätswerte', 'Teams and their capacity values')}><table className="table cap-table cap-teams" role="table">
        <thead role="rowgroup"><tr role="row"><th role="columnheader">Team</th><th role="columnheader" className="r">{tr('Wochen­stunden', 'Weekly hours')}</th><th role="columnheader" className="r" title={tr('Kapazität, die noch keiner Person zugeordnet ist (z. B. offene Stellen, externe Partner)', 'Capacity not yet assigned to a person (e.g. open positions, external partners)')}>{tr('Ohne Namen h/Wo', 'Unnamed h/wk')}</th><th role="columnheader" className="r" title={tr('Anteil der Woche für Tagesgeschäft – jede Woche abgezogen', 'Share of the week for daily business – deducted every week')}>{tr('Tages­geschäft %', 'Daily business %')}</th><th role="columnheader" className="r" title={tr('Anteil der Woche für interne Arbeit (Meetings, Weiterbildung, Verwaltung) – jede Woche abgezogen, wie das Tagesgeschäft', 'Share of the week for internal work (meetings, training, admin) – deducted every week, like daily business')}>{tr('Intern %', 'Internal %')}</th><th role="columnheader" className="r" title={tr('Pauschale für Urlaub und Krankheit – nur in der Quartalsplanung; die Wochensicht zieht die echten Feiertage und eingetragenen Abwesenheiten ab', 'Allowance for leave and sickness – quarter planning only; the weekly view deducts the real holidays and entered absences')}>{tr('Ausfall­quote %', 'Absence rate %')}</th><th role="columnheader" className="r">{tr('Support (gemessen)', 'Support (measured)')}</th><th role="columnheader" className="r">{tr('Für Projekte / Quartal', 'For projects / quarter')}</th></tr></thead>
        <tbody role="rowgroup">{teams.map((t) => {
          const tm = team(t.id); const w = weekly(t.id); const sup = data.supportByTeam?.[t.id] || 0;
          const avail = Math.max(0, w * 12 * projectShare(tm) * (1 - (tm.absenceRatePct || 0) / 100) - sup * 12); // same formula as shared/engine.js quarterCapacity
          return (
            <tr key={t.id} role="row">
              <td role="cell" className="cap-name"><b style={{ fontWeight: 540 }}>{t.name}</b></td>
              <td role="cell" className="r num" data-label={tr('Wochenstunden', 'Weekly hours')}>{fmt.h(w)}</td>
              <td role="cell" className="r" data-label={tr('Ohne Namen h/Wo', 'Unnamed h/wk')}><input className="input input-sm num cap-num" type="number" min={0} max={4000} step={8} value={tm.extraWeeklyHours || 0} onChange={(e) => upd((c) => { c.teams[t.id] = { ...team(t.id), extraWeeklyHours: +e.target.value }; })} aria-label={`${t.name} ${tr('Kapazität ohne Namen', 'unnamed capacity')}`} /></td>
              <td role="cell" className="r" data-label={tr('Tagesgeschäft %', 'Daily business %')}><input className="input input-sm num cap-num" type="number" min={0} max={95} value={tm.dailyBusinessPct} onChange={(e) => upd((c) => { c.teams[t.id] = { ...team(t.id), dailyBusinessPct: +e.target.value }; })} aria-label={`${t.name} ${tr('Tagesgeschäft', 'daily business')}`} /></td>
              <td role="cell" className="r" data-label={tr('Intern %', 'Internal %')}><input className="input input-sm num cap-num" type="number" min={0} max={95} value={tm.internalPct || 0} onChange={(e) => upd((c) => { c.teams[t.id] = { ...team(t.id), internalPct: Math.max(0, Math.min(95 - (+team(t.id).dailyBusinessPct || 0), +e.target.value)) }; })} aria-label={`${t.name} ${tr('interne Arbeit', 'internal work')}`} /></td>
              <td role="cell" className="r" data-label={tr('Ausfallquote %', 'Absence rate %')}><input className="input input-sm num cap-num" type="number" min={0} max={95} value={tm.absenceRatePct} onChange={(e) => upd((c) => { c.teams[t.id] = { ...team(t.id), absenceRatePct: +e.target.value }; })} aria-label={`${t.name} ${tr('Ausfallquote', 'absence rate')}`} /></td>
              <td role="cell" className="r num muted" data-label={tr('Support (gemessen)', 'Support (measured)')}><span style={{ whiteSpace: 'nowrap' }}><Icon name="lock" size={11} /> {fmt.h(sup, 1)}/{tr('Wo', 'wk')}</span></td>
              <td role="cell" className="r" data-label={tr('Für Projekte / Quartal', 'For projects / quarter')}><motion.b key={avail} initial={{ color: 'var(--accent)' }} animate={{ color: 'var(--ink)' }} className="num">{fmt.h(avail)}</motion.b></td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {teamId && teams.map((t) => { const tm = team(t.id); return (
              <div className="resp-row" key={`r-${t.id}`}><span className="label" style={{ margin: 0 }}>{tr('Verantwortlich', 'Responsible')}</span><div>
                <div className="row wrap" style={{ gap: 4 }}>
                  {(tm.responsible || []).map((id) => <span key={id} className="chip"><Avatar user={people[id]} size={16} />{people[id]?.name || tr('Person', 'Person')}<button className="chip-x" onClick={() => upd((c) => { c.teams[t.id] = { ...team(t.id), responsible: (team(t.id).responsible || []).filter((x) => x !== id) }; })} aria-label={tr('Entfernen', 'Remove')}><Icon name="x" size={10} /></button></span>)}
                  <span className="input-wrap" style={{ width: 170, position: 'relative' }}><Icon name="plus" size={12} /><input className="input input-sm" value={rq} onChange={(e) => setRq(e.target.value)} placeholder={tr('Person …', 'Person …')} aria-label={tr('Verantwortliche Person hinzufügen', 'Add responsible person')} />
                    {rFound.length > 0 && <div className="popover" style={{ position: 'absolute', top: 34, left: 0, minWidth: 220, zIndex: 5 }}>
                      {rFound.map((u) => <button key={u.id} className="menu-item" onClick={() => { data.people[u.id] = u; upd((c) => { c.teams[t.id] = { ...team(t.id), responsible: [...new Set([...(team(t.id).responsible || []), u.id])] }; }); setRq(''); setRFound([]); }}><Avatar user={u} size={20} />{u.name}</button>)}
                    </div>}
                  </span>
                </div>
                {!(tm.responsible || []).length && <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>{tr('Noch niemand – bestimmt, wer Einzelwerte sieht und Eskalationen bekommt.', 'Nobody yet – decides who sees individual values and gets escalations.')}</div>}
              </div></div>
      ); })}
    </section>
    <div className="grid-2">
      <section className="card">
        <div className="card-head"><h2 className="card-title"><Icon name="user" />{tr('Mitarbeitende', 'People')}</h2>
          {judged ? (
            <button type="button" className="btn btn-ghost btn-sm" data-atl-members onClick={() => openUrl(`/jira/people/team/${encodeURIComponent(teamId)}`)} title={tr('Wer zum Team gehört, kommt aus Atlassian Teams – dort Personen hinzufügen oder entfernen', 'Who belongs to the team comes from Atlassian Teams – add or remove people there')}><Icon name="external" size={13} />{tr('Mitglieder in Atlassian Teams', 'Members in Atlassian Teams')}</button>
          ) : <div className="input-wrap" style={{ width: 240, position: 'relative' }}><Icon name="plus" size={14} /><input className="input input-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={teamId ? tr('Person ins Team holen …', 'Bring a person into the team …') : tr('Person hinzufügen …', 'Add person …')} aria-label={tr('Person suchen', 'Search person')} />
            {found.length > 0 && (
              <motion.div className="popover" style={{ position: 'absolute', top: 36, left: 0, right: 0 }} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
                {found.map((u) => {
                  const cur = cap.people[u.id];
                  const elsewhere = teamId && cur && !inTeam(cur, teamId);
                  return (
                    <button key={u.id} className="menu-item" onClick={() => {
                      data.people[u.id] = u;
                      if (elsewhere) {
                        // "Person aus anderem Team aufnehmen": joins with a share, stays in the other team
                        const pct = addTeam(u.id, teamId);
                        if (pct) toast({ text: tr(`${u.name} mit ${pct} % ins Team aufgenommen – Anteile prüfen`, `${u.name} joined the team with ${pct}% – check the shares`) });
                      } else if (!cur) upd((c) => { c.people[u.id] = { weeklyHours: ds.capacity?.defaultWeeklyHours ?? 40, location: ds.capacity?.defaultLocation || 'DE', teamId: teamId || teams[0]?.id || null }; });
                      setQ(''); setFound([]);
                    }}>
                      <Avatar user={u} size={20} /><span className="grow">{u.name}</span>
                      {cur && <span className="faint" style={{ fontSize: 11.5 }}>{allocationOf(cur).map((x) => teamName(x.teamId)).join(', ')}</span>}
                    </button>
                  );
                })}
              </motion.div>)}
          </div>}
        </div>
        {/* fits the half-width card: the teams (main team in the overall view, other teams with their shares) are the
            second line of the person cell; on phones every person becomes a card (labels from data-label) */}
        <div className="table-scroll cap-scroll" tabIndex={0} role="region" aria-label={tr('Mitarbeitende und ihre Kapazität', 'People and their capacity')} style={{ maxHeight: 520 }}><table className="table cap-table cap-people" role="table">
          <thead role="rowgroup"><tr role="row">
            <th role="columnheader" {...tip(infoCard({ title: tr('Weitere Teams', 'Other teams'), text: tr('Unter dem Namen: Teams, in denen die Person außerdem arbeitet, mit ihrem Anteil. Zusammen sollten die Anteile 100 % ergeben.', 'Below the name: teams the person also works in, with their share. Together the shares should add up to 100%.') }))}>{teamId ? tr('Person · weitere Teams', 'Person · other teams') : tr('Person · Teams', 'Person · teams')}</th>
            <th role="columnheader" className="r" {...tip(infoCard({ title: tr('Anteil im Team', 'Share in the team'), text: tr('Wie viel der Wochenstunden die Person in diesem Team arbeitet. Die Teamkapazität zählt Wochenstunden × Anteil; die Auslastung der Person bleibt über alle Teams.', 'How much of the weekly hours the person works in this team. Team capacity counts weekly hours × share; the person\'s own utilisation stays across all teams.') }))}>{tr('Anteil im Team', 'Share in team')}</th>
            <th role="columnheader" className="r">{tr('Std./ Woche', 'Hrs/ week')}</th><th role="columnheader">{tr('Standort', 'Location')}</th><th role="columnheader" className="cap-x"><span className="sr-only">{tr('Entfernen', 'Remove')}</span></th>
          </tr></thead>
          <tbody role="rowgroup">{Object.entries(rowsOf).filter(([id]) => inScope(id)).sort((a, b) => (people[a[0]]?.name || '').localeCompare(people[b[0]]?.name || '')).map(([id, p]) => {
            const ct = ctxTeam(p);
            const alloc = allocationOf(p);
            const others = alloc.filter((x) => x.teamId !== ct);
            const total = Math.round(allocationSum(alloc));
            const off = allocationOff(p);
            const free = allTeams.filter((t) => !alloc.some((x) => x.teamId === t.id));
            return (
              <tr key={id} role="row">
                <td role="cell" className="cap-who">
                  <span className="row cap-person"><Avatar user={people[id]} size={22} /><span>{people[id]?.name || id}</span>{virtual[id] && !cap.people[id] && <span className="chip chip-outline" style={{ fontSize: 11 }} title={tr('Mitglied laut Atlassian Teams – noch keine eigenen Werte; zählt mit den Standardwerten', 'Member per Atlassian Teams – no own values yet; counts with the defaults')}>{tr('Standardwerte', 'Defaults')}</span>}</span>
                  <div className="row wrap cap-teamline">
                    {!teamId && <select className="select select-sm cap-main" value={p.teamId || ''} onChange={(e) => upd((c) => { c.people[id] = moveMainTeam(P(c, id), e.target.value); })} aria-label={tr('Team', 'Team')}>{allTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
                    {others.map((x) => (
                      <motion.span key={x.teamId} className="chip" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}>
                        {teamName(x.teamId)}
                        <PctInput className="num" max={100 - Math.round(allocationSum(alloc.filter((y) => y.teamId !== x.teamId)))} value={Math.round(x.pct)} onCommit={(v) => setPct(id, x.teamId, v)}
                          style={{ width: 34, border: 0, background: 'transparent', textAlign: 'right', font: 'inherit', color: 'inherit', padding: 0 }} label={`${teamName(x.teamId)} ${tr('Anteil in Prozent', 'share in percent')}`} />%
                        <button className="chip-x" onClick={() => upd((c) => { c.people[id] = setShare(P(c, id), x.teamId, 0); })} aria-label={tr(`Aus ${teamName(x.teamId)} entfernen`, `Remove from ${teamName(x.teamId)}`)}><Icon name="x" size={10} /></button>
                      </motion.span>
                    ))}
                    {alloc.length < MAX_TEAMS && free.length > 0 && (
                      <select className="select select-sm cap-add" value="" onChange={(e) => { if (e.target.value) addTeam(id, e.target.value); }} aria-label={tr('Weiteres Team hinzufügen', 'Add another team')}>
                        <option value="">{tr('+ Team', '+ Team')}</option>
                        {free.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                  </div>
                </td>
                <td role="cell" className="r" data-label={tr('Anteil im Team', 'Share in team')}>
                  <span className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                    {off && <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }} style={{ display: 'inline-flex', color: 'var(--warn)' }} tabIndex={0}
                      {...tip(infoCard({ title: tr('Anteile prüfen', 'Check the shares'), text: tr(`Zusammen ${total} % statt 100 %.${total < 100 ? ' Der Rest zählt in keinem Team.' : ''}`, `${total}% together instead of 100%.${total < 100 ? ' The rest counts in no team.' : ''}`), items: alloc.map((x) => ({ text: teamName(x.teamId), sub: `${Math.round(x.pct)} %`, tone: 'ok' })) }))}>
                      <Icon name="alert" size={13} /></motion.span>}
                    <PctInput className="input input-sm num cap-num cap-pct" max={100 - Math.round(allocationSum(others))} value={ct ? pctIn(p, ct) || 100 : 100} disabled={!ct}
                      onCommit={(v) => ct && setPct(id, ct, v)} label={tr('Anteil im Team in Prozent', 'Share in the team in percent')} />
                    <span className="faint">%</span>
                  </span>
                </td>
                <td role="cell" className="r" data-label={tr('Std./Woche', 'Hrs/week')}><input className="input input-sm num cap-num" type="number" min={0} max={80} value={p.weeklyHours} onChange={(e) => upd((c) => { P(c, id).weeklyHours = +e.target.value; })} aria-label={tr('Wochenstunden', 'Weekly hours')} /></td>
                <td role="cell" className="cap-loc" data-label={tr('Standort', 'Location')}><select className="select select-sm" value={locValue(p)} onChange={(e) => upd((c) => { P(c, id).location = e.target.value; })} aria-label={tr('Standort', 'Location')}>{locsFor(p).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                <td role="cell" className="cap-x">{judged && atl.isMember(id, teamId) ? null : <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeRow(id)} aria-label={teamId && alloc.length > 1 ? tr('Aus diesem Team entfernen', 'Remove from this team') : tr('Entfernen', 'Remove')}><Icon name="x" size={14} /></button>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </section>
      <section className="card">
        <div className="card-head"><h2 className="card-title"><Icon name="calendar" />{tr('Abwesenheiten', 'Absences')}</h2><span className="card-sub">{tr('Krankheit nur als „abwesend" ohne Grund (DSGVO)', 'Sickness only as "absent" without reason (GDPR)')}</span></div>
        <div className="row wrap" style={{ padding: '12px 16px', gap: 8, borderBottom: '1px solid var(--line-soft)' }}>
          <select className="select select-sm" value={abs.accountId} onChange={(e) => setAbs({ ...abs, accountId: e.target.value })} aria-label={tr('Person', 'Person')}><option value="">{tr('Person …', 'Person …')}</option>{Object.keys(rowsOf).filter(inScope).map((id) => <option key={id} value={id}>{people[id]?.name || id}</option>)}</select>
          <input type="date" className="input input-sm" value={abs.from} onChange={(e) => setAbs({ ...abs, from: e.target.value })} aria-label={tr('Von', 'From')} />
          <input type="date" className="input input-sm" value={abs.to} onChange={(e) => setAbs({ ...abs, to: e.target.value })} aria-label={tr('Bis', 'To')} />
          <select className="select select-sm" value={abs.type} onChange={(e) => setAbs({ ...abs, type: e.target.value })} aria-label={tr('Art', 'Type')}><option value="vacation">{tr('Urlaub', 'Vacation')}</option><option value="training">{tr('Schulung', 'Training')}</option><option value="absent">{tr('Abwesend', 'Absent')}</option></select>
          <button className="btn btn-sm" disabled={!abs.accountId || !abs.from || !abs.to || abs.to < abs.from} onClick={() => { upd((c) => { c.absences.push({ id: Math.random().toString(36).slice(2, 10), ...abs }); }); setAbs({ accountId: '', from: '', to: '', type: 'vacation' }); }}><Icon name="plus" />{tr('Eintragen', 'Add')}</button>
        </div>
        <div style={{ maxHeight: 440, overflow: 'auto' }}>
          {cap.absences.filter((a) => inScope(a.accountId)).length === 0 && <div className="muted" style={{ padding: 20, textAlign: 'center' }}>{tr('Keine Abwesenheiten erfasst', 'No absences recorded')}</div>}
          {cap.absences.filter((a) => inScope(a.accountId)).sort((a, b) => a.from.localeCompare(b.from)).map((a) => (
            <motion.div key={a.id} layout="position" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.24 }} className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--line-soft)' }}>
              <Avatar user={people[a.accountId]} size={22} /><span className="grow">{people[a.accountId]?.name || a.accountId}</span>
              <span className="num muted" style={{ fontSize: 12.5 }}>{fmt.date(a.from)} – {fmt.date(a.to)}</span>
              <span className={`chip ${a.type === 'vacation' ? 'chip-info' : a.type === 'training' ? 'chip-warn' : ''}`}>{{ vacation: tr('Urlaub', 'Vacation'), training: tr('Schulung', 'Training'), absent: tr('Abwesend', 'Absent') }[a.type]}</span>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => upd((c) => { c.absences = c.absences.filter((x) => x.id !== a.id); })} aria-label={tr('Löschen', 'Delete')}><Icon name="x" size={14} /></button>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
    {dirty && (
        <motion.div className="savebar" initial={{ y: 80, opacity: 0, x: '-50%' }} animate={{ y: 0, opacity: 1, x: '-50%' }} transition={spring}>
          <span>{tr('Ungespeicherte Änderungen', 'Unsaved changes')}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => { setCap(structuredClone(data.capacity)); setDirty(false); }}>{tr('Verwerfen', 'Discard')}</button>
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>{saving ? tr('Speichere …', 'Saving …') : tr('Speichern', 'Save')}</button>
        </motion.div>
      )}
  </>;
}
