// 2026-11-20: a customer removed SUPERPORT's access to their sandbox and the app could not be uninstalled from outside
// (site-admin rights needed). The app stops serving that site entirely; every other site keeps working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siteWithdrawn, WITHDRAWN_SITES } from '../src/lib/maintenance.js';

const CUSTOMER_SITE = 'c0ffee00-1111-4222-8333-444455556666';
const SUPERPORTDEV = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('a withdrawn site is recognised in every shape Forge hands over; other sites are not (the customer was lifted after the uninstall)', () => {
  assert.equal(WITHDRAWN_SITES.size, 0, 'no site is blocked right now');
  assert.equal(siteWithdrawn({ cloudId: CUSTOMER_SITE }), false, 'the customer site is no longer blocked');
  WITHDRAWN_SITES.add(CUSTOMER_SITE);
  assert.equal(siteWithdrawn({ cloudId: CUSTOMER_SITE }), true, 'resolver context');
  assert.equal(siteWithdrawn({}, { installContext: `ari:cloud:jira::site/${CUSTOMER_SITE}` }), true, 'scheduled trigger (event, context)');
  assert.equal(siteWithdrawn({ context: { cloudId: CUSTOMER_SITE } }), true, 'Jira event payload');
  assert.equal(siteWithdrawn({ cloudId: CUSTOMER_SITE.toUpperCase() }), true, 'case');
  for (const c of [{ cloudId: SUPERPORTDEV }, { installContext: `ari:cloud:jira::site/${SUPERPORTDEV}` }, {}, null, undefined]) assert.equal(siteWithdrawn(c), false, JSON.stringify(c));
  WITHDRAWN_SITES.delete(CUSTOMER_SITE);
});

test('every way in is blocked first: resolvers before anything is read, jobs and events, the issue panel', () => {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /if \(siteWithdrawn\(req\.context\)\) throw new UnavailableError\(WITHDRAWN_MESSAGE\);\n\s+\/\/ Kill switch first/);
  assert.match(src, /if \(siteWithdrawn\(\.\.\.args\)\) return undefined;/, 'scheduled jobs and the Jira event trigger');
  assert.match(src, /siteWithdrawn\(payload, payload\?\.context, context\)\) return \{\};/, 'issue panel status');
});
