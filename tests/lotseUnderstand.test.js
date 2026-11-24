// Lotse understands: DE/EN phrasings, typos, entities (project, team, person, quarter, key) and follow-ups resolved
// against the last story – "und für Team Web?", "and the next quarter?", "warum?", "was wäre wenn …".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { understand, remember, ask } from '../shared/lotse/index.js';
import { lotseCtx } from './lotseFixture.js';

const de = lotseCtx('de');
const en = { ...de, lang: 'en' };
const { model } = de.computed;
const ref = (name) => model.items.find((x) => x.name === name).ref;
const U = (q, mem = {}, ctx = de) => understand(q, ctx, mem);

// [question, skill, expected params (subset)]
const TABLE = [
  ['Wie steht es um Glasfaser-Netzausbau?', 'projectBrief', { ref: ref('Glasfaser-Netzausbau') }],
  ['Lagebild ERP-Anbindung', 'projectBrief', { ref: ref('ERP-Anbindung') }],
  ['How is Kundenportal Relaunch doing?', 'projectBrief', { ref: ref('Kundenportal Relaunch') }],
  ['Was ist bei DSGVO-Löschkonzept los?', 'projectBrief', { ref: ref('DSGVO-Löschkonzept') }],
  ['Wie geht es Team Data?', 'teamBrief', { team: 't-data' }],
  ['How is team Web doing?', 'teamBrief', { team: 't-web' }],
  ['Wie steht mein Team da?', 'teamBrief', { mine: true }],
  ['Lagebild Portfolio', 'portfolioBrief', {}],
  ['Give me the big picture for the board', 'portfolioBrief', {}],
  ['Executive summary of all projects', 'portfolioBrief', {}],
  ['Meine Woche', 'myWeek', {}],
  ['Habe ich genug gebucht?', 'myWeek', {}],
  ['What should I work on this week? My tasks', 'myWeek', {}],
  ['Planungsvorschläge für Team UX', 'planningAdvice', { team: 't-ux' }],
  ['How should I plan better for team Mobile?', 'planningAdvice', { team: 't-mob' }],
  ['Wo fehlen Daten?', 'gapsFix', {}],
  ['Which estimates are missing in CRM-Konsolidierung?', 'gapsFix', { ref: ref('CRM-Konsolidierung') }],
  ['Wer soll die neuen Tickets bekommen?', 'dispatchAdvice', {}],
  ['Dispatch the incoming support tickets', 'dispatchAdvice', {}],
  ['Plan vs. Ist', 'planActualExplain', {}],
  ['Where did our hours go?', 'planActualExplain', {}],
  ['Health-Entwurf für Kundenportal Relaunch', 'healthDraft', { ref: ref('Kundenportal Relaunch') }],
  ['Draft a status update for ERP-Anbindung', 'healthDraft', { ref: ref('ERP-Anbindung') }],
  ['Welche Support-Themen kommen immer wieder?', 'supportTopics', {}],
  ['Which tickets keep coming back? We need playbooks', 'supportTopics', { playbook: true }],
  ['Schätze wie früher: Export der Rechnungen als PDF', 'estimate', { text: 'Export der Rechnungen als PDF' }],
  ['How long will "Login mit SSO" take?', 'estimate', { text: 'Login mit SSO' }],
  ['Wer macht bald Überstunden?', 'overtime', {}],
  ['Who is working too much in team UX?', 'overtime', { team: 't-ux' }],
  ['Wie viel Kapazität bleibt nach Support?', 'realCapacity', {}],
  ['Realistic capacity of team Integration', 'realCapacity', { team: 't-int' }],
  ['Was passt ohne Überstunden?', 'fits', {}],
  ['Can we make it without overtime?', 'fits', {}],
  ['Ab welchem Rang reicht die Kapazität nicht?', 'waterline', {}],
  ['Wasserlinie Q1 2027', 'waterline', { quarter: '2027-Q1' }],
  ['What is blocked in CRM-Konsolidierung?', 'blockers', { ref: ref('CRM-Konsolidierung') }],
  ['Was blockiert meine Aufgaben?', 'blockers', { mine: true }],
  ['Vergleiche Team Web mit Team Data', 'compare', { teams: ['t-web', 't-data'] }],
  ['Compare Kundenportal Relaunch with ERP-Anbindung', 'compare', { refs: [ref('Kundenportal Relaunch'), ref('ERP-Anbindung')] }],
  ['Was ist heute wichtig?', 'today', {}],
  ['Good morning – what should I focus on?', 'today', {}],
  // typos
  ['Ab welchem Rang reicht die Kapazitat nicht?', 'waterline', {}],
  ['Wer macht bald Uberstunden?', 'overtime', {}],
  ['Wasserlinei bitte', 'waterline', {}],
  ['Was ist blokiert?', 'blockers', {}],
  ['realistsche kapazität', 'realCapacity', {}],
  // the guard and the unknown
  ['Wer ist am faulsten im Team?', 'guard', {}],
  ['Rank the employees by productivity', 'guard', {}],
  ['xyzzy plugh', null, {}],
];

test(`routing table: ${TABLE.length} phrasings in German and English, typos included`, () => {
  assert.ok(TABLE.length >= 40);
  const wrong = [];
  for (const [q, skill, params] of TABLE) {
    const u = U(q, {}, /[äöüß]|\b(wie|was|wer|meine|habe|wo|lagebild|planungsvorschl|schätze|vergleiche|wasserlinie|realistsche)\b/i.test(q) ? de : en);
    const ok = u.skill === skill && Object.entries(params).every(([k, v]) => JSON.stringify(u.params[k]) === JSON.stringify(v));
    if (!ok) wrong.push(`${q} → ${u.skill} ${JSON.stringify(u.params)}`);
    if (skill) assert.ok(['high', 'medium'].includes(u.confidence), `${q}: confidence ${u.confidence}`);
  }
  assert.deepEqual(wrong, []);
});

test('follow-ups: "und für Team Web?", "and the next quarter?", "warum?", another project', () => {
  const s1 = ask('Lagebild Team UX', de);
  assert.equal(s1.skill, 'teamBrief');
  const m1 = remember(s1);
  assert.deepEqual(U('und für Team Web?', m1), { skill: 'teamBrief', params: { team: 't-web' }, confidence: 'high', alternatives: [] });
  assert.equal(U('and for team Data?', m1, en).params.team, 't-data');
  const nq = U('und im nächsten Quartal?', m1);
  assert.equal(nq.skill, 'waterline');
  assert.deepEqual(nq.params, { team: 't-ux', quarter: de.computed.wl.quarters[1] });
  assert.equal(U('and the next quarter?', remember(ask('Ab welchem Rang reicht die Kapazität nicht?', de)), en).params.quarter, de.computed.wl.quarters[1]);
  const why = U('warum?', m1);
  assert.deepEqual(why, { skill: 'why', params: { skill: 'teamBrief', params: { team: 't-ux' } }, confidence: 'high', alternatives: [] });
  assert.equal(U('Why?', m1, en).skill, 'why');
  // "warum?" keeps the conversation on the explained story
  const w = ask('warum?', de, m1);
  assert.equal(w.skill, 'why');
  assert.equal(remember(w).last.skill, 'teamBrief');
  // a project after a project briefing; a team after a project briefing
  const mp = remember(ask('Lagebild ERP-Anbindung', de));
  assert.deepEqual(U('und Billing-Migration?', mp).params, { ref: ref('Billing-Migration') });
  assert.equal(U('und Team Netz?', mp).skill, 'teamBrief');
  // a full new question is not mistaken for a follow-up
  assert.equal(U('Vergleiche Team Web mit Team Data', mp).skill, 'compare');
  // "warum?" without anything before: honest, low confidence
  assert.equal(U('warum?').confidence, 'low');
});

test('what if: rank, person hours, team hours, due date – resolved with the last story', () => {
  const n = model.items.length;
  assert.deepEqual(U('Was wäre wenn wir Rang 5 nach hinten schieben?').params.change, { kind: 'rank', ref: model.items.find((x) => x.rank === 5).ref, toRank: n });
  assert.deepEqual(U('What if rank 3 moves to the top?', {}, en).params.change, { kind: 'rank', ref: model.items.find((x) => x.rank === 3).ref, toRank: 1 });
  assert.deepEqual(U('Was wäre wenn Rang 6 auf Rang 2 rückt?').params.change, { kind: 'rank', ref: model.items.find((x) => x.rank === 6).ref, toRank: 2 });
  assert.deepEqual(U('Was wäre wenn Anna 10 h mehr arbeitet?').params.change, { kind: 'hours', personId: 'u1', delta: 10 });
  assert.deepEqual(U('What if Jonas works 8 hours less?', {}, en).params.change, { kind: 'hours', personId: 'u2', delta: -8 });
  assert.deepEqual(U('Was wäre wenn Team Web 40 h mehr hätte?').params.change, { kind: 'teamHours', teamId: 't-web', weekly: 40 });
  const mp = remember(ask('Lagebild ERP-Anbindung', de));
  assert.deepEqual(U('was wäre wenn due +2 Wochen', mp).params.change, { kind: 'due', ref: ref('ERP-Anbindung'), weeks: 2 });
  assert.deepEqual(U('what if Billing-Migration finishes 3 weeks earlier?', {}, en).params.change, { kind: 'due', ref: ref('Billing-Migration'), weeks: -3 });
  // the target rank, wherever it is written
  const gf = ref('Glasfaser-Netzausbau');
  assert.deepEqual(U('Was wäre wenn Glasfaser-Netzausbau auf Rang 2?').params.change, { kind: 'rank', ref: gf, toRank: 2 });
  assert.deepEqual(U('What if Glasfaser-Netzausbau moves to rank 2?', {}, en).params.change, { kind: 'rank', ref: gf, toRank: 2 });
  assert.deepEqual(U('Was wäre wenn Glasfaser-Netzausbau nach vorne rückt?').params.change, { kind: 'rank', ref: gf, toRank: 1 });
  assert.deepEqual(U('What if Glasfaser-Netzausbau goes to the end?', {}, en).params.change, { kind: 'rank', ref: gf, toRank: n });
  assert.deepEqual(U('Was wäre wenn Rang 2 nach hinten rückt?').params.change, { kind: 'rank', ref: model.items.find((x) => x.rank === 2).ref, toRank: n });
  assert.deepEqual(U('what if rank 7 goes to rank 1', {}, en).params.change, { kind: 'rank', ref: model.items.find((x) => x.rank === 7).ref, toRank: 1 });
  const moved = ask('Was wäre wenn Glasfaser-Netzausbau auf Rang 2?', de);
  assert.match(moved.headline, /von Rang 6 auf Rang 2/);
  assert.equal(moved.actions.find((a) => a.kind === 'rank').payload.toRank, 2);
  // nothing to change → the skill explains what it can do
  const none = U('Was wäre wenn?');
  assert.equal(none.skill, 'whatIf');
  assert.equal(none.confidence, 'low');
  // the parsed scenario runs
  const s = ask('Was wäre wenn wir Rang 5 nach hinten schieben?', de);
  assert.equal(s.skill, 'whatIf');
  assert.equal(s.visual.kind, 'compare');
});

test('alternatives: the next best skills with their parameters', () => {
  const u = U('Überstunden und Kapazität von Team UX');
  assert.ok(u.alternatives.length >= 1);
  for (const a of u.alternatives) { assert.ok(a.skill && a.label); assert.notEqual(a.skill, u.skill); }
});

test('live finding: a first "why" question that names a project or team answers that subject, a bare "why?" explains the last story', async () => {
  const { lotseCtx } = await import('./lotseFixture.js');
  const { understand } = await import('../shared/lotse/index.js');
  const ctx = lotseCtx('de');
  assert.equal(understand('Why is Datenplattform late?', ctx, {}).skill, 'projectBrief');
  assert.equal(understand('Warum ist das Kundenportal Relaunch spät?', ctx, {}).skill, 'projectBrief');
  assert.equal(understand('why is team Web overloaded?', ctx, {}).skill, 'overtime');
  assert.equal(understand('warum?', ctx, { last: { skill: 'teamBrief', params: { team: 't-ux' } } }).skill, 'why');
});
