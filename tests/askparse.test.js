// Ask understands everyday questions (German and English, any word order, small typos) – a regression probe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAll } from '../shared/engine.js';
import { parseQuestion, answer, hasData, closestQuestions, fixTypos } from '../shared/ask.js';

const g = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url)));
const c = computeAll(g);
const fmt = { pct: (v) => (v == null ? '–' : Math.round(v * 100) + ' %'), h: (v) => Math.round(v) + ' h', n: (v) => String(v), signedPct: (v) => String(v), date: (d) => String(d), quarter: (q) => q, week: (w) => w, dateTime: (d) => String(d) };
const ctx = (lang) => ({ computed: c, ds: g, lang, fmt, ruleName: (r) => r, me: null, roles: { viewReport: true }, supportA: null });
const Q = [
  ['How busy are the teams?', 'utilization'], ['Which team is overloaded?', 'utilization'], ['Who has free capacity next quarter?', 'utilization'], ['Wie ausgelastet ist Team Web?', 'utilization'],
  ['Welche Teams sind überlastet?', 'utilization'], ['Show me the workload', 'utilization'], ['Which projects are late?', 'overdue'], ['Was ist überfällig?', 'overdue'],
  ['What is blocked?', 'blocked'], ['Welche Stories sind blockiert?', 'blocked'], ['Show dependencies between projects', 'dependencies'], ['Which projects are at risk?', 'health'],
  ['Wie steht Billing?', 'project'], ['Status of CRM', 'project'], ['How far is Billing?', 'progress'], ['Wie weit sind wir?', 'progress'],
  ['Are we over budget?', 'hours'], ['Where do we spend more than planned?', 'hours'], ['Planned vs actual hours', 'hours'], ['Soll Ist Vergleich', 'hours'],
  ['What should I look at today?', 'attention'], ['Was muss ich heute tun?', 'attention'], ['Top risks', 'attention'], ['Which data is missing?', 'quality'],
  ['Wo fehlen Schätzungen?', 'quality'], ['How is support doing?', 'support'], ['Wie viele Tickets sind offen?', 'support'], ['SLA breaches', 'support'],
  ['Which milestones are coming up?', 'milestones'], ['Nächste Meilensteine', 'milestones'], ['Show the ranking', 'ranking'], ['Portfolio overview', 'ranking'],
  ['Can we do all projects this quarter?', 'waterline'], ['Reicht die Kapazität?', 'waterline'], ['How many projects do we have?', 'count'], ['Wie viele Projekte sind kritisch?', 'health'],
  ['Maturity of the projects', 'maturity'], ['Wie belastbar sind die Zahlen?', 'maturity'], ['Which epics have no T-shirt size?', 'quality'], ['Booked hours this month', 'hours'], ['Which deadlines are slipping?', 'overdue'], ['Wie ausgelastet sind die Teams?', 'utilization'], ['Stunden je Projekt als Tabelle', 'hours'], ['Was ist blockiert?', 'blocked'], ['Show me stuck work', 'blocked'], ['Are we on budget for billing?', 'hours'], ['Wie ausgelasstet ist Team Web?', 'utilization'], ['Was ist uberfällig?', 'overdue'], ['Show me the overdue stuff', 'overdue'], ['Teams workload next quarter', 'utilization'],
];

test('every probe question is understood as intended', () => {
  const miss = Q.filter(([q, want]) => parseQuestion(q, { model: c.model, quarters: c.wl.quarters }).intent !== want);
  assert.deepEqual(miss, [], miss.map(([q]) => q).join(' | '));
});

test('every understood question yields a card with real data in its first view (no empty charts)', () => {
  for (const lang of ['de', 'en']) {
    for (const [q] of Q) {
      const a = answer(q, ctx(lang));
      if (!a) continue; // project questions about a project not in the fixture
      assert.ok(a.title && a.answer, q);
      assert.ok(a.views.includes(a.view), q);
      assert.ok(a.view === 'text' || hasData(a, a.view), `${q}: first view ${a.view} has data`);
    }
  }
});

test('typos one letter off are read as the keyword', () => {
  assert.equal(fixTypos('wie ausgelasstet ist team web'), 'wie ausgelastet ist team web');
  assert.equal(fixTypos('was ist uberfaellig'), 'was ist ueberfaellig');
  assert.equal(fixTypos('show progres'), 'show progress');
  assert.equal(fixTypos('web team'), 'web team', 'short words are left alone');
});

test('a question nothing matches gets the closest answerable questions, never a dead end', () => {
  const near = closestQuestions('Is the team schedule too packed?', ctx('en'));
  assert.equal(near.length, 4);
  assert.ok(near.some((x) => /team/i.test(x)), near.join(' | '));
});

test('people are never rated, however the question is phrased', () => {
  for (const q of ['Who is the slowest person?', 'Wer ist am wenigsten produktiv?', 'Ranking der Mitarbeiter']) assert.equal(answer(q, ctx('en'))?.intent, 'guard', q);
});
