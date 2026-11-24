// Boss 2026-11-20: "This is my capacity – why does the project view have 250 %? 2 × 125 %? It is always me … I think this
// is a calculation bug." It was: the Projekte rows (and the team sums) counted all 40 h of Jonas' week against only his
// 50 % share in SUPERPORT #1 (16 h), although SUPERPORT #2 had nothing planned for him. Now a split person's share is a
// guarantee, not a cap (shareSplit): what the other team does not need that week counts for the team that needs it. One
// person-week, one number: 40 h on 32 h = 8 h too much = 125 % in Personen, Projekte, Teams and My work.
// Also: "Warum zu viel?" explains every red week from the same board, with fixes (explainOver, handOverFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAll } from '../shared/engine.js';
import { buildBoard, shareSplit, REST, personBoardWeeks } from '../shared/weekPlan.js';
import { explainOver, handOverFor } from '../shared/overWhy.js';
import { suggestShifts } from '../shared/planSuggest.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);
const st = { name: 'Offen', cat: 'new' };
const story = (o) => ({ role: 'estimate', status: st, links: [], worklogs: [], parentId: o.rootRef.slice(6), ...o });

// Today Wed 18 Nov 2026 (KW 47). Jonas: 40 h, 20 % daily business, 50 % SUPERPORT #1 / 50 % SUPERPORT #2.
// PRKEN-36: 80 h in SUPERPORT #1, KW 48–49 (40 h per week). In KW 47 he has 6 h in each team.
function boss({ t2Week48 = 0, colleague = 0 } = {}) {
  const ds = {
    today: '2026-11-18',
    config: {},
    portfolio: [
      { ref: 'issue:1', rank: 1, kind: 'issue', id: '1', key: 'P-1', name: 'KI-Kundenservice', statusCat: 'indeterminate', due: '2026-12-31' },
      { ref: 'issue:2', rank: 2, kind: 'issue', id: '2', key: 'P-2', name: 'Tests', statusCat: 'indeterminate', due: '2026-12-31' },
      { ref: 'issue:3', rank: 3, kind: 'issue', id: '3', key: 'P-3', name: 'Other team', statusCat: 'indeterminate', due: '2026-12-31' },
    ],
    teams: [{ id: 's1', name: 'SUPERPORT #1' }, { id: 's2', name: 'SUPERPORT #2' }],
    people: { dm: { name: 'Jonas Weber (EXT)' }, mx: { name: 'Max' } },
    capacity: {
      people: {
        dm: { weeklyHours: 40, location: 'NONE', teamId: 's1', teams: [{ teamId: 's1', pct: 50 }, { teamId: 's2', pct: 50 }] },
        ...(colleague ? { mx: { weeklyHours: colleague, location: 'NONE', teamId: 's1' } } : {}),
      },
      absences: [],
      teams: { s1: { dailyBusinessPct: 20, internalPct: 0 }, s2: { dailyBusinessPct: 20, internalPct: 0 } },
    },
    supportComputed: { personWeekly: {}, teams: [], services: [], reserveQuarter: {} },
    issues: [
      story({ id: '136', key: 'PRKEN-36', summary: 'Big task', team: { id: 's1' }, assignee: { id: 'dm', name: 'Jonas Weber (EXT)' }, oe: 80, re: 80, start: '2026-11-23', due: '2026-12-04', rootRef: 'issue:1' }),
      story({ id: '137', key: 'PRKEN-37', summary: 'Small', team: { id: 's1' }, assignee: { id: 'dm', name: 'Jonas Weber (EXT)' }, oe: 6, re: 6, start: '2026-11-16', due: '2026-11-20', rootRef: 'issue:2' }),
      story({ id: '201', key: 'SP2-1', summary: 'Other team', team: { id: 's2' }, assignee: { id: 'dm', name: 'Jonas Weber (EXT)' }, oe: 6, re: 6, start: '2026-11-16', due: '2026-11-20', rootRef: 'issue:3' }),
      ...(t2Week48 ? [story({ id: '202', key: 'SP2-2', summary: 'Other team, KW 48', team: { id: 's2' }, assignee: { id: 'dm', name: 'Jonas Weber (EXT)' }, oe: t2Week48, re: t2Week48, start: '2026-11-23', due: '2026-11-27', rootRef: 'issue:3' })] : []),
    ],
  };
  return { ds, computed: computeAll(ds) };
}

test('shareSplit: the share is a guarantee, unused time goes where it is needed – the teams always add up to the person', () => {
  const alloc = [{ teamId: 'a', pct: 50 }, { teamId: 'b', pct: 50 }];
  // the boss's week: 40 h in a, nothing in b, 32 h of time → a gets all 32 h, 8 h too much – not 16 h and 24 h
  const s = shareSplit({ alloc, avail: 32, loads: { a: 40 } });
  near(s.byTeam.a.entitled, 16, 'a entitled');
  near(s.byTeam.a.borrowed, 16, 'a borrowed');
  near(s.byTeam.a.time, 32, 'a time');
  near(s.byTeam.a.over, 8, 'a over');
  near(s.byTeam.b.lent, 16, 'b lent');
  near(s.byTeam.b.time, 0, 'b time');
  assert.deepEqual(s.byTeam.a.from.map((x) => [x.teamId, Math.round(x.hours)]), [['b', 16]]);
  // both teams over their share: each keeps its share, the overload stays where it was made
  const both = shareSplit({ alloc, avail: 32, loads: { a: 40, b: 20 } });
  near(both.byTeam.a.over, 24, 'a over'); near(both.byTeam.b.over, 4, 'b over'); near(both.over, 28, 'sum = person');
  // a team that uses less than its share keeps the rest as free time
  const calm = shareSplit({ alloc, avail: 32, loads: { a: 6, b: 6 } });
  near(calm.byTeam.a.free, 10, 'a free'); near(calm.byTeam.b.free, 10, 'b free'); near(calm.over, 0, 'no over');
  // shares below 100 % leave a REST bucket; work of a team without a share can only borrow
  const rest = shareSplit({ alloc: [{ teamId: 'a', pct: 60 }], avail: 40, loads: { x: 10 } });
  near(rest.byTeam[REST].entitled, 16, 'rest'); near(rest.byTeam.x.time, 10, 'x borrows'); near(rest.over, 0, 'fits');
  // random weeks, three teams: Σ time = the person's time, Σ over = the person's own overload
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 400; k++) {
    const p = [Math.round(rnd() * 60), Math.round(rnd() * 40)];
    const al = [{ teamId: 'a', pct: Math.max(1, p[0]) }, { teamId: 'b', pct: Math.max(1, Math.min(100 - Math.max(1, p[0]), p[1])) }, { teamId: 'c', pct: 0 }].filter((x) => x.pct > 0);
    const A = rnd() * 40;
    const loads = { a: rnd() * 40, b: rnd() * 30, c: rnd() * 10, [REST]: rnd() * 5 };
    const sup = rnd() * 4;
    const r = shareSplit({ alloc: al, avail: A, support: sup, loads });
    const total = Object.values(loads).reduce((x, y) => x + y, 0) + sup;
    near(r.list.reduce((x, b) => x + b.time, 0), A, `Σ time ${k}`);
    near(r.over, Math.max(0, total - A), `Σ over ${k}`);
    for (const b of r.list) assert.ok(b.time >= -1e-9 && b.over >= -1e-9 && b.free >= -1e-9, `${k} ${b.teamId}`);
  }
});

test('the boss\'s week: Projekte, Personen, the sum and the Teams overview all say 8 h too much – 125 %, not 250 %', () => {
  const { ds, computed } = boss();
  const pj = buildBoard({ ds, computed, team: 's1', mode: 'projects' });
  const row = pj.rows.find((r) => r.id === 'r:issue:1');
  const w48 = 1, w49 = 2;
  for (const wi of [w48, w49]) {
    near(row.cells[wi].load, 40, 'project load');
    near(row.cells[wi].avail, 32, 'project: all of his 32 h');
    near(row.cells[wi].util, 1.25, 'project util');
    near(pj.foot[wi].util, 1.25, 'projects sum');
  }
  const pp = buildBoard({ ds, computed, team: 's1' });
  const dm = pp.rows.find((r) => r.id === 'p:dm');
  near(dm.cells[w48].util, 1.25, 'person row');
  near(pp.foot[w48].util, 1.25, 'people sum');
  const all = buildBoard({ ds, computed });
  const t1 = all.rows.find((r) => r.teamId === 's1'), t2 = all.rows.find((r) => r.teamId === 's2');
  near(t1.cells[w48].load, 40, 'team 1 load'); near(t1.cells[w48].avail, 32, 'team 1 time');
  near(t2.cells[w48].avail, 0, 'team 2 lent its half this week');
  // KW 47: 6 h in each team – each team keeps its 16 h, 10 h free each, together = the person's 20 h free
  near(t1.cells[0].avail - t1.cells[0].load, 10, 'team 1 free'); near(t2.cells[0].avail - t2.cells[0].load, 10, 'team 2 free');
  near(dm.cells[0].avail - dm.cells[0].load, 20, 'person free');
  // My work reads the same board row
  const mine = personBoardWeeks({ ds, computed, personId: 'dm', weeks: 8 });
  near(mine[w48].load / mine[w48].avail, 1.25, 'My work');
});

test('when the other team needs its half, it keeps it – the overload shows where the work was planned, and adds up', () => {
  const { ds, computed } = boss({ t2Week48: 20 });
  const all = buildBoard({ ds, computed });
  const t1 = all.rows.find((r) => r.teamId === 's1').cells[1], t2 = all.rows.find((r) => r.teamId === 's2').cells[1];
  near(t1.avail, 16, 'team 1 only its share'); near(t2.avail, 16, 'team 2 its share');
  const person = buildBoard({ ds, computed, team: 's1' }).rows.find((r) => r.id === 'p:dm').cells[1];
  near((t1.load - t1.avail) + (t2.load - t2.avail), person.load - person.avail, 'Σ team overload = the person\'s overload (24 + 4 = 28)');
});

test('a helper from another team brings the time his own team does not need (production 2026-11-20: Lea, "22 h too much" with room to spare)', () => {
  const { ds, computed } = boss();
  // Lea is only in SUPERPORT #2 and does a 27 h task of SUPERPORT #1 in KW 49 – nothing else that week
  ds.people.iu = { name: 'Lea Hoffmann' };
  ds.capacity.people.iu = { weeklyHours: 40, location: 'NONE', teamId: 's2' };
  ds.issues.push(story({ id: '301', key: 'PCX-37', summary: 'UI-Prototyp', team: { id: 's1' }, assignee: { id: 'iu', name: 'Lea Hoffmann' }, oe: 27, re: 27, start: '2026-11-30', due: '2026-12-04', rootRef: 'issue:2' }));
  const c2 = computeAll(ds);
  const pj = buildBoard({ ds, computed: c2, team: 's1', mode: 'projects' });
  const w49 = 2;
  const row = pj.rows.find((r) => r.id === 'r:issue:2');
  near(row.cells[w49].load, 27, 'his task');
  // person by person: Jonas' overflow on rank 1 does not eat Lea's time – Lea's 27 h fit exactly what he brings
  near(row.cells[w49].over, 0, 'nothing too much');
  near(row.cells[w49].util, 1, 'exactly full');
  near(pj.rows.find((r) => r.id === 'r:issue:1').cells[w49].over, 8, 'rank 1: his own 8 h too much');
  near(pj.foot[w49].over, 8, 'the team: the sum of its people (8 + 0)');
  const all = buildBoard({ ds, computed: c2 });
  near(all.rows.find((r) => r.teamId === 's2').cells[w49].avail, 32 - 27, 'his team keeps what he does not lend');
  const x = explainOver({ board: pj, model: c2.model, rowId: 'r:issue:2', wi: w49 });
  const iu = x.people.find((p) => p.id === 'iu');
  assert.equal(iu.member, false); near(iu.time, 27, 'his time for this team'); assert.deepEqual(iu.from.map((f) => f.teamId), ['s2']);
});

test('"Warum zu viel?": the project week explained from the board – his share, what came from the other team, the same 8 h', () => {
  const { ds, computed } = boss();
  const pj = buildBoard({ ds, computed, team: 's1', mode: 'projects' });
  const x = explainOver({ board: pj, model: computed.model, rowId: 'r:issue:1', wi: 1 });
  assert.equal(x.scope, 'project');
  near(x.load, 40, 'load'); near(x.avail, 32, 'avail'); assert.equal(x.fit.kind, 'over'); near(x.fit.over, 8, 'over');
  const d = x.people.find((p) => p.id === 'dm');
  near(d.share, 0.5, 'share'); near(d.entitled, 16, 'own half'); near(d.borrowed, 16, 'the other half');
  assert.deepEqual(d.from.map((f) => f.teamId), ['s2']);
  near(d.here, 40, 'his hours in this project'); near(d.person.over, 8, 'the person: the same 8 h');
  assert.equal(x.takes.tasks[0].key, 'PRKEN-36');
  // the person row and the sums explain the same way
  const pp = buildBoard({ ds, computed, team: 's1' });
  const px = explainOver({ board: pp, model: computed.model, rowId: 'p:dm', wi: 1 });
  assert.equal(px.scope, 'person'); near(px.time.nominal, 40, 'week'); near(px.time.daily, 8, 'daily business'); near(px.time.avail, 32, 'time');
  assert.equal(px.time.dailyPct, 20);
  const fx = explainOver({ board: pp, model: computed.model, foot: true, wi: 1 });
  assert.equal(fx.scope, 'people'); near(fx.avail, 32, 'team time'); near(fx.takes.members, 40, 'team work');
});

test('fixes: a colleague with room in every week of the task takes it over (Max, 50 h → 40 h for projects)', () => {
  const { ds, computed } = boss({ colleague: 50 });
  const pp = buildBoard({ ds, computed, team: 's1' });
  const to = handOverFor(pp, '136');
  assert.equal(to?.id, 'mx');
  near(to.peak, 1, 'Max is then exactly full – never above 100 %');
  assert.deepEqual(to.weeks, [pp.weeks[1].from, pp.weeks[2].from]);
});

test('fixes: hand-over only to someone with room; the advice for a red project week comes from the people board', () => {
  const { ds, computed } = boss({ colleague: 40 });
  const pp = buildBoard({ ds, computed, team: 's1' });
  assert.equal(handOverFor(pp, '136'), null, 'Max has 32 h – 40 h do not fit him either');
  // split advice for the red week, computed on the team's people board (what WeekBoard does for the Projekte rows)
  const sug = suggestShifts({ ds, computed, board: pp, moves: {} });
  const s = sug.find((x) => x.taskId === '136');
  assert.ok(s, JSON.stringify(sug.map((x) => x.key)));
  assert.ok(s.conflictWeeks.includes(pp.weeks[1].from));
  const wb = read('static/cockpit/src/components/WeekBoard.jsx');
  assert.match(wb, /sugBoard\.kind === 'projects' \? buildBoard\(\{ ds, computed, team: sugBoard\.team, mode: 'people'/);
  assert.match(wb, /sugByCell\.get\(`t:\$\{k\.id\}:/, 'the one-click fix in the red project cell');
});

test('UI: "Warum?" in every red head, the explainer with Lotse fixes, never "0 %", team hours count default members', () => {
  const wb = read('static/cockpit/src/components/WeekBoard.jsx');
  assert.ok((wb.match(/<WhyOverButton onOpen=/g) || []).length >= 4, 'person, project, team rows, sum');
  assert.match(wb, /const pctTag = \(u\) => \(u !== Infinity && !\(Math\.round\(\(u \|\| 0\) \* 100\) >= 1\) \? null/);
  assert.doesNotMatch(wb, /<FitWords fit=\{fit\} \/><b>\{pct\(/, 'the small % goes through pctTag');
  const ow = read('static/cockpit/src/components/OverWhy.jsx');
  for (const k of ["'sug'", "'hand'", "'shares'", "'jira'"]) assert.ok(ow.includes(`kind: ${k}`), k);
  assert.match(ow, /workflow: 'splitResolve', params: \{ person: f\.p\.id \}/, 'Lotse fits the shares (with a preview)');
  assert.match(ow, /Dieselbe Zahl überall/);
  const cap = read('static/cockpit/src/views/Capacity.jsx');
  assert.match(cap, /capacityPeople\(\{ ds: \{ \.\.\.\(computed\?\.model\?\.ds \|\| ds\), capacity: cap \} \}\)/);
  assert.match(cap, /const weekly = \(tid\) => counted\.reduce/);
});

test('Personen board: "Summe" adds up the person rows – a split person overloaded elsewhere is not "fast voll 100 %" (boss 2026-11-23)', () => {
  // KW 48: 40 h in team 1 and 20 h in team 2 on his 32 h – the person is 28 h over; team 2's own slice is only 4 h over
  const { ds, computed } = boss({ t2Week48: 20 });
  for (const team of ['s1', 's2']) {
    const b = buildBoard({ ds, computed, team });
    const person = b.rows.find((r) => r.id === 'p:dm').cells[1];
    near(person.load - person.avail, 28, `${team}: the person row`);
    near(b.foot[1].over, 28, `${team}: the sum row says the same 28 h too much`);
    near(b.foot[1].util, person.util, `${team}: and the same %`);
    assert.equal(b.foot[1].sumOf, 'people');
  }
  // the Teams overview keeps each team's own slice – together the person's overload (24 + 4)
  const all = buildBoard({ ds, computed });
  const t1 = all.rows.find((r) => r.teamId === 's1').cells[1], t2 = all.rows.find((r) => r.teamId === 's2').cells[1];
  near(t1.over + t2.over, 28, 'Σ team slices = the person');
  // "Warum?" on the sum row explains it with the people's whole weeks
  const pp = buildBoard({ ds, computed, team: 's2' });
  const x = explainOver({ board: pp, model: computed.model, foot: true, wi: 1 });
  assert.equal(x.scope, 'people');
  near(x.over, 28, 'explained: 28 h');
  near(x.people.find((p) => p.id === 'dm').person.over, 28, 'his own week');
});
