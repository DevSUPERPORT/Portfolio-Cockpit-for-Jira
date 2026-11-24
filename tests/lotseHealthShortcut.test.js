// J-1 (tests/golden/JOBS.md): Lotse's "Als Health übernehmen" must open the health dialog of THAT project, pre-filled with
// the drafted status and sentence – nothing is saved until the person clicks "Speichern".
// The path: healthDraft action (navigate) → components/lotse/actions.js go({ view, opts }) → state.jsx setView keeps
// opts.health as `healthReq` → views/Portfolio.jsx opens HealthModal with that draft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lotseCtx } from './lotseFixture.js';
import { ask } from '../shared/lotse/index.js';
import { lotseDraft } from '../shared/lotse/teamwork.js';

const src = (p) => readFileSync(new URL(`../static/cockpit/src/${p}`, import.meta.url), 'utf8');

test('J-1: the health draft action carries project, status and sentence to a view that exists', () => {
  for (const lang of ['de', 'en']) {
    const ctx = lotseCtx(lang);
    const it = ctx.computed.model.items[1];
    const s = ask(lang === 'de' ? `Health-Entwurf für ${it.name}` : `Health draft for ${it.name}`, ctx);
    assert.equal(s.skill, 'healthDraft');
    const a = s.actions.find((x) => x.id === 'health');
    assert.ok(a, 'the story offers "Als Health übernehmen"');
    assert.equal(a.kind, 'navigate');
    const draft = lotseDraft('healthDraft', { ref: it.ref }, ctx).result;
    // the view is one the app mounts (not the unknown "health" that fell back to Portfolio without the dialog)
    assert.equal(a.payload.view, 'portfolio');
    assert.deepEqual(a.payload.opts, { ref: it.ref, health: { ref: it.ref, status: draft.status, comment: draft.comment } });
    assert.ok(['onTrack', 'atRisk', 'critical'].includes(a.payload.opts.health.status));
    assert.ok(a.payload.opts.health.comment.length > 5);
  }
});

test('J-1: the UI path keeps the draft until the dialog opens (actions → setView → Portfolio → HealthModal)', () => {
  // actions.js hands the payload's opts through unchanged
  assert.match(src('components/lotse/actions.js'), /go\(\{ view, opts: p\.opts \|\|/);
  // App.jsx mounts the portfolio view under that id
  assert.match(src('App.jsx'), /\{ portfolio: Portfolio,/);
  const state = src('state.jsx');
  assert.match(state, /if \(opts\.health\?\.ref\) setHealthReq\(\{ ref: opts\.health\.ref, status: opts\.health\.status/, 'setView keeps status and comment');
  assert.match(state, /healthReq, clearHealthReq:/, 'the request is in the app context');
  const pf = src('views/Portfolio.jsx');
  assert.match(pf, /healthReq, clearHealthReq \} = useApp\(\)/);
  assert.match(pf, /setHealthDraft\(\{ status: healthReq\.status, comment: healthReq\.comment \}\); setHealthFor\(p\);/, 'the dialog opens for the requested project');
  assert.match(pf, /<HealthModal project=\{healthFor\} draft=\{healthDraft\}/);
  assert.match(pf, /function HealthModal\(\{ project, draft: handed, onClose \}\)/);
  assert.match(pf, /setStatus\(handed\?\.status \|\| project\.health\?\.status \|\| 'onTrack'\); setComment\(String\(handed\?\.comment \|\| ''\)/, 'status and sentence are pre-filled');
  // saving stays the explicit last step
  assert.match(pf, /const save = async \(\) => \{\s*setBusy\(true\);\s*try \{ await setHealth\(project\.ref, status, comment\.trim\(\)\)/);
});
