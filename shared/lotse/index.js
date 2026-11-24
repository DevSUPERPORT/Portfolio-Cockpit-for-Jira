// Lotse (EN: Navigator) – the cockpit's own agent. Pure and local: every answer is a Story (story.js) computed from the
// Jira dataset, visual first, with its evidence; free, instant and without any AI. When AI is on, lotse.llm adds the
// model's reading of the same story and crossCheck() verifies every claim in it (llm.js, crosscheck.js).
//
// UI entry points:
//   ask(text, ctx, memory?)      → Story            (always a Story: unknown → an 'info' story with the closest questions)
//   run(skill, params, ctx)      → Story            (follow-up chips, actions of kind 'whatIf', deep links)
//   briefing(ctx, role?)         → Story[]          ("Heute für dich": top 3 for the person's role)
//   remember(story)              → memory           (pass to the next ask() for follow-ups)
//   crossCheck(story, text)      → { agree, verdict, claims }
// ctx = { computed?, ds, lang: 'de'|'en', fmt?, me?: { id, name }, roles?, history?, planActual?, mine?, now? }
import { closestQuestions } from '../ask.js';
import { understand, remember } from './understand.js';
import { SKILLS, SKILL_IDS, questionFor } from './skills/index.js';
import { todayStories, roleOf } from './skills/today.js';
import { infoStory, follow, T } from './kit.js';
import { computeAll } from '../engine.js';
import { COMMANDS, preview as previewCommand, start as startWorkflow } from './act/index.js';

export { understand, remember, SKILLS, SKILL_IDS, questionFor, roleOf };
export { crossCheck, selfCheck, textClaims } from './crosscheck.js';
export { validStory, storyFacts, storyProblems, VISUAL_KINDS, UNITS, TONES, STORY_TONES, ACTION_KINDS, MAX_STORY_BYTES } from './story.js';
export { narrate, localFmt } from './narrate.js';
export { lotseFacts, lotsePrompt, cleanReply, lotseReading } from './llm.js';
// parity with the Forge LLM features and teamwork on the same task (shared/lotse/parity.js, teamwork.js, learn.js)
export { AI_PARITY, paritySkill } from './parity.js';
export { lotseDraft, compareDrafts, textCheck, pickResult, isNarrative } from './teamwork.js';
export { patternOf, learnedSkill, skillOfCard, CARD_SKILL } from './learn.js';
// ---- acts: commands with preview + undo, plain-language bulk, workflows (shared/lotse/act) ----
export * as act from './act/index.js';
export { COMMANDS, COMMAND_IDS, preview as previewCommand, apply as applyCommand, commandList, parseBulk, resolveDecide, WORKFLOWS, WORKFLOW_IDS, planWorkflow, start as startWorkflow, answer as answerWorkflow, next as nextWorkflow, applyStep as applyWorkflowStep, cancel as cancelWorkflow, undoAll as undoWorkflow, current as currentStep, refresh as refreshWorkflow, routeAct, ActError } from './act/index.js';

const langOf = (ctx) => (ctx?.lang === 'en' ? 'en' : 'de');
const withComputed = (ctx) => (ctx.computed || !ctx.ds ? ctx : { ...ctx, computed: computeAll(ctx.ds) });

export function run(skill, params, ctx) {
  const c = withComputed(ctx);
  const L = langOf(c);
  if (!SKILLS[skill]) return helpStory('', c, L);
  try {
    const s = SKILLS[skill].run(c, params || {}, L);
    return { ...s, understood: { skill, params: params || {}, confidence: 'high', alternatives: [] } };
  } catch (e) {
    return infoStory(c, { skill, lang: L, headline: T(L, 'Lotse konnte das gerade nicht berechnen.', 'Lotse could not compute this right now.'), finding: T(L, 'Ein Teil der Daten fehlt oder ist unvollständig; die Ansichten des Cockpits zeigen die Einzelheiten.', 'Part of the data is missing or incomplete; the cockpit views show the details.'),
      followUps: [follow(T(L, 'Heute für mich', 'Today for me'), T(L, 'Was ist heute wichtig?', 'What matters today?'))], why: String(e?.message || e).slice(0, 200) });
  }
}

function helpStory(text, ctx, L) {
  const qs = (() => { try { return closestQuestions(text || '', { ...ctx, lang: L }, 4); } catch { return []; } })();
  const starters = [T(L, 'Was ist heute wichtig?', 'What matters today?'), T(L, 'Ab welchem Rang reicht die Kapazität nicht?', 'From which rank does capacity run out?'), T(L, 'Wer macht bald Überstunden?', 'Who is heading for overtime?'), T(L, 'Meine Woche', 'My week')];
  const list = [...new Set([...qs, ...starters])].slice(0, 4);
  return infoStory(ctx, { skill: 'help', lang: L, subject: { kind: 'topic', ref: null, name: 'Lotse' },
    headline: T(L, 'Das kann Lotse noch nicht sicher zuordnen – diese Fragen beantwortet Lotse mit euren Daten:', 'Lotse cannot map this for sure yet – these questions Lotse answers with your data:'),
    finding: T(L, 'Lotse versteht Fragen zu Projekten, Teams, Kapazität, Überstunden, Wasserlinie, Blockaden, Support, Schätzungen und „was wäre wenn“.', 'Lotse understands questions about projects, teams, capacity, overtime, the waterline, blockers, support, estimates and "what if".'),
    followUps: list.map((q) => follow(q.length > 60 ? `${q.slice(0, 57)}…` : q, q)) });
}
function guardStory(ctx, L) {
  return infoStory(ctx, { skill: 'guard', lang: L, subject: { kind: 'topic', ref: null, name: 'Lotse' }, headline: T(L, 'Lotse bewertet keine einzelnen Personen.', 'Lotse does not rate individual people.'),
    finding: T(L, 'Das Cockpit plant Kapazität, es benotet niemanden. Frag nach Teams, Projekten oder Auslastung.', 'The cockpit plans capacity, it grades nobody. Ask about teams, projects or load.'),
    followUps: [follow(T(L, 'Welche Teams sind überlastet?', 'Which teams are overloaded?'), T(L, 'Wer macht bald Überstunden?', 'Who is heading for overtime?')), follow(T(L, 'Heute für mich', 'Today for me'), T(L, 'Was ist heute wichtig?', 'What matters today?'))] });
}

export function ask(text, ctx, memory = {}) {
  const c = withComputed(ctx);
  const L = langOf(c);
  const u = understand(text, c, memory);
  if (u.skill === 'guard') return { ...guardStory(c, L), understood: { ...u, text: String(text || '').slice(0, 200) } };
  if (u.kind) return { ...actStory(u, c, L), understood: { ...u, text: String(text || '').slice(0, 200) }, act: u };
  if (!u.skill) return { ...helpStory(text, c, L), understood: { ...u, text: String(text || '').slice(0, 200) } };
  const s = run(u.skill, u.params, c);
  return { ...s, understood: { ...u, text: String(text || '').slice(0, 200) } };
}

// ---- acts ----
// ask() stays "always a Story": for a job or command it returns this short story plus `act` (the route) so a UI that
// only knows stories still says what Lotse would do. lotse() is the entry point for the acting UI.
function actStory(u, ctx, L) {
  const what = u.kind === 'workflow' ? u.title : u.kind === 'command' ? (u.describe || COMMANDS[u.command]?.title(L)) : u.question;
  return infoStory(ctx, { skill: 'act', lang: L, subject: { kind: 'topic', ref: null, name: 'Lotse' },
    headline: u.kind === 'decide' ? what : T(L, `Lotse kann das für dich erledigen: ${what}.`, `Lotse can do this for you: ${what}.`).replace(/\.\.$/, '.'),
    finding: T(L, 'Vor jeder Änderung zeigt Lotse die Vorschau; geschrieben wird erst nach deiner Bestätigung, und alles lässt sich rückgängig machen.', 'Before any change Lotse shows the preview; nothing is written before you confirm, and everything can be undone.'),
    followUps: [follow(T(L, 'Heute für mich', 'Today for me'), T(L, 'Was ist heute wichtig?', 'What matters today?'))] });
}
// lotse(text, ctx, memory?) →
//   { kind: 'story', story }                                         a question → the Story (as ask())
//   { kind: 'command', command, params, describe, preview }          one write, previewed (apply with preview.token)
//   { kind: 'workflow', workflow, params, title, state }             a job, started (drive with answer/next/applyStep)
//   { kind: 'decide', question, options, freeText?, reason }         ambiguous – the person picks (resolveDecide / startWorkflow)
export function lotse(text, ctx, memory = {}) {
  const c = withComputed(ctx);
  const u = understand(text, c, memory);
  if (u.kind === 'workflow') return { kind: 'workflow', workflow: u.workflow, params: u.params, title: u.title, state: startWorkflow({ id: u.workflow, params: u.params }, c) };
  if (u.kind === 'command') {
    try { return { kind: 'command', command: u.command, params: u.params, describe: u.describe, preview: previewCommand(u.command, u.params, c) }; } catch (e) {
      return { kind: 'story', story: ask(text, c, memory), error: e?.code || 'ERROR' };
    }
  }
  if (u.kind === 'decide') { const { skill, params, confidence, alternatives, ...d } = u; return d; }
  return { kind: 'story', story: ask(text, c, memory) };
}

// The same briefing for the same inputs: "Heute für dich" on the portfolio, on "Meine Arbeit" and in the panel ask for it
// again whenever their context object is rebuilt (a language, roles or learned-phrases update) – the stories are kept per
// computed result and the inputs they read (data, roles, person, language, history, plan vs. actual, formatter, clock).
const briefMemo = new WeakMap();
export function briefing(ctx, role) {
  const c = withComputed(ctx);
  const L = langOf(c);
  const r = ['employee', 'projectAdmin', 'management'].includes(role) ? role : roleOf(c);
  const key = { r, L, ds: c.ds || null, roles: c.roles || null, me: c.me?.id || null, history: c.history || null, planActual: c.planActual || null, fmt: c.fmt || null, now: c.now ?? null };
  const list = briefMemo.get(c.computed) || briefMemo.set(c.computed, []).get(c.computed);
  const hit = list.find((e) => Object.keys(key).every((k) => e.key[k] === key[k]));
  if (hit) return hit.stories;
  const stories = todayStories(c, r, L);
  if (list.length > 8) list.shift();
  list.push({ key, stories });
  return stories;
}
