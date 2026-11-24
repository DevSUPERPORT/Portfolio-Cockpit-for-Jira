// Lotse orchestration – the document of a job as a pure model (the client paints it: static/cockpit/src/lib/jobPdf.js).
//
//   buildJobDoc(ctx, job) → doc = {
//     v: 1, kind: 'lotseJob', lang, title, subtitle, author, asOf, today, audience, tone, format,
//     cover:    { title, subtitle, lines: [[label, text]], intro },
//     overview: { heading, paragraphs[], kpis[{ label, value, unit, display, proof }], visual, findings[] },
//     sections: [{ id, subject: { kind, id, name }, heading, tone, greeting, paragraphs[], kpis[], visual,
//                  tables: [{ id, title, columns[], align[], rows: [{ cells: [{ text, proof? }], tone? }], empty? }],
//                  findings: [{ text, tone }], suggestions: [{ text, ask }], message: { to, subject, text } }],
//     proof:    [{ id, section, label, values: [[label, display]], formula, inputs: [[label, display]], keys[], source }],
//     messages: [{ id, to, subject, text }],
//     sources:  string[]
//   }
// Every number a table or a KPI shows carries `proof` – the id of a proof row with its formula, inputs and Jira keys
// (docProblems() checks it). The findings are the sentences of data.js assess() – the same as the story cards.
import { runJob, weekLabel, scopeName } from '../act/orchestrate/data.js';
import { overviewStory, subjectStory } from '../act/orchestrate/stories.js';
import { BLOCK_NAMES } from '../act/orchestrate/parse.js';
import { fmtOf, T, plural } from '../narrate.js';
import { computedOf, dsOf, sum, memo } from '../kit.js';

const pct = (u) => (Number.isFinite(u) ? Math.round(u * 100) : null);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
const firstName = (n) => String(n || '').split(' ')[0] || n;
const keysText = (keys, max = 12) => (keys.length > max ? `${keys.slice(0, max).join(', ')} …` : keys.join(', '));

// the same job on the same data gives the same document – built once (the workflow re-plans after every answer)
export function buildJobDoc(ctx, job) {
  return memo(ctx, `orch:doc:${ctx?.lang === 'en' ? 'en' : 'de'}:${ctx?.me?.id || ''}:${ctx?.now ?? ''}:${JSON.stringify(job)}`, () => build(ctx, job));
}
function build(ctx, job) {
  const L = ctx?.lang === 'en' ? 'en' : 'de';
  const F = fmtOf({ ...ctx, fmt: null }, L); // the document's own language, not the screen's formatter
  const lc = { ...ctx, lang: L, fmt: null };
  const run = runJob(lc, job);
  const ds = dsOf(lc);
  const me = ctx?.me?.name || ds.people?.[ctx?.me?.id]?.name || null;
  const asOf = new Date(Number.isFinite(ctx?.now) ? ctx.now : Date.now()).toISOString();
  const W = run.weeks;
  const proof = [];
  let pn = 0;
  const addProof = (section, label, values, formula, inputs, keys = [], source = '') => { const id = `p${++pn}`; proof.push({ id, section, label, values, formula, inputs, keys: [...new Set(keys)].slice(0, 40), source }); return id; };
  const cell = (text, p) => (p ? { text, proof: p } : { text });
  const subjWord = { people: T(L, 'Person', 'person'), person: T(L, 'Person', 'person'), teams: 'Team', projects: T(L, 'Projekt', 'project') }[job.subjects];
  const kindTitle = job.subjects === 'teams' ? T(L, 'Teamwochen', 'Team weeks') : job.subjects === 'projects' ? T(L, 'Projektlage', 'Project status') : T(L, 'Arbeitswochen', 'Work weeks');
  const title = `${kindTitle} · ${job.scope?.name || 'Portfolio'}`;
  const period = W.length ? `${weekLabel(L, W[0])} – ${weekLabel(L, W.at(-1))} (${F.date(W[0].from)} – ${F.date(W.at(-1).to)})` : '–';
  const subtitle = T(L, `${job.window.label[0].charAt(0).toUpperCase()}${job.window.label[0].slice(1)} · ${period}`, `${job.window.label[1].charAt(0).toUpperCase()}${job.window.label[1].slice(1)} · ${period}`);
  const audienceText = { colleagues: T(L, 'Kolleginnen und Kollegen', 'colleagues'), management: T(L, 'Management', 'management'), teamLeads: T(L, 'Teamleitungen', 'team leads'), owners: T(L, 'Projekt-Owner', 'project owners') }[job.audience];
  const cover = {
    title, subtitle,
    lines: [
      [T(L, 'Rahmen', 'Scope'), job.scope?.kind === 'portfolio' ? 'Portfolio' : job.scope?.kind === 'project' ? T(L, `Projekt ${job.scope.name}`, `Project ${job.scope.name}`) : job.scope?.kind === 'person' ? job.scope.name : `Team ${job.scope?.name}`],
      [T(L, 'Für', 'For'), audienceText],
      [T(L, 'Bausteine', 'Blocks'), job.blocks.map((b) => BLOCK_NAMES[b][L === 'en' ? 1 : 0]).join(', ')],
      [T(L, 'Erstellt von', 'Prepared by'), me ? T(L, `${me} mit Lotse`, `${me} with Lotse`) : 'Lotse'],
      [T(L, 'Stand', 'As of'), `${F.date(ds.today)} ${String(ds.today).slice(0, 4)}`],
    ],
    intro: job.intro || T(L, `Dieses Dokument fasst ${job.window.label[0]} ${scopeName(L, job)} zusammen – ein Abschnitt je ${subjWord}, jede Zahl mit Quelle im Nachweis am Ende.`.replace(/\s{2,}/g, ' '), `This document sums up ${job.window.label[1]} ${scopeName(L, job)} – one section per ${subjWord}, every number with its source in the proof at the end.`.replace(/\s{2,}/g, ' ')),
  };

  // ---------- overview ----------
  const ov = overviewStory(lc, job, run);
  const ovProof = addProof('overview', T(L, 'Überblick', 'Overview'), ov.kpis.map((k) => [k.label, unitText(F, L, k.value, k.unit)]),
    T(L, 'Zusammenfassung der Abschnitte: dieselben Wochen- und Story-Zahlen wie unten, über alle Empfänger gezählt.', 'Summary of the sections: the same week and story numbers as below, counted over every recipient.'),
    [[T(L, 'Empfänger', 'Recipients'), String(run.subjects.length)], [T(L, 'Wochen', 'Weeks'), String(W.length)]], [], T(L, 'Abschnitte dieses Dokuments', 'Sections of this document'));
  const overview = {
    heading: T(L, 'Überblick', 'Overview'), paragraphs: [ov.headline], kpis: ov.kpis.map((k) => ({ label: k.label, value: k.value, unit: k.unit, display: unitText(F, L, k.value, k.unit), tone: k.tone || null, proof: ovProof })),
    visual: ov.visual, findings: ov.findings.slice(1).map((f) => ({ text: f.text, tone: f.tone })),
  };

  // ---------- one section per subject ----------
  const sections = run.subjects.map((e) => {
    const { subject, data: d, findings } = e;
    const sid = `s:${subject.id}`;
    const tables = [];
    const kpis = [];
    if (d.kind === 'person') {
      const coming = d.weeks.filter((w) => !w.past), past = d.weeks.filter((w) => w.past);
      const scoped = job.scope?.kind === 'project' || job.scope?.kind === 'team' || job.scope?.kind === 'myTeam';
      if (coming.length && job.blocks.includes('weeks')) {
        const rows = coming.map((w) => {
          const p = addProof(sid, `${d.name} · ${weekLabel(L, w)}`, [[T(L, 'hier geplant', 'planned here'), F.h(w.planScope, 1)], [T(L, 'gesamt geplant', 'planned in total'), F.h(w.plan, 1)], [T(L, 'verfügbar', 'available'), F.h(w.cap, 1)], [T(L, 'Auslastung', 'load'), Number.isFinite(w.util) ? pctText(L, pct(w.util)) : '–']],
            T(L, 'Geplant = Σ Remaining Estimate × Anteil der Arbeitstage der Woche am Fenster Start–Due (frühestens heute); Auslastung = gesamt geplant ÷ verfügbar.', 'Planned = Σ remaining estimate × share of the week\'s working days in the window start–due (today at the earliest); load = planned in total ÷ available.'),
            [[T(L, 'Woche', 'Week'), `${F.date(w.from)} – ${F.date(w.to)}`], [T(L, 'Verfügbar', 'Available'), T(L, 'Wochenstunden − Tagesgeschäft − Intern − Support-Reserve − Feiertage − Abwesenheit', 'weekly hours − daily business − internal − support reserve − holidays − absence')]], w.keys, T(L, 'Jira (Remaining Estimate, Start, Due) · Kapazitäten', 'Jira (remaining estimate, start, due) · Capacity'));
          return { cells: [cell(weekLabel(L, w)), ...(scoped ? [cell(F.h(w.planScope, 1), p)] : []), cell(F.h(w.plan, 1), p), cell(F.h(w.cap, 1), p), cell(Number.isFinite(w.util) ? pctText(L, pct(w.util)) : '–', p)], tone: w.util > 1.0001 ? 'bad' : w.util > 0.85 ? 'warn' : null };
        });
        tables.push({ id: 'weeks', title: T(L, 'Kommende Wochen', 'Coming weeks'), columns: [T(L, 'Woche', 'Week'), ...(scoped ? [T(L, 'Hier geplant', 'Planned here')] : []), T(L, 'Gesamt geplant', 'Planned in total'), T(L, 'Verfügbar', 'Available'), T(L, 'Auslastung', 'Load')], align: ['l', ...(scoped ? ['r'] : []), 'r', 'r', 'r'], rows });
      }
      if (past.length && job.blocks.includes('bookings')) {
        const rows = past.map((w) => {
          const p = addProof(sid, `${d.name} · ${weekLabel(L, w)} ${T(L, 'gebucht', 'booked')}`, [[T(L, 'gebucht', 'booked'), F.h(w.booked, 1)], [T(L, 'davon hier', 'of it here'), F.h(w.bookedScope, 1)], [T(L, 'möglich', 'possible'), F.h(w.possible, 1)], [T(L, 'Ziel', 'target'), F.h(w.target, 1)], [T(L, 'Quote', 'rate'), w.bookPct == null ? '–' : pctText(L, w.bookPct)]],
            T(L, `Wie der Buchungscheck: gebucht = alle Worklogs der Woche; möglich = Wochenstunden ÷ Arbeitstage je Woche × Arbeitstage nach Feiertagen und Abwesenheit; Ziel = möglich × ${w.minPct} %.`, `As the booking check: booked = every worklog of the week; possible = weekly hours ÷ working days per week × working days after holidays and absence; target = possible × ${w.minPct}%.`),
            [[T(L, 'Woche', 'Week'), `${F.date(w.from)} – ${F.date(w.to)}`], [T(L, 'Freie Tage', 'Days off'), String(w.off || 0)]], w.keys, T(L, 'Jira-Worklogs · Kapazitäten', 'Jira worklogs · Capacity'));
          return { cells: [cell(weekLabel(L, w)), cell(F.h(w.booked, 1), p), ...(scoped ? [cell(F.h(w.bookedScope, 1), p)] : []), cell(F.h(w.possible, 1), p), cell(w.bookPct == null ? '–' : pctText(L, w.bookPct), p)], tone: w.possible > 0 && (w.bookPct ?? 0) < w.minPct ? 'warn' : null };
        });
        tables.push({ id: 'bookings', title: T(L, 'Vergangene Wochen – gebucht', 'Past weeks – booked'), columns: [T(L, 'Woche', 'Week'), T(L, 'Gebucht', 'Booked'), ...(scoped ? [T(L, 'Davon hier', 'Of it here')] : []), T(L, 'Möglich', 'Possible'), T(L, 'Quote', 'Rate')], align: ['l', 'r', ...(scoped ? ['r'] : []), 'r', 'r'], rows });
      }
      if (job.blocks.includes('tasks') || job.blocks.includes('overdue')) {
        const list = job.blocks.includes('tasks') ? d.tasks : d.tasks.filter((t) => t.overdue || t.blocked);
        const p = list.length ? addProof(sid, T(L, `${d.name} · Stories`, `${d.name} · stories`), [[T(L, 'offen', 'open'), String(list.length)], [T(L, 'Rest', 'remaining'), F.h(sum(list, (t) => t.re), 1)]],
          T(L, 'Offene Stories mit dieser Person als Bearbeiter im Rahmen; Rest = Remaining Estimate; überfällig = Due Date vor heute.', 'Open stories assigned to this person in the scope; remaining = remaining estimate; overdue = due date before today.'), [[T(L, 'Heute', 'Today'), F.date(ds.today)]], list.map((t) => t.key), 'Jira') : null;
        tables.push({ id: 'tasks', title: job.blocks.includes('tasks') ? T(L, 'Aufgaben', 'Tasks') : T(L, 'Überfällig und blockiert', 'Overdue and blocked'), columns: [T(L, 'Key', 'Key'), T(L, 'Story', 'Story'), T(L, 'Fenster', 'Window'), T(L, 'Rest', 'Remaining'), T(L, 'Hinweis', 'Note')], align: ['l', 'l', 'l', 'r', 'l'],
          rows: list.slice(0, 18).map((t) => ({ cells: [cell(t.key), cell(t.summary), cell(`${t.start ? F.date(t.start) : '–'} – ${t.due ? F.date(t.due) : '–'}`), cell(t.noEstimate ? '–' : F.h(t.re, 1), p), cell([t.overdue ? T(L, 'überfällig', 'overdue') : null, t.blocked ? T(L, 'blockiert', 'blocked') : null, t.noEstimate ? T(L, 'ohne Schätzung', 'no estimate') : null, t.noDue ? T(L, 'ohne Due Date', 'no due date') : null].filter(Boolean).join(', '))], tone: t.overdue ? 'bad' : t.blocked || t.noEstimate ? 'warn' : null })),
          empty: T(L, 'Keine offenen Stories in diesem Rahmen.', 'No open stories in this scope.'), more: Math.max(0, list.length - 18) });
      }
      if (job.blocks.includes('absences')) {
        const rows = [...d.absences.map((a) => ({ cells: [cell(typeName(L, a.type)), cell(`${F.date(a.from)} – ${F.date(a.to)}`), cell(`${a.days} ${T(L, plural(a.days, 'Arbeitstag', 'Arbeitstage'), plural(a.days, 'working day', 'working days'))}`, addProof(sid, `${d.name} · ${typeName(L, a.type)}`, [[T(L, 'Arbeitstage', 'working days'), String(a.days)]], T(L, 'Arbeitstage der Abwesenheit im Zeitraum (Kapazitäten › Abwesenheiten).', 'Working days of the absence within the period (Capacity › Absences).'), [[T(L, 'von', 'from'), F.date(a.from)], [T(L, 'bis', 'to'), F.date(a.to)]], [], T(L, 'Kapazitäten', 'Capacity')))] })),
          ...d.holidays.map((h) => ({ cells: [cell(T(L, 'Feiertag', 'Public holiday')), cell(F.date(h.date)), cell(h.name)] }))];
        tables.push({ id: 'absences', title: T(L, 'Abwesenheiten und Feiertage', 'Absences and holidays'), columns: [T(L, 'Art', 'Kind'), T(L, 'Wann', 'When'), T(L, 'Dauer / Name', 'Length / name')], align: ['l', 'l', 'l'], rows, empty: T(L, 'Keine Abwesenheit und kein Feiertag im Zeitraum.', 'No absence and no public holiday in the period.') });
      }
      const peak = coming.filter((w) => Number.isFinite(w.util)).sort((a, b) => b.util - a.util)[0];
      const kp = addProof(sid, T(L, `${d.name} · Kennzahlen`, `${d.name} · key figures`), [
        ...(peak ? [[T(L, 'höchste Woche', 'peak week'), `${weekLabel(L, peak)} ${pctText(L, pct(peak.util))}`]] : []), [T(L, 'hier geplant', 'planned here'), F.h(sum(coming, (w) => w.planScope || 0), 1)], [T(L, 'offene Stories', 'open stories'), String(d.tasks.length)]],
        T(L, 'Höchste Woche = Maximum der Auslastung der kommenden Wochen (Tabelle oben); hier geplant = Summe der Spalte „Hier geplant“.', 'Peak week = maximum load of the coming weeks (table above); planned here = sum of the column "Planned here".'), [[T(L, 'Wochen', 'Weeks'), String(coming.length)]], [], T(L, 'Tabellen dieses Abschnitts', 'Tables of this section'));
      if (peak) kpis.push({ label: T(L, 'Höchste Woche', 'Peak week'), value: pct(peak.util), unit: '%', display: pctText(L, pct(peak.util)), tone: peak.util > 1.0001 ? 'bad' : peak.util > 0.85 ? 'warn' : 'ok', proof: kp });
      if (coming.length) kpis.push({ label: scoped ? T(L, 'Hier geplant', 'Planned here') : T(L, 'Geplant', 'Planned'), value: r1(sum(coming, (w) => w.planScope || 0)), unit: 'h', display: F.h(sum(coming, (w) => w.planScope || 0), 1), proof: kp });
      kpis.push({ label: T(L, 'Offene Stories', 'Open stories'), value: d.tasks.length, unit: 'n', display: F.n(d.tasks.length), proof: kp });
      if (past.length && job.blocks.includes('bookings')) {
        const poss = sum(past, (w) => w.possible), b = sum(past, (w) => w.booked);
        const q = poss > 0 ? Math.round((b / poss) * 100) : 0;
        kpis.push({ label: T(L, 'Buchungsquote', 'Booking rate'), value: q, unit: '%', display: pctText(L, q), tone: q < (past[0].minPct || 80) ? 'warn' : 'ok', proof: addProof(sid, T(L, `${d.name} · Buchungsquote`, `${d.name} · booking rate`), [[T(L, 'gebucht', 'booked'), F.h(b, 1)], [T(L, 'möglich', 'possible'), F.h(poss, 1)], [T(L, 'Quote', 'rate'), pctText(L, q)]], T(L, 'Quote = Σ gebucht ÷ Σ möglich der vergangenen Wochen.', 'Rate = Σ booked ÷ Σ possible of the past weeks.'), [[T(L, 'Wochen', 'Weeks'), String(past.length)]], [], T(L, 'Tabelle „Vergangene Wochen“', 'Table "Past weeks"')) });
      }
      if (d.planActual && job.blocks.includes('planActual')) {
        const pa = d.planActual;
        tables.push({ id: 'planActual', title: T(L, 'Plan vs. Ist', 'Plan vs. actual'), columns: [T(L, 'Zeitraum', 'Period'), T(L, 'Geplant', 'Planned'), T(L, 'Gebucht', 'Booked'), T(L, 'Differenz', 'Difference')], align: ['l', 'r', 'r', 'r'],
          rows: [{ cells: [cell(`${pa.weeks} ${T(L, plural(pa.weeks, 'Woche', 'Wochen'), plural(pa.weeks, 'week', 'weeks'))}${pa.from ? ` (${F.date(pa.from)} – ${F.date(pa.to)})` : ''}`), ...[pa.plan, pa.book, pa.diff].map((v, i) => cell(i === 2 ? `${v >= 0 ? '+' : '−'}${F.h(Math.abs(v), 1)}` : F.h(v, 1), addProof(sid, T(L, `${d.name} · Plan vs. Ist`, `${d.name} · plan vs. actual`), [[T(L, 'geplant', 'planned'), F.h(pa.plan, 1)], [T(L, 'gebucht', 'booked'), F.h(pa.book, 1)]], T(L, 'Aus den Plan-vs-Ist-Wochen: geplant = Montags-Snapshot des Plans, gebucht = die Worklogs der Woche.', 'From the plan-vs-actual weeks: planned = the Monday snapshot of the plan, booked = the worklogs of the week.'), [], [], T(L, 'Plan vs. Ist', 'Plan vs. actual'))))] }] });
      }
    } else if (d.kind === 'team') {
      const coming = d.weeks.filter((w) => !w.past);
      if (coming.length) tables.push({ id: 'weeks', title: T(L, 'Kommende Wochen', 'Coming weeks'), columns: [T(L, 'Woche', 'Week'), T(L, 'Geplant', 'Planned'), T(L, 'Verfügbar', 'Available'), T(L, 'Auslastung', 'Load'), T(L, 'Personen > 100 %', 'People > 100%')], align: ['l', 'r', 'r', 'r', 'r'],
        rows: coming.map((w) => { const p = addProof(sid, `${d.name} · ${weekLabel(L, w)}`, [[T(L, 'geplant', 'planned'), F.h(w.plan)], [T(L, 'verfügbar', 'available'), F.h(w.cap)], [T(L, 'Auslastung', 'load'), Number.isFinite(w.util) ? pctText(L, pct(w.util)) : '–'], [T(L, 'über 100 %', 'over 100%'), (w.overNames || []).join(', ') || '–']], T(L, 'Wie Kapazität: Stories des Teams (Remaining Estimate linear) gegen die Kapazität seiner Personen × Teamanteil.', 'As in Capacity: the team\'s stories (remaining estimate, linear) against its people\'s capacity × team share.'), [[T(L, 'Woche', 'Week'), `${F.date(w.from)} – ${F.date(w.to)}`]], [], T(L, 'Jira · Kapazitäten', 'Jira · Capacity'));
          return { cells: [cell(weekLabel(L, w)), cell(F.h(w.plan), p), cell(F.h(w.cap), p), cell(Number.isFinite(w.util) ? pctText(L, pct(w.util)) : '–', p), cell(F.n(w.over || 0), p)], tone: w.util > 1.0001 ? 'bad' : null }; }) });
      if (d.overdue.length || d.blocked.length) tables.push({ id: 'overdue', title: T(L, 'Überfällig und blockiert', 'Overdue and blocked'), columns: ['Key', 'Story', T(L, 'Bearbeiter', 'Assignee'), 'Due', T(L, 'Hinweis', 'Note')], align: ['l', 'l', 'l', 'l', 'l'],
        rows: [...d.overdue.slice(0, 12).map((t) => ({ cells: [cell(t.key), cell(t.summary), cell(t.assignee || '–'), cell(F.date(t.due)), cell(T(L, 'überfällig', 'overdue'))], tone: 'bad' })), ...d.blocked.slice(0, 6).map((t) => ({ cells: [cell(t.key), cell(t.summary), cell('–'), cell('–'), cell(t.reason || T(L, 'blockiert', 'blocked'))], tone: 'warn' }))] });
      if (job.blocks.includes('support') && d.support?.risk?.length) {
        const sp = addProof(sid, T(L, `${d.name} · SLA-Risiko`, `${d.name} · SLA risk`), [[T(L, 'Tickets mit SLA-Risiko', 'tickets at SLA risk'), String(d.support.risk.length)], [T(L, 'Support gebucht', 'support booked'), d.support.booked != null ? F.h(d.support.booked, 1) : '–']], T(L, 'Offene Tickets des Teams; SLA aus Jira Service Management oder der SLA-Regel der Konfiguration (knapp = 75 % der Zeit verbraucht); Support gebucht = Worklogs auf Tickets des Teams in den vergangenen Wochen.', 'Open tickets of the team; SLA from Jira Service Management or the configuration\'s SLA policy (at risk = 75% of the time used); support booked = worklogs on the team\'s tickets in the past weeks.'), [], [...d.support.risk.map((x) => x.key), ...(d.support.keys || [])], 'Jira Service Management');
        tables.push({ id: 'sla', title: T(L, 'Offene Tickets mit SLA-Risiko', 'Open tickets at SLA risk'), columns: ['Key', 'Ticket', T(L, 'Priorität', 'Priority'), 'SLA'], align: ['l', 'l', 'l', 'r'],
          rows: d.support.risk.slice(0, 14).map((x) => ({ cells: [cell(x.key), cell(x.summary), cell(x.priority || '–'), cell(x.left < 0 ? T(L, `${F.h(-x.left, 1)} drüber`, `${F.h(-x.left, 1)} over`) : T(L, `${F.h(x.left, 1)} übrig`, `${F.h(x.left, 1)} left`), sp)], tone: x.status === 'breached' ? 'bad' : 'warn' })), more: Math.max(0, d.support.risk.length - 14) });
      }
      const pk = coming.filter((w) => Number.isFinite(w.util)).sort((a, b) => b.util - a.util)[0];
      const kp = addProof(sid, T(L, `${d.name} · Kennzahlen`, `${d.name} · key figures`), [[T(L, 'Personen', 'people'), String(d.members)], [T(L, 'überfällig', 'overdue'), String(d.overdue.length)], ...(pk ? [[T(L, 'Spitze', 'peak'), pctText(L, pct(pk.util))]] : [])], T(L, 'Personen = Mitglieder mit Kapazität; überfällig = offene Stories des Teams mit Due Date vor heute.', 'People = members with capacity; overdue = the team\'s open stories with a due date before today.'), [], d.overdue.map((t) => t.key), 'Jira · Kapazitäten');
      if (pk) kpis.push({ label: T(L, 'Spitze', 'Peak'), value: pct(pk.util), unit: '%', display: pctText(L, pct(pk.util)), tone: pk.util > 1.0001 ? 'bad' : 'ok', proof: kp });
      kpis.push({ label: T(L, 'Personen', 'People'), value: d.members, unit: 'n', display: F.n(d.members), proof: kp });
      kpis.push({ label: T(L, 'Überfällig', 'Overdue'), value: d.overdue.length, unit: 'n', display: F.n(d.overdue.length), tone: d.overdue.length ? 'bad' : 'ok', proof: kp });
    } else {
      const kp = addProof(sid, T(L, `${d.name} · Kennzahlen`, `${d.name} · key figures`), [[T(L, 'Fortschritt', 'progress'), d.progress != null ? pctText(L, Math.round(d.progress * 100)) : '–'], [T(L, 'offene Stories', 'open stories'), String(d.open)], [T(L, 'Rest', 'remaining'), F.h(d.remaining)], [T(L, 'überfällig', 'overdue'), String(d.overdue.length)]],
        T(L, 'Fortschritt wie im Portfolio (Time Spent ÷ (Time Spent + Remaining)); Rest = Σ Remaining Estimate der offenen Stories; überfällig = Due Date vor heute.', 'Progress as in the portfolio (time spent ÷ (time spent + remaining)); remaining = Σ remaining estimate of the open stories; overdue = due date before today.'), d.due ? [[T(L, 'Termin', 'Due'), F.date(d.due)]] : [], [d.key, ...d.overdue.map((t) => t.key)].filter(Boolean), 'Jira');
      kpis.push({ label: T(L, 'Fortschritt', 'Progress'), value: d.progress != null ? Math.round(d.progress * 100) : 0, unit: '%', display: d.progress != null ? pctText(L, Math.round(d.progress * 100)) : '–', proof: kp });
      kpis.push({ label: T(L, 'Offene Stories', 'Open stories'), value: d.open, unit: 'n', display: F.n(d.open), proof: kp });
      kpis.push({ label: T(L, 'Rest', 'Remaining'), value: d.remaining, unit: 'h', display: F.h(d.remaining), proof: kp });
      kpis.push({ label: T(L, 'Überfällig', 'Overdue'), value: d.overdue.length, unit: 'n', display: F.n(d.overdue.length), tone: d.overdue.length ? 'bad' : 'ok', proof: kp });
      tables.push({ id: 'overdue', title: T(L, 'Überfällige Stories', 'Overdue stories'), columns: ['Key', 'Story', T(L, 'Bearbeiter', 'Assignee'), 'Due', T(L, 'Tage', 'Days')], align: ['l', 'l', 'l', 'l', 'r'],
        rows: d.overdue.slice(0, 16).map((t) => ({ cells: [cell(t.key), cell(t.summary), cell(t.assignee || '–'), cell(F.date(t.due)), cell(F.n(t.days), kp)], tone: t.days > 14 ? 'bad' : 'warn' })), empty: T(L, 'Keine überfällige Story.', 'No overdue story.') });
    }
    const greeting = greetingOf(L, job, subject, d);
    const suggestions = findings.filter((f) => f.suggest).slice(0, 4).map((f) => ({ text: f.suggest.text, ask: f.suggest.ask }));
    const message = messageOf(L, job, subject, d, findings, suggestions, me, F);
    return {
      id: sid, subject: { kind: subject.kind, id: subject.id, name: subject.name }, heading: subject.name, tone: findings.some((f) => f.tone === 'bad') ? 'bad' : findings.some((f) => f.tone === 'warn') ? 'warn' : 'ok',
      greeting, paragraphs: [findings[0].text], kpis, visual: storyVisual(lc, job, e), tables, findings: findings.slice(0, 5).map((f) => ({ text: f.text, tone: f.tone })), suggestions, message,
    };
  });
  return {
    v: 1, kind: 'lotseJob', lang: L, title, subtitle, author: me, asOf, today: ds.today, audience: job.audience, tone: job.tone, format: job.format,
    scope: job.scope, window: { ...job.window, from: W[0]?.from || null, to: W.at(-1)?.to || null },
    cover, overview, sections, proof, messages: sections.map((s) => ({ id: s.id, ...s.message })),
    sources: ['Jira', T(L, 'Kapazitäten', 'Capacity'), ...(job.blocks.includes('bookings') ? [T(L, 'Buchungscheck', 'Booking check')] : []), ...(job.blocks.includes('planActual') ? [T(L, 'Plan vs. Ist', 'Plan vs. actual')] : [])],
  };
}
// a document with only one section (the personal PDF of one recipient)
export function sectionDoc(doc, sectionId) {
  const s = doc.sections.find((x) => x.id === sectionId);
  if (!s) return null;
  const ids = new Set();
  const walk = (o) => { if (!o || typeof o !== 'object') return; if (typeof o.proof === 'string') ids.add(o.proof); for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v); };
  walk(s);
  return { ...doc, title: `${doc.title} · ${s.heading}`, cover: { ...doc.cover, title: `${doc.cover.title} · ${s.heading}` }, overview: null, sections: [s], proof: doc.proof.filter((p) => ids.has(p.id) || p.section === s.id), messages: doc.messages.filter((m) => m.id === s.id) };
}

// The structure checks the tests (and the UI, before painting) run: every number a table cell or a KPI shows has a proof
// row; one section per selected subject; a message per section. → [] when complete.
export function docProblems(doc) {
  const out = [];
  const ids = new Set(doc.proof.map((p) => p.id));
  const numeric = (t) => /\d/.test(String(t || '').replace(/\b[A-Z][A-Z0-9_]{0,19}-\d+\b/g, '').replace(/\b(KW|W)\s?\d{1,2}\b/g, '').replace(/\d{1,2}\.? ?(Jan|Feb|Mär|Mar|Apr|Mai|May|Jun|Jul|Aug|Sep|Okt|Oct|Nov|Dez|Dec)\.?/g, '').replace(/\d{1,2}\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/g, ''));
  for (const k of doc.overview?.kpis || []) if (!ids.has(k.proof)) out.push(`overview kpi ${k.label} without proof`);
  for (const s of doc.sections) {
    for (const k of s.kpis) if (!ids.has(k.proof)) out.push(`${s.id}: kpi ${k.label} without proof`);
    for (const t of s.tables) for (const r of t.rows) for (const c of r.cells) if (numeric(c.text) && c.text !== '–' && !(c.proof && ids.has(c.proof)) && !isLabelCell(t, r, c)) out.push(`${s.id}/${t.id}: "${c.text}" without proof`);
    if (!s.message?.text) out.push(`${s.id}: no message`);
  }
  return out;
}
// the first cell of a row (a week label, a key) and free text (a story's summary, a holiday's name) are labels, not figures
function isLabelCell(t, r, c) {
  const i = r.cells.indexOf(c);
  if (i === 0) return true;
  if (t.id === 'tasks' && (i === 1 || i === 2 || i === 4)) return true;
  if (t.id === 'absences' && i !== 2) return true;
  if (t.id === 'absences' && r.cells[0]?.text && !c.proof && /[A-Za-zÄÖÜäöü]{4,}/.test(c.text) && !/\d+ (Arbeitstag|working day)/.test(c.text)) return true;
  if (t.id === 'overdue' && i <= 4 && !(t.columns.length === 5 && i === 4 && /^\d+$/.test(c.text))) return true;
  if (t.id === 'planActual' && i === 0) return true;
  if (t.id === 'sla' && (i === 1 || i === 2)) return true;
  return false;
}

// ---------- texts ----------
function pctText(L, v) { return v == null ? '–' : L === 'en' ? `${v}%` : `${v} %`; }
function unitText(F, L, v, u) { return u === 'h' ? F.h(v, 1) : u === '%' ? pctText(L, v) : u === 'd' ? `${F.n(v)} ${T(L, 'Tage', 'days')}` : F.n(v); }
function typeName(L, t) { return { vacation: T(L, 'Urlaub', 'Vacation'), training: T(L, 'Schulung', 'Training') }[t] || T(L, 'Abwesend', 'Away'); }
function storyVisual(ctx, job, e) {
  // the section's chart is the story card's chart (stories.js) – the same picture on screen and on paper
  return memoVisual(ctx, job, e);
}
function memoVisual(ctx, job, e) { try { return subjectStory(ctx, job, e).visual; } catch { return null; } }

function recipientName(subject, d) {
  if (subject.kind === 'team') return d.leads?.length ? d.leads.map((x) => x.name).join(', ') : null;
  if (subject.kind === 'project') return d.owner?.name || null;
  return subject.name;
}
function greetingOf(L, job, subject, d) {
  const who = recipientName(subject, d);
  const friendly = job.tone !== 'formal';
  if (!who) return T(L, `Hallo Team ${subject.name},`, `Hello team ${subject.name},`);
  if (subject.kind === 'person') return friendly ? T(L, `Hallo ${firstName(who)},`, `Hi ${firstName(who)},`) : T(L, `Guten Tag ${who},`, `Dear ${who},`);
  return friendly ? T(L, `Hallo ${who},`, `Hi ${who},`) : T(L, `Guten Tag ${who},`, `Dear ${who},`);
}
function messageOf(L, job, subject, d, findings, suggestions, me, F) {
  const friendly = job.tone !== 'formal';
  const who = recipientName(subject, d);
  const greeting = greetingOf(L, job, subject, d);
  const period = job.window.label[L === 'en' ? 1 : 0];
  const about = subject.kind === 'person'
    ? (friendly ? T(L, `ich habe mir deine Arbeitswochen ${scopeName(L, job)} angesehen (${period}).`, `I had a look at your work weeks ${scopeName(L, job)} (${period}).`) : T(L, `anbei Ihre Übersicht ${scopeName(L, job)} für ${period}.`, `please find your overview ${scopeName(L, job)} for ${period}.`))
    : subject.kind === 'team'
      ? (friendly ? T(L, `hier die Lage von Team ${subject.name} für ${period}.`, `here is where team ${subject.name} stands for ${period}.`) : T(L, `anbei die Übersicht für Team ${subject.name} für ${period}.`, `please find the overview of team ${subject.name} for ${period}.`))
      : (friendly ? T(L, `hier die Lage von ${subject.name}.`, `here is where ${subject.name} stands.`) : T(L, `anbei die Übersicht zu ${subject.name}.`, `please find the overview of ${subject.name}.`));
  const lines = [greeting, ''];
  if (job.intro) lines.push(job.intro, '');
  lines.push(about.replace(/\s{2,}/g, ' ').replace(/ \./g, '.').replace(/ \(/g, ' ('));
  lines.push('', friendly ? T(L, 'Das Wichtigste:', 'The main points:') : T(L, 'Die wichtigsten Punkte:', 'The key points:'));
  for (const f of findings.slice(0, 4)) lines.push(`– ${f.text}`);
  if (suggestions.length) {
    lines.push('', friendly ? T(L, 'Vorschläge:', 'Suggestions:') : T(L, 'Empfehlungen:', 'Recommendations:'));
    for (const s of suggestions.slice(0, 3)) lines.push(`– ${s.text}${s.ask ? T(L, ` (Lotse: „${s.ask}“)`, ` (Lotse: "${s.ask}")`) : ''}`);
  }
  lines.push('', job.format === 'text'
    ? (friendly ? T(L, 'Sag Bescheid, wenn etwas nicht stimmt – die Zahlen kommen direkt aus Jira und dem Cockpit.', 'Let me know if anything looks off – the numbers come straight from Jira and the cockpit.') : T(L, 'Die Zahlen stammen direkt aus Jira und dem Portfolio Cockpit.', 'The numbers come straight from Jira and the Portfolio Cockpit.'))
    : (friendly ? T(L, 'Die Details und die Quellen jeder Zahl stehen in deinem Abschnitt im PDF. Sag Bescheid, wenn etwas nicht stimmt.', 'The details and the source of every number are in your section of the PDF. Let me know if anything looks off.') : T(L, 'Details und Quellen jeder Zahl finden Sie in Ihrem Abschnitt im PDF.', 'You will find the details and the source of every number in your section of the PDF.')));
  lines.push('', friendly ? T(L, 'Viele Grüße', 'Best') : T(L, 'Freundliche Grüße', 'Kind regards'));
  if (me) lines.push(me);
  const subjectLine = subject.kind === 'person' ? T(L, `Deine Arbeitswochen: ${period}`, `Your work weeks: ${period}`) : T(L, `${subject.name}: ${period}`, `${subject.name}: ${period}`);
  void F;
  return { to: who || subject.name, subject: friendly || subject.kind !== 'person' ? subjectLine : T(L, `Ihre Arbeitswochen: ${period}`, `Your work weeks: ${period}`), text: lines.join('\n').replace(/\n{3,}/g, '\n\n') };
}
void computedOf;
