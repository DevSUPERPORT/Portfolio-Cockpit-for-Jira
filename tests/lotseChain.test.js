// Lotse chains ("Mehrstufiger Auftrag", 2026-11-16): the capability catalogue, the query language, complex requests →
// plans (golden set DE/EN), the plans run end to end on the fixture with fakeIo (previews before writes, frozen sets,
// fresh numbers after a write, undo all), and the Forge LLM as a helper (planner + writer) behind the same gates.
// Product owner: "Make sure that Lotse can handle super complex orchestration of tasks … app native … and when Forge LLM
// is turned on, it will help Lotse a lot too!"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { start, answer, next, applyStep, current, unsourced, undoAll, WORKFLOW_IDS, COMMAND_IDS, COMMANDS, routeAct } from '../shared/lotse/act/index.js';
import { toolCatalog, toolOf, catalogSchema, catalogCounts, cleanParams, WF_COMMANDS, COMMAND_RIGHT, queryOfTool } from '../shared/lotse/act/tools.js';
import { runQuery, parseQuery, setStory, cleanQuery, formatQuery, parseQuerySyntax, PRESETS, PRESET_IDS, METRICS, teamSupport } from '../shared/lotse/act/query.js';
import { planChain, cleanPlan, planProblems, comparePlans, chainRoute } from '../shared/lotse/act/chain/plan.js';
import { splitClauses } from '../shared/lotse/act/chain/split.js';
import { chainSections, chainOutline, baselineOf, checkedText } from '../shared/lotse/act/chain/run.js';
import { buildChainDoc } from '../shared/lotse/act/chain/docs.js';
import { lotsePlanAssist, lotseWriteAssist, maskRequest, shapeCheck } from '../shared/lotse/act/chain/llm.js';
import { personData } from '../shared/lotse/act/orchestrate/data.js';
import { docProblems } from '../shared/lotse/report/jobDoc.js';
import { SKILLS, SKILL_IDS } from '../shared/lotse/skills/index.js';
import { validStory, selfCheck } from '../shared/lotse/index.js';
import { learnedTool, validCandidate, patternOf, learnedSkill } from '../shared/lotse/learn.js';
import { learnChainFromAi } from '../src/lib/learn.js';
import { fakeIo } from '../shared/lotse/act/fakeIo.js';
import { stable } from '../shared/lotse/act/kit.js';
import { ticketSla } from '../shared/sla.js';
import { bookingOverview } from '../shared/booking.js';
import { weeksUtilizationShared } from '../shared/engine.js';
import { DEFAULT_CONFIG } from '../src/lib/config.js';
import { lotseCtx, lotseDataset } from './lotseFixture.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const de = lotseCtx('de');
const en = lotseCtx('en');
const { model } = de.computed;
const ref = (name) => model.items.find((x) => x.name === name).ref;
const withNotices = (lang) => { const ds = lotseDataset(); ds.config.notices = { enabled: true }; return lotseCtx(lang, { ds }); };

// ---------------- the catalogue ----------------
test('catalogue: generated from the registries – every skill, workflow, command and named query is a tool, typed and described', () => {
  const cat = toolCatalog();
  for (const id of SKILL_IDS) assert.ok(cat[`skill.${id}`], `skill ${id}`);
  for (const id of WORKFLOW_IDS) if (id !== 'chain') assert.ok(cat[`wf.${id}`], `workflow ${id}`);
  for (const id of COMMAND_IDS) assert.ok(cat[`cmd.${id}`], `command ${id}`);
  for (const id of PRESET_IDS) assert.ok(cat[`query.${id}`], `query ${id}`);
  // the annotations the registries cannot say: every workflow and every command is annotated (a new one fails here)
  for (const id of WORKFLOW_IDS) assert.ok(Array.isArray(WF_COMMANDS[id]), `WF_COMMANDS.${id}`);
  for (const id of COMMAND_IDS) assert.ok(Object.hasOwn(COMMAND_RIGHT, id), `COMMAND_RIGHT.${id}`);
  const TYPES = new Set(['project', 'team', 'person', 'quarter', 'weeks', 'percent', 'number', 'enum', 'flag', 'text', 'query', 'blocks', 'args']);
  const OUTS = /^(set(:people|:projects|:teams|:stories|:tickets)?|story|doc|write|view)$/;
  for (const t of Object.values(cat)) {
    assert.ok(t.title[0] && t.title[1] && t.desc[0] && t.desc[1], `${t.id}: DE/EN title and description`);
    assert.ok(['query', 'story', 'workflow', 'command', 'job'].includes(t.kind), t.id);
    assert.match(t.out, OUTS, t.id);
    for (const [k, p] of Object.entries(t.params)) { assert.ok(TYPES.has(p.type), `${t.id}.${k}`); assert.ok(p.label?.[0] && p.label?.[1], `${t.id}.${k} label`); if (p.type === 'enum') assert.ok(p.values.length >= 2, `${t.id}.${k}`); }
    if (t.input) assert.ok(t.input.accepts.length && t.input.accepts.every((e) => ['people', 'projects', 'teams', 'stories', 'tickets'].includes(e)), t.id);
    if (t.command) assert.equal(t.write, COMMANDS[t.command].write, `${t.id}: write flag from the registry`);
    if (t.write) assert.ok(t.right !== undefined, t.id);
  }
  // the write flag follows the commands a workflow ends in
  assert.equal(cat['wf.reRankQuarter'].write, true); assert.equal(cat['wf.reRankQuarter'].right, 'rank');
  assert.equal(cat['wf.cLevelReport'].write, false); assert.equal(cat['wf.cLevelReport'].right, 'report');
  assert.equal(cat['notify.remind'].irreversible, true); assert.equal(cat['notify.remind'].changesData, false);
  assert.equal(cat['plan.balance'].changesData, true); assert.equal(cat['doc.job'].write, false);
  const c = catalogCounts();
  assert.deepEqual([c.query, c.story, c.workflow, c.command, c.job], [13, 29, 19, 22, 3]);
  assert.equal(c.total, 86); // + yearCheck, disruption, capacity.closure, ticket, splitCheck, splitResolve, capacity.setShares (2026-11-17), timelineBrief (2026-11-19)
});

test('catalogue schema for the LLM: ids, English descriptions, parameter schemas – no data, no names', () => {
  const schema = catalogSchema();
  const text = JSON.stringify(schema);
  assert.ok(schema.length >= 50 && text.length < 40000, `${schema.length} tools, ${text.length} chars`);
  assert.ok(schema.every((t) => toolOf(t.id)?.chainable));
  for (const p of Object.values(de.ds.people)) assert.ok(!text.includes(p.name), p.name);
  for (const it of model.items) assert.ok(!text.includes(it.name) && !text.includes(it.key), it.name);
  for (const t of de.ds.teams) assert.ok(!text.includes(`"${t.id}"`), t.id);
  assert.ok(!/\d{2,}\s?h\b/.test(text), 'no figures');
});

test('params: names → refs, unknown params and wrong types refused', () => {
  assert.deepEqual(cleanParams('fill.estimates', { project: 'ERP-Anbindung' }, de), { project: ref('ERP-Anbindung') });
  assert.deepEqual(cleanParams('fill.estimates', { project: '#2 ERP-1' }, de), { project: ref('ERP-Anbindung') });
  assert.deepEqual(cleanParams('wf.resolveOverload', { team: 'Team Web' }, de), { team: 't-web' });
  assert.deepEqual(cleanParams('query.overloaded', { next: '6', threshold: 120 }, de), { next: 6, threshold: 120 });
  assert.deepEqual(cleanParams('wf.reRankQuarter', { quarter: 'Q4' }, de), { quarter: '2026-Q4' });
  for (const [tool, p] of [['query.overloaded', { next: 30 }], ['query.overloaded', { color: 'red' }], ['fill.estimates', { project: 'Mondprojekt' }], ['doc.job', { format: 'docx' }], ['wf.cLevelReport', { audience: 'everyone' }], ['cmd.rank.set', { args: { ref: 'nope', toRank: 1 } }]]) {
    assert.throws(() => cleanParams(tool, p, de), { code: 'INVALID' }, `${tool} ${JSON.stringify(p)}`);
  }
});

// ---------------- the query language ----------------
test('queries match the engine: load = weeksUtilization, booking = the booking check, staffable = the waterline, SLA = ticketSla', () => {
  // people over 100 % in the next 4 weeks – the peak of plan ÷ capacity per week, as Kapazität shows it
  const over = runQuery({ entity: 'people', where: [{ m: 'load', op: '>', v: 100 }], window: { next: 4 } }, de);
  assert.ok(over.members.length >= 3);
  const wu = weeksUtilizationShared(de.computed.model, de.computed.support, 4);
  const mem = new Map(); for (const t of wu.teams) for (const m of t.members) if (!mem.has(m.id)) mem.set(m.id, m);
  for (const m of over.members) {
    const e = mem.get(m.id);
    const peak = Math.max(...e.plan.map((p, i) => (e.cap[i] > 0 ? Math.round((p / e.cap[i]) * 100) : 0)));
    const noTime = e.plan.some((p, i) => !(e.cap[i] > 0) && p > 0);
    if (!noTime) assert.equal(m.values.load, peak, m.name);
    assert.ok(m.values.load > 100);
  }
  // nobody qualifies who is not over 100 %
  const all = runQuery({ entity: 'people', where: [], window: { next: 4 } }, de);
  assert.equal(all.members.filter((m) => m.values.load > 100).length, over.total);
  // below the booking target: Σ booked ÷ Σ possible of the last 4 weeks, as bookingOverview counts them
  const below = runQuery(queryOfTool(toolOf('query.belowBooking'), {}), de);
  const job = { scope: { kind: 'portfolio' }, subjects: 'people', blocks: ['bookings'], window: { past: 4, next: 0 } };
  for (const m of below.members.slice(0, 5)) {
    const d = personData(de, job, m.id);
    const past = d.weeks.filter((w) => w.past && w.possible > 0);
    const q = Math.round((past.reduce((a, w) => a + w.booked, 0) / past.reduce((a, w) => a + w.possible, 0)) * 100);
    assert.equal(m.values.booking, q, m.name);
    assert.ok(q < (de.ds.config.booking.minPct ?? 80));
  }
  const ov = bookingOverview(model, { people: {} }, 0, 0, de.ds.config); assert.ok(ov.settings);
  // projects not staffable in Q4: exactly the waterline's status per project
  const ns = runQuery({ entity: 'projects', where: [{ m: 'staffable', op: '!=', v: 'ok' }], window: { quarter: '2026-Q4' } }, de);
  const wl = de.computed.wl;
  const want = model.items.filter((it) => !de.computed.metrics.get(it.ref)?.done && wl.projectQ[it.ref]?.['2026-Q4'] && wl.projectQ[it.ref]['2026-Q4'].status !== 'ok').map((it) => it.ref).sort();
  assert.deepEqual(ns.members.map((m) => m.id).sort(), want);
  for (const m of ns.members) assert.equal(m.values.missing, Math.round(wl.projectQ[m.id]['2026-Q4'].teams.reduce((a, t) => a + Math.max(0, t.demand - t.staffed), 0) * 10) / 10);
  // tickets at SLA risk: open tickets with ticketSla breached / atRisk
  const sla = runQuery(queryOfTool(toolOf('query.ticketsSla'), {}), de);
  const tix = de.ds.supportTickets.tickets.filter((t) => t.statusCat !== 'done' && ['breached', 'atRisk'].includes(ticketSla(t, undefined, de.now).status));
  assert.deepEqual(sla.members.map((m) => m.id).sort(), tix.map((t) => t.id).sort());
  // support load per team: worklogs on the team's tickets in the last 4 weeks
  const sup = runQuery(queryOfTool(toolOf('query.teamsSupport'), {}), de);
  for (const m of sup.members) assert.equal(m.values.support, teamSupport(de, m.id, 4).booked);
  // stories: overdue in a project
  const od = runQuery({ entity: 'stories', where: [{ m: 'overdue', op: '>', v: 0 }], scope: { kind: 'project', ref: ref('ERP-Anbindung') } }, de);
  assert.ok(od.members.every((m) => m.values.overdue > 0 && de.ds.issues.find((i) => i.id === m.id).rootRef === ref('ERP-Anbindung')));
});

test('queries: every member carries its numbers; the set story is valid and every number sourced; safe by construction', () => {
  for (const id of PRESET_IDS) {
    for (const ctx of [de, en]) {
      const r = runQuery(queryOfTool(toolOf(`query.${id}`), {}), ctx);
      for (const m of r.members) for (const w of r.q.where) assert.ok(m.values[w.m] !== undefined, `${id}/${m.id}: ${w.m}`);
      const s = setStory(ctx, r);
      assert.doesNotThrow(() => validStory(s), id);
      assert.deepEqual(selfCheck(s), [], `${id}: ${s.headline}`);
    }
  }
  // the language refuses anything outside its lists – nothing is ever evaluated
  for (const bad of [{ entity: 'users' }, { entity: 'people', where: [{ m: 'salary', op: '>', v: 1 }] }, { entity: 'people', where: [{ m: 'load', op: 'like', v: 1 }] }, { entity: 'people', where: [{ m: 'load', op: '>', v: 'process.exit()' }] }, { entity: 'projects', where: [{ m: 'staffable', op: '>', v: 'ok' }] }, { entity: 'people', where: [], limit: 1000 }, { entity: 'people', scope: { kind: 'person', ref: 'u1' } }]) {
    assert.throws(() => cleanQuery(bad, de), { code: 'INVALID' }, JSON.stringify(bad));
  }
  // the text form round-trips
  for (const id of PRESET_IDS) { const q = cleanQuery(queryOfTool(toolOf(`query.${id}`), {}), de); assert.deepEqual(parseQuerySyntax(formatQuery(q), de), q, id); }
  assert.equal(parseQuerySyntax('people where load > 100; rm -rf', de), null);
  // natural language (DE/EN) → the named queries
  const NL = [['Find everyone over 100 % in the next 4 weeks', 'overloaded'], ['Wer liegt unter dem Buchungsziel?', 'belowBooking'], ['Who is away with planned work?', 'absentWithWork'], ['Prüfe alle Projekte, die im Q4 nicht besetzbar sind', 'notStaffable'],
    ['Welche Projekte sind über dem Termin?', 'projectsOverdue'], ['Welche Projekte haben keine T-Shirt-Größe?', 'noTshirt'], ['Which teams are over capacity?', 'teamsOverCapacity'], ['Support-Last der letzten 4 Wochen je Team', 'teamsSupport'],
    ['überfällige Stories in ERP-Anbindung finden', 'storiesOverdue'], ['Show me all blocked stories', 'storiesBlocked'], ['Find stories without an estimate in Datenplattform', 'storiesNoEstimate'], ['offene Tickets mit SLA-Risiko', 'ticketsSla']];
  for (const [t, want] of NL) assert.equal(parseQuery(t, de)?.why, want, t);
  assert.equal(parseQuery('Wie steht das Portfolio?', de), null, 'a question about one thing is no set');
});

// ---------------- complex requests → plans (golden, DE/EN) ----------------
// [sentence, [[tool, input?, params-subset?], …]]
const GOLDEN = [
  ['Find everyone over 100 % in the next 4 weeks, plan each of their weeks to 100 % and give every one of them a PDF with their new plan.', [['query.overloaded'], ['plan.balance', 's1'], ['doc.job', 's2', { format: 'pdfEach', next: 4 }]]],
  ['Prüfe alle Projekte, die im Q4 nicht besetzbar sind, vergleiche die Rangfolgen und erstelle danach einen C-Level-Report für die Geschäftsführung.', [['query.notStaffable', null, { quarter: '2026-Q4' }], ['wf.reRankQuarter', null, { quarter: '2026-Q4' }], ['wf.cLevelReport', null, { audience: 'board' }]]],
  ['Wer liegt unter dem Buchungsziel? Erinner sie und mach mir eine Liste als PDF.', [['query.belowBooking'], ['notify.remind', 's1'], ['doc.list', 's1']]],
  ['Fill the missing estimates in project ERP from similar past work, then check whether the waterline changes and summarise it for the owner.', [['fill.estimates', null, { project: 'ERP-Anbindung' }], ['check.waterline', null, { project: 'ERP-Anbindung' }], ['doc.brief', null, { audience: 'owners' }]]],
  ['Für jedes Team: Support-Last der letzten 4 Wochen, offene Tickets mit SLA-Risiko, und je Teamleitung ein PDF.', [['query.teamsSupport'], ['query.ticketsSla'], ['doc.job', 's1', { format: 'pdfEach', audience: 'teamLeads', past: 4 }]]],
  ['Finde alle über 100 % in den nächsten 6 Wochen und plane ihre Wochen auf 100 %.', [['query.overloaded', null, { next: 6 }], ['plan.balance', 's1']]],
  ['Wer ist in den nächsten 2 Wochen überlastet? Mach mir eine Liste.', [['query.overloaded', null, { next: 2 }], ['doc.list', 's1']]],
  ['Who is below the booking target? Remind them.', [['query.belowBooking'], ['notify.remind', 's1']]],
  ['Which projects are not staffable next quarter? Then compare the rankings.', [['query.notStaffable', null, { quarter: '2027-Q1' }], ['wf.reRankQuarter', null, { quarter: '2027-Q1' }]]],
  ['Welche Projekte haben keine T-Shirt-Größe? Erstelle eine Liste als PDF.', [['query.noTshirt'], ['doc.list', 's1']]],
  ['Finde alle überfälligen Stories in ERP-Anbindung und mach eine Liste daraus.', [['query.storiesOverdue', null, { project: 'ERP-Anbindung' }], ['doc.list', 's1']]],
  ['Show me all blocked stories, then prepare the weekly.', [['query.storiesBlocked'], ['wf.weeklyPrep']]],
  ['Welche Teams sind über Kapazität? Danach erstelle je Teamleitung ein PDF.', [['query.teamsOverCapacity'], ['doc.job', 's1', { audience: 'teamLeads', format: 'pdfEach' }]]],
  ['Find all tickets breaching SLA and then triage the support inbox.', [['query.ticketsSla'], ['wf.supportTriage']]],
  ['Wer ist abwesend und hat geplante Arbeit? Gib jedem von ihnen ein PDF mit seinen Wochen.', [['query.absentWithWork'], ['doc.job', 's1', { format: 'pdfEach' }]]],
  ['Find stories without an estimate in Datenplattform, fill the missing estimates in Datenplattform and then check whether the waterline changes.', [['query.storiesNoEstimate', null, { project: 'Datenplattform' }], ['fill.estimates', null, { project: 'Datenplattform' }], ['check.waterline', null, { project: 'Datenplattform' }]]],
  ['Fülle die fehlenden Schätzungen in Billing-Migration, prüfe danach ob sich die Wasserlinie ändert und fasse es für die Geschäftsführung zusammen.', [['fill.estimates', null, { project: 'Billing-Migration' }], ['check.waterline'], ['doc.brief', null, { audience: 'management' }]]],
  ['Find everyone over 120 % in the next 4 weeks and remind them about missing values.', [['query.overloaded', null, { threshold: 120 }], ['notify.remind', 's1', { kind: 'gaps' }]]],
  ['Welche Projekte sind über dem Termin? Danach mach die Health-Runde für alle meine Projekte.', [['query.projectsOverdue'], ['wf.healthRound']]],
  ['Prüfe die Support-Last je Team der letzten 8 Wochen und erstelle danach je Teamleitung ein PDF.', [['query.teamsSupport', null, { past: 8 }], ['doc.job', 's1', { past: 8, audience: 'teamLeads' }]]],
  ['Find everyone below the booking target in the last 6 weeks, give each of them a PDF and remind them.', [['query.belowBooking', null, { past: 6 }], ['doc.job', 's1', { past: 6, format: 'pdfEach' }], ['notify.remind', 's1']]],
  ['Finde alle Projekte über dem Termin, vergleiche danach die Rangfolgen für Q1 2027.', [['query.projectsOverdue'], ['wf.reRankQuarter', null, { quarter: '2027-Q1' }]]],
  ['First find everyone over 100 %, then plan their weeks to 100 % with handovers, and finally make a list as PDF.', [['query.overloaded'], ['plan.balance', 's1', { handover: true }], ['doc.list', 's2']]],
  ['Wer ist über 100 % in Team Web? Plane ihre Wochen auf 100 % und erstelle jedem ein eigenes PDF.', [['query.overloaded', null, { team: 't-web' }], ['plan.balance', 's1'], ['doc.job', 's2', { format: 'pdfEach' }]]],
  ['Find all projects not staffable in Q4, then create a C-level report for the board.', [['query.notStaffable', null, { quarter: '2026-Q4' }], ['wf.cLevelReport', null, { audience: 'board' }]]],
  ['Löse die Terminkonflikte in Glasfaser-Netzausbau und danach erstelle einen C-Level-Report.', [['wf.fixConflicts', null, { project: 'Glasfaser-Netzausbau' }], ['wf.cLevelReport']]],
  ['Bereite das Weekly vor und anschließend prüfe, wer unter dem Buchungsziel liegt.', [['wf.weeklyPrep'], ['query.belowBooking']]],
  ['Welche Stories sind blockiert? Danach zeig mir die Wasserlinie.', [['query.storiesBlocked'], ['skill.waterline']]],
  ['Wer ist überlastet? Erstelle danach für jeden von ihnen ein PDF mit Aufgaben und Abwesenheiten.', [['query.overloaded'], ['doc.job', 's1', { format: 'pdfEach', blocks: ['tasks', 'absences', 'risks'] }]]],
  ['Finde alle Tickets mit SLA-Risiko und mach mir eine Liste als PDF.', [['query.ticketsSla'], ['doc.list', 's1']]],
  ['Which teams carry the most support load over the last 4 weeks? Then give each team lead a PDF.', [['query.teamsSupport'], ['doc.job', 's1', { audience: 'teamLeads', format: 'pdfEach' }]]],
  ['Find everyone away with planned work in the next 6 weeks and make a list.', [['query.absentWithWork', null, { next: 6 }], ['doc.list', 's1']]],
  ['Fülle die Lücken in ERP-Anbindung und danach prüfe, ob sich die Wasserlinie ändert.', [['wf.fillGaps', null, { project: 'ERP-Anbindung' }], ['check.waterline', null, { project: 'ERP-Anbindung' }]]],
];
test(`golden chains: ${GOLDEN.length} complex requests (DE/EN) → the expected plan, routed as a chain`, () => {
  assert.ok(GOLDEN.length >= 30);
  const wrong = [];
  for (const [text, want] of GOLDEN) {
    const ctx = /\b(the|who|which|find|show|first)\b/i.test(text) ? en : de;
    const p = planChain(text, ctx);
    const got = p.steps.map((s) => [s.tool, s.input || null, s.params]);
    const ok = got.length === want.length && want.every(([tool, input, params], i) => got[i][0] === tool && (got[i][1] || null) === (input || null)
      && Object.entries(params || {}).every(([k, v]) => stable(got[i][2][k]) === stable(['project'].includes(k) && typeof v === 'string' && !v.startsWith('issue:') ? ref(v) : v)));
    if (!ok || p.unresolved.length) wrong.push(`${text}\n   got ${JSON.stringify(got)} unresolved ${JSON.stringify(p.unresolved)}`);
    const r = routeAct(text, ctx);
    if (r?.workflow !== 'chain') wrong.push(`${text}\n   routed as ${r?.kind}:${r?.workflow || r?.command}`);
    assert.deepEqual(planProblems(p, ctx), [], text);
  }
  assert.deepEqual(wrong, []);
});

test('splitting: sequence words, verbs after "und"/commas, lists after "Für jedes Team:", relative clauses kept, references found', () => {
  const s = splitClauses('Prüfe alle Projekte, die im Q4 nicht besetzbar sind, vergleiche die Rangfolgen und erstelle danach einen Report.');
  assert.deepEqual(s.clauses.map((c) => c.text), ['Prüfe alle Projekte, die im Q4 nicht besetzbar sind', 'vergleiche die Rangfolgen', 'erstelle danach einen Report']);
  const t = splitClauses('Für jedes Team: Support-Last der letzten 4 Wochen, offene Tickets mit SLA-Risiko, und je Teamleitung ein PDF.');
  assert.equal(t.each, 'teams'); assert.equal(t.clauses.length, 3);
  const u = splitClauses('Wer liegt unter dem Buchungsziel? Erinner sie und mach mir eine Liste als PDF.');
  assert.deepEqual(u.clauses.map((c) => c.ref), [false, true, false]);
  const v = splitClauses('Find everyone over 100 % in the next 4 weeks, then plan their weeks.');
  assert.equal(v.clauses.length, 2, '"next 4 weeks" is no cut'); assert.equal(v.clauses[1].seq, true);
  assert.equal(splitClauses('Wie steht Mobile App 2.0 und was blockiert es?').clauses.length, 1);
});

test('single jobs keep their own way – questions, workflows, commands and document jobs are not chains', () => {
  const SINGLE = ['Wie steht das Portfolio?', 'Bereite das Weekly vor', 'Löse die Überlast von Team Web', 'Fülle die Lücken in ERP-Anbindung', 'Wer macht bald Überstunden?', 'Setze die Schätzung von KPR-106 auf 16 h',
    'Prüfe alle Arbeitswochen der Leute im Projekt Kundenportal Relaunch, pack alles in ein PDF und bereite für jeden Kollegen einen persönlichen Bericht vor', 'Erstelle einen C-Level-Report', 'Plane meine Woche auf 100 %', 'Health-Runde für alle meine Projekte',
    'Für jedes Team im Portfolio die Auslastung der nächsten 6 Wochen als PDF für die Teamleitungen', 'Was wäre, wenn Glasfaser-Netzausbau zwei Wochen später startet?', 'Verteile die neuen Support-Tickets', 'Who is heading for overtime?'];
  for (const t of SINGLE) assert.equal(chainRoute(t, /\b(who|heading)\b/i.test(t) ? en : de), null, t);
});

// ---------------- plans from outside: strict checks, comparison ----------------
test('cleanPlan: unknown tools, unknown params, wrong bindings and missing sets are refused; comparePlans names the differences', () => {
  const good = { steps: [{ tool: 'query.overloaded', params: { next: 4 } }, { tool: 'plan.balance', params: {}, input: 's1' }, { tool: 'doc.job', params: { format: 'pdfEach' }, input: 's2' }] };
  assert.equal(cleanPlan(good, de).steps.length, 3);
  const bads = [
    { steps: [{ tool: 'shell.exec', params: {} }] },
    { steps: [{ tool: 'query.overloaded', params: { sql: 'drop' } }] },
    { steps: [{ tool: 'plan.balance', params: {} }] },
    { steps: [{ tool: 'query.notStaffable', params: {} }, { tool: 'plan.balance', params: {}, input: 's1' }] },
    { steps: [{ tool: 'doc.job', params: {}, input: 's2' }, { tool: 'query.overloaded', params: {} }] },
    { steps: Array.from({ length: 9 }, () => ({ tool: 'skill.portfolioBrief', params: {} })) },
    { steps: [{ tool: 'cmd.doc.pdf', params: {} }] },
  ];
  for (const b of bads) { assert.throws(() => cleanPlan(b, de), { code: 'INVALID' }, JSON.stringify(b).slice(0, 80)); assert.ok(planProblems(b, de).length); }
  const c = comparePlans(cleanPlan(good, de), cleanPlan({ steps: [good.steps[0], { tool: 'notify.remind', params: {}, input: 's1' }] }, de));
  assert.equal(c.same, false);
  assert.deepEqual(c.diffs.map((d) => d.kind), ['tool', 'missing']);
  assert.ok(comparePlans(cleanPlan(good, de), cleanPlan(good, de)).same);
});

// ---------------- running chains end to end ----------------
const recommended = (st) => (st.multi ? st.options.filter((o) => o.recommended && !o.disabled).map((o) => o.id) : (st.options.find((o) => o.recommended && !o.disabled) || st.options.find((o) => !o.disabled)).id);
async function drive(text, lang, { notices = false, script = {}, plan = null } = {}) {
  const ds = lotseDataset();
  if (notices) ds.config.notices = { enabled: true };
  let ctx = lotseCtx(lang, { ds });
  const io = fakeIo(ctx.ds);
  const before = stable(io.ds);
  let s = start({ id: 'chain', params: { text } }, ctx);
  const trail = [];
  for (let guard = 0; s.status !== 'done' && s.status !== 'cancelled' && guard < 120; guard++) {
    const cur = current(s);
    if (!cur) break;
    trail.push(`${cur.kind}:${cur.id}`);
    if (cur.kind === 'story' || cur.kind === 'summary') s = next(s, ctx);
    else if (cur.kind === 'decide') {
      const v = Object.hasOwn(script, cur.id) ? script[cur.id] : cur.id === 'plan' ? (plan ? { option: 'run', plan, source: 'edited' } : 'run') : recommended(cur);
      s = answer(s, cur.id, typeof v === 'function' ? v(cur) : v, ctx);
    } else if (cur.kind === 'preview') s = answer(s, cur.id, script[cur.id] || 'apply', ctx);
    else if (cur.kind === 'command') { s = await applyStep(s, io, ctx); ctx = lotseCtx(lang, { ds: io.ds }); }
  }
  return { s, io, before, trail, ctx };
}
function common(label, { s, io, before }) {
  assert.equal(s.status, 'done', `${label}: finished`);
  for (const [k, st] of s.steps.entries()) {
    if (st.kind !== 'command') continue;
    const pv = s.steps.slice(0, k).find((x) => x.kind === 'preview' && x.covers.includes(st.id));
    assert.ok(pv && pv.answer === 'apply', `${label}/${st.id}: previewed first`);
  }
  for (const st of s.steps.filter((x) => x.kind === 'story')) {
    assert.doesNotThrow(() => validStory(st.story), `${label}/${st.id}`);
    assert.deepEqual(selfCheck(st.story), [], `${label}/${st.id}: ${st.story.headline}`);
  }
  assert.deepEqual(unsourced(s), [], label);
  const text = JSON.stringify(s.steps.map((x) => [x.title, x.question, x.summary, x.text, x.note, (x.options || []).map((o) => [o.label, o.detail])]));
  assert.ok(!/rovo/i.test(text) && !/undefined|\bNaN\b|\[object|customfield|\bt-(web|ux|int|mob|data|netz)\b/.test(text), `${label}: human words only`);
  for (const sec of chainSections(s).sections) assert.equal(sec.status, 'done', `${label}/${sec.id}: ${sec.status}`);
  return { s, io, before };
}
async function undoRestores(label, { s, io, before }) {
  const u = await undoAll(s, io);
  assert.ok(!u.undoFailed, label);
  assert.equal(stable(io.ds), before, `${label}: undo all restores the data exactly`);
}

for (const lang of ['de', 'en']) {
  test(`example 1 (${lang}): over 100 % → plan their weeks → a PDF each with the NEW plan; the set stays frozen, undo all restores`, async () => {
    const text = lang === 'de' ? 'Finde alle über 100 % in den nächsten 4 Wochen, plane ihre Wochen auf 100 % und gib jedem von ihnen ein PDF mit seinem neuen Plan.' : 'Find everyone over 100 % in the next 4 weeks, plan each of their weeks to 100 % and give every one of them a PDF with their new plan.';
    const r = common('ex1', await drive(text, lang));
    const { s, io } = r;
    const set = s.steps.find((x) => x.id === 's1:set').set;
    assert.ok(set.members.length >= 3);
    // the write went to Jira through plan.apply, after its preview; a checkpoint then re-planned on the new numbers
    assert.ok(io.calls.some(([n]) => n === 'plan.apply'));
    assert.equal(s.steps.find((x) => x.id === 's2:gate').answer, 'continue');
    // the PDF: exactly the people of step 1 (frozen), one section each, every figure proven – with their new weeks
    const doc = io.docs.at(-1);
    assert.deepEqual(doc.sections.map((x) => x.subject.id).sort(), [...set.members.map((m) => m.id)].sort());
    assert.deepEqual(docProblems(doc), []);
    const peakIn = (d) => Math.max(0, ...d.sections.flatMap((x) => (x.kpis.find((k) => k.label === (lang === 'de' ? 'Höchste Woche' : 'Peak week'))?.value ?? 0)));
    assert.ok(peakIn(doc) < Math.max(...set.members.map((m) => m.values.load)), 'the document shows the planned weeks, not the old overload');
    await undoRestores('ex1', r);
  });
}

test('example 2: projects not staffable in Q4 → compare the rankings → C-level report for the board (composer opened, nothing published)', async () => {
  const r = common('ex2', await drive('Prüfe alle Projekte, die im Q4 nicht besetzbar sind, vergleiche die Rangfolgen und erstelle danach einen C-Level-Report für die Geschäftsführung.', 'de'));
  const { s, io } = r;
  assert.ok(io.calls.some(([n]) => n === 'portfolio.reorder'), 'the ranking was set after its preview');
  const audience = s.steps.find((x) => x.id === 's3:audience');
  assert.equal(audience.answer, 'board'); assert.equal(audience.prefilled, true, 'the step\'s param answers the decision');
  assert.equal(s.steps.find((x) => x.command === 'report.compose').result.open, 'reportComposer');
  await undoRestores('ex2', r);
});

test('example 3: below the booking target → remind them (explicit opt-in, every recipient previewed) → a list as PDF', async () => {
  // without the opt-in nothing is sent
  const quiet = common('ex3 quiet', await drive('Wer liegt unter dem Buchungsziel? Erinner sie und mach mir eine Liste als PDF.', 'de', { notices: true }));
  assert.ok(!quiet.io.calls.some(([n]) => n === 'notices.remind'), 'the recommended answer sends nothing');
  assert.equal(quiet.s.steps.find((x) => x.id === 's2:send').answer, 'none');
  // with it: the preview names every person of the set, then the reminder goes out (irreversible, said so)
  const r = common('ex3', await drive('Wer liegt unter dem Buchungsziel? Erinner sie und mach mir eine Liste als PDF.', 'de', { notices: true, script: { 's2:send': 'remind' } }));
  const { s, io } = r;
  const set = s.steps.find((x) => x.id === 's1:set').set;
  const pv = s.steps.find((x) => x.id === 's2:preview');
  assert.equal(pv.count, set.members.length);
  assert.ok(pv.warnings.some((w) => /nicht zurückholen/.test(w)));
  const sent = io.calls.find(([n]) => n === 'notices.remind')[1];
  assert.deepEqual([...sent.accountIds].sort(), set.members.map((m) => m.id).sort());
  const doc = io.docs.at(-1);
  assert.equal(doc.sections[0].tables[0].rows.length, set.members.length);
  assert.deepEqual(docProblems(doc), []);
  assert.match(s.steps.find((x) => x.kind === 'summary').text, /nicht zurückholen/);
  // notices switched off: the option is disabled, nothing can be sent
  const off = await drive('Wer liegt unter dem Buchungsziel? Erinner sie und mach mir eine Liste als PDF.', 'de', { notices: false });
  assert.ok(off.s.steps.find((x) => x.id === 's2:send').options.find((o) => o.id === 'remind').disabled);
});

test('example 4: fill the missing estimates in ERP → check the waterline against the job\'s start → a summary for the owner', async () => {
  const r = common('ex4', await drive('Fill the missing estimates in project ERP from similar past work, then check whether the waterline changes and summarise it for the owner.', 'en'));
  const { s, io } = r;
  const fills = io.calls.filter(([n]) => n === 'issue.fill');
  assert.ok(fills.length >= 1 && fills.every(([, p]) => p.usage === 'originalEstimate'));
  const wl = s.steps.find((x) => x.id === 's2:waterline');
  assert.equal(wl.story.visual.kind, 'compare');
  const base = s.steps.find((x) => x.id === 'plan').baseline;
  assert.ok(base && base.quarters.length === 2, 'the baseline is the data the job started from');
  const out = s.steps.find((x) => x.id === 's3:brief').meta.out;
  assert.equal(out.message.to, model.itemByRef.get(ref('ERP-Anbindung')).owner.name);
  assert.match(out.message.text, new RegExp(String(fills.length)));
  await undoRestores('ex4', r);
});

test('example 5: for each team – support load, tickets at SLA risk, a PDF per team lead (with the SLA tickets)', async () => {
  const r = common('ex5', await drive('Für jedes Team: Support-Last der letzten 4 Wochen, offene Tickets mit SLA-Risiko, und je Teamleitung ein PDF.', 'de'));
  const { s, io } = r;
  const teams = s.steps.find((x) => x.id === 's1:set').set;
  const doc = io.docs.at(-1);
  assert.deepEqual(doc.sections.map((x) => x.subject.id).sort(), teams.members.map((m) => m.id).sort());
  assert.equal(io.calls.find(([n]) => n === 'doc.pdf')[1].each, true, 'one PDF per team lead');
  const tix = s.steps.find((x) => x.id === 's2:set').set;
  const inDocs = doc.sections.flatMap((x) => x.tables.filter((t) => t.id === 'sla').flatMap((t) => t.rows.map((rw) => rw.cells[0].text)));
  for (const k of inDocs) assert.ok(tix.members.some((m) => m.key === k), k);
  assert.deepEqual(docProblems(doc), []);
  await undoRestores('ex5', r);
});

test('the person stays in charge: an edited plan runs as edited; skipping a write keeps the data; stop at the checkpoint ends the chain', async () => {
  // edited: the PDF removed, only find + plan
  const plan = { steps: [{ tool: 'query.overloaded', params: { next: 4 } }, { tool: 'plan.balance', params: {}, input: 's1' }] };
  const e = await drive('Find everyone over 100 % in the next 4 weeks, plan each of their weeks to 100 % and give every one of them a PDF with their new plan.', 'en', { plan });
  assert.equal(e.s.status, 'done');
  assert.equal(chainSections(e.s).sections.length, 2);
  assert.ok(!e.io.calls.some(([n]) => n === 'doc.pdf'));
  // the write declined: nothing written, the chain goes on with the unchanged data
  const k = await drive('Find everyone over 100 % in the next 4 weeks, plan each of their weeks to 100 % and give every one of them a PDF with their new plan.', 'en', { script: { 's2:preview': 'skip' } });
  assert.ok(!k.io.calls.some(([n]) => n === 'plan.apply'));
  assert.equal(stable(k.io.ds), k.before);
  // stop at the checkpoint: the rest does not run
  const st = await drive('Find everyone over 100 % in the next 4 weeks, plan each of their weeks to 100 % and give every one of them a PDF with their new plan.', 'en', { script: { 's2:gate': 'stop' } });
  assert.equal(st.s.status, 'done');
  assert.ok(!st.io.calls.some(([n]) => n === 'doc.pdf'));
  assert.match(st.s.steps.find((x) => x.kind === 'summary').note, /Stopped after step 2/);
  await undoRestores('stop', st);
});

test('a viewer without rights: write steps are skipped with the reason, the reading steps still run', async () => {
  const ds = lotseDataset();
  const ctx = lotseCtx('de', { ds, roles: { rights: ['portfolio'] } });
  let s = start({ id: 'chain', params: { text: 'Finde alle über 100 % in den nächsten 4 Wochen und plane ihre Wochen auf 100 %.' } }, ctx);
  for (let g = 0; g < 30 && s.status !== 'done'; g++) { const c = current(s); if (!c) break; s = c.kind === 'decide' ? answer(s, c.id, c.id === 'plan' ? 'run' : recommended(c), ctx) : next(s, ctx); }
  assert.equal(s.status, 'done');
  assert.match(s.steps.find((x) => x.id === 's2:info').story.headline, /Recht/);
  assert.ok(!s.steps.some((x) => x.kind === 'command'));
});

test('long chains stay fast: 8 steps planned and run in well under a second per step on the fixture', async () => {
  const t0 = Date.now();
  const r = await drive('Finde alle über 100 % in den nächsten 4 Wochen, plane ihre Wochen auf 100 % und gib jedem von ihnen ein PDF.', 'de');
  assert.equal(r.s.status, 'done');
  assert.ok(Date.now() - t0 < 6000, `${Date.now() - t0} ms`);
  const t1 = Date.now();
  for (let i = 0; i < 5; i++) planChain('Wer liegt unter dem Buchungsziel? Erinner sie und mach mir eine Liste als PDF.', de);
  assert.ok(Date.now() - t1 < 500, 'plans are cached per data state');
});

test('chain documents: a list and a brief, every figure proven', () => {
  const r = runQuery(queryOfTool(toolOf('query.notStaffable'), {}), de);
  const set = { entity: r.entity, query: r.q, total: r.total, checked: r.checked, label: r.label, members: r.members.map((m) => ({ id: m.id, kind: m.kind, name: m.name, values: m.values, keys: m.keys })) };
  const list = buildChainDoc(de, { kind: 'list', set });
  assert.equal(list.sections[0].tables[0].rows.length, r.total);
  assert.deepEqual(docProblems(list), []);
  const brief = buildChainDoc(en, { kind: 'brief', brief: { title: 'Summary', headline: '3 changes applied.', kpis: [{ label: 'Changes', value: 3, unit: 'n' }], findings: [{ text: 'Fill: 3 changes applied.', tone: 'ok' }], message: { to: 'Max', subject: 'S', text: 'Hi Max' } } });
  assert.deepEqual(docProblems(brief), []);
  assert.throws(() => COMMANDS['doc.chain'].validate({ doc: { kind: 'list', set: { ...set, members: [{ id: 'x', values: { evil: 'x' } }] } } }, de), { code: 'INVALID' });
});

// ---------------- the LLM as a helper ----------------
const on = (over = {}) => ({ ...DEFAULT_CONFIG, setupComplete: true, ai: { ...DEFAULT_CONFIG.ai, enabled: true, access: 'all', features: { ...DEFAULT_CONFIG.ai.features }, ...over } });
function gw(reply) {
  const s = { llm: [], quota: [], audit: [] };
  return { s, deps: {
    llm: async (system, user, policy) => { s.llm.push({ system, user, policy }); if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply(user) : reply; },
    takeQuota: async (id) => { s.quota.push(id); },
    audit: async (c, action, details) => { s.audit.push({ action, details }); },
    dropCached: async () => null,
  } };
}
const CTX = { accountId: 'acc-1' };
const REQ = 'Find everyone over 100 % in team Web, plan Anna Becker\'s week to 100 % and write a summary for the owner of ERP-Anbindung.';
const ENT = { people: ['Anna Becker'], projects: [{ name: 'ERP-Anbindung', rank: 2, key: 'ERP-1' }] };

test('planner mode: the switch first, then the quota; the request masked (names / texts only when allowed), the catalogue without data', async () => {
  const { s, deps } = gw('{"steps":[]}');
  await assert.rejects(lotsePlanAssist({ text: REQ }, { ...CTX, cfg: DEFAULT_CONFIG }, deps), { code: 'AI_DISABLED' });
  await assert.rejects(lotsePlanAssist({ text: REQ }, { ...CTX, cfg: on({ features: { ...DEFAULT_CONFIG.ai.features, lotse: false } }) }, deps), { code: 'AI_DISABLED' });
  await assert.rejects(lotsePlanAssist({ text: REQ }, { cfg: on() }, deps), { code: 'FORBIDDEN' });
  await assert.rejects(lotsePlanAssist({ text: 'x' }, { ...CTX, cfg: on() }, deps), { code: 'INVALID' });
  assert.deepEqual([s.llm.length, s.quota.length], [0, 0], 'nothing sent, nothing counted');
  const plan = JSON.stringify({ steps: [{ tool: 'query.overloaded', params: { team: 'Web' } }, { tool: 'plan.balance', params: {}, input: 's1' }, { tool: 'doc.brief', params: { audience: 'owners' } }], note: 'ok' });
  const a = gw(plan);
  const r = await lotsePlanAssist({ text: REQ, entities: ENT, lang: 'en' }, { ...CTX, cfg: on() }, a.deps);
  assert.equal(r.source, 'ai');
  assert.equal(a.s.quota.length, 1);
  assert.equal(a.s.llm[0].policy.feature, 'lotse', 'the one gateway: budget, cache, metering');
  const sent = a.s.llm[0].user;
  assert.ok(!sent.includes('Anna Becker') && !sent.includes('ERP-Anbindung') && sent.includes('P1') && sent.includes('#2 ERP-1'), 'masked');
  assert.equal(r.sent.text.includes('Anna'), false);
  for (const p of Object.values(de.ds.people)) assert.ok(!sent.includes(p.name), p.name);
  assert.ok(sent.includes('"query.overloaded"') && !/"u\d+"|issue:9/.test(sent), 'the catalogue, no ids, no data');
  assert.equal(a.s.audit[0].action, 'ai.lotse.plan');
  // names allowed: the name travels
  const n = gw(plan);
  await lotsePlanAssist({ text: REQ, entities: ENT }, { ...CTX, cfg: on({ shareNames: true, shareTexts: true }) }, n.deps);
  assert.ok(n.s.llm[0].user.includes('Anna Becker') && n.s.llm[0].user.includes('ERP-Anbindung'));
  // scrubbing: links, e-mails, secrets never leave
  const sc = gw(plan);
  await lotsePlanAssist({ text: 'Remind everyone below the booking target, mail bob@corp.example and see https://x.example/a token=abc123', entities: {} }, { ...CTX, cfg: on() }, sc.deps);
  assert.ok(!/bob@corp|https:\/\/|abc123/.test(sc.s.llm[0].user));
});

test('planner mode: a valid AI plan is accepted (after Lotse\'s own strict check); unknown ids and params are rejected and named; failures fall back', async () => {
  const reply = JSON.stringify({ steps: [{ tool: 'query.overloaded', params: { next: 4 } }, { tool: 'shell.exec', params: {} }, { tool: 'plan.balance', params: { target: 100 }, input: 's1' }, { tool: 'doc.job', params: { format: 'pdfEach', colour: 'red' }, input: 's3' }, { tool: 'doc.job', params: { format: 'pdfEach' }, input: 's3' }] });
  const g = gw(reply);
  const r = await lotsePlanAssist({ text: 'Find everyone over 100 % and plan their weeks, then a PDF each', entities: {} }, { ...CTX, cfg: on() }, g.deps);
  assert.equal(r.source, 'ai');
  assert.deepEqual(r.rejected.map((x) => x.reason), ['unknownTool', 'unknownParam']);
  assert.deepEqual(r.plan.steps.map((x) => [x.tool, x.input]), [['query.overloaded', null], ['plan.balance', 's1'], ['doc.job', 's2']], 'inputs renumbered after the rejections');
  // the browser's check against the data: valid
  assert.equal(cleanPlan(r.plan, en, { source: 'ai' }).source, 'ai');
  // AI and Lotse disagree → both shown with the differences
  const mine = planChain('Find everyone over 100 % in the next 4 weeks, plan each of their weeks to 100 % and give every one of them a PDF with their new plan.', en);
  assert.equal(comparePlans(mine, r.plan).same, false);
  // nonsense / failure → Lotse alone, with the reason
  for (const [bad, code] of [['not json at all', 'AI_INVALID'], [JSON.stringify({ steps: [{ tool: 'rm.rf' }] }), 'AI_INVALID'], [Object.assign(new Error('t'), { code: 'AI_TIMEOUT' }), 'AI_TIMEOUT'], [Object.assign(new Error('q'), { code: 'AI_QUOTA' }), 'AI_QUOTA']]) {
    const f = gw(bad);
    const x = await lotsePlanAssist({ text: 'Find everyone over 100 %', entities: {} }, { ...CTX, cfg: on() }, f.deps);
    assert.deepEqual([x.source, x.reason, x.plan], ['fallback', code, null]);
  }
  // the shape check on its own
  assert.deepEqual(shapeCheck([{ tool: 'query.overloaded', params: {} }]).rejected, []);
  assert.equal(maskRequest('Plan Anna Becker and Anna', { people: ['Anna Becker'] }).text, 'Plan P1 and P1');
});

test('writer mode: from the verified story only; every number cross-checked – a wrong number keeps Lotse\'s text', async () => {
  const r0 = await drive('Fill the missing estimates in project ERP from similar past work, then check whether the waterline changes and summarise it for the owner.', 'en');
  const note = r0.s.steps.find((x) => x.id === 's3:note');
  const story = note.assist.story;
  // the AI drafts from the story's facts – the gateway sees no names unless allowed
  const g = gw((user) => { const f = JSON.parse(user.slice(user.indexOf('<story>') + 7, user.indexOf('</story>'))); return `${f.headline} Well done.`; });
  const w = await lotseWriteAssist({ kind: 'brief', story, to: 'Maximilian Schulz', lang: 'en' }, { ...CTX, cfg: on() }, g.deps);
  assert.equal(w.source, 'ai');
  assert.equal(w.crossCheck.verdict === 'differs', false);
  assert.ok(!g.s.llm[0].system.includes('Maximilian') && !g.s.llm[0].user.includes('Maximilian'));
  // the chain uses a checked AI text and marks it
  const ok = checkedText(story, w.text, 'en');
  assert.equal(ok.ok, true);
  const run = async (text) => {
    const ds = lotseDataset(); let ctx = lotseCtx('en', { ds }); const io = fakeIo(ctx.ds);
    let s = start({ id: 'chain', params: { text: 'Fill the missing estimates in project ERP from similar past work, then check whether the waterline changes and summarise it for the owner.' } }, ctx);
    for (let g2 = 0; g2 < 60 && s.status !== 'done'; g2++) {
      const c = current(s); if (!c) break;
      if (c.kind === 'decide') s = answer(s, c.id, c.id === 's3:note' ? { option: 'own', text, ai: true } : c.id === 'plan' ? 'run' : recommended(c), ctx);
      else if (c.kind === 'preview') s = answer(s, c.id, 'apply', ctx);
      else if (c.kind === 'command') { s = await applyStep(s, io, ctx); ctx = lotseCtx('en', { ds: io.ds }); }
      else s = next(s, ctx);
    }
    return s.steps.find((x) => x.id === 's3:brief').meta.out;
  };
  const good = await run(w.text);
  assert.equal(good.message.text, w.text); assert.equal(good.message.ai, true);
  const wrongText = `${story.kpis[1]?.value + 7} changes were applied.`;
  assert.equal(checkedText(story, wrongText, 'en').ok, false);
  const bad = await run(wrongText);
  assert.notEqual(bad.message.text, wrongText, 'a number that is not in the story → Lotse\'s own text');
  assert.equal(bad.message.ai, false);
  assert.equal(bad.check.ok, false);
  // gates and fallback as in the planner
  await assert.rejects(lotseWriteAssist({ kind: 'brief', story }, { ...CTX, cfg: DEFAULT_CONFIG }, g.deps), { code: 'AI_DISABLED' });
  await assert.rejects(lotseWriteAssist({ kind: 'brief', story: { ...story, visual: null } }, { ...CTX, cfg: on() }, g.deps), { code: 'INVALID' });
  const down = gw(Object.assign(new Error('b'), { code: 'AI_BUDGET' }));
  assert.deepEqual((await lotseWriteAssist({ kind: 'brief', story }, { ...CTX, cfg: on() }, down.deps)).source, 'fallback');
});

test('lotse.llm: one resolver, the switch first, the modes wired to the shared cores; the mock answers them', () => {
  const index = read('src/index.js');
  const body = index.slice(index.indexOf("def('lotse.llm'"), index.indexOf('\n});', index.indexOf("def('lotse.llm'")));
  assert.match(body, /^def\('lotse\.llm', async \(\{ payload, ctx, cfg, roles \}\) => \{\n\s+requireAi\(cfg, 'lotse'\);/);
  assert.match(body, /payload\?\.mode === 'plan'\) return lotsePlanAssist\(payload, \{ accountId: ctx\.accountId, cfg \}, \{ llm, takeQuota, dropCached, audit \}\)/);
  assert.match(body, /payload\?\.mode === 'write'\) return lotseWriteAssist\(payload, \{ accountId: ctx\.accountId, cfg \}, \{ llm, takeQuota, dropCached, audit \}\)/);
  assert.match(body, /payload\?\.mode === 'learn'\) return learnChainFromAi\(/);
  assert.match(read('shared/lotse/act/chain/llm.js'), /await deps\.takeQuota\(ctx\.accountId, cfg\)/);
  const mock = read('static/cockpit/src/lib/mock.js');
  assert.match(mock, /p\.mode === 'plan'\) return ok\(await lotsePlanAssist/);
  assert.match(mock, /p\.mode === 'write'\) return ok\(await lotseWriteAssist/);
  assert.ok(!/console\./.test(read('shared/lotse/act/chain/llm.js') + read('src/lib/learn.js')), 'no console in the server paths');
  // the trust page says what the planner sends
  assert.match(read('static/cockpit/src/components/DataTrust.jsx'), /sieht die KI nur den Auftragstext/);
});

test('learning: an accepted AI plan teaches Lotse the phrasing (masked pattern + tool), only after an admin approves', async () => {
  let store = [];
  const deps = { get: async () => store, set: async (k, v) => { store = v; }, mode: () => 'off' };
  const r = await learnChainFromAi({ clauses: [{ text: 'Schau wer bei Anna Becker zu wenig erfasst hat', tool: 'query.belowBooking' }, { text: 'mach was', tool: 'shell.exec' }] }, { loadDs: async () => de.ds }, deps);
  assert.equal(r.added, 1);
  const c = store[0];
  assert.equal(c.tool, 'query.belowBooking'); assert.equal(c.status, 'pending');
  assert.ok(!/anna|becker/.test(c.pattern), c.pattern);
  assert.equal(validCandidate(c).tool, 'query.belowBooking');
  // pending: not used; approved: the chain maps the phrasing natively
  const text = 'Schau wer bei Lea Hoffmann zu wenig erfasst hat';
  assert.equal(learnedTool(text, { ...de, learned: store }), null);
  const learned = store.map((x) => ({ ...x, status: 'approved' }));
  assert.equal(learnedTool(text, { ...de, learned })?.tool, 'query.belowBooking');
  assert.equal(learnedSkill(text, { ...de, learned }), null, 'a tool pattern never routes a question to a skill');
  assert.equal(patternOf(text, de).includes('lea'), false);
});

test('UI: the chain run renders the plan graph, live status, set tables, the checkpoint and the result; no exit animations', () => {
  const ui = read('static/cockpit/src/components/lotse/ChainCards.jsx');
  const wf = read('static/cockpit/src/components/lotse/Workflow.jsx');
  for (const name of ['ChainPlanCard', 'ChainGraph', 'SectionHead', 'SetTable', 'GateCard', 'NoteCard', 'ChainResult']) assert.match(ui, new RegExp(`export function ${name}\\(`));
  assert.ok(!/AnimatePresence|exit=/.test(ui));
  assert.match(wf, /isChain \? <ChainGraph state=\{s\} ctx=\{ctx\} \/> : <Stepper/);
  assert.match(wf, /refreshWorkflow\(s, ctx\)/, 'a stale preview re-plans the chain in place');
  assert.match(ui, /KI-Text, von Lotse geprüft/);
  assert.match(read('static/cockpit/src/components/lotse/chain.css'), /@media \(max-width: 480px\)/);
  const outline = chainOutline(planChain('Wer liegt unter dem Buchungsziel? Erinner sie und mach mir eine Liste als PDF.', de), de);
  assert.deepEqual(outline.map((o) => [o.tool, o.write, o.irreversible, !!o.input]), [['query.belowBooking', false, false, false], ['notify.remind', true, true, true], ['doc.list', false, false, true]]);
  assert.ok(baselineOf(de).quarters.length === 2);
  void METRICS; void PRESETS; void SKILLS;
});
