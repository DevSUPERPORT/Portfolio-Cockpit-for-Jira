import { toCsv } from '@shared/csv.js';
import { getLang } from './i18n.js';

// A real file download (the Jira app frame allows downloads). UTF-8 with BOM so Excel reads umlauts;
// German users get ';' and decimal commas, everyone else ',' and points.
export function downloadCsv(name, header, rows) {
  const de = getLang() === 'de';
  const csv = `﻿${toCsv(header, rows, { sep: de ? ';' : ',', decimalComma: de })}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return rows.length;
}
