import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { enter, popIn, popMark } from '../lib/motion.js';
import { quartersFrom } from '@shared/dates.js';
import { useApp, errText } from '../state.jsx';
import { tr, fmt, healthName } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { openIssue } from '../lib/api.js';

// Planning grid: every project as one editable row – T-shirt size, target quarters, start, due date,
// lead team and health. Each cell saves to Jira (with the user's own permissions) the moment it
// changes and can be undone (toast, Ctrl/⌘ + Z). Rows can be selected to set a value for many at once.
const SK = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

export default function PlanGrid({ ranked, metrics, onHealth, canHealth }) {
  const { fill, config, ds, computed, toast, runUndo, pushUndo } = useApp();
  const sizes = config.tshirtSizes || [];
  const teams = ds.teams || [];
  const quarters = useMemo(() => quartersFrom(computed.model.curQ, 8), [computed.model.curQ]);
  const [cell, setCell] = useState({}); // `${ref}:${usage}` -> 'saving' | 'ok' | 'err'
  const [picked, setPicked] = useState(() => new Set());
  const mark = (k, v) => setCell((c) => ({ ...c, [k]: v }));
  const target = (p) => (p.kind === 'space' ? { ref: p.ref } : { issueId: p.id });

  const save = async (p, usage, value, label) => {
    const k = `${p.ref}:${usage}`;
    mark(k, 'saving');
    try {
      const entry = await fill({ ...target(p), usage, value, label: `${label} · ${p.key || p.name}` });
      mark(k, 'ok');
      setTimeout(() => setCell((c) => (c[k] === 'ok' ? { ...c, [k]: undefined } : c)), 1400);
      toast({ text: tr(`${label} gespeichert – ${p.name}`, `${label} saved – ${p.name}`), icon: 'check', undo: () => runUndo(entry) });
    } catch (e) { mark(k, 'err'); toast({ text: errText(e), error: true }); }
  };

  // One value for all selected rows; one undo reverts all of them.
  const bulk = async (usage, value, label) => {
    const rows = ranked.filter((p) => picked.has(p.ref) && !(usage === 'startDate' && p.kind === 'space'));
    const undos = [], failed = [];
    let next = 0;
    rows.forEach((p) => mark(`${p.ref}:${usage}`, 'saving'));
    const worker = async () => {
      while (next < rows.length) {
        const p = rows[next++];
        try { undos.push(await fill({ ...target(p), usage, value, collectUndo: true })); mark(`${p.ref}:${usage}`, 'ok'); } catch (e) { failed.push(p); mark(`${p.ref}:${usage}`, 'err'); }
      }
    };
    // Space-mode items share one storage record: one at a time.
    await Promise.all(Array.from({ length: rows.some((p) => p.kind === 'space') ? 1 : 4 }, worker));
    if (undos.length) {
      const entry = pushUndo(tr(`${label} für ${undos.length} Projekte`, `${label} for ${undos.length} projects`), async () => { for (const u of undos) await u(); }, undos.map((u) => u.key));
      toast({ text: tr(`${label} für ${undos.length} Projekte gespeichert${failed.length ? ` – ${failed.length} nicht möglich` : ''}`, `${label} saved for ${undos.length} projects${failed.length ? ` – ${failed.length} not possible` : ''}`), icon: 'check', error: !!failed.length && !undos.length, undo: () => runUndo(entry) });
    } else if (failed.length) toast({ text: tr('Keine Änderung gespeichert', 'No change saved'), error: true });
    setTimeout(() => setCell({}), 1600);
  };

  const allPicked = ranked.length > 0 && ranked.every((p) => picked.has(p.ref));
  const toggle = (ref) => setPicked((s) => { const n = new Set(s); if (n.has(ref)) n.delete(ref); else n.add(ref); return n; });
  const state = (p, u) => cell[`${p.ref}:${u}`];

  return (
    <div className="plan">
      {/* enter only, by transform / opacity (no height animation, no exit) */}
      {picked.size > 0 && (
          <motion.div key="bulk" className="plan-bulk" {...enter(0, { y: -6, d: 'quick' })}>
            <b>{tr(`${picked.size} ausgewählt`, `${picked.size} selected`)}</b>
            <span className="muted">{tr('Für alle setzen:', 'Set for all:')}</span>
            <select className="select select-sm" value="" onChange={(e) => e.target.value && bulk('tshirt', e.target.value === '∅' ? null : e.target.value, tr('T-Shirt-Größe', 'T-shirt size'))} aria-label={tr('T-Shirt-Größe für Auswahl', 'T-shirt size for selection')}>
              <option value="">{tr('T-Shirt …', 'T-shirt …')}</option>{sizes.map((s) => <option key={s.key} value={s.key}>{s.key} · {fmt.h(s.hours)}</option>)}<option value="∅">{tr('— leeren —', '— clear —')}</option>
            </select>
            <QuarterPicker quarters={quarters} value={[]} onCommit={(v) => bulk('targetQuarters', v, tr('Ziel-Quartale', 'Target quarters'))} label={tr('Quartale …', 'Quarters …')} />
            <select className="select select-sm" value="" onChange={(e) => e.target.value && bulk('team', e.target.value === '∅' ? null : e.target.value, tr('Lead-Team', 'Lead team'))} aria-label={tr('Lead-Team für Auswahl', 'Lead team for selection')}>
              <option value="">{tr('Team …', 'Team …')}</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}<option value="∅">{tr('— leeren —', '— clear —')}</option>
            </select>
            <label className="row" style={{ gap: 6 }}><span className="muted">{tr('Fällig', 'Due')}</span><input type="date" className="input input-sm" onChange={(e) => e.target.value && bulk('dueDate', e.target.value, tr('Fälligkeit', 'Due date'))} aria-label={tr('Fälligkeit für Auswahl', 'Due date for selection')} /></label>
            <button className="btn btn-ghost btn-xs" onClick={() => setPicked(new Set())}>{tr('Auswahl aufheben', 'Clear selection')}</button>
          </motion.div>
      )}
      <div className="table-scroll" tabIndex={0} role="region" aria-label={tr('Planung bearbeiten', 'Edit planning')}>
        <table className="table plan-table">
          <thead>
            <tr>
              <th style={{ width: 34 }}><input type="checkbox" className="pick" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(ranked.map((p) => p.ref)))} aria-label={tr('Alle auswählen', 'Select all')} /></th>
              <th>{tr('Rang', 'Rank')}</th><th>{tr('Projekt', 'Project')}</th><th>{tr('T-Shirt', 'T-shirt')}</th><th>{tr('Ziel-Quartale', 'Target quarters')}</th>
              <th>Start</th><th>{tr('Fällig', 'Due')}</th><th>{tr('Lead-Team', 'Lead team')}</th><th>Health</th><th style={{ textAlign: 'right' }}>{tr('Fortschritt', 'Progress')}</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => {
              const m = metrics.get(p.ref) || {};
              const size = sizes.find((s) => SK(s.key) === SK(p.tshirt) || SK(p.tshirt).split(/[\s(]/)[0] === SK(s.key));
              return (
                <tr key={p.ref} className={picked.has(p.ref) ? 'picked' : m.done ? 'done' : undefined}>
                  <td><input type="checkbox" className="pick" checked={picked.has(p.ref)} onChange={() => toggle(p.ref)} aria-label={`${tr('Auswählen', 'Select')}: ${p.name}`} /></td>
                  <td className="num" style={{ fontWeight: 600 }}>{p.rank}</td>
                  <td style={{ minWidth: 200 }}>
                    <div style={{ fontWeight: 560 }}>{p.name}</div>
                    <div className="row muted" style={{ gap: 6, fontSize: 12 }}>{p.kind === 'issue' && <button className="tkey" onClick={() => openIssue(p.key)}>{p.key}</button>}{p.owner?.name && <span>{p.owner.name}</span>}</div>
                  </td>
                  <Cell st={state(p, 'tshirt')}>
                    <select className="select select-sm" value={size?.key || (p.tshirt ? `__${p.tshirt}` : '')} onChange={(e) => save(p, 'tshirt', e.target.value || null, tr('T-Shirt-Größe', 'T-shirt size'))} aria-label={`${tr('T-Shirt-Größe', 'T-shirt size')} – ${p.name}`}>
                      <option value="">–</option>
                      {p.tshirt && !size && <option value={`__${p.tshirt}`} disabled>{p.tshirt} ({tr('unbekannt', 'unknown')})</option>}
                      {sizes.map((s) => <option key={s.key} value={s.key}>{s.key} · {fmt.h(s.hours)}</option>)}
                    </select>
                  </Cell>
                  <Cell st={state(p, 'targetQuarters')}>
                    <QuarterPicker quarters={quarters} value={p.quarters || []} onCommit={(v) => save(p, 'targetQuarters', v, tr('Ziel-Quartale', 'Target quarters'))} label={`${tr('Ziel-Quartale', 'Target quarters')} – ${p.name}`} />
                  </Cell>
                  <Cell st={state(p, 'startDate')}>
                    <input type="date" className="input input-sm" value={p.start || ''} disabled={p.kind === 'space'} title={p.kind === 'space' ? tr('Bei Spaces ergibt sich der Start aus den Stories', 'For spaces the start comes from the stories') : undefined}
                      onChange={(e) => save(p, 'startDate', e.target.value || null, tr('Start', 'Start'))} aria-label={`Start – ${p.name}`} />
                  </Cell>
                  <Cell st={state(p, 'dueDate')}>
                    <input type="date" className={`input input-sm${m.daysOverdue > 0 ? ' overdue' : ''}`} value={p.due || ''} onChange={(e) => save(p, 'dueDate', e.target.value || null, tr('Fälligkeit', 'Due date'))} aria-label={`${tr('Fällig', 'Due')} – ${p.name}`} />
                  </Cell>
                  <Cell st={state(p, 'team')}>
                    <select className="select select-sm" value={p.leadTeam?.id || ''} onChange={(e) => save(p, 'team', e.target.value || null, tr('Lead-Team', 'Lead team'))} aria-label={`${tr('Lead-Team', 'Lead team')} – ${p.name}`}>
                      <option value="">–</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      {p.leadTeam && !teams.some((t) => t.id === p.leadTeam.id) && <option value={p.leadTeam.id}>{p.leadTeam.name || p.leadTeam.id}</option>}
                    </select>
                  </Cell>
                  <td>
                    <button className="btn btn-ghost btn-xs plan-health" onClick={() => onHealth(p)} disabled={!canHealth(p)} title={canHealth(p) ? tr('Health aktualisieren', 'Update health') : tr('Nur Owner und die Health-Gruppe', 'Owners and the health group only')}>
                      <span className={`health ${p.health?.status || 'none'}`} />{p.health ? healthName(p.health.status) : tr('kein Update', 'no update')}
                    </button>
                  </td>
                  <td className="num" style={{ textAlign: 'right' }}>{fmt.pct(m.progress || 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="faint" style={{ fontSize: 12, padding: '10px 20px' }}>{tr('Jede Änderung wird sofort in Jira gespeichert (mit deinen Rechten) und lässt sich mit Strg/⌘ + Z rückgängig machen. Mehrere Zeilen auswählen, um einen Wert für alle zu setzen.', 'Every change is saved to Jira immediately (with your permissions) and can be undone with Ctrl/⌘ + Z. Select several rows to set one value for all.')}</div>
    </div>
  );
}

function Cell({ st, children }) {
  return (
    <td className={`plan-cell${st ? ` is-${st}` : ''}`} aria-busy={st === 'saving' ? 'true' : undefined}>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        {children}
        {st === 'ok' && <motion.span key="ok" className="plan-ok" role="img" {...popMark()} aria-label={tr('gespeichert', 'saved')}><Icon name="check" size={13} /></motion.span>}
      </div>
    </td>
  );
}

// Compact quarter chips; a click opens toggles for the next eight quarters.
function QuarterPicker({ quarters, value, onCommit, label }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(() => new Set(value));
  const ref = useRef(null);
  useEffect(() => { if (open) setSel(new Set(value)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const k = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  const all = [...new Set([...quarters, ...value])].sort();
  return (
    <div className="qpick" ref={ref}>
      <button type="button" className="qpick-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={label}>
        {value.length ? value.map((q) => <span key={q} className="chip chip-outline">{fmt.quarter(q)}</span>) : <span className="faint">–</span>}
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
          <motion.div className="qpick-pop" role="dialog" aria-label={label} {...popIn()}>
            <div className="qpick-grid">
              {all.map((q) => (
                <button key={q} type="button" className={`chip ${sel.has(q) ? 'chip-accent' : 'chip-outline'}`} aria-pressed={sel.has(q)} onClick={() => setSel((s) => { const n = new Set(s); if (n.has(q)) n.delete(q); else n.add(q); return n; })}>{fmt.quarter(q)}</button>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
              <button className="btn btn-ghost btn-xs" onClick={() => setOpen(false)}>{tr('Abbrechen', 'Cancel')}</button>
              <button className="btn btn-primary btn-xs" onClick={() => { setOpen(false); const v = [...sel].sort(); if (v.join() !== [...value].sort().join()) onCommit(v.length ? v : null); }}>{tr('Übernehmen', 'Apply')}</button>
            </div>
          </motion.div>
      )}
    </div>
  );
}
