// Lotse's visuals: one <Visual> for every story.visual.kind. The classic charts come from components/charts.jsx; the
// four Lotse-only kinds (timeline, gantt, compare, waterline) are small HTML/SVG pieces here. Every visual is a <figure>
// with an accessible name, a picture hidden from screen readers and a visually hidden table with the same numbers.
// Motion: transform/opacity only (scaleX bars, fades), enter animations only.
import { motion } from 'framer-motion';
import { enter, delayOf, tween } from '../../lib/motion.js';
import { utilTone } from '@shared/kpis.js';
import { Columns, Donut, HBars, Heat, Line } from '../charts.jsx';
import { fmt, tr } from '../../lib/i18n.js';
import { useTip, infoCard } from '../ui.jsx';

export const TONE = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', info: 'var(--info)', accent: 'var(--accent)', ink: 'var(--ink)', muted: 'var(--line-strong)' };
export const VISUAL_KINDS = ['bars', 'columns', 'line', 'donut', 'heat', 'timeline', 'compare', 'waterline', 'gantt'];

// Units of the Story format (shared/lotse/story.js): 'h' · '%' percent POINTS (112 = 112 %) · 'd' days · 'n' a count ·
// 'eur' · in compare rows also 'date' (ISO); evidence values may also be a 'quarter' ('2026-Q4').
const eur = (v) => (v == null || !Number.isFinite(v) ? '–' : `${fmt.n(v)} €`);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const fmtUnit = (unit) => ({
  h: (v) => fmt.h(v, Math.abs(v) < 10 ? 1 : 0),
  '%': (v) => (isNum(v) ? fmt.pct(v / 100) : '–'),
  d: (v) => (!isNum(v) ? '–' : tr(`${fmt.n(v)} ${Math.abs(v) === 1 ? 'Tag' : 'Tage'}`, `${fmt.n(v)} ${Math.abs(v) === 1 ? 'day' : 'days'}`)),
  n: (v) => fmt.n(v),
  eur,
  date: (v) => (typeof v === 'string' ? fmt.dateLong(v) : '–'),
  quarter: (v) => (typeof v === 'string' ? fmt.quarter(v) : '–'),
}[unit] || ((v) => (isNum(v) ? fmt.n(v, 1) : v == null ? '–' : String(v))));
// [number, unit] for big KPI figures: "46" + "%", "140" + "h", "12" + "Tage".
export function splitUnit(unit, v) {
  if (v == null || !Number.isFinite(v)) return ['–', ''];
  if (unit === '%') return [fmt.n(v), '%'];
  if (unit === 'h') return [fmt.n(v, Math.abs(v) < 10 ? 1 : 0), 'h'];
  if (unit === 'd') return [fmt.n(v), tr(Math.abs(v) === 1 ? 'Tag' : 'Tage', Math.abs(v) === 1 ? 'day' : 'days')];
  if (unit === 'eur') return [fmt.n(v), '€'];
  return [fmt.n(v, Number.isInteger(v) ? 0 : 1), ''];
}
export const signed = (unit, d) => (d == null || !Number.isFinite(d) || d === 0 ? null : `${d > 0 ? '+' : '−'}${unit === '%' ? tr(`${fmt.n(Math.abs(d))} Pkt.`, `${fmt.n(Math.abs(d))} pts`) : fmtUnit(unit)(Math.abs(d))}`);
// an evidence value as written: a number in its unit, an ISO date or a quarter
export const evValue = (e) => (e?.value == null ? null : typeof e.value === 'number' ? fmtUnit(e.unit || 'n')(e.value) : e.unit === 'quarter' || /^\d{4}-Q[1-4]$/.test(e.value) ? fmt.quarter(e.value) : /^\d{4}-\d{2}-\d{2}$/.test(e.value) ? fmt.date(e.value) : String(e.value));
export const kindName = (k) => ({
  bars: tr('Balken', 'Bars'), columns: tr('Säulen', 'Columns'), line: tr('Verlauf', 'Trend'), donut: tr('Anteile', 'Shares'), heat: tr('Heatmap', 'Heatmap'),
  timeline: tr('Zeitleiste', 'Timeline'), compare: tr('Vorher / nachher', 'Before / after'), waterline: tr('Wasserlinie', 'Waterline'), gantt: tr('Zeitplan', 'Schedule'),
}[k] || k);

function SrTable({ head, rows }) {
  return (
    <table className="sr">
      <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h || tr('Eintrag', 'Item')}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}
const day = (s) => (s ? Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`) : NaN);
const span = (from, to) => { const a = day(from), b = day(to); return { a, b, pct: (s) => Math.max(0, Math.min(100, ((day(s) - a) / (b - a || 1)) * 100)) }; };
// month ticks between two dates (at most ~7, so labels never collide)
function monthTicks(a, b) {
  const out = [];
  const d = new Date(a); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  while (d.getTime() < b) { out.push(d.toISOString().slice(0, 10)); d.setUTCMonth(d.getUTCMonth() + 1); }
  const step = Math.ceil(out.length / 7) || 1;
  return out.filter((_, i) => i % step === 0);
}

// ---------- timeline: dated events on one axis, numbered, with the list below ----------
export function Timeline({ data, label, onEvidence }) {
  const tip = useTip();
  const ev = [...(data.events || data.items || [])].filter((e) => e?.date).sort((x, y) => day(x.date) - day(y.date));
  if (!ev.length) return null;
  const from = data.from || ev[0].date, to = data.to || ev.at(-1).date;
  const s = span(from, to);
  const today = data.today && day(data.today) >= s.a && day(data.today) <= s.b ? data.today : null;
  return (
    <figure className="chart lv-timeline" aria-label={label}>
      <div className="lv-tl-axis" aria-hidden="true">
        <span className="lv-tl-line" />
        {monthTicks(s.a, s.b).filter((t) => !today || Math.abs(s.pct(t) - s.pct(today)) > 7).map((t) => <span key={t} className="lv-tick" style={{ left: `${s.pct(t)}%` }}><i />{fmt.date(t, { month: 'short' })}</span>)}
        {today && <span className="lv-today" style={{ left: `${s.pct(today)}%` }}><b>{tr('Heute', 'Today')}</b></span>}
        {ev.map((e, i) => (
          <motion.span key={i} className="lv-tl-dot" style={{ left: `${s.pct(e.date)}%`, background: TONE[e.tone] || 'var(--ink)' }}
            {...enter(i, { y: 0, scale: 0.4, d: 'gentle', delay: 0.08 })}>{i + 1}</motion.span>
        ))}
      </div>
      <ol className="lv-tl-list">
        {ev.map((e, i) => (
          <li key={i}>
            <span className="lv-tl-n" style={{ background: TONE[e.tone] || 'var(--ink)' }} aria-hidden="true">{i + 1}</span>
            <span className="lv-tl-date num">{fmt.date(e.date)}</span>
            {e.key || e.ref ? <button type="button" className="linkbtn" onClick={() => onEvidence?.(e)} {...tip(infoCard({ title: e.label, sub: fmt.dateLong(e.date), hint: e.key ? tr(`Klick: ${e.key} öffnen`, `Click: open ${e.key}`) : tr('Klick: öffnen', 'Click: open') }))}>{e.label}</button> : <span>{e.label}</span>}
          </li>
        ))}
      </ol>
    </figure>
  );
}

// ---------- gantt: bars from start to end against today and the due date ----------
export function Gantt({ data, label, onEvidence }) {
  const tip = useTip();
  const rows = (data.rows || data.items || []).filter((r) => r?.start || r?.end);
  if (!rows.length) return null;
  const dates = rows.flatMap((r) => [r.start, r.end, r.before?.start, r.before?.end]).filter(Boolean).map(day);
  const from = data.from || new Date(Math.min(...dates)).toISOString(), to = data.to || new Date(Math.max(...dates, day(data.due) || 0)).toISOString();
  const s = span(from, to);
  const inside = (d) => d && day(d) >= s.a && day(d) <= s.b;
  const marks = (
    <>
      {inside(data.today) && <span className="lv-g-today" style={{ left: `${s.pct(data.today)}%` }} />}
      {inside(data.due) && <span className="lv-g-due" style={{ left: `${s.pct(data.due)}%` }} />}
    </>
  );
  return (
    <figure className="chart lv-gantt" aria-label={label}>
      <div className="lv-g-head" aria-hidden="true">
        <span />
        <div className="lv-g-ticks">
          {monthTicks(s.a, s.b).filter((t) => [data.today, data.due].every((x) => !inside(x) || Math.abs(s.pct(t) - s.pct(x)) > 7)).map((t) => <span key={t} style={{ left: `${s.pct(t)}%` }}>{fmt.date(t, { month: 'short' })}</span>)}
          {inside(data.today) && <b className="lv-g-flag today" style={{ left: `${s.pct(data.today)}%` }}>{tr('Heute', 'Today')}</b>}
          {inside(data.due) && <b className="lv-g-flag due" style={{ left: `${s.pct(data.due)}%` }}>Due</b>}
        </div>
      </div>
      {rows.map((r, i) => {
        const a = s.pct(r.start || from), b = s.pct(r.end || to);
        const late = data.due && r.end && day(r.end) > day(data.due);
        const tone = TONE[r.tone] || (late ? 'var(--bad)' : 'var(--ink)');
        return (
          <div key={i} className="lv-g-row">
            {r.key || r.ref
              ? <button type="button" className="lv-g-label linkbtn" title={r.label} onClick={() => onEvidence?.(r)}>{r.label}</button>
              : <span className="lv-g-label" title={r.label}>{r.label}</span>}
            <div className="lv-g-track" aria-hidden="true" {...tip(infoCard({ title: r.label, sub: r.key, calc: `${fmt.date(r.start)} – ${fmt.date(r.end)}`, inputs: [[tr('Start', 'Start'), fmt.dateLong(r.start)], [tr('Ende', 'End'), fmt.dateLong(r.end)], ...(r.before ? [[tr('Vorher', 'Before'), `${fmt.date(r.before.start)} – ${fmt.date(r.before.end)}`]] : []), ...(r.progress != null ? [[tr('Fortschritt', 'Progress'), fmt.pct(r.progress)]] : []), ...(data.due ? [[tr('Projekttermin', 'Project date'), fmt.dateLong(data.due)]] : [])], hint: r.before ? tr('Gestrichelt: wo der Balken vorher lag', 'Dashed: where the bar was before') : late ? tr('Endet nach dem Termin', 'Ends after the date') : null }))}>
              {marks}
              {r.before && <span className="lv-g-ghost" style={{ left: `${s.pct(r.before.start)}%`, width: `${Math.max(1.5, s.pct(r.before.end) - s.pct(r.before.start))}%` }} />}
              <motion.span className="lv-g-bar" style={{ left: `${a}%`, width: `${Math.max(1.5, b - a)}%`, background: `color-mix(in srgb, ${tone} 22%, var(--surface))`, borderColor: tone, transformOrigin: 'left center' }}
                initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} transition={tween('gentle', { delay: delayOf(i) + 0.05 })}>
                {r.progress > 0 && <span className="lv-g-prog" style={{ width: `${Math.min(100, r.progress * 100)}%`, background: tone }} />}
              </motion.span>
            </div>
          </div>
        );
      })}
      <SrTable head={[tr('Abschnitt', 'Item'), tr('Start', 'Start'), tr('Ende', 'End'), tr('Vorher', 'Before')]} rows={rows.map((r) => [r.label, fmt.dateLong(r.start), fmt.dateLong(r.end), r.before ? `${fmt.dateLong(r.before.start)} – ${fmt.dateLong(r.before.end)}` : '–'])} />
    </figure>
  );
}

// ---------- compare: two sides next to each other (two projects / teams, or before / after of a what-if) ----------
// data: { a: { label }, b: { label }, rows: [{ label, unit, a, b, better?: 'lower'|'higher', tone? }] }
export function Compare({ data, label }) {
  const rows = data.rows || [];
  if (!rows.length) return null;
  const A = data.a?.label || tr('Heute', 'Today'), B = data.b?.label || tr('Szenario', 'Scenario');
  const diffOf = (r) => {
    if (r.a == null || r.b == null) return null;
    return r.unit === 'date' ? Math.round((day(r.b) - day(r.a)) / 864e5) : r.b - r.a;
  };
  const dUnit = (r) => (r.unit === 'date' ? 'd' : r.unit);
  return (
    <figure className="chart lv-compare" aria-label={label}>
      <div className="lv-c-head" aria-hidden="true"><span /><span className="lv-c-col">{A}</span><span className="lv-c-col after">{B}</span><span /></div>
      <div aria-hidden="true">
        {rows.map((r, i) => {
          const f = fmtUnit(r.unit);
          const d = diffOf(r);
          const good = d == null || d === 0 || !r.better ? null : r.better === 'lower' ? d < 0 : d > 0;
          const tone = r.tone ? TONE[r.tone] : good == null ? null : good ? 'var(--ok)' : 'var(--bad)';
          const bars = r.unit !== 'date' && isNum(r.a ?? 0) && isNum(r.b ?? 0);
          const max = Math.max(Math.abs(r.a || 0), Math.abs(r.b || 0), 1e-9);
          return (
            <motion.div key={i} className="lv-c-row" {...enter(i, { y: 6, d: 'gentle', delay: 0.04 })}>
              <span className="lv-c-label">{r.label}</span>
              <span className="lv-c-cell">
                <b className="num">{f(r.a)}</b>
                {bars && <span className="lv-c-bar"><motion.i style={{ width: `${(Math.abs(r.a || 0) / max) * 100}%`, background: 'var(--line-strong)', transformOrigin: 'left center' }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={tween('gentle')} /></span>}
              </span>
              <span className="lv-c-cell after">
                <b className="num" style={{ color: tone || undefined }}>{f(r.b)}</b>
                {bars && <span className="lv-c-bar"><motion.i style={{ width: `${(Math.abs(r.b || 0) / max) * 100}%`, background: tone || 'var(--ink)', transformOrigin: 'left center' }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={tween('gentle', { delay: delayOf(i) + 0.25 })} /></span>}
              </span>
              <span className={`lv-c-delta ${good == null ? '' : good ? 'ok' : 'bad'}`}>{d == null ? '–' : d ? signed(dUnit(r), d) : '±0'}</span>
            </motion.div>
          );
        })}
      </div>
      <SrTable head={[tr('Kennzahl', 'Measure'), A, B, tr('Unterschied', 'Difference')]} rows={rows.map((r) => { const f = fmtUnit(r.unit); const d = diffOf(r); return [r.label, f(r.a), f(r.b), d == null ? '–' : signed(dUnit(r), d) || '±0']; })} />
    </figure>
  );
}

// ---------- waterline: demand in rank order, summed up, against one capacity line ----------
// data: { unit: 'h', capacity: number|null, support?, team?, quarter?, waterRank, items: [{ label, rank, ref?, key?, value, cum, status }] }
// capacity null = several teams: no single line, the status per project says it.
const W_TONE = { ok: 'var(--ok)', partial: 'var(--warn)', no: 'var(--bad)' };
export function Waterline({ data, label, onEvidence }) {
  const tip = useTip();
  const items = [...(data.items || [])].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  if (!items.length) return null;
  const f = fmtUnit('h');
  const cap = isNum(data.capacity) ? data.capacity : null;
  let acc = 0;
  const rows = items.map((x) => { const v = x.value || 0; const end = isNum(x.cum) ? x.cum : acc + v; const start = Math.max(0, end - v); acc = end; return { ...x, v, start, end, status: x.status || (cap == null || end <= cap ? 'ok' : start < cap ? 'partial' : 'no') }; });
  const total = Math.max(acc, cap || 0, 1) * 1.04;
  const pct = (v) => (v / total) * 100;
  const water = data.waterRank ?? rows.find((r) => r.status !== 'ok')?.rank ?? null;
  const statusWord = (s) => ({ ok: tr('besetzbar', 'staffable'), partial: tr('teilweise besetzbar', 'partly staffable'), no: tr('nicht besetzbar', 'not staffable') }[s] || '–');
  const where = [data.team ? `${tr('Team', 'Team')} ${data.team}` : null, data.quarter ? fmt.quarter(data.quarter) : null].filter(Boolean).join(' · ');
  return (
    <figure className="chart lv-water" aria-label={label}>
      <div className="lv-w-head" aria-hidden="true">
        <span />
        <div className="lv-w-scale">
          {cap != null ? <b className="lv-w-flag" style={{ left: `${pct(cap)}%` }}>{tr('Kapazität', 'Capacity')} {f(cap)}{where ? ` · ${where}` : ''}</b>
            : where ? <b className="lv-w-flag left">{where}</b> : null}
        </div>
      </div>
      {rows.map((r, i) => {
        const inPart = cap == null ? r.end - r.start : Math.max(0, Math.min(r.end, cap) - r.start);
        const outPart = cap == null ? 0 : Math.max(0, r.end - Math.max(r.start, cap));
        const len = r.end - r.start || 1;
        return (
          <div key={r.ref || r.key || i} className={`lv-w-row ${r.status}`}>
            <span className="lv-w-rank num" aria-hidden="true">{r.rank}</span>
            {r.ref || r.key ? <button type="button" className="lv-w-label linkbtn" title={r.label} onClick={() => onEvidence?.(r)}>{r.label}</button> : <span className="lv-w-label" title={r.label}>{r.label}</span>}
            <div className="lv-w-track" aria-hidden="true" {...tip(infoCard({ title: `${r.rank} · ${r.label}`, calc: `${f(r.start)} + ${f(r.v)} = ${f(r.end)}`, inputs: [[tr('Bedarf', 'Demand'), f(r.v)], [tr('Aufsummiert bis hier', 'Summed up to here'), f(r.end)], ...(cap != null ? [[tr('Kapazität', 'Capacity'), f(cap)]] : []), ...(isNum(data.support) ? [[tr('davon Support vorab', 'of which support first'), f(data.support)]] : [])], hint: statusWord(r.status) }))}>
              {cap != null && <span className="lv-w-cap" style={{ left: `${pct(cap)}%` }} />}
              <motion.span className="lv-w-bar" style={{ left: `${pct(r.start)}%`, width: `${Math.max(0.6, pct(r.end - r.start))}%`, transformOrigin: 'left center' }}
                initial={{ scaleX: 0, opacity: 0 }} animate={{ scaleX: 1, opacity: 1 }} transition={tween('gentle', { delay: delayOf(i) + 0.05 })}>
                {inPart > 0 && <i style={{ width: `${(inPart / len) * 100}%`, background: cap == null ? W_TONE[r.status] : 'var(--ok)' }} />}
                {outPart > 0 && <i style={{ width: `${(outPart / len) * 100}%`, background: 'var(--bad)' }} />}
              </motion.span>
            </div>
            <span className="lv-w-need num faint" aria-hidden="true">{f(r.v)}</span>
          </div>
        );
      })}
      <div className="chart-legend" aria-hidden="true">
        <span><i style={{ background: 'var(--ok)' }} />{tr('besetzbar', 'staffable')}</span>
        {cap == null && <span><i style={{ background: 'var(--warn)' }} />{tr('teilweise', 'partly')}</span>}
        <span><i style={{ background: 'var(--bad)' }} />{tr('unter der Wasserlinie', 'below the waterline')}</span>
        {water != null && <span className="faint">{tr(`ab Rang ${water} reicht die Kapazität nicht`, `from rank ${water} on capacity runs out`)}</span>}
      </div>
      <SrTable head={[tr('Rang', 'Rank'), tr('Projekt', 'Project'), tr('Bedarf', 'Demand'), tr('Aufsummiert', 'Cumulative'), tr('Besetzbar', 'Staffable')]} rows={rows.map((r) => [r.rank, r.label, f(r.v), f(r.end), statusWord(r.status)])} />
    </figure>
  );
}

// a reference value under bars/columns (the plan, the target) – written out, never guessed into the picture
function Target({ value }) {
  return <p className="lv-target"><i aria-hidden="true" />{tr('Referenz', 'Reference')}: <b className="num">{value}</b></p>;
}

// ---------- the dispatcher ----------
// onEvidence({ key?, ref?, label }) – a bar, row or event that names a work item, project or team was clicked.
export function Visual({ visual, onEvidence, large = false }) {
  if (!visual?.kind) return null;
  const d = visual.data || {};
  const label = visual.caption || kindName(visual.kind);
  const f = fmtUnit(d.unit);
  const H = large ? 1.5 : 1;
  let body = null;
  switch (visual.kind) {
    case 'bars': body = d.items?.length ? <>
      <HBars label={label} items={d.items.map((x) => ({ ...x, tone: x.tone || 'ink', label: x.rank != null ? `${x.rank} · ${x.label}` : x.label }))} format={f} max={Math.max(d.max || 0, d.target || 0, ...d.items.map((x) => x.value || 0)) || undefined}
        onPick={onEvidence && d.items.some((x) => x.key || x.ref) ? (it) => (it.key || it.ref) && onEvidence(it) : undefined} />
      {isNum(d.target) && <Target value={f(d.target)} />}
    </> : null; break;
    case 'columns': body = d.labels?.length ? <>
      <Columns label={label} labels={d.labels} series={(d.series || []).map((s) => ({ ...s, values: s.values.map((v) => v ?? 0), color: TONE[s.tone] }))} format={f} height={160 * H} />
      {isNum(d.target) && <Target value={f(d.target)} />}
    </> : null; break;
    case 'line': body = d.labels?.length ? <Line label={label} labels={d.labels} series={(d.series || []).map((s) => ({ ...s, color: TONE[s.tone] }))} target={d.target} format={f} height={140 * H} /> : null; break;
    case 'donut': { const parts = d.items || []; const total = isNum(d.total) ? d.total : parts.reduce((a, p) => a + (p.value || 0), 0); body = parts.length && total > 0 ? <Donut label={label} parts={parts} format={f} size={large ? 200 : 140} center={f(total)} /> : null; break; }
    // heat values in the story's unit; utilisation colours only for percent points (100 = full)
    case 'heat': body = d.rows?.length ? <Heat label={label} rows={d.rows} cols={d.cols || []} format={f} tone={d.unit === '%' ? (v) => (v == null ? 'none' : utilTone(v / 100) || 'none') : () => 'none'} /> : null; break;
    case 'timeline': body = <Timeline data={d} label={label} onEvidence={onEvidence} />; break;
    case 'gantt': body = <Gantt data={d} label={label} onEvidence={onEvidence} />; break;
    case 'compare': body = <Compare data={d} label={label} />; break;
    case 'waterline': body = <Waterline data={d} label={label} onEvidence={onEvidence} />; break;
    default: body = null;
  }
  return (
    <motion.div className={`lv-visual lv-${visual.kind}`} {...enter(0, { y: 6, d: 'gentle' })}>
      {body || <p className="lv-novis faint">{tr('Für diese Antwort gibt es noch keine Daten zum Zeichnen.', 'There is no data to draw for this answer yet.')}</p>}
      {visual.caption && <p className="lv-caption">{visual.caption}</p>}
    </motion.div>
  );
}
