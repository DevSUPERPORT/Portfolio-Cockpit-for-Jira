// "Meine Arbeit" (UC-20): the signed-in person's own tasks and worklogs for one week, and booking them.
// Everything runs AS THE USER: Jira decides what they may see and whether they may log work. The app only ever
// changes worklogs whose author is the caller – never someone else's, even with "edit all worklogs" permission.
import { jira, searchAll, pool } from './jira.js';
import { ticketServices } from './config.js';
import { K, get } from './store.js';
import { evidenceOf } from '../../shared/mineSuggest.js';

export { evidenceOf }; // pure, shared with the local mock (shared/mineSuggest.js)

const DAY = 86400000;
const H = (sec) => (sec ? Math.round((sec / 3600) * 100) / 100 : 0);
const dateOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const ID_RE = /^\d{1,18}$/;
// Limits: quarter hours, at most 24 h per cell, a quarter year back, two weeks ahead.
export const MINE_LIMITS = { step: 0.25, maxHours: 24, pastDays: 92, futureDays: 14, maxComment: 1000, maxExtra: 30 };

class MineError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }
const bad = (msg) => new MineError('INVALID', msg);

// ---------- validation (pure, tested) ----------
export function quarterHours(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > MINE_LIMITS.maxHours) return null;
  return Math.round(n / MINE_LIMITS.step) * MINE_LIMITS.step;
}
export function validBookingDate(date, todayIso) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const d = Date.parse(`${date}T00:00:00Z`), t = Date.parse(`${todayIso}T00:00:00Z`);
  return Number.isFinite(d) && d >= t - MINE_LIMITS.pastDays * DAY && d <= t + MINE_LIMITS.futureDays * DAY;
}
// Jira's "started": noon of that day in the person's own time zone, so the worklog never slips to another day.
export function startedOf(date, tzMinutes) {
  const tz = Number.isInteger(tzMinutes) && Math.abs(tzMinutes) <= 14 * 60 ? tzMinutes : 0;
  const sign = tz < 0 ? '-' : '+', a = Math.abs(tz);
  return `${date}T12:00:00.000${sign}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`;
}
// How a cell's new total is applied to the worklogs of that day (oldest first). One cell = all of my worklogs on
// that work item and day. Only the LATEST of them changes; the others stay as they are.
export function planCell(mine, target) {
  const list = [...mine].sort((a, b) => String(a.started).localeCompare(String(b.started)) || String(a.id).localeCompare(String(b.id)));
  const sum = list.reduce((t, w) => t + w.h, 0);
  if (Math.abs(sum - target) < 0.001) return { op: 'none' };
  if (!list.length) return target > 0 ? { op: 'create', hours: target } : { op: 'none' };
  const last = list[list.length - 1];
  const others = sum - last.h;
  const next = Math.round((target - others) * 100) / 100;
  if (next < -0.001) return { op: 'refuse', others };
  if (next < 0.001) return { op: 'delete', id: last.id };
  return { op: 'update', id: last.id, hours: next };
}
export const adf = (text) => (text ? { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } : undefined);
// An emptied comment: an empty paragraph (Jira refuses empty text nodes).
const adfOrEmpty = (text) => adf(text) || { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [] }] };
export function adfText(doc) {
  if (!doc) return '';
  if (typeof doc === 'string') return doc;
  const out = [];
  const walk = (n) => { if (!n) return; if (n.type === 'text' && n.text) out.push(n.text); (n.content || []).forEach(walk); if (n.type === 'paragraph') out.push(' '); };
  walk(doc);
  return out.join('').replace(/\s+/g, ' ').trim();
}

// ---------- read ----------
const fieldsOf = (cfg) => ['summary', 'issuetype', 'status', 'project', 'assignee', 'duedate', 'timeoriginalestimate', 'timeestimate', 'timespent', 'parent', 'labels', cfg.fields?.startDate].filter(Boolean);
function shape(cfg, i, me) {
  const f = i.fields || {};
  const cat = f.status?.statusCategory?.key;
  return {
    id: String(i.id), key: i.key, summary: f.summary || '',
    type: { name: f.issuetype?.name || '', subtask: !!f.issuetype?.subtask, icon: f.issuetype?.iconUrl || null },
    status: { id: String(f.status?.id || ''), name: f.status?.name || '', cat: cat === 'done' ? 'done' : cat === 'indeterminate' ? 'indeterminate' : 'new' },
    project: { id: String(f.project?.id || ''), key: f.project?.key || '', name: f.project?.name || '' },
    assignee: f.assignee ? { id: f.assignee.accountId, name: f.assignee.displayName || '' } : null,
    mine: f.assignee?.accountId === me,
    start: cfg.fields?.startDate ? dateOf(f[cfg.fields.startDate]) : null, due: dateOf(f.duedate),
    oe: H(f.timeoriginalestimate), re: H(f.timeestimate), ts: H(f.timespent), hasEstimate: f.timeoriginalestimate != null || f.timeestimate != null,
    parent: f.parent ? { id: String(f.parent.id), key: f.parent.key, summary: f.parent.fields?.summary || '' } : null,
    support: ticketServices(cfg, { projectId: String(f.project?.id || ''), typeId: String(f.issuetype?.id || ''), labels: f.labels || [] }).length > 0,
  };
}
async function myWorklogs(issueId, me, from, to) {
  const a = Date.parse(`${from}T00:00:00Z`) - DAY, b = Date.parse(`${to}T00:00:00Z`) + 2 * DAY;
  const r = await jira('user', `/rest/api/3/issue/${issueId}/worklog`, { query: { startedAfter: a, startedBefore: b, maxResults: 5000 } });
  return (r.worklogs || []).filter((w) => w.author?.accountId === me).map((w) => ({ id: String(w.id), issueId: String(issueId), d: dateOf(w.started), started: w.started, h: H(w.timeSpentSeconds), c: adfText(w.comment) }))
    .filter((w) => w.d && w.d >= from && w.d <= to);
}
export async function mineWeek(cfg, me, { from, to, extraIds = [] }) {
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from || Date.parse(to) - Date.parse(from) > 13 * DAY) throw bad('week range');
  const fields = fieldsOf(cfg);
  const sf = cfg.fields?.startDate ? /^customfield_(\d+)$/.exec(cfg.fields.startDate)?.[1] : null;
  const inWeek = [`(duedate >= "${from}" AND duedate <= "${to}")`, sf ? `(cf[${sf}] >= "${from}" AND cf[${sf}] <= "${to}")` : null].filter(Boolean).join(' OR ');
  const assignedJql = `assignee = currentUser() AND (statusCategory != Done OR ${inWeek} OR updated >= -14d) ORDER BY updated DESC`;
  const workedJql = `worklogAuthor = currentUser() AND worklogDate >= "${from}" AND worklogDate <= "${to}"`;
  const extra = [...new Set((Array.isArray(extraIds) ? extraIds : []).map(String).filter((x) => ID_RE.test(x)))].slice(0, MINE_LIMITS.maxExtra);
  const [assigned, worked, added] = await Promise.all([
    searchAll('user', assignedJql, fields, { limit: 300 }),
    searchAll('user', workedJql, fields, { limit: 300 }),
    extra.length ? searchAll('user', `id in (${extra.join(',')})`, fields, { limit: MINE_LIMITS.maxExtra }) : { issues: [] },
  ]);
  const byId = new Map();
  for (const i of [...assigned.issues, ...worked.issues, ...added.issues]) byId.set(String(i.id), shape(cfg, i, me));
  const worklogs = [];
  await pool(worked.issues, 6, async (i) => { worklogs.push(...await myWorklogs(i.id, me, from, to)); });
  return { from, to, issues: [...byId.values()], worklogs, truncated: !!(assigned.truncated || worked.truncated) };
}

// ---------- evidence: what I actually did in the week (read-only, as the user) ----------
// Every work item I updated in the week (Jira's updatedBy), then MY changelog entries and MY comments on it, by day.
// This is the raw record the week is reconstructed from; nothing here is written, scored or sent anywhere else.
export const EVIDENCE_LIMIT = 60;
async function changelogTail(issueId) {
  const first = await jira('user', `/rest/api/3/issue/${issueId}/changelog`, { query: { startAt: 0, maxResults: 100 } });
  if ((first.total || 0) <= 100) return first.values || [];
  const last = await jira('user', `/rest/api/3/issue/${issueId}/changelog`, { query: { startAt: Math.max(0, first.total - 100), maxResults: 100 } });
  return last.values || [];
}
// The configured planning fields (start date, team, T-shirt size, target quarters, milestone and the app's own fields)
// on top of Jira's own (shared/mineSuggest.js): changing them is planning, not work – e.g. "Apply in Jira" in Weekly
// planning sets start and due date as the planner.
async function planningFieldIds(cfg) {
  const app = (await get(K.appFields).catch(() => null)) || {};
  const f = cfg.fields || {};
  return [f.startDate, f.team, f.tshirt, f.targetQuarters, f.milestone, app.rank, app.tshirt, app.targetQuarters].filter((x) => typeof x === 'string' && /^customfield_\d+$/.test(x));
}
// Jira does not accept currentUser() inside updatedBy(); the account id comes from the trusted invocation context and
// is checked against Atlassian's id format before it goes into the query (no injection).
export const ACCOUNT_RE = /^[A-Za-z0-9:_-]{1,128}$/;
export function evidenceJql(me, from, to) {
  if (!ACCOUNT_RE.test(String(me || ''))) throw bad('account');
  return `issue in updatedBy("${me}", "${from.replace(/-/g, '/')}", "${to.replace(/-/g, '/')}") ORDER BY updated DESC`;
}
export async function mineEvidence(cfg, me, { from, to }) {
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from || Date.parse(to) - Date.parse(from) > 13 * DAY) throw bad('week range');
  const jql = evidenceJql(me, from, to);
  const found = await searchAll('user', jql, fieldsOf(cfg), { limit: EVIDENCE_LIMIT });
  const planning = await planningFieldIds(cfg);
  const events = [];
  await pool(found.issues, 6, async (i) => {
    const [hist, com] = await Promise.all([
      changelogTail(i.id).catch(() => []),
      jira('user', `/rest/api/3/issue/${i.id}/comment`, { query: { maxResults: 100, orderBy: '-created' } }).then((r) => r.comments || []).catch(() => []),
    ]);
    events.push(...evidenceOf(i.id, me, from, to, hist, com, { planning }));
  });
  return { from, to, issues: found.issues.map((i) => shape(cfg, i, me)), events, truncated: !!found.truncated };
}

// ---------- write ----------
async function issueFacts(cfg, issueId, me) {
  const i = await jira('user', `/rest/api/3/issue/${issueId}`, { query: { fields: fieldsOf(cfg).join(',') } });
  return shape(cfg, i, me);
}
// Sets the hours of one cell (work item × day) to `hours`; 0 removes the day's booking. Optional comment.
export async function mineBook(cfg, me, payload, todayIso) {
  const issueId = String(payload.issueId ?? '');
  if (!ID_RE.test(issueId)) throw bad('issueId');
  if (!validBookingDate(payload.date, todayIso)) throw bad(`date must be within ${MINE_LIMITS.pastDays} days back and ${MINE_LIMITS.futureDays} days ahead`);
  const hours = quarterHours(payload.hours);
  if (hours == null) throw bad(`hours must be 0–${MINE_LIMITS.maxHours}`);
  const comment = payload.comment == null ? null : String(payload.comment).trim().slice(0, MINE_LIMITS.maxComment);
  const before = await issueFacts(cfg, issueId, me);
  if (before.type.subtask) throw new MineError('SUBTASK_NOT_BOOKABLE', 'Sub-tasks cannot be booked yet');
  const day = await myWorklogs(issueId, me, payload.date, payload.date);
  const plan = planCell(day, hours);
  const q = { adjustEstimate: 'auto', notifyUsers: 'false' };
  if (plan.op === 'refuse') throw new MineError('MULTIPLE_WORKLOGS', `other bookings on this day already add up to ${plan.others} h`);
  if (plan.op === 'create') {
    await jira('user', `/rest/api/3/issue/${issueId}/worklog`, { method: 'POST', query: q, body: { timeSpentSeconds: Math.round(plan.hours * 3600), started: startedOf(payload.date, payload.tz), ...(comment ? { comment: adf(comment) } : {}) } });
  } else if (plan.op === 'update') {
    await jira('user', `/rest/api/3/issue/${issueId}/worklog/${plan.id}`, { method: 'PUT', query: q, body: { timeSpentSeconds: Math.round(plan.hours * 3600), ...(comment != null ? { comment: adfOrEmpty(comment) } : {}) } });
  } else if (plan.op === 'delete') {
    await jira('user', `/rest/api/3/issue/${issueId}/worklog/${plan.id}`, { method: 'DELETE', query: { adjustEstimate: 'auto', notifyUsers: 'false' } });
  } else if (plan.op === 'none' && comment != null && day.length) {
    const last = [...day].sort((a, b) => String(a.started).localeCompare(String(b.started))).at(-1);
    await jira('user', `/rest/api/3/issue/${issueId}/worklog/${last.id}`, { method: 'PUT', query: q, body: { comment: adfOrEmpty(comment) } });
  }
  const [after, worklogs] = await Promise.all([issueFacts(cfg, issueId, me), myWorklogs(issueId, me, payload.date, payload.date)]);
  return { op: plan.op, issue: after, date: payload.date, worklogs, previous: { hours: day.reduce((t, w) => t + w.h, 0), comment: day.length ? day.map((w) => w.c).filter(Boolean).join(' / ') : '' } };
}

// "Weitere Aufgabe hinzufügen": Jira's own issue picker (as the user), by key or title.
export async function mineSearch(query) {
  const q = String(query ?? '').trim().slice(0, 80);
  if (q.length < 2) return [];
  const r = await jira('user', '/rest/api/3/issue/picker', { query: { query: q, showSubTasks: 'false', showSubTaskParent: 'false' } });
  const seen = new Set(), out = [];
  for (const s of r.sections || []) for (const i of s.issues || []) {
    if (seen.has(i.id)) continue; seen.add(i.id);
    out.push({ id: String(i.id), key: i.key, summary: i.summaryText || '' });
  }
  return out.slice(0, 12);
}
export { MineError };
