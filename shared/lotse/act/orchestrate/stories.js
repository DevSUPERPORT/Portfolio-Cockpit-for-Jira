// Lotse orchestration – the stories of a job: the plan (what Lotse will do, with which data), one card per subject
// (exactly what its section of the PDF will say) and the overview. Every number of a headline or finding stands in the
// story's kpis / visual / evidence (selfCheck) – the findings come from data.js assess(), the same sentences as the PDF.
import { newStory, kpi, ev, finding, done as doneStory, infoStory, sum, addPerson, addTeam, addProject } from '../../kit.js';
import { T, plural, computedOf, dsOf, langOf } from '../kit.js';
import { BLOCK_NAMES } from './parse.js';
import { jobWeeks, weekLabel, scopeName, inScope } from './data.js';

const pct = (u) => (Number.isFinite(u) ? Math.round(u * 100) : null);
const h1 = (v) => Math.round((v || 0) * 10) / 10;
const short = (s, n = 34) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
export const subjectWord = (L, kind, n) => ({
  people: T(L, plural(n, 'Person', 'Personen'), plural(n, 'person', 'people')), person: T(L, 'Person', 'person'),
  teams: T(L, plural(n, 'Team', 'Teams'), plural(n, 'team', 'teams')), projects: T(L, plural(n, 'Projekt', 'Projekte'), plural(n, 'project', 'projects')),
}[kind]);
export const formatText = (L, job, n) => ({
  pdfAll: T(L, `ein PDF mit Überblick, ${n} ${plural(n, 'persönlichem Abschnitt', 'persönlichen Abschnitten')} und Nachweis`, `one PDF with an overview, ${n} personal ${plural(n, 'section', 'sections')} and the proof`),
  pdfEach: T(L, `ein Gesamt-PDF und ${n} ${plural(n, 'eigenes PDF', 'eigene PDFs')} je ${job.subjects === 'teams' ? 'Team' : job.subjects === 'projects' ? 'Projekt' : 'Person'}`, `one combined PDF and ${n} own ${plural(n, 'PDF', 'PDFs')} per ${job.subjects === 'teams' ? 'team' : job.subjects === 'projects' ? 'project' : 'person'}`),
  text: T(L, `${n} persönliche ${plural(n, 'Nachricht', 'Nachrichten')} als Text`, `${n} personal ${plural(n, 'message', 'messages')} as text`),
}[job.format]);
const subjectKind = (job) => (!job.scope ? 'portfolio' : job.scope.kind === 'myTeam' ? 'team' : job.scope.kind);
function entities(s, ctx, job, ids = []) {
  const { model } = computedOf(ctx);
  if (job.scope?.kind === 'project') addProject(s, model.itemByRef.get(job.scope.ref));
  if (job.scope?.kind === 'team' || job.scope?.kind === 'myTeam') addTeam(s, model, job.scope.ref);
  for (const x of ids) {
    if (x.kind === 'person') addPerson(s, ctx, x.id);
    else if (x.kind === 'team') addTeam(s, model, x.id);
    else if (x.kind === 'project') addProject(s, model.itemByRef.get(x.id));
  }
}

// ---------- the plan ----------
export function planStory(ctx, job, all, { counts = {} } = {}) {
  const L = langOf(ctx);
  const s = newStory(ctx, { skill: 'orchestrate', subject: { kind: subjectKind(job), ref: job.scope?.ref ?? null, name: job.scope?.name || 'Portfolio' }, lang: L });
  s.id = `orchestrate:plan:${job.scope?.ref || job.scope?.kind || 'all'}`;
  const F = s.fmt;
  entities(s, ctx, job, all);
  const n = all.length, weeks = (job.window.past || 0) + (job.window.next || 0);
  const nb = job.blocks.length;
  const items = counts.items || 0;
  s.kpis.push(kpi('subjects', T(L, job.subjects === 'teams' ? 'Teams' : job.subjects === 'projects' ? 'Projekte' : 'Personen', job.subjects === 'teams' ? 'Teams' : job.subjects === 'projects' ? 'Projects' : 'People'), n, 'n'));
  s.kpis.push(kpi('weeks', T(L, 'Wochen', 'Weeks'), weeks, 'n'));
  s.kpis.push(kpi('blocks', T(L, 'Bausteine', 'Blocks'), nb, 'n'));
  s.kpis.push(kpi('items', T(L, 'Offene Jira-Vorgänge', 'Open Jira work items'), items, 'n'));
  const bars = all.slice(0, 12).map((x) => ({ label: short(x.name, 40), value: h1(counts.hours?.[x.id] || 0), tone: 'ink' }));
  s.visual = bars.length ? { kind: 'bars', data: { unit: 'h', items: bars }, caption: job.subjects === 'projects' ? T(L, 'Offene Stunden je Projekt (Remaining Estimate) – wer in diesem Auftrag vorkommt.', 'Open hours per project (remaining estimate) – who is part of this job.') : T(L, `Eingeplante Stunden der nächsten ${job.window.next || 0} Wochen ${scopeName(L, job)} – wer in diesem Auftrag vorkommt.`.replace(/\s+–/, ' –'), `Planned hours of the next ${job.window.next || 0} weeks ${scopeName(L, job)} – who is part of this job.`.replace(/\s+–/, ' –')) }
    : { kind: 'donut', data: { unit: 'n', total: 0, items: [{ label: T(L, 'niemand', 'nobody'), value: 0, tone: 'muted' }] }, caption: T(L, 'In diesem Rahmen gibt es niemanden mit Arbeit.', 'Nobody has work in this scope.') };
  const what = formatText(L, job, n);
  s.headline = T(L, `Auftrag: ${n} ${subjectWord(L, job.subjects, n)} ${scopeName(L, job)}, ${weeks} Wochen, ${nb} Bausteine – ${what}.`.replace(/\s+,/, ','), `Job: ${n} ${subjectWord(L, job.subjects, n)} ${scopeName(L, job)}, ${weeks} weeks, ${nb} blocks – ${what}.`.replace(/\s+,/, ','));
  s.findings.push(finding(T(L, `Lotse liest dafür: ${job.blocks.map((b) => BLOCK_NAMES[b][0]).join(', ')}.`, `Lotse reads: ${job.blocks.map((b) => BLOCK_NAMES[b][1]).join(', ')}.`), 'info', 60, []));
  const W = jobWeeks(ctx, job.window);
  if (W.length) s.findings.push(finding(T(L, `Zeitraum: ${job.window.label[0]}, ${weekLabel(L, W[0])} bis ${weekLabel(L, W.at(-1))}${job.said?.window ? '' : ' (Standard – im nächsten Schritt änderbar)'}.`, `Period: ${job.window.label[1]}, ${weekLabel(L, W[0])} to ${weekLabel(L, W.at(-1))}${job.said?.window ? '' : ' (default – can be changed next)'}.`), 'info', 55,
    [ev(T(L, 'Wochen zurück', 'weeks back'), job.window.past || 0, 'n'), ev(T(L, 'Wochen voraus', 'weeks ahead'), job.window.next || 0, 'n'), ev(T(L, 'von', 'from'), W[0].from, 'date'), ev(T(L, 'bis', 'to'), W.at(-1).to, 'date')]));
  s.findings.push(finding(T(L, `Ergebnis: ${what}${job.personal ? ', dazu ein persönlicher Text je Empfänger zum Kopieren' : ''} – Lotse sendet nichts von selbst.`, `Result: ${what}${job.personal ? ', plus a personal text per recipient to copy' : ''} – Lotse sends nothing on its own.`), 'ok', 50, [ev(T(L, 'Abschnitte', 'sections'), n, 'n')]));
  const unsaid = ['scope', 'window', 'format', 'audience'].filter((k) => !job.said?.[k]);
  if (unsaid.length) s.findings.push(finding(T(L, `Nicht im Satz, deshalb Lotses Vorschlag: ${unsaid.map((k) => ({ scope: 'Rahmen', window: 'Zeitraum', format: 'Format', audience: 'Empfänger' }[k])).join(', ')} – du entscheidest gleich.`, `Not in the sentence, so Lotse's suggestion: ${unsaid.join(', ')} – you decide next.`), 'warn', 45, []));
  s.tone = 'info';
  s.how = { text: T(L, 'Lotse zerlegt den Auftrag in Schritte: Rahmen und Empfänger bestimmen, je Empfänger die gewählten Bausteine mit den Zahlen des Cockpits rechnen (Kapazität, Buchungscheck, Jira-Stories), Risiken und Vorschläge ableiten, das Dokument setzen und jede Zahl im Nachweis belegen.', 'Lotse breaks the job into steps: settle the scope and recipients, compute the chosen blocks per recipient with the cockpit\'s numbers (capacity, booking check, Jira stories), derive risks and suggestions, typeset the document and prove every number in the appendix.'),
    inputs: [[T(L, 'Satz', 'Sentence'), short(job.text || '–', 130)], [T(L, 'Rahmen', 'Scope'), job.scope?.name || '–'], [T(L, 'Zeitraum', 'Period'), job.window.label[L === 'en' ? 1 : 0]]] };
  s.confidence = 'high';
  s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity'), T(L, 'Buchungen', 'Bookings')];
  return doneStory(s);
}

// ---------- one subject ----------
export function subjectStory(ctx, job, entry) {
  const L = langOf(ctx);
  const { subject, data: d, findings } = entry;
  const s = newStory(ctx, { skill: 'orchestrate', subject: { kind: subject.kind === 'person' ? 'person' : subject.kind, ref: subject.id, name: subject.name }, lang: L });
  s.id = `orchestrate:${subject.kind}:${subject.id}`;
  const F = s.fmt;
  entities(s, ctx, job, [subject]);
  const coming = (d.weeks || []).filter((w) => !w.past), past = (d.weeks || []).filter((w) => w.past);
  const labels = (d.weeks || []).map((w) => weekLabel(L, w)).slice(-26);
  const risky = findings.filter((f) => f.tone === 'bad' || f.tone === 'warn');
  if (d.kind === 'person') {
    const peak = coming.filter((w) => Number.isFinite(w.util)).sort((a, b) => b.util - a.util)[0];
    const here = sum(coming, (w) => w.planScope || 0);
    if (peak) s.kpis.push(kpi('peak', T(L, 'Höchste Woche', 'Peak week'), pct(peak.util) ?? 0, '%', { tone: peak.util > 1.0001 ? 'bad' : peak.util > 0.85 ? 'warn' : 'ok' }));
    if (coming.length) s.kpis.push(kpi('here', job.scope?.kind === 'project' || job.scope?.kind === 'team' || job.scope?.kind === 'myTeam' ? T(L, 'Hier geplant', 'Planned here') : T(L, 'Geplant', 'Planned'), here, 'h'));
    if (past.length) { const poss = sum(past, (w) => w.possible || 0), b = sum(past, (w) => w.booked || 0); s.kpis.push(kpi('booked', T(L, 'Gebucht (Quote)', 'Booked (rate)'), poss > 0 ? Math.round((b / poss) * 100) : 0, '%', { tone: poss > 0 && b / poss < (past[0].minPct || 80) / 100 ? 'warn' : 'ok' })); }
    s.kpis.push(kpi('tasks', T(L, 'Offene Stories', 'Open stories'), d.tasks.length, 'n'));
    s.kpis.push(kpi('risks', T(L, 'Risiken', 'Risks'), risky.length, 'n', { tone: risky.length ? 'warn' : 'ok' }));
    const scoped = job.scope?.kind === 'project' || job.scope?.kind === 'team' || job.scope?.kind === 'myTeam';
    const series = [];
    if (coming.length) {
      if (scoped) series.push({ name: T(L, 'Hier geplant', 'Planned here'), values: d.weeks.map((w) => (w.past ? null : h1(w.planScope))), tone: 'info' });
      series.push({ name: T(L, scoped ? 'Gesamt geplant' : 'Geplant', scoped ? 'Planned in total' : 'Planned'), values: d.weeks.map((w) => (w.past ? null : h1(w.plan))), tone: 'ink' });
      series.push({ name: T(L, 'Verfügbar', 'Available'), values: d.weeks.map((w) => (w.past ? null : h1(w.cap))), tone: 'muted' });
    }
    if (past.length) series.push({ name: T(L, 'Gebucht', 'Booked'), values: d.weeks.map((w) => (w.past ? h1(w.booked) : null)), tone: 'ok' });
    if (!coming.length && past.length) series.push({ name: T(L, 'Möglich', 'Possible'), values: d.weeks.map((w) => h1(w.possible)), tone: 'muted' });
    s.visual = { kind: 'columns', data: { unit: 'h', labels, series: series.slice(0, 4).map((x) => ({ ...x, values: x.values.slice(-26) })) }, caption: T(L, `Stunden je Woche: ${past.length ? 'gebucht in den vergangenen Wochen, ' : ''}${coming.length ? `${scoped ? 'hier und insgesamt geplant' : 'geplant'} gegen die verfügbare Zeit` : 'gegen die mögliche Zeit'} – wie Kapazität und Buchungscheck.`, `Hours per week: ${past.length ? 'booked in the past weeks, ' : ''}${coming.length ? `${scoped ? 'planned here and in total' : 'planned'} against the available time` : 'against the possible time'} – as Capacity and the booking check count them.`) };
  } else if (d.kind === 'team') {
    const peak = coming.filter((w) => Number.isFinite(w.util)).sort((a, b) => b.util - a.util)[0];
    if (peak) s.kpis.push(kpi('peak', T(L, 'Höchste Woche', 'Peak week'), pct(peak.util) ?? 0, '%', { tone: peak.util > 1.0001 ? 'bad' : 'ok' }));
    s.kpis.push(kpi('over', T(L, 'Wochen über 100 %', 'Weeks over 100%'), coming.filter((w) => w.util > 1.0001).length, 'n'));
    s.kpis.push(kpi('overdue', T(L, 'Überfällig', 'Overdue'), d.overdue.length, 'n', { tone: d.overdue.length ? 'bad' : 'ok' }));
    s.kpis.push(kpi('members', T(L, 'Personen', 'People'), d.members, 'n'));
    const series = [];
    if (coming.length) { series.push({ name: T(L, 'Geplant', 'Planned'), values: d.weeks.map((w) => (w.past ? null : h1(w.plan))), tone: 'ink' }); series.push({ name: T(L, 'Verfügbar', 'Available'), values: d.weeks.map((w) => (w.past ? null : h1(w.cap))), tone: 'muted' }); }
    if (past.length) series.push({ name: T(L, 'Gebucht', 'Booked'), values: d.weeks.map((w) => (w.past ? h1(w.booked) : null)), tone: 'ok' });
    s.visual = { kind: 'columns', data: { unit: 'h', labels, series: series.length ? series : [{ name: T(L, 'Geplant', 'Planned'), values: labels.map(() => 0) }] }, caption: T(L, 'Geplante Stunden des Teams je Woche gegen seine Kapazität – wie in Kapazität.', 'The team\'s planned hours per week against its capacity – as in Capacity.') };
    for (const p of d.byProject) addProject(s, computedOf(ctx).model.itemByRef.get(p.ref));
  } else {
    s.kpis.push(kpi('progress', T(L, 'Fortschritt', 'Progress'), d.progress != null ? Math.round(d.progress * 100) : 0, '%'));
    s.kpis.push(kpi('overdue', T(L, 'Überfällig', 'Overdue'), d.overdue.length, 'n', { tone: d.overdue.length ? 'bad' : 'ok' }));
    s.kpis.push(kpi('open', T(L, 'Offene Stories', 'Open stories'), d.open, 'n'));
    s.kpis.push(kpi('remaining', T(L, 'Rest', 'Remaining'), d.remaining, 'h'));
    if (d.overdue.length) s.visual = { kind: 'bars', data: { unit: 'd', items: d.overdue.slice().sort((a, b) => b.days - a.days).slice(0, 12).map((t) => ({ label: `${t.key} · ${short(t.summary, 26)}`, key: t.key, value: t.days, tone: t.days > 14 ? 'bad' : 'warn', sub: t.assignee || undefined })) }, caption: T(L, 'Überfällige Stories – Tage seit dem Due Date.', 'Overdue stories – days since the due date.') };
    else s.visual = { kind: 'columns', data: { unit: 'h', labels: d.weeks.map((w) => weekLabel(L, w)).slice(0, 26), series: [{ name: T(L, 'Eingeplant', 'Planned'), values: d.weeks.map((w) => h1(w.plan)).slice(0, 26), tone: 'ink' }] }, caption: T(L, 'Eingeplante Stunden des Projekts je Woche (Remaining Estimate, linear verteilt).', 'Planned hours of the project per week (remaining estimate, spread linearly).') };
    if (!d.weeks.length && !d.overdue.length) s.visual = { kind: 'donut', data: { unit: 'n', total: d.open, items: [{ label: T(L, 'offene Stories', 'open stories'), value: d.open, tone: 'ink' }] }, caption: T(L, 'Offene Stories des Projekts.', 'Open stories of the project.') };
  }
  for (const f of findings.slice(0, 4)) s.findings.push(finding(f.text, f.tone, f.impact, f.evidence));
  const top = findings[0];
  s.headline = `${subject.name}: ${top.text}`;
  s.tone = findings.some((f) => f.tone === 'bad') ? 'bad' : risky.length ? 'warn' : 'ok';
  s.how = { text: d.kind === 'person' ? T(L, 'Geplant = Remaining Estimate jeder offenen Story, gleichmäßig von Start (frühestens heute) bis Due Date verteilt; verfügbar = Wochenstunden minus Tagesgeschäft, Intern, Support-Reserve, Feiertage und Abwesenheit. Gebucht = alle Worklogs der Woche; möglich = Wochenstunden je Arbeitstag × Arbeitstage nach Feiertagen und Abwesenheit.', 'Planned = the remaining estimate of every open story, spread evenly from its start (today at the earliest) to its due date; available = weekly hours minus daily business, internal work, support reserve, holidays and absence. Booked = every worklog of the week; possible = weekly hours per working day × working days after holidays and absence.')
    : d.kind === 'team' ? T(L, 'Geplant und verfügbar wie in Kapazität: die Stories des Teams gegen die Kapazität seiner Personen (mit ihrem Anteil am Team).', 'Planned and available as in Capacity: the team\'s stories against the capacity of its people (with their share of the team).')
      : T(L, 'Fortschritt und Termin wie im Portfolio; überfällig = offene Story mit Due Date vor heute.', 'Progress and due date as in the portfolio; overdue = an open story with a due date before today.'),
  inputs: [[T(L, 'Wochen', 'Weeks'), String((d.weeks || []).length)], [T(L, 'Bausteine', 'Blocks'), job.blocks.map((b) => BLOCK_NAMES[b][L === 'en' ? 1 : 0]).join(', ').slice(0, 130)]] };
  s.confidence = 'high';
  s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity'), ...(past.length ? [T(L, 'Buchungen', 'Bookings')] : [])];
  return doneStory(s);
}

// ---------- the overview ----------
export function overviewStory(ctx, job, run) {
  const L = langOf(ctx);
  const s = newStory(ctx, { skill: 'orchestrate', subject: { kind: subjectKind(job), ref: job.scope?.ref ?? null, name: job.scope?.name || 'Portfolio' }, lang: L });
  s.id = `orchestrate:overview:${job.scope?.ref || job.scope?.kind || 'all'}`;
  const F = s.fmt;
  const list = run.subjects;
  entities(s, ctx, job, list.map((x) => x.subject));
  if (!list.length) return infoStory(ctx, { skill: 'orchestrate', lang: L, subject: s.subject, headline: T(L, 'Für diesen Auftrag ist niemand ausgewählt.', 'Nobody is selected for this job.'), finding: T(L, 'Wähle mindestens eine Person, ein Team oder ein Projekt.', 'Pick at least one person, team or project.') });
  const W = run.weeks.filter((w) => !w.past);
  const cols = W.slice(0, 12).map((w) => weekLabel(L, w));
  const risky = list.filter((x) => x.findings.some((f) => f.tone === 'bad' || f.tone === 'warn'));
  if (list[0].data.kind !== 'project' && cols.length) {
    s.visual = { kind: 'heat', data: { unit: '%', cols, rows: list.slice(0, 12).map((x) => ({ label: short(x.subject.name, 40), values: x.data.weeks.filter((w) => !w.past).slice(0, 12).map((w) => (Number.isFinite(w.util) ? pct(w.util) : null)) })) }, caption: T(L, 'Auslastung je Woche (geplant ÷ verfügbar) – über 100 % rot; leer = keine verfügbare Zeit.', 'Load per week (planned ÷ available) – above 100% red; empty = no available time.') };
    const pw = sum(list, (x) => x.data.weeks.filter((w) => !w.past && w.util > 1.0001).length);
    const who = list.filter((x) => x.data.weeks.some((w) => !w.past && w.util > 1.0001));
    s.kpis.push(kpi('overSubjects', T(L, 'Über 100 % (mind. eine Woche)', 'Over 100% (at least one week)'), who.length, 'n', { tone: who.length ? 'warn' : 'ok' }));
    s.kpis.push(kpi('overWeeks', T(L, list[0].data.kind === 'team' ? 'Teamwochen über 100 %' : 'Personenwochen über 100 %', list[0].data.kind === 'team' ? 'Team-weeks over 100%' : 'Person-weeks over 100%'), pw, 'n', { tone: pw ? 'warn' : 'ok' }));
    s.headline = who.length
      ? T(L, `Überblick: ${who.length} von ${list.length} ${subjectWord(L, job.subjects, list.length)} liegen in mindestens einer Woche über 100 %, zusammen ${pw} ${plural(pw, 'Woche', 'Wochen')}.`, `Overview: ${who.length} of ${list.length} ${subjectWord(L, job.subjects, list.length)} are over 100% in at least one week, ${pw} ${plural(pw, 'week', 'weeks')} together.`)
      : T(L, `Überblick: keine der ${list.length} ${subjectWord(L, job.subjects, list.length)} liegt in den nächsten ${W.length} Wochen über 100 %.`, `Overview: none of the ${list.length} ${subjectWord(L, job.subjects, list.length)} is over 100% in the next ${W.length} weeks.`);
    s.findings.push(finding(s.headline.replace(/^(Überblick|Overview): /, ''), who.length ? 'warn' : 'ok', 70, [ev(T(L, 'über 100 %', 'over 100%'), who.length, 'n'), ev(T(L, 'gesamt', 'total'), list.length, 'n'), ev(T(L, 'Wochen über 100 %', 'weeks over 100%'), pw, 'n'), ev(T(L, 'Wochen', 'weeks'), W.length, 'n'), ev(T(L, 'Ziel', 'target'), 100, '%')]));
    if (who.length && !s.headline.includes(String(W.length))) { /* the count of weeks is only in the second form */ }
  } else {
    const items = list.slice(0, 12).map((x) => ({ label: short(x.subject.name, 40), value: x.data.kind === 'project' ? x.data.overdue.length : x.data.tasks?.length || 0, tone: x.findings.some((f) => f.tone === 'bad') ? 'bad' : 'ink' }));
    s.visual = { kind: 'bars', data: { unit: 'n', items }, caption: list[0].data.kind === 'project' ? T(L, 'Überfällige Stories je Projekt.', 'Overdue stories per project.') : T(L, 'Offene Stories je Empfänger.', 'Open stories per recipient.') };
    const total = sum(items, (x) => x.value);
    s.kpis.push(kpi('total', list[0].data.kind === 'project' ? T(L, 'Überfällige Stories', 'Overdue stories') : T(L, 'Offene Stories', 'Open stories'), total, 'n', { tone: total && list[0].data.kind === 'project' ? 'bad' : 'ok' }));
    s.headline = list[0].data.kind === 'project'
      ? T(L, `Überblick: ${total} überfällige ${plural(total, 'Story', 'Stories')} in ${list.length} ${plural(list.length, 'Projekt', 'Projekten')}.`, `Overview: ${total} overdue ${plural(total, 'story', 'stories')} in ${list.length} ${plural(list.length, 'project', 'projects')}.`)
      : T(L, `Überblick: ${total} offene ${plural(total, 'Story', 'Stories')} bei ${list.length} Empfängern.`, `Overview: ${total} open ${plural(total, 'story', 'stories')} across ${list.length} recipients.`);
    s.findings.push(finding(s.headline.replace(/^(Überblick|Overview): /, ''), total ? 'warn' : 'ok', 70, [ev(T(L, 'gesamt', 'total'), total, 'n'), ev(T(L, 'Empfänger', 'recipients'), list.length, 'n')]));
  }
  s.kpis.push(kpi('subjects', T(L, 'Abschnitte', 'Sections'), list.length, 'n'));
  s.kpis.push(kpi('risky', T(L, 'Mit Risiken', 'With risks'), risky.length, 'n', { tone: risky.length ? 'warn' : 'ok' }));
  const worst = [...list].map((x) => ({ x, f: x.findings[0] })).filter((y) => y.f && (y.f.tone === 'bad' || y.f.tone === 'warn')).sort((a, b) => b.f.impact - a.f.impact).slice(0, 3);
  for (const y of worst) s.findings.push(finding(`${y.x.subject.name}: ${y.f.text}`, y.f.tone, Math.min(69, y.f.impact - 10), y.f.evidence));
  if (!worst.length) s.findings.push(finding(T(L, 'Bei keinem Empfänger ein Risiko in den gewählten Bausteinen.', 'No recipient has a risk in the chosen blocks.'), 'ok', 40, []));
  s.tone = risky.length ? 'warn' : 'ok';
  s.how = { text: T(L, 'Dieselben Zahlen wie in den persönlichen Abschnitten – zusammengefasst über alle Empfänger.', 'The same numbers as in the personal sections – summed up over every recipient.'), inputs: [[T(L, 'Empfänger', 'Recipients'), String(list.length)]] };
  s.confidence = 'high';
  s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity')];
  void F; void dsOf; void inScope;
  return doneStory(s);
}
