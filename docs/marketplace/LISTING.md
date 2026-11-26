# Marketplace listing: SUPERPORT Portfolio Cockpit for Jira

Everything for the Atlassian partner portal. Images are in this folder (see [README](README.md)).

**Status (26 Nov 2026): submitted for Atlassian approval – version 4.3.0 made public, release behaviour "Let me control when app is published" (goes live only when SUPERPORT publishes it after approval).** Marketplace app 3718518892
(https://marketplace.atlassian.com/apps/3718518892, visible to SUPERPORT contacts only). Filled in: details (tagline, summary,
categories Project management + Data and analytics, keywords Resource management · Reporting · Time tracking ·
Roadmapping, logo, banner, support and status links, publishing: "Let me control when app is published"), pricing
(set by SUPERPORT in the portal), version 4.3.0 (Commercial licence, summary, more details, release notes, hero + 3 highlights,
8 gallery images, documentation = repository README, own EULA), Privacy & Security (submitted by SUPERPORT on 26 Nov 2026, **pending Atlassian approval**;
see [DATA_SECURITY_PRIVACY.md](DATA_SECURITY_PRIVACY.md)). Left for SUPERPORT: the Preview-features question to Atlassian; publishing the app once Atlassian approves it.

## Basics

| Field | Value |
|---|---|
| App name | Portfolio Cockpit for Jira (chosen by SUPERPORT in the portal; validated by Atlassian) |
| App ID | `ari:cloud:ecosystem::app/083d5c93-0586-481d-9c13-6e085bdfad84` |
| Hosting | Cloud, Forge, **Runs on Atlassian** (no egress; data in Jira and Forge storage; optional AI through Forge LLM, run by Atlassian) |
| Version to list | Production **4.3.0** (25 Nov 2026: licensing, personal data reporting, E2E fixes incl. all AI features; release notes below) |
| Product | Jira (Jira Software, Jira Service Management, Jira Work Management); Confluence optional (report publishing) |
| Payment model | Paid via Atlassian (manifest `app.licensing.enabled: true`; SUPERPORT's own site exempt via `LICENSE_EXEMPT_SITES` until it subscribes) |
| Categories | Project management; Data and analytics (the portal's current list) |
| Keywords | portfolio management, capacity planning, resource planning, waterline, ranking, roadmap, weekly planning, plan vs actual, time tracking, worklogs, C-level report, PMO |
| Vendor | SUPERPORT P.C. (IKE), Sorou 22, 151 25 Marousi (Athens), Greece · https://www.superport.digital |
| Support | mail@superport.digital · https://www.superport.digital/en/contact · working days 9:00–18:00 Athens time (DE/EN/GR), first response within 1 business day |
| Security contact | dev@superport.digital (see [SECURITY.md](../../SECURITY.md)) ⟦CONFIRM⟧ registered on ecosystem.atlassian.net |
| Status page | https://superapps.statuspage.io/ |
| Documentation URL | https://github.com/DevSUPERPORT/Portfolio-Cockpit-for-Jira#readme (public repository) |
| Privacy policy URL | https://www.superport.digital/apps/privacy (app notice: [PRIVACY.md](../../PRIVACY.md)) |
| EULA URL | https://www.superport.digital/apps/eula |

## Release notes (version 4.3.0)

> Every number in a Lotse story is now backed by its source, including the rank of the first project that cannot be
> fully staffed. KPI tiles open their breakdown above the tile near the bottom of the window, and plan vs actual tags
> are easier to read. Includes Marketplace licensing and Atlassian personal data reporting (4.0).

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

## Pricing (decided by SUPERPORT on 24 Nov 2026)

> SUPERPORT has since updated the prices in the partner portal; the portal is authoritative, this table may be outdated.

Set in the partner portal under *Pricing* (Cloud). Atlassian bills annual subscriptions at 10× the monthly price.
$2.00 per user at 11–100 users – twice the Workflow Analyzer's tiers, because the cockpit is a full planning product and
includes AI that SUPERPORT pays for:

| Users on the site | Price per user per month | Monthly total at the top of the tier |
|---|---|---|
| Up to 10 | **Free** | $0 |
| 11–100 | $2.00 | $200 |
| 101–250 | $1.40 | $410 |
| 251–1,000 | $0.80 | $1,010 |
| 1,001–2,500 | $0.30 | $1,460 |
| 2,501–5,000 | $0.20 | $1,960 |
| 5,001–7,500 | $0.12 | $2,260 |
| 7,501–10,000 | $0.10 | $2,510 |
| 10,001–15,000 | $0.08 | $2,910 |
| 15,001–25,000 | $0.06 | $3,510 |
| 25,001–35,000 | $0.04 | $3,910 |
| 35,001 and more | $0.02 | |

Every site can use up to 20 € of AI per month, paid by SUPERPORT (App Status can change it per site). Free trial:
Atlassian's standard 30 days.

## Question to Atlassian (ECOHELP, sent by SUPERPORT)

> **Subject:** Paid Forge app using Preview features – may it be listed?
>
> Hello, we are preparing the Marketplace listing of our Forge app *SUPERPORT Portfolio Cockpit for Jira*
> (app ID 083d5c93-0586-481d-9c13-6e085bdfad84, paid via Atlassian, Runs on Atlassian). It uses two features that the
> developer documentation marks as **Preview**: the Teamwork Graph scopes `read:graph:team:atlassian` and
> `read:graph:user:atlassian` (via `requestTeamworkGraph`, to read Atlassian Teams and their members as the signed-in
> user) and the `jira:workflowValidator` module. The release-phase page says Preview features are supported for
> production apps but does not mention Marketplace listings. Can a paid app that uses these Preview features be
> approved for the Marketplace, or should we remove them for the listed version? Thank you!

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

1. Done: Marketplace licensing on (`src/lib/license.js`), SUPERPORT's own site exempt during the review.
2. Done: personal data reporting (`report:personal-data`, `src/lib/privacy.js`, every 6 days).
3. ⟦OPEN⟧ Send the question above to Atlassian (ECOHELP); submit in parallel.
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
