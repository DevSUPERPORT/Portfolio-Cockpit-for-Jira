// Lotse chains – the capability catalogue ("tools"): everything Lotse can do, with a stable id, what it does (DE/EN),
// typed inputs, typed outputs, whether it writes and which right it needs. GENERATED from the registries – the skills
// (skills/index.js), the workflows and missions (workflows.js), the commands (commands.js) and the named queries
// (query.js) – plus the few set-aware tools only chains have (CHAIN_TOOLS). No second source of truth: a new skill,
// workflow or command appears here by itself; tests/lotseChain.test.js fails when a workflow or command has no
// write/right annotation below.
//
//   toolCatalog() → { [id]: Tool }      built once (lazily: workflows.js and this module import each other)
//   Tool = { id, kind: 'query'|'story'|'workflow'|'command'|'job', source, title: [de, en], desc: [de, en], icon,
//            params: { name: Param }, input: null | { accepts: entity[], required, fanOut? }, out: Out,
//            write: bool, changesData: bool, irreversible?: bool, right: null | Right, chainable: bool }
//   Param = { type: 'project'|'team'|'person'|'quarter'|'weeks'|'percent'|'number'|'enum'|'flag'|'text'|'query'|'blocks',
//             values?, min?, max?, default?, required?, label: [de, en] }
//   Out   = 'set:people'|'set:projects'|'set:teams'|'set:stories'|'set:tickets'|'story'|'doc'|'write'|'view'
//   catalogSchema() → what the LLM planner sees: ids, English descriptions, parameter schemas – no data, no names.
//   cleanParams(tool, params, ctx) → params checked and resolved (names → refs), or throws INVALID
import { SKILLS, SKILL_IDS } from '../skills/index.js';
import { WORKFLOWS, WORKFLOW_IDS } from './workflows.js';
import { COMMANDS, COMMAND_IDS, REPORT_OPTIONS } from './commands.js';
import { PRESETS, PRESET_IDS, ENTITIES, cleanQuery, parseQuerySyntax, quarterIn } from './query.js';
import { BLOCKS } from './orchestrate/parse.js';
import { fold, findProject, findTeam } from '../../ask.js';
import { invalid, computedOf, dsOf, can, meId } from './kit.js';

// ---------- annotations the registries cannot say themselves ----------
// which commands a workflow may end in (its write flag and right follow from them)
export const WF_COMMANDS = {
  weeklyPrep: ['plan.applyOptimizer', 'plan.move', 'issue.bulkFill'], resolveOverload: ['plan.applyOptimizer'], reRankQuarter: ['rank.reorder'], fillGaps: ['issue.bulkFill'],
  bookingCheck: ['booking.book', 'notice.remind'], healthRound: ['health.set'], supportTriage: ['dispatch.assign'], onboardProject: ['issue.bulkFill', 'plan.move', 'plan.applyOptimizer', 'health.set'],
  fixConflicts: ['plan.move'], cLevelReport: ['report.compose'], balanceWeek: ['issue.bulkFill', 'plan.move', 'booking.book'], teamPlan: ['support.reserve', 'plan.move'],
  learnFromPast: ['issue.bulkFill', 'health.set'], supportPlaybooks: ['playbook.save', 'navigate'], disruption: ['capacity.closure', 'plan.move'], splitResolve: ['plan.move', 'capacity.setShares'], orchestrate: ['doc.pdf', 'notice.remind'], chain: [],
};
// the right a command needs (mirrors commandList / can.*); null = everyone
export const COMMAND_RIGHT = {
  'rank.set': 'rank', 'rank.reorder': 'rank', 'issue.setField': 'edit', 'issue.bulkFill': 'edit', 'plan.move': 'plan', 'plan.applyOptimizer': 'plan', 'health.set': 'health',
  'dispatch.assign': 'dispatch', 'support.reserve': 'capacity', 'deps.link': 'edit', 'deps.unlink': 'edit', 'booking.book': 'self', 'notice.remind': 'remind', 'capacity.setHours': 'capacity', 'capacity.closure': 'capacity', 'capacity.setShares': 'capacity',
  'report.compose': 'report', 'doc.pdf': null, 'doc.chain': null, navigate: null, 'playbook.save': 'playbooks',
};
// writes that never change the cockpit's data (a reminder, a document): later steps need no fresh numbers after them
const NO_DATA_CHANGE = new Set(['notice.remind', 'report.compose', 'doc.pdf', 'doc.chain', 'navigate', 'playbook.save']);
const IRREVERSIBLE = new Set(['notice.remind']);
// params a workflow reads through one of its decisions (param → decide id): a chain step pre-answers that decision
export const WF_PREFILL = { cLevelReport: { audience: 'audience' } };
const WF_EXTRA = { cLevelReport: { audience: { type: 'enum', values: ['board', 'management', 'teamLeads'], default: 'board', label: ['Für', 'For'] } } };
const RIGHT_ORDER = ['rank', 'plan', 'capacity', 'remind', 'dispatch', 'report', 'health', 'playbooks', 'edit', 'self'];
export const RIGHT_NAMES = {
  rank: ['Rangfolge ändern', 'Change the ranking'], plan: ['Wochenplanung ändern', 'Change weekly planning'], capacity: ['Kapazitäten pflegen', 'Maintain capacities'],
  remind: ['Erinnerungen senden', 'Send reminders'], dispatch: ['Tickets verteilen', 'Dispatch tickets'], report: ['C-Level-Report', 'C-level report'], health: ['Health setzen', 'Set health'],
  playbooks: ['Playbooks pflegen', 'Maintain playbooks'], edit: ['Vorgänge bearbeiten', 'Edit work items'], self: ['Eigene Zeit buchen', 'Log own time'],
};
// may this person do it at all? (the server decides again; the plan editor greys a step out early)
export function rightOk(ctx, right) {
  if (!right) return true;
  const r = ctx?.roles || {};
  switch (right) {
    case 'rank': return can.rank(ctx);
    case 'plan': return can.plan(ctx);
    case 'capacity': return can.capacity(ctx);
    case 'remind': return can.remind(ctx);
    case 'dispatch': return can.dispatch(ctx);
    case 'report': return can.report(ctx);
    case 'health': return can.healthAny(ctx) || computedOf(ctx).model.items.some((it) => it.owner?.id && it.owner.id === meId(ctx));
    case 'playbooks': return !!(r.admin || r.dispatch || r.editCapacity);
    case 'self': return !!meId(ctx);
    default: return true;
  }
}
const strongest = (rights) => RIGHT_ORDER.find((x) => rights.includes(x)) || null;

const P = {
  project: (req = false) => ({ type: 'project', required: req, label: ['Projekt', 'Project'] }),
  team: (req = false) => ({ type: 'team', required: req, label: ['Team', 'Team'] }),
  person: (req = false) => ({ type: 'person', required: req, label: ['Person', 'Person'] }),
  quarter: () => ({ type: 'quarter', label: ['Quartal', 'Quarter'] }),
  next: (d = 4) => ({ type: 'weeks', min: 1, max: 12, default: d, label: ['Wochen voraus', 'Weeks ahead'] }),
  past: (d = 4) => ({ type: 'weeks', min: 1, max: 12, default: d, label: ['Wochen zurück', 'Weeks back'] }),
  text: (max = 200) => ({ type: 'text', max, label: ['Text', 'Text'] }),
};
const ICON = { query: 'search', story: 'chart', workflow: 'layers', command: 'zap', job: 'report' };

// ---------- the set-aware tools only chains have (their runners: chain/run.js) ----------
export const CHAIN_TOOLS = {
  'plan.balance': {
    kind: 'workflow', icon: 'target', title: ['Wochen auf 100 % planen', 'Plan the weeks to 100%'],
    desc: ['Plant die offene Arbeit der Personen so, dass jede Woche beim Ziel liegt (neue Fenster, auf Wunsch Übergaben) – Vorschau, dann Jira.', 'Re-plans the people\'s open work so every week stays at the target (new windows, handovers if allowed) – preview, then Jira.'],
    params: { target: { type: 'percent', min: 50, max: 150, default: 100, label: ['Ziel', 'Target'] }, order: { type: 'enum', values: ['due', 'rank'], default: 'due', label: ['Reihenfolge', 'Order'] }, handover: { type: 'flag', default: false, label: ['Übergaben erlaubt', 'Handovers allowed'] } },
    input: { accepts: ['people'], required: true }, out: 'set:people', commands: ['plan.move'],
  },
  'fill.estimates': {
    kind: 'workflow', icon: 'edit', title: ['Fehlende Schätzungen füllen', 'Fill missing estimates'],
    desc: ['Schlägt für Stories ohne Schätzung Werte aus ähnlicher erledigter Arbeit vor (Median) und setzt sie nach der Vorschau.', 'Suggests values for stories without an estimate from similar finished work (median) and sets them after the preview.'],
    params: { project: P.project(), team: P.team(), person: P.person() }, input: { accepts: ['projects', 'stories'], required: false }, out: 'write', commands: ['issue.bulkFill'],
  },
  'check.waterline': {
    kind: 'story', icon: 'waves', title: ['Wasserlinie vergleichen', 'Compare the waterline'],
    desc: ['Vergleicht die Wasserlinie (besetzbar je Quartal, fehlende Stunden) jetzt mit dem Stand vor dem Auftrag.', 'Compares the waterline (staffable per quarter, missing hours) now with the state before the job.'],
    params: { project: P.project(), quarter: P.quarter() }, input: { accepts: ['projects'], required: false }, out: 'story', commands: [],
  },
  'notify.remind': {
    kind: 'command', icon: 'bell', title: ['Erinnern', 'Remind'],
    desc: ['Jira-Erinnerung an die Personen der Menge (fehlende Buchungen oder Werte) – nur nach ausdrücklicher Wahl, jede Person in der Vorschau.', 'Jira reminder to the people of the set (missing bookings or values) – only when explicitly chosen, every person in the preview.'],
    params: { kind: { type: 'enum', values: ['booking', 'gaps'], default: 'booking', label: ['Worüber', 'About'] } }, input: { accepts: ['people'], required: true }, out: 'write', commands: ['notice.remind'],
  },
  'doc.job': {
    kind: 'job', icon: 'pdf', title: ['Dokument je Empfänger', 'Document per recipient'],
    desc: ['Ein PDF (oder Texte) mit einem persönlichen Abschnitt je Person, Team oder Projekt der Menge – jede Zahl im Nachweis belegt.', 'A PDF (or texts) with a personal section per person, team or project of the set – every number proven in the appendix.'],
    params: {
      blocks: { type: 'blocks', values: BLOCKS, label: ['Bausteine', 'Blocks'] }, next: { ...P.next(4), default: null }, past: { ...P.past(0), default: null },
      format: { type: 'enum', values: ['pdfAll', 'pdfEach', 'text'], default: 'pdfAll', label: ['Format', 'Format'] },
      audience: { type: 'enum', values: ['colleagues', 'management', 'teamLeads', 'owners'], default: null, label: ['Für', 'For'] },
      tone: { type: 'enum', values: ['friendly', 'formal'], default: null, label: ['Ton', 'Tone'] },
    },
    input: { accepts: ['people', 'teams', 'projects'], required: true }, out: 'doc', commands: ['doc.pdf'],
  },
  'doc.list': {
    kind: 'job', icon: 'list', title: ['Liste als PDF', 'List as PDF'],
    desc: ['Die Menge eines früheren Schritts als Liste mit den Zahlen, die sie qualifiziert haben – als PDF mit Nachweis.', 'The set of an earlier step as a list with the numbers that qualified it – as a PDF with a proof.'],
    params: { format: { type: 'enum', values: ['pdf', 'text'], default: 'pdf', label: ['Format', 'Format'] } }, input: { accepts: ENTITIES, required: true }, out: 'doc', commands: ['doc.chain'],
  },
  'doc.brief': {
    kind: 'job', icon: 'report', title: ['Zusammenfassung schreiben', 'Write a summary'],
    desc: ['Fasst die Ergebnisse der Schritte davor für eine Person zusammen (Owner, Management, Teamleitung) – nur mit den belegten Zahlen; als Text, auf Wunsch als PDF.', 'Sums up the results of the steps before for someone (owner, management, team lead) – only with the proven numbers; as text, as a PDF if wanted.'],
    params: { audience: { type: 'enum', values: ['owners', 'management', 'teamLeads', 'colleagues'], default: 'owners', label: ['Für', 'For'] }, format: { type: 'enum', values: ['text', 'pdf'], default: 'text', label: ['Format', 'Format'] } },
    input: { accepts: ENTITIES, required: false }, out: 'doc', commands: ['doc.chain'],
  },
  query: {
    kind: 'query', icon: 'search', title: ['Eigene Abfrage', 'Own query'],
    desc: ['Eine Menge aus den Cockpit-Zahlen, z. B. „people where load > 100 next 4w“.', 'A set from the cockpit\'s numbers, e.g. "people where load > 100 next 4w".'],
    params: { query: { type: 'query', required: true, label: ['Abfrage', 'Query'] } }, input: null, out: 'set', commands: [],
  },
};

// skills: the params they read → typed params
const SKILL_PARAM = { project: ['ref', P.project()], team: ['team', P.team()], person: ['person', P.person()], quarter: ['quarter', P.quarter()] };
const SKILL_OFF = new Set(['whatIf', 'why', 'intentMap', 'compare', 'today', 'playbookDraft', 'estimate', 'similarSummary', 'bookingComments', 'supportTopics']);
const CMD_OFF = new Set(['doc.pdf', 'doc.chain', 'playbook.save']);
const WF_PARAM = { project: ['project', P.project()], team: ['team', P.team()], person: ['person', P.person()], quarter: ['quarter', P.quarter()] };
const WF_OFF = new Set(['chain']);
const CMD_ON = { navigate: { view: { type: 'enum', values: ['portfolio', 'project', 'team', 'plan', 'time', 'support', 'report', 'mine', 'capacity', 'config'], required: true, label: ['Ansicht', 'View'] } },
  'report.compose': { audience: { type: 'enum', values: REPORT_OPTIONS.AUDIENCES, default: 'board', label: ['Für', 'For'] }, period: { type: 'enum', values: REPORT_OPTIONS.PERIODS, default: 'currentQuarter', label: ['Zeitraum', 'Period'] } } };
const WF_DESC = {
  weeklyPrep: ['Bereitet das Weekly vor: Überlast glätten, Terminkonflikte lösen, dringende Lücken füllen.', 'Prepares the weekly: smooth overload, fix schedule conflicts, fill urgent gaps.'],
  resolveOverload: ['Löst die Überlast eines Teams oder einer Person auf: strecken, später legen oder umverteilen.', 'Resolves the overload of a team or person: stretch, move later or reassign.'],
  reRankQuarter: ['Vergleicht Rangfolgen an der Wasserlinie eines Quartals und setzt die gewählte.', 'Compares rankings on a quarter\'s waterline and sets the chosen one.'],
  fillGaps: ['Füllt fehlende Werte (Team, Schätzung, Termine …) mit Vorschlägen aus echten Daten.', 'Fills missing values (team, estimate, dates …) with suggestions from real data.'],
  bookingCheck: ['Prüft die eigenen Buchungen der Woche und bucht fehlende Stunden aus dem Plan.', 'Checks one\'s own bookings of the week and logs missing hours from the plan.'],
  healthRound: ['Health-Runde: Entwurf je Projekt annehmen oder ändern, alles speichern.', 'Health round: accept or edit the draft per project, save all.'],
  supportTriage: ['Verteilt den Support-Eingang: SLA zuerst, an die Person mit der meisten Luft.', 'Triages the support inbox: SLA first, to the person with the most room.'],
  onboardProject: ['Setzt ein Projekt auf: Werte, Abhängigkeiten, Plan, erstes Health-Update.', 'Onboards a project: values, dependencies, plan, first health update.'],
  fixConflicts: ['Legt Nachfolger hinter ihre Vorgänger.', 'Moves successors behind their prerequisites.'],
  cLevelReport: ['Stellt den C-Level-Report zusammen (Zielgruppe, Abschnitte, Zeitraum) und öffnet den Baukasten.', 'Composes the C-level report (audience, sections, period) and opens the composer.'],
  balanceWeek: ['Plant die Woche einer Person auf 100 %.', 'Plans one person\'s week to 100%.'],
  teamPlan: ['Plant ein Team realistisch: Support-Reserve, Prioritäten, Übergaben.', 'Plans a team realistically: support reserve, priorities, handovers.'],
  learnFromPast: ['Lernt aus ähnlicher erledigter Arbeit: Schätzungen und Lehren für ein Projekt.', 'Learns from similar finished work: estimates and lessons for a project.'],
  supportPlaybooks: ['Legt Playbooks für wiederkehrende Support-Themen an.', 'Creates playbooks for recurring support topics.'],
  orchestrate: ['Führt einen frei formulierten Dokument-Auftrag aus: Daten je Person, Team oder Projekt, PDF und persönliche Texte.', 'Runs a free-form document job: data per person, team or project, a PDF and personal texts.'],
};

let CATALOG = null;
export function toolCatalog() {
  if (CATALOG) return CATALOG;
  const out = {};
  for (const id of PRESET_IDS) {
    const p = PRESETS[id];
    const win = p.window || {};
    out[`query.${id}`] = {
      id: `query.${id}`, kind: 'query', source: 'query', icon: 'search', title: p.name, desc: [`Findet: ${p.name[0]} – mit den Zahlen, die jede Zeile qualifizieren.`, `Finds: ${p.name[1]} – with the numbers that qualify each row.`],
      params: { ...(win.next ? { next: P.next(win.next) } : {}), ...(win.past ? { past: P.past(win.past) } : {}), ...('quarter' in win ? { quarter: P.quarter() } : {}),
        ...(p.where[0] && ['load', 'booking', 'missing', 'support'].includes(p.where[0].m) && typeof p.where[0].v === 'number' ? { threshold: { type: 'number', min: 0, max: 1000, default: p.where[0].v, label: ['Schwelle', 'Threshold'] } } : {}),
        ...(['people', 'stories', 'tickets', 'teams'].includes(p.entity) ? { team: P.team() } : {}), ...(['people', 'stories'].includes(p.entity) ? { project: P.project() } : {}) },
      input: null, out: `set:${p.entity}`, write: false, changesData: false, right: null, chainable: true, preset: id,
    };
  }
  for (const id of SKILL_IDS) {
    const sk = SKILLS[id];
    const params = {};
    for (const k of sk.params || []) if (SKILL_PARAM[k]) params[SKILL_PARAM[k][0]] = SKILL_PARAM[k][1];
    out[`skill.${id}`] = {
      id: `skill.${id}`, kind: 'story', source: 'skill', icon: 'chart', title: [sk.title('de'), sk.title('en')], desc: [`Lotse-Lagebild: ${sk.title('de')}.`, `Lotse story: ${sk.title('en')}.`],
      params, input: params.ref ? { accepts: ['projects'], required: false, fanOut: 'ref' } : params.team ? { accepts: ['teams'], required: false, fanOut: 'team' } : params.person ? { accepts: ['people'], required: false, fanOut: 'person' } : null,
      out: 'story', write: false, changesData: false, right: null, chainable: !SKILL_OFF.has(id), skill: id,
    };
  }
  for (const id of WORKFLOW_IDS) {
    if (WF_OFF.has(id)) continue;
    const wf = WORKFLOWS[id];
    const params = {};
    for (const k of wf.params || []) if (WF_PARAM[k]) params[WF_PARAM[k][0]] = WF_PARAM[k][1];
    if ((wf.params || []).includes('text')) params.text = P.text(300);
    Object.assign(params, WF_EXTRA[id] || {});
    const cmds = WF_COMMANDS[id] || [];
    const write = cmds.some((c) => COMMANDS[c]?.write);
    out[`wf.${id}`] = {
      id: `wf.${id}`, kind: 'workflow', source: 'workflow', icon: 'layers', title: [wf.title('de'), wf.title('en')], desc: WF_DESC[id] || [wf.title('de'), wf.title('en')],
      params, input: params.project ? { accepts: ['projects'], required: false, fanOut: 'project' } : params.team ? { accepts: ['teams'], required: false, fanOut: 'team' } : params.person ? { accepts: ['people'], required: false, fanOut: 'person' } : params.quarter ? { accepts: ['projects'], required: false } : null,
      out: write ? 'write' : 'view', write, changesData: cmds.some((c) => COMMANDS[c]?.write && !NO_DATA_CHANGE.has(c)), irreversible: cmds.some((c) => IRREVERSIBLE.has(c)) || undefined,
      right: strongest(cmds.map((c) => COMMAND_RIGHT[c]).filter(Boolean)), chainable: true, workflow: id, commands: cmds,
    };
  }
  for (const id of COMMAND_IDS) {
    const c = COMMANDS[id];
    out[`cmd.${id}`] = {
      id: `cmd.${id}`, kind: 'command', source: 'command', icon: 'zap', title: [c.title('de'), c.title('en')], desc: [`Befehl: ${c.title('de')} (${c.params}).`, `Command: ${c.title('en')} (${c.params}).`],
      params: CMD_ON[id] || { args: { type: 'args', command: id, required: true, label: ['Angaben', 'Arguments'] } }, input: null, out: c.write ? 'write' : 'view', write: c.write, changesData: c.write && !NO_DATA_CHANGE.has(id), irreversible: IRREVERSIBLE.has(id) || undefined,
      right: COMMAND_RIGHT[id] ?? null, chainable: !CMD_OFF.has(id), command: id,
    };
  }
  for (const [id, t] of Object.entries(CHAIN_TOOLS)) {
    const write = t.commands.some((c) => COMMANDS[c]?.write);
    out[id] = { id, ...t, source: 'chain', write, changesData: t.commands.some((c) => COMMANDS[c]?.write && !NO_DATA_CHANGE.has(c)), irreversible: t.commands.some((c) => IRREVERSIBLE.has(c)) || undefined, right: strongest(t.commands.map((c) => COMMAND_RIGHT[c]).filter(Boolean)), chainable: true };
  }
  CATALOG = Object.freeze(out);
  return CATALOG;
}
export const toolOf = (id) => toolCatalog()[id] || null;
export function catalogCounts() {
  const c = { query: 0, story: 0, workflow: 0, command: 0, job: 0 };
  for (const t of Object.values(toolCatalog())) c[t.kind] += 1;
  return { ...c, total: Object.keys(toolCatalog()).length, chainable: Object.values(toolCatalog()).filter((t) => t.chainable).length };
}
// what an entity-typed output is (for binding "them" to the right step)
export const outEntity = (t, params = {}) => (!t ? null : t.out === 'set' ? params.query?.entity || null : t.out?.startsWith('set:') ? t.out.slice(4) : null);

// ---------- the schema the LLM planner sees (no data, no names) ----------
export function catalogSchema() {
  const list = [];
  for (const t of Object.values(toolCatalog())) {
    if (!t.chainable) continue;
    const params = {};
    for (const [k, p] of Object.entries(t.params)) params[k] = { type: p.type === 'args' ? `object ${COMMANDS[p.command]?.params || ''}` : p.type, ...(p.values ? { values: p.values } : {}), ...(p.min != null ? { min: p.min, max: p.max } : {}), ...(p.required ? { required: true } : {}), ...(p.default != null ? { default: p.default } : {}) };
    list.push({ id: t.id, kind: t.kind, does: t.desc[1], params, ...(t.input ? { input: t.input.accepts, inputRequired: !!t.input.required } : {}), out: t.out, writes: t.write });
  }
  return list;
}

// ---------- checking params (from the parser, the plan editor or the LLM) ----------
const DE_EN = (v) => fold(String(v || '')).trim();
function resolveProject(v, ctx) {
  const { model } = computedOf(ctx);
  if (typeof v !== 'string' || !v.trim()) return null;
  if (model.itemByRef.has(v)) return v;
  const byKey = model.items.find((it) => it.key && it.key.toUpperCase() === v.trim().toUpperCase().replace(/^#\d+\s+/, ''));
  if (byKey) return byKey.ref;
  const hit = findProject(DE_EN(v), model);
  return hit ? hit.ref : null;
}
function resolveTeam(v, ctx) {
  const { model } = computedOf(ctx);
  if (typeof v !== 'string' || !v.trim()) return null;
  if (model.teams.has(v)) return v;
  const exact = [...model.teams.values()].find((t) => DE_EN(t.name) === DE_EN(v).replace(/^team\s+/, ''));
  if (exact) return exact.id;
  const hit = findTeam(DE_EN(v), model);
  return hit ? hit.id : null;
}
function resolvePerson(v, ctx) {
  const ds = dsOf(ctx);
  if (typeof v !== 'string' || !v.trim()) return null;
  if (ds.people?.[v]) return v;
  if (/^(me|ich|mich|mir)$/i.test(v.trim())) return meId(ctx);
  const f = DE_EN(v);
  const all = Object.values(ds.people || {}).filter((p) => p?.name);
  const full = all.find((p) => DE_EN(p.name) === f);
  if (full) return full.id;
  const first = all.filter((p) => DE_EN(p.name).split(' ')[0] === f);
  return first.length === 1 ? first[0].id : null;
}
export function cleanParam(name, spec, v, ctx) {
  if (v === undefined || v === null || v === '') {
    if (spec.required) throw invalid(`params.${name}`, 'required');
    return undefined;
  }
  switch (spec.type) {
    case 'project': { const r = resolveProject(v, ctx); if (!r) throw invalid(`params.${name}`, 'unknown project'); return r; }
    case 'team': { const r = resolveTeam(v, ctx); if (!r) throw invalid(`params.${name}`, 'unknown team'); return r; }
    case 'person': { const r = resolvePerson(v, ctx); if (!r) throw invalid(`params.${name}`, 'unknown person'); return r; }
    case 'quarter': {
      const qs = computedOf(ctx).wl.quarters;
      const s = String(v).trim().toUpperCase();
      const k = /^\d{4}-Q[1-4]$/.test(s) ? s : quarterIn(fold(String(v)), ctx);
      if (!k || !qs.includes(k)) throw invalid(`params.${name}`, 'quarter outside the waterline');
      return k;
    }
    case 'weeks': case 'percent': case 'number': {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').replace(/\s*(%|w|wochen|weeks?)$/i, ''));
      if (!Number.isFinite(n)) throw invalid(`params.${name}`, 'number');
      const lo = spec.min ?? (spec.type === 'weeks' ? 1 : 0), hi = spec.max ?? (spec.type === 'weeks' ? 12 : 1e6);
      if (n < lo || n > hi) throw invalid(`params.${name}`, `${lo}–${hi}`);
      return spec.type === 'weeks' ? Math.round(n) : Math.round(n * 10) / 10;
    }
    case 'enum': { if (!spec.values.includes(v)) throw invalid(`params.${name}`, `one of ${spec.values.join('|')}`); return v; }
    case 'flag': { if (typeof v !== 'boolean') throw invalid(`params.${name}`, 'true|false'); return v; }
    case 'text': { if (typeof v !== 'string' || v.length > (spec.max || 200)) throw invalid(`params.${name}`, 'text'); return v.trim().slice(0, spec.max || 200); }
    case 'blocks': { const list = [...new Set([].concat(v))]; if (!list.length || !list.every((b) => (spec.values || BLOCKS).includes(b))) throw invalid(`params.${name}`, 'blocks'); return list; }
    case 'args': { const c = COMMANDS[spec.command]; if (!c) throw invalid(`params.${name}`); if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid(`params.${name}`, 'object'); return c.validate(v, ctx); }
    case 'query': { if (typeof v === 'string') { const q = parseQuerySyntax(v, ctx); if (!q) throw invalid(`params.${name}`, 'query text'); return q; } return cleanQuery(v, ctx); }
    default: throw invalid(`params.${name}`);
  }
}
// unknown params are refused (nothing passes through unchecked)
export function cleanParams(tool, params, ctx) {
  const t = typeof tool === 'string' ? toolOf(tool) : tool;
  if (!t) throw invalid('tool');
  const p = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  for (const k of Object.keys(p)) if (!Object.hasOwn(t.params, k)) throw invalid(`params.${k}`, 'unknown parameter');
  const out = {};
  for (const [k, spec] of Object.entries(t.params)) { const v = cleanParam(k, spec, p[k], ctx); if (v !== undefined) out[k] = v; }
  return out;
}
// the query a query tool stands for (a preset with its params, or the own query)
export function queryOfTool(t, params = {}) {
  if (t.id === 'query') return params.query;
  const base = PRESETS[t.preset];
  const where = base.where.map((w) => ({ ...w, ...(params.threshold != null && typeof w.v === 'number' ? { v: params.threshold } : {}) }));
  const window = { ...(base.window || {}) };
  if (params.next != null) window.next = params.next;
  if (params.past != null) window.past = params.past;
  if ('quarter' in window) window.quarter = params.quarter || null;
  const scope = params.project ? { kind: 'project', ref: params.project } : params.team ? { kind: 'team', ref: params.team } : null;
  return { entity: base.entity, where, ...(Object.keys(window).length ? { window } : {}), ...(scope ? { scope } : {}) };
}
