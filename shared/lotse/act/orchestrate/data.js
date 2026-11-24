// Lotse orchestration – the work itself: per subject (a colleague, a team, a project) the blocks a job asks for, with
// the cockpit's own numbers. Nothing is estimated here and nothing invented:
//   coming weeks   engine.weeksUtilization (the same plan / capacity / load as Kapazität and "Meine Arbeit"); the share
//                  "planned here" is the same linear spread of the Remaining Estimate, filtered on the job's scope
//   past weeks     booking.bookingOverview (the booking check: possible = weekly hours ÷ working days per week × days
//                  after holidays and absences; booked = every worklog of the person in the week)
//   tasks          the open stories of the person in the scope (key, window, Remaining Estimate, flags)
//   absences       capacity.absences + the public holidays of the person's location (locations.personDays)
//   plan vs actual ctx.planActual (the Plan-vs-Ist snapshots), support the support worklogs + the reserve
// assess() turns the numbers into findings with evidence (every number of a sentence stands in its evidence) and
// concrete suggestions – the same sentences in the story cards and in the PDF.
import { weeksUtilizationShared, capacityPeople, spreadWindow, shareIn, personCapacityIn } from '../../../engine.js';
import { ticketSla, DEFAULT_SLA } from '../../../sla.js';
import { bookingOverview, BOOKING_DEFAULTS } from '../../../booking.js';
import { personDays } from '../../../locations.js';
import { holidayName, HOLIDAY_NAMES } from '../../../holidays.js';
import { inTeam } from '../../../allocation.js';
import { dayIdx, isoOf, mondayOf, nextWorkday, workdays, isWeekday } from '../../../dates.js';
import { isoWeekNo } from '../../story.js';
import { ev, sum, memo } from '../../kit.js';
import { T, plural, computedOf, dsOf, fmt, langOf } from '../kit.js';

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
const pct = (u) => (Number.isFinite(u) ? Math.round(u * 100) : null);
const isOpen = (i) => (i?.status?.cat ?? i?.statusCat ?? 'new') !== 'done';
const keyCmp = (a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true });
export const MAX_SUBJECTS = 24;

// ---------- the weeks of a job ----------
export function jobWeeks(ctx, window) {
  const { model } = computedOf(ctx);
  const today = model.today;
  const mon = mondayOf(today);
  const out = [];
  for (let k = Math.max(0, window.past || 0); k >= 1; k--) out.push({ a: mon - 7 * k, b: mon - 7 * k + 6, past: true, i: -1 });
  for (let k = 0; k < Math.max(0, window.next || 0); k++) out.push({ a: mon + 7 * k, b: mon + 7 * k + 6, past: false, i: k });
  return out.map((w) => ({ ...w, from: isoOf(w.a), to: isoOf(w.b), key: `${isoOf(w.a + 3).slice(0, 4)}-W${String(isoWeekNo(isoOf(w.a))).padStart(2, '0')}`, no: isoWeekNo(isoOf(w.a)), current: w.a === mon }));
}
export const weekLabel = (L, w) => T(L, `KW ${w.no}`, `W${w.no}`);

// ---------- scope ----------
export function inScope(job) {
  const s = job.scope;
  if (!s || s.kind === 'portfolio' || s.kind === 'person') return () => true;
  if (s.kind === 'project') return (i) => i.rootRef === s.ref;
  return (i) => i.team?.id === s.ref; // team / my team: the work booked to the team
}
const scopeName = (L, job) => (!job.scope ? '' : job.scope.kind === 'portfolio' ? T(L, 'im Portfolio', 'in the portfolio') : job.scope.kind === 'project' ? T(L, `in ${job.scope.name}`, `in ${job.scope.name}`) : job.scope.kind === 'person' ? '' : T(L, `in Team ${job.scope.name}`, `in team ${job.scope.name}`));
export { scopeName };

// the open stories with a remaining estimate as the engine spreads them (weeksUtilization), with their window
function spreadStories(ctx) {
  return memo(ctx, 'orch:spread', () => {
    const { model } = computedOf(ctx);
    const out = [];
    for (const s of dsOf(ctx).issues || []) {
      if (s.role !== 'estimate' || !isOpen(s) || !s.re) continue;
      out.push({ s, win: spreadWindow(s, 're', model.today) || [nextWorkday(model.today), nextWorkday(model.today)] });
    }
    return out;
  });
}
// every worklog of the dataset (stories and support tickets), bucketed per person
function worklogsByPerson(ctx) {
  return memo(ctx, 'orch:logs', () => {
    const ds = dsOf(ctx);
    const by = new Map();
    const sup = new Set((ds.supportTickets?.tickets || []).map((t) => String(t.id)));
    for (const x of [...(ds.issues || []), ...(ds.supportTickets?.tickets || [])]) {
      for (const l of x.worklogs || []) {
        if (!l?.a || !(l.h > 0)) continue;
        (by.get(l.a) || by.set(l.a, []).get(l.a)).push({ d: dayIdx(l.d), h: l.h, issue: x, support: sup.has(String(x.id)) });
      }
    }
    return by;
  });
}
// the booking check of one week, for everyone (bookingOverview needs { people: { id: { h, byIssue } } })
function bookingWeek(ctx, a, b) {
  return memo(ctx, `orch:book:${a}`, () => {
    const { model } = computedOf(ctx);
    const people = {};
    for (const [pid, list] of worklogsByPerson(ctx)) {
      let h = 0; const byIssue = {}; let last = null;
      for (const l of list) if (l.d >= a && l.d <= b) { h += l.h; byIssue[l.issue.id] = (byIssue[l.issue.id] || 0) + l.h; if (!last || l.d > last) last = l.d; }
      if (h > 0) people[pid] = { h, byIssue, last: last != null ? isoOf(last) : null };
    }
    const ov = bookingOverview(model, { people }, a, b, dsOf(ctx).config || {});
    return { rows: new Map(ov.rows.map((r) => [r.id, r])), minPct: ov.settings?.minPct ?? BOOKING_DEFAULTS.minPct };
  });
}
// the engine's weekly numbers for n weeks from this week (Kapazität / "Meine Arbeit")
function utilOf(ctx, n) {
  const c = computedOf(ctx);
  const wu = weeksUtilizationShared(c.model, c.support, Math.max(1, n));
  return memo(ctx, `orch:wu:${n}`, () => {
    const people = new Map();
    for (const t of wu.teams) for (const m of t.members) if (!people.has(m.id)) people.set(m.id, m);
    return { wu, people, teams: new Map(wu.teams.map((t) => [t.teamId, t])) };
  });
}

// ---------- the subjects of a job ----------
export function subjectsOf(ctx, job) {
  const c = computedOf(ctx);
  const { model } = c;
  const ds = dsOf(ctx);
  const L = langOf(ctx);
  const W = jobWeeks(ctx, job.window);
  const next = W.filter((w) => !w.past);
  const inS = inScope(job);
  // a chain hands over exactly its set (job.only): only those members are subjects
  if (job.only && Array.isArray(job.people)) return subjectsOf(ctx, { ...job, only: false }).filter((x) => job.people.includes(x.id));
  if (job.subjects === 'person') {
    const id = job.scope?.ref;
    return id && ds.people?.[id] ? [{ kind: 'person', id, name: ds.people[id].name }] : [];
  }
  if (job.subjects === 'teams') {
    const u = utilOf(ctx, Math.max(1, next.length));
    const named = new Set(job.people || []);
    return [...model.teams.values()].filter((t) => named.has(t.id) || u.teams.get(t.id)?.members.length || u.teams.get(t.id)?.planTotal > 0)
      .map((t) => ({ kind: 'team', id: t.id, name: t.name, weight: u.teams.get(t.id)?.planTotal || 0 }))
      .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).slice(0, MAX_SUBJECTS);
  }
  if (job.subjects === 'projects') {
    return model.items.filter((it) => !c.metrics.get(it.ref)?.done).map((it) => ({ kind: 'project', id: it.ref, name: it.name, weight: -it.rank })).slice(0, MAX_SUBJECTS);
  }
  // people: in a team – its members; in a project or the portfolio – everyone with open work, planned hours or bookings there
  const cap = capacityPeople(model);
  const weight = new Map();
  const add = (pid, h) => { if (pid && ds.people?.[pid]) weight.set(pid, (weight.get(pid) || 0) + h); };
  if (job.scope?.kind === 'team' || job.scope?.kind === 'myTeam') for (const p of cap.values()) if (inTeam(p, job.scope.ref)) add(p.id, 0);
  const A = W.length ? W[0].a : model.today, B = W.length ? W.at(-1).b : model.today;
  for (const { s, win } of spreadStories(ctx)) if (inS(s) && s.assignee?.id) add(s.assignee.id, sum(next, (w) => shareIn(s.re, w.a, w.b, win, 'linear')) + 0.001);
  for (const s of ds.issues || []) if (s.role === 'estimate' && isOpen(s) && inS(s) && s.assignee?.id) add(s.assignee.id, 0.0001);
  if (job.scope?.kind === 'project') for (const [pid, list] of worklogsByPerson(ctx)) for (const l of list) if (l.d >= A && l.d <= B && inS(l.issue)) add(pid, 0.0001);
  // the people a chain hands over (a set from an earlier step) are subjects even without open work in the window
  if (job.scope?.kind === 'portfolio' && Array.isArray(job.people)) for (const pid of job.people) add(pid, 0);
  void L;
  return [...weight].filter(([pid]) => !String(pid).startsWith('anon')).map(([id, w]) => ({ kind: 'person', id, name: ds.people[id].name, weight: w }))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).slice(0, MAX_SUBJECTS);
}

// ---------- one person ----------
export function personData(ctx, job, pid) {
  const c = computedOf(ctx);
  const { model } = c;
  const ds = dsOf(ctx);
  const today = model.today;
  const W = jobWeeks(ctx, job.window);
  const next = W.filter((w) => !w.past);
  const inS = inScope(job);
  const u = utilOf(ctx, Math.max(1, next.length));
  const m = u.people.get(pid) || null;
  const capP = capacityPeople(model).get(pid) || null;
  const mine = spreadStories(ctx).filter((x) => x.s.assignee?.id === pid);
  const logs = worklogsByPerson(ctx).get(pid) || [];
  const weeks = W.map((w) => {
    const row = { key: w.key, no: w.no, from: w.from, to: w.to, past: w.past, current: w.current };
    if (!w.past) {
      // the engine's own numbers (identical to Kapazität); "here" = the same spread, only the scope's stories
      row.plan = m ? m.plan[w.i] : sum(mine, (x) => shareIn(x.s.re, w.a, w.b, x.win, 'linear'));
      row.cap = m ? m.cap[w.i] : capP ? personCapacityIn(model, capP, w.a, w.b, c.support?.personWeekly?.[pid] || 0) : 0;
      row.util = row.cap > 0 ? row.plan / row.cap : row.plan > 0 ? Infinity : 0;
      const here = mine.filter((x) => inS(x.s)).map((x) => ({ key: x.s.key, h: shareIn(x.s.re, w.a, w.b, x.win, 'linear') })).filter((x) => x.h > 0.005);
      row.planScope = sum(here, (x) => x.h);
      row.keys = here.sort((a, b) => b.h - a.h).map((x) => x.key);
    } else {
      const bw = bookingWeek(ctx, w.a, w.b);
      const r = bw.rows.get(pid) || null;
      row.possible = r ? r.possible : 0;
      row.booked = r ? r.booked : sum(logs.filter((l) => l.d >= w.a && l.d <= w.b), (l) => l.h);
      row.target = r ? (r.possible * bw.minPct) / 100 : 0;
      row.minPct = bw.minPct;
      row.bookPct = r?.pct ?? null;
      row.off = r?.off ?? 0;
      const here = logs.filter((l) => l.d >= w.a && l.d <= w.b && !l.support && inS(l.issue));
      row.bookedScope = sum(here, (l) => l.h);
      row.supportBooked = sum(logs.filter((l) => l.d >= w.a && l.d <= w.b && l.support), (l) => l.h);
      row.keys = [...new Set(here.map((l) => l.issue.key))].sort();
    }
    return row;
  });
  // tasks: open stories in the scope (also without an estimate – the plan cannot see those)
  const tasks = (ds.issues || []).filter((s) => s.role === 'estimate' && isOpen(s) && s.assignee?.id === pid && inS(s)).map((s) => ({
    key: s.key, summary: s.summary || '', ref: s.rootRef, project: model.itemByRef.get(s.rootRef)?.name || '', start: s.start || null, due: s.due || null,
    re: s.re || 0, oe: s.oe || 0, status: s.status?.name || '', overdue: !!s.due && dayIdx(s.due) < today, blocked: !!model.isBlocked?.(s), noEstimate: !(s.oe > 0) && !(s.re > 0), noDue: !s.due,
    blockedReason: s.blockedReason || null,
  })).sort((a, b) => (b.overdue - a.overdue) || String(a.due || '9999').localeCompare(String(b.due || '9999')) || keyCmp(a, b));
  // absences + public holidays in the window
  const A = W.length ? W[0].a : today, B = W.length ? W.at(-1).b : today;
  const absences = (ds.capacity?.absences || []).filter((x) => x.accountId === pid && dayIdx(x.to) >= A && dayIdx(x.from) <= B)
    .map((x) => ({ from: x.from, to: x.to, type: x.type || 'absent', days: workdays(Math.max(A, dayIdx(x.from)), Math.min(B, dayIdx(x.to))) }))
    .sort((a, b) => a.from.localeCompare(b.from));
  const L = langOf(ctx);
  let holidays = [];
  if (capP) {
    const pd = personDays(model.cfg, capP, ds.capacity?.absences, A, B);
    holidays = [...pd.hol].filter((d) => isWeekday(d)).sort((a, b) => a - b).map((d) => { const k = holidayName(pd.loc.calendar, d); return { date: isoOf(d), name: k && HOLIDAY_NAMES[k] ? HOLIDAY_NAMES[k][L === 'en' ? 1 : 0] : T(L, 'Feiertag', 'Public holiday') }; });
  }
  // plan vs actual (the snapshots of Plan vs. Ist), only when they exist for this person
  let planActual = null;
  const pa = ctx.planActual;
  if (pa?.state === 'ready') {
    const unit = (pa.units || []).find((x) => x.kind === 'person' && x.id === pid);
    if (unit) {
      const refOk = (k) => (job.scope?.kind === 'project' ? k === job.scope.ref : true);
      const plan = sum(Object.entries(unit.plan || {}).filter(([k]) => refOk(k)), ([, h]) => h);
      const book = sum(Object.entries(unit.book || {}).filter(([k]) => refOk(k)), ([, h]) => h);
      planActual = { plan: r1(plan), book: r1(book), diff: r1(book - plan), weeks: (pa.weeks || []).length, from: pa.weeks?.[0]?.from || null, to: pa.weeks?.at(-1)?.to || null };
    }
  }
  const pastW = weeks.filter((w) => w.past);
  const support = { booked: r1(sum(pastW, (w) => w.supportBooked || 0)), reserve: r1(c.support?.personWeekly?.[pid] || 0), weeks: pastW.length };
  return { kind: 'person', id: pid, name: ds.people?.[pid]?.name || pid, teamId: capP?.teamId || null, teamName: capP?.teamId ? model.teams.get(capP.teamId)?.name || null : null, weeklyHours: capP ? +capP.weeklyHours || 0 : null, weeks, tasks, absences, holidays, planActual, support };
}

// support hours a team carried in the past weeks (worklogs on support tickets assigned to the team) and its open tickets at risk
export function teamSupport(ctx, tid, past = 4) {
  return memo(ctx, `chain:sup:${tid}:${past}`, () => {
    const ds = dsOf(ctx);
    const { model } = computedOf(ctx);
    const mon = mondayOf(model.today);
    const A = mon - 7 * past, B = mon - 1;
    const tickets = (ds.supportTickets?.tickets || []).filter((t) => t.team?.id === tid);
    let h = 0; const keys = new Set();
    for (const t of tickets) for (const l of t.worklogs || []) { const d = dayIdx(l.d); if (d != null && d >= A && d <= B && l.h > 0) { h += l.h; keys.add(t.key); } }
    const cal = ds.config?.support?.sla || DEFAULT_SLA;
    const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
    const risk = tickets.filter((t) => t.statusCat !== 'done').map((t) => ({ t, sla: ticketSla(t, cal, now) })).filter((x) => x.sla.status === 'breached' || x.sla.status === 'atRisk')
      .sort((a, b) => (a.sla.remainingH ?? 0) - (b.sla.remainingH ?? 0)).map((x) => ({ key: x.t.key, summary: x.t.summary || '', status: x.sla.status, left: r1(x.sla.remainingH ?? 0), priority: x.t.priority || null }));
    return { booked: r1(h), weeks: past, from: isoOf(A), to: isoOf(B), keys: [...keys].sort(), risk };
  });
}
// ---------- one team ----------
export function teamData(ctx, job, tid) {
  const c = computedOf(ctx);
  const { model } = c;
  const ds = dsOf(ctx);
  const today = model.today;
  const W = jobWeeks(ctx, job.window);
  const next = W.filter((w) => !w.past);
  const u = utilOf(ctx, Math.max(1, next.length));
  const t = u.teams.get(tid);
  const weeks = W.map((w) => {
    const row = { key: w.key, no: w.no, from: w.from, to: w.to, past: w.past, current: w.current };
    if (!w.past) {
      row.plan = t ? t.plan[w.i] : 0; row.cap = t ? t.cap[w.i] : 0;
      row.util = row.cap > 0 ? row.plan / row.cap : row.plan > 0 ? Infinity : 0;
      const over = (t?.members || []).filter((m) => m.util[w.i] > 1.0001);
      row.over = over.length; row.overNames = over.map((m) => ds.people?.[m.id]?.name || m.id);
    } else {
      const bw = bookingWeek(ctx, w.a, w.b);
      const rows = (t?.members || []).map((m) => bw.rows.get(m.id)).filter(Boolean);
      row.possible = sum(rows, (r) => r.possible); row.booked = sum(rows, (r) => r.booked); row.target = (row.possible * bw.minPct) / 100; row.minPct = bw.minPct;
      row.bookPct = row.possible > 0 ? Math.round((row.booked / row.possible) * 100) : null;
    }
    return row;
  });
  const stories = (ds.issues || []).filter((s) => s.role === 'estimate' && isOpen(s) && s.team?.id === tid);
  const overdue = stories.filter((s) => s.due && dayIdx(s.due) < today).sort(keyCmp).map((s) => ({ key: s.key, summary: s.summary || '', due: s.due, assignee: s.assignee?.name || null, re: s.re || 0 }));
  const blocked = stories.filter((s) => model.isBlocked?.(s)).sort(keyCmp).map((s) => ({ key: s.key, summary: s.summary || '', since: s.blockedSince || null, reason: s.blockedReason || null }));
  const A = W.length ? W[0].a : today, B = W.length ? W.at(-1).b : today;
  const memberIds = new Set((t?.members || []).map((m) => m.id));
  const absences = (ds.capacity?.absences || []).filter((x) => memberIds.has(x.accountId) && dayIdx(x.to) >= A && dayIdx(x.from) <= B)
    .map((x) => ({ who: ds.people?.[x.accountId]?.name || x.accountId, from: x.from, to: x.to, type: x.type || 'absent', days: workdays(Math.max(A, dayIdx(x.from)), Math.min(B, dayIdx(x.to))) }));
  const leads = ((ds.capacity?.teams || {})[tid]?.responsible || []).map((id) => ({ id, name: ds.people?.[id]?.name || null })).filter((x) => x.name);
  const byProject = (t?.byProject || []).slice(0, 4).map((x) => ({ ref: x.ref, name: model.itemByRef.get(x.ref)?.name || x.ref, hours: x.hours }));
  const pastN = W.filter((w) => w.past).length;
  const sup = teamSupport(ctx, tid, Math.max(1, pastN || 4));
  const support = { reserve: r1((c.support?.teams || []).find((x) => x.teamId === tid)?.weekly || 0), booked: pastN ? sup.booked : null, weeks: pastN, keys: sup.keys, risk: sup.risk };
  return { kind: 'team', id: tid, name: model.teams.get(tid)?.name || tid, members: (t?.members || []).length, leads, weeks, overdue, blocked, absences, byProject, support };
}

// ---------- one project ----------
export function projectData(ctx, job, ref) {
  const c = computedOf(ctx);
  const { model } = c;
  const ds = dsOf(ctx);
  const today = model.today;
  const it = model.itemByRef.get(ref);
  const met = c.metrics.get(ref) || {};
  const W = jobWeeks(ctx, job.window);
  const next = W.filter((w) => !w.past);
  const st = spreadStories(ctx).filter((x) => x.s.rootRef === ref);
  const weeks = next.map((w) => ({ key: w.key, no: w.no, from: w.from, to: w.to, past: false, current: w.current, plan: sum(st, (x) => shareIn(x.s.re, w.a, w.b, x.win, 'linear')) }));
  const stories = (ds.issues || []).filter((s) => s.role === 'estimate' && isOpen(s) && s.rootRef === ref);
  const overdue = stories.filter((s) => s.due && dayIdx(s.due) < today).sort(keyCmp).map((s) => ({ key: s.key, summary: s.summary || '', due: s.due, assignee: s.assignee?.name || null, re: s.re || 0, days: today - dayIdx(s.due) }));
  const blocked = stories.filter((s) => model.isBlocked?.(s)).sort(keyCmp).map((s) => ({ key: s.key, summary: s.summary || '', since: s.blockedSince || null, reason: s.blockedReason || null }));
  const noEstimate = stories.filter((s) => !(s.oe > 0) && !(s.re > 0)).sort(keyCmp).map((s) => ({ key: s.key, summary: s.summary || '' }));
  return {
    kind: 'project', id: ref, name: it?.name || ref, key: it?.key || null, rank: it?.rank ?? null, owner: it?.owner ? { id: it.owner.id, name: it.owner.name || ds.people?.[it.owner.id]?.name || null } : null,
    progress: Number.isFinite(met.progress) ? met.progress : null, due: met.due || it?.due || null, daysOverdue: met.daysOverdue || 0, health: it?.health?.status || null,
    open: stories.length, remaining: r1(sum(stories, (s) => s.re || 0)), weeks, overdue, blocked, noEstimate,
  };
}

export function subjectData(ctx, job, subject) {
  if (subject.kind === 'team') return teamData(ctx, job, subject.id);
  if (subject.kind === 'project') return projectData(ctx, job, subject.id);
  return personData(ctx, job, subject.id);
}

// ---------- findings + suggestions (the same sentences in the story and in the PDF) ----------
// → [{ text, tone, impact, evidence, block, suggest?: { text, ask } }] sorted by impact; every number of `text` stands in
// `evidence` (selfCheck), every number of `suggest.text` too.
export function assess(ctx, job, d) {
  const L = langOf(ctx);
  const F = fmt(ctx);
  const on = (b) => job.blocks.includes(b);
  const out = [];
  const add = (block, tone, impact, text, evidence, suggest) => out.push({ block, tone, impact, text, evidence, ...(suggest ? { suggest } : {}) });
  const wk = (w) => weekLabel(L, w);
  if (d.kind === 'person') {
    const coming = d.weeks.filter((w) => !w.past);
    const over = coming.filter((w) => w.util > 1.0001 && Number.isFinite(w.util));
    const noTime = coming.filter((w) => !Number.isFinite(w.util));
    if (on('weeks') && over.length) {
      const pk = [...over].sort((a, b) => b.util - a.util)[0];
      const p = pct(pk.util);
      add('weeks', over.length > 1 || p > 120 ? 'bad' : 'warn', 80 + Math.min(15, over.length * 3),
        T(L, `${over.length} von ${coming.length} Wochen über 100 % – am höchsten ${wk(pk)} mit ${p} % (${F.h(pk.plan, 1)} geplant, ${F.h(pk.cap, 1)} verfügbar).`, `${over.length} of ${coming.length} weeks over 100% – highest ${wk(pk)} at ${p}% (${F.h(pk.plan, 1)} planned, ${F.h(pk.cap, 1)} available).`),
        [ev(T(L, 'Wochen über 100 %', 'weeks over 100%'), over.length, 'n'), ev(T(L, 'Wochen', 'weeks'), coming.length, 'n'), ev(T(L, 'Spitze', 'peak'), p, '%'), ev(T(L, 'geplant', 'planned'), pk.plan, 'h'), ev(T(L, 'verfügbar', 'available'), pk.cap, 'h'), ev(T(L, 'Ziel', 'target'), 100, '%')],
        { text: T(L, `${wk(pk)} bei ${p} % – Lotse kann die Woche auf 100 % planen.`, `${wk(pk)} at ${p}% – Lotse can plan the week to 100%.`), ask: T(L, 'Plane meine Woche auf 100 %', 'Plan my week to 100%'), evidence: [ev(T(L, 'Spitze', 'peak'), p, '%'), ev(T(L, 'Ziel', 'target'), 100, '%')] });
    }
    if (on('weeks') && noTime.length) {
      const w = noTime[0];
      add('weeks', 'bad', 85, T(L, `${wk(w)}: ${F.h(w.plan, 1)} geplant, aber keine freie Zeit (Feiertage oder Abwesenheit).`, `${wk(w)}: ${F.h(w.plan, 1)} planned but no free time (holidays or absence).`),
        [ev(T(L, 'geplant', 'planned'), w.plan, 'h'), ev(T(L, 'verfügbar', 'available'), 0, 'h')],
        { text: T(L, 'Vertretung klären oder die Arbeit in eine Woche mit Zeit legen.', 'Arrange cover or move the work into a week with time.'), ask: T(L, 'Plane meine Woche auf 100 %', 'Plan my week to 100%'), evidence: [] });
    }
    if (on('weeks') && !over.length && !noTime.length && coming.length) {
      const avg = sum(coming, (w) => w.plan) / Math.max(1e-9, sum(coming, (w) => w.cap));
      const a = pct(avg) ?? 0;
      const hereH = sum(coming, (w) => w.planScope || 0);
      add('weeks', a < 50 ? 'info' : 'ok', 40, T(L, `Keine Woche über 100 % – im Schnitt ${a} % ausgelastet, ${F.h(hereH, 1)} davon ${scopeName(L, job) || T(L, 'insgesamt', 'in total')}.`, `No week over 100% – ${a}% loaded on average, ${F.h(hereH, 1)} of it ${scopeName(L, job) || 'in total'}.`),
        [ev(T(L, 'Schnitt', 'average'), a, '%'), ev(T(L, 'hier geplant', 'planned here'), hereH, 'h'), ev(T(L, 'Ziel', 'target'), 100, '%')]);
    }
    const tasks = d.tasks;
    const overdue = tasks.filter((t) => t.overdue);
    if ((on('overdue') || on('tasks') || on('risks')) && overdue.length) {
      const h = sum(overdue, (t) => t.re);
      add('overdue', 'bad', 78, T(L, `${overdue.length} ${plural(overdue.length, 'Story ist', 'Stories sind')} überfällig (${F.h(h, 1)} offen): ${overdue.slice(0, 3).map((t) => t.key).join(', ')}.`, `${overdue.length} ${plural(overdue.length, 'story is', 'stories are')} overdue (${F.h(h, 1)} open): ${overdue.slice(0, 3).map((t) => t.key).join(', ')}.`),
        [ev(T(L, 'überfällig', 'overdue'), overdue.length, 'n'), ev(T(L, 'offen', 'open'), h, 'h'), ...overdue.slice(0, 4).map((t) => ev(t.key, t.due, 'date', { key: t.key, text: t.summary.slice(0, 150) }))],
        { text: T(L, `Für ${overdue.slice(0, 2).map((t) => t.key).join(', ')} ein realistisches neues Due Date setzen oder abschließen.`, `Set a realistic new due date for ${overdue.slice(0, 2).map((t) => t.key).join(', ')} or close ${plural(Math.min(2, overdue.length), 'it', 'them')}.`), ask: T(L, 'Plane meine Woche auf 100 %', 'Plan my week to 100%'), evidence: overdue.slice(0, 2).map((t) => ev(t.key, t.due, 'date', { key: t.key })) });
    }
    const blocked = tasks.filter((t) => t.blocked);
    if ((on('overdue') || on('risks') || on('tasks')) && blocked.length) {
      add('overdue', 'warn', 70, T(L, `${blocked.length} ${plural(blocked.length, 'Story ist', 'Stories sind')} blockiert: ${blocked.slice(0, 3).map((t) => t.key).join(', ')}.`, `${blocked.length} ${plural(blocked.length, 'story is', 'stories are')} blocked: ${blocked.slice(0, 3).map((t) => t.key).join(', ')}.`),
        [ev(T(L, 'blockiert', 'blocked'), blocked.length, 'n'), ...blocked.slice(0, 4).map((t) => ev(t.key, null, null, { key: t.key, text: (t.blockedReason || t.summary).slice(0, 150) }))],
        { text: T(L, `Die Blockade von ${blocked[0].key} im nächsten Weekly ansprechen${blocked[0].blockedReason ? ` („${blocked[0].blockedReason.slice(0, 80)}“)` : ''}.`, `Raise the blocker of ${blocked[0].key} in the next weekly${blocked[0].blockedReason ? ` ("${blocked[0].blockedReason.slice(0, 80)}")` : ''}.`), ask: T(L, 'Was ist blockiert?', 'What is blocked?'), evidence: [ev(blocked[0].key, null, null, { key: blocked[0].key })] });
    }
    const noEst = tasks.filter((t) => t.noEstimate);
    if ((on('tasks') || on('risks')) && noEst.length) {
      add('tasks', 'warn', 60, T(L, `${noEst.length} ${plural(noEst.length, 'Story hat', 'Stories haben')} keine Schätzung – kein Plan sieht ${plural(noEst.length, 'sie', 'sie')}: ${noEst.slice(0, 3).map((t) => t.key).join(', ')}.`, `${noEst.length} ${plural(noEst.length, 'story has', 'stories have')} no estimate – no plan sees ${plural(noEst.length, 'it', 'them')}: ${noEst.slice(0, 3).map((t) => t.key).join(', ')}.`),
        [ev(T(L, 'ohne Schätzung', 'without estimate'), noEst.length, 'n'), ...noEst.slice(0, 4).map((t) => ev(t.key, null, null, { key: t.key, text: t.summary.slice(0, 150) }))],
        { text: T(L, `${noEst.length} ${plural(noEst.length, 'Schätzung ergänzen', 'Schätzungen ergänzen')} – Lotse schlägt Werte aus ähnlicher erledigter Arbeit vor.`, `Add ${noEst.length} ${plural(noEst.length, 'estimate', 'estimates')} – Lotse suggests values from similar finished work.`), ask: T(L, 'Fülle die Lücken', 'Fill the gaps'), evidence: [ev(T(L, 'ohne Schätzung', 'without estimate'), noEst.length, 'n')] });
    }
    if (on('tasks') && tasks.length && !overdue.length && !blocked.length && !noEst.length) {
      const h = sum(tasks, (t) => t.re);
      add('tasks', 'ok', 35, T(L, `${tasks.length} offene ${plural(tasks.length, 'Story', 'Stories')} ${scopeName(L, job)} mit ${F.h(h, 1)} Rest – keine überfällig, keine blockiert.`.replace('  ', ' '), `${tasks.length} open ${plural(tasks.length, 'story', 'stories')} ${scopeName(L, job)} with ${F.h(h, 1)} remaining – none overdue, none blocked.`.replace('  ', ' ')),
        [ev(T(L, 'offen', 'open'), tasks.length, 'n'), ev(T(L, 'Rest', 'remaining'), h, 'h')]);
    }
    if (on('absences') && (d.absences.length || d.holidays.length)) {
      const days = sum(d.absences, (a) => a.days);
      const planned = d.absences.length ? sum(coming.filter((w) => d.absences.some((a) => a.from <= w.to && a.to >= w.from)), (w) => w.planScope || 0) : 0;
      const first = d.absences[0];
      if (first) {
        add('absences', planned > 0.5 ? 'warn' : 'info', planned > 0.5 ? 72 : 30,
          planned > 0.5 ? T(L, `Abwesend ${F.date(first.from)} – ${F.date(first.to)} (${days} ${plural(days, 'Arbeitstag', 'Arbeitstage')}), in diesen Wochen sind ${F.h(planned, 1)} ${scopeName(L, job) || ''} geplant.`.replace(/\s+\./, '.').replace(/\s{2,}/g, ' '), `Away ${F.date(first.from)} – ${F.date(first.to)} (${days} working ${plural(days, 'day', 'days')}), ${F.h(planned, 1)} are planned ${scopeName(L, job) || ''} in those weeks.`.replace(/\s+\./, '.').replace(/\s{2,}/g, ' '))
            : T(L, `Abwesend ${F.date(first.from)} – ${F.date(first.to)} (${days} ${plural(days, 'Arbeitstag', 'Arbeitstage')}) – die verfügbare Zeit ist schon entsprechend kleiner.`, `Away ${F.date(first.from)} – ${F.date(first.to)} (${days} working ${plural(days, 'day', 'days')}) – the available time is already reduced accordingly.`),
          [ev(T(L, 'von', 'from'), first.from, 'date'), ev(T(L, 'bis', 'to'), first.to, 'date'), ev(T(L, 'Arbeitstage', 'working days'), days, 'd'), ...(planned > 0.5 ? [ev(T(L, 'geplant', 'planned'), planned, 'h')] : [])],
          planned > 0.5 ? { text: T(L, 'Vertretung für die Abwesenheit klären oder die Arbeit davor abschließen.', 'Arrange cover for the absence or finish the work before it.'), ask: T(L, 'Plane meine Woche auf 100 %', 'Plan my week to 100%'), evidence: [] } : null);
      }
      if (d.holidays.length) {
        const h0 = d.holidays[0];
        add('absences', 'info', 25, T(L, `${d.holidays.length} ${plural(d.holidays.length, 'Feiertag', 'Feiertage')} im Zeitraum, zuerst ${h0.name} am ${F.date(h0.date)} – schon von der verfügbaren Zeit abgezogen.`, `${d.holidays.length} public ${plural(d.holidays.length, 'holiday', 'holidays')} in the period, first ${h0.name} on ${F.date(h0.date)} – already taken off the available time.`),
          [ev(T(L, 'Feiertage', 'holidays'), d.holidays.length, 'n'), ev(h0.name.slice(0, 90), h0.date, 'date')]);
      }
    }
    const past = d.weeks.filter((w) => w.past && w.possible > 0);
    if (on('bookings') && past.length) {
      const poss = sum(past, (w) => w.possible), booked = sum(past, (w) => w.booked);
      const q = Math.round((booked / poss) * 100);
      const minPct = past[0].minPct;
      const low = past.filter((w) => (w.bookPct ?? 0) < w.minPct);
      if (low.length) {
        const miss = Math.max(0, sum(low, (w) => w.target - w.booked));
        add('bookings', q < minPct ? 'warn' : 'info', 66, T(L, `${F.h(booked, 1)} von ${F.h(poss, 1)} möglicher Zeit gebucht (${q} %) – in ${low.length} von ${past.length} Wochen unter dem Ziel von ${minPct} %.`, `${F.h(booked, 1)} of ${F.h(poss, 1)} possible time booked (${q}%) – below the ${minPct}% target in ${low.length} of ${past.length} weeks.`),
          [ev(T(L, 'gebucht', 'booked'), booked, 'h'), ev(T(L, 'möglich', 'possible'), poss, 'h'), ev(T(L, 'Quote', 'rate'), q, '%'), ev(T(L, 'Wochen unter Ziel', 'weeks below target'), low.length, 'n'), ev(T(L, 'Wochen', 'weeks'), past.length, 'n'), ev(T(L, 'Ziel', 'target'), minPct, '%')],
          { text: T(L, `Rund ${F.h(miss, 1)} bis zum Buchungsziel nachtragen.`, `Log about ${F.h(miss, 1)} to reach the booking target.`), ask: T(L, 'Prüfe meine Buchungen', 'Check my bookings'), evidence: [ev(T(L, 'fehlt', 'missing'), miss, 'h')] });
      } else {
        add('bookings', 'ok', 30, T(L, `${F.h(booked, 1)} von ${F.h(poss, 1)} möglicher Zeit gebucht (${q} %) – jede Woche über dem Ziel von ${minPct} %.`, `${F.h(booked, 1)} of ${F.h(poss, 1)} possible time booked (${q}%) – every week above the ${minPct}% target.`),
          [ev(T(L, 'gebucht', 'booked'), booked, 'h'), ev(T(L, 'möglich', 'possible'), poss, 'h'), ev(T(L, 'Quote', 'rate'), q, '%'), ev(T(L, 'Ziel', 'target'), minPct, '%')]);
      }
    }
    if (on('planActual')) {
      const pa = d.planActual;
      if (pa && (pa.plan > 0 || pa.book > 0)) {
        const diff = Math.abs(pa.diff);
        add('planActual', diff >= 4 ? 'warn' : 'ok', 55, T(L, `Plan vs. Ist (${pa.weeks} ${plural(pa.weeks, 'Woche', 'Wochen')}): ${F.h(pa.plan, 1)} geplant, ${F.h(pa.book, 1)} gebucht – ${pa.diff >= 0 ? `${F.h(diff, 1)} mehr` : `${F.h(diff, 1)} weniger`} als geplant.`, `Plan vs. actual (${pa.weeks} ${plural(pa.weeks, 'week', 'weeks')}): ${F.h(pa.plan, 1)} planned, ${F.h(pa.book, 1)} booked – ${F.h(diff, 1)} ${pa.diff >= 0 ? 'more' : 'less'} than planned.`),
          [ev(T(L, 'Wochen', 'weeks'), pa.weeks, 'n'), ev(T(L, 'geplant', 'planned'), pa.plan, 'h'), ev(T(L, 'gebucht', 'booked'), pa.book, 'h'), ev(T(L, 'Differenz', 'difference'), diff, 'h')],
          diff >= 4 ? { text: T(L, 'Im nächsten Weekly kurz klären, wohin die Zeit statt dessen ging.', 'Clarify briefly in the next weekly where the time went instead.'), ask: T(L, 'Plan vs. Ist', 'Plan vs. actual'), evidence: [] } : null);
      }
    }
    if (on('support') && (d.support.booked > 0 || d.support.reserve > 0)) {
      add('support', 'info', 45, d.support.weeks
        ? T(L, `Support: ${F.h(d.support.booked, 1)} in ${d.support.weeks} ${plural(d.support.weeks, 'Woche', 'Wochen')} gebucht; Reserve ${F.h(d.support.reserve, 1)} je Woche.`, `Support: ${F.h(d.support.booked, 1)} booked in ${d.support.weeks} ${plural(d.support.weeks, 'week', 'weeks')}; reserve ${F.h(d.support.reserve, 1)} per week.`)
        : T(L, `Support-Reserve: ${F.h(d.support.reserve, 1)} je Woche.`, `Support reserve: ${F.h(d.support.reserve, 1)} per week.`),
        [ev(T(L, 'Support gebucht', 'support booked'), d.support.booked, 'h'), ev(T(L, 'Wochen', 'weeks'), d.support.weeks, 'n'), ev(T(L, 'Reserve', 'reserve'), d.support.reserve, 'h')]);
    }
  } else if (d.kind === 'team') {
    const coming = d.weeks.filter((w) => !w.past);
    const over = coming.filter((w) => w.util > 1.0001);
    if (on('weeks') && coming.length) {
      const pk = [...coming].sort((a, b) => (Number.isFinite(b.util) ? b.util : 9) - (Number.isFinite(a.util) ? a.util : 9))[0];
      const p = pct(Number.isFinite(pk.util) ? pk.util : 0);
      add('weeks', over.length ? 'warn' : 'ok', over.length ? 80 : 40, over.length
        ? T(L, `${over.length} von ${coming.length} Wochen über 100 % – Spitze ${wk(pk)} mit ${p} % (${F.h(pk.plan)} geplant, ${F.h(pk.cap)} verfügbar).`, `${over.length} of ${coming.length} weeks over 100% – peak ${wk(pk)} at ${p}% (${F.h(pk.plan)} planned, ${F.h(pk.cap)} available).`)
        : T(L, `Keine Woche über 100 % – Spitze ${wk(pk)} mit ${p} %.`, `No week over 100% – peak ${wk(pk)} at ${p}%.`),
        [ev(T(L, 'Wochen über 100 %', 'weeks over 100%'), over.length, 'n'), ev(T(L, 'Wochen', 'weeks'), coming.length, 'n'), ev(T(L, 'Spitze', 'peak'), p, '%'), ev(T(L, 'geplant', 'planned'), pk.plan, 'h'), ev(T(L, 'verfügbar', 'available'), pk.cap, 'h'), ev(T(L, 'Ziel', 'target'), 100, '%')],
        over.length ? { text: T(L, `Team ${d.name} realistisch planen lassen – Lotse verteilt nach Priorität, ohne Überstunden.`, `Let Lotse plan team ${d.name} realistically – by priority, without overtime.`), ask: T(L, `Plane Team ${d.name} realistisch`, `Plan team ${d.name} realistically`), evidence: [] } : null);
      const people = Math.max(0, ...coming.map((w) => w.over || 0));
      if (people) add('weeks', 'warn', 70, T(L, `Bis zu ${people} ${plural(people, 'Person', 'Personen')} gleichzeitig über 100 %.`, `Up to ${people} ${plural(people, 'person', 'people')} over 100% at the same time.`), [ev(T(L, 'Personen über 100 %', 'people over 100%'), people, 'n'), ev(T(L, 'Ziel', 'target'), 100, '%')]);
    }
    if ((on('overdue') || on('risks')) && (d.overdue.length || d.blocked.length)) {
      add('overdue', d.overdue.length ? 'bad' : 'warn', 75, T(L, `${d.overdue.length} überfällige und ${d.blocked.length} blockierte ${plural(d.overdue.length + d.blocked.length, 'Story', 'Stories')}${d.overdue.length ? `, zuerst ${d.overdue[0].key}` : ''}.`, `${d.overdue.length} overdue and ${d.blocked.length} blocked ${plural(d.overdue.length + d.blocked.length, 'story', 'stories')}${d.overdue.length ? `, first ${d.overdue[0].key}` : ''}.`),
        [ev(T(L, 'überfällig', 'overdue'), d.overdue.length, 'n'), ev(T(L, 'blockiert', 'blocked'), d.blocked.length, 'n'), ...d.overdue.slice(0, 3).map((t) => ev(t.key, t.due, 'date', { key: t.key, text: t.summary.slice(0, 150) })), ...d.blocked.slice(0, 2).map((t) => ev(t.key, null, null, { key: t.key }))],
        { text: T(L, 'Überfälliges im Weekly neu terminieren, Blockaden mit den Verantwortlichen klären.', 'Re-date overdue work in the weekly, clear blockers with the people responsible.'), ask: T(L, 'Bereite das Weekly vor', 'Prepare the weekly'), evidence: [] });
    }
    if (on('absences') && d.absences.length) {
      const days = sum(d.absences, (a) => a.days);
      add('absences', 'info', 40, T(L, `${d.absences.length} ${plural(d.absences.length, 'Abwesenheit', 'Abwesenheiten')} im Zeitraum, zusammen ${days} ${plural(days, 'Arbeitstag', 'Arbeitstage')}.`, `${d.absences.length} ${plural(d.absences.length, 'absence', 'absences')} in the period, ${days} working ${plural(days, 'day', 'days')} together.`),
        [ev(T(L, 'Abwesenheiten', 'absences'), d.absences.length, 'n'), ev(T(L, 'Arbeitstage', 'working days'), days, 'd')]);
    }
    if (on('support') && d.support.booked != null && (d.support.booked > 0 || d.support.reserve > 0)) add('support', 'info', 50, T(L, `Support-Last: ${F.h(d.support.booked, 1)} auf Tickets des Teams in ${d.support.weeks} ${plural(d.support.weeks, 'Woche', 'Wochen')} gebucht; Reserve ${F.h(d.support.reserve, 1)} je Woche.`, `Support load: ${F.h(d.support.booked, 1)} booked on the team's tickets in ${d.support.weeks} ${plural(d.support.weeks, 'week', 'weeks')}; reserve ${F.h(d.support.reserve, 1)} per week.`), [ev(T(L, 'Support gebucht', 'support booked'), d.support.booked, 'h'), ev(T(L, 'Wochen', 'weeks'), d.support.weeks, 'n'), ev(T(L, 'Reserve', 'reserve'), d.support.reserve, 'h'), ...(d.support.keys || []).slice(0, 3).map((k) => ev(k, null, null, { key: k }))]);
    else if (on('support') && d.support.reserve > 0) add('support', 'info', 35, T(L, `Support-Reserve ${F.h(d.support.reserve, 1)} je Woche – schon von der Kapazität abgezogen.`, `Support reserve ${F.h(d.support.reserve, 1)} per week – already taken off the capacity.`), [ev(T(L, 'Reserve', 'reserve'), d.support.reserve, 'h')]);
    if (on('support') && d.support.risk?.length) {
      const r0 = d.support.risk[0];
      const br = d.support.risk.filter((x) => x.status === 'breached').length;
      add('support', br ? 'bad' : 'warn', br ? 84 : 68, T(L, `${d.support.risk.length} offene ${plural(d.support.risk.length, 'Ticket', 'Tickets')} mit SLA-Risiko (${br} gerissen) – zuerst ${r0.key} (${r0.left < 0 ? `${F.h(-r0.left, 1)} über dem SLA` : `${F.h(r0.left, 1)} SLA übrig`}).`, `${d.support.risk.length} open ${plural(d.support.risk.length, 'ticket', 'tickets')} at SLA risk (${br} breached) – first ${r0.key} (${r0.left < 0 ? `${F.h(-r0.left, 1)} over the SLA` : `${F.h(r0.left, 1)} of SLA left`}).`),
        [ev(T(L, 'SLA-Risiko', 'SLA risk'), d.support.risk.length, 'n'), ev(T(L, 'gerissen', 'breached'), br, 'n'), ev(r0.left < 0 ? T(L, 'über SLA', 'over SLA') : T(L, 'SLA übrig', 'SLA left'), Math.abs(r0.left), 'h', { key: r0.key, text: r0.summary.slice(0, 120) }), ...d.support.risk.slice(1, 4).map((x) => ev(x.key, Math.abs(x.left), 'h', { key: x.key }))],
        { text: T(L, `${r0.key} und die anderen Tickets mit gerissenem SLA zuerst verteilen.`, `Dispatch ${r0.key} and the other tickets with a breached SLA first.`), ask: T(L, 'Verteile die neuen Support-Tickets', 'Distribute the new support tickets'), evidence: [ev(r0.key, null, null, { key: r0.key })] });
    }
    const past = d.weeks.filter((w) => w.past && w.possible > 0);
    if (on('bookings') && past.length) {
      const poss = sum(past, (w) => w.possible), booked = sum(past, (w) => w.booked);
      const q = Math.round((booked / poss) * 100);
      add('bookings', q < past[0].minPct ? 'warn' : 'ok', 50, T(L, `Das Team hat ${F.h(booked)} von ${F.h(poss)} möglichen Stunden gebucht (${q} %).`, `The team booked ${F.h(booked)} of ${F.h(poss)} possible hours (${q}%).`), [ev(T(L, 'gebucht', 'booked'), booked, 'h'), ev(T(L, 'möglich', 'possible'), poss, 'h'), ev(T(L, 'Quote', 'rate'), q, '%')]);
    }
  } else if (d.kind === 'project') {
    if (on('progress')) {
      const p = d.progress != null ? Math.round(d.progress * 100) : null;
      add('progress', d.daysOverdue > 0 ? 'bad' : 'ok', d.daysOverdue > 0 ? 82 : 45, d.daysOverdue > 0
        ? T(L, `${p ?? 0} % fertig, ${d.daysOverdue} ${plural(d.daysOverdue, 'Tag', 'Tage')} über dem Termin ${F.date(d.due)}; ${d.open} offene Stories mit ${F.h(d.remaining)} Rest.`, `${p ?? 0}% done, ${d.daysOverdue} ${plural(d.daysOverdue, 'day', 'days')} past the due date ${F.date(d.due)}; ${d.open} open stories with ${F.h(d.remaining)} remaining.`)
        : T(L, `${p ?? 0} % fertig${d.due ? `, Termin ${F.date(d.due)}` : ''}; ${d.open} offene Stories mit ${F.h(d.remaining)} Rest.`, `${p ?? 0}% done${d.due ? `, due ${F.date(d.due)}` : ''}; ${d.open} open stories with ${F.h(d.remaining)} remaining.`),
        [ev(T(L, 'Fortschritt', 'progress'), p ?? 0, '%'), ev(T(L, 'Tage über Termin', 'days late'), d.daysOverdue, 'd'), ...(d.due ? [ev(T(L, 'Termin', 'due'), d.due, 'date')] : []), ev(T(L, 'offene Stories', 'open stories'), d.open, 'n'), ev(T(L, 'Rest', 'remaining'), d.remaining, 'h')]);
    }
    if ((on('overdue') || on('risks') || on('tasks')) && d.overdue.length) {
      const h = sum(d.overdue, (t) => t.re);
      add('overdue', 'bad', 80, T(L, `${d.overdue.length} überfällige ${plural(d.overdue.length, 'Story', 'Stories')} mit ${F.h(h, 1)} Rest, am längsten ${d.overdue.slice().sort((a, b) => b.days - a.days)[0].key}.`, `${d.overdue.length} overdue ${plural(d.overdue.length, 'story', 'stories')} with ${F.h(h, 1)} remaining, longest ${d.overdue.slice().sort((a, b) => b.days - a.days)[0].key}.`),
        [ev(T(L, 'überfällig', 'overdue'), d.overdue.length, 'n'), ev(T(L, 'Rest', 'remaining'), h, 'h'), ...d.overdue.slice().sort((a, b) => b.days - a.days).slice(0, 4).map((t) => ev(t.key, t.due, 'date', { key: t.key, text: t.summary.slice(0, 150) }))],
        { text: T(L, 'Mit den Bearbeitenden neue, realistische Termine vereinbaren – Lotse plant sie auf Wunsch ein.', 'Agree new, realistic dates with the assignees – Lotse can plan them in.'), ask: T(L, 'Löse die Terminkonflikte', 'Fix the schedule conflicts'), evidence: [] });
    }
    if ((on('overdue') || on('risks')) && d.blocked.length) add('overdue', 'warn', 70, T(L, `${d.blocked.length} ${plural(d.blocked.length, 'Story ist', 'Stories sind')} blockiert: ${d.blocked.slice(0, 3).map((t) => t.key).join(', ')}.`, `${d.blocked.length} ${plural(d.blocked.length, 'story is', 'stories are')} blocked: ${d.blocked.slice(0, 3).map((t) => t.key).join(', ')}.`),
      [ev(T(L, 'blockiert', 'blocked'), d.blocked.length, 'n'), ...d.blocked.slice(0, 4).map((t) => ev(t.key, null, null, { key: t.key, text: (t.reason || t.summary).slice(0, 150) }))]);
    if ((on('risks') || on('tasks')) && d.noEstimate.length) add('tasks', 'warn', 55, T(L, `${d.noEstimate.length} offene ${plural(d.noEstimate.length, 'Story hat', 'Stories haben')} keine Schätzung.`, `${d.noEstimate.length} open ${plural(d.noEstimate.length, 'story has', 'stories have')} no estimate.`),
      [ev(T(L, 'ohne Schätzung', 'without estimate'), d.noEstimate.length, 'n')], { text: T(L, 'Schätzungen ergänzen – Lotse schlägt Werte aus ähnlicher Arbeit vor.', 'Add the estimates – Lotse suggests values from similar work.'), ask: T(L, `Fülle die Lücken in ${d.name}`, `Fill the gaps in ${d.name}`), evidence: [] });
    if (on('weeks') && d.weeks.length) {
      const h = sum(d.weeks, (w) => w.plan);
      add('weeks', 'info', 30, T(L, `${F.h(h)} sind in den nächsten ${d.weeks.length} Wochen eingeplant.`, `${F.h(h)} are planned in the next ${d.weeks.length} weeks.`), [ev(T(L, 'geplant', 'planned'), h, 'h'), ev(T(L, 'Wochen', 'weeks'), d.weeks.length, 'n')]);
    }
  }
  if (!out.length) out.push({ block: 'risks', tone: 'ok', impact: 10, text: T(L, 'Nichts Auffälliges in den gewählten Bausteinen – keine Risiken gefunden.', 'Nothing unusual in the chosen blocks – no risks found.'), evidence: [] });
  return out.sort((a, b) => b.impact - a.impact);
}

// ---------- the whole job: every selected subject with its data and findings (memoised per data state + job) ----------
const jobKey = (job) => JSON.stringify([job.scope?.kind, job.scope?.ref, job.subjects, job.blocks, job.window?.past, job.window?.next, job.people || null]);
export function runJob(ctx, job) {
  return memo(ctx, `orch:run:${langOf(ctx)}:${jobKey(job)}`, () => {
    const all = subjectsOf(ctx, job);
    const pick = job.people ? all.filter((s) => job.people.includes(s.id)) : all;
    const subjects = pick.map((s) => { const d = subjectData(ctx, job, s); return { subject: s, data: d, findings: assess(ctx, job, d) }; });
    return { all, subjects, weeks: jobWeeks(ctx, job.window) };
  });
}
