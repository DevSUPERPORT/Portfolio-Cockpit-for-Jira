// Lotse chains – cutting a complex request into clauses (DE/EN), each one step of the plan.
//
//   splitClauses(text) → { each: null | 'people'|'teams'|'projects', clauses: [{ text, q, ref, each, seq }] }
//     text  the clause as written (for the plan view), q  folded + typo-repaired (for the mapping)
//     ref   the clause points back ("sie", "diese", "jeweils", "them", "those", "each of them", "it") – binds to the
//           set or result of an earlier step
//     each  "for each / je / jeweils / every one of them" – one result per member of the set
//     seq   the clause was introduced by an explicit sequence word ("und dann", "danach", "then", "finally" …)
//
// Cuts at: sentence ends (. ? ! ;), sequence words (und dann, danach, anschließend, außerdem, zum Schluss, then, after
// that, afterwards, finally, also …) at a clause boundary, "und"/"and"/commas followed by an imperative verb, and the
// items of a list after "Für jedes Team: …" (the prefix applies to every item). A comma before a relative clause
// ("Projekte, die im Q4 …") is never a cut.
import { fold } from '../../../ask.js';
import { numberWords } from '../../numbers.js';

// imperative / infinitive verbs that start a step (folded: ä → ae, ß → ss)
const VERBS = [
  'pruef', 'pruefe', 'pruefen', 'check', 'checke', 'finde', 'find', 'finden', 'such', 'suche', 'zeig', 'zeige', 'show', 'list', 'liste', 'listen', 'plane', 'plan', 'planen', 'verteile', 'verteil', 'distribute',
  'gib', 'give', 'send', 'schick', 'schicke', 'erinner', 'erinnere', 'erinnern', 'remind', 'mach', 'mache', 'machen', 'make', 'erstell', 'erstelle', 'erstellen', 'create', 'build', 'bau', 'baue',
  'vergleich', 'vergleiche', 'compare', 'fuell', 'fuelle', 'fuellen', 'fill', 'fasse', 'fass', 'summarise', 'summarize', 'schreib', 'schreibe', 'write', 'draft', 'entwirf', 'setz', 'setze', 'set',
  'verschieb', 'verschiebe', 'move', 'loese', 'loes', 'resolve', 'fix', 'bereite', 'prepare', 'exportier', 'exportiere', 'export', 'sammle', 'collect', 'analysiere', 'analyse', 'analyze',
  'oeffne', 'open', 'ranke', 'rank', 'sortiere', 'sort', 'informiere', 'inform', 'notify', 'benachrichtige', 'aktualisiere', 'update', 'buche', 'book', 'ordne', 'bring', 'bringe', 'hol', 'hole',
  'get', 'identify', 'identifiziere', 'ermittle', 'determine', 'lege', 'leg', 'stell', 'stelle', 'pack', 'packe', 'verschick', 'verschicke', 'teile', 'share', 'gleiche', 'balance', 'level',
  'triage', 'review', 'ueberpruefe', 'kontrolliere', 'verify', 'calculate', 'berechne', 'estimate', 'schaetze', 'tell', 'sag', 'sage', 'nenne', 'name', 'look', 'schau', 'schaue', 'go', 'run', 'starte', 'start',
];
const VERB_RE = new RegExp(`^(?:bitte |please |dann |then |danach |noch |auch |also |und |and )*(?:${VERBS.join('|')})\\b`);
// sequence words that cut at a clause boundary (after a comma, "und"/"and" or the sentence start)
const SEQ0 = ['und dann', 'and then', 'dann', 'then', 'danach', 'anschliessend', 'ausserdem', 'zusaetzlich', 'zum schluss', 'zuletzt', 'abschliessend', 'schliesslich', 'after that', 'afterwards', 'finally', 'lastly', 'in addition', 'additionally', 'next', 'also'];
const SEQ = [...new Set(SEQ0.flatMap((w) => [w, w.replace(/ss/g, 's').replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')]))].sort((a, b) => b.length - a.length);
// a sequence word anywhere in a clause ("und erstelle danach …") still says: this comes after the step before
const SEQ_IN = /\b(danach|anschliessend|anschliesend|dann|then|afterwards|after that|finally|zum schluss|zuletzt|abschliessend|schliesslich|lastly)\b/;
const SEQ_RE = new RegExp(`(?:^|,|;)\\s*(?:(?:und|and)\\s+)?(${SEQ.join('|')})\\b\\s*,?\\s*|\\s(?:und|and)\\s+(${SEQ.filter((s) => !/^(und|and) /.test(s)).join('|')})\\b\\s*,?\\s*`, 'g');
const EACH_PREFIX = /^\s*(?:bitte\s+|please\s+)?(?:fuer|for|bei|in)\s+(jedes|jede[nmrs]?|each|every|alle[nmrs]?|all(?: the)?)\s+(teams?|projekte?|projects?|personen|person|kolleg\w*|colleagues?|mitarbeit\w*|people)\s*[:,–-]\s*/;
const REF_RE = /\b(sie|ihnen|ihre[nmrs]?|diese[nmrs]?|jene[nmrs]?|jeweils|jede[mnr]? (?:von ihnen|davon)|denen|them|those|these|their|theirs|each of them|every one of them|all of them|for them|it|its|daraus|davon|dazu|darueber|damit|das ergebnis|the result|the results|die ergebnisse|die liste|the list|alles|everything)\b/;
const EACH_RE = /\b(jede[nmrs]? (?:einzelne[nmrs]? )?(?:von ihnen|davon|person|kolleg\w*|team\w*|projekt\w*|teamleitung\w*|owner)|each of their|jede[rs]? ihrer|jeweils|je (?:person|team|teamleitung|projekt|owner|kolleg\w*)|each of them|every one of them|each (?:person|team|project|colleague|owner|lead)|every (?:person|team|project|colleague|owner|lead)|per (?:person|team|project)|pro (?:person|team|projekt)|einzeln\w*|individual\w*|eigene[ns]? pdf|own pdf)\b/;

export const qOf = (text) => numberWords(fold(String(text || '')).replace(/[?!.,;:„“"”()]+/g, ' ').replace(/\s+/g, ' ').trim());

// sentence ends – not inside numbers ("2.0"), abbreviations ("z. B.", "e.g.", "bzw.") or dates ("12.11.")
function sentences(t) {
  const out = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    cur += ch;
    if (!/[.?!;]/.test(ch)) continue;
    const prev = t[i - 1] || '', next = t[i + 1] || '';
    if (ch === '.' && (/\d/.test(prev) && /\d/.test(next))) continue;
    if (ch === '.' && /\b(z|b|e|g|i|bzw|ca|vs|usw|etc|ggf|inkl|zb|nr|kw|bspw|d\.h|u\.a)$/i.test(cur.slice(0, -1).trim().split(/\s/).pop() || '')) continue;
    if (ch === '.' && /\d/.test(prev) && /^\s?\d/.test(t.slice(i + 1, i + 3))) continue;
    if (next && !/\s/.test(next)) continue;
    out.push(cur.trim());
    cur = '';
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((s) => s.replace(/^[,;\s]+|[,;\s]+$/g, '')).filter(Boolean);
}
// cut at verbs after "und"/"and"/comma (the original text is cut at the same places as its folded copy: fold() keeps
// word boundaries, so the cut points are found word by word)
function verbCuts(s) {
  const words = s.split(/(\s+)/);
  const parts = [];
  let cur = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^\s+$/.test(w)) { cur.push(w); continue; }
    const fw = fold(w).replace(/[^a-z0-9%-]/g, '');
    const rest = fold(words.slice(i + 1).join('')).replace(/[?!.,;:„“"”()]+/g, ' ').trim();
    const prevRaw = cur.join('');
    const afterComma = /,\s*$/.test(prevRaw);
    const isAnd = /^(und|and|sowie|&)$/.test(fw);
    if (isAnd && VERB_RE.test(`${rest}`) && cur.join('').trim()) { parts.push(cur.join('')); cur = []; continue; }
    if (afterComma && VERB_RE.test(`${fw} ${rest}`) && !/^(die|der|das|den|dem|deren|dessen|which|that|who|wer|wo|wie|ob)$/.test(fw)) { parts.push(prevRaw); cur = [w]; continue; }
    cur.push(w);
  }
  if (cur.join('').trim()) parts.push(cur.join(''));
  return parts.map((p) => p.replace(/^[,;\s]+|[,;\s]+$/g, '').trim()).filter(Boolean);
}
// cut at sequence words; remember which parts they introduced
function seqCuts(s) {
  const f = fold(s);
  if (f.length !== s.length) return [{ text: s, seq: false }]; // safety: only when folding kept the positions
  const out = [];
  let last = 0, seqNext = false;
  SEQ_RE.lastIndex = 0;
  for (const m of f.matchAll(SEQ_RE)) {
    const word = m[1] || m[2];
    // "next 4 weeks", "dann wenn": a sequence word followed by a number or a conjunction is no cut
    const after = f.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (/^(\d|wochen|weeks|woche|week|quartal|quarter|monat|month|wenn|if)/.test(after)) continue;
    if (word === 'next' && !/^,|^\s*$/.test(f.slice(m.index - 1, m.index))) continue;
    const head = s.slice(last, m.index).trim();
    if (head) out.push({ text: head, seq: seqNext });
    last = m.index + m[0].length;
    seqNext = true;
  }
  const tail = s.slice(last).trim();
  if (tail) out.push({ text: tail, seq: seqNext });
  return out;
}
// ä/ö/ü/ß fold to two letters: work on a same-length copy for the sequence cuts
const sameLen = (s) => s.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/Ä/g, 'A').replace(/Ö/g, 'O').replace(/Ü/g, 'U').replace(/ß/g, 's');

export function splitClauses(text) {
  const raw = String(text || '').slice(0, 600).replace(/\s+/g, ' ').trim();
  if (!raw) return { each: null, clauses: [] };
  let body = raw;
  let each = null;
  const pm = EACH_PREFIX.exec(fold(raw));
  if (pm) {
    const ent = pm[2];
    each = /^team/.test(ent) ? 'teams' : /^proje/.test(ent) ? 'projects' : 'people';
    // the prefix's length in the original text: as many words as the folded prefix has
    const nWords = pm[0].trim().split(/\s+/).length;
    body = raw.split(/\s+/).slice(nWords).join(' ').replace(/^[:,–-]\s*/, '');
  }
  const out = [];
  for (const sen of sentences(body)) {
    const plain = sameLen(sen);
    const segs = plain.length === sen.length ? seqCuts(plain).map((x) => ({ ...x, text: sen.substr(plain.indexOf(x.text), x.text.length) })) : [{ text: sen, seq: false }];
    for (const seg of segs) {
      let parts = verbCuts(seg.text);
      // a list after "Für jedes Team:" has no verbs: its items are cut at commas and "und"/"and"
      if (each && parts.length === 1) parts = seg.text.split(/\s*,\s*(?:und\s+|and\s+)?|\s+(?:und|and)\s+(?=\S)/).map((x) => x.trim()).filter((x) => x.length > 2);
      parts.forEach((p, i) => out.push({ text: p.replace(/[.?!;:,]+$/, '').trim(), seq: i === 0 ? seg.seq : false }));
    }
  }
  const clauses = out.filter((c) => c.text && qOf(c.text).length > 1).map((c) => {
    const q = qOf(c.text);
    return { text: c.text, q, ref: REF_RE.test(q), each: each || (EACH_RE.test(q) ? 'members' : null), seq: c.seq || SEQ_IN.test(q) };
  });
  return { each, clauses };
}
export const hasRef = (q) => REF_RE.test(q);
export const isVerbStart = (q) => VERB_RE.test(q);
