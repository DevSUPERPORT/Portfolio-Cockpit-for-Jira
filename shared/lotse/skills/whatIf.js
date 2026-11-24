// What if: re-runs the engine on a copy of the dataset with ONE change – a project's rank, a project's dates (+/− weeks),
// a person's weekly hours or a team's extra weekly hours – and shows before/after: staffing per quarter (waterline),
// missing hours, person overload in the next weeks, the project's due date. Nothing is saved.
import { buildModel, projectMetrics, waterline, capacityPeople, personCapacityIn, spreadWindow, shareIn } from '../../engine.js';
import { shiftDates } from '../../weekPlan.js';
import { dayIdx, isoOf, nextWorkday } from '../../dates.js';
import { lc1, computedOf, dsOf, newStory, addProject, addTeam, addPerson, kpi, ev, finding, action, follow, done, infoStory, r1, sum, T, say, worst, teamName, personName, isOpen } from '../kit.js';

// The portfolio's missing hours = the sum of every project's own shortfall (same definition as the project rows below –
// the team-cell view measured demand against capacity before the support reserve, so a project could show more missing
// hours than "all projects": live finding 2026-11-12, 62 h vs 50 h).
const missingIn = (model, wl, q) => sum(model.items, (x) => projectMissing(wl, x.ref, q));
const notStaffed = (wl, q) => Object.values(wl.projectQ).filter((v) => v[q] && v[q].status !== 'ok').length;
const firstRank = (wl, q) => { const r = wl.teamIds.map((t) => wl.cells[t]?.[q]?.waterRank).filter((x) => x != null); return r.length ? Math.min(...r) : null; };
const projectMissing = (wl, ref, q) => sum(wl.projectQ[ref]?.[q]?.teams || [], (t) => t.demand - t.staffed);
// person-level overload of the next weeks: Σ max(0, planned − capacity) over people and weeks (computed.weeks)
function people(c) {
  const out = new Map();
  for (const t of c.weeks?.teams || []) for (const m of t.members) if (!out.has(m.id)) out.set(m.id, { plan: [...m.plan], cap: [...m.cap] });
  return out;
}
const overload = (ps) => sum([...ps.values()], (p) => sum(p.plan.map((h, i) => Math.max(0, h - (p.cap[i] || 0)))));

export function applyChange(ctx, change) {
  const c = computedOf(ctx);
  const ds = dsOf(ctx);
  const { model } = c;
  const ps = people(c);
  const weeks = (c.weeks?.weeks || []).map((w) => [dayIdx(w.from), dayIdx(w.to)]);
  let ds2, metrics2 = c.metrics;
  switch (change?.kind) {
    case 'rank': {
      const it = model.itemByRef.get(change.ref);
      if (!it) return null;
      const order = model.items.filter((x) => x.ref !== it.ref);
      const to = Math.max(1, Math.min(model.items.length, Math.round(+change.toRank || model.items.length)));
      order.splice(to - 1, 0, it);
      const rankOf = new Map(order.map((x, i) => [x.ref, i + 1]));
      ds2 = { ...ds, portfolio: (ds.portfolio || []).map((p) => ({ ...p, rank: rankOf.get(p.ref) ?? p.rank })) };
      break;
    }
    case 'due': {
      const it = model.itemByRef.get(change.ref);
      const w = Math.round(+change.weeks || 0);
      if (!it || !w || Math.abs(w) > 52) return null;
      const shift = (d) => (d ? isoOf(dayIdx(d) + w * 7) : d);
      const moved = new Map();
      const issues = (ds.issues || []).map((i) => {
        if (i.rootRef !== it.ref || !isOpen(i) || (!i.start && !i.due)) return i;
        const x = { ...i, ...shiftDates({ start: i.start, due: i.due }, w) };
        moved.set(i.id, [i, x]);
        return x;
      });
      ds2 = { ...ds, issues, portfolio: (ds.portfolio || []).map((p) => (p.ref === it.ref ? { ...p, due: shift(p.due) } : p)) };
      // weekly plan of the moved stories: take their old share out, put the new one in (the engine's linear spread)
      for (const [, [a, b]] of moved) {
        if (a.role !== 'estimate' || !a.re || !a.assignee?.id || !ps.has(a.assignee.id)) continue;
        const wa = spreadWindow(a, 're', model.today) || [nextWorkday(model.today), nextWorkday(model.today)];
        const wb = spreadWindow(b, 're', model.today) || [nextWorkday(model.today), nextWorkday(model.today)];
        const p = ps.get(a.assignee.id);
        weeks.forEach(([x, y], k) => { p.plan[k] += shareIn(a.re, x, y, wb, 'linear') - shareIn(a.re, x, y, wa, 'linear'); });
      }
      break;
    }
    case 'hours': {
      const base = capacityPeople(model).get(change.personId);
      const d = +change.delta;
      if (!base || !Number.isFinite(d) || Math.abs(d) > 60) return null;
      const next = { ...base, weeklyHours: Math.max(0, (+base.weeklyHours || 0) + d) };
      delete next.id; delete next.derived;
      ds2 = { ...ds, capacity: { ...(ds.capacity || {}), people: { ...(ds.capacity?.people || {}), [change.personId]: next } } };
      const m2 = buildModel(ds2);
      const p = ps.get(change.personId);
      if (p) { const supW = c.support?.personWeekly?.[change.personId] || 0; weeks.forEach(([x, y], k) => { p.cap[k] = personCapacityIn(m2, { id: change.personId, ...next }, x, y, supW); }); }
      break;
    }
    case 'teamHours': {
      const w = +change.weekly;
      if (!model.teams.has(change.teamId) || !Number.isFinite(w) || Math.abs(w) > 400) return null;
      const t = ds.capacity?.teams?.[change.teamId] || {};
      ds2 = { ...ds, capacity: { ...(ds.capacity || {}), teams: { ...(ds.capacity?.teams || {}), [change.teamId]: { ...t, extraWeeklyHours: Math.max(0, (+t.extraWeeklyHours || 0) + w) } } } };
      break;
    }
    default: return null;
  }
  const model2 = buildModel(ds2);
  if (change.kind === 'due') { metrics2 = new Map(c.metrics); metrics2.set(change.ref, projectMetrics(model2, model2.itemByRef.get(change.ref))); }
  const wl2 = waterline(model2, metrics2, c.support);
  return { before: { wl: c.wl, overload: overload(people(c)), metrics: c.metrics, model }, after: { wl: wl2, overload: overload(ps), metrics: metrics2, model: model2 } };
}

export default {
  id: 'whatIf',
  title: (L) => T(L, 'Was wäre wenn', 'What if'),
  params: ['change'],
  match: [/was waere,? wenn|was ist,? wenn|angenommen|what if|suppose|simulat|szenario|scenario/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const { model, wl } = c;
    const ch = p?.change;
    const r = ch ? applyChange(ctx, ch) : null;
    if (!r) return infoStory(ctx, { skill: 'whatIf', lang: L, headline: T(L, 'Was soll Lotse durchrechnen?', 'What should Lotse work out?'), finding: T(L, 'Lotse rechnet eine Änderung durch: einen Rang, einen Termin, Wochenstunden einer Person oder eines Teams.', 'Lotse works out one change: a rank, a date, the weekly hours of a person or a team.'),
      followUps: [follow(T(L, 'Rang nach hinten', 'Rank to the end'), T(L, `Was wäre wenn Rang ${model.items[0]?.rank ?? 1} nach hinten rückt?`, `What if rank ${model.items[0]?.rank ?? 1} moves to the end?`)), follow(T(L, 'Termin später', 'Due later'), T(L, 'Was wäre wenn Due +2 Wochen?', 'What if due +2 weeks?'))] });
    const q0 = wl.quarters[0], q1 = wl.quarters[1];
    const it = ch.ref ? model.itemByRef.get(ch.ref) : null;
    const subject = it ? { kind: 'project', ref: it.ref, name: it.name } : ch.personId ? { kind: 'person', ref: `person:${ch.personId}`, name: personName(ctx, ch.personId) || T(L, 'Person', 'Person') } : { kind: 'team', ref: ch.teamId, name: teamName(model, ch.teamId) || ch.teamId };
    const s = newStory(ctx, { skill: 'whatIf', subject, lang: L });
    s.id = `whatIf:${ch.kind}:${ch.ref || ch.personId || ch.teamId}:${ch.toRank ?? ch.weeks ?? ch.delta ?? ch.weekly}`;
    const F = s.fmt;
    if (it) addProject(s, it);
    let what;
    if (ch.kind === 'rank') { const to = Math.max(1, Math.min(model.items.length, Math.round(+ch.toRank || model.items.length))); what = T(L, `${it.name} von Rang ${it.rank} auf Rang ${to}`, `${it.name} from rank ${it.rank} to rank ${to}`); }
    else if (ch.kind === 'due') what = T(L, `${it.name} ${ch.weeks > 0 ? `${ch.weeks} Wochen später` : `${-ch.weeks} Wochen früher`}`, `${it.name} ${ch.weeks > 0 ? `${ch.weeks} weeks later` : `${-ch.weeks} weeks earlier`}`);
    else if (ch.kind === 'hours') { const n = addPerson(s, ctx, ch.personId) || T(L, 'die Person', 'the person'); what = T(L, `${n} mit ${ch.delta > 0 ? '+' : '−'}${Math.abs(ch.delta)} h je Woche`, `${n} with ${ch.delta > 0 ? '+' : '−'}${Math.abs(ch.delta)} h per week`); }
    else { const n = addTeam(s, model, ch.teamId); what = T(L, `Team ${n} mit ${ch.weekly > 0 ? '+' : '−'}${Math.abs(ch.weekly)} h je Woche`, `team ${n} with ${ch.weekly > 0 ? '+' : '−'}${Math.abs(ch.weekly)} h per week`); }
    const cp = capacityPeople(model).get(ch.personId);
    const extra0 = +dsOf(ctx).capacity?.teams?.[ch.teamId]?.extraWeeklyHours || 0;
    const newRank = Math.max(1, Math.min(model.items.length, Math.round(+ch.toRank || model.items.length)));
    const subjRow = ch.kind === 'rank' ? { id: 'rank', label: T(L, `Rang ${it.name.slice(0, 40)}`, `Rank ${it.name.slice(0, 40)}`), unit: 'n', a: it.rank, b: newRank }
      : ch.kind === 'due' ? { id: 'due', label: T(L, 'Projekt-Termin', 'Project due date'), unit: 'date', a: r.before.metrics.get(it.ref)?.due || null, b: r.after.metrics.get(it.ref)?.due || null }
        : ch.kind === 'hours' ? { id: 'weekly', label: T(L, 'Wochenstunden', 'Weekly hours'), unit: 'h', a: r1(+cp?.weeklyHours || 0), b: r1(Math.max(0, (+cp?.weeklyHours || 0) + +ch.delta)) }
          : { id: 'extra', label: T(L, 'Zusätzliche Wochenstunden', 'Extra weekly hours'), unit: 'h', a: r1(extra0), b: r1(Math.max(0, extra0 + +ch.weekly)) };
    const rows = [
      subjRow,
      { id: 'notStaffed', label: T(L, `Nicht voll besetzbar ${F.quarter(q0)}`, `Not fully staffable ${F.quarter(q0)}`), unit: 'n', a: notStaffed(r.before.wl, q0), b: notStaffed(r.after.wl, q0), better: 'lower' },
      { id: 'missing0', label: T(L, `Fehlende Stunden ${F.quarter(q0)}`, `Missing hours ${F.quarter(q0)}`), unit: 'h', a: r1(missingIn(model, r.before.wl, q0)), b: r1(missingIn(model, r.after.wl, q0)), better: 'lower' },
      { id: 'missing1', label: T(L, `Fehlende Stunden ${F.quarter(q1)}`, `Missing hours ${F.quarter(q1)}`), unit: 'h', a: r1(missingIn(model, r.before.wl, q1)), b: r1(missingIn(model, r.after.wl, q1)), better: 'lower' },
      { id: 'overload', label: T(L, `Überlast ${c.weeks?.weeks?.length || 8} Wochen`, `Overload ${c.weeks?.weeks?.length || 8} weeks`), unit: 'h', a: r1(r.before.overload), b: r1(r.after.overload), better: 'lower' },
    ];
    const fr0 = firstRank(r.before.wl, q0), fr1 = firstRank(r.after.wl, q0);
    if (fr0 != null || fr1 != null) rows.push({ id: 'firstRank', label: T(L, `Erster Engpass ab Rang (${F.quarter(q0)})`, `First bottleneck from rank (${F.quarter(q0)})`), unit: 'n', a: fr0, b: fr1, better: 'higher' });
    if (it) rows.push({ id: 'projMissing', label: T(L, `${it.name.slice(0, 40)}: fehlt ${F.quarter(q0)}`, `${it.name.slice(0, 40)}: missing ${F.quarter(q0)}`), unit: 'h', a: r1(projectMissing(r.before.wl, it.ref, q0)), b: r1(projectMissing(r.after.wl, it.ref, q0)), better: 'lower' });
    // a new order moves the shortage between projects: the ones that gain or lose most
    if (ch.kind === 'rank') {
      const moved = model.items.filter((x) => x.ref !== it.ref).map((x) => ({ x, a: projectMissing(r.before.wl, x.ref, q0), b: projectMissing(r.after.wl, x.ref, q0) }))
        .filter((o) => Math.abs(o.b - o.a) > 1).sort((u, v) => Math.abs(v.b - v.a) - Math.abs(u.b - u.a)).slice(0, 2);
      for (const o of moved) { addProject(s, o.x); rows.push({ id: `proj:${o.x.ref}`, label: T(L, `${o.x.name.slice(0, 40)}: fehlt ${F.quarter(q0)}`, `${o.x.name.slice(0, 40)}: missing ${F.quarter(q0)}`), unit: 'h', a: r1(o.a), b: r1(o.b), better: 'lower' }); }
    }
    const tone = (x) => (x.unit === 'date' || x.a == null || x.b == null || x.a === x.b ? 'muted' : (x.better === 'lower' ? x.b < x.a : x.b > x.a) ? 'ok' : 'bad');
    s.visual = { kind: 'compare', data: { a: { label: T(L, 'Heute', 'Now') }, b: { label: T(L, 'Mit Änderung', 'With change') }, rows: rows.slice(0, 8).map(({ id, ...x }) => ({ ...x, tone: tone(x) })) },
      caption: T(L, `Vorher/nachher, wenn ${what} – gerechnet mit denselben Regeln wie Wasserlinie und Wochenplanung.`, `Before/after if ${what} – computed with the same rules as the waterline and weekly planning.`) };
    const changed = rows.filter((x) => x !== subjRow && x.unit !== 'date' && x.a != null && x.b != null && Math.abs(x.b - x.a) > 0.05);
    for (const x of changed.sort((a, b) => Math.abs(b.b - b.a) / Math.max(1, Math.abs(b.a)) - Math.abs(a.b - a.a) / Math.max(1, Math.abs(a.a))).slice(0, 3)) {
      const good = x.better === 'lower' ? x.b < x.a : x.b > x.a;
      const fmtV = (v) => (x.unit === 'h' ? F.h(v) : F.n(v));
      s.findings.push(finding(T(L, `${x.label}: ${fmtV(x.a)} → ${fmtV(x.b)} (${good ? 'besser' : 'schlechter'}).`, `${x.label}: ${fmtV(x.a)} → ${fmtV(x.b)} (${good ? 'better' : 'worse'}).`), good ? 'ok' : 'bad', Math.min(95, 40 + 50 * (Math.abs(x.b - x.a) / Math.max(1, Math.abs(x.a)))),
        [ev(T(L, 'heute', 'now'), x.a, x.unit), ev(T(L, 'danach', 'after'), x.b, x.unit), ev(T(L, 'Unterschied', 'difference'), r1(Math.abs(x.b - x.a)), x.unit), ev(T(L, 'Quartal', 'quarter'), q0, 'quarter'), ev(T(L, 'Quartal', 'quarter'), q1, 'quarter')]));
    }
    // re-ranking creates no capacity – it only changes who waits; say so when the total stays the same
    const tot = rows.find((x) => x.id === 'missing0');
    if (ch.kind === 'rank' && tot && tot.a > 0.05 && Math.abs(tot.b - tot.a) <= 0.05) {
      s.findings.push(finding(T(L, `Insgesamt fehlen weiter ${F.h(tot.b)} in ${F.quarter(q0)} – ein anderer Rang schafft keine Kapazität, er entscheidet nur, wer wartet.`, `In total ${F.h(tot.b)} are still missing in ${F.quarter(q0)} – a different rank creates no capacity, it only decides who waits.`), 'info', 35,
        [ev(T(L, 'fehlt gesamt', 'missing in total'), tot.b, 'h'), ev(T(L, 'Quartal', 'quarter'), q0, 'quarter')]));
    }
    const dueRow = ch.kind === 'due' ? subjRow : null;
    if (dueRow?.a && dueRow?.b) s.findings.push(finding(T(L, `Der Projekt-Termin rückt vom ${F.date(dueRow.a)} auf den ${F.date(dueRow.b)}.`, `The project due date moves from ${F.date(dueRow.a)} to ${F.date(dueRow.b)}.`), 'info', 30, [ev(T(L, 'heute', 'now'), dueRow.a, 'date'), ev(T(L, 'danach', 'after'), dueRow.b, 'date')]));
    if (!changed.length) s.findings.push(finding(T(L, `Wenn ${what}, ändert sich an Wasserlinie und Überlast nichts.`, `If ${what}, nothing changes in the waterline or overload.`), 'info', 20, [...(it ? [ev(T(L, 'Rang', 'rank'), it.rank, 'n')] : []), ...(ch.kind === 'rank' ? [ev(T(L, 'neuer Rang', 'new rank'), Math.max(1, Math.min(model.items.length, Math.round(+ch.toRank || model.items.length))), 'n')] : []), ...(ch.weeks ? [ev(T(L, 'Wochen', 'weeks'), Math.abs(ch.weeks), 'n')] : []), ...(ch.delta ? [ev('h', Math.abs(ch.delta), 'h')] : []), ...(ch.weekly ? [ev('h', Math.abs(ch.weekly), 'h')] : [])]));
    s.kpis = rows.filter((x) => x !== subjRow && x.unit !== 'date' && x.b != null).slice(0, 4).map((x) => kpi(x.id, x.label.slice(0, 60), x.b, x.unit, { delta: x.a != null ? r1(x.b - x.a) : undefined, tone: tone(x) === 'muted' ? 'ink' : tone(x) }));
    const net = changed.filter((x) => (x.better === 'lower' ? x.b < x.a : x.b > x.a)).length - changed.filter((x) => (x.better === 'lower' ? x.b > x.a : x.b < x.a)).length;
    s.tone = !changed.length ? 'info' : net > 0 ? 'ok' : net < 0 ? 'bad' : 'warn';
    const top = [...s.findings].sort((x, y) => y.impact - x.impact)[0];
    s.headline = T(L, `Wenn ${what}: ${lc1(top.text, s, L)}`, `If ${what}: ${lc1(top.text, s, L)}`);
    // the real action behind the scenario – never applied by Lotse itself
    if (ch.kind === 'rank') s.actions.push(action('rank', T(L, 'Im Ranking umsetzen', 'Apply in the ranking'), 'rank', { ref: ch.ref, toRank: Math.max(1, Math.min(model.items.length, Math.round(+ch.toRank || model.items.length))) }, T(L, `Öffnet das Ranking mit ${it.name} auf dem neuen Rang – gespeichert wird erst, wenn du bestätigst.`, `Opens the ranking with ${it.name} on the new rank – saved only when you confirm.`)));
    else if (ch.kind === 'due') s.actions.push(action('plan', T(L, 'In der Wochenplanung verschieben', 'Move in the weekly plan'), 'navigate', { view: 'plan', project: ch.ref, shiftWeeks: ch.weeks }, T(L, `Öffnet die Wochenplanung von ${it.name}; dort lassen sich die Aufgaben verschieben – mit Rückgängig.`, `Opens the weekly plan of ${it.name}; tasks can be moved there – undoable.`)));
    else s.actions.push(action('capacity', T(L, 'Kapazität anpassen', 'Adjust capacity'), 'navigate', { view: 'capacity', ...(ch.teamId ? { teamId: ch.teamId } : { personId: ch.personId }) }, T(L, 'Öffnet die Kapazitäten – geändert wird erst dort und mit Rückgängig.', 'Opens capacity – changed only there and undoable.')));
    s.followUps.push(follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')), follow(T(L, 'Wasserlinie', 'Waterline'), T(L, 'Ab welchem Rang reicht die Kapazität nicht?', 'From which rank does capacity run out?')), ...(it ? [follow(T(L, 'Lagebild', 'Briefing'), T(L, `Lagebild ${it.name}`, `Briefing ${it.name}`))] : []));
    s.how = { text: T(L, 'Lotse kopiert die Daten, ändert nur diesen einen Wert und rechnet Wasserlinie (alle Teams, Quartale) und Wochen-Überlast (Σ geplant über Kapazität je Person und Woche) neu. Nichts wird gespeichert.', 'Lotse copies the data, changes only this one value and recomputes the waterline (all teams, quarters) and weekly overload (Σ planned above capacity per person and week). Nothing is saved.'),
      inputs: [[T(L, 'Änderung', 'Change'), what], [T(L, 'Quartale', 'Quarters'), `${F.quarter(q0)}, ${F.quarter(q1)}`]] };
    s.confidence = 'high';
    s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity'), T(L, 'Wasserlinie', 'Waterline')];
    return done(s);
  },
};
