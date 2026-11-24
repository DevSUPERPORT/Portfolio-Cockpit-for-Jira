// A chart of the composed report, drawn from the SAME operations as the PDF (pdfLayout.js layoutVisual) and in the
// REPORT's language – not the app's: a report in English shows "1,235 h", "days", "Capacity" even while the cockpit runs
// in German. SVG in mm units; colours follow the theme (light / dark) through the app's CSS variables. The picture is
// hidden from screen readers; a visually hidden table (publish.js visualTable, also the report's language) carries the
// same numbers. Motion: one fade/rise on enter (transform / opacity only).
import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { enter } from '../../lib/motion.js';
import { layoutVisual, PAGE, C } from './pdfLayout.js';
import { visualTable } from '@shared/lotse/report/publish.js';

// the PDF palette → theme variables (so the chart reads in dark mode too)
const VAR = { ink: 'var(--ink)', ink2: 'var(--ink-2)', ink3: 'var(--ink-3)', line: 'var(--line)', band: 'var(--surface-2)', sunken: 'var(--sunken)', accent: 'var(--accent)', accentSoft: 'var(--accent-soft)',
  ok: 'var(--ok)', okSoft: 'var(--ok-soft)', warn: 'var(--warn)', warnSoft: 'var(--warn-soft)', bad: 'var(--bad)', badSoft: 'var(--bad-soft)', info: 'var(--info)', infoSoft: 'var(--info-soft)', white: 'var(--ink-inv)', muted: 'var(--line-strong)' };
const BY_RGB = new Map(Object.entries(C).map(([k, v]) => [v.join(','), VAR[k]]));
const col = (c) => (Array.isArray(c) ? BY_RGB.get(c.join(',')) || `rgb(${c.join(',')})` : c || 'var(--ink)');
const PT = 0.3528; // 1 pt in mm
const X0 = PAGE.M, CW = PAGE.W - 2 * PAGE.M;

function Op({ o }) {
  switch (o.op) {
    case 'rect': return <rect x={o.x} y={o.y} width={Math.max(0, o.w)} height={Math.max(0, o.h)} rx={o.r ? Math.min(o.r, o.h / 2, o.w / 2) : undefined} fill={col(o.fill)} stroke={o.stroke ? col(o.stroke) : undefined} strokeWidth={o.stroke ? 0.25 : undefined} />;
    case 'text': return <text x={o.x} y={o.y} fontSize={o.size * PT} fontWeight={o.style === 'bold' ? 640 : 420} fill={col(o.color)} textAnchor={o.align === 'right' ? 'end' : o.align === 'center' ? 'middle' : 'start'}>{o.text}</text>;
    case 'line': return <line x1={o.x1} y1={o.y1} x2={o.x2} y2={o.y2} stroke={col(o.color)} strokeWidth={o.w || 0.2} strokeDasharray={o.dash ? o.dash.join(' ') : undefined} />;
    case 'circle': return <circle cx={o.x} cy={o.y} r={o.r} fill={col(o.fill)} />;
    case 'poly': return <polygon points={o.pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')} fill={col(o.fill)} />;
    default: return null;
  }
}

function ReportVisual({ visual, lang = 'de', label }) {
  const L = lang === 'en' ? 'en' : 'de';
  const lay = useMemo(() => { try { return layoutVisual({ kind: 'chart', data: { visual } }, { lang: L }); } catch { return null; } }, [visual, L]);
  const table = useMemo(() => { try { return visualTable(visual, L); } catch { return { columns: [], rows: [] }; } }, [visual, L]);
  if (!lay || !lay.ops.length) return null;
  const h = Math.max(4, lay.height);
  return (
    <motion.figure className="rc-chart" lang={L} aria-label={label || visual.caption || undefined} {...enter(0, { y: 6, d: 'gentle' })}>
      <svg viewBox={`${X0} 0 ${CW} ${h.toFixed(2)}`} width="100%" role="presentation" aria-hidden="true" focusable="false" className="rc-chart-svg" style={{ aspectRatio: `${CW} / ${h}` }}>
        {lay.ops.map((o, i) => <Op key={i} o={o} />)}
      </svg>
      {table.rows.length > 0 && (
        <table className="sr">
          {visual.caption && <caption>{visual.caption}</caption>}
          {table.columns.some(Boolean) && <thead><tr>{table.columns.map((c, i) => <th key={i} scope="col">{c || <span className="sr">{/* the report's language, not the app's */}{L === 'de' ? (i === 0 ? 'Eintrag' : 'Wert') : (i === 0 ? 'Item' : 'Value')}</span>}</th>)}</tr></thead>}
          <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
        </table>
      )}
    </motion.figure>
  );
}
export default memo(ReportVisual);
