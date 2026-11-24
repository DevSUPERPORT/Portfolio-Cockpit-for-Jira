// Lotse can do everything the Forge LLM features do (product owner, 2026-11-12): for EVERY AI feature id of the app there
// is a Lotse skill that returns a valid Story – and, where the AI returns a structured result, a draft in the AI's own
// shape – on the fixture, without any AI. Plus the new parity skills in detail: booking comments from the person's own
// activity, what helped in similar work (counts, overruns, comment keywords), the improved playbook, wish routing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKILLS, AI_PARITY, lotseDraft, validStory, selfCheck } from '../shared/lotse/index.js';
import { draftComments, commentFor } from '../shared/lotse/skills/bookingComments.js';
import { lessonsOf, commentKeywords } from '../shared/lotse/skills/similarSummary.js';
import { playbookOf } from '../shared/lotse/skills/playbookDraft.js';
import { mapWish } from '../shared/lotse/skills/intentMap.js';
import { ASSIST_FEATURES, buildFacts, validateOutput } from '../shared/aiAssist.js';
import { gapPayload, dispatchPayload, planningPayload } from '../shared/aiPayload.js';
import { supportTopics } from '../shared/insights.js';
import { ticketsOf, poolOf } from '../shared/ask.js';
import { similarWork } from '../shared/insights.js';
import { optimizeAll } from '../shared/optimize.js';
import { mockComments } from '../static/cockpit/src/lib/mockHistory.js';
import { lotseCtx } from './lotseFixture.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const listOf = (src, name) => [...new RegExp(`export const ${name} = \\[([^\\]]+)\\]`).exec(src)[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
const SERVER_FEATURES = listOf(read('src/lib/config.js'), 'AI_FEATURES');
const UI_FEATURES = listOf(read('static/cockpit/src/lib/aiFlags.js'), 'AI_FEATURES');
const de = lotseCtx('de');
const en = { ...de, lang: 'en' };
const { model } = de.computed;

// a realistic payload per AI feature – what the screens send (shared/aiPayload.js) or the resolver gets
function payloadFor(feature, ctx) {
  const c = ctx.computed;
  switch (feature) {
    case 'gaps': return gapPayload(c, c.dq.gaps.find((g) => g.field === 'originalEstimate' && !g.isItem), ctx.lang);
    case 'teamBrief': return { teamId: 't-ux' };
    case 'projectBrief': case 'healthDraft': return { ref: model.items[1].ref };
    case 'planning': return planningPayload(optimizeAll({ ds: ctx.ds, computed: c, horizonWeeks: 12, today: ctx.ds.today }), {});
    case 'dispatch': {
      const t = ctx.ds.supportTickets.tickets.filter((x) => x.statusCat !== 'done').slice(0, 4);
      return dispatchPayload({ tickets: t, teams: ctx.ds.teams, members: new Map(ctx.ds.teams.map((tm) => [tm.id, [{ id: 'u2', plan: 20, cap: 40 }, { id: 'u3', plan: 10, cap: 40 }]])), suggTeam: new Map(t.map((x) => [x.id, { teamId: 't-int', source: 'mapping' }])), history: new Map(), personName: (id) => id });
    }
    case 'myWeek': return { from: '2026-11-09', to: '2026-11-13', cells: [{ issueId: '118', key: 'KPR-118', d: '2026-11-09', h: 3, comment: '', summary: 'Migrationsskript' }, { issueId: '161', key: 'ERP-161', d: '2026-11-10', h: 4, comment: 'schon kommentiert' }], events: [{ issueId: '118', d: '2026-11-09', kind: 'status', from: 'Offen', to: 'In Arbeit' }, { issueId: '118', d: '2026-11-09', kind: 'comment' }] };
    case 'intent': return { wish: 'Ich will wissen, ab welchem Rang die Kapazität nicht reicht' };
    case 'similarSummary': { const sw = similarWork({ summary: 'Login mit SSO' }, poolOf(ctx), { limit: 8 }); return { subject: 'Login mit SSO', items: sw.items, stats: sw.stats }; }
    case 'playbookDraft': { const st = supportTopics(ticketsOf(ctx), { minCount: 3, today: ctx.ds.today }); const t = st.topics[0]; return { topic: t, examples: t.exampleKeys.map((k) => ({ key: k })) }; }
    default: return {};
  }
}

test('every AI feature has a Lotse equivalent – the parity table covers the server and the UI list exactly', () => {
  assert.deepEqual([...SERVER_FEATURES].sort(), [...UI_FEATURES].sort(), 'server and UI know the same AI features');
  assert.deepEqual(Object.keys(AI_PARITY).sort(), [...SERVER_FEATURES].sort(), 'one Lotse skill per AI feature');
  for (const [f, skill] of Object.entries(AI_PARITY)) assert.ok(SKILLS[skill], `${f} → ${skill} is a Lotse skill`);
});

test('parity table: for every AI feature the Lotse skill returns a valid Story on the fixture – DE and EN, no AI involved', () => {
  const params = { healthDraft: { ref: model.items[1].ref }, projectBrief: { ref: model.items[1].ref }, teamBrief: { team: 't-ux' }, similarSummary: { text: 'Login mit SSO' }, intentMap: { text: 'Wer macht bald Überstunden?' } };
  for (const ctx of [de, en]) {
    for (const [feature, skill] of Object.entries(AI_PARITY)) {
      const s = SKILLS[skill].run(ctx, params[skill] || {}, ctx.lang);
      assert.doesNotThrow(() => validStory(s), `${feature} → ${skill} (${ctx.lang})`);
      assert.notEqual(s.tone, undefined);
      assert.deepEqual(selfCheck(s), [], `${feature} → ${skill}: every number has a source`);
    }
  }
});

test('parity drafts: on the same payload as the AI, Lotse returns a result in the AI\'s own validated shape', () => {
  const STRUCT = ['gaps', 'dispatch', 'planning', 'myWeek', 'intent', 'similarSummary', 'playbookDraft', 'healthDraft'];
  for (const feature of [...ASSIST_FEATURES, 'healthDraft', 'ask', 'reportSummary', 'lotse']) {
    const p = payloadFor(feature, de);
    const d = lotseDraft(feature, p, de);
    assert.ok(d.result || d.story, `${feature}: Lotse has an answer`);
    if (d.story) assert.doesNotThrow(() => validStory(d.story), feature);
    if (STRUCT.includes(feature)) assert.ok(d.result, `${feature}: a structured draft`);
    // the AI's own validator accepts Lotse's draft (same shape, only known ids / handles / dates)
    if (ASSIST_FEATURES.includes(feature) && !['teamBrief', 'projectBrief', 'planActual'].includes(feature)) {
      const built = buildFacts(feature, p, { share: { names: true, texts: true }, ds: de.ds, today: de.ds.today });
      const asAi = toAiShape(feature, d.result, built);
      assert.doesNotThrow(() => validateOutput(built, asAi), `${feature}: the AI validator accepts Lotse's draft`);
    }
  }
  const h = lotseDraft('healthDraft', { ref: model.items[1].ref }, de).result;
  assert.ok(['onTrack', 'atRisk', 'critical'].includes(h.status) && h.comment.length > 5 && h.comment.length <= 280, 'health: status + one sentence (as ai.healthDraft)');
});
// Lotse's result → the JSON a model would have answered (handles instead of ids), for validateOutput
function toAiShape(feature, r, built) {
  const handleOf = (kind, id) => Object.entries(built.handles).find(([, x]) => x.kind === kind && x.id === String(id))?.[0] || null;
  switch (feature) {
    case 'gaps': return { value: built.index.usage === 'team' ? handleOf('team', r.suggestion?.value) : r.suggestion?.value ?? null, why: r.why, basedOn: r.basedOn };
    case 'dispatch': return { items: r.items.map((x) => ({ ticket: x.key, team: handleOf('team', x.teamId), person: x.accountId ? handleOf('person', x.accountId) : null, why: x.why })) };
    case 'planning': return { summary: r.text, picks: r.picks };
    case 'myWeek': return { summary: r.text, comments: r.comments.map((c) => ({ cell: [...built.index.cells.entries()].find(([, x]) => x.issueId === c.issueId && x.d === c.d)[0], comment: c.comment })) };
    case 'intent': return { card: r.card, why: r.why };
    case 'similarSummary': return { summary: r.text, points: r.points, basedOn: r.basedOn };
    case 'playbookDraft': return { title: r.draft.title, symptoms: r.draft.symptoms, steps: r.draft.steps, reply: r.draft.reply };
    default: return {};
  }
}

test('booking comments: from the day\'s own activity – status first, then comments, links; never over an own comment', () => {
  const d = draftComments(payloadFor('myWeek', de), 'de');
  assert.equal(d.comments.length, 1, 'the commented cell is left alone');
  assert.equal(d.comments[0].comment, 'Status Offen → In Arbeit; Abstimmung im Kommentar');
  assert.equal(d.comments[0].basis, 'status');
  assert.match(commentFor({ issueId: '9', d: '2026-11-10', key: 'X-9' }, [{ issueId: '9', d: '2026-11-10', kind: 'link' }, { issueId: '9', d: '2026-11-10', kind: 'link' }], 'en').comment, /^2 links maintained$/);
  assert.match(commentFor({ issueId: '9', d: '2026-11-10', key: 'X-9', summary: 'Rechnungs-PDF' }, [], 'de').comment, /^Arbeit an „Rechnungs-PDF“$/);
  for (const c of d.comments) assert.ok(c.comment.length <= 200);
  // the skill on the fixture: u1's own bookings of this week
  const s = SKILLS.bookingComments.run(de, {}, 'de');
  assert.equal(s.kpis.find((k) => k.id === 'cells').value, s.draft.comments.length + 0, 'no cell of u1 has a comment in the fixture');
  const withEv = SKILLS.bookingComments.run({ ...de, evidence: { events: [{ issueId: s.draft.comments[0].issueId, d: s.draft.comments[0].d, kind: 'status', from: 'Offen', to: 'Review' }] } }, {}, 'de');
  assert.equal(withEv.kpis.find((k) => k.id === 'activity').value, 1, 'activity counts');
});

test('what helped: numbers always; comment keywords only when texts were loaded', () => {
  const p = payloadFor('similarSummary', de);
  const plain = lessonsOf(p, 'de');
  assert.ok(plain.text.startsWith(`${p.items.length} ähnliche`), plain.text);
  assert.equal(plain.keywords.length, 0, 'no texts → no keywords');
  const comments = mockComments(p.items.map((x) => x.id), { texts: true });
  const withTexts = lessonsOf({ ...p, comments }, 'de');
  const texts = Object.values(comments).flatMap((c) => c.last.map((x) => x.text));
  if (texts.length >= 2) assert.ok(withTexts.keywords.length >= 1, 'keywords from the loaded comment texts');
  for (const k of withTexts.keywords) assert.ok(texts.some((t) => t.includes(k.word)), `${k.word} is in a comment`);
  assert.deepEqual(commentKeywords(['Die Testumgebung fehlt.', 'Testumgebung neu aufsetzen, Stammdaten laden.', 'Stammdaten prüfen']).map((k) => k.word), ['Stammdaten', 'Testumgebung']);
  const story = SKILLS.similarSummary.run({ ...de, comments }, { text: 'Login mit SSO' }, 'de');
  assert.doesNotThrow(() => validStory(story));
  assert.deepEqual(selfCheck(story), []);
});

test('playbook draft: the template improved with what the tickets share; the reply has no internal figures', () => {
  const tickets = ticketsOf(de);
  const st = supportTopics(tickets, { minCount: 3, today: de.ds.today });
  const t = st.topics.find((x) => x.playbook) || st.topics[0];
  const pb = playbookOf(t, { tickets, lang: 'de', teamName: (id) => model.teams.get(id)?.name || id });
  assert.ok(pb.draft.steps.length >= 4 && pb.draft.steps.length <= 6);
  assert.ok(pb.draft.steps.some((x) => /Komponente|Anfrageart/.test(x)), 'the shared component / request type is a step');
  assert.ok(pb.draft.steps.some((x) => /\[[^\]]+\]/.test(x)), 'unknown steps stay placeholders');
  assert.doesNotMatch(pb.draft.reply, /\d+ (Tickets|h)\b|SUP-\d+/, 'no internal figures or keys in the customer reply');
  assert.match(pb.draft.reply, /\[Name\]/);
});

test('wish routing: Lotse\'s own mapping, the card of the catalogue, unknown wishes honestly unknown', () => {
  assert.equal(mapWish('Ich will wissen, ab welchem Rang die Kapazität nicht reicht', de).card, 'waterline');
  assert.equal(mapWish('Wer macht bald Überstunden?', de).skill, 'overtime');
  const none = mapWish('xyzzy plugh frobnicate', de);
  assert.equal(none.skill, null);
  const s = SKILLS.intentMap.run(de, { text: 'xyzzy plugh frobnicate' }, 'de');
  assert.equal(s.tone, 'warn');
  assert.equal(s.draft.skill, null);
});
