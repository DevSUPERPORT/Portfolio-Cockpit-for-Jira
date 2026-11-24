// Usage signals (browser): track('view:portfolio') counts an event here and sends the counts in one batch every 30 s
// and when the page is hidden – nothing else: no person, no content, no time of day (shared/usage.js allow-list; the
// server drops anything else). Never throws, never blocks the UI. In the local mock it only logs to the console.
import { call, inForge } from './api.js';
import { isUsageEvent } from '@shared/usage.js';

const EVERY_MS = 30e3;
let pending = {};
let timer = null;
let hooked = false;

async function flush() {
  timer = null;
  const events = pending;
  pending = {};
  if (!Object.keys(events).length) return;
  try {
    if (!inForge()) { console.info('[usage]', events); return; } // mock: nothing is stored
    await call('usage.track', { events });
  } catch { /* counts are best effort – a lost batch is fine */ }
}
function hook() {
  if (hooked || typeof document === 'undefined') return;
  hooked = true;
  try { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); }); } catch { /* no document */ }
}

export function track(event) {
  try {
    if (!isUsageEvent(event)) return;
    pending[event] = (pending[event] || 0) + 1;
    hook();
    if (!timer) timer = setTimeout(flush, EVERY_MS);
  } catch { /* never in the way */ }
}
export const flushUsage = flush;
