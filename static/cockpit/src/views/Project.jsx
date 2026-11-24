import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { dataQuality, actionItems, milestoneOf } from '@shared/engine.js';
import { projectKpis, projectWeeks, definitions } from '@shared/kpis.js';
import { dayIdx, isoOf } from '@shared/dates.js';
import { KpiTiles, Legend } from '../components/KpiTiles.jsx';
import { aiOn } from '../lib/aiFlags.js';
import AiAssist from '../components/AiAssist.jsx';
import { LotseChip } from '../components/lotse/LotseChip.jsx';
import { useApp, errText } from '../state.jsx';
import { parentChoices } from '@shared/orphans.js';
import { tr, fmt, ruleName, usageName } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { openIssue } from '../lib/api.js';
import GapBox from '../components/GapBox.jsx';
import WeekBoard from '../components/WeekBoard.jsx';
import ProjectYear from '../components/ProjectYear.jsx';
import { Prof } from '../lib/virtual.jsx';
import { canPlan } from '@shared/weekPlan.js';
import { Avatar, HealthDot, Ring, Segmented, Switch, Empty, useTip, spring, Counter, stagger, Lozenge, infoCard } from '../components/ui.jsx';
import StructureTimeline, { usePref } from '../components/StructureTimeline.jsx';
import StructureList from '../components/StructureList.jsx';

// Timeline and list of the structure: project admins and above (boss 2026-11-19). They show the same work items as the
// tree (no extra data) – the tree stays for everyone with the Projects tab.
export const canStructureViews = (roles) => !!roles?.admin || (roles?.roleNames || []).some((r) => r === 'projectAdmin' || r === 'management' || r === 'jiraAdmin');

export default function Project() {
  const { ds, computed, selectedRef, selectProject, boot, config } = useApp();
  const ranked = useMemo(() => {
    let list = [...ds.portfolio].sort((a, b) => a.rank - b.rank);
    const pc = boot.projectCtx;
    if (pc) list = list.filter((p) => p.ref === `space:${pc.id}` || p.projectKey === pc.key || (computed.model.byRoot.get(p.ref) || []).some((i) => i.projectKey === pc.key));
    return list;
  }, [ds.portfolio, boot.projectCtx, computed.model]);
  const current = ranked.find((p) => p.ref === selectedRef) || ranked[0];
  // Where is the problem? Per project the share of the tab badge (urgent missing values + date conflicts),
  // plus everything else that needs action, for the hover card on the pill (boss feedback 2026-11-11).
  const issues = useMemo(() => {
    const { model, metrics, wl, deps } = computed;
    const out = new Map();
    // counted once for all projects (the same numbers as one filter per project)
    const urgentBy = new Map();
    for (const g of computed.dq.gaps) if (g.urgent) urgentBy.set(g.rootRef, (urgentBy.get(g.rootRef) || 0) + 1);
    // a conflict counts once: at the waiting project – or at the prerequisite's project when the waiting work item is outside the portfolio
    const home = (d) => { const w = (model.byId.get(d.dep) || model.external?.get(d.dep))?.rootRef; return w && model.itemByRef.has(w) ? w : (model.byId.get(d.pre) || model.external?.get(d.pre))?.rootRef; };
    const conflictsBy = new Map();
    for (const d of deps?.list || []) if (d.conflict) { const h = home(d); conflictsBy.set(h, (conflictsBy.get(h) || 0) + 1); }
    for (const p of ranked) {
      const m = metrics.get(p.ref);
      if (!m) continue;
      const refs = new Set([p.ref]);
      const dq = dataQuality(model, refs);
      const items = actionItems(model, p, m, wl, deps, dq);
      const count = (k) => items.filter((a) => a.kind === k).length;
      // the same sources as the tab badge, each conflict counted once – at the project that waits
      const urgentGaps = urgentBy.get(p.ref) || 0;
      const conflicts = conflictsBy.get(p.ref) || 0;
      out.set(p.ref, { badge: urgentGaps + conflicts, urgentGaps, conflicts, overdue: count('overdue'), capacity: count('capacity'), absence: count('absence'), gaps: dq.gaps.length });
    }
    return out;
  }, [computed, ranked]);
  const tipFn = useTip();
  const pillCard = (p, x) => infoCard({
    title: `${p.rank}. ${p.name}`,
    text: x.badge ? tr('Die Zahl am Projekt = dringende fehlende Werte + Terminkonflikte (wie die Zahl am Tab „Projekte“).', 'The number on the project = urgent missing values + date conflicts (like the number on the "Projects" tab).') : tr('Nichts Dringendes in diesem Projekt.', 'Nothing urgent in this project.'),
    items: [
      x.conflicts ? { text: tr(`${x.conflicts} Terminkonflikt${x.conflicts === 1 ? '' : 'e'}`, `${x.conflicts} date conflict${x.conflicts === 1 ? '' : 's'}`), tone: 'bad' } : null,
      x.urgentGaps ? { text: tr(`${x.urgentGaps} dringende fehlende Werte`, `${x.urgentGaps} urgent missing values`), sub: tr(`von ${x.gaps} fehlenden Werten`, `of ${x.gaps} missing values`), tone: 'bad' } : null,
      x.overdue ? { text: tr(`${x.overdue} über dem Due Date`, `${x.overdue} past their due date`), tone: 'warn' } : null,
      x.capacity ? { text: tr(`${x.capacity} Kapazitätsengpässe`, `${x.capacity} capacity bottlenecks`), tone: 'warn' } : null,
      x.absence ? { text: tr(`${x.absence} Abwesenheiten bei offenen Stories`, `${x.absence} absences on open stories`), tone: 'warn' } : null,
      !x.badge && x.gaps ? { text: tr(`${x.gaps} fehlende Werte (nicht dringend)`, `${x.gaps} missing values (not urgent)`), tone: 'ok' } : null,
    ].filter(Boolean),
    itemsTitle: tr('Handlungsbedarf', 'Action needed'),
  });
  useEffect(() => { if (current && current.ref !== selectedRef) selectProject(current.ref); }, [current, selectedRef, selectProject]);
  if (!current) {
    return <div className="page"><Empty icon="project" title={boot.projectCtx ? tr('Dieser Space ist (noch) nicht im Portfolio', 'This space is not in the portfolio (yet)') : tr('Noch keine Projekte', 'No projects yet')}>
      {tr('Sobald das Management ein Projekt aufnimmt, siehst du hier Struktur, Kennzahlen und Handlungsbedarf.', 'Once management adds a project you will see its structure, key figures and actions here.')}</Empty></div>;
  }
  return (
    <div className="page">
      <div className="pills" role="group" aria-label={tr('Projekt wählen', 'Choose project')}>
        {ranked.map((p) => (
          <button key={p.ref} className="pill" data-ref={p.ref} aria-pressed={p.ref === current.ref} onClick={() => selectProject(p.ref)} {...(issues.get(p.ref) ? tipFn(pillCard(p, issues.get(p.ref))) : {})}>
            {p.ref === current.ref && <motion.span layoutId="pill-bg" className="pill-bg" transition={spring} />}
            <span className="pill-rank">{p.rank}</span>
            <HealthDot health={p.health} rhythmDays={config.rules?.healthRhythmDays} />
            <span>{p.name}</span>
            {issues.get(p.ref)?.badge > 0 && <motion.span className="pill-badge" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} aria-label={tr(`${issues.get(p.ref).badge} dringend`, `${issues.get(p.ref).badge} urgent`)}>{issues.get(p.ref).badge}</motion.span>}
          </button>
        ))}
      </div>
      {/* switches at once (fade in only): the numbers on screen always belong to the chosen project */}
      <motion.div key={current.ref} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} className="stack" style={{ gap: 20 }}>
        <Details p={current} />
      </motion.div>
    </div>
  );
}

function Details({ p }) {
  const { computed, config, ds, openAssistant, lang, setView } = useApp();
  const { model, metrics, wl, deps } = computed;
  const m = metrics.get(p.ref);
  const refs = useMemo(() => new Set([p.ref]), [p.ref]);
  const dq = useMemo(() => dataQuality(model, refs), [model, refs]);
  // missing values have their own box next to it (prototype); the list keeps capacity, dependencies, due dates, absences
  const actions = useMemo(() => actionItems(model, p, m, wl, deps, dq).filter((a) => a.kind !== 'gap'), [model, p, m, wl, deps, dq]);
  const gapScope = useMemo(() => ({ project: p.ref }), [p.ref]);
  const milestones = useMemo(() => {
    const set = new Map();
    for (const i of model.byRoot.get(p.ref) || []) { const ms = milestoneOf(model, i); if (ms) set.set(ms.id, ms); }
    return [...set.values()];
  }, [model, p.ref]);
  const capRef = useRef(null);
  const structRef = useRef(null);
  const actRef = useRef(null);
  const gapRef = useRef(null);
  const [legend, setLegend] = useState(false);
  // Every tile, its breakdown and the legend come from the one KPI registry (shared/kpis.js).
  const kpis = useMemo(() => projectKpis({ computed, ref: p.ref, lang, fmt, people: ds.people || {}, usageName, ruleName }), [computed, p.ref, lang, ds.people]); // eslint-disable-line react-hooks/exhaustive-deps
  const jump = (area) => {
    ({ structure: structRef, actions: actRef, deps: actRef, quality: gapRef, gaps: gapRef, capacity: capRef }[area])?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <>
      <section className="card hero">
        <motion.div className="hero-rank" initial={{ scale: 0.7, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>{p.rank}</motion.div>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">{tr('Rang', 'Rank')} {p.rank} · <span className="mono">{p.key}</span></div>
          <h1 className="h1" style={{ marginTop: 4 }}>{p.name}</h1>
          <div className="hero-meta">
            {p.owner && <span className="chip"><Avatar user={p.owner} size={18} />{p.owner.name}</span>}
            <span className={`chip ${p.health ? { onTrack: 'chip-ok', atRisk: 'chip-warn', critical: 'chip-bad' }[p.health.status] : 'chip-outline'}`}><HealthDot health={p.health} rhythmDays={config.rules?.healthRhythmDays} size={8} />{p.health ? { onTrack: tr('Im Plan', 'On track'), atRisk: tr('Gefährdet', 'At risk'), critical: tr('Kritisch', 'Critical') }[p.health.status] : tr('Kein Health-Update', 'No health update')}</span>
            {m.due && <span className={`chip ${m.daysOverdue ? 'chip-bad' : ''}`}><Icon name="calendar" size={13} />Due {fmt.dateLong(m.due)}{m.daysOverdue ? ` · ${m.daysOverdue} ${tr('Tage Verzug', 'days late')}` : ''}</span>}
            {milestones.map((ms) => <span key={ms.id} className="chip chip-info"><Icon name="milestone" size={12} />{ms.name} · {fmt.date(ms.date)}</span>)}
            {p.kind === 'issue' && <button className="chip" onClick={() => openIssue(p.key)}><Icon name="external" size={12} />{tr('In Jira öffnen', 'Open in Jira')}</button>}
            <LotseChip skill="projectBrief" params={{ ref: p.ref }} label={tr('Lotse: Lagebild', 'Lotse: briefing')} />
            {aiOn(config, 'ask') && !aiOn(config, 'projectBrief') && <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.95 }} className="chip chip-accent" style={{ fontWeight: 600 }} onClick={() => openAssistant({ ref: p.ref, question: tr(`Gib mir ein Lagebild zu ${p.name}: Status, größte Risiken und die nächsten drei Schritte.`, `Give me a briefing on ${p.name}: status, biggest risks and the next three steps.`) })}><Icon name="sparkle" size={12} />{tr('KI-Lagebild', 'AI briefing')}</motion.button>}
          </div>
        </div>
        <Ring value={m.progress} size={88} stroke={8} color="var(--accent)"><div style={{ textAlign: 'center', lineHeight: 1.1 }}><div style={{ fontSize: 18, fontWeight: 600 }}>{fmt.pct(m.progress)}</div><div className="faint" style={{ fontSize: 10, fontWeight: 500 }}>{tr('Fortschritt', 'Progress')}</div></div></Ring>
      </section>
      {/* KI-Assistent: the project briefing (status, risks, next steps) – from the caller's own dataset, minimised */}
      <AiAssist key={p.ref} feature="projectBrief" label={tr('KI-Lagebild', 'AI briefing')} title={`${tr('Lagebild', 'Briefing')} · ${p.name}`}
        build={() => ({ ref: p.ref })} copy={(r) => [r.text, ...(r.points || []).map((x) => `- ${x}`)].join('\n')} />

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: -8 }}>
        <span className="faint" style={{ fontSize: 12.5 }}><Icon name="info" size={13} /> {tr('Maus über eine Kachel zeigt, wie die Zahl entsteht.', 'Hover a tile to see how the number is made.')}</span>
        <button className="btn btn-sm" onClick={() => setLegend(true)}><Icon name="help" />{tr('Legende', 'Legend')}</button>
      </div>
      <KpiTiles kpis={kpis} onJump={jump} subject={p.name} />
      <Legend open={legend} onClose={() => setLegend(false)} title={tr('Projektdetails', 'Project details')} sub={tr('Ein Projekt im Detail: Stand, Lücken, Abhängigkeiten und Kapazität. Unter jeder Definition steht die Rechnung für dieses Projekt.', 'One project in detail: status, gaps, dependencies and capacity. Under each definition is the calculation for this project.')}
        defs={definitions(lang, config)} kpis={kpis} subject={p.name} />
      {/* capacity first (with the week board and its blocks-conflict banner); the two long lists follow, each full width –
          real projects have many action items and missing values (boss feedback 2026-11-12) */}
      <div ref={capRef} style={{ scrollMarginTop: 12 }}><ProjectCapacity p={p} m={m} /></div>
      <section ref={actRef} className="card proj-actions" data-proj-area="actions" style={{ scrollMarginTop: 12 }}>
        <div className="card-head">
          <div>
            <h2 className="card-title"><Icon name="zap" />{tr('Handlungsbedarf', 'Action needed')}<span className={`chip num ${actions.length ? 'chip-accent' : 'chip-ok'}`}>{actions.length}</span></h2>
            <div className="card-sub" style={{ marginTop: 3 }}>{tr('Das Dringendste zuerst. Die Chips filtern nach Art, ein Klick springt zum Vorgang.', 'Most urgent first. The chips filter by kind, a click jumps to the work item.')}</div>
          </div>
        </div>
        <ActionList items={actions} p={p} onCapacity={() => capRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
      </section>
      <div ref={gapRef} data-proj-area="gaps" style={{ scrollMarginTop: 12 }}>
        <Prof id="proj:gaps"><GapBox scope={gapScope} title={tr('Fehlende Werte im Projekt', 'Missing values in the project')} /></Prof>
      </div>
      <div ref={structRef} style={{ scrollMarginTop: 12 }}><Prof id="proj:structure"><Structure p={p} dq={dq} /></Prof></div>
      <div className="faint" style={{ fontSize: 12 }}>{ds.truncated ? tr('Hinweis: Sehr große Projekte werden gekürzt geladen.', 'Note: very large projects are loaded partially.') : ''}</div>
    </>
  );
}

// ---------- structure tree (UC-01 / UC-02) ----------
function Structure({ p, dq }) {
  const { computed, focus, roles, ds } = useApp();
  const views = canStructureViews(roles);
  const [viewPref, setViewPref] = usePref('view', 'tree');
  const view = views ? viewPref : 'tree';
  // Lotse "Zeitleiste öffnen": switch the view and bring the card into sight
  useEffect(() => {
    const on = (e) => { if (!views) return; setViewPref(e.detail); setTimeout(() => document.querySelector('[data-structure-card]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150); };
    window.addEventListener('pc-structure-view', on);
    return () => window.removeEventListener('pc-structure-view', on);
  }, [views]); // eslint-disable-line react-hooks/exhaustive-deps
  const { model, deps } = computed;
  const issues = model.byRoot.get(p.ref) || [];
  const [status, setStatus] = useState('all');
  const [team, setTeam] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [q, setQ] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set(issues.filter((i) => i.role === 'estimate').map((i) => i.id)));
  const [flash, setFlash] = useState(null);
  const today = model.today;
  const gapsBy = useMemo(() => {
    const m = new Map();
    for (const g of dq.gaps) if (g.severity === 'gap' && g.rule.startsWith('missing:')) (m.get(g.issueId) || m.set(g.issueId, []).get(g.issueId)).push(g.field);
    return m;
  }, [dq]);
  const flags = (i) => ({
    overdue: i.status.cat !== 'done' && i.due && dayIdx(i.due) < today,
    dep: deps.issueIds.has(i.id),
    missing: gapsBy.get(i.id) || [],
  });
  const teams = [...new Map(issues.filter((i) => i.team).map((i) => [i.team.id, i.team])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const people = [...new Map(issues.filter((i) => i.assignee && !i.assignee.anon).map((i) => [i.assignee.id, i.assignee])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const filtering = status !== 'all' || team !== 'all' || assignee !== 'all' || q.trim() || onlyIssues;
  const s = q.trim().toLowerCase();
  const matches = (i) => {
    if (status === 'open' && i.status.cat === 'done') return false;
    if (status === 'done' && i.status.cat !== 'done') return false;
    if (team !== 'all' && i.team?.id !== team) return false;
    if (assignee !== 'all' && i.assignee?.id !== assignee) return false;
    if (s && !i.key.toLowerCase().includes(s) && !i.summary.toLowerCase().includes(s)) return false;
    if (onlyIssues) { const f = flags(i); if (!f.overdue && !f.dep && !f.missing.length) return false; }
    return true;
  };
  const kids = useMemo(() => {
    const m = new Map();
    const ids = new Set(issues.map((i) => i.id));
    const order = { rough: 0, structure: 1, estimate: 2, tiny: 3 };
    for (const i of issues) { const k = i.parentId && ids.has(i.parentId) ? i.parentId : 'root'; (m.get(k) || m.set(k, []).get(k)).push(i); }
    for (const l of m.values()) l.sort((a, b) => (!!a.orphan - !!b.orphan) || (order[a.role] - order[b.role]) || Number(a.id) - Number(b.id)); // parentless last (boss 2026-11-19)
    return m;
  }, [issues]);
  const visible = useMemo(() => {
    if (!filtering) return null;
    const v = new Set();
    const walk = (i) => { let any = matches(i); for (const c of kids.get(i.id) || []) if (walk(c)) any = true; if (any) v.add(i.id); return any; };
    (kids.get('root') || []).forEach(walk);
    return v;
  }, [filtering, kids, status, team, assignee, s, onlyIssues, gapsBy]); // eslint-disable-line
  const shown = issues.filter((i) => (visible ? visible.has(i.id) && matches(i) : true));
  const overdueShown = shown.filter((i) => flags(i).overdue).length;

  // Jump target from the action list or the command palette.
  useEffect(() => {
    if (!focus?.issueId) return;
    const target = model.byId.get(focus.issueId);
    if (!target || target.rootRef !== p.ref) return;
    setCollapsed((c) => { const n = new Set(c); let cur = target; while (cur?.parentId) { n.delete(cur.parentId); cur = model.byId.get(cur.parentId); } return n; });
    setFlash(focus.issueId);
    setTimeout(() => document.getElementById(`node-${focus.issueId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [focus, model, p.ref]);

  const reset = () => { setStatus('all'); setTeam('all'); setAssignee('all'); setQ(''); setOnlyIssues(false); };
  const kidsOf = useMemo(() => (id) => kids.get(id) || [], [kids]);
  const toggleRow = (id) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // the rows of the timeline (collapse and filters apply) and of the list (filters apply, everything open)
  const timelineRows = useMemo(() => {
    if (view !== 'timeline') return [];
    const out = [];
    const walk = (i, depth) => {
      if (visible && !visible.has(i.id)) return;
      const children = kids.get(i.id) || [];
      const open = filtering || !collapsed.has(i.id);
      out.push({ i, depth, hasKids: children.length > 0, open, onToggle: () => toggleRow(i.id) });
      if (open) for (const c of children) walk(c, depth + 1);
    };
    for (const i of kids.get('root') || []) walk(i, 0);
    return out;
  }, [view, kids, visible, filtering, collapsed]); // eslint-disable-line react-hooks/exhaustive-deps
  const listRows = useMemo(() => {
    if (view !== 'list') return [];
    const out = [];
    const walk = (i, depth) => {
      if (!visible || (visible.has(i.id) && matches(i))) out.push({ i, depth });
      if (visible && !visible.has(i.id)) return;
      for (const c of kids.get(i.id) || []) walk(c, depth + 1);
    };
    for (const i of kids.get('root') || []) walk(i, 0);
    return out;
  }, [view, kids, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const withKids = useMemo(() => issues.filter((i) => (kids.get(i.id) || []).length).map((i) => i.id), [issues, kids]);
  const toggle = (id) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const render = (i, depth) => {
    if (visible && !visible.has(i.id)) return null;
    const children = kids.get(i.id) || [];
    const open = filtering || !collapsed.has(i.id);
    return (
      <div key={i.id}>
        <Node i={i} depth={depth} f={flags(i)} hasKids={children.length > 0} open={open} onToggle={() => toggle(i.id)} flash={flash === i.id} dim={visible && !matches(i)} />
        <AnimatePresence initial={false}>
          {open && children.length > 0 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }} style={{ overflow: 'hidden' }}>
              {children.map((c) => render(c, depth + 1))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };
  return (
    <section className="card" data-structure-card>
      <div className="card-head">
        <h2 className="card-title"><Icon name="layers" />{tr('Struktur', 'Structure')}</h2>
        <div className="row wrap" style={{ fontSize: 12.5, gap: 10 }}>
          {views && (
            <Segmented size="sm" value={view} onChange={setViewPref} label={tr('Ansicht', 'View')} data-structure-view
              options={[{ value: 'tree', label: tr('Baum', 'Tree'), icon: 'layers' }, { value: 'timeline', label: tr('Zeitleiste', 'Timeline'), icon: 'calendar' }, { value: 'list', label: tr('Liste', 'List'), icon: 'list' }]} />
          )}
          <span className="num"><b>{shown.length}</b> {tr('Vorgänge', 'work items')}</span>
          <span className={`chip ${overdueShown ? 'chip-bad' : 'chip-outline'} num`}>{overdueShown} {tr('über Due Date', 'past due')}</span>
        </div>
      </div>
      <div className="filters">
        <div className="input-wrap" style={{ width: 220 }}><Icon name="search" size={14} /><input className="input input-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Schlüssel oder Zusammenfassung', 'Key or summary')} aria-label={tr('Suchen', 'Search')} /></div>
        <Segmented size="sm" value={status} onChange={setStatus} label="Status" options={[{ value: 'all', label: tr('Alle', 'All') }, { value: 'open', label: tr('Offen', 'Open') }, { value: 'done', label: tr('Erledigt', 'Done') }]} />
        <select className="select select-sm" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team"><option value="all">{tr('Alle Teams', 'All teams')}</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        {people.length > 0 && <select className="select select-sm" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Assignee"><option value="all">{tr('Alle Assignees', 'All assignees')}</option>{people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}
        <Switch on={onlyIssues} onChange={setOnlyIssues} label={tr('Nur Auffälligkeiten', 'Only issues')} />
        <AnimatePresence>{filtering && <motion.button initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="btn btn-ghost btn-xs" onClick={reset}><Icon name="x" size={12} />{tr('Filter zurücksetzen', 'Reset filters')}</motion.button>}</AnimatePresence>
      </div>
      {(kids.get('root') || []).length === 0 ? <div className="tree"><Empty icon="layers" title={tr('Keine Vorgänge', 'No work items')}>{tr('Unter diesem Projekt hängen noch keine Vorgänge.', 'No work items below this project yet.')}</Empty></div>
        : visible && visible.size === 0 ? <div className="tree"><Empty icon="filter" title={tr('Keine Treffer', 'No matches')} action={<button className="btn btn-sm" onClick={reset}>{tr('Filter zurücksetzen', 'Reset filters')}</button>} /></div>
          : view === 'timeline' ? <StructureTimeline projectRef={p.ref} rows={timelineRows} issues={issues} kidsOf={kidsOf} model={model} deps={deps} onExpandAll={() => setCollapsed(new Set())} onCollapseAll={() => setCollapsed(new Set(withKids))} />
            : view === 'list' ? <StructureList projectRef={p.ref} rows={listRows} issues={issues} kidsOf={kidsOf} model={model} deps={deps} gapsBy={gapsBy} ds={ds} />
              : <div className="tree">{(kids.get('root') || []).map((i) => render(i, 0))}</div>}
    </section>
  );
}
function Node({ i, depth, f, hasKids, open, onToggle, flash, dim }) {
  const tip = useTip();
  const pct = i.oe > 0 ? Math.min(1.2, (i.ts || 0) / i.oe) : null;
  return (
    <div id={`node-${i.id}`} className={`tnode ${flash ? 'flash' : ''}`} style={{ paddingLeft: 8 + depth * 22, opacity: dim ? 0.55 : 1 }}>
      {Array.from({ length: depth }, (_, k) => <span key={k} className="indent" style={{ left: 19 + k * 22 }} />)}
      <div className="tnode-main">
        {hasKids ? (
          <button className="twisty" onClick={onToggle} aria-expanded={open} aria-label={open ? tr('Zuklappen', 'Collapse') : tr('Aufklappen', 'Expand')}>
            <motion.span animate={{ rotate: open ? 90 : 0 }} transition={spring} style={{ display: 'grid' }}><Icon name="chevron" size={14} /></motion.span>
          </button>
        ) : <span style={{ width: 22, flex: 'none' }} />}
        <span className="ticon" title={i.type?.name} aria-hidden="true" style={{ background: { rough: 'var(--accent)', structure: 'var(--info)', estimate: 'var(--ok)', tiny: 'var(--ink-3)' }[i.role] || 'var(--sunken)', color: '#fff', fontSize: 9, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{(i.type?.name || '?')[0]}</span>
        <button className="tkey" onClick={() => openIssue(i.key)}>{i.key}</button>
        <span className="tnode-sum" style={{ fontWeight: i.role === 'rough' ? 580 : i.role === 'structure' ? 520 : 400 }}>{i.summary}</span>
        {f.overdue && <span className="chip chip-bad" style={{ height: 20, fontSize: 11 }}>{tr('Due Date überschritten', 'Due date exceeded')}</span>}
        {f.dep && <span className="chip chip-accent" style={{ height: 20, fontSize: 11 }}><Icon name="link" size={11} />{tr('Abhängigkeit', 'Dependency')}</span>}
        {i.orphan && <span className="chip chip-warn orphan-chip" style={{ height: 20, fontSize: 11 }} data-orphan tabIndex={0} {...tip(infoCard({ title: tr('Ohne Parent', 'No parent'), sub: i.key, text: tr('Hängt in Jira an keinem Epic oder Workstream. Es gehört über seinen Space zu diesem Projekt und zählt mit – im Handlungsbedarf einen Parent setzen, dann steht es an der richtigen Stelle.', 'Has no epic or workstream in Jira. It belongs to this project through its space and counts – set a parent under Action needed to put it in the right place.') }))}><Icon name="layers" size={11} />{tr('Ohne Parent', 'No parent')}</span>}
        {f.missing.filter((u) => !(i.orphan && u === 'parent')).map((u) => <span key={u} className="chip chip-missing req" style={{ height: 20, fontSize: 11 }}>{usageName(u)} {tr('fehlt', 'missing')}</span>)}
      </div>
      <div className="tnode-side">
        {i.role === 'rough' && i.tshirt && <span className="chip" style={{ height: 20 }}>{i.tshirt}</span>}
        {i.role === 'rough' && (i.quarters || []).length > 0 && <span className="faint" style={{ fontSize: 11.5 }}>{i.quarters.map(fmt.quarter).join(', ')}</span>}
        {i.team && <span className="chip chip-outline" style={{ height: 20 }}>{i.team.name}</span>}
        {i.due && <span className="num" style={{ color: f.overdue ? 'var(--bad)' : undefined, minWidth: 48, textAlign: 'right' }}>{fmt.date(i.due)}</span>}
        {i.role === 'estimate' && (
          <span {...tip(<div className="tt-grid" style={{ marginTop: 0 }}><span>Original Estimate</span><span>{fmt.h(i.oe, 1)}</span><span>Time Spent</span><span>{fmt.h(i.ts, 1)}</span><span>Remaining</span><span>{fmt.h(i.re, 1)}</span></div>)} tabIndex={0}>
            <span className="mini-bar"><motion.i className={pct > 1 ? 'over' : ''} initial={{ width: 0 }} animate={{ width: `${Math.min(100, (pct || 0) * 100)}%` }} transition={{ duration: 0.6 }} /></span>
          </span>
        )}
        <Lozenge status={i.status} />
        {i.assignee && !i.assignee.anon ? <Avatar user={i.assignee} size={22} /> : <span style={{ width: 22 }} />}
      </div>
    </div>
  );
}

/// ---------- action list ----------
const KIND = {
  overdue: { icon: 'alert', c: 'var(--bad)', bg: 'var(--bad-soft)' },
  dates: { icon: 'calendar', c: 'var(--bad)', bg: 'var(--bad-soft)' },
  conflict: { icon: 'link', c: 'var(--accent-strong)', bg: 'var(--accent-soft)' },
  capacity: { icon: 'gauge', c: 'var(--warn)', bg: 'var(--warn-soft)' },
  absence: { icon: 'calendar', c: 'var(--info)', bg: 'var(--info-soft)' },
  gap: { icon: 'shield', c: 'var(--ink-2)', bg: 'var(--sunken)' },
  noParent: { icon: 'layers', c: 'var(--warn)', bg: 'var(--warn-soft)' },
};
// Full width and built for long lists: filter chips per kind (with counts), the engine's priority order, the first
// rows at once and "show all" below – no inner scroll box, nothing jumps (boss feedback 2026-11-12).
const ACTION_PREVIEW = 8;
const KIND_ORDER = ['dates', 'conflict', 'overdue', 'noParent', 'capacity', 'absence'];
const kindLabel = (k) => ({ dates: tr('Start nach Due', 'Start after due'), conflict: tr('Terminkonflikte', 'Date conflicts'), overdue: tr('Über Due Date', 'Past due'), capacity: tr('Kapazität', 'Capacity'), absence: tr('Abwesenheiten', 'Absences'), noParent: tr('Ohne Parent', 'No parent') }[k]);
function ActionList({ items, p, onCapacity }) {
  const { setFocus, ds } = useApp();
  const [all, setAll] = useState(false);
  const [kind, setKind] = useState('all');
  const counts = useMemo(() => { const c = {}; for (const a of items) c[a.kind] = (c[a.kind] || 0) + 1; return c; }, [items]);
  const kinds = KIND_ORDER.filter((k) => counts[k]);
  useEffect(() => { if (kind !== 'all' && !counts[kind]) setKind('all'); }, [counts, kind]);
  if (!items.length) return <Empty icon="check" title={tr('Alles im grünen Bereich', 'All clear')}>{tr('Kein Handlungsbedarf für dieses Projekt.', 'Nothing needs attention for this project.')}</Empty>;
  const name = (id) => ds.people?.[id]?.name || '';
  const filtered0 = kind === 'all' ? items : items.filter((a) => a.kind === kind);
  // parentless items of a shared space (project unclear): one row per space that opens to the list (live: 14 bugs in PCX)
  const filtered = [];
  { const groups = new Map(); for (const a of filtered0) { if (a.kind !== 'noParent' || !a.unclear) { filtered.push(a); continue; } const k = a.projectKey || '?'; let g = groups.get(k); if (!g) { g = { kind: 'noParent', group: true, unclear: true, projectKey: k, spaceProjects: a.spaceProjects, list: [], score: a.score }; groups.set(k, g); filtered.push(g); } g.list.push(a); } }
  for (let x = 0; x < filtered.length; x++) if (filtered[x].group && filtered[x].list.length === 1) filtered[x] = filtered[x].list[0];
  const list = all ? filtered : filtered.slice(0, ACTION_PREVIEW);
  return (
    <>
      {kinds.length > 1 && (
        <div className="list-filter" role="group" aria-label={tr('Nach Art filtern', 'Filter by kind')}>
          <button type="button" className="list-chip" aria-pressed={kind === 'all'} onClick={() => setKind('all')}>{tr('Alle', 'All')} <b className="num">{items.length}</b></button>
          {kinds.map((k) => (
            <button key={k} type="button" className="list-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              <span className="list-chip-dot" style={{ background: KIND[k].c }} aria-hidden="true" />{kindLabel(k)} <b className="num">{counts[k]}</b>
            </button>
          ))}
        </div>
      )}
      <ul className="actions act-list" aria-label={tr('Handlungsbedarf', 'Action needed')}>
        {list.map((a, i) => {
          if (a.group) return <li key={`np-${a.projectKey}`}><UnclearGroup g={a} p={p} i={i} /></li>;
          const k = KIND[a.kind];
          const title = {
            overdue: tr(`${a.days} Tage über Due Date`, `${a.days} days past due date`),
            dates: tr(`Start ${fmt.date(a.start)} liegt nach Due ${fmt.date(a.due)} – Termine prüfen`, `Start ${fmt.date(a.start)} is after due ${fmt.date(a.due)} – check the dates`),
            conflict: tr(`Terminkonflikt mit ${a.other} (${a.days} T)`, `Schedule conflict with ${a.other} (${a.days} d)`),
            capacity: tr(`${a.teamId === '_none' ? 'Ohne Team' : a.teamName}: ${fmt.h(a.missing)} nicht besetzbar in ${fmt.quarter(a.q)}`, `${a.teamId === '_none' ? 'No team' : a.teamName}: ${fmt.h(a.missing)} not staffable in ${fmt.quarter(a.q)}`),
            absence: tr(`${a.person?.name || 'Assignee'} abwesend ${fmt.date(a.from)}–${fmt.date(a.to)}`, `${a.person?.name || 'Assignee'} absent ${fmt.date(a.from)}–${fmt.date(a.to)}`),
            gap: a.kind === 'gap' ? ruleName(a.rule) : '',
            noParent: a.unclear
              ? tr(`Ohne Parent – Projekt unklar (${a.projectKey || 'der Space'} hat ${a.spaceProjects || 2} Projekte)`, `No parent – project unclear (${a.projectKey || 'the space'} has ${a.spaceProjects || 2} projects)`)
              : tr('Ohne Parent – steht außerhalb der Struktur', 'No parent – outside the structure'),
          }[a.kind];
          return (
            <li key={`${a.kind}-${a.issueId}-${a.q || ''}-${a.teamId || ''}-${a.rule || ''}`}>
              <motion.button type="button" className="action act-row" {...stagger(i, 0.025)}
                onClick={() => (a.kind === 'capacity' ? onCapacity() : a.unclear ? openIssue(a.key) : a.issueId && setFocus({ issueId: a.issueId, at: Date.now() }))}>
                <span className="action-ico" style={{ background: k.bg, color: k.c }}><Icon name={k.icon} size={15} /></span>
                <span className="act-title">
                  <span className="action-title">{title}</span>
                  {a.urgent && <span className="chip chip-accent" style={{ height: 18, fontSize: 10.5 }}>{tr('dringend', 'urgent')}</span>}
                </span>
                <span className="act-item">
                  {a.key && <span className="mono">{a.key}</span>}
                  {a.summary && <span className="act-sum">{a.summary}</span>}
                </span>
                <span className="act-who">
                  {a.substitute && <span className="chip chip-info" style={{ height: 20 }}>{tr('Vertretung', 'Substitute')}: {name(a.substitute) || tr('Teamkollege', 'teammate')}</span>}
                  {a.responsible && !a.responsible.anon && <span className="row" style={{ gap: 6, minWidth: 0 }}><Avatar user={a.responsible} size={18} /><span className="act-sum">{a.responsible.name}</span></span>}
                </span>
              </motion.button>
              {a.kind === 'noParent' && p && <ParentFix a={a} projectRef={p.ref} />}
            </li>
          );
        })}
      </ul>
      {filtered.length > ACTION_PREVIEW && (
        <button type="button" className="gapbox-more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? tr('Weniger zeigen', 'Show fewer') : tr(`Alle ${filtered.length} zeigen`, `Show all ${filtered.length}`)}
          <motion.span style={{ display: 'grid' }} animate={{ rotate: all ? 180 : 0 }}><Icon name="chevronDown" size={13} /></motion.span>
        </button>
      )}
    </>
  );
}

// The parentless work items of a shared space in one row: "14 work items without parent – project unclear (PCX has 5
// projects)"; opened, each with its key, summary and the parent picker of this project.
function UnclearGroup({ g, p, i }) {
  const [open, setOpen] = useState(false);
  const n = g.list.length;
  const keys = g.list.slice(0, 3).map((x) => x.key).join(', ') + (n > 3 ? ` +${n - 3}` : '');
  return (
    <>
      <motion.button type="button" className="action act-row" {...stagger(i, 0.025)} aria-expanded={open} data-orphan-group={g.projectKey} onClick={() => setOpen((v) => !v)}>
        <span className="action-ico" style={{ background: KIND.noParent.bg, color: KIND.noParent.c }}><Icon name="layers" size={15} /></span>
        <span className="act-title"><span className="action-title">{tr(`${n} Vorgänge ohne Parent – Projekt unklar (${g.projectKey} hat ${g.spaceProjects || 2} Projekte)`, `${n} work items without parent – project unclear (${g.projectKey} has ${g.spaceProjects || 2} projects)`)}</span></span>
        <span className="act-item"><span className="mono act-sum">{keys}</span></span>
        <span className="act-who"><span className="faint" style={{ fontSize: 12 }}>{open ? tr('Zuklappen', 'Collapse') : tr('Zuordnen', 'Assign')}</span><motion.span style={{ display: 'grid' }} animate={{ rotate: open ? 180 : 0 }}><Icon name="chevronDown" size={14} /></motion.span></span>
      </motion.button>
      {open && (
        <ul className="act-sub">
          {g.list.map((a) => (
            <li key={a.issueId}>
              <div className="act-sub-line"><button type="button" className="tkey" onClick={() => openIssue(a.key)}>{a.key}</button><span className="act-sum">{a.summary}</span></div>
              <ParentFix a={a} projectRef={p.ref} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// A work item without a parent (boss 2026-11-19): choose its parent from this project – written in Jira as the user,
// undoable. An unclear one (a space with several projects) comes into THIS project with it.
function ParentFix({ a, projectRef }) {
  const { computed, config, setParent, toast, runUndo } = useApp();
  const choices = useMemo(() => parentChoices(computed?.model, config, projectRef, a), [computed, config, projectRef, a]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  if (!choices.length) {
    return (
      <div className="act-fix" data-parent-fix={a.issueId}>
        <span className="faint">{tr('Kein passender Parent in diesem Projekt – in Jira zuordnen.', 'No fitting parent in this project – assign it in Jira.')}</span>
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => openIssue(a.key)}><Icon name="external" size={12} />{tr('In Jira öffnen', 'Open in Jira')}</button>
      </div>
    );
  }
  const save = async () => {
    if (!pick || busy) return;
    const c = choices.find((x) => x.id === pick);
    setBusy(true);
    try {
      const e = await setParent({ issueId: a.issueId, parentId: pick, ref: projectRef, label: tr(`${a.key}: Parent ${c?.key || ''} gesetzt`, `${a.key}: parent ${c?.key || ''} set`) });
      toast({ text: tr(`${a.key} hängt jetzt an ${c?.key || ''} – in Jira gespeichert`, `${a.key} now sits under ${c?.key || ''} – saved in Jira`), icon: 'check', undo: () => runUndo(e) });
    } catch (err) {
      toast({ text: errText(err), error: true });
    } finally { setBusy(false); }
  };
  return (
    <div className="act-fix" data-parent-fix={a.issueId}>
      <span className="act-fix-label">{a.unclear ? tr('In dieses Projekt holen, unter:', 'Bring into this project, under:') : tr('Parent setzen:', 'Set parent:')}</span>
      <select className="select select-sm" value={pick} onChange={(e) => setPick(e.target.value)} aria-label={tr(`Parent für ${a.key}`, `Parent for ${a.key}`)}>
        <option value="">{tr('Wählen …', 'Choose …')}</option>
        {choices.map((c) => <option key={c.id} value={c.id}>{c.key} · {c.summary}</option>)}
      </select>
      <button type="button" className="btn btn-xs btn-primary" disabled={!pick || busy} aria-busy={busy} onClick={save}><Icon name={busy ? 'refresh' : 'check'} size={12} />{tr('Setzen', 'Set')}</button>
    </div>
  );
}

// ---------- capacity for this project ----------
function ProjectCapacity({ p, m }) {
  const { computed, capView, setCapView, ds, roles } = useApp();
  const { model, wl, support } = computed;
  const mode = capView === 'quarters' ? 'quarters' : capView === 'year' ? 'year' : 'weeks';
  const tip = useTip();
  // Same grid as the "Kapazität" tile counts (shared/kpis.js): project hours per person, colour = total load.
  const { weeks, rows } = useMemo(() => {
    const pw = projectWeeks(model, p.ref, support);
    return { weeks: pw.weeks, rows: pw.rows.map((r) => ({ ...r, user: ds.people?.[r.id] || (r.id === '_none' ? null : { id: r.id, name: '' }), total: r.sum })) };
  }, [model, p.ref, ds.people, support]);
  const loadTone = (u) => (u == null ? null : u > 1.0001 ? 'bad' : u > 0.85 ? 'warn' : 'ok');
  const pq = wl.projectQ[p.ref] || {};
  const teamIds = [...new Set(wl.quarters.flatMap((q) => Object.keys(m.demand[q] || {})))];
  const maxQ = Math.max(1, ...wl.quarters.map((q) => Object.values(m.demand[q] || {}).reduce((a, b) => a + b, 0)));
  const personLevel = ds.personLevel !== false;
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title"><Icon name="gauge" />{tr('Kapazität für dieses Projekt', 'Capacity for this project')}</h2>
        <Segmented size="sm" value={mode} onChange={setCapView} label={tr('Ansicht', 'View')} options={[{ value: 'weeks', label: tr('Wochen bis Quartalsende', 'Weeks to quarter end') }, { value: 'quarters', label: tr('Quartale je Team', 'Quarters per team') }, { value: 'year', label: tr('Jahresprognose', 'Year projection') }]} />
      </div>
      <>
        {mode === 'year' ? <Prof id="proj:year"><ProjectYear p={p} /></Prof> : mode === 'weeks' ? (
          <div style={{ padding: '4px 0 0' }}><Prof id="proj:weekboard"><WeekBoard project={p.ref} canEdit={canPlan(roles)} /></Prof></div>
        ) : (
          <motion.div key="q" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: '16px 20px 20px' }}>
            {teamIds.length === 0 ? <Empty icon="gauge" title={tr('Kein offener Bedarf', 'No open demand')} /> : (
              <div className="stack" style={{ gap: 18 }}>
                {wl.quarters.map((q) => {
                  const total = Object.values(m.demand[q] || {}).reduce((a, b) => a + b, 0);
                  return (
                    <div key={q}>
                      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                        <b>{fmt.quarter(q)}</b>
                        <span className="muted num" style={{ fontSize: 12.5 }}>{fmt.h(total)} {tr('offener Bedarf', 'open demand')} · <span style={{ color: pq[q]?.status && pq[q].status !== 'ok' ? 'var(--accent-strong)' : 'var(--ok)' }}>{pq[q]?.status === 'no' ? tr('nicht besetzbar', 'not staffable') : pq[q]?.status === 'partial' ? tr('teilweise besetzbar', 'partially staffable') : tr('besetzbar', 'staffable')}</span></span>
                      </div>
                      <div className="stack" style={{ gap: 6 }}>
                        {teamIds.map((t) => {
                          const d = m.demand[q]?.[t] || 0;
                          if (!d) return null;
                          const cell = pq[q]?.teams.find((x) => x.teamId === t);
                          const staffed = cell ? cell.staffed : d;
                          return (
                            <div key={t} className="row" style={{ gap: 12 }} {...tip(<div><b>{model.teams.get(t)?.name || tr('Ohne Team', 'No team')}</b><div className="tt-grid"><span>{tr('Bedarf', 'Demand')}</span><span>{fmt.h(d)}</span><span>{tr('besetzbar', 'staffable')}</span><span>{fmt.h(staffed)}</span><span>{tr('fehlt', 'missing')}</span><span>{fmt.h(d - staffed)}</span></div></div>)}>
                              <span style={{ width: 130, fontSize: 13 }}>{model.teams.get(t)?.name || tr('Ohne Team', 'No team')}</span>
                              <div style={{ flex: 1, height: 14, borderRadius: 7, background: 'var(--sunken)', position: 'relative', overflow: 'hidden' }}>
                                <motion.div initial={{ width: 0 }} animate={{ width: `${(staffed / maxQ) * 100}%` }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, background: 'var(--ink)', borderRadius: 7 }} />
                                <motion.div initial={{ width: 0 }} animate={{ width: `${((d - staffed) / maxQ) * 100}%` }} transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }} style={{ position: 'absolute', left: `${(staffed / maxQ) * 100}%`, top: 0, bottom: 0, background: 'repeating-linear-gradient(-45deg, var(--accent) 0 4px, color-mix(in srgb, var(--accent) 55%, transparent) 4px 8px)', borderRadius: 7 }} />
                              </div>
                              <span className="num" style={{ width: 70, textAlign: 'right', fontSize: 12.5 }}>{fmt.h(d)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </>
    </section>
  );
}
