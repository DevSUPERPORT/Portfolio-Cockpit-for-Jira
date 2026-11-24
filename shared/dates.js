// Calendar math on UTC day indices (days since 1970-01-01). Pure, shared by backend and UI.

const DAY_MS = 86400000;

// Hot path (every date of every work item, worklog and ticket): "YYYY-MM-DD…" is read digit by digit and turned into
// a day index with integer arithmetic (days from civil, Gregorian) – no regex, no Date object. Anything unusual (month
// outside 1–12, years before 100, which Date.UTC maps to 19xx) takes the original Date.UTC path: the same result always.
const ZERO = 48, DASH = 45;
const dig = (s, i) => { const c = s.charCodeAt(i) - ZERO; return c >= 0 && c <= 9 ? c : -1; };
function slowIdx(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
}
export const dayIdx = (iso) => {
  if (!iso) return null;
  const s = typeof iso === 'string' ? iso : String(iso);
  if (s.length < 10 || s.charCodeAt(4) !== DASH || s.charCodeAt(7) !== DASH) return null;
  const y0 = dig(s, 0), y1 = dig(s, 1), y2 = dig(s, 2), y3 = dig(s, 3), m0 = dig(s, 5), m1 = dig(s, 6), d0 = dig(s, 8), d1 = dig(s, 9);
  if ((y0 | y1 | y2 | y3 | m0 | m1 | d0 | d1) < 0) return null;
  const y = y0 * 1000 + y1 * 100 + y2 * 10 + y3, m = m0 * 10 + m1, d = d0 * 10 + d1;
  if (m < 1 || m > 12 || y < 100) return slowIdx(s.slice(0, 10));
  // days from civil (H. Hinnant): exact for every Gregorian date; a day beyond the month's end rolls over like Date.UTC
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400), yoe = yy - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
};
export const ymdIdx = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
const p2 = (n) => (n < 10 ? `0${n}` : `${n}`);
// civil from days (the inverse); non-integers and years outside 1000–9999 take the Date path (same output)
export const isoOf = (idx) => {
  if (!Number.isInteger(idx) || idx < -354285 || idx > 2932896) return new Date(idx * DAY_MS).toISOString().slice(0, 10);
  const z = idx + 719468, era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)), mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp < 10 ? mp + 3 : mp - 9, y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${y}-${p2(m)}-${p2(d)}`;
};
export const todayIdx = (now = Date.now()) => Math.floor(now / DAY_MS);

// 0 = Sunday ... 6 = Saturday (day 0 was a Thursday)
export const dow = (idx) => (((idx + 4) % 7) + 7) % 7;
export const isWeekday = (idx) => { const d = dow(idx); return d !== 0 && d !== 6; };
export const mondayOf = (idx) => idx - ((dow(idx) + 6) % 7);

// Weekdays in the closed range [a, b], minus holidays (a Set of day indices) that fall on weekdays.
export function workdays(a, b, holidays) {
  if (a == null || b == null || b < a) return 0;
  const len = b - a + 1;
  let n = Math.floor(len / 7) * 5;
  for (let i = a + Math.floor(len / 7) * 7; i <= b; i++) if (isWeekday(i)) n++;
  if (holidays && holidays.size) for (const h of holidays) if (h >= a && h <= b && isWeekday(h)) n--;
  return n;
}

export const nextWorkday = (idx) => { let i = idx; while (!isWeekday(i)) i++; return i; };

export const yearOf = (idx) => new Date(idx * DAY_MS).getUTCFullYear();
export const quarterKeyOf = (idx) => {
  const d = new Date(idx * DAY_MS);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
};
export const quarterRange = (key) => {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return null;
  const y = +m[1], q = +m[2];
  const start = ymdIdx(y, (q - 1) * 3 + 1, 1);
  const end = (q === 4 ? ymdIdx(y + 1, 1, 1) : ymdIdx(y, q * 3 + 1, 1)) - 1;
  return [start, end];
};
export const shiftQuarter = (key, n) => {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  const t = +m[1] * 4 + (+m[2] - 1) + n;
  return `${Math.floor(t / 4)}-Q${(t % 4) + 1}`;
};
export const compareQuarter = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // 'YYYY-Qn' sorts lexically
export const quartersFrom = (key, n) => Array.from({ length: n }, (_, i) => shiftQuarter(key, i));

// Accepts "2026-Q4", "Q4 2026", "Q4/26", "2026 Q4" and returns "2026-Q4" (or null).
export function parseQuarter(v) {
  if (v == null) return null;
  const s = String(typeof v === 'object' ? v.value ?? v.name ?? '' : v).trim();
  let m = /(\d{4})\s*[-/ ]?\s*Q\s*([1-4])/i.exec(s);
  if (m) return `${m[1]}-Q${m[2]}`;
  m = /Q\s*([1-4])\s*[-/ ]?\s*(\d{4}|\d{2})\b/i.exec(s);
  if (m) return `${m[2].length === 2 ? '20' + m[2] : m[2]}-Q${m[1]}`;
  return null;
}

export const weeksFrom = (idx, n) => {
  const m = mondayOf(idx);
  return Array.from({ length: n }, (_, i) => [m + i * 7, m + i * 7 + 6]);
};

export const monthRange = (idx) => {
  const d = new Date(idx * DAY_MS);
  const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1;
  return [ymdIdx(y, mo, 1), (mo === 12 ? ymdIdx(y + 1, 1, 1) : ymdIdx(y, mo + 1, 1)) - 1];
};
