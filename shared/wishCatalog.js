// "Ich will …" – the catalogue of answer cards a free wish can land on, and the app's own rules for the new
// wish cards. Pure and tiny on purpose: shared by the Ask engine (shared/ask.js), the optional AI intent parser
// (shared/aiAssist.js, feature "intent") and the tests. The AI may only ever pick an id from WISH_CARDS – it never
// invents a card, a team or a project (see validateOutput → intent).

// params: what a card can be narrowed to – team (a team id), project (a portfolio ref), text (the work to estimate).
export const WISH_CARDS = Object.freeze([
  { id: 'realCapacity', params: ['team'], de: 'Realistische Kapazität je Team: verfügbar, Support-Realität, Raum für Projekte, geplant', en: 'Realistic capacity per team: available, support reality, room for projects, planned' },
  { id: 'fitsNoOvertime', params: ['team'], de: 'Was passt ohne Überstunden – Wasserlinie auf der realistischen Kapazität, nach Rang', en: 'What fits without overtime – waterline on realistic capacity, by rank' },
  { id: 'overtime', params: ['team'], de: 'Überstunden-Ausblick: wer, wann, wie viele Stunden, und welche niedrig priorisierte Arbeit man verschiebt', en: 'Overtime outlook: who, when, how many hours, and which low-ranked work to move' },
  { id: 'similarWork', params: ['text', 'project'], de: 'Schätzen wie früher: ähnliche erledigte Arbeit mit typischem Aufwand, Überzug und Dauer', en: 'Estimate like before: similar finished work with typical hours, overrun and duration' },
  { id: 'supportTopics', params: [], de: 'Wiederkehrende Support-Themen und Kandidaten für Playbooks / Standardantworten', en: 'Recurring support topics and candidates for playbooks / standard replies' },
  { id: 'attention', params: ['project'], de: 'Was jetzt Aufmerksamkeit braucht', en: 'What needs attention now' },
  { id: 'waterline', params: [], de: 'Wasserlinie: ab welchem Rang reicht die Kapazität nicht', en: 'Waterline: from which rank capacity runs out' },
  { id: 'utilization', params: ['team'], de: 'Auslastung der Teams je Quartal', en: 'Team utilisation per quarter' },
  { id: 'blocked', params: ['project'], de: 'Was blockiert ist', en: 'What is blocked' },
  { id: 'overdue', params: ['project'], de: 'Überfällige Arbeit', en: 'Overdue work' },
  { id: 'health', params: [], de: 'Health der Projekte', en: 'Project health' },
  { id: 'progress', params: ['project'], de: 'Fortschritt der Projekte', en: 'Project progress' },
  { id: 'hours', params: ['project'], de: 'Schätzung, gebuchte Zeit und Prognose', en: 'Estimate, logged time and forecast' },
  { id: 'support', params: ['project'], de: 'Support und SLAs', en: 'Support and SLAs' },
  { id: 'dependencies', params: ['project'], de: 'Abhängigkeiten und Terminkonflikte', en: 'Dependencies and schedule conflicts' },
  { id: 'quality', params: ['project'], de: 'Datenqualität und Lücken', en: 'Data quality and gaps' },
  { id: 'milestones', params: [], de: 'Meilensteine', en: 'Milestones' },
  { id: 'maturity', params: ['project'], de: 'Reife: wie belastbar die Zahlen sind', en: 'Maturity: how reliable the numbers are' },
  { id: 'ranking', params: [], de: 'Portfolio nach Rang', en: 'Portfolio by rank' },
]);
export const WISH_IDS = new Set(WISH_CARDS.map((c) => c.id));
// The cards that are new with "Ich will …" (they need the history of done work, loaded on demand).
export const HISTORY_CARDS = new Set(['realCapacity', 'fitsNoOvertime', 'overtime', 'similarWork', 'supportTopics']);

// Wish phrasing that only says "I want …" – stripped before the subject of a wish is taken (folded text: ä → ae).
export const WISH_PREFIX = /^(?:(?:also|bitte|please|hey|hallo|hi)\s+)*(?:ich (?:will|moechte|brauche|haette gerne?|wuerde gerne?|muss|moechte gerne)|wir (?:wollen|moechten|brauchen|muessen)|zeig(?:e)? (?:mir|uns)|gib (?:mir|uns)|i(?:'d| would)? (?:want|need|like)(?: to)?|we (?:want|need)(?: to)?|show me|give me|let me see|can you show(?: me)?)\b\s*(?:(?:wissen|know|sehen|see),?\s*)?/;
export const isWish = (folded) => WISH_PREFIX.test(String(folded || '').trim());

// The rules for the new wish cards, in priority order (first match wins inside this list; shared/ask.js puts the
// list right after the guard, so a wish beats the older, broader question intents).
export const WISH_RULES = [
  ['supportTopics', /wiederkehrend|recurring|immer (wieder )?(die )?gleiche|haeufig(e|en|ste|sten)? (support|ticket|problem|frage|fragen|thema|themen|fehler)|(most )?(common|frequent|repeated|repeating) (support|ticket|issue|problem|question|topic)s?|playbooks?|hilfe ?artikel|help ?articles?|\bfaq\b|standard ?antwort|standard (reply|answer|response)s?|canned (reply|answer|response)|textbaustein|support[- ]?themen|support topics|same (questions|tickets|problems) (again|over)/],
  ['similarWork', /wie (frueher|bisher|beim letzten mal|letztes mal)|like (before|last time|we did before)|aehnlich|similar|vergleichbar|comparable|schaetz(e|en)? (mir |uns )?(das|die|den|diese[nrs]?|eine?[nm]?|ein|unser[e]?|mein[e]?|so)\b|estimate (this|that|a|an|the|my|our|it|something)\b|wie lange (dauert|brauchen|braucht|wird)|how long (will|does|would|did|might)|erfahrungswerte|past (work|projects|tasks)|fruehere[nm]? (projekt|aufgabe|arbeit)|aus (der )?vergangenheit lernen|learn from (the )?past/],
  ['fitsNoOvertime', /ohne (massive |viele |grosse )?ueberstunden|without (massive |much |lots of |any )?overtime|was passt (noch )?(rein|hinein)?|what (still )?fits|passt (das|es|alles) (noch )?(rein|hinein)?|ob wir (das|es|alles) schaffen|whether we (can )?make it|will we make it|schaffen wir (das|es|alles)|can we (make|do) it (all )?without|in (der |unserer )?normalen arbeitszeit|within normal hours|ohne mehrarbeit/],
  ['overtime', /ueberstunden|overtime|mehrarbeit|(work|working|stay|staying) (late|long hours|weekends?|evenings?|nights?)|late nights?|long (hours|evenings|nights)|weekend ?work|(abends|nachts|am wochenende) (arbeiten|sitzen)|lange abende|wochenendarbeit|ausgebrannt|erschoepf|exhausted|ueberlast(ung)? vermeiden|avoid (overload|burn ?out)|burn ?out|zu viel arbeit|too much work|wer (arbeitet|ist) (zu viel|ueber 100)|who (works|is) (too much|over 100)/],
  ['realCapacity', /realistisch|realistic|echte[n]? kapazitaet|real capacity|tatsaechlich(e)? (zeit|kapazitaet)|actual capacity|wie viel (zeit|kapazitaet) (haben wir|bleibt)|how much (time|capacity) (do we (really |actually )?have|is left)|nach abzug (des |vom )?support|after support|support (frisst|kostet|eats|takes)|ressourcen (realistisch |richtig |sinnvoll )?(planen|verteilen|zuteilen)|allocat(e|ion) (of )?(people|resources|capacity)|resourc(e|ing) (planning|allocation)/],
];
export function ruleWish(folded) {
  const q = String(folded || '');
  for (const [id, re] of WISH_RULES) if (re.test(q)) return id;
  return null;
}

// The work to estimate in a "like before" wish: text in quotes or after a colon, otherwise the wish without its
// wish words and the "estimate like before" phrasing. Original spelling is kept (the similarity search folds itself).
export function wishSubject(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  const quoted = /["„“”'‚‘’»«]([^"„“”'‚‘’»«]{3,})["„“”'‚‘’»«]/.exec(s);
  if (quoted) return quoted[1].trim().slice(0, 200);
  const colon = s.indexOf(':');
  if (colon >= 0 && s.slice(colon + 1).trim().length >= 3) return s.slice(colon + 1).trim().slice(0, 200);
  const strip = /^(?:(?:also|bitte|please)\s+)*(?:ich (?:will|möchte|moechte|brauche|hätte gern|haette gern|muss)|wir (?:wollen|möchten|brauchen|müssen)|zeig(?:e)? (?:mir|uns)|gib (?:mir|uns)|i(?:'d| would)? (?:want|need|like)(?: to)?|we (?:want|need)(?: to)?|show me|give me)\s+/i;
  const out = s.replace(strip, '')
    .replace(/^(?:schätzen|schaetzen|schätze|schaetze|estimate)(?: (?:mir|uns))?(?: wie (?:früher|frueher|bisher))?(?: (?:like|as) before)?\s*/i, '')
    .replace(/^(?:(?:eine?n?|die|das|den|the|an?) )?(?:schätzung|schaetzung|estimate|aufwand|effort)(?: wie (?:früher|frueher|bisher|beim letzten mal))?(?: (?:für|fuer|for|of))?\s*/i, '')
    .replace(/\s*(?:wie (?:früher|frueher|bisher|beim letzten mal)|like (?:before|last time)|(?:based )?on (?:past|similar) work)\s*/gi, ' ')
    .replace(/^(?:wie lange (?:dauert|braucht|brauchen wir für|brauchen wir fuer)|how long (?:will|does|would) (?:it take to )?)\s*/i, '')
    .replace(/[?!.]+$/, '').trim();
  return out.slice(0, 200);
}
