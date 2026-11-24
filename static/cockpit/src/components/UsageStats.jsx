// Konfiguration › Nutzung: how the cockpit is used on this site in the last 30 days – counts only (shared/usage.js):
// events per day, the most used views, Lotse answers and AI features, the undo rate (undone ÷ changes) as a satisfaction
// signal, Lotse vs. AI, and how Lotse and the AI agreed where they worked on the same task. No person, no content.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { enter } from '../lib/motion.js';
import { tr, fmt, getLang } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call } from '../lib/api.js';
import { SKILLS } from '@shared/lotse/skills/index.js';
import { Donut, HBars, Line } from './charts.jsx';
import './Usage.css';

const VIEW = {
  portfolio: ['Portfolio', 'Portfolio'], project: ['Projekte', 'Projects'], team: ['Teams', 'Teams'], proof: ['Nachweis', 'Proof'], deps: ['Abhängigkeiten', 'Dependencies'], time: ['Plan vs. Ist', 'Plan vs. actual'],
  estimate: ['Schätzung', 'Estimate'], plan: ['Wochenplanung', 'Weekly planning'], capacity: ['Kapazität', 'Capacity'], quality: ['Datenqualität', 'Data quality'], support: ['Support', 'Support'], ask: ['Fragen', 'Ask'],
  mine: ['Meine Arbeit', 'My work'], report: ['Report', 'Report'], settings: ['Einstellungen', 'Settings'], config: ['Konfiguration', 'Configuration'],
};
const AI = {
  ask: ['Fragen', 'Ask'], healthDraft: ['Health-Entwurf', 'Health draft'], reportSummary: ['Report-Zusammenfassung', 'Report summary'], planning: ['Wochenplanung', 'Weekly planning'], gaps: ['Fehlende Werte', 'Missing values'],
  dispatch: ['Support-Verteilung', 'Support dispatch'], planActual: ['Plan vs. Ist', 'Plan vs. actual'], teamBrief: ['Team-Lagebild', 'Team briefing'], projectBrief: ['Projekt-Lagebild', 'Project briefing'], myWeek: ['Meine Arbeit', 'My work'],
  intent: ['„Ich will …“', '"I want …"'], similarSummary: ['Schätzen wie früher', 'Estimate like before'], playbookDraft: ['Playbooks', 'Playbooks'], lotse: ['KI-Lesart zu Lotse', 'AI reading of Lotse'],
};
const name = (map, id) => (map[id] ? tr(map[id][0], map[id][1]) : id);
const skillName = (id) => SKILLS[id]?.title(getLang()) || id;

export default function UsageStats() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => { let alive = true; call('usage.summary').then((r) => alive && setD(r), () => alive && setErr(true)); return () => { alive = false; }; }, []);
  const top = d ? [
    ...d.views.map((x) => ({ label: name(VIEW, x.id), value: x.n, color: 'var(--ink)', sub: tr('Ansicht', 'View') })),
    ...d.skills.map((x) => ({ label: `Lotse · ${skillName(x.id)}`, value: x.n, color: 'var(--ok)', sub: 'Lotse' })),
    ...d.aiFeatures.map((x) => ({ label: `${tr('KI', 'AI')} · ${name(AI, x.id)}`, value: x.n, color: 'var(--accent)', sub: tr('KI', 'AI') })),
  ].sort((a, b) => b.value - a.value).slice(0, 8) : [];
  const rate = d?.undo?.rate;
  const tw = d?.teamwork;
  const twN = tw ? tw.same + tw.differs : 0;
  return (
    <section className="us" data-usage aria-labelledby="us-title">
      <div className="us-head">
        <span className="aib-icon"><Icon name="gauge" size={16} /></span>
        <div><b id="us-title">{tr('Nutzung der letzten 30 Tage', 'Usage of the last 30 days')}</b>
          <div className="muted aib-sub">{tr('Nur Zählungen, keine Personen, keine Inhalte – je Tag und Ereignis, nach 30 Tagen gelöscht.', 'Counts only, no people, no content – per day and event, deleted after 30 days.')}</div></div>
      </div>
      {err && <div className="aib-note warn" role="status"><Icon name="info" size={14} /><span>{tr('Die Nutzung konnte gerade nicht geladen werden.', 'Usage could not be loaded right now.')}</span></div>}
      {!d && !err && <div className="ais-skel" aria-busy="true"><span /><span /><span /><span /></div>}
      {d && (
        <motion.div className="us-body" {...enter(0, { y: 6, d: 'gentle' })}>
          <div className="ais-kpis">
            <div className="ais-kpi"><span className="label">{tr('Ereignisse', 'Events')}</span><b className="num">{fmt.n(d.total)}</b><span className="faint">{tr(`an ${d.activeDays} von 30 Tagen`, `on ${d.activeDays} of 30 days`)}</span></div>
            <div className={`ais-kpi ${rate != null && rate > 0.15 ? 'bad' : rate != null ? 'ok' : ''}`}><span className="label">{tr('Rückgängig-Quote', 'Undo rate')}</span><b className="num">{rate == null ? '–' : fmt.pct(rate, 1)}</b><span className="faint">{tr(`${fmt.n(d.undo.undos)} von ${fmt.n(d.undo.writes)} Änderungen`, `${fmt.n(d.undo.undos)} of ${fmt.n(d.undo.writes)} changes`)}</span></div>
            <div className="ais-kpi"><span className="label">{tr('Lotse-Antworten', 'Lotse answers')}</span><b className="num">{fmt.n(d.lotseVsAi.lotse)}</b><span className="faint">{tr(`KI-Aufrufe: ${fmt.n(d.lotseVsAi.ai)}`, `AI calls: ${fmt.n(d.lotseVsAi.ai)}`)}</span></div>
            <div className="ais-kpi"><span className="label">{tr('Lotse und KI einig', 'Lotse and AI agree')}</span><b className="num">{twN ? fmt.pct(tw.same / twN) : '–'}</b><span className="faint">{twN ? tr(`gewählt: Lotse ${tw.pickLotse} · KI ${tw.pickAi}`, `picked: Lotse ${tw.pickLotse} · AI ${tw.pickAi}`) : tr('noch keine gemeinsamen Aufgaben', 'no shared tasks yet')}</span></div>
          </div>
          <div className="ais-charts">
            <div className="ais-chart">
              <div className="label">{tr('Ereignisse je Tag', 'Events per day')}</div>
              <Line labels={d.daily.map((x) => `${+x.day.slice(8)}.`)} series={[{ name: tr('Ereignisse', 'Events'), values: d.daily.map((x) => x.n), color: 'var(--ink)' }]} label={tr('Ereignisse je Tag, letzte 30 Tage', 'Events per day, last 30 days')} height={130} />
            </div>
            {top.length > 0 && (
              <div className="ais-chart">
                <div className="label">{tr('Am meisten genutzt', 'Used most')}</div>
                <HBars items={top} label={tr('Meistgenutzte Ansichten, Lotse-Antworten und KI-Funktionen', 'Most used views, Lotse answers and AI features')} />
              </div>
            )}
            <div className="ais-chart">
              <div className="label">{tr('Lotse und KI', 'Lotse and AI')}</div>
              <Donut size={120} parts={[{ label: 'Lotse', value: d.lotseVsAi.lotse, color: 'var(--ok)' }, { label: tr('KI', 'AI'), value: d.lotseVsAi.ai, color: 'var(--accent)' }]} label={tr('Lotse-Antworten und KI-Aufrufe', 'Lotse answers and AI calls')} center={d.lotseVsAi.lotse + d.lotseVsAi.ai ? fmt.pct(d.lotseVsAi.lotse / (d.lotseVsAi.lotse + d.lotseVsAi.ai)) : '–'} />
            </div>
          </div>
          {d.workflows.length > 0 && (
            <div className="us-flows">
              <div className="label">{tr('Lotse-Abläufe: gestartet → fertig', 'Lotse workflows: started → done')}</div>
              <ul>{d.workflows.map((w) => <li key={w.id}><span className="mono">{w.id}</span><span className="num">{w.start} → {w.done}</span><span className="faint">{w.start ? tr(`${Math.round((w.done / w.start) * 100)} % abgeschlossen, ${w.cancel} abgebrochen`, `${Math.round((w.done / w.start) * 100)}% completed, ${w.cancel} cancelled`) : ''}</span></li>)}</ul>
            </div>
          )}
          <p className="faint aib-how">{tr('Die Rückgängig-Quote zählt jede Änderung im Cockpit (sie bekommt einen Rückgängig-Eintrag) und jedes Rückgängig. Niedrig heißt: Vorschläge und Änderungen passen. Gezählt wird im Browser und alle 30 Sekunden als Summe gesendet.', 'The undo rate counts every change in the cockpit (each gets an undo entry) and every undo. Low means: suggestions and changes fit. Counted in the browser and sent as totals every 30 seconds.')}</p>
        </motion.div>
      )}
    </section>
  );
}
