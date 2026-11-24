// Lotse acts – the command registry: validation, rights (viewer refused, admin bypass), previews computed from the
// dataset, the exact resolver payloads, undo back to the very same data, and the preview-token rule (no write without
// the preview of the same params and data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, COMMAND_IDS, preview, apply, commandList, ActError } from '../shared/lotse/act/index.js';
import { fakeIo } from '../shared/lotse/act/fakeIo.js';
import { stable } from '../shared/lotse/act/kit.js';
import { shiftDates } from '../shared/weekPlan.js';
import { computeAll } from '../shared/engine.js';
import { lotseCtx, lotseDataset } from './lotseFixture.js';

const de = lotseCtx('de');
const en = { ...de, lang: 'en' };
const { model } = de.computed;
const ds = de.ds;
const viewer = { ...de, me: { id: 'u2', name: 'Jonas Weber' }, roles: { rights: ['mine'] } };
const ref = (name) => model.items.find((x) => x.name === name).ref;
const iss = (key) => ds.issues.find((i) => i.key === key);
const openStory = (f) => ds.issues.filter((i) => i.role === 'estimate' && i.status.cat !== 'done' && f(i));
// a ctx over a dataset copy (so a fake server's writes can be compared with it)
const ctxOf = (d, over = {}) => ({ ...de, ds: d, computed: computeAll(d), ...over });

// one sample per command: params, what the server must receive, and how to check the undo
const KPR = ref('Kundenportal Relaunch');
const story = openStory((i) => i.start && i.due && i.assignee && i.team)[0];
const noEst = openStory((i) => !(i.oe > 0) && i.rootRef === KPR);
const ticket = ds.supportTickets.tickets.find((t) => t.statusCat !== 'done' && t.team?.id !== 't-web');
const pair = (() => { const a = openStory((i) => i.due)[0]; const b = openStory((i) => i.start && i.id !== a.id && !a.links.some((l) => l.otherId === i.id))[1]; return [a, b]; })();
const myCell = (() => { const i = openStory((x) => x.assignee?.id === 'u1')[0]; return { issue: i.key, date: '2026-11-12', hours: 1.5, id: i.id }; })();
const SAMPLES = {
  'rank.set': { params: { ref: model.items[4].ref, toRank: 1 }, call: 'portfolio.reorder' },
  'rank.reorder': { params: { order: [...model.items].reverse().map((x) => x.ref) }, call: 'portfolio.reorder' },
  'issue.setField': { params: { issue: story.key, field: 'estimate', value: 99 }, call: 'issue.fill', payload: { issueId: story.id, usage: 'originalEstimate', value: 99 } },
  'issue.bulkFill': { params: { field: 'estimate', value: 8, filter: { project: KPR, missing: 'estimate' } }, call: 'issue.fill' },
  'plan.move': { params: { moves: [{ issue: story.key, weeks: 1 }] }, call: 'plan.apply', payload: { moves: [{ issueId: story.id, ...shiftDates({ start: story.start, due: story.due }, 1) }] } },
  'plan.applyOptimizer': { params: { mode: 'rebalance', team: 't-ux' }, call: 'plan.apply' },
  'health.set': { params: { ref: KPR, status: 'atRisk', comment: 'Zwei Stories hängen an der Freigabe.' }, call: 'health.set', payload: { ref: KPR, status: 'atRisk', comment: 'Zwei Stories hängen an der Freigabe.' } },
  'dispatch.assign': { params: { items: [{ ticket: ticket.key, teamId: 't-web', accountId: 'u2' }] }, call: 'support.dispatch', payload: { items: [{ issueId: ticket.id, teamId: 't-web', accountId: 'u2' }] } },
  'support.reserve': { params: { teamId: 't-web', hours: 12 }, call: 'support.reserve', payload: { teamId: 't-web', hours: 12, teamName: 'Web' } },
  'deps.link': { params: { pre: pair[0].key, dep: pair[1].key }, call: 'deps.link', payload: { preId: pair[0].id, depId: pair[1].id } },
  'booking.book': { params: { items: [{ issue: myCell.issue, date: myCell.date, hours: myCell.hours }] }, call: 'mine.book', payload: { issueId: myCell.id, date: myCell.date, hours: 1.5 } },
  'capacity.setHours': { params: { person: 'u2', weeklyHours: 32 }, call: 'capacity.save' },
};

test(`registry: ${COMMAND_IDS.length} commands, each with DE/EN title, params doc and a guarded apply`, () => {
  const want = ['rank.set', 'rank.reorder', 'issue.setField', 'issue.bulkFill', 'plan.move', 'plan.applyOptimizer', 'health.set', 'dispatch.assign', 'support.reserve', 'deps.link', 'deps.unlink', 'booking.book', 'notice.remind', 'capacity.setHours', 'capacity.closure', 'capacity.setShares', 'report.compose', 'navigate', 'playbook.save', 'doc.pdf', 'doc.chain'];
  assert.deepEqual([...COMMAND_IDS].sort(), [...want].sort());
  for (const id of COMMAND_IDS) {
    const c = COMMANDS[id];
    assert.ok(c.title('de') && c.title('en') && c.title('de') !== '' && typeof c.params === 'string', id);
    assert.equal(typeof c.preview, 'function');
    assert.equal(typeof c.apply, 'function');
  }
  assert.equal(COMMANDS.navigate.write, false);
  assert.equal(COMMANDS['report.compose'].write, false);
});

test('validation: bad params are refused with INVALID before anything is computed or sent', () => {
  const BAD = [
    ['rank.set', { ref: KPR, toRank: 0 }], ['rank.set', { ref: 'issue:1', toRank: 1 }], ['rank.reorder', { order: [KPR] }],
    ['issue.setField', { issue: story.key, field: 'customfield_10001', value: 't-web' }], ['issue.setField', { issue: 'NOPE-1', field: 'team', value: 't-web' }],
    ['issue.setField', { issue: story.key, field: 'team', value: 'no-such-team' }], ['issue.setField', { issue: story.key, field: 'estimate', value: -3 }],
    ['issue.setField', { issue: story.key, field: 'due', value: '2026-13-40' }], ['issue.setField', { issue: story.key, field: 'tshirt', value: 'XXXL' }],
    ['issue.bulkFill', { field: 'estimate', value: 8, filter: {} }], ['issue.bulkFill', { field: 'estimate', value: 8 }], ['issue.bulkFill', { field: 'team', value: 't-web', filter: { project: 'issue:1' } }],
    ['plan.move', { moves: [{ issue: story.key, weeks: 0 }] }], ['plan.move', { moves: [{ issue: story.key }] }], ['plan.move', { filter: { assignee: 'u1' }, weeks: 60 }],
    ['plan.applyOptimizer', { mode: 'fastest' }], ['health.set', { ref: KPR, status: 'green', comment: 'x' }], ['health.set', { ref: KPR, status: 'onTrack', comment: '' }],
    ['health.set', { ref: KPR, status: 'onTrack', comment: 'x'.repeat(281) }], ['dispatch.assign', { items: [{ ticket: 'SUP-1', teamId: 't-web' }] }], ['dispatch.assign', { items: [{ ticket: ticket.key }] }],
    ['support.reserve', { teamId: 't-web', hours: 100 }], ['support.reserve', { teamId: 'nope', hours: 4 }], ['deps.link', { pre: story.key, dep: story.key }],
    ['booking.book', { items: [{ issue: myCell.issue, date: '2026-12-01', hours: 1 }] }], ['booking.book', { items: [{ issue: myCell.issue, date: myCell.date, hours: 0.3 }] }],
    ['booking.book', { items: [{ issue: myCell.issue, date: myCell.date, hours: 1 }], person: 'u2' }], ['notice.remind', { kind: 'spam', people: ['u2'] }], ['notice.remind', { kind: 'booking', people: [] }],
    ['capacity.setHours', { person: 'u2', weeklyHours: 90 }], ['capacity.setHours', { person: 'u2' }], ['report.compose', { audience: 'press', sections: ['portfolio'], period: 'currentQuarter' }],
    ['report.compose', { audience: 'board', sections: [], period: 'currentQuarter' }], ['navigate', { view: 'admin-secrets' }],
  ];
  for (const [id, p] of BAD) {
    assert.throws(() => preview(id, p, de), (e) => e instanceof ActError && (e.code === 'INVALID' || e.code === 'NO_ACCESS'), `${id} ${JSON.stringify(p)}`);
  }
  assert.throws(() => preview('nope.cmd', {}, de), (e) => e.code === 'UNKNOWN_COMMAND');
});

test('rights: a viewer is refused every write except booking own time; Jira admins pass where the server lets them', async () => {
  const writes = Object.keys(SAMPLES).filter((id) => id !== 'booking.book');
  for (const id of writes) {
    const pv = preview(id, SAMPLES[id].params, viewer);
    assert.ok(pv.blocked && pv.noAccess && pv.token === null, `${id} blocked for a viewer`);
    const io = fakeIo(ds, { me: 'u2' });
    await assert.rejects(apply(id, SAMPLES[id].params, io, { ctx: viewer, token: 'x' }), (e) => e.code === 'NO_ACCESS', id);
    assert.equal(io.calls.length, 0, `${id}: nothing sent`);
  }
  for (const [id, p] of [['report.compose', { audience: 'board', sections: ['portfolio'], period: 'currentQuarter' }], ['notice.remind', { kind: 'booking', people: ['u3'] }]]) assert.ok(preview(id, p, viewer).noAccess, id);
  // own time: allowed for everybody signed in, never for somebody else
  const vb = preview('booking.book', { items: [{ issue: myCell.issue, date: myCell.date, hours: 1 }] }, viewer);
  assert.equal(vb.blocked, null);
  assert.ok(preview('booking.book', { items: [{ issue: myCell.issue, date: myCell.date, hours: 1 }] }, { ...viewer, me: null }).blocked);
  // the owner may set the health of their own project without any group right
  const owner = { ...viewer, me: { id: 'u1' } };
  assert.equal(preview('health.set', SAMPLES['health.set'].params, owner).blocked, null);
  // admin bypass: a Jira admin without the mapped flags may rank, plan, dispatch and maintain capacity (the server grants
  // admins every action right)
  const admin = { ...viewer, roles: { admin: true, rights: ['mine'] } };
  for (const id of ['rank.set', 'plan.move', 'dispatch.assign', 'support.reserve', 'capacity.setHours', 'health.set']) assert.equal(preview(id, SAMPLES[id].params, admin).noAccess, false, id);
  // the palette
  const v = Object.fromEntries(commandList(viewer).map((x) => [x.id, x.allowed]));
  assert.equal(v['rank.set'], false); assert.equal(v['plan.move'], false); assert.equal(v['booking.book'], true); assert.equal(v.navigate, true);
  assert.ok(commandList(de).every((x) => x.allowed));
});

test('previews are computed from the dataset: every change, counted in full, with totals', () => {
  // rank.set: exactly the projects between the old and the new rank shift
  const p5 = model.items[4];
  const r = preview('rank.set', { ref: p5.ref, toRank: 1 }, de);
  assert.equal(r.count, 5);
  assert.deepEqual(r.changes.find((c) => c.ref === p5.ref) && [r.changes.find((c) => c.ref === p5.ref).fromValue, r.changes.find((c) => c.ref === p5.ref).toValue], [5, 1]);
  assert.ok(model.items.slice(0, 4).every((x) => r.changes.some((c) => c.ref === x.ref && c.toValue === x.rank + 1)));
  // bulk fill: the same work items an independent filter finds; total hours
  const b = preview('issue.bulkFill', SAMPLES['issue.bulkFill'].params, de);
  assert.equal(b.count, noEst.length);
  assert.deepEqual(b.changes.map((c) => c.key).sort(), noEst.map((i) => i.key).sort());
  assert.equal(b.totals.hours, noEst.length * 8);
  assert.ok(b.changes.every((c) => c.fromValue === null && c.toValue === 8));
  // a filter that matches more than is shown: all counted, the list capped
  const many = preview('issue.bulkFill', { field: 'tshirt', value: 'M', filter: { level: 'story', status: 'all' } }, de);
  assert.equal(many.count, Math.min(200, ds.issues.filter((i) => i.role === 'estimate' && !i.tshirt).length));
  assert.ok(many.changes.length <= 40 && many.more === many.count - many.changes.length);
  // plan.move by filter: Anna's open stories touching ISO week 48, one week later, dates as the board shifts them
  const mv = preview('plan.move', { filter: { assignee: 'u1', week: '2026-W48' }, weeks: 1 }, de);
  const annas = openStory((i) => i.assignee?.id === 'u1' && (i.start || i.due) && i.start <= '2026-11-29' && (i.due || i.start) >= '2026-11-23');
  assert.equal(mv.totals.items, annas.length);
  for (const i of annas) { const s = shiftDates({ start: i.start, due: i.due }, 1); assert.ok(mv.changes.some((c) => c.key === i.key && c.toValue === s.due), i.key); }
  // health: from today's status to the new one, with the comment
  const h = preview('health.set', SAMPLES['health.set'].params, de);
  assert.equal(h.changes[0].fromValue, model.itemByRef.get(KPR).health.status);
  assert.equal(h.changes[0].toValue, 'atRisk');
  // dispatch: team and assignee, from what the ticket has
  const d = preview('dispatch.assign', SAMPLES['dispatch.assign'].params, de);
  assert.deepEqual(d.changes.map((c) => [c.fromValue, c.toValue]), [[ticket.team?.id ?? null, 't-web'], ...(ticket.assignee?.id === 'u2' ? [] : [[ticket.assignee?.id ?? null, 'u2']])]);
  // booking: the cell's own hours before and after
  const bk = preview('booking.book', SAMPLES['booking.book'].params, de);
  assert.deepEqual([bk.changes[0].fromValue, bk.changes[0].toValue, bk.totals.hours], [0, 1.5, 1.5]);
  // dependency: a conflict is said, the link itself is the change
  const lk = preview('deps.link', SAMPLES['deps.link'].params, de);
  assert.equal(lk.count, 1);
  if (pair[0].due > pair[1].start) assert.ok(lk.warnings.some((w) => /Terminkonflikt/.test(w)));
  const existing = ds.issues.find((i) => i.links.some((l) => l.outward));
  const l0 = existing.links.find((l) => l.outward);
  assert.ok(preview('deps.link', { pre: existing.id, dep: l0.otherId }, de).blocked, 'an existing dependency is not created twice');
  // capacity and reserve: from what is stored
  assert.equal(preview('capacity.setHours', { person: 'u2', weeklyHours: 32 }, de).changes[0].fromValue, ds.capacity.people.u2.weeklyHours);
  assert.equal(preview('support.reserve', { teamId: 't-web', hours: 12 }, de).changes[0].fromValue, null);
  // nothing to change → blocked, no token
  const same = preview('issue.setField', { issue: story.key, field: 'team', value: story.team.id }, de);
  assert.ok(same.blocked && same.token === null);
});

test('apply sends exactly the resolver payloads, and undo restores the very same data', async () => {
  for (const [id, s] of Object.entries(SAMPLES)) {
    const d = lotseDataset();
    const ctx = ctxOf(d);
    const io = fakeIo(d);
    const before = stable(io.ds);
    const pv = preview(id, s.params, ctx);
    assert.ok(pv.token && !pv.blocked, `${id} previewable`);
    const done = await apply(id, s.params, io, { ctx, token: pv.token });
    const sent = io.calls.filter(([n]) => n === s.call);
    assert.ok(sent.length >= 1, `${id} → ${s.call}`);
    if (s.payload) assert.deepEqual(sent[0][1], s.payload, `${id} payload`);
    assert.equal(done.failed, 0, id);
    assert.ok(done.applied >= 1, id);
    assert.notEqual(stable(io.ds), before, `${id} changed something`);
    assert.equal(typeof done.run, 'function', `${id} has an undo`);
    assert.ok(done.label && Array.isArray(done.keys));
    await done.run(io);
    assert.equal(stable(io.ds), before, `${id}: undo restores the data exactly`);
  }
});

test('deps.unlink and partial failures: unlink by the stored link, undo links again; a failing item does not stop the rest', async () => {
  const d = lotseDataset();
  const pre = d.issues.find((i) => i.links.some((l) => l.outward));
  const l = pre.links.find((x) => x.outward);
  // the server only accepts numeric link ids – give this one a real-looking id on both ends
  for (const i of d.issues) for (const x of i.links) if (x.id === l.id) x.id = '4711';
  const ctx = ctxOf(d);
  const io = fakeIo(d);
  const pv = preview('deps.unlink', { pre: pre.key, dep: l.otherId }, ctx);
  const done = await apply('deps.unlink', { pre: pre.key, dep: l.otherId }, io, { ctx, token: pv.token });
  assert.deepEqual(io.calls[0], ['deps.unlink', { linkId: '4711', preId: pre.id, depId: l.otherId }]);
  await done.run(io);
  assert.equal(io.calls.at(-1)[0], 'deps.link');
  assert.ok(preview('deps.unlink', { pre: l.otherId, dep: pre.key }, ctx).blocked, 'the opposite direction is not a link to remove');
  // health for two projects; the second fails – the first stays applied and undoable
  const d2 = lotseDataset();
  const c2 = ctxOf(d2);
  const io2 = fakeIo(d2);
  const items = model.items.slice(0, 2).map((x) => ({ ref: x.ref, status: 'critical', comment: 'Test' }));
  const pv2 = preview('health.set', { items }, c2);
  let n = 0;
  const orig = io2.call;
  io2.call = async (name, p) => { if (name === 'health.set' && !p.restore && n++ === 1) throw Object.assign(new Error('boom'), { code: 'NO_ACCESS' }); return orig(name, p); };
  const r = await apply('health.set', { items }, io2, { ctx: c2, token: pv2.token });
  assert.deepEqual([r.applied, r.failed, r.errors[0].code], [1, 1, 'NO_ACCESS']);
  await r.run(io2);
  assert.equal(stable(io2.ds.portfolio), stable(d2.portfolio));
});

test('no write without its preview: missing, foreign, stale or blocked tokens are refused and nothing is sent', async () => {
  const id = 'issue.bulkFill';
  const p = SAMPLES[id].params;
  const pv = preview(id, p, de);
  const io = fakeIo(ds);
  await assert.rejects(apply(id, p, io, { ctx: de }), (e) => e.code === 'PREVIEW_REQUIRED');
  await assert.rejects(apply(id, p, io, { ctx: de, token: preview('rank.set', SAMPLES['rank.set'].params, de).token }), (e) => e.code === 'STALE_PREVIEW');
  // other params, same token
  await assert.rejects(apply(id, { ...p, value: 9 }, io, { ctx: de, token: pv.token }), (e) => e.code === 'STALE_PREVIEW');
  // the data changed since the preview (someone estimated one of the stories)
  const d = lotseDataset();
  d.issues.find((i) => i.id === noEst[0].id).oe = 5;
  await assert.rejects(apply(id, p, io, { ctx: ctxOf(d), token: pv.token }), (e) => e.code === 'STALE_PREVIEW');
  // blocked (notices off) – even with a token from elsewhere
  await assert.rejects(apply('notice.remind', { kind: 'booking', people: ['u2'] }, io, { ctx: de, token: pv.token }), (e) => e.code === 'BLOCKED');
  // no io
  await assert.rejects(apply(id, p, {}, { ctx: de, token: pv.token }), (e) => e.code === 'NO_IO');
  assert.equal(io.calls.length, 0, 'nothing was sent');
  // the same params in another key order give the same token (the UI may rebuild them)
  assert.equal(preview(id, { filter: { missing: 'estimate', project: KPR }, value: 8, field: 'estimate' }, de).token, pv.token);
  // a token is tied to the data: the same command on another dataset has another token
  assert.notEqual(preview(id, p, ctxOf(d)).token, pv.token);
});

test('reminders only when a Jira admin switched notices on – and they say they cannot be taken back', async () => {
  const p = { kind: 'booking', people: ['u2', 'u3'] };
  const off = preview('notice.remind', p, de);
  assert.ok(off.blocked && /Konfiguration/.test(off.blocked) && off.token === null && off.changes.length === 0);
  const d = lotseDataset();
  d.config.notices = { enabled: true, gaps: 'monday', booking: true };
  const ctx = ctxOf(d);
  const on = preview('notice.remind', p, ctx);
  assert.equal(on.blocked, null);
  assert.equal(on.count, 2);
  assert.ok(on.warnings.some((w) => /nicht zurückholen/.test(w)));
  const io = fakeIo(d);
  const r = await apply('notice.remind', p, io, { ctx, token: on.token });
  assert.deepEqual(io.calls, [['notices.remind', { kind: 'booking', accountIds: ['u2', 'u3'] }]]);
  assert.equal(r.irreversible, true);
  assert.equal(r.run, null);
});

test('report.compose and navigate write nothing: the composer hook and the view, without a token', async () => {
  const io = fakeIo(ds);
  const p = { audience: 'board', sections: ['risks', 'portfolio'], period: 'currentQuarter' };
  const r = await apply('report.compose', p, io, { ctx: de });
  assert.equal(r.open, 'reportComposer');
  assert.deepEqual(r.params, { audience: 'board', sections: ['portfolio', 'risks'], period: 'currentQuarter' });
  const n = await apply('navigate', { view: 'plan' }, io, { ctx: de });
  assert.deepEqual(n.navigate, { view: 'plan', opts: {} });
  assert.equal(io.calls.length, 0);
});

test("the app's own write paths are used when the UI passes them (state.fill / state.reorder), with their undo", async () => {
  const seen = [];
  const io = {
    call: async (n, p) => { seen.push(['call', n, p]); return { results: [] }; },
    fill: async (a) => { seen.push(['fill', a.issueId, a.usage, a.value, a.collectUndo]); return async () => seen.push(['undoFill', a.issueId]); },
    reorder: async (order, o) => { seen.push(['reorder', order.length, o.silent]); },
  };
  const pv = preview('issue.setField', SAMPLES['issue.setField'].params, de);
  const r = await apply('issue.setField', SAMPLES['issue.setField'].params, io, { ctx: de, token: pv.token });
  assert.deepEqual(seen[0], ['fill', story.id, 'originalEstimate', 99, true]);
  await r.run(io);
  assert.deepEqual(seen.at(-1), ['undoFill', story.id]);
  const rp = preview('rank.set', SAMPLES['rank.set'].params, de);
  const rr = await apply('rank.set', SAMPLES['rank.set'].params, io, { ctx: de, token: rp.token });
  assert.deepEqual(seen.at(-1), ['reorder', model.items.length, true]);
  await rr.run(io);
  assert.deepEqual(seen.at(-1), ['reorder', model.items.length, true]);
  assert.ok(!seen.some((x) => x[0] === 'call'), 'no direct resolver call when the app paths exist');
});

test('human words only: no field ids, team ids or account ids in anything the person reads – German and English', () => {
  const extra = {
    'notice.remind': { kind: 'gaps', people: ['u2'] }, 'report.compose': { audience: 'teamLeads', sections: ['support'], period: 'last4Weeks' }, navigate: { view: 'support' },
    'deps.unlink': { pre: pair[0].key, dep: pair[1].key }, 'capacity.setHours': { person: 'u3', absence: { from: '2026-12-01', to: '2026-12-05', type: 'vacation' } },
  };
  for (const ctx of [de, en]) {
    for (const [id, p] of [...Object.entries(SAMPLES).map(([k, v]) => [k, v.params]), ...Object.entries(extra)]) {
      const pv = preview(id, p, ctx);
      const text = [pv.title, pv.summary, pv.blocked || '', ...pv.warnings, ...pv.changes.flatMap((c) => [c.label, c.field, c.from, c.to])].join(' | ');
      assert.ok(!/originalEstimate|startDate|dueDate|targetQuarters|customfield|\bt-(web|ux|int|mob|data|netz)\b|\bu\d{1,2}\b|issue:\d|undefined|null|NaN|\[object/.test(text), `${ctx.lang} ${id}: ${text.slice(0, 300)}`);
      assert.ok(!/rovo/i.test(text));
    }
  }
});
