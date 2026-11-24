// Tester 2026-11-18: "the audit log logs everything twice". The server writes one entry per call – what looked like
// doubles were an undo logged under the same name as the change, the same move sent again (nothing changed, still
// logged), and details that never said what changed. Now: no-op writes are skipped, undos are named, details say
// from → to, and the time shows seconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('plan.apply: a move Jira already has is not written or logged; undo is its own action; changes from → to', () => {
  const src = read('src/lib/planApply.js');
  assert.match(src, /return \{ \.\.\.base, ok: true, unchanged: true \}/, 'no-op move: no write');
  assert.match(src, /payload\?\.undo === true \? 'plan\.apply\.undo' : 'plan\.apply'/);
  assert.match(src, /if \(ctx\.accountId && \(changed\.length \|\| moves\.length - ok\)\)/, 'nothing changed, nothing failed: no entry');
  assert.match(src, /changes \}\)/, 'the entry lists what changed');
  // both undo paths say so
  assert.match(read('static/cockpit/src/components/WeekBoard.jsx'), /call\('plan\.apply', \{ moves: \[back\], undo: true \}\)/);
  assert.match(read('shared/lotse/act/commands.js'), /J\.call\('plan\.apply', \{ moves: back\.slice\(k, k \+ MAX_MOVES\), undo: true \}\)/);
});

test('issue.fill: the same value again is skipped; undo and rough-plan entries are named; from → to logged', () => {
  const src = read('src/index.js');
  assert.match(src, /function sameFill\(prev, next\)/);
  assert.equal((src.match(/if \(sameFill\(previous, clear \? null : val\)\) return \{ ok: true, previous, unchanged: true \};/g) || []).length, 2, 'issue and space item paths');
  assert.match(src, /restoring \? 'plan\.update\.undo' : 'plan\.update'/);
  assert.equal((src.match(/restoring \? 'issue\.fill\.undo' : 'issue\.fill', \{ issueId, usage, key: issue\.key, from: previous, to: clear \? null : val \}/g) || []).length, 2, 'app field and Jira field paths');
});

test('audit view: seconds, a name for every undo, readable details', () => {
  const admin = read('static/cockpit/src/views/Admin.jsx');
  assert.match(admin, /fmt\.dateTimeSec\(e\.at\)/);
  for (const a of ['plan.apply', 'plan.apply.undo', 'issue.fill.undo', 'plan.update.undo', 'support.dispatch.undo']) assert.ok(admin.includes(`'${a}':`), a);
  assert.match(read('static/cockpit/src/lib/i18n.js'), /dateTimeSec: /);
});
