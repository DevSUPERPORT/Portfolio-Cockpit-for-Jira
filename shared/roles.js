// Roles and rights (UC-08). One place that says who sees which tab and may do what.
//
//   Mitarbeiter (employee)  – every Jira user; always "Meine Arbeit"
//   Projekt-Admin           – Jira groups the admin maps to it
//   Management              – Jira groups the admin maps to it
//   Jira-Admin              – follows from the Jira permission "Administer Jira": every right except the
//                             individual values of people, which are granted deliberately (privacy)
//
// Anyone in several groups gets the union of all their roles. Pure module: used by the server (perms.js),
// the configuration page and the mock.

export const ROLE_IDS = ['employee', 'projectAdmin', 'management'];
export const MAPPED_ROLES = ['projectAdmin', 'management'];

// Tabs a role can be given ("mine" is always on).
export const TAB_RIGHTS = ['mine', 'portfolio', 'projects', 'teams', 'plan', 'hours', 'support', 'report'];
// Actions.
export const ACTION_RIGHTS = ['a_rank', 'a_cap', 'a_plan', 'a_disp', 'a_health'];
// Individual values of people (bookings, plan vs. actual and utilisation per person).
export const PRIVACY_RIGHTS = ['a_logs_team', 'a_logs_all'];
export const ALL_RIGHTS = [...TAB_RIGHTS, ...ACTION_RIGHTS, ...PRIVACY_RIGHTS];

export const DEFAULT_RIGHTS = Object.freeze({
  employee: ['mine'],
  projectAdmin: ['mine', 'portfolio', 'projects', 'teams', 'plan', 'hours', 'support', 'a_cap', 'a_plan', 'a_disp', 'a_health', 'a_logs_team'],
  management: ['mine', 'portfolio', 'projects', 'teams', 'plan', 'hours', 'support', 'report', 'a_rank', 'a_cap', 'a_plan', 'a_disp', 'a_health', 'a_logs_all'],
});
export const DEFAULT_ROLES = Object.freeze({
  groups: { projectAdmin: [], management: [] },
  rights: DEFAULT_RIGHTS,
  // Jira admins see people's individual values only when this is switched on (UC-08: granted deliberately).
  adminPersonValues: false,
});

const GROUP_ID = /^[A-Za-z0-9-]{1,64}$/;
const cleanGroups = (list) => (Array.isArray(list) ? list : []).slice(0, 50)
  .map((g) => ({ id: typeof g?.id === 'string' ? g.id.trim().slice(0, 64) : '', name: typeof g?.name === 'string' ? g.name.trim().slice(0, 255) : '' }))
  .filter((g, i, a) => GROUP_ID.test(g.id) && a.findIndex((x) => x.id === g.id) === i);

// Rights are normalised: unknown ids dropped, "mine" always present, at most one privacy level kept (the wider one).
export function cleanRights(list) {
  const set = new Set((Array.isArray(list) ? list : []).filter((r) => ALL_RIGHTS.includes(r)));
  set.add('mine');
  if (set.has('a_logs_all')) set.delete('a_logs_team');
  return ALL_RIGHTS.filter((r) => set.has(r));
}

export function validRoles(input, prev) {
  const x = input && typeof input === 'object' ? input : prev || DEFAULT_ROLES;
  const rights = {};
  for (const r of ROLE_IDS) rights[r] = cleanRights(x.rights?.[r] ?? DEFAULT_RIGHTS[r]);
  // Employees never see other people's individual values, whatever is sent.
  rights.employee = rights.employee.filter((r) => !PRIVACY_RIGHTS.includes(r));
  return {
    groups: { projectAdmin: cleanGroups(x.groups?.projectAdmin), management: cleanGroups(x.groups?.management) },
    rights,
    adminPersonValues: x.adminPersonValues === true,
  };
}

// v2 -> v3: the old per-action group lists become the two roles, without anyone losing what they had.
//   management   = groups that could see the report or change the ranking
//   projectAdmin = groups that could edit capacity or health (and are not management already)
// Privacy: with person-level values on, both roles keep seeing everyone (nobody is "responsible" for a
// team yet, so the stricter "own teams" default would hide everything) and Jira admins keep their view.
export function migrateRoles(cfg) {
  const p = cfg.permissions || {};
  const ids = (k) => cleanGroups(p[k]);
  const union = (...ls) => cleanGroups(ls.flat());
  const management = union(ids('viewReport'), ids('manageRanking'));
  const mgmtIds = new Set(management.map((g) => g.id));
  const projectAdmin = union(ids('editCapacity'), ids('editHealth')).filter((g) => !mgmtIds.has(g.id));
  const people = cfg.rules?.personLevel !== false;
  const withPrivacy = (list) => cleanRights([...list.filter((r) => !PRIVACY_RIGHTS.includes(r)), ...(people ? ['a_logs_all'] : [])]);
  return {
    groups: { projectAdmin, management },
    rights: {
      employee: ['mine'],
      projectAdmin: withPrivacy(DEFAULT_RIGHTS.projectAdmin),
      management: withPrivacy(DEFAULT_RIGHTS.management),
    },
    adminPersonValues: people,
  };
}

// What one user may do. owner = owns at least one portfolio project (keeps the project-admin view of the
// cockpit even without a group, as before).
export function rightsFor({ groupIds = [], admin = false, roles, personLevel = true, owner = false }) {
  const r = validRoles(roles);
  const gs = new Set(groupIds);
  const mine = MAPPED_ROLES.filter((role) => r.groups[role].some((g) => gs.has(g.id)));
  const set = new Set(r.rights.employee);
  for (const role of mine) for (const x of r.rights[role]) set.add(x);
  if (owner && !mine.length) for (const x of r.rights.projectAdmin) if (TAB_RIGHTS.includes(x)) set.add(x);
  if (admin) {
    for (const x of [...TAB_RIGHTS, ...ACTION_RIGHTS]) set.add(x);
    if (r.adminPersonValues) set.add('a_logs_all');
  }
  if (!personLevel) for (const x of PRIVACY_RIGHTS) set.delete(x);
  const logs = set.has('a_logs_all') ? 'all' : set.has('a_logs_team') ? 'team' : 'none';
  return { rights: ALL_RIGHTS.filter((x) => set.has(x)), roleNames: [...(admin ? ['jiraAdmin'] : []), ...mine], logs };
}

// Which people's individual values a user may see. logs 'team' = members of the teams the user is
// "responsible" for (Teams › Kapazitäten pflegen). The user always sees themself.
export function visiblePeople({ logs, accountId, capacity }) {
  if (logs === 'all') return null; // everyone
  const keep = new Set(accountId ? [accountId] : []);
  if (logs === 'team') {
    const teams = new Set(Object.entries(capacity?.teams || {}).filter(([, t]) => (t?.responsible || []).includes(accountId)).map(([id]) => id));
    // everyone with a share in one of those teams (people can work in several teams)
    for (const [id, p] of Object.entries(capacity?.people || {})) if (teams.has(p?.teamId) || (p?.teams || []).some((x) => teams.has(x?.teamId))) keep.add(id);
  }
  return keep;
}
export function responsibleTeams({ accountId, capacity }) {
  return Object.entries(capacity?.teams || {}).filter(([, t]) => (t?.responsible || []).includes(accountId)).map(([id]) => id);
}

export const ROLE_LABEL = { employee: ['Mitarbeiter', 'Employee'], projectAdmin: ['Projekt-Admin', 'Project admin'], management: ['Management', 'Management'], jiraAdmin: ['Jira-Admin', 'Jira admin'] };
export const RIGHT_LABEL = {
  mine: ['Meine Arbeit', 'My work'], portfolio: ['Portfolio', 'Portfolio'], projects: ['Projekte', 'Projects'], teams: ['Teams', 'Teams'],
  plan: ['Wochenplanung', 'Weekly planning'], hours: ['Plan vs. Ist', 'Plan vs. actual'], support: ['Support', 'Support'], report: ['C-Level-Report', 'C-level report'],
  a_rank: ['Portfolio-Rang ändern', 'Change portfolio rank'], a_cap: ['Kapazitäten pflegen', 'Maintain capacities'], a_plan: ['Wochenplanung ändern', 'Change weekly planning'],
  a_disp: ['Support-Tickets verteilen', 'Dispatch support tickets'], a_health: ['Health aktualisieren', 'Update health'],
  a_logs_team: ['Einzelwerte: eigene Teams', 'Individual values: own teams'], a_logs_all: ['Einzelwerte: alle Teams', 'Individual values: all teams'],
};
