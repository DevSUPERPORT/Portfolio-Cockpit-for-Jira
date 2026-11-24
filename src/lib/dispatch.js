// Support dispatching and the manual support reserve (UC-17).
//
// Resolvers (register in src/index.js; all three are WRITES – add them to the maintenance write list):
//
//   'support.dispatch'      payload { items: [{ issueId: '10234', teamId?: 'team-uuid', accountId?: '5b10…' }] }   (1–50 items)
//                           → { results: [{ issueId, ok, error: { code, message } | null,
//                                           before: { accountId, teamId, statusId },
//                                           after:  { accountId, teamId, status: { id, name, cat } | null },
//                                           statusChanged, statusNote: null | 'NO_TARGET' | 'ALREADY' | 'NO_TRANSITION' | 'TRANSITION_FAILED',
//                                           notes: ['NO_TEAM_FIELD'?] }] }
//                           Sets assignee and team field AS THE USER (Jira checks "Assign"/"Edit"), then moves the
//                           ticket to cfg.support.dispatch.afterStatusId when a transition leads there.
//                           `teamFieldValue` is accepted as an alias of `teamId`. At least one of teamId/accountId.
//
//   'support.undoDispatch'  payload { items: [{ issueId, accountId: string|null, teamId: string|null, statusId: string|null,
//                                               restoreAssignee?: true, restoreTeam?: true }] }
//                           = the `before` values the dispatch returned (null = was empty). Puts assignee and team back
//                           and tries a transition back to statusId; reports honestly when Jira has none
//                           (statusNote 'NO_TRANSITION' = status unchanged). Same result shape.
//
//   'support.reserve'       payload { teamId: 'team-uuid', hours: number (0–80, rounded to 0.5) | null (= automatic) }
//                           → { teamId, hours, previous }   (undo = call again with hours: previous)
//                           Storage: KVS key 'capacity' (K.capacity), shape { people, teams, absences };
//                           writes ONLY capacity.teams[teamId].supportOverride (h/week, null = automatic). A missing team
//                           entry is created with the editor defaults { name: payload.teamName || teamId, dailyBusinessPct: 20,
//                           internalPct: 0, absenceRatePct: 10, extraWeeklyHours: 0 }. shared/engine.js withSupportOverrides()
//                           applies it everywhere (waterline, weekly views, report).
//
// ctx = { accountId, displayName?, cfg, roles } (roles/cfg from the resolver wrapper, never from the payload).
// Every handler takes an optional third argument `deps` ({ jira, get, set, audit }) for tests.
import { jira as jiraReal, pool } from './jira.js';
import { K, get as getReal, set as setReal, audit as auditReal } from './store.js';
import { supportJql } from './config.js';
import { canDispatch, validDispatchItems, validReserve } from '../../shared/dispatch.js';

class BadRequest extends Error { constructor(m) { super(m); this.code = 'INVALID'; } }
class Denied extends Error { constructor(m = 'NO_ACCESS') { super(m); this.code = 'NO_ACCESS'; } }
const D = (deps = {}) => ({ jira: deps.jira || jiraReal, get: deps.get || getReal, set: deps.set || setReal, audit: deps.audit || auditReal });
const cat = (k) => (k === 'done' ? 'done' : k === 'indeterminate' ? 'indeterminate' : 'new');
const teamIdOf = (v) => (v == null ? null : typeof v === 'string' ? v : v.id != null ? String(v.id) : null);
const errOf = (e) => ({ code: e?.code || (e?.status === 403 || e?.status === 401 ? 'FORBIDDEN' : e?.status === 404 ? 'NOT_FOUND' : 'ERROR'), message: String(e?.message || 'Error').slice(0, 300) });

// Issue edit without notifications where Jira allows it (notifyUsers=false needs admin rights – retried without).
async function edit(J, issueId, fields) {
  try {
    await J('user', `/rest/api/3/issue/${issueId}`, { method: 'PUT', body: { fields }, query: { notifyUsers: false } });
  } catch (e) {
    if (e?.status === 400 && /notifyUsers/i.test(e.message || '')) { await J('user', `/rest/api/3/issue/${issueId}`, { method: 'PUT', body: { fields } }); return; }
    if (e?.status === 403 && /notif/i.test(e.message || '')) { await J('user', `/rest/api/3/issue/${issueId}`, { method: 'PUT', body: { fields } }); return; }
    throw e;
  }
}
// Assignee and team in one edit; when the assignee is not on the edit screen, the assign endpoint instead.
async function setAssigneeTeam(J, issueId, { teamF, setTeam, teamId, setAssignee, accountId }) {
  const fields = {};
  if (setTeam) fields[teamF] = teamId; // null clears the field
  if (setAssignee) fields.assignee = accountId ? { accountId } : null;
  if (!Object.keys(fields).length) return;
  try { await edit(J, issueId, fields); } catch (e) {
    const assigneeProblem = setAssignee && e?.status === 400 && /assignee/i.test(`${e.message} ${JSON.stringify(e.body?.errors || {})}`);
    if (!assigneeProblem) throw e;
    if (setTeam) await edit(J, issueId, { [teamF]: teamId });
    await J('user', `/rest/api/3/issue/${issueId}/assignee`, { method: 'PUT', body: { accountId: accountId || null } });
  }
}
// Transition to a status by its id, if the workflow offers one from here.
async function moveTo(J, issueId, fromStatusId, toStatusId) {
  if (!toStatusId) return { changed: false, note: 'NO_TARGET', status: null };
  if (String(fromStatusId) === String(toStatusId)) return { changed: false, note: 'ALREADY', status: null };
  const r = await J('user', `/rest/api/3/issue/${issueId}/transitions`);
  const t = (r?.transitions || []).find((x) => String(x.to?.id) === String(toStatusId));
  if (!t) return { changed: false, note: 'NO_TRANSITION', status: null };
  try {
    await J('user', `/rest/api/3/issue/${issueId}/transitions`, { method: 'POST', body: { transition: { id: String(t.id) } } });
  } catch (e) {
    return { changed: false, note: 'TRANSITION_FAILED', status: null, message: String(e?.message || '').slice(0, 200) };
  }
  return { changed: true, note: null, status: { id: String(t.to.id), name: t.to.name || '', cat: cat(t.to.statusCategory?.key) } };
}
async function readBefore(J, issueId, teamF) {
  const r = await J('user', `/rest/api/3/issue/${issueId}`, { query: { fields: ['assignee', 'status', teamF].filter(Boolean).join(',') } });
  const f = r?.fields || {};
  return { accountId: f.assignee?.accountId || null, teamId: teamF ? teamIdOf(f[teamF]) : null, statusId: f.status?.id != null ? String(f.status.id) : null };
}
// Only support tickets (the configured service spaces / queues) can be dispatched – checked as the user.
async function supportIds(J, cfg, ids) {
  const jql = supportJql(cfg);
  if (!jql) throw new BadRequest('support not configured');
  const r = await J('user', '/rest/api/3/search/jql', { method: 'POST', body: { jql: `(${jql}) AND id in (${ids.join(',')})`, fields: ['status'], maxResults: 100 } });
  return new Set((r?.issues || []).map((i) => String(i.id)));
}
function guard(ctx) {
  if (!ctx?.accountId) throw new Denied('ANONYMOUS');
  if (!canDispatch(ctx.roles)) throw new Denied('NO_ACCESS:dispatch');
}
const parse = (items, opts) => { try { return validDispatchItems(items, opts); } catch (e) { throw new BadRequest(e.message); } };

export async function dispatchTickets(payload, ctx, deps) {
  guard(ctx);
  const { jira: J, audit } = D(deps);
  const items = parse(payload?.items, { undo: false });
  const cfg = ctx.cfg || {};
  const teamF = cfg.fields?.team || null;
  const after = cfg.support?.dispatch?.afterStatusId ? String(cfg.support.dispatch.afterStatusId) : null;
  const allowed = await supportIds(J, cfg, items.map((x) => x.issueId));
  const results = await pool(items, 4, async (x) => {
    const out = { issueId: x.issueId, ok: false, error: null, before: null, after: null, statusChanged: false, statusNote: null, notes: [] };
    try {
      if (!allowed.has(x.issueId)) throw Object.assign(new Error('Not a visible support ticket'), { code: 'NOT_FOUND' });
      const before = await readBefore(J, x.issueId, teamF);
      out.before = before;
      const setTeam = x.teamId != null && !!teamF;
      if (x.teamId != null && !teamF) out.notes.push('NO_TEAM_FIELD');
      const setAssignee = x.accountId != null;
      await setAssigneeTeam(J, x.issueId, { teamF, setTeam, teamId: x.teamId, setAssignee, accountId: x.accountId });
      const mv = await moveTo(J, x.issueId, before.statusId, after);
      out.ok = true;
      out.statusChanged = mv.changed; out.statusNote = mv.note;
      if (mv.message) out.notes.push(mv.message);
      out.after = { accountId: setAssignee ? x.accountId : before.accountId, teamId: setTeam ? x.teamId : before.teamId, status: mv.status };
    } catch (e) { out.error = errOf(e); }
    return out;
  });
  const okN = results.filter((r) => r.ok).length;
  if (okN) await audit(ctx, 'support.dispatch', { count: okN, issueIds: results.filter((r) => r.ok).map((r) => r.issueId) }).catch(() => {});
  return { results };
}

export async function undoDispatch(payload, ctx, deps) {
  guard(ctx);
  const { jira: J, audit } = D(deps);
  const items = parse(payload?.items, { undo: true });
  const cfg = ctx.cfg || {};
  const teamF = cfg.fields?.team || null;
  const allowed = await supportIds(J, cfg, items.map((x) => x.issueId));
  const results = await pool(items, 4, async (x) => {
    const out = { issueId: x.issueId, ok: false, error: null, before: null, after: null, statusChanged: false, statusNote: null, notes: [] };
    try {
      if (!allowed.has(x.issueId)) throw Object.assign(new Error('Not a visible support ticket'), { code: 'NOT_FOUND' });
      const now = await readBefore(J, x.issueId, teamF);
      out.before = now;
      // status first: the way back may require the ticket's current assignee/team (workflow conditions)
      const mv = x.statusId ? await moveTo(J, x.issueId, now.statusId, x.statusId) : { changed: false, note: 'NO_TARGET', status: null };
      const setTeam = x.restoreTeam && !!teamF && now.teamId !== x.teamId;
      const setAssignee = x.restoreAssignee && now.accountId !== x.accountId;
      await setAssigneeTeam(J, x.issueId, { teamF, setTeam, teamId: x.teamId, setAssignee, accountId: x.accountId });
      out.ok = true;
      out.statusChanged = mv.changed; out.statusNote = mv.note;
      if (mv.message) out.notes.push(mv.message);
      out.after = { accountId: setAssignee ? x.accountId : now.accountId, teamId: setTeam ? x.teamId : now.teamId, status: mv.status };
    } catch (e) { out.error = errOf(e); }
    return out;
  });
  const okN = results.filter((r) => r.ok).length;
  if (okN) await audit(ctx, 'support.dispatch.undo', { count: okN, issueIds: results.filter((r) => r.ok).map((r) => r.issueId) }).catch(() => {});
  return { results };
}

// Manual support reserve per team (h/week); null = automatic again. Needs "edit capacity" (or Jira admin).
export async function setSupportReserve(payload, ctx, deps) {
  if (!ctx?.accountId) throw new Denied('ANONYMOUS');
  if (!(ctx.roles?.editCapacity || ctx.roles?.admin)) throw new Denied('NO_ACCESS:editCapacity');
  const { get, set, audit } = D(deps);
  let v;
  try { v = validReserve(payload); } catch (e) { throw new BadRequest(e.message); }
  const cap = (await get(K.capacity)) || { people: {}, teams: {}, absences: [] };
  const teams = { ...(cap.teams || {}) };
  const prevTeam = Object.hasOwn(teams, v.teamId) ? teams[v.teamId] || {} : null;
  if (!prevTeam && v.hours != null && Object.keys(teams).length >= 500) throw new BadRequest('too many teams');
  const previous = prevTeam?.supportOverride ?? null;
  // a missing team entry is created with the capacity editor's defaults (same shape capacity.save keeps)
  const name = typeof payload?.teamName === 'string' && payload.teamName.trim() ? payload.teamName.trim().slice(0, 120) : v.teamId;
  if (prevTeam || v.hours != null) teams[v.teamId] = { ...(prevTeam || { name, dailyBusinessPct: 20, internalPct: 0, absenceRatePct: 10, extraWeeklyHours: 0 }), supportOverride: v.hours };
  await set(K.capacity, { people: {}, absences: [], ...cap, teams });
  await audit(ctx, 'support.reserve', { teamId: v.teamId, hours: v.hours, previous }).catch(() => {});
  return { teamId: v.teamId, hours: v.hours, previous };
}
