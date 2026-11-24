// 2026-11-19 – boss: "Stories without a parent are not part of the structure and Action needed – it's only visible on
// My work but not in the project". Tester: red-week suggestions that end after the project due date were easy to miss
// ("after project due" in grey), "Apply to Jira" did not warn – "in general do not recommend moves after the due".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lotseDataset } from './lotseFixture.js';
import { computeAll, actionItems, dataQuality } from '../shared/engine.js';
import { buildBoard, planWeeks, moveTask, pastProjectDue } from '../shared/weekPlan.js';
import { suggestShifts } from '../shared/planSuggest.js';
import { parentChoices, orphansOf } from '../shared/orphans.js';
import { scopeDataset } from '../src/lib/reportScope.js';
import { isoOf, dayIdx } from '../shared/dates.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const EPS = 0.05;

// ---------- work items without a parent ----------
function withOrphans() {
  const ds = lotseDataset();
  const p0 = ds.portfolio[0], p1 = ds.portfolio[1], p2 = ds.portfolio[2];
  const story = { role: 'estimate', levelKey: 'story', type: { id: '10001', name: 'Story' }, parentId: null, links: [], worklogs: [], fixVersionIds: [], quarters: [], note: null };
  // the only project in its space → it belongs to p0 (one overdue, one done)
  ds.issues.push({ ...story, id: '777001', key: 'KPR-901', summary: 'Datenexport', rootRef: p0.ref, orphan: true, status: { name: 'Offen', cat: 'new' }, assignee: { id: 'u2', name: 'Jonas Weber' }, team: ds.teams[0], start: '2026-10-26', due: '2026-10-30', oe: 24, re: 24, ts: 0 });
  ds.issues.push({ ...story, id: '777002', key: 'KPR-902', summary: 'Alt und fertig', rootRef: p0.ref, orphan: true, status: { name: 'Fertig', cat: 'done' }, assignee: null, team: null, start: null, due: null, oe: 4, re: 0, ts: 4 });
  // a space with two projects → unclear, listed under both, counted nowhere
  ds.orphans = [{ id: '777003', key: 'ERP-903', summary: 'Barrierefreiheit', role: 'estimate', levelKey: 'story', type: story.type, status: { name: 'Offen', cat: 'new' }, assignee: null, team: null, start: null, due: null, oe: 16, re: 16, ts: 0, projectKey: 'ERP', candidates: [p1.ref, p2.ref] }];
  return { ds, p0, p1, p2 };
}

test('parentless work items: in the project (structure, hours, Action needed) – unclear ones under every candidate, counted nowhere', () => {
  const { ds, p0, p1, p2 } = withOrphans();
  const c = computeAll(ds);
  const { model, metrics, wl, deps } = c;
  // they are part of the project's work items – the tree puts them at the root, the hours count
  const own = orphansOf(model, p0.ref);
  assert.deepEqual(own.own.map((i) => i.key).sort(), ['KPR-901', 'KPR-902']);
  assert.ok((model.byRoot.get(p0.ref) || []).some((i) => i.id === '777001'));
  // Action needed: "no parent" for the open one; the overdue one is also "past due" like any other story
  const a0 = actionItems(model, p0, metrics.get(p0.ref), wl, deps, dataQuality(model, new Set([p0.ref])));
  const np = a0.filter((a) => a.kind === 'noParent');
  assert.deepEqual(np.map((a) => a.key), ['KPR-901'], 'only the open one');
  assert.ok(a0.some((a) => a.kind === 'overdue' && a.key === 'KPR-901'), 'overdue like any work item');
  // the unclear one: in both candidate projects, flagged, and in no project's hours
  for (const p of [p1, p2]) {
    const a = actionItems(model, p, metrics.get(p.ref), wl, deps, dataQuality(model, new Set([p.ref])));
    const x = a.find((y) => y.kind === 'noParent' && y.key === 'ERP-903');
    assert.ok(x && x.unclear && x.candidates.length === 2, p.ref);
  }
  assert.ok(![...model.byRoot.values()].flat().some((i) => i.id === '777003'), 'unclear: counted nowhere');
  assert.ok(!actionItems(model, ds.portfolio[3], metrics.get(ds.portfolio[3].ref), wl, deps, dataQuality(model, new Set([ds.portfolio[3].ref]))).some((a) => a.kind === 'noParent'));
});

test('parentChoices: the level directly above, from this project only (epics for a story; else workstreams; else the project)', () => {
  const { ds, p0 } = withOrphans();
  const { model } = computeAll(ds);
  const orphan = model.byId.get('777001');
  const ch = parentChoices(model, ds.config, p0.ref, orphan);
  assert.ok(ch.length > 0);
  assert.ok(ch.every((x) => x.role === 'structure'), 'epics for a story');
  assert.ok(ch.every((x) => model.byId.get(x.id)?.rootRef === p0.ref), 'only this project');
  assert.ok(!ch.some((x) => x.id === orphan.id));
  // an epic without a parent → workstreams; a workstream → the project itself
  const ep = parentChoices(model, ds.config, p0.ref, { id: 'x', role: 'structure', levelKey: 'epic' });
  assert.ok(ep.length && ep.every((x) => x.role === 'rough'));
  const ws = parentChoices(model, ds.config, p0.ref, { id: 'y', role: 'rough', levelKey: 'workstream' });
  assert.deepEqual(ws.map((x) => x.role), ['portfolio']);
  assert.equal(ws[0].id, String(p0.id));
  // with hierarchy numbers in the configuration: exactly one level above
  const cfg = { ...ds.config, levels: ds.config.levels.map((l) => ({ ...l, hierarchy: { workstream: 2, epic: 1, story: 0, subtask: -1 }[l.key] })) };
  assert.ok(parentChoices(model, cfg, p0.ref, orphan).every((x) => x.levelKey === 'epic'));
  assert.deepEqual(parentChoices(model, ds.config, p0.ref, { id: 'z', role: 'tiny' }), [], 'sub-tasks always have a parent');
});

test('reports and privacy: unclear parentless items only with the candidate projects the viewer may see; pseudonymised', () => {
  const { ds, p1, p2 } = withOrphans();
  const only1 = scopeDataset(ds, new Set([p1.ref]));
  assert.deepEqual(only1.orphans.map((o) => o.candidates), [[p1.ref]]);
  const none = scopeDataset(ds, new Set([ds.portfolio[5].ref]));
  assert.deepEqual(none.orphans, []);
  const src = read('src/lib/dataset.js');
  assert.match(src, /for \(const x of ds\.orphans \|\| \[\]\) x\.assignee = anonUser\(x\.assignee\)/);
});

test('dataset: parentless items of the projects\' spaces – no project/theme types, no sub-tasks, no support work; one project = its own', () => {
  const src = read('src/lib/dataset.js');
  assert.match(src, /parent is EMPTY AND issuetype in standardIssueTypes\(\)/);
  assert.match(src, /issuetype not in \(/);
  assert.match(src, /AND NOT \$\{support\}/, 'support tickets stay support');
  assert.match(src, /\['rough', 'structure', 'estimate'\]\.includes\(role\)/);
  assert.match(src, /const projects = Math\.max\(refs\.length, spaceCount\.get\(space\) \|\| 0\);/, 'project work items outside the portfolio count too (live on dev: PCX holds five)');
  assert.match(src, /if \(projects === 1\) \{ const n = normalize\(raw, F, roleOf, refs\[0\]\); n\.orphan = true;/);
  assert.match(src, /candidates: refs, spaceProjects: projects/);
  assert.match(src, /await walk\(found\.own\.map/, 'what hangs below a parentless epic comes along');
  assert.match(src, /issues, orphans, orphanInfo, external/);
});

test('issue.parent: only for a work item without a parent, as the user, undo only while it is still the one that was set', () => {
  const src = read('src/index.js');
  const body = src.slice(src.indexOf("def('issue.parent'"), src.indexOf('// ---------- capacity (UC-14)'));
  assert.match(body, /HAS_PARENT/);
  assert.match(body, /PARENT_CHANGED/);
  assert.match(body, /canEditIssue\(issueId\)/);
  assert.match(body, /visibleIssue\(parentId/);
  assert.match(body, /jira\('user', `\/rest\/api\/3\/issue\/\$\{issueId\}`/);
  assert.match(body, /audit\(await withName\(ctx\), undo \? 'issue\.parent\.undo' : 'issue\.parent'/);
  const admin = read('static/cockpit/src/views/Admin.jsx');
  for (const a of ['issue.parent', 'issue.parent.undo']) assert.ok(admin.includes(`'${a}':`), a);
  const mock = read('static/cockpit/src/lib/mock.js');
  assert.ok(mock.includes("case 'issue.parent'"));
  const proj = read('static/cockpit/src/views/Project.jsx');
  assert.match(proj, /data-parent-fix/);
  assert.match(proj, /data-orphan/);
  assert.match(proj, /No parent – project unclear/);
});

// ---------- suggestions and the project due date ----------
function bigTask(projectDueOffsetWeeks) {
  const ds = lotseDataset();
  const c0 = computeAll(ds);
  const W = planWeeks(c0.model.today, 8);
  const people = ds.capacity.people;
  const free = new Map();
  for (const team of c0.model.teams.keys()) for (const r of buildBoard({ ds, computed: c0, team }).rows) if (r.kind === 'person' && !free.has(r.accountId)) free.set(r.accountId, r.cells.slice(2, 7).reduce((a, x) => a + (x.avail > EPS ? x.avail - x.load : -99), 0));
  const story = ds.issues.filter((i) => i.role === 'estimate' && i.status?.cat !== 'done' && i.assignee?.id && people[i.assignee.id] && i.start && i.due && free.has(i.assignee.id))
    .sort((a, b) => free.get(b.assignee.id) - free.get(a.assignee.id))[0];
  story.start = isoOf(W[2].a); story.due = isoOf(W[2].a + 4); story.oe = 80;
  const proj = ds.portfolio.find((p) => p.ref === story.rootRef);
  proj.due = isoOf(W[2 + projectDueOffsetWeeks].a + 4);
  return { ds, story, proj, teamId: story.team?.id || people[story.assignee.id].teamId };
}

test('red-week advice stays within the project due date when it can – and is marked (and ranked last) when it cannot', () => {
  // room: the project is due four weeks later – the advice ends by then
  {
    const { ds, story, proj, teamId } = bigTask(4);
    const computed = computeAll(ds);
    const mine = suggestShifts({ ds, computed, board: buildBoard({ ds, computed, team: teamId }) }).find((x) => x.taskId === story.id);
    assert.ok(mine, 'a suggestion');
    assert.equal(mine.pastProjectDue, false);
    assert.ok(dayIdx(mine.newDue) <= dayIdx(proj.due), `${mine.newDue} ≤ ${proj.due}`);
  }
  // no room: the project is due in the task's own week – whatever helps ends later: marked, never first
  {
    const { ds, story, proj, teamId } = bigTask(0);
    const computed = computeAll(ds);
    const list = suggestShifts({ ds, computed, board: buildBoard({ ds, computed, team: teamId }) });
    const mine = list.find((x) => x.taskId === story.id);
    if (mine) {
      assert.equal(mine.pastProjectDue, true);
      assert.equal(mine.projectDue, proj.due);
      const firstLate = list.findIndex((x) => x.pastProjectDue);
      assert.ok(list.slice(firstLate).every((x) => x.pastProjectDue), 'the ones past the due come last');
    }
  }
});

test('pastProjectDue: staged changes that move a due date after the project\'s – the pending list warns before "Apply"', () => {
  const { ds, story, proj } = bigTask(1);
  const { model } = computeAll(ds);
  const late = moveTask({}, story, { weeks: 3 });
  const r = pastProjectDue(model, late);
  assert.ok(r.has(story.id));
  const x = r.get(story.id);
  assert.equal(x.projectDue, proj.due);
  assert.ok(x.days > 0 && x.project === proj.name);
  assert.equal(pastProjectDue(model, moveTask({}, story, { weeks: 1 })).size, 0, 'within the due: no warning');
  assert.equal(pastProjectDue(model, moveTask({}, story, { assignee: 'u3', assigneeName: 'X' })).size, 0, 'no date change: no warning');
  const wb = read('static/cockpit/src/components/WeekBoard.jsx');
  assert.match(wb, /if \(x\.pastProjectDue\) continue;/, 'never a one-click cell button past the due');
  assert.match(wb, /data-pending-pastdue/);
  assert.match(wb, /Apply despite project due/);
  assert.match(wb, /data-sug-pastdue/);
  assert.match(wb, /Accept anyway/, 'a past-due suggestion is never the primary button');
  assert.match(wb, /Red weeks – no suggestion fits by the project due/);
  assert.match(wb, /className="due-warn"/);
  assert.match(wb, /openSug\.filter\(\(x\) => !x\.pastProjectDue\)\.forEach/, '"accept all" leaves them out');
});
