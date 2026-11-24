// Local mock of the plan.apply resolver (Wochenplanung): same validation and result shape as src/lib/planApply.js.
// issues: the mock's issue list (changed in place, so the next dataset load shows the new dates and people);
// people: the mock's people ([{ id, name }]) for the assignee names.
// Wiring in lib/mock.js:
//   case 'plan.apply': try { return ok(mockPlanApply(p, issues, PEOPLE)); } catch (e) { return fail(e.code || 'ERROR', e.message); }
import { validatePlanMoves, validateEvenPayload } from '@shared/weekPlan.js';

export function mockPlanApply(payload, issues = null, people = []) {
  const moves = validatePlanMoves(payload);
  const byId = new Map((issues || []).map((i) => [i.id, i]));
  const results = moves.map((m) => {
    const has = (f) => Object.prototype.hasOwnProperty.call(m, f);
    const it = byId.get(m.issueId);
    if (issues && !it) return { issueId: m.issueId, ok: false, error: { code: 'NOT_FOUND', message: 'Work item not found or not visible.' } };
    const before = {};
    if (has('start')) before.start = it?.start ?? null;
    if (has('due')) before.due = it?.due ?? null;
    if (has('assignee')) before.assignee = it?.assignee?.id ?? null;
    if (it) {
      if (has('start')) it.start = m.start;
      if (has('due')) it.due = m.due;
      if (has('assignee')) it.assignee = m.assignee ? (people.find((u) => u.id === m.assignee) || { id: m.assignee, name: m.assignee, avatar: null }) : null;
    }
    return { issueId: m.issueId, key: it?.key || null, ok: true, before };
  });
  const ok = results.filter((r) => r.ok).length;
  return { results, ok, failed: results.length - ok };
}

// Local mock of plan.even (src/lib/planEven.js): store = the mock's plan:even map (changed in place).
export function mockPlanEven(payload, store, me = {}) {
  const { even, auto } = validateEvenPayload(payload);
  const at = new Date().toISOString();
  for (const id of auto) delete store[id];
  for (const id of even) store[id] = { by: me.accountId || me.id || 'me', byName: me.displayName || me.name || null, at };
  return { even: { ...store }, changed: { even: even.length, auto: auto.length } };
}
