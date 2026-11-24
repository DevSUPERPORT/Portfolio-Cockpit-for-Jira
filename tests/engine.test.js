import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayIdx, workdays, parseQuarter, quarterKeyOf } from '../shared/dates.js';
import { holidaysFor } from '../shared/holidays.js';
import { computeAll, buildModel, projectMetrics, dataQuality, dependencies, resolvePeriod, estimateVsSpent, cLevelReport, supportMetrics, milestoneOf, milestoneStatus, sizeHours } from '../shared/engine.js';

// Typical hierarchy: Project > Workstream > Epic > Story > Sub-task
const LEVELS = [
  { key: 'ws', name: 'Workstream', role: 'rough', issueTypeIds: ['2'] },
  { key: 'ep', name: 'Epic', role: 'structure', issueTypeIds: ['3'] },
  { key: 'st', name: 'Story', role: 'estimate', issueTypeIds: ['4'] },
  { key: 'sub', name: 'Sub-task', role: 'tiny', issueTypeIds: ['5'] },
];
const T = (id, name) => ({ id, name });
const st = (cat) => ({ name: cat, cat });
function dataset(over = {}) {
  const issues = [
    { id: 'w1', key: 'P-2', summary: 'WS Billing', role: 'rough', levelKey: 'ws', parentId: null, rootRef: 'issue:p1', status: st('indeterminate'), team: T('t1', 'Web'), tshirt: 'M', quarters: ['2026-Q4', '2027-Q1'] },
    { id: 'e1', key: 'P-3', summary: 'Epic', role: 'structure', levelKey: 'ep', parentId: 'w1', rootRef: 'issue:p1', status: st('indeterminate'), team: T('t1', 'Web') },
    { id: 's1', key: 'P-4', summary: 'Story 1', role: 'estimate', levelKey: 'st', parentId: 'e1', rootRef: 'issue:p1', status: st('indeterminate'), team: T('t1', 'Web'), assignee: { id: 'u1', name: 'Ana' }, start: '2026-11-02', due: '2026-11-27', oe: 100, re: 40, ts: 60, worklogs: [{ a: 'u1', d: '2026-10-20', h: 30 }, { a: 'u1', d: '2026-11-03', h: 30 }], links: [{ id: 'l1', typeId: '10000', outward: true, otherId: 's3', verb: 'blocks' }] },
    { id: 's2', key: 'P-5', summary: 'Story 2', role: 'estimate', levelKey: 'st', parentId: 'e1', rootRef: 'issue:p1', status: st('new'), team: null, oe: 50, re: 50, ts: 0 },
    { id: 'x1', key: 'P-6', summary: 'Sub', role: 'tiny', levelKey: 'sub', parentId: 's1', rootRef: 'issue:p1', status: st('done') },
    { id: 's3', key: 'Q-2', summary: 'Other story', role: 'estimate', levelKey: 'st', parentId: null, rootRef: 'issue:p2', status: st('new'), team: T('t2', 'Data'), start: '2026-11-16', due: '2026-12-18', oe: 80, re: 80, ts: 0, note: null },
  ];
  return {
    today: '2026-11-02',
    config: { levels: LEVELS, tshirtSizes: [{ key: 'M', hours: 320 }], dependencies: { linkTypeIds: ['10000'] }, rules: { distribution: 'linear', forecastThresholdPct: 10 } },
    portfolio: [
      { ref: 'issue:p1', rank: 1, kind: 'issue', id: 'p1', key: 'P-1', name: 'Billing', owner: { id: 'u9', name: 'Owner' }, statusCat: 'indeterminate', due: '2027-03-31' },
      { ref: 'issue:p2', rank: 2, kind: 'issue', id: 'p2', key: 'Q-1', name: 'CRM', owner: null, statusCat: 'new', due: '2026-10-01' },
    ],
    issues,
    capacity: { people: { u1: { weeklyHours: 40, teamId: 't1', location: 'DE-BY' } }, teams: { t1: { dailyBusinessPct: 20, absenceRatePct: 0 } }, absences: [] },
    ...over,
  };
}

test('dates and holidays', () => {
  assert.equal(workdays(dayIdx('2026-11-02'), dayIdx('2026-11-08')), 5);
  assert.equal(workdays(dayIdx('2026-11-07'), dayIdx('2026-11-08')), 0);
  assert.equal(parseQuarter('Q1 2027'), '2027-Q1');
  assert.equal(parseQuarter('2026 Q4'), '2026-Q4');
  assert.equal(parseQuarter({ value: 'Q2/27' }), '2027-Q2');
  assert.equal(quarterKeyOf(dayIdx('2026-12-31')), '2026-Q4');
  const by = holidaysFor('DE-BY', 2026);
  assert.ok(by.has(dayIdx('2026-04-03')), 'Good Friday');
  assert.ok(by.has(dayIdx('2026-06-04')), 'Corpus Christi BY');
  assert.ok(!holidaysFor('DE-BE', 2026).has(dayIdx('2026-06-04')));
  assert.ok(holidaysFor('GR', 2026).has(dayIdx('2026-04-13')), 'Orthodox Easter Monday 2026');
});

test('project metrics: open t-shirt, progress, maturity (UC-06/UC-10)', () => {
  const model = buildModel(dataset());
  const m = projectMetrics(model, model.items[0]);
  assert.equal(m.OE, 150); assert.equal(m.RE, 90); assert.equal(m.TS, 60);
  // M = 320h over 2 quarters = 160 each; Q4 consumed by S1 (100, dated in Q4) + S2 (50, undated -> first open quarter)
  assert.equal(Math.round(m.openByQ['2026-Q4']), 10);
  assert.equal(Math.round(m.openByQ['2027-Q1']), 160);
  assert.equal(Math.round(m.openTshirt), 170);
  assert.ok(Math.abs(m.progress - 60 / (60 + 90 + 170)) < 1e-9);
  assert.ok(Math.abs(m.maturity - 150 / (150 + 170)) < 1e-9);
  assert.equal(m.storyCount, 2);
});

test('waterline: support first, demand cumulated in rank order (UC-11)', () => {
  const { wl } = computeAll(dataset());
  const c = wl.cells.t1['2026-Q4'];
  assert.equal(Math.round(c.capacity), 384); // 40h * 12 * 0.8
  assert.equal(c.rows[0].kind, 'support');
  assert.equal(c.rows.find((r) => r.ref === 'issue:p1').status, 'ok');
  assert.equal(wl.projectQ['issue:p2']['2026-Q4'].status, 'no'); // Data team has no capacity
});

test('rank change moves the waterline', () => {
  const ds = dataset({ capacity: { people: { u1: { weeklyHours: 10, teamId: 't1' } }, teams: { t1: { dailyBusinessPct: 0, absenceRatePct: 0 } } } });
  ds.issues.push({ id: 's9', key: 'Q-9', summary: 'Web for CRM', role: 'estimate', levelKey: 'st', parentId: null, rootRef: 'issue:p2', status: st('new'), team: T('t1', 'Web'), start: '2026-11-02', due: '2026-12-31', oe: 100, re: 100, ts: 0 });
  let r = computeAll(ds).wl.cells.t1['2026-Q4'];
  assert.equal(r.rows[1].ref, 'issue:p1');
  ds.portfolio[0].rank = 2; ds.portfolio[1].rank = 1;
  r = computeAll(ds).wl.cells.t1['2026-Q4'];
  assert.equal(r.rows[1].ref, 'issue:p2');
  assert.equal(r.rows[1].status, 'ok');
  assert.notEqual(r.rows[2].status, 'ok');
});

test('dependencies: conflict when prerequisite due is after dependent start (UC-03)', () => {
  const d = dependencies(buildModel(dataset()), null);
  assert.equal(d.list.length, 1);
  assert.equal(d.list[0].conflict, true); // S1 due 11-27 > S3 start 11-16
  assert.equal(d.list[0].missingNote, true);
  assert.equal(d.list[0].pre, 's1');
});

test('data quality: required gaps, urgency, owner (UC-13)', () => {
  const dq = dataQuality(buildModel(dataset()), null);
  const s2team = dq.gaps.find((g) => g.issueId === 's2' && g.rule === 'missing:team');
  assert.ok(s2team, 'story without team');
  assert.equal(s2team.responsible.id, 'u9', 'falls back to project owner');
  assert.ok(dq.gaps.find((g) => g.issueId === 's2' && g.rule === 'missing:startDate'));
  assert.ok(dq.gaps.find((g) => g.isItem && g.rule === 'missing:owner'), 'portfolio item without owner');
  assert.equal(dq.gaps.filter((g) => g.issueId === 's1').length, 0, 's1 complete');
  assert.equal(dq.basis.stories, 3);
});

test('estimate vs time spent per period (UC-04)', () => {
  const model = buildModel(dataset());
  const p = resolvePeriod('month', model.today);
  const web = estimateVsSpent(model, p.a, p.b).teams.find((t) => t.id === 't1');
  assert.equal(web.logged, 30, 'only worklogs inside November');
  assert.equal(web.est, 100, 'S1 fully in November');
  assert.equal(resolvePeriod('custom', model.today, '2026-11-10', '2026-11-01').valid, false);
});

test('support reservation and spike (UC-17)', () => {
  const wl = (d, h) => ({ a: 'u1', d, h });
  const s = supportMetrics({ averagingWeeks: 4, slaTargetPct: 90, services: [{ id: 'sv', key: 'SUP', name: 'Support' }],
    tickets: [{ serviceId: 'sv', team: { id: 't1' }, statusCat: 'new', re: 5, sla: { met: 9, breached: 1 },
      worklogs: [wl('2026-10-05', 4), wl('2026-10-12', 4), wl('2026-10-20', 20), wl('2026-10-27', 20)] }] }, '2026-11-02');
  const t = s.teams[0];
  assert.equal(t.avg, 12); assert.equal(t.recentAvg, 20); assert.equal(t.spike, true);
  assert.equal(s.reserveQuarter.t1, 240);
  assert.equal(s.health, 'onTrack');
});

test('c-level report aggregates', () => {
  const r = cLevelReport(dataset());
  assert.equal(r.kpis.activeProjects, 2);
  assert.ok(r.rows.find((x) => x.key === 'Q-1').daysOverdue > 0);
});

test('unnamed team capacity counts in quarters and weeks', () => {
  const ds = dataset({ capacity: { people: {}, teams: { t2: { dailyBusinessPct: 0, absenceRatePct: 0, extraWeeklyHours: 80 } } } });
  const { wl, weeks } = computeAll(ds);
  assert.equal(Math.round(wl.cells.t2['2026-Q4'].capacity), 960); // 80h × 12
  assert.equal(wl.projectQ['issue:p2']['2026-Q4'].status, 'ok');
  const data = weeks.teams.find((x) => x.teamId === 't2');
  assert.equal(Math.round(data.cap[0]), 80);
});

test('D1: Time Spent includes sub-task hours', () => {
  const ds = dataset();
  ds.issues.find((i) => i.id === 'x1').ts = 7;
  const m = projectMetrics(buildModel(ds), buildModel(ds).items[0]);
  assert.equal(m.TS, 67);
});
test('D16: a reversed link type swaps prerequisite and dependent', () => {
  const ds = dataset();
  ds.config.dependencies.reversedLinkTypeIds = ['10000'];
  const d = dependencies(buildModel(ds), null);
  assert.equal(d.list[0].pre, 's3');
  assert.equal(d.list[0].dep, 's1');
});
test('D7/D14: unscheduled work is reported', () => {
  const ds = dataset();
  const { wl } = computeAll(ds);
  assert.equal(wl.cells._none['2026-Q4'].unscheduled, 50);
  const model = buildModel(ds);
  const p = resolvePeriod('month', model.today);
  assert.equal(estimateVsSpent(model, p.a, p.b).undated, 1);
});
test('D19: report utilization is capacity-weighted', () => {
  const r = cLevelReport(dataset());
  const { weeks } = computeAll(dataset());
  const ts = weeks.teams.filter((t) => t.teamId !== '_none' && t.capTotal > 0);
  const expect = ts.reduce((a, t) => a + t.planTotal, 0) / ts.reduce((a, t) => a + t.capTotal, 0);
  assert.ok(Math.abs(r.kpis.avgUtil - expect) < 1e-9);
});

test('Milestone from a custom field: configured name or the field date', () => {
  const ds = dataset();
  ds.config.fields = { ...(ds.config.fields || {}), milestone: 'customfield_99' };
  ds.milestones = [{ id: 'm1', name: 'Go-Live', date: '2026-12-01', fixVersionIds: [] }];
  const stories = ds.issues.filter((i) => i.role === 'estimate');
  stories[0].milestone = { name: 'go-live ', date: null };
  stories[1].milestone = { name: null, date: '2027-02-01' };
  const model = buildModel(ds);
  assert.equal(milestoneOf(model, stories[0]).name, 'Go-Live');
  assert.equal(milestoneOf(model, stories[1]).date, '2027-02-01');
  assert.equal(milestoneOf(model, stories[2] || {}), null);
  const ms = milestoneStatus(model);
  assert.ok(ms.find((m) => m.name === 'Go-Live').stories.includes(stories[0].id));
  assert.ok(ms.find((m) => m.date === '2027-02-01').stories.includes(stories[1].id));
});
test('Milestone without custom field still comes from fix versions', () => {
  const ds = dataset();
  const s0 = ds.issues.find((i) => i.role === 'estimate');
  ds.milestones = [{ id: 'm1', name: 'Release', date: '2026-12-01', fixVersionIds: ['777'] }];
  s0.fixVersionIds = ['777'];
  s0.milestone = { name: 'ignored', date: '2030-01-01' };
  assert.equal(milestoneOf(buildModel(ds), s0).name, 'Release');
});
test('T-shirt hours match whole option values or their first word', () => {
  const ds = dataset();
  ds.config.tshirtSizes = [{ key: 'MEDIUM', hours: 300 }, { key: 'M', hours: 320 }];
  const model = buildModel(ds);
  assert.equal(sizeHours(model, 'Medium'), 300);
  assert.equal(sizeHours(model, 'M (320 h)'), 320);
  assert.equal(sizeHours(model, 'unknown'), 0);
});

test('maturity = Original Estimate ÷ (Original Estimate + open T-shirt size)', async () => {
  const { maturityOf } = await import('../shared/engine.js');
  assert.ok(Math.abs(maturityOf(1500, 180) - 1500 / 1680) < 1e-12); // the prototype: 89 %
  assert.equal(maturityOf(204, 0), 1); // everything estimated as stories, no T-shirt left
  assert.equal(maturityOf(0, 0), null); // nothing planned yet
  assert.equal(maturityOf(0, 100), 0); // only a T-shirt
  const c = computeAll(dataset());
  const m = c.metrics.get('issue:p1');
  assert.ok(Math.abs(m.maturity - m.OE / (m.OE + m.openTshirt)) < 1e-12);
});

test('past due date counts open stories only', () => {
  const ds = dataset();
  ds.issues.find((i) => i.id === 'e1').due = '2026-10-01'; // an epic past due does not count here
  ds.issues.find((i) => i.id === 's2').due = '2026-10-15'; // an open story past due does
  const m = computeAll(ds).metrics.get('issue:p1');
  assert.deepEqual(m.overdueIssues, ['s2']);
  assert.equal(m.overdueCount, 1);
});

test('support numbers: one source for badge, portfolio row, Support view and report', async () => {
  const { supportSummary } = await import('../shared/engine.js');
  const ds = dataset({
    config: { ...dataset().config, support: { slaTargetPct: 95, queues: [{ id: 'q1', name: 'IT', projectIds: ['9'], issueTypeIds: [], labels: [] }], sla: { mode: '24x7', policies: [{ priority: 'High', hours: 4 }], fallbackHours: 4, atRiskShare: 0.75 } } },
    supportTickets: { tickets: [
      // SLAs come from Jira Service Management only (2026-11-18): the tickets carry their JSM SLA data
      { id: 't1', key: 'S-1', priority: 'High', created: '2026-10-01T08:00:00Z', statusCat: 'new', links: ['s1'], jsm: { goalMs: 4 * 3600e3, elapsedMs: 900 * 3600e3, breached: true } },
      { id: 't2', key: 'S-2', priority: 'High', created: '2026-10-01T08:00:00Z', resolved: '2026-10-01T09:00:00Z', statusCat: 'done', links: [], jsm: { goalMs: 4 * 3600e3, elapsedMs: 3600e3, breached: false } },
    ] },
  });
  const c = computeAll(ds);
  assert.equal(c.supportSum.source, 'tickets');
  assert.equal(c.supportSum.open, 1);
  assert.equal(c.supportSum.urgent, 1, 'the open ticket is long past its 4 h target');
  assert.equal(c.supportSum.slaRate, 0.5, 'one met in time, one open ticket already past its target');
  assert.equal(c.supportA.byProject[0].ref, 'issue:p1', 'linked to a story of P1');
  const r = cLevelReport(ds);
  assert.equal(r.kpis.slaRate, c.supportSum.slaRate, 'report SLA rate = cockpit SLA rate');
  assert.equal(r.support.open, 1);
  assert.equal(supportSummary(null, null), null);
});

test('epics as portfolio items: their own T-shirt size counts even when the configuration has a rough level', () => {
  const ds = dataset();
  ds.issues = ds.issues.filter((i) => i.role !== 'rough'); // nothing below the item carries a size …
  for (const i of ds.issues) if (i.parentId === 'w1') i.parentId = null;
  ds.portfolio[0].tshirt = 'M'; ds.portfolio[0].quarters = ['2026-Q4']; // … the item (the epic) does
  const c = computeAll(ds);
  const m = c.metrics.get('issue:p1');
  assert.equal(m.units.length, 1);
  assert.ok(m.units[0].isItem, 'the item is its own rough unit');
  assert.equal(m.maturityBasis.withTshirt, 1);
  assert.ok(m.maturity != null && m.maturity < 1, `maturity ${m.maturity}: estimate vs. the epic's M`);
  // and an epic without a size is reported, not shown as 100 %
  delete ds.portfolio[0].tshirt;
  assert.equal(computeAll(ds).metrics.get('issue:p1').maturity, null);
});
