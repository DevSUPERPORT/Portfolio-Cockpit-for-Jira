// KI-Assistent: what each screen sends to `ai.assist` – built from what the screen already shows the user (their own
// dataset, already within the role's privacy scope). Pure. The server minimises again (shared/aiAssist.js
// buildFacts): it keeps only whitelisted fields, turns people into handles and drops texts unless allowed.
import { OPT_MODES } from './optimize.js';
import { componentNames } from './dispatch.js';
import { sizeHours } from './engine.js';
import { smartSuggestions } from './smart.js';

// Wochenplanung › Optimieren: every deterministic suggestion of all three modes, plus the unsolved notes.
export function planningPayload(all, { target = 1, distribution = 'even', logTasks = 0, pending = 0 } = {}) {
  const suggestions = OPT_MODES.flatMap((m) => all?.[m]?.suggestions || []).slice(0, 40).map((s) => ({
    id: s.id, mode: s.mode, kind: s.kind || null, taskId: s.taskId, key: s.key, summary: s.summary, project: s.project, rank: s.rank,
    personId: s.personId, personName: s.personName, toPersonId: s.toPersonId || null, toPersonName: s.toPersonName || null,
    start: s.start, due: s.due, newStart: s.newStart, newDue: s.newDue, fromWeeks: s.fromWeeks, toWeeks: s.toWeeks, weeksSaved: s.weeksSaved, shiftWeeks: s.shiftWeeks,
    fixed: s.fixed?.length || 0, fromLoad: s.fromLoad || [], toLoad: s.toLoad || [],
  }));
  const notes = OPT_MODES.flatMap((m) => (all?.[m]?.notes || []).map((n) => ({ mode: m, why: n.why || null, personId: n.personId || null, personName: n.personName || null, overWeeks: n.overWeeks?.length || 0 }))).slice(0, 12);
  return { target, distribution, logTasks, pending, counts: Object.fromEntries(OPT_MODES.map((m) => [m, all?.[m]?.count || 0])), suggestions, notes };
}

const below = (model, rid) => {
  const out = []; const stack = [...(model.children.get(rid) || [])];
  while (stack.length) { const x = stack.pop(); out.push(x); stack.push(...(model.children.get(x.id) || [])); }
  return out;
};
// Fehlende Werte: one gap with the similar work items around it (siblings first, then the same level in the project).
export function gapPayload(computed, g, lang = 'de') {
  const { model } = computed;
  const issue = g.isItem ? null : model.byId.get(g.issueId);
  const item = model.itemByRef.get(g.rootRef);
  const parent = issue?.parentId ? model.byId.get(issue.parentId) : null;
  const shape = (i, relation) => ({ key: i.key, level: i.levelKey || i.role, relation, done: (i.status?.cat ?? i.statusCat) === 'done', summary: i.summary || i.name || null, oe: i.oe || 0, teamId: i.team?.id || i.leadTeam?.id || null, tshirt: i.tshirt || null, start: i.start || null, due: i.due || null, quarters: i.quarters || [] });
  let pool;
  if (issue) {
    const sib = (model.children.get(issue.parentId) || []).filter((x) => x.id !== issue.id && x.role === issue.role).map((x) => shape(x, 'sibling'));
    const same = (model.byRoot.get(g.rootRef) || []).filter((x) => x.id !== issue.id && x.role === issue.role && x.parentId !== issue.parentId).map((x) => shape(x, 'project'));
    pool = [...sib, ...same];
  } else {
    pool = below(model, item?.id).filter((x) => x.role === 'rough' || x.role === 'structure').map((x) => shape(x, 'project'));
  }
  const has = (x) => ({ originalEstimate: x.oe > 0, team: !!x.teamId, tshirt: !!x.tshirt, startDate: !!x.start, dueDate: !!x.due, targetQuarters: x.quarters.length > 0 }[g.field]);
  const similar = [...pool.filter(has), ...pool.filter((x) => !has(x))].slice(0, 12);
  const rule = smartSuggestions(computed, { lang, gaps: [g] })[0] || null;
  const self = issue || item || {};
  return {
    gap: { id: g.id, key: g.key || item?.key || null, usage: g.field, rule: g.rule, level: g.levelKey, isItem: !!g.isItem, urgent: !!g.urgent, summary: g.summary || null,
      start: self.start || null, due: self.due || null, oe: self.oe || 0, teamId: self.team?.id || null, tshirt: self.tshirt || null,
      parent: parent ? { key: parent.key, start: parent.start || null, due: parent.due || null, teamId: parent.team?.id || null } : null,
      project: item ? { rank: item.rank, key: item.key, name: item.name } : null },
    similar,
    teams: [...model.teams.values()].map((t) => ({ id: t.id, name: t.name })),
    sizes: (model.cfg.tshirtSizes || []).map((t) => ({ key: t.key, hours: sizeHours(model, t.key) })),
    milestones: (computed.milestones || []).filter((m) => m.date).map((m) => ({ date: m.date, name: m.name })),
    rule: rule ? { value: rule.value, why: rule.why } : null,
  };
}

// Support › Verteilen: the chosen tickets, the teams with their members' load this week, component knowledge.
export function dispatchPayload({ tickets, teams, members, suggTeam, history, mapping = {}, personName, absent = () => false, max = 8 }) {
  const now = Date.now();
  return {
    tickets: tickets.slice(0, Math.min(100, Math.max(1, max))).map((r) => ({
      id: r.id, key: r.key, priority: r.priority || null, slaStatus: r.sla?.status || null, slaLeftH: r.sla?.remainingH ?? null, ageH: r.created ? Math.round((now - Date.parse(r.created)) / 3600e3) : null,
      components: componentNames(r), summary: r.summary || null, teamId: r.team?.id || null, suggestedTeamId: suggTeam.get(r.id)?.teamId || null, suggestionSource: suggTeam.get(r.id)?.source || null, suggestionBasis: suggTeam.get(r.id)?.basis || null, suggestionWords: suggTeam.get(r.id)?.words || null,
    })),
    teams: teams.slice(0, 20).map((t) => ({ id: t.id, name: t.name, members: (members.get(t.id) || []).slice(0, 12).map((p) => ({ id: p.id, name: personName(p.id), load: p.cap > 0 ? (p.plan || 0) / p.cap : null, cap: p.cap > 0 ? Math.round(p.cap * 10) / 10 : null, absent: !(p.cap > 0) || absent(p.id) })) })),
    mapping: Object.entries(mapping || {}).slice(0, 30).map(([component, teamId]) => ({ component, teamId })),
    history: [...(history || new Map()).entries()].slice(0, 30).map(([component, teamId]) => ({ component, teamId })),
  };
}

// Plan vs. Ist: the analysed numbers (shared/planActual.js analyzePlanActual) – people only as the screen shows them.
export function planActualPayload(a, { weeks, teamName } = {}) {
  return {
    period: a.period, weeks, teamName: teamName || null, kpis: a.kpis,
    rows: a.rows.map((r) => ({ key: r.key, kind: r.kind, name: r.name, rank: r.rank, plan: r.plan, book: r.book, diff: r.diff, sig: r.sig })),
    why: a.why.map((w) => ({ key: w.key, name: w.name, rank: w.rank, diff: w.diff, parts: w.parts.map((x) => ({ k: x.k, h: x.h })), who: w.who, whoHidden: w.whoHidden, over: w.over.map((o) => ({ key: o.key, extra: o.extra })) })),
    people: a.people.map((u) => ({ id: u.id, kind: u.kind, name: u.name, teamName: u.teamName, n: u.n, plan: u.plan, book: u.book, pct: u.pct, absU: u.absU })),
  };
}

// Meine Arbeit: only the caller's own booked cells of the week and their own Jira activity.
export function myWeekPayload({ data, evidence, from, to }) {
  const byId = new Map([...(data?.issues || []), ...(evidence?.issues || [])].map((i) => [String(i.id), i]));
  const cells = new Map();
  for (const w of data?.worklogs || []) {
    if (w.d < from || w.d > to) continue;
    const k = `${w.issueId}|${w.d}`;
    const c = cells.get(k) || cells.set(k, { issueId: String(w.issueId), d: w.d, h: 0, comments: [] }).get(k);
    c.h += w.h || 0;
    if (w.c) c.comments.push(w.c);
  }
  return {
    from, to,
    cells: [...cells.values()].filter((c) => c.h > 0 && byId.has(c.issueId)).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)).slice(0, 40)
      .map((c) => { const i = byId.get(c.issueId); return { issueId: c.issueId, key: i.key, d: c.d, h: Math.round(c.h * 100) / 100, comment: c.comments.join(' / '), summary: i.summary || null, project: i.project?.key || null }; }),
    events: (evidence?.events || []).filter((e) => e.d >= from && e.d <= to).slice(0, 40).map((e) => ({ issueId: String(e.issueId), key: byId.get(String(e.issueId))?.key || null, d: e.d, kind: e.kind, from: e.from || null, to: e.to || null, text: e.text || null })),
  };
}
