// Plan vs. actual: what happened to the planned hours of the last weeks and where they went instead
// (shared/planActual.js analyzePlanActual on the planActual.get payload, ctx.planActual).
import { analyzePlanActual } from '../../planActual.js';
import { newStory, kpi, ev, finding, action, follow, done, infoStory, pctPts, r1, T, say, worst } from '../kit.js';
import { plural } from '../narrate.js';

const CAUSE = { SUP: ['Support über der Reserve', 'support above the reserve'], ABS: ['ungeplante Abwesenheit', 'unplanned absence'], INT: ['interne Arbeit', 'internal work'], OTHER: ['mehrere kleine Abflüsse', 'several small flows'], REST: ['nirgends gebucht', 'booked nowhere'] };

export default {
  id: 'planActualExplain',
  title: (L) => T(L, 'Plan vs. Ist', 'Plan vs. actual'),
  params: ['team'],
  match: [/plan (vs\.?|gegen|versus|und) (ist|actual)|soll.?ist|plan.?ist|planned (vs\.?|versus) actual|wo (sind|ging|gingen) (die|unsere) stunden|where did (the|our) (hours|time) go|abfluss|abgeflossen|diverted|wie geplant gebucht|booked as planned|(weniger|mehr) (gebucht|erfasst) als (geplant|eingeplant)|(less|more|fewer hours) (booked|logged) than planned/],
  run(ctx, p, L) {
    const pa = ctx.planActual;
    if (!pa || pa.state !== 'ready') {
      const why = !pa ? T(L, 'Plan vs. Ist ist noch nicht geladen.', 'Plan vs. actual is not loaded yet.') : pa.state === 'waiting' ? T(L, 'Der erste Plan ist gespeichert, aber noch keine abgeschlossene Woche mit Ist-Werten.', 'The first plan is saved, but no completed week with actuals yet.') : T(L, 'Es gibt noch keinen gespeicherten Wochenplan.', 'There is no saved weekly plan yet.');
      return infoStory(ctx, { skill: 'planActualExplain', lang: L, subject: { kind: 'topic', ref: 'planActual', name: T(L, 'Plan vs. Ist', 'Plan vs. actual') }, headline: why, finding: T(L, 'Lotse erklärt Plan vs. Ist, sobald mindestens eine Woche abgeschlossen ist.', 'Lotse explains plan vs. actual as soon as at least one week is completed.'),
        actions: [{ id: 'open', label: T(L, 'Plan vs. Ist öffnen', 'Open plan vs. actual'), kind: 'navigate', payload: { view: 'hours', tab: 'planActual' }, preview: T(L, 'Öffnet die Ansicht Plan vs. Ist.', 'Opens the plan vs. actual view.'), undoable: true }] });
    }
    const a = analyzePlanActual(pa, { lang: L, team: p?.team || 'all' });
    const s = newStory(ctx, { skill: 'planActualExplain', subject: { kind: 'topic', ref: `planActual:${p?.team || 'all'}`, name: T(L, 'Plan vs. Ist', 'Plan vs. actual') }, lang: L });
    const F = s.fmt;
    const k = a.kpis;
    for (const [ref, x] of Object.entries(pa.projects || {})) if (x?.name && !s.entities.projects.some((q) => q.ref === ref)) s.entities.projects.push({ ref, key: x.key || null, rank: x.rank ?? null, name: x.name });
    for (const t of pa.teams || []) if (t.name) s.entities.teams.push({ id: t.id, name: t.name });
    for (const u of pa.units || []) if (u.kind === 'person' && u.name) s.entities.people.push({ id: u.id, name: u.name });
    const asPct = k.asPlannedPct == null ? null : pctPts(k.asPlannedPct);
    s.kpis.push(kpi('plan', T(L, 'Geplant', 'Planned'), k.plan, 'h', { tone: 'ink' }));
    s.kpis.push(kpi('book', T(L, 'Gebucht', 'Logged'), k.book, 'h'));
    if (asPct != null) s.kpis.push(kpi('asPlanned', T(L, 'Wie geplant', 'As planned'), asPct, '%', { tone: asPct < 80 ? 'warn' : 'ok' }));
    s.kpis.push(kpi('diverted', T(L, 'Abgeflossen', 'Diverted'), k.diverted, 'h', { tone: k.divertedHot ? 'warn' : 'ok' }));
    const rows = a.rows.slice(0, 8);
    s.visual = {
      kind: 'columns',
      data: { unit: 'h', labels: rows.map((r) => r.name.slice(0, 40)), series: [{ name: T(L, 'Geplant', 'Planned'), values: rows.map((r) => r1(r.plan)), tone: 'muted' }, { name: T(L, 'Gebucht', 'Logged'), values: rows.map((r) => r1(r.book)), tone: 'ink' }] },
      caption: T(L, `Geplante gegen gebuchte Stunden je Projekt, Support und interner Arbeit (${a.period}).`, `Planned vs. logged hours per project, support and internal work (${a.period}).`),
    };
    for (const w of a.why.slice(0, 3)) {
      const parts = w.parts.map((x) => `${F.h(x.h)} ${x.k in CAUSE ? CAUSE[x.k][L === 'en' ? 1 : 0] : T(L, `in ${pa.projects?.[x.k]?.name || x.k}`, `into ${pa.projects?.[x.k]?.name || x.k}`)}`);
      s.findings.push(finding(T(L, `${w.name}: ${F.h(-w.diff)} weniger als geplant – ${parts.join(', ')}.`, `${w.name}: ${F.h(-w.diff)} less than planned – ${parts.join(', ')}.`), 'warn', 70 + Math.min(20, -w.diff / 4),
        [ev(T(L, 'Geplant', 'Planned'), r1(w.plan), 'h'), ev(T(L, 'Gebucht', 'Logged'), r1(w.book), 'h'), ev(T(L, 'Differenz', 'Difference'), r1(-w.diff), 'h'), ...w.parts.slice(0, 3).map((x) => ev(x.k in CAUSE ? CAUSE[x.k][L === 'en' ? 1 : 0] : pa.projects?.[x.k]?.name || x.k, r1(x.h), 'h'))]));
      if (w.over.length) s.findings.push(finding(T(L, `Mehraufwand bei ${w.name}: ${w.over.map((o) => `${o.key} +${F.h(o.extra)}`).join(', ')}.`, `Extra effort in ${w.name}: ${w.over.map((o) => `${o.key} +${F.h(o.extra)}`).join(', ')}.`), 'info', 40, w.over.slice(0, 4).map((o) => ev(T(L, 'Mehr als geschätzt', 'over the estimate'), o.extra, 'h', { key: o.key }))));
    }
    const sup = a.rows.find((r) => r.kind === 'support');
    if (sup && sup.diff > 0 && sup.sig) s.findings.push(finding(T(L, `Support hat ${F.h(sup.diff)} mehr gebraucht als reserviert (${F.h(sup.book)} statt ${F.h(sup.plan)}).`, `Support took ${F.h(sup.diff)} more than reserved (${F.h(sup.book)} instead of ${F.h(sup.plan)}).`), 'warn', 65,
      [ev(T(L, 'Support gebucht', 'Support logged'), r1(sup.book), 'h'), ev(T(L, 'Support geplant', 'Support planned'), r1(sup.plan), 'h'), ev(T(L, 'mehr', 'more'), r1(sup.diff), 'h')]));
    if (k.absU > 0.5) s.findings.push(finding(T(L, `${F.h(k.absU)} ungeplante Abwesenheit.`, `${F.h(k.absU)} of unplanned absence.`), 'info', 30, [ev(T(L, 'ungeplant abwesend', 'unplanned absence'), r1(k.absU), 'h')]));
    if (!s.findings.length) s.findings.push(finding(T(L, `${asPct ?? 0} % der Stunden landeten wie geplant – keine nennenswerte Abweichung.`, `${asPct ?? 0}% of the hours landed as planned – no notable deviation.`), 'ok', 10, [ev(T(L, 'Wie geplant', 'As planned'), asPct ?? 0, '%')]));
    s.tone = worst(...s.findings.map((f) => (f.tone === 'info' ? null : f.tone)));
    s.headline = say(s.id, 'h', [T(L, `${a.period}: ${asPct ?? 0} % der geplanten ${F.h(k.plan)} landeten wie geplant, ${F.h(k.diverted)} flossen woandershin.`, `${a.period}: ${asPct ?? 0}% of the planned ${F.h(k.plan)} landed as planned, ${F.h(k.diverted)} went elsewhere.`),
      T(L, `Von ${F.h(k.plan)} Plan sind ${asPct ?? 0} % wie geplant gebucht; ${F.h(k.diverted)} gingen an andere Stellen (${a.period}).`, `Of ${F.h(k.plan)} planned, ${asPct ?? 0}% were logged as planned; ${F.h(k.diverted)} went elsewhere (${a.period}).`)]);
    s.actions.push({ id: 'open', label: T(L, 'Plan vs. Ist öffnen', 'Open plan vs. actual'), kind: 'navigate', payload: { view: 'hours', tab: 'planActual', team: p?.team || 'all' }, preview: T(L, 'Öffnet Plan vs. Ist mit allen Zeilen und Personen.', 'Opens plan vs. actual with every row and person.'), undoable: true });
    if (sup && sup.diff > 0 && sup.sig) s.actions.push({ id: 'reserve', label: T(L, 'Reserve prüfen', 'Check reserve'), kind: 'navigate', payload: { view: 'support', tab: 'reserve' }, preview: T(L, 'Öffnet „Reicht die Reserve?“ mit dem empfohlenen Wert.', 'Opens "Is the reserve enough?" with the recommended value.'), undoable: true });
    s.followUps.push(follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')), follow(T(L, 'Realistische Kapazität', 'Real capacity'), T(L, 'Wie viel Kapazität bleibt nach Support?', 'How much capacity is left after support?')), follow(T(L, 'Planungsvorschläge', 'Planning advice'), T(L, 'Planungsvorschläge', 'Planning advice')));
    s.how = { text: T(L, 'Plan = die gespeicherten Wochenpläne (Montag früh), Ist = die Buchungen dieser Wochen. Je Projekt mit deutlichem Minus (mind. 4 h und 5 %) zeigt Lotse, wohin die Stunden flossen: Support über der Reserve, ungeplante Abwesenheit, interne Arbeit, andere Projekte oder nirgends gebucht.', 'Plan = the saved weekly plans (Monday morning), actual = the bookings of those weeks. For every project with a clear shortfall (at least 4 h and 5 %) Lotse shows where the hours went: support above the reserve, unplanned absence, internal work, other projects or booked nowhere.'),
      inputs: [[T(L, 'Zeitraum', 'Period'), a.period], [T(L, 'Wochen', 'Weeks'), String((pa.weeks || []).length)], ...(a.provisional.length ? [[T(L, 'Vorläufig', 'Provisional'), a.provisional.join(', ')]] : [])] };
    s.confidence = (pa.weeks || []).length >= 4 && !a.provisional.length ? 'high' : 'medium';
    s.sources = [T(L, 'Wochenpläne', 'Weekly plans'), T(L, 'Buchungen', 'Worklogs')];
    return done(s);
  },
};
