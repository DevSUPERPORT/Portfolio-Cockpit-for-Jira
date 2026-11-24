// Monthly Forge LLM limit per installation (= per Jira site) – the DEFAULTS. Forge LLM usage is billed to SUPERPORT (the
// app developer), not to the customer – change the limits HERE, nowhere else in the code. In production SUPERPORT sets
// the values per app and per site without a code change: Forge variable AI_BUDGET, contract v2 (callsPerMonth,
// tokensPerMonth, siteCaps – shared/aiBudget.js effectiveCaps); these constants apply wherever it sets none. They equal
// the contract's defaults (DEFAULTS_USAGE in SUPERPORT-OPS jira-app/src/aibudget.js).
//
// Counted per calendar month (UTC) in this site's app storage (`ai:spend:<YYYY-MM>`, see src/lib/aiBudget.js) and
// checked BEFORE every Forge LLM call (src/lib/ai.js llm()). When either limit is reached, no AI call starts until the
// 1st of the next month; the app answers with its own rules (deterministic summary / Lotse), as with AI switched off.
// A limit of 0 (set by SUPERPORT) switches AI off for that scope. These limits apply on top of the monthly EUR budget
// (shared/aiBudget.js) and the requests per person and day.

/** Default: Forge LLM calls per installation and calendar month (UTC). Answers from the 12-hour cache do not count. */
export const MONTHLY_LLM_CALLS = 1000;
/** Default: tokens (input + output, as Atlassian reports them in the response `usage`) per installation and calendar month (UTC). */
export const MONTHLY_LLM_TOKENS = 2_000_000;
