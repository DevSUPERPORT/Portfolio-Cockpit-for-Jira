import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cLevelReport, computeAll } from '../shared/engine.js';
import { buildPayload } from '../shared/planActual.js';
import { reportExtras, reportKpis, reportForViewer, planActualSummary, audienceOf } from '../shared/reportKpis.js';
import { reportStorageHtml } from '../src/lib/report-html.js';

const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url), 'utf8'));

// Billing (rank 1) runs; CRM (rank 2) has not started, is past its due date and waits for Billing (blocks link).
const LEVELS = [
  { key: 'ws', name: 'Workstream', role: 'rough', issueTypeIds: ['2'] },
  { key: 'ep', name: 'Epic', role: 'structure', issueTypeIds: ['3'] },
  { key: 'st', name: 'Story', role: 'estimate', issueTypeIds: ['4'] },
];
const T = (id, name) => ({ id, name });
const st = (cat) => ({ name: cat, cat });
function dataset(rules = {}) {
  return {
    today: '2026-11-02',
    config: { levels: LEVELS, tshirtSizes: [{ key: 'M', hours: 320 }], dependencies: { linkTypeIds: ['10000'] }, rules: { distribution: 'linear', forecastThresholdPct: 10, ...rules } },
    portfolio: [
      { ref: 'issue:p1', rank: 1, kind: 'issue', id: 'p1', key: 'P-1', name: 'Billing', owner: { id: 'u9', name: 'Owner' }, statusCat: 'indeterminate', due: '2027-03-31', health: { status: 'critical', at: '2026-11-01T00:00:00Z' } },
      { ref: 'issue:p2', rank: 2, kind: 'issue', id: 'p2', key: 'Q-1', name: 'CRM', owner: null, statusCat: 'new', due: '2026-10-01', start: '2026-12-01' },
    ],
    issues: [
      { id: 'w1', key: 'P-2', summary: 'WS', role: 'rough', levelKey: 'ws', parentId: null, rootRef: 'issue:p1', status: st('indeterminate'), team: T('t1', 'Web'), tshirt: 'M', quarters: ['2026-Q4'] },
      { id: 's1', key: 'P-4', summary: 'Story 1', role: 'estimate', levelKey: 'st', parentId: 'w1', rootRef: 'issue:p1', status: st('indeterminate'), team: T('t1', 'Web'), assignee: { id: 'u1', name: 'Ana' }, start: '2026-11-02', due: '2026-11-27', oe: 200, re: 180, ts: 60, links: [{ id: 'l1', typeId: '10000', outward: true, otherId: 's3', verb: 'blocks' }] },
      { id: 's3', key: 'Q-2', summary: 'Other story', role: 'estimate', levelKey: 'st', parentId: null, rootRef: 'issue:p2', status: st('new'), team: T('t2', 'Data'), start: '2026-11-16', due: '2026-10-20', oe: 80, re: 80, ts: 0 },
    ],
    people: { u1: { name: 'Ana' } },
    capacity: { people: { u1: { weeklyHours: 40, teamId: 't1', location: 'NONE' } }, teams: { t1: { dailyBusinessPct: 20, absenceRatePct: 0 } }, absences: [] },
  };
}
const ROLES = { groups: { management: [{ id: 'g1', name: 'Geschäftsleitung' }], projectAdmin: [] }, rights: { employee: ['mine'], projectAdmin: ['mine', 'portfolio'], management: ['mine', 'report', 'a_logs_all'] } };
function build(rules, pa = null) {
  const ds = dataset(rules);
  const report = cLevelReport(structuredClone(ds));
  Object.assign(report, reportExtras(computeAll(structuredClone(ds)), { ...ds.config, roles: ROLES }, pa));
  return report;
}
// two completed weeks: 20 h planned on Billing per week, 12 booked; the rest went to support and internal work
function payload() {
  const plans = ['2026-W43', '2026-W44'].map((week) => ({ week, projects: { 'issue:p1': { n: 'Billing', r: 1 } }, teams: { t1: 'Web' }, names: { u1: 'Ana' }, people: { u1: { t: 't1', p: { 'issue:p1': 20, SUP: 4 } } } }));
  const acts = ['2026-W43', '2026-W44'].map((week) => ({ week, people: { u1: { t: 't1', b: { 'issue:p1': 12, SUP: 9, INT: 3 }, absU: 2 } } }));
  return buildPayload({ plans, acts, weeks: 4 });
}

test('six key figures in the order of the plan, with the portfolio\'s progress', () => {
  const r = build();
  const v = reportKpis({ report: r, lang: 'de' });
  assert.deepEqual(v.tiles.map((t) => t.id), ['projects', 'progress', 'schedule', 'util', 'asPlanned', 'support']);
  const [proj, prog, sched] = v.tiles;
  assert.equal(proj.value, 2);
  assert.match(proj.sub, /^1 laufend · 1 geplant · Health 1 kritisch, 0 gefährdet$/);
  assert.equal(proj.tone, 'warn', 'health is named, not alarmed: the owners judge it');
  assert.equal(prog.value, r.kpis.progress, 'same number as the engine / portfolio');
  assert.match(prog.explain.calc, /^60 h ÷ \(60 h \+ 260 h \+ \d+ h\) = \d+ %$/);
  assert.equal(sched.value, r.kpis.issuesOverdue);
  assert.match(sched.sub, /1 Projekt über Termin/);
  for (const t of v.tiles) { assert.ok(t.explain?.text, `${t.id} explains itself`); assert.ok(t.display && t.sub, t.id); }
  assert.equal(v.header.audience, 'Management (Geschäftsleitung), Jira-Admins');
});

test('project rows: waits for, overdue days, forecast against Original Estimate', () => {
  const v = reportKpis({ report: build(), lang: 'de' });
  const crm = v.rows.find((x) => x.name === 'CRM'), billing = v.rows.find((x) => x.name === 'Billing');
  assert.equal(crm.waitText, 'wartet auf Billing (Rang 1) · Terminkonflikt');
  assert.equal(crm.waitHot, true);
  assert.equal(crm.term.tone, 'bad');
  assert.match(crm.term.text, /^Projekt \+32 Tage über Due · 1 Vorg\.$/);
  assert.equal(billing.waitText, '');
  assert.equal(billing.progText, '+20 %', '(60 + 180) ÷ 200 − 1');
  assert.equal(billing.overrun, true);
  assert.equal(billing.progressSub, '60 h Time Spent · 300 h offen', '180 h remaining + 120 h open T-shirt (320 − 200)');
  assert.match(v.tiles[1].sub, /1 mit Mehraufwand$/);
  const en = reportKpis({ report: build(), lang: 'en' });
  assert.equal(en.rows.find((x) => x.name === 'CRM').waitText, 'waits for Billing (rank 1) · date conflict');
});

test('next 4 weeks as in weekly planning; people over 100 % only where individual values are allowed', () => {
  const r = build();
  assert.equal(r.extra.util4.weeks.length, 4);
  const web = r.extra.util4.teams.find((t) => t.name === 'Web');
  assert.ok(web.util > 1, `Ana: 200 h over 4 weeks against 32 h per week (${web.util})`);
  const all = reportKpis({ report: reportForViewer(r, { logs: 'all' }), lang: 'de' });
  assert.equal(all.util4.personLevel, true);
  assert.deepEqual(all.util4.persons.map((p) => [p.name, p.team, p.over]), [['Ana', 'Web', 4]]);
  assert.match(all.tiles[3].sub, /1 Person über 100 %$/);
  const team = reportKpis({ report: reportForViewer(r, { logs: 'team' }), lang: 'de' });
  assert.equal(team.util4.personLevel, false);
  assert.equal(team.util4.persons.length, 0);
  assert.match(team.tiles[3].sub, /1 Team über 100 %$/);
  assert.equal(build({ personLevel: false }).extra.util4.persons, null, 'privacy switch: no people stored at all');
});

test('as planned: a friendly placeholder until the first snapshot, then the share and where the time went', () => {
  const before = reportKpis({ report: build(), lang: 'de' });
  assert.equal(before.tiles[4].display, 'ab dem ersten Wochen-Snapshot');
  assert.equal(before.flows.ready, false);
  const s = planActualSummary(payload());
  assert.equal(s.state, 'ready');
  assert.equal(s.plan, 48);
  assert.equal(s.asPlanned, 32, '12 Billing + 4 support per week');
  assert.deepEqual(s.flows, { sup: 10, other: 0, intern: 6, abs: 4 });
  assert.equal(s.diverted, 16);
  const v = reportKpis({ report: build(undefined, payload()), lang: 'de' });
  assert.equal(v.tiles[4].display, '67 %');
  assert.equal(v.tiles[4].sub, 'letzte 4 Wochen · 16 h umgeleitet');
  assert.deepEqual(v.flows.rows.map((x) => [x.label, x.h]), [['Support über Reserve', 10], ['Intern ohne Projekt', 6], ['Ungeplant abwesend', 4]]);
  assert.equal(v.flows.period, 'KW 43–44');
  // the client may pass the payload it loaded itself when the snapshot has none
  const fromClient = reportKpis({ report: build(), planActual: payload(), lang: 'en' });
  assert.equal(fromClient.tiles[4].display, '67%');
  assert.equal(planActualSummary(buildPayload({ plans: [], acts: [] })).state, 'none');
});

test('capacity by rank: every quarter, one sentence per team', () => {
  const v = reportKpis({ report: build(), lang: 'de' });
  assert.ok(v.waterline.quarters.length >= 1);
  assert.ok(v.waterline.quarters.includes(v.waterline.defaultQ));
  for (const q of v.waterline.quarters) {
    const b = v.waterline.byQ[q];
    assert.ok(b.headline.includes(b.label));
    for (const t of b.teams) assert.ok(t.sentence.endsWith('.'), t.sentence);
  }
});

test('older snapshots without extras still render (golden dataset)', () => {
  const r = cLevelReport(structuredClone(golden));
  for (const lang of ['de', 'en']) {
    const v = reportKpis({ report: r, lang });
    assert.equal(v.tiles.length, 6);
    assert.equal(v.util4.basis, 'report');
    assert.equal(v.waterline.quarters[0], r.waterlineNextQ.quarter);
    assert.ok(v.rows.every((x) => x.term.text));
  }
  // with the dataset at hand, the extras are derived on the fly
  const v = reportKpis({ report: r, computed: computeAll(structuredClone(golden)), lang: 'de' });
  assert.equal(v.util4.basis, 'board');
  assert.ok(v.waterline.quarters.length > 1);
  assert.deepEqual(audienceOf(null), [{ role: 'management', groups: [] }, { role: 'jiraAdmin', groups: [] }]);
});

test('Confluence page: six key figures, sections, escaped, no people', () => {
  const r = build(undefined, payload());
  r.rows[0].name = 'Billing <script>';
  const html = reportStorageHtml(r, 'de');
  for (const s of ['Laufende Projekte nach Rang', 'Kapazität nach Rangfolge', 'Auslastung nächste 4 Wochen', 'Wohin floss die Zeit?', 'Termintreue', 'Wie geplant', 'wartet auf']) assert.ok(html.includes(s), s);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Billing &lt;script&gt;'));
  assert.ok(!html.includes('Ana'), 'individual values never go to Confluence');
  const en = reportStorageHtml(cLevelReport(structuredClone(golden)), 'en');
  assert.ok(en.includes('Running projects by rank') && en.includes('from the first weekly snapshot'));
});

test('PDF report with the new sections', async () => {
  const { downloadReportPdf, pdfSink, factSummary } = await import('../static/cockpit/src/lib/pdf.js');
  const r = reportForViewer(build(undefined, payload()), { logs: 'all' });
  assert.ok(factSummary(r).some((b) => b.includes('wie geplant')));
  let out;
  pdfSink.save = (blob, name, doc) => { out = { blob, name, doc }; };
  await downloadReportPdf(r);
  pdfSink.save = null;
  assert.ok(out.doc.getNumberOfPages() >= 4);
  const bytes = Buffer.from(await out.blob.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
});
