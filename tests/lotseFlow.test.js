// Lotse acts in the UI – the io adapter (static/cockpit/src/components/lotse/io.js) and the pure UI helpers (acts.js),
// without a browser: a recorded call log against the fake backend, the screen's dataset patched in place exactly like
// the server's, undo putting both back, the preview-token rule, and the workflow helpers the runner relies on
// (re-preview after changed data, phases, the report composer hand-over, the job gallery, usage events).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preview, apply, COMMAND_IDS, WORKFLOW_IDS, start, answer, next, applyStep, current } from '../shared/lotse/act/index.js';
import { fakeIo } from '../shared/lotse/act/fakeIo.js';
import { computeAll } from '../shared/engine.js';
import { isUsageEvent } from '../shared/usage.js';
import { createIo, patchFor, RELOAD_KINDS } from '../static/cockpit/src/components/lotse/io.js';
import { ACTION_KIND, actionKind, groupChanges, subjectOf, composerParams, JOBS, phasesOf, progressOf, replayAnswers, staleItems, FREE_HINT } from '../static/cockpit/src/components/lotse/acts.js';
import { previewCommand } from '../shared/lotse/index.js';
import { lotseCtx, lotseDataset } from './lotseFixture.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
// the app around the io: a backend (the fake server), the screen's dataset (setDs), state.fill / state.reorder
function harness() {
  const d = lotseDataset();
  const backend = fakeIo(d);
  const app = { ds: clone(d), reloads: 0, fills: 0, reorders: 0 };
  const setDs = (fn) => { app.ds = fn(app.ds); };
  // state.fill with collectUndo: write, patch the screen, return the exact undo
  const fill = async ({ issueId, ref, usage, value }) => {
    app.fills++;
    const key = { originalEstimate: 'oe', team: 'team', startDate: 'start', dueDate: 'due', tshirt: 'tshirt', targetQuarters: 'quarters' }[usage];
    const { previous } = await backend.call('issue.fill', value == null ? { issueId, ref, usage, clear: true } : { issueId, ref, usage, value });
    const before = app.ds.issues.find((i) => i.id === issueId)?.[key];
    setDs((x) => ({ ...x, issues: x.issues.map((i) => (i.id === issueId ? { ...i, [key]: usage === 'team' ? (value ? { id: value, name: value } : null) : value } : i)) }));
    return async () => {
      await backend.call('issue.fill', { issueId, ref, usage, restore: previous });
      setDs((x) => ({ ...x, issues: x.issues.map((i) => (i.id === issueId ? { ...i, [key]: before } : i)) }));
    };
  };
  const reorder = async (order) => {
    app.reorders++;
    await backend.call('portfolio.reorder', { order });
    setDs((x) => ({ ...x, portfolio: x.portfolio.map((p) => ({ ...p, rank: order.indexOf(p.ref) + 1 || p.rank })) }));
  };
  const io = createIo({ call: (n, p) => backend.call(n, p), fill, reorder, setDs, reload: () => { app.reloads++; }, schedule: (f) => { f(); return 1; }, cancel: () => {} });
  const ctx = () => lotseCtx('de', { ds: app.ds, computed: computeAll(app.ds) });
  return { d, backend, app, io, ctx };
}
const issueOf = (ds, id) => ds.issues.find((i) => i.id === id);
async function run(h, id, params) {
  const c = h.ctx();
  const pv = preview(id, params, c);
  assert.ok(pv.token && !pv.blocked, `${id}: previewable (${pv.blocked || ''})`);
  return { pv, done: await apply(id, params, h.io, { ctx: c, token: pv.token }) };
}

test('io: plan.apply goes through call and patches the screen exactly like the server; undo puts both back', async () => {
  const h = harness();
  const s = h.d.issues.find((i) => i.role === 'estimate' && i.status.cat !== 'done' && i.start && i.due);
  const before = { start: s.start, due: s.due };
  const { done } = await run(h, 'plan.move', { moves: [{ issue: s.key, weeks: 1 }] });
  assert.deepEqual(h.io.calls.filter((x) => x[0] !== 'hint').map((x) => x.slice(0, 2)), [['call', 'plan.apply'], ['patch', 'plan.apply']], 'one resolver call, one local patch');
  const srv = issueOf(h.backend.ds, s.id), scr = issueOf(h.app.ds, s.id);
  assert.notEqual(srv.start, before.start);
  assert.deepEqual([scr.start, scr.due], [srv.start, srv.due], 'the screen shows what the server holds');
  assert.equal(h.app.reloads, 0, 'no reload needed');
  await done.run(h.io);
  assert.deepEqual([issueOf(h.app.ds, s.id).start, issueOf(h.app.ds, s.id).due], [before.start, before.due]);
  assert.deepEqual([issueOf(h.backend.ds, s.id).start, issueOf(h.backend.ds, s.id).due], [before.start, before.due]);
});

test('io: health, dispatch (and their undo) are patched in place; links, bookings, capacity reload quietly', async () => {
  const h = harness();
  const ref = h.d.portfolio[0].ref;
  const { done } = await run(h, 'health.set', { ref, status: 'critical', comment: 'Freigabe fehlt.' });
  assert.equal(h.app.ds.portfolio.find((p) => p.ref === ref).health.status, 'critical');
  assert.deepEqual(h.app.ds.portfolio.find((p) => p.ref === ref).health, h.backend.ds.portfolio.find((p) => p.ref === ref).health);
  await done.run(h.io);
  assert.deepEqual(h.app.ds.portfolio.find((p) => p.ref === ref).health ?? null, h.backend.ds.portfolio.find((p) => p.ref === ref).health ?? null, 'undo: the earlier record on screen');

  const t = h.d.supportTickets.tickets.find((x) => x.statusCat !== 'done' && x.team?.id !== 't-web');
  const was = { team: t.team?.id ?? null, who: t.assignee?.id ?? null };
  const r = await run(h, 'dispatch.assign', { items: [{ ticket: t.key, teamId: 't-web', accountId: 'u2' }] });
  const scr = () => h.app.ds.supportTickets.tickets.find((x) => x.id === t.id);
  assert.deepEqual([scr().team?.id, scr().assignee?.id], ['t-web', 'u2']);
  assert.equal(scr().team.name, 'Web', 'the team object, not just its id');
  await r.done.run(h.io);
  assert.deepEqual([scr().team?.id ?? null, scr().assignee?.id ?? null], [was.team, was.who], 'undo dispatch restores team and person');

  const n = h.app.reloads;
  const a = h.d.issues.find((i) => i.role === 'estimate' && i.status.cat !== 'done' && i.due);
  const b = h.d.issues.find((i) => i.role === 'estimate' && i.status.cat !== 'done' && i.start && i.id !== a.id && !a.links.some((l) => l.otherId === i.id));
  await run(h, 'deps.link', { pre: a.key, dep: b.key });
  assert.ok(h.app.reloads > n, 'a new link reloads the data');
  for (const k of ['deps', 'booking', 'capacity', 'reserve']) assert.ok(RELOAD_KINDS.has(k));
});

test('io: ranks go through state.reorder, values through state.fill – never twice through call', async () => {
  const h = harness();
  const order = [...h.d.portfolio].sort((x, y) => x.rank - y.rank).map((p) => p.ref).reverse();
  const { done } = await run(h, 'rank.reorder', { order });
  assert.equal(h.app.reorders, 1);
  assert.ok(!h.io.calls.some((x) => x[0] === 'call' && x[1] === 'portfolio.reorder'), 'not a second write through call');
  assert.deepEqual([...h.app.ds.portfolio].sort((x, y) => x.rank - y.rank).map((p) => p.ref), order);
  await done.run(h.io);
  assert.equal(h.app.reorders, 2, 'undo: the previous order through the same path');

  const h2 = harness();
  const kpr = h2.d.portfolio.find((p) => p.name === 'Kundenportal Relaunch').ref;
  const r = await run(h2, 'issue.bulkFill', { field: 'estimate', value: 8, filter: { project: kpr, missing: 'estimate' } });
  assert.equal(h2.app.fills, r.pv.count, 'one fill per work item');
  assert.ok(h2.io.calls.filter((x) => x[0] === 'fill').length === r.pv.count);
  const ids = r.pv.changes.map((c) => c.id);
  assert.ok(ids.every((id) => issueOf(h2.app.ds, id).oe === 8 && issueOf(h2.backend.ds, id).oe === 8));
  await r.done.run(h2.io);
  assert.ok(ids.every((id) => !(issueOf(h2.backend.ds, id).oe > 0)), 'undo clears them again on the server');
});

test('io: nothing is sent without the shown preview\'s token – missing or stale', async () => {
  const h = harness();
  const s = h.d.issues.find((i) => i.role === 'estimate' && i.status.cat !== 'done' && i.start && i.due);
  const params = { moves: [{ issue: s.key, weeks: 2 }] };
  await assert.rejects(apply('plan.move', params, h.io, { ctx: h.ctx() }), (e) => e.code === 'PREVIEW_REQUIRED');
  const shown = preview('plan.move', params, h.ctx());
  // the data changes after the preview was shown (another write) → the shown token no longer fits
  await run(h, 'plan.move', { moves: [{ issue: s.key, weeks: 1 }] });
  const n = h.io.calls.length;
  await assert.rejects(apply('plan.move', params, h.io, { ctx: h.ctx(), token: shown.token }), (e) => e.code === 'STALE_PREVIEW');
  assert.equal(h.io.calls.length, n, 'nothing sent');
  assert.equal(patchFor('plan.apply', { moves: [{ issueId: 'x', start: '2026-01-01' }] }, { results: [{ issueId: 'x', ok: false }] }), null, 'a failed item is not patched');
});

test('a whole workflow through the io: the screen and the server agree after apply and after undo', async () => {
  const h = harness();
  let s = start({ id: 'fillGaps', params: {} }, h.ctx());
  for (let g = 0; g < 40 && s.status !== 'done'; g++) {
    const cur = current(s);
    if (cur.kind === 'story' || cur.kind === 'summary') s = next(s);
    else if (cur.kind === 'decide') s = answer(s, cur.id, 'all', h.ctx());
    else if (cur.kind === 'preview') s = answer(s, cur.id, 'apply');
    else if (cur.kind === 'command') s = await applyStep(s, h.io);
  }
  assert.equal(s.status, 'done');
  const applied = s.steps.filter((x) => x.kind === 'command' && x.status === 'applied');
  assert.ok(applied.length >= 1);
  const touched = applied.flatMap((x) => x.params.items.map((i) => i.issue));
  for (const id of touched) assert.equal(issueOf(h.app.ds, id).oe ?? 0, issueOf(h.backend.ds, id).oe ?? 0);
  for (const x of [...applied].reverse()) await x.undo.run(h.io);
  for (const id of touched) assert.deepEqual([issueOf(h.backend.ds, id).oe || 0, issueOf(h.backend.ds, id).team?.id ?? null], [issueOf(h.d, id).oe || 0, issueOf(h.d, id).team?.id ?? null]);
});

test('re-preview: changed data marks the aggregated preview stale; replaying the answers plans a fresh one', async () => {
  const h = harness();
  let s = start({ id: 'fixConflicts', params: {} }, h.ctx());
  s = next(s);
  let cur = current(s);
  assert.equal(cur.kind, 'decide');
  s = answer(s, cur.id, 'all', h.ctx());
  cur = current(s);
  assert.equal(cur.kind, 'preview');
  assert.deepEqual(staleItems(cur, s.steps, h.ctx(), previewCommand), [], 'same data: fresh');
  // someone moves one of the work items in between
  const mv = s.steps.find((x) => x.kind === 'command').params.moves[0];
  await run(h, 'plan.move', { moves: [{ issue: mv.issue, weeks: 3 }] });
  const stale = staleItems(cur, s.steps, h.ctx(), previewCommand);
  assert.ok(stale.length >= 1, 'the preview no longer matches the data');
  const fresh = replayAnswers(s.goal, s.answers, h.ctx(), { start, answer, next, current });
  const fc = current(fresh);
  assert.ok(fc && (fc.kind === 'preview' || fc.kind === 'decide' || fc.kind === 'summary'), 'the person sees the new state first');
  if (fc.kind === 'preview') assert.deepEqual(staleItems(fc, fresh.steps, h.ctx(), previewCommand), []);
});

test('UI helpers: grouped diff, phases and progress, report hand-over, free-text hints', () => {
  const g = groupChanges([{ kind: 'set', field: 'Team', key: 'A-1' }, { kind: 'set', field: 'Team', key: 'A-2' }, { kind: 'rank', field: 'Rang', label: 'ERP: Rang 3 → 1' }, { kind: 'move', field: 'Team', key: 'A-3' }]);
  assert.deepEqual(g.map((x) => [x.kind, x.field, x.n]), [['set', 'Team', 3], ['rank', 'Rang', 1]], 'one group per field');
  assert.equal(subjectOf({ label: 'ERP-Anbindung: Rang 3 → 1' }), 'ERP-Anbindung');
  assert.equal(subjectOf({ key: 'KPR-12' }), 'KPR-12');
  const ctx = lotseCtx('de');
  let s = start({ id: 'resolveOverload', params: { team: 't-ux' } }, ctx);
  s = next(s);
  const ph = phasesOf(s);
  assert.deepEqual(ph.map((p) => p.kind).slice(0, 2), ['story', 'decide']);
  assert.ok(ph.find((p) => p.kind === 'decide').current && ph.find((p) => p.kind === 'story').complete);
  assert.deepEqual(progressOf(s), { done: 0, total: 1 });
  assert.deepEqual(composerParams({ audience: 'board', sections: ['portfolio', 'risks', 'milestones'], period: 'nextQuarter' }), { audience: 'c-level', period: 'next', sections: ['summary', 'kpis', 'portfolio', 'risks', 'blockers', 'late'] });
  assert.equal(composerParams({ audience: 'teamLeads', sections: ['waterline'], period: 'last4Weeks' }).audience, 'team');
  for (const k of ['text', 'hours', 'date', 'team', 'tshirt', 'quarters']) assert.ok(FREE_HINT[k]?.[0] && FREE_HINT[k]?.[1], k);
});

test('the gallery has exactly the built-in jobs; every command and workflow counts as an allowed usage event', () => {
  assert.deepEqual(JOBS.map((j) => j.id).sort(), [...WORKFLOW_IDS].sort());
  for (const j of JOBS) assert.ok(j.title[0] && j.title[1] && j.line[0] && j.line[1] && j.icon && j.minutes > 0, j.id);
  for (const id of COMMAND_IDS) { assert.ok(ACTION_KIND[id], id); assert.ok(isUsageEvent(`lotse:action:${actionKind(id)}`), id); }
  for (const id of WORKFLOW_IDS) for (const e of ['start', 'done', 'cancel']) assert.ok(isUsageEvent(`lotse:workflow:${id}:${e}`), `${id}:${e}`);
  assert.ok(isUsageEvent('undo'));
});
