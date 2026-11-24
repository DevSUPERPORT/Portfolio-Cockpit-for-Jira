// Lotse acts – plain-language commands and routing: ≥ 30 DE/EN phrasings to the right command, filter and value;
// missing or ambiguous parts become a decide (never a guessed write); jobs route to workflows; questions and what-ifs
// stay questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBulk, resolveDecide, preview, routeAct } from '../shared/lotse/act/index.js';
import { understand, ask, lotse, validStory } from '../shared/lotse/index.js';
import { lotseCtx } from './lotseFixture.js';

const de = lotseCtx('de');
const en = { ...de, lang: 'en' };
const { model } = de.computed;
const ref = (name) => model.items.find((x) => x.name === name).ref;
const isDe = (q) => /[äöüß]|\b(setze|gib|verschiebe|buche|reserviere|erinnere|entferne|weise|öffne|arbeitet|ist|für|alle|aller)\b/i.test(q);
const P = (q) => parseBulk(q, isDe(q) ? de : en);
const sub = (a, b) => Object.entries(b).every(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? a?.[k] && sub(a[k], v) : JSON.stringify(a?.[k]) === JSON.stringify(v)));

// [phrase, command | 'decide:<reason>' | null, expected params (subset)]
const TABLE = [
  ['Gib allen Stories ohne Team in Glasfaser Nord das Team Netz', 'issue.bulkFill', { field: 'team', value: 't-netz', filter: { project: ref('Glasfaser-Netzausbau'), missing: 'team', level: 'story' } }],
  ['set the estimate of all KPR stories without estimate to 8 h', 'issue.bulkFill', { field: 'estimate', value: 8, filter: { project: ref('Kundenportal Relaunch'), missing: 'estimate' } }],
  ['verschiebe alles von Anna in KW 48 eine Woche später', 'plan.move', { filter: { assignee: 'u1', week: '2026-W48' }, weeks: 1 }],
  ['setze Health aller meiner Projekte auf im Plan mit Kommentar Läuft nach Plan, keine Risiken.', 'health.set', { items: [{ ref: ref('Kundenportal Relaunch'), status: 'onTrack', comment: 'Läuft nach Plan, keine Risiken' }] }],
  ['Setze die Schätzung von KPR-118 auf 16 h', 'issue.setField', { issue: 'KPR-118', field: 'estimate', value: 16 }],
  ['set the team of KPR-118 to Web', 'issue.setField', { issue: 'KPR-118', field: 'team', value: 't-web' }],
  ['Weise alle Stories ohne Bearbeiter in ERP-Anbindung Jonas zu', 'issue.bulkFill', { field: 'assignee', value: 'u2', filter: { project: ref('ERP-Anbindung'), assignee: '_none' } }],
  ['assign all unassigned stories in ERP-Anbindung to Jonas', 'issue.bulkFill', { field: 'assignee', value: 'u2', filter: { project: ref('ERP-Anbindung'), assignee: '_none' } }],
  ['setze das Due Date aller Stories von Team Web ohne Due Date auf 15.12.', 'issue.bulkFill', { field: 'due', value: '2026-12-15', filter: { team: 't-web', missing: 'due' } }],
  ['T-Shirt M für alle Workstreams ohne Größe in Datenplattform', 'issue.bulkFill', { field: 'tshirt', value: 'M', filter: { level: 'workstream', project: ref('Datenplattform'), missing: 'tshirt' } }],
  ['Zielquartal Q1 2027 für alle Workstreams ohne Ziel-Quartale in Billing-Migration setzen', 'issue.bulkFill', { field: 'quarters', value: ['2027-Q1'], filter: { level: 'workstream', project: ref('Billing-Migration'), missing: 'quarters' } }],
  ['Setze Datenplattform auf Rang 1', 'rank.set', { ref: ref('Datenplattform'), toRank: 1 }],
  ['move ERP-Anbindung to the top of the ranking', 'rank.set', { ref: ref('ERP-Anbindung'), toRank: 1 }],
  ['verschiebe KPR-118 um 2 Wochen nach hinten', 'plan.move', { moves: [{ issue: 'KPR-118', weeks: 2 }] }],
  ['move all of Jonas Weber stories in week 48 two weeks later', 'plan.move', { filter: { assignee: 'u2', week: '2026-W48' }, weeks: 2 }],
  ['verschiebe meine Stories in KW 49 eine Woche früher', 'plan.move', { filter: { assignee: 'me', week: '2026-W49' }, weeks: -1 }],
  ['buche 2 h auf KPR-118 heute', 'booking.book', { items: [{ issue: 'KPR-118', date: '2026-11-12', hours: 2 }] }],
  ['book 1.5 h on ERP-137 yesterday', 'booking.book', { items: [{ issue: 'ERP-137', date: '2026-11-11', hours: 1.5 }] }],
  ['reserviere 12 h Support für Team Web', 'support.reserve', { teamId: 't-web', hours: 12 }],
  ['set the support reserve of team UX to automatic', 'support.reserve', { teamId: 't-ux', hours: null }],
  ['Jonas arbeitet ab jetzt 32 h pro Woche', 'capacity.setHours', { person: 'u2', weeklyHours: 32 }],
  ['Lea ist vom 01.12. bis 05.12. im Urlaub', 'capacity.setHours', { person: 'u3', absence: { from: '2026-12-01', to: '2026-12-05', type: 'vacation' } }],
  ['erinnere Team Web an die Buchungen', 'notice.remind', { kind: 'booking' }],
  ['remind Jonas about the missing values', 'notice.remind', { kind: 'gaps', people: ['u2'] }],
  ['KPR-118 blockiert ERP-137', 'deps.link', { pre: 'KPR-118', dep: 'ERP-137' }],
  ['link ERP-137 is blocked by KPR-118', 'deps.link', { pre: 'KPR-118', dep: 'ERP-137' }],
  ['entferne die Abhängigkeit zwischen KPR-118 und ERP-137', 'deps.unlink', { pre: 'KPR-118', dep: 'ERP-137' }],
  ['weise SUP-401 Team Web zu', 'dispatch.assign', { items: [{ ticket: 'SUP-401', teamId: 't-web' }] }],
  ['assign SUP-402 to team Integration and Jonas', 'dispatch.assign', { items: [{ ticket: 'SUP-402', teamId: 't-int', accountId: 'u2' }] }],
  ['öffne die Wochenplanung', 'navigate', { view: 'plan' }],
  ['open Datenplattform', 'navigate', { view: 'project', opts: { ref: ref('Datenplattform') } }],
  ['Setze Health von ERP-Anbindung auf gefährdet mit Kommentar Schnittstelle verspätet', 'health.set', { items: [{ ref: ref('ERP-Anbindung'), status: 'atRisk', comment: 'Schnittstelle verspätet' }] }],
  // missing or ambiguous → decide, never a guessed write
  ['setze die Schätzung auf 8 h', 'decide:noScope', {}],
  ['verschiebe alles eine Woche', 'decide:noScope', {}],
  ['setze Health auf kritisch', 'decide:noScope', {}],
  ['Setze die Schätzung aller Stories ohne Schätzung in Kundenportal Relaunch', 'decide:noValue', {}],
  ['verschiebe alles von Anna in KW 48', 'decide:noDirection', {}],
  ['set the health of ERP-Anbindung to critical', 'decide:noValue', {}],
  ['reserviere Support für Team Web', 'decide:noValue', {}],
  // not commands
  ['Wie steht es um Glasfaser-Netzausbau?', null, {}],
  ['Was wäre wenn wir Rang 5 nach hinten schieben?', null, {}],
  ['Draft a status update for ERP-Anbindung', null, {}],
  ['Estimate like before: push notifications for the app', null, {}],
  ['Meine Woche', null, {}],
];

test(`parseBulk: ${TABLE.length} DE/EN phrasings – command, filter and value; ambiguous → decide; questions → nothing`, () => {
  assert.ok(TABLE.filter(([, c]) => c).length >= 30);
  const wrong = [];
  for (const [q, want, params] of TABLE) {
    const r = P(q);
    const got = !r ? null : r.kind === 'decide' ? `decide:${r.reason}` : r.command;
    if (got !== want || (r?.kind === 'command' && !sub(r.params, params))) wrong.push(`${q} → ${got} ${JSON.stringify(r?.params || r?.options?.map((o) => o.id) || null)}`);
  }
  assert.deepEqual(wrong, []);
});

test('every parsed command previews against the data (valid params), and a decide never carries a write of its own', () => {
  for (const [q, want] of TABLE) {
    const r = P(q);
    if (r?.kind === 'command') {
      const pv = preview(r.command, r.params, isDe(q) ? de : en);
      assert.ok(typeof pv.summary === 'string' && pv.summary.length > 0, q);
      assert.ok(r.describe && !/undefined|null/.test(r.describe), `${q}: ${r.describe}`);
    }
    if (r?.kind === 'decide') {
      assert.ok(r.question && Array.isArray(r.options), q);
      assert.ok(r.options.length || r.freeText, `${q}: options or free text`);
      for (const o of r.options) { assert.ok(o.id && o.label && o.value, `${q}: ${o.id}`); if (o.value.command) assert.doesNotThrow(() => preview(o.value.command, o.value.params, de), `${q}: ${o.id}`); }
    }
    void want;
  }
});

test('resolveDecide: an option or the free text becomes the command, parsed by its kind', () => {
  const d1 = P('setze die Schätzung auf 8 h');
  const first = d1.options[0];
  assert.deepEqual(resolveDecide(d1, first.id, de), first.value);
  assert.equal(first.value.params.value, 8);
  const d2 = P('Setze die Schätzung aller Stories ohne Schätzung in Kundenportal Relaunch');
  const r2 = resolveDecide(d2, { text: '12,5 h' }, de);
  assert.equal(r2.command, 'issue.bulkFill');
  assert.equal(r2.params.value, 12.5);
  assert.ok(preview(r2.command, r2.params, de).count > 0);
  const d3 = P('set the health of ERP-Anbindung to critical');
  const r3 = resolveDecide(d3, { text: 'Interface partner is three weeks late' }, en);
  assert.deepEqual(r3.params.items, [{ ref: ref('ERP-Anbindung'), status: 'critical', comment: 'Interface partner is three weeks late' }]);
  const d4 = P('verschiebe alles von Anna in KW 48');
  assert.equal(resolveDecide(d4, 'earlier', de).params.weeks, -1);
  assert.equal(resolveDecide(d4, 'nope', de), null);
  assert.equal(resolveDecide(d2, { text: 'viel' }, de), null, 'free text that is not hours is refused');
});

test('an ambiguous first name asks who is meant', () => {
  const d = structuredClone(de.ds);
  d.people.u17 = { id: 'u17', name: 'Anna Schmidt', avatar: null };
  const ctx = lotseCtx('de', { ds: d });
  const r = parseBulk('verschiebe alles von Anna in KW 48 eine Woche später', ctx);
  assert.equal(r.kind, 'decide');
  assert.equal(r.reason, 'ambiguousPerson');
  assert.deepEqual(r.options.map((o) => o.id).sort(), ['u1', 'u17']);
  assert.equal(r.options.find((o) => o.id === 'u17').value.params.filter.assignee, 'u17');
});

test('understand(): jobs route to workflows, commands to commands, overlaps to a decide – questions are untouched', () => {
  const W = [
    ['Bereite das Weekly vor', 'weeklyPrep', {}],
    ['Bereite das Weekly für Team UX vor', 'weeklyPrep', { team: 't-ux' }],
    ['prepare the weekly planning', 'weeklyPrep', {}],
    ['Löse die Überlast von Team Web', 'resolveOverload', { team: 't-web' }],
    ['resolve the overload of team Data', 'resolveOverload', { team: 't-data' }],
    ['Fülle die Lücken in ERP-Anbindung', 'fillGaps', { ref: ref('ERP-Anbindung') }],
    ['fill the gaps of team Mobile', 'fillGaps', { team: 't-mob' }],
    ['Prüfe meine Buchungen', 'bookingCheck', {}],
    ['check my bookings for this week', 'bookingCheck', {}],
    ['Starte die Health-Runde', 'healthRound', {}],
    ['update the health of all my projects', 'healthRound', {}],
    ['Triage the support inbox', 'supportTriage', {}],
    ['Arbeite den Support-Eingang ab', 'supportTriage', {}],
    ['Setze das Projekt Datenplattform auf', 'onboardProject', { ref: ref('Datenplattform') }],
    ['onboard project CRM-Konsolidierung', 'onboardProject', { ref: ref('CRM-Konsolidierung') }],
    ['Löse die Terminkonflikte in Mobile App 2.0', 'fixConflicts', { ref: ref('Mobile App 2.0') }],
    ['fix the dependency conflicts', 'fixConflicts', {}],
    ['Erstelle den C-Level-Report', 'cLevelReport', {}],
    ['prepare the board report', 'cLevelReport', {}],
    ['Rangfolge fürs nächste Quartal neu setzen', 'reRankQuarter', { quarter: de.computed.wl.quarters[1] }],
    ['re-rank the portfolio for Q1 2027', 'reRankQuarter', { quarter: '2027-Q1' }],
  ];
  const wrong = [];
  for (const [q, wf, params] of W) {
    const u = understand(q, isDe(q) ? de : en, {});
    if (u.kind !== 'workflow' || u.workflow !== wf || !sub(u.params, params)) wrong.push(`${q} → ${u.kind}:${u.workflow || u.command || u.skill} ${JSON.stringify(u.params)}`);
  }
  assert.deepEqual(wrong, []);
  const c = understand('Gib allen Stories ohne Team in Glasfaser Nord das Team Netz', de, {});
  assert.equal(c.kind, 'command');
  assert.equal(c.command, 'issue.bulkFill');
  // both a job and a single command fit → ask which one
  const amb = routeAct('Fülle die Lücken: setze die Schätzung von KPR-118 auf 16 h', de);
  assert.equal(amb.kind, 'decide');
  assert.deepEqual(amb.options.map((o) => o.id), ['workflow:fillGaps', 'command:issue.setField']);
  // questions, follow-ups and scenarios keep their skills and their exact shape (no `kind`)
  for (const [q, skill] of [['Wo fehlen Daten?', 'gapsFix'], ['Wer soll die neuen Tickets bekommen?', 'dispatchAdvice'], ['Dispatch the incoming support tickets', 'dispatchAdvice'], ['Draft a status update for ERP-Anbindung', 'healthDraft'], ['Was wäre wenn wir Rang 5 nach hinten schieben?', 'whatIf'], ['Give me the big picture for the board', 'portfolioBrief'], ['Planungsvorschläge für Team UX', 'planningAdvice'], ['Habe ich genug gebucht?', 'myWeek']]) {
    const u = understand(q, isDe(q) ? de : en, {});
    assert.equal(u.skill, skill, q);
    assert.equal(u.kind, undefined, q);
  }
});

test('lotse(): one entry point – a story, a previewed command, a started workflow or a decide; ask() stays a valid Story', () => {
  const s = lotse('Lagebild Portfolio', de);
  assert.equal(s.kind, 'story');
  assert.doesNotThrow(() => validStory(s.story));
  const c = lotse('Setze die Schätzung von KPR-118 auf 16 h', de);
  assert.equal(c.kind, 'command');
  assert.ok(c.preview.token && c.preview.count === 1);
  const w = lotse('Löse die Überlast von Team UX', de);
  assert.equal(w.kind, 'workflow');
  assert.equal(w.state.goal.id, 'resolveOverload');
  assert.ok(['running', 'waiting'].includes(w.state.status));
  const d = lotse('verschiebe alles eine Woche', de);
  assert.equal(d.kind, 'decide');
  assert.ok(d.options.length >= 2);
  for (const q of ['Bereite das Weekly vor', 'Setze Datenplattform auf Rang 1', 'verschiebe alles eine Woche']) {
    const st = ask(q, de);
    assert.doesNotThrow(() => validStory(st), q);
    assert.ok(st.act?.kind, q);
    assert.ok(!/rovo/i.test(JSON.stringify(st)));
  }
});

test('an unknown scope is never widened: "… in Atlantis" asks which project – nothing is changed (live E2E 2026-11-23)', () => {
  const ctx = lotseCtx();
  const r = parseBulk('Team Web für alle Stories ohne Team in Atlantis', ctx);
  assert.equal(r.kind, 'decide');
  assert.match(r.question, /Kein Projekt „Atlantis“ gefunden – nichts wird geändert/);
  assert.ok(r.options.length > 0 && r.options.every((o) => o.value.params.filter.project), 'every option names a project');
  const en = parseBulk('Set team Web for all stories without a team in Atlantis', { ...ctx, lang: 'en' });
  assert.ok(!en || en.kind === 'decide', 'English: never a command for every project');
  // known scopes still work as before
  assert.equal(parseBulk('Team Web für alle Stories ohne Team in Kundenportal Relaunch', ctx).filter.project, ctx.computed.model.items.find((p) => p.name === 'Kundenportal Relaunch').ref);
  assert.equal(parseBulk('Team Web für alle Stories ohne Team in KW 49', ctx).kind, 'command');
  assert.equal(parseBulk('Team Web für alle Stories ohne Team', ctx).kind, 'command');
});
