// "Woche vervollständigen" (UC-20, deeper): proposes bookings for the gap of every past day (and today) from the
// person's own Jira record – rule-based, no AI, nothing is booked before the person confirms.
//
//   evidence (strongest)  my status changes (3), comments (2), other edits (1) on that day; sub-task → its story
//   plan (fallback)       my open work whose dates cover the day: In Progress 2, To Do 1; open support counts as covering
//   gap                   target of the day − everything I already booked that day, in quarter hours (floor)
//   split                 proportional to the weights, at most 4 work items, at least ½ h each, largest remainder,
//                         so the proposals of a day add up EXACTLY to the gap
//   never                 future days, days without a target (holiday, absence), sub-tasks, cells I already booked,
//                         planning edits (dates, assignee, rank, estimates, T-shirt size, quarters, versions, sprint,
//                         labels, links – what Weekly planning, the Portfolio or a data fill change): planning is not work,
//                         and a work item NOT assigned to me unless I really worked on it (my worklog, comment, status
//                         change or own content edit such as summary or description)
const W = { status: 3, comment: 2, edit: 1 };
const q = (h) => Math.floor(h * 4 + 1e-6) / 4;

// Jira changelog items: field (display name) and fieldId. Lower case; configured custom fields come in as extra ids.
const PLANNING = new Set(['duedate', 'due date', 'due', 'start date', 'startdate', 'target start', 'target end', 'assignee', 'rank', 'timeoriginalestimate', 'original estimate', 'timeestimate', 'remaining estimate', 'timespent', 'time spent', 'worklogid',
  'fixversions', 'fix version', 'fix version/s', 'fix versions', 'sprint', 'labels', 'issuelinks', 'link', 'links', 'parent', 'parent link', 'issueparentassociation', 'epic link', 'team',
  'portfolio rank', 't-shirt size', 'tshirt', 't-shirt', 'target quarters', 'target quarter', 'milestone']);
const CONTENT = new Set(['summary', 'description', 'environment', 'attachment']);
const low = (v) => String(v ?? '').trim().toLowerCase();
export const isPlanningField = (it, extra = []) => {
  const f = low(typeof it === 'string' ? it : it?.field), id = low(typeof it === 'string' ? '' : it?.fieldId);
  return PLANNING.has(f) || (id && PLANNING.has(id)) || extra.some((x) => x && (low(x) === id || low(x) === f));
};
export const isContentField = (it) => CONTENT.has(low(typeof it === 'string' ? it : it?.field)) || CONTENT.has(low(it?.fieldId));
// An edit that only changes planning fields is not evidence of work.
export const planningOnly = (items, extra = []) => (items || []).length > 0 && items.every((it) => isPlanningField(it, extra));
// Real work on a work item: my status change, my comment, my own content edit – or any non-planning edit of an item
// that is mine (assigned to me).
// ---------- evidence: my own record of the week (from the work item's changelog and comments) ----------
// Only MY changelog entries and comments inside [from, to]. A status change is evidence; an edit only when it changes
// something other than planning fields (planning: the configured custom field ids in `planning`, plus Jira's own –
// see isPlanningField); content: summary, description, environment or attachment changed.
const dateOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
function plainText(doc) {
  if (!doc) return '';
  if (typeof doc === 'string') return doc;
  const out = [];
  const walk = (n) => { if (!n) return; if (n.type === 'text' && n.text) out.push(n.text); (n.content || []).forEach(walk); if (n.type === 'paragraph') out.push(' '); };
  walk(doc);
  return out.join('').replace(/\s+/g, ' ').trim();
}
export function evidenceOf(issueId, me, from, to, histories = [], comments = [], { planning = [] } = {}) {
  const out = [];
  for (const h of histories) {
    if (h.author?.accountId !== me) continue;
    const d = dateOf(h.created);
    if (!d || d < from || d > to) continue;
    const st = (h.items || []).find((x) => x.field === 'status');
    // planning (dates, assignee, rank, estimates, T-shirt size, quarters, versions, sprint, labels, links) is not work
    const work = (h.items || []).filter((x) => x.field && !isPlanningField(x, planning));
    const fields = [...new Set(work.map((x) => x.field))];
    if (st) out.push({ issueId: String(issueId), d, at: h.created, kind: 'status', from: st.fromString || '', to: st.toString || '' });
    else if (fields.length) out.push({ issueId: String(issueId), d, at: h.created, kind: 'edit', fields: fields.slice(0, 3), content: work.some((x) => isContentField(x)) });
  }
  for (const c of comments) {
    if (c.author?.accountId !== me) continue;
    const d = dateOf(c.created);
    if (!d || d < from || d > to) continue;
    out.push({ issueId: String(issueId), d, at: c.created, kind: 'comment', text: plainText(c.body).slice(0, 90) });
  }
  return out;
}

const realWork = (e, src) => e.kind === 'status' || e.kind === 'comment' || (e.kind === 'edit' && (e.content === true || !!src?.mine));

export function allocate(gap, weighted) {
  const units = Math.round(gap * 4);
  const sum = weighted.reduce((t, x) => t + x.w, 0);
  if (!units || !sum) return [];
  const raw = weighted.map((x) => ({ ...x, u: (units * x.w) / sum }));
  const out = raw.map((x) => ({ ...x, units: Math.floor(x.u) }));
  let rest = units - out.reduce((t, x) => t + x.units, 0);
  const order = out.map((x, i) => [x.u - Math.floor(x.u), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (rest <= 0) break; out[i].units++; rest--; }
  return out.filter((x) => x.units > 0).map(({ u, units: n, ...x }) => ({ ...x, h: n / 4 }));
}

const covers = (i, d) => {
  if (i.support && !i.start && !i.due) return true;
  if (!i.start && !i.due) return false;
  const s = i.start || null, e = i.due || null;
  return (!s || s <= d) && (!e || e >= d) && !!(s || e);
};

/**
 * @param days      [{ iso, possible, isPast, isToday }]
 * @param issues    work item shapes (mine.week ∪ mine.evidence)
 * @param worklogs  my worklogs of the week
 * @param events    my evidence events of the week
 */
export function suggestWeek({ days, issues, worklogs, events, maxPerDay = 4, minChunk = 0.5 }) {
  const byId = new Map(issues.map((i) => [i.id, i]));
  // a sub-task's activity is booked on its story (sub-tasks are not bookable)
  const target = (id) => {
    const i = byId.get(id);
    if (!i) return null;
    if (!i.type?.subtask) return i;
    if (!i.parent) return null;
    if (!byId.has(i.parent.id)) byId.set(i.parent.id, { id: i.parent.id, key: i.parent.key, summary: i.parent.summary, type: { name: 'Story', subtask: false }, status: { name: '', cat: 'indeterminate' }, project: i.project, mine: false, synthetic: true });
    return byId.get(i.parent.id);
  };
  const booked = new Map(); const cellBooked = new Set(); const worked = new Set();
  for (const w of worklogs || []) { booked.set(w.d, (booked.get(w.d) || 0) + w.h); if (w.h > 0) { cellBooked.add(`${w.issueId}|${w.d}`); worked.add(String(w.issueId)); } }
  // planning edits never count (also when an older server still sends them)
  const evidence = (events || []).filter((e) => !(e.kind === 'edit' && (e.planning === true || (Array.isArray(e.fields) && planningOnly(e.fields)))));
  const list = [], perDay = {};
  for (const day of days) {
    if (!(day.isPast || day.isToday) || !(day.possible > 0)) continue;
    const gap = q(day.possible - (booked.get(day.iso) || 0));
    if (gap < 0.25) continue;
    // evidence of that day, per bookable work item
    const ev = new Map();
    for (const e of evidence) {
      if (e.d !== day.iso) continue;
      const t = target(e.issueId);
      if (!t || t.type?.subtask) continue;
      const x = ev.get(t.id) || ev.set(t.id, { issue: t, w: 0, events: [], real: false }).get(t.id);
      x.w += W[e.kind] || 1;
      x.real ||= realWork(e, byId.get(e.issueId)) || worked.has(String(e.issueId));
      x.events.push({ ...e, viaKey: e.issueId !== t.id ? byId.get(e.issueId)?.key : null });
    }
    const free = (c) => !cellBooked.has(`${c.issue.id}|${day.iso}`);
    // a work item that is not mine only with real work on it (my worklog this week, comment, status, content edit)
    const mineOrWorked = (c) => c.issue.mine || c.real || worked.has(String(c.issue.id));
    // activity first; when every evidenced cell is already booked, the plan fills the rest of the day
    let cands = [...ev.values()].filter(mineOrWorked).map(({ real, ...x }) => ({ ...x, basis: 'activity' })).filter(free); // eslint-disable-line no-unused-vars
    if (!cands.length) {
      cands = [...byId.values()].filter((i) => i.mine && !i.type?.subtask && i.status?.cat !== 'done' && covers(i, day.iso))
        .map((i) => ({ issue: i, w: i.status?.cat === 'indeterminate' ? 2 : 1, events: [], basis: 'plan' })).filter(free);
    }
    cands = cands
      .sort((a, b) => b.w - a.w || String(a.issue.key).localeCompare(String(b.issue.key), undefined, { numeric: true }))
      .slice(0, maxPerDay);
    while (cands.length > 1 && gap / cands.length < minChunk) cands.pop();
    for (const a of allocate(gap, cands)) {
      list.push({ issueId: a.issue.id, key: a.issue.key, d: day.iso, h: a.h, basis: a.basis, events: a.events, status: a.issue.status?.name || '', due: a.issue.due || null, synthetic: !!a.issue.synthetic });
    }
    perDay[day.iso] = { gap, h: list.filter((s) => s.d === day.iso).reduce((t, s) => t + s.h, 0) };
  }
  const byCell = new Map(list.map((s) => [`${s.issueId}|${s.d}`, s]));
  return { list, byCell, perDay, total: list.reduce((t, s) => t + s.h, 0), issues: [...new Set(list.map((s) => s.issueId))], shapes: byId };
}
