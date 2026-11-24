// Company policy: Rovo (Atlassian's agents and chat) must never be used by this app.
// Three layers keep it that way:
//  1. The manifest declares no Rovo agent, action, resource or scope (tests/norovo.test.js fails the build and
//     the ops release otherwise).
//  2. Every Jira/Confluence call goes through this check: only the product REST APIs are allowed, and nothing
//     that addresses Rovo or the Atlassian assistant gateway.
//  3. The browser bridge wrapper (static/cockpit/src/lib/api.js) removes the bridge's Rovo opener.

// Allowed: Jira REST (/rest/...) and Confluence REST (/wiki/...). Only the path is checked, not the query
// string, so a user search for e.g. "Provost" is not affected.
const ALLOWED = /^\/(rest|wiki)\//;
const BLOCKED = /rovo|\/assist(ant)?\b|\/gateway\/|\/agents?\b|\/conversation/i;

export class PolicyError extends Error {
  constructor(message) { super(message); this.code = 'FORBIDDEN'; this.status = 403; }
}

export function assertProductApi(pathOrRoute) {
  // a plain string, or a Route from @forge/api's route`` (which keeps its path in value_)
  const s = typeof pathOrRoute === 'string' ? pathOrRoute : String(pathOrRoute?.value_ ?? pathOrRoute?.value ?? '');
  const path = s.split('?')[0];
  if (!ALLOWED.test(path) || BLOCKED.test(path)) throw new PolicyError(`Blocked by policy: ${path.slice(0, 80)} (only Jira and Confluence REST APIs are allowed; Rovo is never called)`);
}
