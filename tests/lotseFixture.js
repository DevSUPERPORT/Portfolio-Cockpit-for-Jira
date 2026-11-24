// A realistic, deterministic dataset for the Lotse tests – the demo company of lib/mock.js (same teams, people, projects
// and shapes), generated with a fixed seed and a fixed "today", plus history, plan vs. actual and support tickets.
import { DEFAULT_MATRIX, DEFAULT_TSHIRTS, computeAll } from '../shared/engine.js';
import { dayIdx, isoOf, quarterKeyOf, shiftQuarter } from '../shared/dates.js';
import { buildPayload, shiftWeek, weekRange } from '../shared/planActual.js';
import { mockHistory } from '../static/cockpit/src/lib/mockHistory.js';

export const TODAY = '2026-11-12';
export const NOW = Date.parse(`${TODAY}T10:00:00Z`);

export function lotseDataset() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const today = dayIdx(TODAY);
  const curQ = quarterKeyOf(today);
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
  const config = {
    version: 1, setupComplete: true, portfolio: { source: 'issue', issueTypeIds: ['10101'] }, levels: LEVELS,
    fields: { team: 'customfield_10001', startDate: 'customfield_10015', tshirt: 'app', targetQuarters: 'app' },
    matrix: { portfolio: { owner: 'required', dueDate: 'optional' }, workstream: { ...DEFAULT_MATRIX.rough }, epic: { ...DEFAULT_MATRIX.structure }, story: { ...DEFAULT_MATRIX.estimate }, subtask: { ...DEFAULT_MATRIX.tiny } },
    dependencies: { linkTypeIds: ['10000'] }, tshirtSizes: DEFAULT_TSHIRTS,
    rules: { dueDateWarning: true, distribution: 'linear', personLevel: true, forecastThresholdPct: 10 },
    support: { slaTargetPct: 95, dispatch: { incomingStatusIds: [], componentTeams: { Netzwerk: 't-int', Hardware: 't-mob' } } },
    booking: { minPct: 80, graceDays: 0 },
  };
  const issues = [], portfolio = [];
  let n = 100;
  const issue = (o) => { const id = String(++n); const x = { id, key: `${o.pk}-${n}`, links: [], worklogs: [], fixVersionIds: [], quarters: [], ...o }; delete x.pk; issues.push(x); return x; };
  const st = (cat) => ({ name: cat === 'done' ? 'Fertig' : cat === 'indeterminate' ? 'In Arbeit' : 'Offen', cat });
  PROJECTS.forEach((name, pi) => {
    const pk = KEYS[pi], ref = `issue:${9000 + pi}`, owner = PEOPLE[(pi * 3) % PEOPLE.length];
    const pStart = today - 60 + pi * 9;
    portfolio.push({ ref, rank: pi + 1, kind: 'issue', id: String(9000 + pi), key: `${pk}-1`, name, owner, statusCat: 'indeterminate', due: isoOf(pStart + (pi === 5 ? 6 : 160 + pi * 12)), projectKey: pk, leadTeam: TEAMS[pi % TEAMS.length],
      health: pi === 2 ? null : { status: ['onTrack', 'atRisk', 'critical', 'onTrack'][pi % 4], comment: 'Plan hält.', at: `${isoOf(today - pi * 3 - 1)}T08:00:00Z`, byName: owner.name } });
    for (let w = 0; w < 2 + (pi % 2); w++) {
      const lead = TEAMS[(pi + w) % TEAMS.length];
      const qs = [shiftQuarter(curQ, w === 0 ? -1 : 0), shiftQuarter(curQ, w), ...(rnd() > 0.6 ? [shiftQuarter(curQ, w + 1)] : [])];
      const ws = issue({ pk, summary: `${pick(['Fundament', 'Rollout', 'Migration', 'Integration', 'Self-Service', 'Reporting'])} ${w + 1}`, role: 'rough', levelKey: 'workstream', type: { id: '10102', name: 'Workstream' }, parentId: String(9000 + pi), rootRef: ref, status: st('indeterminate'), team: rnd() > 0.1 ? lead : null, tshirt: rnd() > 0.12 ? pick(['S', 'M', 'L', 'M', 'XL']) : null, quarters: rnd() > 0.1 ? [...new Set(qs)] : [], assignee: owner });
      for (let e = 0; e < 2; e++) {
        const ep = issue({ pk, summary: pick(['Schnittstellen', 'Datenmodell', 'Benutzerführung', 'Abrechnung', 'Berechtigungen', 'Monitoring']), role: 'structure', levelKey: 'epic', type: { id: '10000', name: 'Epic' }, parentId: ws.id, rootRef: ref, status: st('indeterminate'), team: lead });
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
            role: 'estimate', levelKey: 'story', type: { id: '10001', name: 'Story' }, parentId: ep.id, rootRef: ref, projectKey: pk,
            status: st(done ? 'done' : start < today ? 'indeterminate' : 'new'), team, assignee: rnd() > 0.06 ? person : null,
            start: rnd() > 0.07 ? isoOf(start) : null, due: rnd() > 0.05 ? isoOf(start + len) : null, oe, re: done ? 0 : Math.max(0, oe - ts), ts, note: null, fixVersionIds: rnd() > 0.4 ? [pick(['v1', 'v2'])] : [] });
          for (let k = 0; k < Math.floor(ts / 6); k++) story.worklogs.push({ a: story.assignee?.id || person.id, d: isoOf(start + Math.floor(rnd() * Math.max(1, Math.min(len, today - start)))), h: 6 });
        }
      }
    }
  });
  const open = issues.filter((i) => i.role === 'estimate' && i.status.cat !== 'done');
  for (let k = 0; k < 22; k++) {
    const a = pick(open), b = pick(open);
    if (a === b || (a.rootRef === b.rootRef && rnd() > 0.3)) continue;
    const id = `l${k}`;
    a.links.push({ id, typeId: '10000', verb: 'blocks', inverse: 'is blocked by', outward: true, otherId: b.id });
    b.links.push({ id, typeId: '10000', verb: 'blocks', inverse: 'is blocked by', outward: false, otherId: a.id });
  }
  open.slice(3, 6).forEach((x, k) => {
    x.status = { id: 'blk', name: 'Blocked', cat: 'new' };
    x.blockedSince = isoOf(today - [3, 9, 15][k]);
    x.blockedReason = ['Wartet auf Freigabe der Security.', 'Testumgebung nicht verfügbar.', 'Fachbereich klärt die Anforderungen.'][k];
  });
  // u1 ("me" in the tests): this week's bookings on own stories
  const mine = open.filter((x) => x.assignee?.id === 'u1').slice(0, 3);
  const monday = today - 3; // 2026-11-09
  mine.forEach((x, k) => { for (let d = 0; d < 3; d++) if ((d + k) % 2 === 0) x.worklogs.push({ a: 'u1', d: isoOf(monday + d), h: 3 + k }); });
  const capacity = {
    people: Object.fromEntries(PEOPLE.map((p, i) => [p.id, { weeklyHours: i % 5 === 0 ? 32 : 40, location: pick(['DE-NW', 'DE-BY', 'DE-BE', 'AT']), teamId: teamOfPerson(p).id }])),
    teams: Object.fromEntries(TEAMS.map((t, i) => [t.id, { name: t.name, dailyBusinessPct: 15 + (i % 3) * 5, internalPct: 10, absenceRatePct: 10 }])),
    absences: [{ id: 'a1', accountId: 'u3', from: isoOf(today + 7), to: isoOf(today + 18), type: 'vacation' }],
  };
  const versions = { v1: { id: 'v1', name: 'Release 26.4', releaseDate: isoOf(today + 40), projectKey: 'KPR' }, v2: { id: 'v2', name: 'Release 27.1', releaseDate: isoOf(today + 120), projectKey: 'ERP' } };
  const milestones = [{ id: 'm1', name: 'Go-Live Kundenportal', date: isoOf(today + 45), fixVersionIds: ['v1'] }, { id: 'm2', name: 'Jahresabschluss', date: isoOf(today + 130), fixVersionIds: ['v2'] }];
  const supTeams = TEAMS.slice(0, 4).map((t, i) => ({ teamId: t.id, win: 40 + i * 22, recent: 0, trend: Array.from({ length: 8 }, (_, k) => Math.round(8 + i * 5 + rnd() * 10 + (i === 2 && k > 5 ? 14 : 0))), avg: 10 + i * 5.5, recentAvg: i === 2 ? 26 : 10 + i * 5, spike: i === 2, weekly: i === 2 ? 26 : 10 + i * 5.5 }));
  const supportComputed = {
    averagingWeeks: 4, services: [{ id: '20001', key: 'SUP', name: 'IT-Support', met: 184, breached: 9, open: 23, openRe: 61, teams: supTeams.slice(0, 3).map((t) => ({ teamId: t.teamId, avg: t.avg, recentAvg: t.recentAvg, spike: t.spike, weekly: t.weekly })), slaRate: 184 / 193, health: 'onTrack' }],
    teams: supTeams, reserveQuarter: Object.fromEntries(supTeams.map((t) => [t.teamId, t.weekly * 12])), personWeekly: {},
    slaRate: 261 / 277, slaTarget: 0.95, breaches: 16, health: 'atRisk', open: 32, openRe: 91, hoursWindow: 310, weeklyTotal: supTeams.reduce((a, t) => a + t.weekly, 0),
  };
  const SUBJECTS = [['Login schlägt fehl', 'Konto'], ['Rechnung doppelt verschickt', 'SAP'], ['VPN bricht ab', 'Netzwerk'], ['Export hängt', 'Export'], ['Portal lädt langsam', 'Checkout'], ['Passwort-Reset kommt nicht an', 'Konto'], ['Schnittstelle liefert 500', 'SAP'], ['Druckauftrag verschwindet', 'Hardware']];
  const PRIOS = ['Highest', 'High', 'High', 'Medium', 'Medium', 'Medium', 'Low', 'Lowest'];
  const tickets = Array.from({ length: 60 }, (_, k) => {
    const done = k >= 18;
    const ageH = done ? Math.round(rnd() * 54 * 24) + 30 : k < 4 ? 24 * (6 + k * 3) : Math.round(rnd() * 70) + 1;
    const created = NOW - ageH * 3600e3;
    const resolved = done ? created + (2 + rnd() * 50) * 3600e3 : null;
    const [summary, comp] = pick(SUBJECTS);
    const assignee = done || k % 2 ? pick(PEOPLE) : null;
    const spentH = Math.round(rnd() * 6 * 2) / 2;
    return {
      id: String(30000 + k), key: `SUP-${400 + k}`, summary, priority: k < 3 ? 'Highest' : pick(PRIOS), created: new Date(created).toISOString(), resolved: resolved ? new Date(resolved).toISOString() : null,
      statusCat: done ? 'done' : k % 3 ? 'new' : 'indeterminate', status: done ? 'Erledigt' : 'Offen', labels: ['support'], components: [comp], requestType: 'Technisches Problem',
      projectKey: 'SUP', assignee, team: pick(TEAMS.slice(0, 4)), spentH, jsm: null, links: [], services: ['20001'],
      worklogs: spentH ? [{ a: assignee?.id || null, d: isoOf(today - 3 - (k % 20)), h: spentH }] : [],
    };
  });
  return {
    today: TODAY, config, portfolio, issues, external: [], versions, milestones, teams: TEAMS, people: Object.fromEntries(PEOPLE.map((p) => [p.id, p])),
    capacity, supportComputed, supportTickets: { truncated: false, tickets },
  };
}

// Plan vs. actual: four completed weeks for two teams, run through the server's payload builder.
export function lotsePlanActual() {
  const plans = [], acts = [];
  for (let k = 0; k < 4; k++) {
    const week = shiftWeek('2026-W42', k);
    const [a, b] = weekRange(week);
    plans.push({ week, from: isoOf(a), to: isoOf(b), at: `${isoOf(a)}T05:00:00Z`,
      projects: { 'issue:9001': { n: 'ERP-Anbindung', k: 'ERP-1', r: 2 }, 'issue:9000': { n: 'Kundenportal Relaunch', k: 'KPR-1', r: 1 } },
      teams: { 't-int': 'Integration', 't-web': 'Web' }, names: { u2: 'Jonas Weber', u8: 'Felix Wolf', u5: 'Sophie Wagner' },
      people: { u2: { t: 't-int', p: { 'issue:9001': 20, SUP: 4 } }, u8: { t: 't-int', p: { 'issue:9001': 10, 'issue:9000': 10 } }, u5: { t: 't-web', p: { 'issue:9000': 24 } } } });
    acts.push({ week, final: true, people: {
      u2: { t: 't-int', b: { 'issue:9001': 12, SUP: 10 }, absU: k === 2 ? 8 : 0 },
      u8: { t: 't-int', b: { 'issue:9001': 10, 'issue:9000': 10 } },
      u5: { t: 't-web', b: { 'issue:9000': 20, INT: 4 } } },
    over: k === 3 ? [{ ref: 'issue:9001', key: 'ERP-120', t: 't-int', extra: 12, oe: 40 }] : [] });
  }
  return buildPayload({ plans, acts, weeks: 4, canSee: () => true });
}

export const lotseHistory = () => mockHistory({ today: dayIdx(TODAY) });
// The test context, as the UI passes it to Lotse.
export function lotseCtx(lang = 'de', over = {}) {
  const ds = over.ds || lotseDataset();
  const computed = computeAll(ds);
  return { ds, computed, lang, me: { id: 'u1', name: 'Anna Becker' }, roles: { admin: true, viewReport: true, manageRanking: true, editCapacity: true, dispatch: true, editPlan: true, rights: ['mine', 'portfolio', 'projects', 'teams', 'plan', 'hours', 'support', 'report'] }, history: lotseHistory(), planActual: lotsePlanActual(), now: NOW, ...over };
}
