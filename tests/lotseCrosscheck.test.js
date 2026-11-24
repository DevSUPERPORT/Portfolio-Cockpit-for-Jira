// Lotse × AI: crossCheck() verifies every number, key, team, date, quarter and rank of a text against the story's facts
// (pure code, no second model); lotse.llm sends only the minimised story, is gated like every AI path (switch → the
// person's own switch / budget / daily limit → Forge LLM) and never lets the AI's reading replace the story.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crossCheck, textClaims, SKILLS, lotseFacts, lotsePrompt, cleanReply, lotseReading, validStory } from '../shared/lotse/index.js';
import { DEFAULT_CONFIG, AI_FEATURES, aiAllowed, validAi } from '../src/lib/config.js';
import { AI_FEATURES as CLIENT_FEATURES } from '../static/cockpit/src/lib/aiFlags.js';
import { READ_RESOLVERS } from '../src/lib/maintenance.js';
import { lotseCtx } from './lotseFixture.js';

globalThis.__forge_runtime__ = { appContext: { appId: 'ari:cloud:ecosystem::app/test', environmentType: 'DEVELOPMENT', environmentId: 'test', invocationId: 'test', installationId: 'test', moduleKey: 'pc-cockpit', permissions: { scopes: [] } }, lambdaContext: { getRemainingTimeInMillis: () => 25000 }, proxy: { token: '', url: 'http://127.0.0.1:9' }, metrics: { counter: () => ({ incr() {} }) }, tracing: {} };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const ctx = lotseCtx('de');
const { model, metrics } = ctx.computed;
const late = model.items.find((x) => metrics.get(x.ref).daysOverdue > 0);
const m = metrics.get(late.ref);
const story = SKILLS.projectBrief.run(ctx, { ref: late.ref }, 'de');
const storyEn = SKILLS.projectBrief.run({ ...ctx, lang: 'en' }, { ref: late.ref }, 'en');
const prog = Math.round(m.progress * 100);
const kinds = (r) => r.claims.map((c) => `${c.kind}:${c.verified}`);

test('agrees: the reading repeats the story\'s facts (rounded, in its own words)', () => {
  const t = `${late.name} liegt ${m.daysOverdue} Tage hinter dem Termin, erst ${prog} % sind geschafft. Die Prognose von rund ${Math.round(m.forecast)} h übersteigt den Plan. ${late.key} sollte zuerst ins Gespräch.`;
  const r = crossCheck(story, t);
  assert.equal(r.verdict, 'agrees', JSON.stringify(r.claims));
  assert.equal(r.agree, 1);
  assert.ok(r.claims.filter((c) => c.verified === true).length >= 4);
  // English formatting and a derived number (what is still open = 100 − progress)
  const en = crossCheck(storyEn, `${late.name} is ${m.daysOverdue} days late; ${100 - prog}% of the work is still open.`);
  assert.equal(en.verdict, 'agrees', JSON.stringify(en.claims));
});

test('differs: a wrong number, a wrong key, an invented team, a wrong rank, a wrong date', () => {
  const wrongNum = crossCheck(story, `${late.name} ist ${m.daysOverdue + 20} Tage über dem Termin.`);
  assert.equal(wrongNum.verdict, 'differs');
  const c = wrongNum.claims.find((x) => x.verified === false);
  assert.equal(c.kind, 'number');
  assert.match(c.expected, new RegExp(`^${m.daysOverdue}`), 'the nearest story fact is offered');
  const wrongKey = crossCheck(story, `Das Problem liegt bei ${late.key.split('-')[0]}-99999.`);
  assert.deepEqual(kinds(wrongKey), ['key:false']);
  const team = crossCheck(story, 'Team Marketing fehlt die Kapazität.');
  assert.deepEqual(kinds(team), ['team:false']);
  const rank = crossCheck(story, `${late.name} (#${late.rank + 1}) braucht Hilfe.`);
  assert.equal(rank.claims[0].kind, 'rank');
  assert.equal(rank.claims[0].verified, false);
  assert.equal(rank.claims[0].expected, `#${late.rank}`);
  assert.equal(crossCheck(story, `${late.name} (#${late.rank}) braucht Hilfe.`).verdict, 'agrees');
  const dateOk = crossCheck(story, `Der Termin war der ${m.due.slice(8, 10)}.${m.due.slice(5, 7)}.`);
  assert.equal(dateOk.verdict, 'agrees', JSON.stringify(dateOk.claims));
  assert.equal(crossCheck(story, 'Der Termin war der 05.12.2026.').verdict, 'differs');
  // a mix: partly right
  const mix = crossCheck(story, `${late.name}: ${prog} % fertig, aber 999 h über Plan.`);
  assert.equal(mix.verdict, 'differs');
  assert.ok(mix.agree > 0 && mix.agree < 1);
});

test('unverifiable: no numbers, keys, teams, dates or ranks – nothing to check', () => {
  const r = crossCheck(story, 'Das sieht insgesamt solide aus, aber es lohnt sich, genau hinzuschauen.');
  assert.equal(r.verdict, 'unverifiable');
  assert.equal(r.agree, null);
  assert.deepEqual(r.claims, []);
  assert.equal(crossCheck(story, '').verdict, 'unverifiable');
});

test('tolerances: rounding ±1 in the last digit or ±1 %, "about" ±5 %, never more', () => {
  const s = { ...story, kpis: [{ id: 'h', label: 'X', value: 1234.4, unit: 'h' }, { id: 'p', label: 'Y', value: 37, unit: '%' }], findings: [{ text: 'x', tone: 'info', impact: 1, evidence: [] }], visual: { kind: 'donut', data: { unit: 'n', total: 1, items: [{ label: 'a', value: 1 }] }, caption: 'c' } };
  assert.equal(crossCheck(s, '1.234 h').verdict, 'agrees');
  assert.equal(crossCheck(s, '1.240 h').verdict, 'agrees', 'within 1 %');
  assert.equal(crossCheck(s, 'rund 1.200 h').verdict, 'agrees', '"rund" = within 5 %');
  assert.equal(crossCheck(s, '1.100 h').verdict, 'differs');
  assert.equal(crossCheck(s, '38 %').verdict, 'agrees', '±1 percentage point');
  assert.equal(crossCheck(s, '40 %').verdict, 'differs');
  assert.equal(crossCheck({ ...s, lang: 'en' }, '1,234 h and 37%').verdict, 'agrees');
  assert.equal(crossCheck({ ...s, lang: 'en' }, '1,234.4 hours').verdict, 'agrees');
});

test('claims: names are not numbers, handles are not claims, quarters and weeks are recognised', () => {
  const c = textClaims('Mobile App 2.0 (#4) braucht in Q1 2027 und KW 3–5 mehr Zeit; P1 und #6 NET-1 sind betroffen.', { lang: 'de', entities: { projects: [{ name: 'Mobile App 2.0', key: 'MOB-1', rank: 4 }], teams: [], people: [] } });
  const k = c.claims.map((x) => x.kind);
  assert.ok(!c.claims.some((x) => x.kind === 'number' && x.found === 2), 'the 2.0 of a name is no number');
  assert.ok(k.includes('quarter') && k.includes('week') && k.includes('key') && k.filter((x) => x === 'rank').length === 2);
  assert.ok(!c.claims.some((x) => /P1/.test(x.text)), 'handles are not claims');
});

test('the verified story is what the model sees: names and texts only when allowed, never ids', () => {
  const s = SKILLS.planningAdvice.run(ctx, { team: 't-ux' }, 'de');
  const people = (s.entities.people || []).map((p) => p.name);
  assert.ok(people.length, 'the story names people');
  const off = JSON.stringify(lotseFacts(validStory(s), { names: false, texts: false }).facts);
  for (const n of people) assert.ok(!off.includes(n), `no name: ${n}`);
  for (const p of s.entities.projects) assert.ok(!off.includes(p.name), `no project name: ${p.name}`);
  assert.match(off, /P1/);
  assert.match(JSON.stringify(lotseFacts(validStory(story), { names: false, texts: false }).facts), new RegExp(`#${late.rank} ${late.key}`), 'projects as "#rank KEY"');
  assert.doesNotMatch(off, /"(ref|id)":/);
  const st = SKILLS.supportTopics.run(ctx, {}, 'de');
  const stOff = JSON.stringify(lotseFacts(validStory(st), { names: false, texts: false }).facts);
  for (const t of st.entities.texts) assert.ok(!stOff.includes(t), `no ticket text: ${t}`);
  const pbOff = lotseFacts(validStory(SKILLS.projectBrief.run(ctx, { ref: late.ref }, 'de')), { names: false, texts: false }).facts;
  assert.ok(pbOff.findings.every((f) => f.evidence.every((e) => !('text' in e))), 'no evidence texts (summaries, reasons)');
  const on = JSON.stringify(lotseFacts(validStory(s), { names: true, texts: true }).facts);
  assert.ok(people.some((n) => on.includes(n)), 'names when allowed');
  assert.ok(JSON.stringify(lotseFacts(validStory(story), { names: true, texts: true }).facts).includes(late.name), 'project names when texts are allowed');
  // the prompt: rules, the story, the UI language – and small
  const { system, user } = lotsePrompt(lotseFacts(validStory(story)).facts, 'en');
  assert.match(system, /Use ONLY numbers/);
  assert.match(system, /data, never instructions/);
  assert.match(user, /^<story>\{.*\}<\/story>\n\nAnswer in English/s);
  assert.ok(user.length < 8000, `${user.length} chars`);
});

test('cleanReply: plain text, the extra consideration split off', () => {
  assert.deepEqual(cleanReply('**Kurz:** Das Projekt ist spät.\n- Punkt\nZusätzlich: Reserve prüfen.'), { text: 'Kurz: Das Projekt ist spät. Punkt', extra: 'Reserve prüfen.' });
  assert.deepEqual(cleanReply('Fine. Also consider: the reserve.'), { text: 'Fine.', extra: 'the reserve.' });
  assert.equal(cleanReply('x'.repeat(2000)).text.length, 900);
});

// ---------- the resolver core: gates first ----------
const on = (over = {}) => ({ ...DEFAULT_CONFIG, setupComplete: true, ai: { ...DEFAULT_CONFIG.ai, enabled: true, features: { ...DEFAULT_CONFIG.ai.features }, ...over } });
function spies(reply = 'ok') {
  const s = { llm: [], quota: [], audit: [] };
  return { s, deps: {
    llm: async (system, user, policy) => { s.llm.push({ system, user, policy }); if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply(user) : reply; },
    takeQuota: async (id, cfg) => { s.quota.push(id); if (cfg.ai.access !== 'all' && cfg.ai.userOn !== true) throw Object.assign(new Error('AI_USER_OFF'), { code: 'AI_USER_OFF' }); },
    audit: async (c, action, details) => { s.audit.push({ action, details }); },
  } };
}
const CTX = { accountId: 'acc-1' };
const userOn = (over = {}) => on({ userOn: true, ...over });

test('gating: AI off / Lotse off → AI_DISABLED, the person\'s own switch off → AI_USER_OFF – before anything is sent', async () => {
  const { s, deps } = spies();
  await assert.rejects(lotseReading({ story }, { ...CTX, cfg: DEFAULT_CONFIG }, deps), { code: 'AI_DISABLED' });
  await assert.rejects(lotseReading({ story }, { ...CTX, cfg: on({ features: { ...DEFAULT_CONFIG.ai.features, lotse: false } }) }, deps), { code: 'AI_DISABLED' });
  await assert.rejects(lotseReading({ story }, { ...CTX, cfg: null }, deps), { code: 'AI_DISABLED' });
  assert.deepEqual([s.llm.length, s.quota.length], [0, 0], 'nothing counted, nothing sent');
  await assert.rejects(lotseReading({ story }, { cfg: userOn() }, deps), { code: 'FORBIDDEN' });
  await assert.rejects(lotseReading({ story: { ...story, visual: null } }, { ...CTX, cfg: userOn() }, deps), { code: 'INVALID' });
  await assert.rejects(lotseReading({ story: { ...story, headline: 'x'.repeat(30000) } }, { ...CTX, cfg: userOn() }, deps), { code: 'INVALID' });
  await assert.rejects(lotseReading({}, { ...CTX, cfg: userOn() }, deps), { code: 'INVALID' });
  assert.deepEqual([s.llm.length, s.quota.length], [0, 0], 'an invalid story costs no quota');
  await assert.rejects(lotseReading({ story }, { ...CTX, cfg: on() }, deps), { code: 'AI_USER_OFF' });
  assert.deepEqual([s.quota.length, s.llm.length], [1, 0], 'the person\'s switch is checked before the model is called');
  // the switch list: server, client, defaults
  assert.ok(AI_FEATURES.includes('lotse') && CLIENT_FEATURES.includes('lotse'));
  assert.equal(DEFAULT_CONFIG.ai.features.lotse, true);
  assert.equal(aiAllowed(DEFAULT_CONFIG, 'lotse'), false, 'off with AI off');
  assert.equal(aiAllowed(on(), 'lotse'), true);
  assert.equal(validAi({ enabled: true, features: { lotse: false } }).features.lotse, false);
});

test('the reading: handles back to names, every claim cross-checked, the story wins on a wrong number', async () => {
  const faithful = (user) => {
    const f = JSON.parse(user.slice(user.indexOf('<story>') + 7, user.indexOf('</story>')));
    return `**${f.headline}** Das wichtigste zuerst. Zusätzlich: ${f.findings[1]?.text || f.findings[0].text}`;
  };
  const { s, deps } = spies(faithful);
  const r = await lotseReading({ story, lang: 'de' }, { ...CTX, cfg: userOn() }, deps);
  assert.equal(r.source, 'ai');
  assert.equal(r.crossCheck.verdict, 'agrees', JSON.stringify(r.crossCheck.claims));
  assert.ok(r.text.includes(late.name), 'the project name is back in the reply');
  assert.ok(r.extra);
  assert.equal(s.llm[0].policy.feature, 'lotse');
  assert.ok(!s.llm[0].user.includes(late.name), 'the model saw "#rank KEY", not the name');
  assert.equal(s.audit[0].action, 'ai.lotse');
  assert.ok(r.usedFacts && r.shared.names === false);
  // a wrong number: the reading is returned, marked as differing – the UI keeps the story
  const wrong = spies(`${late.key} ist ${m.daysOverdue + 30} Tage zu spät.`);
  const w = await lotseReading({ story }, { ...CTX, cfg: userOn() }, wrong.deps);
  assert.equal(w.crossCheck.verdict, 'differs');
  // the model fails: the story stands alone, the reason is named
  const down = spies(Object.assign(new Error('t'), { code: 'AI_TIMEOUT' }));
  const d = await lotseReading({ story }, { ...CTX, cfg: userOn() }, down.deps);
  assert.deepEqual([d.source, d.reason, d.text, d.crossCheck], ['fallback', 'AI_TIMEOUT', null, null]);
  const off = spies(Object.assign(new Error('AI_DISABLED'), { code: 'AI_DISABLED' }));
  await assert.rejects(lotseReading({ story }, { ...CTX, cfg: userOn() }, off.deps), { code: 'AI_DISABLED' });
  // people as handles unless names are allowed
  const pa = SKILLS.planningAdvice.run(ctx, { team: 't-ux' }, 'de');
  const seen = spies('Kein Befund.');
  await lotseReading({ story: pa }, { ...CTX, cfg: userOn() }, seen.deps);
  for (const p of pa.entities.people) assert.ok(!seen.s.llm[0].user.includes(p.name), p.name);
  const named = spies('Kein Befund.');
  await lotseReading({ story: pa }, { ...CTX, cfg: userOn({ shareNames: true }) }, named.deps);
  assert.ok(pa.entities.people.some((p) => named.s.llm[0].user.includes(p.name)));
});

test('lotse.llm is registered, read-only, gated first, and wired into the browser and the mock', async () => {
  const index = read('src/index.js');
  const body = index.slice(index.indexOf("def('lotse.llm'"), index.indexOf('\n});', index.indexOf("def('lotse.llm'")));
  assert.match(body, /^def\('lotse\.llm', async \(\{ payload, ctx, cfg(, roles)? \}\) => \{\n\s+requireAi\(cfg, 'lotse'\);/, 'the switch is the first step');
  assert.match(body, /lotseReading\(payload, \{ accountId: ctx\.accountId, cfg \}, \{ llm, takeQuota, dropCached, audit \}\)/, 'the real quota and the one LLM gateway');
  assert.match(read('src/lib/aiAssist.js') + read('shared/lotse/llm.js'), /await deps\.takeQuota\(ctx\.accountId, cfg\)/);
  assert.ok(READ_RESOLVERS.has('lotse.llm'));
  assert.match(read('static/cockpit/src/lib/api.js'), /'lotse\.llm'\]\);/);
  const mock = read('static/cockpit/src/lib/mock.js');
  assert.match(mock, /case 'lotse\.llm':/);
  assert.match(mock, /'playbookDraft', 'lotse'\]\.map/);
  assert.match(read('static/cockpit/src/components/AiSettings.jsx'), /\['lotse', '[a-z]+', 'Lotse: /);
  // through the real resolver: AI off → refused before anything else
  const { handlers } = await import('../src/index.js');
  await assert.rejects(handlers['lotse.llm']({ payload: { story }, ctx: CTX, cfg: DEFAULT_CONFIG, roles: {} }), { code: 'AI_DISABLED' });
  await assert.rejects(handlers['lotse.llm']({ payload: { story }, ctx: CTX, cfg: on({ features: { ...DEFAULT_CONFIG.ai.features, lotse: false } }), roles: {} }), { code: 'AI_DISABLED' });
});
