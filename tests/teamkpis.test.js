// Teamdetails tiles: the same registry as the portfolio – every tile explains itself, and the numbers agree
// with the team view, the waterline and the capacity formula.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAll } from '../shared/engine.js';
import { teamKpis, teamDefinitions } from '../shared/kpis.js';
import { teamDetails } from '../shared/team.js';

const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url)));
const fmt = { h: (v, d = 0) => `${Math.round(v * 10 ** d) / 10 ** d} h`, pct: (v) => (v == null ? '–' : `${Math.round(v * 100)} %`), quarter: (q) => q, date: (d) => String(d).slice(0, 10) };
const byId = (list) => Object.fromEntries(list.map((k) => [k.id, k]));

test('every team tile has a definition, a calculation with numbers, inputs and items – in German and English', () => {
  const c = computeAll(structuredClone(golden));
  for (const lang of ['de', 'en']) for (const teamId of ['web', 'data']) {
    const kpis = teamKpis({ computed: c, teamId, lang, fmt });
    assert.deepEqual(kpis.map((k) => k.id), teamDefinitions(lang).map((d) => d.id));
    for (const k of kpis) {
      assert.ok(k.label && k.text && k.display != null && k.foot, `${teamId} ${k.id}`);
      assert.ok(typeof k.calc === 'string' && k.calc.length > 3, `${teamId} ${k.id} calc`);
      assert.ok(Array.isArray(k.inputs) && Array.isArray(k.items), `${teamId} ${k.id}`);
    }
  }
});

test('the tiles show the same numbers as the team view and the waterline', () => {
  const c = computeAll(structuredClone(golden));
  const td = teamDetails(c, 'web');
  const k = byId(teamKpis({ computed: c, teamId: 'web', lang: 'en', fmt }));
  const q0 = td.quarters[0];
  assert.equal(k.util.value, td.cells[q0].util);
  assert.equal(k.support.value, td.supportWeekly);
  assert.equal(k.support.value * 12, c.support?.reserveQuarter?.web ?? c.wl.cells.web[q0].support, 'support per week × 12 = the waterline reserve');
  assert.equal(k.watch.value, td.watch.length);
  assert.equal(k.watch.items.length, td.watch.length);
  assert.equal(k.members.items.length, k.members.value);
  assert.equal(k.util.hot, td.cells[q0].util > 1.0001, 'red only when overbooked');
});

test("the boss's week on the tile: 40 h − 8 h daily business − 4 h internal − support = for projects", () => {
  const ds = structuredClone(golden);
  ds.capacity = { people: { boss: { weeklyHours: 40, location: 'NONE', teamId: 'web' } }, teams: { web: { name: 'Web', dailyBusinessPct: 20, internalPct: 10, absenceRatePct: 0 } }, absences: [] };
  ds.supportComputed = { reserveQuarter: {}, personWeekly: {}, teams: [], services: [] };
  const c = computeAll(ds);
  const k = byId(teamKpis({ computed: c, teamId: 'web', lang: 'de', fmt, people: { boss: { name: 'Jonas' } } }));
  assert.equal(k.available.value, 28);
  assert.equal(k.available.calc, '40 h − 8 h Tagesgeschäft − 4 h intern = 28 h');
  assert.match(k.available.items[0].sub, /40 h − 8 h − 4 h = 28 h für Projekte/);
  assert.equal(k.members.items[0].text, 'Jonas');
});

// (was "∞ in red" – a tester read "∞" for team Netz with 0 people as a bug: now "–" and the reason, still flagged)
test('a team with demand but nobody with capacity: "–" flagged red, and the reason in words', () => {
  const ds = structuredClone(golden);
  ds.capacity = { people: {}, teams: { web: { name: 'Web', dailyBusinessPct: 20 } }, absences: [] };
  ds.issues = ds.issues.map((i) => ({ ...i, assignee: null }));
  const k = byId(teamKpis({ computed: computeAll(ds), teamId: 'web', lang: 'en', fmt }));
  assert.equal(k.util.display, '–');
  assert.equal(k.util.hot, true);
  assert.match(k.util.calc, /demand but 0 h capacity – nobody with capacity is assigned to the team/);
  assert.match(k.util.foot, /^work planned but no capacity/);
  assert.match(k.members.calc, /Nobody with capacity assigned = 0 h/);
});

test('every tile calculation adds up as written (no rounding that breaks the sum)', () => {
  const ds = structuredClone(golden);
  ds.capacity = { people: { a: { weeklyHours: 40, location: 'NONE', teamId: 'web' } }, teams: { web: { name: 'Web', dailyBusinessPct: 20, internalPct: 10 } }, absences: [] };
  ds.supportComputed = { reserveQuarter: { web: 6 }, personWeekly: {}, teams: [], services: [] };
  const k = byId(teamKpis({ computed: computeAll(ds), teamId: 'web', lang: 'en', fmt }));
  assert.equal(k.available.calc, '40 h − 8 h daily business − 4 h internal − 0.5 h Support = 27.5 h');
});

// the hover card of every heatmap cell uses the same arithmetic as the heatmap itself
import { personWeek, teamWeeks, teamWeekItems } from '../shared/team.js';
import { dayIdx } from '../shared/dates.js';
test('heatmap hover cards: available and planned hours equal the cell, team stories add up to the team row', () => {
  const ds = structuredClone(golden);
  ds.capacity = { people: { u1: { weeklyHours: 40, location: 'DE-NW', teamId: 'web' } }, teams: { web: { name: 'Web', dailyBusinessPct: 20, internalPct: 10 } }, absences: [{ accountId: 'u1', from: ds.today || '2026-11-10', to: ds.today || '2026-11-10' }] };
  const c = computeAll(ds);
  for (const t of ['web', 'data']) {
    const tw = teamWeeks(c, t);
    tw.weeks.forEach((w, k) => {
      for (const r of tw.rows) {
        const pw = personWeek(c, r.id, dayIdx(w.from), dayIdx(w.to));
        assert.ok(Math.abs(pw.cap - r.cap[k]) < 0.01, `${t} ${r.id} week ${k} capacity ${pw.cap} vs ${r.cap[k]}`);
        assert.ok(Math.abs(pw.plan - r.plan[k]) < 0.06 * Math.max(1, pw.items.length), `${t} ${r.id} week ${k} planned ${pw.plan} vs ${r.plan[k]}`);
        assert.ok(Math.abs(pw.gross - pw.daily - pw.internal - pw.support - pw.cap) < 0.01 || pw.cap === 0, 'the card calculation adds up');
      }
      const sum = teamWeekItems(c, t, dayIdx(w.from), dayIdx(w.to)).reduce((a, x) => a + x.h, 0);
      const tp = tw.plan[k] ?? 0; // a team without people has no weekly rows
      assert.ok(Math.abs(sum - tp) < 0.1 * Math.max(1, Math.ceil(tp / 10)), `${t} week ${k} team ${sum} vs ${tp}`);
    });
  }
});
