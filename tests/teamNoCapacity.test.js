// A team without people / capacity (tester finding: team "Netz", 0 people, utilization "∞"): everywhere its utilization
// appears – team tiles, capacity tables, waterline rows, the report (screen, PDF, Confluence) – it reads "–" with the
// reason: "keine Kapazität gepflegt" / "no capacity maintained", or "Arbeit geplant, aber keine Kapazität" / "work planned
// but no capacity". Infinity stays an internal value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lotseDataset } from './lotseFixture.js';
import { cLevelReport, computeAll } from '../shared/engine.js';
import { teamKpis, teamUtilView, noCapacityReason, NO_CAP_TEXT } from '../shared/kpis.js';
import { reportExtras, reportKpis } from '../shared/reportKpis.js';
import { reportStorageHtml } from '../src/lib/report-html.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const fmt = { h: (v, d = 0) => `${Math.round(v * 10 ** d) / 10 ** d} h`, pct: (v) => (v == null ? '–' : `${Math.round(v * 100)} %`), quarter: (q) => q, date: (d) => String(d).slice(0, 10), n: (v) => String(Math.round(v)) };
const byId = (list) => Object.fromEntries(list.map((k) => [k.id, k]));
// "Netz" loses its two people (they move to Web): work stays planned for the team, capacity is 0
function netzWithoutPeople({ work = true } = {}) {
  const ds = lotseDataset();
  for (const p of Object.values(ds.capacity.people)) if (p.teamId === 't-netz') p.teamId = 't-web';
  if (!work) ds.issues = ds.issues.map((i) => (i.team?.id === 't-netz' ? { ...i, team: { id: 't-web', name: 'Web' } } : i));
  return ds;
}

test('the reason in words: work planned vs. nothing maintained; a percentage only with capacity', () => {
  assert.equal(noCapacityReason(12, 'de'), 'Arbeit geplant, aber keine Kapazität');
  assert.equal(noCapacityReason(12, 'en'), 'work planned but no capacity');
  assert.equal(noCapacityReason(0, 'de'), 'keine Kapazität gepflegt');
  assert.equal(noCapacityReason(0, 'en'), 'no capacity maintained');
  assert.deepEqual(teamUtilView(30, 0, { lang: 'en' }), { noCap: true, util: null, text: '–', reason: 'work planned but no capacity' });
  assert.deepEqual(teamUtilView(0, 0, { lang: 'de' }), { noCap: true, util: null, text: '–', reason: 'keine Kapazität gepflegt' });
  assert.equal(teamUtilView(30, 40, { pct: fmt.pct }).text, '75 %');
  assert.equal(NO_CAP_TEXT, '–');
});

test('team tile: "–" with the reason and the way to maintain capacities – never "∞"', () => {
  for (const lang of ['de', 'en']) {
    const k = byId(teamKpis({ computed: computeAll(netzWithoutPeople()), teamId: 't-netz', lang, fmt }));
    assert.equal(k.members.value, 0);
    assert.equal(k.util.display, '–');
    assert.equal(k.util.value, null);
    assert.equal(k.util.noCap, true);
    assert.equal(k.util.hot, true, 'work without capacity is still flagged');
    assert.match(k.util.foot, lang === 'de' ? /^Arbeit geplant, aber keine Kapazität .* · Kapazitäten pflegen$/ : /^work planned but no capacity .* · maintain capacities$/);
    assert.match(k.util.calc, lang === 'de' ? /Kapazitäten pflegen/ : /Maintain capacities/);
    assert.doesNotMatch(JSON.stringify(k.util), /∞|Infinity/);
  }
  const idle = byId(teamKpis({ computed: computeAll(netzWithoutPeople({ work: false })), teamId: 't-netz', lang: 'en', fmt }));
  assert.equal(idle.util.display, '–');
  assert.match(idle.util.foot, /^no capacity maintained · maintain capacities$/);
  assert.equal(idle.util.hot, false);
});

test('report (screen, PDF, Confluence): the team reads "–" and the reason in the waterline and the 4 weeks – no "∞"', () => {
  const ds = netzWithoutPeople();
  const report = cLevelReport(structuredClone(ds));
  Object.assign(report, reportExtras(computeAll(structuredClone(ds)), ds.config, null));
  for (const lang of ['de', 'en']) {
    const v = reportKpis({ report, lang });
    const rows = v.waterline.quarters.flatMap((q) => v.waterline.byQ[q].teams).filter((t) => t.teamId === 't-netz');
    assert.ok(rows.length, 'Netz is in the waterline');
    for (const t of rows) {
      assert.equal(t.utilText, '–');
      assert.equal(t.noCap, true);
      if (t.demand > 0.05) assert.match(t.sentence, lang === 'de' ? /^Arbeit geplant, aber keine Kapazität/ : /^Work planned but no capacity/);
      else assert.match(t.sentence, lang === 'de' ? /^Keine Kapazität gepflegt/ : /^No capacity maintained/);
    }
    const u = v.util4.teams.find((t) => t.teamId === 't-netz');
    // the next 4 weeks come from the weekly board: since 2026-11-20 the people doing Netz's work (now in Web) bring the
    // time Web does not need – so Netz shows a real load there; only with no such time it reads "–" with the reason
    if (u?.noCap) { assert.equal(u.utilText, '–'); assert.equal(u.reason, lang === 'de' ? 'Arbeit geplant, aber keine Kapazität' : 'work planned but no capacity'); }
    else if (u) { assert.ok(u.avail > 0 && /%$/.test(u.utilText), JSON.stringify(u)); }
    assert.doesNotMatch(JSON.stringify(v), /∞/);
    const html = reportStorageHtml(report, lang);
    assert.doesNotMatch(html, /∞/);
    assert.match(html, lang === 'de' ? /Arbeit geplant, aber keine Kapazität/ : /[Ww]ork planned but no capacity/);
  }
});

test('UI: every place a TEAM utilization appears uses the shared "–" + reason (source check)', () => {
  const team = read('static/cockpit/src/views/Team.jsx');
  assert.doesNotMatch(team, /'∞'/);
  assert.match(team, /noCapacityReason\(c\.demand, getLang\(\)\)/, 'quarter heat cell');
  assert.match(team, /k\.id === 'util'\)\?\.noCap/, 'the team page explains a missing capacity');
  assert.match(team, /onClick=\{\(\) => setArea\('edit'\)\}/, 'with a way to maintain capacities');
  const cap = read('static/cockpit/src/views/Capacity.jsx');
  assert.match(cap, /\{t\.cap\[k\] > 0 \? fmt\.pct\(u\)\.replace\(' ', ''\) : NO_CAP_TEXT\}/, 'team week cells');
  assert.match(cap, /\{t\.capTotal > 0 \? fmt\.pct\(avg\)\.replace\(' ', ''\) : NO_CAP_TEXT\}/, 'team average');
  assert.match(cap, /waterShown\(c\)\.capacity > 0 \? fmt\.pct\(u\) : NO_CAP_TEXT/, 'waterline cell');
  const cards = read('static/cockpit/src/lib/cards.js');
  const teamCards = cards.slice(cards.indexOf('export function teamWeekCard'), cards.indexOf('export function waterCellCard') + 1200);
  assert.doesNotMatch(teamCards, /'∞'/);
  assert.doesNotMatch(read('static/cockpit/src/views/Support.jsx'), /'∞'/);
  const wb = read('static/cockpit/src/components/WeekBoard.jsx');
  assert.match(wb, /f\.util === Infinity \? NO_CAP_TEXT : pct\(f\.util\)/, 'weekly planning total row');
  assert.match(wb, /noCap \? NO_CAP_TEXT : pct\(c\.util\)/, 'weekly planning team row');
  for (const f of ['shared/reportKpis.js', 'src/lib/report-html.js']) assert.doesNotMatch(read(f).replace(/\/\/.*$/gm, ''), /'∞'/, f);
});
