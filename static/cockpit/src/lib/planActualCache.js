// Plan vs. actual (resolver planActual.get, last 4 weeks, all teams) for Lotse's jobs – loaded once per session on first
// need, like the history and the playbooks. No right or an error simply means "not available" (the job greys it out).
import { useEffect, useState } from 'react';
import { call } from './api.js';

let cache = null;
let inflight = null;
const subs = new Set();
export function loadPlanActual() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) inflight = call('planActual.get', { weeks: 4, team: 'all' }).then((r) => r || null, () => null).then((v) => { cache = v; inflight = null; for (const f of subs) f(v); return v; });
  return inflight;
}
export function usePlanActual(want) {
  const [v, setV] = useState(cache);
  useEffect(() => { subs.add(setV); return () => { subs.delete(setV); }; }, []);
  useEffect(() => { if (want) loadPlanActual(); }, [want]);
  return v;
}
