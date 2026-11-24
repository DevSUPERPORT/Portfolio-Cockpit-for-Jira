// Meine Arbeit (UC-20): the signed-in person's own week – tasks, bookings, targets – and booking right in the cell.
// Data: mine.week (as the user, from Jira) + the cockpit model (portfolio, capacity, holidays, booking rules).
// Writes: mine.book (Jira worklog API as the user; only the person's own worklogs). Every booking can be undone.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { buildWeek, weekOf, parseHours, roundQuarter } from '@shared/mine.js';
import { suggestWeek } from '@shared/mineSuggest.js';
import { personWeek } from '@shared/team.js';
import { personBoardWeeks } from '@shared/weekPlan.js';
import { useDistribution } from '../lib/distribution.js';
import { weekInfo, weekCalc, hExact } from '../lib/weekCard.js';
import { FitBar, fitOf, fitSentence, fitWords } from '../components/LoadFit.jsx';
import { dayIdx, isoOf, mondayOf } from '@shared/dates.js';
import { utilTone } from '@shared/kpis.js';
import { useApp, errText } from '../state.jsx';
import { tr, fmt, getLang } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call, openIssue } from '../lib/api.js';
import { Avatar, Segmented, Skeleton, Empty, useTip, infoCard } from '../components/ui.jsx';
import GapBox from '../components/GapBox.jsx';
import { useAiAssist, AiButton, AiPanel } from '../components/AiAssist.jsx';
import { LotseChip } from '../components/lotse/LotseChip.jsx';
import TodayStrip from '../components/lotse/TodayStrip.jsx';
import { myWeekPayload } from '@shared/aiPayload.js';
import { applyComments } from '../lib/aiApply.js';

// added tasks per week, remembered in this browser per account (a convenience; booked ones show up anyway)
const pinKey = (id) => `pc-mine-pins:${id || 'me'}`;
const loadPins = (id) => { try { const all = JSON.parse(localStorage.getItem(pinKey(id)) || '{}') || {}; const cut = isoOf(dayIdx(todayIso()) - 120); return Object.fromEntries(Object.entries(all).filter(([w]) => w >= cut)); } catch { return {}; } };
const savePins = (id, p) => { try { localStorage.setItem(pinKey(id), JSON.stringify(p)); } catch { /* private mode */ } };
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hh = (v) => (v ? fmt.n(v, 2) : '');
const H = (v) => fmt.h(v || 0, Math.abs((v || 0) - Math.round(v || 0)) < 0.001 ? 0 : 2);
const kw = (iso) => fmt.week(iso);

export default function Mine() {
  const app = useApp();
  const { computed, boot, toast, done, lang, config } = app;
  const me = boot.me || {};
  const tip = useTip();
  const [week, setWeek] = useState(() => weekOf(todayIso()).from);
  const [ctx, setCtx] = useState(() => (boot.projectCtx?.key ? `proj:${boot.projectCtx.key}` : 'all'));
  const [group, setGroup] = useState('assign');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pins, setPins] = useState(() => loadPins(me.id));
  const [cell, setCell] = useState(null); // { id, d } focused cell (comment row)
  const [saving, setSaving] = useState({}); // `${id}|${d}` → 'saving' | 'ok' | 'error'
  const [showUndated, setShowUndated] = useState(false);
  const [evidence, setEvidence] = useState(null); // my Jira activity of the week (raw material for the proposals)
  const [evErr, setEvErr] = useState(null);
  const [hideSugg, setHideSugg] = useState(false);
  const [applying, setApplying] = useState(null); // { n, of }
  const today = todayIso();
  const range = weekOf(week);
  const weekPins = pins[range.from] || [];

  const load = useCallback(async (quiet) => {
    if (!quiet) setLoading(true);
    setErr(null);
    try { setData(await call('mine.week', { from: range.from, to: range.to, extraIds: weekPins })); } catch (e) { setErr(e); } finally { setLoading(false); }
  }, [range.from, range.to, weekPins.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); load(); }, [range.from]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    setEvidence(null); setEvErr(null);
    if (range.from > today) return undefined; // nothing happened yet
    call('mine.evidence', { from: range.from, to: range.to }).then((e) => live && setEvidence(e)).catch((e) => live && setEvErr(e));
    return () => { live = false; };
  }, [range.from]); // eslint-disable-line react-hooks/exhaustive-deps

  // proposals: the gap of every past day and today, from my activity (else my plan) – see shared/mineSuggest.js
  const { sheet, sugg } = useMemo(() => {
    if (!data || !computed) return { sheet: null, sugg: null };
    const args = { computed, meId: me.id, today, ctx, group, lang, bookingCfg: config?.booking };
    const base = buildWeek({ ...args, ctx: 'all', data, pins: weekPins });
    const known = new Set(data.issues.map((i) => i.id));
    const issues = [...data.issues, ...(evidence?.issues || []).filter((i) => !known.has(i.id))];
    const sg = evidence && !hideSugg ? suggestWeek({ days: base.days, issues, worklogs: data.worklogs, events: evidence.events }) : null;
    const all = sg ? [...issues, ...[...sg.shapes.values()].filter((i) => i.synthetic && !issues.some((x) => x.id === i.id))] : issues;
    const sh = buildWeek({ ...args, data: { ...data, issues: all }, pins: [...new Set([...weekPins, ...(sg?.issues || [])])] });
    return { sheet: sh, sugg: sg };
  }, [data, evidence, hideSugg, computed, me.id, today, ctx, group, weekPins.join(','), lang, config]); // eslint-disable-line react-hooks/exhaustive-deps
  const evByCell = useMemo(() => {
    const m = new Map();
    for (const e of evidence?.events || []) { const k = `${e.issueId}|${e.d}`; (m.get(k) || m.set(k, []).get(k)).push(e); }
    return m;
  }, [evidence]);
  // the same numbers as the weekly board (Teams, Wochenplanung) – boss 2026-11-20: "139 % / 125 % – it is always me"
  const distribution = useDistribution(config);
  const load8 = useMemo(() => {
    if (!computed || !me.id) return [];
    const bw = personBoardWeeks({ ds: app.ds || computed.model.ds, computed, personId: me.id, weeks: 8, distribution, lang, reasons: true });
    // the whole week for the tooltips: period, weekly hours − days off − daily business, support + tasks, days off by name
    if (bw) return bw.map((w) => ({ ...w, util: w.avail > 0.05 ? w.load / w.avail : w.load > 0.05 ? Infinity : 0, plan: w.load, cap: w.avail }));
    // not on any team board (no team): the person's own week
    const mon = mondayOf(dayIdx(today));
    return Array.from({ length: 8 }, (_, i) => { const a = mon + i * 7; const pw = personWeek(computed, me.id, a, a + 6); return { from: isoOf(a), util: pw?.util ?? null, plan: pw?.plan || 0, cap: pw?.cap || 0 }; });
  }, [computed, me.id, today, distribution, app.ds, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const shift = (n) => { const m = dayIdx(range.from) + n * 7; setWeek(isoOf(m)); setCell(null); };
  const pin = (id) => { setPins((p) => { const list = [...new Set([...(p[range.from] || []), String(id)])]; const n = { ...p, [range.from]: list }; savePins(me.id, n); return n; }); };
  const unpin = (id) => { setPins((p) => { const n = { ...p, [range.from]: (p[range.from] || []).filter((x) => x !== String(id)) }; savePins(me.id, n); return n; }); };
  useEffect(() => { if (data) load(true); }, [weekPins.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // one booking: set the cell to `hours` (0 = remove), optional comment; undo restores the previous cell
  const book = useCallback(async (row, d, hours, comment, { silent } = {}) => {
    const k = `${row.id}|${d}`;
    setSaving((s) => ({ ...s, [k]: 'saving' }));
    try {
      const r = await call('mine.book', { issueId: row.id, date: d, hours, ...(comment != null ? { comment } : {}), tz: -new Date().getTimezoneOffset() });
      setData((x) => (x ? {
        ...x,
        worklogs: [...x.worklogs.filter((w) => !(w.issueId === row.id && w.d === d)), ...r.worklogs],
        issues: x.issues.some((i) => i.id === row.id) ? x.issues.map((i) => (i.id === row.id ? { ...i, re: r.issue.re, ts: r.issue.ts, status: r.issue.status } : i)) : [...x.issues, r.issue],
      } : x));
      setSaving((s) => ({ ...s, [k]: 'ok' }));
      setTimeout(() => setSaving((s) => { const n = { ...s }; if (n[k] === 'ok') delete n[k]; return n; }), 1400);
      if (!silent && r.op !== 'none') {
        const prev = r.previous;
        const when = `${fmt.date(d, { weekday: 'short', day: '2-digit', month: '2-digit' })}`;
        const text = r.op === 'delete' ? tr(`Buchung auf ${row.key} am ${when} gelöscht`, `Booking on ${row.key} on ${when} removed`)
          : r.op === 'create' ? tr(`${H(hours)} auf ${row.key} am ${when} gebucht`, `${H(hours)} booked on ${row.key} on ${when}`)
            : tr(`${row.key} am ${when}: jetzt ${H(hours)}`, `${row.key} on ${when}: now ${H(hours)}`);
        done(text, 'clock', tr('Buchung', 'booking'), () => book(row, d, prev.hours, prev.comment, { silent: true }), [`mine:${k}`]);
      } else if (!silent && comment != null) toast({ text: tr('Kommentar gespeichert', 'Comment saved'), icon: 'check' });
      return true;
    } catch (e) {
      setSaving((s) => ({ ...s, [k]: 'error' }));
      const msg = e?.code === 'SUBTASK_NOT_BOOKABLE' ? tr('Auf Sub-tasks kann noch nicht gebucht werden.', 'Sub-tasks cannot be booked yet.')
        : e?.code === 'MULTIPLE_WORKLOGS' ? tr('An diesem Tag gibt es mehrere Buchungen. Geändert wird nur die letzte – die übrigen sind schon mehr als dein neuer Wert. Bitte in Jira anpassen.', 'There are several bookings on this day. Only the latest changes – the others already add up to more than your new value. Please adjust in Jira.')
          : errText(e);
      toast({ text: msg, error: true });
      return false;
    }
  }, [done, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // take proposals (one cell, one day or the whole week) – one undo for the whole batch
  const applyMany = useCallback(async (items) => {
    if (!items.length) return;
    setApplying({ n: 0, of: items.length });
    // three at a time: every cell is a different work item or day, so the bookings are independent
    const doneOk = [];
    let failed = false;
    const queue = [...items];
    const worker = async () => { while (queue.length && !failed) { const it = queue.shift(); const ok = await book({ id: it.issueId, key: it.key }, it.d, it.h, null, { silent: true }); if (!ok) { failed = true; return; } doneOk.push(it); setApplying({ n: doneOk.length, of: items.length }); } };
    await Promise.all([worker(), worker(), worker()]);
    setApplying(null);
    if (!doneOk.length) return;
    const h = doneOk.reduce((t, x) => t + x.h, 0), n = new Set(doneOk.map((x) => x.issueId)).size;
    const text = doneOk.length === 1 ? tr(`${H(h)} auf ${doneOk[0].key} gebucht`, `${H(h)} booked on ${doneOk[0].key}`)
      : tr(`${H(h)} auf ${n} Aufgaben gebucht${doneOk.length < items.length ? ` (${doneOk.length} von ${items.length})` : ''}`, `${H(h)} booked on ${n} tasks${doneOk.length < items.length ? ` (${doneOk.length} of ${items.length})` : ''}`);
    done(text, 'check', tr('Vorschläge übernommen', 'proposals taken'), async () => { const q = [...doneOk]; const w = async () => { while (q.length) { const it = q.shift(); await book({ id: it.issueId, key: it.key }, it.d, 0, null, { silent: true }); } }; await Promise.all([w(), w(), w()]); }, doneOk.map((x) => `mine:${x.issueId}|${x.d}`));
  }, [book, done]);

  // KI-Assistent: comments for my booked cells and a short text about my week – only my own data; each comment is saved
  // through mine.book (same hours) and is its own undo entry
  const ai = useAiAssist({ feature: 'myWeek', build: () => myWeekPayload({ data, evidence, from: range.from, to: range.to }) });
  const aiComments = async (r) => {
    const entries = await applyComments({ comments: r.comments, book, pushUndo: app.pushUndo });
    if (!entries.length) return;
    toast({ text: tr(`${entries.length} ${entries.length === 1 ? 'Kommentar' : 'Kommentare'} gespeichert (${r.source === 'lotse' ? 'Lotse-Vorschlag' : 'KI-Vorschlag'}) – jeder einzeln rückgängig`, `${entries.length} ${entries.length === 1 ? 'comment' : 'comments'} saved (${r.source === 'lotse' ? 'Lotse suggestion' : 'AI suggestion'}) – each undoable`), icon: 'sparkle',
      undo: async () => { for (const e of [...entries].reverse()) await app.runUndo(e, { quiet: true }); } });
  };

  if (!computed) return <div className="page"><Skeleton h={90} /><Skeleton h={300} /></div>;
  return (
    <div className="page mine" data-mine>
      <TodayStrip where="mine" />
      <Intro seen={!!boot.prefs?.hints?.mine} />
      <Profile me={me} sheet={sheet} projectCtx={boot.projectCtx} />
      <Kpis sheet={sheet} load8={load8} range={range} onWeek={(iso) => { setWeek(iso); setCell(null); }} tip={tip} />
      <section className="card mine-sheet" aria-labelledby="mine-week-title">
        <div className="mine-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="card-title" id="mine-week-title"><Icon name="calendar" />{tr('Meine Woche', 'My week')}</h2>
            <div className="card-sub">{kw(range.from)} · {fmt.date(range.from)} – {fmt.dateLong(range.to)} · {tr('Stunden in die Zelle tippen (z. B. 1,5 oder 1:30), Enter speichert, leer = löschen. Zelle mit Stunden anklicken für einen Kommentar.', 'Type hours into a cell (e.g. 1.5 or 1:30), Enter saves, empty = remove. Click a cell with hours to add a comment.')}</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <LotseChip skill="myWeek" params={{ person: me?.id, from: range.from, to: range.to }} extra={data ? { mine: data } : null} label={tr('Lotse: meine Woche', 'Lotse: my week')} />
            {data && range.from <= today && <AiButton ai={ai} label={tr('Kommentare & Wochentext', 'Comments & week text')} />}
            <span className="mine-weeknav" role="group" aria-label={tr('Woche wählen', 'Choose week')}>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => shift(-1)} aria-label={tr('Vorherige Woche', 'Previous week')}><Icon name="chevron" size={15} style={{ transform: 'rotate(180deg)' }} /></button>
              <button type="button" className="btn btn-sm" onClick={() => { setWeek(weekOf(today).from); setCell(null); }} disabled={range.from === weekOf(today).from}>{tr('Diese Woche', 'This week')}</button>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => shift(1)} aria-label={tr('Nächste Woche', 'Next week')}><Icon name="chevron" size={15} /></button>
            </span>
          </div>
        </div>
        {ai.open && (
          <div style={{ padding: '0 20px 12px' }}>
            <AiPanel ai={ai} title={`${tr('Meine Woche', 'My week')} · ${kw(range.from)}`} render={(r) => <AiWeekComments r={r} />}
              onApply={aiComments} canApply={(r) => r.comments?.length > 0} applyLabel={tr('Kommentare übernehmen', 'Use comments')}
              copy={(r) => r.text} copyLabel={tr('Wochentext kopieren', 'Copy week text')} />
          </div>
        )}
        <div className="mine-filters">
          <div className="row wrap" role="group" aria-label={tr('Projekt', 'Project')} style={{ gap: 6 }}>
            <span className="label" style={{ margin: '0 4px 0 0' }}>{tr('Projekt', 'Project')}</span>
            <button type="button" className={`chip ${sheet?.ctx === 'all' ? 'chip-accent' : 'chip-outline'}`} aria-pressed={sheet?.ctx === 'all'} onClick={() => setCtx('all')}>{tr('Alle', 'All')}</button>
            {boot.projectCtx?.key && <button type="button" className={`chip ${ctx === `proj:${boot.projectCtx.key}` ? 'chip-accent' : 'chip-outline'}`} aria-pressed={ctx === `proj:${boot.projectCtx.key}`} onClick={() => setCtx(`proj:${boot.projectCtx.key}`)}>{tr('Dieser Space', 'This space')} · {boot.projectCtx.key}</button>}
            {(sheet?.options || []).map((o) => <button key={o.key} type="button" className={`chip ${ctx === o.key ? 'chip-accent' : 'chip-outline'}`} aria-pressed={ctx === o.key} onClick={() => setCtx(o.key)}>{o.key === 'support' && <Icon name="headset" size={12} />}{o.label}<span className="faint num">{o.n}</span></button>)}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="label" style={{ margin: 0 }}>{tr('Gruppieren', 'Group by')}</span>
            <Segmented value={group} onChange={setGroup} options={[{ value: 'assign', label: tr('Zuordnung', 'Assignment') }, { value: 'proj', label: tr('Projekt', 'Project') }]} />
          </div>
        </div>
        {!err && range.from <= today && <SmartFill sheet={sheet} sugg={sugg} evidence={evidence} evErr={evErr} applying={applying} onApply={applyMany} onHide={() => setHideSugg(true)} hidden={hideSugg} onShow={() => setHideSugg(false)} />}
        {err ? <div className="card-pad"><Empty icon="alert" title={tr('Deine Woche konnte nicht geladen werden', 'Your week could not be loaded')} action={<button className="btn" onClick={() => load()}><Icon name="refresh" />{tr('Erneut versuchen', 'Try again')}</button>}>{errText(err)}</Empty></div>
          : !sheet ? <div className="card-pad stack" style={{ gap: 8 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={46} />)}</div>
            : <Sheet sheet={sheet} sugg={sugg} evByCell={evByCell} applyMany={applyMany} busy={!!applying} saving={saving} book={book} cell={cell} setCell={setCell} pin={pin} unpin={unpin} weekPins={weekPins} showUndated={showUndated} setShowUndated={setShowUndated} loading={loading} tip={tip} />}
      </section>
      {me.id && <GapBox scope={mineGapScope(me.id)} hideEmpty title={tr('Fehlende Werte', 'Missing values')} hint={tr('Werte an deinen Aufgaben (Assignee oder Owner), ohne die die Planung nicht belastbar ist – hier direkt ergänzen.', 'Values on your work items (assignee or owner) without which planning is not reliable – fill them in right here.')} />}
    </div>
  );
}
// The drafted worklog comments: task, day, hours → comment (only for cells without a comment of mine).
function AiWeekComments({ r }) {
  if (!r.comments?.length) return <div className="faint" style={{ fontSize: 12.5 }}>{tr('Keine Kommentarvorschläge – deine gebuchten Zellen haben schon Kommentare oder es gibt keine Aktivität dazu.', 'No comment suggestions – your booked cells already have comments or there is no activity for them.')}</div>;
  return (
    <ul className="ai-list" aria-label={tr('Vorgeschlagene Kommentare', 'Suggested comments')}>
      {r.comments.map((c, i) => (
        <motion.li key={c.cell} className="ai-item" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 + i * 0.04, duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
          <span className="tkey">{c.key}</span>
          <b>{fmt.date(c.d, { weekday: 'short', day: '2-digit', month: '2-digit' })} · {H(c.h)}</b>
          <span className="ai-item-why">„{c.comment}“</span>
        </motion.li>
      ))}
    </ul>
  );
}
const gapScopes = new Map();
const mineGapScope = (id) => gapScopes.get(id) || gapScopes.set(id, { mine: id }).get(id);

function Profile({ me, sheet, projectCtx }) {
  const p = sheet?.profile;
  return (
    <section className="card mine-profile">
      <div className="row" style={{ gap: 14, minWidth: 0, flex: '1 1 320px' }}>
        <Avatar user={me} size={46} />
        <div style={{ minWidth: 0 }}>
          <h1 className="mine-title">{tr('Meine Arbeit', 'My work')} · {me.name || tr('Du', 'You')}</h1>
          <div className="muted" style={{ fontSize: 13 }}>
            {p ? <>{p.team ? tr(`Team ${p.team}`, `Team ${p.team}`) : tr('Ohne Team', 'No team')} · {fmt.h(p.weekly, 1)} {tr('je Woche', 'per week')} · {tr('davon', 'of which')} {fmt.h(p.forProjects, 1)} {tr('für Projekte', 'for projects')}</> : <Skeleton h={12} w={220} />}
            {projectCtx?.key && <> · {tr(`Im Jira-Space ${projectCtx.key}: nur Aufgaben dieses Space`, `In Jira space ${projectCtx.key}: only this space's work`)}</>}
          </div>
        </div>
      </div>
      {p && (
        <div className="mine-facts">
          <Fact icon="users" label={tr('Team', 'Team')} value={p.team || '–'} hint={p.derived ? tr('Nicht gepflegt – abgeleitet aus deinen Aufgaben', 'Not maintained – derived from your tasks') : null} />
          <Fact icon="clock" label={tr('Wochenstunden', 'Weekly hours')} value={fmt.h(p.weekly, 1)} hint={p.derived ? tr('Standardwert', 'Default value') : `${tr('Tagesgeschäft', 'Daily business')} ${p.dailyPct} % · ${tr('Intern', 'Internal')} ${p.internalPct} %`} />
          {(() => {
            // an absence that is running right now is not the "next" one (E2E 2026-11-20: "Next absence 17–20 Nov" on the 20th)
            const a0 = p.absences[0], now = todayIso();
            const on = !!(a0 && a0.from <= now && a0.to >= now);
            return <Fact icon="calendar" label={on ? tr('Abwesend', 'Absent') : tr('Nächste Abwesenheit', 'Next absence')} value={a0 ? (on ? tr(`bis ${fmt.date(a0.to)}`, `until ${fmt.date(a0.to)}`) : `${fmt.date(a0.from)} – ${fmt.date(a0.to)}`) : tr('keine geplant', 'none planned')} hint={p.absences.length > 1 ? tr(`+ ${p.absences.length - 1} weitere`, `+ ${p.absences.length - 1} more`) : null} />;
          })()}
          <Fact icon="flag" label={tr('Nächster Feiertag', 'Next public holiday')} value={p.holidays[0] ? fmt.dateLong(p.holidays[0]) : tr('keiner in 60 Tagen', 'none in 60 days')} hint={p.location !== 'NONE' ? (p.locationName || p.location) : null} />
        </div>
      )}
    </section>
  );
}
function Fact({ icon, label, value, hint }) {
  return <div className="mine-fact"><Icon name={icon} size={14} /><div><span className="label" style={{ margin: 0 }}>{label}</span><b>{value}</b>{hint && <span className="faint">{hint}</span>}</div></div>;
}

function Kpis({ sheet, load8, range, onWeek, tip }) {
  if (!sheet) return <div className="mine-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="card" style={{ padding: 18 }}><Skeleton h={12} w={90} /><Skeleton h={28} w={80} style={{ marginTop: 10 }} /></div>)}</div>;
  const b = sheet.booked, o = sheet.open;
  const w0 = load8.find((w) => w.from === range.from);
  const bookedSub = b.filtered ? tr('nur dieses Projekt · das Soll gilt über alle Projekte', 'this project only · the target applies across all projects')
    : b.future ? tr(`Woche liegt in der Zukunft · Soll ${H(b.weekPossible)}`, `Week is in the future · target ${H(b.weekPossible)}`)
      : b.soll === 0 ? (b.graced ? tr(`Nachbuchfrist läuft noch (${b.graced} Arbeitstage) · Soll ${H(b.weekPossible)}`, `Grace period still running (${b.graced} workdays) · target ${H(b.weekPossible)}`) : tr('kein Soll in dieser Woche', 'no target this week'))
        : `${tr('bis', 'up to')} ${fmt.date(b.untilIso, { weekday: 'short' })}: ${H(b.istSoll)} ${tr('von', 'of')} ${H(b.soll)} (${fmt.pct(b.pct)}) · ${tr('Mindestquote', 'minimum')} ${b.minPct} %`;
  const card = (k) => tip(infoCard(k));
  return (
    <div className="mine-kpis">
      <div className={`card mine-kpi ${b.below ? 'warn' : ''}`} tabIndex={0} {...card({
        title: tr(`Gebucht in ${kw(range.from)}`, `Booked in ${kw(range.from)}`), sub: b.below ? tr('unter der Mindestquote', 'below the minimum') : tr('im Rahmen', 'within range'),
        text: tr('Alle deine Worklogs dieser Woche (auf allen Aufgaben, die du in Jira siehst). Verglichen wird wie in der Buchungskontrolle: mit deiner möglichen Arbeitszeit bis heute, ohne die letzten Arbeitstage der Nachbuchfrist.', 'All your worklogs this week (on every work item you can see in Jira). Compared as in the booking check: with your possible working time up to today, without the last workdays of the grace period.'),
        calc: b.soll > 0 ? `${H(b.istSoll)} ÷ ${H(b.soll)} = ${fmt.pct(b.pct)}` : null,
        inputs: sheet.days.map((d) => [`${d.wd} ${fmt.date(d.iso)}`, d.holiday ? offLabel(d) : d.absent ? tr('abwesend', 'absent') : d.free ? tr('frei', 'off') : `${H(sheet.dayTotals.find((x) => x.iso === d.iso)?.h)} / ${H(d.possible)}`]),
      })}>
        <span className="label">{tr(`Gebucht in ${kw(range.from)}`, `Booked in ${kw(range.from)}`)}</span>
        <span className="mine-kpi-v num">{H(b.ist)}</span>
        {b.soll > 0 && !b.filtered && <span className="mine-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (b.pct || 0) * 100)}%` }} /><b style={{ left: `${b.minPct}%` }} /></span>}
        <span className="faint mine-kpi-s">{bookedSub}</span>
      </div>
      <div className="card mine-kpi" tabIndex={0} {...card({
        title: tr(`Offen in ${kw(range.from)}`, `Open in ${kw(range.from)}`), text: tr('Deine offenen Aufgaben unter „Mir zugewiesen“: Start oder Due Date in dieser Woche, in der laufenden Woche auch Überfälliges.', 'Your open tasks under "Assigned to me": start or due date in this week, in the current week also everything overdue.'),
        inputs: [[tr('Überfällig', 'Overdue'), String(o.overdue)], [tr('Blockiert', 'Blocked'), String(o.blocked)], [tr('Remaining gesamt', 'Remaining total'), H(o.remaining)]],
      })}>
        <span className="label">{tr(`Offen in ${kw(range.from)}`, `Open in ${kw(range.from)}`)}</span>
        <span className="mine-kpi-v num">{o.n}</span>
        <span className="faint mine-kpi-s">{o.overdue} {tr('überfällig', 'overdue')} · {o.blocked} {tr('blockiert', 'blocked')} · Remaining {H(o.remaining)}</span>
      </div>
      {(() => {
        // plain words first, then a bar, the percentage small (boss 2026-11-20)
        const fit = w0 ? fitOf(w0.plan, w0.cap) : null;
        const bad = fit && (fit.kind === 'over' || fit.kind === 'noTime');
        return (
          <div className={`card mine-kpi mine-load ${bad ? 'warn' : ''}`} tabIndex={0} data-mine-load {...card({
            title: tr('Auslastung dieser Woche', 'Load this week'),
            text: `${fit ? `${fitSentence(fit, null, hExact)} ` : ''}${tr('Deine Aufgaben dieser Woche gegen deine Zeit für Projekte (nach Tagesgeschäft, Intern, Support, Feiertagen und Abwesenheit) – dieselbe Zahl wie bei Teams und in der Wochenplanung.', 'Your tasks this week against your time for projects (after daily business, internal, support, holidays and absence) – the same number as in Teams and Weekly planning.')}`,
            calc: weekCalc(w0),
          })}>
            <span className="label">{tr('Auslastung dieser Woche', 'Load this week')}</span>
            {fit && fit.kind !== 'none' ? (
              <>
                <span className={`mine-kpi-v mine-fit fit-${fit.kind}`}>{fitWords(fit)}{Number.isFinite(fit.util) && fit.load > 0.05 && <small className="num">{fmt.pct(fit.util)}</small>}</span>
                <FitBar fit={fit} className="mine-fit-bar" />
              </>
            ) : <span className="mine-kpi-v num">{w0 ? tr('nichts geplant', 'nothing planned') : '–'}</span>}
            <span className="faint mine-kpi-s">{w0 ? `${H(w0.plan)} ${tr('geplant', 'planned')} · ${H(w0.cap)} ${tr('Zeit für Projekte', 'time for projects')}` : tr('Woche außerhalb der nächsten 8 Wochen', 'Week outside the next 8 weeks')}</span>
          </div>
        );
      })()}
      <div className="card mine-kpi">
        <span className="label">{tr('Nächste 8 Wochen', 'Next 8 weeks')}</span>
        <div className="mine-strip" role="list" aria-label={tr('Auslastung der nächsten 8 Wochen – Woche anklicken zum Öffnen', 'Load of the next 8 weeks – click a week to open it')}>
          {load8.map((w) => (
            <button key={w.from} type="button" role="listitem" className={`mine-strip-w ${w.from === range.from ? 'on' : ''}`} onClick={() => onWeek(w.from)}
              aria-label={`${kw(w.from)}: ${fitWords(fitOf(w.plan, w.cap)) || tr('nichts geplant', 'nothing planned')}${Number.isFinite(w.util) && w.plan > 0.05 ? ` (${fmt.pct(w.util)})` : ''}`} {...tip(infoCard(weekInfo(w, { text: fitSentence(fitOf(w.plan, w.cap), null, hExact), hint: tr('Klicken öffnet diese Woche unten.', 'Click opens this week below.') })))}>
              <span>{kw(w.from).replace(/^\D+/, '')}</span>
              {(() => { const f = fitOf(w.plan, w.cap); if (f.kind === 'none' || w.plan <= 0.05) return null; const full = f.kind === 'over' || f.kind === 'noTime'; return <><i className={`mine-strip-fill fit-${f.kind}`} style={{ transform: `scaleY(${full ? 1 : Math.min(1, f.util)})` }} aria-hidden="true" />{full && <i className="mine-strip-over" aria-hidden="true" />}</>; })()}
            </button>
          ))}
        </div>
        <span className="faint mine-kpi-s mine-legend"><span><i className="lg-ok" />{tr('Luft', 'room')}</span><span><i className="lg-full" />{tr('fast voll', 'nearly full')}</span><span><i className="lg-over" />{tr('zu viel', 'too much')}</span></span>
      </div>
    </div>
  );
}

// Days without a target (UC-09): public holiday / company day off (with its name), absence, or a weekday the
// person's location does not work ("frei"). Muted in the sheet, never counted as missing.
const noTarget = (d) => d.holiday || d.absent || d.free;
const offLabel = (d) => d.holidayName || (d.company ? tr('Betrieblich frei', 'Company day off') : tr('Feiertag', 'Public holiday'));
const dayShort = (d) => (d.holiday ? (d.company ? tr('betriebsfrei', 'company off') : tr('Feiertag', 'holiday')) : d.absent ? tr('abwesend', 'absent') : tr('frei', 'off'));
const dayTip = (d) => (d.holiday ? infoCard({ title: offLabel(d), text: d.company ? tr('Betrieblich freier Tag des Standorts – kein Soll.', 'Company day off at the location – no target.') : tr('Feiertag am Standort – kein Soll.', 'Public holiday at the location – no target.') })
  : d.absent ? infoCard({ title: tr('Abwesend', 'Absent'), text: tr('Eingetragene Abwesenheit – kein Soll.', 'Recorded absence – no target.') })
    : d.free ? infoCard({ title: tr('Frei', 'Day off'), text: tr('An deinem Standort kein Arbeitstag – kein Soll, zählt nicht als fehlend. Buchen geht trotzdem.', 'Not a working day at your location – no target, never counted as missing. You can still book.') }) : null);
const statusLabel = (r) => (r.blocked ? tr('Blockiert', 'Blocked') : r.statusName || '');
function Sheet({ sheet, sugg, evByCell, applyMany, busy, saving, book, cell, setCell, pin, unpin, weekPins, showUndated, setShowUndated, loading, tip }) {
  const cols = `minmax(var(--mine-task, 260px), 2.2fr) repeat(5, minmax(var(--mine-day, 64px), 84px)) var(--mine-re, 76px) var(--mine-sum, 92px)`; // narrower on phones (styles.css)
  const grid = useRef(null);
  // arrow keys / Enter move between the hour cells like in a spreadsheet
  const move = (el, dr, dc) => {
    const all = [...(grid.current?.querySelectorAll('input.mine-cell:not(:disabled)') || [])];
    const r = +el.dataset.r, c = +el.dataset.c;
    const next = all.find((x) => +x.dataset.r === r + dr && +x.dataset.c === c + dc) || (dr ? null : all.find((x) => +x.dataset.r === r && +x.dataset.c === c + dc));
    if (next) { next.focus(); next.select(); }
  };
  let ri = 0;
  const groupLabel = (g) => (g.kind === 'support' ? tr('Support · hat Vorrang vor den Projekten', 'Support · comes before projects')
    : g.kind === 'assigned' ? tr(`Mir zugewiesen · Start oder Due Date in ${kw(sheet.from)}${g.withOverdue ? ', dazu Überfälliges' : ''}`, `Assigned to me · start or due date in ${kw(sheet.from)}${g.withOverdue ? ', plus overdue' : ''}`)
      : g.kind === 'more' ? tr(`Weitere Aufgaben · in ${kw(sheet.from)} gebucht oder hinzugefügt`, `Other tasks · booked or added in ${kw(sheet.from)}`)
        : g.kind === 'undated' ? tr('Ohne Termin · dir zugewiesen, kein Start und kein Due Date', 'No dates · assigned to you, no start and no due date')
          : `${tr('Projekt', 'Project')} ${g.label}`);
  const empty = !sheet.groups.some((g) => g.rows.length && g.kind !== 'undated');
  return (
    <>
    <div className="table-scroll" tabIndex={-1}>
      <div className="mine-grid" ref={grid} style={{ opacity: loading ? 0.6 : 1 }} aria-busy={loading}>
        <div className="mine-row mine-hrow" style={{ gridTemplateColumns: cols }}>
          <span>{tr('Aufgabe', 'Task')}</span>
          {sheet.days.map((d) => (
            <span key={d.iso} className={`r mine-dh ${d.isToday ? 'today' : ''} ${noTarget(d) ? 'off' : ''}`} tabIndex={dayTip(d) ? 0 : undefined} {...tip(dayTip(d) || (d.isToday ? tr('Heute', 'Today') : null))}>
              {d.wd} {fmt.date(d.iso, { day: '2-digit', month: '2-digit' })}{(d.holiday || d.absent) && <i className="mine-dot" aria-hidden="true" />}
              {noTarget(d) && <small className="mine-dh-off">{dayShort(d)}</small>}
            </span>
          ))}
          <span className="r">{tr('Woche', 'Week')}</span>
          <span className="r">Remaining</span>
        </div>
        {empty && <div className="mine-empty">{tr('Keine Aufgaben in dieser Woche – über „Weitere Aufgabe hinzufügen“ kannst du trotzdem buchen.', 'No tasks this week – use "Add another task" to book anyway.')}</div>}
        {sheet.groups.map((g) => {
          if (g.kind === 'undated' && !g.rows.length) return null;
          const folded = g.kind === 'undated' && !showUndated;
          return (
            <div key={g.id}>
              <div className={`mine-row mine-grow ${g.kind}`} style={{ gridTemplateColumns: '1fr auto' }}>
                {g.kind === 'undated'
                  ? <button type="button" className="linkbtn" aria-expanded={!folded} onClick={() => setShowUndated(!showUndated)}><Icon name="chevron" size={12} style={{ transform: folded ? 'none' : 'rotate(90deg)' }} /> {groupLabel(g)} · {g.rows.length}</button>
                  : <span>{groupLabel(g)}</span>}
                <span className="num">{H(g.sum)}</span>
              </div>
              {g.kind === 'assigned' && !g.rows.length && <div className="mine-empty">{tr('Keine zugewiesenen Projektaufgaben in dieser Woche.', 'No assigned project tasks this week.')}</div>}
              {!folded && g.rows.map((r) => {
                const idx = ri++;
                const open = cell && cell.id === r.id;
                const cur = open ? r.cells.find((c) => c.d === cell.d) : null;
                return (
                  <div key={r.id}>
                    <div className={`mine-row ${r.support ? 'sup' : ''}`} style={{ gridTemplateColumns: cols }}>
                      <div className="mine-task">
                        <div className="row" style={{ gap: 6, minWidth: 0 }}>
                          <button type="button" className="tkey" onClick={() => openIssue(r.key)} title={tr(`${r.key} in Jira öffnen`, `Open ${r.key} in Jira`)}>{r.key}</button>
                          <span className="mine-sum" title={r.summary}>{r.summary}</span>
                        </div>
                        <div className="row wrap" style={{ gap: 6 }}>
                          <span className={`lozenge ${r.blocked ? 'blocked' : r.statusCat}`}>{statusLabel(r)}</span>
                          {r.overdue && <span className="chip chip-warn mine-mini">{tr('überfällig', 'overdue')}</span>}
                          {!r.mine && r.assignee && <span className="faint mine-mini">{tr('jetzt', 'now')} {r.assignee.name}</span>}
                          <span className="faint mine-mini">{r.ctxLabel}{(r.start || r.due) ? ` · ${r.start ? fmt.date(r.start) : '…'} – ${r.due ? fmt.date(r.due) : '…'}` : ''}</span>
                          {weekPins.includes(r.id) && r.total === 0 && <button type="button" className="linkbtn mine-mini" onClick={() => unpin(r.id)}>{tr('entfernen', 'remove')}</button>}
                          {r.subtask && r.parent && <button type="button" className="linkbtn mine-mini" onClick={() => pin(r.parent.id)}>{tr(`auf ${r.parent.key} buchen`, `book on ${r.parent.key}`)}</button>}
                        </div>
                      </div>
                      {r.cells.map((c, ci) => (
                        <CellInput key={c.d} row={r} c={c} r={idx} ci={ci} day={sheet.days[ci]} state={saving[`${r.id}|${c.d}`]} book={book} move={move} sug={sugg?.byCell.get(`${r.id}|${c.d}`)} ev={evByCell?.get(`${r.id}|${c.d}`)} applyMany={applyMany}
                          active={open && cell.d === c.d} onPick={() => setCell({ id: r.id, d: c.d })} />
                      ))}
                      <span className="num r" style={{ fontWeight: 650 }}>{r.total ? H(r.total) : '–'}</span>
                      <span className={`num r ${r.open && r.hasEstimate && r.re === 0 ? 'mine-zero' : 'faint'}`} {...tip(r.hasEstimate ? infoCard({ title: r.key, text: tr('Wie in Jira: Remaining Estimate sinkt mit jeder Buchung.', 'As in Jira: the remaining estimate drops with every booking.'), inputs: [['Original Estimate', H(r.oe)], [tr('Gebucht gesamt', 'Logged total'), H(r.ts)], ['Remaining', H(r.re)]] }) : tr('Keine Schätzung in Jira', 'No estimate in Jira'))}>{r.hasEstimate ? H(r.re) : '–'}</span>
                    </div>
                    <AnimatePresence initial={false}>
                      {open && cur && cur.h > 0 && <CommentRow key={cur.d} row={r} c={cur} book={book} onClose={() => setCell(null)} />}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          );
        })}
        <div className="mine-row mine-foot" style={{ gridTemplateColumns: cols }}>
          <span style={{ fontWeight: 650 }}>{tr('Summe', 'Total')}</span>
          {sheet.dayTotals.map((d) => (
            <span key={d.iso} className={`mine-ft r ${d.low ? 'low' : ''} ${noTarget(d) ? 'off' : ''}`} {...tip(d.low ? tr(`Unter der Mindestquote: ${H(d.h)} von ${H(d.possible)} möglich (${sheet.booked.minPct} % = ${H(d.possible * sheet.booked.minPct / 100)})`, `Below the minimum: ${H(d.h)} of ${H(d.possible)} possible (${sheet.booked.minPct} % = ${H(d.possible * sheet.booked.minPct / 100)})`) : dayTip(d))}>
              <b className="num">{H(d.h)}</b><span>{sheet.booked.filtered ? tr('in diesem Projekt', 'in this project') : noTarget(d) ? dayShort(d) : `${tr('von', 'of')} ${H(d.possible)}`}</span>
              {sugg?.perDay[d.iso]?.h > 0 && !sheet.booked.filtered && <button type="button" className="mine-dayfill" disabled={busy} onClick={() => applyMany(sugg.list.filter((x) => x.d === d.iso))} aria-label={tr(`Vorschläge für ${d.wd} übernehmen: ${H(sugg.perDay[d.iso].h)}`, `Take the proposals for ${d.wd}: ${H(sugg.perDay[d.iso].h)}`)}>+{H(sugg.perDay[d.iso].h)}</button>}
            </span>
          ))}
          <b className="num r">{H(sheet.dayTotals.reduce((x, d) => x + d.h, 0))}</b>
          <span />
        </div>
      </div>
      </div>
      <AddTask onPick={(id) => pin(id)} />
      <div className="mine-legend faint">
          <span><i className="lg low" />{tr(`vergangener Tag unter der Mindestquote (${sheet.booked.minPct} %)`, `past day below the minimum (${sheet.booked.minPct} %)`)}</span>
          <span><i className="lg cmt" />{tr('mit Kommentar', 'with comment')}</span>
          <span><i className="lg today" />{tr('heute', 'today')}</span>
          <span><i className="lg ghost" />{tr('Vorschlag – Enter übernimmt', 'proposal – Enter takes it')}</span>
          <span><i className="lg act" />{tr('deine Aktivität in Jira an dem Tag', 'your Jira activity that day')}</span>
          <span>{tr('Buchungen gehen direkt als Worklog nach Jira – mit deinen Rechten.', 'Bookings go straight to Jira as worklogs – with your permissions.')}</span>
      </div>
    </>
  );
}

function CellInput({ row, c, r, ci, day, state, book, move, active, onPick, sug, ev, applyMany }) {
  const [v, setV] = useState(hh(c.h));
  const [bad, setBad] = useState(false);
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setV(hh(c.h)); }, [c.h]);
  const commit = async () => {
    editing.current = false;
    const h = roundQuarter(parseHours(v));
    if (h == null) { setBad(true); return; }
    setBad(false);
    if (Math.abs(h - c.h) < 0.001) { setV(hh(c.h)); return; }
    setV(hh(h));
    const ok = await book(row, c.d, h);
    if (!ok) setV(hh(c.h));
  };
  const ghost = !c.h && sug ? sug : null;
  const label = `${row.key} · ${day.wd} ${fmt.date(c.d)}${c.c ? ` · ${tr('Kommentar', 'Comment')}: ${c.c}` : ''}${c.n > 1 ? ` · ${c.n} ${tr('Buchungen', 'bookings')}` : ''}${ghost ? ` · ${tr('Vorschlag', 'Proposal')} ${H(ghost.h)}: ${reasonText(ghost)} – ${tr('Enter übernimmt', 'Enter takes it')}` : ''}${!ghost && ev?.length ? ` · ${tr('Aktivität', 'Activity')}: ${ev.map(eventText).join('; ')}` : ''}`;
  return (
    <span className="mine-cellwrap">
      <input type="text" inputMode="decimal" className={`mine-cell ${noTarget(day) ? 'off' : ''} ${day.isToday ? 'today' : ''} ${day.isFuture ? 'future' : ''} ${c.c ? 'has-cmt' : ''} ${active ? 'active' : ''} ${bad || state === 'error' ? 'bad' : ''} ${state === 'ok' ? 'ok' : ''} ${ghost && !v ? 'ghost' : ''} ${ev?.length ? 'act' : ''}`}
        placeholder={ghost ? hh(ghost.h) : undefined}
        data-r={r} data-c={ci} value={v} disabled={!row.bookable} aria-label={row.bookable ? label : tr(`${row.key}: Buchung auf Sub-tasks ist noch in Klärung`, `${row.key}: booking on sub-tasks is still being clarified`)}
        title={row.bookable ? (bad ? tr('Bitte Stunden eingeben, z. B. 1,5 oder 1:30 (max. 24)', 'Please enter hours, e.g. 1.5 or 1:30 (max 24)') : label) : tr('Buchung auf Sub-tasks ist noch in Klärung', 'Booking on sub-tasks is still being clarified')}
        onFocus={(e) => e.target.select()} onClick={() => { if (c.h > 0) onPick(); }}
        onChange={(e) => { editing.current = true; setV(e.target.value); setBad(false); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && ghost && !v.trim()) { e.preventDefault(); editing.current = false; applyMany([ghost]); move(e.currentTarget, 1, 0); }
          else if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); move(e.currentTarget, 1, 0); }
          else if (e.key === 'Escape') { editing.current = false; setV(hh(c.h)); setBad(false); e.currentTarget.blur(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); move(e.currentTarget, 1, 0); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); move(e.currentTarget, -1, 0); }
          else if (e.key === 'ArrowRight' && e.currentTarget.selectionStart === e.currentTarget.value.length) { e.preventDefault(); move(e.currentTarget, 0, 1); }
          else if (e.key === 'ArrowLeft' && e.currentTarget.selectionStart === 0) { e.preventDefault(); move(e.currentTarget, 0, -1); }
        }} />
      {state === 'saving' && <span className="mine-spin" aria-hidden="true" />}
    </span>
  );
}

function CommentRow({ row, c, book, onClose }) {
  const [v, setV] = useState(c.c || '');
  const [busy, setBusy] = useState(false);
  const save = async () => { if (v.trim() === (c.c || '').trim()) { onClose(); return; } setBusy(true); const ok = await book(row, c.d, c.h, v.trim(), {}); setBusy(false); if (ok) onClose(); };
  return (
    <motion.div className="mine-cmt" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
      <label className="row wrap" style={{ gap: 10, flex: 1 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{tr('Kommentar', 'Comment')} · {fmt.date(c.d, { weekday: 'short', day: '2-digit', month: '2-digit' })} ({H(c.h)})</span>
        <input className="input input-sm" style={{ flex: '1 1 280px' }} value={v} maxLength={1000} placeholder={tr('Was wurde gemacht?', 'What was done?')} onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } else if (e.key === 'Escape') onClose(); }} autoFocus />
      </label>
      <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>{busy ? tr('Speichere …', 'Saving …') : tr('Fertig', 'Done')}</button>
    </motion.div>
  );
}

function AddTask({ onPick }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hi, setHi] = useState(0);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return undefined; }
    const t = setTimeout(async () => { setBusy(true); try { setRes(await call('mine.search', { query: q.trim() })); setHi(0); } catch { setRes([]); } finally { setBusy(false); } }, 220);
    return () => clearTimeout(t);
  }, [q]);
  const pick = (x) => { onPick(x.id); setQ(''); setRes([]); setOpen(false); };
  return (
    <div className="mine-add">
      <Icon name="plus" size={15} />
      <div style={{ position: 'relative', flex: '1 1 320px' }}>
        <input className="input input-sm" style={{ width: '100%' }} value={q} role="combobox" aria-expanded={open && res.length > 0} aria-controls="mine-add-list" aria-autocomplete="list"
          aria-label={tr('Weitere Aufgabe hinzufügen', 'Add another task')} placeholder={tr('Weitere Aufgabe hinzufügen – Key oder Titel, z. B. ABC-45', 'Add another task – key or title, e.g. ABC-45')}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(res.length - 1, h + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); } else if (e.key === 'Enter' && res[hi]) { e.preventDefault(); pick(res[hi]); } else if (e.key === 'Escape') setOpen(false); }} />
        <AnimatePresence>{open && (res.length > 0 || busy) && (
          <motion.ul id="mine-add-list" role="listbox" className="popover mine-add-list" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {busy && !res.length && <li className="faint" style={{ padding: '8px 12px' }}>{tr('Suche …', 'Searching …')}</li>}
            {res.map((x, i) => <li key={x.id} role="option" aria-selected={i === hi}><button type="button" className="menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(x)}><b className="mono">{x.key}</b> {x.summary}</button></li>)}
          </motion.ul>
        )}</AnimatePresence>
      </div>
      <span className="faint" style={{ fontSize: 12 }}>{tr('erscheint unter „Weitere Aufgaben“ in dieser Woche', 'appears under "Other tasks" this week')}</span>
    </div>
  );
}

// ---------- proposals: reasons and the banner ----------
const at = (e) => (typeof e.at === 'string' && e.at.length >= 16 ? e.at.slice(11, 16) : '');
function eventText(e) {
  const via = e.viaKey ? ` (${tr('über', 'via')} ${e.viaKey})` : '';
  if (e.kind === 'status') return tr(`Status ${e.from} → ${e.to} um ${at(e)}${via}`, `status ${e.from} → ${e.to} at ${at(e)}${via}`);
  if (e.kind === 'comment') return tr(`kommentiert um ${at(e)}${e.text ? `: „${e.text.slice(0, 50)}“` : ''}${via}`, `commented at ${at(e)}${e.text ? `: "${e.text.slice(0, 50)}"` : ''}${via}`);
  return tr(`bearbeitet um ${at(e)} (${(e.fields || []).join(', ')})${via}`, `edited at ${at(e)} (${(e.fields || []).join(', ')})${via}`);
}
function reasonText(sg) {
  if (sg.basis === 'activity') return tr('du hast ', 'you ') + sg.events.map(eventText).join(tr(' und ', ' and '));
  return tr(`geplant – ${sg.status || 'offen'}${sg.due ? `, fällig ${fmt.date(sg.due)}` : ''}`, `planned – ${sg.status || 'open'}${sg.due ? `, due ${fmt.date(sg.due)}` : ''}`);
}
function SmartFill({ sheet, sugg, evidence, evErr, applying, onApply, onHide, hidden, onShow }) {
  const [open, setOpen] = useState(false);
  if (!sheet) return null;
  if (hidden) return <div className="mine-smart quiet"><Icon name="zap" size={14} /><span>{tr('Vorschläge ausgeblendet.', 'Proposals hidden.')}</span><button type="button" className="linkbtn" onClick={onShow}>{tr('Wieder anzeigen', 'Show again')}</button></div>;
  if (evErr) return <div className="mine-smart quiet"><Icon name="info" size={14} /><span>{tr('Deine Jira-Aktivität konnte gerade nicht gelesen werden – Vorschläge sind aus. Buchen geht wie immer.', 'Your Jira activity could not be read right now – proposals are off. Booking works as usual.')}</span></div>;
  if (!evidence) return <div className="mine-smart quiet" aria-live="polite"><span className="mine-spin static" aria-hidden="true" /><span>{tr('Lese deine Jira-Aktivität dieser Woche …', 'Reading your Jira activity of this week …')}</span></div>;
  const gaps = Object.entries(sugg?.perDay || {});
  const missing = gaps.reduce((t, [, x]) => t + x.gap, 0);
  const proposed = sugg?.total || 0;
  const n = sugg ? new Set(sugg.list.map((x) => x.issueId)).size : 0;
  const empty = gaps.filter(([, x]) => x.h === 0).map(([d]) => sheet.days.find((x) => x.iso === d)?.wd).filter(Boolean);
  if (!missing) {
    return <div className="mine-smart done" role="status"><Icon name="check" size={15} /><b>{tr('Bis heute ist alles gebucht.', 'Everything is booked up to today.')}</b><span className="faint">{tr('Nichts fehlt zum Soll.', 'Nothing is missing from the target.')}</span></div>;
  }
  const byDay = sheet.days.map((d) => ({ d, items: (sugg?.list || []).filter((x) => x.d === d.iso) })).filter((x) => x.items.length);
  return (
    <div className="mine-smart" role="region" aria-label={tr('Woche vervollständigen', 'Complete the week')}>
      <div className="mine-smart-main">
        <span className="mine-smart-icon"><Icon name="zap" size={16} /></span>
        <div style={{ minWidth: 0, flex: '1 1 320px' }}>
          <b>{tr('Woche vervollständigen', 'Complete the week')}</b>
          <div className="mine-smart-text">
            {proposed > 0
              ? tr(`Bis heute fehlen dir ${H(missing)} zum Soll. Aus deiner Jira-Aktivität schlagen wir ${H(proposed)} auf ${n} ${n === 1 ? 'Aufgabe' : 'Aufgaben'} vor – grau in den Zellen.`, `Up to today you are ${H(missing)} short of your target. From your Jira activity we propose ${H(proposed)} on ${n} ${n === 1 ? 'task' : 'tasks'} – grey in the cells.`)
              : tr(`Bis heute fehlen dir ${H(missing)} zum Soll – in deiner Jira-Aktivität und Planung gibt es dafür keine Hinweise. Bitte selbst eintragen.`, `Up to today you are ${H(missing)} short – your Jira activity and plan give no hints for it. Please enter it yourself.`)}
            {empty.length > 0 && proposed > 0 && <> {tr(`Für ${empty.join(', ')} gibt es keine Hinweise.`, `No hints for ${empty.join(', ')}.`)}</>}
          </div>
          <div className="faint mine-smart-note">{tr('Regelbasiert aus deinen Statuswechseln, Kommentaren und deiner Planung – keine KI. Gebucht wird erst, wenn du übernimmst.', 'Rule-based from your status changes, comments and plan – no AI. Nothing is booked until you take it.')}</div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {proposed > 0 && <button type="button" className="btn btn-primary btn-sm" disabled={!!applying} onClick={() => onApply(sugg.list)} data-mine-fill>{applying ? tr(`Buche ${applying.n} von ${applying.of} …`, `Booking ${applying.n} of ${applying.of} …`) : tr(`Alle übernehmen · ${H(proposed)}`, `Take all · ${H(proposed)}`)}</button>}
          {proposed > 0 && <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? tr('Weniger', 'Less') : tr('Warum?', 'Why?')}</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onHide}>{tr('Ausblenden', 'Hide')}</button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul className="mine-smart-list" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {byDay.map(({ d, items }) => items.map((x) => (
              <li key={`${x.issueId}|${x.d}`}>
                <span className="mine-smart-day">{d.wd} {fmt.date(d.iso, { day: '2-digit', month: '2-digit' })}</span>
                <b className="num">{H(x.h)}</b>
                <button type="button" className="tkey" onClick={() => openIssue(x.key)}>{x.key}</button>
                <span className="mine-smart-why">{reasonText(x)}</span>
                <button type="button" className="linkbtn" disabled={!!applying} onClick={() => onApply([x])}>{tr('übernehmen', 'take')}</button>
              </li>
            )))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

// First visit only: four short steps on what you can do here. "Verstanden" or × = seen for good (also when
// skipped), per account.
function Intro({ seen }) {
  const [hidden, setHidden] = useState(seen);
  if (hidden) return null;
  const close = () => { setHidden(true); call('prefs.save', { hints: { mine: true } }).catch(() => {}); };
  return (
    <motion.section className="card mine-intro" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} aria-labelledby="mine-intro-t">
      <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
        <h2 className="card-title" id="mine-intro-t"><Icon name="info" />{tr('Deine Woche – so geht’s', 'Your week – how it works')}</h2>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={close} aria-label={tr('Ausblenden – erscheint nicht wieder', 'Hide – will not show again')}><Icon name="x" size={14} /></button>
      </div>
      <ol className="mine-intro-steps">
        <li><b>{tr('Stunden eintippen', 'Type hours')}</b><span>{tr('In die Zelle von Aufgabe und Tag, z. B. 1,5 oder 1:30. Enter speichert direkt in Jira, leer löscht. Mit ‹ › wechselst du die Woche.', 'Into the cell of task and day, e.g. 1.5 or 1:30. Enter saves straight to Jira, empty removes. ‹ › switches the week.')}</span></li>
        <li><b>{tr('Woche vervollständigen', 'Complete the week')}</b><span>{tr('Fehlen dir Stunden zum Soll, schlagen wir sie aus deiner Jira-Aktivität vor – grau in den Zellen, ohne KI. „Warum?“ zeigt den Grund; gebucht wird erst, wenn du übernimmst. Oder sag Lotse „Prüfe meine Buchungen“ – er geht die Woche Schritt für Schritt mit dir durch.', 'If you are short of your target, we propose hours from your Jira activity – grey in the cells, no AI. "Why?" shows the reason; nothing is booked until you take it. Or tell Lotse "Check my bookings" – it walks through the week with you step by step.')}</span></li>
        <li><b>{tr('Fehlende Werte', 'Missing values')}</b><span>{tr('Fehlt an deinen Aufgaben etwas, das die Planung braucht (z. B. Schätzung oder Due Date), steht unten die Box „Fehlende Werte“ – direkt dort ergänzen.', 'If your work items lack something planning needs (e.g. an estimate or a due date), the "Missing values" box below lists it – fill it in right there.')}</span></li>
        <li><b>{tr('Vertippt?', 'Typo?')}</b><span>{tr('Oben rechts zeigt ↶ mit Zahl, wie viele Aktionen du zurücknehmen kannst – ein Klick reicht, oder Strg/⌘ + Z.', 'Top right, ↶ with a number shows how many actions you can take back – one click is enough, or Ctrl/⌘ + Z.')}</span></li>
      </ol>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn btn-primary btn-sm" onClick={close}>{tr('Verstanden', 'Got it')}</button></div>
    </motion.section>
  );
}
