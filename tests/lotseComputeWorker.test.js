// The browser's compute worker (static/cockpit/src/lib/computeWorker.js) must give exactly what computeAll gives:
// dataset in slices → worker copy → computeAll → result in slices (structured clone, as postMessage does) → the main
// thread's model + rows. Also: Lotse's first answer on the seeded result equals the answer on a plain computeAll, and
// only changed dataset keys are sent again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bigDataset } from '../tools/bigDataset.js';
import { computeAll } from '../shared/engine.js';
import { ask, briefing } from '../shared/lotse/index.js';
import { dsSlices, dsReceiver, packResult, unpackResult } from '../static/cockpit/src/lib/computeWorker.js';
import { digest } from './perf/fingerprint.js';
import { contextFor } from './perf/harness.js';
import { rcOf } from '../shared/lotse/kit.js';

const pinNow = (ds, fn) => { const real = Date.now; Date.now = () => Date.parse(`${ds.today}T10:00:00Z`); try { return fn(); } finally { Date.now = real; } };
const viaWorker = (ds, lang = 'de') => {
  const rx = dsReceiver();
  for (const m of dsSlices(ds)) rx.take(structuredClone(m));
  const msgs = packResult(computeAll(rx.ds), { ds: rx.ds, lang }).map((m) => structuredClone(m));
  const gen = unpackResult(ds, msgs, { every: 500 });
  let r = gen.next(), steps = 0;
  while (!r.done) { steps++; r = gen.next(); }
  return { computed: r.value, steps, msgs };
};

test('compute worker: the same result as computeAll (S dataset), built in steps', () => {
  const ds = bigDataset('S');
  pinNow(ds, () => {
    const direct = computeAll(ds);
    const { computed, steps, msgs } = viaWorker(ds);
    assert.ok(steps > 3, 'the main thread works in steps');
    assert.ok(msgs.length > 5, 'the result comes in slices');
    assert.deepEqual(Object.keys(computed), Object.keys(direct));
    for (const k of Object.keys(direct)) assert.equal(digest(computed[k]), digest(direct[k]), k);
    // the model is built from the main thread's own objects, the rows are copies of its tickets
    assert.equal(computed.model.byId.get(ds.issues[0].id), ds.issues[0]);
    assert.equal(computed.supportA.queue[0], computed.supportA.rows.find((r) => r.id === computed.supportA.queue[0].id));
  });
});

test('compute worker: Lotse answers on the seeded result equal the plain ones; the first answer needs no realistic-capacity run', () => {
  const ds = bigDataset('S');
  pinNow(ds, () => {
    const { computed, msgs } = viaWorker(ds);
    const a = { ...contextFor(ds, computeAll(ds)), history: null }, b = { ...contextFor(ds, computed), history: null };
    for (const q of ['Was ist heute wichtig?', 'Wer macht bald Überstunden?', 'Welche Support-Themen kommen immer wieder?', 'Lagebild Portfolio']) {
      assert.equal(digest(ask(q, b)), digest(ask(q, a)), q);
    }
    assert.equal(digest(briefing(b, 'management')), digest(briefing(a, 'management')));
    assert.equal(rcOf(b, 'de').teams, msgs.find((m) => m.t === 'lotse' && m.part === 'teams').value, 'realistic capacity comes from the worker, not a new run');
  });
});

test('compute worker: an edit sends only the changed keys again', () => {
  const ds = bigDataset('S');
  const sent = new Map(Object.keys(ds).map((k) => [k, ds[k]]));
  const next = { ...ds, portfolio: ds.portfolio.map((p) => ({ ...p })) };
  const msgs = dsSlices(next, sent);
  assert.deepEqual([...new Set(msgs.map((m) => m.key))], ['portfolio']);
  assert.ok(dsSlices(ds).filter((m) => m.key === 'issues').every((m) => m.t === 'part' && m.items.length <= 1000), 'work items in slices');
});
