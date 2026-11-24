# Privacy & Security tab – answers

For the partner portal's *Privacy & Security* tab (SUPERPORT Portfolio Cockpit for Jira). Each answer points to the
code or document that proves it. Attestations are ticked by SUPERPORT.

## Data storage and processing

| Question | Answer |
|---|---|
| Does the app store End-User Data outside Atlassian? | **No.** Runs on Atlassian: no remote back end, no `external` or `remotes` in `manifest.yml` (pinned by `tests/dataTrust.test.js`). |
| Where is data stored? | Forge app storage (KVS) of the customer's site, under Atlassian's data residency; plus the app's own Jira custom fields. |
| Does the app process End-User Data? | Yes, inside Atlassian: work items, estimates, worklogs, dates, teams – read as the signed-in user to compute the portfolio and plans. |
| Which personal data is stored? | Atlassian account IDs (audit log, undo, health updates, capacity per person, plan snapshots, preferences). No names or e-mail addresses ([PRIVACY.md](../../PRIVACY.md)). |
| Data residency | Inherits Atlassian's Forge data residency (Runs on Atlassian). |
| Retention | Plan snapshots 12/24/36 months (configurable); AI answer cache 12 hours; everything else until changed or the app is uninstalled; Forge deletes app storage after uninstall per Atlassian's retention. |
| Logging | Logs contain a resolver name and HTTP status only – no personal data, no work item content, no AI prompts (`src/lib/safeLog.js`). |
| Third parties / sub-processors | Atlassian only (hosting, storage, Forge LLM). |
| AI | Optional, off by default. Forge LLM (Claude), hosted by Atlassian. Prompts are built from data the asking person may see, scrubbed of links, e-mail addresses and secrets (`shared/aiAssist.js`). The AI cannot write to Jira. |

## Personal data and GDPR

| Question | Answer |
|---|---|
| Role under GDPR | SUPERPORT is not a processor of customer data: it has no access to the site or the app storage. Atlassian processes the data as the customer's processor. ⟦CONFIRM⟧ legal wording |
| DPA | Not required for data SUPERPORT never receives; available on request (mail@superport.digital). ⟦CONFIRM⟧ |
| Personal data reporting API | ⟦OPEN⟧ To be added before submission: weekly report of stored account IDs, removal for closed accounts. |
| EEA transfers | None by SUPERPORT. |

## Security

| Question | Answer |
|---|---|
| Authentication / authorisation | Identity from the Forge context only; role check on the server in every resolver (`src/lib/perms.js`); reads `asUser`. |
| `asApp` use | Only for the app's own fields and the C-level report, after a JQL visibility and EDIT_ISSUES check as the user ([THREAT-MODEL.md](../THREAT-MODEL.md)). |
| Credentials | The app never collects Atlassian credentials or API tokens. No secrets in code or variables. |
| Input validation | Whitelisted payloads, JQL from validated ids only, prototype-pollution tests. |
| CSP | No `unsafe-inline`/`unsafe-eval` in `script-src`; only `styles: unsafe-inline` (style attributes). |
| Dependencies | `npm audit --omit=dev`: no high or critical findings (24 Nov 2026). |
| Runtime | `nodejs22.x`. |
| Security contact | dev@superport.digital – [SECURITY.md](../../SECURITY.md). |
| Certifications | None. |
