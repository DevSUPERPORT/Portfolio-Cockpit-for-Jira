// Lotse acts – an in-memory backend with the resolvers' contracts, for the tests and the UI's demo / mock mode.
// fakeIo(ds, { me }) → io with io.call(name, payload) writing into a deep copy of the dataset (io.ds), every call
// recorded in io.calls. Same result shapes as the server: issue.fill → { ok, previous }, plan.apply → { results:
// [{ issueId, key, ok, before }] }, health.set → the record (restore → the earlier one), support.dispatch → { results
// [{ issueId, ok, before }] }, support.reserve → { previous }, deps.link → { link, existed }, mine.book → { previous },
// capacity.get → { capacity }; io.pdf(doc) records the job document (doc.pdf). io.fail = Set of resolver names that throw (to test partial failure).
const clone = (x) => JSON.parse(JSON.stringify(x));
export function fakeIo(ds, { me = 'u1' } = {}) {
  const db = clone(ds);
  const health = new Map();
  let linkN = 9000;
  const issue = (id) => db.issues.find((i) => i.id === String(id));
  const team = (id) => (id ? db.teams.find((t) => t.id === id) || { id, name: id } : null);
  const person = (id) => (id ? db.people[id] || { id, name: id, avatar: null } : null);
  const io = {
    ds: db, calls: [], fail: new Set(),
    async call(name, p = {}) {
      io.calls.push([name, clone(p)]);
      if (io.fail.has(name)) throw Object.assign(new Error(`fake ${name} failed`), { code: 'FAKE' });
      switch (name) {
        case 'issue.fill': {
          const i = issue(p.issueId);
          if (!i) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
          const has = Object.hasOwn(p, 'restore');
          const prev = { team: i.team?.id ?? null, originalEstimate: { oe: i.oe || null, re: i.re ?? null }, startDate: i.start ?? null, dueDate: i.due ?? null, tshirt: i.tshirt ?? null, targetQuarters: i.quarters?.length ? [...i.quarters] : null }[p.usage];
          const v = has ? p.restore : p.clear ? null : p.value;
          if (p.usage === 'team') i.team = team(v);
          if (p.usage === 'originalEstimate') { if (has) { i.oe = v?.oe ?? 0; i.re = v?.re ?? 0; } else { i.oe = v || 0; i.re = i.re || v || 0; } }
          if (p.usage === 'startDate') i.start = v;
          if (p.usage === 'dueDate') i.due = v;
          if (p.usage === 'tshirt') i.tshirt = v;
          if (p.usage === 'targetQuarters') i.quarters = v ? [...v] : [];
          return { ok: true, previous: prev };
        }
        case 'plan.apply': return { results: p.moves.map((m) => {
          const i = issue(m.issueId);
          if (!i) return { issueId: m.issueId, ok: false, error: { code: 'NOT_FOUND' } };
          const before = {};
          if ('start' in m) { before.start = i.start ?? null; i.start = m.start; }
          if ('due' in m) { before.due = i.due ?? null; i.due = m.due; }
          if ('assignee' in m) { before.assignee = i.assignee?.id ?? null; i.assignee = person(m.assignee); }
          if ('team' in m) { before.team = i.team?.id ?? null; i.team = team(m.team); }
          return { issueId: m.issueId, key: i.key, ok: true, before };
        }), ok: p.moves.length, failed: 0 };
        case 'portfolio.reorder': {
          const prev = new Map(db.portfolio.map((x) => [x.ref, x.rank]));
          const slots = [...db.portfolio].sort((a, b) => a.rank - b.rank).map((x) => x.ref);
          const moving = new Set(p.order);
          const idx = slots.map((r, k) => (moving.has(r) ? k : -1)).filter((k) => k >= 0);
          const next = [...slots]; idx.forEach((k, j) => { next[k] = p.order[j]; });
          for (const x of db.portfolio) x.rank = next.indexOf(x.ref) + 1;
          return { changes: db.portfolio.filter((x) => prev.get(x.ref) !== x.rank).length };
        }
        case 'health.set': {
          const it = db.portfolio.find((x) => x.ref === p.ref);
          const st = health.get(p.ref) || health.set(p.ref, []).get(p.ref);
          if (p.restore === true) { it.health = st.length ? st.pop() : null; return it.health; }
          st.push(it.health ?? null);
          it.health = { status: p.status, comment: p.comment, at: '2026-11-12T10:00:00.000Z', byName: db.people[me]?.name || me };
          return it.health;
        }
        case 'support.dispatch': case 'support.undoDispatch': return { results: p.items.map((x) => {
          const t = db.supportTickets.tickets.find((y) => y.id === x.issueId);
          const before = { accountId: t.assignee?.id ?? null, teamId: t.team?.id ?? null, statusId: null };
          if (name === 'support.dispatch') { if (x.teamId) t.team = team(x.teamId); if (x.accountId) t.assignee = person(x.accountId); } else { t.team = team(x.teamId); t.assignee = person(x.accountId); }
          return { issueId: x.issueId, ok: true, error: null, before };
        }) };
        case 'support.reserve': {
          db.capacity.teams[p.teamId] ||= { name: p.teamName || p.teamId, dailyBusinessPct: 20, internalPct: 0, absenceRatePct: 10, extraWeeklyHours: 0 };
          const previous = db.capacity.teams[p.teamId].supportOverride ?? null;
          if (p.hours == null) delete db.capacity.teams[p.teamId].supportOverride; else db.capacity.teams[p.teamId].supportOverride = p.hours;
          return { teamId: p.teamId, hours: p.hours, previous };
        }
        case 'deps.link': {
          const pre = issue(p.preId), dep = issue(p.depId);
          const ex = (pre.links || []).find((l) => l.otherId === dep.id && l.outward);
          if (ex) return { ok: true, existed: true, link: ex };
          const id = String(++linkN);
          pre.links.push({ id, typeId: '10000', verb: 'blocks', inverse: 'is blocked by', outward: true, otherId: dep.id });
          dep.links.push({ id, typeId: '10000', verb: 'blocks', inverse: 'is blocked by', outward: false, otherId: pre.id });
          return { ok: true, existed: false, link: { id, typeId: '10000', outward: true, otherId: dep.id } };
        }
        case 'deps.unlink': {
          for (const i of [issue(p.preId), issue(p.depId)]) i.links = i.links.filter((l) => l.id !== p.linkId);
          return { ok: true };
        }
        case 'mine.book': {
          const i = issue(p.issueId) || db.supportTickets.tickets.find((t) => t.id === p.issueId);
          const mineDay = (i.worklogs || []).filter((w) => w.a === me && w.d === p.date);
          const previous = { hours: mineDay.reduce((a, w) => a + w.h, 0), comment: '' };
          i.worklogs = (i.worklogs || []).filter((w) => !(w.a === me && w.d === p.date));
          if (p.hours > 0) i.worklogs.push({ a: me, d: p.date, h: p.hours });
          return { op: 'set', date: p.date, previous };
        }
        case 'capacity.get': return { capacity: clone(db.capacity) };
        case 'capacity.save': db.capacity = clone(p.capacity); return { ok: true };
        case 'notices.remind': return { sent: (p.accountIds || []).length };
        default: throw Object.assign(new Error(`unknown resolver ${name}`), { code: 'UNKNOWN' });
      }
    },
    // the app's PDF hook (components/lotse/io.js → lib/jobPdf.js): records the document model instead of painting it
    docs: [],
    async pdf(doc, opts = {}) { io.calls.push(['doc.pdf', { title: doc?.title, sections: (doc?.sections || []).length, each: !!opts.each }]); io.docs.push(doc); return { name: `${String(doc?.title || 'doc').slice(0, 40)}.pdf`, pages: 1 + (doc?.sections || []).length }; },
    writes: () => io.calls.filter(([n]) => n !== 'capacity.get' && n !== 'doc.pdf').length,
  };
  return io;
}
