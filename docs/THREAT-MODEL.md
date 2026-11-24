# Threat model (STRIDE) – Portfolio Cockpit

## Trust boundaries

1. **Browser (Custom UI) → resolvers.**
   - Any user who can open the app can call **any** resolver with **any** payload.
   - Trusted: only `req.context.accountId`.
2. **Rovo:** not part of the app (company policy). No agent, action, resource or scope; every outbound call is limited to Jira/Confluence REST (`src/lib/norovo.js`), enforced by `tests/norovo.test.js`.
3. **App → Jira/Confluence.**
   - `asUser` inherits the caller's permissions.
   - `asApp` bypasses them, so every `asApp` call is listed below.
4. **App → Forge LLM.**
   - Prompts contain user-visible Jira text, which is untrusted.
5. **Jira data → UI.**
   - Summaries, notes and comments are untrusted strings.

## STRIDE categories

- **S** Spoofing
- **T** Tampering
- **R** Repudiation
- **I** Information disclosure
- **D** Denial of service
- **E** Elevation of privilege

## Per entry point

Residual risk is **low** for every entry point not listed under "Residual risks" at the end.

### `bootstrap`, `prefs.save`
- **S/E:** identity comes only from the invocation context.
- **T:**
  - Prefs are validated with an allow-list.
  - The KVS key is derived from the trusted accountId.
- **I:** returns `publicConfig` only; the group lists are stripped.

### `dataset`
- **I (main risk): Jira permissions.**
  - All Jira reads run `asUser`, so Browse Projects, issue security and worklog visibility apply.
  - Hidden projects are dropped, not counted, and visible ranks are renumbered without gaps.
- **I: person-level data.**
  - When person level is off, pseudonyms are applied on the server.
  - Health comment authors are hidden.
- **I: support data.**
  - Support aggregates are computed `asApp`.
  - Per-service detail is shown only for browsable service spaces; per-person support hours only for `editCapacity`/`viewReport`.
- **I: absences.** Absence reasons go only to `editCapacity`.
- **D:** each request is bounded (4,000 issues per search, 25 s Forge limit).
  - Open: very large portfolios degrade. See the load test in `docs/READINESS.md`.

### `portfolio.reorder / add / remove / candidates`
- **E:** requires the `manageRanking` group.
- **T:**
  - `reorder` permutes only slots the caller can see, and every ref must be visible (JQL as user).
  - `add` verifies the configured issue type.
  - `remove` verifies visibility.
  - The portfolio is capped at 2,000 items.
- **R:** every change is audited (person, time, old and new rank).
- **I:** responses no longer expose the global order or counts.
- **E (`asApp`):** rank fields of shifted items are written `asApp`, including hidden ones.
  - This is required so ranks stay unique.
  - Only the number changes.

### `health.set / clear`, `ai.healthDraft`
- **E:** allowed for the owner (assignee or project lead), `editHealth` or `manageRanking`.
- **I:** a JQL-visible check runs before any lookup, with one identical NOT_FOUND for a hidden item and an absent one.
- **R:** audited.

### `issue.fill` (data-quality fixes and undo)
- **T:**
  - Only the usages `team`, `originalEstimate`, `startDate`, `dueDate`, `tshirt` and `targetQuarters` are accepted, each value type-checked.
  - `clear` is allowed only for the same usages.
- **E:**
  - Jira fields are written `asUser`, so Jira enforces screens and permissions.
  - App fields are written `asApp`, but only after a JQL visibility check and an `EDIT_ISSUES` check as the user.
  - Sub-task estimates are refused while the lock is on.
- **E (space mode):** item plans require owner, `manageRanking` or `editHealth`.
  - Team names come from Jira, never from the client.

### `capacity.get / save`, `users.search`
- **E:** requires the `editCapacity` group.
- **T:** keys are matched against an allow-list regex; `__proto__`, `constructor` and `prototype` are rejected; values are clamped; the payload is capped at 200 KB.
- **I:** absence reasons are stored only as vacation, training or absent (GDPR).

### `report.get / refresh / publish`, `confluence.spaces`, `ai.reportSummary`
- **E:** requires the `viewReport` group.
- **I (`asApp`):** the report covers **all** projects by design (UC-06).
  - Publishing copies it to a Confluence space chosen by the publisher.
  - This is accepted risk: it widens the audience to the space's readers. See decision R1 below.
- **T:** the Confluence storage HTML is rendered on the server from the snapshot only; strings are escaped and numbers coerced.
- **D:** refresh is throttled to once per 5 minutes.

### `config.* / meta.* / milestones.save / audit.list`
- **E:** requires `ADMINISTER`, checked `asUser`. `audit.list` for management shows only visible refs.
- **T:**
  - Config goes through whitelist validation; types, enums and ranges are enforced; level keys are restricted.
  - One fix version per milestone.

### `ai.ask`
- **I:** the fact sheet is built from the caller's own permission-scoped dataset.
- **T (prompt injection):** Jira text is wrapped in `<facts>` and the system prompt says it is data.
  - Answers are display-only; no tool calls; output is rendered as text, not HTML.
- **D:** 60 AI calls per user per day; 15 s timeout with a deterministic fallback.

### Rovo
- Removed on 2026-11-06 (company policy). Nothing in the app can call or open Rovo; see `src/lib/norovo.js` and `tests/norovo.test.js`.

### Triggers and scheduled jobs (`lockEnforcer`, `reportJob`)
- **T:**
  - These use event ids only.
  - Lock comments are posted at most once per issue per day, to prevent spam.
- **E (`asApp`):** worklog deletion on sub-tasks only happens while the admin's lock option is on.

## Residual risks and decisions for you

- **R1 – Report publishing.** A `viewReport` member can publish the all-projects report into any space they can write to.
  - Option: restrict publishing to admins or to configured target spaces.
- **R2 – Rank writes.** Shifted hidden items get new rank numbers. This is unavoidable for unique ranks and only touches the app's own field.
- **R3 – No KVS transactions.** Concurrent edits of the same capacity or portfolio object are last-write-wins.
- **R4 – Prompt injection via Jira text.** Mitigated as above; not provably eliminated.
