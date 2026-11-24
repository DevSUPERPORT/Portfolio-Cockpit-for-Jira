// Boss 2026-11-18: "We need all countries. Excluding the federal states. We only include state-wide holidays."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holidaysFor, holidayName, LOCATIONS, HOLIDAY_NAMES, CALENDAR_CHOICES, calendarChoices, LEGACY_CALENDARS, rulesOf } from '../shared/holidays.js';
import { COUNTRIES, RULES } from '../shared/holidayRules.js';
import { validateConfig, DEFAULT_CONFIG } from '../src/lib/config.js';

const iso = (d) => new Date(d * 864e5).toISOString().slice(0, 10);
const days = (loc, y) => [...holidaysFor(loc, y)].sort((a, b) => a - b).map(iso);

test('the select offers every country – no federal states; a state already in use stays selectable and computed', () => {
  const codes = CALENDAR_CHOICES.map((o) => o.value);
  assert.equal(codes[0], 'NONE');
  assert.ok(codes.length > 110, `${codes.length} calendars`);
  assert.ok(!codes.some((c) => c.startsWith('DE-')), 'no German state offered');
  for (const c of ['DE', 'AT', 'CH', 'HU', 'TR', 'CN', 'JP', 'IN', 'BR', 'ZA', 'SA', 'IL', 'NZ', 'CA', 'MX', 'UA']) assert.ok(codes.includes(c), c);
  assert.equal(new Set(codes).size, codes.length, 'each country once');
  // sorted by the English name after "no holidays"
  const en = CALENDAR_CHOICES.slice(1).map((o) => o.label.split(' / ')[0]);
  assert.equal(LOCATIONS.DE, 'Germany / Deutschland', 'English first, then the country name');
  assert.equal(LOCATIONS.GR, 'Greece / Ελλάδα');
  assert.equal(LOCATIONS.XK, 'Kosovo / Kosova');
  for (const k of ['GB', 'GB-NIR', 'GB-SCT']) assert.ok(!LOCATIONS[k].includes(' / '), `${k}: the name once (${LOCATIONS[k]})`);
  assert.equal(LOCATIONS['GB-SCT'], 'United Kingdom (Scotland)');
  assert.deepEqual(en, [...en].sort((a, b) => a.localeCompare(b, 'en')));
  // legacy: still valid, still computed, offered only to the location that has it
  assert.ok(LEGACY_CALENDARS.has('DE-BY') && LOCATIONS['DE-BY']);
  assert.ok(days('DE-BY', 2026).includes('2026-01-06'));
  assert.ok(calendarChoices('DE-BY').some((o) => o.value === 'DE-BY' && o.legacy));
  assert.ok(!calendarChoices('AT').some((o) => o.legacy));
  const cfg = validateConfig({ ...structuredClone(DEFAULT_CONFIG), portfolio: { source: 'space' }, levels: [{ key: 'story', name: 'Story', role: 'estimate', issueTypeIds: ['10001'] }], capacityDefaults: { defaultWeeklyHours: 40, defaultLocation: 'JP' } });
  assert.equal(cfg.capacityDefaults.defaultLocation, 'JP', 'a new country is a valid default');
});

test('every rule parses, every calendar computes 2025–2032 and names every day', () => {
  for (const [code] of COUNTRIES) assert.ok(Object.hasOwn(RULES, code), code);
  for (const code of Object.keys(RULES)) rulesOf(code);
  for (const loc of Object.keys(LOCATIONS)) for (let y = 2025; y <= 2032; y++) for (const d of holidaysFor(loc, y)) {
    assert.ok(HOLIDAY_NAMES[holidayName(loc, d)], `${loc} ${iso(d)} ${holidayName(loc, d)}`);
    assert.equal(new Date(d * 864e5).getUTCFullYear(), y, `${loc}: ${iso(d)} belongs to ${y}`);
  }
  assert.deepEqual(days('UA', 2026), [], 'Ukraine under martial law: no public holidays');
});

test('only state-wide days: Switzerland keeps what every canton has', () => {
  assert.deepEqual(days('CH', 2026), ['2026-01-01', '2026-05-14', '2026-08-01', '2026-12-25']);
  assert.deepEqual(days('IN', 2026), ['2026-01-26', '2026-08-15', '2026-10-02'], 'India: the three national holidays');
  assert.deepEqual(days('CA', 2026), ['2026-01-01', '2026-04-03', '2026-07-01', '2026-09-07', '2026-12-25'], 'Canada: nationwide statutory days');
});

test('lunar and moving holidays are computed (Intl calendars, equinox, Qingming)', () => {
  assert.ok(days('TR', 2026).includes('2026-03-20') && days('TR', 2026).includes('2026-05-27'), 'Eid al-Fitr / al-Adha 2026');
  assert.ok(days('CN', 2026).includes('2026-02-17') && days('CN', 2026).includes('2026-04-05') && days('CN', 2026).includes('2026-09-25'), 'Spring Festival, Qingming, Mid-Autumn');
  assert.ok(days('IL', 2026).includes('2026-09-12') && days('IL', 2026).includes('2026-09-21') && days('IL', 2026).includes('2026-04-02'), 'Rosh Hashanah, Yom Kippur, Passover');
  assert.ok(days('KR', 2026).includes('2026-09-25') && days('KR', 2026).includes('2026-05-24'), 'Chuseok, Buddha\'s birthday');
  assert.ok(days('ET', 2026).includes('2026-09-11') && days('ET', 2026).includes('2026-01-07'), 'Ethiopian New Year, Genna');
  // Japan: equinoxes, the Monday holidays, a Sunday holiday moves on, a day between two holidays is off
  const jp = days('JP', 2026);
  for (const d of ['2026-03-20', '2026-09-23', '2026-01-12', '2026-05-06', '2026-09-22']) assert.ok(jp.includes(d), `JP ${d}`);
});

test('substitute days: Scotland and New Zealand move weekend days to the next free working day; South Africa Sunday → Monday', () => {
  const sct = days('GB-SCT', 2027);
  for (const d of ['2027-01-04', '2027-12-27', '2027-12-28']) assert.ok(sct.includes(d), `GB-SCT ${d}`);
  assert.ok(days('NZ', 2026).includes('2026-12-28') && days('NZ', 2026).includes('2026-07-10'), 'Boxing Day on Saturday → Monday; Matariki');
  assert.ok(days('ZA', 2026).includes('2026-08-10'), "Women's Day on a Sunday → Monday");
});
