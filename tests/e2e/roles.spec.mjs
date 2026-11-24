// Multi-account permission proof. One real login per role; the app's role probe (a test build with
// VITE_SELFTEST_RUN=roleMatrix) reports what the server allowed. Expected values come from docs/TEST-ACCOUNTS.md.
//
// Run (on your machine, never in CI with real people's accounts):
//   cd tests/e2e && npm i && npx playwright install chromium
//   set PC_SITE=https://superportdev.atlassian.net  and  PC_APP_PATH=/jira/apps/<appId>/<envId>
//   set PC_ACCOUNTS=accounts.json   (see accounts.example.json; this file is git-ignored)
//   npx playwright test
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const SITE = process.env.PC_SITE;
const APP = process.env.PC_APP_PATH;
const accounts = JSON.parse(readFileSync(process.env.PC_ACCOUNTS || 'accounts.json', 'utf8'));

// A = allowed, D = denied (NO_ACCESS), H = hidden (NOT_FOUND). "visible" lists the portfolio keys the account must see.
const EXPECTED = {
  employee:     { reorder: 'D', addRemove: 'D', reportGet: 'D', capacityGet: 'D', configGet: 'D', auditList: 'D', healthOther: 'D', fillAppField: 'D', hiddenRefHealth: 'H' },
  owner:        { reorder: 'D', addRemove: 'D', reportGet: 'D', capacityGet: 'D', configGet: 'D', auditList: 'D', healthOther: 'D', healthOwn: 'A', hiddenRefHealth: 'H' },
  projectAdmin: { reorder: 'D', addRemove: 'D', reportGet: 'D', capacityGet: 'D', configGet: 'D', auditList: 'D', healthOther: 'A', hiddenRefHealth: 'H' },
  management:   { reorder: 'A', addRemove: 'A', reportGet: 'A', capacityGet: 'A', configGet: 'D', auditList: 'A', healthOther: 'A', hiddenRefHealth: 'H' },
  restricted:   { reorder: 'D', reportGet: 'D', configGet: 'D', hiddenRefHealth: 'A_OR_D' },
};
const norm = (v) => (v === 'allowed' ? 'A' : v === 'NOT_FOUND' ? 'H' : v === 'n/a' ? 'n/a' : /NO_ACCESS|FORBIDDEN|NO_EDIT_PERMISSION/.test(v) ? 'D' : v);

for (const acc of accounts) {
  test(`role matrix: ${acc.role} (${acc.email})`, async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${SITE}/login`);
    await page.getByLabel(/email/i).fill(acc.email);
    await page.getByRole('button', { name: /continue/i }).click();
    await page.getByLabel(/password/i).fill(acc.password);
    await page.getByRole('button', { name: /log in/i }).click();
    await page.waitForURL(/atlassian\.net/);
    await page.goto(`${SITE}${APP}`);
    const frame = page.frameLocator('iframe[src*="atlassian-dev.net"], iframe[data-testid*="forge"]').first();
    const out = frame.getByTestId('roletest-result');
    await expect(out).toHaveText(/accountId/, { timeout: 120_000 });
    const result = JSON.parse(await out.textContent());
    const exp = EXPECTED[acc.role];
    for (const [k, want] of Object.entries(exp)) {
      const got = norm(result[k]);
      if (want === 'A_OR_D') expect(['A', 'D']).toContain(got);
      else expect(got, `${acc.role}.${k}`).toBe(want);
    }
    if (acc.mustSee) for (const key of acc.mustSee) expect(result.visibleProjects.split(',')).toContain(key);
    if (acc.mustNotSee) for (const key of acc.mustNotSee) expect(result.visibleProjects.split(',')).not.toContain(key);
  });
}
