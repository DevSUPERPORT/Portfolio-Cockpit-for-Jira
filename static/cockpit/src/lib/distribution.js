// The weekly board's distribution switch (even / by free capacity), remembered on this device. Shared by the board and
// by My work, so a person's load shows the same number in both (boss 2026-11-20) – a small module, so My work does
// not load the whole board.
import { useSyncExternalStore } from 'react';
import { distributionOf } from '@shared/weekPlan.js';

const DIST_KEY = 'pc-wb-dist';
let distSnap = (() => { try { const v = localStorage.getItem(DIST_KEY); return v === 'even' || v === 'capacity' ? v : null; } catch { return null; } })();
const distSubs = new Set();
export const distStore = {
  get: () => distSnap,
  set(v) { distSnap = v; try { localStorage.setItem(DIST_KEY, v); } catch { /* private window */ } distSubs.forEach((f) => f()); },
  subscribe(f) { distSubs.add(f); return () => distSubs.delete(f); },
};
export function useDistribution(config) {
  const mine = useSyncExternalStore(distStore.subscribe, distStore.get, distStore.get);
  return mine || distributionOf(config?.rules?.distribution);
}
