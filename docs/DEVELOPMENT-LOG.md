# Development log – Portfolio Cockpit by SUPERPORT

> The running engineering log (decisions, release notes, live test results) that used to be the README. The product overview is now in [README.md](../README.md).


Implements the 17 use cases of *Portfolio Cockpit – Use Cases (DE/EN)*: portfolio ranking with a live waterline, project details, dependencies, estimate vs. time spent, capacity (weeks, quarters/waterline, editing), data quality with inline fixes, support/SLAs, the C-level report (PDF + Confluence) and the Jira-admin configuration. UI in German and English (follows the Jira locale), light and dark theme.

App ID `083d5c93-0586-481d-9c13-6e085bdfad84`. The same clean build is deployed to **development, staging and production**. superportdev runs the **production** installation (env `d785f633-7154-4bae-a0ac-8e983213434b`, Jira + Confluence); the development installation was removed there to avoid duplicate apps and fields.

## User guide

Every text exists in German and English (DE | EN in the header). Which tabs and actions you get is decided by the role matrix (`shared/roles.js`, Konfiguration › Rollen und Rechte); employees only see **Meine Arbeit**. Hover any tab, number or icon and it explains itself. First-time users get a 10-step tour once – portfolio and waterline, planning, plan vs. actual, **Lotse** (ask, act, workflows), the command bar (Ctrl K) and the **report composer** (restart with **?** or Ctrl K); "Meine Arbeit" shows a one-time intro card.

- **Header, everywhere.** **Ctrl K** (or `/`) is the command bar: it searches projects and areas, runs actions (undo, the undo history, "undo all", language, inbox, the tour, **Nachweis** – the proof behind every number – and the configuration) and hands **Lotse** a question or a job ("Lotse fragen: …"). **Fragen / Ask** and **Lotse** sit next to the search. **↶ with a count** (top right) lists what you can take back; Ctrl/⌘ + Z undoes the last action.
- **Meine Arbeit.** Your week: type hours into a cell (`1,5`, `1:30`), Enter saves to Jira, empty removes; click a cell with hours for a comment. **Woche vervollständigen** proposes missing hours from your Jira activity (grey, rule-based, no AI, "Warum?" shows the reason, nothing is booked until you take it). The **Fehlende Werte** box lists values missing on your own work items – fill them in right there.
- **Portfolio.** All projects in rank order with progress, maturity and health. Re-rank by drag and drop or Alt + ↑/↓ (if your role may). The orange **waterline** shows how far capacity reaches this quarter (support first). "wartet auf …" chips show who waits for whom. Health has no required rhythm: the dot shows its age, who set it and the facts; a reminder to the owner only goes out while a Jira admin has switched reminders on.
- **Projekte.** Project pills carry a **problem badge** (urgent missing values + date conflicts, hover for the list). Inside: **Handlungsbedarf**, **Fehlende Werte im Projekt** (fill in place), **Kapazität für dieses Projekt** with the weekly board (or quarters per team) and the **Struktur**.
- **Teams.** **Übersicht**: what the team works on, its load, a **blocked & overdue** filter and the missing values in the team. **Kapazitäten pflegen**: weekly hours, daily business, the team's **Verantwortlich**, **team shares in %** for people in several teams, and **locations**.
- **Wochenplanung.** Person × week board for the weekly. Drag a task to another week (start and due move) or person (assignee); changes collect as pending until **In Jira übernehmen** (one undo per task). Dependency conflicts show as a banner with a one-click fix. **Verteilung: Gleichmäßig | Nach freier Kapazität** – by free capacity, a task's hours stay between start and due, evenly spread but capped at each week's free room; dates never change, and what does not fit stays visible as overload. **Was die Automatik getan hat (n)** lists every task the rule moved, each with its own undo; **Warum diese Stunden?** shows the reasoning; a task can be set to "gleichmäßig" by hand. **Optimieren** suggests *Schneller fertig*, *Überlast glätten* or *Umverteilen* up to 85 % or 100 %. The person bar: blue = absent, violet = daily business, orange = support, teal = projects, green = free, red stripes = over 100 %. "So liest du die Wochenplanung" explains the board.
- **Plan vs. Ist.** The weekly plan is recorded every Monday at 06:00 (configurable); the tab compares planned with booked hours, shows where the time went and why things shifted. Below, the **booking control** shows who booked enough; people you may not see individually appear as **"nur Summe"** rows.
- **Support** (when a service space or queue is configured). Dispatch tickets with a suggested team and person (undoable), check **whether the reserve is enough** (with a one-click override), see **where support time goes** and the **SLAs**. **Playbooks**: recurring topics (count, time, trend) → "Playbook erstellen" drafts symptoms, steps and a standard reply (app template; AI draft when switched on). Save and delete each have their own undo; "Antwort kopieren" copies the reply – nothing is posted to Jira, and the reply never contains internal figures.
- **Fragen / Ask – "Ich will …".** Type or say a wish ("Ich will Ressourcen realistisch planen", "I want to avoid overtime", "Ich will schätzen wie früher: Schnittstelle zum Lager") and it lands as a card with a chart, one plain sentence and "So gerechnet". See the next section.
- **C-Level-Report.** The situation on one page: six key figures, "wartet auf …", capacity by rank per quarter and where the time went – as PDF or to Confluence (never with names there). On top, the **executive summary**: Lotse's verified summary at once, and – with AI on for report summaries – the AI's reading next to it, cross-checked number by number. **Mit Lotse zusammenstellen** opens the report composer (below).
- **Konfiguration** (Jira admins). Rollen und Rechte + Datenschutz, Standorte und Feiertage, Erinnerungen & Nachrichten (**off by default**), Plan-Snapshot, Support dispatch settings, **KI & Datenschutz (off by default)**. Every change is logged and undoable.

## "Ich will …" – learning from past work (2026-11-11)

The boss's question: how do we allocate people realistically – with daily support that cannot be estimated, without massive overtime, respecting priorities – and learn from similar past projects and recurring support tickets? Everything below is computed by the app's own rules (`shared/insights.js`, `shared/wishCatalog.js`); the AI is optional.

- **History, read as the user** (`src/lib/history.js`, resolvers `insights.history` / `insights.comments`): finished stories of the last 12 months in the portfolio's spaces and resolved support tickets of the last 6 months. Jira's permissions apply; nothing is stored on the server; people outside your privacy scope stay anonymous; comment texts are read only when the AI is on **and** texts may be shared.
- **Realistische Kapazität je Team**: available hours − support need (**P80** of the weekly support hours, i.e. a busy week, not an average one) = room for projects; planned work × the team's **estimate factor** (logged ÷ estimated on finished stories, trimmed mean, ≥ 5 stories, else the overall factor) = realistic plan. Confidence shown by sample size.
- **Was passt ohne Überstunden**: the waterline on that realistic room, by rank – which projects fit, which only partly.
- **Überstunden-Ausblick**: teams and people above 100 % per week, the hours too much, and the **lowest-ranked work to move first**.
- **Schätzen wie früher**: similar finished work (text similarity on summaries plus team, type, component) with typical effort (median, P80), typical overrun and duration.
- **Wiederkehrende Support-Themen** → playbook candidates (≥ 3 tickets and ≥ 2 h) → Support › Playbooks.
- **With the AI on** (Forge LLM only): a wish no rule understands may be mapped by the AI to ONE of these cards (validated; badge "KI-Zuordnung" instead of "Regel der App"); "Was half damals?" summarises similar items' comments (only with texts allowed); playbook drafts.

## Lotse – the cockpit's own agent (2026-11-12)

Lotse (EN: Navigator) answers questions and wishes as **visual stories computed from the real Jira data** – instantly, free, without any AI (contract: `docs/LOTSE.md`, engine `shared/lotse/`, UI `static/cockpit/src/components/lotse/`).

- **Story** = one-line verdict · 2–4 key numbers · one chart (bars, columns, line, donut, heat, timeline, gantt, waterline, before/after) · up to 4 findings with clickable evidence · up to 3 actions with preview (never applied by Lotse itself; existing write paths with undo) · follow-up chips · "So ermittelt". Every number in a sentence has a source in the story (`selfCheck`, tested on every skill and live).
- **20 skills**: project/team/portfolio briefing, my week, planning advice, missing values with suggestions, ticket dispatch, plan vs. actual, health draft, support topics/playbooks, estimate like before, overtime, realistic capacity, what fits, waterline, blockers, **what-if** (rank, due date, person or team hours → before/after with the same rules as the waterline), compare, today, why.
- **Conversation**: "und für Team Web?", "warum?", "was wäre wenn … auf Rang 1?" continue from the last story.
- **Where**: header "Lotse", Ctrl K, a chip in every view, "Heute für dich" (top 3 for the role) on Meine Arbeit and Portfolio, and in Fragen for wishes the canvas has no card for.
- **With AI on** ("KI-Lesart", feature `lotse`): Forge LLM reads ONLY the verified story (small prompt, cached, metered); code cross-checks every number, key, team, date and rank it mentions and shows "Lotse und KI stimmen überein" or each difference – the verified story always wins.

### Lotse acts – commands and workflows (2026-11-12)

Lotse does not only answer, it **gets things done** – always with a preview, never on its own (`shared/lotse/act/`, contract in `docs/LOTSE.md`).

- **Commands** in plain words (DE/EN, typo tolerant): "setze die Schätzung von KPR-118 auf 16 h", "verschiebe alles von Team Web eine Woche später", "gib allen Stories ohne Team in DAT das Team Data", "erinnere Team Web an die Buchungen", "buche 2 h auf KPR-118 gestern". 16 commands: rank, values (single and bulk), planning moves and optimizer picks, health, ticket dispatch, support reserve, dependencies, booking, capacity, **reminders**, the report composer, navigation.
- **Preview first.** Every write shows each change (from → to, grouped by field) and what is blocked and why; only **Übernehmen** writes – through the same resolvers and role checks as the screens, as the signed-in person. Every change has its own undo (toast, Ctrl/⌘ + Z, ↶). Nothing is written without a preview token; a stale preview is re-checked against fresh data.
- **Workflows** – whole jobs, step by step: *Weekly vorbereiten*, *Überlast auflösen*, *Quartals-Rangfolge neu setzen*, *Lücken füllen*, *Buchungen prüfen*, *Health-Runde*, *Support-Eingang verteilen*, *Projekt aufsetzen*, *Terminkonflikte lösen*, *C-Level-Report*. Each step is a story, a decision, a preview or a summary; cancelling keeps what was already applied, undoing the workflow takes all of it back (newest first).
- **Reminders on request** (`notice.remind` → resolver `notices.remind`): the existing gap or booking reminder to the people named – only for capacity editors and Jira admins, **only while a Jira admin has switched reminders on**, at most one per person, kind and day, audited; the preview counts who would get one (dry run). A sent reminder cannot be taken back – the preview says so.

### Report composer (2026-11-12)

"Lotse, mach mir den C-Level-Report" – or **Mit Lotse zusammenstellen** in the report view – drafts a whole report in a second from verified data (`shared/lotse/report/compose.js`, UI `components/report/`).

- **Audiences**: management, steering committee, team, project; period = a quarter. Sections: summary, key figures, projects by rank, waterline, late projects, capacity, plan vs. actual, support, blockers, risks and decisions, own notes.
- **Shape it like a document**: drag sections (or Alt + ↑/↓), switch them on/off, edit the text in place; numbers are **protected chips** – a number typed by hand is marked yellow until replaced with a verified value ("Zahl einfügen"). "Lotse: neu formulieren" rewrites with the same facts; with AI on, "KI: formulieren" next to it, cross-checked.
- **In the report's language**: text, figures, charts and table heads use the language chosen for the report (DE/EN), not the app's – charts are drawn with the same operations as the PDF.
- **Draft follows you**: saved in this browser at once and on the server a few seconds later (`prefs.save { reportDraft }`, own key per person, validated, ≤ 120 KB, read back with `report.draft`); on another device the newer draft opens, unless you already changed something there.
- **PDF** in one click (A4, logo and confidential switch). **Confluence** publishes exactly the composed report (`report.publishComposed`): the server drafts the same report again from **fresh** data and re-checks every section – a chip whose value changed, a number without a source or a person's name blocks the page and is listed in the dialog first (dry run). Charts become tables with the same numbers (images would need a further Confluence permission). A page published from here can be updated in place; **undo** (`report.unpublishComposed`) restores the previous version, or withdraws a new page (the app may not delete pages). Audited.

### Lotse + AI teamwork and usage signals

- **Teamwork**: Lotse answers first and alone; with AI switched on (per feature and person), the AI's reading stands next to it – in stories, the assistant panels, the health dialog, the report's executive summary and the composer – and code cross-checks every number, key, team and date it names. The verified version always wins; nothing the AI writes is applied without a person's OK.
- **Usage signals** (Konfiguration › Nutzung, Jira admins): counts only from a fixed allow-list (views, Lotse stories / actions / workflows, AI features, undo vs. write, PDF / Confluence) per site and day, 30 days, no person, no content. Each batch is stored append-only (no lost counts when many browsers send at once); the hourly job folds closed days into one record.

## KI-Kosten unter Kontrolle (2026-11-12)

Forge LLM is billed to SUPERPORT (the app developer) per token – no free allowance, no spend cap from Atlassian. So:

- **Monthly budget per site, set by SUPERPORT** in the Forge variable `AI_BUDGET` (edited in the *SUPERPORT App Status* app, which redeploys the live build): `{"eurPerMonth":50,"eurPerUsd":1,"dailyPerPerson":60,"stop":false,"sites":{"bigcorp.atlassian.net":2000}}`. Unset or broken → the defaults (€20 per site and month from December 2026, €50 before; never "unlimited"). A limit set in App Status wins. `stop:true` = emergency stop for every site. The site's Jira admin may only **lower** the budget and the requests per person and day (Konfiguration › KI & Datenschutz).
- **Metered from real tokens**: every answer's `usage.input_tokens/output_tokens` × Atlassian's price list (unknown model = most expensive), converted with `eurPerUsd`, added to `ai:spend:YYYY-MM` (numbers only, per feature and day). Timed-out requests are counted with a generous estimate. Warnings logged at 50 % and 80 %; **from 98 % no new AI call starts until the 1st** – AI buttons disappear, the app works with its own rules.
- **Hard monthly cap per site (2026-11-16, EULA §8)**: at most **1 000 Forge LLM calls** and **2 000 000 tokens** per installation and calendar month (UTC), on top of the EUR budget. The two numbers live in **`shared/llmLimits.js`** (`MONTHLY_LLM_CALLS`, `MONTHLY_LLM_TOKENS` – billed to SUPERPORT, change them there only). Counted on the same meter `ai:spend:YYYY-MM` (`calls`, `tokens`): every Forge LLM call counts one call (cache hits do not), tokens are what Atlassian reports in the response `usage` (`total_tokens`, else input + output; a call without usage – e.g. a timeout – counts no tokens). `checkBudget` runs inside `llm()` **before** every call; at 1 000 calls or 2 000 000 tokens it refuses with `AI_BUDGET` (reason `calls` / `tokens`) until the 1st of the next month (UTC) – the existing fallback answers (deterministic summary, Lotse, the app's own rules), and the AI entry points hide. Admins see calls and tokens against the cap in Konfiguration › KI & Datenschutz › KI-Budget ("Das monatliche KI-Kontingent ist aufgebraucht …" when reached); the stop is audited once (`ai.budget.stopped` with the reason). The 60 requests per person and day stay as they are.
- **Per-app / per-site limits from SUPERPORT (2026-11-16, `AI_BUDGET` contract v2, kind `eur`)**: the v1 value plus `callsPerMonth` (0–1,000,000), `tokensPerMonth` (0–1,000,000,000) and `siteCaps: {"<host>": {callsPerMonth?, tokensPerMonth?}}`, e.g. `{…v1…,"callsPerMonth":1000,"tokensPerMonth":2000000,"siteCaps":{"bigcorp.atlassian.net":{"callsPerMonth":5000}}}` (source of truth: SUPERPORT-OPS `jira-app/src/aibudget.js`). The constants in `shared/llmLimits.js` are now the **defaults**; `effectiveCaps(budget, host)` in `shared/aiBudget.js` picks the site's cap, else the app-wide value, else the default. The host is the one already resolved for v1 `sites` (`siteHost()` in `src/lib/aiBudget.js`, `serverInfo` as app, cached a day); unknown host → app-wide values. **Cap 0 = AI off** for that scope (reason `capZero`). A v1 value reads exactly as before (v2 fields default). Every field is read on its own: an invalid one takes its default (a bad site-cap entry → app-wide values), the server logs one `[ai-budget]` warning per value, nothing throws. Gate order in `llm()`: `vendorStop()` (SUPERPORT's stop, env only) → site switch (`aiAllowed`) → `checkBudget` (cap 0, EUR, calls / tokens). The gates only refuse – the customer's stored settings (switch, own EUR / daily limits) are never changed. Admins see "KI-Kontingent dieser Site pro Monat: … KI-Aufrufe und … Tokens" in KI-Budget; a vendor switch-off (stop or cap 0) says "Die KI-Funktionen sind vorübergehend vom App-Anbieter ausgeschaltet …" (the existing stop text in KI-Budget stays). Customer texts never name App Status or the variable. Tests: `tests/aiBudgetV2.test.js` (fixtures generated with the App Status serialiser). Mock: `?ai=on&budget=sitecaps|capzero|vendor`.
- **Shared answer cache**: the same prompt (same model, instructions and facts – i.e. the same data the asker may see) is answered from app storage for 12 h at no cost ("Wiederverwendet · kostenlos", "neu fragen" bypasses it); deleted when AI is switched off, old entries purged hourly.
- **AI per person**: the admin switch only *allows* AI for the site; each person switches it on for themselves in the header ("KI", default **off**, logged, undoable, also in Ctrl K). The server refuses (`AI_USER_OFF`) before anything is read. Admins see how many people use it.
- **Ausgaben** (admins): this month day by day against the budget, month-end forecast, last six months, per feature, per answer, saved by reuse – and links to Atlassian's own figures (developer console *Usage and costs* of this app, Forge LLM and platform prices, usage alerts). Other Forge costs (compute, storage) are only in the developer console.
- The model stays Claude Sonnet for every feature (quality first – no cheaper routing).

## Datenschutz & Sicherheit (2026-11-11)

Konfiguration › KI & Datenschutz has a **"Datenschutz & Sicherheit"** button under the AI switch (`components/DataTrust.jsx`): a picture of the data path (Jira → Portfolio Cockpit → Forge LLM, all inside your Atlassian cloud; external servers: no connection) and six short cards – where data stays, what Forge LLM is (Atlassian's statements, with links), what goes to the AI, what the AI may do, what is stored, what the app may do in Jira. A one-sentence note is always visible at the bottom. Every claim is pinned by `tests/dataTrust.test.js` to the code: no `external`/`remotes` in the manifest, the exact scopes, Forge LLM as the only AI client, the daily limit, an audit entry without content, no AI logging, scrubbing. Retention and training are Atlassian's – the panel links the Atlassian AI Trust Center instead of promising more than the app can prove.

## Plattformgrenzen / Platform limits

**DE:** Die App läuft auf Atlassian Forge. Atlassian begrenzt für alle Forge-Apps Rechenzeit, Speicher, Aufrufe und API-Anfragen (Quoten und Rate Limits). Für Sie bedeutet das:

- Große Portfolios mit vielen Projekten und Vorgängen laden etwas länger; Hintergrundjobs halten Kennzahlen aktuell.
- KI-Funktionen sind standardmäßig ausgeschaltet; nur Jira-Administratoren können sie in der App einschalten (Konfiguration › KI & Datenschutz).
- KI-Funktionen sind zusätzlich begrenzt: höchstens 60 Anfragen pro Person und Tag, ein Monatsbudget pro Site und ein festes monatliches KI-Kontingent pro Site von 1.000 KI-Aufrufen und 2.000.000 Tokens (Kalendermonat, UTC). Ist eine Grenze erreicht oder die KI nicht verfügbar, arbeitet die App mit ihren eigenen Regeln weiter; Zusammenfassungen werden dann ohne KI erstellt. Das monatliche KI-Kontingent steht ab dem 1. des nächsten Monats wieder zur Verfügung; Jira-Administratoren sehen den Verbrauch unter Konfiguration › KI & Datenschutz › KI-Budget.
- Wird eine Plattformgrenze bei einer Änderung erreicht, zeigt die App einen Fehler. Der Verlauf im Kopfbereich zeigt, was übernommen wurde; wiederholen Sie den Rest etwas später.

**EN:** The app runs on Atlassian Forge. Atlassian limits compute time, storage, invocations and API requests for all Forge apps (quotas and rate limits). What this means for you:

- Large portfolios with many projects and work items take a little longer to load; background jobs keep the figures up to date.
- AI features are off by default; only Jira administrators can turn them on, in the app (Configuration › AI & data protection).
- AI features have extra limits: at most 60 requests per person and day, a monthly budget per site and a fixed monthly AI quota per site of 1,000 AI calls and 2,000,000 tokens (calendar month, UTC). When a limit is reached or AI is unavailable, the app keeps working with its own rules and builds summaries without AI. The monthly AI quota is available again from the 1st of next month; Jira administrators see the usage under Configuration › AI & data protection › AI budget.
- If a platform limit is reached during a change, the app shows an error. The history in the header shows what was applied; repeat the rest a little later.

## Automatik & Transparenz

The cockpit only automates what it can explain, and every automatic step can be taken back on its own.

- **Every automatic action explains itself.** Distribution by free capacity → "Was die Automatik getan hat" and "Warum diese Stunden?" (window, hours to place, free time per week, outcome). Optimize → before/after per week. Woche vervollständigen → "Warum?" with the status change or comment behind each proposal. Dispatch → why this team and person. Every number → hover card and Nachweis.
- **Every automatic action has its own undo.** One entry per task in the undo history (↶ / Ctrl/⌘ + Z): each plan-log line, each "gleichmäßig" override, each applied Optimize suggestion, each task written by "In Jira übernehmen", each dispatch. Bulk changes are previewed before anything is written.
- **Nothing is written behind your back.** Board moves and suggestions stay pending until "In Jira übernehmen"; proposals in Meine Arbeit are booked only when taken; reminders and booking notices are sent only after an admin switches them on.
- **AI is off by default.** Ask's free answers, the project briefing, the health draft and the report summary need Konfiguration › KI & Datenschutz (explicit confirmation, per feature, names and texts off by default). While off, every AI entry point is hidden and the server refuses before any data is read.

## AI, no Rovo, and undo

- **AI** runs on Forge LLM (Claude, hosted by Atlassian; no data leaves the platform).
  - Features: "Ask the cockpit" (✦ in the header or Ctrl K), an AI briefing per project, an AI executive summary on the C-level report, and "Draft with AI" for health comments.
  - Answers are grounded in a fact sheet built from what the calling user may see, with the same role checks as the cockpit.
  - Text inside Jira data is treated as data, never as instructions.
  - Usage is rate-limited (60 per user per day). A deterministic summary is used if the LLM is unavailable.
- **No Rovo (company policy, 2026-11-06).** The Rovo agent and its 10 actions were removed. Three safeguards keep it out:
  - `tests/norovo.test.js` fails if the manifest declares any Rovo module, action, resource or scope, if any code mentions or imports Rovo or the Atlassian assistant gateway, or if a dependency is Rovo-related. The ops release runs `npm test` first, so such a build cannot be released.
  - `src/lib/norovo.js`: every Jira/Confluence call goes through an allow-list (only `/rest/...` and `/wiki/...`); Rovo or assistant endpoints are refused at runtime.
  - The browser bridge wrapper (`static/cockpit/src/lib/api.js`) removes the bridge's Rovo opener.
- **Undo** for every change, via the toast button, Ctrl/⌘ + Z or the history in the header (see "Smart suggestions and undo for everything").
  - Covers rank changes, add/remove (restores the exact rank), health, gap fills (clears the field again in Jira), capacities and configuration.

## Everyday speed (2.16.0 – 2.22.0)

- **Instant open.** The bootstrap brings the dataset in the same call (one round trip instead of two, no forced splash delay). Re-opening the cockpit in the same browser tab paints the last snapshot on the first frame, marked "as of … · refreshing …", and swaps in fresh data a moment later.
  - The snapshot lives in `sessionStorage` only (gone when the tab closes), is keyed by account, site, module and space, and snapshots of other accounts are deleted on sight. The admin page never caches.
  - While a snapshot is on screen, every write waits until fresh data has arrived, so nothing is ever written on the basis of a stale view. The server still checks every write.
- **Since your last visit.** A card on the Portfolio view lists what changed since the previous visit: rank moves (only the projects that were really moved, not the ones shifted by them), health, waterline status, due dates, completion and progress jumps ≥ 5 points. Worse news first; each row opens the project; "Got it" clears it.
  - A visit starts after 30 minutes away, so reloading does not wipe the digest. Per user only numbers, enums and refs are stored (no names), and only projects the user can still see are shown.
- **Bulk gap fixing.** In Data quality, pick a rule: tick rows (or all, up to 200) and set one value for all of them. Every item is saved and permission-checked on its own; failures are listed with the reason; one undo reverts all saved items.
- **CSV export** of the ranking, the dependency list and the data-quality gaps. German users get `;` and decimal commas, everyone else `,`. Cells that a spreadsheet would execute as a formula are neutralised.
- **DE | EN switch** in the header of every page, remembered per user; the Jira language stays the default until someone picks one.

## Every number explains itself on hover (2026-11-09)

- **One look for every hover:** all tooltips are now white/grey explanation cards, like the KPI breakdowns. `infoCard({ title, sub, text, calc, inputs, items, hint })` in `components/ui.jsx` turns any hover into a card with the definition, the calculation with the real numbers, the inputs and the work items behind it.
- **Heatmaps (Teamdetails and Capacity):** every person-week shows the full calculation, e.g. "40 h × 5/5 days = 40 h − 8 h daily business − 4 h internal − 0.5 h support = 27.5 h available · 11 h planned ÷ 27.5 h = 40 %", plus holidays, absences and the stories planned that week.
  - Team-week cells show the team's stories (assigned and unassigned) per person.
  - Quarter cells show capacity, support, demand and each project in rank order.
  - The numbers come from `shared/team.js` (`personWeek`, `teamWeekItems`), the same arithmetic as the capacity engine; `tests/teamkpis.test.js` checks they match the cells.
- **Charts** (bars, columns, donut, line, heat; Ask, Project details and reports): every value shows its share of the total, its rank, the average and the distance to it. Columns and lines also show the change to the point before, and line charts got hover points (they had none).
- **Summary tiles** on Support, Dependencies, Time spent and the C-level report explain themselves (`Stat explain=…`). Examples: SLA rate = met ÷ (met + breached); conflicts with both dates; deviation = logged − estimated. The Support impact table explains utilisation with and without support.
- Every card can also be opened with the keyboard (Tab).

## Teamdetails tiles explain themselves, like the portfolio (2026-11-09)

- The Teamdetails tiles come from the same KPI registry as Portfolio and Project details (`shared/kpis.js` `teamKpis`, `teamDefinitions`).
  - Hover or keyboard focus shows the definition, the calculation with the real numbers, the inputs and the items. "Alle Details" opens the full list; a click jumps to the matching section. A Legend button sits above the tiles.
- Six tiles:
  - **Members:** people and weekly hours.
  - **For projects per week (new):** e.g. "40 h − 8 h Tagesgeschäft − 4 h intern − 2 h Support = 26 h", plus the same calculation per person.
  - **Support (priority):** per service space.
  - **Utilization in the quarter:** demand ÷ (capacity − support), with free or missing hours and each project's demand in rank order.
  - **Team progress (new):** time spent ÷ (time spent + remaining), per project.
  - **Blocked / past due:** each work item, opens in Jira.
- Team support per week is taken from the waterline's reserve (weekly × 12), so the tiles and the waterline always agree.
- Tests: `tests/teamkpis.test.js` (unit) and the live harness suite `teamTiles`, which recomputes "for projects per week" independently from the saved capacity settings.

## Guidance for new users, without slowing down experienced ones (tester feedback, 2026-11-10)

- **Which app the feedback was about.** Parts of the report describe screens of the *older* "Portfolio Cockpit" app (D:\SUPERPORT7: "Portfolio map", "Calendar … Undated", "Level load / Shift by +5 WD"). That app is also installed on superportdev and is not changed here. The insights were applied to this app.
- **Every tab in one sentence.** The sentence (`desc` in `useTabs`) shows on hover and focus. The tour's second step, "Was kannst du hier tun?", lists all tabs.
- **Guides appear once.**
  - Closing the tour, including "Überspringen" (formerly "Später"), sets `tourDone`.
  - One-time hints are stored as `prefs.hints`, a fixed list of keys (`HINT_KEYS`), only ever set to true.
  - "Meine Arbeit" shows a four-step intro card once (typing hours, Woche vervollständigen, Fehlende Werte, undo).
  - Employees never get the tour.
- **Every icon-only control explains itself.**
  - `TipProvider` shows the `aria-label` of any icon-only button or link on hover and focus, so new buttons are covered automatically.
  - Explained elements carry `data-has-tip`.
  - KPI "+N weitere" opens the full list.
- **Bulk changes are previewed.** "Alle N prüfen & übernehmen" (inbox, data quality) opens `ChangePreview`: N changes on M work items, counts per field, and per row the key, field → new value and the reason. Only "Ja, N Änderungen speichern" writes to Jira.
- **Red means something you can read.** The health dot card says health is the owner's judgement (who set it and when, their comment), plus the calculated facts: stories past due, days late, date conflicts, staffability, progress.
- **Undo is always there.** The top right of the cockpit **and** the configuration page show ↶ with the number of actions that can be reverted (0 = nothing yet, still explained). Ctrl/⌘+Z works too.
- Covered by `tests/guide.test.js`.

## Meine Arbeit – own tasks and booking (UC-20, 2026-11-10)

- **New first tab "Meine Arbeit" / "My work".** For "Mitarbeiter" (no Jira admin, in no group of the configuration, owner of no portfolio project) it is the **only** tab. Their header shows no Ask button, no inbox and no tour.
  - This is a simplification of the view, not an access rule: what anyone can see is decided by Jira's permissions, as everywhere in the app.
  - In the project page (Jira space tab) the project filter starts on that space.
- **Profile:** team, weekly hours with daily business and internal work, hours for projects, next absence, next public holiday. These come from the capacity data; "derived" is shown when nothing is maintained.
- **KPIs:**
  - "Gebucht in KW n": own worklogs against the possible working time up to today, minus the grace workdays, with the minimum quota. Same rule as the booking check (`shared/booking.js bookingRange`).
  - "Offen in KW n": overdue, blocked, remaining.
  - "Auslastung dieser Woche": `personWeek`, the same number as the heatmaps.
  - Next 8 weeks as a strip; click a week to open it.
- **"Meine Woche"** (`shared/mine.js buildWeek`):
  - Groups, in this order:
    - **Support** first.
    - **Mir zugewiesen:** start or due date in the week, done ones too; open support tickets without dates; in the current week also overdue.
    - **Weitere Aufgaben:** booked or added in the week.
    - **Ohne Termin:** folded.
  - Order within a group: Blocked, overdue, In Progress, To Do, Done, then by due date.
  - Group by assignment or by project (portfolio rank order). Project filter chips with counts.
  - The day totals mark past days under the minimum quota orange. Public holidays and absences have no target.
- **Booking:**
  - Type into a cell: `1,5`, `1:30`, `90m`, `2h 30m`. Enter or leaving the cell saves; empty removes. Arrow keys move between cells, Esc reverts.
  - Click a cell with hours to add a comment.
  - Every booking shows a toast with undo and goes into the session undo history.
  - Sub-tasks are not bookable; "auf STORY buchen" adds the parent story.
  - "Weitere Aufgabe hinzufügen" uses Jira's issue picker as the user. Added tasks are remembered per week, per account, in this browser.
- **Server** (`src/lib/mine.js`, everything **as the user**):
  - `mine.week` (read) runs JQL for assigned work and own worklogs, then reads the worklogs filtered to author = caller.
  - `mine.book` (write, kill-switch protected) sets one cell. Only the caller's worklogs are changed, and only the latest of that day (`planCell`). Refusals: `SUBTASK_NOT_BOOKABLE`, `MULTIPLE_WORKLOGS`.
  - It uses `adjustEstimate=auto`, so the remaining estimate drops as in Jira, and `notifyUsers=false`.
  - "started" is noon in the person's time zone.
  - Quarter hours up to 24 h; dates from 92 days back to 14 days ahead.
  - `mine.search` (read) is the issue picker.
- **Tests:**
  - `tests/mine.test.js`: rounding, dates, started, the cell plan, comments, only own worklogs.
  - `tests/mineWeek.test.js`: groups, order, targets, low days, holidays and absences, filters, who is a Mitarbeiter, input parsing.
  - Live harness `mineLive`: books 0,25 h on one sandbox story only if there is no own booking that day, changes it, comments, removes it. It checks Jira after every step that time spent and remaining end exactly as before.

### Woche vervollständigen – the week reconstructed from my Jira record (2026-11-10)

- **Raw material.** `mine.evidence` (read, as the user) reads every work item I updated in the week, using `issue in updatedBy(currentUser(), from, to)`, max 60. On each it reads MY changelog entries (status changes, edits; pure worklog bookkeeping is ignored) and MY comments, by day (`evidenceOf` in `src/lib/mine.js`).
- **Proposals.** `shared/mineSuggest.js suggestWeek`, rule-based, no AI:
  - Gap per past day and today = target − everything booked. Quarter hours, rounded down.
  - Weights:
    - Activity that day: status change 3, comment 2, edit 1. Sub-task activity counts for its story.
    - Otherwise the plan: open work of mine whose dates cover the day (In Progress 2, To Do 1; open support counts).
  - At most 4 work items and at least ½ h each.
  - Largest remainder, so a day's proposals add up exactly to its gap.
  - Never on future days, days without a target, sub-tasks or booked cells.
- **UI:**
  - Banner: what is missing, what is proposed, "Alle übernehmen", "Warum?" with every reason (time, status change, comment text), and "Ausblenden".
  - Ghost values in the empty cells: Enter takes one and moves on.
  - "+x h" per day under the totals; a blue dot marks my activity in a cell.
  - Taking proposals books three at a time and gives one undo for the whole batch.
- **Proof:**
  - `tests/mineSuggest.test.js`: exact sums, never future, booked or sub-task cells, sub-task to story, plan fallback, evidence filter.
  - Live harness `mineSmart`:
    - It posts a comment on PCX-1 to create evidence.
    - It re-reads every reason straight from Jira's changelog and comments, not through the app, and checks the invariants on the live proposal.
    - It books the PCX-1 proposal, checks Jira, removes the booking and the comment, and checks the remaining estimate.
    - It reports the effort: about 3 actions per cell by hand versus 1 click.

## AI switch – off by default (2026-11-10)

- Management request: large and secretive customers must be sure their data is never touched by AI unless they choose so.
- **Configuration › KI & Datenschutz** (Jira admins only) has the one switch "KI-Funktionen (Forge LLM) erlauben".
  - It is **off by default**. Installs saved before the setting existed are also off (`migrateConfig`).
  - Switching on needs an extra confirmation. It states in plain words when AI is called, what is sent, where it goes, the limits, and how to undo it.
- Choices once AI is on:
  - **Features**, each on/off: free answers in Ask plus the AI briefing in project details, the health-update draft, the C-level executive summary.
  - **Data minimisation**, both off by default: send person names; send texts from Jira (project/issue names, health comments, dependency notes, milestone names).
  - With texts off, projects are "#rank KEY" for the model. A live preview shows exactly what one project looks like when sent.
- **Enforcement on the server:**
  - `aiAllowed(cfg, feature)` in `src/lib/config.js`.
  - `requireAi` is the first line of `ai.ask`, `ai.healthDraft` and `ai.reportSummary`, before the quota, before any data is read and before any LLM call.
  - `llm()` in `src/lib/ai.js` checks the policy again before `@forge/llm` is touched (`chat` and `list`).
  - Refusals return `AI_DISABLED`.
- **Changes are recorded:** the server stamps `changedAt`/`changedBy` (never taken from the request) and writes the audit entries `ai.enabled` / `ai.disabled` / `ai.settings`, plus a config version.
- **Switching off cleans up:** it deletes stored AI output (cached report summaries, the cached model id).
- **UI:** every AI entry point is hidden while its feature is off (`lib/aiFlags.js aiOn`). The assistant drawer cannot open, and the tour no longer mentions AI drafting.
- **Manifest:** the `llm` module stays declared so admins *can* switch AI on. While off, the app makes no call to it.
- **Tests:** `tests/ai.test.js` covers the default, legacy installs, strict booleans, the non-forgeable stamp, the gate running before any access, the gate being the first line of each resolver, and the minimisation (no names or texts without permission). The live harness suite `aiSwitch` is read-only.
- **EULA §8.4 check (2026-11-16):** verified in code – default off for new and existing installs (missing or non-boolean value = off); only Jira administrators (`mypermissions` ADMINISTER, asked as the user) can switch it on: the configuration is written only through `commitConfig`, reached by `config.save` / `config.restore` (both `requireRole(roles, 'admin')`) and by the delegated "Portfolio settings" save, which cannot change the AI section; every Forge LLM call goes through `llm()` (switch, then the monthly cap, then the call). Pinned by `tests/aiEula.test.js` together with the monthly cap (refusal, token counting, month rollover).

## Planungs-Check on the work item (2026-11-10)

- Management request: show on the Jira work item when the assignee is not part of the story's team, together with time conflicts, the time allocation and other useful information.
- New module `jira:issueContext` **pc-story-check**. It is a collapsible "Planungs-Check / Planning check" section in the right-hand sidebar of every work item.
- It is a tiny vanilla build: resource `story`, `static/cockpit/story` → `dist-story`. Only the bridge parts `invoke`, `view` and `router` are included (no Rovo).
- It calls the read-only resolver `story.check`:
  - The work item id comes from the trusted invocation context, never from the payload.
  - The dataset is read as the user, so Jira's permissions apply.
  - The resolver is listed in READ_RESOLVERS, so it follows the kill switch.
- `shared/storyCheck.js` uses the same engine numbers as the cockpit. It covers four areas:
  - **Team & assignee**
    - Story team, assignee, and the team the assignee is planned in (Capacity).
    - A mismatch is a warning, with the three possible fixes and the people in the story's team.
    - Also flagged: no team, nobody assigned, no capacity maintained for the assignee.
  - **Time allocation**
    - Original estimate, logged time and remaining estimate.
    - The window the remaining hours are spread over, ≈ hours per week, and the hours per quarter (the same split as the waterline).
    - Flagged: past due, no start date, start after due, more time logged than estimated, 0 h remaining.
  - **Assignee load**
    - Weekly bars (`personWeek`, the same arithmetic as the heatmap), with this story's share.
    - The text names overbooked weeks with their numbers, and weeks without any available time.
    - Flagged: absences inside the story's window.
    - Hidden when person-level values are switched off.
  - **Conflicts & dependencies**
    - A prerequisite due after this story's due date or start.
    - A prerequisite without a due date.
    - A dependent item that starts before this story is due.
    - A missing dependency note, the Blocked status, a due date after the project end.
    - Data-quality gaps for this item.
    - The project's waterline status for this team in the quarters the story lands in.
- Sub-tasks show their story. Epics and portfolio items show a summary of the stories below that need a look.
- Covered by `tests/storyCheck.test.js` (the management example: Dev Team planned in Data, story in Integration, PCX-49 due after PCX-45). `tests/norovo.test.js` also scans `dist-story`.

## Quarter waterline shows its arithmetic (2026-11-09)

- Management question: "27 + 67 + 161 is not 336". The old **Kumuliert** column was a running total, and people added it up as if it held amounts.
- Capacity › Quartale now has a **"So wird gerechnet"** box above the table:
  - Capacity: weekly hours × 12 weeks × project share × (1 − absence).
  - Total demand: support plus each project in rank order.
  - Free or missing: capacity − demand.
  - Utilisation: demand ÷ capacity.
- The column is renamed **"Stand bis hier"**. Its header explains that it must not be added up.
- The table ends with the rows Bedarf gesamt, Kapazität and Frei/Fehlt.
- The cell hover card shows the same four lines and the people behind the weekly hours.
- All hours in the panel are whole hours, rounded with the largest remainder method (`roundParts` in `shared/engine.js`). The shown parts always add up to the shown total. Capacity shows "≈" when it was rounded.
- `quarterCapacityParts` keeps every input of the capacity line. The Excel sheet "Kapazität Quartale" has a column with the calculation.
- Covered by `tests/waterline.test.js`.

## Internal work counts every week (2026-11-09)

- New team setting **Intern %** (Capacity › Edit capacities), default 0. Like Tagesgeschäft, it is deducted every week as a share of the gross hours: 40 h − 20 % − 10 % = 28 h.
- **Ausfallquote %** is now explained as a quarter-only allowance for leave and sickness. The weekly view deducts the real holidays and absences instead.
- One formula is used everywhere (`projectShare` in `shared/engine.js`): weekly view, quarter capacity, the waterline and the preview column in Capacity.
- `tests/heat.test.js` reproduces the management example: 28 h available, 11 h planned, 17 h free, green.
- superportdev: Data, Integration, Netz and Web are set to Intern 10 %, Ausfallquote 0 %. Before, only Web was saved explicitly (15 / 0 / 10); the other teams used the defaults (20 / 0 / 10).

## Utilisation colours that mean what they say (2026-11-09)

- **The problem:** the heatmaps (Teamdetails, Capacity) shaded any load in brand orange, darker with more load. 11 h of 32 h (34 %) looked like a warning.
  - The PDF used other thresholds (red above 115 %), and the Excel export again others.
  - The support reservation cells in the Portfolio waterline used the same orange as "partially staffed", even at 0 h.
- **Now one rule everywhere** (`shared/kpis.js` `utilTone`): ≤ 85 % green ("room"), 85–100 % amber ("nearly full"), > 100 % red and striped ("overbooked").
  - Screen, Ask heatmap, both PDFs and the Excel colour scale all use it.
  - A legend sits next to every heatmap.
  - The Teamdetails tooltip says the free hours in words, e.g. "11 h of 32 h available after daily business and support · 21 h free · 34 % · room".
  - Support reservations are shown as neutral dashed "reserved" cells.
- **Readable in both themes:** every shade keeps the normal text colour at ≥ 4.8 : 1. `tests/heat.test.js` checks the rule and the contrast against the real colour tokens in `styles.css`, and that no file keeps its own 115 % threshold.

## "Heute zu tun", due dates and dependencies in one sentence, Ask boards per role (2026-11-09)

- **"Heute zu tun" inbox** (header button with a count; `shared/inbox.js`, `components/Inbox.jsx`). Each entry has its one-click action, and every action can be undone:
  - **Health updates due:** older than the rhythm, or never given. You see your own projects; people who may update every health see all.
    - "Unverändert bestätigen" saves the same status and comment with today's date.
    - "Ändern" opens the portfolio.
  - **Smart suggestions ready:** one card with the count per field. "Alle N übernehmen" saves each value, permission-checked, and one undo restores every value exactly.
  - **Blocked for over a week:** each story with project, days and reason, plus "In Jira öffnen" and a link to Abhängigkeiten.
- **Two more smart actions** (Ctrl K):
  - **Due date by key or project name**, e.g. "Due PCX-47 auf Freitag", "Fälligkeit PCX-47 auf 15.12.", "… in 2 Wochen", "… Monatsende", "Billing fällig am 30.06.2027".
    - The preview shows the full date with its weekday, the current date, a weekend warning, and whether the date lies after the project's due date.
    - Refused: past dates, unchanged dates, and work items outside the cockpit's scope.
    - Questions ending in "?" stay with Ask.
  - **Dependency link**, e.g. "PCX-12 blockiert PCX-47", "PCX-47 hängt ab von / depends on / wartet auf PCX-12".
    - It uses the link type configured under Abhängigkeiten, and the preview shows date conflicts.
    - Refused: duplicates, cycles, unknown keys, and a missing configuration.
    - New write resolvers `deps.link` / `deps.unlink` run as the user, so Jira checks the link permission. The direction is verified after creating the link. Undo removes only that link id, and only while it still connects the same two items.
- **Ask boards per role** (`shared/boards.js`; the "Boards" menu in the Ask toolbar and the Ask start screen):
  - Templates: Management, Teamleitung, Projekt-Owner. The template that fits the person is marked "für dich".
  - A board stores only its questions and layout, so it always opens with today's numbers. Save, update, switch and delete are all undoable; at most 10 saved boards per person, sanitised on the server (`src/lib/askPrefs.js`).
  - Tests check that every template question has a real analysis in DE and EN, and that no board repeats an analysis.
- **Exact undo fixes found while testing these:**
  - Undoing a health update used to write the old status as a new update, with today's date and the undoer as author. The server now keeps the earlier records (5 levels) and undo restores the previous one exactly. Only your own latest update can be undone, and earlier records never reach the browser.
  - After "apply many" plus undo on the same work item, the screen could keep one applied value, because a whole-item snapshot was restored. Now only the changed field is restored, so the screen matches Jira.
  - The inbox count badge now meets WCAG AA contrast (5.3:1 light, 6.1:1 dark).
- **Live test on superportdev** (harness suite `nextLive`, every write on PCX/PCR, read back from Jira's REST API, undone, read back again):
  - `nextLive` passed 33/33, with one step not applicable: "confirm unchanged" needs a due sandbox health, and none was due.
  - Regression suites: views 37/37, smartLive 11/11, smartUndo 9/9, e2eExtra 17/17, protoUpdate 19/19, kpiTruth 21/21, matching 6/6, proof 6/6, snapshot 9/9, supportInspect 9/9, killSwitch 5/5. The `undo` suite's exact health-undo checks passed live.
  - Clean release: `portfolio-cockpit-20261108-225802`.

## Smart actions, a sharper Ask, tab arrows, no Rovo code shipped (2026-11-08)

- **No Rovo code at all.**
  - The browser bridge is loaded module by module: `invoke`, `requestJira`, `router`, `view` (`static/cockpit/src/lib/bridge.js`, the alias `@bridge-part/*` in `vite.config.js` and `vite.field.config.js`). The bridge's Rovo opener is therefore not in any bundle, test builds included.
  - `tests/norovo.test.js` now also scans `dist/` and `dist-field/`. It allows only `lib/bridge.js` to touch the bridge, with no exceptions.
- **Smart actions** (`shared/smartActions.js`, `lib/smartRun.js`, the Ctrl K palette): one sentence in German or English, a preview of exactly what changes, Enter runs it, and it can be undone.
  - Health with a comment: "Setze X auf gefährdet: …"
  - Re-rank: "X auf Rang 2", "X nach ganz oben"
  - Team for every open story without a team, in one project or all: "Team Web für alle Stories ohne Team in X"
  - T-shirt size, only where the project carries the rough estimate itself.
  - A named scope that matches no project is refused; an action never widens.
  - Projects are found by full name, key, distinctive word, or an unambiguous short name ("ERP").
  - The same server writes as the buttons run these actions: same permission checks, same undo.
- **Ask** (`shared/ask.js`, `views/Ask.jsx`, `components/DataTable.jsx`):
  - **Understanding:** order-independent phrasings, more DE/EN synonyms, one-letter typos tolerated (`fixTypos`). New topics: Reife (honest "–") and Blocked. The probe in `tests/askparse.test.js` covers 50 questions; it was 29 of 40 before.
  - **No dead ends:** a question with no analysis gets the closest answerable questions as buttons. The free AI text (Forge LLM, not Rovo) runs only on request.
  - **Large data:** tables sort any column (numbers as numbers), filter as you type ("x of y"), keep a sticky header with a Σ row for hours, and render in windows above 120 rows. Bar charts say "14 of 37 – show all".
  - **Canvas:** the wheel scrolls inside a long answer before it pans the canvas. A burst of questions never stacks cards; measured heights push auto-placed cards apart, never ones you moved. The burst is fitted into view.
- **Tab bar:** arrows appear on the side where tabs are hidden, the active tab scrolls into view, and ← / → / Home / End move between tabs.

## Nachweis: every number with its proof (2026-11-06)

- **Tab "Nachweis"** (`views/Proof.jsx`). Three seals at the top:
  - **Gegenprobe mit Jira** (`lib/crosscheck.js`): the browser recounts stories, OE, TS, Remaining, past due and Blocked per project with its own JQL, sharing no code with the engine. Reads only `/rest/api/3` through `jiraRead` in `api.js`.
  - **Datenvertrag**: for every field the spec assigns, who owns it, when it must be filled, and how well that is kept.
  - **Treffsicherheit** (`shared/accuracy.js`): for finished stories, the half-time forecast is rebuilt from worklogs and the Remaining Estimate history, then compared with the plan and the outcome. Nothing is guessed: stories without history are left out.
- Below the seals:
  - Metric cards (`shared/metricCards.js`), each with the decision it supports, formula, sources and owners, edge cases, thresholds and how to check it without the app.
  - "Aufzeichnung der Prognosen": the daily job records each project's core numbers (`history:YYYY-MM`, aggregates only). Readable by the report group, since it is recorded as the app.
- **Proof package** in `docs/proof/`:
  - Anonymised raw export.
  - Independent Excel recount, built from the rules without the code: 62 of 62 values agree (`run-engine.mjs`).
  - Metric cards for sign-off (`gen-cards.mjs`).
  - Comprehension test plan.
  - Booking-check governance.
- **Invariant tests** (`tests/invariants.test.js`): 9 rules on generated portfolios (`INVARIANT_RUNS`, default 300). They found one real defect: a lapsed T-shirt size was called "missing".

## Prototype update: Support split, Teamdetails, Blocked, booking check (2026-11-06)

Follows the updated design canvas. Every number reuses the existing engine; nothing is computed twice.

- **Portfolio, split into Support and Projekte.**
  - Support has its own card above the projects, with one row per service space and no rank.
    - Health comes from the space's SLA rate: green from the goal, amber up to 5 points below, red below that.
    - Hours show Ø time spent per week, open tickets and the remaining estimate. "Steigt" names teams whose last 2 weeks are above 1.2 × their average.
    - The quarter cells show the hours reserved before any project. This is the same reservation the waterline deducts.
  - The Projekte card has a new **Reife** column ("–" without a T-shirt size).
  - A new hours bar: black Time Spent, grey Remaining (where it ends is the forecast), a black line for the Original Estimate and an orange dashed line for the T-shirt size.
  - The bar has a collapsible legend with "Alle aufklappen".
  - Warnings: "+X % über Original Estimate erwartet", otherwise "Original Estimate X % über T-Shirt" (both use the forecast threshold).
- **Projektdetails, the seven boxes** (`shared/kpis.js`):
  - Fortschritt shows "–" and "noch nichts geschätzt" when nothing is estimated.
  - Prognose also compares the Original Estimate with the total T-shirt size.
  - Reife says how much T-shirt size is not yet estimated as stories, or "vollständig geschätzt".
  - Datenqualität = (complete epics + complete stories) ÷ (epics + stories), red below 70 %.
  - Abhängigkeiten counts all links, with conflicts from open ones.
  - Kapazität = team quarters not fully staffable + people with a week problem (over 100 %, absent with planned hours, hours without assignee). It shows "OK" when there are none.
- **Teamdetails** (new tab, `shared/team.js`):
  - Team picker, four KPIs, and the projects and service spaces the team is involved in.
  - The team's capacity: per person week by week until the quarter ends, or per quarter.
  - "Blockiert und überfällig".
  - "Woran {Team} arbeitet": support first, then projects in rank order with the team's demand per quarter. Orange marks where it no longer fits.
    - Rows expand to the team's work items.
    - Footer rows: Kapazität nach Support, Projektbedarf, Frei / fehlt.
- **Abhängigkeiten: Blocked.**
  - New KPI and section for stories and sub-tasks in the Blocked status, oldest first.
  - "Seit" is the last change to Blocked, from the Jira history; red after 7 days. The reason is the latest comment.
  - "Wartet auf / blockiert selbst" uses the configured link types only.
  - The list gets a Status column with the prerequisite's Jira status.
  - Configuration › Abhängigkeiten › "Status Blocked": choose statuses. With none chosen, every status named Blocked or Blockiert counts.
  - Reads: the changelog and the latest comment of at most 60 blocked items, as the same principal as the dataset.
- **Time Spent vs. Estimate: "Gebuchte Stunden je Mitarbeiter"** (`shared/booking.js`, resolver `booking.worklogs`).
  - Möglich = weekly hours ÷ 5 × (workdays − public holidays − absences).
  - Gebucht = every worklog of the person the viewer may see, on any work item, read via `/worklog/updated` and `/worklog/list`. Nobody is flagged for time booked outside the portfolio.
  - Quote, Fehlend and Letzte Buchung per person, with Status OK / Hinweis / Eskalation / keine Sollzeit.
  - The period never goes beyond today; when it ends today, the last grace workdays are left out.
  - Configuration › Buchungskontrolle: on/off, minimum share (90 %), escalation from % missing (20 %), grace workdays (2).
  - Who sees it: only with person-level values on, and only capacity maintainers, the C-level report group and Jira admins. The server enforces this.
  - The app shows hints and escalations but **sends no messages**.

## Smart suggestions and undo for everything (2026-11-06)

Replaces the Rovo assistant with functions that are rule-based, explainable and never call an AI or assistant service.

- **Smart suggestions** (`shared/smart.js`, Data quality page and the one-click size fix). Each proposal comes from data already in Jira and says why:
  - Team of a story or sub-task: the team of the epic (or level) above it, else the project's lead team.
  - Team of an epic or project: the team that carries at least 60 % of its stories.
  - T-shirt size: the smallest size that covers the stories already estimated below. This is a lower bound.
  - Target quarters: the quarters its open stories are scheduled in, from today on, at most four.
  - Original estimate: only the remaining estimate Jira already has.
  - Start date: the day time was first logged.
  - Due date: the milestone date, or for a project the end of its last open story.
  - Never suggested: estimates without a figure in Jira, and new dates for overdue or out-of-range work. These are decisions, not fixes.
  - Nothing is saved without a click. Use "Apply" per row or "Apply all". Saving uses the same permission-checked fill and the same undo as a manual edit.
- **Undo for every action, with history.** The header button shows how many actions this session can undo. Clicking it lists them, newest first, each with its own undo; "Undo all" goes back step by step.
  - Each entry records what it touched. An older entry whose field was changed again later offers "Back to here" instead, which undoes the newer change first. Undo never overwrites a newer change.
  - Ctrl/⌘ + Z undoes the latest action.
  - Covered: ranking, adding and removing projects, health, every field fill (single, bulk, planning grid, suggestions), capacities, support links, configuration saves and restores, canvas cards, and copying field values (`fields.uncopyValues` empties only fields that still hold the copied value).
  - The one exception: publishing to Confluence. The app has no permission to delete pages (no delete scope, by design), and the publish dialog says so.

## Company structure spec and honest maturity (2026-11-06)

- **Reife only where a rough estimate exists.** Reife = Original Estimate ÷ (Original Estimate + open T-shirt size), calculated over the epics (rough level) that carry a T-shirt size. Without any T-shirt size the tile shows "–" and "T-Shirt Size fehlt" instead of a made-up 100 %; with some epics unsized it names them and the hours not counted. The breakdown sets the missing size in one click (saved in Jira, undoable).
- **Regeln der Jira-Struktur** (Data quality page): the spec's rules checked live – T-shirt size and Quarter/s on the epic, stories complete from "Ready" (Team, Original Estimate, Start date, Due date), time logged on stories, milestones via Fix versions, no support tickets in project spaces – each with count and the work items.
- **Story totals:** stories read Jira's totals (story + sub-tasks) for Original Estimate, Remaining Estimate and Time Spent, as the spec requires when sub-tasks are estimated; sub-task time is not counted twice.
- **Default T-shirt hours** follow the spec (XS 40, S 80, M 160, L 320, XL 640); existing configurations keep their values.

## Numbers that explain themselves (2026-11-06)

- **One KPI registry** (`shared/kpis.js`): every tile on Portfolio and Project details, its hover breakdown and the legend come from one definition. The definitions follow the agreed prototype:
  - *Fortschritt* = Time Spent ÷ (Time Spent + Remaining Estimate + offene T-Shirt Size).
  - *Prognose* = Time Spent + Remaining Estimate vs. Original Estimate (red from the configured threshold, default 10 %).
  - *Reife* = Original Estimate ÷ (Original Estimate + offene T-Shirt Size) – how reliable the numbers are.
  - *Datenqualität* = complete stories ÷ stories (all required fields filled, no due date after the milestone).
  - *Über Due Date* = open stories whose due date has passed.
  - *Kapazität* = person-weeks over 100 % (all projects) until quarter end + team quarters that cannot fully staff the project.
- **Hover or keyboard focus** on a tile shows the base, the calculation with the real numbers (e.g. "1.500 h ÷ (1.500 h + 180 h) = 89 %") and the work items behind it; **All details** lists every item; a **click** jumps to the area. **Legende** shows each definition with the live calculation for the project on screen.
- The weekly capacity grid colours each cell by the person's total load across all projects (the basis of the Kapazität tile).
- Project and area switches no longer wait for exit animations (inside the Jira frame these could stall and leave the previous page or project on screen).
- Verified live on superportdev against an independent source: for every project the story count, the Original Estimate and the past-due stories equal Jira's REST API (19/19); the portfolio's Original Estimate equals the sum (924 h); support badge, Support view and portfolio row agree (6/6); all views in DE/EN with 0 axe violations (31/31).

## SUPERPORT kill switch and consistent numbers (2026-11-06)

- **Connected to SUPERPORT App Status / ops panel** (`D:\SUPERPORT-OPS`). The Forge variable `APP_MAINTENANCE` is read on the server only (`src/lib/maintenance.js`, fail closed: unknown values count as `on`):
  - `readonly`: everything stays visible with a "changes are paused" banner. Every resolver outside the explicit read allow-list, the daily job and the sub-task lock trigger do nothing.
  - `on`: every resolver is refused. The UI shows "temporarily unavailable" with a link to https://superapps.statuspage.io and drops the cached snapshot; a page that is already open switches over on its next call. The custom-field editors show the same notice and cannot save.
  - Nobody can change it from the app: no resolver, setting or payload touches it, and the account comes from the trusted Forge runtime.
  - Release production **only** through the ops tool (`node src/cli.mjs release portfolio-cockpit --env production` in `D:\SUPERPORT-OPS`, or the panel), so the live build tag is known. Take down, pause and bring back from App Status or the panel.
  - The workflow validator is a Jira expression and keeps working while the app is paused (it reads only the work item).
- **One definition per number:**
  - *Planungsreife / maturity* = share of the planned volume broken down into stories × share of stories with an estimate (the same story basis as Data quality). Before, it ignored stories without an estimate and could show 100 % next to "87 % of stories estimated".
  - Support: the tab badge, the Tickets section, the portfolio support row, Ask and the C-level report all use the ticket-level analytics (JSM SLA data where present, the app's targets otherwise).
- Tests: `npm test` 64/64, including every resolver refused when down, every write refused when read-only, and a browser-supplied account ignored. Live on superportdev through the ops CLI: online 5/5, read-only 16/16, down 15/15, back online 5/5, number matching 7/7, views 31/31.

## Ask canvas (2.51.0)

- **Ask tab** (also the ✦ Ask button and Ctrl K): type or speak a question in German or English. Every answer becomes a card on an infinite canvas.
  - Answers are computed in the app from the cockpit's own numbers: attention list, ranking, progress, health, waterline, team utilisation, dependencies, data quality, overdue work, milestones, estimate vs logged time, support and SLAs, counts.
  - Words pick the chart: "als Kuchen" / "as a pie", "Balken", "Heatmap", "als Netz", "Tabelle", "Verlauf".
  - Questions the app cannot compute go to the AI assistant (Forge LLM, only data the person may see) and are marked "AI-generated".
  - Questions that rate individual people ("Who is the slowest?") are declined politely.
- **Cards:** drag by the header (zoomed out, the whole card), resize from the corner, switch between the chart types each card offers, open full screen (the dependency network is the showcase), remove with undo.
  - Alt + arrow keys move a focused card, Enter enlarges, Delete removes.
- **Canvas:** drag the background or scroll to pan; Ctrl/⌘ + scroll or pinch to zoom; "Show all" and "Tidy up" arrange everything.
- **Suggested questions** by role (management, project owner, capacity, admin, support) and by what the data shows right now (an overloaded team, a critical project, schedule conflicts, unlinked support tickets).
- **PDF:** tick cards (or none for all) → typeset A4 PDF with cover, contents, and every card in the view chosen on the canvas; charts are drawn as vectors.
- **Simple view:** one large column of answers, newest first, with the other areas hidden – for people who just want to ask.
- **Voice:** uses the browser's speech recognition where Jira allows the microphone. Jira's app frame usually blocks it; the app then says so and points to system dictation (Windows: Win + H, macOS: Fn twice).
- The canvas is saved per user as questions and positions only (no data); answers are recomputed from live data, in the current language.

## Support & SLAs (2.51.0)

- **Support work from any space:** besides Jira Service Management spaces, admins define queues by space + work types + labels (e.g. all bugs labelled `support`), with a live ticket count while building. The server composes the JQL from ids and labels only, so nothing can be injected.
- **SLA clock:** business hours (opening hours, weekdays, public holidays per location) or 24/7, a target per priority, an "at risk" threshold and a target rate. JSM's own SLA data wins where it exists. Members of the "Portfolio settings" group can maintain the SLA part too.
- **Support view:** Situation (KPIs, a one-sentence summary, created vs resolved, SLA rate per week, open by priority, ageing), Tickets (urgent first, SLA countdown, "Link project"), Projects (support load and breaches per portfolio project), Teams & capacity (support reserve, and the waterline with and without support: which projects support pushes below the line).
- **Link project:** connects a ticket with a portfolio project or one of its epics as a Jira issue link, with the user's own permissions; undo removes exactly that link.
- Tickets are read as the signed-in user; ticket assignees follow the person-level privacy setting.

## Self-service configuration (2.45.0)

- **T-shirt size and Target quarters are mappable custom fields.** Keep the app-owned fields (sizes are then edited in the app; their Jira context is locked by design) or map your own Jira select field.
  - With a Jira field, the options come from Jira and admins manage them there freely; the app only stores hours per option.
  - Out-of-sync options are flagged: a new option without hours, a size no longer in Jira, a quarter option that cannot be read. Option values may be any text up to 40 characters (e.g. `Medium`, `XL (1280 h)`).
  - **Copy existing values** moves values from the app field into the new Jira field, page by page, as the admin. It never overwrites a value that is already set and lists anything it could not copy.
- **"Portfolio settings" role** (Permissions → *Maintain portfolio settings*): members of a Jira group edit T-shirt sizes, milestones, planning rules and capacity defaults from the cockpit (gear icon), without Jira-admin rights.
  - Permissions, hierarchy, fields, the person-level privacy switch and the sub-task lock stay admin-only; this is enforced on the server and unit-tested.
- **Versions & backup:** every saved configuration is kept (newest 30) with who and when; any version can be restored in one click, and a restore can itself be undone. Export and import as JSON, with warnings for issue types or fields that do not exist on the target site.
- **The save bar names what will change** before you save.
- **No new Jira scopes:** options are read via edit metadata or JQL suggestions, so no site-admin re-consent is needed.
- **Live checks on production:** adminx 14/14 (the delegated save cannot change privacy, sub-task lock or permissions; exact restore; option read; input validation), and tour and views 25/25.
  - The configuration was compared field by field before and after, and it is identical.
  - axe WCAG 2.2 AA: 0 violations on the admin page (light and dark) and on the delegated view.

## First-run tour and field mapping (2.38.0)

- **Guided tour** for first-time users: starts automatically on the first visit to the cockpit (remembered per user), restartable from **?** or the command palette.
  - At most 10 calm steps spotlighting the real controls (updated 2026-11-11 for the plan's tabs: welcome, tabs, ranking & waterline, health, Projekte, Teams, Wochenplanung, Optimieren, Plan vs. Ist, search/undo/language); steps whose control is not on screen are skipped, and the text adapts to the user's role.
  - Keyboard: ←/→ and Esc; focus stays in the dialog. WCAG 2.2 AA: 0 violations on every step, light and dark.
- **Field mapping:** the admin matrix lists Assignee, Original Estimate, Due Date, Start Date, Team and Parent as Jira system fields, and Owner and Milestone as custom fields.
  - **Owner** is the Assignee by default, or any user-picker custom field. It drives the owner column, data quality, AI answers, and the owner permission for health updates (health has no reminder any more).
  - **Milestone** comes from fix versions mapped to milestones by default, or from a custom field holding a date or a milestone name.
- **Primary buttons** now use the deeper brand orange (#C04003) so white text meets WCAG AA.

## Layout

| Path | What |
|---|---|
| `manifest.yml` | Global page, project page, admin page, 3 app custom fields (Portfolio Rank, T-Shirt Size, Target Quarters; read-only on screens, JQL-searchable), workflow validator, sub-task lock trigger, daily report job |
| `shared/` | Pure engine (dates, public holidays per location, all brief formulas). Runs in the browser for instant interaction and in the backend for the daily report |
| `src/` | Resolvers (`index.js`), Jira client, permission layer, config validation, dataset loader, Confluence rendering |
| `static/cockpit/` | Custom UI (React 19 + Framer Motion), SUPERPORT design tokens |
| `tests/` | Engine unit tests (`npm test`), including a 5-level the pilot customer hierarchy |

## Works on any site / any space

- **Projects are work items** (brief default: a "Project" issue type at the top of the Plans hierarchy, Jira Premium) **or projects are spaces** (every Jira edition).
- Hierarchy levels and their roles (rough planning, structure, estimation, tiny tasks) are mapped by the admin; first-run auto-detection fills in hierarchy, Team field, Start date, link type "Blocks" and the dependency-note field.
- Without a rough-planning level, the project itself carries T-shirt size and target quarters.

## Security model (enforced server-side on every call)

- Identity comes only from the invocation context, never from the payload. Jira data for the views is read **as the user**, so Browse Projects, issue security and worklog visibility apply. Hidden projects are not even counted.
- App roles come from admin-configured groups (`viewReport`, `manageRanking`, `editCapacity`, `editHealth`); without a group nobody has the role. Owners may always update their own project's health. Configuration and milestones are restricted to Jira admins.
- Jira fields are written as the user. App-owned fields are written as the app only after a JQL visibility check and an EDIT_ISSUES check as the user.
- Person-level off ⇒ assignees and worklog authors are pseudonymized on the server. Absence reasons go to capacity editors only. Per-service SLA detail is shown only for service spaces the user can browse.
- The C-level report is computed as the app over all projects (per the brief) and returned only to report-group members. The Confluence page is rendered on the server from the snapshot, fully escaped.
- An independent security review was done; all confirmed findings were fixed. These remain intended by design: report publishing by report-group members (UC-06), and management may update health.

## Test results (2026-11-03, release 2.51.0)

- `npm test`: 55/55 (adds the question parser and recipes, the person-rating guard, every card view, the card PDF, SLA business hours and holidays, queue/SLA config validation).
- Live on superportdev (production install, harness build, then the clean build was redeployed):
  - askLive 19/19: one card per question, answers computed locally, person question declined, chart chosen from the words, chart types switch, full screen + Esc, PDF of selected cards, canvas saved per user as questions only, cards survive switching tabs, simple view, clean-up.
  - supportLive 8/8 on sandbox PCX issues: queue preview count, labels narrow the queue, invalid ids/labels dropped, link created in Jira and removed exactly by undo.
  - views 28/28 (tour, every tab in DE and EN, axe WCAG 2.2 AA 0 violations, no console errors), snapshot 9/9, cfgdiff 2/2 (the live configuration is unchanged).
  - Found and fixed during the live runs: the tour skipped portfolio steps when started from another tab; Esc did not close the full-screen card; the canvas lost cards asked in the session after switching tabs.
- Not verified live: the Support view itself, because superportdev has no service space and adding a queue would change the live configuration. It was checked in the local mock (link, undo, all four sections); the server parts were checked live as above.

## Test results (2026-11-02)

- **Release 2.32.0 (production, superportdev): live UI walkthrough 23/23** – every view renders in EN and DE, no console errors, axe-core WCAG 2.2 AA 0 violations on all 7 views (one real issue found and fixed: scrollable tables were not keyboard-focusable).
- **Release candidate 2.22.0 (production, superportdev): 113/113 live checks** across 9 suites – positive 22, AI 6, undo 8, Confluence publish 4, hidden project 9, roles revoked 22, role matrix 12, improvements 21 (incl. undo restoring an existing due date and both estimates), snapshot/write-gate 9. Demo data staged with `demoPrep` + `seedCapacity` (13/13). Independent code review: 2 high findings (undo cleared non-empty fields; lost updates in space-mode bulk fills) and 4 medium findings fixed and re-tested. See `docs/DEMO-SCRIPT.md` for the showcase.
- **2.16.0 additions on production: 24/24 live checks** (improve 16: one-trip bootstrap faster by median of 5, digest validation/sanitising/30-minute base/"Got it", language preference, parallel bulk fill + parallel undo; snapshot 8: storage scope, other-account purge, admin never cached, writes held while stale, reads pass). Regression on the same build: positive 23/23, undo 8/8, publish 4/4. `npm test`: 31/31 (engine, config, golden, digest, CSV). axe-core WCAG 2.2 AA: 0 violations on the digest, language switch and bulk bar, light and dark.
- **Production deployment, superportdev: 93/93 live E2E checks** (setup 18, positive 23, AI 6, undo 8, publish 4, capacity seeding 3, roles revoked 22, hidden project 9), plus a smoke test of the clean UI and the production Rovo agent. Earlier development-environment runs are listed below.

- `npm test`: 9/9 engine tests.
- Live E2E against superportdev, through the real resolvers as Dev Team with real Jira permissions, 90 checks:
  - setup 18
  - positive 23
  - roles revoked 22
  - restricted space 9
  - Confluence publish 4
  - AI 6 (real Forge LLM)
  - undo 8
- Rovo, tested in the Rovo chat (historical – Rovo was removed on 2026-11-06):
  - grounded answer;
  - health update after confirmation;
  - update on the hidden PCR project refused.
- The harness is excluded from production builds; build it with `VITE_SELFTEST=1 VITE_SELFTEST_RUN=positive,denyRoles npx vite build`.

## What was created on superportdev (all isolated, safe to delete)

- Jira spaces **PCX** "Portfolio Cockpit Sandbox" (5 epics as portfolio projects, ~50 issues, worklogs, links, fix versions) and **PCR** "Portfolio Cockpit Restricted" (browse-restricted visibility test; Dev Team currently has no Browse there on purpose).
- PCX's own screens (10091–10093): added Time tracking and "Abhängigkeits-Hinweis".
- Groups `pc-test-management` (Dev Team is a member), `pc-test-projectadmins` and `pc-test-restricted`.
- Permission scheme "PC Sandbox – restricted (test)", used by PCR only.
- Confluence space **PCXR** with one published test report.
- The app's own custom fields (cf 10206–10208).
- Support demo (2026-11-03): 14 Bugs labelled `support` in PCX (PCX-57 – PCX-70; 9 open, 5 Done, several linked to the PCX epics, some time logged) and the queue "IT-Support" (PCX · Bug · label support) with SLA targets Highest 4 h, High 8 h, Medium 24 h, Low 40 h, Lowest 80 h (business hours). The empty test queue "Ticket1" (GMT) was removed; "Ticket2" was kept on request. Undo: Configuration › Versions & backup.
- Nothing in the existing spaces, schemes, fields or the earlier Portfolio Cockpit app (`a66aa3ec…`) was modified. Both new spaces use the existing silent notification scheme, so no emails were sent.

## Open points

- superportdev has no Project/Workstream issue types above Epic. Adding them is a site-wide Plans change, so the sandbox uses Epics as projects. The 5-level path is covered by unit tests and needs only configuration.
- Sandbox capacities are seeded as unnamed team capacity (Capacity › Edit capacities › "Unnamed h/wk") so the waterline cuts the ranking; replace them with named people when going live.
- Not "Runs on Atlassian" eligible only because of avatar image egress; dropping avatars would fix that.
- KVS writes are last-write-wins (no transactions); this is fine for the expected edit frequency.
- Deployed to the superportdev production environment; no Marketplace listing yet.
- To show the Support view on superportdev, an admin adds a queue (e.g. space PCX, work type Bug) under Configuration › Support & SLAs.

## Commands

```bash
npm install && npm --prefix static/cockpit install
npm test
npm run build:ui && forge deploy -e development
npm --prefix static/cockpit run dev   # local UI with mock data: http://localhost:5179 (?role=employee, ?theme=dark, ?lang=en)
```

## Plan 2026-11-11 – the boss's prototype and use cases (UC-01 … UC-20)

- **Navigation = the plan's tabs:** Meine Arbeit · Portfolio · Projekte · Teams · Wochenplanung · Plan vs. Ist · Support · C-Level-Report · Konfiguration (Jira admins). Dependencies, data quality and capacity no longer have tabs: "wartet auf …" chips in the portfolio, "Fehlende Werte" boxes in Meine Arbeit / Teams / Projekte, capacity maintenance in Teams. Ask stays in the header and Ctrl K, Nachweis in Ctrl K.
- **Roles and rights (UC-08, shared/roles.js):** Jira groups → Projekt-Admin / Management; a matrix of tabs and actions (rank, capacities, weekly planning, dispatching, health); privacy per role (none / own teams / all teams; Jira admins only when granted). Config v3 migrates the old per-action groups without anyone losing access and keeps a legacy mirror. Team "Verantwortlich" lives in Teams › Kapazitäten pflegen. People outside the scope are pseudonymised in the dataset; booking shows them as "nur Summe" rows per team.
- **Wochenplanung (UC-05, shared/weekPlan.js, components/WeekBoard.jsx):** person × week board, drag a task to another week (start and due shift) or person (assignee), collected changes, live blocks-conflict check with a one-click fix, "In Jira übernehmen" (`plan.apply`, as the user, notifyUsers=false, undoable). Embedded in Teams and Projekte.
- **Plan vs. Ist (UC-04, shared/planActual.js, src/lib/snapshot.js):** an hourly trigger stores the weekly plan once its configured day/time has passed (default Monday 06:00, 24 months) plus the actuals of the last two weeks; the tab shows planned vs. booked, where the hours went and why something shifted. The analysis starts with the first snapshot.
- **Support (UC-17, shared/dispatch.js):** dispatching with suggested team (component) and person (lowest utilisation), undo; "Reicht die Reserve?" with a one-click override (`capacity.teams[id].supportOverride`) that every view honours; "Wo geht die Support-Zeit hin?".
- **Erinnerungen & Nachrichten (shared/notices.js):** reminders about missing values and booking notices are configured and previewed; **nothing is sent until a Jira admin switches it on** (default off). Delivery via Jira's own notify on a work item.
- Health has no update rhythm any more (UC-12): the card shows the age, nothing is "due".
- **Locations (UC-09, shared/locations.js):** named locations with a holiday calendar, working days, deselected public holidays and company days off (Konfiguration › Standorte und Feiertage). A person's location may be a location id or a legacy calendar code; with no locations defined every number is unchanged.
- **Team shares (UC-14, shared/allocation.js):** a person can work in several teams (`capacity.people[id].teams = [{ teamId, pct }]`); team capacity, waterline and weekly views count hours × share, the person's own load stays across all teams.
- **C-level report (UC-06, shared/reportKpis.js):** the six key figures (projects, progress, schedule, utilisation next 4 weeks, as planned, support), "wartet auf …", capacity by rank per quarter, where the time went. People only for viewers allowed to see all teams (`reportForViewer`); the Confluence page never has names.
- **Booking notices (UC-19):** the hourly job checks the last completed period (day / week / month) after the grace days and sends notices and escalations via Jira notify – only when notices are switched on.
