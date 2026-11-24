// Ask canvas, live E2E 2026-11-24 with 1,400 demo work items:
//  1. board cards overlapped: a card renders nothing until its answer exists, so the size observer (attached once, on
//     mount) never saw it – it must attach when the card appears
//  2. undoing a board left its cards on the canvas (exit animations stall in the Jira frame) – undo starts a new epoch
//  3. canvas-wide steps share the key 'canvas': an older one is undone only together with the newer ("back to here")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../static/cockpit/src/views/Ask.jsx', import.meta.url), 'utf8');

test('Ask card: the size observer attaches once the card is shown (not only on the first, empty render)', () => {
  assert.match(src, /const shown = !!a;\s*useLayoutEffect\(\(\) => \{[\s\S]{0,200}new ResizeObserver[\s\S]{0,120}\}, \[shown\]\);/);
});

test('Ask canvas: undoing a board or "clear" swaps the whole canvas (new epoch) and is ordered with the other canvas steps', () => {
  const board = /pushUndo\(tr\(`Board „\$\{b\.name\}“ geöffnet`[\s\S]{0,120}async \(\) => \{ setCards\(prev\); setEpoch\(\(e\) => e \+ 1\);[\s\S]{0,80}\}, \['canvas', /;
  const clear = /pushUndo\(tr\('Leinwand geleert', 'canvas cleared'\), async \(\) => \{ setCards\(prev\); setEpoch\(\(e\) => e \+ 1\);[\s\S]{0,60}\}, \['canvas', /;
  assert.match(src, board);
  assert.match(src, clear);
});

test('Ask canvas: settling reads each card\'s real height from the page and runs again after a board opens', () => {
  assert.match(src, /const heightOf = \(c\) => \{ const el = [^\n]*querySelector\(`\[data-card="\$\{c\.id\}"\]`\)[^\n]*el\.offsetHeight[^\n]*\|\| sizes\.current\.get\(c\.id\) \|\| EST_H\[c\.view\]/);
  assert.match(src, /setTimeout\(settle, 400\); setTimeout\(settle, 1500\);/);
  assert.match(src, /data-card=\{c\.id\} className=\{`ask-card/);
});
