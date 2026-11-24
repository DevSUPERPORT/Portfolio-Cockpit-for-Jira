// "Nachprüfen" in the UI: one affordance (shield-check mark + "Nachprüfen" / "Check it yourself") in the KPI drawer,
// the expandable maturity rows, Lotse stories, AI suggestions and workflow summaries; JQL in batches of 100; sums
// recounted in the browser (recountProof), never trusted from the server; motion and language rules kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../static/cockpit/src/${p}`, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const panel = read('components/ProofPanel.jsx'), lotse = read('components/ProofLotse.jsx'), css = read('components/proof.css');

test('openJql: valid keys only, de-duplicated, 100 per search, encoded into /issues/?jql=', async () => {
  const api = read('lib/api.js');
  assert.match(api, /export async function openJql\(keys, \{ batch = null \} = \{\}\)/);
  assert.match(api, /`\/issues\/\?jql=\$\{encodeURIComponent\(jqlFor\(ks\)\)\}`/);
  assert.match(api, /b\.router\.open\(u\)/, 'inside Jira through the bridge router');
  assert.match(api, /window\.open\(`https:\/\/example\.atlassian\.net\$\{u\}`, '_blank'\)/, 'mock: the example site');
  // the pure part, as the module defines it
  const src = api.slice(api.indexOf('export const JQL_CHUNK'), api.indexOf('export async function openJql'));
  const mod = await import(`data:text/javascript,${encodeURIComponent(src)}`);
  const keys = Array.from({ length: 250 }, (_, i) => `ABC-${i + 1}`);
  const ch = mod.jqlChunks([...keys, 'ABC-1', 'not a key', null, ' abc-7 ']);
  assert.deepEqual(ch.map((c) => c.length), [100, 100, 50]);
  assert.equal(new Set(ch.flat()).size, 250);
  assert.equal(mod.jqlFor(['A-1', 'B-2']), 'key in (A-1, B-2) ORDER BY key ASC');
});

test('the KPI drawer: Nachprüfen with steps, recount in the browser, rows table, JQL, CSV and the deep page', () => {
  const tiles = read('components/KpiTiles.jsx');
  assert.match(tiles, /\{all && k\.proof && <KpiProof k=\{k\} startOpen=\{check\} onDeep=\{onDeep\} subject=\{subject\} \/>\}/);
  assert.match(tiles, /<ProofItems items=\{items\} proof=\{k\.proof\}/, 'maturity rows expand to their epics and stories');
  assert.match(tiles, /requestProofCard\(k\.id\); setFull\(null\); setView\('proof'\)/, 'the way to the independent recount');
  assert.match(tiles, /onAll\(true\)/, '"Nachprüfen" from the hover breakdown opens the drawer with the check open');
  assert.match(panel, /const rc = useMemo\(\(\) => recountProof\(p, k\.value\), \[p, k\.value\]\);/, 'sums recomputed in the browser from the rows');
  assert.match(panel, /tr\('Summe stimmt', 'Sum checks out'\)/);
  assert.match(panel, /tr\('Abweichung', 'Mismatch'\)/);
  assert.match(panel, /aria-sort=\{aria\(id\)\}/, 'sortable columns announce their order');
  assert.match(panel, /onClick=\{\(\) => openIssue\(r\.key\)\}/, 'every key opens the work item');
  assert.match(panel, /downloadCsv\(/);
  assert.match(panel, /openJql\(keys, \{ batch: b \}\)/);
  assert.match(panel, /aria-expanded=\{isOpen\}/, 'expandable rows are buttons with aria-expanded');
  assert.match(read('views/Proof.jsx'), /takeProofCard\(\)/, 'the Nachweis view opens the requested card');
});

test('Lotse and the AI: every number with its source, keys to Jira, Lotse\'s check in one line, writes to verify', () => {
  const card = read('components/lotse/StoryCard.jsx');
  assert.match(card, /<StoryProofButton open=\{proof\} onToggle=\{\(\) => setProof\(!proof\)\} \/>/);
  assert.match(card, /\{proof && <StoryProof story=\{s\} onGo=\{go\} \/>\}/);
  assert.match(lotse, /selfCheck\(story\)/, 'the story\'s own text is checked against its numbers');
  assert.match(lotse, /storyFacts\(s, \{ derived: false \}\)\.keys/);
  assert.match(lotse, /tr\('Lotse hat geprüft: stimmt', 'Checked by Lotse: matches'\)/);
  assert.match(lotse, /tr\(`Lotse hat geprüft: weicht ab \(\$\{wrong\}\)`/);
  assert.match(read('components/AiAssist.jsx'), /<AiProof lotse=\{lotse\} r=\{r\} cmp=\{cmp\} check=\{check\} aiOn=\{ai\.aiEnabled\} \/>/);
  const wf = read('components/lotse/Workflow.jsx');
  assert.match(wf, /changedKeys\(state, computed\?\.model, ds\?\.supportTickets\?\.tickets\)/);
  assert.match(wf, /tr\(`In Jira ansehen \(\$\{written\.length\}\)`, `View in Jira \(\$\{written\.length\}\)`\)/);
  assert.match(lotse, /x\.status !== 'applied'/, 'only what was actually applied');
  assert.match(lotse, /out\.delete\(kk\)/, 'failed items are left out');
});

test('one affordance, motion and language rules', () => {
  for (const [f, src] of [['ProofPanel.jsx', panel], ['ProofLotse.jsx', lotse]]) {
    const s = strip(src);
    assert.ok(!/AnimatePresence|\bexit=\{/.test(s), `${f}: no exit animations`);
    assert.ok(!/console\./.test(s), `${f}: no console`);
    assert.ok(!/rovo/i.test(src), `${f}`);
    assert.ok((s.match(/\btr\(/g) || []).length >= 10, `${f} speaks DE + EN`);
  }
  assert.match(panel, /export const proofWord = \(\) => tr\('Nachprüfen', 'Check it yourself'\);/);
  for (const f of ['components/KpiTiles.jsx', 'components/ProofLotse.jsx', 'components/lotse/Workflow.jsx']) assert.match(read(f), /ProofIcon/, `${f} uses the one mark`);
  assert.ok(!/box-shadow\s+var\(--dur|transition:[^;]*(width|height|box-shadow)/.test(css), 'no layout / shadow transitions');
  assert.match(css, /\.pf-scroll \{[^}]*overflow: auto/, 'tables scroll inside their container');
  assert.match(css, /@media \(max-width: 560px\)/, 'phones');
});
