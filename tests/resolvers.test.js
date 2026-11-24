// Live finding 2026-11-11: booking.worklogs used ctx without receiving it ("ctx is not defined" in production).
// Every resolver that touches ctx must take it from its arguments.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('every resolver that uses ctx receives it', () => {
  const parts = src.split(/\ndef\('/).slice(1);
  const bad = [];
  for (const p of parts) {
    const name = p.slice(0, p.indexOf("'"));
    const head = /^[^']+',\s*(?:async\s*)?\(\{([^}]*)\}\)/.exec(p);
    if (!head) continue;
    const body = p.slice(head[0].length, p.search(/\n(?:def\(|export |async function |function |const |\/\/ -{5})/) >>> 0 || undefined);
    if (/\bctx\b/.test(body) && !/\bctx\b/.test(head[1])) bad.push(name);
  }
  assert.deepEqual(bad, []);
});
