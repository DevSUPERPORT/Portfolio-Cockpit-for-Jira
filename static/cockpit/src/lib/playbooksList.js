// The support playbooks for Lotse's jobs (resolver playbooks.list, read as the person) – loaded once per session on first
// need; no right or an error simply means "none known" (the playbook command checks again when it writes).
import { useEffect, useState } from 'react';
import { call } from './api.js';

let cache = null;
let inflight = null;
const subs = new Set();
export function loadPlaybooks() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) inflight = call('playbooks.list').then((r) => r?.items || [], () => []).then((items) => { cache = items; for (const f of subs) f(items); inflight = null; return items; });
  return inflight;
}
export function usePlaybooks(want) {
  const [items, setItems] = useState(cache);
  useEffect(() => { subs.add(setItems); return () => { subs.delete(setItems); }; }, []);
  useEffect(() => { if (want) loadPlaybooks(); }, [want]);
  return items;
}
