// The shortcuts of the speed work give exactly what the full computation gives:
//  - realistic capacity / support topics in the other language are made from the first one (only the sentences are
//    written again) – equal to computing them fresh in that language, also after the compute worker's round trip
//  - the portfolio's live waterline reuses the computed one when the order on screen is the computed ranking
//  - per-computed memos (waits, team details, smart suggestions) equal a fresh computation
//  - one numeric collator sorts work item keys exactly like localeCompare(…, { numeric: true })
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bigDataset } from '../tools/bigDataset.js';
import { computeAll, waterline } from '../shared/engine.js';
import { realisticCapacity, relangCapacity, overtimeOutlook, supportTopics } from '../shared/insights.js';
import { ticketsOf } from '../shared/ask.js';
import { waitsFor } from '../shared/waits.js';
import { teamDetails, teamIds, personWeek, teamWeekItems } from '../shared/team.js';
import { smartSuggestions } from '../shared/smart.js';
import { packResult, unpackResult } from '../static/cockpit/src/lib/computeWorker.js';
import { lotseDataset, lotseHistory } from './lotseFixture.js';

const ds = bigDataset('S');
const computed = computeAll(ds);
const copy = () => ({ ...computed }); // a new computed object: no per-computed memo applies
const plain = (x) => JSON.parse(JSON.stringify(x));

test('realistic capacity: the other language from the first one equals a fresh computation', () => {
  for (const history of [null, lotseHistory()]) {
    for (const [a, b] of [['de', 'en'], ['en', 'de']]) {
      const c = copy();
      const first = realisticCapacity(c, { weeks: 12, history, lang: a });
      const other = realisticCapacity(c, { weeks: 12, history, lang: b }); // made from `first`
      const fresh = realisticCapacity(copy(), { weeks: 12, history, lang: b });
      assert.deepEqual(plain(other), plain(fresh), `${a} → ${b}, history ${!!history}`);
      assert.deepEqual(plain(relangCapacity(first, b)), plain(fresh));
      assert.deepEqual(plain(overtimeOutlook(other, { lang: b })), plain(overtimeOutlook(fresh, { lang: b })));
      assert.equal(realisticCapacity(c, { weeks: 12, history, lang: b }), other, 'the same data state answers from the memo');
    }
  }
  // the small Lotse fixture (other rooms, ties, a 2-week horizon)
  const fx = computeAll(lotseDataset());
  for (const weeks of [2, 12]) {
    const c = { ...fx };
    realisticCapacity(c, { weeks, lang: 'en' });
    assert.deepEqual(plain(realisticCapacity(c, { weeks, lang: 'de' })), plain(realisticCapacity({ ...fx }, { weeks, lang: 'de' })));
  }
});

test('the compute worker ships the rooms: the other language on the main thread equals a fresh computation', () => {
  const msgs = packResult(computeAll(ds), { ds, lang: 'en' }).map((m) => structuredClone(m));
  const g = unpackResult(ds, msgs);
  let r = g.next();
  while (!r.done) r = g.next();
  const c = r.value;
  const de = realisticCapacity(c, { weeks: 12, history: null, planActual: null, lang: 'de' });
  assert.deepEqual(plain(de), plain(realisticCapacity(copy(), { weeks: 12, lang: 'de' })));
});

test('support topics: the other language from the first one equals a fresh computation', () => {
  const tickets = ticketsOf({ ds });
  assert.ok(Object.isFrozen(tickets));
  const en = supportTopics(tickets, { minCount: 3, lang: 'en', today: ds.today });
  const de = supportTopics(tickets, { minCount: 3, lang: 'de', today: ds.today });
  assert.ok(en.topics.length > 0);
  assert.deepEqual(plain(de), plain(supportTopics([...tickets], { minCount: 3, lang: 'de', today: ds.today })), 'an unfrozen copy is computed fresh');
});

test('portfolio: the computed waterline is the live waterline of the computed ranking', () => {
  const { model, metrics, support } = computed;
  const ranked = [...ds.portfolio].sort((a, b) => a.rank - b.rank);
  const byRef = new Map(ds.portfolio.map((p) => [p.ref, p]));
  const items = ranked.map((p, i) => ({ ...byRef.get(p.ref), rank: i + 1 })).filter((x) => x.ref);
  const key = (list) => list.filter((p) => metrics.has(p.ref)).sort((a, b) => a.rank - b.rank).map((p) => `${p.ref}\u0000${p.rank}`).join('\u0001');
  assert.equal(key(items), key([...model.items]), 'the dataset ranks are the computed ranks');
  const live = waterline({ ...model, items, itemByRef: new Map(items.map((p) => [p.ref, p])) }, metrics, support);
  assert.deepEqual(plain(live), plain(computed.wl));
});

test('per-computed memos equal a fresh computation', () => {
  assert.equal(waitsFor(computed), waitsFor(computed));
  assert.deepEqual([...waitsFor(computed)], [...waitsFor(copy())]);
  for (const id of teamIds(computed)) {
    assert.equal(teamDetails(computed, id), teamDetails(computed, id));
    assert.deepEqual(plain(teamDetails(computed, id)), plain(teamDetails(copy(), id)));
  }
  assert.deepEqual(plain(smartSuggestions(computed, { lang: 'en' })), plain(smartSuggestions(copy(), { lang: 'en' })));
  assert.equal(smartSuggestions(computed, { lang: 'de' }), smartSuggestions(computed, { lang: 'de' }));
  // the person / team weeks read the per-model index of open stories: the same as scanning every work item
  const { model } = computed;
  const today = model.today;
  const people = [...new Set(ds.issues.map((i) => i.assignee?.id).filter(Boolean))].slice(0, 12);
  for (const pid of people) {
    const pw = personWeek(computed, pid, today, today + 6);
    if (!pw) continue;
    const scan = ds.issues.filter((s) => s.role === 'estimate' && (s.status?.cat ?? s.statusCat ?? 'new') !== 'done' && s.re && s.assignee?.id === pid).map((s) => s.id);
    assert.ok(pw.items.every((x) => scan.includes(x.id)));
  }
  for (const tid of teamIds(computed).slice(0, 5)) assert.ok(Array.isArray(teamWeekItems(computed, tid, today, today + 6)));
});

test('one numeric collator sorts keys like localeCompare with numeric', () => {
  const keys = ['KPR-10', 'KPR-2', 'kpr-3', 'ABC-100', 'ABC-99', 'Ä-1', 'A-1', 'a-01', 'Z-0', 'KPR-2a', 'KPR-02', ...ds.issues.slice(0, 500).map((i) => i.key)];
  const coll = new Intl.Collator(undefined, { numeric: true });
  const a = [...keys].sort((x, y) => String(x).localeCompare(String(y), undefined, { numeric: true }));
  const b = [...keys].sort((x, y) => coll.compare(String(x), String(y)));
  assert.deepEqual(a, b);
});
