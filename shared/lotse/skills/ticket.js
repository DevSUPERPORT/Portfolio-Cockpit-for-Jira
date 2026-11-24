// "PCX-45" / "Wo steht PCX-45?" / "Wann ist PCX-45 dran?" (tester 2026-11-17: a bare key answered "no similar finished
// work"): where and when the work item is planned – the weeks and hours from the weekly planning (the board's own split),
// who has it and how full that person is then, and what is wrong with it (start after due, past due, assignee outside
// the team, a blocks conflict). Estimating like before stays one follow-up away.
import { buildBoard, conflicts, datesInverted } from '../../weekPlan.js';
import { memberStatus } from '../../teamMembership.js';
import { dayIdx } from '../../dates.js';
import { computedOf, dsOf, newStory, addProject, addPerson, addTeam, kpi, ev, finding, follow, done, infoStory, isOpen, T, worst, teamName } from '../kit.js';
import { plural } from '../narrate.js';
import { isoWeekNo } from '../story.js';

const WEEKS = 26;
const EPS = 0.05;

export default {
  id: 'ticket',
  title: (L) => T(L, 'Wo steht der Vorgang?', 'Where is this work item?'),
  params: ['key'],
  match: [/\b(wo steht|wo ist|wann (ist|wird|kommt|kommen|startet|beginnt)|stand (von|bei)|status (von|of)|where is|when (is|will|does)|eingeplant|geplant fuer|planned for)\b/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const ds = dsOf(ctx);
    const { model } = c;
    const i = p?.key ? (ds.issues || []).find((x) => x.key === p.key) : null;
    if (!i) {
      return infoStory(ctx, { skill: 'ticket', lang: L, headline: T(L, p?.key ? `${p.key} ist nicht in den Cockpit-Daten.` : 'Welcher Vorgang? Nenne einen Jira-Key.', p?.key ? `${p.key} is not in the cockpit data.` : 'Which work item? Name a Jira key.'),
        finding: T(L, 'Lotse kennt die Vorgänge der Projekte im Portfolio, die du sehen darfst – z. B. „Wo steht“ mit dem Key dahinter.', 'Lotse knows the work items of the portfolio projects you may see – e.g. "Where is" followed by the key.') });
    }
    const s = newStory(ctx, { skill: 'ticket', subject: { kind: 'ticket', ref: i.key, name: i.key }, lang: L });
    s.id = `ticket:${i.key}`;
    const F = s.fmt;
    const it = model.itemByRef.get(i.rootRef);
    if (it) addProject(s, it);
    const who = i.assignee?.anon ? null : i.assignee?.id || null;
    if (who) addPerson(s, ctx, who);
    if (i.team?.id && model.teams.has(i.team.id)) addTeam(s, model, i.team.id);
    const keyEv = ev(T(L, 'Vorgang', 'work item'), undefined, null, { key: i.key });
    const whoName = i.assignee?.anon ? T(L, 'eine weitere Person', 'another person') : i.assignee?.name || T(L, 'niemand', 'nobody');
    const wk = (iso) => `${T(L, 'KW', 'W')} ${isoWeekNo(iso)}`;
    const open = isOpen(i);
    // the weekly planning's own numbers (the configured distribution), over half a year
    const board = open ? buildBoard({ ds, computed: c, weeks: WEEKS, distribution: ds.config?.rules?.distribution === 'capacity' ? 'capacity' : 'even' }) : null;
    const t = board?.taskById.get(i.id) || null;
    const used = t ? t.hours.map((h, k) => ({ k, h, monday: board.weeks[k].from })).filter((x) => x.h > EPS) : [];
    const planned = used.reduce((a, x) => a + x.h, 0);
    s.kpis.push(kpi('oe', 'Original Estimate', i.oe || 0, 'h'));
    if (Number.isFinite(i.re)) s.kpis.push(kpi('re', T(L, 'Restschätzung', 'Remaining estimate'), i.re, 'h'));
    s.kpis.push(kpi('weeks', T(L, 'Wochen eingeplant', 'Weeks planned'), used.length, 'n'));
    const dateEv = [...(i.start ? [ev('Start', i.start, 'date')] : []), ...(i.due ? [ev('Due', i.due, 'date')] : [])];
    const window = `${i.start ? `Start ${F.date(i.start)}` : T(L, 'ohne Start', 'no start')}, ${i.due ? `Due ${F.date(i.due)}` : T(L, 'ohne Due', 'no due date')}`;
    // 1. where and when
    let head;
    if (!open) {
      head = T(L, `${i.key} ist erledigt – nichts mehr eingeplant.`, `${i.key} is done – nothing planned any more.`);
      s.findings.push(finding(T(L, `${i.key} „${i.summary || ''}“ ist erledigt (${window}).`, `${i.key} "${i.summary || ''}" is done (${window}).`), 'ok', 60, [keyEv, ...dateEv]));
    } else if (!(i.oe > 0)) {
      head = T(L, `${i.key} ist nicht eingeplant – es fehlt der Original Estimate.`, `${i.key} is not planned – the original estimate is missing.`);
      s.findings.push(finding(T(L, `Ohne Original Estimate verteilt die Wochenplanung keine Stunden (${window}).`, `Without an original estimate the weekly planning spreads no hours (${window}).`), 'warn', 85, [keyEv, ev('Original Estimate', 0, 'h'), ...dateEv]));
    } else if (!used.length) {
      const later = i.start && dayIdx(i.start) > board.weeks[board.weeks.length - 1].b;
      head = later ? T(L, `${i.key} beginnt erst nach den nächsten ${WEEKS} Wochen.`, `${i.key} starts only after the next ${WEEKS} weeks.`) : T(L, `${i.key} hat keine Stunden in den nächsten ${WEEKS} Wochen.`, `${i.key} has no hours in the next ${WEEKS} weeks.`);
      s.findings.push(finding(T(L, `${F.h(i.oe, 1)} Original Estimate, ${window}.`, `${F.h(i.oe, 1)} original estimate, ${window}.`), 'info', 70, [keyEv, ev('Original Estimate', i.oe, 'h'), ev(T(L, 'Wochen', 'weeks'), WEEKS, 'n'), ...dateEv]));
    } else {
      const span = used.length === 1 ? wk(used[0].monday) : `${wk(used[0].monday)}–${wk(used[used.length - 1].monday)}`;
      head = T(L, `${i.key} ist in ${span} eingeplant – ${F.h(planned, 1)} bei ${whoName}.`, `${i.key} is planned in ${span} – ${F.h(planned, 1)} with ${whoName}.`);
      s.findings.push(finding(T(L, `${used.length} ${plural(used.length, 'Woche', 'Wochen')} mit zusammen ${F.h(planned, 1)} (${window}), Original Estimate ${F.h(i.oe, 1)}.`, `${used.length} ${plural(used.length, 'week', 'weeks')} with ${F.h(planned, 1)} in total (${window}), original estimate ${F.h(i.oe, 1)}.`), 'info', 75,
        [keyEv, ev(T(L, 'Wochen', 'weeks'), used.length, 'n'), ev(T(L, 'eingeplant', 'planned'), Math.round(planned * 10) / 10, 'h'), ev('Original Estimate', i.oe, 'h'), ...dateEv]));
      s.visual = { kind: 'bars', data: { unit: 'h', items: used.slice(0, 12).map((x) => ({ label: wk(x.monday), value: Math.round(x.h * 10) / 10, tone: 'ink' })) }, caption: T(L, 'Stunden je Woche – wie in der Wochenplanung.', 'Hours per week – as in the weekly planning.') };
      // 2. how full the assignee is then
      if (who && board.personWeeks) {
        const pw = board.personWeeks(who);
        const util = used.map((x) => ({ ...x, u: pw[x.k].avail > EPS ? pw[x.k].load / pw[x.k].avail : Infinity }));
        const over = util.filter((x) => x.u > 1.005);
        if (over.length) {
          const peak = over.reduce((a, x) => (x.u > a.u ? x : a));
          const peakTxt = Number.isFinite(peak.u) ? `${Math.round(peak.u * 100)} %` : T(L, 'keine Zeit', 'no time');
          s.findings.push(finding(T(L, `${whoName} ist in ${over.length} dieser ${plural(over.length, 'Woche', 'Wochen')} über 100 % (am meisten ${wk(peak.monday)}: ${peakTxt}).`, `${whoName} is above 100 % in ${over.length} of these ${plural(over.length, 'week', 'weeks')} (most in ${wk(peak.monday)}: ${peakTxt}).`), 'warn', 88,
            [ev(T(L, 'Wochen über 100 %', 'weeks above 100 %'), over.length, 'n'), ev(T(L, 'Grenze', 'limit'), 100, '%'), ...(Number.isFinite(peak.u) ? [ev(T(L, 'höchste Auslastung', 'peak load'), Math.round(peak.u * 100), '%', { ref: `person:${who}`, date: peak.monday })] : [])]));
        } else {
          const peak = util.reduce((a, x) => (x.u > a.u ? x : a), util[0]);
          s.findings.push(finding(T(L, `${whoName} hat in diesen Wochen Platz – höchstens ${Math.round(peak.u * 100)} % ausgelastet.`, `${whoName} has room in these weeks – at most ${Math.round(peak.u * 100)} % loaded.`), 'ok', 55,
            [ev(T(L, 'höchste Auslastung', 'peak load'), Math.round(peak.u * 100), '%', { ref: `person:${who}` })]));
        }
      }
    }
    // 3. what is wrong with it
    if (open && datesInverted({ start: i.start, due: i.due })) {
      s.findings.push(finding(T(L, `Start (${F.date(i.start)}) liegt nach dem Due Date (${F.date(i.due)}) – die Planung bucht alles in die Due-Woche, bis die Termine stimmen.`, `Start (${F.date(i.start)}) is after the due date (${F.date(i.due)}) – planning books everything into the due week until the dates are right.`), 'bad', 95, [keyEv, ...dateEv]));
    }
    if (open && i.due && dayIdx(i.due) < model.today) {
      s.findings.push(finding(T(L, `Das Due Date (${F.date(i.due)}) ist schon vorbei.`, `The due date (${F.date(i.due)}) has passed.`), 'bad', 92, [ev('Due', i.due, 'date')]));
    }
    if (open && who && i.team?.id && memberStatus(model, who, i.team.id) === 'outside') {
      s.findings.push(finding(T(L, `${whoName} ist nicht im Team ${teamName(model, i.team.id) || ''}, zu dem ${i.key} gehört.`, `${whoName} is not in team ${teamName(model, i.team.id) || ''}, which ${i.key} belongs to.`), 'warn', 80, [keyEv, ev(T(L, 'Team', 'team'), undefined, null, { ref: `team:${i.team.id}` })]));
    }
    if (open) {
      const conf = conflicts({ model, deps: c.deps, scope: (x) => x.pre.id === i.id || x.dep.id === i.id });
      for (const x of conf.slice(0, 2)) {
        const other = x.pre.id === i.id ? x.dep : x.pre;
        s.findings.push(finding(x.dep.id === i.id ? T(L, `${i.key} startet, bevor ${other.key} fertig ist (Blocks).`, `${i.key} starts before ${other.key} is done (blocks).`) : T(L, `${other.key} wartet auf ${i.key} und startet zu früh (Blocks).`, `${other.key} waits for ${i.key} and starts too early (blocks).`), 'warn', 78,
          [keyEv, ev(other.key, undefined, null, { key: other.key })]));
      }
    }
    s.headline = head;
    // no weeks to show (done, no estimate, later than the range): the key facts as a small chart instead
    if (!s.visual) s.visual = { kind: 'bars', data: { unit: 'h', items: [{ label: 'Original Estimate', value: Math.round((i.oe || 0) * 10) / 10, tone: 'ink' }, ...(Number.isFinite(i.re) ? [{ label: T(L, 'Restschätzung', 'Remaining estimate'), value: Math.round(i.re * 10) / 10, tone: 'ink' }] : [])] }, caption: T(L, `In den nächsten ${WEEKS} Wochen ohne Stunden in der Wochenplanung.`, `No hours in the weekly planning in the next ${WEEKS} weeks.`) };
    s.tone = worst(...s.findings.map((f) => (f.tone === 'info' ? null : f.tone)));
    s.followUps.push(
      follow(T(L, 'Schätzen wie früher', 'Estimate like before'), T(L, `Schätze wie früher: ${i.key}`, `Estimate like before: ${i.key}`)),
      ...(it ? [follow(T(L, 'Projekt', 'Project'), T(L, `Wie steht ${it.name}?`, `How is ${it.name} doing?`))] : []),
    );
    s.how = { text: T(L, `Aus der Wochenplanung der nächsten ${WEEKS} Wochen (Start, Due, Original Estimate – verteilt wie im Board) und der Auslastung der Person über alle ihre Aufgaben.`, `From the weekly planning of the next ${WEEKS} weeks (start, due, original estimate – spread as on the board) and the person's load across all their tasks.`), inputs: [['Key', i.key], [T(L, 'Wochen', 'Weeks'), String(WEEKS)]] };
    s.confidence = 'high';
    s.sources = ['Jira', T(L, 'Wochenplanung', 'Weekly planning')];
    return done(s);
  },
};
