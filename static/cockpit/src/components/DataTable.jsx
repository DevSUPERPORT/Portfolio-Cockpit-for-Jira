// A table for large answers: sort any column (numbers as numbers – "1,004 h", "#3", "-12 %"), filter as you type,
// "x of y" always visible, a Σ row for hour columns, and windowed rendering so thousands of rows stay smooth.
import { useMemo, useRef, useState } from 'react';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';

const ROW_H = 36, WINDOW_FROM = 120, OVERSCAN = 12;

// A cell as a number (or null for "–"/empty, NaN for text). Handles 1.234,5 / 1,234.5 / #3 / −12 %.
export function cellNumber(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(/−/g, '-');
  if (s === '' || s === '–' || s === '-') return null;
  const m = /^([#+-]?)\s*(\d[\d.,]*)/.exec(s);
  if (!m) return NaN;
  let t = m[2];
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? (m[1] === '-' ? -n : n) : NaN;
}

export default function DataTable({ head, rows, large }) {
  const [sort, setSort] = useState(null); // { col, dir: 1 | -1 }
  const [q, setQ] = useState('');
  const [top, setTop] = useState(0);
  const box = useRef(null);
  const numeric = useMemo(() => head.map((_, j) => {
    const vals = rows.map((r) => cellNumber(r[j])).filter((x) => x !== null);
    return vals.length > 0 && vals.filter((x) => !Number.isNaN(x)).length / vals.length >= 0.8;
  }), [head, rows]);
  const hours = useMemo(() => head.map((_, j) => numeric[j] && rows.length > 1 && rows.every((r) => r[j] == null || r[j] === '–' || / h$/.test(String(r[j])))), [head, rows, numeric]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle ? rows.filter((r) => r.some((c) => String(c ?? '').toLowerCase().includes(needle))) : rows;
    if (sort) {
      const { col, dir } = sort;
      out = [...out].sort((a, b) => {
        if (numeric[col]) {
          const x = cellNumber(a[col]), y = cellNumber(b[col]);
          if (x == null || Number.isNaN(x)) return 1; if (y == null || Number.isNaN(y)) return -1; // empty last
          return (x - y) * dir;
        }
        return String(a[col] ?? '').localeCompare(String(b[col] ?? ''), undefined, { numeric: true }) * dir;
      });
    }
    return out;
  }, [rows, q, sort, numeric]);
  const toggle = (j) => setSort((s) => (s?.col !== j ? { col: j, dir: numeric[j] ? -1 : 1 } : s.dir === (numeric[j] ? -1 : 1) ? { col: j, dir: -s.dir } : null));
  const maxH = large ? Math.round(window.innerHeight * 0.62) : 360;
  const windowed = shown.length > WINDOW_FROM;
  const first = windowed ? Math.max(0, Math.floor(top / ROW_H) - OVERSCAN) : 0;
  const last = windowed ? Math.min(shown.length, first + Math.ceil(maxH / ROW_H) + OVERSCAN * 2) : shown.length;
  const totals = hours.some(Boolean) ? head.map((_, j) => (hours[j] ? shown.reduce((a, r) => a + (cellNumber(r[j]) || 0), 0) : null)) : null;
  return (
    <div className="dtable">
      {(rows.length > 6 || q) && (
        <div className="dtable-bar">
          <label className="dtable-search"><Icon name="search" size={14} /><input value={q} onChange={(e) => { setQ(e.target.value); setTop(0); if (box.current) box.current.scrollTop = 0; }} placeholder={tr('Filtern …', 'Filter …')} aria-label={tr('Tabelle filtern', 'Filter the table')} />{q && <button type="button" className="btn btn-ghost btn-icon btn-xs" onClick={() => setQ('')} aria-label={tr('Filter löschen', 'Clear filter')}><Icon name="x" size={12} /></button>}</label>
          <span className="faint num" aria-live="polite">{shown.length === rows.length ? tr(`${rows.length} Zeilen`, `${rows.length} rows`) : tr(`${shown.length} von ${rows.length}`, `${shown.length} of ${rows.length}`)}</span>
        </div>
      )}
      <div ref={box} className="table-scroll" tabIndex={0} role="region" aria-label={tr('Tabelle, mit Pfeiltasten scrollbar', 'Table, scrollable with arrow keys')} style={{ maxHeight: maxH }} onScroll={windowed ? (e) => setTop(e.currentTarget.scrollTop) : undefined}>
        <table className="table">
          <thead><tr>{head.map((h, j) => (
            <th key={j} aria-sort={sort?.col === j ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={numeric[j] ? 'num' : undefined}>
              <button type="button" className="dtable-sort" onClick={() => toggle(j)}>{h}<span className="dtable-arrow" aria-hidden="true">{sort?.col === j ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span></button>
            </th>
          ))}</tr></thead>
          <tbody>
            {windowed && first > 0 && <tr aria-hidden="true" style={{ height: first * ROW_H }}><td colSpan={head.length} /></tr>}
            {shown.slice(first, last).map((r, i) => <tr key={first + i} style={windowed ? { height: ROW_H } : undefined}>{r.map((c, j) => <td key={j} className={numeric[j] ? 'num' : undefined}>{c}</td>)}</tr>)}
            {windowed && last < shown.length && <tr aria-hidden="true" style={{ height: (shown.length - last) * ROW_H }}><td colSpan={head.length} /></tr>}
            {shown.length === 0 && <tr><td colSpan={head.length} className="faint">{tr('Keine Zeile passt zum Filter.', 'No row matches the filter.')}</td></tr>}
          </tbody>
          {totals && shown.length > 1 && <tfoot><tr>{totals.map((t, j) => <td key={j} className={hours[j] ? 'num' : undefined}>{j === 0 ? <b>Σ {tr(shown.length === rows.length ? 'alle' : 'gefiltert', shown.length === rows.length ? 'all' : 'filtered')}</b> : t == null ? '' : <b>{fmt.h(t)}</b>}</td>)}</tr></tfoot>}
        </table>
      </div>
    </div>
  );
}
