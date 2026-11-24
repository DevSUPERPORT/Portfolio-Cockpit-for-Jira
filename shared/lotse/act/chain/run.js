// Lotse chains – the workflow "chain": a plan of steps (chain/plan.js) run on the same planner and state machine as
// every workflow (workflows.js), so every write keeps preview → apply → undo and "Alles rückgängig" takes the whole
// chain back, newest first.
//
//   plan     decide 'plan' (custom 'chainPlan'): the person sees the plan graph, edits it (remove / reorder / params) or
//            picks the AI's proposal; the answer is the plan itself, checked strictly (cleanPlan). Frozen once accepted,
//            together with the BASELINE (the waterline as the job started – check.waterline compares with it).
//   sections one per plan step (`meta.section` = 's1', 's2' …): a query's set story, a skill story, a whole workflow or
//            mission (its own decisions, prefilled from the step's params), a command preview, a document. Data flows
//            through `meta.out` of a section's first step (a set with the numbers that qualified it, a document, a note).
//   freeze   a section that ran to its end (`meta.end`) and whose steps are all settled is not planned again – its set,
//            stories and writes stay exactly as they were, whatever the data does later (re-emitted from `P.prev`).
//   gate     after a step that changed data a checkpoint ('sN:gate': continue / stop): answering it re-plans the rest on the
//            fresh numbers ("give each of them a PDF with their NEW plan" reads the plan after the write).
//   summary  every artifact, every write, undo all.
// Pure: no React; the UI renders sections with chainSections(state).
import { T, plural, fact, langOf, computedOf, dsOf, invalid, can } from '../kit.js';
import { toolOf, rightOk, RIGHT_NAMES, queryOfTool, WF_PREFILL } from '../tools.js';
import { runQuery, setStory, setOf, memberText, ENTITY_NAMES } from '../query.js';
import { planChain, cleanPlan, stepTitle, stepDetail } from './plan.js';
import { buildChainDoc } from './docs.js';
import { replan } from '../../plan/replan.js';
import { movesStory, lateStep, planBatch } from '../missionsPlan.js';
import { newStory, kpi, ev, finding, follow, done as doneStory, infoStory, sum, addPerson, addProject } from '../../kit.js';
import { crossCheck } from '../../crosscheck.js';
import { fmtOf } from '../../narrate.js';
import { capacityPeople } from '../../../engine.js';
import { winLabel, BLOCKS_FOR, DEFAULT_BLOCKS } from '../orchestrate/parse.js';
import { runJob } from '../orchestrate/data.js';
import { overviewStory } from '../orchestrate/stories.js';
import { COMMANDS } from '../commands.js';

const DONE = new Set(['seen', 'answered', 'applied', 'skipped', 'failed', 'done', 'undone']);
const optOf = (a) => (typeof a === 'string' ? a : a?.option ?? null);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
const pctOf = (u) => (Number.isFinite(u) ? Math.round(u * 100) : null);
const short = (s, n = 60) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// ---------- the baseline: the waterline as the job started ----------
export function baselineOf(ctx) {
  const { wl, model } = computedOf(ctx);
  const qs = wl.quarters.slice(0, 2);
  const projects = {};
  const totals = {};
  for (const q of qs) totals[q] = { missing: 0, notStaffed: 0 };
  for (const it of model.items) {
    projects[it.ref] = {};
    for (const q of qs) {
      const c = wl.projectQ[it.ref]?.[q];
      if (!c) continue;
      const m = r1(sum(c.teams || [], (t) => Math.max(0, t.demand - t.staffed)));
      projects[it.ref][q] = { s: c.status, m };
      totals[q].missing = r1(totals[q].missing + m);
      if (c.status !== 'ok') totals[q].notStaffed += 1;
    }
  }
  return { at: dsOf(ctx).today, quarters: qs, projects, totals };
}

// ---------- sub-planners: a section's steps get the section's prefix ----------
function sub(H, P, prefix, prefill = {}) {
  const ans = {};
  for (const [k, v] of Object.entries(P.a)) if (k.startsWith(prefix)) ans[k.slice(prefix.length)] = v;
  const SP = new H.Planner(P.ctx, { ...prefill, ...ans }, []);
  SP.prefilled = prefill;
  SP.own = ans;
  return SP;
}
function absorb(P, SP, prefix, sid) {
  let note = null, job = null;
  const pending = SP.steps.some((x) => x.kind === 'decide' && SP.a[x.id] === undefined);
  for (const st of SP.steps) {
    if (st.kind === 'summary') { note = st.note || note; job = st.job || job; continue; }
    const x = { ...st, id: prefix + st.id, meta: { section: sid } };
    if (x.covers) x.covers = x.covers.map((c) => prefix + c);
    if (x.items) x.items = x.items.map((i) => ({ ...i, stepId: prefix + i.stepId }));
    if (x.kind === 'decide' && Object.hasOwn(SP.prefilled || {}, st.id) && !Object.hasOwn(SP.own || {}, st.id)) { x.status = 'answered'; x.answer = SP.prefilled[st.id]; x.prefilled = true; }
    P.steps.push(x);
  }
  return { note, job, pending };
}
const secSteps = (P, sid) => P.steps.filter((x) => x.meta?.section === sid);

// ---------- stories only chains tell ----------
function peoplePlanStory(ctx, r, ids, target) {
  const L = langOf(ctx);
  const s = newStory(ctx, { skill: 'chainPlan', subject: { kind: 'portfolio', ref: null, name: T(L, 'Personen', 'People') }, lang: L });
  s.id = `chainPlan:${ids.length}`;
  const planned = r.people.filter((p) => p.role === 'planned');
  for (const p of planned.slice(0, 16)) addPerson(s, ctx, p.id);
  const overB = sum(planned, (p) => p.overWeeksBefore), overA = sum(planned, (p) => p.overWeeksAfter);
  const late = r.moves.filter((m) => m.late);
  const tp = Math.round(target * 100);
  s.kpis.push(kpi('overBefore', T(L, `Personenwochen über ${tp} % vorher`, `Person-weeks over ${tp}% before`), overB, 'n', { tone: overB ? 'bad' : 'ok' }));
  s.kpis.push(kpi('overAfter', T(L, 'nachher', 'after'), overA, 'n', { tone: overA ? 'warn' : 'ok' }));
  s.kpis.push(kpi('moves', T(L, 'Änderungen', 'Changes'), r.moves.length, 'n'));
  s.kpis.push(kpi('late', T(L, 'Später als Termin', 'Later than due'), late.length, 'n', { tone: late.length ? 'warn' : 'ok' }));
  const cols = r.weeks.map((w) => T(L, `KW ${weekNo(w.from)}`, `W${weekNo(w.from)}`));
  s.visual = { kind: 'heat', data: { unit: '%', cols, rows: planned.slice(0, 12).map((p) => ({ label: p.name || '–', values: p.after.map((w) => (Number.isFinite(w.util) ? pctOf(w.util) : null)) })) },
    caption: T(L, `Auslastung je Person und Woche mit Lotses Plan (Ziel ${tp} %).`, `Load per person and week with Lotse's plan (target ${tp}%).`) };
  s.headline = r.moves.length ? T(L, `Mit ${r.moves.length} ${plural(r.moves.length, 'Änderung', 'Änderungen')} sinken die Personenwochen über ${tp} % von ${overB} auf ${overA}.`, `With ${r.moves.length} ${plural(r.moves.length, 'change', 'changes')} the person-weeks over ${tp}% drop from ${overB} to ${overA}.`)
    : T(L, `Keine Änderung möglich – ${overB} Personenwochen über ${tp} % bleiben.`, `No change possible – ${overB} person-weeks over ${tp}% remain.`);
  const worst = [...planned].sort((a, b) => b.overWeeksBefore - a.overWeeksBefore)[0];
  if (worst?.overWeeksBefore) s.findings.push(finding(T(L, `${worst.name}: ${worst.overWeeksBefore} Wochen über ${tp} % vorher, ${worst.overWeeksAfter} nachher.`, `${worst.name}: ${worst.overWeeksBefore} weeks over ${tp}% before, ${worst.overWeeksAfter} after.`), worst.overWeeksAfter ? 'warn' : 'ok', 70, [ev(T(L, 'vorher', 'before'), worst.overWeeksBefore, 'n'), ev(T(L, 'nachher', 'after'), worst.overWeeksAfter, 'n'), ev(T(L, 'Ziel', 'target'), tp, '%')]));
  if (late.length) {
    const w = [...late].sort((a, b) => b.late.days - a.late.days)[0];
    s.findings.push(finding(T(L, `${late.length} ${plural(late.length, 'Story endet', 'Stories enden')} nach dem Termin – am weitesten ${w.key} um ${w.late.days} Arbeitstage.`, `${late.length} ${plural(late.length, 'story ends', 'stories end')} after the date – furthest ${w.key} by ${w.late.days} working days.`), 'warn', 80, [ev(T(L, 'später', 'late'), late.length, 'n'), ev(w.key, w.late.days, 'd', { key: w.key })]));
  }
  if (r.unplaced.length) {
    const h = sum(r.unplaced, (u) => u.h);
    s.findings.push(finding(T(L, `Mehr Arbeit als Zeit: ${r.unplaced.length} ${plural(r.unplaced.length, 'Story', 'Stories')} mit ${s.fmt.h(h)} passen nicht hinein – hier helfen nur Entscheidungen (Priorität, Umfang, Kapazität).`, `More work than time: ${r.unplaced.length} ${plural(r.unplaced.length, 'story', 'stories')} with ${s.fmt.h(h)} do not fit – only decisions help (priority, scope, capacity).`), 'bad', 95, [ev(T(L, 'ohne Platz', 'no room'), r.unplaced.length, 'n'), ev(T(L, 'Stunden', 'hours'), h, 'h')]));
  }
  if (!s.findings.length) s.findings.push(finding(T(L, `${planned.length} ${plural(planned.length, 'Person', 'Personen')} geplant – keine Woche über ${tp} %.`, `${planned.length} ${plural(planned.length, 'person', 'people')} planned – no week over ${tp}%.`), 'ok', 40, [ev(T(L, 'Personen', 'people'), planned.length, 'n'), ev(T(L, 'Ziel', 'target'), tp, '%')]));
  s.tone = r.unplaced.length ? 'bad' : overA ? 'warn' : 'ok';
  s.how = { text: T(L, 'Derselbe Neu-Planer wie „Meine Woche auf 100 %“ für alle Personen der Menge zugleich: was passt, bleibt; aus jeder Woche über dem Ziel geht die Story mit der niedrigsten Priorität und wird neu eingeplant.', 'The same re-planner as "My week at 100%" for every person of the set at once: what fits stays; from every week over the target the lowest-priority story leaves and is planned again.'), inputs: [[T(L, 'Personen', 'People'), String(ids.length)], [T(L, 'Ziel', 'Target'), `${tp} %`]] };
  s.confidence = 'high';
  s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity')];
  return doneStory(s);
}
const weekNo = (iso) => { const d = new Date(`${iso}T00:00:00Z`); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); };

function estimatesStory(ctx, items, scopeName) {
  const L = langOf(ctx);
  const s = newStory(ctx, { skill: 'fillEstimates', subject: { kind: 'topic', ref: null, name: scopeName || T(L, 'Schätzungen', 'Estimates') }, lang: L });
  const F = s.fmt;
  const model = computedOf(ctx).model;
  for (const x of items.slice(0, 8)) addProject(s, model.itemByRef.get(x.issue.rootRef));
  const h = r1(sum(items, (x) => +x.sug.value || 0));
  const sim = items.filter((x) => x.sug.basis === 'similar').length;
  s.kpis.push(kpi('n', T(L, 'Ohne Schätzung, mit Vorschlag', 'Unestimated, with a suggestion'), items.length, 'n', { tone: items.length ? 'warn' : 'ok' }));
  s.kpis.push(kpi('h', T(L, 'Vorgeschlagen zusammen', 'Suggested in total'), h, 'h'));
  s.kpis.push(kpi('similar', T(L, 'Aus ähnlicher Arbeit', 'From similar work'), sim, 'n'));
  s.visual = { kind: 'bars', data: { unit: 'h', items: items.slice(0, 12).map((x) => ({ label: `${x.issue.key} · ${short(x.issue.summary, 26)}`, key: x.issue.key, value: +x.sug.value || 0, tone: x.sug.basis === 'similar' ? 'ok' : 'info', sub: x.sug.basis === 'similar' ? T(L, `Median aus ${x.sug.n} ähnlichen`, `median of ${x.sug.n} similar`) : T(L, `aus ${x.sug.n} Geschwistern`, `from ${x.sug.n} siblings`) })) },
    caption: T(L, 'Vorgeschlagene Schätzung je Story ohne Schätzung – aus ähnlicher erledigter Arbeit.', 'Suggested estimate per unestimated story – from similar finished work.') };
  s.headline = items.length ? T(L, `${items.length} ${plural(items.length, 'Story ohne Schätzung bekommt', 'Stories ohne Schätzung bekommen')} einen Vorschlag – zusammen ${F.h(h, 1)}.`, `${items.length} unestimated ${plural(items.length, 'story gets', 'stories get')} a suggestion – ${F.h(h, 1)} in total.`)
    : T(L, 'Keine Story ohne Schätzung mit belastbarem Vorschlag.', 'No unestimated story with a sound suggestion.');
  for (const x of items.slice(0, 3)) s.findings.push(finding(T(L, `${x.issue.key}: ${F.h(+x.sug.value || 0, 1)} (${x.sug.basis === 'similar' ? `Median von ${x.sug.n} ähnlichen erledigten Stories` : `aus ${x.sug.n} Geschwistern`}).`, `${x.issue.key}: ${F.h(+x.sug.value || 0, 1)} (${x.sug.basis === 'similar' ? `median of ${x.sug.n} similar finished stories` : `from ${x.sug.n} siblings`}).`), 'info', 50, [ev(x.issue.key, +x.sug.value || 0, 'h', { key: x.issue.key, text: short(x.issue.summary, 100) }), ev(T(L, 'Basis', 'basis'), x.sug.n, 'n')]));
  if (!items.length) s.findings.push(finding(T(L, 'Es fehlen keine Schätzungen, für die Lotse ähnliche erledigte Arbeit findet.', 'No estimates are missing for which Lotse finds similar finished work.'), 'ok', 20, []));
  s.tone = items.length ? 'warn' : 'ok';
  s.how = { text: T(L, 'Wie „Lücken füllen“: für jede offene Story ohne Schätzung der Median von mindestens zwei ähnlichen erledigten Stories, sonst ihrer Geschwister.', 'As "Fill the gaps": for every open story without an estimate the median of at least two similar finished stories, else of its siblings.'), inputs: [[T(L, 'Stories', 'Stories'), String(items.length)]] };
  s.confidence = sim >= items.length / 2 ? 'high' : 'medium';
  s.sources = ['Jira', T(L, 'Erledigte Arbeit', 'Finished work')];
  return doneStory(s);
}

function waterlineStory(ctx, base, now, { project, quarter }) {
  const L = langOf(ctx);
  const model = computedOf(ctx).model;
  const q = quarter && base.quarters.includes(quarter) ? quarter : base.quarters[0];
  const s = newStory(ctx, { skill: 'waterlineCheck', subject: project ? { kind: 'project', ref: project, name: model.itemByRef.get(project)?.name || '' } : { kind: 'portfolio', ref: null, name: 'Portfolio' }, lang: L });
  const F = s.fmt;
  if (project) addProject(s, model.itemByRef.get(project));
  const pb = project ? base.projects[project]?.[q] || null : null, pn = project ? now.projects[project]?.[q] || null : null;
  const tb = base.totals[q] || { missing: 0, notStaffed: 0 }, tn = now.totals[q] || { missing: 0, notStaffed: 0 };
  const changed = Object.keys(now.projects).filter((ref) => (base.projects[ref]?.[q]?.s || null) !== (now.projects[ref]?.[q]?.s || null));
  for (const ref of changed.slice(0, 4)) addProject(s, model.itemByRef.get(ref));
  const rows = [];
  if (pb || pn) rows.push({ label: T(L, `${model.itemByRef.get(project)?.name || ''}: fehlende Stunden`, `${model.itemByRef.get(project)?.name || ''}: missing hours`), unit: 'h', a: pb?.m ?? 0, b: pn?.m ?? 0, better: 'lower' });
  rows.push({ label: T(L, 'Portfolio: fehlende Stunden', 'Portfolio: missing hours'), unit: 'h', a: tb.missing, b: tn.missing, better: 'lower' });
  rows.push({ label: T(L, 'Projekte nicht voll besetzbar', 'Projects not fully staffable'), unit: 'n', a: tb.notStaffed, b: tn.notStaffed, better: 'lower' });
  s.visual = { kind: 'compare', data: { a: { label: T(L, 'Vor dem Auftrag', 'Before the job') }, b: { label: T(L, 'Jetzt', 'Now') }, rows }, caption: T(L, `Wasserlinie in ${F.quarter(q)}: vor dem Auftrag und jetzt – gleiche Rechnung wie im Cockpit.`, `Waterline in ${F.quarter(q)}: before the job and now – the same numbers as the cockpit.`) };
  const dP = pb && pn ? r1(pn.m - pb.m) : null, dT = r1(tn.missing - tb.missing);
  s.kpis.push(kpi('before', T(L, 'Fehlt vorher', 'Missing before'), project ? (pb?.m ?? 0) : tb.missing, 'h'));
  s.kpis.push(kpi('after', T(L, 'Fehlt jetzt', 'Missing now'), project ? (pn?.m ?? 0) : tn.missing, 'h', { tone: (project ? (pn?.m ?? 0) > (pb?.m ?? 0) : tn.missing > tb.missing) ? 'warn' : 'ok' }));
  s.kpis.push(kpi('changed', T(L, 'Projekte mit neuem Status', 'Projects with a new status'), changed.length, 'n', { tone: changed.length ? 'warn' : 'ok' }));
  const same = !changed.length && Math.abs(dT) < 0.05 && (dP == null || Math.abs(dP) < 0.05);
  const name = model.itemByRef.get(project)?.name;
  s.headline = same ? T(L, `Die Wasserlinie in ${F.quarter(q)} bleibt gleich: ${F.h(tn.missing)} fehlen im Portfolio, ${tn.notStaffed} ${plural(tn.notStaffed, 'Projekt', 'Projekte')} nicht voll besetzbar.`, `The waterline in ${F.quarter(q)} stays the same: ${F.h(tn.missing)} missing in the portfolio, ${tn.notStaffed} ${plural(tn.notStaffed, 'project', 'projects')} not fully staffable.`)
    : project && pb && pn ? T(L, `${name} in ${F.quarter(q)}: ${F.h(pn.m)} fehlen statt ${F.h(pb.m)} – die Wasserlinie hat sich bewegt.`, `${name} in ${F.quarter(q)}: ${F.h(pn.m)} missing instead of ${F.h(pb.m)} – the waterline moved.`)
      : T(L, `Portfolio in ${F.quarter(q)}: ${F.h(tn.missing)} fehlen statt ${F.h(tb.missing)} – ${changed.length} ${plural(changed.length, 'Projekt hat', 'Projekte haben')} einen neuen Status.`, `Portfolio in ${F.quarter(q)}: ${F.h(tn.missing)} missing instead of ${F.h(tb.missing)} – ${changed.length} ${plural(changed.length, 'project has', 'projects have')} a new status.`);
  if (project && pb && pn) s.findings.push(finding(T(L, `${name}: ${F.h(pb.m)} → ${F.h(pn.m)} fehlende Stunden in ${F.quarter(q)}.`, `${name}: ${F.h(pb.m)} → ${F.h(pn.m)} missing hours in ${F.quarter(q)}.`), pn.m > pb.m ? 'warn' : 'ok', 80, [ev(T(L, 'vorher', 'before'), pb.m, 'h'), ev(T(L, 'jetzt', 'now'), pn.m, 'h'), ev(T(L, 'Quartal', 'quarter'), q, 'quarter')]));
  s.findings.push(finding(T(L, `Portfolio: ${F.h(tb.missing)} → ${F.h(tn.missing)} fehlende Stunden, nicht voll besetzbar ${tb.notStaffed} → ${tn.notStaffed}.`, `Portfolio: ${F.h(tb.missing)} → ${F.h(tn.missing)} missing hours, not fully staffable ${tb.notStaffed} → ${tn.notStaffed}.`), tn.missing > tb.missing ? 'warn' : 'info', 60, [ev(T(L, 'vorher', 'before'), tb.missing, 'h'), ev(T(L, 'jetzt', 'now'), tn.missing, 'h'), ev(T(L, 'nicht besetzbar vorher', 'not staffable before'), tb.notStaffed, 'n'), ev(T(L, 'nicht besetzbar jetzt', 'not staffable now'), tn.notStaffed, 'n')]));
  for (const ref of changed.slice(0, 2)) {
    const a = base.projects[ref]?.[q], b = now.projects[ref]?.[q];
    const wn = (x) => ({ ok: T(L, 'besetzbar', 'staffable'), partial: T(L, 'teilweise besetzbar', 'partly staffable'), no: T(L, 'nicht besetzbar', 'not staffable') }[x] || '–');
    s.findings.push(finding(T(L, `${model.itemByRef.get(ref)?.name}: ${wn(a?.s)} → ${wn(b?.s)}.`, `${model.itemByRef.get(ref)?.name}: ${wn(a?.s)} → ${wn(b?.s)}.`), b?.s === 'ok' ? 'ok' : 'warn', 70, [ev(T(L, 'fehlt jetzt', 'missing now'), b?.m ?? 0, 'h')]));
  }
  s.tone = same ? 'info' : (project ? (pn?.m ?? 0) > (pb?.m ?? 0) : tn.missing > tb.missing) ? 'warn' : 'ok';
  s.how = { text: T(L, 'Dieselbe Wasserlinie wie im Cockpit (Rangfolge, Kapazität, Support-Reserve, Schätzungen), einmal mit den Daten vom Start des Auftrags und einmal jetzt; fehlend = Bedarf minus besetzbare Stunden.', 'The same waterline as the cockpit (ranking, capacity, support reserve, estimates), once with the data from the job\'s start and once now; missing = demand minus staffable hours.'), inputs: [[T(L, 'Quartal', 'Quarter'), F.quarter(q)], [T(L, 'Stand vorher', 'Before as of'), base.at]] };
  s.confidence = 'high';
  s.sources = ['Jira', T(L, 'Wasserlinie', 'Waterline')];
  s.followUps.push(follow(T(L, 'Wasserlinie', 'Waterline'), T(L, 'Ab welchem Rang reicht die Kapazität nicht?', 'From which rank does capacity run out?')));
  return { story: doneStory(s), delta: { quarter: q, project: project || null, before: project ? pb?.m ?? null : tb.missing, after: project ? pn?.m ?? null : tn.missing, portfolioBefore: tb.missing, portfolioAfter: tn.missing, changed: changed.length, same } };
}

// what the chain did so far – for the brief (only numbers the steps produced)
function results(P, plan, outs, upto) {
  const L = P.L;
  const F = fmtOf(P.ctx, L);
  const out = [];
  for (const st of plan.steps.slice(0, upto)) {
    const o = outs[st.id] || {};
    const steps = [...P.steps, ...P.prev].filter((x) => x.meta?.section === st.id);
    const cmds = [...new Map(steps.filter((x) => x.kind === 'command').map((x) => [x.id, x])).values()];
    const applied = cmds.filter((x) => x.status === 'applied' && COMMANDS[x.command]?.write);
    const changes = sum(applied, (x) => {
      const pv = steps.find((p) => p.kind === 'preview' && (p.covers || []).includes(x.id));
      return pv?.items?.find((i) => i.stepId === x.id)?.preview?.count ?? x.result?.applied ?? 0;
    });
    const title = stepTitle(st, P.ctx)[L === 'en' ? 1 : 0];
    if (o.set) out.push({ id: st.id, kind: 'set', title, n: o.set.total, entity: o.set.entity, text: T(L, `${title}: ${o.set.total} ${plural(o.set.total, 'Treffer', 'Treffer')}${o.set.members[0] ? `, zuerst ${o.set.members[0].name}` : ''}.`, `${title}: ${o.set.total} ${plural(o.set.total, 'match', 'matches')}${o.set.members[0] ? `, first ${o.set.members[0].name}` : ''}.`) });
    if (applied.length) out.push({ id: st.id, kind: 'write', title, n: changes, text: T(L, `${title}: ${changes} ${plural(changes, 'Änderung', 'Änderungen')} übernommen.`, `${title}: ${changes} ${plural(changes, 'change', 'changes')} applied.`) });
    else if (cmds.some((x) => x.status === 'skipped' && COMMANDS[x.command]?.write)) out.push({ id: st.id, kind: 'skipped', title, n: 0, text: T(L, `${title}: nicht übernommen.`, `${title}: not applied.`) });
    if (o.delta) out.push({ id: st.id, kind: 'delta', title, n: o.delta.after, delta: o.delta, text: o.delta.same ? T(L, `Wasserlinie unverändert: ${F.h(o.delta.portfolioAfter)} fehlen im Portfolio.`, `Waterline unchanged: ${F.h(o.delta.portfolioAfter)} missing in the portfolio.`) : T(L, `Wasserlinie: ${o.delta.before != null ? `${F.h(o.delta.before)} → ${F.h(o.delta.after)}` : ''} fehlende Stunden${o.delta.project ? ' im Projekt' : ''}, Portfolio ${F.h(o.delta.portfolioBefore)} → ${F.h(o.delta.portfolioAfter)}.`, `Waterline: ${o.delta.before != null ? `${F.h(o.delta.before)} → ${F.h(o.delta.after)}` : ''} missing hours${o.delta.project ? ' in the project' : ''}, portfolio ${F.h(o.delta.portfolioBefore)} → ${F.h(o.delta.portfolioAfter)}.`) });
    if (o.doc) out.push({ id: st.id, kind: 'doc', title, n: 0, text: T(L, `${title}: Dokument erstellt.`, `${title}: document created.`) });
  }
  return out;
}
function briefStory(ctx, res, { to, project }) {
  const L = langOf(ctx);
  const s = newStory(ctx, { skill: 'chainBrief', subject: project ? { kind: 'project', ref: project, name: computedOf(ctx).model.itemByRef.get(project)?.name || '' } : { kind: 'topic', ref: null, name: to || 'Lotse' }, lang: L });
  if (project) addProject(s, computedOf(ctx).model.itemByRef.get(project));
  const writes = res.filter((x) => x.kind === 'write');
  const changes = sum(writes, (x) => x.n);
  const delta = res.find((x) => x.kind === 'delta')?.delta || null;
  const F = s.fmt;
  s.kpis.push(kpi('writeSteps', T(L, 'Schritte mit Änderungen', 'Steps with changes'), writes.length, 'n'));
  s.kpis.push(kpi('changes', T(L, 'Änderungen übernommen', 'Changes applied'), changes, 'n'));
  if (delta?.before != null) { s.kpis.push(kpi('wlBefore', T(L, 'Fehlte vorher', 'Missing before'), delta.before, 'h')); s.kpis.push(kpi('wlAfter', T(L, 'Fehlt jetzt', 'Missing now'), delta.after, 'h', { tone: delta.after > delta.before ? 'warn' : 'ok' })); }
  s.visual = { kind: 'bars', data: { unit: 'n', items: res.filter((x) => x.kind !== 'delta').slice(0, 8).map((x) => ({ label: x.title, value: x.n || 0, tone: x.kind === 'write' ? 'ok' : x.kind === 'skipped' ? 'muted' : 'info' })) }, caption: T(L, 'Was jeder Schritt des Auftrags ergeben hat (Treffer bzw. Änderungen).', 'What each step of the job produced (matches or changes).') };
  s.headline = delta && !delta.same && delta.before != null ? T(L, `${changes} ${plural(changes, 'Änderung', 'Änderungen')} übernommen – fehlende Stunden ${F.h(delta.before)} → ${F.h(delta.after)}.`, `${changes} ${plural(changes, 'change', 'changes')} applied – missing hours ${F.h(delta.before)} → ${F.h(delta.after)}.`)
    : T(L, `${changes} ${plural(changes, 'Änderung', 'Änderungen')} übernommen in ${writes.length} ${plural(writes.length, 'Schritt', 'Schritten')}.`, `${changes} ${plural(changes, 'change', 'changes')} applied in ${writes.length} ${plural(writes.length, 'step', 'steps')}.`);
  for (const x of res.slice(0, 4)) {
    const e = x.kind === 'delta' ? [ev(T(L, 'vorher', 'before'), x.delta.before ?? x.delta.portfolioBefore, 'h'), ev(T(L, 'jetzt', 'now'), x.delta.after ?? x.delta.portfolioAfter, 'h'), ev(T(L, 'Portfolio vorher', 'portfolio before'), x.delta.portfolioBefore, 'h'), ev(T(L, 'Portfolio jetzt', 'portfolio now'), x.delta.portfolioAfter, 'h')] : [ev(x.kind === 'set' ? T(L, 'Treffer', 'matches') : T(L, 'Änderungen', 'changes'), x.n || 0, 'n')];
    s.findings.push(finding(x.text, x.kind === 'skipped' ? 'info' : x.kind === 'delta' && !x.delta.same && (x.delta.after ?? 0) > (x.delta.before ?? 0) ? 'warn' : x.kind === 'write' ? 'ok' : 'info', 80 - res.indexOf(x), e));
  }
  if (!s.findings.length) s.findings.push(finding(T(L, 'Die Schritte davor haben nichts geändert.', 'The steps before changed nothing.'), 'info', 10, []));
  s.tone = s.findings.some((f) => f.tone === 'warn') ? 'warn' : changes ? 'ok' : 'info';
  s.how = { text: T(L, 'Nur Zahlen aus den Schritten dieses Auftrags: Treffer der Abfragen, Änderungen der übernommenen Vorschauen, die Wasserlinie vorher und jetzt.', 'Only numbers from this job\'s steps: the queries\' matches, the changes of the applied previews, the waterline before and now.'), inputs: [] };
  s.confidence = 'high';
  s.sources = ['Lotse'];
  return doneStory(s);
}
function briefMessage(L, story, to, audience) {
  const formal = audience === 'management';
  const lines = [formal ? T(L, `Guten Tag${to ? ` ${to}` : ''},`, `Dear${to ? ` ${to}` : ' all'},`) : T(L, `Hallo${to ? ` ${to.split(' ')[0]}` : ''},`, `Hi${to ? ` ${to.split(' ')[0]}` : ''},`), '', story.headline, ''];
  for (const f of story.findings.slice(0, 4)) lines.push(`– ${f.text}`);
  lines.push('', formal ? T(L, 'Die Zahlen stammen direkt aus Jira und dem Portfolio Cockpit.', 'The numbers come straight from Jira and the Portfolio Cockpit.') : T(L, 'Die Zahlen kommen direkt aus Jira und dem Cockpit – sag Bescheid, wenn etwas nicht stimmt.', 'The numbers come straight from Jira and the cockpit – let me know if anything looks off.'));
  return lines.join('\n');
}
// a text the AI drafted: used only when every claim in it is verified by the story (crossCheck); otherwise Lotse's text
export function checkedText(story, text, lang) {
  const cc = crossCheck(story, text, { lang });
  // strict: a number the story cannot vouch for (verified false OR nothing to compare with) is not used
  const wrong = (cc.claims || []).filter((c) => c.verified !== true);
  return { ok: !wrong.length, verdict: cc.verdict, wrong: wrong.slice(0, 6).map((c) => ({ text: c.text, expected: c.expected ?? null })) };
}

// ---------- the sections ----------
function runSection(H, P, st, plan, outs, baseline) {
  const { ctx } = P;
  const L = P.L;
  const t = toolOf(st.tool);
  const sid = st.id;
  const prefix = `${sid}:`;
  const input = st.input ? outs[st.input] || null : null;
  const set = input?.set || null;
  if (!t) return { out: {} };
  const info = (headline, text) => { const SP = sub(H, P, prefix); SP.storyObj('info', infoStory(ctx, { skill: 'chain', lang: L, headline, finding: text })); absorb(P, SP, prefix, sid); return { out: {} }; };
  if (!rightOk(ctx, t.right)) return info(P.t(`Dafür fehlt dir das Recht „${RIGHT_NAMES[t.right][0]}“ – Lotse überspringt diesen Schritt.`, `You lack the right "${RIGHT_NAMES[t.right][1]}" – Lotse skips this step.`), P.t('Die anderen Schritte laufen weiter; wer das Recht hat, kann den Schritt mit derselben Vorschau ausführen.', 'The other steps go on; someone with the right can run the step with the same preview.'));
  if (t.input?.required && !set) return info(P.t('Dieser Schritt braucht eine Menge aus einem Schritt davor – es gibt keine.', 'This step needs a set from an earlier step – there is none.'), P.t('Ordne den Schritt hinter eine Abfrage oder entferne ihn.', 'Move the step behind a query or remove it.'));
  if (t.input?.required && set && !set.members.length) return info(P.t('Die Menge aus dem Schritt davor ist leer – hier ist nichts zu tun.', 'The set from the step before is empty – nothing to do here.'), P.t('Spätere Schritte für diese Menge überspringt Lotse ebenso.', 'Lotse skips later steps for this set too.'));
  const R = SECTIONS[t.id] || SECTIONS[t.kind === 'query' ? 'query' : t.source];
  return R(H, P, { st, t, sid, prefix, set, input, plan, outs, baseline });
}
const SECTIONS = {
  query(H, P, { st, t, prefix, sid }) {
    const { ctx } = P;
    const res = runQuery(queryOfTool(t, st.params), ctx);
    const SP = sub(H, P, prefix);
    SP.storyObj('set', setStory(ctx, res));
    const fs = setOf(res);
    SP.steps.at(-1).set = fs;
    absorb(P, SP, prefix, sid);
    return { out: { set: fs } };
  },
  skill(H, P, { st, t, prefix, sid, set }) {
    const params = { ...st.params };
    const fan = t.input?.fanOut;
    const targets = set && fan && !params[fan] ? set.members.slice(0, 4).map((m) => ({ ...params, [fan]: m.id })) : [params];
    const SP = sub(H, P, prefix);
    targets.forEach((p, i) => SP.story(`story${targets.length > 1 ? `:${i + 1}` : ''}`, t.skill, p));
    absorb(P, SP, prefix, sid);
    return { out: {} };
  },
  workflow(H, P, { st, t, prefix, sid, set }) {
    const spec = H.specOf(t.workflow);
    const params = { ...st.params };
    const fan = t.input?.fanOut;
    const prefill = {};
    for (const [param, decide] of Object.entries(WF_PREFILL[t.workflow] || {})) if (params[param] != null) { prefill[decide] = params[param]; delete params[param]; }
    const targets = set && fan && !params[fan] ? set.members.slice(0, 4).map((m) => ({ ...params, [fan]: m.id })) : [params];
    let note = null;
    for (let i = 0; i < targets.length; i++) {
      const pre = targets.length > 1 ? `${sid}.${i + 1}:` : prefix;
      const SP = sub(H, P, pre, prefill);
      const p = targets[i];
      spec.plan(SP, { ...p, ref: p.project ?? p.ref ?? null });
      const r = absorb(P, SP, pre, sid);
      note = r.note || note;
      if (r.pending) return { pending: true };
    }
    return { out: set && t.id !== 'wf.orchestrate' ? { pass: true } : {}, note, wrote: t.changesData };
  },
  command(H, P, { st, t, prefix, sid }) {
    const SP = sub(H, P, prefix);
    SP.batch('preview', [{ id: 'cmd', command: t.command, params: st.params.args || Object.fromEntries(Object.entries(st.params).filter(([k]) => k !== 'args')), title: t.title[P.L === 'en' ? 1 : 0] }]);
    absorb(P, SP, prefix, sid);
    return { out: {}, wrote: t.changesData };
  },
  'plan.balance'(H, P, { st, prefix, sid, set }) {
    const { ctx } = P;
    const cap = capacityPeople(computedOf(ctx).model);
    const ids = set.members.map((m) => m.id).filter((id) => cap.has(id));
    const SP = sub(H, P, prefix, { order: st.params.order || 'due' });
    if (!ids.length) {
      SP.storyObj('info', infoStory(ctx, { skill: 'chain', lang: P.L, headline: P.t('Niemand aus der Menge hat Kapazität im Cockpit – Lotse kann nichts planen.', 'Nobody in the set has capacity in the cockpit – Lotse cannot plan anything.'), finding: P.t('Wochenstunden und Team pflegt die Admin-Gruppe unter Teams › Kapazitäten.', 'Weekly hours and team are maintained under Teams › Capacity.') }));
      absorb(P, SP, prefix, sid);
      return { out: { set } };
    }
    const target = (st.params.target || 100) / 100;
    const order = SP.decide('order', {
      question: P.t('Was soll beim Planen zuerst Platz bekommen?', 'What gets room first when planning?'),
      options: [{ id: 'due', label: P.t('Fälliges zuerst', 'Due work first'), detail: P.t('überfällig und undatiert vorne, dann nach Due Date', 'overdue and undated first, then by due date'), recommended: (st.params.order || 'due') === 'due' }, { id: 'rank', label: P.t('Nach Projekt-Rang', 'By project rank'), detail: P.t('wie die Rangfolge im Portfolio', 'as ranked in the portfolio'), recommended: st.params.order === 'rank' }],
    });
    if (order === undefined) { absorb(P, SP, prefix, sid); return { pending: true }; }
    const opts = { people: ids, order: optOf(order), target, handover: st.params.handover === true && can.plan(ctx), fixWeeks: 12 };
    let r = replan(ctx, opts);
    SP.storyObj('plan', peoplePlanStory(ctx, r, ids, target));
    if (r.moves.length) SP.storyObj('moves', movesStory(ctx, r, { kind: 'portfolio', ref: null, name: P.t(`${ids.length} Personen`, `${ids.length} people`) }));
    const lt = lateStep(SP, r);
    if (lt === null) { absorb(P, SP, prefix, sid); return { pending: true }; }
    if (lt.lock.length) { r = replan(ctx, { ...opts, lock: lt.lock }); SP.storyObj('plan2', peoplePlanStory(ctx, r, ids, target)); }
    const cmds = planBatch(SP, r, 'cmd:plan', P.t('Neue Fenster in Jira setzen', 'Set the new windows in Jira'));
    if (cmds.length) SP.batch('preview', cmds);
    else SP.summary(P.t('Die Wochen passen schon – nichts zu ändern.', 'The weeks already fit – nothing to change.'));
    const a = absorb(P, SP, prefix, sid);
    return { out: { set, moves: r.moves.length }, note: a.note, wrote: cmds.length > 0 };
  },
  'fill.estimates'(H, P, { st, prefix, sid, set }) {
    const { ctx } = P;
    const p = st.params;
    let items = H.gapItems(ctx, { ref: p.project || null, team: p.team || null, assignee: p.person || null, onlyField: 'estimate', limit: 60 });
    if (set?.entity === 'stories') { const ids = new Set(set.members.map((m) => m.id)); items = items.filter((x) => ids.has(x.issue.id)); }
    if (set?.entity === 'projects' && !p.project) { const refs = new Set(set.members.map((m) => m.id)); items = items.filter((x) => refs.has(x.issue.rootRef)); }
    const model = computedOf(ctx).model;
    const SP = sub(H, P, prefix);
    SP.storyObj('estimates', estimatesStory(ctx, items, p.project ? model.itemByRef.get(p.project)?.name : null));
    if (!items.length) { SP.summary(P.t('Keine Schätzung mit belastbarem Vorschlag – nichts zu übernehmen.', 'No estimate with a sound suggestion – nothing to apply.')); const a = absorb(P, SP, prefix, sid); return { out: { filled: 0 }, note: a.note }; }
    const n = items.length;
    const h = r1(sum(items, (x) => +x.sug.value || 0));
    const a = SP.decide('mode', {
      question: P.t(`${n} ${plural(n, 'Schätzung', 'Schätzungen')} mit Vorschlag aus ähnlicher Arbeit (zusammen ${P.F.h(h, 1)}) – übernehmen?`, `${n} ${plural(n, 'estimate', 'estimates')} with a suggestion from similar work (${P.F.h(h, 1)} together) – apply?`), facts: [fact('n', n), fact('h', h)],
      options: [{ id: 'all', label: P.t('Alle Vorschläge übernehmen', 'Apply every suggestion'), detail: P.t(`${n} ${plural(n, 'Wert', 'Werte')}, jeder einzeln rückgängig`, `${n} ${plural(n, 'value', 'values')}, each one undoable`), facts: [fact('n', n)], recommended: true }, { id: 'skip', label: P.t('Nicht übernehmen', 'Do not apply'), detail: P.t('Nichts wird geändert.', 'Nothing is changed.') }],
    });
    if (a === undefined) { absorb(P, SP, prefix, sid); return { pending: true }; }
    if (optOf(a) === 'skip') { SP.summary(P.t('Schätzungen nicht übernommen.', 'Estimates not applied.')); const x = absorb(P, SP, prefix, sid); return { out: { filled: 0 }, note: x.note }; }
    SP.batch('preview', H.fillCommands(ctx, items, 'cmd:fill'));
    absorb(P, SP, prefix, sid);
    return { out: { filled: n, hours: h }, wrote: true };
  },
  'check.waterline'(H, P, { st, prefix, sid, baseline }) {
    const { ctx } = P;
    const now = baselineOf(ctx);
    const base = baseline || now;
    let quarter = st.params.quarter || null;
    if (!quarter) {
      const moved = (q) => { const p = st.params.project; const a = p ? base.projects[p]?.[q]?.m ?? 0 : base.totals[q]?.missing ?? 0; const b = p ? now.projects[p]?.[q]?.m ?? 0 : now.totals[q]?.missing ?? 0; return Math.abs(b - a); };
      quarter = [...base.quarters].sort((a, b) => moved(b) - moved(a))[0] || null;
      if (quarter && moved(quarter) < 0.05) quarter = base.quarters[0];
    }
    const { story, delta } = waterlineStory(ctx, base, now, { project: st.params.project || null, quarter });
    const SP = sub(H, P, prefix);
    SP.storyObj('waterline', story);
    absorb(P, SP, prefix, sid);
    return { out: { delta } };
  },
  'notify.remind'(H, P, { st, prefix, sid, set }) {
    const { ctx } = P;
    const ids = set.members.filter((m) => m.kind === 'person' && dsOf(ctx).people?.[m.id]).map((m) => m.id).slice(0, 100);
    const on = dsOf(ctx).config?.notices?.enabled === true;
    const kind = st.params.kind || 'booking';
    const SP = sub(H, P, prefix);
    const n = ids.length;
    const a = SP.decide('send', {
      question: P.t(`${n} ${plural(n, 'Person', 'Personen')} erinnern – wirklich senden?`, `Remind ${n} ${plural(n, 'person', 'people')} – really send?`), facts: [fact('n', n)],
      options: [
        { id: 'none', label: P.t('Nichts senden', 'Send nothing'), detail: P.t('Lotse sendet nie von selbst', 'Lotse never sends on its own'), recommended: true },
        { id: 'remind', label: kind === 'gaps' ? P.t('Jira-Erinnerung an fehlende Werte', 'Jira reminder about missing values') : P.t('Jira-Erinnerung an fehlende Buchungen', 'Jira reminder about missing bookings'), detail: on ? P.t(`an ${n} ${plural(n, 'Person', 'Personen')} – jede steht in der Vorschau; gesendet ist gesendet`, `to ${n} ${plural(n, 'person', 'people')} – each one is in the preview; once sent, it is sent`) : P.t('Erinnerungen sind in der Konfiguration ausgeschaltet.', 'Reminders are switched off in the configuration.'), facts: [fact('n', n)], disabled: !on },
      ],
    });
    if (a === undefined) { absorb(P, SP, prefix, sid); return { pending: true }; }
    if (optOf(a) === 'remind' && on && n) SP.batch('preview', [{ id: 'cmd:remind', command: 'notice.remind', params: { kind, people: ids }, title: P.t('Erinnerung senden', 'Send the reminder') }]);
    else SP.summary(P.t('Nichts gesendet.', 'Nothing sent.'));
    const x = absorb(P, SP, prefix, sid);
    return { out: {}, note: x.note };
  },
  'doc.job'(H, P, { st, prefix, sid, set }) {
    const { ctx } = P;
    const L = P.L;
    const p = st.params;
    const subjects = set.entity === 'teams' ? 'teams' : set.entity === 'projects' ? 'projects' : 'people';
    const ids = set.members.map((m) => m.id).slice(0, 24);
    let next = p.next ?? set.query?.window?.next ?? 0, past = p.past ?? set.query?.window?.past ?? 0;
    if (!next && !past) next = 4;
    let blocks = (p.blocks || []).filter((b) => BLOCKS_FOR[subjects].includes(b));
    if (!blocks.length) blocks = [...DEFAULT_BLOCKS[subjects]];
    if (BLOCKS_FOR[subjects].includes('risks') && !blocks.includes('risks')) blocks.push('risks');
    if (!past) blocks = blocks.filter((b) => b !== 'bookings' && b !== 'planActual');
    if (!blocks.length) blocks = [...DEFAULT_BLOCKS[subjects]];
    const audience = p.audience || (subjects === 'teams' ? 'teamLeads' : subjects === 'projects' ? 'owners' : 'colleagues');
    const tone = p.tone || (audience === 'management' ? 'formal' : 'friendly');
    const format = p.format === 'pdfEach' && ids.length < 2 ? 'pdfAll' : p.format || 'pdfAll';
    const job = { v: 1, text: String(st.clause || '').slice(0, 200), lang: L, scope: { kind: 'portfolio', ref: null, name: 'Portfolio' }, subjects, blocks, added: [], window: { past, next, label: winLabel(past, next), stated: true }, format, audience, tone, personal: true,
      said: { scope: true, subjects: true, blocks: true, window: true, format: true, audience: true, tone: true }, ambiguous: [], people: ids, only: true };
    // an own (or AI-drafted, checked) opening line for every section – optional
    const SP = sub(H, P, prefix);
    const ov = overviewStory(ctx, job, runJob(ctx, job));
    const intro = SP.decide('intro', {
      question: P.t('Ein eigener Einleitungssatz für jeden Abschnitt?', 'An own opening line for every section?'), custom: 'note',
      options: [{ id: 'none', label: P.t('Lotses Standardtext', 'Lotse\'s standard text'), recommended: true }, { id: 'own', label: P.t('Eigener Satz', 'Own sentence') }],
      freeText: { kind: 'text', min: 1, max: 280, optional: true, placeholder: P.t('z. B. „Danke für euren Einsatz in diesem Quartal.“', 'e.g. "Thanks for your work this quarter."') }, assist: { kind: 'intro', story: ov, max: 280 },
    });
    if (intro === undefined) { absorb(P, SP, prefix, sid); return { pending: true }; }
    let text = intro?.text && intro.option !== 'none' ? intro.text : null;
    let check = null;
    if (text && intro.ai) { check = checkedText(ov, text, L); if (!check.ok) text = null; }
    SP.steps.at(-1).check = check;
    absorb(P, SP, prefix, sid);
    const prefill = { blocks, people: ids, window: 'said', format, tone, send: 'none' };
    const OSP = sub(H, P, prefix, prefill);
    H.specOf('orchestrate').plan(OSP, { job: { ...job, ...(text ? { intro: text.slice(0, 280) } : {}) } });
    const r = absorb(P, OSP, prefix, sid);
    if (r.pending) return { pending: true };
    return { out: { doc: { job: r.job || null, format, ai: !!(text && intro.ai) } }, note: r.note };
  },
  'doc.list'(H, P, { st, prefix, sid, set }) {
    const { ctx } = P;
    const spec = { kind: 'list', set, title: null };
    const SP = sub(H, P, prefix);
    const doc = buildChainDoc(ctx, spec);
    if (st.params.format === 'text') {
      SP.summary(doc.sections[0].message.text);
      const a = absorb(P, SP, prefix, sid);
      return { out: { doc: { chain: spec, text: doc.sections[0].message.text } }, note: a.note };
    }
    SP.batch('preview', [{ id: 'cmd:list', command: 'doc.chain', params: { doc: spec }, title: P.t('Liste als PDF', 'List as PDF') }]);
    const pv = SP.steps.find((x) => x.id === 'preview');
    if (pv) {
      pv.title = P.t('Vorschau – so wird die Liste', 'Preview – this is the list');
      pv.summary = P.t(`${doc.title}: ${set.total} ${plural(set.total, 'Zeile', 'Zeilen')} mit Nachweis – nichts wird gesendet.`, `${doc.title}: ${set.total} ${plural(set.total, 'row', 'rows')} with a proof – nothing is sent.`);
      pv.facts = [...(pv.facts || []), fact('rows', set.total), ...Object.values(set.query?.window || {}).filter((v) => typeof v === 'number').map((v) => fact('window', v))];
      pv.outline = { title: doc.title, subtitle: doc.subtitle, sections: doc.sections.map((s) => ({ id: s.id, heading: s.heading, tone: s.tone, findings: set.total })), figures: doc.proof.length, format: 'pdfAll' };
      pv.options = pv.options.map((o) => (o.id === 'apply' ? { ...o, label: P.t('PDF erstellen', 'Create the PDF') } : { ...o, label: P.t('Nicht erstellen', 'Do not create') }));
    }
    absorb(P, SP, prefix, sid);
    return { out: { doc: { chain: spec } } };
  },
  'doc.brief'(H, P, { st, prefix, sid, plan, outs }) {
    const { ctx } = P;
    const L = P.L;
    const model = computedOf(ctx).model;
    const k = plan.steps.findIndex((x) => x.id === sid);
    const project = [...plan.steps.slice(0, k)].reverse().map((x) => x.params?.project).find(Boolean) || null;
    const audience = st.params.audience || 'owners';
    const owner = project ? model.itemByRef.get(project)?.owner : null;
    const to = audience === 'owners' ? owner?.name || (project ? model.itemByRef.get(project)?.name : '') : audience === 'management' ? P.t('Geschäftsführung', 'Management') : audience === 'teamLeads' ? P.t('Teamleitungen', 'Team leads') : '';
    const res = results(P, plan, outs, k);
    const story = briefStory(ctx, res, { to, project });
    const lotseText = briefMessage(L, story, to, audience);
    const SP = sub(H, P, prefix);
    SP.storyObj('brief', story);
    const n = SP.decide('note', {
      question: P.t(`Der Text für ${to || 'den Empfänger'} – Lotses Fassung oder eine eigene?`, `The text for ${to || 'the reader'} – Lotse's version or an own one?`), custom: 'note',
      options: [{ id: 'lotse', label: P.t('Lotses Text', 'Lotse\'s text'), recommended: true }, { id: 'own', label: P.t('Eigener Text', 'Own text') }], draft: lotseText,
      freeText: { kind: 'text', min: 1, max: 1200, optional: true, placeholder: P.t('eigener Text (optional)', 'own text (optional)') }, assist: { kind: 'brief', story, max: 1200, to },
    });
    if (n === undefined) { absorb(P, SP, prefix, sid); return { pending: true }; }
    let text = n?.text && n.option !== 'lotse' ? n.text : lotseText;
    let check = null;
    if (n?.text && n.ai) { check = checkedText(story, n.text, L); if (!check.ok) text = lotseText; }
    SP.steps.at(-1).check = check;
    const message = { to, subject: P.t(`Zusammenfassung: ${short(plan.text, 60)}`, `Summary: ${short(plan.text, 60)}`), text, ai: !!(n?.ai && check?.ok) };
    if (st.params.format === 'pdf') {
      const brief = { title: P.t(`Zusammenfassung für ${to || 'den Auftrag'}`, `Summary for ${to || 'the job'}`), headline: story.headline, kpis: story.kpis.map((x) => ({ label: x.label, value: x.value, unit: x.unit })), findings: story.findings.map((f) => ({ text: f.text, tone: f.tone })), message, ai: message.ai, sources: story.sources };
      SP.batch('preview', [{ id: 'cmd:brief', command: 'doc.chain', params: { doc: { kind: 'brief', brief } }, title: P.t('Zusammenfassung als PDF', 'Summary as PDF') }]);
    }
    absorb(P, SP, prefix, sid);
    return { out: { message, check } };
  },
};
SECTIONS['wf'] = SECTIONS.workflow;

// ---------- the workflow ----------
export function chainMissions(H) {
  H.answerKinds.chainPlan = (value0, ctx, step) => {
    // 'run' alone = Lotse's plan exactly as shown
    const value = value0 === 'run' ? { option: 'run', plan: step.chain?.lotse, source: 'lotse' } : value0;
    if (!value || typeof value !== 'object' || value.option !== 'run') throw invalid('answer', 'run with a plan');
    const plan = cleanPlan(value.plan, ctx, { source: value.source === 'ai' ? 'ai' : 'lotse' });
    return { option: 'run', plan, source: ['lotse', 'ai', 'edited'].includes(value.source) ? value.source : 'lotse' };
  };
  H.answerKinds.note = (value, ctx, step) => {
    const opt = typeof value === 'string' ? value : value?.option;
    if (!(step.options || []).some((o) => o.id === opt && !o.disabled)) throw invalid('answer', 'unknown option');
    const text = value && typeof value === 'object' && typeof value.text === 'string' ? value.text.trim() : '';
    if (text && text.length > (step.freeText?.max || 280)) throw invalid('answer', 'text too long');
    if (opt !== step.options[0].id && !text) throw invalid('answer', 'text required');
    return { option: opt, ...(text && opt !== step.options[0].id ? { text, ai: value.ai === true } : {}) };
  };
  const chain = {
    id: 'chain', title: (L) => T(L, 'Mehrstufiger Auftrag', 'Multi-step job'), params: ['text'],
    // chains are routed by chainRoute (route.js); this catches the explicit way to ask for one
    match: [/\bmehrstufige[nrs]? (auftrag|aufgabe|job)\b|\bmulti-?step (job|task)\b|\b(auftrag|job) in (mehreren|several) (schritten|steps)\b/],
    plan(P, { text = '', plan: preset = null }) {
      const { ctx } = P;
      let request = String(text || '').trim();
      if (!request && !preset) {
        const r = P.decide('request', { question: P.t('Was soll Lotse erledigen? Beschreib den ganzen Auftrag – gern mit mehreren Schritten.', 'What should Lotse get done? Describe the whole job – several steps are fine.'),
          options: [{ id: 'go', label: P.t('Plan erstellen', 'Make the plan'), recommended: true }], freeText: { kind: 'text', min: 8, max: 600, placeholder: P.t('z. B. „Finde alle über 100 % in den nächsten 4 Wochen, plane ihre Wochen auf 100 % und gib jedem ein PDF.“', 'e.g. "Find everyone over 100% in the next 4 weeks, plan their weeks to 100% and give each of them a PDF."') } });
        if (r === undefined) return;
        request = r?.text || '';
      }
      // ---- 0: the plan (frozen with its baseline once accepted) ----
      const old = P.prev.find((x) => x.id === 'plan');
      let pa;
      if (old && old.status === 'answered') { P.steps.push(old); pa = P.a.plan; }
      else {
        let lotse;
        try { lotse = preset ? cleanPlan(preset, ctx) : planChain(request, ctx); } catch { lotse = planChain(request, ctx); }
        const n = lotse.steps.length, u = lotse.unresolved.length;
        pa = P.decide('plan', {
          question: n ? P.t(`Lotse hat den Auftrag in ${n} ${plural(n, 'Schritt', 'Schritte')} zerlegt${u ? ` – ${u} ${plural(u, 'Teil', 'Teile')} noch offen` : ''}. Prüfen, anpassen, ausführen.`, `Lotse split the job into ${n} ${plural(n, 'step', 'steps')}${u ? ` – ${u} ${plural(u, 'part', 'parts')} still open` : ''}. Check, adjust, run.`)
            : P.t('Lotse konnte den Auftrag noch nicht in Schritte zerlegen – formuliere ihn um oder frag die KI.', 'Lotse could not split the job into steps yet – rephrase it or ask the AI.'),
          facts: [fact('steps', n), fact('open', u)], custom: 'chainPlan', edit: 'chain', chain: { text: request || lotse.text, lotse }, baseline: baselineOf(ctx),
          options: [{ id: 'run', label: P.t('Plan ausführen', 'Run the plan'), recommended: true, disabled: !n }], meta: { section: 'plan' },
        });
      }
      if (pa === undefined) return;
      const plan = pa.plan;
      const baseline = (old || P.steps.find((x) => x.id === 'plan'))?.baseline || null;
      const outs = {};
      for (let k = 0; k < plan.steps.length; k++) {
        const st = plan.steps[k];
        const sid = st.id;
        const prevSec = P.prev.filter((x) => x.meta?.section === sid);
        if (prevSec.length && prevSec.some((x) => x.meta?.end) && prevSec.every((x) => DONE.has(x.status))) {
          P.steps.push(...prevSec);
          outs[sid] = prevSec.find((x) => x.meta?.out)?.meta.out || {};
          const g = prevSec.find((x) => x.id === `${sid}:gate`);
          if (g && optOf(P.a[g.id]) === 'stop') { P.summary(P.t(`Nach Schritt ${k + 1} aufgehört – die übrigen Schritte sind nicht gelaufen.`, `Stopped after step ${k + 1} – the remaining steps did not run.`)); P.steps.at(-1).meta = { chain: true }; return; }
          continue;
        }
        const start = P.steps.length;
        const res = runSection(H, P, st, plan, outs, baseline) || {};
        const mine = P.steps.slice(start);
        if (mine.length) mine[0].meta = { ...mine[0].meta, out: res.out || {}, ...(res.note ? { note: res.note } : {}) };
        if (res.pending) return;
        outs[sid] = res.out || {};
        if (!mine.length) { // a section must show something: its note as an honest info story
          P.storyObj(`${sid}:note`, infoStory(ctx, { skill: 'chain', lang: P.L, headline: res.note || P.t('Für diesen Schritt gab es nichts zu tun.', 'There was nothing to do for this step.'), finding: P.t('Die übrigen Schritte laufen weiter.', 'The other steps go on.') }));
          P.steps.at(-1).meta = { section: sid, out: res.out || {}, ...(res.note ? { note: res.note } : {}) };
        }
        const wrote = res.wrote && P.steps.slice(start).some((x) => x.kind === 'command' && COMMANDS[x.command]?.write);
        if (wrote && k < plan.steps.length - 1) {
          const nx = plan.steps[k + 1];
          const nt = stepTitle(nx, ctx)[P.L === 'en' ? 1 : 0];
          const g = P.decide(`${sid}:gate`, {
            question: P.t(`Schritt ${k + 1} ist durch. Weiter mit Schritt ${k + 2} – Lotse rechnet mit dem neuen Stand.`, `Step ${k + 1} is through. Go on with step ${k + 2} – Lotse works with the new numbers.`), facts: [fact('step', k + 1), fact('next', k + 2)], gate: true, nextTitle: nt,
            options: [{ id: 'continue', label: P.t(`Weiter mit Schritt ${k + 2}`, `Go on with step ${k + 2}`), facts: [fact('next', k + 2)], recommended: true }, { id: 'stop', label: P.t('Hier aufhören', 'Stop here'), detail: P.t('Übernommenes bleibt, „Alles rückgängig“ geht weiter', 'what was applied stays; "Undo all" still works') }],
          });
          P.steps.at(-1).meta = { section: sid, end: true };
          if (g === undefined) return;
          if (optOf(g) === 'stop') { P.summary(P.t(`Nach Schritt ${k + 1} aufgehört – die übrigen Schritte sind nicht gelaufen.`, `Stopped after step ${k + 1} – the remaining steps did not run.`)); P.steps.at(-1).meta = { chain: true }; return; }
        } else {
          const last = [...P.steps].reverse().find((x) => x.meta?.section === sid);
          if (last) last.meta = { ...last.meta, end: true };
        }
      }
      const docs = Object.values(outs).filter((o) => o.doc).length;
      P.summary(P.t(`Alle ${plan.steps.length} Schritte sind durch${docs ? ` – ${docs} ${plural(docs, 'Dokument', 'Dokumente')} unten` : ''}.`, `All ${plan.steps.length} steps are through${docs ? ` – ${docs} ${plural(docs, 'document', 'documents')} below` : ''}.`));
      P.steps.at(-1).meta = { chain: true };
      P.steps.at(-1).facts = [fact('steps', plan.steps.length), fact('docs', docs)];
    },
  };
  return [chain];
}

// ---------- the run as the UI shows it: one entry per plan step, with its live status ----------
// status: planned → running → waiting (a decision or a preview) → done | skipped | failed
export function chainSections(state) {
  const steps = state?.steps || [];
  const planStep = steps.find((x) => x.id === 'plan');
  const plan = planStep?.answer?.plan || null;
  const cur = steps.find((x) => !DONE.has(x.status)) || null;
  if (!plan) return { plan: null, sections: [], current: cur };
  const sections = plan.steps.map((st) => {
    const mine = steps.filter((x) => x.meta?.section === st.id);
    const out = mine.find((x) => x.meta?.out)?.meta.out || {};
    const note = mine.find((x) => x.meta?.note)?.meta.note || null;
    const cmds = mine.filter((x) => x.kind === 'command');
    const writes = cmds.filter((x) => COMMANDS[x.command]?.write);
    let status = 'planned';
    if (mine.length) {
      if (cur && mine.includes(cur)) status = cur.kind === 'command' ? 'running' : cur.kind === 'story' ? 'running' : 'waiting';
      else if (mine.every((x) => DONE.has(x.status)) && mine.some((x) => x.meta?.end)) status = cmds.some((x) => x.status === 'failed') ? 'failed' : cmds.length && cmds.every((x) => x.status === 'skipped') && !mine.some((x) => x.kind === 'story') ? 'skipped' : 'done';
      else if (mine.some((x) => x.status !== 'todo')) status = 'running';
    }
    if (state.status === 'cancelled' && status !== 'done') status = status === 'planned' ? 'planned' : 'skipped';
    return { id: st.id, tool: st.tool, params: st.params, input: st.input, clause: st.clause, status, steps: mine, out, note, writes: writes.length, applied: writes.filter((x) => x.status === 'applied').length };
  });
  return { plan, sections, current: cur, source: planStep.answer?.source || 'lotse' };
}
// the plan as words (title + detail per step) – for the graph and for the tests
export function chainOutline(plan, ctx) {
  return (plan?.steps || []).map((st) => {
    const t = toolOf(st.tool);
    return { id: st.id, tool: st.tool, kind: t?.kind || null, icon: t?.icon || 'layers', title: stepTitle(st, ctx), detail: stepDetail(st, ctx), input: st.input, write: !!t?.write, irreversible: !!t?.irreversible, right: t?.right || null, rightOk: rightOk(ctx, t?.right), out: t?.out || null };
  });
}
void ENTITY_NAMES; void memberText; void sum;
