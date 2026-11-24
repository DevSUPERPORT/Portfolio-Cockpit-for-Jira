// "Nachprüfen" – check a number yourself. One affordance everywhere (the shield-check mark and the same label):
//   simple layer  – 1-2-3 in plain words, the formula with the real numbers, and the sums recounted in the browser from
//                   the listed rows ("Summe stimmt" in green, or a clear red difference);
//   expert layer  – every row behind the number (sortable, keys open the work item), "Alle N in Jira öffnen" (JQL),
//                   "Als CSV" to recompute in Excel, and the way to the independent recount from Jira ("Nachweis").
// The rows come from shared/kpis.js (proof); recountProof() sums them here, in the browser. Motion: transform /
// opacity, enter only. The expert layer remembers itself per browser (localStorage, a convenience only).
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { recountProof } from '@shared/kpis.js';
import { enter } from '../lib/motion.js';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { openIssue, openJql, jqlChunks, JQL_CHUNK } from '../lib/api.js';
import { downloadCsv } from '../lib/export.js';
import { track } from '../lib/usage.js';
import './proof.css';

// ---------- the one mark ----------
export function ProofIcon({ size = 14 }) {
  return (
    <svg className="pf-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 3 4.5 6v6c0 4.4 3.2 7.9 7.5 9 4.3-1.1 7.5-4.6 7.5-9V6Z" />
      <path d="m8.8 12.2 2.2 2.2 4.3-4.6" />
    </svg>
  );
}
export const proofWord = () => tr('Nachprüfen', 'Check it yourself');

// The deep page: a KPI drawer asks the 'Nachweis' view to open that number's card (taken once on arrival).
let wantCard = null;
export const requestProofCard = (id) => { wantCard = id; };
export const takeProofCard = () => { const c = wantCard; wantCard = null; return c; };

// ---------- helpers ----------
const EXPERT_KEY = 'pc-proof-expert';
const readExpert = () => { try { return window.localStorage.getItem(EXPERT_KEY) === '1'; } catch { return false; } };
const saveExpert = (v) => { try { window.localStorage.setItem(EXPERT_KEY, v ? '1' : '0'); } catch { /* private mode: not remembered */ } };
const whole = (v) => Math.abs(v - Math.round(v)) < 0.05;
export function cellText(v, unit) {
  if (v == null || v === '') return '–';
  if (unit === 'h') return fmt.h(v, whole(v) ? 0 : 1);
  if (unit === 'n') return fmt.n(v, whole(v) ? 0 : 1);
  if (unit === 'pct') return fmt.pct(v);
  if (unit === 'date') return fmt.date(v, { day: '2-digit', month: 'short', year: '2-digit' });
  return String(v);
}
// a figure as the calculation writes it (0 or 1 decimal – whichever stands there)
function asWritten(v, unit, text) {
  if (unit === 'h') { const c = [fmt.h(v), fmt.h(v, 1)]; return c.find((x) => text.includes(x)) || cellText(v, 'h'); }
  if (unit === 'pct') return fmt.pct(v);
  return fmt.n(v, whole(v) ? 0 : 1);
}
export function proofKeys(rows) {
  const out = [];
  for (const r of rows || []) { if (r.key) out.push(r.key); for (const k of r.keys || []) out.push(k); }
  return [...new Set(out)];
}
// the final step written out with the recounted figures: "5.897 h ÷ (5.897 h + 421 h) = " (ratios only)
function formulaOf(proof, rc, text) {
  const f = rc.final;
  if (!f || f.op !== 'ratio') return '';
  const byId = new Map(rc.totals.map((t) => [t.id, t]));
  const term = (id) => { const t = byId.get(id.replace(/^-/, '')); return t ? asWritten(t.recount, unitOfTotal(proof, t), text) : '?'; };
  const sum = (ids) => ids.map((id, i) => `${i ? (id.startsWith('-') ? ' − ' : ' + ') : ''}${term(id)}`).join('');
  const num = f.num.length > 1 ? `(${sum(f.num)})` : sum(f.num);
  const den = f.den.length > 1 ? `(${sum(f.den)})` : sum(f.den);
  return `${num} ÷ ${den}${f.offset ? ` ${f.offset < 0 ? '−' : '+'} ${Math.abs(f.offset)}` : ''} = `;
}
const unitOfTotal = (proof, t) => (t.unit || (t.agg === 'rows' ? 'n' : proof.columns.find((c) => c.id === t.col)?.unit) || 'n');
const restOf = (label, key) => (key && label.startsWith(key) ? label.slice(key.length).trim() : label);

// ---------- "Alle N in Jira öffnen" (in batches of 100) ----------
export function JiraKeysButton({ keys, label, className = 'btn btn-xs' }) {
  const chunks = useMemo(() => jqlChunks(keys), [keys]);
  const n = chunks.reduce((a, c) => a + c.length, 0);
  if (!n) return null;
  const go = (b) => { track('proof:jql'); openJql(keys, { batch: b }); };
  if (chunks.length === 1) {
    return <button type="button" className={className} onClick={() => go(0)} title={tr('Öffnet die Vorgangssuche in Jira mit genau diesen Keys', 'Opens Jira\'s issue search with exactly these keys')}><Icon name="external" size={12} />{label || tr(`Alle ${n} in Jira öffnen`, `Open all ${n} in Jira`)}</button>;
  }
  return (
    <span className="pf-batches" role="group" aria-label={tr(`${n} Vorgänge in Jira öffnen, je ${JQL_CHUNK}`, `Open ${n} work items in Jira, ${JQL_CHUNK} at a time`)}>
      <Icon name="external" size={12} /><span className="faint">{tr(`${n} in Jira öffnen:`, `Open ${n} in Jira:`)}</span>
      {chunks.map((c, i) => <button key={i} type="button" className="btn btn-xs" onClick={() => go(i)}>{i * JQL_CHUNK + 1}–{i * JQL_CHUNK + c.length}</button>)}
    </span>
  );
}

// ---------- CSV: the rows and the totals, to recompute in Excel ----------
export function proofCsv(k, name = k.id) {
  const p = k.proof;
  const csvVal = (v, unit) => (v == null ? '' : unit === 'pct' ? Math.round(v * 1000) / 10 : typeof v === 'number' ? Math.round(v * 100) / 100 : String(v));
  const head = ['Key', tr('Bezeichnung', 'Name'), ...p.columns.map((c) => `${c.label}${c.unit === 'h' ? ' (h)' : c.unit === 'pct' ? ' (%)' : ''}`)];
  const rows = p.rows.map((r) => [r.key || (r.keys || []).join(' '), restOf(r.label, r.key), ...p.columns.map((c) => csvVal(r.values[c.id], c.unit))]);
  const rc = recountProof(p, k.value);
  const tail = [[], ...rc.totals.map((t) => {
    const line = ['', `${t.given ? '' : 'Σ '}${t.label}${t.where ? ` (${Object.values(t.where).join(', ')})` : ''}${t.agg === 'rows' ? tr(' – Anzahl Zeilen', ' – number of rows') : ''}`, ...p.columns.map(() => '')];
    const at = t.agg === 'rows' || !t.col ? 2 : 2 + p.columns.findIndex((c) => c.id === t.col);
    line[at] = csvVal(t.value, unitOfTotal(p, t));
    return line;
  }), ['', tr('Rechnung', 'Calculation'), k.calc], ['', tr('Ergebnis auf der Kachel', 'Result on the tile'), k.display]];
  track('proof:csv');
  return downloadCsv(`${tr('nachpruefen', 'check')}-${name}`, head, [...rows, ...tail]);
}

// ---------- the table behind a number ----------
const PAGE = 150;
// calcText: the calculation as written – the Σ row shows each sum the way the calculation writes it (740 h, not 739,6 h)
export function ProofTable({ proof, totals = null, depth = 0, label, calcText = '' }) {
  const [sort, setSort] = useState(null); // { col, dir }
  const [open, setOpen] = useState(() => new Set());
  const [limit, setLimit] = useState(PAGE);
  // nested (an epic's stories, a project's epics): only the columns that carry something, so the drawer stays readable
  const cols = useMemo(() => (depth ? proof.columns.filter((c) => proof.rows.some((r) => { const v = r.values[c.id]; return v != null && v !== '' && v !== 0; })) : proof.columns), [proof, depth]);
  const rows = useMemo(() => {
    const list = proof.rows.map((r, i) => ({ r, i }));
    if (!sort) return list;
    const val = (x) => (sort.col === '_label' ? x.r.label : x.r.values[sort.col]);
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null || va === '') return 1;
      if (vb == null || vb === '') return -1;
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true })) * sort.dir;
    });
  }, [proof.rows, sort]);
  const by = (col) => setSort((s) => (s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: cols.find((c) => c.id === col)?.unit === 'text' || col === '_label' ? 1 : -1 }));
  const aria = (col) => (sort?.col === col ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none');
  const toggle = (i) => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const foot = totals ? totals.filter((t) => !t.given && !t.where && t.agg !== 'rows' && t.col) : [];
  const rowCount = totals?.find((t) => t.agg === 'rows' && !t.where);
  const head = (id, text, num) => (
    <th key={id} aria-sort={aria(id)} className={num ? 'num' : ''}>
      <button type="button" className="pf-sort" onClick={() => by(id)}>{text}{sort?.col === id && <Icon name={sort.dir === 1 ? 'up' : 'down'} size={11} />}</button>
    </th>
  );
  return (
    <div className={`pf-scroll ${depth ? 'nested' : ''}`} tabIndex={depth ? undefined : 0} role={depth ? undefined : 'region'} aria-label={depth ? undefined : label || tr('Zeilen hinter der Zahl, scrollbar', 'Rows behind the number, scrollable')}>
      <table className="pf-table">
        <thead><tr>{head('_label', tr('Vorgang', 'Work item'), false)}{cols.map((c) => head(c.id, c.label, c.unit !== 'text' && c.unit !== 'date'))}</tr></thead>
        <tbody>
          {rows.slice(0, limit).map(({ r, i }) => {
            const kids = r.children?.rows?.length ? r.children : null;
            const isOpen = open.has(i);
            const rest = restOf(r.label, r.key);
            return [
              <tr key={i} className={kids ? 'has-kids' : ''}>
                <td className="pf-name">
                  <span className="pf-name-in">
                    {kids
                      ? <button type="button" className="pf-exp" aria-expanded={isOpen} onClick={() => toggle(i)} aria-label={`${isOpen ? tr('Zuklappen', 'Collapse') : tr('Aufklappen', 'Expand')}: ${r.label} (${kids.rows.length})`}><Icon name="chevron" size={12} /></button>
                      : proof.rows.some((x) => x.children?.rows?.length) ? <span className="pf-exp-pad" aria-hidden="true" /> : null}
                    {r.key && <button type="button" className="tkey pf-key" onClick={() => openIssue(r.key)} title={tr(`${r.key} in Jira öffnen`, `Open ${r.key} in Jira`)}>{r.key}</button>}
                    <span className="pf-label">{rest || (r.key ? '' : r.label)}</span>
                    {kids && <span className="pf-count faint num">{kids.rows.length}</span>}
                  </span>
                </td>
                {cols.map((c) => <td key={c.id} className={c.unit === 'text' || c.unit === 'date' ? `pf-${c.unit}` : 'num'}>{cellText(r.values[c.id], c.unit)}</td>)}
              </tr>,
              isOpen && kids && (
                <tr key={`${i}-k`} className="pf-kids"><td colSpan={cols.length + 1}>
                  <motion.div {...enter(0, { y: -4, d: 'quick' })}><ProofTable proof={kids} depth={depth + 1} /></motion.div>
                </td></tr>
              ),
            ];
          })}
        </tbody>
        {(foot.length > 0 || rowCount) && (
          <tfoot><tr>
            <td className="pf-name"><b>Σ</b> <span className="faint">{tr(`${proof.rows.length} Zeilen`, `${proof.rows.length} rows`)}</span></td>
            {cols.map((c) => { const t = foot.find((x) => x.col === c.id); return <td key={c.id} className="num">{t ? <b>{asWritten(t.recount, c.unit, calcText)}</b> : ''}</td>; })}
          </tr></tfoot>
        )}
      </table>
      {rows.length > limit && <button type="button" className="ai-link pf-more" onClick={() => setLimit((l) => l + PAGE * 4)}>{tr(`Weitere ${rows.length - limit} Zeilen zeigen`, `Show ${rows.length - limit} more rows`)}</button>}
    </div>
  );
}

// ---------- the badge: does the sum check out? ----------
function SumBadge({ rc }) {
  if (!rc) return null;
  const computed = rc.totals.some((t) => !t.given);
  if (!computed) return <span className="pf-badge neutral"><Icon name="info" size={11} />{tr('aus Jira-Buchungen', 'from Jira bookings')}</span>;
  return rc.ok
    ? <span className="pf-badge ok" data-proof-ok="1"><Icon name="check" size={11} />{tr('Summe stimmt', 'Sum checks out')}</span>
    : <span className="pf-badge bad" data-proof-ok="0"><Icon name="alert" size={11} />{tr('Abweichung', 'Mismatch')}</span>;
}

// ---------- the panel in the KPI drawer ----------
// k: a KPI from shared/kpis.js with proof; startOpen: opened through "Nachprüfen"; onDeep(): to the "Nachweis" view.
export function KpiProof({ k, startOpen = false, onDeep, subject }) {
  const [open, setOpen] = useState(startOpen);
  const [expert, setExpertState] = useState(readExpert);
  const setExpert = (v) => { setExpertState(v); saveExpert(v); if (v) track('proof:rows'); };
  const p = k.proof;
  const rc = useMemo(() => recountProof(p, k.value), [p, k.value]);
  const keys = useMemo(() => proofKeys(p?.rows), [p]);
  if (!p) return null;
  const text = `${k.calc} ${(k.inputs || []).map(([, v]) => v).join(' ')}`;
  const finalText = rc.final && rc.final.recount != null
    ? (rc.final.op === 'ratio' ? (rc.final.offset ? fmt.signedPct(rc.final.recount) : fmt.pct(rc.final.recount)) : asWritten(rc.final.recount, unitOfTotal(p, p.totals.find((t) => t.id === rc.final.id) || {}), text))
    : null;
  return (
    <section className={`pf ${open ? 'open' : ''}`} aria-label={proofWord()} data-proof={k.id}>
      <button type="button" className="pf-toggle" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) track('proof:open'); }}>
        <span className="pf-ic"><ProofIcon size={15} /></span>
        <span className="pf-t"><b>{proofWord()}</b><small>{tr('So kannst du die Zahl selbst prüfen', 'How to check this number yourself')}</small></span>
        <SumBadge rc={rc} />
        <span className="pf-chev" aria-hidden="true"><Icon name="chevronDown" size={14} /></span>
      </button>
      {open && (
        <motion.div className="pf-body" {...enter(0, { y: -4, d: 'quick' })}>
          <ol className="pf-steps">{(p.steps || []).map((s, i) => <li key={i}><span className="pf-n" aria-hidden="true">{i + 1}</span><span>{s}</span></li>)}</ol>
          <ul className="pf-checks" aria-label={tr('Im Browser nachgerechnet', 'Recomputed in the browser')}>
            {rc.totals.map((t) => {
              const unit = unitOfTotal(p, t);
              const rows = t.where ? p.rows.filter((r) => Object.entries(t.where).every(([kk, v]) => (r[kk] ?? r.values[kk]) === v)).length : p.rows.length;
              if (t.given) return <li key={t.id} className="given"><Icon name="info" size={12} /><span><b>{t.label}</b> {asWritten(t.value, unit, text)} <span className="faint">– {t.source || tr('kommt aus der Planung, keine Zeilensumme', 'comes from planning, not a sum of rows')}</span></span></li>;
              return (
                <li key={t.id} className={t.ok ? 'ok' : 'bad'}>
                  <Icon name={t.ok ? 'check' : 'alert'} size={12} />
                  <span><b>{t.label}</b>{' '}
                    {t.agg === 'rows' ? tr(`${rows} Zeilen gezählt`, `${rows} rows counted`) : tr(`Summe aus ${rows} Zeilen`, `sum of ${rows} rows`)} = <b className="num">{asWritten(t.recount, unit, text)}</b>{' '}
                    {t.ok ? <span className="faint">{tr('– steht so in der Rechnung', '– as in the calculation')}</span> : <span className="pf-diff">{tr(`≠ ${asWritten(t.value, unit, text)} in der Rechnung`, `≠ ${asWritten(t.value, unit, text)} in the calculation`)}</span>}
                  </span>
                </li>
              );
            })}
            {rc.final && rc.final.op !== 'given' && finalText && (
              <li className={rc.final.ok ? 'ok final' : 'bad final'}>
                <Icon name={rc.final.ok ? 'check' : 'alert'} size={12} />
                <span>{rc.final.op === 'ratio' ? tr('Mit den nachgezählten Summen gerechnet', 'Computed with the recounted sums') : tr('Ergebnis der Nachzählung', 'Result of the recount')}: <code className="pf-eq">{formulaOf(p, rc, text)}{finalText}</code> {rc.final.ok ? <span className="faint">{tr(`– wie auf der Kachel (${k.display})`, `– as on the tile (${k.display})`)}</span> : <span className="pf-diff">{tr(`≠ ${k.display} auf der Kachel`, `≠ ${k.display} on the tile`)}</span>}</span>
              </li>
            )}
          </ul>
          {p.note && <p className="pf-note faint">{p.note}</p>}
          <div className="pf-actions">
            <button type="button" className="btn btn-xs pf-rows-btn" aria-expanded={expert} onClick={() => setExpert(!expert)} disabled={!p.rows.length}>
              <Icon name={expert ? 'up' : 'layers'} size={12} />{expert ? tr('Zeilen ausblenden', 'Hide rows') : tr(`Alle ${p.rows.length} Zeilen zeigen`, `Show all ${p.rows.length} rows`)}
            </button>
            {expert && <JiraKeysButton keys={keys} />}
            {expert && p.rows.length > 0 && <button type="button" className="btn btn-xs" onClick={() => proofCsv(k, subject ? `${k.id}-${subject}`.replace(/[^\w.-]+/g, '-').slice(0, 60) : k.id)}><Icon name="download" size={12} />{tr('Als CSV', 'As CSV')}</button>}
            {expert && onDeep && <button type="button" className="btn btn-xs btn-ghost" onClick={onDeep}><ProofIcon size={12} />{tr('Unabhängig aus Jira nachzählen', 'Recount independently from Jira')}</button>}
          </div>
          {expert && p.rows.length > 0 && <motion.div {...enter(0, { y: -4, d: 'quick' })}><ProofTable proof={p} totals={rc.totals} calcText={text} label={`${k.label}: ${tr('Zeilen', 'rows')}`} /></motion.div>}
        </motion.div>
      )}
    </section>
  );
}

// ---------- expandable rows (Planungsreife): a row opens to what it is made of, its key opens Jira ----------
const TONE = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' };
export function ProofItems({ items, proof, renderFix }) {
  const [open, setOpen] = useState(() => new Set());
  const byLabel = useMemo(() => new Map((proof?.rows || []).map((r) => [r.label, r])), [proof]);
  const toggle = (i) => setOpen((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <ul className="pf-items">
      {items.map((x, i) => {
        const row = byLabel.get(x.text);
        const kids = row?.children?.rows?.length ? row.children : null;
        const key = x.key || row?.key || null;
        const isOpen = open.has(i);
        return (
          <li key={i} className={isOpen ? 'open' : ''}>
            <div className="pf-item-head">
              {kids ? (
                <button type="button" className="pf-item-btn" aria-expanded={isOpen} onClick={() => toggle(i)}>
                  <span className="pf-exp-ic" aria-hidden="true"><Icon name="chevron" size={12} /></span>
                  <i style={{ background: TONE[x.tone] || 'var(--line-strong)' }} aria-hidden="true" />
                  <span className="pf-item-t"><span className="pf-item-text">{x.text}</span><span className="faint">{x.sub}</span></span>
                </button>
              ) : (
                <div className="pf-item-btn static">
                  <span className="pf-exp-ic" aria-hidden="true" />
                  <i style={{ background: TONE[x.tone] || 'var(--line-strong)' }} aria-hidden="true" />
                  <span className="pf-item-t"><span className="pf-item-text">{x.text}</span><span className="faint">{x.sub}</span></span>
                </div>
              )}
              {key && <button type="button" className="btn btn-xs btn-ghost pf-jira" onClick={() => openIssue(key)} title={tr(`${key} in Jira öffnen`, `Open ${key} in Jira`)} aria-label={tr(`${key} in Jira öffnen`, `Open ${key} in Jira`)}><span className="mono">{key}</span><Icon name="external" size={11} /></button>}
            </div>
            {renderFix?.(x)}
            {isOpen && kids && <motion.div className="pf-item-kids" {...enter(0, { y: -4, d: 'quick' })}><ProofTable proof={kids} depth={1} /></motion.div>}
          </li>
        );
      })}
    </ul>
  );
}
