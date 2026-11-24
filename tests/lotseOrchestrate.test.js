// Lotse orchestration ("Auftrag ausführen" / "Run a job"): free-form compound requests → a plan the person adjusts →
// real work per colleague / team / project with the cockpit's own numbers → a PDF document model with a proof of every
// number + personal texts. Product owner 2026-11-16: "check all worker weeks for a specific project, arrange all the data
// in a PDF and prepare a personalized report for their colleagues" – and any other job built from the same blocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { understand, validStory, selfCheck } from '../shared/lotse/index.js';
import { start, answer, next, applyStep, current, unsourced, COMMANDS, preview, apply } from '../shared/lotse/act/index.js';
import { parseJob, jobScore, cleanJob } from '../shared/lotse/act/orchestrate/parse.js';
import { personData, teamData, runJob, jobWeeks } from '../shared/lotse/act/orchestrate/data.js';
import { buildJobDoc, docProblems, sectionDoc } from '../shared/lotse/report/jobDoc.js';
import { fakeIo } from '../shared/lotse/act/fakeIo.js';
import { stable } from '../shared/lotse/act/kit.js';
import { bookingOverview } from '../shared/booking.js';
import { lotseCtx, lotseDataset } from './lotseFixture.js';

const de = lotseCtx('de');
const en = lotseCtx('en');
const { model } = de.computed;
const ref = (name) => model.items.find((x) => x.name === name).ref;
const KPR = ref('Kundenportal Relaunch');
const OWNER_DE = 'Prüfe alle Arbeitswochen der Leute im Projekt Kundenportal Relaunch, pack alles in ein PDF und bereite für jeden Kollegen einen persönlichen Bericht vor';
const OWNER_EN = 'Check all worker weeks for the people on Kundenportal Relaunch, arrange everything in a PDF and prepare a personalised report for each colleague';

// ---------------- the parser: golden sentences → the job (subset of fields) ----------------
// scope: [kind, ref|null] · sub: subjects · has: blocks that must be in · not: blocks that must not · win: [past, next] · fmt · aud · tone
const GOLDEN = [
  [OWNER_DE, { scope: ['project', KPR], sub: 'people', has: ['weeks', 'bookings', 'tasks', 'absences', 'risks'], win: [4, 8], fmt: 'pdfAll', aud: 'colleagues', personal: true }],
  [OWNER_EN, { scope: ['project', KPR], sub: 'people', has: ['weeks', 'tasks', 'absences'], win: [4, 8], fmt: 'pdfAll', aud: 'colleagues', personal: true }],
  ['Für jedes Team im Portfolio die Auslastung der nächsten 6 Wochen als PDF für die Teamleitungen', { scope: ['portfolio', null], sub: 'teams', has: ['weeks'], win: [0, 6], fmt: 'pdfAll', aud: 'teamLeads' }],
  ['summarise the support load per person this month and draft a note to each', { scope: null, sub: 'people', has: ['support'], not: ['weeks'], fmt: 'text', personal: true }],
  ["check every project's overdue stories and prepare a PDF for the owners", { scope: ['portfolio', null], sub: 'projects', has: ['overdue'], fmt: 'pdfAll', aud: 'owners' }],
  ['compare plan vs actual for team Web last 4 weeks and give each person their numbers', { scope: ['team', 't-web'], sub: 'people', has: ['planActual'], win: [4, 0], personal: true }],
  ['Fasse die Auslastung meines Teams der nächsten sechs Wochen als PDF zusammen', { scope: ['myTeam', null], sub: 'people', has: ['weeks'], win: [0, 6], fmt: 'pdfAll' }],
  ['Mach mir eine Übersicht über Annas Aufgaben und Urlaub als PDF', { scope: ['person', 'u1'], sub: 'person', has: ['tasks', 'absences'], fmt: 'pdfAll' }],
  ['Erstelle für jede Person in Team Data ein eigenes PDF mit ihren Aufgaben und Abwesenheiten', { scope: ['team', 't-data'], sub: 'people', has: ['tasks', 'absences'], fmt: 'pdfEach', personal: true }],
  ['Schreib jedem Kollegen im Projekt ERP-Anbindung eine Nachricht mit seinen überfälligen Stories', { scope: ['project', ref('ERP-Anbindung')], sub: 'people', has: ['overdue'], fmt: 'text', personal: true }],
  ['Prepare a formal PDF for management with the workload of every team for the next 8 weeks', { scope: ['portfolio', null], sub: 'teams', has: ['weeks'], win: [0, 8], fmt: 'pdfAll', aud: 'management', tone: 'formal' }],
  ['Bitte für alle Leute in Team UX die Buchungen der letzten 4 Wochen prüfen und je Person eine kurze Notiz schreiben', { scope: ['team', 't-ux'], sub: 'people', has: ['bookings'], win: [4, 0], fmt: 'text', personal: true }],
  ['Für jedes Projekt den Fortschritt und die Risiken als PDF für die Projekt-Owner', { scope: ['portfolio', null], sub: 'projects', has: ['progress', 'risks'], fmt: 'pdfAll', aud: 'owners' }],
  ['Create a PDF with the absences and holidays of each colleague in team Mobile for this quarter', { scope: ['team', 't-mob'], sub: 'people', has: ['absences'], fmt: 'pdfAll' }],
  ['Sammle für jeden Mitarbeiter in Datenplattform die Arbeitswochen und mach ein PDF daraus', { scope: ['project', ref('Datenplattform')], sub: 'people', has: ['weeks', 'tasks', 'absences'], fmt: 'pdfAll', personal: true }],
  ['Give each person on Billing-Migration a personal summary of their tasks and risks', { scope: ['project', ref('Billing-Migration')], sub: 'people', has: ['tasks', 'risks'], fmt: 'text', personal: true }],
  ['Prüf die Auslastung aller Teams in den nächsten 4 Wochen und schick mir eine Zusammenfassung', { scope: ['portfolio', null], sub: 'teams', has: ['weeks'], win: [0, 4], fmt: 'text' }],
  ['Wie sieht die Support-Last je Person in Team Integration aus? Bitte als PDF', { scope: ['team', 't-int'], sub: 'people', has: ['support'], fmt: 'pdfAll' }],
  ['personalized PDF for each colleague in CRM-Konsolidierung with weekly load, bookings and overdue work', { scope: ['project', ref('CRM-Konsolidierung')], sub: 'people', has: ['weeks', 'bookings', 'overdue'], fmt: 'pdfEach', personal: true }], // "a personalised PDF for each colleague" = one PDF each
  ['Erstelle einen Bericht für jedes Team mit überfälligen und blockierten Stories für die Teamleiter, sachlich', { scope: ['portfolio', null], sub: 'teams', has: ['overdue'], aud: 'teamLeads', tone: 'formal' }],
  ['Pruefe alle Arbeitswochen der Kolegen im Projekt Kundenportal Relaunch und mach ein PDF', { scope: ['project', KPR], sub: 'people', has: ['weeks'], fmt: 'pdfAll' }], // typos: Pruefe, Kolegen
  ['check the workload of evry colleague in team Web for the next two weeks and write a frendly note to each', { scope: ['team', 't-web'], sub: 'people', has: ['weeks'], win: [0, 2], fmt: 'text', tone: 'friendly' }], // typos
  ['Plan vs. Ist für Team Integration der letzten 4 Wochen, je Person als PDF', { scope: ['team', 't-int'], sub: 'people', has: ['planActual'], win: [4, 0], fmt: 'pdfEach' }],
  ['Report per project on overdue stories for the board', { scope: ['portfolio', null], sub: 'projects', has: ['overdue'], aud: 'management' }],
  ['Für Lea Hoffmann: Wochen, Buchungen und Urlaub der letzten 4 und nächsten 8 Wochen als PDF', { scope: ['person', 'u3'], sub: 'person', has: ['weeks', 'bookings', 'absences'], win: [4, 8], fmt: 'pdfAll' }],
  ['Notiz an jede Person in Glasfaser-Netzausbau mit ihren Aufgaben, locker formuliert', { scope: ['project', ref('Glasfaser-Netzausbau')], sub: 'people', has: ['tasks'], fmt: 'text', tone: 'friendly' }],
  ['Draft a personal message to each member of team Netz about their workload this month', { scope: ['team', 't-netz'], sub: 'people', has: ['weeks'], fmt: 'text', personal: true }],
  ['Stell für alle Teams die Buchungen gegen das Soll der letzten 4 Wochen in einem PDF zusammen', { scope: ['portfolio', null], sub: 'teams', has: ['bookings'], win: [4, 0], fmt: 'pdfAll' }],
];

test(`parser golden set: ${GOLDEN.length} free-form jobs (DE/EN, typos) → scope, subjects, blocks, window, format, audience, tone`, () => {
  assert.ok(GOLDEN.length >= 25);
  const wrong = [];
  for (const [q, x] of GOLDEN) {
    const ctx = /\b(the|each|every|for|with|check|create|draft|give|report|prepare|summarise|compare|personalized)\b/i.test(q) && !/\b(für|der|die|und|mit)\b/i.test(q) ? en : de;
    const j = parseJob(q, ctx);
    const bad = [];
    if (!jobScore(q, ctx).job) bad.push('not routed as a job');
    if (x.scope === null) { if (j.scope) bad.push(`scope ${j.scope.kind}`); }
    else if (!j.scope || j.scope.kind !== x.scope[0] || (x.scope[1] && j.scope.ref !== x.scope[1])) bad.push(`scope ${JSON.stringify(j.scope)}`);
    if (x.sub && j.subjects !== x.sub) bad.push(`subjects ${j.subjects}`);
    for (const b of x.has || []) if (!j.blocks.includes(b)) bad.push(`missing block ${b} (${j.blocks})`);
    for (const b of x.not || []) if (j.blocks.includes(b)) bad.push(`block ${b}`);
    if (x.win && (j.window.past !== x.win[0] || j.window.next !== x.win[1])) bad.push(`window ${j.window.past}/${j.window.next}`);
    if (x.fmt && j.format !== x.fmt) bad.push(`format ${j.format}`);
    if (x.aud && j.audience !== x.aud) bad.push(`audience ${j.audience}`);
    if (x.tone && j.tone !== x.tone) bad.push(`tone ${j.tone}`);
    if (x.personal && !j.personal) bad.push('not personal');
    if (bad.length) wrong.push(`${q}\n    → ${bad.join(' · ')}`);
  }
  assert.deepEqual(wrong, []);
});

test('routing: the jobs go to the orchestrator; questions and the other jobs keep their own way', () => {
  for (const q of [OWNER_DE, ...GOLDEN.map((g) => g[0])]) assert.equal(understand(q, de, {}).workflow, 'orchestrate', q);
  const keep = [['Erstelle einen C-Level-Report', 'cLevelReport'], ['Bereite das Weekly vor', 'weeklyPrep'], ['Plane meine Woche auf 100 %', 'balanceWeek'], ['Löse die Überlast von Team Web', 'resolveOverload'], ['Fülle die Lücken in ERP-Anbindung', 'fillGaps'], ['Health-Runde', 'healthRound']];
  for (const [q, wf] of keep) assert.equal(understand(q, de, {}).workflow, wf, q);
  for (const [q, skill] of [['Lagebild Kundenportal Relaunch', 'projectBrief'], ['Wie geht es Team Web?', 'teamBrief'], ['Executive summary of all projects', 'portfolioBrief'], ['Meine Woche', 'myWeek'], ['Draft a status update for ERP-Anbindung', 'healthDraft']]) {
    const u = understand(q, de, {});
    assert.equal(u.skill, skill, q);
    assert.notEqual(u.workflow, 'orchestrate', q);
  }
});

// ---------------- the what-if phrasings (tester 2026-11-16) ----------------
test('what if: "X gets 2 more weeks" and its siblings are understood – no re-asking', () => {
  const gf = ref('Glasfaser-Netzausbau');
  const due = (weeks) => ({ kind: 'due', ref: gf, weeks });
  for (const [q, w, ctx] of [
    ['What if Glasfaser Nord gets 2 more weeks?', 2, en], ['Glasfaser Nord gets 2 more weeks', 2, en], ['give Glasfaser Nord two more weeks', 2, en],
    ['Glasfaser Nord 2 Wochen mehr', 2, de], ['Was wäre, wenn Glasfaser Nord zwei Wochen länger hätte?', 2, de], ['what if we push Glasfaser Nord back 3 weeks', 3, en],
    ['Glasfaser Nord starts a week later', 1, en], ['Was wäre wenn Glasfaser-Netzausbau eine Woche später startet?', 1, de], ['What if Glasfaser Nord gets two extra weeks?', 2, en],
    ['Gib Glasfaser-Netzausbau drei Wochen mehr Zeit', 3, de], ['Glasfaser Nord bekommt 2 zusätzliche Wochen', 2, de], ['Was wäre wenn Glasfaser Nord zwei Wochen früher fertig ist?', -2, de],
    ['what if Glasfaser-Netzausbau finishes ten weeks earlier', -10, en], ['Was wäre wenn Glasfaser Nord vier Wochen mehr hat', 4, de],
  ]) {
    const u = understand(q, ctx, {});
    assert.equal(u.skill, 'whatIf', q);
    assert.deepEqual(u.params.change, due(w), q);
    assert.equal(u.confidence, 'high', q);
  }
  // an instruction stays a previewed command (never applied without the preview)
  assert.equal(understand('Verschiebe Glasfaser-Netzausbau um 2 Wochen', de, {}).kind, 'decide');
  assert.equal(understand('push Glasfaser Nord back 3 weeks', en, {}).command, 'plan.move');
});

// ---------------- the data: the cockpit's own numbers ----------------
test('per person: coming weeks equal engine.weeksUtilization, past weeks equal the booking check, tasks equal Jira', () => {
  const job = parseJob(OWNER_DE, de);
  const W = jobWeeks(de, job.window);
  assert.equal(W.filter((w) => w.past).length, 4);
  assert.equal(W.filter((w) => !w.past).length, 8);
  const members = new Map();
  for (const t of de.computed.weeks.teams) for (const m of t.members) if (!members.has(m.id)) members.set(m.id, m);
  const run = runJob(de, job);
  assert.ok(run.subjects.length >= 5);
  for (const { subject, data: d } of run.subjects) {
    const m = members.get(subject.id);
    const coming = d.weeks.filter((w) => !w.past);
    coming.forEach((w, i) => {
      assert.ok(Math.abs(w.plan - m.plan[i]) < 1e-9, `${subject.name} plan week ${i}`);
      assert.ok(Math.abs(w.cap - m.cap[i]) < 1e-9, `${subject.name} cap week ${i}`);
      assert.ok(w.planScope <= w.plan + 1e-9, 'planned here ≤ planned in total');
    });
    // the "planned here" share: the same spread, only Kundenportal Relaunch's stories
    for (const w of d.weeks.filter((x) => x.past)) {
      const people = {};
      const a = Date.parse(w.from) / 864e5, b = Date.parse(w.to) / 864e5;
      for (const x of [...de.ds.issues, ...de.ds.supportTickets.tickets]) for (const l of x.worklogs || []) { const day = Date.parse(l.d) / 864e5; if (l.a && day >= a && day <= b) { people[l.a] ||= { h: 0, byIssue: {} }; people[l.a].h += l.h; } }
      const row = bookingOverview(de.computed.model, { people }, a, b, de.ds.config).rows.find((r) => r.id === subject.id);
      assert.ok(Math.abs(w.booked - row.booked) < 1e-9 && Math.abs(w.possible - row.possible) < 1e-9, `${subject.name} booked ${w.key}`);
    }
    const mine = de.ds.issues.filter((s) => s.role === 'estimate' && s.status.cat !== 'done' && s.assignee?.id === subject.id && s.rootRef === KPR).map((s) => s.key).sort();
    assert.deepEqual(d.tasks.map((t) => t.key).sort(), mine, `${subject.name} tasks`);
  }
  // absences: u3 is away from 2026-11-19 to 2026-11-30 in the fixture
  const lea = personData(de, { ...job, scope: { kind: 'portfolio', ref: null, name: 'Portfolio' } }, 'u3');
  assert.deepEqual(lea.absences.map((a) => [a.from, a.to]), [['2026-11-19', '2026-11-30']]);
  // a team: the team row of weeksUtilization
  const web = teamData(de, { ...job, subjects: 'teams' }, 't-web');
  const tw = de.computed.weeks.teams.find((t) => t.teamId === 't-web');
  web.weeks.filter((w) => !w.past).forEach((w, i) => assert.ok(Math.abs(w.plan - tw.plan[i]) < 1e-9 && Math.abs(w.cap - tw.cap[i]) < 1e-9));
});

// ---------------- end to end ----------------
const recommended = (st) => (st.multi ? st.options.filter((o) => o.recommended && !o.disabled).map((o) => o.id) : (st.options.find((o) => o.recommended && !o.disabled) || st.options.find((o) => !o.disabled)).id);
async function drive(goal, ctx, io, script = {}) {
  let s = start(goal, ctx);
  const trail = [];
  for (let g = 0; s.status !== 'done' && g < 120; g++) {
    const cur = current(s);
    trail.push(`${cur.kind}:${cur.id}`);
    if (cur.kind === 'story' || cur.kind === 'summary') s = next(s);
    else if (cur.kind === 'decide') { const v = script[cur.id]; s = answer(s, cur.id, typeof v === 'function' ? v(cur) : v ?? recommended(cur)); }
    else if (cur.kind === 'preview') s = answer(s, cur.id, script[cur.id] || 'apply');
    else if (cur.kind === 'command') s = await applyStep(s, io);
  }
  return { s, trail };
}
function checkRun(s, label) {
  assert.equal(s.status, 'done', label);
  for (const st of s.steps.filter((x) => x.kind === 'story')) {
    assert.doesNotThrow(() => validStory(st.story), `${label}/${st.id}`);
    assert.deepEqual(selfCheck(st.story), [], `${label}/${st.id}: ${st.story.headline}`);
  }
  assert.deepEqual(unsourced(s), [], label);
  const text = JSON.stringify(s.steps.map((x) => [x.title, x.question, x.summary, x.text, x.note, (x.options || []).map((o) => [o.label, o.detail])]));
  assert.ok(!/rovo/i.test(text) && !/undefined|\bNaN\b|\[object|Infinity/.test(text), `${label}: human words only`);
}

for (const [lang, q] of [['de', OWNER_DE], ['en', OWNER_EN]]) {
  test(`the owner's example end to end (${lang}): plan → decisions → a card per colleague → preview → PDF via io.pdf → result`, async () => {
    const ctx = lotseCtx(lang);
    const u = understand(q, ctx, {});
    assert.equal(u.workflow, 'orchestrate');
    const io = fakeIo(ctx.ds);
    const before = stable(io.ds);
    const { s, trail } = await drive({ id: u.workflow, params: u.params }, ctx, io);
    checkRun(s, lang);
    // the plan first, then the person's decisions, then the work, the preview and only then the PDF
    const order = ['story:story:plan', 'decide:blocks', 'decide:people', 'decide:window', 'decide:format', 'decide:tone', 'story:story:overview', 'preview:preview', 'command:cmd:pdf', 'summary:summary'];
    let k = -1;
    for (const id of order) { const at = trail.indexOf(id); assert.ok(at > k, `${id} after the step before (${trail.join(' ')})`); k = at; }
    const plan = s.steps.find((x) => x.id === 'story:plan');
    assert.ok(plan.plan.steps.length >= 4 && plan.plan.sources.length >= 2, 'the plan visual: steps and data sources');
    // a card per selected colleague, exactly their findings
    const picked = s.answers.people;
    const cards = s.steps.filter((x) => x.group === 'sections');
    assert.deepEqual(cards.map((x) => x.subjectId), picked);
    // the PDF: one call to the app's hook, with the document model
    assert.deepEqual(io.calls.map((c) => c[0]), ['doc.pdf']);
    assert.equal(io.writes(), 0, 'nothing written');
    assert.equal(stable(io.ds), before, 'the data is unchanged');
    const doc = io.docs[0];
    assert.equal(doc.lang, lang);
    assert.equal(doc.sections.length, picked.length, 'one section per selected colleague');
    assert.deepEqual(doc.sections.map((x) => x.subject.id), picked);
    assert.deepEqual(docProblems(doc), [], 'every figure has its proof');
    for (const sec of doc.sections) {
      assert.ok(sec.greeting && sec.message.text.includes(sec.greeting), 'a personal greeting');
      assert.ok(sec.tables.some((t) => t.id === 'weeks') && sec.tables.some((t) => t.id === 'bookings'), 'weeks + bookings tables');
      assert.ok(sec.visual?.kind === 'columns', 'the week chart');
      assert.ok(sec.findings.length >= 1);
      assert.ok(sec.message.text.includes(ctx.me.name), 'signed by the person who asked');
    }
    // the proof: formula, inputs, Jira keys – and the keys are real
    const keys = new Set(ctx.ds.issues.map((i) => i.key));
    for (const p of doc.proof) { assert.ok(p.formula && p.values.length >= 1, p.id); for (const x of p.keys) assert.ok(keys.has(x), x); }
    assert.ok(doc.proof.some((p) => p.keys.length), 'Jira keys behind the week numbers');
    const sm = s.steps.find((x) => x.kind === 'summary');
    assert.ok(sm.job && sm.job.scope.ref === KPR, 'the result card can rebuild the document');
    assert.ok(/nichts gesendet|sent nothing/.test(sm.text), sm.text);
    // the same document from the summary's job (download again)
    assert.equal(stable(buildJobDoc(ctx, sm.job).sections.map((x) => x.message.text)), stable(doc.sections.map((x) => x.message.text)));
  });
}

test('other unique jobs from the same blocks run end to end: teams for team leads, projects for owners, support notes, plan vs actual', async () => {
  const cases = [
    ['Für jedes Team im Portfolio die Auslastung der nächsten 6 Wochen als PDF für die Teamleitungen', 'de', (doc) => { assert.ok(doc.sections.every((x) => x.subject.kind === 'team')); assert.equal(doc.window.next, 6); }],
    ["check every project's overdue stories and prepare a PDF for the owners", 'en', (doc) => { assert.ok(doc.sections.every((x) => x.subject.kind === 'project' && x.tables[0].id === 'overdue')); }],
    ['summarise the support load per person this month and draft a note to each', 'en', null, { scope: (st) => st.options.find((o) => o.id.startsWith('project:')).id }],
    ['compare plan vs actual for team Integration last 4 weeks and give each person their numbers', 'en', (doc) => { assert.ok(doc.sections.some((x) => x.tables.some((t) => t.id === 'planActual'))); }],
    ['Erstelle für jede Person in Team Data ein eigenes PDF mit ihren Aufgaben und Abwesenheiten', 'de', (doc, io) => { assert.equal(io.calls[0][1].each, true); const one = sectionDoc(doc, doc.sections[0].id); assert.equal(one.sections.length, 1); assert.deepEqual(docProblems(one), []); }],
  ];
  for (const [q, lang, check, script = {}] of cases) {
    const ctx = lotseCtx(lang);
    const u = understand(q, ctx, {});
    assert.equal(u.workflow, 'orchestrate', q);
    const io = fakeIo(ctx.ds);
    const { s } = await drive({ id: 'orchestrate', params: u.params }, ctx, io, script);
    checkRun(s, q);
    assert.equal(io.writes(), 0, q);
    const job = s.steps.find((x) => x.kind === 'summary').job;
    if (job.format === 'text') { assert.equal(io.calls.length, 0, `${q}: text only – no PDF`); const doc = buildJobDoc(ctx, job); assert.ok(doc.messages.length >= 1 && doc.messages.every((m) => m.text.length > 40)); assert.deepEqual(docProblems(doc), []); continue; }
    assert.equal(io.calls[0][0], 'doc.pdf', q);
    assert.deepEqual(docProblems(io.docs[0]), [], q);
    check?.(io.docs[0], io);
  }
});

test('nothing guessed silently: no scope → a question with presets and free text; free text for recipients and period', async () => {
  let s = start({ id: 'orchestrate', params: { text: 'Mach mir für jeden Kollegen ein PDF mit seinen Arbeitswochen' } }, de);
  const sc = current(s);
  assert.equal(sc.id, 'scope');
  assert.ok(sc.options.length >= 4 && sc.freeText?.kind === 'scope');
  assert.throws(() => answer(s, 'scope', { text: 'xyzzy' }), /free text/);
  s = answer(s, 'scope', { text: 'Projekt ERP-Anbindung' });
  assert.equal(s.answers.scope.value.scope.ref, ref('ERP-Anbindung'));
  s = next(s);
  s = answer(s, 'blocks', ['weeks', 'tasks', 'risks']);
  const ppl = current(s);
  assert.equal(ppl.id, 'people');
  const two = ppl.options.slice(0, 2);
  s = answer(s, 'people', { text: two.map((o) => o.label.split(' ')[0]).join(' und ') });
  assert.deepEqual(s.answers.people.value, two.map((o) => o.id));
  s = answer(s, 'window', { text: 'die nächsten 6 Wochen' });
  assert.deepEqual([s.answers.window.value.past, s.answers.window.value.next], [0, 6]);
  s = answer(s, 'format', 'text');
  s = answer(s, 'tone', { option: 'formal', text: 'Kurzer Stand vor dem Lenkungskreis.' });
  for (let g = 0; g < 20 && current(s)?.kind === 'story'; g++) s = next(s);
  checkRun(next(s), 'free text');
  const job = s.steps.find((x) => x.kind === 'summary').job;
  assert.deepEqual(job.people, two.map((o) => o.id));
  const doc = buildJobDoc(de, job);
  assert.equal(doc.sections.length, 2);
  assert.ok(doc.messages.every((m) => m.text.startsWith('Guten Tag') && m.text.includes('Kurzer Stand vor dem Lenkungskreis.')), 'formal + own opening sentence');
  assert.ok(!s.steps.some((x) => x.kind === 'command'), 'text only: no command at all');
});

test('sending is an explicit option, off by default; when chosen the preview names every recipient first', async () => {
  const ds = lotseDataset();
  ds.config.notices = { enabled: true };
  const ctx = lotseCtx('de', { ds });
  const u = understand(OWNER_DE, ctx, {});
  // default: nothing sent
  const io1 = fakeIo(ctx.ds);
  const r1 = await drive({ id: 'orchestrate', params: u.params }, ctx, io1);
  const send = r1.s.steps.find((x) => x.id === 'send');
  assert.ok(send, 'the question is asked');
  assert.equal(send.options.find((o) => o.recommended).id, 'none');
  assert.ok(!io1.calls.some((c) => c[0] === 'notices.remind'));
  // chosen: the preview lists every person, the reminder goes out only after "apply"
  const io2 = fakeIo(ctx.ds);
  let s = start({ id: 'orchestrate', params: u.params }, ctx);
  for (let g = 0; g < 80 && current(s)?.kind !== 'preview'; g++) { const cur = current(s); s = cur.kind === 'decide' ? answer(s, cur.id, cur.id === 'send' ? 'remind' : recommended(cur)) : next(s); }
  const pv = current(s);
  const item = pv.items.find((x) => x.command === 'notice.remind');
  assert.ok(item && item.preview.changes.length === s.steps.find((x) => x.id === 'cmd:remind').params.people.length, 'every recipient in the preview');
  assert.equal(io2.calls.length, 0, 'nothing before the preview is answered');
  s = answer(s, pv.id, 'apply');
  while (current(s)?.kind === 'command') s = await applyStep(s, io2);
  assert.deepEqual(io2.calls.map((c) => c[0]), ['doc.pdf', 'notices.remind']);
});

test('doc.pdf: a no-write command – validated job, preview with the outline, run hands the document to io.pdf', async () => {
  const job = { ...parseJob(OWNER_DE, de), people: ['u1', 'u2'] };
  assert.equal(COMMANDS['doc.pdf'].write, false);
  assert.throws(() => preview('doc.pdf', { job: { ...job, scope: { kind: 'project', ref: 'issue:404' } } }, de), /job.scope/);
  assert.throws(() => preview('doc.pdf', { job: { ...job, window: { past: 0, next: 0 } } }, de), /job.window/);
  const pv = preview('doc.pdf', { job }, de);
  assert.equal(pv.totals.sections, 2);
  assert.ok(pv.totals.figures > 10);
  const io = fakeIo(de.ds);
  const done = await apply('doc.pdf', { job }, io, { ctx: de });
  assert.equal(done.open, 'jobDoc');
  assert.equal(io.docs[0].sections.length, 2);
  assert.deepEqual(cleanJob(job, de).people, ['u1', 'u2']);
});

// ---------------- the PDF layout (lib/jobPdf.js, pure – no jsPDF needed) ----------------
test('the PDF layout: cover with contents, overview, a page per colleague, the proof appendix, footers on every page', async () => {
  const { layoutJob, jobPageText, jobFileName } = await import('../static/cockpit/src/lib/jobPdf.js');
  for (const ctx of [de, en]) {
    const job = { ...cleanJob({ ...parseJob(OWNER_DE, ctx), people: ['u1', 'u2', 'u3'] }, ctx) };
    const doc = buildJobDoc(ctx, job);
    const lay = layoutJob(doc);
    const text = lay.pages.map(jobPageText);
    assert.ok(text[0].includes(doc.cover.title) && text[0].includes(ctx.lang === 'en' ? 'CONTENTS' : 'INHALT'), 'the cover');
    for (const s of doc.sections) {
      const at = lay.toc.find((e) => e.heading === s.heading);
      assert.ok(at && text[at.page - 1].includes(s.heading) && text[at.page - 1].includes(s.greeting), `${s.heading} starts its own page with the greeting`);
      assert.ok(text[0].includes(s.heading), 'listed in the contents');
    }
    const proofAt = lay.toc.at(-1).page;
    assert.ok(text.slice(proofAt - 1).join(' ').includes(doc.proof.at(-1).label.slice(0, 20)), 'the last proof row is printed');
    lay.pages.forEach((p, i) => assert.ok(jobPageText(p).includes(`${ctx.lang === 'en' ? 'Page' : 'Seite'} ${i + 1} / ${lay.pages.length}`), `footer on page ${i + 1}`));
    // nothing drawn outside the page
    for (const p of lay.pages) for (const o of p.ops) if (o.op === 'text') assert.ok(o.y > 0 && o.y < 297 && o.x >= 0 && o.x <= 210, `${o.text} at ${o.x}/${o.y}`);
    assert.match(jobFileName(doc), /\.pdf$/);
  }
});
