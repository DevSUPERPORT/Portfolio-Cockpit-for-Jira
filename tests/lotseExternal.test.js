// Live finding (2026-11-12, superportdev): a schedule conflict whose waiting item lies outside the portfolio made the
// portfolio briefing say "der größte: undefined startet …". Every key in a sentence must be real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotseDataset } from './lotseFixture.js';
import { computeAll } from '../shared/engine.js';
import { run, selfCheck } from '../shared/lotse/index.js';

test('a conflict with an item outside the portfolio: no "undefined", singular/plural right, every claim sourced', () => {
  const ds = lotseDataset();
  // make the first conflict's dependent item an external one: drop it from the portfolio's issues, keep it as external
  const c0 = computeAll(ds);
  const conf = c0.deps.list.find((d) => d.conflict);
  assert.ok(conf, 'the fixture has a conflict');
  const depIssue = ds.issues.find((i) => i.id === conf.dep);
  const ds2 = { ...ds, issues: ds.issues.filter((i) => i.id !== conf.dep), external: [...(ds.external || []), { ...depIssue, rootRef: null }] };
  for (const d of [ds, ds2]) {
    const c = computeAll(d);
    for (const lang of ['de', 'en']) {
      const s = run('portfolioBrief', {}, { ds: d, computed: c, lang, roles: { admin: true } });
      const text = [s.headline, ...s.findings.map((f) => f.text)].join(' ');
      assert.doesNotMatch(text, /undefined|null|NaN/);
      assert.doesNotMatch(text, /\b1 (Terminkonflikte|schedule conflicts)\b/, 'singular for one conflict');
      assert.deepEqual(selfCheck(s), []);
    }
  }
});

test('the fixture really builds the external case (the conflict survives with the waiting item outside)', () => {
  const ds = lotseDataset();
  const conf = computeAll(ds).deps.list.find((d) => d.conflict);
  const depIssue = ds.issues.find((i) => i.id === conf.dep);
  const c = computeAll({ ...ds, issues: ds.issues.filter((i) => i.id !== conf.dep), external: [{ ...depIssue, rootRef: null }] });
  assert.ok(c.model.external.has(conf.dep), 'external item known');
  assert.ok(c.deps.list.some((d) => d.conflict && d.dep === conf.dep), 'the conflict is still there');
});
