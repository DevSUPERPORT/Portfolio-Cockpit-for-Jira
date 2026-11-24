// Planungs-Check on the work item (management request 2026-11-10): team fit, time allocation, assignee load, conflicts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAll } from '../shared/engine.js';
import { storyCheck, isoWeek } from '../shared/storyCheck.js';
import { dayIdx } from '../shared/dates.js';

const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url), 'utf8'));
const st = (cat) => ({ cat, name: cat === 'done' ? 'Done' : 'To Do' });

// The boss's example: PCX-45 "Anforderungen abstimmen", team Integration, assigned to Dev Team, who is planned in Data;
// it waits for PCX-49, which is due after PCX-45's own due date.
function fixture({ personLevel = true, capTeam = 'tData', preDue = '2027-02-20', absence = null } = {}) {
  const ds = structuredClone(golden);
  const root = ds.portfolio[0].ref;
  ds.today = '2026-11-10';
  ds.config = { ...(ds.config || {}), dependencies: { linkTypeIds: ['10000'] } };
  ds.teams = [...(ds.teams || []), { id: 'tInt', name: 'Integration' }, { id: 'tData', name: 'Data' }];
  ds.people = { ...(ds.people || {}), uDev: { id: 'uDev', name: 'Dev Team' }, uAnna: { id: 'uAnna', name: 'Anna' } };
  ds.capacity = { people: { uDev: { weeklyHours: 40, teamId: capTeam }, uAnna: { weeklyHours: 40, teamId: 'tInt' } }, teams: { tInt: { dailyBusinessPct: 20, internalPct: 10, absenceRatePct: 0 }, tData: { dailyBusinessPct: 20, internalPct: 10, absenceRatePct: 0 } }, absences: absence ? [absence] : [] };
  ds.issues.push(
    { id: '45', key: 'PCX-45', summary: 'Anforderungen abstimmen', role: 'estimate', levelKey: 'st', parentId: null, rootRef: root, status: st('new'), team: { id: 'tInt', name: 'Integration' }, assignee: { id: 'uDev', name: 'Dev Team' }, start: null, due: '2027-02-06', oe: 23, re: 23, ts: 0, worklogs: [],
      links: [{ id: 'L1', typeId: '10000', otherId: '49', outward: false, verb: 'is blocked by' }] },
    { id: '49', key: 'PCX-49', summary: 'UI-Prototyp', role: 'estimate', levelKey: 'st', parentId: null, rootRef: root, status: st('new'), team: { id: 'tInt', name: 'Integration' }, assignee: { id: 'uAnna', name: 'Anna' }, start: '2026-11-16', due: preDue, oe: 10, re: 10, ts: 0, worklogs: [],
      links: [{ id: 'L1', typeId: '10000', otherId: '45', outward: true, verb: 'blocks' }] },
    // a big story that overbooks Dev Team in the coming weeks
    { id: '37', key: 'PCX-37', summary: 'Großer Brocken', role: 'estimate', levelKey: 'st', parentId: null, rootRef: root, status: st('new'), team: { id: 'tData', name: 'Data' }, assignee: { id: 'uDev', name: 'Dev Team' }, start: '2026-11-16', due: '2026-11-27', oe: 80, re: 80, ts: 0, worklogs: [], links: [] },
  );
  ds.personLevel = personLevel ? undefined : false;
  return computeAll(ds);
}

test('assignee outside the story team is flagged, with the fix spelled out', () => {
  const r = storyCheck(fixture(), '45', { lang: 'de' });
  assert.equal(r.known, true);
  assert.equal(r.kind, 'story');
  const mis = r.team.notes.find((n) => n.key === 'teamMismatch');
  assert.ok(mis, 'mismatch note');
  assert.equal(mis.tone, 'warn');
  assert.match(mis.text, /Dev Team gehört laut Kapazitätsplanung zum Team Data, nicht zu Integration/);
  assert.ok(r.team.notes.some((n) => /Lösung: Team auf Data ändern, jemanden aus Integration zuweisen \(Anna\)/.test(n.text)));
  const ok = storyCheck(fixture({ capTeam: 'tInt' }), '45', { lang: 'en' });
  assert.ok(!ok.team.notes.some((n) => n.key === 'teamMismatch'));
  assert.ok(ok.team.notes.some((n) => n.tone === 'ok' && /Dev Team belongs to team Integration/.test(n.text)));
});

test('time allocation: no start date → from today, hours per week and per quarter add up to the remaining estimate', () => {
  const r = storyCheck(fixture(), '45', { lang: 'de' });
  assert.ok(r.time.notes.some((n) => /Kein Start Date – geplant wird ab heute \(10\.11\.2026\)/.test(n.text)));
  const sum = r.time.quarters.reduce((t, x) => t + x.h, 0);
  assert.ok(Math.abs(sum - 23) < 0.01, `quarters add up to 23 h (got ${sum})`);
  assert.deepEqual(r.time.quarters.map((x) => x.label), ['Q4 2026', 'Q1 2027']);
  assert.ok(r.time.rows.some(([k, v]) => k === 'Das sind je Woche' && /≈ \d/.test(v)));
});

test('dependency due after this story\'s due date is a conflict; done or early prerequisites are fine', () => {
  const r = storyCheck(fixture(), '45', { lang: 'de' });
  const c = r.conflicts.find((x) => x.key === 'PCX-49');
  assert.equal(c.tone, 'bad');
  assert.match(c.text, /erst am 20\.02\.2027 fertig sein soll – nach dem Due Date dieser Story \(06\.02\.2027\)/);
  const early = storyCheck(fixture({ preDue: '2026-12-01' }), '45', { lang: 'de' }).conflicts.find((x) => x.key === 'PCX-49');
  assert.equal(early.tone, 'warn', 'no start date: "do not start before" – a hint, not a conflict');
  assert.match(early.text, /nicht vor dem 01\.12\.2026 starten/);
  // live finding 2026-11-10: a prerequisite still open after its due date is a conflict, not "do not start before <past date>"
  const late = storyCheck(fixture({ preDue: '2026-10-16' }), '45', { lang: 'de' }).conflicts.find((x) => x.key === 'PCX-49');
  assert.equal(late.tone, 'bad');
  assert.ok(late.text.includes('noch offen, obwohl es seit 25 Tagen fällig ist (Due Date 16.10.2026)'));
  assert.ok(!late.text.includes('nicht vor dem 16.10.2026'));
  // the other side: PCX-49 sees that PCX-45 waits for it
  const other = storyCheck(fixture(), '49', { lang: 'en' });
  assert.ok(other.conflicts.some((x) => x.key === 'PCX-45'));
});

test('assignee load: overbooked weeks named with numbers; absences inside the window; same numbers as personWeek', () => {
  const r = storyCheck(fixture({ absence: { accountId: 'uDev', from: '2026-12-21', to: '2027-01-01' } }), '45', { lang: 'de' });
  assert.ok(r.load, 'load section');
  assert.ok(r.load.weeks.length >= 2 && r.load.weeks.length <= 8);
  const over = r.load.notes.find((n) => n.tone === 'bad');
  assert.match(over.text, /Dev Team ist in \d von \d Wochen überbucht – am stärksten in KW \d+ mit \d+ %/);
  for (const w of r.load.weeks) if (w.cap > 0) assert.ok(Math.abs(w.util - w.plan / w.cap) < 1e-9);
  assert.ok(r.load.notes.some((n) => /abwesend – mitten im Zeitraum/.test(n.text)));
  assert.ok(r.counts.bad >= 2 && r.headline.includes('Konflikt'));
});

test('person-level values off: no names, no load, no team-fit judgement about a person', () => {
  const r = storyCheck(fixture({ personLevel: false }), '45', { lang: 'de' });
  assert.equal(r.load, null);
  assert.ok(!r.team.notes.some((n) => n.key === 'teamMismatch'));
  assert.ok(!JSON.stringify(r).includes('Dev Team'));
  assert.ok(!JSON.stringify(r).includes('Anna'));
});

test('sub-task → its story; epic/project → summary; unknown → plain note', () => {
  const c = fixture();
  c.model.ds.issues.push({ id: '451', key: 'PCX-451', summary: 'Teilaufgabe', role: 'tiny', parentId: '45', rootRef: c.model.ds.issues.find((i) => i.id === '45').rootRef, status: st('new') });
  c.model.byId.set('451', c.model.ds.issues.at(-1));
  const sub = storyCheck(c, '451', { lang: 'de' });
  assert.equal(sub.key, 'PCX-45'); assert.equal(sub.viaParent.key, 'PCX-451');
  const proj = storyCheck(c, golden.portfolio[0].ref.split(':')[1], { lang: 'de' });
  assert.equal(proj.kind, 'project');
  assert.ok(proj.groups.some((g) => /gehört nicht zum Team/.test(g.text) && g.items.some((x) => x.key === 'PCX-45')));
  assert.equal(storyCheck(c, '424242', { lang: 'en' }).known, false);
});

test('ISO week numbers', () => {
  assert.equal(isoWeek(dayIdx('2026-11-09')), 46);
  assert.equal(isoWeek(dayIdx('2027-01-01')), 53);
  assert.equal(isoWeek(dayIdx('2027-01-04')), 1);
});
