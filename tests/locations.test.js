// Locations (UC-09): named locations with their own holiday calendar, working days, deselected public holidays and
// company days off – and every capacity number that depends on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validLocations, resolveLocation, holidaysFor, isWorkday, personDays, migrateLocations, remapPeople, countByLocation,
  locationId, locationOptions, upcomingDays, MAX_LOCATIONS, MAX_OWN_DAYS,
} from '../shared/locations.js';
import { holidaysBetween, holidayName, HOLIDAY_NAMES, LOCATIONS } from '../shared/holidays.js';
import { dayIdx, workdays } from '../shared/dates.js';
import { computeAll, personCapacityIn } from '../shared/engine.js';
import { personWeekAvail } from '../shared/weekPlan.js';
import { personWeek } from '../shared/team.js';
import { bookingOverview } from '../shared/booking.js';
import { myProfile, buildWeek } from '../shared/mine.js';

const D = dayIdx;
const HH = { id: 'hamburg', name: 'Hamburg', calendar: 'DE-HH', workdays: [1, 2, 3, 4, 5], off: ['2026-12-26'], own: [{ d: '2026-12-28', name: 'Betriebsruhe' }] };
const WIEN = { id: 'wien', name: 'Wien', calendar: 'AT', workdays: [1, 2, 3, 4], off: [], own: [] };

test('validLocations: strict ids, known calendars, valid dates, limits', () => {
  const v = validLocations([
    HH,
    { ...HH, name: 'Doppelt' }, // duplicate id
    { id: 'Bad Id', name: 'x', calendar: 'DE' },
    { id: 'mars', name: '  Mars  Base ', calendar: 'MARS', workdays: [0, 8, 'x'], off: ['2026-02-30', '2026-01-01'], own: [{ d: 'nope' }, { d: '2026-05-02', name: 'Brückentag' }, { d: '2026-05-02', name: 'again' }] },
    null, 'x',
  ]);
  assert.deepEqual(v.map((l) => l.id), ['hamburg', 'mars']);
  assert.equal(v[1].name, 'Mars Base');
  assert.equal(v[1].calendar, 'NONE', 'unknown calendar → none');
  assert.deepEqual(v[1].workdays, [1, 2, 3, 4, 5], 'no valid working day → Monday–Friday');
  assert.deepEqual(v[1].off, ['2026-01-01'], 'invalid dates dropped');
  assert.deepEqual(v[1].own, [{ d: '2026-05-02', name: 'Brückentag' }], 'one company day per date');
  assert.deepEqual(validLocations(undefined), []);
  assert.deepEqual(validLocations({ locations: [WIEN] })[0].workdays, [1, 2, 3, 4]);
  const many = validLocations(Array.from({ length: 40 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, calendar: 'DE', own: Array.from({ length: 80 }, (__, k) => ({ d: `2027-0${1 + (k % 9)}-${String(1 + Math.floor(k / 9)).padStart(2, '0')}`, name: 'x' })) })));
  assert.equal(many.length, MAX_LOCATIONS);
  assert.equal(many[0].own.length, MAX_OWN_DAYS);
  assert.equal(locationId('Köln Süd', [{ id: 'koln-sud' }]), 'koln-sud-2');
});

test('resolveLocation: a location id, a calendar code (legacy or mapped to a location), or none', () => {
  const list = validLocations([HH, WIEN]);
  assert.equal(resolveLocation(list, 'hamburg').name, 'Hamburg');
  assert.equal(resolveLocation({ locations: list }, 'wien').perWeek, 4);
  assert.equal(resolveLocation({ cfg: { locations: list } }, 'DE-HH').id, 'hamburg', 'a calendar code stands for the location with that calendar');
  const legacy = resolveLocation(list, 'DE-BY');
  assert.equal(legacy.legacy, true); assert.equal(legacy.calendar, 'DE-BY'); assert.equal(legacy.perWeek, 5);
  assert.equal(resolveLocation(list, 'deleted-place').calendar, 'NONE', 'unknown id → no holidays');
  assert.equal(resolveLocation([], 'AT').calendar, 'AT');
  assert.equal(resolveLocation([], undefined).calendar, 'NONE');
  assert.equal(locationOptions(list).length, 2);
  assert.equal(locationOptions([]).length, Object.keys(LOCATIONS).length - 16, 'without locations: the calendars – every country, no German states');
});

test('days off = calendar holidays − deselected + company days off; working days per location', () => {
  const list = validLocations([HH, WIEN]);
  const h = holidaysFor(list, 'hamburg', '2026-12-01', '2026-12-31');
  assert.ok(h.has(D('2026-12-25')));
  assert.ok(!h.has(D('2026-12-26')), 'deselected');
  assert.ok(h.has(D('2026-12-28')), 'company day off');
  assert.equal(isWorkday(list, 'hamburg', '2026-12-28'), false);
  assert.equal(isWorkday(list, 'hamburg', '2026-12-29'), true);
  assert.equal(isWorkday(list, 'wien', '2026-11-13'), false, 'Friday is no working day in a Monday–Thursday week');
  assert.equal(isWorkday(list, 'wien', '2026-12-08'), false, 'Austrian holiday');
  assert.equal(isWorkday(list, 'wien', '2026-12-09'), true);
  assert.equal(HOLIDAY_NAMES[holidayName('DE', D('2026-10-03'))][0], 'Tag der Deutschen Einheit');
  const days = upcomingDays(list[0], '2026-12-20', '2026-12-31', 'de');
  assert.deepEqual(days.map((x) => [x.iso, x.kind, x.deselected]), [['2026-12-25', 'holiday', false], ['2026-12-26', 'holiday', true], ['2026-12-28', 'own', false]]);
});

test('without locations every number stays exactly as before (Monday–Friday, calendar holidays)', () => {
  const absences = [{ accountId: 'p', from: '2026-04-01', to: '2026-04-09' }, { accountId: 'p', from: '2026-12-23', to: '2027-01-02' }];
  for (const code of ['NONE', 'DE', 'DE-BY', 'AT', 'GB', 'US', 'GR', 'CH']) {
    for (const [a, b] of [['2026-01-01', '2026-12-31'], ['2026-03-30', '2026-04-12'], ['2026-12-21', '2027-01-10'], ['2026-11-09', '2026-11-15']]) {
      const A = D(a), B = D(b);
      const hol = holidaysBetween(code, A, B);
      let absent = 0;
      for (const ab of absences) { const s = Math.max(A, D(ab.from)), e = Math.min(B, D(ab.to)); if (e >= s) absent += workdays(s, e, hol); }
      const r = personDays([], { id: 'p', location: code }, absences, A, B);
      assert.equal(r.all, workdays(A, B), `${code} ${a} all`);
      assert.equal(r.work, workdays(A, B, hol), `${code} ${a} work`);
      assert.equal(r.absent, absent, `${code} ${a} absent`);
      assert.equal(r.perWeek, 5);
    }
  }
});

// Today is Wednesday 11 Nov 2026; the week of 14 Dec has nothing special, the week of 28 Dec has the company days off.
function fixture(locations) {
  return {
    today: '2026-11-11',
    config: { locations },
    portfolio: [], issues: [], teams: [{ id: 't1', name: 'Web' }], people: { u1: { name: 'Anna' }, u2: { name: 'Ben' } },
    capacity: {
      people: { u1: { weeklyHours: 40, location: 'hamburg', teamId: 't1' }, u2: { weeklyHours: 32, location: 'wien', teamId: 't1' } },
      absences: [], teams: { t1: { dailyBusinessPct: 0, internalPct: 0 } },
    },
    supportComputed: { personWeekly: {}, teams: [], services: [], reserveQuarter: {} },
  };
}

test('capacity: company days off and a 4-day week flow into engine, week plan, team week and booking check', () => {
  const ds = fixture(validLocations([HH, WIEN]));
  const c = computeAll(ds);
  const { model } = c;
  const anna = { id: 'u1', weeklyHours: 40, location: 'hamburg', teamId: 't1' };
  const ben = { id: 'u2', weeklyHours: 32, location: 'wien', teamId: 't1' };
  const normal = [D('2026-12-14'), D('2026-12-20')], xmas = [D('2026-12-28'), D('2027-01-03')];
  assert.equal(personCapacityIn(model, anna, ...normal), 40);
  assert.equal(personCapacityIn(model, anna, ...xmas), 24, 'company day 28 Dec + New Year 1 Jan: 3 of 5 days');
  assert.equal(personCapacityIn(model, ben, ...normal), 32, '32 h over Monday–Thursday');
  assert.equal(personCapacityIn(model, ben, D('2026-12-07'), D('2026-12-13')), 24, '8 Dec (Mariä Empfängnis) in Vienna: 3 of 4 days');
  const w = personWeekAvail(model, anna, ...xmas);
  assert.deepEqual([w.nominal, w.holidays, w.days, w.gross], [40, 2, 3, 24]);
  const pw = personWeek(c, 'u2', ...normal);
  assert.deepEqual([pw.all, pw.perWeek, pw.days, pw.gross], [4, 4, 4, 32]);
  const o = bookingOverview(model, { people: {} }, D('2026-12-07'), D('2026-12-13'), {});
  const r = Object.fromEntries(o.rows.map((x) => [x.id, x]));
  assert.equal(r.u1.possible, 40); assert.equal(r.u2.possible, 24); assert.equal(r.u2.days, 3); assert.equal(r.u2.off, 1);
  // deselecting the holiday gives the day back
  const c2 = computeAll(fixture(validLocations([HH, { ...WIEN, off: ['2026-12-08'] }])));
  assert.equal(personCapacityIn(c2.model, ben, D('2026-12-07'), D('2026-12-13')), 32);
});

test('my work: hours per day over the location\'s working days, free weekdays without a target', () => {
  const ds = fixture(validLocations([HH, WIEN]));
  const c = computeAll(ds);
  const prof = myProfile(c, 'u2');
  assert.equal(prof.locationName, 'Wien');
  assert.equal(prof.perWeek, 4);
  const sheet = buildWeek({ computed: c, data: { from: '2026-12-14', to: '2026-12-18', issues: [], worklogs: [] }, meId: 'u2', today: '2026-12-14' });
  assert.deepEqual(sheet.days.map((d) => d.possible), [8, 8, 8, 8, 0]);
  assert.equal(sheet.days[4].free, true);
});

test('my work: a free weekday is never "missing"; holidays and company days off carry their name', () => {
  const c = computeAll(fixture(validLocations([HH, WIEN])));
  // Vienna, week of 7 Dec, everything in the past: 8 Dec is a public holiday, Friday is not a working day
  const w = buildWeek({ computed: c, data: { from: '2026-12-07', to: '2026-12-11', issues: [], worklogs: [] }, meId: 'u2', today: '2026-12-21' });
  assert.deepEqual(w.days.map((d) => d.possible), [8, 0, 8, 8, 0]);
  assert.deepEqual(w.dayTotals.map((d) => d.low), [true, false, true, true, false], 'only working days are marked');
  assert.equal(w.days[1].holidayName, 'Mariä Empfängnis');
  assert.equal(w.booked.soll, 24, 'the target counts working days only');
  const en = buildWeek({ computed: c, data: { from: '2026-12-07', to: '2026-12-11', issues: [], worklogs: [] }, meId: 'u2', today: '2026-12-21', lang: 'en' });
  assert.equal(en.days[1].holidayName, 'Immaculate Conception');
  // Hamburg, week of 28 Dec: the company day off and New Year by name
  const h = buildWeek({ computed: c, data: { from: '2026-12-28', to: '2027-01-01', issues: [], worklogs: [] }, meId: 'u1', today: '2027-01-04' });
  assert.deepEqual([h.days[0].holidayName, h.days[0].company, h.days[4].holidayName, h.days[4].company], ['Betriebsruhe', true, 'Neujahr', false]);
  assert.equal(h.days[2].holidayName, null);
});

test('migrateLocations: one location per calendar in use; people keep working through their codes', () => {
  const people = { a: { location: 'DE-NW' }, b: { location: 'DE-NW' }, c: { location: 'AT' }, d: { location: 'NONE' }, e: {} };
  const locs = migrateLocations(people);
  assert.deepEqual(locs.map((l) => [l.calendar, l.name]), [['AT', 'Österreich'], ['DE-NW', 'Nordrhein-Westfalen']]);
  assert.deepEqual(countByLocation(locs, people), { 'nordrhein-westfalen': 2, osterreich: 1, NONE: 2 });
  assert.equal(remapPeople(people, locs).a.location, 'nordrhein-westfalen');
  assert.equal(remapPeople(people, locs).d.location, 'NONE');
});
