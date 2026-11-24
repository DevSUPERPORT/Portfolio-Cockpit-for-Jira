// Lotse's UI (static/cockpit/src/components/lotse/**): static checks like the other UI tests – the rules the owner cares
// about (visual first, every visual kind drawn, accessible, no exit animations, AI only when switched on, actions only
// through the app's existing write paths) are tied to the code, so a later change cannot silently break one of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const DIR = 'static/cockpit/src/components/lotse';
const files = readdirSync(new URL(`../${DIR}`, import.meta.url)).filter((f) => /\.(jsx?|css)$/.test(f));
const src = Object.fromEntries(files.map((f) => [f, read(`${DIR}/${f}`)]));
const code = files.filter((f) => /\.jsx?$/.test(f));
const VISUAL_KINDS = ['bars', 'columns', 'line', 'donut', 'heat', 'timeline', 'compare', 'waterline', 'gantt'];

test('lotse/**: no AnimatePresence (exit animations stall in the Jira frame) and no exit props', () => {
  assert.ok(code.length >= 8, `${code.length} files`);
  for (const f of code) {
    assert.ok(!/AnimatePresence/.test(src[f]), `${f} uses AnimatePresence`);
    assert.ok(!/\bexit=\{/.test(src[f]), `${f} has an exit animation`);
    // motion only on transform / opacity (no width/height/top/left animations)
    for (const m of src[f].matchAll(/(?:initial|animate)=\{\{([^}]*)\}\}/g)) {
      assert.ok(!/\b(width|height|top|left|right|bottom|margin|padding)\s*:/.test(m[1]), `${f} animates layout: ${m[1]}`);
    }
  }
});

test('every visual kind of the Story contract is drawn – and the contract lists exactly these', () => {
  const v = src['visuals.jsx'];
  for (const k of VISUAL_KINDS) assert.match(v, new RegExp(`case '${k}':`), `visual kind ${k} is handled`);
  if (existsSync(new URL('../shared/lotse/story.js', import.meta.url))) {
    const story = read('shared/lotse/story.js');
    const m = /export const VISUAL_KINDS = \[([^\]]+)\]/.exec(story);
    assert.ok(m, 'story.js exports VISUAL_KINDS');
    const kinds = m[1].match(/'([a-z]+)'/g).map((x) => x.slice(1, -1));
    assert.deepEqual([...kinds].sort(), [...VISUAL_KINDS].sort(), 'UI and engine know the same visual kinds');
  }
  // the classic kinds reuse components/charts.jsx; new ones only for timeline / gantt / compare / waterline
  assert.match(v, /import \{ Columns, Donut, HBars, Heat, Line \} from '\.\.\/charts\.jsx'/);
  for (const c of ['Timeline', 'Gantt', 'Compare', 'Waterline']) assert.match(v, new RegExp(`export function ${c}\\(`));
});

test('accessible visuals: a named figure, a picture hidden from screen readers, a data table with the numbers', () => {
  const v = src['visuals.jsx'];
  for (const c of ['Timeline', 'Gantt', 'Compare', 'Waterline']) {
    const body = v.slice(v.indexOf(`export function ${c}(`), v.indexOf('\n}\n', v.indexOf(`export function ${c}(`)));
    assert.match(body, /<figure className="chart[^"]*" aria-label=\{label\}>/, `${c}: named figure`);
    assert.match(body, /aria-hidden="true"/, `${c}: decorative parts hidden`);
    if (c !== 'Timeline') assert.match(body, /<SrTable /, `${c}: screen-reader table`);
    else assert.match(body, /<ol className="lv-tl-list">/, 'timeline: the events as a real list');
  }
});

test('accessible panel: dialog with a name, Esc closes, focus stays inside and returns; icon-only buttons are labelled', () => {
  const p = src['Lotse.jsx'];
  assert.match(p, /role="dialog" aria-modal="true" aria-labelledby="lp-title"/);
  assert.match(p, /e\.key === 'Escape'[^\n]*closeLotse\(\)/);
  assert.match(p, /e\.key !== 'Tab'/, 'focus trap');
  assert.match(p, /opener\.current\.focus/, 'focus goes back to the opener');
  for (const f of code) {
    for (const m of src[f].matchAll(/<button[^>]*className="[^"]*btn-icon[^"]*"[^>]*>/g)) assert.match(m[0], /aria-label=/, `${f}: icon button without a label: ${m[0].slice(0, 90)}`);
  }
  assert.match(src['TodayStrip.jsx'], /aria-label=\{tr\('Für heute ausblenden', 'Hide for today'\)\}/);
});

test('AI reading: call(\'lotse.llm\') only from CrossCheck and only while aiOn(config, \'lotse\')', () => {
  for (const f of code) if (f !== 'CrossCheck.jsx' && f !== 'ChainCards.jsx') assert.ok(!/lotse\.llm/.test(src[f]), `${f} calls the LLM`);
  // chains (2026-11-16): the planner, the writer and the learning offer – each only while AI is on for Lotse, each with its mode
  const ch = src['ChainCards.jsx'];
  assert.match(ch, /const ai = aiOn\(config, 'lotse'\);/);
  assert.match(ch, /useAiPlan\(draft\.text, ctx, ai && answered === undefined,/);
  assert.match(ch, /if \(!enabled \|\| !text\) return;\n\s+setSt\(\{ phase: 'loading' \}\);\n\s+try \{\n\s+const r = await call\('lotse\.llm', \{ mode: 'plan',/);
  assert.match(ch, /const canAi = aiOn\(config, 'lotse'\) && step\.assist\?\.story;/);
  assert.match(ch, /call\('lotse\.llm', \{ mode: 'write', kind: step\.assist\.kind, story: step\.assist\.story,/, 'the writer gets the verified story only');
  assert.match(ch, /const canLearn = cs\.source === 'ai' && aiOn\(config, 'lotse'\);/);
  assert.equal((ch.match(/call\('lotse\.llm'/g) || []).length, 3);
  const cc = src['CrossCheck.jsx'];
  assert.match(cc, /if \(!aiOn\(config, 'lotse'\) \|\| !story\) return null;/, 'no button while AI is off');
  const ask = cc.slice(cc.indexOf('const ask = async'), cc.lastIndexOf("call('lotse.llm'"));
  assert.match(ask, /if \(!aiOn\(config, 'lotse'\)\) return;/, 'the call itself is guarded');
  assert.match(cc, /call\('lotse\.llm', \{ story,/, 'only the story is sent');
  assert.match(cc, /Lotse und KI stimmen überein/);
  assert.match(cc, /es gilt die geprüfte Story/);
});

test('actions never auto-apply and only use the app\'s existing write paths, each with undo', () => {
  const a = src['actions.js'];
  assert.match(a, /await fill\(\{/, 'fill → state.fill');
  assert.match(a, /await reorder\(order, \{ silent: true \}\)/, 'rank → state.reorder');
  assert.match(a, /pendingStore\.set\(/, 'move/assign → pending move on the weekly plan, not written to Jira');
  assert.match(a, /pushUndo\(/);
  for (const f of code) assert.ok(!/\bcall\('(?!lotse\.llm)/.test(src[f]), `${f} calls a resolver directly`);
  const card = src['StoryCard.jsx'];
  assert.match(card, /if \(write\) \{ setPhase\(phase === 'preview' \? 'idle' : 'preview'\); return; \}/, 'a write shows its preview first');
  assert.match(card, /tr\('Übernehmen', 'Apply'\)/);
  assert.match(card, /tr\('Rückgängig', 'Undo'\)/);
});

test('fixtures are valid Stories with every visual kind (preview and tests only); production imports the engine', async () => {
  const fx = await import('../static/cockpit/src/components/lotse/fixtures.js');
  assert.deepEqual([...fx.VISUAL_KINDS].sort(), [...VISUAL_KINDS].sort());
  for (const k of VISUAL_KINDS) assert.ok(fx.VISUAL_SAMPLES[k], `sample for ${k}`);
  if (existsSync(new URL('../shared/lotse/story.js', import.meta.url))) {
    const { validStory } = await import('../shared/lotse/story.js');
    for (const lang of ['de', 'en']) for (const s of fx.fixtureStories(lang)) assert.doesNotThrow(() => validStory(s), s.id);
    for (const k of VISUAL_KINDS) assert.doesNotThrow(() => validStory({ ...fx.projectStory('de'), visual: { kind: k, data: fx.VISUAL_SAMPLES[k], caption: k } }), k);
  }
  assert.match(src['engine.js'], /import \* as Engine from '@shared\/lotse\/index\.js'/, 'a direct import – no fallback');
  assert.ok(!/import\.meta\.glob/.test(src['engine.js']), 'the temporary fallback is gone');
  for (const f of code) if (f !== 'fixtures.js') assert.ok(!/fixtures\.js/.test(src[f]), `${f} imports the fixtures`);
});

test('bilingual and never the forbidden word', () => {
  for (const f of files) assert.ok(!/rovo/i.test(src[f]), `${f}`);
  for (const f of ['StoryCard.jsx', 'Lotse.jsx', 'TodayStrip.jsx', 'WhatIf.jsx', 'CrossCheck.jsx', 'visuals.jsx']) assert.ok((src[f].match(/\btr\(/g) || []).length >= 4, `${f} speaks DE + EN`);
});

test('entry points: header button and Ctrl K in App, a Lotse chip in every view next to its KI button, Today strip, Ask', () => {
  const app = read('static/cockpit/src/App.jsx');
  assert.match(app, /data-lotse-open/);
  assert.match(app, /tr\('Lotse fragen …', 'Ask Lotse …'\)/);
  assert.match(app, /openLotse\(\{ text: q\.trim\(\) \}\)/);
  assert.match(app, /lazy(?:View)?\(\(\) => import\('\.\/components\/lotse\/Lotse\.jsx'\)\)/, 'the panel loads on first use');
  for (const [view, skill] of [['Project', 'projectBrief'], ['Team', 'teamBrief'], ['Mine', 'myWeek'], ['Portfolio', 'portfolioBrief'], ['Report', 'portfolioBrief'], ['PlanActual', 'planActualExplain'], ['Support', 'supportTopics']]) {
    assert.match(read(`static/cockpit/src/views/${view}.jsx`), new RegExp(`<LotseChip skill="${skill}"`), `${view} opens ${skill}`);
  }
  for (const view of ['Mine', 'Portfolio']) assert.match(read(`static/cockpit/src/views/${view}.jsx`), /<TodayStrip where="/);
  assert.match(read('static/cockpit/src/views/Ask.jsx'), /openLotse\(\{ text: card\.title \}\)/, 'a wish without a card goes to Lotse');
  const strip = src['TodayStrip.jsx'];
  assert.match(strip, /try \{ return localStorage\.getItem\(k\) === todayIso\(\); \} catch/, 'dismissed per day, storage errors tolerated');
});
