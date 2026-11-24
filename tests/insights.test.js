// Insights engine (shared/insights.js): every number recomputed by hand from the inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, weeksUtilization, computeAll } from '../shared/engine.js';
import { dayIdx, isoOf, mondayOf } from '../shared/dates.js';
import {
  median, percentile, trimmedMean, tokens, stem, fmtH, realisticCapacity, supportWeekly, estimateFactors, similarWork, supportTopics, overtimeOutlook,
} from '../shared/insights.js';
import { mockHistory, mockComments } from '../static/cockpit/src/lib/mockHistory.js';

const TODAY = '2026-11-11'; // a Wednesday; this week starts Monday 2026-11-09
const MON = mondayOf(dayIdx(TODAY));
const wk = (k) => isoOf(MON + k * 7); // Monday of week k (0 = this week, -1 = last week)
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.051, `${msg}: ${a} ≠ ${b}`);

// One team, two people of 40 h, 20 % daily business, no holidays (location NONE) → 32 h each, 64 h per week.
function dataset() {
  const story = (id, o) => ({ id, key: `A-${id}`, summary: `Story ${id}`, role: 'estimate', status: { cat: 'new' }, team: { id: 't1', name: 'Team One' }, links: [], worklogs: [], fixVersionIds: [], quarters: [], ...o });
  return {
    today: TODAY, config: { levels: [] },
    portfolio: [{ ref: 'p1', rank: 1, name: 'Alpha', kind: 'issue' }, { ref: 'p2', rank: 2, name: 'Beta', kind: 'issue' }],
    issues: [
      story('1', { rootRef: 'p1', re: 20, start: wk(0), due: isoOf(MON + 4), assignee: { id: 'u1' } }), // week 0
      story('2', { rootRef: 'p1', re: 10, start: wk(0), due: isoOf(MON + 4), assignee: { id: 'u2' } }), // week 0
      story('3', { rootRef: 'p2', re: 40, start: wk(1), due: isoOf(MON + 11), assignee: { id: 'u1' } }), // week 1
      story('4', { rootRef: 'p1', re: 30, start: wk(1), due: isoOf(MON + 11), assignee: { id: 'u2' } }), // week 1
    ],
    teams: [{ id: 't1', name: 'Team One' }], people: { u1: { id: 'u1', name: 'Una' }, u2: { id: 'u2', name: 'Udo' } },
    capacity: { people: { u1: { weeklyHours: 40, teamId: 't1', location: 'NONE' }, u2: { weeklyHours: 40, teamId: 't1', location: 'NONE' } }, teams: { t1: { dailyBusinessPct: 20, internalPct: 0, absenceRatePct: 0 } }, absences: [] },
    // measured support worklogs of the last 8 full weeks (oldest first)
    supportComputed: { teams: [{ teamId: 't1', trend: [4, 6, 8, 10, 2, 6, 12, 8], weekly: 7 }], personWeekly: {}, reserveQuarter: {}, weeklyTotal: 7 },
  };
}
// history: four earlier weeks of support (weeks −12 … −9) and six done stories of team t1
function history() {
  const st = (id, oe, ts) => ({ id: `h${id}`, key: `H-${id}`, summary: `Done ${id}`, team: { id: 't1' }, oe, ts, statusCat: 'done', resolved: wk(-5) });
  return {
    supportSince: wk(-12),
    support: [
      { id: 's1', key: 'S-1', summary: 'x', team: { id: 't1' }, spentH: 8, resolved: wk(-9), worklogs: [{ d: wk(-12), h: 5, a: 'u1' }, { d: wk(-9), h: 3, a: 'u1' }] },
      { id: 's2', key: 'S-2', summary: 'y', team: { id: 't1' }, spentH: 7, resolved: wk(-10), worklogs: [{ d: isoOf(MON - 70 + 2), h: 7, a: 'u2' }] },
      // inside the measured 8 weeks: the worklog trend wins, this must not count twice
      { id: 's3', key: 'S-3', summary: 'z', team: { id: 't1' }, spentH: 100, resolved: wk(-3), worklogs: [{ d: wk(-3), h: 100, a: null }] },
    ],
    stories: [st(1, 10, 12), st(2, 10, 13), st(3, 10, 15), st(4, 10, 11), st(5, 10, 14), st(6, 10, 50), st(7, 0, 9), st(8, 10, 0)],
  };
}

test('statistics: median, nearest-rank P80, trimmed mean', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  const s = [5, 0, 7, 3, 4, 6, 8, 10, 2, 6, 12, 8];
  assert.equal(percentile(s, 0.8), 8, '12 values: the 10th smallest (ceil(0.8 × 12) = 10)');
  assert.equal(percentile([1, 2, 3, 4, 5], 0.8), 4);
  assert.equal(percentile([7], 0.8), 7);
  const t = trimmedMean([1.2, 1.3, 1.5, 1.1, 1.4, 5]);
  close(t.mean, 1.35, 'lowest and highest dropped');
  assert.deepEqual([t.n, t.trimmed], [6, 2]);
  assert.equal(trimmedMean([1, 2, 9]).mean, 4, 'below 5 values nothing is trimmed');
});

test('text: umlauts folded, stop words dropped, plurals stemmed, synonyms merged', () => {
  assert.deepEqual(tokens('Die Schnittstellen für das ERP'), ['schnittstell', 'erp']);
  assert.deepEqual(tokens('Schnittstelle'), ['schnittstell']);
  assert.deepEqual(tokens('Kennwort / Password zurücksetzen'), ['passwort', 'passwort', 'zuruecksetz']);
  assert.deepEqual(tokens('Exports 2026 v2'), ['export', 'v2']);
  assert.equal(stem('anbindungen'), 'anbindung');
  assert.equal(fmtH(12.6, 'de'), '13 h');
  assert.equal(fmtH(2.25, 'de'), '2,3 h');
  assert.equal(fmtH(0.5, 'en'), '0.5 h');
});

test('support reality: last 8 weeks from worklogs, earlier weeks from the history, P80 of the weeks', () => {
  const model = buildModel(dataset());
  const s = supportWeekly({ model, support: dataset().supportComputed, history: history() });
  const t1 = s.teams.get('t1');
  assert.deepEqual(t1.series.map((x) => x.h), [5, 0, 7, 3, 4, 6, 8, 10, 2, 6, 12, 8]);
  assert.deepEqual(t1.series.map((x) => x.week), Array.from({ length: 12 }, (_, i) => wk(i - 12)));
  assert.equal(t1.series[3].src, 'history');
  assert.equal(t1.series[4].src, 'worklogs');
  assert.equal(t1.median, 6);
  assert.equal(t1.p80, 8);
  assert.equal(t1.source, 'worklogs+history');
  // people from the history worklogs (u1: 5 h in week −12 and 3 h in week −9)
  assert.deepEqual(s.people.get('u1').series.filter((x) => x.h).map((x) => [x.week, x.h]), [[wk(-12), 5], [wk(-9), 3]]);
});

test('support without worklogs: Time Spent spread evenly over the weeks from creation (max 4) to resolution', () => {
  const model = buildModel(dataset());
  const h = { supportSince: wk(-8), support: [{ id: 'a', team: { id: 't1' }, spentH: 6, created: wk(-6), resolved: isoOf(MON - 28 + 3), assignee: 'u1' }] };
  const s = supportWeekly({ model, support: null, history: h });
  const series = s.teams.get('t1').series;
  assert.deepEqual(series.map((x) => x.h), [0, 0, 2, 2, 2, 0, 0, 0], '6 h over weeks −6, −5, −4');
});

test('estimate factor: time spent ÷ estimate of done stories, trimmed mean, without unestimated or unbooked stories', () => {
  const model = buildModel(dataset());
  const e = estimateFactors({ model, history: history() });
  const f = e.factorFor('t1');
  close(f.factor, 1.35, 'ratios 1.1 … 1.5 and 5.0 → 1.2, 1.3, 1.4, 1.5');
  assert.deepEqual([f.n, f.trimmed, f.source], [6, 2, 'team']);
  const other = e.factorFor('t-unknown');
  assert.equal(other.source, 'all', 'too few own stories: the overall factor');
  const none = estimateFactors({ model, history: { stories: [] } }).factorFor('t1');
  assert.deepEqual([none.factor, none.source], [1, 'none']);
});

test('realistic capacity per team and week: nominal − support P80, planned × factor, overtime', () => {
  const ds = dataset();
  const computed = { model: buildModel(ds), support: ds.supportComputed };
  const rc = realisticCapacity(computed, { weeks: 12, history: history(), lang: 'de' });
  const t = rc.teams.find((x) => x.teamId === 't1');
  const wu = weeksUtilization(computed.model, null, 12).teams.find((x) => x.teamId === 't1');
  t.weekly.forEach((w, i) => close(w.nominal, wu.cap[i], `nominal = engine availability week ${i}`));
  assert.equal(t.weekly[0].nominal, 64);
  assert.equal(t.support.p80, 8);
  assert.equal(t.support.median, 6);
  assert.equal(t.weekly[0].room, 56);
  assert.equal(t.estimate.factor, 1.35);
  // week 0: 20 + 10 h planned → 40.5 h; week 1: 40 + 30 h → 94.5 h, 38.5 h above the 56 h room
  assert.deepEqual([t.weekly[0].planned, t.weekly[0].plannedAdj, t.weekly[0].overtime, t.weekly[0].over], [30, 40.5, 0, false]);
  assert.deepEqual([t.weekly[1].planned, t.weekly[1].plannedAdj, t.weekly[1].overtime, t.weekly[1].over], [70, 94.5, 38.5, true]);
  assert.equal(t.weekly[1].load, 1.69);
  t.weekly.forEach((w, i) => close(w.planned, wu.plan[i], `planned = engine plan week ${i}`));
  assert.equal(t.totals.overtime, 38.5);
  assert.equal(t.overWeeks, 1);
  assert.equal(t.totals.room, 672);
  // projects by rank, both fit over the 12-week horizon (81 + 54 h ≤ 672 h)
  assert.deepEqual(t.projects.map((p) => [p.ref, p.plannedAdj, p.fits]), [['p1', 81, 'ok'], ['p2', 54, 'ok']]);
  assert.match(t.explain, /Team One: Ø 64 h pro Woche verfügbar, Support braucht realistisch 8 h \(Median 6 h\)/);
  assert.match(t.explain, /In 1 von 12 Wochen drohen Überstunden, zusammen 39 h\./);
  assert.equal(t.confidence, 'low', '12 support weeks are medium, but 6 stories are low – the weaker one counts');
  // people: u1 has no support above 0 at P80 → 32 h room; week 1: 40 h × 1.35 = 54 h → 22 h over
  const u1 = rc.people.find((p) => p.id === 'u1');
  assert.deepEqual([u1.weekly[1].room, u1.weekly[1].plannedAdj, u1.weekly[1].overtime], [32, 54, 22]);
  assert.equal(u1.estimate.factor, 1.35, 'the team factor, never a personal one');
  const u2 = rc.people.find((p) => p.id === 'u2');
  assert.equal(u2.weekly[1].overtime, 8.5);
});

test('waterline on the realistic room: two weeks → rank 2 fits only partly', () => {
  const ds = dataset();
  const rc = realisticCapacity({ model: buildModel(ds), support: ds.supportComputed }, { weeks: 2, history: history(), lang: 'en' });
  const t = rc.teams[0];
  assert.equal(t.totals.room, 112);
  assert.deepEqual(t.projects.map((p) => [p.ref, p.cum, p.fits, p.fitHours]), [['p1', 81, 'ok', 81], ['p2', 135, 'partial', 31]]);
  assert.equal(t.fitCount, 1);
  assert.equal(t.waterRank, 2);
  assert.equal(t.projects[1].explain, 'Rank 2 (Beta) fits only partly: 31 h of 54 h have room, the rest would be overtime.');
});

test('overtime outlook: who is above 100 %, by how much, and the lowest-ranked work to move', () => {
  const ds = dataset();
  const computed = { model: buildModel(ds), support: ds.supportComputed };
  const rc = realisticCapacity(computed, { weeks: 12, history: history() });
  const o = overtimeOutlook(rc, { weeks: 4, lang: 'de' });
  assert.equal(o.weeks.length, 4);
  assert.equal(o.teams.length, 1);
  const t = o.teams[0];
  assert.deepEqual(t.overWeeks, [{ from: wk(1), load: 1.69, hours: 38.5 }]);
  assert.deepEqual(t.move, [{ ref: 'p2', rank: 2, name: 'Beta', hours: 38.5 }], 'rank 2 has 54 h in that week – enough to cover 38.5 h');
  assert.equal(t.explain, 'Team One: in 1 von 4 Wochen über 100 % (Spitze 169 %), zusammen 39 h zu viel. Verschieben: Rang 2 Beta (39 h).');
  // u2 only works on rank 1: that is what has to move
  const u2 = o.people.find((p) => p.id === 'u2');
  assert.deepEqual(u2.move, [{ ref: 'p1', rank: 1, name: 'Alpha', hours: 8.5 }]);
  // accepts computeAll output directly and gives the same
  const again = overtimeOutlook(computed, { weeks: 4, history: history() });
  assert.deepEqual(again.teams.map((x) => x.hours), [38.5]);
  // nothing over → one plain sentence
  const calm = overtimeOutlook(rc, { weeks: 1, lang: 'en' });
  assert.equal(calm.explain, 'Nobody is above 100 % realistic load in the next 1 weeks.');
});

test('realistic capacity runs on a full computeAll result and is deterministic', () => {
  const ds = dataset();
  const computed = computeAll(ds);
  const a = realisticCapacity(computed, { history: history() });
  const b = realisticCapacity(computed, { history: history() });
  assert.deepEqual(a, b);
  assert.equal(a.weeks.length, 12);
  assert.ok(a.facts.length >= 3);
  // without any history: support from the worklog trend only, factor 1 (nothing to learn from)
  const bare = realisticCapacity(computed, {});
  assert.equal(bare.teams[0].support.source, 'worklogs');
  assert.equal(bare.teams[0].support.weeks, 8);
  assert.equal(bare.teams[0].estimate.source, 'none');
  assert.equal(bare.teams[0].confidence, 'low');
});

test('similar work: TF-IDF cosine on summaries + team/type/component bonus, stats from the hits', () => {
  const pool = [
    { id: '1', key: 'K-1', summary: 'Export der Rechnungen als PDF', team: { id: 'tw' }, type: 'Story', components: ['Portal'], oe: 10, ts: 15, start: '2026-03-02', resolved: '2026-03-13', statusCat: 'done', commentCount: 3 },
    { id: '2', key: 'K-2', summary: 'PDF-Export Rechnungen Geschäftskunden', team: { id: 'tx' }, type: 'Story', oe: 20, ts: 20, created: '2026-04-01', resolved: '2026-04-10', statusCat: 'done', commentCount: 0 },
    { id: '3', key: 'K-3', summary: 'Login-Seite responsive umbauen', team: { id: 'tw' }, oe: 8, ts: 8, resolved: '2026-05-01', statusCat: 'done' },
    { id: '4', key: 'K-4', summary: 'Export der Rechnungen als PDF', statusCat: 'new' }, // not done: never a reference
  ];
  const r = similarWork({ summary: 'Rechnungen als PDF exportieren', team: { id: 'tw' }, components: ['portal'], oe: 8 }, pool, { lang: 'de' });
  assert.deepEqual(r.items.map((x) => x.key), ['K-1', 'K-2']);
  const [a, b] = r.items;
  assert.equal(a.why.team, 0.1);
  assert.equal(a.why.component, 0.1);
  close(a.score, Math.min(1, a.why.text + 0.2), 'score = text similarity + bonuses');
  assert.deepEqual([a.actualH, a.estimateH, a.overrunPct, a.durationDays, a.durationWorkdays, a.durationFrom, a.comments, a.hasComments], [15, 10, 50, 11, 10, 'start', 3, true]);
  assert.deepEqual([b.overrunPct, b.durationFrom, b.durationDays, b.hasComments], [0, 'created', 9, false]);
  assert.deepEqual(r.stats, { n: 2, withActual: 2, medianActualH: 17.5, p80ActualH: 20, typicalOverrunPct: 25, overrunN: 2, medianDurationWorkdays: 9, p80DurationWorkdays: 10, withComments: 1 });
  assert.equal(r.explain, '2 ähnliche erledigte Aufgaben gefunden. Typisch: 18 h Aufwand (P80 20 h). Typisch 25 % mehr als geschätzt. Dauer typisch 9 Arbeitstage. Die Schätzung 8 h liegt unter dem typischen Aufwand.');
  assert.deepEqual(similarWork('Rechnungen als PDF exportieren', pool), similarWork('Rechnungen als PDF exportieren', pool), 'deterministic');
  assert.equal(similarWork('Kaffeemaschine entkalken', pool, { lang: 'en' }).explain, 'No similar finished work found.');
  assert.equal(similarWork({ id: '1', summary: 'Export der Rechnungen als PDF' }, pool).items.some((x) => x.id === '1'), false, 'the target itself is excluded');
});

test('support topics: token signature, playbook candidates, trend, open count, examples', () => {
  const T0 = dayIdx(TODAY);
  const t = (k, summary, ageDays, spentH, o = {}) => ({ id: String(k), key: `SUP-${k}`, summary, created: isoOf(T0 - ageDays), resolved: isoOf(T0 - ageDays + 1), statusCat: 'done', spentH, ...o });
  const tickets = [
    t(1, 'Passwort zurücksetzen', 3, 0.5, { requestType: 'Zugang' }),
    t(2, 'Kennwort vergessen', 10, 0.5, { requestType: 'Zugang' }),
    t(3, 'Password reset please', 20, 0.5),
    t(4, 'Passwort abgelaufen', 60, 1, { requestType: 'Zugang', statusCat: 'indeterminate', resolved: null }),
    t(5, 'Export nach Excel schlägt fehl', 5, 1.5),
    t(6, 'Excel-Export bricht ab', 40, 1.5),
    t(7, 'Fehler beim CSV-Export', 70, 1),
    t(8, 'Export nach Excel leer', 90, 1),
    t(9, 'VPN Verbindung bricht ab', 50, 0.25),
    t(10, 'VPN Zugang', 80, 0.25),
    t(11, 'Monitor flackert', 30, 0.5),
    t(12, 'VPN Client Zertifikat', 100, 0.25),
    t(1, 'Passwort zurücksetzen', 3, 0.5), // duplicate (dataset + history): counted once
  ];
  const r = supportTopics(tickets, { minCount: 3, today: TODAY, lang: 'de' });
  assert.equal(r.tickets, 12);
  const names = r.topics.map((x) => [x.id, x.count, x.spentTotal, x.playbook]);
  assert.deepEqual(names, [['t:export', 4, 5, true], ['t:passwort', 4, 2.5, true], ['t:vpn', 3, 0.8, false]], 'VPN recurs 3 times but takes under 2 h: no playbook; the monitor is a one-off');
  const pw = r.topics.find((x) => x.id === 't:passwort');
  assert.equal(pw.name, 'Passwort (Zugang)');
  assert.equal(pw.open, 1);
  assert.equal(pw.recent, 3, 'three created in the last 28 days');
  assert.equal(pw.trend, 'rising', '3 in 4 weeks vs 1 in the weeks before');
  assert.deepEqual(pw.exampleKeys, ['SUP-1', 'SUP-2', 'SUP-3', 'SUP-4']);
  assert.equal(pw.spentMedian, 0.5);
  const ex = r.topics.find((x) => x.id === 't:export');
  assert.equal(ex.name, 'Export Excel');
  assert.equal(ex.explain, '„Export Excel“: 4 Tickets, zusammen 5 h (Median 1,3 h pro Ticket), Tendenz stabil. Kandidat für eine Standardantwort oder einen Hilfeartikel.');
  assert.equal(r.playbookCount, 2);
  assert.deepEqual(supportTopics(tickets, { today: TODAY }), r, 'deterministic');
});

test('mock history: realistic size and shapes, topics and similar work work on it', () => {
  const h = mockHistory({ today: dayIdx(TODAY) });
  assert.ok(h.stories.length >= 40 && h.stories.length <= 80, `stories: ${h.stories.length}`);
  assert.ok(h.support.length >= 60);
  for (const s of h.stories) {
    assert.equal(s.statusCat, 'done');
    assert.ok(s.resolved <= TODAY && s.created <= s.resolved && (!s.start || s.start <= s.resolved), s.key);
  }
  for (const t of h.support) assert.ok(Math.abs(t.worklogs.reduce((a, w) => a + w.h, 0) - t.spentH) < 1e-9, `${t.key}: worklogs add up`);
  const topics = supportTopics(h.support, { today: TODAY });
  const pb = topics.topics.filter((x) => x.playbook).map((x) => x.id);
  for (const k of ['t:passwort', 't:export', 't:vpn']) assert.ok(pb.includes(k), `${k} is a playbook candidate`);
  const sim = similarWork('PDF-Export der Rechnungen', h.stories);
  assert.ok(sim.items.length >= 3 && sim.items[0].summary.includes('PDF'));
  assert.deepEqual(mockHistory({ today: dayIdx(TODAY) }), h, 'deterministic');
  const c = mockComments(['5001', '5002'], { texts: false });
  assert.deepEqual(Object.keys(c), ['5001', '5002']);
  assert.ok(Object.values(c).every((x) => x.last.length === 0), 'no texts unless allowed');
});
