# Demo data on superportdev (created 2026-11-23)

Large, realistic test data for Portfolio Cockpit, so testers can try every view with a lot of data and see how the
app scales. Everything lives in the sandbox space **PCX** (Portfolio Cockpit Sandbox) – no other space was touched.
Generator: `tools/demoSeed.browser.js` (seeded, reproducible).

## What exists

| Level | Keys | Count |
|---|---|---|
| Projects (type Project, in the portfolio, ranks 5–18) | PCX-71..84 | 14 |
| Workstreams | PCX-85..120 | 36 |
| Epics | PCX-121..239 | 119 |
| Stories and Tasks | PCX-240..964 | 725 (≈ 14,800 h Original Estimate) |
| Sub-tasks | PCX-965..1289 | 325 |
| Work items without a parent ("project unclear") | PCX-1290..1301 | 12 |
| Support tickets (Bug, IT-Support queue) | PCX-1302..1421 | 120 |
| **Total** | | **1,361** |

Plus: 410 status changes (past work mostly Done, current work In Progress; 15 % of past work left open = overdue),
81 time bookings (by the Dev Team account, on its own work and tickets), 140 "blocks" links (in order inside epics,
30 random across projects – some of them date conflicts).

### The 14 projects

| Key | Project | Lead team | Owner | Start → Due | Size |
|---|---|---|---|---|---|
| PCX-71 | ERP-Migration S/4HANA | Integration | Colleague A | 2026-05-04 → 2027-09-30 | XL |
| PCX-72 | Kundenportal Relaunch 2027 | Web | Colleague C | 2026-09-01 → 2027-06-30 | L |
| PCX-73 | Mobile App 2.0 | Mobile | Colleague B | 2026-10-05 → 2027-05-28 | L |
| PCX-74 | Data Warehouse Modernisierung | Data | Colleague A | 2026-07-01 → 2027-08-31 | XL |
| PCX-75 | Netzausbau Süd (Glasfaser) | Netz | Test Tester | 2026-03-02 → 2027-03-31 | XL |
| PCX-76 | IT-Security Programm ISO 27001 | Integration | Colleague C | 2026-08-03 → 2027-12-17 | L |
| PCX-77 | CRM-Konsolidierung | Web | Colleague A | 2026-04-06 → 2026-12-18 | M |
| PCX-78 | E-Rechnung (XRechnung/ZUGFeRD) 2027 | Integration | Colleague B | 2026-11-02 → 2027-01-29 | M |
| PCX-79 | Cloud-Migration Rechenzentrum West | Netz | Test Tester | 2027-01-11 → 2027-11-26 | XL |
| PCX-80 | Smart-Meter-Rollout | Netz | Dev Team | 2026-06-01 → 2027-10-29 | XL |
| PCX-81 | HR-Self-Service | UX | Colleague C | 2027-02-01 → 2027-07-30 | M |
| PCX-82 | Logistik-Tracking in Echtzeit | Data | Colleague B | 2027-03-01 → 2027-12-17 | L |
| PCX-83 | BI-Dashboard Vertrieb | Data | Dev Team | 2026-10-12 → 2027-02-26 | S |
| PCX-84 | Onboarding-Automatisierung | Web | Test Tester | 2026-02-02 → 2026-10-30 | S |

### Deliberate data problems (for testers to find)
- ≈ 6 % of stories without Original Estimate, ≈ 3 % without a start date, 10 with start after due.
- ≈ 3 % with neither team nor assignee; 45 % of stories assigned to a team only (backlog).
- 12 work items without a parent in a space with many projects → "No parent – project unclear".
- Overdue work: 15 % of past stories still open; Onboarding-Automatisierung (PCX-84) is past its due date.
- Teams Mobile and UX own work but have little or no maintained capacity → "work planned but no capacity".
- 30 random cross-project "blocks" links → some dependency conflicts.

### Site change made for this
The sandbox-only screen "PCX Project - create, edit, view - Screen 1.0" (id 10097, used only by PCX's Project type)
got 6 fields: Due date, Start date, Team, Labels, T-Shirt Size and Target Quarters (production app fields). Remove
them again under Jira settings › Issues › Screens if no longer wanted.

## Measured scale (live, dev install, 2026-11-23)
Self-test suite `scaleLive` (read-only), 15 projects / 1,215 work items / 732 stories, Browser visible:

| What | Before | After 3.30 | After 3.31 |
|---|---|---|---|
| Data load (browser → server → back) | 8.1 s | 6.0 s (server 4.5 s, hierarchy walk 3.6 s) | 3.6 s (server 2.5 s, hierarchy 1.7 s via Jira Plans) |
| Computation (computeAll) | 32 ms | 28–48 ms |
| Every view ready (My work … C-level report) | ≤ 2.6 s warm | ≤ 4.0 s, budget 4 s |
| Weekly board, 26 weeks by free capacity / all teams | – | 0.9 s / 1.1 s |
| Biggest project page (136 work items) | 1.1 s | 0.6 s |
| C-level report recomputed on the server | 1.0–8 s | 5.8 s |

Changes behind it: hierarchy searches sized to ~90 expected children with 8 in parallel; support, capacity and the
search for items without a parent run alongside the walk; after a release the page reloads once instead of failing
with "Failed to fetch dynamically imported module". The server's stage timings come back in `dataset.timing`.

3.31: on sites with Jira Plans the hierarchy below each project comes from ONE search (`portfolioChildIssuesOf`)
instead of one search per level. Guard: the projects' direct children must all be in the result, otherwise (or
without Plans, HTTP 400) the level walk runs as before (`dataset.timing.plans` says which). Live check (`scaleLive`):
an independent walk found the same 1,215 work items, each under the same project.

### Dev vs. production fields (since 3.33, 2026-11-24)
The demo data's T-shirt sizes, target quarters and ranks are in the PRODUCTION install's app fields (customfield_10209/10/11).
Until 3.33 the dev install read those as well (it could not tell the environments apart). Now every install uses its
own app fields – on the dev install the demo epics therefore show no T-shirt size (maturity "–"). Test sizing and the
waterline with the big data on the production install, or fill the dev fields in the dev app.

## Remove everything again
1. Remove PCX-71..84 from the portfolio (Portfolio › project › Remove).
2. Delete in Jira (bulk change): `project = PCX AND labels = pc-demo` (projects, epics, stories, sub-tasks, bugs),
   then the workstreams `project = PCX AND key >= PCX-85 AND key <= PCX-120 AND issuetype = Workstream`.
