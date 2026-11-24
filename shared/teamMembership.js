// Is the assignee of a work item part of the work item's team? (boss feedback 2026-11-17: "If an assignee is not part of
// the team, they must be specifically highlighted in the Teams tab; in the issue view a note should appear next to the
// assignee." – and: "Teams and team members must be the same as in Atlassian Teams.")
//
// Membership:
// • Atlassian Teams (default, when the cockpit can read them – see shared/atlTeams.js): a person is in a team when they
//   are a member of that Atlassian team. Teams the snapshot does not contain fall back to the next rule.
// • Otherwise the capacity maintained in the cockpit (Teams › Kapazitäten pflegen): a share > 0 in that team. People
//   without maintained capacity then have no membership at all – "not maintained", reported separately.
//
//   memberStatus(model, personId, teamId) → 'member' | 'outside' | 'unmaintained'
//   teamOutsiders(model, teamId)          → [{ id, name, status, teams: [{ teamId, pct }], tasks: [{ id, key, summary, re }] }]
//   issueTeamCheck(model, issue)          → { status, teamId, assigneeId, teams, source } | null (no team or no assignee)
//   capacityDrift(model, teamId)          → maintained capacity vs. Atlassian members: { missing, extra, members, at } | null
import { capacityPeople } from './engine.js';
import { allocationOf, shareOf } from './allocation.js';
import { atlIndex } from './atlTeams.js';

const isOpen = (i) => (i?.status?.cat ?? i?.statusCat ?? 'new') !== 'done';
export const membershipSource = (model, teamId) => (atlIndex(model.ds)?.judged(teamId) ? 'atlassian' : 'cockpit');

export function memberStatus(model, personId, teamId, people = capacityPeople(model)) {
  const atl = atlIndex(model.ds);
  if (atl?.judged(teamId)) return atl.isMember(personId, teamId) ? 'member' : 'outside';
  const p = people.get(personId);
  if (!p || p.derived) return 'unmaintained';
  return shareOf(p, teamId) > 0 ? 'member' : 'outside';
}
// The teams a person belongs to (their Atlassian teams when known, else the maintained capacity), with the capacity share
function teamsOf(model, pid, people) {
  const p = people.get(pid);
  const alloc = p && (!p.derived || p.fromAtlassian) ? allocationOf(p) : [];
  const atl = atlIndex(model.ds);
  const ids = atl ? atl.byPerson.get(pid) || [] : alloc.map((x) => x.teamId);
  return ids.map((teamId) => ({ teamId, pct: Math.round(+alloc.find((x) => x.teamId === teamId)?.pct || 0) }));
}

export function issueTeamCheck(model, issue, people = capacityPeople(model)) {
  const teamId = issue?.team?.id || null;
  const assigneeId = issue?.assignee?.id || null;
  if (!teamId || !assigneeId || issue?.assignee?.anon) return null;
  return { status: memberStatus(model, assigneeId, teamId, people), teamId, assigneeId, teams: teamsOf(model, assigneeId, people), source: membershipSource(model, teamId) };
}

// the people working on a team's open stories without being part of that team, with those stories
export function teamOutsiders(model, teamId) {
  if (!teamId) return [];
  const people = capacityPeople(model);
  const by = new Map();
  for (const s of model.ds.issues || []) {
    if (s.role !== 'estimate' || !isOpen(s) || s.team?.id !== teamId || !s.assignee?.id || s.assignee.anon) continue;
    const st = memberStatus(model, s.assignee.id, teamId, people);
    if (st === 'member') continue;
    const e = by.get(s.assignee.id) || by.set(s.assignee.id, { id: s.assignee.id, name: model.ds.people?.[s.assignee.id]?.name || s.assignee.name || '', status: st, teams: teamsOf(model, s.assignee.id, people), tasks: [] }).get(s.assignee.id);
    e.tasks.push({ id: s.id, key: s.key, summary: s.summary || '', re: s.re || 0 });
  }
  return [...by.values()].map((e) => ({ ...e, tasks: e.tasks.sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true })) }))
    .sort((a, b) => b.tasks.length - a.tasks.length || a.name.localeCompare(b.name, 'de'));
}

// Where the capacity maintained in the cockpit disagrees with the Atlassian team:
// missing = Atlassian members whose maintained capacity has no share in this team (they count 0 h here),
// extra   = people with a maintained share in this team who are not members of the Atlassian team.
export function capacityDrift(model, teamId) {
  const atl = atlIndex(model.ds);
  if (!teamId || !atl?.judged(teamId)) return null;
  const people = capacityPeople(model);
  const name = (pid) => model.ds.people?.[pid]?.name || atl.names.get(pid) || '';
  const missing = [], extra = [];
  for (const pid of atl.byTeam.get(teamId)) {
    const p = people.get(pid);
    if (p && !p.derived && !(shareOf(p, teamId) > 0)) missing.push({ id: pid, name: name(pid) });
  }
  for (const p of people.values()) {
    if (p.derived || !(shareOf(p, teamId) > 0) || atl.isMember(p.id, teamId)) continue;
    extra.push({ id: p.id, name: name(p.id), pct: Math.round(shareOf(p, teamId) * 100) });
  }
  const by = (a, b) => a.name.localeCompare(b.name, 'de');
  return { missing: missing.sort(by), extra: extra.sort(by), members: atl.byTeam.get(teamId).size, at: atl.at };
}
