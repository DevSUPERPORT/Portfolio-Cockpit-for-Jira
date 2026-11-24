# Calculation decisions – please confirm

Every number in the cockpit comes from `shared/engine.js`. These are the places where the brief is silent or ambiguous and I had to choose. For each one:
- **Now** is what the code does today.
- **Recommend** is my suggestion.
- Answer with the ID and A/B, e.g. "D3 B". Unanswered items keep **Now**.

The golden dataset (`tests/golden/`) pins every decision with expected values, so a change shows up as a failing line.

## Progress, maturity, T-shirt sizes

**D1 – Time Spent: stories only, or stories plus sub-tasks?**
- Now (A): the Story's own Time Spent; worklogs booked on sub-tasks are not counted in progress.
- The brief says sub-tasks have no time tracking, and lock mode deletes such worklogs. Without lock mode, though, existing sub-task worklogs would be missing from progress.
- Recommend B: use the aggregate (story plus its sub-tasks).

**D2 – Stories without dates: how do they consume T-shirt size?**
- Now (A): their Original Estimate (OE) is booked into the first current or future target quarter of their workstream.
- B: they consume nothing until dated, and are flagged in data quality.
- Recommend A, because it avoids double-counting demand.

**D3 – How is a story's OE split across quarters (for open T-shirt size)?**
- Now: by the configured distribution rule (default: linear over working days between start and due).
- No alternative is proposed; please just confirm.

**D4 – T-shirt hours across quarters**
- Now: hours ÷ number of target quarters, counting past quarters too. Past-quarter shares that were never estimated "expire" and only show as a hint, as the brief says.
- Please confirm that past quarters count in the divisor.

**D5 – Project Due Date**
- Now (A): the portfolio item's own due date, otherwise the latest story due date.
- B: always the latest story due date.
- Recommend A.

## Demand and capacity

**D6 – Remaining Estimate (RE) of overdue stories**
- Now (A): booked entirely on the next working day, so it lands in the current week and quarter.
- B: spread over the next N weeks.
- Recommend A; it's visible and honest.

**D7 – RE of stories without a due date**
- Now: counted in the current quarter; not shown in the weekly heatmap except in week 1.
- Recommend: keep, but show an "unscheduled" bucket in the waterline detail.

**D8 – Quarter capacity formula**
- The brief's UC-11 says: weekly hours × 12 − daily business %.
- UC-14 adds an absence rate per team.
- Now (A): weekly × 12 × (1 − daily %) × (1 − absence rate %) − support reserve.
- B: ignore the absence rate in quarters, and use real absences only.
- Recommend A.

**D9 – Weekly capacity**
- Now: hours × (working days minus holidays and absences) ÷ 5 × (1 − daily %) − the person's support share.
- The absence rate is **not** applied here (real absences are used instead, to avoid double-counting).
- Please confirm.
- **Decided 2026-11-09 (D9b):** the weekly view also deducts **internal work** ("Intern %", a new team setting, default 0). It is a share of the gross hours, like daily business: 40 h − 20 % − 10 % = 28 h.
  - Asked for by management: "10 % internal" belongs in the weekly total.
  - The quarter formula becomes weekly × 12 × (1 − daily % − internal %) × (1 − absence rate %) − support reserve.
  - The absence rate stays a quarter-only allowance for leave and sickness.

**D10 – Support reservation per quarter**
- Now: average weekly support Time Spent (4 or 8 weeks) × 12.
- If the last 2 weeks are more than 20 % above that average, the 2-week average is used instead ("the reservation follows").
- Please confirm.

**D11 – Open T-shirt demand of a workstream without a lead team**
- Now (A): goes to a "No team" row with no capacity, so it is never staffable.
- B: spread proportionally over the teams already working in the project.
- Recommend A, plus a data-quality flag (already in place).

**D12 – A person's team when capacity is not maintained**
- Now: the team holding most of their remaining work, at the default 40 h/week.
- Please confirm, or choose: exclude these people until they are maintained.

**D13 – Waterline status thresholds**
- Now:
  - Staffable if cumulative demand ≤ capacity (with 0.01 h tolerance).
  - Partial if capacity falls inside the project's block.
  - Not staffable otherwise.
- Please confirm.

## Time vs. estimate

**D14 – Estimated hours in a period**
- Now: story OE spread by the distribution rule. Stories without start and due dates are left out.
- Recommend: keep, and show "n stories without dates not counted".

**D15 – Team attribution of logged hours**
- Now: the story's team. Sub-task worklogs inherit the parent story's team. Persons are the worklog author.
- Please confirm. An alternative is the author's capacity team.

## Dependencies

**D16 – Direction for every configured link type**
- Now: the issue on the *outward* side is the prerequisite (A "blocks" B).
- This is wrong for link types whose outward verb means the reverse (e.g. "is blocked by" used as the outward name).
- Recommend: a direction toggle per link type in the configuration.

**D17 – When is a dependency open?**
- Now: open while **both** sides are not done. A conflict is open, and the prerequisite's due date is strictly after the dependent's start date.
- Please confirm.

**D18 – Which note is shown**
- Now: the dependent item's note, otherwise the prerequisite's note.
- Please confirm.

## Report and ranking

**D19 – Average utilization in the C-level report**
- Now (A): unweighted mean over teams for the next 8 weeks.
- B: capacity-weighted (total plan ÷ total capacity).
- Recommend B. It can't be skewed by a tiny team.

**D20 – "Portfolio Rank" field value vs. the rank a user sees**
- Now: the field holds the *global* rank, including projects a user cannot see, while the app shows ranks renumbered without gaps over the visible ones.
- So a user can see rank 2 while the field says 3.
- Recommend: keep the global value in the field, and show "global rank 3" in a tooltip when the two differ.

**D21 – Schedule status in the report**
- Now:
  - Late if the project is past its due date.
  - At risk if it has open conflicts or any quarter is not fully staffable.
  - On track otherwise.
- Please confirm.

---

## Resolved (2026-11-02, by the product owner)

| ID | Decision | Implemented |
|---|---|---|
| D1 | Time Spent = story **+ sub-tasks** | engine `projectMetrics`; test "D1" |
| D2 | Undated OE → first open target quarter (kept) | unchanged; golden |
| D3, D4, D9, D10, D12, D13, D15, D17, D18, D21 | Confirmed as described | unchanged; golden + property tests |
| D5 | Project's own due date, else latest story (kept) | unchanged |
| D6 | Overdue RE on the next working day (kept) | unchanged |
| D7 / D14 | Show an explicit **"unscheduled"** amount | waterline detail chip; time-vs-estimate note; tests "D7/D14" |
| D8 | Apply absence rate to quarter capacity (kept) | unchanged; golden |
| D11 | "No team" row for workstreams without a lead team (kept) | unchanged; golden |
| D16 | **Direction toggle per link type** | config `dependencies.reversedLinkTypeIds`; admin UI; test "D16" |
| D19 | **Capacity-weighted** average utilization | `cLevelReport`; test "D19" |
| D20 | Visible rank, **global rank on hover** when it differs | dataset `globalRank`; ranking tooltip |
| R1 | Report publishing only into **admin-approved Confluence spaces** | config `report.publishSpaces`; enforced in `report.publish`; admin UI |
