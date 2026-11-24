import { useId } from 'react';
import { utilTone } from '@shared/kpis.js';
import { motion } from 'framer-motion';
import { fmt, tr } from '../lib/i18n.js';
import { useTip, infoCard } from './ui.jsx';
import { grow, enter, fadeIn, tween, delayOf } from '../lib/motion.js';

// Small, themed SVG charts used by Support and the Ask canvas. Every chart is a <figure> with an
// accessible name and a visually hidden data table, so screen readers get the numbers too.
export const PALETTE = ['var(--ink)', 'var(--accent)', '#8F8B82', '#C98A06', '#3D5BA6', '#2F7D57', '#B05B8C', '#5E8C9A'];
const TONE = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', info: 'var(--info)', accent: 'var(--accent)', ink: 'var(--ink)', muted: 'var(--line-strong)' };

function SrTable({ head, rows }) {
  return (
    <table className="sr">
      <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h || tr('Eintrag', 'Item')}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

// Every value in a chart explains itself on hover: value, share of the total, rank, distance to the average.
// A caller can pass its own explanation per item ({ card: { text, calc, inputs, items } }), which wins.
const statCard = ({ title, sub, value, values, format, text, extra = [], hint }) => {
  const nums = values.filter((v) => v != null && Number.isFinite(v));
  const total = nums.reduce((a, b) => a + b, 0), avg = nums.length ? total / nums.length : 0;
  const rank = value == null ? null : nums.filter((v) => v > value).length + 1;
  const share = total > 0 && value != null ? value / total : null;
  const diff = value == null ? null : value - avg;
  return infoCard({
    title, sub, text,
    calc: value == null ? tr('Kein Wert', 'No value') : [format(value), share != null && nums.length > 1 ? tr(`= ${fmt.pct(share)} von ${format(total)}`, `= ${fmt.pct(share)} of ${format(total)}`) : '', rank && nums.length > 1 ? tr(`· Rang ${rank} von ${nums.length}`, `· rank ${rank} of ${nums.length}`) : ''].filter(Boolean).join(' '),
    inputs: [
      [tr('Wert', 'Value'), value == null ? '–' : format(value)],
      ...(nums.length > 1 ? [[tr('Summe aller', 'Total of all'), format(total)], [tr('Durchschnitt', 'Average'), format(avg)], [tr('Abstand zum Durchschnitt', 'Distance to the average'), diff == null ? '–' : `${diff >= 0 ? '+' : '−'}${format(Math.abs(diff))}`]] : []),
      ...extra,
    ],
    hint,
  });
};
const cardOf = (it, fallback) => (it?.card ? infoCard({ title: it.label, ...it.card }) : fallback());

// Horizontal bars: [{ label, value, tone?, sub?, card? }]
export function HBars({ items, format = (v) => fmt.n(v), label, onPick, max: maxIn, large }) {
  const tip = useTip();
  const max = maxIn || Math.max(1, ...items.map((i) => i.value || 0));
  return (
    <figure className="chart" aria-label={label}>
      <div className="hbars" style={{ gap: large ? 10 : 7 }}>
        {items.map((it, i) => (
          <button key={it.label + i} type="button" className={`hbar ${onPick ? "" : "static"}`} aria-disabled={!onPick} onClick={() => onPick?.(it)} {...tip(cardOf(it, () => statCard({ title: it.label, sub: it.sub, value: it.value, values: items.map((x) => x.value), format, hint: onPick ? tr('Klick: Details öffnen', 'Click: open details') : null })))}>
            <span className="hbar-label" title={it.label}>{it.label}</span>
            <span className="hbar-track"><motion.span className="hbar-fill" {...grow('x', i)} style={{ width: `${((it.value || 0) / max) * 100}%`, background: TONE[it.tone] || it.color || 'var(--ink)' }} /></span>
            <span className="hbar-val num">{format(it.value)}</span>
          </button>
        ))}
      </div>
      <SrTable head={[tr('Eintrag', 'Item'), label || tr('Wert', 'Value')]} rows={items.map((i) => [i.label, format(i.value)])} />
    </figure>
  );
}

// Grouped columns: labels = x axis, series = [{ name, values, color }]
export function Columns({ labels, series, format = (v) => fmt.n(v), label, height = 170 }) {
  const tip = useTip();
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const W = 100 / labels.length;
  return (
    <figure className="chart" aria-label={label}>
      <div className="cols" style={{ height }}>
        {labels.map((l, i) => (
          <div key={l + i} className="col-group" style={{ width: `${W}%` }} tabIndex={0} {...tip(infoCard({ title: l, sub: label,
            calc: series.map((s) => `${s.name}: ${format(s.values[i])}`).join(' · '),
            inputs: series.flatMap((s) => { const prev = i > 0 ? s.values[i - 1] : null; const d = prev == null || s.values[i] == null ? null : s.values[i] - prev; const sum = s.values.reduce((a, v) => a + (v || 0), 0); return [[s.name, format(s.values[i])], ...(d != null ? [[tr(`${s.name}: zur Spalte davor`, `${s.name}: vs. the column before`), `${d >= 0 ? '+' : '−'}${format(Math.abs(d))}`]] : []), ...(sum > 0 && s.values[i] != null ? [[tr(`${s.name}: Anteil an der Summe`, `${s.name}: share of the total`), fmt.pct(s.values[i] / sum)]] : [])]; }) }))}>
            <div className="col-bars">
              {series.map((s, k) => <motion.span key={s.name} className="col-bar" {...grow('y', i + k)} style={{ height: `${(s.values[i] / max) * 100}%`, background: s.color || PALETTE[k] }} />)}
            </div>
            <span className="col-label">{l}</span>
          </div>
        ))}
      </div>
      <div className="chart-legend">{series.map((s, k) => <span key={s.name}><i style={{ background: s.color || PALETTE[k] }} />{s.name}</span>)}</div>
      <SrTable head={['', ...series.map((s) => s.name)]} rows={labels.map((l, i) => [l, ...series.map((s) => format(s.values[i]))])} />
    </figure>
  );
}

// Donut: parts = [{ label, value, color? | tone? }]
export function Donut({ parts, label, center, format = (v) => fmt.n(v), size = 150, onPick }) {
  const tip = useTip();
  const total = parts.reduce((a, p) => a + (p.value || 0), 0) || 1;
  const R = 52, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <figure className="chart donut-wrap" aria-label={label}>
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-hidden="true">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--sunken)" strokeWidth="18" />
        {parts.map((p, i) => {
          const len = ((p.value || 0) / total) * C;
          const el = (
            <motion.circle key={p.label} cx="70" cy="70" r={R} fill="none" stroke={TONE[p.tone] || p.color || PALETTE[i % PALETTE.length]} strokeWidth="18" strokeDasharray={`${len} ${C - len}`}
              initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: -acc }} transition={tween('gentle', { delay: delayOf(i, 0.06) })} transform="rotate(-90 70 70)"
              style={{ cursor: onPick ? 'pointer' : undefined }} onClick={() => onPick?.(p)} {...tip(cardOf(p, () => statCard({ title: p.label, sub: label, value: p.value || 0, values: parts.map((x) => x.value || 0), format })))} />
          );
          acc += len;
          return el;
        })}
        {center != null && <text x="70" y="76" textAnchor="middle" className="donut-center">{center}</text>}
      </svg>
      <div className="chart-legend col">
        {/* the legend explains itself like the ring: same card on hover and focus */}
        {parts.map((p, i) => <span key={p.label} tabIndex={0} {...tip(cardOf(p, () => statCard({ title: p.label, sub: label, value: p.value || 0, values: parts.map((x) => x.value || 0), format })))}><i style={{ background: TONE[p.tone] || p.color || PALETTE[i % PALETTE.length] }} />{p.label}<b className="num">{format(p.value)}</b></span>)}
      </div>
      <SrTable head={[tr('Anteil', 'Share'), label || tr('Wert', 'Value')]} rows={parts.map((p) => [p.label, format(p.value)])} />
    </figure>
  );
}

// Line chart: labels on x, series = [{ name, values (null = gap), color }], optional target line (0..1 domain when pct)
export function Line({ labels, series, label, format = (v) => fmt.n(v), height = 150, target, domain }) {
  const id = useId();
  const tip = useTip();
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  const [lo, hi] = domain || [Math.min(0, ...all), Math.max(1, ...all, target ?? 0)];
  const x = (i) => (labels.length <= 1 ? 50 : 4 + (i / (labels.length - 1)) * 92);
  const y = (v) => 92 - ((v - lo) / (hi - lo || 1)) * 84;
  return (
    <figure className="chart" aria-label={label}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height }} aria-hidden="true">
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="100" y1={8 + g * 84} y2={8 + g * 84} stroke="var(--line-soft)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />)}
        {target != null && <line x1="0" x2="100" y1={y(target)} y2={y(target)} stroke="var(--accent)" strokeDasharray="2 2" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        {series.flatMap((s, k) => {
          // Weeks without a value break the line instead of bridging it.
          const runs = [[]];
          s.values.forEach((v, i) => { if (v == null) { if (runs.at(-1).length) runs.push([]); } else runs.at(-1).push(`${x(i)},${y(v)}`); });
          return runs.filter((r) => r.length).map((r, j) => (r.length === 1
            ? <line key={`${s.name}${id}${j}`} x1={+r[0].split(',')[0] - 0.6} x2={+r[0].split(',')[0] + 0.6} y1={r[0].split(',')[1]} y2={r[0].split(',')[1]} stroke={s.color || PALETTE[k]} strokeWidth="5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            : <motion.polyline key={`${s.name}${id}${j}`} points={r.join(' ')} fill="none" stroke={s.color || PALETTE[k]} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" {...fadeIn('gentle')} />)); // a fade, not pathLength: with a non-scaling stroke the dash pattern left gaps in the line
        })}
      </svg>
      {/* one invisible hover column per point: every value with its change to the point before */}
      <div className="line-hover" style={{ height, marginTop: -height }}>
        {labels.map((l, i) => <span key={l + i} tabIndex={0} {...tip(infoCard({ title: l, sub: label,
          calc: series.map((s) => `${s.name}: ${s.values[i] == null ? '–' : format(s.values[i])}`).join(' · '),
          inputs: [...series.flatMap((s) => { const v = s.values[i], pv = i > 0 ? s.values[i - 1] : null; return [[s.name, v == null ? '–' : format(v)], ...(v != null && pv != null ? [[tr(`${s.name}: zum Punkt davor`, `${s.name}: vs. the point before`), `${v - pv >= 0 ? '+' : '−'}${format(Math.abs(v - pv))}`]] : [])]; }), ...(target != null ? [[tr('Ziel', 'Target'), format(target)]] : [])] }))} />)}
      </div>
      <div className="line-labels">{labels.map((l, i) => <span key={l + i}>{l}</span>)}</div>
      {series.length > 1 && <div className="chart-legend">{series.map((s, k) => <span key={s.name}><i style={{ background: s.color || PALETTE[k] }} />{s.name}</span>)}</div>}
      <SrTable head={['', ...series.map((s) => s.name)]} rows={labels.map((l, i) => [l, ...series.map((s) => (s.values[i] == null ? '–' : format(s.values[i])))])} />
    </figure>
  );
}

// Heatmap: rows = [{ label, values }] (0..n, colour by thresholds), cols = labels
export function Heat({ rows, cols, label, format = (v) => fmt.pct(v), tone = (v) => utilTone(v) || 'none' }) {
  const tip = useTip();
  return (
    <figure className="chart" aria-label={label}>
      <div className="heat" style={{ gridTemplateColumns: `minmax(90px, 160px) repeat(${cols.length}, minmax(44px, 1fr))` }}>
        <span />{cols.map((c) => <span key={c} className="heat-col">{c}</span>)}
        {rows.map((r) => [
          <span key={`${r.label}-l`} className="heat-row" title={r.label}>{r.label}</span>,
          ...r.values.map((v, i) => <motion.span key={`${r.label}-${i}`} className={`heat-cell ${tone(v)}`} {...enter(i, { y: 0, scale: 0.92, d: 'quick' })} tabIndex={0} {...tip((() => { const row = r.values.filter((x) => x != null), col = rows.map((x) => x.values[i]).filter((x) => x != null); const avg = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : null); const t = tone(v); return infoCard({ title: `${r.label} · ${cols[i]}`, sub: label, calc: v == null ? tr('Kein Wert', 'No value') : format(v), inputs: [[tr('Wert', 'Value'), v == null ? '–' : format(v)], [tr(`Durchschnitt ${r.label}`, `Average ${r.label}`), avg(row) == null ? '–' : format(avg(row))], [tr(`Durchschnitt ${cols[i]}`, `Average ${cols[i]}`), avg(col) == null ? '–' : format(avg(col))]], hint: t === 'bad' ? tr('Rot: über 100 % – überbucht', 'Red: above 100 % – overbooked') : t === 'warn' ? tr('Gelb: 85–100 % – fast voll', 'Amber: 85–100 % – nearly full') : t === 'ok' ? tr('Grün: bis 85 % – Luft', 'Green: up to 85 % – room') : null }); })())}>{v == null ? '–' : format(v)}</motion.span>),
        ])}
      </div>
      <SrTable head={['', ...cols]} rows={rows.map((r) => [r.label, ...r.values.map((v) => (v == null ? '–' : format(v)))])} />
    </figure>
  );
}

// SLA progress: share of target used (green → amber → red), with remaining time.
export function SlaBar({ share, status, remaining }) {
  const w = Math.min(100, Math.max(3, (share || 0) * 100));
  const c = status === 'breached' ? 'var(--bad)' : status === 'atRisk' ? 'var(--warn)' : 'var(--ok)';
  return (
    <span className="slabar" title={remaining}>
      <span className="slabar-track"><motion.span className="slabar-fill" {...grow('x')} style={{ width: `${w}%`, background: c }} /></span>
      <span className="slabar-text num" style={{ color: status === 'breached' ? 'var(--bad)' : undefined }}>{remaining}</span>
    </span>
  );
}

