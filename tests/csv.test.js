import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from '../shared/csv.js';

test('csv: formula-looking text is neutralised', () => {
  for (const evil of ['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd']) {
    const c = csvCell(evil);
    assert.ok(c.startsWith(`"'`) || c.startsWith("'"), c);
  }
});
test('csv: numbers, negatives and plain text are untouched', () => {
  assert.equal(csvCell(-12.5), '-12.5');
  assert.equal(csvCell('-12'), '-12');
  assert.equal(csvCell('ERP-Anbindung'), 'ERP-Anbindung');
  assert.equal(csvCell(null), '');
});
test('csv: separators, quotes and newlines are quoted', () => {
  assert.equal(csvCell('a;b', ';'), '"a;b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
});
test('csv: German layout uses ; and decimal commas', () => {
  assert.equal(toCsv(['Name', 'h'], [['A', 12.345]], { sep: ';', decimalComma: true }), 'Name;h\r\nA;12,35');
  assert.equal(toCsv(['Name', 'h'], [['A', 12.345]]), 'Name,h\r\nA,12.35');
});
