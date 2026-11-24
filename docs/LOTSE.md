# Lotse (EN: Navigator) – the cockpit's own agent · contract (2026-11-12)

Goal (product owner, verbatim spirit): an agent of our own, equal or better than the Forge LLM features, ambitious, simple,
**visual first**, **real data, never placeholder text**, accurate summaries. Works for everyone, free, instant, offline from any
AI. When AI is on, Lotse and Forge LLM **cooperate**: the LLM gives its reading of the same facts, the app **cross-checks**
every number / key / team / date it mentions against Lotse's verified facts, and shows agreement or the differences. The
verified story always wins. The LLM sees the compact story (small prompt, cached) → cheaper than today.

## Files (all new unless noted)
- `shared/lotse/story.js` – the Story format, `validStory(s)` (strict), helpers `num/pct/hours/date` facts, `storyFacts(s)` (the
  set of verifiable claims: numbers with units, issue keys, team ids/names, dates, ranks).
- `shared/lotse/understand.js` – `understand(text, ctx, memory)` → `{ skill, params, confidence, alternatives[] }`. Reuses
  `shared/ask.js` (parseQuestion, findProject, findTeam, fixTypos), `shared/wishCatalog.js`. DE+EN, typo tolerant, follow-ups
  ("und für Team Web?", "warum?", "was wäre wenn …") resolved with `memory` = last story's subject/params.
- `shared/lotse/skills/*.js` – one file per skill; each exports `{ id, title(lang), match: RegExp[] (DE/EN), params,
  run(ctx, params, lang) → Story }`. Index in `shared/lotse/skills/index.js`.
- `shared/lotse/narrate.js` – deterministic natural language (DE/EN): verdict sentence, findings sorted by impact, number
  formatting (fmt passed in), varied phrasing without randomness (seeded by subject), never generic filler.
- `shared/lotse/crosscheck.js` – `crossCheck(story, llmText)` → `{ agree: 0..1, claims: [{text, kind, verified: true|false|null,
  expected, found}], verdict: 'agrees'|'differs'|'unverifiable' }`. Pure code, no second LLM call.
- `shared/lotse/index.js` – `ask(text, ctx, memory)` → Story; `briefing(ctx, role)` → Story[] (top 3 for "Heute für dich").
- UI: `static/cockpit/src/components/lotse/` – `StoryCard.jsx`, `Lotse.jsx` (panel + composer + follow-up chips + history),
  `TodayStrip.jsx` (proactive top 3), `WhatIf.jsx` (scenario before/after), `CrossCheck.jsx` (Lotse vs KI view), css.
- Server: resolver `lotse.llm` (optional, AI on + per-person rule + budget): sends ONLY the story (validStory) as facts,
  asks for a short reading; returns text + crossCheck. Reuses `src/lib/ai.js` llm() (budget, cache, metering).

## Story (the one format every skill returns)
```js
{
  id: 'projectBrief:issue:10046',          // skill:subject – stable (cache, follow-ups)
  skill: 'projectBrief', subject: { kind: 'project'|'team'|'person'|'portfolio'|'ticket'|'topic', ref, name },
  lang: 'de'|'en', computedAt: ISO,
  tone: 'ok'|'warn'|'bad'|'info',          // the verdict colour
  headline: 'Glasfaser Nord ist 12 Tage über dem Termin – Team Netz fehlt 140 h in Q4.',   // ONE sentence, real numbers
  kpis: [{ id, label, value: number, unit: 'h'|'%'|'d'|'n'|'eur', tone, delta?: number, hint? }],   // 2–4
  visual: { kind: 'bars'|'columns'|'line'|'donut'|'heat'|'timeline'|'compare'|'waterline'|'gantt',
            data: {...}, caption: 'one sentence what the chart shows' },                       // REQUIRED – visual first
  findings: [{ text, tone, impact: number, evidence: [{ key?, ref?, label, value? }] }],      // 1–4, sorted by impact
  actions: [{ id, label, kind: 'open'|'move'|'assign'|'fill'|'rank'|'dispatch'|'navigate'|'whatIf', payload, preview: string,
              undoable: true }],                                                               // 0–3, never auto-applied
  followUps: [{ label, text }],                                                                // 2–4 suggested next questions
  how: { text, inputs: [[label, value]] },                                                     // transparency ("So ermittelt")
  confidence: 'high'|'medium'|'low', sources: ['Jira', 'Kapazitäten', …]
}
```
Rules: every number in headline/findings must come from `kpis`, `visual.data` or `evidence` (tests check it). No sentence
without a fact. Empty data → an honest Story with tone 'info' and what is missing (never "lorem"/"n/a" filler).

## Skills (must cover every Forge LLM feature, and more)
projectBrief · teamBrief · portfolioBrief (C-level summary) · myWeek · planningAdvice (optimize.js) · gapsFix (value suggestions
from similar work, insights.similarWork) · dispatchAdvice (dispatch.js) · planActualExplain (planActual.js) · healthDraft
(status + sentence from metrics) · supportTopics/playbook · estimate (similarWork) · overtime / realCapacity / fits (insights)
· waterline · blockers/dependencies · whatIf (re-run engine with a changed rank / person hours / due date → before/after) ·
compare (two projects/teams side by side) · today (role-based top 3).

## Quality bar
- Visual first: every story has a chart that answers the question at a glance.
- Real data only, DE+EN, numbers formatted, sorted by impact, ≤ 4 findings, ≤ 3 actions.
- Fast: < 50 ms per story on the mock dataset; no network.
- Accessible (axe 0), framer-motion transform/opacity only, NO AnimatePresence exit animations.
- Never the word "rovo".

## Parity, teamwork, learning, usage (2026-11-12)
- **Parity** (`shared/lotse/parity.js`): every AI feature id has a Lotse skill – ask→today/ask(), healthDraft, reportSummary→portfolioBrief,
  planning→planningAdvice, gaps→gapsFix, dispatch→dispatchAdvice, planActual→planActualExplain, teamBrief, projectBrief,
  myWeek→**bookingComments**, intent→**intentMap**, similarSummary→**similarSummary**, playbookDraft→**playbookDraft**, lotse→today.
  Test: `tests/lotseParity.test.js` (the AI's own validator accepts Lotse's drafts).
- **Teamwork** (`shared/lotse/teamwork.js`, UI `components/AiAssist.jsx`, health dialog in `views/Portfolio.jsx`): one panel, Lotse first
  (instant), the AI next to it; narratives cross-checked claim by claim, suggestions compared ("Beide schlagen … vor" / both, the
  person picks); the pick goes through the screen's existing apply path with undo. AI off → Lotse alone (briefings: the Lotse chip).
- **LLM teaches Lotse** (`shared/lotse/learn.js`, `src/lib/learn.js`): `ai.assist` intent with `lotseMissed` → masked phrase pattern
  as a candidate (≤ 500/site); admins approve/reject (Konfiguration › KI & Datenschutz); approved patterns reach `understand()` via
  `ctx.learned`. Resolvers `lotse.learned` (read), `lotse.learn.review` (admin write).
- **Usage** (`shared/usage.js`, `src/lib/usage.js`, client `lib/usage.js`): counts only from a fixed allow-list, per site and day, 30 days (append-only, see below);
  `usage.track` (write, no ctx), `usage.summary` (admin read); view in Konfiguration › Nutzung.

## Acts – commands (2026-11-12)
`shared/lotse/act/commands.js` · `bulk.js` (plain-language commands) · `route.js` (which job a sentence asks for) · UI `components/lotse/acts.js`.
- `COMMANDS[id] = { id, title(L), write, params, validate(params, ctx), allowed(ctx, params), preview(ctx, params), apply(params, io, { ctx, token }) }`.
  16 commands: `rank.set`, `rank.reorder`, `issue.setField`, `issue.bulkFill`, `plan.move`, `plan.applyOptimizer`, `health.set`, `dispatch.assign`,
  `support.reserve`, `deps.link`, `deps.unlink`, `booking.book`, `notice.remind`, `capacity.setHours`, `report.compose` (no write – opens the
  composer), `navigate` (no write).
- `Preview = { command, title, write, changes[≤ 40 shown] (kind, key|ref, field, from → to, label), count, more, totals, summary, warnings[],
  blocked: null | reason, token }`. **Never a write without its preview**: `apply()` recomputes the preview and refuses unless the token matches
  (`PREVIEW_REQUIRED` / `STALE_PREVIEW`); the token covers the params AND the data they touch.
- `Done = { label, run(io) → undo | null, irreversible?, keys[], applied, failed, errors[] }` – every write goes through the app's existing
  resolvers (as the signed-in person; the server checks the role again) and registers its exact undo.
- `allowed(ctx)` mirrors the server's role checks (`act/kit.js can.*`); a plain viewer is refused before anything is sent.
- **`notice.remind { kind: booking|gaps, people[] }`** → resolver **`notices.remind { kind, accountIds, dryRun? }`** (write; capacity editors and
  Jira admins; refused with `NOTICES_OFF` unless `config.notices.enabled`): the existing gap / booking reminder (`src/lib/notices.js`
  `remindPeople`) – booking: the last checked period, only people below the minimum, no escalation; at most one per person, kind and day
  (`notices:remind:<day>`, deleted by the hourly job); audited (`notices.remind`: kind, counts, recipients). `dryRun` = who would get one – nothing
  sent, marked or audited. Irreversible – the preview says so. Tests: `tests/notices.test.js`.

## Acts – workflows (2026-11-12)
`shared/lotse/act/workflows.js` – a pure state machine: `start(goal, ctx)`, `answer(state, stepId, value)`, `next`, `applyStep(state, io)`,
`cancel`, `undoAll(state, io)`, `current(state)`, `planWorkflow(goal, ctx, answers)` (deterministic: same goal + data + answers = same steps).
- Step kinds: `story` (real data), `decide` (options with facts / free text), `preview` (the aggregated changes of the command steps after it –
  'apply' stamps each command with its preview token, the only way a command gets one), `command`, `summary`.
- Ten workflows: `weeklyPrep`, `resolveOverload`, `reRankQuarter`, `fillGaps`, `bookingCheck`, `healthRound`, `supportTriage`, `onboardProject`,
  `fixConflicts`, `cLevelReport`. Cancel keeps what was applied; `undoAll` takes every applied command back, newest first.
- Usage events: `lotse:workflow:<id>:start|done|cancel` (counts only, `shared/usage.js`).

## Missions – knowledge from the past (2026-11-12)
`shared/lotse/act/missionsKnowledge.js` (registered through `missions.js`; same planner and state machine). Tests: `tests/lotseMissionsKnowledge.test.js`.
- **`learnFromPast { project }`** ("Lerne aus früheren Projekten für …", "Schätze das Projekt anhand ähnlicher Projekte", "what did past projects
  teach us …"). Without a project: Lotse asks, recommending the one with the most open stories without an estimate (then the riskiest health).
  Story: per group of open stories the similar finished stories (`similarWork`, as gapsFix) – median estimate vs. time spent (`compare`), the
  typical overrun, the team factor (`estimateFactors`: own team from 5 stories, else all teams – said which), the comments of that work
  (recurring words with the work item keys as evidence – only from `ctx.comments`, the `insights.comments` shape; the counts otherwise), the
  latest comment of blocked stories. Thin past (< 10 finished stories or < 3 similar): said in the headline, confidence low, siblings help out.
  Decide: fill missing estimates (`gapsFix.suggestFor`: median of ≥ 2 similar finished stories, else siblings) – all or one by one with own hours;
  correct existing estimates of stories not started by the team factor (never recommended – realistic capacity already applies it); optional lesson
  note in the health update (`health.set`, status kept, undoable). Writes: `issue.bulkFill` (field `estimate`), `health.set`.
- **`supportPlaybooks`** ("Erstelle Playbooks für wiederkehrende Support-Themen", "create help articles / standard replies for recurring tickets").
  Story: recurring topics (`supportTopics` over history + current tickets): tickets, hours, last occurrence, trend, which already have a playbook.
  Decide: which topics (≤ 8, multi), then per topic the `playbookDraft` draft – symptoms, steps, a standard reply without internal figures; one own
  sentence (the proven fix) replaces the fix placeholder in the steps and the customer step in the reply. Writes: **`playbook.save`**, then
  `navigate { view: 'support', opts: { tab: 'playbooks' } }`.
- **`playbook.save { items: [{ id?, topic, topicName, title, symptoms[], steps[], reply, keys[], source }] }`** (write; 1–20; `validPlaybook` shape,
  over-long fields refused, a reply and a step required). Rights as `src/lib/playbooks.js`: the Support tab plus dispatch or capacities; admins.
  Runs `playbooks.list` (a topic with a playbook is never overwritten – `EXISTS`), then `playbooks.save` per item. Undo: `playbooks.delete` of the
  created id, or the previous version saved back (`restore: true`). App storage only – nothing is posted to a Jira ticket. The preview warns about
  [placeholders] still open and internal figures (keys, hours, ticket counts) in a reply.
- Optional ctx inputs: `history` (insights.history), `comments` (insights.comments), `playbooks` (playbooks.list) – without them the missions use the
  dataset, say what is not loaded, and `playbook.save` checks the stored playbooks itself.

## Report composer (2026-11-12)
Engine `shared/lotse/report/compose.js` (pure) · leaving the browser `shared/lotse/report/publish.js` (pure) · UI `components/report/`.
- `draftReport({ ctx, audience: c-level|steering|team|project, period, sections?, projectRef?, teamId?, lang })` → Doc
  `{ v, audience, lang, period: { quarter, label }, projectRef, teamId, title, subtitle, asOf, published?, sections[] }`;
  section `{ id, kind: summary|kpis|story|chart|table|risks|text, title, on, text, variants, facts, data, story?, entities, keys, tone }`.
  Numbers live in the text as tokens `{{factId}}` (chips); `checkSection(section)` lists every claim no fact backs.
- **Language**: everything on the sheet (text, figures, charts, table heads, cover) is in `doc.lang`, independent of the app language. Charts are
  drawn from the PDF's own operations (`pdfLayout.js layoutVisual` → `ReportVisual.jsx` as SVG, theme colours, a hidden table from `visualTable`).
- **Draft per person**: browser (`localStorage`, instant) + server (`prefs.save { reportDraft }` → `cleanDraft`: settings, order, titles, texts,
  chips and data blocks; no stories, no name lists; ≤ `DRAFT_MAX_BYTES` 120 KB; own key `draft:report:<accountId>`; `null` deletes;
  `prefs.reportDraftAt`). Read: **`report.draft`** (read). On open the newer copy wins unless the person already changed something.
- **Confluence: `report.publishComposed { doc, spaceId, title?, pageId?, dryRun? }`** (write; report right; admin-approved space):
  1. `cleanComposed(doc)` – shape, ids, kinds, units, ≤ 24 sections, ≤ 6000 characters per text, ≤ 150 KB; data blocks from the browser are dropped.
  2. A **fresh** computation: the caller's dataset (`loadDataset`, as the user) + the stored snapshot (as the report view: extras, plan vs. actual)
     → `draftReport` with the same audience / quarter / team / project / language / section ids.
  3. `verifyComposed(doc, fresh, { people })` – per section switched on: chips whose value changed (`stale`), claims no fresh fact backs
     (`unsourced`: `checkSection` on the text with every chip written out, and on a changed title), person names anywhere (`person`).
     Any problem → nothing is written, `{ ok: false, problems }` (also the dry run's answer).
  4. `composedStorage(verified)` – storage format; data blocks from the fresh draft; charts as tables (`visualTable`) – images would be attachments
     (`write:attachment:confluence`, not requested); rows naming a person are left out.
  5. Create (`POST /wiki/api/v2/pages`) or, with the `pageId` of a page published from here by the same person (or an admin), update (`PUT`, next
     version); the page record and its last / previous body are kept (`report:page:<id>`). Audited (`report.publishComposed`).
- **Undo: `report.unpublishComposed { pageId }`** – after an update the previous version is restored (as a new version); after a first publish the
  page is withdrawn (title marked, body replaced by a note) – the app holds no delete permission. Audited (`report.publishComposed.undo`).
- Tests: `tests/reportComposer.test.js`, `tests/reportComposerUi.test.js`, `tests/reportPublish.test.js`.

## Report view – executive summary teamwork (2026-11-12)
`views/Report.jsx ExecSummary`: Lotse's verified summary (`draftSection('summary')`, every number a fact) shows at once; the portfolio briefing story
feeds `components/lotse/CrossCheck.jsx` (the AI's reading, while AI is on for Lotse). With `aiOn(config, 'reportSummary')` the AI summary
(`ai.reportSummary`) stands next to it and is cross-checked in code against Lotse's facts (`crossCheck(checkStory(summary), text)`) – agreement,
or each differing claim with the verified value; Lotse's version applies.

## Usage counter – race-free (2026-11-12)
`src/lib/usage.js`: every `usage.track` batch is its own append-only shard `usage:<day>:<id>` (no read-before-write, so concurrent browsers never
overwrite each other). Reading merges the day record and the day's shards. The hourly job compacts closed days (older than yesterday): list shards
→ read the record → add the shards it does not hold yet (`from`) → write → delete the shards; concurrent compactions write the same result,
nothing is counted twice. Tests: `tests/usage.test.js` (60 concurrent batches, parallel compaction, a crash between write and delete).

## Orchestration – "Auftrag ausführen" / "Run a job" (2026-11-16)
Free-form compound requests ("Prüfe alle Arbeitswochen der Leute im Projekt X, pack alles in ein PDF und bereite für jeden
Kollegen einen persönlichen Bericht vor") become a plan the person adjusts, real work per recipient and a proven document.
- `shared/lotse/act/orchestrate/parse.js` – `parseJob(text, ctx)` → `{ scope, subjects, blocks, window, format, audience, tone,
  personal, said, ambiguous }` (DE/EN, number words, typos); `jobScore()` decides the routing in `route.js` (a job = something to
  hand back – PDF, notes, summary – built from data blocks for several subjects; the jobs with their own workflow are never
  taken over); `cleanJob()` validates a job from outside.
- `orchestrate/data.js` – per subject with the cockpit's own numbers: coming weeks = `engine.weeksUtilization` (plus the
  scope's share, same linear spread), past weeks = `booking.bookingOverview`, tasks, absences + holidays (`personDays`),
  plan vs actual (`ctx.planActual`), support; `assess()` = findings with evidence + concrete suggestions.
- `orchestrate/stories.js` (plan, one card per subject, overview – all selfCheck-clean), `orchestrate/plan.js` (the workflow
  `orchestrate`: scope decide if missing/ambiguous → plan story + pipeline → blocks · recipients (multi + free text) · period
  (presets + free text) · format · tone (+ own opening line) → cards → optional Jira booking reminder (off by default, every
  recipient in the preview) → preview of the document → `doc.pdf` → summary with the job).
- `shared/lotse/report/jobDoc.js` – the pure document model (`buildJobDoc`, `sectionDoc`, `docProblems`): cover, overview,
  one section per recipient (greeting, KPIs, chart, tables, findings, suggestions, message), proof appendix (values,
  formula, inputs, Jira keys) – every table/KPI figure carries its proof id.
- Command `doc.pdf` (write: false) → `io.pdf(doc, { each })` (components/lotse/hooks.js → `lib/jobPdf.js`: `layoutJob` pure
  layout reusing the composer's chart layout, `downloadJobPdf`, `downloadSectionPdf`); fakeIo records it.
- UI `components/lotse/JobCards.jsx` + `jobs.css`: plan pipeline, tabbed personal sections, document outline in the preview,
  result card (download again, personal PDFs, texts to copy, proof). Tests: `tests/lotseOrchestrate.test.js`.
- What-if phrasing (tester 2026-11-16): `shared/lotse/numbers.js` (number words) + `understand.js` `scenarioChange` –
  "X gets 2 more weeks", "gib X zwei Wochen mehr", "X starts a week later" are what-ifs; "verschiebe / push …" stays a
  previewed command.

## Chains – "Mehrstufiger Auftrag" / "Multi-step job" (2026-11-16)
Complex, unique requests ("Find everyone over 100 % in the next 4 weeks, plan each of their weeks to 100 % and give every
one of them a PDF with their new plan") become a plan of steps with data flowing between them – app-native; Forge LLM helps
when it is on, never owns a plan or a number.
- **Catalogue** `shared/lotse/act/tools.js` – generated from the registries (skills → `skill.*`, workflows/missions → `wf.*`,
  commands → `cmd.*`, named queries → `query.*`) plus the set-aware chain tools (`plan.balance`, `fill.estimates`,
  `check.waterline`, `notify.remind`, `doc.job`, `doc.list`, `doc.brief`, `query`). Each tool: id, DE/EN title + description,
  typed params (`cleanParams`: names → refs, unknown params refused), input (which sets it works on), output, write flag,
  right. Annotations the registries cannot say (`WF_COMMANDS`, `COMMAND_RIGHT`, `WF_PREFILL`) are checked for completeness by
  the tests. `catalogSchema()` = what the LLM planner sees (no data).
- **Query language** `shared/lotse/act/query.js` – `{ entity: people|projects|teams|stories|tickets, where: [{ m, op, v }],
  window, scope, limit }`, text form `people where load > 100 next 4w`; fixed metrics per entity (load, overWeeks, booking,
  absentPlanned, planned, free, overdue · staffable, missing, daysOverdue, overdueStories, noTshirt, progress, rank · load,
  support, slaRisk · overdue, blocked, noEstimate, remaining · sla, slaLeft); numbers from the engine (weeksUtilization via
  orchestrate/data.js personData, bookingOverview, waterline, projectMetrics, ticketSla). Every member carries the numbers
  that qualified it; `setStory` is selfCheck-clean. `parseQuery` reads DE/EN set questions.
- **Planning** `chain/split.js` (clauses: sentence ends, sequence words, verbs after und/and/commas, lists after "Für jedes
  Team:", references "sie/them/jeweils/each of them") → `chain/plan.js` `planChain` (each clause: learned tool → chain
  patterns → query → route.js `routeSingle` → orchestrator job → understand() skill; unmapped clauses listed as
  `unresolved`), `cleanPlan` / `planProblems` (strict), `comparePlans` (LCS alignment), `chainRoute` (conservative: two mapped
  steps AND a data flow, a set to find, a chain tool or a sequence word – single jobs route as before).
- **Running** `chain/run.js` – the workflow `chain` on the same planner/state machine: decide `plan` (custom answer
  `chainPlan`: the edited plan, checked again; frozen with the waterline **baseline**), one section per step (`meta.section`,
  output in `meta.out` of its first step), sub-workflows run with prefixed ids and their decisions pre-answered from the
  step's params, a **checkpoint** (`sN:gate`) after every step that changed data – answering it re-plans the rest on the
  fresh numbers; finished sections are **frozen** (re-emitted from `P.prev`, workflows.js passes the previous steps to the
  planner). Writes keep preview → token → apply → undo; `undoAll` takes the whole chain back newest first; a reminder is only
  sent after the explicit `send` choice with every recipient in the preview. `chainSections(state)` gives the UI each step's
  live status (planned → running → waiting → done / skipped / failed). Documents: `doc.job` (orchestrate job over the set,
  `job.only`), `doc.chain` command (list / brief, `chain/docs.js`, same renderer and proof checks).
- **LLM helper** `chain/llm.js`, resolver `lotse.llm` with `mode` (`requireAi` first, then `takeQuota`, the one `llm()`
  gateway, audit): `plan` – scrubbed request with people as P1 / projects as "#rank KEY" unless the admin allows names /
  texts + `catalogSchema()` → strict JSON; shape check server-side, full check in the browser; shown next to Lotse's plan
  with the differences, the person chooses; an accepted AI plan can be offered for learning (`learn` mode → masked pattern +
  tool, admin approval, `learnedTool`). `write` – a short text from a verified story only; the engine uses it only if every
  claim is verified (`checkedText`), otherwise Lotse's text and the mismatch are shown ("KI-Text, von Lotse geprüft").
  Any failure → Lotse alone with a short note. Mock: `lib/mockChain.js` (`?ai=differs`, `?lotse=differs`).
- **UI** `components/lotse/ChainCards.jsx` + `chain.css` (plan graph editor, AI comparison, live graph, section heads, set
  tables, checkpoint, note with AI draft, result), wired into `Workflow.jsx`. Runs live in runStore (page memory, like every
  workflow – a reload starts fresh). Tests: `tests/lotseChain.test.js`.
