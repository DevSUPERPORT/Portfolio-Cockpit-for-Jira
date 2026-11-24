// "Woche vervollständigen": invariants that cannot hold by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { allocate, suggestWeek } from '../shared/mineSuggest.js';

globalThis.__forge_runtime__ = { appContext: { appId: 'ari:cloud:ecosystem::app/test', environmentType: 'DEVELOPMENT', environmentId: 'test', invocationId: 'test', installationId: 'test', moduleKey: 'pc-cockpit', permissions: { scopes: [] } }, lambdaContext: { getRemainingTimeInMillis: () => 25000 }, proxy: { token: '', url: 'http://127.0.0.1:9' }, metrics: { counter: () => ({ incr() {} }) }, tracing: {} };
const { evidenceOf } = await import('../src/lib/mine.js');

const day = (iso, o = {}) => ({ iso, possible: 8, isPast: true, isToday: false, ...o });
const I = (id, o = {}) => ({ id, key: `PCX-${id}`, summary: `T${id}`, type: { name: 'Story', subtask: false }, status: { name: 'In Progress', cat: 'indeterminate' }, project: { key: 'PCX' }, mine: true, start: '2026-11-01', due: '2026-11-30', parent: null, support: false, ...o });
const days = [day('2026-11-09'), day('2026-11-10'), day('2026-11-11', { isPast: false, isToday: true }), day('2026-11-12', { isPast: false }), day('2026-11-13', { isPast: false })];

test('allocate: quarter hours that add up exactly to the gap (largest remainder)', () => {
  for (const [gap, ws] of [[8, [3, 2, 1]], [5.25, [1, 1, 1]], [0.75, [5, 1]], [7.5, [2, 2, 3, 1]]]) {
    const r = allocate(gap, ws.map((w, i) => ({ id: i, w })));
    assert.equal(r.reduce((t, x) => t + x.h, 0), gap, `gap ${gap}`);
    r.forEach((x) => assert.equal(x.h * 4, Math.round(x.h * 4), 'quarter hours'));
  }
  const r = allocate(6, [{ id: 'a', w: 3 }, { id: 'b', w: 1 }]);
  assert.deepEqual(r.map((x) => x.h), [4.5, 1.5]);
});

test('per day: proposals sum EXACTLY to target − booked; never future days, never booked cells', () => {
  const issues = [I('1'), I('2'), I('3')];
  const worklogs = [{ issueId: '1', d: '2026-11-09', h: 3 }];
  const events = [{ issueId: '1', d: '2026-11-09', kind: 'comment' }, { issueId: '2', d: '2026-11-09', kind: 'status' }, { issueId: '3', d: '2026-11-12', kind: 'status' }];
  const s = suggestWeek({ days, issues, worklogs, events });
  const mon = s.list.filter((x) => x.d === '2026-11-09');
  assert.equal(mon.reduce((t, x) => t + x.h, 0), 5, '8 − 3 booked');
  assert.ok(!mon.some((x) => x.issueId === '1'), 'the already booked cell is not touched');
  assert.ok(s.list.every((x) => x.d <= '2026-11-11'), 'no future days');
  assert.ok(s.list.filter((x) => x.d === '2026-11-10').every((x) => x.basis === 'plan'), 'no activity on Tuesday → plan');
  for (const d of Object.keys(s.perDay)) assert.equal(s.list.filter((x) => x.d === d).reduce((t, x) => t + x.h, 0), s.perDay[d].h);
});

test('activity beats plan; sub-task activity goes to its story; sub-tasks never get hours', () => {
  const issues = [I('1'), I('2', { status: { name: 'To Do', cat: 'new' } }), I('9', { type: { name: 'Sub-task', subtask: true }, parent: { id: '2', key: 'PCX-2', summary: 'T2' } })];
  const events = [{ issueId: '9', d: '2026-11-10', kind: 'status', from: 'To Do', to: 'In Progress' }];
  const s = suggestWeek({ days, issues, worklogs: [], events });
  const tue = s.list.filter((x) => x.d === '2026-11-10');
  assert.deepEqual(tue.map((x) => [x.key, x.h, x.basis]), [['PCX-2', 8, 'activity']], 'only the evidenced story, the whole gap');
  assert.equal(tue[0].events[0].viaKey, 'PCX-9');
  assert.ok(!s.list.some((x) => x.issueId === '9'));
});

test('no target (holiday/absence) → no proposal; full day → nothing; at least ½ h per proposal', () => {
  const d2 = [day('2026-11-09', { possible: 0 }), day('2026-11-10')];
  const s = suggestWeek({ days: d2, issues: [I('1')], worklogs: [{ issueId: '1', d: '2026-11-10', h: 8 }], events: [] });
  assert.equal(s.list.length, 0);
  const many = suggestWeek({ days: [day('2026-11-09', { possible: 1 })], issues: ['1', '2', '3', '4'].map((x) => I(x)), worklogs: [], events: [] });
  assert.ok(many.list.every((x) => x.h >= 0.5), many.list.map((x) => x.h).join(','));
  assert.equal(many.list.reduce((t, x) => t + x.h, 0), 1);
});

test('evidence is mine only, inside the week, and ignores pure worklog bookkeeping', () => {
  const me = 'u1';
  const hist = [
    { author: { accountId: me }, created: '2026-11-10T09:00:00.000+0100', items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }] },
    { author: { accountId: 'other' }, created: '2026-11-10T10:00:00.000+0100', items: [{ field: 'status' }] },
    { author: { accountId: me }, created: '2026-11-02T10:00:00.000+0100', items: [{ field: 'summary' }] },
    { author: { accountId: me }, created: '2026-11-11T10:00:00.000+0100', items: [{ field: 'timespent' }, { field: 'WorklogId' }] },
  ];
  const com = [{ author: { accountId: me }, created: '2026-11-12T08:00:00.000+0100', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mapping fertig' }] }] } }];
  const ev = evidenceOf('5', me, '2026-11-09', '2026-11-13', hist, com);
  assert.deepEqual(ev.map((e) => [e.d, e.kind]), [['2026-11-10', 'status'], ['2026-11-12', 'comment']]);
  assert.equal(ev[1].text, 'Mapping fertig');
});

test('activity cell already booked → the plan fills the rest of the day', () => {
  const issues = [I('1'), I('2')];
  const s = suggestWeek({ days: [day('2026-11-09')], issues, worklogs: [{ issueId: '1', d: '2026-11-09', h: 3 }], events: [{ issueId: '1', d: '2026-11-09', kind: 'status' }] });
  assert.deepEqual(s.list.map((x) => [x.key, x.h, x.basis]), [['PCX-2', 5, 'plan']]);
});

test('evidence JQL: the account id (validated), never currentUser() – Jira refuses that inside updatedBy()', async () => {
  const { evidenceJql } = await import('../src/lib/mine.js');
  assert.equal(evidenceJql('712020:00000000-aaaa-4bbb-8ccc-000000000002', '2026-11-09', '2026-11-13'), 'issue in updatedBy("712020:00000000-aaaa-4bbb-8ccc-000000000002", "2026/11/09", "2026/11/13") ORDER BY updated DESC');
  assert.throws(() => evidenceJql('x") OR project = SECRET OR ("', '2026-11-09', '2026-11-13'), { code: 'INVALID' });
  assert.throws(() => evidenceJql('', '2026-11-09', '2026-11-13'));
});

// ---------- "Complete the week" proposed 8 h for a date change made in Weekly planning (tester finding) ----------
test('planning is not work: edits of dates, assignee, rank, estimates, size, quarters, versions, sprint, labels, links are no evidence', () => {
  const me = 'u1';
  const at = (h) => `2026-11-10T${String(h).padStart(2, '0')}:00:00.000+0100`;
  const H = (h, items) => ({ author: { accountId: me }, created: at(h), items });
  const hist = [
    H(8, [{ field: 'Start date', fieldId: 'customfield_10015' }, { field: 'duedate', fieldId: 'duedate' }]), // "Apply in Jira" in Weekly planning
    H(9, [{ field: 'assignee', fieldId: 'assignee' }]),
    H(10, [{ field: 'Rank', fieldId: 'customfield_10019' }, { field: 'timeoriginalestimate', fieldId: 'timeoriginalestimate' }, { field: 'timeestimate', fieldId: 'timeestimate' }]),
    H(11, [{ field: 'Fix Version', fieldId: 'fixVersions' }, { field: 'Sprint', fieldId: 'customfield_10020' }, { field: 'labels', fieldId: 'labels' }, { field: 'Link', fieldId: 'issuelinks' }]),
    H(12, [{ field: 'Portfolio Rank', fieldId: 'customfield_10500' }, { field: 'T-Shirt Size', fieldId: 'customfield_10501' }, { field: 'Target Quarters', fieldId: 'customfield_10502' }, { field: 'Team', fieldId: 'customfield_10001' }]),
    H(13, [{ field: 'Kickoff', fieldId: 'customfield_10777' }]), // a configured start-date field under another name
    H(14, [{ field: 'duedate', fieldId: 'duedate' }, { field: 'description', fieldId: 'description' }]),
    H(15, [{ field: 'priority', fieldId: 'priority' }]),
    H(16, [{ field: 'summary', fieldId: 'summary' }]),
  ];
  const ev = evidenceOf('27', me, '2026-11-09', '2026-11-13', hist, [], { planning: ['customfield_10777'] });
  assert.deepEqual(ev.map((e) => [e.at.slice(11, 13), e.kind, e.fields, e.content]), [
    ['14', 'edit', ['description'], true], // the planning part is dropped, the content edit stays
    ['15', 'edit', ['priority'], false],
    ['16', 'edit', ['summary'], true],
  ]);
  const src = readFileSync(new URL('../src/lib/mine.js', import.meta.url), 'utf8');
  assert.match(src, /evidenceOf\(i\.id, me, from, to, hist, com, \{ planning \}\)/, 'the configured planning fields reach the filter');
  assert.match(src, /f\.startDate, f\.team, f\.tshirt, f\.targetQuarters, f\.milestone, app\.rank, app\.tshirt, app\.targetQuarters/);
});

test('no proposal on a work item that is not mine – unless I really worked on it', () => {
  const issues = [I('1'), I('27', { mine: false, assignee: { id: 'u9' }, status: { name: 'To Do', cat: 'new' } })];
  // the tester's case: PCX-27 (not mine) moved in Weekly planning; an older server still sends the planning edit
  const moved = suggestWeek({ days: [day('2026-11-10')], issues, worklogs: [], events: [{ issueId: '27', d: '2026-11-10', kind: 'edit', fields: ['Start date', 'duedate'] }] });
  assert.ok(!moved.list.some((x) => x.issueId === '27'), 'a date change is no reason for hours on PCX-27');
  assert.deepEqual(moved.list.map((x) => [x.key, x.h, x.basis]), [['PCX-1', 8, 'plan']], 'the day is filled from my own plan instead');
  const ask = (events, worklogs = []) => suggestWeek({ days: [day('2026-11-10')], issues, worklogs, events }).list.filter((x) => x.issueId === '27').map((x) => x.basis);
  assert.deepEqual(ask([{ issueId: '27', d: '2026-11-10', kind: 'edit', fields: ['priority'], content: false }]), [], 'a non-content edit of an item that is not mine is not work');
  assert.deepEqual(ask([{ issueId: '27', d: '2026-11-10', kind: 'edit', fields: ['Labels', 'Fix Version'] }]), []);
  assert.deepEqual(ask([{ issueId: '27', d: '2026-11-10', kind: 'comment', text: 'Review' }]), ['activity'], 'my comment is work');
  assert.deepEqual(ask([{ issueId: '27', d: '2026-11-10', kind: 'status', from: 'To Do', to: 'In Progress' }]), ['activity'], 'my status change is work');
  assert.deepEqual(ask([{ issueId: '27', d: '2026-11-10', kind: 'edit', fields: ['description'], content: true }]), ['activity'], 'my own content edit is work');
  assert.deepEqual(ask([{ issueId: '27', d: '2026-11-10', kind: 'edit', fields: ['priority'], content: false }], [{ issueId: '27', d: '2026-11-09', h: 2 }]), ['activity'], 'my worklog on it this week is work');
  // on my own work items a non-planning edit still counts, as before
  const own = suggestWeek({ days: [day('2026-11-10')], issues: [I('1'), I('2')], worklogs: [], events: [{ issueId: '2', d: '2026-11-10', kind: 'edit', fields: ['priority'], content: false }] });
  assert.deepEqual(own.list.map((x) => [x.key, x.basis]), [['PCX-2', 'activity']]);
  // a planning edit on my own item is no activity either (the plan may still cover it)
  const ownPlan = suggestWeek({ days: [day('2026-11-10')], issues: [I('1', { start: '2026-12-01', due: '2026-12-10' }), I('2')], worklogs: [], events: [{ issueId: '1', d: '2026-11-10', kind: 'edit', fields: ['duedate'] }] });
  assert.deepEqual(ownPlan.list.map((x) => [x.key, x.basis]), [['PCX-2', 'plan']]);
});

test('sub-task of mine on a story that is not mine: real work on my sub-task books on the story', () => {
  const issues = [I('5', { mine: false }), I('9', { type: { name: 'Sub-task', subtask: true }, parent: { id: '5', key: 'PCX-5', summary: 'T5' } })];
  const s = suggestWeek({ days: [day('2026-11-10')], issues, worklogs: [], events: [{ issueId: '9', d: '2026-11-10', kind: 'status', from: 'To Do', to: 'Done' }] });
  assert.deepEqual(s.list.map((x) => [x.key, x.h]), [['PCX-5', 8]]);
  const p = suggestWeek({ days: [day('2026-11-10')], issues, worklogs: [], events: [{ issueId: '9', d: '2026-11-10', kind: 'edit', fields: ['Start date'] }] });
  assert.deepEqual(p.list, [], 'moving my sub-task in the plan is not work');
});
