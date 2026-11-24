import { createContext, Profiler, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { computeAll } from '@shared/engine.js';
import { call, writeSnapshot, releaseWrites } from './lib/api.js';
import { tr, chooseLang, getLang } from './lib/i18n.js';
import { VENDOR_OFF } from './lib/aiFlags.js';
import { digestSummary } from '@shared/digest.js';
import { track } from './lib/usage.js';
import { useToast } from './components/ui.jsx';
import { WORKER_MIN_ITEMS, workerSupported, createComputeClient } from './lib/computeWorker.js';
import { devRender } from './lib/virtual.jsx';

const Ctx = createContext(null);
const UNDO_MAX = 30;
export const useApp = () => useContext(Ctx);

const errText = (e) => {
  if (e?.code === 'NO_ACCESS') return tr('Dafür fehlt dir die Berechtigung.', 'You do not have permission for this.');
  if (e?.code === 'NO_EDIT_PERMISSION' || e?.code === 'FORBIDDEN') return tr('Jira erlaubt dir diese Änderung nicht.', 'Jira does not allow you to make this change.');
  if (e?.code === 'AI_DISABLED') return tr('KI-Funktionen sind ausgeschaltet. Ein Jira-Admin kann sie unter Konfiguration › KI & Datenschutz einschalten.', 'AI features are switched off. A Jira admin can switch them on under Configuration › AI & data protection.');
  if (e?.code === 'AI_QUOTA') return tr('Tageslimit für KI-Anfragen erreicht.', 'Daily AI request limit reached.');
  if (e?.code === 'AI_USER_OFF') return tr('Die KI ist für dich ausgeschaltet – oben rechts bei „KI“ kannst du sie einschalten.', 'AI is switched off for you – switch it on at "AI" in the top right.');
  if (e?.code === 'AI_BUDGET' && /:(superportStop|capZero)$/.test(e.message || '')) return tr(...VENDOR_OFF);
  if (e?.code === 'AI_BUDGET') return tr('Das KI-Budget dieses Monats ist aufgebraucht – die App rechnet bis zum 1. des nächsten Monats mit ihren eigenen Regeln weiter.', "This month's AI budget is used up – until the 1st of next month the app works with its own rules.");
  if (e?.code === 'NOT_FOUND') return tr('Nicht gefunden oder nicht sichtbar.', 'Not found or not visible.');
  if (e?.code === 'UNAVAILABLE') return /^Changes are paused/.test(e.message || '')
    ? tr('Änderungen sind gerade pausiert, um eure Daten zu schützen. Nichts wurde gespeichert.', 'Changes are paused right now to keep your data safe. Nothing was saved.')
    : tr('Portfolio Cockpit ist gerade pausiert. Bitte später neu laden.', 'Portfolio Cockpit is paused right now. Please reload later.');
  if (e?.code === 'BUSY') return tr('Jira ist gerade ausgelastet (zu viele Anfragen in kurzer Zeit). Bitte in einer Minute noch einmal – es ist nichts verloren gegangen.', 'Jira is busy right now (too many requests in a short time). Please try again in a minute – nothing was lost.');
  if (e?.code === 'STALE') return tr('Einen Moment – die Daten werden gerade aktualisiert. Bitte gleich noch einmal.', 'One moment – the data is being refreshed. Please try again shortly.');
  if (e?.code === 'SUBTASK_LOCKED') return tr('Schätzungen auf Sub-tasks sind gesperrt.', 'Estimates on sub-tasks are locked.');
  return e?.message || tr('Etwas ist schiefgelaufen.', 'Something went wrong.');
};
export { errText };

export function AppProvider({ boot, children }) {
  const toast = useToast();
  const [ds, setDs] = useState(boot.dataset || null);
  const [stale, setStale] = useState(!!boot.stale);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loadedAt, setLoadedAt] = useState(boot.dataset ? new Date(boot.cachedAt || Date.now()) : null);
  const [lang, setLangState] = useState(getLang());
  const [view, setViewState] = useState(boot.initialView);
  useEffect(() => { track(`view:${boot.initialView || "portfolio"}`); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [selectedRef, setSelectedRef] = useState(boot.prefs?.selectedRef || null);
  const [teamSel, setTeamSel] = useState(null);
  const [focus, setFocus] = useState(null); // { issueId, at } — jump target in project details
  const [capView, setCapView] = useState('weeks');
  const [capCell, setCapCell] = useState(null);
  const [assistant, setAssistant] = useState(null); // { question?, ref? } when the AI drawer is open
  const [askQ, setAskQ] = useState(null); // { q, at } – a question for the Ask canvas
  const [healthReq, setHealthReq] = useState(null); // { ref, status, comment, at } – open the health dialog pre-filled (Lotse "Als Health übernehmen")
  const reqId = useRef(0);

  const load = useCallback(async (quiet = false) => {
    if (!boot.setupComplete) return;
    const id = ++reqId.current;
    if (!quiet) setLoading(true);
    try {
      const data = await call('dataset');
      if (id !== reqId.current) return;
      releaseWrites(); setStale(false);
      setDs(data); setError(null); setLoadedAt(new Date());
    } catch (e) {
      if (id === reqId.current) setError(e);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [boot.setupComplete]);
  // The bootstrap brings the dataset along; a cached snapshot is shown until it arrives.
  useEffect(() => {
    if (boot.refreshError) { toast({ text: tr('Aktualisieren fehlgeschlagen – du siehst den letzten Stand. Änderungen sind gesperrt, bis die Daten neu geladen sind.', 'Refresh failed – you are seeing the last snapshot. Changes are blocked until the data reloads.'), error: true }); return; }
    setStale(!!boot.stale);
    if (boot.stale) return;
    if (boot.dataset) { reqId.current++; setDs(boot.dataset); setError(null); setLoading(false); setLoadedAt(new Date()); visitData.current = true; }
    else load().then(() => { visitData.current = true; });
    setLangState(getLang());
  }, [boot]); // eslint-disable-line
  // Keep this tab's snapshot current (debounced; never while showing a stale one).
  useEffect(() => {
    if (stale || !ds || !boot.snapshotKey) return undefined;
    // a dataset this big is far over the 4 MB snapshot limit (≥ 300 bytes per work item): writeSnapshot would build a
    // 30 MB string on the main thread (≈ 1 s) only to drop it – drop it directly
    if ((ds.issues?.length || 0) * 300 > 4e6) { try { sessionStorage.removeItem(boot.snapshotKey); } catch { /* blocked */ } return undefined; }
    const t = setTimeout(() => {
      const { dataset, stale: _s, cachedAt, refreshError, ...rawBoot } = boot; // eslint-disable-line no-unused-vars
      writeSnapshot(boot.snapshotKey, { ...rawBoot, prefs: { ...rawBoot.prefs, ...(langChosen.current ? { lang: langChosen.current } : {}) } }, ds);
    }, 800);
    return () => clearTimeout(t);
  }, [ds, stale, boot, lang]);

  const langChosen = useRef(null);
  const setLang = useCallback((l) => {
    chooseLang(l);
    langChosen.current = l;
    setLangState(getLang());
    call('prefs.save', { lang: l }).catch(() => {});
  }, []);
  // A bootstrap that was already in flight must not undo a choice made meanwhile.
  useEffect(() => { if (langChosen.current && langChosen.current !== getLang()) { chooseLang(langChosen.current); setLangState(getLang()); } }, [boot]);

  // ---------- the computed numbers ----------
  // Small datasets: computeAll in place (as always). From WORKER_MIN_ITEMS work items on: in a Web Worker
  // (lib/computeWorker.js) – the views keep showing the last numbers with a quiet "rechnet …" until the new ones are
  // ready, and input is never blocked. `shown` = the dataset the shown numbers belong to.
  const useWorker = !!ds && (ds.issues?.length || 0) >= WORKER_MIN_ITEMS && workerSupported() && !boot.noComputeWorker;
  const syncComputed = useMemo(() => (ds && !useWorker ? computeAll(ds) : null), [ds, useWorker]);
  const [shown, setShown] = useState(null); // { ds, computed }
  const [computing, setComputing] = useState(false);
  const client = useRef(null);
  useEffect(() => () => client.current?.terminate(), []);
  useEffect(() => {
    if (!useWorker) { setComputing(false); return undefined; }
    let live = true;
    setComputing(true);
    const fallback = () => { const c = computeAll(ds); if (live) { setShown({ ds, computed: c }); setComputing(false); } };
    try {
      // phases with their time on window.__pcCompute (read by the perf check in the preview)
      client.current ||= createComputeClient({ onState: (st) => { if (typeof window !== 'undefined') { window.__pcComputeLog = [...(window.__pcComputeLog || []).slice(-40), { ...st, t: Math.round(performance.now()) }]; if (st.phase === 'done') window.__pcCompute = { ...st, at: Date.now() }; } } });
      // the new numbers render as a transition: React renders the views in slices and yields to input in between (the
      // old numbers stay on screen until the new render is ready)
      client.current.compute(ds, getLang()).then((c) => { if (live && c) startTransition(() => { setShown({ ds, computed: c }); setComputing(false); }); },
        (e) => { console.error('[compute worker]', e); client.current?.terminate(); client.current = null; fallback(); });
    } catch (e) { console.error('[compute worker]', e); fallback(); }
    return () => { live = false; };
  }, [ds, useWorker]); // eslint-disable-line react-hooks/exhaustive-deps
  // The live dataset goes with the last numbers only while they still describe the same projects and work items
  // (a new rank, a health update, a filled value); otherwise the views keep the dataset those numbers came from.
  const sameShape = (a, b) => !!a && !!b && a.issues?.length === b.issues?.length && (a.supportTickets?.tickets?.length || 0) === (b.supportTickets?.tickets?.length || 0)
    && a.portfolio?.length === b.portfolio?.length && a.portfolio.every((x) => b.portfolio.some((y) => y.ref === x.ref));
  const computed = useWorker ? shown?.computed || null : syncComputed;
  const dsView = !useWorker ? ds : shown && (shown.ds === ds || sameShape(ds, shown.ds)) ? ds : shown?.ds || null;
  const computedRef = useRef(null);
  computedRef.current = computed ? { ds: useWorker ? shown?.ds : ds, computed } : null;
  if (import.meta.env?.DEV && typeof window !== 'undefined') window.__pcApp = { ds: dsView, computed, computing: useWorker && computing }; // dev only: perf checks in the preview

  // "Since your last visit": the base comes with the bootstrap; this visit's summary is stored once
  // fresh data is in. Only the global cockpit counts as a visit.
  const digestSaved = useRef(false);
  const visitData = useRef(false);
  useEffect(() => {
    if (stale || !computed || digestSaved.current || boot.moduleKey !== 'pc-cockpit' || !visitData.current) return;
    digestSaved.current = true;
    call('digest.save', { items: digestSummary(computedRef.current.ds, computed) }).catch(() => {});
  }, [stale, computed]); // eslint-disable-line
  const [digestAcked, setDigestAcked] = useState(false);
  const ackDigest = useCallback(() => {
    setDigestAcked(true);
    // the numbers on screen when they belong to this dataset (no second computeAll on the main thread for big data)
    const cur = computedRef.current;
    if (dsRef.current) call('digest.save', { items: digestSummary(dsRef.current, cur && cur.ds === dsRef.current ? cur.computed : computeAll(dsRef.current, { skipWeeks: true })), ack: true }).catch(() => {});
  }, []);

  const setView = useCallback((v, opts = {}) => {
    setViewState(v);
    track(`view:${v}`);
    if (opts.ref) setSelectedRef(opts.ref);
    if (opts.team) setTeamSel(opts.team);
    if (opts.focus) setFocus({ issueId: opts.focus, at: Date.now() });
    if (opts.capView) setCapView(opts.capView);
    if (opts.capCell !== undefined) setCapCell(opts.capCell);
    if (opts.ask) setAskQ({ q: opts.ask, at: Date.now() });
    if (opts.health?.ref) setHealthReq({ ref: opts.health.ref, status: opts.health.status || null, comment: String(opts.health.comment || '').slice(0, 280), at: Date.now() });
    call('prefs.save', { view: v, ...(opts.ref ? { selectedRef: opts.ref } : {}) }).catch(() => {});
  }, []);
  const selectProject = useCallback((ref) => {
    setSelectedRef(ref);
    call('prefs.save', { selectedRef: ref }).catch(() => {});
  }, []);

  // ---------- undo ----------
  // Every write registers its exact inverse. Undo via the toast, Ctrl/⌘+Z or the history in the header.
  // keys name what an action touched (e.g. "fill:123:team", "order"): an older entry can be undone out of
  // order only when no newer entry touched the same thing – otherwise undo would overwrite the newer change.
  const undoStack = useRef([]);
  const [undoList, setUndoList] = useState([]);
  const sync = () => setUndoList([...undoStack.current].reverse());
  const pushUndo = useCallback((label, run, keys = []) => {
    const entry = { id: Math.random().toString(36).slice(2), label, run, keys, at: Date.now() };
    track('write');
    undoStack.current = [...undoStack.current.slice(-(UNDO_MAX - 1)), entry];
    sync();
    return entry;
  }, []);
  const blockedBy = useCallback((e) => {
    const i = undoStack.current.indexOf(e);
    if (i < 0 || !e.keys?.length) return null;
    return undoStack.current.slice(i + 1).find((n) => n.keys?.some((k) => e.keys.includes(k))) || null;
  }, []);
  const runUndo = useCallback(async (entry, { quiet } = {}) => {
    const e = entry || undoStack.current.at(-1);
    if (!e || !undoStack.current.includes(e)) return false;
    const newer = blockedBy(e);
    if (newer) { toast({ text: tr(`Zuerst „${newer.label}“ rückgängig machen – es hat dasselbe geändert.`, `Undo "${newer.label}" first – it changed the same thing.`), error: true }); return false; }
    undoStack.current = undoStack.current.filter((x) => x !== e);
    sync();
    try { await e.run(); track('undo'); if (!quiet) toast({ text: `${tr('Rückgängig', 'Undone')}: ${e.label}`, icon: 'history' }); return true; }
    catch (err) { toast({ text: errText(err), error: true }); return false; }
  }, [toast, blockedBy]);
  // Undo everything back to (and including) the given entry, newest first – never out of order.
  const undoUntil = useCallback(async (entry) => {
    const i = undoStack.current.indexOf(entry);
    if (i < 0) return;
    const todo = undoStack.current.slice(i).reverse();
    let n = 0;
    for (const e of todo) { if (!(await runUndo(e, { quiet: true }))) break; n++; }
    if (n) toast({ text: tr(`${n} ${n === 1 ? 'Aktion' : 'Aktionen'} rückgängig gemacht`, `${n} ${n === 1 ? 'action' : 'actions'} undone`), icon: 'history' });
  }, [runUndo, toast]);
  const done = useCallback((text, icon, label, run, keys) => {
    const entry = pushUndo(label, run, keys);
    toast({ text, icon, undo: () => runUndo(entry) });
    return entry;
  }, [pushUndo, runUndo, toast]);
  useEffect(() => {
    const h = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      if (/input|textarea|select/i.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
      e.preventDefault(); runUndo();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [runUndo]);

  // ---------- portfolio actions (optimistic) ----------
  const dsRef = useRef(ds);
  dsRef.current = ds;
  const currentOrder = () => [...dsRef.current.portfolio].sort((a, b) => a.rank - b.rank).map((p) => p.ref);
  const applyOrder = (order) => setDs((d) => ({ ...d, portfolio: d.portfolio.map((p) => ({ ...p, rank: order.includes(p.ref) ? order.indexOf(p.ref) + 1 : p.rank })) }));
  const reorder = useCallback(async (order, { silent } = {}) => {
    const prev = currentOrder();
    applyOrder(order);
    try {
      await call('portfolio.reorder', { order });
      if (!silent) done(tr('Rangfolge gespeichert', 'Ranking saved'), 'ranking', tr('Rangänderung', 'rank change'), () => reorder(prev, { silent: true }), ['order']);
    } catch (e) {
      applyOrder(prev);
      toast({ text: errText(e), error: true });
      if (silent) throw e;
    }
  }, [done, toast]); // eslint-disable-line
  const addProject = useCallback(async (ref, { silent, restoreOrder } = {}) => {
    try {
      await call('portfolio.add', { ref });
      await load(true);
      if (restoreOrder) await call('portfolio.reorder', { order: restoreOrder }).then(() => load(true));
      if (!silent) done(tr('Projekt aufgenommen – auf dem letzten Rang', 'Project added on the last rank'), 'plus', tr('Projekt aufgenommen', 'project added'), () => removeProject(ref, { silent: true }), ['order', `item:${ref}`]);
    } catch (e) { toast({ text: errText(e), error: true }); if (silent) throw e; }
  }, [load, done, toast]); // eslint-disable-line
  const removeProject = useCallback(async (ref, { silent } = {}) => {
    const before = dsRef.current;
    const prevOrder = currentOrder();
    setDs((d) => ({ ...d, portfolio: d.portfolio.filter((p) => p.ref !== ref).sort((a, b) => a.rank - b.rank).map((p, i) => ({ ...p, rank: i + 1 })) }));
    try {
      await call('portfolio.remove', { ref });
      // Undo puts the project back on exactly the rank it had.
      if (!silent) done(tr('Aus dem Portfolio entfernt (kein Jira-Vorgang gelöscht)', 'Removed from portfolio (no Jira work item deleted)'), 'trash', tr('Projekt entfernt', 'project removed'), () => addProject(ref, { silent: true, restoreOrder: prevOrder }), ['order', `item:${ref}`]);
    } catch (e) { setDs(before); toast({ text: errText(e), error: true }); if (silent) throw e; }
  }, [done, toast, addProject]); // eslint-disable-line
  const putHealth = (ref, h) => setDs((d) => ({ ...d, portfolio: d.portfolio.map((p) => (p.ref === ref ? { ...p, health: h } : p)) }));
  const setHealth = useCallback(async (ref, status, comment) => {
    const h = await call('health.set', { ref, status, comment });
    putHealth(ref, h);
    done(tr('Health aktualisiert', 'Health updated'), 'heart', tr('Health-Update', 'health update'), async () => {
      // exact: the earlier record comes back as it was (date and author included), not as a new update
      putHealth(ref, (await call('health.set', { ref, restore: true })) || null);
    }, [`health:${ref}`]);
  }, [done]);
  // Data-quality fills: saved in Jira, then patched locally so every view updates at once.
  const patchTarget = (issueId, ref, fn) => setDs((d) => {
    if (ref) return { ...d, portfolio: d.portfolio.map((p) => (p.ref === ref ? fn(p, true) : p)) };
    return { ...d, issues: d.issues.map((i) => (i.id === issueId ? fn(i, false) : i)), portfolio: d.portfolio.map((p) => (p.kind === 'issue' && p.id === issueId ? fn(p, true) : p)) };
  });
  // value null clears the field (planning grid); undo always restores the exact earlier value.
  const fill = useCallback(async ({ issueId, ref, usage, value, onUndone, collectUndo, label }) => {
    const cleared = value == null || (Array.isArray(value) && !value.length);
    const { previous = null } = (await call('issue.fill', cleared ? { issueId, ref, usage, clear: true } : { issueId, ref, usage, value })) || {};
    const snapshot = new Map();
    patchTarget(issueId, ref, (x, isItem) => {
      snapshot.set(isItem ? `item:${x.ref}` : x.id, x);
      const team = usage === 'team' && !cleared ? (dsRef.current.teams.find((t) => t.id === value) || { id: value, name: value }) : null;
      if (usage === 'team') return isItem ? { ...x, leadTeam: team, ...(x.team !== undefined ? { team } : {}) } : { ...x, team };
      if (usage === 'originalEstimate') return cleared ? { ...x, oe: 0 } : { ...x, oe: value, re: x.re || value };
      if (usage === 'tshirt') return { ...x, tshirt: cleared ? null : value };
      if (usage === 'targetQuarters') return { ...x, quarters: cleared ? [] : [...value].sort() };
      if (usage === 'startDate') return { ...x, start: cleared ? null : value };
      if (usage === 'dueDate') return { ...x, due: cleared ? null : value };
      return x;
    });
    // only the fields this fill changed come back – several fills on one work item (and their parallel undos)
    // must not overwrite each other with a whole-object snapshot
    const fields = { team: ['team', 'leadTeam'], originalEstimate: ['oe', 're'], tshirt: ['tshirt'], targetQuarters: ['quarters'], startDate: ['start'], dueDate: ['due'] }[usage] || [];
    const undo = async () => {
      await call('issue.fill', { issueId, ref, usage, restore: previous }); // the exact earlier value, or empty if it was empty
      patchTarget(issueId, ref, (x, isItem) => {
        const s = snapshot.get(isItem ? `item:${x.ref}` : x.id);
        if (!s) return x;
        const y = { ...x };
        for (const k of fields) { if (k in s) y[k] = s[k]; else delete y[k]; }
        return y;
      });
      onUndone?.();
    };
    undo.key = `fill:${issueId || ref}:${usage}`;
    return collectUndo ? undo : pushUndo(label || tr('Lücke ergänzt', 'gap filled'), undo, [undo.key]);
  }, [pushUndo]);
  // A work item without a parent gets one (boss 2026-11-19): written in Jira as the user, patched here at once. One
  // from a shared space (project unclear) moves into the chosen project; undo removes the parent again in Jira.
  const setParent = useCallback(async ({ issueId, parentId, ref, label }) => {
    await call('issue.parent', { issueId, parentId });
    const before = dsRef.current;
    const wasIssue = before.issues.some((i) => i.id === issueId);
    const orphan = wasIssue ? null : (before.orphans || []).find((o) => o.id === issueId) || null;
    setDs((d) => (wasIssue
      ? { ...d, issues: d.issues.map((i) => (i.id === issueId ? { ...i, parentId, orphan: false } : i)) }
      : orphan ? {
        ...d, orphans: (d.orphans || []).filter((o) => o.id !== issueId),
        issues: [...d.issues, (({ candidates, projectId, ...o }) => ({ links: [], worklogs: [], fixVersionIds: [], quarters: [], note: null, ...o, rootRef: ref, parentId, orphan: false }))(orphan)],
      } : d));
    const undo = async () => {
      await call('issue.parent', { issueId, clear: true, expect: parentId });
      setDs((d) => (wasIssue
        ? { ...d, issues: d.issues.map((i) => (i.id === issueId ? { ...i, parentId: null, orphan: true } : i)) }
        : orphan ? { ...d, issues: d.issues.filter((i) => i.id !== issueId), orphans: [...(d.orphans || []), orphan] } : d));
    };
    return pushUndo(label || tr('Parent gesetzt', 'parent set'), undo, [`parent:${issueId}`]);
  }, [pushUndo]);

  // The person's own AI switch: what the server sent (config.ai.user), or what they just chose in this session.
  const [aiMineSet, setAiMineSet] = useState(null);
  const baseConfig = ds?.config || boot.config;
  const config = useMemo(() => (aiMineSet == null || !baseConfig?.ai ? baseConfig : { ...baseConfig, ai: { ...baseConfig.ai, user: aiMineSet } }), [baseConfig, aiMineSet]);
  const aiMine = config?.ai?.user === true;
  const setAiMine = useCallback(async (on) => { await call('prefs.save', { ai: !!on }); setAiMineSet(!!on); }, []);
  const value = {
    boot, roles: boot.roles, config, aiMine, setAiMine, ds: dsView, computed, computing: useWorker && computing, loading, stale, error, loadedAt, reload: load, lang, setLang,
    digest: stale || digestAcked ? null : boot.digest || null, ackDigest,
    view, setView, selectedRef, selectProject, teamSel, setTeamSel, focus, setFocus, capView, setCapView, capCell, setCapCell,
    reorder, addProject, removeProject, setHealth, fill, setParent, toast, setDs, pushUndo, runUndo, undoUntil, blockedBy, done, undoList, undoTop: undoList[0] || null,
    assistant, openAssistant: setAssistant, askQ, healthReq, clearHealthReq: () => setHealthReq(null),
  };
  // Switching language re-renders every view in place (lang is part of the context value): data, view,
  // unsaved admin edits, the assistant chat and undo history all stay.
  return <Ctx.Provider value={value}>{import.meta.env?.DEV ? <Profiler id="app" onRender={devRender}>{children}</Profiler> : children}{useWorker && computing && computed ? <ComputingNote /> : null}</Ctx.Provider>;
}


// A quiet note while new numbers are computed in the background (big datasets): the views show the last numbers.
function ComputingNote() {
  return (
    <div role="status" aria-live="polite" data-computing="" style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 60, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
      borderRadius: 999, background: 'var(--surface, #fff)', color: 'var(--muted, #5b6576)', boxShadow: '0 2px 10px rgba(16,24,40,.12)', fontSize: 12, pointerEvents: 'none' }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--accent, #3b6ef5)', animation: 'pc-compute-pulse 1.2s ease-in-out infinite' }} />
      {tr('rechnet …', 'computing …')}
      <style>{'@keyframes pc-compute-pulse{0%,100%{opacity:.35;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}@media (prefers-reduced-motion: reduce){[data-computing] span{animation:none!important}}'}</style>
    </div>
  );
}
