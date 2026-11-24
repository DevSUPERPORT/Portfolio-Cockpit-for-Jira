// Sends the data-quality reminders (UC-13) – ONLY when a Jira admin switched notices on
// (config.notices.enabled, default false). Called from the hourly job; at most once per rhythm period.
// Delivery: Jira's own "notify" on one of the recipient's work items (no e-mail service of our own,
// nothing leaves Atlassian). Booking notices (UC-19) below use the same path.
import { jira } from './jira.js';
import { K, get, set, del, audit } from './store.js';
import { due, gapReminders, validNotices, bookingNotices, bookingPeriod, bookingDue } from '../../shared/notices.js';

const MAX_PER_RUN = 200;

function body(r) {
  const head = `Portfolio Cockpit: ${r.count} fehlende Werte an deinen Vorgängen${r.urgent ? ` (${r.urgent} dringend)` : ''} / ${r.count} missing values on your work items${r.urgent ? ` (${r.urgent} urgent)` : ''}`;
  return { subject: head, text: `${head}\n\n${r.lines.join('\n')}\n\nBitte direkt in Jira oder im Portfolio Cockpit (Meine Arbeit › Fehlende Werte) ergänzen. / Please fill them in Jira or in Portfolio Cockpit (My work › Missing values).` };
}

// deps injectable for tests: { now, loadGaps, send, store }
export async function runNotices(cfg, deps = {}) {
  const n = validNotices(cfg.notices);
  if (!n.enabled) return { sent: 0, skipped: 'disabled' };
  const store = deps.store || { get, set };
  const now = deps.now || new Date().toISOString();
  const last = (await store.get(K.noticesLast)) || {};
  if (!due(n.gaps, last.gaps, now)) return { sent: 0, skipped: 'not due' };
  const gaps = await deps.loadGaps();
  const list = gapReminders(gaps).slice(0, MAX_PER_RUN);
  const send = deps.send || ((anchor, msg, to) => jira('app', `/rest/api/3/issue/${anchor}/notify`, { method: 'POST', body: { subject: msg.subject, textBody: msg.text, to: { users: to.map((accountId) => ({ accountId })) } } }));
  let sent = 0, failed = 0;
  for (const r of list) {
    try { await send(r.anchor, body(r), [r.to]); sent += 1; } catch { failed += 1; }
  }
  await store.set(K.noticesLast, { ...last, gaps: now });
  if (!deps.store) await audit({ accountId: 'app', displayName: 'Portfolio Cockpit' }, 'notices.gaps', { sent, failed }).catch(() => {});
  return { sent, failed };
}

// ---------- booking notices (UC-19) ----------
// Once per checked period (day / week / month, see config.booking.schedule), after the grace period:
// people below the minimum rate get a notice; with at least escalatePct missing, the team's responsible
// people (+ project owners or management, config.booking.escalateTo) get an escalation. Worklogs are read
// as the app for exactly that period; possible time = the same calculation as the booking table.
function bookingBody(r, period, names, kind) {
  const pct = Math.round(r.rate * 100), miss = Math.round(r.missing * 10) / 10;
  const span = period.from === period.to ? period.from : `${period.from} – ${period.to}`;
  if (kind === 'booking') {
    const head = `Portfolio Cockpit: ${pct} % deiner möglichen Arbeitszeit gebucht (${span}) / ${pct}% of your possible working time booked (${span})`;
    return { subject: head, text: `${head}\n\nEs fehlen etwa ${miss} h. Bitte die Zeiten in Jira oder im Portfolio Cockpit (Meine Arbeit) nachtragen. / About ${miss} h are missing. Please log your time in Jira or in Portfolio Cockpit (My work).` };
  }
  const who = names[r.about] || 'Eine Person / A person';
  const head = `Portfolio Cockpit: ${who} – ${pct} % gebucht (${span}) / ${pct}% booked (${span})`;
  return { subject: head, text: `${head}\n\nEs fehlen etwa ${miss} h der möglichen Arbeitszeit (Eskalation laut Buchungskontrolle). / About ${miss} h of the possible working time are missing (escalation per the booking check).` };
}

// deps injectable for tests: { now, store, loadData({ from, to }) → { ds, worklogs }, overview(model, booked, a, b, cfg), groupMembers(groupId) → [accountId], send }
export async function runBookingNotices(cfg, deps = {}) {
  const n = validNotices(cfg.notices);
  const bk = { minPct: 90, escalatePct: 20, graceDays: 2, escalateTo: 'lead', schedule: 'week', enabled: true, ...(cfg.booking || {}) };
  if (!n.enabled || !n.booking || !bk.enabled) return { sent: 0, skipped: 'disabled' };
  const store = deps.store || { get, set };
  const today = (deps.now || new Date().toISOString()).slice(0, 10);
  const last = (await store.get(K.noticesLast)) || {};
  const period = bookingPeriod(bk.schedule, today);
  if (!bookingDue(period, today, bk.graceDays, last.booking)) return { sent: 0, skipped: 'not due', period: period.key };
  const data = await deps.loadData(period);
  const { ds, model } = data;
  const { rows, booked, names } = bookingRows(data, period);
  const teams = ds.capacity?.teams || {};
  const ownersOf = (id) => [...new Set(Object.keys(booked.people[id]?.byIssue || {}).map((iid) => model.itemByRef.get(model.byId.get(String(iid))?.rootRef)?.owner?.id).filter(Boolean))];
  let management = [];
  if (bk.escalateTo === 'mgmt') for (const g of cfg.roles?.groups?.management || []) management = management.concat(await deps.groupMembers(g.id).catch(() => []));
  const list = bookingNotices(rows, bk, { responsibleOf: (t) => teams[t]?.responsible || [], ownersOf, management: [...new Set(management)] }).slice(0, MAX_PER_RUN);
  const send = deps.send || defaultSend;
  let sent = 0, failed = 0;
  for (const r of list) {
    try { await send(r.anchor, bookingBody(r, period, names, r.kind), Array.isArray(r.to) ? r.to : [r.to]); sent += 1; } catch { failed += 1; }
  }
  await store.set(K.noticesLast, { ...last, booking: period.key });
  if (!deps.store) await audit({ accountId: 'app', displayName: 'Portfolio Cockpit' }, 'notices.booking', { period: period.key, sent, failed, notices: list.filter((x) => x.kind === 'booking').length, escalations: list.filter((x) => x.kind === 'escalation').length }).catch(() => {});
  return { sent, failed, period: period.key };
}
const defaultSend = (anchor, msg, to) => jira('app', `/rest/api/3/issue/${anchor}/notify`, { method: 'POST', body: { subject: msg.subject, textBody: msg.text, to: { users: to.map((accountId) => ({ accountId })) } } });

// The booking table of one period as the notices need it: one row per person with possible and booked hours and the
// work item a notice is sent "about" (the one they booked most on, else one assigned to them).
// data = { ds, worklogs: [{ a, i, d, h }], model, overview(model, booked, period) }
export function bookingRows({ ds, worklogs, model, overview }, period) {
  const booked = { people: {} };
  for (const w of worklogs || []) {
    const p = booked.people[w.a] || (booked.people[w.a] = { h: 0, last: null, byIssue: {} });
    p.h += w.h; p.byIssue[w.i] = (p.byIssue[w.i] || 0) + w.h; if (!p.last || w.d > p.last) p.last = w.d;
  }
  const assigned = new Map();
  for (const i of ds.issues || []) if (i.assignee?.id && !assigned.has(i.assignee.id)) assigned.set(i.assignee.id, i.id);
  const anchorOf = (id) => { const b = Object.entries(booked.people[id]?.byIssue || {}).sort((x, y) => y[1] - x[1])[0]; return b ? b[0] : assigned.get(id) || null; };
  const rows = overview(model, booked, period).rows.filter((r) => r.possible > 0)
    .map((r) => ({ accountId: r.id, teamId: r.teamId, possible: r.possible, booked: r.booked, anchor: anchorOf(r.id) }));
  const names = Object.fromEntries(Object.entries(ds.people || {}).map(([id, p]) => [id, p?.name || '']));
  return { rows, booked, names };
}

// ---------- a reminder on request (Lotse's notice.remind, resolver notices.remind) ----------
// The SAME messages as the scheduled run – the gaps reminder or the booking notice of the last checked period – to the
// people a capacity editor or Jira admin names. Only while a Jira admin switched notices on. At most one reminder per
// person, kind and day (the marks of a day: notices:remind:<day> → { 'booking:<accountId>': ISO }, deleted the next day).
// dryRun: nothing is sent or marked – only who would get one. Every real run is audited (kind, counts, recipients).
export const REMIND_KEY = (day) => `notices:remind:${day}`;
export const REMIND_MAX = 100;
export class NoticesOff extends Error { constructor() { super('NOTICES_OFF'); this.code = 'NOTICES_OFF'; } }

// deps: { now, store: { get, set, del }, loadGaps(), loadData(period), send, audit(details) }
export async function remindPeople(cfg, { kind, accountIds, dryRun = false }, deps = {}) {
  const n = validNotices(cfg.notices);
  if (!n.enabled) throw new NoticesOff();
  if (!['booking', 'gaps'].includes(kind)) throw Object.assign(new Error('kind'), { code: 'INVALID' });
  const ids = [...new Set((accountIds || []).filter((x) => typeof x === 'string' && x))].slice(0, REMIND_MAX);
  const store = deps.store || { get, set, del };
  const now = deps.now || new Date().toISOString();
  const day = now.slice(0, 10);
  const marks = (await store.get(REMIND_KEY(day))) || {};
  const out = { kind, dryRun, people: ids.length, sent: 0, would: 0, limited: 0, nothing: 0, failed: 0, results: [] };
  // what each person would get – the existing messages, unchanged
  let msgs = new Map(), period = null;
  if (kind === 'gaps') {
    const all = gapReminders(await deps.loadGaps());
    for (const r of all) if (ids.includes(r.to)) msgs.set(r.to, { anchor: r.anchor, msg: body(r) });
  } else {
    const bk = { minPct: 90, escalatePct: 20, graceDays: 2, schedule: 'week', ...(cfg.booking || {}) };
    period = bookingPeriod(bk.schedule, day);
    const { rows, names } = bookingRows(await deps.loadData(period), period);
    // the person's own notice only – escalations stay with the scheduled run
    for (const r of bookingNotices(rows.filter((x) => ids.includes(x.accountId)), { ...bk, escalatePct: 101 })) if (r.kind === 'booking') msgs.set(r.to, { anchor: r.anchor, msg: bookingBody(r, period, names, 'booking') });
    out.period = { from: period.from, to: period.to };
  }
  const send = deps.send || defaultSend;
  const due = [];
  for (const id of ids) {
    const m = msgs.get(id);
    if (!m) { out.nothing += 1; out.results.push({ accountId: id, status: 'nothing' }); continue; }
    if (marks[`${kind}:${id}`]) { out.limited += 1; out.results.push({ accountId: id, status: 'limited' }); continue; }
    due.push([id, m]);
  }
  if (dryRun) { out.would = due.length; for (const [id] of due) out.results.push({ accountId: id, status: 'would' }); return out; }
  // mark first, then send: a second request in the same moment finds the mark and does not send twice
  if (due.length) {
    const next = { ...marks };
    for (const [id] of due) next[`${kind}:${id}`] = now;
    await store.set(REMIND_KEY(day), next);
    await Promise.resolve(store.del?.(REMIND_KEY(new Date(Date.parse(`${day}T00:00:00Z`) - 864e5).toISOString().slice(0, 10)))).catch(() => null);
  }
  for (const [id, m] of due) {
    try { await send(m.anchor, m.msg, [id]); out.sent += 1; out.results.push({ accountId: id, status: 'sent' }); } catch { out.failed += 1; out.results.push({ accountId: id, status: 'failed' }); }
  }
  await Promise.resolve(deps.audit?.({ kind, sent: out.sent, limited: out.limited, nothing: out.nothing, failed: out.failed, to: due.map(([id]) => id), ...(period ? { period: period.key } : {}) })).catch(() => null);
  return out;
}
