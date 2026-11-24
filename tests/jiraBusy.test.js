// Live E2E 2026-11-23: under heavy load Jira answers 429 – the app waits as asked and then says "Jira is busy".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { retryWait } from '../src/lib/jira.js';

const res = (h) => ({ headers: { get: (k) => (k === 'retry-after' ? h : null) } });
test('a 429 waits what Jira asks (Retry-After), at least the back-off, at most 5 s', () => {
  assert.equal(retryWait(res(null), 0), 600);
  assert.equal(retryWait(res(null), 1), 1200);
  assert.equal(retryWait(res('2'), 0), 2000);
  assert.equal(retryWait(res('60'), 0), 5000, 'capped – a resolver has 25 s');
  assert.equal(retryWait(res('x'), 0), 600);
  assert.equal(retryWait({}, 0), 600);
});
test('a 429 reaches the user as BUSY in plain words, not "Unexpected error"', () => {
  const idx = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(idx, /e\.status === 429 \? 'BUSY'/);
  const st = readFileSync(new URL('../static/cockpit/src/state.jsx', import.meta.url), 'utf8');
  assert.match(st, /e\?\.code === 'BUSY'\) return tr\('Jira ist gerade ausgelastet/);
});
