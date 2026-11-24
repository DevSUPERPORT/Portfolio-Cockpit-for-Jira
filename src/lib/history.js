// History for the insights (shared/insights.js): done stories and resolved support tickets, read AS THE USER –
// Jira decides what someone may see. Nothing is cached or stored on the server (raw lists keyed by person would
// be personal data); rows are compact, carry no names and no comment texts.
//
// Resolvers to register (both read-only):
//
//   'insights.history'  payload { months?: 1–24 (default 12), supportMonths?: 1–12 (default 6) }
//     → { asOf, months, supportMonths, since, supportSince, personLevel, truncated: { stories, support },
//         stories: [{ id, key, summary, type, projectKey, components[], labels[], team:{id,name}|null, assignee:id|null,
//                     oe, ts (h, story totals incl. sub-tasks), created, start, resolved, parentId, parentKey,
//                     parentSummary, statusCat:'done' }],
//         support: [{ id, key, summary, requestType, components[], labels[], team:{id,name}|null, assignee:id|null,
//                     spentH, created, resolved, statusCat:'done', worklogs: [{ d, h, a:id|null }] }] }
//     def('insights.history', ({ payload, ctx, cfg, roles }) =>
//       loadHistory({ cfg, as: 'user', months: payload?.months, supportMonths: payload?.supportMonths, roles, accountId: ctx.accountId }));
//
//   'insights.comments' payload { ids: string[] (≤ 20 issue ids), texts?: boolean }
//     → { [id]: { count, last: [{ created, text }] } }   (last = up to 3 newest texts, only with texts: true)
//     Pass texts: true only when the texts may go to the AI: aiAllowed(cfg, feature) && cfg.ai.shareTexts.
//     def('insights.comments', ({ payload, cfg }) =>
//       loadComments(payload?.ids, { as: 'user', texts: !!payload?.texts && cfg.ai?.enabled === true && cfg.ai?.shareTexts === true }));
//
// Privacy: account ids of people outside the caller's visible scope (roles.logs, personLevel) become null – the same
// scope as the dataset (src/lib/dataset.js). Per-person values in the insights then only exist for visible people.
import { searchAll, jira, chunk, pool } from './jira.js';
import { K, get } from './store.js';
import { appFieldIds, adfText } from './dataset.js';
import { supportJql } from './config.js';
import { visiblePeople } from '../../shared/roles.js';

export const STORY_CAP = 2000;
export const SUPPORT_CAP = 1000; // together the 3000-item cap
export const MAX_COMMENT_ISSUES = 20;
const ID_RE = /^\d{1,18}$/;
const H = (sec) => (sec ? Math.round((sec / 3600) * 100) / 100 : 0);
const dateOf = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const teamOf = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return { id: v, name: v };
  return v.id ? { id: String(v.id), name: v.name || v.title || String(v.id) } : null;
};
const clampInt = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

// Projects of the portfolio: the spaces themselves, or the spaces of the portfolio work items.
async function portfolioProjectIds(as, cfg) {
  const state = (await get(K.portfolio)) || { items: [] };
  const refs = (state.items || []).map((x) => String(x.ref || ''));
  if (cfg.portfolio?.source === 'issue') {
    const ids = refs.filter((r) => r.startsWith('issue:')).map((r) => r.slice(6)).filter((x) => ID_RE.test(x));
    const pages = await pool(chunk(ids, 100), 4, (c) => searchAll(as, `id in (${c.join(',')})`, ['project'], { limit: 100 }).catch(() => ({ issues: [] })));
    return [...new Set(pages.flatMap((p) => p.issues.map((i) => String(i.fields?.project?.id || ''))).filter((x) => ID_RE.test(x)))];
  }
  return [...new Set(refs.filter((r) => r.startsWith('space:')).map((r) => r.slice(6)).filter((x) => ID_RE.test(x)))];
}

export async function loadHistory({ cfg, as = 'user', months = 12, supportMonths = 6, roles = {}, accountId = null }) {
  const m = clampInt(months, 1, 24, 12), sm = clampInt(supportMonths, 1, 12, 6);
  const days = Math.round(m * 30.4), supDays = Math.round(sm * 30.4);
  const now = Date.now();
  const app = await appFieldIds();
  const teamF = /^customfield_\d{1,10}$/.test(cfg.fields?.team || '') ? cfg.fields.team : null;
  const startF = /^customfield_\d{1,10}$/.test(cfg.fields?.startDate || '') ? cfg.fields.startDate : null;
  const capRaw = (await get(K.capacity)) || { people: {}, teams: {} };
  const keep = cfg.rules?.personLevel === false ? new Set(accountId ? [accountId] : []) : visiblePeople({ logs: roles.logs ?? 'all', accountId, capacity: capRaw });
  const person = (id) => (!id ? null : !keep || keep.has(id) ? id : null);

  const loadStories = async () => {
    const projectIds = await portfolioProjectIds(as, cfg);
    if (!projectIds.length) return { rows: [], truncated: false };
    const typeIds = (cfg.levels || []).filter((l) => l.role === 'estimate').flatMap((l) => l.issueTypeIds || []).map(String).filter((x) => ID_RE.test(x));
    const typeJql = typeIds.length ? `issuetype in (${typeIds.join(',')})` : 'issuetype in standardIssueTypes()';
    const fields = ['summary', 'issuetype', 'components', 'labels', 'assignee', 'timeoriginalestimate', 'timespent', 'aggregatetimeoriginalestimate',
      'aggregatetimespent', 'created', 'resolutiondate', 'status', 'parent', 'project', teamF, startF].filter(Boolean);
    const groups = chunk(projectIds, 10);
    const per = Math.max(300, Math.ceil(STORY_CAP / groups.length));
    const pages = await pool(groups, 4, (c) => searchAll(as, `project in (${c.join(',')}) AND statusCategory = Done AND resolved >= -${days}d AND ${typeJql} ORDER BY resolved DESC`, fields, { limit: per }));
    let truncated = pages.some((p) => p.truncated);
    let rows = [];
    for (const p of pages) {
      for (const raw of p.issues) {
        const f = raw.fields || {};
        // without configured levels: stories are the standard types at hierarchy level 0 (no epics, no sub-tasks)
        if (!typeIds.length && (f.issuetype?.hierarchyLevel ?? 0) !== 0) continue;
        rows.push({
          id: raw.id, key: raw.key, summary: String(f.summary || '').slice(0, 200), type: f.issuetype?.name || null, projectKey: f.project?.key || '',
          components: (f.components || []).map((c) => c.name).slice(0, 10), labels: (f.labels || []).slice(0, 10),
          team: teamF ? teamOf(f[teamF]) : null, assignee: person(f.assignee?.accountId),
          oe: H(f.aggregatetimeoriginalestimate ?? f.timeoriginalestimate), ts: H(f.aggregatetimespent ?? f.timespent),
          created: dateOf(f.created), start: startF ? dateOf(f[startF]) : null, resolved: dateOf(f.resolutiondate),
          parentId: f.parent?.id || null, parentKey: f.parent?.key || null, parentSummary: f.parent?.fields?.summary ? String(f.parent.fields.summary).slice(0, 200) : null,
          statusCat: 'done',
        });
      }
    }
    rows.sort((a, b) => String(b.resolved).localeCompare(String(a.resolved)) || String(a.key).localeCompare(String(b.key)));
    if (rows.length > STORY_CAP) { rows = rows.slice(0, STORY_CAP); truncated = true; }
    return { rows, truncated };
  };

  const loadSupportRows = async () => {
    const jql = supportJql(cfg);
    if (!jql) return { rows: [], truncated: false };
    const rtF = app.requestType || null;
    const { issues, truncated } = await searchAll(as, `${jql} AND statusCategory = Done AND resolved >= -${supDays}d ORDER BY resolved DESC`,
      ['summary', 'created', 'resolutiondate', 'labels', 'components', 'timespent', 'assignee', 'worklog', teamF, rtF].filter(Boolean), { limit: SUPPORT_CAP });
    return { truncated: !!truncated, rows: issues.slice(0, SUPPORT_CAP).map((raw) => {
      const f = raw.fields || {};
      return {
        id: raw.id, key: raw.key, summary: String(f.summary || '').slice(0, 140), requestType: rtF ? f[rtF]?.requestType?.name ?? null : null,
        components: (f.components || []).map((c) => c.name).slice(0, 10), labels: (f.labels || []).slice(0, 10),
        team: teamF ? teamOf(f[teamF]) : null, assignee: person(f.assignee?.accountId),
        spentH: H(f.timespent), created: dateOf(f.created), resolved: dateOf(f.resolutiondate), statusCat: 'done',
        // the search returns up to 20 worklogs per ticket – enough for support tickets; no names, no comments
        worklogs: (f.worklog?.worklogs || []).map((w) => ({ d: dateOf(w.started), h: H(w.timeSpentSeconds), a: person(w.author?.accountId) })).filter((w) => w.d && w.h > 0),
      };
    }) };
  };

  const [st, su] = await Promise.all([loadStories(), loadSupportRows().catch(() => ({ rows: [], truncated: false, failed: true }))]);
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  return {
    asOf: iso(now), months: m, supportMonths: sm, since: iso(now - days * 864e5), supportSince: iso(now - supDays * 864e5),
    personLevel: !keep, stories: st.rows, support: su.rows, truncated: { stories: st.truncated, support: su.truncated }, ...(su.failed ? { supportFailed: true } : {}),
  };
}

// Comments of a few work items (the similar-work hits): the count always, the three newest texts only when allowed.
// No authors – a text is about the work, not about who wrote it.
export async function loadComments(issueIds, { as = 'user', texts = false, max = MAX_COMMENT_ISSUES } = {}) {
  const ids = [...new Set((Array.isArray(issueIds) ? issueIds : []).map(String).filter((x) => ID_RE.test(x)))].slice(0, Math.min(MAX_COMMENT_ISSUES, max));
  const out = {};
  await pool(ids, 5, async (id) => {
    try {
      const r = await jira(as, `/rest/api/3/issue/${id}/comment`, { query: { orderBy: '-created', maxResults: texts ? 3 : 1 } });
      out[id] = {
        count: r.total ?? (r.comments || []).length,
        last: texts ? (r.comments || []).slice(0, 3).map((c) => ({ created: dateOf(c.created), text: (adfText(c.body) || '').slice(0, 600) })).filter((c) => c.text) : [],
      };
    } catch { /* not visible or gone: left out */ }
  });
  return out;
}
