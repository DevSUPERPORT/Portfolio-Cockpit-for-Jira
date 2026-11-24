import { Component, startTransition, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { motion, MotionConfig } from 'framer-motion';
import { aiOn, aiPerPerson, vendorOff, VENDOR_OFF } from './lib/aiFlags.js';
import { isEmployee } from '@shared/mine.js';
import { useApp, AppProvider } from './state.jsx';
import { Icon, Logo } from './lib/icons.jsx';
import { tr, fmt, chooseLang, getLang } from './lib/i18n.js';
import { mark } from './lib/diag.js';
import { call, navigate, openUrl, holdWrites, releaseWrites, readSnapshot, dropSnapshot, snapshotKey } from './lib/api.js';
import UndoHistory from './components/UndoHistory.jsx';
import TabScroller from './components/TabScroller.jsx';
import Inbox from './components/Inbox.jsx';
import { Skeleton, Empty, Avatar, TipProvider, ToastProvider, useTip, infoCard, Menu, Segmented } from './components/ui.jsx';
import { motionStore, initMotionPref, setMotionPref, isReduced, enter, fadeIn, popIn, hoverLift, layoutT, sp, LOOP } from './lib/motion.js';
import Portfolio from './views/Portfolio.jsx';
import Project from './views/Project.jsx';
import Tour, { tourSteps } from './components/Tour.jsx';
import { lotseStore, openLotse } from './components/lotse/open.js';
import { LotseMark } from './components/lotse/LotseChip.jsx';
import RunPill from './components/lotse/RunPill.jsx';
import { lazyView } from './lib/chunkReload.js';
import { runStore } from './components/lotse/runStore.js';

const Team = lazyView(() => import('./views/Team.jsx'));
const Proof = lazyView(() => import('./views/Proof.jsx'));
const TimeEstimate = lazyView(() => import('./views/TimeEstimate.jsx'));
const PlanActual = lazyView(() => import('./views/PlanActual.jsx'));
const WeekPlan = lazyView(() => import('./views/WeekPlan.jsx'));
const Capacity = lazyView(() => import('./views/Capacity.jsx'));
const Support = lazyView(() => import('./views/Support.jsx'));
const Ask = lazyView(() => import('./views/Ask.jsx'));
const Report = lazyView(() => import('./views/Report.jsx'));
const Admin = lazyView(() => import('./views/Admin.jsx'));
const Mine = lazyView(() => import('./views/Mine.jsx'));
const Assistant = lazyView(() => import('./views/Assistant.jsx'));
const LotsePanel = lazyView(() => import('./components/lotse/Lotse.jsx'));
const SelfTest = import.meta.env.VITE_SELFTEST === '1' ? lazyView(() => import('./selftest.jsx')) : null;

// ---------- boot ----------
function makeBoot(ctx, b, extra) {
  if (b.prefs?.lang) chooseLang(b.prefs.lang);
  initMotionPref(b.prefs?.motion); // the person's motion choice (voll / reduziert); the browser's copy is the fallback
  const isAdminPage = ctx.moduleKey === 'pc-admin';
  const projectCtx = ctx.extension?.project ? { id: String(ctx.extension.project.id), key: ctx.extension.project.key } : b.projectContext;
  const initialView = isAdminPage ? 'admin' : ctx.moduleKey === 'pc-project' ? 'project' : b.prefs?.view && b.prefs.view !== 'admin' ? b.prefs.view : 'portfolio';
  return { ...b, moduleKey: ctx.moduleKey, isAdminPage, projectCtx: ctx.moduleKey === 'pc-project' ? projectCtx : null, initialView, localId: ctx.localId, snapshotKey: snapshotKey(ctx), ...extra };
}

export default function Root({ ctx, bootstrap }) {
  // Instant open: the last snapshot from this tab renders on the very first frame (no splash);
  // fresh data from the bootstrap replaces it a moment later.
  const [cached] = useState(() => readSnapshot(snapshotKey(ctx), ctx.accountId));
  const [boot, setBoot] = useState(() => (cached ? makeBoot(ctx, cached.boot, { dataset: cached.ds, stale: true, cachedAt: cached.at }) : null));
  const [err, setErr] = useState(null);
  const mo = useSyncExternalStore(motionStore.subscribe, motionStore.get, motionStore.get);
  mark(`root render cached=${!!cached} boot=${!!boot} stale=${boot?.stale}`);
  useEffect(() => {
    const make = (b, extra) => makeBoot(ctx, b, extra);
    if (cached) holdWrites();
    (bootstrap || call('bootstrap', { withDataset: true }))
      .then((b) => { releaseWrites(); mark('root: fresh boot'); setBoot(make(b, { stale: false })); })
      .catch((e) => {
        // A failed refresh keeps the snapshot marked as not current and writes blocked; a licence or
        // access problem always wins over cached data.
        // Paused by SUPERPORT: the cached snapshot must not stay on screen either.
        if (!cached || ['LICENSE_INACTIVE', 'ANONYMOUS', 'FORBIDDEN', 'UNAVAILABLE'].includes(e.code)) { dropSnapshot(snapshotKey(ctx)); setErr(e); return; }
        setBoot((x) => ({ ...x, refreshError: e }));
      });
  }, [ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const down = () => { dropSnapshot(snapshotKey(ctx)); setErr({ code: 'UNAVAILABLE' }); };
    window.addEventListener('pc-unavailable', down);
    return () => window.removeEventListener('pc-unavailable', down);
  }, [ctx]);
  if (err?.code === 'UNAVAILABLE') return <>{<Unavailable />}{SelfTest && <Suspense fallback={null}><SelfTest /></Suspense>}</>; // harness: test builds only
  if (err?.code === 'LICENSE_INACTIVE') {
    return <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}><Empty icon="lock" title={tr('Lizenz nicht aktiv', 'Licence not active')}>{tr('Bitte deinen Jira-Admin, die Lizenz für Portfolio Cockpit zu erneuern.', 'Ask your Jira admin to renew the Portfolio Cockpit licence.')}</Empty></div>;
  }
  // One motion setting for everything framer draws: reduced (the person's choice or the system's) = no transform / layout
  // animation anywhere; the lib/motion.js helpers degrade to opacity-only and instant on their own.
  return (
    <MotionConfig reducedMotion={mo.reduced ? 'always' : 'never'}>
      <ToastProvider>
        <TipProvider>
          {/* the app replaces the splash at once – nothing waits for an exit animation (they stall in the Jira frame) */}
          {!boot ? <Splash key="splash" error={err} /> : (
            <motion.div key="app" style={{ height: '100%' }} {...(cached ? {} : fadeIn('gentle'))}>
              <AppProvider boot={boot}><Shell /></AppProvider>
            </motion.div>
          )}
          {SelfTest && boot && <Suspense fallback={null}><SelfTest /></Suspense>}
        </TipProvider>
      </ToastProvider>
    </MotionConfig>
  );
}

function Splash({ error }) {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <motion.div {...enter(0, { y: 0, scale: 0.6, spring: 'pop' })}
          style={{ width: 72, height: 72, borderRadius: 16, display: 'grid', placeItems: 'center', boxShadow: '0 20px 50px -16px rgba(208,68,3,.55)' }}>
          <Logo size={72} />
        </motion.div>
        <motion.div {...enter(0, { y: 6, delay: 0.12 })} style={{ textAlign: 'center' }}>
          <div className="eyebrow">SUPERPORT</div>
          <div style={{ fontSize: 20, fontWeight: 560, letterSpacing: '-0.02em' }}>Portfolio Cockpit</div>
        </motion.div>
        {error ? (
          <div className="callout bad" style={{ maxWidth: 420 }}><Icon name="alert" />{error.message}</div>
        ) : (
          <div style={{ width: 160, height: 3, borderRadius: 3, background: 'var(--sunken)', overflow: 'hidden' }}>
            <motion.div style={{ height: '100%', width: '40%', borderRadius: 3, background: 'var(--accent)' }} animate={isReduced() ? { opacity: [0.4, 1] } : { x: ['-100%', '260%'] }} transition={{ duration: LOOP.spin, repeat: Infinity, repeatType: isReduced() ? 'reverse' : 'loop', ease: 'easeInOut' }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- shell ----------
// "Mitarbeiter" (UC-20): users in no configured group, no Jira admin, owner of no project – they see only their own work.
export function useEmployee() {
  const { roles, ds, boot } = useApp();
  return isEmployee(roles, ds, boot.me?.id);
}
// The tabs of the plan (UC-08): which ones a user sees comes from the role matrix. "Fragen" and "Nachweis"
// are not tabs any more – Ask sits in the header and in Ctrl K, Nachweis in Ctrl K and the portfolio footer.
export const TAB_RIGHT = { mine: 'mine', portfolio: 'portfolio', project: 'projects', team: 'teams', plan: 'plan', time: 'hours', support: 'support', report: 'report' };
export function useRight() {
  const { roles, ds, boot, config } = useApp();
  return useMemo(() => {
    const list = Array.isArray(roles?.rights) ? new Set(roles.rights) : null;
    // project owners without a group keep the project-admin tabs (as before the role matrix)
    const owner = (ds?.portfolio || []).some((p) => p.owner?.id && p.owner.id === boot.me?.id);
    if (list && owner && !roles.admin && !(roles.roleNames || []).some((r) => r !== 'jiraAdmin')) for (const r of config?.roles?.rights?.projectAdmin || []) if (!r.startsWith('a_')) list.add(r);
    return (id) => !list || list.has(id);
  }, [roles, ds, boot.me, config]);
}
function useTabs() {
  const { roles, computed, config } = useApp();
  const employee = useEmployee();
  const can = useRight();
  const mine = { id: 'mine', icon: 'user', label: tr('Meine Arbeit', 'My work'), desc: tr('Deine Aufgaben der Woche – Stunden direkt buchen, fehlende Werte mit einem Klick ergänzen.', 'Your tasks of the week – book hours right here, fill missing values in one click.') };
  if (employee) return [mine];
  const urgent = computed?.dq.gaps.filter((g) => g.urgent).length || 0;
  const conflicts = computed?.deps.conflicts || 0;
  const supportUrgent = computed?.supportSum?.urgent || 0;
  const supportOn = (config?.support?.serviceProjectIds || []).length || (config?.support?.queues || []).length;
  const all = [
    mine,
    { id: 'portfolio', icon: 'ranking', label: 'Portfolio', desc: tr('Alle Projekte in Rangfolge – Fortschritt, Health, wer auf wen wartet und ob die Kapazität reicht (Wasserlinie).', 'All projects in rank order – progress, health, who waits for whom and whether capacity suffices (waterline).') },
    { id: 'project', icon: 'project', label: tr('Projekte', 'Projects'), badge: urgent + conflicts, hot: urgent + conflicts > 0, desc: tr('Ein Projekt im Detail: Handlungsbedarf, fehlende Werte, Struktur und Kapazität. Die Zahl = dringende Lücken und Terminkonflikte.', 'One project in detail: action needed, missing values, structure and capacity. The number = urgent gaps and date conflicts.') },
    { id: 'team', icon: 'users', label: 'Teams', desc: tr('Ein Team aus Atlassian Teams: woran es arbeitet, wie ausgelastet es ist, wer außerhalb des Teams oder in mehreren Teams arbeitet – und Kapazitäten pflegen.', 'A team from Atlassian Teams: what it works on, how loaded it is, who works outside the team or in several teams – and maintain capacities.') },
    { id: 'plan', icon: 'calendar', label: tr('Wochenplanung', 'Weekly planning'), desc: tr('Für das Weekly: wer arbeitet wann woran – Vorschläge für rote Wochen annehmen, Aufgaben verschieben und in Jira übernehmen.', 'For the weekly: who works on what and when – accept suggestions for red weeks, move tasks and apply them in Jira.') },
    { id: 'time', icon: 'clock', label: tr('Plan vs. Ist', 'Plan vs. actual'), desc: tr('Wohin sind die Stunden geflossen – im Vergleich zum Plan der Woche. Darunter: ob alle genug gebucht haben.', "Where did the hours go – compared with the week's plan. Below: whether everyone booked enough.") },
    ...(supportOn ? [{ id: 'support', icon: 'headset', label: 'Support', badge: supportUrgent, hot: supportUrgent > 0, desc: tr('Tickets verteilen, SLAs, und ob die Support-Reserve reicht – Support hat Vorrang vor allen Projekten.', 'Dispatch tickets, SLAs and whether the support reserve is enough – support comes before every project.') }] : []),
    { id: 'report', icon: 'report', label: tr('C-Level-Report', 'C-level report'), desc: tr('Die Lage auf einer Seite – als PDF oder nach Confluence.', 'The situation on one page – as PDF or to Confluence.') },
  ].filter((t) => can(TAB_RIGHT[t.id]) && (t.id !== 'report' || roles.viewReport));
  // Configuration as the last tab for Jira admins (the same page as in the Jira settings)
  if (roles.admin) all.push({ id: 'config', icon: 'settings', label: tr('Konfiguration', 'Configuration'), desc: tr('Nur für Jira-Admins: in 6 Schritten eingerichtet – Projekte, Felder, Teams, Rollen, Standorte, Support. Jede Änderung wird protokolliert.', 'Jira admins only: set up in 6 steps – projects, fields, teams, roles, locations, support. Every change is logged.') });
  return all;
}

function Shell() {
  const app = useApp();
  const { boot, view, setView, loading, stale, ds, loadedAt, reload, roles } = app;
  const tip = useTip();
  const tabs = useTabs();
  const employee = useEmployee();
  useEffect(() => { if (employee && view !== 'mine') setView('mine'); }, [employee, view]); // eslint-disable-line react-hooks/exhaustive-deps
  // First-run tour: starts once per user on the global cockpit when fresh data is on screen; "?" restarts it.
  const [tour, setTour] = useState(false);
  const tourSeen = useRef(!!boot.prefs?.tourDone);
  // Coming from another area, wait until the portfolio view is on screen so every step finds its target.
  const startTour = () => {
    setPalette(false);
    if (view === 'portfolio') { setTour(true); return; }
    setView('portfolio');
    const t0 = Date.now();
    const wait = () => (document.querySelector('[data-tour="ranking"]') || Date.now() - t0 > 4000 ? setTimeout(() => setTour(true), 250) : setTimeout(wait, 120));
    setTimeout(wait, 300);
  };
  const endTour = () => { setTour(false); if (!tourSeen.current) { tourSeen.current = true; call('prefs.save', { tourDone: true }).catch(() => {}); } };
  useEffect(() => {
    if (employee || tourSeen.current || stale || !ds || boot.moduleKey !== 'pc-cockpit' || boot.isAdminPage || !boot.setupComplete || import.meta.env.VITE_SELFTEST_RUN) return undefined;
    const t = setTimeout(startTour, 1200); // let the page settle first
    return () => clearTimeout(t);
  }, [stale, ds]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps = useMemo(() => tourSteps({ roles, firstName: (boot.me?.name || '').split(' ')[0], aiDraft: aiOn(app.config, 'healthDraft'), tabs }), [roles, boot.me, app.lang, app.config, tabs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // The search (Ctrl K) owns its open state: opening it re-renders the search only – not the shell, the tabs or the view.
  const setPalette = (v) => window.dispatchEvent(new CustomEvent('pc-palette', { detail: v }));
  const [meMenu, setMeMenu] = useState(null);
  // Tab switch: the indicator moves at once (urgent); the new area renders in a transition, so the browser keeps
  // painting frames while a heavy view is built (smooth pill, no frozen click).
  const [navTo, setNavTo] = useState(null);
  const go = (id) => { if (id === view) return; setNavTo(id); startTransition(() => setView(id)); };
  useEffect(() => { setNavTo(null); }, [view]);
  const shownTab = navTo || view;
  // The area itself is one memoized element: opening the search, a menu or the tour re-renders the shell only, never
  // the whole view (the view still follows the app data through its own context).
  const page = useMemo(() => (
    <motion.div key={view} {...enter(0, { y: 8, d: 'base' })}>
      <Boundary key={view}><ViewHost view={view} /></Boundary>
    </motion.div>
  ), [view]);
  // Warm up what the person will most likely open next – Lotse's panel and the search brain – while the browser is idle,
  // so the first open animates without waiting for code to load.
  useEffect(() => {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
    const h = idle(() => { import('./components/lotse/Lotse.jsx').catch(() => {}); import('./components/lotse/brain.js').catch(() => {}); }, { timeout: 4000 });
    return () => (window.cancelIdleCallback ? window.cancelIdleCallback(h) : clearTimeout(h));
  }, []);
  const mainRef = useRef(null);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [view]);
  const adminUrl = useMemo(() => {
    const m = /extension\/([0-9a-f-]{36})\/([0-9a-f-]{36})\//.exec(boot.localId || '');
    return m ? `/jira/settings/apps/${m[1]}/${m[2]}` : null;
  }, [boot.localId]);

  if (boot.isAdminPage) {
    return (
      <div className="frame">
        <TopBar title={tr('Konfiguration', 'Configuration')} eyebrow="Portfolio Cockpit · Jira-Admin" right={<><LangSwitch /><UndoHistory /></>} />
        <PausedBanner />
        <main className="main" ref={mainRef}>
          {roles.admin ? <Suspense fallback={<PageSkeleton />}><Admin /></Suspense> : <NoAccess what={tr('Die Konfiguration ist nur für Jira-Admins sichtbar.', 'The configuration is visible to Jira admins only.')} />}
        </main>
      </div>
    );
  }
  if (!boot.setupComplete) {
    return (
      <div className="frame">
        <TopBar title="Portfolio Cockpit" right={<LangSwitch />} />
        <main className="main"><div className="page">
          <Empty icon="settings" title={tr('Fast geschafft – das Cockpit ist noch nicht eingerichtet', 'Almost there – the cockpit is not set up yet')}
            action={roles.admin && adminUrl ? <button className="btn btn-primary" onClick={() => navigate(adminUrl)}><Icon name="settings" />{tr('Jetzt einrichten', 'Set up now')}</button> : null}>
            {roles.admin ? tr('Lege in der Konfiguration fest, welche Vorgänge oder Spaces Projekte sind und wie eure Hierarchie aussieht. Das dauert zwei Minuten – vieles erkennen wir automatisch.', 'Define which work items or spaces are projects and how your hierarchy looks. It takes two minutes – most of it is detected automatically.')
              : tr('Bitte deinen Jira-Admin, das Portfolio Cockpit einzurichten.', 'Ask your Jira admin to set up Portfolio Cockpit.')}
          </Empty>
        </div></main>
      </div>
    );
  }
  return (
    <div className="frame">
      <TopBar
        title="Portfolio Cockpit"
        status={stale ? `${tr('Stand', 'as of')} ${fmt.time(loadedAt.toISOString())} · ${boot.refreshError ? tr('nicht aktuell', 'not current') : tr('aktualisiere …', 'refreshing …')}` : loading ? tr('Aktualisiere …', 'Refreshing …') : loadedAt ? `${ds?.portfolio.length ?? 0} ${tr('Projekte', 'projects')} · ${tr('Stand', 'as of')} ${fmt.time(loadedAt.toISOString())}` : null}
        busy={loading || stale}
        right={<>
          {/* two groups: on phones the tools move to their own scrollable row under the brand (styles.css .topbar-tools) */}
          <div className="topbar-main">
          <button className="searchbtn" data-tour="search" onClick={() => setPalette(true)}><Icon name="search" /><span className="sb-text">{tr('Suchen oder springen …', 'Search or jump …')}</span><span className="kbd">Ctrl K</span></button>
          {!employee && <motion.button className="btn btn-ghost btn-sm" {...hoverLift(-1)} onClick={() => setView('ask')} style={{ gap: 6, color: 'var(--accent-strong)', fontWeight: 600 }} aria-label={tr('Fragen-Leinwand öffnen', 'Open the Ask canvas')} data-tour="ask">
            <motion.span style={{ display: 'grid' }} animate={isReduced() ? undefined : { rotate: [0, 15, 0] }} transition={{ duration: LOOP.idle, repeat: Infinity, repeatDelay: 3 }}><Icon name="sparkle" /></motion.span><span className="sb-text">{tr('Fragen', 'Ask')}</span>
          </motion.button>}
          {/* Lotse: the cockpit's own navigator – every answer a picture with real numbers (works for everyone, no AI needed) */}
          <motion.button className="btn btn-ghost btn-sm lotse-head-btn" data-lotse-open {...hoverLift(-1)} onClick={() => openLotse()} aria-label={tr('Lotse öffnen', 'Open Lotse')}
            {...tip(infoCard({ title: 'Lotse', text: tr('Dein Navigator: frag in deinen Worten – jede Antwort ist ein Bild mit den echten Zahlen, den Belegen und dem nächsten Schritt. Ohne KI, sofort.', 'Your navigator: ask in your own words – every answer is a picture with the real numbers, the evidence and the next step. No AI, instant.') }))}>
            <LotseMark size={16} /><span className="sb-text">Lotse</span>
          </motion.button>
          {/* a Lotse job in progress: where it stands, one click back into it */}
          <RunPill />
          {ds && !employee && <Inbox />}
          </div>
          <div className="topbar-tools" role="group" aria-label={tr('Werkzeuge', 'Tools')}>
          <motion.button className="btn btn-ghost btn-icon" onClick={() => reload()} aria-label={tr('Aktualisieren', 'Refresh')} title={tr('Aktualisieren', 'Refresh')} animate={{ rotate: loading && !isReduced() ? 360 : 0 }} transition={loading ? { repeat: Infinity, duration: LOOP.spin, ease: 'linear' } : { duration: 0 }}>
            <Icon name="refresh" />
          </motion.button>
          {!employee && <button className="btn btn-ghost btn-icon" data-tour="help" onClick={startTour} aria-label={tr('Kurze Tour durch das Cockpit', 'Quick tour of the cockpit')} {...tip(<div><b>{tr('Tour', 'Tour')}</b> · {tr('Das Wichtigste in einer Minute', 'The essentials in one minute')}</div>)}><Icon name="help" /></button>}
          <AiMineSwitch />
          <LangSwitch />
          {!roles.admin && roles.manageSettings && <button className="btn btn-ghost btn-icon" onClick={() => setView('settings')} aria-label={tr('Portfolio-Einstellungen', 'Portfolio settings')} title={tr('Portfolio-Einstellungen', 'Portfolio settings')} aria-pressed={view === 'settings'}><Icon name="settings" /></button>}
          <UndoHistory />
          <Avatar user={boot.me} size={30} onClick={(e) => setMeMenu(meMenu ? null : e.currentTarget)} expanded={!!meMenu} label={tr('Persönliche Einstellungen', 'Personal settings')} />
          <Menu anchor={meMenu} onClose={() => setMeMenu(null)} role="dialog" label={tr('Persönliche Einstellungen', 'Personal settings')}><PersonalPrefs /></Menu>
          </div>
        </>}
        tabs={<TabScroller active={view} label={tr('Bereiche', 'Areas')} tour="tabs">
          {tabs.map((t, i) => (
            <motion.button key={t.id} role="tab" className="tab" data-tour={`tab-${t.id}`} aria-selected={shownTab === t.id} onClick={() => go(t.id)} {...(t.desc ? tip(infoCard({ title: t.label, text: t.desc })) : {})} {...enter(i, { y: -4, d: 'base' })}>
              <Icon name={t.icon} size={15} />{t.label}
              {t.badge > 0 && <span className={`tab-badge ${t.hot ? 'hot' : ''}`}>{t.badge > 99 ? '99+' : t.badge}</span>}
              {shownTab === t.id && <motion.span layoutId="tab-ink" className="tab-ink" transition={layoutT('chip')} />}
            </motion.button>
          ))}
        </TabScroller>}
      />
      <PausedBanner />
      <main className="main" ref={mainRef}>
        {/* the new area shows at once and fades in; nothing waits for the old one to animate out
            (inside the Jira frame an exit animation can stall and keep the previous page on screen) */}
        {page}
      </main>
      <Palette tabs={tabs} onTour={employee ? null : startTour} adminUrl={adminUrl} employee={employee} />
      <Tour open={tour} steps={steps} onClose={endTour} />
      <Suspense fallback={null}><Assistant /></Suspense>
      <LotseHost />
    </div>
  );
}

// Lotse's panel is loaded the first time someone opens it (header, Ctrl K, a view chip, the Today strip) and then
// stays mounted, so its thread survives closing and reopening.
function LotseHost() {
  const st = useSyncExternalStore(lotseStore.subscribe, lotseStore.get, lotseStore.get);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (st.open) setLoaded(true); }, [st.open]);
  return loaded ? <Suspense fallback={null}><LotsePanel /></Suspense> : null;
}

// ---------- SUPERPORT kill switch (App Status) ----------
const STATUS_URL = 'https://superapps.statuspage.io';
// Full page while SUPERPORT has taken the app down: nothing is read or written until it is back.
function Unavailable() {
  return (
    <div className="paused-page" role="alert">
      <motion.div className="paused-card" {...enter(0, { y: 12, d: 'gentle' })}>
        <div className="brand-mark" style={{ width: 52, height: 52, borderRadius: 11 }}><Logo size={52} /></div>
        <h1>{tr('Vorübergehend nicht verfügbar', 'Temporarily unavailable')}</h1>
        <p>{tr('Wir haben Portfolio Cockpit kurz pausiert, um eure Daten zu schützen. Nichts von dem, was ihr gespeichert habt, geht verloren, und euer Jira ist nicht betroffen.', 'We have paused Portfolio Cockpit for a moment to keep your data safe. Nothing you saved is lost, and your Jira is not affected.')}</p>
        <button className="btn btn-primary" onClick={() => openUrl(STATUS_URL)}><Icon name="external" />{tr('Status ansehen', 'View status')}</button>
        <div className="faint" style={{ fontSize: 12.5 }}>{tr('Sobald alles wieder läuft, einfach diese Seite neu laden.', 'Once everything is back, just reload this page.')}</div>
      </motion.div>
    </div>
  );
}
// Banner while changes are paused: everything stays visible, every change is refused by the server.
function PausedBanner() {
  const { boot } = useApp();
  if (boot.availability?.mode !== 'readonly') return null;
  return (
    <div className="paused-banner" role="status">
      <Icon name="lock" size={15} />
      <span><b>{tr('Änderungen sind pausiert.', 'Changes are paused.')}</b> {tr('Wir schützen gerade eure Daten – ansehen geht weiterhin, speichern ist kurz gesperrt.', 'We are keeping your data safe – you can view everything, saving is paused for a moment.')}</span>
      <button className="linkbtn" onClick={() => openUrl(STATUS_URL)}>{tr('Status', 'Status')} <Icon name="external" size={12} /></button>
    </div>
  );
}

// Bewegung: voll / reduziert – per person: in this browser at once (lib/motion.js) and in the person's preferences.
// Without a choice the system setting (prefers-reduced-motion) decides.
function saveMotion(v) { setMotionPref(v); call('prefs.save', { motion: v }).catch(() => {}); }
function PersonalPrefs() {
  const mo = useSyncExternalStore(motionStore.subscribe, motionStore.get, motionStore.get);
  const value = mo.reduced ? 'reduced' : 'full';
  return (
    <div className="me-prefs" data-me-prefs>
      <div className="me-prefs-h">{tr('Persönlich', 'Personal')}</div>
      <div className="me-prefs-row">
        <span className="me-prefs-label"><Icon name="zap" size={14} />{tr('Bewegung', 'Motion')}</span>
        <Segmented size="sm" label={tr('Bewegung', 'Motion')} value={value} onChange={(v) => v !== value && saveMotion(v)}
          options={[{ value: 'full', label: tr('voll', 'full') }, { value: 'reduced', label: tr('reduziert', 'reduced') }]} />
      </div>
      <p className="me-prefs-note">{value === 'reduced'
        ? tr('Reduziert: nichts gleitet oder zählt hoch – Inhalte erscheinen sofort.', 'Reduced: nothing slides or counts up – content appears at once.')
        : tr('Voll: ruhige, kurze Übergänge. Gilt nur für dich.', 'Full: calm, short transitions. Applies to you only.')}</p>
    </div>
  );
}

// DE | EN. Remembered per user; the Jira language is the default until someone picks one.
// The person's own AI switch – only while the site allows AI. Default off: whoever is happy with the cockpit's own
// rules never causes AI cost. Saved in the person's preferences, logged, undoable.
function AiMineSwitch() {
  const { config, aiMine, setAiMine, toast, pushUndo, runUndo } = useApp();
  const tip = useTip();
  const [busy, setBusy] = useState(false);
  if (!aiPerPerson(config)) return null; // only when the admin lets each person decide
  const paused = config.ai.budget?.stopped === true;
  const flip = async (to) => {
    setBusy(true);
    try {
      await setAiMine(to);
      const e = pushUndo(to ? tr('KI für mich eingeschaltet', 'AI switched on for me') : tr('KI für mich ausgeschaltet', 'AI switched off for me'), () => setAiMine(!to), ['ai:mine']);
      toast({ text: to ? tr('KI-Funktionen für dich eingeschaltet – die KI-Knöpfe erscheinen in den Ansichten.', 'AI features switched on for you – the AI buttons appear in the views.') : tr('KI-Funktionen für dich ausgeschaltet – das Cockpit rechnet mit seinen eigenen Regeln.', 'AI features switched off for you – the cockpit works with its own rules.'), icon: 'sparkle', undo: () => runUndo(e) });
    } catch (err) { toast({ text: tr('Konnte nicht gespeichert werden.', 'Could not be saved.'), error: true }); }
    finally { setBusy(false); }
  };
  return (
    <button type="button" className={`ai-mine ${aiMine ? 'on' : ''} ${paused ? 'paused' : ''}`} aria-pressed={aiMine} disabled={busy} onClick={() => flip(!aiMine)} data-ai-mine
      aria-label={aiMine ? tr('KI-Funktionen für mich: an – ausschalten', 'AI features for me: on – switch off') : tr('KI-Funktionen für mich: aus – einschalten', 'AI features for me: off – switch on')}
      {...tip(infoCard({ title: tr('KI-Funktionen für mich', 'AI features for me'), text: paused && vendorOff(config.ai.budget) ? tr(...VENDOR_OFF) : paused
        ? tr('Das KI-Budget dieses Monats ist aufgebraucht – bis zum 1. arbeitet das Cockpit für alle mit seinen eigenen Regeln.', "This month's AI budget is used up – until the 1st the cockpit works with its own rules for everyone.")
        : aiMine ? tr('An: In den Ansichten erscheinen KI-Knöpfe (Lagebild, Vorschläge, Antworten). Jede Anfrage kostet etwas – aus, wenn du sie nicht brauchst.', "On: AI buttons appear in the views (briefings, suggestions, answers). Every request costs a little – switch off if you don't need it.")
          : tr('Aus (Standard): Alles im Cockpit funktioniert ohne KI. Einschalten, wenn du KI-Lagebilder und -Vorschläge möchtest – nur für dich.', 'Off (default): everything in the cockpit works without AI. Switch on if you want AI briefings and suggestions – just for you.') }))}>
      <Icon name="sparkle" size={14} /><span className="ai-mine-label">{tr('KI', 'AI')}</span>
      <span className="ai-mine-track" aria-hidden="true"><motion.span className="ai-mine-knob" initial={false} animate={{ x: aiMine ? 12 : 0 }} transition={sp('chip')} /></span>
    </button>
  );
}

function LangSwitch() {
  const { lang, setLang } = useApp();
  return (
    <div className="seg seg-sm lang-switch" data-tour="lang" role="group" aria-label={tr('Sprache', 'Language')}>
      {[['de', 'DE', 'Deutsch'], ['en', 'EN', 'English']].map(([v, label, name]) => (
        <button key={v} type="button" className="seg-btn" lang={v} aria-pressed={lang === v} title={name} aria-label={name} onClick={() => lang !== v && setLang(v)}>
          {lang === v && <motion.span layoutId="lang-pill" className="seg-pill" transition={layoutT('chip')} />}{label}
        </button>
      ))}
    </div>
  );
}

function TopBar({ title, eyebrow = 'SUPERPORT', status, busy, right, tabs }) {
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand">
          <motion.div className="brand-mark" whileHover={isReduced() ? undefined : { rotate: -8, scale: 1.05 }} transition={sp('chip')}><Logo size={38} /></motion.div>
          <div style={{ minWidth: 0 }}>
            <div className="brand-eyebrow">{eyebrow}{status && <><span className={`live-dot ${busy ? 'busy' : ''}`} /><span style={{ textTransform: 'none', letterSpacing: 0 }}>{status}</span></>}</div>
            <div className="brand-title">{title}</div>
          </div>
        </div>
        <div className="topbar-spacer" />
        <div className="row topbar-right">{right}</div>
      </div>
      {tabs}
    </header>
  );
}

function ViewHost({ view }) {
  const { ds, error, reload, roles } = useApp();
  const employee = useEmployee();
  if (error && !ds) {
    return (
      <div className="page"><Empty icon="alert" title={tr('Daten konnten nicht geladen werden', 'Could not load data')} action={<button className="btn" onClick={() => reload()}><Icon name="refresh" />{tr('Erneut versuchen', 'Try again')}</button>}>{error.message}</Empty></div>
    );
  }
  if (view === 'report') return roles.viewReport ? <Suspense fallback={<PageSkeleton />}><Report /></Suspense> : <NoAccess what={tr('Der C-Level-Report ist nur für freigegebene Gruppen sichtbar.', 'The C-level report is only visible to enabled groups.')} />;
  if (view === 'settings') return roles.manageSettings || roles.admin ? <Suspense fallback={<PageSkeleton />}><Admin mode="delegate" /></Suspense> : <NoAccess what={tr('Die Portfolio-Einstellungen sind nur für die freigegebene Gruppe sichtbar.', 'Portfolio settings are only visible to the enabled group.')} />;
  if (!ds) return <PageSkeleton />;
  if (employee || view === 'mine') return <Suspense fallback={<PageSkeleton />}><Mine /></Suspense>;
  if (view === 'config') return roles.admin ? <Suspense fallback={<PageSkeleton />}><Admin /></Suspense> : <NoAccess what={tr('Die Konfiguration ist nur für Jira-Admins sichtbar.', 'The configuration is visible to Jira admins only.')} />;
  // old ids (bookmarks, links, saved preferences) land in their new home
  const V = { portfolio: Portfolio, project: Project, team: Team, proof: Proof, deps: Project, time: PlanActual, estimate: TimeEstimate, plan: WeekPlan, capacity: Capacity, quality: Project, support: Support, ask: Ask }[view] || Portfolio;
  return <Suspense fallback={<PageSkeleton />}><V /></Suspense>;
}

export function PageSkeleton() {
  return (
    <div className="page">
      <div className="stats">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="stat"><Skeleton h={11} w={90} /><Skeleton h={30} w={110} style={{ marginTop: 10 }} /><Skeleton h={10} w={140} style={{ marginTop: 'auto' }} /></div>)}</div>
      <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={52} style={{ opacity: 1 - i * 0.13 }} />)}
      </div>
    </div>
  );
}

export function NoAccess({ what }) {
  return (
    <div className="page noaccess">
      <Empty icon="lock" title={tr('Kein Zugriff', 'No access')}>{what}</Empty>
    </div>
  );
}

// A crash in one view never takes the cockpit down.
class Boundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { console.error('[cockpit view]', err); }
  render() {
    if (!this.state.err) return this.props.children;
    return <div className="page"><Empty icon="alert" title={tr('Diese Ansicht hatte ein Problem', 'This view ran into a problem')}
      action={<button className="btn" onClick={() => this.setState({ err: null })}><Icon name="refresh" />{tr('Erneut versuchen', 'Try again')}</button>}>{String(this.state.err.message || this.state.err)}</Empty></div>;
  }
}

// ---------- command palette = Lotse's command bar ----------
// Lotse first: the typed words show (a) what Lotse understood – an answer, an action with its live mini-preview, a whole
// job or a question back – as the top row (Enter runs it), (b) the views, projects and work items, (c) the jobs and
// commands, (d) what was started recently and what suits the person's role. Actions only ever open their preview card
// in the Lotse panel – nothing is written from here. Lotse's engine loads with the first opening (lazy, small bundle).
function Palette({ tabs, onTour, adminUrl, employee }) {
  const [open, setOpen] = useState(false);
  const onClose = () => setOpen(false);
  useEffect(() => {
    const k = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName)) { e.preventDefault(); setOpen(true); }
    };
    const ev = (e) => setOpen(!!e.detail);
    window.addEventListener('keydown', k); window.addEventListener('pc-palette', ev);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('pc-palette', ev); };
  }, []);
  const app = useApp();
  const { ds, setView, reload, roles, computed, config, lang, setLang, undoList, runUndo, undoUntil, blockedBy, aiMine, setAiMine } = app;
  const canSettings = roles?.manageSettings && !roles?.admin;
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const [brain, setBrain] = useState(null);
  // the brain loads on the first open – or earlier, while the browser is idle, so the first open is as quick as the next
  useEffect(() => { if (open && !brain) import('./components/lotse/brain.js').then(setBrain).catch(() => {}); }, [open, brain]);
  useEffect(() => {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 2500));
    const h = idle(() => import('./components/lotse/brain.js').then((m) => startTransition(() => setBrain((b) => b || m))).catch(() => {}), { timeout: 6000 });
    return () => (window.cancelIdleCallback ? window.cancelIdleCallback(h) : clearTimeout(h));
  }, []);
  const lctx = useMemo(() => (brain && computed ? brain.ctxOf(app) : null), [brain, computed, ds, roles, lang, config]); // eslint-disable-line react-hooks/exhaustive-deps
  const dq = useDeferredValue(q);
  const lotseHit = useMemo(() => (open && brain && lctx ? brain.instant(dq, lctx) : null), [open, brain, lctx, dq]);
  const recent = useSyncExternalStore(runStore.subscribe, runStore.get, runStore.get).recent;
  useEffect(() => { if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);
  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    const hit = (t) => !s || t.toLowerCase().includes(s);
    const out = [];
    const L = 'Lotse';
    // (a) what Lotse understood – the top row; actions and jobs open in the panel with their preview, never applied here
    if (s.length >= 3 && !/^lots?e?$/.test(s)) {
      if (lotseHit && lotseHit.kind !== 'story') out.push({ group: L, icon: lotseHit.icon, label: lotseHit.label, sub: lotseHit.sub, mini: lotseHit.mini, hint: lotseHit.hint, top: true, run: () => openLotse({ text: q.trim() }) });
      else out.push({ group: L, icon: 'target', label: `${tr('Lotse fragen', 'Ask Lotse')}: „${q.trim()}“`, sub: lotseHit?.sub, hint: tr('Bild mit echten Zahlen', 'picture with real numbers'), top: true, run: () => openLotse({ text: q.trim() }) });
    } else if (!s || 'lotse navigator'.includes(s)) out.push({ group: L, icon: 'target', label: tr('Lotse fragen …', 'Ask Lotse …'), hint: tr('Lagebild als Bild', 'situation as a picture'), run: () => openLotse() });
    if (!s) {
      out.push({ group: L, icon: 'layers', label: tr('Was möchtest du erledigen?', 'What do you want to get done?'), hint: tr('10 Aufgaben', '10 jobs'), run: () => openLotse({ gallery: true }) });
      // (d) recent and suggested
      (recent || []).slice(0, 3).forEach((r) => out.push({ group: tr('Zuletzt mit Lotse', 'Recently with Lotse'), icon: r.icon || 'history', label: r.label, run: () => openLotse(r.req) }));
      if (brain && lctx) brain.suggestedJobs(lctx).forEach((j) => out.push({ group: tr('Vorgeschlagen', 'Suggested'), icon: j.icon, label: j.label, sub: j.sub, hint: tr(`≈ ${j.minutes} Min.`, `≈ ${j.minutes} min`), run: () => openLotse({ act: { kind: 'workflow', workflow: j.id, params: {} } }) }));
    }
    if (s.length >= 3) out.push({ group: tr('Fragen', 'Ask'), icon: 'sparkle', label: `${tr('Frag das Cockpit', 'Ask the cockpit')}: „${q.trim()}“`, run: () => setView('ask', { ask: q.trim() }) });
    // (b) navigation
    tabs.filter((t) => hit(t.label)).forEach((t) => out.push({ group: tr('Ansichten', 'Views'), icon: t.icon, label: t.label, run: () => setView(t.id) }));
    (ds?.portfolio || []).slice().sort((a, b) => a.rank - b.rank).filter((p) => hit(`${p.name} ${p.key}`)).slice(0, 8)
      .forEach((p) => out.push({ group: tr('Projekte', 'Projects'), icon: 'project', label: p.name, hint: `#${p.rank} · ${p.key}`, run: () => setView('project', { ref: p.ref }) }));
    if (s.length >= 2) {
      (ds?.issues || []).filter((i) => i.key.toLowerCase().includes(s) || i.summary.toLowerCase().includes(s)).slice(0, 8)
        .forEach((i) => out.push({ group: tr('Vorgänge', 'Work items'), icon: 'arrowRight', label: i.summary, hint: i.key, run: () => setView('project', { ref: i.rootRef, focus: i.id }) }));
    }
    // (c) jobs with Lotse (workflows) and commands – a command fills the field with a sentence to complete
    if (s.length >= 2 && brain) {
      brain.jobRows(s).slice(0, 4).forEach((j) => out.push({ group: tr('Aufgaben mit Lotse', 'Jobs with Lotse'), icon: j.icon, label: j.label, sub: j.sub, hint: tr(`≈ ${j.minutes} Min.`, `≈ ${j.minutes} min`), run: () => openLotse({ act: { kind: 'workflow', workflow: j.id, params: {} } }) }));
      if (lctx) brain.commandRows(lctx, s).slice(0, 4).forEach((c) => out.push({ group: tr('Befehle', 'Commands'), icon: 'zap', label: c.example, sub: c.title, example: true, run: () => {} }));
    }
    if (!s) [tr('Setze <Projekt> auf gefährdet: <ein Satz>', 'Set <project> to at risk: <one sentence>'), tr('<Projekt> auf Rang 2', 'Move <project> to rank 2'), tr('Gib allen Stories ohne Team in <Projekt> das Team <Team>', 'Give all stories without a team in <project> the team <team>'), tr('<KEY-12> blockiert <KEY-47>', '<KEY-12> blocks <KEY-47>')]
      .forEach((ex) => out.push({ group: tr('Aktionen in einem Satz', 'Actions in one sentence'), icon: 'zap', label: ex, example: true, run: () => {} }));
    // everything the header offers is also here – found by German and English words
    const kw = (...ws) => !s || ws.some((w) => w.toLowerCase().includes(s) || s.split(/\s+/).every((p) => w.toLowerCase().includes(p)));
    // tucked-away views: found by name, not shown as tabs
    if (!employee && kw('nachweis', 'proof', 'prüfen', 'check', 'abgleich', 'stimmen die zahlen')) out.push({ group: tr('Ansichten', 'Views'), icon: 'eye', label: tr('Nachweis – Zahlen mit Jira abgleichen', 'Proof – check the numbers against Jira'), run: () => setView('proof') });
    if (!employee && kw('fragen', 'ask', 'frage', 'question')) out.push({ group: tr('Ansichten', 'Views'), icon: 'sparkle', label: tr('Fragen-Leinwand öffnen', 'Open the Ask canvas'), run: () => setView('ask') });
    const A = tr('Aktionen', 'Actions');
    const n = undoList?.length || 0;
    if (aiPerPerson(config) && kw('ki', 'ai', 'künstliche', 'assistent', 'assistant')) out.push({ group: tr('Aktionen', 'Actions'), icon: 'sparkle', label: aiMine ? tr('KI-Funktionen für mich ausschalten', 'Switch AI features off for me') : tr('KI-Funktionen für mich einschalten', 'Switch AI features on for me'), run: () => setAiMine(!aiMine) });
    if (kw('rückgängig', 'undo', 'zurück', 'zurücknehmen', 'verlauf', 'history', 'ctrl z', 'strg z')) {
      if (n) {
        out.push({ group: A, icon: 'undo', label: `${tr('Rückgängig', 'Undo')}: ${undoList[0].label}`, hint: `Ctrl / ⌘ + Z · ${n} ${tr(n === 1 ? 'Aktion' : 'Aktionen', n === 1 ? 'action' : 'actions')}`, run: () => runUndo() });
        undoList.slice(1, 5).forEach((e) => out.push({ group: tr('Verlauf – rückgängig machen', 'History – undo'), icon: 'history', label: e.label, hint: blockedBy(e) ? tr('bis hierher', 'back to here') : tr('rückgängig', 'undo'), run: () => (blockedBy(e) ? undoUntil(e) : runUndo(e)) }));
        if (n > 1) out.push({ group: A, icon: 'undo', label: tr(`Alle ${n} Aktionen rückgängig machen`, `Undo all ${n} actions`), run: () => undoUntil(undoList.at(-1)) });
      } else out.push({ group: A, icon: 'undo', label: tr('Rückgängig – noch nichts zu tun', 'Undo – nothing to undo yet'), disabled: true, hint: tr('jede Änderung landet hier', 'every change lands here'), run: () => {} });
    }
    if (kw('bewegung', 'motion', 'animation', 'animationen', 'reduziert', 'reduced')) { const red = isReduced(); out.push({ group: A, icon: 'zap', label: red ? tr('Bewegung: voll', 'Motion: full') : tr('Bewegung: reduziert', 'Motion: reduced'), hint: red ? tr('jetzt reduziert', 'now reduced') : tr('jetzt voll', 'now full'), run: () => saveMotion(red ? 'full' : 'reduced') }); }
    if (kw('sprache', 'language', 'english', 'englisch', 'deutsch', 'german')) out.push({ group: A, icon: 'globe', label: lang === 'de' ? 'Switch to English' : 'Auf Deutsch umstellen', hint: lang === 'de' ? 'EN' : 'DE', run: () => setLang(lang === 'de' ? 'en' : 'de') });
    if (!employee && ds && kw('heute zu tun', 'to do today', 'inbox', 'aufgaben', 'vorschläge', 'suggestions')) out.push({ group: A, icon: 'check', label: tr('„Heute zu tun“ öffnen', 'Open "To do today"'), run: () => window.dispatchEvent(new Event('pc-open-inbox')) });
    if (kw('meine woche', 'my week', 'buchen', 'book', 'stunden', 'hours', 'vervollständigen', 'complete')) out.push({ group: A, icon: 'clock', label: tr('Meine Woche buchen', 'Book my week'), run: () => setView('mine') });
    if (roles?.admin && adminUrl && kw('konfiguration', 'configuration', 'einstellungen', 'settings', 'admin')) out.push({ group: A, icon: 'settings', label: tr('Konfiguration öffnen', 'Open the configuration'), hint: 'Jira-Admin', run: () => navigate(adminUrl) });
    if (hit(tr('Aktualisieren', 'Refresh')) || kw('aktualisieren', 'refresh', 'neu laden', 'reload')) out.push({ group: tr('Aktionen', 'Actions'), icon: 'refresh', label: tr('Daten aktualisieren', 'Refresh data'), run: () => reload() });
    if (canSettings && hit(tr('Einstellungen', 'Settings'))) out.push({ group: tr('Aktionen', 'Actions'), icon: 'settings', label: tr('Portfolio-Einstellungen', 'Portfolio settings'), run: () => setView('settings') });
    if (onTour && (hit('Tour') || hit(tr('Hilfe', 'Help')))) out.push({ group: tr('Aktionen', 'Actions'), icon: 'help', label: tr('Kurze Tour starten', 'Take the quick tour'), run: onTour });
    return out;
  }, [q, ds, tabs, setView, reload, onTour, canSettings, config, lang, undoList, runUndo, undoUntil, blockedBy, setLang, roles, adminUrl, employee, brain, lctx, lotseHit, recent, aiMine, setAiMine]);
  useEffect(() => { setActive(0); }, [q]);
  const run = (it) => {
    if (it.example) { setQ(it.label.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() + ' '); inputRef.current?.focus(); return; } // an example fills the field
    if (it.disabled) return;
    onClose(); setTimeout(() => it.run(), 60);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && items[active]) run(items[active]);
    else if (e.key === 'Escape') onClose();
  };
  let lastGroup = null;
  return (
    // no exit animation (it stalls in the Jira frame): closing simply unmounts
    open && <>
        <motion.div className="scrim" {...fadeIn('quick')} onClick={onClose} />
        <div className="modal-wrap">
          <motion.div className="palette" role="dialog" aria-label={tr('Suche und Lotse', 'Search and Lotse')} data-lotse-palette {...popIn({ y: -10, scale: 0.975 })}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 18, top: 19, color: 'var(--accent-strong)', display: 'grid' }}><LotseMark size={18} /></span>
              <input ref={inputRef} className="palette-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
                placeholder={tr('Frag Lotse, gib eine Aufgabe – oder such ein Projekt, einen Vorgang, eine Ansicht …', 'Ask Lotse, give it a job – or find a project, work item, view …')} aria-label={tr('Suchbegriff oder Auftrag an Lotse', 'Search term or a job for Lotse')}
                role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list" aria-activedescendant={items[active] ? `pal-opt-${active}` : undefined} />
            </div>
            <div className="palette-list" role="listbox" id="pal-list" aria-label={tr('Ergebnisse', 'Results')}>
              {items.length === 0 && <div className="muted" style={{ padding: 18, textAlign: 'center' }}>{tr('Nichts gefunden', 'Nothing found')}</div>}
              {items.map((it, i) => {
                const head = it.group !== lastGroup ? (lastGroup = it.group) : null;
                return (
                  <div key={`${it.group}-${i}`}>
                    {head && <div className="palette-group">{head}</div>}
                    <button className={`palette-item ${it.top ? 'lx-pal-top' : ''}`} role="option" id={`pal-opt-${i}`} tabIndex={-1} aria-selected={i === active} data-active={i === active} /* the highlight is CSS (instant, < 100 ms): no layout measuring while typing or arrowing */ onMouseEnter={() => setActive(i)} onClick={() => run(it)}>
                                            <Icon name={it.icon} size={16} style={{ color: it.top ? 'var(--accent-strong)' : 'var(--ink-3)' }} />
                      <span className="grow" style={{ overflow: 'hidden', minWidth: 0 }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: it.example ? 'var(--ink-2)' : undefined, fontWeight: it.top ? 600 : undefined }}>{it.label}</span>
                        {it.sub && <span className="faint" style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: it.disabled ? 'var(--accent-strong)' : undefined }}>{it.sub}</span>}
                        {/* the live mini-preview of an action: how many changes, the first ones – applied only in the panel */}
                        {it.mini && it.mini.count > 0 && (
                          <span className="lx-pal-mini">
                            {it.mini.rows.map((r, k) => <span key={k} className="lx-pal-row">{r.subject && <b className="mono">{r.subject}</b>}<span>{r.from}</span><span aria-hidden="true">→</span><b>{r.to}</b></span>)}
                            {it.mini.count > it.mini.rows.length && <span className="faint">{tr(`+ ${it.mini.count - it.mini.rows.length} weitere`, `+ ${it.mini.count - it.mini.rows.length} more`)}</span>}
                          </span>
                        )}
                      </span>
                      {it.hint && <span className="mono faint">{it.hint}</span>}
                      {it.top && <span className="kbd" style={{ marginLeft: 6 }}>Enter</span>}
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      </>
  );
}
