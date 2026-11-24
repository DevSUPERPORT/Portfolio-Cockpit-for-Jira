# Test accounts for the role proof

Please create these five accounts. Use addresses on a test domain or `+` aliases, and do **not** use real colleagues.
- Add each one to superportdev with Jira access only (no site or Jira admin rights).
- Put their passwords only into `tests/e2e/accounts.json`, which is git-ignored.
- I never enter credentials. The suite runs on your machine.

| Role in tests | Suggested email | Groups | Extra setup |
|---|---|---|---|
| employee | pc-employee@… | none | none |
| owner | pc-owner@… | none | Assign epic **PCX-21 (KI-Kundenservice)** to this account, so it owns one portfolio project |
| projectAdmin | pc-projectadmin@… | `pc-test-projectadmins` | none |
| management | pc-management@… | `pc-test-management` | none |
| restricted | pc-restricted@… | `pc-test-restricted` | Can browse the hidden space PCR; nobody else can |

Dev Team remains the Jira-admin account and is covered by the existing harness runs (93/93 on production).

## What is proven per account

- **Visibility**
  - Which portfolio projects the account sees.
  - PCR is visible only to *restricted* and is never counted for anyone else.
- **Role gates**
  - ranking (reorder, add, remove)
  - C-level report
  - capacity editor
  - configuration
  - audit log
- **Health rules**
  - The owner may update their own project.
  - projectAdmin and management may update any project.
  - The employee may update none.
- **App-field writes**
  - Allowed only with Jira EDIT permission on the work item.
- **Hidden items**
  - Writes to PCR-1 return NOT_FOUND for everyone without Browse.

## Running it

1. Build the probe: `VITE_SELFTEST=1 VITE_SELFTEST_RUN=roleMatrix npm --prefix static/cockpit run build`.
2. Deploy it to **development** only, and install development temporarily, so production users never see the harness.
3. Run the suite:

```
cd tests/e2e
npm i
npx playwright install chromium
copy accounts.example.json accounts.json   (then fill in the passwords)
set PC_SITE=https://superportdev.atlassian.net
set PC_APP_PATH=/jira/apps/083d5c93-0586-481d-9c13-6e085bdfad84/<development env id>
npx playwright test
```

4. Uninstall development again afterwards.
