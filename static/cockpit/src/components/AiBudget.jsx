// Konfiguration › KI & Datenschutz › "KI-Budget": this month's Forge LLM spend on this site against the budget
// SUPERPORT set (Forge variable AI_BUDGET, see shared/aiBudget.js), and the calls / tokens per month that apply on this
// site (SUPERPORT's values, v2: app-wide or per site; defaults shared/llmLimits.js). The site admin may only LOWER the
// monthly EUR limit and the requests per person and day; both are saved with the configuration (versions + undo as for
// every setting). Customer-facing texts never name the internal variable or tool.
import { VENDOR_OFF } from '../lib/aiFlags.js';
import { motion } from 'framer-motion';
import { tween } from '../lib/motion.js';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';

const eur = (v) => (v > 0 && v < 0.01 ? `< ${fmt.n(0.01, 2)} €` : `${fmt.n(v ?? 0, v != null && v < 100 ? 2 : 0)} €`); // fractions of a cent never look like nothing
const LEVEL = { ok: 'ok', warn50: 'warn', warn80: 'bad', stopped: 'bad' };
const NAMES = {
  ask: ['Fragen', 'Ask'], healthDraft: ['Health-Entwurf', 'Health draft'], reportSummary: ['Report-Zusammenfassung', 'Report summary'], planning: ['Wochenplanung', 'Weekly planning'],
  gaps: ['Fehlende Werte', 'Missing values'], dispatch: ['Support-Verteilung', 'Support dispatch'], planActual: ['Plan vs. Ist', 'Plan vs. actual'], teamBrief: ['Team-Lagebild', 'Team briefing'],
  projectBrief: ['Projekt-Lagebild', 'Project briefing'], myWeek: ['Meine Arbeit', 'My work'], intent: ['„Ich will …“', '"I want …"'], similarSummary: ['Schätzen wie früher', 'Estimate like before'], playbookDraft: ['Playbooks', 'Playbooks'],
};
const nameOf = (k) => (NAMES[k] ? tr(NAMES[k][0], NAMES[k][1]) : k);

export default function AiBudget({ budget: b, ai, set }) {
  if (!b) return null;
  const tone = LEVEL[b.level] || 'ok';
  const pct = Math.max(0, Math.min(100, b.pct || 0));
  const month = fmt.date(`${b.month}-01`, { month: 'long', year: 'numeric' });
  const resets = fmt.date(b.resetsOn, { day: 'numeric', month: 'long' });
  const top = Object.entries(b.byFeature || {}).sort((x, y) => y[1] - x[1]).slice(0, 3);
  const own = ai.budgetEur;
  const ownDaily = ai.dailyLimit;
  return (
    <section className={`aib aib-${tone}`} data-ai-budget aria-labelledby="aib-title">
      <div className="aib-head">
        <span className="aib-icon"><Icon name="gauge" size={16} /></span>
        <div>
          <b id="aib-title">{tr(`KI-Budget im ${month}`, `AI budget for ${month}`)}</b>
          <div className="muted aib-sub">{b.set
            ? tr(`Von SUPERPORT festgelegt: ${eur(b.capEur)} pro Monat für diese Site${b.siteOverride ? ' (eigener Wert für eure Site)' : ''}.`, `Set by SUPERPORT: ${eur(b.capEur)} per month for this site${b.siteOverride ? ' (a value for your site)' : ''}.`)
            : tr(`Standardbudget: ${eur(b.capEur)} pro Monat für diese Site (SUPERPORT kann es anpassen).`, `Default budget: ${eur(b.capEur)} per month for this site (SUPERPORT can change it).`)}
            {b.lowered ? tr(` Ihr habt es auf ${eur(b.limitEur)} gesenkt.`, ` You lowered it to ${eur(b.limitEur)}.`) : ''}</div>
          {b.callLimit != null && b.tokenLimit != null && <div className="muted aib-sub" data-ai-limits>{tr(
            `KI-Kontingent dieser Site pro Monat: ${fmt.n(b.callLimit)} KI-Aufrufe und ${fmt.n(b.tokenLimit)} Tokens${b.siteCaps ? ' (eigener Wert für eure Site)' : ''}.`,
            `AI quota for this site per month: ${fmt.n(b.callLimit)} AI calls and ${fmt.n(b.tokenLimit)} tokens${b.siteCaps ? ' (a value for your site)' : ''}.`)}</div>}
        </div>
        <span className="aib-figure num"><b>{eur(b.usedEur)}</b><span className="muted"> / {eur(b.limitEur)}</span></span>
      </div>

      <div className="aib-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={tr(`KI-Budget zu ${Math.round(pct)} % verbraucht`, `AI budget ${Math.round(pct)} % used`)}>
        <motion.span className="aib-fill" initial={{ scaleX: 0 }} animate={{ scaleX: pct / 100 }} transition={tween('gentle')} />
        {[50, 80].map((m) => <span key={m} className="aib-tick" style={{ left: `${m}%` }} aria-hidden="true" />)}
        <span className="aib-tick aib-stop" style={{ left: '98%' }} aria-hidden="true" />
      </div>
      <div className="aib-scale faint" aria-hidden="true"><span>0</span><span style={{ left: '50%' }}>50 %</span><span style={{ left: '80%' }}>80 %</span><span className="aib-scale-end">{tr('Stopp bei 98 %', 'Stop at 98 %')}</span></div>

      {b.stopped
        ? <div className="aib-note bad" role="status"><Icon name="lock" size={14} /><span>{b.reason === 'superportStop'
          ? tr('SUPERPORT hat die KI vorübergehend für alle Sites angehalten. Die App arbeitet normal mit ihren eigenen Regeln weiter.', 'SUPERPORT has paused AI for all sites for now. The app keeps working normally with its own rules.')
          : b.reason === 'capZero'
            ? tr(...VENDOR_OFF)
          : b.reason === 'zero'
            ? tr('Das Monatsbudget ist 0 € – die KI-Funktionen sind aus. Die App arbeitet normal mit ihren eigenen Regeln.', 'The monthly budget is €0 – AI features are off. The app works normally with its own rules.')
            : b.reason === 'calls' || b.reason === 'tokens'
              ? tr(`Das monatliche KI-Kontingent ist aufgebraucht (${b.reason === 'calls' ? `${fmt.n(b.callLimit)} KI-Aufrufe` : `${fmt.n(b.tokenLimit)} Tokens`}). Es steht ab dem ${resets} wieder zur Verfügung; bis dahin arbeitet die App normal mit ihren eigenen Regeln.`, `The monthly AI quota is used up (${b.reason === 'calls' ? `${fmt.n(b.callLimit)} AI calls` : `${fmt.n(b.tokenLimit)} tokens`}). It is available again from ${resets}; until then the app works normally with its own rules.`)
              : tr(`Budget aufgebraucht – die KI pausiert bis zum ${resets}. Bis dahin arbeitet die App normal mit ihren eigenen Regeln; alle Zahlen, Vorschläge und Prüfungen bleiben.`, `Budget used up – AI pauses until ${resets}. Until then the app works normally with its own rules; all numbers, suggestions and checks stay.`)}</span></div>
        : b.level !== 'ok'
          ? <div className={`aib-note ${tone}`} role="status"><Icon name="info" size={14} /><span>{tr(`${Math.round(b.sharePct ?? pct)} % des Budgets bzw. Kontingents verbraucht. Bei 98 % des Budgets oder 100 % des Kontingents pausiert die KI bis zum ${resets}.`, `${Math.round(b.sharePct ?? pct)} % of the budget or quota used. At 98 % of the budget or 100 % of the quota AI pauses until ${resets}.`)}</span></div>
          : null}

      <div className="aib-facts">
        <span data-ai-quota-calls><b className="num">{fmt.n(b.calls)}</b>{b.callLimit != null ? <span className="muted"> / {fmt.n(b.callLimit)}</span> : null} {tr('KI-Aufrufe', 'AI calls')}</span>
        {b.tokenLimit != null ? <span data-ai-quota-tokens><b className="num">{fmt.n(b.tokens || 0)}</b><span className="muted"> / {fmt.n(b.tokenLimit)}</span> {tr('Tokens', 'tokens')}</span> : null}
        <span><b className="num">{fmt.n(b.cacheHits)}</b> {tr('wiederverwendet (kostenlos)', 'reused (free)')}</span>
        <span>{tr(`beginnt am ${resets} neu`, `starts again on ${resets}`)}</span>
        {top.length > 0 && <span>{tr('am meisten:', 'most:')} {top.map(([k, v]) => `${nameOf(k)} ${eur(v)}`).join(' · ')}</span>}
      </div>

      <div className="aib-own">
        <label className="aib-field">
          <span className="label">{tr(`Eigene Monatsgrenze (höchstens ${eur(b.capEur)})`, `Your monthly limit (at most ${eur(b.capEur)})`)}</span>
          <span className="aib-input"><input className="input num" type="number" inputMode="decimal" min={0} max={b.capEur} step="1" placeholder={String(Math.round(b.capEur))}
            value={own ?? ''} onChange={(e) => { const v = e.target.value === '' ? null : Math.max(0, Math.min(b.capEur, Number(e.target.value))); set((a) => { a.budgetEur = Number.isFinite(v) ? v : null; }); }} aria-describedby="aib-own-hint" /><span className="muted">€</span></span>
        </label>
        <label className="aib-field">
          <span className="label">{tr(`Anfragen je Person und Tag (höchstens ${b.capDaily})`, `Requests per person and day (at most ${b.capDaily})`)}</span>
          <input className="input num" type="number" inputMode="numeric" min={1} max={b.capDaily} step="1" placeholder={String(b.capDaily)}
            value={ownDaily ?? ''} onChange={(e) => { const v = e.target.value === '' ? null : Math.max(1, Math.min(b.capDaily, Math.round(Number(e.target.value)))); set((a) => { a.dailyLimit = Number.isFinite(v) ? v : null; }); }} />
        </label>
        <p id="aib-own-hint" className="faint aib-hint">{tr('Leer = der Wert von SUPERPORT. Ihr könnt nur senken, nicht erhöhen; gespeichert wird mit „Speichern“ und ist wie jede Einstellung rückgängig zu machen.', 'Empty = SUPERPORT\'s value. You can only lower, never raise; saved with "Save" and undoable like every setting.')}</p>
      </div>

      <p className="faint aib-how">{tr(
        `So wird gerechnet: Atlassian meldet zu jeder Antwort die verbrauchten Tokens; die App rechnet sie mit Atlassians Preisliste in Dollar um und mit ${fmt.n(b.eurPerUsd, 2)} € je $ in Euro. Ab 98 % startet keine neue KI-Anfrage. Zusätzlich gilt für diese Site je Kalendermonat (UTC) das von SUPERPORT festgelegte Kontingent von ${fmt.n(b.callLimit || 0)} KI-Aufrufen und ${fmt.n(b.tokenLimit || 0)} Tokens (laut Atlassians Angabe); ist eines erreicht, startet bis zum 1. des nächsten Monats keine KI-Anfrage. Gleiche Fragen mit gleichen Daten werden 12 Stunden lang wiederverwendet und kosten nichts.${b.estimated ? ` ${b.estimated} Antworten ohne Token-Angabe wurden großzügig geschätzt.` : ''}`,
        `How it is computed: Atlassian reports the tokens of every answer; the app prices them with Atlassian's price list in dollars and converts at ${fmt.n(b.eurPerUsd, 2)} € per $. From 98 % no new AI request starts. In addition, this site has a quota set by SUPERPORT of ${fmt.n(b.callLimit || 0)} AI calls and ${fmt.n(b.tokenLimit || 0)} tokens (as reported by Atlassian) per calendar month (UTC); once either is reached, no AI request starts until the 1st of next month. The same question with the same data is reused for 12 hours at no cost.${b.estimated ? ` ${b.estimated} answers without token figures were estimated generously.` : ''}`)}</p>
    </section>
  );
}
