// SUPERPORT kill switch: SUPERPORT can pause or take down Portfolio Cockpit for every customer at once
// (e.g. while a vulnerability is fixed), through the SUPERPORT App Status app / ops panel.
//
// The switch is the Forge environment variable APP_MAINTENANCE of the app's environment:
//   off (or unset) – normal operation
//   readonly       – everything can be viewed, nothing is changed (no writes to Jira, Confluence or app storage)
//   on             – the app refuses every request; the UI shows "temporarily unavailable"
//
// Who can flip it: only the app owner, with the Forge CLI / developer API followed by a redeploy of the live
// tagged build (SUPERPORT-OPS). Customers, Jira admins and anyone reading the Custom UI bundle cannot: the value
// lives in Atlassian's runtime, is read only on the server, and no resolver, setting or URL changes it.
// The app never contacts Statuspage and holds no Statuspage or Forge credentials.
//
// Fail closed: any value other than the three known ones counts as "on".

export const STATUS_PAGE_URL = 'https://superapps.statuspage.io';
const VAR = 'APP_MAINTENANCE';

export function maintenanceMode(env = process.env) {
  const raw = String(env[VAR] ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'off') return 'off';
  if (raw === 'readonly' || raw === 'read-only') return 'readonly';
  return 'on';
}

export const UNAVAILABLE_MESSAGE = 'SUPERPORT Portfolio Cockpit is temporarily unavailable: we have paused it for maintenance to keep your data safe. Nothing you saved is lost and your Jira is not affected. / Portfolio Cockpit ist vorübergehend nicht verfügbar: Wir haben es zum Schutz deiner Daten pausiert. Nichts geht verloren, dein Jira ist nicht betroffen. Status: ' + STATUS_PAGE_URL;
export const READONLY_MESSAGE = 'Changes are paused for maintenance to keep your data safe. You can still view everything. / Änderungen sind zum Schutz deiner Daten pausiert. Ansehen geht weiterhin. Status: ' + STATUS_PAGE_URL;

// Sites the app was withdrawn from (2026-11-20: a customer removed SUPERPORT's access to their sandbox; the app could not be
// uninstalled from outside, so it stops serving that site entirely – no request, job or Jira event reads or writes
// anything there). Keyed by the site's cloudId, so no other site is affected.
// That sandbox was blocked on 2026-11-20 and lifted the same day once their admin had uninstalled the app – the list is
// empty; the mechanism stays for the next time an app must stop serving one site.
export const WITHDRAWN_SITES = new Set([]);
export const WITHDRAWN_MESSAGE = 'SUPERPORT Portfolio Cockpit is no longer available on this site. A site admin can uninstall it under Apps › Manage apps. / Portfolio Cockpit ist auf dieser Site nicht mehr verfügbar. Ein Site-Admin kann es unter Apps › Apps verwalten deinstallieren.';
const cloudIdOf = (c) => {
  if (!c || typeof c !== 'object') return null;
  if (typeof c.cloudId === 'string') return c.cloudId;
  const ari = c.installContext || c.context?.installContext;
  const m = typeof ari === 'string' ? /site\/([0-9a-f-]{36})/i.exec(ari) : null;
  return m ? m[1] : typeof c.context?.cloudId === 'string' ? c.context.cloudId : null;
};
/** True when any of the given invocation contexts / payloads belongs to a withdrawn site. */
export const siteWithdrawn = (...ctxs) => ctxs.some((c) => { const id = cloudIdOf(c); return !!id && WITHDRAWN_SITES.has(id.toLowerCase()); });

export class UnavailableError extends Error {
  constructor(message) { super(message); this.code = 'UNAVAILABLE'; }
}

/** Throws when the app is down (any request) or read-only (requests that change something). */
export function requireAvailable(kind, env = process.env) {
  const mode = maintenanceMode(env);
  if (mode === 'on') throw new UnavailableError(UNAVAILABLE_MESSAGE);
  if (mode === 'readonly' && kind !== 'read') throw new UnavailableError(READONLY_MESSAGE);
}

// Resolvers that only read. Explicit allow-list: a resolver that is not listed counts as a change and is
// refused in read-only mode, so a new resolver can never write while changes are paused.
export const READ_RESOLVERS = new Set([
  'bootstrap', 'dataset', 'teams.atlassian', 'portfolio.candidates', 'users.search', 'capacity.get',
  'ai.ask', 'ai.healthDraft', 'ai.reportSummary', 'ai.assist',
  'report.get', 'report.refresh', 'confluence.spaces',
  'config.get', 'config.detect', 'config.history', 'config.version', 'settings.get',
  'fields.options', 'field.options', 'support.preview', 'booking.worklogs', 'history.get',
  'meta.confluenceSpaces', 'meta.groups', 'meta.projects', 'meta.versions', 'audit.list', 'story.check', 'mine.week', 'mine.search', 'mine.evidence', 'planActual.get',
  'insights.history', 'insights.comments', 'playbooks.list', 'ai.users', 'ai.spend', 'lotse.llm',
  'lotse.learned', 'usage.summary', 'report.draft',
]);
export const kindOf = (name) => (READ_RESOLVERS.has(name) ? 'read' : 'write');
