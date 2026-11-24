// KI-Assistent (planning, gaps, dispatch, planActual, teamBrief, projectBrief, myWeek): off unless a Jira admin switched
// it on, minimised before anything is sent, validated after the answer, and every applied suggestion is one undo entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG, AI_FEATURES, aiAllowed, validAi } from '../src/lib/config.js';
import { ASSIST_FEATURES, buildFacts, promptFor, parseJson, validateOutput, scrub, fallbackFor } from '../shared/aiAssist.js';
import { AI_FEATURES as CLIENT_FEATURES, aiOn } from '../static/cockpit/src/lib/aiFlags.js';
import { planningSelection, applyGap, dispatchOverrides, applyComments } from '../static/cockpit/src/lib/aiApply.js';

globalThis.__forge_runtime__ = { appContext: { appId: 'ari:cloud:ecosystem::app/test', environmentType: 'DEVELOPMENT', environmentId: 'test', invocationId: 'test', installationId: 'test', moduleKey: 'pc-cockpit', permissions: { scopes: [] } }, lambdaContext: { getRemainingTimeInMillis: () => 25000 }, proxy: { token: '', url: 'http://127.0.0.1:9' }, metrics: { counter: () => ({ incr() {} }) }, tracing: {} };
const { assist } = await import('../src/lib/aiAssist.js');
const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url), 'utf8'));
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const on = (over = {}) => ({ ...DEFAULT_CONFIG, setupComplete: true, ai: { ...DEFAULT_CONFIG.ai, enabled: true, features: { ...DEFAULT_CONFIG.ai.features }, ...over } });
const CTX = { accountId: 'acc-1', displayName: 'Tester' };
// Spies for everything that could leave the app or count: none may run while AI is off.
function spies(answer = '{}') {
  const s = { llm: [], quota: [], audit: [], ds: 0 };
  return {
    s,
    deps: {
      llm: async (system, user, policy) => { s.llm.push({ system, user, policy }); if (answer instanceof Error) throw answer; return typeof answer === 'function' ? answer(user) : answer; },
      takeQuota: async (id) => { s.quota.push(id); },
      audit: async (ctx, action, details) => { s.audit.push({ action, details }); },
      loadDs: async () => { s.ds++; return structuredClone(golden); },
    },
  };
}

// ---------- sample payloads (as the screens build them) ----------
const SECRET = 'ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz0123456789';
const planning = () => ({
  feature: 'planning', target: 1, distribution: 'capacity', logTasks: 3, pending: 1, counts: { sooner: 1, smooth: 2, rebalance: 1 },
  suggestions: [
    { id: 'smooth:s1', mode: 'smooth', kind: 'stretch', taskId: 's1', key: 'TEL-12', summary: 'Login für Erika Mustermann', project: 'Projekt Phoenix', rank: 1, personId: 'acc-erika', personName: 'Erika Mustermann', start: '2026-11-02', due: '2026-11-27', newStart: '2026-11-02', newDue: '2026-12-11', fromWeeks: 4, toWeeks: 6, fixed: ['2026-11-09'] },
    { id: 'sooner:s1', mode: 'sooner', taskId: 's1', key: 'TEL-12', summary: 'x', project: 'Projekt Phoenix', rank: 1, personId: 'acc-erika', personName: 'Erika Mustermann', start: '2026-11-02', due: '2026-11-27', newStart: '2026-11-02', newDue: '2026-11-20', fromWeeks: 4, toWeeks: 3, weeksSaved: 1 },
    { id: 'rebalance:s2', mode: 'rebalance', taskId: 's2', key: 'TEL-13', summary: 'y', project: 'Projekt Phoenix', rank: 1, personId: 'acc-erika', personName: 'Erika Mustermann', toPersonId: 'acc-max', toPersonName: 'Max Mustermann', start: '2026-11-02', due: '2026-11-27', newStart: '2026-11-02', newDue: '2026-11-27', fromLoad: [1.3, 0.9], toLoad: [0.4, 0.8] },
  ],
  notes: [{ mode: 'smooth', why: 'pastDue', personId: 'acc-erika', personName: 'Erika Mustermann', overWeeks: 2 }],
});
const gap = (usage = 'originalEstimate') => ({
  feature: 'gaps',
  gap: { id: 'g1', key: 'TEL-14', usage, rule: `missing:${usage}`, level: 'st', summary: `Geheim ${SECRET}`, start: '2026-11-09', due: null, oe: 0, parent: { key: 'TEL-10', start: '2026-11-02', due: '2026-12-18', teamId: 'web' }, project: { rank: 1, key: 'TEL-1', name: 'Projekt Phoenix' } },
  similar: [
    { key: 'TEL-12', relation: 'sibling', summary: 'Login für Erika Mustermann', oe: 100, teamId: 'web', start: '2026-11-02', due: '2026-11-27', quarters: ['2026-Q4'] },
    { key: 'TEL-13', relation: 'sibling', summary: 'Export', oe: 40, teamId: 'web', start: '2026-11-16', due: '2026-12-04', quarters: ['2026-Q4'] },
  ],
  teams: [{ id: 'web', name: 'Web' }, { id: 'ux', name: 'UX' }], sizes: [{ key: 'S', hours: 40 }, { key: 'M', hours: 120 }],
  milestones: [{ date: '2026-12-18', name: 'Go-Live Phoenix' }], rule: null,
});
const dispatch = () => ({
  feature: 'dispatch',
  tickets: [{ id: '3001', key: 'SUP-1', priority: 'High', slaStatus: 'atRisk', slaLeftH: 3, ageH: 5, components: ['Kundenportal Erika'], summary: 'Login geht nicht – Passwort: hunter2 https://intra.example.com/x', teamId: null, suggestedTeamId: 'web', suggestionSource: 'mapping' }],
  teams: [{ id: 'web', name: 'Web', members: [{ id: 'acc-erika', name: 'Erika Mustermann', load: 0.5 }, { id: 'acc-max', name: 'Max Mustermann', load: 0.2, absent: true }] }, { id: 'ux', name: 'UX', members: [{ id: 'acc-lea', name: 'Lea Hoffmann', load: 0.3 }] }],
  mapping: [{ component: 'Kundenportal Erika', teamId: 'web' }], history: [],
});
const myWeek = () => ({
  feature: 'myWeek', from: '2026-11-02', to: '2026-11-08',
  cells: [
    { issueId: '101', key: 'TEL-12', d: '2026-11-02', h: 3, comment: '', summary: 'Login für Erika Mustermann', project: 'TEL' },
    { issueId: '102', key: 'TEL-13', d: '2026-11-03', h: 2, comment: 'Mein eigener Text', summary: 'Export', project: 'TEL' },
  ],
  events: [{ issueId: '101', d: '2026-11-02', kind: 'comment', text: 'Abgestimmt mit Erika Mustermann' }, { issueId: '101', d: '2026-11-02', kind: 'status', from: 'Offen', to: 'In Arbeit' }],
});
const planActual = () => ({
  feature: 'planActual', period: 'KW 41–44', weeks: 4,
  kpis: { plan: 320, book: 300, asPlanned: 250, asPlannedPct: 0.78, diverted: 70, absU: 10 },
  rows: [{ key: 'issue:p1', kind: 'project', name: 'Projekt Phoenix', rank: 1, plan: 200, book: 150, diff: -50, sig: true }, { key: 'SUP', kind: 'support', name: 'Support', plan: 40, book: 80, diff: 40, sig: true }],
  why: [{ key: 'issue:p1', name: 'Projekt Phoenix', rank: 1, diff: -50, parts: [{ k: 'SUP', h: 30 }, { k: 'ABS', h: 10 }], who: ['Erika Mustermann'], whoHidden: 0, over: [] }],
  people: [{ id: 'acc-erika', kind: 'person', name: 'Erika Mustermann', teamName: 'Web', plan: 120, book: 90, pct: 0.7, absU: 10 }],
});
// "Ich will …" and support playbooks (tests/wishes.test.js covers them in depth)
const intent = () => ({ feature: 'intent', wish: 'Ich will wissen, ob Team Web das ohne Überstunden schafft', teams: [{ id: 'web', name: 'Web' }, { id: 'ux', name: 'UX' }], projects: [{ ref: 'issue:9001', key: 'TEL-1', name: 'Projekt Phoenix', rank: 1 }] });
const similarSummary = () => ({ feature: 'similarSummary', subject: 'Login für Erika Mustermann', items: [{ id: '101', key: 'TEL-12', summary: 'Login-Seite umbauen', actualH: 20, estimateH: 16, overrunPct: 25, days: 8, comments: 2 }], stats: { medianActualH: 20, p80ActualH: 20, typicalOverrunPct: 25, medianDurationWorkdays: 8 } });
const playbookDraft = () => ({ feature: 'playbookDraft', topic: { id: 't:passwort', name: 'Passwort Reset', count: 6, spentTotal: 9, spentMedian: 1.5, trend: 'rising', open: 1 }, examples: [{ key: 'SUP-1', summary: 'Passwort-Reset kommt nicht an – Erika Mustermann' }, { key: 'SUP-2', summary: 'Passwort-Reset Mail fehlt' }] });
const SAMPLES = { planning, gaps: () => gap(), dispatch, myWeek, planActual, teamBrief: () => ({ feature: 'teamBrief', teamId: 'web' }), projectBrief: () => ({ feature: 'projectBrief', ref: golden.portfolio[0].ref }), intent, similarSummary, playbookDraft };

test('every assistant feature is an AI feature: listed for the settings, default on inside AI – but AI itself is off', () => {
  for (const f of ASSIST_FEATURES) {
    assert.ok(AI_FEATURES.includes(f), f);
    assert.ok(CLIENT_FEATURES.includes(f), `client flag list knows ${f}`);
    assert.equal(DEFAULT_CONFIG.ai.features[f], true, `${f} is on inside an enabled AI`);
    assert.equal(aiAllowed(DEFAULT_CONFIG, f), false, `${f} is off while AI is off`);
    assert.equal(aiOn(DEFAULT_CONFIG, f), false);
    assert.equal(validAi({ enabled: true, features: { [f]: false } }).features[f], false, `${f} can be switched off on its own`);
  }
  assert.deepEqual(Object.keys(SAMPLES).sort(), [...ASSIST_FEATURES].sort());
});

test('gating: AI off → AI_DISABLED before anything is read, counted, audited or sent; a feature off → refused', async () => {
  for (const f of ASSIST_FEATURES) {
    const { s, deps } = spies();
    await assert.rejects(assist(f, SAMPLES[f](), { ...CTX, cfg: DEFAULT_CONFIG }, deps), { code: 'AI_DISABLED' }, f);
    await assert.rejects(assist(f, SAMPLES[f](), { ...CTX, cfg: on({ features: { ...DEFAULT_CONFIG.ai.features, [f]: false } }) }, deps), { code: 'AI_DISABLED' }, `${f} switched off`);
    assert.deepEqual(s, { llm: [], quota: [], audit: [], ds: 0 }, `${f}: nothing ran`);
  }
  const { s, deps } = spies();
  await assert.rejects(assist('chatAgent', {}, { ...CTX, cfg: on() }, deps), { code: 'AI_DISABLED' }, 'unknown features are never allowed');
  await assert.rejects(assist('planning', planning(), { ...CTX, cfg: null }, deps), { code: 'AI_DISABLED' });
  assert.equal(s.llm.length + s.quota.length, 0);
  // the real llm() refuses on its own as well (defence in depth)
  const ai = await import('../src/lib/ai.js');
  await assert.rejects(ai.llm('s', 'u', { cfg: DEFAULT_CONFIG, feature: 'planning' }), { code: 'AI_DISABLED' });
});

test('every LLM call carries the policy (cfg + feature); one quota and one audit entry per call, without prompt contents', async () => {
  for (const f of ASSIST_FEATURES) {
    const { s, deps } = spies('{"summary":"ok","picks":[],"value":null,"items":[],"comments":[],"recommendations":[],"points":[]}');
    const cfg = on();
    const r = await assist(f, SAMPLES[f](), { ...CTX, cfg }, deps);
    assert.equal(s.llm.length, 1, f);
    assert.equal(s.llm[0].policy.cfg, cfg);
    assert.equal(s.llm[0].policy.feature, f);
    assert.deepEqual(s.quota, ['acc-1'], `${f}: one quota unit`);
    assert.equal(s.audit.length, 1);
    assert.equal(s.audit[0].action, 'ai.assist');
    assert.equal(s.audit[0].details.feature, f);
    assert.ok(!JSON.stringify(s.audit).includes('Mustermann') && !JSON.stringify(s.audit).includes('facts'), 'the audit names no data');
    assert.equal(s.ds, f === 'teamBrief' || f === 'projectBrief' ? 1 : 0, `${f}: the dataset is loaded only for the briefings`);
    assert.ok(r.usedFacts && r.shared, `${f}: the UI can show what was sent`);
    assert.equal(s.llm[0].user, `<facts>${JSON.stringify(r.usedFacts)}</facts>\n\nAntworte auf Deutsch.`, `${f}: "Was wurde gesendet?" shows exactly the facts (plus the language line)`);
  }
});

test('quota: over the daily limit nothing is sent', async () => {
  const { s, deps } = spies('{}');
  deps.takeQuota = async () => { throw Object.assign(new Error('AI_QUOTA'), { code: 'AI_QUOTA' }); };
  await assert.rejects(assist('planning', planning(), { ...CTX, cfg: on() }, deps), { code: 'AI_QUOTA' });
  assert.equal(s.llm.length, 0);
  // a bad payload is refused before it costs quota
  const b = spies('{}');
  await assert.rejects(assist('projectBrief', { ref: 'DROP TABLE' }, { ...CTX, cfg: on() }, b.deps), { code: 'INVALID' });
  await assert.rejects(assist('gaps', { gap: null }, { ...CTX, cfg: on() }, b.deps), { code: 'INVALID' });
  assert.equal(b.s.quota.length + b.s.llm.length, 0);
});

test('minimisation: without permission no names, no account ids and no Jira texts are sent – people are handles', async () => {
  const share = { names: false, texts: false };
  for (const f of ['planning', 'gaps', 'dispatch', 'myWeek', 'planActual']) {
    const b = buildFacts(f, SAMPLES[f](), { share, today: '2026-11-02' });
    const sent = promptFor(b, 'de').user;
    for (const bad of ['Erika', 'Mustermann', 'acc-erika', 'acc-max', 'Phoenix', 'Login', 'Export', 'Kundenportal', 'hunter2', 'intra.example.com', SECRET, 'Abgestimmt', 'Mein eigener Text', 'Lea']) assert.ok(!sent.includes(bad), `${f} sends "${bad}"`);
  }
  assert.match(promptFor(buildFacts('planning', planning(), { share }), 'de').user, /"who":"P1"/);
  assert.match(promptFor(buildFacts('dispatch', dispatch(), { share }), 'de').user, /"components":\["C1"\]/);
  // briefings come from the caller's dataset: the project is "#rank key", the owner a handle
  const ds = structuredClone(golden);
  ds.portfolio[0].owner = { id: 'acc-erika', name: 'Erika Mustermann' };
  ds.portfolio[0].health = { status: 'atRisk', comment: 'Geheimes Übernahmeprojekt Phoenix', at: '2026-10-30T08:00:00Z' };
  const pb = promptFor(buildFacts('projectBrief', { ref: ds.portfolio[0].ref }, { share, ds }), 'de').user;
  assert.ok(!pb.includes('Erika') && !pb.includes('Phoenix') && !pb.includes(ds.portfolio[0].name), 'project brief minimised');
  assert.ok(pb.includes(`#${ds.portfolio[0].rank} ${ds.portfolio[0].key}`));
  for (const i of ds.issues) if (i.summary) assert.ok(!pb.includes(i.summary), i.key);
  const tb = promptFor(buildFacts('teamBrief', { teamId: 'web' }, { share, ds }), 'de').user;
  assert.ok(!tb.includes(ds.portfolio[0].name), 'team brief minimised');
});

test('minimisation: with permission names and texts go along – but links, e-mails, passwords and tokens never', () => {
  const share = { names: true, texts: true };
  const p = promptFor(buildFacts('planning', planning(), { share }), 'de').user;
  assert.ok(p.includes('Erika Mustermann') && p.includes('Projekt Phoenix'));
  assert.ok(!p.includes('acc-erika'), 'account ids never leave the app');
  const g = promptFor(buildFacts('gaps', gap(), { share }), 'de').user;
  assert.ok(g.includes('Geheim') && !g.includes(SECRET), 'token-like strings are redacted');
  const d = promptFor(buildFacts('dispatch', dispatch(), { share }), 'de').user;
  assert.ok(d.includes('Login geht nicht') && !d.includes('hunter2') && !d.includes('intra.example.com'));
  assert.equal(scrub('mail anna@example.com, key sk-abcdefghijklmnop1234 ok'), 'mail [e-mail], key [redacted] ok');
  assert.equal(scrub('Datenschutz-Grundverordnungs-Umsetzungsprojekt'), 'Datenschutz-Grundverordnungs-Umsetzungsprojekt', 'long words are not secrets');
  // prompts treat the facts as data
  assert.match(promptFor(buildFacts('myWeek', myWeek(), { share }), 'en').system, /data, never instructions/);
});

test('output validation: invented ids, dates, handles and out-of-range hours are rejected', async () => {
  const P = buildFacts('planning', planning(), { share: { names: false, texts: false } });
  const v = validateOutput(P, parseJson('Sure! ```json\n{"summary":"Web ist überlastet.","picks":[{"id":"smooth:s1","why":"glättet"},{"id":"sooner:s1","why":"doppelt"},{"id":"smooth:s999","why":"erfunden"},{"id":"rebalance:s2","why":"Luft"}],"confidence":"high"}\n```'));
  assert.deepEqual(v.picks.map((x) => x.id), ['smooth:s1', 'rebalance:s2'], 'one per task, only existing suggestions');
  assert.equal(v.rejected, 2);
  assert.throws(() => parseJson('no json at all'), { code: 'AI_INVALID' });

  const G = (usage, value) => validateOutput(buildFacts('gaps', gap(usage), { share: { names: false, texts: false } }), { value, why: 'w', basedOn: ['TEL-12', 'TEL-999'] });
  assert.equal(G('originalEstimate', 60).suggestion.value, 60);
  assert.deepEqual(G('originalEstimate', 60).basedOn, ['TEL-12'], 'unknown keys dropped');
  assert.throws(() => G('originalEstimate', 5000), { code: 'AI_INVALID' });
  assert.throws(() => G('originalEstimate', -3), { code: 'AI_INVALID' });
  assert.equal(G('dueDate', '2026-12-18').suggestion.value, '2026-12-18', 'a date from the facts');
  assert.throws(() => G('dueDate', '2026-12-24'), { code: 'AI_INVALID' }, 'an invented date');
  assert.throws(() => G('dueDate', '2026-02-30'), { code: 'AI_INVALID' });
  assert.throws(() => G('dueDate', '2026-11-04'), { code: 'AI_INVALID' }, 'due before start');
  assert.throws(() => G('team', 'T9'), { code: 'AI_INVALID' });
  assert.throws(() => G('tshirt', 'XXXL'), { code: 'AI_INVALID' });
  assert.deepEqual(G('targetQuarters', ['2026-Q4']).suggestion.value, ['2026-Q4']);
  assert.throws(() => G('targetQuarters', ['2031-Q1']), { code: 'AI_INVALID' });

  // through assist(): an invalid answer falls back to the app's rules, and a team handle comes back as the team id
  const bad = spies('{"value":"2030-01-01","why":"x"}');
  const r = await assist('gaps', gap('dueDate'), { ...CTX, cfg: on() }, bad.deps);
  assert.equal(r.source, 'fallback');
  assert.equal(r.reason, 'AI_INVALID');
  const good = spies('{"value":"T1","why":"Geschwister im Team Web","confidence":"high"}');
  const t = await assist('gaps', gap('team'), { ...CTX, cfg: on() }, good.deps);
  assert.equal(t.source, 'ai');
  assert.deepEqual(t.suggestion, { usage: 'team', value: 'web', handle: 'T1' });

  const D = buildFacts('dispatch', dispatch(), { share: { names: false, texts: false } });
  const d = validateOutput(D, { items: [{ ticket: 'SUP-1', team: 'T1', person: 'P2', why: 'abwesend' }, { ticket: 'SUP-77', team: 'T1' }, { ticket: 'SUP-1', team: 'T2' }] });
  assert.equal(d.items.length, 1, 'unknown and duplicate tickets dropped');
  assert.deepEqual([d.items[0].issueId, d.items[0].teamId, d.items[0].accountId], ['3001', 'web', null], 'an absent person is never assigned');
  const d2 = validateOutput(D, { items: [{ ticket: 'SUP-1', team: 'T2', person: 'P1' }] });
  assert.equal(d2.items[0].accountId, null, 'a person from another team is not taken');

  const W = buildFacts('myWeek', myWeek(), { share: { names: false, texts: false } });
  const w = validateOutput(W, { comments: [{ cell: 'c1', comment: 'Login-Abstimmung' }, { cell: 'c2', comment: 'überschreibt nicht' }, { cell: 'c9', comment: 'erfunden' }], summary: 'Gute Woche.' });
  assert.deepEqual(w.comments.map((c) => [c.issueId, c.d, c.h, c.comment]), [['101', '2026-11-02', 3, 'Login-Abstimmung']]);
  assert.equal(w.rejected, 2, 'unknown cell and a comment the person wrote are left alone');

  // the model is unreachable: the app's own rules answer, clearly marked
  for (const f of ASSIST_FEATURES) {
    const down = spies(Object.assign(new Error('AI_TIMEOUT'), { code: 'AI_TIMEOUT' }));
    const x = await assist(f, SAMPLES[f](), { ...CTX, cfg: on() }, down.deps);
    assert.equal(x.source, 'fallback', f);
    assert.equal(down.s.audit[0].details.source, 'fallback');
  }
  assert.ok(fallbackFor(P, 'de').picks.every((p) => P.index.suggestions.has(p.id)), 'the fallback also only picks existing suggestions');
});

test('applying: every accepted suggestion goes through the existing write path and is its own undo entry', async () => {
  // Wochenplanung: picks are mapped to the optimizer's current suggestions (stale ones skipped, one per task)
  const all = { sooner: { suggestions: [{ id: 'sooner:s1', taskId: 's1' }] }, smooth: { suggestions: [{ id: 'smooth:s1', taskId: 's1' }, { id: 'smooth:s3', taskId: 's3' }] }, rebalance: { suggestions: [] } };
  assert.deepEqual(planningSelection({ picks: [{ id: 'smooth:s1' }, { id: 'sooner:s1' }, { id: 'gone:s7' }, { id: 'smooth:s3' }] }, all).map((s) => s.id), ['smooth:s1', 'smooth:s3']);
  // …and WeekBoard records one undo entry per suggestion (pending moves, never Jira directly)
  const wb = read('static/cockpit/src/components/WeekBoard.jsx');
  assert.match(wb, /const entries = list\.map\(\(s\) => pushUndo\(/);
  assert.match(read('static/cockpit/src/components/PlanOptimizer.jsx'), /onApply\(planningSelection\(r, all\), \{ ai: r\.source !== 'lotse' \}\)/, 'the AI\'s pick is labelled as AI, Lotse\'s pick as Lotse\'s (teamwork)');

  // Fehlende Werte: one fill → one undo entry
  const undo = [];
  const fill = async (a) => { undo.push(a.label); return { label: a.label }; };
  const e = await applyGap({ fill, target: { issueId: '14' }, gap: { field: 'team', key: 'TEL-14' }, result: { suggestion: { usage: 'team', value: 'web' } } });
  assert.ok(e && undo.length === 1 && /KI-Vorschlag/.test(undo[0]));
  assert.equal(await applyGap({ fill, target: {}, gap: { field: 'team' }, result: { suggestion: { usage: 'tshirt', value: 'M' } } }), null, 'a value for another field is never written');

  // Support: overrides per ticket for the existing assign flow, which records one undo entry per ticket
  assert.deepEqual([...dispatchOverrides({ items: [{ issueId: '1', teamId: 'web', accountId: 'a' }, { issueId: '2', teamId: 'ux', accountId: null }] })], [['1', { teamId: 'web', accountId: 'a' }], ['2', { teamId: 'ux', accountId: null }]]);
  const sd = read('static/cockpit/src/components/SupportDispatch.jsx');
  assert.match(sd, /: pushUndo\(label, undo, \[`dispatch:\$\{x\.issueId\}`\]\)/);
  assert.match(sd, /assign\(targets, dispatchOverrides\(r\)/);

  // Meine Arbeit: one mine.book and one undo entry per cell; undo puts the earlier comment back
  const calls = [], entries = [];
  const book = async (row, d, h, c) => { calls.push([row.id, d, h, c]); return true; };
  const pushUndo = (label, run, keys) => { const x = { label, run, keys }; entries.push(x); return x; };
  const made = await applyComments({ comments: [{ issueId: '101', key: 'TEL-12', d: '2026-11-02', h: 3, comment: 'A', previous: '' }, { issueId: '103', key: 'TEL-15', d: '2026-11-03', h: 1, comment: 'B', previous: 'alt' }], book, pushUndo });
  assert.equal(made.length, 2);
  assert.deepEqual(entries.map((x) => x.keys), [['mine:101|2026-11-02'], ['mine:103|2026-11-03']]);
  await entries[1].run();
  assert.deepEqual(calls.at(-1), ['103', '2026-11-03', 1, 'alt'], 'same hours, the earlier comment');
});

test('client: AI is never called while off (Lotse answers alone, product owner 2026-11-12); texts are bilingual; no exit animations; never the forbidden word', () => {
  const comp = read('static/cockpit/src/components/AiAssist.jsx');
  // AI off for the person or the feature (or budget stopped): no ai.assist call – the same panel shows Lotse alone
  assert.match(comp, /const aiEnabled = aiOn\(config, feature\);/);
  assert.match(comp, /if \(!aiEnabled\) \{ setSt\(\{ phase: 'done', r: null, lotse \}\); return; \}\n[\s\S]*call\('ai\.assist'/);
  assert.match(comp, /if \(!ai\.enabled \|\| \(!ai\.aiEnabled && CHIP_FEATURES\.has\(feature\)\)\) return null;/, 'neither AI nor Lotse: nothing');
  assert.ok(!/AnimatePresence/.test(comp), 'no exit animations');
  assert.match(comp, /Lotse-Vorschlag/);
  assert.match(comp, /Was wurde gesendet\?/);
  for (const f of ['WeekBoard.jsx', 'PlanOptimizer.jsx', 'SupportDispatch.jsx', 'AiSettings.jsx']) assert.ok(read(`static/cockpit/src/components/${f}`).length);
  const settings = read('static/cockpit/src/components/AiSettings.jsx');
  for (const f of ASSIST_FEATURES) assert.match(settings, new RegExp(`\\['${f}',`), `settings list ${f}`);
  for (const [file, feature] of [['components/PlanOptimizer.jsx', 'planning'], ['views/Quality.jsx', 'gaps'], ['components/SupportDispatch.jsx', 'dispatch'], ['views/PlanActual.jsx', 'planActual'], ['views/Team.jsx', 'teamBrief'], ['views/Project.jsx', 'projectBrief'], ['views/Mine.jsx', 'myWeek']]) {
    assert.match(read(`static/cockpit/src/${file}`), new RegExp(`feature(="|: '|=\{'|=\{")${feature}["']`), `${file} uses the assistant for ${feature}`);
  }
  assert.match(read('static/cockpit/src/lib/api.js'), /'ai\.assist'/, 'a read: allowed while a cached snapshot is shown');
});

test('language and labels: every prompt ends in the UI language; projects carry one label with the rank', async () => {
  const b = buildFacts('planning', planning(), { share: { names: false, texts: false } });
  assert.match(promptFor(b, 'en').user, /Answer in English, even where the facts contain German words\.$/);
  assert.match(promptFor(b, 'de').user, /Antworte auf Deutsch\.$/);
  assert.match(promptFor(b, 'en').system, /use it exactly as given, once/);
  const ai = await import('../src/lib/ai.js');
  assert.equal(ai.projectLabel(false, 'Phoenix', 5, 'PCX-46'), '#5 PCX-46');
  assert.equal(ai.projectLabel(true, 'Phoenix', 5, 'PCX-46'), 'Phoenix (#5)');
  const aiSrc = read('src/lib/ai.js');
  assert.match(aiSrc, /never add the rank or the key a second time/);
  assert.match(aiSrc, /asOf: report\.asOf/, 'the report summary knows its snapshot time');
  assert.equal((aiSrc.match(/\$\{langLine\(lang\)\}/g) || []).length, 3, 'ask, healthDraft and reportSummary end with the language line');
});

test('dispatch: every ticket carries the component facts; the reason names the basis and the load', () => {
  const D = buildFacts('dispatch', dispatch(), { share: { names: false, texts: false } });
  assert.deepEqual(D.facts.tickets[0].componentFacts, [{ component: 'C1', mappedTo: 'T1', usuallyResolvedBy: null }]);
  assert.match(promptFor(D, 'de').system, /names the fact it rests on/);
  const f = fallbackFor(D, 'en').items[0];
  assert.equal(f.accountId, 'acc-erika');
  assert.match(f.why, /C1 is mapped to T1; P1 is at 50 %/);
});
