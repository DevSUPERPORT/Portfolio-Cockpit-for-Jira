# Portfolio Cockpit – 10-minute demo (superportdev, production install 2.51.0)

**Open:** https://superportdev.atlassian.net/jira/apps/083d5c93-0586-481d-9c13-6e085bdfad84/d785f633-7154-4bae-a0ac-8e983213434b
(Jira sidebar → Apps → SUPERPORT Portfolio Cockpit). Log in as **Dev Team**: the sandbox data and roles are set up for that account.

## Before the meeting (5 minutes)

1. Open the cockpit once. The first open after a deploy takes ~10 s; after that, re-opening in the same tab is instant.
2. Optional – to show "Since your last visit" live: after step 1, change one thing **outside** the cockpit.
   - Example: in Jira, change the health comment of *KI-Kundenservice* directly on the work item.
   - When you open the cockpit in the meeting, the card shows that change.
3. Pick the language with the **DE | EN** switch top right. It is remembered for your account.
4. The Confluence space PCXR contains a few "Portfolio-Report Selftest …" pages from testing. Move them to the trash if you plan to show Confluence.

## Opening move: the 60-second tour

Click **?** (top right) to start the guided tour. It also starts on its own the first time someone opens the cockpit. It spotlights the real controls one by one and works with the arrow keys and Esc; it is available in German and English, and adapts to the user's role.

## The story (what to click, what to say)

| # | Where | Do | Say |
|---|---|---|---|
| 1 | Portfolio | Point at the "Since your last visit" card | "The first thing I see is what changed – worst news first. One click opens the project." |
| 2 | Portfolio → ranking | Drag *Zahlungsverkehr SEPA 2027* above *KI-Kundenservice*. Watch the orange waterline move. Press **Ctrl+Z**. | "Ranking is a decision with consequences: the waterline shows instantly which projects our capacity still covers in Q4. Every change can be undone." |
| 3 | Portfolio → health dot | Open *Glasfaser Nord – Pilot* (critical, overdue) → "Update" → "Draft with AI" | "Health updates take 20 seconds; the AI drafts the comment from the real numbers." |
| 4 | Project details | *Self-Service-Portal B2B*: AI briefing, progress, forecast, dependencies | "Everything about one project on one page, straight from Jira." |
| 5 | Capacity | Weeks heatmap, then the waterline tank per team | "Where are we overbooked, week by week and per quarter – absences and support load included." |
| 6 | Data quality | Choose a rule → tick rows → set one value → "Set for n" → Undo | "Planning gaps get fixed in bulk, saved in Jira under each user's own permissions – and undone in one click." |
| 7 | C-level report | AI summary, then "Publish to Confluence" (space PCXR) | "The board report writes itself and lands in Confluence, only in spaces the admin approved." |
| 8 | Ask tab | Click "Was braucht jetzt meine Aufmerksamkeit?", then type "Zeig die Abhängigkeiten als Netz" → open it full screen; ask "Health als Kuchen"; tick two cards → PDF | "Ask the portfolio in plain language. Every answer is a card I can rearrange, switch to another chart, blow up for the board – and turn into a PDF." |
| 8b | Ask → Simple view | Switch on "Simple view", ask one question | "For colleagues who never want to see a planning tool: just questions and big answers." |
| 10 | CSV buttons | Download the ranking | "Everything exports to Excel." |

## If asked about trust and readiness

- **Permissions:** every call is checked on the server with the user's own Jira permissions. App roles (ranking, capacity, report) come from Jira groups.
  - The restricted project PCR is invisible to Dev Team; it isn't even counted.
  - 113/113 live checks passed on this production install, including 22 privilege-escalation denials and 9 hidden-project checks.
- **Data stays in Atlassian:** "Runs on Atlassian" eligible. The AI runs on Atlassian's Forge LLM, and nothing is sent to outside services.
- **Any site, any space:** the configuration page maps issue types and fields per site; no site-wide changes are needed.
- **Accessibility:** WCAG 2.2 AA automated audits are clean, light and dark.

## If asked "how hard is it to run?"

- **Admin page** (Jira settings → Apps → Portfolio Cockpit): map your own Jira fields, including T-shirt size and Target quarters; sizes follow your Jira options automatically.
- **No Jira-admin bottleneck:** the "Portfolio settings" group maintains sizes, milestones and planning rules from the cockpit (gear icon).
- **Safe to experiment:** Versions & backup keeps every saved configuration, restorable in one click; export and import move a setup between sites.

## Known limits (say them before someone finds them)

- Voice input: Jira's app frame usually blocks the microphone. The app says so and points to system dictation (Win + H / Fn Fn), which types into the question box.
- The Support view needs a service space or a support queue; superportdev has neither yet (see README › Open points).

- Opening the cockpit takes ~5–10 s, mostly Jira loading the app frame. Re-opening in the same browser tab is instant.
- The sandbox has 5 visible projects and one test user, so all owners show as "Dev Team".
- Not yet done: a load test at ~20k issues, testing with real non-admin accounts, and a manual screen-reader pass.
