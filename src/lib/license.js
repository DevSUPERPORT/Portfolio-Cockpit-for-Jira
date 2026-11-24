// Marketplace licence (paid via Atlassian, `app.licensing.enabled` in the manifest). Forge passes context.license to
// resolvers; on a site without an active licence the cockpit is refused with LICENSE_INACTIVE (Jira admins keep the
// configuration page). No license object (development and staging installs) is not "inactive": those keep working.
//
// LICENSE_EXEMPT_SITES (Forge environment variable, comma-separated cloud IDs, set by SUPERPORT only): SUPERPORT's own
// sites, treated as licensed while the listing is reviewed and until they hold a Marketplace subscription themselves.
// The site comes from the Forge context, never from the browser.

/** True when Forge reports that the site has no active Marketplace licence (license.active, or the older isActive). */
export function isLicenseInactive(license) {
  return Boolean(license) && typeof license === 'object' && (license.active === false || license.isActive === false);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The exempt cloud IDs from the variable (invalid entries ignored). */
export function exemptSites(env = process.env) {
  return new Set(String(env.LICENSE_EXEMPT_SITES || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => UUID.test(s)));
}

/** Whether this request must be refused for the licence. `context` is the Forge resolver context. */
export function licenseBlocks(context, env = process.env) {
  if (!isLicenseInactive(context?.license)) return false;
  const site = typeof context?.cloudId === 'string' ? context.cloudId.toLowerCase() : '';
  return !(site && exemptSites(env).has(site));
}
