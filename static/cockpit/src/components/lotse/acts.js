// Lotse acts in the UI – pure helpers (no React, no engine import, so node tests can load them):
//   ACTION_KIND / actionKind(command)  the usage kind a command counts as (shared/usage.js allow-list: lotse:action:<kind>)
//   groupChanges(changes)              a preview's change rows grouped by field, for the visual diff
//   composerParams(p)                  report.compose params → the report composer's own vocabulary (components/report/open.js)
//   JOBS                               the jobs of tests/golden/JOBS.md as gallery cards ("Was möchtest du erledigen?")
//   FREE_HINT[kind]                    what a free-text answer should look like, DE/EN
//   phasesOf(state)                    the stepper of a workflow: overview · decide · preview · apply · result
//   replayAnswers(goal, answers, ctx, api)  a fresh plan on new data with the person's earlier answers (re-preview)
//   staleItems(previewStep, steps, ctx, previewCommand)  which aggregated preview items no longer match the data
export const ACTION_KIND = {
  'rank.set': 'rank', 'rank.reorder': 'rank',
  'issue.setField': 'fill', 'issue.bulkFill': 'fill', 'health.set': 'fill', 'booking.book': 'fill', 'capacity.setHours': 'fill', 'capacity.closure': 'fill', 'capacity.setShares': 'fill', 'support.reserve': 'fill', 'playbook.save': 'fill',
  'plan.move': 'move', 'plan.applyOptimizer': 'move', 'deps.link': 'move', 'deps.unlink': 'move',
  'dispatch.assign': 'dispatch', 'notice.remind': 'assign',
  'report.compose': 'open', 'doc.pdf': 'open', 'doc.chain': 'open', navigate: 'navigate',
};
export const actionKind = (command) => ACTION_KIND[command] || 'open';

// changes: [{ kind, key, ref, field, from, to, label }] → [{ field, kind, n, rows }] in the order they first appear –
// one group per field (a moved and a newly filled due date are both "Fälligkeitsdatum"; the row's "–" shows the fill)
export function groupChanges(changes = []) {
  const by = new Map();
  for (const c of changes || []) {
    const k = c.field || c.kind;
    if (!by.has(k)) by.set(k, { field: c.field || '', kind: c.kind, n: 0, rows: [] });
    const g = by.get(k);
    g.n += 1;
    g.rows.push(c);
  }
  return [...by.values()];
}
// the subject of one change row: the work item key, else the project / person / team the label starts with
export function subjectOf(c) {
  if (c?.key) return c.key;
  const lbl = String(c?.label || '');
  const cut = lbl.indexOf(':');
  return cut > 0 ? lbl.slice(0, cut).replace(/\s·\s.*$/, '') : lbl;
}

// report.compose { audience: board|management|teamLeads, sections[], period } → openReportComposer({ audience, period, sections })
const AUD = { board: 'c-level', management: 'steering', teamLeads: 'team' };
const PER = { currentQuarter: 'current', nextQuarter: 'next', last4Weeks: 'current' };
const SEC = { portfolio: ['portfolio'], waterline: ['waterline', 'capacity'], risks: ['risks', 'blockers'], support: ['support'], planActual: ['planActual'], milestones: ['late'] };
export function composerParams(p = {}) {
  const sections = ['summary', 'kpis', ...new Set((p.sections || []).flatMap((s) => SEC[s] || []))];
  return { audience: AUD[p.audience] || 'c-level', period: PER[p.period] || 'current', sections };
}

// The ten jobs (tests/golden/JOBS.md), in the order of that list. sentence: what Lotse is asked, so a card does the same
// as typing it. minutes: the typical duration with Lotse (decisions included).
export const JOBS = [
  { id: 'balanceWeek', icon: 'target', title: ['Meine Woche auf 100 %', 'My week at 100%'], line: ['Überfälliges einplanen, Überlast glätten, freie Zeit füllen – mit echten Terminen', 'Plan overdue work, smooth overload, fill free time – with real dates'], minutes: 2 },
  { id: 'teamPlan', icon: 'users', title: ['Team realistisch planen', 'Plan a team realistically'], line: ['Support-Reserve aus Erfahrung, Prioritäten, Übergaben – ohne Überstunden', 'Support reserve from experience, priorities, handovers – no overtime'], minutes: 3 },
  { id: 'learnFromPast', icon: 'history', title: ['Aus früheren Projekten lernen', 'Learn from past projects'], line: ['Schätzungen aus ähnlicher erledigter Arbeit und ihren Kommentaren', 'Estimates from similar finished work and its comments'], minutes: 2 },
  { id: 'supportPlaybooks', icon: 'bookmark', title: ['Support-Playbooks anlegen', 'Create support playbooks'], line: ['Hilfeartikel und Standardantworten für wiederkehrende Tickets', 'Help articles and standard replies for recurring tickets'], minutes: 2 },
  { id: 'weeklyPrep', icon: 'calendar', title: ['Weekly vorbereiten', 'Prepare the weekly'], line: ['Überlast, Konflikte und dringende Lücken in einem Rutsch', 'Overload, conflicts and urgent gaps in one go'], minutes: 2 },
  { id: 'cLevelReport', icon: 'report', title: ['C-Level-Report', 'C-level report'], line: ['Zielgruppe, Abschnitte und Zeitraum wählen – Lotse entwirft', 'Pick audience, sections and period – Lotse drafts'], minutes: 2 },
  { id: 'bookingCheck', icon: 'clock', title: ['Buchungen prüfen', 'Check bookings'], line: ['Fehlende Stunden aus dem Plan buchen, Team erinnern', 'Book missing hours from the plan, remind the team'], minutes: 1 },
  { id: 'supportTriage', icon: 'headset', title: ['Support verteilen', 'Dispatch support'], line: ['SLA zuerst, an die Person mit der meisten Luft', 'SLA first, to the person with the most room'], minutes: 1 },
  { id: 'reRankQuarter', icon: 'ranking', title: ['Quartal neu ranken', 'Re-rank the quarter'], line: ['Rangfolgen an der Wasserlinie vergleichen und wählen', 'Compare rankings on the waterline and pick one'], minutes: 2 },
  { id: 'fillGaps', icon: 'edit', title: ['Lücken füllen', 'Fill the gaps'], line: ['Fehlende Werte mit Vorschlägen aus echten Daten', 'Missing values with suggestions from real data'], minutes: 1 },
  { id: 'resolveOverload', icon: 'waves', title: ['Überlast auflösen', 'Resolve overload'], line: ['Strecken, später legen oder umverteilen', 'Stretch, move later or reassign'], minutes: 2 },
  { id: 'healthRound', icon: 'heart', title: ['Health-Runde', 'Health round'], line: ['Entwurf je Projekt annehmen oder ändern, alles speichern', 'Accept or edit the draft per project, save all'], minutes: 3 },
  { id: 'onboardProject', icon: 'plus', title: ['Projekt aufsetzen', 'Onboard a project'], line: ['Werte, Abhängigkeiten, Plan und erstes Health-Update', 'Values, dependencies, plan and first health update'], minutes: 2 },
  { id: 'orchestrate', icon: 'sparkle', title: ['Auftrag ausführen', 'Run a job'], line: ['Frei formuliert: Daten je Person prüfen, PDF und persönliche Texte – jede Zahl belegt', 'In your own words: check data per person, a PDF and personal texts – every number proven'], minutes: 3 },
  { id: 'chain', icon: 'route', title: ['Mehrstufiger Auftrag', 'Multi-step job'], line: ['Finden, planen, erinnern, dokumentieren – in einem Satz, Schritt für Schritt mit Vorschau', 'Find, plan, remind, document – in one sentence, step by step with previews'], minutes: 4 },
  { id: 'disruption', icon: 'calendar', title: ['Ausfall: Plan neu ordnen', 'Closure: rearrange the plan'], line: ['Schnee, Stromausfall, Büro zu – Tage austragen, Arbeit neu einplanen', 'Snow, power cut, office closed – take the days out, re-plan the work'], minutes: 2 },
  { id: 'splitResolve', icon: 'users', title: ['Mehrteam-Konflikte lösen', 'Resolve multi-team conflicts'], line: ['Doppelt verplant, Anteile falsch, Arbeit im falschen Team – prüfen, lösen, Ergebnis gegenprüfen', 'Double booked, wrong shares, work in the wrong team – check, resolve, re-check the result'], minutes: 2 },
  { id: 'fixConflicts', icon: 'link', title: ['Terminkonflikte lösen', 'Fix schedule conflicts'], line: ['Nachfolger hinter ihre Vorgänger legen', 'Move successors behind their prerequisites'], minutes: 1 },
];
export const jobOf = (id) => JOBS.find((j) => j.id === id) || null;

export const FREE_HINT = {
  text: ['Ein Satz, 1–280 Zeichen.', 'One sentence, 1–280 characters.'],
  hours: ['Stunden als Zahl, z. B. 16 oder 7,5 h.', 'Hours as a number, e.g. 16 or 7.5 h.'],
  date: ['Ein Datum wie 2026-12-04, „Freitag“ oder „4.12.“.', 'A date like 2026-12-04, "Friday" or "4.12.".'],
  team: ['Der Name eines Teams, genau wie im Cockpit.', 'The name of a team, exactly as in the cockpit.'],
  tshirt: ['Eine T-Shirt-Größe wie S, M oder L.', 'A T-shirt size like S, M or L.'],
  quarters: ['Quartale wie „Q1 2027, Q2 2027“.', 'Quarters like "Q1 2027, Q2 2027".'],
  dateRange: ['Zwei Daten, z. B. 1.12. – 5.12.', 'Two dates, e.g. 1.12. – 5.12.'],
  scope: ['Ein Projekt, ein Team oder eine Person, z. B. „Projekt ERP-Anbindung“ oder „Team Web“.', 'A project, a team or a person, e.g. "project ERP-Anbindung" or "team Web".'],
  people: ['Namen aus der Liste, z. B. „Anna, Jonas und Lea“.', 'Names from the list, e.g. "Anna, Jonas and Lea".'],
  window: ['Ein Zeitraum wie „die nächsten 6 Wochen“, „letzte 4 Wochen“ oder „dieses Quartal“.', 'A period like "the next 6 weeks", "last 4 weeks" or "this quarter".'],
};

// The workflow's phases, in order, with where the run stands. A phase is done when all its steps are.
const PHASES = [['story', ['Überblick', 'Overview']], ['decide', ['Entscheiden', 'Decide']], ['preview', ['Vorschau', 'Preview']], ['command', ['Ausführen', 'Apply']], ['summary', ['Ergebnis', 'Result']]];
const DONE = new Set(['seen', 'answered', 'applied', 'skipped', 'failed', 'done', 'undone']);
export function phasesOf(state) {
  const steps = state?.steps || [];
  const cur = steps.find((x) => !DONE.has(x.status)) || null;
  const out = [];
  for (const [kind, name] of PHASES) {
    const list = steps.filter((x) => x.kind === kind);
    if (!list.length) continue;
    const done = list.filter((x) => DONE.has(x.status)).length;
    out.push({ kind, name, total: list.length, done, current: cur?.kind === kind, complete: done === list.length && cur?.kind !== kind });
  }
  if (state?.status === 'done') out.forEach((p) => { p.complete = true; p.current = false; });
  if (state?.status === 'cancelled') out.forEach((p) => { p.current = false; });
  return out;
}
// 1-based position of the current step among the steps a person acts on (decide + preview), for the header pill
export function progressOf(state) {
  const steps = (state?.steps || []).filter((x) => x.kind === 'decide' || x.kind === 'preview');
  const done = steps.filter((x) => DONE.has(x.status)).length;
  return { done, total: steps.length };
}

// Re-preview after the data changed: the same goal, planned fresh on the new data, with the earlier decisions
// answered again (a decision that no longer fits stops the replay there – the person answers it anew).
// api = { start, answer, next, current }
export function replayAnswers(goal, answers, ctx, api) {
  let s = api.start(goal, ctx);
  for (let guard = 0; guard < 120; guard++) {
    const cur = api.current(s);
    if (!cur) break;
    if (cur.kind === 'story') { s = api.next(s, ctx); continue; }
    if (cur.kind === 'decide' && Object.hasOwn(answers || {}, cur.id)) {
      try { s = api.answer(s, cur.id, answers[cur.id], ctx); continue; } catch { break; }
    }
    break;
  }
  return s;
}
// the aggregated preview's items whose command now previews to a different token (or fails) on the live data
export function staleItems(pv, steps, ctx, previewCommand) {
  const out = [];
  for (const it of pv?.items || []) {
    if (it.preview?.blocked) continue;
    const st = (steps || []).find((x) => x.id === it.stepId);
    if (!st) continue;
    let now = null;
    try { now = previewCommand(it.command, st.params, ctx); } catch { now = null; }
    if (!now || now.token !== it.preview.token) out.push(it.stepId);
  }
  return out;
}
