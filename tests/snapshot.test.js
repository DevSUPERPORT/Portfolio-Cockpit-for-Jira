// Plan vs. Ist snapshot job (src/lib/snapshot.js): schedule in the site's time zone, idempotent once per week,
// plan per person × bucket, actuals a week later, retention, sharding and the privacy filter of the read function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSnapshotJob, planActual, putRecord, getRecord, localNow, computePlan, LAST } from '../src/lib/snapshot.js';
import { analyzePlanActual } from '../shared/planActual.js';
import { dayIdx, ymdIdx } from '../shared/dates.js';

const fakeStore = (init = {}) => {
  const m = new Map(Object.entries(structuredClone(init)));
  return { m, get: async (k) => structuredClone(m.get(k) ?? null), set: async (k, v) => { m.set(k, structuredClone(v)); }, del: async (k) => { m.delete(k); } };
};
const cfg = { setupComplete: true, snapshot: { day: 'mon', time: '06:00', keepMonths: 24 } };
const st = (cat = 'indeterminate') => ({ name: cat, cat });
const story = (o) => ({ role: 'estimate', status: st(), worklogs: [], links: [], fixVersionIds: [], quarters: [], ts: 0, re: 0, ...o });

function dataset({ absences = [] } = {}) {
  return {
    today: '2026-11-09', storyTotals: true,
    config: { levels: [], rules: { distribution: 'linear' } },
    portfolio: [{ ref: 'issue:1', rank: 1, name: 'ERP-Anbindung', key: 'ERP-1' }, { ref: 'issue:2', rank: 2, name: 'DSGVO-Löschkonzept', key: 'DSG-1' }],
    teams: [{ id: 't1', name: 'Integration' }, { id: 't2', name: 'Web' }],
    people: { u1: { id: 'u1', name: 'Paul Richter' }, u2: { id: 'u2', name: 'Sara Yilmaz' }, u3: { id: 'u3', name: 'Lena Hartmann' } },
    capacity: {
      defaultWeeklyHours: 40, defaultLocation: 'NONE',
      people: { u1: { weeklyHours: 40, location: 'NONE', teamId: 't1' }, u2: { weeklyHours: 40, location: 'NONE', teamId: 't1' }, u3: { weeklyHours: 40, location: 'NONE', teamId: 't2' } },
      teams: { t1: { dailyBusinessPct: 0, internalPct: 0 }, t2: { dailyBusinessPct: 0, internalPct: 0 } },
      absences,
    },
    issues: [
      story({ id: '11', key: 'ERP-11', summary: 'Schnittstelle', rootRef: 'issue:1', oe: 40, ts: 30, re: 20, start: '2026-11-09', due: '2026-11-20', assignee: { id: 'u1' }, team: { id: 't1', name: 'Integration' } }),
      story({ id: '12', key: 'DSG-12', rootRef: 'issue:2', oe: 10, start: '2026-11-09', due: '2026-11-13', assignee: { id: 'u2' }, team: { id: 't1', name: 'Integration' } }),
      story({ id: '13', key: 'DSG-13', rootRef: 'issue:2', oe: 5, start: '2026-11-09', due: '2026-11-13', assignee: { id: 'u3' }, team: { id: 't2', name: 'Web' } }),
      story({ id: '14', key: 'ERP-14', rootRef: 'issue:1', oe: 99, start: '2026-11-09', due: '2026-11-13', assignee: { id: 'u1' }, status: st('done') }),
      story({ id: '15', key: 'ERP-15', rootRef: 'issue:1', oe: 8, start: '2026-11-09', due: '2026-11-13', team: { id: 't1' } }),
    ],
    supportComputed: { personWeekly: { u1: 6 } },
    supportTickets: { tickets: [{ id: '900' }] },
  };
}
// Berlin: CET (UTC+1) in November
const at = (iso) => Date.parse(iso);

test('local time in the site time zone, also across the DST change', () => {
  assert.deepEqual(localNow(at('2026-11-09T05:30:00Z'), 'Europe/Berlin'), { day: ymdIdx(2026, 11, 9), min: 6 * 60 + 30 });
  assert.deepEqual(localNow(at('2026-07-06T04:00:00Z'), 'Europe/Berlin'), { day: ymdIdx(2026, 7, 6), min: 6 * 60 });
  assert.deepEqual(localNow(at('2026-11-08T23:30:00Z'), 'Europe/Berlin'), { day: ymdIdx(2026, 11, 9), min: 30 });
});

test('the plan: Original Estimate spread over the week, support reserve, known absences; done and unassigned stories left out', () => {
  const ds = dataset({ absences: [{ accountId: 'u2', from: '2026-11-12', to: '2026-11-13' }] });
  const p = computePlan(ds, dayIdx('2026-11-09'), dayIdx('2026-11-15'));
  assert.deepEqual(p.people.u1.p, { 'issue:1': 20, SUP: 6 }, '40 h over 10 working days → 20 h this week; 6 h support reserve');
  assert.deepEqual(p.people.u2.p, { 'issue:2': 10 });
  assert.equal(p.people.u2.absP, 16, 'two known absence days');
  assert.equal(p.people.u3.t, 't2');
  assert.equal(p.unassigned.t1, 8);
  assert.equal(p.projects['issue:1'].n, 'ERP-Anbindung');
  assert.equal(p.names.u1, 'Paul Richter');
});

test('the job waits for the configured time, acts once per week, adds the actuals a week later and keeps privacy', async () => {
  const store = fakeStore();
  let ds = dataset({ absences: [{ accountId: 'u2', from: '2026-11-12', to: '2026-11-13' }] });
  let worklogs = [];
  let loads = 0;
  const deps = { store, timeZone: 'Europe/Berlin', paused: () => false, loadConfig: async () => cfg, loadData: async () => { loads++; return { ds: structuredClone(ds), worklogs }; } };

  assert.equal((await planActual({}, { store })).state, 'none', 'before the first snapshot');
  const early = await runSnapshotJob({ ...deps, now: at('2026-11-09T04:59:00Z') });
  assert.equal(early.skipped, 'notDue');
  assert.equal(early.next, '2026-11-09');
  assert.equal(loads, 0, 'nothing is loaded before the snapshot is due');

  const first = await runSnapshotJob({ ...deps, now: at('2026-11-09T05:01:00Z') });
  assert.equal(first.week, '2026-W46');
  assert.ok(store.m.has('snap:2026-W46'));
  assert.equal((await runSnapshotJob({ ...deps, now: at('2026-11-10T09:00:00Z') })).skipped, 'done', 'idempotent within the week');
  assert.equal(loads, 1);
  const waiting = await planActual({}, { store, cfg });
  assert.equal(waiting.state, 'waiting');
  assert.equal(waiting.firstWeek, '2026-W46');

  // the week happened: u1 got pulled into support and was ill on Wednesday, u3 (team Web) worked on ERP instead of DSG
  ds = dataset({ absences: [{ accountId: 'u2', from: '2026-11-12', to: '2026-11-13' }, { accountId: 'u1', from: '2026-11-11', to: '2026-11-11' }] });
  worklogs = [
    { a: 'u1', i: '11', d: '2026-11-09', h: 10 }, { a: 'u1', i: '900', d: '2026-11-10', h: 14 }, { a: 'u1', i: '777', d: '2026-11-13', h: 2 },
    { a: 'u2', i: '12', d: '2026-11-10', h: 10 }, { a: 'u3', i: '11', d: '2026-11-10', h: 5 },
    { a: 'u1', i: '11', d: '2026-11-16', h: 3 }, // next week: not part of W46
  ];
  const second = await runSnapshotJob({ ...deps, now: at('2026-11-16T05:30:00Z') });
  assert.equal(second.week, '2026-W47');
  assert.deepEqual(second.acts, ['2026-W46']);
  const act = await getRecord(store, 'snap:2026-W46:act');
  assert.deepEqual(act.people.u1.b, { 'issue:1': 10, SUP: 14, INT: 2 });
  assert.equal(act.people.u1.absU, 8, 'the sick day was not known on Monday');
  assert.equal(act.people.u2.absU, undefined, 'the planned absence is not unplanned');
  assert.equal(act.final, false, 'the newest week is provisional');
  assert.deepEqual(act.over.map((o) => [o.key, o.extra]), [['ERP-11', 10]], 'Time Spent + Remaining 50 h > 40 h × 1.1');

  // privacy: without the permission everything is summed per team, no names leave the server
  const hidden = await planActual({ weeks: 4 }, { store, cfg });
  assert.equal(hidden.state, 'ready');
  assert.ok(hidden.units.every((u) => u.kind === 'team'));
  assert.ok(!JSON.stringify(hidden).includes('Paul'), 'no names of hidden people');
  const shown = await planActual({ weeks: 4 }, { store, cfg, canSeePerson: async (t) => t === 't1' });
  assert.deepEqual(shown.units.map((u) => u.id).sort(), ['team:t2', 'u1', 'u2']);
  assert.equal(shown.units.find((u) => u.id === 'u1').name, 'Paul Richter');
  assert.deepEqual(shown.teams.map((t) => t.name), ['Integration', 'Web']);
  const onlyWeb = await planActual({ weeks: 4, team: 't2' }, { store, cfg, canSeePerson: () => true });
  assert.deepEqual(onlyWeb.units.map((u) => u.id), ['u3']);

  const a = analyzePlanActual(shown, { lang: 'de' });
  assert.equal(Math.round(a.kpis.plan), 41);
  assert.equal(Math.round(a.kpis.book), 41);
  assert.equal(Math.round(a.kpis.asPlanned), 31);
  assert.equal(Math.round(a.kpis.diverted), 18, 'support +8, internal +2, unplanned absence 8');
  assert.deepEqual(a.rows.map((r) => r.key), ['SUP', 'issue:1', 'issue:2', 'INT'], 'support first, projects by rank, internal last');
  assert.equal(a.why.length, 2);
  assert.match(a.why.find((w) => w.key === 'issue:2').sentence, /^DSGVO-Löschkonzept −5 h: 5 h in ERP-Anbindung\.$/);
  assert.match(a.why.find((w) => w.key === 'issue:2').whoText, /1 Person aus anderen Teams/);
  assert.equal(a.why.find((w) => w.key === 'issue:1').over[0].key, 'ERP-11');
  assert.equal(a.period, 'KW 46');

  // a week later W46 is recomputed once more (late bookings) and becomes final
  worklogs = [...worklogs, { a: 'u2', i: '12', d: '2026-11-13', h: 2 }];
  await runSnapshotJob({ ...deps, now: at('2026-11-23T05:30:00Z') });
  const again = await getRecord(store, 'snap:2026-W46:act');
  assert.equal(again.final, true);
  assert.equal(again.people.u2.b['issue:2'], 12);
});

test('paused app or unfinished setup: nothing is read or written', async () => {
  const store = fakeStore();
  assert.equal((await runSnapshotJob({ store, paused: () => true })).skipped, 'paused');
  assert.equal((await runSnapshotJob({ store, paused: () => false, loadConfig: async () => ({ setupComplete: false }) })).skipped, 'setup');
  assert.equal(store.m.size, 0);
});

test('a later configured day and time is respected; the snapshot is taken late when the slot was missed', async () => {
  const store = fakeStore();
  const deps = { store, timeZone: 'Europe/Berlin', paused: () => false, loadConfig: async () => ({ ...cfg, snapshot: { day: 'wed', time: '12:00' } }), loadData: async () => ({ ds: dataset(), worklogs: [] }) };
  assert.equal((await runSnapshotJob({ ...deps, now: at('2026-11-10T12:00:00Z') })).skipped, 'notDue');
  const r = await runSnapshotJob({ ...deps, now: at('2026-11-13T08:00:00Z') });
  assert.equal(r.week, '2026-W46');
  assert.equal((await store.get('snap:2026-W46')).late, true);
});

test('retention: weeks older than the configured months are deleted, with their parts', async () => {
  const store = fakeStore({
    [LAST]: { week: '2024-W40', weeks: ['2024-W01', '2024-W40', '2026-W45'], acts: ['2024-W01'] },
    'snap:2024-W01': { week: '2024-W01', people: {}, parts: 1 }, 'snap:2024-W01#1': { people: { x: { t: 't1', p: { SUP: 1 } } } },
    'snap:2024-W01:act': { week: '2024-W01', people: {} }, 'snap:2024-W40': { week: '2024-W40', people: {} }, 'snap:2026-W45': { week: '2026-W45', people: {} },
  });
  const r = await runSnapshotJob({ store, now: at('2026-11-16T05:30:00Z'), timeZone: 'Europe/Berlin', paused: () => false, loadConfig: async () => cfg, loadData: async () => ({ ds: dataset(), worklogs: [] }) });
  assert.deepEqual(r.deleted.sort(), ['2024-W01', '2024-W40']);
  for (const k of ['snap:2024-W01', 'snap:2024-W01#1', 'snap:2024-W01:act', 'snap:2024-W40']) assert.ok(!store.m.has(k), k);
  assert.ok(store.m.has('snap:2026-W45') && store.m.has('snap:2026-W47'));
  assert.deepEqual((await store.get(LAST)).weeks, ['2026-W45', '2026-W47']);
});

test('large records are split into parts and read back whole; stale parts are removed', async () => {
  const store = fakeStore();
  const people = Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`account-${i}-${'x'.repeat(20)}`, { t: `team-${i % 7}`, p: { 'issue:1': 1.5, 'issue:2': 2.5, SUP: 3 }, absP: 8 }]));
  const parts = await putRecord(store, 'snap:2026-W46', { week: '2026-W46', people });
  assert.ok(parts >= 2, `${parts} parts`);
  for (const [k, v] of store.m) assert.ok(JSON.stringify(v).length <= 200_000, k);
  const back = await getRecord(store, 'snap:2026-W46');
  assert.equal(Object.keys(back.people).length, 4000);
  assert.equal(back.parts, undefined);
  await putRecord(store, 'snap:2026-W46', { week: '2026-W46', people: { a: { t: 't', p: {} } } });
  assert.ok(!store.m.has('snap:2026-W46#1'));
  assert.deepEqual(Object.keys((await getRecord(store, 'snap:2026-W46')).people), ['a']);
});
