// C-level report (UC-06): six key figures, running projects by rank, capacity by rank per quarter, the next
// 4 weeks and where the time went. Numbers and wording: shared/reportKpis.js (same as PDF and Confluence).
// Executive summary = teamwork: Lotse's verified summary at once (the composer's summary section, every number a fact),
// and – while AI is on for report summaries – the AI's summary next to it, cross-checked claim by claim in code.
// Motion: transform and opacity only, no exit animations.
import { useEffect, useMemo, useState } from 'react';
import { useLotseCtx } from '../components/lotse/engine.js';
import CrossCheck from '../components/lotse/CrossCheck.jsx';
import { draftSection, plainText, checkStory } from '@shared/lotse/report/compose.js';
import { crossCheck } from '@shared/lotse/crosscheck.js';
import { SKILLS } from '@shared/lotse/skills/index.js';
import { motion } from 'framer-motion';
import { aiOn } from '../lib/aiFlags.js';
import { useApp, errText } from '../state.jsx';
import { tr, fmt, healthName, getLang } from '../lib/i18n.js';
import { Icon, Logo } from '../lib/icons.jsx';
import { call, openUrl } from '../lib/api.js';
import { Stat, Empty, Modal, Skeleton, Segmented, stagger, useTip, infoCard } from '../components/ui.jsx';
import { LotseChip, LotseMark } from '../components/lotse/LotseChip.jsx';
import ReportComposerHost from '../components/report/Host.jsx';
import { openReportComposer } from '../components/report/open.js';
import { Md } from './Assistant.jsx';
import { exportEverything } from '../lib/books.js';
import { reportKpis, reportExtras, reportForViewer } from '@shared/reportKpis.js';
import './Report.css';
import { track } from '../lib/usage.js';

const EASE = [0.22, 1, 0.36, 1];
const TERM_CHIP = { bad: 'chip-bad', warn: 'chip-warn', ok: 'chip-ok', soft: 'chip-outline' };
const toneClass = (t) => (t === 'bad' ? 'rp-bad' : t === 'warn' ? 'rp-warn' : '');

// A bar that grows from the left: scaleX only (no layout work while it animates).
function Bar({ value, tone, delay = 0, max = 1 }) {
  const v = Math.max(0, Math.min(1, (Number.isFinite(value) ? value : 0) / max));
  return (
    <span className="rp-bar" aria-hidden="true">
      <motion.i className={tone ? `rp-fill-${tone}` : undefined} initial={{ scaleX: 0 }} animate={{ scaleX: v }} transition={{ duration: 0.9, ease: EASE, delay }} />
    </span>
  );
}

export default function Report() {
  const app = useApp();
  const { toast, config, roles, computed } = app;
  const tip = useTip();
  const [r, setR] = useState(null);
  const [pa, setPa] = useState(null);
  const [aiText, setAiText] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [publish, setPublish] = useState(false);
  const [q, setQ] = useState(null);
  useEffect(() => { call('report.get').then(setR).catch(setErr); }, []);
  // Plan vs. actual: from the snapshot; older snapshots without it load it here (only with the "Plan vs. Ist" tab).
  useEffect(() => {
    if (!r || r.extra?.planActual || !(roles?.admin || (roles?.rights || []).includes('hours'))) return;
    call('planActual.get', { weeks: 4, team: 'all' }).then(setPa).catch(() => setPa(null));
  }, [r, roles]);
  const lang = getLang();
  // The report as this viewer may see it; a snapshot without extras borrows them from the loaded dataset.
  const rep = useMemo(() => {
    if (!r) return null;
    let x = r;
    if (!r.extra && computed) { try { x = { ...r, ...reportExtras(computed, config, pa) }; } catch { x = r; } }
    return reportForViewer(x, roles);
  }, [r, computed, config, pa, roles]);
  const v = useMemo(() => (rep ? reportKpis({ report: rep, planActual: pa, lang, cfg: config }) : null), [rep, pa, lang, config]);
  const quarter = q && v?.waterline.byQ[q] ? q : v?.waterline.defaultQ;

  const pdf = async () => {
    setPdfBusy(true);
    track('report:pdf');
    try { const { downloadReportPdf } = await import('../lib/pdf.js'); await downloadReportPdf(rep, { summary: aiText, planActual: pa }); } catch (e) { toast({ text: errText(e), error: true }); } finally { setPdfBusy(false); }
  };
  const refresh = async () => { setBusy(true); try { setR(await call('report.refresh')); toast({ text: tr('Report neu berechnet', 'Report recomputed') }); } catch (e) { toast({ text: errText(e), error: true }); } finally { setBusy(false); } };

  if (err) return <div className="page noaccess"><Empty icon="lock" title={tr('Kein Zugriff', 'No access')}>{err.code === 'NO_ACCESS' ? tr('Der C-Level-Report ist nur für freigegebene Rollen sichtbar.', 'The C-level report is only visible to enabled roles.') : err.message}</Empty></div>;
  if (!v) return <div className="page"><Skeleton h={96} r={14} /><div className="stats">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="stat"><Skeleton h={11} w={90} /><Skeleton h={30} w={100} style={{ marginTop: 12 }} /></div>)}</div><Skeleton h={360} r={14} /></div>;

  const wl = quarter ? v.waterline.byQ[quarter] : null;
  const u = v.util4;
  const f = v.flows;
  return (
    <div className="page rp-page">
      <motion.section className="card rp-head" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
        {/* title block first with the room it needs; the actions get their own row – the composer as the one primary action,
            the exports next to it, Lotse and recompute at the end (boss feedback 2026-11-12: the title was squeezed to one word per line) */}
        <div className="rp-title">
          <div className="rp-logo"><Logo size={36} /></div>
          <div className="rp-title-text">
            <div className="eyebrow">{tr('C-Level-Report', 'C-level report')}</div>
            <h1 className="h1" style={{ marginTop: 3 }}>{tr('Management-Report Portfolio', 'Management report portfolio')}</h1>
            <div className="rp-subline">
              {tr('Stand', 'As of')} {fmt.dateTime(r.asOf)}, {tr('täglich berechnet', 'computed daily')} · {tr('alle Projekte', 'all projects')} · {tr('freigegeben für', 'shared with')} {v.header.audience}
            </div>
          </div>
        </div>
        <div className="no-print rp-actions" role="group" aria-label={tr('Report-Aktionen', 'Report actions')}>
          <button className="btn btn-primary rp-primary" onClick={() => openReportComposer({})} data-rc-open title={tr('Lotse entwirft den Report aus euren Daten – du formst ihn und lädst ihn als PDF herunter', 'Lotse drafts the report from your data – you shape it and download it as PDF')}><LotseMark size={15} />{tr('Mit Lotse zusammenstellen', 'Compose with Lotse')}</button>
          <div className="rp-actions-sec">
            <button className="btn" onClick={pdf} disabled={pdfBusy}><Icon name="pdf" />{pdfBusy ? tr('Erstelle PDF …', 'Creating PDF …') : tr('Als PDF exportieren', 'Export as PDF')}</button>
            <button className="btn" onClick={() => setPublish(true)}><Icon name="send" />{tr('In Confluence veröffentlichen', 'Publish to Confluence')}</button>
            {app.ds && <button className="btn" onClick={() => exportEverything(app).catch((e) => toast({ text: errText(e), error: true }))} title={tr('Alle Daten als Excel-Arbeitsmappe', 'All data as an Excel workbook')}><Icon name="download" />Excel</button>}
          </div>
          <div className="rp-actions-aux">
            <LotseChip skill="portfolioBrief" params={{ audience: 'clevel' }} label={tr('Lotse: Lage für die Geschäftsführung', 'Lotse: briefing for management')} />
            <button className="btn btn-ghost" disabled={busy} onClick={refresh}><Icon name="refresh" />{busy ? tr('Berechne …', 'Computing …') : tr('Neu berechnen', 'Recompute')}</button>
          </div>
        </div>
      </motion.section>

      <ExecSummary report={rep} planActual={pa} asOf={r.asOf} onText={setAiText} />


      <div className="stats rp-stats">
        {v.tiles.map((t, i) => (
          <Stat key={t.id} i={i} label={t.label} hot={t.tone === 'bad'}
            value={t.kind === 'text' ? <span className="rp-pending">{t.display}</span> : t.value}
            format={t.kind === 'pct' ? (x) => fmt.pct(x) : (x) => fmt.n(x)}
            foot={t.sub} explain={t.explain} />
        ))}
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title"><Icon name="ranking" />{tr('Laufende Projekte nach Rang', 'Running projects by rank')}
            <span className="rp-info" tabIndex={0} {...tip(infoCard({ title: tr('Fortschritt und Prognose', 'Progress and forecast'), text: `${v.progressFormula}. ${tr(`Prognose = (Time Spent + Remaining Estimate) gegen Original Estimate; ab +${v.thresholdPct} % gilt sie als Mehraufwand.`, `Forecast = (time spent + remaining estimate) against original estimate; from +${v.thresholdPct}% it counts as extra effort.`)}` }))}><Icon name="info" size={14} /></span>
          </h2>
          <span className="card-sub">{tr(`${v.rows.length} aktive Projekte`, `${v.rows.length} active projects`)}</span>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label={tr('Tabelle, mit Pfeiltasten scrollbar', 'Table, scrollable with arrow keys')}>
          <table className="table rp-table">
            <thead><tr><th>{tr('Rang', 'Rank')}</th><th>{tr('Projekt', 'Project')}</th><th>Health</th><th>Due Date</th><th>{tr('Fortschritt', 'Progress')}</th><th className="r">{tr('Prognose', 'Forecast')}</th><th>{tr('Termin', 'Schedule')}</th></tr></thead>
            <tbody>{v.rows.map((x, i) => (
              <motion.tr key={x.ref} {...stagger(i, 0.03)}>
                <td><b className="num">{x.rank}</b></td>
                <td className="rp-proj">
                  <b>{x.name}</b>
                  <div className="muted rp-meta"><span className="mono">{x.key}</span>{x.owner ? ` · ${x.owner}` : ''}</div>
                  {x.waitText && <div className={`rp-wait ${x.waitHot ? 'hot' : ''}`} tabIndex={0} {...tip(infoCard({ title: tr('Abhängigkeit', 'Dependency'), text: tr('Offene Verknüpfungen der konfigurierten Link-Typen zu einem anderen Portfolio-Projekt. Orange: ein Termin kollidiert oder die Voraussetzung hat einen niedrigeren Rang.', 'Open links of the configured link types to another portfolio project. Orange: a date collides or the prerequisite ranks lower.'), calc: x.waitText }))}><Icon name="link" size={12} />{x.waitText}</div>}
                </td>
                <td><span className="row" style={{ gap: 6, whiteSpace: 'nowrap' }}><span className={`health ${x.health || 'none'}`} />{healthName(x.health)}</span></td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>{fmt.dateLong(x.due)}{x.daysOverdue > 0 && <div className="rp-late">+{x.daysOverdue} {tr('Tage über Due', 'days past due')}</div>}</td>
                <td className="rp-progress">
                  <div className="row" style={{ gap: 10 }}><Bar value={x.progress} delay={0.1 + Math.min(i, 12) * 0.03} /><b className="num rp-pct">{fmt.pct(x.progress)}</b></div>
                  <div className="faint rp-meta">{x.progressSub}</div>
                </td>
                <td className={`r num ${x.overrun ? 'rp-bad' : ''}`} tabIndex={0} {...tip(infoCard({ title: tr('Prognose', 'Forecast'), text: tr('Erwartete Stunden (Time Spent + Remaining Estimate) gegen das Original Estimate.', 'Expected hours (time spent + remaining estimate) against the original estimate.'), calc: x.OE > 0 ? `(${fmt.h(x.TS)} + ${fmt.h(x.RE)}) ÷ ${fmt.h(x.OE)} − 1 = ${x.progText}` : tr('Kein Original Estimate – keine Prognose.', 'No original estimate – no forecast.') }))}><b style={{ fontWeight: 580 }}>{x.progText}</b></td>
                <td><span className={`chip ${TERM_CHIP[x.term.tone]}`} style={{ whiteSpace: 'nowrap' }}>{x.term.text}</span></td>
              </motion.tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2 className="card-title"><Icon name="waves" />{tr('Kapazität nach Rangfolge', 'Capacity by rank')}
              <span className="rp-info" tabIndex={0} {...tip(infoCard({ title: tr('Kapazität nach Rangfolge', 'Capacity by rank'), text: tr('Wie die Wasserlinie im Portfolio: Support zuerst, dann werden die Projekte je Team in Rangfolge mit Kapazität aufgefüllt. Prozent = Bedarf gegen Kapazität des Teams im Quartal.', 'Like the waterline in the portfolio: support first, then each team\'s capacity is filled with the projects in rank order. Percent = demand against the team\'s capacity in the quarter.') }))}><Icon name="info" size={14} /></span>
            </h2>
            {v.waterline.quarters.length > 1 && <Segmented size="sm" label={tr('Quartal', 'Quarter')} value={quarter} onChange={setQ} options={v.waterline.quarters.map((x) => ({ value: x, label: fmt.quarter(x) }))} />}
          </div>
          {wl ? (
            <motion.div key={quarter} className="rp-pad" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: EASE }}>
              <div className="rp-headline">{wl.headline}</div>
              {wl.teams.map((t, i) => (
                <motion.div key={t.teamId || t.name} className="rp-wl-row" {...stagger(i, 0.04)}>
                  <b>{t.name}</b>
                  <span className={`num rp-wl-util ${toneClass(t.tone)}`}>{t.utilText}</span>
                  <span className="rp-wl-text">{t.sentence}</span>
                </motion.div>
              ))}
            </motion.div>
          ) : <div className="rp-pad muted">{tr('Noch keine Kapazitäten gepflegt.', 'No capacities maintained yet.')}</div>}
        </section>

        <section className="card">
          <div className="card-head">
            <h2 className="card-title"><Icon name="gauge" />{tr('Auslastung nächste 4 Wochen', 'Utilisation next 4 weeks')}
              <span className="rp-info" tabIndex={0} {...tip(infoCard({ title: tr('Auslastung nächste 4 Wochen', 'Utilisation next 4 weeks'), text: tr('Wie in der Wochenplanung: Support und Tasks gegen die Wochenstunden abzüglich Urlaub, Feiertagen und Tagesgeschäft – je Team.', 'As in weekly planning: support and tasks against weekly hours minus vacation, public holidays and daily business – per team.'), calc: u.load != null ? `${fmt.h(u.load)} ÷ ${fmt.h(u.avail)} = ${fmt.pct(u.avg)}` : null }))}><Icon name="info" size={14} /></span>
            </h2>
            <span className="card-sub">{u.weekLabels.length ? `${u.weekLabels[0]}–${u.weekLabels.at(-1)}` : ''}</span>
          </div>
          <div className="rp-pad">
            {u.teams.length === 0 && <div className="muted">{tr('Noch keine Kapazitäten gepflegt.', 'No capacities maintained yet.')}</div>}
            {u.teams.map((t, i) => (
              <div key={t.teamId || t.name} className="rp-util-row" tabIndex={0} {...tip(infoCard({ title: t.name, text: tr('Je Woche: Support + Tasks ÷ verfügbare Stunden.', 'Per week: support + tasks ÷ available hours.'), inputs: u.weekLabels.map((w, k) => [w, fmt.pct(t.u?.[k])]), calc: t.noCap ? `${fmt.h(t.load)} ${tr('geplant', 'planned')}, 0 h ${tr('verfügbar', 'available')} – ${t.reason}` : t.load != null ? `${fmt.h(t.load)} ÷ ${fmt.h(t.avail)} = ${t.utilText}` : null }))}>
                <span className="rp-util-name">{t.name}{t.reason && <span className="faint rp-meta" style={{ display: 'block' }}>{t.reason}</span>}</span>
                <span className="rp-util-track"><Bar value={t.util ?? (t.noCap ? 1.5 : 0)} max={1.5} tone={t.tone === 'bad' ? 'bad' : null} delay={i * 0.05} /><span className="rp-mark" title="100 %" /></span>
                <b className={`num rp-util-pct ${toneClass(t.tone)}`}>{t.utilText}</b>
              </div>
            ))}
            {u.personLevel && u.persons.length > 0 && (
              <div className="rp-persons">
                <div className="eyebrow">{tr('Personen über 100 %', 'People over 100%')}</div>
                {u.persons.slice(0, 6).map((p, i) => (
                  <motion.div key={p.id} className="rp-person" {...stagger(i, 0.04)}>
                    <span><span>{p.name}</span> <span className="muted">· {p.team}</span><div className="faint rp-meta">{p.weeksText}</div></span>
                    <span className="chip chip-warn">{p.maxText}</span>
                  </motion.div>
                ))}
                {u.persons.length > 6 && <div className="faint rp-meta" style={{ paddingTop: 8 }} tabIndex={0} {...tip(infoCard({ title: tr('Personen über 100 %', 'People over 100%'), items: u.persons.map((p) => ({ text: `${p.name} · ${p.team}`, sub: `${p.weeksText} · ${p.maxText}`, tone: 'bad' })) }))}>{tr(`+ ${u.persons.length - 6} weitere`, `+ ${u.persons.length - 6} more`)}</div>}
              </div>
            )}
            {!u.personLevel && u.teamsOver.length > 0 && <div className="faint rp-meta" style={{ marginTop: 10 }}>{tr(`${u.teamsOver.length} ${u.teamsOver.length === 1 ? 'Team' : 'Teams'} über 100 % – Einzelwerte von Personen sind für dich nicht freigegeben.`, `${u.teamsOver.length} ${u.teamsOver.length === 1 ? 'team' : 'teams'} over 100% – individual values of people are not enabled for you.`)}</div>}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title"><Icon name="clock" />{tr('Wohin floss die Zeit?', 'Where did the time go?')} <span className="rp-sep">·</span> <span className="rp-light">{tr('letzte 4 Wochen', 'last 4 weeks')}</span>
            <span className="rp-info" tabIndex={0} {...tip(infoCard({ title: tr('Wohin floss die Zeit?', 'Where did the time go?'), text: tr('Aus „Plan vs. Ist“: geplant laut Wochen-Snapshot gegen gebuchte Stunden aller Teams. Erklärt, warum sich Projekte verschieben.', 'From "Plan vs. actual": planned per weekly snapshot against booked hours of all teams. Explains why projects slip.') }))}><Icon name="info" size={14} /></span>
          </h2>
          {f.ready && <span className="card-sub">{f.period}{f.provisional ? ` · ${tr('letzte Woche vorläufig', 'last week provisional')}` : ''}</span>}
        </div>
        <div className="rp-pad">
          {!f.ready ? (
            <div className="rp-calm"><Icon name="calendar" size={18} /><span>{f.note}</span></div>
          ) : (
            <>
              <div className="muted rp-meta" style={{ marginBottom: 12 }}>{f.note}</div>
              {f.rows.map((x, i) => (
                <div key={x.id} className="rp-flow-row">
                  <span>{x.label}</span>
                  <Bar value={x.h} max={f.max} delay={i * 0.06} />
                  <b className="num">{fmt.h(x.h)}</b>
                </div>
              ))}
            </>
          )}
        </div>
      </section>
      <PublishModal open={publish} onClose={() => setPublish(false)} />
      <ReportComposerHost report={rep} planActual={pa} />
    </div>
  );
}

function PublishModal({ open, onClose }) {
  const { toast } = useApp();
  const [spaces, setSpaces] = useState(null);
  const [space, setSpace] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(`${tr('Portfolio-Report', 'Portfolio report')} ${new Date().toISOString().slice(0, 10)}`);
    call('confluence.spaces', {}).then(setSpaces).catch(() => setSpaces({ available: false }));
  }, [open]);
  const go = async () => {
    setBusy(true);
    try {
      const page = await call('report.publish', { spaceId: space, title, lang: getLang() });
      onClose();
      toast({ text: tr('In Confluence veröffentlicht', 'Published to Confluence'), icon: 'send' });
      if (page.url) openUrl(page.url);
    } catch (e) { toast({ text: errText(e), error: true }); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} icon="send" title={tr('In Confluence veröffentlichen', 'Publish to Confluence')} sub={tr('Neue Seite mit dem aktuellen Stand – du brauchst Schreibrechte im Space. Einzelwerte von Personen werden nicht veröffentlicht. Die einzige Aktion ohne Rückgängig: Die App darf keine Seiten löschen; entfernen kannst du sie in Confluence.', 'New page with the current state – you need write access in the space. Individual values of people are not published. The one action without undo: the app may not delete pages; you can remove it in Confluence.')}
      footer={<><button className="btn btn-ghost" onClick={onClose}>{tr('Abbrechen', 'Cancel')}</button><button className="btn btn-primary" disabled={!space || !title.trim() || busy || !spaces?.available} onClick={go}>{busy ? tr('Veröffentliche …', 'Publishing …') : tr('Veröffentlichen', 'Publish')}</button></>}>
      {spaces == null ? <Skeleton h={80} /> : spaces.available && spaces.approvedCount === 0 ? (
        <div className="callout"><Icon name="lock" />{tr('Veröffentlichen in Confluence ist für diese Site nicht eingerichtet – den Report als PDF exportieren und teilen.', 'Publishing to Confluence is not set up for this site – export the report as a PDF and share it.')}</div>
      ) : !spaces.available ? (
        <div className="callout accent"><Icon name="info" />{tr('Confluence ist für diese App noch nicht verbunden. Bitte die App zusätzlich in Confluence installieren – bis dahin den Report als PDF exportieren.', 'Confluence is not connected for this app yet. Install the app in Confluence too – until then, export the report as PDF.')}</div>
      ) : (
        <div className="stack">
          <div><label className="label" htmlFor="pub-space">Space</label><select id="pub-space" className="select" style={{ width: '100%' }} value={space} onChange={(e) => setSpace(e.target.value)}><option value="">{tr('Space wählen …', 'Choose space …')}</option>{spaces.spaces.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.key})</option>)}</select></div>
          <div><label className="label" htmlFor="pub-title">{tr('Seitentitel', 'Page title')}</label><input id="pub-title" className="input" style={{ width: '100%' }} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></div>
        </div>
      )}
    </Modal>
  );
}

// Lotse first (instant, every number verified), the AI next to it when switched on – its claims checked against
// Lotse's facts in code (no second AI call). The verified summary always wins; the AI text is never shown unchecked.
function ExecSummary({ report, planActual, asOf, onText }) {
  const { config } = useApp();
  const lctx = useLotseCtx();
  const lang = getLang();
  const [lotse, setLotse] = useState(null);
  useEffect(() => {
    if (!lctx || !report) return undefined;
    let alive = true;
    // a macrotask: the page paints first, then Lotse writes (a few hundred ms on big portfolios)
    const t = setTimeout(() => {
      let sec = null, story = null;
      try { sec = draftSection('summary', { ctx: { ...lctx, report, planActual: planActual || null, now: Date.now() }, audience: 'c-level', lang }); } catch { sec = null; }
      try { story = SKILLS.portfolioBrief.run(lctx, { audience: 'clevel' }, lang); } catch { story = null; }
      if (alive) setLotse({ sec, story, text: sec ? plainText(sec) : '' });
    }, 24);
    return () => { alive = false; clearTimeout(t); };
  }, [lctx, report, planActual, lang]);
  const ai = aiOn(config, 'reportSummary');
  return (
    <div className={`rp-exec ${ai ? 'with-ai' : ''}`}>
      <motion.section className="card rp-lotse" aria-labelledby="rp-lotse-h" aria-busy={!lotse} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <h2 className="card-title" id="rp-lotse-h"><LotseMark size={16} />{tr('Executive Summary · Lotse', 'Executive summary · Lotse')}</h2>
          <button className="btn btn-sm btn-ghost no-print" onClick={() => openReportComposer({ sections: ['summary', 'kpis', 'portfolio', 'waterline', 'late', 'capacity', 'support', 'risks'] })}><Icon name="report" size={13} />{tr('Im Composer weiterschreiben', 'Continue in the composer')}</button>
        </div>
        {!lotse ? (
          <div className="stack" style={{ gap: 6, marginTop: 10 }} aria-hidden="true"><Skeleton h={12} /><Skeleton h={12} w="92%" /><Skeleton h={12} w="70%" /></div>
        ) : lotse.text ? (
          <motion.div key={lotse.text} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
            <p className="rp-lotse-text">{lotse.text}</p>
            <div className="faint rp-note"><Icon name="shield" size={12} />{tr(`Jede Zahl stammt aus den Daten (${lotse.sec?.facts?.length || 0} geprüfte Werte) – ohne KI.`, `Every number comes from the data (${lotse.sec?.facts?.length || 0} verified values) – no AI.`)}</div>
          </motion.div>
        ) : <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{tr('Für eine Zusammenfassung fehlen noch Daten.', 'There is not enough data for a summary yet.')}</div>}
        {lotse?.story && <CrossCheck story={lotse.story} />}
      </motion.section>
      {ai && <AiSummary asOf={asOf} onText={onText} lotse={lotse} />}
    </div>
  );
}

function AiSummary({ asOf, onText, lotse }) {
  const { toast, lang } = useApp();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setS(null); }, [asOf, lang]); // a summary in the other language is not shown after switching
  useEffect(() => { onText?.(s?.text || null); }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const gen = async () => { setBusy(true); try { setS(await call('ai.reportSummary', { lang: getLang() })); } catch (e) { toast({ text: errText(e), error: true }); } finally { setBusy(false); } };
  // the code cross-check: every number, key, team and date the AI names against Lotse's verified facts
  const cc = useMemo(() => {
    if (!s?.text || !lotse?.sec) return null;
    const text = String(s.text).replace(/\*\*(.+?)\*\*/g, '$1');
    try { return crossCheck(checkStory(lotse.sec), text, { lang: getLang() }); } catch { return null; }
  }, [s, lotse]);
  const wrong = (cc?.claims || []).filter((c) => c.verified === false);
  const ok = (cc?.claims || []).filter((c) => c.verified === true).length;
  return (
    <motion.section className="card rp-ai" aria-labelledby="rp-ai-h" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE, delay: 0.06 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 className="card-title" id="rp-ai-h"><Icon name="sparkle" style={{ color: 'var(--accent-strong)' }} />{tr('Lesart der KI', 'The AI\'s reading')}</h2>
        <button className="btn btn-sm no-print" disabled={busy} onClick={gen}><Icon name="sparkle" size={13} />{busy ? tr('Analysiere …', 'Analysing …') : s ? tr('Neu formulieren', 'Regenerate') : tr('Mit KI zusammenfassen', 'Summarize with AI')}</button>
      </div>
      {s ? (
        <motion.div key={s.text} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 8, fontSize: 14 }}>
          <Md text={s.text} />
          {s.source === 'ai' && cc && (
            <div className={`rp-verdict ${wrong.length ? 'differs' : 'agrees'}`} role="status">
              <Icon name={wrong.length ? 'alert' : 'check'} size={13} />
              <span>{wrong.length
                ? tr(`Gegenprüfung: ${wrong.length} ${wrong.length === 1 ? 'Angabe weicht' : 'Angaben weichen'} von Lotses geprüften Zahlen ab – ${wrong.slice(0, 3).map((c) => `„${c.text}“${c.expected ? ` (geprüft: ${c.expected})` : ''}`).join(', ')}. Es gilt Lotses Fassung.`, `Cross-check: ${wrong.length} ${wrong.length === 1 ? 'claim differs' : 'claims differ'} from Lotse's verified numbers – ${wrong.slice(0, 3).map((c) => `"${c.text}"${c.expected ? ` (verified: ${c.expected})` : ''}`).join(', ')}. Lotse's version applies.`)
                : ok ? tr(`Gegenprüfung: Lotse und KI stimmen überein – ${ok} ${ok === 1 ? 'Angabe' : 'Angaben'} geprüft.`, `Cross-check: Lotse and the AI agree – ${ok} ${ok === 1 ? 'claim' : 'claims'} checked.`)
                : tr('Gegenprüfung: Die KI nennt keine Zahl, die sich prüfen ließe.', 'Cross-check: the AI names no number that could be checked.')}</span>
            </div>
          )}
          <div className="faint" style={{ fontSize: 11.5, marginTop: 6 }}>{s.source === 'ai' ? tr('KI-generiert aus dem Report-Stand – bitte vor Weitergabe prüfen.', 'AI-generated from the report snapshot – please verify before sharing.') : tr('Automatische Zusammenfassung (KI derzeit nicht verfügbar).', 'Automatic summary (AI currently unavailable).')}</div>
        </motion.div>
      ) : <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{tr('Lass die KI die Lage zusätzlich in fünf Punkten formulieren – die App prüft jede Zahl gegen Lotses Fassung.', 'Let the AI also put the situation in five bullets – the app checks every number against Lotse\'s version.')}</div>}
    </motion.section>
  );
}
