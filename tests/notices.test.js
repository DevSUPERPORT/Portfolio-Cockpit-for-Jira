import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validNotices, due, gapReminders, bookingNotices, DEFAULT_NOTICES } from '../shared/notices.js';

test('sending is off by default and only an explicit true switches it on', () => {
  assert.equal(DEFAULT_NOTICES.enabled, false);
  assert.equal(validNotices(undefined).enabled, false);
  assert.equal(validNotices({ enabled: 'yes' }).enabled, false);
  assert.equal(validNotices({ enabled: true }).enabled, true);
  assert.equal(validNotices({ gaps: 'hourly' }).gaps, 'monday');
});

test('rhythm: daily once a day, monday once per week, off never', () => {
  assert.equal(due('off', null, '2026-11-16T07:00:00Z'), false);
  assert.equal(due('daily', '2026-11-16T07:00:00Z', '2026-11-16T09:00:00Z'), false);
  assert.equal(due('daily', '2026-11-16T07:00:00Z', '2026-11-17T06:00:00Z'), true);
  assert.equal(due('monday', null, '2026-11-17T06:00:00Z'), false, 'first run waits for a Monday');
  assert.equal(due('monday', null, '2026-11-16T06:00:00Z'), true);
  assert.equal(due('monday', '2026-11-16T06:00:00Z', '2026-11-20T06:00:00Z'), false);
  assert.equal(due('monday', '2026-11-16T06:00:00Z', '2026-11-23T06:00:00Z'), true);
});

test('gap reminders: one message per responsible person, urgent first, never to pseudonyms or project items', () => {
  const gaps = [
    { issueId: '1', key: 'A-1', rule: 'noEstimate', urgent: false, responsible: { id: 'u1', name: 'Ana' } },
    { issueId: '2', key: 'A-2', rule: 'noTeam', urgent: true, responsible: { id: 'u1', name: 'Ana' } },
    { issueId: '3', key: 'A-3', rule: 'noTeam', urgent: true, responsible: { id: 'anon-x', anon: true } },
    { isItem: true, key: 'P', rule: 'noTshirt', responsible: { id: 'u2' } },
  ];
  const r = gapReminders(gaps);
  assert.equal(r.length, 1);
  assert.equal(r[0].to, 'u1');
  assert.equal(r[0].anchor, '2', 'anchored on the urgent item');
  assert.equal(r[0].urgent, 1);
});

test('booking: notice below the minimum, escalation to the responsible people from x % missing', () => {
  const rows = [
    { accountId: 'a', teamId: 't', possible: 40, booked: 38, anchor: '9' }, // 95 % – fine
    { accountId: 'b', teamId: 't', possible: 40, booked: 34, anchor: '9' }, // 85 % – notice
    { accountId: 'c', teamId: 't', possible: 40, booked: 20, anchor: '9' }, // 50 % – escalation
  ];
  const out = bookingNotices(rows, { minPct: 90, escalatePct: 20, escalateTo: 'mgmt' }, { responsibleOf: () => ['lead', 'c'], management: ['boss'] });
  assert.deepEqual(out.filter((x) => x.kind === 'booking').map((x) => x.to), ['b', 'c']);
  const esc = out.find((x) => x.kind === 'escalation');
  assert.deepEqual(esc.to.sort(), ['boss', 'lead'], 'never escalated to the person themself');
});

import { bookingPeriod, bookingDue } from '../shared/notices.js';
test('booking check: the last completed period, sent once after the grace period', () => {
  assert.deepEqual(bookingPeriod('week', '2026-11-18'), { key: 'w:2026-11-09', from: '2026-11-09', to: '2026-11-13' });
  assert.deepEqual(bookingPeriod('month', '2026-11-18'), { key: 'm:2026-10', from: '2026-10-01', to: '2026-10-31' });
  assert.equal(bookingPeriod('day', '2026-11-16').from, '2026-11-13', 'Monday checks Friday');
  const p = bookingPeriod('week', '2026-11-16');
  assert.equal(bookingDue(p, '2026-11-16', 2), false, 'Monday: grace not over');
  assert.equal(bookingDue(p, '2026-11-18', 2), true, 'Wednesday: two working days passed');
  assert.equal(bookingDue(p, '2026-11-18', 2, p.key), false, 'already sent');
});

import { runBookingNotices } from '../src/lib/notices.js';
test('booking notices: nothing while off; once on, notice + escalation once per period', async () => {
  const mem = {}; const store = { get: async (k) => mem[k], set: async (k, v) => { mem[k] = v; } };
  const sent = [];
  const deps = {
    store, now: '2026-11-18T07:00:00Z', send: async (anchor, msg, to) => { sent.push({ anchor, to, subject: msg.subject }); },
    groupMembers: async () => ['boss'],
    loadData: async () => ({
      ds: { issues: [{ id: '7', assignee: { id: 'c' } }], capacity: { teams: { t: { responsible: ['lead'] } } }, people: { c: { name: 'Carl' } } },
      worklogs: [{ a: 'b', i: '5', d: '2026-11-10', h: 34 }],
      model: { itemByRef: new Map(), byId: new Map() },
      overview: (m, booked) => ({ rows: [{ id: 'b', teamId: 't', possible: 40, booked: booked.people.b.h }, { id: 'c', teamId: 't', possible: 40, booked: 0 }] }),
    }),
  };
  const off = await runBookingNotices({ notices: { enabled: false } }, deps);
  assert.equal(off.skipped, 'disabled'); assert.equal(sent.length, 0);
  const cfg = { notices: { enabled: true, booking: true }, booking: { escalateTo: 'mgmt' }, roles: { groups: { management: [{ id: 'g' }] } } };
  const r = await runBookingNotices(cfg, deps);
  assert.equal(r.period, 'w:2026-11-09');
  assert.deepEqual(sent.map((x) => x.to.join(',')).sort(), ['b', 'c', 'lead,boss'].sort());
  assert.equal(sent.find((x) => x.to.includes('c')).anchor, '7', 'no booking -> anchored on an assigned item');
  const again = await runBookingNotices(cfg, deps);
  assert.equal(again.skipped, 'not due', 'once per period');
});

// ---------- reminders on request: Lotse's notice.remind → resolver notices.remind → remindPeople ----------
import { remindPeople, REMIND_KEY } from '../src/lib/notices.js';
import { readFileSync } from 'node:fs';
function remindDeps(now = '2026-11-18T09:00:00Z') {
  const mem = {}; const sent = []; const audits = [];
  return {
    mem, sent, audits, now,
    store: { get: async (k) => mem[k] ?? null, set: async (k, v) => { mem[k] = structuredClone(v); }, del: async (k) => { delete mem[k]; } },
    send: async (anchor, msg, to) => { sent.push({ anchor, to, subject: msg.subject, text: msg.text }); },
    audit: async (d) => { audits.push(d); },
    loadGaps: async () => [
      { issueId: '11', key: 'A-11', rule: 'noEstimate', urgent: true, responsible: { id: 'u1', name: 'Ana' } },
      { issueId: '12', key: 'A-12', rule: 'noTeam', urgent: false, responsible: { id: 'u2', name: 'Bo' } },
    ],
    loadData: async () => ({
      ds: { issues: [{ id: '7', assignee: { id: 'c' } }], capacity: { teams: { t: { responsible: ['lead'] } } }, people: { b: { name: 'Bea' }, c: { name: 'Carl' }, d: { name: 'Dora' } } },
      worklogs: [{ a: 'b', i: '5', d: '2026-11-10', h: 20 }, { a: 'd', i: '6', d: '2026-11-10', h: 40 }],
      model: { itemByRef: new Map(), byId: new Map() },
      overview: (m, booked) => ({ rows: ['b', 'c', 'd'].map((id) => ({ id, teamId: 't', possible: 40, booked: booked.people[id]?.h || 0 })) }),
    }),
  };
}

test('notices.remind: refused while notices are off – nothing is loaded, sent or marked', async () => {
  const d = remindDeps();
  await assert.rejects(remindPeople({ notices: { enabled: false } }, { kind: 'gaps', accountIds: ['u1'] }, d), (e) => e.code === 'NOTICES_OFF');
  assert.equal(d.sent.length, 0);
  assert.deepEqual(d.mem, {});
});

test('notices.remind: the existing gap / booking message to the named people only; dry run counts without sending', async () => {
  const cfg = { notices: { enabled: true }, booking: { minPct: 90, schedule: 'week' } };
  const d = remindDeps();
  const dry = await remindPeople(cfg, { kind: 'booking', accountIds: ['b', 'c', 'd'], dryRun: true }, d);
  assert.equal(dry.would, 2, 'b (50 %) and c (0 %) – d booked everything');
  assert.equal(dry.nothing, 1);
  assert.equal(d.sent.length, 0, 'dry run: nothing sent');
  assert.deepEqual(d.mem, {}, 'dry run: nothing marked');
  assert.equal(d.audits.length, 0, 'dry run: nothing audited');
  const r = await remindPeople(cfg, { kind: 'booking', accountIds: ['b', 'c', 'd'] }, d);
  assert.equal(r.sent, 2);
  assert.deepEqual(d.sent.map((x) => x.to.join()).sort(), ['b', 'c']);
  assert.match(d.sent[0].subject, /gebucht .*booked/, 'the same booking notice as the scheduled run');
  assert.ok(!d.sent.some((x) => x.to.includes('lead')), 'no escalation from a manual reminder');
  assert.equal(d.audits.length, 1);
  assert.deepEqual(d.audits[0].to.sort(), ['b', 'c']);
  assert.equal(d.audits[0].sent, 2);
  const g = await remindPeople(cfg, { kind: 'gaps', accountIds: ['u1'] }, d);
  assert.equal(g.sent, 1);
  assert.equal(d.sent.at(-1).anchor, '11');
  assert.match(d.sent.at(-1).text, /A-11/);
});

test('notices.remind: at most one reminder per person, kind and day', async () => {
  const cfg = { notices: { enabled: true } };
  const d = remindDeps();
  assert.equal((await remindPeople(cfg, { kind: 'gaps', accountIds: ['u1', 'u2'] }, d)).sent, 2);
  const again = await remindPeople(cfg, { kind: 'gaps', accountIds: ['u1', 'u2'] }, d);
  assert.equal(again.sent, 0);
  assert.equal(again.limited, 2);
  assert.equal((await remindPeople(cfg, { kind: 'gaps', accountIds: ['u1'], dryRun: true }, d)).limited, 1, 'the preview says so too');
  assert.ok(d.mem[REMIND_KEY('2026-11-18')]['gaps:u1']);
  // another kind the same day is its own reminder
  assert.equal((await remindPeople(cfg, { kind: 'booking', accountIds: ['b'] }, d)).sent, 1);
  // the next day: allowed again; yesterday's marks are deleted
  const next = { ...d, now: '2026-11-19T09:00:00Z' };
  assert.equal((await remindPeople(cfg, { kind: 'gaps', accountIds: ['u1'] }, next)).sent, 1);
  assert.ok(!d.mem[REMIND_KEY('2026-11-18')], 'old marks go');
});

test('notices.remind resolver: capacity editors / admins, validated ids, wired to the Lotse command and the maintenance lists', () => {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const r = src.slice(src.indexOf("def('notices.remind'"), src.indexOf('\n});', src.indexOf("def('notices.remind'")));
  assert.match(r, /roles\.admin \|\| roles\.editCapacity/);
  assert.match(r, /ids\.length >= 1 && ids\.length <= 100/);
  assert.match(r, /remindPeople\(cfg, \{ kind: payload\.kind, accountIds: ids, dryRun: payload\.dryRun === true \}/);
  assert.match(r, /audit\(me, 'notices\.remind', details\)/);
  const cmd = readFileSync(new URL('../shared/lotse/act/commands.js', import.meta.url), 'utf8');
  assert.match(cmd, /io\.call\('notices\.remind', \{ kind: p\.kind, accountIds: p\.people \}\)/, 'the command calls exactly this resolver with these params');
  assert.doesNotMatch(readFileSync(new URL('../src/lib/maintenance.js', import.meta.url), 'utf8'), /'notices\.remind'/, 'a write: refused while paused');
});
