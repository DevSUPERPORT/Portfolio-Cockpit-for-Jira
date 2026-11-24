// Projects › Structure › List – for project admins and above (boss 2026-11-19: "a list with columns on the fields").
// Every work item of the project (filters apply), in hierarchy order by default; a click on a column header sorts
// (again: reverse, a third time: back to the hierarchy). Columns can be shown or hidden (remembered), hours add up in
// the Σ row (only the estimation level – parents would count twice), and the view exports to Excel as it is.
import { useMemo, useState } from 'react';
import { rollups, barOf, quickFlags, workdaysBetween } from '@shared/timeline.js';
import { isoOf } from '@shared/dates.js';
import { tr, fmt, roleName, usageName } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { openIssue } from '../lib/api.js';
import { downloadWorkbook } from '../lib/xlsx.js';
import { Avatar, Lozenge } from './ui.jsx';
import { usePref } from './StructureTimeline.jsx';
import { LotseChip } from './lotse/LotseChip.jsx';

const iso = (d) => (d == null ? null : isoOf(d));
const COLS = () => [
  { id: 'key', label: tr('Schlüssel', 'Key'), always: true, sort: (r) => r.i.key, xl: { type: 'link', width: 12 } },
  { id: 'summary', label: tr('Zusammenfassung', 'Summary'), always: true, sort: (r) => r.i.summary.toLowerCase(), xl: { width: 44 } },
  { id: 'type', label: tr('Typ', 'Type'), sort: (r) => r.i.type?.name || '', xl: { width: 14 } },
  { id: 'level', label: tr('Ebene', 'Level'), sort: (r) => r.i.role, off: true, xl: { width: 16 } },
  { id: 'status', label: 'Status', sort: (r) => r.i.status?.name || '', xl: { width: 14 } },
  { id: 'assignee', label: 'Assignee', sort: (r) => (r.i.assignee?.anon ? '' : r.i.assignee?.name || '~'), xl: { width: 20 } },
  { id: 'team', label: 'Team', sort: (r) => r.i.team?.name || '~', xl: { width: 16 } },
  { id: 'start', label: 'Start', sort: (r) => r.bar.start ?? Infinity, num: true, xl: { type: 'date', width: 12 } },
  { id: 'due', label: 'Due', sort: (r) => r.bar.due ?? Infinity, num: true, xl: { type: 'date', width: 12 } },
  { id: 'days', label: tr('Arbeitstage', 'Work days'), sort: (r) => r.days ?? -1, num: true, xl: { type: 'int', width: 11 } },
  { id: 'oe', label: tr('Schätzung', 'Estimate'), sort: (r) => r.bar.oe, num: true, hours: true, xl: { type: 'hours', width: 12 } },
  { id: 'ts', label: tr('Gebucht', 'Logged'), sort: (r) => r.bar.ts, num: true, hours: true, off: true, xl: { type: 'hours', width: 12 } },
  { id: 're', label: tr('Rest', 'Remaining'), sort: (r) => r.bar.re, num: true, hours: true, xl: { type: 'hours', width: 12 } },
  { id: 'progress', label: tr('Fortschritt', 'Progress'), sort: (r) => r.bar.progress ?? -1, num: true, xl: { type: 'pct', width: 11 } },
  { id: 'tshirt', label: tr('T-Shirt', 'T-shirt'), sort: (r) => r.i.tshirt || '', off: true, xl: { width: 10 } },
  { id: 'quarters', label: tr('Ziel-Quartale', 'Target quarters'), sort: (r) => (r.i.quarters || []).join(), off: true, xl: { width: 16 } },
  { id: 'flags', label: tr('Hinweise', 'Flags'), sort: (r) => -r.flagCount, xl: { width: 36, wrap: true } },
];

export default function StructureList({ projectRef, rows, issues, kidsOf, model, deps, gapsBy, ds }) {
  const cols = COLS();
  const [hidden, setHidden] = usePref('listHidden', cols.filter((c) => c.off).map((c) => c.id));
  const [sort, setSort] = useState(null); // { id, dir }
  const [chooser, setChooser] = useState(false);
  const today = model.today;
  const roll = useMemo(() => rollups(issues, kidsOf), [issues, kidsOf]);
  const conflictIds = useMemo(() => new Set((deps?.list || []).filter((d) => d.conflict).flatMap((d) => [d.pre, d.dep])), [deps]);
  const data = useMemo(() => rows.map((r, order) => {
    const bar = barOf(r.i, roll, today);
    const f = quickFlags(r.i, bar, today, conflictIds);
    const missing = gapsBy.get(r.i.id) || [];
    const notes = [
      f.overdue && { t: tr(`${bar.overdue} T über Due`, `${bar.overdue} d past due`), tone: 'bad' },
      f.conflict && { t: tr('Terminkonflikt', 'Date conflict'), tone: 'bad' },
      f.invalid && { t: tr('Start nach Due', 'Start after due'), tone: 'bad' },
      f.late && { t: tr('Kinder nach Due', 'Children after due'), tone: 'warn' },
      f.soon && { t: tr('endet bald', 'ends soon'), tone: 'warn' },
      deps?.issueIds?.has(r.i.id) && !f.conflict && { t: tr('Abhängigkeit', 'Dependency'), tone: 'info' },
      ...missing.map((u) => ({ t: `${usageName(u)} ${tr('fehlt', 'missing')}`, tone: 'missing' })),
    ].filter(Boolean);
    const days = bar.start != null && bar.due != null && bar.due >= bar.start ? workdaysBetween(bar.start, bar.due) : null;
    return { ...r, order, bar, notes, flagCount: notes.length, days };
  }), [rows, roll, today, conflictIds, gapsBy, deps]);
  const shown = useMemo(() => {
    if (!sort) return data;
    const c = cols.find((x) => x.id === sort.id);
    return [...data].sort((p, q) => { const a = c.sort(p), b = c.sort(q); return (a < b ? -1 : a > b ? 1 : p.order - q.order) * sort.dir; });
  }, [data, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const visibleCols = cols.filter((c) => c.always || !hidden.includes(c.id));
  const est = data.filter((r) => r.i.role === 'estimate');
  const sum = (k) => est.reduce((n, r) => n + (r.bar[k] || 0), 0);
  const clickSort = (id) => setSort((s) => (!s || s.id !== id ? { id, dir: 1 } : s.dir === 1 ? { id, dir: -1 } : null));

  const cell = (c, r) => {
    const { i, bar } = r;
    switch (c.id) {
      case 'key': return <button type="button" className="tkey" onClick={() => openIssue(i.key)}>{i.key}</button>;
      case 'summary': return <span className="sl-sum" style={{ paddingLeft: sort ? 0 : r.depth * 16, fontWeight: i.role === 'rough' ? 580 : i.role === 'structure' ? 520 : 400 }} title={i.summary}>{i.summary}</span>;
      case 'type': return i.type?.name || '–';
      case 'level': return roleName(i.role);
      case 'status': return <Lozenge status={i.status} />;
      case 'assignee': return i.assignee && !i.assignee.anon ? <span className="row" style={{ gap: 6, minWidth: 0 }}><Avatar user={i.assignee} size={18} /><span className="sl-ellip">{i.assignee.name}</span></span> : <span className="faint">–</span>;
      case 'team': return i.team?.name || <span className="faint">–</span>;
      case 'start': return bar.start != null ? fmt.date(iso(bar.start)) : <span className="faint">–</span>;
      case 'due': return bar.due != null ? <span style={{ color: bar.overdue ? 'var(--bad)' : undefined, fontWeight: bar.overdue ? 600 : undefined }}>{fmt.date(iso(bar.due))}</span> : <span className="faint">–</span>;
      case 'days': return r.days ?? <span className="faint">–</span>;
      case 'oe': case 'ts': case 're': {
        const v = bar[c.id];
        return v ? <span className={i.role === 'estimate' ? '' : 'faint'} title={i.role === 'estimate' ? undefined : tr('Summe der Unterelemente', 'Sum of the items below')}>{fmt.h(v, 1)}</span> : <span className="faint">–</span>;
      }
      case 'progress': return bar.progress != null ? <span className="sl-prog"><span className="sl-prog-bar"><i style={{ width: `${Math.round(bar.progress * 100)}%` }} /></span><b>{fmt.pct(bar.progress)}</b></span> : <span className="faint">–</span>;
      case 'tshirt': return i.tshirt || <span className="faint">–</span>;
      case 'quarters': return (i.quarters || []).map(fmt.quarter).join(', ') || <span className="faint">–</span>;
      case 'flags': return <span className="sl-flags">{r.notes.map((n) => <span key={n.t} className={`chip sl-flag tone-${n.tone}`}>{n.t}</span>)}</span>;
      default: return null;
    }
  };

  const exportXlsx = async () => {
    const base = (await import('../lib/api.js').then((m) => m.getContext()).catch(() => ({})))?.siteUrl || '';
    const xlCols = visibleCols.map((c) => ({ header: c.label, key: c.id, ...c.xl }));
    const xlRows = shown.map((r) => ({
      key: { text: r.i.key, url: base ? `${base}/browse/${r.i.key}` : null }, summary: `${sort ? '' : '  '.repeat(r.depth)}${r.i.summary}`, type: r.i.type?.name || '', level: roleName(r.i.role),
      status: r.i.status?.name || '', assignee: r.i.assignee?.anon ? '' : r.i.assignee?.name || '', team: r.i.team?.name || '', start: iso(r.bar.start), due: iso(r.bar.due), days: r.days,
      oe: r.bar.oe || null, ts: r.bar.ts || null, re: r.bar.re || null, progress: r.bar.progress, tshirt: r.i.tshirt || '', quarters: (r.i.quarters || []).join(', '), flags: r.notes.map((n) => n.t).join(' · '),
    }));
    await downloadWorkbook(tr('projekt-liste', 'project-list'), {
      title: tr('Projekt – Vorgänge', 'Project – work items'), subtitle: `${tr('Stand', 'As of')} ${fmt.dateLong(ds.today)}`,
      kpis: [{ label: tr('Vorgänge', 'Work items'), value: shown.length, type: 'int' }, { label: tr('Überfällig', 'Overdue'), value: data.filter((r) => r.bar.overdue).length, type: 'int' },
        { label: 'Original Estimate', value: sum('oe'), type: 'hours' }, { label: tr('Rest', 'Remaining'), value: sum('re'), type: 'hours' }],
      sheets: [{ name: tr('Vorgänge', 'Work items'), description: tr('Wie in der Liste: Spalten, Reihenfolge und Filter', 'As in the list: columns, order and filters'), rows: xlRows, freezeCols: 2, columns: xlCols }],
    });
  };

  return (
    <div className="sl" data-structure-list>
      <div className="sl-toolbar">
        <span className="faint" style={{ fontSize: 12.5 }}>{sort ? tr('Sortiert – ein dritter Klick auf die Spalte zeigt wieder die Hierarchie.', 'Sorted – a third click on the column shows the hierarchy again.') : tr('Hierarchie-Reihenfolge · Klick auf eine Spalte sortiert.', 'Hierarchy order · click a column to sort.')}</span>
        <span className="grow" />
        {projectRef && <LotseChip skill="timelineBrief" params={{ ref: projectRef }} label={tr('Lotse: Termine zusammenfassen', 'Lotse: summarise the dates')} />}
        <div className="sl-chooser-wrap">
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={chooser} onClick={() => setChooser(!chooser)} data-sl-columns><Icon name="list" size={13} />{tr('Spalten', 'Columns')} <b className="num">{visibleCols.length}</b></button>
          {chooser && (
            <div className="sl-chooser" role="group" aria-label={tr('Spalten wählen', 'Choose columns')}>
              {cols.filter((c) => !c.always).map((c) => (
                <label key={c.id}><input type="checkbox" checked={!hidden.includes(c.id)} onChange={(e) => setHidden(e.target.checked ? hidden.filter((x) => x !== c.id) : [...hidden, c.id])} />{c.label}</label>
              ))}
              <button type="button" className="linkbtn" onClick={() => setHidden(cols.filter((c) => c.off).map((c) => c.id))}>{tr('Standard', 'Default')}</button>
            </div>
          )}
        </div>
        <button type="button" className="btn btn-sm" onClick={exportXlsx} disabled={!shown.length}><Icon name="download" size={13} />Excel</button>
      </div>
      <div className="sl-scroll">
        <table className="sl-table">
          <thead>
            <tr>{visibleCols.map((c) => (
              <th key={c.id} className={`${c.num ? 'num' : ''} sl-${c.id}`} aria-sort={sort?.id === c.id ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => clickSort(c.id)}>{c.label}{sort?.id === c.id && <Icon name={sort.dir === 1 ? 'up' : 'down'} size={11} />}</button>
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.i.id} className={r.bar.overdue ? 'overdue' : ''}>
                {visibleCols.map((c) => <td key={c.id} className={`${c.num ? 'num' : ''} sl-${c.id}`}>{cell(c, r)}</td>)}
              </tr>
            ))}
          </tbody>
          {est.length > 1 && (
            <tfoot>
              <tr>{visibleCols.map((c, k) => (
                <td key={c.id} className={c.num ? 'num' : ''}>
                  {k === 0 ? 'Σ' : c.hours ? fmt.h(sum(c.id), 1) : c.id === 'summary' ? <span className="faint">{tr(`${est.length} Vorgänge mit Schätzung`, `${est.length} estimated work items`)}</span> : ''}
                </td>
              ))}</tr>
            </tfoot>
          )}
        </table>
        {!shown.length && <div className="muted" style={{ padding: 24, textAlign: 'center' }}>{tr('Keine Vorgänge in dieser Auswahl.', 'No work items in this selection.')}</div>}
      </div>
    </div>
  );
}
