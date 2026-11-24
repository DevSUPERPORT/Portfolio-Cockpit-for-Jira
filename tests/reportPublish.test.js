// The composed report leaves the browser (shared/lotse/report/publish.js + the resolvers report.publishComposed,
// report.unpublishComposed, report.draft, prefs.save { reportDraft }): validated and size-capped, every number re-checked
// against a FRESH computation, never a person's name, charts as tables in the report's language, an undo, an audit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lotseCtx, lotseDataset } from './lotseFixture.js';
import { draftReport, AUDIENCES, plainText } from '../shared/lotse/report/compose.js';
import { cleanComposed, verifyComposed, composedStorage, visualTable, cleanDraft, withdrawnStorage, namesIn, DRAFT_MAX_BYTES, PUBLISH_LIMITS } from '../shared/lotse/report/publish.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const people = Object.values(lotseDataset().people).map((p) => p.name);
// what the composer sends: only what the person shaped
const send = (doc) => ({ v: doc.v, audience: doc.audience, lang: doc.lang, period: doc.period, projectRef: doc.projectRef, teamId: doc.teamId, title: doc.title, subtitle: doc.subtitle, confidential: true,
  sections: doc.sections.map((s) => ({ id: s.id, kind: s.kind, title: s.title, on: s.on !== false, text: s.text, facts: s.facts })) });
const freshFor = (clean, lang) => draftReport({ ctx: lotseCtx(lang), audience: clean.audience, period: clean.quarter, teamId: clean.teamId, projectRef: clean.projectRef, lang, sections: clean.sections.map((s) => s.id) });

for (const lang of ['de', 'en']) {
  for (const audience of AUDIENCES) {
    test(`publish ${audience} (${lang}): an untouched draft passes the fresh re-check; storage format holds every section, no person`, () => {
      const doc = draftReport({ ctx: lotseCtx(lang), audience, lang });
      const clean = cleanComposed(send(doc));
      const v = verifyComposed(clean, freshFor(clean, lang), { people });
      assert.deepEqual(v.problems, [], JSON.stringify(v.problems));
      assert.equal(v.ok, true);
      const html = composedStorage(v, { lang, subtitle: doc.subtitle, asOf: doc.asOf, confidential: true, people });
      for (const s of doc.sections.filter((x) => x.on !== false)) assert.ok(html.includes(s.title.replace(/&/g, '&amp;')), `${s.id} title on the page`);
      for (const p of people) assert.ok(!html.includes(p), `names ${p}`);
      assert.doesNotMatch(html, /\{\{|\}\}|undefined|NaN|\[object/);
      assert.match(html, lang === 'en' ? /Confidential/ : /Vertraulich/);
      if (doc.sections.some((s) => s.data?.visual)) assert.match(html, lang === 'en' ? /Charts appear here as tables/ : /Diagramme stehen hier als Tabellen/);
    });
  }
}

test('re-check: a number typed by hand, a stale chip, a person – each is found; the data never comes from the browser', () => {
  const doc = draftReport({ ctx: lotseCtx('de'), audience: 'c-level', lang: 'de' });
  const base = send(doc);
  const fresh = freshFor(cleanComposed(base), 'de');
  // 1 · a number typed by hand
  const typed = structuredClone(base);
  typed.sections[0].text += ' Zusätzlich fehlen 4711 h.';
  const v1 = verifyComposed(cleanComposed(typed), fresh, { people });
  assert.ok(v1.problems.some((p) => p.kind === 'unsourced' && /4711/.test(p.text)), JSON.stringify(v1.problems));
  // 2 · a chip whose value changed since the draft (an old draft, new data)
  const stale = structuredClone(base);
  const sec = stale.sections.find((s) => s.facts.some((f) => typeof f.value === 'number' && s.text.includes(`{{${f.id}}}`)));
  const f = sec.facts.find((x) => typeof x.value === 'number' && sec.text.includes(`{{${x.id}}}`));
  f.value += 3; f.display = `${f.value}`;
  const v2 = verifyComposed(cleanComposed(stale), fresh, { people });
  assert.ok(v2.problems.some((p) => p.kind === 'stale' && p.section === sec.id), JSON.stringify(v2.problems));
  // 3 · a person's name in a text or a title
  const named = structuredClone(base);
  named.sections[1].text += ` ${people[2]} kümmert sich darum.`;
  named.title = `Bericht für ${people[0]}`;
  const v3 = verifyComposed(cleanComposed(named), fresh, { people });
  assert.ok(v3.problems.some((p) => p.kind === 'person' && p.text === people[2]));
  assert.ok(v3.problems.some((p) => p.kind === 'person' && p.text === people[0] && p.section === null));
  // 4 · the browser's data blocks are ignored: cleanComposed drops them, the fresh draft supplies them
  const forged = structuredClone(base);
  forged.sections.find((s) => s.id === 'kpis').data = { tiles: [{ label: 'Fortschritt', display: '99 %' }] };
  const c = cleanComposed(forged);
  assert.ok(c.sections.every((s) => !('data' in s)));
  const v4 = verifyComposed(c, fresh, { people });
  assert.deepEqual(v4.sections.find((s) => s.id === 'kpis').data, fresh.sections.find((s) => s.id === 'kpis').data);
  // 5 · hidden sections are not published (and not checked)
  const hidden = structuredClone(typed);
  hidden.sections[0].on = false;
  assert.ok(!verifyComposed(cleanComposed(hidden), fresh, { people }).problems.some((p) => /4711/.test(p.text)));
});

test('validation and size caps: unknown shapes, too much text, too large are refused', () => {
  const doc = send(draftReport({ ctx: lotseCtx('de'), audience: 'team', lang: 'de' }));
  assert.throws(() => cleanComposed(null), /document/);
  assert.throws(() => cleanComposed({ ...doc, audience: 'board' }), /audience/);
  assert.throws(() => cleanComposed({ ...doc, sections: [] }), /sections/);
  assert.throws(() => cleanComposed({ ...doc, sections: [{ ...doc.sections[0], id: '__proto__' }] }), /section id/);
  assert.throws(() => cleanComposed({ ...doc, sections: [doc.sections[0], doc.sections[0]] }), /twice/);
  assert.throws(() => cleanComposed({ ...doc, sections: [{ ...doc.sections[0], text: 'x'.repeat(PUBLISH_LIMITS.text + 1) }] }), /text/);
  assert.throws(() => cleanComposed({ ...doc, junk: 'x'.repeat(PUBLISH_LIMITS.bytes) }), /too large/);
  assert.throws(() => cleanComposed({ ...doc, sections: [{ ...doc.sections[0], facts: [{ id: 'a', value: 'drop table', unit: 'n' }] }] }), /fact value/);
  const own = cleanComposed({ ...doc, sections: [{ id: 'text-1', kind: 'text', title: 'Notiz', on: true, text: 'Nächste Runde im Dezember.', facts: [] }] });
  assert.equal(own.sections[0].id, 'text-1');
});

test('charts as tables in the REPORT language (not the app language)', () => {
  const v = { kind: 'columns', data: { unit: 'h', labels: ['KW 46', 'KW 47'], series: [{ name: 'Plan', values: [1234.5, 80] }] } };
  assert.deepEqual(visualTable(v, 'de').rows, [['KW 46', '1.235 h'], ['KW 47', '80 h']]);
  assert.deepEqual(visualTable(v, 'en').rows, [['KW 46', '1,235 h'], ['KW 47', '80 h']]);
  assert.deepEqual(visualTable({ kind: 'bars', data: { unit: '%', items: [{ label: 'Web', value: 112 }] } }, 'en').rows, [['Web', '112%']]);
  assert.deepEqual(visualTable({ kind: 'bars', data: { unit: '%', items: [{ label: 'Web', value: 112 }] } }, 'de').rows, [['Web', '112 %']]);
  assert.deepEqual(visualTable({ kind: 'gantt', data: { rows: [{ label: 'A', start: '2026-11-02', end: '2026-12-24' }] } }, 'de').rows, [['A', '02.11.2026', '24.12.2026']]);
  assert.deepEqual(visualTable({ kind: 'waterline', data: { items: [{ rank: 1, label: 'X', value: 10, cum: 10, status: 'no' }] } }, 'en').rows[0].at(-1), 'not staffed');
  for (const k of ['bars', 'columns', 'line', 'donut', 'heat', 'timeline', 'gantt', 'compare', 'waterline']) assert.ok(visualTable({ kind: k, data: {} }, 'de'), k);
  // a row naming a person never reaches the page
  const sec = { id: 'capacity', kind: 'story', title: 'Kapazität', text: 'x', tone: 'warn', facts: [], data: { visual: { kind: 'bars', data: { unit: 'h', items: [{ label: people[3], value: 12 }, { label: 'Team Web', value: 8 }] } } } };
  const html = composedStorage({ sections: [sec] }, { lang: 'de', people });
  assert.ok(!html.includes(people[3]));
  assert.match(html, /1 Zeile mit Personen ausgelassen/);
  assert.equal(namesIn('Frag anna becker!', ['Anna Becker']).length, 1);
  assert.equal(namesIn('Annabelle', ['Anna']).length, 0);
  assert.match(withdrawnStorage('en'), /withdrawn/);
});

test('the draft on the server: slim, validated, capped; unknown keys never get in; null deletes', () => {
  const doc = draftReport({ ctx: lotseCtx('de'), audience: 'c-level', lang: 'de' });
  const d = cleanDraft({ v: 1, doc, settings: { audience: 'c-level', period: 'current', lang: 'de', logo: true, confidential: false, evil: 1 }, at: 1700000000000 });
  assert.ok(d && d.doc.sections.length === doc.sections.length);
  assert.ok(JSON.stringify(d).length <= DRAFT_MAX_BYTES);
  assert.ok(d.doc.sections.every((s) => !('story' in s) && !('entities' in s)), 'stories and name lists are recomputed in the browser');
  assert.equal(d.settings.confidential, false);
  assert.ok(!('evil' in d.settings));
  assert.equal(plainText(d.doc.sections[0]), plainText(doc.sections[0]), 'the text with its chips survives');
  assert.equal(cleanDraft(null), null);
  assert.equal(cleanDraft({ doc: { sections: [{ id: 'x y', kind: 'text' }] } }), undefined);
  assert.equal(cleanDraft('nope'), undefined);
  const huge = { doc: { ...doc, sections: doc.sections.map((s) => ({ ...s, data: { blob: 'x'.repeat(30000) } })) } };
  assert.equal(cleanDraft(huge), undefined, 'too large: refused (the browser keeps its copy)');
});

test('server: resolvers wired – report right, approved space, fresh re-check before writing, undo, audit, draft per person', () => {
  const src = read('src/index.js');
  const pub = src.slice(src.indexOf("def('report.publishComposed'"), src.indexOf("def('report.unpublishComposed'"));
  assert.match(pub, /requireRole\(roles, 'viewReport'\)/);
  assert.match(pub, /NO_ACCESS:publishSpace/);
  assert.match(pub, /const v = verifyComposed\(doc, fresh, \{ people \}\);[\s\S]*if \(!v\.ok \|\| dryRun\) return/, 'nothing is written unless every number passed');
  assert.ok(pub.indexOf('verifyComposed') < pub.indexOf("confluence('/wiki/api/v2/pages'"), 'checked before the page is created');
  assert.match(pub, /audit\(me, 'report\.publishComposed'/);
  const fresh = src.slice(src.indexOf('async function freshComposed'), src.indexOf('const cleanDoc'));
  assert.match(fresh, /loadDataset\(ctx, cfg, roles\)/, 'the caller\'s own dataset, read now');
  assert.match(fresh, /draftReport\(/);
  const undo = src.slice(src.indexOf("def('report.unpublishComposed'"), src.indexOf("def('notices.remind'"));
  assert.match(undo, /rec\.by !== ctx\.accountId && !roles\.admin/);
  assert.match(undo, /withdrawnStorage/);
  assert.match(undo, /audit\(await withName\(ctx\), 'report\.publishComposed\.undo'/);
  // the draft per person – minus sections that name a project the caller may not browse (tests/reportVisibility.test.js)
  assert.match(src, /def\('report\.draft', async \(\{ ctx \}\) => draftForCaller\(\(await get\(K\.reportDraft\(ctx\.accountId\)\)\) \|\| null, ctx\)\);/);
  assert.match(src, /const d = cleanDraft\(payload\.reportDraft\);/);
  // no new Confluence permission: tables instead of attachments, withdraw instead of delete
  const scopes = read('manifest.yml');
  assert.doesNotMatch(scopes, /write:attachment|delete:page/);
  assert.doesNotMatch(pub + undo, /child\/attachment|method: 'DELETE'/);
  const m = read('src/lib/maintenance.js');
  assert.match(m, /'report\.draft'/);
  assert.doesNotMatch(m, /'report\.publishComposed'|'report\.unpublishComposed'/);
});
