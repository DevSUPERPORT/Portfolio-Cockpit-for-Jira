// Plan vs. Ist analysis (shared/planActual.js): calendar, schedule, attribution, payload and the wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeekOf, weekRange, shiftWeek, validSnapshot, snapshotDue, attribute, buildPayload, analyzePlanActual, isSignificant, SNAPSHOT_DEFAULTS } from '../shared/planActual.js';
import { dayIdx, isoOf } from '../shared/dates.js';

test('ISO weeks, including the turn of the year', () => {
  assert.equal(isoWeekOf(dayIdx('2026-01-01')).key, '2026-W01');
  assert.equal(isoWeekOf(dayIdx('2027-01-01')).key, '2026-W53');
  assert.equal(isoWeekOf(dayIdx('2024-12-30')).key, '2025-W01');
  assert.equal(isoWeekOf(dayIdx('2026-11-11')).key, '2026-W46');
  assert.deepEqual(weekRange('2026-W46').map(isoOf), ['2026-11-09', '2026-11-15']);
  assert.equal(shiftWeek('2026-W01', -1), '2025-W52');
  assert.equal(shiftWeek('2026-W53', 1), '2027-W01');
  for (let d = dayIdx('2025-12-01'); d < dayIdx('2027-02-01'); d++) { const k = isoWeekOf(d).key; const [a, b] = weekRange(k); assert.ok(d >= a && d <= b, isoOf(d)); }
});

test('schedule settings are read with defaults and the due moment is per week', () => {
  assert.deepEqual(validSnapshot(undefined), SNAPSHOT_DEFAULTS);
  assert.deepEqual(validSnapshot({ day: 'sun', time: '25:00', keepMonths: 7 }), { day: 'mon', time: '06:00', keepMonths: 24 });
  assert.deepEqual(validSnapshot({ day: 'fri', time: '18:00', keepMonths: '36' }), { day: 'fri', time: '18:00', keepMonths: 36 });
  const mon = dayIdx('2026-11-09');
  assert.equal(snapshotDue({}, { day: mon, min: 359 }).due, false);
  assert.equal(snapshotDue({}, { day: mon, min: 360 }).due, true);
  assert.equal(snapshotDue({}, { day: mon + 3, min: 0 }).due, true, 'later in the week: still due (taken late)');
  const fri = snapshotDue({ day: 'fri', time: '12:00' }, { day: mon + 2, min: 900 });
  assert.equal(fri.due, false);
  assert.equal(fri.nextIso, '2026-11-13');
  assert.equal(snapshotDue({}, { day: mon + 1, min: 0 }).nextIso, '2026-11-16');
});

test('a difference counts from 4 h and 5 %', () => {
  assert.equal(isSignificant(-4, 80), true);
  assert.equal(isSignificant(-3.9, 10), false);
  assert.equal(isSignificant(-5, 200), false, '2.5 % only');
  assert.equal(isSignificant(6, 0), true, 'unplanned hours');
});

test('attribution shares the hours that went elsewhere among the missing project hours, never more than missing', () => {
  const { deficit, causes } = attribute({ A: 20, B: 10, SUP: 4 }, { A: 10, B: 5, SUP: 10, C: 3 }, 6);
  assert.deepEqual(deficit, { A: 10, B: 5 });
  const total = (o) => Object.values(o).reduce((a, v) => a + v, 0);
  assert.ok(Math.abs(total(causes.A) - 10) < 1e-9, 'sources 15 h ≥ missing 15 h: A fully explained');
  assert.ok(Math.abs(total(causes.B) - 5) < 1e-9);
  assert.ok(Math.abs(causes.A.SUP - 6 * (10 / 15)) < 1e-9);
  const small = attribute({ A: 20 }, { A: 10, INT: 3 }, 0);
  assert.deepEqual(small.causes.A, { INT: 3 }, 'only 3 h went elsewhere; the rest is "booked less"');
  assert.deepEqual(attribute({ A: 5 }, { A: 6 }, 0).causes, {});
});

// six weeks of the same pattern for two teams
function records(nWeeks = 6) {
  const plans = [], acts = [];
  for (let k = 0; k < nWeeks; k++) {
    const week = shiftWeek('2026-W40', k);
    const [a, b] = weekRange(week);
    plans.push({ week, from: isoOf(a), to: isoOf(b), at: `${isoOf(a)}T05:00:00Z`,
      projects: { 'issue:1': { n: 'ERP-Integration', k: 'ERP-1', r: 1 }, 'issue:2': { n: 'Kundenportal', k: 'KPR-1', r: 2 } },
      teams: { t1: 'Integration', t2: 'Web' }, names: { p: 'Paul Richter', s: 'Sara Yilmaz', l: 'Lena Hartmann' },
      people: { p: { t: 't1', p: { 'issue:1': 20, SUP: 4 } }, s: { t: 't1', p: { 'issue:1': 10, 'issue:2': 10 } }, l: { t: 't2', p: { 'issue:2': 24 } } } });
    acts.push({ week, final: k < nWeeks - 1, people: {
      p: { t: 't1', b: { 'issue:1': 12, SUP: 10 }, absU: k === 2 ? 8 : 0 },
      s: { t: 't1', b: { 'issue:1': 10, 'issue:2': 10 } },
      l: { t: 't2', b: { 'issue:2': 20, INT: 4 } } },
    over: k === nWeeks - 1 ? [{ ref: 'issue:1', key: 'ERP-7', t: 't1', extra: 12, oe: 40 }] : [] });
  }
  return { plans, acts };
}

test('payload: the last 4 or 8 completed weeks, pending weeks named, people only where allowed', () => {
  const { plans, acts } = records(6);
  plans.push({ week: '2026-W46', people: {} });
  const p4 = buildPayload({ plans, acts, weeks: 4, canSee: (t) => t === 't1' });
  assert.equal(p4.state, 'ready');
  assert.deepEqual(p4.weeks.map((w) => w.key), ['2026-W42', '2026-W43', '2026-W44', '2026-W45']);
  assert.deepEqual(p4.pending, ['2026-W46']);
  assert.equal(p4.weeks.at(-1).final, false);
  assert.deepEqual(p4.units.map((u) => [u.id, u.kind]), [['p', 'person'], ['s', 'person'], ['team:t2', 'team']]);
  assert.equal(p4.units.find((u) => u.id === 'team:t2').name, null);
  assert.equal(p4.units.find((u) => u.id === 'p').plan['issue:1'], 80);
  assert.equal(buildPayload({ plans, acts, weeks: 8 }).weeks.length, 6);
  assert.equal(buildPayload({ plans: [], acts: [] }).state, 'none');
  assert.equal(buildPayload({ plans: [{ week: '2026-W46', people: {} }], acts: [] }).state, 'waiting');
});

test('analysis: KPIs, flow rows, people and the "why" sentence (DE and EN)', () => {
  const { plans, acts } = records(4);
  const data = buildPayload({ plans, acts, weeks: 4, canSee: () => true });
  const de = analyzePlanActual(data, { lang: 'de', summaryOf: (k) => (k === 'ERP-7' ? 'Mapping Aufträge' : null) });
  // per week: plan 20+4+10+10+24 = 68, booked 12+10+10+10+20+4 = 66
  assert.equal(de.kpis.plan, 272);
  assert.equal(de.kpis.book, 264);
  assert.equal(de.kpis.asPlanned, 4 * (12 + 4 + 10 + 10 + 20));
  assert.equal(de.kpis.diverted, 4 * (6 + 4) + 8, 'support +6, internal +4 per week, plus 8 h unplanned absence');
  assert.deepEqual(de.rows.map((r) => r.name), ['Support', 'ERP-Integration', 'Kundenportal', 'Ohne Projekt (intern)']);
  const erp = de.rows.find((r) => r.key === 'issue:1');
  assert.equal(erp.diff, -32);
  assert.equal(erp.tone, 'short');
  assert.equal(de.rows.find((r) => r.key === 'INT').unplanned, true);
  assert.equal(de.why[0].key, 'issue:1');
  // Paul: −8 h ERP each week; +6 h support explains 6 h, the other 2 h he booked less – except in week 3, where
  // support (+6) and the sick day (8) share the 8 h in proportion (3.4 + 4.6)
  assert.equal(de.why[0].sentence, 'ERP-Integration −32 h: 21 h Support über Reserve, 5 h ungeplant abwesend, 6 h weniger gebucht als möglich.');
  assert.deepEqual(de.why[0].parts.map((x) => x.k), ['SUP', 'ABS', 'REST']);
  assert.equal(de.why[0].whoText, 'Betroffen: Paul Richter');
  assert.equal(de.why[0].overText, 'Mehraufwand gegenüber Schätzung: ERP-7 Mapping Aufträge (+12 h)');
  assert.equal(de.why[1].sentence, 'Kundenportal −16 h: 16 h intern ohne Projekt.');
  const paul = de.people.find((x) => x.id === 'p');
  assert.equal(paul.main, 'ERP-Integration −32 h → Support +24 h');
  assert.equal(de.people.find((x) => x.id === 's').main, 'wie geplant');
  assert.equal(de.period, 'KW 40–43');
  assert.deepEqual(de.provisional, ['2026-W43']);

  const en = analyzePlanActual(data, { lang: 'en' });
  assert.equal(en.why[0].sentence, 'ERP-Integration −32 h: 21 h support above reserve, 5 h unplanned absence, 6 h booked less than possible.');
  assert.equal(en.rows.at(-1).name, 'No project (internal)');
  assert.equal(en.period, 'W 40–43'); // the same week label as everywhere else in English (E2E 2026-11-20)

  const web = analyzePlanActual(data, { lang: 'de', team: 't2' });
  assert.deepEqual(web.people.map((x) => x.id), ['l']);
  assert.equal(web.why.length, 1);

  // hidden team: summed, counted among the affected without names
  const hidden = analyzePlanActual(buildPayload({ plans, acts, weeks: 4, canSee: (t) => t === 't1' }), { lang: 'de' });
  assert.equal(hidden.people.at(-1).name, 'Web · nur Summe (1 Person)');
  assert.equal(hidden.why[1].whoText, 'Betroffen: 1 Person aus anderen Teams');
  assert.equal(hidden.kpis.plan, de.kpis.plan, 'the totals do not depend on who may see people');
});

test('a shortfall nobody booked elsewhere is "booked less than possible"', () => {
  const plans = [{ week: '2026-W45', projects: { A: { n: 'Alpha', r: 1 } }, teams: { t: 'T' }, names: { x: 'X' }, people: { x: { t: 't', p: { A: 30 } } } }];
  const acts = [{ week: '2026-W45', people: { x: { t: 't', b: { A: 20 } } } }];
  const a = analyzePlanActual(buildPayload({ plans, acts, canSee: () => true }), { lang: 'de' });
  assert.equal(a.why[0].sentence, 'Alpha −10 h: 10 h weniger gebucht als möglich.');
});

test('small causes are folded into "elsewhere", long name lists are cut', () => {
  const projects = { A: { n: 'Alpha', r: 1 }, B: { n: 'Beta', r: 2 }, C: { n: 'Gamma', r: 3 } };
  const plans = [{ week: '2026-W45', projects, teams: { t: 'T' }, names: { x: 'X' }, people: { x: { t: 't', p: { A: 20, B: 5, C: 5, SUP: 2 } } } }];
  const acts = [{ week: '2026-W45', people: { x: { t: 't', b: { A: 10, B: 6.5, C: 6, SUP: 9.5 } } } }];
  const a = analyzePlanActual(buildPayload({ plans, acts, canSee: () => true }), { lang: 'en' });
  assert.equal(a.why[0].sentence, 'Alpha −10 h: 8 h support above reserve, 3 h elsewhere.');
  const many = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, { t: 't', p: { A: 10 } }]));
  const p2 = [{ week: '2026-W45', projects, teams: { t: 'T' }, names: Object.fromEntries(Object.keys(many).map((id) => [id, id.toUpperCase()])), people: many }];
  const a2 = analyzePlanActual(buildPayload({ plans: p2, acts: [{ week: '2026-W45', people: {} }], canSee: () => true }), { lang: 'de' });
  assert.equal(a2.why[0].whoText, 'Betroffen: A, B, C, D, 2 weitere');
});
