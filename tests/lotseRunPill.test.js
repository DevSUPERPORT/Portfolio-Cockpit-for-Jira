// Tester 2026-11-17: after "Neu" (clear the Lotse thread) the header pill "C-level report 1/1" stayed until a reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStore, activeRun } from '../static/cockpit/src/components/lotse/runStore.js';

test('clearing the thread hides its waiting runs from the header pill at once; undo brings them back', () => {
  runStore.set('wf-1', { kind: 'workflow', state: { status: 'waiting', title: 'C-level report' }, at: 1 });
  assert.equal(activeRun()?.id, 'wf-1');
  runStore.hide(['wf-1', 'not-there']);
  assert.equal(activeRun(), null);
  runStore.hide(['wf-1'], false);
  assert.equal(activeRun()?.id, 'wf-1');
  runStore.drop('wf-1');
  assert.equal(activeRun(), null);
});
