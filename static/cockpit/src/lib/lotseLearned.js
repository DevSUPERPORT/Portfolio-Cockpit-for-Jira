// Approved learned phrases for Lotse (shared/lotse/learn.js): loaded once per page via lotse.learned (a read), refreshed
// after an admin's review; every person's Lotse reads them via ctx.learned (components/lotse/engine.js useLotseCtx).
import { call } from './api.js';

let learned = [];
let loaded = false;
const subs = new Set();
export const learnedStore = {
  get: () => learned,
  subscribe(f) { subs.add(f); if (!loaded) { loaded = true; learnedStore.refresh(); } return () => subs.delete(f); },
  set(list) { learned = Array.isArray(list) ? list : []; subs.forEach((f) => f()); },
  refresh() { return call('lotse.learned').then((r) => learnedStore.set(r?.approved || []), () => null); },
};
