// Wochenplanung (UC-05): spreading, moves by weeks and person, refused drops, availability, blocks conflicts + fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAll } from '../shared/engine.js';
import {
  buildBoard, planWeeks, shiftDates, moveTask, undoMove, rebaseMove, applyMoves, planPayload, pendingRows, planDrop,
  conflicts, fixFor, validatePlanMoves, personWeekAvail, personSummary, canPlan, MAX_MOVES,
} from '../shared/weekPlan.js';

const st = { name: 'Offen', cat: 'new' };
const story = (o) => ({ role: 'estimate', status: st, links: [], worklogs: [], parentId: o.rootRef.slice(6), ...o });
// Today is Wednesday 11 Nov 2026; week 0 starts Monday 9 Nov.
function fixture() {
  return {
    today: '2026-11-11',
    config: { dependencies: { linkTypeIds: ['10000'] } },
    portfolio: [
      { ref: 'issue:1', rank: 1, kind: 'issue', id: '1', key: 'P-1', name: 'Alpha', statusCat: 'indeterminate' },
      { ref: 'issue:2', rank: 2, kind: 'issue', id: '2', key: 'P-2', name: 'Beta', statusCat: 'indeterminate' },
    ],
    teams: [{ id: 't1', name: 'Web' }, { id: 't2', name: 'Data' }],
    people: { u1: { name: 'Anna' }, u2: { name: 'Ben' }, u3: { name: 'Cleo' } },
    capacity: {
      people: { u1: { weeklyHours: 40, location: 'NONE', teamId: 't1' }, u2: { weeklyHours: 40, location: 'DE', teamId: 't1' }, u3: { weeklyHours: 40, location: 'NONE', teamId: 't2' } },
      absences: [{ accountId: 'u2', from: '2026-11-23', to: '2026-11-24' }],
      teams: { t1: { dailyBusinessPct: 0, internalPct: 0 }, t2: { dailyBusinessPct: 20, internalPct: 0 } },
    },
    supportComputed: { personWeekly: { u1: 5 }, teams: [], services: [], reserveQuarter: {} },
    issues: [
      // A blocks B (link type 10000); A is due Fri 20 Nov, B starts Mon 16 Nov → conflict
      story({ id: '101', key: 'A-1', summary: 'API', team: { id: 't1' }, assignee: { id: 'u1', name: 'Anna' }, oe: 40, re: 40, start: '2026-11-09', due: '2026-11-20', rootRef: 'issue:1', links: [{ id: 'L1', typeId: '10000', outward: true, otherId: '102', verb: 'blocks' }] }),
      story({ id: '102', key: 'B-1', summary: 'UI', team: { id: 't1' }, assignee: { id: 'u2', name: 'Ben' }, oe: 16, re: 16, start: '2026-11-16', due: '2026-11-17', rootRef: 'issue:1', links: [{ id: 'L1', typeId: '10000', outward: false, otherId: '101', verb: 'blocks' }] }),
      story({ id: '103', key: 'C-1', summary: 'Docs', team: { id: 't1' }, assignee: null, oe: 10, re: 10, start: '2026-11-23', due: '2026-11-27', rootRef: 'issue:2' }),
      story({ id: '104', key: 'D-1', summary: 'ETL', team: { id: 't2' }, assignee: { id: 'u1', name: 'Anna' }, oe: 5, re: 5, start: '2026-11-09', due: '2026-11-13', rootRef: 'issue:2' }),
      story({ id: '105', key: 'E-1', summary: 'Done', team: { id: 't1' }, assignee: { id: 'u1', name: 'Anna' }, oe: 99, re: 0, start: '2026-11-09', due: '2026-11-13', rootRef: 'issue:1', status: { name: 'Fertig', cat: 'done' } }),
    ],
  };
}
const setup = (mut) => { const ds = fixture(); mut?.(ds); return { ds, computed: computeAll(ds) }; };
const row = (b, id) => b.rows.find((r) => r.id === id);
const cardIn = (cell, key) => cell.cards.find((c) => c.key === key);

test('8 ISO weeks from the current week, Monday to Friday', () => {
  const w = planWeeks('2026-11-11');
  assert.equal(w.length, 8);
  assert.equal(w[0].from, '2026-11-09');
  assert.equal(w[0].to, '2026-11-13');
  assert.equal(w[0].current, true);
  assert.equal(w[7].from, '2026-12-28');
});

test('spreading: Original Estimate evenly over the working weeks between start and due', () => {
  const { ds, computed } = setup();
  const b = buildBoard({ ds, computed, team: 't1' });
  const anna = row(b, 'p:u1');
  const a0 = cardIn(anna.cells[0], 'A-1'), a1 = cardIn(anna.cells[1], 'A-1');
  assert.equal(a0.hours, 20); assert.equal(a1.hours, 20);
  assert.deepEqual([a0.idx, a0.len, a1.idx], [1, 2, 2], 'card shows i / len');
  assert.equal(cardIn(anna.cells[2], 'A-1'), undefined);
  assert.equal(b.taskById.has('105'), false, 'done work items are not planned');
  // support card first and not a task; other team's work as one quiet card, counted in the load
  assert.equal(anna.cells[0].cards[0].kind, 'support');
  assert.equal(anna.cells[0].cards.at(-1).kind, 'other');
  assert.equal(anna.cells[0].load, 5 + 20 + 5);
  assert.equal(anna.cells[0].util, 30 / 40);
  assert.equal(anna.cells[0].tone, 'ok');
  // the 8-week summary adds up in hours and percent
  const s = anna.summary;
  assert.equal(s.nominal, 320);
  assert.equal(s.support, 40);
  assert.equal(s.projects, 45);
  assert.equal(s.nominal - s.off - s.daily - s.support - s.projects, s.free);
  assert.equal(s.pct.off + s.pct.daily + s.pct.support + s.pct.projects + s.pct.free, 100);
  assert.ok(row(b, 'u').cells[2].cards.some((c) => c.key === 'C-1'), 'unassigned row');
});

test('holidays and absences reduce availability; daily business comes off', () => {
  const { ds, computed } = setup();
  const b = buildBoard({ ds, computed, team: 't1' });
  const ben = row(b, 'p:u2');
  assert.equal(ben.cells[2].avail, 24, '2 days absent');
  assert.equal(ben.cells[2].absent, 2);
  assert.equal(ben.cells[6].avail, 32, 'Christmas (DE)');
  assert.equal(ben.cells[6].holidays, 1);
  assert.equal(ben.summary.absentDays, 2);
  assert.equal(ben.summary.off, 16 + 8 + 8, 'absent + holidays (Christmas, New Year)');
  const cleo = personWeekAvail(computed.model, { id: 'u3', weeklyHours: 40, location: 'NONE', teamId: 't2' }, b.weeks[0].a, b.weeks[0].b, 0);
  assert.equal(cleo.avail, 32, '20 % daily business');
  assert.equal(cleo.daily, 8);
  // fully absent week: no capacity and no support either
  const away = personWeekAvail(computed.model, { id: 'u1', weeklyHours: 40, location: 'NONE', teamId: 't1' }, b.weeks[0].a, b.weeks[0].b, 5);
  assert.equal(away.support, 5);
  const { ds: ds2, computed: c2 } = setup((d) => d.capacity.absences.push({ accountId: 'u1', from: '2026-11-09', to: '2026-11-13' }));
  const anna = row(buildBoard({ ds: ds2, computed: c2, team: 't1' }), 'p:u1');
  assert.equal(anna.cells[0].avail, 0);
  assert.equal(anna.cells[0].support, 0);
  assert.equal(anna.cells[0].util, Infinity, 'work planned while away');
  assert.equal(anna.over >= 1, true);
  const sum = personSummary([{ weekly: 40, nominal: 40, off: 40, daily: 0, support: 0, absent: 5, holidays: 0 }], [0]);
  assert.equal(sum.free, 0);
});

test('shift by weeks keeps the duration and stays on working days', () => {
  assert.deepEqual(shiftDates({ start: '2026-11-09', due: '2026-11-20' }, 2), { start: '2026-11-23', due: '2026-12-04' });
  assert.deepEqual(shiftDates({ start: '2026-11-09', due: '2026-11-20' }, -1), { start: '2026-11-02', due: '2026-11-13' });
  assert.deepEqual(shiftDates({ start: '2026-11-14', due: '2026-11-15' }, 1), { start: '2026-11-23', due: '2026-11-23' }, 'weekend dates move inside the task');
  assert.deepEqual(shiftDates({ start: null, due: '2026-11-20' }, 1), { start: null, due: '2026-11-27' });
  // live bug (tester, 2026-11-11): PCX-27 has start Sun 20.12. AFTER due Tue 15.12.; the board shows it in KW51 (window
  // 15.–20.12.). Dropped on KW46 (−5 weeks) it landed in KW47, because the Sunday start rolled forward to Mon 16.11.
  // Now the move works on the board's window: start Tue 10.11., due Fri 13.11. – both in KW46, start before due.
  assert.deepEqual(shiftDates({ start: '2026-12-20', due: '2026-12-15' }, -5), { start: '2026-11-10', due: '2026-11-13' });
  assert.deepEqual(shiftDates({ start: '2026-12-20', due: '2026-12-15' }, 1), { start: '2026-12-22', due: '2026-12-25' });
  // the second move (dates now in order) behaves the same as before
  assert.deepEqual(shiftDates({ start: '2026-11-10', due: '2026-11-13' }, 2), { start: '2026-11-24', due: '2026-11-27' });
});

test('moving a card: dates shift, assignee changes, nothing written until applied', () => {
  const { ds, computed } = setup();
  const A = ds.issues[0];
  let moves = moveTask({}, A, { weeks: 1 });
  assert.deepEqual([moves['101'].start, moves['101'].due], ['2026-11-16', '2026-11-27']);
  assert.equal(ds.issues[0].start, '2026-11-09', 'the dataset is untouched');
  moves = moveTask(moves, A, { assignee: 'u2', assigneeName: 'Ben' });
  assert.deepEqual(planPayload(moves), [{ issueId: '101', start: '2026-11-16', due: '2026-11-27', assignee: 'u2' }]);
  const pr = pendingRows(moves)[0];
  assert.deepEqual(pr.start, ['2026-11-09', '2026-11-16']);
  assert.deepEqual(pr.assignee.map((x) => x.id), ['u1', 'u2']);
  const eff = applyMoves(ds.issues, moves);
  assert.equal(eff[0].assignee.id, 'u2');
  // the board: dashed card at the new place, faded ghost at the old one
  const b = buildBoard({ ds, computed, team: 't1', moves });
  const ben = row(b, 'p:u2'), anna = row(b, 'p:u1');
  assert.equal(cardIn(ben.cells[1], 'A-1').pending, true);
  assert.equal(cardIn(ben.cells[2], 'A-1').hours, 20);
  assert.equal(anna.cells[0].ghosts[0].key, 'A-1');
  assert.equal(anna.cells[0].ghosts[0].ghost, true);
  assert.equal(cardIn(anna.cells[0], 'A-1'), undefined);
  assert.equal(b.pending, 1);
  // moving back to the original removes the pending move; undo drops it too
  const back = moveTask(moveTask(moves, A, { weeks: -1 }), A, { assignee: 'u1', assigneeName: 'Anna' });
  assert.deepEqual(back, {});
  assert.deepEqual(undoMove(moves, '101'), {});
  // a partial write: the written dates become the new base, the assignee stays pending
  const rest = rebaseMove(moves, '101', { start: '2026-11-16', due: '2026-11-27' });
  assert.deepEqual(planPayload(rest), [{ issueId: '101', assignee: 'u2' }]);
});

test('drops: week shift, person change with team warning, refused support / other project / overview', () => {
  const { ds, computed } = setup();
  const b = buildBoard({ ds, computed, team: 't1' });
  assert.deepEqual(planDrop(b, { id: '101', fromWeek: 0, toRow: 'p:u1', toWeek: 2 }), { ok: true, weeks: 2, warn: null });
  const toBen = planDrop(b, { id: '101', fromWeek: 1, toRow: 'p:u2', toWeek: 1 });
  assert.equal(toBen.assignee, 'u2'); assert.equal(toBen.weeks, 0);
  assert.equal(planDrop(b, { id: '101', fromWeek: 1, toRow: 'u', toWeek: 1 }).assignee, null, 'unassign');
  assert.equal(planDrop(b, { id: '101', fromWeek: 1, toRow: 'p:u1', toWeek: 1 }).noop, true);
  assert.equal(planDrop(b, { id: '101', fromWeek: 0, toRow: 'p:u1', toWeek: 1, canEdit: false }).reason, 'readonly');
  // a person of another team: allowed, with a warning
  const pb = buildBoard({ ds, computed, project: 'issue:2' });
  const cleoRow = { id: 'p:u3', kind: 'person', accountId: 'u3', name: 'Cleo' };
  const warn = planDrop({ ...b, rows: [...b.rows, cleoRow] }, { id: '101', fromWeek: 0, toRow: 'p:u3', toWeek: 0 });
  assert.equal(warn.ok, true); assert.equal(warn.warn, 'notInTeam');
  assert.ok(pb.rows.some((r) => r.id === 'p:u1'), 'project board: people working on it');
  // projects mode: support and other projects refuse
  const pj = buildBoard({ ds, computed, team: 't1', mode: 'projects' });
  assert.deepEqual(pj.rows.map((r) => r.id), ['s', 'r:issue:1', 'r:issue:2'], 'support first, then rank order');
  assert.equal(planDrop(pj, { id: '101', fromWeek: 0, toRow: 's', toWeek: 0 }).reason, 'support');
  assert.equal(planDrop(pj, { id: '101', fromWeek: 0, toRow: 'r:issue:2', toWeek: 0 }).reason, 'project');
  assert.equal(planDrop(pj, { id: '101', fromWeek: 0, toRow: 'r:issue:1', toWeek: 1 }).weeks, 1);
  // projects consume what support and higher ranks leave
  assert.equal(pj.rows[0].cells[0].load, 5);
  // Anna (t1 only) spends 5 h on a t2 task (D-1) this week: t1 cannot count those 5 h (boss 2026-11-20 – one person-week, one number)
  assert.equal(pj.rows[1].cells[0].avail, 80 - 5 - 5);
  assert.equal(pj.rows[2].cells[1].avail, 80 - 5 - 36);
  // all teams: one row per team, read-only
  const all = buildBoard({ ds, computed });
  assert.equal(all.kind, 'teams');
  assert.deepEqual(all.rows.map((r) => r.name), ['Data', 'Web']);
  assert.equal(row(all, 't:t1').cells[0].cards.length, 2, 'one mini card per member');
  assert.equal(planDrop(all, { id: '101', fromWeek: 0, toRow: 't:t1', toWeek: 1 }).reason, 'readonly');
});

test('blocks conflict on the effective dates, with a fix to the week after the due date', () => {
  const { ds, computed } = setup();
  const b = buildBoard({ ds, computed, team: 't1' });
  assert.equal(b.conflicts.length, 1);
  const c = b.conflicts[0];
  assert.equal(c.pre.key, 'A-1'); assert.equal(c.dep.key, 'B-1');
  assert.equal(cardIn(row(b, 'p:u2').cells[1], 'B-1').conflict, true, 'red ring');
  assert.deepEqual(fixFor(c), { issueId: '102', weeks: 1, start: '2026-11-23', due: '2026-11-24' });
  const moves = moveTask({}, ds.issues[1], { weeks: c.fix.weeks });
  assert.equal(conflicts({ model: computed.model, moves }).length, 0, 'fixed');
  // a pending move can create a conflict: pull A later
  const late = moveTask(moves, ds.issues[0], { weeks: 1 });
  const again = conflicts({ model: computed.model, moves: late });
  assert.equal(again.length, 1);
  assert.equal(again[0].pending, true);
  // link types outside the configuration do not count
  const { computed: c2 } = setup((d) => { d.config.dependencies.linkTypeIds = ['99']; });
  assert.equal(conflicts({ model: c2.model }).length, 0);
});

test('plan.apply payload validation', () => {
  const ok = validatePlanMoves({ moves: [{ issueId: '101', start: '2026-11-16', due: '2026-11-27', assignee: 'u2' }, { issueId: '102', assignee: null }, { issueId: '103', start: null }] });
  assert.equal(ok.length, 3);
  assert.deepEqual(ok[1], { issueId: '102', assignee: null });
  const bad = (p) => assert.throws(() => validatePlanMoves(p), (e) => e.code === 'INVALID');
  bad({});
  bad({ moves: [] });
  bad({ moves: Array.from({ length: MAX_MOVES + 1 }, (_, i) => ({ issueId: String(i + 1), due: '2026-11-20' })) });
  bad({ moves: [{ issueId: 'ABC-1', due: '2026-11-20' }] });
  bad({ moves: [{ issueId: '1', due: '2026-02-30' }] });
  bad({ moves: [{ issueId: '1', due: '20.11.2026' }] });
  bad({ moves: [{ issueId: '1', start: '2026-11-21', due: '2026-11-20' }] });
  bad({ moves: [{ issueId: '1', assignee: 'bad id!' }] });
  bad({ moves: [{ issueId: '1' }] });
  bad({ moves: [{ issueId: '1', due: '2026-11-20' }, { issueId: '1', due: '2026-11-21' }] });
  bad({ moves: [{ issueId: '1', due: '2026-11-20', summary: 'x' }] });
  assert.equal(canPlan({ editPlan: true }), true);
  assert.equal(canPlan({ editPlan: false, admin: true }), false, 'the configured permission wins');
  assert.equal(canPlan({ manageRanking: true }), true, 'fallback while editPlan is not configured');
  assert.equal(canPlan({ admin: true }), true);
  assert.equal(canPlan({ editCapacity: true, viewReport: true }), false);
  assert.equal(canPlan(null), false);
});

test('privacy: pseudonymized people fold into one sum row per team, their cards cannot move', () => {
  const { ds, computed } = setup((d) => {
    // Ben is outside the viewer's scope
    d.issues[1].assignee = { id: 'anon-1a2b3c4d', name: '', anon: true };
    d.capacity.people['anon-1a2b3c4d'] = { ...d.capacity.people.u2 };
    delete d.capacity.people.u2;
    delete d.people.u2;
    d.personLevel = false;
    d.privacy = { scope: 'team' };
  });
  const b = buildBoard({ ds, computed, team: 't1' });
  assert.equal(b.rows.some((r) => r.accountId === 'anon-1a2b3c4d'), false, 'no individual row');
  const h = row(b, 'h:t1');
  assert.equal(h.kind, 'hidden'); assert.equal(h.name, ''); assert.equal(h.count, 1);
  assert.equal(h.cells[1].own, 16, 'hours summed');
  assert.equal(h.cells[1].cards[0].kind, 'hiddenSum');
  assert.equal(h.cells[1].cards.some((c) => c.kind === 'task'), false, 'no task cards');
  assert.equal(b.candidates.some((c) => c.id.startsWith('anon-')), false, 'not offered in "change person"');
  assert.equal(planDrop(b, { id: '101', fromWeek: 0, toRow: 'h:t1', toWeek: 0 }).reason, 'hidden');
  // projects mode: the card shows, without a name, and does not move
  const pj = buildBoard({ ds, computed, team: 't1', mode: 'projects' });
  const card = cardIn(row(pj, 'r:issue:1').cells[1], 'B-1');
  assert.equal(card.assigneeName, null); assert.equal(card.locked, true);
  assert.equal(planDrop(pj, { id: '102', fromWeek: 1, toRow: 'r:issue:1', toWeek: 2 }).reason, 'hidden');
  // conflicts keep the hidden person anonymous; all teams fold them into one mini card
  assert.equal(b.conflicts[0].dep.assigneeName, null); assert.equal(b.conflicts[0].dep.hidden, true);
  const all = buildBoard({ ds, computed });
  const mini = row(all, 't:t1').cells[0].cards;
  assert.equal(mini.filter((c) => c.hidden).length, 1);
  assert.equal(mini.some((c) => c.accountId === 'anon-1a2b3c4d'), false);
});

import { weekShare } from '../shared/engine.js';
import { dayIdx as dIdx } from '../shared/dates.js';
test('UC-05: the Original Estimate is spread evenly over the weeks (80 h Wed–Tue = 40 + 40, not 67 + 13)', () => {
  const win = [dIdx('2026-11-18'), dIdx('2026-11-24')];
  const wk = (mon) => [dIdx(mon), dIdx(mon) + 6];
  assert.equal(weekShare(80, ...wk('2026-11-16'), win), 40);
  assert.equal(weekShare(80, ...wk('2026-11-23'), win), 40);
  assert.equal(weekShare(80, ...wk('2026-11-30'), win), 0);
  assert.equal(weekShare(90, ...wk('2026-11-16'), [dIdx('2026-11-20'), dIdx('2026-12-02')]), 30, 'three weeks touched');
  assert.equal(weekShare(80, ...wk('2026-11-16'), [dIdx('2026-11-21'), dIdx('2026-11-24')]), 0, 'a weekend-only week gets nothing');
});

test('live bug: the first drag of a card whose start is after its due lands exactly where it was dropped', () => {
  // C-1 like PCX-27: start Sun 29.11. after due Tue 24.11. → the board shows it in week 2 (23.–27.11.)
  const { ds, computed } = setup((d) => { const c = d.issues.find((i) => i.key === 'C-1'); c.start = '2026-11-29'; c.due = '2026-11-24'; });
  const b0 = buildBoard({ ds, computed, team: 't1' });
  const from = row(b0, 'u').cells.findIndex((c) => cardIn(c, 'C-1'));
  assert.equal(from, 2, 'shown in the week between the two dates');
  for (const to of [0, 1, 4]) {
    const v = planDrop(b0, { id: '103', fromWeek: from, toRow: 'p:u1', toWeek: to });
    const moves = moveTask({}, ds.issues.find((i) => i.id === '103'), { weeks: v.weeks, assignee: v.assignee, assigneeName: v.assigneeName });
    assert.ok(moves['103'].start <= moves['103'].due, 'start before due after the move');
    const b1 = buildBoard({ ds, computed, team: 't1', moves });
    const at = row(b1, 'p:u1').cells.map((c, i) => (cardIn(c, 'C-1') ? i : -1)).filter((i) => i >= 0);
    assert.deepEqual(at, [to], `dropped on week ${to}, shown in week ${at}`);
  }
});
