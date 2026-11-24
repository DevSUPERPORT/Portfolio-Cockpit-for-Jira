import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { dependencies } from '@shared/engine.js';
import { dayIdx, isoOf } from '@shared/dates.js';
import { useApp } from '../state.jsx';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { exportDependencies } from '../lib/books.js';
import { openIssue } from '../lib/api.js';
import { Stat, Switch, Empty, useTip, stagger, spring, Lozenge } from '../components/ui.jsx';

export default function Dependencies() {
  const { ds, computed } = useApp();
  const { model } = computed;
  const ranked = useMemo(() => [...ds.portfolio].sort((a, b) => a.rank - b.rank), [ds.portfolio]);
  const [scope, setScope] = useState(() => new Set());
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [all, setAll] = useState(false);
  const refs = scope.size ? scope : null;
  const deps = useMemo(() => dependencies(model, refs), [model, refs]);
  const list = deps.list.filter((d) => (!onlyOpen || d.open) && (!onlyConflicts || d.conflict));
  const get = (id) => model.byId.get(id) || model.external.get(id);
  const toggle = (ref) => setScope((s) => { const n = new Set(s); if (n.has(ref)) n.delete(ref); else n.add(ref); return n; });
  const typeNames = (ds.config?.dependencies?.linkTypeIds || []).length;
  const app = useApp();
  const exportDeps = () => exportDependencies(app, list).catch((e) => app.toast({ text: e.message, error: true }));
  return (
    <div className="page">
      <div className="stats">
        <Stat i={0} label={tr('Offene Abhängigkeiten', 'Open dependencies')} value={deps.open} foot={tr('beide Seiten noch offen', 'both sides still open')}
          explain={{ text: tr('Verknüpfungen mit dem konfigurierten Abhängigkeitstyp, bei denen Voraussetzung und abhängiger Vorgang beide noch offen sind.', 'Links of the configured dependency type where the prerequisite and the dependent item are both still open.'), calc: tr(`${deps.open} offen von ${deps.list.length} Abhängigkeiten`, `${deps.open} open of ${deps.list.length} dependencies`), items: deps.list.filter((d) => d.open).map((d) => ({ text: `${get(d.pre)?.key || ''} → ${get(d.dep)?.key || ''}`, sub: `${get(d.pre)?.summary || ''} → ${get(d.dep)?.summary || ''}`, tone: d.conflict ? 'bad' : 'ok' })), itemsTitle: tr('Voraussetzung → abhängig', 'Prerequisite → dependent') }} />
        <Stat i={1} label={tr('Terminkonflikte', 'Schedule conflicts')} value={deps.conflicts} hot={deps.conflicts > 0} foot={tr('Due Date Voraussetzung > Start abhängiger Vorgang', 'prerequisite due > dependent start')}
          explain={{ text: tr('Die Voraussetzung wird erst nach dem Start des abhängigen Vorgangs fertig – einer der beiden Termine muss sich bewegen.', 'The prerequisite finishes only after the dependent item starts – one of the two dates has to move.'), calc: tr(`${deps.conflicts} Konflikte unter ${deps.open} offenen Abhängigkeiten`, `${deps.conflicts} conflicts among ${deps.open} open dependencies`), items: deps.list.filter((d) => d.conflict).map((d) => ({ text: `${get(d.pre)?.key || ''} → ${get(d.dep)?.key || ''}`, sub: tr(`Voraussetzung fertig ${fmt.date(get(d.pre)?.due)}, Start ${fmt.date(get(d.dep)?.start)} · ${d.conflictDays} Tage Überschneidung`, `prerequisite done ${fmt.date(get(d.pre)?.due)}, start ${fmt.date(get(d.dep)?.start)} · ${d.conflictDays} days overlap`), tone: 'bad' })), itemsTitle: tr('Konflikte', 'Conflicts') }} />
        <Stat i={2} label={tr('Fehlende Hinweise', 'Missing notes')} value={deps.missingNotes} hot={deps.missingNotes > 0} foot={tr('„Kein Hinweis gepflegt"', '"No note maintained"')}
          explain={{ text: tr('Offene Abhängigkeiten ohne Hinweis im Feld „Abhängigkeits-Hinweis“ – niemand weiß, worauf genau gewartet wird.', 'Open dependencies without a text in the dependency note field – nobody knows what exactly is being waited for.'), calc: tr(`${deps.missingNotes} von ${deps.open} offenen ohne Hinweis`, `${deps.missingNotes} of ${deps.open} open without a note`), items: deps.list.filter((d) => d.missingNote).map((d) => ({ text: `${get(d.pre)?.key || ''} → ${get(d.dep)?.key || ''}`, sub: get(d.dep)?.summary || '', tone: 'warn' })), itemsTitle: tr('Ohne Hinweis', 'Without a note') }} />
        <Stat i={3} label={tr('Blockiert', 'Blocked')} value={deps.blocked.length} hot={deps.blocked.length > 0} foot={tr('Stories und Sub-tasks im Status Blocked', 'stories and sub-tasks in the Blocked status')}
          onClick={deps.blocked.length ? () => document.getElementById('dep-blocked')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : undefined} />
      </div>
      <Blocked blocked={deps.blocked} get={get} scopeName={scope.size === 1 ? ranked.find((p) => scope.has(p.ref))?.name : null} />
      {!typeNames ? (
        <div className="card"><Empty icon="link" title={tr('Keine Link-Typen konfiguriert', 'No link types configured')}>{tr('Ein Jira-Admin legt in der Konfiguration fest, welche Link-Typen als Abhängigkeit zählen.', 'A Jira admin defines in the configuration which link types count as dependencies.')}</Empty></div>
      ) : <>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className={`chip ${scope.size === 0 ? 'chip-accent' : 'chip-outline'}`} onClick={() => setScope(new Set())} style={{ height: 30, padding: '0 12px' }}>{tr('Alle Projekte', 'All projects')}</button>
          {ranked.map((p) => (
            <motion.button key={p.ref} whileTap={{ scale: 0.95 }} className={`chip ${scope.has(p.ref) ? 'chip-accent' : 'chip-outline'}`} style={{ height: 30, padding: '0 12px' }} onClick={() => toggle(p.ref)} aria-pressed={scope.has(p.ref)}>
              <span className="num faint">{p.rank}</span>{p.name}
            </motion.button>
          ))}
        </div>
        <Timeline list={list.filter((d) => d.open).slice(0, all ? 200 : 18)} get={get} total={list.filter((d) => d.open).length} all={all} setAll={setAll} />
        <section className="card">
          <div className="card-head">
            <h2 className="card-title"><Icon name="link" />{tr('Alle Abhängigkeiten', 'All dependencies')} <span className="chip num">{list.length}</span></h2>
            <div className="row"><Switch on={onlyOpen} onChange={setOnlyOpen} label={tr('Nur offene', 'Open only')} /><Switch on={onlyConflicts} onChange={setOnlyConflicts} label={tr('Nur Konflikte', 'Conflicts only')} /><button className="btn btn-sm" onClick={exportDeps} title={tr('Diese Auswahl als Excel herunterladen', 'Download this selection as Excel')}><Icon name="download" size={13} />Excel</button></div>
          </div>
          {list.length === 0 ? <Empty icon="check" title={tr('Keine Abhängigkeiten in dieser Auswahl', 'No dependencies in this selection')} /> : (
            <div className="table-scroll" tabIndex={0} role="region" aria-label={tr('Tabelle, mit Pfeiltasten scrollbar', 'Table, scrollable with arrow keys')} style={{ maxHeight: 640 }}>
              <table className="table">
                <thead><tr><th>{tr('Voraussetzung', 'Prerequisite')}</th><th>{tr('Beziehung', 'Relation')}</th><th>{tr('Abhängiger Vorgang', 'Dependent work item')}</th><th>{tr('Abhängigkeits-Hinweis', 'Dependency note')}</th><th title={tr('Jira-Status der Voraussetzung', 'Jira status of the prerequisite')}>Status</th><th>{tr('Termin', 'Schedule')}</th></tr></thead>
                <tbody>
                  {list.map((d, i) => {
                    const pre = get(d.pre), dep = get(d.dep);
                    return (
                      <motion.tr key={d.id} {...stagger(i, 0.012)}>
                        <td><IssueCell i={pre} date={pre.due} dateLabel="Due" warn={d.conflict} /></td>
                        <td><span className="chip chip-outline">{d.relation}</span></td>
                        <td><IssueCell i={dep} date={dep.start} dateLabel="Start" warn={d.conflict} /></td>
                        <td style={{ maxWidth: 280 }}>{d.note ? <span>{d.note}</span> : <span className="chip chip-missing req">{tr('Kein Hinweis gepflegt', 'No note maintained')}</span>}</td>
                        <td><StatusPill i={pre} /></td>
                        <td>{d.conflict ? <span className="chip chip-bad"><Icon name="alert" size={12} />{tr('Konflikt', 'Conflict')} +{d.conflictDays} {tr('T', 'd')}</span> : d.open ? <span className="chip chip-info">{tr('Offen', 'Open')}</span> : <span className="chip chip-ok">{tr('Erledigt', 'Done')}</span>}</td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </>}
    </div>
  );
}

// Jira status as a pill; the company's Blocked status stands out.
function StatusPill({ i }) {
  const { computed } = useApp();
  if (!i?.status) return <span className="faint">–</span>;
  const blocked = computed.model.isBlocked(i);
  return <span className={`chip ${blocked ? 'chip-accent' : i.status.cat === 'done' ? 'chip-ok' : i.status.cat === 'indeterminate' ? 'chip-info' : 'chip-outline'}`} style={{ height: 22 }}>{i.status.name || '–'}</span>;
}

// Stories and sub-tasks in the Blocked status, oldest first: since when (last change to Blocked in the Jira
// history), the reason (latest comment) and what they wait for or hold up – via the configured link types.
function Blocked({ blocked, get, scopeName }) {
  const { computed } = useApp();
  const { model } = computed;
  const tip = useTip();
  const name = (ref) => model.itemByRef.get(ref);
  const label = (id) => { const x = get(id); return x ? `${x.key} ${x.summary || ''}${x.status?.name ? ` (${x.status.name})` : ''}` : id; };
  return (
    <section className="card" id="dep-blocked">
      <div className="card-head">
        <div>
          <h2 className="card-title"><Icon name="alert" />{tr('Blockiert', 'Blocked')} <span className="chip num">{blocked.length}</span></h2>
          <div className="card-sub" style={{ marginTop: 3, maxWidth: 820 }}>{tr('Stories und Sub-tasks im Status Blocked, älteste zuerst. „Seit\" ist der letzte Wechsel nach Blocked. Ohne Jira-Verknüpfung steht der Grund nur im Kommentar.', 'Stories and sub-tasks in the Blocked status, oldest first. "Since" is the last change to Blocked. Without a Jira link the reason is only in the comment.')}</div>
        </div>
      </div>
      {blocked.length === 0 ? <Empty icon="check" title={scopeName ? tr(`Keine blockierten Vorgänge in ${scopeName}.`, `No blocked work items in ${scopeName}.`) : tr('Keine blockierten Vorgänge.', 'No blocked work items.')} /> : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label={tr('Blockierte Vorgänge, mit Pfeiltasten scrollbar', 'Blocked work items, scrollable with arrow keys')}>
          <table className="table">
            <thead><tr><th>{tr('Vorgang', 'Work item')}</th><th>{tr('Projekt', 'Project')}</th><th>Team · Assignee</th><th>{tr('Seit', 'Since')}</th><th>{tr('Wartet auf · blockiert selbst', 'Waiting for · blocking')}</th></tr></thead>
            <tbody>
              {blocked.map((b, k) => {
                const i = model.byId.get(b.id);
                if (!i) return null;
                const parent = i.parentId ? model.byId.get(i.parentId) : null;
                const p = name(i.rootRef);
                const old = b.days != null && b.days > 7;
                return (
                  <motion.tr key={b.id} {...stagger(k, 0.015)}>
                    <td>
                      <div className="row" style={{ gap: 8 }}><span className="chip chip-accent" style={{ height: 20 }}>{i.status.name || 'Blocked'}</span><button className="tkey" onClick={() => openIssue(i.key)}>{i.key}</button></div>
                      <div style={{ marginTop: 3, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.summary}</div>
                      <div className="faint" style={{ fontSize: 12 }}>{i.type?.name}{parent && i.role === 'tiny' ? ` ${tr('von', 'of')} ${parent.key}` : ''}</div>
                    </td>
                    <td>{p ? <><span className="num faint">{p.rank} · </span>{p.name}</> : '–'}{parent && i.role !== 'tiny' ? <div className="faint" style={{ fontSize: 12 }}>{parent.summary}</div> : null}</td>
                    <td>{i.team?.name || '–'}<div className="faint" style={{ fontSize: 12 }}>{i.assignee?.name || tr('kein Assignee', 'no assignee')}</div></td>
                    <td>{b.days == null ? <span className="faint" {...tip(<div>{tr('Der Wechsel nach Blocked ist in der Jira-Historie nicht sichtbar.', 'The change to Blocked is not visible in the Jira history.')}</div>)}>–</span>
                      : <><b style={{ color: old ? 'var(--bad)' : undefined }}>{b.days === 1 ? tr('1 Tag', '1 day') : tr(`${b.days} Tage`, `${b.days} days`)}</b><div className="faint" style={{ fontSize: 12 }}>{tr('seit', 'since')} {fmt.date(b.since)}</div></>}</td>
                    <td style={{ maxWidth: 380 }}>
                      {b.waitsOn.length ? <div>{tr('Wartet auf', 'Waiting for')} {b.waitsOn.map(label).join(', ')}</div> : <div className="faint">{tr('Keine Jira-Verknüpfung', 'No Jira link')}</div>}
                      {b.reason && <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{tr('Kommentar', 'Comment')}: {b.reason}</div>}
                      {b.blocks.length > 0 && <div style={{ color: 'var(--bad)', fontSize: 12.5, marginTop: 2 }}>{tr('Blockiert selbst', 'Itself blocking')} {b.blocks.map(label).join(', ')}</div>}
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function IssueCell({ i, date, dateLabel, warn }) {
  const { computed } = useApp();
  const proj = i.rootRef ? computed.model.itemByRef.get(i.rootRef) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <div className="row" style={{ gap: 8 }}>
        <button className="tkey" onClick={() => openIssue(i.key)}>{i.key}</button>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{i.summary}</span>
      </div>
      <div className="row muted" style={{ gap: 8, fontSize: 12 }}>
        <span>{proj ? proj.name : tr('außerhalb des Portfolios', 'outside the portfolio')}</span>
        {i.team && <span>· {i.team.name}</span>}
        <span style={{ color: warn ? 'var(--bad)' : undefined }}>· {dateLabel} {fmt.date(date)}</span>
        <Lozenge status={i.status} />
      </div>
    </div>
  );
}

// Each dependency drawn from the prerequisite's due date to the dependent's start: a backwards arrow is a conflict.
function Timeline({ list, get, total, all, setAll }) {
  const tip = useTip();
  const { computed } = useApp();
  const today = computed.model.today;
  const pts = list.flatMap((d) => [dayIdx(get(d.pre).due), dayIdx(get(d.dep).start)]).filter((x) => x != null);
  if (!list.length || !pts.length) return null;
  const lo = Math.min(today - 7, ...pts) - 4, hi = Math.max(today + 21, ...pts) + 4;
  const x = (d) => `${((d - lo) / (hi - lo)) * 100}%`;
  const months = [];
  for (let d = lo; d <= hi; d++) if (isoOf(d).endsWith('-01')) months.push(d);
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title"><Icon name="calendar" />{tr('Abhängigkeiten im Zeitverlauf', 'Dependencies over time')}</h2>
        <div className="bar-legend">
          <span><i style={{ background: 'var(--ink)', borderRadius: 99, width: 8 }} />Due {tr('Voraussetzung', 'prerequisite')}</span>
          <span><i style={{ border: '2px solid var(--ink)', borderRadius: 99, width: 8 }} />Start {tr('abhängig', 'dependent')}</span>
          <span><i style={{ background: 'var(--accent)' }} />{tr('Konflikt', 'conflict')}</span>
        </div>
      </div>
      <div style={{ padding: '10px 20px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: 12 }}>
          <span />
          <div style={{ position: 'relative', height: 20 }}>
            {months.map((d) => <span key={d} style={{ position: 'absolute', left: x(d), fontSize: 11, color: 'var(--ink-3)', transform: 'translateX(-2px)' }}>{fmt.date(isoOf(d), { month: 'short' })}</span>)}
          </div>
        </div>
        <div style={{ position: 'relative' }}>
          {list.map((d, k) => {
            const pre = get(d.pre), dep = get(d.dep);
            const a = dayIdx(pre.due), b = dayIdx(dep.start);
            const has = a != null && b != null;
            const left = has ? Math.min(a, b) : a ?? b, right = has ? Math.max(a, b) : a ?? b;
            return (
              <motion.div key={d.id} style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: 12, alignItems: 'center', height: 32 }} {...stagger(k, 0.03)}>
                <div className="row" style={{ gap: 6, fontSize: 12, minWidth: 0 }}>
                  <span className="mono">{pre.key}</span><Icon name="arrowRight" size={12} style={{ color: d.conflict ? 'var(--accent)' : 'var(--ink-3)', flex: 'none' }} /><span className="mono">{dep.key}</span>
                  {!d.note && <span title={tr('Kein Hinweis', 'No note')} style={{ width: 6, height: 6, borderRadius: 9, background: 'var(--accent)', flex: 'none' }} />}
                </div>
                <div style={{ position: 'relative', height: 32 }} {...tip(<div><b>{pre.key}</b> {tr('muss fertig sein vor', 'must finish before')} <b>{dep.key}</b>
                  <div className="tt-grid"><span>Due {pre.key}</span><span>{fmt.dateLong(pre.due)}</span><span>Start {dep.key}</span><span>{fmt.dateLong(dep.start)}</span>{d.conflict && <><span>{tr('Konflikt', 'Conflict')}</span><span>+{d.conflictDays} {tr('Tage', 'days')}</span></>}</div>
                  <div style={{ marginTop: 6, opacity: 0.85 }}>{d.note || tr('Kein Hinweis gepflegt', 'No note maintained')}</div></div>)} tabIndex={0}>
                  <span style={{ position: 'absolute', left: 0, right: 0, top: 15.5, height: 1, background: 'var(--line-soft)' }} />
                  {has && <motion.span initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.15 + k * 0.03, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    style={{ position: 'absolute', left: x(left), width: `calc(${x(right)} - ${x(left)})`, top: 13, height: 6, borderRadius: 6, transformOrigin: d.conflict ? 'right' : 'left',
                      background: d.conflict ? 'repeating-linear-gradient(-45deg, var(--accent) 0 4px, color-mix(in srgb, var(--accent) 50%, transparent) 4px 8px)' : 'color-mix(in srgb, var(--ink) 22%, transparent)' }} />}
                  {a != null && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring, delay: 0.2 + k * 0.03 }} style={{ position: 'absolute', left: x(a), top: 10, width: 12, height: 12, marginLeft: -6, borderRadius: 99, background: d.conflict ? 'var(--accent)' : 'var(--ink)' }} />}
                  {b != null && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ ...spring, delay: 0.25 + k * 0.03 }} style={{ position: 'absolute', left: x(b), top: 10, width: 12, height: 12, marginLeft: -6, borderRadius: 99, background: 'var(--surface)', border: `2.5px solid ${d.conflict ? 'var(--accent)' : 'var(--ink)'}` }} />}
                </div>
              </motion.div>
            );
          })}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(242px + (100% - 242px) * ${(today - lo) / (hi - lo)})`, width: 0, borderLeft: '1.5px dashed var(--accent)', pointerEvents: 'none' }}>
            <span style={{ position: 'absolute', top: -20, left: -18, fontSize: 10.5, fontWeight: 650, color: 'var(--accent-strong)' }}>{tr('heute', 'today')}</span>
          </div>
        </div>
        <AnimatePresence>{total > 18 && <motion.div className="row" style={{ justifyContent: 'center', marginTop: 10 }}><button className="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>{all ? tr('Weniger anzeigen', 'Show less') : tr(`Alle ${total} offenen anzeigen`, `Show all ${total} open`)}</button></motion.div>}</AnimatePresence>
      </div>
    </section>
  );
}
