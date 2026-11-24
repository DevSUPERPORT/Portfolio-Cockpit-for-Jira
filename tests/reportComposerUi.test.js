// The report composer's UI (static/cockpit/src/components/report/**): static checks like the other UI tests – smooth
// motion without exit animations, an accessible full-screen dialog, a keyboard way to reorder, AI only when switched
// on, drafts kept safely, and the Report view's entry point.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const DIR = 'static/cockpit/src/components/report';
const files = readdirSync(new URL(`../${DIR}`, import.meta.url)).filter((f) => /\.(jsx?|css)$/.test(f));
const src = Object.fromEntries(files.map((f) => [f, read(`${DIR}/${f}`)]));
const code = files.filter((f) => /\.jsx?$/.test(f));
const C = src['ReportComposer.jsx'];

test('report/**: no AnimatePresence, no exit animations, motion only on transform / opacity', () => {
  assert.ok(code.length >= 5, `${code.length} files`);
  for (const f of code) {
    assert.ok(!/AnimatePresence/.test(src[f]), `${f} uses AnimatePresence`);
    assert.ok(!/\bexit=\{/.test(src[f]), `${f} has an exit animation`);
    for (const m of src[f].matchAll(/(?:initial|animate|whileDrag)=\{\{([^}]*)\}\}/g)) assert.ok(!/\b(width|height|top|left|right|bottom|margin|padding)\s*:/.test(m[1]), `${f} animates layout: ${m[1]}`);
  }
  // CSS transitions: no layout properties either
  for (const m of src['composer.css'].matchAll(/transition:\s*([^;]+);/g)) assert.ok(!/\b(width|height|top|left|margin|padding)\b/.test(m[1]), `css transition on layout: ${m[1]}`);
  assert.match(src['composer.css'], /prefers-reduced-motion/);
});

test('accessible dialog: name, Esc closes, focus stays inside and returns, live announcements', () => {
  assert.match(C, /role="dialog" aria-modal="true" aria-labelledby="rc-title"/);
  assert.match(C, /e\.key === 'Escape'[\s\S]{0,200}onClose\(\)/);
  assert.match(C, /e\.key === 'Tab'/, 'focus trap');
  assert.match(C, /opener\.current/, 'focus goes back to the opener');
  assert.match(C, /aria-live="polite"/);
  assert.match(src['Host.jsx'], /createPortal\(/, 'rendered at the top of the page, above every view');
});

test('keyboard alternative to dragging: Alt+↑/↓ and move buttons with labels', () => {
  assert.match(C, /e\.altKey && e\.key === 'ArrowUp'/);
  assert.match(C, /e\.altKey && e\.key === 'ArrowDown'/);
  assert.match(C, /Reorder\.Group/);
  assert.match(C, /dragListener=\{false\}/, 'dragging only from the grip – clicks and text selection stay normal');
  // the opening tag runs until its children start ("><Icon", ">{")
  for (const f of code) {
    for (const m of src[f].matchAll(/<button\b[\s\S]*?>(?=\s*<|\s*\{)/g)) {
      if (/className="(?:[^"]*\bbtn-icon\b[^"]*|rc-ib)"/.test(m[0])) assert.match(m[0], /aria-label=/, `${f}: icon button without a label: ${m[0].slice(0, 100)}`);
    }
  }
  assert.match(C, /role="menu"/);
  assert.match(C, /role="menuitem"/);
});

test('numbers stay true: chips are not editable, typed numbers are checked, every text is a labelled textbox', () => {
  const N = src['Narrative.jsx'];
  assert.match(N, /contenteditable="false" data-f=/);
  assert.match(N, /role="textbox" aria-multiline="true" aria-label=\{label\}/);
  assert.match(N, /getData\('text\/plain'\)/, 'paste as plain text');
  assert.match(C, /checkSection\(/);
  assert.match(C, /rc-problems/);
});

test('AI only when switched on, with the cross-check shown; Lotse rephrasing works without it', () => {
  assert.match(C, /aiOn\(config, 'reportSummary'\)/);
  assert.match(C, /aiOn\(config, 'lotse'\)/);
  assert.match(C, /call\('ai\.reportSummary'/);
  assert.match(C, /call\('lotse\.llm'/);
  assert.match(C, /crossCheck\(/);
  assert.match(C, /rephrase\(s\)/);
});

test('undo/redo, autosave guarded, outputs wired', () => {
  assert.match(C, /const undo = /);
  assert.match(C, /const redo = /);
  assert.match(C, /k === 'z' \|\| k === 'y'/);
  assert.match(C, /addEventListener\('keydown', h, true\)/, 'shortcuts in the capture phase: the app behind never sees them');
  assert.match(C, /e\.stopPropagation\(\);\s*if \(k === 'y'/, "the app's own Ctrl+Z (rank changes) never fires behind the dialog");
  assert.match(C, /try \{ return JSON\.parse\(localStorage\.getItem/);
  assert.match(C, /try \{ localStorage\.setItem/);
  assert.match(C, /downloadComposedPdf/);
  assert.match(C, /<PublishComposed open={pub}/, 'Confluence: the composed report, not the snapshot');
  assert.match(C, /summaryText\(doc\)/);
});

test('entry points: the Report view opens the composer, a command can too', () => {
  const R = read('static/cockpit/src/views/Report.jsx');
  assert.match(R, /openReportComposer\(/);
  assert.match(R, /Mit Lotse zusammenstellen/);
  assert.match(R, /<ReportComposerHost /);
  assert.match(R, /downloadReportPdf/, 'the classic PDF export stays');
  const O = src['open.js'];
  assert.match(O, /export function openReportComposer/);
  assert.match(O, /'pc-open-report-composer'/);
  assert.match(src['Host.jsx'], /addEventListener\(REPORT_COMPOSER_EVENT/);
  const P = read('static/cockpit/src/lib/pdf.js');
  assert.match(P, /export async function downloadReportPdf/);
  assert.match(P, /export async function downloadComposedPdf/);
});

test('Confluence from the composer: the edited document, re-checked on the server first, undoable, remembered for updates', () => {
  const P = src['Publish.jsx'];
  assert.match(P, /call\('report\.publishComposed', \{ doc: body, dryRun: true \}\)/, 'the dialog shows the fresh re-check before anything is written');
  assert.match(P, /disabled=\{blocked \|\| !space/, 'problems block the button');
  assert.match(P, /call\('report\.unpublishComposed', \{ pageId: r\.pageId \}\)/, 'undo');
  assert.match(P, /done\(/, 'the undo goes into the app\'s history (toast, Ctrl+Z, header)');
  assert.match(P, /sections: doc\.sections\.map\(\(s\) => \(\{ id: s\.id, kind: s\.kind, title: s\.title, on: s\.on !== false, text: s\.text \|\| '', facts:/, 'only what the person shaped – no data blocks');
  assert.match(P, /pageId: prev\?\.pageId && prev\.spaceId === space && update \? prev\.pageId : undefined|const pageId = prev\?\.pageId && prev\.spaceId === space && update \? prev\.pageId : undefined;/);
  assert.match(P, /track\('report:confluence'\)/);
  assert.match(C, /if \(hist\.doc\?\.published\) d\.published = hist\.doc\.published;/, 'a redraft keeps the page to update');
  assert.ok(!/report\.publish'/.test(C + P), 'the composer never publishes the stored snapshot');
});

test('the draft follows the person: this browser at once, the server a few seconds later, the newer one wins', () => {
  assert.match(C, /call\('prefs\.save', \{ reportDraft: body \}\)/);
  assert.match(C, /call\('report\.draft'\)/);
  assert.match(C, /const SERVER_SAVE_MS = 4000;/);
  assert.match(C, /newer && !edited\.current/, 'a newer server copy never overwrites changes made here');
  assert.match(C, /\(\{ story, entities, \.\.\.s \}\) => s/, 'stories and name lists stay in the browser');
  assert.match(C, /useEffect\(\(\) => \(\) => pushServer\(\), \[pushServer\]\)/, 'closing saves what is pending');
});

test('charts and figures on the sheet speak the REPORT\'s language, drawn like the PDF', async () => {
  assert.match(C, /<ReportVisual visual=\{d\.visual\} lang=\{lang\}/);
  assert.match(C, /figure\(k\.unit, k\.value, lang\)/);
  assert.ok(!/from '\.\.\/lotse\/visuals\.jsx'/.test(C), 'not the app-language Lotse visuals');
  const V = src['ReportVisual.jsx'];
  assert.match(V, /layoutVisual\(/);
  assert.match(V, /visualTable\(visual, L\)/, 'a hidden table with the same numbers for screen readers');
  assert.ok(!/i18n\.js/.test(V), 'no app-language helper in the chart');
  const { layoutVisual } = await import('../static/cockpit/src/components/report/pdfLayout.js');
  const vis = { kind: 'columns', data: { unit: 'h', labels: ['W 46', 'W 47'], series: [{ name: 'Plan', values: [1234, 800] }] } };
  const text = (L) => layoutVisual({ kind: 'chart', data: { visual: vis } }, { lang: L }).ops.filter((o) => o.op === 'text').map((o) => o.text).join(' | ');
  assert.match(text('en'), /1,234 h|925 h|617 h|1,234/);
  assert.match(text('de'), /1\.234 h|925 h|617 h|1\.234/);
  assert.notEqual(text('en'), text('de'));
  const w = layoutVisual({ kind: 'chart', data: { visual: { kind: 'waterline', data: { capacity: 100, items: [{ rank: 1, label: 'A', value: 60, cum: 60, status: 'ok' }, { rank: 2, label: 'B', value: 70, cum: 130, status: 'no' }] } } } }, { lang: 'en' });
  assert.ok(w.height > 5 && w.ops.some((o) => o.op === 'text' && /Capacity/.test(o.text)), 'English words in an English report');
});
