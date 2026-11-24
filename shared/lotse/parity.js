// Lotse can do everything the Forge LLM features do (product owner, 2026-11-12): every AI feature id of the app
// (src/lib/config.js AI_FEATURES) has a Lotse skill that does the same job without AI. tests/lotseParity.test.js runs
// each of them on the fixture; shared/lotse/teamwork.js uses this map where both work on the same task.
//
//   ask            free questions         → Lotse ask() (every skill; "Was ist heute wichtig?" when nothing is asked)
//   healthDraft    health status + sentence → healthDraft
//   reportSummary  C-level summary        → portfolioBrief
//   planning       best combination       → planningAdvice (one change per task, overload first)
//   gaps           a value for a gap      → gapsFix (similar work, siblings, parent, stories)
//   dispatch       team + person / ticket → dispatchAdvice (mapping → history → team, lowest load)
//   planActual     what happened          → planActualExplain
//   teamBrief      team briefing          → teamBrief
//   projectBrief   project briefing       → projectBrief
//   myWeek         booking comments       → bookingComments (own Jira activity of the day)
//   intent         wish → answer card     → intentMap (Lotse's own routing + learned phrases)
//   similarSummary what helped back then  → similarSummary (counts, durations, overruns, comment keywords)
//   playbookDraft  help article + reply   → playbookDraft (template improved with the tickets' facts)
//   lotse          the AI reading         → Lotse itself: the verified story it reads (today when nothing is open)
export const AI_PARITY = Object.freeze({
  ask: 'today', healthDraft: 'healthDraft', reportSummary: 'portfolioBrief', planning: 'planningAdvice', gaps: 'gapsFix', dispatch: 'dispatchAdvice',
  planActual: 'planActualExplain', teamBrief: 'teamBrief', projectBrief: 'projectBrief', myWeek: 'bookingComments', intent: 'intentMap',
  similarSummary: 'similarSummary', playbookDraft: 'playbookDraft', lotse: 'today',
});
export const paritySkill = (feature) => AI_PARITY[feature] || null;
