// Smart suggestions: every proposal comes from data already in Jira, says why, and never invents numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAll } from '../shared/engine.js';
import { smartSuggestions } from '../shared/smart.js';

const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url)));

// A small project: epic E (rough level, team Web, no size/quarters) with three stories.
function fixture(patch = (x) => x) {
  const ds = {
    today: '2026-11-02',
    config: {
      levels: [
        { key: 'ep', name: 'Epic', role: 'rough', issueTypeIds: ['3'] },
        { key: 'st', name: 'Story', role: 'estimate', issueTypeIds: ['4'] },
      ],
      matrix: { ep: { team: 'required', tshirt: 'required', targetQuarters: 'required' }, st: { team: 'required', originalEstimate: 'required', startDate: 'required', dueDate: 'required' } },
      tshirtSizes: [{ key: 'XS', hours: 40 }, { key: 'S', hours: 80 }, { key: 'M', hours: 160 }, { key: 'L', hours: 320 }, { key: 'XL', hours: 640 }],
      fields: {},
    },
    portfolio: [{ ref: 'issue:p1', rank: 1, kind: 'issue', id: 'p1', key: 'P-1', name: 'Projekt', statusCat: 'indeterminate', owner: { id: 'u1', name: 'O' }, due: '2027-03-31' }],
    teams: [{ id: 'web', name: 'Web' }, { id: 'data', name: 'Data' }],
    issues: [
      { id: 'e1', key: 'P-2', summary: 'Epic', role: 'rough', levelKey: 'ep', parentId: 'p1', rootRef: 'issue:p1', status: { cat: 'indeterminate' }, team: { id: 'web', name: 'Web' }, tshirt: null, quarters: [] },
      { id: 's1', key: 'P-3', summary: 'A', role: 'estimate', levelKey: 'st', parentId: 'e1', rootRef: 'issue:p1', status: { cat: 'indeterminate' }, team: null, oe: 60, re: 40, ts: 20, start: '2026-11-03', due: '2026-12-10', worklogs: [] },
      { id: 's2', key: 'P-4', summary: 'B', role: 'estimate', levelKey: 'st', parentId: 'e1', rootRef: 'issue:p1', status: { cat: 'new' }, team: { id: 'web', name: 'Web' }, oe: 0, re: 16, ts: 0, start: null, due: '2027-01-20', worklogs: [{ d: '2026-10-28', h: 2 }, { d: '2026-10-21', h: 1 }] },
      { id: 's3', key: 'P-5', summary: 'C', role: 'estimate', levelKey: 'st', parentId: 'e1', rootRef: 'issue:p1', status: { cat: 'new' }, team: { id: 'web', name: 'Web' }, oe: 50, re: 50, ts: 0, start: '2026-11-10', due: null, worklogs: [] },
    ],
  };
  return patch(ds);
}
const byGap = (list) => Object.fromEntries(list.map((s) => [s.id, s]));

test('stories inherit the team of the epic, with the reason', () => {
  const s = byGap(smartSuggestions(computeAll(fixture()), { lang: 'en' }));
  assert.equal(s['s1:missing:team'].value, 'web');
  assert.match(s['s1:missing:team'].why, /P-2 "Epic" belongs to this team/);
});

test('T-shirt size: the smallest size that covers the estimated stories (a floor)', () => {
  const s = byGap(smartSuggestions(computeAll(fixture()), { lang: 'en' }));
  // stories below the epic: 60 + 0 + 50 = 110 h → S (80) is too small, M (160) is the smallest that covers it
  assert.equal(s['e1:missing:tshirt'].value, 'M');
  assert.match(s['e1:missing:tshirt'].why, /110 h.*M is the smallest size/);
});

test('no T-shirt suggestion without any estimate below', () => {
  const s = byGap(smartSuggestions(computeAll(fixture((ds) => { ds.issues.forEach((i) => { i.oe = 0; }); return ds; })), { lang: 'en' }));
  assert.equal(s['e1:missing:tshirt'], undefined);
});

test('quarters from the scheduled open stories, never in the past', () => {
  const s = byGap(smartSuggestions(computeAll(fixture()), { lang: 'en' }));
  assert.deepEqual(s['e1:missing:targetQuarters'].value, ['2026-Q4', '2027-Q1']);
});

test('original estimate only from a remaining estimate Jira already has', () => {
  const s = byGap(smartSuggestions(computeAll(fixture()), { lang: 'en' }));
  assert.equal(s['s2:missing:originalEstimate'].value, 16);
  const none = byGap(smartSuggestions(computeAll(fixture((ds) => { ds.issues[2].re = 0; return ds; })), { lang: 'en' }));
  assert.equal(none['s2:missing:originalEstimate'], undefined, 'no figure in Jira → no suggestion');
});

test('start date = the first day time was logged', () => {
  const s = byGap(smartSuggestions(computeAll(fixture()), { lang: 'en' }));
  assert.equal(s['s2:missing:startDate'].value, '2026-10-21');
});

test('a missing due date is suggested only from a milestone, overdue dates never', () => {
  const s = byGap(smartSuggestions(computeAll(fixture()), { lang: 'en' }));
  assert.equal(s['s3:missing:dueDate'], undefined, 'no milestone → no due date suggestion');
  const late = byGap(smartSuggestions(computeAll(fixture((ds) => { ds.issues[1].due = '2026-10-01'; return ds; })), { lang: 'en' }));
  assert.equal(late['s1:overdue'], undefined);
});

test('every suggestion explains itself and targets a fixable gap (golden data)', () => {
  const c = computeAll(structuredClone(golden));
  for (const lang of ['de', 'en']) {
    for (const s of smartSuggestions(c, { lang })) {
      assert.ok(s.gap.fixable, s.id);
      assert.equal(s.usage, s.gap.field);
      assert.ok(typeof s.why === 'string' && s.why.length > 10, `${s.id} says why`);
      assert.ok(s.value != null && s.show != null, `${s.id} has a value`);
    }
  }
});
