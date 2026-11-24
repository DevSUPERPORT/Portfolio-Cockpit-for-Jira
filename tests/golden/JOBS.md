# Jobs baseline: today's click paths and the Lotse target (acceptance list)

As of 2026-11-12. The current paths are derived from the UI code under `static/cockpit/src`; references are `file:line`.

How the counts work:
- A **screen** is a tab, view, panel, drawer, popover or modal.
- A **click** is a deliberate click. Scrolling does not count.
- A **field** is a value typed or chosen. A pre-filled value that is only accepted does not count.

The default start view is Portfolio (`App.jsx:42`); the tabs are in `App.jsx:146-157`.

Every target path starts from one sentence in the Lotse panel, or one item in "Heute für dich". It allows **at most 3
steps plus the decisions Lotse asks for**. Every write shows a preview before it is applied and can be undone. The
workflow engine already exists in `shared/lotse/act/workflows.js` (`weeklyPrep`, `resolveOverload`, `reRankQuarter`,
`fillGaps`, `bookingCheck`, `healthRound`, `supportTriage`, `onboardProject`, `fixConflicts`, `cLevelReport`), with the
commands in `act/commands.js`. **No UI file calls the workflow API yet.** A typed job sentence currently ends in an info
card without an action button.

The golden test (`tests/goldenLotse.test.js`, "golden jobs") measures how well job sentences are routed. It has 30
sentences, 3 per job (2 DE, 1 EN). Today: **80 % reach the right workflow and 100 % of those get the right parameters.**
These sentences are routed to a skill instead of a workflow:

| sentence | goes to skill |
|---|---|
| "Bericht für die Geschäftsführung zusammenstellen" | portfolioBrief |
| "Verteile die neuen Support-Tickets" | dispatchAdvice |
| "Fehlende Werte ergänzen" | gapsFix |
| "Alle Projekt-Status aktualisieren" | projectBrief |
| "Löse die Terminkonflikte" | blockers |
| "Terminkonflikte beheben" | blockers |

## Summary

The "Lotse today" column says whether Lotse offers anything for the job now. "partly" means only a hint or a
navigation, "broken" means the shortcut exists but does not work, "–" means nothing.

| # | job | today: screens / clicks / fields / confirms | Lotse today | target (Lotse) | workflow |
|---|---|---|---|---|---|
| 1 | Weekly planning prep | 2–3 / ≥ 6 / 0 / 0 | partly: `move` actions are only queued | 1 sentence, choose a mode, preview, apply: 3 steps | `weeklyPrep` |
| 2 | C-level report | 1–2 / 2–3 / 0–6 / 0 (Confluence: 2 fields + modal) | partly: navigate only | 1 sentence, choose audience and format, download or publish: 3 steps | `cLevelReport` |
| 3 | Booking check (team) | 1 / 2–4 / 0 / 0, read-only, no reminder button | – (only your own week) | 1 sentence, list of who booked too little, remind with preview: 3 steps | `bookingCheck` (today: your own bookings) |
| 4 | Support dispatch | 1 / 2 + 1 per ticket / 0–2 / 0 | partly: "Im Support prüfen" only opens the tab | 1 sentence, accept all or adjust, apply: 3 steps | `supportTriage` |
| 5 | Quarterly re-ranking | 1 / 1 drag per project / 0 / 0 | yes: what-if, then `rank` | 1 sentence, choose an ordering (due, risk, fit), preview with the waterline, apply: 3 steps | `reRankQuarter` |
| 6 | Filling missing values | 1–2 / 2 + 1–2 per gap / 1 per gap / 0–1 | yes: up to 3 `fill` per story | 1 sentence, "all" or "one by one", apply: 3 steps | `fillGaps` |
| 7 | Overload resolution | 2 / 6–7 / 0 / 0 | partly: queued moves, what-if, navigate | 1 sentence, choose team, then stretch / later / reassign / accept, preview, apply: 3 steps + 1 decision | `resolveOverload` |
| 8 | Health round | 2 / 3 / 1 per project; modal | broken (see bug J-1) | 1 sentence, per project accept the draft or change it, save all: 3 steps + 1 decision per project | `healthRound` |
| 9 | Project onboarding | 3–4 / ~9 / 4–6 / 0 | – | 1 sentence, pick the Jira issue, then accept the size, quarters, team and rank proposals: 3 steps | `onboardProject` |
| 10 | Conflict fixing | 1 / 4–5 + 1 per conflict / 0 / 0 | – (navigates to a view that does not exist) | 1 sentence, accept the proposed moves, apply: 3 steps | `fixConflicts` |

## 1. Weekly planning prep (team lead)

**Today** (2–3 screens, at least 6 clicks):
1. Tab "Wochenplanung" (`App.jsx:151`).
2. Team pill (`WeekPlan.jsx:54`).
3. "Optimieren" (`PlanOptimizer.jsx:62`) opens the panel.
4. Choose the mode (`:199`) and optionally 85 / 100 % (`:203`).
5. Optionally untick suggestions (`:144`).
6. "Ausgewählte Vorschläge vormerken" (`:260`).
7. Optional manual moves on cards (`WeekBoard.jsx:863-878`).
8. "In Jira übernehmen (n)" (`WeekBoard.jsx:1009`).

**Target:** "Bereite die Wochenplanung für Team Web vor"
1. Lotse lists overload, conflicts and urgent gaps, with counts.
2. You choose what to fix.
3. One preview, one "Übernehmen".

**Acceptance:**
- At most 3 clicks after the sentence.
- Every move is listed in the preview.
- One undo reverts all of them.

## 2. C-level report (management)

**Today:**
- Quick PDF: tab "C-Level-Report", then "Als PDF exportieren" (`Report.jsx:91`). 2 clicks, no choices.
- Composer: "Mit Lotse zusammenstellen" (`Report.jsx:92`), audience, scope, quarter, language and title (`ReportComposer.jsx:290-356`), then "PDF herunterladen" (`:256`).
- Confluence: "In Confluence veröffentlichen" (`Report.jsx:90`), then space and title (`:253-254`), then "Veröffentlichen".

**Target:** "Erstelle den C-Level-Report"
1. You choose the audience and quarter. Lotse proposes both.
2. Preview of the summary with verified facts.
3. PDF or Confluence.

**Acceptance:**
- Every number in the report summary passes `selfCheck` / `crossCheck`.
- At most 3 clicks.

## 3. Booking check (team lead / employee)

**Today:**
1. Tab "Plan vs. Ist" (`App.jsx:152`).
2. Period (`PlanActual.jsx:115`).
3. Scroll to the card (`BookingCard.jsx:52`).
4. "Nur Auffällige" (`:55`).
5. Team chip (`:61`).

The table is read-only. Reminders exist only as admin configuration (`Admin.jsx:384`).

**Target (team):** "Wer hat zu wenig gebucht?"
1. A list with the gap in hours per person.
2. "Erinnern" with a preview of the message.
3. Send.

**Target (self):** `bookingCheck`. "Prüfe meine Buchungen" proposes bookings from the plan.

**Acceptance:**
- The list matches `BookingCard`'s escalation and hint status.
- The reminder is never sent without the preview.

## 4. Support dispatch (support lead)

**Today:**
1. Tab "Support", section "Verteilen" (`Support.jsx:103`).
2. Either per ticket: team (`SupportDispatch.jsx:228`) and person (`:237`), pre-filled, then "Zuweisen" (`:248`).
3. Or in bulk: select all (`:207`), then "Ausgewählte zuweisen" (`:171`).

**Target:** "Verteile die neuen Support-Tickets"
1. Lotse shows the proposals: SLA first, the person with the most room.
2. "Alle übernehmen" or adjust single tickets.
3. Apply.

**Acceptance:**
- The same proposals as `SupportDispatch` (`dispatch.suggestTeam` / `suggestAssignees`).
- Breached tickets come first.
- One undo.

## 5. Quarterly re-ranking (management / portfolio admin)

**Today:**
1. Tab "Portfolio" with "Rangfolge" (`Portfolio.jsx:93`).
2. Optionally the waterline quarter (`:95`).
3. Drag (`:192`) or "Rang hoch/runter" (`:245`). Each change is saved immediately.

**Target:** "Ranking für das Quartal neu setzen"
1. Choose one ordering: today's ranking, due first, at-risk first, or staffable first. Each comes with its hours missing and
   the number of projects not staffed (`workflows.rankCandidates`).
2. Waterline preview.
3. Apply.

**Acceptance:**
- The before and after numbers equal an engine re-run on the new order. The golden set what-if facts already check this
  for single moves.

## 6. Filling missing values (project lead)

**Today:**
- Path A: tab "Projekte", project pill (`Project.jsx:72`), then per gap the suggestion pill (`Quality.jsx:332`) or the
  fixer field plus "Setzen" (`:359-388`).
- Path B: "Heute zu tun" (`Inbox.jsx:32`), then "Alle n prüfen & übernehmen" (`:68`), then confirm (`ChangePreview.jsx:18`).

**Target:** "Fülle die Lücken in ERP-Anbindung"
1. "Alle Vorschläge übernehmen" or "Einzeln durchgehen".
2. Preview.
3. Apply.

**Acceptance:**
- The gap count equals `engine.dataQuality` gaps: severity `gap`, without `overdue`. The golden set checks this (106 on
  the fixture).
- Only suggestions with evidence are offered.

## 7. Overload resolution (team lead)

**Today:**
1. Tab "Teams", team pill (`Team.jsx:53`).
2. "Kommende Wochen" (`:192`).
3. "Optimieren", "Überlast glätten" or "Umverteilen", 85 / 100 %, "vormerken", then "In Jira übernehmen". These are the
   same controls as job 1.

The alternative is "Kapazitäten pflegen" (`Team.jsx:62`).

**Target:** "Löse die Überlast in Team UX"
1. Choose the team. Lotse proposes the one with the highest peak.
2. Choose how: stretch, later, reassign, or accept.
3. Preview and apply.

**Acceptance:**
- After applying, the team's weeks above 100 % go down, measured with `weeksUtilization` on a re-run.
- "Accept" changes nothing.

## 8. Health round (project owners)

**Today:**
1. Tab "Portfolio", "Aktualisieren" per row (`Portfolio.jsx:248`).
2. The modal opens: status (`:418`), sentence (`:429`, required), "Speichern" (`:414`).

That is 3 clicks and 1 field per project. The Inbox offers "Unverändert bestätigen" with 1 click (`Inbox.jsx:50`).

**Target:** "Health-Runde starten"
1. For each of my projects, Lotse shows the draft status and sentence from the metrics.
2. Accept or edit each one.
3. Save all.

**Acceptance:**
- The draft status follows `healthDraft`.
- Nothing is saved without the explicit last step.

## 9. Project onboarding (portfolio admin)

**Today:**
1. "Projekt hinzufügen" (`Portfolio.jsx:97`).
2. Search (`:452`), then "Aufnehmen" (`:466`).
3. Close.
4. "Planung bearbeiten" (`:93`).
5. T-shirt (`PlanGrid.jsx:102`), quarters (`:168-182`), dates (`:112/116`), team (`:119`).
6. Back to "Rangfolge" and drag.

That is about 9 clicks and 4–6 fields.

**Target:** "Nimm ein neues Projekt auf"
1. Choose the Jira issue.
2. Accept the proposals: size from similar work, quarters, lead team, and a rank with its waterline effect.
3. Apply.

**Acceptance:**
- Every proposal shows its evidence (similar projects, free capacity).
- The rank proposal shows the waterline before and after.

## 10. Conflict fixing (project lead / team lead)

**Today:**
1. Tab "Wochenplanung", team pill.
2. Conflict box "Anzeigen" (`WeekBoard.jsx:905-906`).
3. "‹KEY› auf ‹Datum› verschieben" per conflict (`:916`).
4. "In Jira übernehmen" (`:1009`).

The Projekte tab badge counts conflicts but offers no fix there (`Project.jsx:326-333`).

**Target:** "Löse die Terminkonflikte"
1. Lotse lists every conflict with the proposed new dates (`weekPlan.fixFor`).
2. Accept all or deselect some.
3. Apply.

**Acceptance:**
- Afterwards `engine.dependencies` reports 0 conflicts for the moved items.
- One undo.

## Bugs and gaps found while deriving the paths (UI – reported, not fixed)

These are UI bugs that the node tests do not cover. They are listed here for the UI owners.

- **J-1. Health draft shortcut is broken.**
  - "Als Health übernehmen" (`skills/healthDraft.js:69`, action `navigate` `{ view: 'health', status, comment }`) does not
    open the pre-filled dialog.
  - `components/lotse/actions.js:56` passes only `ref`, `setView` drops status and comment (`state.jsx:110-119`), and the
    view falls back to Portfolio (`App.jsx:396`).
- **J-2. Blockers navigation lands on the wrong view.**
  - `blockers` navigates to `deps` (`skills/blockers.js:63`), but `views/Dependencies.jsx` is not mounted. `deps` renders
    the Projekte view (`App.jsx:396`).
  - `selftest.jsx:738` still expects a Dependencies tab.
- **J-3. The Quality view is never mounted.** `views/Quality.jsx` (SmartSuggestions, Prüfregeln) is not shown: view
  `quality` maps to Project (`App.jsx:396`).
- **J-4. The Capacity view cannot be reached from the UI.** It is not a tab, and only Lotse navigates there
  (`realCapacity.js:52`).
