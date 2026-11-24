// Missing values: the data gaps that block planning (required fields), urgent first, each with a value suggested from
// real data – similar finished work (estimate), siblings (team), the parent (dates), the due date (quarters).
import { dataQuality } from '../../engine.js';
import { similarWork } from '../../insights.js';
import { poolOf } from '../../ask.js';
import { quarterKeyOf, dayIdx } from '../../dates.js';
import { computedOf, newStory, addProject, addTeam, kpi, ev, finding, action, follow, done, infoStory, pickProject, pctPts, r1, T, say, worst, teamName } from '../kit.js';
import { plural } from '../narrate.js';
import { median } from '../../insights.js';

const USAGE = { originalEstimate: ['Original Estimate', 'Original estimate'], team: ['Team', 'Team'], tshirt: ['T-Shirt Size', 'T-shirt size'], startDate: ['Start Date', 'Start date'], dueDate: ['Due Date', 'Due date'], targetQuarters: ['Ziel-Quartale', 'Target quarters'], owner: ['Owner', 'Owner'], assignee: ['Bearbeiter', 'Assignee'], milestone: ['Meilenstein', 'Milestone'], parent: ['Übergeordnet', 'Parent'] };
const usageName = (u, L) => (USAGE[u] ? USAGE[u][L === 'en' ? 1 : 0] : u);
export const ruleLabel = (r, L) => (r.startsWith('missing:') ? T(L, `${usageName(r.slice(8), L)} fehlt`, `${usageName(r.slice(8), L)} missing`) : { dueAfterMilestone: T(L, 'Due Date nach Meilenstein', 'Due date after milestone'), datesInverted: T(L, 'Start nach Due Date', 'Start after due date'), overdue: T(L, 'Due Date überschritten', 'Due date exceeded'), outsideParent: T(L, 'Termin außerhalb des Epics', 'Date outside the epic'), roughTooLong: T(L, 'Über mehr als 2 Quartale', 'Spans more than 2 quarters') }[r] || r);

// A value for one gap, with what it rests on – or null when the data gives no sound basis.
export function suggestFor(ctx, g) {
  const { model } = computedOf(ctx);
  const i = model.byId.get(g.issueId);
  if (!i) return null;
  const sibs = (model.children.get(i.parentId) || []).filter((x) => x.id !== i.id && x.role === i.role);
  const parent = i.parentId ? model.byId.get(i.parentId) : null;
  switch (g.field) {
    case 'originalEstimate': {
      const sim = similarWork({ id: i.id, key: i.key, summary: i.summary, team: i.team, type: i.type, parentSummary: parent?.summary }, poolOf(ctx), { limit: 6 });
      if (sim.stats.medianActualH != null && sim.stats.withActual >= 2) return { value: Math.max(0.5, Math.round(sim.stats.medianActualH * 2) / 2), unit: 'h', n: sim.stats.withActual, keys: sim.items.slice(0, 3).map((x) => x.key), basis: 'similar' };
      const oes = sibs.filter((x) => x.oe > 0).map((x) => x.oe);
      if (oes.length >= 2) return { value: Math.round(median(oes) * 2) / 2, unit: 'h', n: oes.length, keys: sibs.filter((x) => x.oe > 0).slice(0, 3).map((x) => x.key), basis: 'siblings' };
      return null;
    }
    case 'team': {
      const n = new Map();
      for (const x of sibs) if (x.team?.id) n.set(x.team.id, (n.get(x.team.id) || 0) + 1);
      const best = [...n].sort((a, b) => b[1] - a[1])[0];
      if (best) return { value: best[0], label: teamName(model, best[0]), n: best[1], keys: sibs.filter((x) => x.team?.id === best[0]).slice(0, 3).map((x) => x.key), basis: 'siblings' };
      if (parent?.team?.id) return { value: parent.team.id, label: teamName(model, parent.team.id), n: 1, keys: [parent.key], basis: 'parent' };
      return null;
    }
    case 'startDate': case 'dueDate': {
      const v = g.field === 'startDate' ? parent?.start : parent?.due;
      if (v && !(g.field === 'startDate' && i.due && v > i.due) && !(g.field === 'dueDate' && i.start && v < i.start)) return { value: v, unit: 'date', n: 1, keys: [parent.key], basis: 'parent' };
      const ds = sibs.map((x) => (g.field === 'startDate' ? x.start : x.due)).filter(Boolean).sort();
      if (ds.length >= 2) { const m = ds[Math.floor(ds.length / 2)]; if (!(g.field === 'startDate' && i.due && m > i.due) && !(g.field === 'dueDate' && i.start && m < i.start)) return { value: m, unit: 'date', n: ds.length, keys: sibs.slice(0, 3).map((x) => x.key), basis: 'siblings' }; }
      return null;
    }
    case 'targetQuarters': {
      const due = (model.byRoot.get(i.rootRef) || []).filter((x) => x.role === 'estimate' && x.due && (x.parentId === i.id || model.byId.get(x.parentId)?.parentId === i.id)).map((x) => x.due).sort();
      if (due.length) return { value: [...new Set([quarterKeyOf(dayIdx(due[0])), quarterKeyOf(dayIdx(due.at(-1)))])].slice(0, 4), unit: 'quarter', n: due.length, keys: [], basis: 'stories' };
      return null;
    }
    default: return null;
  }
}

export default {
  id: 'gapsFix',
  title: (L) => T(L, 'Fehlende Werte', 'Missing values'),
  params: ['project'],
  match: [/(estimates?|values|dates|data|teams?|fields) (are |is )?missing|fehlen(de)? (schaetzungen|werte|termine|daten)|(schaetzungen|werte|termine|daten|felder) fehlen|datenluecke|data gaps?|luecken?|gaps\b|fehlende (werte|daten|felder|schaetzung|termine)|missing (values|data|fields|estimates?|dates)|unvollstaendig|incomplete|ohne (schaetzung|team|termin|due)|without (an? )?(estimate|team|date)|datenqualitaet|data quality|(werte|daten) (fuellen|ergaenzen|pflegen)|fill (in )?(the )?(gaps|values)/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const { model } = c;
    const it = pickProject(ctx, p);
    const dq = it ? dataQuality(model, new Set([it.ref])) : c.dq;
    const gaps = dq.gaps.filter((g) => g.severity === 'gap' && g.rule !== 'overdue');
    const subject = it ? { kind: 'project', ref: it.ref, name: it.name } : { kind: 'portfolio', ref: null, name: 'Portfolio' };
    const s = newStory(ctx, { skill: 'gapsFix', subject, lang: L });
    const F = s.fmt;
    if (it) addProject(s, it);
    const fixable = gaps.filter((g) => g.fixable && !g.isItem);
    const urgent = gaps.filter((g) => g.urgent);
    const ranked = [...fixable].sort((a, b) => b.urgent - a.urgent || (model.itemByRef.get(a.rootRef)?.rank ?? 999) - (model.itemByRef.get(b.rootRef)?.rank ?? 999));
    const tried = ranked.slice(0, 12).map((g) => ({ g, sug: suggestFor(ctx, g) }));
    const withSug = tried.filter((x) => x.sug);
    s.kpis.push(kpi('gaps', T(L, 'Datenlücken', 'Data gaps'), gaps.length, 'n', { tone: gaps.length ? 'warn' : 'ok' }));
    s.kpis.push(kpi('urgent', T(L, 'Dringend', 'Urgent'), urgent.length, 'n', { tone: urgent.length ? 'bad' : 'ok', hint: T(L, 'Termin in 4 Wochen', 'date within 4 weeks') }));
    s.kpis.push(kpi('suggested', T(L, 'Mit Vorschlag', 'With suggestion'), withSug.length, 'n', { tone: 'ink', hint: T(L, `von ${tried.length} geprüften`, `of ${tried.length} checked`) }));
    s.kpis.push(kpi('complete', T(L, 'Vollständig', 'Complete'), pctPts(dq.score), '%'));
    if (!gaps.length) {
      s.visual = { kind: 'donut', data: { unit: '%', total: 100, items: [{ label: T(L, 'vollständig', 'complete'), value: pctPts(dq.score), tone: 'ok' }, { label: T(L, 'unvollständig', 'incomplete'), value: 100 - pctPts(dq.score), tone: 'warn' }] }, caption: T(L, 'Anteil der Vorgänge mit allen Pflichtfeldern.', 'Share of work items with every required field.') };
      s.findings.push(finding(T(L, `Keine Datenlücken – ${pctPts(dq.score)} % der Vorgänge sind vollständig.`, `No data gaps – ${pctPts(dq.score)}% of the work items are complete.`), 'ok', 10, []));
    } else {
      const byRule = new Map();
      for (const g of gaps) { const r = byRule.get(g.rule) || byRule.set(g.rule, { n: 0, u: 0 }).get(g.rule); r.n++; if (g.urgent) r.u++; }
      const rules = [...byRule].sort((a, b) => b[1].u - a[1].u || b[1].n - a[1].n).slice(0, 8);
      s.visual = { kind: 'bars', data: { unit: 'n', items: rules.map(([r, x]) => ({ label: ruleLabel(r, L), value: x.n, tone: x.u ? 'warn' : 'muted', sub: x.u ? T(L, `${x.u} dringend`, `${x.u} urgent`) : undefined })).map((x) => (x.sub === undefined ? (({ sub, ...y }) => y)(x) : x)) },
        caption: T(L, 'Datenlücken nach Regel; gelb = mit Terminen in den nächsten 4 Wochen (dringend).', 'Data gaps by rule; yellow = with dates in the next 4 weeks (urgent).') };
      for (const { g, sug } of withSug.slice(0, 3)) {
        const what = usageName(g.field, L);
        let val, evs = [];
        if (sug.unit === 'h') { val = F.h(sug.value, 1); evs = [ev(T(L, 'Vorschlag', 'Suggestion'), sug.value, 'h', { key: g.key }), ev(T(L, 'ähnliche', 'similar'), sug.n, 'n')]; }
        else if (sug.unit === 'date') { val = F.date(sug.value); evs = [ev(T(L, 'Vorschlag', 'Suggestion'), sug.value, 'date', { key: g.key })]; }
        else if (sug.unit === 'quarter') { val = sug.value.map((q) => F.quarter(q)).join(', '); evs = [ev(T(L, 'Vorschlag', 'Suggestion'), undefined, null, { key: g.key }), ...sug.value.map((q) => ev(T(L, 'Quartal', 'Quarter'), q, 'quarter')), ev(T(L, 'Stories', 'stories'), sug.n, 'n')]; }
        else { val = addTeam(s, model, sug.value) || sug.value; evs = [ev(T(L, 'Vorschlag', 'Suggestion'), undefined, null, { key: g.key, ref: `team:${sug.value}` }), ev(T(L, 'Geschwister im Team', 'siblings in the team'), sug.n, 'n')]; }
        const basis = { similar: T(L, `Median von ${sug.n} ähnlichen erledigten Stories`, `median of ${sug.n} similar finished stories`), siblings: T(L, `aus ${sug.n} Geschwistern unter demselben Epic`, `from ${sug.n} siblings under the same epic`), parent: T(L, 'vom übergeordneten Vorgang', 'from the parent'), stories: T(L, `aus den Due Dates von ${sug.n} Stories`, `from the due dates of ${sug.n} stories`) }[sug.basis];
        for (const k of sug.keys) evs.push(ev(T(L, 'Grundlage', 'basis'), undefined, null, { key: k }));
        s.findings.push(finding(T(L, `${g.key}: ${what} fehlt – Vorschlag ${val} (${basis}).`, `${g.key}: ${what} missing – suggestion ${val} (${basis}).`), g.urgent ? 'warn' : 'info', g.urgent ? 70 : 45, evs));
      }
      const noSug = tried.length - withSug.length;
      s.findings.push(finding(urgent.length ? T(L, `${gaps.length} Datenlücken, ${urgent.length} davon dringend: ihre Termine liegen in den nächsten 4 Wochen.`, `${gaps.length} data gaps, ${urgent.length} of them urgent: their dates are within the next 4 weeks.`) : T(L, `${gaps.length} Datenlücken, keine dringend.`, `${gaps.length} data gaps, none urgent.`),
        urgent.length ? 'warn' : 'info', urgent.length ? 75 : 35, [ev(T(L, 'Lücken', 'gaps'), gaps.length, 'n'), ev(T(L, 'dringend', 'urgent'), urgent.length, 'n'), ev(T(L, 'Wochen', 'weeks'), 4, 'n')]));
      if (noSug > 0) s.findings.push(finding(T(L, `Für ${noSug} der ${tried.length} geprüften Lücken gibt es keine belastbare Grundlage – dort entscheidet ihr selbst.`, `For ${noSug} of the ${tried.length} checked gaps there is no sound basis – you decide there.`), 'info', 20, [ev(T(L, 'ohne Vorschlag', 'without suggestion'), noSug, 'n'), ev(T(L, 'geprüft', 'checked'), tried.length, 'n')]));
    }
    s.tone = gaps.length ? worst(urgent.length ? 'warn' : 'ok') : 'ok';
    s.headline = !gaps.length ? T(L, `${it ? it.name : 'Das Portfolio'} hat keine Datenlücken.`, `${it ? it.name : 'The portfolio'} has no data gaps.`)
      : say(s.id, 'h', [T(L, `${gaps.length} Datenlücken${it ? ` in ${it.name}` : ''}, ${urgent.length} dringend – für ${withSug.length} hat Lotse einen Wert aus echten Daten.`, `${gaps.length} data gaps${it ? ` in ${it.name}` : ''}, ${urgent.length} urgent – Lotse has a value from real data for ${withSug.length}.`),
        T(L, `${withSug.length} Lücken lassen sich mit Werten aus echten Daten füllen; insgesamt fehlen ${gaps.length} Angaben.`, `${withSug.length} gaps can be filled with values from real data; ${gaps.length} values are missing in total.`)]);
    for (const { g, sug } of withSug.slice(0, 3)) {
      const shown = sug.unit === 'h' ? F.h(sug.value, 1) : sug.unit === 'date' ? F.date(sug.value) : sug.unit === 'quarter' ? sug.value.map((q) => F.quarter(q)).join(', ') : teamName(model, sug.value);
      s.actions.push(action(`fill:${g.id}`, T(L, `${g.key}: ${shown}`, `${g.key}: ${shown}`), 'fill', { issueId: g.issueId, key: g.key, usage: g.field, value: sug.value }, T(L, `Setzt ${usageName(g.field, L)} von ${g.key} auf ${shown} – mit Rückgängig.`, `Sets the ${usageName(g.field, L)} of ${g.key} to ${shown} – undoable.`)));
    }
    s.followUps.push(follow(T(L, 'Schätzen wie früher', 'Estimate like before'), T(L, `Schätze wie früher: ${withSug[0]?.g.key || ''}`.trim(), `Estimate like before: ${withSug[0]?.g.key || ''}`.trim())), follow(T(L, 'Portfolio-Lage', 'Portfolio'), T(L, 'Lagebild Portfolio', 'Portfolio briefing')), follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')));
    s.how = { text: T(L, 'Lücken = Pflichtfelder der Konfiguration, die leer sind; dringend = Start oder Due Date in den nächsten 4 Wochen. Vorschläge: Schätzung = Median der gebuchten Zeit ähnlicher erledigter Stories (ab 2), sonst der Geschwister; Team = häufigstes Team der Geschwister; Termine vom übergeordneten Vorgang.', 'Gaps = required fields of the configuration that are empty; urgent = start or due date within the next 4 weeks. Suggestions: estimate = median logged time of similar finished stories (2 or more), otherwise of the siblings; team = most common team among siblings; dates from the parent.'),
      inputs: [[T(L, 'Ähnliche erledigte Stories', 'Similar finished stories'), String(poolOf(ctx).length)], [T(L, 'Vollständig', 'Complete'), F.pct(dq.score)]] };
    s.confidence = withSug.some((x) => x.sug.basis === 'similar' && x.sug.n >= 3) ? 'medium' : 'low';
    s.sources = ['Jira', T(L, 'Verlauf', 'History')];
    return done(s);
  },
};
