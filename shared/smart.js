// Smart suggestions: rule-based, explainable proposals for data-quality gaps. No AI, no assistant, no guessing:
// every suggestion is derived from data that already exists in Jira, says exactly where the value comes
// from ("why"), and is only applied when a person clicks – through the same fill (and undo) as a manual edit.
//
// What is deliberately NOT suggested: original estimates without any figure in Jira, due dates for overdue
// work, and anything that would make a number look better than it is.
import { sizeHours, milestoneOf } from './engine.js';
import { dayIdx, quarterKeyOf, quartersFrom, compareQuarter } from './dates.js';

const T = (lang, de, en) => (lang === 'de' ? de : en);
const isOpen = (i) => (i?.status?.cat ?? i?.statusCat ?? 'new') !== 'done';

// Everything below an issue (children, grandchildren, …).
function below(model, id) {
  const out = [];
  const stack = [...(model.children.get(id) || [])];
  while (stack.length) { const x = stack.pop(); out.push(x); stack.push(...(model.children.get(x.id) || [])); }
  return out;
}
// The stories that make up a gap's target: below the epic, or the whole project for a portfolio item.
function storiesOf(model, g) {
  const all = g.isItem ? model.byRoot.get(g.rootRef) || [] : below(model, g.issueId);
  return all.filter((i) => i.role === 'estimate');
}
const teamName = (model, t) => (t ? model.teams.get(t.id)?.name || t.name || t.id : null);

// One rule per field. Each returns { value, show, why, basis } or null.
const RULES = {
  team(model, g, issue, L) {
    if (!g.isItem && issue && issue.role !== 'rough') {
      // Stories and sub-tasks: the team of the nearest level above that has one (the spec puts the team on the epic).
      let cur = issue.parentId ? model.byId.get(issue.parentId) : null;
      while (cur) {
        if (cur.team) return { value: cur.team.id, show: teamName(model, cur.team), why: T(L, `${cur.key} „${cur.summary}“ gehört zu diesem Team`, `${cur.key} "${cur.summary}" belongs to this team`), basis: 'parent' };
        cur = cur.parentId ? model.byId.get(cur.parentId) : null;
      }
      const item = model.itemByRef.get(g.rootRef);
      if (item?.leadTeam) return { value: item.leadTeam.id, show: teamName(model, item.leadTeam), why: T(L, `Lead-Team des Projekts „${item.name}“`, `lead team of the project "${item.name}"`), basis: 'project' };
      return null;
    }
    // Epics and projects: the team that clearly carries the stories below (at least 60 %).
    const stories = storiesOf(model, g).filter((s) => s.team);
    if (!stories.length) return null;
    const count = new Map();
    for (const s of stories) count.set(s.team.id, (count.get(s.team.id) || 0) + 1);
    const [id, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n / stories.length < 0.6) return null;
    const t = stories.find((s) => s.team.id === id).team;
    return { value: id, show: teamName(model, t), why: T(L, `${n} von ${stories.length} Stories mit Team gehören zu diesem Team`, `${n} of ${stories.length} stories with a team belong to this team`), basis: 'majority' };
  },
  tshirt(model, g, issue, L) {
    // The smallest size that covers what the stories below are already estimated at – a floor, never more.
    const stories = storiesOf(model, g);
    const oe = stories.reduce((a, s) => a + (s.oe || 0), 0);
    if (!(oe > 0)) return null;
    const sizes = [...(model.cfg.tshirtSizes || [])].map((t) => ({ key: t.key, hours: sizeHours(model, t.key) })).filter((t) => t.hours > 0).sort((a, b) => a.hours - b.hours);
    if (!sizes.length) return null;
    const fit = sizes.find((t) => t.hours >= oe) || sizes.at(-1);
    const over = fit.hours < oe;
    return {
      value: fit.key, show: `${fit.key} · ${Math.round(fit.hours)} h`, basis: 'floor',
      why: over
        ? T(L, `Stories darunter sind schon mit ${Math.round(oe)} h geschätzt – mehr als die größte Size; bitte prüfen`, `stories below are already estimated at ${Math.round(oe)} h – more than the largest size; please check`)
        : T(L, `Stories darunter sind schon mit ${Math.round(oe)} h geschätzt – ${fit.key} ist die kleinste Size, die das abdeckt (Untergrenze)`, `stories below are already estimated at ${Math.round(oe)} h – ${fit.key} is the smallest size that covers it (a lower bound)`),
    };
  },
  targetQuarters(model, g, issue, L) {
    // The quarters the stories below are scheduled in (from today on, at most four).
    const stories = storiesOf(model, g).filter((s) => isOpen(s) && (s.start || s.due));
    if (!stories.length) return null;
    const days = stories.flatMap((s) => [dayIdx(s.start), dayIdx(s.due)]).filter((d) => d != null);
    const from = quarterKeyOf(Math.max(Math.min(...days), model.today)), to = quarterKeyOf(Math.max(...days));
    if (compareQuarter(to, model.curQ) < 0) return null;
    const window = quartersFrom(model.curQ, 6);
    const qs = window.filter((q) => compareQuarter(q, from) >= 0 && compareQuarter(q, to) <= 0);
    if (!qs.length || qs.length > 4) return null;
    return { value: qs, show: qs, why: T(L, `${stories.length} offene Stories sind in diesem Zeitraum terminiert`, `${stories.length} open stories are scheduled in this period`), basis: 'schedule' };
  },
  originalEstimate(model, g, issue, L) {
    // Only a figure Jira already has: the remaining estimate of an open story.
    if (!issue || !isOpen(issue) || !(issue.re > 0)) return null;
    return { value: Math.round(issue.re * 2) / 2, show: `${Math.round(issue.re * 2) / 2} h`, why: T(L, 'Remaining Estimate ist schon gesetzt – als Original Estimate übernehmen', 'the remaining estimate is already set – use it as the original estimate'), basis: 'remaining' };
  },
  startDate(model, g, issue, L) {
    // The day work actually started: the first time logged.
    const d = (issue?.worklogs || []).map((w) => w.d).filter(Boolean).sort()[0];
    if (!d) return null;
    return { value: d, show: d, date: true, why: T(L, 'Erste Zeitbuchung an diesem Tag', 'time was first logged on this day'), basis: 'worklog' };
  },
  dueDate(model, g, issue, L) {
    // Only a missing date or one after its milestone; moving an overdue or out-of-range date is a decision, not a fix.
    // start after due (2026-11-17): a due date after the start that leaves time for the estimate (6 h of story work per
    // working day, at least one week) – the start stays, it is usually the date someone planned on purpose
    if (g.rule === 'datesInverted' && issue?.start) {
      const s0 = dayIdx(issue.start);
      if (s0 == null) return null;
      const days = Math.max(5, Math.ceil((issue.oe || 0) / 6));
      let d = s0, n = 1;
      while (n < days || ![1, 2, 3, 4, 5].includes(new Date(d * 864e5).getUTCDay())) { d++; if ([1, 2, 3, 4, 5].includes(new Date(d * 864e5).getUTCDay())) n++; }
      const iso = new Date(d * 864e5).toISOString().slice(0, 10);
      return { value: iso, show: iso, date: true, why: T(L, `Start bleibt – ${days} Arbeitstage für ${issue.oe ? `${issue.oe} h Schätzung` : 'die Story'}`, `the start stays – ${days} working days for ${issue.oe ? `${issue.oe} h of estimate` : 'the story'}`), basis: 'estimate' };
    }
    if (g.rule !== 'missing:dueDate' && g.rule !== 'dueAfterMilestone') return null;
    if (g.isItem) {
      const dues = storiesOf(model, g).filter(isOpen).map((s) => s.due).filter(Boolean).sort();
      if (!dues.length) return null;
      return { value: dues.at(-1), show: dues.at(-1), date: true, why: T(L, 'Die letzte offene Story endet an diesem Tag', 'the last open story ends on this day'), basis: 'stories' };
    }
    const ms = issue && issue.role === 'estimate' ? milestoneOf(model, issue) : null;
    if (!ms?.date || dayIdx(ms.date) < model.today) return null;
    // the start is after the milestone: the milestone date as due would put the due before the start – no suggestion
    if (issue.start && dayIdx(issue.start) != null && dayIdx(issue.start) > dayIdx(ms.date)) return null;
    return { value: ms.date, show: ms.date, date: true, why: T(L, `Meilenstein „${ms.name}“ ist an diesem Tag`, `milestone "${ms.name}" is on this day`), basis: 'milestone' };
  },
};

// Suggestions for the given gaps (default: every fixable gap of the computed data quality). The default list is kept per
// computed result and language (the header's "Heute zu tun" and the Quality view ask for it on every new result); it is
// shared – read it only.
const allMemo = new WeakMap();
export function smartSuggestions(computed, { lang = 'de', gaps } = {}) {
  if (gaps || !computed || typeof computed !== 'object') return suggestionsOf(computed, { lang, gaps });
  const m = allMemo.get(computed);
  if (m && m.dq === computed.dq && m.model === computed.model && m.by.has(lang)) return m.by.get(lang);
  const e = m && m.dq === computed.dq && m.model === computed.model ? m : { dq: computed.dq, model: computed.model, by: new Map() };
  allMemo.set(computed, e);
  e.by.set(lang, suggestionsOf(computed, { lang }));
  return e.by.get(lang);
}
function suggestionsOf(computed, { lang = 'de', gaps } = {}) {
  const { model, dq } = computed;
  const out = [];
  for (const g of gaps || dq.gaps) {
    if (!g.fixable || !RULES[g.field]) continue;
    const issue = g.isItem ? null : model.byId.get(g.issueId);
    const s = RULES[g.field](model, g, issue, lang);
    if (s) out.push({ id: g.id, gap: g, usage: g.field, ...s });
  }
  return out;
}
export const suggestionFor = (computed, g, lang) => smartSuggestions(computed, { lang, gaps: [g] })[0] || null;
