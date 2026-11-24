// Estimate like before: similar finished work (shared/insights.js similarWork – TF-IDF on summaries plus team, type,
// component and label) and what it really took: typical hours, overrun against the estimate, duration.
import { similarWork } from '../../insights.js';
import { poolOf } from '../../ask.js';
import { computedOf, dsOf, newStory, addProject, kpi, ev, finding, action, follow, done, infoStory, r1, T, say } from '../kit.js';
import { plural } from '../narrate.js';

export default {
  id: 'estimate',
  title: (L) => T(L, 'Schätzen wie früher', 'Estimate like before'),
  params: ['text', 'key'],
  match: [/wie (frueher|bisher|beim letzten mal|letztes mal)|like (before|last time)|aehnlich|similar|vergleichbar|comparable|schaetz|estimat|wie lange (dauert|brauchen|braucht)|how long (will|does|would|might)|erfahrungswert|aufwand fuer|effort for/],
  run(ctx, p, L) {
    const { model } = computedOf(ctx);
    const i = p?.key ? (dsOf(ctx).issues || []).find((x) => x.key === p.key) : null;
    const text = i ? i.summary : String(p?.text || '').trim();
    if (!text) return infoStory(ctx, { skill: 'estimate', lang: L, headline: T(L, 'Was soll Lotse schätzen?', 'What should Lotse estimate?'), finding: T(L, 'Nenne die Aufgabe in Worten oder einen Jira-Key, z. B. „Schätze wie früher: Export der Rechnungen als PDF“.', 'Name the task in words or a Jira key, e.g. "Estimate like before: export invoices as PDF".'),
      followUps: [follow(T(L, 'Beispiel', 'Example'), T(L, 'Schätze wie früher: Login mit SSO', 'Estimate like before: login with SSO'))] });
    const target = i ? { id: i.id, key: i.key, summary: i.summary, team: i.team, type: i.type, oe: i.oe, components: i.components, labels: i.labels } : { summary: text, team: p?.team ? { id: p.team } : null };
    const sim = similarWork(target, poolOf(ctx), { limit: 8, lang: L });
    const s = newStory(ctx, { skill: 'estimate', subject: i ? { kind: 'ticket', ref: i.key, name: i.key } : { kind: 'topic', ref: null, name: text.slice(0, 100) }, lang: L });
    s.id = `estimate:${i ? i.key : text.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').slice(0, 60)}`;
    const F = s.fmt;
    s.entities.texts = [text.slice(0, 100)];
    if (i) { const it = model.itemByRef.get(i.rootRef); if (it) addProject(s, it); }
    const st = sim.stats;
    const label = i ? i.key : T(L, `„${text.slice(0, 60)}“`, `"${text.slice(0, 60)}"`);
    if (!st.n) {
      return infoStory(ctx, { skill: 'estimate', lang: L, subject: s.subject, headline: T(L, `Für ${label} findet Lotse keine ähnliche erledigte Arbeit.`, `Lotse finds no similar finished work for ${label}.`), finding: T(L, `Geprüft: ${sim.poolSize} erledigte Stories. Andere Worte (z. B. das Fachwort aus Jira) helfen oft.`, `Checked: ${sim.poolSize} finished stories. Other words (e.g. the term used in Jira) often help.`), evidence: [ev(T(L, 'erledigte Stories', 'finished stories'), sim.poolSize, 'n')],
        followUps: [follow(T(L, 'Datenlücken', 'Data gaps'), T(L, 'Wo fehlen Schätzungen?', 'Where are estimates missing?'))] });
    }
    if (st.withActual) s.kpis.push(kpi('median', T(L, 'Typisch (Median)', 'Typical (median)'), st.medianActualH, 'h', { tone: 'ink' }));
    if (st.p80ActualH != null) s.kpis.push(kpi('p80', T(L, 'Sicher (P80)', 'Safe (P80)'), st.p80ActualH, 'h'));
    if (st.typicalOverrunPct != null) s.kpis.push(kpi('overrun', T(L, 'Typischer Überzug', 'Typical overrun'), st.typicalOverrunPct, '%', { tone: st.typicalOverrunPct > 10 ? 'warn' : 'ok' }));
    s.kpis.push(kpi('similar', T(L, 'Ähnliche', 'Similar'), st.n, 'n'));
    s.visual = {
      kind: 'bars',
      data: { unit: 'h', ...(i?.oe > 0 ? { target: r1(i.oe) } : {}), items: sim.items.map((x) => ({ label: x.key, key: x.key, value: x.actualH, tone: x.overrunPct != null && x.overrunPct > 10 ? 'warn' : 'ink', sub: `${x.estimateH != null ? T(L, `geschätzt ${F.h(x.estimateH)}`, `estimated ${F.h(x.estimateH)}`) : T(L, 'ohne Schätzung', 'no estimate')}${x.durationWorkdays != null ? ` · ${x.durationWorkdays} ${T(L, 'AT', 'wd')}` : ''}` })) },
      caption: T(L, `Gebuchte Stunden der ähnlichsten erledigten Aufgaben${i?.oe > 0 ? '; die Linie ist die aktuelle Schätzung' : ''}.`, `Logged hours of the most similar finished work${i?.oe > 0 ? '; the line is the current estimate' : ''}.`),
    };
    for (const x of sim.items) s.entities.texts.push(String(x.summary || '').slice(0, 100));
    s.entities.texts = s.entities.texts.filter(Boolean).slice(0, 20);
    if (st.medianActualH != null) s.findings.push(finding(T(L, `Typisch ${F.h(st.medianActualH, 1)}, sicher geplant ${F.h(st.p80ActualH, 1)} (P80) – aus ${st.withActual} ähnlichen erledigten Aufgaben.`, `Typically ${F.h(st.medianActualH, 1)}, safely planned ${F.h(st.p80ActualH, 1)} (P80) – from ${st.withActual} similar finished items.`), 'info', 80,
      [ev(T(L, 'Median', 'median'), st.medianActualH, 'h'), ev('P80', st.p80ActualH, 'h'), ev(T(L, 'mit Buchungen', 'with bookings'), st.withActual, 'n'), ev('80', 80, 'n'), ...sim.items.slice(0, 3).map((x) => ev(T(L, 'gebucht', 'logged'), x.actualH, 'h', { key: x.key, text: x.summary }))]));
    if (st.typicalOverrunPct != null) s.findings.push(finding(st.typicalOverrunPct > 0 ? T(L, `Ähnliche Arbeit lag typisch ${st.typicalOverrunPct} % über der Schätzung – mit Puffer planen.`, `Similar work typically ran ${st.typicalOverrunPct}% over the estimate – plan a buffer.`) : st.typicalOverrunPct < 0 ? T(L, `Ähnliche Arbeit lag typisch ${-st.typicalOverrunPct} % unter der Schätzung.`, `Similar work typically came in ${-st.typicalOverrunPct}% under the estimate.`) : T(L, 'Die Schätzungen ähnlicher Arbeit trafen typischerweise.', 'Estimates of similar work were typically right.'),
      st.typicalOverrunPct > 10 ? 'warn' : 'ok', 65, [ev(T(L, 'Überzug', 'overrun'), Math.abs(st.typicalOverrunPct), '%'), ev(T(L, 'Basis', 'basis'), st.overrunN, 'n')]));
    if (st.medianDurationWorkdays != null) s.findings.push(finding(T(L, `Dauer typisch ${F.n(st.medianDurationWorkdays, 1)} Arbeitstage.`, `Typical duration ${F.n(st.medianDurationWorkdays, 1)} working days.`), 'info', 40, [ev(T(L, 'Arbeitstage', 'working days'), st.medianDurationWorkdays, 'd')]));
    if (i?.oe > 0 && st.medianActualH != null && Math.abs(i.oe - st.medianActualH) >= Math.max(1, st.medianActualH * 0.1)) s.findings.push(finding(i.oe < st.medianActualH ? T(L, `Die Schätzung von ${i.key} (${F.h(i.oe)}) liegt unter dem typischen Aufwand.`, `The estimate of ${i.key} (${F.h(i.oe)}) is below the typical effort.`) : T(L, `Die Schätzung von ${i.key} (${F.h(i.oe)}) liegt über dem typischen Aufwand.`, `The estimate of ${i.key} (${F.h(i.oe)}) is above the typical effort.`), i.oe < st.medianActualH ? 'warn' : 'info', 70, [ev(T(L, 'Schätzung', 'estimate'), i.oe, 'h', { key: i.key })]));
    s.tone = s.findings.some((f) => f.tone === 'warn') ? 'warn' : 'ok';
    s.headline = st.medianActualH != null
      ? say(s.id, 'h', [T(L, `${label}: wie früher eher ${F.h(st.medianActualH, 1)}, sicher ${F.h(st.p80ActualH, 1)} – aus ${st.n} ähnlichen erledigten Aufgaben.`, `${label}: like before about ${F.h(st.medianActualH, 1)}, safely ${F.h(st.p80ActualH, 1)} – from ${st.n} similar finished items.`),
        T(L, `Ähnliche Arbeit wie ${label} brauchte typisch ${F.h(st.medianActualH, 1)} (${st.n} ${plural(st.n, 'Vergleich', 'Vergleiche')}).`, `Work like ${label} typically took ${F.h(st.medianActualH, 1)} (${st.n} ${plural(st.n, 'comparison', 'comparisons')}).`)])
      : T(L, `${st.n} ähnliche erledigte Aufgaben für ${label}, aber ohne gebuchte Zeit.`, `${st.n} similar finished items for ${label}, but without logged time.`);
    if (i && !(i.oe > 0) && st.medianActualH != null) { const v = Math.max(0.5, Math.round(st.medianActualH * 2) / 2); s.actions.push(action('fill', T(L, `Schätzung ${F.h(v, 1)} setzen`, `Set estimate ${F.h(v, 1)}`), 'fill', { issueId: i.id, key: i.key, usage: 'originalEstimate', value: v }, T(L, `Setzt das Original Estimate von ${i.key} auf ${F.h(v, 1)} (Median ähnlicher Arbeit) – mit Rückgängig.`, `Sets the original estimate of ${i.key} to ${F.h(v, 1)} (median of similar work) – undoable.`))); }
    s.actions.push(action('similar', T(L, 'Ähnliche ansehen', 'See similar work'), 'navigate', { view: 'ask', card: 'similarWork', text }, T(L, 'Öffnet die Karte „Schätzen wie früher“ mit allen Vergleichen.', 'Opens the "estimate like before" card with every comparison.')));
    s.followUps.push(follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')), follow(T(L, 'Passt das noch?', 'Does it fit?'), T(L, 'Was passt ohne Überstunden?', 'What fits without overtime?')));
    s.how = { text: T(L, 'Ähnlich = gleiche markante Wörter im Titel (TF-IDF, das Epic zählt halb), plus Bonus für gleiches Team, gleichen Typ, Komponente und Label. Typisch = Median der gebuchten Zeit, sicher = P80, Überzug = gebucht ÷ geschätzt − 1.', 'Similar = the same distinctive words in the title (TF-IDF, the epic counts half), plus a bonus for the same team, type, component and label. Typical = median logged time, safe = P80, overrun = logged ÷ estimated − 1.'),
      inputs: [[T(L, 'Vergleichsbasis', 'Pool'), T(L, `${sim.poolSize} erledigte Stories`, `${sim.poolSize} finished stories`)], [T(L, 'Bester Treffer', 'Best match'), sim.items[0] ? `${sim.items[0].key} (${Math.round(sim.items[0].score * 100)} %)` : '–']] };
    s.confidence = sim.confidence;
    s.sources = ['Jira', T(L, 'Verlauf', 'History')];
    return done(s);
  },
};
