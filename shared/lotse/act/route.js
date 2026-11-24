// Lotse acts – which job a sentence asks for: a workflow ("bereite das Weekly vor", "löse die Überlast von Team Web",
// "fülle die Lücken in …"), a single command ("setze …", "verschiebe …") or – when that is not certain – a decide step
// asking which one. Never guesses on a write: a command found here is only ever previewed, never applied.
//
// routeAct(text, ctx) → null | { kind: 'workflow', workflow, params, title, confidence }
//                            | { kind: 'command', command, params, describe, confidence }
//                            | { kind: 'decide', question, options: [{ id, label, detail?, recommended?, value }], freeText?, reason }
//   decide option value = { workflow, params } | { command, params }
import { findProject, findTeam } from '../../ask.js';
import { periodFromText, scopeFromText } from './missionsDisrupt.js';
import { fold, T, langOf, computedOf, dsOf } from './kit.js';
import { parseBulk } from './bulk.js';
import { WORKFLOWS, WORKFLOW_IDS } from './workflows.js';
import { jobScore } from './orchestrate/parse.js';
import { chainRoute } from './chain/plan.js';

const WHATIF = /was waere,? wenn|was ist,? wenn|was passiert,? wenn|angenommen|what if|what happens if|suppose|stell dir vor|szenario|scenario/;
const HEALTH_VALUE = /\b(im plan|on track|gefaehrdet|at risk|kritisch|critical)\b/;

function personIn(q, ctx) {
  const ps = Object.values(dsOf(ctx).people || {}).filter((p) => p?.name);
  const word = (w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}('?s)?([^a-z0-9]|$)`);
  const full = ps.find((p) => word(fold(p.name)).test(q));
  if (full) return full;
  const first = ps.filter((p) => { const f = fold(p.name).split(' ')[0]; return f.length >= 3 && word(f).test(q); });
  return first.length === 1 ? first[0] : null;
}
export function workflowParams(id, text, ctx) {
  const { model, wl } = computedOf(ctx);
  const q = fold(String(text || '')).replace(/[?!.,;:„“"”'()]+/g, ' ').replace(/\s+/g, ' ');
  const qn = q.replace(/\b[a-z][a-z0-9_]{1,19}-\d{1,9}\b/g, ' ');
  const want = WORKFLOWS[id].params;
  const p = {};
  // the orchestrator reads the whole sentence itself (orchestrate/parse.js)
  if (want.includes('text')) return { text: String(text || '').slice(0, 300) };
  const project = findProject(qn, model);
  if (want.includes('project') && project) p.ref = project.ref;
  const team = findTeam(project ? qn.replace(fold(project.name), ' ') : qn, model);
  if (want.includes('team') && team) p.team = team.id;
  if (want.includes('person') && !team) { const pr = personIn(qn, ctx); if (pr) p.person = pr.id; }
  // a closure (missionsDisrupt.js): which days and who, read from the sentence where it says so
  if (want.includes('period')) { const per = periodFromText(q); if (per) p.period = per; }
  if (want.includes('scope')) { const sc = scopeFromText(q); if (sc) p.scope = sc; }
  // "… automatisch" / "automatically" / "alles": the mission runs without questions (multi-team: splitResolve)
  if (want.includes('mode') && /\b(automatisch\w*|automatically|auto|ohne rueckfrage\w*|without asking|alles|everything)\b/.test(q)) p.mode = 'auto';
  if (want.includes('quarter')) {
    const m = /\bq([1-4])\s*[/ -]?\s*(20\d\d)\b|\b(20\d\d)\s*-?\s*q([1-4])\b/.exec(q);
    const k = m ? `${m[2] || m[3]}-Q${m[1] || m[4]}` : /naechste[sn]? quartal|next quarter/.test(q) ? wl.quarters[1] : null;
    if (k && wl.quarters.includes(k)) p.quarter = k;
  }
  return p;
}
export function matchWorkflows(text) {
  const q = fold(String(text || '')).replace(/[?!.,;:„“"”'()]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!q || WHATIF.test(q)) return [];
  return WORKFLOW_IDS.filter((id) => WORKFLOWS[id].match.some((re) => re.test(q)) && !(id === 'healthRound' && HEALTH_VALUE.test(q)));
}
// one job, one command or a decide – without chains (chain/plan.js maps each clause of a chain with this)
export function routeSingle(text, ctx) {
  const L = langOf(ctx);
  const raw = String(text || '').slice(0, 500);
  const q = fold(raw);
  if (!q.trim() || WHATIF.test(q)) return null;
  // a job made of several data blocks with something to hand back ("… als PDF für jeden Kollegen") → the orchestrator;
  // the jobs with their own workflow (weekly, C-level report, health round, …) are never taken over (jobScore.other)
  if (jobScore(raw, ctx).job) return { kind: 'workflow', workflow: 'orchestrate', params: workflowParams('orchestrate', raw, ctx), title: WORKFLOWS.orchestrate.title(L), confidence: 'high' };
  let hits = matchWorkflows(raw);
  // the more specific job wins where two patterns overlap ("fix the dependency conflicts" is not an overload)
  if (hits.includes('fixConflicts') && hits.includes('resolveOverload') && !/ueberlast|overload/.test(q)) hits = hits.filter((x) => x !== 'resolveOverload');
  if (hits.includes('cLevelReport') && hits.length > 1 && /c-?level|report|bericht/.test(q)) hits = ['cLevelReport'];
  // a sentence that names a closure ("es hat geschneit, die Arbeit fiel aus – plan neu ordnen") is the closure job,
  // not a re-ranking ("neu ordnen")
  if (hits.includes('splitResolve') && hits.length > 1 && /mehrteam|mehrere[nr]? teams|zwei teams|beide[nr]? teams|two teams|both teams|several teams|multiple teams|multi-?team|doppelt verplant|double[- ]?book|team-?anteil|team shares?|phantom/.test(q)) hits = ['splitResolve'];
  if (hits.includes('disruption') && hits.length > 1 && /schnee|geschneit|schneit|sturm|unwetter|hochwasser|stromausfall|streik|snow|storm|flood|outage|power cut|strike|ausgefallen|faellt\w* aus|fiel aus|geschlossen|cancel+ed|closed|ausfall|closure/.test(q)) hits = ['disruption'];
  const bulk = parseBulk(raw, ctx);
  const wfOut = (id) => ({ kind: 'workflow', workflow: id, params: workflowParams(id, raw, ctx), title: WORKFLOWS[id].title(L), confidence: 'high' });
  if (hits.length > 1 || (hits.length === 1 && bulk?.kind === 'command' && bulk.command !== 'navigate')) {
    const opts = hits.map((id, k) => ({ id: `workflow:${id}`, label: WORKFLOWS[id].title(L), detail: T(L, 'Schritt für Schritt mit Vorschau', 'step by step with a preview'), recommended: k === 0, value: { workflow: id, params: workflowParams(id, raw, ctx) } }));
    if (bulk?.kind === 'command') opts.push({ id: `command:${bulk.command}`, label: bulk.describe, detail: T(L, 'eine einzelne Änderung mit Vorschau', 'a single change with a preview'), value: { command: bulk.command, params: bulk.params } });
    return { kind: 'decide', question: T(L, 'Was genau soll Lotse tun?', 'What exactly should Lotse do?'), options: opts, reason: 'ambiguousJob' };
  }
  if (hits.length === 1) return wfOut(hits[0]);
  if (bulk) return bulk;
  return null;
}

// A complex request – several steps with data flowing between them ("Find everyone over 100 %, plan their weeks to
// 100 % and give each of them a PDF") – becomes the chain workflow (chain/run.js); everything else routes as before.
export function routeAct(text, ctx) {
  const raw = String(text || '').slice(0, 600);
  const q = fold(raw);
  if (!q.trim() || WHATIF.test(q)) return null;
  let ch = null;
  try { ch = chainRoute(raw, ctx); } catch { ch = null; }
  if (ch) return { kind: 'workflow', workflow: 'chain', params: { text: raw.slice(0, 600) }, title: WORKFLOWS.chain.title(langOf(ctx)), confidence: 'high', steps: ch.plan.steps.length };
  return routeSingle(raw, ctx);
}
