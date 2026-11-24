// The history behind the "Ich will …" cards and Support › Playbooks: done stories and resolved support tickets
// (resolver insights.history, read as the user). Loaded once per session, on first need, and shared by every screen.
import { useEffect, useState } from 'react';
import { call } from './api.js';

let cache = { state: 'idle', data: null };
let inflight = null;
const subs = new Set();
const publish = (next) => { cache = next; for (const f of subs) f(next); };

export function loadInsightsHistory() {
  if (cache.state === 'ready') return Promise.resolve(cache.data);
  if (!inflight) {
    publish({ state: 'loading', data: null });
    inflight = call('insights.history', {})
      .then((data) => { publish({ state: 'ready', data }); return data; })
      .catch(() => { publish({ state: 'error', data: null }); return null; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

// { state: 'idle' | 'loading' | 'ready' | 'error', data } – starts loading when `want` becomes true.
export function useInsightsHistory(want) {
  const [h, setH] = useState(cache);
  useEffect(() => { subs.add(setH); setH(cache); return () => { subs.delete(setH); }; }, []);
  useEffect(() => { if (want && cache.state === 'idle') loadInsightsHistory(); }, [want]);
  return h;
}
