// Opening Lotse from anywhere (header, Ctrl K, view chips, the "Heute für dich" strip, Ask) without pulling the panel's
// code into every view: callers import only this tiny store. The panel (Lotse.jsx, loaded lazily by App) subscribes.
//   openLotse()                                – open the panel (thread as left)
//   openLotse({ text })                        – ask a question in words
//   openLotse({ skill, params, extra? })       – run one skill directly (view chips); extra = view data for the skill's ctx
//   openLotse({ story })                       – show a story that is already computed (Today strip)
let snap = { open: false, req: null, at: 0 };
const subs = new Set();
export const lotseStore = {
  get: () => snap,
  set(next) { snap = { ...snap, ...next }; subs.forEach((f) => f()); },
  subscribe(f) { subs.add(f); return () => subs.delete(f); },
};
export function openLotse(req = null) { lotseStore.set({ open: true, req, at: Date.now() }); }
export function closeLotse() { lotseStore.set({ open: false, req: null }); }
