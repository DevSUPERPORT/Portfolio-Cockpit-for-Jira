// People in several teams (user 2026-11-17): Lotse finds every multi-team conflict with the cockpit's own numbers and
// resolves it – re-plan across all the person's teams by rank, hand-overs, Team field, shares – and the result is checked
// with the same check before anything is shown, and again on the written data here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotseCtx, lotseDataset } from './lotseFixture.js';
import { computeAll, capacityPeople, weeksUtilization } from '../shared/engine.js';
import { splitConflicts, realConflicts, sharesFromHours } from '../shared/splitPeople.js';
import { start, answer, next, applyStep, undoAll, current, routeAct } from '../shared/lotse/act/index.js';
import { fakeIo } from '../shared/lotse/act/fakeIo.js';
import { validStory, selfCheck, understand, run } from '../shared/lotse/index.js';

async function drive(ctx, goal, io) {
  let s = start(goal, ctx);
  const stories = [];
  for (let g = 0; s.status !== 'done' && g < 80; g++) {
    const cur = current(s);
    if (cur.kind === 'story') { stories.push(cur.story); s = next(s); } else if (cur.kind === 'summary') s = next(s);
    else if (cur.kind === 'decide') s = answer(s, cur.id, (cur.options.find((o) => o.recommended && !o.disabled) || cur.options.find((o) => !o.disabled)).id);
    else if (cur.kind === 'preview') s = answer(s, cur.id, 'apply');
    else if (cur.kind === 'command') s = await applyStep(s, io);
  }
  return { s, stories };
}
const kinds = (list) => list.reduce((m, x) => ((m[x.kind] = (m[x.kind] || 0) + 1), m), {});

// one person split 50/50 over UX and Mobile who only gets UX work – Mobile counts 50 % of a person that is not there
function phantomCase() {
  const ds = lotseDataset();
  const pid = Object.keys(ds.capacity.people)[0];
  ds.capacity.people[pid] = { ...ds.capacity.people[pid], weeklyHours: 40, teamId: 't-ux', teams: [{ teamId: 't-ux', pct: 50 }, { teamId: 't-mob', pct: 50 }] };
  let k = 0;
  for (const i of ds.issues) {
    if (i.assignee?.id !== pid || i.role !== 'estimate' || i.status?.cat === 'done') continue;
    if (k++ < 2) Object.assign(i, { team: { id: 't-ux', name: 'UX' }, start: '2026-11-16', due: '2027-01-29', re: 120, oe: 120 });
    else i.status = { ...i.status, cat: 'done', name: 'Done' };
  }
  return { ds, pid };
}

test('detector: a team taking more than its share is found, with the phantom hours the other team counts and fitting shares', () => {
  const { ds, pid } = phantomCase();
  const c = computeAll(ds);
  const r = splitConflicts(c.model, c.support, { only: new Set([pid]) });
  const p = r.people.find((x) => x.id === pid);
  const d = p.conflicts.find((x) => x.kind === 'shareDrift');
  assert.ok(d, JSON.stringify(kinds(p.conflicts)));
  assert.equal(d.takers[0].teamId, 't-ux');
  assert.equal(d.givers[0].teamId, 't-mob');
  assert.ok(d.givers[0].phantom > 8 && r.phantomByTeam['t-mob'] === d.givers[0].phantom);
  assert.deepEqual(d.suggested.map((x) => x.teamId), ['t-ux', 't-mob']);
  assert.equal(d.suggested.reduce((a, x) => a + x.pct, 0), 100);
  assert.ok(d.suggested.every((x) => x.pct >= 5 && x.pct % 5 === 0));
  // the same hours the Teams tab counts: the person's plan is the engine's
  const wu = weeksUtilization(c.model, c.support, 12);
  const m = wu.teams.find((t) => t.teamId === 't-ux').members.find((x) => x.id === pid);
  m.plan.forEach((h, w) => assert.ok(Math.abs(h - p.total[w]) < 1e-6, `week ${w}`));
});

test('sharesFromHours: multiples of 5, at least 5 % per member team, exactly 100; nothing without hours or for one team', () => {
  assert.deepEqual(sharesFromHours({ a: 90, b: 10 }, ['a', 'b']), [{ teamId: 'a', pct: 90 }, { teamId: 'b', pct: 10 }]);
  assert.deepEqual(sharesFromHours({ a: 100 }, ['a', 'b']), [{ teamId: 'a', pct: 95 }, { teamId: 'b', pct: 5 }]);
  const three = sharesFromHours({ a: 1, b: 1, c: 1 }, ['a', 'b', 'c']);
  assert.equal(three.reduce((s, x) => s + x.pct, 0), 100);
  assert.equal(sharesFromHours({}, ['a', 'b']), null);
  assert.equal(sharesFromHours({ a: 5 }, ['a']), null);
});

test('mission, phantom case: the shares follow the work; after applying no team counts phantom capacity; undo restores', async () => {
  const { ds, pid } = phantomCase();
  const ctx = lotseCtx('de', { ds });
  const io = fakeIo(ctx.ds);
  const before = JSON.stringify(io.ds.capacity);
  const { s, stories } = await drive(ctx, { id: 'splitResolve', params: { person: pid, mode: 'auto' } }, io);
  assert.equal(s.status, 'done');
  for (const st of stories) { assert.doesNotThrow(() => validStory(st)); assert.deepEqual(selfCheck(st), [], st.headline); }
  assert.ok(io.calls.some(([n]) => n === 'capacity.save'), 'shares written');
  const saved = io.ds.capacity.people[pid];
  assert.equal(saved.weeklyHours, 40, 'weekly hours stay');
  assert.ok(saved.teams.find((x) => x.teamId === 't-ux').pct > 50);
  const c2 = computeAll(io.ds);
  const r2 = splitConflicts(c2.model, c2.support, { only: new Set([pid]) });
  assert.deepEqual(realConflicts(r2), [], JSON.stringify(kinds(realConflicts(r2))));
  assert.equal(r2.phantomByTeam['t-mob'] || 0, 0);
  const u = await undoAll(s, io);
  assert.ok(!u.undoFailed);
  assert.equal(JSON.stringify(io.ds.capacity), before);
});

test('mission on the whole demo portfolio (auto): every conflict resolved – checked again on the WRITTEN data – and one undo restores Jira', async () => {
  const ctx = lotseCtx('de', { ds: lotseDataset() });
  const c0 = ctx.computed;
  const n0 = realConflicts(splitConflicts(c0.model, c0.support)).length;
  assert.ok(n0 > 10, 'the demo has multi-team conflicts');
  const io = fakeIo(ctx.ds);
  const issues0 = JSON.stringify(io.ds.issues);
  const { s, stories } = await drive(ctx, { id: 'splitResolve', params: { mode: 'auto' } }, io);
  assert.equal(s.status, 'done');
  for (const st of stories) { assert.doesNotThrow(() => validStory(st)); assert.deepEqual(selfCheck(st), [], st.headline); }
  const after = stories.find((x) => x.id === 'splitResolve:after');
  assert.match(after.headline, /→ 0 Konflikte/);
  const c2 = computeAll(io.ds);
  assert.deepEqual(kinds(realConflicts(splitConflicts(c2.model, c2.support))), {}, 'nothing left on the written data');
  // nobody is above 100 % in a week where they were fine before (the re-planner measures the whole person)
  const w0 = weeksUtilization(c0.model, c0.support, 12), w2 = weeksUtilization(c2.model, c2.support, 12);
  const util = (wu) => { const m = new Map(); for (const t of wu.teams) for (const x of t.members) m.set(x.id, x); return m; };
  const u0 = util(w0), u2 = util(w2);
  for (const [id, x] of u2) { const y = u0.get(id); if (!y) continue; x.plan.forEach((h, i) => { const a = y.cap[i] > 0.05 ? y.plan[i] / y.cap[i] : 0, b = x.cap[i] > 0.05 ? h / x.cap[i] : 0; assert.ok(b <= Math.max(a, 1) + 0.02, `${id} week ${i}: ${a} → ${b}`); }); }
  const u = await undoAll(s, io);
  assert.ok(!u.undoFailed);
  assert.equal(JSON.stringify(io.ds.issues), issues0, 'one undo restores every work item');
});

test('Lotse understands it: the check as a question, the mission as an instruction (DE/EN); setShares refuses non-members and bad sums', async () => {
  const ctx = lotseCtx('de', { ds: lotseDataset() });
  for (const q of ['Wer ist doppelt verplant?', 'Check the people in two teams', 'Mehrteam-Check für Web']) assert.equal(understand(q, ctx)?.skill, 'splitCheck', q);
  for (const q of ['Löse die Mehrteam-Konflikte', 'Fix the double-booked people in two teams', 'Bitte Mehrteam-Konflikte beheben']) assert.equal(routeAct(q, ctx)?.workflow, 'splitResolve', q);
  for (const L of ['de', 'en']) { const st = run('splitCheck', {}, lotseCtx(L, { ds: lotseDataset() })); validStory(st); assert.deepEqual(selfCheck(st), []); }
  const { COMMANDS } = await import('../shared/lotse/act/commands.js');
  const cmd = COMMANDS['capacity.setShares'];
  const pid = Object.keys(ctx.ds.capacity.people)[0];
  assert.throws(() => cmd.validate({ person: pid, teams: [{ teamId: 't-ux', pct: 60 }, { teamId: 't-mob', pct: 30 }] }, ctx), /teams/);
  assert.throws(() => cmd.validate({ person: pid, teams: [{ teamId: 't-ux', pct: 100 }] }, ctx), /teams/);
  assert.deepEqual(cmd.validate({ person: pid, teams: [{ teamId: 't-ux', pct: 70 }, { teamId: 't-mob', pct: 30 }] }, ctx).teams.length, 2);
  // with Atlassian Teams: only teams the person is a member of
  const ds = lotseDataset();
  ds.atlTeams = { at: 1, status: 'ok', teams: { 't-ux': { name: 'UX', members: [{ accountId: pid, name: 'P' }] }, 't-mob': { name: 'Mobile', members: [] } } };
  const ctxA = lotseCtx('de', { ds });
  assert.throws(() => cmd.validate({ person: pid, teams: [{ teamId: 't-ux', pct: 70 }, { teamId: 't-mob', pct: 30 }] }, ctxA), /member/);
  assert.ok(capacityPeople(ctxA.computed.model).get(pid));
});

test('team briefing names phantom capacity; the daily briefing raises multi-team conflicts by itself', async () => {
  const { ds, pid } = phantomCase();
  const ctx = lotseCtx('de', { ds });
  const tb = run('teamBrief', { team: 't-mob' }, ctx);
  validStory(tb);
  assert.deepEqual(selfCheck(tb), []);
  assert.ok(tb.findings.some((f) => /scheinbar frei/.test(f.text)), tb.findings.map((f) => f.text).join(' | '));
  const { todayStories } = await import('../shared/lotse/skills/today.js');
  const mgmt = todayStories({ ...ctx, me: { id: 'boss' }, roles: { viewReport: true } }, 'management', 'de');
  assert.ok(mgmt.some((x) => x.skill === 'splitCheck'), mgmt.map((x) => x.skill).join(','));
  assert.ok(pid);
});
