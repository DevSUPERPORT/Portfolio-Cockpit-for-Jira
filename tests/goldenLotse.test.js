// Lotse golden set (tests/golden/questions.js): ≥ 250 real-world questions in German and English by persona, scored for
// routing, parameters and key facts against expectations computed independently from the dataset (tests/golden/expect.js).
// The thresholds are the measured values of 2026-11-12 minus a small margin – they guard against regressions; raise them
// when Lotse gets better (the report below prints the current numbers).
// Known bugs found by the golden set are `todo` tests: they fail (reported, not counted) until fixed – then drop `todo`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotseCtx } from './lotseFixture.js';
import { runGolden, goldenReport } from './golden/evaluate.js';
import { ask, understand, remember } from '../shared/lotse/index.js';
import { goldenEnv } from './golden/expect.js';
import { runJobs } from './golden/evaluate.js';
import { goldenJobs } from './golden/questions.js';

// measured 2026-11-12 on tests/lotseFixture.js, before the routing fixes: routing 90.7 %, params 99.6 %, facts 92.1 %, unknown 1.4 %;
// after them (team words win, "ich" + bookings → my week, staffing / late / hours-short phrasings, deictic what-if,
// portfolioBrief per team): routing 100 %, params 100 %, facts 100 % (646/646), unknown 0 %. MARGIN = the 0.5 points below.
const BASE = { routing: 1, params: 1, facts: 1, factsRouted: 1, unknownMax: 0, followup: 1, typo: 1, whatif: 1 };
const MARGIN = 0.005;

const de = lotseCtx('de');
const res = runGolden(de);
const m = res.metrics;

test(`golden set: ${m.n} questions, routing / parameters / facts / unknown rate`, () => {
  console.log(goldenReport(res));
  assert.ok(m.n >= 250, `at least 250 golden questions (${m.n})`);
  assert.ok(m.de >= 100 && m.en >= 100, `both languages covered (${m.de} DE / ${m.en} EN)`);
  for (const p of ['management', 'projectLead', 'teamLead', 'employee', 'support']) assert.ok(m.byPersona[p]?.n >= 10, `persona ${p} has ≥ 10 questions`);
  assert.ok(m.routing >= BASE.routing - MARGIN, `routing accuracy ${m.routing}`);
  assert.ok(m.params >= BASE.params - MARGIN, `parameter accuracy ${m.params}`);
  assert.ok(m.facts.accuracy >= BASE.facts - MARGIN, `fact accuracy ${m.facts.accuracy}`);
  assert.ok(m.facts.routedAccuracy >= BASE.factsRouted - MARGIN, `fact accuracy on correctly routed questions ${m.facts.routedAccuracy}`);
  assert.ok(m.unknownRate <= BASE.unknownMax + MARGIN, `unknown rate ${m.unknownRate}`);
  assert.ok(m.tags.followup.routing >= BASE.followup - MARGIN, 'follow-ups');
  assert.ok(m.tags.typo.routing >= BASE.typo - MARGIN, 'typos');
  assert.ok(m.tags.whatif.routing >= BASE.whatif - MARGIN, 'what-ifs');
});

test('golden set: the expectations are independent and consistent with the engine', () => {
  const E = goldenEnv(de);
  // the recomputed waterline (expect.js) equals the engine's cells – so a fact miss is Lotse's, not the expectation's
  for (const t of E.teams) for (const q of [E.q0, E.q1]) {
    const cell = E.c.wl.cells[t.id]?.[q];
    if (!cell) continue;
    const x = E.team(t.id, q);
    assert.ok(Math.abs(x.demand - cell.demand) < 1e-6 && Math.abs(x.capacity - cell.capacity) < 1e-6, `${t.id} ${q}`);
    assert.equal(x.firstRank, cell.waterRank, `${t.id} ${q} first rank`);
  }
});

// the 10 jobs of tests/golden/JOBS.md, said as a task → the matching Lotse workflow (measured 2026-11-12: 80 % of 30; with
// "verteile die neuen Tickets" and "wer hat zu wenig gebucht?" routed: 91.7 % of 36, params 100 %)
test('golden jobs: task sentences start the right workflow', () => {
  const j = runJobs(de, understand, goldenJobs);
  console.log(`Lotse jobs → workflows: ${j.rows.length} sentences, routing ${(j.routing * 100).toFixed(1)} %, params ${(j.params * 100).toFixed(1)} %`);
  for (const x of j.rows.filter((r) => !r.ok || !r.paramsOk)) console.log(`  [${x.id}] ${x.q}  expected ${x.workflow} got ${x.got}`);
  assert.equal(j.rows.length, 36);
  assert.ok(j.routing >= 0.917 - MARGIN, `job routing ${j.routing}`);
  assert.ok(j.params >= 1 - MARGIN, `job params ${j.params}`);
});

// ---------------- bugs found by the golden set (fixed 2026-11-12; kept as regression tests) ----------------
test('BUG golden-1: "Lagebild Team Mobile" is a team briefing, not the project "Mobile App 2.0"', () => {
  for (const q of ['Lagebild Team Mobile', 'Wie geht es Team Mobile?', 'How is team Mobile doing?', 'Mobile team briefing']) {
    const u = understand(q, de, {});
    assert.equal(u.skill, 'teamBrief', q);
    assert.equal(u.params.team, 't-mob', q);
  }
  // the project's full name still means the project
  assert.equal(understand('Lagebild Mobile App 2.0', de, {}).skill, 'projectBrief');
  // "how many hours is team X short" → the team (capacity minus demand), never the project sharing a word
  for (const q of ['Wie viele Stunden fehlen Team Mobile in Q4?', 'How many hours is team Mobile short in Q4?']) assert.deepEqual([understand(q, de, {}).skill, understand(q, de, {}).params.team], ['teamBrief', 't-mob'], q);
});

test('BUG golden-2: an off-topic request with "mir" is not "my week"', () => {
  for (const q of ['Erzähl mir einen Witz', 'Bestell mir eine Pizza', 'Tell me a joke']) {
    assert.equal(understand(q, de, {}).skill, null, q);
    assert.equal(ask(q, de, {}).skill, 'help', `${q} → the help story`);
  }
  // "mir" / "ich" with my own week still is my week
  for (const q of ['Fehlen mir noch Buchungen?', 'Wie viele Stunden habe ich diese Woche gebucht?', 'How many hours have I booked this week?', 'Meine Woche']) assert.equal(understand(q, de, {}).skill, 'myWeek', q);
});

test('BUG golden-3: "what if the project moves to rank 1" after a project briefing moves THAT project', () => {
  const ref = de.computed.model.items.find((x) => x.name === 'Glasfaser-Netzausbau').ref;
  const mem = remember(ask('Lagebild Glasfaser-Netzausbau', de));
  assert.deepEqual(understand('Was wäre wenn das Projekt auf Rang 1 rückt?', de, mem).params.change, { kind: 'rank', ref, toRank: 1 });
});

test('BUG golden-4: portfolio briefing and waterline agree on the first bottleneck rank and the hours missing at the named teams', () => {
  const E = goldenEnv(de);
  const w = E.waterlineQ(E.q0); // teams only: first rank 5, 1.197 h on the fixture
  const p = ask('Lagebild Portfolio', de), wl = ask('Ab welchem Rang reicht die Kapazität nicht?', de);
  const f = p.findings.find((x) => /nicht voll besetzbar/.test(x.text));
  assert.ok(f, 'the portfolio briefing has the waterline finding');
  const named = /fehlen ([\d.,]+) h bei/.exec(f.text);
  assert.ok(named, f.text);
  assert.equal(Math.round(+named[1].replace(/\./g, '').replace(',', '.')), Math.round(w.missing), `hours missing at the named teams: ${f.text}`);
  assert.equal(wl.kpis.find((k) => k.id === 'firstRank').value, w.firstRank);
  assert.match(f.text, new RegExp(`ab Rang ${w.firstRank}\\b`), 'same first bottleneck rank as the waterline answer');
  // work without a team is said separately, with its own (sourced) hours
  const none = E.waterlineQ(E.q0, { withNone: true }).cells.find((x) => x.teamId === '_none');
  if (none?.demand > 0.5) {
    const m = /Dazu kommen ([\d.,]+) h Arbeit ohne Team/.exec(f.text);
    assert.ok(m, `the hours without a team are named: ${f.text}`);
    assert.equal(Math.round(+m[1].replace(/\./g, '').replace(',', '.')), Math.round(none.demand));
    assert.ok(f.evidence.some((x) => x.unit === 'h' && Math.abs(x.value - none.demand) <= 0.5), 'the hours without a team are in the evidence');
  }
});

// coordinator 2026-11-12: the dispatch instruction and the team booking question start their workflow for people who may
// act, and stay a story for viewers; questions about dispatch stay the dispatch story
test('jobs: support triage and booking check – workflow when allowed, story for viewers', () => {
  const viewer = { ...de, roles: { rights: ['portfolio'] } };
  for (const [q, wf, story] of [['Verteile die neuen Support-Tickets', 'supportTriage', 'dispatchAdvice'], ['Distribute the new support tickets', 'supportTriage', 'dispatchAdvice'],
    ['Wer hat zu wenig gebucht?', 'bookingCheck', 'planActualExplain'], ['Who booked too little?', 'bookingCheck', 'planActualExplain']]) {
    const u = understand(q, de, {});
    assert.deepEqual([u.kind, u.workflow], ['workflow', wf], q);
    assert.equal(understand(q, viewer, {}).skill, story, `${q} (viewer)`);
  }
  for (const q of ['Wer soll die neuen Tickets bekommen?', 'Dispatch the incoming support tickets', 'Wie verteile ich die Tickets?']) assert.equal(understand(q, de, {}).skill, 'dispatchAdvice', q);
  assert.equal(understand('Habe ich genug gebucht?', de, {}).skill, 'myWeek');
});
