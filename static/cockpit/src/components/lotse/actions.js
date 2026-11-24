// What a Story action does – never on its own: the card shows the preview first, then this runs through the app's
// existing write paths, each with its own undo entry:
//   fill     → state.fill (issue.fill, exact earlier value back on undo)
//   rank     → state.reorder (portfolio.reorder, previous order back on undo)
//   move     → a pending move on the weekly planning board (pendingStore) – written to Jira only with "Apply in Jira"
//   assign   → the same pending move with a new assignee
//   open     → the work item in Jira (openIssue) / the project in the cockpit
//   navigate → a view of the cockpit
//   dispatch → the Support dispatch tab (assigning tickets keeps its own review step there)
//   whatIf   → handled by the card (scenario, nothing is written)
import { useCallback } from 'react';
import { useApp } from '../../state.jsx';
import { openIssue } from '../../lib/api.js';
import { tr } from '../../lib/i18n.js';
import { closeLotse } from './open.js';
import { pendingStore } from '../WeekBoard.jsx';
import { moveTask } from '@shared/weekPlan.js';

export const WRITE_KINDS = ['fill', 'rank', 'move', 'assign'];
// Kinds that change something get a preview and an explicit "Übernehmen"; the rest only open or navigate.
export const isWrite = (a) => WRITE_KINDS.includes(a?.kind) && canWrite(a);
const canWrite = (a) => {
  const p = a.payload || {};
  if (a.kind === 'fill') return !!(p.usage && (p.issueId || p.ref));
  if (a.kind === 'rank') return !!(p.ref && Number.isFinite(+(p.toRank ?? p.to)));
  if (a.kind === 'move' || a.kind === 'assign') return !!(p.issueId || p.taskId);
  return false;
};

const VIEW_ALIAS = { hours: 'time', planActual: 'time', teams: 'team', projects: 'project', weekPlan: 'plan', planning: 'plan', myWork: 'mine' };

export function useStoryActions() {
  const app = useApp();
  const { ds, setView, roles, fill, reorder, pushUndo, runUndo, toast, done } = app;

  // evidence: { key } → the work item; { ref } → a team (when it is one) or a project; { view } → a view
  const go = useCallback((ev) => {
    if (!ev) return;
    if (ev.key && !ev.ref) { openIssue(ev.key); return; }
    const ref = ev.ref;
    if (ref && (ds?.teams || []).some((t) => t.id === ref)) { closeLotse(); setView('team', { team: ref }); return; }
    if (ref && (ds?.portfolio || []).some((p) => p.ref === ref)) { closeLotse(); setView('project', { ref }); return; }
    if (ev.key) { openIssue(ev.key); return; }
    if (ev.view) { closeLotse(); setView(ev.view, ev.opts || {}); }
  }, [ds, setView]);

  // Returns the undo entry of a write (or null for open/navigate).
  const apply = useCallback(async (a) => {
    const p = a.payload || {};
    switch (a.kind) {
      case 'open': if (p.key) openIssue(p.key); else go(p); return null;
      case 'navigate': {
        // the engine names areas by their right ('hours', 'teams', …); the cockpit's view ids differ in places
        const view = VIEW_ALIAS[p.view] || p.view;
        if (p.structure === 'timeline' || p.structure === 'list') {
          try { localStorage.setItem('pc:tl:view', JSON.stringify(p.structure)); } catch { /* not remembered */ }
          setTimeout(() => window.dispatchEvent(new CustomEvent('pc-structure-view', { detail: p.structure })), 60);
        }
        if (view === 'support' && p.tab) { const { requestSupportTab } = await import('../../views/Support.jsx'); requestSupportTab(p.tab); }
        go({ view, opts: p.opts || (p.ref || p.project ? { ref: p.ref || p.project } : p.team && p.team !== 'all' ? { team: p.team } : {}) });
        return null;
      }
      case 'dispatch': {
        const { requestSupportTab } = await import('../../views/Support.jsx');
        requestSupportTab('dispatch'); closeLotse(); setView('support'); return null;
      }
      case 'fill': {
        const entry = await fill({ issueId: p.issueId, ref: p.ref, usage: p.usage, value: p.value, label: tr(`Lotse: ${a.label}`, `Lotse: ${a.label}`) });
        toast({ text: tr(`Übernommen: ${a.label}`, `Applied: ${a.label}`), icon: 'check', undo: () => runUndo(entry) });
        return entry;
      }
      case 'rank': {
        if (!roles?.manageRanking) throw Object.assign(new Error(tr('Die Rangfolge darf nur die freigegebene Gruppe ändern.', 'Only the enabled group may change the ranking.')), { code: 'NO_ACCESS' });
        const prev = [...ds.portfolio].sort((x, y) => x.rank - y.rank).map((x) => x.ref);
        const order = prev.filter((r) => r !== p.ref);
        order.splice(Math.max(0, Math.min(order.length, (+(p.toRank ?? p.to) || 1) - 1)), 0, p.ref);
        await reorder(order, { silent: true });
        return done(tr(`Rangfolge gespeichert: ${a.label}`, `Ranking saved: ${a.label}`), 'ranking', tr('Rangänderung (Lotse)', 'rank change (Lotse)'), () => reorder(prev, { silent: true }), ['order']);
      }
      case 'move': case 'assign': {
        const issue = (ds?.issues || []).find((i) => i.id === String(p.issueId || p.taskId));
        if (!issue) throw new Error(tr('Diesen Vorgang gibt es in den aktuellen Daten nicht mehr.', 'This work item is no longer in the current data.'));
        const prev = pendingStore.get().moves[issue.id] || null;
        // the optimizer's suggestion carries its moveTask change as is (payload.move); otherwise the fields one by one
        const opts = p.move && typeof p.move === 'object' ? p.move : a.kind === 'assign' ? { assignee: p.assignee ?? p.accountId ?? null, assigneeName: p.assigneeName } : { weeks: p.weeks || 0, ...(p.start !== undefined ? { start: p.start } : {}), ...(p.due !== undefined ? { due: p.due } : {}), ...(p.assignee !== undefined ? { assignee: p.assignee, assigneeName: p.assigneeName } : {}) };
        pendingStore.set((s) => ({ ...s, moves: moveTask(s.moves, issue, opts) }));
        const restore = () => pendingStore.set((s) => { const moves = { ...s.moves }; if (prev) moves[issue.id] = prev; else delete moves[issue.id]; return { ...s, moves }; });
        const entry = pushUndo(tr(`${issue.key}: Planänderung (Lotse)`, `${issue.key}: plan change (Lotse)`), restore, [`move:${issue.id}`]);
        toast({ text: tr(`${issue.key} in der Wochenplanung vorgemerkt – in Jira erst mit „In Jira übernehmen“`, `${issue.key} queued on the weekly plan – written to Jira only with "Apply in Jira"`), icon: 'calendar', undo: () => runUndo(entry) });
        return entry;
      }
      default: return null;
    }
  }, [ds, roles, fill, reorder, pushUndo, runUndo, toast, done, go]);

  return { apply, go, undo: runUndo };
}
