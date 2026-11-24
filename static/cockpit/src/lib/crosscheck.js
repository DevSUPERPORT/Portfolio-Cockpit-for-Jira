// Independent cross-check ("Gegenprobe"): recounts the core numbers of every project straight from Jira, as the
// signed-in user, with its own JQL and its own sums. It shares NO code with the engine (shared/engine.js) – so if
// both agree, the number is right; if they disagree, the difference is shown with both values.
import { jiraRead } from './api.js';

const FIELDS = ['issuetype', 'status', 'parent', 'duedate', 'timeoriginalestimate', 'aggregatetimeoriginalestimate', 'timespent', 'aggregatetimespent', 'timeestimate', 'aggregatetimeestimate'];
const H = (sec) => (sec || 0) / 3600;

async function search(jql) {
  const out = [];
  let next = null;
  for (let page = 0; page < 20; page++) {
    const r = await jiraRead('/rest/api/3/search/jql', { jql, fields: FIELDS, maxResults: 100, ...(next ? { nextPageToken: next } : {}) });
    out.push(...(r.issues || []));
    if (!r.nextPageToken || r.isLast) break;
    next = r.nextPageToken;
  }
  return out;
}

// Everything below a portfolio item: children, grandchildren, … (at most 6 levels), or a whole space.
async function below(item) {
  if (item.kind === 'space') return search(`project = ${item.id}`);
  const all = [];
  let frontier = [item.key];
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    const next = [];
    for (let k = 0; k < frontier.length; k += 50) {
      const found = await search(`parent in (${frontier.slice(k, k + 50).join(',')})`);
      all.push(...found);
      next.push(...found.map((i) => i.key));
    }
    frontier = next;
  }
  return all;
}

// The numbers, recounted. storyTypes / tinyTypes from the configuration; blocked = the configured statuses or the name.
export async function crossCheck(ds, { onProgress } = {}) {
  const levels = ds.config?.levels || [];
  const storyTypes = new Set(levels.filter((l) => l.role === 'estimate').flatMap((l) => l.issueTypeIds.map(String)));
  const tinyTypes = new Set(levels.filter((l) => l.role === 'tiny').flatMap((l) => l.issueTypeIds.map(String)));
  const blockedIds = new Set((ds.config?.dependencies?.blockedStatusIds || []).map(String));
  const isBlocked = (st) => (blockedIds.size ? blockedIds.has(String(st?.id)) : /^(blocked|blockiert)$/i.test(String(st?.name || '').trim()));
  const today = ds.today;
  const items = [...ds.portfolio].sort((a, b) => a.rank - b.rank);
  const out = [];
  for (const [n, p] of items.entries()) {
    onProgress?.(n, items.length, p.name);
    try {
      const issues = await below(p);
      const stories = issues.filter((i) => storyTypes.has(String(i.fields.issuetype?.id)));
      const open = (i) => i.fields.status?.statusCategory?.key !== 'done';
      out.push({
        ref: p.ref, ok: true,
        stories: stories.length,
        OE: stories.reduce((a, i) => a + H(i.fields.aggregatetimeoriginalestimate ?? i.fields.timeoriginalestimate), 0),
        TS: stories.reduce((a, i) => a + H(i.fields.aggregatetimespent ?? i.fields.timespent), 0),
        RE: stories.filter(open).reduce((a, i) => a + H(i.fields.aggregatetimeestimate ?? i.fields.timeestimate), 0),
        overdue: stories.filter((i) => open(i) && i.fields.duedate && i.fields.duedate < today).length,
        blocked: issues.filter((i) => (storyTypes.has(String(i.fields.issuetype?.id)) || tinyTypes.has(String(i.fields.issuetype?.id))) && open(i) && isBlocked(i.fields.status)).length,
      });
    } catch (e) {
      out.push({ ref: p.ref, ok: false, error: e.message || String(e) });
    }
  }
  onProgress?.(items.length, items.length, '');
  return out;
}

// The cockpit's own values for the same numbers (from the engine), and the comparison.
export const CHECKS = [
  { key: 'stories', label: ['Stories', 'Stories'], tol: 0, unit: '' },
  { key: 'OE', label: ['Original Estimate', 'Original estimate'], tol: 0.5, unit: 'h' },
  { key: 'TS', label: ['Time Spent', 'Time spent'], tol: 0.5, unit: 'h' },
  { key: 'RE', label: ['Remaining', 'Remaining'], tol: 0.5, unit: 'h' },
  { key: 'overdue', label: ['Über Due Date', 'Past due'], tol: 0, unit: '' },
  { key: 'blocked', label: ['Blocked', 'Blocked'], tol: 0, unit: '' },
];
export function compare(computed, jira) {
  const { model, metrics, deps } = computed;
  return jira.map((j) => {
    const m = metrics.get(j.ref);
    if (!j.ok || !m) return { ref: j.ref, ok: false, error: j.error || 'no metrics', cells: [] };
    const app = {
      stories: m.storyCount, OE: m.OE, TS: m.TS, RE: m.RE, overdue: m.overdueCount,
      blocked: (deps.blocked || []).filter((b) => model.byId.get(b.id)?.rootRef === j.ref).length,
    };
    const cells = CHECKS.map((c) => ({ key: c.key, app: app[c.key], jira: j[c.key], match: Math.abs((app[c.key] || 0) - (j[c.key] || 0)) <= c.tol }));
    return { ref: j.ref, ok: cells.every((c) => c.match), cells };
  });
}
