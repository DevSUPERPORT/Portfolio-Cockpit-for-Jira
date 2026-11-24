// Lotse's io – how an applied command reaches Jira and the screen (contract: shared/lotse/act/commands.js).
// Pure (no React): the hook in hooks.js passes the app's own functions in, the tests pass recorders.
//
//   createIo({ call, fill?, reorder?, setDs?, reload?, delay?, schedule?, cancel? }) → io
//     io.call(resolver, payload)  the app's resolver call; after a write the matching data is patched in place
//                                 (setDs), so every view shows the change at once – the rest reloads quietly
//     io.fill(args)               state.fill with collectUndo: true → the exact undo fn (optimistic patch included)
//     io.reorder(order, opts)     state.reorder silently (the command brings its own undo entry)
//     io.patch(kind, data)        the command's hint after a write: kinds without a local patch reload the data
//     io.pdf(doc, { each })       doc.pdf (a Lotse job's document): the app paints and downloads it (lib/jobPdf.js) –
//                                 nothing is sent anywhere; → { name, pages }
//     io.calls                    every call and patch, in order (the tests read it)
//
// The mock preview uses the real mock backend through `call`; shared/lotse/act/fakeIo.js is for the tests only.
export const RELOAD_KINDS = new Set(['deps', 'booking', 'capacity', 'reserve']);
const RELOAD_CALLS = new Set(['deps.link', 'deps.unlink', 'mine.book', 'capacity.save', 'support.reserve', 'issue.fill', 'portfolio.reorder']);

const personOf = (ds, id) => (id ? (ds.people?.[id] ? { id, name: ds.people[id].name, avatar: ds.people[id].avatar ?? null } : { id, name: id, avatar: null }) : null);
const teamOf = (ds, id) => (id ? (ds.teams || []).find((t) => t.id === id) || { id, name: id } : null);

// The local patch of one successful resolver call – the same change the server made, applied to the dataset.
export function patchFor(name, payload = {}, res) {
  if (name === 'plan.apply') {
    const ok = new Set((res?.results || []).filter((r) => r.ok).map((r) => String(r.issueId)));
    const moves = (payload.moves || []).filter((m) => ok.has(String(m.issueId)));
    if (!moves.length) return null;
    const by = new Map(moves.map((m) => [String(m.issueId), m]));
    return (ds) => ({ ...ds, issues: (ds.issues || []).map((i) => {
      const m = by.get(i.id);
      if (!m) return i;
      const y = { ...i };
      if ('start' in m) y.start = m.start;
      if ('due' in m) y.due = m.due;
      if ('assignee' in m) y.assignee = personOf(ds, m.assignee);
      return y;
    }) });
  }
  if (name === 'health.set' && payload.ref) {
    const h = res && typeof res === 'object' && res.status ? res : null;
    return (ds) => ({ ...ds, portfolio: (ds.portfolio || []).map((p) => (p.ref === payload.ref ? { ...p, health: h } : p)) });
  }
  if (name === 'support.dispatch' || name === 'support.undoDispatch') {
    const ok = new Set((res?.results || []).filter((r) => r.ok !== false).map((r) => String(r.issueId)));
    const items = (payload.items || []).filter((x) => ok.has(String(x.issueId)));
    if (!items.length) return null;
    const exact = name === 'support.undoDispatch';
    const by = new Map(items.map((x) => [String(x.issueId), x]));
    return (ds) => {
      if (!ds.supportTickets?.tickets) return ds;
      return { ...ds, supportTickets: { ...ds.supportTickets, tickets: ds.supportTickets.tickets.map((t) => {
        const x = by.get(String(t.id));
        if (!x) return t;
        const y = { ...t };
        // undo: exactly the earlier value (null included) where the server restores it
        if (exact ? x.restoreTeam !== false : x.teamId) y.team = teamOf(ds, x.teamId);
        if (exact ? x.restoreAssignee !== false : x.accountId) y.assignee = personOf(ds, x.accountId);
        return y;
      }) } };
    };
  }
  return null;
}

export function createIo({ call, fill, reorder, setDs, reload, pdf, delay = 450, schedule = (f, ms) => setTimeout(f, ms), cancel = (t) => clearTimeout(t) } = {}) {
  if (typeof call !== 'function') throw new Error('createIo: call required');
  const calls = [];
  let timer = null;
  const reloadSoon = () => {
    if (typeof reload !== 'function') return;
    if (timer) cancel(timer);
    timer = schedule(() => { timer = null; reload(true); }, delay);
  };
  const io = {
    calls,
    async call(name, payload = {}) {
      calls.push(['call', name, payload]);
      const res = await call(name, payload);
      const fn = patchFor(name, payload, res);
      if (fn && typeof setDs === 'function') { calls.push(['patch', name]); setDs((d) => (d ? fn(d) : d)); }
      else if (RELOAD_CALLS.has(name)) reloadSoon();
      return res;
    },
    patch(kind) {
      calls.push(['hint', kind]);
      if (RELOAD_KINDS.has(kind)) reloadSoon();
    },
  };
  // optional paths only when the app has them – the commands fall back to io.call otherwise
  if (typeof fill === 'function') io.fill = (args) => { calls.push(['fill', args.usage, args.issueId || args.ref]); return fill({ ...args, collectUndo: true }); };
  if (typeof pdf === 'function') io.pdf = (doc, opts = {}) => { calls.push(['pdf', doc?.sections?.length || 0]); return pdf(doc, opts); };
  if (typeof reorder === 'function') io.reorder = (order, opts = {}) => { calls.push(['reorder', order.length]); return reorder(order, { ...opts, silent: true }); };
  return io;
}
