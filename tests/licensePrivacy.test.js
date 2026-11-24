// Marketplace readiness (2026-11-24): the licence check (Atlassian's license.active, the older isActive, SUPERPORT's own
// exempt sites) and Atlassian's personal data reporting (report every 6 days, closed accounts removed everywhere).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isLicenseInactive, licenseBlocks, exemptSites } from '../src/lib/license.js';
import { accountsIn, scrubValue, reportPersonalData, eraseAccounts, isAccountId, CLOSED } from '../src/lib/privacy.js';

const SITE = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';
const A = '712020:00000000-aaaa-4bbb-8ccc-000000000001';
const B = '712020:00000000-aaaa-4bbb-8ccc-000000000002';
const OLD = '5b10ac8d82e05b22cc7d4ef5';

test('licence: inactive only when Forge says so (active or isActive false); no license object = keeps working', () => {
  assert.equal(isLicenseInactive(undefined), false, 'development / staging');
  assert.equal(isLicenseInactive(null), false);
  assert.equal(isLicenseInactive({ active: true }), false);
  assert.equal(isLicenseInactive({ active: false }), true, "Atlassian's current field");
  assert.equal(isLicenseInactive({ isActive: false }), true, 'the older field');
  assert.equal(isLicenseInactive({ active: true, isEvaluation: true }), false, 'trial');
});

test("licence: SUPERPORT's exempt sites keep working; every other site is refused; the site comes from the context", () => {
  const env = { LICENSE_EXEMPT_SITES: ` ${SITE.toUpperCase()} , not-a-uuid,` };
  assert.deepEqual([...exemptSites(env)], [SITE]);
  assert.equal(licenseBlocks({ cloudId: SITE, license: { active: false } }, env), false);
  assert.equal(licenseBlocks({ cloudId: OTHER, license: { active: false } }, env), true);
  assert.equal(licenseBlocks({ license: { active: false } }, env), true, 'no site in the context: no exemption');
  assert.equal(licenseBlocks({ cloudId: OTHER, license: { active: true } }, env), false);
  assert.equal(licenseBlocks({ cloudId: SITE, license: { active: false } }, {}), true, 'unset variable: nobody exempt');
});

test('licence: the resolver uses the shared check; the manifest enables Marketplace licensing', () => {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /if \(licenseBlocks\(req\.context\) && !\(ctx\.moduleKey === 'pc-admin' && LICENSE_FREE\.has\(name\)\)\)/);
  assert.ok(!/license\.isActive === false/.test(src), 'no second, older check left');
  const manifest = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8');
  assert.match(manifest, /\n {2}licensing:\n {4}enabled: true\n/);
  assert.match(manifest, /- key: pc-privacy\n\s+function: privacy-job\n\s+interval: day/);
  assert.match(manifest, /- key: privacy-job\n\s+handler: index\.privacyJob/);
  assert.match(manifest, /- report:personal-data/);
});

test('privacy: account IDs are found in keys and values (current and old format), nothing else', () => {
  assert.ok(isAccountId(A) && isAccountId(OLD));
  assert.ok(!isAccountId('a'.repeat(64)) && !isAccountId(SITE) && !isAccountId('712020:short'));
  const ids = accountsIn(`pref:${A}`, { people: { [B]: { weeklyHours: 40 } }, by: OLD, hash: 'f'.repeat(64), team: SITE });
  assert.deepEqual([...ids].sort(), [A, B, OLD].sort());
});

test('privacy: a closed account is removed from records – keyed entries, list entries, mentions – others stay', () => {
  const closed = new Set([A]);
  const v = {
    people: { [A]: { weeklyHours: 40 }, [B]: { weeklyHours: 38 } },
    absences: [{ accountId: A, from: '2026-12-21' }, { accountId: B, from: '2026-12-28' }],
    members: [A, B],
    by: A,
    note: `changed by ${A}`,
  };
  assert.deepEqual(scrubValue(v, closed), {
    people: { [B]: { weeklyHours: 38 } },
    absences: [{ accountId: B, from: '2026-12-28' }],
    members: [B],
    by: CLOSED,
    note: `changed by ${CLOSED}`,
  });
});

const memStore = (entries) => {
  const m = new Map(Object.entries(entries));
  return {
    m,
    // like Forge storage: ordered by key, the cursor continues after the last key (stable while entries are deleted)
    async page(cursor) { const keys = [...m.keys()].sort().filter((k) => !cursor || k > cursor); const take = keys.slice(0, 2); return { results: take.map((key) => ({ key, value: m.get(key) })), cursor: keys.length > 2 ? take[take.length - 1] : null }; },
    get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : null),
    set: async (k, v) => { m.set(k, structuredClone(v)); },
    del: async (k) => { m.delete(k); },
  };
};

test('privacy: reports every stored account in batches, erases closed ones everywhere, then waits 6 days', async () => {
  const store = memStore({
    config: { setupComplete: true },
    capacity: { people: { [A]: { weeklyHours: 40 }, [B]: { weeklyHours: 38 } } },
    [`pref:${A}`]: { lang: 'de' },
    [`digest:${A}:base`]: { at: 1 },
    'audit:2026-11-24T10:00:00Z:x': { by: A, action: 'capacity.save' },
    [`pref:${B}`]: { lang: 'en' },
  });
  const sent = [];
  const report = async (accounts) => { sent.push(...accounts); return accounts.filter((a) => a.accountId === A).map((a) => ({ accountId: a.accountId, status: 'closed' })); };
  const now = Date.parse('2026-11-24T12:00:00Z');
  const r = await reportPersonalData({ report, store, now });
  assert.deepEqual(r, { reported: 2, erased: 1, skipped: false });
  assert.deepEqual(sent.map((a) => a.accountId).sort(), [A, B].sort());
  assert.ok(sent.every((a) => a.updatedAt === new Date(now).toISOString()));
  assert.ok(!store.m.has(`pref:${A}`) && !store.m.has(`digest:${A}:base`), 'the closed account\'s own keys are deleted');
  assert.deepEqual(store.m.get('capacity'), { people: { [B]: { weeklyHours: 38 } } });
  assert.equal(store.m.get('audit:2026-11-24T10:00:00Z:x').by, CLOSED);
  assert.deepEqual(store.m.get(`pref:${B}`), { lang: 'en' }, 'other people untouched');
  assert.deepEqual(store.m.get('config'), { setupComplete: true });
  // within 6 days: nothing; after: again
  assert.equal((await reportPersonalData({ report, store, now: now + 5 * 86400000 })).skipped, true);
  assert.equal((await reportPersonalData({ report, store, now: now + 6 * 86400000 + 1 })).reported, 1);
});

test('privacy: a value that only looks like an account ID does not block the others (one-by-one fallback)', async () => {
  const store = memStore({ x: { a: A, b: B } });
  const report = async (accounts) => {
    if (accounts.length > 1 || accounts[0].accountId === B) throw new Error('400 unknown account');
    return [{ accountId: A, status: 'closed' }];
  };
  const r = await reportPersonalData({ report, store, now: Date.parse('2026-11-24T12:00:00Z') });
  assert.equal(r.erased, 1);
  assert.deepEqual(store.m.get('x'), { a: CLOSED, b: B });
});

test('privacy: the time budget stops cleanly and the next run continues', async () => {
  const store = memStore({ k1: { by: A }, k2: { by: A }, k3: { by: A } });
  assert.equal(await eraseAccounts([A], { store, deadline: Date.now() - 1 }), false);
  assert.equal(await eraseAccounts([A], { store }), true);
  assert.ok([...store.m.values()].every((v) => v.by === CLOSED));
});
