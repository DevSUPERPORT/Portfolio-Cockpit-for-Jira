// Atlassian Teams in the model (see src/lib/atlTeams.js for how the snapshot is read).
//
// ds.atlTeams = { at, status, teams: { [teamId]: { name, members: [accountId] } } }
// cfg.teams   = { source: 'atlassian' | 'cockpit', show: null | [teamId] }
//
// • teamScope(cfg)      → which teams the cockpit shows (null = all)
// • atlIndex(ds)        → membership from Atlassian, or null when it is not in use (switched off, not readable, no
//                         snapshot yet). Only teams contained in the snapshot are judged; any other team falls back to
//                         the cockpit's own capacity maintenance.
// • evenSplit(teamIds)  → whole-number shares adding up to 100 (a person in 3 teams: 34 / 33 / 33)
const cache = new WeakMap();

export function teamScope(cfg) {
  const show = cfg?.teams?.show;
  return Array.isArray(show) && show.length ? new Set(show) : null;
}
export const atlSource = (cfg) => (cfg?.teams?.source === 'cockpit' ? 'cockpit' : 'atlassian');

export function atlIndex(ds) {
  const snap = ds?.atlTeams;
  if (!snap || typeof snap !== 'object' || atlSource(ds.config) !== 'atlassian' || snap.status !== 'ok' || !snap.teams || typeof snap.teams !== 'object') return null;
  // cached per snapshot object and team scope (the snapshot is replaced, never changed, when it is refreshed)
  const scopeKey = JSON.stringify(ds.config?.teams?.show || null);
  const hit = cache.get(snap);
  if (hit && hit.scopeKey === scopeKey) return hit.out;
  let out = null;
  {
    const scope = teamScope(ds.config);
    const byTeam = new Map(), byPerson = new Map(), names = new Map();
    for (const [tid, t] of Object.entries(snap.teams)) {
      const ids = (t?.members || []).map((m) => (typeof m === 'string' ? m : m?.accountId)).filter(Boolean);
      for (const m of t?.members || []) if (m && typeof m === 'object' && m.accountId && m.name) names.set(m.accountId, m.name);
      byTeam.set(tid, new Set(ids));
      if (scope && !scope.has(tid)) continue; // hidden teams never get a share of anyone's hours
      for (const pid of ids) (byPerson.get(pid) || byPerson.set(pid, []).get(pid)).push(tid);
    }
    out = { at: snap.at || null, byTeam, byPerson, names, judged: (tid) => byTeam.has(tid), isMember: (pid, tid) => !!byTeam.get(tid)?.has(pid) };
  }
  cache.set(snap, { scopeKey, out });
  return out;
}

export function evenSplit(teamIds, main = null) {
  const ids = [...new Set(teamIds)].slice(0, 6);
  if (main && ids.includes(main)) ids.splice(ids.indexOf(main), 1), ids.unshift(main);
  const base = Math.floor(100 / ids.length);
  let rest = 100 - base * ids.length;
  return ids.map((teamId) => ({ teamId, pct: base + (rest-- > 0 ? 1 : 0) }));
}
