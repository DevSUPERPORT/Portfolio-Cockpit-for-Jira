// Lotse orchestration – the workflow "Auftrag ausführen" / "Run a job": a free-form request becomes a plan the person
// sees and adjusts, then real work per subject, then the artifacts.
//
//   understand  parseJob(sentence) → scope, subjects, blocks, window, format, audience, tone (parse.js)
//   decide      the scope when it is missing or ambiguous (presets + free text)
//   story       the plan: steps, data, recipients (a visual of who is in it)
//   decide      blocks (multi) · recipients (multi + free text) · period (presets + free text) · format · tone
//   stories     one card per recipient (the section of the PDF, same sentences) + the overview
//   decide      optional sending (off by default; only Jira's booking reminder exists – never a free text)
//   preview     the document (sections, figures, proof) – and every reminder recipient, when chosen
//   command     doc.pdf (no write: the app renders and downloads the PDF) · notice.remind only when chosen
//   summary     the result card: download again, personal texts to copy, the proof
// Same goal + data + answers = same steps. Nothing is sent and nothing is written without its preview.
import { T, plural, fact, can, computedOf, dsOf, meId, langOf } from '../kit.js';
import { capacityPeople } from '../../../engine.js';
import { fold, findProject, findTeam } from '../../../ask.js';
import { parseJob, parseWindow, jobText, BLOCKS, BLOCKS_FOR, BLOCK_NAMES, DEFAULT_BLOCKS, winLabel, MAX_WEEKS } from './parse.js';
import { subjectsOf, runJob, jobWeeks, weekLabel, inScope } from './data.js';
import { planStory, subjectStory, overviewStory, subjectWord, formatText } from './stories.js';
import { buildJobDoc } from '../../report/jobDoc.js';
import { infoStory, sum } from '../../kit.js';

const optOf = (a) => (typeof a === 'string' ? a : a?.option ?? null);
const valueOf = (a) => (a && typeof a === 'object' && !Array.isArray(a) ? a.value ?? null : null);
const h0 = (v) => Math.round(v || 0);

// ---------- scope ----------
function scopeOptions(ctx, job) {
  const L = langOf(ctx);
  const c = computedOf(ctx);
  const { model } = c;
  const ds = dsOf(ctx);
  const out = [];
  for (const a of job.ambiguous || []) for (const o of a.options || []) out.push({ id: `${o.kind}:${o.ref}`, label: o.name, detail: T(L, 'im Satz genannt', 'named in the sentence') });
  const me = meId(ctx);
  const cap = ds.capacity || {};
  const mine = Object.entries(cap.teams || {}).find(([, t]) => (t?.responsible || []).includes(me))?.[0] || cap.people?.[me]?.teamId || null;
  if (mine && model.teams.has(mine)) out.push({ id: `myTeam:${mine}`, label: T(L, `Mein Team (${model.teams.get(mine).name})`, `My team (${model.teams.get(mine).name})`), detail: T(L, 'jede Person einzeln', 'each person on their own') });
  const open = model.items.filter((it) => !c.metrics.get(it.ref)?.done).slice(0, 4);
  for (const it of open) out.push({ id: `project:${it.ref}`, label: it.name, detail: T(L, 'die Leute im Projekt', 'the people on the project') });
  out.push({ id: 'portfolio:teams', label: T(L, 'Jedes Team im Portfolio', 'Every team in the portfolio'), detail: T(L, 'ein Abschnitt je Team, für die Teamleitungen', 'one section per team, for the team leads') });
  out.push({ id: 'portfolio:projects', label: T(L, 'Jedes Projekt im Portfolio', 'Every project in the portfolio'), detail: T(L, 'ein Abschnitt je Projekt, für die Owner', 'one section per project, for the owners') });
  const seen = new Set();
  return out.filter((o) => (seen.has(o.id) ? false : seen.add(o.id))).slice(0, 9).map((o, k) => ({ ...o, recommended: k === 0 }));
}
function scopeOfOption(ctx, id) {
  const { model } = computedOf(ctx);
  const ds = dsOf(ctx);
  const [kind, ...rest] = String(id || '').split(':');
  const ref = rest.join(':');
  if (kind === 'project' && model.itemByRef.has(ref)) return { scope: { kind: 'project', ref, name: model.itemByRef.get(ref).name }, subjects: 'people' };
  if ((kind === 'team' || kind === 'myTeam') && model.teams.has(ref)) return { scope: { kind, ref, name: model.teams.get(ref).name }, subjects: 'people' };
  if (kind === 'person' && ds.people?.[ref]) return { scope: { kind: 'person', ref, name: ds.people[ref].name }, subjects: 'person' };
  if (kind === 'portfolio') return { scope: { kind: 'portfolio', ref: null, name: 'Portfolio' }, subjects: ['teams', 'projects', 'people'].includes(ref) ? ref : 'teams' };
  return null;
}
// free text of the scope question: "Projekt ERP-Anbindung", "Team Web", "Lea Hoffmann", "alle Teams" → { scope, subjects } | null
export function scopeFromText(text, ctx) {
  const j = parseJob(text, ctx);
  if (j.scope) return { scope: j.scope, subjects: j.subjects };
  const q = jobText(text);
  const { model } = computedOf(ctx);
  const p = findProject(q, model);
  if (p) return { scope: { kind: 'project', ref: p.ref, name: p.name }, subjects: 'people' };
  const t = findTeam(q, model);
  if (t) return { scope: { kind: 'team', ref: t.id, name: t.name }, subjects: 'people' };
  return null;
}
// free text of the recipients question: "Anna, Jonas und Lea" → ids among the offered ones
export function peopleFromText(text, ctx, within) {
  const q = jobText(text);
  const ds = dsOf(ctx);
  const { model } = computedOf(ctx);
  const ids = [];
  for (const id of within || []) {
    const name = ds.people?.[id]?.name || model.teams.get(id)?.name || model.itemByRef.get(id)?.name || '';
    const n = fold(name), first = n.split(' ')[0];
    const re = (w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
    if (n && (re(n).test(q) || (first.length >= 3 && re(first).test(q)))) ids.push(id);
  }
  return ids;
}
export function windowFromText(text, ctx) {
  const q = jobText(text);
  if (!/\d|woche|week|quartal|quarter|monat|month/.test(q)) return null;
  const w = parseWindow(q, computedOf(ctx).model.today, {});
  return w.stated ? w : null;
}

function withSubjects(job, subjects) {
  if (job.subjects === subjects) return job;
  const keep = job.blocks.filter((b) => BLOCKS_FOR[subjects].includes(b));
  return { ...job, subjects, blocks: keep.length ? keep : [...DEFAULT_BLOCKS[subjects], ...(BLOCKS_FOR[subjects].includes('risks') && !DEFAULT_BLOCKS[subjects].includes('risks') ? ['risks'] : [])], audience: job.said?.audience ? job.audience : subjects === 'teams' ? 'teamLeads' : subjects === 'projects' ? 'owners' : 'colleagues' };
}
const NOTE = { scope: ['Rahmen', 'scope'] };

export function orchestrateMissions() {
  const orchestrate = {
    id: 'orchestrate', title: (L) => T(L, 'Auftrag ausführen', 'Run a job'), params: ['text'],
    // the orchestrator is routed by jobScore (route.js) – these catch the explicit ways to ask for it
    match: [/\b(auftrag|job) (ausfuehren|erledigen|starten|run)\b|\brun a job\b|\borchestrier\w*|\borchestrat\w*/],
    plan(P, { text = '', job: preset = null }) {
      const { ctx } = P;
      const L = P.L;
      let job = preset && typeof preset === 'object' ? { ...parseJob('', ctx), ...preset, said: { ...(preset.said || {}) } } : parseJob(text, ctx);
      // ---- the scope: asked when the sentence does not name one (or names two) ----
      const amb = (job.ambiguous || []).some((a) => a.part === 'scope');
      if (!job.scope || amb) {
        const a = P.decide('scope', {
          question: amb ? P.t('Der Satz nennt mehr als einen Rahmen – für wen soll Lotse den Auftrag ausführen?', 'The sentence names more than one scope – who should Lotse run the job for?') : P.t('Für wen soll Lotse den Auftrag ausführen?', 'Who should Lotse run the job for?'),
          options: scopeOptions(ctx, job),
          freeText: { kind: 'scope', placeholder: P.t('z. B. Projekt ERP-Anbindung, Team Web oder Lea Hoffmann', 'e.g. project ERP-Anbindung, team Web or Lea Hoffmann'), optional: true },
        });
        if (a === undefined) return;
        const picked = valueOf(a) || scopeOfOption(ctx, optOf(a));
        if (!picked) { P.summary(P.t('Diesen Rahmen kennt Lotse nicht – nichts zu tun.', 'Lotse does not know this scope – nothing to do.')); return; }
        job = withSubjects({ ...job, scope: picked.scope, said: { ...job.said, scope: true } }, picked.subjects);
      }
      const all = subjectsOf(ctx, job);
      if (!all.length) {
        P.storyObj('story:empty', infoStory(ctx, { skill: 'orchestrate', lang: L, subject: { kind: job.scope.kind === 'myTeam' ? 'team' : job.scope.kind, ref: job.scope.ref, name: job.scope.name }, headline: P.t(`In ${job.scope.name} hat gerade niemand offene oder geplante Arbeit – Lotse hat nichts zu berichten.`, `Nobody has open or planned work in ${job.scope.name} right now – Lotse has nothing to report.`), finding: P.t('Personen kommen in den Auftrag, sobald ihnen Stories in diesem Rahmen zugewiesen sind oder sie dort gebucht haben.', 'People join the job as soon as stories in this scope are assigned to them or they booked time there.') }));
        P.summary(P.t('Kein Dokument – es gibt niemanden mit Arbeit in diesem Rahmen.', 'No document – nobody has work in this scope.'));
        return;
      }
      // ---- the plan ----
      const c = computedOf(ctx);
      const inS = inScope(job);
      const openItems = (dsOf(ctx).issues || []).filter((s) => s.role === 'estimate' && (s.status?.cat ?? 'new') !== 'done' && inS(s) && (job.subjects !== 'person' || s.assignee?.id === job.scope.ref)).length;
      const hours = {};
      if (job.subjects === 'projects') for (const x of all) hours[x.id] = c.metrics.get(x.id)?.RE || 0;
      else for (const x of all) hours[x.id] = Math.max(0, x.weight || 0);
      P.storyObj('story:plan', planStory(ctx, job, all, { counts: { items: openItems, hours } }));
      P.steps.at(-1).plan = pipelineOf(L, job, all.length);
      // ---- what goes in ----
      const allowed = BLOCKS_FOR[job.subjects];
      const paReady = ctx.planActual?.state === 'ready';
      const b = P.decide('blocks', {
        question: P.t('Was soll in jeden Abschnitt?', 'What goes into each section?'), multi: true,
        options: allowed.map((id) => ({
          id, label: BLOCK_NAMES[id][L === 'en' ? 1 : 0], recommended: job.blocks.includes(id) && !(id === 'planActual' && !paReady),
          detail: id === 'planActual' && !paReady ? P.t('Noch keine abgeschlossene Plan-vs-Ist-Woche geladen', 'No completed plan-vs-actual week loaded yet')
            : (job.added || []).includes(id) && id !== 'risks' ? P.t('von Lotse ergänzt – gehört zu einer Arbeitswoche', 'added by Lotse – part of a work week')
              : job.said?.blocks && job.blocks.includes(id) ? P.t('aus deinem Satz', 'from your sentence') : job.blocks.includes(id) ? P.t('empfohlen', 'recommended') : BLOCK_HINT[id][L === 'en' ? 1 : 0],
          disabled: id === 'planActual' && !paReady,
        })),
      });
      if (b === undefined) return;
      job = { ...job, blocks: BLOCKS.filter((x) => [].concat(b).includes(x)) };
      // ---- who ----
      if (all.length > 1) {
        const pre = job.people ? new Set(job.people) : null;
        const w = P.decide('people', {
          question: P.t(`Für wen? ${all.length} ${subjectWord(L, job.subjects, all.length)} ${job.scope.kind === 'portfolio' ? 'im Portfolio' : `in ${job.scope.name}`}.`, `For whom? ${all.length} ${subjectWord(L, job.subjects, all.length)} ${job.scope.kind === 'portfolio' ? 'in the portfolio' : `in ${job.scope.name}`}.`),
          facts: [fact('n', all.length)], multi: true,
          options: all.map((x, k) => ({ id: x.id, label: x.name, detail: x.kind === 'person' ? (x.weight >= 0.5 ? P.t(`${h0(x.weight)} h geplant in ${job.window.next || 0} Wochen`, `${h0(x.weight)} h planned in ${job.window.next || 0} weeks`) : P.t('in diesen Wochen nichts eingeplant', 'nothing planned in these weeks')) : undefined,
            facts: x.kind === 'person' ? [fact('h', h0(x.weight)), fact('weeks', job.window.next || 0)] : [], recommended: pre ? pre.has(x.id) : all.length <= 16 || k < 12 })),
          freeText: { kind: 'people', placeholder: P.t('oder Namen, z. B. Anna, Jonas', 'or names, e.g. Anna, Jonas'), optional: true, within: all.map((x) => x.id) },
        });
        if (w === undefined) return;
        const ids = Array.isArray(w) ? w : valueOf(w) || [];
        job = { ...job, people: ids.length ? ids : all.map((x) => x.id) };
      } else job = { ...job, people: all.map((x) => x.id) };
      // ---- when ----
      const needPast = job.blocks.includes('bookings') || job.blocks.includes('planActual');
      const pres = [];
      if (job.said?.window) pres.push({ id: 'said', past: job.window.past, next: job.window.next, label: job.window.label, said: true });
      pres.push({ id: 'p4n8', past: 4, next: 8 }, { id: 'n8', past: 0, next: 8 }, { id: 'n4', past: 0, next: 4 }, { id: 'p4', past: 4, next: 0 }, { id: 'n12', past: 0, next: 12 });
      const seenW = new Set();
      const winOpts = pres.filter((x) => (seenW.has(`${x.past}:${x.next}`) ? false : seenW.add(`${x.past}:${x.next}`))).slice(0, 5);
      const recW = job.said?.window ? 'said' : winOpts.find((x) => x.past === job.window.past && x.next === job.window.next)?.id || (needPast ? 'p4n8' : 'n8');
      const ww = P.decide('window', {
        question: P.t('Welcher Zeitraum?', 'Which period?'),
        options: winOpts.map((x) => {
          const lb = x.label || winLabel(x.past, x.next);
          return { id: x.id, label: cap1(lb[L === 'en' ? 1 : 0]), detail: x.said ? P.t('wie im Satz', 'as in the sentence') : needPast && !x.past ? P.t('ohne vergangene Wochen – keine Buchungen', 'no past weeks – no bookings') : x.past ? P.t('vergangene Wochen mit Buchungen', 'past weeks with bookings') : undefined, facts: [fact('past', x.past), fact('next', x.next)], recommended: x.id === recW };
        }),
        freeText: { kind: 'window', placeholder: P.t('z. B. die nächsten 6 Wochen', 'e.g. the next 6 weeks'), optional: true },
      });
      if (ww === undefined) return;
      const wv = valueOf(ww) || winOpts.find((x) => x.id === optOf(ww));
      job = { ...job, window: { past: Math.min(MAX_WEEKS, wv.past), next: Math.min(MAX_WEEKS, wv.next), label: wv.label || winLabel(wv.past, wv.next), stated: true } };
      // ---- what comes out ----
      const n = job.people.length;
      const f = P.decide('format', {
        question: P.t('Was soll Lotse daraus machen?', 'What should Lotse make of it?'),
        options: [
          { id: 'pdfAll', label: P.t('Ein PDF mit persönlichem Teil je Empfänger', 'One PDF with a personal part per recipient'), detail: P.t(`Deckblatt, Überblick, ${n} ${plural(n, 'Abschnitt', 'Abschnitte')}, Nachweis – dazu die persönlichen Texte`, `cover, overview, ${n} ${plural(n, 'section', 'sections')}, proof – plus the personal texts`), facts: [fact('n', n)], recommended: job.format === 'pdfAll' || (job.format === 'pdfEach' && n < 2) },
          { id: 'pdfEach', label: P.t('Zusätzlich ein eigenes PDF je Empfänger', 'Plus an own PDF per recipient'), detail: P.t(`zum Weitergeben: ${n} einzelne PDFs mit nur dem eigenen Teil`, `to pass on: ${n} separate PDFs with only their own part`), facts: [fact('n', n)], recommended: job.format === 'pdfEach' && n >= 2, disabled: n < 2 },
          { id: 'text', label: P.t('Nur Text', 'Text only'), detail: P.t('persönliche Nachrichten zum Kopieren, kein PDF', 'personal messages to copy, no PDF'), recommended: job.format === 'text' },
        ],
      });
      if (f === undefined) return;
      job = { ...job, format: optOf(f) };
      const meName = ctx.me?.name || dsOf(ctx).people?.[meId(ctx)]?.name || null;
      const tn = P.decide('tone', {
        question: job.audience === 'colleagues' ? P.t('Wie soll Lotse die Kolleginnen und Kollegen ansprechen?', 'How should Lotse address the colleagues?') : P.t('Wie soll Lotse die Empfänger ansprechen?', 'How should Lotse address the recipients?'),
        options: [
          { id: 'friendly', label: P.t('Persönlich und freundlich (Du)', 'Personal and friendly'), detail: P.t('„Hallo Anna, ich habe mir deine Wochen angesehen …“', '"Hi Anna, I had a look at your weeks …"'), recommended: job.tone === 'friendly' },
          { id: 'formal', label: P.t('Sachlich (Sie)', 'Formal'), detail: P.t('„Guten Tag Anna Becker, anbei Ihre Übersicht …“', '"Dear Anna Becker, please find your overview …"'), recommended: job.tone === 'formal' },
        ],
        freeText: { kind: 'text', placeholder: P.t('eigener erster Satz (optional)', 'own opening sentence (optional)'), min: 1, max: 280, optional: true },
        ...(meName ? { note: P.t(`Unterschrift: ${meName}`, `Signed: ${meName}`) } : {}),
      });
      if (tn === undefined) return;
      job = { ...job, tone: optOf(tn) || job.tone, ...(tn && typeof tn === 'object' && tn.text ? { intro: tn.text.slice(0, 280) } : {}) };
      // ---- the work: one card per recipient, then the overview ----
      const run = runJob(ctx, job);
      for (const e of run.subjects) {
        P.storyObj(`story:s:${e.subject.id}`, subjectStory(ctx, job, e));
        Object.assign(P.steps.at(-1), { group: 'sections', subjectId: e.subject.id, suggestions: e.findings.filter((x) => x.suggest).slice(0, 3).map((x) => x.suggest.text) });
      }
      P.storyObj('story:overview', overviewStory(ctx, job, run));
      // ---- sending: off by default, only what Jira can send (the booking reminder), every recipient in the preview ----
      const cmds = [];
      const below = job.subjects !== 'people' || !job.blocks.includes('bookings') ? [] : run.subjects.filter((e) => e.data.weeks.some((w) => w.past && w.possible > 0 && (w.bookPct ?? 0) < w.minPct)).map((e) => e.subject.id);
      if (below.length && can.remind(ctx)) {
        const on = dsOf(ctx).config?.notices?.enabled === true;
        const sd = P.decide('send', {
          question: P.t(`${below.length} ${plural(below.length, 'Person liegt', 'Personen liegen')} unter dem Buchungsziel – soll Jira sie erinnern?`, `${below.length} ${plural(below.length, 'person is', 'people are')} below the booking target – should Jira remind them?`), facts: [fact('n', below.length)],
          options: [
            { id: 'none', label: P.t('Nichts senden – ich verteile selbst', 'Send nothing – I hand it out myself'), detail: P.t('Lotse sendet nie von selbst', 'Lotse never sends on its own'), recommended: true },
            { id: 'remind', label: P.t('Jira-Erinnerung an fehlende Buchungen', 'Jira reminder about missing bookings'), detail: on ? P.t(`an ${below.length} ${plural(below.length, 'Person', 'Personen')} – die Standard-Erinnerung, nicht der persönliche Text; jede Person steht in der Vorschau`, `to ${below.length} ${plural(below.length, 'person', 'people')} – the standard reminder, not the personal text; every person is in the preview`) : P.t('Erinnerungen sind in der Konfiguration ausgeschaltet.', 'Reminders are switched off in the configuration.'), facts: [fact('n', below.length)], disabled: !on },
          ],
        });
        if (sd === undefined) return;
        if (optOf(sd) === 'remind' && on) cmds.push({ id: 'cmd:remind', command: 'notice.remind', params: { kind: 'booking', people: below }, title: P.t('Erinnerung an fehlende Buchungen', 'Reminder about missing bookings') });
      }
      const clean = { ...job, ambiguous: [], added: [] };
      if (job.format !== 'text') cmds.unshift({ id: 'cmd:pdf', command: 'doc.pdf', params: { job: clean }, title: job.format === 'pdfEach' ? P.t('PDFs erstellen', 'Create the PDFs') : P.t('PDF erstellen', 'Create the PDF') });
      if (cmds.length) {
        P.batch('preview', cmds);
        const pv = P.steps.find((x) => x.id === 'preview');
        if (pv) {
          const doc = buildJobDoc(ctx, clean);
          const nSec = doc.sections.length, nFig = doc.proof.length;
          pv.title = job.format === 'text' ? P.t('Vorschau – noch ist nichts gesendet', 'Preview – nothing is sent yet') : P.t('Vorschau – so wird das Dokument', 'Preview – this is the document');
          pv.summary = job.format === 'text' ? pv.summary : P.t(`${doc.title}: Überblick, ${nSec} ${plural(nSec, 'persönlicher Abschnitt', 'persönliche Abschnitte')} und Nachweis mit ${nFig} belegten Zahlen – nichts wird gesendet.`, `${doc.title}: overview, ${nSec} personal ${plural(nSec, 'section', 'sections')} and a proof with ${nFig} sourced figures – nothing is sent.`);
          pv.facts = [...(pv.facts || []), fact('sections', nSec), fact('figures', nFig)];
          pv.outline = { title: doc.title, subtitle: doc.subtitle, sections: doc.sections.map((s) => ({ id: s.id, heading: s.heading, tone: s.tone, findings: s.findings.length })), figures: nFig, format: job.format };
          pv.options = pv.options.map((o) => (o.id === 'apply' ? { ...o, label: cmds.some((x) => x.command === 'notice.remind') ? P.t('Erstellen und erinnern', 'Create and remind') : job.format === 'pdfEach' ? P.t('PDFs erstellen', 'Create the PDFs') : P.t('PDF erstellen', 'Create the PDF') } : { ...o, label: P.t('Nicht erstellen', 'Do not create') }));
        }
      }
      P.summary(job.format === 'text' ? P.t(`${run.subjects.length} persönliche ${plural(run.subjects.length, 'Nachricht ist', 'Nachrichten sind')} fertig – zum Kopieren; Lotse sendet nichts.`, `${run.subjects.length} personal ${plural(run.subjects.length, 'message is', 'messages are')} ready – to copy; Lotse sends nothing.`) : null);
      P.steps.at(-1).job = clean;
    },
  };
  return [orchestrate];
}
const cap1 = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const BLOCK_HINT = {
  weeks: ['geplant, verfügbar und Auslastung je Woche', 'planned, available and load per week'], bookings: ['gebucht gegen das Buchungsziel', 'booked against the booking target'],
  tasks: ['offene Stories mit Fenster und Rest', 'open stories with window and remaining'], overdue: ['überfällige und blockierte Stories', 'overdue and blocked stories'],
  absences: ['Urlaub, Abwesenheit, Feiertage', 'vacation, absence, public holidays'], risks: ['was auffällt, mit Vorschlag', 'what stands out, with a suggestion'],
  progress: ['Fortschritt und Termin', 'progress and due date'], planActual: ['aus den Plan-vs-Ist-Wochen', 'from the plan-vs-actual weeks'], support: ['Support-Buchungen und Reserve', 'support bookings and reserve'],
};
// the steps Lotse will take, for the plan visual (UI) – words only, every number is in the plan story
function pipelineOf(L, job, n) {
  const T2 = (de, en) => T(L, de, en);
  return {
    steps: [
      { id: 'understand', icon: 'target', title: T2('Auftrag verstehen', 'Understand the job'), detail: T2('Rahmen, Empfänger, Zeitraum, Bausteine, Format', 'scope, recipients, period, blocks, format') },
      { id: 'collect', icon: 'layers', title: T2('Daten sammeln', 'Collect the data'), detail: job.blocks.map((b) => BLOCK_NAMES[b][L === 'en' ? 1 : 0]).join(' · ') },
      { id: 'analyse', icon: 'zap', title: T2('Je Empfänger prüfen', 'Check each recipient'), detail: T2('Risiken finden, Vorschläge ableiten', 'find risks, derive suggestions') },
      { id: 'compose', icon: 'report', title: T2('Dokument setzen', 'Compose the document'), detail: formatText(L, job, n) },
      { id: 'proof', icon: 'check', title: T2('Jede Zahl belegen', 'Prove every number'), detail: T2('Formel, Eingaben und Jira-Keys im Nachweis', 'formula, inputs and Jira keys in the proof') },
    ],
    sources: [T2('Jira-Stories', 'Jira stories'), T2('Kapazitäten', 'Capacity'), ...(job.blocks.includes('bookings') || job.blocks.includes('support') ? [T2('Worklogs', 'Worklogs')] : []), ...(job.blocks.includes('absences') ? [T2('Abwesenheiten, Feiertage', 'Absences, holidays')] : []), ...(job.blocks.includes('planActual') ? [T2('Plan-vs-Ist-Wochen', 'Plan-vs-actual weeks')] : [])],
    note: NOTE.scope && null,
  };
}
void capacityPeople; void sum; void jobWeeks; void weekLabel;
