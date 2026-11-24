// Customer-sized, deterministic datasets for performance and scale checks – the same shape as static/cockpit/src/lib/mock.js
// and tests/lotseFixture.js (Project > Workstream > Epic > Story > Sub-task, capacity, absences, links, support tickets,
// history), generated from a fixed seed and a fixed "today". No I/O, no network, no Date.now(): same input, same output.
//
//   bigDataset('S' | 'M' | 'L', { today?, seed? })  → ds          (S ≈ 2k work items, M ≈ 10k, L ≈ 50k)
//   bigHistory(ds, { months? })                     → history     (done stories of the last 12 months + resolved tickets)
//   bigCtx(size, { lang?, today? })                 → Lotse ctx   ({ ds, computed, lang, me, roles, history, now })
//
// CLI: node tools/bigDataset.js L            → prints the size summary (counts, generation time)
//      node tools/bigDataset.js M out.json   → also writes the dataset as JSON
import { DEFAULT_MATRIX, DEFAULT_TSHIRTS, computeAll } from '../shared/engine.js';
import { dayIdx, isoOf, quarterKeyOf, shiftQuarter } from '../shared/dates.js';

export const SIZES = {
  S: { items: 2000, projects: 40, teams: 15, people: 150, tickets: 5000, seed: 101 },
  M: { items: 10000, projects: 80, teams: 25, people: 300, tickets: 10000, seed: 202 },
  L: { items: 50000, projects: 150, teams: 40, people: 600, tickets: 20000, seed: 303 },
};
export const BIG_TODAY = '2026-11-12';

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const TEAM_NAMES = ['Web', 'UX', 'Integration', 'Mobile', 'Data', 'Netz', 'Billing', 'CRM', 'Security', 'Cloud', 'Plattform', 'Payments', 'Search', 'Analytics', 'QA', 'DevOps', 'Identity', 'Content',
  'Checkout', 'Logistik', 'Einkauf', 'HR-IT', 'Finance-IT', 'Portal', 'API', 'Core', 'Messaging', 'Reporting', 'ML', 'Field Service', 'Service-IT', 'SAP', 'Infrastruktur', 'Netzbetrieb', 'IoT',
  'Partner', 'Marketing-Tech', 'Archiv', 'Migration', 'Compliance'];
const FIRST = ['Anna', 'Jonas', 'Lea', 'Maximilian', 'Sophie', 'Paul', 'Mia', 'Felix', 'Emma', 'Noah', 'Hannah', 'Elias', 'Lina', 'Ben', 'Clara', 'Luis', 'Marie', 'Finn', 'Laura', 'Leon', 'Julia', 'David',
  'Sarah', 'Tim', 'Katharina', 'Jan', 'Nina', 'Lukas', 'Lisa', 'Moritz', 'Johanna', 'Simon', 'Amelie', 'Niklas', 'Carla', 'Tobias', 'Ida', 'Fabian', 'Greta', 'Philipp'];
const LAST = ['Becker', 'Weber', 'Hoffmann', 'Schulz', 'Wagner', 'Richter', 'Klein', 'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hartmann', 'Lange', 'Schmitt', 'Werner',
  'Krause', 'Meier', 'Lehmann', 'Schmid', 'Schulze', 'Maier', 'Köhler', 'Herrmann', 'König', 'Walter', 'Mayer', 'Huber', 'Kaiser', 'Fuchs', 'Peters', 'Lang', 'Scholz', 'Möller', 'Weiß', 'Jung', 'Hahn', 'Vogel'];
const TOPICS = ['Kundenportal', 'ERP', 'DSGVO', 'Mobile App', 'Datenplattform', 'Glasfaser', 'Billing', 'CRM', 'Self-Service', 'Rechnungsstellung', 'Lagerverwaltung', 'Personalportal', 'Zahlungsverkehr',
  'Kundenservice', 'Partnerportal', 'Netzausbau', 'Cloud', 'Identity', 'Reporting', 'Vertragsmanagement', 'Logistik', 'Einkauf', 'Field Service', 'Webshop', 'Suche', 'Marketing-Automation',
  'Archivierung', 'Telefonie', 'IoT-Plattform', 'Monitoring'];
const SUFFIX = ['Relaunch', 'Anbindung', 'Migration', '2.0', 'Konsolidierung', 'Modernisierung', 'Ausbau', 'Einführung', 'Harmonisierung', 'Rollout', 'Optimierung', 'Neubau'];
const WS = ['Fundament', 'Rollout', 'Migration', 'Integration', 'Self-Service', 'Reporting', 'Pilot', 'Betrieb'];
const EPICS = ['Schnittstellen', 'Datenmodell', 'Benutzerführung', 'Abrechnung', 'Berechtigungen', 'Monitoring', 'Suche', 'Onboarding', 'Testautomatisierung', 'Performance'];
const STORIES = ['API für Vertragsdaten', 'Login mit SSO', 'Rechnungs-PDF', 'Adressvalidierung', 'Push-Benachrichtigungen', 'Lastenheft abstimmen', 'Testdaten anonymisieren', 'Migrationsskript',
  'Dashboard Kennzahlen', 'Rollenmodell', 'Exportfunktion', 'Performance-Tuning', 'Fehlerhandling Schnittstelle', 'CSV-Import Preislisten', 'Suche mit Filtern', 'Audit-Log', 'Mandantenfähigkeit',
  'Barrierefreiheit prüfen', 'Lasttest', 'Datenabgleich nachts'];
const SUBTASKS = ['Review', 'Doku', 'Unit-Tests', 'Abnahme'];
const TICKET_SUBJECTS = [['Login schlägt fehl', 'Konto', 'Zugang & Konten'], ['Passwort zurücksetzen', 'Konto', 'Zugang & Konten'], ['Rechnung doppelt verschickt', 'SAP', 'Technisches Problem'],
  ['VPN bricht ab', 'Netzwerk', 'Netzwerk & VPN'], ['Export hängt', 'Export', 'Technisches Problem'], ['Portal lädt langsam', 'Checkout', 'Technisches Problem'], ['Schnittstelle liefert 500', 'SAP', 'Technisches Problem'],
  ['Druckauftrag verschwindet', 'Hardware', 'Arbeitsplatz'], ['Neue Benutzerin anlegen', 'Konto', 'Zugang & Konten'], ['Datenabgleich unvollständig', 'Export', 'Technisches Problem'],
  ['App stürzt beim Start ab', 'App', 'Technisches Problem'], ['Zertifikat läuft ab', 'Netzwerk', 'Netzwerk & VPN'], ['Monitor flackert', 'Hardware', 'Arbeitsplatz'], ['Lizenz benötigt', 'Lizenz', 'Sonstiges']];
const PRIOS = ['Highest', 'High', 'High', 'Medium', 'Medium', 'Medium', 'Medium', 'Low', 'Low', 'Lowest'];
const LOCATIONS = ['DE-NW', 'DE-NW', 'DE-BY', 'DE-BE', 'DE-HE', 'AT'];

const LEVELS = [
  { key: 'workstream', name: 'Workstream', role: 'rough', issueTypeIds: ['10102'] },
  { key: 'epic', name: 'Epic', role: 'structure', issueTypeIds: ['10000'] },
  { key: 'story', name: 'Story', role: 'estimate', issueTypeIds: ['10001'] },
  { key: 'subtask', name: 'Sub-task', role: 'tiny', issueTypeIds: ['10003'] },
];

export function bigDataset(size = 'S', { today = BIG_TODAY, seed } = {}) {
  const S = SIZES[size] || SIZES.S;
  const rnd = rng(seed ?? S.seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  // log-normal: most values near the median, a long tail (estimates, durations, project sizes)
  const logn = (median, sigma) => { const u = Math.max(1e-9, rnd()), v = rnd(); return median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)); };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const T0 = dayIdx(today);
  const curQ = quarterKeyOf(T0);

  // ---------- teams and people ----------
  const TEAMS = TEAM_NAMES.slice(0, S.teams).map((name, i) => ({ id: `t-${i + 1}`, name }));
  const PEOPLE = Array.from({ length: S.people }, (_, i) => ({ id: `u${i + 1}`, name: `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length + i * 7) % LAST.length]}`, avatar: null }));
  const seenNames = new Set();
  for (const p of PEOPLE) { let nm = p.name, k = 2; while (seenNames.has(nm)) nm = `${p.name} ${k++}`; p.name = nm; seenNames.add(nm); }
  // team sizes vary (3 … 30): a few big teams, many small ones
  const teamWeight = TEAMS.map(() => logn(1, 0.6));
  const tw = teamWeight.reduce((a, b) => a + b, 0);
  const teamOf = new Map(), members = new Map(TEAMS.map((t) => [t.id, []]));
  let cursor = 0;
  TEAMS.forEach((t, i) => {
    const cnt = i === TEAMS.length - 1 ? PEOPLE.length - cursor : Math.max(3, Math.round((teamWeight[i] / tw) * PEOPLE.length));
    for (let k = 0; k < cnt && cursor < PEOPLE.length; k++, cursor++) { teamOf.set(PEOPLE[cursor].id, t); members.get(t.id).push(PEOPLE[cursor]); }
  });
  for (; cursor < PEOPLE.length; cursor++) { const t = TEAMS[cursor % TEAMS.length]; teamOf.set(PEOPLE[cursor].id, t); members.get(t.id).push(PEOPLE[cursor]); }
  for (const t of TEAMS) if (!members.get(t.id).length) { const p = PEOPLE[between(0, PEOPLE.length - 1)]; members.get(t.id).push(p); }

  // ---------- config ----------
  const config = {
    version: 1, setupComplete: true, portfolio: { source: 'issue', issueTypeIds: ['10101'] }, levels: LEVELS,
    fields: { team: 'customfield_10001', startDate: 'customfield_10015', tshirt: 'app', targetQuarters: 'app' },
    matrix: { portfolio: { owner: 'required', dueDate: 'optional' }, workstream: { ...DEFAULT_MATRIX.rough }, epic: { ...DEFAULT_MATRIX.structure }, story: { ...DEFAULT_MATRIX.estimate }, subtask: { ...DEFAULT_MATRIX.tiny } },
    dependencies: { linkTypeIds: ['10000'] }, tshirtSizes: DEFAULT_TSHIRTS,
    rules: { dueDateWarning: true, distribution: 'linear', personLevel: true, forecastThresholdPct: 10 },
    support: { slaTargetPct: 95, dispatch: { incomingStatusIds: [], componentTeams: { Netzwerk: TEAMS[2 % TEAMS.length].id, Hardware: TEAMS[3 % TEAMS.length].id } } },
    booking: { minPct: 80, graceDays: 0 },
  };

  // ---------- projects and work items ----------
  const issues = [], portfolio = [];
  let n = 100000;
  const issue = (o) => { const id = String(++n); const x = { id, key: `${o.pk}-${n - 100000}`, links: [], worklogs: [], fixVersionIds: [], quarters: [], ...o }; delete x.pk; issues.push(x); return x; };
  const st = (cat) => ({ name: cat === 'done' ? 'Fertig' : cat === 'indeterminate' ? 'In Arbeit' : 'Offen', cat });
  const weights = Array.from({ length: S.projects }, () => logn(1, 0.7));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const names = new Set();
  const versions = {}, milestones = [];
  for (let pi = 0; pi < S.projects; pi++) {
    let name = `${TOPICS[pi % TOPICS.length]} ${SUFFIX[Math.floor(pi / TOPICS.length + pi * 5) % SUFFIX.length]}`;
    for (let k = 2; names.has(name); k++) name = `${TOPICS[pi % TOPICS.length]} ${SUFFIX[pi % SUFFIX.length]} ${k}`;
    names.add(name);
    const pk = `P${String.fromCharCode(65 + Math.floor(pi / 26) % 26)}${String.fromCharCode(65 + (pi % 26))}`;
    const ref = `issue:${9000 + pi}`;
    const owner = PEOPLE[(pi * 7) % PEOPLE.length];
    const doneProject = rnd() < 0.04;
    const pStart = T0 - between(30, 300);
    const due = pStart + between(120, 520) - (rnd() < 0.08 ? 400 : 0); // ~8 % already past their due date
    const lead = TEAMS[pi % TEAMS.length];
    const others = [lead, ...Array.from({ length: between(1, 3) }, () => pick(TEAMS))];
    portfolio.push({ ref, rank: pi + 1, kind: 'issue', id: String(9000 + pi), key: `${pk}-1`, name, owner, statusCat: doneProject ? 'done' : 'indeterminate', due: isoOf(due), projectKey: pk, leadTeam: lead,
      health: rnd() < 0.15 ? null : { status: pick(['onTrack', 'onTrack', 'onTrack', 'atRisk', 'atRisk', 'critical']), comment: pick(['Plan hält.', 'Abhängigkeit verzögert den Start.', 'Team überlastet, Priorisierung nötig.', 'Abnahme steht aus.']),
        at: `${isoOf(T0 - between(1, 40))}T08:00:00Z`, byName: owner.name } });
    if (pi % 10 === 0) {
      const vid = `v${pi}`;
      versions[vid] = { id: vid, name: `Release ${pk}`, releaseDate: isoOf(T0 + between(20, 200)), projectKey: pk };
      milestones.push({ id: `m${pi}`, name: `Go-Live ${name}`, date: versions[vid].releaseDate, fixVersionIds: [vid] });
    }
    const budget = Math.max(12, Math.round((weights[pi] / wsum) * S.items));
    const nStories = Math.max(4, Math.round(budget / 1.48));
    const nWs = clamp(Math.round(nStories / 70), 1, 6);
    const nEp = Math.max(nWs, Math.round(nStories / 11));
    const wss = [];
    for (let w = 0; w < nWs; w++) {
      const t = others[w % others.length];
      const qs = [shiftQuarter(curQ, w === 0 ? -1 : 0), shiftQuarter(curQ, Math.min(w, 3)), ...(rnd() > 0.6 ? [shiftQuarter(curQ, Math.min(w + 1, 3))] : [])];
      wss.push(issue({ pk, summary: `${pick(WS)} ${w + 1}`, role: 'rough', levelKey: 'workstream', type: { id: '10102', name: 'Workstream' }, parentId: String(9000 + pi), rootRef: ref, status: st(doneProject ? 'done' : 'indeterminate'),
        team: rnd() > 0.08 ? t : null, tshirt: rnd() > 0.1 ? pick(['S', 'M', 'L', 'M', 'XL', 'L']) : null, quarters: rnd() > 0.08 ? [...new Set(qs)] : [], assignee: owner }));
    }
    const eps = [];
    for (let e = 0; e < nEp; e++) {
      const ws = wss[e % wss.length];
      eps.push(issue({ pk, summary: pick(EPICS), role: 'structure', levelKey: 'epic', type: { id: '10000', name: 'Epic' }, parentId: ws.id, rootRef: ref, status: st(doneProject ? 'done' : 'indeterminate'), team: ws.team }));
    }
    const vid = Object.keys(versions).find((v) => versions[v].projectKey === pk);
    for (let s = 0; s < nStories; s++) {
      const ep = eps[s % eps.length];
      const wIdx = (s % eps.length) % wss.length; // epic e hangs below workstream e % nWs
      const team = rnd() < 0.06 ? null : rnd() < 0.75 ? (ep.team || pick(others)) : pick(others);
      const pool = team ? members.get(team.id) : PEOPLE;
      const person = pool[Math.floor(rnd() * pool.length)];
      const start = T0 - 150 + between(0, 260) + wIdx * 20;
      const len = Math.round(clamp(logn(14, 0.7), 2, 90));
      const done = doneProject || (start + len < T0 - 3 && rnd() < 0.78);
      const oe = rnd() < 0.08 ? 0 : Math.round(clamp(logn(16, 0.8), 2, 160));
      const ts = done ? Math.round(oe * (0.7 + rnd() * 0.9)) : start < T0 ? Math.round(oe * rnd() * 0.8) : 0;
      const re = done ? 0 : Math.max(0, oe - ts) + (rnd() < 0.1 ? between(2, 16) : 0);
      const story = issue({ pk, summary: pick(STORIES), role: 'estimate', levelKey: 'story', type: { id: '10001', name: 'Story' }, parentId: ep.id, rootRef: ref, projectKey: pk,
        status: st(done ? 'done' : start < T0 ? 'indeterminate' : 'new'), team, assignee: rnd() > 0.05 ? person : null,
        start: rnd() > 0.06 ? isoOf(start) : null, due: rnd() > 0.04 ? isoOf(start + len) : null, oe, re, ts, note: null, fixVersionIds: vid && rnd() > 0.5 ? [vid] : [] });
      // worklogs: 2–8 h chunks between start and min(end, today), adding up to the time spent
      let left = ts;
      const span = Math.max(1, Math.min(len, T0 - start));
      while (left > 0) { const h = Math.min(left, between(2, 8)); story.worklogs.push({ a: story.assignee?.id || person.id, d: isoOf(start + Math.floor(rnd() * span)), h }); left -= h; }
      if (rnd() < 0.35) issue({ pk, summary: pick(SUBTASKS), role: 'tiny', levelKey: 'subtask', type: { id: '10003', name: 'Sub-task' }, parentId: story.id, rootRef: ref, status: st(done ? 'done' : 'new'), assignee: story.assignee });
    }
  }

  // ---------- dependencies, Blocked status ----------
  const open = issues.filter((i) => i.role === 'estimate' && i.status.cat !== 'done');
  const byRoot = new Map();
  for (const i of open) (byRoot.get(i.rootRef) || byRoot.set(i.rootRef, []).get(i.rootRef)).push(i);
  const nLinks = Math.round(open.length * 0.04);
  for (let k = 0; k < nLinks; k++) {
    const a = pick(open);
    const same = byRoot.get(a.rootRef);
    const b = rnd() < 0.6 && same.length > 1 ? pick(same) : pick(open);
    if (a === b) continue;
    const id = `l${k}`;
    a.links.push({ id, typeId: '10000', verb: 'blocks', inverse: 'is blocked by', outward: true, otherId: b.id });
    b.links.push({ id, typeId: '10000', verb: 'blocks', inverse: 'is blocked by', outward: false, otherId: a.id });
    if (rnd() > 0.5) b.note = pick(['Schnittstelle muss zuerst stehen.', 'Datenmodell wird geteilt.', 'Freigabe durch Security nötig.']);
  }
  for (const x of open) if (rnd() < 0.006) {
    x.status = { id: 'blk', name: 'Blocked', cat: 'new' };
    x.blockedSince = isoOf(T0 - between(1, 30));
    x.blockedReason = pick(['Wartet auf Freigabe der Security.', 'Testumgebung nicht verfügbar.', 'Fachbereich klärt die Anforderungen.']);
  }

  // ---------- capacity and absences ----------
  const people = {}, absences = [];
  for (const p of PEOPLE) {
    const t = teamOf.get(p.id) || TEAMS[0];
    const r = rnd();
    const e = { weeklyHours: r < 0.05 ? 20 : r < 0.2 ? 32 : 40, location: pick(LOCATIONS), teamId: t.id };
    if (rnd() < 0.05) { const other = pick(TEAMS); if (other.id !== t.id) e.teams = [{ teamId: t.id, pct: 60 }, { teamId: other.id, pct: 40 }]; }
    people[p.id] = e;
    const nAbs = between(0, 3);
    for (let k = 0; k < nAbs; k++) { const from = T0 + between(-60, 120); absences.push({ id: `a${absences.length + 1}`, accountId: p.id, from: isoOf(from), to: isoOf(from + between(0, 12)), type: rnd() < 0.8 ? 'vacation' : 'absent' }); }
  }
  const capacity = {
    people, absences,
    teams: Object.fromEntries(TEAMS.map((t, i) => [t.id, { name: t.name, dailyBusinessPct: 10 + (i % 4) * 5, internalPct: 5 + (i % 3) * 5, absenceRatePct: 8 + (i % 3) * 2 }])),
  };

  // ---------- support: tickets over 26 weeks, 2–4 % open ----------
  const supTeams = TEAMS.slice(0, Math.max(4, Math.round(TEAMS.length / 3)));
  const NOW = Date.parse(`${today}T10:00:00Z`);
  const tickets = [];
  const spentByTeamWeek = new Map(); // teamId → [26 weeks]
  for (let k = 0; k < S.tickets; k++) {
    const isOpen = rnd() < 0.03;
    const ageH = isOpen ? (rnd() < 0.15 ? between(72, 400) : between(1, 70)) : between(30, 26 * 7 * 24);
    const created = NOW - ageH * 3600e3;
    const resolved = isOpen ? null : created + (2 + rnd() * (rnd() < 0.08 ? 200 : 50)) * 3600e3;
    const [summary, comp, rt] = pick(TICKET_SUBJECTS);
    const team = pick(supTeams);
    const assignee = !isOpen || rnd() < 0.4 ? pick(members.get(team.id)) : null;
    const spentH = Math.round(clamp(logn(1, 0.9), 0.25, 16) * 4) / 4;
    const logDay = Math.min(T0, dayIdx(new Date(resolved || created).toISOString().slice(0, 10)));
    const w = Math.floor((T0 - logDay) / 7);
    if (w >= 0 && w < 26) { const a = spentByTeamWeek.get(team.id) || spentByTeamWeek.set(team.id, new Array(26).fill(0)).get(team.id); a[w] += spentH; }
    tickets.push({
      id: String(300000 + k), key: `SUP-${1000 + k}`, summary, priority: pick(PRIOS), created: new Date(created).toISOString(), resolved: resolved ? new Date(resolved).toISOString() : null,
      statusCat: isOpen ? (rnd() < 0.6 ? 'new' : 'indeterminate') : 'done', status: isOpen ? 'Offen' : 'Erledigt', labels: ['support'], components: [comp], requestType: rt,
      projectKey: 'SUP', assignee, team, spentH, jsm: null, links: [], services: [k % 5 === 0 ? '20002' : '20001'],
      worklogs: spentH ? [{ a: assignee?.id || null, d: isoOf(logDay), h: spentH }] : [],
    });
  }
  const teamsSup = supTeams.map((t) => {
    const a = spentByTeamWeek.get(t.id) || new Array(26).fill(0);
    const avg = a.slice(0, 4).reduce((x, y) => x + y, 0) / 4;
    const older = a.slice(4, 12).reduce((x, y) => x + y, 0) / 8;
    return { teamId: t.id, win: Math.round(a.slice(0, 8).reduce((x, y) => x + y, 0)), recent: 0, trend: a.slice(0, 8).reverse().map(Math.round), avg: Math.round(older * 10) / 10, recentAvg: Math.round(avg * 10) / 10, spike: avg > older * 1.3, weekly: Math.round(Math.max(avg, older) * 10) / 10 };
  });
  const done = tickets.filter((t) => t.resolved);
  const breached = done.filter((t) => Date.parse(t.resolved) - Date.parse(t.created) > 72 * 3600e3).length;
  const svc = (id, key, name, ts) => ({ id, key, name, met: ts.length - Math.round(ts.length * breached / Math.max(1, done.length)), breached: Math.round(ts.length * breached / Math.max(1, done.length)),
    open: ts.filter((t) => !t.resolved).length, openRe: ts.filter((t) => !t.resolved).length * 2, teams: teamsSup.map((t) => ({ teamId: t.teamId, avg: t.avg, recentAvg: t.recentAvg, spike: t.spike, weekly: t.weekly })),
    slaRate: 1 - breached / Math.max(1, done.length), health: 'atRisk' });
  const supportComputed = {
    averagingWeeks: 4, services: [svc('20001', 'SUP', 'IT-Support', tickets.filter((t) => t.services[0] === '20001')), svc('20002', 'NOC', 'Netz-Betrieb', tickets.filter((t) => t.services[0] === '20002'))],
    teams: teamsSup, reserveQuarter: Object.fromEntries(teamsSup.map((t) => [t.teamId, t.weekly * 12])), personWeekly: {},
    slaRate: 1 - breached / Math.max(1, done.length), slaTarget: 0.95, breaches: breached, health: 'atRisk', open: tickets.filter((t) => !t.resolved).length, openRe: tickets.filter((t) => !t.resolved).length * 2,
    hoursWindow: Math.round(teamsSup.reduce((a, t) => a + t.win, 0)), weeklyTotal: teamsSup.reduce((a, t) => a + t.weekly, 0),
  };

  return {
    today, config, portfolio, issues, external: [], versions, milestones, teams: TEAMS, people: Object.fromEntries(PEOPLE.map((p) => [p.id, p])),
    capacity, supportComputed, supportTickets: { truncated: false, tickets },
    meta: { size, seed: seed ?? S.seed, generator: 'tools/bigDataset.js' },
  };
}

// History as src/lib/history.js delivers it: done stories of the last months (estimate factors, similar work) and the
// resolved support tickets (support P80, recurring topics).
export function bigHistory(ds, { months = 12, supportMonths = 6 } = {}) {
  const T0 = dayIdx(ds.today);
  const since = T0 - Math.round(months * 30.4), supSince = T0 - Math.round(supportMonths * 30.4);
  const stories = ds.issues.filter((i) => i.role === 'estimate' && i.status?.cat === 'done' && i.due && dayIdx(i.due) >= since && dayIdx(i.due) < T0).map((i) => ({
    id: i.id, key: i.key, summary: i.summary, type: 'Story', projectKey: i.projectKey, components: [], labels: [], team: i.team, assignee: i.assignee?.id || null,
    oe: i.oe, ts: i.ts, created: i.start || i.due, start: i.start, resolved: i.due, parentId: i.parentId, parentKey: null, parentSummary: null, statusCat: 'done', commentCount: 0,
  })).sort((a, b) => b.resolved.localeCompare(a.resolved) || a.key.localeCompare(b.key));
  const support = (ds.supportTickets?.tickets || []).filter((t) => t.resolved && dayIdx(t.resolved.slice(0, 10)) >= supSince).map((t) => ({
    id: t.id, key: t.key, summary: t.summary, requestType: t.requestType, components: t.components, labels: t.labels, team: t.team, assignee: t.assignee?.id || null,
    spentH: t.spentH, created: t.created.slice(0, 10), resolved: t.resolved.slice(0, 10), statusCat: 'done', worklogs: t.worklogs,
  }));
  return { asOf: ds.today, months, supportMonths, since: isoOf(since), supportSince: isoOf(supSince), stories, support, truncated: { stories: false, support: false }, personLevel: true };
}

const ROLES = { admin: true, viewReport: true, manageRanking: true, editCapacity: true, dispatch: true, editPlan: true, rights: ['mine', 'portfolio', 'projects', 'teams', 'plan', 'hours', 'support', 'report'] };
export function bigCtx(size = 'S', { lang = 'de', today = BIG_TODAY, ds = null } = {}) {
  const d = ds || bigDataset(size, { today });
  const computed = computeAll(d);
  const me = d.people.u1 ? { id: 'u1', name: d.people.u1.name } : null;
  return { ds: d, computed, lang, me, roles: ROLES, history: bigHistory(d), planActual: null, now: Date.parse(`${d.today}T10:00:00Z`) };
}

export function summarize(ds) {
  const by = (role) => ds.issues.filter((i) => i.role === role).length;
  return { size: ds.meta?.size, workItems: ds.issues.length, workstreams: by('rough'), epics: by('structure'), stories: by('estimate'), subtasks: by('tiny'), projects: ds.portfolio.length, teams: ds.teams.length,
    people: Object.keys(ds.people).length, worklogs: ds.issues.reduce((a, i) => a + (i.worklogs?.length || 0), 0), links: ds.issues.reduce((a, i) => a + (i.links?.length || 0), 0) / 2,
    blocked: ds.issues.filter((i) => i.status?.name === 'Blocked').length, absences: ds.capacity.absences.length, tickets: ds.supportTickets.tickets.length, openTickets: ds.supportTickets.tickets.filter((t) => !t.resolved).length };
}

// CLI (Node only – the browser preview imports this module through tools/bigMock.js)
const argv = globalThis.process?.argv || [];
if (argv[1] && /bigDataset\.js$/.test(argv[1].replace(/\\/g, '/'))) {
  const size = (argv[2] || 'S').toUpperCase();
  const t0 = performance.now();
  const ds = bigDataset(size);
  const ms = performance.now() - t0;
  console.log(JSON.stringify({ ...summarize(ds), generateMs: Math.round(ms) }, null, 1));
  if (argv[3]) { const { writeFileSync } = await import('node:fs'); writeFileSync(argv[3], JSON.stringify(ds)); console.log(`written ${argv[3]}`); }
}
