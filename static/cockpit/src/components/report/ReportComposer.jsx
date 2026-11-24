// Report composer: "Lotse, mach mir den C-Level-Report" → a whole report document in a second, drafted from verified
// data (shared/lotse/report/compose.js), shaped like a modern doc: outline left (drag or Alt+↑/↓ to reorder, switch
// sections on/off, add sections Lotse can write), the pages in the middle (narrative edited in place, numbers as
// protected chips, charts from the data), audience / period / branding right. Own undo/redo, autosave per person
// (this browser at once, the server a few seconds later – the draft follows the person to another device), PDF in one
// click, Confluence with the COMPOSED report (Publish.jsx: re-checked on the server, undoable), summary to the clipboard.
// Everything on the sheet – text, figures, charts, table heads – is in the REPORT's language, not the app's.
// Motion: transform/opacity only, enter animations only (no exit animations: they stall in the Jira frame).
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, Reorder, useDragControls } from 'framer-motion';
import { enter, sp, layoutT, isReduced } from '../../lib/motion.js';
import { draftReport, draftSection, rephrase, checkSection, checkStory, adoptText, plainText, summaryText, sectionCatalog, DOC_VERSION } from '@shared/lotse/report/compose.js';
import { crossCheck } from '@shared/lotse/crosscheck.js';
import { useApp, errText } from '../../state.jsx';
import { call } from '../../lib/api.js';
import { aiOn } from '../../lib/aiFlags.js';
import { tr, fmt, getLang } from '../../lib/i18n.js';
import { Icon, Logo } from '../../lib/icons.jsx';
import { Segmented, Switch } from '../ui.jsx';
import { useLotseCtx } from '../lotse/engine.js';
import { LotseMark } from '../lotse/LotseChip.jsx';
import { localFmt } from '@shared/lotse/narrate.js';
import { layoutReport, asOfText } from './pdfLayout.js';
import Narrative, { toHtml } from './Narrative.jsx';
import ReportVisual from './ReportVisual.jsx';
import PublishComposed from './Publish.jsx';
import './composer.css';

const STORE = 'pc-report-composer:v1:';
const SERVER_SAVE_MS = 4000;
const SERVER_MAX = 118_000; // the server refuses larger drafts (publish.js DRAFT_MAX_BYTES); this browser keeps them
const TL = (L, de, en) => (L === 'en' ? en : de); // the report's language (the sheet), not the app's (tr)
// the draft as the server keeps it: no stories, no name lists (both recomputed here)
const slimDraft = (doc, settings) => ({ v: 1, at: Date.now(), settings, doc: { ...doc, sections: doc.sections.map(({ story, entities, ...s }) => s) } }); // eslint-disable-line no-unused-vars
// [number, unit] of a KPI figure in the report's language
function figure(unit, v, L) {
  const F = localFmt(L);
  if (v == null || !Number.isFinite(v)) return ['–', ''];
  if (unit === '%') return [F.n(v), '%'];
  if (unit === 'h') return [F.n(v, Math.abs(v) < 10 ? 1 : 0), 'h'];
  if (unit === 'd') return [F.n(v), TL(L, Math.abs(v) === 1 ? 'Tag' : 'Tage', Math.abs(v) === 1 ? 'day' : 'days')];
  if (unit === 'eur') return [F.n(v), '€'];
  return [F.n(v, Number.isInteger(v) ? 0 : 1), ''];
}
const TONE_WORD = () => ({ ok: tr('im Plan', 'on track'), warn: tr('Achtung', 'watch'), bad: tr('kritisch', 'critical'), info: tr('Hinweis', 'note') });
const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode / full: the draft simply is not kept */ } };
// a macrotask, so the skeleton paints first (not requestAnimationFrame: it never fires in a hidden tab)
const later = (fn) => setTimeout(fn, 24);

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* the Jira frame may block the clipboard API */ }
  try {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

export default function ReportComposer({ params = {}, report, planActual, onClose }) {
  const app = useApp();
  const { toast, config, boot, computed } = app;
  const lctx = useLotseCtx();
  const key = `${STORE}${boot?.me?.id || 'me'}`;
  const fromCommand = ['audience', 'period', 'sections', 'projectRef', 'teamId', 'lang'].some((k) => params[k] != null);
  const saved = useMemo(() => (fromCommand ? null : load(key)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [settings, setSettings] = useState(() => ({
    audience: params.audience || saved?.settings?.audience || 'c-level',
    period: params.period || saved?.settings?.period || 'current',
    teamId: params.teamId || saved?.settings?.teamId || null,
    projectRef: params.projectRef || saved?.settings?.projectRef || null,
    lang: params.lang || saved?.settings?.lang || getLang(),
    logo: saved?.settings?.logo !== false, confidential: saved?.settings?.confidential !== false,
  }));
  const [hist, setHist] = useState({ past: [], doc: null, future: [], key: null, t: 0 });
  const doc = hist.doc;
  const [busy, setBusy] = useState(true);
  const [restored, setRestored] = useState(null);
  const [sel, setSel] = useState(null);
  const [menu, setMenu] = useState(false);
  const [panel, setPanel] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [live, setLive] = useState('');
  const [ai, setAi] = useState({});
  const [pub, setPub] = useState(false);
  const edited = useRef(false);
  edited.current = hist.past.length > 0 || hist.future.length > 0;
  const root = useRef(null);
  const addBtn = useRef(null); // the "+ Section" button – its menu is placed at it (AddMenu)
  const opener = useRef(typeof document !== 'undefined' ? document.activeElement : null);
  const editors = useRef({});
  const say = (t) => setLive(`${t}​${Date.now() % 2 ? '' : ' '}`);

  // ---------- history ----------
  // next: a doc, or a function of the current doc (always the latest – never a stale closure)
  const commit = useCallback((nextIn, coalesce = null) => setHist((h) => {
    const next = typeof nextIn === 'function' ? nextIn(h.doc) : nextIn;
    if (!next || next === h.doc) return h;
    if (!h.doc) return { past: [], doc: next, future: [], key: null, t: Date.now() };
    const same = coalesce && h.key === coalesce && Date.now() - h.t < 1500;
    return { past: same ? h.past : [...h.past.slice(-80), h.doc], doc: next, future: [], key: coalesce, t: Date.now() };
  }), []);
  const undo = useCallback(() => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), doc: h.past.at(-1), future: [h.doc, ...h.future].slice(0, 80), key: null, t: 0 } : h)), []);
  const redo = useCallback(() => setHist((h) => (h.future.length ? { past: [...h.past, h.doc], doc: h.future[0], future: h.future.slice(1), key: null, t: 0 } : h)), []);
  const patchSection = useCallback((id, patch, coalesce) => setHist((h) => {
    if (!h.doc) return h;
    const next = { ...h.doc, sections: h.doc.sections.map((s) => (s.id === id ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s)) };
    const same = coalesce && h.key === coalesce && Date.now() - h.t < 1500;
    return { past: same ? h.past : [...h.past.slice(-80), h.doc], doc: next, future: [], key: coalesce || null, t: Date.now() };
  }), []);

  // ---------- drafting ----------
  const engineCtx = useCallback(() => (lctx ? { ...lctx, report: report || null, planActual: planActual || null, now: Date.now() } : null), [lctx, report, planActual]);
  const draft = useCallback((s, { keepOrder = false, note = true, sections = null } = {}) => {
    const ctx = engineCtx();
    if (!ctx) return;
    setBusy(true);
    later(() => {
      try {
        const prev = keepOrder && hist.doc ? hist.doc.sections.map((x) => x.id) : sections;
        const d = draftReport({ ctx, audience: s.audience, period: s.period, teamId: s.teamId, projectRef: s.projectRef, lang: s.lang, sections: prev || undefined });
        if (hist.doc?.published) d.published = hist.doc.published; // a redraft still updates the page published before
        if (keepOrder && hist.doc) { const off = new Set(hist.doc.sections.filter((x) => x.on === false).map((x) => x.id)); d.sections = d.sections.map((x) => (off.has(x.id) ? { ...x, on: false } : x)); }
        commit(d);
        setRestored(null);
        if (note && hist.doc) toast({ text: tr('Neu entworfen – Strg+Z holt den vorherigen Stand zurück', 'Redrafted – Ctrl+Z brings back the previous version'), icon: 'sparkle' });
        say(tr(`Report entworfen: ${d.sections.length} Abschnitte`, `Report drafted: ${d.sections.length} sections`));
      } catch (e) { toast({ text: errText(e), error: true }); }
      setBusy(false);
    });
  }, [engineCtx, hist.doc, commit, toast]);

  // A draft from the server has no stories and no name lists (publish.js cleanDraft): the names come back from the data,
  // so the number check knows every project and team again.
  const withEntities = useCallback((d) => {
    if (!d || !computed) return d;
    const ents = { projects: computed.model.items.map((it) => ({ ref: it.ref, key: it.key || null, rank: it.rank ?? null, name: it.name })), teams: [...computed.model.teams.values()].filter((t) => t.id !== '_none').map((t) => ({ id: t.id, name: t.name })), people: [] };
    return { ...d, sections: d.sections.map((s) => (s.entities ? s : { ...s, entities: ents, variants: s.variants?.length ? s.variants : [s.text] })) };
  }, [computed]);
  const usable = (x) => x?.doc?.v === DOC_VERSION && Array.isArray(x.doc.sections) && x.doc.sections.length > 0;
  const restore = (x, note) => {
    setHist({ past: [], doc: withEntities(x.doc), future: [], key: null, t: 0 });
    if (x.settings) setSettings((s) => ({ ...s, logo: x.settings.logo !== false, confidential: x.settings.confidential !== false }));
    setRestored(x.at || Date.now()); setBusy(false); say(note);
    // what came from the server is not sent back unchanged
    if (x.settings) latest.current.sent = JSON.stringify([slimDraft(x.doc, x.settings).doc, x.settings]);
  };

  // first draft: this browser's copy at once; the server's copy wins when it is newer (another device) and nothing was
  // changed here yet; with neither, Lotse writes a new one. A command's parameters always start a fresh draft.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !lctx) return undefined;
    started.current = true;
    let alive = true;
    const fresh = () => draft(settings, { note: false, sections: Array.isArray(params.sections) ? params.sections : null });
    if (usable(saved)) restore(saved, tr('Dein letzter Entwurf ist wiederhergestellt.', 'Your last draft is restored.'));
    if (fromCommand) { fresh(); return undefined; }
    const timeout = new Promise((r) => setTimeout(() => r(null), usable(saved) ? 8000 : 1500));
    Promise.race([call('report.draft').catch(() => null), timeout]).then((r) => {
      if (!alive) return;
      const newer = usable(r) && (r.at || 0) > (saved?.at || 0) + 1000;
      if (newer && !edited.current) {
        restore(r, tr('Dein Entwurf von einem anderen Gerät ist geladen.', 'Your draft from another device is loaded.'));
        if (usable(saved)) toast({ text: tr('Neuerer Entwurf von einem anderen Gerät geladen', 'Newer draft from another device loaded'), icon: 'history' });
      } else if (!usable(saved)) fresh();
    });
    return () => { alive = false; };
  }, [lctx]); // eslint-disable-line react-hooks/exhaustive-deps

  // autosave: this browser at once (instant cache), the server a few seconds later (follows the person to other devices)
  const latest = useRef({ doc: null, settings: null, sent: '' });
  latest.current.doc = doc; latest.current.settings = settings;
  const pushServer = useCallback(() => {
    const { doc: d, settings: s } = latest.current;
    if (!d) return;
    const body = slimDraft(d, s);
    const sig = JSON.stringify([body.doc, body.settings]);
    if (sig === latest.current.sent || sig.length > SERVER_MAX) return;
    latest.current.sent = sig;
    call('prefs.save', { reportDraft: body }).catch(() => { latest.current.sent = ''; });
  }, []);
  useEffect(() => {
    if (!doc) return undefined;
    const t = setTimeout(() => save(key, { v: 1, doc, settings, at: Date.now() }), 500);
    const u = setTimeout(pushServer, SERVER_SAVE_MS);
    return () => { clearTimeout(t); clearTimeout(u); };
  }, [doc, settings, key, pushServer]);
  useEffect(() => () => pushServer(), [pushServer]); // closing the composer saves what is still pending
  // a page published from here: remembered with the draft (republish updates it), never an undo step of the document
  const setPublished = useCallback((p) => setHist((h) => (h.doc ? { ...h, doc: { ...h.doc, published: p || null } } : h)), []);

  // undo / redo of a redraft: the panel shows what the document is for
  useEffect(() => {
    if (!doc) return;
    setSettings((s) => ({ ...s, audience: doc.audience || s.audience, lang: doc.lang || s.lang, teamId: doc.teamId ?? s.teamId, projectRef: doc.projectRef ?? s.projectRef, period: doc.period?.quarter || s.period }));
  }, [doc?.audience, doc?.lang, doc?.teamId, doc?.projectRef, doc?.period?.quarter]); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (patch) => { const s = { ...settings, ...patch }; setSettings(s); if (['audience', 'period', 'teamId', 'projectRef', 'lang'].some((k) => k in patch)) draft(s); };

  // ---------- focus, keys ----------
  useEffect(() => {
    const t = setTimeout(() => root.current?.querySelector('[data-autofocus]')?.focus(), 30);
    const back = opener.current;
    return () => { clearTimeout(t); try { back?.focus?.(); } catch { /* gone */ } };
  }, []);
  // Keys while the composer is open – on the window, capture phase: they work wherever the focus is (also after a
  // button got disabled) and never reach the app's own shortcuts behind the dialog (its Ctrl+Z would undo a rank change).
  const onKey = (e) => {
    if (document.querySelector('.modal-wrap .modal')) return; // the publish dialog handles its own keys
    const inside = root.current?.contains(document.activeElement);
    if (e.key === 'Escape') {
      if (menu) { e.stopPropagation(); setMenu(false); return; }
      if (root.current?.querySelector('.rc-facts')) return; // the number picker closes itself
      e.stopPropagation(); onClose(); return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = String(e.key || '').toLowerCase();
    if (mod && (k === 'z' || k === 'y')) {
      e.preventDefault(); e.stopPropagation();
      if (k === 'y' || e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && k === 'k') { e.stopPropagation(); return; } // no command palette behind the dialog
    if (e.key === 'Tab' && root.current) {
      const f = [...root.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (!inside) { e.preventDefault(); (e.shiftKey ? f.at(-1) : f[0]).focus(); return; }
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  };
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  useEffect(() => {
    const h = (e) => keyRef.current(e);
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);
  // after a redraft, a focus that fell out of the dialog (a disabled button) comes back to its title
  useEffect(() => { if (!busy && root.current && !root.current.contains(document.activeElement)) root.current.querySelector('#rc-title')?.focus(); }, [busy]);

  // ---------- outline ----------
  const ids = doc?.sections.map((s) => s.id) || [];
  const reorder = (next) => commit((d) => ({ ...d, sections: next.map((id) => d.sections.find((s) => s.id === id)).filter(Boolean) }), 'order');
  const move = (id, dir) => {
    const i = ids.indexOf(id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const next = [...ids]; [next[i], next[j]] = [next[j], next[i]];
    commit((d) => { const o = d.sections.map((x) => x.id); const a = o.indexOf(id), b = a + dir; if (a < 0 || b < 0 || b >= o.length) return d; const ss = [...d.sections]; [ss[a], ss[b]] = [ss[b], ss[a]]; return { ...d, sections: ss }; });
    const s = doc.sections[i];
    say(tr(`„${s.title}“ ist jetzt an Position ${j + 1} von ${ids.length}.`, `"${s.title}" is now at position ${j + 1} of ${ids.length}.`));
    setTimeout(() => root.current?.querySelector(`[data-outline="${CSS.escape(id)}"] .rc-ol-main`)?.focus(), 0);
  };
  const toggle = (id) => { const s = doc.sections.find((x) => x.id === id); patchSection(id, { on: s.on === false }); say(s.on === false ? tr(`„${s.title}“ eingeblendet`, `"${s.title}" shown`) : tr(`„${s.title}“ ausgeblendet`, `"${s.title}" hidden`)); };
  const remove = (id) => { const s = doc.sections.find((x) => x.id === id); commit((d) => ({ ...d, sections: d.sections.filter((x) => x.id !== id) })); say(tr(`„${s.title}“ entfernt – Strg+Z holt ihn zurück`, `"${s.title}" removed – Ctrl+Z brings it back`)); };
  const add = (id) => {
    setMenu(false);
    const ctx = engineCtx();
    if (!ctx || !doc) return;
    let sec = draftSection(id, { ctx, audience: doc.audience, period: settings.period, teamId: settings.teamId, projectRef: settings.projectRef, lang: doc.lang });
    if (!sec) return;
    if (id === 'text') { let k = 1; while (ids.includes(`text-${k}`)) k++; sec = { ...sec, id: `text-${k}` }; }
    if (ids.includes(sec.id)) { jump(sec.id); return; }
    const at = sel && ids.includes(sel) ? ids.indexOf(sel) + 1 : ids.length;
    commit((d) => { const next = [...d.sections]; next.splice(Math.min(at, next.length), 0, { ...sec, on: true }); return { ...d, sections: next }; });
    setSel(sec.id);
    say(tr(`„${sec.title}“ hinzugefügt`, `"${sec.title}" added`));
    setTimeout(() => jump(sec.id), 60);
  };
  const jump = (id) => {
    setSel(id);
    const n = root.current?.querySelector(`[data-section="${CSS.escape(id)}"]`);
    n?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => (editors.current[id]?.focus ? editors.current[id].focus() : n?.focus()), 320);
  };

  // ---------- AI (only when switched on) ----------
  const aiReport = aiOn(config, 'reportSummary');
  const aiLotse = aiOn(config, 'lotse');
  const canAi = (s) => aiReport && (s.id === 'summary' || (!!s.story && aiLotse));
  const askAi = async (s) => {
    setAi((m) => ({ ...m, [s.id]: { phase: 'loading' } }));
    try {
      let text, cc;
      if (s.id === 'summary') {
        const r = await call('ai.reportSummary', { lang: doc.lang });
        text = String(r?.text || '').replace(/\*\*(.+?)\*\*/g, '$1').split(/\n+/).map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).join('\n');
        cc = text ? crossCheck(checkStory(s), text, { lang: doc.lang }) : null;
      } else {
        const r = await call('lotse.llm', { story: s.story, lang: doc.lang });
        text = [r?.text, r?.extra].filter(Boolean).join(' ');
        cc = r?.crossCheck || (text ? crossCheck(checkStory(s), text, { lang: doc.lang }) : null);
      }
      setAi((m) => ({ ...m, [s.id]: { phase: 'done', text, cc } }));
    } catch (e) { setAi((m) => ({ ...m, [s.id]: { phase: 'error', e } })); }
  };
  const adoptAi = (s) => {
    const a = ai[s.id];
    if (!a?.text) return;
    commit((d) => ({ ...d, sections: d.sections.map((x) => (x.id === s.id ? adoptText(x, a.text, d.lang) : x)) }));
    setAi((m) => ({ ...m, [s.id]: null }));
    say(tr('KI-Text übernommen – geprüfte Zahlen sind als Chips markiert.', 'AI text adopted – verified numbers are marked as chips.'));
  };

  // ---------- outputs ----------
  const branding = { logo: settings.logo, confidential: settings.confidential };
  const pdf = async () => {
    if (!doc) return;
    setPdfBusy(true);
    try {
      const { downloadComposedPdf } = await import('../../lib/pdf.js');
      const r = await downloadComposedPdf(doc, { branding });
      toast({ text: tr(`PDF erstellt${r?.pages ? ` – ${r.pages} Seiten` : ''}`, `PDF created${r?.pages ? ` – ${r.pages} pages` : ''}`), icon: 'pdf' });
    } catch (e) { toast({ text: errText(e), error: true }); } finally { setPdfBusy(false); }
  };
  const copy = async () => { if (!doc) return; const ok = await copyText(summaryText(doc)); toast(ok ? { text: tr('Zusammenfassung kopiert', 'Summary copied'), icon: 'check' } : { text: tr('Kopieren ist hier nicht erlaubt – markiere den Text im Dokument.', 'Copying is not allowed here – select the text in the document.'), error: true }); };

  // pages: the same layout as the PDF (deferred, so typing never waits for it)
  const deferred = useDeferredValue(doc);
  const layout = useMemo(() => { try { return deferred ? layoutReport(deferred, { branding }) : null; } catch { return null; } }, [deferred, settings.logo, settings.confidential]); // eslint-disable-line react-hooks/exhaustive-deps
  const pageOf = layout?.sectionPages || {};
  const pageCount = layout?.pages.length || 1;
  const visible = doc?.sections.filter((s) => s.on !== false) || [];
  const verify = useMemo(() => Object.fromEntries((deferred?.sections || []).map((s) => [s.id, checkSection({ ...s, lang: deferred.lang })])), [deferred]);
  const unsourced = visible.reduce((a, s) => a + (verify[s.id]?.length || 0), 0);
  const factsN = visible.reduce((a, s) => a + (s.facts?.length || 0), 0);

  const q = computed?.wl?.quarters || [];
  const teams = computed ? [...computed.model.teams.values()].filter((t) => t.id !== '_none') : [];
  const projects = computed ? computed.model.items.filter((p) => !computed.metrics.get(p.ref)?.done) : [];
  const catalog = sectionCatalog(getLang());

  return (
    <div className="rc-root" ref={root} role="dialog" aria-modal="true" aria-labelledby="rc-title">
      <div className="sr" aria-live="polite" role="status">{live}</div>
      {/* ---------- top bar ---------- */}
      <div className="rc-bar">{/* not a banner / main landmark: the composer is a dialog above the app, which has its own */}
        <div className="rc-brand">
          <span className="rc-mark" aria-hidden="true"><LotseMark size={18} spin={busy} /></span>
          <div>
            <h1 id="rc-title" className="rc-h1" tabIndex={-1} data-autofocus>{tr('Report mit Lotse', 'Report with Lotse')}</h1>
            <div className="rc-sub">{busy ? tr('Lotse schreibt aus euren Daten …', 'Lotse is writing from your data …') : restored ? tr(`Entwurf von ${fmt.dateTime(new Date(restored).toISOString())} – Zahlen mit Stand ${fmt.dateLong(doc?.asOf)}`, `Draft from ${fmt.dateTime(new Date(restored).toISOString())} – figures as of ${fmt.dateLong(doc?.asOf)}`) : tr(`${visible.length} Abschnitte · ${pageCount} ${pageCount === 1 ? 'Seite' : 'Seiten'} · Stand ${fmt.dateLong(doc?.asOf)}`, `${visible.length} sections · ${pageCount} ${pageCount === 1 ? 'page' : 'pages'} · as of ${fmt.dateLong(doc?.asOf)}`)}</div>
          </div>
        </div>
        <div className="rc-tools">
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={undo} disabled={!hist.past.length} aria-label={tr('Rückgängig (Strg+Z)', 'Undo (Ctrl+Z)')} title={tr('Rückgängig (Strg+Z)', 'Undo (Ctrl+Z)')}><Icon name="undo" /></button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm rc-redo" onClick={redo} disabled={!hist.future.length} aria-label={tr('Wiederholen (Strg+Umschalt+Z)', 'Redo (Ctrl+Shift+Z)')} title={tr('Wiederholen (Strg+Umschalt+Z)', 'Redo (Ctrl+Shift+Z)')}><Icon name="undo" /></button>
          <span className="rc-sep" aria-hidden="true" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={copy} disabled={!doc}><Icon name="layers" />{tr('Zusammenfassung kopieren', 'Copy summary')}</button>
          <button type="button" className="btn btn-sm" data-rc-confluence onClick={() => setPub(true)} disabled={!doc || busy} title={tr('Veröffentlicht genau diesen Report als Confluence-Seite – der Server prüft vorher jede Zahl gegen frische Daten', 'Publishes exactly this report as a Confluence page – the server first checks every number against fresh data')}><Icon name="send" />{doc?.published ? tr('Confluence aktualisieren', 'Update Confluence') : 'Confluence'}</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={pdf} disabled={!doc || busy || pdfBusy} data-rc-pdf><Icon name="pdf" />{pdfBusy ? tr('Erstelle PDF …', 'Creating PDF …') : tr('PDF herunterladen', 'Download PDF')}</button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm rc-panel-toggle" onClick={() => setPanel(!panel)} aria-expanded={panel} aria-controls="rc-panel" aria-label={tr('Einstellungen', 'Settings')}><Icon name="settings" /></button>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label={tr('Composer schließen (Esc)', 'Close composer (Esc)')}><Icon name="x" /></button>
        </div>
      </div>

      <div className="rc-body">
        {/* ---------- outline ---------- */}
        <nav className="rc-outline" aria-label={tr('Gliederung', 'Outline')}>
          <div className="rc-ol-head">
            <span className="eyebrow">{tr('Gliederung', 'Outline')}</span>
            <div className="rc-add">
              <button ref={addBtn} type="button" className="btn btn-xs" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} disabled={!doc}><Icon name="plus" size={13} />{tr('Abschnitt', 'Section')}</button>
              {menu && root.current && <AddMenu catalog={catalog} present={ids} onPick={add} onClose={() => setMenu(false)} anchor={addBtn} container={root.current} />}
            </div>
          </div>
          <p className="rc-hint faint">{tr('Ziehen oder Alt+↑/↓ zum Umsortieren', 'Drag or Alt+↑/↓ to reorder')}</p>
          {doc ? (
            <OutlineList sections={doc.sections} sel={sel} pageOf={pageOf} onReorder={reorder} onJump={jump} onMove={move} onToggle={toggle} onRemove={remove} />
          ) : <div className="rc-ol-skel" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((k) => <i key={k} />)}</div>}
        </nav>

        {/* ---------- the document ---------- */}
        <section className="rc-canvas" aria-label={tr('Dokument', 'Document')} aria-busy={busy}>
          {!doc ? <SheetSkeleton /> : (
            <motion.article className={`rc-sheet ${busy ? 'is-busy' : ''}`} lang={doc.lang} {...enter(0, { y: 14, d: 'gentle' })}>
              <div className="rc-cover">
                {settings.logo && <span className="rc-cover-logo" aria-hidden="true"><Logo size={26} /></span>}
                <div className="rc-cover-text">
                  <div className="rc-cover-eyebrow">SUPERPORT · PORTFOLIO COCKPIT</div>
                  <input className="rc-cover-title" value={doc.title} onChange={(e) => { const v = e.target.value.slice(0, 120); commit((d) => ({ ...d, title: v }), 'title'); }} aria-label={tr('Titel des Reports', 'Report title')} />
                  <input className="rc-cover-sub" value={doc.subtitle} onChange={(e) => { const v = e.target.value.slice(0, 160); commit((d) => ({ ...d, subtitle: v }), 'subtitle'); }} aria-label={tr('Untertitel', 'Subtitle')} />
                  <div className="rc-cover-asof">{TL(doc.lang, 'Stand', 'As of')} {asOfText(doc.asOf, doc.lang)}{settings.confidential ? ` · ${TL(doc.lang, 'vertraulich', 'confidential')}` : ''}</div>
                </div>
              </div>
              {restored && (
                <div className="rc-restored" role="note">
                  <Icon name="history" size={14} />
                  <span>{tr('Dein letzter Entwurf ist wiederhergestellt. Die Zahlen haben den Stand von damals.', 'Your last draft is restored. The figures are from back then.')}</span>
                  <button type="button" className="btn btn-xs" onClick={() => draft(settings, { keepOrder: true })}><Icon name="refresh" size={12} />{tr('Mit aktuellen Zahlen neu entwerfen', 'Redraft with current figures')}</button>
                </div>
              )}
              {visible.length === 0 && <div className="rc-empty muted">{tr('Alle Abschnitte sind ausgeblendet – schalte links einen ein oder füge einen hinzu.', 'Every section is hidden – switch one on in the outline or add one.')}</div>}
              {visible.map((s, i) => {
                const prev = visible[i - 1];
                const brk = i > 0 && pageOf[s.id] != null && pageOf[prev.id] != null && pageOf[s.id] > pageOf[prev.id];
                return [
                  brk ? <div key={`brk-${s.id}`} className="rc-break" aria-hidden="true"><span>{tr(`Seite ${pageOf[s.id] + 1} von ${pageCount}`, `Page ${pageOf[s.id] + 1} of ${pageCount}`)}</span></div> : null,
                  <SectionView key={s.id} s={s} i={i} lang={doc.lang} active={sel === s.id} problems={verify[s.id] || []}
                    editorRef={(r) => { editors.current[s.id] = r; }} onSelect={() => setSel(s.id)}
                    onText={(t) => patchSection(s.id, { text: t }, `text:${s.id}`)} onTitle={(t) => patchSection(s.id, { title: t.slice(0, 100) }, `title:${s.id}`)}
                    onRephrase={() => { const n = rephrase(s); patchSection(s.id, { text: n.text, variant: n.variant }); say(tr(`Neu formuliert (${n.variant + 1} von ${s.variants.length})`, `Rephrased (${n.variant + 1} of ${s.variants.length})`)); }}
                    onHide={() => toggle(s.id)}
                    ai={canAi(s) ? { state: ai[s.id], ask: () => askAi(s), adopt: () => adoptAi(s), close: () => setAi((m) => ({ ...m, [s.id]: null })) } : null} />,
                ];
              })}
              <footer className="rc-foot">
                <span>{settings.logo && <Logo size={14} />} SUPERPORT Portfolio Cockpit{settings.confidential ? ` · ${TL(doc.lang, 'vertraulich', 'confidential')}` : ''}</span>
                <span>{TL(doc.lang, 'Stand', 'As of')} {asOfText(doc.asOf, doc.lang)}</span>
                <span>{TL(doc.lang, `${pageCount} ${pageCount === 1 ? 'Seite' : 'Seiten'}`, `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`)}</span>
              </footer>
            </motion.article>
          )}
        </section>

        {/* ---------- settings ---------- */}
        <aside id="rc-panel" className={`rc-panel ${panel ? 'is-open' : ''}`} aria-label={tr('Einstellungen des Reports', 'Report settings')}>
          <section className="rc-group">
            <h2 className="rc-h2">{tr('Für wen?', 'For whom?')}</h2>
            <div className="rc-aud" role="group" aria-label={tr('Zielgruppe', 'Audience')}>
              {[['c-level', tr('Geschäftsführung', 'Management'), 'report'], ['steering', tr('Lenkungskreis', 'Steering'), 'users'], ['team', 'Team', 'user'], ['project', tr('Projekt', 'Project'), 'project']].map(([v, l, ic]) => (
                <button key={v} type="button" className="rc-aud-btn" aria-pressed={settings.audience === v} aria-disabled={busy} onClick={() => { if (!busy && settings.audience !== v) change({ audience: v }); }}>
                  {settings.audience === v && <motion.span layoutId="rc-aud-pill" className="rc-aud-pill" transition={sp('chip')} />}
                  <Icon name={ic} size={15} /><span>{l}</span>
                </button>
              ))}
            </div>
            {settings.audience === 'team' && (
              <label className="rc-field"><span className="label">Team</span>
                <select className="select" value={settings.teamId || doc?.teamId || ''} onChange={(e) => change({ teamId: e.target.value })} disabled={busy}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              </label>
            )}
            {settings.audience === 'project' && (
              <label className="rc-field"><span className="label">{tr('Projekt', 'Project')}</span>
                <select className="select" value={settings.projectRef || doc?.projectRef || ''} onChange={(e) => change({ projectRef: e.target.value })} disabled={busy}>{projects.map((p) => <option key={p.ref} value={p.ref}>{p.rank} · {p.name}</option>)}</select>
              </label>
            )}
          </section>
          <section className="rc-group">
            <h2 className="rc-h2">{tr('Zeitraum', 'Period')}</h2>
            <label className="rc-field"><span className="label">{tr('Quartal für Wasserlinie und Engpässe', 'Quarter for waterline and bottlenecks')}</span>
              <select className="select" value={doc?.period?.quarter || q[0] || ''} onChange={(e) => change({ period: e.target.value })} disabled={busy || !q.length}>{q.map((x, i) => <option key={x} value={x}>{fmt.quarter(x)}{i === 0 ? tr(' (laufend)', ' (current)') : ''}</option>)}</select>
            </label>
          </section>
          <section className="rc-group">
            <h2 className="rc-h2">{tr('Sprache und Auftritt', 'Language and look')}</h2>
            <Segmented size="sm" label={tr('Sprache des Reports', 'Report language')} value={settings.lang} onChange={(l) => change({ lang: l })} options={[{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }]} />
            <div className="rc-switches">
              <Switch on={settings.logo} onChange={(v) => setSettings({ ...settings, logo: v })} label={tr('Logo zeigen', 'Show logo')} />
              <Switch on={settings.confidential} onChange={(v) => setSettings({ ...settings, confidential: v })} label={tr('Vertraulich-Hinweis', 'Confidential note')} />
            </div>
          </section>
          <section className="rc-group rc-trust" aria-live="polite">
            <div className={`rc-trust-head ${unsourced ? 'warn' : 'ok'}`}>
              <Icon name={unsourced ? 'alert' : 'shield'} size={15} />
              <b>{unsourced ? tr(`${unsourced} ${unsourced === 1 ? 'Zahl' : 'Zahlen'} ohne Quelle`, `${unsourced} ${unsourced === 1 ? 'number' : 'numbers'} without a source`) : tr('Jede Zahl geprüft', 'Every number verified')}</b>
            </div>
            <p className="faint rc-trust-text">{unsourced ? tr('Von Hand eingetippte Zahlen sind gelb markiert. Ersetze sie über „Zahl einfügen“ durch geprüfte Werte.', 'Numbers typed by hand are marked yellow. Replace them with verified values via "Insert number".') : tr(`${factsN} Werte aus Jira, Kapazitäten und Support – als Chips geschützt, so bleiben sie wahr.`, `${factsN} values from Jira, capacity and support – protected as chips, so they stay true.`)}</p>
            <button type="button" className="btn btn-xs" onClick={() => draft(settings, { keepOrder: true })} disabled={busy}><Icon name="refresh" size={12} />{tr('Alles neu entwerfen', 'Redraft everything')}</button>
            <p className="faint rc-trust-text">{tr('Dein Entwurf wird automatisch gespeichert – in diesem Browser und für dich auf dem Server, so findest du ihn auch auf einem anderen Gerät.', 'Your draft is saved automatically – in this browser and for you on the server, so you find it on another device too.')}</p>
          </section>
        </aside>
      </div>
      <PublishComposed open={pub} doc={doc} confidential={settings.confidential} onClose={() => setPub(false)} onPublished={setPublished} onRedraft={() => draft(settings, { keepOrder: true })} />
    </div>
  );
}

// ---------- outline ----------
// While dragging only the outline moves (its own state: cheap, 60 fps); the document and its pages follow once, on drop.
function OutlineList({ sections, sel, pageOf, onReorder, onJump, onMove, onToggle, onRemove }) {
  const ids = sections.map((s) => s.id);
  const [dragIds, setDragIds] = useState(null);
  const dragRef = useRef(null);
  const onDragOrder = (next) => { dragRef.current = next; setDragIds(next); };
  const endDrag = () => { const d = dragRef.current; dragRef.current = null; setDragIds(null); if (d && d.join() !== ids.join()) onReorder(d); };
  const olIds = dragIds || ids;
  return (
    <Reorder.Group axis="y" values={olIds} onReorder={onDragOrder} className="rc-ol-list" as="ol">
      {olIds.map((id) => sections.find((x) => x.id === id)).filter(Boolean).map((s, i) => (
        <OutlineItem key={s.id} s={s} i={i} n={ids.length} onDrop={endDrag} active={sel === s.id} page={pageOf[s.id]} onJump={() => onJump(s.id)} onMove={(d) => onMove(s.id, d)} onToggle={() => onToggle(s.id)} onRemove={() => onRemove(s.id)} />
      ))}
    </Reorder.Group>
  );
}

// ---------- outline row ----------
function OutlineItem({ s, i, n, active, page, onJump, onMove, onToggle, onRemove, onDrop }) {
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const off = s.on === false;
  return (
    <Reorder.Item value={s.id} dragListener={false} dragControls={controls} className={`rc-ol-item ${active ? 'is-active' : ''} ${off ? 'is-off' : ''} ${dragging ? 'is-drag' : ''}`} data-outline={s.id}
      // the lifted look is a class (shadow + will-change only while dragging); the motion itself is transform only
      whileDrag={isReduced() ? undefined : { scale: 1.02 }} transition={layoutT('card')} onDragStart={() => setDragging(true)} onDragEnd={() => { setDragging(false); onDrop?.(); }} as="li">
      <span className="rc-grip" onPointerDown={(e) => { e.preventDefault(); controls.start(e); }} aria-hidden="true"><Icon name="grip" size={14} /></span>
      <button type="button" className="rc-ol-main" onClick={onJump}
        onKeyDown={(e) => { if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); onMove(-1); } if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); onMove(1); } }}
        aria-label={`${s.title}${off ? tr(' (ausgeblendet)', ' (hidden)') : ''}, ${tr(`Position ${i + 1} von ${n}`, `position ${i + 1} of ${n}`)}`}
        aria-describedby="rc-ol-help">
        <i className={`rc-dot t-${s.tone || 'info'}`} aria-hidden="true" />
        <span className="rc-ol-title">{s.title}</span>
        {!off && page != null && <span className="rc-ol-page faint" aria-hidden="true">{page + 1}</span>}
      </button>
      <span className="rc-ol-acts">
        <button type="button" className="rc-ib" onClick={() => onMove(-1)} disabled={i === 0} aria-label={tr(`„${s.title}“ nach oben`, `Move "${s.title}" up`)}><Icon name="up" size={13} /></button>
        <button type="button" className="rc-ib" onClick={() => onMove(1)} disabled={i === n - 1} aria-label={tr(`„${s.title}“ nach unten`, `Move "${s.title}" down`)}><Icon name="down" size={13} /></button>
        <button type="button" className="rc-ib" onClick={onToggle} aria-pressed={!off} aria-label={off ? tr(`„${s.title}“ einblenden`, `Show "${s.title}"`) : tr(`„${s.title}“ ausblenden`, `Hide "${s.title}"`)}><Icon name="eye" size={13} /></button>
        <button type="button" className="rc-ib" onClick={onRemove} aria-label={tr(`„${s.title}“ entfernen`, `Remove "${s.title}"`)}><Icon name="trash" size={13} /></button>
      </span>
      {i === 0 && <span id="rc-ol-help" className="sr">{tr('Alt+Pfeil hoch oder runter verschiebt den Abschnitt.', 'Alt+Arrow up or down moves the section.')}</span>}
    </Reorder.Item>
  );
}

// Placed on the composer's own layer (portal), fixed at the button: the outline column scrolls and would clip it (live
// 2026-11-24: the menu was cut off at the column edge and covered by the paper). Kept inside the window – below the button
// when there is room, above it otherwise.
function AddMenu({ catalog, present, onPick, onClose, anchor, container }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor?.current?.getBoundingClientRect();
      if (!r) return;
      const W = 290, M = 8, vw = window.innerWidth, vh = window.innerHeight;
      const left = Math.max(M, Math.min(r.left, vw - W - M));
      const below = vh - r.bottom - 6 - M, above = r.top - 6 - M;
      setPos(below >= Math.min(320, above) ? { left, top: r.bottom + 6, maxHeight: Math.max(160, below) } : { left, bottom: vh - r.top + 6, maxHeight: Math.max(160, above) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const away = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.rc-add')) onClose(); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);
  const keys = (e) => {
    const items = [...ref.current.querySelectorAll('button')];
    const k = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(k + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(k - 1 + items.length) % items.length]?.focus(); }
  };
  return createPortal(
    <motion.div ref={ref} className="rc-menu" role="menu" aria-label={tr('Abschnitt hinzufügen', 'Add section')} onKeyDown={keys}
      style={pos || { visibility: 'hidden' }} {...enter(0, { y: -4, scale: 0.98, d: 'quick' })}>
      {catalog.map((c) => {
        const has = present.includes(c.id) && c.id !== 'text';
        return (
          <button key={c.id} type="button" role="menuitem" className="rc-menu-item" onClick={() => onPick(c.id)} aria-label={has ? tr(`${c.title} – schon im Report, springt hin`, `${c.title} – already in the report, jumps there`) : c.title}>
            <span className="rc-menu-t">{c.title}{has && <Icon name="check" size={12} />}</span>
            <span className="rc-menu-d faint">{c.desc}</span>
          </button>
        );
      })}
    </motion.div>,
    container,
  );
}

// ---------- one section on the page ----------
function SectionView({ s, i, lang, active, problems, editorRef, onSelect, onText, onTitle, onRephrase, onHide, ai }) {
  const ed = useRef(null);
  const [facts, setFacts] = useState(false);
  useEffect(() => { editorRef(ed.current); }, [editorRef]);
  const d = s.data || {};
  const tw = TONE_WORD();
  const narrative = (
    <Narrative ref={ed} text={s.text} facts={s.facts} lang={lang} onChange={onText}
      label={tr(`Text von „${s.title}“`, `Text of "${s.title}"`)} placeholder={s.kind === 'text' ? tr('Schreib hier deine Notiz …', 'Write your note here …') : tr('Text leer – „Lotse: neu formulieren“ schreibt ihn wieder.', 'Text empty – "Lotse: rephrase" writes it again.')} />
  );
  return (
    <motion.section className={`rc-sec k-${s.kind} ${active ? 'is-active' : ''}`} data-section={s.id} tabIndex={-1} aria-labelledby={`rc-st-${s.id}`} onFocus={onSelect} onPointerDown={onSelect}
      {...enter(i, { y: 10, d: 'gentle' })}>
      <div className="rc-sec-head">
        <i className={`rc-bar-tone t-${s.tone || 'info'}`} aria-hidden="true" />
        <h2 id={`rc-st-${s.id}`} className="rc-sec-h"><span className="sr">{s.title}</span>
          <input className="rc-sec-title" value={s.title} onChange={(e) => onTitle(e.target.value)} aria-label={tr('Abschnittstitel', 'Section title')} />
        </h2>
        {s.kind !== 'text' && <span className={`rc-tone t-${s.tone || 'info'}`}>{tw[s.tone] || tw.info}</span>}
        <div className="rc-sec-tools">
          {s.variants?.length > 1 && <button type="button" className="btn btn-xs btn-ghost" onClick={onRephrase} title={tr('Andere Formulierung mit denselben geprüften Zahlen', 'Different wording with the same verified numbers')}><LotseMark size={13} />{tr('Lotse: neu formulieren', 'Lotse: rephrase')}</button>}
          {ai && <button type="button" className="btn btn-xs btn-ghost" onClick={ai.ask} disabled={ai.state?.phase === 'loading'}><Icon name="sparkle" size={12} />{tr('KI: formulieren', 'AI: write')}</button>}
          {s.facts?.length > 0 && (
            <span className="rc-facts-wrap">
              <button type="button" className="btn btn-xs btn-ghost" aria-expanded={facts} onClick={() => setFacts(!facts)}><Icon name="shield" size={12} />{tr('Zahl einfügen', 'Insert number')}</button>
              {facts && (
                <div className="rc-facts" role="menu" aria-label={tr('Geprüfte Zahlen', 'Verified numbers')} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setFacts(false); } }}>
                  {s.facts.slice(0, 40).map((f) => (
                    <button key={f.id} type="button" role="menuitem" className="rc-fact" onMouseDown={(e) => e.preventDefault()} onClick={() => { ed.current?.insertFact(f); setFacts(false); }}>
                      <span className="rc-chip">{f.display}</span><span className="faint">{f.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </span>
          )}
          <button type="button" className="rc-ib" onClick={onHide} aria-label={tr(`„${s.title}“ ausblenden`, `Hide "${s.title}"`)}><Icon name="eye" size={13} /></button>
        </div>
      </div>
      {s.kind !== 'risks' && narrative}
      {problems.length > 0 && (
        <p className="rc-problems" role="note"><Icon name="alert" size={12} />{tr(`Ohne Quelle: ${problems.map((p) => `„${p.text}“`).join(', ')}`, `No source: ${problems.map((p) => `"${p.text}"`).join(', ')}`)}{problems[0].expected ? tr(` – in den Daten: ${problems[0].expected}`, ` – in the data: ${problems[0].expected}`) : ''}</p>
      )}
      {ai?.state && <AiPanel st={ai.state} onAdopt={ai.adopt} onClose={ai.close} onRetry={ai.ask} />}
      <SectionData s={s} d={d} lang={lang} />
      {s.kind === 'risks' && <><div className="rc-decide eyebrow">{TL(lang, 'Zu entscheiden', 'Decisions needed')}</div>{narrative}</>}
    </motion.section>
  );
}

function SectionData({ s, d, lang }) {
  if (s.kind === 'kpis' && d.tiles) {
    return (
      <div className="rc-tiles">
        {d.tiles.map((t, k) => (
          <motion.div key={t.id} className={`rc-tile ${t.tone ? `t-${t.tone}` : ''}`} {...enter(k, { y: 6, d: 'gentle' })}>
            <div className="rc-tile-l">{t.label}</div>
            <div className={`rc-tile-v ${t.kind === 'text' ? 'is-text' : ''}`}>{t.display}</div>
            <div className="rc-tile-s faint">{t.sub}</div>
          </motion.div>
        ))}
      </div>
    );
  }
  if (s.kind === 'table') {
    if (!d.rows?.length) return <p className="rc-calm"><Icon name="check" size={14} />{d.empty}</p>;
    return (
      <div className="rc-table-wrap" tabIndex={0} role="region" aria-label={s.title}>
        <table className="rc-table">
          <thead><tr>{d.columns.map((c, k) => <th key={k} scope="col" className={d.align?.[k] === 'r' ? 'r' : d.align?.[k] === 'c' ? 'c' : ''}>{c || <span className="sr">{tr('Eintrag', 'Item')}</span>}</th>)}</tr></thead>
          <tbody>{d.rows.map((r, k) => <tr key={k}>{r.cells.map((c, j) => <td key={j} className={`${d.align?.[j] === 'r' ? 'r' : d.align?.[j] === 'c' ? 'c' : ''} ${j === r.cells.length - 1 ? `t-${r.tone}` : ''}`}>{j === 1 ? <b>{c}</b> : c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (s.kind === 'risks') {
    return (
      <ul className="rc-risks">
        {(d.items || []).map((it, k) => (
          <motion.li key={it.id} className={`rc-risk t-${it.tone}`} {...enter(k, { y: 0, x: -6, d: 'gentle' })}>
            <span className="rc-risk-t">{it.title}</span>
            {/* the same verified chips as the narrative, read-only */}
            <span className="rc-risk-x" dangerouslySetInnerHTML={{ __html: toHtml(it.text, s.facts) }} />
          </motion.li>
        ))}
      </ul>
    );
  }
  if (d.visual) {
    return (
      <div className="rc-visual">
        {s.kind === 'story' && d.kpis?.length > 0 && (
          <dl className="rc-figs">{d.kpis.slice(0, 4).map((k) => { const [n, u] = figure(k.unit, k.value, lang); return <div key={k.id} className={k.tone ? `t-${k.tone}` : ''}><dd className="num">{n}{u ? <small> {u}</small> : null}</dd><dt>{k.label}</dt></div>; })}</dl>
        )}
        {/* drawn like the PDF, in the report's language (not the app's) */}
        <ReportVisual visual={d.visual} lang={lang} label={s.title} />
      </div>
    );
  }
  return null;
}

function AiPanel({ st, onAdopt, onClose, onRetry }) {
  const cc = st.cc;
  const wrong = (cc?.claims || []).filter((c) => c.verified === false);
  return (
    <motion.div className="rc-ai" role="region" aria-label={tr('KI-Vorschlag mit Gegenprüfung', 'AI suggestion with cross-check')} aria-busy={st.phase === 'loading'} {...enter(0, { y: 6 })}>
      {st.phase === 'loading' && <div className="rc-ai-wait" aria-live="polite"><span className="rc-shimmer" aria-hidden="true" />{tr('Die KI formuliert aus denselben geprüften Zahlen …', 'The AI is writing from the same verified numbers …')}</div>}
      {st.phase === 'error' && <div className="rc-ai-err" role="alert"><Icon name="alert" size={13} />{errText(st.e)}<button type="button" className="btn btn-xs" onClick={onRetry}>{tr('Erneut', 'Retry')}</button></div>}
      {st.phase === 'done' && (
        <>
          <p className="rc-ai-text">{st.text || tr('Die KI war gerade nicht erreichbar – es gilt Lotses Text.', 'The AI was not reachable just now – Lotse\'s text applies.')}</p>
          {st.text && (
            <div className={`rc-ai-verdict ${wrong.length ? 'differs' : 'agrees'}`} role="status">
              <Icon name={wrong.length ? 'alert' : 'check'} size={13} />
              {wrong.length ? tr(`${wrong.length} ${wrong.length === 1 ? 'Angabe weicht' : 'Angaben weichen'} von den geprüften Zahlen ab: ${wrong.slice(0, 3).map((c) => `„${c.text}“${c.expected ? ` (geprüft: ${c.expected})` : ''}`).join(', ')}`, `${wrong.length} ${wrong.length === 1 ? 'claim differs' : 'claims differ'} from the verified numbers: ${wrong.slice(0, 3).map((c) => `"${c.text}"${c.expected ? ` (verified: ${c.expected})` : ''}`).join(', ')}`)
                : tr(`Gegenprüfung: ${(cc?.claims || []).length} Angaben stimmen mit den Daten überein.`, `Cross-check: ${(cc?.claims || []).length} claims match the data.`)}
            </div>
          )}
          <div className="rc-ai-acts">
            {st.text && <button type="button" className="btn btn-xs btn-dark" onClick={onAdopt}>{tr('Übernehmen', 'Use this text')}</button>}
            <button type="button" className="btn btn-xs btn-ghost" onClick={onClose}>{tr('Verwerfen', 'Discard')}</button>
            <span className="faint rc-ai-note">{tr('KI-generiert – geprüfte Zahlen werden beim Übernehmen zu Chips.', 'AI-generated – verified numbers become chips when you use it.')}</span>
          </div>
        </>
      )}
    </motion.div>
  );
}

function SheetSkeleton() {
  return (
    <div className="rc-sheet rc-skel" aria-hidden="true">
      <div className="rc-cover rc-skel-cover"><i /><i /></div>
      {[0, 1, 2].map((k) => <div key={k} className="rc-skel-sec"><i className="w30" /><i /><i /><i className="w70" /><div className="rc-skel-chart" /></div>)}
    </div>
  );
}
