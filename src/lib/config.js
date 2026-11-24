import { DEFAULT_MATRIX, DEFAULT_TSHIRTS, USAGES } from '../../shared/engine.js';
import { validQuarterRange } from '../../shared/quarterRange.js';
import { LOCATIONS } from '../../shared/holidays.js';
import { jira } from './jira.js';
import { DEFAULT_ROLES, validRoles, migrateRoles } from '../../shared/roles.js';
import { DEFAULT_NOTICES, validNotices } from '../../shared/notices.js';
import { SNAPSHOT_DEFAULTS, validSnapshot } from '../../shared/planActual.js';
import { validSupportDispatch } from '../../shared/dispatch.js';
import { validLocations } from '../../shared/locations.js';
import { K, get, set } from './store.js';

export const PERMISSION_KEYS = ['viewReport', 'manageRanking', 'editCapacity', 'editHealth', 'manageSettings'];
const LEVEL_ROLES = ['rough', 'structure', 'estimate', 'tiny'];
const MODES = ['required', 'optional', 'ignored'];

export const CONFIG_VERSION = 3;
// ask/healthDraft/reportSummary: answers and drafts; the rest: the KI-Assistent (src/lib/aiAssist.js) on the screens.
export const AI_FEATURES = ['ask', 'healthDraft', 'reportSummary', 'planning', 'gaps', 'dispatch', 'planActual', 'teamBrief', 'projectBrief', 'myWeek', 'intent', 'similarSummary', 'playbookDraft', 'lotse'];
export const DEFAULT_AI = Object.freeze({ enabled: false, features: Object.freeze({ ask: true, healthDraft: true, reportSummary: true, planning: true, gaps: true, dispatch: true, planActual: true, teamBrief: true, projectBrief: true, myWeek: true, intent: true, similarSummary: true, playbookDraft: true, lotse: true }), shareNames: false, shareTexts: false, access: 'self', budgetEur: null, dailyLimit: null, changedAt: null, changedBy: null });
// Is this AI feature allowed by the configuration? The single gate every AI path goes through (server side).
export const aiAllowed = (cfg, feature) => cfg?.ai?.enabled === true && AI_FEATURES.includes(feature) && cfg.ai.features?.[feature] !== false;
export function validAi(input, prev) {
  const x = input && typeof input === 'object' ? input : prev || DEFAULT_AI;
  const f = x.features && typeof x.features === 'object' ? x.features : {};
  return {
    enabled: x.enabled === true,
    features: Object.fromEntries(AI_FEATURES.map((k) => [k, f[k] !== false])),
    shareNames: x.shareNames === true,
    shareTexts: x.shareTexts === true,
    // who uses AI: 'self' = each person switches it on for themselves (default, off until they do); 'all' = everyone
    access: x.access === 'all' ? 'all' : 'self',
    // the site admin may LOWER SUPERPORT's monthly budget (EUR) and the requests per person and day – null = SUPERPORT's value
    budgetEur: typeof x.budgetEur === 'number' && Number.isFinite(x.budgetEur) && x.budgetEur >= 0 && x.budgetEur <= 1e6 ? Math.round(x.budgetEur * 100) / 100 : null,
    dailyLimit: Number.isInteger(x.dailyLimit) && x.dailyLimit >= 1 && x.dailyLimit <= 500 ? x.dailyLimit : null,
    // who switched it last – set by the server, never taken from the request
    changedAt: prev?.changedAt ?? null, changedBy: prev?.changedBy ?? null,
  };
}
export const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  setupComplete: false,
  // group: the level above the projects (e.g. Themes L4 over Project L3) – shown as themes, on by default (boss 2026-11-18)
  portfolio: { source: 'space', issueTypeIds: [], autoRemoveDone: false, group: { active: true, name: '', issueTypeIds: [] } },
  levelsOff: [],
  levels: [],
  // owner: '' = Jira Assignee; milestone: '' = fix versions mapped to milestones. Otherwise a custom field id.
  fields: { team: '', startDate: '', tshirt: 'app', targetQuarters: 'app', note: '', owner: '', milestone: '' },
  matrix: DEFAULT_MATRIX,
  // blockedStatusIds: [] = every status named "Blocked" (or "Blockiert") counts as blocked.
  dependencies: { linkTypeIds: [], reversedLinkTypeIds: [], blockedStatusIds: [] },
  // Booking check (Time Spent vs. Estimate): minimum booked share of the possible working time.
  booking: { enabled: true, minPct: 90, escalatePct: 20, graceDays: 2, escalateTo: 'lead', schedule: 'week' },
  report: { publishSpaces: [] },
  tshirtSizes: DEFAULT_TSHIRTS,
  // the quarters the app field "Ziel-Quartale" offers on a work item: from `back` quarters ago to `ahead` quarters ahead
  quarterRange: { back: 1, ahead: 10, off: [], extra: [] },
  rules: { dueDateWarning: true, distribution: 'capacity', personLevel: true, lockSubtasks: false, healthRhythmDays: 7, forecastThresholdPct: 10, deviationThresholdPct: 15 },
  permissions: { viewReport: [], manageRanking: [], editCapacity: [], editHealth: [], manageSettings: [] },
  // Roles and rights (UC-08): groups -> Projekt-Admin / Management, a matrix of tabs, actions and privacy.
  // `permissions` above is kept as a mirror for one release (rollback safety) and for manageSettings.
  roles: DEFAULT_ROLES,
  // Reminders and booking notices: built and previewed, but nothing is sent until an admin switches it on.
  notices: DEFAULT_NOTICES,
  // Plan vs. Ist: when the weekly plan is stored and for how long.
  snapshot: SNAPSHOT_DEFAULTS,
  // Named locations: holiday calendar, working days, deselected public holidays, company days off (UC-09).
  locations: [],
  // queues: support work in any space (no Jira Service Management needed); sla: calendar + targets per priority.
  support: { serviceProjectIds: [], queues: [], averagingWeeks: 4, slaTargetPct: 95, escalationLinkTypeId: '', sla: { mode: 'business', start: 8, end: 17, location: 'DE', atRiskShare: 0.75, fallbackHours: 72, policies: [{ priority: 'Highest', hours: 8 }, { priority: 'High', hours: 24 }, { priority: 'Medium', hours: 72 }, { priority: 'Low', hours: 120 }, { priority: 'Lowest', hours: 200 }] } },
  capacityDefaults: { defaultWeeklyHours: 40, defaultLocation: 'DE' },
  // Teams: membership from Atlassian Teams (falls back to the cockpit's own capacity maintenance where Atlassian Teams
  // cannot be read); show: null = every team, otherwise only these team ids appear in the cockpit.
  teams: { source: 'atlassian', show: null },
  // AI (Forge LLM): OFF by default – also for installs that existed before this setting. While off, the app makes no
  // LLM call at all (not even to list models). Only a Jira admin can switch it on; data minimisation is on by default.
  ai: DEFAULT_AI,
};

// Stored configurations are upgraded step by step on read; saving writes the current version.
export const MIGRATIONS = {
  // v1 -> v2: capacity defaults and support settings became explicit; matrix rows keyed by level.
  1: (c) => ({
    ...c,
    capacityDefaults: { ...DEFAULT_CONFIG.capacityDefaults, ...(c.capacityDefaults || {}) },
    support: { ...DEFAULT_CONFIG.support, ...(c.support || {}) },
    matrix: c.matrix || DEFAULT_CONFIG.matrix,
    version: 2,
  }),
  // v2 -> v3: per-action group lists become roles with a rights matrix; nobody loses access (see shared/roles.js).
  2: (c) => ({ ...c, roles: c.roles || migrateRoles(c), version: 3 }),
};
export function migrateConfig(stored) {
  let c = { ...stored };
  let v = Number.isInteger(c.version) ? c.version : 1;
  if (v > CONFIG_VERSION) throw Object.assign(new Error('CONFIG_FROM_NEWER_VERSION'), { code: 'CONFIG_FROM_NEWER_VERSION' });
  while (v < CONFIG_VERSION) { c = MIGRATIONS[v](c); v = c.version; }
  return { ...structuredClone(DEFAULT_CONFIG), ...c, rules: { ...DEFAULT_CONFIG.rules, ...(c.rules || {}) }, booking: { ...DEFAULT_CONFIG.booking, ...(c.booking || {}) }, ai: validAi(c.ai, c.ai || DEFAULT_AI), roles: validRoles(c.roles, DEFAULT_ROLES), notices: validNotices(c.notices), snapshot: validSnapshot(c.snapshot), locations: validLocations(c.locations) };
}
// Support queues are built from ids and labels only (the server composes the JQL), so admins can define
// support work in any space without writing JQL and nothing can be injected.
const LABEL_RE = /^[\p{L}\p{N}_.:-]{1,64}$/u;
export function validQueues(list) {
  return (Array.isArray(list) ? list : []).slice(0, 12).map((q, i) => ({
    id: /^[a-z0-9]{1,12}$/.test(q?.id || '') ? q.id : `q${i + 1}`,
    name: String(q?.name ?? '').trim().slice(0, 60) || `Queue ${i + 1}`,
    projectIds: ids(q?.projectIds, 20), issueTypeIds: ids(q?.issueTypeIds, 20),
    labels: (Array.isArray(q?.labels) ? q.labels : []).map((l) => String(l).trim()).filter((l) => LABEL_RE.test(l)).slice(0, 10),
  })).filter((q) => q.projectIds.length);
}
export function validSla(input, prev) {
  const d = DEFAULT_CONFIG.support.sla;
  const x = input && typeof input === 'object' ? input : prev || d;
  const start = num(x.start, 0, 23, d.start);
  return {
    mode: x.mode === '24x7' ? '24x7' : 'business', start, end: num(x.end, start + 1, 24, Math.max(d.end, start + 1)),
    location: Object.hasOwn(LOCATIONS, x.location) || x.location === 'NONE' ? x.location : d.location,
    atRiskShare: num(x.atRiskShare, 0.3, 0.99, d.atRiskShare), fallbackHours: num(x.fallbackHours, 1, 2000, d.fallbackHours),
    policies: (Array.isArray(x.policies) ? x.policies : d.policies).slice(0, 15)
      .map((p) => ({ priority: String(p?.priority ?? '').trim().slice(0, 40), hours: num(p?.hours, 0.5, 5000, 24) })).filter((p) => p.priority),
  };
}
export const supportJql = (cfg) => {
  const sup = cfg.support || {};
  const parts = [];
  if (sup.serviceProjectIds?.length) parts.push(`project in (${sup.serviceProjectIds.join(',')})`);
  for (const q of sup.queues || []) {
    let c = `project in (${q.projectIds.join(',')})`;
    if (q.issueTypeIds.length) c += ` AND issuetype in (${q.issueTypeIds.join(',')})`;
    if (q.labels.length) c += ` AND labels in (${q.labels.map((l) => `"${l}"`).join(',')})`;
    parts.push(`(${c})`);
  }
  return parts.length ? `(${parts.join(' OR ')})` : null;
};
// Which configured service/queue a ticket belongs to. The built-in queue "spaces" (software / business spaces chosen as
// support) is no queue for the person: each of its spaces is a service of its own, named like the project.
export const SPACES_QUEUE = 'spaces';
export const ticketServices = (cfg, t) => [
  ...(cfg.support?.serviceProjectIds || []).filter((id) => id === t.projectId),
  ...(cfg.support?.queues || []).filter((q) => q.id === SPACES_QUEUE && q.projectIds.includes(t.projectId)).map(() => t.projectId),
  ...(cfg.support?.queues || []).filter((q) => q.id !== SPACES_QUEUE).filter((q) => q.projectIds.includes(t.projectId) && (!q.issueTypeIds.length || q.issueTypeIds.includes(t.typeId)) && (!q.labels.length || q.labels.some((l) => (t.labels || []).includes(l)))).map((q) => `q:${q.id}`),
];

export const sizeKey = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const SIZE_KEY_RE = /^[\p{L}\p{N}+ .,()\/-]{1,40}$/u;

// What the "Portfolio settings" role may change without being a Jira admin. Everything that touches
// permissions, hierarchy, fields, privacy (person level) or data enforcement (sub-task lock) stays admin-only.
export const DELEGATED_RULES = ['dueDateWarning', 'distribution', 'healthRhythmDays', 'forecastThresholdPct', 'deviationThresholdPct'];
export function applySettings(cfg, input = {}) {
  const rules = { ...cfg.rules };
  for (const k of DELEGATED_RULES) if (input.rules && Object.hasOwn(input.rules, k)) rules[k] = input.rules[k];
  return validateConfig({
    ...cfg,
    tshirtSizes: Array.isArray(input.tshirtSizes) ? input.tshirtSizes : cfg.tshirtSizes,
    rules,
    capacityDefaults: input.capacityDefaults && typeof input.capacityDefaults === 'object' ? { ...cfg.capacityDefaults, ...input.capacityDefaults } : cfg.capacityDefaults,
    support: input.supportSla && typeof input.supportSla === 'object' ? { ...cfg.support, sla: input.supportSla, ...(input.slaTargetPct != null ? { slaTargetPct: input.slaTargetPct } : {}) } : cfg.support,
  }, cfg);
}

export async function loadConfig() {
  const c = await get(K.config);
  if (!c) return structuredClone(DEFAULT_CONFIG);
  return migrateConfig(c);
}
export const saveConfig = (c) => set(K.config, c);

// What every user may see: no group lists.
export function publicConfig(c) {
  const { permissions, roles, ...rest } = c;
  return { ...rest, roles: roles ? { rights: roles.rights } : undefined };
}

// Legacy mirror of the role matrix in the old per-action shape, so an older release still reads sensible values.
export function legacyPermissions(roles, prev = {}) {
  const groupsWith = (right) => ['projectAdmin', 'management'].filter((r) => roles.rights[r].includes(right)).flatMap((r) => roles.groups[r]);
  const uniq = (l) => l.filter((g, i) => l.findIndex((x) => x.id === g.id) === i);
  return { viewReport: uniq(groupsWith('report')), manageRanking: uniq(groupsWith('a_rank')), editCapacity: uniq(groupsWith('a_cap')), editHealth: uniq(groupsWith('a_health')), manageSettings: prev.manageSettings || [] };
}

// ---------- validation (admin writes) ----------
const isId = (v) => typeof v === 'string' && /^\d{1,18}$/.test(v);
const ids = (v, max = 50) => (Array.isArray(v) ? [...new Set(v.map(String).filter(isId))].slice(0, max) : []);
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const FIELD_RE = /^(customfield_\d{1,8}|app|)$/;

export class ValidationError extends Error { constructor(msg) { super(msg); this.code = 'INVALID'; } }

// Team ids of Atlassian Teams are UUIDs; the dev mock and older data use short ids – both are accepted.
const TEAM_ID_RE = /^[A-Za-z0-9:_-]{1,64}$/;
export function validTeamsCfg(t) {
  const show = Array.isArray(t?.show) ? [...new Set(t.show.filter((x) => typeof x === 'string' && TEAM_ID_RE.test(x) && !['__proto__', 'constructor', 'prototype'].includes(x)))].slice(0, 200) : null;
  return { source: t?.source === 'cockpit' ? 'cockpit' : 'atlassian', show: show && show.length ? show : null };
}

export function validateConfig(input, prev = DEFAULT_CONFIG) {
  if (!input || typeof input !== 'object') throw new ValidationError('config must be an object');
  const p = input.portfolio || {};
  const portfolio = {
    source: p.source === 'issue' ? 'issue' : 'space',
    issueTypeIds: ids(p.issueTypeIds, 10),
    autoRemoveDone: bool(p.autoRemoveDone, false),
    // the theme level above the projects (only when projects are work items); empty types = whatever the parent is
    group: { active: p.source === 'issue' && bool(p.group?.active, true), name: str(p.group?.name, 60), issueTypeIds: p.source === 'issue' ? ids(p.group?.issueTypeIds, 20) : [] },
  };
  if (portfolio.source === 'issue' && !portfolio.issueTypeIds.length) throw new ValidationError('Portfolio issue type required');
  const level = (l, i, pre) => ({
    key: typeof l?.key === 'string' && /^[a-z0-9_-]{1,20}$/.test(l.key) && !['__proto__', 'constructor', 'prototype', 'portfolio'].includes(l.key) ? l.key : `${pre}${i + 1}`,
    name: str(l?.name, 60) || `Level ${i + 1}`,
    role: LEVEL_ROLES.includes(l?.role) ? l.role : 'structure',
    issueTypeIds: ids(l?.issueTypeIds, 20),
    ...(Number.isInteger(l?.hierarchy) && l.hierarchy >= -1 && l.hierarchy <= 10 ? { hierarchy: l.hierarchy } : {}),
  });
  const levels = (Array.isArray(input.levels) ? input.levels : []).slice(0, 8).map((l, i) => level(l, i, 'l'));
  // switched-off levels (boss 2026-11-18: "show all levels, activate or deactivate them"): kept with their settings,
  // not part of the cockpit – their work items are passed through (their children still belong to the project)
  const levelsOff = (Array.isArray(input.levelsOff) ? input.levelsOff : input.levels === undefined ? prev.levelsOff || [] : []).slice(0, 8).map((l, i) => level(l, i, 'x'));
  const count = (r) => levels.filter((l) => l.role === r).length;
  if (count('estimate') !== 1) throw new ValidationError('Exactly one level must hold estimates and time tracking');
  if (count('rough') > 1) throw new ValidationError('Rough planning may only be assigned once');
  if (new Set([...levels, ...levelsOff].map((l) => l.key)).size !== levels.length + levelsOff.length) throw new ValidationError('Level keys must be unique');
  const usedTypes = [...levels, ...levelsOff].flatMap((l) => l.issueTypeIds).concat(portfolio.source === 'issue' ? [...portfolio.issueTypeIds, ...portfolio.group.issueTypeIds] : []);
  if (new Set(usedTypes).size !== usedTypes.length) throw new ValidationError('An issue type can only belong to one level');

  const f = input.fields || {};
  const fields = {};
  for (const k of ['team', 'startDate', 'tshirt', 'targetQuarters', 'note', 'owner', 'milestone']) {
    const v = typeof f[k] === 'string' ? f[k] : '';
    fields[k] = FIELD_RE.test(v) && !(v === 'app' && (k === 'owner' || k === 'milestone')) ? v : '';
  }
  const matrix = {};
  for (const lk of ['portfolio', ...levels.map((l) => l.key), ...levelsOff.map((l) => l.key)]) {
    const row = input.matrix?.[lk] || {};
    matrix[lk] = {};
    for (const u of USAGES) if (MODES.includes(row[u])) matrix[lk][u] = row[u];
  }
  // Size keys may be any Jira option value ("M", "Medium", "XL (1280 h)"); compared case-insensitively.
  const tshirtSizes = (Array.isArray(input.tshirtSizes) ? input.tshirtSizes : []).slice(0, 24)
    .map((t) => ({ key: String(t?.key ?? '').trim().length > 40 ? '' : sizeKey(t?.key), hours: num(t?.hours, 0, 100000, 0) }))
    .filter((t) => SIZE_KEY_RE.test(t.key));
  if (new Set(tshirtSizes.map((t) => t.key)).size !== tshirtSizes.length) throw new ValidationError('T-shirt sizes must be unique');
  const r = input.rules || {};
  const rules = {
    dueDateWarning: bool(r.dueDateWarning, true),
    distribution: ['linear', 'start', 'due', 'capacity'].includes(r.distribution) ? r.distribution : 'capacity',
    personLevel: bool(r.personLevel, true),
    lockSubtasks: bool(r.lockSubtasks, false),
    healthRhythmDays: num(r.healthRhythmDays, 1, 90, 7),
    forecastThresholdPct: num(r.forecastThresholdPct, 0, 100, 10),
    deviationThresholdPct: num(r.deviationThresholdPct, 1, 100, 15),
  };
  const permissions = {};
  for (const k of PERMISSION_KEYS) {
    const list = Array.isArray(input.permissions?.[k]) ? input.permissions[k] : [];
    permissions[k] = list.slice(0, 50)
      .map((g) => ({ id: str(g?.id, 64), name: str(g?.name, 255) }))
      .filter((g) => /^[A-Za-z0-9-]{1,64}$/.test(g.id));
  }
  const s = input.support || {};
  const support = {
    serviceProjectIds: ids(s.serviceProjectIds, 20),
    queues: validQueues(s.queues),
    averagingWeeks: s.averagingWeeks === 8 ? 8 : 4,
    slaTargetPct: num(s.slaTargetPct, 50, 100, 95),
    escalationLinkTypeId: isId(String(s.escalationLinkTypeId || '')) ? String(s.escalationLinkTypeId) : '',
    sla: validSla(s.sla, prev.support?.sla),
    ...validSupportDispatch(s),
  };
  const cd = input.capacityDefaults || {};
  const capacityDefaults = {
    defaultWeeklyHours: num(cd.defaultWeeklyHours, 0, 80, 40),
    defaultLocation: Object.hasOwn(LOCATIONS, cd.defaultLocation) ? cd.defaultLocation : 'DE',
  };
  return {
    version: CONFIG_VERSION, setupComplete: true, portfolio, levels, levelsOff, fields, matrix,
    dependencies: (() => { const lt = ids(input.dependencies?.linkTypeIds, 20); return { linkTypeIds: lt, reversedLinkTypeIds: ids(input.dependencies?.reversedLinkTypeIds, 20).filter((x) => lt.includes(x)), blockedStatusIds: ids(input.dependencies?.blockedStatusIds, 20) }; })(),
    booking: validBooking(input.booking, prev.booking),
    // R1: the C-level report may only be published into Confluence spaces a Jira admin approved.
    report: { publishSpaces: (Array.isArray(input.report?.publishSpaces) ? input.report.publishSpaces : []).slice(0, 20)
      .map((x) => ({ id: str(x?.id, 20), key: str(x?.key, 50), name: str(x?.name, 200) })).filter((x) => /^\d{1,18}$/.test(x.id)) },
    tshirtSizes: tshirtSizes.length ? tshirtSizes : prev.tshirtSizes || DEFAULT_TSHIRTS,
    quarterRange: validQuarterRange(input.quarterRange ?? prev.quarterRange),
    rules, support, capacityDefaults,
    ...(() => { const roles = input.roles ? validRoles(input.roles, prev.roles) : input.permissions ? migrateRoles({ permissions, rules }) : validRoles(prev.roles); return { roles, permissions: legacyPermissions(roles, permissions) }; })(),
    teams: validTeamsCfg(input.teams ?? prev.teams),
    ai: validAi(input.ai, prev.ai),
    notices: validNotices(input.notices, prev.notices),
    snapshot: validSnapshot(input.snapshot ?? prev.snapshot),
    locations: validLocations(input.locations ?? prev.locations),
  };
}

// Target quarters: rolling window, switched-off and added quarters (shared/quarterRange.js – also used by the screen).
export { validQuarterRange, quarterChoices } from '../../shared/quarterRange.js';

// Booking check settings; anything invalid falls back to the previous value, then the default.
export function validBooking(b, prev) {
  const d = { ...DEFAULT_CONFIG.booking, ...(prev || {}) };
  const x = b && typeof b === 'object' ? b : {};
  const int = (v, lo, hi, def) => (Number.isInteger(+v) && +v >= lo && +v <= hi ? +v : def);
  return {
    enabled: typeof x.enabled === 'boolean' ? x.enabled : d.enabled,
    minPct: int(x.minPct, 0, 100, d.minPct),
    escalatePct: int(x.escalatePct, 0, 100, d.escalatePct),
    graceDays: int(x.graceDays, 0, 10, d.graceDays),
    escalateTo: ['lead', 'leadOwner', 'mgmt'].includes(x.escalateTo) ? x.escalateTo : d.escalateTo,
    schedule: ['day', 'week', 'month'].includes(x.schedule) ? x.schedule : d.schedule,
  };
}

// Mapped custom fields that no longer exist in Jira (deleted, or hidden from the admin) – the configuration page names
// them, because the cockpit would otherwise just show those values as empty everywhere.
export function staleFields(cfg, fields) {
  const have = new Set((Array.isArray(fields) ? fields : []).map((f) => f?.id));
  const out = Object.entries(cfg?.fields || {}).filter(([, id]) => /^customfield_\d+$/.test(String(id)) && !have.has(id)).map(([usage, id]) => ({ usage, id }));
  const cause = cfg?.support?.causeFieldId;
  if (/^customfield_\d+$/.test(String(cause || '')) && !have.has(cause)) out.push({ usage: 'supportCause', id: cause });
  return out;
}

// ---------- detection for first-run setup ----------
const TEAM_TYPES = ['com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team', 'com.atlassian.teams:rm-teams-custom-field-team'];
export async function detectSetup() {
  const [types, fields, links] = await Promise.all([
    jira('user', '/rest/api/3/issuetype'),
    jira('user', '/rest/api/3/field'),
    // issue linking can be switched off on a site (Jira answers 404): then there are simply no link types
    jira('user', '/rest/api/3/issueLinkType').catch(() => ({ issueLinkTypes: [] })),
  ]);
  const globalTypes = types.filter((t) => !t.scope);
  const byLevel = (lvl) => globalTypes.filter((t) => t.hierarchyLevel === lvl);
  const projectType = globalTypes.find((t) => t.hierarchyLevel >= 2 && /^(project|projekt)$/i.test(t.name))
    || globalTypes.filter((t) => t.hierarchyLevel >= 2).sort((a, b) => b.hierarchyLevel - a.hierarchyLevel)[0];
  const levels = [];
  let portfolio;
  if (projectType) {
    const above = byLevel(projectType.hierarchyLevel + 1);
    portfolio = { source: 'issue', issueTypeIds: [projectType.id], autoRemoveDone: false, group: { active: above.length > 0, name: above.map((t) => t.name).join(', ').slice(0, 60), issueTypeIds: above.map((t) => t.id) } };
    for (let l = projectType.hierarchyLevel - 1; l >= -1; l--) {
      const ts = byLevel(l);
      if (!ts.length) continue;
      const role = l === -1 ? 'tiny' : l === 0 ? 'estimate' : l === 1 ? 'structure' : levels.some((x) => x.role === 'rough') ? 'structure' : 'rough';
      levels.push({ key: `l${l + 2}`, name: ts.map((t) => t.name).join(', '), role, issueTypeIds: ts.map((t) => t.id), hierarchy: l });
    }
  } else {
    portfolio = { source: 'space', issueTypeIds: [], autoRemoveDone: false };
    const ep = byLevel(1), st = byLevel(0), sub = byLevel(-1);
    if (ep.length) levels.push({ key: 'epic', name: ep.map((t) => t.name).join(', '), role: 'structure', issueTypeIds: ep.map((t) => t.id), hierarchy: 1 });
    if (st.length) levels.push({ key: 'story', name: st.map((t) => t.name).join(', '), role: 'estimate', issueTypeIds: st.map((t) => t.id), hierarchy: 0 });
    if (sub.length) levels.push({ key: 'subtask', name: sub.map((t) => t.name).join(', '), role: 'tiny', issueTypeIds: sub.map((t) => t.id), hierarchy: -1 });
  }
  const custom = fields.filter((f) => f.custom);
  const team = custom.find((f) => TEAM_TYPES.includes(f.schema?.custom));
  const start = custom.find((f) => /^start date$/i.test(f.name) && f.schema?.type === 'date') || custom.find((f) => /start/i.test(f.name) && f.schema?.type === 'date');
  const note = custom.find((f) => /abh(ä|ae)ngigkeit|dependency/i.test(f.name) && f.schema?.type === 'string');
  const owner = custom.find((f) => /^(owner|projekt-?owner|project owner|verantwortlich|projektleit)/i.test(f.name) && (f.schema?.type === 'user' || f.schema?.items === 'user'));
  const milestone = custom.find((f) => /^(milestone|meilenstein)/i.test(f.name));
  const blocks = (links?.issueLinkTypes || []).find((l) => /^blocks$/i.test(l.name) || /^blocks$/i.test(l.outward));
  const matrix = { ...DEFAULT_MATRIX };
  for (const l of levels) matrix[l.key] = { ...(DEFAULT_MATRIX[l.role] || {}) };
  if (!levels.some((l) => l.role === 'rough')) matrix.portfolio = { ...DEFAULT_MATRIX.portfolio };
  else matrix.portfolio = { owner: 'required', dueDate: 'optional' };
  return {
    ...structuredClone(DEFAULT_CONFIG), portfolio, levels, levelsOff: [], matrix,
    fields: { team: team?.id || '', startDate: start?.id || '', tshirt: 'app', targetQuarters: 'app', note: note?.id || '', owner: owner?.id || '', milestone: milestone?.id || '' },
    dependencies: { linkTypeIds: blocks ? [blocks.id] : [] },
  };
}
