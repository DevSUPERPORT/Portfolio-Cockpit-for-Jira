// Lotse acts – workflows end to end on the fixture: every built-in job runs through story → decide → preview →
// command → summary with scripted answers (DE and EN), re-plans after each decision, writes only after its preview,
// can be cancelled, and undoAll puts the data back exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORKFLOWS, WORKFLOW_IDS, start, answer, next, applyStep, cancel, undoAll, current, planWorkflow, unsourced, ActError } from '../shared/lotse/act/index.js';
import { fakeIo } from '../shared/lotse/act/fakeIo.js';
import { stable } from '../shared/lotse/act/kit.js';
import { validStory, selfCheck } from '../shared/lotse/index.js';
import { computeAll } from '../shared/engine.js';
import { lotseCtx, lotseDataset } from './lotseFixture.js';

const fresh = (lang = 'de', over = {}) => { const ds = lotseDataset(); return lotseCtx(lang, { ds, ...over }); };
const recommended = (st) => (st.multi ? st.options.filter((o) => o.recommended && !o.disabled).map((o) => o.id) : (st.options.find((o) => o.recommended && !o.disabled) || st.options.find((o) => !o.disabled)).id);
// drive a workflow to the end; script[stepId] overrides the recommended answer (a function gets the step)
async function run(goal, ctx, io, script = {}) {
  let s = start(goal, ctx);
  const trail = [];
  for (let guard = 0; s.status !== 'done' && guard < 80; guard++) {
    const cur = current(s);
    trail.push(cur.kind);
    if (cur.kind === 'story' || cur.kind === 'summary') s = next(s);
    else if (cur.kind === 'decide') { const v = Object.hasOwn(script, cur.id) ? script[cur.id] : Object.entries(script).find(([k]) => k.endsWith('*') && cur.id.startsWith(k.slice(0, -1)))?.[1]; s = answer(s, cur.id, typeof v === 'function' ? v(cur) : v ?? recommended(cur)); }
    else if (cur.kind === 'preview') s = answer(s, cur.id, script[cur.id] || 'apply');
    else if (cur.kind === 'command') { const before = io.calls.length; s = await applyStep(s, io); assert.ok(io.calls.length >= before); }
  }
  return { s, trail };
}

const GOALS = {
  balanceWeek: {}, teamPlan: { team: 't-ux' }, learnFromPast: {}, supportPlaybooks: {}, weeklyPrep: {}, resolveOverload: { team: 't-ux' }, reRankQuarter: {}, fillGaps: {}, bookingCheck: {}, healthRound: {}, supportTriage: {}, onboardProject: {}, fixConflicts: {}, cLevelReport: {}, disruption: { period: 'week', scope: 'all' }, splitResolve: {},
  orchestrate: { text: 'Prüfe alle Arbeitswochen der Leute im Projekt Kundenportal Relaunch, pack alles in ein PDF und bereite für jeden Kollegen einen persönlichen Bericht vor' },
  chain: { text: 'Finde alle über 100 % in den nächsten 4 Wochen, plane ihre Wochen auf 100 % und gib jedem von ihnen ein PDF.' },
};

test(`${WORKFLOW_IDS.length} built-in workflows, each with DE and EN title`, () => {
  assert.deepEqual([...WORKFLOW_IDS].sort(), Object.keys(GOALS).sort());
  for (const id of WORKFLOW_IDS) { assert.ok(WORKFLOWS[id].title('de') && WORKFLOWS[id].title('en') && WORKFLOWS[id].title('de') !== WORKFLOWS[id].title('en') || id === 'cLevelReport', id); assert.ok(WORKFLOWS[id].match.length); }
});

for (const lang of ['de', 'en']) {
  test(`every workflow end to end (${lang}): stories valid and sourced, ≥ 1 real decision, preview before every write, summary, undoAll restores`, async () => {
    for (const [id, params] of Object.entries(GOALS)) {
      const ctx = fresh(lang);
      const io = fakeIo(ctx.ds);
      const before = stable(io.ds);
      const { s, trail } = await run({ id, params }, ctx, io);
      assert.equal(s.status, 'done', `${id} finished`);
      assert.ok(s.steps.some((x) => x.kind === 'decide' && x.options.filter((o) => !o.disabled).length >= 2), `${id}: a genuine decision`);
      assert.ok(trail.includes('summary'), `${id}: summary`);
      // the order: every command comes after a preview that covers it and was answered 'apply'
      for (const [k, st] of s.steps.entries()) {
        if (st.kind !== 'command') continue;
        const pv = s.steps.slice(0, k).find((x) => x.kind === 'preview' && x.covers.includes(st.id));
        assert.ok(pv && pv.answer === 'apply', `${id}/${st.id}: previewed first`);
        assert.equal(st.status, 'applied', `${id}/${st.id}: ${st.error?.code || ''}`);
      }
      // stories: valid, numbers sourced; decisions: every number in a question / option stands in its facts
      for (const st of s.steps.filter((x) => x.kind === 'story')) {
        assert.doesNotThrow(() => validStory(st.story), `${id}/${st.id}`);
        assert.deepEqual(selfCheck(st.story), [], `${id}/${st.id}: ${st.story.headline}`);
      }
      assert.deepEqual(unsourced(s), [], id);
      const text = JSON.stringify(s.steps.map((x) => [x.title, x.question, x.summary, x.text, x.note, (x.options || []).map((o) => [o.label, o.detail]), (x.warnings || [])]));
      assert.ok(!/rovo/i.test(text) && !/undefined|\bNaN\b|\[object|customfield|originalEstimate|\bt-(web|ux|int|mob|data|netz)\b/.test(text), `${id}: human words only`);
      const sum = s.steps.find((x) => x.kind === 'summary');
      assert.ok(sum.text || sum.note, `${id}: summary text`);
      // undo everything – the data is back exactly as it was
      if (s.applied.length) {
        const u = await undoAll(s, io);
        assert.ok(!u.undoFailed, id);
        assert.ok(u.steps.filter((x) => x.kind === 'command' && s.applied.includes(x.id)).every((x) => x.status === 'undone' || !x.undo), id);
        assert.equal(stable(io.ds), before, `${id}: undoAll restores the data`);
      }
    }
  });
}

test('workflows write: the resolvers the jobs need are the ones called', async () => {
  const want = { weeklyPrep: ['plan.apply', 'issue.fill'], resolveOverload: ['plan.apply'], reRankQuarter: ['portfolio.reorder'], fillGaps: ['issue.fill'], bookingCheck: ['mine.book'], healthRound: ['health.set'], supportTriage: ['support.dispatch'], onboardProject: ['issue.fill', 'plan.apply', 'health.set'], fixConflicts: ['plan.apply'], cLevelReport: [] };
  for (const [id, names] of Object.entries(want)) {
    const ctx = fresh();
    const io = fakeIo(ctx.ds);
    const { s } = await run({ id, params: GOALS[id] }, ctx, io, id === 'onboardProject' ? { project: 'issue:9002', setup: ['gaps', 'deps', 'health'] } : {});
    const called = new Set(io.calls.map(([n]) => n));
    for (const n of names) assert.ok(called.has(n), `${id} → ${n} (${[...called]})`);
    if (id === 'cLevelReport') { assert.equal(io.calls.length, 0); const cmd = s.steps.find((x) => x.command === 'report.compose'); assert.equal(cmd.result.open, 'reportComposer'); assert.deepEqual(cmd.result.params.sections, ['portfolio', 'risks', 'milestones']); }
  }
});

test('re-planning: each answer reshapes what comes next', () => {
  const ctx = fresh();
  // resolveOverload without a team: first which team, then that team's story and the "how" decision
  let s = start('resolveOverload', ctx);
  assert.equal(current(s).id, 'team');
  assert.ok(!s.steps.some((x) => x.id === 'how'), 'nothing planned past an open decision');
  const team = current(s).options[1].id;
  s = answer(s, 'team', team);
  assert.ok(s.steps.some((x) => x.id === 'how'));
  assert.equal(s.steps.find((x) => x.kind === 'story').story.subject.ref, team);
  // "accept" ends the job without a write
  s = next(s);
  s = answer(s, 'how', 'accept');
  assert.ok(!s.steps.some((x) => x.kind === 'command' || x.kind === 'preview'));
  s = next(s);
  assert.equal(s.status, 'done');
  // fillGaps one by one: a decision per gap appears only after "one", each with its own suggestion; an own value wins
  let f = next(start('fillGaps', ctx));
  f = answer(f, 'mode', 'one');
  const g1 = current(f);
  assert.ok(g1.id.startsWith('gap:') && g1.options.some((o) => o.id === 'accept') && g1.freeText);
  const est = f.steps.find((x) => x.id.startsWith('gap:') && x.freeText.kind === 'hours');
  const order = f.steps.filter((x) => x.id.startsWith('gap:'));
  assert.equal(order.length, 1, 'one gap decision at a time');
  let guard = 0;
  while (current(f).kind === 'decide' && guard++ < 10) {
    const cur = current(f);
    f = answer(f, cur.id, cur.freeText.kind === 'hours' ? { option: 'accept', text: '13 h' } : guard % 2 ? 'accept' : 'skip');
  }
  void est;
  const pv = current(f);
  assert.equal(pv.kind, 'preview');
  const estCmd = f.steps.find((x) => x.kind === 'command' && x.params.field === 'estimate');
  if (estCmd) assert.ok(estCmd.params.items.every((x) => x.value === 13), 'the own value replaces the suggestion');
  // the same goal, data and answers give the same plan
  const a = planWorkflow('fillGaps', ctx, f.answers);
  const b = planWorkflow('fillGaps', ctx, f.answers);
  assert.equal(stable(a.steps.map((x) => [x.id, x.kind, x.params])), stable(b.steps.map((x) => [x.id, x.kind, x.params])));
});

test('reRankQuarter compares 2–3 candidate orders against today, each with its sourced numbers', async () => {
  const ctx = fresh();
  let s = start('reRankQuarter', ctx);
  const story = s.steps[0].story;
  assert.equal(story.visual.kind, 'bars');
  s = next(s);
  const d = current(s);
  assert.equal(d.id, 'order');
  assert.ok(d.options.length >= 3 && d.options.length <= 4, 'today + 2–3 candidates');
  assert.ok(d.options.some((o) => o.id === 'current'));
  assert.equal(d.options.filter((o) => o.recommended).length, 1);
  for (const o of d.options) assert.ok(o.facts.length === 2 && o.order.length === ctx.computed.model.items.length);
  const other = d.options.find((o) => o.id !== 'current');
  s = answer(s, 'order', other.id);
  const cmd = s.steps.find((x) => x.kind === 'command');
  assert.equal(cmd.command, 'rank.reorder');
  assert.deepEqual(cmd.params.order, other.order.map((x) => x.ref));
  const keep = answer(next(start('reRankQuarter', ctx)), 'order', 'current');
  assert.ok(!keep.steps.some((x) => x.kind === 'command'));
});

test('nothing writes without its preview: skip, stale data, and applying out of turn', async () => {
  const ctx = fresh();
  const io = fakeIo(ctx.ds);
  let s = next(start('supportTriage', ctx));
  await assert.rejects(applyStep(s, io), (e) => e instanceof ActError && e.code === 'NOT_READY');
  s = answer(s, 'which', 'all');
  assert.equal(current(s).kind, 'preview');
  await assert.rejects(applyStep(s, io), (e) => e.code === 'NOT_READY', 'the preview must be answered first');
  // skip → the commands are skipped, nothing is sent
  const skipped = answer(s, current(s).id, 'skip');
  assert.ok(skipped.steps.filter((x) => x.kind === 'command').every((x) => x.status === 'skipped' && x.reason === 'declined'));
  assert.equal(next(skipped).status, 'done');
  assert.equal(io.calls.length, 0);
  // apply, but the data changed in between (another person dispatched a ticket) → refused, nothing written
  const ok = answer(s, current(s).id, 'apply');
  assert.equal(ok.status, 'ready');
  const d2 = structuredClone(ctx.ds);
  const t = d2.supportTickets.tickets.find((x) => x.id === ok.steps.find((y) => y.kind === 'command').params.items[0].ticket);
  t.team = { id: 't-netz', name: 'Netz' }; t.assignee = { id: 'u9', name: 'Emma Schröder', avatar: null };
  const stale = await applyStep(ok, io, { ...ctx, ds: d2, computed: computeAll(d2) });
  const cmd = stale.steps.find((x) => x.kind === 'command');
  assert.equal(cmd.status, 'failed');
  assert.equal(cmd.error.code, 'STALE_PREVIEW');
  assert.equal(io.calls.length, 0);
  // a forged token on a plan never passes either
  const forged = { ...ok, steps: ok.steps.map((x) => (x.kind === 'command' ? { ...x, token: 'deadbeefdeadbeef' } : x)) };
  Object.defineProperty(forged, 'ctx', { value: ok.ctx, enumerable: false });
  const f = await applyStep(forged, io);
  assert.equal(f.steps.find((x) => x.kind === 'command').error.code, 'STALE_PREVIEW');
  assert.equal(io.calls.length, 0);
});

test('answers are validated: unknown or disabled options, bad free text, out of turn', () => {
  const ctx = fresh();
  let s = start('weeklyPrep', ctx);
  assert.throws(() => answer(s, 'focus', ['smooth']), (e) => e.code === 'NOT_READY', 'the story comes first');
  s = next(s);
  assert.throws(() => answer(s, 'focus', ['teleport']), (e) => e.code === 'INVALID');
  assert.throws(() => answer(s, 'focus', []), (e) => e.code === 'INVALID');
  const off = current(s).options.find((o) => o.disabled);
  if (off) assert.throws(() => answer(s, 'focus', [off.id]), (e) => e.code === 'INVALID');
  // "nothing" wins over everything else
  const n = answer(s, 'focus', ['smooth', 'nothing']);
  assert.deepEqual(n.answers.focus, ['nothing']);
  assert.ok(!n.steps.some((x) => x.kind === 'command'));
  // health: a comment longer than 280 characters is refused; an own comment is used
  let h = next(start('healthRound', ctx));
  const id = current(h).id;
  assert.throws(() => answer(h, id, { option: 'atRisk', text: 'x'.repeat(281) }), (e) => e.code === 'INVALID');
  h = answer(h, id, { option: 'atRisk', text: 'Freigabe der Security fehlt noch.' });
  const cmd = h.steps.find((x) => x.kind === 'command');
  assert.deepEqual(cmd.params.items[0], { ref: id.slice(7), status: 'atRisk', comment: 'Freigabe der Security fehlt noch.' });
  // fillGaps: an estimate that is not hours is refused
  let f = answer(next(start('fillGaps', ctx)), 'mode', 'one');
  while (current(f)?.kind === 'decide' && current(f).freeText.kind !== 'hours') f = answer(f, current(f).id, 'skip');
  if (current(f)?.kind === 'decide') assert.throws(() => answer(f, current(f).id, { option: 'accept', text: 'ziemlich viel' }), (e) => e.code === 'INVALID');
});

test('cancel stops the job: nothing more is written; what was applied stays undoable', async () => {
  const ctx = fresh();
  const io = fakeIo(ctx.ds);
  const before = stable(io.ds);
  let s = next(start('weeklyPrep', ctx));
  s = answer(s, 'focus', current(s).options.filter((o) => !o.disabled && o.id !== 'nothing').map((o) => o.id));
  s = answer(s, current(s).id, 'apply');
  s = await applyStep(s, io);
  const n = io.calls.length;
  assert.ok(n > 0 && s.applied.length === 1);
  const c = cancel(s);
  assert.equal(c.status, 'cancelled');
  assert.equal(current(c), null);
  await assert.rejects(applyStep(c, io), (e) => e.code === 'NOT_READY');
  assert.throws(() => answer(c, 'focus', ['nothing']), (e) => e.code === 'NOT_READY');
  assert.equal(io.calls.length, n, 'nothing more was sent');
  const u = await undoAll(c, io);
  assert.equal(u.applied.length, 0);
  assert.equal(stable(io.ds), before);
});

test('rights and settings shape the plan: no report for a viewer, reminders only with notices on, own projects for health', async () => {
  const viewer = fresh('de', { me: { id: 'u2', name: 'Jonas Weber' }, roles: { rights: ['mine'] } });
  const r = start('cLevelReport', viewer);
  assert.ok(!r.steps.some((x) => x.kind === 'decide'));
  assert.equal(r.steps.at(-1).kind, 'summary');
  const h = start('healthRound', viewer);
  assert.ok(!h.steps.some((x) => x.kind === 'decide'), 'u2 owns no project and has no health right');
  // booking check for a team lead: the reminder is offered but switched off without notices …
  const lead = fresh();
  let b = next(start('bookingCheck', lead));
  if (current(b).id === 'book') b = answer(b, 'book', 'skip');
  const rem = current(b);
  assert.equal(rem.id, 'remind');
  assert.ok(rem.options.find((o) => o.id === 'remind').disabled);
  // … and sent (irreversible, said in the summary) once a Jira admin switched them on
  const on = fresh('de');
  on.ds.config.notices = { enabled: true, gaps: 'monday', booking: true };
  const ctxOn = { ...on, computed: computeAll(on.ds) };
  const io = fakeIo(ctxOn.ds);
  const { s } = await run('bookingCheck', ctxOn, io, { book: 'skip', remind: 'remind' });
  assert.ok(io.calls.some(([n]) => n === 'notices.remind'));
  assert.match(s.steps.find((x) => x.kind === 'summary').text, /nicht zurückholen/);
});
