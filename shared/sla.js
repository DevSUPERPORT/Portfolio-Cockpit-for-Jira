// Support & SLA engine (pure, shared by server, UI and tests).
// Works with Jira Service Management SLAs when present and with app-defined targets per priority
// otherwise, measured in business hours (weekdays, public holidays, opening hours) or 24/7.
import { dayIdx, isoOf, mondayOf, isWeekday } from './dates.js';
import { holidaysFor } from './holidays.js';

const HOUR = 3600e3;
export const DEFAULT_SLA = {
  mode: 'business', start: 8, end: 17, location: 'DE',
  policies: [{ priority: 'Highest', hours: 8 }, { priority: 'High', hours: 24 }, { priority: 'Medium', hours: 72 }, { priority: 'Low', hours: 120 }, { priority: 'Lowest', hours: 200 }],
  fallbackHours: 72, atRiskShare: 0.75,
};

// Hours that count between two instants. Business mode counts weekdays that are not public holidays,
// between the opening hours (UTC-based, documented as a simplification).
export function slaHours(fromMs, toMs, cal = DEFAULT_SLA) {
  if (!(toMs > fromMs)) return 0;
  if (cal.mode === '24x7') return (toMs - fromMs) / HOUR;
  const start = Math.max(0, Math.min(23, cal.start ?? 8)), end = Math.max(start + 1, Math.min(24, cal.end ?? 17));
  let total = 0;
  const d0 = Math.floor(fromMs / 864e5), d1 = Math.floor(toMs / 864e5);
  const hol = cal.location && cal.location !== 'NONE' ? holidaySetFor(cal.location, d0, d1) : null;
  for (let d = d0; d <= d1; d++) {
    if (!isWeekday(d)) continue;
    if (hol && hol.has(d)) continue;
    const open = d * 864e5 + start * HOUR, close = d * 864e5 + end * HOUR;
    const a = Math.max(open, fromMs), b = Math.min(close, toMs);
    if (b > a) total += (b - a) / HOUR;
  }
  return total;
}

// The location's holidays of every year a span touches, as one Set (cached per location and year range): one
// lookup per day instead of a year computation and a cache key per day.
const holSets = new Map();
function holidaySetFor(location, d0, d1) {
  const y0 = new Date(d0 * 864e5).getUTCFullYear(), y1 = new Date(d1 * 864e5).getUTCFullYear();
  const key = `${location}|${y0}|${y1}`;
  let set = holSets.get(key);
  if (!set) {
    set = new Set();
    for (let y = y0; y <= y1; y++) for (const h of holidaysFor(location, y)) set.add(h);
    if (holSets.size > 500) holSets.clear();
    holSets.set(key, set);
  }
  return set;
}

// Sort order "newest first" exactly as String#localeCompare (default locale) would give it. Timestamps of one shape
// (same length, the same non-digits at the same places – e.g. all "2026-11-12T10:00:00.000Z") differ first in a digit,
// where the collation order is the digit order: a plain comparison then gives the same order, 50× faster. Mixed shapes
// use one Collator (the same collation localeCompare uses).
function sortNewestFirst(rows, keyOf) {
  // decorated (key, row) pairs: the stable sort keeps rows with equal keys in their order, as before
  const dec = rows.map((r) => ({ k: keyOf(r), r }));
  const shape = (s) => s.replace(/\d/g, '0');
  const s0 = dec.length ? shape(dec[0].k) : '';
  let uniform = s0 !== '';
  for (const x of dec) if (x.k.length !== s0.length || shape(x.k) !== s0) { uniform = false; break; }
  const c = uniform ? null : collator();
  dec.sort(uniform ? (a, b) => (b.k < a.k ? -1 : b.k > a.k ? 1 : 0) : (a, b) => c.compare(b.k, a.k));
  for (let i = 0; i < dec.length; i++) rows[i] = dec[i].r;
  return rows;
}
let coll = null;
const collator = () => (coll ||= new Intl.Collator());

const norm = (s) => String(s || '').trim().toLowerCase();
export function targetHours(priority, cal = DEFAULT_SLA) {
  const p = (cal.policies || []).find((x) => norm(x.priority) === norm(priority));
  return p ? +p.hours : +(cal.fallbackHours ?? 72);
}

// SLA state of one ticket – only from Jira Service Management (ticket.jsm). SLAs are defined per JSM project (calendar
// and goals there); a ticket without JSM SLA data (a software / business space, a JSM space without SLAs) has no SLA
// at all – status 'none' – and counts in no SLA figure (boss 2026-11-18: "not part of software and business projects").
export const NO_SLA = Object.freeze({ source: 'none', targetH: null, elapsedH: null, remainingH: null, share: null, status: 'none', paused: false });
export function ticketSla(t, cal = DEFAULT_SLA, now = Date.now()) {
  if (t.jsm && (t.jsm.goalMs != null || t.jsm.breached != null)) {
    const goalH = t.jsm.goalMs != null ? t.jsm.goalMs / HOUR : null;
    const elapsedH = t.jsm.elapsedMs != null ? t.jsm.elapsedMs / HOUR : null;
    const remainingH = t.jsm.remainingMs != null ? t.jsm.remainingMs / HOUR : goalH != null && elapsedH != null ? goalH - elapsedH : null;
    const done = t.statusCat === 'done';
    const breached = !!t.jsm.breached || (remainingH != null && remainingH < 0);
    const share = goalH ? (elapsedH ?? goalH - remainingH) / goalH : null;
    return { source: 'jsm', targetH: goalH, elapsedH, remainingH, share, status: done ? (breached ? 'breached' : 'met') : breached ? 'breached' : share != null && share >= (cal.atRiskShare ?? 0.75) ? 'atRisk' : 'ok', paused: !!t.jsm.paused };
  }
  if (!cal?.policyFallback) return NO_SLA;
  // (kept for a site that explicitly opts into the app's own policy – no UI offers it any more)
  const targetH = targetHours(t.priority, cal);
  const created = Date.parse(t.created);
  const end = t.resolved ? Date.parse(t.resolved) : now;
  const elapsedH = Number.isFinite(created) ? slaHours(created, end, cal) : 0;
  const share = targetH > 0 ? elapsedH / targetH : 0;
  const done = t.statusCat === 'done';
  const status = done ? (elapsedH <= targetH ? 'met' : 'breached') : elapsedH > targetH ? 'breached' : share >= (cal.atRiskShare ?? 0.75) ? 'atRisk' : 'ok';
  return { source: 'policy', targetH, elapsedH, remainingH: targetH - elapsedH, share, status, paused: false };
}

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// row → its ticket's position in `tickets` (rows are copies; the compute worker ships positions, not rows)
export const ROW_TICKET = new WeakMap();
// Everything the Support view shows. `rootOf(issueId)` maps a linked work item to its portfolio project.
export function supportAnalytics(tickets, { cal = DEFAULT_SLA, target = 0.95, now = Date.now(), weeks = 8, rootOf = () => null } = {}) {
  const today = Math.floor(now / 864e5);
  const weekStarts = Array.from({ length: weeks }, (_, k) => mondayOf(today) - (weeks - 1 - k) * 7);
  const created = new Array(weeks).fill(0), resolved = new Array(weeks).fill(0), compliance = weekStarts.map(() => ({ met: 0, breached: 0 }));
  const wk = (iso) => { const d = dayIdx(iso); if (d == null) return -1; return weekStarts.findIndex((m) => d >= m && d < m + 7); };
  const rows = [], byPriority = new Map(), byProject = new Map();
  const aging = [['0-1', 0, 1], ['1-3', 1, 3], ['3-7', 3, 7], ['7-14', 7, 14], ['14+', 14, Infinity]].map(([label, a, b]) => ({ label, a, b, count: 0 }));
  let met = 0, breached = 0;
  const resolveTimes = [];
  for (const t of tickets) {
    const sla = ticketSla(t, cal, now);
    const project = (t.links || []).map(rootOf).find(Boolean) || null;
    const row = { ...t, sla, project };
    ROW_TICKET.set(row, rows.length);
    rows.push(row);
    const ci = wk(t.created); if (ci >= 0) created[ci]++;
    if (t.resolved) { const ri = wk(t.resolved); if (ri >= 0) { resolved[ri]++; if (sla.status === 'met' || sla.status === 'breached') compliance[ri][sla.status === 'met' ? 'met' : 'breached']++; } }
    if (sla.status === 'met') met++;
    if (sla.status === 'breached') breached++;
    if (t.resolved && sla.elapsedH != null) resolveTimes.push(sla.elapsedH);
    const open = t.statusCat !== 'done';
    const pr = byPriority.get(t.priority || '–') || byPriority.set(t.priority || '–', { priority: t.priority || '–', open: 0, breached: 0, breachedOpen: 0, atRisk: 0, total: 0 }).get(t.priority || '–');
    pr.total++; if (open) pr.open++; if (sla.status === 'breached') { pr.breached++; if (open) pr.breachedOpen++; } if (sla.status === 'atRisk') pr.atRisk++;
    if (open) {
      const ageD = (now - Date.parse(t.created)) / 864e5;
      const b = aging.find((x) => ageD >= x.a && ageD < x.b); if (b) b.count++;
    }
    if (project) {
      const p = byProject.get(project) || byProject.set(project, { ref: project, tickets: 0, open: 0, breached: 0, hours: 0 }).get(project);
      p.tickets++; if (open) p.open++; if (sla.status === 'breached') p.breached++;
      p.hours += t.spentH ?? (t.worklogs || []).reduce((a, w) => a + (w.h || 0), 0);
    }
  }
  const open = rows.filter((r) => r.statusCat !== 'done');
  // newest first – the same collation as String#localeCompare (default locale), with one Collator and keys read once
  sortNewestFirst(rows, (r) => String(r.resolved || r.created || ''));
  const net = created.map((c, i) => c - resolved[i]);
  const recent = net.slice(-4);
  const inflow = recent.reduce((a, x) => a + x, 0) / Math.max(1, recent.length);
  const rate = met + breached > 0 ? met / (met + breached) : null;
  const urgency = { breached: 0, atRisk: 1, ok: 2 };
  return {
    kpis: {
      open: open.length, breachedOpen: open.filter((r) => r.sla.status === 'breached').length, atRisk: open.filter((r) => r.sla.status === 'atRisk').length,
      slaRate: rate, target, met, breached, medianResolveH: median(resolveTimes), backlogTrendPerWeek: inflow,
      unlinked: open.filter((r) => !r.project).length,
      withSla: rows.filter((r) => r.sla.status !== 'none').length,
    },
    trend: weekStarts.map((m, i) => ({ week: isoOf(m), created: created[i], resolved: resolved[i], rate: compliance[i].met + compliance[i].breached ? compliance[i].met / (compliance[i].met + compliance[i].breached) : null })),
    byPriority: [...byPriority.values()].sort((a, b) => (targetHours(a.priority, cal) - targetHours(b.priority, cal))),
    aging,
    byProject: [...byProject.values()].sort((a, b) => b.open - a.open || b.breached - a.breached),
    rows,
    // Most urgent open tickets first: breached, then least time left.
    queue: open.sort((a, b) => (urgency[a.sla.status] ?? 3) - (urgency[b.sla.status] ?? 3) || (a.sla.remainingH ?? 1e9) - (b.sla.remainingH ?? 1e9)),
  };
}

// The Support view's numbers for ONE service space: the same tickets and the same SLA rule as the Support view,
// so a Portfolio support row can never disagree with it (one number, one definition).
export function serviceKpis(analytics, serviceId) {
  const rows = (analytics?.rows || []).filter((r) => (r.services || []).includes(serviceId));
  const open = rows.filter((r) => r.statusCat !== 'done');
  const met = rows.filter((r) => r.sla?.status === 'met').length, breached = rows.filter((r) => r.sla?.status === 'breached').length;
  const slaRate = met + breached > 0 ? met / (met + breached) : null;
  const target = analytics?.kpis?.target ?? 0.95;
  const health = slaRate == null ? null : slaRate >= target ? 'onTrack' : slaRate >= target - 0.05 ? 'atRisk' : 'critical';
  return { tickets: rows.length, open: open.length, breachedOpen: open.filter((r) => r.sla?.status === 'breached').length, met, breached, slaRate, target, health };
}
