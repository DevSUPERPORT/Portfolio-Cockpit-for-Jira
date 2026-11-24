// Plan vs. Ist (UC-04): what the weekly plan said against where the hours were actually booked.
//
// The plan is frozen once a week by the snapshot job (src/lib/snapshot.js): per person and bucket the hours of
// that ISO week – bucket = a portfolio project's root ref, 'SUP' (the person's support reserve) or 'INT' (planned
// internal work without a project). A week later the job adds the week's actuals (worklogs per person and bucket)
// and the absence hours that were not known when the plan was taken ("unplanned absence").
//
// Everything here is pure and shared by the server (building the payload), the UI (the analysis and its wording),
// the local mock and the tests:
//   validSnapshot / snapshotDue / isoWeekOf / weekRange – schedule and calendar
//   attribute       – where one person's missing project hours went in one week
//   buildPayload    – stored week records → the 'planActual.get' payload (privacy: people only for visible teams)
//   analyzePlanActual – payload → KPIs, flow rows, people rows and "why" sentences (DE/EN)
import { mondayOf, ymdIdx, yearOf, isoOf } from './dates.js';

const EPS = 0.01;
const r1 = (n) => Math.round((n || 0) * 10) / 10;
const sumVals = (o) => Object.values(o || {}).reduce((a, v) => a + (v || 0), 0);
const addTo = (o, k, v) => { if (v) o[k] = (o[k] || 0) + v; };
export const isProjectKey = (k) => k !== 'SUP' && k !== 'INT';

// ---------- schedule ----------
export const SNAPSHOT_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const SNAPSHOT_TIMES = ['06:00', '08:00', '12:00', '18:00'];
export const SNAPSHOT_KEEP = [12, 24, 36];
export const SNAPSHOT_DEFAULTS = Object.freeze({ day: 'mon', time: '06:00', keepMonths: 24 });
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
// cfg.snapshot, read with defaults (every invalid field falls back to its default).
export function validSnapshot(input) {
  const x = input && typeof input === 'object' ? input : {};
  return {
    day: SNAPSHOT_DAYS.includes(x.day) ? x.day : SNAPSHOT_DEFAULTS.day,
    time: TIME_RE.test(String(x.time || '')) ? x.time : SNAPSHOT_DEFAULTS.time,
    keepMonths: SNAPSHOT_KEEP.includes(+x.keepMonths) ? +x.keepMonths : SNAPSHOT_DEFAULTS.keepMonths,
  };
}

// ISO 8601 week of a day index: weeks start on Monday, week 1 holds the year's first Thursday.
export function isoWeekOf(idx) {
  const mon = mondayOf(idx), thu = mon + 3, y = yearOf(thu);
  const w = Math.floor((thu - ymdIdx(y, 1, 1)) / 7) + 1;
  return { key: `${y}-W${String(w).padStart(2, '0')}`, year: y, week: w, from: mon, to: mon + 6 };
}
export function weekRange(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const from = mondayOf(ymdIdx(+m[1], 1, 4)) + (+m[2] - 1) * 7;
  return [from, from + 6];
}
export const shiftWeek = (key, n) => isoWeekOf(weekRange(key)[0] + n * 7).key;
export const weekNo = (key) => +String(key).slice(-2);

// Is this week's snapshot due? local = { day: day index, min: minutes after midnight } in the site's time zone.
export function snapshotDue(settings, local) {
  const s = validSnapshot(settings);
  const dueDay = mondayOf(local.day) + SNAPSHOT_DAYS.indexOf(s.day);
  const [hh, mm] = s.time.split(':').map(Number);
  const due = local.day > dueDay || (local.day === dueDay && local.min >= hh * 60 + mm);
  return { due, week: isoWeekOf(local.day).key, dueDay, nextDay: due ? dueDay + 7 : dueDay, time: s.time, nextIso: isoOf(due ? dueDay + 7 : dueDay) };
}

// ---------- attribution ----------
// One person, one week: each project that got fewer hours than planned ("deficit") is explained by the hours that
// went elsewhere instead – support above the reserve, internal work, other projects above their plan, unplanned
// absence. The sources are shared among the deficits in proportion to their size and never exceed them.
export function attribute(plan = {}, book = {}, absU = 0) {
  const deficit = {};
  for (const [k, p] of Object.entries(plan)) {
    if (!isProjectKey(k)) continue;
    const d = (p || 0) - (book[k] || 0);
    if (d > EPS) deficit[k] = d;
  }
  const sources = {};
  for (const k of new Set([...Object.keys(plan), ...Object.keys(book)])) {
    const s = (book[k] || 0) - (plan[k] || 0);
    if (s > EPS) sources[k] = s;
  }
  if (absU > EPS) sources.ABS = absU;
  const totalD = sumVals(deficit), totalS = sumVals(sources);
  const causes = {};
  if (totalD > 0 && totalS > 0) {
    const scale = Math.min(1, totalD / totalS);
    for (const [k, d] of Object.entries(deficit)) {
      causes[k] = {};
      for (const [c, h] of Object.entries(sources)) causes[k][c] = (h * d * scale) / totalD;
    }
  }
  return { deficit, causes };
}

// ---------- people split across teams (UC-14) ----------
// A stored person record carries its main team `t` and – only when split – `teams: [{ t, pct }]`. splitOf gives the
// shares 0–1 that always add up to 1: a share not given to any team stays with the main team, so every hour lands in
// exactly one team. One team → [{ t: main, s: 1 }] (the old behaviour).
export function splitOf(u) {
  const main = u?.teamId ?? u?.t ?? '_none';
  const list = (Array.isArray(u?.teams) ? u.teams : []).filter((x) => x && x.t && +x.pct > 0).map((x) => ({ t: x.t, s: Math.min(100, +x.pct) / 100 }));
  if (!list.length) return [{ t: main, s: 1 }];
  const total = list.reduce((a, x) => a + x.s, 0);
  if (total > 1) return list.map((x) => ({ t: x.t, s: x.s / total }));
  if (1 - total > 1e-9) { const m = list.find((x) => x.t === main); if (m) m.s += 1 - total; else list.push({ t: main, s: 1 - total }); }
  return list;
}
export const shareInTeam = (u, t) => splitOf(u).reduce((a, x) => a + (x.t === t ? x.s : 0), 0);
const scaleMap = (o, s) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, (v || 0) * s]));
// A person unit's part in one team: every hour × share (plan, bookings, absence, deficits, causes).
export function scaleUnit(u, s, teamId) {
  if (s === 1 && teamId === u.teamId) return u;
  return { ...u, teamId, share: s, plan: scaleMap(u.plan, s), book: scaleMap(u.book, s), absU: (u.absU || 0) * s, absP: (u.absP || 0) * s,
    deficit: scaleMap(u.deficit, s), causes: Object.fromEntries(Object.entries(u.causes || {}).map(([k, c]) => [k, scaleMap(c, s)])) };
}

// ---------- payload (server and mock) ----------
// plans: [{ week, from, to, at, projects: {ref:{n,k,r}}, teams: {id:name}, names: {id:name}, people: {id:{t,p,absP}} }]
// acts:  [{ week, at, final, people: {id:{t,b,absU}}, over: [{ref,key,t,extra,oe}] }]
// canSee(teamId) – may this user see individual people of that team? (false → one "sum only" unit per team)
export function buildPayload({ plans = [], acts = [], weeks = 4, team = 'all', canSee = () => false, schedule = SNAPSHOT_DEFAULTS, teamNames: extraNames = null } = {}) {
  const n = weeks === 8 ? 8 : 4;
  const sched = validSnapshot(schedule);
  const actBy = new Map(acts.map((a) => [a.week, a]));
  const sorted = [...plans].sort((a, b) => a.week.localeCompare(b.week));
  const done = sorted.filter((p) => actBy.has(p.week)).slice(-n);
  const pending = sorted.filter((p) => !actBy.has(p.week)).map((p) => p.week);
  const base = { schedule: sched, team: team || 'all', firstWeek: sorted[0]?.week || null, pending };
  if (!sorted.length) return { ...base, state: 'none', weeks: [], teams: [], projects: {}, units: [], over: [] };
  if (!done.length) return { ...base, state: 'waiting', weeks: [], teams: [], projects: {}, units: [], over: [] };

  const projects = {}, teamNames = {}, names = {};
  for (const p of done) {
    for (const [ref, x] of Object.entries(p.projects || {})) projects[ref] = { name: x.n ?? x.name ?? ref, key: x.k ?? x.key ?? null, rank: x.r ?? x.rank ?? null };
    Object.assign(teamNames, p.teams || {});
    Object.assign(names, p.names || {});
  }
  const people = new Map();
  for (const p of done) {
    const a = actBy.get(p.week);
    for (const id of new Set([...Object.keys(p.people || {}), ...Object.keys(a.people || {})])) {
      const pp = p.people?.[id] || {}, aa = a.people?.[id] || {};
      const plan = pp.p || {}, book = aa.b || {}, absU = aa.absU || 0;
      if (sumVals(plan) < EPS && sumVals(book) < EPS && absU < EPS) continue;
      const u = people.get(id) || people.set(id, { id, teamId: '_none', teams: null, plan: {}, book: {}, absU: 0, absP: 0, deficit: {}, causes: {} }).get(id);
      const src = aa.t ? aa : pp.t ? pp : null; // the newest week wins (main team and split)
      if (src) { u.teamId = src.t; u.teams = Array.isArray(src.teams) && src.teams.length ? src.teams : null; }
      u.teamId = u.teamId || '_none';
      for (const [k, h] of Object.entries(plan)) addTo(u.plan, k, h);
      for (const [k, h] of Object.entries(book)) addTo(u.book, k, h);
      u.absU += absU; u.absP += pp.absP || 0;
      const at = attribute(plan, book, absU);
      for (const [k, d] of Object.entries(at.deficit)) addTo(u.deficit, k, d);
      for (const [k, cs] of Object.entries(at.causes)) { const c = u.causes[k] || (u.causes[k] = {}); for (const [x, h] of Object.entries(cs)) addTo(c, x, h); }
    }
  }
  const teamIds = [...new Set([...people.values()].flatMap((u) => splitOf(u).map((x) => x.t)))];
  const teams = teamIds.map((id) => ({ id, name: id === '_none' ? null : (teamNames[id] && teamNames[id] !== id ? teamNames[id] : extraNames?.[id]) || teamNames[id] || id }))
    .sort((a, b) => (a.id === '_none') - (b.id === '_none') || String(a.name).localeCompare(String(b.name), 'de'));
  const inTeam = (t) => !team || team === 'all' || t === team;
  const units = [];
  const agg = new Map();
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r1(v)]).filter(([, v]) => v));
  for (const u of people.values()) {
    const split = splitOf(u);
    if (!split.some((x) => inTeam(x.t))) continue;
    // individual rows by the main team's clearance; the analysis splits them when a team is selected (scaleUnit)
    if (canSee(u.teamId === '_none' ? null : u.teamId)) {
      units.push({ id: u.id, kind: 'person', teamId: u.teamId, ...(u.teams ? { teams: u.teams } : {}), name: names[u.id] || null, plan: round(u.plan), book: round(u.book), absU: r1(u.absU), absP: r1(u.absP),
        deficit: round(u.deficit), causes: Object.fromEntries(Object.entries(u.causes).map(([k, c]) => [k, round(c)])) });
      continue;
    }
    // "sum only": a split person adds to every team's sum × their share there
    for (const { t: tid, s } of split) {
      if (!inTeam(tid)) continue;
      const t = agg.get(tid) || agg.set(tid, { id: `team:${tid}`, kind: 'team', teamId: tid, name: null, n: 0, plan: {}, book: {}, absU: 0, absP: 0, deficit: {}, causes: {}, affected: {} }).get(tid);
      t.n++;
      for (const [k, h] of Object.entries(u.plan)) addTo(t.plan, k, h * s);
      for (const [k, h] of Object.entries(u.book)) addTo(t.book, k, h * s);
      t.absU += u.absU * s; t.absP += u.absP * s;
      for (const [k, d] of Object.entries(u.deficit)) { addTo(t.deficit, k, d * s); if (d * s >= 1) addTo(t.affected, k, 1); }
      for (const [k, cs] of Object.entries(u.causes)) { const c = t.causes[k] || (t.causes[k] = {}); for (const [x, h] of Object.entries(cs)) addTo(c, x, h * s); }
    }
  }
  for (const t of agg.values()) {
    units.push({ ...t, plan: round(t.plan), book: round(t.book), absU: r1(t.absU), absP: r1(t.absP), deficit: round(t.deficit),
      causes: Object.fromEntries(Object.entries(t.causes).map(([k, c]) => [k, round(c)])) });
  }
  // tasks with extra effort: the newest state of each task booked in the period
  const overBy = new Map();
  for (const p of done) for (const o of actBy.get(p.week).over || []) overBy.set(o.key, o);
  const over = [...overBy.values()].filter((o) => inTeam(o.t || '_none')).map((o) => ({ ref: o.ref, key: o.key, teamId: o.t || '_none', extra: r1(o.extra), oe: r1(o.oe) }))
    .sort((a, b) => b.extra - a.extra);
  return {
    ...base, state: 'ready', teams, projects, units, over,
    weeks: done.map((p) => ({ key: p.week, from: p.from, to: p.to, final: actBy.get(p.week).final !== false })),
    takenAt: done.at(-1)?.at || null,
  };
}

// The ranks the viewer's Portfolio shows (portfolio: the dataset's items, dense ranks over what the viewer may see) –
// one source for both views. A project that is not in that list is "no longer in the portfolio" (rank null); the
// server already left out every project the viewer may not browse (src/lib/snapshot.js scopeWeekRecords).
export function withPortfolioRanks(data, portfolio) {
  if (!data?.projects || !Array.isArray(portfolio) || !portfolio.length) return data;
  const rank = new Map(portfolio.map((p) => [p.ref, p.rank ?? null]));
  return { ...data, projects: Object.fromEntries(Object.entries(data.projects).map(([ref, x]) => [ref, { ...x, rank: rank.get(ref) ?? null }])) };
}

// ---------- analysis (UI) ----------
export const SIG_HOURS = 4, SIG_SHARE = 0.05, OVER_FACTOR = 1.1;
// A difference worth pointing at: at least 4 h AND at least 5 % of the plan.
export const isSignificant = (d, plan) => Math.abs(d) >= SIG_HOURS && (plan > EPS ? Math.abs(d) / plan : 1) >= SIG_SHARE;

const T = {
  de: {
    sup: 'Support', supSub: 'Reserve laut Support-Auswertung', int: 'Ohne Projekt (intern)', intSub: 'Buchungen ohne Projektbezug', rank: (r) => `Rang ${r}`, noRank: 'nicht mehr im Portfolio',
    unplanned: 'ungeplant', asPlanned: 'wie geplant', absent: 'abwesend', noTeam: 'Ohne Team', sumOnly: (t, n) => `${t} · nur Summe (${n} ${n === 1 ? 'Person' : 'Personen'})`, unknown: 'Unbekannt',
    cause: { SUP: 'Support über Reserve', ABS: 'ungeplant abwesend', INT: 'intern ohne Projekt', OTHER: 'anderswo', REST: 'weniger gebucht als möglich', into: (n) => `in ${n}` },
    chip: { into: (n) => `→ ${n}` },
    who: (names, hidden) => `Betroffen: ${[...names.slice(0, 4), ...(names.length > 4 ? [`${names.length - 4} weitere`] : []), ...(hidden ? [`${hidden} ${hidden === 1 ? 'Person' : 'Personen'} aus anderen Teams`] : [])].join(', ')}`,
    over: 'Mehraufwand gegenüber Schätzung: ', planBook: (p, b) => `${p} geplant, ${b} gebucht`, period: (a, b) => (a === b ? `KW ${a}` : `KW ${a}–${b}`),
  },
  en: {
    sup: 'Support', supSub: 'Reserve from the support analysis', int: 'No project (internal)', intSub: 'Bookings without a project', rank: (r) => `Rank ${r}`, noRank: 'no longer in the portfolio',
    unplanned: 'unplanned', asPlanned: 'as planned', absent: 'absent', noTeam: 'No team', sumOnly: (t, n) => `${t} · sum only (${n} ${n === 1 ? 'person' : 'people'})`, unknown: 'Unknown',
    cause: { SUP: 'support above reserve', ABS: 'unplanned absence', INT: 'internal work without a project', OTHER: 'elsewhere', REST: 'booked less than possible', into: (n) => `into ${n}` },
    chip: { into: (n) => `→ ${n}` },
    who: (names, hidden) => `Affected: ${[...names.slice(0, 4), ...(names.length > 4 ? [`${names.length - 4} more`] : []), ...(hidden ? [`${hidden} ${hidden === 1 ? 'person' : 'people'} from other teams`] : [])].join(', ')}`,
    over: 'Extra effort against the estimate: ', planBook: (p, b) => `${p} planned, ${b} booked`, period: (a, b) => (a === b ? `W ${a}` : `W ${a}–${b}`),
  },
};
export function hoursText(v, lang = 'de') {
  return `${new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'de-DE', { maximumFractionDigits: 0 }).format(Math.round(v || 0))} h`;
}
export function signedHours(v, lang = 'de') {
  const r = Math.round(v || 0);
  return r > 0 ? `+${hoursText(r, lang)}` : r < 0 ? `−${hoursText(-r, lang)}` : '±0 h';
}

// data: the 'planActual.get' payload. summaryOf(key) (optional): the task summary as the viewer may see it.
export function analyzePlanActual(data, { lang = 'de', summaryOf = () => null, team } = {}) {
  const L = T[lang === 'en' ? 'en' : 'de'];
  const sel = team || data?.team || 'all';
  const inTeam = (t) => sel === 'all' || t === sel;
  // a person split across teams counts in the selected team × their share there (sum rows are split already)
  const units = (data?.units || []).flatMap((u) => {
    if (sel === 'all' || u.kind !== 'person') return inTeam(u.teamId) ? [u] : [];
    const s = shareInTeam(u, sel);
    return s > 0 ? [scaleUnit(u, s, sel)] : [];
  });
  const projects = data?.projects || {};
  const teamName = (id) => (id === '_none' || !id ? L.noTeam : (data?.teams || []).find((t) => t.id === id)?.name || id);
  const bucketName = (k) => (k === 'SUP' ? L.sup : k === 'INT' ? L.int : projects[k]?.name || k);
  const order = (k) => (k === 'SUP' ? -1 : k === 'INT' ? 1e9 : projects[k]?.rank ?? 1e8);
  const H = (v) => hoursText(v, lang), S = (v) => signedHours(v, lang);

  // flow rows: per bucket over all units
  const plan = {}, book = {};
  let absU = 0;
  for (const u of units) {
    for (const [k, h] of Object.entries(u.plan || {})) addTo(plan, k, h);
    for (const [k, h] of Object.entries(u.book || {})) addTo(book, k, h);
    absU += u.absU || 0;
  }
  const keys = [...new Set([...Object.keys(plan), ...Object.keys(book)])].filter((k) => (plan[k] || 0) >= 0.5 || (book[k] || 0) >= 0.5)
    .sort((a, b) => order(a) - order(b) || bucketName(a).localeCompare(bucketName(b), 'de'));
  const rows = keys.map((k) => {
    const pl = plan[k] || 0, bo = book[k] || 0, d = bo - pl;
    const sig = isSignificant(d, pl);
    const kind = k === 'SUP' ? 'support' : k === 'INT' ? 'internal' : 'project';
    return {
      key: k, kind, name: bucketName(k), rank: projects[k]?.rank ?? null,
      sub: kind === 'support' ? L.supSub : kind === 'internal' ? L.intSub : projects[k]?.rank != null ? L.rank(projects[k].rank) : L.noRank,
      plan: pl, book: bo, diff: d, share: pl > EPS ? d / pl : null, sig, unplanned: pl < 0.5 && bo >= 0.5,
      tone: !sig ? 'neutral' : d < 0 && kind === 'project' ? 'short' : d > 0 ? 'over' : 'neutral',
    };
  });
  const planT = rows.reduce((a, r) => a + r.plan, 0), bookT = rows.reduce((a, r) => a + r.book, 0);
  const asPlanned = rows.reduce((a, r) => a + Math.min(r.plan, r.book), 0);
  const divertedBooked = rows.reduce((a, r) => a + Math.max(0, r.book - r.plan), 0);
  const diverted = divertedBooked + absU;
  const kpis = {
    plan: planT, book: bookT, asPlanned, asPlannedPct: planT > EPS ? asPlanned / planT : null,
    diverted, divertedBooked, absU, divertedHot: planT > EPS && diverted > planT * SIG_SHARE,
  };

  // people rows (visible people; other teams as one "sum only" row each)
  const people = units.map((u) => {
    const pl = sumVals(u.plan), bo = sumVals(u.book);
    const asP = Object.keys(u.plan || {}).reduce((a, k) => a + Math.min(u.plan[k] || 0, u.book?.[k] || 0), 0);
    const all = [...new Set([...Object.keys(u.plan || {}), ...Object.keys(u.book || {})])].map((k) => ({ k, d: (u.book?.[k] || 0) - (u.plan?.[k] || 0) }));
    const downs = all.filter((x) => x.d < -2).sort((a, b) => a.d - b.d);
    const ups = all.filter((x) => x.d > 2).sort((a, b) => b.d - a.d);
    const main = downs.length
      ? `${bucketName(downs[0].k)} ${S(downs[0].d)}${ups.length ? ` → ${ups.slice(0, 2).map((x) => `${bucketName(x.k)} ${S(x.d)}`).join(', ')}` : u.absU > 2 ? ` → ${L.absent} ${H(u.absU)}` : ''}`
      : L.asPlanned;
    return {
      id: u.id, kind: u.kind, teamId: u.teamId, teamName: teamName(u.teamId), n: u.n || 1,
      name: u.kind === 'team' ? L.sumOnly(teamName(u.teamId), u.n || 0) : u.name || L.unknown,
      plan: pl, book: bo, asPlanned: asP, pct: pl > EPS ? asP / pl : null, absU: u.absU || 0, main, deviates: downs.length > 0,
    };
  }).sort((a, b) => (a.kind === 'team') - (b.kind === 'team') || (a.pct ?? 2) - (b.pct ?? 2) || b.plan - a.plan);

  // why: every project with a significant shortfall
  const label = (k) => (L.cause[k] ? L.cause[k] : L.cause.into(bucketName(k)));
  const chipLabel = (k) => (L.cause[k] ? L.cause[k] : L.chip.into(bucketName(k)));
  const why = rows.filter((r) => r.kind === 'project' && r.diff < 0 && r.sig).sort((a, b) => a.diff - b.diff).map((r) => {
    let need = -r.diff;
    const pool = {};
    for (const u of units) for (const [c, h] of Object.entries(u.causes?.[r.key] || {})) addTo(pool, c, h);
    const parts = [];
    let other = 0;
    for (const [c, h] of Object.entries(pool).sort((a, b) => b[1] - a[1])) {
      if (need <= 0.5) break;
      const x = Math.min(need, h);
      need -= x;
      if (x >= 2) parts.push({ k: c, h: x }); else other += x; // small causes are folded into "elsewhere"
    }
    if (other >= 1) parts.push({ k: 'OTHER', h: other });
    if (need > 2) parts.push({ k: 'REST', h: need });
    const vis = units.filter((u) => u.kind === 'person' && (u.deficit?.[r.key] || 0) >= 1).sort((a, b) => b.deficit[r.key] - a.deficit[r.key]);
    const hidden = units.filter((u) => u.kind === 'team').reduce((a, u) => a + (u.affected?.[r.key] || 0), 0);
    const names = vis.map((u) => u.name || L.unknown);
    const over = (data?.over || []).filter((o) => o.ref === r.key && inTeam(o.teamId) && o.extra > 0).slice(0, 6).map((o) => ({ ...o, summary: summaryOf(o.key) || null }));
    return {
      key: r.key, name: r.name, rank: r.rank, rankText: r.sub, plan: r.plan, book: r.book, diff: r.diff, planBook: L.planBook(H(r.plan), H(r.book)),
      sentence: `${r.name} ${S(r.diff)}: ${parts.map((x) => `${H(x.h)} ${label(x.k)}`).join(', ')}.`,
      parts: parts.map((x) => ({ k: x.k, h: x.h, label: label(x.k), chip: `${chipLabel(x.k)} ${H(x.h)}`, soft: x.k === 'SUP' || x.k === 'ABS' || x.k === 'REST' })),
      who: names, whoHidden: hidden, whoText: names.length || hidden ? L.who(names, hidden) : '',
      over, overText: over.length ? L.over + over.map((o) => `${o.key}${o.summary ? ` ${o.summary}` : ''} (+${H(o.extra)})`).join(' · ') : '',
    };
  });

  const wk = data?.weeks || [];
  const period = wk.length ? L.period(weekNo(wk[0].key), weekNo(wk.at(-1).key)) : '';
  return { kpis, rows, max: Math.max(1, ...rows.map((r) => Math.max(r.plan, r.book))), people, why, period, provisional: wk.filter((w) => !w.final).map((w) => w.key) };
}
