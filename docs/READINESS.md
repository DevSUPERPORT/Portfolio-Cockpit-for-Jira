# Marketplace review readiness (updated 24 Nov 2026, production 3.35.0)

Sources: Atlassian's [security requirements](https://developer.atlassian.com/platform/marketplace/security-requirements/),
[listing Forge apps](https://developer.atlassian.com/platform/marketplace/listing-forge-apps/),
[app approval guidelines](https://developer.atlassian.com/platform/marketplace/app-approval-guidelines/), `forge lint`,
`forge eligibility`, `npm audit`, axe-core, the test suites and the live runs on superportdev. The listing texts and
images are in [marketplace/](marketplace/README.md).

## Status at a glance

| Area | Status |
|---|---|
| Security requirements | Pass (details below) |
| `forge lint` | No issues (24 Nov 2026) |
| Runs on Atlassian | Eligible – `forge eligibility -e production`, version 3.35.0 |
| Dependencies | 0 high / 0 critical; 6 moderate each in back end and UI (Atlassian `@forge/*` internals, ExcelJS `uuid`) |
| Tests | 803 passing (`npm test`); 35 live self-test suites with 1,400 demo work items (23–24 Nov 2026) |
| Accessibility | axe-core WCAG 2.2 AA, 0 violations in every view, light and dark |
| Scale | 15 projects / 1,215 work items: data 3.6 s, every view ≤ 4 s ([DEMO-DATA.md](DEMO-DATA.md)) |
| Listing kit | Texts, logo, banner, hero, 11 screenshots ([marketplace/](marketplace/README.md)) |
| Licensing | ⟦OPEN⟧ – see 1 below |
| Personal data reporting | ⟦OPEN⟧ – see 2 below |
| Preview features | ⟦OPEN⟧ – see 3 below |

## Open before submitting

1. **Marketplace licensing** (`app.licensing.enabled: true`, plus `filter.appIsLicensed: true` on the triggers).
   The resolvers already refuse with `LICENSE_INACTIVE` when a licence is present and inactive (`src/index.js`), and
   work as before when there is none (development, staging). **Effect on superportdev:** after licensing is enabled,
   Atlassian treats existing production installations as unlicensed until the site subscribes through the Marketplace,
   and the production environment can no longer be installed from the console until the listing is approved. Testing
   then moves to development/staging (`forge install --license active|inactive|trial`). Decide when to switch.
2. **Personal data reporting.** The app stores Atlassian account IDs. Add the `report:personal-data` scope and a weekly
   job that reports them and removes closed accounts (as in Workflow Analyzer `src/lib/privacy.js`). A new scope is a
   major version: every site's admin must approve the upgrade.
3. **Preview features.** `jira:workflowValidator` and the Teamwork Graph scopes (`read:graph:team:atlassian`,
   `read:graph:user:atlassian`) are in Forge **Preview**. Atlassian's pages do not say whether Preview features may be
   listed; ask Atlassian (ECOHELP) before submitting. Fallback if not: ship without them (the cockpit's own team
   capacity works without Atlassian Teams; the validator is optional).
4. **Organisational** (SUPERPORT): security contact registered on ecosystem.atlassian.net; developer console sharing set
   to "Sharing"; partner verification; pricing decision ([LISTING.md](marketplace/LISTING.md)); documentation URL.

## Security requirements (Atlassian list, abbreviated)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Authenticate and authorise every endpoint | Pass | Identity from the Forge context; role check in every resolver ([THREAT-MODEL.md](THREAT-MODEL.md)); 22/22 denial checks live. |
| 2 | Default to `asUser` | Pass | Every view read is `asUser`; the `asApp` uses are listed in the threat model. |
| 3 | Verify permissions before `asApp` | Pass, 1 accepted exception | App-field writes check JQL visibility and EDIT_ISSUES as the user first. Exception R2: rank renumbering of shifted items. |
| 10 | Least-privilege scopes | Pass | 9 scopes, each justified in [LISTING.md](marketplace/LISTING.md). |
| 11 | Secrets | n/a | No secrets. `AI_BUDGET` holds limits only. |
| 12 | No PII or credentials in logs | Pass | Resolver name and HTTP status only (`src/lib/safeLog.js`). |
| 17 | No `unsafe-inline`/`unsafe-eval` in `script-src` | Pass | Only `styles: unsafe-inline`. |
| 18 | Validate untrusted input | Pass | Whitelists; JQL from validated ids; `__proto__` and type-confusion tests. |
| 21 | No known high or critical vulnerable dependencies | Pass | `npm audit --omit=dev`, 24 Nov 2026. |
| 22 | No end-of-life Node runtime | Pass | `nodejs22.x`; plan the next LTS before April 2027. |
| 23–25 | Rovo | N/A | No Rovo (company policy); `tests/norovo.test.js`, runtime allow-list `src/lib/norovo.js`. |
| 26 | No user credentials collected | Pass | None. |
| 27–29 | Bug-fix policy, incident notification, security contact | Documented | [SECURITY.md](../SECURITY.md); contact registration ⟦OPEN⟧ (item 4). |

## AI (Forge LLM)

- Forge LLM is generally available; Atlassian shows its use on the listing and at install automatically.
- Off by default; a Jira admin allows it, each person switches it on for themselves (or the admin for everyone).
- Cost: billed to SUPERPORT. 20 € per site and month by default from December 2026 (App Status overrides), 1,000 calls
  and 2,000,000 tokens per site and month, 60 requests per person and day. At a limit the cockpit keeps working with its
  own rules.

## Correctness

- Golden dataset: 22/22 metrics agree with independent spreadsheet formulas (`tests/golden/`).
- Property tests over random portfolios; Lotse: every number in a text has a source (`tests/lotseSourcedBig.test.js`).
- Live: the full end-to-end run on 23–24 Nov 2026 found and fixed 8 real bugs (3.33.0); production verified after every
  release since.

## Still worth doing (not blocking)

- A manual screen-reader pass (NVDA or VoiceOver) and a keyboard-only walkthrough.
- The five real non-admin test accounts for the role proof ([TEST-ACCOUNTS.md](TEST-ACCOUNTS.md)).
- Usability sessions with real users ([USABILITY-TEST.md](USABILITY-TEST.md)).
