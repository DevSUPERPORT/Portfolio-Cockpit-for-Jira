// Golden set for Lotse: real-world questions and tasks in German and English, by persona (management, project lead,
// team lead, employee, support), with the EXPECTED skill / parameters and the EXPECTED key facts. The facts come from
// tests/golden/expect.js – computed from the dataset and the engine primitives, never from a Lotse skill – so the golden
// test is a real cross-check. Follow-ups carry `prev` (questions asked before, their answer becomes the memory).
//
// entry = { id, persona, lang, q, prev?: string[], skill: id | id[] (accepted) | null (unknown → help) | 'guard',
//           params?: {subset}, facts?: Fact[] | { [skill]: Fact[] }, tags?: string[] }
// Fact  = { label, num, tol? }  → the number appears among the story's verifiable numbers (kpis, evidence, visual)
//       | { label, names: [] }  → every name appears in the story (headline, findings, visual labels, entities)
import { scenario, missingIn } from './expect.js';

const N = (label, num, tol) => ({ label, num, ...(tol != null ? { tol } : {}) });
const NAMES = (label, names) => ({ label, names });
const qShort = (q) => q.replace(/^\d{4}-/, ''); // '2026-Q4' → 'Q4'

export function goldenQuestions(E) {
  const out = [];
  let n = 0;
  const add = (persona, lang, q, skill, extra = {}) => out.push({ id: `g${String(++n).padStart(3, '0')}`, persona, lang, q, skill, ...extra });
  const { q0, q1, projects, teams, byName } = E;
  const wl0 = E.waterlineQ(q0), wl1 = E.waterlineQ(q1);
  const lateNames = E.late.map((p) => p.name);
  const portfolioFacts = [N('aktive Projekte', E.active), N('Fortschritt gesamt %', E.portfolioProgressPct), ...(lateNames.length ? [NAMES('Projekte über Termin', lateNames)] : [])];
  const lateFacts = [N('Projekte über Termin', lateNames.length), ...(lateNames.length ? [NAMES('Projekte über Termin', lateNames)] : [])];
  const projectFacts = (p) => [N(`Fortschritt ${p.name} %`, p.progressPct), N(`Prognose ${p.name} h`, p.forecast, 1), ...(p.overdue ? [N(`Stories überfällig ${p.name}`, p.overdue)] : [])];
  const teamFacts = (t) => { const x = E.team(t.id); return [N(`Frei/Fehlt ${t.name} ${q0} h`, Math.abs(x.free), 0.6), N(`Personen ${t.name}`, x.members)]; };
  const wlFacts = (w) => [N(`erster Engpass ab Rang ${w.q}`, w.firstRank), N(`fehlende Stunden ${w.q}`, w.missing, 0.6), N(`Teams mit Engpass ${w.q}`, w.teamsShort)];

  // ================= management =================
  for (const q of ['Lagebild Portfolio', 'Wie steht das Portfolio?', 'Gib mir eine Zusammenfassung für die Geschäftsführung', 'Management-Zusammenfassung bitte', 'Wie läuft es insgesamt?',
    'Überblick über alle Projekte', 'Was muss der Vorstand diese Woche wissen?', 'Wie viele aktive Projekte haben wir?'])
    add('management', 'de', q, 'portfolioBrief', { facts: portfolioFacts });
  for (const q of ['Portfolio briefing', 'Give me the big picture for the board', 'Executive summary of all projects', 'How is the portfolio doing?', 'Status of all projects for the steering committee'])
    add('management', 'en', q, 'portfolioBrief', { facts: portfolioFacts });
  for (const q of ['Welche Projekte sind über dem Termin?', 'Welche Projekte sind im Verzug?', 'Wie viele Projekte sind überfällig?', 'Welche Projekte haben ihren Termin gerissen?'])
    add('management', 'de', q, 'portfolioBrief', { facts: lateFacts, tags: ['synonym'] });
  for (const q of ['Which projects are late?', 'Which projects are behind schedule?', 'How many projects are overdue?'])
    add('management', 'en', q, 'portfolioBrief', { facts: lateFacts, tags: ['synonym'] });
  add('management', 'de', 'Wie viele Teams sind über 100 % ausgelastet?', ['portfolioBrief', 'overtime', 'realCapacity'], { facts: { portfolioBrief: [N('Teams über 100 % (8 Wochen)', E.teamsOver100)], overtime: [N('Teams über 100 % (12 Wochen, realistisch)', E.overtime.teams)] } });
  add('management', 'en', 'How many teams are above 100 % load?', ['portfolioBrief', 'overtime', 'realCapacity'], { facts: { portfolioBrief: [N('teams above 100 % (8 weeks)', E.teamsOver100)], overtime: [N('teams above 100 % (12 weeks, realistic)', E.overtime.teams)] } });

  // ================= waterline =================
  for (const q of ['Ab welchem Rang reicht die Kapazität nicht?', 'Wo ist die Wasserlinie?', 'Wasserlinie', 'Bis zu welchem Rang können wir alles besetzen?', 'Ab welchem Projekt fehlen uns Leute?',
    'Welche Projekte können wir in diesem Quartal nicht besetzen?'])
    add('management', 'de', q, 'waterline', { facts: wlFacts(wl0) });
  for (const q of ['From which rank does capacity run out?', 'Where is the waterline?', 'Which projects can we not staff this quarter?'])
    add('management', 'en', q, 'waterline', { facts: wlFacts(wl0) });
  add('management', 'de', `Wasserlinie ${qShort(q1)} ${q1.slice(0, 4)}`, 'waterline', { params: { quarter: q1 }, facts: wlFacts(wl1) });
  add('management', 'en', `Waterline for ${qShort(q1)} ${q1.slice(0, 4)}`, 'waterline', { params: { quarter: q1 }, facts: wlFacts(wl1) });
  add('management', 'de', 'Ab welchem Rang reicht die Kapazität im nächsten Quartal nicht?', 'waterline', { params: { quarter: q1 }, facts: wlFacts(wl1) });

  // hours missing per team in the current quarter
  for (const t of teams) {
    const x = E.team(t.id);
    const f = [N(`${t.name} ${q0}: Kapazität minus Bedarf (Betrag)`, Math.abs(x.free), 0.6)];
    add('teamLead', 'de', `Wie viele Stunden fehlen Team ${t.name} in ${qShort(q0)}?`, ['teamBrief', 'waterline'], { params: { team: t.id }, facts: f });
    add('teamLead', 'en', `How many hours is team ${t.name} short in ${qShort(q0)}?`, ['teamBrief', 'waterline'], { params: { team: t.id }, facts: f });
  }

  // ================= project lead =================
  const PDE = ['Wie steht es um {P}?', 'Lagebild {P}', 'Was ist bei {P} los?', 'Wie weit ist {P}?', 'Status von {P}'];
  const PEN = ['How is {P} doing?', 'Briefing {P}'];
  // 'on track?' is answered by the briefing or by the health draft (which proposes onTrack / atRisk / critical)
  const PTRACK = [['de', 'Ist {P} im Plan?'], ['en', 'Is {P} on track?']];
  for (const p of projects) {
    for (const t of PDE) add('projectLead', 'de', t.replace('{P}', p.name), 'projectBrief', { params: { ref: p.ref }, facts: projectFacts(p) });
    for (const t of PEN) add('projectLead', 'en', t.replace('{P}', p.name), 'projectBrief', { params: { ref: p.ref }, facts: projectFacts(p) });
    for (const [lang, t] of PTRACK) add('projectLead', lang, t.replace('{P}', p.name), ['projectBrief', 'healthDraft'], { params: { ref: p.ref }, facts: { projectBrief: projectFacts(p), healthDraft: [N(`Fortschritt ${p.name} %`, p.progressPct)] } });
    const bf = [N(`blockiert in ${p.name}`, p.blocked), N(`Terminkonflikte ${p.name}`, p.conflicts)];
    add('projectLead', 'de', `Was blockiert ${p.name}?`, 'blockers', { params: { ref: p.ref }, facts: bf });
    add('projectLead', 'en', `What is blocked in ${p.name}?`, 'blockers', { params: { ref: p.ref }, facts: bf });
    add('projectLead', 'de', `Health-Entwurf für ${p.name}`, 'healthDraft', { params: { ref: p.ref }, facts: [N(`Fortschritt ${p.name} %`, p.progressPct)] });
    add('projectLead', 'en', `Draft a status update for ${p.name}`, 'healthDraft', { params: { ref: p.ref }, facts: [N(`progress ${p.name} %`, p.progressPct)] });
    add('projectLead', 'de', `Datenlücken in ${p.name}`, 'gapsFix', { params: { ref: p.ref }, facts: [N(`Datenlücken ${p.name}`, p.gaps)] });
    add('projectLead', 'en', `Which values are missing in ${p.name}?`, 'gapsFix', { params: { ref: p.ref }, facts: [N(`data gaps ${p.name}`, p.gaps)] });
    add('projectLead', 'de', `Was wäre wenn ${p.name} 2 Wochen später fertig wird?`, 'whatIf', { params: { change: { kind: 'due', ref: p.ref, weeks: 2 } }, tags: ['whatif'] });
  }
  // what if: a project to the top – before/after from the engine re-run on the changed ranking
  for (const p of projects.filter((x) => x.rank > 1)) {
    const after = scenario(E.ds, { kind: 'rank', ref: p.ref, toRank: 1 });
    const f = [N(`nicht voll besetzbar ${q0} vorher`, E.notStaffed(E.c, q0)), N(`nicht voll besetzbar ${q0} nachher`, E.notStaffed(after, q0)), N(`Rang ${p.name} vorher`, p.rank)];
    add('projectLead', 'de', `Was wäre wenn ${p.name} auf Rang 1 rückt?`, 'whatIf', { params: { change: { kind: 'rank', ref: p.ref, toRank: 1 } }, facts: f, tags: ['whatif'] });
    add('projectLead', 'en', `What if ${p.name} moves to the top?`, 'whatIf', { params: { change: { kind: 'rank', ref: p.ref, toRank: 1 } }, facts: f, tags: ['whatif'] });
  }
  for (let i = 0; i + 1 < projects.length; i += 2) {
    const a = projects[i], b = projects[i + 1];
    const f = [N(`Fortschritt ${a.name} %`, a.progressPct), N(`Fortschritt ${b.name} %`, b.progressPct), NAMES('beide Projekte', [a.name, b.name])];
    add('projectLead', 'de', `Vergleiche ${a.name} mit ${b.name}`, 'compare', { params: { refs: [a.ref, b.ref] }, facts: f });
    add('projectLead', 'en', `Compare ${a.name} with ${b.name}`, 'compare', { params: { refs: [a.ref, b.ref] }, facts: f });
  }

  // ================= team lead =================
  for (const t of teams) {
    for (const q of [`Wie geht es Team ${t.name}?`, `Lagebild Team ${t.name}`, `Wie ausgelastet ist Team ${t.name}?`]) add('teamLead', 'de', q, 'teamBrief', { params: { team: t.id }, facts: teamFacts(t) });
    add('teamLead', 'en', `How is team ${t.name} doing?`, 'teamBrief', { params: { team: t.id }, facts: teamFacts(t) });
    const r = E.rcTeam(t.id);
    const of = r && r.totals.overtime > 0 ? [N(`Überstunden ${t.name} 12 Wochen h`, r.totals.overtime, 0.6)] : [];
    add('teamLead', 'de', `Überstunden Team ${t.name}`, 'overtime', { params: { team: t.id }, facts: of });
    add('teamLead', 'en', `Who is working too much in team ${t.name}?`, 'overtime', { params: { team: t.id }, facts: of });
    const rf = r ? [N(`verfügbar je Woche ${t.name}`, r.avg.nominal, 0.6), N(`Support P80 ${t.name}`, r.support.p80, 0.6), N(`Raum für Projekte ${t.name}`, r.avg.room, 0.6)] : [];
    add('teamLead', 'de', `Realistische Kapazität Team ${t.name}`, 'realCapacity', { params: { team: t.id }, facts: rf });
    add('teamLead', 'de', `Planungsvorschläge für Team ${t.name}`, 'planningAdvice', { params: { team: t.id } });
    const after = scenario(E.ds, { kind: 'teamHours', teamId: t.id, weekly: 40 });
    add('teamLead', 'de', `Was wäre wenn Team ${t.name} 40 h mehr hätte?`, 'whatIf', { params: { change: { kind: 'teamHours', teamId: t.id, weekly: 40 } }, tags: ['whatif'],
      facts: [N(`fehlende Stunden ${q0} vorher`, missingIn(E.c, q0), 0.6), N(`fehlende Stunden ${q0} nachher`, missingIn(after, q0), 0.6)] });
  }
  for (let i = 0; i + 1 < teams.length; i += 2) {
    const a = teams[i], b = teams[i + 1];
    const f = [N(`frei ${a.name}`, Math.abs(E.team(a.id).free), 0.6), N(`frei ${b.name}`, Math.abs(E.team(b.id).free), 0.6)];
    add('teamLead', 'de', `Vergleiche Team ${a.name} mit Team ${b.name}`, 'compare', { params: { teams: [a.id, b.id] }, facts: f });
    add('teamLead', 'en', `Compare team ${a.name} with team ${b.name}`, 'compare', { params: { teams: [a.id, b.id] }, facts: f });
  }

  // ================= employee (me = u1) =================
  const weekFacts = [N('diese Woche gebucht h', E.bookedThisWeek, 0.6)];
  for (const q of ['Meine Woche', 'Habe ich genug gebucht?', 'Wie viele Stunden habe ich diese Woche gebucht?', 'Was steht diese Woche für mich an?', 'Meine Aufgaben diese Woche', 'Fehlen mir noch Buchungen?'])
    add('employee', 'de', q, 'myWeek', { facts: weekFacts });
  for (const q of ['My week', 'Did I book enough hours?', 'What should I work on this week? My tasks', 'How many hours have I booked this week?'])
    add('employee', 'en', q, 'myWeek', { facts: weekFacts });
  add('employee', 'de', 'Was blockiert meine Aufgaben?', 'blockers', { params: { mine: true } });
  add('employee', 'en', 'What blocks my tasks?', 'blockers', { params: { mine: true } });
  for (const q of ['Was ist heute wichtig?', 'Was soll ich heute als Erstes tun?', 'Guten Morgen, worauf soll ich mich konzentrieren?']) add('employee', 'de', q, 'today');
  for (const q of ['What matters today?', 'Good morning – what should I focus on?']) add('employee', 'en', q, 'today');
  add('employee', 'de', 'Schätze wie früher: Export der Rechnungen als PDF', 'estimate', { params: { text: 'Export der Rechnungen als PDF' } });
  add('employee', 'de', 'Wie lange dauert eine REST-Schnittstelle für Aufträge?', 'estimate');
  add('employee', 'en', 'How long will "Login mit SSO" take?', 'estimate', { params: { text: 'Login mit SSO' } });
  add('employee', 'en', 'Estimate like before: push notifications for the app', 'estimate');
  add('employee', 'de', 'Was wäre wenn Anna 10 h mehr arbeitet?', 'whatIf', { params: { change: { kind: 'hours', personId: 'u1', delta: 10 } }, tags: ['whatif'] });
  add('employee', 'en', 'What if Jonas works 8 hours less?', 'whatIf', { params: { change: { kind: 'hours', personId: 'u2', delta: -8 } }, tags: ['whatif'] });

  // ================= support =================
  const dispFacts = [N('Tickets im Eingang', E.support.incoming)];
  for (const q of ['Wer soll die neuen Tickets bekommen?', 'Wer bekommt welches neue Ticket?', 'Wie viele Tickets sind im Eingang?', 'Welche Tickets reißen gleich das SLA?']) add('support', 'de', q, 'dispatchAdvice', { facts: dispFacts });
  for (const q of ['Dispatch the incoming support tickets', 'Who should take the new tickets?', 'Which tickets are about to breach the SLA?']) add('support', 'en', q, 'dispatchAdvice', { facts: dispFacts });
  const topicFacts = [N('Tickets betrachtet', E.support.topicTickets)];
  for (const q of ['Welche Support-Themen kommen immer wieder?', 'Wofür lohnt sich ein Playbook?', 'Welche Anfragen wiederholen sich?']) add('support', 'de', q, 'supportTopics', { facts: topicFacts });
  for (const q of ['Which tickets keep coming back? We need playbooks', 'What are the recurring support topics?']) add('support', 'en', q, 'supportTopics', { facts: topicFacts });
  const rcFacts = [N('verfügbar je Woche', E.realCap.available, 0.6), N('Support realistisch (P80)', E.realCap.support, 0.6), N('Raum für Projekte', E.realCap.room, 0.6)];
  for (const q of ['Wie viel Kapazität bleibt nach Support?', 'Realistische Kapazität', 'Wie viel Zeit frisst der Support?']) add('support', 'de', q, 'realCapacity', { facts: rcFacts });
  add('support', 'en', 'How much capacity is left after support?', 'realCapacity', { facts: rcFacts });
  add('support', 'de', 'Wie hoch ist unsere SLA-Quote?', ['dispatchAdvice', 'portfolioBrief']);
  add('support', 'en', 'What is our SLA rate?', ['dispatchAdvice', 'portfolioBrief']);

  // ================= cross-role topics =================
  const otFacts = [N('Teams über 100 %', E.overtime.teams), N('Personen über 100 %', E.overtime.people), N('Stunden zu viel', E.overtime.hours, 1)];
  for (const q of ['Wer macht bald Überstunden?', 'Droht Überlast in den nächsten Wochen?', 'Wer ist überlastet?']) add('teamLead', 'de', q, 'overtime', { facts: otFacts });
  for (const q of ['Who is heading for overtime?', 'Is anyone overloaded in the coming weeks?']) add('teamLead', 'en', q, 'overtime', { facts: otFacts });
  for (const q of ['Was passt ohne Überstunden?', 'Schaffen wir das ohne Überstunden?']) add('management', 'de', q, 'fits');
  add('management', 'en', 'Can we make it without overtime?', 'fits');
  const blkFacts = [N('blockiert', E.blocked), N('Terminkonflikte', E.conflicts)];
  for (const q of ['Was ist blockiert?', 'Gibt es Terminkonflikte?', 'Was hängt gerade fest?']) add('projectLead', 'de', q, 'blockers', { facts: blkFacts });
  for (const q of ['What is blocked?', 'Which dependencies are a problem?']) add('projectLead', 'en', q, 'blockers', { facts: blkFacts });
  const gapFacts = [N('Datenlücken', E.dq.gaps), N('dringend', E.dq.urgent)];
  for (const q of ['Wo fehlen Daten?', 'Welche Werte fehlen noch?', 'Wie gut ist unsere Datenqualität?', 'Welche Schätzungen fehlen?']) add('projectLead', 'de', q, 'gapsFix', { facts: gapFacts });
  for (const q of ['Where is data missing?', 'Which estimates are missing?']) add('projectLead', 'en', q, 'gapsFix', { facts: gapFacts });
  const paFacts = E.planActual ? [N('Plan h', E.planActual.plan, 0.6), N('gebucht h', E.planActual.book, 0.6)] : [];
  for (const q of ['Plan vs. Ist', 'Wo sind die geplanten Stunden geblieben?', 'Warum wurde weniger gebucht als geplant?']) add('teamLead', 'de', q, 'planActualExplain', { facts: paFacts });
  for (const q of ['Where did our hours go?', 'Plan versus actual of the last weeks']) add('teamLead', 'en', q, 'planActualExplain', { facts: paFacts });
  for (const q of ['Planungsvorschläge', 'Wie können wir die Wochenplanung verbessern?']) add('teamLead', 'de', q, 'planningAdvice');
  add('teamLead', 'en', 'Optimize the plan for the next weeks', 'planningAdvice');

  // ================= follow-ups (memory) =================
  const T = (id) => teams.find((t) => t.id === id) || teams[0];
  const tWeb = T('t-web'), tData = T('t-data'), tUx = T('t-ux'), tMob = T('t-mob'), tNetz = T('t-netz');
  const erp = byName['ERP-Anbindung'] || projects[1], bil = byName['Billing-Migration'] || projects[6], kpr = byName['Kundenportal Relaunch'] || projects[0], net = byName['Glasfaser-Netzausbau'] || projects[5];
  const fu = (persona, lang, prev, q, skill, extra = {}) => add(persona, lang, q, skill, { prev, tags: ['followup'], ...extra });
  fu('teamLead', 'de', [`Lagebild Team ${tUx.name}`], `und für Team ${tWeb.name}?`, 'teamBrief', { params: { team: tWeb.id }, facts: teamFacts(tWeb) });
  fu('teamLead', 'en', [`Briefing team ${tUx.name}`], `and for team ${tData.name}?`, 'teamBrief', { params: { team: tData.id }, facts: teamFacts(tData) });
  fu('teamLead', 'en', [`How is team ${tWeb.name} doing?`], `what about team ${tMob.name}?`, 'teamBrief', { params: { team: tMob.id }, facts: teamFacts(tMob) });
  fu('teamLead', 'de', [`Lagebild Team ${tUx.name}`], 'und im nächsten Quartal?', 'waterline', { params: { team: tUx.id, quarter: q1 }, facts: [N(`${tUx.name} ${q1}: Kapazität minus Bedarf`, Math.abs(E.team(tUx.id, q1).free), 0.6)] });
  fu('management', 'de', ['Ab welchem Rang reicht die Kapazität nicht?'], 'und im nächsten Quartal?', 'waterline', { params: { quarter: q1 }, facts: wlFacts(wl1) });
  fu('management', 'en', ['From which rank does capacity run out?'], 'and the next quarter?', 'waterline', { params: { quarter: q1 }, facts: wlFacts(wl1) });
  fu('teamLead', 'de', [`Lagebild Team ${tUx.name}`], 'warum?', 'why', { params: { skill: 'teamBrief' } });
  fu('projectLead', 'en', [`Briefing ${kpr.name}`], 'why?', 'why', { params: { skill: 'projectBrief' } });
  fu('management', 'de', ['Lagebild Portfolio'], 'Warum?', 'why', { params: { skill: 'portfolioBrief' } });
  fu('projectLead', 'de', [`Lagebild ${erp.name}`], `und ${bil.name}?`, 'projectBrief', { params: { ref: bil.ref }, facts: projectFacts(bil) });
  fu('projectLead', 'de', [`Lagebild ${erp.name}`], `und Team ${tNetz.name}?`, 'teamBrief', { params: { team: tNetz.id }, facts: teamFacts(tNetz) });
  fu('projectLead', 'de', [`Lagebild ${erp.name}`], 'was wäre wenn due +2 Wochen', 'whatIf', { params: { change: { kind: 'due', ref: erp.ref, weeks: 2 } } });
  fu('projectLead', 'de', [`Lagebild ${erp.name}`], 'Was blockiert dort?', 'blockers', { params: { ref: erp.ref }, facts: [N(`Terminkonflikte ${erp.name}`, erp.conflicts)] });
  fu('projectLead', 'de', [`Lagebild ${net.name}`], 'Was wäre wenn das Projekt auf Rang 1 rückt?', 'whatIf', { params: { change: { kind: 'rank', ref: net.ref, toRank: 1 } } });
  fu('teamLead', 'de', ['Wer macht bald Überstunden?'], `und bei Team ${tData.name}?`, 'overtime', { params: { team: tData.id } });
  fu('projectLead', 'en', [`How is ${erp.name} doing?`], `and ${kpr.name}?`, 'projectBrief', { params: { ref: kpr.ref }, facts: projectFacts(kpr) });
  fu('projectLead', 'de', [`Lagebild ${erp.name}`, `und ${bil.name}?`], 'warum?', 'why', { params: { skill: 'projectBrief' } });

  // ================= typos and loose phrasing =================
  const ty = (persona, lang, q, skill, extra = {}) => add(persona, lang, q, skill, { tags: ['typo'], ...extra });
  ty('management', 'de', 'Ab welchem Rang reicht die Kapazitat nicht?', 'waterline', { facts: wlFacts(wl0) });
  ty('management', 'de', 'Wasserlinei bitte', 'waterline', { facts: wlFacts(wl0) });
  ty('teamLead', 'de', 'Wer macht bald Uberstunden?', 'overtime', { facts: otFacts });
  ty('projectLead', 'de', 'Was ist blokiert?', 'blockers', { facts: blkFacts });
  ty('support', 'de', 'realistsche kapazität', 'realCapacity', { facts: rcFacts });
  ty('management', 'de', 'Lagebild Portfolo', 'portfolioBrief', { facts: portfolioFacts });
  ty('projectLead', 'de', `wie steht es um ${net.name.toLowerCase().replace('-', ' ')}`, 'projectBrief', { params: { ref: net.ref }, facts: projectFacts(net) });
  ty('projectLead', 'de', `lagebild ${erp.name.toLowerCase().replace('-', ' ')}`, 'projectBrief', { params: { ref: erp.ref }, facts: projectFacts(erp) });
  ty('teamLead', 'de', `Wie get es Team ${tWeb.name}?`, 'teamBrief', { params: { team: tWeb.id }, facts: teamFacts(tWeb) });
  ty('teamLead', 'de', `Ueberstunden Team ${tUx.name}`, 'overtime', { params: { team: tUx.id } });
  ty('projectLead', 'de', `${kpr.name.toLowerCase()} status`, 'projectBrief', { params: { ref: kpr.ref }, facts: projectFacts(kpr) });
  ty('management', 'en', 'How is teh portfolio doing?', 'portfolioBrief', { facts: portfolioFacts });
  ty('projectLead', 'en', 'Whats blocked', 'blockers', { facts: blkFacts });
  ty('teamLead', 'en', 'overtiem in the next weeks', 'overtime', { facts: otFacts });
  ty('management', 'en', 'waterlien please', 'waterline', { facts: wlFacts(wl0) });

  // ================= out of scope and the guard =================
  for (const [lang, q] of [['de', 'Wie wird das Wetter morgen?'], ['de', 'Erzähl mir einen Witz'], ['de', 'xyzzy plugh'], ['en', 'What is the capital of France?'], ['de', 'Bestell mir eine Pizza']])
    add('offTopic', lang, q, null, { tags: ['unknown'] });
  for (const [lang, q] of [['de', 'Wer ist am faulsten im Team?'], ['en', 'Rank the employees by productivity'], ['de', 'Wer arbeitet am schlechtesten?']])
    add('guard', lang, q, 'guard', { tags: ['guard'] });
  return out;
}

// The 10 jobs of tests/golden/JOBS.md as people say them – routed to a Lotse workflow (understand → kind 'workflow').
// [lang, sentence, workflow id, params subset]
export function goldenJobs(E) {
  const t = (id) => E.teams.find((x) => x.id === id) || E.teams[0];
  const p = (name) => E.byName[name] || E.projects[0];
  const web = t('t-web'), ux = t('t-ux'), erp = p('ERP-Anbindung');
  return [
    ['de', `Bereite die Wochenplanung für Team ${web.name} vor`, 'weeklyPrep', { team: web.id }],
    ['de', 'Weekly vorbereiten', 'weeklyPrep', {}],
    ['en', `Prepare the weekly planning for team ${web.name}`, 'weeklyPrep', { team: web.id }],
    ['de', 'Erstelle den C-Level-Report', 'cLevelReport', {}],
    ['de', 'Bericht für die Geschäftsführung zusammenstellen', 'cLevelReport', {}],
    ['en', 'Build the board report', 'cLevelReport', {}],
    ['de', 'Prüfe meine Buchungen', 'bookingCheck', {}],
    ['de', 'Buchungs-Check bitte', 'bookingCheck', {}],
    ['en', 'Check my bookings', 'bookingCheck', {}],
    ['de', 'Verteile die neuen Support-Tickets', 'supportTriage', {}],
    ['de', 'Support-Eingang abarbeiten', 'supportTriage', {}],
    ['en', 'Triage the support inbox', 'supportTriage', {}],
    ['de', 'Neue Tickets verteilen', 'supportTriage', {}],
    ['en', 'Distribute the new support tickets', 'supportTriage', {}],
    ['de', 'Wer hat zu wenig gebucht?', 'bookingCheck', {}],
    ['de', 'Wer hat diese Woche nicht genug gebucht?', 'bookingCheck', {}],
    ['en', 'Who booked too little?', 'bookingCheck', {}],
    ['en', 'Who has not logged enough this week?', 'bookingCheck', {}],
    ['de', 'Ranking für das Quartal neu setzen', 'reRankQuarter', {}],
    ['de', 'Projekte für das nächste Quartal neu priorisieren', 'reRankQuarter', {}],
    ['en', 'Re-rank the quarter', 'reRankQuarter', {}],
    ['de', `Fülle die Lücken in ${erp.name}`, 'fillGaps', { ref: erp.ref }],
    ['de', 'Fehlende Werte ergänzen', 'fillGaps', {}],
    ['en', 'Fill the missing values', 'fillGaps', {}],
    ['de', `Löse die Überlast in Team ${ux.name}`, 'resolveOverload', { team: ux.id }],
    ['de', 'Überlast abbauen', 'resolveOverload', {}],
    ['en', `Resolve the overload in team ${ux.name}`, 'resolveOverload', { team: ux.id }],
    ['de', 'Health-Runde starten', 'healthRound', {}],
    ['de', 'Alle Projekt-Status aktualisieren', 'healthRound', {}],
    ['en', 'Run the health round', 'healthRound', {}],
    ['de', 'Nimm ein neues Projekt auf', 'onboardProject', {}],
    ['de', 'Neues Projekt ins Portfolio aufnehmen', 'onboardProject', {}],
    ['en', 'Onboard a new project', 'onboardProject', {}],
    ['de', 'Löse die Terminkonflikte', 'fixConflicts', {}],
    ['de', 'Terminkonflikte beheben', 'fixConflicts', {}],
    ['en', 'Fix the schedule conflicts', 'fixConflicts', {}],
  ].map(([lang, q, workflow, params], i) => ({ id: `j${String(i + 1).padStart(2, '0')}`, persona: 'job', lang, q, workflow, params }));
}
