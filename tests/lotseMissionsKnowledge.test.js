// Lotse missions – knowledge from the past (shared/lotse/act/missionsKnowledge.js) and the playbook command:
//   learnFromPast     similar finished work → estimates (fill, optional factor correction, one by one) → risk note
//   supportPlaybooks  recurring support topics → playbooks with a standard reply (app storage only) → Support › Playbooks
// End to end on the fixture with the real server logic for playbooks (src/lib/playbooks.js on an in-memory store):
// stories valid and sourced, every number of a decision in its facts, preview before every write, undo restores all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORKFLOWS, WORKFLOW_IDS, COMMANDS, start, answer, next, applyStep, undoAll, current, unsourced, preview, apply, commandList } from '../shared/lotse/act/index.js';
import { matchWorkflows } from '../shared/lotse/act/route.js';
import { pastOf, asPlaybook } from '../shared/lotse/act/missionsKnowledge.js';
import { replyLeaks } from '../shared/lotse/act/commands.js';
import { fakeIo } from '../shared/lotse/act/fakeIo.js';
import { stable } from '../shared/lotse/act/kit.js';
import { validStory, selfCheck, understand } from '../shared/lotse/index.js';
import { validPlaybook } from '../shared/playbooks.js';
import { mockComments } from '../static/cockpit/src/lib/mockHistory.js';
import { lotseCtx, lotseDataset } from './lotseFixture.js';

const { savePlaybook, deletePlaybook, listPlaybooks } = await import('../src/lib/playbooks.js');

const fresh = (lang = 'de', over = {}) => lotseCtx(lang, { ds: lotseDataset(), ...over });
const recommended = (st) => (st.multi ? st.options.filter((o) => o.recommended && !o.disabled).map((o) => o.id) : (st.options.find((o) => o.recommended && !o.disabled) || st.options.find((o) => !o.disabled)).id);
const clone = (x) => JSON.parse(JSON.stringify(x));

// fakeIo plus the playbook resolvers exactly as the server runs them (rights, ids, previous for undo)
function pbIo(ctx, items = []) {
  const io = fakeIo(ctx.ds);
  const store = new Map([['playbooks', { items: clone(items) }]]);
  const deps = { get: async (k) => clone(store.get(k) ?? null), set: async (k, v) => { store.set(k, clone(v)); }, audit: async () => {}, now: () => '2026-11-12T10:00:00.000Z' };
  const who = { roles: ctx.roles, displayName: 'Anna Becker' };
  const base = io.call;
  io.call = async (name, p = {}) => {
    if (!name.startsWith('playbooks.')) return base(name, p);
    io.calls.push([name, clone(p)]);
    if (name === 'playbooks.list') return listPlaybooks(who, deps);
    if (name === 'playbooks.save') return savePlaybook(p, who, deps);
    if (name === 'playbooks.delete') return deletePlaybook(p, who, deps);
    throw new Error(name);
  };
  io.stored = () => store.get('playbooks').items;
  return io;
}
async function run(goal, ctx, io, script = {}) {
  let s = start(goal, ctx);
  const trail = [];
  for (let guard = 0; s.status !== 'done' && guard < 80; guard++) {
    const cur = current(s);
    trail.push(cur.kind);
    if (cur.kind === 'story' || cur.kind === 'summary') s = next(s);
    else if (cur.kind === 'decide') { const v = Object.hasOwn(script, cur.id) ? script[cur.id] : Object.entries(script).find(([k]) => k.endsWith('*') && cur.id.startsWith(k.slice(0, -1)))?.[1]; s = answer(s, cur.id, typeof v === 'function' ? v(cur) : v ?? recommended(cur)); }
    else if (cur.kind === 'preview') s = answer(s, cur.id, script[cur.id] || 'apply');
    else if (cur.kind === 'command') s = await applyStep(s, io);
  }
  return { s, trail };
}
function checkSteps(s, id) {
  for (const st of s.steps.filter((x) => x.kind === 'story')) {
    assert.doesNotThrow(() => validStory(st.story), `${id}/${st.id}`);
    assert.deepEqual(selfCheck(st.story), [], `${id}/${st.id}: ${st.story.headline}`);
  }
  assert.deepEqual(unsourced(s), [], id);
  const text = JSON.stringify(s.steps.map((x) => [x.title, x.question, x.summary, x.text, x.note, x.story?.headline, (x.story?.findings || []).map((f) => f.text), (x.options || []).map((o) => [o.label, o.detail]), (x.warnings || [])]));
  assert.ok(!/rovo/i.test(text) && !/undefined|\bNaN\b|\[object|customfield|originalEstimate|\bt-(web|ux|int|mob|data|netz)\b/.test(text), `${id}: human words only`);
  for (const [k, st] of s.steps.entries()) {
    if (st.kind !== 'command') continue;
    const pv = s.steps.slice(0, k).find((x) => x.kind === 'preview' && x.covers.includes(st.id));
    assert.ok(pv && pv.answer === 'apply', `${id}/${st.id}: previewed first`);
  }
}

test('two knowledge missions are registered, bilingual, with their command', () => {
  for (const id of ['learnFromPast', 'supportPlaybooks']) {
    assert.ok(WORKFLOW_IDS.includes(id), id);
    assert.ok(WORKFLOWS[id].title('de') && WORKFLOWS[id].title('en') && WORKFLOWS[id].title('de') !== WORKFLOWS[id].title('en'), id);
    assert.ok(WORKFLOWS[id].match.length >= 3, id);
  }
  assert.deepEqual(WORKFLOWS.learnFromPast.params, ['project']);
  assert.deepEqual(WORKFLOWS.supportPlaybooks.params, []);
  assert.equal(COMMANDS['playbook.save'].write, true);
  assert.ok(COMMANDS['playbook.save'].title('de') !== COMMANDS['playbook.save'].title('en'));
});

test('routing: task sentences start the missions, questions and drafts keep their stories', () => {
  const de = fresh('de');
  const go = {
    'Lerne aus früheren Projekten für ERP-Anbindung': ['learnFromPast', 'issue:9001'],
    'Schätze das Projekt anhand ähnlicher Projekte': ['learnFromPast', null],
    'Schätze ERP-Anbindung anhand ähnlicher Projekte': ['learnFromPast', 'issue:9001'],
    'Was haben wir aus früheren Projekten gelernt?': ['learnFromPast', null],
    'what did past projects teach us about the ERP integration?': ['learnFromPast', 'issue:9001'],
    'Learn from past projects for Mobile App 2.0': ['learnFromPast', 'issue:9003'],
    'estimate the CRM project based on similar projects': ['learnFromPast', 'issue:9007'],
    'Erstelle Playbooks für wiederkehrende Support-Themen': ['supportPlaybooks', null],
    'Lege Playbooks für die häufigsten Tickets an': ['supportPlaybooks', null],
    'Schreibe Standardantworten für wiederkehrende Tickets': ['supportPlaybooks', null],
    'create help articles / standard replies for recurring tickets': ['supportPlaybooks', null],
    'Create playbooks for recurring support topics': ['supportPlaybooks', null],
  };
  for (const [q, [wf, ref]] of Object.entries(go)) {
    assert.deepEqual(matchWorkflows(q), [wf], q);
    const u = understand(q, de, {});
    assert.equal(u.kind, 'workflow', q);
    assert.equal(u.workflow, wf, q);
    assert.equal(u.params.ref ?? null, ref, q);
  }
  // stories stay stories: questions about topics, single drafts, "estimate like before", "what helped"
  const keep = { 'Welche Support-Themen kommen immer wieder?': 'supportTopics', 'Which tickets keep coming back? We need playbooks': 'supportTopics', 'Wofür lohnt sich ein Playbook?': 'supportTopics',
    'draft a playbook': 'playbookDraft', 'write a standard reply': 'playbookDraft', 'Schätze wie früher: Export der Rechnungen als PDF': 'estimate', 'Was half damals bei Login mit SSO?': 'similarSummary' };
  for (const [q, skill] of Object.entries(keep)) {
    assert.deepEqual(matchWorkflows(q), [], q);
    assert.equal(understand(q, de, {}).skill, skill, q);
  }
  // existing jobs are not taken
  for (const [q, wf] of Object.entries({ 'Fülle die Lücken in ERP-Anbindung': 'fillGaps', 'Erstelle einen Report': 'cLevelReport', 'Bereite das Weekly vor': 'weeklyPrep', 'Arbeite den Support-Eingang ab': 'supportTriage' })) assert.deepEqual(matchWorkflows(q), [wf], q);
});

for (const lang of ['de', 'en']) {
  test(`learnFromPast end to end (${lang}): project choice, sourced story, estimates + note, preview, undo restores`, async () => {
    const ctx = fresh(lang);
    const io = pbIo(ctx);
    const before = stable(io.ds);
    const { s, trail } = await run({ id: 'learnFromPast', params: {} }, ctx, io);
    assert.equal(s.status, 'done');
    checkSteps(s, 'learnFromPast');
    assert.equal(trail[0], 'decide', 'no project named: Lotse asks which one first');
    const pd = s.steps.find((x) => x.id === 'project');
    assert.ok(pd.options.length >= 2 && pd.options[0].recommended);
    // the recommended project is the one with the most stories without an estimate
    const noEst = (ref) => ctx.ds.issues.filter((i) => i.rootRef === ref && i.role === 'estimate' && i.status.cat !== 'done' && !(i.oe > 0)).length;
    assert.ok(pd.options.every((o) => noEst(o.id) <= noEst(pd.options[0].id)));
    const story = s.steps.find((x) => x.id === 'story:past').story;
    assert.equal(story.subject.kind, 'project');
    assert.equal(story.visual.kind, 'compare', 'estimate vs. time spent per group of similar work');
    for (const r of story.visual.data.rows) assert.ok(r.a > 0 && r.b > 0 && r.unit === 'h');
    // the factor correction is never part of the default
    const what = s.steps.find((x) => x.id === 'what');
    assert.ok(!what.options.find((o) => o.id === 'correct').recommended);
    assert.ok(Array.isArray(what.answer) && what.answer.includes('fill') && !what.answer.includes('correct'));
    // writes: the estimates (issue.fill) – and the lesson note (health.set) when chosen
    const fill = s.steps.find((x) => x.id === 'cmd:fill');
    assert.equal(fill.status, 'applied');
    assert.equal(fill.params.field, 'estimate');
    const filled = io.calls.filter(([n, p]) => n === 'issue.fill' && p.usage === 'originalEstimate');
    assert.equal(filled.length, fill.params.items.length);
    for (const x of fill.params.items) assert.ok(io.ds.issues.find((i) => i.id === x.issue).oe === x.value);
    const note = s.steps.find((x) => x.id === 'note');
    if (note?.answer === 'note') { assert.ok(io.calls.some(([n]) => n === 'health.set')); assert.ok(note.draft.comment.length <= 280); }
    assert.ok(!io.calls.some(([n]) => n.startsWith('playbooks.')));
    const u = await undoAll(s, io);
    assert.ok(!u.undoFailed);
    assert.equal(stable(io.ds), before, 'undoAll restores the data');
  });
}

test('learnFromPast one by one: own hours win, a skipped story stays empty; the factor correction only when chosen', async () => {
  const ctx = fresh('de');
  const ref = 'issue:9003';
  const x = pastOf(ctx, ref);
  assert.ok(x.sugg.length >= 3 && x.corr.length >= 1, 'the fixture has both');
  const io = pbIo(ctx);
  let n = 0;
  const { s } = await run({ id: 'learnFromPast', params: { ref } }, ctx, io, {
    what: ['fill', 'correct'], how: 'one', note: 'no',
    'est:*': (st) => { n++; assert.equal(st.freeText.kind, 'hours'); assert.ok(st.issue.key && st.question.includes(st.issue.key)); return n === 1 ? { option: 'accept', text: '12,5 h' } : n === 2 ? 'skip' : 'accept'; },
  });
  checkSteps(s, 'learnFromPast/one');
  const fill = s.steps.find((y) => y.id === 'cmd:fill');
  const firstId = s.steps.find((y) => y.id.startsWith('est:')).id.slice(4);
  const secondId = s.steps.filter((y) => y.id.startsWith('est:'))[1].id.slice(4);
  assert.equal(fill.params.items.find((y) => y.issue === firstId).value, 12.5, 'the own value replaces the suggestion');
  assert.ok(!fill.params.items.some((y) => y.issue === secondId), 'a left-out story is not written');
  assert.equal(io.ds.issues.find((i) => i.id === secondId).oe, 0);
  // the correction: existing estimates of stories not started × the team factor
  const corr = s.steps.find((y) => y.id === 'cmd:correct');
  assert.equal(corr.status, 'applied');
  for (const y of corr.params.items) {
    const c = x.corr.find((z) => z.issue.id === y.issue);
    assert.ok(c && c.issue.status.cat === 'new' && y.value === c.value && Math.abs(c.value - Math.round(c.from * c.f.factor * 4) / 4) < 1e-9);
  }
  assert.ok(!s.steps.some((y) => y.id === 'cmd:note'));
});

test('learnFromPast with thin history: says so plainly, still backs estimates with siblings', async () => {
  const ds = lotseDataset();
  let k = 0;
  for (const i of ds.issues) if (i.role === 'estimate' && i.status.cat === 'done' && k++ >= 5) i.status = { name: 'In Arbeit', cat: 'indeterminate' };
  for (const lang of ['de', 'en']) {
    const ctx = lotseCtx(lang, { ds, history: null });
    const x = pastOf(ctx, 'issue:9003');
    assert.ok(x.thin && x.poolSize <= 5, `pool ${x.poolSize}`);
    let s = start({ id: 'learnFromPast', params: { ref: 'issue:9003' } }, ctx);
    const story = current(s).story;
    assert.doesNotThrow(() => validStory(story));
    assert.deepEqual(selfCheck(story), []);
    assert.equal(story.confidence, 'low');
    assert.match(story.headline, lang === 'de' ? /nur \d+ erledigte/ : /only \d+ finished/);
    assert.ok(story.findings.some((f) => f.tone === 'warn' && (lang === 'de' ? /Dünne Vergangenheit/ : /Thin history/).test(f.text)));
    assert.ok(x.sugg.some((y) => y.sug.basis === 'siblings'), 'siblings help out');
    s = next(s);
    assert.deepEqual(unsourced(s), []);
  }
});

test('learnFromPast reads the comments of the similar work: recurring words with the work items they come from', () => {
  const ctx0 = fresh('de');
  const x0 = pastOf(ctx0, 'issue:9001');
  const comments = mockComments(x0.past.map((y) => y.id), { texts: true });
  const ctx = fresh('de', { comments });
  const x = pastOf(ctx, 'issue:9001');
  assert.ok(x.kws.length >= 1 && x.texted >= 2);
  const keys = new Set(x.past.map((y) => y.key));
  for (const k of x.kws) { assert.ok(k.n >= 1 && k.keys.length >= 1); for (const key of k.keys) assert.ok(keys.has(key)); }
  const s = start({ id: 'learnFromPast', params: { ref: 'issue:9001' } }, ctx);
  const story = current(s).story;
  const f = story.findings.find((y) => /Kommentaren dieser Arbeit/.test(y.text));
  assert.ok(f, 'a finding on the comments');
  assert.ok(f.evidence.some((e) => e.key && keys.has(e.key)), 'the issue keys as evidence');
  assert.deepEqual(selfCheck(story), []);
  assert.ok(story.sources.includes('Kommentare'));
  // without texts: only the counts, said as such – never invented words
  const plain = pastOf(fresh('de'), 'issue:9001');
  assert.equal(plain.kws.length, 0);
});

for (const lang of ['de', 'en']) {
  test(`supportPlaybooks end to end (${lang}): topics, drafts, playbook.save in app storage, Support › Playbooks, undo deletes`, async () => {
    const ctx = fresh(lang);
    const io = pbIo(ctx);
    const before = stable(io.ds);
    const { s } = await run({ id: 'supportPlaybooks', params: {} }, ctx, io);
    assert.equal(s.status, 'done');
    checkSteps(s, 'supportPlaybooks');
    const story = s.steps.find((x) => x.id === 'story:topics').story;
    assert.equal(story.visual.kind, 'bars');
    const topics = s.steps.find((x) => x.id === 'topics');
    assert.ok(topics.multi && topics.options.length >= 3 && topics.options.at(-1).id === 'nothing');
    const chosen = topics.answer;
    assert.ok(chosen.length >= 1);
    for (const id of chosen) {
      const d = s.steps.find((x) => x.id === `pb:${id}`);
      assert.ok(d.draft.reply && d.draft.steps.length >= 3 && d.freeText?.kind === 'text');
      assert.ok(!replyLeaks(d.draft.reply), 'the standard reply carries no internal figures');
    }
    const cmd = s.steps.find((x) => x.id === 'cmd:playbooks');
    assert.equal(cmd.status, 'applied');
    assert.equal(cmd.result.applied, chosen.length);
    const stored = io.stored();
    assert.equal(stored.length, chosen.length);
    for (const pb of stored) {
      assert.deepEqual(validPlaybook(pb, pb), { ...validPlaybook(pb, pb) });
      assert.ok(chosen.includes(pb.topic) && pb.reply && pb.steps.length && pb.source === 'rule' && /^pb-/.test(pb.id));
    }
    // nothing goes to Jira: only playbooks.* (and no write resolver of the dataset)
    assert.deepEqual([...new Set(io.calls.map(([n]) => n))].sort(), ['playbooks.list', 'playbooks.save']);
    const open = s.steps.find((x) => x.id === 'cmd:open');
    assert.deepEqual(open.result.navigate, { view: 'support', opts: { tab: 'playbooks' } });
    const u = await undoAll(s, io);
    assert.ok(!u.undoFailed);
    assert.equal(io.stored().length, 0, 'undo deletes the created playbooks');
    assert.equal(stable(io.ds), before);
  });
}

test('supportPlaybooks: own words fill the fix; existing playbooks are shown, not offered, and never overwritten', async () => {
  const ctx0 = fresh('de');
  // 1) the proven fix in one sentence goes into the steps and the customer reply
  const io0 = pbIo(ctx0);
  let first = null;
  const { s: s0 } = await run({ id: 'supportPlaybooks' }, ctx0, io0, { topics: (st) => [st.options[0].id], 'pb:*': (st) => { first = st.id.slice(3); return { option: 'accept', text: 'Self-Service-Link „Passwort vergessen“ schicken.' }; } });
  const pb = io0.stored()[0];
  assert.equal(pb.topic, first);
  assert.ok(pb.steps.some((x) => x.includes('Bewährte Lösung: Self-Service-Link')));
  assert.ok(pb.reply.includes('Self-Service-Link') && !pb.reply.includes('[kurzer Schritt für den Kunden]'));
  checkSteps(s0, 'supportPlaybooks/own');
  // 2) with the stored playbooks in ctx: the covered topic is counted in the story and not offered again
  const ctx = fresh('de', { playbooks: { items: io0.stored() } });
  let s = start('supportPlaybooks', ctx);
  const story = current(s).story;
  assert.ok(story.kpis.some((k) => k.id === 'covered' && k.value === 1));
  assert.deepEqual(selfCheck(story), []);
  s = next(s);
  assert.ok(!current(s).options.some((o) => o.id === first), 'a topic with a playbook is not offered');
  assert.deepEqual(unsourced(s), []);
  // 3) the command itself: a topic with a playbook is skipped in the preview and – if one appeared since – at apply time
  const item = asPlaybook('de', { id: first, name: pb.topicName }, { draft: { title: pb.title, symptoms: pb.symptoms, steps: pb.steps, reply: pb.reply }, keys: pb.keys });
  const pv = preview('playbook.save', { items: [item] }, ctx);
  assert.equal(pv.count, 0);
  assert.ok(pv.blocked && pv.warnings.some((w) => /schon ein Playbook/.test(w)));
  const io = pbIo(ctx0, io0.stored());
  const pv2 = preview('playbook.save', { items: [item] }, ctx0); // ctx without playbooks: the preview cannot know
  assert.equal(pv2.count, 1);
  const done = await apply('playbook.save', { items: [item] }, io, { ctx: ctx0, token: pv2.token });
  assert.equal(done.applied, 0);
  assert.equal(done.failed, 1);
  assert.equal(done.errors[0].code, 'EXISTS');
  assert.equal(io.stored().length, 1, 'nothing overwritten, nothing doubled');
});

test('playbook.save: validation, rights as the server, preview token, exact undo', async () => {
  const ctx = fresh('de');
  const good = { topic: 't:vpn', topicName: 'VPN', title: 'Playbook: VPN', symptoms: ['VPN bricht ab'], steps: ['Client neu starten'], reply: 'Hallo,\n\nbitte starte den VPN-Client neu.\n\nViele Grüße', keys: ['SUP-1001'] };
  const BAD = [{}, { items: [] }, { items: [{ ...good, title: '' }] }, { items: [{ ...good, reply: '' }] }, { items: [{ ...good, steps: [] }] }, { items: [{ ...good, reply: 'x'.repeat(1501) }] },
    { items: [{ ...good, steps: Array(11).fill('a') }] }, { items: [good, good] }, { items: Array(21).fill(good).map((x, i) => ({ ...x, topic: `t:x${i}` })) }, { items: [{ ...good, topic: 'not a topic!' }] }];
  for (const p of BAD) assert.throws(() => preview('playbook.save', p, ctx), (e) => e.code === 'INVALID', JSON.stringify(p).slice(0, 80));
  // rights: the support area plus dispatch or capacities (or admin) – mirrored from src/lib/playbooks.js
  const viewer = fresh('de', { roles: { rights: ['support'] } });
  const pvV = preview('playbook.save', { items: [good] }, viewer);
  assert.ok(pvV.noAccess && pvV.blocked && !pvV.token);
  await assert.rejects(() => apply('playbook.save', { items: [good] }, pbIo(viewer), { ctx: viewer, token: 'x' }), (e) => e.code === 'NO_ACCESS');
  assert.equal(commandList(viewer).find((x) => x.id === 'playbook.save').allowed, false);
  const disp = fresh('de', { roles: { dispatch: true, rights: ['support'] } });
  assert.equal(preview('playbook.save', { items: [good] }, disp).noAccess, false);
  assert.equal(commandList(disp).find((x) => x.id === 'playbook.save').allowed, true);
  // a viewer gets the story and an honest summary, no decision
  const vs = start('supportPlaybooks', viewer);
  assert.ok(!vs.steps.some((x) => x.kind === 'decide'));
  assert.ok(/Playbooks anlegen darf/.test(vs.steps.find((x) => x.kind === 'summary').note));
  // internal figures in a reply are flagged in the preview
  const leak = preview('playbook.save', { items: [{ ...good, reply: 'Hallo, das kam schon 12 Tickets lang vor (SUP-1001), 3 h Aufwand.' }] }, ctx);
  assert.ok(leak.warnings.some((w) => /interne Angaben/.test(w)));
  // without the preview token nothing is written; with it: saved, and undo deletes exactly that playbook
  const io = pbIo(ctx);
  await assert.rejects(() => apply('playbook.save', { items: [good] }, io, { ctx }), (e) => e.code === 'PREVIEW_REQUIRED');
  const pv = preview('playbook.save', { items: [good] }, ctx);
  const d = await apply('playbook.save', { items: [good] }, io, { ctx, token: pv.token });
  assert.equal(d.applied, 1);
  assert.equal(io.stored().length, 1);
  await d.run(io);
  assert.equal(io.stored().length, 0);
  // an update of a named playbook: undo saves the previous version back
  const io2 = pbIo(ctx, [{ ...validPlaybook(good), id: 'pb-abcdef12', createdAt: '2026-11-01T08:00:00.000Z' }]);
  const upd = { ...good, id: 'pb-abcdef12', reply: 'Hallo,\n\nneue Antwort.\n\nViele Grüße' };
  const d2 = await apply('playbook.save', { items: [upd] }, io2, { ctx, token: preview('playbook.save', { items: [upd] }, ctx).token });
  assert.equal(io2.stored()[0].reply, upd.reply);
  await d2.run(io2);
  assert.equal(io2.stored()[0].reply, good.reply);
  assert.equal(io2.stored()[0].id, 'pb-abcdef12');
});

test('no support tickets / no project data: honest info, nothing invented', () => {
  const ds = lotseDataset();
  ds.supportTickets = { truncated: false, tickets: [] };
  const ctx = lotseCtx('de', { ds, history: null });
  const s = start('supportPlaybooks', ctx);
  assert.ok(!s.steps.some((x) => x.kind === 'decide'));
  const st = s.steps.find((x) => x.kind === 'story').story;
  assert.equal(st.tone, 'info');
  assert.match(st.headline, /keine Support-Tickets/);
  assert.doesNotThrow(() => validStory(st));
});
