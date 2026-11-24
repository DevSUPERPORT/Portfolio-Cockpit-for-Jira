// My week: the person's own week – bookings against the target, open and overdue tasks, missing hours (shared/mine.js,
// the same rules as "Meine Arbeit"). Uses the mine.week payload when the UI has it (ctx.mine), otherwise the dataset.
import { buildWeek, weekOf } from '../../mine.js';
import { dayIdx } from '../../dates.js';
import { computedOf, dsOf, newStory, kpi, ev, finding, action, follow, done, infoStory, pctPts, r1, T, say, worst, todayIso, personName } from '../kit.js';
import { plural, list } from '../narrate.js';

// The mine.week shape from the dataset: my stories / sub-tasks / support tickets and my worklogs of the week.
export function weekData(ctx, me, from, to) {
  const ds = dsOf(ctx);
  const { model } = computedOf(ctx);
  const a = dayIdx(from), b = dayIdx(to);
  const issues = [], worklogs = [];
  for (const i of ds.issues || []) {
    if (i.role !== 'estimate' && i.role !== 'tiny') continue;
    const logs = (i.worklogs || []).filter((w) => w.a === me && dayIdx(w.d) >= a && dayIdx(w.d) <= b);
    if (i.assignee?.id !== me && !logs.length) continue;
    const item = model.itemByRef.get(i.rootRef);
    issues.push({ id: i.id, key: i.key, summary: i.summary || '', type: { name: i.type?.name || (i.role === 'tiny' ? 'Sub-task' : 'Story'), subtask: i.role === 'tiny' }, status: { name: i.status?.name || '', cat: i.status?.cat || 'new', id: i.status?.id },
      support: false, mine: i.assignee?.id === me, assignee: i.assignee || null, parent: null, project: { key: i.projectKey || String(i.key).split('-')[0], name: item?.name || '' },
      start: i.start || null, due: i.due || null, oe: i.oe || 0, re: i.re || 0, ts: i.ts || 0, hasEstimate: i.oe > 0 });
    for (const w of logs) worklogs.push({ issueId: i.id, d: w.d, h: w.h, c: '' });
  }
  for (const t of ds.supportTickets?.tickets || []) {
    const logs = (t.worklogs || []).filter((w) => w.a === me && dayIdx(w.d) >= a && dayIdx(w.d) <= b);
    if (!(t.assignee?.id === me && t.statusCat !== 'done') && !logs.length) continue;
    issues.push({ id: t.id, key: t.key, summary: t.summary || '', type: { name: 'Ticket', subtask: false }, status: { name: t.status || '', cat: t.statusCat || 'new' }, support: true, mine: t.assignee?.id === me, assignee: t.assignee || null, parent: null,
      project: { key: t.projectKey || 'SUP', name: 'Support' }, start: null, due: null, oe: 0, re: 0, ts: t.spentH || 0, hasEstimate: false });
    for (const w of logs) worklogs.push({ issueId: t.id, d: w.d, h: w.h, c: '' });
  }
  return { from, to, issues, worklogs };
}

export default {
  id: 'myWeek',
  title: (L) => T(L, 'Meine Woche', 'My week'),
  params: ['person'],
  match: [/\b(meine|my) (woche|week|arbeit|work|aufgaben|tasks|buchungen|bookings|stunden|hours)\b|was (muss|soll) ich (diese woche|heute)|what (do|should) i (do|work on)|hab(e)? ich (genug|alles) gebucht|did i (book|log)|fehlende (buchungen|stunden)|missing (hours|bookings)/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const me = p?.person || ctx.me?.id;
    if (!me) return infoStory(ctx, { skill: 'myWeek', lang: L, subject: { kind: 'person', ref: null, name: T(L, 'Ich', 'Me') }, headline: T(L, 'Lotse weiß nicht, wer du bist.', 'Lotse does not know who you are.'), finding: T(L, 'Ohne angemeldete Person gibt es keine eigene Woche.', 'Without a signed-in person there is no own week.') });
    const today = todayIso(ctx);
    const wk = weekOf(today);
    const data = ctx.mine?.from && ctx.mine?.issues ? ctx.mine : weekData(ctx, me, wk.from, wk.to);
    const w = buildWeek({ computed: c, data, meId: me, today, lang: L });
    const s = newStory(ctx, { skill: 'myWeek', subject: { kind: 'person', ref: `person:${me}`, name: personName(ctx, me) || T(L, 'Ich', 'Me') }, lang: L });
    s.id = `myWeek:${wk.from}`;
    const F = s.fmt;
    const b = w.booked;
    const missing = Math.max(0, b.soll - b.istSoll);
    const rows = w.groups.flatMap((g) => g.rows);
    const openMine = rows.filter((r) => r.mine && r.open && r.group !== 'undated');
    const overdue = openMine.filter((r) => r.overdue), blocked = openMine.filter((r) => r.blocked);
    s.kpis.push(kpi('booked', T(L, 'Gebucht', 'Logged'), b.ist, 'h', { tone: 'ink', hint: T(L, `Woche möglich ${F.h(b.weekPossible)}`, `week possible ${F.h(b.weekPossible)}`) }));
    s.kpis.push(kpi('target', T(L, 'Soll bis heute', 'Target to date'), b.soll, 'h'));
    if (b.pct != null) s.kpis.push(kpi('pct', T(L, 'Erfüllt', 'Met'), pctPts(b.pct), '%', { tone: b.below ? 'warn' : 'ok' }));
    s.kpis.push(kpi('open', T(L, 'Offene Aufgaben', 'Open tasks'), openMine.length, 'n', { tone: overdue.length ? 'bad' : 'ok' }));
    s.visual = {
      kind: 'columns',
      data: { unit: 'h', labels: w.dayTotals.map((d) => d.wd), series: [{ name: T(L, 'Gebucht', 'Logged'), values: w.dayTotals.map((d) => r1(d.h)), tone: 'ink' }, { name: T(L, 'Soll', 'Target'), values: w.dayTotals.map((d) => r1(d.possible)), tone: 'muted' }] },
      caption: T(L, 'Deine Buchungen je Tag gegen dein Soll (Wochenstunden ÷ Arbeitstage; Feiertage und Abwesenheiten zählen 0).', 'Your bookings per day against your target (weekly hours ÷ working days; holidays and absences count 0).'),
    };
    if (missing > 0.25) s.findings.push(finding(T(L, `Bis ${F.date(b.untilIso)} fehlen ${F.h(missing, 1)} Buchungen: ${F.h(b.istSoll, 1)} von ${F.h(b.soll, 1)} Soll.`, `Up to ${F.date(b.untilIso)} ${F.h(missing, 1)} of bookings are missing: ${F.h(b.istSoll, 1)} of ${F.h(b.soll, 1)} target.`), b.below ? 'warn' : 'info', b.below ? 70 : 40,
      [ev(T(L, 'Gebucht bis heute', 'Logged to date'), b.istSoll, 'h'), ev(T(L, 'Soll', 'Target'), b.soll, 'h'), ev(T(L, 'Fehlt', 'Missing'), r1(missing), 'h'), ev(T(L, 'bis', 'until'), b.untilIso || undefined, b.untilIso ? 'date' : null)]));
    const low = w.dayTotals.filter((d) => d.low);
    if (low.length) s.findings.push(finding(T(L, `${list(low.map((d) => d.wd), L)} ${plural(low.length, 'liegt', 'liegen')} unter ${b.minPct} % des Tagessolls.`, `${list(low.map((d) => d.wd), L)} ${plural(low.length, 'is', 'are')} below ${b.minPct}% of the daily target.`), 'warn', 50,
      [ev(T(L, 'Mindestquote', 'Minimum'), b.minPct, '%'), ...low.slice(0, 4).map((d) => ev(d.wd, d.h, 'h'))]));
    if (overdue.length) s.findings.push(finding(T(L, `${overdue.length} ${plural(overdue.length, 'Aufgabe ist', 'Aufgaben sind')} überfällig: ${list(overdue.map((r) => r.key), L)}.`, `${overdue.length} ${plural(overdue.length, 'task is', 'tasks are')} overdue: ${list(overdue.map((r) => r.key), L)}.`), 'bad', 80,
      [ev(T(L, 'überfällig', 'overdue'), overdue.length, 'n'), ...overdue.slice(0, 4).map((r) => ev(T(L, 'Due Date', 'Due date'), r.due, 'date', { key: r.key, text: r.summary }))]));
    if (blocked.length) s.findings.push(finding(T(L, `${blocked.length} ${plural(blocked.length, 'Aufgabe steht', 'Aufgaben stehen')} auf Blocked: ${list(blocked.map((r) => r.key), L)}.`, `${blocked.length} ${plural(blocked.length, 'task is', 'tasks are')} blocked: ${list(blocked.map((r) => r.key), L)}.`), 'bad', 72,
      blocked.slice(0, 4).map((r) => ev(T(L, 'blockiert', 'blocked'), undefined, null, { key: r.key, text: r.summary }))));
    const rem = openMine.reduce((a, r) => a + (r.re || 0), 0);
    if (openMine.length) s.findings.push(finding(T(L, `${openMine.length} offene ${plural(openMine.length, 'Aufgabe', 'Aufgaben')} diese Woche mit ${F.h(rem)} Restschätzung; für Projekte hast du ${F.h(w.profile.forProjects)} je Woche.`, `${openMine.length} open ${plural(openMine.length, 'task', 'tasks')} this week with ${F.h(rem)} remaining; you have ${F.h(w.profile.forProjects)} per week for projects.`), rem > w.profile.forProjects ? 'warn' : 'info', rem > w.profile.forProjects ? 55 : 20,
      [ev(T(L, 'Restschätzung', 'Remaining'), r1(rem), 'h'), ev(T(L, 'Projektzeit je Woche', 'Project time per week'), r1(w.profile.forProjects), 'h'), ...openMine.slice(0, 3).map((r) => ev(T(L, 'Rest', 'remaining'), r.re || 0, 'h', { key: r.key }))]));
    const off = w.days.filter((d) => d.holiday || d.absent);
    if (off.length) s.findings.push(finding(T(L, `${list(off.map((d) => d.wd), L)}: ${off[0].holiday ? (off[0].holidayName || 'Feiertag') : 'abwesend'} – zählt mit 0 h.`, `${list(off.map((d) => d.wd), L)}: ${off[0].holiday ? (off[0].holidayName || 'holiday') : 'away'} – counts as 0 h.`), 'info', 15, off.slice(0, 3).map((d) => ev(d.wd, d.iso, 'date'))));
    if (!s.findings.length) s.findings.push(finding(T(L, `Alles gebucht: ${F.h(b.ist, 1)} diese Woche, nichts überfällig.`, `All booked: ${F.h(b.ist, 1)} this week, nothing overdue.`), 'ok', 10, [ev(T(L, 'Gebucht', 'Logged'), b.ist, 'h')]));
    s.tone = worst(...s.findings.map((f) => (f.tone === 'info' ? null : f.tone)));
    s.headline = say(s.id, 'h', [
      T(L, `Diese Woche: ${F.h(b.ist, 1)} gebucht${b.soll ? ` bei ${F.h(b.soll, 1)} Soll bis heute` : ''}${overdue.length ? ` – ${overdue.length} ${plural(overdue.length, 'Aufgabe', 'Aufgaben')} überfällig` : ''}.`, `This week: ${F.h(b.ist, 1)} logged${b.soll ? ` against ${F.h(b.soll, 1)} target to date` : ''}${overdue.length ? ` – ${overdue.length} ${plural(overdue.length, 'task', 'tasks')} overdue` : ''}.`),
      T(L, `${F.h(b.ist, 1)} gebucht${b.soll ? `, Soll bis heute ${F.h(b.soll, 1)}` : ''}; ${openMine.length} offene ${plural(openMine.length, 'Aufgabe', 'Aufgaben')}.`, `${F.h(b.ist, 1)} logged${b.soll ? `, target to date ${F.h(b.soll, 1)}` : ''}; ${openMine.length} open ${plural(openMine.length, 'task', 'tasks')}.`)]);
    s.actions.push(action('book', T(L, 'Buchen', 'Log time'), 'navigate', { view: 'mine', week: wk.from }, T(L, 'Öffnet „Meine Arbeit“ für diese Woche.', 'Opens "My work" for this week.')));
    if (overdue[0]) s.actions.push(action('openOverdue', overdue[0].key, 'open', { key: overdue[0].key, issueId: overdue[0].id }, T(L, `Öffnet ${overdue[0].key} (überfällig seit ${F.date(overdue[0].due)}).`, `Opens ${overdue[0].key} (overdue since ${F.date(overdue[0].due)}).`)));
    s.followUps.push(follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')), follow(T(L, 'Was blockiert mich?', 'What blocks me?'), T(L, 'Was blockiert meine Aufgaben?', 'What blocks my tasks?')),
      ...(openMine[0] ? [follow(T(L, 'Schätzen wie früher', 'Estimate like before'), T(L, `Schätze wie früher: ${openMine[0].key}`, `Estimate like before: ${openMine[0].key}`))] : []), follow(T(L, 'Mein Team', 'My team'), T(L, 'Wie steht mein Team?', 'How is my team doing?')));
    s.how = { text: T(L, `Soll je Tag = Wochenstunden ÷ Arbeitstage (${F.h(w.profile.weekly)} ÷ ${w.profile.perWeek}); Feiertage und Abwesenheiten zählen 0. Gezählt wird bis heute, wie in der Buchungsprüfung (Mindestquote ${b.minPct} %).`, `Target per day = weekly hours ÷ working days (${F.h(w.profile.weekly)} ÷ ${w.profile.perWeek}); holidays and absences count 0. Counted up to today, as in the booking check (minimum ${b.minPct}%).`),
      inputs: [[T(L, 'Woche', 'Week'), `${F.date(w.from)} – ${F.date(w.to)}`], [T(L, 'Standort', 'Location'), w.profile.locationName || '–'], [T(L, 'Team', 'Team'), w.profile.team || '–']] };
    s.confidence = w.profile.known ? 'high' : 'medium';
    s.sources = ['Jira', T(L, 'Buchungen', 'Worklogs'), T(L, 'Kapazitäten', 'Capacity')];
    return done(s);
  },
};
