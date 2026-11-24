// Local mock mode: 'planActual.get' with realistic demo data – the same people, teams and projects as lib/mock.js,
// eight completed weeks of plan snapshots and actuals, run through the server's own payload builder.
// Design states: ?pa=none (before the first snapshot) and ?pa=waiting (first plan saved, no actuals yet).
import { buildPayload, isoWeekOf, shiftWeek, weekRange } from '@shared/planActual.js';
import { isoOf, todayIdx } from '@shared/dates.js';

const TEAMS = { 't-web': 'Web', 't-ux': 'UX', 't-int': 'Integration', 't-mob': 'Mobile', 't-data': 'Data', 't-netz': 'Netz' };
const TEAM_IDS = Object.keys(TEAMS);
const PEOPLE = ['Anna Becker', 'Jonas Weber', 'Lea Hoffmann', 'Maximilian Schulz', 'Sophie Wagner', 'Paul Richter', 'Mia Klein', 'Felix Wolf', 'Emma Schröder', 'Noah Neumann', 'Hannah Schwarz', 'Elias Zimmermann', 'Lina Braun', 'Ben Krüger', 'Clara Hartmann', 'Luis Lange']
  .map((name, i) => ({ id: `u${i + 1}`, name, teamId: TEAM_IDS[(i + 1) % TEAM_IDS.length], weekly: i % 5 === 0 ? 32 : 40 }));
const PROJECTS = ['Kundenportal Relaunch', 'ERP-Anbindung', 'DSGVO-Löschkonzept', 'Mobile App 2.0', 'Datenplattform', 'Glasfaser-Netzausbau', 'Billing-Migration', 'CRM-Konsolidierung'];
const KEYS = ['KPR', 'ERP', 'DSG', 'MOB', 'DAT', 'NET', 'BIL', 'CRM'];
const REF = (i) => `issue:${9000 + i}`;
// which projects each team mainly works on (first = main project) and its weekly support reserve per person
const TEAM_PROJECTS = { 't-web': [0, 3], 't-ux': [0, 2], 't-int': [1, 6], 't-mob': [3, 7], 't-data': [4, 2], 't-netz': [5, 6] };
const SUP = { 't-web': 3, 't-ux': 1, 't-int': 7, 't-mob': 2, 't-data': 3, 't-netz': 5 };

function rng(seed) { // mulberry32: the same demo on every reload
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r1 = (n) => Math.round(n * 10) / 10;

export function mockPlanActual(payload = {}) {
  const demo = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('pa') : null;
  const cur = isoWeekOf(todayIdx()).key;
  const schedule = { day: 'mon', time: '06:00', keepMonths: 24 };
  if (demo === 'none') return buildPayload({ schedule });
  if (demo === 'waiting') return buildPayload({ plans: [{ week: cur, people: {} }], schedule });

  const projects = Object.fromEntries(PROJECTS.map((n, i) => [REF(i), { n, k: `${KEYS[i]}-1`, r: i + 1 }]));
  const names = Object.fromEntries(PEOPLE.map((p) => [p.id, p.name]));
  const plans = [], acts = [];
  for (let k = 8; k >= 1; k--) {
    const week = shiftWeek(cur, -k);
    const [a, b] = weekRange(week);
    const rnd = rng(a * 31 + 7);
    const planPeople = {}, actPeople = {};
    for (const p of PEOPLE) {
      const [pa, pb] = TEAM_PROJECTS[p.teamId];
      const avail = p.weekly * 0.8, sup = SUP[p.teamId];
      const main = (avail - sup) * (0.6 + rnd() * 0.15), side = avail - sup - main;
      const plan = { [REF(pa)]: main, [REF(pb)]: side, SUP: sup };
      const book = Object.fromEntries(Object.entries(plan).map(([x, h]) => [x, h * (0.96 + rnd() * 0.07)]));
      let absU = 0;
      // what usually happens instead of the plan
      const r = rnd(), h = 4 + Math.round(rnd() * 10);
      if (r < 0.2 || (p.teamId === 't-int' && r < 0.4)) { book[REF(pa)] -= h; book.SUP += h; }
      else if (r < 0.3) { const other = REF(TEAM_PROJECTS[TEAM_IDS[(TEAM_IDS.indexOf(p.teamId) + 2) % TEAM_IDS.length]][0]); book[REF(pa)] -= h; book[other] = (book[other] || 0) + h; }
      else if (r < 0.38) { book[REF(pb)] -= Math.min(h, book[REF(pb)]); book.INT = (book.INT || 0) + h; }
      else if (r < 0.45) { book[REF(pa)] -= 8; absU = 8; }
      planPeople[p.id] = { t: p.teamId, p: Object.fromEntries(Object.entries(plan).map(([x, v]) => [x, r1(v)])), absP: k % 4 === p.weekly % 3 ? 8 : 0 };
      actPeople[p.id] = { t: p.teamId, b: Object.fromEntries(Object.entries(book).map(([x, v]) => [x, r1(Math.max(0, v))])), ...(absU ? { absU } : {}) };
    }
    plans.push({ week, from: isoOf(a), to: isoOf(b), at: `${isoOf(a)}T05:00:00.000Z`, projects, teams: TEAMS, names, people: planPeople });
    acts.push({ week, final: k > 1, people: actPeople, over: k <= 2 ? [
      { ref: REF(1), key: 'ERP-118', t: 't-int', extra: 14, oe: 40 }, { ref: REF(1), key: 'ERP-124', t: 't-int', extra: 6, oe: 24 },
      { ref: REF(0), key: 'KPR-109', t: 't-web', extra: 9, oe: 32 }, { ref: REF(3), key: 'MOB-142', t: 't-mob', extra: 5, oe: 16 },
    ] : [] });
  }
  plans.push({ week: cur, people: {} });
  // demo privacy: people of team "Netz" are only visible as a sum
  return buildPayload({ plans, acts, weeks: payload?.weeks, team: payload?.team, canSee: (t) => t !== 't-netz', schedule });
}
