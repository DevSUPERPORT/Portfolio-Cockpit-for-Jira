// What fits without overtime: the waterline on REALISTIC capacity (shared/insights.js realisticCapacity) – projects in
// rank order against the room left after support, with the team's estimate factor applied.
import { computedOf, rcOf, newStory, addProject, addTeam, kpi, ev, finding, action, follow, done, infoStory, r1, T, say, worst } from '../kit.js';
import { pickTeam } from './teamBrief.js';

export default {
  id: 'fits',
  title: (L) => T(L, 'Was passt ohne Überstunden', 'What fits without overtime'),
  params: ['team'],
  match: [/ohne (massive |viele )?ueberstunden|without (much |any )?overtime|was passt|what (still )?fits|passt (das|es|alles)|schaffen wir (das|es|alles)|will we make it|can we (make|do) it|in (der )?normalen arbeitszeit|within normal hours/],
  run(ctx, p, L) {
    const { model } = computedOf(ctx);
    const rc = rcOf(ctx, L);
    const tid = pickTeam(ctx, p);
    const cand = tid ? rc.teams.filter((t) => t.teamId === tid) : [...rc.teams].sort((a, b) => (a.waterRank ?? 1e9) - (b.waterRank ?? 1e9) || b.totals.overtime - a.totals.overtime);
    const t = cand[0];
    if (!t || !t.projects.length) return infoStory(ctx, { skill: 'fits', lang: L, headline: T(L, 'Für diese Frage gibt es keine geplante Projektarbeit.', 'There is no planned project work for this question.'), finding: T(L, 'Ohne Restschätzung mit Team lässt sich nichts gegen die Kapazität legen.', 'Without remaining estimates with a team nothing can be laid against capacity.') });
    const s = newStory(ctx, { skill: 'fits', subject: { kind: 'team', ref: t.teamId, name: t.name }, lang: L });
    const F = s.fmt;
    addTeam(s, model, t.teamId);
    const first = t.projects.find((x) => x.fits !== 'ok');
    s.kpis.push(kpi('fit', T(L, 'Projekte passen', 'Projects fit'), t.fitCount, 'n', { tone: first ? 'warn' : 'ok' }));
    s.kpis.push(kpi('projects', T(L, 'Projekte geplant', 'Projects planned'), t.projects.length, 'n'));
    s.kpis.push(kpi('room', T(L, 'Raum (Zeitraum)', 'Room (period)'), t.totals.room, 'h', { tone: 'ok' }));
    s.kpis.push(kpi('planned', T(L, 'Geplant realistisch', 'Planned realistic'), t.totals.plannedAdj, 'h', { tone: t.totals.plannedAdj > t.totals.room ? 'bad' : 'ok' }));
    s.visual = {
      kind: 'waterline',
      data: { unit: 'h', capacity: r1(t.totals.room), team: t.name, waterRank: t.waterRank ?? null,
        items: t.projects.filter((x) => x.rank != null).slice(0, 24).map((x) => { const it = model.itemByRef.get(x.ref); if (it) addProject(s, it); return { label: x.name || x.ref, rank: x.rank, ref: x.ref, ...(it?.key ? { key: it.key } : {}), value: x.plannedAdj, cum: x.cum, status: x.fits }; }) },
      caption: T(L, `Team ${t.name}: Projekte nach Rang gegen den realistischen Raum der nächsten ${rc.weeks.length} Wochen.`, `Team ${t.name}: projects by rank against the realistic room of the next ${rc.weeks.length} weeks.`),
    };
    if (first) {
      const it = model.itemByRef.get(first.ref);
      if (it) addProject(s, it);
      s.findings.push(finding(first.rank > 1 && t.fitCount > 0
        ? T(L, `Bis Rang ${first.rank - 1} passt alles ohne Überstunden; ab Rang ${first.rank} (${first.name}) ${first.fits === 'partial' ? `passen nur ${F.h(first.fitHours)} von ${F.h(first.plannedAdj)}` : 'nicht mehr'}.`, `Everything up to rank ${first.rank - 1} fits without overtime; from rank ${first.rank} (${first.name}) ${first.fits === 'partial' ? `only ${F.h(first.fitHours)} of ${F.h(first.plannedAdj)} fit` : 'nothing fits'}.`)
        : T(L, `Schon Rang ${first.rank} (${first.name}) passt nicht ohne Überstunden: ${F.h(first.plannedAdj)} geplant bei ${F.h(t.totals.room)} Raum.`, `Already rank ${first.rank} (${first.name}) does not fit without overtime: ${F.h(first.plannedAdj)} planned with ${F.h(t.totals.room)} of room.`),
        first.fits === 'no' ? 'bad' : 'warn', 88, [ev(T(L, 'passt', 'fits'), first.fitHours, 'h', { ref: first.ref }), ev(T(L, 'geplant', 'planned'), first.plannedAdj, 'h'), ev(T(L, 'Raum', 'room'), t.totals.room, 'h')]));
      const out = t.projects.filter((x) => x.fits === 'no');
      if (out.length) s.findings.push(finding(T(L, `${out.length} Projekte hätten in ${rc.weeks.length} Wochen keinen Platz mehr – zusammen ${F.h(out.reduce((a, x) => a + x.plannedAdj, 0))}.`, `${out.length} projects would have no room left in ${rc.weeks.length} weeks – ${F.h(out.reduce((a, x) => a + x.plannedAdj, 0))} together.`), 'bad', 70,
        [ev(T(L, 'ohne Platz', 'no room'), out.length, 'n'), ev(T(L, 'Wochen', 'weeks'), rc.weeks.length, 'n'), ev(T(L, 'Stunden', 'hours'), r1(out.reduce((a, x) => a + x.plannedAdj, 0)), 'h')]));
    } else s.findings.push(finding(T(L, `Alle ${t.projects.length} Projekte passen ohne Überstunden: ${F.h(t.totals.plannedAdj)} geplant bei ${F.h(t.totals.room)} Raum.`, `All ${t.projects.length} projects fit without overtime: ${F.h(t.totals.plannedAdj)} planned with ${F.h(t.totals.room)} of room.`), 'ok', 20, [ev(T(L, 'geplant', 'planned'), t.totals.plannedAdj, 'h'), ev(T(L, 'Raum', 'room'), t.totals.room, 'h')]));
    for (const o of rc.teams.filter((x) => x !== t && x.waterRank != null).slice(0, 2)) {
      addTeam(s, model, o.teamId);
      const fx = o.projects.find((x) => x.fits !== 'ok');
      const it = fx ? model.itemByRef.get(fx.ref) : null;
      if (it) addProject(s, it);
      s.findings.push(finding(T(L, `Team ${o.name}: ab Rang ${o.waterRank} reicht der realistische Raum nicht (${o.fitCount} von ${o.projects.length} Projekten passen).`, `Team ${o.name}: from rank ${o.waterRank} the realistic room runs out (${o.fitCount} of ${o.projects.length} projects fit).`), 'warn', 50,
        [ev(T(L, 'passen', 'fit'), o.fitCount, 'n', { ref: `team:${o.teamId}` }), ev(T(L, 'Projekte', 'projects'), o.projects.length, 'n'), ...(fx ? [ev(T(L, 'erster Engpass', 'first bottleneck'), undefined, null, { ref: fx.ref })] : [])]));
    }
    s.tone = worst(...s.findings.map((f) => f.tone));
    s.headline = first ? say(s.id, 'h', [T(L, `Team ${t.name}: ${t.fitCount} von ${t.projects.length} Projekten passen ohne Überstunden – ab Rang ${first.rank} wird es eng.`, `Team ${t.name}: ${t.fitCount} of ${t.projects.length} projects fit without overtime – from rank ${first.rank} it gets tight.`), T(L, `Ohne Überstunden schafft Team ${t.name} ${t.fitCount} von ${t.projects.length} Projekten.`, `Without overtime team ${t.name} manages ${t.fitCount} of ${t.projects.length} projects.`)])
      : T(L, `Team ${t.name} schafft alle ${t.projects.length} Projekte ohne Überstunden.`, `Team ${t.name} manages all ${t.projects.length} projects without overtime.`);
    if (first) s.actions.push(action('whatIfRank', T(L, `Rang ${first.rank} nach hinten?`, `Rank ${first.rank} to the end?`), 'whatIf', { change: { kind: 'rank', ref: first.ref, toRank: model.items.length } }, T(L, `Rechnet durch, was es ändert, wenn ${first.name} ans Ende rückt – nichts wird gespeichert.`, `Works out what changes if ${first.name} moves to the end – nothing is saved.`)));
    s.actions.push(action('ranking', T(L, 'Ranking', 'Ranking'), 'navigate', { view: 'portfolio' }, T(L, 'Öffnet das Portfolio-Ranking.', 'Opens the portfolio ranking.')));
    s.followUps.push(follow(T(L, 'Überstunden', 'Overtime'), T(L, `Überstunden Team ${t.name}`, `Overtime team ${t.name}`)), follow(T(L, 'Wasserlinie', 'Waterline'), T(L, 'Ab welchem Rang reicht die Kapazität nicht?', 'From which rank does capacity run out?')), follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')));
    s.how = { text: T(L, 'Raum = realistische Kapazität über den Zeitraum (nach Support-P80). Geplant = Restschätzung × Schätzfaktor. Projekte in Rang-Reihenfolge aufsummiert; passt = die Summe bleibt im Raum.', 'Room = realistic capacity over the period (after support P80). Planned = remaining estimate × estimate factor. Projects summed up in rank order; fits = the running total stays within the room.'),
      inputs: [[T(L, 'Zeitraum', 'Period'), `${rc.weeks.length} ${T(L, 'Wochen', 'weeks')}`], [T(L, 'Schätzfaktor', 'Estimate factor'), F.n(t.estimate.factor, 2)]] };
    s.confidence = t.confidence;
    s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity'), 'Support'];
    return done(s);
  },
};
