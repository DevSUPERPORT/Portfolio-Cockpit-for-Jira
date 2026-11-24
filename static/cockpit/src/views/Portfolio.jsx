import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, Reorder, useDragControls } from 'framer-motion';
import { waterline } from '@shared/engine.js';
import { serviceKpis } from '@shared/sla.js';
import { portfolioKpis, portfolioDefinitions } from '@shared/kpis.js';
import { KpiTiles, Legend } from '../components/KpiTiles.jsx';
import { aiOn } from '../lib/aiFlags.js';
import { useApp, errText } from '../state.jsx';
import { tr, fmt, healthName } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call, createIssue } from '../lib/api.js';
import { getLang } from '../lib/i18n.js';
import Digest from '../components/Digest.jsx';
import TodayStrip from '../components/lotse/TodayStrip.jsx';
import { LotseChip } from '../components/lotse/LotseChip.jsx';
import PlanGrid from '../components/PlanGrid.jsx';
import { exportPortfolio } from '../lib/books.js';
import { waitsFor, waitsLabel } from '@shared/waits.js';
import { rankCandidates, matchParts } from '@shared/projectSearch.js';
import { Avatar, HealthDot, Segmented, Modal, Drawer, Menu, useTip, Empty, spring, infoCard } from '../components/ui.jsx';
import { lotseDraft } from '@shared/lotse/teamwork.js';
import { LotseMark } from '../components/lotse/LotseChip.jsx';
import { useLotseCtx } from '../components/lotse/engine.js';
import { track } from '../lib/usage.js';
import { Prof, useProgressive } from '../lib/virtual.jsx';

export default function Portfolio() {
  const { ds, computed, roles, reorder, boot, config, lang, healthReq, clearHealthReq } = useApp();
  const [legend, setLegend] = useState(false);
  const { model, metrics, wl, support } = computed;
  const canRank = roles.manageRanking;
  const ranked = useMemo(() => [...ds.portfolio].sort((a, b) => a.rank - b.rank), [ds.portfolio]);
  const [order, setOrder] = useState(() => ranked.map((p) => p.ref));
  const [dragging, setDragging] = useState(null);
  // the same order keeps its array (a new one would render every row again for nothing)
  useEffect(() => { if (!dragging) setOrder((cur) => { const next = ranked.map((p) => p.ref); return next.length === cur.length && next.every((r, i) => r === cur[i]) ? cur : next; }); }, [ranked, dragging]);
  const [wq, setWq] = useState(wl.quarters[0]);
  const [healthFor, setHealthFor] = useState(null);
  const [healthDraft, setHealthDraft] = useState(null); // { status, comment } from Lotse's health draft (J-1)
  useEffect(() => {
    if (!healthReq) return;
    const p = ds.portfolio.find((x) => x.ref === healthReq.ref);
    if (p) { setHealthDraft({ status: healthReq.status, comment: healthReq.comment }); setHealthFor(p); }
    clearHealthReq();
  }, [healthReq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [mode, setMode] = useState('rank'); // 'rank' | 'plan' (quick-edit grid)
  // themes (the level above the projects, boss 2026-11-18): a click on a theme highlights its projects in the ranking
  const [focusTheme, setFocusTheme] = useState(null);
  const themeById = useMemo(() => new Map((ds.themes || []).map((t) => [t.id, t])), [ds.themes]);
  // hours legend per row: collapsed by default, "Alle aufklappen" opens every row (a row can still be toggled)
  const [hAll, setHAll] = useState(false);
  const [hExp, setHExp] = useState({});
  const hOpen = (ref) => (ref in hExp ? !!hExp[ref] : hAll);

  // Live waterline: recomputed for the order being dragged, so the line moves under your hand.
  const liveWl = useMemo(() => {
    const byRef = new Map(ds.portfolio.map((p) => [p.ref, p]));
    const items = order.map((r, i) => ({ ...byRef.get(r), rank: i + 1 })).filter((x) => x.ref);
    // the order on screen is the computed one (same refs on the same ranks): the computed waterline is exactly this one
    const key = (list) => list.filter((p) => metrics.has(p.ref)).sort((a, b) => a.rank - b.rank).map((p) => `${p.ref}\u0000${p.rank}`).join('\u0001');
    if (computed.wl && metrics === computed.metrics && support === computed.support && key(items) === key([...model.items])) return computed.wl;
    return waterline({ ...model, items, itemByRef: new Map(items.map((p) => [p.ref, p])) }, metrics, support);
  }, [order, model, metrics, support, ds.portfolio, computed.wl]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstBelow = order.find((r) => (liveWl.projectQ[r]?.[wq]?.status || 'ok') !== 'ok');
  const belowIdx = firstBelow ? order.indexOf(firstBelow) : -1;
  // once per computed for all rows: who waits for whom, date conflicts per project
  const waitsAll = useMemo(() => waitsFor(computed), [computed]);
  const conflictsBy = useMemo(() => {
    const out = new Map();
    for (const d of computed.deps?.list || []) {
      if (!d.conflict) continue;
      const a = model.byId.get(d.pre)?.rootRef, b = model.byId.get(d.dep)?.rootRef;
      if (a) out.set(a, (out.get(a) || 0) + 1);
      if (b && b !== a) out.set(b, (out.get(b) || 0) + 1);
    }
    return out;
  }, [computed, model]);
  const byRef = useMemo(() => new Map(ds.portfolio.map((p) => [p.ref, p])), [ds.portfolio]);
  // up to 150 rows with drag and motion: the first ones at once, the rest in idle steps (24, 48, 96, … – rows are
  // memoized, but the drag group renders them again on each step)
  const shownN = useProgressive(order.length, { first: 24 });
  // rows below the first screen that arrive in a later step start at their end state (no entrance motion: 150 rows of
  // animated bar widths re-lay out the page every frame); once every row is there, new rows animate as before
  const settled = useRef(false);
  useEffect(() => { if (shownN >= order.length) settled.current = true; }, [shownN, order.length]);
  const rhythm = config.rules?.healthRhythmDays || 7;
  // the tiles follow the live waterline while a project is being dragged
  const pkpis = useMemo(() => portfolioKpis({ computed, lang, fmt, ranked, wl: liveWl, quarter: wq }), [computed, lang, ranked, liveWl, wq]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (ref, delta) => {
    const i = order.indexOf(ref), j = i + delta;
    if (j < 0 || j >= order.length) return;
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]];
    setOrder(next); reorder(next);
  };
  const wlName = { ok: tr('besetzbar', 'staffable'), partial: tr('teilweise', 'partly staffable'), no: tr('nicht besetzbar', 'not staffable') };
  const app = useApp();
  // stable handlers for the memoized rows (they reach the current state through the ref)
  const act = useRef(null);
  act.current = { dragStart: (ref) => setDragging(ref), dragEnd: () => commit(), move: (ref, d) => move(ref, d), health: (p) => setHealthFor(p), remove: (p) => setRemoving(p), toggleH: (ref) => setHExp((x) => ({ ...x, [ref]: !hOpen(ref) })) };
  const handlers = useMemo(() => ({ dragStart: (r) => act.current.dragStart(r), dragEnd: () => act.current.dragEnd(), move: (r, d) => act.current.move(r, d), health: (p) => act.current.health(p), remove: (p) => act.current.remove(p), toggleH: (r) => act.current.toggleH(r) }), []);
  // while not every row is rendered yet, a drag reorders the rendered ones – the others keep their places behind them
  const onReorder = (next) => setOrder((cur) => (next.length >= cur.length ? next : [...next, ...cur.filter((r) => !next.includes(r))]));
  const exportRanking = () => exportPortfolio(app).catch((e) => app.toast({ text: e.message, error: true }));
  const commit = () => {
    setDragging(null);
    const prev = ranked.map((p) => p.ref);
    if (order.join() !== prev.join()) reorder(order);
  };

  return (
    <div className="page">
      <Prof id="pf:today"><TodayStrip where="portfolio" /></Prof>
      <Prof id="pf:digest"><Digest /></Prof>
      <div data-tour="stats" className="stack" style={{ gap: 8 }}>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          <LotseChip skill="portfolioBrief" params={{}} label={tr('Lotse: Portfolio-Lage', 'Lotse: portfolio briefing')} />
          <button className="btn btn-sm btn-ghost" onClick={() => setLegend(true)}><Icon name="help" />{tr('Legende', 'Legend')}</button>
        </div>
        {/* every tile, its breakdown and the legend come from the one KPI registry (shared/kpis.js) */}
        <Prof id="pf:kpis"><KpiTiles kpis={pkpis} onJump={() => document.querySelector('[data-tour=ranking]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} subject={tr('Portfolio', 'Portfolio')} /></Prof>
      </div>
      <Legend open={legend} onClose={() => setLegend(false)} title={tr('Portfolio', 'Portfolio')} sub={tr('Unter jeder Definition steht die Rechnung mit den aktuellen Zahlen.', 'Under each definition is the calculation with the current numbers.')}
        defs={portfolioDefinitions(lang, config)} kpis={pkpis} subject={tr('Aktuell', 'Now')} />

      {support && (support.services || []).length > 0 && <SupportCard support={support} quarters={wl.quarters} />}
      {ds.truncated && <div className="callout warn" data-truncated><Icon name="alert" /><div>{tr('Nicht alle Vorgänge geladen: das Portfolio ist sehr groß (über 4.000 Vorgänge in einem Space oder mehr, als Jira in einer Anfrage liefert). Summen und Wasserlinie können zu niedrig sein – Projekte mit sehr vielen Vorgängen besser als einzelne Vorgänge (Issue-Modus) führen.', 'Not every work item was loaded: the portfolio is very large (over 4,000 work items in one space, or more than Jira returns in one request). Totals and the waterline may be too low – better track very large projects as single work items (issue mode).')}</div></div>}

      {(ds.themes || []).length > 0 && ranked.length > 0 && (
        <Themes themes={ds.themes} ranked={ranked} order={order} metrics={metrics} projectQ={liveWl.projectQ} wq={wq} focus={focusTheme} onFocus={setFocusTheme} title={config.portfolio?.group?.name || tr('Themen', 'Themes')} />
      )}

      <motion.section className="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.12 } }} aria-label={tr('Projekte nach Rang', 'Projects by rank')} data-tour="ranking">
        <div className="card-head">
          <div>
            <h2 className="card-title"><Icon name="ranking" />{tr('Projekte', 'Projects')}</h2>
            <div className="card-sub" style={{ marginTop: 3 }}>
              {canRank ? tr('Nach Rang – verbleibende Kapazität wird von oben nach unten vergeben. Ziehen oder Alt + ↑/↓; die Wasserlinie folgt sofort.', 'By rank – the capacity left is given out from top to bottom. Drag or Alt + ↑/↓; the waterline follows instantly.')
                : <span className="row" style={{ gap: 6 }}><Icon name="lock" size={13} />{tr('Nur freigegebene Gruppen ändern die Rangfolge.', 'Only enabled groups change the ranking.')}</span>}
            </div>
          </div>
          <div className="row wrap">
            <Segmented size="sm" value={mode} onChange={setMode} label={tr('Ansicht', 'View')} options={[{ value: 'rank', label: tr('Rangfolge', 'Ranking'), icon: 'ranking' }, { value: 'plan', label: tr('Planung bearbeiten', 'Edit planning'), icon: 'edit' }]} />
            {mode === 'rank' && <span className="muted" style={{ fontSize: 12.5 }}>{tr('Wasserlinie', 'Waterline')}</span>}
            {mode === 'rank' && <Segmented size="sm" value={wq} onChange={setWq} options={wl.quarters.map((q) => ({ value: q, label: fmt.quarter(q) }))} label={tr('Quartal der Wasserlinie', 'Waterline quarter')} />}
            <button className="btn btn-sm" onClick={exportRanking} title={tr('Portfolio als Excel-Arbeitsmappe (Projekte, Wasserlinie, Kapazität, Health)', 'Portfolio as an Excel workbook (projects, waterline, capacity, health)')}><Icon name="download" size={13} />Excel</button>
            {canRank && <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Icon name="plus" />{tr('Projekt hinzufügen', 'Add project')}</button>}
          </div>
        </div>
        {ranked.length === 0 ? (
          <Empty icon="ranking" title={tr('Noch keine Projekte im Portfolio', 'No projects in the portfolio yet')} action={canRank && <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" />{tr('Erstes Projekt hinzufügen', 'Add the first project')}</button>}>
            {canRank ? tr('Nimm Projekte auf und bring sie per Drag & Drop in eine eindeutige Rangfolge.', 'Add projects and drag them into a unique ranking.') : tr('Sobald das Management Projekte aufnimmt, erscheinen sie hier.', 'Projects appear here as soon as management adds them.')}
          </Empty>
        ) : mode === 'plan' ? (
          <PlanGrid ranked={ranked} metrics={metrics} onHealth={setHealthFor} canHealth={(p) => p.owner?.id === boot.me?.id || roles.editHealth || roles.manageRanking} />
        ) : (
          <div className="ranklist rank-scroll">
            <div className="rank-inner">
              <div className="rank-head">
                <span /><span style={{ textAlign: 'center' }}>{tr('Rang', 'Rank')}</span><span>{tr('Projekt', 'Project')}</span>
                <span style={{ textAlign: 'right' }} title={tr('Original Estimate ÷ (Original Estimate + offene T-Shirt Size)', 'Original estimate ÷ (original estimate + open T-shirt size)')}>{tr('Reife', 'Maturity')}</span>
                <span className="row" style={{ justifyContent: 'space-between', gap: 8 }}>{tr('Stunden', 'Hours')}<button type="button" className="hb-all" aria-pressed={hAll} onClick={() => { setHAll(!hAll); setHExp({}); }}>{hAll ? tr('Alle zuklappen', 'Collapse all') : tr('Alle aufklappen', 'Expand all')}</button></span>
                {wl.quarters.map((q) => <span key={q} style={{ textAlign: 'center', color: q === wq ? 'var(--accent-strong)' : undefined }}>{fmt.quarter(q)}</span>)}<span />
              </div>
              <Prof id="pf:rows"><Reorder.Group as="div" axis="y" values={order} onReorder={canRank ? onReorder : () => {}} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {order.slice(0, shownN).map((ref, idx) => {
                  const p = byRef.get(ref);
                  if (!p) return null;
                  return (
                    <Row key={ref} p={p} rank={idx + 1} m={metrics.get(ref)} pq={liveWl.projectQ[ref] || NO_Q} quarters={wl.quarters} wq={wq}
                      below={!!firstBelow && belowIdx <= idx} waterHere={ref === firstBelow} canRank={canRank} dragging={dragging === ref} h={handlers}
                      canHealth={p.owner?.id === boot.me?.id || roles.editHealth || roles.manageRanking} rhythm={rhythm} wqLabel={fmt.quarter(wq)}
                      hOpen={hOpen(ref)} waits={waitsAll.get(ref)} conflicts={conflictsBy.get(ref) || 0} projectQ={computed.wl?.projectQ?.[ref]}
                      teams={model.teams} setView={app.setView} setCapView={app.setCapView} still={!settled.current && idx >= 24}
                      theme={p.themeId ? themeById.get(p.themeId) : null} dim={!!focusTheme && (p.themeId || '_none') !== focusTheme} />
                  );
                })}
              </Reorder.Group></Prof>
            </div>
          </div>
        )}
        <div className="card-head" style={{ borderTop: '1px solid var(--line-soft)', borderBottom: 0 }}>
          <div className="bar-legend">
            <span><i style={{ background: 'var(--ink)' }} />Time Spent</span>
            <span><i style={{ background: 'var(--hb-re)' }} />Remaining Estimate</span>
            <span><i style={{ background: 'var(--ink)', width: 2 }} />Original Estimate</span>
            <span><i style={{ width: 0, borderLeft: '2px dashed var(--accent)', borderRadius: 0 }} />T-Shirt Size</span>
            <span className="faint">{tr('Ende grau = Prognose', 'end of grey = forecast')}</span>
          </div>
          <div className="bar-legend">
            <span><i style={{ background: 'var(--sunken)' }} />{tr('besetzbar', 'staffable')}</span>
            <span><i style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent)' }} />{tr('teilweise', 'partial')}</span>
            <span><i style={{ background: 'var(--accent)' }} />{tr('nicht besetzbar', 'not staffable')}</span>
          </div>
        </div>
      </motion.section>

      <HealthModal project={healthFor} draft={healthDraft} onClose={() => { setHealthFor(null); setHealthDraft(null); }} />
      <AddDrawer open={adding} onClose={() => setAdding(false)} />
      <RemoveModal project={removing} onClose={() => setRemoving(null)} />
      <div className="footer"><span className="live-dot" style={{ background: 'var(--accent)' }} />{tr('Eine App von SUPERPORT', 'An app by SUPERPORT')}</div>
    </div>
  );
}

// Themes: the level above the projects (e.g. Themes L4 over Project L3). One tile per theme with what its projects add
// up to – hours, staffing in the waterline quarter, health. The ranking stays one list (capacity goes by rank); a click
// on a tile highlights that theme's projects there, a second click shows all again.
function Themes({ themes, ranked, order, metrics, projectQ, wq, focus, onFocus, title }) {
  const tip = useTip();
  const rankOf = new Map(order.map((r, i) => [r, i + 1]));
  const groups = [...themes.map((t) => ({ id: t.id, t })), { id: '_none', t: null }].map((g) => {
    const ps = ranked.filter((p) => (p.themeId || '_none') === g.id).sort((a, b) => (rankOf.get(a.ref) || 0) - (rankOf.get(b.ref) || 0));
    const sum = (k) => ps.reduce((n, p) => n + (metrics.get(p.ref)?.[k] || 0), 0);
    const st = (s) => ps.filter((p) => (projectQ[p.ref]?.[wq]?.status || 'ok') === s).length;
    const hc = (s) => ps.filter((p) => p.health?.status === s).length;
    return { ...g, ps, OE: sum('OE'), TS: sum('TS'), RE: sum('RE'), ok: st('ok'), partial: st('partial'), no: st('no'), onTrack: hc('onTrack'), atRisk: hc('atRisk'), critical: hc('critical') };
  }).filter((g) => g.ps.length || g.t);
  return (
    <section className="card" aria-label={title} data-themes>
      <div className="card-head">
        <div>
          <h2 className="card-title"><Icon name="layers" />{title}</h2>
          <div className="card-sub" style={{ marginTop: 3 }}>{tr('Die Ebene über den Projekten. Klick auf ein Thema hebt seine Projekte in der Rangfolge hervor.', 'The level above the projects. Click a theme to highlight its projects in the ranking.')}</div>
        </div>
        {focus && <button type="button" className="btn btn-sm btn-ghost" onClick={() => onFocus(null)}><Icon name="x" size={13} />{tr('Alle Projekte zeigen', 'Show all projects')}</button>}
      </div>
      <div className="theme-grid" role="group" aria-label={title}>
        {groups.map((g) => {
          const on = focus === g.id;
          const name = g.t ? g.t.name : tr('Ohne Thema', 'No theme');
          const ranks = g.ps.map((p) => rankOf.get(p.ref)).filter(Boolean);
          const pct = g.OE ? Math.min(1, g.TS / Math.max(g.OE, g.TS + g.RE)) : 0;
          return (
            <motion.button key={g.id} type="button" className={`theme-tile ${on ? 'on' : ''} ${focus && !on ? 'faded' : ''}`} aria-pressed={on} onClick={() => onFocus(on ? null : g.id)} whileTap={{ scale: 0.98 }} data-theme={g.id}
              {...tip(infoCard({ title: name, text: g.t ? `${g.t.key} · ${g.t.status?.name || ''}` : tr('Projekte ohne übergeordnetes Thema', 'Projects without a parent theme'),
                items: g.ps.slice(0, 12).map((p) => ({ text: `${rankOf.get(p.ref)}. ${p.name}`, tone: (projectQ[p.ref]?.[wq]?.status || 'ok') === 'ok' ? 'ok' : 'warn' })) }))}>
              <span className="theme-tile-head"><b>{name}</b>{g.t && <span className="mono faint">{g.t.key}</span>}</span>
              <span className="theme-tile-sub">{tr(`${g.ps.length} ${g.ps.length === 1 ? 'Projekt' : 'Projekte'}`, `${g.ps.length} ${g.ps.length === 1 ? 'project' : 'projects'}`)}{ranks.length ? ` · ${tr('Rang', 'rank')} ${ranks.slice(0, 6).join(', ')}${ranks.length > 6 ? ' …' : ''}` : ''}</span>
              <span className="theme-bar" aria-hidden="true"><i style={{ width: `${pct * 100}%` }} /></span>
              <span className="theme-tile-sub num">{fmt.h(g.TS)} / {fmt.h(g.OE)} · {tr('offen', 'remaining')} {fmt.h(g.RE)}</span>
              <span className="theme-tile-sub">
                {g.ps.length > 0 ? <>{fmt.quarter(wq)}: {g.ok} {tr('besetzbar', 'staffable')}{g.partial ? ` · ${g.partial} ${tr('teilweise', 'partly')}` : ''}{g.no ? ` · ${g.no} ${tr('nicht', 'not')}` : ''}</> : tr('keine Projekte im Portfolio', 'no projects in the portfolio')}
              </span>
              {(g.atRisk + g.critical) > 0 && <span className="theme-tile-sub" style={{ color: 'var(--bad)' }}>{g.critical ? `${g.critical} ${tr('kritisch', 'critical')}` : ''}{g.critical && g.atRisk ? ' · ' : ''}{g.atRisk ? `${g.atRisk} ${tr('gefährdet', 'at risk')}` : ''}</span>}
            </motion.button>
          );
        })}
      </div>
    </section>
  );
}

function WaterDivider({ label }) {
  return (
    <motion.div layout initial={{ opacity: 0, scaleX: 0.6 }} animate={{ opacity: 1, scaleX: 1 }} exit={{ opacity: 0 }} transition={spring}
      style={{ position: 'relative', height: 26, margin: '-13px 0', zIndex: 4, pointerEvents: 'none' }} aria-label={label}>
      <svg width="100%" height="26" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }} aria-hidden="true">
        <defs>
          <pattern id="wavep" width="40" height="26" patternUnits="userSpaceOnUse">
            <path d="M0 13 Q10 6 20 13 T40 13" fill="none" stroke="var(--accent)" strokeWidth="2" />
          </pattern>
        </defs>
        {/* CSS transform loop (compositor): framer animated the x attribute in JS on every frame, endlessly */}
        <rect x="0" y="0" width="200%" height="26" fill="url(#wavep)" className="water-pan" />
      </svg>
      <span style={{ position: 'absolute', right: 128, top: 2, fontSize: 11, fontWeight: 650, letterSpacing: '0.04em', color: '#fff', background: 'var(--accent)', padding: '3px 9px', borderRadius: 999, boxShadow: '0 6px 16px -6px var(--accent-glow)' }}>
        {label}
      </span>
    </motion.div>
  );
}

const NO_Q = {};
// One project row. Memoized: all it shows comes in as props (the handlers are stable, see Portfolio), so a row added in a
// later step or a toggle on another row does not render it again.
const Row = memo(function Row({ p, rank, m, pq, quarters, wq, below, waterHere, canRank, dragging, h, canHealth, rhythm, wqLabel, hOpen, waits, conflicts, projectQ, teams, setView, setCapView, still, theme, dim }) {
  const controls = useDragControls();
  const tip = useTip();
  const teamName = (id) => teams.get(id)?.name || (id === '_none' ? tr('Ohne Team', 'No team') : id);
  const [menu, setMenu] = useState(null);
  const warn = m.warnings.filter((x) => x.kind !== 'expiredTshirt');
  const onDragEnd = () => h.dragEnd(), onMove = (d) => h.move(p.ref, d), onHealth = () => h.health(p), onRemove = () => h.remove(p), onToggleH = () => h.toggleH(p.ref);
  // UC-03: `waits` = which projects this one waits for (configured link types; orange = date conflict or lower rank),
  // from waitsFor(computed) once per computed
  return (
    <>
      <AnimatePresence>{waterHere && <WaterDivider key="water" label={`${tr('Wasserlinie', 'Waterline')} ${wqLabel}`} />}</AnimatePresence>
      <Reorder.Item as="div" value={p.ref} dragListener={false} dragControls={controls} onDragEnd={onDragEnd}
        className={`rank-row ${dragging ? 'dragging' : ''} ${below ? 'below-water' : ''} ${dim ? 'theme-dim' : ''}`}
        whileDrag={{ scale: 1.015 }} transition={spring} layout="position"
        tabIndex={0} aria-label={`${tr('Rang', 'Rank')} ${rank}: ${p.name}`}
        onKeyDown={(e) => { if (canRank && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); onMove(e.key === 'ArrowUp' ? -1 : 1); } }}>
        {canRank ? (
          <button className="handle" onPointerDown={(e) => { h.dragStart(p.ref); controls.start(e); }} aria-label={tr('Ziehen zum Verschieben', 'Drag to move')}><Icon name="grip" /></button>
        ) : <span />}
        <motion.div className="rank-num" key={rank} initial={still ? false : { scale: 1.25, color: 'var(--accent)' }} animate={{ scale: 1, color: 'var(--ink)' }} transition={{ duration: 0.5 }}
          tabIndex={p.globalRank && p.globalRank !== rank ? 0 : undefined}
          {...(p.globalRank && p.globalRank !== rank ? tip(<div>{tr(`Globaler Rang ${p.globalRank} – inklusive Projekten, die du nicht sehen kannst.`, `Global rank ${p.globalRank} – including projects you can't see.`)}</div>) : {})}>
          {rank}{p.globalRank && p.globalRank !== rank && <sup style={{ fontSize: 10, color: 'var(--ink-3)', marginLeft: 1 }}>*</sup>}
        </motion.div>
        <div className="pname">
          <div className="pname-title">
            <HealthDot health={p.health} rhythmDays={rhythm} facts={{ progress: m.progress, overdue: m.overdueCount, daysOverdue: m.daysOverdue, conflicts, staffable: !Object.values(projectQ || {}).some((q) => q.status !== 'ok') }} />
            <button className="t" style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontWeight: 560, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}
              onClick={() => setView('project', { ref: p.ref })}>{p.name}</button>
            {warn.length > 0 && (
              <span className="warn-ico" tabIndex={0} {...tip(<div>{warn.map((x) => <div key={x.kind}>{x.kind === 'forecastOverPlan' ? tr(`Prognose liegt ${fmt.pct(x.pct)} über dem Original Estimate`, `Forecast is ${fmt.pct(x.pct)} above the Original Estimate`) : tr(`Original Estimate liegt ${fmt.pct(x.pct)} über der T-Shirt-Größe`, `Original Estimate is ${fmt.pct(x.pct)} above the T-shirt size`)}</div>)}</div>)}>
                <Icon name="alert" size={14} />
              </span>
            )}
          </div>
          <div className="pname-meta">
            <span className="mono">{p.key}</span>
            {p.owner && <span className="row" style={{ gap: 5 }}><Avatar user={p.owner} size={16} />{p.owner.name}</span>}
            {m.due && <span style={{ color: m.daysOverdue ? 'var(--bad)' : undefined }}>{tr('fällig', 'due')} {fmt.date(m.due)}{m.daysOverdue ? ` · +${m.daysOverdue} ${tr('T', 'd')}` : ''}</span>}
            {theme && <span className="theme-chip" data-theme-chip title={`${theme.key} · ${theme.name}`}><Icon name="layers" size={11} />{theme.name}</span>}
            {waits && (
              <button type="button" className={`waits ${waits.hot ? 'hot' : ''}`} onClick={() => setView('project', { ref: p.ref })}
                {...tip(infoCard({
                  title: tr('Wartet auf andere Projekte', 'Waits for other projects'),
                  items: waits.list.map((e) => ({ text: `${e.rank}. ${e.name}`, sub: `${e.items} ${tr(e.items === 1 ? 'Vorgang wartet' : 'Vorgänge warten', e.items === 1 ? 'item waits' : 'items wait')}${e.conflicts ? ` · ${e.conflicts} ${tr('mit Terminkonflikt', 'with a date conflict')}` : ''}${e.lowerRank ? ` · ${tr('Voraussetzung hat niedrigeren Rang', 'prerequisite ranks lower')}` : ''}`, tone: e.conflicts ? 'bad' : e.lowerRank ? 'warn' : undefined })),
                  text: tr('Orange = Terminkonflikt oder die Voraussetzung hat einen niedrigeren Rang. Details im Tab Projekte unter Handlungsbedarf.', 'Orange = date conflict or the prerequisite ranks lower. Details in the Projects tab under Action needed.'),
                }))}>
                <Icon name="link" size={11} />{waitsLabel(waits, tr)}
              </button>
            )}
          </div>
        </div>
        <Reife m={m} />
        <Hours m={m} open={hOpen} onToggle={onToggleH} still={still} />
        {quarters.map((q) => {
          const cell = pq[q];
          const hours = Object.values(m.demand[q] || {}).reduce((a, b) => a + b, 0);
          if (!hours) return <span key={q} className="qcell empty" data-q={fmt.quarter(q)} aria-label={tr('kein Bedarf', 'no demand')}>–</span>;
          const missingTeams = (cell?.teams || []).filter((t) => t.status !== 'ok');
          return (
            <button key={q} className={`qcell ${cell?.status || 'ok'}`} data-q={fmt.quarter(q)} style={q === wq ? { outline: '1.5px solid color-mix(in srgb, var(--accent) 40%, transparent)', outlineOffset: 2 } : undefined}
              onClick={() => { setCapView('quarters'); setView('project', { ref: p.ref }); }}
              {...tip(<div><b>{fmt.quarter(q)}</b> · {tr('offener Bedarf', 'open demand')} {fmt.h(hours)}
                {missingTeams.length ? <div style={{ marginTop: 4 }}>{missingTeams.map((t) => <div key={t.teamId}>{tr('Nicht besetzbar', 'Not staffable')}: <b>{teamName(t.teamId)}</b> ({fmt.h(t.demand - t.staffed)} {tr('fehlen', 'missing')})</div>)}</div> : <div style={{ marginTop: 4 }}>{tr('Voll besetzbar', 'Fully staffable')}</div>}
                <div style={{ marginTop: 4, opacity: 0.7 }}>{tr('Klick: Kapazität für dieses Projekt', 'Click: capacity for this project')}</div></div>)}>
              <b>{fmt.n(hours)}</b><span style={{ fontSize: 10.5 }}>h</span>
            </button>
          );
        })}
        <div className="row rank-acts" style={{ justifyContent: 'flex-end', gap: 4 }}>
          {canRank && <>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onMove(-1)} aria-label={tr('Rang hoch', 'Move up')} disabled={rank === 1}><Icon name="up" /></button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onMove(1)} aria-label={tr('Rang runter', 'Move down')}><Icon name="down" /></button>
          </>}
          {canHealth && <button className="btn btn-sm" data-tour="health" onClick={onHealth}>{tr('Aktualisieren', 'Update')}</button>}
          {canRank && <button className="btn btn-ghost btn-icon btn-sm" aria-label={tr('Mehr', 'More')} onClick={(e) => setMenu(e.currentTarget)}><Icon name="more" /></button>}
          <Menu anchor={menu} onClose={() => setMenu(null)}>
            <button className="menu-item" onClick={() => { setMenu(null); setView('project', { ref: p.ref }); }}><Icon name="project" />{tr('Projektdetails öffnen', 'Open project details')}</button>
            <button className="menu-item danger" onClick={() => { setMenu(null); onRemove(); }}><Icon name="trash" />{tr('Aus Portfolio entfernen', 'Remove from portfolio')}</button>
          </Menu>
        </div>
      </Reorder.Item>
    </>
  );
}, (a, b) => { for (const k in a) if (k !== 'still' && a[k] !== b[k]) return false; return true; }); // `still` only matters on mount

// ---------- Support: one row per service space, above all projects (no rank, cannot be moved) ----------
// Health from the space's SLA rate; hours = Ø weekly time spent on its tickets; quarter cells = the hours
// reserved from team capacity before any project (the same reservation the waterline deducts).
function SupportCard({ support, quarters }) {
  const tip = useTip();
  const { setView, computed } = useApp();
  const W = support.averagingWeeks || 4;
  const teamName = (id) => computed.model.teams.get(id)?.name || (id === '_none' ? tr('Ohne Team', 'No team') : id);
  const hName = { onTrack: tr('Im Plan', 'On track'), atRisk: tr('Gefährdet', 'At risk'), critical: tr('Kritisch', 'Critical') };
  const target = Math.round((support.slaTarget ?? 0.95) * 100);
  return (
    <motion.section className="card support-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.08 } }} aria-label="Support">
      <div className="card-head">
        <div>
          <h2 className="card-title"><Icon name="headset" />Support</h2>
          <div className="card-sub" style={{ marginTop: 3 }}>{tr('Hat Vorrang vor allen Projekten – die Stunden werden zuerst von der Team-Kapazität abgezogen.', 'Takes priority over all projects – its hours are deducted from team capacity first.')}</div>
        </div>
      </div>
      <div className="rank-scroll">
        <div className="rank-inner">
          <div className="rank-head">
            <span /><span /><span>{tr('Service-Space', 'Service space')}</span><span /><span>{tr('Stunden', 'Hours')}</span>
            {quarters.map((q) => <span key={q} style={{ textAlign: 'center' }}>{fmt.quarter(q)}</span>)}<span />
          </div>
          {support.services.map((sv) => {
            // tickets and SLA exactly as the Support view counts them (fallback: the server's aggregate)
            const k = computed.supportA ? serviceKpis(computed.supportA, sv.id) : null;
            const open = k ? k.open : sv.open || 0, rate = k ? k.slaRate : sv.slaRate, health = k ? k.health : sv.health, breached = k ? k.breached : sv.breached || 0;
            const avg = sv.avgWeekly ?? (sv.hours || 0) / W;
            const weekly = sv.weekly ?? avg;
            const isQueue = String(sv.id).startsWith('q:');
            const slaTip = rate == null ? tr('Noch keine SLA-Daten', 'No SLA data yet')
              : tr(`SLA ${fmt.pct(rate, 1)} erfüllt (Ziel ${target} %) · ${breached} Verletzungen`, `SLA ${fmt.pct(rate, 1)} met (goal ${target}%) · ${breached} breaches`);
            const teams = (sv.teams || []).filter((t) => t.weekly > 0);
            return (
              <div key={sv.id} className="rank-row support">
                <span />
                <div className="rank-num s" title={tr('Support hat Vorrang und keinen Rang', 'Support takes priority and has no rank')}>S</div>
                <div className="pname">
                  <div className="pname-title">
                    <span className={`health ${health || 'none'}`} role="img" tabIndex={0} aria-label={`${health ? hName[health] : tr('Keine Health', 'No health')}: ${slaTip}`} {...tip(<div><b>{health ? hName[health] : '–'}</b> · {slaTip}<div style={{ opacity: 0.7, marginTop: 3 }}>{tr('Grün ab SLA-Ziel, gelb bis 5 Punkte darunter, rot darunter.', 'Green from the SLA goal, amber up to 5 points below, red below that.')}</div></div>)} />
                    <button className="t" style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontWeight: 560, cursor: 'pointer', textAlign: 'left' }} onClick={() => setView('support')}>{sv.name || sv.key || sv.id}</button>
                  </div>
                  <div className="pname-meta">{sv.key && !isQueue ? <span className="mono">{sv.key}</span> : <span>{tr('Queue', 'Queue')}</span>}<span>{tr('Vorrang vor allen Projekten', 'priority over all projects')}</span></div>
                </div>
                <span className="num muted" style={{ textAlign: 'right' }}>–</span>
                <div className="hours">
                  <div className="hb-line"><b className="num">Ø {fmt.h(avg, avg > 0 && avg < 9.95 ? 1 : 0)}</b> {tr('/ Woche Time Spent', '/ week time spent')}</div>
                  <div className="hb-line muted">{open} {tr('offene Tickets', 'open tickets')}{rate != null ? ` · SLA ${fmt.pct(rate, 1)}` : ''} · Remaining {fmt.h(sv.openRe || 0)}</div>
                  {(sv.rising || []).length > 0 && <span className="chip chip-accent hb-warn" {...tip(<div>{tr('Letzte 2 Wochen über 1,2 × Durchschnitt – reserviert wird der höhere Wert.', 'Last 2 weeks above 1.2 × the average – the higher value is reserved.')}</div>)}><Icon name="up" size={11} />{tr('Steigt', 'Rising')}: {sv.rising.map(teamName).join(', ')}</span>}
                </div>
                {quarters.map((q) => (
                  <button key={q} className="qcell support" data-q={fmt.quarter(q)} onClick={() => setView('support')}
                    {...tip(<div><b>{sv.name || sv.key}</b> · {tr('reserviert in', 'reserved in')} {fmt.quarter(q)}: {fmt.h(weekly * 12)}
                      {teams.length > 0 && <div style={{ marginTop: 4 }}>{teams.map((t) => `${teamName(t.teamId)} ${fmt.h(t.weekly * 12)}`).join(' · ')}</div>}
                      <div style={{ marginTop: 4, opacity: 0.7 }}>{tr(`Ø ${W} Wochen × 12 Wochen je Quartal`, `avg. of ${W} weeks × 12 weeks per quarter`)}</div></div>)}>
                    <b>{fmt.n(weekly * 12)}</b><span style={{ fontSize: 10.5 }}>h</span>
                  </button>
                ))}
                <span />
              </div>
            );
          })}
        </div>
      </div>
    </motion.section>
  );
}

// Reife column: original estimate ÷ (original estimate + open T-shirt size) – "–" without a T-shirt size.
function Reife({ m }) {
  const tip = useTip();
  const mb = m.maturityBasis || { oeCovered: m.OE };
  const text = m.maturity == null && mb.withTshirt > 0
    ? tr(`T-Shirt Size nur in abgelaufenen Quartalen (${fmt.h(m.expired)} verfallen), nichts als Story geschätzt.`, `T-shirt size only in past quarters (${fmt.h(m.expired)} lapsed), nothing estimated as stories.`)
    : m.maturity == null
    ? tr('Keine T-Shirt Size – ohne grobe Schätzung ist unbekannt, wie viel noch fehlt.', 'No T-shirt size – without a rough estimate it is unknown how much is still missing.')
    : tr(`${fmt.h(mb.oeCovered)} Original Estimate, ${m.openTshirt > 0.5 ? `${fmt.h(m.openTshirt)} offene T-Shirt Size` : 'keine offene T-Shirt Size'}${m.expired > 0.5 ? ` · ${fmt.h(m.expired)} T-Shirt Size lagen in abgelaufenen Quartalen und verfallen` : ''}`,
      `${fmt.h(mb.oeCovered)} original estimate, ${m.openTshirt > 0.5 ? `${fmt.h(m.openTshirt)} open T-shirt size` : 'no open T-shirt size'}${m.expired > 0.5 ? ` · ${fmt.h(m.expired)} of T-shirt size lay in past quarters and lapsed` : ''}`);
  return (
    <span className="num reife" data-label={tr('Reife', 'Maturity')} tabIndex={0} aria-label={`${tr('Reife', 'Maturity')} ${m.maturity == null ? '–' : fmt.pct(m.maturity)}: ${text}`} {...tip(<div><b>{tr('Reife', 'Maturity')}</b> · {text}</div>)}
      style={m.maturity == null ? { color: 'var(--accent-strong)' } : undefined}>
      {m.maturity == null ? '–' : fmt.pct(m.maturity)}
    </span>
  );
}

// Hours: one bar, the same colours as its legend – black time spent, grey remaining (its end = forecast),
// black line original estimate, orange dashed line T-shirt size. Collapsed: one line; expanded: the legend.
function Hours({ m, open, onToggle, still }) {
  const tip = useTip();
  const sc = Math.max(m.tshirtTotal, m.OE, m.forecast, 1) * 1.05;
  const pc = (v) => `${Math.min(100, (v / sc) * 100)}%`;
  const fw = m.warnings.find((x) => x.kind === 'forecastOverPlan');
  const pw = !fw && m.warnings.find((x) => x.kind === 'planOverRough');
  const title = tr(`T-Shirt Size ${fmt.h(m.tshirtTotal)} · Original Estimate ${fmt.h(m.OE)} · Time Spent ${fmt.h(m.TS)} · Remaining Estimate ${fmt.h(m.RE)} · Prognose ${fmt.h(m.forecast)}`,
    `T-shirt size ${fmt.h(m.tshirtTotal)} · original estimate ${fmt.h(m.OE)} · time spent ${fmt.h(m.TS)} · remaining estimate ${fmt.h(m.RE)} · forecast ${fmt.h(m.forecast)}`);
  return (
    <div className="hours">
      <div className="hb-track" role="img" aria-label={title} {...tip(<div>{title}</div>)}>
        <motion.span className="hb-ts" initial={still ? false : { width: 0 }} animate={{ width: pc(m.TS) }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
        <motion.span className="hb-re" initial={still ? false : { left: 0, width: 0 }} animate={{ left: pc(m.TS), width: pc(m.RE) }} transition={{ duration: 0.8, delay: 0.06, ease: [0.16, 1, 0.3, 1] }} />
        {m.OE > 0 && <span className="hb-oe" style={{ left: pc(m.OE) }} />}
        {m.tshirtTotal > 0 && <span className="hb-tshirt" style={{ left: pc(m.tshirtTotal) }} />}
      </div>
      {m.OE > 0 ? (open ? (
        <div className="hb-legend">
          <span><i className="sw-ts" />Time Spent <b>{fmt.h(m.TS)}</b></span>
          <span><i className="sw-oe" />Original Est. <b>{fmt.h(m.OE)}</b></span>
          <span><i className="sw-re" />Remaining <b>{fmt.h(m.RE)}</b></span>
          <span><i className="sw-tshirt" />T-Shirt <b>{m.tshirtTotal > 0 ? fmt.h(m.tshirtTotal) : '–'}</b></span>
          <span className="full">{tr('Prognose', 'Forecast')} <b>{fmt.h(m.forecast)}</b> <span className="faint">= Time Spent + Remaining</span></span>
          <button type="button" className="hb-toggle" aria-expanded="true" onClick={onToggle}>▴ {tr('weniger', 'less')}</button>
        </div>
      ) : (
        <button type="button" className="hb-toggle hb-short" aria-expanded="false" onClick={onToggle} title={tr('Details zu den Stunden anzeigen', 'Show the hours in detail')}>
          <span><b>{fmt.h(m.TS)}</b> {tr('von', 'of')} {fmt.h(m.OE)} · {tr('Prognose', 'Forecast')} <b>{fmt.h(m.forecast)}</b></span><span aria-hidden="true">▾</span>
        </button>
      )) : (
        <span className="hb-line muted"><i className="sw-tshirt" />{tr('Noch kein Original Estimate', 'No original estimate yet')} · T-Shirt <b>{m.tshirtTotal > 0 ? fmt.h(m.tshirtTotal) : '–'}</b></span>
      )}
      {fw && <span className="chip chip-accent hb-warn">+{Math.round(fw.pct * 100)} % {tr('über Original Estimate erwartet', 'above original estimate expected')}</span>}
      {pw && <span className="chip chip-outline hb-warn">Original Estimate {Math.round(pw.pct * 100)} % {tr('über T-Shirt', 'above T-shirt')}</span>}
    </div>
  );
}

// ---------- health (UC-12) ----------
const HEALTH_OPTS = [
  { v: 'onTrack', c: 'var(--ok)', bg: 'var(--ok-soft)', icon: 'check' },
  { v: 'atRisk', c: 'var(--warn)', bg: 'var(--warn-soft)', icon: 'alert' },
  { v: 'critical', c: 'var(--bad)', bg: 'var(--bad-soft)', icon: 'zap' },
];
// Lotse × KI (shared/lotse/teamwork.js): Lotse's health suggestion is there at once, from the project's numbers; the AI's
// draft comes on request. Same status → "Beide schlagen … vor"; different → both, the person picks. Saved only with
// "Speichern" (health.set, with undo).
function HealthTeam({ lotse, ai, onPick }) {
  if (!lotse) return null;
  const same = ai && ai.status === lotse.status;
  const pick = (d, who) => () => onPick(d, who);
  return (
    <div className="tw-health" data-tw-health={ai ? (same ? 'same' : 'differs') : 'lotse'}>
      <div className="tw-health-row">
        <span className="lx-tag"><LotseMark size={11} />{tr('Lotse · geprüft', 'Lotse · verified')}</span>
        <span className={`health ${lotse.status}`} aria-hidden="true" /><b>{healthName(lotse.status)}</b>
        <span className="muted tw-health-c">{lotse.comment}</span>
        {!same && <button type="button" className="btn btn-xs" onClick={pick(lotse, 'lotse')}>{tr('Übernehmen', 'Use')}</button>}
      </div>
      {ai && !same && (
        <div className="tw-health-row ai">
          <span className="lx-tag ai"><Icon name="sparkle" size={11} />{tr('KI', 'AI')}</span>
          <span className={`health ${ai.status}`} aria-hidden="true" /><b>{healthName(ai.status)}</b>
          <span className="muted tw-health-c">{ai.comment}</span>
          <button type="button" className="btn btn-xs" onClick={pick(ai, 'ai')}>{tr('Übernehmen', 'Use')}</button>
        </div>
      )}
      {ai && <div className={`lx-verdict ${same ? 'agrees' : 'differs'}`} role="status"><Icon name={same ? 'check' : 'alert'} size={13} /><b>{same ? tr(`Beide schlagen „${healthName(lotse.status)}“ vor`, `Both suggest "${healthName(lotse.status)}"`) : tr('Lotse und KI sehen den Status verschieden – du wählst', 'Lotse and the AI see the status differently – you choose')}</b></div>}
      {same && <button type="button" className="btn btn-xs tw-pick" onClick={pick(lotse, 'lotse')}>{tr('Lotses Satz übernehmen', 'Use Lotse\'s sentence')}</button>}
    </div>
  );
}
function HealthModal({ project, draft: handed, onClose }) {
  const { setHealth, toast, config } = useApp();
  const lctx = useLotseCtx();
  const [status, setStatus] = useState('onTrack');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [aiDraft, setAiDraft] = useState(null);
  const lotse = useMemo(() => (project && lctx ? lotseDraft('healthDraft', { ref: project.ref }, lctx).result : null), [project, lctx]);
  // a draft handed over by Lotse ("Als Health übernehmen") pre-fills status and sentence – nothing is saved until "Speichern"
  useEffect(() => { if (project) { setStatus(handed?.status || project.health?.status || 'onTrack'); setComment(String(handed?.comment || '').slice(0, 280)); setAiDraft(null); } }, [project, handed]);
  const pick = (d, who) => { setStatus(d.status); setComment(String(d.comment || '').slice(0, 280)); if (aiDraft) track(`teamwork:pick:${who}`); };
  const draft = async () => {
    setDrafting(true);
    try {
      const d = await call('ai.healthDraft', { ref: project.ref, lang: getLang() });
      track('ai:healthDraft');
      setAiDraft(d);
      if (lotse) track(d.status === lotse.status ? 'teamwork:same' : 'teamwork:differs');
      setStatus(d.status);
      let i = 0; const t = setInterval(() => { i += 3; setComment(d.comment.slice(0, i)); if (i >= d.comment.length) clearInterval(t); }, 16);
    } catch (e) { toast({ text: errText(e), error: true }); } finally { setDrafting(false); }
  };
  const save = async () => {
    setBusy(true);
    try { await setHealth(project.ref, status, comment.trim()); onClose(); } catch (e) { toast({ text: errText(e), error: true }); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!project} onClose={onClose} icon="heart" title={tr('Health-Update', 'Health update')} sub={project?.name}
      footer={<><button className="btn btn-ghost" onClick={onClose}>{tr('Abbrechen', 'Cancel')}</button><button className="btn btn-primary" disabled={!comment.trim() || busy} onClick={save}>{busy ? tr('Speichere …', 'Saving …') : tr('Speichern', 'Save')}</button></>}>
      {project?.health && <div className="callout" style={{ marginBottom: 14 }}><span className={`health ${project.health.status}`} style={{ marginTop: 4 }} /><div><b>{healthName(project.health.status)}</b> · {fmt.ago(project.health.at)}<div className="muted">„{project.health.comment}"</div></div></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {HEALTH_OPTS.map((o) => (
          <motion.button key={o.v} type="button" className="choice" aria-pressed={status === o.v} onClick={() => setStatus(o.v)} whileTap={{ scale: 0.97 }}
            style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10, ...(status === o.v ? { borderColor: o.c, boxShadow: `0 0 0 4px ${o.bg}` } : {}) }}>
            <span style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', background: o.bg, color: o.c }}><Icon name={o.icon} /></span>
            <b>{healthName(o.v)}</b>
          </motion.button>
        ))}
      </div>
      <HealthTeam lotse={lotse} ai={aiDraft} onPick={pick} />
      <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
        <label className="label" style={{ margin: 0 }} htmlFor="health-comment">{tr('Ein Satz zum Stand', 'One sentence on the status')}</label>
        {aiOn(config, 'healthDraft') && <button type="button" className="btn btn-ghost btn-xs" style={{ color: 'var(--accent-strong)' }} disabled={drafting} onClick={draft}><Icon name="sparkle" size={12} />{drafting ? tr('Formuliere …', 'Drafting …') : tr('Mit KI formulieren', 'Draft with AI')}</button>}
      </div>
      <textarea id="health-comment" className="input" rows={3} maxLength={280} value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: '100%', marginTop: 6 }}
        placeholder={tr('z. B. Abnahme verschiebt sich um eine Woche, Go-Live bleibt.', 'e.g. Acceptance slips by a week, go-live holds.')} />
      <div className="faint" style={{ fontSize: 12, textAlign: 'right' }}>{comment.length} / 280</div>
    </Modal>
  );
}

// ---------- add / remove (UC-16) ----------
// Add project (boss 2026-11-19: "search faster and smarter – mainly by name, but the key too"). The visible candidates are
// loaded once when the drawer opens and filtered on every keystroke – partial keys, word starts in any order, accents and
// dashes, a typo or two, initials (shared/projectSearch.js). Sites with more candidates than one load also ask the server.
function Hit({ text, q }) {
  return matchParts(text, q).map((p, i) => (p.hit ? <mark key={i} className="search-hit">{p.t}</mark> : <span key={i}>{p.t}</span>));
}
function AddDrawer({ open, onClose }) {
  const { addProject, config, ds } = useApp();
  const [q, setQ] = useState('');
  const [pool, setPool] = useState(null); // { items, truncated }
  const [extra, setExtra] = useState([]); // server results for a query (large sites only)
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(null);
  const t = useRef(null);
  const load = () => { setPool(null); call('portfolio.candidates', { pool: true }).then((r) => setPool(Array.isArray(r) ? { items: r, truncated: false } : r)).catch(() => setPool({ items: [], truncated: false })); };
  useEffect(() => { if (open) { setQ(''); setExtra([]); load(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // more candidates than one load holds: the server searches too (debounced), its hits join the list
  useEffect(() => {
    clearTimeout(t.current);
    if (!open || !pool?.truncated || !q.trim()) { setExtra([]); setBusy(false); return undefined; }
    setBusy(true);
    t.current = setTimeout(() => { call('portfolio.candidates', { query: q }).then((r) => setExtra(Array.isArray(r) ? r : [])).catch(() => setExtra([])).finally(() => setBusy(false)); }, 300);
    return () => clearTimeout(t.current);
  }, [q, open, pool?.truncated]);
  const all = useMemo(() => {
    const base = pool?.items || [];
    const seen = new Set(base.map((c) => c.ref));
    return [...base, ...extra.filter((c) => !seen.has(c.ref))];
  }, [pool, extra]);
  const shown = useMemo(() => rankCandidates(all, q, 60), [all, q]);
  const issueMode = config.portfolio?.source === 'issue';
  const query = q.trim();
  // the spaces a new project work item can go to: where projects are today (most first), then the candidates' spaces
  const spaces = useMemo(() => {
    const m = new Map();
    const bump = (id, key, name, w) => { if (!id) return; const x = m.get(String(id)) || { id: String(id), key, name: name || key, n: 0 }; x.n += w; if (name) x.name = name; m.set(String(id), x); };
    for (const p of ds.portfolio || []) bump(p.projectId, p.projectKey, null, 10);
    for (const c of pool?.items || []) bump(c.projectId, c.spaceKey, c.space, 1);
    return [...m.values()].sort((a, b) => b.n - a.n || String(a.name).localeCompare(String(b.name)));
  }, [ds.portfolio, pool]);
  const [space, setSpace] = useState('');
  useEffect(() => { if (!space && spaces[0]) setSpace(spaces[0].id); }, [spaces, space]);
  return (
    <Drawer open={open} onClose={onClose} title={tr('Projekt hinzufügen', 'Add project')}
      sub={issueMode ? tr('Vorgänge vom konfigurierten Typ, die noch nicht im Portfolio sind', 'Work items of the configured type not yet in the portfolio') : tr('Spaces, die noch nicht im Portfolio sind', 'Spaces not yet in the portfolio')}>
      <div className="input-wrap"><Icon name="search" /><input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Name oder Schlüssel – ein Teil genügt', 'Name or key – part of it is enough')} aria-label={tr('Suchen', 'Search')} data-project-search /></div>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginTop: 8, minHeight: 22, flexWrap: 'wrap' }}>
        <span className="faint" style={{ fontSize: 12 }} aria-live="polite" data-search-count>
          {pool == null ? tr('Lädt …', 'Loading …')
            : query ? tr(`${shown.length}${shown.length === 60 ? '+' : ''} ${shown.length === 1 ? 'Treffer' : 'Treffer'}`, `${shown.length}${shown.length === 60 ? '+' : ''} ${shown.length === 1 ? 'match' : 'matches'}`)
              : pool.truncated ? tr(`Die ${all.length} zuletzt geänderten – tippen, um alle zu durchsuchen`, `The ${all.length} most recently updated – type to search them all`)
                : tr(`${all.length} ${all.length === 1 ? 'Projekt' : 'Projekte'} verfügbar`, `${all.length} ${all.length === 1 ? 'project' : 'projects'} available`)}
          {busy && <> · {tr('sucht weiter …', 'searching further …')}</>}
        </span>
        {issueMode && (
          <span className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 0, maxWidth: '100%' }} data-create-project>
            <button className="btn btn-ghost btn-sm" onClick={() => createIssue(config.portfolio.issueTypeIds[0], load, space || null)}>
              <Icon name="plus" />{tr('Neuen Projekt-Vorgang in Jira anlegen', 'Create a new project work item in Jira')}
            </button>
            {spaces.length > 0 && (
              <select className="select select-sm" style={{ maxWidth: '100%', minWidth: 0 }} value={space} onChange={(e) => setSpace(e.target.value)} aria-label={tr('Space für den neuen Projekt-Vorgang', 'Space for the new project work item')} title={tr('In diesem Space wird der Projekt-Vorgang angelegt – vorgewählt: wo eure Projekte heute liegen', 'The project work item is created in this space – preselected: where your projects are today')}>
                {spaces.map((x) => <option key={x.id} value={x.id}>{tr('in', 'in')} {x.name}{x.key && x.name !== x.key ? ` (${x.key})` : ''}</option>)}
              </select>
            )}
          </span>
        )}
      </div>
      <div className="stack" style={{ marginTop: 10, gap: 8 }} data-search-results>
        {pool == null && [0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 58 }} />)}
        {pool != null && !shown.length && !busy && (
          <div className="muted" style={{ padding: 20, textAlign: 'center' }}>
            {query ? <>{tr(`Nichts gefunden für „${query}“.`, `Nothing found for "${query}".`)}<div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{tr('Ein Wortanfang oder ein Teil des Schlüssels genügt, z. B. „glas“ oder „PCX-5“.', 'A word start or part of the key is enough, e.g. "glas" or "PCX-5".')}</div></> : tr('Keine weiteren Projekte gefunden', 'No further projects found')}
          </div>
        )}
        {shown.map((c) => (
          <div key={c.ref} className="card search-row" data-candidate={c.key}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 540 }}><Hit text={c.name} q={query} /></div>
              <div className="muted" style={{ fontSize: 12 }}><span className="mono"><Hit text={c.key} q={query} /></span>{c.space ? ' · ' : ''}{c.space && <Hit text={c.space} q={query} />}{c.status ? ` · ${c.status}` : ''}</div>
            </div>
            {c.owner && <Avatar user={c.owner} size={24} />}
            <button className="btn btn-sm" disabled={adding === c.ref} onClick={async () => { setAdding(c.ref); try { await addProject(c.ref); setPool((p) => (p ? { ...p, items: p.items.filter((x) => x.ref !== c.ref) } : p)); setExtra((l) => l.filter((x) => x.ref !== c.ref)); } finally { setAdding(null); } }}>
              <Icon name="plus" />{tr('Aufnehmen', 'Add')}
            </button>
          </div>
        ))}
      </div>
    </Drawer>
  );
}
function RemoveModal({ project, onClose }) {
  const { removeProject } = useApp();
  return (
    <Modal open={!!project} onClose={onClose} icon="trash" title={tr('Aus dem Portfolio entfernen?', 'Remove from portfolio?')} sub={project?.name}
      footer={<><button className="btn btn-ghost" onClick={onClose}>{tr('Abbrechen', 'Cancel')}</button><button className="btn btn-dark" onClick={() => { removeProject(project.ref); onClose(); }}>{tr('Entfernen', 'Remove')}</button></>}>
      <p style={{ margin: 0 }}>{tr('Der Jira-Vorgang bleibt unverändert. Das Projekt verschwindet aus Rangfolge, Wasserlinie und Report und kann jederzeit wieder aufgenommen werden.', 'The Jira work item stays untouched. The project disappears from ranking, waterline and report and can be re-added any time.')}</p>
    </Modal>
  );
}
