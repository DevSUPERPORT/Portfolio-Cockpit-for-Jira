// Logs SUPERPORT can read must never carry customer content or personal data (App EULA 8.2 / App privacy):
// every server log line goes through src/lib/safeLog.js, which never prints Jira's error texts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { safeError, scrub } from '../src/lib/safeLog.js';
import { HttpError } from '../src/lib/jira.js';

const files = (dir) => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : []; });

test('no server code calls console.* directly (only safeLog, and the vendor\'s own AI_BUDGET notice)', () => {
  const bad = [];
  for (const f of [...files('src'), ...files('shared')]) {
    if (/safeLog\.js$/.test(f)) continue;
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/console\.(log|info|warn|error|debug)\(/.test(l) && !/envBudget\(env = process\.env, warn = \(m\) => console\.warn\(m\)\)/.test(l)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('Jira errors are logged by status only – their text (which may hold customer values) never', () => {
  const e = new HttpError(400, "The value 'Glasfaser Nord' does not exist for the field 'project'. User 712020:00000000-aaaa-4bbb-8ccc-000000000001", { errorMessages: ['x'] });
  const s = safeError(e);
  assert.equal(s, 'HttpError 400');
  assert.ok(!/Glasfaser|712020|project/.test(s));
});

test('our own error messages are scrubbed of quoted values, e-mails, ids, keys and long numbers', () => {
  const s = safeError(new TypeError("Cannot read 'Anna Becker' of PCX-27 for anna@example.com (712020:00000000-aaaa-4bbb-8ccc-000000000001) id 10048"));
  for (const leak of ['Anna', 'PCX-27', 'anna@', '712020', '10048']) assert.ok(!s.includes(leak), `${leak} in ${s}`);
  assert.match(s, /^TypeError: Cannot read/);
  assert.equal(scrub('x'.repeat(500)).length, 160);
});

test('jobs and triggers rethrow only the scrubbed error', async () => {
  const src = readFileSync('src/index.js', 'utf8');
  for (const n of ['reportJob', 'hourlyJob', 'lockEnforcer']) assert.match(src, new RegExp(`export const ${n} = guarded\\(`));
  assert.match(src, /throw new Error\(safeError\(e\)\)/);
});
