// Konfiguration › KI & Datenschutz › "Ausgaben": what Forge LLM cost on this site – this month day by day against the
// budget, a month-end forecast, the last six months, per feature, per answer and what reusing answers saved – plus the
// links to Atlassian's own figures, so anyone can double-check. The numbers are the app's own meter (tokens Atlassian
// reports × Atlassian's price list); the binding bill is Atlassian's invoice to SUPERPORT in the developer console.
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { enter } from '../lib/motion.js';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call, openUrl } from '../lib/api.js';
import { Columns, HBars, Line } from './charts.jsx';

const APP_ID = '083d5c93-0586-481d-9c13-6e085bdfad84';
const eur = (v, d) => (v == null ? '–' : v > 0 && v < 0.01 && d == null ? `< ${fmt.n(0.01, 2)} €` : `${fmt.n(v, d ?? (v < 10 ? 2 : 0))} €`);
const NAMES = {
  ask: ['Fragen', 'Ask'], healthDraft: ['Health-Entwurf', 'Health draft'], reportSummary: ['Report-Zusammenfassung', 'Report summary'], planning: ['Wochenplanung', 'Weekly planning'],
  gaps: ['Fehlende Werte', 'Missing values'], dispatch: ['Support-Verteilung', 'Support dispatch'], planActual: ['Plan vs. Ist', 'Plan vs. actual'], teamBrief: ['Team-Lagebild', 'Team briefing'],
  projectBrief: ['Projekt-Lagebild', 'Project briefing'], myWeek: ['Meine Arbeit', 'My work'], intent: ['„Ich will …“', '"I want …"'], similarSummary: ['Schätzen wie früher', 'Estimate like before'], playbookDraft: ['Playbooks', 'Playbooks'],
};
const nameOf = (k) => (NAMES[k] ? tr(NAMES[k][0], NAMES[k][1]) : k);
export const SPEND_LINKS = () => [
  [`https://developer.atlassian.com/console/myapps/${APP_ID}`, tr('Atlassian Developer Console – Usage and costs', 'Atlassian developer console – Usage and costs'), tr('Die echte Abrechnung (für SUPERPORT als App-Anbieter): links „Usage and costs“ wählen; täglich um 12:00 UTC aktualisiert, mit Aufteilung je Site.', 'The real bill (for SUPERPORT as the app vendor): choose "Usage and costs" on the left; updated daily at 12:00 UTC, with a breakdown per site.')],
  ['https://developer.atlassian.com/platform/forge/runtime-reference/forge-llms-api-pricing/', tr('Forge LLM – Preisliste von Atlassian', 'Forge LLM – Atlassian\'s price list'), tr('Die Preise je 1 Mio. Tokens, mit denen diese App rechnet.', 'The prices per 1M tokens this app calculates with.')],
  ['https://developer.atlassian.com/platform/forge/forge-platform-pricing/', tr('Forge-Plattform – Preise', 'Forge platform – pricing'), tr('Rechenzeit, Speicher, Logs: die übrigen Kosten einer Forge-App.', 'Compute, storage, logs: the other costs of a Forge app.')],
  ['https://developer.atlassian.com/platform/forge/usage-alerts/', tr('Nutzungs-Warnungen von Atlassian', 'Usage alerts by Atlassian'), tr('Atlassian mailt bei 50 / 75 / 90 / 100 % des Freikontingents – keine Euro-Grenze. Die harte Grenze für KI ist das Budget oben.', 'Atlassian e-mails at 50 / 75 / 90 / 100 % of the free allowance – not a euro limit. The hard limit for AI is the budget above.')],
];

export default function AiSpend() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => { let alive = true; call('ai.spend').then((r) => alive && setD(r), () => alive && setErr(true)); return () => { alive = false; }; }, []);
  const v = d?.view;
  const monthName = (ym) => fmt.date(`${ym}-01`, { month: 'short' });
  return (
    <section className="ais" data-ai-spend aria-labelledby="ais-title">
      <div className="ais-head">
        <span className="aib-icon"><Icon name="ranking" size={16} /></span>
        <div><b id="ais-title">{tr('Ausgaben für KI auf dieser Site', 'AI spending on this site')}</b>
          <div className="muted aib-sub">{tr('Gemessen von der App: Tokens, die Atlassian zu jeder Antwort meldet, × Atlassians Preisliste.', 'Measured by the app: the tokens Atlassian reports for every answer × Atlassian\'s price list.')}</div></div>
      </div>
      {err && <div className="aib-note warn" role="status"><Icon name="info" size={14} /><span>{tr('Die Ausgaben konnten gerade nicht geladen werden.', 'The spending could not be loaded right now.')}</span></div>}
      {!v && !err && <div className="ais-skel" aria-busy="true"><span /><span /><span /><span /></div>}
      {v && (
        <motion.div className="ais-body" {...enter(0, { y: 6, d: 'gentle' })}>
          <div className="ais-kpis">
            <div className="ais-kpi"><span className="label">{tr('Diesen Monat', 'This month')}</span><b className="num">{eur(v.usedEur)}</b><span className="faint">{tr(`von ${eur(v.limitEur)} Budget`, `of ${eur(v.limitEur)} budget`)}</span></div>
            <div className={`ais-kpi ${v.forecastOver ? 'bad' : ''}`}><span className="label">{tr('Prognose Monatsende', 'Forecast month end')}</span><b className="num">{v.forecastEur == null ? '–' : eur(v.forecastEur)}</b>
              <span className="faint">{v.forecastEur == null ? tr('ab dem 3. Tag des Monats', 'from day 3 of the month') : v.forecastOver ? tr('über dem Budget – die KI pausiert vorher', 'over budget – AI pauses before that') : tr('im aktuellen Tempo', 'at the current pace')}</span></div>
            <div className="ais-kpi"><span className="label">{tr('Je Antwort', 'Per answer')}</span><b className="num">{v.perAnswerEur == null ? '–' : eur(v.perAnswerEur, 3)}</b><span className="faint">{tr(`${fmt.n(v.calls)} Antworten`, `${fmt.n(v.calls)} answers`)}</span></div>
            <div className="ais-kpi ok"><span className="label">{tr('Gespart durch Wiederverwendung', 'Saved by reuse')}</span><b className="num">{eur(v.savedEur)}</b><span className="faint">{tr(`${fmt.n(v.cacheHits)} Antworten kostenlos`, `${fmt.n(v.cacheHits)} answers free`)}</span></div>
          </div>
          <div className="ais-charts">
            <div className="ais-chart">
              <div className="label">{tr(`Verlauf im ${fmt.date(`${v.month}-01`, { month: 'long' })} – aufsummiert, gestrichelt: Budget`, `${fmt.date(`${v.month}-01`, { month: 'long' })} so far – cumulative, dashed: budget`)}</div>
              <Line labels={v.daily.map((x) => `${+x.day}.`)} series={[{ name: tr('Ausgegeben', 'Spent'), values: v.cumulative, color: 'var(--accent)' }]} target={v.limitEur} format={(x) => eur(x)} label={tr('KI-Ausgaben aufsummiert je Tag', 'AI spending cumulative per day')} height={140} domain={[0, Math.max(v.limitEur || 0, ...v.cumulative, v.forecastEur || 0) * 1.08 || 1]} />
            </div>
            <div className="ais-chart">
              <div className="label">{tr('Letzte 6 Monate', 'Last 6 months')}</div>
              <Columns labels={v.months.map((m) => monthName(m.month))} series={[{ name: tr('KI-Ausgaben', 'AI spending'), values: v.months.map((m) => m.eur), color: 'var(--accent)' }]} format={(x) => eur(x)} label={tr('KI-Ausgaben je Monat', 'AI spending per month')} height={140} />
            </div>
            {v.byFeature.length > 0 && (
              <div className="ais-chart">
                <div className="label">{tr('Wofür in diesem Monat', 'What for this month')}</div>
                <HBars items={v.byFeature.slice(0, 6).map((x) => ({ label: nameOf(x.feature), value: x.eur, color: 'var(--accent)' }))} format={(x) => eur(x)} label={tr('KI-Ausgaben je Funktion', 'AI spending per feature')} />
              </div>
            )}
          </div>
          <p className="faint aib-how">{tr(`Tokens diesen Monat: ${fmt.n(v.tokens.in)} gesendet, ${fmt.n(v.tokens.out)} erhalten. Andere Forge-Kosten (Rechenzeit, Speicher) misst die App nicht selbst – sie stehen in der Developer Console.`, `Tokens this month: ${fmt.n(v.tokens.in)} sent, ${fmt.n(v.tokens.out)} received. Other Forge costs (compute, storage) are not measured by the app – they are in the developer console.`)}</p>
        </motion.div>
      )}
      <div className="ais-links">
        <div className="label">{tr('Selbst nachprüfen – bei Atlassian', 'Double-check – at Atlassian')}</div>
        <ul>{SPEND_LINKS().map(([url, title, hint]) => (
          <li key={url}><button type="button" className="linkbtn" onClick={() => openUrl(url)}>{title}<Icon name="external" size={11} /></button><span className="faint">{hint}</span></li>
        ))}</ul>
        <p className="faint aib-how">{tr('Verbindlich ist Atlassians Abrechnung an SUPERPORT. Die Zahlen hier sind die Messung der App für eure Site und sollten damit übereinstimmen; kleine Abweichungen entstehen durch Rundung und den Umrechnungskurs.', 'Binding is Atlassian\'s bill to SUPERPORT. The figures here are the app\'s measurement for your site and should match it; small differences come from rounding and the exchange rate.')}</p>
      </div>
    </section>
  );
}
