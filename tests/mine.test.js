// Meine Arbeit (UC-20): the booking rules – quarter hours, allowed dates, the worklog "started" time, and how a cell's
// new total changes exactly one of the person's own worklogs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.__forge_runtime__ = { appContext: { appId: 'ari:cloud:ecosystem::app/test', environmentType: 'DEVELOPMENT', environmentId: 'test', invocationId: 'test', installationId: 'test', moduleKey: 'pc-cockpit', permissions: { scopes: [] } }, lambdaContext: { getRemainingTimeInMillis: () => 25000 }, proxy: { token: '', url: 'http://127.0.0.1:9' }, metrics: { counter: () => ({ incr() {} }) }, tracing: {} };
const { quarterHours, validBookingDate, startedOf, planCell, adfText, adf, MINE_LIMITS } = await import('../src/lib/mine.js');
const src = readFileSync(new URL('../src/lib/mine.js', import.meta.url), 'utf8');

test('hours: quarter hours, comma or dot, 0–24', () => {
  assert.equal(quarterHours('1,5'), 1.5);
  assert.equal(quarterHours('1.6'), 1.5);
  assert.equal(quarterHours('0.13'), 0.25);
  assert.equal(quarterHours(''), 0, 'empty = remove the booking');
  assert.equal(quarterHours('0'), 0);
  assert.equal(quarterHours('24'), 24);
  assert.equal(quarterHours('25'), null);
  assert.equal(quarterHours('-1'), null);
  assert.equal(quarterHours('abc'), null);
});

test('dates: a quarter back, two weeks ahead, ISO only', () => {
  assert.equal(validBookingDate('2026-11-10', '2026-11-10'), true);
  assert.equal(validBookingDate('2026-08-10', '2026-11-10'), true);
  assert.equal(validBookingDate('2026-08-09', '2026-11-10'), false);
  assert.equal(validBookingDate('2026-11-24', '2026-11-10'), true);
  assert.equal(validBookingDate('2026-11-25', '2026-11-10'), false);
  assert.equal(validBookingDate('10.11.2026', '2026-11-10'), false);
  assert.equal(validBookingDate(undefined, '2026-11-10'), false);
  assert.equal(MINE_LIMITS.step, 0.25);
});

test('started = noon in the person\'s time zone (never slips to another day)', () => {
  assert.equal(startedOf('2026-11-10', 60), '2026-11-10T12:00:00.000+0100');
  assert.equal(startedOf('2026-11-10', -300), '2026-11-10T12:00:00.000-0500');
  assert.equal(startedOf('2026-11-10', 330), '2026-11-10T12:00:00.000+0530');
  assert.equal(startedOf('2026-11-10', 'x'), '2026-11-10T12:00:00.000+0000');
});

test('a cell total changes only the latest own worklog of that day', () => {
  assert.deepEqual(planCell([], 2), { op: 'create', hours: 2 });
  assert.deepEqual(planCell([], 0), { op: 'none' });
  const one = [{ id: '1', h: 2, started: '2026-11-10T12:00' }];
  assert.deepEqual(planCell(one, 2), { op: 'none' });
  assert.deepEqual(planCell(one, 3.5), { op: 'update', id: '1', hours: 3.5 });
  assert.deepEqual(planCell(one, 0), { op: 'delete', id: '1' });
  const two = [{ id: '7', h: 1, started: '2026-11-10T15:00' }, { id: '5', h: 2, started: '2026-11-10T09:00' }];
  assert.deepEqual(planCell(two, 4), { op: 'update', id: '7', hours: 2 }, 'the later one changes, the 2 h one stays');
  assert.deepEqual(planCell(two, 2), { op: 'delete', id: '7' });
  assert.deepEqual(planCell(two, 1), { op: 'refuse', others: 2 }, 'never touches the other worklog');
});

test('comments: plain text in, Atlassian document format out, and back', () => {
  assert.equal(adfText(adf('Import-Logik')), 'Import-Logik');
  assert.equal(adf(''), undefined);
  assert.equal(adfText({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }), 'a b');
  assert.equal(adfText(null), '');
});

test('safety: only the caller\'s own worklogs are read and changed; everything runs as the user', () => {
  assert.match(src, /filter\(\(w\) => w\.author\?\.accountId === me\)/);
  assert.ok(!/jira\('app'/.test(src), 'no app-level Jira calls');
  assert.ok(!/searchAll\('app'/.test(src));
  assert.match(src, /SUBTASK_NOT_BOOKABLE/);
  assert.match(src, /adjustEstimate: 'auto'/, 'remaining estimate drops like in Jira');
});
