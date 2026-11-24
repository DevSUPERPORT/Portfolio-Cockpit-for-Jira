# Tester guide – Portfolio Cockpit with the big demo data (superportdev)

Open: Jira › Apps › **SUPERPORT Portfolio Cockpit** (production install). The portfolio now has 18 projects and about
1,400 extra work items (see `docs/DEMO-DATA.md`). Everything lives in the sandbox space PCX; nothing you change there
affects real work. Every change the app writes can be undone (history button top right, Ctrl/⌘ Z).

Tip: write down what you did, what you expected and what you saw (screenshot), plus the work item key.

## 1 · First impression and speed
- Open the app fresh. How long until the Portfolio shows numbers? Switch through all tabs – does any take longer
  than ~3 s? Note which.
- Switch Weekly planning to 26 weeks and "By free capacity", then "All teams". Still smooth?
- Open the biggest project (ERP-Migration S/4HANA, PCX-71 – 4 workstreams, ~14 epics, ~90 stories plus sub-tasks):
  structure tree, Timeline, List.

## 2 · Portfolio and waterline
- Ranks 1–4 are the old projects, 5–18 the new ones (E-Rechnung rank 5 … Onboarding rank 18).
- Drag a project up/down (or Alt+↑/↓): does the waterline move, do Q4/Q1 cells change colour? Undo it.
- Hover a red quarter cell: does the card explain the missing hours by team?
- "Planning maturity": open the drill-down; epics with T-shirt size but few stories should show up.

## 3 · Projects (data quality and action needed)
- **Onboarding-Automatisierung (PCX-84)** is done; **Glasfaser Nord – Pilot** is past due – both should say so.
- Find stories **without estimate**, **without start date**, **start after due** (10 of them), **without team** –
  the "Missing values" list and the tree chips should show them; fix one via the app and check Jira.
- **No parent** (PCX-1290..1301): "No parent – project unclear" in Action needed; use "Set parent" on one, then undo.
- Dependencies: 140 "blocks" links; some cross-project ones start before their blocker ends → conflict marks.

## 4 · Teams and capacity
- Teams **Mobile** and **UX** own work (Mobile App 2.0, HR-Self-Service) but have little or no maintained capacity:
  expect "work planned but no capacity" instead of ∞.
- People in several teams: the multi-team callout, Lotse "Resolve multi-team conflicts" (preview only!).
- Teams › Maintain capacities: change a weekly hour value, watch the waterline, then undo.

## 5 · Weekly planning
- Red weeks: "Why?" on a red head explains the hours; the Lotse fixes (split, move, hand over) only stage changes.
- Drag a card to another week/person; check the pending list; **discard** (or apply on a sandbox story and undo).
- Optimize: try each mode; nothing is written until "Apply in Jira".

## 6 · Support
- 120 new tickets (PCX-1302..1421) in the IT-Support queue: Dispatch (Lotse proposes assignees), Tickets list
  (opens on "All open" since there are no JSM SLAs), Time, Capacity reserve.

## 7 · My work, Plan vs. actual, report
- My work (as the Dev Team account): 80+ booked hours on demo work, the 8-week strip, "Complete the week".
- Plan vs. actual: weeks 46–48; team chips must show names (not ids).
- C-level report: Compose with Lotse → PDF; numbers must match the Portfolio tab.

## 8 · Lotse and Ask
- Ask Lotse: "Who is overloaded?", "Why is E-Rechnung late?", "Fälligkeit PCX-300 in 2 Wochen" (preview → apply →
  undo), "What if Mobile App 2.0 starts 4 weeks later?".
- Ask canvas (header "Ask"): ask several questions quickly – cards must not overlap; Esc closes full screen.

## Reporting a finding
Key + view + steps + expected/actual + screenshot. Severity: blocker (wrong number / data loss), major (feature
broken), minor (wording, layout).
