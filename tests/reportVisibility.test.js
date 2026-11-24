// Confidentiality of the app-computed snapshots (C-level report, its history, plan vs. actual): a caller only ever gets
// the portfolio items they may browse in Jira – the same items, in the same dense ranks, as their Portfolio. A fake Jira
// in which one project ("ERP-Anbindung", ERP-1, issue:9001) is not browsable for the caller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lotseDataset } from './lotseFixture.js';
import { cLevelReport, computeAll } from '../shared/engine.js';
import { reportExtras, reportForViewer } from '../shared/reportKpis.js';
import { analyzePlanActual, withPortfolioRanks, shiftWeek, weekRange } from '../shared/planActual.js';
import { isoOf } from '../shared/dates.js';
import { visibleRefs, callerScope, reportRefs, scopeDataset, scopedReport, hiddenTerms, mentions, scrubDraft } from '../src/lib/reportScope.js';
import { planActual, scopeWeekRecords, LAST, planKey, actKey } from '../src/lib/snapshot.js';

const HIDDEN = 'issue:9001';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ---------- a fake Jira: the caller may browse every portfolio work item except the hidden one ----------
function fakeJira({ hidden = new Set([HIDDEN]), fail = null } = {}) {
  const calls = [];
  const browsable = (id) => !hidden.has(`issue:${id}`);
  return {
    calls,
    searchAll: async (as, jql, fields) => {
      calls.push({ as, jql, fields });
      assert.equal(as, 'user', 'visibility is asked AS THE USER');
      if (fail?.(jql)) throw Object.assign(new Error('boom'), { status: 500 });
      const ids = (/id (?:in \(([^)]*)\)|= (\d+))/.exec(jql) || []).slice(1).filter(Boolean).join(',').split(',').map((x) => x.trim()).filter(Boolean);
      return { issues: ids.filter(browsable).map((id) => ({ id })) };
    },
    jira: async (as, path) => {
      calls.push({ as, path });
      assert.equal(as, 'user');
      const id = /\/project\/(\d+)$/.exec(path)?.[1];
      if (hidden.has(`space:${id}`)) throw Object.assign(new Error('Not Found'), { status: 404 });
      return { id };
    },
  };
}

// the dataset as the APP reads it (every item), with the global ranks loadItems gives it
function appDataset() {
  const ds = lotseDataset();
  ds.portfolio.forEach((p) => { p.globalRank = p.rank; });
  ds.storyTotals = true;
  return ds;
}
// built independently: what the report must equal – a dataset that only ever had the visible projects
function visibleOnly() {
  const ds = appDataset();
  const hiddenIds = new Set(ds.issues.filter((i) => i.rootRef === HIDDEN).map((i) => i.id));
  ds.portfolio = ds.portfolio.filter((p) => p.ref !== HIDDEN).map((p, i) => ({ ...p, rank: i + 1 }));
  ds.issues = ds.issues.filter((i) => i.rootRef !== HIDDEN).map((i) => ({ ...i, links: i.links.filter((l) => !hiddenIds.has(l.otherId)) }));
  ds.versions = { v1: ds.versions.v1, ...(ds.issues.some((i) => i.fixVersionIds.includes('v2')) ? { v2: ds.versions.v2 } : {}) };
  return ds;
}
const report = (ds, pa = null) => {
  const r = cLevelReport(structuredClone(ds));
  Object.assign(r, reportExtras(computeAll(structuredClone(ds)), ds.config, pa));
  return r;
};
const noAsOf = (r) => JSON.parse(JSON.stringify({ ...r, asOf: null }));

test('fake Jira: visibility asked as the user, one search per 100 items, cached per account, fail closed', async () => {
  const fj = fakeJira();
  const cache = new Map();
  const refs = [...Array.from({ length: 8 }, (_, i) => `issue:${9000 + i}`), 'bogus', 'issue:abc'];
  const v = await visibleRefs('acc-1', refs, { ...fj, cache, now: 1000 });
  assert.equal(v.has(HIDDEN), false);
  assert.equal(v.size, 7);
  assert.equal(fj.calls.length, 1, 'one JQL search for all work items');
  assert.match(fj.calls[0].jql, /^id in \(9000,9001,/);
  assert.deepEqual(fj.calls[0].fields, [], 'no field values read');
  await visibleRefs('acc-1', refs, { ...fj, cache, now: 1000 + 60e3 });
  assert.equal(fj.calls.length, 1, 'cached for a few minutes');
  await visibleRefs('acc-1', refs, { ...fj, cache, now: 1000 + 4 * 60e3 });
  assert.equal(fj.calls.length, 2, 'asked again after the cache expired');
  await visibleRefs('acc-2', refs, { ...fj, cache, now: 1000 });
  assert.equal(fj.calls.length, 3, 'never shared between accounts');
  // the batch fails → one by one; a server error counts as hidden (and is not cached)
  const bad = fakeJira({ fail: (jql) => jql.startsWith('id in') || jql === 'id = 9003' });
  const c2 = new Map();
  const v2 = await visibleRefs('acc-3', ['issue:9000', 'issue:9001', 'issue:9003'], { ...bad, cache: c2, now: 0 });
  assert.deepEqual([...v2], ['issue:9000']);
  assert.equal(c2.get('acc-3').has('issue:9003'), false, 'a transient error is not remembered');
  // spaces: one project read each, 404 = hidden
  const sp = fakeJira({ hidden: new Set(['space:20']) });
  const v3 = await visibleRefs('acc-4', ['space:10', 'space:20'], { ...sp, cache: new Map(), now: 0 });
  assert.deepEqual([...v3], ['space:10']);
});

test('the served report holds nothing of the hidden project; its totals equal the report of the visible projects', async () => {
  const app = appDataset();
  const full = report(app);
  assert.ok(full.rows.some((r) => r.ref === HIDDEN), 'precondition: the app snapshot covers the hidden project');
  const order = app.portfolio.map((p) => p.ref);
  const refs = [...new Set([...order, ...reportRefs(full)])];
  const scope = callerScope(order, await visibleRefs('acc-1', refs, { ...fakeJira(), cache: new Map() }), refs);
  assert.deepEqual([...scope.hidden], [HIDDEN]);
  const served = reportForViewer(scopedReport(scopeDataset(appDataset(), scope.visible), app.config), { logs: 'team' });
  const json = JSON.stringify(served);
  for (const s of ['ERP-Anbindung', HIDDEN, '"ERP-1"', '9001']) assert.ok(!json.includes(s), `no trace of ${s}`);
  assert.doesNotMatch(json, /\bERP-\d+/, 'no work item key of the hidden project');
  const hiddenRow = full.rows.find((r) => r.ref === HIDDEN);
  assert.ok(!served.rows.some((r) => r.OE === hiddenRow.OE && r.RE === hiddenRow.RE && r.TS === hiddenRow.TS), 'no row carries the hidden project\'s numbers');
  // totals, ranks, waterline, teams, extras: exactly the report of a portfolio that only ever had the visible projects
  const expected = reportForViewer(report(visibleOnly()), { logs: 'team' });
  assert.deepEqual(noAsOf(served), noAsOf(expected));
  assert.equal(served.kpis.activeProjects, full.kpis.activeProjects - 1);
  assert.notDeepEqual(served.waterlineNextQ, full.waterlineNextQ, 'the waterline is recomputed, not copied');
  assert.deepEqual(served.rows.map((r) => r.rank), served.rows.map((_, i) => i + 1), 'dense ranks 1..n as in the Portfolio');
  assert.equal(served.rows.find((r) => r.ref === 'issue:9002').rank, 2, 'the project behind the hidden one moves up');
});

test('nothing hidden → the stored snapshot itself; scoping a fully visible dataset changes nothing', async () => {
  const app = appDataset();
  const order = app.portfolio.map((p) => p.ref);
  const scope = callerScope(order, await visibleRefs('acc-9', order, { ...fakeJira({ hidden: new Set() }), cache: new Map() }));
  assert.equal(scope.hidden.size, 0);
  assert.equal(scopeDataset(app, scope.visible), app, 'same object – the stored snapshot is served as today');
});

test('hidden terms: names, keys and refs of hidden items are found in free text (whole words only)', () => {
  const full = report(appDataset());
  const terms = hiddenTerms(full, new Set([HIDDEN]));
  assert.ok(terms.includes('ERP-Anbindung') && terms.includes('ERP-1') && terms.includes(HIDDEN));
  assert.deepEqual(mentions('Status von ERP-Anbindung: gut', terms), ['ERP-Anbindung']);
  assert.deepEqual(mentions('Siehe ERP-12 und ERP-10', terms), [], 'ERP-1 is not ERP-12');
  assert.deepEqual(mentions('{"ref":"issue:9001"}', terms), [HIDDEN]);
  assert.deepEqual(mentions('Kundenportal Relaunch', terms), []);
});

test('composer draft: sections naming a hidden project are left out; the rest stays as the person wrote it', () => {
  const terms = hiddenTerms(report(appDataset()), new Set([HIDDEN]));
  const d = { v: 1, at: 1, settings: { audience: 'c-level', projectRef: HIDDEN },
    doc: { title: 'Bericht ERP-Anbindung', subtitle: 'Q4', projectRef: HIDDEN, sections: [
      { id: 'kpis', kind: 'kpis', title: 'Lage', text: '8 aktive Projekte', facts: [], data: { rows: [{ ref: 'issue:9000' }] } },
      { id: 'risks', kind: 'risks', title: 'Risiken', text: 'ERP-Anbindung ist kritisch', facts: [] },
      { id: 'data', kind: 'table', title: 'Projekte', text: '', facts: [], data: { rows: [{ ref: HIDDEN, key: 'ERP-1' }] } },
    ] } };
  const s = scrubDraft(d, terms);
  assert.deepEqual(s.doc.sections.map((x) => x.id), ['kpis']);
  assert.equal(s.doc.title, '');
  assert.equal(s.doc.subtitle, 'Q4');
  assert.equal(s.doc.projectRef, null);
  assert.equal(s.settings.projectRef, null);
  assert.doesNotMatch(JSON.stringify(s), /ERP|9001/);
  assert.equal(scrubDraft(d, []), d, 'nothing hidden → the draft as stored');
});

test('a hidden SPACE keeps its work items out even as dependencies (external) of visible projects', () => {
  const ds = {
    portfolio: [{ ref: 'space:1', rank: 1, kind: 'space', key: 'AAA', projectKey: 'AAA', name: 'A' }, { ref: 'space:2', rank: 2, kind: 'space', key: 'PHX', projectKey: 'PHX', name: 'Vertrauliches Projekt Phoenix' }, { ref: 'space:3', rank: 3, kind: 'space', key: 'CCC', projectKey: 'CCC', name: 'C' }],
    issues: [{ id: '1', key: 'AAA-1', rootRef: 'space:1', links: [{ otherId: '2' }, { otherId: '9' }], fixVersionIds: ['v1'] }, { id: '2', key: 'PHX-1', rootRef: 'space:2', links: [], fixVersionIds: ['v2'] }],
    external: [{ id: '9', key: 'PHX-9', projectKey: 'PHX' }, { id: '8', key: 'ZZZ-8', projectKey: 'ZZZ' }],
    versions: { v1: { id: 'v1', projectKey: 'AAA' }, v2: { id: 'v2', projectKey: 'PHX' } }, teams: [], capacity: { teams: {} },
  };
  const s = scopeDataset(ds, new Set(['space:1', 'space:3']));
  assert.deepEqual(s.portfolio.map((p) => [p.ref, p.rank, p.globalRank]), [['space:1', 1, 1], ['space:3', 2, 3]]);
  assert.deepEqual(s.issues.map((i) => i.key), ['AAA-1']);
  assert.deepEqual(s.issues[0].links, [], 'no link into the hidden project');
  assert.deepEqual(s.external.map((x) => x.key), ['ZZZ-8']);
  assert.deepEqual(Object.keys(s.versions), ['v1']);
  assert.doesNotMatch(JSON.stringify(s), /PHX|Phoenix/);
});

// ---------- plan vs. actual (bug: "Where did the hours go?" ranked 1, 3, 4, 5) ----------
function paStore() {
  const m = new Map();
  const weeks = [0, 1, 2, 3].map((k) => shiftWeek('2026-W42', k));
  const projects = { 'issue:9000': { n: 'Kundenportal Relaunch', k: 'KPR-1', r: 1 }, [HIDDEN]: { n: 'ERP-Anbindung', k: 'ERP-1', r: 2 }, 'issue:9002': { n: 'DSGVO-Löschkonzept', k: 'DSG-1', r: 3 }, 'issue:9003': { n: 'Mobile App 2.0', k: 'MOB-1', r: 4 } };
  for (const w of weeks) {
    const [a, b] = weekRange(w);
    m.set(planKey(w), { week: w, from: isoOf(a), to: isoOf(b), at: `${isoOf(a)}T05:00:00Z`, projects, teams: { 't-int': 'Integration' }, names: {},
      people: { u2: { t: 't-int', p: { [HIDDEN]: 20, 'issue:9002': 10, SUP: 4 } }, u5: { t: 't-int', p: { 'issue:9000': 24, 'issue:9003': 8 } } } });
    m.set(actKey(w), { week: w, final: true, people: { u2: { t: 't-int', b: { [HIDDEN]: 26, 'issue:9002': 2, SUP: 10 } }, u5: { t: 't-int', b: { 'issue:9000': 10, 'issue:9003': 2, INT: 12 } } },
      over: [{ ref: HIDDEN, key: 'ERP-120', t: 't-int', extra: 12, oe: 40 }, { ref: 'issue:9002', key: 'DSG-130', t: 't-int', extra: 5, oe: 20 }] });
  }
  m.set(LAST, { weeks, acts: weeks });
  return { get: async (k) => structuredClone(m.get(k) ?? null), set: async () => {}, del: async () => {} };
}

test('plan vs. actual: the hidden project\'s name, hours and tasks are gone; ranks are the Portfolio\'s (no gap)', async () => {
  const order = ['issue:9000', HIDDEN, 'issue:9002', 'issue:9003'];
  const fj = fakeJira();
  const scope = async (refs) => callerScope(order, await visibleRefs('acc-1', [...order, ...refs], { ...fj, cache: new Map() }), [...order, ...refs]);
  const before = await planActual({ weeks: 4 }, { store: paStore(), cfg: {} });
  assert.ok(JSON.stringify(before).includes('ERP-Anbindung'), 'precondition: the app records cover the hidden project');
  const p = await planActual({ weeks: 4 }, { store: paStore(), cfg: {}, scope, canSeePerson: () => true });
  const json = JSON.stringify(p);
  for (const s of ['ERP-Anbindung', HIDDEN, 'ERP-1', 'ERP-120']) assert.ok(!json.includes(s), `no trace of ${s}`);
  assert.deepEqual(Object.fromEntries(Object.entries(p.projects).map(([r, x]) => [r, x.rank])), { 'issue:9000': 1, 'issue:9002': 2, 'issue:9003': 3 });
  const a = analyzePlanActual(p, { lang: 'en' });
  const ranks = a.rows.filter((r) => r.kind === 'project').map((r) => r.rank);
  assert.deepEqual(ranks, [1, 2, 3], 'consecutive, as the Portfolio shows them');
  assert.ok(a.why.every((w) => w.rank != null && w.rankText.startsWith('Rank ')));
  const u2 = p.units.find((u) => u.id === 'u2');
  assert.equal(u2.plan[HIDDEN], undefined);
  assert.equal(u2.book[HIDDEN], undefined);
  assert.equal(a.kpis.plan, (10 + 4 + 24 + 8) * 4, 'the hidden project\'s planned hours do not count anywhere');
  assert.equal(a.kpis.book, (2 + 10 + 10 + 2 + 12) * 4, 'nor its booked hours');
});

test('plan vs. actual: records pass unchanged without a scope; refs no longer in the portfolio keep their name, rank null', () => {
  const plans = [{ projects: { 'issue:1': { n: 'A', k: 'A-1', r: 1 }, 'issue:7': { n: 'Old', k: 'O-1', r: 5 } }, people: { u: { t: 't', p: { 'issue:1': 2, 'issue:7': 3 } } } }];
  assert.equal(scopeWeekRecords(plans, [], null).plans, plans);
  const s = scopeWeekRecords(plans, [], { visible: new Set(['issue:1', 'issue:7']), rank: new Map([['issue:1', 1]]) });
  assert.deepEqual(s.plans[0].projects, { 'issue:1': { n: 'A', k: 'A-1', r: 1 }, 'issue:7': { n: 'Old', k: 'O-1', r: null } });
});

test('the view takes its ranks from the same source as the Portfolio (the dataset\'s dense ranks)', () => {
  const data = { state: 'ready', projects: { 'issue:9000': { name: 'A', rank: 1 }, 'issue:9002': { name: 'C', rank: 3 }, 'issue:7': { name: 'Old', rank: 9 } } };
  const out = withPortfolioRanks(data, [{ ref: 'issue:9000', rank: 1 }, { ref: 'issue:9002', rank: 2 }]);
  assert.deepEqual(Object.values(out.projects).map((x) => x.rank), [1, 2, null]);
  assert.equal(withPortfolioRanks(data, []), data);
  assert.match(read('static/cockpit/src/views/PlanActual.jsx'), /withPortfolioRanks\(res\.data, ds\?\.portfolio\)/);
});

test('server: every path out of the app snapshots is scoped to the caller; no role check was weakened', () => {
  const src = read('src/index.js');
  const body = (name, end) => src.slice(src.indexOf(`def('${name}'`), src.indexOf(end, src.indexOf(`def('${name}'`) + 10));
  for (const r of ['report.get', 'report.refresh']) {
    const b = body(r, '\ndef(');
    assert.match(b, /requireRole\(roles, 'viewReport'\)/, r);
    assert.match(b, /reportForViewer\(await reportOfCaller\(ctx, cfg/, r);
    assert.doesNotMatch(b, /get\(K\.report\)/, `${r} never serves the raw snapshot`);
  }
  for (const r of ['report.publish', 'ai.reportSummary']) {
    const b = body(r, '\ndef(');
    assert.match(b, /requireRole\(roles, 'viewReport'\)/, r);
    assert.match(b, /reportOfCaller\(ctx, cfg\)/, r);
    assert.doesNotMatch(b, /get\(K\.report\)/, r);
  }
  const hist = body('history.get', '\ndef(');
  assert.match(hist, /requireRole\(roles, 'viewReport'\)/);
  assert.match(hist, /visibleFor\(ctx,/);
  const fresh = src.slice(src.indexOf('async function freshComposed'), src.indexOf('const cleanDoc'));
  assert.match(fresh, /reportOfCaller\(ctx, cfg\)/);
  assert.match(fresh, /hiddenTermsFor\(ctx\)/);
  const pub = body('report.publishComposed', "def('report.unpublishComposed'");
  assert.match(pub, /mentions\(x\.text, hidden\)/, 'the re-check refuses hidden projects in texts');
  assert.ok(pub.indexOf('leaks') < pub.indexOf('if (!v.ok || dryRun) return'));
  assert.match(body('report.unpublishComposed', "def('notices.remind'"), /mentions\(\[prev\.title/, 'never restores a version naming a hidden project');
  const pa = src.slice(src.indexOf('async function planActualFor'), src.indexOf('async function freshComposed'));
  assert.match(pa, /NO_ACCESS:planActual/);
  assert.match(pa, /scope: paScope\(ctx\)/);
  const roc = src.slice(src.indexOf('async function reportOfCaller'), src.indexOf('async function hiddenTermsFor'));
  assert.match(roc, /if \(!scope\.hidden\.size\) return stored;/, 'nothing hidden → the stored snapshot as today');
  assert.match(roc, /scopedReport\(scopeDataset\(ds, scope\.visible\), cfg, pa\)/, 'otherwise recomputed from the visible items');
  assert.doesNotMatch(roc, /set\(K\.report/, 'a caller\'s view is never stored as the snapshot');
  assert.match(read('src/lib/reportScope.js'), /searchAll\('user', `id in \(/);
});
