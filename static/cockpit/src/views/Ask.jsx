import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { answer as answerQ, suggestions as suggest, closestQuestions, WISH_GROUP } from '@shared/ask.js';
import DataTable from '../components/DataTable.jsx';
import { useApp, errText } from '../state.jsx';
import { tr, fmt, getLang, ruleName } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call, openIssue } from '../lib/api.js';
import { Counter, Menu, Switch, useTip, infoCard } from '../components/ui.jsx';
import AiAssist from '../components/AiAssist.jsx';
import { requestSupportTab } from './Support.jsx';
import { useInsightsHistory } from '../lib/insightsHistory.js';
import { roleBoards, MAX_BOARDS, boardName } from '@shared/boards.js';
import { Columns, Donut, HBars, Heat, Line } from '../components/charts.jsx';
import Graph from '../components/Graph.jsx';
import { Md } from './Assistant.jsx';
import { aiOn } from '../lib/aiFlags.js';
import { openLotse } from '../components/lotse/open.js';
import { LotseMark } from '../components/lotse/LotseChip.jsx';
import { understand as lotseUnderstand } from '@shared/lotse/understand.js';
// whether Lotse itself understands a wish (then the AI's mapping teaches it nothing new)
const lotseKnows = (q, computed) => { try { return !!lotseUnderstand(q, { computed, ds: computed.model.ds, lang: getLang() }, {}).skill; } catch { return true; } };

// Ask: an infinite canvas of answers. Type or speak a question; each answer becomes a card you can
// move, resize, switch between chart types, open full screen and collect into a PDF.

const VIEW_META = {
  number: ['target', 'Zahl', 'Number'], list: ['layers', 'Liste', 'List'], table: ['grid', 'Tabelle', 'Table'], bar: ['ranking', 'Balken', 'Bars'],
  donut: ['gauge', 'Kreis', 'Donut'], columns: ['report', 'Säulen', 'Columns'], line: ['waves', 'Verlauf', 'Trend'], heat: ['grid', 'Heatmap', 'Heatmap'],
  graph: ['link', 'Netz', 'Network'], text: ['sparkle', 'Text', 'Text'],
};
const TONE = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', ink: 'var(--ink)', muted: 'var(--line-strong)' };
const fmtBy = (unit) => ({ pct: (v) => fmt.pct(v), h: (v) => fmt.h(v), n: (v) => fmt.n(v), signedPct: (v) => fmt.signedPct(v), rank: (v) => (v == null ? '–' : `#${v}`) }[unit] || ((v) => fmt.n(v, 1)));
const uid = () => Math.random().toString(36).slice(2, 10);
const MIN_W = 300, MAX_W = 1100;
const clampZ = (z) => Math.min(1.6, Math.max(0.25, z));
// The board as last left in this session (the startup preferences are older once you have asked something).
let board = null;
let savedBoards = null; // the saved boards as last changed in this session

// ---------- one card's body: the chosen view of the answer ----------
export function CardBody({ card, view, large, onRef, onKey, onAsk, onAskAi }) {
  const d = card.data || {};
  const H = large ? 1.9 : 1;
  switch (view) {
    case 'number': {
      const f = fmtBy(d.number?.unit);
      return (
        <div className="ask-number">
          <div className="ask-number-v" style={{ color: d.number?.tone === 'bad' ? 'var(--bad)' : undefined, fontSize: large ? 88 : 54 }}>{typeof d.number?.value === 'number' && d.number.unit !== 'rank' ? <Counter value={d.number.value} format={f} /> : f(d.number?.value)}</div>
          <div className="muted">{d.number?.foot}</div>
        </div>
      );
    }
    case 'list': return (
      <ul className="ask-list">
        {(d.list || []).map((x, i) => {
          const act = x.ref ? () => onRef?.(x.ref) : x.key ? () => onKey?.(x.key) : x.go ? () => onRef?.(null, x.go) : null;
          return (
            <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0, transition: { delay: Math.min(i * 0.03, 0.4) } }}>
              <i style={{ background: TONE[x.tone] || 'var(--ink)' }} />
              <div style={{ minWidth: 0 }}>{act ? <button className="linkbtn" onClick={act}>{x.text}</button> : <span>{x.text}</span>}{x.sub && <div className="faint ask-sub">{x.sub}</div>}</div>
            </motion.li>
          );
        })}
      </ul>
    );
    case 'table': return <DataTable head={d.table.head} rows={d.table.rows} large={large} />;
    case 'bar': return <AllBars card={card} large={large} onRef={onRef} />;
    case 'near': return (
      <div className="ask-near">
        <div className="ask-near-list">{(d.near || []).map((q) => <button key={q} type="button" className="ask-sugg" onClick={() => onAsk?.(q)}><Icon name="arrowRight" size={14} /><span>{q}</span></button>)}</div>
        {/* a wish the canvas has no card for: Lotse answers it as a Story (picture, findings, next step) – without AI */}
        {card.title && <button type="button" className="btn btn-sm lotse-chip ask-lotse" data-lotse-ask onClick={() => openLotse({ text: card.title })}><LotseMark size={14} />{tr('Lotse fragen – als Bild mit echten Zahlen', 'Ask Lotse – as a picture with real numbers')}</button>}
        {onAskAi && <button type="button" className="btn btn-ghost btn-sm" onClick={onAskAi}><Icon name="sparkle" size={13} />{tr('Trotzdem frei beantworten lassen (KI, bitte prüfen)', 'Answer it freely anyway (AI, please verify)')}</button>}
      </div>
    );
    case 'donut': return <Donut label={card.title} parts={d.parts || []} format={fmtBy(d.partsUnit || 'n')} size={large ? 260 : 150} center={fmtBy(d.partsUnit || 'n')((d.parts || []).reduce((a, p) => a + (p.value || 0), 0))} />;
    case 'columns': return <Columns label={card.title} labels={d.columns.labels} series={d.columns.series} format={fmtBy(d.columns.unit)} height={170 * H} />;
    case 'line': return <Line label={card.title} labels={d.line.labels} series={d.line.series} target={d.line.target} domain={d.line.domain} format={fmtBy(d.line.unit)} height={150 * H} />;
    case 'heat': return <Heat label={card.title} rows={d.heat.rows} cols={d.heat.cols} />;
    case 'graph': return <Graph graph={d.graph} height={large ? '100%' : 300} label={card.title} onPick={(ref) => onRef?.(ref)} />;
    default: return card.text ? <div className="ask-text"><Md text={card.text} /></div> : null;
  }
}

// Bars: the first 14 (40 large), with "x of N – show all" instead of a silent cut.
function AllBars({ card, large, onRef }) {
  const d = card.data || {};
  const all = d.series || [];
  const lim = large ? 40 : 14;
  const [more, setMore] = useState(false);
  const items = more ? all : all.slice(0, lim);
  return (
    <div>
      <HBars large={large} label={card.title} items={items} format={fmtBy(d.unit)} max={d.max} onPick={(it) => it.ref && onRef?.(it.ref)} />
      {all.length > lim && <button type="button" className="btn btn-ghost btn-xs ask-more" onClick={() => setMore(!more)}>{more ? tr('Weniger zeigen', 'Show fewer') : tr(`${lim} von ${all.length} – alle zeigen`, `${lim} of ${all.length} – show all`)}</button>}
    </div>
  );
}

// Can this element (or one above it, inside the card) scroll further in the wheel's direction?
function scrollsInside(target, stop, dx, dy) {
  for (let el = target; el && el !== stop; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (dy && /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0)) return true;
    if (dx && /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0)) return true;
  }
  return false;
}
// Card height before it is measured (so a burst of questions never stacks cards on top of each other).
const EST_H = { table: 450, graph: 390, heat: 360, columns: 330, line: 310, bar: 340, list: 330, donut: 300, number: 230, near: 260, text: 220 };

// ---------- the view ----------
export default function Ask() {
  const app = useApp();
  const { computed, ds, boot, roles, lang, setView, askQ, toast, pushUndo, config } = app;
  const aiAsk = aiOn(config, 'ask'); // free AI answers only when an admin switched AI on
  const aiIntent = aiOn(config, 'intent'); // a wish the rules cannot map: the AI may pick one card (else the closest questions)
  const saved = board || boot.prefs?.ask;
  const [cards, setCards] = useState(() => (saved?.cards || []).map((c) => ({ ...c })));
  const [cam, setCam] = useState(saved?.cam || { x: 0, y: 0, z: 1 });
  const [simple, setSimple] = useState(!!saved?.simple);
  const [boardNm, setBoardNm] = useState(saved?.name || '');
  const [boards, setBoards] = useState(() => savedBoards || boot.prefs?.askBoards || []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const [epoch, setEpoch] = useState(0); // a new epoch removes every card at once (no exit animation to wait for)
  const stageRef = useRef(null);
  const sizes = useRef(new Map()); // measured card heights
  const [stageH, setStageH] = useState(600);
  const supportA = computed?.supportA || null;
  const hasSupport = !!(supportA || computed?.support);
  // "Ich will …" cards learn from done work: the history (done stories, resolved tickets – read as the user) is loaded
  // once, the first time such a card is on the canvas. Until then those cards compute from the current data and say so.
  const [wantHist, setWantHist] = useState(false);
  const hist = useInsightsHistory(wantHist);
  const ctx = useMemo(() => computed && ({ computed, ds, lang: getLang(), fmt, ruleName, me: boot.me, roles, supportA, cal: ds?.config?.support?.sla, history: hist.data, historyState: hist.state }), [computed, ds, lang, boot.me, roles, supportA, hist]); // eslint-disable-line react-hooks/exhaustive-deps
  // Cards are stored as questions; the answers are recomputed from live data (and in the current language).
  const answers = useMemo(() => {
    const m = new Map();
    if (!ctx) return m;
    for (const c of cards) {
      if (c.ai != null) { m.set(c.id, { title: c.title || c.q, answer: '', text: c.ai, views: ['text'], data: {}, intent: 'ai', source: c.source }); continue; }
      try { m.set(c.id, answerQ(c.q, ctx, c.force ? { force: c.force } : undefined) || { title: c.q, intent: 'near', answer: tr('Dazu habe ich keine Auswertung – meintest du eine dieser Fragen?', 'I have no analysis for that – did you mean one of these?'), views: ['near'], view: 'near', data: { near: closestQuestions(c.q, ctx) } }); } catch { m.set(c.id, { title: c.q, answer: tr('Fehler beim Berechnen.', 'Could not compute.'), views: ['text'], data: {} }); }
    }
    return m;
  }, [cards, ctx]);
  const wantsHistory = useMemo(() => [...answers.values()].some((a) => a?.needsHistory), [answers]);
  useEffect(() => { if (wantsHistory) setWantHist(true); }, [wantsHistory]);
  const sugg = useMemo(() => (computed ? suggest({ computed, roles, me: boot.me, lang: getLang(), supportA, hasSupport }) : []), [computed, roles, boot.me, lang, supportA, hasSupport]); // eslint-disable-line react-hooks/exhaustive-deps

  // persistence (per user, questions + layout only)
  useEffect(() => {
    board = { cards: cards.filter((c) => !c.pending), cam, simple, name: boardNm };
    const t = setTimeout(() => {
      call('prefs.save', { ask: { cards: cards.filter((c) => !c.pending).map(({ id, q, x, y, w, view, sel, ai, title, source, auto, force }) => ({ id, q, x, y, w, view, sel: !!sel, auto: !!auto, ...(force ? { force } : {}), ...(ai != null ? { ai, title, source } : {}) })), cam, simple, name: boardNm } }).catch(() => {});
    }, 900);
    return () => clearTimeout(t);
  }, [cards, cam, simple, boardNm]);
  // simplicity mode hides the other areas of the app
  useEffect(() => { document.body.classList.toggle('pc-simple', simple); return () => document.body.classList.remove('pc-simple'); }, [simple]);
  // the stage fills the rest of the window
  useLayoutEffect(() => {
    const fit = () => { const top = stageRef.current?.getBoundingClientRect().top || 0; setStageH(Math.max(420, window.innerHeight - top - 8)); };
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [simple]);

  const stageSize = () => { const r = stageRef.current?.getBoundingClientRect(); return { w: r?.width || 1000, h: r?.height || 600 }; };
  const visible = () => { const { w, h } = stageSize(); return { x: -cam.x / cam.z, y: -cam.y / cam.z, w: w / cam.z, h: h / cam.z }; };
  // the card's real height on the page first (live 2026-11-24, big data: the size reports could arrive too late and the
  // layout used the estimate – a 857 px card overlapped the cards below), then the last report, then the estimate
  const heightOf = (c) => { const el = typeof document !== 'undefined' ? stageRef.current?.querySelector(`[data-card="${c.id}"]`) : null; return (el && !el.closest('.ask-feed') ? el.offsetHeight : 0) || sizes.current.get(c.id) || EST_H[c.view] || 320; };
  // the newest cards, also those added in the same moment (state updates arrive later than a fast second question)
  const cardsRef = useRef(cards);
  cardsRef.current = cards; // every render: the current cards (ask() appends at once for questions fired in the same moment)
  const recent = useRef([]);

  // New cards flow in rows (in canvas coordinates, independent of where the camera is).
  const place = (w) => {
    const rowW = Math.max(960, stageSize().w - 80);
    const list = cardsRef.current;
    const last = list.at(-1) || null;
    if (!last) { const v = visible(); return { x: Math.round(v.x + 40), y: Math.round(v.y + 40) }; }
    const rowTop = last.y;
    const x0 = Math.min(...list.map((c) => c.x));
    // the row's lowest card decides where the next row starts (measured or estimated height)
    if (last.x + last.w + 32 + w <= x0 + rowW) return { x: last.x + last.w + 32, y: rowTop };
    return { x: x0, y: Math.round(Math.max(...list.map((c) => c.y + heightOf(c))) + 32) };
  };
  const reveal = (c, h = 340) => {
    const now = Date.now();
    recent.current = [...recent.current.filter((x) => now - x.t < 2500), { t: now, c }];
    if (recent.current.length > 1) { const batch = recent.current.map((x) => x.c); setTimeout(() => fitAll(batch, 0.55), 30); return; }
    const { w, h: sh } = stageSize();
    const sx = c.x * cam.z + cam.x, sy = c.y * cam.z + cam.y;
    if (sx < 0 || sy < 0 || sx + c.w * cam.z > w || sy + h * cam.z > sh - 120) setCam((k) => ({ ...k, x: Math.round(w / 2 - (c.x + c.w / 2) * k.z), y: Math.round(90 - c.y * k.z) }));
  };

  const ask = useCallback(async (question) => {
    const q = String(question || '').trim().slice(0, 300);
    if (!q || !ctx) return;
    setDraft('');
    let a = null;
    try { a = answerQ(q, ctx); } catch { a = null; }
    const v0 = a?.views?.[0] || 'near';
    const w = v0 === 'graph' || v0 === 'heat' || v0 === 'table' || v0 === 'columns' ? 620 : 440;
    const pos = place(w);
    // answerable → computed from the data; otherwise the closest answerable questions (the AI only on request)
    const c = { id: uid(), q, ...pos, w, view: a ? a.view : 'near', sel: false, auto: true, ...(!a && aiIntent ? { pending: true } : {}) };
    cardsRef.current = [...cardsRef.current, c];
    setCards((cs) => [...cs, c]); setFocusId(c.id); reveal(c);
    if (!a && aiIntent) mapWish(c.id, q);
  }, [ctx, cards, cam, aiIntent]); // eslint-disable-line react-hooks/exhaustive-deps
  // The rules found no card: the AI may pick ONE card of the catalogue (validated on the server; teams and projects only
  // from this user's data). It never computes anything – the card is the app's own. No card → the closest questions.
  const mapWish = async (id, q) => {
    try {
      const r = await call('ai.assist', { feature: 'intent', lang: getLang(), wish: q, lotseMissed: !lotseKnows(q, computed),
        teams: [...computed.model.teams.values()].filter((t) => t.id !== '_none').map((t) => ({ id: t.id, name: t.name })),
        projects: computed.model.items.slice(0, 40).map((x) => ({ ref: x.ref, key: x.key, name: x.name, rank: x.rank })) });
      if (r?.card) update(id, { pending: false, view: undefined, force: { intent: r.card, team: r.teamId || null, project: r.projectRef || null, text: r.subject || null, by: r.source === 'ai' ? 'ai' : 'rule', why: r.why || '' } });
      else update(id, { pending: false });
    } catch { update(id, { pending: false }); }
  };
  // Free answer by the AI for one card – only when the person asks for it (from data this person may see).
  const askAi = useCallback(async (id) => {
    const c = cardsRef.current.find((x) => x.id === id);
    if (!c) return;
    update(id, { ai: '', title: c.q, pending: true, view: 'text' }); setBusy(true);
    try {
      const r = await call('ai.ask', { question: c.q, lang: getLang() });
      update(id, { ai: String(r.text || '').slice(0, 4000), source: r.source, pending: false });
    } catch (e) {
      update(id, { ai: errText(e), source: 'error', pending: false });
    } finally { setBusy(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // a question handed over from the search palette or the top bar
  const handled = useRef(null);
  useEffect(() => { if (askQ && handled.current !== askQ.at && ctx) { handled.current = askQ.at; ask(askQ.q); } }, [askQ, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  const settleT = useRef(null);
  const settle = () => {
    clearTimeout(settleT.current);
    // E2E 2026-11-20 ("a burst of questions … 1 overlap"): the old loop re-sorted the list while walking it and could skip
    // a card. Now: full passes until nothing moves – every auto card that sits on (or below the top of) a card it overlaps
    // goes below it. Cards someone placed by hand stay where they are.
    settleT.current = setTimeout(() => setCards((cs) => {
      let changed = false;
      const next = cs.map((c) => ({ ...c }));
      for (let pass = 0; pass < 24; pass++) {
        let moved = false;
        const order = [...next].sort((a, b) => a.y - b.y || a.x - b.x);
        for (let i = 0; i < order.length; i++) {
          const a = order[i], ha = heightOf(a);
          for (let j = i + 1; j < order.length; j++) {
            const b = order[j];
            if (!b.auto || b.x >= a.x + a.w || a.x >= b.x + b.w || b.y < a.y || b.y >= a.y + ha + 24) continue;
            b.y = Math.round(a.y + ha + 32); moved = changed = true;
          }
        }
        if (!moved) break;
      }
      return changed ? next : cs;
    }), 60);
  };
  const update = (id, patch) => setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c)));
  const remove = (id) => {
    const i = cards.findIndex((c) => c.id === id), c = cards[i];
    setCards((cs) => cs.filter((x) => x.id !== id));
    const entry = pushUndo(tr('Karte entfernt', 'card removed'), async () => setCards((cs) => [...cs.slice(0, i), c, ...cs.slice(i)]), [`card:${id}`]);
    toast({ text: tr('Karte entfernt', 'Card removed'), icon: 'trash', undo: () => app.runUndo(entry) });
  };
  const clearAll = () => {
    const prev = cards, prevName = boardNm;
    setCards([]); setEpoch((e) => e + 1); setBoardNm('');
    const entry = pushUndo(tr('Leinwand geleert', 'canvas cleared'), async () => { setCards(prev); setEpoch((e) => e + 1); setBoardNm(prevName); }, ['canvas', ...prev.map((x) => `card:${x.id}`)]);
    toast({ text: tr('Leinwand geleert', 'Canvas cleared'), icon: 'trash', undo: () => app.runUndo(entry) });
  };

  // ---------- boards: role templates and saved boards (questions + layout; the numbers are always live) ----------
  const templates = useMemo(() => (computed ? roleBoards({ computed, me: boot.me, roles, lang: getLang(), hasSupport }) : []), [computed, boot.me, roles, lang, hasSupport]); // eslint-disable-line react-hooks/exhaustive-deps
  // questions → cards in a masonry that fits the screen (wide charts span two columns)
  const layoutQuestions = (qs) => {
    const { w } = stageSize();
    const cols = Math.max(1, Math.min(3, Math.floor((w - 40) / 492)));
    const colY = new Array(cols).fill(40), colX = Array.from({ length: cols }, (_, i) => 40 + i * 492);
    return qs.map((q) => {
      let a = null; try { a = answerQ(q, ctx); } catch { a = null; }
      const view = a ? a.view : 'near';
      const big = ['graph', 'heat', 'table', 'columns'].includes(view);
      const k = colY.indexOf(Math.min(...colY));
      const wide = big && cols > 1 && k < cols - 1;
      const y = wide ? Math.max(colY[k], colY[k + 1]) : colY[k];
      const c = { id: uid(), q, x: colX[k], y, w: wide ? 952 : 460, view, sel: false, auto: true };
      colY[k] = y + (EST_H[view] || 320) + 28; if (wide) colY[k + 1] = colY[k];
      return c;
    });
  };
  const openBoard = (b) => {
    if (!ctx) return;
    const prev = cards, prevName = boardNm, prevCam = cam;
    const next = b.cards ? b.cards.map((c) => ({ ...c, id: uid() })) : layoutQuestions(b.questions);
    setCards(next); setEpoch((e) => e + 1); setBoardNm(b.name);
    if (b.cam && b.cards) setCam(b.cam); else setTimeout(() => fitAll(next, 0.45), 60);
    // settle once the cards are on the page with their answers (heights measured there), and once more when charts are drawn
    setTimeout(settle, 400); setTimeout(settle, 1500);
    // undo swaps the whole canvas back – a new epoch, like opening: the board's cards must not wait for exit animations
    // (live 2026-11-24: in the Jira frame they stalled and stayed – 11 cards instead of the 5 from before)
    const entry = pushUndo(tr(`Board „${b.name}“ geöffnet`, `board "${b.name}" opened`), async () => { setCards(prev); setEpoch((e) => e + 1); setBoardNm(prevName); setCam(prevCam); }, ['canvas', ...prev.map((x) => `card:${x.id}`)]);
    toast({ text: tr(`Board „${b.name}“ · ${next.length} Karten mit den Zahlen von jetzt`, `Board "${b.name}" · ${next.length} cards with today's numbers`), icon: 'layers', undo: () => app.runUndo(entry) });
  };
  const storeBoards = (list) => { savedBoards = list; setBoards(list); return call('prefs.save', { askBoards: list }); };
  const saveBoard = async (rawName) => {
    const name = boardName(rawName);
    if (!name || !cards.length) return;
    const prev = boards;
    const snap = { name, cards: cards.filter((c) => !c.pending).map(({ id, q, x, y, w, view, ai, title, source }) => ({ id, q, x, y, w, view, sel: false, auto: false, ...(ai != null ? { ai, title, source } : {}) })), cam, at: new Date().toISOString() };
    const same = prev.find((b) => b.name.toLowerCase() === name.toLowerCase());
    if (!same && prev.length >= MAX_BOARDS) { toast({ text: tr(`Höchstens ${MAX_BOARDS} Boards – bitte zuerst eines löschen.`, `At most ${MAX_BOARDS} boards – please delete one first.`), error: true }); return; }
    const list = same ? prev.map((b) => (b.id === same.id ? { ...snap, id: same.id } : b)) : [...prev, { ...snap, id: uid() }];
    try {
      await storeBoards(list); setBoardNm(name);
      const entry = pushUndo(tr(`Board „${name}“ gespeichert`, `board "${name}" saved`), async () => { await storeBoards(prev); }, ['boards']);
      toast({ text: same ? tr(`Board „${name}“ aktualisiert`, `Board "${name}" updated`) : tr(`Board „${name}“ gespeichert – öffnet immer mit den aktuellen Zahlen`, `Board "${name}" saved – always opens with today's numbers`), icon: 'check', undo: () => app.runUndo(entry) });
    } catch (e) { toast({ text: errText(e), error: true }); }
  };
  const deleteBoard = async (b) => {
    const prev = boards;
    try {
      await storeBoards(prev.filter((x) => x.id !== b.id));
      const entry = pushUndo(tr(`Board „${b.name}“ gelöscht`, `board "${b.name}" deleted`), async () => { await storeBoards(prev); }, ['boards']);
      toast({ text: tr(`Board „${b.name}“ gelöscht`, `Board "${b.name}" deleted`), icon: 'trash', undo: () => app.runUndo(entry) });
    } catch (e) { toast({ text: errText(e), error: true }); }
  };

  // ---------- camera: drag the background to pan, wheel to pan, Ctrl/⌘ + wheel or pinch to zoom ----------
  const zoomAt = (nz, px, py) => setCam((k) => { const z = clampZ(nz); return { x: px - ((px - k.x) * z) / k.z, y: py - ((py - k.y) * z) / k.z, z }; });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const h = (e) => {
      if (e.target.closest?.('.ask-composer, .ask-feed') || scrollsInside(e.target, el, e.deltaX, e.deltaY)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) setCam((k) => { const z = clampZ(k.z * Math.exp(-e.deltaY * 0.0022)); const px = e.clientX - r.left, py = e.clientY - r.top; return { x: px - ((px - k.x) * z) / k.z, y: py - ((py - k.y) * z) / k.z, z }; });
      else setCam((k) => ({ ...k, x: k.x - e.deltaX, y: k.y - e.deltaY }));
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);
  const pan = useRef(null);
  const onStageDown = (e) => {
    if (simple || e.button !== 0 || (e.target !== e.currentTarget && !e.target.classList.contains('ask-world'))) return;
    pan.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    setFocusId(null);
  };
  const onStageMove = (e) => { if (pan.current) setCam((k) => ({ ...k, x: pan.current.cx + e.clientX - pan.current.x, y: pan.current.cy + e.clientY - pan.current.y })); };
  const onStageUp = () => { pan.current = null; };

  const fitAll = (list = cards, minZ = 0.25) => {
    if (!list.length) { setCam({ x: 0, y: 0, z: 1 }); return; }
    const { w, h } = stageSize();
    const x0 = Math.min(...list.map((c) => c.x)), y0 = Math.min(...list.map((c) => c.y));
    const x1 = Math.max(...list.map((c) => c.x + c.w)), y1 = Math.max(...list.map((c) => c.y + heightOf(c)));
    const z = clampZ(Math.max(minZ, Math.min(1, (w - 80) / (x1 - x0), (h - 200) / (y1 - y0))));
    setCam({ z, x: Math.round((w - (x1 - x0) * z) / 2 - x0 * z), y: Math.round(40 - y0 * z) });
  };
  // Tidy: a masonry of columns that fits the screen width.
  const tidy = () => {
    const { w } = stageSize();
    const cols = Math.max(1, Math.floor((w / cam.z - 40) / 492));
    const colY = new Array(cols).fill(40), colX = Array.from({ length: cols }, (_, i) => 40 + i * 492);
    const next = cards.map((c) => {
      const k = colY.indexOf(Math.min(...colY));
      const wide = c.w > 560 && k < cols - 1;
      const y = wide ? Math.max(colY[k], colY[k + 1]) : colY[k];
      const n = { ...c, x: colX[k], y, w: wide ? 952 : 460 };
      colY[k] = y + heightOf(c) + 28; if (wide) colY[k + 1] = colY[k];
      return n;
    });
    setCards(next);
    setTimeout(() => fitAll(next), 50);
  };

  const selected = cards.filter((c) => c.sel);
  const exportPdf = async () => {
    const list = (selected.length ? selected : cards).map((c) => ({ ...answers.get(c.id), q: c.q, view: c.view }));
    try { const { downloadAskPdf } = await import('../lib/askPdf.js'); await downloadAskPdf(list, { me: boot.me }); toast({ text: tr('PDF erstellt', 'PDF created'), icon: 'pdf' }); }
    catch (e) { toast({ text: errText(e), error: true }); }
  };
  const onRef = (ref, go) => {
    if (go?.startsWith('support:')) { requestSupportTab(go.slice(8)); setView('support'); }
    else if (go) setView(go); else if (ref) setView('project', { ref });
  };
  // a starter that needs the user's own words ("… wie früher: ") goes into the input instead of being asked
  const start = (s) => { if (/:\s*$/.test(s.q)) { setDraft(s.q); setTimeout(() => document.querySelector('.ask-input input')?.focus(), 30); } else ask(s.q); };

  if (!computed) return null;
  const empty = cards.length === 0;
  const groups = [...new Set(sugg.map((s) => s.group))];
  const wishGroup = getLang() === 'de' ? WISH_GROUP.de : WISH_GROUP.en;
  return (
    <div className={`ask-root ${simple ? 'simple' : ''}`}>
      <div className="ask-toolbar">
        <div className="row" style={{ gap: 6 }}>
          <BoardMenu name={boardNm} templates={templates} boards={boards} canSave={!empty} onOpen={openBoard} onSave={saveBoard} onDelete={deleteBoard} />
          {!simple && <>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => { const { w, h } = stageSize(); zoomAt(cam.z / 1.2, w / 2, h / 2); }} aria-label={tr('Verkleinern', 'Zoom out')}><Icon name="down" /></button>
            <button className="btn btn-ghost btn-sm num" style={{ minWidth: 56 }} onClick={() => setCam((k) => ({ ...k, z: 1 }))} title={tr('Auf 100 % setzen', 'Reset to 100%')}>{Math.round(cam.z * 100)} %</button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => { const { w, h } = stageSize(); zoomAt(cam.z * 1.2, w / 2, h / 2); }} aria-label={tr('Vergrößern', 'Zoom in')}><Icon name="up" /></button>
            <button className="btn btn-ghost btn-sm" onClick={() => fitAll()} disabled={empty}><Icon name="target" />{tr('Alles zeigen', 'Show all')}</button>
            <button className="btn btn-ghost btn-sm" onClick={tidy} disabled={empty}><Icon name="grid" />{tr('Aufräumen', 'Tidy up')}</button>
          </>}
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Switch on={simple} onChange={setSimple} label={tr('Einfache Ansicht', 'Simple view')} />
          {!empty && <>
            {!simple && <button className="btn btn-ghost btn-sm" onClick={() => setCards((cs) => cs.map((c) => ({ ...c, sel: selected.length !== cs.length })))}><Icon name="check" />{selected.length === cards.length ? tr('Keine wählen', 'Select none') : tr('Alle wählen', 'Select all')}</button>}
            <button className="btn btn-sm btn-primary" onClick={exportPdf}><Icon name="pdf" />{selected.length ? tr(`PDF · ${selected.length} Karten`, `PDF · ${selected.length} cards`) : tr('PDF · alle Karten', 'PDF · all cards')}</button>
            {!simple && <button className="btn btn-ghost btn-icon btn-sm" onClick={clearAll} aria-label={tr('Leinwand leeren', 'Clear canvas')} title={tr('Leinwand leeren', 'Clear canvas')}><Icon name="trash" /></button>}
          </>}
        </div>
      </div>

      <div ref={stageRef} className="ask-stage" style={{ height: stageH, backgroundPosition: `${cam.x}px ${cam.y}px`, backgroundSize: `${24 * cam.z}px ${24 * cam.z}px` }}
        onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerCancel={onStageUp} role="application" aria-label={tr('Leinwand mit Antworten', 'Canvas of answers')}>
        {simple && !empty ? (
          // Simple view: the newest answer on top, large, in one scrolling column – no canvas to steer.
          <div className="ask-feed">
            <AnimatePresence initial={false}>
              {[...cards].reverse().map((c) => (
                <AskCard key={c.id} c={c} a={answers.get(c.id)} z={1} simple flow focused={false} onAsk={ask} onAskAi={aiAsk ? () => askAi(c.id) : undefined}
                  onFocus={() => {}} onChange={(p) => update(c.id, p)} onRemove={() => remove(c.id)} onFull={() => setFull(c.id)} onSize={() => {}} onRef={onRef} />
              ))}
            </AnimatePresence>
          </div>
        ) : null}
        {/* --inv keeps the card controls at least 24 px on screen however far the canvas is zoomed out (WCAG 2.2 target size) */}
        <div key={epoch} className="ask-world" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`, display: simple ? 'none' : undefined, '--inv': Math.max(1, 0.8 / cam.z) }}>
          <AnimatePresence>
            {cards.map((c) => (
              <AskCard key={c.id} c={c} a={answers.get(c.id)} z={cam.z} simple={simple} focused={focusId === c.id} onAsk={ask} onAskAi={aiAsk ? () => askAi(c.id) : undefined}
                onFocus={() => setFocusId(c.id)} onChange={(p) => update(c.id, p)} onRemove={() => remove(c.id)} onFull={() => setFull(c.id)}
                onSize={(h) => { if (Math.abs((sizes.current.get(c.id) || 0) - h) > 4) { sizes.current.set(c.id, h); settle(); } }} onRef={onRef} />
            ))}
          </AnimatePresence>
        </div>
        {empty && (
          <div className="ask-hero-wrap"><motion.div className="ask-hero" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <motion.div className="ask-hero-mark" animate={{ rotate: [0, 10, -6, 0] }} transition={{ duration: 4, repeat: Infinity }}><Icon name="sparkle" size={26} /></motion.div>
            <h1>{tr('Was willst du sehen?', 'What do you want to see?')}</h1>
            <p className="muted">{tr('Sag einfach „Ich will …“ oder frag in deinen Worten – getippt oder gesprochen. Jede Antwort landet als Karte auf dieser Leinwand: verschieben, als Diagramm umschalten, groß ansehen und als PDF teilen.', 'Just say "I want …" or ask in your own words – typed or spoken. Every answer lands as a card on this canvas: move it, switch the chart, view it large and share it as a PDF.')}</p>
            <div className="ask-boards" role="group" aria-label={tr('Boards für deine Rolle', 'Boards for your role')}>
              {[...templates, ...boards.map((b) => ({ ...b, saved: true, icon: 'bookmark', desc: tr(`${b.cards.length} Karten · gespeichert`, `${b.cards.length} cards · saved`) }))].slice(0, 6).map((b, i) => (
                <motion.button key={b.id} type="button" className={`ask-board ${b.recommended ? 'rec' : ''}`} onClick={() => openBoard(b)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.04 * i } }}>
                  <span className="ask-board-ic"><Icon name={b.icon} size={16} /></span>
                  <span className="ask-board-t"><b>{b.name}{b.recommended && <span className="chip chip-outline">{tr('für dich', 'for you')}</span>}</b><span className="faint">{b.desc}</span></span>
                  <span className="faint num">{(b.questions || b.cards).length}</span>
                </motion.button>
              ))}
            </div>
            <div className="ask-sugg-groups">
              {groups.map((g) => (
                <div key={g}>
                  <div className="label">{g}</div>
                  <div className="stack" style={{ gap: 6 }}>{sugg.filter((s) => s.group === g).slice(0, g === wishGroup ? 5 : 4).map((s, i) => (
                    <motion.button key={s.q} className={`ask-sugg ${g === wishGroup ? 'wish' : ''}`} onClick={() => start(s)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.05 * i } }}><Icon name={s.icon || 'arrowRight'} size={15} /><span>{s.q}</span></motion.button>
                  ))}</div>
                </div>
              ))}
            </div>
          </motion.div></div>
        )}
        <div className="ask-fade" aria-hidden="true" />
        <Composer draft={draft} setDraft={setDraft} onAsk={ask} busy={busy} simple={simple} chips={empty ? [] : sugg.filter((s) => !cards.some((c) => c.q === s.q)).slice(0, simple ? 3 : 4)} />
      </div>
      <FullScreen card={full ? cards.find((c) => c.id === full) : null} a={full ? answers.get(full) : null} onClose={() => setFull(null)} onView={(v) => update(full, { view: v })} onRef={(r, g) => { setFull(null); onRef(r, g); }} />
    </div>
  );
}

// ---------- boards menu: role templates, saved boards, save the current one ----------
function BoardMenu({ name, templates, boards, canSave, onOpen, onSave, onDelete }) {
  const [anchor, setAnchor] = useState(null);
  const [nm, setNm] = useState('');
  const close = useCallback(() => setAnchor(null), []);
  const open = (e) => { setNm(name || ''); setAnchor(anchor ? null : e.currentTarget); };
  const pick = (b) => { close(); onOpen(b); };
  const submit = (e) => { e.preventDefault(); if (boardName(nm)) { close(); onSave(nm); } };
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm ask-board-btn" onClick={open} aria-haspopup="menu" aria-expanded={!!anchor}>
        <Icon name="layers" />{name ? <span className="ask-board-name">{name}</span> : tr('Boards', 'Boards')}<Icon name="down" size={12} />
      </button>
      <Menu anchor={anchor} onClose={close} align="start">
        <div className="ask-menu">
          <div className="label">{tr('Für deine Rolle – immer mit den Zahlen von jetzt', 'For your role – always with today\'s numbers')}</div>
          {templates.map((b) => (
            <button key={b.id} type="button" role="menuitem" className="menu-item" onClick={() => pick(b)}>
              <Icon name={b.icon} size={15} /><span className="grow"><b>{b.name}</b>{b.recommended && <span className="chip chip-outline" style={{ marginLeft: 6 }}>{tr('für dich', 'for you')}</span>}<br /><span className="faint">{b.desc}</span></span><span className="faint num">{b.questions.length}</span>
            </button>
          ))}
          <div className="label" style={{ marginTop: 8 }}>{tr('Gespeichert', 'Saved')} <span className="faint num">{boards.length}/{MAX_BOARDS}</span></div>
          {boards.length === 0 && <div className="faint" style={{ padding: '4px 10px 8px', fontSize: 12 }}>{tr('Noch keine – speichere die aktuelle Leinwand unten.', 'None yet – save the current canvas below.')}</div>}
          {boards.map((b) => (
            <div key={b.id} className="row ask-menu-saved">
              <button type="button" role="menuitem" className="menu-item" onClick={() => pick(b)}><Icon name="bookmark" size={15} /><span className="grow">{b.name}</span><span className="faint num">{b.cards.length}</span></button>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => onDelete(b)} aria-label={tr(`Board „${b.name}“ löschen`, `Delete board "${b.name}"`)}><Icon name="trash" size={14} /></button>
            </div>
          ))}
          <form className="ask-menu-save" onSubmit={submit}>
            <input className="input input-sm" value={nm} maxLength={60} onChange={(e) => setNm(e.target.value)} placeholder={tr('Name, z. B. Montagsrunde', 'Name, e.g. Monday review')} aria-label={tr('Name des Boards', 'Board name')} disabled={!canSave} />
            <button type="submit" className="btn btn-sm btn-dark" disabled={!canSave || !boardName(nm)}>{boards.some((b) => b.name.toLowerCase() === boardName(nm).toLowerCase()) ? tr('Aktualisieren', 'Update') : tr('Speichern', 'Save')}</button>
          </form>
          {!canSave && <div className="faint" style={{ padding: '0 10px 6px', fontSize: 12 }}>{tr('Stelle zuerst eine Frage – dann lässt sich die Leinwand speichern.', 'Ask a question first – then the canvas can be saved.')}</div>}
        </div>
      </Menu>
    </>
  );
}

// ---------- a card on the canvas ----------
function AskCard({ c, a, z, simple, flow, focused, onFocus, onChange, onRemove, onFull, onSize, onRef, onAsk, onAskAi }) {
  const tip = useTip();
  const ref = useRef(null);
  const drag = useRef(null);
  // observe the size once the card is really there: without its answer the card renders nothing (live 2026-11-24, big
  // data: answers came after the first render, no observer was ever attached, the canvas never learned the real heights
  // and a 857 px card kept the estimate – the cards below it overlapped)
  const shown = !!a;
  useLayoutEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(() => onSize(ref.current?.offsetHeight || 0));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return null;
  const view = a.views.includes(c.view) ? c.view : a.views[0];
  const start = (mode) => (e) => {
    if (e.button !== 0) return;
    e.stopPropagation(); onFocus();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, x: c.x, y: c.y, w: c.w };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.sx) / z, dy = (e.clientY - d.sy) / z;
    if (d.mode === 'move') onChange({ x: Math.round(d.x + dx), y: Math.round(d.y + dy), auto: false });
    else onChange({ w: Math.round(Math.min(MAX_W, Math.max(MIN_W, d.w + dx))) });
  };
  const end = () => { drag.current = null; };
  const key = (e) => {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? 80 : 20;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv && e.altKey) { e.preventDefault(); onChange({ x: c.x + mv[0], y: c.y + mv[1], auto: false }); }
    else if (e.key === 'Delete') { e.preventDefault(); onRemove(); }
    else if (e.key === 'Enter') { e.preventDefault(); onFull(); }
  };
  const tone = TONE[a.tone] || 'var(--line-strong)';
  return (
    <motion.article ref={ref} layout={flow ? 'position' : undefined} data-card={c.id} className={`ask-card ${flow ? 'flow' : ''} ${focused ? 'focused' : ''} ${c.sel ? 'sel' : ''}`} style={flow ? undefined : { left: c.x, top: c.y, width: c.w }} tabIndex={0} onKeyDown={key}
      // zoomed out, the whole card is the handle (the header is too small to grab)
      onPointerDown={(e) => { if (!flow && z < 0.6 && !e.target.closest('button, input, a, label, .seg, .table-scroll, .dtable')) start('move')(e); else onFocus(); }} onPointerMove={z < 0.6 ? move : undefined} onPointerUp={end}
      initial={{ opacity: 0, scale: 0.92, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94 }} transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      aria-label={`${a.title}. ${a.answer || ''} ${tr('Alt + Pfeiltasten verschieben, Enter vergrößert, Entf entfernt.', 'Alt + arrow keys move, Enter enlarges, Delete removes.')}`}>
      <header className="ask-card-head" onPointerDown={flow ? undefined : start('move')} onPointerMove={flow ? undefined : move} onPointerUp={end} onPointerCancel={end}>
        <span className="ask-tone" style={{ background: tone }} />
        <h3 title={a.title}>{a.title}</h3>
        <span className="row" style={{ gap: 2 }} onPointerDown={(e) => e.stopPropagation()}>
          {!simple && <label className="ask-sel" {...tip(tr('Für das PDF auswählen', 'Select for the PDF'))}><input type="checkbox" checked={!!c.sel} onChange={(e) => onChange({ sel: e.target.checked })} aria-label={tr('Für das PDF auswählen', 'Select for the PDF')} /></label>}
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onFull} aria-label={tr('Groß ansehen', 'View large')} {...tip(tr('Groß ansehen', 'View large'))}><Icon name="external" size={14} /></button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onRemove} aria-label={tr('Karte entfernen', 'Remove card')} {...tip(tr('Entfernen', 'Remove'))}><Icon name="x" size={14} /></button>
        </span>
      </header>
      {/* zoomed far out the canvas is an overview: the card body is inert (too small to use); zoom in or "View large" for its controls */}
      <div className="ask-card-body" inert={!flow && z < 0.75} title={!flow && z < 0.75 ? tr("Zum Bedienen vergrößern oder groß ansehen", "Zoom in or view large to use") : undefined}>
        <div className="ask-q">„{c.q}“</div>
        {c.pending ? <div className="row muted" style={{ gap: 8 }}>{[0, 1, 2].map((k) => <motion.i key={k} className="ask-dot" animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.9, repeat: Infinity, delay: k * 0.15 }} />)}{tr('Der Assistent denkt nach …', 'The assistant is thinking …')}</div> : <>
          {a.answer && <p className="ask-answer">{a.answer}</p>}
          {a.intent !== 'ai' && a.intent !== 'near' && a.intent !== 'guard' && <CardSource a={a} c={c} tip={tip} />}
          {a.intent === 'ai' &&<div className="ask-ai-note"><Icon name="sparkle" size={12} />{a.source === 'ai' ? tr('KI-generiert · bitte prüfen', 'AI-generated · please verify') : a.source === 'error' ? tr('Hinweis', 'Notice') : tr('Automatische Zusammenfassung', 'Automatic summary')}</div>}
          {(!simple || view !== 'table') && <CardBody card={a} view={simple && a.views.includes('number') && view === 'table' ? 'number' : view} onRef={onRef} onKey={openIssue} onAsk={onAsk} onAskAi={onAskAi} />}
          {a.desc && view !== 'text' && <p className="ask-desc faint">{a.desc}</p>}
          {a.intent === 'similarWork' && a.data?.similar?.items?.length > 0 && <SimilarAi similar={a.data.similar} />}
        </>}
      </div>
      {!simple && a.views.length > 1 && (
        <footer className="ask-card-foot" onPointerDown={(e) => e.stopPropagation()}>
          <div className="seg seg-sm" role="group" aria-label={tr('Darstellung', 'Chart type')}>
            {a.views.map((v) => <button key={v} type="button" className="seg-btn" aria-pressed={view === v} onClick={() => onChange({ view: v })} title={tr(VIEW_META[v][1], VIEW_META[v][2])}>{view === v && <span className="seg-pill" />}<Icon name={VIEW_META[v][0]} size={13} />{c.w >= 520 ? tr(VIEW_META[v][1], VIEW_META[v][2]) : null}</button>)}
          </div>
        </footer>
      )}
      {!simple && <span className="ask-resize" onPointerDown={start('size')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden="true" />}
    </motion.article>
  );
}

// Where a card comes from – always visible: "Regel der App" (computed by the cockpit) or "KI" (the AI only picked
// which card answers the wish; the numbers are still the app's). Hover: how it is calculated and from what.
function CardSource({ a, c, tip }) {
  const ai = a.source === 'ai';
  const why = ai ? tr(`Die KI hat deinen Wunsch dieser Karte zugeordnet${c.force?.why ? `: ${c.force.why}` : '.'} Die Zahlen rechnet die App selbst.`, `The AI mapped your wish to this card${c.force?.why ? `: ${c.force.why}` : '.'} The numbers are computed by the app itself.`) : null;
  const card = a.info ? infoCard({ ...a.info, hint: why || a.info.hint }) : infoCard({ title: a.title, text: why || tr('Aus den Daten des Cockpits berechnet – nach festen Regeln, ohne KI.', 'Computed from the cockpit\'s data – by fixed rules, without AI.') });
  return (
    <div className="ask-src">
      <span className={`ask-src-tag ${ai ? 'ai' : ''}`}><Icon name={ai ? 'sparkle' : 'shield'} size={11} />{ai ? tr('KI-Zuordnung', 'AI mapping') : tr('Regel der App', 'App rule')}</span>
      <button type="button" className="ask-src-how" {...tip(card)} aria-label={tr(`So wird „${a.title}“ berechnet`, `How "${a.title}" is calculated`)}><Icon name="info" size={12} />{tr('So gerechnet', 'How it is calculated')}</button>
    </div>
  );
}

// "Schätzen wie früher" with AI (only when texts may be sent): what helped or slowed down the similar items.
function SimilarAi({ similar }) {
  const { config } = useApp();
  if (config?.ai?.shareTexts !== true) return null;
  return (
    <div className="ask-similar-ai" onPointerDown={(e) => e.stopPropagation()}>
      <AiAssist feature="similarSummary" compact label={tr('Was half damals?', 'What helped back then?')} title={tr('Was bei ähnlicher Arbeit half', 'What helped in similar work')}
        build={() => ({ subject: similar.subject, items: similar.items.slice(0, 8), stats: similar.stats })}
        copy={(r) => [r.text, ...(r.points || []).map((p) => `• ${p}`)].join('\n')} />
    </div>
  );
}

// ---------- full screen ----------
function FullScreen({ card, a, onClose, onView, onRef }) {
  useEffect(() => {
    if (!card) return undefined;
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [card, onClose]);
  // enter only – closing unmounts at once (E2E 2026-11-20: the exit animation stalls in the Jira frame and Esc left the
  // full screen on top; the same rule as the tile popovers)
  return createPortal(
    <>
      {card && a && (
        <motion.div className="ask-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="dialog" aria-modal="true" aria-label={a.title}>
          <motion.div className="ask-full-inner" initial={{ scale: 0.94, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}><div className="ask-q">„{card.q}“</div><h2 style={{ margin: '4px 0 0', fontSize: 22 }}>{a.title}</h2></div>
              <div className="row" style={{ gap: 8 }}>
                {a.views.length > 1 && <div className="seg seg-sm" role="group" aria-label="Chart">{a.views.map((v) => <button key={v} className="seg-btn" aria-pressed={(card.view || a.view) === v} onClick={() => onView(v)}>{(card.view || a.view) === v && <span className="seg-pill" />}<Icon name={VIEW_META[v][0]} size={13} />{tr(VIEW_META[v][1], VIEW_META[v][2])}</button>)}</div>}
                <button className="btn btn-icon" onClick={onClose} aria-label={tr('Schließen', 'Close')} autoFocus><Icon name="x" /></button>
              </div>
            </div>
            {a.answer && <p className="ask-answer" style={{ fontSize: 17 }}>{a.answer}</p>}
            <div style={{ flex: 1, minHeight: 0, overflow: (card.view || a.view) === 'graph' ? 'hidden' : 'auto' }}><CardBody card={a} view={a.views.includes(card.view) ? card.view : a.views[0]} large onRef={onRef} onKey={openIssue} /></div>
          </motion.div>
        </motion.div>
      )}
    </>, document.body);
}

// ---------- composer: type or speak ----------
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
function Composer({ draft, setDraft, onAsk, busy, simple, chips }) {
  const [listening, setListening] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState(null);
  const rec = useRef(null);
  const timer = useRef(null);
  const input = useRef(null);
  const stop = () => { try { rec.current?.stop(); } catch { /* already stopped */ } setListening(false); };
  const listen = () => {
    if (listening) { stop(); return; }
    setVoiceMsg(null);
    if (!SR) { setVoiceMsg(tr('Dein Browser kann hier keine Sprache erkennen. Tipp: Nutze die Diktierfunktion deines Systems (Windows: Win + H, macOS: zweimal Fn).', 'Your browser cannot recognise speech here. Tip: use your system dictation (Windows: Win + H, macOS: press Fn twice).')); input.current?.focus(); return; }
    const r = new SR();
    r.lang = getLang() === 'de' ? 'de-DE' : 'en-US';
    r.interimResults = true; r.continuous = false;
    r.onresult = (e) => {
      const text = [...e.results].map((x) => x[0].transcript).join('');
      setDraft(text);
      clearTimeout(timer.current);
      if (e.results[e.results.length - 1].isFinal) timer.current = setTimeout(() => { stop(); onAsk(text); }, 700);
    };
    r.onerror = (e) => {
      setListening(false);
      setVoiceMsg(e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? tr('Jira erlaubt hier keinen Mikrofonzugriff. Nutze die Diktierfunktion deines Systems (Windows: Win + H, macOS: zweimal Fn) – das Eingabefeld ist bereit.', 'Jira does not allow microphone access here. Use your system dictation (Windows: Win + H, macOS: press Fn twice) – the input is ready.')
        : e.error === 'no-speech' ? tr('Nichts gehört – noch einmal?', 'Heard nothing – try again?') : tr('Spracheingabe nicht verfügbar.', 'Voice input not available.'));
      input.current?.focus();
    };
    r.onend = () => setListening(false);
    rec.current = r;
    try { r.start(); setListening(true); } catch { setListening(false); }
  };
  useEffect(() => () => { clearTimeout(timer.current); try { rec.current?.abort(); } catch { /* noop */ } }, []);
  return (
    <div className={`ask-composer ${simple ? 'big' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      {chips.length > 0 && <div className="ask-chips">{chips.map((s) => <button key={s.q} className="chip chip-outline" onClick={() => onAsk(s.q)}><Icon name={s.icon || 'sparkle'} size={12} />{s.q}</button>)}</div>}
      <AnimatePresence>{voiceMsg && <motion.div className="ask-voice-msg" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="status"><Icon name="info" size={14} />{voiceMsg}<button className="btn btn-ghost btn-icon btn-sm" onClick={() => setVoiceMsg(null)} aria-label={tr('Schließen', 'Close')}><Icon name="x" size={12} /></button></motion.div>}</AnimatePresence>
      <form className="ask-input" onSubmit={(e) => { e.preventDefault(); onAsk(draft); }}>
        <Icon name="sparkle" size={18} style={{ color: 'var(--accent)' }} />
        <input ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={300} placeholder={listening ? tr('Ich höre zu …', 'Listening …') : tr('Ich will … – z. B. „Ich will Überstunden vermeiden“ oder eine Frage', 'I want … – e.g. "I want to avoid overtime" or a question')} aria-label={tr('Frage', 'Question')} />
        <motion.button type="button" className={`ask-mic ${listening ? 'on' : ''}`} onClick={listen} aria-pressed={listening} aria-label={listening ? tr('Zuhören beenden', 'Stop listening') : tr('Frage sprechen', 'Speak a question')} whileTap={{ scale: 0.9 }}>
          {listening && <motion.span className="ask-mic-ring" animate={{ scale: [1, 1.6], opacity: [0.5, 0] }} transition={{ duration: 1.2, repeat: Infinity }} />}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
        </motion.button>
        <motion.button type="submit" className="btn btn-primary btn-icon" disabled={!draft.trim() || busy} aria-label={tr('Fragen', 'Ask')} whileTap={{ scale: 0.92 }}><Icon name="send" /></motion.button>
      </form>
    </div>
  );
}
