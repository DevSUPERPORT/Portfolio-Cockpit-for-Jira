# Performance baseline – 2026-11-12

Measured with `npm run perf` (`tests/perf/perf.test.js`, harness `tests/perf/harness.js`) on the developer laptop
(Windows 10, Node 24.18, `--expose-gc`), datasets from `tools/bigDataset.js`. Timings are wall-clock ms. Runs per size:
S 5, M 3, L 2 (optimizer at most 2), one warm-up where noted in the harness. "heap Δ" is the heap growth during one
call after a forced GC. The raw numbers of the last run are in `tests/perf/last-run.json`. The regression guard is in
`tests/perf/baseline.json`: a run fails when an operation is more than 3× slower than its recorded value.

## Datasets (deterministic, seeded)

| size | work items | projects | teams | people | stories | worklogs | links | tickets (open) | generate | heap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| S | 1 999 | 40 | 15 | 150 | 1 349 | 3 582 | 30 | 5 000 (165) | 0.2 s | ~7 MB |
| M | 9 883 | 80 | 25 | 300 | 6 759 | 16 204 | 167 | 10 000 (303) | 0.3 s | ~24 MB |
| L | 49 142 | 150 | 40 | 600 | 33 785 | 66 229 | 916 | 20 000 (628) | 3.1 s | ~101 MB |

## Budgets we aim for

These are product goals, not what we measure today. The status column below shows how far away we are.

- **Interaction: under 100 ms.** Lotse questions once the panel is open.
- **Panel open: under 300 ms.** The first Lotse answer, "Heute für dich", what-if, realistic capacity.
- **Board: under 1 s on L.** The team board and the all-teams board.
- **Data load (`computeAll`): under 2 s on L.** Also under 1 s on M.
- **Optimizer click: under 1 s for one team, under 2 s for all teams on L.**

## Measured (p50 / p95 ms)

| size | operation | p50 ms | p95 ms | heap Δ MB | budget ms | status |
|---|---|---:|---:|---:|---:|---|
| S | computeAll | 124 | 195 | 14 | 300 | ok |
| S | buildBoard team | 15 | 18 | 5 | 300 | ok |
| S | buildBoard all | 34 | 69 | 8 | 300 | ok |
| S | optimizeAll team | 456 | 456 | 30 | 300 | **1.5× over** |
| S | optimizeAll all | 557 | 557 | 33 | 500 | **1.1× over** |
| S | realisticCapacity | 162 | 338 | 21 | 300 | p95 over |
| S | lotse ask cold | 520 | 664 | 36 | 300 | **1.7× over** |
| S | lotse ask warm (20 q) | 13 | 149 | – | 100 | p95 over |
| S | lotse briefing | 201 | 361 | 63 | 300 | p95 over |
| S | lotse whatIf | 14 | 26 | 5 | 300 | ok |
| M | computeAll | 457 | 565 | 49 | 1000 | ok |
| M | buildBoard team | 79 | 95 | 19 | 500 | ok |
| M | buildBoard all | 290 | 422 | 25 | 500 | ok |
| M | optimizeAll team | 939 | 939 | 62 | 1000 | ok |
| M | optimizeAll all | 946 | 946 | 66 | 1000 | ok |
| M | realisticCapacity | 326 | 639 | 62 | 300 | **1.1× over** |
| M | lotse ask cold | 2230 | 2439 | 68 | 300 | **7.4× over** |
| M | lotse ask warm (20 q) | 41 | 805 | – | 100 | p95 over |
| M | lotse briefing | 1017 | 2557 | 57 | 300 | **3.4× over** |
| M | lotse whatIf | 104 | 138 | 14 | 300 | ok |
| L | computeAll | 5615 | 5615 | 41 | 2000 | **2.8× over** |
| L | buildBoard team | 696 | 696 | 14 | 1000 | ok |
| L | buildBoard all | 2048 | 2048 | 34 | 1000 | **2.0× over** |
| L | optimizeAll team | 13348 | 13348 | 49 | 1000 | **13.3× over** |
| L | optimizeAll all | 8702 | 8702 | 107 | 2000 | **4.4× over** |
| L | realisticCapacity | 1953 | 1953 | 66 | 300 | **6.5× over** |
| L | lotse ask cold | 5117 | 5117 | 72 | 300 | **17.1× over** |
| L | lotse ask warm (20 q) | 112 | 1401 | – | 100 | **1.1× over** |
| L | lotse briefing | 2128 | 2128 | 53 | 300 | **7.1× over** |
| L | lotse whatIf | 170 | 170 | 46 | 300 | ok |

Notes:

- **What "lotse ask cold" measures.** The first question ("Was ist heute wichtig?") on a fresh `computed` object. Lotse's
  per-dataset memo (`kit.js memo`: realistic capacity, overtime) starts empty, as it does on panel open.
- **The slowest warm questions** (p95 of the 20) are "Was ist heute wichtig?", "Welche Support-Themen kommen immer wieder?"
  and "Wo fehlen Daten?". On M they take 0.7–0.9 s, on L 1.3–1.8 s, every time. Their work is not memoized (see hotspots 1
  and 2).
- **L numbers come from only 2 runs.** `computeAll` on L varied between 2.0 s and 5.6 s across runs because of GC
  pressure. Use the p50 of several `npm run perf` runs before you raise or lower the guard.
- **The Lotse fixture is fast.** The golden set (364 questions on `tests/lotseFixture.js`, 8 projects) answers each ask in
  5–6 ms at p50, 22–45 ms at p95 and 170–360 ms at worst (the cold first ask). The latency problem is scale, not the
  skills themselves.

## Top 5 hotspots (function level, with evidence)

Evidence came from `node --cpu-prof` on M: `computeAll`, `buildBoard` all teams, `optimizeAll` for one team, then
`ask(overtime)` and `briefing`. Self and inclusive times were summed per function. A second profile covered 12 warm asks
on M ("Wo fehlen Daten?", support topics, "Was ist heute wichtig?"). Function-level timers checked each `computeAll` part
on M.

1. **`insights.supportTopics` (`shared/insights.js:495`) runs again on every ask. It is not memoized.**
   - The `supportTopics` skill (`skills/supportTopics.js:17`) calls it, and so does `today` (`skills/today.js:60`). Each
     call re-tokenizes every ticket: `words` (`insights.js:96`) and `fold` (`insights.js:92`) on 10k–20k tickets plus the
     history.
   - Warm profile on M: 2.4 s inclusive over 12 asks. That is 852 ms self in `supportTopics`, 575 ms in `fold` and 1.1 s
     in `words`, the largest share of all warm-ask time.
   - Fix: memoize per dataset through `kit.memo` (keyed by tickets plus history), or tokenize once per ticket.
2. **`gapsFix` suggestions (`skills/gapsFix.js:16 suggestFor`) rebuild a TF-IDF index (`insights.similarWork:417`, `tfidf:112`) for every gap.**
   - Warm profile on M: 1.0 s inclusive in `gapsFix.run`, of which `similarWork` is 725 ms and `tfidf` 586 ms.
   - On L, "Wo fehlen Daten?" takes 1.8 s every time.
   - Fix: build one index per dataset and query it per gap.
3. **Realistic capacity and person capacity (`insights.realisticCapacity:264`, then `engine.personCapacityIn:311`, then `locations.personDays:143` and `holidays.holidaysBetween:104`).**
   - Holidays and working days are resolved again for every person × week × call. The same pattern sits in
     `weeksUtilization` (`engine.js:401`, 163–267 ms on M) and `weekPlan.personWeekAvail:160` (176 ms inclusive on M).
   - CPU profile on M: `personDays` 281 ms inclusive, `holidaysBetween` 86 ms self, `capacityPeople` 97–182 ms self.
     `realisticCapacity` alone takes 1.95 s on L and drives the cold first ask (5.1 s on L) and the briefing.
   - Fix: cache `holidaysFor(location, quarter)` and the workday counts per location and week.
4. **`computeAll` support part and date parsing (`engine.supportTicketAnalytics:810`, then `sla.supportAnalytics:62` / `ticketSla:39`; `dates.dayIdx:5`).**
   - Function timers on M: `supportTicketAnalytics` takes 475 ms, which is 40 % of `computeAll`'s parts. The other parts:
     project metrics 209 ms, `dataQuality` 146 ms, `weeksUtilization` 163 ms, `milestoneStatus` 83 ms, `waterline`
     62 ms.
   - `dayIdx` (a regex plus `Date.UTC` per call) has the highest self time in both profiles: 333–358 ms on M. `isoOf` is
     close behind at 136–169 ms.
   - Fix: business-hours SLA per ticket only for open or recent tickets; a `Map` cache for `dayIdx` on ISO strings, or
     day indices stored once at load.
5. **The optimizer (`optimize.optimizeAll:510`, then `runSmooth:243`, `stateOf:158`, `runRebalance:336`, `runSooner:438`).**
   - On M it takes 997 ms inclusive. `runSmooth` alone is 478 ms, and `stateOf` 177 ms rebuilds per-person week state on
     each pass.
   - On L one team takes 13.3 s, 13× the 1 s click budget. That is the worst gap in the table.
   - Fix: incremental state (update only the two people a move touches), and a horizon cap per team.

Smaller items:
- `today.evidenceFor` (`skills/today.js:18`) runs `crosscheck.textClaims` (`crosscheck.js:50`) for every candidate story:
  311 ms inclusive on M (warm).
- `ask.js ticketsOf` / `poolOf` (`ask.js:706/714`) rebuild ticket pools on every ask: 244 ms on M.
- `buildBoard` all teams is 2.0 s on L, twice its budget. It shares hotspot 3 (`personWeekAvail`).

## How to run

```bash
npm test                                        # includes the fast S smoke (tests/perfSmoke.test.js, ~6 s)
npm run perf                                    # S, M and L (~3 min), prints the table, writes tests/perf/last-run.json
PERF_SIZES=S,M npm run perf                     # only some sizes
PERF_WRITE_BASELINE=1 npm run perf              # record the new p50s as the regression guard (tests/perf/baseline.json)
node tools/bigDataset.js L                      # dataset summary; `node tools/bigDataset.js M out.json` writes it
```

To check the UI locally on a big dataset, open the dev UI with `?mock&big=S|M|L`, for example
`http://localhost:5179/?mock&big=L`. In this mode `static/cockpit/src/lib/mock.js` imports `tools/bigMock.js`, and
`bootstrap` and `dataset` serve the generated dataset (dates relative to the real today) instead of the demo company.
Without the parameter nothing changes, and production bundles never contain the mock.

## After the speed work (2026-11-12, same laptop, `npm run perf`, other jobs running in parallel – L varies ±50 %)

Results are unchanged: `tests/lotseResultsUnchanged.test.js` hashes every hot path's output (computeAll and its parts,
both boards, the optimizer, realistic capacity, 20 Lotse answers asked twice, the briefing, a what-if) on S – and on M
and L with `PERF_RESULTS=M,L` – against `tests/perf/fingerprints.json`, recorded before the work (Date.now pinned).
`tests/lotseComputeWorker.test.js` proves the browser worker path gives the same object as `computeAll`.

| L operation | before p50 | after p50 | budget | status |
|---|---:|---:|---:|---|
| computeAll (runs in the Web Worker in the browser) | 5615 | 1217 | 1500 in worker | ok |
| worker extras for Lotse (realistic capacity, overtime, topics) | – | 1171 | – | off the main thread |
| main thread: assemble the worker result (model, rows) | – | 128 total, longest step 31 | 50 per step | ok |
| buildBoard team | 696 | 829 | 1000 | ok |
| buildBoard all | 2048 | 493 | 1000 | ok |
| optimizeAll team | 13348 | 2292 | 3000 | ok |
| optimizeAll all | 8702 | 2547 | 2000 | 1.3× over |
| realisticCapacity | 1953 | 522 | 300 | 1.7× over (precomputed in the worker) |
| lotse ask first, after the worker (seeded) | 5117 (cold) | 129 | 300 | ok |
| lotse ask cold, nothing precomputed | 5117 | 1025 | 300 | 3.4× over (not the browser path) |
| lotse ask warm (20 q) p50 / p95 | 112 / 1401 | 16 / 58 | 100 | ok |
| lotse briefing (cold, with history) | 2128 | 619 | 300 | 2.1× over |
| lotse whatIf | 170 | 165 | 300 | ok |

M: computeAll 457 → 499 (noise), optimizer team 939 → 879, ask cold 2230 → 577, first ask after worker 101, warm p95
805 → 37. S: all budgets met except the cold first ask (783 – the browser computes S in place, not in the worker).

What changed (hotspots 1–5 and the smaller ones):

1. **Support topics**: `insights.words` memoized per text; `supportTopics` memoized per frozen ticket list (ask.js
   `ticketsOf` / `poolOf` build their lists once per data state and freeze them); the worker ships the topics.
2. **gapsFix / similar work**: one TF-IDF index per pool (`similarWork` → `poolIndex`), a query weighs only the stories
   that share a word, with the same df/N and the same order (exact).
3. **Working days**: `personDays` caches holidays + working days per resolved location and span, absences indexed per
   person; `estimateFactors` per team once; optimizer `lastWorkday` / `firstWorkday` cached per locations list.
4. **Dates / support / computeAll**: `dayIdx` / `isoOf` integer arithmetic (exhaustively equal to the Date path),
   SLA holiday sets per year range, the ticket sort without `localeCompare` per comparison (same collation),
   `milestoneStatus` with a version index, `capacityPeople` primary teams per model, data-quality rows read once, one
   project's data quality via `model.byRoot`.
5. **Optimizer**: windows tried without building Maps (`fitsWin`), weeks per window cached, names / hidden / team
   colleagues once per run, the engine's dependencies reused.
   Plus: `teamDetails` with a per-model index (the Team view computes it for every team), entity patterns of
   `findProject` / `findTeam` / people built once, `crosscheck.textClaims` skips names not in the text.

Browser (`?mock&big=L`, dev build, preview pane, other agents' builds running): the worker computes in 1.9–7 s (dev,
unminified, varies with load), the main thread only clones 250-item slices and assembles in ≤ 31 ms steps; the
numbers on screen stay until the new ones are ready ("rechnet …"). Lotse in the page after the compute: briefing 30 ms,
asks 5–136 ms (en, seeded); de (not seeded, first time) 4.4 s, then 15–250 ms. Support › Tickets › Gelöst: 19,372 rows
windowed (38 in the DOM), scroll p50 frame 17 ms – but React re-renders while scrolling still give 50–470 ms long tasks,
and the first render of the views after a compute is 2–7 s on the main thread (view code, not computeAll). Not fixed:
these renders (App, Lotse panel, Portfolio tiles), `optimizeAll all` and the cold briefing with history.

## Second round: view renders, scrolling, acts, cold Lotse, optimizer (2026-11-12, same laptop)

`npm run perf` after the round (one run, L 2 runs per row; other agents' builds and preview tabs running). Results are
still unchanged: `npm test` (543 green, incl. the new `tests/speedExact.test.js`) and the fingerprints on S, M and L
(`PERF_RESULTS=M,L`). New rows in the harness: "(new data)" = a fresh `computeAll` per run (nothing of this data state is
cached – the worst case); the plain rows use a new computed object of the same data state (what the panel sees again).

| L operation | round 1 p50 | now p50 | budget | status |
|---|---:|---:|---:|---|
| computeAll (in the worker) | 1217 | 956 | 1500 in worker | ok |
| optimizeAll all | 2547 | 1625 | 2000 | ok |
| optimizeAll team | 2292 | 2126 | 3000 (round 1) / 1000 (harness) | the team run still plans every person's tasks |
| realisticCapacity (same data, new computed) | 522 | 142 | 300 | ok |
| realisticCapacity (new data) | – | 464 | 300 | 1.5× over (the browser gets it from the worker) |
| lotse briefing (same data) | 619 | 236 | 300 | ok |
| lotse briefing (new data) | – | 550 | 300 | 1.8× over (not the browser path: the worker seeds it) |
| lotse ask first, after the worker | 129 | 95 | 300 | ok |
| lotse ask in the other language than the worker (DE after EN) | 4400 in the page | 175 | 300 | ok |
| lotse ask cold (new data) | 1025 | 570 | 300 | 1.9× over (not the browser path) |
| lotse ask warm (20 q) p50 / p95 | 16 / 58 | 9 / 89 | 100 | ok |
| lotse act route (20 q + 3 commands) p50 / p95 | ~600 per ask in the page | 0 / 1 | 50 | ok |

M: optimizer all 946 → 503, briefing 141, ask in the other language 97. S: every row ok except the first-run JIT outlier
of "ask cold" (p95 368).

Browser (`?mock&big=L`, dev build; React Profiler ids from `<Prof>` (lib/virtual.jsx) in `window.__pcRenders`, long tasks
from a PerformanceObserver; the laptop was shared with other agents' preview tabs, so absolute times vary 2–3×):

| interaction | before | after |
|---|---|---|
| main-thread long tasks in the 5 s after the numbers arrive | 3278, 274, 305, 217, 1606, 155, 149, 102, 1241 ms + ~40 of 50–90 ms + 929 ms | 0–3 of 100–450 ms (three runs: 114/78 · 191/450/293 · 103) |
| Portfolio: render of the 150 rows | 6024 ms in one go (+ 3414 and 1865 ms repeats) | first 24 rows 230–455 ms, the rest in idle transition steps |
| Portfolio: first rows on screen after the numbers arrive | +7.3 s (after one 3.3 s task) | +0.4–1.2 s |
| Teams first visit (render) | 6020 ms | 1868 ms – of it WeekBoard 1219 ms (see below) |
| Projects first visit (render) | 3303 ms | 1780 ms – WeekBoard 632, structure 426 |
| Support first visit (render) | 3184 ms incl. the chunk load | 998 ms – SupportDispatch 891 ms (see below) |
| Support › Tickets › Gelöst (19,372 rows), scrolling | ~1 render per 2 scroll steps, 200–1040 ms each | 1 per 6–10 steps, 150–540 ms each |

What was slow and why, and the fixes:

1. **First render after a compute.** The portfolio rows asked `waitsFor(computed)` once per row (150 × 8 ms) and filtered
   all dependencies per row; the live waterline was recomputed though the order was the computed one; the order effect
   set a new array on mount (a second full render); 150 rows with drag and motion mounted in one go. Now: the worker
   result renders as a `startTransition` (state.jsx – React yields to input), `waitsFor` and the conflicts once per
   computed, the computed waterline reused when the order on screen is the computed ranking (exact, see
   `tests/speedExact.test.js`), memoized rows with stable handlers, rows in idle steps (`useProgressive`: 24, 48, 96, …)
   and no entrance motion for rows below the first screen. Teams: `teamDetails` kept per computed and team, waterline
   rows indexed (all teams 576 → 235 ms, then 0), the team tiles memoized; `personWeek` / `teamWeekItems` / `teamWeeks`
   read a per-model index of open stories ("Meine Arbeit"'s 8 weeks 357 → 7 ms). Projects: the 150 pills count urgent
   gaps and conflicts in one pass; `actionItems` indexes absences per person and reads the people once per model
   (150 projects 1.1–2.5 s → 0.26 s). Header: `smartSuggestions` once per computed ("Heute zu tun" 125 → 44 ms).
2. **Scrolling the support list.** Every window change rendered every visible row again (no memo) and each row mounted a
   motion SLA bar. Now the window moves in blocks of 8 rows (8× fewer renders), rows are memoized (`TicketRow`), and rows
   past the first 60 use the same SLA bar markup without motion.
3. **act/bulk.js.** Every ask and every keystroke of the search built 600 person and 40 team regexes, scanned 50k work
   items per key in the text and – for an unscoped field command – ran one selection per project (150 × 50k). Now a
   sentence without any command word returns at once (the gate lists what every branch needs), people, teams and keys are
   indexed once per data state, one selection is counted per project, and one numeric collator sorts the keys.
4. **Cold Lotse.** Realistic capacity is kept per data state, and the other language is re-worded from the same numbers
   (`relangCapacity`; the worker ships the unrounded rooms); support topics likewise. The history-free parts (the engine's
   weekly availability, the open work per week, each person's weekly availability, the estimate factors) are kept per
   model. The briefing is kept per computed result and inputs (the Today strip asked again on every context rebuild – once
   2 s in the page).
5. **Optimizer.** Start and due as day indices once per task (no re-parsing in sorts and loops), shifts on day indices,
   ISO week numbers and last working days once per horizon week and location, the issue Map reused when no move is pending.

Left, with evidence:
- **WeekBoard.jsx (components, not edited here)** is the largest part of the Teams (1219 of 1868 ms) and Projects (632 of
  1780 ms) first render, with a 725 ms commit task on Teams; `buildBoard team` itself is 249 ms on L.
- **SupportDispatch.jsx (components)**: 891 of the 998 ms first render of the Support view.
- Support scrolling still has 70–600 ms tasks in the dev preview: each new row costs ~10–30 ms to mount there (dev React,
  shared CPU); the block size is `STEP` in lib/virtual.jsx. Not measurable on a production build (the big mock is dev-only).
- A 50–170 ms task about every 2 s on the page with no React commit behind it (the Profiler shows none) – not from the views.
- `optimizeAll team` (2.1 s) still plans every person's tasks of all teams (so a task gets the same suggestion on every
  board); a per-team horizon would change results.

## Third round: board, optimizer, Support, tab switch (2026-11-12 evening, same laptop)

Results are unchanged: `npm test` 563/563 (incl. `tests/speedExact.test.js` and the S fingerprints), the M and L fingerprints
(`PERF_RESULTS=M,L`, 3/3), and an extra check that hashes `optimizeAll`'s full output for 28 cases per size (4 teams, all
teams, one project, pending moves; even and capacity distribution; target 100 % and 85 %) plus 4 team boards – identical
on S, M and L (32/32 each) against the code before this round.

The laptop was at 100 % CPU from other programs the whole time (a disk-wide `find`, another project's Forge deploy).
Absolute numbers vary 2–3×; code this round did not touch got slower in the same `npm run perf` run (L realistic
capacity 142 → 863 ms, L computeAll 956 → 1149 ms). So the L figures below come from **head-to-head runs in one
process** (old and new module alternating, each call on a fresh work-item array so no cache helps), and the browser
figures from **two dev servers side by side** (the code before and after this round, alternating, same load).

| measure (L unless noted) | before | after | how |
|---|---:|---:|---|
| `optimizeAll` one team, first call – CPU median | 1953 ms | 1203 ms | Node A/B, 5 rounds |
| `optimizeAll` one team, same data again – CPU median | 1953 ms | 906 ms | the panel's second call, the card menu |
| `buildBoard` one team – CPU median | 547 ms | 234 ms | Node A/B, 7 rounds |
| `optimizeAll` one team – `npm run perf` p50, M / S | 635 / 130 ms | 262 / 47 ms | harness |
| `buildBoard` one team / all – `npm run perf` p50, M | 65 / 89 ms | 45 / 68 ms | harness |
| Teams first visit: WeekBoard first render | 1462–1737 ms | 233–393 ms (first 4 rows; the rest in idle steps, 562–831 ms) | browser A/B, 3 runs each |
| Support first visit: Dispatch first render | 468–599 ms | 172–260 ms | browser A/B, 3 runs |
| Support first visit: longest task | 262–366 ms | 79–184 ms | browser A/B |
| Dispatch: tick one row's checkbox | 286–384 ms render | < 17 ms | browser A/B, 3 clicks |
| Dispatch: team filter on / off | 319 / 479 ms render | 121 / 129 ms | browser A/B |
| Support › Tickets › Resolved (19,372 rows): scroll 6,000 px (12 window moves) | 2.6–2.9 s render, 15 long tasks, longest 344–368 ms | 0.29–0.39 s, 6 long tasks, longest 70–138 ms | browser A/B, 2 runs |

What was slow and why, and the fixes:

1. **Number and date formatting** (`lib/i18n.js`). Every `fmt.h` / `fmt.n` / `fmt.pct` / `fmt.date` built a new
   `Intl` formatter: 125 µs (number) and 246 µs (date) per call against ~2 µs with a kept one – a board card formats
   about eight values. Formatters are now kept per locale and options (same output).
2. **Tab switch forced the page's layout mid-commit** (`components/TabScroller.jsx`). Keeping the active tab in view
   read `offsetLeft` / `scrollLeft` right after the commit, before the new area was laid out: 230–380 ms of layout in
   the middle of the switch (and again later). It now reads one paint later, when it is free.
3. **"Heute zu tun" built its whole drawer on every app render while closed** (`components/Inbox.jsx`, one row per
   project). Built only while open.
4. **The week board** (`components/WeekBoard.jsx`, `lib/virtual.jsx`). A big team's board rendered every row in one go.
   Rows now render progressively (first 4, then doubling in idle transitions; `useProgressive` got a `reset` key so a
   team switch starts small again). `buildBoard` (`shared/weekPlan.js`): `conflicts()` reuses the engine's
   `computed.deps` (and the model's `byId`) when nothing is pending – it rebuilt a 50k Map and the whole dependency list
   per board; `planTasks` skips windows wholly outside the board weeks before the per-week work (`weekShare` is 0 there).
5. **The optimizer** (`shared/optimize.js`), all exact:
   - the even split of every task, the work-item index and the pseudonymised set are kept per work-item array (the
     panel's second call and the card menu reuse them); each person's weekly availability per model and configuration;
   - the weeks a window touches: `workdays(max(mo, s), min(mo + 6, e)) > 0` is the same as `max(mo, s) ≤ mo + 4`
     (weekdays, no holidays); kept as horizon week indices under a small-integer key (the old key, ~2·10¹⁰, was a heap
     number);
   - the fit check without an array per try (473k tries for one team on L), the over-target scan without
     `map`/`filter`, the dependency check returns at once for tasks without a blocks link (most), the hard limit is read
     once per project and milestone, key tie-breaks use the default collator (exactly `localeCompare()`).
   The optimizer must still plan **all** people: on L the people connected to one team (shared teams, blocks links)
   are all 600, so planning fewer would change suggestions.
6. **Support › Dispatch** (`components/SupportDispatch.jsx`, `Support.css`). Every row was a framer `layout` element:
   framer measured all 60 rows on every render (240 ms in `measureDocumentScroll`), every row rendered 40 team options
   (~2,400 option elements), and a checkbox re-rendered all rows. Now: a memoized row with stable handlers; a select
   that holds only its chosen option until it is pressed, focused or typed into (`flushSync` fills in every option before
   the browser opens the list – 159 options on the page instead of ~2,400); the entrance is a CSS rise staggered like
   `enter()`, and reordering glides with a small FLIP that measures only when the row order changes.
7. **Support › Tickets scrolling** (`views/Support.jsx`). The closed "Link to project" picker filtered every project
   and built every target button on each render of the ticket list – ~70 ms per window move on L. It is mounted only
   while a ticket is chosen now (the closed Modal rendered nothing anyway; its search starts empty on each opening).
8. **The waterline wave** (`views/Portfolio.jsx`, `styles.css`): framer animated the SVG `x` attribute in JS on every
   frame, endlessly (also with reduced motion). Now a CSS transform loop on the compositor (same path: 40 units / 2.2 s).

Left, with evidence:
- **`optimizeAll` one team on L is still above 1 s on the first click** (~1.2 s CPU under load). Its work is all 600
  people by design (see above). The way to an instant click is to run it in the compute worker, which already holds the
  same data – a new message type, ordering and a waiting state in the panel. Not done here.
- **The ~2 s periodic task could not be reproduced**: idle profiles of 12 s on Portfolio show no long task in either
  version (frames simulated at 60/s). The preview pane was hidden (≈2 frames/s), and framer-motion keeps its own frame
  scheduler, so its loops (header "Ask" sparkle, the Lotse chip – `components/lotse`, not touched here) did not run in
  that test. Most likely cause: garbage collection of the ~185 MB dev heap driven by per-frame JS animation; the biggest
  such loop (the wave) is now CSS. Check again with a visible pane.
- Measured in a dev build; a production build is faster but the big mock is dev-only.
