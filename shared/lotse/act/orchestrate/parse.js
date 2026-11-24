// Lotse orchestration – understanding a free-form job ("Auftrag"): what to check, for whom, over which weeks, and what
// to hand back. Deterministic, DE + EN, any word order, typos tolerated (ask.js fixTypos + a small own vocabulary).
//
//   parseJob(text, ctx) → job = {
//     v: 1, text, lang,
//     scope:    { kind: 'project'|'team'|'myTeam'|'person'|'portfolio', ref, name } | null      (null = not said → decide)
//     subjects: 'people'|'teams'|'projects'|'person'                 what Lotse iterates over (one section each)
//     blocks:   ['weeks','bookings','tasks','overdue','absences','risks','progress','planActual','support']
//     window:   { past: 0–12, next: 0–12, label: [de, en], stated: bool }    weeks before / from this week on
//     format:   'pdfAll' | 'pdfEach' | 'text'                         one PDF (a section per subject) · plus one PDF each · text only
//     audience: 'colleagues'|'management'|'teamLeads'|'owners', tone: 'friendly'|'formal'
//     personal: bool                                                  a personal section + message per subject
//     said:     { scope, subjects, blocks, window, format, audience, tone }   what the sentence itself said (the rest = defaults)
//     ambiguous: [{ part, options }]                                  e.g. two projects named → a decide step
//   }
//   jobScore(text, ctx) → { score, job: bool, why: [] }   is this sentence a job for the orchestrator (route.js uses it)
//
// Nothing here guesses silently: a part the sentence does not say is filled with a stated default (`said[part]` false),
// and the workflow asks for the scope when it is missing or ambiguous.
import { fold, fixTypos, findProject, findTeam } from '../../../ask.js';
import { numberWords } from '../../numbers.js';
import { mondayOf } from '../../../dates.js';
import { computedOf, dsOf, T, langOf, meId } from '../kit.js';

export const BLOCKS = ['weeks', 'bookings', 'tasks', 'overdue', 'absences', 'risks', 'progress', 'planActual', 'support'];
export const BLOCK_NAMES = {
  weeks: ['Arbeitswochen (Last je Woche)', 'Work weeks (load per week)'],
  bookings: ['Buchungen gegen Soll', 'Bookings vs. target'],
  tasks: ['Aufgaben je Person', 'Tasks per person'],
  overdue: ['Überfälliges und Blockiertes', 'Overdue and blocked'],
  absences: ['Abwesenheiten und Feiertage', 'Absences and holidays'],
  risks: ['Risiken und Vorschläge', 'Risks and suggestions'],
  progress: ['Fortschritt', 'Progress'],
  planActual: ['Plan vs. Ist', 'Plan vs. actual'],
  support: ['Support-Last', 'Support load'],
};
// which blocks make sense per kind of subject
export const BLOCKS_FOR = {
  people: ['weeks', 'bookings', 'tasks', 'overdue', 'absences', 'risks', 'planActual', 'support'],
  person: ['weeks', 'bookings', 'tasks', 'overdue', 'absences', 'risks', 'planActual', 'support'],
  teams: ['weeks', 'overdue', 'absences', 'risks', 'support', 'bookings'],
  projects: ['progress', 'overdue', 'tasks', 'weeks', 'risks'],
};
export const DEFAULT_BLOCKS = {
  people: ['weeks', 'tasks', 'absences', 'risks'],
  person: ['weeks', 'tasks', 'absences', 'risks'],
  teams: ['weeks', 'overdue', 'risks'],
  projects: ['progress', 'overdue', 'risks'],
};
export const FORMATS = ['pdfAll', 'pdfEach', 'text'];
export const AUDIENCES = ['colleagues', 'management', 'teamLeads', 'owners'];
export const TONES = ['friendly', 'formal'];
export const MAX_WEEKS = 12;

// own vocabulary for typo repair (edit distance 1, words of 5+ letters)
const VOCAB = ['arbeitswochen', 'kollegen', 'kolleginnen', 'kollegin', 'colleagues', 'colleague', 'personalized', 'personalised', 'persoenlichen', 'persoenlich', 'bericht', 'berichte',
  'zusammenfassen', 'zusammenfassung', 'summarise', 'summarize', 'summary', 'auslastung', 'buchungen', 'abwesenheiten', 'urlaub', 'feiertage', 'ueberfaellige', 'overdue', 'aufgaben',
  'projekte', 'projects', 'project', 'projekt', 'prepare', 'bereite', 'vorbereiten', 'jeden', 'jedes', 'every', 'teamleitungen', 'teamleitung', 'owners', 'risiken', 'risks', 'fortschritt',
  'progress', 'support', 'wochen', 'weeks', 'nachricht', 'notiz', 'message', 'management', 'compare', 'vergleiche', 'workload', 'utilisation', 'utilization'];
function lev1(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
const repair = (q) => q.split(' ').map((w) => (w.length >= 5 && !VOCAB.includes(w) ? VOCAB.find((k) => lev1(w, k)) || w : w)).join(' ');
// own vocabulary first (ask.js would turn "project" into "projects"), then ask.js's typo repair for the other words
export const jobText = (text) => numberWords(repair(fold(String(text || '').slice(0, 500)).replace(/[?!.,;:„“"”()]+/g, ' ').replace(/\s+/g, ' ').trim())
  .split(' ').map((w) => (VOCAB.includes(w) ? w : fixTypos(w))).join(' '));

// ---------- the vocabulary ----------
const R = {
  output: /\bpdfs?\b|\bdokument\w*|\bdocument\w*|\bausdruck|\bprint\w*|\bbericht\w*|\breports?\b|\bzusammenfass\w*|\bsummar(y|ies|i[sz]e\w*)\b|\bnotiz\w*|\bnotes?\b|\bnachricht\w*|\bmessages?\b|\be-?mails?\b|\bmails?\b|\banschreiben\b|\bbriefing\w*\b|\buebersicht als\b|\boverview (for|as)\b|\bhandout\w*|\bunterlage\w*|\b(their|ihre|seine|deren|eigenen) (own )?(numbers|zahlen|werte|figures)\b/,
  pdf: /\bpdfs?\b|\bdokument\w*|\bdocument\w*|\bausdruck\w*|\bprint\w*|\bdatei\b|\bfile\b|\bhandout\w*|\bunterlage\w*/,
  notes: /\bnotiz\w*|\bnotes?\b|\bnachricht\w*|\bmessages?\b|\be-?mails?\b|\bmails?\b|\banschreiben\b|\bzeilen\b|\bschreib\w*|\bdraft\w*\b|\bentw(u|ue)rf\w*/,
  summary: /\bzusammenfass\w*|\bsummar(y|ies|i[sz]e\w*)\b|\bueberblick\b|\bueberbl\w*|\btext\b|\bnur text\b|\btext only\b/,
  pdfEach: /\b(je|pro|per|for each|each|einzelne?[ns]?|eigene?[ns]?|separate?|own|individuelle?[ns]?|jeweils)\s+(\w+\s+){0,2}pdfs?\b|\bpdfs?\s+(je|pro|per|for each|fuer jede[nrms]?)\b|\bpdfs? (je|pro|per) (person|kolleg\w*|colleague|team|projekt|project)\b/,
  textOnly: /\b(nur|only|just|blo(ss|ß))\b.{0,12}\b(text|als text|zusammenfass\w*|summar\w*)\b|\bohne pdf\b|\bno pdf\b|\btext only\b/,
  iterate: /\bfuer jede[nrms]?\b|\ban jede[nrms]?\b|\bjede[nrms]? (einzelne[nrms]? )?(person|kolleg\w*|mitarbeit\w*|team|projekt|owner\w*)\b|\bje(weils)?\b|\bpro (person|kolleg\w*|teams?|projekte?|mitarbeit\w*)\b|\bper (person|colleagues?|teams?|projects?)\b|\b(each|every)\b|\balle[nrms]? (kolleg\w*|leute|personen|mitarbeit\w*|teams?|projekte?|owner\w*)\b|\ball (the )?(colleagues|people|team members|teams|projects|owners)\b|\beinzeln\w*\b|\bindividuell\w*\b|\bindividual\w*\b/,
  personal: /\bpersoenlich\w*|\bpersonal\w*|\bpersonali[sz]\w*|\bindividuell\w*|\bindividual\w*|\bfuer jede[nrm]? (kolleg\w*|person|mitarbeit\w*)\b|\bfor each (colleague|person|of them|team member)\b|\bje person\b|\bpro person\b|\bper person\b|\bjeweils\b/,
  verb: /\b(pruef\w*|check\w*|sammle\w*|collect\w*|gather\w*|stell\w* .{0,40}zusammen|compil\w*|prepar\w*|bereite?\w* .{0,80}\bvor\b|vorbereiten|erstell\w*|create\w*|pack\w*|arrange\w*|fass\w* .{0,60}zusammen|summari[sz]\w*|vergleich\w*|compar\w*|draft\w*|schreib\w*|write|analys\w*|analyz\w*|durchleucht\w*|go through|look at|schau\w*|build|baue?|make|mach\w*|give|gib|send|schick\w*)\b/,
  // the data blocks
  weeks: /\barbeitswoche\w*|\bwochen\w*|\bweeks?\b|\bweekly\b|\bauslastung\w*|\bwork ?load\w*|\bload\b|\bkapazitaet\w*|\bcapacity\b|\butili[sz]ation\b|\bverfuegbar\w*|\bavailab\w*|\bgeplant\w*|\bplanned\b|\bworker weeks\b/,
  bookings: /\bbuchung\w*|\bgebucht\w*|\bbooked\b|\bbookings?\b|\bzeiterfassung\w*|\btime ?sheets?\b|\blogged\b|\bworklogs?\b|\bstunden erfasst\b|\bgeleistet\w*/,
  tasks: /\baufgabe\w*|\btasks?\b|\bstor(y|ies)\b|\bvorgaeng\w*|\bvorgang\b|\barbeitspaket\w*|\bwork items?\b|\bto-?dos?\b|\btickets?\b/,
  overdue: /\bueberfaellig\w*|\boverdue\b|\bverspaet\w*|\bzu spaet\b|\blate\b|\bblockiert\w*|\bblocked\b|\bblocker\w*|\bblockade\w*|\bhinter dem (plan|zeitplan)\b|\bbehind schedule\b/,
  absences: /\babwesen\w*|\burlaub\w*|\babsen(ce|ces|t)\b|\bvacation\w*|\bholidays?\b|\bfeiertag\w*|\bkrank\w*|\bleave\b|\bfrei(e tage)?\b|\btime off\b/,
  risks: /\brisik\w*|\brisks?\b|\bprobleme?\b|\bproblems?\b|\bengpa(ss|esse)\w*|\bbottlenecks?\b|\bwarnung\w*|\bwarnings?\b|\bueberlast\w*|\boverload\w*|\bvorschlae?ge?\w*|\bsuggestions?\b|\bempfehlung\w*|\brecommendations?\b/,
  progress: /\bfortschritt\w*|\bprogress\b|\bstatus\b|\bstand\b|\bwie weit\b|\bhealth\b/,
  planActual: /\bplan (vs\.?|versus|gegen|und|zu|oder) ist\b|\bplan vs\.? actual\b|\bplan versus actual\b|\bsoll.?ist\b|\bplanned vs\.? (actual|booked)\b|\bist-?zahlen\b|\bactuals?\b|\bplan and actual\b/,
  support: /\bsupport\w*|\bsla\b|\bservice ?desk\b|\bhelp ?desk\b|\bkundenanfrage\w*/,
  // subjects
  people: /\bkolleg\w*|\bmitarbeit\w*|\bleute\b|\bpersonen\b|\bperson\b|\bpeople\b|\bcolleagues?\b|\beveryone\b|\bteam ?mitglied\w*|\bteam members?\b|\bmembers?\b|\bworkers?\b|\bstaff\b|\barbeitswoche\w*|\bworker weeks\b|\beach of them\b|\bjede[nrm]? einzelne[nrm]?\b|\bmenschen\b|\bbeteiligte\w*|\bengineers?\b|\bentwickler\w*/,
  teams: /\b(jedes|jede[sn]?|je|pro|per|each|every|alle|all( the)?)\s+teams?\b|\bteamleit\w*|\bteam ?leads?\b|\bteamleiter\w*|\bleads? of (each|every|the) team\b/,
  projects: /\b(jedes|jede[sn]?|je|pro|per|each|every|alle|all( the)?)\s+(projekt\w*|projects?)\b|\bprojekt-?owner\w*|\bproject owners?\b|\bprojektleit\w*|\bproject (leads?|managers?)\b/,
  myTeam: /\b(mein|meinem|meines|meinen|my)\s+teams?\b|\bmeine leute\b|\bmy people\b|\bmeine kolleg\w*|\bmy colleagues\b|\bmein(em)? team\b/,
  portfolio: /\bportfolio\b|\balle[nrms]? (projekte|teams)\b|\b(every|all( the)?) (projects|teams)\b|\bjede[sn]? (projekt|team)\b|\b(each|every) (project|team)\b|\bganze[nrms]? (firma|unternehmen|organisation)\b|\bwhole (company|organi[sz]ation)\b/,
  // audience and tone
  aColleagues: /\bkolleg\w*|\bcolleagues?\b|\bteam ?mitglied\w*|\bteam members?\b|\bmitarbeitende\w*|\bfuer (die|ihre|seine|meine) leute\b|\bfor (their|my|the) (team|people)\b|\bfor each (of them|person)\b/,
  aManagement: /\bmanagement\b|\bgeschaeftsfuehrung\b|\bvorstand\w*|\bboard\b|\bbereichsleit\w*|\bchef\w*|\bboss\b|\bexecutives?\b|\bfuehrungskr\w*|\bleadership\b|\bdirector\w*|\bc-?level\b/,
  aTeamLeads: /\bteamleit\w*|\bteam ?leads?\b|\bteamleiter\w*|\bleads? of (each|every|the) team\b/,
  aOwners: /\bowner\w*|\bprojektleit\w*|\bproject (leads?|managers?)\b|\bverantwortlich\w*|\bresponsible\b/,
  formal: /\bformell\w*|\bformal\w*|\bsie-?form\b|\bsiezen\b|\bfoermlich\w*|\bsachlich\w*|\bneutral\w*|\bbusiness\b|\bprofessionell\w*|\bprofessional\b/,
  friendly: /\blocker\w*|\binformell\w*|\binformal\b|\bcasual\w*|\bfreundlich\w*|\bfriendly\b|\bdu-?form\b|\bduzen\b|\bmotivier\w*|\bencourag\w*|\bwertschaetz\w*|\bwarm\w*|\bnett\w*|\bkind\b|\bpositive?\b/,
};
// other jobs Lotse has a workflow of its own for – never taken over by the orchestrator
const OTHER_JOB = /\bc-?level\b|\bmanagement-?report\b|\bvorstandsbericht\b|\bboard report\b|\bexecutive report\b|\bweekly\b(?! (load|report|pdf))|\bhealth-?runde\b|\bhealth round\b|\btriage\b|\bplaybooks?\b|\b(auf|at|to) 100 ?%|\bueberlast\w* (aufloesen|loesen|abbauen)\b|\bresolve (the )?overload\b|\bre-?rank\w*\b|\bfuell\w* .{0,30}luecke\w*|\bfill .{0,20}gaps\b/;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function personIn(q, ctx) {
  const ps = Object.values(dsOf(ctx).people || {}).filter((p) => p?.name);
  const word = (w) => new RegExp(`(^|[^a-z0-9])${esc(w)}('?s)?([^a-z0-9]|$)`);
  const full = ps.find((p) => word(fold(p.name)).test(q));
  if (full) return full;
  const first = ps.filter((p) => { const f = fold(p.name).split(' ')[0]; return f.length >= 3 && word(f).test(q); });
  return first.length === 1 ? first[0] : null;
}
const myTeamOf = (ctx) => {
  const ds = dsOf(ctx);
  const me = meId(ctx);
  if (!me) return null;
  const cap = ds.capacity || {};
  const lead = Object.entries(cap.teams || {}).find(([, t]) => (t?.responsible || []).includes(me))?.[0];
  return lead || cap.people?.[me]?.teamId || null;
};

// "die nächsten 8 Wochen", "last 4 weeks", "this quarter", "diesen Monat" → { past, next, label, stated }
export function parseWindow(q, today, { bookings = false } = {}) {
  const clamp = (n) => Math.max(1, Math.min(MAX_WEEKS, n));
  const lbl = (de, en) => [de, en];
  const both = /\b(letzte[nrms]?|vergangene[nrms]?|past|last|previous)\s+(\d{1,2})\s+(?:(?:wochen?|weeks?)\s+)?(?:und|and|plus|sowie)\s+(?:die\s+|the\s+)?(naechste[nrms]?|kommende[nrms]?|next|coming)\s+(\d{1,2})\s+(wochen?|weeks?)\b/.exec(q);
  if (both) { const p = clamp(+both[2]), n = clamp(+both[4]); return { past: p, next: n, stated: true, label: winLabel(p, n) }; }
  let m = /\b(naechste[nrms]?|kommende[nrms]?|folgende[nrms]?|next|coming|upcoming|following)\s+(\d{1,2})\s+(wochen?|weeks?|kw)\b/.exec(q) || /\b(\d{1,2})\s+(wochen?|weeks?)\s+(voraus|ahead|im voraus)\b/.exec(q);
  const next = m ? clamp(+(m[2] && /^\d/.test(m[2]) ? m[2] : m[1])) : null;
  m = /\b(letzte[nrms]?|vergangene[nrms]?|zurueckliegende[nrms]?|past|last|previous|recent)\s+(\d{1,2})\s+(wochen?|weeks?|kw)\b/.exec(q);
  const past = m ? clamp(+m[2]) : null;
  if (next != null || past != null) {
    const p = past ?? (bookings && next == null ? 4 : 0), n = next ?? (past != null ? 0 : 8);
    return { past: p, next: n, stated: true, label: winLabel(p, n) };
  }
  const monday = mondayOf(today);
  const d = new Date(today * 864e5);
  const y = d.getUTCFullYear(), mo = d.getUTCMonth();
  const weeksBetween = (a, b) => Math.max(0, Math.floor((b - a) / 7));
  const qStart = Math.floor(Date.UTC(y, Math.floor(mo / 3) * 3, 1) / 864e5), qEnd = Math.floor(Date.UTC(y, Math.floor(mo / 3) * 3 + 3, 1) / 864e5) - 1;
  const mStart = Math.floor(Date.UTC(y, mo, 1) / 864e5), mEnd = Math.floor(Date.UTC(y, mo + 1, 1) / 864e5) - 1;
  if (/\b(diese[nrms]?|this|current|laufende[nrms]?|aktuelle[nrms]?)\s+(quartal\w*|quarter)\b/.test(q)) {
    const p = Math.min(MAX_WEEKS, Math.round((monday - mondayOf(qStart)) / 7)), n = clamp(weeksBetween(monday, qEnd) + 1);
    return { past: p, next: n, stated: true, label: lbl('dieses Quartal', 'this quarter') };
  }
  if (/\b(naechste[nrms]?|next|kommende[nrms]?)\s+(quartal\w*|quarter)\b/.test(q)) return { past: 0, next: MAX_WEEKS, stated: true, label: lbl('die nächsten 12 Wochen (nächstes Quartal)', 'the next 12 weeks (next quarter)') };
  if (/\b(diese[nrms]?|this|current|laufende[nrms]?)\s+(monat\w*|month)\b|\bim (november|dezember|oktober)\b/.test(q)) {
    const p = Math.min(MAX_WEEKS, Math.round((monday - mondayOf(mStart)) / 7)), n = clamp(weeksBetween(monday, mEnd) + 1);
    return { past: p, next: n, stated: true, label: lbl('diesen Monat', 'this month') };
  }
  if (/\b(letzte[nrms]?|vergangene[nrms]?|last|previous|past)\s+(monat\w*|month)\b/.test(q)) return { past: 4, next: 0, stated: true, label: lbl('die letzten 4 Wochen (letzter Monat)', 'the last 4 weeks (last month)') };
  if (/\b(diese|this|current|laufende)\s+(woche|week)\b|\bheute\b|\btoday\b/.test(q)) return { past: 0, next: 1, stated: true, label: lbl('diese Woche', 'this week') };
  if (/\b(naechste|next|kommende)\s+(woche|week)\b/.test(q)) return { past: 0, next: 2, stated: true, label: lbl('diese und nächste Woche', 'this and next week') };
  m = /\b(\d{1,2})\s+(wochen?|weeks?)\b/.exec(q);
  if (m) { const n = clamp(+m[1]); return { past: bookings ? Math.min(4, n) : 0, next: n, stated: true, label: winLabel(bookings ? Math.min(4, n) : 0, n) }; }
  return { past: 4, next: 8, stated: false, label: winLabel(4, 8) };
}
export function winLabel(past, next) {
  if (past && next) return [`die letzten ${past} und die nächsten ${next} Wochen`, `the last ${past} and the next ${next} weeks`];
  if (past) return [`die letzten ${past} Wochen`, `the last ${past} weeks`];
  return next === 1 ? ['diese Woche', 'this week'] : [`die nächsten ${next} Wochen`, `the next ${next} weeks`];
}

// How much the sentence looks like a job for the orchestrator (an output for people, built from several data blocks).
export function jobScore(text, ctx) {
  const q = jobText(text);
  const why = [];
  let s = 0;
  const out = R.output.test(q);
  if (out) { s += 2; why.push('output'); }
  const it = R.iterate.test(q) || R.personal.test(q);
  if (it) { s += 2; why.push('iterate'); }
  const blocks = BLOCKS.filter((b) => R[b].test(q));
  s += Math.min(2, blocks.length);
  if (blocks.length) why.push(`blocks:${blocks.length}`);
  if (R.verb.test(q)) { s += 1; why.push('verb'); }
  const { model } = computedOf(ctx);
  const scoped = !!(findProject(q, model) || findTeam(q, model) || R.myTeam.test(q) || R.portfolio.test(q) || R.people.test(q) || R.projects.test(q) || R.teams.test(q) || personIn(q, ctx));
  if (scoped) { s += 1; why.push('scope'); }
  const other = OTHER_JOB.test(q);
  // a job: something to hand back (a PDF, notes, a summary …) for several subjects or from several blocks
  const job = !other && out && blocks.length >= 1 && (it || blocks.length >= 2 || scoped) && s >= 5;
  return { score: s, job, why, other };
}
export const isJob = (text, ctx) => jobScore(text, ctx).job;

export function parseJob(text, ctx) {
  const L = langOf(ctx);
  const raw = String(text || '').slice(0, 500);
  const q = jobText(raw);
  const { model } = computedOf(ctx);
  const ds = dsOf(ctx);
  const said = {};
  const ambiguous = [];
  // ---- scope ----
  let scope = null;
  const projects = model.items.filter((p) => { const n = fold(p.name); return n.length >= 3 && q.includes(n); });
  let project = projects.length > 1 ? null : findProject(q, model);
  // "team Mobile" is the team, not "Mobile App 2.0" – unless the project's full name is in the sentence (golden BUG-1)
  const team0 = findTeam(q, model);
  if (project && team0 && new RegExp(`\\bteams? ${esc(fold(team0.name))}\\b|\\b${esc(fold(team0.name))}[- ]?teams?\\b`).test(q) && !q.includes(fold(project.name))) project = null;
  if (projects.length > 1) ambiguous.push({ part: 'scope', options: projects.map((p) => ({ kind: 'project', ref: p.ref, name: p.name })) });
  const qNoProject = project ? q.split(fold(project.name)).join(' ') : q;
  const team = findTeam(qNoProject, model);
  const teamSaid = team && new RegExp(`\\bteams? ${esc(fold(team.name))}\\b|\\b${esc(fold(team.name))}[- ]?teams?\\b`).test(qNoProject);
  const person = personIn(qNoProject, ctx);
  if (project) scope = { kind: 'project', ref: project.ref, name: project.name };
  else if (team && (teamSaid || !person)) scope = { kind: 'team', ref: team.id, name: team.name };
  else if (person && !R.people.test(q.replace(fold(person.name), ' '))) scope = { kind: 'person', ref: person.id, name: person.name };
  else if (R.myTeam.test(q)) { const t = myTeamOf(ctx); scope = t && model.teams.has(t) ? { kind: 'myTeam', ref: t, name: model.teams.get(t).name } : null; if (!scope) ambiguous.push({ part: 'scope', reason: 'noTeam', options: [] }); }
  else if (R.portfolio.test(q)) scope = { kind: 'portfolio', ref: null, name: 'Portfolio' };
  else if (person) scope = { kind: 'person', ref: person.id, name: person.name };
  said.scope = !!scope;
  // ---- subjects ----
  let subjects = null;
  if (R.teams.test(q) && !(scope?.kind === 'team' || scope?.kind === 'myTeam')) subjects = 'teams';
  else if (R.projects.test(q) && scope?.kind !== 'project') subjects = 'projects';
  else if (scope?.kind === 'person') subjects = 'person';
  else if (R.people.test(q) || scope?.kind === 'project' || scope?.kind === 'team' || scope?.kind === 'myTeam') subjects = 'people';
  said.subjects = !!subjects && (R.people.test(q) || R.teams.test(q) || R.projects.test(q) || scope?.kind === 'person');
  if (!subjects) subjects = scope?.kind === 'portfolio' ? 'teams' : 'people';
  if ((subjects === 'teams' || subjects === 'projects') && !scope) scope = { kind: 'portfolio', ref: null, name: 'Portfolio' };
  // ---- blocks ----
  const allowed = BLOCKS_FOR[subjects];
  let blocks = BLOCKS.filter((b) => R[b].test(q) && allowed.includes(b));
  // "Arbeitswochen" / "weeks" for people also means their bookings in the past weeks; "summarise the support load" is support
  if (blocks.includes('weeks') && /\b(letzte|vergangene|past|last|previous)\b/.test(q) && allowed.includes('bookings') && !blocks.includes('bookings')) blocks.push('bookings');
  if (/\bsupport-?(last|load|aufwand|zeit)\b|\bsupport (last|load)\b/.test(q) && blocks.includes('weeks') && !R.weeks.test(q.replace(/\bsupport-?(last|load)\b|\bload\b/g, ' '))) blocks = blocks.filter((b) => b !== 'weeks');
  said.blocks = blocks.length > 0;
  const saidBlocks = [...blocks];
  if (!blocks.length) blocks = [...DEFAULT_BLOCKS[subjects]];
  // "Arbeitswochen prüfen" / "check the worker weeks" of people: a work week is its load, its tasks and who is away –
  // Lotse adds those (shown as added in the plan, the person can remove them)
  if ((subjects === 'people' || subjects === 'person') && saidBlocks.length && saidBlocks.every((b) => b === 'weeks' || b === 'risks') && saidBlocks.includes('weeks')) blocks.push('tasks', 'absences');
  // risks and suggestions always close a section (they are what the person acts on)
  if (allowed.includes('risks') && !blocks.includes('risks')) blocks.push('risks');
  blocks = BLOCKS.filter((b) => blocks.includes(b));
  // ---- window ----
  const window = parseWindow(q, model.today, { bookings: blocks.includes('bookings') || blocks.includes('planActual') });
  if (window.past === 0 && (blocks.includes('bookings') || blocks.includes('planActual')) && !window.stated) window.past = 4;
  said.window = window.stated;
  // worker weeks with past weeks in the window: the bookings of those weeks belong to them
  if (window.past > 0 && blocks.includes('weeks') && allowed.includes('bookings') && !blocks.includes('bookings') && (subjects === 'people' || subjects === 'person')) blocks.push('bookings');
  blocks = BLOCKS.filter((b) => blocks.includes(b));
  const added = blocks.filter((b) => !saidBlocks.includes(b) && saidBlocks.length);
  // ---- output ----
  const wantsPdf = R.pdf.test(q);
  const notes = R.notes.test(q);
  let format = R.pdfEach.test(q) ? 'pdfEach' : wantsPdf ? 'pdfAll' : (R.textOnly.test(q) || notes || R.summary.test(q)) ? 'text' : 'pdfAll';
  said.format = wantsPdf || R.textOnly.test(q) || notes || R.summary.test(q);
  const personal = R.personal.test(q) || notes || (R.iterate.test(q) && subjects !== 'person');
  // ---- audience + tone ----
  let audience = R.aTeamLeads.test(q) ? 'teamLeads' : R.aOwners.test(q) ? 'owners' : R.aManagement.test(q) ? 'management' : R.aColleagues.test(q) ? 'colleagues' : null;
  said.audience = !!audience;
  if (!audience) audience = subjects === 'teams' ? 'teamLeads' : subjects === 'projects' ? 'owners' : 'colleagues';
  const tone = R.formal.test(q) ? 'formal' : R.friendly.test(q) ? 'friendly' : audience === 'management' ? 'formal' : 'friendly';
  said.tone = R.formal.test(q) || R.friendly.test(q);
  if (format === 'pdfEach' && subjects === 'person') format = 'pdfAll';
  void ds; void T;
  return { v: 1, text: raw.slice(0, 200), lang: L, scope, subjects, blocks, added, window, format, audience, tone, personal: !!personal, said, ambiguous };
}

// A job from outside (a command's params, a goal's preset) – checked against the data, or throws INVALID.
export function cleanJob(j, ctx) {
  const bad = (what) => { const e = new Error(`invalid job.${what}`); e.code = 'INVALID'; e.field = `job.${what}`; throw e; };
  if (!j || typeof j !== 'object' || Array.isArray(j)) bad('job');
  const { model } = computedOf(ctx);
  const ds = dsOf(ctx);
  const sc = j.scope;
  if (!sc || typeof sc !== 'object') bad('scope');
  const kinds = ['project', 'team', 'myTeam', 'person', 'portfolio'];
  if (!kinds.includes(sc.kind)) bad('scope');
  if (sc.kind === 'project' && !model.itemByRef.has(sc.ref)) bad('scope');
  if ((sc.kind === 'team' || sc.kind === 'myTeam') && !model.teams.has(sc.ref)) bad('scope');
  if (sc.kind === 'person' && !ds.people?.[sc.ref]) bad('scope');
  const name = sc.kind === 'project' ? model.itemByRef.get(sc.ref).name : sc.kind === 'person' ? ds.people[sc.ref].name : sc.kind === 'portfolio' ? 'Portfolio' : model.teams.get(sc.ref).name;
  if (!['people', 'teams', 'projects', 'person'].includes(j.subjects)) bad('subjects');
  if ((j.subjects === 'person') !== (sc.kind === 'person')) bad('subjects');
  const blocks = [...new Set([].concat(j.blocks || []))];
  if (!blocks.length || !blocks.every((b) => BLOCKS_FOR[j.subjects].includes(b))) bad('blocks');
  const w = j.window || {};
  const past = Math.round(+w.past || 0), next = Math.round(+w.next || 0);
  if (past < 0 || next < 0 || past > MAX_WEEKS || next > MAX_WEEKS || past + next < 1) bad('window');
  if (!FORMATS.includes(j.format)) bad('format');
  if (!AUDIENCES.includes(j.audience)) bad('audience');
  if (!TONES.includes(j.tone)) bad('tone');
  if (j.people != null && (!Array.isArray(j.people) || !j.people.length || j.people.length > 40 || !j.people.every((x) => typeof x === 'string' && x.length <= 80))) bad('people');
  const label = Array.isArray(w.label) && w.label.length === 2 ? w.label.map((x) => String(x).slice(0, 80)) : winLabel(past, next);
  const intro = typeof j.intro === 'string' && j.intro.trim() ? j.intro.trim().slice(0, 280) : null;
  return {
    v: 1, text: String(j.text || '').slice(0, 200), lang: j.lang === 'en' ? 'en' : 'de', scope: { kind: sc.kind, ref: sc.kind === 'portfolio' ? null : sc.ref, name },
    subjects: j.subjects, blocks: BLOCKS.filter((b) => blocks.includes(b)), added: [], window: { past, next, label, stated: !!w.stated }, format: j.format, audience: j.audience, tone: j.tone,
    personal: j.personal !== false, said: { ...(j.said || {}) }, ambiguous: [], ...(j.people ? { people: [...new Set(j.people)] } : {}), ...(intro ? { intro } : {}),
  };
}
