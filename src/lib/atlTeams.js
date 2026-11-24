// Atlassian Teams (home.atlassian.com › Teams) as the source of truth for WHO belongs to a team (boss feedback
// 2026-11-17: "Teams and team members must be the same as in Atlassian Teams").
//
// How it is read – both calls run AS THE SIGNED-IN USER, so Atlassian's own visibility rules apply:
// • the site's teams: Jira's JQL value suggestions for the Team field (the same list Jira shows in its own pickers);
// • the members of each team: the Teamwork Graph curated query `atlassianTeamMembers` (needs the scopes
//   read:graph:team:atlassian + read:graph:user:atlassian, granted by the org admin on install).
// The Teamwork Graph is not callable as the app, so the snapshot is refreshed while someone uses the cockpit (at most
// every 5 minutes, in parallel to loading the data) and kept in app storage for jobs and the issue panel.
//
// Never fails the caller: without the Team field, without the scopes or on any error the previous snapshot (or none)
// is returned with a status, and the cockpit falls back to its own capacity maintenance.
import api from '@forge/api';
import { jira } from './jira.js';
import { get, set } from './store.js';
import { logWarn } from './safeLog.js';

export const ATL_TEAMS_KEY = 'teams:atlassian';
const LOCK_KEY = 'teams:atlassian:lock';
export const TEAMS_STALE_MS = 5 * 60 * 1000; // boss 2026-11-17: a person added in Atlassian Teams must show up soon
const MAX_TEAMS = 80, MAX_PAGES = 20, POOL = 3;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT = /^[A-Za-z0-9:_-]{1,128}$/;

const Q_MEMBERS = `query superport_teamMembers($teamAri: ID!, $first: Int, $after: String) {
  atlassianTeamMembers(teamAri: $teamAri, first: $first, after: $after) {
    edges { node { __typename ... on AtlassianUser { accountId name } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

// Jira's JQL suggestions return HTML ("<b>Web</b>", "Anke&#39;s team") – plain text, entities decoded (boss 2026-11-18)
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeEntities = (s) => String(s ?? '').replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (all, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all; }
  return ENT[e.toLowerCase()] ?? all;
});
const strip = (s) => decodeEntities(String(s ?? '').replace(/<[^>]*>/g, '')).trim().slice(0, 120);
const fieldRef = (fieldId) => { const m = /^customfield_(\d{1,10})$/.exec(fieldId || ''); return m ? `cf[${m[1]}]` : null; };

// Every team Jira offers for the Team field (teams with at least one member). The suggestion list is capped, so a
// long first answer is completed by asking per first letter.
export async function siteTeams(fieldId) {
  const ref = fieldRef(fieldId);
  if (!ref) return [];
  const ask = (v) => jira('user', '/rest/api/3/jql/autocompletedata/suggestions', { query: { fieldName: ref, fieldValue: v } })
    .then((r) => (r?.results || []).filter((x) => UUID.test(String(x.value || ''))).map((x) => ({ id: String(x.value), name: strip(x.displayName) })))
    .catch(() => []);
  const out = new Map();
  const first = await ask('');
  for (const t of first) out.set(t.id, t);
  if (first.length >= 10) {
    const letters = 'abcdefghijklmnopqrstuvwxyz0123456789äöü'.split('');
    for (let i = 0; i < letters.length && out.size < MAX_TEAMS; i += 6) {
      const parts = await Promise.all(letters.slice(i, i + 6).map(ask));
      for (const t of parts.flat()) if (!out.has(t.id)) out.set(t.id, t);
    }
  }
  return [...out.values()].slice(0, MAX_TEAMS);
}

// The members of one team ({ accountId, name }[]), or null when the graph answered with an error.
export async function teamMembers(teamId, graph = defaultGraph) {
  if (!UUID.test(teamId)) return null;
  const members = [];
  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const j = await graph(Q_MEMBERS, { teamAri: `ari:cloud:identity::team/${teamId}`, first: 25, after }, 'superport_teamMembers');
    if (!j || j.errors?.length || !j.data) return null;
    const con = j.data.atlassianTeamMembers;
    for (const e of con?.edges || []) {
      const n = e?.node;
      if (n?.accountId && ACCOUNT.test(n.accountId)) members.push({ accountId: n.accountId, name: strip(n.name) });
    }
    // a short page may still say hasNextPage – follow the cursor until the graph says there is no more
    if (!con?.pageInfo?.hasNextPage || !con.pageInfo.endCursor) break;
    after = con.pageInfo.endCursor;
  }
  return members;
}

async function defaultGraph(query, variables, operationName) {
  const res = await api.asUser().requestTeamworkGraph(query, variables, operationName);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function pool(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]); } }));
  return out;
}

// Reads all teams and their members. status: 'ok' | 'empty' (the graph gave no members at all – usually the scopes
// were not granted) | 'noField' (no Team field mapped) | 'error'.
export async function readAtlassianTeams(cfg, { extraIds = [], graph = defaultGraph, now = Date.now() } = {}) {
  const fieldId = cfg?.fields?.team || '';
  if (!fieldRef(fieldId)) return { at: now, status: 'noField', teams: {} };
  const listed = await siteTeams(fieldId);
  const byId = new Map(listed.map((t) => [t.id, t]));
  for (const id of extraIds) if (UUID.test(id) && !byId.has(id) && byId.size < MAX_TEAMS) byId.set(id, { id, name: '' });
  const ids = [...byId.keys()];
  const res = await pool(ids, POOL, (id) => teamMembers(id, graph).catch(() => null));
  const teams = {};
  let failed = 0, people = 0;
  ids.forEach((id, k) => {
    if (res[k] == null) { failed++; return; }
    teams[id] = { name: byId.get(id).name, members: res[k] };
    people += res[k].length;
  });
  const status = !ids.length ? 'ok' : failed === ids.length ? 'error' : people === 0 ? 'empty' : 'ok';
  return { at: now, status, teams, ...(failed && status !== 'error' ? { failed } : {}) };
}

// The issue panel's lozenge ("Nicht im Team") without loading the whole portfolio: Atlassian Teams decide where the
// snapshot knows the team; otherwise the maintained capacity does (only when person-level values are on, and only
// for people whose capacity is maintained – everyone else is simply not judged here).
// → 'member' | 'outside' | null (nothing to say)
export function quickTeamStatus({ cfg, snap, capacity, assigneeId, teamId }) {
  if (!assigneeId || !teamId) return null;
  const atl = cfg?.teams?.source !== 'cockpit' && snap?.status === 'ok' ? snap.teams?.[teamId] : null;
  if (atl) return (atl.members || []).some((m) => m.accountId === assigneeId) ? 'member' : 'outside';
  if (cfg?.rules?.personLevel === false) return null;
  const p = capacity?.people?.[assigneeId];
  if (!p) return null;
  const list = Array.isArray(p.teams) && p.teams.length ? p.teams : p.teamId ? [{ teamId: p.teamId, pct: 100 }] : [];
  return list.some((x) => x.teamId === teamId && +x.pct > 0) ? 'member' : 'outside';
}

// Puts the snapshot into a dataset (before its privacy step, so pseudonyms cover the members too): ds.atlTeams for
// the model (shared/atlTeams.js), teams that have members but no work item yet, and the members' names.
export function withAtlassianTeams(ds, snap) {
  if (snap?.teams) for (const t of Object.values(snap.teams)) if (t && typeof t.name === 'string') t.name = decodeEntities(t.name);
  if (!snap || !snap.teams) return ds;
  ds.atlTeams = { at: snap.at, status: snap.status, teams: structuredClone(snap.teams), ...(snap.lastError ? { lastError: snap.lastError } : {}) };
  ds.people = ds.people || {};
  ds.teams = ds.teams || [];
  const known = new Set(ds.teams.map((t) => t.id));
  for (const [id, t] of Object.entries(snap.teams)) {
    if (snap.status === 'ok' && !known.has(id) && t.name && t.members?.length) ds.teams.push({ id, name: t.name });
    for (const m of t.members || []) if (m.accountId && !ds.people[m.accountId]) ds.people[m.accountId] = { id: m.accountId, name: m.name || '', avatar: null };
  }
  return ds;
}
export const storedAtlassianTeams = () => get(ATL_TEAMS_KEY).catch(() => null);

// The stored snapshot, refreshed when older than 5 minutes (or when forced). Never throws.
export async function freshAtlassianTeams(cfg, { force = false, graph, now = Date.now(), deadlineMs = 9000 } = {}) {
  const prev = await get(ATL_TEAMS_KEY).catch(() => null);
  if (!force && prev && now - (prev.at || 0) < TEAMS_STALE_MS && prev.field === (cfg?.fields?.team || '')) return prev;
  // one refresh at a time for the whole site (a refresh started in the last 60 s wins)
  const lock = await get(LOCK_KEY).catch(() => null);
  if (!force && lock && now - lock < 60000) return prev;
  await set(LOCK_KEY, now).catch(() => {});
  try {
    const extraIds = [...new Set([...Object.keys(prev?.teams || {}), ...(cfg?.teams?.show || [])])];
    const read = readAtlassianTeams(cfg, { extraIds, graph, now }).then((s) => ({ ...s, field: cfg?.fields?.team || '' }));
    const snap = await Promise.race([read, new Promise((r) => setTimeout(() => r(null), deadlineMs))]);
    if (!snap) return prev; // too slow this time – the next load tries again
    // a failed read never overwrites a good snapshot (it is kept and marked)
    if (snap.status === 'error' && prev?.status === 'ok') { const kept = { ...prev, lastError: now }; await set(ATL_TEAMS_KEY, kept).catch(() => {}); return kept; }
    await set(ATL_TEAMS_KEY, snap).catch(() => {});
    return snap;
  } catch (e) {
    logWarn('[teams:atlassian]', e);
    return prev;
  }
}
