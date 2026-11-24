// Local design/dev backend: a deterministic, realistic portfolio (Project > Workstream > Epic > Story > Sub-task).
import { cLevelReport, DEFAULT_MATRIX, DEFAULT_TSHIRTS } from '@shared/engine.js';
import { isoOf, todayIdx, quarterKeyOf, shiftQuarter } from '@shared/dates.js';
import { mockPlanActual } from './mockPlanActual.js';
import { mockPlanApply, mockPlanEven } from './mockPlan.js';
import { evidenceOf } from '@shared/mineSuggest.js';
const planEven = {}; // plan:even – per-task overrides of the capacity distribution
import { dispatchMocks, enrichMockTickets, MOCK_SUPPORT_DISPATCH } from './mockDispatch.js';
import { LOCATIONS } from '@shared/holidays.js';
import { mockAssist } from './mockAi.js';
import { lotseReading } from '@shared/lotse/llm.js';
import { lotsePlanAssist, lotseWriteAssist } from '@shared/lotse/act/chain/llm.js';
import { mockChainPlanModel, mockChainWriteModel } from './mockChain.js';
import { mockHistory, mockComments } from './mockHistory.js';
import { validPlaybook, newPlaybookId, canReadPlaybooks, canEditPlaybooks } from '@shared/playbooks.js';
import { spendView } from '@shared/aiBudget.js';
import { mockUsageTrack, mockUsageSummary, mockLearned, mockLearnReview, mockLearnFromAi, mockLearnChain } from './mockUsage.js';
import { mockReportDraft, mockReportDraftSave, mockPublishComposed, mockUnpublishComposed, mockRemind } from './mockReport.js';
let playbooks = []; // Support › Playbooks (as the backend: app storage, never posted to tickets)

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const today = todayIdx();
const curQ = quarterKeyOf(today);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TEAMS = [['t-web', 'Web'], ['t-ux', 'UX'], ['t-int', 'Integration'], ['t-mob', 'Mobile'], ['t-data', 'Data'], ['t-netz', 'Netz']].map(([id, name]) => ({ id, name }));
const PEOPLE = ['Anna Becker', 'Jonas Weber', 'Lea Hoffmann', 'Maximilian Schulz', 'Sophie Wagner', 'Paul Richter', 'Mia Klein', 'Felix Wolf', 'Emma Schröder', 'Noah Neumann', 'Hannah Schwarz', 'Elias Zimmermann', 'Lina Braun', 'Ben Krüger', 'Clara Hartmann', 'Luis Lange']
  .map((name, i) => ({ id: `u${i + 1}`, name, avatar: null }));
const teamOfPerson = (p) => TEAMS[Number(p.id.slice(1)) % TEAMS.length];
const PROJECTS = ['Kundenportal Relaunch', 'ERP-Anbindung', 'DSGVO-Löschkonzept', 'Mobile App 2.0', 'Datenplattform', 'Glasfaser-Netzausbau', 'Billing-Migration', 'CRM-Konsolidierung'];
const KEYS = ['KPR', 'ERP', 'DSG', 'MOB', 'DAT', 'NET', 'BIL', 'CRM'];
const LEVELS = [
  { key: 'workstream', name: 'Workstream', role: 'rough', issueTypeIds: ['10102'] },
  { key: 'epic', name: 'Epic', role: 'structure', issueTypeIds: ['10000'] },
  { key: 'story', name: 'Story', role: 'estimate', issueTypeIds: ['10001'] },
  { key: 'subtask', name: 'Sub-task', role: 'tiny', issueTypeIds: ['10003'] },
];
const TYPES = { project: ['10101', 'Project'], workstream: ['10102', 'Workstream'], epic: ['10000', 'Epic'], story: ['10001', 'Story'], subtask: ['10003', 'Sub-task'] };

let config = {
  version: 1, setupComplete: true,
  portfolio: { source: 'issue', issueTypeIds: ['10101'], autoRemoveDone: false, group: { active: true, name: 'Themen', issueTypeIds: ['10103'] } },
  levelsOff: [],
  levels: LEVELS,
  fields: { team: 'customfield_10001', startDate: 'customfield_10015', tshirt: 'app', targetQuarters: 'app', note: 'customfield_10204' },
  matrix: { portfolio: { owner: 'required', dueDate: 'optional' }, workstream: { ...DEFAULT_MATRIX.rough }, epic: { ...DEFAULT_MATRIX.structure }, story: { ...DEFAULT_MATRIX.estimate }, subtask: { ...DEFAULT_MATRIX.tiny } },
  dependencies: { linkTypeIds: ['10000'] },
  tshirtSizes: DEFAULT_TSHIRTS,
  rules: { dueDateWarning: true, distribution: 'linear', personLevel: true, lockSubtasks: true, healthRhythmDays: 7, forecastThresholdPct: 10, deviationThresholdPct: 15 },
  permissions: { viewReport: [{ id: 'g-mgmt', name: 'tel-management' }], manageRanking: [{ id: 'g-mgmt', name: 'tel-management' }], editCapacity: [{ id: 'g-mgmt', name: 'tel-management' }, { id: 'g-pa', name: 'tel-projektadmins' }], editHealth: [{ id: 'g-pa', name: 'tel-projektadmins' }] },
  support: { serviceProjectIds: ['20001'], queues: [{ id: 'q1', name: 'Plattform-Störungen', projectIds: ['10010'], issueTypeIds: ['10005'], labels: ['support'] }], averagingWeeks: 4, slaTargetPct: 95, escalationLinkTypeId: '', sla: { mode: 'business', start: 8, end: 17, location: 'DE', atRiskShare: 0.75, fallbackHours: 72, policies: [{ priority: 'Highest', hours: 8 }, { priority: 'High', hours: 24 }, { priority: 'Medium', hours: 72 }, { priority: 'Low', hours: 120 }, { priority: 'Lowest', hours: 200 }] } },
  capacityDefaults: { defaultWeeklyHours: 40, defaultLocation: 'DE-NW' },
  // UC-09 demo: two named locations (own holiday calendar, working days, company days off)
  locations: [
    { id: 'koeln', name: 'Köln', calendar: 'DE-NW', workdays: [1, 2, 3, 4, 5], off: [], own: [{ d: '2026-12-28', name: 'Betriebsruhe' }, { d: '2026-12-29', name: 'Betriebsruhe' }, { d: '2026-12-30', name: 'Betriebsruhe' }] },
    { id: 'wien', name: 'Wien', calendar: 'AT', workdays: [1, 2, 3, 4], off: ['2026-12-08'], own: [{ d: '2027-05-07', name: 'Brückentag' }] },
  ],
  ai: { enabled: false, features: { ask: true, healthDraft: true, reportSummary: true }, shareNames: false, shareTexts: false, changedAt: null, changedBy: null },
};
// ?ai=on: AI switched on with every feature (default: off, as in a new install) – to see the KI-Assistent locally.
if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('ai') === 'on') config.ai = { ...config.ai, enabled: true, features: Object.fromEntries(['ask', 'healthDraft', 'reportSummary', 'planning', 'gaps', 'dispatch', 'planActual', 'teamBrief', 'projectBrief', 'myWeek', 'intent', 'similarSummary', 'playbookDraft', 'lotse'].map((k) => [k, true])) };
// AI budget as the server computes it (shared/aiBudget.js budgetState). ?budget=80 / ?budget=stopped show the other states;
// ?budget=vendor / ?budget=capzero: SUPERPORT switched AI off (every site / a cap of 0 here); ?budget=sitecaps: own caps.
// ?aime=off: this person has not switched AI on for themselves (the default on a real site).
if (typeof location !== 'undefined' && config.ai?.enabled) {
  config.ai.user = new URLSearchParams(location.search).get('aime') !== 'off';
  config.ai.access = new URLSearchParams(location.search).get('access') === 'all' ? 'all' : 'self'; // ?access=all: on for everyone
  const q = new URLSearchParams(location.search).get('budget');
  const used = q === 'stopped' ? 49.2 : q === '80' ? 41.7 : 12.4;
  const vendor = q === 'vendor' ? 'superportStop' : q === 'capzero' ? 'capZero' : null;
  const pct = Math.round((used / 50) * 1000) / 10;
  const now = new Date();
  config.ai.budget = { month: now.toISOString().slice(0, 7), resetsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10), usedEur: used, limitEur: 50, capEur: 50, pct,
    level: q === 'stopped' || vendor ? 'stopped' : pct >= 80 ? 'warn80' : pct >= 50 ? 'warn50' : 'ok', stopped: q === 'stopped' || !!vendor, reason: vendor || (q === 'stopped' ? 'used' : null),
    sharePct: pct, calls: Math.round(used * 95), callLimit: vendor === 'capZero' ? 0 : q === 'sitecaps' ? 5000 : 1000, tokens: Math.round(used * 9000), tokenLimit: q === 'sitecaps' ? 10000000 : 2000000, siteCaps: vendor === 'capZero' || q === 'sitecaps', cacheHits: Math.round(used * 31), estimated: 0, byFeature: { projectBrief: used * 0.41, ask: used * 0.27, teamBrief: used * 0.18, dispatch: used * 0.14 },
    dailyPerPerson: 60, capDaily: 60, lowered: false, siteOverride: false, set: true, eurPerUsd: 0.92, host: 'demo.atlassian.net', invalidVariable: false };
}
const aiOff = (f) => !(config.ai?.enabled === true && config.ai.features?.[f] !== false);

let n = 100;
const issues = [];
const portfolio = [];
// themes above the projects (e.g. Themes L4 over Project L3); the last project has none
const MOCK_THEMES = [
  { id: '9901', key: 'THM-1', name: 'Digitale Kundenerlebnisse', type: { id: '10103', name: 'Themes' }, status: { name: 'In Arbeit', cat: 'indeterminate' } },
  { id: '9902', key: 'THM-2', name: 'Plattform & Betrieb', type: { id: '10103', name: 'Themes' }, status: { name: 'In Arbeit', cat: 'indeterminate' } },
  { id: '9903', key: 'THM-3', name: 'Regulatorik', type: { id: '10103', name: 'Themes' }, status: { name: 'Offen', cat: 'new' } },
];
const themeOf = (i, n) => (i === n - 1 ? null : MOCK_THEMES[i % MOCK_THEMES.length].id);
const issue = (o) => { const id = String(++n); const x = { id, key: `${o.pk}-${n}`, links: [], worklogs: [], fixVersionIds: [], quarters: [], ...o }; delete x.pk; issues.push(x); return x; };
const st = (cat) => ({ name: cat === 'done' ? 'Fertig' : cat === 'indeterminate' ? 'In Arbeit' : 'Offen', cat });
PROJECTS.forEach((name, pi) => {
  const pk = KEYS[pi];
  const ref = `issue:${9000 + pi}`;
  const owner = PEOPLE[(pi * 3) % PEOPLE.length];
  const pStart = today - 60 + pi * 9;
  portfolio.push({ ref, rank: pi + 1, kind: 'issue', id: String(9000 + pi), key: `${pk}-1`, name, owner, statusCat: 'indeterminate', due: isoOf(pStart + 160 + pi * 12), projectKey: pk,
    health: pi === 2 ? null : { status: pick(['onTrack', 'onTrack', 'atRisk', 'critical']), comment: pick(['Plan hält, Migration der Altdaten läuft.', 'Abhängigkeit zu ERP verzögert den Start.', 'Team Data überlastet, Priorisierung nötig.', 'Abnahme mit dem Fachbereich steht aus.']), at: new Date(Date.now() - (pi * 2.3 + 1) * 864e5).toISOString(), byName: owner.name } });
  const wsCount = 2 + (pi % 2);
  for (let w = 0; w < wsCount; w++) {
    const lead = TEAMS[(pi + w) % TEAMS.length];
    const qs = [shiftQuarter(curQ, w === 0 ? -1 : 0), shiftQuarter(curQ, w), ...(rnd() > 0.6 ? [shiftQuarter(curQ, w + 1)] : [])];
    const ws = issue({ pk, summary: `${pick(['Fundament', 'Rollout', 'Migration', 'Integration', 'Self-Service', 'Reporting'])} ${w + 1}`, role: 'rough', levelKey: 'workstream', type: { id: TYPES.workstream[0], name: 'Workstream' }, parentId: String(9000 + pi), rootRef: ref, status: st('indeterminate'), team: rnd() > 0.1 ? lead : null, tshirt: rnd() > 0.12 ? pick(['S', 'M', 'L', 'M', 'XL']) : null, quarters: rnd() > 0.1 ? [...new Set(qs)] : [], assignee: owner });
    for (let e = 0; e < 2; e++) {
      const ep = issue({ pk, summary: pick(['Schnittstellen', 'Datenmodell', 'Benutzerführung', 'Abrechnung', 'Berechtigungen', 'Monitoring', 'Suche', 'Onboarding']), role: 'structure', levelKey: 'epic', type: { id: TYPES.epic[0], name: 'Epic' }, parentId: ws.id, rootRef: ref, status: st('indeterminate'), team: lead });
      const nStories = 3 + Math.floor(rnd() * 4);
      for (let s = 0; s < nStories; s++) {
        const person = pick(PEOPLE);
        const team = rnd() > 0.08 ? (rnd() > 0.3 ? lead : teamOfPerson(person)) : null;
        const start = today - 40 + Math.floor(rnd() * 120) + w * 30;
        const len = 7 + Math.floor(rnd() * 30);
        const done = start + len < today - 5 && rnd() > 0.3;
        const oe = rnd() > 0.1 ? Math.round(8 + rnd() * 72) : 0;
        const ts = done ? Math.round(oe * (0.8 + rnd() * 0.5)) : start < today ? Math.round(oe * rnd() * 0.7) : 0;
        const story = issue({ pk, summary: pick(['API für Vertragsdaten', 'Login mit SSO', 'Rechnungs-PDF', 'Adressvalidierung', 'Push-Benachrichtigungen', 'Lastenheft abstimmen', 'Testdaten anonymisieren', 'Migrationsskript', 'Dashboard Kennzahlen', 'Rollenmodell', 'Exportfunktion', 'Performance-Tuning']),
          role: 'estimate', levelKey: 'story', type: { id: TYPES.story[0], name: 'Story' }, parentId: ep.id, rootRef: ref,
          status: st(done ? 'done' : start < today ? 'indeterminate' : 'new'), team, assignee: rnd() > 0.06 ? person : null,
          start: rnd() > 0.07 ? isoOf(start) : null, due: rnd() > 0.05 ? isoOf(start + len) : null, oe, re: done ? 0 : Math.max(0, oe - ts), ts,
          note: null, fixVersionIds: rnd() > 0.4 ? [pick(['v1', 'v2', 'v3'])] : [] });
        const logs = Math.floor(ts / 6);
        for (let k = 0; k < logs; k++) story.worklogs.push({ a: story.assignee?.id || person.id, d: isoOf(start + Math.floor(rnd() * Math.max(1, Math.min(len, today - start)))), h: 6 });
        if (rnd() > 0.55) issue({ pk, summary: pick(['Review', 'Doku', 'Unit-Tests', 'Abnahme']), role: 'tiny', levelKey: 'subtask', type: { id: TYPES.subtask[0], name: 'Sub-task' }, parentId: story.id, rootRef: ref, status: st(done ? 'done' : 'new'), assignee: story.assignee });
      }
    }
  }
});
const stories = issues.filter((i) => i.role === 'estimate' && i.status.cat !== 'done');
for (let k = 0; k < 22; k++) {
  const a = pick(stories), b = pick(stories);
  if (a === b || a.rootRef === b.rootRef && rnd() > 0.3) continue;
  const id = `l${k}`;
  a.links.push({ id, typeId: '10000', verb: 'blocks', inverse: 'is blocked by', outward: true, otherId: b.id });
  b.links.push({ id, typeId: '10000', verb: 'blocks', inverse: 'is blocked by', outward: false, otherId: a.id });
  if (rnd() > 0.5) b.note = pick(['Schnittstelle muss zuerst stehen.', 'Datenmodell wird geteilt.', 'Freigabe durch Security nötig.']);
}
// three stories in the company's Blocked status: since a few days, the latest comment as the reason
stories.filter((x) => x.status.cat !== 'done').slice(3, 6).forEach((x, k) => {
  x.status = { id: 'blk', name: 'Blocked', cat: 'new' };
  x.blockedSince = isoOf(today - [3, 9, 15][k]);
  x.blockedReason = ['Wartet auf Freigabe der Security.', 'Testumgebung nicht verfügbar.', 'Fachbereich klärt die Anforderungen.'][k];
});
// A team nobody with weekly hours belongs to yet, with planned work: Teams, Capacity, waterline and the report show "–" and
// "Arbeit geplant, aber keine Kapazität" instead of a utilisation (tester finding: team Netz with 0 people showed "∞").
const PLAT = { id: 't-plat', name: 'Plattform' };
{
  const ep = issues.find((x) => x.rootRef === 'issue:9007' && x.role === 'structure');
  [['Netzwerk-Monitoring', 56], ['Firewall-Regeln migrieren', 32]].forEach(([summary, oe], k) => issue({ pk: 'CRM', summary, role: 'estimate', levelKey: 'story', type: { id: TYPES.story[0], name: 'Story' }, parentId: ep.id, rootRef: 'issue:9007',
    status: st('new'), team: PLAT, assignee: null, start: isoOf(today + 7 + k * 14), due: isoOf(today + 35 + k * 21), oe, re: oe, ts: 0, note: null }));
}
// Work items without a parent (boss 2026-11-19): two in the first project's space – the only project there, so they
// belong to it (one overdue) – and one in a space with two projects: project unclear, listed under both, counted nowhere.
{
  const story = { role: 'estimate', levelKey: 'story', type: { id: TYPES.story[0], name: 'Story' }, parentId: null, orphan: true, note: null };
  issue({ pk: KEYS[0], summary: 'Datenexport für den Fachbereich', ...story, rootRef: 'issue:9000', status: st('new'), team: TEAMS[0], assignee: PEOPLE[1], start: isoOf(today - 24), due: isoOf(today - 20), oe: 24, re: 24, ts: 0 });
  issue({ pk: KEYS[0], summary: 'Hotfix Login-Timeout', ...story, rootRef: 'issue:9000', status: st('indeterminate'), team: TEAMS[0], assignee: PEOPLE[2], start: isoOf(today + 3), due: isoOf(today + 9), oe: 8, re: 6, ts: 2 });
}
const mockOrphans = [['8801', 'Barrierefreiheit prüfen', 16], ['8802', 'Logging vereinheitlichen', 8], ['8803', 'Fehlerseite 404', 4]].map(([id, summary, oe], k) => ({
  id, key: `${KEYS[1]}-${801 + k}`, summary, role: 'estimate', levelKey: 'story', type: { id: TYPES.story[0], name: 'Story' }, status: st('new'),
  assignee: PEOPLE[3 + k], team: null, start: null, due: isoOf(today + 20 + k * 7), oe, re: oe, ts: 0, projectKey: KEYS[1], projectId: '20001', candidates: ['issue:9001', 'issue:9002'], spaceProjects: 3 }));
let capacity = {
  people: Object.fromEntries(PEOPLE.map((p, i) => [p.id, { weeklyHours: i % 5 === 0 ? 32 : 40, location: pick(['DE-NW', 'DE-BY', 'DE-BE', 'AT']), teamId: teamOfPerson(p).id }])),
  teams: Object.fromEntries(TEAMS.map((t, i) => [t.id, { name: t.name, dailyBusinessPct: 15 + (i % 3) * 5, internalPct: 10, absenceRatePct: 10 }])),
  absences: [{ id: 'a1', accountId: 'u3', from: isoOf(today + 7), to: isoOf(today + 18), type: 'vacation' }, { id: 'a2', accountId: 'u8', from: isoOf(today + 2), to: isoOf(today + 4), type: 'absent' }],
};
// UC-09/UC-14 demo: people at the named locations, one person split 60/40 across two teams
capacity.people.u1 = { ...capacity.people.u1, location: 'koeln', teams: [{ teamId: capacity.people.u1.teamId, pct: 60 }, { teamId: 't-web', pct: 40 }] };
capacity.people.u2 = { ...capacity.people.u2, location: 'wien' };
capacity.teams[PLAT.id] = { name: PLAT.name, dailyBusinessPct: 15, internalPct: 10, absenceRatePct: 10 }; // maintained team, no people
const versions = { v1: { id: 'v1', name: 'Release 26.4', releaseDate: isoOf(today + 40), projectKey: 'KPR' }, v2: { id: 'v2', name: 'Release 27.1', releaseDate: isoOf(today + 120), projectKey: 'ERP' }, v3: { id: 'v3', name: 'Go-Live', releaseDate: null, projectKey: 'MOB' } };
let milestones = [{ id: 'm1', name: 'Go-Live Kundenportal', date: isoOf(today + 45), fixVersionIds: ['v1', 'v3'] }, { id: 'm2', name: 'Jahresabschluss', date: isoOf(today + 130), fixVersionIds: ['v2'] }];
const supportTeams = TEAMS.slice(0, 4).map((t, i) => ({ teamId: t.id, win: 40 + i * 22, recent: 0, trend: Array.from({ length: 8 }, (_, k) => Math.round(8 + i * 5 + rnd() * 10 + (i === 2 && k > 5 ? 14 : 0))), avg: 10 + i * 5.5, recentAvg: i === 2 ? 26 : 10 + i * 5, spike: i === 2, weekly: i === 2 ? 26 : 10 + i * 5.5 }));
// per service space: Ø per team, rising teams and the SLA health (as shared/engine.js supportMetrics)
function svc(id, key, name, met, breached, open, openRe, idx, f) {
  const teams = idx.map((i) => ({ teamId: supportTeams[i].teamId, avg: supportTeams[i].avg * f, recentAvg: supportTeams[i].recentAvg * f, spike: supportTeams[i].spike, weekly: supportTeams[i].weekly * f }));
  const slaRate = met / (met + breached);
  return { id, key, name, met, breached, open, openRe, hours: teams.reduce((a, t) => a + t.avg * 4, 0), teams, avgWeekly: teams.reduce((a, t) => a + t.avg, 0), weekly: teams.reduce((a, t) => a + t.weekly, 0), rising: teams.filter((t) => t.spike).map((t) => t.teamId), slaRate, health: slaRate >= 0.95 ? 'onTrack' : slaRate >= 0.9 ? 'atRisk' : 'critical' };
}
const supportComputed = {
  averagingWeeks: 4, services: [svc('20001', 'SUP', 'IT-Support', 184, 9, 23, 61, [0, 1, 2], 0.7), svc('20002', 'NOC', 'Netz-Betrieb', 77, 7, 9, 30, [1, 2, 3], 0.3)],
  teams: supportTeams, reserveQuarter: Object.fromEntries(supportTeams.map((t) => [t.teamId, t.weekly * 12])), personWeekly: {},
  slaRate: 261 / 277, slaTarget: 0.95, breaches: 16, health: 'atRisk', open: 32, openRe: 91, hoursWindow: 310, weeklyTotal: supportTeams.reduce((a, t) => a + t.weekly, 0),
};
// Support tickets: eight weeks of believable traffic, some linked to epics, a few breached.
const SUBJECTS = ['Login schlägt fehl', 'Rechnung doppelt verschickt', 'VPN bricht ab', 'Export hängt', 'Portal lädt langsam', 'Passwort-Reset kommt nicht an', 'Schnittstelle liefert 500', 'Druckauftrag verschwindet', 'Neue Benutzerin anlegen', 'Datenabgleich unvollständig', 'App stürzt beim Start ab', 'Zertifikat läuft ab'];
const PRIOS = ['Highest', 'High', 'High', 'Medium', 'Medium', 'Medium', 'Low', 'Lowest'];
const epics = issues.filter((i) => i.role === 'structure');
const supportTickets = { truncated: false, tickets: Array.from({ length: 74 }, (_, k) => {
  const done = k >= 24;
  // open tickets are mostly fresh (a few old ones breach); resolved ones spread over eight weeks
  const ageH = done ? Math.round(rnd() * 54 * 24) + 30 : k < 4 ? 24 * (6 + k * 3) : Math.round(rnd() * 70) + 1;
  const created = new Date(Date.now() - ageH * 3600e3);
  const resolved = done ? new Date(created.getTime() + (rnd() > 0.92 ? 140 + rnd() * 80 : 2 + rnd() * 50) * 3600e3) : null;
  const svc = k % 4 === 0 ? 'q:q1' : '20001';
  return {
    id: String(30000 + k), key: `${svc === 'q:q1' ? 'PLT' : 'SUP'}-${400 + k}`, summary: pick(SUBJECTS), priority: k < 3 ? 'Highest' : pick(PRIOS), created: created.toISOString(), resolved: resolved?.toISOString() || null,
    statusCat: done ? 'done' : rnd() > 0.5 ? 'indeterminate' : 'new', status: done ? 'Erledigt' : pick(['Offen', 'In Arbeit', 'Wartet auf Kunde']), typeId: '10005', type: 'Bug', labels: ['support'],
    projectId: svc === 'q:q1' ? '10010' : '20001', projectKey: svc === 'q:q1' ? 'PLT' : 'SUP', assignee: rnd() > 0.15 ? pick(PEOPLE) : null, team: pick(TEAMS.slice(0, 4)), spentH: Math.round(rnd() * 6 * 2) / 2, jsm: null,
    links: rnd() > 0.45 ? [pick(epics).id] : [], services: [svc],
  };
}) };
enrichMockTickets(supportTickets.tickets, TEAMS);
config.support = { ...config.support, ...MOCK_SUPPORT_DISPATCH };
// First-install shapes (an unknown customer site):
//   ?mock&fresh=1  nothing set up yet – the setup screen (&role=employee: "ask your Jira admin"; &module=pc-admin: the wizard)
//   ?mock&bare=1   no Jira Service Management / support queues, time tracking off (no estimates, no logged hours), no Start date field
//   ?mock&empty=1  set up, but 0 projects, 0 work items, nobody with capacity
const SHAPE = typeof location === 'undefined' ? {} : Object.fromEntries(['fresh', 'bare', 'empty'].map((k) => [k, new URLSearchParams(location.search).get(k) === '1']));
if (SHAPE.fresh) config.setupComplete = false;
if (SHAPE.bare || SHAPE.empty) config.support = { ...config.support, serviceProjectIds: [], queues: [] };
if (SHAPE.bare) {
  config.fields = { ...config.fields, startDate: '' };
  for (const i of issues) Object.assign(i, { oe: 0, re: 0, ts: 0, worklogs: [], start: null });
}
if (SHAPE.empty) {
  portfolio.length = 0; issues.length = 0; milestones = [];
  capacity = { people: {}, teams: {}, absences: [] };
}
let health =Object.fromEntries(portfolio.filter((p) => p.health).map((p) => [p.ref, p.health]));
let prefs = {};
const auditLog = [{ at: new Date(Date.now() - 3600e3).toISOString(), byName: 'Anna Becker', action: 'rank.change', details: { ref: 'issue:9003', from: 5, to: 4 } }];
const people = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));
// ?role=settings simulates a project admin in the "Portfolio settings" group (no Jira admin rights).
const asSettings = typeof location !== 'undefined' && new URLSearchParams(location.search).get('role') === 'settings';
// ?role=employee simulates a normal user ("Mitarbeiter"): in no configured group, owns no project.
const asEmployee = typeof location !== 'undefined' && new URLSearchParams(location.search).get('role') === 'employee';
const roles = asEmployee ? { admin: false, viewReport: false, manageRanking: false, editCapacity: false, editHealth: false, manageSettings: false } : asSettings ? { admin: false, viewReport: true, manageRanking: false, editCapacity: false, editHealth: false, manageSettings: true } : { admin: true, viewReport: true, manageRanking: true, editCapacity: true, editHealth: true, manageSettings: true };
const q = new URLSearchParams(location.search);
// ?notices=on: a Jira admin switched reminders on (Lotse's notice.remind can send them)
if (q.get('notices') === 'on') config.notices = { enabled: true, gaps: 'monday', booking: true };
if (q.get('role') === 'employee') Object.keys(roles).forEach((k) => { roles[k] = false; });
// role matrix (shared/roles.js): admin = every tab and action; ?role=employee = only "Meine Arbeit"
roles.rights = roles.admin ? ['mine', 'portfolio', 'projects', 'teams', 'plan', 'hours', 'support', 'report', 'a_rank', 'a_cap', 'a_plan', 'a_disp', 'a_health', 'a_logs_all']
  : roles.viewReport ? ['mine', 'portfolio', 'projects', 'teams', 'plan', 'hours', 'support', 'report'] : ['mine'];
roles.logs = roles.rights.includes('a_logs_all') ? 'all' : 'none';
// ?role=viewer: everything as admin, but without the right to change the weekly plan (read-only boards and optimizer)
if (q.get('role') === 'viewer') roles.rights = roles.rights.filter((r) => r !== 'a_plan');
roles.editPlan = roles.rights.includes('a_plan'); roles.dispatch = roles.rights.includes('a_disp');
roles.roleNames = roles.admin ? ['jiraAdmin', 'management'] : [];

// ?mock&big=S|M|L: a customer-sized dataset (tools/bigMock.js, tests/perf/BASELINE.md) – imported only with this parameter
let bigDs = null;
const bigReady = q.get('big') ? import('../../../../tools/bigMock.js').then((m) => { bigDs = m.bigMockDataset(q.get('big'), isoOf(today)); }) : null;
function dataset() {
  if (bigDs) return structuredClone({ ...bigDs, config: { ...config, permissions: undefined } });
  const ds = {
    today: isoOf(today), config: { ...config, permissions: undefined }, portfolio: portfolio.map((p, i, all) => ({ ...p, themeId: config.portfolio?.group?.active === false ? null : themeOf(i, all.length), health: health[p.ref] ? (({ prev, ...r }) => r)(health[p.ref]) : null })),
    themes: config.portfolio?.group?.active === false ? [] : MOCK_THEMES,
    issues, orphans: mockOrphans.filter((o) => !issues.some((i) => i.id === o.id)), external: [], versions, milestones, teams: SHAPE.empty ? [] : [...TEAMS, PLAT], people: SHAPE.empty ? {} : people, capacity,
    supportComputed: SHAPE.bare || SHAPE.empty ? null : supportComputed, supportTickets: SHAPE.bare || SHAPE.empty ? null : supportTickets, truncated: false, planEven: { ...planEven },
  };
  // Atlassian Teams as src/lib/atlTeams.js#withAtlassianTeams merges them (?atl=0: none, ?atl=empty: scopes not granted)
  const snap = config.teams?.source === 'cockpit' || SHAPE.fresh || SHAPE.empty ? null : mockAtlTeams();
  if (snap) {
    ds.atlTeams = snap;
    for (const [id, t] of Object.entries(snap.teams)) if (snap.status === 'ok' && t.members.length && !ds.teams.some((x) => x.id === id)) ds.teams = [...ds.teams, { id, name: t.name }];
    for (const t of Object.values(snap.teams)) for (const m of t.members) if (!ds.people[m.accountId]) ds.people = { ...ds.people, [m.accountId]: { id: m.accountId, name: m.name, avatar: null } };
  }
  return structuredClone(ds);
}
// Members follow the maintained capacity, with three deliberate differences (as on a real site):
// u3 is also an Atlassian member of Integration (0 % there in the cockpit), u7 left its team in Atlassian (still has its
// stories and a share), and "Geschäftsführung" is an Atlassian team with a member but no work items.
function mockAtlTeams() {
  const mode = q.get('atl');
  if (mode === '0') return null;
  const at = Date.now() - 4 * 60000;
  if (mode === 'empty') return { at, status: 'empty', teams: Object.fromEntries([...TEAMS, PLAT].map((t) => [t.id, { name: t.name, members: [] }])) };
  const teams = Object.fromEntries([...TEAMS, PLAT].map((t) => [t.id, { name: t.name, members: [] }]));
  for (const p of PEOPLE) {
    const c = capacity.people[p.id];
    const ids = c?.teams?.length ? c.teams.map((x) => x.teamId) : c?.teamId ? [c.teamId] : [];
    for (const tid of ids) if (teams[tid] && p.id !== 'u7') teams[tid].members.push({ accountId: p.id, name: p.name });
  }
  if (!teams['t-int'].members.some((m) => m.accountId === 'u3')) teams['t-int'].members.push({ accountId: 'u3', name: PEOPLE[2].name });
  teams['t-ceo'] = { name: 'Geschäftsführung', members: [{ accountId: 'u99', name: 'Gerda Vogel' }] };
  return { at, status: 'ok', teams };
}
const ok = (data) => ({ ok: true, data });
const fail = (code, message) => ({ ok: false, error: { code, message } });

const history = [];
// A previous visit three days ago, with a few believable differences, so the digest shows locally.
let digestBase = null;
function demoDigest() {
  const items = {};
  const ranked = [...portfolio].sort((a, b) => a.rank - b.rank);
  ranked.forEach((x, i) => { items[x.ref] = { r: x.rank, p: null, h: health[x.ref]?.status || null, s: x.statusCat || null, w: i < 6 ? 'ok' : null }; });
  if (ranked[0] && ranked[3]) { items[ranked[0].ref].r = 4; items[ranked[3].ref].r = 1; }
  if (ranked[1]) items[ranked[1].ref].h = 'onTrack';
  return { at: new Date(Date.now() - 3 * 864e5).toISOString(), items };
}

// ?maint=on|readonly simulates the SUPERPORT kill switch (same rules as src/lib/maintenance.js).
const maint = q.get('maint') || 'off';
const MOCK_READS = new Set(['teams.atlassian', 'planActual.get', 'mine.week', 'mine.search', 'mine.evidence', 'bootstrap', 'dataset', 'portfolio.candidates', 'users.search', 'capacity.get', 'ai.ask', 'ai.healthDraft', 'ai.reportSummary', 'ai.assist', 'report.get', 'report.refresh', 'confluence.spaces', 'config.get', 'config.detect', 'config.history', 'config.version', 'settings.get', 'fields.options', 'field.options', 'support.preview', 'meta.confluenceSpaces', 'meta.groups', 'meta.projects', 'meta.versions', 'audit.list', 'booking.worklogs', 'history.get', 'insights.history', 'insights.comments', 'playbooks.list', 'ai.users', 'ai.spend', 'lotse.llm', 'lotse.learned', 'usage.summary', 'usage.track', 'report.draft']);
// Jira REST for the independent cross-check, answered from the same mock data (search by parent/project, changelog).
const asJira = (i) => ({ id: i.id, key: i.key, fields: {
  issuetype: { id: i.type?.id }, status: { id: i.status?.id || i.status?.cat, name: i.status?.name, statusCategory: { key: i.status?.cat } }, duedate: i.due || null,
  aggregatetimeoriginalestimate: i.oe ? i.oe * 3600 : null, aggregatetimespent: i.ts ? i.ts * 3600 : null, aggregatetimeestimate: i.re != null ? i.re * 3600 : null,
} });
export async function jiraRead(path, body) {
  await wait(120);
  if (path.startsWith('/rest/api/3/search/jql')) {
    const jql = body?.jql || '';
    const m = /parent in \(([^)]*)\)/.exec(jql);
    if (m) {
      const keys = new Set(m[1].split(',').map((x) => x.trim()));
      const ids = new Set([...portfolio.filter((x) => keys.has(x.key)).map((x) => x.id), ...issues.filter((x) => keys.has(x.key)).map((x) => x.id)]);
      return { issues: issues.filter((x) => ids.has(x.parentId)).map(asJira), isLast: true };
    }
    return { issues: [], isLast: true };
  }
  const cl = /^\/rest\/api\/3\/issue\/(\d+)\/changelog/.exec(path);
  if (cl) {
    const i = issues.find((x) => x.id === cl[1]);
    const logs = [...(i?.worklogs || [])].sort((x, y) => (x.d < y.d ? -1 : 1));
    let re = i?.oe || 0;
    const values = [];
    logs.forEach((w, k) => {
      const next = k === Math.floor(logs.length / 2) ? Math.max(0, re - w.h + (Number(i.id) % 3) * 4) : Math.max(0, re - w.h); // a re-estimate halfway on some stories
      values.push({ created: `${w.d}T17:00:00.000+0000`, items: [{ field: 'timeestimate', from: String(Math.round(re * 3600)), to: String(Math.round(next * 3600)) }] });
      re = next;
    });
    return { total: values.length, values };
  }
  return {};
}

const dispatchMock = dispatchMocks({ tickets: () => supportTickets.tickets, capacity: () => capacity, config: () => config, roles: () => roles });
export async function invoke(name, p) {
  await wait(name === 'dataset' || p?.withDataset ? 1200 : 260); // roughly what a real dataset load costs
  if (bigReady) await bigReady;
  if (name === 'availability') return ok({ mode: maint, statusUrl: 'https://superapps.statuspage.io' });
  // ?license=inactive: a site without an active Marketplace licence (as the server: every call refused, the admin page keeps the configuration)
  if (q.get('license') === 'inactive' && !(q.get('module') === 'pc-admin' && ['bootstrap', 'config.get', 'config.save', 'config.history', 'config.version', 'config.restore', 'config.detect'].includes(name))) return fail('LICENSE_INACTIVE', 'LICENSE_INACTIVE');
  if (maint === 'on') return fail('UNAVAILABLE', 'SUPERPORT Portfolio Cockpit is temporarily unavailable.');
  if (maint === 'readonly' && !MOCK_READS.has(name)) return fail('UNAVAILABLE', 'Changes are paused for maintenance to keep your data safe.');
  if (dispatchMock[name]) return dispatchMock[name](p);
  switch (name) {
    case 'bootstrap': return ok({ availability: { mode: maint, statusUrl: 'https://superapps.statuspage.io' }, me: MINE_ME, roles, config: { ...config, permissions: undefined }, setupComplete: config.setupComplete, prefs, locations: LOCATIONS, projectContext: null, digest: digestBase || demoDigest(), dataset: p.withDataset && config.setupComplete ? dataset() : null });
    case 'digest.save': digestBase = p.ack ? { at: new Date().toISOString(), items: p.items } : digestBase || demoDigest(); return ok({ base: digestBase.at });
    case 'dataset': return ok(dataset());
    case 'teams.atlassian': { await wait(p.refresh ? 700 : 200); if (config.teams?.source === 'cockpit' && !p.refresh) return ok({ status: 'none' }); const s = mockAtlTeams(); if (!s) return ok({ status: config.fields?.team ? 'error' : 'noField' }); return ok({ at: p.refresh ? Date.now() : s.at, status: s.status, failed: 0, lastError: null, teams: Object.entries(s.teams).map(([id, t]) => ({ id, name: t.name, members: t.members.length })) }); }
    case 'history.get': return ok(Object.fromEntries([3, 2, 1, 0].map((k) => [isoOf(today - k), Object.fromEntries(portfolio.map((x, i) => [x.ref, [400 + i * 50, 100 + k * -10 + 40, 300 - k * 5, 60, 0.8, 0]]))])));
    case 'booking.worklogs': {
      // worklogs in the period: the portfolio's and the support tickets', plus time booked elsewhere (meetings, other projects)
      const out = {};
      for (const i of [...issues, ...supportTickets.tickets]) {
        for (const w of i.worklogs || []) {
          if (!w.a || w.d < p.from || w.d > p.to) continue;
          const x = out[w.a] || (out[w.a] = { h: 0, last: null, byIssue: {} });
          x.h += w.h; x.byIssue[i.id] = (x.byIssue[i.id] || 0) + w.h;
          if (!x.last || w.d > x.last) x.last = w.d;
        }
      }
      const a = Date.parse(p.from) / 864e5, b = Date.parse(p.to) / 864e5;
      let wd = 0;
      for (let d = a; d <= b; d++) { const w = (((d + 4) % 7) + 7) % 7; if (w && w < 6) wd++; }
      PEOPLE.forEach((u, i) => {
        const target = wd * 8 * [0.97, 0.93, 0.86, 0.99, 0.74, 0.95, 0.91, 0.62, 0.98, 0.94, 0.88, 0.96][i % 12];
        const x = out[u.id] || (out[u.id] = { h: 0, last: null, byIssue: {} });
        if (x.h < target) { x.byIssue.other = (x.byIssue.other || 0) + target - x.h; x.h = target; x.last = x.last || isoOf(Math.min(b, today - 1)); }
      });
      return ok({ from: p.from, to: p.to, people: out, truncated: false });
    }
    case 'prefs.save': { const d = mockReportDraftSave(p); if (d?.ok === false) return d; const { reportDraft, ...rest } = p; prefs = { ...prefs, ...rest, ...(d || {}) }; return ok(prefs); } // eslint-disable-line no-unused-vars
    case 'report.draft': return mockReportDraft();
    case 'report.publishComposed': await wait(500); return mockPublishComposed(p, { people: PEOPLE.map((x) => x.name), roles, entities: { projects: portfolio.map((x) => ({ ref: x.ref, key: x.key || null, rank: x.rank ?? null, name: x.name })), teams: TEAMS.map((t) => ({ id: t.id, name: t.name })) } });
    case 'report.unpublishComposed': return mockUnpublishComposed(p);
    case 'notices.remind': return mockRemind(p, { config, roles, gapsOf: (id) => issues.filter((i) => i.assignee?.id === id && i.role === 'estimate' && !(i.oe > 0) && i.status?.cat !== 'done').length });
    case 'portfolio.reorder': {
      if (!roles.manageRanking) return fail('NO_ACCESS', 'NO_ACCESS:manageRanking');
      p.order.forEach((ref, i) => { const it = portfolio.find((x) => x.ref === ref); if (it) it.rank = i + 1; });
      return ok({ order: p.order });
    }
    case 'portfolio.candidates': {
      const all = [['TEL-77', 'Self-Service-Portal B2B'], ['TEL-81', 'Rechenzentrum-Konsolidierung'], ['PCX-56', 'Projekt #1'], ['PCX-57', 'Glasfaser Süd – Ausbau'], ['PCX-58', 'Zahlungsverkehr Instant Payments'],
        ['PCX-59', 'KI-Kundenservice Phase 2'], ['PCX-60', 'Netzmodernisierung Nord'], ['PCX-61', 'Datenplattform Migration'], ['MOB-12', 'Mobile App 3.0'], ['ERP-40', 'ERP-Anbindung Finanzen']]
        .map(([key, name], i) => ({ ref: `issue:${9100 + i}`, key, name, owner: PEOPLE[(i * 3) % PEOPLE.length], status: 'Offen', space: key.startsWith('PCX') ? 'Portfolio Cockpit Sandbox' : 'Kundenservice' }))
        .filter((c) => !portfolio.some((x) => x.ref === c.ref));
      return ok(p.pool ? { items: all, truncated: false } : all);
    }
    case 'portfolio.add': portfolio.push({ ref: p.ref, rank: portfolio.length + 1, kind: 'issue', id: p.ref.slice(6), key: 'TEL-77', name: 'Self-Service-Portal B2B', owner: PEOPLE[4], statusCat: 'new', due: null }); return ok({ added: true });
    case 'portfolio.remove': { const i = portfolio.findIndex((x) => x.ref === p.ref); if (i >= 0) portfolio.splice(i, 1); portfolio.forEach((x, k) => { x.rank = k + 1; }); return ok({ removed: true }); }
    case 'health.set': { // as the backend: undo restores the earlier record exactly
      if (p.restore) { const cur = health[p.ref]; if (cur?.prev) health[p.ref] = cur.prev; else delete health[p.ref]; const h = health[p.ref]; return ok(h ? (({ prev, ...r }) => r)(h) : null); }
      health[p.ref] = { status: p.status, comment: p.comment, at: new Date().toISOString(), byName: 'Anna Becker', prev: health[p.ref] || null };
      return ok((({ prev, ...r }) => r)(health[p.ref]));
    }
    case 'issue.fill': {
      // as the backend: returns the earlier value, `restore` puts exactly that back, `clear` empties the field
      const it = issues.find((x) => x.id === p.issueId);
      if (!it) return ok({ ok: true, previous: null });
      const previous = { team: it.team?.id ?? null, originalEstimate: { oe: it.oe || 0, re: it.re || 0 }, tshirt: it.tshirt ?? null, targetQuarters: it.quarters?.length ? it.quarters : null, startDate: it.start ?? null, dueDate: it.due ?? null }[p.usage] ?? null;
      const v = 'restore' in p ? p.restore : p.clear ? null : p.value;
      if (p.usage === 'team') it.team = v == null ? null : TEAMS.find((t) => t.id === v) || null;
      if (p.usage === 'originalEstimate') { if (v && typeof v === 'object') { it.oe = v.oe; it.re = v.re; } else { it.oe = v || 0; it.re = v || it.re || 0; } }
      if (p.usage === 'tshirt') it.tshirt = v;
      if (p.usage === 'targetQuarters') it.quarters = v || [];
      if (p.usage === 'startDate') it.start = v;
      if (p.usage === 'dueDate') it.due = v;
      return ok({ ok: true, previous });
    }
    case 'issue.parent': { // as the backend: set only when there is none; undo only while it is still the one that was set
      const it = issues.find((x) => x.id === p.issueId);
      if (p.clear) {
        if (!it?.parentId) return ok({ ok: true, previous: null, unchanged: true });
        if (it.parentId !== p.expect) return fail('PARENT_CHANGED', 'PARENT_CHANGED');
        const o = mockOrphans.find((x) => x.id === p.issueId);
        if (o) issues.splice(issues.indexOf(it), 1); else { it.parentId = null; it.orphan = true; }
        return ok({ ok: true, previous: p.expect });
      }
      if (it?.parentId) return fail('HAS_PARENT', 'HAS_PARENT');
      const parent = issues.find((x) => x.id === p.parentId) || portfolio.find((x) => x.id === p.parentId);
      if (!parent) return fail('NOT_FOUND', 'NOT_FOUND');
      if (it) { it.parentId = p.parentId; it.orphan = false; return ok({ ok: true, previous: null }); }
      const o = mockOrphans.find((x) => x.id === p.issueId);
      if (!o) return fail('NOT_FOUND', 'NOT_FOUND');
      const { candidates, projectId, ...rest } = o;
      issues.push({ links: [], worklogs: [], fixVersionIds: [], quarters: [], note: null, ...rest, rootRef: parent.rootRef || parent.ref, parentId: p.parentId, orphan: false });
      return ok({ ok: true, previous: null });
    }
    case 'capacity.get': return ok({ capacity, people, supportByTeam: Object.fromEntries(supportTeams.map((t) => [t.teamId, t.weekly])), locations: LOCATIONS });
    case 'capacity.save': capacity = p.capacity; return ok({ ok: true });
    case 'users.search': return ok(PEOPLE.filter((x) => x.name.toLowerCase().includes(String(p.query).toLowerCase())));
    case 'planActual.get': return ok(mockPlanActual(p));
    case 'plan.apply': try { const r = mockPlanApply(p, issues, PEOPLE); mineRecordPlanning(p, r); return ok(r); } catch (e) { return fail(e.code || 'ERROR', e.message); }
    case 'plan.even': if (!roles.editPlan) return fail('NO_ACCESS', 'NO_ACCESS:planWeeks'); try { return ok(mockPlanEven(p, planEven, MINE_ME)); } catch (e) { return fail('INVALID', e.message); }
    case 'report.get': case 'report.refresh': {
      if (!roles.viewReport) return fail('NO_ACCESS', 'NO_ACCESS:viewReport');
      // same as the server: the engine's report plus reportExtras (waits, quarters, 4 weeks, plan vs. actual, audience)
      const [{ computeAll }, { reportExtras, reportForViewer }] = await Promise.all([import('@shared/engine.js'), import('@shared/reportKpis.js')]);
      const rep = cLevelReport({ ...dataset(), config });
      try { Object.assign(rep, reportExtras(computeAll({ ...dataset(), config }), config, mockPlanActual({ weeks: 4, team: 'all' }))); } catch (e) { console.warn('[mock] report extras', e); }
      return ok(reportForViewer(rep, roles));
    }
    case 'confluence.spaces': return ok({ available: true, spaces: [{ id: '1', key: 'MGMT', name: 'Management' }, { id: '2', key: 'PMO', name: 'PMO' }] });
    case 'report.publish': return ok({ id: '123', url: 'https://example.atlassian.net/wiki/spaces/MGMT/pages/123' });
    case 'config.get': return ok({ config, milestones, meta: {
      issueTypes: Object.values(TYPES).map(([id, name], i) => ({ id, name, level: [3, 2, 1, 0, -1][i] })).concat([{ id: '10103', name: 'Themes', level: 4 }, { id: '10106', name: 'Delivery Phase', level: 2 }, { id: '10004', name: 'Task', level: 0 }, { id: '10005', name: 'Bug', level: 0 }, ...['Implantación', 'Incidencia', 'Error', 'Vulnerabilidad', 'Test Plan', 'Precondition'].map((name, k) => ({ id: String(10200 + k), name, level: 0 }))]),
      fields: [{ id: 'customfield_10001', name: 'Team', type: 'team', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team' }, { id: 'customfield_10015', name: 'Start date', type: 'date' }, { id: 'customfield_10022', name: 'Target start', type: 'date' }, { id: 'customfield_10204', name: 'Abhängigkeits-Hinweis', type: 'string' }, { id: 'customfield_10300', name: 'Größe', type: 'option' }, { id: 'customfield_10301', name: 'Quartale', type: 'array', items: 'option' }],
      linkTypes: [{ id: '10000', name: 'Blocks', outward: 'blocks', inward: 'is blocked by' }, { id: '10003', name: 'Relates', outward: 'relates to', inward: 'relates to' }, { id: '10002', name: 'Duplicate', outward: 'duplicates', inward: 'is duplicated by' }],
      statuses: [['Blocked', 'blk', 'new'], ['Fertig', 'd1', 'done'], ['In Arbeit', 'p1', 'indeterminate'], ['In Review', 'r1', 'indeterminate'], ['Offen', 'o1', 'new'], ['Ready', 'rd', 'new']].map(([name, id, category]) => ({ name, ids: [id], category })),
      priorities: ['Highest', 'High', 'Medium', 'Low', 'Lowest'].map((name, i) => ({ id: String(i + 1), name })),
      appFields: { rank: 'customfield_10207', tshirt: 'customfield_10206', targetQuarters: 'customfield_10208' }, locations: LOCATIONS,
    } });
    case 'config.detect': return ok(config);
    case 'config.save': { const prev = config; config = { ...p.config, setupComplete: true }; if (JSON.stringify({ ...config.ai, changedAt: 0, changedBy: 0 }) !== JSON.stringify({ ...prev.ai, changedAt: 0, changedBy: 0 })) config.ai = { ...config.ai, changedAt: new Date().toISOString(), changedBy: 'Anna Becker' }; if (!history.length) history.push({ id: '2026-10-01T08:00:00.000Z:first', at: '2026-10-01T08:00:00.000Z', byName: null, note: 'before-history', sections: [], summary: { sizes: (prev.tshirtSizes || []).map((t) => t.key).join(' · ') }, config: structuredClone(prev) }); history.unshift({ id: `${new Date().toISOString()}:mock`, at: new Date().toISOString(), byName: 'Anna Becker', sections: Object.keys(config).filter((k) => JSON.stringify(config[k]) !== JSON.stringify(prev[k])), summary: { sizes: config.tshirtSizes.map((t) => t.key).join(' · ') }, config: structuredClone(config) }); return ok(config); }
    case 'meta.groups': return ok([{ id: 'g-mgmt', name: 'tel-management' }, { id: 'g-pa', name: 'tel-projektadmins' }, { id: 'g-ja', name: 'jira-admins' }, { id: 'g-users', name: 'jira-software-users' }].filter((g) => g.name.includes(p.query || '')));
    case 'meta.projects': return ok(p.service ? [{ id: '20001', key: 'SUP', name: 'IT-Support', type: 'service_desk' }, { id: '20002', key: 'NOC', name: 'Netz-Betrieb', type: 'service_desk' }] : [{ id: '20001', key: 'SUP', name: 'IT-Support', type: 'service_desk' }, { id: '10010', key: 'PLT', name: 'Plattform', type: 'software' }, ...KEYS.map((k, i) => ({ id: String(11000 + i), key: k, name: PROJECTS[i], type: 'software' }))].filter((x) => !p.query || `${x.key} ${x.name}`.toLowerCase().includes(String(p.query).toLowerCase())));
    case 'meta.versions': return ok(Object.values(versions).map((v) => ({ ...v, projectName: v.projectKey })));
    case 'milestones.save': milestones = p.milestones; return ok(milestones);
    case 'settings.get': return ok({ tshirtSizes: config.tshirtSizes, rules: config.rules, capacityDefaults: config.capacityDefaults || { defaultWeeklyHours: 40, defaultLocation: 'DE-NW' }, fields: { tshirt: config.fields?.tshirt || 'app', targetQuarters: config.fields?.targetQuarters || 'app' }, milestones, locations: LOCATIONS, delegatedRules: ['dueDateWarning', 'distribution', 'healthRhythmDays', 'forecastThresholdPct', 'deviationThresholdPct'], admin: true });
    case 'settings.save': config = { ...config, tshirtSizes: p.tshirtSizes, rules: { ...config.rules, ...p.rules }, capacityDefaults: p.capacityDefaults }; history.unshift({ id: `${new Date().toISOString()}:mock`, at: new Date().toISOString(), byName: 'Anna Becker', sections: ['tshirtSizes'], summary: { sizes: config.tshirtSizes.map((t) => t.key).join(' · ') }, config: structuredClone(config) }); return ok({ tshirtSizes: config.tshirtSizes, rules: config.rules, capacityDefaults: config.capacityDefaults });
    case 'config.history': return ok(history.map(({ config: _c, ...v }) => v));
    case 'config.version': return ok(history.find((h) => h.id === p.id));
    case 'config.restore': { const h = history.find((x) => x.id === p.id); config = structuredClone(h.config); history.unshift({ ...h, id: `${new Date().toISOString()}:mock`, at: new Date().toISOString(), note: `restored ${h.at}` }); return ok(config); }
    case 'fields.options': return ok(p.fieldId === 'customfield_10300'
      ? { source: 'editmeta', multi: false, manageUrl: '/secure/admin/ConfigureCustomField!default.jspa?customFieldId=10300', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((v, i) => ({ id: String(100 + i), value: v })) }
      : { source: 'editmeta', multi: true, manageUrl: '/secure/admin/ConfigureCustomField!default.jspa?customFieldId=10301', options: ['2026-Q4', '2027-Q1', '2027-Q2', 'Herbst 2027'].map((v, i) => ({ id: String(200 + i), value: v })) });
    case 'fields.copyValues': await wait(600); return ok({ copied: p.cursor ? 4 : 11, skipped: 1, failed: p.cursor ? [] : [{ key: 'KPR-117', reason: 'no option "XXXL"' }], nextCursor: p.cursor ? null : 'page2' });
    case 'audit.list': return ok(auditLog);
    case 'support.preview': await wait(400); return ok({ total: 37 + (p.queue?.labels?.length || 0) * 3, open: 9 });
    case 'support.link': { const t = supportTickets.tickets.find((x) => x.id === p.ticketId); if (t) t.links = [...new Set([...(t.links || []), p.targetId])]; return ok({ ok: true }); }
    case 'deps.link': { // as the backend: "pre blocks dep" with the configured type, returned as the cockpit reads links
      const pre = issues.find((x) => x.id === p.preId);
      const link = { id: String(70000 + (++n)), typeId: '10000', verb: 'blocks', inverse: 'is blocked by', outward: true, otherId: p.depId, selfId: p.preId };
      if (pre) pre.links = [...(pre.links || []), link];
      return ok({ ok: true, existed: false, link });
    }
    case 'deps.unlink': { for (const x of issues) x.links = (x.links || []).filter((l) => l.id !== p.linkId); return ok({ ok: true }); }
    case 'support.unlink': { const t = supportTickets.tickets.find((x) => x.id === p.ticketId); if (t) t.links = (t.links || []).filter((x) => x !== p.targetId); return ok({ ok: true }); }
    case 'health.clear': delete health[p.ref]; return ok({ ok: true });
    case 'mine.week': { await wait(350); return ok(mineWeekMock(p)); }
    case 'mine.search': { await wait(150); const q = String(p.query || '').toLowerCase(); return ok(q.length < 2 ? [] : issues.filter((i) => i.role === 'estimate' && (i.key.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q))).slice(0, 10).map((i) => ({ id: i.id, key: i.key, summary: i.summary }))); }
    case 'mine.book': { await wait(300); return mineBookMock(p); }
    case 'mine.evidence': { await wait(600); return ok(mineEvidenceMock(p)); }
    case 'ai.ask': if (aiOff('ask')) return { ok: false, error: { code: 'AI_DISABLED', message: 'AI_DISABLED' } }; await wait(1800); return ok({ source: 'ai', text: p.ref
      ? '**Lagebild:** Das Projekt liegt bei 34 % Fortschritt.\n- Terminkonflikt mit ERP-Anbindung (#2), 12 Tage\n- Team Web im Q1 2027 nicht voll besetzbar (−126 h)\n- 3 Stories ohne Schätzung\n\n**Nächste Schritte:** Schnittstelle priorisieren, Kapazität Web klären, Schätzungen ergänzen.'
      : 'Diese Woche wichtig:\n- **Kundenportal Relaunch (#1)**: Abnahme blockiert durch ERP-Schnittstelle\n- Team **Web** liegt in Q4 bei 132 % – ab Rang 7 nicht besetzbar\n- 10 Terminkonflikte, 4 ohne Abhängigkeits-Hinweis' });
    case 'ai.healthDraft': if (aiOff('healthDraft')) return { ok: false, error: { code: 'AI_DISABLED', message: 'AI_DISABLED' } }; await wait(900); return ok({ source: 'ai', status: 'atRisk', comment: 'Fortschritt 34 %; ERP-Schnittstelle verzögert die Abnahme um rund zwei Wochen, Go-Live bleibt erreichbar.' });
    case 'lotse.llm': {
      // the server's own core (validation, minimisation, cross-check) with a scripted "model": ?lotse=differs shows a wrong number
      await wait(1100);
      try {
        // chains: the planner and the writer – the same cores as the server, with deterministic fakes (lib/mockChain.js)
        if (aiOff('lotse')) return fail('AI_DISABLED', 'AI_DISABLED');
        if (p.mode === 'plan') return ok(await lotsePlanAssist(p, { accountId: 'mock-user', cfg: config }, { takeQuota: mockLotseQuota, llm: mockChainPlanModel }));
        if (p.mode === 'write') return ok(await lotseWriteAssist(p, { accountId: 'mock-user', cfg: config }, { takeQuota: mockLotseQuota, llm: mockChainWriteModel }));
        if (p.mode === 'learn') return ok(mockLearnChain(p.clauses, dataset()));
        return ok(await lotseReading(p, { accountId: 'mock-user', cfg: config }, { takeQuota: mockLotseQuota, llm: mockLotseModel }));
      }
      catch (e) { return fail(e.code || 'ERROR', e.message); }
    }
    case 'ai.assist': { await wait(1400); const r = mockAssist(p, { config, dataset, comments: (ids) => mockComments(ids, { texts: config.ai?.shareTexts === true }) }); if (p.feature === 'intent' && p.lotseMissed === true && r.ok && r.data?.card) mockLearnFromAi(p.wish, r.data.card, dataset()); return r; }
    case 'lotse.learned': return ok(mockLearned(!!roles.admin));
    case 'lotse.learn.review': if (!roles.admin) return fail('NO_ACCESS', 'NO_ACCESS:admin'); try { return ok(mockLearnReview(p)); } catch (e) { return fail(e.code || 'ERROR', e.message); }
    case 'usage.track': return ok(mockUsageTrack(p));
    case 'usage.summary': if (!roles.admin) return fail('NO_ACCESS', 'NO_ACCESS:admin'); await wait(300); return ok(mockUsageSummary());
    case 'insights.history': await wait(500); return ok(mockHistory({ today, months: p.months || 12, supportMonths: p.supportMonths || 6 }));
    case 'insights.comments': return ok(mockComments(p.ids, { texts: p.texts === true && config.ai?.enabled === true && config.ai?.shareTexts === true }));
    case 'ai.users': return ok({ on: 7 + (config.ai?.user ? 1 : 0) });
    case 'ai.spend': {
      // six months of a plausible meter, this month day by day up to today (deterministic)
      const now = new Date(), b = config.ai?.budget || { usedEur: 0, limitEur: 50 };
      const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)); return d.toISOString().slice(0, 7); });
      const today = now.getUTCDate();
      const byDay = {}; let left = b.usedEur;
      for (let dd = 1; dd <= today; dd++) { const wd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dd)).getUTCDay(); const share = wd === 0 || wd === 6 ? 0.2 : 1 + ((dd * 7) % 5) / 4; byDay[String(dd).padStart(2, '0')] = share; }
      const tot = Object.values(byDay).reduce((a, x) => a + x, 0) || 1;
      for (const k of Object.keys(byDay)) byDay[k] = Math.round((byDay[k] / tot) * left * 1e4) / 1e4;
      const cur = { eur: b.usedEur, calls: b.calls || 0, cacheHits: b.cacheHits || 0, byDay, byFeature: b.byFeature || {}, inTok: (b.calls || 0) * 1150, outTok: (b.calls || 0) * 380 };
      const list = months.map((m, i) => ({ month: m, meter: i === 5 ? cur : { eur: [8.4, 14.9, 21.3, 26.8, 33.5][i], calls: [640, 1100, 1580, 1990, 2480][i], cacheHits: [120, 260, 410, 560, 720][i] } }));
      return ok({ view: spendView(list, { now, limitEur: b.limitEur }), budget: b });
    }
    case 'playbooks.list': if (!canReadPlaybooks(roles)) return fail('NO_ACCESS', 'NO_ACCESS:playbooks'); return ok({ items: [...playbooks].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))), canEdit: canEditPlaybooks(roles) });
    case 'playbooks.save': {
      if (!canEditPlaybooks(roles)) return fail('NO_ACCESS', 'NO_ACCESS:playbooks');
      const prev = playbooks.find((x) => x.id === p.playbook?.id) || null;
      let pb; try { pb = validPlaybook(p.playbook, prev); } catch { return fail('INVALID', 'playbook: title required'); }
      if (!prev && !(p.restore === true && pb.id)) pb.id = newPlaybookId();
      const now = new Date().toISOString();
      pb.createdAt = pb.createdAt || now; pb.updatedAt = now; pb.updatedBy = MINE_ME.name;
      playbooks = prev ? playbooks.map((x) => (x.id === pb.id ? pb : x)) : [...playbooks, pb];
      return ok({ playbook: pb, previous: prev });
    }
    case 'playbooks.delete': {
      if (!canEditPlaybooks(roles)) return fail('NO_ACCESS', 'NO_ACCESS:playbooks');
      const gone = playbooks.find((x) => x.id === p.id);
      if (!gone) return fail('NOT_FOUND', 'NOT_FOUND');
      playbooks = playbooks.filter((x) => x.id !== p.id);
      return ok({ deleted: gone });
    }
    case 'ai.reportSummary': if (aiOff('reportSummary')) return { ok: false, error: { code: 'AI_DISABLED', message: 'AI_DISABLED' } }; await wait(1500); return ok({ source: 'ai', text: '- 8 aktive Projekte, Gesamtfortschritt 7 %.\n- **Risiko:** Web und UX über 100 % in Q4.\n- Wasserlinie Q1: Engpass ab Rang 7.\n- **Entscheidung:** Billing-Migration verschieben oder Kapazität Web erhöhen.' });

    default: return fail('ERROR', `mock: unknown ${name}`);
  }
}


// ---------- Meine Arbeit (mock of src/lib/mine.js) ----------
// as a normal user the mock signs in as Jonas Weber (u2: owns no project); otherwise as Anna Becker (admin, owner)
var MINE_ME = asEmployee ? { id: 'u2', name: 'Jonas Weber', avatar: null } : { id: 'u1', name: 'Anna Becker', avatar: null };
const mineLogs = [];
let mineSeq = 1;
const mineShape = (i) => ({
  id: i.id, key: i.key, summary: i.summary, type: { name: i.role === 'tiny' ? 'Sub-task' : i.type?.name || 'Story', subtask: i.role === 'tiny', icon: null },
  status: { id: '', name: i.status.name, cat: i.status.cat }, project: { id: '', key: i.key.split('-')[0], name: i.key.split('-')[0] },
  assignee: i.assignee ? { id: i.assignee.id, name: i.assignee.name } : null, mine: i.assignee?.id === MINE_ME.id,
  start: i.start || null, due: i.due || null, oe: i.oe || 0, re: i.re || 0, ts: i.ts || 0, hasEstimate: (i.oe || 0) > 0,
  parent: i.parentId ? (() => { const x = issues.find((y) => y.id === i.parentId); return x ? { id: x.id, key: x.key, summary: x.summary } : null; })() : null, support: !!i.mockSupport,
});
let mineSeeded = false;
function mineSeed() {
  if (mineSeeded) return; mineSeeded = true;
  // two support tickets for me (no dates), and some bookings on the past days of this and last week
  for (const [k, sum] of [['SUP-1182', 'Fehler beim Export der Auftragsdaten'], ['SUP-1190', 'Zugang für neuen Kollegen einrichten']]) issues.push({ id: String(80000 + issues.length), key: k, summary: sum, role: 'support', status: { name: 'In Arbeit', cat: 'indeterminate' }, assignee: MINE_ME, mockSupport: true, oe: 4, re: 3, ts: 1, links: [], worklogs: [] });
  const mine = issues.filter((i) => i.assignee?.id === MINE_ME.id && i.role === 'estimate').slice(0, 4);
  const t = new Date(); const mon = new Date(t); mon.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (let back = 7; back >= 0; back -= 7) for (let k = 0; k < 5; k++) {
    const d = new Date(mon); d.setDate(mon.getDate() - back + k);
    if (d >= t) break;
    mine.forEach((i, j) => { if ((j + k) % 2 === 0) mineLogs.push({ id: String(mineSeq++), issueId: i.id, d: iso(d), started: iso(d) + 'T12:00', h: [2, 3, 1.5, 2.5][j % 4], c: j === 0 && k === 0 ? 'Abstimmung Fachbereich' : '' }); });
  }
}
function mineWeekMock(p) {
  mineSeed();
  const extra = new Set((p.extraIds || []).map(String));
  const worked = new Set(mineLogs.filter((w) => w.d >= p.from && w.d <= p.to).map((w) => w.issueId));
  const list = issues.filter((i) => (i.assignee?.id === MINE_ME.id && ['estimate', 'tiny', 'support'].includes(i.role)) || worked.has(i.id) || extra.has(i.id));
  return { from: p.from, to: p.to, issues: list.map(mineShape), worklogs: mineLogs.filter((w) => w.d >= p.from && w.d <= p.to).map((w) => ({ ...w })), truncated: false };
}
function mineBookMock(p) {
  mineSeed();
  // support tickets live in their own list in the mock – on a real site they are work items like any other
  const i = issues.find((x) => x.id === String(p.issueId)) || supportTickets.tickets.find((x) => String(x.id) === String(p.issueId));
  if (!i) return { ok: false, error: { code: 'NOT_FOUND', message: 'not found' } };
  if (i.role === 'tiny') return { ok: false, error: { code: 'SUBTASK_NOT_BOOKABLE', message: 'Sub-tasks cannot be booked yet' } };
  const h = Math.round(Number(p.hours) * 4) / 4;
  const day = mineLogs.filter((w) => w.issueId === i.id && w.d === p.date);
  const prev = { hours: day.reduce((t, w) => t + w.h, 0), comment: day.map((w) => w.c).filter(Boolean).join(' / ') };
  let op = 'none';
  if (Math.abs(prev.hours - h) > 0.001) {
    for (const w of day) mineLogs.splice(mineLogs.indexOf(w), 1);
    if (h > 0) mineLogs.push({ id: String(mineSeq++), issueId: i.id, d: p.date, started: p.date + 'T12:00', h, c: p.comment ?? (day[0]?.c || '') });
    op = !day.length ? 'create' : h ? 'update' : 'delete';
    const delta = h - prev.hours; i.ts = Math.max(0, (i.ts || 0) + delta); i.re = Math.max(0, (i.re || 0) - delta);
  } else if (p.comment != null && day.length) day[day.length - 1].c = p.comment;
  return ok({ op, issue: mineShape(i), date: p.date, worklogs: mineLogs.filter((w) => w.issueId === i.id && w.d === p.date).map((w) => ({ ...w })), previous: prev });
}

// Jira's changelog of what I changed from the Cockpit: "Apply in Jira" in Weekly planning writes start date, due date
// and assignee AS ME – in Jira these are my edits, but planning, not work (mine.evidence leaves them out).
const mineHistory = new Map();
function mineRecordPlanning(p, r) {
  const d = new Date(); const at = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':00.000';
  for (const m of (p?.moves || [])) {
    if (!(r?.results || []).some((x) => x.ok && x.issueId === m.issueId)) continue;
    const items = [...('start' in m ? [{ field: 'Start date', fieldId: 'customfield_10015' }] : []), ...('due' in m ? [{ field: 'duedate', fieldId: 'duedate' }] : []), ...('assignee' in m ? [{ field: 'assignee', fieldId: 'assignee' }] : [])];
    if (items.length) (mineHistory.get(m.issueId) || mineHistory.set(m.issueId, []).get(m.issueId)).push({ author: { accountId: MINE_ME.id }, created: at, items });
  }
}
// my activity of the week (mock of mine.evidence): a status change and comments on some of my stories
function mineEvidenceMock(p) {
  mineSeed();
  const mine = issues.filter((i) => i.assignee?.id === MINE_ME.id && i.role === 'estimate' && i.status.cat !== 'done').slice(0, 5);
  const ev = [];
  const a = new Date(p.from + 'T12:00:00'); const today = new Date();
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  for (let k = 0; k < 5; k++) {
    const d = new Date(a); d.setDate(a.getDate() + k); if (d > today) break;
    const x = mine[k % Math.max(1, mine.length)]; if (!x) break;
    ev.push({ issueId: x.id, d: iso(d), at: iso(d) + 'T09:1' + k + ':00.000+0100', kind: k % 2 ? 'comment' : 'status', from: 'Offen', to: 'In Arbeit', text: k % 2 ? 'Abstimmung mit dem Fachbereich, Feldliste fertig' : '' });
    const y = mine[(k + 2) % Math.max(1, mine.length)]; if (y && y !== x) ev.push({ issueId: y.id, d: iso(d), at: iso(d) + 'T14:3' + k + ':00.000+0100', kind: 'comment', text: 'Review-Anmerkungen eingearbeitet' });
  }
  // my Cockpit edits (changelog) through the same rules as the server: planning edits are not evidence
  const touched = [];
  for (const [id, hist] of mineHistory) {
    const found = evidenceOf(id, MINE_ME.id, p.from, p.to, hist, [], { planning: ['customfield_10015', 'customfield_10001'] });
    ev.push(...found);
    const it = issues.find((x) => x.id === id);
    if (it && !mine.includes(it)) touched.push(it);
  }
  return { from: p.from, to: p.to, issues: [...mine, ...touched].map(mineShape), events: ev, truncated: false };
}

// Lotse × AI (mock): the person's switch as the server checks it, and a "model" that reads the story's facts.
async function mockLotseQuota() {
  if (config.ai?.access !== 'all' && config.ai?.user !== true) throw Object.assign(new Error('AI_USER_OFF'), { code: 'AI_USER_OFF' });
}
async function mockLotseModel(system, user, policy) {
  const facts = JSON.parse(user.slice(user.indexOf('<story>') + 7, user.indexOf('</story>')));
  const de = facts.lang !== 'en';
  const k = facts.kpis[0], f1 = facts.findings[1] || facts.findings[0];
  const differs = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lotse') === 'differs';
  const val = (x) => (differs ? Math.round(x.value * 1.17 + 3) : x.value);
  const unit = (x) => (x.unit === 'n' ? '' : x.unit === '%' ? (de ? ' %' : '%') : ` ${x.unit}`);
  if (policy?.meta) policy.meta.model = 'mock-claude';
  return de
    ? `Das Wichtigste zuerst: ${facts.findings[0].text} ${k ? `${k.label} liegt bei ${val(k)}${unit(k)} – daran hängt, wie schnell sich die Lage entspannt.` : ''} Ich würde mit dem ersten Punkt beginnen und den Rest in der nächsten Planung angehen. Zusätzlich: ${f1.text}`
    : `First things first: ${facts.findings[0].text} ${k ? `${k.label} is at ${val(k)}${unit(k)} – that decides how fast things calm down.` : ''} I would start with the first point and take the rest into the next planning round. Also consider: ${f1.text}`;
}
