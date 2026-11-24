// Applying a KI-Vorschlag – always through the existing write paths, always one undo entry per change.
// No React here, so the rules can be unit-tested (tests/aiAssist.test.js); the screens call these on the user's click.
import { OPT_MODES } from '../../../../shared/optimize.js'; // relative: also runs in Node tests
import { tr } from './i18n.js';

// Wochenplanung: the AI only picks among the optimizer's current suggestions – a pick that no longer exists (the
// board changed meanwhile) is skipped, never rebuilt. The result goes to the board's normal pending moves.
export function planningSelection(result, all) {
  const byId = new Map(OPT_MODES.flatMap((m) => all?.[m]?.suggestions || []).map((s) => [s.id, s]));
  const seen = new Set();
  return (result?.picks || []).map((p) => byId.get(p.id)).filter((s) => s && !seen.has(s.taskId) && seen.add(s.taskId));
}

// Fehlende Werte: the existing fill (issue.fill, one undo entry of its own via state.jsx fill → pushUndo).
export async function applyGap({ fill, target, gap, result, onUndone }) {
  const s = result?.suggestion;
  if (!s || s.usage !== gap.field || s.value == null) return null;
  return fill({ ...target, usage: gap.field, value: s.value, onUndone, label: result?.source === 'lotse' ? tr(`Lotse-Vorschlag übernommen – ${gap.key || gap.summary}`, `Lotse suggestion applied – ${gap.key || gap.summary}`) : tr(`KI-Vorschlag übernommen – ${gap.key || gap.summary}`, `AI suggestion applied – ${gap.key || gap.summary}`) });
}

// Support › Verteilen: team and person per ticket, as overrides for the existing assign flow (support.dispatch;
// it records one undo entry per ticket).
export function dispatchOverrides(result) {
  return new Map((result?.items || []).map((x) => [x.issueId, { teamId: x.teamId || null, accountId: x.accountId || null }]));
}

// Meine Arbeit: worklog comments through mine.book (same hours, new comment), one undo entry per cell that puts the
// earlier comment back. book(row, d, hours, comment, { silent }) → true | false.
export async function applyComments({ comments, book, pushUndo }) {
  const entries = [];
  for (const c of comments || []) {
    const row = { id: c.issueId, key: c.key };
    if (!(await book(row, c.d, c.h, c.comment, { silent: true }))) break;
    entries.push(pushUndo(tr(`KI-Kommentar ${c.key} · ${c.d}`, `AI comment ${c.key} · ${c.d}`), () => book(row, c.d, c.h, c.previous || '', { silent: true }), [`mine:${c.issueId}|${c.d}`]));
  }
  return entries;
}
