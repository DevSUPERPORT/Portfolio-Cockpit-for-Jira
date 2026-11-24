// End-to-end test pass 2026-11-20 (production + 33 live suites on dev): what it found, fixed for good.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lotseCtx } from './lotseFixture.js';
import { routeAct } from '../shared/lotse/act/route.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Lotse / search bar: the short form "Fälligkeit PCX-11 in 3 Wochen" is a change again (it fell to a briefing)', () => {
  const ctx = lotseCtx('de');
  const key = ctx.ds.issues.find((i) => i.role === 'estimate').key;
  for (const q of [`Fälligkeit ${key} in 3 Wochen`, `Due date ${key} in 3 weeks`]) {
    const r = routeAct(q, ctx);
    assert.equal(r?.command, 'issue.setField', q);
    assert.equal(r.params.field, 'due');
    assert.match(r.params.value, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(routeAct(`Schätzung ${key} 8 h`, ctx)?.params?.value, 8);
  // a bare mention or a question stays a question (no write offered)
  for (const q of [`Fälligkeit ${key}`, `Fälligkeit ${key}?`, `Wann ist die Fälligkeit von ${key}?`]) assert.equal(routeAct(q, ctx), null, q);
});

test('overtime outlook: never "4 teams and 0 people" – name only what there is, and say why teams can be over alone', () => {
  const src = read('shared/lotse/skills/overtime.js');
  assert.match(src, /\.filter\(Boolean\)\.join\(' und '\)/);
  assert.match(src, /\.filter\(Boolean\)\.join\(' and '\)/);
  assert.match(src, /Keine einzelne Person ist über 100 %/);
  assert.match(src, /No single person is above 100%/);
});

test('Support › Tickets: without any JSM SLA the list starts with all open tickets, not an empty "Nothing is burning"', () => {
  const src = read('static/cockpit/src/views/Support.jsx');
  assert.match(src, /useState\(null\); \/\/ null = automatic/);
  assert.match(src, /const ticketFilter = filter \?\? \(noSlaSel \? 'open' : 'urgent'\);/);
  assert.match(src, /<Tickets sup=\{sup\} filter=\{ticketFilter\}/);
});

test('wording: a running absence is "Absent until …", the support average keeps its decimal, real plurals, one week label', () => {
  const mine = read('static/cockpit/src/views/Mine.jsx');
  assert.match(mine, /on \? tr\('Abwesend', 'Absent'\) : tr\('Nächste Abwesenheit', 'Next absence'\)/);
  assert.match(mine, /tr\(`bis \$\{fmt\.date\(a0\.to\)\}`, `until \$\{fmt\.date\(a0\.to\)\}`\)/);
  assert.match(read('static/cockpit/src/views/Portfolio.jsx'), /Ø \{fmt\.h\(avg, avg > 0 && avg < 9\.95 \? 1 : 0\)\}/);
  assert.doesNotMatch(read('shared/reportKpis.js'), /project\(s\)|Projekt\(e\)/);
  assert.doesNotMatch(read('static/cockpit/src/components/ProofLotse.jsx'), /claim\(s\)|Angabe\(n\)/);
  // English says "W 47" everywhere (the board, My work) – Plan vs. actual and the report said "CW 46"
  for (const p of ['shared/planActual.js', 'shared/reportKpis.js', 'static/cockpit/src/views/PlanActual.jsx']) assert.doesNotMatch(read(p), /`CW /, p);
});

test('Plan vs. actual names every team, also a hidden one of a split person (it showed the CEO team as its raw id)', async () => {
  const { buildPayload } = await import('../shared/planActual.js');
  const week = { week: '2026-W47', from: '2026-11-16', to: '2026-11-22', teams: { web: 'Web' }, people: { u1: { t: 'ceo-id', p: { 'issue:1': 8 } } }, projects: { 'issue:1': { n: 'A', r: 1 } } };
  const act = { week: '2026-W47', people: { u1: { t: 'ceo-id', b: { 'issue:1': 4 } } } };
  const out = buildPayload({ plans: [week], acts: [act], weeks: 4, canSee: () => true, teamNames: { 'ceo-id': 'CEO' } });
  assert.ok(out.teams.some((t) => t.id === 'ceo-id' && t.name === 'CEO'), JSON.stringify(out.teams));
  const src = read('src/lib/snapshot.js');
  assert.match(src, /flatMap\(\(x\) => \[x\.t, \.\.\.\(x\.teams \|\| \[\]\)\.map\(\(y\) => y\.t\)\]\)/, 'the weekly snapshot names every referenced team');
});
