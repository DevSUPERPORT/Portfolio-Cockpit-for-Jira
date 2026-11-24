// Jahres-Check (user 2026-11-17: "allow Lotse and Forge LLM to scan the year+ plan … calculating all possible issues –
// days off, holidays"): the next 12 months of one project (or the top of the portfolio), from the same numbers as the
// Jahresprognose (shared/yearPlan.js): work after the due date, people over 100 % in a month, weeks with planned work
// but no time (absence, public holidays, company days off), hours without a time frame. With AI on, Forge LLM reads
// this verified story like every Lotse story (lotse.llm reading + code cross-check) – it never sees raw data.
import { projectYear } from '../../yearPlan.js';
import { computedOf, dsOf, newStory, addProject, addPerson, kpi, ev, finding, follow, done, infoStory, pickProject, T, worst } from '../kit.js';
import { plural } from '../narrate.js';
import { isoWeekNo } from '../story.js';

const MON = { de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'], en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] };

const MONTHS = 12;
const MAX_PROJECTS = 8;
const EPS = 0.05;

export default {
  id: 'yearCheck',
  title: (L) => T(L, 'Jahres-Check', 'Year check'),
  params: ['project'],
  match: [/jahres(plan\w*|prognose|check|ausblick|vorschau|sicht)|(naechste[nr]?|kommende[nr]?) (12|zwoelf) monate|ein(em)? jahr (voraus|im voraus)|year[- ]?(plan\w*|projection|ahead|outlook|check|view)|(next|coming) (12|twelve) months|(pruef|check|scan|durchsuch)\w*.{0,40}\b(jahr|year|langfrist\w*|long[- ]term|12 monat\w*)|plan.{0,20}\b(ein jahr|a year|12 months)\b.{0,20}(voraus|ahead)/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const ds = dsOf(ctx);
    const { model } = c;
    const one = pickProject(ctx, p);
    const items = one ? [one] : [...model.items].sort((a, b) => a.rank - b.rank).slice(0, MAX_PROJECTS);
    if (!items.length) return infoStory(ctx, { skill: 'yearCheck', lang: L, subject: { kind: 'portfolio', ref: null, name: 'Portfolio' }, headline: T(L, 'Im Portfolio sind keine Projekte.', 'There are no projects in the portfolio.'), finding: T(L, 'Projekte ins Portfolio aufnehmen, dann prüft Lotse das Jahr.', 'Add projects to the portfolio, then Lotse checks the year.') });
    const ys = items.map((it) => ({ it, y: projectYear({ ds, computed: c, project: it.ref, months: MONTHS }) }));
    const s = newStory(ctx, { skill: 'yearCheck', subject: one ? { kind: 'project', ref: one.ref, name: one.name } : { kind: 'portfolio', ref: null, name: 'Portfolio' }, lang: L });
    const F = s.fmt;
    const mName = (k) => `${MON[L === 'en' ? 'en' : 'de'][+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
    const wName = (iso) => `${T(L, 'KW', 'W')} ${isoWeekNo(iso)}`;
    // 1. work after the due date
    const late = ys.filter(({ y }) => y.late > 0.5).sort((a, b) => b.y.late - a.y.late);
    // 2. people over 100 % in a month (their whole load – every project, support), once per person and month
    const pm = new Map();
    for (const { y } of ys) for (const r of y.rows) if (r.kind === 'person') r.cells.forEach((cell, i) => { const k = `${r.accountId}|${i}`; if (!pm.has(k) && cell.own > EPS) pm.set(k, { id: r.accountId, name: r.name, month: y.months[i].key, util: cell.util, load: cell.load, avail: cell.avail }); });
    const over = [...pm.values()].filter((x) => x.util > 1.005);
    const overPeople = [...new Set(over.map((x) => x.id))];
    // 3. weeks with planned work but no time: absence, public holidays, company days off (weekly, so a holiday week shows)
    const noTime = [];
    for (const { it, y } of ys) for (const x of y.noTime) noTime.push({ ...x, ref: it.ref, key: it.key });
    const byPW = new Map();
    for (const x of noTime) { const k = `${x.id}|${x.week}`; const e = byPW.get(k) || byPW.set(k, { ...x, hours: 0, keys: [] }).get(k); e.hours += x.hours; e.keys.push(x.key); }
    const noTimeW = [...byPW.values()];
    // 4. hours without a time frame (no start/due, or beyond 12 months)
    const unplanned = ys.reduce((a, { y }) => a + (y.remaining != null ? Math.max(0, y.remaining - y.planned) : 0), 0);
    const planned = ys.reduce((a, { y }) => a + y.planned, 0);
    // live E2E 2026-11-23 (1,400 demo items): a story keeps 4 key figures and 4 findings (kit.done) – the headline's three
    // counts come first, so every number the headline names keeps its source; the rest only when there is room
    const kLate = kpi('lateProjects', T(L, 'Projekte nach dem Due', 'Projects after due'), late.length, 'n', { tone: late.length ? 'bad' : 'ok' });
    const kNoTime = kpi('noTime', T(L, 'Wochen ohne Zeit, aber mit Arbeit', 'Weeks without time but with work'), noTimeW.length, 'n', { tone: noTimeW.length ? 'bad' : 'ok' });
    const kOver = kpi('over', T(L, 'Personen über 100 %', 'People above 100%'), overPeople.length, 'n', { tone: overPeople.length ? 'warn' : 'ok' });
    const kPlanned = kpi('planned', T(L, `Geplant in ${MONTHS} Monaten`, `Planned in ${MONTHS} months`), Math.round(planned), 'h');
    const kHours = kpi('late', T(L, 'Nach dem Due', 'After the due date'), Math.round(late.reduce((a, x) => a + x.y.late, 0)), 'h', { tone: late.length ? 'bad' : 'ok' });
    const kMonths = kpi('months', T(L, 'Monate geprüft', 'Months checked'), MONTHS, 'n');
    const anyProblem = late.length || noTimeW.length || overPeople.length;
    // with problems the headline names the three counts; without, it names the months and the planned hours
    s.kpis.push(...(anyProblem ? [kLate, kNoTime, kOver, kPlanned, kHours, kMonths] : [kPlanned, kMonths, kLate, kNoTime, kOver, kHours]));
    const otherCards = (noTimeW.length ? 1 : 0) + (overPeople.length ? 1 : 0);
    for (const x of late.slice(0, Math.max(1, Math.min(3, 4 - otherCards)))) {
      addProject(s, x.it);
      // work beyond the horizon: "done" is not the last month shown (E2E audit 2026-11-17)
      const end = x.y.runsPast ? T(L, `läuft über ${MONTHS} Monate hinaus`, `runs beyond ${MONTHS} months`) : T(L, `fertig laut Plan erst ${mName(x.y.lastMonth)}`, `done per plan only in ${mName(x.y.lastMonth)}`);
      s.findings.push(finding(T(L, `${x.it.name}: ${F.h(x.y.late)} liegen nach dem Due (${F.date(x.y.due)}) – ${end}.`, `${x.it.name}: ${F.h(x.y.late)} lie after the due date (${F.date(x.y.due)}) – ${end}.`), 'bad', 95,
        [ev(T(L, 'nach dem Due', 'after due'), Math.round(x.y.late), 'h', { ref: x.it.ref }), ev('Due', x.y.due, 'date', { ref: x.it.ref }), ...(x.y.runsPast ? [] : [ev(T(L, 'fertig laut Plan', 'done per plan'), `${x.y.lastMonth}-01`, 'date')])]));
    }
    if (noTimeW.length) {
      const top = [...noTimeW].sort((a, b) => b.hours - a.hours).slice(0, 3);
      for (const x of top) addPerson(s, ctx, x.id);
      s.findings.push(finding(T(L, `${noTimeW.length} ${plural(noTimeW.length, 'Woche hat', 'Wochen haben')} geplante Arbeit, aber keine Zeit (Abwesenheit, Feiertage): ${top.map((x) => `${x.name || 'Person'} ${wName(x.week)} (${F.h(x.hours, 1)}: ${x.keys.join(', ')})`).join('; ')}.`, `${noTimeW.length} ${plural(noTimeW.length, 'week has', 'weeks have')} planned work but no time (absence, holidays): ${top.map((x) => `${x.name || 'person'} ${wName(x.week)} (${F.h(x.hours, 1)}: ${x.keys.join(', ')})`).join('; ')}.`), 'bad', 90,
        [ev(T(L, 'Wochen', 'weeks'), noTimeW.length, 'n'), ...top.map((x) => ev(x.name || 'Person', Math.round(x.hours * 10) / 10, 'h', { ref: `person:${x.id}`, date: x.week }))]));
    }
    if (overPeople.length) {
      const peak = new Map(); for (const x of over) if (!peak.has(x.id) || x.util > peak.get(x.id).util) peak.set(x.id, x);
      const worstP = [...peak.values()].sort((a, b) => b.util - a.util).slice(0, 3);
      for (const x of worstP) addPerson(s, ctx, x.id);
      s.findings.push(finding(T(L, `${overPeople.length} ${plural(overPeople.length, 'Person liegt', 'Personen liegen')} in mindestens einem Monat über 100 %, am höchsten ${worstP.map((x) => `${x.name || 'Person'} ${mName(x.month)} (${Number.isFinite(x.util) ? Math.round(x.util * 100) : '–'} %)`).join(', ')}.`, `${overPeople.length} ${plural(overPeople.length, 'person is', 'people are')} above 100% in at least one month, highest ${worstP.map((x) => `${x.name || 'person'} ${mName(x.month)} (${Number.isFinite(x.util) ? Math.round(x.util * 100) : '–'}%)`).join(', ')}.`), 'warn', 80,
        [ev(T(L, 'Personen', 'people'), overPeople.length, 'n'), ev(T(L, 'Ziel', 'target'), 100, '%'), ...worstP.filter((x) => Number.isFinite(x.util)).map((x) => ev(x.name || T(L, 'Person', 'person'), Math.round(x.util * 100), '%', { ref: `person:${x.id}`, date: `${x.month}-01` }))]));
    }
    if (unplanned > 0.5) s.findings.push(finding(T(L, `${F.h(unplanned)} Restschätzung haben keinen Zeitraum (ohne Start/Due oder später als ${MONTHS} Monate) – die Prognose kennt sie nicht.`, `${F.h(unplanned)} of remaining estimate have no time frame (no start/due or later than ${MONTHS} months) – the projection does not know them.`), 'warn', 60,
      [ev(T(L, 'ohne Zeitraum', 'no time frame'), Math.round(unplanned), 'h'), ev(T(L, 'Monate', 'months'), MONTHS, 'n')]));
    if (!s.findings.length) s.findings.push(finding(T(L, `Im nächsten Jahr passt alles: keine Arbeit nach dem Due, niemand über 100 %, keine Woche mit Arbeit ohne Zeit.`, `The next year fits: no work after the due date, nobody above 100%, no week with work but no time.`), 'ok', 50, [ev(T(L, 'Ziel', 'target'), 100, '%')]));
    // the year at a glance: project hours per month (the top projects)
    const months = ys[0].y.months.map((m) => mName(m.key));
    s.visual = {
      kind: 'heat',
      data: { unit: 'h', cols: months, rows: ys.slice(0, 8).map(({ it, y }) => { addProject(s, it); return { label: it.key || it.name, values: y.total.map((h) => Math.round(h)) }; }) },
      caption: T(L, `Projektstunden je Monat in den nächsten ${MONTHS} Monaten – wie die Jahresprognose im Projekt.`, `Project hours per month over the next ${MONTHS} months – as in the project's year projection.`),
    };
    const nBad = late.length + (noTimeW.length ? 1 : 0), nWarn = overPeople.length ? 1 : 0;
    s.headline = !nBad && !nWarn
      ? T(L, `Die nächsten ${MONTHS} Monate passen – ${F.h(planned)} geplant, kein Konflikt gefunden.`, `The next ${MONTHS} months fit – ${F.h(planned)} planned, no conflict found.`)
      : (() => {
        const parts = [];
        if (late.length) parts.push(T(L, `${late.length} ${plural(late.length, 'Projekt endet', 'Projekte enden')} nach dem Due`, `${late.length} ${plural(late.length, 'project ends', 'projects end')} after the due date`));
        if (noTimeW.length) parts.push(T(L, `${noTimeW.length} ${plural(noTimeW.length, 'Woche', 'Wochen')} mit Arbeit ohne Zeit`, `${noTimeW.length} ${plural(noTimeW.length, 'week', 'weeks')} with work but no time`));
        if (overPeople.length) parts.push(T(L, `${overPeople.length} ${plural(overPeople.length, 'Person', 'Personen')} über 100 %`, `${overPeople.length} ${plural(overPeople.length, 'person', 'people')} above 100%`));
        return `${T(L, 'Jahres-Check', 'Year check')}: ${parts.join(', ')}.`;
      })();
    s.tone = worst(...s.findings.map((f) => (f.tone === 'info' ? null : f.tone)));
    s.followUps.push(
      follow(T(L, 'Überstunden', 'Overtime'), T(L, 'Wer hat zu viel Arbeit?', 'Who has too much work?')),
      follow(T(L, 'Wasserlinie', 'Waterline'), T(L, 'Wo reicht die Kapazität nicht?', 'Where is capacity short?')),
    );
    s.how = { text: T(L, `Gerechnet wie die Jahresprognose im Projekt: die Wochenplanung über ${MONTHS} Monate (Start, Due, Original Estimate; Abwesenheiten, Feiertage und Betriebsruhe je Standort), je Monat summiert. „Ohne Zeit“ = eine Woche, in der eine Person Arbeit hat, aber 0 h verfügbar sind.`, `Calculated like the project's year projection: the weekly planning over ${MONTHS} months (start, due, original estimate; absences, public holidays and company days off per location), summed per month. "No time" = a week in which a person has work but 0 h available.`), inputs: [[T(L, 'Projekte', 'Projects'), String(items.length)], [T(L, 'Monate', 'Months'), String(MONTHS)]] };
    s.confidence = 'high';
    s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity')];
    return done(s);
  },
};
