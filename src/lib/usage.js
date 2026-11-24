// Usage signals (server): counts only, per site and day – see shared/usage.js for the rules. No account id, name or
// content is ever written here: track() receives nothing but { event name → count } after the allow-list.
//   usage.track   (write) – stores a batch from the browser for today; days older than 30 are deleted
//   usage.summary (read, Jira admins) – the last 30 days, undo rate, Lotse vs. AI, top skills / workflows
//
// Race-free counting: app storage has no atomic increment, and two browsers flushing at the same moment would lose one
// batch with read-add-write on one day key. So every batch is APPEND-ONLY: its own shard key `usage:<day>:<id>` (never
// read before it is written, never overwritten). Reading merges the day record and the day's shards. Closed days (older
// than yesterday) are compacted into the day record by the hourly job / the admin view: list the shards FIRST, then read
// the day record, skip shards it already holds (`from`), write it, then delete the shards. Two compactions running at
// once write the same result, and a shard is only deleted after a day record that holds it was written – nothing is
// counted twice and nothing is lost.
import { get, set, del, listByPrefix } from './store.js';
import { cleanBatch, mergeDay, usageSummary, usageDays, USAGE_DAYS } from '../../shared/usage.js';

export const USAGE_KEY = (day) => `usage:${day}`;
export const USAGE_SHARD = (day, id) => `usage:${day}:${id}`;
const SHARD_PREFIX = (day) => `usage:${day}:`;
const today = (now) => new Date(now).toISOString().slice(0, 10);
const MAX_SHARDS_READ = 5000; // per day; beyond that the day is compacted first (bounded work per request)
const MAX_FROM = 20000;       // shard ids remembered in a day record (≈ 12 characters each)

const depsOf = (deps) => ({ get: deps.get || get, set: deps.set || set, del: deps.del || del, list: deps.list || listByPrefix, now: deps.now ?? Date.now(), id: deps.id || (() => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`) });

// deps (tests): { get, set, del, list(prefix, max) → [{ key, value }], now, id }
export async function trackUsage(payload, deps = {}) {
  const D = depsOf(deps);
  const batch = cleanBatch(payload);
  const n = Object.keys(batch).length;
  if (!n) return { stored: 0 };
  // append-only: a key of its own – no read before the write, so no concurrent batch can be overwritten
  await D.set(USAGE_SHARD(today(D.now), D.id()), mergeDay(null, batch));
  // keep 30 days: the day that just fell out of the window goes (one delete per write, cheap)
  await Promise.resolve(D.del(USAGE_KEY(today(D.now - USAGE_DAYS * 864e5)))).catch(() => null);
  return { stored: n };
}

// The counts of one day: the compacted record plus every shard it does not hold yet.
async function readDay(D, day) {
  const [rec, shards] = await Promise.all([
    Promise.resolve(D.get(USAGE_KEY(day))).catch(() => null),
    Promise.resolve(D.list(SHARD_PREFIX(day), MAX_SHARDS_READ)).catch(() => []),
  ]);
  const held = new Set(Array.isArray(rec?.from) ? rec.from : []);
  let day0 = { counts: rec?.counts || {} };
  for (const s of shards || []) if (!held.has(s.key.slice(SHARD_PREFIX(day).length))) day0 = mergeDay(day0, s.value?.counts || {});
  return day0.counts;
}

// Compacts one closed day (see the header for why the order makes it safe). Returns the number of shards folded in.
export async function compactDay(day, deps = {}) {
  const D = depsOf(deps);
  const prefix = SHARD_PREFIX(day);
  const shards = (await D.list(prefix, MAX_SHARDS_READ)) || [];   // 1 · list first …
  if (!shards.length) return 0;
  const rec = (await D.get(USAGE_KEY(day))) || {};                 // 2 · … then read the record
  const held = new Set(Array.isArray(rec.from) ? rec.from : []);
  let next = { counts: rec.counts || {} };
  const added = [];
  for (const s of shards) {
    const id = s.key.slice(prefix.length);
    if (held.has(id)) continue;
    next = mergeDay(next, s.value?.counts || {});
    added.push(id);
  }
  if (added.length) await D.set(USAGE_KEY(day), { counts: next.counts, from: [...held, ...added].slice(-MAX_FROM) }); // 3 · write
  for (const s of shards) await Promise.resolve(D.del(s.key)).catch(() => null);                                 // 4 · then delete
  return added.length;
}

// Closed days of the 30-day window (before yesterday – today and yesterday may still receive batches), plus the day that
// left the window (its shards are deleted with it).
export async function compactUsage(deps = {}) {
  const D = depsOf(deps);
  const days = usageDays(D.now).slice(0, -2);
  let n = 0;
  for (const day of days) n += await compactDay(day, D).catch(() => 0);
  const gone = today(D.now - USAGE_DAYS * 864e5);
  for (const s of (await Promise.resolve(D.list(SHARD_PREFIX(gone), MAX_SHARDS_READ)).catch(() => [])) || []) await Promise.resolve(D.del(s.key)).catch(() => null);
  return { compacted: n };
}

export async function readUsage(deps = {}) {
  const D = depsOf(deps);
  const days = await Promise.all(usageDays(D.now).map(async (day) => ({ day, counts: await readDay(D, day) })));
  return usageSummary(days, D.now);
}
