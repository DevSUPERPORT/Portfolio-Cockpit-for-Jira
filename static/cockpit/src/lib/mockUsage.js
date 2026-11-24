// Local design work only: believable usage counts for the last 30 days and a few "Lotse learns" candidates, kept in
// memory. The same pure rules as the server (shared/usage.js, shared/lotse/learn.js). Never in a production bundle.
import { mergeDay, usageSummary, usageDays } from '@shared/usage.js';
import { addCandidate, reviewCandidate, approvedOnly, patternOf, skillOfCard, validCandidate } from '@shared/lotse/learn.js';

const days = new Map();
let seeded = false;
function seed() {
  if (seeded) return;
  seeded = true;
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  usageDays().forEach((day, i) => {
    const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) return;
    const k = 0.6 + i / 40;
    const n = (base) => Math.max(0, Math.round(base * k * (0.6 + rnd() * 0.8)));
    days.set(day, mergeDay(null, {
      'view:portfolio': n(14), 'view:mine': n(22), 'view:project': n(9), 'view:team': n(6), 'view:support': n(5), 'view:plan': n(4), 'view:ask': n(3),
      'lotse:ask': n(8), 'lotse:story:today': n(6), 'lotse:story:projectBrief': n(4), 'lotse:story:myWeek': n(5), 'lotse:story:waterline': n(2), 'lotse:story:bookingComments': n(2),
      'lotse:action:navigate': n(4), 'lotse:action:fill': n(1), 'lotse:action:move': n(1), 'ai:projectBrief': n(2), 'ai:myWeek': n(1), 'ai:lotse': n(2), 'ai:gaps': n(1),
      write: n(7), undo: n(0.6), 'teamwork:same': n(2), 'teamwork:differs': n(0.7), 'teamwork:pick:lotse': n(1.2), 'teamwork:pick:ai': n(0.5),
      'lotse:workflow:weekClose:start': n(1.5), 'lotse:workflow:weekClose:done': n(1.2), 'lotse:workflow:weekClose:cancel': n(0.3), 'report:pdf': n(0.4),
    }));
  });
}
export function mockUsageTrack(p) { seed(); const day = new Date().toISOString().slice(0, 10); days.set(day, mergeDay(days.get(day), p?.events || {})); return { stored: Object.keys(p?.events || {}).length }; }
export function mockUsageSummary() { seed(); return usageSummary([...days].map(([day, d]) => ({ day, counts: d.counts }))); }

let learned = [
  { pattern: 'wo brennt es', card: 'attention', skill: 'today', n: 4, first: '2026-11-03', last: '2026-11-11', status: 'pending' },
  { pattern: 'wie viel luft hat team {name}', card: 'realCapacity', skill: 'realCapacity', n: 3, first: '2026-11-05', last: '2026-11-12', status: 'pending' },
  { pattern: 'was haengt fest', card: 'blocked', skill: 'blockers', n: 6, first: '2026-10-28', last: '2026-11-10', status: 'approved', reviewed: '2026-11-04' },
].map(validCandidate);
export function mockLearned(admin) { return { approved: approvedOnly(learned), ...(admin ? { items: learned } : {}) }; }
export function mockLearnReview(p) { const r = reviewCandidate(learned, { id: p?.id, decision: p?.decision }); learned = r.list; return { item: r.item, previous: r.previous }; }
// as the server after ai.assist(intent) with lotseMissed: only the masked phrase pattern
// as the server for 'lotse.llm' mode 'learn': the clauses of an accepted AI chain plan, masked, with their tool
export function mockLearnChain(clauses, ds) {
  let n = 0;
  for (const c of (Array.isArray(clauses) ? clauses : []).slice(0, 6)) {
    const pattern = patternOf(c?.text || '', { ds });
    if (pattern.split(' ').filter((w) => w && !w.startsWith('{')).length < 2 || typeof c.tool !== 'string') continue;
    const r = addCandidate(learned, { pattern, tool: c.tool });
    learned = r.list;
    if (r.added) n += 1;
  }
  return { added: n };
}
export function mockLearnFromAi(wish, card, ds) {
  const pattern = patternOf(wish, { ds });
  if (pattern.split(' ').filter((w) => w && !w.startsWith('{')).length < 2 || !skillOfCard(card)) return;
  learned = addCandidate(learned, { pattern, card, skill: skillOfCard(card) }).list;
}
