// Lotse – number words in a folded sentence (DE/EN, one–twelve / eins–zwölf, "a"/"ein" before a unit): "zwei Wochen" →
// "2 wochen", "a week later" → "1 week later", "eine weitere Woche" → "1 weitere woche". Only before a time unit
// (weeks, days, months, hours, quarters …), so "ein Projekt" or "a report" stay untouched. Pure.
const WORDS = {
  ein: 1, eine: 1, einen: 1, einer: 1, eins: 1, one: 1, a: 1, an: 1,
  zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4, fuenf: 5, five: 5, sechs: 6, six: 6, sieben: 7, seven: 7,
  acht: 8, eight: 8, neun: 9, nine: 9, zehn: 10, ten: 10, elf: 11, eleven: 11, zwoelf: 12, twelve: 12,
};
const UNIT = '(?:wochen?|weeks?|wks?|tage?n?|days?|monate?n?|months?|stunden?|hours?|quartale?n?|quarters?|kalenderwochen?)';
const BETWEEN = '(?:(?:more|extra|additional|further|weitere[nmrs]?|zusaetzliche[nmrs]?|mehr|volle[nmrs]?|full|ganze[nmrs]?|whole|last|past|next|letzte[nmrs]?|naechste[nmrs]?|kommende[nmrs]?|coming)\\s+){0,2}';
const RE = new RegExp(`\\b(${Object.keys(WORDS).sort((a, b) => b.length - a.length).join('|')})\\s+(${BETWEEN}${UNIT})\\b`, 'g');
export function numberWords(q) {
  return String(q || '').replace(RE, (m, w, rest) => `${WORDS[w]} ${rest}`);
}
export const NUMBER_WORDS = WORDS;
