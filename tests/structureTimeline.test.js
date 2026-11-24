// Projects › Structure as timeline (Gantt) and list – boss 2026-11-19: start → due bars, a period to choose, quality-of-
// life signals for decisions, project admins and above only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rollups, barOf, periodRange, ticks, quickFlags, workdaysBetween, isoWeek } from '../shared/timeline.js';
import { dayIdx } from '../shared/dates.js';

const T = dayIdx('2026-11-19'); // a Thursday
const I = (id, o) => ({ id, key: `PCX-${id}`, summary: id, role: 'estimate', status: { cat: 'new', name: 'To Do' }, oe: 0, ts: 0, re: 0, ...o });
const tree = [
  I('e', { role: 'structure', due: '2026-12-01' }),
  I('s1', { parentId: 'e', start: '2026-11-02', due: '2026-11-13', oe: 10, ts: 5, re: 5 }),
  I('s2', { parentId: 'e', start: '2026-11-20', due: '2026-12-10', oe: 8, ts: 0, re: 8 }),
  I('w', { role: 'rough' }),
  I('s3', { parentId: 'w', start: '2026-12-01', due: '2026-11-25' }),
  I('s4', { parentId: 'w' }),
  I('d', { status: { cat: 'done' }, start: '2026-10-01', due: '2026-10-05' }),
];
const kids = (id) => tree.filter((i) => i.parentId === id);
const roll = rollups(tree, kids);
const bar = (id) => barOf(tree.find((i) => i.id === id), roll, T);

test('bars: own dates, start after due, roll-ups for parents without dates, one-date markers, nothing', () => {
  assert.equal(bar('s1').kind, 'own');
  assert.equal(bar('s1').overdue, T - dayIdx('2026-11-13'), 'open and past due: days of slip');
  assert.equal(bar('s1').progress, 0.5, 'time spent ÷ original estimate');
  assert.equal(bar('s3').kind, 'invalid', 'start after due');
  assert.equal(bar('e').kind, 'dueOnly', 'only a due date: a marker');
  assert.equal(bar('e').late, dayIdx('2026-12-10') - dayIdx('2026-12-01'), 'a child ends after the parent\'s due');
  assert.equal(bar('e').oe, 18, 'estimates add up from below');
  const w = bar('w');
  assert.equal(w.kind, 'rollup', 'no own dates: the span of what is below');
  assert.deepEqual([w.a, w.b], [dayIdx('2026-11-25'), dayIdx('2026-12-01')]);
  assert.equal(bar('s4').kind, 'none');
  assert.equal(bar('d').overdue, 0, 'done is never overdue');
  assert.equal(bar('d').progress, 1);
});

test('quick filters: overdue, ends soon, conflicts, children after due, start after due, no dates', () => {
  const f = (id, c = new Set()) => quickFlags(tree.find((i) => i.id === id), bar(id), T, c);
  assert.ok(f('s1').overdue);
  assert.ok(f('e').soon, 'due within 14 days');
  assert.ok(f('e').late);
  assert.ok(f('s3').invalid);
  assert.ok(f('s4').unscheduled);
  assert.ok(f('s2', new Set(['s2'])).conflict);
  assert.ok(!f('d').overdue && !f('d').late);
});

test('periods: whole project, month, quarter, next months, year, custom (a bad custom range falls back)', () => {
  const bars = tree.map((i) => bar(i.id));
  const [a, b] = periodRange('fit', T, bars);
  assert.ok(a <= dayIdx('2026-10-01') && b >= dayIdx('2026-12-10'), 'the whole project with a little air');
  assert.deepEqual(periodRange('month', T), [dayIdx('2026-11-01'), dayIdx('2026-11-30')]);
  assert.deepEqual(periodRange('quarter', T), [dayIdx('2026-10-01'), dayIdx('2026-12-31')]);
  assert.deepEqual(periodRange('year', T), [dayIdx('2026-01-01'), dayIdx('2026-12-31')]);
  const n3 = periodRange('next3', T);
  assert.ok(n3[0] < T && n3[1] - T >= 90);
  assert.deepEqual(periodRange('custom', T, bars, { from: '2027-01-01', to: '2027-03-31' }), [dayIdx('2027-01-01'), dayIdx('2027-03-31')]);
  assert.deepEqual(periodRange('custom', T, bars, { from: '2027-03-31', to: '2027-01-01' }), periodRange('fit', T, bars), 'to before from: whole project');
});

test('scale: weeks under months, months under quarters, quarters under years; ISO weeks; working days', () => {
  const w = ticks(dayIdx('2026-11-01'), dayIdx('2026-12-31'), 'week');
  assert.deepEqual(w.top.map((t) => t.m), [11, 12]);
  assert.equal(w.bottom[0].w, 44, '1 Nov 2026 (Sunday) is in ISO week 44');
  const m = ticks(dayIdx('2026-11-01'), dayIdx('2027-02-28'), 'month');
  assert.deepEqual(m.bottom.map((t) => t.m), [11, 12, 1, 2]);
  assert.deepEqual(m.top.map((t) => `${t.y}Q${t.q}`), ['2026Q4', '2027Q1']);
  assert.deepEqual(ticks(dayIdx('2026-11-01'), dayIdx('2027-12-31'), 'quarter').top.map((t) => t.y), [2026, 2027]);
  assert.equal(isoWeek(dayIdx('2026-01-01')), 1);
  assert.equal(isoWeek(dayIdx('2027-01-01')), 53, '1 Jan 2027 belongs to week 53 of 2026');
  assert.equal(workdaysBetween(dayIdx('2026-11-16'), dayIdx('2026-11-29')), 10);
});

test('the views: project admins, management and Jira admins only; the tree stays for everyone', async () => {
  const src = readFileSync(new URL('../static/cockpit/src/views/Project.jsx', import.meta.url), 'utf8');
  assert.match(src, /export const canStructureViews = \(roles\) => !!roles\?\.admin \|\| \(roles\?\.roleNames \|\| \[\]\)\.some\(\(r\) => r === 'projectAdmin' \|\| r === 'management' \|\| r === 'jiraAdmin'\);/);
  assert.match(src, /const view = views \? viewPref : 'tree';/, 'without the right: always the tree');
  const tl = readFileSync(new URL('../static/cockpit/src/components/StructureTimeline.jsx', import.meta.url), 'utf8');
  for (const k of ['data-tl-period', 'data-tl-strip', 'tl-deps', 'tl-ms-flag', 'tl-today', 'tl-slip']) assert.ok(tl.includes(k), k);
  const list = readFileSync(new URL('../static/cockpit/src/components/StructureList.jsx', import.meta.url), 'utf8');
  assert.match(list, /data-sl-columns/);
  assert.match(list, /downloadWorkbook\(/);
});

test('Lotse reads the timeline: routed from DE/EN questions, every number and date with a source, the proof names Jira keys', async () => {
  const { lotseCtx, lotseDataset } = await import('./lotseFixture.js');
  const L = await import('../shared/lotse/index.js');
  for (const lang of ['de', 'en']) {
    const ctx = lotseCtx(lang, { ds: lotseDataset() });
    const it = ctx.computed ? ctx.computed.model.items[0] : null;
    const q = lang === 'de' ? `Erkläre die Zeitleiste von ${it?.name || 'Billing'}` : `Explain the timeline of ${it?.name || 'Billing'}`;
    const s = L.ask(q, ctx);
    assert.equal(s.skill, 'timelineBrief', `${lang}: "${q}" → ${s.skill}`);
    L.validStory(s);
    assert.deepEqual(L.selfCheck(s), [], `${lang}: every number sourced`);
    assert.equal(s.visual.kind, s.findings.some((f) => f.tone !== 'ok') ? 'gantt' : s.visual.kind);
    const keys = s.findings.flatMap((f) => f.evidence).map((e) => e.key).filter(Boolean);
    assert.ok(keys.length > 0, `${lang}: the proof points at work items`);
    const real = new Set([...ctx.computed.model.byId.values(), ...(ctx.computed.model.external?.values() || [])].map((i) => i.key));
    for (const k of keys) assert.ok(real.has(k), `${k} is a real work item of the dataset`);
  }
  for (const q of ['Gantt für Billing zusammenfassen', 'Was ist spät im Zeitplan?', 'summarise the gantt', 'When will Billing be finished?']) assert.equal(L.ask(q, lotseCtx('de', { ds: lotseDataset() })).skill, 'timelineBrief', q);
});

test('tester 2026-11-19: create dialog with a space; the suggestion fills the field; no due before start; finish sooner resolves the conflict', () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  assert.match(read('static/cockpit/src/lib/api.js'), /context: \{ issueTypeId, \.\.\.\(projectId \? \{ projectId: String\(projectId\) \} : \{\}\) \}/);
  assert.match(read('static/cockpit/src/views/Portfolio.jsx'), /createIssue\(config\.portfolio\.issueTypeIds\[0\], load, space \|\| null\)/);
  const q = read('static/cockpit/src/views/Quality.jsx');
  assert.match(q, /if \(onPick\) \{ onPick\(sug\.value\); return; \}/, 'the suggestion only fills the field');
  assert.match(q, /disabled=\{!v \|\| busy \|\| !!wrongOrder\}/, 'no due before the start, no start after the due');
  assert.match(read('shared/smart.js'), /if \(issue\.start && dayIdx\(issue\.start\) != null && dayIdx\(issue\.start\) > dayIdx\(ms\.date\)\) return null;/);
  const o = read('shared/optimize.js');
  assert.match(o, /const chainFix = \(id, s, e\) =>/);
  assert.match(o, /for \(const a of s\.also \|\| \[\]\) \{ const d = byId\.get\(a\.taskId\); if \(d\) next = moveTask\(next, d, \{ start: a\.start \}\); \}/, 'the chained start becomes a pending change too');
});

test('finish sooner on a prerequisite in a blocks conflict: the dependent starts after the new due – no conflict left (tester PCX-1 → PCX-2)', async () => {
  const F = await import('./lotseFixture.js');
  const { computeAll } = await import('../shared/engine.js');
  const { optimizeAll, suggestionMoves } = await import('../shared/optimize.js');
  const { conflicts } = await import('../shared/weekPlan.js');
  const base = F.lotseDataset();
  const team = 't-web';
  const first = optimizeAll({ ds: base, computed: computeAll(base), team }).sooner.suggestions[0];
  assert.ok(first, 'the fixture has a "finish sooner" for the web team');
  // a dependent that today starts with the prerequisite – before it ends (the tester's case), with room after the new due
  const ds = structuredClone(base);
  const A = ds.issues.find((i) => i.id === first.taskId);
  const B = ds.issues.find((i) => i.role === 'estimate' && i.id !== A.id && i.status?.cat !== 'done' && !(i.links || []).length && i.team?.id !== team);
  B.start = A.start; B.due = new Date(Date.parse(`${A.due}T00:00:00Z`) + 90 * 864e5).toISOString().slice(0, 10);
  A.links = [...(A.links || []), { id: 'lt1', typeId: '10000', verb: 'blocks', inverse: 'is blocked by', outward: true, otherId: B.id }];
  B.links = [...(B.links || []), { id: 'lt1', typeId: '10000', verb: 'blocks', inverse: 'is blocked by', outward: false, otherId: A.id }];
  const comp = computeAll(ds);
  assert.ok(comp.deps.list.some((d) => d.conflict && d.pre === A.id && d.dep === B.id), 'the conflict exists before');
  const s = optimizeAll({ ds, computed: comp, team }).sooner.suggestions.find((x) => x.taskId === A.id);
  assert.ok(s, `${A.key} still gets "finish sooner"`);
  assert.deepEqual((s.also || []).map((a) => a.key), [B.key], 'the dependent moves with it');
  assert.ok(s.also[0].start > s.newDue, 'it starts after the new due date');
  assert.match(s.reason.de, new RegExp(`${B.key} wartet darauf und startet dann am`));
  const mv = suggestionMoves({}, ds.issues, [s]);
  assert.equal(mv[B.id].start, s.also[0].start, 'a pending change for the dependent too');
  assert.equal(conflicts({ model: comp.model, moves: mv }).filter((c) => c.pre.id === A.id && c.dep.id === B.id).length, 0, 'no conflict left');
});

test('unsourced numbers: dates in US order are dates, not numbers (live finding: an en-US locale wrote "last on Oct 22")', async () => {
  const { unsourcedNumbers } = await import('../shared/lotse/act/kit.js');
  assert.deepEqual(unsourcedNumbers('5 tickets, 22.5 h, last on Oct 22', [5, 22.5]), []);
  assert.deepEqual(unsourcedNumbers('last on Oct 22, 2026 and 11/22/2026', []), []);
  assert.deepEqual(unsourcedNumbers('zuletzt am 22. Okt.', []), []);
  assert.deepEqual(unsourcedNumbers('7 tickets', [5]), ['7'], 'a real number without a source is still caught');
});
