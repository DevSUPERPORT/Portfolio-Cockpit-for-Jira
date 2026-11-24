// "Ich will …": wish phrasing (DE/EN) lands on the right card, every card is visual and explains itself, unknown wishes
// get the closest suggestions; the optional AI intent parser only ever picks a catalogue card with the user's own teams
// and projects; support playbooks (template, AI draft, storage with rights and undo) and the resolver wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAll } from '../shared/engine.js';
import { answer, parseQuestion, closestQuestions, suggestions, hasData, wishStarters, WISH_CARDS, HISTORY_CARDS, wishSubject } from '../shared/ask.js';
import { ruleWish } from '../shared/wishCatalog.js';
import { buildFacts, promptFor, validateOutput, fallbackFor, ASSIST_FEATURES } from '../shared/aiAssist.js';
import { playbookTemplate, validPlaybook, canReadPlaybooks, canEditPlaybooks, playbookText, PLAYBOOK_LIMITS } from '../shared/playbooks.js';
import { supportTopics } from '../shared/insights.js';
import { mockHistory } from '../static/cockpit/src/lib/mockHistory.js';
import { DEFAULT_CONFIG, AI_FEATURES } from '../src/lib/config.js';
import { READ_RESOLVERS } from '../src/lib/maintenance.js';

globalThis.__forge_runtime__ = { appContext: { appId: 'ari:cloud:ecosystem::app/test', environmentType: 'DEVELOPMENT', environmentId: 'test', invocationId: 'test', installationId: 'test', moduleKey: 'pc-cockpit', permissions: { scopes: [] } }, lambdaContext: { getRemainingTimeInMillis: () => 25000 }, proxy: { token: '', url: 'http://127.0.0.1:9' }, metrics: { counter: () => ({ incr() {} }) }, tracing: {} };
const { assist } = await import('../src/lib/aiAssist.js');
const { savePlaybook, deletePlaybook, listPlaybooks, PLAYBOOKS_KEY } = await import('../src/lib/playbooks.js');

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const g = JSON.parse(read('tests/golden/golden.json'));
const c = computeAll(g);
const history = mockHistory({ today: Math.floor(Date.parse(`${g.today}T00:00:00Z`) / 864e5) });
const fmt = { pct: (v) => (v == null ? '–' : `${Math.round(v * 100)} %`), h: (v) => (v == null ? '–' : `${Math.round(v)} h`), n: (v) => String(v), signedPct: (v) => String(v), date: (d) => String(d), quarter: (q) => q, week: (w) => w };
const ctx = (lang = 'de', h = history) => ({ computed: c, ds: g, lang, fmt, ruleName: (r) => r, me: null, roles: { viewReport: true }, supportA: null, history: h, historyState: h ? 'ready' : 'idle' });
const intentOf = (q) => parseQuestion(q, { model: c.model, quarters: c.wl.quarters }).intent;

test('wish phrasing in German and English lands on the right card', () => {
  const W = [
    ['Ich will Ressourcen realistisch planen', 'realCapacity'], ['I want to plan resources realistically', 'realCapacity'], ['Wie viel Zeit haben wir wirklich nach Abzug des Supports?', 'realCapacity'], ['Show me the real capacity per team', 'realCapacity'],
    ['Ich will wissen, ob wir das schaffen', 'fitsNoOvertime'], ['Was passt ohne Überstunden?', 'fitsNoOvertime'], ['I want to know what fits without overtime', 'fitsNoOvertime'], ['Will we make it?', 'fitsNoOvertime'],
    ['Ich will Überstunden vermeiden', 'overtime'], ['I want to avoid overtime', 'overtime'], ['Wer macht bald Überstunden?', 'overtime'], ['I need to avoid burnout in my team', 'overtime'],
    // live finding: "late" alone meant overdue – working late is overtime
    ['I want my people to stop working late nights', 'overtime'], ['Ich will nicht, dass mein Team abends arbeiten muss', 'overtime'], ['Keine Wochenendarbeit mehr', 'overtime'],
    ['Ich möchte schätzen wie früher: Schnittstelle zum Lager', 'similarWork'], ['I want to estimate like before: warehouse interface', 'similarWork'], ['Wie lange dauert eine neue App-Anmeldung?', 'similarWork'], ['Show me similar past work for a login page', 'similarWork'],
    ['Ich brauche Playbooks für den Support', 'supportTopics'], ['Zeig mir wiederkehrende Support-Themen', 'supportTopics'], ['I want to see recurring support topics', 'supportTopics'], ['What are the most common support questions?', 'supportTopics'],
  ];
  const miss = W.filter(([q, want]) => intentOf(q) !== want).map(([q, want]) => `${q} → ${intentOf(q)} (want ${want})`);
  assert.deepEqual(miss, []);
  // the older questions keep their cards
  assert.equal(intentOf('Can we do all projects this quarter?'), 'waterline');
  assert.equal(intentOf('Schätzung gegen gebuchte Zeit'), 'hours');
  assert.equal(intentOf('Wie ausgelastet sind die Teams?'), 'utilization');
  assert.equal(intentOf('Ich will wissen, wer am langsamsten arbeitet'), 'guard', 'rating people stays declined, even as a wish');
  // typo-tolerant
  assert.equal(intentOf('Ich will Uberstunden vermeiden'), 'overtime');
});

test('the work to estimate is taken from the wish', () => {
  assert.equal(wishSubject('Ich will schätzen wie früher: Neues Händlerportal'), 'Neues Händlerportal');
  assert.equal(wishSubject('I want to estimate like before "warehouse interface"'), 'warehouse interface');
  assert.equal(wishSubject('Wie lange dauert eine Schnittstelle zum Lager?'), 'eine Schnittstelle zum Lager');
  assert.equal(wishSubject('Schätze den Aufwand für eine Schnittstelle zum Lager wie früher'), 'eine Schnittstelle zum Lager');
});

test('every wish card is visual, says what it shows in one sentence and explains its calculation (DE and EN)', () => {
  const qs = ['Ich will Ressourcen realistisch planen', 'Ich will wissen, ob wir das schaffen', 'Ich will Überstunden vermeiden', 'Ich will schätzen wie früher: Passwort-Reset per SMS', 'Ich will wiederkehrende Support-Themen sehen'];
  for (const lang of ['de', 'en']) {
    for (const q of qs) {
      const a = answer(q, ctx(lang));
      assert.ok(a, q);
      assert.ok(HISTORY_CARDS.has(a.intent), `${q}: ${a.intent}`);
      assert.equal(a.source, 'rule', 'computed by the app');
      assert.ok(a.needsHistory, 'the UI loads the history for it');
      assert.ok(a.answer && !/undefined|NaN/.test(a.answer), `${q}: ${a.answer}`);
      assert.ok(a.info?.title && a.info.text && Array.isArray(a.info.inputs), `${q}: hover card`);
      assert.ok(a.views.includes(a.view) && a.view !== 'text' && hasData(a, a.view), `${q}: first view ${a.view} has data`);
      for (const v of a.views) assert.ok(v === 'text' || hasData(a, v), `${q}: ${v}`);
      assert.ok(a.desc, `${q}: one-sentence description of the chart`);
    }
  }
  const s = answer('Ich will schätzen wie früher: Passwort-Reset per SMS', ctx('de'));
  assert.ok(s.data.similar.items.length > 0 && s.data.similar.items.every((x) => x.key && x.actualH >= 0));
  assert.ok(!JSON.stringify(s.data.similar).includes('"text"'), 'comments only as counts');
});

test('without history the wish cards still answer (current data only) and say so', () => {
  for (const q of ['I want to plan resources realistically', 'I want to avoid overtime', 'I want to know what fits without overtime']) {
    const a = answer(q, ctx('en', null));
    assert.ok(a && a.answer, q);
    assert.match(a.info.inputs.map((x) => x.join(' ')).join(' '), /current data only/);
  }
  const s = answer('I want to estimate like before', ctx('en'));
  assert.equal(s.intent, 'similarWork');
  assert.match(s.answer, /Add what should be estimated/, 'no subject: a hint, never an empty screen');
});

test('unknown wishes get the closest suggestions – the wish starters first; the empty canvas shows the wishes', () => {
  for (const [q, L] of [['I want a pony', 'en'], ['Ich will, dass mein Team glücklicher ist', 'de']]) {
    assert.equal(answer(q, ctx(L)), null);
    const near = closestQuestions(q, ctx(L));
    assert.ok(near.length >= 3, q);
  }
  assert.ok(closestQuestions('I want overtime gone', ctx('en'))[0].includes('overtime'));
  const s = suggestions({ computed: c, roles: { viewReport: true }, lang: 'de', hasSupport: true });
  assert.equal(s[0].group, 'Ich will …');
  assert.deepEqual(s.filter((x) => x.group === 'Ich will …').map((x) => x.q), wishStarters('de').map((x) => x.q));
  for (const w of wishStarters('en')) if (!/:\s*$/.test(w.q)) assert.equal(intentOf(w.q), w.card, w.q);
});

test('a card chosen by the AI intent parser is the app\'s own card, marked as AI', () => {
  const team = [...c.model.teams.values()].find((t) => t.id !== '_none');
  const a = answer('Mach mir das Leben leichter', ctx('de'), { force: { intent: 'realCapacity', team: team.id } });
  assert.equal(a.intent, 'realCapacity');
  assert.equal(a.source, 'ai');
  assert.equal(a.parsed.team, team.id);
  assert.equal(answer('Mach mir das Leben leichter', ctx('de'), { force: { intent: 'dropTables' } }), null, 'an unknown card is never rendered');
});

// ---------- AI features ----------
const share0 = { names: false, texts: false }, share1 = { names: true, texts: true };
const intentPayload = () => ({ wish: 'Wie geht es Team Web mit Projekt Phoenix? token: abc123', teams: [{ id: 'web', name: 'Web' }, { id: 'ux', name: 'UX' }], projects: [{ ref: 'issue:9001', key: 'TEL-1', name: 'Projekt Phoenix', rank: 1 }, { ref: 'DROP', key: 'X-1', name: 'x', rank: 2 }] });

test('AI features are listed, off by default and switchable one by one', () => {
  for (const f of ['intent', 'similarSummary', 'playbookDraft']) {
    assert.ok(ASSIST_FEATURES.includes(f) && AI_FEATURES.includes(f), f);
    assert.equal(DEFAULT_CONFIG.ai.enabled, false);
  }
  assert.match(read('static/cockpit/src/lib/aiFlags.js'), /'intent', 'similarSummary', 'playbookDraft'/);
});

test('intent: only a catalogue card, only the user\'s teams/projects as handles; projects without texts as rank + key', () => {
  const b = buildFacts('intent', intentPayload(), { share: share0 });
  const sent = promptFor(b, 'de').user;
  assert.ok(!JSON.stringify(b.facts.projects).includes('Phoenix') && sent.includes('#1 TEL-1'), 'project names only with texts (the wish itself is the user\'s own words)');
  assert.ok(JSON.stringify(buildFacts('intent', intentPayload(), { share: share1 }).facts.projects).includes('Projekt Phoenix (#1)'));
  assert.ok(!sent.includes('abc123'), 'secrets in the wish are redacted');
  assert.equal(b.facts.projects.length, 1, 'malformed refs are not sent');
  assert.deepEqual(b.facts.cards.map((x) => x.id), WISH_CARDS.map((x) => x.id));
  const ok = validateOutput(b, { card: 'overtime', team: 'T1', project: 'R1', why: 'Team genannt', confidence: 'high' });
  assert.deepEqual([ok.card, ok.teamId, ok.projectRef], ['overtime', 'web', 'issue:9001']);
  const odd = validateOutput(b, { card: 'similarWork', team: 'T9', project: 'R7', text: 'Login-Seite' });
  assert.deepEqual([odd.teamId, odd.projectRef, odd.subject, odd.rejected], [null, null, 'Login-Seite', 2], 'invented handles are dropped');
  assert.throws(() => validateOutput(b, { card: 'deleteEverything' }), { code: 'AI_INVALID' });
  assert.equal(validateOutput(b, { card: null, why: 'passt nicht' }).card, null, 'no card → the UI shows the closest questions');
  // fallback = the app's own wish rules
  const fb = fallbackFor(buildFacts('intent', { wish: 'Ich will Überstunden vermeiden' }, { share: share0 }), 'de');
  assert.equal(fb.card, 'overtime');
  assert.equal(ruleWish('i want to avoid overtime'), 'overtime');
});

const simPayload = () => ({ subject: 'Login für Erika Mustermann', items: [{ id: '101', key: 'TEL-12', summary: 'Login-Seite Erika', actualH: 20, estimateH: 16, overrunPct: 25, days: 8, comments: 2 }, { id: '102', key: 'TEL-13', summary: 'Export', actualH: 10, estimateH: 10, overrunPct: 0, days: 4, comments: 0 }], stats: { medianActualH: 15, p80ActualH: 20, typicalOverrunPct: 12, medianDurationWorkdays: 6 } });
const on = (over = {}) => ({ ...DEFAULT_CONFIG, setupComplete: true, ai: { ...DEFAULT_CONFIG.ai, enabled: true, features: { ...DEFAULT_CONFIG.ai.features }, ...over } });
function spies(answerText) {
  const s = { llm: [], comments: [] };
  return { s, deps: { llm: async (system, user) => { s.llm.push(user); return answerText; }, takeQuota: async () => {}, audit: async () => {}, loadDs: async () => { throw new Error('no dataset'); }, loadComments: async (ids) => { s.comments.push(ids); return { 101: { count: 2, last: [{ text: 'Mapping-Tabelle im Wiki, siehe https://wiki.example.com/x – Mail an anna@example.com' }] } }; } } };
}

test('similarSummary: comment texts only when texts are allowed – loaded on the server, scrubbed; numbers always', async () => {
  const off = spies('{"summary":"Typisch 15 h.","basedOn":["TEL-12","TEL-99"]}');
  const r0 = await assist('similarSummary', simPayload(), { accountId: 'a', cfg: on() }, off.deps);
  assert.equal(off.s.comments.length, 0, 'no comments loaded without the text permission');
  assert.ok(!off.s.llm[0].includes('Erika') && !off.s.llm[0].includes('Mapping'));
  assert.deepEqual(r0.basedOn, ['TEL-12'], 'only keys from the facts');
  const yes = spies('{"summary":"Mapping im Wiki half."}');
  await assist('similarSummary', simPayload(), { accountId: 'a', cfg: on({ shareTexts: true }) }, yes.deps);
  assert.deepEqual(yes.s.comments, [['101', '102']]);
  assert.ok(yes.s.llm[0].includes('Mapping-Tabelle im Wiki') && !yes.s.llm[0].includes('wiki.example.com') && !yes.s.llm[0].includes('anna@example.com'));
  const fb = fallbackFor(buildFacts('similarSummary', simPayload(), { share: share0 }), 'en');
  assert.match(fb.text, /2 similar finished items\. Typically 15 h/);
});

test('playbookDraft: validated draft; template fallback; ticket summaries only with texts', async () => {
  const p = { topic: { id: 't:passwort', name: 'Passwort Reset', count: 6, spentTotal: 9, spentMedian: 1.5, trend: 'rising', open: 1 }, examples: [{ key: 'SUP-1', summary: 'Passwort-Reset kommt nicht an – Erika' }, { key: 'SUP-2', summary: 'Passwort-Reset kommt nicht an' }, { key: 'bad key', summary: 'x' }] };
  const b0 = buildFacts('playbookDraft', p, { share: share0 });
  assert.ok(!promptFor(b0, 'de').user.includes('Erika') && !promptFor(b0, 'de').user.includes('Passwort'), 'no texts without permission');
  assert.equal(b0.facts.examples.length, 2);
  assert.ok(promptFor(buildFacts('playbookDraft', p, { share: share1 }), 'de').user.includes('Passwort-Reset kommt nicht an'));
  const v = validateOutput(b0, { title: 'Passwort zurücksetzen', symptoms: ['Mail fehlt'], steps: ['Spam prüfen', '[Schritt ergänzen]'], reply: 'Hallo, bitte prüfe deinen Spam-Ordner. [Name]' });
  assert.deepEqual(v.draft.steps, ['Spam prüfen', '[Schritt ergänzen]']);
  assert.throws(() => validateOutput(b0, { title: 'x' }), { code: 'AI_INVALID' }, 'no reply and no steps is no draft');
  const fb = fallbackFor(b0, 'de');
  assert.ok(!/\d+ Mal/.test(fb.draft.reply) && fb.draft.steps.some((s) => /^\[/.test(s)) && fb.draft.symptoms[0].includes('Passwort-Reset kommt nicht an'));
  const down = { llm: async () => { throw Object.assign(new Error('x'), { code: 'AI_TIMEOUT' }); }, takeQuota: async () => {}, audit: async () => {} };
  const r = await assist('playbookDraft', p, { accountId: 'a', cfg: on() }, down);
  assert.equal(r.source, 'fallback');
  assert.ok(r.draft.reply.length > 20);
});

// ---------- playbooks ----------
test('playbook template: symptoms from the ticket summaries, steps as placeholders, a customer reply without internal figures', () => {
  const st = supportTopics(history.support, { minCount: 3, lang: 'de', today: g.today });
  const topic = st.topics.find((x) => x.playbook);
  assert.ok(topic, 'the demo history has playbook candidates');
  const t = playbookTemplate(topic, { tickets: history.support, lang: 'de' });
  assert.ok(t.title.includes(topic.name) && t.topic === topic.id);
  assert.ok(t.symptoms.length >= 1 && t.symptoms.length <= 5);
  const summaries = new Set(history.support.filter((x) => topic.ids.includes(x.id)).map((x) => x.summary));
  assert.ok(t.symptoms.every((s) => summaries.has(s.replace(/ \(\d+×\)$/, ''))), 'symptoms are the tickets\' own words');
  assert.ok(t.steps.filter((s) => s.startsWith('[')).length >= 2, 'what the data cannot know is a visible placeholder');
  assert.ok(!t.reply.includes(`${topic.count} `) && !/\d+([,.]\d+)? h\b/.test(t.reply) && !/\(.*\)/.test(t.reply.split('\n')[2]) && t.reply.includes('[Name]'), 'no ticket count, hours or request type for the customer');
  assert.ok(t.why.includes(String(topic.count)), 'the numbers stay in the internal reasoning');
  assert.match(t.why, /Vorlage der App/, 'the draft says how it was made');
  const en = playbookTemplate(topic, { tickets: history.support, lang: 'en' });
  assert.match(en.reply, /^Hello,/);
  assert.match(playbookText({ ...t, symptoms: t.symptoms, steps: t.steps }, 'de'), /Standardantwort/);
});

test('playbooks: valid shape, rights, every save and delete returns what undo needs', async () => {
  assert.throws(() => validPlaybook({ title: '  ' }), { code: 'INVALID' });
  const v = validPlaybook({ title: 'x'.repeat(500), symptoms: Array(30).fill('a'), keys: ['SUP-1', 'DROP TABLE'], reply: 'r'.repeat(5000), source: 'evil' });
  assert.equal(v.title.length, PLAYBOOK_LIMITS.title);
  assert.equal(v.symptoms.length, PLAYBOOK_LIMITS.list);
  assert.deepEqual(v.keys, ['SUP-1']);
  assert.equal(v.reply.length, PLAYBOOK_LIMITS.reply);
  assert.equal(v.source, 'rule');
  assert.equal(canReadPlaybooks({ rights: ['mine'] }), false);
  assert.equal(canReadPlaybooks({ rights: ['support'] }), true);
  assert.equal(canEditPlaybooks({ rights: ['support'] }), false, 'reading does not mean changing');
  assert.equal(canEditPlaybooks({ rights: ['support'], dispatch: true }), true);
  assert.equal(canEditPlaybooks({ admin: true }), true);

  const store = new Map(), audit = [];
  const deps = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, structuredClone(v)); }, audit: async (_c, a, d) => { audit.push([a, d]); }, now: () => '2026-11-11T10:00:00.000Z' };
  const editor = { accountId: 'a', displayName: 'Anna', roles: { rights: ['support'], dispatch: true } };
  const reader = { accountId: 'b', roles: { rights: ['support'] } };
  await assert.rejects(savePlaybook({ playbook: { title: 'x' } }, reader, deps), { code: 'NO_ACCESS' });
  await assert.rejects(listPlaybooks({ roles: { rights: ['mine'] } }, deps), { code: 'NO_ACCESS' });
  const s1 = await savePlaybook({ playbook: { title: 'Passwort', reply: 'Hallo', id: 'pb-forged01' } }, editor, deps);
  assert.equal(s1.previous, null);
  assert.notEqual(s1.playbook.id, 'pb-forged01', 'a new playbook gets its own id');
  const s2 = await savePlaybook({ playbook: { ...s1.playbook, title: 'Passwort zurücksetzen' } }, editor, deps);
  assert.equal(s2.previous.title, 'Passwort', 'undo of a change = save the previous version');
  assert.equal((await listPlaybooks(reader, deps)).items.length, 1);
  assert.equal((await listPlaybooks(reader, deps)).canEdit, false);
  const d = await deletePlaybook({ id: s1.playbook.id }, editor, deps);
  assert.equal(store.get(PLAYBOOKS_KEY).items.length, 0);
  const back = await savePlaybook({ playbook: d.deleted, restore: true }, editor, deps);
  assert.equal(back.playbook.id, s1.playbook.id, 'undo of a delete restores the same playbook');
  assert.deepEqual(audit.map((x) => x[0]), ['playbooks.save', 'playbooks.save', 'playbooks.delete', 'playbooks.save']);
  assert.ok(!JSON.stringify(audit).includes('Hallo'), 'the audit names the title, never the text');
  await assert.rejects(deletePlaybook({ id: 'pb-unknown1' }, editor, deps), { code: 'NOT_FOUND' });
});

// ---------- wiring ----------
test('resolvers are registered, classified and known to the client and the mock', () => {
  const src = read('src/index.js');
  for (const r of ['insights.history', 'insights.comments', 'playbooks.list', 'playbooks.save', 'playbooks.delete']) assert.match(src, new RegExp(`def\\('${r.replace('.', '\\.')}'`), r);
  for (const r of ['insights.history', 'insights.comments', 'playbooks.list']) assert.ok(READ_RESOLVERS.has(r), `${r} is a read`);
  for (const w of ['playbooks.save', 'playbooks.delete']) assert.ok(!READ_RESOLVERS.has(w), `${w} is a write`);
  const api = read('static/cockpit/src/lib/api.js'), mock = read('static/cockpit/src/lib/mock.js');
  for (const r of ['insights.history', 'insights.comments', 'playbooks.list']) { assert.ok(api.includes(`'${r}'`), `api READS ${r}`); assert.ok(mock.includes(`case '${r}'`), `mock ${r}`); }
  for (const w of ['playbooks.save', 'playbooks.delete']) { assert.ok(!/const READS = new Set\([^)]*'playbooks\.(save|delete)'/.test(api), w); assert.ok(mock.includes(`case '${w}'`), `mock ${w}`); }
  // comment texts only with the admin's text permission, decided on the server
  assert.match(src, /texts: payload\.texts === true && cfg\.ai\?\.enabled === true && cfg\.ai\?\.shareTexts === true/);
  // nothing is posted to a ticket by the playbooks
  assert.ok(!/\/comment|jira\(/.test(read('src/lib/playbooks.js')));
});

test('UI: wish cards show their source and calculation; playbooks have undo; no exit animations; bilingual', () => {
  const ask = read('static/cockpit/src/views/Ask.jsx'), pb = read('static/cockpit/src/components/SupportPlaybooks.jsx'), sup = read('static/cockpit/src/views/Support.jsx');
  assert.match(ask, /Regel der App/);
  assert.match(ask, /KI-Zuordnung/);
  assert.match(ask, /tip\(card\)/);
  assert.match(ask, /feature: 'intent'/);
  assert.ok(!/AnimatePresence/.test(pb), 'no exit animations in the playbooks');
  assert.equal((pb.match(/done\(/g) || []).length, 2, 'save and delete, each with its own undo');
  assert.match(pb, /Antwort kopieren/);
  assert.match(pb, /feature="playbookDraft"/);
  assert.ok(!/<pre\b/.test(pb), 'no <pre> in the (possibly disabled) form');
  assert.match(sup, /value: 'playbooks'/);
  for (const f of [pb, read('shared/wishCatalog.js'), read('shared/playbooks.js'), read('src/lib/playbooks.js')]) assert.doesNotMatch(f, /rovo/i);
});
