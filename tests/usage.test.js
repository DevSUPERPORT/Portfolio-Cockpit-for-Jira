// Usage signals (shared/usage.js, src/lib/usage.js, static/cockpit/src/lib/usage.js): counts only – a fixed allow-list of
// event names, per site and day, no person, no content; 30 days; the admin summary (undo rate, Lotse vs. AI, top skills).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isUsageEvent, cleanBatch, mergeDay, usageSummary, usageDays, USAGE_DAYS, USAGE_LIMITS, USAGE_SKILLS, USAGE_AI } from '../shared/usage.js';
import { trackUsage, readUsage, compactDay, compactUsage, USAGE_KEY, USAGE_SHARD } from '../src/lib/usage.js';
import { SKILL_IDS } from '../shared/lotse/index.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-12T10:00:00Z');

test('the allow-list: known events only – anything that could carry content or a person is dropped', () => {
  for (const ok of ['view:portfolio', 'lotse:ask', 'lotse:story:projectBrief', 'lotse:action:fill', 'lotse:workflow:weekClose:done', 'undo', 'write', 'ai:gaps', 'report:pdf', 'teamwork:pick:lotse']) assert.ok(isUsageEvent(ok), ok);
  for (const bad of ['view:anna.becker', 'lotse:story:KPR-118', 'ai:whatever', 'lotse:ask:wie steht es', 'search:Kundenportal', 'undo ', '', null, 42, 'lotse:workflow:x:done', `view:${'a'.repeat(80)}`]) assert.ok(!isUsageEvent(bad), String(bad));
  for (const s of SKILL_IDS) assert.ok(USAGE_SKILLS.includes(s), `every Lotse skill is countable: ${s}`);
  assert.deepEqual([...USAGE_AI].sort(), [...[...read('src/lib/config.js').matchAll(/AI_FEATURES = \[([^\]]+)\]/g)][0][1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]).sort());
  assert.deepEqual(cleanBatch({ events: { 'view:portfolio': 3, 'free text': 1, undo: 2.4, write: -1, 'ai:gaps': 'x', 'lotse:ask': 5000 } }), { 'view:portfolio': 3, undo: 2, 'lotse:ask': USAGE_LIMITS.perEvent });
  assert.deepEqual(cleanBatch(null), {});
  assert.deepEqual(cleanBatch({ events: ['view:portfolio'] }), {});
});

test('a day is a map of counts – merged, capped, nothing else', () => {
  const d = mergeDay(mergeDay(null, { 'view:mine': 2 }), { 'view:mine': 3, undo: 1, 'name:Anna': 1 });
  assert.deepEqual(d, { counts: { 'view:mine': 5, undo: 1 } });
});

test('summary: 30 days, undo rate = undo ÷ write, Lotse vs. AI, top skills and workflows, teamwork agreement', () => {
  const days = usageDays(NOW);
  assert.equal(days.length, USAGE_DAYS);
  assert.equal(days.at(-1), '2026-11-12');
  const s = usageSummary([
    { day: '2026-11-12', counts: { write: 10, undo: 1, 'lotse:ask': 4, 'lotse:story:waterline': 3, 'lotse:story:today': 5, 'ai:gaps': 2, 'ai:lotse': 1, 'view:portfolio': 7, 'lotse:workflow:weekClose:start': 2, 'lotse:workflow:weekClose:done': 1, 'teamwork:same': 3, 'teamwork:differs': 1 } },
    { day: '2026-11-11', counts: { write: 10, undo: 3, 'view:portfolio': 1 } },
    { day: '2026-09-01', counts: { write: 1000 } }, // outside the 30 days
  ], NOW);
  assert.deepEqual(s.undo, { writes: 20, undos: 4, rate: 0.2 });
  assert.equal(s.lotseVsAi.lotse, 4 + 3 + 5 + 3);
  assert.equal(s.lotseVsAi.ai, 3);
  assert.deepEqual(s.skills.map((x) => x.id), ['today', 'waterline']);
  assert.deepEqual(s.views, [{ id: 'portfolio', n: 8 }]);
  assert.deepEqual(s.workflows, [{ id: 'weekClose', start: 2, done: 1, cancel: 0 }]);
  assert.deepEqual(s.teamwork, { same: 3, differs: 1, pickLotse: 0, pickAi: 0 });
  assert.equal(s.daily.length, 30);
  assert.equal(s.activeDays, 2);
  assert.equal(usageSummary([], NOW).undo.rate, null);
});

// An in-memory app storage whose every call yields to the event loop – so concurrent requests really interleave.
function memStore(now = NOW) {
  const m = new Map();
  let seq = 0;
  const tick = () => new Promise((r) => setImmediate(r));
  return {
    m,
    get: async (k) => { await tick(); return m.has(k) ? structuredClone(m.get(k)) : null; },
    set: async (k, v) => { await tick(); m.set(k, structuredClone(v)); },
    del: async (k) => { await tick(); m.delete(k); },
    list: async (prefix, max = 1000) => { await tick(); return [...m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, max).map((key) => ({ key, value: structuredClone(m.get(key)) })); },
    id: () => `s${String(++seq).padStart(5, '0')}`,
    now,
  };
}

test('server: track stores a batch for today, deletes the day that left the window; summary reads 30 days', async () => {
  const deps = memStore();
  deps.m.set(USAGE_KEY('2026-10-13'), { counts: { write: 99 } });
  assert.deepEqual(await trackUsage({ events: { 'view:team': 2, secret: 1 } }, deps), { stored: 1 });
  await trackUsage({ events: { 'view:team': 1, undo: 1 } }, deps);
  const shards = [...deps.m.keys()].filter((k) => k.startsWith('usage:2026-11-12:'));
  assert.equal(shards.length, 2, 'one append-only shard per batch');
  assert.deepEqual(deps.m.get(shards[0]), { counts: { 'view:team': 2 } }, 'only the allow-listed counts, nothing else');
  assert.ok(!deps.m.has(USAGE_KEY('2026-10-13')), 'older than 30 days: deleted');
  assert.deepEqual(await trackUsage({ events: {} }, deps), { stored: 0 });
  const s = await readUsage(deps);
  assert.deepEqual(s.views, [{ id: 'team', n: 3 }]);
  assert.equal(s.undo.undos, 1);
});

test('race: 60 browsers flushing at the same moment – no batch is lost (the old read-add-write lost most of them)', async () => {
  const deps = memStore();
  await Promise.all(Array.from({ length: 60 }, (_, i) => trackUsage({ events: { 'view:portfolio': 1, ...(i % 3 ? {} : { undo: 2 }) } }, deps)));
  const s = await readUsage(deps);
  assert.deepEqual(s.views, [{ id: 'portfolio', n: 60 }]);
  assert.equal(s.undo.undos, 40);
  // the naive way (what usage.js did before): read the day, add, write – under the same interleaving it loses counts
  const naive = memStore();
  await Promise.all(Array.from({ length: 60 }, async () => { const d = await naive.get('day'); await naive.set('day', mergeDay(d, { 'view:portfolio': 1 })); }));
  assert.ok((naive.m.get('day').counts['view:portfolio']) < 60, 'the race this design removes');
});

test('compaction: closed days fold into one record – idempotent, safe when two run at once, nothing counted twice', async () => {
  const deps = memStore();
  const day = '2026-11-05';
  deps.m.set(USAGE_KEY(day), { counts: { write: 5 } }); // a record from before the shards (old format)
  for (let i = 0; i < 25; i++) deps.m.set(USAGE_SHARD(day, `a${String(i).padStart(3, '0')}`), { counts: { write: 1, 'view:mine': 2 } });
  const before = (await readUsage(deps)).undo.writes;
  assert.equal(before, 30);
  // two compactions at the same time (hourly job + an admin opening the view)
  const [a, b] = await Promise.all([compactDay(day, deps), compactDay(day, deps)]);
  assert.ok(a + b >= 25);
  assert.deepEqual(deps.m.get(USAGE_KEY(day)).counts, { write: 30, 'view:mine': 50 });
  assert.equal([...deps.m.keys()].filter((k) => k.startsWith(`usage:${day}:`)).length, 0, 'shards deleted after the record holds them');
  assert.equal(await compactDay(day, deps), 0, 'nothing left to do');
  // a crash between "write the record" and "delete the shards": the shards stay, but are not counted twice
  deps.m.set(USAGE_SHARD(day, 'z001'), { counts: { write: 1 } });
  await compactDay(day, deps);
  deps.m.set(USAGE_SHARD(day, 'z001'), { counts: { write: 1 } }); // the same shard again (not deleted)
  const rec = deps.m.get(USAGE_KEY(day));
  assert.ok(rec.from.includes('z001'));
  assert.equal((await readUsage(deps)).undo.writes, 31, 'a shard the record already holds counts once');
  // the whole window: today and yesterday stay as shards (they still receive batches), older days are compacted
  await trackUsage({ events: { undo: 1 } }, deps);
  const r = await compactUsage(deps);
  assert.ok(r.compacted >= 0);
  assert.equal([...deps.m.keys()].filter((k) => k.startsWith('usage:2026-11-12:')).length, 1, "today's shard is left alone");
  assert.equal((await readUsage(deps)).undo.undos, 1);
});

test('privacy by construction: no person in track, the resolver gets no ctx; admins only for the summary; the client batches and never throws', () => {
  const src = read('src/index.js');
  assert.match(src, /def\('usage\.track', async \(\{ payload \}\) => trackUsage\(payload\)\);/, 'track receives no ctx – no account id can be stored');
  assert.match(src, /def\('usage\.summary', async \(\{ roles \}\) => \{ requireRole\(roles, 'admin'\); return readUsage\(\); \}\);/);
  for (const f of ['src/lib/usage.js', 'shared/usage.js']) assert.doesNotMatch(read(f).replace(/^\/\/.*$/gm, ''), /accountId|displayName|\bname\b:|text:/, `${f}: no person, no content`);
  const m = read('src/lib/maintenance.js');
  assert.match(m, /'usage\.summary'/);
  assert.doesNotMatch(m, /'usage\.track'/, 'track writes – refused while paused');
  const client = read('static/cockpit/src/lib/usage.js');
  assert.match(client, /const EVERY_MS = 30e3;/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /if \(!inForge\(\)\) \{ console\.info/, 'mock: console only');
  assert.match(client, /catch \{ \/\* never in the way \*\/ \}/);
  // instrumented: views, writes, undo, Lotse ask / story / action, AI runs, report PDF
  assert.match(read('static/cockpit/src/state.jsx'), /track\(`view:\$\{v\}`\)/);
  assert.match(read('static/cockpit/src/state.jsx'), /track\('write'\)/);
  assert.match(read('static/cockpit/src/state.jsx'), /track\('undo'\)/);
  assert.match(read('static/cockpit/src/components/lotse/Lotse.jsx'), /track\(req\.text \? 'lotse:ask' : 'lotse:open'\)/);
  assert.match(read('static/cockpit/src/components/lotse/StoryCard.jsx'), /track\(`lotse:action:\$\{a\.kind\}`\)/);
  assert.match(read('static/cockpit/src/components/AiAssist.jsx'), /track\(`ai:\$\{feature\}`\)/);
  assert.match(read('static/cockpit/src/views/Report.jsx'), /track\('report:pdf'\)/);
  // the admin view says what it is
  assert.match(read('static/cockpit/src/components/UsageStats.jsx'), /nur Zählungen, keine Personen, keine Inhalte|Nur Zählungen, keine Personen, keine Inhalte/);
});
