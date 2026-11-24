// Excel workbooks with a consistent, professional layout. ExcelJS is loaded only when exporting.
//  - Cover sheet: title, as-of, key figures, linked table of contents, colour legend.
//  - Data sheets: dark header row, frozen panes, filters, real number/date formats, status colours,
//    in-cell progress bars, colour scales, total rows with live formulas, links to Jira.
import { LOGO_PNG } from './logoPng.js';
import { tr, getLang } from './i18n.js';

const INK = 'FF262729', ACCENT = 'FFE34B04', PAPER = 'FFF5F4F1', BAND = 'FFFBFAF8', LINE = 'FFE0DDD6', GREY = 'FF6E6A63';
export const TONE = {
  ok: { fill: 'FFE2F0E7', font: 'FF2F7D57' }, warn: { fill: 'FFFBEFD2', font: 'FF7A5200' },
  bad: { fill: 'FFF9E0DA', font: 'FFC2321F' }, info: { fill: 'FFE6ECF7', font: 'FF3D5BA6' }, muted: { fill: 'FFF2EFE9', font: GREY },
};
const FMT = {
  int: '#,##0', num1: '#,##0.0', hours: '#,##0.0" h"', pct: '0%', pct1: '0.0%',
  date: () => (getLang() === 'de' ? 'dd.mm.yyyy' : 'yyyy-mm-dd'),
};
const toDate = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`) : null);
const colLetter = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
// Neutralise text a spreadsheet would treat as a formula (CSV/XLSX injection).
const safeText = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v) ? `'${v}` : v);

// Tests set sink.save to receive the file instead of a browser download.
export const sink = { save: null };

export async function downloadWorkbook(fileBase, spec) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SUPERPORT Portfolio Cockpit';
  wb.created = new Date();
  wb.title = spec.title;
  cover(wb, spec);
  for (const sh of spec.sheets) dataSheet(wb, sh);
  const buf = await wb.xlsx.writeBuffer();
  const fileName = `${fileBase}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  if (sink.save) return sink.save(buf, fileName);
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

function cover(wb, spec) {
  const ws = wb.addWorksheet(tr('Übersicht', 'Overview'), { properties: { tabColor: { argb: ACCENT } }, views: [{ showGridLines: false }] });
  ws.columns = [{ width: 3 }, { width: 38 }, { width: 22 }, { width: 70 }];
  // brand tile, as in the app header
  ws.getRow(1).height = 36;
  ws.addImage(wb.addImage({ base64: LOGO_PNG, extension: 'png' }), { tl: { col: 1, row: 0.15 }, ext: { width: 40, height: 40 } });
  ws.getCell('B2').value = 'SUPERPORT';
  ws.getCell('B2').font = { name: 'Arial', size: 9, bold: true, color: { argb: ACCENT } };
  ws.getCell('B3').value = spec.title;
  ws.getCell('B3').font = { name: 'Arial', size: 20, bold: true, color: { argb: INK } };
  ws.getRow(3).height = 30;
  ws.getCell('B4').value = spec.subtitle || '';
  ws.getCell('B4').font = { name: 'Arial', size: 10, color: { argb: GREY } };
  let r = 6;
  if (spec.kpis?.length) {
    head(ws, r, [tr('Kennzahl', 'Key figure'), tr('Wert', 'Value'), tr('Erläuterung', 'Explanation')], 2);
    r++;
    for (const k of spec.kpis) {
      const row = ws.getRow(r);
      row.getCell(2).value = k.label;
      const v = row.getCell(3);
      v.value = k.value;
      if (k.type) v.numFmt = typeof FMT[k.type] === 'function' ? FMT[k.type]() : FMT[k.type];
      v.font = { name: 'Arial', size: 11, bold: true, color: { argb: k.tone ? TONE[k.tone].font : INK } };
      v.alignment = { horizontal: 'right' };
      row.getCell(4).value = k.note || '';
      row.getCell(4).font = { name: 'Arial', size: 9, color: { argb: GREY } };
      row.getCell(2).font = { name: 'Arial', size: 10 };
      [2, 3, 4].forEach((c) => { row.getCell(c).border = { bottom: { style: 'thin', color: { argb: LINE } } }; });
      r++;
    }
    r++;
  }
  head(ws, r, [tr('Blatt', 'Sheet'), tr('Zeilen', 'Rows'), tr('Inhalt', 'Contents')], 2);
  r++;
  for (const sh of spec.sheets) {
    const row = ws.getRow(r);
    row.getCell(2).value = { text: sh.name, hyperlink: `#'${sh.name}'!A1` };
    row.getCell(2).font = { name: 'Arial', size: 10, color: { argb: 'FF3D5BA6' }, underline: true };
    row.getCell(3).value = sh.rows.length;
    row.getCell(3).numFmt = FMT.int;
    row.getCell(4).value = sh.description || '';
    row.getCell(4).font = { name: 'Arial', size: 9, color: { argb: GREY } };
    r++;
  }
  r++;
  ws.getCell(`B${r}`).value = tr('Farben', 'Colours');
  ws.getCell(`B${r}`).font = { name: 'Arial', size: 9, bold: true, color: { argb: GREY } };
  r++;
  for (const [tone, de, en] of [['ok', 'im Plan / besetzbar / erledigt', 'on track / staffable / done'], ['warn', 'gefährdet / teilweise / dringend', 'at risk / partly / urgent'], ['bad', 'kritisch / nicht besetzbar / Konflikt', 'critical / not staffable / conflict']]) {
    const c = ws.getCell(`B${r}`);
    c.value = tr(de, en);
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TONE[tone].fill } };
    c.font = { name: 'Arial', size: 9, color: { argb: TONE[tone].font } };
    r++;
  }
  r++;
  ws.getCell(`B${r}`).value = tr('Werte aus Jira, berechnet von SUPERPORT Portfolio Cockpit. Nur Daten, die du sehen darfst. Vertraulich.', 'Values from Jira, calculated by SUPERPORT Portfolio Cockpit. Only data you are allowed to see. Confidential.');
  ws.getCell(`B${r}`).font = { name: 'Arial', size: 8, italic: true, color: { argb: GREY } };
}

function head(ws, r, labels, startCol = 1) {
  const row = ws.getRow(r);
  labels.forEach((l, i) => {
    const c = row.getCell(startCol + i);
    c.value = l;
    c.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  row.height = 22;
}

function dataSheet(wb, sh) {
  const ws = wb.addWorksheet(sh.name, { views: [{ state: 'frozen', xSplit: sh.freezeCols ?? 0, ySplit: 1, showGridLines: false }] });
  ws.columns = sh.columns.map((c) => ({ key: c.key, width: c.width || Math.min(48, Math.max(10, c.header.length + 4)) }));
  head(ws, 1, sh.columns.map((c) => c.header));
  ws.getRow(1).height = 30;
  sh.rows.forEach((row, i) => {
    const r = ws.getRow(i + 2);
    sh.columns.forEach((c, j) => {
      const cell = r.getCell(j + 1);
      let v = typeof c.value === 'function' ? c.value(row) : row[c.key];
      if (v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))) v = null;
      if (c.type === 'date') v = toDate(v);
      if (c.type === 'link' && v) v = v.url ? { text: v.text, hyperlink: v.url } : v.text;
      cell.value = c.type === 'link' || c.type === 'date' ? v : safeText(v);
      const fmt = FMT[c.type];
      if (fmt && v != null) cell.numFmt = typeof fmt === 'function' ? fmt() : fmt;
      cell.font = { name: 'Arial', size: 10, ...(c.type === 'link' && v?.hyperlink ? { color: { argb: 'FF3D5BA6' }, underline: true } : {}), ...(c.bold ? { bold: true } : {}) };
      cell.alignment = { vertical: 'top', wrapText: !!c.wrap, ...(['int', 'num1', 'hours', 'pct', 'pct1'].includes(c.type) ? { horizontal: 'right' } : {}) };
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      const tone = c.tone?.(row);
      if (tone && TONE[tone]) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TONE[tone].fill } }; cell.font = { ...cell.font, color: { argb: TONE[tone].font }, bold: true }; }
      else if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    });
  });
  const last = sh.rows.length + 1;
  const lastCol = colLetter(sh.columns.length);
  if (sh.rows.length) ws.autoFilter = { from: 'A1', to: `${lastCol}1` };
  sh.columns.forEach((c, j) => {
    const L = colLetter(j + 1);
    if (!sh.rows.length) return;
    if (c.bar) ws.addConditionalFormatting({ ref: `${L}2:${L}${last}`, rules: [{ type: 'dataBar', minLength: 0, maxLength: 100, cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: c.bar === true ? 1 : c.bar }], color: { argb: 'FFE34B04' } }] });
    if (c.scale) ws.addConditionalFormatting({ ref: `${L}2:${L}${last}`, rules: [{ type: 'colorScale', cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 0.85 }, { type: 'num', value: 1.0 }], color: [{ argb: 'FFE2F0E7' }, { argb: 'FFFBEFD2' }, { argb: 'FFF9E0DA' }] }] });
  });
  // Totals with live formulas.
  if (sh.totals?.length && sh.rows.length) {
    const tr2 = ws.getRow(last + 1);
    tr2.getCell(1).value = tr('Summe', 'Total');
    sh.columns.forEach((c, j) => {
      const cell = tr2.getCell(j + 1);
      if (sh.totals.includes(c.key)) {
        const L = colLetter(j + 1);
        cell.value = { formula: `SUBTOTAL(9,${L}2:${L}${last})` };
        const fmt = FMT[c.type];
        if (fmt) cell.numFmt = typeof fmt === 'function' ? fmt() : fmt;
      }
      cell.font = { name: 'Arial', size: 10, bold: true };
      cell.border = { top: { style: 'thin', color: { argb: INK } } };
      cell.alignment = { horizontal: j === 0 ? 'left' : 'right' };
    });
  }
  if (sh.note) {
    const nr = ws.getRow(last + (sh.totals?.length ? 3 : 2));
    nr.getCell(1).value = sh.note;
    nr.getCell(1).font = { name: 'Arial', size: 8, italic: true, color: { argb: GREY } };
  }
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, printTitlesRow: '1:1' };
  ws.headerFooter = { oddFooter: `&L&8SUPERPORT Portfolio Cockpit&C&8${sh.name}&R&8&P / &N` };
}
