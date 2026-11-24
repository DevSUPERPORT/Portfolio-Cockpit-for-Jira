// Lotse missions – planning: the re-planner measures exactly what the cockpit shows, plans every week within the
// target, keeps what fits, and the missions "Meine Woche auf 100 %" / "Team realistisch planen" run end to end from the
// sentence a person types to Jira writes that undo cleanly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, answer, next, applyStep, undoAll, current, unsourced, routeAct } from '../shared/lotse/act/index.js';
import { fakeIo } from '../shared/lotse/act/fakeIo.js';
import { stable } from '../shared/lotse/act/kit.js';
import { validStory, selfCheck, understand } from '../shared/lotse/index.js';
import { replan } from '../shared/lotse/plan/replan.js';
import { weeksUtilization, capacityPeople } from '../shared/engine.js';
import { lotseCtx, lotseDataset } from './lotseFixture.js';

const fresh = (lang = 'de', over = {}) => lotseCtx(lang, { ds: lotseDataset(), ...over });
const recommended = (st) => (st.multi ? st.options.filter((o) => o.recommended && !o.disabled).map((o) => o.id) : (st.options.find((o) => o.recommended && !o.disabled) || st.options.find((o) => !o.disabled)).id);
async function run(goal, ctx, io, script = {}) {
  let s = start(goal, ctx);
  for (let guard = 0; s.status !== 'done' && guard < 80; guard++) {
    const cur = current(s);
    if (cur.kind === 'story' || cur.kind === 'summary') s = next(s);
    else if (cur.kind === 'decide') { const v = script[cur.id]; s = answer(s, cur.id, typeof v === 'function' ? v(cur) : v ?? recommended(cur)); }
    else if (cur.kind === 'preview') s = answer(s, cur.id, script[cur.id] || (cur.options.find((o) => o.id === 'apply')?.disabled ? 'skip' : 'apply'));
    else if (cur.kind === 'command') s = await applyStep(s, io);
  }
  return s;
}

test('re-planner "before" is exactly the cockpit\'s load (weeksUtilization) for every person', () => {
  const ctx = fresh();
  const c = ctx.computed;
  const wu = weeksUtilization(c.model, c.support, 8);
  const plan = new Map();
  for (const t of wu.teams) for (const m of t.members) plan.set(m.id, m.plan);
  const ids = [...capacityPeople(c.model).keys()];
  const r = replan(ctx, { people: ids });
  assert.ok(r.people.length >= 10);
  for (const p of r.people.filter((x) => x.role === 'planned')) {
    const ref = plan.get(p.id) || new Array(8).fill(0);
    p.before.forEach((w, i) => assert.ok(Math.abs(w.plan - ref[i]) < 1e-6, `${p.id} week ${i}: ${w.plan} vs ${ref[i]}`));
  }
});

test('re-planner: every planned week within the target, overdue work gets a real window, fitting work keeps its dates', () => {
  const ctx = fresh();
  const people = [...capacityPeople(ctx.computed.model).keys()];
  for (const pid of people) {
    for (const order of ['rank', 'due']) {
      const r = replan(ctx, { people: [pid], order, handover: false, fixWeeks: 52 });
      const p = r.people.find((x) => x.id === pid);
      if (!p) continue;
      if (!r.unplaced.length) p.after.forEach((w, i) => assert.ok(!(w.util > 1.005), `${pid}/${order} week ${i}: ${Math.round(w.util * 100)} %`));
      const ds = ctx.ds;
      for (const s of ds.issues.filter((x) => x.assignee?.id === pid && x.role === 'estimate' && x.status?.cat !== 'done' && x.re > 0 && (!x.due || x.due < ds.today))) {
        assert.ok(r.moves.some((m) => m.issueId === s.id) || r.unplaced.some((u) => u.id === s.id), `${s.key} overdue/undated must be planned`);
      }
      for (const m of r.moves) {
        assert.ok(m.to.start >= ds.today && m.to.due >= m.to.start, `${m.key} window`);
        assert.ok(['overdue', 'undated', 'overload', 'inverted'].includes(m.reason), m.reason);
      }
    }
  }
});

test('re-planner: lock keeps chosen stories, realistic uses factor and P80, pull only finishes sooner, handover goes to a colleague in the team', () => {
  const ctx = fresh();
  const a = replan(ctx, { people: ['u1'], fixWeeks: 12 });
  const locked = a.moves.slice(0, 2).map((m) => m.issueId);
  const b = replan(ctx, { people: ['u1'], fixWeeks: 12, lock: locked });
  for (const id of locked) assert.ok(!b.moves.some((m) => m.issueId === id), 'locked stays');
  const real = replan(ctx, { people: ['u1'], realistic: true });
  const p = real.people[0];
  assert.ok(p.factor > 0 && Number.isFinite(p.support));
  const pull = replan(ctx, { people: ['u1'], pull: true, fixWeeks: 12 });
  for (const m of pull.moves.filter((x) => x.reason === 'sooner')) assert.ok(m.to.start < m.from.window[0] && m.to.due <= m.from.window[1], m.key);
  const team = replan(ctx, { team: 't-ux', handover: true, realistic: true, fixWeeks: 12 });
  const people = capacityPeople(ctx.computed.model);
  for (const m of team.moves.filter((x) => x.reason === 'handover')) {
    const iss = ctx.ds.issues.find((i) => i.id === m.issueId);
    assert.ok(m.to.assignee && m.to.assignee !== iss.assignee.id);
    const pp = people.get(m.to.assignee);
    assert.ok((pp.teams || [{ teamId: pp.teamId }]).some((t) => t.teamId === iss.team.id), 'same team');
  }
});

test('the sentences people type route to the missions – and questions do not', () => {
  const ctx = fresh('en');
  for (const q of ['I want you to fix the schedule of my week for me to be at 100% capacity please', 'balance my week', 'Plan my week to full capacity', 'I am overloaded']) {
    const r = routeAct(q, ctx);
    assert.equal(r?.workflow, 'balanceWeek', q);
  }
  const de = fresh('de');
  for (const q of ['Bring meine Woche auf 100 %', 'Plane meine Woche realistisch', 'Ich bin überlastet', 'Ordne meine Woche']) assert.equal(routeAct(q, de)?.workflow, 'balanceWeek', q);
  for (const q of ['Plane Team UX realistisch', 'Verteile die Ressourcen realistisch', 'plan team Web realistically without overtime']) {
    const r = routeAct(q, q.startsWith('plan ') ? ctx : de);
    assert.equal(r?.workflow, 'teamPlan', q);
  }
  assert.equal(routeAct('Plane Team UX realistisch', de).params.team, 't-ux');
  for (const q of ['Wie sieht meine Woche aus?', 'Wie ist meine Auslastung?', 'how is my week planned?', 'Was steht diese Woche an?']) {
    const r = routeAct(q, q.startsWith('how') ? ctx : de);
    assert.ok(!r || r.workflow !== 'balanceWeek', q);
  }
  assert.equal(understand('I want you to fix the schedule of my week for me to be at 100% capacity please', ctx).workflow, 'balanceWeek');
});

for (const lang of ['de', 'en']) {
  test(`"my week at 100 %" end to end (${lang}): diagnosis, decisions, plan, moves, preview, apply, this week fits, undo restores`, async () => {
    const ctx = fresh(lang);
    const io = fakeIo(ctx.ds);
    const before = stable(io.ds);
    const s = await run('balanceWeek', ctx, io, { book: 'book' });
    assert.equal(s.status, 'done');
    const ids = s.steps.map((x) => x.id);
    for (const id of ['story:now', 'order', 'measure', 'extras', 'story:plan', 'story:moves', 'preview', 'cmd:plan', 'summary']) assert.ok(ids.includes(id), `${id} in ${ids}`);
    for (const st of s.steps.filter((x) => x.kind === 'story')) { assert.doesNotThrow(() => validStory(st.story), st.id); assert.deepEqual(selfCheck(st.story), [], `${st.id}: ${st.story.headline}`); }
    assert.deepEqual(unsourced(s), []);
    const cmd = s.steps.find((x) => x.id === 'cmd:plan');
    assert.equal(cmd.status, 'applied');
    assert.ok(io.calls.some(([n]) => n === 'plan.apply'));
    // the written plan: this week (rest) of the signed-in person within 100 %
    const after = lotseCtx(lang, { ds: io.ds });
    const r = replan(after, { people: ['u1'] });
    assert.ok(r.people[0].before[0].util <= 1.005, `this week after apply: ${Math.round(r.people[0].before[0].util * 100)} %`);
    const book = s.steps.find((x) => x.id === 'cmd:book');
    if (book) assert.equal(book.status, 'applied');
    const plan = s.steps.find((x) => x.id === 'story:plan').story;
    assert.equal(plan.visual.kind, 'columns');
    assert.equal(s.steps.find((x) => x.id === 'story:moves').story.visual.kind, 'gantt');
    const text = JSON.stringify(s.steps.map((x) => [x.title, x.question, x.summary, x.note, (x.options || []).map((o) => [o.label, o.detail])]));
    assert.ok(!/undefined|NaN|\[object|rovo/i.test(text));
    const u = await undoAll(s, io);
    assert.ok(!u.undoFailed);
    assert.equal(stable(io.ds), before, 'undoAll restores');
  });
}

test('"my week": keeping the late stories re-plans without them; no plan right → the preview says so and nothing is written', async () => {
  const ctx = fresh();
  const io = fakeIo(ctx.ds);
  const s = await run('balanceWeek', ctx, io, { late: 'keep', extras: ['nothing'] });
  const lateStep = s.steps.find((x) => x.id === 'late');
  if (lateStep) {
    const kept = lateStep.stories.map((x) => x.key);
    const cmd = s.steps.find((x) => x.id === 'cmd:plan');
    const moved = new Set((cmd?.params?.moves || []).map((m) => ctx.ds.issues.find((i) => i.id === m.issue)?.key));
    for (const k of kept) assert.ok(!moved.has(k), `${k} kept`);
  }
  const noPlan = fresh('de', { roles: { rights: ['mine'] } });
  const io2 = fakeIo(noPlan.ds);
  const s2 = await run('balanceWeek', noPlan, io2, { extras: ['nothing'] });
  assert.equal(io2.calls.filter(([n]) => n === 'plan.apply').length, 0);
  const pv = s2.steps.find((x) => x.kind === 'preview');
  assert.ok(pv && pv.warnings.length, 'the preview names the missing right');
});

test('"team realistically" end to end: realistic story, P80 reserve decision, handovers, heat map, preview, apply, undo', async () => {
  const ctx = fresh('de');
  const io = fakeIo(ctx.ds);
  const before = stable(io.ds);
  const s = await run({ id: 'teamPlan', params: { team: 't-ux' } }, ctx, io);
  assert.equal(s.status, 'done');
  for (const st of s.steps.filter((x) => x.kind === 'story')) { assert.doesNotThrow(() => validStory(st.story), st.id); assert.deepEqual(selfCheck(st.story), [], `${st.id}: ${st.story.headline}`); }
  assert.deepEqual(unsourced(s), []);
  assert.equal(s.steps.find((x) => x.id === 'story:plan').story.visual.kind, 'heat');
  const cmd = s.steps.find((x) => x.id === 'cmd:plan');
  if (cmd) assert.equal(cmd.status, 'applied');
  const u = await undoAll(s, io);
  assert.ok(!u.undoFailed);
  assert.equal(stable(io.ds), before);
  // without a team it asks which one first (most overtime recommended)
  const s2 = start('teamPlan', fresh('en'));
  assert.equal(current(s2).id, 'team');
  assert.ok(current(s2).options.some((o) => o.recommended));
});

test('"team realistically" on a team without people with capacity: an honest info story, valid and sourced (live finding)', () => {
  const ctx = fresh('de');
  const ds = ctx.ds;
  ds.teams = [...(ds.teams || []), { id: 't-empty', name: 'Leer' }];
  const c2 = lotseCtx('de', { ds });
  let s = start({ id: 'teamPlan', params: { team: 't-empty' } }, c2);
  for (let g = 0; g < 20 && s.status !== 'done'; g++) { const cur = current(s); if (!cur || cur.kind === 'preview') break; s = cur.kind === 'decide' ? answer(s, cur.id, recommended(cur)) : next(s); }
  for (const st of s.steps.filter((x) => x.kind === 'story')) { assert.doesNotThrow(() => validStory(st.story), st.id); assert.deepEqual(selfCheck(st.story), [], st.id); }
});

test('"my week": a week with planned work but no free time (absence/holidays) is named, never "null %" (live finding)', () => {
  const ds = lotseDataset();
  ds.capacity = { ...(ds.capacity || {}), absences: [...(ds.capacity?.absences || []), { accountId: 'u1', from: '2026-11-16', to: '2026-11-20', type: 'vacation' }] };
  const ctx = lotseCtx('en', { ds });
  const s = start('balanceWeek', ctx);
  const st = s.steps.find((x) => x.id === 'story:now').story;
  const text = JSON.stringify([st.headline, st.findings.map((f) => f.text)]);
  assert.ok(!/null|NaN|Infinity/.test(text), text);
  assert.match(text, /no free time/);
  assert.deepEqual(selfCheck(st), []);
});

test('re-planner on the generated customer dataset (S): for every person every planned week ends within 100 % – measured the cockpit\'s way, per week (live finding: a busy Monday inside a fitting week)', async () => {
  const { bigDataset } = await import('../tools/bigDataset.js');
  const { computeAll } = await import('../shared/engine.js');
  const ds = bigDataset('S');
  const ctx = { ds, computed: computeAll(ds), lang: 'en' };
  let checked = 0;
  for (const pid of capacityPeople(ctx.computed.model).keys()) {
    for (const handover of [false, true]) {
      const r = replan(ctx, { people: [pid], order: 'due', fixWeeks: 12, handover });
      const p = r.people.find((x) => x.id === pid);
      if (!p || r.unplaced.length) continue;
      checked++;
      p.after.forEach((w, i) => assert.ok(!(Number.isFinite(w.util) && w.util > 1.005), `${pid} handover=${handover} week ${i}: ${Math.round(w.util * 100)} %`));
    }
  }
  assert.ok(checked > 100, `checked ${checked}`);
});

test('a story whose start lies after its due date gets a real window – its due week is no longer over 100 % (live finding: PCX-29 start Jan 11, due Dec 15)', () => {
  const ds = lotseDataset();
  const mine = ds.issues.filter((i) => i.role === 'estimate' && i.assignee?.id === 'u4' && i.status?.cat !== 'done' && i.re > 0 && i.due && i.due >= ds.today).slice(0, 2);
  assert.ok(mine.length === 2);
  for (const i of mine) { i.re = 60; i.due = '2026-12-15'; i.start = '2027-01-11'; }
  const ctx = lotseCtx('en', { ds });
  const r = replan(ctx, { people: ['u4'], order: 'due', fixWeeks: 12, handover: false });
  const p = r.people[0];
  for (const i of mine) assert.equal(r.moves.find((m) => m.issueId === i.id)?.reason, 'inverted', i.key);
  if (!r.unplaced.length) p.after.forEach((w, k) => assert.ok(!(Number.isFinite(w.util) && w.util > 1.005), `week ${k}: ${Math.round(w.util * 100)} %`));
  const s = start('balanceWeek', lotseCtx('en', { ds, me: { id: 'u4', name: 'X' } }));
  const st = s.steps.find((x) => x.id === 'story:now').story;
  assert.ok(st.findings.some((f) => /after their due date/.test(f.text)), JSON.stringify(st.findings.map((f) => f.text)));
  assert.deepEqual(selfCheck(st), []);
});

test('"team realistically" on a calm team (nobody over 100 %): a valid story that says there is nothing to relieve (live finding 2026-11-17)', () => {
  const ds = lotseDataset();
  ds.teams = [...(ds.teams || []), { id: 't-calm', name: 'Ruhig' }];
  ds.capacity = { ...(ds.capacity || {}), people: { ...(ds.capacity?.people || {}), calm1: { weeklyHours: 40, location: 'DE', teamId: 't-calm' } } };
  ds.people = { ...(ds.people || {}), calm1: { id: 'calm1', name: 'Clara Ruhig', avatar: null } };
  const c2 = lotseCtx('de', { ds });
  let s = start({ id: 'teamPlan', params: { team: 't-calm' } }, c2);
  for (let g = 0; g < 20 && s.status !== 'done'; g++) { const cur = current(s); if (!cur || cur.kind === 'preview') break; s = cur.kind === 'decide' ? answer(s, cur.id, recommended(cur)) : next(s); }
  const stories = s.steps.filter((x) => x.kind === 'story');
  assert.ok(stories.length > 0);
  for (const st of stories) { assert.doesNotThrow(() => validStory(st.story), st.id); assert.deepEqual(selfCheck(st.story), [], `${st.id}: ${st.story.headline}`); }
  const plan = s.steps.find((x) => x.id === 'story:plan')?.story;
  if (plan) assert.ok(plan.findings.some((f) => /nichts zu entlasten/.test(f.text)), JSON.stringify(plan.findings.map((f) => f.text)));
});

// ---------- closures (user 2026-11-17: "Today it was snowing heavily and work was cancelled for the week, let's rearrange the plan") ----------
test('"Ausfall": the snow sentence routes to the mission; the closure is recorded, the plan moved – and undo restores both exactly', async () => {
  const ctx = fresh('de');
  for (const q of ['Heute hat es stark geschneit und die Arbeit ist für die Woche ausgefallen, lass uns den Plan neu ordnen', 'Today it was snowing heavily and work was cancelled for the week, lets rearrange the plan']) {
    const r = routeAct(q, ctx);
    assert.equal(r?.workflow, 'disruption', q);
    assert.equal(r.params.period, 'week');
  }
  const io = fakeIo(ctx.ds);
  const before = stable(io.ds);
  const s = await run({ id: 'disruption', params: { period: 'week', scope: 'all' } }, ctx, io);
  assert.equal(s.status, 'done');
  for (const st of s.steps.filter((x) => x.kind === 'story')) { assert.doesNotThrow(() => validStory(st.story), st.id); assert.deepEqual(selfCheck(st.story), [], `${st.id}: ${st.story.headline}`); }
  assert.deepEqual(unsourced(s), []);
  const closure = s.steps.find((x) => x.id === 'cmd:closure');
  assert.equal(closure?.status, 'applied');
  const added = io.ds.capacity.absences.filter((a) => /^closure-/.test(a.id));
  assert.ok(added.length > 0 && added.every((a) => a.type === 'absent' && a.from <= a.to));
  // nobody became a maintained person through the closure (derived people stay derived)
  assert.deepEqual(Object.keys(io.ds.capacity.people).sort(), Object.keys(ctx.ds.capacity.people).sort());
  const u = await undoAll(s, io);
  assert.ok(!u.undoFailed);
  assert.equal(stable(io.ds), before);
});

test('"Ausfall": who and which days are asked when the sentence does not say; without work in those days nothing moves', () => {
  const ctx = fresh('en');
  const s = start({ id: 'disruption', params: {} }, ctx);
  assert.equal(current(s).id, 'period');
  assert.ok(current(s).options.some((o) => o.id === 'week' && o.recommended));
});

test('"Jahres-Check": valid, every number sourced, routes from DE and EN', () => {
  const ctx = fresh('de');
  for (const q of ['Prüfe den Jahresplan', 'Check the year plan for conflicts', 'Jahresprognose Kundenportal Relaunch']) assert.equal(understand(q, ctx)?.skill, 'yearCheck', q);
});

// E2E audit 2026-11-17: a closure re-plans with minimal change – only work in the closure's weeks moves, only the
// overload the closure itself causes is resolved, and the result never leaves anyone more loaded than before.
test('"Ausfall": minimal change – one lost day moves few stories, all from the closure week; nobody ends up more over', async () => {
  const { periodRange } = await import('../shared/lotse/act/missionsDisrupt.js');
  const { computeAll } = await import('../shared/engine.js');
  const { isoOf, mondayOf } = await import('../shared/dates.js');
  const moved = {};
  for (const period of ['tomorrow', 'week']) {
    const ctx = fresh('de');
    const io = fakeIo(ctx.ds);
    const before = JSON.parse(JSON.stringify(ctx.ds.issues));
    const s = await run({ id: 'disruption', params: { period, scope: 'all' } }, ctx, io);
    assert.equal(s.status, 'done');
    const [a] = periodRange(period, ctx.computed.model.today);
    const weekA = mondayOf(a), weekB = weekA + 6;
    const changed = io.ds.issues.filter((i, k) => i.start !== before[k].start || i.due !== before[k].due);
    moved[period] = changed.length;
    // every moved story had work in the closure week (its old window touched it, or it was overdue/undated there)
    for (const i of changed) {
      const o = before.find((x) => x.id === i.id);
      // the engine's window: no start = from today; undated / overdue work sits on the next working day
      const from = o.start || isoOf(ctx.computed.model.today), to = o.due;
      assert.ok(!to || !from || (from <= isoOf(weekB) && to >= isoOf(weekA)) || to < isoOf(ctx.computed.model.today), `${i.key} ${from}..${to} was not in the closure week`);
    }
    // nobody more loaded than with the closure alone (the cockpit's own weekly numbers)
    const closureOnly = { ...ctx.ds, capacity: io.ds.capacity };
    const w1 = weeksUtilization(computeAll(closureOnly).model, computeAll(closureOnly).support, 12);
    const c2 = computeAll(io.ds);
    const w2 = weeksUtilization(c2.model, c2.support, 12);
    for (const t of w2.teams) for (const m of t.members) {
      const m1 = w1.teams.find((x) => x.teamId === t.teamId)?.members.find((x) => x.id === m.id);
      if (!m1) continue;
      m.plan.forEach((h, i) => {
        const u0 = m1.cap[i] > 0.05 ? m1.plan[i] / m1.cap[i] : 0, u1 = m.cap[i] > 0.05 ? h / m.cap[i] : 0;
        assert.ok(u1 <= Math.max(u0, 1) + 0.02, `${period} ${m.id} week ${i}: ${u0} → ${u1}`);
      });
    }
  }
  assert.ok(moved.tomorrow <= moved.week, `one day moves no more than the rest of the week (${moved.tomorrow} vs ${moved.week})`);
  assert.ok(moved.week < 30, `minimal change: ${moved.week} stories moved`);
});
