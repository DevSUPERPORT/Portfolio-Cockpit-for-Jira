// Excel exports: built from the golden portfolio, re-opened with ExcelJS and checked cell by cell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { computeAll } from '../shared/engine.js';
import { sink } from '../static/cockpit/src/lib/xlsx.js';
import { exportPortfolio, exportDependencies, exportQuality, exportEverything } from '../static/cockpit/src/lib/books.js';

const require = createRequire(new URL('../static/cockpit/package.json', import.meta.url));
const ExcelJS = require('exceljs');
const golden = JSON.parse(readFileSync(new URL('./golden/golden.json', import.meta.url)));

function app() {
  const ds = structuredClone(golden);
  ds.portfolio[0].name = '=HYPERLINK("http://evil","click")'; // must never become a formula
  ds.portfolio[0].health = { status: 'critical', comment: 'Lieferant verspätet', at: '2026-10-30T10:00:00Z', byName: 'Anna' };
  return { ds, computed: computeAll(ds), toast: () => {} };
}
async function capture(run) {
  let out;
  sink.save = (buf, name) => { out = { buf, name }; };
  await run();
  sink.save = null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out.buf);
  return { wb, name: out.name };
}

test('portfolio workbook: cover, sheets, formats, links, totals, colours', async () => {
  const { wb, name } = await capture(() => exportPortfolio(app()));
  assert.match(name, /\.xlsx$/);
  const names = wb.worksheets.map((w) => w.name);
  assert.equal(names[0], 'Übersicht');
  for (const n of ['Projekte', 'Wasserlinie', 'Kapazität Quartale', 'Health']) assert.ok(names.includes(n), `${n} in ${names}`);
  const cover = wb.getWorksheet('Übersicht');
  assert.equal(cover.getCell('B3').value, 'Portfolio-Übersicht');
  assert.equal(cover.getImages().length, 1, 'brand logo on the cover');
  assert.equal(wb.model.media[0]?.extension, 'png');
  const toc = [];
  cover.eachRow((r) => { const v = r.getCell(2).value; if (v && typeof v === 'object' && v.hyperlink) toc.push(v.hyperlink); });
  assert.ok(toc.some((h) => h.includes("'Projekte'")), 'table of contents links to sheets');

  const ws = wb.getWorksheet('Projekte');
  const header = ws.getRow(1);
  assert.equal(header.getCell(1).value, 'Rang');
  assert.equal(header.getCell(1).fill.fgColor.argb, 'FF262729');
  assert.equal(ws.views[0].state, 'frozen');
  assert.ok(ws.autoFilter, 'filter on header');
  const col = (h) => { let i = 0; header.eachCell((c, n) => { if (c.value === h) i = n; }); return i; };
  const first = ws.getRow(2);
  assert.equal(typeof first.getCell(col('Fortschritt')).value, 'number');
  assert.equal(first.getCell(col('Fortschritt')).numFmt, '0%');
  assert.equal(first.getCell(col('Original Estimate')).numFmt, '#,##0.0" h"');
  assert.ok(String(first.getCell(col('Projekt')).value).startsWith("'="), 'formula-looking text is neutralised');
  assert.equal(first.getCell(col('Health')).fill.fgColor.argb, 'FFF9E0DA', 'critical health is red');
  const due = ws.getRow(2).getCell(col('Fällig')).value;
  assert.ok(due === null || due instanceof Date, 'dates are real dates');
  const totals = [];
  ws.eachRow((r) => r.eachCell((c) => { if (c.value?.formula) totals.push(c.value.formula); }));
  assert.ok(totals.some((f) => f.startsWith('SUBTOTAL(9,')), 'totals use live formulas');
  assert.ok(ws.conditionalFormattings?.length || ws.model.conditionalFormattings?.length, 'progress bars');
});

test('dependency, data-quality and full workbooks build with content', async () => {
  const a = app();
  const deps = await capture(() => exportDependencies(a, a.computed.deps.list));
  assert.equal(deps.wb.getWorksheet('Abhängigkeiten').rowCount, a.computed.deps.list.length + 1);
  const dq = await capture(() => exportQuality(a, a.computed.dq.gaps, (k) => k));
  for (const n of ['Lücken', 'Regeln', 'Vollständigkeit']) assert.ok(dq.wb.getWorksheet(n), n);
  const all = await capture(() => exportEverything(a, (k) => k));
  assert.ok(all.wb.worksheets.length >= 9, `${all.wb.worksheets.length} sheets`);
  assert.ok(all.wb.worksheets.every((w) => w.name.length <= 31), 'Excel sheet names ≤ 31 characters');
});

test('PDF report: typeset pages, footer, fact summary', async () => {
  const { cLevelReport } = await import('../shared/engine.js');
  const { downloadReportPdf, pdfSink, factSummary } = await import('../static/cockpit/src/lib/pdf.js');
  const r = cLevelReport(structuredClone(golden));
  const bullets = factSummary(r);
  assert.ok(bullets.length >= 5 && bullets[0].includes('aktive Projekte'), bullets.join(' | '));
  let out;
  pdfSink.save = (blob, name, doc) => { out = { blob, name, doc }; };
  await downloadReportPdf(r, { summary: '- **Risiko:** Team Web über 100 % → Q1\n- Zweiter Punkt' });
  pdfSink.save = null;
  assert.match(out.name, /^portfolio-report-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.ok(out.doc.getNumberOfPages() >= 4, `${out.doc.getNumberOfPages()} pages`);
  const bytes = Buffer.from(await out.blob.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 8000, `${bytes.length} bytes`);
});
