// Lotse learns from the AI ("LLM teaches Lotse"): when Lotse could not map a wish and the AI 'intent' feature picked a
// card for it, ONLY the phrase pattern is kept as a learning candidate – the folded words of the question with every
// name, key, number and quarter masked (no data: no projects, teams, people, keys, figures, no account ids) – and the
// card / skill the AI chose. A Jira admin approves or rejects candidates (Konfiguration › KI & Datenschutz); approved
// ones extend Lotse's routing for everyone: understand() reads them via ctx.learned. Pure – the server keeps the list
// (src/lib/learn.js, app storage, at most 500 per site), the mock keeps it in memory.
import { fold, fixTypos } from '../ask.js';
import { WISH_IDS, WISH_PREFIX } from '../wishCatalog.js';

export const LEARN_MAX = 500;
export const LEARN_STATUS = ['pending', 'approved', 'rejected'];
const STOP = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'the', 'a', 'an', 'bitte', 'please', 'mal', 'doch', 'denn', 'eigentlich', 'gerade', 'jetzt', 'now', 'just']);

// Which Lotse skill answers a card of the wish catalogue (shared/wishCatalog.js) – the same reading as understand.js
// fromIntent(); a project / team named in the question refines it there.
export const CARD_SKILL = Object.freeze({
  realCapacity: 'realCapacity', fitsNoOvertime: 'fits', overtime: 'overtime', similarWork: 'estimate', supportTopics: 'supportTopics', attention: 'today',
  waterline: 'waterline', utilization: 'realCapacity', blocked: 'blockers', overdue: 'portfolioBrief', health: 'portfolioBrief', progress: 'portfolioBrief',
  hours: 'planActualExplain', support: 'dispatchAdvice', dependencies: 'blockers', quality: 'gapsFix', milestones: 'portfolioBrief', maturity: 'portfolioBrief', ranking: 'portfolioBrief',
});
export const skillOfCard = (card) => (typeof card === 'string' && CARD_SKILL[card]) || null;

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = (ctx) => {
  const c = ctx?.computed;
  const ds = ctx?.ds || c?.model?.ds || {};
  const out = [];
  for (const p of c?.model?.items || ds.portfolio || []) if (p?.name) out.push(fold(p.name));
  for (const t of c?.model?.teams?.values?.() || ds.teams || []) if (t?.name) out.push(fold(t.name));
  for (const p of Object.values(ds.people || {})) if (p?.name) { const f = fold(p.name); out.push(f); const first = f.split(' ')[0]; if (first.length >= 3) out.push(first); }
  return [...new Set(out.filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
};

// The pattern of a question: folded, typo-repaired, without the wish prefix ("ich will …"), names → {name}, keys →
// {key}, quarters → {quarter}, numbers → {n}; only plain words survive (no digits, no symbols), at most 14 words.
export function patternOf(text, ctx = {}) {
  let q = fixTypos(fold(String(text || '').slice(0, 300)));
  q = q.replace(WISH_PREFIX, ' ');
  q = q.replace(/\b[a-z][a-z0-9_]{1,19}-\d{1,9}\b/g, ' {key} ');
  q = q.replace(/\b(?:q[1-4](?:\s*\/?\s*\d{4})?|\d{4}\s*-?\s*q[1-4])\b/g, ' {quarter} ');
  for (const n of names(ctx)) q = q.replace(new RegExp(`(^|[^a-z0-9])${esc(n)}(?=[^a-z0-9]|$)`, 'g'), '$1 {name} ');
  q = q.replace(/[+-]?\d+(?:[.,]\d+)?/g, ' {n} ');
  const words = q.replace(/[^a-z{} -]+/g, ' ').split(/\s+/).filter((w) => w && (/^\{(name|key|quarter|n)\}$/.test(w) || /^[a-z][a-z-]{0,29}$/.test(w)) && !STOP.has(w));
  const out = [];
  for (const w of words) if (!(w.startsWith('{') && out.at(-1) === w)) out.push(w); // "{name} {name}" → one
  return out.slice(0, 14).join(' ').slice(0, 160);
}
const tokens = (p) => new Set(String(p || '').split(' ').filter((w) => w && !w.startsWith('{')));
const jaccard = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return a.size + b.size - n ? n / (a.size + b.size - n) : 0; };

// The approved pattern that fits a question best (exact, or ≥ 75 % of the same words with at least two words) → skill.
export function learnedSkill(text, ctx = {}) {
  const list = (ctx?.learned || []).filter((l) => l && typeof l.pattern === 'string' && !l.tool && (l.status === undefined || l.status === 'approved') && (l.skill || skillOfCard(l.card)));
  if (!list.length) return null;
  const p = patternOf(text, ctx);
  if (!p) return null;
  const mine = tokens(p);
  let best = null;
  for (const l of list) {
    const score = l.pattern === p ? 1 : mine.size >= 2 ? jaccard(mine, tokens(l.pattern)) : 0;
    if (score >= 0.75 && (!best || score > best.score)) best = { skill: l.skill || skillOfCard(l.card), card: l.card || null, pattern: l.pattern, score };
  }
  return best;
}

const idOf = (pattern) => { let h = 2166136261; for (const ch of pattern) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return `l-${(h >>> 0).toString(36)}`; };
const isoDay = (now) => new Date(Number.isFinite(now) ? now : Date.now()).toISOString().slice(0, 10);

// A candidate as it may be stored – nothing else: id, pattern, card, skill, how often, first/last day, status.
export function validCandidate(x) {
  if (!x || typeof x !== 'object') return null;
  const tool = typeof x.tool === 'string' && TOOL_RE.test(x.tool) ? x.tool : null;
  const pattern = typeof x.pattern === 'string' ? x.pattern.trim().slice(0, 160) : '';
  if (!pattern || tokens(pattern).size < 1 || !/^[a-z{} -]+$/.test(pattern)) return null;
  const card = typeof x.card === 'string' && WISH_IDS.has(x.card) ? x.card : null;
  const skill = tool ? 'chain' : typeof x.skill === 'string' && /^[a-zA-Z]{2,32}$/.test(x.skill) ? x.skill : skillOfCard(card);
  if (!skill) return null;
  const day = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  return { id: idOf(tool ? `${pattern}|${tool}` : pattern), pattern, card, skill, ...(tool ? { tool } : {}), n: Math.max(1, Math.min(1e6, Math.round(+x.n || 1))), first: day(x.first), last: day(x.last), status: LEARN_STATUS.includes(x.status) ? x.status : 'pending', ...(day(x.reviewed) ? { reviewed: day(x.reviewed) } : {}) };
}

// A new observation: the same pattern counts up (a rejected one stays rejected), a new one is added as 'pending'.
// Over 500: the oldest rejected go first, then the oldest pending; approved ones are never dropped.
export function addCandidate(list, { pattern, card, skill, tool }, now) {
  const today = isoDay(now);
  const c = validCandidate({ pattern, card, skill, tool, first: today, last: today });
  const cur = (Array.isArray(list) ? list : []).map(validCandidate).filter(Boolean);
  if (!c) return { list: cur, added: null };
  const i = cur.findIndex((x) => x.id === c.id);
  if (i >= 0) {
    const x = cur[i];
    cur[i] = { ...x, n: x.n + 1, last: today, ...(x.status === 'pending' && x.card !== c.card && c.card ? { card: c.card, skill: c.skill } : {}) };
    return { list: cur, added: cur[i] };
  }
  cur.push(c);
  while (cur.length > LEARN_MAX) {
    const drop = ['rejected', 'pending'].map((s) => cur.filter((x) => x.status === s).sort((a, b) => String(a.last).localeCompare(String(b.last)))[0]).find(Boolean);
    if (!drop) break;
    cur.splice(cur.indexOf(drop), 1);
  }
  return { list: cur, added: cur.find((x) => x.id === c.id) || null };
}

// An admin's decision: approve / reject / back to pending (undo). Returns the new list and the previous status.
export function reviewCandidate(list, { id, decision }, now) {
  const to = { approve: 'approved', reject: 'rejected', pending: 'pending', approved: 'approved', rejected: 'rejected' }[decision];
  if (!to) throw Object.assign(new Error('decision'), { code: 'INVALID' });
  const cur = (Array.isArray(list) ? list : []).map(validCandidate).filter(Boolean);
  const i = cur.findIndex((x) => x.id === id);
  if (i < 0) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  const previous = cur[i].status;
  const { reviewed, ...rest } = cur[i];
  cur[i] = to === 'pending' ? { ...rest, status: 'pending' } : { ...rest, status: to, reviewed: isoDay(now) };
  return { list: cur, item: cur[i], previous };
}

// What every person's Lotse reads: the approved patterns only (pattern → skill), newest first.
export const approvedOnly = (list) => (Array.isArray(list) ? list : []).map(validCandidate).filter((x) => x && x.status === 'approved').map(({ id, pattern, card, skill, tool }) => ({ id, pattern, card, skill, ...(tool ? { tool } : {}) }));

// Chains learn too: a clause the AI planner mapped to a catalogue tool (chain/llm.js) – the same masked pattern, the tool
// id instead of a card; approved ones reach chain/plan.js mapClause (ctx.learned) before Lotse's own rules.
const TOOL_RE = /^[a-z][a-zA-Z0-9]{1,24}(\.[a-zA-Z0-9]{2,32})?$/;
export function learnedTool(text, ctx = {}) {
  const list = (ctx?.learned || []).filter((l) => l && typeof l.pattern === 'string' && typeof l.tool === 'string' && TOOL_RE.test(l.tool) && (l.status === undefined || l.status === 'approved'));
  if (!list.length) return null;
  const p = patternOf(text, ctx);
  if (!p) return null;
  const mine = tokens(p);
  let best = null;
  for (const l of list) {
    const score = l.pattern === p ? 1 : mine.size >= 2 ? jaccard(mine, tokens(l.pattern)) : 0;
    if (score >= 0.75 && (!best || score > best.score)) best = { tool: l.tool, pattern: l.pattern, score };
  }
  return best;
}
