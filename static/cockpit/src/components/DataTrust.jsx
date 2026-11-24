// Konfiguration › KI & Datenschutz › "Datenschutz & Sicherheit": what this app uses, where data goes, what the AI gets
// and what is stored – for customers who are very careful with their data. Every sentence must stay TRUE:
// tests/dataTrust.test.js ties the claims to the manifest (no external servers, the listed scopes, the Forge LLM
// module), the daily limit and the audit entry. Atlassian's statements are quoted with their source, nothing more.
import { useState } from 'react';
import { motion } from 'framer-motion';
import { enter } from '../lib/motion.js';
import { tr } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { openUrl } from '../lib/api.js';
import { AI_DAILY_LIMIT } from '../lib/aiFlags.js';

const SOURCES = [
  ['https://developer.atlassian.com/platform/forge/runtime-reference/forge-llms-api/', 'Atlassian: Forge LLMs API'],
  ['https://www.atlassian.com/blog/development/forge-llms-api-is-now-ga-heres-how-you-can-build-ai-native-apps-on-atlassian', 'Atlassian: Forge LLMs API is now GA'],
  ['https://www.atlassian.com/trust/ai', 'Atlassian AI Trust Center'],
];

// The one sentence that is always visible under the AI switch.
export function DataTrustNote() {
  return (
    <p className="dt-note" data-dt-note>
      <Icon name="lock" size={13} />
      <span>{tr(
        'Eure Daten bleiben in eurer Atlassian Cloud. Diese App hat keine Verbindung zu externen Servern – Forge erlaubt nur Verbindungen, die im App-Manifest stehen, und unseres nennt keine. Die KI-Funktionen laufen über Forge LLM innerhalb der Atlassian-Plattform; ohne euren Schalter wird nichts an die KI gesendet.',
        'Your data stays in your Atlassian cloud. This app has no connection to external servers – Forge only allows connections listed in the app manifest, and ours lists none. The AI features run through Forge LLM inside the Atlassian platform; without your switch nothing is sent to the AI.')}</span>
    </p>
  );
}

// Where data flows – one picture: everything inside the Atlassian boundary, nothing outside.
function DataPath() {
  const node = (icon, title, sub) => (
    <div className="dt-node"><span className="dt-node-icon"><Icon name={icon} size={16} /></span><b>{title}</b><span>{sub}</span></div>
  );
  return (
    <div className="dt-path" role="img" aria-label={tr('Datenweg: Jira, Portfolio Cockpit und Forge LLM liegen alle in eurer Atlassian Cloud; zu externen Servern gibt es keine Verbindung.', 'Data path: Jira, Portfolio Cockpit and Forge LLM are all inside your Atlassian cloud; there is no connection to external servers.')}>
      <div className="dt-cloud">
        <span className="dt-cloud-label"><Icon name="shield" size={12} />{tr('Eure Atlassian Cloud', 'Your Atlassian cloud')}</span>
        <div className="dt-flow">
          {node('layers', 'Jira', tr('eure Vorgänge – gelesen als die angemeldete Person', 'your work items – read as the signed-in person'))}
          <span className="dt-arrow" aria-hidden="true" />
          {node('sparkle', 'Portfolio Cockpit', tr('läuft auf Atlassian Forge, speichert im App-Speicher eurer Site', 'runs on Atlassian Forge, stores in your site\'s app storage'))}
          <span className="dt-arrow dt-arrow-ai" aria-hidden="true" />
          {node('gauge', 'Forge LLM', tr('nur auf Knopfdruck, nur wenn eingeschaltet – von Atlassian betrieben', 'only on request, only when switched on – run by Atlassian'))}
        </div>
      </div>
      <div className="dt-outside">
        <span className="dt-cut" aria-hidden="true" />
        <div className="dt-node dt-node-out"><span className="dt-node-icon"><Icon name="x" size={16} /></span><b>{tr('Externe Server', 'External servers')}</b><span>{tr('keine Verbindung – auch kein anderer KI-Anbieter', 'no connection – no other AI provider either')}</span></div>
      </div>
    </div>
  );
}

const SECTIONS = () => [
  ['shield', tr('Wo eure Daten bleiben', 'Where your data stays'), [
    tr('Die App läuft auf Atlassian Forge, also in der Atlassian Cloud – nicht auf Servern von uns oder Dritten.', 'The app runs on Atlassian Forge, i.e. in the Atlassian cloud – not on servers of ours or of third parties.'),
    tr('Das App-Manifest erlaubt keine Verbindung nach außen; Forge blockiert jede Verbindung, die dort nicht steht.', 'The app manifest allows no outside connection; Forge blocks every connection not listed there.'),
    tr('Gespeichert wird nur im Forge-App-Speicher eurer Site (Einstellungen, Kapazitäten, Verlauf, Playbooks, Report-Entwürfe, Nutzungszählungen, Lotse-Lernmuster).', 'Data is stored only in your site\'s Forge app storage (settings, capacities, history, playbooks, report drafts, usage counts, Lotse learning patterns).'),
    tr('Lotse, der eingebaute Lotse, rechnet in eurem Browser aus euren Daten – ohne KI; an eine KI geht dabei nichts. Mit KI steht Lotses geprüfte Antwort neben der KI-Antwort; die App vergleicht beide in Code. Für Confluence rechnet der Server einen Report frisch nach und prüft jede Zahl, bevor eine Seite entsteht. Bei mehrstufigen Aufträgen sieht die KI nur den Auftragstext (Personen als P1, Projekte als #Rang Key, solange Namen nicht erlaubt sind) und die Liste der Lotse-Werkzeuge – keine Daten; Lotse prüft ihren Plan und jede Zahl ihrer Texte.', 'Lotse, the built-in navigator, computes in your browser from your data – without AI; nothing goes to an AI. With AI on, Lotse\'s verified answer stands next to the AI\'s; the app compares both in code. For Confluence the server recomputes a report and checks every number before a page is written. For multi-step jobs the AI sees only the job\'s text (people as P1, projects as #rank key while names are not allowed) and the list of Lotse\'s tools – no data; Lotse checks its plan and every number of its texts.'),
    tr('Die App ist für Atlassians Programm „Runs on Atlassian“ geeignet (Apps ohne Datenabfluss aus der Atlassian Cloud).', 'The app is eligible for Atlassian\'s "Runs on Atlassian" programme (apps without data egress from the Atlassian cloud).'),
  ]],
  ['gauge', tr('Was Forge LLM ist', 'What Forge LLM is'), [
    tr('Atlassians eigener KI-Dienst für Forge-Apps: von Atlassian betriebene Sprachmodelle (diese App nutzt Claude), laut Atlassian auf Amazon Bedrock innerhalb der Forge-Infrastruktur.', 'Atlassian\'s own AI service for Forge apps: language models run by Atlassian (this app uses Claude), according to Atlassian on Amazon Bedrock inside the Forge infrastructure.'),
    tr('Laut Atlassian verlassen die Daten dabei die Atlassian-Plattform nicht und gehen an keinen externen KI-Dienst.', 'According to Atlassian, the data does not leave the Atlassian platform and goes to no third-party AI service.'),
    tr('Anfragen durchlaufen dieselben Moderationsprüfungen wie Atlassians eigene KI-Funktionen.', 'Requests pass the same moderation checks as Atlassian\'s own AI features.'),
    tr('Aufbewahrung und Training regelt Atlassian – Details im Atlassian AI Trust Center (Link unten).', 'Retention and training are governed by Atlassian – details in the Atlassian AI Trust Center (link below).'),
  ]],
  ['send', tr('Was an die KI geht', 'What goes to the AI'), [
    tr('Der Jira-Admin wählt: jede Person schaltet die KI für sich selbst ein (Standard, anfangs aus) – oder sie ist für alle an. Für wen sie aus ist, wird nie etwas an die KI gesendet.', 'The Jira admin chooses: each person switches AI on for themselves (default, off at first) – or it is on for everyone. For anyone who has it off, nothing is ever sent to the AI.'),
    tr('Nur wenn jemand einen KI-Knopf drückt, nur bei eingeschalteten Funktionen. Keine automatischen oder nächtlichen KI-Läufe.', 'Only when someone presses an AI button, only for switched-on features. No automatic or nightly AI runs.'),
    tr('Nur Daten, die die fragende Person in Jira sehen darf – meist Kennzahlen: Stunden, Termine, Auslastung.', 'Only data the asking person may see in Jira – mostly figures: hours, dates, utilisation.'),
    tr('Standard: keine Namen (Personen heißen „P1“) und keine Texte (Projekte heißen „#3 ABC-32“).', 'Default: no names (people are "P1") and no texts (projects are "#3 ABC-32").'),
    tr('Vor dem Senden entfernt: Links, E-Mail-Adressen, Passwörter, Tokens und andere Geheimnisse.', 'Removed before sending: links, e-mail addresses, passwords, tokens and other secrets.'),
    tr('„Was wurde gesendet?“ zeigt bei den KI-Vorschlägen in den Ansichten genau die übermittelten Daten; die Vorschau unten zeigt, wie ein Projekt aussieht.', '"What was sent?" shows the exact data sent with the AI suggestions in the views; the preview below shows how a project looks.'),
  ]],
  ['check', tr('Was die KI darf', 'What the AI may do'), [
    tr('Nur vorschlagen. Jede Antwort wird streng geprüft; Ungültiges wird verworfen und durch die Regel der App ersetzt.', 'Only suggest. Every answer is checked strictly; anything invalid is discarded and replaced by the app\'s own rule.'),
    tr('Geschrieben wird nur, was eine Person bestätigt – und jede Änderung ist einzeln rückgängig zu machen.', 'Only what a person confirms is written – and every change can be undone on its own.'),
    tr(`Höchstens ${AI_DAILY_LIMIT} KI-Anfragen je Person und Tag.`, `At most ${AI_DAILY_LIMIT} AI requests per person and day.`),
  ]],
  ['history', tr('Was gespeichert wird', 'What is stored'), [
    tr('Das Protokoll enthält je KI-Aufruf nur Funktion, Quelle und Anzahl – nie die gesendeten Daten oder die Antwort.', 'The log holds only feature, source and count per AI call – never the data sent or the answer.'),
    tr('Im Browser merkt sich die App KI-Antworten höchstens 15 Minuten, nur im Tab der Person.', 'In the browser the app keeps AI answers for at most 15 minutes, only in the person\'s tab.'),
    tr('Kostenbremse: Kommt dieselbe Frage mit genau denselben Daten noch einmal, wird die Antwort bis zu 12 Stunden aus dem App-Speicher eurer Site wiederverwendet (gespeichert unter einer Prüfsumme, nicht unter der Frage) und beim Ausschalten der KI gelöscht.', 'Cost brake: when the same question comes again with exactly the same data, the answer is reused from your site\'s app storage for up to 12 hours (stored under a checksum, not under the question) and deleted when AI is switched off.'),
    tr('Darüber hinaus bleibt eine KI-Antwort nur, wenn jemand sie übernimmt oder speichert (z. B. Health-Update, Playbook, gespeicherte Fragen-Tafel) – dann in Jira bzw. im App-Speicher eurer Site.', 'Beyond that, an AI answer is only kept when someone takes or saves it (e.g. a health update, a playbook, a saved Ask board) – then in Jira or your site\'s app storage.'),
    tr('Der Budget-Zähler speichert je Monat nur Zahlen: Tokens, Kosten und Anzahl je Funktion – keine Inhalte, keine Personen.', 'The budget meter stores only numbers per month: tokens, cost and count per feature – no content, no people.'),
    tr('KI-Zusammenfassungen des Reports liegen im App-Speicher eurer Site und werden beim Ausschalten gelöscht.', 'AI report summaries are kept in your site\'s app storage and deleted when AI is switched off.'),
    tr('Die Projekt-Historie für „Ich will …“ wird bei jedem Aufruf frisch gelesen und nicht gespeichert.', 'The project history for "I want …" is read fresh on each use and not stored.'),
    tr('Nutzung: je Tag und Ereignis nur Zahlen (z. B. „Ansicht Portfolio: 14“) – nur Zählungen, keine Personen, keine Inhalte. Nur Jira-Admins sehen sie; nach 30 Tagen gelöscht.', 'Usage: per day and event only numbers (e.g. "view Portfolio: 14") – counts only, no people, no content. Only Jira admins see them; deleted after 30 days.'),
    tr('Report-Entwürfe: je Person der eigene Entwurf aus dem Report-Composer (Text, Reihenfolge, Zahlen), damit er auf einem anderen Gerät weitergeht – nur für diese Person, höchstens 120 KB, bei jedem Speichern ersetzt.', 'Report drafts: per person their own draft from the report composer (text, order, numbers), so it continues on another device – only for that person, at most 120 KB, replaced on every save.'),
    tr('Erinnerungen auf Anfrage: je Person und Tag nur, dass sie erinnert wurde – damit niemand doppelt erinnert wird; am Folgetag gelöscht. Wer wen erinnert hat, steht im Protokoll.', 'Reminders on request: per person and day only that they were reminded – so nobody is reminded twice; deleted the next day. Who reminded whom is in the log.'),
    tr('Lotse lernt: Ordnet die KI eine Frage zu, die Lotse nicht verstand, bleibt nur das Satzmuster mit der gewählten Antwort – Namen, Keys und Zahlen entfernt, ohne Person, höchstens 500. Jira-Admins geben frei oder lehnen ab.', 'Lotse learns: when the AI maps a question Lotse did not understand, only the phrase pattern and the chosen answer are kept – names, keys and numbers removed, without the person, at most 500. Jira admins approve or reject.'),
  ]],
  ['lock', tr('Was die App in Jira darf', 'What the app may do in Jira'), [
    tr('Alles als die angemeldete Person – Jiras Berechtigungen gelten unverändert.', 'Everything as the signed-in person – Jira\'s permissions apply unchanged.'),
    tr('Vorgänge lesen und – nur auf Klick – ändern; Personen lesen; den eigenen App-Speicher nutzen.', 'Read work items and – only on click – change them; read people; use its own app storage.'),
    tr('Jira-Benachrichtigungen senden – aus, bis ein Admin Erinnerungen einschaltet.', 'Send Jira notifications – off until an admin switches reminders on.'),
    tr('Confluence: Bereiche lesen und Report-Seiten anlegen oder aktualisieren – ohne Personennamen. Rückgängig stellt die vorige Fassung wieder her oder zieht eine neue Seite zurück; löschen darf die App keine Seiten.', 'Confluence: read spaces and create or update report pages – without person names. Undo restores the previous version or withdraws a new page; the app may not delete pages.'),
    tr('Atlassian Teams: Teams und ihre Mitglieder lesen (nur lesen, als die angemeldete Person) – damit Teams und Mitglieder im Cockpit genau denen in Atlassian entsprechen.', 'Atlassian Teams: read teams and their members (read only, as the signed-in person) – so teams and members in the cockpit match Atlassian exactly.'),
  ]],
  ['eye', tr('Was SUPERPORT sieht', 'What SUPERPORT sees'), [
    tr('Keine Inhalte und keine personenbezogenen Daten eurer Site – SUPERPORT betreibt keine Server für die App und hat keinen Zugang zu eurer Instanz.', 'No content and no personal data of your site – SUPERPORT runs no servers for the app and has no access to your instance.'),
    tr('Nur, was Atlassian jedem App-Anbieter zeigt: auf welchen Sites die App installiert ist, Anzahl der Aufrufe und Fehler sowie die KI-Kosten je Site.', 'Only what Atlassian shows every app vendor: which sites have the app installed, the number of calls and errors, and the AI cost per site.'),
    tr('Fehlerprotokolle enthalten nur Fehlerart und Status – die Texte von Jira-Fehlermeldungen (sie können eure Werte enthalten) werden nie protokolliert.', 'Error logs hold only the error type and status – the texts of Jira error messages (they can contain your values) are never logged.'),
    tr('Getestet wird nur in eigenen Test-Umgebungen mit Testdaten – nie mit euren Daten.', 'Testing happens only in our own test environments with test data – never with your data.'),
  ]],
];
// SUPERPORT's binding documents (App EULA § 8, App privacy, App security) – German at /apps/…, English at /en/apps/…
const DOCS = () => [
  [tr('https://www.superport.digital/apps/eula', 'https://www.superport.digital/en/apps/eula'), tr('App-EULA', 'App EULA')],
  [tr('https://www.superport.digital/apps/privacy', 'https://www.superport.digital/en/apps/privacy'), tr('App-Datenschutz', 'App privacy')],
  [tr('https://www.superport.digital/apps/security', 'https://www.superport.digital/en/apps/security'), tr('App-Sicherheit', 'App security')],
];

export default function DataTrust() {
  const [open, setOpen] = useState(false);
  return (
    <div className="dt">
      <button type="button" className={`dt-btn ${open ? 'open' : ''}`} aria-expanded={open} aria-controls="dt-panel" onClick={() => setOpen((v) => !v)} data-dt-open>
        <Icon name="shield" size={15} />
        <span>{tr('Datenschutz & Sicherheit – was diese App nutzt und wie eure Daten geschützt sind', 'Data & security – what this app uses and how your data is protected')}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <motion.section id="dt-panel" className="dt-panel" {...enter(0, { y: -6, d: 'gentle' })} aria-label={tr('Datenschutz und Sicherheit', 'Data and security')}>
          <DataPath />
          <div className="dt-grid">
            {SECTIONS().map(([icon, title, lines], i) => (
              <motion.div key={title} className="dt-card" {...enter(i, { y: 8 })}>
                <div className="dt-card-head"><span className="dt-card-icon"><Icon name={icon} size={15} /></span><b>{title}</b></div>
                <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
              </motion.div>
            ))}
          </div>
          <div className="dt-sources">
            <span className="faint">{tr('Quellen zu Forge LLM (Atlassian):', 'Sources on Forge LLM (Atlassian):')}</span>
            {SOURCES.map(([url, label]) => <button key={url} type="button" className="linkbtn" onClick={() => openUrl(url)}>{label}<Icon name="external" size={11} /></button>)}
          </div>
          <div className="dt-sources" data-dt-docs>
            <span className="faint">{tr('Verbindlich für diese App (SUPERPORT):', 'Binding for this app (SUPERPORT):')}</span>
            {DOCS().map(([url, label]) => <button key={url} type="button" className="linkbtn" onClick={() => openUrl(url)}>{label}<Icon name="external" size={11} /></button>)}
          </div>
        </motion.section>
      )}
    </div>
  );
}
