// Add project – search (boss 2026-11-19): "one letter missing in the key and the search fails; even the whole name is not
// always found". The matcher behind the drawer: partial keys, word starts in any order, accents/dashes, typos, initials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rankCandidates, scoreCandidate, matchParts, keyPrefixOf, searchWords } from '../shared/projectSearch.js';

const P = [
  ['PCX-56', 'Projekt #1'], ['PCX-57', 'Glasfaser Süd – Ausbau'], ['PCX-5', 'Kick-off Vorlage'], ['PCX-150', 'Zahlungsverkehr Instant Payments'],
  ['PCX-59', 'KI-Kundenservice Phase 2'], ['TEL-81', 'Rechenzentrum-Konsolidierung'], ['MOB-12', 'Mobile App 3.0'], ['ERP-40', 'ERP-Anbindung Finanzen'],
].map(([key, name], i) => ({ ref: `issue:${i}`, key, name, space: 'Portfolio Cockpit Sandbox', owner: { name: i === 6 ? 'Ákos Kun' : 'Dev Team' } }));
const keys = (q) => rankCandidates(P, q).map((x) => x.key);

test('keys: a part is enough – the exact key first, then the keys it starts', () => {
  assert.deepEqual(keys('PCX-56'), ['PCX-56']);
  assert.equal(keys('PCX-5')[0], 'PCX-5', 'the exact key first');
  assert.deepEqual(new Set(keys('PCX-5')), new Set(['PCX-5', 'PCX-56', 'PCX-57', 'PCX-59']), 'PCX-5 finds PCX-5x, not PCX-150');
  assert.equal(keys('pcx56')[0], 'PCX-56', 'case and the dash do not matter');
  assert.equal(keys('pcx 56')[0], 'PCX-56');
  assert.equal(keys('PCX').length, 5, 'the space key alone lists its projects');
  assert.deepEqual(keys('mob-1'), ['MOB-12']);
});

test('names: whole or partial, any order, without accents or dashes, with a typo, by initials', () => {
  assert.equal(keys('Glasfaser Süd – Ausbau')[0], 'PCX-57', 'the full name with a dash');
  assert.equal(keys('glasfaser sud ausbau')[0], 'PCX-57', 'without accent and dash');
  assert.equal(keys('ausbau glas')[0], 'PCX-57', 'word starts in any order');
  assert.equal(keys('glasfasr')[0], 'PCX-57', 'a typo');
  assert.equal(keys('rechenzentrum konsoldierung')[0], 'TEL-81', 'a typo in a long word');
  assert.equal(keys('zahlung')[0], 'PCX-150', 'a word start');
  assert.equal(keys('kundenservice')[0], 'PCX-59', 'a word inside a hyphenated name');
  assert.equal(keys('instant pay')[0], 'PCX-150');
  assert.ok(keys('mo').includes('MOB-12'), 'two letters already answer');
  assert.ok(keys('kkp').includes('PCX-59'), 'initials: KI-Kundenservice Phase');
  assert.equal(keys('Projekt #1')[0], 'PCX-56', 'punctuation in the name');
  assert.deepEqual(keys('xyzzy'), [], 'nothing unrelated');
  assert.deepEqual(keys('akos').slice(0, 1), ['MOB-12'], 'the owner as a weaker match');
});

test('ranking: key and name beat space and owner; an empty query keeps the incoming order', () => {
  assert.ok(scoreCandidate(P[0], 'PCX-56') > scoreCandidate(P[0], 'projekt'));
  assert.ok(scoreCandidate(P[1], 'glasfaser') > scoreCandidate(P[1], 'sandbox'));
  assert.deepEqual(rankCandidates(P, '  ').map((x) => x.key), P.map((x) => x.key));
  assert.equal(rankCandidates(P, 'pcx', 2).length, 2, 'limit');
});

test('highlighting and the server helpers', () => {
  assert.deepEqual(matchParts('PCX-56', 'pcx5'), [{ t: 'PCX-5', hit: true }, { t: '6', hit: false }]);
  const parts = matchParts('Glasfaser Süd – Ausbau', 'aus glas');
  assert.deepEqual(parts.filter((p) => p.hit).map((p) => p.t), ['Glas', 'Aus']);
  assert.equal(parts.map((p) => p.t).join(''), 'Glasfaser Süd – Ausbau', 'the text is unchanged');
  assert.equal(keyPrefixOf('pcx-5'), 'PCX');
  assert.equal(keyPrefixOf('PCX'), 'PCX');
  assert.equal(keyPrefixOf('Glasfaser Nord'), null);
  assert.deepEqual(searchWords('Glasfaser – Nord! a'), ['glasfaser', 'nord']);
});

test('the drawer loads once and filters in the browser; the server searches too on large sites', () => {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /const wantPool = payload\.pool === true;/);
  assert.match(src, /return wantPool \? \{ items: list, truncated \} : list\.slice\(0, 40\);/);
  assert.ok(!/AND key = \$\{qtext/.test(src), 'no exact-key-only search any more');
  const pf = readFileSync(new URL('../static/cockpit/src/views/Portfolio.jsx', import.meta.url), 'utf8');
  assert.match(pf, /call\('portfolio\.candidates', \{ pool: true \}\)/);
  assert.match(pf, /const shown = useMemo\(\(\) => rankCandidates\(all, q, 60\), \[all, q\]\);/);
  assert.match(pf, /data-project-search/);
});
