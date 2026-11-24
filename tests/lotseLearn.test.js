// "LLM teaches Lotse" (shared/lotse/learn.js, src/lib/learn.js): only the masked phrase pattern is kept – no names, keys,
// numbers or people –, at most 500 per site; admins approve / reject (with undo); approved patterns route Lotse for
// everyone (understand() via ctx.learned).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patternOf, learnedSkill, addCandidate, reviewCandidate, approvedOnly, validCandidate, LEARN_MAX, skillOfCard, CARD_SKILL } from '../shared/lotse/learn.js';
import { understand, ask } from '../shared/lotse/index.js';
import { WISH_IDS } from '../shared/wishCatalog.js';
import { learnFromAi, listLearned, reviewLearned, LEARN_KEY } from '../src/lib/learn.js';
import { lotseCtx } from './lotseFixture.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const de = lotseCtx('de');
const memStore = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); } }; };

test('the pattern carries no data: names of projects, teams and people, keys, numbers and quarters are masked', () => {
  const p = patternOf('Ich will wissen, wie viel Luft Team Web und Anna Becker bei Kundenportal Relaunch (KPR-118) im Q1 2027 noch haben – 40 h?', de);
  assert.doesNotMatch(p, /web|anna|becker|kundenportal|relaunch|kpr|118|2027|40/i, p);
  assert.match(p, /\{name\}/);
  assert.match(p, /\{key\}/);
  assert.match(p, /\{quarter\}/);
  assert.match(p, /^[a-z{} -]+$/, 'plain words only');
  assert.equal(patternOf('Zeig mir: wo brennt es gerade?', de), 'wo brennt es', 'filler words go too');
});

test('every card of the catalogue maps to a Lotse skill', () => {
  for (const id of WISH_IDS) assert.ok(CARD_SKILL[id], id);
  assert.equal(skillOfCard('nope'), null);
});

test('candidates: counted up, capped at 500 (approved ones are never dropped), reviewed with undo', () => {
  let list = [];
  ({ list } = addCandidate(list, { pattern: 'wo brennt es gerade', card: 'attention', skill: 'today' }, Date.parse('2026-11-10T09:00:00Z')));
  ({ list } = addCandidate(list, { pattern: 'wo brennt es gerade', card: 'attention', skill: 'today' }, Date.parse('2026-11-12T09:00:00Z')));
  assert.equal(list.length, 1);
  assert.equal(list[0].n, 2);
  assert.equal(list[0].status, 'pending');
  assert.deepEqual(Object.keys(list[0]).sort(), ['card', 'first', 'id', 'last', 'n', 'pattern', 'skill', 'status'], 'nothing else is stored – no account, no name');
  const r = reviewCandidate(list, { id: list[0].id, decision: 'approve' }, Date.parse('2026-11-12T10:00:00Z'));
  assert.equal(r.item.status, 'approved');
  assert.equal(r.previous, 'pending');
  const back = reviewCandidate(r.list, { id: list[0].id, decision: r.previous });
  assert.equal(back.item.status, 'pending', 'undo puts it back');
  assert.equal(back.item.reviewed, undefined);
  assert.throws(() => reviewCandidate(list, { id: 'l-x', decision: 'approve' }), /NOT_FOUND/);
  assert.throws(() => reviewCandidate(list, { id: list[0].id, decision: 'delete-all' }), /decision/);
  // cap: 500, approved survive
  let big = [{ ...validCandidate({ pattern: 'keep me please', card: 'waterline', status: 'approved', last: '2020-01-01' }) }];
  for (let i = 0; i < LEARN_MAX + 20; i++) big = addCandidate(big, { pattern: `frage nummer ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26) % 26)} x`, card: 'overtime' }, Date.parse('2026-11-12T00:00:00Z') + i).list;
  assert.equal(big.length, LEARN_MAX);
  assert.ok(big.some((x) => x.pattern === 'keep me please'));
  assert.equal(validCandidate({ pattern: 'Anna <script>', card: 'overtime' }), null, 'only plain lower-case words');
});

test('approved patterns route Lotse for everyone; pending ones do not', () => {
  const q = 'Wo hakt es gerade bei den Leuten?';
  const before = understand(q, de, {});
  const pattern = patternOf(q, de);
  const pending = [{ ...validCandidate({ pattern, card: 'blocked', skill: 'blockers' }) }];
  assert.equal(understand(q, { ...de, learned: approvedOnly(pending) }, {}).skill, before.skill, 'pending: no effect');
  const approved = approvedOnly(reviewCandidate(pending, { id: pending[0].id, decision: 'approve' }).list);
  const u = understand(q, { ...de, learned: approved }, {});
  assert.equal(u.skill, 'blockers');
  assert.equal(u.learned, true);
  assert.equal(learnedSkill('wo hakt es gerade bei den leuten', { ...de, learned: approved }).skill, 'blockers');
  assert.equal(ask(q, { ...de, learned: approved }).skill, 'blockers');
  // a different question stays where it was
  assert.notEqual(understand('Wie steht das Portfolio?', { ...de, learned: approved }, {}).skill, 'blockers');
});

test('server: learnFromAi stores only the masked pattern, never while paused; review and list as the resolvers use them', async () => {
  const st = memStore();
  const deps = { get: st.get, set: st.set, mode: () => 'off' };
  const added = await learnFromAi({ wish: 'Wie viel Luft hat Team Web noch?', card: 'realCapacity' }, { loadDs: async () => de.ds }, deps);
  assert.equal(added.pattern, 'wie viel luft hat team {name} noch');
  assert.equal(added.skill, 'realCapacity');
  assert.ok(!JSON.stringify(st.m.get(LEARN_KEY)).includes('Web'));
  assert.equal(await learnFromAi({ wish: 'Wie viel Luft hat Team Web noch?', card: 'realCapacity' }, { loadDs: async () => null }, deps), null, 'without names to mask: nothing');
  assert.equal(await learnFromAi({ wish: 'Wie viel Luft hat Team Web noch?', card: 'realCapacity' }, { loadDs: async () => de.ds }, { ...deps, mode: () => 'readonly' }), null, 'paused: nothing');
  assert.equal(await learnFromAi({ wish: 'hallo', card: 'nope' }, { loadDs: async () => de.ds }, deps), null);
  const r = await reviewLearned({ id: added.id, decision: 'approve' }, {}, deps);
  assert.equal(r.item.status, 'approved');
  assert.deepEqual((await listLearned({ admin: false }, deps)).approved.map((x) => x.pattern), [added.pattern]);
  assert.equal((await listLearned({ admin: false }, deps)).items, undefined, 'only admins see the candidates');
  assert.equal((await listLearned({ admin: true }, deps)).items.length, 1);
  await assert.rejects(() => reviewLearned({ id: '../x', decision: 'approve' }, {}, deps), /id/);
});

test('resolvers: lotse.learned (read), lotse.learn.review (admin write, audited); ai.assist learns only on lotseMissed', () => {
  const src = read('src/index.js');
  assert.match(src, /def\('lotse\.learned', async \(\{ roles \}\) => listLearned\(\{ admin: !!roles\.admin \}\)\);/);
  assert.match(src, /def\('lotse\.learn\.review', async \(\{ payload, ctx, roles \}\) => \{\n  requireRole\(roles, 'admin'\);/);
  assert.match(src, /payload\.feature === 'intent' && payload\.lotseMissed === true && r\?\.source === 'ai' && r\.card/);
  const m = read('src/lib/maintenance.js');
  assert.match(m, /'lotse\.learned'/);
  assert.doesNotMatch(m, /'lotse\.learn\.review'/);
  assert.match(read('static/cockpit/src/lib/mock.js'), /case 'lotse\.learn\.review'/);
  const lib = read('src/lib/learn.js');
  assert.doesNotMatch(lib, /accountId|displayName/, 'no person in the learning store');
});
