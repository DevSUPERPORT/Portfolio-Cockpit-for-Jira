// Lotse missions – planning: "my week at 100 %" and "plan my team realistically".
//
// Both run the same re-planner (shared/lotse/plan/replan.js) – the cockpit's own load numbers (Remaining Estimate spread
// evenly to the due date against the available time after daily business, internal work, support, holidays and
// absence), so the "before" a person sees here is exactly what "Meine Arbeit" and Kapazität show. Lotse then:
//   diagnosis story → decisions (what first, which numbers, what may move) → the plan as a story (before/after per week)
//   → the moves as a story (Gantt with where every bar was) → a decision for work that ends late → one preview →
//   apply (plan.move: new start/due/assignee in Jira, one undo) → the next job (missing bookings this week).
// Nothing is written before the preview is accepted; every number in a decision stands in its facts.
import { T, langOf, fmt, plural, fact, meId, can, teamLabel, personLabel, computedOf, dsOf, isoWeekNo } from './kit.js';
import { COMMANDS } from './commands.js';
import { replan } from '../plan/replan.js';
import { newStory, kpi, ev, finding, follow, done as doneStory, infoStory, sum, rcOf, addPerson, addTeam, addProject } from '../kit.js';
import { capacityPeople } from '../../engine.js';
import { inTeam } from '../../allocation.js';

const pctOf = (u) => (Number.isFinite(u) ? Math.round(u * 100) : null);
const h1 = (v) => Math.round((v || 0) * 10) / 10;
const short = (s, n = 42) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const weekName = (L, w, i) => (i === 0 ? T(L, `Rest KW ${isoWeekNo(w.from)}`, `Rest W${isoWeekNo(w.from)}`) : T(L, `KW ${isoWeekNo(w.from)}`, `W${isoWeekNo(w.from)}`));
const optOf = (a) => (typeof a === 'string' ? a : a?.option ?? null);
const blockedWhy = (ctx, id) => { try { return COMMANDS[id]?.allowed?.(ctx) || null; } catch { return null; } };

// ---------- stories ----------
function diagnosisStory(ctx, pr, me) {
  const L = langOf(ctx);
  const s = newStory(ctx, { skill: 'balanceWeek', subject: { kind: 'person', ref: pr.id, name: pr.name || T(L, 'Ich', 'Me') }, lang: L });
  const F = s.fmt;
  addPerson(s, ctx, pr.id);
  const w0 = pr.before[0];
  const p0 = pctOf(w0.util);
  const free0 = Math.max(0, w0.capRest - w0.plan);
  const over = pr.before.filter((w) => w.util > 1.005);
  // the highest week with time available (a week with work but no time at all is named on its own)
  const peak = [...pr.before].filter((w) => Number.isFinite(w.util)).sort((a, b) => b.util - a.util)[0] || null;
  const noTime = pr.before.filter((w) => !Number.isFinite(w.util));
  const who = me ? T(L, 'Du', 'You') : pr.name;
  s.kpis.push(kpi('load0', T(L, 'Rest dieser Woche', 'Rest of this week'), p0 ?? 0, '%', { tone: w0.util > 1.005 ? 'bad' : w0.util < 0.85 ? 'warn' : 'ok' }));
  s.kpis.push(kpi('plan0', T(L, 'Geplant ab heute', 'Planned from today'), w0.plan, 'h'));
  s.kpis.push(kpi('cap0', T(L, 'Frei für Projekte', 'Free for projects'), w0.capRest, 'h'));
  s.kpis.push(kpi('overWeeks', T(L, 'Wochen über 100 %', 'Weeks over 100%'), over.length, 'n', { tone: over.length ? 'warn' : 'ok' }));
  s.visual = {
    kind: 'columns',
    data: { unit: 'h', labels: pr.before.map((w, i) => weekName(L, w, i)), series: [{ name: T(L, 'Geplant', 'Planned'), values: pr.before.map((w) => h1(w.plan)), tone: 'ink' }, { name: T(L, 'Verfügbar', 'Available'), values: pr.before.map((w) => h1(w.capRest)), tone: 'muted' }] },
    caption: T(L, 'Geplante Stunden je Woche gegen die freie Zeit für Projekte – heute wie im Cockpit.', 'Planned hours per week against the time free for projects – as the cockpit counts them today.'),
  };
  s.headline = w0.util > 1.005
    ? T(L, `Rest dieser Woche: ${p0} % – ${F.h(w0.plan, 1)} geplant für ${F.h(w0.capRest, 1)} freie Zeit.`, `Rest of this week: ${p0}% – ${F.h(w0.plan, 1)} planned for ${F.h(w0.capRest, 1)} of free time.`)
    : T(L, `Rest dieser Woche: ${p0} % – ${F.h(free0, 1)} sind noch frei.`, `Rest of this week: ${p0}% – ${F.h(free0, 1)} still free.`);
  const evFree = ev(T(L, 'frei', 'free'), free0, 'h');
  if (w0.util <= 1.005) s.findings.push(finding(T(L, `${F.h(free0, 1)} freie Zeit bis Freitag – Lotse kann spätere Arbeit nach vorne holen.`, `${F.h(free0, 1)} of free time until Friday – Lotse can bring later work forward.`), 'info', 50, [evFree]));
  const t = pr.tasks || [];
  const overdue = t.filter((x) => x.overdue), undated = t.filter((x) => x.undated);
  if (overdue.length) {
    const h = sum(overdue, (x) => x.re);
    s.findings.push(finding(T(L, `${overdue.length} ${plural(overdue.length, 'überfällige Story liegt', 'überfällige Stories liegen')} mit ${F.h(h, 1)} komplett auf dem nächsten Arbeitstag – das Cockpit kennt kein neues Datum dafür.`, `${overdue.length} overdue ${plural(overdue.length, 'story sits', 'stories sit')} with ${F.h(h, 1)} entirely on the next working day – the cockpit has no new date for ${plural(overdue.length, 'it', 'them')}.`), 'bad', 90,
      [ev(T(L, 'überfällig', 'overdue'), overdue.length, 'n'), ev(T(L, 'Rest', 'Remaining'), h, 'h'), ...overdue.slice(0, 4).map((x) => ev(x.key, x.due, 'date', { key: x.key, text: x.summary }))]));
  }
  const inverted = t.filter((x) => x.inverted);
  if (inverted.length) {
    const h = sum(inverted, (x) => x.re);
    s.findings.push(finding(T(L, `${inverted.length} ${plural(inverted.length, 'Story beginnt', 'Stories beginnen')} erst nach ${plural(inverted.length, 'ihrem', 'ihrem')} Due Date – ${F.h(h, 1)} zählen deshalb ganz in der Due-Woche.`, `${inverted.length} ${plural(inverted.length, 'story starts', 'stories start')} after ${plural(inverted.length, 'its', 'their')} due date – so ${F.h(h, 1)} count entirely in the due week.`), 'warn', 75,
      [ev(T(L, 'Start nach Due', 'start after due'), inverted.length, 'n'), ev(T(L, 'Rest', 'Remaining'), h, 'h'), ...inverted.slice(0, 4).map((x) => ev(x.key, x.start, 'date', { key: x.key, text: x.summary }))]));
  }
  if (undated.length) {
    const h = sum(undated, (x) => x.re);
    s.findings.push(finding(T(L, `${undated.length} ${plural(undated.length, 'Story hat', 'Stories haben')} kein Due Date – ${F.h(h, 1)} zählen deshalb sofort.`, `${undated.length} ${plural(undated.length, 'story has', 'stories have')} no due date – so ${F.h(h, 1)} count right away.`), 'warn', 70,
      [ev(T(L, 'ohne Due Date', 'without due date'), undated.length, 'n'), ev(T(L, 'Rest', 'Remaining'), h, 'h'), ...undated.slice(0, 4).map((x) => ev(x.key, null, null, { key: x.key, text: x.summary }))]));
  }
  if (noTime.length) {
    const w = noTime[0], hNo = sum(noTime, (x) => x.plan);
    s.findings.push(finding(T(L, `${noTime.length} ${plural(noTime.length, 'Woche hat', 'Wochen haben')} geplante Arbeit, aber keine freie Zeit (Feiertage oder Abwesenheit) – zuerst ${weekName(L, w, pr.before.indexOf(w))} mit ${F.h(w.plan, 1)}.`, `${noTime.length} ${plural(noTime.length, 'week has', 'weeks have')} planned work but no free time (holidays or absence) – first ${weekName(L, w, pr.before.indexOf(w))} with ${F.h(w.plan, 1)}.`), 'bad', 85,
      [ev(T(L, 'Wochen ohne Zeit', 'weeks without time'), noTime.length, 'n'), ev(T(L, 'geplant', 'planned'), w.plan, 'h'), ev(T(L, 'zusammen', 'together'), hNo, 'h')]));
  }
  if (over.length && peak && peak.util > 1.005) {
    const pk = pctOf(peak.util);
    s.findings.push(finding(T(L, `${who} ${me ? 'liegst' : 'liegt'} in ${over.length} von ${pr.before.length} Wochen über 100 %, am höchsten ${weekName(L, peak, pr.before.indexOf(peak))} mit ${pk} %.`, `${who} ${me ? 'are' : 'is'} over 100% in ${over.length} of ${pr.before.length} weeks, highest ${weekName(L, peak, pr.before.indexOf(peak))} at ${pk}%.`), over.length > 2 ? 'bad' : 'warn', 80,
      [ev(T(L, 'Wochen über Ziel', 'weeks over target'), over.length, 'n'), ev(T(L, 'Wochen', 'weeks'), pr.before.length, 'n'), ev(T(L, 'Ziel', 'target'), 100, '%'), ev(T(L, 'Spitze', 'peak'), pk, '%')]));
  }
  s.tone = w0.util > 1.005 || over.length > 2 ? 'bad' : over.length ? 'warn' : 'ok';
  s.how = { text: T(L, 'Wie „Meine Arbeit“: Remaining Estimate jeder offenen Story, gleichmäßig auf die Arbeitstage von Start (frühestens heute) bis Due Date verteilt; überfällige Arbeit zählt am nächsten Arbeitstag. Verfügbar = Wochenstunden minus Tagesgeschäft, Intern, Support-Reserve, Feiertage und Abwesenheit. Diese Woche zählt nur ab heute.', 'As in "My work": the remaining estimate of every open story, spread evenly over the working days from its start (today at the earliest) to its due date; overdue work counts on the next working day. Available = weekly hours minus daily business, internal work, support reserve, holidays and absence. This week counts from today only.'), inputs: [[T(L, 'Wochen', 'Weeks'), String(pr.before.length)]] };
  s.followUps.push(follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')));
  s.confidence = 'high';
  s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity')];
  return doneStory(s);
}

export function planStory(ctx, r, pid, team) {
  const L = langOf(ctx);
  const subj = team ? { kind: 'team', ref: team, name: teamLabel(ctx, team) || team } : { kind: 'person', ref: pid, name: personLabel(ctx, pid) || T(L, 'Ich', 'Me') };
  const s = newStory(ctx, { skill: team ? 'teamPlan' : 'balanceWeek', subject: subj, lang: L });
  s.id = `${s.skill}:plan:${subj.ref}`;
  const F = s.fmt;
  const planned = r.people.filter((p) => p.role === 'planned');
  const moves = r.moves;
  const hand = moves.filter((m) => m.reason === 'handover');
  const late = moves.filter((m) => m.late);
  const sooner = moves.filter((m) => m.reason === 'sooner');
  if (team) addTeam(s, computedOf(ctx).model, team);
  // a team without people with capacity (only unnamed hours or none): nothing to plan per person – say so
  if (team && !planned.length) {
    return infoStory(ctx, { skill: 'teamPlan', lang: L, subject: subj, headline: T(L, `Für ${subj.name} sind keine Personen mit Kapazität gepflegt – Lotse kann nichts je Person planen.`, `No people with capacity are maintained for ${subj.name} – Lotse cannot plan per person.`),
      finding: T(L, 'Personen und Wochenstunden pflegst du unter Teams › Kapazitäten; Stories mit Assignee in diesem Team zählen dann automatisch.', 'Maintain people and weekly hours under Teams › Capacity; stories assigned within this team then count automatically.') });
  }
  for (const p of r.people) addPerson(s, ctx, p.id);
  const overB = sum(planned, (p) => p.overWeeksBefore), overA = sum(planned, (p) => p.overWeeksAfter);
  if (!team) {
    const p = planned[0];
    const a0 = pctOf(p.after[0].util), b0 = pctOf(p.before[0].util);
    s.kpis.push(kpi('before0', T(L, 'Diese Woche vorher', 'This week before'), b0 ?? 0, '%', { tone: p.before[0].util > 1.005 ? 'bad' : 'ink' }));
    s.kpis.push(kpi('after0', T(L, 'Diese Woche nachher', 'This week after'), a0 ?? 0, '%', { tone: p.after[0].util > 1.005 ? 'bad' : p.after[0].util >= 0.85 ? 'ok' : 'warn' }));
    s.visual = {
      kind: 'columns',
      data: { unit: '%', target: 100, labels: p.before.map((w, i) => weekName(L, w, i)), series: [{ name: T(L, 'Vorher', 'Before'), values: p.before.map((w) => Math.min(300, pctOf(w.util) ?? 300)), tone: 'muted' }, { name: T(L, 'Mit Lotses Plan', 'With Lotse\'s plan'), values: p.after.map((w) => Math.min(300, pctOf(w.util) ?? 300)), tone: 'ok' }] },
      caption: T(L, `Auslastung je Woche, Referenz 100 %; über 300 % und Wochen ohne freie Zeit bei 300 % gekappt${r.settings.realistic ? ' – realistisch gerechnet' : ''}.`, `Load per week, reference 100%; above 300% and weeks without free time capped at 300%${r.settings.realistic ? ' – realistic numbers' : ''}.`),
    };
    s.headline = T(L, `Mit ${moves.length} ${plural(moves.length, 'Änderung', 'Änderungen')} liegt diese Woche bei ${a0} % statt ${b0} %.`, `With ${moves.length} ${plural(moves.length, 'change', 'changes')} this week is at ${a0}% instead of ${b0}%.`);
    s.findings.push(finding(T(L, `Wochen über 100 %: vorher ${overB}, nachher ${overA}.`, `Weeks over 100%: ${overB} before, ${overA} after.`), overA ? 'warn' : 'ok', 75, [ev(T(L, 'vorher', 'before'), overB, 'n'), ev(T(L, 'nachher', 'after'), overA, 'n'), ev(T(L, 'Ziel', 'target'), 100, '%')]));
  } else {
    s.kpis.push(kpi('overBefore', T(L, 'Personenwochen über Ziel vorher', 'Person-weeks over target before'), overB, 'n', { tone: overB ? 'bad' : 'ok' }));
    s.kpis.push(kpi('overAfter', T(L, 'nachher', 'after'), overA, 'n', { tone: overA ? 'warn' : 'ok' }));
    const cols = r.weeks.map((w, i) => weekName(L, w, i));
    s.visual = {
      kind: 'heat',
      data: { unit: '%', cols, rows: planned.slice(0, 12).map((p) => ({ label: p.name || '–', values: p.after.map((w) => (Number.isFinite(w.util) ? pctOf(w.util) : null)) })) },
      caption: T(L, `Auslastung je Person und Woche mit Lotses Plan${r.settings.realistic ? ' – realistisch: Erfahrungsfaktor und Support-P80' : ''}.`, `Load per person and week with Lotse's plan${r.settings.realistic ? ' – realistic: estimate factor and support P80' : ''}.`),
    };
    s.headline = !overB && !moves.length
      ? T(L, `In ${subj.name} liegt niemand über 100 % – Lotse muss nichts verschieben.`, `Nobody in ${subj.name} is over 100% – Lotse has nothing to move.`)
      : T(L, `Mit ${moves.length} ${plural(moves.length, 'Änderung', 'Änderungen')} sinken die Personenwochen über 100 % von ${overB} auf ${overA}.`, `With ${moves.length} ${plural(moves.length, 'change', 'changes')} the person-weeks over 100% drop from ${overB} to ${overA}.`);
    const worst = [...planned].sort((a, b) => b.overWeeksBefore - a.overWeeksBefore)[0];
    if (worst?.overWeeksBefore) s.findings.push(finding(T(L, `${worst.name}: ${worst.overWeeksBefore} Wochen über 100 % vorher, ${worst.overWeeksAfter} nachher.`, `${worst.name}: ${worst.overWeeksBefore} weeks over 100% before, ${worst.overWeeksAfter} after.`), worst.overWeeksAfter ? 'warn' : 'ok', 70, [ev(T(L, 'vorher', 'before'), worst.overWeeksBefore, 'n'), ev(T(L, 'nachher', 'after'), worst.overWeeksAfter, 'n'), ev(T(L, 'Ziel', 'target'), 100, '%')]));
    // a calm team: say so (every story needs at least one finding, and "nothing to do" is an answer too)
    else s.findings.push(finding(T(L, `Niemand in ${subj.name} liegt in den ${r.weeks.length} Wochen über 100 % – es gibt nichts zu entlasten.`, `Nobody in ${subj.name} is over 100% in the ${r.weeks.length} weeks – there is nothing to relieve.`), 'ok', 60, [ev(T(L, 'Personen', 'people'), planned.length, 'n'), ev(T(L, 'Wochen', 'weeks'), r.weeks.length, 'n'), ev(T(L, 'Wochen über 100 %', 'weeks over 100%'), 0, 'n'), ev(T(L, 'Ziel', 'target'), 100, '%')]));
  }
  s.kpis.push(kpi('moves', T(L, 'Änderungen', 'Changes'), moves.length, 'n'));
  s.kpis.push(kpi('late', T(L, 'Später als Termin', 'Later than due'), late.length, 'n', { tone: late.length ? 'warn' : 'ok' }));
  if (hand.length) s.findings.push(finding(T(L, `${hand.length} ${plural(hand.length, 'Story geht', 'Stories gehen')} an Kolleginnen und Kollegen mit Luft: ${hand.slice(0, 3).map((m) => `${m.key} → ${m.to.assigneeName}`).join(', ')}.`, `${hand.length} ${plural(hand.length, 'story goes', 'stories go')} to colleagues with room: ${hand.slice(0, 3).map((m) => `${m.key} → ${m.to.assigneeName}`).join(', ')}.`), 'info', 65, [ev(T(L, 'übergeben', 'handed over'), hand.length, 'n'), ...hand.slice(0, 3).map((m) => ev(m.key, m.to.due, 'date', { key: m.key, text: m.summary }))]));
  if (sooner.length) s.findings.push(finding(T(L, `${sooner.length} ${plural(sooner.length, 'Story rückt', 'Stories rücken')} nach vorne in freie Zeit und ${plural(sooner.length, 'wird', 'werden')} früher fertig.`, `${sooner.length} ${plural(sooner.length, 'story moves', 'stories move')} forward into free time and ${plural(sooner.length, 'finishes', 'finish')} sooner.`), 'ok', 55, [ev(T(L, 'früher', 'sooner'), sooner.length, 'n')]));
  if (late.length) {
    const worst = [...late].sort((a, b) => b.late.days - a.late.days)[0];
    s.findings.push(finding(T(L, `${late.length} ${plural(late.length, 'Story endet', 'Stories enden')} nach ${plural(late.length, 'ihrem', 'ihrem')} Termin – am weitesten ${worst.key} um ${worst.late.days} Arbeitstage.`, `${late.length} ${plural(late.length, 'story ends', 'stories end')} after ${plural(late.length, 'its', 'their')} date – furthest ${worst.key} by ${worst.late.days} working days.`), 'warn', 85, [ev(T(L, 'später', 'late'), late.length, 'n'), ev(worst.key, worst.late.days, 'd', { key: worst.key, text: worst.summary })]));
  }
  if (r.unplaced.length) {
    // more work than time: no plan fixes that – say it plainly, with the hours, and the decisions that do help
    const hMiss = sum(r.unplaced, (u) => u.h);
    const head = T(L, `Mehr Arbeit als Zeit: ${r.unplaced.length} ${plural(r.unplaced.length, 'Story', 'Stories')} mit ${F.h(hMiss)} ${plural(r.unplaced.length, 'passt', 'passen')} im nächsten Jahr nicht hinein – auch nicht mit ${moves.length} ${plural(moves.length, 'Änderung', 'Änderungen')}.`,
      `More work than time: ${r.unplaced.length} ${plural(r.unplaced.length, 'story', 'stories')} with ${F.h(hMiss)} ${plural(r.unplaced.length, 'does', 'do')} not fit within the next year – not even with ${moves.length} ${plural(moves.length, 'change', 'changes')}.`);
    s.findings.push(finding(T(L, `${r.unplaced.length} ${plural(r.unplaced.length, 'Story bleibt', 'Stories bleiben')}, wie ${plural(r.unplaced.length, 'sie ist', 'sie sind')} (${F.h(hMiss)}) – hier helfen nur Entscheidungen: neu priorisieren, Umfang kürzen oder Kapazität dazu.`, `${r.unplaced.length} ${plural(r.unplaced.length, 'story stays', 'stories stay')} as ${plural(r.unplaced.length, 'it is', 'they are')} (${F.h(hMiss)}) – only decisions help here: re-prioritise, cut scope or add capacity.`), 'bad', 95,
      [ev(T(L, 'ohne Platz', 'no room'), r.unplaced.length, 'n'), ev(T(L, 'Stunden', 'hours'), hMiss, 'h'), ...r.unplaced.slice(0, 3).map((u) => ev(u.key, null, null, { key: u.key, text: u.summary }))]));
    s.kpis.unshift(kpi('noRoom', T(L, 'Passt nicht ins Jahr', 'No room this year'), hMiss, 'h', { tone: 'bad' }));
    s.findings.push(finding(head, 'bad', 96, [ev(T(L, 'ohne Platz', 'no room'), r.unplaced.length, 'n'), ev(T(L, 'Stunden', 'hours'), hMiss, 'h'), ev(T(L, 'Änderungen', 'changes'), moves.length, 'n')]));
    s.headline = head;
    s.followUps.push(follow(T(L, 'Quartal neu ranken', 'Re-rank the quarter'), T(L, 'Quartals-Rangfolge neu setzen', 'Re-rank the quarter')), follow(T(L, 'Was passt?', 'What fits?'), T(L, 'Was passt ohne Überstunden?', 'What fits without overtime?')));
  }
  s.tone = r.unplaced.length ? 'bad' : overA ? 'warn' : 'ok';
  s.how = { text: T(L, 'Was passt, bleibt. Überfälliges und Undatiertes bekommt ein echtes Fenster; aus jeder Woche über dem Ziel geht die Story mit der niedrigsten Priorität und wird neu eingeplant – höchste Priorität zuerst, ins kürzeste Fenster, dessen gleichmäßiger Anteil an jedem Arbeitstag in die freie Zeit passt, nie vor heute, dem geplanten Start oder dem Ende eines Vorgängers.', 'What fits stays. Overdue and undated work gets a real window; from every week over the target the lowest-priority story leaves and is planned again – highest priority first, into the shortest window whose even share fits the free time on every working day, never before today, its planned start or the end of a prerequisite.'),
    inputs: [[T(L, 'Reihenfolge', 'Order'), r.settings.order === 'due' ? T(L, 'Termin zuerst', 'due date first') : T(L, 'Projekt-Rang', 'project rank')], [T(L, 'Rechnung', 'Numbers'), r.settings.realistic ? T(L, 'realistisch', 'realistic') : T(L, 'Cockpit', 'cockpit')]] };
  s.confidence = r.settings.realistic ? 'medium' : 'high';
  s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity')];
  return doneStory(s);
}

export function movesStory(ctx, r, subj) {
  const L = langOf(ctx);
  const s = newStory(ctx, { skill: 'planMoves', subject: subj, lang: L });
  const F = s.fmt;
  const model = computedOf(ctx).model;
  const rank = (m) => (m.reason === 'handover' ? 0 : m.late ? 1 : m.reason === 'overdue' || m.reason === 'inverted' ? 2 : 3);
  const shown = [...r.moves].sort((a, b) => rank(a) - rank(b) || String(a.to.start).localeCompare(String(b.to.start))).slice(0, 12);
  for (const m of shown) addProject(s, model.itemByRef.get(m.ref));
  const lastEnd = shown.reduce((x, m) => (m.to.due > x ? m.to.due : x), dsOf(ctx).today);
  s.visual = {
    kind: 'gantt',
    data: { from: dsOf(ctx).today, to: lastEnd, today: dsOf(ctx).today, rows: shown.map((m) => ({ label: `${m.key} · ${short(m.summary, 28)}`, key: m.key, start: m.to.start, end: m.to.due, tone: m.late ? 'warn' : m.reason === 'handover' ? 'info' : 'ok', before: { start: m.from.window[0], end: m.from.window[1] } })) },
    caption: T(L, 'Neue Fenster der Stories; gestrichelt, wo sie das Cockpit heute rechnet.', 'New windows of the stories; dashed where the cockpit counts them today.'),
  };
  const why = (m) => ({ overdue: T(L, 'überfällig', 'overdue'), undated: T(L, 'ohne Due Date', 'no due date'), overload: T(L, 'Woche zu voll', 'week too full'), estimated: T(L, 'neu geschätzt', 'newly estimated'), inverted: T(L, 'Start lag nach dem Due Date', 'start was after the due date'), sooner: T(L, 'früher fertig', 'sooner'), handover: T(L, `an ${m.to.assigneeName}`, `to ${m.to.assigneeName}`) }[m.reason] || m.reason);
  s.headline = T(L, `${r.moves.length} ${plural(r.moves.length, 'Story bekommt', 'Stories bekommen')} ein neues Fenster.`, `${r.moves.length} ${plural(r.moves.length, 'story gets', 'stories get')} a new window.`);
  s.kpis.push(kpi('moves', T(L, 'Neue Fenster', 'New windows'), r.moves.length, 'n'));
  s.kpis.push(kpi('hours', T(L, 'Stunden darin', 'Hours in them'), sum(r.moves, (m) => m.re), 'h'));
  for (const m of shown.slice(0, 4)) s.findings.push(finding(T(L, `${m.key} (${why(m)}): ${F.date(m.to.start)} – ${F.date(m.to.due)}${m.late ? `, ${m.late.days} Arbeitstage nach dem Termin` : ''}.`, `${m.key} (${why(m)}): ${F.date(m.to.start)} – ${F.date(m.to.due)}${m.late ? `, ${m.late.days} working days after the date` : ''}.`), m.late ? 'warn' : 'info', m.late ? 70 : 40,
    [ev(m.key, m.re, 'h', { key: m.key, text: m.summary }), ev(T(L, 'Start', 'Start'), m.to.start, 'date'), ev(T(L, 'Ende', 'End'), m.to.due, 'date'), ...(m.late ? [ev(T(L, 'später', 'late'), m.late.days, 'd')] : [])]));
  s.tone = r.moves.some((m) => m.late) ? 'warn' : 'info';
  s.how = { text: T(L, 'Jede Zeile ist eine Änderung, die Lotse vorschlägt: neuer Start und neues Due Date (und bei Übergaben die neue Person). Übernommen wird erst nach der Vorschau, alles mit einem Klick rückgängig.', 'Each row is a change Lotse suggests: a new start and due date (and for handovers the new person). Nothing is applied before the preview, everything undoable with one click.'), inputs: [] };
  s.confidence = 'high';
  return doneStory(s);
}

// ---------- shared decision steps ----------
export function lateStep(P, r) {
  const late = r.moves.filter((m) => m.late && m.reason !== 'handover');
  if (!late.length) return { lock: [] };
  const worst = Math.max(...late.map((m) => m.late.days));
  const a = P.decide('late', {
    question: P.t(`${late.length} ${plural(late.length, 'Story endet', 'Stories enden')} damit nach ${plural(late.length, 'ihrem', 'ihrem')} Termin (bis ${worst} Arbeitstage) – was gilt?`, `${late.length} ${plural(late.length, 'story ends', 'stories end')} after ${plural(late.length, 'its', 'their')} date this way (up to ${worst} working days) – what applies?`),
    facts: [fact('n', late.length), fact('days', worst)],
    options: [
      { id: 'accept', label: P.t('Ehrlich planen – später fertig', 'Plan honestly – finish later'), detail: P.t('Die Termine wandern dorthin, wo Zeit ist. Die Projekt-Owner sehen es im Cockpit.', 'The dates move to where there is time. Project owners see it in the cockpit.'), recommended: true },
      { id: 'keep', label: P.t('Diese Stories nicht anfassen', 'Leave these stories alone'), detail: P.t(`${late.length} ${plural(late.length, 'Story bleibt', 'Stories bleiben')}, wo ${plural(late.length, 'sie ist', 'sie sind')} – die Überlast bleibt dort sichtbar.`, `${late.length} ${plural(late.length, 'story stays', 'stories stay')} where ${plural(late.length, 'it is', 'they are')} – the overload stays visible there.`), facts: [fact('n', late.length)] },
    ],
    stories: late.slice(0, 8).map((m) => ({ key: m.key, summary: m.summary, due: m.to.due, limit: m.late.limit, days: m.late.days })),
  });
  if (a === undefined) return null;
  return { lock: optOf(a) === 'keep' ? late.map((m) => m.issueId) : [] };
}
export function planBatch(P, r, id, title) {
  const moves = r.moves.map((m) => ({ issue: m.issueId, start: m.to.start, due: m.to.due, ...(m.to.assignee ? { assignee: m.to.assignee } : {}) }));
  // plan.move takes 200 moves at a time – a large team plan becomes several steps (each with its own undo)
  const out = [];
  for (let i = 0; i < moves.length; i += 200) out.push({ id: i ? `${id}:${i / 200 + 1}` : id, command: 'plan.move', params: { moves: moves.slice(i, i + 200) }, title: i ? `${title} (${i / 200 + 1})` : title });
  return out;
}

export function planMissions({ bookingProposals, gapItems, fillCommands }) {
  // ---------- my week at 100 % ----------
  const balanceWeek = {
    id: 'balanceWeek', title: (L) => T(L, 'Meine Woche auf 100 %', 'My week at 100%'), params: ['person'],
    match: [
      /\b(meine?[nrms]?|my)\b.{0,40}\b(woche|wochenplan|week|schedule|planung|plan|kalender|auslastung|workload|load)\b.{0,60}(\b100 ?%?|\bvoll\w*|\bauslast\w*|\bcapacity\b|\bkapazitaet\w*|\bausgleich\w*|\bbalance\w*|\bglaett\w*|\bentlast\w*|\bfix\w*|\bsort\w* out\b|\bordne\w*|\borganis\w*|\borganiz\w*|\bre-?plan\w*|\brepar\w*|\bbereinig\w*|\bin ordnung\b|\bschaffbar\b|\brealistisch\w*|\brealistic\w*)/,
      /\b(fix|balance|organi[sz]e|sort out|plan|re-?plan|level|even out|clean up|repair)\b.{0,30}\b(my|meine?[nrms]?)\b.{0,20}\b(week|schedule|workload|plan|woche)\b/,
      /\b(plane?|ordne|organisiere|bringe?|gleiche?|bereinige|repariere|sortiere)\b.{0,30}\b(meine?[nrms]?)\b.{0,20}\b(woche|planung|wochenplan|auslastung|arbeit)\b/,
      /\b(100 ?%?|voll(e|er)? auslastung|full capacity)\b.{0,40}\b(meine?[nrms]?|my)\b.{0,15}\b(woche|week)\b/,
      /\b(ich bin|i am|i'm|im)\b.{0,20}\b(ueberlastet|ueberbucht|overloaded|overbooked|swamped)\b/,
    ],
    plan(P, { person = null }) {
      const { ctx } = P;
      const pid = person || meId(ctx);
      const me = !person || person === meId(ctx);
      if (!pid || !capacityPeople(computedOf(ctx).model).has(pid)) {
        P.summary(P.t('Für diese Person gibt es keine Kapazität im Cockpit – Wochenstunden und Team pflegt die Admin-Gruppe unter Teams › Kapazitäten.', 'There is no capacity for this person in the cockpit – weekly hours and team are maintained under Teams › Capacity.'));
        return;
      }
      const L = P.L;
      const base = replan(ctx, { people: [pid], fixWeeks: 12 });
      const pr = base.people[0];
      // the person's stories as the planner read them (for the diagnosis)
      pr.tasks = (dsOf(ctx).issues || []).filter((s) => s.role === 'estimate' && (s.status?.cat ?? 'new') !== 'done' && s.re > 0 && s.assignee?.id === pid)
        .map((s) => ({ key: s.key, summary: s.summary, re: s.re, due: s.due || null, start: s.start || null, overdue: !!s.due && s.due < dsOf(ctx).today, undated: !s.due, inverted: !!s.start && !!s.due && s.start > s.due && s.due >= dsOf(ctx).today }));
      P.storyObj('story:now', diagnosisStory(ctx, pr, me));
      const nOver = pr.tasks.filter((x) => x.overdue || x.undated).length;
      const ord = P.decide('order', {
        question: P.t('Was soll zuerst Platz bekommen?', 'What gets room first?'),
        options: [
          { id: 'due', label: P.t('Fälliges zuerst', 'Due work first'), detail: nOver ? P.t(`${nOver} überfällige oder undatierte Stories vorne, dann nach Due Date`, `${nOver} overdue or undated stories first, then by due date`) : P.t('nach Due Date', 'by due date'), facts: [fact('n', nOver)], recommended: true },
          { id: 'rank', label: P.t('Nach Projekt-Rang', 'By project rank'), detail: P.t('wie die Rangfolge im Portfolio, dann nach Due Date', 'as ranked in the portfolio, then by due date') },
        ],
      });
      if (ord === undefined) return;
      const rc = rcOf(ctx, L).people.find((x) => x.id === pid);
      const factor = rc?.estimate?.factor ?? 1;
      const p80 = rc?.support?.p80 ?? 0;
      // only offered when experience changes something: a factor away from 1 or support time to reserve
      const realOk = !!rc && (Math.abs(factor - 1) >= 0.05 || p80 > 0);
      const meas = P.decide('measure', {
        question: P.t('Mit welchen Zahlen soll Lotse planen?', 'Which numbers should Lotse plan with?'),
        options: [
          { id: 'plan', label: P.t('Wie im Cockpit', 'As in the cockpit'), detail: P.t('Schätzungen und Support-Reserve, wie sie in Jira und der Konfiguration stehen – gleiche Zahl wie „Meine Arbeit“', 'estimates and support reserve as set in Jira and the configuration – the same number as "My work"'), recommended: !realOk || (factor <= 1.1 && factor >= 0.9) },
          { id: 'real', label: P.t('Realistisch aus Erfahrung', 'Realistic from experience'), detail: realOk ? P.t(`Schätzung × ${String(factor).replace('.', ',')} (wie lange ähnliche Arbeit wirklich dauerte) und ${String(p80).replace('.', ',')} h Support pro Woche (80. Perzentil)`, `estimate × ${factor} (how long similar work really took) and ${p80} h of support per week (80th percentile)`) : P.t('Noch keine Erfahrungswerte: zu wenig erledigte Arbeit mit gebuchter Zeit und keine Support-Buchungen – das Ergebnis wäre gleich.', 'No experience yet: too little finished work with logged time and no support bookings – the result would be the same.'), facts: [fact('factor', factor), fact('p80', p80), fact('percentile', 80)], recommended: realOk && (factor > 1.1 || factor < 0.9), disabled: !realOk },
        ],
      });
      if (meas === undefined) return;
      const order = optOf(ord), realistic = optOf(meas) === 'real';
      const estimates = {}, estCmds = [];
      // stories without an estimate are invisible to every plan – suggest one from similar finished work
      const noEst = gapItems(ctx, { limit: 20, assignee: pid, onlyField: 'estimate' });
      if (noEst.length) {
        const hs = sum(noEst, (x) => +x.sug.value || 0);
        const g = P.decide('estimates', {
          question: P.t(`${noEst.length} ${plural(noEst.length, 'deiner Stories hat', 'deiner Stories haben')} keine Schätzung – kein Plan sieht ${plural(noEst.length, 'sie', 'sie')}. Vorschläge aus ähnlicher erledigter Arbeit übernehmen (zusammen ${P.F.h(hs, 1)})?`, `${noEst.length} of your ${plural(noEst.length, 'stories has', 'stories have')} no estimate – no plan sees ${plural(noEst.length, 'it', 'them')}. Apply suggestions from similar finished work (${P.F.h(hs, 1)} together)?`),
          facts: [fact('n', noEst.length), fact('h', Math.round(hs * 10) / 10)],
          options: [{ id: 'fill', label: P.t('Ja, Schätzungen setzen', 'Yes, set the estimates'), detail: P.t('Lotse plant sie gleich mit ein; jede einzeln rückgängig', 'Lotse plans them in right away; each one undoable'), recommended: true }, { id: 'skip', label: P.t('Nicht jetzt', 'Not now') }],
          proposals: noEst.map((x) => ({ key: x.issue.key, hours: +x.sug.value || 0 })),
        });
        if (g === undefined) return;
        if (optOf(g) === 'fill') { estCmds.push(...fillCommands(ctx, noEst, 'cmd:est')); for (const x of noEst) estimates[x.issue.id] = +x.sug.value || 0; }
      }
      const probe = replan(ctx, { people: [pid], order, realistic, estimates, pull: true, handover: true, fixWeeks: 12 });
      const nSooner = probe.moves.filter((m) => m.reason === 'sooner').length;
      const nHand = probe.moves.filter((m) => m.reason === 'handover').length;
      const ex = P.decide('extras', {
        question: P.t('Was darf Lotse dafür außerdem tun?', 'What else may Lotse do for it?'), multi: true,
        options: [
          { id: 'pull', label: P.t('Freie Zeit füllen', 'Fill free time'), detail: P.t(`${nSooner} spätere ${plural(nSooner, 'Story', 'Stories')} nach vorne holen – ${plural(nSooner, 'wird', 'werden')} früher fertig`, `bring ${nSooner} later ${plural(nSooner, 'story', 'stories')} forward – ${plural(nSooner, 'finishes', 'finish')} sooner`), facts: [fact('n', nSooner)], recommended: nSooner > 0, disabled: !nSooner },
          { id: 'handover', label: P.t('Übergeben, was zu spät käme', 'Hand over what would be late'), detail: P.t(`${nHand} ${plural(nHand, 'Story', 'Stories')} an Teamkolleg:innen mit Luft`, `${nHand} ${plural(nHand, 'story', 'stories')} to team colleagues with room`), facts: [fact('n', nHand)], recommended: nHand > 0, disabled: !nHand || !can.plan(ctx) },
          { id: 'nothing', label: P.t('Nur verschieben', 'Only move'), detail: P.t('keine Übergaben, nichts nach vorne', 'no handovers, nothing forward') },
        ],
      });
      if (ex === undefined) return;
      const pick = new Set([].concat(ex));
      const opts = { people: [pid], order, realistic, estimates, pull: pick.has('pull'), handover: pick.has('handover'), fixWeeks: 12 };
      let r = replan(ctx, opts);
      const subj = { kind: 'person', ref: pid, name: personLabel(ctx, pid) || P.t('Ich', 'Me') };
      P.storyObj('story:plan', planStory(ctx, r, pid, null));
      if (r.moves.length) P.storyObj('story:moves', movesStory(ctx, r, subj));
      const lt = lateStep(P, r);
      if (lt === null) return;
      if (lt.lock.length) { r = replan(ctx, { ...opts, lock: lt.lock }); P.storyObj('story:plan2', planStory(ctx, r, pid, null)); }
      const cmds = [...estCmds, ...planBatch(P, r, 'cmd:plan', P.t('Neue Fenster in Jira setzen', 'Set the new windows in Jira'))];
      // the next job in the same run: this week's missing bookings (own week only)
      if (me && meId(ctx)) {
        const pr2 = bookingProposals(ctx);
        if (pr2.list.length) {
          const b = P.decide('book', {
            question: P.t(`Außerdem fehlen Buchungen in dieser Woche – ${P.F.h(pr2.total, 2)} aus deinem Plan nachtragen?`, `Bookings are also missing this week – log ${P.F.h(pr2.total, 2)} from your plan?`), facts: [fact('h', pr2.total)],
            options: [{ id: 'book', label: P.t('Ja, nachtragen', 'Yes, log them'), detail: P.t(`${pr2.list.length} ${plural(pr2.list.length, 'Buchung', 'Buchungen')}`, `${pr2.list.length} ${plural(pr2.list.length, 'booking', 'bookings')}`), facts: [fact('n', pr2.list.length)] }, { id: 'skip', label: P.t('Nicht jetzt', 'Not now'), recommended: true }],
            proposals: pr2.list.map((x) => ({ key: x.key, date: x.d, hours: x.h })),
          });
          if (b === undefined) return;
          if (optOf(b) === 'book') cmds.push({ id: 'cmd:book', command: 'booking.book', params: { items: pr2.list.map((x) => ({ issue: x.issueId, date: x.d, hours: x.h })) }, title: P.t('Zeit buchen', 'Log time') });
        }
      }
      if (!cmds.length) { P.summary(P.t('Deine Woche passt schon – nichts zu ändern.', 'Your week already fits – nothing to change.')); return; }
      const why = blockedWhy(ctx, 'plan.move');
      P.batch('preview', cmds);
      P.summary(why ? P.t('Den Plan in Jira ändern darf, wer die Wochenplanung ändern darf – zeig deiner Teamleitung diese Vorschau.', 'Changing the plan in Jira needs the right to change weekly planning – show this preview to your team lead.') : null);
    },
  };

  // ---------- a team planned realistically ----------
  const teamPlan = {
    id: 'teamPlan', title: (L) => T(L, 'Team realistisch planen', 'Plan a team realistically'), params: ['team'],
    match: [
      /\b(plane?|verteile?|allokier\w*|ressourcen\w*|plan|allocate|distribute|staff|level)\b.{0,40}\b(team\w*)\b.{0,40}\b(realistisch\w*|realistic\w*|ohne (ueberstunden|ueberlast)|without overtime|nach prioritaet\w*|by priorit\w*|fair\w*|100 ?%?)\b/,
      /\b(realistisch\w*|realistic\w*)\b.{0,30}\b(team-?)?(plan\w*|planung|verteil\w*|allokation|allocation|ressourcen\w*|resource\w*)\b/,
      /\b(ressourcen|resources)\b.{0,30}\b(realistisch|realistic\w*|verteilen|allocate|planen)\b/,
      /\b(ohne|without)\b.{0,10}\b(ueberstunden|overtime)\b.{0,40}\b(plan\w*|verteil\w*|allocat\w*)\b/,
    ],
    plan(P, { team = null }) {
      const { ctx } = P;
      const L = P.L;
      const rc = rcOf(ctx, L);
      let tm = team;
      if (!tm) {
        const ppl = [...capacityPeople(computedOf(ctx).model).values()];
        const cand = rc.teams.filter((t) => computedOf(ctx).model.teams.has(t.teamId) && ppl.some((p) => inTeam(p, t.teamId))).sort((a, b) => b.totals.overtime - a.totals.overtime).slice(0, 6);
        if (!cand.length) { P.summary(P.t('Es gibt keine Teams mit Kapazität im Cockpit.', 'There are no teams with capacity in the cockpit.')); return; }
        const a = P.decide('team', {
          question: P.t('Welches Team soll Lotse realistisch planen?', 'Which team should Lotse plan realistically?'),
          options: cand.map((t, k) => ({ id: t.teamId, label: t.name, detail: P.t(`${P.F.h(t.totals.overtime)} Überstunden in 12 Wochen, wenn alles bleibt`, `${P.F.h(t.totals.overtime)} of overtime in 12 weeks if nothing changes`), facts: [fact('overtime', Math.round(t.totals.overtime)), fact('weeks', 12)], recommended: k === 0 })),
        });
        if (a === undefined) return;
        tm = optOf(a);
      }
      P.story('story:real', 'realCapacity', { team: tm });
      const rt = rc.teams.find((t) => t.teamId === tm);
      const cur = computedOf(ctx).support?.teams?.find((t) => t.teamId === tm)?.weekly ?? null;
      const p80 = rt?.support?.p80 ?? null;
      const cmds = [];
      if (p80 != null && rt.support.source !== 'none' && (cur == null || Math.abs(cur - p80) >= 0.5)) {
        const why = blockedWhy(ctx, 'support.reserve');
        const a = P.decide('reserve', {
          question: P.t(`Support lässt sich nicht schätzen – in 8 von 10 Wochen braucht ${teamLabel(ctx, tm)} bis ${String(p80).replace('.', ',')} h. Reserve so setzen?`, `Support cannot be estimated – in 8 of 10 weeks ${teamLabel(ctx, tm)} needs up to ${p80} h. Set the reserve to that?`),
          facts: [fact('p80', p80), fact('eight', 8), fact('ten', 10), ...(cur != null ? [fact('cur', Math.round(cur * 10) / 10)] : [])],
          options: [
            { id: 'p80', label: P.t(`Reserve ${String(p80).replace('.', ',')} h/Woche`, `Reserve ${p80} h/week`), detail: why || P.t('Projekte planen dann nur mit der Zeit, die nach dem Support wirklich bleibt', 'projects then plan only with the time really left after support'), facts: [fact('p80', p80)], recommended: !why, disabled: !!why },
            { id: 'keep', label: cur != null ? P.t(`Bei ${String(Math.round(cur * 10) / 10).replace('.', ',')} h bleiben`, `Keep ${Math.round(cur * 10) / 10} h`) : P.t('So lassen', 'Leave as is'), facts: cur != null ? [fact('cur', Math.round(cur * 10) / 10)] : [], recommended: !!why },
          ],
        });
        if (a === undefined) return;
        if (optOf(a) === 'p80') cmds.push({ id: 'cmd:reserve', command: 'support.reserve', params: { teamId: tm, hours: p80 }, title: P.t('Support-Reserve setzen', 'Set the support reserve') });
      }
      const ord = P.decide('order', {
        question: P.t('Wer bekommt zuerst Zeit?', 'Who gets time first?'),
        options: [{ id: 'rank', label: P.t('Nach Projekt-Rang', 'By project rank'), detail: P.t('die Prioritäten des Portfolios', 'the portfolio\'s priorities'), recommended: true }, { id: 'due', label: P.t('Fälliges zuerst', 'Due work first'), detail: P.t('überfällig, dann nach Due Date', 'overdue, then by due date') }],
      });
      if (ord === undefined) return;
      const order = optOf(ord);
      const probe = replan(ctx, { team: tm, order, realistic: true, handover: true, fixWeeks: 12 });
      const nHand = probe.moves.filter((m) => m.reason === 'handover').length;
      const hv = P.decide('handover', {
        question: P.t('Darf Lotse Arbeit im Team umverteilen?', 'May Lotse move work between people in the team?'),
        options: [
          { id: 'yes', label: P.t('Ja, an wer Luft hat', 'Yes, to whoever has room'), detail: P.t(`${nHand} ${plural(nHand, 'Übergabe', 'Übergaben')} statt später fertig`, `${nHand} ${plural(nHand, 'handover', 'handovers')} instead of finishing later`), facts: [fact('n', nHand)], recommended: nHand > 0, disabled: !nHand },
          { id: 'no', label: P.t('Nein, jede Person behält ihre Arbeit', 'No, everyone keeps their work'), recommended: !nHand },
        ],
      });
      if (hv === undefined) return;
      const opts = { team: tm, order, realistic: true, handover: optOf(hv) === 'yes', fixWeeks: 12 };
      let r = replan(ctx, opts);
      const subj = { kind: 'team', ref: tm, name: teamLabel(ctx, tm) || tm };
      P.storyObj('story:plan', planStory(ctx, r, null, tm));
      if (r.moves.length) P.storyObj('story:moves', movesStory(ctx, r, subj));
      const lt = lateStep(P, r);
      if (lt === null) return;
      if (lt.lock.length) { r = replan(ctx, { ...opts, lock: lt.lock }); P.storyObj('story:plan2', planStory(ctx, r, null, tm)); }
      cmds.push(...planBatch(P, r, 'cmd:plan', P.t('Neue Fenster in Jira setzen', 'Set the new windows in Jira')));
      if (!cmds.length) { P.summary(P.t(`${teamLabel(ctx, tm)} ist schon realistisch geplant – nichts zu ändern.`, `${teamLabel(ctx, tm)} is already planned realistically – nothing to change.`)); return; }
      P.batch('preview', cmds);
      P.summary();
    },
  };
  return [balanceWeek, teamPlan];
}
