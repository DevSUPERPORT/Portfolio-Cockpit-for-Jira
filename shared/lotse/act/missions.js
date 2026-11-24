// Lotse missions – longer jobs that chain several steps (diagnosis → decisions → preview → apply → next job). They use
// the same planner and state machine as workflows.js; each file returns workflow specs:
//   { id, title(L), params: [...], match: [RegExp…] (on folded text), plan(P, params) }
// `helpers` = the planner class and the shared data helpers of workflows.js (no import cycle).
import { planMissions } from './missionsPlan.js';
import { knowledgeMissions } from './missionsKnowledge.js';
import { disruptMissions } from './missionsDisrupt.js';
import { splitMissions } from './missionsSplit.js';
import { orchestrateMissions } from './orchestrate/plan.js';
import { chainMissions } from './chain/run.js';

export function registerMissions(wf, helpers) {
  for (const spec of [...planMissions(helpers), ...knowledgeMissions(helpers), ...disruptMissions(helpers), ...splitMissions(helpers), ...orchestrateMissions(helpers), ...chainMissions(helpers)]) wf(spec);
}
