// "Heute für dich": the top 3 stories for the person's role – employees get their own week, project people their
// projects and teams, management the portfolio. Candidates are ranked by tone, then by their strongest finding.
import { isEmployee } from '../../mine.js';
import { capacityPeople } from '../../engine.js';
import { computedOf, dsOf, newStory, ev, finding, follow, done, T, TONE_RANK, urgentProject } from '../kit.js';
import { SKILLS, questionFor } from './index.js';
import { textClaims } from '../crosscheck.js';
import { busiestTeam } from './teamBrief.js';
import { splitConflicts, realConflicts } from '../../splitPeople.js';
import { allocationOf } from '../../allocation.js';

export function roleOf(ctx) {
  const r = ctx.roles || {};
  const ds = dsOf(ctx);
  if (!ctx.me?.id || isEmployee(r, ds, ctx.me.id)) return 'employee';
  if (r.viewReport || (r.roleNames || []).some((x) => x === 'management' || x === 'jiraAdmin') || (r.rights || []).includes('report')) return 'management';
  return 'projectAdmin';
}
// The evidence behind a story's headline: its kpis and finding evidence that the headline actually mentions.
function evidenceFor(x, L) {
  const { claims } = textClaims(x.headline, { lang: L, entities: x.entities });
  const pool = [...x.kpis.map((k) => ev(k.label, k.value, k.unit)), ...x.findings.flatMap((f) => f.evidence)];
  const vis = x.visual?.data || {};
  if (vis.quarter) pool.push(ev(T(L, 'Quartal', 'quarter'), vis.quarter, 'quarter'));
  for (const it of vis.items || []) if (typeof it.value === 'number') pool.push(ev(it.label.slice(0, 100), it.value, vis.unit === 'n' || vis.unit === 'h' || vis.unit === '%' || vis.unit === 'd' ? vis.unit : undefined, it.key ? { key: it.key } : {}));
  const near = (a, b) => Math.abs(Math.abs(a) - b) <= Math.max(1, 0.01 * Math.abs(a)) + 1e-9;
  const used = pool.filter((e) => claims.some((c) => (c.kind === 'key' && e.key === c.found) || (c.kind === 'quarter' && e.unit === 'quarter' && (e.value === c.found || String(e.value).endsWith(c.found)))
    || (c.kind === 'date' && e.unit === 'date') || ((c.kind === 'number' || c.kind === 'percent') && typeof e.value === 'number' && near(e.value, c.found) && (!c.unit || c.unit === 'n' || c.unit === 'w' || c.unit === e.unit || (c.unit === 'd' && e.unit === 'n')))));
  const seen = new Set();
  return used.filter((e) => { const k = JSON.stringify(e); return seen.has(k) ? false : seen.add(k); }).slice(0, 8);
}
const score = (s) => (TONE_RANK[s.tone] ?? 0) * 100 + (s.findings[0]?.impact ?? 0);

// The candidate stories of a role, best first (at most 3, one per skill).
export function todayStories(ctx, role, L) {
  const c = computedOf(ctx);
  const meTeam = ctx.me?.id ? capacityPeople(c.model).get(ctx.me.id)?.teamId : null;
  const hasSupport = !!dsOf(ctx).supportTickets?.tickets?.length;
  const canDispatch = !!(ctx.roles?.dispatch ?? ctx.roles?.editCapacity ?? ctx.roles?.admin);
  const urgent = urgentProject(ctx);
  // people in several teams (2026-11-17): the multi-team check joins the briefing only when there is a real conflict
  // (double booked, a team over its share, work outside the teams) – quiet days stay quiet
  const meSplit = ctx.me?.id && allocationOf(capacityPeople(c.model).get(ctx.me.id) || {}).length >= 2;
  const splitParams = (only) => { try { return realConflicts(splitConflicts(c.model, c.support, { only })).length ? true : null; } catch { return null; } };
  const split = {
    employee: meSplit && splitParams(new Set([ctx.me.id])) ? [['splitCheck', { person: ctx.me.id }]] : [],
    projectAdmin: splitParams(null) ? [['splitCheck', meTeam ? { team: meTeam } : {}]] : [],
    management: splitParams(null) ? [['splitCheck', {}]] : [],
  };
  const plan = {
    employee: [['myWeek', {}], ['blockers', { mine: true }], ...(meTeam ? [['teamBrief', { team: meTeam }]] : [])],
    projectAdmin: [...(urgent ? [['projectBrief', { ref: urgent.ref }]] : []), ['teamBrief', { team: meTeam || busiestTeam(ctx) }], ['planningAdvice', meTeam ? { team: meTeam } : {}], ...(urgent ? [['gapsFix', { ref: urgent.ref }]] : []), ...(hasSupport && canDispatch ? [['dispatchAdvice', {}]] : []), ['myWeek', {}]],
    management: [['portfolioBrief', {}], ['waterline', {}], ['overtime', {}], ...(hasSupport ? [['supportTopics', {}]] : []), ...(urgent ? [['projectBrief', { ref: urgent.ref }]] : [])],
  }[role] || [];
  plan.push(...(split[role] || []));
  const out = [];
  for (const [id, params] of plan) {
    if (!params || (id === 'teamBrief' && !params.team)) continue;
    try { out.push({ story: { ...SKILLS[id].run(ctx, params, L), understood: { skill: id, params, confidence: 'high', alternatives: [] } }, order: out.length }); } catch { /* one failing skill never empties the briefing */ }
  }
  // the role's first story (its home) always stays; the rest by urgency
  const [home, ...rest] = out;
  rest.sort((a, b) => score(b.story) - score(a.story) || a.order - b.order);
  const top = [home, ...rest].filter(Boolean).slice(0, 3);
  // someone double booked across teams is concrete harm (2026-11-17): it always gets the last slot when it is not in already
  const sp = rest.find((x) => x.story.skill === 'splitCheck' && x.story.tone === 'bad');
  if (sp && !top.includes(sp) && top.length === 3) top[2] = sp;
  return top.map((x) => x.story);
}

export default {
  id: 'today',
  title: (L) => T(L, 'Heute für dich', 'Today for you'),
  params: ['role'],
  match: [/heute|today|was (brennt|ist wichtig|steht an|muss ich)|what('s| is) (important|burning|up|next)|worauf (soll|muss) ich|what should i (look at|focus on)|briefing fuer mich|my briefing|guten morgen|good morning|morgen-?briefing|daily/],
  run(ctx, p, L) {
    const role = ['employee', 'projectAdmin', 'management'].includes(p?.role) ? p.role : roleOf(ctx);
    const stories = todayStories(ctx, role, L);
    const lead = stories[0];
    const s = newStory(ctx, { skill: 'today', subject: { kind: role === 'employee' ? 'person' : 'portfolio', ref: role === 'employee' && ctx.me?.id ? `person:${ctx.me.id}` : null, name: T(L, 'Heute', 'Today') }, lang: L });
    s.id = `today:${role}`;
    if (!lead) {
      s.tone = 'info'; s.headline = T(L, 'Für heute hat Lotse nichts Dringendes gefunden.', 'Lotse found nothing urgent for today.');
      s.visual = { kind: 'donut', data: { unit: 'n', total: 0, items: [{ label: T(L, 'keine Punkte', 'no items'), value: 0, tone: 'ok' }] }, caption: T(L, 'Keine offenen Punkte.', 'No open items.') };
      s.findings.push(finding(T(L, 'Keine Daten für ein Briefing.', 'No data for a briefing.'), 'info', 10, []));
      s.followUps.push(follow(T(L, 'Portfolio', 'Portfolio'), T(L, 'Lagebild Portfolio', 'Portfolio briefing')), follow(T(L, 'Meine Woche', 'My week'), T(L, 'Meine Woche', 'My week')));
      return done(s);
    }
    // the lead story's picture, its facts, and one line per story
    for (const x of stories) for (const k of ['projects', 'teams', 'people', 'texts']) for (const e of x.entities?.[k] || []) {
      const list = (s.entities[k] ||= []);
      if (!list.some((y) => JSON.stringify(y) === JSON.stringify(e))) list.push(e);
    }
    s.visual = lead.visual;
    s.kpis = lead.kpis;
    stories.forEach((x, i) => s.findings.push(finding(x.headline, x.tone === 'info' ? 'info' : x.tone, 100 - i * 10, evidenceFor(x, L))));
    s.tone = stories.reduce((a, x) => ((TONE_RANK[x.tone] ?? 0) > (TONE_RANK[a] ?? 0) ? x.tone : a), 'info');
    s.headline = lead.headline;
    s.actions = lead.actions;
    s.followUps = stories.slice(1).map((x) => follow(SKILLS[x.skill].title(L), questionFor(x.skill, x.subject, L)));
    s.followUps.push(follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')));
    s.how = { text: T(L, `Rolle: ${{ employee: 'Mitarbeiter:in', projectAdmin: 'Projekt-Admin', management: 'Management' }[role]}. Lotse rechnet die passenden Lagebilder und zeigt zuerst das wichtigste: rot vor gelb vor grün, dann nach dem stärksten Befund.`, `Role: ${{ employee: 'employee', projectAdmin: 'project admin', management: 'management' }[role]}. Lotse computes the fitting briefings and shows the most important first: red before yellow before green, then by the strongest finding.`),
      inputs: stories.map((x) => [SKILLS[x.skill].title(L), x.subject.name]) };
    s.confidence = lead.confidence;
    s.sources = [...new Set(stories.flatMap((x) => x.sources))].slice(0, 8);
    return done(s);
  },
};
