// Report composer (shared/lotse/report/compose.js + components/report/pdfLayout.js): Lotse drafts a whole report from
// verified data. The rules the owner cares about are tied to the code here: every audience gives valid sections, every
// number in every phrasing is one of the section's facts (no number without a source), DE and EN, no filler, nobody
// named, deterministic – and the PDF builder lays the same document out on A4 pages with footer, logo and page numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotseCtx, lotseDataset } from './lotseFixture.js';
import {
  draftReport, draftSection, rephrase, checkSection, adoptText, plainText, tokensOf, docText, summaryText, sectionCatalog,
  AUDIENCES, PRESETS, SECTION_IDS, DOC_VERSION,
} from '../shared/lotse/report/compose.js';
import { openReportComposer, takeComposerRequest } from '../static/cockpit/src/components/report/open.js';

const KINDS = ['summary', 'kpis', 'story', 'chart', 'table', 'risks', 'text'];
const UNITS = ['h', '%', 'd', 'n', 'eur', 'rank', 'quarter', 'date'];
const FILLER = /undefined|NaN|\bnull\b|\[object|lorem|ipsum|n\/a|\{\{|\}\}|TODO/i;
const people = Object.values(lotseDataset().people).map((p) => p.name);
const ctxs = { de: lotseCtx('de'), en: lotseCtx('en') };

for (const lang of ['de', 'en']) {
  for (const audience of AUDIENCES) {
    test(`draftReport ${audience} (${lang}): valid sections, every number sourced, no filler, nobody named`, () => {
      const t0 = Date.now();
      const doc = draftReport({ ctx: ctxs[lang], audience, lang });
      const ms = Date.now() - t0;
      assert.ok(ms < 4000, `${ms} ms`);
      assert.equal(doc.v, DOC_VERSION);
      assert.equal(doc.lang, lang);
      assert.equal(doc.audience, audience);
      assert.ok(doc.title && !FILLER.test(doc.title) && doc.subtitle, doc.title);
      assert.match(doc.period.quarter, /^\d{4}-Q[1-4]$/);
      assert.match(doc.asOf, /^\d{4}-\d{2}-\d{2}T/);
      assert.deepEqual(doc.sections.map((s) => s.id), PRESETS[audience], 'the preset decides choice and order');
      for (const s of doc.sections) {
        assert.ok(KINDS.includes(s.kind), `${s.id}: kind ${s.kind}`);
        assert.ok(s.title && !FILLER.test(s.title), `${s.id}: title`);
        assert.ok(Array.isArray(s.variants) && s.variants.length >= 1, `${s.id}: variants`);
        assert.equal(s.text, s.variants[0], `${s.id}: the first variant is the default`);
        const ids = new Set(s.facts.map((f) => f.id));
        assert.equal(ids.size, s.facts.length, `${s.id}: fact ids unique`);
        for (const f of s.facts) {
          assert.ok(UNITS.includes(f.unit), `${s.id}/${f.id}: unit ${f.unit}`);
          assert.ok(typeof f.value === 'number' ? Number.isFinite(f.value) : /^\d{4}-(Q[1-4]|\d{2}-\d{2})$/.test(f.value), `${s.id}/${f.id}: value ${f.value}`);
          assert.ok(f.display && !FILLER.test(f.display), `${s.id}/${f.id}: display ${f.display}`);
        }
        for (const [k, v] of s.variants.entries()) {
          for (const id of tokensOf(v)) assert.ok(ids.has(id), `${s.id} v${k}: token {{${id}}} has a fact`);
          const plain = plainText({ ...s, text: v });
          if (s.kind !== 'text') assert.ok(plain.trim().length > 20, `${s.id} v${k}: text "${plain}"`);
          assert.doesNotMatch(plain, FILLER, `${s.id} v${k}: ${plain}`);
          for (const p of people) assert.ok(!plain.includes(p), `${s.id} v${k} names ${p}`);
          // the strict check: every number, percentage, rank, quarter, date, key and team stands in the section's facts
          const bad = checkSection({ ...s, text: v, lang });
          assert.deepEqual(bad, [], `${s.id} v${k}: unsourced ${JSON.stringify(bad)} in "${plain}"`);
          // no filler: a data section's text carries numbers (an honest 'no data' note has tone info)
          if (s.kind !== 'text' && s.tone !== 'info') assert.ok(tokensOf(v).length > 0, `${s.id} v${k}: no number at all in "${plain}"`);
        }
        if (s.kind === 'risks') for (const it of s.data.items) { for (const id of tokensOf(it.text)) assert.ok(ids.has(id), `risk item ${it.id}: {{${id}}}`); assert.deepEqual(checkSection({ ...s, text: it.text, lang }), [], `risk item ${it.id}`); }
        if (s.kind === 'kpis') assert.equal(s.data.tiles.length, 6, 'the six key figures');
        if ((s.kind === 'chart' || s.kind === 'story') && s.tone !== 'info') assert.ok(s.data.visual?.kind, `${s.id}: a visual`);
      }
      const all = docText(doc);
      assert.doesNotMatch(all, FILLER);
      if (lang === 'en') assert.doesNotMatch(all, /\b(und|nicht|fehlen|Projekte|Wochen|über dem Termin)\b/, 'English report without German sentences');
      else assert.doesNotMatch(all, /\b(the|missing|projects are|weeks)\b/, 'German report without English sentences');
    });
  }
}

test('C-level summary: 3–5 sentences with real numbers – progress, schedule, capacity and the most important decision', () => {
  const doc = draftReport({ ctx: ctxs.de, audience: 'c-level', lang: 'de' });
  const s = doc.sections.find((x) => x.id === 'summary');
  const plain = plainText(s);
  const sentences = plain.split(/(?<=[.?!])\s+(?=[A-ZÄÖÜ0-9„])/).filter(Boolean);
  assert.ok(sentences.length >= 3 && sentences.length <= 6, `${sentences.length}: ${plain}`);
  assert.match(plain, /aktive Projekte/);
  assert.match(plain, /Entscheidung/);
  assert.ok(s.facts.length >= 6, `${s.facts.length} facts`);
  const k = doc.sections.find((x) => x.id === 'kpis');
  const tile = k.data.tiles.find((t) => t.id === 'progress');
  assert.ok(plain.includes(tile.display.replace(/\s/g, ' ')) || plain.includes(tile.display), `summary progress = tile ${tile.display}`);
});

test('deterministic: the same data and clock give the same report', () => {
  const a = draftReport({ ctx: lotseCtx('de'), audience: 'steering', lang: 'de' });
  const b = draftReport({ ctx: lotseCtx('de'), audience: 'steering', lang: 'de' });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('sections, period, team and project parameters are honoured', () => {
  const ctx = ctxs.de;
  const q = ctx.computed.wl.quarters[1];
  const d = draftReport({ ctx, audience: 'c-level', lang: 'de', period: q, sections: ['risks', 'waterline', 'summary'] });
  assert.deepEqual(d.sections.map((s) => s.id), ['risks', 'waterline', 'summary']);
  assert.equal(d.period.quarter, q);
  assert.match(d.sections[1].title, new RegExp(`Q${q.slice(-1)} ${q.slice(0, 4)}`));
  const t = draftReport({ ctx, audience: 'team', teamId: 't-web', lang: 'de' });
  assert.equal(t.teamId, 't-web');
  assert.match(t.title, /Team Web/);
  const p = draftReport({ ctx, audience: 'project', projectRef: 'issue:9001', lang: 'en' });
  assert.equal(p.projectRef, 'issue:9001');
  assert.match(p.title, /ERP-Anbindung/);
  assert.equal(p.sections.find((s) => s.id === 'project').title, 'ERP-Anbindung');
  // a section on its own (the "add section" menu) and the free text section
  for (const id of [...SECTION_IDS, 'text']) {
    const s = draftSection(id, { ctx, audience: 'c-level', lang: 'de' });
    assert.ok(s && s.title, id);
    if (id !== 'text') assert.deepEqual(checkSection({ ...s, lang: 'de' }), [], id);
  }
  assert.equal(sectionCatalog('en').length, SECTION_IDS.length + 1);
});

test('rephrase cycles through the verified variants; adoptText chips verified numbers and flags the rest', () => {
  const doc = draftReport({ ctx: ctxs.de, audience: 'c-level', lang: 'de' });
  const s = doc.sections.find((x) => x.id === 'waterline');
  assert.ok(s.variants.length >= 2);
  const r1 = rephrase(s);
  assert.notEqual(r1.text, s.text);
  assert.equal(r1.variant, 1);
  let r = s;
  for (let k = 0; k < s.variants.length; k++) r = rephrase(r);
  assert.equal(r.text, s.text, 'back to the first after a full cycle');
  const sum = doc.sections.find((x) => x.id === 'summary');
  const n = sum.facts.find((f) => f.unit === '%');
  const a = adoptText(sum, `Fortschritt ${n.display}. Außerdem 437 % mehr Tickets.`, 'de');
  assert.ok(tokensOf(a.text).length >= 1, a.text);
  const bad = checkSection({ ...a, lang: 'de' });
  assert.equal(bad.length, 1);
  assert.equal(bad[0].found, 437);
  // a hand-typed number is caught too
  assert.equal(checkSection({ ...sum, text: `${sum.text} Dazu kommen 9.999 h.`, lang: 'de' }).length, 1);
});

test('summary text and the whole report as plain text (copy)', () => {
  const doc = draftReport({ ctx: ctxs.en, audience: 'c-level', lang: 'en' });
  const st = summaryText(doc);
  assert.ok(st.startsWith(doc.title));
  assert.doesNotMatch(st, /\{\{/);
  const off = { ...doc, sections: doc.sections.map((s) => (s.id === 'kpis' ? { ...s, on: false } : s)) };
  assert.ok(!docText(off).includes(doc.sections.find((s) => s.id === 'kpis').title));
});

test('openReportComposer: a request waits for the host and is taken once', () => {
  assert.equal(takeComposerRequest(), null);
  openReportComposer({ audience: 'steering', period: 'next' });
  const r = takeComposerRequest();
  assert.equal(r.audience, 'steering');
  assert.equal(r.period, 'next');
  assert.equal(takeComposerRequest(), null);
});

// ---------- PDF ----------
test('PDF layout (pure): A4 pages, every section placed, cover, footer with page numbers, logo and confidential switch', async () => {
  const { layoutReport, pageText, PAGE } = await import('../static/cockpit/src/components/report/pdfLayout.js');
  const doc = draftReport({ ctx: ctxs.de, audience: 'c-level', lang: 'de' });
  const L = layoutReport(doc, { branding: { logo: true, confidential: true } });
  assert.ok(L.pages.length >= 2 && L.pages.length <= 6, `${L.pages.length} pages`);
  for (const s of doc.sections) assert.ok(Number.isInteger(L.sectionPages[s.id]), `${s.id} placed`);
  const ordered = doc.sections.map((s) => L.sectionPages[s.id]);
  assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b), 'sections keep their order');
  const p1 = pageText(L.pages[0]);
  assert.match(p1, /Management-Report Portfolio/);
  assert.match(p1, /Stand 12\.11\.2026/);
  assert.match(p1, /Vertraulich/);
  L.pages.forEach((p, i) => {
    assert.match(pageText(p), new RegExp(`Seite ${i + 1} / ${L.pages.length}`));
    for (const o of p.ops) {
      if (o.op === 'text') { assert.ok(!/undefined|NaN/.test(o.text), o.text); assert.ok(o.y <= PAGE.H && o.y >= 0, `text inside the page: ${o.text}`); }
      if (o.op === 'rect') assert.ok([o.x, o.y, o.w, o.h].every(Number.isFinite), 'rect numbers');
    }
    // nothing written into the footer zone except the footer itself
    for (const o of p.ops.filter((x) => x.op === 'text' && x.size > 7)) assert.ok(o.y < PAGE.H - PAGE.FOOT + 1, `"${o.text}" runs into the footer (y=${o.y})`);
  });
  assert.ok(L.pages.some((p) => p.ops.some((o) => o.op === 'logo')));
  // charts are vectors: bars / columns / waterline rectangles, not images
  assert.ok(L.pages.flatMap((p) => p.ops).filter((o) => o.op === 'rect').length > 40);
  // text from the composed doc lands in the PDF, numbers included
  const all = L.pages.map(pageText).join(' ');
  assert.ok(all.includes(plainText(doc.sections[0]).slice(0, 40)), 'summary text in the PDF');
  const plain = layoutReport(doc, { branding: { logo: false, confidential: false } });
  assert.ok(!plain.pages.some((p) => p.ops.some((o) => o.op === 'logo')));
  assert.doesNotMatch(plain.pages.map(pageText).join(' '), /vertraulich/i);
  // hidden sections stay out
  const off = layoutReport({ ...doc, sections: doc.sections.map((s) => (s.id === 'portfolio' ? { ...s, on: false } : s)) });
  assert.equal(off.sectionPages.portfolio, undefined);
  // English
  const en = layoutReport(draftReport({ ctx: ctxs.en, audience: 'steering', lang: 'en' }));
  assert.match(pageText(en.pages[0]), /As of 12 Nov 2026/);
  assert.match(pageText(en.pages.at(-1)), /Page \d+ \/ \d+/);
});

test('PDF file: jsPDF paints the layout – a real PDF with the expected page count', async () => {
  const { downloadComposedPdf, pdfSink } = await import('../static/cockpit/src/lib/pdf.js');
  const doc = draftReport({ ctx: ctxs.de, audience: 'steering', lang: 'de' });
  let out;
  pdfSink.save = (blob, name, pdf, layout) => { out = { blob, name, pdf, layout }; };
  try { await downloadComposedPdf(doc, { branding: { logo: true, confidential: true } }); } finally { pdfSink.save = null; }
  assert.match(out.name, /^bericht-f(ü|u)r-den-lenkungskreis-2026-11-12\.pdf$/);
  assert.equal(out.pdf.getNumberOfPages(), out.layout.pages.length);
  const bytes = Buffer.from(await out.blob.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 8000, `${bytes.length} bytes`);
});
