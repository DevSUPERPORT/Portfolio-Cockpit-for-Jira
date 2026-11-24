// People split across teams (UC-14): capacity.people[id].teams = [{ teamId, pct }] – optional. Without it the
// person works 100 % in capacity.people[id].teamId (as before). teamId always stays the person's main team, so every
// place that only knows one team keeps working. Team capacity counts weekly hours × share; the person's own
// utilisation stays across all their teams.
export const MAX_TEAMS = 6;
const TEAM_RE = /^[A-Za-z0-9:_-]{1,64}$/;
const pctOf = (v) => Math.round(Number(v));

// Strict check of a stored/sent list: team ids valid and unique, shares whole numbers 1–100, at most 6 teams,
// together at most 100 %. Returns the clean list, or null when it breaks a rule.
export function validAllocation(teams) {
  if (!Array.isArray(teams) || !teams.length || teams.length > MAX_TEAMS) return null;
  const seen = new Set();
  const out = [];
  for (const x of teams) {
    const pct = pctOf(x?.pct);
    if (!x || typeof x.teamId !== 'string' || !TEAM_RE.test(x.teamId) || seen.has(x.teamId)) return null;
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) return null;
    seen.add(x.teamId);
    out.push({ teamId: x.teamId, pct });
  }
  return allocationSum(out) <= 100 ? out : null;
}
export const allocationSum = (teams) => (teams || []).reduce((a, x) => a + (+x.pct || 0), 0);

// The effective teams of a person: [{ teamId, pct }]. A broken list falls back to the main team at 100 %; a list
// above 100 % (never saved, but be safe) is scaled down so a person never counts more than once.
export function allocationOf(p) {
  if (Array.isArray(p?.teams) && p.teams.length) {
    const seen = new Set();
    const list = [];
    for (const x of p.teams) {
      const pct = pctOf(x?.pct);
      if (!x || typeof x.teamId !== 'string' || !x.teamId || seen.has(x.teamId) || !(pct > 0)) continue;
      seen.add(x.teamId);
      list.push({ teamId: x.teamId, pct: Math.min(100, pct) });
    }
    if (list.length) {
      const s = allocationSum(list);
      return s > 100 ? list.map((x) => ({ ...x, pct: (x.pct * 100) / s })) : list;
    }
  }
  return p?.teamId ? [{ teamId: p.teamId, pct: 100 }] : [];
}
// The person's share in a team, 0–1.
export const shareOf = (p, teamId) => (allocationOf(p).find((x) => x.teamId === teamId)?.pct || 0) / 100;
export const inTeam = (p, teamId) => teamId != null && shareOf(p, teamId) > 0;
export const teamsOf = (p) => allocationOf(p).map((x) => x.teamId);
// True when the person is split and the shares do not add up to 100 % (a gentle hint in the editor).
export const allocationOff = (p) => Array.isArray(p?.teams) && p.teams.length > 0 && Math.round(allocationSum(allocationOf(p))) !== 100;

// Store a list on a person: one team at 100 % is the plain old form (no `teams`); the main team (teamId) stays
// when it is still in the list, otherwise the largest share becomes the main team.
function store(p, list) {
  const out = { ...p };
  delete out.teams;
  if (!list.length) return out;
  if (list.length === 1 && list[0].pct === 100) return { ...out, teamId: list[0].teamId };
  const main = list.some((x) => x.teamId === p.teamId) ? p.teamId : [...list].sort((a, b) => b.pct - a.pct)[0].teamId;
  return { ...out, teamId: main, teams: list.map((x) => ({ teamId: x.teamId, pct: x.pct })) };
}
// Set a person's share in a team (0 removes the team; when one team is left it gets 100 % again). Shares are clamped
// so the sum never exceeds 100 %.
export function setShare(p, teamId, pct) {
  const cur = allocationOf(p).map((x) => ({ ...x, pct: Math.round(x.pct) }));
  const others = allocationSum(cur.filter((x) => x.teamId !== teamId));
  const v = Math.max(0, Math.min(100 - others, pctOf(pct) || 0));
  const i = cur.findIndex((x) => x.teamId === teamId);
  let list;
  if (v <= 0) { list = cur.filter((x) => x.teamId !== teamId); if (list.length === 1) list = [{ ...list[0], pct: 100 }]; }
  else if (i >= 0) list = cur.map((x) => (x.teamId === teamId ? { ...x, pct: v } : x));
  else list = [...cur, { teamId, pct: v }].slice(0, MAX_TEAMS);
  return store(p, list);
}
// Take a person into another team ("Person aus anderem Team aufnehmen") without removing them elsewhere: the free
// share if there is one, otherwise `want` % taken from their largest team. Returns { person, pct }.
export function joinTeam(p, teamId, want = 20) {
  const cur = allocationOf(p).map((x) => ({ ...x, pct: Math.round(x.pct) }));
  if (cur.some((x) => x.teamId === teamId)) return { person: p, pct: Math.round(shareOf(p, teamId) * 100) };
  if (cur.length >= MAX_TEAMS) return { person: p, pct: 0 };
  if (!cur.length) return { person: store({ ...p, teamId }, [{ teamId, pct: 100 }]), pct: 100 };
  const free = 100 - allocationSum(cur);
  if (free > 0) return { person: store(p, [...cur, { teamId, pct: free }]), pct: free };
  const big = [...cur].sort((a, b) => b.pct - a.pct)[0];
  const take = Math.min(want, big.pct - 1);
  if (take <= 0) return { person: p, pct: 0 };
  const list = cur.map((x) => (x.teamId === big.teamId ? { ...x, pct: x.pct - take } : x)).concat([{ teamId, pct: take }]);
  return { person: store(p, list), pct: take };
}
// Change the main team (the team select): the main share moves to the new team; a share the person already had
// there is added to it.
export function moveMainTeam(p, teamId) {
  const cur = allocationOf(p).map((x) => ({ ...x, pct: Math.round(x.pct) }));
  if (!cur.length) return { ...p, teamId };
  const mainId = cur.some((x) => x.teamId === p.teamId) ? p.teamId : cur[0].teamId;
  if (mainId === teamId) return p;
  const there = cur.find((x) => x.teamId === teamId)?.pct || 0;
  const list = cur.filter((x) => x.teamId !== teamId).map((x) => (x.teamId === mainId ? { teamId, pct: Math.min(100, x.pct + there) } : x));
  return store({ ...p, teamId }, list);
}
