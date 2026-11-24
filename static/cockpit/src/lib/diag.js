// Test builds only (VITE_SELFTEST=1): startup stages and uncaught errors are written to the sandbox
// issue property "pc-diag" (readable over REST), because the app frame's console is not reachable
// from the test driver. Production builds compile this away (mark() becomes a no-op).
const on = import.meta.env.VITE_SELFTEST === '1';
const log = [];
let timer = null;
// never on the production environment (customer installs) – see selftest.jsx
let envOk = null;
const notProduction = async () => {
  if (envOk === null) envOk = await import('./api.js').then(({ getContext }) => getContext()).then((c) => String(c?.environmentType || '').toUpperCase() !== 'PRODUCTION', () => false);
  return envOk;
};
const flush = async () => {
  timer = null;
  if (!(await notProduction())) return;
  import('./bridge.js').then(({ requestJira }) => requestJira('/rest/api/3/issue/PCX-1/properties/pc-diag', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ log }),
  })).catch(() => {});
};
export function mark(stage) {
  if (!on) return;
  log.push(`${Math.round(performance.now())}ms ${String(stage).slice(0, 600)}`);
  if (!timer) timer = setTimeout(flush, 300);
}
if (on && typeof window !== 'undefined') {
  window.addEventListener('error', (e) => mark(`ERROR ${e.error?.stack || e.message}`));
  window.addEventListener('unhandledrejection', (e) => mark(`REJECTION ${e.reason?.stack || e.reason}`));
}
