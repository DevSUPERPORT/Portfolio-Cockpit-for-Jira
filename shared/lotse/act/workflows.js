// Lotse acts – whole jobs as workflows: ordered steps a person walks through with Lotse.
//
//   step kinds   story    a Lotse Story (real data, sourced numbers) – next() moves on
//                decide   a checkpoint: question + options [{ id, label, detail, recommended, disabled, facts }] and/or
//                         freeText { kind: text|hours|date|team|tshirt|quarters, placeholder, min, max, optional };
//                         multi: true = several options. The runner waits for answer().
//                preview  the aggregated changes of the command steps after it (covers[]) – answer 'apply' | 'skip';
//                         'apply' stamps each command with its preview token (the only way a command gets one)
//                command  { command, params, token } – applyStep() runs it through the registry (token checked there)
//                summary  what was applied, skipped, failed
//
// Pure state machine (states are plain objects; the ctx rides along, not enumerable):
//   start(goal, ctx)                  → state          goal = 'fillGaps' | { id: 'fillGaps', params: { ref } }
//   answer(state, stepId, value, ctx?) → state         validates, records, RE-PLANS from the goal + data + answers
//   next(state, ctx?)                  → state         past a story / the summary
//   applyStep(state, io, ctx?)         → Promise<state> the current command step (needs its preview token)
//   cancel(state)                      → state         nothing more is written; applied steps stay (undoAll)
//   undoAll(state, io)                 → Promise<state> every applied command's own undo, newest first
//   current(state)                     → step | null
//   planWorkflow(goal, ctx, answers)   → { id, title, steps }   deterministic: same goal + data + answers = same steps
// state.status: 'running' (a story to read) | 'waiting' (decide/preview) | 'ready' (a command to apply) | 'done' | 'cancelled'
import { optimizeAll } from '../../optimize.js';
import { conflicts } from '../../weekPlan.js';
import { computeAll, buildModel, waterline, dataQuality } from '../../engine.js';
import { isCritical, isHighPriority } from '../../dispatch.js';
import { buildWeek, weekOf } from '../../mine.js';
import { suggestWeek, allocate } from '../../mineSuggest.js';
import { parseDay } from '../../smartActions.js';
import { dayIdx, isoOf, mondayOf } from '../../dates.js';
import { SKILLS } from '../skills/index.js';
import { draftHealth } from '../skills/healthDraft.js';
import { suggestFor } from '../skills/gapsFix.js';
import { dispatchPlan } from '../skills/dispatchAdvice.js';
import { weekData } from '../skills/myWeek.js';
import { newStory, kpi, ev, finding, follow, done as doneStory, infoStory, sum } from '../kit.js';
import { T, fold, langOf, fmt, r1, r2, ActError, can, meId, ownsProject, issueOf, fieldOfUsage, fieldName, cleanValue, valueText, computedOf, dsOf, plural, healthName, teamLabel, personLabel, projectLabel, unsourcedNumbers, fact } from './kit.js';
import { COMMANDS, optimizerPicks, REPORT_OPTIONS } from './commands.js';
import { registerMissions } from './missions.js';
import { scopeFromText, peopleFromText, windowFromText } from './orchestrate/plan.js';

const withC = (ctx) => (ctx.computed || !ctx.ds ? ctx : { ...ctx, computed: computeAll(ctx.ds) });
const optOf = (a) => (typeof a === 'string' ? a : a?.option ?? null);
const textOf = (a) => (a && typeof a === 'object' ? a.text ?? null : null);
const MAX_ONE_BY_ONE = 8;

// ---------- the planner: what a workflow's plan() builds with ----------
// prev = the run's steps before this re-plan (a chain freezes the steps it already finished – chain/run.js)
class Planner {
  constructor(ctx, answers, prev) { this.ctx = ctx; this.L = langOf(ctx); this.F = fmt(ctx); this.a = answers || {}; this.steps = []; this.c = computedOf(ctx); this.prev = prev || []; }
  t(de, en) { return T(this.L, de, en); }
  story(id, skill, params = {}) {
    let s;
    try { s = SKILLS[skill].run(this.ctx, params, this.L); } catch (e) {
      s = infoStory(this.ctx, { skill, lang: this.L, headline: this.t('Lotse konnte diese Übersicht gerade nicht berechnen.', 'Lotse could not compute this overview right now.'), finding: this.t('Ein Teil der Daten fehlt; die Ansichten des Cockpits zeigen die Einzelheiten.', 'Part of the data is missing; the cockpit views show the details.') });
    }
    this.steps.push({ id, kind: 'story', title: s.headline, story: s });
  }
  storyObj(id, s) { this.steps.push({ id, kind: 'story', title: s.headline, story: s }); }
  decide(id, spec) { this.steps.push({ id, kind: 'decide', ...spec }); return this.a[id]; }
  batch(id, cmds) {
    if (!cmds.length) return;
    const items = cmds.map((x) => {
      let preview;
      try { preview = COMMANDS[x.command].preview(this.ctx, x.params); } catch (e) { preview = { command: x.command, title: COMMANDS[x.command].title(this.L), write: COMMANDS[x.command].write, changes: [], count: 0, more: 0, totals: {}, summary: '', warnings: [], blocked: this.t('Diese Änderung passt nicht mehr zu den Daten.', 'This change no longer fits the data.'), error: e.code || 'ERROR', token: null }; }
      return { stepId: x.id, command: x.command, title: x.title || preview.title, preview };
    });
    const count = sum(items, (x) => x.preview.count);
    const ok = items.filter((x) => !x.preview.blocked);
    this.steps.push({
      id, kind: 'preview', title: this.t('Vorschau – noch ist nichts geändert', 'Preview – nothing is changed yet'), covers: cmds.map((x) => x.id), items,
      changes: items.flatMap((x) => x.preview.changes).slice(0, 40), count, more: Math.max(0, count - 40),
      warnings: items.flatMap((x) => [...x.preview.warnings, ...(x.preview.blocked ? [x.preview.blocked] : [])]),
      summary: ok.length ? this.t(`${count} ${plural(count, 'Änderung', 'Änderungen')} in ${ok.length} ${plural(ok.length, 'Schritt', 'Schritten')}.`, `${count} ${plural(count, 'change', 'changes')} in ${ok.length} ${plural(ok.length, 'step', 'steps')}.`) : this.t('Keine der Änderungen ist möglich.', 'None of the changes is possible.'),
      facts: [fact('changes', count), fact('steps', ok.length)],
      options: [{ id: 'apply', label: this.t('Übernehmen', 'Apply'), recommended: true, disabled: !ok.length }, { id: 'skip', label: this.t('Nicht übernehmen', 'Do not apply') }],
    });
    for (const x of cmds) this.steps.push({ id: x.id, kind: 'command', command: x.command, params: x.params, title: x.title || COMMANDS[x.command].title(this.L) });
  }
  summary(note) { this.steps.push({ id: 'summary', kind: 'summary', title: this.t('Zusammenfassung', 'Summary'), ...(note ? { note } : {}) }); }
}

// ---------- shared data helpers ----------
// fixable missing values with a value suggested from real data (gapsFix.suggestFor)
export function gapItems(ctx, { ref = null, team = null, urgentOnly = false, limit = 60, assignee = null, onlyField = null } = {}) {
  const c = computedOf(ctx);
  const { model } = c;
  const dq = ref ? dataQuality(model, new Set([ref])) : c.dq;
  const seen = new Set();
  const gaps = dq.gaps.filter((g) => g.severity === 'gap' && g.fixable && !g.isItem && g.rule.startsWith('missing:') && fieldOfUsage(g.field) && (!urgentOnly || g.urgent))
    .filter((g) => (seen.has(`${g.issueId}:${g.field}`) ? false : seen.add(`${g.issueId}:${g.field}`)))
    .sort((a, b) => b.urgent - a.urgent || (model.itemByRef.get(a.rootRef)?.rank ?? 999) - (model.itemByRef.get(b.rootRef)?.rank ?? 999) || String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));
  const out = [];
  for (const g of gaps) {
    if (out.length >= limit) break;
    const i = model.byId.get(g.issueId);
    if (!i) continue;
    // cheap filters first – a suggestion (similar finished work) is the expensive part
    if (assignee && i.assignee?.id !== assignee) continue;
    if (onlyField && fieldOfUsage(g.field) !== onlyField) continue;
    const sug = suggestFor(ctx, g);
    if (!sug) continue;
    if (team && !(i.team?.id === team || (g.field === 'team' && sug.value === team))) continue;
    const field = fieldOfUsage(g.field);
    try { cleanValue(ctx, field, sug.value); } catch { continue; }
    out.push({ g, sug, field, issue: i });
  }
  return out;
}
// dependency conflicts the cockpit can fix by moving the dependent work item (weekPlan.fixFor), one per work item
export function conflictFixes(ctx, { ref = null, team = null } = {}) {
  const { model } = computedOf(ctx);
  const list = conflicts({ model, moves: {}, scope: (x) => (!ref || x.dep.ref === ref || x.pre.ref === ref) && (!team || x.dep.teamId === team) }).filter((x) => x.fix && !x.fix.startOnly); // Lotse moves by whole weeks; a story without a start is fixed on the board
  const best = new Map();
  for (const x of list) { const b = best.get(x.fix.issueId); if (!b || x.fix.weeks > b.weeks) best.set(x.fix.issueId, { issueId: x.fix.issueId, key: x.dep.key, preKey: x.pre.key, weeks: x.fix.weeks, start: x.fix.start, due: x.fix.due, days: x.days }); }
  return [...best.values()].sort((a, b) => b.days - a.days || String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));
}
function gapValueText(ctx, x) { return valueText(ctx, x.field, x.sug.value); }
function gapBasis(ctx, x) {
  const L = langOf(ctx);
  return { similar: T(L, `Median von ${x.sug.n} ähnlichen erledigten Stories`, `median of ${x.sug.n} similar finished stories`), siblings: T(L, `aus ${x.sug.n} Geschwistern`, `from ${x.sug.n} siblings`), parent: T(L, 'vom übergeordneten Vorgang', 'from the parent'), stories: T(L, `aus den Terminen von ${x.sug.n} Stories`, `from the dates of ${x.sug.n} stories`) }[x.sug.basis] || '';
}
function fillCommands(ctx, items, prefix) {
  const by = new Map();
  for (const x of items) (by.get(x.field) || by.set(x.field, []).get(x.field)).push({ issue: x.issue.id, value: x.value ?? x.sug.value });
  const L = langOf(ctx);
  return [...by].map(([field, list]) => ({ id: `${prefix}:${field}`, command: 'issue.bulkFill', params: { field, items: list }, title: T(L, `${fieldName(field, L)} für ${list.length} ${plural(list.length, 'Vorgang', 'Vorgänge')}`, `${fieldName(field, L)} for ${list.length} work ${plural(list.length, 'item', 'items')}`) }));
}
const peakOf = (t, n = 4) => Math.max(0, ...t.util.slice(0, n).filter(Number.isFinite));

// ---------- the workflows ----------
const W = {};
const wf = (spec) => { W[spec.id] = spec; };

wf({
  id: 'weeklyPrep', title: (L) => T(L, 'Weekly vorbereiten', 'Prepare the weekly'), params: ['team'],
  match: [/bereite?n? .*\b(weekly|wochenplanung|woche|planung|planungsrunde|jour fixe)\b.*\bvor\b|\b(weekly|wochenplanung|planungsrunde)\b.*\bvorbereiten\b|\b(prepare|prep|get ready for)\b.*\b(weekly|week|planning|planning meeting)\b|\bweekly ?prep\b/],
  plan(P, { team = null }) {
    const { ctx, c } = P;
    P.story('story:plan', 'planningAdvice', team ? { team } : {});
    const opt = optimizeAll({ ds: dsOf(ctx), computed: c, team, target: 1 });
    const smooth = opt.smooth.suggestions;
    const moved = new Set(smooth.map((s) => s.taskId));
    const fixes = conflictFixes(ctx, { team }).filter((x) => !moved.has(x.issueId));
    fixes.forEach((x) => moved.add(x.issueId));
    const gaps = gapItems(ctx, { team, urgentOnly: true }).filter((x) => !(['start', 'due'].includes(x.field) && moved.has(x.issue.id)));
    const people = new Set(smooth.map((s) => s.personId)).size;
    const a = P.decide('focus', {
      question: P.t('Was soll Lotse für das Weekly vorbereiten?', 'What should Lotse prepare for the weekly?'), multi: true,
      options: [
        { id: 'smooth', label: P.t('Überlast glätten', 'Smooth overload'), detail: P.t(`${smooth.length} ${plural(smooth.length, 'Vorschlag', 'Vorschläge')} für ${people} ${plural(people, 'Person', 'Personen')}`, `${smooth.length} ${plural(smooth.length, 'suggestion', 'suggestions')} for ${people} ${plural(people, 'person', 'people')}`), facts: [fact('n', smooth.length), fact('people', people)], recommended: smooth.length > 0, disabled: !smooth.length },
        { id: 'conflicts', label: P.t('Terminkonflikte lösen', 'Fix schedule conflicts'), detail: P.t(`${fixes.length} ${plural(fixes.length, 'Vorgang beginnt', 'Vorgänge beginnen')} vor dem Ende ihres Vorgängers`, `${fixes.length} work ${plural(fixes.length, 'item starts', 'items start')} before their prerequisite ends`), facts: [fact('n', fixes.length)], recommended: fixes.length > 0, disabled: !fixes.length },
        { id: 'gaps', label: P.t('Dringende Lücken füllen', 'Fill urgent gaps'), detail: P.t(`${gaps.length} ${plural(gaps.length, 'Wert', 'Werte')} mit Vorschlag aus echten Daten`, `${gaps.length} ${plural(gaps.length, 'value', 'values')} with a suggestion from real data`), facts: [fact('n', gaps.length)], recommended: gaps.length > 0, disabled: !gaps.length },
        { id: 'nothing', label: P.t('Nur ansehen, nichts ändern', 'Just look, change nothing') },
      ],
    });
    if (a === undefined) return;
    const pick = new Set([].concat(a));
    const cmds = [];
    if (pick.has('smooth') && smooth.length) cmds.push({ id: 'cmd:smooth', command: 'plan.applyOptimizer', params: { mode: 'smooth', ...(team ? { team } : {}), ids: smooth.map((s) => s.id) }, title: P.t('Überlast glätten', 'Smooth overload') });
    if (pick.has('conflicts') && fixes.length) cmds.push({ id: 'cmd:conflicts', command: 'plan.move', params: { moves: fixes.map((x) => ({ issue: x.issueId, start: x.start, due: x.due })) }, title: P.t('Terminkonflikte lösen', 'Fix schedule conflicts') });
    if (pick.has('gaps') && gaps.length) cmds.push(...fillCommands(ctx, gaps, 'cmd:gaps'));
    P.batch('preview', cmds);
    P.summary(cmds.length ? null : P.t('Nichts geändert – das Weekly startet mit der Übersicht.', 'Nothing changed – the weekly starts with the overview.'));
  },
});

wf({
  id: 'resolveOverload', title: (L) => T(L, 'Überlast auflösen', 'Resolve overload'), params: ['team', 'person'],
  match: [/\b(loese|loes|loesen|beheb|behebe|abbauen|baue|reduzier|glaett|fix|resolve|solve|reduce|tackle|handle)\w*\b.*\b(ueberlast\w*|overload\w*|ueberstunden|overtime)\b|\b(ueberlast\w*|overload\w*)\b.*\b(loesen|beheben|abbauen|resolve|fix|reduce)\b/],
  plan(P, { team = null, person = null }) {
    const { ctx, c } = P;
    let tm = team;
    if (!tm && !person) {
      const over = (c.weeks?.teams || []).filter((t) => t.teamId !== '_none' && c.model.teams.has(t.teamId) && peakOf(t) > 1).sort((a, b) => peakOf(b) - peakOf(a)).slice(0, 6);
      const a = P.decide('team', {
        question: P.t('Welches Team soll Lotse entlasten?', 'Which team should Lotse relieve?'),
        options: over.map((t, k) => { const pct = Math.round(peakOf(t) * 100); return { id: t.teamId, label: teamLabel(ctx, t.teamId), detail: P.t(`Spitze ${pct} % in den nächsten 4 Wochen`, `peak ${pct}% in the next 4 weeks`), facts: [fact('peak', pct), fact('weeks', 4)], recommended: k === 0 }; }),
      });
      if (a === undefined) return;
      tm = optOf(a);
    }
    P.story('story:team', tm ? 'teamBrief' : 'overtime', tm ? { team: tm } : {});
    const base = { mode: 'smooth', ...(tm ? { team: tm } : {}), ...(person ? { person } : {}) };
    const stretch = optimizerPicks(ctx, { ...base, kind: 'stretch' });
    const later = optimizerPicks(ctx, { ...base, kind: 'shift' });
    const reb = optimizerPicks(ctx, { ...base, mode: 'rebalance' });
    const first = [['stretch', stretch], ['later', later], ['reassign', reb]].find(([, l]) => l.length)?.[0] || 'accept';
    const who = person ? personLabel(ctx, person) : P.t(`Team ${teamLabel(ctx, tm)}`, `team ${teamLabel(ctx, tm)}`);
    const a = P.decide('how', {
      question: P.t(`Wie soll Lotse die Überlast von ${who} auflösen?`, `How should Lotse resolve the overload of ${who}?`),
      options: [
        { id: 'stretch', label: P.t('Strecken', 'Stretch'), detail: P.t(`${stretch.length} ${plural(stretch.length, 'Vorgang bekommt', 'Vorgänge bekommen')} ein späteres Ende, gleiche Stunden über mehr Wochen`, `${stretch.length} work ${plural(stretch.length, 'item gets', 'items get')} a later end, the same hours over more weeks`), facts: [fact('n', stretch.length)], recommended: first === 'stretch', disabled: !stretch.length },
        { id: 'later', label: P.t('Später legen', 'Move later'), detail: P.t(`${later.length} ${plural(later.length, 'Vorgang rückt', 'Vorgänge rücken')} ganz in freie Wochen`, `${later.length} work ${plural(later.length, 'item moves', 'items move')} into free weeks`), facts: [fact('n', later.length)], recommended: first === 'later', disabled: !later.length },
        { id: 'reassign', label: P.t('Umverteilen', 'Reassign'), detail: P.t(`${reb.length} ${plural(reb.length, 'Vorgang geht', 'Vorgänge gehen')} an Kolleginnen und Kollegen mit Luft`, `${reb.length} work ${plural(reb.length, 'item goes', 'items go')} to colleagues with room`), facts: [fact('n', reb.length)], recommended: first === 'reassign', disabled: !reb.length },
        { id: 'accept', label: P.t('Überlast bewusst annehmen', 'Accept the overload'), detail: P.t('Nichts wird geändert.', 'Nothing is changed.'), recommended: first === 'accept' },
      ],
    });
    if (a === undefined) return;
    const how = optOf(a);
    if (how === 'accept') { P.summary(P.t(`Die Überlast von ${who} bleibt bewusst bestehen.`, `The overload of ${who} stays, deliberately.`)); return; }
    const picks = { stretch, later, reassign: reb }[how];
    P.batch('preview', [{ id: `cmd:${how}`, command: 'plan.applyOptimizer', params: { ...base, mode: how === 'reassign' ? 'rebalance' : 'smooth', ...(how === 'reassign' ? {} : { kind: how === 'stretch' ? 'stretch' : 'shift' }), ids: picks.map((s) => s.id) }, title: { stretch: P.t('Strecken', 'Stretch'), later: P.t('Später legen', 'Move later'), reassign: P.t('Umverteilen', 'Reassign') }[how] }]);
    P.summary();
  },
});

// --- quarterly re-ranking: what-if of candidate orders on the waterline ---
function evalOrder(ctx, order, q) {
  const c = computedOf(ctx);
  const ds = dsOf(ctx);
  const rank = new Map(order.map((r, i) => [r, i + 1]));
  const m2 = buildModel({ ...ds, portfolio: (ds.portfolio || []).map((p) => ({ ...p, rank: rank.get(p.ref) ?? p.rank })) });
  const wl = waterline(m2, c.metrics, c.support);
  const missing = Math.round(sum(m2.items, (x) => sum(wl.projectQ[x.ref]?.[q]?.teams || [], (t) => t.demand - t.staffed)));
  const notStaffed = m2.items.filter((x) => wl.projectQ[x.ref]?.[q] && wl.projectQ[x.ref][q].status !== 'ok').length;
  return { missing, notStaffed };
}
export function rankCandidates(ctx, q) {
  const L = langOf(ctx);
  const { model, metrics, wl } = computedOf(ctx);
  const cur = model.items.map((x) => x.ref);
  const H = { critical: 0, atRisk: 1 };
  const miss = (ref) => sum(wl.projectQ[ref]?.[q]?.teams || [], (t) => t.demand - t.staffed);
  const due = (ref) => metrics.get(ref)?.due || model.itemByRef.get(ref)?.due || '9999-12-31';
  const by = (f) => [...cur].sort((a, b) => f(a, b) || model.itemByRef.get(a).rank - model.itemByRef.get(b).rank);
  const list = [
    { id: 'current', label: T(L, 'Heutige Rangfolge', 'Today\'s ranking'), order: cur },
    { id: 'due', label: T(L, 'Termin zuerst', 'Due date first'), order: by((a, b) => String(due(a)).localeCompare(String(due(b)))) },
    { id: 'risk', label: T(L, 'Gefährdete zuerst', 'At-risk first'), order: by((a, b) => (H[model.itemByRef.get(a).health?.status] ?? 2) - (H[model.itemByRef.get(b).health?.status] ?? 2)) },
    { id: 'fit', label: T(L, 'Besetzbares zuerst', 'Staffable first'), order: by((a, b) => miss(a) - miss(b)) },
  ];
  const seen = new Set();
  return list.filter((x) => (seen.has(x.order.join()) ? false : seen.add(x.order.join()))).slice(0, 3 + (list.length > 3 ? 1 : 0)).map((x) => ({ ...x, ...evalOrder(ctx, x.order, q) }));
}
function rankStory(ctx, q, cands, best) {
  const L = langOf(ctx);
  const s = newStory(ctx, { skill: 'whatIf', subject: { kind: 'portfolio', ref: null, name: 'Portfolio' }, lang: L });
  s.id = `whatIf:rerank:${q}`;
  const F = s.fmt;
  const cur = cands.find((x) => x.id === 'current');
  s.kpis.push(kpi('curMissing', T(L, 'Fehlt heute', 'Missing today'), cur.missing, 'h', { tone: cur.missing ? 'warn' : 'ok' }));
  s.kpis.push(kpi('bestMissing', T(L, 'Fehlt im besten Fall', 'Missing at best'), best.missing, 'h', { tone: best.missing < cur.missing ? 'ok' : 'ink' }));
  s.kpis.push(kpi('curNo', T(L, 'Nicht voll besetzbar heute', 'Not fully staffable today'), cur.notStaffed, 'n'));
  s.kpis.push(kpi('bestNo', T(L, 'Nicht voll besetzbar im besten Fall', 'Not fully staffable at best'), best.notStaffed, 'n'));
  s.visual = { kind: 'bars', data: { unit: 'h', items: cands.map((x) => ({ label: x.label, value: x.missing, tone: x.id === best.id ? 'ok' : x.id === 'current' ? 'ink' : 'muted', sub: T(L, `${x.notStaffed} nicht voll besetzbar`, `${x.notStaffed} not fully staffable`) })) }, caption: T(L, `Fehlende Stunden im Quartal je Rangfolge – kürzer ist besser.`, `Missing hours in the quarter per ranking – shorter is better.`) };
  for (const x of cands) s.findings.push(finding(T(L, `${x.label}: ${F.h(x.missing)} fehlen, ${x.notStaffed} ${plural(x.notStaffed, 'Projekt', 'Projekte')} nicht voll besetzbar.`, `${x.label}: ${F.h(x.missing)} missing, ${x.notStaffed} ${plural(x.notStaffed, 'project', 'projects')} not fully staffable.`), x.id === best.id ? 'ok' : 'info', x.id === best.id ? 80 : x.id === 'current' ? 60 : 40,
    [ev(T(L, 'fehlt', 'missing'), x.missing, 'h'), ev(T(L, 'nicht voll besetzbar', 'not fully staffable'), x.notStaffed, 'n'), ev(T(L, 'Quartal', 'Quarter'), q, 'quarter')]));
  s.tone = best.missing < cur.missing ? 'warn' : 'ok';
  s.headline = best.id === 'current' ? T(L, `Die heutige Rangfolge ist schon die beste: ${F.h(cur.missing)} fehlen in ${F.quarter(q)}.`, `Today's ranking is already the best: ${F.h(cur.missing)} missing in ${F.quarter(q)}.`)
    : T(L, `Mit „${best.label}“ fehlen in ${F.quarter(q)} ${F.h(best.missing)} statt ${F.h(cur.missing)}.`, `With "${best.label}", ${F.h(best.missing)} instead of ${F.h(cur.missing)} are missing in ${F.quarter(q)}.`);
  s.findings = s.findings.slice(0, 4);
  s.followUps.push(follow(T(L, 'Wasserlinie', 'Waterline'), T(L, 'Ab welchem Rang reicht die Kapazität nicht?', 'From which rank does capacity run out?')), follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')));
  s.how = { text: T(L, 'Jede Rangfolge läuft durch dieselbe Wasserlinie wie das Cockpit (gleiche Kapazität, Support-Reserve, Schätzungen); fehlend = Bedarf minus besetzbare Stunden je Projekt und Team im Quartal.', 'Each ranking runs through the same waterline as the cockpit (same capacity, support reserve, estimates); missing = demand minus staffable hours per project and team in the quarter.'), inputs: [[T(L, 'Quartal', 'Quarter'), F.quarter(q)], [T(L, 'Varianten', 'Variants'), String(cands.length)]] };
  s.confidence = 'medium';
  s.sources = ['Jira', T(L, 'Wasserlinie', 'Waterline')];
  return doneStory(s);
}
wf({
  id: 'reRankQuarter', title: (L) => T(L, 'Quartals-Rangfolge neu setzen', 'Re-rank the quarter'), params: ['quarter'],
  match: [/\b(re-?rank\w*|reprioriti[sz]\w*|repriorisier\w*|neu (ranken|priorisieren|ordnen|sortieren))\b|\b(rangfolge|ranking|priorisierung|prioritaeten)\b.*\b(neu|quartal|quarter)\b|\b(quartals-?ranking|quarterly rank\w*)\b|\b(ordne|sortiere|priorisiere)\b.*\b(portfolio|projekte)\b.*\bneu\b/],
  plan(P, { quarter = null }) {
    const { ctx, c, F } = P;
    const q = quarter && c.wl.quarters.includes(quarter) ? quarter : c.wl.quarters[0];
    const cands = rankCandidates(ctx, q);
    const best = [...cands].sort((a, b) => a.missing - b.missing || a.notStaffed - b.notStaffed || (a.id === 'current' ? -1 : b.id === 'current' ? 1 : 0))[0];
    P.storyObj('story:compare', rankStory(ctx, q, cands, best));
    const a = P.decide('order', {
      question: P.t(`Welche Rangfolge soll für ${F.quarter(q)} gelten?`, `Which ranking should apply for ${F.quarter(q)}?`),
      options: cands.map((x) => ({ id: x.id, label: x.label, detail: P.t(`${F.h(x.missing)} fehlen, ${x.notStaffed} ${plural(x.notStaffed, 'Projekt', 'Projekte')} nicht voll besetzbar`, `${F.h(x.missing)} missing, ${x.notStaffed} ${plural(x.notStaffed, 'project', 'projects')} not fully staffable`), facts: [fact('missing', x.missing), fact('notStaffed', x.notStaffed)], recommended: x.id === best.id, order: x.order.map((r) => ({ ref: r, name: projectLabel(ctx, r) })) })),
    });
    if (a === undefined) return;
    const pick = cands.find((x) => x.id === optOf(a));
    if (!pick || pick.id === 'current') { P.summary(P.t('Die Rangfolge bleibt, wie sie ist.', 'The ranking stays as it is.')); return; }
    P.batch('preview', [{ id: 'cmd:rank', command: 'rank.reorder', params: { order: pick.order }, title: pick.label }]);
    P.summary();
  },
});

wf({
  id: 'fillGaps', title: (L) => T(L, 'Lücken füllen', 'Fill the gaps'), params: ['project', 'team'],
  match: [/\b(fuell|fuelle|fuellen|ergaenz|ergaenze|ergaenzen|schliess|schliesse|schliessen|fill|close)\w*\b.*\b(luecke\w*|gaps?|fehlende (werte|daten|angaben)|missing (values|data|fields))\b/],
  plan(P, { ref = null, team = null }) {
    const { ctx } = P;
    P.story('story:gaps', 'gapsFix', ref ? { ref } : {});
    const items = gapItems(ctx, { ref, team });
    if (!items.length) { P.summary(P.t('Für die Lücken hier gibt es keine belastbaren Vorschläge – nichts zu übernehmen.', 'There are no sound suggestions for the gaps here – nothing to apply.')); return; }
    const n = items.length;
    const fields = new Set(items.map((x) => x.field)).size;
    const a = P.decide('mode', {
      question: P.t(`${n} fehlende ${plural(n, 'Wert', 'Werte')} mit Vorschlag aus echten Daten – wie weiter?`, `${n} missing ${plural(n, 'value', 'values')} with a suggestion from real data – how to go on?`), facts: [fact('n', n)],
      options: [
        { id: 'all', label: P.t('Alle Vorschläge übernehmen', 'Apply every suggestion'), detail: P.t(`${n} ${plural(n, 'Wert', 'Werte')} in ${fields} ${plural(fields, 'Feld', 'Feldern')}, jeder einzeln rückgängig`, `${n} ${plural(n, 'value', 'values')} in ${fields} ${plural(fields, 'field', 'fields')}, each one undoable`), facts: [fact('n', n), fact('fields', fields)], recommended: true },
        { id: 'one', label: P.t('Einzeln durchgehen', 'One by one'), detail: P.t(`die ersten ${Math.min(n, MAX_ONE_BY_ONE)} nacheinander bestätigen oder ändern`, `confirm or change the first ${Math.min(n, MAX_ONE_BY_ONE)} one after another`), facts: [fact('n', Math.min(n, MAX_ONE_BY_ONE))] },
        { id: 'skip', label: P.t('Überspringen', 'Skip'), detail: P.t('Nichts wird geändert.', 'Nothing is changed.') },
      ],
    });
    if (a === undefined) return;
    const mode = optOf(a);
    if (mode === 'skip') { P.summary(P.t('Nichts geändert.', 'Nothing changed.')); return; }
    let chosen = items;
    if (mode === 'one') {
      chosen = [];
      for (const x of items.slice(0, MAX_ONE_BY_ONE)) {
        const val = gapValueText(ctx, x);
        const b = P.decide(`gap:${x.g.id}`, {
          question: P.t(`${x.g.key}: ${fieldName(x.field, P.L)} fehlt – Vorschlag ${val} (${gapBasis(ctx, x)}).`, `${x.g.key}: ${fieldName(x.field, P.L)} missing – suggestion ${val} (${gapBasis(ctx, x)}).`),
          facts: [fact('n', x.sug.n), ...(typeof x.sug.value === 'number' ? [fact('value', x.sug.value)] : [])], issue: { key: x.g.key, summary: x.issue.summary },
          options: [{ id: 'accept', label: P.t(`Übernehmen: ${val}`, `Apply: ${val}`), recommended: true, facts: typeof x.sug.value === 'number' ? [fact('value', x.sug.value)] : [] }, { id: 'skip', label: P.t('Auslassen', 'Leave out') }],
          freeText: { kind: x.field === 'estimate' ? 'hours' : ['start', 'due'].includes(x.field) ? 'date' : x.field === 'team' ? 'team' : x.field === 'quarters' ? 'quarters' : 'tshirt', placeholder: P.t(`eigener Wert, z. B. ${val}`, `own value, e.g. ${val}`), optional: true },
        });
        if (b === undefined) return;
        if (optOf(b) === 'skip') continue;
        chosen.push(b && typeof b === 'object' && b.value != null ? { ...x, value: b.value } : x);
      }
    }
    P.batch('preview', fillCommands(ctx, chosen, 'cmd:fill'));
    P.summary(chosen.length ? null : P.t('Alle Lücken ausgelassen – nichts geändert.', 'Every gap left out – nothing changed.'));
  },
});

// --- my week: gaps, proposals, booking ---
function bookingProposals(ctx) {
  const me = meId(ctx);
  const c = computedOf(ctx);
  const today = dsOf(ctx).today;
  const wk = weekOf(today);
  const data = weekData(ctx, me, wk.from, wk.to);
  const w = buildWeek({ computed: c, data, meId: me, today, lang: langOf(ctx) });
  const days = w.days.map((d) => ({ iso: d.iso, possible: d.possible, isPast: d.isPast, isToday: d.isToday }));
  const sw = suggestWeek({ days, issues: data.issues, worklogs: data.worklogs, events: [] });
  const list = sw.list.filter((x) => !x.synthetic);
  // a day the plan cannot fill (no dated work covers it): what I booked on this week, in the same proportions
  const byIssue = new Map();
  for (const l of data.worklogs) byIssue.set(l.issueId, (byIssue.get(l.issueId) || 0) + l.h);
  const shapes = new Map(data.issues.map((i) => [i.id, i]));
  for (const d of days) {
    if (!(d.isPast || d.isToday) || !(d.possible > 0) || list.some((x) => x.d === d.iso)) continue;
    const gap = Math.floor((d.possible - sum(data.worklogs.filter((l) => l.d === d.iso), (l) => l.h)) * 4 + 1e-6) / 4;
    if (gap < 0.25) continue;
    const cands = [...byIssue].map(([id, h]) => ({ issue: shapes.get(id), w: h })).filter((x) => x.issue && x.issue.status?.cat !== 'done' && !x.issue.type?.subtask && !data.worklogs.some((l) => l.issueId === x.issue.id && l.d === d.iso))
      .sort((a, b) => b.w - a.w || String(a.issue.key).localeCompare(String(b.issue.key), undefined, { numeric: true })).slice(0, 4);
    for (const a of allocate(gap, cands)) list.push({ issueId: a.issue.id, key: a.issue.key, d: d.iso, h: a.h, basis: 'week' });
  }
  return { list, total: r2(sum(list, (x) => x.h)), week: wk, w };
}
function teamBelow(ctx) {
  const ds = dsOf(ctx);
  const me = meId(ctx);
  const cap = ds.capacity || {};
  const myTeams = new Set([cap.people?.[me]?.teamId, ...Object.entries(cap.teams || {}).filter(([, t]) => (t?.responsible || []).includes(me)).map(([id]) => id)].filter(Boolean));
  const today = dayIdx(ds.today), mon = mondayOf(today);
  const days = Math.min(5, today - mon + 1);
  const min = (ds.config?.booking?.minPct ?? 80) / 100;
  const booked = new Map();
  for (const x of [...(ds.issues || []), ...(ds.supportTickets?.tickets || [])]) for (const l of x.worklogs || []) { const d = dayIdx(l.d); if (d >= mon && d <= today) booked.set(l.a, (booked.get(l.a) || 0) + (l.h || 0)); }
  return Object.entries(cap.people || {}).filter(([id, p]) => id !== me && ds.people?.[id] && myTeams.has(p.teamId) && (booked.get(id) || 0) < ((+p.weeklyHours || 0) / 5) * days * min).map(([id]) => id);
}
wf({
  id: 'bookingCheck', title: (L) => T(L, 'Buchungen prüfen', 'Check my bookings'), params: [],
  match: [/\bbuchungs-?check\b|\b(pruef|pruefe|checke?|kontrollier)\w*\b.*\b(buchung\w*|gebucht|stunden|zeiterfassung)\b|\bcheck\b.*\b(bookings?|booked|my hours|timesheet|time ?sheet)\b|\bbooking check\b|\b(vervollstaendig\w*)\b.*\bwoche\b|\bcomplete my (week|timesheet)\b|\bfehlende buchungen\b.*\b(nachbuchen|buchen|ergaenzen)\b/],
  plan(P) {
    const { ctx, F } = P;
    if (!meId(ctx)) { P.summary(P.t('Ohne angemeldete Person gibt es keine eigenen Buchungen.', 'Without a signed-in person there are no own bookings.')); return; }
    P.story('story:week', 'myWeek', {});
    const pr = bookingProposals(ctx);
    const today = dsOf(ctx).today;
    const todays = pr.list.filter((x) => x.d === today);
    const tH = r2(sum(todays, (x) => x.h));
    const cmds = [];
    if (pr.list.length) {
      const a = P.decide('book', {
        question: P.t(`In dieser Woche fehlen Buchungen – Lotse schlägt ${F.h(pr.total, 2)} aus deinem Plan vor.`, `Bookings are missing this week – Lotse proposes ${F.h(pr.total, 2)} from your plan.`), facts: [fact('total', pr.total)],
        options: [
          { id: 'all', label: P.t('Alle Vorschläge buchen', 'Book every proposal'), detail: P.t(`${pr.list.length} ${plural(pr.list.length, 'Buchung', 'Buchungen')}, zusammen ${F.h(pr.total, 2)}`, `${pr.list.length} ${plural(pr.list.length, 'booking', 'bookings')}, ${F.h(pr.total, 2)} in total`), facts: [fact('n', pr.list.length), fact('h', pr.total)], recommended: true },
          { id: 'today', label: P.t('Nur heute', 'Today only'), detail: P.t(`${todays.length} ${plural(todays.length, 'Buchung', 'Buchungen')}, ${F.h(tH, 2)}`, `${todays.length} ${plural(todays.length, 'booking', 'bookings')}, ${F.h(tH, 2)}`), facts: [fact('n', todays.length), fact('h', tH)], disabled: !todays.length },
          { id: 'skip', label: P.t('Selbst buchen', 'Book myself'), detail: P.t('Nichts wird gebucht.', 'Nothing is booked.') },
        ],
        proposals: pr.list.map((x) => ({ key: x.key, date: x.d, hours: x.h })),
      });
      if (a === undefined) return;
      const pick = optOf(a) === 'all' ? pr.list : optOf(a) === 'today' ? todays : [];
      if (pick.length) cmds.push({ id: 'cmd:book', command: 'booking.book', params: { items: pick.map((x) => ({ issue: x.issueId, date: x.d, hours: x.h })) }, title: P.t('Zeit buchen', 'Log time') });
    }
    if (can.remind(ctx)) {
      const below = teamBelow(ctx);
      const on = dsOf(ctx).config?.notices?.enabled === true;
      if (below.length) {
        const b = P.decide('remind', {
          question: P.t(`${below.length} ${plural(below.length, 'Person in deinem Team liegt', 'Personen in deinem Team liegen')} unter dem Buchungsziel – erinnern?`, `${below.length} ${plural(below.length, 'person in your team is', 'people in your team are')} below the booking target – remind?`), facts: [fact('n', below.length)],
          options: [
            { id: 'remind', label: P.t('Erinnerung senden', 'Send a reminder'), detail: on ? P.t('einmalig, als Jira-Benachrichtigung', 'once, as a Jira notification') : P.t('Erinnerungen sind in der Konfiguration ausgeschaltet.', 'Reminders are switched off in the configuration.'), disabled: !on, recommended: on },
            { id: 'no', label: P.t('Nicht erinnern', 'Do not remind'), recommended: !on },
          ],
        });
        if (b === undefined) return;
        if (optOf(b) === 'remind' && on) cmds.push({ id: 'cmd:remind', command: 'notice.remind', params: { kind: 'booking', people: below }, title: P.t('Erinnerung senden', 'Send a reminder') });
      }
    }
    if (!pr.list.length && !cmds.length) { P.summary(P.t('Deine Woche ist bis heute vollständig gebucht.', 'Your week is fully booked up to today.')); return; }
    P.batch('preview', cmds);
    P.summary(cmds.length ? null : P.t('Nichts gebucht.', 'Nothing booked.'));
  },
});

wf({
  id: 'healthRound', title: (L) => T(L, 'Health-Runde', 'Health round'), params: [],
  match: [/\bhealth-?runde\b|\bhealth round\b|\bstatus-?runde\b|\b(aktualisier\w*|update)\b.*\b(health|status)\b.*\b(alle[rn]?|all|meine[rn]?|my)\b.*\b(projekt\w*|projects?)\b|\b(update|aktualisier\w*)\b.*\b(alle[rn]?|all|meine[rn]?|my)\b.*\b(projekt\w*|projects?)\b.*\b(health|status)\b|\bhealth (updates? )?(for|fuer) (all|alle) (my |meine )?(projects|projekte)\b/],
  plan(P) {
    const { ctx, c, F } = P;
    let items = c.model.items.filter((it) => ownsProject(ctx, it.ref));
    if (!items.length && can.healthAny(ctx)) items = c.model.items;
    if (!items.length) { P.summary(P.t('Du bist bei keinem Projekt Owner – Health-Updates schreibt der Owner oder die freigegebene Gruppe.', 'You own no project – health updates are written by the owner or the enabled group.')); return; }
    const out = [];
    for (const it of items.slice(0, 12)) {
      const d = draftHealth(ctx, it, P.L, F);
      P.story(`story:${it.ref}`, 'healthDraft', { ref: it.ref });
      const a = P.decide(`health:${it.ref}`, {
        question: P.t(`Health für ${it.name}?`, `Health for ${it.name}?`), project: { ref: it.ref, name: it.name, current: it.health?.status || null },
        options: [...['onTrack', 'atRisk', 'critical'].map((s) => ({ id: s, label: healthName(s, P.L), detail: s === d.status ? P.t('Vorschlag aus den Zahlen', 'suggested by the numbers') : undefined, recommended: s === d.status })),
          { id: 'keep', label: P.t('Unverändert lassen', 'Leave unchanged') }],
        freeText: { kind: 'text', placeholder: d.comment, min: 1, max: 280, optional: true },
        draft: { status: d.status, comment: d.comment },
      });
      if (a === undefined) return;
      const s = optOf(a);
      if (s && s !== 'keep') out.push({ ref: it.ref, status: s, comment: (textOf(a) || d.comment).slice(0, 280) });
    }
    P.batch('preview', out.length ? [{ id: 'cmd:health', command: 'health.set', params: { items: out }, title: P.t('Health aktualisieren', 'Update health') }] : []);
    P.summary(out.length ? null : P.t('Alle Projekte unverändert.', 'Every project unchanged.'));
  },
});

wf({
  id: 'supportTriage', title: (L) => T(L, 'Support-Eingang verteilen', 'Triage the support inbox'), params: [],
  match: [/\btriage\b|\b(arbeite|abarbeiten)\b.*\b(support-?)?eingang\b|\b(support-?)?eingang\b.*\b(abarbeiten|leeren)\b|\bwork through the (inbox|tickets)\b|\bassign (the )?(new|incoming) tickets\b/],
  plan(P) {
    const { ctx } = P;
    P.story('story:inbox', 'dispatchAdvice', {});
    if (!(dsOf(ctx).supportTickets?.tickets || []).length) { P.summary(P.t('Es sind keine Support-Tickets geladen.', 'No support tickets are loaded.')); return; }
    const { rows, team, who, cal } = dispatchPlan(ctx);
    const items = rows.filter((r) => team.get(r.id)?.teamId).slice(0, 50).map((r) => ({ r, ticket: r.id, teamId: team.get(r.id).teamId, accountId: who.get(r.id) || null }));
    if (!items.length) { P.summary(P.t('Im Eingang wartet nichts mit einem Vorschlag.', 'Nothing with a suggestion is waiting in the inbox.')); return; }
    const urgent = items.filter((x) => x.r.sla?.status === 'breached' || isCritical(x.r) || isHighPriority(x.r.priority, cal));
    const a = P.decide('which', {
      question: P.t(`${items.length} ${plural(items.length, 'Ticket hat', 'Tickets haben')} einen Vorschlag für Team und Person – welche zuweisen?`, `${items.length} ${plural(items.length, 'ticket has', 'tickets have')} a suggested team and person – which to assign?`), facts: [fact('n', items.length)],
      options: [
        { id: 'all', label: P.t('Alle Vorschläge', 'Every suggestion'), detail: P.t(`${items.length} Tickets`, `${items.length} tickets`), facts: [fact('n', items.length)], recommended: true },
        { id: 'urgent', label: P.t('Nur dringende', 'Urgent only'), detail: P.t(`${urgent.length} mit gerissenem oder knappem SLA oder hoher Priorität`, `${urgent.length} with a breached or tight SLA or high priority`), facts: [fact('n', urgent.length)], disabled: !urgent.length },
        { id: 'skip', label: P.t('Selbst verteilen', 'Dispatch myself'), detail: P.t('Nichts wird zugewiesen.', 'Nothing is assigned.') },
      ],
    });
    if (a === undefined) return;
    const pick = optOf(a) === 'all' ? items : optOf(a) === 'urgent' ? urgent : [];
    P.batch('preview', pick.length ? [{ id: 'cmd:dispatch', command: 'dispatch.assign', params: { items: pick.map((x) => ({ ticket: x.ticket, teamId: x.teamId, ...(x.accountId ? { accountId: x.accountId } : {}) })) }, title: P.t('Tickets zuweisen', 'Assign tickets') }] : []);
    P.summary(pick.length ? null : P.t('Nichts zugewiesen.', 'Nothing assigned.'));
  },
});

wf({
  id: 'onboardProject', title: (L) => T(L, 'Projekt aufsetzen', 'Onboard a project'), params: ['project'],
  match: [/\bonboard\w*\b|\b(projekt|project)\b.*\b(aufsetzen|aufnehmen|einrichten|onboarden|startklar|set ?up)\b|\b(setze|richte|nimm)\b.*\b(auf|ein)\b.*\bprojekt\b|\b(setze|richte|nimm)\b.*\b(projekt|project)\b.*\b(auf|ein)$|\bset ?up (the |a |project )\b|\bnew project\b|\bneues projekt\b|\bkick-?off\b/],
  plan(P, { ref = null }) {
    const { ctx, c } = P;
    let r = ref && c.model.itemByRef.has(ref) ? ref : null;
    if (!r) {
      const cand = c.model.items.map((it) => ({ it, n: dataQuality(c.model, new Set([it.ref])).gaps.filter((g) => g.severity === 'gap').length })).sort((a, b) => b.n - a.n).slice(0, 5);
      const a = P.decide('project', { question: P.t('Welches Projekt soll Lotse aufsetzen?', 'Which project should Lotse set up?'), options: cand.map(({ it, n }, k) => ({ id: it.ref, label: it.name, detail: P.t(`${n} Datenlücken`, `${n} data gaps`), facts: [fact('n', n)], recommended: k === 0 })) });
      if (a === undefined) return;
      r = optOf(a);
    }
    const it = c.model.itemByRef.get(r);
    P.story('story:project', 'projectBrief', { ref: r });
    const gaps = gapItems(ctx, { ref: r });
    const dated = new Set(gaps.filter((x) => ['start', 'due'].includes(x.field)).map((x) => x.issue.id));
    const fixes = conflictFixes(ctx, { ref: r }).filter((x) => !dated.has(x.issueId));
    const moved = new Set([...dated, ...fixes.map((x) => x.issueId)]);
    const plan = optimizerPicks(ctx, { mode: 'smooth', project: r }).filter((s) => !moved.has(s.taskId));
    const d = draftHealth(ctx, it, P.L, P.F);
    const a = P.decide('setup', {
      question: P.t(`Was soll Lotse für ${it.name} einrichten?`, `What should Lotse set up for ${it.name}?`), multi: true,
      options: [
        { id: 'gaps', label: P.t('Fehlende Werte füllen', 'Fill missing values'), detail: P.t(`${gaps.length} ${plural(gaps.length, 'Wert', 'Werte')} mit Vorschlag`, `${gaps.length} ${plural(gaps.length, 'value', 'values')} with a suggestion`), facts: [fact('n', gaps.length)], recommended: gaps.length > 0, disabled: !gaps.length },
        { id: 'deps', label: P.t('Abhängigkeiten in Ordnung bringen', 'Fix dependencies'), detail: P.t(`${fixes.length} ${plural(fixes.length, 'Vorgang', 'Vorgänge')} hinter ${plural(fixes.length, 'seinen', 'ihre')} Vorgänger legen`, `move ${fixes.length} work ${plural(fixes.length, 'item', 'items')} behind ${plural(fixes.length, 'its', 'their')} prerequisite`), facts: [fact('n', fixes.length)], recommended: fixes.length > 0, disabled: !fixes.length },
        { id: 'plan', label: P.t('Plan glätten', 'Smooth the plan'), detail: P.t(`${plan.length} ${plural(plan.length, 'Vorschlag', 'Vorschläge')} gegen Überlast`, `${plan.length} ${plural(plan.length, 'suggestion', 'suggestions')} against overload`), facts: [fact('n', plan.length)], disabled: !plan.length },
        { id: 'health', label: P.t('Erstes Health-Update', 'First health update'), detail: P.t(`„${healthName(d.status, P.L)}“ aus den Zahlen`, `"${healthName(d.status, P.L)}" from the numbers`), recommended: !it.health, disabled: !can.health(ctx, r) },
      ],
    });
    if (a === undefined) return;
    const pick = new Set([].concat(a));
    const cmds = [];
    if (pick.has('gaps')) cmds.push(...fillCommands(ctx, gaps, 'cmd:gaps'));
    if (pick.has('deps') && fixes.length) cmds.push({ id: 'cmd:deps', command: 'plan.move', params: { moves: fixes.map((x) => ({ issue: x.issueId, start: x.start, due: x.due })) }, title: P.t('Abhängigkeiten in Ordnung bringen', 'Fix dependencies') });
    if (pick.has('plan') && plan.length) cmds.push({ id: 'cmd:plan', command: 'plan.applyOptimizer', params: { mode: 'smooth', project: r, ids: plan.map((s) => s.id) }, title: P.t('Plan glätten', 'Smooth the plan') });
    if (pick.has('health')) cmds.push({ id: 'cmd:health', command: 'health.set', params: { items: [{ ref: r, status: d.status, comment: d.comment.slice(0, 280) }] }, title: P.t('Erstes Health-Update', 'First health update') });
    P.batch('preview', cmds);
    P.summary(cmds.length ? null : P.t('Nichts geändert.', 'Nothing changed.'));
  },
});

wf({
  id: 'fixConflicts', title: (L) => T(L, 'Terminkonflikte lösen', 'Fix schedule conflicts'), params: ['project', 'team'],
  match: [/\b(loese|loes|loesen|beheb\w*|klaer\w*|fix|resolve|solve|repair|bereinig\w*)\b.*(konflikt\w*|\bconflicts?\b|abhaengigkeit\w*|\bdependenc\w*)|(konflikte|\bconflicts)\b.*\b(loesen|beheben|fix|resolve)\b/],
  plan(P, { ref = null, team = null }) {
    const { ctx } = P;
    P.story('story:blockers', 'blockers', ref ? { ref } : {});
    const fixes = conflictFixes(ctx, { ref, team });
    if (!fixes.length) { P.summary(P.t('Keine Terminkonflikte, die Lotse durch Verschieben lösen kann.', 'No schedule conflicts Lotse can fix by moving work.')); return; }
    const n = fixes.length;
    const a = P.decide('mode', {
      question: P.t(`${n} ${plural(n, 'Vorgang beginnt', 'Vorgänge beginnen')} vor dem Ende ${plural(n, 'seines', 'ihres')} Vorgängers – wie lösen?`, `${n} work ${plural(n, 'item starts', 'items start')} before ${plural(n, 'its', 'their')} prerequisite ends – how to fix?`), facts: [fact('n', n)],
      options: [
        { id: 'all', label: P.t('Alle hinter den Vorgänger legen', 'Move all behind the prerequisite'), detail: P.t(`${n} ${plural(n, 'Vorgang', 'Vorgänge')}, Dauer bleibt gleich`, `${n} work ${plural(n, 'item', 'items')}, duration kept`), facts: [fact('n', n)], recommended: true },
        { id: 'one', label: P.t('Einzeln entscheiden', 'Decide one by one'), detail: P.t(`die ersten ${Math.min(n, MAX_ONE_BY_ONE)}`, `the first ${Math.min(n, MAX_ONE_BY_ONE)}`), facts: [fact('n', Math.min(n, MAX_ONE_BY_ONE))] },
        { id: 'skip', label: P.t('So lassen', 'Leave as is'), detail: P.t('Nichts wird geändert.', 'Nothing is changed.') },
      ],
    });
    if (a === undefined) return;
    const mode = optOf(a);
    if (mode === 'skip') { P.summary(P.t('Nichts geändert.', 'Nothing changed.')); return; }
    let chosen = fixes;
    if (mode === 'one') {
      chosen = [];
      for (const x of fixes.slice(0, MAX_ONE_BY_ONE)) {
        const b = P.decide(`conflict:${x.issueId}`, {
          question: P.t(`${x.key} beginnt vor dem Ende von ${x.preKey} – um ${x.weeks} ${plural(x.weeks, 'Woche', 'Wochen')} später legen?`, `${x.key} starts before ${x.preKey} ends – move it ${x.weeks} ${plural(x.weeks, 'week', 'weeks')} later?`), facts: [fact('weeks', x.weeks)],
          options: [{ id: 'accept', label: P.t('Verschieben', 'Move'), recommended: true }, { id: 'skip', label: P.t('So lassen', 'Leave as is') }],
        });
        if (b === undefined) return;
        if (optOf(b) === 'accept') chosen.push(x);
      }
    }
    P.batch('preview', chosen.length ? [{ id: 'cmd:moves', command: 'plan.move', params: { moves: chosen.map((x) => ({ issue: x.issueId, start: x.start, due: x.due })) }, title: P.t('Vorgänge hinter ihre Vorgänger legen', 'Move work behind its prerequisites') }] : []);
    P.summary(chosen.length ? null : P.t('Nichts geändert.', 'Nothing changed.'));
  },
});

wf({
  id: 'cLevelReport', title: (L) => T(L, 'C-Level-Report', 'C-level report'), params: [],
  match: [/\b(c-?level-?report|management-?report|vorstandsbericht|board report|executive report)\b|\b(erstell\w*|bau\w*|bereite?|stelle?|prepare|build|compose|create|make|draft)\b.*\b(report|bericht)\b/],
  plan(P) {
    const { ctx } = P;
    if (!can.report(ctx)) { P.summary(P.t('Der C-Level-Report ist nur für die freigegebene Gruppe sichtbar.', 'The C-level report is visible to the enabled group only.')); return; }
    P.story('story:portfolio', 'portfolioBrief', {});
    const aud = P.decide('audience', {
      question: P.t('Für wen ist der Report?', 'Who is the report for?'),
      options: [{ id: 'board', label: P.t('Geschäftsführung / Vorstand', 'Board'), recommended: true }, { id: 'management', label: P.t('Bereichsleitung', 'Management') }, { id: 'teamLeads', label: P.t('Teamleitungen', 'Team leads') }],
    });
    if (aud === undefined) return;
    const A = optOf(aud);
    const hasSupport = !!(dsOf(ctx).supportComputed || dsOf(ctx).supportTickets?.tickets?.length);
    const rec = { board: ['portfolio', 'risks', 'milestones'], management: ['portfolio', 'waterline', 'risks', 'milestones'], teamLeads: ['waterline', 'support', 'planActual'] }[A];
    const NAMES = { portfolio: ['Portfolio-Lage', 'Portfolio status'], waterline: ['Kapazität und Wasserlinie', 'Capacity and waterline'], risks: ['Risiken und Blockaden', 'Risks and blockers'], support: ['Support', 'Support'], planActual: ['Plan vs. Ist', 'Plan vs. actual'], milestones: ['Meilensteine', 'Milestones'] };
    const sec = P.decide('sections', {
      question: P.t('Welche Abschnitte?', 'Which sections?'), multi: true,
      options: REPORT_OPTIONS.SECTIONS.map((s) => ({ id: s, label: NAMES[s][P.L === 'en' ? 1 : 0], recommended: rec.includes(s), disabled: s === 'support' && !hasSupport })),
    });
    if (sec === undefined) return;
    const per = P.decide('period', {
      question: P.t('Welcher Zeitraum?', 'Which period?'),
      options: [{ id: 'currentQuarter', label: P.t('Laufendes Quartal', 'Current quarter'), recommended: true }, { id: 'nextQuarter', label: P.t('Nächstes Quartal', 'Next quarter') }, { id: 'last4Weeks', label: P.t('Letzte 4 Wochen', 'Last 4 weeks'), facts: [fact('weeks', 4)] }],
    });
    if (per === undefined) return;
    const sections = [].concat(sec).filter((s) => REPORT_OPTIONS.SECTIONS.includes(s));
    P.batch('preview', sections.length ? [{ id: 'cmd:report', command: 'report.compose', params: { audience: A, sections, period: optOf(per) }, title: P.t('Report-Baukasten öffnen', 'Open the report composer') }] : []);
    P.summary(sections.length ? null : P.t('Kein Abschnitt gewählt – kein Report.', 'No section chosen – no report.'));
  },
});

// missions: longer jobs in their own files (missionsPlan.js, missionsKnowledge.js) – same planner, same state machine
// custom answer kinds (a decide step with `custom: kind` validates its answer with ANSWER_KINDS[kind](value, ctx, step))
const ANSWER_KINDS = {};
registerMissions(wf, { Planner, gapItems, conflictFixes, bookingProposals, fillCommands, optOf, textOf, MAX_ONE_BY_ONE, specOf: (id) => W[id] || null, answerKinds: ANSWER_KINDS });

export const WORKFLOWS = Object.freeze(Object.fromEntries(Object.values(W).map((x) => [x.id, Object.freeze({ id: x.id, title: x.title, params: x.params, match: x.match })])));
export const WORKFLOW_IDS = Object.freeze(Object.keys(W));

// ---------- the state machine ----------
const DONE = new Set(['seen', 'answered', 'applied', 'skipped', 'failed', 'done', 'undone']);
const normGoal = (goal) => (typeof goal === 'string' ? { id: goal, params: {} } : { id: goal?.id, params: { ...(goal?.params || {}) } });
function keep(state, ctx) { Object.defineProperty(state, 'ctx', { value: ctx, enumerable: false, writable: true, configurable: true }); return state; }
function clone(state, ctx) {
  const s = { ...state, answers: { ...state.answers }, steps: state.steps.map((x) => ({ ...x })), applied: [...state.applied] };
  return keep(s, ctx ? withC(ctx) : state.ctx);
}
export function planWorkflow(goal, ctx, answers = {}, prev = null) {
  const g = normGoal(goal);
  if (!W[g.id]) throw new ActError('UNKNOWN_WORKFLOW', String(g.id));
  const c = withC(ctx);
  const P = new Planner(c, answers, prev);
  const p = g.params;
  W[g.id].plan(P, { ...p, ref: p.ref ?? p.project ?? null });
  return { id: g.id, title: W[g.id].title(P.L), steps: P.steps };
}
export function current(state) {
  if (!state || state.status === 'cancelled') return null;
  return state.steps.find((x) => !DONE.has(x.status)) || null;
}
function summaryOf(state) {
  const L = state.lang;
  const cmds = state.steps.filter((x) => x.kind === 'command');
  const applied = cmds.filter((x) => x.status === 'applied');
  const changes = sum(applied, (x) => x.result?.applied || 0);
  const failed = cmds.filter((x) => x.status === 'failed').length + sum(applied, (x) => x.result?.failed || 0);
  const skipped = cmds.filter((x) => x.status === 'skipped').length;
  const writes = applied.filter((x) => COMMANDS[x.command]?.write);
  const irreversible = writes.some((x) => !x.undo);
  const text = !cmds.length ? null : !writes.length && applied.length
    ? (applied.some((x) => x.result?.open === 'jobDoc' || x.result?.open === 'chainDoc') ? T(L, 'Das Dokument ist erstellt – herunterladen, die persönlichen Texte kopieren und den Nachweis prüfen; Lotse hat nichts gesendet.', 'The document is ready – download it, copy the personal texts and check the proof; Lotse sent nothing.') : applied.some((x) => x.result?.open === 'reportComposer') ? T(L, 'Der Report-Baukasten öffnet sich mit deiner Auswahl – gespeichert oder veröffentlicht wird erst dort.', 'The report composer opens with your choice – nothing is saved or published before you do it there.') : T(L, 'Lotse öffnet die gewählte Ansicht.', 'Lotse opens the chosen view.'))
    : applied.length
      ? T(L, `${applied.length} von ${cmds.length} ${plural(cmds.length, 'Schritt', 'Schritten')} übernommen, ${changes} ${plural(changes, 'Änderung', 'Änderungen')}${failed ? `, ${failed} fehlgeschlagen` : ''}${irreversible ? ' – gesendete Erinnerungen lassen sich nicht zurückholen, der Rest mit „Alles rückgängig“.' : ' – alles mit „Alles rückgängig“ umkehrbar.'}`, `${applied.length} of ${cmds.length} ${plural(cmds.length, 'step', 'steps')} applied, ${changes} ${plural(changes, 'change', 'changes')}${failed ? `, ${failed} failed` : ''}${irreversible ? ' – sent reminders cannot be taken back, the rest with "Undo all".' : ' – all reversible with "Undo all".'}`)
      : T(L, 'Nichts übernommen.', 'Nothing applied.');
  return {
    text, facts: [fact('applied', applied.length), fact('steps', cmds.length), fact('changes', changes), fact('failed', failed)], applied: applied.length, skipped, failed, changes,
    lines: cmds.map((x) => ({ stepId: x.id, title: x.title, status: x.status, applied: x.result?.applied || 0, failed: x.result?.failed || 0, error: x.error?.code || null, reason: x.reason || null, open: x.result?.open || null })),
  };
}
function settle(s) {
  for (;;) {
    const cur = current(s);
    if (!cur) { if (s.status !== 'cancelled') s.status = 'done'; const sm = s.steps.find((x) => x.kind === 'summary'); if (sm) Object.assign(sm, summaryOf(s)); return s; }
    // a command never runs without a token from its preview
    if (cur.kind === 'command' && !cur.token) { cur.status = 'skipped'; cur.reason = cur.reason || 'notPreviewed'; continue; }
    if (cur.kind === 'summary') Object.assign(cur, summaryOf(s));
    s.status = cur.kind === 'decide' || cur.kind === 'preview' ? 'waiting' : cur.kind === 'command' ? 'ready' : 'running';
    return s;
  }
}
function replan(s) {
  const pl = planWorkflow(s.goal, s.ctx, s.answers, s.steps);
  const old = new Map(s.steps.map((x) => [x.id, x]));
  const keepOld = (o) => o && (o.status !== 'todo' || (o.kind === 'command' && o.token));
  // a kept step takes the plan's fresh `meta` (a chain's section marks); a step the plan already settled keeps its status
  const merged = pl.steps.map((x) => { const o = old.get(x.id); if (keepOld(o)) return x.meta && o.meta !== x.meta ? { ...o, meta: x.meta } : o; return { ...x, status: x.status || 'todo' }; });
  const ids = new Set(merged.map((x) => x.id));
  const lost = s.steps.filter((x) => !ids.has(x.id) && x.status !== 'todo');
  if (lost.length) { const k = merged.findIndex((x) => x.status === 'todo'); merged.splice(k < 0 ? merged.length : k, 0, ...lost); }
  s.steps = merged;
  s.title = pl.title;
  return settle(s);
}
export function start(goal, ctx) {
  const g = normGoal(goal);
  if (!W[g.id]) throw new ActError('UNKNOWN_WORKFLOW', String(g.id));
  const c = withC(ctx);
  const s = keep({ v: 1, id: `wf:${g.id}:${dsOf(c).today}`, goal: g, lang: langOf(c), title: W[g.id].title(langOf(c)), answers: {}, steps: [], applied: [], status: 'running' }, c);
  return replan(s);
}
// free text of a decide → its value (or throws INVALID)
function parseFree(kind, text, ctx, ft) {
  const t = String(text ?? '').trim();
  const { model } = computedOf(ctx);
  const bad = () => { throw new ActError('INVALID', 'free text does not fit', { field: 'text' }); };
  switch (kind) {
    case 'text': if (t.length < (ft.min ?? 1) || t.length > (ft.max ?? 280)) bad(); return t;
    case 'hours': { const m = /^(\d+(?:[.,]\d+)?)\s*(h|std|stunden|hours?)?$/i.exec(t); if (!m) bad(); return cleanValue(ctx, 'estimate', +m[1].replace(',', '.')); }
    case 'date': { const d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? dayIdx(t) : parseDay(fold(t), model.today); if (d == null) bad(); return isoOf(d); }
    case 'team': { const tm = [...model.teams.values()].find((x) => fold(x.name) === fold(t)); if (!tm) bad(); return tm.id; }
    case 'tshirt': return cleanValue(ctx, 'tshirt', t);
    case 'scope': { const v = scopeFromText(t, ctx); if (!v) bad(); return v; }
    case 'people': { const v = peopleFromText(t, ctx, ft.within || []); if (!v.length) bad(); return v; }
    case 'window': { const v = windowFromText(t, ctx); if (!v) bad(); return v; }
    case 'quarters': { const qs = [...fold(t).matchAll(/q([1-4])\s*\/?\s*(20\d\d)|(20\d\d)-?q([1-4])/g)].map((m) => (m[1] ? `${m[2]}-Q${m[1]}` : `${m[3]}-Q${m[4]}`)); if (!qs.length) bad(); return cleanValue(ctx, 'quarters', qs); }
    default: return bad();
  }
}
function validateAnswer(step, value, ctx) {
  const bad = (m) => { throw new ActError('INVALID', m, { field: 'answer' }); };
  if (step.kind === 'decide' && step.custom) { if (!ANSWER_KINDS[step.custom]) bad('unknown answer kind'); return ANSWER_KINDS[step.custom](value, ctx, step); }
  const opt = (id) => { const o = (step.options || []).find((x) => x.id === id); if (!o) bad(`unknown option ${id}`); if (o.disabled) bad(`option ${id} is not available`); return id; };
  if (step.kind === 'preview') { if (value !== 'apply' && value !== 'skip') bad('apply or skip'); return opt(value); }
  // a multiple choice with free text ("Anna, Jonas") – the text stands for the whole selection
  if (step.multi && step.freeText && value && typeof value === 'object' && !Array.isArray(value) && typeof value.text === 'string' && value.text.trim()) {
    return { option: null, text: value.text.trim(), value: parseFree(step.freeText.kind, value.text, ctx, step.freeText) };
  }
  if (step.multi) {
    const list = [].concat(value ?? []);
    if (!list.length) bad('choose at least one');
    list.forEach(opt);
    return list.includes('nothing') ? ['nothing'] : [...new Set(list)];
  }
  if (typeof value === 'string') return opt(value);
  if (value && typeof value === 'object') {
    const has = typeof value.text === 'string' && value.text.trim().length > 0;
    if (!step.freeText && !has) return opt(value.option);
    if (!step.freeText) bad('no free text here');
    const out = { option: value.option != null ? opt(value.option) : (step.options || []).find((o) => o.recommended && !o.disabled)?.id ?? null };
    if (has) { const v = parseFree(step.freeText.kind, value.text, ctx, step.freeText); out.text = value.text.trim(); if (step.freeText.kind !== 'text') { out.value = v; out.option = out.option === 'skip' ? 'accept' : out.option; } }
    else if (!step.freeText.optional) bad('text required');
    if (out.option == null) bad('choose an option');
    return out;
  }
  return bad('answer missing');
}
export function answer(state, stepId, value, ctx) {
  const s = clone(state, ctx);
  const cur = current(s);
  if (!cur || cur.id !== stepId || !(cur.kind === 'decide' || cur.kind === 'preview')) throw new ActError('NOT_READY', 'answer the current decision first');
  const v = validateAnswer(cur, value, s.ctx);
  s.answers[stepId] = v;
  cur.status = 'answered';
  cur.answer = v;
  if (cur.kind === 'preview') {
    for (const id of cur.covers) {
      const st = s.steps.find((x) => x.id === id);
      const item = cur.items.find((x) => x.stepId === id);
      if (v === 'apply' && item && !item.preview.blocked && (item.preview.token || !item.preview.write)) st.token = item.preview.token || 'read-only';
      else { st.status = 'skipped'; st.reason = v === 'skip' ? 'declined' : 'blocked'; }
    }
    return settle(s);
  }
  return replan(s);
}
export function next(state, ctx) {
  const s = clone(state, ctx);
  const cur = current(s);
  if (cur?.kind === 'story') cur.status = 'seen';
  else if (cur?.kind === 'summary') { Object.assign(cur, summaryOf(s)); cur.status = 'done'; }
  return settle(s);
}
export async function applyStep(state, io, ctx) {
  const s = clone(state, ctx);
  const cur = current(s);
  if (!cur || cur.kind !== 'command' || !cur.token) throw new ActError('NOT_READY', 'no command ready – answer the preview first');
  try {
    const d = await COMMANDS[cur.command].apply(cur.params, io, { ctx: s.ctx, token: cur.token === 'read-only' ? undefined : cur.token });
    cur.status = 'applied';
    cur.result = { applied: d.applied, failed: d.failed, errors: d.errors || [], ...(d.open ? { open: d.open, params: d.params } : {}), ...(d.navigate ? { navigate: d.navigate } : {}), ...(d.irreversible ? { irreversible: true } : {}) };
    cur.undo = d.run ? { label: d.label, keys: d.keys || [], run: d.run } : null;
    s.applied.push(cur.id);
  } catch (e) {
    cur.status = 'failed';
    cur.error = { code: e?.code || 'ERROR', message: String(e?.message || e).slice(0, 200) };
  }
  return settle(s);
}
// The same run planned again on fresh data (a chain's stale preview): answers and finished steps stay, open steps are
// computed anew – never a stale write.
export function refresh(state, ctx) {
  const s = clone(state, ctx);
  return replan(s);
}
export function cancel(state) {
  const s = clone(state);
  s.status = 'cancelled';
  for (const x of s.steps) if (!DONE.has(x.status)) x.status = 'cancelled';
  return s;
}
export async function undoAll(state, io) {
  const s = clone(state);
  for (const id of [...s.applied].reverse()) {
    const st = s.steps.find((x) => x.id === id);
    if (!st || st.status !== 'applied') continue;
    if (!st.undo) { st.undoNote = st.result?.irreversible ? 'irreversible' : 'nothing'; continue; }
    try { await st.undo.run(io); st.status = 'undone'; } catch (e) { st.undoError = { code: e?.code || 'ERROR', message: String(e?.message || e).slice(0, 200) }; s.undoFailed = true; break; }
  }
  s.applied = s.applied.filter((id) => s.steps.find((x) => x.id === id)?.status === 'applied');
  return s;
}
// Every number in a decide/preview text stands in its facts; every story step passes selfCheck (tests use this).
export function unsourced(state) {
  const out = [];
  // names may contain digits ("Mobile App 2.0") – they are not measured numbers
  const ds = state.ctx ? dsOf(state.ctx) : {};
  const names = [...(ds.portfolio || []).map((p) => p.name), ...(ds.teams || []).map((t) => t.name), ...Object.values(ds.people || {}).map((p) => p.name)].filter((n) => /\d/.test(n || '')).sort((a, b) => b.length - a.length);
  const strip = (t) => names.reduce((x, n) => x.split(n).join(' '), String(t || ''));
  for (const st of state.steps) {
    if (st.kind === 'decide' || st.kind === 'preview') {
      const facts = [...(st.facts || []), ...(st.options || []).flatMap((o) => o.facts || [])];
      for (const t of [st.question, st.summary]) for (const n of unsourcedNumbers(strip(t), facts)) out.push({ step: st.id, text: t, number: n });
      for (const o of st.options || []) for (const t of [o.label, o.detail]) for (const n of unsourcedNumbers(strip(t), [...(o.facts || []), ...(st.facts || [])])) out.push({ step: st.id, text: t, number: n });
    }
  }
  return out;
}
export { teamLabel, r1, issueOf };
