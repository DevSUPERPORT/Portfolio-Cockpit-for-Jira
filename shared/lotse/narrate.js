// Lotse – wording. Deterministic DE/EN sentences: numbers through the app's formatter (ctx.fmt) or the local one,
// varied phrasing without randomness (the variant is chosen by a hash of the story id), no filler: every sentence a
// skill builds carries at least one fact.
const LOCALE = { de: 'de-DE', en: 'en-GB' };
const NF = new Map(), DF = new Map();

export function localFmt(lang = 'de') {
  const loc = LOCALE[lang === 'en' ? 'en' : 'de'];
  // one formatter per locale and precision (building an Intl formatter costs far more than formatting – a job's
  // document formats thousands of numbers)
  const nf = (d) => NF.get(`${loc}|${d}`) || NF.set(`${loc}|${d}`, new Intl.NumberFormat(loc, { maximumFractionDigits: d, minimumFractionDigits: 0 })).get(`${loc}|${d}`);
  const df = DF.get(loc) || DF.set(loc, new Intl.DateTimeFormat(loc, { timeZone: 'UTC', day: '2-digit', month: 'short' })).get(loc);
  const ok = (v) => v != null && Number.isFinite(v);
  return {
    n: (v, d = 0) => (ok(v) ? nf(d).format(v) : '–'),
    h: (v, d = 0) => (ok(v) ? `${nf(d).format(v)} h` : '–'),
    pct: (v, d = 0) => (ok(v) ? (lang === 'en' ? `${nf(d).format(v * 100)}%` : `${nf(d).format(v * 100)} %`) : '–'),
    date: (iso) => (iso ? df.format(new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)) : '–'),
    quarter: (q) => (q ? `Q${String(q).slice(-1)} ${String(q).slice(0, 4)}` : '–'),
  };
}
// The app's formatter where it has one (same look as every other view), the local one otherwise.
export function fmtOf(ctx, lang) {
  const base = localFmt(lang);
  const f = ctx?.fmt || {};
  const pick = (k) => (typeof f[k] === 'function' ? f[k] : base[k]);
  return { n: pick('n'), h: pick('h'), pct: pick('pct'), date: pick('date'), quarter: pick('quarter') };
}

export const T = (lang, de, en) => (lang === 'en' ? en : de);
export function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// One of several phrasings – always the same one for the same story and slot.
export const say = (seed, slot, variants) => variants[hash(`${seed}|${slot}`) % variants.length];
export const plural = (n, one, many) => (n === 1 ? one : many);
export function list(items, lang, max = 3) {
  const xs = items.filter(Boolean);
  const shown = xs.slice(0, max);
  const rest = xs.length - shown.length;
  const and = lang === 'en' ? ' and ' : ' und ';
  // the total stands in the sentence already – "and 2 more" would be a number without its own source (live finding)
  if (rest > 0) return `${shown.join(', ')}${lang === 'en' ? ' and others' : ' und weitere'}`;
  return shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')}${and}${shown.at(-1)}`;
}
// "Gefährdet" / "on track" – the cockpit's own words for health and waterline states
export const healthName = (h, lang) => ({ onTrack: T(lang, 'im Plan', 'on track'), atRisk: T(lang, 'gefährdet', 'at risk'), critical: T(lang, 'kritisch', 'critical') }[h] || T(lang, 'ohne Update', 'without an update'));
export const wlName = (s, lang) => ({ ok: T(lang, 'besetzbar', 'staffable'), partial: T(lang, 'teilweise besetzbar', 'partly staffable'), no: T(lang, 'nicht besetzbar', 'not staffable') }[s] || '–');

// A story as plain text (copy, export, read aloud, and the app's own reading when AI is off): headline, then the
// findings in impact order.
export function narrate(story) {
  if (!story) return '';
  const lines = [story.headline, ...(story.findings || []).map((f) => `– ${f.text}`)];
  return lines.filter(Boolean).join('\n');
}
