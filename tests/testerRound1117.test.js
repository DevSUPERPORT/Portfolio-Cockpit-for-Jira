// Tester round 2026-11-17: start after due is flagged; reassigning shows load and offers the team; dependency
// conflicts have actions; Lotse answers an issue key with where and when it is planned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotseDataset } from './lotseFixture.js';
import { computeAll, actionItems } from '../shared/engine.js';

test('start after due: a data-quality gap and the first "action needed" item of its project', () => {
  const ds = lotseDataset();
  const s = ds.issues.find((i) => i.role === 'estimate' && i.status?.cat !== 'done' && i.start && i.due);
  s.start = '2026-12-28'; s.due = '2026-12-15';
  const c = computeAll(ds);
  const g = c.dq.gaps.find((x) => x.issueId === s.id && x.rule === 'datesInverted');
  assert.ok(g && g.severity === 'gap' && g.start === '2026-12-28');
  const item = c.model.itemByRef.get(s.rootRef);
  const acts = actionItems(c.model, item, c.metrics.get(item.ref), c.wl, c.deps, c.dq);
  assert.equal(acts[0].kind, 'dates');
  assert.equal(acts[0].key, s.key);
});

test('reassign to someone of another team: the team can move along – staged, sent, validated, undone like the rest', async () => {
  const { moveTask, applyMoves, planPayload, validatePlanMoves, pendingRows, buildBoard, rebaseMove } = await import('../shared/weekPlan.js');
  const ds = lotseDataset();
  const c = computeAll(ds);
  const s = ds.issues.find((i) => i.role === 'estimate' && i.status?.cat !== 'done' && i.team?.id && i.assignee?.id);
  const other = ds.teams.find((t) => t.id !== s.team.id);
  let mv = moveTask({}, s, { assignee: 'u-x', assigneeName: 'X', team: other.id, teamName: other.name });
  assert.equal(applyMoves(ds.issues, mv).find((i) => i.id === s.id).team.id, other.id);
  const row = pendingRows(mv)[0];
  assert.deepEqual(row.team.map((x) => x.id), [s.team.id, other.id]);
  const pay = planPayload(mv);
  assert.deepEqual(pay[0], { issueId: s.id, assignee: 'u-x', team: other.id });
  assert.deepEqual(validatePlanMoves({ moves: pay }), pay);
  assert.throws(() => validatePlanMoves({ moves: [{ issueId: s.id, team: 'bad team!' }] }), /team invalid/);
  // back to the original team and person → the move disappears; a date-only move keeps the team
  assert.deepEqual(moveTask(mv, s, { assignee: s.assignee.id, assigneeName: s.assignee.name, team: s.team.id, teamName: s.team.name }), {});
  const dateOnly = moveTask({}, s, { weeks: 1 });
  assert.equal(pendingRows(dateOnly)[0].team, null);
  assert.equal(planPayload(dateOnly)[0].team, undefined);
  // a partial write of the team rebases it
  mv = rebaseMove(mv, s.id, { team: other.id });
  assert.equal(pendingRows(mv)[0].team, null);
  // the board moves the task to the other team's board
  const b = buildBoard({ ds, computed: c, team: other.id, moves: moveTask({}, s, { team: other.id, teamName: other.name }) });
  assert.ok(!b.taskById.get(s.id) || b.taskById.get(s.id).teamId === other.id);
  // every person's week loads for the picker
  const wk = buildBoard({ ds, computed: c, team: s.team.id }).personWeeks(s.assignee.id);
  assert.equal(wk.length, 8);
  assert.ok(wk.every((x) => Number.isFinite(x.load) && Number.isFinite(x.avail)));
});

test('blocks conflict where the dependent story has no start date: a fix is offered (start after the prerequisite)', async () => {
  const { fixFor } = await import('../shared/weekPlan.js');
  const f = fixFor({ pre: { due: '2026-11-20' }, dep: { id: '7', internal: true, start: null, due: '2026-11-19' } }); // Fri → Mon
  assert.deepEqual(f, { issueId: '7', start: '2026-11-23', due: '2026-11-23', startOnly: true });
  const g = fixFor({ pre: { due: '2026-11-20' }, dep: { id: '7', internal: true, start: null, due: '2026-12-04' } });
  assert.equal(g.due, '2026-12-04', 'a later due date stays');
  assert.equal(fixFor({ pre: { due: '2026-11-20' }, dep: { id: '7', internal: false, start: null } }), null, 'external items are never moved');
});

test('Lotse: a bare work item key answers where and when it is planned; "estimate like before" still estimates', async () => {
  const { lotseCtx } = await import('./lotseFixture.js');
  const L = await import('../shared/lotse/index.js');
  for (const lang of ['de', 'en']) {
    const ctx = lotseCtx(lang, { ds: lotseDataset() });
    const i = ctx.ds.issues.find((x) => x.role === 'estimate' && x.status?.cat !== 'done' && x.oe > 0 && x.start && x.due);
    for (const q of [i.key, `Wo steht ${i.key}?`, `When is ${i.key} planned?`]) assert.equal(L.understand(q, ctx)?.skill, 'ticket', q);
    assert.equal(L.understand(`Schätze wie früher: ${i.key}`, ctx)?.skill, 'estimate');
    const s = L.run('ticket', { key: i.key }, ctx);
    L.validStory(s);
    assert.deepEqual(L.selfCheck(s), []);
    assert.match(s.headline, new RegExp(i.key));
    assert.ok(s.followUps.some((f) => f.text.includes(i.key)), 'estimating is one follow-up away');
  }
});
