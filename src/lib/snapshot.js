// Plan vs. Ist (UC-04): the weekly plan snapshot and the read function behind the "Plan vs. Ist" tab.
//
// Resolver (to be registered in src/index.js):  'planActual.get'
//   payload: { weeks: 4 | 8, team: '<teamId>' | 'all' }
//   returns: the payload of buildPayload() in shared/planActual.js –
//     { state: 'none' | 'waiting' | 'ready', schedule: { day, time, keepMonths }, firstWeek, pending: ['2026-W46'],
//       weeks: [{ key, from, to, final }], team, teams: [{ id, name }], projects: { ref: { name, key, rank } },
//       units: [{ id, kind: 'person' | 'team', teamId, name, n?, plan: {bucket: h}, book: {bucket: h}, absU, absP,
//                 deficit: {ref: h}, causes: {ref: {cause: h}}, affected? }],
//       over: [{ ref, key, teamId, extra, oe }], takenAt }
//   Individual people only for teams where ctx.canSeePerson(teamId) is true (default: none); everyone else is
//   summed into one "sum only" unit per team. No names of hidden people and no work-item summaries leave the server.
//
// Scheduled job: runSnapshotJob({ now }) – call it from an HOURLY trigger. It acts once per ISO week, as soon as
// the configured day and time (cfg.snapshot = { day: 'mon'..'fri', time: 'HH:MM', keepMonths: 12 | 24 | 36 },
// default Monday 06:00, 24 months) have passed in the site's time zone. Marker 'snap:last' makes it idempotent.
//   1. actuals of the last two completed weeks that have a plan (worklogs per person × bucket, unplanned absence,
//      tasks with extra effort) – the older week once more, so bookings made after the week still count;
//   2. the plan of the current week per person × bucket: Original Estimate of each open story spread over the
//      working days between start and due date (the engine's spreadWindow/shareIn), the person's support reserve
//      and planned internal work (personWeek in shared/team.js), plus the absences known now;
//   3. retention: weeks older than keepMonths are deleted.
// Storage: 'snap:<YYYY-Www>' (plan) and 'snap:<YYYY-Www>:act' (actuals), split into '<key>#1..n' when a value
// would exceed ~200 KB. Everything runs as the app; the data reaches users only through planActual().
import { buildModel, capacityPeople, spreadWindow, weekShare, supportMetrics, ancestor } from '../../shared/engine.js';
import { logWarn } from './safeLog.js';
import { personWeek } from '../../shared/team.js';
import { allocationOf } from '../../shared/allocation.js';
import { dayIdx, isoOf, ymdIdx, workdays, mondayOf } from '../../shared/dates.js';
import { capacityFill } from '../../shared/weekPlan.js';
import { validSnapshot, snapshotDue, weekRange, shiftWeek, buildPayload } from '../../shared/planActual.js';
import { maintenanceMode } from './maintenance.js';

export const DEFAULT_TZ = 'Europe/Berlin';
export const LAST = 'snap:last';
export const planKey = (week) => `snap:${week}`;
export const actKey = (week) => `snap:${week}:act`;
const MAX_VALUE = 200_000; // Forge KVS allows 240 KiB per value
const MAX_LOGS = 60000;
const EPS = 0.01;
const r1 = (n) => Math.round((n || 0) * 10) / 10;
const addTo = (o, k, v) => { if (v) o[k] = (o[k] || 0) + v; };
const roundMap = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r1(v)]).filter(([, v]) => v));
// A person's main team and – only when split across teams (UC-14) – the shares: { t, teams?: [{ t, pct }] }.
// buildPayload (shared/planActual.js) counts the person in each team × share; one team keeps the old record.
export function teamRecord(p) {
  const t = p?.teamId || '_none';
  const list = allocationOf(p);
  if (list.length < 2) return { t };
  return { t, teams: list.map((x) => ({ t: x.teamId, pct: Math.round(x.pct * 10) / 10 })) };
}
const isOpen = (i) => (i?.status?.cat ?? i?.statusCat ?? 'new') !== 'done';

// ---------- time zone ----------
const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
// Local day index and minutes after midnight of an instant in a time zone.
export function localNow(nowMs, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  return { day: ymdIdx(+p.year, +p.month, +p.day), min: (+p.hour % 24) * 60 + +p.minute };
}
// The site's default time zone (Jira's server info), Europe/Berlin when Jira does not tell.
let tzCache = null;
export async function siteTimeZone() {
  if (tzCache && Date.now() - tzCache.at < 6 * 3600e3) return tzCache.tz;
  let tz = null;
  try {
    const { jira } = await import('./jira.js');
    const si = await jira('app', '/rest/api/3/serverInfo');
    const v = si?.serverTimeZone;
    tz = typeof v === 'string' ? v : v?.ID || v?.id || null;
  } catch { /* fall back */ }
  if (!tz || !validTz(tz)) tz = DEFAULT_TZ;
  tzCache = { tz, at: Date.now() };
  return tz;
}
async function resolveTimeZone(dep, cfg) {
  if (typeof dep === 'string') return validTz(dep) ? dep : DEFAULT_TZ;
  if (typeof dep === 'function') { try { const t = await dep(cfg); if (t && validTz(t)) return t; } catch { /* fall back */ } return DEFAULT_TZ; }
  if (cfg?.snapshot?.timeZone && validTz(cfg.snapshot.timeZone)) return cfg.snapshot.timeZone;
  return siteTimeZone();
}

// ---------- storage ----------
async function defaultStore() {
  const s = await import('./store.js');
  return { get: (k) => s.get(k), set: (k, v) => s.set(k, v), del: (k) => s.del(k) };
}
// One record per key; when it would be too large, its people are split (team by team) into '<key>#1..n'.
export async function putRecord(store, key, rec) {
  const prev = await store.get(key);
  const prevParts = prev?.parts || 0;
  let parts = 0;
  if (JSON.stringify(rec).length > MAX_VALUE) {
    const entries = Object.entries(rec.people || {}).sort((a, b) => String(a[1].t).localeCompare(String(b[1].t)));
    const chunks = [];
    let cur = {}, size = 0;
    for (const [id, v] of entries) {
      const s = JSON.stringify(v).length + id.length + 8;
      if (size + s > MAX_VALUE * 0.9 && size > 0) { chunks.push(cur); cur = {}; size = 0; }
      cur[id] = v; size += s;
    }
    if (size) chunks.push(cur);
    for (let i = 0; i < chunks.length; i++) await store.set(`${key}#${i + 1}`, { people: chunks[i] });
    parts = chunks.length;
    await store.set(key, { ...rec, people: {}, parts });
  } else {
    await store.set(key, rec);
  }
  for (let i = parts + 1; i <= prevParts; i++) await store.del(`${key}#${i}`);
  return parts;
}
export async function getRecord(store, key) {
  const r = await store.get(key);
  if (!r) return null;
  if (r.parts) {
    const people = { ...(r.people || {}) };
    for (let i = 1; i <= r.parts; i++) Object.assign(people, (await store.get(`${key}#${i}`))?.people || {});
    const { parts, ...rest } = r; // eslint-disable-line no-unused-vars
    return { ...rest, people };
  }
  return r;
}
async function delRecord(store, key) {
  const r = await store.get(key);
  for (let i = 1; i <= (r?.parts || 0); i++) await store.del(`${key}#${i}`);
  await store.del(key);
}

// ---------- plan and actuals (pure) ----------
const computedOf = (ds) => {
  const model = buildModel(ds);
  return { model, support: ds.supportComputed ?? supportMetrics(ds.support, ds.today) };
};

// The plan of the week [a, b] per person × bucket.
export function computePlan(ds, a, b) {
  const computed = computedOf(ds);
  const { model, support } = computed;
  const people = capacityPeople(model);
  const out = {};
  const unassigned = {};
  const P = (id) => out[id] || (out[id] = { ...teamRecord(people.get(id)), p: {} });
  // admin default rules.distribution 'capacity': the same front-filled split the board shows (current week on)
  const fill = model.rule === 'capacity' && a >= mondayOf(model.today) ? capacityFill(model, support, ds.issues || [], { today: model.today, evenIds: ds.planEven }) : null; // per-task 'even' overrides too
  for (const s of ds.issues || []) {
    if (s.role !== 'estimate' || !s.oe || !isOpen(s) || !model.itemByRef.has(s.rootRef)) continue;
    const win = spreadWindow(s, 'oe', model.today);
    const f = fill?.get(s.id);
    const h = f ? f.byMonday.get(mondayOf(a)) || 0 : win ? weekShare(s.oe, a, b, win) : 0; // the same weekly plan the board shows (UC-05)
    if (h <= EPS) continue;
    if (!s.assignee?.id) { addTo(unassigned, s.team?.id || '_none', h); continue; }
    addTo(P(s.assignee.id).p, s.rootRef, h);
  }
  for (const p of people.values()) {
    const pw = personWeek(computed, p.id, a, b);
    if (!pw) continue;
    const x = P(p.id);
    x.w = pw.weekly;
    x.poss = r1(pw.gross);
    x.absP = r1((pw.weekly / 5) * pw.absent);
    addTo(x.p, 'SUP', pw.support);
    addTo(x.p, 'INT', pw.internal);
  }
  // support staff without a capacity entry: their reserve only
  for (const [id, wk] of Object.entries(support?.personWeekly || {})) {
    if (people.has(id) || !wk) continue;
    addTo(P(id).p, 'SUP', (wk * workdays(a, b)) / 5);
  }
  for (const x of Object.values(out)) x.p = roundMap(x.p);
  const ids = Object.keys(out).filter((id) => Object.keys(out[id].p).length || out[id].absP);
  return {
    v: 1, from: isoOf(a), to: isoOf(b), rule: model.rule,
    projects: Object.fromEntries(model.items.map((p) => [p.ref, { n: p.name, k: p.key || null, r: p.rank }])),
    // every team a stored person counts in – also hidden ones (a split person's other team: E2E 2026-11-23 showed the
    // CEO team as its raw id because only the teams shown in the cockpit were named)
    teams: Object.fromEntries([...new Set([...model.teams.keys(), ...Object.values(out).flatMap((x) => [x.t, ...(x.teams || []).map((y) => y.t)])])]
      .filter((id) => id && id !== '_none').map((id) => [id, model.teams.get(id)?.name || id])),
    names: Object.fromEntries(ids.map((id) => [id, ds.people?.[id]?.name || null]).filter(([, n]) => n)),
    people: Object.fromEntries(ids.map((id) => [id, out[id]])),
    unassigned: roundMap(unassigned),
  };
}

// Worklogs of the portfolio's own work items (fallback when the site-wide worklog list is not available).
export function worklogsFromDataset(ds) {
  const out = [];
  for (const i of ds.issues || []) for (const w of i.worklogs || []) out.push({ a: w.a, i: String(i.id), d: w.d, h: w.h });
  return out;
}

// The actuals of the week [a, b]: worklogs per person × bucket, unplanned absence, tasks with extra effort.
// worklogs: [{ a: accountId, i: issueId, d: 'YYYY-MM-DD', h }]
export function computeActuals(ds, worklogs, a, b, planRec) {
  const computed = computedOf(ds);
  const { model } = computed;
  const people = capacityPeople(model);
  const supportIds = new Set((ds.supportTickets?.tickets || []).map((t) => String(t.id)));
  const bucketOf = (id) => {
    const i = model.byId.get(String(id));
    if (i && model.itemByRef.has(i.rootRef)) return i.rootRef;
    if (model.itemByRef.has(`issue:${id}`)) return `issue:${id}`;
    if (supportIds.has(String(id))) return 'SUP';
    return 'INT';
  };
  const teamOf = (id) => {
    if (people.get(id)?.teamId) return teamRecord(people.get(id));
    const r = planRec?.people?.[id];
    return r?.t ? { t: r.t, ...(r.teams ? { teams: r.teams } : {}) } : { t: '_none' };
  };
  const out = {};
  const P = (id) => out[id] || (out[id] = { ...teamOf(id), b: {} });
  const booked = new Set();
  for (const w of worklogs || []) {
    const d = dayIdx(w.d);
    if (!w.a || d == null || d < a || d > b || !(w.h > 0)) continue;
    addTo(P(w.a).b, bucketOf(w.i), w.h);
    booked.add(String(w.i));
  }
  // absence hours known now minus those already known when the plan was taken
  for (const p of people.values()) {
    const pw = personWeek(computed, p.id, a, b);
    if (!pw) continue;
    const absU = (pw.weekly / 5) * pw.absent - (planRec?.people?.[p.id]?.absP || 0);
    if (absU > 0.5) P(p.id).absU = r1(absU);
  }
  for (const x of Object.values(out)) x.b = roundMap(x.b);
  // stories booked this week whose Time Spent + Remaining exceed the Original Estimate by more than 10 %
  const over = new Map();
  for (const id of booked) {
    const i = model.byId.get(id);
    if (!i) continue;
    const s = i.role === 'estimate' ? i : ancestor(model, i, 'estimate');
    if (!s || !(s.oe > 0) || over.has(s.key)) continue;
    const total = (s.ts || 0) + (s.re || 0);
    if (total > s.oe * 1.1) over.set(s.key, { ref: s.rootRef, key: s.key, t: s.team?.id || '_none', extra: r1(total - s.oe), oe: r1(s.oe) });
  }
  return { v: 1, from: isoOf(a), to: isoOf(b), people: out, over: [...over.values()].sort((x, y) => y.extra - x.extra).slice(0, 300) };
}

// ---------- default data access (Forge) ----------
async function defaultLoadConfig() {
  const { loadConfig } = await import('./config.js');
  return loadConfig();
}
// All worklogs dated in [from, to], site-wide, as the app (the same two calls as booking.worklogs).
export async function fetchWorklogs(from, to) {
  const { jira, pool, chunk } = await import('./jira.js');
  const ids = [];
  let since = Date.parse(`${from}T00:00:00Z`) - 864e5, lastPage = false, truncated = false;
  for (let guard = 0; !lastPage && guard < 80; guard++) {
    const r = await jira('app', '/rest/api/3/worklog/updated', { query: { since } });
    for (const v of r.values || []) ids.push(v.worklogId);
    lastPage = r.lastPage !== false;
    if (!r.until || r.until <= since) break;
    since = r.until;
    if (ids.length >= MAX_LOGS) { truncated = true; break; }
  }
  const out = [];
  await pool(chunk([...new Set(ids)].slice(0, MAX_LOGS), 1000), 3, async (c) => {
    const list = await jira('app', '/rest/api/3/worklog/list', { method: 'POST', body: { ids: c } });
    for (const w of list || []) {
      const d = typeof w.started === 'string' ? w.started.slice(0, 10) : null;
      if (!w.author?.accountId || !d || d < from || d > to) continue;
      out.push({ a: w.author.accountId, i: String(w.issueId), d, h: (w.timeSpentSeconds || 0) / 3600 });
    }
  });
  return { worklogs: out, truncated };
}
async function defaultLoadData({ cfg, from, to }) {
  const [{ buildDataset }, { publicConfig }] = await Promise.all([import('./dataset.js'), import('./config.js')]);
  const ds = await buildDataset({ as: 'app', cfg });
  ds.config = publicConfig(cfg);
  if (!from) return { ds, worklogs: [] };
  try {
    const { worklogs, truncated } = await fetchWorklogs(from, to);
    return { ds, worklogs, truncated };
  } catch (e) {
    logWarn('[snapshot] worklog list failed, using the portfolio worklogs:', e);
    return { ds, worklogs: null, partial: true };
  }
}

// ---------- the job ----------
const monthsBack = (day, months) => {
  const d = new Date(day * 864e5);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate()) / 864e5);
};
// deps (all optional, for tests): store { get, set, del }, loadConfig(), loadData({ cfg, from, to }) → { ds, worklogs },
// timeZone (string or async fn), paused(), force (ignore schedule and marker).
export async function runSnapshotJob({ now = Date.now(), store, loadConfig, loadData, timeZone, paused, force = false } = {}) {
  if (paused ? paused() : maintenanceMode() !== 'off') return { skipped: 'paused' }; // SUPERPORT kill switch: no reads, no writes
  const st = store || (await defaultStore());
  const cfg = await (loadConfig || defaultLoadConfig)();
  if (!cfg?.setupComplete) return { skipped: 'setup' };
  const settings = validSnapshot(cfg.snapshot);
  const tz = await resolveTimeZone(timeZone, cfg);
  const local = localNow(now, tz);
  const due = snapshotDue(settings, local);
  const meta = (await st.get(LAST)) || {};
  const weeks = new Set(meta.weeks || []), acts = new Set(meta.acts || []);
  if (!force && meta.week === due.week) return { skipped: 'done', week: due.week };
  if (!force && !due.due) return { skipped: 'notDue', week: due.week, next: due.nextIso, time: due.time, tz };

  const prev = shiftWeek(due.week, -1);
  const actWeeks = [shiftWeek(due.week, -2), prev].filter((w) => weeks.has(w));
  const span = actWeeks.length ? [weekRange(actWeeks[0])[0], weekRange(actWeeks.at(-1))[1]] : null;
  const data = await (loadData || defaultLoadData)({ cfg, from: span ? isoOf(span[0]) : null, to: span ? isoOf(span[1]) : null });
  const ds = data.ds;
  ds.today = isoOf(local.day);
  const worklogs = data.worklogs || worklogsFromDataset(ds);
  const at = new Date(now).toISOString();

  // 1. actuals of the completed weeks
  for (const w of actWeeks) {
    const [a, b] = weekRange(w);
    const planRec = await getRecord(st, planKey(w));
    const act = computeActuals(ds, worklogs, a, b, planRec);
    await putRecord(st, actKey(w), { ...act, week: w, at, final: w !== prev, truncated: !!data.truncated, partial: !!(data.partial || !data.worklogs) });
    acts.add(w);
  }
  // 2. the plan of this week
  const [a, b] = weekRange(due.week);
  const plan = computePlan(ds, a, b);
  await putRecord(st, planKey(due.week), { ...plan, week: due.week, at, tz, late: local.day > due.dueDay });
  weeks.add(due.week);
  // 3. retention
  const cutoff = monthsBack(local.day, settings.keepMonths);
  const deleted = [];
  for (const w of [...new Set([...weeks, ...acts])]) {
    if (weekRange(w)[1] >= cutoff) continue;
    if (weeks.has(w)) { await delRecord(st, planKey(w)); weeks.delete(w); }
    if (acts.has(w)) { await delRecord(st, actKey(w)); acts.delete(w); }
    deleted.push(w);
  }
  await st.set(LAST, { week: due.week, at, tz, firstAt: meta.firstAt || at, weeks: [...weeks].sort(), acts: [...acts].sort() });
  return { week: due.week, people: Object.keys(plan.people).length, acts: actWeeks, deleted };
}

// ---------- the caller's portfolio ----------
// The weeks are recorded as the app over every portfolio item. scope (from the caller's own Jira view) keeps only the
// items the caller may browse: hidden ones lose their name, rank, hours and extra-effort tasks entirely (their hours
// do not appear as another bucket either), and every rank is the one the Portfolio shows this caller (null = no
// longer in the portfolio). Support and internal hours stay.
export function scopeWeekRecords(plans, acts, scope) {
  if (!scope) return { plans, acts };
  const ok = (k) => k === 'SUP' || k === 'INT' || scope.visible.has(k);
  const strip = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k]) => ok(k))) : o);
  const people = (pp, f) => Object.fromEntries(Object.entries(pp || {}).map(([id, x]) => [id, x && x[f] ? { ...x, [f]: strip(x[f]) } : x]));
  return {
    plans: plans.map((p) => ({ ...p,
      projects: Object.fromEntries(Object.entries(p.projects || {}).filter(([ref]) => scope.visible.has(ref)).map(([ref, x]) => [ref, { n: x?.n ?? x?.name ?? ref, k: x?.k ?? x?.key ?? null, r: scope.rank.get(ref) ?? null }])),
      people: people(p.people, 'p'), ...(p.unassigned ? { unassigned: strip(p.unassigned) } : {}) })),
    acts: acts.map((a) => ({ ...a, people: people(a.people, 'b'), over: (a.over || []).filter((o) => scope.visible.has(o.ref)) })),
  };
}
const recordRefs = (plans, acts) => {
  const out = new Set();
  const add = (o) => { for (const k of Object.keys(o || {})) if (k !== 'SUP' && k !== 'INT') out.add(k); };
  for (const p of plans) { add(p.projects); for (const x of Object.values(p.people || {})) add(x?.p); }
  for (const a of acts) { for (const x of Object.values(a.people || {})) add(x?.b); for (const o of a.over || []) if (o?.ref) out.add(o.ref); }
  return [...out];
};

// ---------- the read function ----------
// ctx: { canSeePerson(teamId|null) → bool | Promise<bool>, cfg (for the schedule), store (tests),
//        scope(refs) → Promise<{ visible: Set, rank: Map }> – the caller's portfolio (see scopeWeekRecords) }
export async function planActual(payload = {}, ctx = {}) {
  const st = ctx.store || (await defaultStore());
  const n = +payload?.weeks === 8 ? 8 : 4;
  const team = typeof payload?.team === 'string' && /^[\w:.-]{1,80}$/.test(payload.team) ? payload.team : 'all';
  const meta = (await st.get(LAST)) || {};
  const planWeeks = (meta.weeks || []).slice().sort();
  const actSet = new Set(meta.acts || []);
  const doneWeeks = planWeeks.filter((w) => actSet.has(w)).slice(-n);
  const [plans, acts] = await Promise.all([
    Promise.all(doneWeeks.map((w) => getRecord(st, planKey(w)))),
    Promise.all(doneWeeks.map((w) => getRecord(st, actKey(w)))),
  ]);
  let okPlans = plans.filter(Boolean), okActs = acts.filter(Boolean);
  if (typeof ctx.scope === 'function') ({ plans: okPlans, acts: okActs } = scopeWeekRecords(okPlans, okActs, await ctx.scope(recordRefs(okPlans, okActs))));
  // weeks with a plan but no actuals yet: only their names are needed
  const stubs = planWeeks.filter((w) => !actSet.has(w)).map((w) => ({ week: w, people: {} }));
  const teamIds = new Set();
  for (const r of [...okPlans, ...okActs]) for (const x of Object.values(r.people || {})) teamIds.add(x.t || '_none');
  const visible = new Map();
  const can = typeof ctx.canSeePerson === 'function' ? ctx.canSeePerson : () => false;
  await Promise.all([...teamIds].map(async (t) => {
    let v = false;
    try { v = (await can(t === '_none' ? null : t)) === true; } catch { v = false; }
    visible.set(t === '_none' ? null : t, v);
  }));
  // weeks stored before every team was named: the Atlassian Teams snapshot names the rest
  let teamNames = ctx.teamNames || null;
  if (!teamNames) { try { const atl = await st.get('teams:atlassian'); teamNames = Object.fromEntries(Object.entries(atl?.teams || {}).map(([id, t]) => [id, t?.name]).filter(([, nm]) => nm)); } catch { teamNames = null; } }
  return buildPayload({ plans: [...okPlans, ...stubs], acts: okActs, weeks: n, team, canSee: (t) => visible.get(t ?? null) === true, schedule: ctx.cfg?.snapshot, teamNames });
}
