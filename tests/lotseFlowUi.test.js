// Lotse acts in the UI – static checks tied to the code (like tests/lotseUi.test.js): no exit animations (they stall in
// the Jira frame), accessible cards, every command kind and every workflow step kind rendered, apply only with the shown
// preview's token, undo in the global history, usage counted, and the search (Ctrl K) that never writes by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COMMAND_IDS } from '../shared/lotse/act/index.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const DIR = 'static/cockpit/src/components/lotse';
const F = Object.fromEntries(['ActCards.jsx', 'Workflow.jsx', 'Lotse.jsx', 'RunPill.jsx', 'hooks.js', 'io.js', 'acts.js', 'brain.js', 'runStore.js', 'engine.js', 'acts.css'].map((f) => [f, read(`${DIR}/${f}`)]));
const app = read('static/cockpit/src/App.jsx');
const pal = app.slice(app.indexOf('function Palette('));
const commands = read('shared/lotse/act/commands.js');

test('no AnimatePresence and no exit animations in the acts UI or the search; motion on transform / opacity only', () => {
  for (const [f, src] of Object.entries(F)) {
    assert.ok(!/AnimatePresence/.test(src), `${f}`);
    assert.ok(!/\bexit=\{/.test(src), `${f} has an exit animation`);
    for (const m of src.matchAll(/(?:initial|animate)=\{\{([^}]*)\}\}/g)) assert.ok(!/\b(width|height|top|left|right|bottom|margin|padding)\s*:/.test(m[1]), `${f}: ${m[1]}`);
  }
  assert.ok(!/AnimatePresence/.test(pal), 'the palette unmounts without an exit animation');
  assert.ok(!/\bexit=\{/.test(pal));
  // the progress bar grows by transform, not by width
  assert.match(F['Workflow.jsx'], /animate=\{\{ scaleX:/);
});

test('every change kind of the command registry has its icon in the diff; every workflow step kind is rendered', () => {
  const kinds = new Set([...commands.matchAll(/kind: '([a-z]+)'/g)].map((m) => m[1]));
  const icons = /const KIND_ICON = \{([^}]+)\}/.exec(F['ActCards.jsx'])[1];
  for (const k of ['rank', 'set', 'clear', 'move', 'assign', 'health', 'reserve', 'link', 'unlink', 'book', 'notify', 'capacity']) {
    assert.ok(kinds.has(k) || commands.includes(`'${k}'`), `the registry knows ${k}`);
    assert.match(icons, new RegExp(`\\b${k}:`), `icon for ${k}`);
  }
  const w = F['Workflow.jsx'];
  assert.match(w, /x\.kind === 'story'/);
  assert.match(w, /x\.kind === 'decide'\) return <DecisionCard/);
  assert.match(w, /x\.kind === 'preview'/);
  assert.match(w, /<Progress k=\{run\.progress\.k\}/, 'command steps: applied with progress');
  assert.match(w, /<Summary state=\{s\}/, 'summary');
  // the thread renders every act kind Engine.lotse returns
  const l = F['Lotse.jsx'];
  for (const k of ['command', 'workflow', 'decide']) assert.match(l, new RegExp(`r\\?\\.kind === '${k}'`), `route kind ${k}`);
  for (const k of ['command', 'workflow', 'decide', 'gallery']) assert.match(l, new RegExp(`it\\.act === '${k}'`), `thread renders ${k}`);
  // no-write commands: the report composer after switching to the Report view, navigate to a view
  const hk = F['hooks.js'];
  assert.match(hk, /done\?\.open === 'reportComposer'\) \{ closeLotse\(\); setView\('report'\); setTimeout\(\(\) => openReportComposer\(composerParams/);
  assert.match(hk, /done\?\.navigate\?\.view/);
  assert.ok(COMMAND_IDS.includes('report.compose') && COMMAND_IDS.includes('navigate'));
});

test('apply only with the shown preview\'s token; workflow commands only after the preview step was answered "apply"', () => {
  const c = F['ActCards.jsx'];
  assert.match(c, /applyCommand\(item\.command, item\.params, acts\.io, \{ ctx, token: shown\.token \}\)/);
  assert.match(c, /if \(!live \|\| live\.error \|\| \(write && \(!live\.token \|\| live\.blocked\)\)\) return;/, 'no token, no apply');
  assert.match(c, /disabled=\{busy \|\| \(write && \(!pv\.token \|\| !!pv\.blocked\)\)\}/, 'the button is off without a token');
  assert.match(c, /e\?\.code === 'STALE_PREVIEW'/, 'a stale token re-shows the preview');
  const w = F['Workflow.jsx'];
  assert.match(w, /staleItems\(pvStep, s\.steps, ctx, previewCommand\)\.length\) \{\s*set\(\{ state: replayAnswers\(/, 'changed data → fresh preview first');
  assert.match(w, /let st = answerWorkflow\(s, stepId, 'apply'\);/);
  assert.ok(w.indexOf("answerWorkflow(s, stepId, 'apply')") < w.indexOf('applyWorkflowStep(st, acts.io)'), 'apply comes after the answer');
  // nothing in the acts UI calls a resolver itself – writes go through the engine and the io
  for (const f of ['ActCards.jsx', 'Workflow.jsx', 'Lotse.jsx', 'RunPill.jsx', 'brain.js']) assert.ok(!/\bcall\(|invoke\(/.test(F[f]), `${f} calls a resolver`);
  assert.match(F['hooks.js'], /createIo\(\{ call: invoke, fill, reorder, setDs, reload \}\)/, 'io from the app state');
});

test('undo: every applied command lands in the global history (toast, Ctrl/⌘ + Z, header); the run marks itself undone', () => {
  const hk = F['hooks.js'];
  assert.match(hk, /return pushUndo\(label, async \(\) => \{ await run\(io\); onUndone\?\.\(\); \}/);
  const c = F['ActCards.jsx'];
  assert.match(c, /acts\.record\(/);
  assert.match(c, /runStore\.set\(item\.id, \{ phase: 'undone' \}\)/);
  const w = F['Workflow.jsx'];
  assert.match(w, /entries\[id\] = acts\.record\(/, 'one entry per applied workflow step');
  assert.match(w, /tr\('Alles rückgängig', 'Undo all'\)/);
  assert.match(w, /\[\.\.\.\(s\.applied \|\| \[\]\)\]\.reverse\(\)/, 'undo all: newest first');
  assert.match(w, /acts\.runUndo\(run\.entries\[id\], \{ quiet: true \}\)/, 'through the global history');
});

test('usage: actions, workflow start / done / cancel; undo is counted by the global history', () => {
  assert.match(F['hooks.js'], /track\(`lotse:action:\$\{actionKind\(command\)\}`\)/);
  const w = F['Workflow.jsx'];
  for (const e of ['start', 'done', 'cancel']) assert.match(w, new RegExp(`track\\(\`lotse:workflow:\\$\\{[^}]+\\}:${e}\`\\)`), e);
  assert.match(read('static/cockpit/src/state.jsx'), /track\('undo'\)/);
});

test('accessible: named cards, the stepper marks the current step, decisions are keyboard-first, errors are announced', () => {
  const c = F['ActCards.jsx'];
  assert.match(c, /<motion\.article ref=\{root\} className=\{`lx-card is-\$\{tone\}`\} aria-label=/);
  assert.match(c, /role=\{multi \? 'checkbox' : undefined\} aria-checked=/);
  assert.match(c, /k >= 1 && k <= 9/, 'keys 1–9');
  assert.match(c, /aria-invalid=\{!!err\}/);
  assert.match(c, /className="lx-err" role="alert"/);
  assert.match(c, /<caption className="sr">/);
  const w = F['Workflow.jsx'];
  assert.match(w, /aria-current=\{p\.current \? 'step' : undefined\}/);
  assert.match(w, /role="progressbar" aria-valuemin=\{0\} aria-valuemax=\{n\} aria-valuenow=\{k\}/);
  assert.match(F['RunPill.jsx'], /aria-label=\{tr\(`Lotse-Aufgabe fortsetzen/);
  for (const f of ['ActCards.jsx', 'Workflow.jsx', 'Lotse.jsx']) for (const m of F[f].matchAll(/<button[^>]*className="[^"]*btn-icon[^"]*"[^>]*>/g)) assert.match(m[0], /aria-label=/, `${f}`);
  for (const f of ['ActCards.jsx', 'Workflow.jsx', 'RunPill.jsx']) assert.ok((F[f].match(/\btr\(/g) || []).length >= 4, `${f} speaks DE + EN`);
  for (const [f, src] of Object.entries(F)) assert.ok(!/rovo/i.test(src), f);
});

test('the search (Ctrl K) is Lotse-first and never writes: Lotse\'s top row, navigation, jobs and commands, recent and suggested', () => {
  assert.match(pal, /import\('\.\/components\/lotse\/brain\.js'\)/, 'the engine loads lazily');
  assert.match(pal, /brain\.instant\(dq, lctx\)/);
  assert.match(pal, /top: true, run: \(\) => openLotse\(\{ text: q\.trim\(\) \}\)/, 'Enter on the top row opens the panel');
  assert.match(pal, /brain\.jobRows\(s\)/);
  assert.match(pal, /brain\.commandRows\(lctx, s\)/);
  assert.match(pal, /brain\.suggestedJobs\(lctx\)/);
  assert.match(pal, /tr\('Zuletzt mit Lotse', 'Recently with Lotse'\)/);
  assert.match(pal, /openLotse\(\{ gallery: true \}\)/);
  assert.match(pal, /it\.mini && it\.mini\.count > 0/, 'live mini-preview');
  for (const w of ['applyCommand', 'smartRun', 'parseAction', 'applyWorkflowStep']) assert.ok(!pal.includes(w), `the palette never writes (${w})`);
  assert.match(app, /<RunPill \/>/, 'the header pill');
  // the brain answers without writing: understand + previewCommand only
  assert.ok(!/applyCommand|applyWorkflowStep|Engine\.apply\b/.test(F['brain.js']), 'brain.js never applies');
});

test('keys 1–9 answer ONE decision: the focused one, else the newest open one (live finding: two jobs answered by one key)', () => {
  const c = F['ActCards.jsx'];
  assert.match(c, /const owner = focused && panel\.contains\(focused\) \? focused : \[\.\.\.panel\.querySelectorAll\('\[data-act="decide"\]'\)\]\.pop\(\);/);
  assert.match(c, /if \(owner !== root\.current\) return;/);
});
