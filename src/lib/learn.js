// "LLM teaches Lotse" (server): when Lotse could not map a wish and the AI 'intent' feature picked a card, ONLY the phrase
// pattern is stored as a learning candidate (shared/lotse/learn.js patternOf: names of projects, teams and people, keys,
// numbers and quarters masked; no account id, no data) – at most 500 per site, in the app storage. Jira admins approve
// or reject them (Konfiguration › KI & Datenschutz); approved ones extend Lotse's routing for everyone.
//   lotse.learned       (read)  – approved patterns for everyone; admins also get the whole list
//   lotse.learn.review  (write) – approve / reject / back to pending (undo), Jira admins only, audited
import { get, set } from './store.js';
import { maintenanceMode } from './maintenance.js';
import { patternOf, addCandidate, reviewCandidate, approvedOnly, validCandidate, skillOfCard } from '../../shared/lotse/learn.js';
import { toolOf } from '../../shared/lotse/act/tools.js';

export const LEARN_KEY = 'lotse:learned';
const words = (p) => String(p || '').split(' ').filter((w) => w && !w.startsWith('{')).length;

// After ai.assist(intent): ds = the caller's dataset (names to mask). Nothing happens while the app is paused.
export async function learnFromAi({ wish, card }, { loadDs, now } = {}, deps = {}) {
  const D = { get: deps.get || get, set: deps.set || set, mode: deps.mode || maintenanceMode };
  if (D.mode() !== 'off' || !card || !skillOfCard(card) || typeof wish !== 'string') return null;
  const ds = loadDs ? await loadDs().catch(() => null) : null;
  if (!ds) return null; // without the names to mask nothing is stored
  const pattern = patternOf(wish, { ds });
  if (words(pattern) < 2) return null;
  const { list, added } = addCandidate(await D.get(LEARN_KEY), { pattern, card, skill: skillOfCard(card) }, now);
  await D.set(LEARN_KEY, list);
  return added;
}

// A chain plan the person took from the AI planner ('lotse.llm' mode 'learn'): per clause the masked pattern and the
// catalogue tool the AI chose – candidates for the admins, like learnFromAi. At most 6 clauses; unknown tools are ignored.
export async function learnChainFromAi(payload, { loadDs, now } = {}, deps = {}) {
  const D = { get: deps.get || get, set: deps.set || set, mode: deps.mode || maintenanceMode };
  if (D.mode() !== 'off') return { added: 0 };
  const clauses = (Array.isArray(payload?.clauses) ? payload.clauses : []).slice(0, 6).filter((c) => c && typeof c.text === 'string' && c.text.length <= 300 && typeof c.tool === 'string' && toolOf(c.tool)?.chainable);
  if (!clauses.length) return { added: 0 };
  const ds = loadDs ? await loadDs().catch(() => null) : null;
  if (!ds) return { added: 0 }; // without the names to mask nothing is stored
  let list = await D.get(LEARN_KEY);
  let added = 0;
  for (const c of clauses) {
    const pattern = patternOf(c.text, { ds });
    if (words(pattern) < 2) continue;
    const r = addCandidate(list, { pattern, tool: c.tool }, now);
    list = r.list;
    if (r.added) added += 1;
  }
  await D.set(LEARN_KEY, list);
  return { added };
}

export async function listLearned({ admin = false } = {}, deps = {}) {
  const list = ((await (deps.get || get)(LEARN_KEY)) || []).map(validCandidate).filter(Boolean);
  return { approved: approvedOnly(list), ...(admin ? { items: [...list].sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || String(b.last).localeCompare(String(a.last))) } : {}) };
}

export async function reviewLearned(payload, { now } = {}, deps = {}) {
  const D = { get: deps.get || get, set: deps.set || set };
  const id = typeof payload?.id === 'string' && /^l-[a-z0-9]{1,13}$/.test(payload.id) ? payload.id : null;
  if (!id) throw Object.assign(new Error('id'), { code: 'INVALID' });
  const r = reviewCandidate(await D.get(LEARN_KEY), { id, decision: payload.decision }, now);
  await D.set(LEARN_KEY, r.list);
  return { item: r.item, previous: r.previous };
}
