# Moderated usability test – Portfolio Cockpit (30 min)

**Who:** 2–3 people per role (management, project owner, team lead or employee) from the pilot customer.
**Setup:** superportdev with the PCX sandbox, or a copy of their real portfolio. Screen and audio recorded, with consent.
**Method:** think aloud. The moderator never helps, but may say "what would you try next?". Measure per task:
- success: full, partial or fail;
- time;
- number of wrong turns;
- a confidence rating from 1 to 5 ("how sure are you of your answer?").

## Intro (3 min)

"We're testing the app, not you. Please say what you're looking for and what you expect. There are no wrong answers."

## Management (5 tasks)

1. "Which project would be the first not to get enough capacity next quarter, and which team is the bottleneck?"
   - Success: names the project at the waterline and the team (Portfolio waterline or Capacity › Quarters).
2. "Move project X above project Y. Then undo it."
   - Success: drag or the arrow buttons; undo via the toast or Ctrl+Z; the rank is back.
3. "Which projects are late, and by how many days?"
   - Success: the C-level report, or Portfolio due dates.
4. "Prepare the status for tomorrow's board meeting."
   - Success: exports a PDF or publishes to Confluence, possibly using the AI summary.
5. "Ask the assistant which teams are over capacity. Do you trust the answer? Why or why not?"
   - Observe whether they verify it against the heatmap.

## Project owner (5 tasks)

1. "Update the health of your project to 'at risk' with a reason."
   - Success: the health dialog, or "Draft with AI".
2. "What is the most urgent thing in your project right now?"
   - Success: the Action-needed list.
3. "Which other project is your project waiting for?"
   - Success: Dependencies, the conflict chip, or the timeline.
4. "Fill in the missing estimate on one story."
   - Success: Data quality fix in place, or opened in Jira.
5. "Is your project fully staffed next quarter? If not, by how many hours?"
   - Success: Project details › Capacity › Quarters per team.

## Team lead or employee (5 tasks)

1. "How busy is your team over the next 4 weeks?"
   - Heatmap, read correctly.
2. "Which weeks are over 100 %, and what causes it?"
   - Hover tooltips, then project bars.
3. "Did your team log more or fewer hours than estimated last month?"
   - Time vs. estimate, Month, Teams.
4. "Find story <key> quickly."
   - Ctrl+K palette.
5. "Something you changed was wrong. Undo it."
   - Toast or Ctrl+Z.

## Debrief (5 min)

- SUS questionnaire (10 items).
- "What would you use weekly? What is missing? What confused you?"

## Pass criteria for go-live

- At least 80 % full task success per role.
- Median SUS of at least 75.
- No task with a confidence rating of 2 or below in more than one participant.
- Every waterline and capacity task answered correctly; wrong answers there mean wrong decisions.
