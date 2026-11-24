// Wochenplanung (UC-05): write the collected moves of the weekly planning board to Jira.
//
// Resolver name: 'plan.apply' (a WRITE – not in READ_RESOLVERS). Wiring in src/index.js:
//   def('plan.apply', ({ payload, ctx, cfg, roles }) => applyPlanMoves(payload, { ...ctx, cfg, roles }));
// Payload:
//   { moves: [{ issueId: '10042', start?: 'YYYY-MM-DD' | null, due?: 'YYYY-MM-DD' | null, assignee?: accountId | null, team?: teamId | null }] }
//   at most 100 moves, each issue once; only the fields that change are sent (validated by validatePlanMoves).
// Result:
//   { results: [{ issueId, key, ok, before, error?, partial?, written? }], ok: n, failed: n }
//   before = the values Jira had before the write (only the fields of that move) – applying them as a new move
//   is the exact undo. partial = some fields were written (listed in `written`), others refused.
//
// Everything is written AS THE USER: Jira enforces edit/assign permissions, screens and field configuration.
// Nobody is notified (notifyUsers=false; retried without it where Jira does not allow the flag).
import { jira, pool } from './jira.js';
import { audit } from './store.js';
import { loadConfig } from './config.js';
import { AccessError } from './perms.js';
import { validatePlanMoves, canPlan } from '../../shared/weekPlan.js';

const dateOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const errOf = (e) => ({
  code: e?.code || (e?.status === 401 || e?.status === 403 ? 'FORBIDDEN' : e?.status === 404 ? 'NOT_FOUND' : e?.status === 400 ? 'REJECTED' : 'ERROR'),
  message: String(e?.status && e.status < 500 ? e.message : 'Unexpected error').slice(0, 300),
});

async function put(issueId, fields) {
  const path = `/rest/api/3/issue/${issueId}`;
  return jira('user', path, { method: 'PUT', body: { fields }, query: { notifyUsers: false } }).catch((e) => {
    if (e.status === 400 && /notifyUsers/i.test(e.message)) return jira('user', path, { method: 'PUT', body: { fields } });
    throw e;
  });
}
// The assign endpoint needs only the "Assign issues" permission (not the edit screen).
const assign = (issueId, accountId) => jira('user', `/rest/api/3/issue/${issueId}/assignee`, { method: 'PUT', body: { accountId: accountId || null } });

const teamIdOf = (v) => (v == null ? null : typeof v === 'string' ? v : v.id ?? null);
async function applyOne(m, startField, teamField) {
  const has = (f) => Object.prototype.hasOwnProperty.call(m, f);
  if (has('start') && !startField) return { issueId: m.issueId, ok: false, error: { code: 'NO_START_FIELD', message: 'No start date field is configured.' } };
  if (has('team') && !teamField) return { issueId: m.issueId, ok: false, error: { code: 'NO_TEAM_FIELD', message: 'No team field is configured.' } };
  let cur;
  try {
    // also the visibility check: 404 unless the user can see the work item
    cur = await jira('user', `/rest/api/3/issue/${m.issueId}`, { query: { fields: ['assignee', 'duedate', startField, has('team') ? teamField : null].filter(Boolean).join(',') } });
  } catch (e) { return { issueId: m.issueId, ok: false, error: errOf(e) }; }
  const f = cur?.fields || {};
  const before = {};
  if (has('start')) before.start = dateOf(f[startField]);
  if (has('due')) before.due = dateOf(f.duedate);
  if (has('assignee')) before.assignee = f.assignee?.accountId || null;
  if (has('team')) before.team = teamIdOf(f[teamField]);
  const dates = {};
  if (has('start')) dates[startField] = m.start;
  if (has('due')) dates.duedate = m.due;
  if (has('team')) dates[teamField] = m.team; // the Team field takes the team id (as the gap fix writes it)
  const base = { issueId: m.issueId, key: cur?.key || null, before };
  // Jira already has exactly these values (the same move sent again): nothing is written and nothing logged
  const want = { start: m.start ?? null, due: m.due ?? null, assignee: m.assignee ?? null, team: m.team ?? null };
  if (Object.keys(before).every((k) => before[k] === want[k])) return { ...base, ok: true, unchanged: true };
  try {
    await put(m.issueId, { ...dates, ...(has('assignee') ? { assignee: m.assignee ? { accountId: m.assignee } : null } : {}) });
    return { ...base, ok: true };
  } catch (e) {
    // assignee not on the edit screen: dates through the edit, the person through the assign endpoint
    if (!(e.status === 400 && has('assignee') && e.body?.errors?.assignee)) return { ...base, ok: false, error: errOf(e) };
  }
  const written = {};
  try {
    if (Object.keys(dates).length) { await put(m.issueId, dates); if (has('start')) written.start = m.start; if (has('due')) written.due = m.due; if (has('team')) written.team = m.team; }
    await assign(m.issueId, m.assignee);
    return { ...base, ok: true };
  } catch (e) {
    return Object.keys(written).length ? { ...base, ok: false, partial: true, written, error: errOf(e) } : { ...base, ok: false, error: errOf(e) };
  }
}

export async function applyPlanMoves(payload, ctx = {}) {
  const moves = validatePlanMoves(payload); // throws { code: 'INVALID' }
  if (ctx.roles && !canPlan(ctx.roles)) throw new AccessError('NO_ACCESS:planWeeks');
  const cfg = ctx.cfg || (await loadConfig());
  const startField = cfg?.fields?.startDate || null;
  const teamField = /^customfield_\d{1,10}$/.test(cfg?.fields?.team || '') ? cfg.fields.team : null;
  const results = await pool(moves, 4, (m) => applyOne(m, startField, teamField));
  const ok = results.filter((r) => r.ok).length;
  // one entry per real change: moves Jira already had are left out, an undo is logged as an undo, and each
  // entry says what changed (from → to), so two entries for one work item are never mistaken for a double log
  const changed = results.filter((r) => (r.ok && !r.unchanged) || r.partial);
  if (ctx.accountId && (changed.length || moves.length - ok)) {
    const byId = new Map(moves.map((m) => [m.issueId, m]));
    const changes = changed.slice(0, 50).map((r) => {
      const m = byId.get(r.issueId) || {};
      const fields = r.ok ? Object.keys(r.before || {}) : Object.keys(r.written || {});
      return { key: r.key || r.issueId, ...Object.fromEntries(fields.map((f) => [f, [r.before?.[f] ?? null, m[f] ?? null]])) };
    });
    await audit(ctx, payload?.undo === true ? 'plan.apply.undo' : 'plan.apply', { moves: moves.length, ok: changed.length, failed: moves.length - ok, keys: changed.map((r) => r.key).filter(Boolean).slice(0, 100), changes }).catch(() => {});
  }
  return { results, ok, failed: moves.length - ok };
}
