// Every Lotse skill: { id, title(lang), match: RegExp[] (folded DE/EN text), params, run(ctx, params, lang) → Story }.
import projectBrief from './projectBrief.js';
import teamBrief from './teamBrief.js';
import portfolioBrief from './portfolioBrief.js';
import myWeek from './myWeek.js';
import planningAdvice from './planningAdvice.js';
import gapsFix from './gapsFix.js';
import dispatchAdvice from './dispatchAdvice.js';
import planActualExplain from './planActualExplain.js';
import healthDraft from './healthDraft.js';
import supportTopics from './supportTopics.js';
import estimate from './estimate.js';
import overtime from './overtime.js';
import realCapacity from './realCapacity.js';
import fits from './fits.js';
import waterline from './waterline.js';
import blockers from './blockers.js';
import whatIf from './whatIf.js';
import compare from './compare.js';
import today from './today.js';
import why from './why.js';
// parity with the Forge LLM features (shared/lotse/parity.js): booking comments, what helped, playbook draft, wish routing
import bookingComments from './bookingComments.js';
import similarSummary from './similarSummary.js';
import playbookDraft from './playbookDraft.js';
import intentMap from './intentMap.js';
import yearCheck from './yearCheck.js';
import ticket from './ticket.js';
import splitCheck from './splitCheck.js';
import timelineBrief from './timelineBrief.js';

export const SKILLS = Object.freeze(Object.fromEntries([projectBrief, teamBrief, portfolioBrief, myWeek, planningAdvice, gapsFix, dispatchAdvice, planActualExplain, healthDraft, supportTopics,
  estimate, overtime, realCapacity, fits, waterline, blockers, whatIf, compare, today, why, bookingComments, similarSummary, playbookDraft, intentMap, yearCheck, ticket, splitCheck, timelineBrief].map((s) => [s.id, s])));
export const SKILL_IDS = Object.freeze(Object.keys(SKILLS));

// A question Lotse understands for a story's skill and subject (follow-up chips, "today" links).
export function questionFor(skill, subject, lang = 'de') {
  const de = lang !== 'en';
  const n = subject?.name || '';
  switch (skill) {
    case 'projectBrief': return de ? `Lagebild ${n}` : `Briefing ${n}`;
    case 'teamBrief': return de ? `Lagebild Team ${n}` : `Briefing team ${n}`;
    case 'portfolioBrief': return de ? 'Lagebild Portfolio' : 'Portfolio briefing';
    case 'myWeek': return de ? 'Meine Woche' : 'My week';
    case 'planningAdvice': return subject?.kind === 'team' ? (de ? `Planungsvorschläge für Team ${n}` : `Planning advice for team ${n}`) : (de ? 'Planungsvorschläge' : 'Planning advice');
    case 'gapsFix': return subject?.kind === 'project' ? (de ? `Datenlücken in ${n}` : `Data gaps in ${n}`) : (de ? 'Wo fehlen Daten?' : 'Where is data missing?');
    case 'dispatchAdvice': return de ? 'Wer soll die neuen Tickets bekommen?' : 'Who should take the new tickets?';
    case 'splitCheck': return de ? (subject?.kind === 'team' ? `Mehrteam-Check für ${n}` : 'Wer ist doppelt verplant?') : (subject?.kind === 'team' ? `Multi-team check for ${n}` : 'Who is double booked?');
    case 'timelineBrief': return de ? `Zeitleiste ${n} erklären` : `Explain the timeline of ${n}`;
    case 'ticket': return de ? `Wo steht ${subject?.ref || n}?` : `Where is ${subject?.ref || n}?`;
    case 'planActualExplain': return de ? 'Plan vs. Ist' : 'Plan vs. actual';
    case 'healthDraft': return de ? `Health-Entwurf für ${n}` : `Health draft for ${n}`;
    case 'supportTopics': return de ? 'Welche Support-Themen kommen immer wieder?' : 'Which support topics keep coming back?';
    case 'estimate': return de ? `Schätze wie früher: ${n}` : `Estimate like before: ${n}`;
    case 'overtime': return subject?.kind === 'team' ? (de ? `Überstunden Team ${n}` : `Overtime team ${n}`) : (de ? 'Wer macht bald Überstunden?' : 'Who is heading for overtime?');
    case 'realCapacity': return subject?.kind === 'team' ? (de ? `Realistische Kapazität Team ${n}` : `Realistic capacity team ${n}`) : (de ? 'Wie viel Kapazität bleibt nach Support?' : 'How much capacity is left after support?');
    case 'fits': return de ? 'Was passt ohne Überstunden?' : 'What fits without overtime?';
    case 'waterline': return de ? 'Ab welchem Rang reicht die Kapazität nicht?' : 'From which rank does capacity run out?';
    case 'blockers': return subject?.kind === 'project' ? (de ? `Was blockiert ${n}?` : `What blocks ${n}?`) : subject?.kind === 'person' ? (de ? 'Was blockiert meine Aufgaben?' : 'What blocks my tasks?') : (de ? 'Was ist blockiert?' : 'What is blocked?');
    case 'today': return de ? 'Was ist heute wichtig?' : 'What matters today?';
    case 'bookingComments': return de ? 'Kommentare für meine Buchungen' : 'Comments for my bookings';
    case 'similarSummary': return de ? `Was hat damals geholfen: ${n}` : `What helped back then: ${n}`;
    case 'playbookDraft': return de ? 'Playbook entwerfen' : 'Draft a playbook';
    default: return de ? 'Was ist heute wichtig?' : 'What matters today?';
  }
}
