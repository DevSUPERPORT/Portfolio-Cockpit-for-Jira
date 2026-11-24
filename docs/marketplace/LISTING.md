# Marketplace listing: SUPERPORT Portfolio Cockpit for Jira

Everything to paste into the Atlassian partner portal. Images are in this folder (see [README](README.md)).
The listing is created only when SUPERPORT says so. Search for **⟦CONFIRM⟧** and **⟦OPEN⟧** first.

## Basics

| Field | Value |
|---|---|
| App name | SUPERPORT Portfolio Cockpit for Jira (37 characters; "… for Jira" form, no "app"/"plugin"/"add-on") |
| App ID | `ari:cloud:ecosystem::app/083d5c93-0586-481d-9c13-6e085bdfad84` |
| Hosting | Cloud, Forge, **Runs on Atlassian** (no egress; data in Jira and Forge storage; optional AI through Forge LLM, run by Atlassian) |
| Version to list | Production **3.35.0** (tag `portfolio-cockpit-20261124-131624`) – or the version that adds the ⟦OPEN⟧ items below |
| Product | Jira (Jira Software, Jira Service Management, Jira Work Management); Confluence optional (report publishing) |
| Payment model | Paid via Atlassian ⟦OPEN⟧ manifest `app.licensing.enabled: true` still to be switched on |
| Categories | Project management; Reports; Time tracking |
| Keywords | portfolio management, capacity planning, resource planning, waterline, ranking, roadmap, weekly planning, plan vs actual, time tracking, worklogs, C-level report, PMO |
| Vendor | SUPERPORT P.C. (IKE), Sorou 22, 151 25 Marousi (Athens), Greece · https://www.superport.digital |
| Support | mail@superport.digital · https://www.superport.digital/en/contact · working days 9:00–18:00 Athens time (DE/EN/GR), first response within 1 business day |
| Security contact | dev@superport.digital (see [SECURITY.md](../../SECURITY.md)) ⟦CONFIRM⟧ registered on ecosystem.atlassian.net |
| Status page | https://superapps.statuspage.io/ |
| Documentation URL | https://github.com/DevSUPERPORT/Portfolio-Cockpit-for-Jira/blob/main/docs/TESTER-GUIDE.md ⟦CONFIRM⟧ repository public, or a page on superport.digital |
| Privacy policy URL | https://www.superport.digital/apps/privacy (app notice: [PRIVACY.md](../../PRIVACY.md)) |
| EULA URL | https://www.superport.digital/apps/eula |

## Tagline (max 130 characters)

> Rank your projects, see where capacity runs out, plan the week and report to management – live from Jira.

## Summary

> Portfolio and capacity planning inside Jira: one ranked list, a waterline that shows what fits this quarter, a weekly
> planning board, plan vs. actual and a one-page C-level report. Every number explains itself; every change can be undone.

## Highlights (3: title ≤ 50, text ≤ 220, image 1840×900)

1. **See what fits this quarter**
   Rank your projects once. Capacity is handed out from the top down – support first – and the waterline shows which
   projects are fully staffed and which hours are missing per team.
   Image: `screenshots/portfolio.png`
2. **Plan the week, write it to Jira**
   A person × week board with absences, holidays and support. Drag work, distribute hours by free capacity, let
   Optimise smooth overload – and apply to Jira only when you are ready.
   Image: `screenshots/weekly.png`
3. **Report with numbers you can defend**
   A one-page C-level report as PDF, Excel or Confluence page. Hover any figure for its arithmetic; Lotse answers
   questions from your data and names the source of every number.
   Image: `screenshots/report.png`

## More screenshots (gallery, in this order, with captions)

| File | Caption |
|---|---|
| `screenshots/project.png` | Everything for one project: what needs action, missing values, capacity per team and dependencies. |
| `screenshots/teams.png` | Team load, conflicts for people in several teams, blocked and overdue work. |
| `screenshots/planactual.png` | Plan vs. actual: the weekly plan against booked time, and why things shifted. |
| `screenshots/mywork.png` | My work: book the week in one grid; missing hours are proposed from your own Jira activity. |
| `screenshots/lotse.png` | Lotse, the built-in navigator: answers and multi-step jobs with preview and undo – no AI required. |
| `screenshots/ask.png` | Ask "I want …": a wish becomes a card with a chart and the calculation behind it. |
| `screenshots/support.png` | Support: dispatch tickets, check the support reserve and SLAs in business hours. |
| `screenshots/settings.png` | AI features are off by default. Jira admins switch them on and see this month's usage and budget. |

Banner: `banner-1120x548.png`. Hero image: `hero-960x600.png`. Logo: `app-logo-144.png`.
All screenshots come from the app's built-in demo portfolio (`scripts/capture-marketplace.mjs`), so no customer or
test-site data appears in them.

## Description (long, ≤ 1000 characters for "More details")

> **Portfolio planning without a second spreadsheet.** SUPERPORT Portfolio Cockpit reads projects, estimates, worklogs,
> teams and dates live from Jira, as the signed-in user. Rank your projects once and the cockpit hands out capacity from
> the top down – support and daily business first. The waterline shows what fits this quarter and which hours are
> missing per team. Team leads plan the week on a person × week board and apply it to Jira when ready; plan vs. actual
> shows what really happened. Management gets a one-page report as PDF, Excel or Confluence page. Every number explains
> its arithmetic on hover, Lotse answers questions from your data with sources, and every change has its own undo.
> Optional AI (off by default) runs on Atlassian's Forge LLM inside your cloud. German and English, light and dark.

## Pricing ⟦CONFIRM⟧ (proposal, not decided)

Set in the partner portal under *Pricing*. Atlassian bills annual subscriptions at 10× the monthly price. Proposal in
line with the other SUPERPORT apps (Workflow Analyzer: $1.00 for 11–100 users), one step above because the cockpit is
a full planning product and includes AI that SUPERPORT pays for:

| Users on the site | Price per user per month |
|---|---|
| Up to 10 | **Free** |
| 11–100 | $1.50 |
| 101–250 | $1.10 |
| 251–1,000 | $0.60 |
| 1,001–2,500 | $0.25 |
| 2,501–5,000 | $0.15 |
| 5,001–10,000 | $0.08 |
| 10,001 and more | $0.04 |

Every site can use up to 20 € of AI per month, paid by SUPERPORT (set per site in App Status). Free trial: Atlassian's
standard 30 days.

## Why the app needs each permission (scope justification)

| Scope | Why |
|---|---|
| `read:jira-work` | Read projects, work items, estimates, worklogs, dates, links, versions and service queues to compute the portfolio, capacity, plans and reports – always as the signed-in user |
| `write:jira-work` | Only on explicit user action: book worklogs (My work), apply the weekly plan (dates, assignee), fill missing values, set the app's own fields (rank, T-shirt size, target quarters), link support tickets – each with an undo |
| `read:jira-user` | Check the signed-in user's permissions and group membership (roles) and show names of assignees and worklog authors |
| `storage:app` | The app's own data in Forge storage: configuration, ranking, health, capacities, plan snapshots, audit log, preferences, AI usage meter |
| `send:notification:jira` | Optional reminders to project owners and booking notices – only after a Jira admin switches them on |
| `read:space:confluence` | Let a report publisher pick the Confluence space for the C-level report |
| `write:page:confluence` | Publish (and undo) the C-level report as a Confluence page, only on explicit user action |
| `read:graph:team:atlassian` | Read Atlassian Teams and their members through the Teamwork Graph, as the signed-in user, for capacity per team |
| `read:graph:user:atlassian` | Resolve the members of those teams |

Also declared: the Forge LLM module (`llm`, model Claude) – AI features, off until a Jira admin turns them on; the
`jira:workflowValidator` "Original Estimate required" (only where an admin adds it to a workflow).

## Partner portal checklist

1. ⟦OPEN⟧ Switch on Marketplace licensing (`app.licensing.enabled: true`) and add `filter.appIsLicensed` to the
   triggers – see [READINESS.md](../READINESS.md) for the effect on the existing superportdev installation.
2. ⟦OPEN⟧ Personal data reporting (`report:personal-data`, weekly) – see [READINESS.md](../READINESS.md).
3. ⟦OPEN⟧ Ask Atlassian (ECOHELP) whether Preview features may be listed: Teamwork Graph scopes, `jira:workflowValidator`.
4. In the developer console: *Distribution* → sharing on (not "within organization"), personal data declaration.
5. Partner portal → *Create new app* → **Forge app** → production environment → paid via Atlassian.
6. Paste the texts above; upload logo, banner, hero, highlights and gallery screenshots.
7. Enter the pricing table; keep the 30-day trial.
8. Enter documentation, EULA and privacy URLs from the table above.
9. Fill in the *Privacy & Security* tab from [DATA_SECURITY_PRIVACY.md](DATA_SECURITY_PRIVACY.md) (SUPERPORT ticks the
   attestations).
10. Security questionnaire: the app collects no credentials or API tokens; `asApp` only after a user permission check.
11. **Stop before "Submit"** so SUPERPORT can review everything. The Partner Agreement is accepted by SUPERPORT.
12. After approval: install from the Marketplace on superportdev (trial) and repeat the smoke test.
