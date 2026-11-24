// Fixture stories for the local preview and the UI tests – shaped exactly like the Story contract (docs/LOTSE.md).
// Names, keys and refs are those of the mock dataset (lib/mock.js), so evidence and actions click through in ?mock.
// Production code never shows these: it imports the engine from '@shared/lotse/index.js'.
const iso = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const de = (lang) => lang !== 'en';

export function projectStory(lang = 'de') {
  const D = de(lang);
  return {
    id: 'projectBrief:issue:9005', skill: 'projectBrief', subject: { kind: 'project', ref: 'issue:9005', name: 'Glasfaser-Netzausbau' },
    lang, computedAt: new Date().toISOString(), tone: 'warn',
    headline: D ? 'Glasfaser-Netzausbau ist 12 Tage über dem Termin – Team Netz fehlt 140 h in diesem Quartal.' : 'Glasfaser-Netzausbau is 12 days past its date – team Netz is 140 h short this quarter.',
    kpis: [
      { id: 'progress', label: D ? 'Fortschritt' : 'Progress', value: 46, unit: '%', tone: 'ink', delta: 5, hint: D ? 'Gebuchte gegen geplante Stunden' : 'Logged against planned hours' },
      { id: 'late', label: D ? 'Verzug' : 'Late', value: 12, unit: 'd', tone: 'bad' },
      { id: 'gap', label: D ? 'Fehlt Team Netz' : 'Team Netz short', value: 140, unit: 'h', tone: 'warn' },
      { id: 'blocked', label: D ? 'Blockiert' : 'Blocked', value: 3, unit: 'n', tone: 'warn' },
    ],
    visual: {
      kind: 'gantt', caption: D ? 'Die Workstreams gegen den Projekttermin – Rollout 2 endet nach dem Due Date.' : 'The workstreams against the project date – Rollout 2 ends after the due date.',
      data: { from: iso(-60), to: iso(130), today: iso(0), rows: [
        { label: 'Fundament 1', start: iso(-55), end: iso(20), tone: 'ok', key: 'NET-2' },
        { label: 'Rollout 2', start: iso(-10), end: iso(112), tone: 'bad', key: 'NET-19', before: { start: iso(-10), end: iso(100) } },
        { label: 'Migration 3', start: iso(30), end: iso(95), tone: 'warn', key: 'NET-37' },
      ] },
    },
    findings: [
      { text: D ? 'Rollout 2 endet 12 Tage nach dem Due Date – der kritische Pfad läuft über NET-19.' : 'Rollout 2 ends 12 days after the due date – the critical path runs through NET-19.', tone: 'bad', impact: 90, evidence: [{ key: 'NET-19', label: 'Rollout 2', value: 12, unit: 'd' }] },
      { text: D ? 'Team Netz ist im Quartal mit 118 % verplant; 140 h fehlen.' : 'Team Netz is planned at 118 % this quarter; 140 h are missing.', tone: 'warn', impact: 70, evidence: [{ ref: 't-netz', label: 'Team Netz', value: 118, unit: '%' }, { ref: 't-netz', label: D ? 'fehlen' : 'missing', value: 140, unit: 'h' }] },
      { text: D ? '3 Stories sind blockiert, zwei davon warten auf ERP-Anbindung.' : '3 stories are blocked, two of them wait for ERP-Anbindung.', tone: 'warn', impact: 50, evidence: [{ key: 'NET-24', label: 'NET-24' }, { key: 'NET-27', label: 'NET-27' }, { ref: 'issue:9001', label: 'ERP-Anbindung' }] },
    ],
    actions: [
      { id: 'a1', label: D ? 'Was wäre wenn Rang 3?' : 'What if rank 3?', kind: 'whatIf', payload: { change: { kind: 'rank', ref: 'issue:9005', toRank: 3 } }, preview: D ? 'Rechnet das Szenario durch – nichts wird geändert.' : 'Computes the scenario – nothing is changed.', undoable: true },
      { id: 'a2', label: D ? 'Projekt auf Rang 3 heben' : 'Raise the project to rank 3', kind: 'rank', payload: { ref: 'issue:9005', toRank: 3 }, preview: D ? 'Glasfaser-Netzausbau rückt von Rang 6 auf Rang 3; die Projekte auf 3–5 rücken je einen Rang nach unten.' : 'Glasfaser-Netzausbau moves from rank 6 to rank 3; the projects on 3–5 move down one rank each.', undoable: true },
      { id: 'a3', label: D ? 'NET-19 in Jira öffnen' : 'Open NET-19 in Jira', kind: 'open', payload: { key: 'NET-19' }, preview: D ? 'Öffnet den Vorgang.' : 'Opens the work item.', undoable: true },
    ],
    followUps: [
      { label: D ? 'Was wäre wenn Rang 3?' : 'What if rank 3?', text: D ? 'Was wäre wenn Glasfaser-Netzausbau auf Rang 3?' : 'What if Glasfaser-Netzausbau were rank 3?' },
      { label: D ? 'Und Team Netz?' : 'And team Netz?', text: D ? 'Und für Team Netz?' : 'And for team Netz?' },
      { label: D ? 'Was blockiert?' : 'What is blocked?', text: D ? 'Was blockiert Glasfaser-Netzausbau?' : 'What blocks Glasfaser-Netzausbau?' },
    ],
    how: { text: D ? 'Termine aus Start/Due der Workstreams, Verzug = Ende des letzten Workstreams minus Due Date, Kapazität aus der Wasserlinie dieses Quartals.' : 'Dates from the workstreams\' start/due, late = end of the last workstream minus due date, capacity from this quarter\'s waterline.', inputs: [[D ? 'Workstreams' : 'Workstreams', '3'], [D ? 'Due Date' : 'Due date', iso(100)], [D ? 'Verplant Team Netz' : 'Planned team Netz', '118 %']] },
    confidence: 'high', sources: ['Jira', D ? 'Kapazitäten' : 'Capacities'],
  };
}

export function whatIfStory(lang = 'de') {
  const D = de(lang);
  return {
    id: 'whatIf:issue:9005:rank3', skill: 'whatIf', subject: { kind: 'project', ref: 'issue:9005', name: 'Glasfaser-Netzausbau' },
    lang, computedAt: new Date().toISOString(), tone: 'ok',
    headline: D ? 'Auf Rang 3 wird Glasfaser-Netzausbau voll besetzbar – Billing-Migration fällt dafür unter die Wasserlinie.' : 'On rank 3 Glasfaser-Netzausbau becomes fully staffable – Billing-Migration drops below the waterline instead.',
    kpis: [
      { id: 'staffable', label: D ? 'Besetzbar' : 'Staffable', value: 100, unit: '%', tone: 'ok', delta: 35 },
      { id: 'late', label: D ? 'Verzug' : 'Late', value: 0, unit: 'd', tone: 'ok', delta: -12 },
      { id: 'others', label: D ? 'Projekte darunter' : 'Projects below', value: 1, unit: 'n', tone: 'warn', delta: 1 },
    ],
    visual: {
      kind: 'compare', caption: D ? 'Heute gegen das Szenario „Rang 3“ – gleiche Daten, nur der Rang ist anders.' : 'Today against the scenario "rank 3" – same data, only the rank differs.',
      data: { a: { label: D ? 'Heute' : 'Today' }, b: { label: D ? 'Rang 3' : 'Rank 3' }, rows: [
        { label: D ? 'Besetzbar' : 'Staffable', unit: '%', a: 65, b: 100, better: 'higher' },
        { label: D ? 'Verzug' : 'Late', unit: 'd', a: 12, b: 0, better: 'lower' },
        { label: D ? 'Fehlende Stunden Team Netz' : 'Missing hours team Netz', unit: 'h', a: 140, b: 0, better: 'lower' },
        { label: D ? 'Projekte unter der Wasserlinie' : 'Projects below the waterline', unit: 'n', a: 1, b: 2, better: 'lower' },
      ] },
    },
    findings: [
      { text: D ? 'Der Verzug sinkt von 12 auf 0 Tage, weil Team Netz zuerst an Rollout 2 arbeitet.' : 'The delay drops from 12 to 0 days because team Netz works on Rollout 2 first.', tone: 'ok', impact: 90, evidence: [{ key: 'NET-19', label: 'Rollout 2' }] },
      { text: D ? 'Billing-Migration rutscht unter die Wasserlinie (2 statt 1 Projekte darunter).' : 'Billing-Migration slips below the waterline (2 instead of 1 projects below).', tone: 'warn', impact: 60, evidence: [{ ref: 'issue:9006', label: 'Billing-Migration' }] },
    ],
    actions: [
      { id: 'w1', label: D ? 'Rang 3 übernehmen' : 'Apply rank 3', kind: 'rank', payload: { ref: 'issue:9005', toRank: 3 }, preview: D ? 'Speichert die neue Rangfolge – rückgängig über den Verlauf.' : 'Saves the new ranking – undo in the history.', undoable: true },
    ],
    followUps: [
      { label: D ? 'Und Billing-Migration?' : 'And Billing-Migration?', text: D ? 'Wie steht Billing-Migration?' : 'How is Billing-Migration doing?' },
      { label: D ? 'Wasserlinie zeigen' : 'Show the waterline', text: D ? 'Zeig die Wasserlinie' : 'Show the waterline' },
    ],
    how: { text: D ? 'Die Wasserlinie wurde mit geändertem Rang neu gerechnet; alles andere ist unverändert.' : 'The waterline was recomputed with the changed rank; everything else is unchanged.', inputs: [[D ? 'Änderung' : 'Change', D ? 'Rang 6 → 3' : 'rank 6 → 3']] },
    confidence: 'high', sources: ['Jira', D ? 'Kapazitäten' : 'Capacities'],
  };
}

export function portfolioStory(lang = 'de') {
  const D = de(lang);
  return {
    id: 'portfolioBrief:portfolio', skill: 'portfolioBrief', subject: { kind: 'portfolio', ref: 'portfolio', name: 'Portfolio' },
    lang, computedAt: new Date().toISOString(), tone: 'warn',
    headline: D ? '6 von 8 Projekten sind in diesem Quartal besetzbar – ab Rang 7 reicht die Kapazität nicht.' : '6 of 8 projects are staffable this quarter – from rank 7 on capacity runs out.',
    kpis: [
      { id: 'staffable', label: D ? 'Besetzbar' : 'Staffable', value: 6, unit: 'n', tone: 'ok' },
      { id: 'capacity', label: D ? 'Kapazität' : 'Capacity', value: 2400, unit: 'h', tone: 'info' },
      { id: 'demand', label: D ? 'Bedarf' : 'Demand', value: 2860, unit: 'h', tone: 'warn', delta: 180 },
    ],
    visual: {
      kind: 'waterline', caption: D ? 'Bedarf in Rangfolge aufsummiert gegen die Kapazität – was unter der Linie liegt, wird nicht fertig.' : 'Demand summed in rank order against capacity – what lies below the line will not get done.',
      data: { quarter: '2026-Q4', capacity: 2400, unit: 'h', waterRank: 7, items: [
        { rank: 1, label: 'Kundenportal Relaunch', ref: 'issue:9000', value: 520, cum: 520, status: 'ok' },
        { rank: 2, label: 'ERP-Anbindung', ref: 'issue:9001', value: 410, cum: 930, status: 'ok' },
        { rank: 3, label: 'DSGVO-Löschkonzept', ref: 'issue:9002', value: 180, cum: 1110, status: 'ok' },
        { rank: 4, label: 'Mobile App 2.0', ref: 'issue:9003', value: 460, cum: 1570, status: 'ok' },
        { rank: 5, label: 'Datenplattform', ref: 'issue:9004', value: 390, cum: 1960, status: 'ok' },
        { rank: 6, label: 'Glasfaser-Netzausbau', ref: 'issue:9005', value: 300, cum: 2260, status: 'ok' },
        { rank: 7, label: 'Billing-Migration', ref: 'issue:9006', value: 350, cum: 2610, status: 'partial' },
        { rank: 8, label: 'CRM-Konsolidierung', ref: 'issue:9007', value: 250, cum: 2860, status: 'no' },
      ] },
    },
    findings: [
      { text: D ? 'Billing-Migration (Rang 7) und CRM-Konsolidierung (Rang 8) liegen unter der Wasserlinie.' : 'Billing-Migration (rank 7) and CRM-Konsolidierung (rank 8) lie below the waterline.', tone: 'bad', impact: 90, evidence: [{ ref: 'issue:9006', label: 'Billing-Migration' }, { ref: 'issue:9007', label: 'CRM-Konsolidierung' }] },
      { text: D ? 'Der Bedarf liegt 460 h über der Kapazität von 2.400 h.' : 'Demand is 460 h above the capacity of 2,400 h.', tone: 'warn', impact: 70, evidence: [{ label: D ? 'Bedarf' : 'Demand', value: 2860, unit: 'h' }, { label: D ? 'Kapazität' : 'Capacity', value: 2400, unit: 'h' }] },
    ],
    actions: [
      { id: 'p1', label: D ? 'Wasserlinie im Portfolio ansehen' : 'View the waterline in the portfolio', kind: 'navigate', payload: { view: 'portfolio' }, preview: D ? 'Öffnet das Portfolio.' : 'Opens the portfolio.', undoable: true },
    ],
    followUps: [
      { label: D ? 'Was wäre wenn Billing Rang 5?' : 'What if Billing were rank 5?', text: D ? 'Was wäre wenn Billing-Migration auf Rang 5?' : 'What if Billing-Migration were rank 5?' },
      { label: D ? 'Welche Teams fehlen?' : 'Which teams are short?', text: D ? 'Welche Teams sind überlastet?' : 'Which teams are overloaded?' },
    ],
    how: { text: D ? 'Restaufwand je Projekt in Rangfolge aufsummiert, gegen die Kapazität aller Teams in diesem Quartal.' : 'Remaining effort per project summed in rank order, against all teams\' capacity this quarter.', inputs: [[D ? 'Quartal' : 'Quarter', 'Q4 2026'], [D ? 'Projekte' : 'Projects', '8']] },
    confidence: 'medium', sources: ['Jira', D ? 'Kapazitäten' : 'Capacities'],
  };
}

// Data of the other visual kinds (each a valid visual.data) – the preview gallery and the tests render all of them.
export const VISUAL_SAMPLES = {
  bars: { unit: 'h', target: 120, items: [{ label: 'Web', value: 182, tone: 'bad', ref: 't-web' }, { label: 'UX', value: 120, tone: 'warn', ref: 't-ux' }, { label: 'Netz', value: 140, tone: 'warn', ref: 't-netz' }, { label: 'Data', value: 40, tone: 'ok', ref: 't-data' }] },
  columns: { unit: 'h', labels: ['KW 44', 'KW 45', 'KW 46', 'KW 47'], target: 160, series: [{ name: 'Plan', values: [160, 172, 168, 150], tone: 'muted' }, { name: 'Ist', values: [151, 180, 142, null], tone: 'ink' }] },
  line: { unit: '%', labels: ['KW 43', 'KW 44', 'KW 45', 'KW 46', 'KW 47', 'KW 48'], target: 85, series: [{ name: 'Auslastung', values: [78, 84, 92, 104, 112, 96] }] },
  donut: { unit: 'h', total: 890, items: [{ label: 'Projekte', value: 620, tone: 'ink' }, { label: 'Support', value: 180, tone: 'warn' }, { label: 'Intern', value: 90, tone: 'muted' }] },
  heat: { unit: '%', cols: ['Okt', 'Nov', 'Dez', 'Jan'], rows: [{ label: 'Web', ref: 't-web', values: [92, 108, 115, 80] }, { label: 'Netz', ref: 't-netz', values: [70, 88, 118, 95] }, { label: 'UX', ref: 't-ux', values: [60, 74, 81, null] }] },
  timeline: { from: iso(-20), to: iso(140), today: iso(0), events: [{ date: iso(-12), label: 'Health: gefährdet', tone: 'warn', kind: 'health' }, { date: iso(14), label: 'Fundament 1 fertig', tone: 'ok', key: 'NET-2' }, { date: iso(45), label: 'Go-Live Kundenportal', tone: 'info' }, { date: iso(100), label: 'Due Date', tone: 'bad' }, { date: iso(112), label: 'Rollout 2 Ende', tone: 'bad', key: 'NET-19' }] },
  compare: whatIfStory().visual.data,
  waterline: portfolioStory().visual.data,
  gantt: projectStory().visual.data,
};
export const VISUAL_KINDS = ['bars', 'columns', 'line', 'donut', 'heat', 'timeline', 'compare', 'waterline', 'gantt'];

export const fixtureStories = (lang) => [projectStory(lang), whatIfStory(lang), portfolioStory(lang)];

// The same reading the server would return from the server's AI reading – one claim deliberately wrong (the preview shows
// the difference view); `agree` is used for the "Lotse und KI stimmen überein" case.
export function fixtureReading(story, { agree = false } = {}) {
  const D = story.lang !== 'en';
  const k = story.kpis || [];
  const late = k.find((x) => x.unit === 'd');
  const h = k.find((x) => x.unit === 'h');
  const lateFound = agree ? late?.value : (late?.value ?? 0) + 2;
  const text = D
    ? `${story.subject?.name} liegt ${lateFound ?? '–'} Tage hinter dem Termin. Hauptgrund ist ${h ? `die fehlende Kapazität von ${h.value} h` : 'die Kapazität'}. Am meisten hilft es, den kritischen Workstream früher zu starten.`
    : `${story.subject?.name} is ${lateFound ?? '–'} days behind its date. The main reason is ${h ? `the missing capacity of ${h.value} h` : 'capacity'}. Starting the critical workstream earlier helps most.`;
  const claims = [
    ...(late ? [{ text: D ? `${lateFound} Tage` : `${lateFound} days`, kind: 'number', verified: lateFound === late.value, expected: `${late.value} d`, found: `${lateFound} d` }] : []),
    ...(h ? [{ text: `${h.value} h`, kind: 'number', verified: true, expected: `${h.value} h`, found: `${h.value} h` }] : []),
  ];
  const bad = claims.filter((c) => c.verified === false).length;
  return { source: 'ai', model: 'mock', text, crossCheck: { agree: claims.length ? (claims.length - bad) / claims.length : 0, claims, verdict: !claims.length ? 'unverifiable' : bad ? 'differs' : 'agrees' } };
}
