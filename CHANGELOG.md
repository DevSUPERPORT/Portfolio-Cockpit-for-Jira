# Changelog

Production releases of SUPERPORT Portfolio Cockpit for Jira. The full engineering log, with test results per release,
is in [docs/DEVELOPMENT-LOG.md](docs/DEVELOPMENT-LOG.md).

## 3.35.0 — 24 Nov 2026
- AI budget: 20 € per site and month by default from 1 December 2026 (November keeps 50 €). A limit set by SUPERPORT
  in App Status always wins and also applies inside the app.

## 3.34.0 — 24 Nov 2026
- Report composer: the "+ Section" menu is no longer cut off by the outline column.

## 3.33.0 — 24 Nov 2026
- Each environment uses its own app fields (rank, T-shirt size, target quarters).
- Ranking: the Jira rank field is written before the portfolio is saved, so a refused write never leaves half a change.
- Jira rate limits show a plain "Jira is busy, nothing was lost" message and are retried with Retry-After.
- Lotse: every number in a text is sourced, also with very large portfolios; an unknown project in a bulk job is asked
  about instead of widening the scope.
- Ask board: cards no longer overlap with large data; undo of a board removes all its cards.

## 3.30 – 3.32 — 23 Nov 2026
- Faster loading at scale: the hierarchy below each project comes from one Jira Plans search where available,
  searches run in parallel, and the page reloads once after a release instead of failing.
- Weekly planning: the week tooltip shows the full calculation, the period and every free day (holidays, absences);
  the sum row adds up the people rows exactly.

## Earlier milestones
- **Lotse** – the cockpit's own navigator: answers, multi-step jobs with preview and undo, report composer (Nov 2026).
- **Ask – "I want …"** – wishes become cards; learning from similar finished work (Nov 2026).
- **My work** – book the week in one grid; *Complete my week* from your own Jira activity (Nov 2026).
- **Weekly planning, plan vs. actual, support & SLAs, C-level report** (Nov 2026).
- **AI switch off by default**, monthly AI budget per site, no Rovo by company policy (Nov 2026).
- **First release** to production on superportdev (2 Nov 2026).
