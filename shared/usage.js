// Usage signals (product owner, 2026-11-12: "prove user satisfaction") – privacy-safe by construction:
//   - COUNTS ONLY: { event name → how often } per site and day. No account ids, no names, no content, no ticket keys,
//     no payloads, no timestamps finer than the day. The browser sends batches; the server adds them to the day.
//   - every event name must match the fixed allow-list below – anything else is dropped before it is stored;
//   - kept 30 days (older days are deleted when a new day is written);
//   - only Jira admins see the summary (Konfiguration › Nutzung).
// Pure – used by the server (src/lib/usage.js), the browser (static/cockpit/src/lib/usage.js) and the mock.
export const USAGE_DAYS = 30;
export const USAGE_LIMITS = Object.freeze({ names: 60, perEvent: 1000, perDay: 400 });

// views of the cockpit (App.jsx ViewHost ids, old ids included)
export const USAGE_VIEWS = ['portfolio', 'project', 'team', 'proof', 'deps', 'time', 'estimate', 'plan', 'capacity', 'quality', 'support', 'ask', 'mine', 'report', 'settings', 'config'];
export const USAGE_SKILLS = ['timelineBrief', 'ticket', 'splitCheck', 'projectBrief', 'teamBrief', 'portfolioBrief', 'myWeek', 'planningAdvice', 'gapsFix', 'dispatchAdvice', 'planActualExplain', 'healthDraft', 'supportTopics', 'estimate', 'overtime',
  'realCapacity', 'fits', 'waterline', 'blockers', 'whatIf', 'compare', 'today', 'why', 'bookingComments', 'similarSummary', 'playbookDraft', 'intentMap', 'yearCheck', 'help', 'guard'];
export const USAGE_ACTIONS = ['open', 'move', 'assign', 'fill', 'rank', 'dispatch', 'navigate', 'whatIf'];
export const USAGE_AI = ['ask', 'healthDraft', 'reportSummary', 'planning', 'gaps', 'dispatch', 'planActual', 'teamBrief', 'projectBrief', 'myWeek', 'intent', 'similarSummary', 'playbookDraft', 'lotse'];
const WORKFLOW_RE = /^lotse:workflow:[a-z][a-zA-Z0-9]{1,30}:(start|done|cancel)$/;
const FIXED = new Set([
  'lotse:ask', 'lotse:open', 'lotse:learned', 'undo', 'write', 'report:pdf', 'report:confluence',
  'teamwork:same', 'teamwork:differs', 'teamwork:pick:lotse', 'teamwork:pick:ai', 'lotse:ai:agrees', 'lotse:ai:differs', 'learn:approve', 'learn:reject',
  ...USAGE_VIEWS.map((v) => `view:${v}`), ...USAGE_SKILLS.map((s) => `lotse:story:${s}`), ...USAGE_ACTIONS.map((a) => `lotse:action:${a}`), ...USAGE_AI.map((f) => `ai:${f}`),
]);
export const isUsageEvent = (name) => typeof name === 'string' && name.length <= 64 && (FIXED.has(name) || WORKFLOW_RE.test(name));

// What the browser may send: { events: { name: count } } – unknown names, odd counts and anything else are dropped.
export function cleanBatch(input) {
  const ev = input && typeof input === 'object' && input.events && typeof input.events === 'object' && !Array.isArray(input.events) ? input.events : {};
  const out = {};
  for (const [k, v] of Object.entries(ev).slice(0, USAGE_LIMITS.names * 2)) {
    if (!isUsageEvent(k) || k in out) continue;
    const n = Math.round(+v);
    if (Number.isFinite(n) && n >= 1) out[k] = Math.min(USAGE_LIMITS.perEvent, n);
    if (Object.keys(out).length >= USAGE_LIMITS.names) break;
  }
  return out;
}

// A day's record plus a batch – only allowed names, counts capped, at most USAGE_LIMITS.perDay names per day.
export function mergeDay(day, batch) {
  const counts = { ...(day?.counts && typeof day.counts === 'object' ? day.counts : {}) };
  for (const [k, n] of Object.entries(cleanBatch({ events: batch }))) {
    if (!(k in counts) && Object.keys(counts).length >= USAGE_LIMITS.perDay) continue;
    counts[k] = Math.min(1e7, (+counts[k] || 0) + n);
  }
  return { counts };
}

const isoOf = (t) => new Date(t).toISOString().slice(0, 10);
export const usageDays = (now = Date.now(), n = USAGE_DAYS) => Array.from({ length: n }, (_, i) => isoOf(now - (n - 1 - i) * 864e5));

// The admin's view: days = [{ day, counts }] (missing days count 0).
export function usageSummary(days, now = Date.now()) {
  const byDay = new Map((Array.isArray(days) ? days : []).filter((d) => d && typeof d.day === 'string').map((d) => [d.day, d.counts || {}]));
  const range = usageDays(now);
  const total = {};
  for (const day of range) for (const [k, n] of Object.entries(byDay.get(day) || {})) if (isUsageEvent(k)) total[k] = (total[k] || 0) + (+n || 0);
  const sumOf = (pred) => Object.entries(total).filter(([k]) => pred(k)).reduce((a, [, n]) => a + n, 0);
  const top = (prefix, n = 8) => Object.entries(total).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ id: k.slice(prefix.length), n: v })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id)).slice(0, n);
  const writes = total.write || 0, undos = total.undo || 0;
  const lotse = sumOf((k) => k === 'lotse:ask' || k.startsWith('lotse:story:') || k.startsWith('lotse:action:') || k.startsWith('lotse:workflow:'));
  const ai = sumOf((k) => k.startsWith('ai:'));
  const workflows = {};
  for (const [k, n] of Object.entries(total)) { const m = /^lotse:workflow:([^:]+):(start|done|cancel)$/.exec(k); if (m) { const w = workflows[m[1]] || (workflows[m[1]] = { id: m[1], start: 0, done: 0, cancel: 0 }); w[m[2]] += n; } }
  return {
    from: range[0], to: range.at(-1),
    daily: range.map((day) => ({ day, n: Object.entries(byDay.get(day) || {}).filter(([k]) => isUsageEvent(k)).reduce((a, [, v]) => a + (+v || 0), 0) })),
    total: Object.values(total).reduce((a, n) => a + n, 0),
    views: top('view:'), skills: top('lotse:story:'), actions: top('lotse:action:'), aiFeatures: top('ai:', 14),
    workflows: Object.values(workflows).sort((a, b) => b.start - a.start || a.id.localeCompare(b.id)).slice(0, 8),
    undo: { writes, undos, rate: writes ? Math.round((undos / writes) * 1000) / 1000 : null },
    lotseVsAi: { lotse, ai },
    teamwork: { same: total['teamwork:same'] || 0, differs: total['teamwork:differs'] || 0, pickLotse: total['teamwork:pick:lotse'] || 0, pickAi: total['teamwork:pick:ai'] || 0 },
    activeDays: range.filter((d) => Object.keys(byDay.get(d) || {}).length).length,
  };
}
