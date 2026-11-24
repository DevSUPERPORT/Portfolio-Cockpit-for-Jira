// What Lotse is doing right now – a tiny store without the engine, so the header pill and the search (Ctrl K) can show
// it without loading the panel's code.
//   runs[id]   the UI state of one act in the thread (command card / workflow run / decision), kept while the page
//              lives – closing and reopening the panel resumes exactly there
//   recent     the last acts started ({ label, icon, req }), newest first – "Zuletzt" in the search
//   activeRun()  the newest workflow that still waits for the person (for the header pill)
let snap = { runs: {}, recent: [], v: 0 };
const subs = new Set();
const emit = () => { snap = { ...snap, v: snap.v + 1 }; subs.forEach((f) => f()); };
export const runStore = {
  get: () => snap,
  subscribe(f) { subs.add(f); return () => subs.delete(f); },
  run: (id) => snap.runs[id] || null,
  // patch: an object, or a function of the current run → the next one
  set(id, patch) {
    const cur = snap.runs[id] || {};
    const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
    snap = { ...snap, runs: { ...snap.runs, [id]: next } };
    emit();
    return next;
  },
  // the thread was cleared ("Neu"): its runs no longer wait for anyone – the header pill goes away at once (tester
  // 2026-11-17: the pill stayed until a reload); undo of the clear brings them back
  hide(ids, hidden = true) {
    const runs = { ...snap.runs };
    let n = 0;
    for (const id of ids) if (runs[id]) { runs[id] = { ...runs[id], cleared: hidden }; n++; }
    if (n) { snap = { ...snap, runs }; emit(); }
  },
  drop(id) { if (!snap.runs[id]) return; const runs = { ...snap.runs }; delete runs[id]; snap = { ...snap, runs }; emit(); },
  remember(entry) {
    if (!entry?.label) return;
    snap = { ...snap, recent: [entry, ...snap.recent.filter((x) => x.label !== entry.label)].slice(0, 5) };
    emit();
  },
};
const LIVE = new Set(['running', 'waiting', 'ready']);
export function activeRun(s = snap) {
  const list = Object.entries(s.runs).filter(([, r]) => r.kind === 'workflow' && !r.cleared && r.state && LIVE.has(r.state.status)).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  return list.length ? { id: list[0][0], ...list[0][1] } : null;
}
