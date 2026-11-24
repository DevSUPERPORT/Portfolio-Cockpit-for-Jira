# Security policy

## Reporting a vulnerability

Please report security problems in SUPERPORT Portfolio Cockpit for Jira privately, not in a public issue:

- E-mail: **dev@superport.digital** (SUPERPORT P.C.)
- Or through Atlassian's Marketplace security reporting (Ecosystem security), which reaches SUPERPORT as the vendor.

Include the site (if any), the steps to reproduce and what you expected. We acknowledge every report within two
business days.

## How SUPERPORT responds

Fixes are released within Atlassian's security bug-fix deadlines for cloud apps, or sooner:

| Severity (CVSS) | Fix released within |
| --- | --- |
| Critical | 10 days |
| High | 4 weeks |
| Medium | 12 weeks |
| Low | 25 weeks |

While a fix is prepared, SUPERPORT can switch the app to maintenance or switch off its AI features for every customer
without shipping code (server-side Forge environment variables that customers cannot change), and says so on the public
status page https://superapps.statuspage.io.

## Design

- **Runs on Atlassian (Forge).** No remote back end, no calls outside Atlassian, no secrets in the code.
- **Server-side authorisation.** Identity comes from the Forge context only; every resolver checks the caller's role
  before it reads or writes. Jira data is read as the user, so Jira's permissions and issue security apply.
- **`asApp` only after a check.** The app's own fields are written as the app only after a JQL visibility check and an
  EDIT_ISSUES check as the user ([docs/THREAT-MODEL.md](docs/THREAT-MODEL.md)).
- **Validated input.** Every payload is whitelisted; JQL is built only from validated ids; prototype-pollution and
  type-confusion cases are tested.
- **No personal data in logs.** Logs carry a resolver name and an HTTP status; unexpected errors return a generic
  message.
- **AI off by default.** Forge LLM only (hosted by Atlassian); prompts are scrubbed of links, e-mail addresses and
  anything that looks like a secret; Jira text is treated as data, never as instructions.
- **Dependencies.** `npm audit --omit=dev` before each release: no high or critical findings (24 Nov 2026). The remaining
  moderate findings are inside Atlassian's `@forge/*` packages and the Excel export's `uuid`.
