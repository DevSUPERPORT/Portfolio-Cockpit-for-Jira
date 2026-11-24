// The one place the UI reaches Lotse's engine (shared/lotse/index.js) and builds its context.
import { useMemo, useSyncExternalStore } from 'react';
import { learnedStore } from '../../lib/lotseLearned.js';

export { learnedStore };
import * as Engine from '@shared/lotse/index.js';
import { useApp } from '../../state.jsx';
import { fmt, getLang, ruleName } from '../../lib/i18n.js';

// Every engine call is guarded: a failing skill must never take a view down – it becomes an honest notice instead.
const guard = (fn, name) => (...a) => { try { return fn(...a); } catch (e) { console.error(`[lotse] ${name}`, e); return null; } };
export const ask = guard((text, ctx, memory) => Engine.ask(text, ctx, memory || {}), 'ask');
export const briefing = guard((ctx) => Engine.briefing(ctx) || [], 'briefing'); // the role comes from ctx.roles (engine: roleOf)
export const run = guard((skill, params, ctx) => Engine.run(skill, params, ctx), 'run');
export const remember = (story) => { try { return Engine.remember(story) || {}; } catch { return {}; } };
// validStory() of the engine is strict and throws – here: a yes/no for rendering
export const validStory = (s) => { try { Engine.validStory(s); return true; } catch { return false; } };
export const engineCrossCheck = Engine.crossCheck;
// ---- acts (shared/lotse/act): commands with preview + undo, workflows ----
// route(text) → { kind: 'story' | 'command' | 'workflow' | 'decide', … } (Engine.lotse); null when the engine failed
export const route = guard((text, ctx, memory) => Engine.lotse(text, ctx, memory || {}), 'lotse');
export const understand = guard((text, ctx, memory) => Engine.understand(text, ctx, memory || {}), 'understand');
// these throw on purpose (INVALID, STALE_PREVIEW, …) – the cards show the reason
export const { previewCommand, applyCommand, commandList, resolveDecide, startWorkflow, answerWorkflow, nextWorkflow, applyWorkflowStep, cancelWorkflow, undoWorkflow, currentStep, refreshWorkflow, WORKFLOWS, WORKFLOW_IDS, COMMANDS, SKILLS } = Engine;

// The engine's context – the same inputs as the Ask canvas (views/Ask.jsx), recomputed when the data or language change.
export function useLotseCtx() {
  const { computed, ds, roles, boot, config, lang } = useApp();
  const learnedList = useSyncExternalStore(learnedStore.subscribe, learnedStore.get, learnedStore.get);
  return useMemo(() => (computed ? {
    computed, ds, roles, me: boot.me, lang: getLang(), fmt, ruleName, config,
    supportA: computed.supportA || null, cal: ds?.config?.support?.sla, learned: learnedList,
  } : null), [computed, ds, roles, boot.me, config, lang, learnedList]); // eslint-disable-line react-hooks/exhaustive-deps
}
