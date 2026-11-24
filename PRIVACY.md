# Privacy notice — SUPERPORT Portfolio Cockpit for Jira

_Last updated: 24 November 2026. App-specific privacy notice; SUPERPORT's general app terms and privacy statement are at
https://www.superport.digital/en/apps/eula and https://www.superport.digital/apps/privacy._

This notice explains how **SUPERPORT Portfolio Cockpit for Jira** ("the app"), provided by **SUPERPORT P.C.**
("SUPERPORT", "we"), handles data when it is installed on an Atlassian Jira Cloud site.

## 1. Summary

- The app runs entirely on Atlassian's cloud platform (Forge, "Runs on Atlassian").
- **No data leaves Atlassian.** The app sends nothing to SUPERPORT or to any other party. SUPERPORT has no access to
  your Jira site, your work items or the data the app stores.
- The app reads your Jira data **as the signed-in user** and shows only what that person may see in Jira.
- What the app stores lives in your site's Atlassian-hosted app storage, under your Atlassian data residency settings.

## 2. What the app processes and stores

| Data | Why | Where / how long |
| --- | --- | --- |
| Work items, estimates, worklogs, dates, teams, links (read from Jira) | Compute the portfolio, capacity, plans and reports | Read live; not copied, except the derived figures below |
| Configuration: hierarchy, field mapping, role groups, locations, support spaces | Make the app work on your site | App storage, until changed or uninstalled |
| Portfolio ranking, project health (status, comment, who and when), milestones | The portfolio and its history | App storage; also the app's own Jira fields (rank, T-shirt size, target quarters) |
| Capacity per person and team: weekly hours, team shares, daily business, absences (with an optional reason) | Capacity and the waterline | App storage, until changed; absence reasons are shown only to people who may edit capacities |
| Weekly plan snapshots (planned hours per person and work item) and a daily record of each project's core figures | Plan vs. actual; how well forecasts held | App storage; plan snapshots are deleted after 12, 24 or 36 months as configured (default 24) |
| Atlassian account IDs of people who change something (audit log, undo history, health updates, published reports) | "Who did what", undo | App storage; kept until the app is uninstalled |
| Per-person conveniences: language, tour seen, last visit, the AI switch for oneself, a report draft, saved Ask questions | Usability | App storage, until the person's account is closed or the app is uninstalled |
| AI usage meter: calls, tokens and cost per day and feature (numbers only, no content) | Keep AI cost within the monthly budget | App storage, per calendar month |
| AI answers (only when AI is switched on): the answer to a question, keyed by the question and the facts it used | Answer the same question again at no cost | App storage, 12 hours; deleted when AI is switched off |

The app does not store names or e-mail addresses; names are looked up in Jira when shown. With person-level detail
switched off, assignees and worklog authors are pseudonymised on the server before anything reaches the browser.

## 3. AI features (optional, off by default)

AI features use **Forge LLM** – models hosted and run by Atlassian inside its cloud, under Atlassian's terms. They stay
off until a Jira administrator switches them on and, by default, each person must also switch AI on for themselves.

When a person uses an AI feature, the app sends a fact sheet built only from data that person may see. Links, e-mail
addresses and anything that looks like a password, token or key are removed first; names and texts are sent only if the
administrator allowed it. The AI cannot change anything in Jira. Every AI number is cross-checked against the app's own
figures before it is shown.

## 4. People who leave

Every week the app reports the account IDs it stores to Atlassian's personal data reporting service. For every
account Atlassian reports as closed, the app deletes that person's own records (preferences, drafts, usage) and removes
the account ID from all other records – capacity entries are deleted, other mentions become "closed-account".

## 5. Your control

- Jira administrators choose the hierarchy, the role groups, whether person-level detail is shown, and whether AI is
  allowed (and which AI features).
- Every change in the app is in the audit log and can be undone.
- Uninstalling the app deletes its app storage according to Atlassian's Forge data retention. Data written into your
  Jira (worklogs, dates, assignees, the app's fields, published Confluence pages) stays your Jira data.
- SUPERPORT can switch the app to maintenance or switch off its AI features for all customers in an emergency; this
  never sends or exposes data.

## 6. Sub-processors

Atlassian (hosting, storage, Forge LLM). SUPERPORT uses no other sub-processors for this app.

## 7. Contact

Questions about privacy or data protection: **mail@superport.digital**, SUPERPORT P.C., Sorou 22, 151 25 Marousi
(Athens), Greece. Security reports: see [SECURITY.md](SECURITY.md).

We will update this notice when the app's data handling changes; the date above shows the latest version.
