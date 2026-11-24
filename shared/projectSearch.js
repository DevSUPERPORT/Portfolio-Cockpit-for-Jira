// Finding a project to add (Portfolio › Projekt hinzufügen): fast, forgiving matching over name and key.
// Boss 2026-11-19: "users need to type the whole key – one letter missing and the search fails; even the whole name
// does not always find it". Used in the browser on every keystroke (instant) and on the server for very large sites.
//
//   rankCandidates(list, query) → the matching items, best first (an empty query keeps the order of `list`)
//   matchParts(text, query)     → [{ t, hit }] for highlighting what matched
//
// What matches, strongest first: the exact key · a key prefix ("PCX-5" → PCX-5, PCX-50 … PCX-59; "pcx56" = "PCX-56") ·
// the exact name · the name starting with the query · every query word starting a name word (any order) · the query
// anywhere in the name · initials ("kks" → "KI-Kundenservice") · words with a typo (1 letter for 4–7 letters, 2 for
// longer words) · the space or owner name. Case, accents, dashes and punctuation never matter.

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss');
export const normalize = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
const compact = (s) => fold(s).replace(/[^a-z0-9]+/g, '');
const words = (s) => normalize(s).split(' ').filter(Boolean);

// Damerau–Levenshtein (optimal string alignment), stops early above `max`
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}
const allowed = (len) => (len >= 8 ? 2 : len >= 4 ? 1 : 0);
// how well one query word fits one name word: 3 = equal, 2 = start, 1 = with a typo (also of the start), 0 = not
function wordFit(q, w) {
  if (w === q) return 3;
  if (w.startsWith(q)) return 2;
  const max = allowed(q.length);
  if (!max) return 0;
  if (distance(q, w, max) <= max) return 1;
  if (w.length > q.length && distance(q, w.slice(0, q.length), max) <= max) return 1; // a typo in what is typed so far
  return 0;
}

// The score of one item for a query (0 = no match). item: { key, name, space?, owner? }
export function scoreCandidate(item, query) {
  const q = normalize(query), qc = compact(query);
  if (!q) return 1;
  const key = compact(item.key), name = normalize(item.name), nameC = compact(item.name);
  let s = 0;
  // the key
  if (key && qc) {
    if (key === qc) s = Math.max(s, 1000);
    else if (key.startsWith(qc)) s = Math.max(s, 900 - (key.length - qc.length));
    else if (qc.length >= 3 && key.includes(qc)) s = Math.max(s, 560);
  }
  // the name
  if (name) {
    if (name === q || nameC === qc) s = Math.max(s, 850);
    else if (name.startsWith(q) || nameC.startsWith(qc)) s = Math.max(s, 760);
    const qw = q.split(' '), nw = name.split(' ');
    const fits = qw.map((x) => Math.max(0, ...nw.map((w) => wordFit(x, w))));
    if (fits.every((f) => f >= 2)) s = Math.max(s, 700 + (fits.filter((f) => f === 3).length * 10) - nw.length);
    if (qc.length >= 3 && nameC.includes(qc)) s = Math.max(s, 600);
    const initials = nw.map((w) => w[0]).join('');
    if (qc.length >= 2 && !/\d/.test(qc) && initials.startsWith(qc)) s = Math.max(s, 520);
    if (fits.every((f) => f >= 1)) s = Math.max(s, 400 + fits.reduce((a, f) => a + f, 0) * 10);
  }
  // the space and the owner (weaker)
  for (const other of [item.space, item.owner?.name]) {
    if (!other || s >= 300) continue;
    const ow = words(other);
    if (q.split(' ').every((x) => ow.some((w) => wordFit(x, w) >= 2))) s = Math.max(s, 250);
  }
  return s;
}

// The matching items, best first; equal scores keep the incoming order (most recently updated first).
export function rankCandidates(list, query, limit = 60) {
  const items = Array.isArray(list) ? list : [];
  if (!normalize(query)) return items.slice(0, limit);
  return items.map((x, i) => ({ x, i, s: scoreCandidate(x, query) })).filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i).slice(0, limit).map((r) => r.x);
}

// Highlighting: the parts of `text` that start with a query word (or equal the compact query, for keys)
export function matchParts(text, query) {
  const t = String(text ?? '');
  const qw = words(query);
  if (!t || !qw.length) return [{ t, hit: false }];
  const qc = compact(query);
  // keys: the leading characters that match the compact query
  const tc = compact(t);
  if (qc && tc.startsWith(qc) && /^[A-Za-z0-9_-]+$/.test(t)) {
    let n = 0, cut = 0;
    while (cut < t.length && n < qc.length) { if (/[A-Za-z0-9]/.test(t[cut])) n++; cut++; }
    return [{ t: t.slice(0, cut), hit: true }, ...(cut < t.length ? [{ t: t.slice(cut), hit: false }] : [])];
  }
  const out = [];
  const re = /[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu;
  for (const m of t.match(re) || []) {
    const w = normalize(m);
    const q = w && qw.filter((x) => w.startsWith(x)).sort((a, b) => b.length - a.length)[0];
    if (q) {
      // the matched start of the word (by folded length – accents fold to one letter)
      let cut = 0, n = 0;
      while (cut < m.length && n < q.length) { n += normalize(m[cut]).length || 1; cut++; }
      out.push({ t: m.slice(0, cut), hit: true });
      if (cut < m.length) out.push({ t: m.slice(cut), hit: false });
    } else out.push({ t: m, hit: false });
  }
  return out;
}

// For the server: a key-like query ("PCX", "PCX-", "PCX-5") → the space key to search in
export const keyPrefixOf = (query) => {
  const m = /^\s*([A-Za-z][A-Za-z0-9_]{1,9})\s*-?\s*(\d*)\s*$/.exec(String(query ?? ''));
  return m ? m[1].toUpperCase() : null;
};
// For the server: words worth a Jira text search (Jira's own search ignores very short words and punctuation)
export const searchWords = (query) => words(query).filter((w) => w.length >= 2).slice(0, 6);
