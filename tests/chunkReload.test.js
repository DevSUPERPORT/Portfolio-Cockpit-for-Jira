// The page reloads once when a view file of the previous build is gone after a release – never in a loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChunkError, reloadOnce } from '../static/cockpit/src/lib/chunkReload.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('chunk-load errors are recognised across browsers, other errors are not', () => {
  assert.ok(isChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/WeekPlan-abc.js')));
  assert.ok(isChunkError(new TypeError('Importing a module script failed.')));
  assert.ok(isChunkError(new Error('error loading dynamically imported module')));
  assert.ok(isChunkError(new Error('Unable to preload CSS for /assets/x.css')));
  assert.ok(!isChunkError(new Error('Forbidden')));
  assert.ok(!isChunkError(null));
});

test('reloadOnce reloads once, then not again within 30 s, then again later', () => {
  const s = mem();
  globalThis.location = { reload() {} };
  assert.equal(reloadOnce(1_000_000, s), true);
  assert.equal(reloadOnce(1_010_000, s), false);
  assert.equal(reloadOnce(1_040_000, s), true);
});

test('without storage there is no guard, so no automatic reload', () => {
  assert.equal(reloadOnce(1, { getItem() { throw new Error('blocked'); } }), false);
});
