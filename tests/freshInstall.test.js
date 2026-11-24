// First installation on an unknown customer site: the server resolvers driven END TO END through the Forge resolver
// handler (src/index.js `handler`: kill switch → caller → config from storage → roles → resolver), against a fake Forge
// runtime – app storage (KVS wire protocol), Jira REST (as the user / as the app) and Forge LLM all go through
// global.__forge_fetch__, which this file answers. Every LLM request is counted (there must be none: AI is off).
//
// Shapes covered: nothing configured at all; a first admin completing setup on a site without Jira Service Management,
// without time tracking, without Start date / Team fields and with a team-managed project; a site with 0 issues; a
// German site (status names German – categories by key); a caller who may not browse one project; issue linking
// switched off; a custom field deleted after setup; rate limiting (429); an old stored config version.
// For every call: no unexpected error ("ERROR" = a 500 for the UI), no console.error, no LLM call, AI off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAll, cLevelReport } from '../shared/engine.js';

const APP_UUID = '0a1b2c3d-1111-4222-8333-444455556666';
const ENV_UUID = '9f8e7d6c-5555-4666-8777-888899990000';
globalThis.__forge_runtime__ = {
  appContext: { appId: `ari:cloud:ecosystem::app/${APP_UUID}`, environmentType: 'PRODUCTION', environmentId: ENV_UUID, invocationId: 'test', installationId: 'test', moduleKey: 'pc-cockpit', permissions: { scopes: [] } },
  lambdaContext: { getRemainingTimeInMillis: () => 25000 }, proxy: { token: '', url: 'http://127.0.0.1:9' },
  metrics: { counter: () => ({ incr() {} }), timing: () => ({ measure: () => ({ stop() {} }) }) }, tracing: {},
};

// ---------- the fake Forge runtime ----------
const cur = { site: null, kv: new Map(), user: null, llm: 0, unknown: [], requests: [], graph: [] };
const json = (status, body) => new Response(status === 204 || body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function kvsAnswer(path, body) {
  const kv = cur.kv;
  if (path.endsWith('/api/v1/get')) return json(200, kv.has(body.key) ? { key: body.key, value: JSON.parse(kv.get(body.key)) } : {});
  if (path.endsWith('/api/v1/set')) { kv.set(body.key, JSON.stringify(body.value)); return new Response('', { status: 200 }); }
  if (path.endsWith('/api/v1/delete')) { kv.delete(body.key); return new Response('', { status: 200 }); }
  if (path.endsWith('/api/v1/query')) {
    const w = (body.where || [])[0];
    const keys = [...kv.keys()].filter((k) => !w || (w.condition === 'BEGINS_WITH' && k.startsWith(w.values[0]))).sort();
    const start = body.after ? keys.indexOf(body.after) + 1 : 0;
    const page = keys.slice(start, start + (body.limit || 100));
    return json(200, { data: page.map((k) => ({ key: k, value: JSON.parse(kv.get(k)) })), cursor: start + page.length < keys.length ? page.at(-1) : undefined });
  }
  throw new Error(`kvs ${path} not faked`);
}

globalThis.__forge_fetch__ = async (target, path, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (target.type === 'kvs') return kvsAnswer(path, body);
  if (target.type === 'llm') { cur.llm++; return json(500, { message: 'no LLM in this test' }); }
  if (target.remote === 'confluence') return json(404, { message: 'no Confluence on this site' });
  // Atlassian Teams members (Teamwork Graph, as the user): answered from spec.teamMembers, or no rows (scopes not granted)
  if (target.remote === 'stargate' && String(path).endsWith('/graphql/twg')) { cur.graph.push({ provider: target.provider, op: body?.operationName }); const [status, out] = cur.site.graph(body); return json(status, out); }
  if (target.remote !== 'jira') throw new Error(`unexpected request ${JSON.stringify(target)} ${path}`);
  const as = target.provider === 'app' ? 'app' : 'user';
  const url = new URL(String(path), 'https://site.invalid');
  cur.requests.push(`${as} ${init.method || 'GET'} ${url.pathname}`);
  const [status, out] = await cur.site.answer({ as, user: cur.user, method: init.method || 'GET', path: url.pathname, query: url.searchParams, body });
  return json(status, out);
};

const backend = await import('../src/index.js');

// ---------- a fake Jira site ----------
const TYPES_EN = [
  { id: '10000', name: 'Epic', hierarchyLevel: 1 }, { id: '10001', name: 'Story', hierarchyLevel: 0 }, { id: '10002', name: 'Task', hierarchyLevel: 0 },
  { id: '10004', name: 'Bug', hierarchyLevel: 0 }, { id: '10003', name: 'Subtask', hierarchyLevel: -1, subtask: true },
];
const TYPES_DE = [
  { id: '10000', name: 'Epic', hierarchyLevel: 1 }, { id: '10001', name: 'Story', hierarchyLevel: 0 }, { id: '10002', name: 'Aufgabe', hierarchyLevel: 0 },
  { id: '10004', name: 'Fehler', hierarchyLevel: 0 }, { id: '10003', name: 'Unteraufgabe', hierarchyLevel: -1, subtask: true },
];
const STATUS = {
  en: [['1', 'To Do', 'new'], ['3', 'In Progress', 'indeterminate'], ['10001', 'Done', 'done'], ['10010', 'Blocked', 'indeterminate']],
  de: [['1', 'Zu erledigen', 'new'], ['3', 'In Arbeit', 'indeterminate'], ['10001', 'Fertig', 'done'], ['10010', 'Blockiert', 'indeterminate']],
};
const appField = (key, name, type) => ({ id: { 'pc-portfolio-rank': 'customfield_10500', 'pc-tshirt-size': 'customfield_10501', 'pc-target-quarters': 'customfield_10502' }[key], name, custom: true, schema: { type, custom: `ari:cloud:ecosystem::extension/${APP_UUID}/${ENV_UUID}/static/${key}` } });

// spec: { lang, timeTracking, startDate, team, linking, jsm, projects: [{ id, key, name, scoped? }], issues, users, hidden: { accountId: [projectId] }, rateLimit }
function makeSite(spec) {
  const lang = spec.lang || 'en';
  const types = [...(lang === 'de' ? TYPES_DE : TYPES_EN)];
  for (const p of spec.projects || []) if (p.scoped) types.push({ id: `${p.id}1`, name: 'Task', hierarchyLevel: 0, scope: { type: 'PROJECT', project: { id: p.id } } }, { id: `${p.id}2`, name: 'Epic', hierarchyLevel: 1, scope: { type: 'PROJECT', project: { id: p.id } } });
  const statuses = STATUS[lang].map(([id, name, key]) => ({ id, name, statusCategory: { key } }));
  const fields = [
    { id: 'summary', name: lang === 'de' ? 'Zusammenfassung' : 'Summary', custom: false, schema: { type: 'string' } },
    appField('pc-portfolio-rank', 'Portfolio Rank', 'number'), appField('pc-tshirt-size', 'T-Shirt Size', 'string'), appField('pc-target-quarters', 'Target Quarters', 'string'),
    ...(spec.startDate ? [{ id: 'customfield_10015', name: lang === 'de' ? 'Startdatum' : 'Start date', custom: true, schema: { type: 'date', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:datepicker' } }] : []),
    ...(spec.team ? [{ id: 'customfield_10001', name: 'Team', custom: true, schema: { type: 'team', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team' } }] : []),
    ...(spec.jsm ? [{ id: 'customfield_10020', name: 'Time to resolution', custom: true, schema: { type: 'sd-servicelevelagreement', custom: 'com.atlassian.servicedesk:sd-sla-field' } }] : []),
    ...(spec.extraFields || []),
  ];
  const users = spec.users || {};
  const hidden = spec.hidden || {};
  const issues = spec.issues || [];
  const projects = spec.projects || [];
  const canBrowse = (as, user, projectId) => as === 'app' || !(hidden[user] || []).includes(String(projectId));
  const userJson = (id) => (id ? { accountId: id, displayName: users[id]?.name || id, active: true, accountType: 'atlassian', avatarUrls: {} } : null);
  const typeJson = (id) => { const t = types.find((x) => x.id === id); return { id, name: t.name, hierarchyLevel: t.hierarchyLevel, subtask: !!t.subtask, iconUrl: null }; };
  const statusJson = (id) => { const s = statuses.find((x) => x.id === id); return { id, name: s.name, statusCategory: { key: s.statusCategory.key } }; };
  const projJson = (p) => ({ id: p.id, key: p.key, name: p.name, projectTypeKey: p.type || 'software', style: p.scoped ? 'next-gen' : 'classic', lead: userJson(p.lead || null), avatarUrls: {} });
  function issueJson(i, wanted) {
    const all = !wanted;
    const want = new Set(wanted || []);
    const f = {};
    const put = (k, v) => { if ((all || want.has(k)) && v !== undefined) f[k] = v; };
    put('summary', i.summary); put('issuetype', typeJson(i.typeId)); put('parent', i.parentId ? { id: i.parentId } : undefined);
    put('status', statusJson(i.statusId)); put('assignee', userJson(i.assignee)); put('duedate', i.due ?? null);
    put('project', projJson(projects.find((p) => p.id === i.projectId))); put('fixVersions', []); put('issuelinks', i.links || []);
    put('created', i.created || '2026-09-01T09:00:00.000+0200'); put('labels', []); put('priority', { name: 'Medium' }); put('components', []);
    put('worklog', { total: (i.worklogs || []).length, worklogs: (i.worklogs || []).map((w) => ({ author: userJson(w.a), started: w.started, timeSpentSeconds: w.secs })) });
    if (spec.timeTracking) {
      const s = (h) => (h == null ? null : Math.round(h * 3600));
      for (const [k, v] of [['timeoriginalestimate', i.oe], ['timeestimate', i.re], ['timespent', i.ts], ['aggregatetimeoriginalestimate', i.oe], ['aggregatetimeestimate', i.re], ['aggregatetimespent', i.ts]]) put(k, s(v));
    }
    if (spec.startDate) put('customfield_10015', i.start ?? null);
    if (spec.team) put('customfield_10001', i.team ? { id: i.team, name: i.team } : null);
    return { id: i.id, key: i.key, fields: f };
  }
  function search(jql, as, user) {
    const vis = issues.filter((i) => canBrowse(as, user, i.projectId));
    const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
    let m;
    if ((m = /^\(?id in \(([^)]*)\)/.exec(jql))) { const ids = list(m[1]); return vis.filter((i) => ids.includes(i.id)); }
    if ((m = /^id = (\d+)/.exec(jql))) return vis.filter((i) => i.id === m[1]);
    if ((m = /^parent in \(([^)]*)\)/.exec(jql))) { const ids = list(m[1]); return vis.filter((i) => ids.includes(i.parentId)); }
    if ((m = /^project = (\d+)/.exec(jql))) return vis.filter((i) => i.projectId === m[1]);
    if ((m = /^\(?\(?project in \(([^)]*)\)/.exec(jql))) { const ids = list(m[1]); return vis.filter((i) => ids.includes(i.projectId) && (!/statusCategory = Done/.test(jql) || statuses.find((s) => s.id === i.statusId).statusCategory.key === 'done')); }
    if (/^assignee = currentUser\(\)/.test(jql)) return vis.filter((i) => i.assignee === user);
    if (/^(worklogAuthor = currentUser\(\)|issue in updatedBy|issuetype in|cf\[\d+\])/.test(jql)) return [];
    cur.unknown.push(jql);
    return [];
  }
  let throttled = 0;
  // Atlassian Teams: the Team field's values (JQL suggestions) and each team's members (spec.teamMembers: { teamId: [accountId] })
  const teamIds = [...new Set(issues.map((i) => i.team).filter(Boolean))];
  return {
    issues, projects,
    graph(body) {
      const teamId = String(body?.variables?.teamAri || '').split('/').pop();
      const ids = spec.teamMembers?.[teamId] || [];
      return [200, { data: { atlassianTeamMembers: { edges: ids.map((id) => ({ node: { __typename: 'AtlassianUser', accountId: id, name: users[id]?.name || id } })), pageInfo: { hasNextPage: false, endCursor: null } } } }];
    },
    async answer({ as, user, method, path, query, body }) {
      if (path === '/rest/api/3/jql/autocompletedata/suggestions') {
        if (as !== 'user' || !spec.team) return [400, { errorMessages: ['field unknown'] }];
        const v = String(query.get('fieldValue') || '').toLowerCase();
        return [200, { results: teamIds.filter((t) => t.toLowerCase().startsWith(v)).map((t) => ({ value: t, displayName: `Team ${t.slice(0, 4)}` })) }];
      }
      if (spec.rateLimit && path === '/rest/api/3/search/jql' && throttled < spec.rateLimit) { throttled++; return [429, { errorMessages: ['Rate limit exceeded'] }]; }
      const P = (re) => re.exec(path);
      let m;
      if (path === '/rest/api/3/myself') return [200, { ...userJson(user), locale: lang === 'de' ? 'de_DE' : 'en_US' }];
      if (path === '/rest/api/3/mypermissions') {
        const keys = String(query.get('permissions') || '').split(',');
        const iss = query.get('issueId') ? issues.find((i) => i.id === query.get('issueId')) : null;
        const browse = !iss || canBrowse(as, user, iss.projectId);
        return [200, { permissions: Object.fromEntries(keys.map((k) => [k, { havePermission: k === 'ADMINISTER' ? !!users[user]?.admin : browse }])) }];
      }
      if (path === '/rest/api/3/user/groups') return [200, (users[query.get('accountId')]?.groups || []).map((g) => ({ groupId: g, name: g }))];
      if (path === '/rest/api/3/serverInfo') return [200, { baseUrl: 'https://customer.atlassian.net', serverTimeZone: lang === 'de' ? 'Europe/Berlin' : 'UTC' }];
      // spec.otherEnvFirst: the same app installed in another environment on this site – its fields come first in the list
      if (path === '/rest/api/3/field') return [200, spec.otherEnvFirst ? [...['pc-portfolio-rank', 'pc-tshirt-size', 'pc-target-quarters'].map((k, i) => ({ id: `customfield_1040${i}`, name: k, custom: true, schema: { type: 'any', custom: `ari:cloud:ecosystem::extension/${APP_UUID}/00000000-1111-4222-8333-999999999999/static/${k}` } })), ...fields] : fields];
      if (path === '/rest/api/3/issuetype') return [200, types];
      if (path === '/rest/api/3/issueLinkType') return spec.linking === false ? [404, { errorMessages: ['Issue linking is disabled.'] }] : [200, { issueLinkTypes: [{ id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, { id: '10003', name: 'Relates', inward: 'relates to', outward: 'relates to' }] }];
      if (path === '/rest/api/3/priority/search') return [200, { values: [{ id: '3', name: 'Medium' }] }];
      if (path === '/rest/api/3/status') return [200, statuses];
      if (path === '/rest/api/3/project/search') {
        const typeKey = query.get('typeKey');
        return [200, { values: projects.filter((p) => canBrowse(as, user, p.id) && (!typeKey || (p.type || 'software') === typeKey)).map(projJson) }];
      }
      if ((m = P(/^\/rest\/api\/3\/project\/(\d+)$/))) { const p = projects.find((x) => x.id === m[1]); return p && canBrowse(as, user, p.id) ? [200, projJson(p)] : [404, { errorMessages: ['No project could be found'] }]; }
      if (path === '/rest/api/3/search/jql') {
        // Jira Plans' function: every descendant of a work item – only on sites with Plans (spec.plans), else HTTP 400
        const pci = /^issue in portfolioChildIssuesOf\("([^"]+)"\)$/.exec(body.jql);
        if (pci && !spec.plans) return [400, { errorMessages: [`Unable to find JQL function 'portfolioChildIssuesOf("${pci[1]}")'.`] }];
        const all = pci && spec.plans === 'empty' ? [] : pci ? (() => { const root = issues.find((i) => i.key === pci[1]); const ids = new Set([root?.id]); let grew = true; while (grew) { grew = false; for (const i of issues) if (!ids.has(i.id) && ids.has(i.parentId)) { ids.add(i.id); grew = true; } } return issues.filter((i) => i.id !== root?.id && ids.has(i.id) && canBrowse(as, user, i.projectId)); })() : search(body.jql, as, user);
        const at = Number(body.nextPageToken || 0), n = Math.min(100, body.maxResults || 50);
        const page = all.slice(at, at + n);
        return [200, { issues: page.map((i) => issueJson(i, body.fields)), ...(at + n < all.length ? { nextPageToken: String(at + n), isLast: false } : { isLast: true }) }];
      }
      if (path === '/rest/api/3/search/approximate-count') return [200, { count: 0 }];
      if ((m = P(/^\/rest\/api\/3\/issue\/(\d+)\/(changelog|comment|worklog)$/))) return [200, { values: [], comments: [], worklogs: [], total: 0 }];
      if ((m = P(/^\/rest\/api\/3\/issue\/(\d+)$/)) && method === 'GET') { const i = issues.find((x) => x.id === m[1]); return i && canBrowse(as, user, i.projectId) ? [200, issueJson(i, String(query.get('fields') || '').split(',').filter(Boolean))] : [404, { errorMessages: ['Issue does not exist'] }]; }
      if (path === '/rest/api/3/user/bulk') return [200, { values: query.getAll('accountId').map(userJson) }];
      if (path === '/rest/api/3/worklog/updated') return [200, { values: [], lastPage: true, until: Date.now() }];
      if (path === '/rest/api/3/worklog/list') return [200, []];
      if (path === '/rest/api/3/groups/picker') return [200, { groups: [] }];
      // the app may only write its OWN fields: another app's / environment's field id → 403 (spec.refuseField: every write)
      if ((m = P(/^\/rest\/api\/3\/app\/field\/(customfield_\d+)\/value$/)) && method === 'PUT') return spec.refuseField || !['customfield_10500', 'customfield_10501', 'customfield_10502'].includes(m[1]) ? [403, { errorMessages: ['The app is not the owner of this field.'] }] : [204];
      cur.unknown.push(`${method} ${path}`);
      return [404, { errorMessages: [`not faked: ${path}`] }];
    },
  };
}

const ADMIN = 'acc-admin', EMP = 'acc-employee', MGMT = 'acc-mgmt';
const USERS = { [ADMIN]: { name: 'Site Admin', admin: true }, [EMP]: { name: 'Erika Muster' }, [MGMT]: { name: 'Max Manager', groups: ['grp-mgmt'] } };

// A fresh site: new storage, the given Jira. Returns call(name, payload, { as, moduleKey, extension }).
function install(spec, kv = new Map()) {
  cur.site = makeSite({ users: USERS, ...spec });
  cur.kv = kv;
  cur.llm = 0; cur.unknown = []; cur.requests = [];
  return async (name, payload = {}, { as = ADMIN, moduleKey = 'pc-cockpit', extension = {} } = {}) => {
    cur.user = as;
    const r = await backend.handler({ call: { functionKey: name, payload }, context: { moduleKey, extension } }, { principal: { accountId: as } });
    assert.ok(r && typeof r === 'object', `${name}: answers`);
    if (!r.ok) assert.notEqual(r.error.code, 'ERROR', `${name} as ${as}: unexpected error (a 500 in the UI): ${r.error.message}`);
    return r;
  };
}
// console.error = an unexpected failure the resolver wrapper or a job logged
function watchErrors() {
  const errs = [];
  const orig = console.error;
  console.error = (...a) => { errs.push(a.join(' ')); };
  return { errs, restore: () => { console.error = orig; } };
}
// every number a view would render: finite (no NaN / Infinity reaches a chart or a label)
function nonFinite(x, path = '$', out = [], seen = new Set(), depth = 0) {
  if (typeof x === 'number' && !Number.isFinite(x)) out.push(path);
  if (!x || typeof x !== 'object' || seen.has(x) || depth > 12 || out.length > 20) return out;
  seen.add(x);
  const entries = x instanceof Map ? [...x.entries()] : Object.entries(x);
  for (const [k, v] of entries.slice(0, 400)) nonFinite(v, `${path}.${k}`, out, seen, depth + 1);
  return out;
}
const AI_RESOLVERS = [['ai.ask', { question: 'Wie steht es?' }], ['ai.reportSummary', {}], ['ai.healthDraft', { ref: 'space:10010' }], ['ai.assist', { feature: 'teamBrief' }], ['lotse.llm', { story: {} }]];

// the issues of a small, ordinary software space
function softwareIssues(projectId, key, n, { start = 1, team = null } = {}) {
  const out = [];
  const epic = { id: `${projectId}0`, key: `${key}-1`, projectId, typeId: '10000', summary: 'Epic one', statusId: '3', assignee: EMP, due: '2027-03-31' };
  out.push(epic);
  for (let k = 0; k < n; k++) {
    out.push({ id: `${projectId}${k + start}`, key: `${key}-${k + 2}`, projectId, typeId: k % 3 ? '10001' : '10002', summary: `Story ${k + 1}`, parentId: epic.id,
      statusId: ['1', '3', '10001', '10010'][k % 4], assignee: k % 2 ? EMP : MGMT, oe: 8, re: k % 4 === 2 ? 0 : 6, ts: 2, due: k % 5 ? '2027-01-15' : null, start: '2026-11-02', team,
      worklogs: [{ a: EMP, started: '2026-11-10T08:00:00.000+0100', secs: 7200 }] });
  }
  return out;
}

// ---------- 1. nothing configured at all ----------
test('fresh install, nothing in storage: every resolver the UI calls on load answers sensibly; AI off; jobs skip', async () => {
  const call = install({ projects: [{ id: '10010', key: 'ALPHA', name: 'Alpha' }], issues: softwareIssues('10010', 'ALPHA', 4), timeTracking: true });
  const w = watchErrors();
  const prevBudget = process.env.AI_BUDGET;
  // SUPERPORT's environment variable can raise budgets and caps – it can never switch AI on for a site
  process.env.AI_BUDGET = JSON.stringify({ eurPerMonth: 100000, dailyPerPerson: 500, stop: false, sites: { 'customer.atlassian.net': 100000 }, callsPerMonth: 100000, tokensPerMonth: 100000000 });
  try {
    assert.equal((await call('availability')).data.mode, 'off'); // the plain resolver (no wrapper) also answers
    for (const as of [ADMIN, EMP]) {
      const b = await call('bootstrap', { withDataset: true }, { as });
      assert.equal(b.ok, true);
      assert.equal(b.data.setupComplete, false);
      assert.equal(b.data.dataset, null, 'no dataset before setup');
      assert.equal(b.data.roles.admin, as === ADMIN);
      assert.equal(b.data.config.ai.enabled, false, 'AI off for the site');
      assert.equal(b.data.config.ai.user, false, 'AI off for the person');
      assert.equal(b.data.config.ai.access, 'self');
      assert.equal(b.data.config.ai.shareNames, false);
      assert.equal(b.data.config.ai.shareTexts, false);
      assert.equal(b.data.config.notices?.enabled, false, 'reminders off');
      assert.deepEqual(b.data.config.report.publishSpaces, [], 'no Confluence target approved');
      assert.equal(b.data.availability.mode, 'off');
      const ds = await call('dataset', {}, { as });
      assert.equal(ds.ok, false);
      assert.equal(ds.error.code, 'SETUP_REQUIRED', 'the UI shows the setup screen');
      // AI: refused before anything is read (AI_DISABLED), whatever the variable says
      for (const [name, payload] of AI_RESOLVERS) {
        const r = await call(name, payload, { as });
        assert.equal(r.ok, false, name);
        assert.equal(r.error.code, 'AI_DISABLED', `${name} is off`);
      }
      // the rest of what the UI may call on load: answers or a clean refusal – never a 500
      for (const [name, payload] of [['report.get', {}], ['report.refresh', {}], ['report.draft', {}], ['history.get', {}], ['planActual.get', { weeks: 4, team: 'all' }],
        ['digest.save', { items: {} }], ['prefs.save', { lang: 'de' }], ['usage.track', { events: { 'view:portfolio': 1 } }], ['lotse.learned', {}], ['playbooks.list', {}],
        ['mine.week', { from: '2026-11-09', to: '2026-11-13' }], ['mine.evidence', { from: '2026-11-09', to: '2026-11-13' }], ['insights.history', { months: 12 }], ['field.options', {}],
        ['confluence.spaces', {}], ['capacity.get', {}], ['settings.get', {}], ['audit.list', {}], ['usage.summary', {}], ['ai.users', {}], ['ai.spend', {}], ['config.history', {}],
        ['booking.worklogs', { from: '2026-11-09', to: '2026-11-13' }]]) await call(name, payload, { as });
      const sc = await call('story.check', { lang: 'de' }, { as, moduleKey: 'pc-story-check', extension: { issue: { id: '100101' } } });
      assert.deepEqual(sc.data, { known: false, setup: false }, 'the Planungs-Check panel says "not set up"');
    }
    // admin-only pieces of the setup: answered for the admin, refused (not failed) for everyone else
    const cfgGet = await call('config.get', {}, { as: ADMIN });
    assert.equal(cfgGet.data.config.setupComplete, false);
    assert.ok(cfgGet.data.meta.issueTypes.length >= 4);
    assert.equal((await call('config.get', {}, { as: EMP })).error.code, 'NO_ACCESS');
    const det = await call('config.detect', {}, { as: ADMIN });
    assert.equal(det.data.ai.enabled, false, 'the detected proposal keeps AI off');
    assert.equal(det.data.portfolio.source, 'space', 'no "Project" issue type → spaces are the projects');
    assert.equal((await call('config.detect', {}, { as: EMP })).error.code, 'NO_ACCESS');
    assert.equal((await call('report.get', {}, { as: EMP })).error.code, 'NO_ACCESS');
    assert.equal((await call('report.get', {}, { as: ADMIN })).data, null, 'no report before setup');
    assert.equal((await call('mine.week', { from: '2026-11-09', to: '2026-11-13' }, { as: EMP })).error.code, 'INVALID');

    // scheduled jobs and the event trigger: skip cleanly with no configuration
    assert.equal(await backend.reportJob(), undefined);
    const h = await backend.hourlyJob();
    assert.deepEqual(h.snapshot, { skipped: 'setup' });
    assert.equal(h.notices, undefined, 'no reminders without setup');
    assert.equal(await backend.lockEnforcer({ eventType: 'avi:jira:created:worklog', worklog: { issueId: '100101', id: '1' } }), undefined);
    assert.equal(await backend.lockEnforcer({ eventType: 'avi:jira:updated:issue', issue: { id: '100101' }, changelog: { items: [{ field: 'timeestimate', to: '3600' }] } }), undefined);

    // nothing was assumed into storage: no configuration, no AI switch, no portfolio
    for (const k of ['config', 'portfolio', 'capacity', 'health']) assert.equal(cur.kv.has(k), false, `${k} not written`);
    assert.equal(cur.llm, 0, 'not one Forge LLM request');
    assert.deepEqual(cur.unknown, [], 'every Jira call the app made is one this site answers');
    assert.deepEqual(w.errs, [], 'nothing logged as an error');
    assert.ok(!cur.requests.some((r) => /\/issue\/\d+\/worklog\/|DELETE|PUT \/rest\/api\/3\/issue/.test(r)), 'no write to Jira before setup');
  } finally {
    w.restore();
    if (prevBudget === undefined) delete process.env.AI_BUDGET; else process.env.AI_BUDGET = prevBudget;
  }
});

// ---------- 2. the first admin sets it up: no JSM, no time tracking, no Start date / Team field, a team-managed project ----------
test('first admin completes setup on a bare site (no JSM, no time tracking, no start date, no team field, team-managed space)', async () => {
  const projects = [{ id: '10010', key: 'ALPHA', name: 'Alpha' }, { id: '10020', key: 'BETA', name: 'Beta (team-managed)', scoped: true }];
  const tmIssues = [
    { id: '200201', key: 'BETA-1', projectId: '10020', typeId: '100202', summary: 'TM epic', statusId: '3', assignee: EMP },
    { id: '200202', key: 'BETA-2', projectId: '10020', typeId: '100201', summary: 'TM task', statusId: '1', parentId: '200201', assignee: EMP, due: '2027-02-01' },
  ];
  const call = install({ projects, issues: [...softwareIssues('10010', 'ALPHA', 6), ...tmIssues], timeTracking: false, startDate: false, team: false, jsm: false });
  const w = watchErrors();
  try {
    const det = (await call('config.detect')).data;
    assert.equal(det.fields.startDate, '', 'no Start date field detected – none assumed');
    assert.equal(det.fields.team, '', 'no Team field detected – none assumed');
    assert.deepEqual(det.support.serviceProjectIds, [], 'no service space assumed');
    const saved = await call('config.save', { config: det });
    assert.equal(saved.ok, true, saved.error?.message);
    assert.equal(saved.data.setupComplete, true);
    assert.equal(saved.data.ai.enabled, false, 'saving the setup leaves AI off');
    assert.equal(saved.data.notices.enabled, false, 'reminders stay off');
    assert.equal(saved.data.rules.lockSubtasks, false, 'no sub-task lock by default');
    // service spaces: none on this site – the picker is simply empty
    assert.deepEqual((await call('meta.projects', { service: true })).data, []);
    // portfolio: both spaces
    const cand = (await call('portfolio.candidates', { query: '' })).data;
    assert.deepEqual(cand.map((c) => c.key).sort(), ['ALPHA', 'BETA']);
    for (const c of cand) assert.equal((await call('portfolio.add', { ref: c.ref })).data.added, true);

    const b = await call('bootstrap', { withDataset: true }, { as: EMP });
    assert.equal(b.data.setupComplete, true);
    const ds = b.data.dataset || (await call('dataset', {}, { as: EMP })).data;
    assert.equal(ds.portfolio.length, 2);
    assert.equal(ds.supportComputed, null, 'no support configured → no support numbers (the tab stays hidden)');
    assert.equal(ds.supportTickets, null);
    assert.ok(ds.issues.every((i) => i.oe === 0 && i.re === 0 && i.ts === 0), 'no time tracking → 0 h, never NaN');
    assert.ok(ds.issues.every((i) => i.start === null && i.team === null));
    const tm = ds.issues.filter((i) => i.projectKey === 'BETA');
    assert.deepEqual(tm.map((i) => i.role).sort(), ['estimate', 'structure'], 'team-managed types: role from the hierarchy level');
    const comp = computeAll(ds);
    assert.deepEqual(nonFinite({ metrics: comp.metrics, dq: comp.dq, kpis: comp.kpis, portfolio: comp.portfolio }), [], 'no NaN / Infinity in what the views render');
    const rep = cLevelReport(structuredClone(ds));
    assert.deepEqual(nonFinite(rep), [], 'no NaN / Infinity in the report');

    for (const as of [ADMIN, EMP, MGMT]) {
      for (const [name, payload] of [['report.get', {}], ['history.get', {}], ['planActual.get', { weeks: 4, team: 'all' }], ['mine.week', { from: '2026-11-09', to: '2026-11-13' }],
        ['insights.history', { months: 12 }], ['booking.worklogs', { from: '2026-11-09', to: '2026-11-13' }], ['capacity.get', {}], ['playbooks.list', {}]]) await call(name, payload, { as });
      for (const [name, payload] of AI_RESOLVERS) assert.equal((await call(name, payload, { as })).error.code, 'AI_DISABLED');
    }
    const rep2 = (await call('report.get')).data;
    assert.equal(rep2.rows.length, 2);
    // jobs on a configured site without JSM: run through, no reminders (off), no LLM
    const h = await backend.hourlyJob();
    assert.equal(h.notices, undefined);
    assert.ok((await backend.reportJob()).asOf);
    assert.equal(cur.llm, 0);
    assert.deepEqual(cur.unknown.filter((x) => !/^GET \/rest\/api\/3\/version\//.test(x)), [], 'every Jira call the app made is one this site answers');
    assert.deepEqual(w.errs, []);
  } finally { w.restore(); }
});

// ---------- 3. a site with 0 issues and an empty portfolio ----------
test('0 issues, empty portfolio, 0 people with capacity: honest empty payloads', async () => {
  const call = install({ projects: [{ id: '10030', key: 'EMPTY', name: 'Empty space' }], issues: [], timeTracking: true });
  const w = watchErrors();
  try {
    const det = (await call('config.detect')).data;
    await call('config.save', { config: det });
    // nothing in the portfolio yet
    let ds = (await call('dataset')).data;
    assert.deepEqual([ds.portfolio.length, ds.issues.length, Object.keys(ds.people).length], [0, 0, 0]);
    let comp = computeAll(ds);
    assert.deepEqual(nonFinite({ metrics: comp.metrics, dq: comp.dq, kpis: comp.kpis }), []);
    let rep = (await call('report.get')).data;
    assert.equal(rep.rows.length, 0);
    assert.deepEqual(nonFinite(rep), []);
    // one space without any work item
    await call('portfolio.add', { ref: 'space:10030' });
    ds = (await call('dataset')).data;
    assert.deepEqual([ds.portfolio.length, ds.issues.length], [1, 0]);
    comp = computeAll(ds);
    assert.deepEqual(nonFinite({ metrics: comp.metrics, dq: comp.dq, kpis: comp.kpis }), []);
    assert.ok((await backend.reportJob()).asOf);
    rep = (await call('report.get')).data;
    assert.equal(rep.rows.length, 1);
    assert.deepEqual(nonFinite(rep), []);
    await call('planActual.get', { weeks: 4, team: 'all' });
    await call('history.get');
    assert.ok((await backend.reportJob()).asOf);
    await backend.hourlyJob();
    assert.equal(cur.llm, 0);
    assert.deepEqual(cur.unknown, [], 'every Jira call the app made is one this site answers');
    assert.deepEqual(w.errs, []);
  } finally { w.restore(); }
});

// ---------- 4. German site: status names German, categories by key ----------
test('Atlassian Teams: members are read as the user, merged into the dataset, judged per team – and without the scopes the cockpit falls back quietly', async () => {
  const T1 = '11111111-1111-4111-8111-111111111111', T2 = '22222222-2222-4222-8222-222222222222';
  const issues = [...softwareIssues('10050', 'TEAM', 6, { team: T1 }), ...softwareIssues('10060', 'OPS', 2, { team: T2 })];
  // EMP is in T1 only; MGMT in neither (works on T1 stories → outside); a member without work items in T2
  const call = install({ projects: [{ id: '10050', key: 'TEAM', name: 'Team' }, { id: '10060', key: 'OPS', name: 'Ops' }], issues, timeTracking: true, team: true, teamMembers: { [T1]: [EMP], [T2]: ['acc-newbie'] } });
  const w = watchErrors();
  try {
    const det = (await call('config.detect')).data;
    await call('config.save', { config: det });
    await call('portfolio.add', { ref: 'space:10050' });
    await call('portfolio.add', { ref: 'space:10060' });
    cur.graph = [];
    // the admin's view: other people are pseudonyms here (privacy default) – membership must use the same pseudonyms
    const ds = (await call('dataset', {}, { as: ADMIN })).data;
    assert.equal(ds.atlTeams?.status, 'ok');
    assert.ok(cur.graph.length >= 2 && cur.graph.every((g) => g.provider === 'user' && g.op === 'superport_teamMembers'), 'read as the signed-in user, with a named operation');
    const idOf = (key) => ds.issues.find((i) => i.key === key).assignee.id;
    const emp = idOf('TEAM-3'), mgmt = idOf('TEAM-2'); // softwareIssues: odd stories EMP, even ones MGMT
    assert.deepEqual(ds.atlTeams.teams[T1].members.map((m) => m.accountId), [emp], 'same pseudonym as on the work items');
    assert.equal(ds.atlTeams.teams[T2].members.length, 1);
    { const j = JSON.stringify(ds); const at = (s) => { const k = j.indexOf(s); return k < 0 ? null : j.slice(Math.max(0, k - 160), k + 40); }; assert.equal(at('acc-newbie'), null, 'no real account id of a member (project owners stay visible by design)'); }
    const { buildModel, capacityPeople } = await import('../shared/engine.js');
    const { memberStatus, teamOutsiders } = await import('../shared/teamMembership.js');
    const model = buildModel(ds);
    assert.equal(memberStatus(model, emp, T1), 'member');
    assert.equal(memberStatus(model, mgmt, T1), 'outside');
    assert.deepEqual(teamOutsiders(model, T1), [], 'pseudonymised people are judged, but never listed by person (privacy)');
    const people = capacityPeople(model);
    assert.ok(people.get(emp)?.fromAtlassian && people.get(emp).teams.length === 1, 'counted once, in exactly its Atlassian team');
    assert.equal([...people.values()].filter((p) => (p.teams || []).some((x) => x.teamId === T2)).length, 1, 'the member without work items counts once in T2');
    // second load within 30 minutes: served from the stored snapshot, no new graph calls
    cur.graph = [];
    await call('dataset', {}, { as: ADMIN });
    assert.equal(cur.graph.length, 0, 'snapshot reused');
    // status for the configuration page; refresh only for admins / capacity maintainers
    const st = (await call('teams.atlassian', {}, { as: ADMIN })).data;
    assert.equal(st.status, 'ok');
    assert.equal(st.teams.find((t) => t.id === T2).members, 1);
    assert.ok(['NO_ACCESS', 'FORBIDDEN'].includes((await call('teams.atlassian', { refresh: true }, { as: EMP })).error?.code), 'refresh refused for employees');
    // person-level values off: members are pseudonymised exactly like the assignees (counted once, no names)
    const cfg = (await call('config.get')).data.config;
    await call('config.save', { config: { ...cfg, rules: { ...cfg.rules, personLevel: false } } });
    const anon = (await call('dataset', {}, { as: EMP })).data;
    const t1 = anon.atlTeams.teams[T1].members;
    assert.deepEqual(t1.map((m) => m.accountId), [EMP], 'the user sees themself');
    const ops = anon.atlTeams.teams[T2].members;
    assert.ok(ops.every((m) => m.accountId.startsWith('anon-') && m.name === ''), 'others become pseudonyms without names');
    assert.ok(!JSON.stringify(anon).includes('acc-newbie'));
    // the issue view's lozenge (dynamicProperties): read as the app, from the stored snapshot – no dataset, never an error
    const lozenge = (id) => backend.storyStatus({ extension: { type: 'jira:issueContext', issue: { id } } });
    assert.equal((await lozenge('100501')).status?.value?.type, 'removed', 'TEAM-2 (MGMT, not a member) gets the lozenge');
    assert.deepEqual(await lozenge('100502'), {}, 'TEAM-3 (EMP, member): nothing');
    assert.deepEqual(await lozenge('999999'), {}, 'unknown work item: nothing, no error');
    assert.deepEqual(await lozenge('../x'), {});
    assert.deepEqual(cur.unknown, [], 'every Jira call the app made is one this site answers');
    assert.deepEqual(w.errs, []);
  } finally { w.restore(); }
  // scopes not granted: the graph answers with no rows – status "empty", the cockpit keeps its own maintenance
  const call2 = install({ projects: [{ id: '10050', key: 'TEAM', name: 'Team' }], issues: softwareIssues('10050', 'TEAM', 3, { team: T1 }), timeTracking: true, team: true });
  const det2 = (await call2('config.detect')).data;
  await call2('config.save', { config: det2 });
  await call2('portfolio.add', { ref: 'space:10050' });
  const ds2 = (await call2('dataset', {}, { as: ADMIN })).data;
  assert.equal(ds2.atlTeams?.status, 'empty');
  const { buildModel } = await import('../shared/engine.js');
  const { memberStatus } = await import('../shared/teamMembership.js');
  assert.equal(memberStatus(buildModel(ds2), EMP, T1), 'unmaintained', 'falls back to the capacity rule');
});

test('German site: progress and "done" come from the status category key, never the (German) status name', async () => {
  const call = install({ lang: 'de', projects: [{ id: '10040', key: 'GAMMA', name: 'Gamma' }], issues: softwareIssues('10040', 'GAMMA', 8), timeTracking: true, startDate: true, team: true });
  const w = watchErrors();
  try {
    const det = (await call('config.detect')).data;
    assert.equal(det.fields.startDate, 'customfield_10015', '"Startdatum" is found as the start date');
    assert.equal(det.fields.team, 'customfield_10001', 'the Atlassian Team field is found by its type');
    assert.ok(det.levels.some((l) => /Aufgabe/.test(l.name)), 'level names are the site\'s own type names');
    await call('config.save', { config: det });
    await call('portfolio.add', { ref: 'space:10040' });
    const ds = (await call('dataset', {}, { as: EMP })).data;
    const byName = (n) => ds.issues.filter((i) => i.status.name === n).map((i) => i.status.cat);
    assert.ok(byName('Fertig').length && byName('Fertig').every((c) => c === 'done'));
    assert.ok(byName('In Arbeit').every((c) => c === 'indeterminate'));
    assert.ok(byName('Zu erledigen').every((c) => c === 'new'));
    assert.ok(byName('Blockiert').every((c) => c === 'indeterminate'), 'Blockiert is in progress by category (blocked by name or the configured status ids)');
    const comp = computeAll(ds);
    assert.deepEqual(nonFinite({ metrics: comp.metrics, dq: comp.dq, kpis: comp.kpis }), []);
    const b = await call('bootstrap', {}, { as: EMP });
    assert.equal(b.data.me.locale, 'de_DE');
    assert.equal(cur.llm, 0);
    assert.deepEqual(cur.unknown, [], 'every Jira call the app made is one this site answers');
    assert.deepEqual(w.errs, []);
  } finally { w.restore(); }
});

// ---------- 5. a caller who may not browse one project ----------
test('limited browse rights: the hidden project is in no payload of that caller (dataset, report, history)', async () => {
  const projects = [{ id: '10050', key: 'OPEN', name: 'Open project' }, { id: '10060', key: 'SECRET', name: 'Secret merger' }];
  const call = install({ projects, issues: [...softwareIssues('10050', 'OPEN', 3), ...softwareIssues('10060', 'SECRET', 3)], timeTracking: true, hidden: { [MGMT]: ['10060'], [EMP]: ['10060'] } });
  const w = watchErrors();
  try {
    const det = (await call('config.detect')).data;
    // management (group grp-mgmt) may see the C-level report
    const roles = { ...det.roles, groups: { ...det.roles.groups, management: [{ id: 'grp-mgmt', name: 'Management' }] } };
    assert.equal((await call('config.save', { config: { ...det, roles } })).ok, true);
    for (const ref of ['space:10050', 'space:10060']) await call('portfolio.add', { ref });
    assert.ok((await backend.reportJob()).asOf, 'the daily report is computed as the app over both');
    for (const as of [MGMT, EMP]) {
      const ds = (await call('dataset', {}, { as })).data;
      assert.deepEqual(ds.portfolio.map((p) => p.key), ['OPEN']);
      assert.ok(!JSON.stringify(ds).includes('Secret merger') && !JSON.stringify(ds).includes('SECRET-'));
    }
    const rep = await call('report.get', {}, { as: MGMT });
    assert.equal(rep.ok, true);
    assert.deepEqual(rep.data.rows.map((r) => r.key ?? r.name), [rep.data.rows[0].key ?? 'Open project']);
    assert.ok(!JSON.stringify(rep.data).includes('Secret merger') && !JSON.stringify(rep.data).includes('SECRET'), 'no trace of the hidden project in the report');
    assert.equal((await call('report.get', {}, { as: EMP })).error.code, 'NO_ACCESS', 'employees do not get the C-level report');
    const hist = (await call('history.get', {}, { as: MGMT })).data;
    assert.ok(!JSON.stringify(hist).includes('space:10060'));
    // an employee without "Log work" / admin rights: their own page still loads
    assert.equal((await call('mine.week', { from: '2026-11-09', to: '2026-11-13' }, { as: EMP })).ok, true);
    assert.equal(cur.llm, 0);
    assert.deepEqual(cur.unknown, [], 'every Jira call the app made is one this site answers');
    assert.deepEqual(w.errs, []);
  } finally { w.restore(); }
});

// ---------- 6. odd site settings: issue linking off, a field deleted after setup, rate limiting, an old stored config ----------
test('issue linking switched off: detection and the configuration page still work', async () => {
  const call = install({ projects: [{ id: '10010', key: 'ALPHA', name: 'Alpha' }], issues: softwareIssues('10010', 'ALPHA', 2), timeTracking: true, linking: false });
  const w = watchErrors();
  try {
    const det = await call('config.detect');
    assert.equal(det.ok, true, det.error?.message);
    assert.deepEqual(det.data.dependencies.linkTypeIds, []);
    const g = await call('config.get');
    assert.equal(g.ok, true, g.error?.message);
    assert.deepEqual(g.data.meta.linkTypes, []);
    assert.deepEqual(w.errs, []);
  } finally { w.restore(); }
});

test('a custom field deleted after setup: the dataset still loads, the admin is told which mapping is stale', async () => {
  const call = install({ projects: [{ id: '10010', key: 'ALPHA', name: 'Alpha' }], issues: softwareIssues('10010', 'ALPHA', 3), timeTracking: true, startDate: true, team: true });
  const w = watchErrors();
  try {
    const det = (await call('config.detect')).data;
    await call('config.save', { config: { ...det, fields: { ...det.fields, note: 'customfield_19999' } } });
    await call('portfolio.add', { ref: 'space:10010' });
    // the Team field is deleted in Jira later
    cur.site = makeSite({ users: USERS, projects: [{ id: '10010', key: 'ALPHA', name: 'Alpha' }], issues: softwareIssues('10010', 'ALPHA', 3), timeTracking: true, startDate: true, team: false });
    const ds = await call('dataset', {}, { as: EMP });
    assert.equal(ds.ok, true);
    assert.ok(ds.data.issues.every((i) => i.team === null));
    const g = (await call('config.get')).data;
    assert.deepEqual(g.meta.staleFields.map((f) => [f.usage, f.id]).sort(), [['note', 'customfield_19999'], ['team', 'customfield_10001']]);
    assert.deepEqual(w.errs, []);
  } finally { w.restore(); }
});

test('rate limited by Jira (429): retried with backoff, the dataset still loads', async () => {
  const call = install({ projects: [{ id: '10010', key: 'ALPHA', name: 'Alpha' }], issues: softwareIssues('10010', 'ALPHA', 3), timeTracking: true });
  const det = (await call('config.detect')).data;
  await call('config.save', { config: det });
  await call('portfolio.add', { ref: 'space:10010' });
  cur.site = makeSite({ users: USERS, projects: [{ id: '10010', key: 'ALPHA', name: 'Alpha' }], issues: softwareIssues('10010', 'ALPHA', 3), timeTracking: true, rateLimit: 2 });
  const ds = await call('dataset');
  assert.equal(ds.ok, true);
  assert.equal(ds.data.issues.length, 4);
});

test('a large space: cursor paging over 100-item pages reads every work item', async () => {
  const call = install({ projects: [{ id: '10070', key: 'BIG', name: 'Big' }], issues: softwareIssues('10070', 'BIG', 260), timeTracking: true });
  const det = (await call('config.detect')).data;
  await call('config.save', { config: det });
  await call('portfolio.add', { ref: 'space:10070' });
  const ds = (await call('dataset')).data;
  assert.equal(ds.issues.length, 261);
  assert.equal(ds.truncated, false);
  assert.ok(cur.requests.filter((r) => r === 'user POST /rest/api/3/search/jql').length >= 3, 'three pages');
});

test('stored configuration from an older version is migrated on read; AI stays off', async () => {
  const kv = new Map([['config', JSON.stringify({ version: 1, setupComplete: true, portfolio: { source: 'space', issueTypeIds: [] }, levels: [{ key: 'story', name: 'Story', role: 'estimate', issueTypeIds: ['10001'] }], fields: { team: '', startDate: '', tshirt: 'app', targetQuarters: 'app', note: '' }, permissions: { viewReport: [{ id: 'grp-mgmt', name: 'Management' }] } })]]);
  const call = install({ projects: [{ id: '10010', key: 'ALPHA', name: 'Alpha' }], issues: softwareIssues('10010', 'ALPHA', 2), timeTracking: true }, kv);
  const b = await call('bootstrap', {}, { as: MGMT });
  assert.equal(b.data.setupComplete, true);
  assert.equal(b.data.config.ai.enabled, false);
  assert.equal(b.data.roles.viewReport, true, 'the old per-action group list became a role – nobody loses access');
  assert.equal((await call('dataset', {}, { as: MGMT })).ok, true);
});

test('very large portfolios: past the time budget no further page is read – a partial dataset marked truncated, not a time-out', async () => {
  const call = install({ projects: [{ id: '10080', key: 'HUGE', name: 'Huge' }], issues: softwareIssues('10080', 'HUGE', 260), timeTracking: true });
  const det = (await call('config.detect')).data;
  await call('config.save', { config: det });
  await call('portfolio.add', { ref: 'space:10080' });
  const { buildDataset } = await import('../src/lib/dataset.js');
  const { loadConfig } = await import('../src/lib/config.js');
  cur.user = ADMIN;
  const ds = await buildDataset({ as: 'user', cfg: await loadConfig(), roles: { logs: 'all' }, accountId: ADMIN, until: Date.now() - 1 });
  assert.equal(ds.truncated, true);
  assert.equal(ds.issues.length, 100, 'the first page only');
  assert.equal(backend.DATASET_BUDGET_MS < 25000 - 5000, true, 'the resolver keeps a margin to Forge\'s 25 s limit');
  const src = (await import('node:fs')).readFileSync(new URL('../static/cockpit/src/views/Portfolio.jsx', import.meta.url), 'utf8');
  assert.match(src, /ds\.truncated && <div className="callout warn" data-truncated>/, 'the Portfolio says so');
});

test('undo of "copy values to a Jira field" accepts work item ids (regex typo fixed: /^\d{1,18}$/, split on /\s*,\s*/)', async () => {
  const call = install({ projects: [{ id: '10010', key: 'ALPHA', name: 'Alpha' }], issues: softwareIssues('10010', 'ALPHA', 2), timeTracking: true });
  const r = await call('fields.uncopyValues', { usage: 'targetQuarters', to: 'customfield_10777', issueIds: ['100101', '100102'] });
  assert.equal(r.ok, true, r.error?.message);
  assert.equal(r.data.kept + r.data.cleared + r.data.failed.length, 2);
  assert.equal((await call('fields.uncopyValues', { usage: 'targetQuarters', to: 'customfield_10777', issueIds: ['dd'] })).error.code, 'INVALID');
});

test('scale 2026-11-23: an issue-based portfolio loads the same work items through Jira Plans (one search per project) as through the level walk; without Plans it walks', async () => {
  const { buildDataset, _plansSearch } = await import('../src/lib/dataset.js');
  const { loadConfig } = await import('../src/lib/config.js');
  const seen = {};
  for (const plans of [false, true, 'empty']) {
    _plansSearch.reset();
    const issues = [...softwareIssues('10010', 'ALPHA', 5), ...softwareIssues('10020', 'BETA', 3)];
    // a sub-task, and a story below the second epic's story (three levels under a project)
    issues.push({ id: '1001099', key: 'ALPHA-99', projectId: '10010', typeId: '10003', summary: 'Sub', parentId: '100101', statusId: '1', assignee: EMP, oe: 2, re: 2, ts: 0 });
    const call = install({ projects: [{ id: '10010', key: 'ALPHA', name: 'Alpha' }, { id: '10020', key: 'BETA', name: 'Beta' }], issues, timeTracking: true, plans });
    const det = (await call('config.detect')).data;
    const saved = await call('config.save', { config: { ...det, portfolio: { ...det.portfolio, source: 'issue', issueTypeIds: ['10000'], group: { ...det.portfolio.group, active: false } }, levels: (det.levels || []).filter((l) => !(l.issueTypeIds || []).includes('10000')) } });
    assert.equal(saved.ok, true, saved.error?.message);
    assert.equal((await call('portfolio.add', { ref: 'issue:100100' })).ok, true);
    assert.equal((await call('portfolio.add', { ref: 'issue:100200' })).ok, true);
    cur.user = ADMIN; cur.requests = [];
    const ds = await buildDataset({ as: 'user', cfg: await loadConfig(), roles: { logs: 'all' }, accountId: ADMIN });
    seen[plans] = ds.issues.map((i) => `${i.key}>${i.rootRef}`).sort();
    // 'empty': Plans answers but without the projects' work items (projects not in the Plans hierarchy) – the guard walks
    assert.equal(ds.timing.plans, plans === 'empty' ? 'guard: 8 direct children missing' : plans ? 'on' : 'off: 400', 'which way it loaded');
    assert.equal(_plansSearch.get(), plans !== false, 'a site without Plans is remembered');
    assert.ok(seen[plans].includes('ALPHA-99>issue:100100'), 'the sub-task, under its project');
  }
  assert.deepEqual(seen[true], seen[false], 'the same work items, each under the same project');
  assert.deepEqual(seen.empty, seen[false], 'the guard: nothing is lost');
  assert.equal(seen[true].length, 5 + 3 + 1);
});

test('live 2026-11-24: Jira refuses the rank field → the order stays as it was (no half-done change); a field cache of another environment is renewed', async () => {
  const kv = new Map();
  const setup = async (spec) => {
    const issues = [...softwareIssues('10010', 'ALPHA', 2), ...softwareIssues('10020', 'BETA', 2)];
    const call = install({ projects: [{ id: '10010', key: 'ALPHA', name: 'Alpha' }, { id: '10020', key: 'BETA', name: 'Beta' }], issues, timeTracking: true, ...spec }, kv);
    const det = (await call('config.detect')).data;
    await call('config.save', { config: { ...det, portfolio: { ...det.portfolio, source: 'issue', issueTypeIds: ['10000'], group: { ...det.portfolio.group, active: false } }, levels: (det.levels || []).filter((l) => !(l.issueTypeIds || []).includes('10000')) } });
    return call;
  };
  let call = await setup({});
  assert.equal((await call('portfolio.add', { ref: 'issue:100100' })).ok, true);
  assert.equal((await call('portfolio.add', { ref: 'issue:100200' })).ok, true);
  const order = () => JSON.parse(kv.get('portfolio')).items.map((x) => x.ref);
  assert.deepEqual(order(), ['issue:100100', 'issue:100200']);
  // 1. Jira refuses the field write: the user hears it, and nothing changed
  call = await setup({ refuseField: true });
  const r = await call('portfolio.reorder', { order: ['issue:100200', 'issue:100100'] });
  assert.equal(r.ok, false); assert.equal(r.error.code, 'FORBIDDEN');
  assert.deepEqual(order(), ['issue:100100', 'issue:100200'], 'the stored order is unchanged');
  const add = await call('portfolio.remove', { ref: 'issue:100100' }); // the other one would move up → a rank write
  assert.equal(add.ok, false);
  assert.deepEqual(order(), ['issue:100100', 'issue:100200'], 'remove refused → the project stays');
  // 2. a cached field list from another environment (an older version cached production's ids on dev): renewed, then it works
  call = await setup({});
  kv.set('meta:app-fields', JSON.stringify({ rank: 'customfield_99999', tshirt: 'customfield_99998', targetQuarters: null, sla: [], requestType: null }));
  cur.requests = [];
  const ok = await call('portfolio.reorder', { order: ['issue:100200', 'issue:100100'] });
  assert.equal(ok.ok, true, ok.error?.message);
  assert.deepEqual(order(), ['issue:100200', 'issue:100100']);
  assert.ok(cur.requests.includes('app PUT /rest/api/3/app/field/customfield_10500/value'), 'written to this environment\'s own field');
  assert.equal(JSON.parse(kv.get('meta:app-fields')).rank, 'customfield_10500', 'the cache is renewed');
});

test('live 2026-11-24: with the app installed in two environments on one site, each uses its OWN fields (the environment id comes from environmentAri)', async () => {
  const kv = new Map();
  const issues = [...softwareIssues('10010', 'ALPHA', 2), ...softwareIssues('10020', 'BETA', 2)];
  const call = install({ projects: [{ id: '10010', key: 'ALPHA', name: 'Alpha' }, { id: '10020', key: 'BETA', name: 'Beta' }], issues, timeTracking: true, otherEnvFirst: true }, kv);
  const det = (await call('config.detect')).data;
  await call('config.save', { config: { ...det, portfolio: { ...det.portfolio, source: 'issue', issueTypeIds: ['10000'], group: { ...det.portfolio.group, active: false } }, levels: (det.levels || []).filter((l) => !(l.issueTypeIds || []).includes('10000')) } });
  assert.equal((await call('portfolio.add', { ref: 'issue:100100' })).ok, true);
  assert.equal((await call('portfolio.add', { ref: 'issue:100200' })).ok, true);
  cur.requests = [];
  const r = await call('portfolio.reorder', { order: ['issue:100200', 'issue:100100'] });
  assert.equal(r.ok, true, r.error?.message);
  assert.ok(cur.requests.includes('app PUT /rest/api/3/app/field/customfield_10500/value'), 'its own rank field, not the other environment\'s (customfield_10400)');
  const fids = JSON.parse(kv.get('meta:app-fields'));
  assert.deepEqual([fids.rank, fids.tshirt, fids.targetQuarters], ['customfield_10500', 'customfield_10501', 'customfield_10502']);
});
