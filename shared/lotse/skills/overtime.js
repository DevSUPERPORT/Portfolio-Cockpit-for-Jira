// Overtime outlook (shared/insights.js overtimeOutlook): who is above 100 % realistic load in the next weeks, by how
// many hours, and which lowest-ranked work would have to move.
import { isoWeekNo } from '../story.js';
import { computedOf, ooOf, rcOf, newStory, addProject, addTeam, addPerson, kpi, ev, finding, action, follow, done, r1, pctPts, T, say, worst } from '../kit.js';
import { plural, list } from '../narrate.js';
import { pickTeam } from './teamBrief.js';

export default {
  id: 'overtime',
  title: (L) => T(L, 'Überstunden-Ausblick', 'Overtime outlook'),
  params: ['team'],
  match: [/ueberstunden|overtime|mehrarbeit|ueberlast|overload|ueber 100|above 100|burn ?out|zu viel arbeit|too much work|wer (arbeitet|ist) zu viel|who (works|is) too much|working too (much|long)|abends|weekends?|wochenende/],
  run(ctx, p, L) {
    const { model } = computedOf(ctx);
    const rc = rcOf(ctx, L);
    const oo = ooOf(ctx, L);
    const tid = pickTeam(ctx, p);
    const teams = tid ? oo.teams.filter((t) => t.teamId === tid) : oo.teams;
    const people = tid ? oo.people.filter((x) => x.teamId === tid) : oo.people;
    const n = oo.weeks.length;
    const hours = teams.reduce((a, t) => a + t.hours, 0);
    const s = newStory(ctx, { skill: 'overtime', subject: tid ? { kind: 'team', ref: tid, name: model.teams.get(tid)?.name || tid } : { kind: 'portfolio', ref: null, name: 'Portfolio' }, lang: L });
    const F = s.fmt;
    if (tid) addTeam(s, model, tid);
    s.kpis.push(kpi('teams', T(L, 'Teams über 100 %', 'Teams above 100%'), teams.length, 'n', { tone: teams.length ? 'bad' : 'ok' }));
    s.kpis.push(kpi('people', T(L, 'Personen über 100 %', 'People above 100%'), people.length, 'n', { tone: people.length ? 'warn' : 'ok' }));
    s.kpis.push(kpi('hours', T(L, 'Stunden zu viel', 'Hours too many'), hours, 'h', { tone: hours > 0 ? 'bad' : 'ok' }));
    s.kpis.push(kpi('weeks', T(L, 'Wochen betrachtet', 'Weeks looked at'), n, 'n'));
    const top = (tid ? rc.teams.filter((t) => t.teamId === tid) : [...rc.teams].sort((a, b) => b.totals.overtime - a.totals.overtime)).slice(0, 3);
    const labels = oo.weeks.map((w) => `${T(L, 'KW', 'W')} ${isoWeekNo(w.from)}`);
    s.visual = {
      kind: 'columns',
      data: { unit: 'h', labels, series: top.length ? top.map((t, i) => { addTeam(s, model, t.teamId); return { name: t.name, values: t.weekly.slice(0, n).map((w) => r1(w.overtime)), tone: ['bad', 'warn', 'info'][i] }; }) : [{ name: T(L, 'Überstunden', 'Overtime'), values: labels.map(() => 0), tone: 'ok' }] },
      caption: T(L, `Stunden über der realistischen Kapazität je Woche (nach Support-P80 und Schätzfaktor), die ${top.length} am stärksten belasteten Teams.`, `Hours above realistic capacity per week (after support P80 and the estimate factor), the ${top.length} most loaded teams.`),
    };
    for (const t of teams.slice(0, 3)) {
      addTeam(s, model, t.teamId);
      const mv = t.move.slice(0, 2);
      for (const m of mv) { const it = model.itemByRef.get(m.ref); if (it) addProject(s, it); }
      s.findings.push(finding(T(L, `Team ${t.name}: in ${t.overWeeks.length} von ${n} Wochen über 100 %${t.peakLoad != null ? ` (Spitze ${pctPts(t.peakLoad)} %)` : ''}, zusammen ${F.h(t.hours)} zu viel${mv.length ? `; entlasten würde: ${mv.map((m) => `Rang ${m.rank} ${m.name} (${F.h(m.hours)})`).join(', ')}` : ''}.`,
        `Team ${t.name}: above 100% in ${t.overWeeks.length} of ${n} weeks${t.peakLoad != null ? ` (peak ${pctPts(t.peakLoad)}%)` : ''}, ${F.h(t.hours)} too much in total${mv.length ? `; moving would relieve: ${mv.map((m) => `rank ${m.rank} ${m.name} (${F.h(m.hours)})`).join(', ')}` : ''}.`),
        'bad', Math.min(95, 60 + t.hours / 20),
        [ev(T(L, 'Wochen über 100 %', 'weeks above 100%'), t.overWeeks.length, 'n', { ref: `team:${t.teamId}` }), ev(T(L, 'Wochen', 'weeks'), n, 'n'), ev(T(L, 'zu viel', 'too much'), t.hours, 'h'), ...(t.peakLoad != null ? [ev(T(L, 'Spitze', 'peak'), pctPts(t.peakLoad), '%')] : []), ev('100 %', 100, '%'), ...mv.map((m) => ev(T(L, 'verschieben', 'move'), m.hours, 'h', { ref: m.ref }))]));
    }
    // E2E 2026-11-20: "4 teams and 0 people above 100%" – teams over while no single person is: say where it comes from
    if (teams.length && !people.length) {
      s.findings.push(finding(T(L, 'Keine einzelne Person ist über 100 % – die Überlast der Teams kommt aus Arbeit, die niemandem zugewiesen ist, aus Arbeit von Personen aus anderen Teams oder aus Team-Anteilen, die nicht zur Arbeit passen. Die Wochenplanung zeigt je rote Woche mit „Warum?“, woran es liegt.',
        'No single person is above 100% – the teams\' overload comes from work nobody is assigned to, work by people from other teams, or team shares that do not match the work. Weekly planning shows the reason for each red week under "Why?".'), 'info', 50,
        [ev(T(L, 'Personen über 100 %', 'people above 100%'), 0, 'n'), ev(T(L, 'Teams über 100 %', 'teams above 100%'), teams.length, 'n'), ev('100 %', 100, '%')]));
    }
    if (people.length) {
      const x = people[0];
      const who = addPerson(s, ctx, x.id);
      s.findings.push(finding(who ? T(L, `${people.length} ${plural(people.length, 'Person ist', 'Personen sind')} über 100 %, am stärksten ${who} mit ${F.h(x.hours)} in ${x.overWeeks.length} Wochen.`, `${people.length} ${plural(people.length, 'person is', 'people are')} above 100%, most of all ${who} with ${F.h(x.hours)} in ${x.overWeeks.length} weeks.`)
        : T(L, `${people.length} ${plural(people.length, 'Person ist', 'Personen sind')} über 100 % realistischer Auslastung.`, `${people.length} ${plural(people.length, 'person is', 'people are')} above 100% realistic load.`), 'warn', 58,
        [ev(T(L, 'Personen', 'people'), people.length, 'n'), ev(T(L, 'Stunden', 'hours'), x.hours, 'h'), ev(T(L, 'Wochen', 'weeks'), x.overWeeks.length, 'n'), ev('100 %', 100, '%')]));
    }
    if (!s.findings.length) s.findings.push(finding(T(L, `In den nächsten ${n} Wochen ist niemand über 100 % realistischer Auslastung.`, `Nobody is above 100% realistic load in the next ${n} weeks.`), 'ok', 10, [ev(T(L, 'Wochen', 'weeks'), n, 'n'), ev('100 %', 100, '%')]));
    s.tone = worst(...s.findings.map((f) => f.tone));
    s.headline = !teams.length && !people.length ? T(L, `Keine Überstunden in Sicht: in den nächsten ${n} Wochen passt alles in die realistische Kapazität.`, `No overtime ahead: everything fits realistic capacity in the next ${n} weeks.`)
      // E2E 2026-11-20: "4 teams and 0 people above 100%" read like a contradiction – name only what there is
      : say(s.id, 'h', [T(L, `In den nächsten ${n} Wochen drohen ${F.h(hours)} Überstunden – ${[teams.length ? `${teams.length} ${plural(teams.length, 'Team', 'Teams')}` : '', people.length ? `${people.length} ${plural(people.length, 'Person', 'Personen')}` : ''].filter(Boolean).join(' und ')} über 100 %.`, `${F.h(hours)} of overtime loom in the next ${n} weeks – ${[teams.length ? `${teams.length} ${plural(teams.length, 'team', 'teams')}` : '', people.length ? `${people.length} ${plural(people.length, 'person', 'people')}` : ''].filter(Boolean).join(' and ')} above 100%.`),
        T(L, `${teams.length} ${plural(teams.length, 'Team liegt', 'Teams liegen')} über der realistischen Kapazität, zusammen ${F.h(hours)} in ${n} Wochen.`, `${teams.length} ${plural(teams.length, 'team is', 'teams are')} above realistic capacity, ${F.h(hours)} over ${n} weeks.`)]);
    const mv = teams[0]?.move?.[0];
    if (mv) s.actions.push(action('whatIfLater', T(L, `Rang ${mv.rank} später?`, `Rank ${mv.rank} later?`), 'whatIf', { change: { kind: 'due', ref: mv.ref, weeks: 4 } }, T(L, `Rechnet durch, was 4 Wochen mehr Zeit für ${mv.name} an Überlast und Wasserlinie ändern – nichts wird gespeichert.`, `Works out what 4 more weeks for ${mv.name} change in overload and the waterline – nothing is saved.`)));
    s.actions.push(action('plan', T(L, 'Wochenplanung', 'Weekly plan'), 'navigate', { view: 'plan', ...(tid ? { teamId: tid } : {}) }, T(L, 'Öffnet die Wochenplanung mit „Optimieren“.', 'Opens the weekly plan with "Optimize".')));
    s.followUps.push(follow(T(L, 'Planungsvorschläge', 'Planning advice'), T(L, 'Planungsvorschläge', 'Planning advice')), follow(T(L, 'Was passt?', 'What fits?'), T(L, 'Was passt ohne Überstunden?', 'What fits without overtime?')), follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')));
    s.how = { text: T(L, 'Realistische Kapazität = verfügbare Stunden minus Support (P80 der Wochen); geplant = Restschätzung × Schätzfaktor (gebucht ÷ geschätzt erledigter Stories). Über 100 % = geplant über dem realistischen Raum der Woche. Entlasten: die Projekte mit dem niedrigsten Rang zuerst.', 'Realistic capacity = available hours minus support (P80 of the weeks); planned = remaining estimate × estimate factor (logged ÷ estimated of finished stories). Above 100% = planned above the realistic room of the week. Relief: the lowest-ranked projects first.'),
      inputs: [[T(L, 'Zeitraum', 'Period'), `${n} ${T(L, 'Wochen ab', 'weeks from')} ${F.date(oo.weeks[0]?.from)}`], [T(L, 'Schätzfaktor gesamt', 'Overall estimate factor'), rc.estimate.factor != null ? String(rc.estimate.factor) : '–']] };
    s.confidence = rc.teams.some((t) => t.confidence === 'high') ? 'high' : 'medium';
    s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity'), 'Support', T(L, 'Verlauf', 'History')];
    return done(s);
  },
};
