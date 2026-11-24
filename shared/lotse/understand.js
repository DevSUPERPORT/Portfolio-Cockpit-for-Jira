// Lotse – understanding a question (DE/EN, typo tolerant): which skill, with which project / team / person / quarter,
// and follow-ups resolved against the last story ("und für Team Web?", "and the next quarter?", "warum?",
// "was wäre wenn wir Rang 5 nach hinten schieben"). Pure and local – no AI.
//
// understand(text, ctx, memory) → { skill: id|'guard'|null, params, confidence: 'high'|'medium'|'low', alternatives: [{ skill, params, label }] }
// memory = { last: { skill, params, subject } } – remember(story) builds it from the story Lotse returned last.
import { fold, fixTypos, parseQuestion, findProject, findTeam, wishSubject } from '../ask.js';
import { shiftQuarter } from '../dates.js';
import { computedOf, dsOf } from './kit.js';
import { SKILLS } from './skills/index.js';
import { routeAct as actRoute } from './act/route.js';
import { WORKFLOWS } from './act/workflows.js';
import { can } from './act/kit.js';
import { learnedSkill } from './learn.js';
import { numberWords } from './numbers.js';

const STOP = new Set(['der', 'die', 'das', 'und', 'oder', 'mit', 'the', 'and', 'with', 'for', 'fuer', 'von', 'vom', 'bei', 'ist', 'sind', 'wie', 'was', 'wer', 'team', 'teams', 'projekt', 'project']);
// own vocabulary for typo repair (edit distance 1, words of 5+ letters) on top of ask.js fixTypos
const VOCAB = ['wasserlinie', 'waterline', 'ueberstunden', 'overtime', 'blockiert', 'blocked', 'blockaden', 'planungsvorschlaege', 'vergleiche', 'vergleich', 'compare', 'realistisch', 'realistic',
  'kapazitaet', 'capacity', 'lagebild', 'briefing', 'portfolio', 'datenluecken', 'luecken', 'schaetze', 'schaetzen', 'estimate', 'wiederkehrende', 'recurring', 'verteilen', 'tickets',
  'health', 'entwurf', 'woche', 'warum', 'optimieren', 'optimize', 'abhaengigkeiten', 'dependencies', 'support', 'ueberlast', 'auslastung'];
function lev1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
const repair = (q) => q.split(' ').map((w) => (w.length >= 5 && !VOCAB.includes(w) ? VOCAB.find((k) => lev1(w, k)) || w : w)).join(' ');
export const normalize = (text) => repair(fixTypos(fold(text).replace(/[?!.,;:„“"”'()]+/g, ' ').replace(/\s+/g, ' ').trim()));

const FOLLOW_RE = /^(und|and|what about|how about|wie (ist|sieht) es (mit|bei|im)|und (bei|fuer|im|mit|in|das)|and (for|in|the|with)|same for|dasselbe fuer|das gleiche fuer|jetzt fuer|now for)\b/;
const WHY_RE = /^(und )?(warum|wieso|weshalb|weswegen|why|how come|woran liegt (das|es)|was ist der grund|begruendung|erklaer (das|mir das)|explain( that| this)?)\b/;
const WHATIF_RE = /was waere,? wenn|was ist,? wenn|was passiert,? wenn|angenommen|what if|what happens if|suppose|stell dir vor|szenario|scenario/;
const NEXTQ_RE = /naechste[sn]? quartal|next quarter|folgende[sn]? quartal|following quarter/;
const PREVQ_RE = /dieses quartal|this quarter|aktuelle[sn]? quartal|current quarter/;
// "there", "this project": the last story's project is meant
const DEICTIC_RE = /\b(dort|da|hier|dabei|davon|darin|(?:dem|das|diesem|dieses) projekte?|there|this project|that project|its|in it)\b/;
// "Projekt 6", "Rang 1", "#3": a project by its rank – a number, not a name (so "auf Rang 1" can be a target)
const RANK_REF_RE = /(?:projekt|project|rang|rank|platz)\s*#?\s*\d{1,3}\b|#\d{1,3}\b/g;
const MINE_RE = /\b(mein|meine|meinen|meinem|meiner|my|mine|mich|mir|me)\b/;
// "ich" / "I" said with my own bookings or my week ("Wie viele Stunden habe ich diese Woche gebucht?")
const SELF_RE = /\b(ich|i)\b/;
const MY_WORK_RE = /gebucht|booked|buchung|booking|\blogged\b|\bworklogs?\b|(diese|this) woche|this week|meine? aufgaben|my tasks|fuer mich an\b/;
// "Verteile die neuen Support-Tickets" / "distribute the new tickets" (an instruction – questions like "Wer soll die
// neuen Tickets bekommen?" or "dispatch …" stay the dispatch story) and "Wer hat zu wenig gebucht?" (the team's bookings)
const TRIAGE_JOB_RE = /^(bitte |please |lotse )?(verteile?n?|distribute)\b.*\b(tickets?|anfragen|support|eingang|inbox)\b|\b(support-?|neuen? |eingehenden? |offenen? )?tickets? (verteilen|zuweisen)\b|^(bitte )?(den )?(support-?)?eingang verteilen\b/;
const BOOKING_JOB_RE = /\bwer (hat|haben) (diese woche |heute |noch )?(zu wenig|nicht genug|nichts|noch nicht|weniger als (geplant|noetig|soll))( \w+)? (gebucht|erfasst)\b|\bwho (has |have )?(booked|logged) (too little|not enough|too few hours|nothing)\b|\bwho (hasn ?t|has not|haven ?t|have not|didn ?t|did not) (booked|logged|book|log)( enough)?\b/;
const jobOf = (q) => (TRIAGE_JOB_RE.test(q) ? 'supportTriage' : BOOKING_JOB_RE.test(q) ? 'bookingCheck' : null);
// the hours a team is short ("Wie viele Stunden fehlen Team Web in Q4?", "How many hours is team Web short?")
const SHORT_RE = /\b(fehlen|fehlt|short|missing|lack(s|ing)?|zu wenig)\b/;
const HOURS_RE = /\b(stunden|std|hours?|h|kapazitaet|capacity|leute|people|personen)\b/;
// the staffing line without the word "waterline"
const STAFF_RE = /nicht (mehr )?(voll )?besetz|(alles|alle|voll) besetzen|not (fully )?staff|can ?not staff|cannot staff|bis zu welchem rang|up to which rank|fehlen (uns )?(die )?(leute|personen|kapazitaet)|run out of (people|capacity)/;
// past the due date without "überfällig"
const LATE_RE = /ueber (dem |den |ihrem |ihren )?termin|hinter (dem )?(zeitplan|plan)\b|past (the |their )?(due|deadline)|behind (the )?schedule/;
// "Team Mobile" / "Mobile team": the word team next to a team name – team words win over a project that only shares a word
const teamSaid = (q, t) => { if (!t) return false; const n = fold(t.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp(`\\bteams? ${n}\\b|\\b${n} teams?\\b`).test(q); };

// intent of ask.js parseQuestion → the Lotse skill that answers it (with the entities found)
function fromIntent(intent, e) {
  switch (intent) {
    case 'attention': return 'today';
    case 'waterline': return 'waterline';
    case 'blocked': case 'dependencies': return 'blockers';
    case 'quality': return 'gapsFix';
    case 'support': return 'dispatchAdvice';
    case 'overdue': case 'progress': case 'maturity': case 'project': return e.project ? 'projectBrief' : 'portfolioBrief';
    case 'milestones': case 'count': case 'ranking': return 'portfolioBrief';
    case 'utilization': return e.team ? 'teamBrief' : 'realCapacity';
    case 'hours': return e.project ? 'projectBrief' : 'planActualExplain';
    case 'health': return e.project ? 'healthDraft' : 'portfolioBrief';
    case 'realCapacity': return 'realCapacity';
    case 'fitsNoOvertime': return 'fits';
    case 'overtime': return 'overtime';
    case 'similarWork': return 'estimate';
    case 'supportTopics': return 'supportTopics';
    default: return null;
  }
}

// The people's folded names and patterns, built once per people object (600 people × every question before)
const peopleCache = new WeakMap();
function peopleIndex(peopleObj) {
  let x = peopleCache.get(peopleObj);
  if (x) return x;
  const word = (w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
  x = Object.values(peopleObj).filter((p) => p?.name).map((p) => {
    const n = fold(p.name), f = n.split(' ')[0];
    return { p, full: n.length >= 4 ? word(n) : null, first: f.length >= 3 ? word(f) : null };
  });
  peopleCache.set(peopleObj, x);
  return x;
}
function findPerson(q, ctx) {
  const people = peopleIndex(dsOf(ctx).people || {});
  const full = people.find((x) => x.full && x.full.test(q));
  if (full) return full.p;
  const first = people.filter((x) => x.first && x.first.test(q));
  return first.length === 1 ? first[0].p : null;
}
// two projects / two teams for "compare A with B"
function pairs(q, model) {
  const parts = q.split(/\s(?:mit|und|vs|versus|gegen|gegenueber|with|and|to|against)\s/);
  const projects = [], teams = [];
  for (const part of parts) {
    const p = findProject(part, model);
    if (p && !projects.includes(p)) projects.push(p);
    const t = findTeam(part.replace(p ? fold(p.name) : '\u0000', ' '), model);
    if (t && !teams.includes(t)) teams.push(t);
  }
  return { projects, teams };
}

// "Rang 5 nach hinten", "Anna 10 h mehr", "Due +2 Wochen", "Team Web 40 h mehr"
export function parseChange(q0, raw, ctx, e, last) {
  const { model } = computedOf(ctx);
  const n = model.items.length;
  // number words ("zwei Wochen", "a week later") and "N more weeks" / "N Wochen länger" (tester 2026-11-16: "What if
  // Glasfaser Nord gets 2 more weeks?" was asked back – only "2 weeks" was read)
  const q = numberWords(q0);
  const hours = /([+-]?\d+(?:[.,]\d+)?)\s*(?:h|std|stunden|hours?)\b/.exec(q);
  const weeks = /([+-]?\d+)\s*(?:(?:more|extra|additional|further|weitere[nmrs]?|zusaetzliche[nmrs]?)\s+)?(?:wochen?|weeks?|wk)\b/.exec(q);
  const rankM = /(?:rang|rank|platz|#)\s*#?(\d{1,3})\b/.exec(q);
  const less = /\b(weniger|less|fewer|minus|reduz|kuerzer|shorter)\b/.test(q);
  const earlier = /\b(frueher|earlier|vorziehen|vorgezogen|eher|sooner|forward|nach vorne)\b/.test(q) || (!!weeks && less);
  const lastProject = last?.subject?.kind === 'project' && model.itemByRef.has(last.subject.ref) ? last.subject.ref : last?.params?.ref && model.itemByRef.has(last.params.ref) ? last.params.ref : null;
  if (hours && (e.person || e.team) && !weeks) {
    const v = Math.abs(+hours[1].replace(',', '.')) * (less || hours[1].startsWith('-') ? -1 : 1);
    return e.person ? { kind: 'hours', personId: e.person.id, delta: v } : { kind: 'teamHours', teamId: e.team.id, weekly: v };
  }
  // the target: "auf Rang 2", "to rank 2", "nach vorne" / "to the top" (1), "nach hinten" / "to the end" (last);
  // the project: the one named, otherwise the rank that is not the target ("Rang 6 auf Rang 2")
  const toM = /\b(?:auf|to|nach|onto|an)\s+(?:den\s+|die\s+)?(?:rang|rank|platz|position|stelle|#)\s*#?(\d{1,3})\b/.exec(q);
  const srcM = [...q.matchAll(/(?:rang|rank|platz|#)\s*#?(\d{1,3})\b/g)].find((x) => !toM || x.index < toM.index || x.index >= toM.index + toM[0].length);
  const front = /nach vorne|nach oben|ganz oben|an die spitze|to the top|to the front|move up|first\b/.test(q);
  const back = /nach hinten|nach unten|ans ende|ganz hinten|to the end|to the back|to the bottom|last\b/.test(q);
  if (toM || srcM || ((e.project || rankM) && (front || back || /priorit/.test(q)))) {
    // "das Projekt" / "this project" after a briefing: the project of the last story – never the target rank read as a
    // project ("auf Rang 1" is where it goes, not which one moves; golden BUG-3)
    const deictic = !e.projectNamed && !srcM && lastProject && DEICTIC_RE.test(q) ? model.itemByRef.get(lastProject) : null;
    const it = e.projectNamed ? e.project : srcM ? model.items.find((x) => x.rank === +srcM[1]) : deictic || e.project;
    if (it && (toM || front || back)) {
      const toRank = toM ? +toM[1] : front ? 1 : n;
      return { kind: 'rank', ref: it.ref, toRank: Math.max(1, Math.min(n, toRank)) };
    }
  }
  if (weeks || /\b(due|termin|deadline|end ?date|spaeter|later|frueher|earlier|verschieb|shift|move|push|zurueck|laenger|longer|mehr zeit|more time)\b/.test(q)) {
    const ref = e.project?.ref || lastProject;
    const w = weeks ? Math.abs(+weeks[1]) : 2;
    if (ref) return { kind: 'due', ref, weeks: earlier || weeks?.[1].startsWith('-') ? -w : w };
  }
  return null;
}

const MORE_TIME_RE = /\b\d+ (?:more|extra|additional|further|weitere[nmrs]?|zusaetzliche[nmrs]?) (?:wochen?|weeks?)\b|\b\d+ (?:wochen?|weeks?) (?:mehr|laenger|more|longer|extra|spaeter|later|frueher|earlier|zeit|time)\b|\b(?:mehr|more|extra) (?:zeit|time)\b/;
const ORDER_RE = /^(bitte |please |lotse,? )?(verschieb\w*|schieb\w*|move|shift|push|postpone|pull|leg|lege|setz\w*|set|zieh\w*)\b/;
function scenarioChange(q, raw, ctx, last) {
  if (WHATIF_RE.test(q) || ORDER_RE.test(q)) return null;
  const qn = numberWords(q);
  if (!MORE_TIME_RE.test(qn)) return null;
  const { model } = computedOf(ctx);
  const project = findProject(q, model);
  if (!project && !(last && DEICTIC_RE.test(q))) return null;
  const ch = parseChange(q, raw, ctx, { project, projectNamed: !!project, person: null, team: null }, last);
  return ch?.kind === 'due' ? ch : null;
}

export function understand(text, ctx, memory = {}) {
  const raw = String(text || '').slice(0, 500);
  const q = normalize(raw);
  const c = computedOf(ctx);
  const { model, wl } = c;
  const last = memory?.last?.skill ? memory.last : null;
  const pq = parseQuestion(raw, { model, quarters: wl.quarters });
  if (pq.intent === 'guard') return { skill: 'guard', params: {}, confidence: 'high', alternatives: [] };
  // "Glasfaser Nord gets 2 more weeks", "gib X zwei Wochen mehr", "X starts a week later": a scenario said without
  // "what if" – the what-if when a project is named (or the last story's); an instruction ("verschiebe …", "push …")
  // stays a previewed command
  const sc = scenarioChange(q, raw, ctx, last);
  if (sc) return { skill: 'whatIf', params: { change: sc }, confidence: 'high', alternatives: [] };
  // ---- actions (shared/lotse/act): a whole job or one command, routed before the questions ----
  // { kind: 'workflow'|'command'|'decide', skill: null, … } – only ever previewed, never applied here; questions,
  // scenarios ("was wäre wenn …") and follow-ups never land here (no `kind` on story results)
  const act = actRoute(raw, ctx);
  if (act) return { ...act, skill: null, params: act.params || {}, confidence: act.confidence || 'high', alternatives: [] };
  // two jobs said as an instruction / a team question: the workflow when the person may act, the story otherwise
  const job = jobOf(q);
  if (job) {
    const story = { supportTriage: 'dispatchAdvice', bookingCheck: 'planActualExplain' }[job];
    const may = job === 'supportTriage' ? can.dispatch(ctx) : can.remind(ctx);
    if (may) return { kind: 'workflow', workflow: job, params: {}, title: WORKFLOWS[job].title(ctx.lang === 'en' ? 'en' : 'de'), skill: null, confidence: 'high', alternatives: [] };
    return { skill: story, params: {}, confidence: 'medium', alternatives: [] };
  }
  const keyM = /\b([A-Z][A-Z0-9_]{1,19}-\d{1,9})\b/.exec(raw);
  const { projects, teams } = pairs(q, model);
  const e = {
    project: projects[0] || pq.project || null, projectNamed: projects.length > 0 && !!findProject(q.replace(RANK_REF_RE, ' '), model), team: teams[0] || null, person: findPerson(q, ctx),
    quarter: pq.quarter, key: keyM ? keyM[1] : null, mine: MINE_RE.test(q),
  };
  if (!e.team && pq.team && !(e.project && fold(e.project.name).includes(fold(pq.team.name)))) e.team = pq.team;
  // "Lagebild Team Mobile": the team is said as a team, the project "Mobile App 2.0" only shares a word with it –
  // the team wins unless the project's full name is in the question (golden BUG-1)
  if (e.team && e.project && teamSaid(q, e.team) && !q.includes(fold(e.project.name)) && !(e.key && e.project.key === e.key)) {
    const drop = e.project;
    e.project = null; e.projectNamed = false;
    const i = projects.indexOf(drop);
    if (i >= 0) projects.splice(i, 1);
    if (pq.intent === 'project') pq.intent = 'utilization';
  }
  if (e.key && !e.project) { const it = model.items.find((x) => x.key === e.key); if (it) e.project = it; }
  const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined));
  const result = (skill, params, confidence, alternatives = []) => ({ skill, params: clean(params), confidence, alternatives });

  // ---- follow-ups ----
  // "warum?" explains the last answer – but "Warum ist Glasfaser Nord spät?" names its own subject: answer that
  // (live finding 2026-11-12: a first question starting with "why" got "ask something first")
  const namesSubject = !!(e.projectNamed || e.project || e.team || e.key || e.person);
  const hits = Object.values(SKILLS).filter((sk) => sk.id !== 'why' && sk.id !== 'whatIf' && sk.match.some((re) => re.test(q)));
  // … and "Warum wurde weniger gebucht als geplant?" asks a topic of its own (a skill matches it): answer that
  if (WHY_RE.test(q) && q.split(' ').length <= 7 && !namesSubject && !hits.length) return result('why', last ? { skill: last.skill, params: last.params || {} } : {}, last ? 'high' : 'low');
  if (WHATIF_RE.test(q) || (/^(und )?(wenn|if)\b/.test(q) && last)) {
    const change = parseChange(q, raw, ctx, e, last);
    return result('whatIf', change ? { change } : {}, change ? 'high' : 'low');
  }
  const words = q.split(' ').filter((w) => !STOP.has(w));
  // a short question without a topic of its own continues the last one ("Team Web?"); one with a topic starts fresh
  const isFollow = last && (FOLLOW_RE.test(q) || (words.length <= 3 && !hits.length));
  if (isFollow) {
    const sk = SKILLS[last.skill];
    const p0 = { ...(last.params || {}) };
    if (NEXTQ_RE.test(q) || e.quarter) {
      const base = p0.quarter || wl.quarters[0];
      const quarter = e.quarter || (wl.quarters.includes(shiftQuarter(base, 1)) ? shiftQuarter(base, 1) : wl.quarters[1]);
      return result('waterline', { ...(p0.team ? { team: p0.team } : last.subject?.kind === 'team' ? { team: last.subject.ref } : {}), quarter }, 'high');
    }
    if (e.team && !e.project) return result(sk?.params.includes('team') ? last.skill : 'teamBrief', { ...(sk?.params.includes('team') ? p0 : {}), team: e.team.id, ref: undefined }, 'high');
    if (e.project) return result(sk?.params.includes('project') ? last.skill : 'projectBrief', { ...(sk?.params.includes('project') ? p0 : {}), ref: e.project.ref, team: undefined }, 'high');
    if (e.person && last.skill === 'myWeek') return result('myWeek', { person: e.person.id }, 'medium');
  }

  // ---- fresh question: score every skill ----
  const intentSkill = fromIntent(pq.intent, e);
  const scores = new Map();
  const add = (id, v) => scores.set(id, (scores.get(id) || 0) + v);
  for (const sk of Object.values(SKILLS)) for (const re of sk.match) if (re.test(q)) add(sk.id, 10);
  // phrases an admin approved after the AI mapped them (shared/lotse/learn.js; ctx.learned = approved patterns only)
  const learned = ctx?.learned?.length ? learnedSkill(raw, ctx) : null;
  if (learned && SKILLS[learned.skill]) add(learned.skill, learned.score === 1 ? 16 : 12);
  if (intentSkill) add(intentSkill, pq.intent === 'project' ? 2 : 6); // 'project' = a project named, no topic
  if (projects.length >= 2 || teams.length >= 2) add('compare', /vergleich|compare|vs|versus|gegen|unterschied|difference/.test(q) ? 8 : 0);
  if (e.mine && /woche|week|gebucht|booked|buchung|stunden|hours|aufgaben|tasks/.test(q)) add('myWeek', 6);
  if (/\bteams?\b/.test(q) && e.team) add('teamBrief', 2);
  if (/blockier|blocked|blocker|blockade|\bblocks?\b/.test(q)) add('blockers', 8);
  // a work item key on its own, or with where / when / status (tester 2026-11-17: "PCX-45" answered "no similar finished
  // work") → where and when it is planned; "schätze wie früher: PCX-45" still estimates
  if (e.key && (dsOf(ctx).issues || []).some((x) => x.key === e.key) && !model.items.some((x) => x.key === e.key)
    && (words.length <= 2 || /\b(wo steht|wo ist|wann|stand|status|where|when|eingeplant|geplant|planned)\b/.test(q)) && !/schaetz|estimat|aehnlich|similar|wie frueher|like before/.test(q)) add('ticket', 24);
  // the year ahead ("check the year plan for conflicts", "Jahresprognose prüfen") → the year check, whatever it looks for
  if (/jahres(plan|prognose|check|ausblick|vorschau|sicht)|year[- ]?(plan|projection|ahead|outlook|check)|(next|coming|naechste[nr]?|kommende[nr]?) (12|twelve|zwoelf) (months|monate)/.test(q)) add('yearCheck', 14);
  // the hours a named team is short → its briefing (capacity minus demand), not data gaps or plan vs. actual
  if (e.team && !e.project && SHORT_RE.test(q) && HOURS_RE.test(q)) add('teamBrief', 14);
  // the staffing line in other words, and "late" projects without "überfällig"
  if (!e.team && !e.project && STAFF_RE.test(q)) add('waterline', 12);
  if (!e.project && LATE_RE.test(q)) add('portfolioBrief', 10);
  // my own bookings / my week said with "ich" or "mir" → my week, not today's briefing or the data gaps
  if ((e.mine || SELF_RE.test(q)) && !e.project && !e.team && MY_WORK_RE.test(q) && !/blockier|blocked|\bblocks?\b/.test(q)) add('myWeek', 14);
  if (/\b(mein|meinem|my) team\b/.test(q)) add('teamBrief', 8);
  if (/health|status ?update|statusbericht|status report|ampel/.test(q)) add('healthDraft', 5);
  // a project briefing needs a project, a team briefing a team (or "my team")
  if (!e.project && scores.has('projectBrief')) add('projectBrief', -4);
  if (!e.team && !e.mine && scores.has('teamBrief')) add('teamBrief', -4);
  // entity fit: a skill about projects needs a project, about teams a team
  for (const [id, v] of scores) {
    const ps = SKILLS[id]?.params || [];
    if (e.project && ps.includes('project')) scores.set(id, v + 3);
    if (e.team && ps.includes('team')) scores.set(id, v + 3);
    if (id === 'compare' && projects.length < 2 && teams.length < 2) scores.set(id, v - 12);
    if ((id === 'why' || id === 'whatIf') && v < 20) scores.delete(id);
  }
  // the project / team skills win over the portfolio ones once an entity is named
  if (e.project && scores.has('portfolioBrief') && !scores.has('projectBrief')) add('projectBrief', (scores.get('portfolioBrief') || 0) + 1);
  if (e.team && scores.has('realCapacity') && scores.get('realCapacity') <= 16 && !/realistisch|realistic/.test(q)) add('teamBrief', 1);
  let ranked = [...scores].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  let skill = ranked[0]?.[0] || null;
  let confidence = ranked[0] ? (ranked[0][1] >= 16 ? 'high' : 'medium') : 'low';
  if (!skill) {
    if (projects.length >= 2 || teams.length >= 2) skill = 'compare';
    else if (e.project) skill = 'projectBrief';
    else if (e.team) skill = 'teamBrief';
    else if (e.key) skill = 'ticket'; // a bare key: where and when it is planned (tester 2026-11-17), estimating is a follow-up
    // a lone "mir" is no topic ("Erzähl mir einen Witz" → help, not my week; golden BUG-2) – only "meine?" / "und ich?"
    else if (e.mine && words.length <= 2) skill = 'myWeek';
    confidence = skill ? 'medium' : 'low';
  }
  const paramsFor = (id) => {
    const P = {};
    const ps = SKILLS[id]?.params || [];
    if (id === 'compare') { if (projects.length >= 2) P.refs = projects.slice(0, 2).map((x) => x.ref); else if (teams.length >= 2) P.teams = teams.slice(0, 2).map((x) => x.id); return P; }
    if (id === 'ticket') { if (e.key) P.key = e.key; return P; }
    if (id === 'estimate') { if (e.key) P.key = e.key; else P.text = wishSubject(raw) || raw; if (e.team) P.team = e.team.id; return P; }
    if (id === 'similarSummary') { if (e.key) P.key = e.key; else P.text = (raw.includes(':') ? raw.slice(raw.indexOf(':') + 1).trim() : '') || wishSubject(raw) || raw; return P; }
    if (id === 'whatIf') { const change = parseChange(q, raw, ctx, e, last); return change ? { change } : {}; }
    if (id === 'why') return last ? { skill: last.skill, params: last.params || {} } : {};
    if (id === 'myWeek') { if (e.person && !e.mine) P.person = e.person.id; return P; }
    if (ps.includes('project') && e.project) P.ref = e.project.ref;
    else if (ps.includes('project') && !e.team && last?.subject?.kind === 'project' && model.itemByRef.has(last.subject.ref) && DEICTIC_RE.test(q)) P.ref = last.subject.ref;
    if (ps.includes('team') && e.team) P.team = e.team.id;
    else if (ps.includes('team') && e.mine && !e.project) P.mine = true;
    if (ps.includes('quarter') && e.quarter) P.quarter = e.quarter;
    if (id === 'blockers' && e.mine && !e.project) P.mine = true;
    if (id === 'supportTopics' && /playbook|hilfe ?artikel|help ?article|standard/.test(q)) P.playbook = true;
    if ((id === 'healthDraft') && !P.ref) P.any = true;
    if (id === 'teamBrief' && !P.team && !P.mine) P.any = true;
    return P;
  };
  const alternatives = ranked.filter(([id]) => id !== skill).slice(0, 3).map(([id]) => ({ skill: id, params: paramsFor(id), label: SKILLS[id].title(ctx.lang === 'en' ? 'en' : 'de') }));
  const out = result(skill, skill ? paramsFor(skill) : {}, confidence, alternatives);
  return learned && skill === learned.skill ? { ...out, learned: true } : out;
}

// What the next question needs to know about this answer (follow-ups).
export function remember(story) {
  if (!story?.skill) return {};
  const u = story.understood || { skill: story.skill, params: {} };
  // "warum?" explains – the conversation stays on the story it explained
  if (u.skill === 'why' && u.params?.skill) return { last: { skill: u.params.skill, params: u.params.params || {}, subject: story.subject, id: story.id } };
  return { last: { skill: u.skill, params: u.params || {}, subject: story.subject, id: story.id } };
}
