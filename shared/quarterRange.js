// The quarters the app's "target quarters" field offers (Konfiguration › T-Shirt-Größen & Quartale), one source for
// the server (field.options) and the configuration screen.
//   range: { back, ahead, off: ['YYYY-Qn'], extra: ['YYYY-Qn'] }
//   back / ahead – the rolling window around the current quarter; off – quarters of that window switched off;
//   extra – quarters added by hand (also outside the window). Boss 2026-11-18: "manually add and disable".
export const QUARTER_RANGE_DEFAULT = Object.freeze({ back: 1, ahead: 10, off: [], extra: [] });
export const MAX_EXTRA_QUARTERS = 40;
const Q_KEY = /^(\d{4})-Q([1-4])$/;
const validKey = (k) => typeof k === 'string' && Q_KEY.test(k) && +k.slice(0, 4) >= 2000 && +k.slice(0, 4) <= 2100;
const keyList = (v) => (Array.isArray(v) ? [...new Set(v.filter(validKey))].sort().slice(0, MAX_EXTRA_QUARTERS) : []);

export function validQuarterRange(x) {
  const d = QUARTER_RANGE_DEFAULT;
  const int = (v, lo, hi, def) => (Number.isInteger(+v) && +v >= lo && +v <= hi ? +v : def);
  return { back: int(x?.back, 0, 8, d.back), ahead: int(x?.ahead, 1, 20, d.ahead), off: keyList(x?.off), extra: keyList(x?.extra) };
}
// The rolling window, oldest first (switched-off quarters included).
export function rollingQuarters(range, now = new Date()) {
  const r = validQuarterRange(range);
  const y = now.getUTCFullYear(), q = Math.floor(now.getUTCMonth() / 3);
  const out = [];
  for (let i = -r.back; i <= r.ahead; i++) { const k = q + i; out.push(`${y + Math.floor(k / 4)}-Q${((k % 4) + 4) % 4 + 1}`); }
  return out;
}
// What the field offers: the window without the switched-off quarters, plus the added ones – sorted, each once.
export function quarterChoices(range, now = new Date()) {
  const r = validQuarterRange(range);
  const off = new Set(r.off);
  return [...new Set([...rollingQuarters(r, now).filter((k) => !off.has(k)), ...r.extra])].sort();
}
export const isQuarterKey = validKey;
