// Ask boards: every role template is answerable from the data; saved boards are bounded and sanitised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAll } from '../shared/engine.js';
import { answer } from '../shared/ask.js';
import { roleBoards, boardName } from '../shared/boards.js';
import { validAsk, validBoards } from '../src/lib/askPrefs.js';
import { todayInbox } from '../shared/inbox.js';

const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url)));
const c = computeAll(structuredClone(golden));
const fmt = { pct: (v) => (v == null ? '–' : Math.round(v * 100) + ' %'), h: (v) => Math.round(v) + ' h', n: (v) => String(v), signedPct: (v) => String(v), date: (d) => String(d), quarter: (q) => q, week: (w) => w, dateTime: (d) => String(d) };

test('every question of every role board has a real analysis (DE and EN) – a board never opens with dead cards', () => {
  const owner = golden.portfolio[0].owner;
  for (const lang of ['de', 'en']) for (const me of [null, owner]) for (const b of roleBoards({ computed: c, me, lang, hasSupport: true })) {
    assert.ok(b.questions.length >= 4, b.id);
    const seen = new Set();
    for (const q of b.questions) {
      const a = answer(q, { computed: c, ds: golden, lang, fmt, ruleName: (r) => r, me, roles: { viewReport: true }, supportA: null });
      assert.ok(a && a.intent && a.intent !== 'near', `${lang} ${b.id}: "${q}" → ${a?.intent}`);
      const id = `${a.intent}|${a.title}`;
      assert.ok(!seen.has(id), `${lang} ${b.id}: "${q}" repeats the analysis "${a.title}"`); seen.add(id);
    }
  }
});

test('the fitting board is offered first: owners get theirs, ranking managers management, capacity planners the team lead board', () => {
  const owner = golden.portfolio[0].owner;
  if (owner?.id) assert.equal(roleBoards({ computed: c, me: owner })[0].id, 'owner');
  assert.equal(roleBoards({ computed: c, roles: { manageRanking: true } })[0].id, 'mgmt');
  assert.equal(roleBoards({ computed: c, roles: { editCapacity: true } })[0].id, 'lead');
  assert.equal(roleBoards({ computed: c }).filter((b) => b.recommended).length, 1);
  assert.ok(!roleBoards({ computed: c, hasSupport: false })[0].questions.some((q) => /SLA/.test(q)), 'no support card without a support configuration');
});

test('saved boards: at most 10, names trimmed, cards sanitised, duplicates and empty boards dropped', () => {
  const card = (q, extra = {}) => ({ id: 'a1', q, x: 10, y: 20, w: 440, view: 'bar', ...extra });
  const list = Array.from({ length: 14 }, (_, i) => ({ id: `b${i}`, name: `  Board   ${i}  `, cards: [card(`Frage ${i}`)], cam: { x: 0, y: 0, z: 1 } }));
  const v = validBoards(list);
  assert.equal(v.length, 10);
  assert.equal(v[0].name, 'Board 0');
  const odd = validBoards([
    { id: 'x', name: 'a'.repeat(200), cards: [card('ok', { view: '<script>', w: 99999, x: 'NaN' })], cam: { z: 99 } },
    { id: 'x', name: 'dup id', cards: [card('q')] },
    { id: 'y', name: 'empty', cards: [card('   ')] },
    { id: 'BAD ID!', name: '', cards: [card('q2')] },
    'not a board',
  ]);
  assert.equal(odd.length, 2);
  assert.equal(odd[0].name.length, 60);
  assert.equal(odd[0].cards[0].view, 'text'); assert.equal(odd[0].cards[0].w, 1100); assert.equal(odd[0].cards[0].x, 0); assert.equal(odd[0].cam.z, 1.6);
  assert.match(odd[1].id, /^[a-z0-9]{1,16}$/); assert.equal(odd[1].name, 'Board');
  assert.equal(validBoards(null).length, 0);
  assert.equal(validBoards([{ id: 'z', name: 'many', cards: Array.from({ length: 50 }, (_, i) => card(`q${i}`)) }])[0].cards.length, 30);
  assert.equal(validAsk({ cards: [], name: '  Montags\nrunde ' }).name, 'Montags runde');
  assert.equal('name' in validAsk({ cards: [] }), false);
  assert.equal(boardName('  a  b '), 'a b');
});

test('today inbox: health due by rhythm, suggestions grouped, only long blocks; owners see their own, managers all', () => {
  const now = Date.parse(golden.today || '2026-11-09') || Date.now();
  const all = todayInbox({ computed: c, roles: { editHealth: true }, now });
  const open = c.model.items.filter((p) => (p.statusCat ?? 'new') !== 'done');
  const due = open.filter((p) => !p.health || now - Date.parse(p.health.at) > 7 * 864e5);
  assert.equal(all.health.length, due.length);
  const nobody = todayInbox({ computed: c, roles: {}, me: { id: 'nobody' }, now });
  assert.equal(nobody.health.length, 0, 'without the right, only your own projects');
  assert.ok(all.blocked.every((b) => b.days > 7));
  if (all.suggestions) assert.equal(Object.values(all.suggestions.byField).reduce((a, b) => a + b, 0), all.suggestions.n);
  assert.equal(all.total, all.health.length + (all.suggestions ? 1 : 0) + all.blocked.length);
  // a fresh health within the rhythm is not due
  const ds = structuredClone(golden);
  for (const p of ds.portfolio) p.health = { status: 'onTrack', comment: 'x', at: new Date(now - 864e5).toISOString() };
  assert.equal(todayInbox({ computed: computeAll(ds), roles: { editHealth: true }, now }).health.length, 0);
});
