// Report composer: the "+ Section" menu was cut off by the outline column (its scroll clips sideways) and covered by the
// paper (user screenshot 2026-11-24). It is now placed on the composer's own layer, fixed at the button, inside the window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../static/cockpit/src/components/report/ReportComposer.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../static/cockpit/src/components/report/composer.css', import.meta.url), 'utf8');

test('the "+ Section" menu is not inside the clipping outline column: portal on the composer, fixed at the button', () => {
  assert.match(jsx, /function AddMenu\(\{ catalog, present, onPick, onClose, anchor, container \}\)/);
  assert.match(jsx, /return createPortal\(\s*<motion\.div ref=\{ref\} className="rc-menu"[\s\S]{0,1500}<\/motion\.div>,\s*container,\s*\);/);
  assert.match(jsx, /anchor=\{addBtn\} container=\{root\.current\}/);
  assert.match(css, /\.rc-menu \{\s*position: fixed; z-index: 60;/);
});

test('the menu stays inside the window: below the button when there is room, else above; never off the left/right edge', () => {
  assert.match(jsx, /const left = Math\.max\(M, Math\.min\(r\.left, vw - W - M\)\);/);
  assert.match(jsx, /below >= Math\.min\(320, above\) \? \{ left, top: r\.bottom \+ 6/);
  assert.match(jsx, /: \{ left, bottom: vh - r\.top \+ 6/);
});
