// Smart actions: one sentence → a precise, previewed action (never executed by the parser itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeAll } from '../shared/engine.js';
import { parseAction } from '../shared/smartActions.js';

const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url)));
const c = computeAll(structuredClone(golden));
const sizes = [{ key: 'S', hours: 120 }, { key: 'M', hours: 320 }];
const P = (t, lang = 'en') => parseAction(t, { model: c.model, sizes, lang });

test('health with comment, German and English; the comment is kept as typed', () => {
  const a = P('Set Billing to at risk: Vendor delays the model by 3 weeks');
  assert.equal(a.kind, 'health'); assert.equal(a.status, 'atRisk'); assert.equal(a.comment, 'Vendor delays the model by 3 weeks'); assert.equal(a.ok, true);
  const b = P('Setze CRM auf kritisch – Schnittstelle fehlt', 'de');
  assert.equal(b.status, 'critical'); assert.equal(b.ref, 'issue:p2'); assert.equal(b.comment, 'Schnittstelle fehlt');
  assert.equal(P('Set Billing to green').ok, false, 'a health update needs a comment');
});

test('rank: a number or "to the top", never outside the ranking', () => {
  const a = P('Move CRM to rank 1');
  assert.equal(a.kind, 'rank'); assert.equal(a.to, 1); assert.equal(a.ok, true);
  assert.equal(P('CRM nach ganz oben', 'de').to, 1);
  assert.equal(P('move Billing to rank 99').to, c.model.items.length);
  assert.equal(P('Move Billing to rank 1').ok, false, 'already there');
});

test('team for every open story without a team, optionally in one project', () => {
  const a = P('Team Web for all stories without team in Billing');
  assert.equal(a.kind, 'teamFill'); assert.equal(a.teamId, 'web'); assert.equal(a.ref, 'issue:p1');
  const open = golden.issues.filter((i) => i.role === 'estimate' && !i.team && i.status.cat !== 'done' && i.rootRef === 'issue:p1').map((i) => i.id);
  assert.deepEqual(a.issueIds, open);
});

test('T-shirt size only where the project carries the rough estimate itself', () => {
  const a = P('T-shirt M for Billing');
  assert.equal(a.kind, 'tshirt'); assert.equal(a.ok, false, 'Billing has workstreams with sizes below');
  const ds = structuredClone(golden);
  ds.config.levels = ds.config.levels.filter((l) => l.role !== 'rough');
  const c2 = computeAll(ds);
  const b = parseAction('size S for CRM', { model: c2.model, sizes, lang: 'en' });
  assert.equal(b.ok, true); assert.equal(b.size, 'S');
});

test('anything else is not an action (the palette searches instead)', () => {
  for (const t of ['Billing', 'what is overdue', 'set the table', 'move fast']) assert.equal(P(t), null, t);
});

test('a named scope that is not a project is refused – an action never widens to every project', () => {
  const a = P('Team Web for all stories without team in Atlantis');
  assert.equal(a.kind, 'teamFill'); assert.equal(a.ok, false); assert.deepEqual(a.issueIds, []);
  assert.match(a.detail, /Atlantis/);
});

test('a project by its short name (first part or space key) when only one fits', () => {
  const ds = structuredClone(golden);
  ds.portfolio[1].name = 'CRM-Konsolidierung';
  const c3 = computeAll(ds);
  const a = parseAction('Team Data for all stories without team in CRM', { model: c3.model, sizes, lang: 'en' });
  assert.equal(a.ref, 'issue:p2');
});

// ---------- due dates and dependency links (named by key) ----------
import { parseDay, fmtDay } from '../shared/smartActions.js';
import { ymdIdx, isoOf } from '../shared/dates.js';
const MON = ymdIdx(2026, 11, 9); // a Monday
const PD = (t, lang = 'de', model = c.model) => parseAction(t, { model, sizes, lang, today: MON });

test('dates in plain words: weekday = the next one, dd.mm. = this year or next, invalid dates refused', () => {
  const d = (q) => { const x = parseDay(q, MON); return x == null ? null : isoOf(x); };
  assert.equal(d('auf freitag'), '2026-11-13');
  assert.equal(d('montag'), '2026-11-16', 'never today');
  assert.equal(d('15.12.'), '2026-12-15');
  assert.equal(d('1.1.'), '2027-01-01', 'past this year → next year');
  assert.equal(d('15.12.26'), '2026-12-15');
  assert.equal(d('2026-12-01'), '2026-12-01');
  assert.equal(d('in 2 wochen'), '2026-11-23');
  assert.equal(d('in 3 days'), '2026-11-12');
  assert.equal(d('morgen'), '2026-11-10');
  assert.equal(d('monatsende'), '2026-11-30');
  assert.equal(d('end of quarter'), '2026-12-31');
  assert.equal(d('15. dezember'), '2026-12-15');
  assert.equal(d('december 15th 2027'), '2027-12-15');
  assert.equal(d('31.02.'), null);
  assert.equal(d('2026-02-30'), null);
  assert.equal(d('version 1.2.3'), null);
  assert.equal(fmtDay(ymdIdx(2026, 11, 13), 'de'), 'Fr., 13.11.2026');
});

test('due date by key: a preview with the old date, refused in the past, outside the scope or unchanged', () => {
  const a = PD('Due TEL-12 auf Freitag');
  assert.equal(a.kind, 'due'); assert.equal(a.ok, true); assert.equal(a.issueId, 's1'); assert.equal(a.value, '2026-11-13');
  assert.match(a.detail, /Bisher: Fr\., 27\.11\.2026/);
  const b = PD('Fälligkeit TEL-13 auf 2027-05-03', 'de');
  assert.equal(b.value, '2027-05-03'); assert.match(b.detail, /kein Fälligkeitsdatum/); assert.match(b.detail, /nach dem Projekttermin/);
  assert.equal(PD('Due TEL-12 auf 2026-11-02').ok, false, 'past');
  assert.equal(PD('Due TEL-12 auf 27.11.').ok, false, 'unchanged');
  const out = PD('Due XYZ-9 tomorrow', 'en');
  assert.equal(out.ok, false); assert.match(out.detail, /not in the cockpit/);
  assert.equal(PD('Due TEL-12 sometime').ok, false, 'no date → asks which date');
  assert.match(PD('Due TEL-12 auf 15.11.').detail, /Wochenende/);
  const p = PD('Billing fällig am 30.06.2027');
  assert.equal(p.kind, 'due'); assert.equal(p.issueId, c.model.itemByRef.get('issue:p1').id); assert.equal(p.value, '2027-06-30');
  assert.equal(PD('Was ist bei Billing fällig?'), null, 'a question stays a question');
  assert.equal(PD('Welche Termine hat Billing'), null, 'no key, no date → not an action');
});

test('dependency link: both directions in DE/EN, refuses duplicates, cycles, unknown keys and missing configuration', () => {
  const a = PD('TEL-12 blockiert TEL-22');
  assert.equal(a.kind, 'link'); assert.equal(a.ok, true); assert.equal(a.preId, 's1'); assert.equal(a.depId, 's3'); assert.equal(a.typeId, '10000');
  assert.match(a.detail, /Konflikt: TEL-12 endet Fr\., 27\.11\.2026, TEL-22 startet Mo\., 16\.11\.2026/);
  for (const t of ['TEL-22 hängt ab von TEL-12', 'TEL-22 depends on TEL-12', 'TEL-22 is blocked by TEL-12', 'TEL-22 wartet auf TEL-12']) {
    const x = PD(t); assert.equal(x.preKey, 'TEL-12', t); assert.equal(x.depKey, 'TEL-22', t);
  }
  assert.equal(PD('TEL-12 blocks TEL-99').ok, false);
  assert.equal(PD('TEL-1 blocks TEL-22').ok, false, 'a portfolio item is not a story dependency');
  const ds = structuredClone(golden);
  ds.issues.find((i) => i.id === 's1').links = [{ id: 'L1', typeId: '10000', outward: true, otherId: 's3' }];
  const m = computeAll(ds).model;
  assert.match(PD('TEL-12 blocks TEL-22', 'en', m).detail, /already exists/);
  assert.match(PD('TEL-22 blocks TEL-12', 'en', m).detail, /cycle/);
  const none = structuredClone(golden); none.config.dependencies = { linkTypeIds: [] };
  assert.match(PD('TEL-12 blocks TEL-22', 'en', computeAll(none).model).detail, /No link type configured/);
  assert.equal(PD('TEL-12 und TEL-22 anschauen'), null, 'two keys without a dependency verb are no action');
});
