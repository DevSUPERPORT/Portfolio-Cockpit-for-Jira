// Lotse reads a project's timeline (Projects › Structure › Timeline) so the project admin does not have to: what is
// late and by how much, what decides the end date and whether it fits the project's due date, which dependencies
// collide, what ends in the next two weeks, and where the dates themselves are wrong or missing (boss 2026-11-19:
// "summarise the graphs, help understand them, save project admins time and cognitive load – always with proof").
// Every number and date in a sentence is evidence (selfCheck); every work item is named by its Jira key.
import { computedOf, newStory, addProject, kpi, ev, finding, action, follow, done, pickProject, urgentProject, T, say, worst, infoStory, isOpen } from '../kit.js';
import { plural, list } from '../narrate.js';
import { rollups, barOf, quickFlags } from '../../timeline.js';
import { isoOf } from '../../dates.js';

const iso = (d) => (d == null ? null : isoOf(d));
const short = (s, n = 46) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));

export default {
  id: 'timelineBrief',
  title: (L) => T(L, 'Zeitleiste erklärt', 'Timeline explained'),
  params: ['project'],
  match: [/zeitleiste|zeitstrahl|gantt|zeitplan|terminplan|terminleiste|balkenplan|timeline|time line|schedule (of|for|summary)|(erklaer|fass).{0,20}(termin|zeitleiste|gantt|zeitplan)|(explain|summari[sz]e).{0,20}(timeline|gantt|schedule)|was ist (zu )?spaet|what is (running )?late|wann (ist|wird) .{0,40}fertig|when (is|will) .{0,40}(done|finished)|endtermin|end date|projektende|kritische(r|n)? (pfad|vorgang|strecke)|critical (path|item)/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const { model, deps, metrics } = c;
    const it = pickProject(ctx, p) || urgentProject(ctx);
    if (!it) return infoStory(ctx, { skill: 'timelineBrief', lang: L, headline: T(L, 'Kein Projekt im Portfolio.', 'No project in the portfolio.'), finding: T(L, 'Sobald ein Projekt im Portfolio ist, liest Lotse seine Zeitleiste.', 'As soon as a project is in the portfolio, Lotse reads its timeline.') });
    const issues = model.byRoot.get(it.ref) || [];
    const subject = { kind: 'project', ref: it.ref, name: it.name };
    if (!issues.length) {
      return infoStory(ctx, { skill: 'timelineBrief', lang: L, subject, headline: T(L, `${it.name}: noch keine Vorgänge.`, `${it.name}: no work items yet.`),
        finding: T(L, 'Unter diesem Projekt hängen noch keine Vorgänge – es gibt keine Zeitleiste.', 'No work items below this project yet – there is no timeline.'),
        followUps: [follow(T(L, 'Lagebild', 'Briefing'), T(L, `Lagebild ${it.name}`, `Briefing ${it.name}`)), follow(T(L, 'Portfolio', 'Portfolio'), T(L, 'Lagebild Portfolio', 'Portfolio briefing'))] });
    }
    const s = newStory(ctx, { skill: 'timelineBrief', subject, lang: L });
    const F = s.fmt;
    addProject(s, it);
    const today = model.today;
    const ids = new Set(issues.map((i) => i.id));
    const kidsMap = new Map();
    for (const i of issues) { const k = i.parentId && ids.has(i.parentId) ? i.parentId : 'root'; (kidsMap.get(k) || kidsMap.set(k, []).get(k)).push(i); }
    const roll = rollups(issues, (id) => kidsMap.get(id) || []);
    const conflictIds = new Set(deps.list.filter((d) => d.conflict).flatMap((d) => [d.pre, d.dep]));
    const rows = issues.map((i) => { const bar = barOf(i, roll, today); return { i, bar, f: quickFlags(i, bar, today, conflictIds) }; });
    const open = rows.filter((r) => isOpen(r.i));
    const overdue = open.filter((r) => r.f.overdue).sort((a, b) => b.bar.overdue - a.bar.overdue);
    const soon = open.filter((r) => r.f.soon).sort((a, b) => a.bar.due - b.bar.due);
    const unscheduled = open.filter((r) => r.f.unscheduled); // the same count as the timeline's "no dates" chip
    const invalid = open.filter((r) => r.f.invalid);
    const late = open.filter((r) => r.f.late).sort((a, b) => b.bar.late - a.bar.late);
    const conflicts = deps.list.filter((d) => d.conflict && (ids.has(d.pre) || ids.has(d.dep)));
    // what decides the end: the open work that ends last (own dates; a missing start does not hide a due date)
    const ends = open.filter((r) => r.bar.due != null).sort((a, b) => b.bar.due - a.bar.due);
    const last = ends[0] || null;
    const m = metrics.get(it.ref);
    const projDue = m?.due ? Math.round(Date.parse(`${m.due}T00:00:00Z`) / 864e5) : null;
    const beyond = last && projDue != null ? last.bar.due - projDue : null;

    s.kpis.push(kpi('overdue', T(L, 'Überfällig', 'Overdue'), overdue.length, 'n', { tone: overdue.length ? 'bad' : 'ok' }));
    s.kpis.push(kpi('soon', T(L, 'Endet in 14 Tagen', 'Ends within 14 days'), soon.length, 'n', { tone: soon.length ? 'warn' : 'ok' }));
    s.kpis.push(kpi('conflicts', T(L, 'Terminkonflikte', 'Date conflicts'), conflicts.length, 'n', { tone: conflicts.length ? 'bad' : 'ok' }));
    s.kpis.push(kpi('nodates', T(L, 'Ohne Termine', 'Without dates'), unscheduled.length, 'n', { tone: unscheduled.length ? 'info' : 'ok' }));

    // 1 · what is late
    if (overdue.length) {
      const w = overdue[0];
      const more = overdue.slice(1, 3).map((r) => r.i.key);
      s.findings.push(finding(
        T(L, `${overdue.length} ${plural(overdue.length, 'Vorgang ist', 'Vorgänge sind')} überfällig – am längsten ${w.i.key} „${short(w.i.summary)}“: ${w.bar.overdue} Tage über Due (${F.date(iso(w.bar.due))})${more.length ? `, danach ${list(more, L)}` : ''}.`,
          `${overdue.length} work ${plural(overdue.length, 'item is', 'items are')} overdue – the longest ${w.i.key} "${short(w.i.summary)}": ${w.bar.overdue} days past due (${F.date(iso(w.bar.due))})${more.length ? `, then ${list(more, L)}` : ''}.`),
        'bad', 80 + Math.min(15, w.bar.overdue),
        [ev(T(L, 'überfällig', 'overdue'), overdue.length, 'n'), ev(T(L, 'Tage über Due', 'days past due'), w.bar.overdue, 'd', { key: w.i.key }), ev('Due', iso(w.bar.due), 'date', { key: w.i.key }),
          ...more.map((k) => ev(T(L, 'auch überfällig', 'also overdue'), undefined, null, { key: k }))]));
    }
    // 2 · the end date: does the last open work fit the project's due?
    if (last) {
      const tone = beyond != null && beyond > 0 ? 'bad' : 'ok';
      s.findings.push(finding(
        beyond != null && beyond > 0
          ? T(L, `Die Zeitleiste endet nach dem Projekt-Due: ${last.i.key} „${short(last.i.summary)}“ ist bis ${F.date(iso(last.bar.due))} geplant – ${beyond} Tage nach dem Projekt-Due ${F.date(iso(projDue))}.`,
            `The timeline ends after the project's due date: ${last.i.key} "${short(last.i.summary)}" is planned until ${F.date(iso(last.bar.due))} – ${beyond} days after the project due ${F.date(iso(projDue))}.`)
          : T(L, `Das letzte offene Stück ist ${last.i.key} „${short(last.i.summary)}“ bis ${F.date(iso(last.bar.due))}${projDue != null ? ` – vor dem Projekt-Due ${F.date(iso(projDue))}` : ''}.`,
            `The last open piece is ${last.i.key} "${short(last.i.summary)}" until ${F.date(iso(last.bar.due))}${projDue != null ? ` – before the project due ${F.date(iso(projDue))}` : ''}.`),
        tone, tone === 'bad' ? 78 : 30,
        [ev(T(L, 'endet', 'ends'), iso(last.bar.due), 'date', { key: last.i.key }), ...(projDue != null ? [ev(T(L, 'Projekt-Due', 'project due'), iso(projDue), 'date')] : []), ...(beyond != null && beyond > 0 ? [ev(T(L, 'Tage danach', 'days after'), beyond, 'd')] : [])]));
    }
    // 3 · dependencies that collide
    if (conflicts.length) {
      const d = conflicts[0];
      const a = model.byId.get(d.dep) || model.external.get(d.dep), b = model.byId.get(d.pre) || model.external.get(d.pre);
      s.findings.push(finding(
        T(L, `${conflicts.length} ${plural(conflicts.length, 'Abhängigkeit kollidiert', 'Abhängigkeiten kollidieren')}: ${a?.key} startet ${d.conflictDays} Tage vor dem Ende von ${b?.key}, auf das es wartet.`,
          `${conflicts.length} ${plural(conflicts.length, 'dependency collides', 'dependencies collide')}: ${a?.key} starts ${d.conflictDays} days before ${b?.key} ends, which it waits for.`),
        'bad', 75,
        [ev(T(L, 'Konflikte', 'conflicts'), conflicts.length, 'n'), ev(T(L, 'Tage zu früh', 'days too early'), d.conflictDays, 'd', { key: a?.key }), ev(T(L, 'Vorgänger', 'prerequisite'), undefined, null, { key: b?.key }),
          ...(b?.due ? [ev(T(L, 'Ende Vorgänger', 'prerequisite ends'), b.due, 'date', { key: b?.key })] : []), ...(a?.start ? [ev('Start', a.start, 'date', { key: a?.key })] : [])]));
    }
    // 4 · the next two weeks
    if (soon.length) {
      const keys = soon.slice(0, 3);
      s.findings.push(finding(
        T(L, `${soon.length} ${plural(soon.length, 'Vorgang endet', 'Vorgänge enden')} in den nächsten zwei Wochen – zuerst ${keys.map((r) => `${r.i.key} (${F.date(iso(r.bar.due))})`).join(', ')}.`,
          `${soon.length} work ${plural(soon.length, 'item ends', 'items end')} within the next two weeks – first ${keys.map((r) => `${r.i.key} (${F.date(iso(r.bar.due))})`).join(', ')}.`),
        'warn', 55, [ev(T(L, 'enden in 14 Tagen', 'end within 14 days'), soon.length, 'n'), ...keys.map((r) => ev('Due', iso(r.bar.due), 'date', { key: r.i.key }))]));
    }
    // 5 · the dates themselves: children after their parent, start after due, no dates
    if (late.length || invalid.length || unscheduled.length) {
      const parts = [
        late.length ? T(L, `bei ${late.length} ${plural(late.length, 'Vorgang', 'Vorgängen')} enden Unterelemente nach dem Due (am weitesten ${late[0].i.key}: ${late[0].bar.late} Tage)`, `at ${late.length} work ${plural(late.length, 'item', 'items')} the items below end after the due date (furthest ${late[0].i.key}: ${late[0].bar.late} days)`) : null,
        invalid.length ? T(L, `${invalid.length}× liegt der Start nach dem Due (${invalid[0].i.key})`, `${invalid.length}× the start is after the due date (${invalid[0].i.key})`) : null,
        unscheduled.length ? T(L, `${unscheduled.length} offene ${plural(unscheduled.length, 'Vorgang hat', 'Vorgänge haben')} keine Termine`, `${unscheduled.length} open work ${plural(unscheduled.length, 'item has', 'items have')} no dates`) : null,
      ].filter(Boolean);
      s.findings.push(finding(T(L, `Die Termine selbst: ${parts.join('; ')}.`, `The dates themselves: ${parts.join('; ')}.`), late.length || invalid.length ? 'warn' : 'info', late.length || invalid.length ? 50 : 30, [
        ...(late.length ? [ev(T(L, 'Kinder nach Due', 'children after due'), late.length, 'n'), ev(T(L, 'Tage', 'days'), late[0].bar.late, 'd', { key: late[0].i.key })] : []),
        ...(invalid.length ? [ev(T(L, 'Start nach Due', 'start after due'), invalid.length, 'n', { key: invalid[0].i.key })] : []),
        ...(unscheduled.length ? [ev(T(L, 'ohne Termine', 'without dates'), unscheduled.length, 'n')] : []),
      ]));
    }
    if (!s.findings.length) s.findings.push(finding(T(L, 'Nichts überfällig, keine Konflikte, alle Termine plausibel.', 'Nothing overdue, no conflicts, all dates plausible.'), 'ok', 10, []));

    // the picture: the rows that matter most – overdue, colliding, ending soon, the last one
    const pick = [];
    const add = (r, tone) => { if (r && !pick.some((x) => x.r.i.id === r.i.id) && r.bar.a != null) pick.push({ r, tone }); };
    for (const r of overdue.slice(0, 5)) add(r, 'bad');
    for (const d of conflicts.slice(0, 3)) { add(rows.find((x) => x.i.id === d.dep), 'bad'); add(rows.find((x) => x.i.id === d.pre), 'warn'); }
    for (const r of soon.slice(0, 4)) add(r, 'warn');
    add(last, beyond != null && beyond > 0 ? 'bad' : 'ok');
    for (const r of [...open].sort((a, b) => (a.bar.a ?? 1e9) - (b.bar.a ?? 1e9))) { if (pick.length >= 8) break; add(r, 'ok'); }
    const g = pick.slice(0, 12);
    if (g.length) {
      const from = Math.min(today, ...g.map((x) => x.r.bar.a)), to = Math.max(today, ...g.map((x) => x.r.bar.b), ...(projDue != null ? [projDue] : []));
      s.visual = { kind: 'gantt', data: { from: iso(from - 3), to: iso(to + 3), today: iso(today), rows: g.map(({ r, tone }) => ({ label: `${r.i.key} ${short(r.i.summary, 34)}`, key: r.i.key, start: iso(r.bar.a), end: iso(r.bar.b), tone })) },
        caption: T(L, 'Die wichtigsten Balken der Zeitleiste: überfällig (rot), kollidierend, bald fällig (gelb) und das letzte offene Stück.', 'The timeline\'s most important bars: overdue (red), colliding, due soon (amber) and the last open piece.') };
    } else {
      s.visual = { kind: 'donut', data: { unit: 'n', total: unscheduled.length, items: [{ label: T(L, 'offen ohne Termine', 'open without dates'), value: unscheduled.length, tone: 'muted' }] }, caption: T(L, 'Kein Vorgang hat Termine – die Zeitleiste ist leer.', 'No work item has dates – the timeline is empty.') };
    }

    s.tone = worst(...s.findings.map((f) => (f.tone === 'info' ? null : f.tone)));
    // only what is wrong, most important first (live finding: "0 overdue and 0 dependencies collide" read badly)
    const late_ = beyond > 0;
    const rest = [
      overdue.length ? T(L, `${overdue.length} ${plural(overdue.length, 'Vorgang', 'Vorgänge')} überfällig`, `${overdue.length} work ${plural(overdue.length, 'item', 'items')} overdue`) : null,
      conflicts.length ? T(L, `${conflicts.length} ${plural(conflicts.length, 'Terminkonflikt', 'Terminkonflikte')}`, `${conflicts.length} date ${plural(conflicts.length, 'conflict', 'conflicts')}`) : null,
    ].filter(Boolean);
    s.headline = late_
      ? T(L, `${it.name}: Die Zeitleiste endet ${beyond} Tage nach dem Projekt-Due – ${last.i.key} bestimmt das Ende${rest.length ? `; dazu ${list(rest, L)}` : ''}.`,
        `${it.name}: the timeline ends ${beyond} days after the project due – ${last.i.key} decides the end${rest.length ? `; also ${list(rest, L)}` : ''}.`)
      : rest.length
        ? T(L, `${it.name}: ${list(rest, L)} in der Zeitleiste.`, `${it.name}: ${list(rest, L)} in the timeline.`)
        : T(L, `${it.name}: Zeitleiste im Plan – ${soon.length} ${plural(soon.length, 'Vorgang endet', 'Vorgänge enden')} in den nächsten zwei Wochen.`, `${it.name}: timeline on plan – ${soon.length} work ${plural(soon.length, 'item ends', 'items end')} within the next two weeks.`);

    // what to do next: open the worst one, see the timeline, test a later due date
    const first = overdue[0]?.i || (conflicts[0] && (model.byId.get(conflicts[0].dep))) || null;
    if (first) s.actions.push(action('open', first.key, 'open', { key: first.key, issueId: first.id }, T(L, `Öffnet ${first.key} in Jira.`, `Opens ${first.key} in Jira.`)));
    s.actions.push(action('timeline', T(L, 'Zeitleiste öffnen', 'Open the timeline'), 'navigate', { view: 'project', ref: it.ref, structure: 'timeline' }, T(L, 'Öffnet das Projekt mit der Zeitleiste.', 'Opens the project with the timeline.')));
    if (beyond > 0 || overdue.length) s.actions.push(action('whatIfDue', T(L, `${it.name} +2 Wochen?`, `${it.name} +2 weeks?`), 'whatIf', { change: { kind: 'due', ref: it.ref, weeks: 2 } }, T(L, 'Rechnet durch, was 2 Wochen mehr ändern – nichts wird gespeichert.', 'Works out what 2 more weeks change – nothing is saved.')));
    s.followUps.push(
      follow(T(L, 'Was blockiert?', 'What blocks?'), T(L, `Was blockiert ${it.name}?`, `What blocks ${it.name}?`)),
      follow(T(L, 'Lagebild', 'Briefing'), T(L, `Lagebild ${it.name}`, `Briefing ${it.name}`)),
      follow(T(L, 'Fehlende Termine', 'Missing dates'), T(L, `Datenlücken in ${it.name}`, `Data gaps in ${it.name}`)),
      follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')));
    s.how = {
      text: T(L, 'Gelesen aus Start Date und Due Date jedes Vorgangs (dieselben Felder wie die Jira-Zeitleiste). Überfällig = offen und Due vor heute. Ende = der späteste Due offener Vorgänge, verglichen mit dem Projekt-Due. Konflikt = die abhängige Aufgabe startet vor dem Ende ihres Vorgängers (konfigurierte Link-Typen).',
        'Read from each work item\'s start date and due date (the same fields as Jira\'s timeline). Overdue = open and due before today. End = the latest due date of open work, compared with the project\'s due date. Conflict = the dependent task starts before its prerequisite ends (configured link types).'),
      inputs: [[T(L, 'Vorgänge', 'Work items'), String(issues.length)], [T(L, 'offen', 'open'), String(open.length)], [T(L, 'Heute', 'Today'), iso(today)]],
    };
    s.confidence = unscheduled.length > open.length / 2 ? 'medium' : 'high';
    s.sources = ['Jira'];
    return done(s);
  },
};
