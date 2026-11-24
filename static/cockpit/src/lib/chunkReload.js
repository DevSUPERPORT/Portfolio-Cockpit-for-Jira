// After a release the open page still runs the previous build; its not-yet-loaded view files (hashed chunks) may be
// gone, so opening such a tab fails with "Failed to fetch dynamically imported module". Instead of an error card the
// page reloads itself once and comes back on the new build. Guard: at most one reload per 30 s and tab
// (sessionStorage), so a real network problem shows the normal error instead of a reload loop.
import { lazy } from 'react';

const KEY = 'pc-chunk-reload';
const GAP_MS = 30000;

export function isChunkError(e) {
  const m = String(e?.message || e || '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Unable to preload CSS|Loading chunk \S+ failed/i.test(m);
}

/** Reloads the host page once; true when a reload was started (the caller then waits), false when guarded. */
export function reloadOnce(now = Date.now(), store = globalThis.sessionStorage) {
  try {
    const last = Number(store?.getItem(KEY) || 0);
    if (last && now - last < GAP_MS) return false;
    store?.setItem(KEY, String(now));
  } catch { return false; } // no storage → no guard → no automatic reload
  // the Jira page itself (the frame URL alone may still point at the old build); the plain frame reload as fallback
  import('./bridge.js').then(({ router }) => router.reload()).catch(() => globalThis.location?.reload());
  return true;
}

/** React.lazy that turns a chunk-load failure after a release into one reload (the Suspense fallback stays). */
export function lazyView(load) {
  return lazy(() => load().catch((e) => {
    if (isChunkError(e) && reloadOnce()) return new Promise(() => {});
    throw e;
  }));
}

/** Vite reports failed preloads of a view's dependencies as 'vite:preloadError' – same treatment. */
export function watchPreloadErrors(target = globalThis.window) {
  target?.addEventListener?.('vite:preloadError', (ev) => { if (reloadOnce()) ev.preventDefault(); });
}
