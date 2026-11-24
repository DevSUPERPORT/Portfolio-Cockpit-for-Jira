// Configuration › KI & Datenschutz: the single switch for Forge LLM and every AI function. OFF by default.
// The server enforces it (src/lib/config.js aiAllowed + requireAi in every ai.* resolver); this screen explains in
// plain words what switching on means, lets the admin pick features and how much data may be shared, and shows
// exactly what a project looks like when it is sent.
import { useEffect, useMemo, useState } from 'react';
import { call } from '../lib/api.js';
import { motion } from 'framer-motion';
import { enter } from '../lib/motion.js';
import { useApp } from '../state.jsx';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { Switch } from './ui.jsx';
import DataTrust, { DataTrustNote } from './DataTrust.jsx';
import AiBudget from './AiBudget.jsx';
import { vendorOff, VENDOR_OFF } from '../lib/aiFlags.js';
import AiSpend from './AiSpend.jsx';
import LotseLearned from './LotseLearned.jsx';

const FEATURES = [
  ['ask', 'sparkle', 'Freie KI-Antworten in „Fragen" und KI-Lagebild in den Projektdetails', 'Free AI answers in "Ask" and the AI briefing in project details',
    'Nur wenn jemand ausdrücklich „frei beantworten lassen" bzw. „KI-Lagebild" klickt. Alle normalen Fragen rechnet das Cockpit ohne KI.', 'Only when someone explicitly clicks "answer freely" or "AI briefing". All normal questions are computed by the cockpit without AI.'],
  ['healthDraft', 'heart', 'Health-Update mit KI formulieren', 'Draft health updates with AI',
    'Ein Knopf im Health-Dialog schlägt Status und einen Satz vor. Gespeichert wird nur, was die Person bestätigt.', 'A button in the health dialog suggests a status and one sentence. Only what the person confirms is saved.'],
  ['reportSummary', 'report', 'Executive Summary im C-Level-Report', 'Executive summary in the C-level report',
    'Fünf Stichpunkte aus dem Report-Stand, auf Knopfdruck. Nur für die Report-Gruppe.', 'Five bullets from the report snapshot, on request. Report group only.'],
  // KI-Assistent in den Ansichten: a "KI" button next to the existing tools; it only suggests, with its reasons.
  ['planning', 'calendar', 'Wochenplanung: beste Kombination der Optimieren-Vorschläge', 'Weekly planning: best combination of the Optimize suggestions',
    'Gesendet: die Vorschläge des Optimierers (Keys, Wochen, Auslastung). Die KI erklärt die Lage und wählt nur unter diesen Vorschlägen – sie erfindet keine Termine. Übernommen wird als vorgemerkte Änderung.', 'Sent: the optimizer\'s suggestions (keys, weeks, load). The AI explains the situation and only chooses among them – it never invents dates. Applied as pending changes.'],
  ['gaps', 'shield', 'Fehlende Werte: Wert aus ähnlichen Vorgängen vorschlagen', 'Missing values: suggest a value from similar work items',
    'Gesendet: der Vorgang und ähnliche Vorgänge (Keys, Stunden, Teams, Termine). Vorschlag für Schätzung, Team, T-Shirt-Größe oder Termin – Termine nur aus vorhandenen Daten. Gespeichert wird erst per Klick.', 'Sent: the work item and similar ones (keys, hours, teams, dates). Suggests an estimate, team, T-shirt size or date – dates only from existing data. Saved only on click.'],
  ['dispatch', 'send', 'Support: Team und Person je Ticket vorschlagen', 'Support: suggest team and person per ticket',
    'Gesendet: Tickets (Key, Priorität, SLA, Komponenten) und die Auslastung der Teams. Ticket-Titel nur, wenn Texte erlaubt sind. Zugewiesen wird über das normale Verteilen.', 'Sent: tickets (key, priority, SLA, components) and team load. Ticket titles only when texts are allowed. Assigned through the normal dispatch.'],
  ['planActual', 'gauge', 'Plan vs. Ist: Was ist passiert und was tun?', 'Plan vs. actual: what happened and what to do?',
    'Gesendet: die Plan-vs.-Ist-Zahlen des gewählten Zeitraums. Ergebnis: eine kurze Erklärung und zwei bis drei Empfehlungen. Es wird nichts geändert.', 'Sent: the plan vs. actual figures of the chosen period. Result: a short explanation and two or three recommendations. Nothing is changed.'],
  ['teamBrief', 'users', 'Teams: Lagebild in einem Absatz', 'Teams: one-paragraph briefing',
    'Gesendet: Kennzahlen des Teams (Auslastung je Quartal, Projekte, Blockiertes) aus den Daten, die die Person sehen darf. Es wird nichts geändert.', 'Sent: the team\'s figures (load per quarter, projects, blocked work) from data the person may see. Nothing is changed.'],
  ['projectBrief', 'project', 'Projekte: KI-Lagebild', 'Projects: AI briefing',
    'Gesendet: Kennzahlen des Projekts (Fortschritt, Termine, Engpässe, Lücken). Ergebnis: Lage, Risiken, nächste Schritte. Es wird nichts geändert.', 'Sent: the project\'s figures (progress, dates, bottlenecks, gaps). Result: status, risks, next steps. Nothing is changed.'],
  ['myWeek', 'clock', 'Meine Arbeit: Buchungskommentare und Wochentext', 'My work: worklog comments and week text',
    'Gesendet: nur die eigenen Buchungen und die eigene Jira-Aktivität der Woche. Kommentare werden erst per Klick gespeichert, jeder einzeln rückgängig; eigene Kommentare werden nie überschrieben.', 'Sent: only the person\'s own bookings and Jira activity of the week. Comments are saved only on click, each undoable; existing comments are never overwritten.'],
  // "Ich will …" and support playbooks
  ['intent', 'sparkle', '„Ich will …“: freie Wünsche einer Antwortkarte zuordnen', '"I want …": map free wishes to an answer card',
    'Nur wenn die Regeln der App einen Wunsch nicht zuordnen können. Gesendet: der getippte Wunsch, die Liste der Karten und die Team-Namen (Projekte nur als Rang und Key, außer Texte sind erlaubt). Die KI wählt nur eine vorhandene Karte; gerechnet wird immer von der App.', 'Only when the app\'s rules cannot map a wish. Sent: the typed wish, the list of cards and the team names (projects only as rank and key unless texts are allowed). The AI only picks an existing card; the numbers are always computed by the app.'],
  ['similarSummary', 'clock', 'Schätzen wie früher: was bei ähnlicher Arbeit half', 'Estimate like before: what helped in similar work',
    'Nur wenn Texte erlaubt sind. Gesendet: die ähnlichen erledigten Vorgänge (Key, Stunden, Überzug, Dauer), ihre Titel und die letzten drei Kommentare – ohne Links, E-Mail-Adressen und Geheimnisse. Es wird nichts geändert.', 'Only when texts are allowed. Sent: the similar finished work items (key, hours, overrun, duration), their summaries and last three comments – without links, e-mail addresses and secrets. Nothing is changed.'],
  ['playbookDraft', 'headset', 'Support-Playbooks: Entwurf für Hilfeartikel und Standardantwort', 'Support playbooks: draft help article and standard reply',
    'Gesendet: das wiederkehrende Thema (Anzahl, Zeit, Tendenz) und die Keys der Beispiel-Tickets, ihre Titel nur wenn Texte erlaubt sind. Gespeichert wird erst per Klick, jede Speicherung einzeln rückgängig. Nichts wird an Tickets gesendet.', 'Sent: the recurring topic (count, time, trend) and the keys of the example tickets, their summaries only when texts are allowed. Saved only on click, each save undoable. Nothing is posted to tickets.'],
  // Lotse: the cockpit's own agent works without AI; this only adds the model's reading of a story Lotse already computed
  ['lotse', 'target', 'Lotse: KI-Einschätzung zur geprüften Antwort', 'Lotse: AI reading of the verified answer',
    'Lotse rechnet jede Antwort selbst, ohne KI. Auf Wunsch liest die KI das Ergebnis mit. Gesendet: nur Lotses geprüfte Antwort (Zahlen, Keys, kurze Befunde) – Personen als P1, Projekte als „#Rang Key“, außer Namen bzw. Texte sind erlaubt. Die App prüft jede Zahl, jeden Key, jedes Team, Datum und jeden Rang der KI-Antwort gegen Lotses Fakten; bei Abweichungen gilt Lotse.', 'Lotse computes every answer itself, without AI. On request the AI reads the result too. Sent: only Lotse\'s verified answer (numbers, keys, short findings) – people as P1, projects as "#rank key" unless names or texts are allowed. The app checks every number, key, team, date and rank of the AI\'s reply against Lotse\'s facts; where they differ, Lotse wins.'],
];

export default function AiSettings({ cfg, upd, saved }) {
  const { computed, config: live } = useApp();
  const budget = live?.ai?.budget || null;
  // how many people switched AI on for themselves (a count, no names) – where the cost comes from
  const [aiUsers, setAiUsers] = useState(null);
  useEffect(() => { let alive = true; call('ai.users').then((r) => alive && setAiUsers(r?.on ?? null), () => null); return () => { alive = false; }; }, []);
  const ai = cfg.ai || { enabled: false, features: {}, shareNames: false, shareTexts: false };
  const savedAi = saved?.ai || {};
  const [confirm, setConfirm] = useState(false);
  const set = (fn) => upd((c) => { c.ai = { ...(c.ai || {}), features: { ...(c.ai?.features || {}) } }; fn(c.ai); });
  const on = ai.enabled === true;
  const pending = on !== (savedAi.enabled === true);

  // what one project looks like when it is sent – with the current sharing choices (live preview)
  const sample = useMemo(() => {
    const p = computed?.model?.items?.[0];
    const m = p && computed.metrics.get(p.ref);
    if (!p || !m) return null;
    return {
      rank: p.rank, key: p.key,
      name: ai.shareTexts ? p.name : `#${p.rank} ${p.key}`,
      owner: ai.shareNames ? p.owner?.name || null : null,
      health: p.health ? { status: p.health.status, comment: ai.shareTexts ? (p.health.comment || '').slice(0, 60) : null } : null,
      progressPct: Math.round((m.progress || 0) * 100), plannedH: Math.round(m.OE || 0), spentH: Math.round(m.TS || 0), due: m.due || null,
    };
  }, [computed, ai.shareNames, ai.shareTexts]);

  return (
    <div className="stack ai-cfg" style={{ gap: 18 }} data-ai-cfg>
      {/* status – the first thing an admin reads */}
      <div className={`ai-state ${on ? 'on' : 'off'}`} role="status">
        <span className="ai-state-icon"><Icon name={on ? 'sparkle' : 'lock'} size={20} /></span>
        <div>
          <b>{on && vendorOff(budget) ? tr('KI vorübergehend ausgeschaltet', 'AI temporarily turned off') : on && budget?.stopped ? tr('KI pausiert – Budget aufgebraucht', 'AI paused – budget used up') : on ? tr('KI ist eingeschaltet', 'AI is switched on') : tr('KI ist ausgeschaltet', 'AI is switched off')}{pending ? tr(' (noch nicht gespeichert)', ' (not saved yet)') : ''}</b>
          <div>{on && vendorOff(budget) ? tr(...VENDOR_OFF) : on && budget?.stopped
            ? tr(`Bis zum ${fmt.date(budget.resetsOn, { day: 'numeric', month: 'long' })} ruft die App Forge LLM nicht mehr auf; alles andere funktioniert normal. Details im KI-Budget unten.`, `Until ${fmt.date(budget.resetsOn, { day: 'numeric', month: 'long' })} the app does not call Forge LLM; everything else works normally. Details in the AI budget below.`)
            : on
            ? tr('Nur die unten gewählten Funktionen rufen Forge LLM auf – und nur, wenn jemand den jeweiligen KI-Knopf drückt.', 'Only the features chosen below call Forge LLM – and only when someone presses the AI button.')
            : tr('Die App sendet keine Daten an ein Sprachmodell. Alle Zahlen, Ampeln, Fragen und Prüfungen im Cockpit funktionieren vollständig ohne KI.', 'The app sends no data to a language model. All numbers, traffic lights, questions and checks in the cockpit work fully without AI.')}</div>
          {savedAi.changedAt && <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{tr('Zuletzt geändert', 'Last changed')} {fmt.date(savedAi.changedAt, { day: '2-digit', month: 'short', year: 'numeric' })} {savedAi.changedBy ? tr(`von ${savedAi.changedBy}`, `by ${savedAi.changedBy}`) : ''}</div>}
        </div>
      </div>

      <div className="ai-master">
        <Switch on={on} onChange={(v) => { if (v) setConfirm(true); else { setConfirm(false); set((a) => { a.enabled = false; }); } }}
          label={<span><b style={{ fontWeight: 600 }}>{tr('KI-Funktionen (Forge LLM) erlauben', 'Allow AI features (Forge LLM)')}</b><span className="muted" style={{ display: 'block', fontSize: 12.5, fontWeight: 400 }}>{tr('Standard: aus. Nur Jira-Admins können das ändern.', 'Default: off. Only Jira admins can change this.')}</span></span>} />
      </div>
      {/* who uses AI – the admin decides: each person for themselves (default) or everyone */}
      <fieldset className="ai-people" data-ai-people disabled={!on}>
        <legend className="label">{tr('Wer nutzt die KI?', 'Who uses AI?')}</legend>
        <div className="ai-access" role="radiogroup" aria-label={tr('Wer nutzt die KI?', 'Who uses AI?')}>
          {[
            ['self', 'user', tr('Jede Person entscheidet selbst', 'Each person decides'), tr('Empfohlen. Jede Person schaltet die KI oben rechts bei „KI“ für sich ein oder aus – Standard: aus. Wer mit dem Cockpit ohne KI zufrieden ist, verursacht keine Kosten.', 'Recommended. Each person switches AI on or off for themselves at "AI" in the top right – default: off. Whoever is happy with the cockpit without AI causes no cost.')],
            ['all', 'users', tr('Für alle eingeschaltet', 'On for everyone'), tr('Alle sehen die KI-Funktionen sofort, ohne eigenen Schalter. Bequem – kostet aber mit jeder Person, die sie nutzt; das Budget unten bleibt die Grenze.', 'Everyone sees the AI features right away, without a personal switch. Convenient – but every person who uses them adds cost; the budget below stays the limit.')],
          ].map(([v, icon, title, text]) => {
            const sel = (ai.access === 'all' ? 'all' : 'self') === v;
            return (
              <button key={v} type="button" role="radio" aria-checked={sel} className={`ai-access-opt ${sel ? 'sel' : ''}`} data-ai-access={v} onClick={() => set((a) => { a.access = v; })}>
                <span className="ai-access-dot" aria-hidden="true" />
                <span className="ai-access-icon"><Icon name={icon} size={15} /></span>
                <span><b>{title}</b><span className="muted">{text}</span></span>
              </button>
            );
          })}
        </div>
        <div className="faint ai-access-note">{(ai.access === 'all')
          ? tr('Wechsel zu „Jede Person entscheidet selbst“: wer die KI vorher nicht selbst eingeschaltet hat, sieht sie danach nicht mehr – nichts geht verloren.', 'Switching to "Each person decides": anyone who has not switched AI on for themselves no longer sees it – nothing is lost.')
          : aiUsers != null ? tr(`Zurzeit haben ${aiUsers} ${aiUsers === 1 ? 'Person' : 'Personen'} die KI für sich eingeschaltet.`, `Right now ${aiUsers} ${aiUsers === 1 ? 'person has' : 'people have'} switched AI on for themselves.`) : ''}
          {' '}{tr('Wird mit „Speichern“ übernommen und ist wie jede Einstellung rückgängig zu machen.', 'Applied with "Save" and undoable like every setting.')}</div>
      </fieldset>
      <DataTrust />
      {(on || budget?.calls > 0) && <AiBudget budget={budget} ai={ai} set={set} />}
      {(on || budget?.calls > 0) && <AiSpend />}
      <LotseLearned />

      {/* enter only – no exit animation (it stalls in the Jira frame) */}
      {confirm && !on && (
          <motion.div className="ai-confirm" {...enter(0, { y: -6 })} role="dialog" aria-label={tr('KI einschalten bestätigen', 'Confirm switching AI on')}>
            <b>{tr('Bevor du einschaltest – das passiert dann:', 'Before you switch it on – this is what happens:')}</b>
            <ul>
              <li><b>{tr('Nur auf Knopfdruck.', 'Only on request.')}</b> {tr('Die KI wird nur aufgerufen, wenn jemand einen KI-Knopf drückt. Es gibt keine automatischen oder nächtlichen KI-Läufe.', 'AI is only called when someone presses an AI button. There are no automatic or nightly AI runs.')}</li>
              <li><b>{tr('Was gesendet wird:', 'What is sent:')}</b> {tr('Kennzahlen der Projekte, die die fragende Person in Jira sehen darf – Fortschritt, Stunden, Termine, Auslastung, Konflikte. Ohne Personennamen und ohne Freitexte, solange die Schalter unten aus sind.', 'Figures of the projects the asking person may see in Jira – progress, hours, dates, utilisation, conflicts. Without person names and without free texts while the switches below are off.')}</li>
              <li><b>{tr('Wohin:', 'Where to:')}</b> {tr('An Forge LLM, den KI-Dienst von Atlassian für Forge-Apps. Die App spricht keinen anderen KI-Anbieter an.', 'To Forge LLM, Atlassian\'s AI service for Forge apps. The app contacts no other AI provider.')}</li>
              <li><b>{tr('Grenzen:', 'Limits:')}</b> {tr('Höchstens 60 KI-Anfragen je Person und Tag. Antworten sind als „KI-generiert – bitte prüfen" markiert.', 'At most 60 AI requests per person and day. Answers are marked "AI-generated – please verify".')}</li>
              <li><b>{tr('Zurück:', 'Undo:')}</b> {tr('Ausschalten stoppt alle KI-Aufrufe sofort und löscht gespeicherte KI-Zusammenfassungen.', 'Switching off stops every AI call at once and deletes stored AI summaries.')}</li>
            </ul>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-primary btn-sm" data-ai-confirm onClick={() => { setConfirm(false); set((a) => { a.enabled = true; }); }}><Icon name="check" size={13} />{tr('Ja, KI einschalten', 'Yes, switch AI on')}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>{tr('Abbrechen', 'Cancel')}</button>
            </div>
          </motion.div>
      )}

      <fieldset className="ai-group" disabled={!on} aria-describedby={!on ? 'ai-off-hint' : undefined}>
        <legend className="label">{tr('Welche KI-Funktionen', 'Which AI features')}</legend>
        {!on && <div id="ai-off-hint" className="faint" style={{ fontSize: 12.5 }}>{tr('Erst wählbar, wenn KI erlaubt ist.', 'Selectable once AI is allowed.')}</div>}
        {FEATURES.map(([k, icon, de, en, hde, hen]) => (
          <div key={k} className="ai-row">
            <span className="ai-row-icon"><Icon name={icon} size={15} /></span>
            <div><Switch on={on && ai.features?.[k] !== false} disabled={!on} onChange={(v) => set((a) => { a.features[k] = v; })} label={tr(de, en)} /><div className="muted ai-row-sub">{tr(hde, hen)}</div></div>
          </div>
        ))}
      </fieldset>

      <fieldset className="ai-group" disabled={!on}>
        <legend className="label">{tr('Datensparsamkeit – was zusätzlich gesendet werden darf', 'Data minimisation – what may also be sent')}</legend>
        <div className="ai-row">
          <span className="ai-row-icon"><Icon name="user" size={15} /></span>
          <div><Switch on={on && ai.shareNames} disabled={!on} onChange={(v) => set((a) => { a.shareNames = v; })} label={tr('Personennamen mitsenden (Owner, Verantwortliche)', 'Send person names (owners, responsible people)')} />
            <div className="muted ai-row-sub">{tr('Aus: Die KI sieht keine Namen und nennt keine Personen.', 'Off: the AI sees no names and names no people.')}</div></div>
        </div>
        <div className="ai-row">
          <span className="ai-row-icon"><Icon name="edit" size={15} /></span>
          <div><Switch on={on && ai.shareTexts} disabled={!on} onChange={(v) => set((a) => { a.shareTexts = v; })} label={tr('Texte aus Jira mitsenden (Projekt- und Vorgangsnamen, Health-Kommentare, Abhängigkeits-Hinweise, Meilensteinnamen)', 'Send texts from Jira (project and work item names, health comments, dependency notes, milestone names)')} />
            <div className="muted ai-row-sub">{tr('Aus: Projekte heißen für die KI nur „#Rang Schlüssel" (z. B. „#3 ABC-32"); Kommentare und Notizen bleiben in Jira.', 'Off: projects are only "#rank key" for the AI (e.g. "#3 ABC-32"); comments and notes stay in Jira.')}</div></div>
        </div>
      </fieldset>
      {/* outside the fieldset: a disabled fieldset would make the scrollable preview unreachable by keyboard */}
        {sample && (
          <div className="ai-preview">
            <div className="label" style={{ margin: 0 }}>{tr('So sieht ein Projekt aus, wenn es gesendet wird (Vorschau mit euren Daten)', 'This is how a project looks when sent (preview with your data)')}</div>
            <pre className="mono" data-ai-preview tabIndex={0} aria-label={tr('Vorschau der gesendeten Projektdaten', 'Preview of the sent project data')}>{JSON.stringify(sample, null, 1)}</pre>
          </div>
        )}


      <div className="ai-facts">
        {[
          ['shield', tr('Auf dem Server erzwungen', 'Enforced on the server'), tr('Jeder KI-Aufruf prüft diesen Schalter zuerst – vor dem Lesen von Daten. Ausgeblendete Knöpfe allein wären kein Schutz.', 'Every AI call checks this switch first – before any data is read. Hidden buttons alone would be no protection.')],
          ['users', tr('Nur, was die Person sehen darf', 'Only what the person may see'), tr('Die KI bekommt nur Daten, die die fragende Person in Jira sehen darf.', 'The AI only gets data the asking person may see in Jira.')],
          ['history', tr('Protokolliert', 'Logged'), tr('Jedes Ein- und Ausschalten steht mit Name und Zeit im Protokoll und in den Versionen.', 'Every switch on or off is in the audit log and the versions, with name and time.')],
          savedAi.enabled === true
            ? ['sparkle', tr('Aktiv – nur über Forge LLM', 'Active – through Forge LLM only'), tr('Die gewählten Funktionen rufen Forge LLM auf, wenn jemand den KI-Knopf drückt. Ausschalten stoppt sofort jeden Aufruf.', 'The chosen features call Forge LLM when someone presses the AI button. Switching off stops every call at once.')]
            : ['info', tr('Technisch vorbereitet, nicht aktiv', 'Prepared, not active'), tr('Die App ist bei Atlassian für Forge LLM registriert, damit ihr es hier einschalten könnt. Solange der Schalter aus ist, gibt es keinen einzigen Aufruf.', 'The app is registered with Atlassian for Forge LLM so you can switch it on here. While the switch is off there is not a single call.')],
        ].map(([icon, t, d]) => (
          <div key={t} className="ai-fact"><Icon name={icon} size={15} /><div><b>{t}</b><div className="muted">{d}</div></div></div>
        ))}
      </div>
      <DataTrustNote />
    </div>
  );
}
