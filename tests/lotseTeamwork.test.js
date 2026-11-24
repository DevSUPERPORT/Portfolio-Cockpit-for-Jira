// Lotse × AI on the same task (shared/lotse/teamwork.js): Lotse's answer first, the AI's next to it, compared in code –
// structured suggestions side by side ("Beide schlagen … vor" or both options), narratives claim by claim; the pick goes
// back in the AI's result shape for the screen's existing apply path. And the UI contract: one panel, AI off → Lotse alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lotseDraft, compareDrafts, textCheck, pickResult, isNarrative } from '../shared/lotse/index.js';
import { gapPayload } from '../shared/aiPayload.js';
import { lotseCtx } from './lotseFixture.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const de = lotseCtx('de');
const { model, dq } = de.computed;

test('gaps: same value → "same"; another value → "differs"; nothing on one side → lotseOnly / aiOnly', () => {
  const g = dq.gaps.find((x) => x.field === 'originalEstimate' && !x.isItem);
  const l = lotseDraft('gaps', gapPayload(de.computed, g, 'de'), de).result;
  assert.ok(l.suggestion?.value > 0, 'Lotse proposes hours');
  assert.equal(compareDrafts('gaps', l, { suggestion: { usage: 'originalEstimate', value: l.suggestion.value } }).verdict, 'same');
  assert.equal(compareDrafts('gaps', l, { suggestion: { usage: 'originalEstimate', value: l.suggestion.value + 0.4 } }).verdict, 'same', 'within half an hour counts as the same');
  assert.equal(compareDrafts('gaps', l, { suggestion: { usage: 'originalEstimate', value: l.suggestion.value * 3 } }).verdict, 'differs');
  assert.equal(compareDrafts('gaps', l, { suggestion: null }).verdict, 'lotseOnly');
  assert.equal(compareDrafts('gaps', { suggestion: null }, { suggestion: { usage: 'team', value: 't-ux' } }).verdict, 'aiOnly');
  assert.equal(compareDrafts('gaps', null, null).verdict, 'none');
});

test('dispatch: per ticket – team and person; partial agreement is "partial"', () => {
  const l = { items: [{ issueId: '1', key: 'S-1', teamId: 't-int', accountId: 'u2' }, { issueId: '2', key: 'S-2', teamId: 't-web', accountId: null }] };
  const a = { items: [{ issueId: '1', key: 'S-1', teamId: 't-int', accountId: 'u2' }, { issueId: '2', key: 'S-2', teamId: 't-ux', accountId: 'u5' }] };
  const c = compareDrafts('dispatch', l, a);
  assert.equal(c.verdict, 'partial');
  assert.equal(c.same, 1);
  assert.deepEqual(c.items.find((x) => x.id === '2'), { id: '2', key: 'S-2', lotse: { teamId: 't-web', accountId: null }, ai: { teamId: 't-ux', accountId: 'u5' }, sameTeam: false, samePerson: false, same: false });
  assert.equal(compareDrafts('dispatch', l, l).verdict, 'same');
});

test('planning, health, intent, my week, playbook: the comparison per kind', () => {
  assert.equal(compareDrafts('planning', { picks: [{ id: 'a' }, { id: 'b' }] }, { picks: [{ id: 'b' }, { id: 'a' }] }).verdict, 'same');
  assert.equal(compareDrafts('planning', { picks: [{ id: 'a' }] }, { picks: [{ id: 'c' }] }).verdict, 'differs');
  assert.equal(compareDrafts('healthDraft', { status: 'atRisk' }, { status: 'atRisk' }).verdict, 'same');
  assert.equal(compareDrafts('healthDraft', { status: 'atRisk' }, { status: 'critical' }).verdict, 'differs');
  assert.equal(compareDrafts('intent', { card: 'waterline' }, { card: 'waterline' }).verdict, 'same');
  const wk = compareDrafts('myWeek', { comments: [{ cell: 'x|d', key: 'K-1', comment: 'Status Offen → Review' }] }, { comments: [{ cell: 'x|d', key: 'K-1', comment: 'status offen → review' }, { cell: 'y|d', key: 'K-2', comment: 'Tests' }] });
  assert.equal(wk.verdict, 'partial');
  assert.equal(compareDrafts('playbookDraft', { draft: { title: 'A', steps: [1, 2, 3] } }, { draft: { title: 'A', steps: [1, 2, 3] } }).verdict, 'same');
});

test('narratives: the AI text is checked against Lotse\'s story – a wrong number is a ✗ with Lotse\'s value', () => {
  const d = lotseDraft('teamBrief', { teamId: 't-ux' }, de);
  assert.ok(d.story && d.result.text === d.story.headline);
  const util = d.story.kpis[0];
  const good = textCheck(d.story, { text: `Team UX: ${String(util.value).replace('.', ',')}${util.unit === '%' ? ' %' : ` ${util.unit}`} – das ist die Lage.` }, 'de');
  assert.equal(good.verdict, 'agrees');
  const bad = textCheck(d.story, { text: 'Team UX liegt bei 999 % Auslastung.', points: [] }, 'de');
  assert.equal(bad.verdict, 'differs');
  assert.ok(bad.claims.some((c) => c.verified === false && c.expected));
  assert.equal(textCheck(null, { text: 'x' }), null);
  for (const f of ['teamBrief', 'projectBrief', 'planActual', 'similarSummary', 'ask', 'reportSummary', 'lotse']) assert.ok(isNarrative(f), f);
  for (const f of ['gaps', 'dispatch', 'planning', 'myWeek', 'intent', 'playbookDraft', 'healthDraft']) assert.ok(!isNarrative(f), f);
  // project briefing and plan vs. actual have stories too (plan vs. actual reads the view's data)
  assert.ok(lotseDraft('projectBrief', { ref: model.items[0].ref }, de).story);
  assert.ok(lotseDraft('planActual', {}, de).story, 'with ctx.planActual');
  assert.equal(lotseDraft('planActual', {}, { ...de, planActual: null }).story, null, 'without the view data: no story, honestly');
});

test('the pick: the chosen result in the AI\'s shape for the existing apply path', () => {
  const l = { suggestion: { usage: 'team', value: 't-ux' }, source: 'lotse' }, a = { suggestion: { usage: 'team', value: 't-web' }, source: 'ai' };
  assert.equal(pickResult(l, a, 'lotse').suggestion.value, 't-ux');
  assert.equal(pickResult(l, a, 'lotse').source, 'lotse');
  assert.equal(pickResult(l, a, 'ai').suggestion.value, 't-web');
  assert.equal(pickResult(null, a, 'lotse'), null);
});

test('UI contract: one panel – Lotse first, the AI next to it, compared; AI off → Lotse alone; picks through onApply; no exit animations', () => {
  const ui = read('static/cockpit/src/components/AiAssist.jsx');
  assert.match(ui, /lotseDraft\(feature, payload/, 'Lotse computes on the same payload the AI gets');
  assert.match(ui, /if \(!aiEnabled\) \{ setSt\(\{ phase: 'done', r: null, lotse \}\); return; \}/, 'AI off: Lotse alone, no AI call');
  assert.match(ui, /setSt\(\{ phase: 'loading', startedAt: Date\.now\(\), lotse \}\)/, 'Lotse is shown while the AI is still loading');
  assert.match(ui, /compareDrafts\(ai\.feature, L, r\)/);
  assert.match(ui, /textCheck\(lotse\.story, r, getLang\(\)\)/);
  assert.match(ui, /Beide schlagen/);
  assert.match(ui, /await onApply\(res\)/, 'the pick goes through the screen\'s existing write path');
  assert.match(ui, /data-tw-pick="lotse"/);
  assert.match(ui, /data-tw-pick="ai"/);
  assert.ok(!/AnimatePresence|exit=\{/.test(ui), 'no exit animations');
  assert.ok(!/rovo/i.test(ui));
  // the health dialog: Lotse's status next to the AI's draft
  const pf = read('static/cockpit/src/views/Portfolio.jsx');
  assert.match(pf, /lotseDraft\('healthDraft'/);
  assert.match(pf, /<HealthTeam lotse=\{lotse\} ai=\{aiDraft\} onPick=\{pick\} \/>/);
});
