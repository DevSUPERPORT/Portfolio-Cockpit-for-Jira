// Resolver calls. Inside Jira: @forge/bridge invoke. In a plain browser (local design work): the mock backend.
let bridge = null;
let mock = null;
export const inForge = () => typeof window !== 'undefined' && window.parent !== window && !new URLSearchParams(location.search).has('mock');

export async function getBridge() {
  if (!bridge) {
    // Company policy: never open or call Rovo. Only the named bridge functions the app needs are imported
    // (lib/bridge.js), so the bridge's Rovo opener is not even part of the shipped code.
    bridge = Object.freeze({ ...(await import('./bridge.js')) });
  }
  return bridge;
}

export class ApiError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

// While a cached snapshot is on screen, writes are refused (code STALE) until fresh data has arrived,
// so nothing is ever written on the basis of a stale view. Reads go straight through.
const READS = new Set(['teams.atlassian', 'planActual.get', 'availability', 'bootstrap', 'dataset', 'prefs.save', 'digest.save', 'portfolio.candidates', 'users.search', 'capacity.get',
  'report.get', 'confluence.spaces', 'config.get', 'config.detect', 'meta.groups', 'meta.projects', 'meta.versions',
  'meta.confluenceSpaces', 'audit.list', 'ai.ask', 'ai.healthDraft', 'ai.reportSummary', 'ai.assist', 'settings.get', 'fields.options', 'config.history', 'config.version', 'support.preview', 'booking.worklogs', 'history.get', 'mine.week', 'mine.search', 'mine.evidence', 'insights.history', 'insights.comments', 'playbooks.list', 'ai.users', 'ai.spend',
  // Lotse's approved phrases, the admin's usage view; usage.track only adds counts and never depends on what is on screen
  // (report.draft: the report composer's own draft, read back on open)
  'lotse.learned', 'usage.summary', 'usage.track', 'report.draft', 'lotse.llm']);
let writesHeld = false;
export function holdWrites() { writesHeld = true; }
export function releaseWrites() { writesHeld = false; }

// Last dataset per account, site, module and space, kept in sessionStorage: it lives only in this
// browser tab and is gone when the tab closes. It is shown instantly on the next open and replaced
// as soon as fresh data arrives. Snapshots of other accounts are dropped on sight.
const SNAP_MAX_AGE = 6 * 3600e3;
const snapshotPrefix = (accountId) => `pc:v1:${accountId}:`;
export const snapshotKey = (ctx) => (ctx?.accountId && ctx?.cloudId && ctx.moduleKey !== 'pc-admin'
  ? `${snapshotPrefix(ctx.accountId)}${ctx.cloudId}:${ctx.moduleKey}:${ctx.extension?.project?.key || ''}` : null);
export function dropSnapshot(key) { try { if (key) sessionStorage.removeItem(key); } catch { /* ignore */ } }
export function readSnapshot(key, accountId) {
  if (!key) return null;
  try {
    const mine = snapshotPrefix(accountId);
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith('pc:') && !k.startsWith(mine)) sessionStorage.removeItem(k);
    }
    const v = JSON.parse(sessionStorage.getItem(key) || 'null');
    return v && v.v === 1 && Date.now() - v.at < SNAP_MAX_AGE && v.ds && v.boot ? v : null;
  } catch { return null; }
}
export function writeSnapshot(key, boot, ds) {
  if (!key) return;
  try {
    const raw = JSON.stringify({ v: 1, at: Date.now(), boot, ds });
    if (raw.length > 4e6) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, raw);
  } catch { /* storage full or blocked: no snapshot */ }
}

export async function call(name, payload = {}) {
  let res;
  if (writesHeld && !READS.has(name)) throw new ApiError('STALE', 'Data is still being refreshed.');
  if (inForge()) {
    const b = await getBridge();
    res = await b.invoke(name, payload);
  } else {
    // The mock backend exists only in dev builds (local design work); production bundles never contain it.
    if (!import.meta.env.DEV) throw new ApiError('NO_HOST', 'Portfolio Cockpit runs inside Jira.');
    if (!mock) mock = await import('./mock.js');
    res = await mock.invoke(name, payload);
  }
  if (!res || res.ok !== true) {
    const e = res?.error || { code: 'ERROR', message: 'No response' };
    // Taken down by SUPERPORT while the page is open: the whole app switches to the 'unavailable' page.
    if (e.code === 'UNAVAILABLE' && !/^Changes are paused/.test(e.message || '')) window.dispatchEvent(new Event('pc-unavailable'));
    throw new ApiError(e.code, e.message);
  }
  return res.data;
}

// Read-only Jira REST from the browser as the signed-in user – for the independent cross-check in "Nachweis".
// Company policy and least privilege: only /rest/api/3 reads; the one POST allowed is the JQL search.
const READ_PATH = /^\/rest\/api\/3\/(search\/jql|issue\/\d{1,18}\/(changelog|worklog)|myself|status)(\?|$)/;
export async function jiraRead(path, body) {
  if (!READ_PATH.test(path) || (body && !path.startsWith('/rest/api/3/search/jql'))) throw new ApiError('FORBIDDEN', `Blocked by policy: ${path.slice(0, 60)}`);
  if (!inForge()) {
    if (!import.meta.env.DEV) throw new ApiError('NO_HOST', 'Portfolio Cockpit runs inside Jira.');
    if (!mock) mock = await import('./mock.js');
    return mock.jiraRead(path, body);
  }
  const b = await getBridge();
  const r = await b.requestJira(path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }
    : { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new ApiError(r.status === 403 || r.status === 401 ? 'NO_ACCESS' : 'ERROR', `Jira ${r.status}`);
  return r.json();
}

export async function getContext() {
  if (!inForge()) return { moduleKey: new URLSearchParams(location.search).get('module') || 'pc-cockpit', locale: navigator.language, extension: {}, accountId: 'mock-user', cloudId: 'mock-site' };
  const b = await getBridge();
  return b.view.getContext();
}

export async function enableTheme() {
  if (!inForge()) {
    const dark = new URLSearchParams(location.search).get('theme') === 'dark';
    document.documentElement.dataset.colorMode = dark ? 'dark' : 'light';
    return;
  }
  try { const b = await getBridge(); await b.view.theme.enable(); } catch { /* light */ }
}

export async function openIssue(key) {
  if (!inForge()) { window.open(`https://example.atlassian.net/browse/${key}`, '_blank'); return; }
  try {
    const { ViewIssueModal } = await import('@forge/jira-bridge');
    new ViewIssueModal({ context: { issueKey: key } }).open();
  } catch {
    const b = await getBridge();
    b.router.open(`/browse/${key}`);
  }
}

// Several work items at once in Jira's issue search ("key in (…)"), so every row behind a number can be checked there.
// Keys are de-duplicated and checked for the KEY-123 shape; more than 100 keys open in batches of 100 (URLs stay short
// enough for Jira) – returns the number of searches opened. Mock mode: the example site in a new tab.
export const JQL_CHUNK = 100;
export const jqlFor = (keys) => `key in (${keys.join(', ')}) ORDER BY key ASC`;
export function jqlChunks(keys, size = JQL_CHUNK) {
  const valid = [...new Set((keys || []).map((k) => String(k || '').trim().toUpperCase()).filter((k) => /^[A-Z][A-Z0-9_]*-\d+$/.test(k)))];
  const out = [];
  for (let i = 0; i < valid.length; i += size) out.push(valid.slice(i, i + size));
  return out;
}
export async function openJql(keys, { batch = null } = {}) {
  const chunks = jqlChunks(keys);
  const pick = batch == null ? chunks : chunks.slice(batch, batch + 1);
  if (!pick.length) return 0;
  const urls = pick.map((ks) => `/issues/?jql=${encodeURIComponent(jqlFor(ks))}`);
  if (!inForge()) { for (const u of urls) window.open(`https://example.atlassian.net${u}`, '_blank'); return urls.length; }
  const b = await getBridge();
  for (const u of urls) await b.router.open(u);
  return urls.length;
}

export async function createIssue(issueTypeId, onCreated, projectId = null) {
  if (!inForge()) return;
  const { CreateIssueModal } = await import('@forge/jira-bridge');
  new CreateIssueModal({ context: { issueTypeId, ...(projectId ? { projectId: String(projectId) } : {}) }, onClose: (r) => onCreated?.(r) }).open();
}

export async function navigate(path) {
  if (!inForge()) { window.open(path, '_blank'); return; }
  const b = await getBridge();
  b.router.navigate(path);
}
export async function openUrl(url) {
  if (!inForge()) { window.open(url, '_blank'); return; }
  const b = await getBridge();
  b.router.open(url);
}
