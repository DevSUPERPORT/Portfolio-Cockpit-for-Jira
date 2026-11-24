// My work's week tooltip (boss 2026-11-23): the whole calculation, the whole period, the days off by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekCalc, weekInfo, weekPeriod } from '../static/cockpit/src/lib/weekCard.js';
import { daysOffOf } from '../shared/locations.js';
import { dayIdx } from '../shared/dates.js';

test('the calculation: weekly hours − days off − daily business = time; planned − time = too much; planned ÷ time = %', () => {
  const c = weekCalc({ from: '2026-11-23', to: '2026-11-27', plan: 73.04, cap: 28, nominal: 40, off: 8, daily: 4, holidays: 0, absent: 1, days: 4, support: 2, tasks: 71.04 });
  assert.match(c, /40 h Wochenstunden/);
  assert.match(c, /− 8 h abwesend \(1 Tag\)/);
  assert.match(c, /− 4 h Tagesgeschäft & Intern/);
  assert.match(c, /= 28 h Zeit für Projekte/);
  assert.match(c, /73,04 h geplant \(Tasks 71,04 h \+ Support 2 h\)/);
  assert.match(c, /73,04 h − 28 h = 45,04 h zu viel/);
  assert.match(c, /73,04 h ÷ 28 h = 261 %/);
  const fits = weekCalc({ from: '2026-12-07', to: '2026-12-11', plan: 20.25, cap: 28, nominal: 40, off: 8, daily: 4, holidays: 1, absent: 0, days: 4 });
  assert.match(fits, /− 8 h Feiertag \/ frei \(1 Tag\)/);
  assert.match(fits, /28 h − 20,25 h = 7,75 h frei/);
  assert.match(fits, /20,25 h ÷ 28 h = 72 %/);
  assert.match(weekCalc({ plan: 10, cap: 0, nominal: 40, off: 40, daily: 0, holidays: 0, absent: 5, days: 0 }), /keine Zeit/);
});

test('the period is Monday to Friday with the year; the days off are listed', () => {
  assert.equal(weekPeriod({ from: '2026-12-07', to: '2026-12-11' }), '07.12. – 11.12.2026');
  const k = weekInfo({ from: '2026-12-21', to: '2026-12-25', plan: 0, cap: 24, nominal: 40, off: 16, daily: 0, holidays: 1, absent: 1, days: 3,
    daysOff: [{ iso: '2026-12-24', kind: 'absent', type: 'vacation' }, { iso: '2026-12-25', kind: 'holiday', name: '1. Weihnachtstag' }] }, { text: 'x' });
  assert.equal(k.sub, '21.12. – 25.12.2026 · 3 Arbeitstage');
  assert.deepEqual(k.items.map((i) => i.text), ['Do 24.12. · Urlaub', 'Fr 25.12. · Feiertag: 1. Weihnachtstag']);
  assert.equal(k.itemsTitle, 'Freie Tage');
});

test('daysOffOf: public holidays by name on working days, absences without reason unless allowed', () => {
  const person = { id: 'a', location: 'DE-NW' };
  const absences = [{ accountId: 'a', from: '2026-12-21', to: '2026-12-23', type: 'vacation' }, { accountId: 'b', from: '2026-12-21', to: '2026-12-23', type: 'vacation' }];
  const list = daysOffOf({}, person, absences, dayIdx('2026-12-21'), dayIdx('2026-12-27'));
  assert.deepEqual(list.map((d) => [d.iso, d.kind]), [['2026-12-21', 'absent'], ['2026-12-22', 'absent'], ['2026-12-23', 'absent'], ['2026-12-25', 'holiday']]);
  assert.ok(list.find((d) => d.kind === 'holiday').name, 'the holiday has its name');
  assert.equal(list[0].type, null, 'no reason by default');
  assert.equal(daysOffOf({}, person, absences, dayIdx('2026-12-21'), dayIdx('2026-12-21'), { reasons: true })[0].type, 'vacation');
});

test('the sentence above a calculation uses the same hours (boss 2026-11-23: "29 h / 22 h" over "28.5 h / 21.86 h")', async () => {
  const { readFileSync } = await import('node:fs');
  const { hExact } = await import('../static/cockpit/src/lib/weekCard.js');
  assert.equal(hExact(28.5), '28,5 h');
  assert.equal(hExact(21.86), '21,86 h');
  assert.equal(hExact(40), '40 h');
  const mine = readFileSync(new URL('../static/cockpit/src/views/Mine.jsx', import.meta.url), 'utf8');
  assert.match(mine, /weekInfo\(w, \{ text: fitSentence\(fitOf\(w\.plan, w\.cap\), null, hExact\)/, 'week strip card');
  assert.match(mine, /fitSentence\(fit, null, hExact\)/, 'load-this-week card');
  const board = readFileSync(new URL('../static/cockpit/src/components/WeekBoard.jsx', import.meta.url), 'utf8');
  assert.equal((board.match(/fitSentence\(/g) || []).length, (board.match(/fitSentence\([^;]*?hCalc\)/g) || []).length, 'every board card sentence uses the calculation\'s format');
  const lf = readFileSync(new URL('../static/cockpit/src/components/LoadFit.jsx', import.meta.url), 'utf8');
  assert.match(lf, /export const fitSentence = \(f, who = null, H = hRound\)/);
});
