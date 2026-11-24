import { kvs, WhereConditions } from '@forge/kvs';

export const K = {
  config: 'config',
  portfolio: 'portfolio',
  health: 'health',
  capacity: 'capacity',
  milestones: 'milestones',
  spacePlans: 'space-plans',
  report: 'report:snapshot',
  supportCache: 'support:cache',
  appFields: 'meta:app-fields',
  noticesLast: 'notices:last',
  pref: (accountId) => `pref:${accountId}`,
  // The report composer's draft of one person (prefs.save { reportDraft }) – its own key, so the bootstrap stays light.
  reportDraft: (accountId) => `draft:report:${accountId}`,
  // A Confluence page published from the report composer (version, publisher, last body) – for republish and undo.
  reportPage: (pageId) => `report:page:${pageId}`,
  reportPageBody: (pageId, which) => `report:page:${pageId}:${which}`,
  // Daily record of each project's core numbers (the cockpit grading its own forecasts later), one key per month.
  history: (ym) => `history:${ym}`,
  // "Since your last visit": the snapshot to compare against, and the one taken this visit.
  digestBase: (accountId) => `digest:${accountId}:base`,
  digestLatest: (accountId) => `digest:${accountId}:latest`,
};

export const get = async (key, fallback = null) => (await kvs.get(key)) ?? fallback;
export const set = (key, value) => kvs.set(key, value);
export const del = (key) => kvs.delete(key);
// Every { key, value } whose key starts with prefix (ascending, at most max) – for append-only records (usage shards).
export async function listByPrefix(prefix, max = 1000) {
  const out = [];
  let cursor;
  for (let i = 0; i < Math.ceil(max / 100) + 1 && out.length < max; i++) {
    let qb = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) qb = qb.cursor(cursor);
    const page = await qb.getMany();
    out.push(...page.results.map((r) => ({ key: r.key, value: r.value })));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out.slice(0, max);
}

// People who switched AI on for themselves (pref:<accountId>.ai === true) – a count only.
export async function countAiUsers() {
  let cursor, n = 0;
  for (let i = 0; i < 100; i++) {
    let qb = kvs.query().where('key', WhereConditions.beginsWith('pref:')).limit(100);
    if (cursor) qb = qb.cursor(cursor);
    const page = await qb.getMany();
    n += page.results.filter((r) => r.value?.ai === true).length;
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return n;
}

// Append-only audit trail. Keys sort chronologically; the newest are listed first by reversing pages.
export async function audit(ctx, action, details = {}) {
  const at = new Date().toISOString();
  const key = `audit:${at}:${Math.random().toString(36).slice(2, 8)}`;
  await kvs.set(key, JSON.parse(JSON.stringify({ at, by: ctx.accountId, byName: ctx.displayName || null, action, details })));
}
export async function listAudit({ cursor, limit = 50 } = {}) {
  let qb = kvs.query().where('key', WhereConditions.beginsWith('audit:')).limit(Math.min(100, limit));
  if (cursor) qb = qb.cursor(cursor);
  const page = await qb.getMany();
  return { entries: page.results.map((r) => r.value), nextCursor: page.nextCursor || null };
}
// The newest entries: KVS returns keys ascending, so walk to the end (bounded) and keep the tail.
export async function recentAudit(limit = 100) {
  const all = [];
  let cursor;
  for (let i = 0; i < 40; i++) {
    const p = await listAudit({ cursor, limit: 100 });
    all.push(...p.entries);
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return all.slice(-limit).reverse();
}

// ---------- configuration versions ----------
// Every saved configuration is kept (newest 30) so admins can change things freely and roll back.
const HIST = 'config:history:';
export async function addConfigVersion(ctx, config, sections, note) {
  const at = new Date().toISOString();
  const id = `${at}:${Math.random().toString(36).slice(2, 8)}`;
  await kvs.set(HIST + id, JSON.parse(JSON.stringify({ id, at, by: ctx.accountId, byName: ctx.displayName || null, sections, note: note || null, config })));
  const keys = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    let qb = kvs.query().where('key', WhereConditions.beginsWith(HIST)).limit(100);
    if (cursor) qb = qb.cursor(cursor);
    const p = await qb.getMany();
    keys.push(...p.results.map((r) => r.key));
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  keys.sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 30))) await kvs.delete(k);
  return id;
}
export async function listConfigVersions() {
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    let qb = kvs.query().where('key', WhereConditions.beginsWith(HIST)).limit(100);
    if (cursor) qb = qb.cursor(cursor);
    const p = await qb.getMany();
    out.push(...p.results.map((r) => r.value));
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
export const getConfigVersion = (id) => kvs.get(HIST + id);
