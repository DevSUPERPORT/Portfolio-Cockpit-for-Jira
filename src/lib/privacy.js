// Atlassian's user privacy requirements: an app that stores Atlassian account IDs reports them to the Personal Data
// Reporting API at least every 7 days and removes the data of accounts Atlassian reports as closed.
//
// The cockpit stores account IDs in many places (capacity, health, audit log, plan snapshots, usage, preferences,
// drafts, caches), so instead of a registry this job scans the app's whole storage for anything shaped like an
// account ID – in keys and in values. Runs from the daily `pc-privacy` trigger (every site, licensed or not); the
// report itself happens every 6 days. Every run has a time budget; unfinished work continues the next day.
//
// Closed accounts: keys that belong to the account (pref:<id>, digest:<id>:…, draft:report:<id>, usage:<day>:<id>, …)
// are deleted; in every other record the account's entries are removed (object properties keyed by the ID, array
// entries that are the ID or whose accountId/id is the ID) and any other mention becomes "closed-account". Records
// are re-read right before they are changed, so a concurrent change is not overwritten.
import { privacy } from '@forge/api';
import { kvs } from '@forge/kvs';
import { logWarn } from './safeLog.js';

const LAST_RUN = 'privacy:last-report';
const EVERY_MS = 6 * 86400000; // daily trigger: a 6-day gap keeps every report within Atlassian's 7 days
const BATCH = 90; // Atlassian's limit per call
const BUDGET_MS = 8 * 60 * 1000;
export const CLOSED = 'closed-account';

// Atlassian account IDs: "<6 digits>:<uuid>" (current) or 24 hex characters (older accounts).
const ID_SRC = '(?<![0-9A-Za-z-])(?:\\d{6}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24})(?![0-9A-Za-z-])';
const idRe = () => new RegExp(ID_SRC, 'g');
export const isAccountId = (s) => typeof s === 'string' && new RegExp(`^${ID_SRC}$`).test(s);

/** Every account ID in one stored entry (key and value). */
export function accountsIn(key, value) {
  const out = new Set();
  for (const s of [String(key), value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)]) {
    for (const m of s.matchAll(idRe())) out.add(m[0]);
  }
  return out;
}

const mentions = (s, closed) => { for (const m of String(s).matchAll(idRe())) if (closed.has(m[0])) return true; return false; };
const replaceIds = (s, closed) => s.replace(idRe(), (m) => (closed.has(m) ? CLOSED : m));

/** The value without the closed accounts (pure; returns a new value). */
export function scrubValue(v, closed) {
  if (typeof v === 'string') return mentions(v, closed) ? replaceIds(v, closed) : v;
  if (Array.isArray(v)) {
    return v
      .filter((x) => !(typeof x === 'string' && closed.has(x)) && !(x && typeof x === 'object' && !Array.isArray(x) && (closed.has(x.accountId) || closed.has(x.id))))
      .map((x) => scrubValue(x, closed));
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!closed.has(k)) out[k] = scrubValue(x, closed);
    return out;
  }
  return v;
}

/** A key that belongs to one closed account (its own preferences, drafts, usage shard …) is deleted, not scrubbed. */
export const keyOfClosed = (key, closed) => mentions(key, closed);

const defaultStore = {
  async page(cursor) {
    let q = kvs.query().limit(100);
    if (cursor) q = q.cursor(cursor);
    const r = await q.getMany();
    return { results: r?.results || [], cursor: r?.nextCursor || null };
  },
  get: (k) => kvs.get(k),
  set: (k, v) => kvs.set(k, v),
  del: (k) => kvs.delete(k),
};

async function* scan(store, deadline) {
  let cursor = null;
  do {
    const p = await store.page(cursor);
    for (const r of p.results) yield r;
    cursor = p.cursor;
    if (Date.now() > deadline) throw Object.assign(new Error('privacy: time budget'), { code: 'BUDGET' });
  } while (cursor);
}

/** Removes closed accounts everywhere. Returns false when the time budget ran out (continues on the next run). */
export async function eraseAccounts(ids, { store = defaultStore, deadline = Date.now() + BUDGET_MS } = {}) {
  const closed = new Set(ids);
  if (!closed.size) return true;
  try {
    for await (const { key, value } of scan(store, deadline)) {
      if (key === LAST_RUN) continue;
      if (keyOfClosed(key, closed)) { await store.del(key); continue; }
      if (!mentions(typeof value === 'string' ? value : JSON.stringify(value ?? ''), closed)) continue;
      const fresh = await store.get(key); // the page may be minutes old: change the current value only
      if (fresh == null) continue;
      const next = scrubValue(fresh, closed);
      if (JSON.stringify(next) !== JSON.stringify(fresh)) await store.set(key, next);
    }
    return true;
  } catch (e) {
    if (e?.code === 'BUDGET') return false;
    throw e;
  }
}

/** Every account ID the app stores. */
export async function storedAccounts({ store = defaultStore, deadline = Date.now() + BUDGET_MS } = {}) {
  const out = new Set();
  for await (const { key, value } of scan(store, deadline)) for (const id of accountsIn(key, value)) out.add(id);
  return out;
}

/**
 * Called daily; reports every 6 days. `report` is Atlassian's privacy.reportPersonalData (injectable for tests).
 * The app stores no profile data, so "updated" answers need nothing; "closed" accounts are erased.
 */
export async function reportPersonalData({ report = (a) => privacy.reportPersonalData(a), store = defaultStore, now = Date.now(), deadline = Date.now() + BUDGET_MS } = {}) {
  const last = await store.get(LAST_RUN);
  if (last && now - new Date(last).getTime() < EVERY_MS) return { reported: 0, erased: 0, skipped: true };
  let ids;
  try { ids = [...(await storedAccounts({ store, deadline }))]; } catch (e) {
    if (e?.code === 'BUDGET') return { reported: 0, erased: 0, skipped: false, unfinished: true };
    throw e;
  }
  const updatedAt = new Date(now).toISOString();
  const closed = new Set();
  const take = (updates) => { for (const u of updates || []) if (u?.status === 'closed' && u.accountId) closed.add(u.accountId); };
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH).map((accountId) => ({ accountId, updatedAt }));
    try { take(await report(batch)); } catch {
      // one value that only looks like an account ID must not block the others: report them one by one
      for (const a of batch) { try { take(await report([a])); } catch { /* not an account Atlassian knows */ } }
    }
  }
  if (!(await eraseAccounts(closed, { store, deadline }))) {
    logWarn('[privacy]', new Error(`erasing ${closed.size} closed account(s) continues tomorrow`));
    return { reported: ids.length, erased: 0, skipped: false, unfinished: true };
  }
  await store.set(LAST_RUN, new Date(now).toISOString());
  return { reported: ids.length, erased: closed.size, skipped: false };
}
