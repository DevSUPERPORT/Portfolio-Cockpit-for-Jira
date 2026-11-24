// Forecast accuracy ("Treffsicherheit"): did our numbers predict reality? For finished stories, rebuild from the
// Jira history what the cockpit would have said halfway through – Time Spent so far + Remaining Estimate at that
// day – and compare with what the story really cost. The same for the Original Estimate (the plan at the start).
// Raw material only: worklogs with their dates and the changelog of the Remaining Estimate.
import { jiraRead } from './api.js';
import { dayIdx } from '@shared/dates.js';
import { evaluate } from '@shared/accuracy.js';
export { evaluate };

const MAX = 120;

// Load the raw history for finished stories (most recent first, at most 120) and evaluate.
export async function forecastAccuracy(ds, { onProgress } = {}) {
  const tiny = new Map();
  for (const i of ds.issues || []) if (i.role === 'tiny' && i.parentId) (tiny.get(i.parentId) || tiny.set(i.parentId, []).get(i.parentId)).push(i);
  const done = (ds.issues || []).filter((i) => i.role === 'estimate' && i.status?.cat === 'done' && i.oe > 0 && i.ts > 0)
    .map((i) => ({ i, logs: [...(i.worklogs || []), ...(tiny.get(i.id) || []).flatMap((t) => t.worklogs || [])] }))
    .filter((x) => x.logs.length)
    .sort((a, b) => Math.max(...b.logs.map((w) => dayIdx(w.d) || 0)) - Math.max(...a.logs.map((w) => dayIdx(w.d) || 0)))
    .slice(0, MAX);
  const stories = [];
  for (const [k, { i, logs }] of done.entries()) {
    onProgress?.(k, done.length);
    let changes = [];
    try {
      const r = await jiraRead(`/rest/api/3/issue/${i.id}/changelog?maxResults=100`);
      const values = (r.total || 0) > 100 ? (await jiraRead(`/rest/api/3/issue/${i.id}/changelog?startAt=${r.total - 100}&maxResults=100`)).values : r.values;
      for (const h of values || []) {
        for (const it of h.items || []) {
          if (it.field !== 'timeestimate') continue;
          changes.push({ day: dayIdx(String(h.created).slice(0, 10)), from: it.from == null ? null : Number(it.from) / 3600, to: it.to == null ? 0 : Number(it.to) / 3600 });
        }
      }
      changes = changes.filter((c) => c.day != null).sort((a, b) => a.day - b.day);
    } catch { /* no history readable: the story is left out, not guessed */ }
    stories.push({ id: i.id, key: i.key, summary: i.summary, rootRef: i.rootRef, oe: i.oe, final: i.ts, worklogs: logs.map((w) => ({ d: w.d, h: w.h })), changes });
  }
  onProgress?.(done.length, done.length);
  return { ...evaluate(stories), candidates: done.length };
}
