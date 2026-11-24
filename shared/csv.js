// CSV for spreadsheets. Cells that a spreadsheet would run as a formula (=, +, -, @, tab, CR) are
// prefixed with an apostrophe, so a work-item title can never execute in Excel (CSV injection).
// Plain numbers stay numbers. German Excel expects ';', English ','.

const FORMULA = /^[=+\-@\t\r]/;
const NUMBER = /^-?\d+(?:[.,]\d+)?$/;

export function csvCell(v, sep = ',') {
  if (v == null) return '';
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  if (typeof v !== 'number' && FORMULA.test(s) && !NUMBER.test(s)) s = `'${s}`;
  if (s.includes('"') || s.includes(sep) || /[\r\n]/.test(s) || s.startsWith("'")) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

// German locale writes decimal commas, so numbers are formatted to match the separator.
export function toCsv(header, rows, { sep = ',', decimalComma = false } = {}) {
  const cell = (v) => (typeof v === 'number' && decimalComma ? csvCell(String(Math.round(v * 100) / 100).replace('.', ','), sep) : csvCell(typeof v === 'number' ? Math.round(v * 100) / 100 : v, sep));
  return [header, ...rows].map((r) => r.map(cell).join(sep)).join('\r\n');
}
