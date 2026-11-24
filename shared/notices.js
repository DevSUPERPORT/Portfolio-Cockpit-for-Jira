// Notices (UC-13 reminder, UC-19 booking notices and escalations). Pure: decides WHO would get WHAT.
// Sending is a separate step on the server and only happens when a Jira admin switched it on
// (config.notices.enabled, default false). Until then the configuration page shows this as a preview.

export const DEFAULT_NOTICES = Object.freeze({ enabled: false, gaps: 'monday', booking: true });

export function validNotices(x, prev) {
  const d = { ...DEFAULT_NOTICES, ...(prev || {}) };
  const v = x && typeof x === 'object' ? x : {};
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : d.enabled,
    gaps: ['off', 'monday', 'daily'].includes(v.gaps) ? v.gaps : d.gaps,
    booking: typeof v.booking === 'boolean' ? v.booking : d.booking,
  };
}

// Is a run due now? rhythm 'daily' = once per day, 'monday' = once per ISO week on Monday or later.
export function due(rhythm, lastIso, nowIso) {
  if (rhythm === 'off') return false;
  const day = nowIso.slice(0, 10);
  if (!lastIso) return rhythm === 'daily' || new Date(`${day}T00:00:00Z`).getUTCDay() === 1;
  if (rhythm === 'daily') return lastIso.slice(0, 10) < day;
  const monday = (iso) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  return monday(lastIso) < monday(day);
}

// Data-quality reminders: one message per responsible person with their open gaps (urgent first).
// The anchor is one of their gap work items (Jira sends notices "about" a work item).
export function gapReminders(gaps, { max = 15 } = {}) {
  const by = new Map();
  for (const g of gaps || []) {
    const id = g.responsible?.id;
    if (!id || g.responsible.anon || !g.issueId || g.isItem) continue;
    (by.get(id) || by.set(id, { to: id, name: g.responsible.name || '', gaps: [] }).get(id)).gaps.push(g);
  }
  return [...by.values()].map((r) => {
    const list = r.gaps.sort((a, b) => Number(b.urgent) - Number(a.urgent));
    return { kind: 'gaps', to: r.to, name: r.name, anchor: list[0].issueId, count: list.length, urgent: list.filter((g) => g.urgent).length, lines: list.slice(0, max).map((g) => `${g.key}: ${g.ruleText || g.rule}${g.urgent ? ' (!)' : ''}`) };
  }).sort((a, b) => b.urgent - a.urgent || b.count - a.count);
}

// Booking notices: below the minimum rate a notice to the person; with at least escalatePct missing also an
// escalation to the team's responsible people (escalateTo 'lead'), plus the project owners ('leadOwner') or
// management ('mgmt'). rows: [{ accountId, teamId, possible, booked, anchor }]
export function bookingNotices(rows, { minPct = 90, escalatePct = 20, escalateTo = 'lead' } = {}, { responsibleOf = () => [], ownersOf = () => [], management = [] } = {}) {
  const out = [];
  for (const r of rows || []) {
    if (!(r.possible > 0) || !r.anchor) continue;
    const rate = r.booked / r.possible;
    if (rate * 100 >= minPct) continue;
    const missing = r.possible - r.booked;
    const esc = (missing / r.possible) * 100 >= escalatePct;
    out.push({ kind: 'booking', to: r.accountId, anchor: r.anchor, rate, missing, escalation: esc });
    if (esc) {
      const cc = new Set(responsibleOf(r.teamId));
      if (escalateTo === 'leadOwner') for (const o of ownersOf(r.accountId)) cc.add(o);
      if (escalateTo === 'mgmt') for (const m of management) cc.add(m);
      cc.delete(r.accountId);
      if (cc.size) out.push({ kind: 'escalation', to: [...cc], about: r.accountId, anchor: r.anchor, rate, missing });
    }
  }
  return out;
}

// ---------- booking notices: which period is checked, and is it due? ----------
const D = (iso) => new Date(`${iso}T00:00:00Z`);
const I = (d) => d.toISOString().slice(0, 10);
const add = (iso, n) => { const d = D(iso); d.setUTCDate(d.getUTCDate() + n); return I(d); };
const isWeekend = (iso) => [0, 6].includes(D(iso).getUTCDay());
// The last completed period for a check rhythm: 'day' = the previous working day, 'week' = last Mon–Fri,
// 'month' = last calendar month.
export function bookingPeriod(schedule, todayIso) {
  if (schedule === 'month') {
    const t = D(todayIso); const from = I(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1))); const to = I(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0)));
    return { key: `m:${from.slice(0, 7)}`, from, to };
  }
  if (schedule === 'day') {
    let d = add(todayIso, -1); while (isWeekend(d)) d = add(d, -1);
    return { key: `d:${d}`, from: d, to: d };
  }
  const t = D(todayIso); const mon = add(todayIso, -((t.getUTCDay() + 6) % 7) - 7);
  return { key: `w:${mon}`, from: mon, to: add(mon, 4) };
}
// Due once the grace period (working days after the period's end) has passed, and only once per period.
export function bookingDue(period, todayIso, graceDays = 2, lastKey = null) {
  if (lastKey === period.key) return false;
  let n = 0;
  for (let d = add(period.to, 1); d < todayIso; d = add(d, 1)) if (!isWeekend(d)) n += 1;
  return n >= graceDays;
}
