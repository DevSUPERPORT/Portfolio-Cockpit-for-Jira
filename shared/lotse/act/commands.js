// Lotse acts – the command registry. Every write Lotse can do for a person, each with a preview computed purely from
// the data the UI already has, a rights check that mirrors the server, and an exact undo.
//
//   COMMANDS[id] = { id, title(L), write, params (doc), validate(params, ctx) → clean params | throws INVALID,
//                    allowed(ctx, params) → null | reason, preview(ctx, params) → Preview,
//                    apply(params, io, { ctx, token }) → Promise<Done> }
//   Preview = { command, title, write, changes: [{ kind, key, ref, field, from, to, label, fromValue, toValue }] (≤ 40 shown),
//               count (all changes), more, totals, summary, warnings[], blocked: null | reason, token }
//   Done    = { label, run(io) → Promise (the undo) | null, irreversible?, keys[], applied, failed, errors[], result,
//               open?/navigate? (no-write commands) }
//
// Never a write without its preview: apply() recomputes the preview from the same ctx and refuses unless the token the UI
// got with the preview matches (PREVIEW_REQUIRED / STALE_PREVIEW) – a token covers the params AND the data they touch.
//
// io (injected by the UI; the tests pass a recorder):
//   io.call(resolver, payload) → Promise<result>         REQUIRED – the app's invoke()
//   io.fill?({ issueId, ref, usage, value, label, collectUndo: true }) → undo fn   state.fill (optimistic patch + exact undo)
//   io.reorder?(order, { silent: true }) → Promise        state.reorder (optimistic ranks)
//   io.patch?(kind, data)                                 optional local patch after a write ('health', 'plan', 'dispatch', …)
import { validAllocation, allocationOf } from '../../allocation.js';
import { atlIndex } from '../../atlTeams.js';
import { capacityPeople, computeAll } from '../../engine.js';
import { moveTask, planPayload, undoMoveOf, MAX_MOVES } from '../../weekPlan.js';
import { optimizeAll, OPT_MODES } from '../../optimize.js';
import { validDispatchItems, validReserve, DISPATCH_MAX } from '../../dispatch.js';
import { dayIdx } from '../../dates.js';
import { validPlaybook, canEditPlaybooks, PLAYBOOK_LIMITS } from '../../playbooks.js';
import { cleanJob } from './orchestrate/parse.js';
import { buildJobDoc } from '../report/jobDoc.js';
import { cleanChainDoc, buildChainDoc } from './chain/docs.js';
import {
  T, langOf, fmt, r1, r2, ActError, invalid, tokenOf, can, noAccess, meId, ownsProject, teamLabel, personLabel, projectLabel, issueOf,
  FIELDS, fieldName, cleanValue, valueText, cleanFilter, selectIssues, describeFilter, computedOf, dsOf, plural, healthName, validIso,
} from './kit.js';

export const MAX_SHOWN = 40;
export const MAX_BULK = 200;
const HEALTH = ['onTrack', 'atRisk', 'critical'];
const VIEWS = ['portfolio', 'project', 'team', 'plan', 'time', 'support', 'report', 'mine', 'capacity', 'config'];
const VIEW_NAME = { portfolio: ['Portfolio', 'Portfolio'], project: ['Projekt', 'Project'], team: ['Team', 'Team'], plan: ['Wochenplanung', 'Weekly planning'], time: ['Plan vs. Ist', 'Plan vs. actual'], support: ['Support', 'Support'], report: ['C-Level-Report', 'C-level report'], mine: ['Meine Arbeit', 'My work'], capacity: ['Kapazitäten', 'Capacity'], config: ['Konfiguration', 'Configuration'] };
const plain = (p) => p && typeof p === 'object' && !Array.isArray(p);
const lang = (ctx) => langOf(ctx);
const withC = (ctx) => (ctx.computed || !ctx.ds ? ctx : { ...ctx, computed: computeAll(ctx.ds) });

// ---------- shared write helpers (each returns its own undo) ----------
async function doFill(io, { issueId, ref, usage, value, label }) {
  const clear = value == null || (Array.isArray(value) && !value.length);
  if (typeof io.fill === 'function') {
    const u = await io.fill({ issueId, ref, usage, value: clear ? null : value, label, collectUndo: true });
    return async () => { if (typeof u === 'function') await u(); else if (u?.run) await u.run(); };
  }
  const target = ref ? { ref } : { issueId };
  const r = await io.call('issue.fill', clear ? { ...target, usage, clear: true } : { ...target, usage, value });
  const previous = r?.previous ?? null;
  return async (io2) => { await (io2 || io).call('issue.fill', { ...target, usage, restore: previous }); };
}
async function doPlan(io, moves) {
  const results = [];
  for (let k = 0; k < moves.length; k += MAX_MOVES) {
    const r = await io.call('plan.apply', { moves: moves.slice(k, k + MAX_MOVES) });
    results.push(...(r?.results || []));
  }
  io.patch?.('plan', { moves, results });
  const back = results.map(undoMoveOf).filter(Boolean);
  const failed = results.filter((x) => !x.ok);
  return {
    results, applied: results.filter((x) => x.ok).length, failed: failed.length,
    errors: failed.map((x) => ({ key: x.key || x.issueId, code: x.error?.code || 'ERROR' })),
    undo: back.length ? async (io2) => { const J = io2 || io; for (let k = 0; k < back.length; k += MAX_MOVES) await J.call('plan.apply', { moves: back.slice(k, k + MAX_MOVES), undo: true }); J.patch?.('plan', { moves: back, undo: true }); } : null,
  };
}
// run a list of steps one by one; each returns an undo fn; failures are counted, never stop the rest
async function each(list, fn) {
  const undos = [], errors = [];
  for (const x of list) {
    try { const u = await fn(x); if (u) undos.push(u); } catch (e) { errors.push({ key: x.key || x.ref || x.issueId || null, code: e?.code || 'ERROR', message: String(e?.message || e).slice(0, 200) }); }
  }
  return { undos, errors, applied: list.length - errors.length, failed: errors.length };
}
const undoAll = (undos) => (undos.length ? async (io) => { for (const u of [...undos].reverse()) await u(io); } : null);

// ---------- change rows ----------
function change(ctx, { kind, issue, ref, field, from, to, fromText, toText, label }) {
  const L = lang(ctx);
  const key = issue?.key || null;
  const f = fromText ?? (field && FIELDS[field] ? valueText(ctx, field, from) : String(from ?? T(L, 'leer', 'empty')));
  const t = toText ?? (field && FIELDS[field] ? valueText(ctx, field, to) : String(to ?? T(L, 'leer', 'empty')));
  const fname = field && FIELDS[field] ? fieldName(field, L) : field || '';
  return {
    kind, key, ref: ref || issue?.rootRef || null, id: issue?.id || null, field: fname, from: f, to: t, fromValue: from ?? null, toValue: to ?? null,
    label: label || `${key || projectLabel(ctx, ref) || ''}${fname ? ` · ${fname}` : ''}: ${f} → ${t}`.trim(),
  };
}

// ---------- the commands ----------
const C = {};
const def = (spec) => { C[spec.id] = spec; };

// rank.set { ref, toRank } – one project to a rank; every rank that shifts is listed
def({
  id: 'rank.set', write: true, title: (L) => T(L, 'Rang ändern', 'Change rank'), params: '{ ref, toRank }',
  validate(p, ctx) {
    if (!plain(p)) throw invalid('params');
    const { model } = computedOf(ctx);
    if (!model.itemByRef.has(p.ref)) throw invalid('ref');
    const n = Number(p.toRank);
    if (!Number.isInteger(n) || n < 1 || n > model.items.length) throw invalid('toRank');
    return { ref: p.ref, toRank: n };
  },
  allowed: (ctx) => (can.rank(ctx) ? null : noAccess(lang(ctx), ['Portfolio-Rang ändern', 'Change portfolio rank'])),
  plan(ctx, p) {
    const { model } = computedOf(ctx);
    const order = model.items.map((x) => x.ref).filter((r) => r !== p.ref);
    order.splice(p.toRank - 1, 0, p.ref);
    return rankPlan(ctx, order);
  },
  run: (p, io, ctx, pv) => runReorder(io, ctx, pv.data.order, pv.data.prev),
});
// rank.reorder { order: [refs] } – a whole new order (the quarterly re-ranking)
def({
  id: 'rank.reorder', write: true, title: (L) => T(L, 'Rangfolge neu setzen', 'Set a new ranking'), params: '{ order: ref[] }',
  validate(p, ctx) {
    if (!plain(p) || !Array.isArray(p.order)) throw invalid('order');
    const { model } = computedOf(ctx);
    const cur = model.items.map((x) => x.ref);
    if (p.order.length !== cur.length || new Set(p.order).size !== cur.length || !p.order.every((r) => model.itemByRef.has(r))) throw invalid('order', 'a permutation of every portfolio project');
    return { order: [...p.order] };
  },
  allowed: (ctx) => (can.rank(ctx) ? null : noAccess(lang(ctx), ['Portfolio-Rang ändern', 'Change portfolio rank'])),
  plan: (ctx, p) => rankPlan(ctx, p.order),
  run: (p, io, ctx, pv) => runReorder(io, ctx, pv.data.order, pv.data.prev),
});
function rankPlan(ctx, order) {
  const L = lang(ctx);
  const { model } = computedOf(ctx);
  const prev = model.items.map((x) => x.ref);
  const changes = order.map((ref, i) => ({ ref, from: model.itemByRef.get(ref).rank, to: i + 1 })).filter((x) => x.from !== x.to)
    .map((x) => change(ctx, { kind: 'rank', ref: x.ref, field: T(L, 'Rang', 'Rank'), from: x.from, to: x.to, label: T(L, `${projectLabel(ctx, x.ref)}: Rang ${x.from} → ${x.to}`, `${projectLabel(ctx, x.ref)}: rank ${x.from} → ${x.to}`) }));
  return {
    changes, data: { order, prev },
    summary: changes.length ? T(L, `${changes.length} ${plural(changes.length, 'Projekt wechselt', 'Projekte wechseln')} den Rang.`, `${changes.length} ${plural(changes.length, 'project changes', 'projects change')} rank.`) : T(L, 'Die Rangfolge bleibt wie sie ist.', 'The ranking stays as it is.'),
    blocked: changes.length ? null : T(L, 'Nichts zu ändern.', 'Nothing to change.'),
  };
}
async function runReorder(io, ctx, order, prev) {
  const L = lang(ctx);
  if (typeof io.reorder === 'function') await io.reorder(order, { silent: true }); else await io.call('portfolio.reorder', { order });
  return {
    applied: 1, failed: 0, errors: [], keys: ['order'], label: T(L, 'Rangfolge (Lotse)', 'Ranking (Lotse)'),
    run: async (io2) => { const J = io2 || io; if (typeof J.reorder === 'function') await J.reorder(prev, { silent: true }); else await J.call('portfolio.reorder', { order: prev }); },
  };
}

// issue.setField { issue: id|key, field, value } – one work item, one field (null clears)
def({
  id: 'issue.setField', write: true, title: (L) => T(L, 'Wert setzen', 'Set a value'), params: '{ issue: id|key, field: estimate|team|assignee|start|due|tshirt|quarters, value }',
  validate(p, ctx) {
    if (!plain(p)) throw invalid('params');
    const i = issueOf(ctx, p.issue ?? p.issueId ?? p.key);
    if (!i) throw invalid('issue', 'not in the loaded data');
    if (!FIELDS[p.field]) throw invalid('field');
    return { issue: i.id, field: p.field, value: cleanValue(ctx, p.field, p.value) };
  },
  allowed(ctx, p) { const i = issueOf(ctx, p.issue); return (p.field === 'assignee' ? can.plan(ctx) : can.edit(ctx, i)) ? null : noAccess(lang(ctx), ['Wochenplanung ändern', 'Change weekly planning']); },
  plan(ctx, p) {
    const L = lang(ctx);
    const i = issueOf(ctx, p.issue);
    const from = FIELDS[p.field].get(i);
    const same = JSON.stringify(from) === JSON.stringify(p.value);
    const changes = same ? [] : [change(ctx, { kind: p.value == null ? 'clear' : 'set', issue: i, field: p.field, from, to: p.value })];
    return { changes, summary: same ? T(L, `${i.key} hat diesen Wert schon.`, `${i.key} already has this value.`) : changes[0].label, blocked: same ? T(L, 'Nichts zu ändern.', 'Nothing to change.') : null, data: { items: [{ issue: i, value: p.value }] } };
  },
  run: (p, io, ctx, pv) => runFill(io, ctx, p.field, pv.data.items),
});
// issue.bulkFill { field, value?, items?: [{ issue, value }], filter?, onlyEmpty = true } – many work items at once
def({
  id: 'issue.bulkFill', write: true, title: (L) => T(L, 'Werte gesammelt setzen', 'Set values in bulk'), params: '{ field, value? , items?: [{ issue, value }], filter?, onlyEmpty?: true }',
  validate(p, ctx) {
    if (!plain(p) || !FIELDS[p.field]) throw invalid('field');
    const out = { field: p.field, onlyEmpty: p.onlyEmpty !== false };
    if (Array.isArray(p.items)) {
      if (!p.items.length || p.items.length > MAX_BULK) throw invalid('items', `1–${MAX_BULK}`);
      const seen = new Set();
      out.items = p.items.map((x) => {
        const i = issueOf(ctx, x?.issue ?? x?.issueId ?? x?.key);
        if (!i || seen.has(i.id)) throw invalid('items', 'unknown or duplicate work item');
        seen.add(i.id);
        return { issue: i.id, value: cleanValue(ctx, p.field, x.value) };
      });
      return out;
    }
    out.filter = cleanFilter(ctx, p.filter);
    if (!out.filter) throw invalid('filter', 'items or filter required');
    out.value = cleanValue(ctx, p.field, p.value);
    if (out.value == null) throw invalid('value', 'bulk clearing is not offered');
    return out;
  },
  allowed(ctx, p) {
    if (p.field === 'assignee' && !can.plan(ctx)) return noAccess(lang(ctx), ['Wochenplanung ändern', 'Change weekly planning']);
    const items = bulkTargets(ctx, p);
    const bad = items.find((x) => !can.edit(ctx, x.issue));
    return bad ? T(lang(ctx), `Für ${bad.issue.key} fehlt dir das Recht, Werte zu ändern.`, `You may not change values of ${bad.issue.key}.`) : null;
  },
  plan(ctx, p) {
    const L = lang(ctx), F = fmt(ctx);
    const all = bulkTargets(ctx, p);
    const items = all.filter((x) => JSON.stringify(FIELDS[p.field].get(x.issue)) !== JSON.stringify(x.value) && (!p.onlyEmpty || p.items || FIELDS[p.field].get(x.issue) == null));
    const changes = items.map((x) => change(ctx, { kind: 'set', issue: x.issue, field: p.field, from: FIELDS[p.field].get(x.issue), to: x.value }));
    const hours = FIELDS[p.field].kind === 'hours' ? r1(items.reduce((a, x) => a + (x.value || 0), 0)) : null;
    const scope = p.filter ? describeFilter(ctx, p.filter) : T(L, `${items.length} ausgewählte Vorgänge`, `${items.length} selected work items`);
    const warnings = [];
    if (items.length > 25) warnings.push(T(L, `${items.length} Vorgänge auf einmal – jeder einzeln rückgängig.`, `${items.length} work items at once – each one undoable.`));
    if (p.filter && all.length > items.length) warnings.push(T(L, `${all.length - items.length} passende Vorgänge haben schon einen Wert und bleiben unverändert.`, `${all.length - items.length} matching work items already have a value and stay unchanged.`));
    return {
      changes, data: { items }, totals: { items: items.length, ...(hours != null ? { hours } : {}) }, warnings,
      summary: items.length ? T(L, `${fieldName(p.field, L)} für ${items.length} ${plural(items.length, 'Vorgang', 'Vorgänge')} (${scope})${hours != null ? `, zusammen ${F.h(hours, 1)}` : ''}.`, `${fieldName(p.field, L)} for ${items.length} work ${plural(items.length, 'item', 'items')} (${scope})${hours != null ? `, ${F.h(hours, 1)} in total` : ''}.`) : T(L, `Keine passenden Vorgänge (${scope}).`, `No matching work items (${scope}).`),
      blocked: items.length ? null : T(L, 'Nichts zu ändern.', 'Nothing to change.'),
    };
  },
  run: (p, io, ctx, pv) => runFill(io, ctx, p.field, pv.data.items),
});
function bulkTargets(ctx, p) {
  if (p.items) return p.items.map((x) => ({ issue: issueOf(ctx, x.issue), value: x.value }));
  return selectIssues(ctx, p.filter).slice(0, MAX_BULK).map((i) => ({ issue: i, value: p.value }));
}
async function runFill(io, ctx, field, items) {
  const L = lang(ctx);
  const label = T(L, `${fieldName(field, L)} (Lotse)`, `${fieldName(field, L)} (Lotse)`);
  if (field === 'assignee') {
    const moves = items.map((x) => ({ issueId: x.issue.id, assignee: x.value }));
    const r = await doPlan(io, moves);
    return { ...r, keys: items.map((x) => `move:${x.issue.id}`), label, run: r.undo, result: r.results };
  }
  const usage = FIELDS[field].usage;
  const r = await each(items.map((x) => ({ ...x, key: x.issue.key })), (x) => doFill(io, { issueId: x.issue.id, usage, value: x.value, label: `${x.issue.key}: ${label}` }));
  return { applied: r.applied, failed: r.failed, errors: r.errors, keys: items.map((x) => `fill:${x.issue.id}:${usage}`), label, run: undoAll(r.undos) };
}

// plan.move { moves: [{ issue, weeks?, start?, due?, assignee?, team? }] } | { filter, weeks?, assignee? } → plan.apply
// team (2026-11-17): the work item's Team field moves along – e.g. handed to someone of another team
def({
  id: 'plan.move', write: true, title: (L) => T(L, 'Vorgänge verschieben', 'Move work items'), params: '{ moves: [{ issue, weeks?, start?, due?, assignee?, team? }] } | { filter, weeks?, assignee? }',
  validate(p, ctx) {
    if (!plain(p)) throw invalid('params');
    const opt = (x) => {
      const o = {};
      if (x.weeks != null) { const w = Number(x.weeks); if (!Number.isInteger(w) || w === 0 || Math.abs(w) > 52) throw invalid('weeks', '±1–52 whole weeks'); o.weeks = w; }
      if (x.start !== undefined) { if (x.start !== null && !validIso(x.start)) throw invalid('start'); o.start = x.start; }
      if (x.due !== undefined) { if (x.due !== null && !validIso(x.due)) throw invalid('due'); o.due = x.due; }
      if (x.assignee !== undefined) { if (x.assignee !== null && !dsOf(ctx).people?.[x.assignee]) throw invalid('assignee'); o.assignee = x.assignee; }
      if (x.team !== undefined) { if (x.team !== null && !(dsOf(ctx).teams || []).some((t) => t.id === x.team)) throw invalid('team'); o.team = x.team; }
      if (!Object.keys(o).length) throw invalid('move', 'nothing to change');
      return o;
    };
    if (Array.isArray(p.moves)) {
      if (!p.moves.length || p.moves.length > MAX_BULK) throw invalid('moves', `1–${MAX_BULK}`);
      const seen = new Set();
      return { moves: p.moves.map((m) => { const i = issueOf(ctx, m?.issue ?? m?.issueId ?? m?.key); if (!i || seen.has(i.id)) throw invalid('moves', 'unknown or duplicate work item'); seen.add(i.id); return { issue: i.id, ...opt(m) }; }) };
    }
    return { filter: cleanFilter(ctx, p.filter) || (() => { throw invalid('filter'); })(), ...opt(p) };
  },
  allowed: (ctx) => (can.plan(ctx) ? null : noAccess(lang(ctx), ['Wochenplanung ändern', 'Change weekly planning'])),
  plan(ctx, p) {
    const list = p.moves ? p.moves.map((m) => ({ issue: issueOf(ctx, m.issue), o: m })) : selectIssues(ctx, p.filter).slice(0, MAX_BULK).map((i) => ({ issue: i, o: p }));
    let moves = {};
    for (const { issue, o } of list) {
      const { issue: _drop, ...opts } = o;
      if (opts.assignee !== undefined) opts.assigneeName = personLabel(ctx, opts.assignee);
      moves = moveTask(moves, issue, { weeks: opts.weeks || 0, ...(opts.start !== undefined ? { start: opts.start } : {}), ...(opts.due !== undefined ? { due: opts.due } : {}), ...(opts.assignee !== undefined ? { assignee: opts.assignee, assigneeName: opts.assigneeName } : {}), ...(opts.team !== undefined ? { team: opts.team, teamName: teamLabel(ctx, opts.team) } : {}) });
    }
    return movesPlan(ctx, moves, p.filter ? describeFilter(ctx, p.filter) : null, list.filter((x) => !x.issue.start && !x.issue.due && x.o.weeks).length);
  },
  run: (p, io, ctx, pv) => runMoves(io, ctx, pv.data.payload),
});
// plan.applyOptimizer { mode: smooth|rebalance|sooner, team?, project?, ids?: [suggestion ids], kind?: 'stretch'|'shift', person? }
def({
  id: 'plan.applyOptimizer', write: true, title: (L) => T(L, 'Planungsvorschläge übernehmen', 'Apply planning suggestions'), params: '{ mode, team?, project?, ids?, kind?, person? }',
  validate(p, ctx) {
    if (!plain(p) || !OPT_MODES.includes(p.mode)) throw invalid('mode');
    const { model } = computedOf(ctx);
    const out = { mode: p.mode };
    if (p.team != null) { if (!model.teams.has(p.team)) throw invalid('team'); out.team = p.team; }
    if (p.project != null) { if (!model.itemByRef.has(p.project)) throw invalid('project'); out.project = p.project; }
    if (p.kind != null) { if (!['stretch', 'shift'].includes(p.kind)) throw invalid('kind'); out.kind = p.kind; }
    if (p.person != null) { if (!dsOf(ctx).people?.[p.person]) throw invalid('person'); out.person = p.person; }
    if (p.ids != null) { if (!Array.isArray(p.ids) || !p.ids.length || p.ids.length > MAX_BULK || !p.ids.every((x) => typeof x === 'string')) throw invalid('ids'); out.ids = [...p.ids]; }
    return out;
  },
  allowed: (ctx) => (can.plan(ctx) ? null : noAccess(lang(ctx), ['Wochenplanung ändern', 'Change weekly planning'])),
  plan(ctx, p) {
    const L = lang(ctx);
    const picked = optimizerPicks(ctx, p);
    const ds = dsOf(ctx);
    const byId = new Map((ds.issues || []).map((i) => [i.id, i]));
    let moves = {};
    for (const s of picked) { const i = byId.get(s.taskId); if (i) moves = moveTask(moves, i, s.move || { due: s.newDue }); }
    const pl = movesPlan(ctx, moves, null, 0);
    const missing = p.ids ? p.ids.filter((id) => !picked.some((s) => s.id === id)).length : 0;
    if (missing) pl.warnings.push(T(L, `${missing} ${plural(missing, 'Vorschlag gilt', 'Vorschläge gelten')} mit den aktuellen Daten nicht mehr.`, `${missing} ${plural(missing, 'suggestion no longer applies', 'suggestions no longer apply')} to the current data.`));
    pl.data.suggestions = picked.map((s) => s.id);
    return pl;
  },
  run: (p, io, ctx, pv) => runMoves(io, ctx, pv.data.payload),
});
export function optimizerPicks(ctx, p) {
  const c = computedOf(ctx);
  const all = optimizeAll({ ds: dsOf(ctx), computed: c, team: p.team || null, project: p.project || null, target: 1 });
  let list = all[p.mode]?.suggestions || [];
  if (p.kind) list = list.filter((s) => s.kind === p.kind);
  if (p.person) list = list.filter((s) => s.personId === p.person);
  if (p.ids) list = list.filter((s) => p.ids.includes(s.id));
  const seen = new Set();
  return list.filter((s) => (seen.has(s.taskId) ? false : seen.add(s.taskId)));
}
function movesPlan(ctx, moves, scope, undated) {
  const L = lang(ctx);
  const payload = planPayload(moves);
  const changes = [];
  for (const m of payload) {
    const i = issueOf(ctx, m.issueId);
    const mv = moves[m.issueId];
    if ('start' in m) changes.push(change(ctx, { kind: 'move', issue: i, field: 'start', from: mv.orig.start, to: m.start }));
    if ('due' in m) changes.push(change(ctx, { kind: 'move', issue: i, field: 'due', from: mv.orig.due, to: m.due }));
    if ('assignee' in m) changes.push(change(ctx, { kind: 'assign', issue: i, field: 'assignee', from: mv.orig.assignee, to: m.assignee }));
    if ('team' in m) changes.push(change(ctx, { kind: 'set', issue: i, field: 'team', from: mv.orig.team ?? null, to: m.team }));
  }
  const warnings = [];
  if (undated) warnings.push(T(L, `${undated} ${plural(undated, 'Vorgang hat', 'Vorgänge haben')} keine Termine und ${plural(undated, 'bleibt', 'bleiben')} unverändert.`, `${undated} work ${plural(undated, 'item has', 'items have')} no dates and ${plural(undated, 'stays', 'stay')} unchanged.`));
  return {
    changes, data: { payload }, totals: { items: payload.length }, warnings,
    summary: payload.length ? T(L, `${payload.length} ${plural(payload.length, 'Vorgang wird', 'Vorgänge werden')} in Jira geändert${scope ? ` (${scope})` : ''}.`, `${payload.length} work ${plural(payload.length, 'item is', 'items are')} changed in Jira${scope ? ` (${scope})` : ''}.`) : T(L, 'Nichts zu verschieben.', 'Nothing to move.'),
    blocked: payload.length ? null : T(L, 'Nichts zu ändern.', 'Nothing to change.'),
  };
}
async function runMoves(io, ctx, payload) {
  const L = lang(ctx);
  const r = await doPlan(io, payload);
  return { applied: r.applied, failed: r.failed, errors: r.errors, result: r.results, keys: payload.map((m) => `move:${m.issueId}`), label: T(L, 'Planänderung (Lotse)', 'Plan change (Lotse)'), run: r.undo };
}

// health.set { items: [{ ref, status, comment }] } | { ref, status, comment }
def({
  id: 'health.set', write: true, title: (L) => T(L, 'Health aktualisieren', 'Update health'), params: '{ items: [{ ref, status: onTrack|atRisk|critical, comment (1–280) }] }',
  validate(p, ctx) {
    if (!plain(p)) throw invalid('params');
    const raw = Array.isArray(p.items) ? p.items : [p];
    if (!raw.length || raw.length > 100) throw invalid('items');
    const { model } = computedOf(ctx);
    const seen = new Set();
    return { items: raw.map((x) => {
      if (!plain(x) || !model.itemByRef.has(x.ref) || seen.has(x.ref)) throw invalid('ref');
      seen.add(x.ref);
      if (!HEALTH.includes(x.status)) throw invalid('status');
      const comment = typeof x.comment === 'string' ? x.comment.trim() : '';
      if (comment.length < 1 || comment.length > 280) throw invalid('comment', '1–280 characters');
      return { ref: x.ref, status: x.status, comment };
    }) };
  },
  allowed(ctx, p) { const bad = p.items.find((x) => !can.health(ctx, x.ref)); return bad ? T(lang(ctx), `Health von ${projectLabel(ctx, bad.ref)} darf nur der Owner oder die freigegebene Gruppe ändern.`, `Only the owner or the enabled group may update the health of ${projectLabel(ctx, bad.ref)}.`) : null; },
  plan(ctx, p) {
    const L = lang(ctx);
    const { model } = computedOf(ctx);
    const changes = p.items.map((x) => {
      const it = model.itemByRef.get(x.ref);
      return change(ctx, { kind: 'health', ref: x.ref, field: 'Health', from: it.health?.status || null, to: x.status, fromText: healthName(it.health?.status, L), toText: `${healthName(x.status, L)} – „${x.comment}“`,
        label: T(L, `${it.name}: ${healthName(it.health?.status, L)} → ${healthName(x.status, L)} – „${x.comment}“`, `${it.name}: ${healthName(it.health?.status, L)} → ${healthName(x.status, L)} – "${x.comment}"`) });
    });
    return { changes, totals: { items: changes.length }, summary: T(L, `Health-Update für ${changes.length} ${plural(changes.length, 'Projekt', 'Projekte')}.`, `Health update for ${changes.length} ${plural(changes.length, 'project', 'projects')}.`) };
  },
  async run(p, io, ctx) {
    const L = lang(ctx);
    const r = await each(p.items.map((x) => ({ ...x, key: projectLabel(ctx, x.ref) })), async (x) => {
      const h = await io.call('health.set', { ref: x.ref, status: x.status, comment: x.comment });
      io.patch?.('health', { ref: x.ref, health: h });
      return async (io2) => { const J = io2 || io; const back = await J.call('health.set', { ref: x.ref, restore: true }); J.patch?.('health', { ref: x.ref, health: back || null }); };
    });
    return { applied: r.applied, failed: r.failed, errors: r.errors, keys: p.items.map((x) => `health:${x.ref}`), label: T(L, 'Health-Update (Lotse)', 'Health update (Lotse)'), run: undoAll(r.undos) };
  },
});

// dispatch.assign { items: [{ issueId|key, teamId?, accountId? }] } → support.dispatch
def({
  id: 'dispatch.assign', write: true, title: (L) => T(L, 'Tickets zuweisen', 'Assign tickets'), params: '{ items: [{ ticket: id|key, teamId?, accountId? }] }',
  validate(p, ctx) {
    if (!plain(p) || !Array.isArray(p.items)) throw invalid('items');
    const tickets = dsOf(ctx).supportTickets?.tickets || [];
    const items = p.items.map((x) => { const t = tickets.find((y) => y.id === String(x?.ticket ?? x?.issueId) || y.key === String(x?.ticket ?? x?.key ?? '').toUpperCase()); if (!t) throw invalid('items', 'unknown ticket'); return { issueId: t.id, teamId: x.teamId ?? null, accountId: x.accountId ?? null }; });
    let clean;
    try { clean = validDispatchItems(items); } catch (e) { throw invalid('items', e.message); }
    const { model } = computedOf(ctx);
    for (const x of clean) { if (x.teamId && !model.teams.has(x.teamId)) throw invalid('teamId'); if (x.accountId && !dsOf(ctx).people?.[x.accountId]) throw invalid('accountId'); }
    return { items: clean };
  },
  allowed: (ctx) => (can.dispatch(ctx) ? null : noAccess(lang(ctx), ['Support-Tickets verteilen', 'Dispatch support tickets'])),
  plan(ctx, p) {
    const L = lang(ctx);
    const tickets = dsOf(ctx).supportTickets?.tickets || [];
    const changes = [];
    for (const x of p.items) {
      const t = tickets.find((y) => y.id === x.issueId);
      if (x.teamId && x.teamId !== t.team?.id) changes.push(change(ctx, { kind: 'assign', issue: t, field: 'team', from: t.team?.id || null, to: x.teamId }));
      if (x.accountId && x.accountId !== t.assignee?.id) changes.push(change(ctx, { kind: 'assign', issue: t, field: 'assignee', from: t.assignee?.id || null, to: x.accountId }));
    }
    const n = p.items.length;
    return { changes, totals: { items: n }, summary: T(L, `${n} ${plural(n, 'Ticket wird', 'Tickets werden')} zugewiesen.`, `${n} ${plural(n, 'ticket is', 'tickets are')} assigned.`), blocked: changes.length ? null : T(L, 'Alle Tickets sind schon so zugewiesen.', 'Every ticket is already assigned like this.') };
  },
  async run(p, io, ctx) {
    const L = lang(ctx);
    const results = [];
    for (let k = 0; k < p.items.length; k += DISPATCH_MAX) results.push(...((await io.call('support.dispatch', { items: p.items.slice(k, k + DISPATCH_MAX) }))?.results || []));
    io.patch?.('dispatch', { results });
    const back = results.filter((r) => r.ok && r.before).map((r) => ({ issueId: r.issueId, accountId: r.before.accountId ?? null, teamId: r.before.teamId ?? null, statusId: r.before.statusId ?? null }));
    const failed = results.filter((r) => !r.ok);
    return {
      applied: results.length - failed.length, failed: failed.length, errors: failed.map((r) => ({ key: r.issueId, code: r.error?.code || 'ERROR' })), result: results,
      keys: p.items.map((x) => `dispatch:${x.issueId}`), label: T(L, 'Tickets zugewiesen (Lotse)', 'Tickets assigned (Lotse)'),
      run: back.length ? async (io2) => { const J = io2 || io; for (let k = 0; k < back.length; k += DISPATCH_MAX) await J.call('support.undoDispatch', { items: back.slice(k, k + DISPATCH_MAX) }); J.patch?.('dispatch', { undo: true, items: back }); } : null,
    };
  },
});

// support.reserve { teamId, hours: 0–80 | null (automatic) }
def({
  id: 'support.reserve', write: true, title: (L) => T(L, 'Support-Reserve setzen', 'Set the support reserve'), params: '{ teamId, hours: number | null }',
  validate(p, ctx) {
    let v;
    try { v = validReserve(p); } catch (e) { throw invalid('reserve', e.message); }
    if (!computedOf(ctx).model.teams.has(v.teamId)) throw invalid('teamId');
    return v;
  },
  allowed: (ctx) => (can.capacity(ctx) ? null : noAccess(lang(ctx), ['Kapazitäten pflegen', 'Maintain capacities'])),
  plan(ctx, p) {
    const L = lang(ctx), F = fmt(ctx);
    const cur = dsOf(ctx).capacity?.teams?.[p.teamId]?.supportOverride ?? null;
    const measured = (computedOf(ctx).support?.teams || []).find((t) => t.teamId === p.teamId)?.weekly ?? null;
    const txt = (h) => (h == null ? T(L, `automatisch${measured != null ? ` (Ø ${F.h(measured, 1)})` : ''}`, `automatic${measured != null ? ` (avg ${F.h(measured, 1)})` : ''}`) : T(L, `${F.h(h, 1)} je Woche`, `${F.h(h, 1)} per week`));
    const same = cur === p.hours;
    const changes = same ? [] : [change(ctx, { kind: 'reserve', ref: `team:${p.teamId}`, field: T(L, 'Support-Reserve', 'Support reserve'), from: cur, to: p.hours, fromText: txt(cur), toText: txt(p.hours), label: T(L, `Team ${teamLabel(ctx, p.teamId)}: Support-Reserve ${txt(cur)} → ${txt(p.hours)}`, `Team ${teamLabel(ctx, p.teamId)}: support reserve ${txt(cur)} → ${txt(p.hours)}`) })];
    return { changes, summary: same ? T(L, 'Die Reserve ist schon so eingestellt.', 'The reserve is already set like this.') : changes[0].label, blocked: same ? T(L, 'Nichts zu ändern.', 'Nothing to change.') : null };
  },
  async run(p, io, ctx) {
    const L = lang(ctx);
    const r = await io.call('support.reserve', { teamId: p.teamId, hours: p.hours, teamName: teamLabel(ctx, p.teamId) || undefined });
    io.patch?.('reserve', r);
    const previous = r?.previous ?? null;
    return { applied: 1, failed: 0, errors: [], result: r, keys: [`reserve:${p.teamId}`], label: T(L, 'Support-Reserve (Lotse)', 'Support reserve (Lotse)'), run: async (io2) => { const J = io2 || io; const res = await J.call('support.reserve', { teamId: p.teamId, hours: previous }); J.patch?.('reserve', res); } };
  },
});

// deps.link { pre: id|key, dep: id|key } – "pre blocks dep"; deps.unlink { pre, dep }
const depTypes = (ctx) => (dsOf(ctx).config?.dependencies?.linkTypeIds || []).map(String);
function linkBetween(ctx, pre, dep) {
  const types = depTypes(ctx);
  return (pre.links || []).find((l) => types.includes(String(l.typeId)) && l.otherId === dep.id && l.outward) || null;
}
function anyLink(ctx, a, b) { const types = depTypes(ctx); return (a.links || []).some((l) => types.includes(String(l.typeId)) && l.otherId === b.id); }
const depParams = (p, ctx) => {
  if (!plain(p)) throw invalid('params');
  const pre = issueOf(ctx, p.pre ?? p.preId), dep = issueOf(ctx, p.dep ?? p.depId);
  if (!pre || !dep || pre.id === dep.id) throw invalid('pre/dep');
  return { pre: pre.id, dep: dep.id };
};
const depAllowed = (ctx, p) => (can.plan(ctx) || ownsProject(ctx, issueOf(ctx, p.pre)?.rootRef) || ownsProject(ctx, issueOf(ctx, p.dep)?.rootRef) ? null : noAccess(lang(ctx), ['Wochenplanung ändern', 'Change weekly planning']));
def({
  id: 'deps.link', write: true, title: (L) => T(L, 'Abhängigkeit anlegen', 'Add a dependency'), params: '{ pre: id|key, dep: id|key }', validate: depParams, allowed: depAllowed,
  plan(ctx, p) {
    const L = lang(ctx), F = fmt(ctx);
    const pre = issueOf(ctx, p.pre), dep = issueOf(ctx, p.dep);
    const warnings = [];
    let blocked = null;
    if (!depTypes(ctx).length) blocked = T(L, 'In der Konfiguration ist kein Verknüpfungstyp für Abhängigkeiten gewählt.', 'No link type for dependencies is configured.');
    else if (linkBetween(ctx, pre, dep)) blocked = T(L, `${pre.key} blockiert ${dep.key} schon.`, `${pre.key} already blocks ${dep.key}.`);
    else if (anyLink(ctx, pre, dep)) blocked = T(L, `Es gibt schon die umgekehrte Abhängigkeit zwischen ${pre.key} und ${dep.key}.`, `The opposite dependency between ${pre.key} and ${dep.key} already exists.`);
    if (pre.due && dep.start && dayIdx(pre.due) > dayIdx(dep.start)) warnings.push(T(L, `Terminkonflikt: ${pre.key} endet am ${F.date(pre.due)}, ${dep.key} beginnt schon am ${F.date(dep.start)}.`, `Schedule conflict: ${pre.key} ends on ${F.date(pre.due)}, ${dep.key} already starts on ${F.date(dep.start)}.`).replace(/\.\.$/, '.'));
    const label = T(L, `${pre.key} blockiert ${dep.key}`, `${pre.key} blocks ${dep.key}`);
    return { changes: blocked ? [] : [change(ctx, { kind: 'link', issue: dep, field: T(L, 'Abhängigkeit', 'Dependency'), from: null, to: pre.key, fromText: T(L, 'keine', 'none'), toText: label, label })], summary: label, warnings, blocked };
  },
  async run(p, io, ctx) {
    const L = lang(ctx);
    const r = await io.call('deps.link', { preId: p.pre, depId: p.dep });
    io.patch?.('deps', { link: r?.link, preId: p.pre, depId: p.dep });
    const linkId = r?.link?.id;
    return { applied: 1, failed: 0, errors: [], result: r, keys: [`dep:${p.pre}:${p.dep}`], label: T(L, 'Abhängigkeit (Lotse)', 'Dependency (Lotse)'),
      run: r?.existed || !linkId ? null : async (io2) => { const J = io2 || io; await J.call('deps.unlink', { linkId: String(linkId), preId: p.pre, depId: p.dep }); J.patch?.('deps', { unlink: linkId }); } };
  },
});
def({
  id: 'deps.unlink', write: true, title: (L) => T(L, 'Abhängigkeit entfernen', 'Remove a dependency'), params: '{ pre: id|key, dep: id|key }', validate: depParams, allowed: depAllowed,
  plan(ctx, p) {
    const L = lang(ctx);
    const pre = issueOf(ctx, p.pre), dep = issueOf(ctx, p.dep);
    const l = linkBetween(ctx, pre, dep);
    const label = T(L, `${pre.key} blockiert ${dep.key} nicht mehr`, `${pre.key} no longer blocks ${dep.key}`);
    return { changes: l ? [change(ctx, { kind: 'unlink', issue: dep, field: T(L, 'Abhängigkeit', 'Dependency'), from: pre.key, to: null, fromText: T(L, `${pre.key} blockiert ${dep.key}`, `${pre.key} blocks ${dep.key}`), toText: T(L, 'keine', 'none'), label })] : [], data: { linkId: l?.id || null },
      summary: label, blocked: l ? null : T(L, `${pre.key} blockiert ${dep.key} gar nicht.`, `${pre.key} does not block ${dep.key}.`) };
  },
  async run(p, io, ctx, pv) {
    const L = lang(ctx);
    const r = await io.call('deps.unlink', { linkId: String(pv.data.linkId), preId: p.pre, depId: p.dep });
    io.patch?.('deps', { unlink: pv.data.linkId });
    return { applied: 1, failed: 0, errors: [], result: r, keys: [`dep:${p.pre}:${p.dep}`], label: T(L, 'Abhängigkeit entfernt (Lotse)', 'Dependency removed (Lotse)'),
      run: async (io2) => { const J = io2 || io; const res = await J.call('deps.link', { preId: p.pre, depId: p.dep }); J.patch?.('deps', res); } };
  },
});

// booking.book { items: [{ issue, date, hours, comment? }] } – OWN hours only (mine.book books as the caller);
// hours = what is added to the cell (the cell is set to booked + hours)
const BOOK = { pastDays: 92, maxHours: 24 };
export function bookedCell(ctx, issueId, date) {
  const me = meId(ctx);
  const i = issueOf(ctx, issueId) || (dsOf(ctx).supportTickets?.tickets || []).find((t) => t.id === String(issueId));
  return r2((i?.worklogs || []).filter((w) => w.a === me && w.d === date).reduce((a, w) => a + (w.h || 0), 0));
}
const bookable = (ctx, idOrKey) => { const i = issueOf(ctx, idOrKey); if (i) return i.role === 'tiny' ? null : i; const s = String(idOrKey ?? ''); return (dsOf(ctx).supportTickets?.tickets || []).find((t) => t.id === s || t.key === s.toUpperCase()) || null; };
def({
  id: 'booking.book', write: true, title: (L) => T(L, 'Zeit buchen', 'Log time'), params: '{ items: [{ issue: id|key, date, hours, comment? }] }',
  validate(p, ctx) {
    if (!plain(p) || !Array.isArray(p.items) || !p.items.length || p.items.length > 60) throw invalid('items');
    if (p.person && p.person !== meId(ctx)) throw new ActError('NO_ACCESS', 'own hours only');
    const today = dayIdx(dsOf(ctx).today);
    const seen = new Set();
    return { items: p.items.map((x) => {
      const i = bookable(ctx, x?.issue ?? x?.issueId ?? x?.key);
      if (!i) throw invalid('issue', 'unknown or not bookable (sub-task)');
      if (!validIso(x.date) || dayIdx(x.date) > today || dayIdx(x.date) < today - BOOK.pastDays) throw invalid('date', 'up to today, at most 92 days back');
      const h = Number(x.hours);
      if (!Number.isFinite(h) || h <= 0 || h > BOOK.maxHours || Math.abs(h * 4 - Math.round(h * 4)) > 1e-9) throw invalid('hours', 'quarter hours, 0.25–24');
      const k = `${i.id}|${x.date}`;
      if (seen.has(k)) throw invalid('items', 'duplicate cell');
      seen.add(k);
      if (x.comment != null && (typeof x.comment !== 'string' || x.comment.length > 1000)) throw invalid('comment');
      return { issue: i.id, date: x.date, hours: h, ...(x.comment ? { comment: x.comment.trim() } : {}) };
    }) };
  },
  allowed: (ctx) => (meId(ctx) ? null : T(lang(ctx), 'Buchen geht nur angemeldet und nur für dich selbst.', 'Booking needs a signed-in person and books only your own time.')),
  plan(ctx, p) {
    const L = lang(ctx), F = fmt(ctx);
    const rows = p.items.map((x) => { const i = bookable(ctx, x.issue); const from = bookedCell(ctx, i.id, x.date); return { ...x, i, from, to: r2(from + x.hours) }; });
    const over = rows.filter((x) => x.to > BOOK.maxHours);
    const changes = rows.map((x) => change(ctx, { kind: 'book', issue: x.i, field: T(L, 'Gebucht', 'Logged'), from: x.from, to: x.to, fromText: F.h(x.from, 2), toText: F.h(x.to, 2), label: T(L, `${x.i.key}, ${F.date(x.date)}: +${F.h(x.hours, 2)} (${F.h(x.from, 2)} → ${F.h(x.to, 2)})`, `${x.i.key}, ${F.date(x.date)}: +${F.h(x.hours, 2)} (${F.h(x.from, 2)} → ${F.h(x.to, 2)})`) }));
    const hours = r2(rows.reduce((a, x) => a + x.hours, 0));
    return { changes, data: { rows: rows.map(({ i, ...x }) => x) }, totals: { items: rows.length, hours },
      summary: T(L, `${F.h(hours, 2)} auf ${rows.length} ${plural(rows.length, 'Buchung', 'Buchungen')} – als du selbst.`, `${F.h(hours, 2)} in ${rows.length} ${plural(rows.length, 'booking', 'bookings')} – as yourself.`),
      blocked: over.length ? T(L, 'Mehr als 24 h an einem Tag auf einem Vorgang geht nicht.', 'More than 24 h on one work item and day is not possible.') : null };
  },
  async run(p, io, ctx, pv) {
    const L = lang(ctx);
    const r = await each(pv.data.rows.map((x) => ({ ...x, key: issueOf(ctx, x.issue)?.key || x.issue })), async (x) => {
      const res = await io.call('mine.book', { issueId: x.issue, date: x.date, hours: x.to, ...(x.comment ? { comment: x.comment } : {}) });
      io.patch?.('booking', res);
      const prev = res?.previous?.hours ?? x.from;
      return async (io2) => { const J = io2 || io; const res = await J.call('mine.book', { issueId: x.issue, date: x.date, hours: prev }); J.patch?.('booking', res); };
    });
    return { applied: r.applied, failed: r.failed, errors: r.errors, keys: pv.data.rows.map((x) => `book:${x.issue}:${x.date}`), label: T(L, 'Buchung (Lotse)', 'Booking (Lotse)'), run: undoAll(r.undos) };
  },
});

// notice.remind { kind: 'booking'|'gaps', people: [accountIds] } – only when a Jira admin switched notices on
def({
  id: 'notice.remind', write: true, title: (L) => T(L, 'Erinnerung senden', 'Send a reminder'), params: '{ kind: booking|gaps, people: accountId[] }',
  validate(p, ctx) {
    if (!plain(p) || !['booking', 'gaps'].includes(p.kind)) throw invalid('kind');
    if (!Array.isArray(p.people) || !p.people.length || p.people.length > 100 || !p.people.every((x) => dsOf(ctx).people?.[x])) throw invalid('people');
    return { kind: p.kind, people: [...new Set(p.people)] };
  },
  allowed: (ctx) => (can.remind(ctx) ? null : noAccess(lang(ctx), ['Kapazitäten pflegen', 'Maintain capacities'])),
  plan(ctx, p) {
    const L = lang(ctx);
    const on = dsOf(ctx).config?.notices?.enabled === true;
    const what = p.kind === 'booking' ? T(L, 'fehlende Buchungen', 'missing bookings') : T(L, 'fehlende Werte', 'missing values');
    const changes = p.people.map((id) => change(ctx, { kind: 'notify', ref: `person:${id}`, field: T(L, 'Erinnerung', 'Reminder'), from: null, to: p.kind, fromText: '–', toText: what, label: T(L, `${personLabel(ctx, id)}: Erinnerung an ${what}`, `${personLabel(ctx, id)}: reminder about ${what}`) }));
    return { changes: on ? changes : [], totals: { items: p.people.length },
      warnings: [T(L, 'Eine gesendete Erinnerung lässt sich nicht zurückholen.', 'A sent reminder cannot be taken back.')],
      summary: T(L, `${p.people.length} ${plural(p.people.length, 'Person bekommt', 'Personen bekommen')} eine Erinnerung an ${what}.`, `${p.people.length} ${plural(p.people.length, 'person gets', 'people get')} a reminder about ${what}.`),
      blocked: on ? null : T(L, 'Erinnerungen sind ausgeschaltet – ein Jira-Admin schaltet sie in der Konfiguration unter „Erinnerungen“ ein. Bis dahin sendet Lotse nichts.', 'Reminders are switched off – a Jira admin switches them on in the configuration under "Reminders". Until then Lotse sends nothing.') };
  },
  async run(p, io, ctx) {
    const L = lang(ctx);
    const r = await io.call('notices.remind', { kind: p.kind, accountIds: p.people });
    return { applied: p.people.length, failed: 0, errors: [], result: r, keys: [], irreversible: true, label: T(L, 'Erinnerung (Lotse)', 'Reminder (Lotse)'), run: null };
  },
});

// capacity.setHours { person, weeklyHours?, absence?: { from, to, type: vacation|training|absent } }
def({
  id: 'capacity.setHours', write: true, title: (L) => T(L, 'Kapazität einer Person ändern', 'Change a person\'s capacity'), params: '{ person, weeklyHours?: 0–80, absence?: { from, to, type } }',
  validate(p, ctx) {
    if (!plain(p) || !dsOf(ctx).people?.[p.person]) throw invalid('person');
    const out = { person: p.person };
    if (p.weeklyHours != null) { const h = Number(p.weeklyHours); if (!Number.isFinite(h) || h < 0 || h > 80) throw invalid('weeklyHours', '0–80'); out.weeklyHours = Math.round(h * 2) / 2; }
    if (p.absence != null) {
      const a = p.absence;
      if (!plain(a) || !validIso(a.from) || !validIso(a.to) || a.from > a.to) throw invalid('absence');
      out.absence = { from: a.from, to: a.to, type: ['vacation', 'training'].includes(a.type) ? a.type : 'absent' };
    }
    if (out.weeklyHours == null && !out.absence) throw invalid('params', 'weeklyHours or absence');
    return out;
  },
  allowed: (ctx) => (can.capacity(ctx) ? null : noAccess(lang(ctx), ['Kapazitäten pflegen', 'Maintain capacities'])),
  plan(ctx, p) {
    const L = lang(ctx), F = fmt(ctx);
    const cur = dsOf(ctx).capacity?.people?.[p.person] || {};
    const name = personLabel(ctx, p.person);
    const changes = [];
    if (p.weeklyHours != null && p.weeklyHours !== (cur.weeklyHours ?? null)) changes.push(change(ctx, { kind: 'capacity', ref: `person:${p.person}`, field: T(L, 'Wochenstunden', 'Weekly hours'), from: cur.weeklyHours ?? null, to: p.weeklyHours, fromText: cur.weeklyHours != null ? F.h(cur.weeklyHours, 1) : '–', toText: F.h(p.weeklyHours, 1), label: T(L, `${name}: ${cur.weeklyHours != null ? F.h(cur.weeklyHours, 1) : '–'} → ${F.h(p.weeklyHours, 1)} je Woche`, `${name}: ${cur.weeklyHours != null ? F.h(cur.weeklyHours, 1) : '–'} → ${F.h(p.weeklyHours, 1)} per week`) }));
    if (p.absence) {
      const type = { vacation: T(L, 'Urlaub', 'vacation'), training: T(L, 'Schulung', 'training'), absent: T(L, 'abwesend', 'away') }[p.absence.type];
      changes.push(change(ctx, { kind: 'capacity', ref: `person:${p.person}`, field: T(L, 'Abwesenheit', 'Absence'), from: null, to: `${p.absence.from}/${p.absence.to}`, fromText: '–', toText: `${F.date(p.absence.from)} – ${F.date(p.absence.to)}`, label: T(L, `${name}: ${type} ${F.date(p.absence.from)} – ${F.date(p.absence.to)}`, `${name}: ${type} ${F.date(p.absence.from)} – ${F.date(p.absence.to)}`) }));
    }
    return { changes, summary: changes.map((c) => c.label).join(' · ') || T(L, 'Nichts zu ändern.', 'Nothing to change.'), blocked: changes.length ? null : T(L, 'Nichts zu ändern.', 'Nothing to change.') };
  },
  async run(p, io, ctx) {
    const L = lang(ctx);
    // the server's current capacity (the browser may hold a privacy-reduced copy) – change exactly this one person
    const got = await io.call('capacity.get', {});
    const cap = got?.capacity || { people: {}, teams: {}, absences: [] };
    const before = cap.people?.[p.person] ? { ...cap.people[p.person] } : null;
    const absId = p.absence ? `lotse-${p.person}-${p.absence.from}`.slice(0, 40) : null;
    const next = { ...cap, people: { ...(cap.people || {}), [p.person]: { ...(before || { weeklyHours: 40, location: 'NONE', teamId: null }), ...(p.weeklyHours != null ? { weeklyHours: p.weeklyHours } : {}) } },
      absences: [...(cap.absences || []), ...(p.absence ? [{ id: absId, accountId: p.person, ...p.absence }] : [])] };
    await io.call('capacity.save', { capacity: next });
    io.patch?.('capacity', { person: p.person });
    return { applied: 1, failed: 0, errors: [], keys: [`capacity:${p.person}`], label: T(L, 'Kapazität (Lotse)', 'Capacity (Lotse)'),
      run: async (io2) => {
        const J = io2 || io;
        const now = (await J.call('capacity.get', {}))?.capacity || { people: {}, teams: {}, absences: [] };
        const people = { ...(now.people || {}) };
        if (before) people[p.person] = before; else delete people[p.person];
        await J.call('capacity.save', { capacity: { ...now, people, absences: (now.absences || []).filter((a) => a.id !== absId) } });
        J.patch?.('capacity', { person: p.person, undo: true });
      } };
  },
});

// capacity.setShares { person, teams: [{ teamId, pct }] } (2026-11-17, people in several teams): how a person's hours split
// over their teams. With Atlassian Teams the TEAMS are Atlassian's – only the shares of teams the person is a member of
// can be set (whole percent, 5–100, together exactly 100). Weekly hours and location stay; a person without maintained
// capacity becomes maintained with the values the cockpit used so far. One undo restores the entry exactly.
def({
  id: 'capacity.setShares', write: true, title: (L) => T(L, 'Team-Anteile einer Person setzen', 'Set a person\'s team shares'), params: '{ person, teams: [{ teamId, pct }] (sum 100) }',
  validate(p, ctx) {
    if (!plain(p) || !dsOf(ctx).people?.[p.person] || !Array.isArray(p.teams)) throw invalid('params');
    const list = validAllocation(p.teams);
    if (!list || list.length < 2 || list.some((x) => x.pct < 5) || list.reduce((a, x) => a + x.pct, 0) !== 100) throw invalid('teams', '2–6 teams, 5–100 % each, together 100 %');
    const model = computedOf(ctx).model;
    const atl = atlIndex(model.ds);
    for (const x of list) {
      if (!model.teams.get(x.teamId)) throw invalid('teams', 'unknown team');
      if (atl?.judged(x.teamId) && !atl.isMember(p.person, x.teamId)) throw invalid('teams', 'not a member in Atlassian Teams');
    }
    return { person: p.person, teams: list };
  },
  allowed: (ctx) => (can.capacity(ctx) ? null : noAccess(lang(ctx), ['Kapazitäten pflegen', 'Maintain capacities'])),
  plan(ctx, p) {
    const L = lang(ctx);
    const cur = capacityPeople(computedOf(ctx).model).get(p.person);
    const now = new Map(allocationOf(cur || {}).map((x) => [x.teamId, Math.round(x.pct)]));
    const name = personLabel(ctx, p.person);
    const changes = p.teams.filter((x) => now.get(x.teamId) !== x.pct).map((x) => change(ctx, { kind: 'capacity', ref: `person:${p.person}`, field: T(L, `Anteil ${teamLabel(ctx, x.teamId)}`, `Share ${teamLabel(ctx, x.teamId)}`), from: now.get(x.teamId) ?? 0, to: x.pct, fromText: `${now.get(x.teamId) ?? 0} %`, toText: `${x.pct} %`,
      label: T(L, `${name}: ${teamLabel(ctx, x.teamId)} ${now.get(x.teamId) ?? 0} % → ${x.pct} %`, `${name}: ${teamLabel(ctx, x.teamId)} ${now.get(x.teamId) ?? 0} % → ${x.pct} %`) }));
    const warnings = cur?.derived ? [T(L, `${name} hat noch keine gepflegte Kapazität – Lotse legt sie mit den bisherigen Werten an (${cur.weeklyHours ?? 40} h je Woche).`, `${name} has no maintained capacity yet – Lotse creates it with the values used so far (${cur.weeklyHours ?? 40} h per week).`)] : [];
    return { changes, warnings, summary: changes.length ? T(L, `${name}: ${p.teams.map((x) => `${teamLabel(ctx, x.teamId)} ${x.pct} %`).join(', ')}`, `${name}: ${p.teams.map((x) => `${teamLabel(ctx, x.teamId)} ${x.pct} %`).join(', ')}`) : T(L, 'Nichts zu ändern.', 'Nothing to change.'), blocked: changes.length ? null : T(L, 'Nichts zu ändern.', 'Nothing to change.') };
  },
  async run(p, io, ctx) {
    const L = lang(ctx);
    const got = await io.call('capacity.get', {});
    const cap = got?.capacity || { people: {}, teams: {}, absences: [] };
    const before = cap.people?.[p.person] ? { ...cap.people[p.person] } : null;
    const cur = capacityPeople(computedOf(ctx).model).get(p.person) || {};
    const base = before || { weeklyHours: cur.weeklyHours ?? cap.defaultWeeklyHours ?? 40, location: cur.location || cap.defaultLocation || 'NONE' };
    const main = p.teams.some((x) => x.teamId === base.teamId) ? base.teamId : [...p.teams].sort((a, b) => b.pct - a.pct)[0].teamId;
    const next = { ...cap, people: { ...(cap.people || {}), [p.person]: { ...base, teamId: main, teams: p.teams.map((x) => ({ teamId: x.teamId, pct: x.pct })) } } };
    await io.call('capacity.save', { capacity: next });
    io.patch?.('capacity', { person: p.person });
    return { applied: 1, failed: 0, errors: [], keys: [`capacity:${p.person}`], label: T(L, 'Team-Anteile (Lotse)', 'Team shares (Lotse)'),
      run: async (io2) => {
        const J = io2 || io;
        const now = (await J.call('capacity.get', {}))?.capacity || { people: {}, teams: {}, absences: [] };
        const people = { ...(now.people || {}) };
        if (before) people[p.person] = before; else delete people[p.person];
        await J.call('capacity.save', { capacity: { ...now, people } });
        J.patch?.('capacity', { person: p.person, undo: true });
      } };
  },
});

// capacity.closure { people: [accountId], from, to } – an unplanned closure (heavy snow, outage, office closed): one
// absence per affected person over the days, nothing else changes (people without maintained capacity stay derived –
// capacity.setHours would turn them into maintained entries). Stored as "absent" without a reason; one undo removes all.
const MAX_CLOSURE_DAYS = 31;
def({
  id: 'capacity.closure', write: true, title: (L) => T(L, 'Ausfall eintragen', 'Record a closure'), params: '{ people: [accountId] (1–500), from, to (≤ 31 days) }',
  validate(p, ctx) {
    if (!plain(p) || !Array.isArray(p.people) || !p.people.length || p.people.length > 500) throw invalid('people', '1–500');
    const known = dsOf(ctx).people || {};
    const people = [...new Set(p.people.map(String))];
    if (people.some((id) => !/^[A-Za-z0-9:_-]{1,128}$/.test(id) || !known[id])) throw invalid('people');
    if (!validIso(p.from) || !validIso(p.to) || p.from > p.to) throw invalid('dates');
    if ((Date.parse(p.to) - Date.parse(p.from)) / 864e5 + 1 > MAX_CLOSURE_DAYS) throw invalid('dates', `at most ${MAX_CLOSURE_DAYS} days`);
    return { people, from: p.from, to: p.to };
  },
  allowed: (ctx) => (can.capacity(ctx) ? null : noAccess(lang(ctx), ['Kapazitäten pflegen', 'Maintain capacities'])),
  plan(ctx, p) {
    const L = lang(ctx), F = fmt(ctx);
    const changes = p.people.map((id) => change(ctx, { kind: 'capacity', ref: `person:${id}`, field: T(L, 'Ausfall', 'Closure'), from: null, to: `${p.from}/${p.to}`, fromText: '–', toText: `${F.date(p.from)} – ${F.date(p.to)}`,
      label: T(L, `${personLabel(ctx, id)}: Ausfall ${F.date(p.from)} – ${F.date(p.to)}`, `${personLabel(ctx, id)}: closure ${F.date(p.from)} – ${F.date(p.to)}`) }));
    return { changes, summary: T(L, `Ausfall ${F.date(p.from)} – ${F.date(p.to)} für ${p.people.length} ${p.people.length === 1 ? 'Person' : 'Personen'}`, `Closure ${F.date(p.from)} – ${F.date(p.to)} for ${p.people.length} ${p.people.length === 1 ? 'person' : 'people'}`), blocked: null };
  },
  async run(p, io, ctx) {
    const L = lang(ctx);
    const got = await io.call('capacity.get', {});
    const cap = got?.capacity || { people: {}, teams: {}, absences: [] };
    const tag = `closure-${p.from}-${Date.now().toString(36)}`.slice(0, 32);
    const ids = new Set(p.people.map((id, i) => `${tag}-${i}`.slice(0, 40)));
    const added = p.people.map((id, i) => ({ id: `${tag}-${i}`.slice(0, 40), accountId: id, from: p.from, to: p.to, type: 'absent' }));
    await io.call('capacity.save', { capacity: { ...cap, absences: [...(cap.absences || []), ...added] } });
    io.patch?.('capacity', { closure: true });
    return { applied: p.people.length, failed: 0, errors: [], keys: [`closure:${tag}`], label: T(L, 'Ausfall (Lotse)', 'Closure (Lotse)'),
      run: async (io2) => {
        const J = io2 || io;
        const now = (await J.call('capacity.get', {}))?.capacity || { people: {}, teams: {}, absences: [] };
        await J.call('capacity.save', { capacity: { ...now, absences: (now.absences || []).filter((a) => !ids.has(a.id)) } });
        J.patch?.('capacity', { closure: true, undo: true });
      } };
  },
});

// report.compose { audience, sections, period } – no write: the hook that opens the report composer (built elsewhere)
const AUDIENCES = ['board', 'management', 'teamLeads'];
const SECTIONS = ['portfolio', 'waterline', 'risks', 'support', 'planActual', 'milestones'];
const PERIODS = ['currentQuarter', 'nextQuarter', 'last4Weeks'];
export const REPORT_OPTIONS = { AUDIENCES, SECTIONS, PERIODS };
def({
  id: 'report.compose', write: false, title: (L) => T(L, 'C-Level-Report zusammenstellen', 'Compose the C-level report'), params: '{ audience, sections[], period }',
  validate(p) {
    if (!plain(p) || !AUDIENCES.includes(p.audience)) throw invalid('audience');
    if (!Array.isArray(p.sections) || !p.sections.length || !p.sections.every((s) => SECTIONS.includes(s))) throw invalid('sections');
    if (!PERIODS.includes(p.period)) throw invalid('period');
    return { audience: p.audience, sections: SECTIONS.filter((s) => p.sections.includes(s)), period: p.period };
  },
  allowed: (ctx) => (can.report(ctx) ? null : noAccess(lang(ctx), ['C-Level-Report', 'C-level report'])),
  plan(ctx, p) {
    const L = lang(ctx);
    return { changes: [], summary: T(L, `Öffnet den Report-Baukasten mit ${p.sections.length} ${plural(p.sections.length, 'Abschnitt', 'Abschnitten')} – gespeichert oder veröffentlicht wird erst dort.`, `Opens the report composer with ${p.sections.length} ${plural(p.sections.length, 'section', 'sections')} – nothing is saved or published before you do it there.`) };
  },
  run: async (p) => ({ applied: 0, failed: 0, errors: [], keys: [], label: 'report', run: null, open: 'reportComposer', params: p }),
});
// doc.pdf { job } – no write: the document of an orchestrated job (shared/lotse/report/jobDoc.js), painted and downloaded
// by the app through io.pdf(doc, { each }) (components/lotse/io.js → lib/jobPdf.js). Nothing is sent to anyone; the
// preview names every section. Without io.pdf (tests without a renderer) the run only reports the document.
def({
  id: 'doc.pdf', write: false, title: (L) => T(L, 'PDF erstellen', 'Create the PDF'), params: '{ job: { scope, subjects, blocks[], window, format, audience, tone, people?[] } }',
  validate(p, ctx) {
    if (!plain(p)) throw invalid('job');
    return { job: cleanJob(p.job, ctx) };
  },
  allowed: () => null,
  plan(ctx, p) {
    const L = lang(ctx);
    const doc = buildJobDoc(ctx, p.job);
    const n = doc.sections.length;
    return { changes: [], totals: { sections: n, figures: doc.proof.length },
      summary: p.job.format === 'pdfEach'
        ? T(L, `Erstellt „${doc.title}“ mit ${n} ${plural(n, 'Abschnitt', 'Abschnitten')} und je Empfänger ein eigenes PDF – nichts wird gesendet.`, `Creates "${doc.title}" with ${n} ${plural(n, 'section', 'sections')} and an own PDF per recipient – nothing is sent.`)
        : T(L, `Erstellt „${doc.title}“ mit ${n} ${plural(n, 'Abschnitt', 'Abschnitten')} und dem Nachweis jeder Zahl – nichts wird gesendet.`, `Creates "${doc.title}" with ${n} ${plural(n, 'section', 'sections')} and the proof of every number – nothing is sent.`),
      blocked: n ? null : T(L, 'Ohne Empfänger gibt es kein Dokument.', 'Without recipients there is no document.') };
  },
  async run(p, io, ctx) {
    const doc = buildJobDoc(ctx, p.job);
    let rendered = null;
    if (p.job.format !== 'text' && typeof io?.pdf === 'function') rendered = await io.pdf(doc, { each: p.job.format === 'pdfEach' });
    return { applied: 0, failed: 0, errors: [], keys: [], label: 'pdf', run: null, open: 'jobDoc', params: { job: p.job, sections: doc.sections.length, rendered: rendered && typeof rendered === 'object' ? { name: String(rendered.name || '').slice(0, 120), pages: +rendered.pages || null } : null } };
  },
});
// doc.chain { doc: { kind: 'list', set, title? } | { kind: 'brief', brief } } – a chain's list or summary as a PDF (no write):
// the set / the brief travel as they were found (frozen at the chain step), checked strictly (chain/docs.js cleanChainDoc).
def({
  id: 'doc.chain', write: false, title: (L) => T(L, 'PDF erstellen', 'Create the PDF'), params: '{ doc: { kind: list|brief, set?, brief?, title? } }',
  validate(p, ctx) { if (!plain(p)) throw invalid('doc'); return { doc: cleanChainDoc(p.doc, ctx) }; },
  allowed: () => null,
  plan(ctx, p) {
    const L = lang(ctx);
    const doc = buildChainDoc(ctx, p.doc);
    return { changes: [], totals: { sections: doc.sections.length, figures: doc.proof.length }, summary: T(L, `Erstellt „${doc.title}“ mit dem Nachweis jeder Zahl – nichts wird gesendet.`, `Creates "${doc.title}" with the proof of every number – nothing is sent.`), blocked: null };
  },
  async run(p, io, ctx) {
    const doc = buildChainDoc(ctx, p.doc);
    let rendered = null;
    if (typeof io?.pdf === 'function') rendered = await io.pdf(doc, { each: false });
    return { applied: 0, failed: 0, errors: [], keys: [], label: 'pdf', run: null, open: 'chainDoc', params: { doc: p.doc, title: doc.title, rendered: rendered && typeof rendered === 'object' ? { name: String(rendered.name || '').slice(0, 120), pages: +rendered.pages || null } : null } };
  },
});
// navigate { view, opts? } – no write
def({
  id: 'navigate', write: false, title: (L) => T(L, 'Ansicht öffnen', 'Open a view'), params: '{ view, opts? }',
  validate(p) { if (!plain(p) || !VIEWS.includes(p.view)) throw invalid('view'); return { view: p.view, ...(plain(p.opts) ? { opts: JSON.parse(JSON.stringify(p.opts)) } : {}) }; },
  allowed: () => null,
  plan(ctx, p) { const L = lang(ctx); return { changes: [], summary: T(L, `Öffnet „${VIEW_NAME[p.view][0]}“.`, `Opens "${VIEW_NAME[p.view][1]}".`) }; },
  run: async (p) => ({ applied: 0, failed: 0, errors: [], keys: [], label: 'navigate', run: null, navigate: { view: p.view, opts: p.opts || {} } }),
});

// playbook.save { items: [{ id?, topic, topicName?, title, symptoms[], steps[], reply, keys[], source? }] } → playbooks.save
// Support playbooks (help article + standard reply per recurring topic) live in the app's storage – nothing is ever posted
// to a Jira ticket. Rights as src/lib/playbooks.js: the Support tab plus "dispatch tickets" or "maintain capacities"; admins.
// A topic that already has a playbook (ctx.playbooks, and again from playbooks.list at apply time) is never overwritten
// unless the item names that playbook's id. Undo: delete what was created, or save the previous version back (restore).
const PB_MAX = 20;
const pbRoles = (ctx) => ctx?.roles || {};
const knownPlaybooks = (ctx) => (Array.isArray(ctx?.playbooks) ? ctx.playbooks : Array.isArray(ctx?.playbooks?.items) ? ctx.playbooks.items : null);
const PB_TOO_LONG = (x) => {
  const L = PLAYBOOK_LIMITS;
  const s = (v) => (typeof v === 'string' ? v.trim().length : 0);
  const li = (v) => (Array.isArray(v) ? v : []);
  return s(x.title) > L.title || s(x.topicName) > L.topic || s(x.reply) > L.reply || li(x.symptoms).length > L.list || li(x.steps).length > L.list || li(x.keys).length > L.keys
    || [...li(x.symptoms), ...li(x.steps)].some((y) => typeof y !== 'string' || y.trim().length > L.item);
};
// what the customer reads must not carry internal figures (ticket keys, hours, ticket counts)
export const replyLeaks = (reply) => /\b[A-Z][A-Z0-9_]{0,19}-\d{1,9}\b|\b\d+(?:[.,]\d+)?\s?(h|std|stunden|hours?)\b|\b\d+\s?(tickets?|vorgänge|fälle|cases)\b/i.test(String(reply || ''));
def({
  id: 'playbook.save', write: true, title: (L) => T(L, 'Playbooks anlegen', 'Create playbooks'), params: '{ items: [{ id?, topic, topicName?, title, symptoms[], steps[], reply, keys[], source? }] }',
  validate(p) {
    if (!plain(p) || !Array.isArray(p.items) || !p.items.length || p.items.length > PB_MAX) throw invalid('items', `1–${PB_MAX}`);
    const seen = new Set();
    return { items: p.items.map((x) => {
      if (!plain(x)) throw invalid('items');
      if (PB_TOO_LONG(x)) throw invalid('items', 'too long');
      let pb;
      try { pb = validPlaybook(x); } catch { throw invalid('title'); }
      if (!pb.reply) throw invalid('reply', 'a standard reply is required');
      if (!pb.steps.length) throw invalid('steps', 'at least one step');
      if (!pb.topic && !pb.id) throw invalid('topic');
      const k = pb.id || pb.topic;
      if (seen.has(k)) throw invalid('items', 'duplicate topic');
      seen.add(k);
      const { createdAt: _c, id, ...rest } = pb;
      return id ? { id, ...rest } : rest;
    }) };
  },
  allowed: (ctx) => (canEditPlaybooks(pbRoles(ctx)) ? null : T(lang(ctx), 'Playbooks anlegen darf, wer den Support-Bereich sieht und Tickets verteilt oder Kapazitäten pflegt.', 'Playbooks can be created by people who see the support area and dispatch tickets or maintain capacities.')),
  plan(ctx, p) {
    const L = lang(ctx);
    const known = knownPlaybooks(ctx);
    const byTopic = new Map((known || []).filter((x) => x?.topic).map((x) => [x.topic, x]));
    const byId = new Map((known || []).filter((x) => x?.id).map((x) => [x.id, x]));
    const warnings = [];
    const changes = [];
    const skipped = [];
    for (const x of p.items) {
      const prev = x.id ? byId.get(x.id) || null : null;
      if (!x.id && byTopic.has(x.topic)) { skipped.push(x); continue; }
      const nSteps = x.steps.length;
      const what = T(L, `${nSteps} ${plural(nSteps, 'Schritt', 'Schritte')} und eine Standardantwort`, `${nSteps} ${plural(nSteps, 'step', 'steps')} and a standard reply`);
      changes.push(change(ctx, { kind: 'playbook', ref: `playbook:${x.id || x.topic}`, field: 'Playbook', from: prev ? prev.title : null, to: x.title, fromText: prev ? prev.title : T(L, 'keins', 'none'), toText: `${x.title} – ${what}`,
        label: prev ? T(L, `${x.title}: aktualisiert – ${what}`, `${x.title}: updated – ${what}`) : T(L, `${x.title}: neu – ${what}`, `${x.title}: new – ${what}`) }));
    }
    if (skipped.length) warnings.push(T(L, `${skipped.length} ${plural(skipped.length, 'Thema hat', 'Themen haben')} schon ein Playbook – es bleibt unverändert.`, `${skipped.length} ${plural(skipped.length, 'topic already has', 'topics already have')} a playbook – it stays unchanged.`));
    const open = p.items.filter((x) => !skipped.includes(x)).reduce((a, x) => a + x.steps.filter((y) => /\[[^\]]+\]/.test(y)).length + (String(x.reply).match(/\[[^\]]+\]/g) || []).length, 0);
    if (open) warnings.push(T(L, `${open} ${plural(open, 'Stelle steht', 'Stellen stehen')} noch in [Klammern] – in Support › Playbooks ergänzen.`, `${open} ${plural(open, 'place is', 'places are')} still in [brackets] – fill them in under Support › Playbooks.`));
    const leaks = p.items.filter((x) => replyLeaks(x.reply)).length;
    if (leaks) warnings.push(T(L, `${leaks} ${plural(leaks, 'Standardantwort enthält', 'Standardantworten enthalten')} interne Angaben (Ticket-Keys oder Stunden) – vor dem Versand an Kunden prüfen.`, `${leaks} standard ${plural(leaks, 'reply contains', 'replies contain')} internal details (ticket keys or hours) – check before sending to customers.`));
    if (known == null) warnings.push(T(L, 'Beim Speichern prüft Lotse die vorhandenen Playbooks – ein Thema mit Playbook wird nie überschrieben.', 'When saving, Lotse checks the existing playbooks – a topic with a playbook is never overwritten.'));
    const n = changes.length;
    return {
      changes, totals: { items: n }, warnings, data: { items: p.items.filter((x) => !skipped.includes(x)) },
      summary: n ? T(L, `${n} ${plural(n, 'Playbook', 'Playbooks')} im App-Speicher – nichts wird an ein Jira-Ticket gesendet.`, `${n} ${plural(n, 'playbook', 'playbooks')} in the app's storage – nothing is sent to a Jira ticket.`) : T(L, 'Alle Themen haben schon ein Playbook.', 'Every topic already has a playbook.'),
      blocked: n ? null : T(L, 'Nichts zu ändern.', 'Nothing to change.'),
    };
  },
  async run(p, io, ctx, pv) {
    const L = lang(ctx);
    // the stored playbooks right now: a topic that got a playbook since the preview is left alone
    let stored = null;
    try { const r = await io.call('playbooks.list', {}); stored = Array.isArray(r?.items) ? r.items : null; } catch { stored = null; }
    const taken = new Set((stored || []).map((x) => x?.topic).filter(Boolean));
    const r = await each(pv.data.items.map((x) => ({ ...x, key: x.title })), async (x) => {
      if (!x.id && x.topic && taken.has(x.topic)) throw new ActError('EXISTS', 'this topic already has a playbook');
      const { key: _k, ...pb } = x;
      const res = await io.call('playbooks.save', { playbook: pb });
      const saved = res?.playbook;
      if (!saved?.id) throw new ActError('ERROR', 'not saved');
      const previous = res?.previous ?? null;
      return async (io2) => { const J = io2 || io; if (previous) await J.call('playbooks.save', { playbook: previous, restore: true }); else await J.call('playbooks.delete', { id: saved.id }); };
    });
    return { applied: r.applied, failed: r.failed, errors: r.errors, keys: pv.data.items.map((x) => `playbook:${x.id || x.topic}`), label: T(L, 'Playbooks (Lotse)', 'Playbooks (Lotse)'), run: undoAll(r.undos) };
  },
});

// ---------- the public registry: guarded preview/apply ----------
function previewOf(spec, ctx, params) {
  const c = withC(ctx);
  const L = lang(c);
  const p = spec.validate(params, c);
  const no = spec.allowed(c, p);
  const pl = spec.plan(c, p, L);
  const all = pl.changes || [];
  const blocked = no || pl.blocked || null;
  return {
    command: spec.id, title: spec.title(L), write: spec.write, params: p, changes: all.slice(0, MAX_SHOWN), count: all.length, more: Math.max(0, all.length - MAX_SHOWN),
    totals: pl.totals || { items: all.length }, summary: pl.summary || '', warnings: pl.warnings || [], blocked, noAccess: !!no,
    token: blocked && spec.write ? null : tokenOf(spec.id, p, all.map((x) => [x.kind, x.id || x.ref, x.field, x.fromValue, x.toValue]), dsOf(c).today),
    data: pl.data || {},
  };
}
export const COMMANDS = Object.freeze(Object.fromEntries(Object.values(C).map((spec) => [spec.id, Object.freeze({
  id: spec.id, write: spec.write, params: spec.params, title: spec.title,
  validate: (params, ctx) => spec.validate(params, withC(ctx)),
  allowed: (ctx, params) => { const c = withC(ctx); return spec.allowed(c, spec.validate(params, c)); },
  preview(ctx, params) { const { data, ...pv } = previewOf(spec, ctx, params); return pv; },
  async apply(params, io, { ctx, token } = {}) {
    if (!ctx) throw new ActError('INVALID', 'ctx required');
    const c = withC(ctx);
    const pv = previewOf(spec, c, params); // validates (INVALID)
    if (pv.noAccess) throw new ActError('NO_ACCESS', pv.blocked);
    if (spec.write) {
      if (!io || typeof io.call !== 'function') throw new ActError('NO_IO', 'io.call required');
      if (!token) throw new ActError('PREVIEW_REQUIRED', 'show the preview first');
      if (pv.blocked) throw new ActError('BLOCKED', pv.blocked);
      if (token !== pv.token) throw new ActError('STALE_PREVIEW', 'the data or the params changed since the preview');
    }
    const done = await spec.run(pv.params, io, c, pv);
    return { ...done, command: spec.id, summary: pv.summary };
  },
})])));
export const COMMAND_IDS = Object.freeze(Object.keys(COMMANDS));
export function preview(id, params, ctx) {
  if (!COMMANDS[id]) throw new ActError('UNKNOWN_COMMAND', id);
  return COMMANDS[id].preview(ctx, params);
}
export function apply(id, params, io, opts) {
  if (!COMMANDS[id]) return Promise.reject(new ActError('UNKNOWN_COMMAND', id));
  return COMMANDS[id].apply(params, io, opts);
}
// What this person may do at all (for the UI's command palette).
export function commandList(ctx) {
  const c = withC(ctx);
  const L = lang(c);
  const edit = (x) => can.plan(x) || can.capacity(x) || c.computed.model.items.some((it) => ownsProject(x, it.ref)) || (dsOf(c).issues || []).some((i) => meId(x) && i.assignee?.id === meId(x));
  const gate = { 'issue.setField': edit, 'issue.bulkFill': edit, 'deps.link': edit, 'deps.unlink': edit, 'rank.set': can.rank, 'rank.reorder': can.rank, 'plan.move': can.plan, 'plan.applyOptimizer': can.plan, 'dispatch.assign': can.dispatch, 'support.reserve': can.capacity, 'capacity.setHours': can.capacity, 'capacity.closure': can.capacity, 'notice.remind': can.remind, 'report.compose': can.report, 'health.set': (x) => can.healthAny(x) || c.computed.model.items.some((it) => ownsProject(x, it.ref)), 'booking.book': (x) => !!meId(x), 'playbook.save': (x) => canEditPlaybooks(x.roles || {}) };
  return COMMAND_IDS.map((id) => ({ id, title: COMMANDS[id].title(L), write: COMMANDS[id].write, allowed: gate[id] ? !!gate[id](c) : true }));
}
