import { jira } from './jira.js';
import { rightsFor } from '../../shared/roles.js';

export class AccessError extends Error { constructor(msg = 'NO_ACCESS') { super(msg); this.code = 'NO_ACCESS'; } }

// Roles are always derived on the server from the trusted invocation context (never from the payload).
export async function resolveRoles(accountId, cfg) {
  if (!accountId) throw new AccessError('ANONYMOUS');
  const [perm, groups] = await Promise.all([
    jira('user', '/rest/api/3/mypermissions', { query: { permissions: 'ADMINISTER' } }),
    jira('app', '/rest/api/3/user/groups', { query: { accountId } }).catch(() => []),
  ]);
  const groupIds = new Set((groups || []).map((g) => g.groupId).filter(Boolean));
  return rolesOf({ admin: !!perm?.permissions?.ADMINISTER?.havePermission, groupIds: [...groupIds], cfg });
}

// The role matrix (shared/roles.js) plus the legacy flags every existing check uses.
export function rolesOf({ admin, groupIds, cfg }) {
  const r = rightsFor({ groupIds, admin, roles: cfg.roles, personLevel: cfg.rules?.personLevel !== false });
  const has = (x) => r.rights.includes(x);
  const gs = new Set(groupIds);
  return {
    admin,
    rights: r.rights, roleNames: r.roleNames, logs: r.logs,
    viewReport: has('report'), manageRanking: has('a_rank'), editCapacity: has('a_cap'), editHealth: has('a_health'),
    editPlan: has('a_plan'), dispatch: has('a_disp'),
    // delegated portfolio settings (no Jira admin needed) – unchanged, still a group list
    manageSettings: (cfg.permissions?.manageSettings || []).some((g) => gs.has(g.id)),
  };
}

export function requireRole(roles, key) {
  if (!roles?.[key]) throw new AccessError(`NO_ACCESS:${key}`);
}

// Can the calling user edit this issue in Jira? (used before the app writes app-owned fields on their behalf)
export async function canEditIssue(issueId) {
  try {
    const r = await jira('user', '/rest/api/3/mypermissions', { query: { issueId, permissions: 'EDIT_ISSUES,BROWSE_PROJECTS' } });
    return !!(r?.permissions?.EDIT_ISSUES?.havePermission && r?.permissions?.BROWSE_PROJECTS?.havePermission);
  } catch { return false; }
}
