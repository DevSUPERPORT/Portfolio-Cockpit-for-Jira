// Projects › Structure › Timeline (Gantt) – for project admins and above (boss 2026-11-19).
// One row per work item, in the tree's order (collapse and filters apply). A bar runs from Start to Due – the same fields
// Jira's own timeline uses. Parents without dates show the span of what is below them; one date shows a marker.
// What helps decide at a glance: the slip of overdue work (hatched up to today), "start after due", children that end
// after their parent, dependency arrows (conflicts in red), milestones, today, a strip of quick filters, the period
// and the zoom, colour by status / team / assignee, and a card with every detail on hover. Settings are remembered.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { rollups, barOf, periodRange, ticks, ZOOM_PX, quickFlags, workdaysBetween, spanDays, isoWeek } from '@shared/timeline.js';
import { milestoneOf } from '@shared/engine.js';
import { isoOf, mondayOf } from '@shared/dates.js';
import { tr, fmt, getLang } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { openIssue } from '../lib/api.js';
import { Segmented, Switch, useTip, infoCard } from './ui.jsx';
import { LotseChip } from './lotse/LotseChip.jsx';

const LEFT = 330, ROW = 34, PALETTE = 8;
const pref = {
  get: (k, d) => { try { const v = JSON.parse(localStorage.getItem(`pc:tl:${k}`)); return v ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(`pc:tl:${k}`, JSON.stringify(v)); } catch { /* storage blocked: not remembered */ } },
};
export function usePref(k, d) {
  const [v, setV] = useState(() => pref.get(k, d));
  return [v, (x) => { setV(x); pref.set(k, x); }];
}
const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
const ROLE_BG = { rough: 'var(--accent)', structure: 'var(--info)', estimate: 'var(--ok)', tiny: 'var(--ink-3)' };
const locale = () => (getLang() === 'de' ? 'de-DE' : 'en-GB');
const monthLabel = (y, m, short) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale(), { month: short ? 'short' : 'long', timeZone: 'UTC' });
const autoZoom = (days) => (days <= 120 ? 'week' : days <= 550 ? 'month' : 'quarter');

export default function StructureTimeline({ projectRef, rows, issues, kidsOf, model, deps, onExpandAll, onCollapseAll }) {
  const tip = useTip();
  const today = model.today;
  const [period, setPeriod] = usePref('period', 'fit');
  const [custom, setCustom] = usePref('custom', { from: '', to: '' });
  const [zoomPref, setZoom] = usePref('zoom', 'auto');
  const [colorBy, setColorBy] = usePref('color', 'status');
  const [showDeps, setShowDeps] = usePref('deps', true);
  const [showMs, setShowMs] = usePref('ms', true);
  const [quick, setQuick] = useState(null);
  const wrap = useRef(null);
  const scroller = useRef(null);
  const [width, setWidth] = useState(1000);
  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 1000));
    ro.observe(el); setWidth(el.clientWidth || 1000);
    return () => ro.disconnect();
  }, []);

  // bars and flags for every row of the project (not only the visible ones: the strip counts the whole selection)
  const roll = useMemo(() => rollups(issues, kidsOf), [issues, kidsOf]);
  const conflictIds = useMemo(() => new Set((deps?.list || []).filter((d) => d.conflict).flatMap((d) => [d.pre, d.dep])), [deps]);
  const bars = useMemo(() => new Map(issues.map((i) => [i.id, barOf(i, roll, today)])), [issues, roll, today]);
  const flags = useMemo(() => new Map(issues.map((i) => [i.id, quickFlags(i, bars.get(i.id), today, conflictIds)])), [issues, bars, today, conflictIds]);
  const [a, b] = useMemo(() => periodRange(period, today, [...bars.values()], custom), [period, today, bars, custom]);
  const days = b - a + 1;
  const zoom = zoomPref === 'auto' ? autoZoom(days) : zoomPref;
  const trackW = Math.max(Math.round(days * ZOOM_PX[zoom]), width - LEFT - 2);
  const px = trackW / days;
  const x = (d) => (d - a) * px;
  const counts = useMemo(() => {
    const c = { overdue: 0, soon: 0, unscheduled: 0, conflict: 0, invalid: 0, late: 0 };
    for (const f of flags.values()) for (const k of Object.keys(c)) if (f[k]) c[k]++;
    return c;
  }, [flags]);
  // a quick filter keeps the matching rows and the rows above them (so the hierarchy stays readable)
  const shownRows = useMemo(() => {
    if (!quick) return rows;
    const keep = new Set();
    for (const i of issues) if (flags.get(i.id)?.[quick]) { let cur = i; while (cur && !keep.has(cur.id)) { keep.add(cur.id); cur = model.byId.get(cur.parentId); } }
    return rows.filter((r) => keep.has(r.i.id)).map((r) => ({ ...r, ctx: !flags.get(r.i.id)?.[quick] }));
  }, [rows, quick, issues, flags, model]);
  const rowIdx = useMemo(() => new Map(shownRows.map((r, k) => [r.i.id, k])), [shownRows]);
  const inPeriod = useMemo(() => issues.filter((i) => { const t = bars.get(i.id); return t.a != null && t.b >= a && t.a <= b; }).length, [issues, bars, a, b]);
  const milestones = useMemo(() => {
    const m = new Map();
    for (const i of issues) { const ms = milestoneOf(model, i); if (ms?.date) m.set(ms.id, ms); }
    return [...m.values()].map((ms) => ({ ...ms, d: Math.round(Date.parse(`${ms.date}T00:00:00Z`) / 864e5) })).filter((ms) => ms.d >= a && ms.d <= b);
  }, [issues, model, a, b]);
  const scale = useMemo(() => ticks(a, b, zoom), [a, b, zoom]);
  const colorOf = (i, bar) => {
    if (colorBy === 'team') return i.team?.id ? `var(--tl-c${hash(i.team.id) % PALETTE})` : 'var(--tl-none)';
    if (colorBy === 'assignee') return i.assignee?.id && !i.assignee.anon ? `var(--tl-c${hash(i.assignee.id) % PALETTE})` : 'var(--tl-none)';
    return bar.done ? 'var(--tl-done)' : i.status?.cat === 'indeterminate' ? 'var(--tl-doing)' : 'var(--tl-todo)';
  };
  const legendItems = useMemo(() => {
    if (colorBy === 'status') return [[tr('Offen', 'To do'), 'var(--tl-todo)'], [tr('In Arbeit', 'In progress'), 'var(--tl-doing)'], [tr('Erledigt', 'Done'), 'var(--tl-done)']];
    const m = new Map();
    for (const r of shownRows) {
      const o = colorBy === 'team' ? r.i.team : r.i.assignee?.anon ? null : r.i.assignee;
      if (o?.id) m.set(o.id, [o.name, `var(--tl-c${hash(o.id) % PALETTE})`]);
    }
    return [...m.values()].sort((p, q) => p[0].localeCompare(q[0])).slice(0, 12);
  }, [colorBy, shownRows]);

  const scrollToToday = (smooth = true) => { const el = scroller.current; if (el) el.scrollTo({ left: Math.max(0, x(today) - (el.clientWidth - LEFT) / 3), behavior: smooth ? 'smooth' : 'auto' }); };
  // opening and every period change: today a third into the view (when it is in the period)
  useEffect(() => { if (today >= a && today <= b) scrollToToday(false); else if (scroller.current) scroller.current.scrollLeft = 0; }, [a, b, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = (i, bar) => {
    const f = flags.get(i.id);
    const warn = [
      bar.overdue ? tr(`${bar.overdue} Tage über Due Date`, `${bar.overdue} days past due`) : null,
      bar.kind === 'invalid' ? tr('Start liegt nach Due – Termine prüfen', 'Start is after due – check the dates') : null,
      bar.late && !bar.done ? tr(`Unterelemente enden ${bar.late} Tage nach diesem Due`, `Items below end ${bar.late} days after this due date`) : null,
      f.conflict ? tr('Terminkonflikt mit einer Abhängigkeit', 'Date conflict with a dependency') : null,
      bar.kind === 'dueOnly' ? tr('Start fehlt – nur Due gesetzt', 'Start missing – only due is set') : null,
      bar.kind === 'startOnly' ? tr('Due fehlt – nur Start gesetzt', 'Due missing – only start is set') : null,
      bar.kind === 'rollup' ? tr('Keine eigenen Termine – der Balken zeigt die Spanne der Unterelemente', 'No own dates – the bar shows the span of the items below') : null,
      bar.kind === 'none' ? tr('Keine Termine – weder hier noch darunter', 'No dates – neither here nor below') : null,
    ].filter(Boolean);
    return infoCard({
      title: `${i.key} · ${i.summary}`, sub: `${i.type?.name || ''} · ${i.status?.name || ''}`,
      inputs: [
        ['Start', bar.start != null ? fmt.dateLong(isoOf(bar.start)) : '–'],
        ['Due', bar.due != null ? fmt.dateLong(isoOf(bar.due)) : '–'],
        ...(bar.a != null && bar.b != null && bar.a !== bar.b ? [[tr('Dauer', 'Duration'), tr(`${spanDays(bar.a, bar.b)} Tage · ${workdaysBetween(bar.a, bar.b)} Arbeitstage`, `${spanDays(bar.a, bar.b)} days · ${workdaysBetween(bar.a, bar.b)} working days`)]] : []),
        ...(bar.progress != null ? [[tr('Fortschritt', 'Progress'), fmt.pct(bar.progress)]] : []),
        ...(bar.oe ? [['Original Estimate', fmt.h(bar.oe, 1)], ['Time Spent', fmt.h(bar.ts, 1)], ['Remaining', fmt.h(bar.re, 1)]] : []),
        ...(i.team ? [['Team', i.team.name]] : []),
        ...(i.assignee && !i.assignee.anon ? [['Assignee', i.assignee.name]] : []),
      ],
      hint: warn.length ? warn.join(' · ') : tr('Klick öffnet den Vorgang in Jira.', 'Click opens the work item in Jira.'),
    });
  };

  const H = shownRows.length * ROW;
  // week scale: Saturday and Sunday shaded – the stripes repeat every 7 days from the Monday of the first week
  const weekendBg = zoom === 'week' ? {
    backgroundImage: `repeating-linear-gradient(90deg, transparent 0 ${5 * px}px, var(--tl-weekend) ${5 * px}px ${7 * px}px)`,
    backgroundPosition: `${x(mondayOf(a))}px 0`,
  } : null;

  return (
    <div className="tl" ref={wrap} data-timeline>
      <div className="tl-toolbar">
        <label className="tl-field"><span>{tr('Zeitraum', 'Period')}</span>
          <select className="select select-sm" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={tr('Zeitraum', 'Period')} data-tl-period>
            <option value="fit">{tr('Ganzes Projekt', 'Whole project')}</option>
            <option value="month">{tr('Dieser Monat', 'This month')}</option>
            <option value="quarter">{tr('Dieses Quartal', 'This quarter')}</option>
            <option value="next3">{tr('Nächste 3 Monate', 'Next 3 months')}</option>
            <option value="next6">{tr('Nächste 6 Monate', 'Next 6 months')}</option>
            <option value="year">{tr('Dieses Jahr', 'This year')}</option>
            <option value="custom">{tr('Eigener Zeitraum …', 'Custom …')}</option>
          </select>
        </label>
        {period === 'custom' && (
          <span className="row" style={{ gap: 6 }} data-tl-custom>
            <input type="date" className="input input-sm" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label={tr('Von', 'From')} />
            <span className="faint">–</span>
            <input type="date" className="input input-sm" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label={tr('Bis', 'To')} />
          </span>
        )}
        <Segmented size="sm" value={zoomPref} onChange={setZoom} label={tr('Raster', 'Scale')} options={[{ value: 'auto', label: 'Auto' }, { value: 'week', label: tr('Wochen', 'Weeks') }, { value: 'month', label: tr('Monate', 'Months') }, { value: 'quarter', label: tr('Quartale', 'Quarters') }]} />
        <label className="tl-field"><span>{tr('Farbe', 'Colour')}</span>
          <select className="select select-sm" value={colorBy} onChange={(e) => setColorBy(e.target.value)} aria-label={tr('Farbe nach', 'Colour by')}>
            <option value="status">Status</option><option value="team">Team</option><option value="assignee">Assignee</option>
          </select>
        </label>
        <Switch on={showDeps} onChange={setShowDeps} label={tr('Abhängigkeiten', 'Dependencies')} />
        <Switch on={showMs} onChange={setShowMs} label={tr('Meilensteine', 'Milestones')} />
        <span className="grow" />
        {projectRef && <LotseChip skill="timelineBrief" params={{ ref: projectRef }} label={tr('Lotse: Zeitleiste erklären', 'Lotse: explain the timeline')} title={tr('Lotse liest die Zeitleiste: was überfällig ist, was das Ende bestimmt, welche Abhängigkeiten kollidieren – jede Zahl mit Beleg aus Jira', 'Lotse reads the timeline: what is overdue, what decides the end, which dependencies collide – every number with proof from Jira')} />}
        {onExpandAll && <button type="button" className="btn btn-ghost btn-sm" onClick={onExpandAll}><Icon name="chevronDown" size={13} />{tr('Alle aufklappen', 'Expand all')}</button>}
        {onCollapseAll && <button type="button" className="btn btn-ghost btn-sm" onClick={onCollapseAll}><Icon name="chevron" size={13} />{tr('Zuklappen', 'Collapse')}</button>}
        <button type="button" className="btn btn-sm" onClick={() => scrollToToday()} disabled={today < a || today > b}><Icon name="calendar" size={13} />{tr('Heute', 'Today')}</button>
      </div>

      <div className="tl-strip" role="group" aria-label={tr('Schnellfilter', 'Quick filters')} data-tl-strip>
        <span className="tl-strip-total num"><b>{inPeriod}</b> {tr('im Zeitraum', 'in the period')} · {fmt.date(isoOf(a), { day: '2-digit', month: 'short', year: 'numeric' })} – {fmt.date(isoOf(b), { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        {[
          ['overdue', tr('Überfällig', 'Overdue'), 'bad'], ['soon', tr('Endet in 14 Tagen', 'Ends within 14 days'), 'warn'], ['conflict', tr('Terminkonflikte', 'Date conflicts'), 'bad'],
          ['late', tr('Kinder nach Due', 'Children after due'), 'warn'], ['invalid', tr('Start nach Due', 'Start after due'), 'bad'], ['unscheduled', tr('Ohne Termine', 'No dates'), 'muted'],
        ].map(([k, label, tone]) => (
          <button key={k} type="button" className={`tl-chip tone-${tone}`} aria-pressed={quick === k} disabled={!counts[k]} onClick={() => setQuick(quick === k ? null : k)} data-quick={k}>
            {label} <b className="num">{counts[k]}</b>
          </button>
        ))}
        {quick && <button type="button" className="btn btn-ghost btn-xs" onClick={() => setQuick(null)}><Icon name="x" size={12} />{tr('Alle zeigen', 'Show all')}</button>}
      </div>

      <div className="tl-scroll" ref={scroller} style={{ '--tl-left': `${LEFT}px` }}>
        <div className="tl-inner" style={{ width: LEFT + trackW }}>
          {/* the scale: two tiers, today and the milestones */}
          <div className="tl-head">
            <div className="tl-corner">{tr('Vorgang', 'Work item')}</div>
            <div className="tl-scale" style={{ width: trackW }}>
              <div className="tl-tier top">{scale.top.map((t) => (
                <span key={`${t.kind}${t.y}${t.m || ''}${t.q || ''}`} style={{ left: x(t.a), width: (t.b - t.a + 1) * px }}>
                  {t.kind === 'month' ? `${monthLabel(t.y, t.m)} ${t.y}` : t.kind === 'quarter' ? `Q${t.q} ${t.y}` : t.y}
                </span>
              ))}</div>
              <div className="tl-tier bottom">{scale.bottom.map((t) => {
                const w = (t.b - t.a + 1) * px;
                return (
                  <span key={`${t.kind}${t.y || ''}${t.m || ''}${t.q || ''}${t.monday || ''}`} style={{ left: x(t.a), width: w }} className={today >= t.a && today <= t.b ? 'now' : ''}>
                    {t.kind === 'week' ? (w >= 44 ? `${tr('KW', 'W')} ${t.w}` : t.w) : t.kind === 'month' ? (w >= 36 ? monthLabel(t.y, t.m, true) : String(t.m)) : `Q${t.q}`}
                  </span>
                );
              })}</div>
              {today >= a && today <= b && <span className="tl-today-mark" style={{ left: x(today) + px / 2 }} title={tr('Heute', 'Today')} aria-hidden="true" />}
              {showMs && milestones.map((ms) => (
                <span key={ms.id} className="tl-ms-flag" style={{ left: x(ms.d) + px / 2 }} tabIndex={0} {...tip(infoCard({ title: ms.name, sub: tr('Meilenstein', 'Milestone'), inputs: [[tr('Datum', 'Date'), fmt.dateLong(ms.date)]] }))}>
                  <Icon name="milestone" size={11} />
                </span>
              ))}
            </div>
          </div>

          <div className="tl-body" style={{ height: H }}>
            {/* the grid behind the bars */}
            <div className="tl-grid" style={{ left: LEFT, width: trackW, height: H, ...(weekendBg || {}) }} aria-hidden="true">
              {scale.bottom.map((t) => <i key={`g${t.a}`} style={{ left: x(t.a) }} />)}
              {showMs && milestones.map((ms) => <b key={`m${ms.id}`} className="tl-ms-line" style={{ left: x(ms.d) + px / 2 }} />)}
              {today >= a && today <= b && <em className="tl-today" style={{ left: x(today) + px / 2 }} />}
            </div>

            {shownRows.map((r, k) => {
              const { i } = r;
              const bar = bars.get(i.id);
              const f = flags.get(i.id);
              const col = colorOf(i, bar);
              const clipL = bar.a != null && bar.a < a, clipR = bar.b != null && bar.b > b;
              const outside = bar.a != null && (bar.b < a || bar.a > b);
              const left = bar.a != null ? Math.max(0, x(bar.a)) : 0;
              const right = bar.b != null ? Math.min(trackW, x(bar.b + 1)) : 0;
              const w = Math.max(right - left, 3);
              const marker = bar.kind === 'dueOnly' || bar.kind === 'startOnly';
              return (
                <div key={i.id} className={`tl-row ${r.ctx ? 'ctx' : ''} ${k % 2 ? 'odd' : ''}`} style={{ top: k * ROW, height: ROW }} data-tl-row={i.key}>
                  <div className="tl-label" style={{ paddingLeft: 8 + r.depth * 18 }}>
                    {r.hasKids ? (
                      <button type="button" className="twisty" onClick={r.onToggle} aria-expanded={r.open} aria-label={r.open ? tr('Zuklappen', 'Collapse') : tr('Aufklappen', 'Expand')}>
                        <Icon name={r.open ? 'chevronDown' : 'chevron'} size={13} />
                      </button>
                    ) : <span style={{ width: 22, flex: 'none' }} />}
                    <span className="ticon" aria-hidden="true" title={i.type?.name} style={{ background: ROLE_BG[i.role] || 'var(--sunken)' }}>{(i.type?.name || '?')[0]}</span>
                    <button type="button" className="tkey" onClick={() => openIssue(i.key)}>{i.key}</button>
                    <span className="tl-sum" title={i.summary} style={{ fontWeight: i.role === 'rough' ? 580 : i.role === 'structure' ? 520 : 400 }}>{i.summary}</span>
                    {(f.overdue || f.conflict || f.invalid) && <span className="tl-dot bad" role="img" aria-label={tr('Achtung', 'Attention')} />}
                  </div>
                  <div className="tl-track" style={{ width: trackW }}>
                    {bar.kind !== 'none' && !outside && (
                      <>
                        {/* overdue: the slip from due to today */}
                        {bar.overdue > 0 && bar.due >= a - 1 && (
                          <span className="tl-slip" style={{ left: Math.max(0, x(bar.due + 1)), width: Math.max(2, Math.min(trackW, x(today + 1)) - Math.max(0, x(bar.due + 1))) }} aria-hidden="true" />
                        )}
                        {/* children after due: where they end */}
                        {bar.late > 0 && !bar.done && bar.due != null && (
                          <span className="tl-late" style={{ left: Math.max(0, x(bar.due + 1)), width: Math.max(2, Math.min(trackW, x(bar.due + bar.late + 1)) - Math.max(0, x(bar.due + 1))) }} aria-hidden="true" />
                        )}
                        {marker ? (
                          <button type="button" className={`tl-marker ${bar.kind}`} style={{ left: x(bar.a) + px / 2, '--c': col }} onClick={() => openIssue(i.key)} {...tip(card(i, bar))} aria-label={`${i.key}: ${bar.kind === 'dueOnly' ? 'Due' : 'Start'} ${fmt.date(isoOf(bar.a))}`} />
                        ) : (
                          <button type="button" className={`tl-bar ${bar.kind} ${clipL ? 'clip-l' : ''} ${clipR ? 'clip-r' : ''} ${f.conflict ? 'conflict' : ''} ${bar.overdue ? 'overdue' : ''}`}
                            style={{ left, width: w, '--c': col }} onClick={() => openIssue(i.key)} {...tip(card(i, bar))}
                            aria-label={`${i.key}: ${fmt.date(isoOf(bar.a))} – ${fmt.date(isoOf(bar.b))}`}>
                            {bar.progress != null && bar.kind !== 'rollup' && <i className="tl-prog" style={{ width: `${Math.round(bar.progress * 100)}%` }} />}
                            {w > 70 && bar.kind !== 'rollup' && <span className="tl-bar-text">{bar.progress != null ? fmt.pct(bar.progress) : ''}</span>}
                          </button>
                        )}
                        {!marker && w > 0 && right < trackW - 60 && i.assignee && !i.assignee.anon && zoom !== 'quarter' && (
                          <span className="tl-who" style={{ left: right + 6 }}>{i.assignee.name.split(' ')[0]}</span>
                        )}
                      </>
                    )}
                    {outside && (
                      <span className={`tl-off ${bar.b < a ? 'l' : 'r'}`} {...tip(card(i, bar))} tabIndex={0}>{bar.b < a ? '◂' : '▸'} {fmt.date(isoOf(bar.b < a ? bar.b : bar.a))}</span>
                    )}
                    {bar.kind === 'none' && <span className="tl-none" style={{ left: 8 }}>{tr('keine Termine', 'no dates')}</span>}
                  </div>
                </div>
              );
            })}

            {/* dependencies: from the end of the prerequisite to the start of what waits for it */}
            {showDeps && (
              <svg className="tl-deps" style={{ left: LEFT, width: trackW, height: H }} aria-hidden="true">
                <defs>
                  <marker id="tl-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z" fill="var(--ink-3)" /></marker>
                  <marker id="tl-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z" fill="var(--bad)" /></marker>
                </defs>
                {(deps?.list || []).map((d) => {
                  const p1 = rowIdx.get(d.pre), p2 = rowIdx.get(d.dep);
                  if (p1 == null || p2 == null) return null;
                  const b1 = bars.get(d.pre), b2 = bars.get(d.dep);
                  if (b1?.b == null || b2?.a == null) return null;
                  const x1 = Math.min(trackW, Math.max(0, x(b1.b + 1))), y1 = p1 * ROW + ROW / 2;
                  const x2 = Math.min(trackW, Math.max(0, x(b2.a))), y2 = p2 * ROW + ROW / 2;
                  const bend = Math.max(14, Math.min(60, Math.abs(x2 - x1) / 2));
                  return <path key={d.id} d={`M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2 - 2} ${y2}`} className={d.conflict ? 'bad' : ''} markerEnd={`url(#${d.conflict ? 'tl-arrow-bad' : 'tl-arrow'})`} />;
                })}
              </svg>
            )}
          </div>
          {!shownRows.length && <div className="muted" style={{ padding: 24, textAlign: 'center' }}>{tr('Keine Vorgänge in dieser Auswahl.', 'No work items in this selection.')}</div>}
        </div>
      </div>

      <div className="tl-legend" aria-label={tr('Legende', 'Legend')}>
        {legendItems.map(([label, c]) => <span key={label}><i style={{ background: c }} />{label}</span>)}
        <span><i className="lg-prog" />{tr('Fortschritt', 'Progress')}</span>
        <span><i className="lg-roll" />{tr('Spanne der Unterelemente', 'Span of the items below')}</span>
        <span><i className="lg-slip" />{tr('Verzug bis heute', 'Slip until today')}</span>
        <span><i className="lg-marker" />{tr('nur ein Datum', 'one date only')}</span>
        {showDeps && <span><i className="lg-dep" />{tr('Abhängigkeit (rot = Konflikt)', 'Dependency (red = conflict)')}</span>}
        {showMs && <span><Icon name="milestone" size={11} />{tr('Meilenstein', 'Milestone')}</span>}
        <span><i className="lg-today" />{tr('Heute', 'Today')}{zoom === 'week' ? ` · ${tr('KW', 'W')} ${isoWeek(today)}` : ''}</span>
      </div>
    </div>
  );
}
