// Lotse – the report composer's engine: drafts a whole report document (C-level, steering committee, team, project)
// from VERIFIED data. Every sentence is either a Lotse story sentence that passes the strict cross-check, or a template
// whose numbers are facts of the section. Numbers live in the text as tokens ({{id}}) that point at the section's facts:
// the UI shows them as protected chips, the PDF and the copy text write their display. Pure, deterministic, DE + EN.
//
//   draftReport({ ctx, audience, period, sections?, projectRef?, teamId?, lang }) → Doc
//   draftSection(id, opts)       → one section (the "add section" menu)
//   rephrase(section)            → the next rule-based phrasing (variants are drafted up front)
//   plainText(section|text, facts?) / docText(doc) / summaryText(doc)   → text with every token written out
//   checkSection(section)        → claims in the text that are NOT backed by the section's facts ([] = all true)
//
// Doc = { v, audience, lang, period: { quarter, label }, projectRef, teamId, title, subtitle, asOf,
//         sections: [{ id, kind, title, on, text, variants, variant, facts, data, story?, entities, keys, tone }] }
// kind: 'summary' | 'kpis' | 'story' | 'chart' | 'table' | 'risks' | 'text'   (decisions are part of 'risks')
// fact: { id, label, value, unit: 'h'|'%'|'d'|'n'|'eur'|'rank'|'quarter'|'date', display }   ('%' = percent POINTS)
import { computeAll, cLevelReport } from '../../engine.js';
import { reportKpis } from '../../reportKpis.js';
import { teamIds } from '../../team.js';
import { SKILLS } from '../skills/index.js';
import { busiestTeam } from '../skills/teamBrief.js';
import { urgentProject, ooOf, pctPts, r1 } from '../kit.js';
import { localFmt, T, hash } from '../narrate.js';
import { crossCheck, textClaims } from '../crosscheck.js';
import { storyFacts } from '../story.js';

export const DOC_VERSION = 1;
export const AUDIENCES = ['c-level', 'steering', 'team', 'project'];
export const SECTION_IDS = ['summary', 'kpis', 'portfolio', 'waterline', 'late', 'capacity', 'planActual', 'support', 'blockers', 'risks', 'project', 'team'];
export const PRESETS = Object.freeze({
  'c-level': ['summary', 'kpis', 'portfolio', 'waterline', 'late', 'capacity', 'support', 'risks'],
  steering: ['summary', 'kpis', 'late', 'waterline', 'planActual', 'capacity', 'blockers', 'risks'],
  team: ['summary', 'team', 'capacity', 'waterline', 'planActual', 'blockers', 'risks'],
  project: ['summary', 'project', 'blockers', 'late', 'waterline', 'risks'],
});
const KIND = { summary: 'summary', kpis: 'kpis', portfolio: 'story', waterline: 'chart', late: 'table', capacity: 'chart', planActual: 'chart', support: 'story', blockers: 'story', risks: 'risks', project: 'story', team: 'story', text: 'text' };

export const audienceName = (a, L) => ({ 'c-level': T(L, 'Geschäftsführung', 'Management'), steering: T(L, 'Lenkungskreis', 'Steering committee'), team: 'Team', project: T(L, 'Projekt', 'Project') }[a] || a);

// The menu of sections Lotse can write (title + one line what it holds).
export function sectionCatalog(lang = 'de') {
  const L = lang === 'en' ? 'en' : 'de';
  return [
    ['summary', T(L, 'Zusammenfassung', 'Executive summary'), T(L, 'Die Lage in wenigen Sätzen mit echten Zahlen', 'The situation in a few sentences with real numbers')],
    ['kpis', T(L, 'Kennzahlen', 'Key figures'), T(L, 'Die sechs Kennzahlen des C-Level-Reports', 'The six key figures of the C-level report')],
    ['portfolio', T(L, 'Projekte nach Rang', 'Projects by rank'), T(L, 'Fortschritt und Terminlage je Projekt', 'Progress and schedule per project')],
    ['waterline', T(L, 'Wasserlinie', 'Waterline'), T(L, 'Ab welchem Rang die Kapazität nicht reicht', 'From which rank capacity runs out')],
    ['late', T(L, 'Verzug und Terminrisiken', 'Late and at-risk projects'), T(L, 'Projekte über dem Termin oder gefährdet', 'Projects past due or at risk')],
    ['capacity', T(L, 'Kapazität und Überstunden', 'Capacity and overtime'), T(L, 'Wo die nächsten Wochen zu voll sind', 'Where the coming weeks are too full')],
    ['planActual', T(L, 'Plan vs. Ist', 'Plan vs. actual'), T(L, 'Wohin die geplante Zeit floss', 'Where the planned time went')],
    ['support', T(L, 'Support und SLA', 'Support and SLA'), T(L, 'SLA-Quote und wiederkehrende Themen', 'SLA rate and recurring topics')],
    ['blockers', T(L, 'Blockaden und Abhängigkeiten', 'Blockers and dependencies'), T(L, 'Was blockiert ist und wo Termine kollidieren', 'What is blocked and where dates collide')],
    ['risks', T(L, 'Risiken und Entscheidungen', 'Risks and decisions needed'), T(L, 'Was die Runde entscheiden muss', 'What the meeting has to decide')],
    ['project', T(L, 'Projekt-Lagebild', 'Project briefing'), T(L, 'Ein Projekt im Detail', 'One project in detail')],
    ['team', T(L, 'Team-Lagebild', 'Team briefing'), T(L, 'Ein Team im Detail', 'One team in detail')],
    ['text', T(L, 'Eigener Text', 'Own text'), T(L, 'Ein freier Abschnitt für deine Notizen', 'A free section for your notes')],
  ].map(([id, title, desc]) => ({ id, title, desc }));
}

// ---------- facts and tokens ----------
const TOKEN_RE = /\{\{([A-Za-z0-9_.:-]{1,60})\}\}/g;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
function display(value, unit, L, dat = false) {
  const F = localFmt(L);
  switch (unit) {
    case 'h': return `${F.n(value, Math.abs(value) < 10 && !Number.isInteger(value) ? 1 : 0)} h`;
    case '%': return L === 'en' ? `${F.n(value)}%` : `${F.n(value)} %`;
    case 'd': return L === 'en' ? `${F.n(value)} ${value === 1 ? 'day' : 'days'}` : `${F.n(value)} ${value === 1 ? 'Tag' : dat ? 'Tagen' : 'Tage'}`;
    case 'eur': return `${F.n(value)} €`;
    case 'rank': return `${T(L, 'Rang', 'rank')} ${value}`;
    case 'quarter': return F.quarter(value);
    case 'date': { const [y, m, d] = String(value).split('-'); return L === 'en' ? `${+d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]} ${y}` : `${d}.${m}.${y}`; }
    default: return F.n(value, Number.isInteger(value) ? 0 : 1);
  }
}
// A fact collector for one section: fx() registers a fact and returns its token (null when there is no value).
function collector(L, prefix = '') {
  const facts = [], keys = [];
  const fx = (id, label, value, unit, { dat = false } = {}) => {
    if (unit === 'quarter' ? !/^\d{4}-Q[1-4]$/.test(String(value)) : unit === 'date' ? !/^\d{4}-\d{2}-\d{2}$/.test(String(value)) : !isNum(value)) return null;
    const v = isNum(value) ? (unit === 'h' ? Math.round(value) : unit === '%' || unit === 'd' || unit === 'rank' ? Math.round(value) : Math.round(value * 10) / 10) : value;
    const fid = `${prefix}${id}${dat ? '.dat' : ''}`;
    const old = facts.find((f) => f.id === fid);
    if (!old) facts.push({ id: fid, label: String(label || id).slice(0, 80), value: v, unit, display: display(v, unit, L, dat) });
    return `{{${fid}}}`;
  };
  return { facts, keys, fx };
}
export function plainText(x, facts) {
  const text = typeof x === 'string' ? x : x?.text || '';
  const fs = facts || x?.facts || [];
  const by = new Map(fs.map((f) => [f.id, f]));
  return String(text).replace(TOKEN_RE, (_, id) => by.get(id)?.display ?? '');
}
export const tokensOf = (text) => [...String(text || '').matchAll(TOKEN_RE)].map((m) => m[1]);

// A Lotse sentence → a template: every verified number / percentage / rank / quarter / date becomes a token. A sentence
// with a claim the story does not back, or with a person's name, is dropped (null) – the report names nobody.
function tokenise(sentence, story, col, prefix, L, { partial = false } = {}) {
  const s = String(sentence || '').trim();
  if (!s) return null;
  const ents = story.entities || {};
  if ((ents.people || []).some((p) => p.name && s.includes(p.name))) return null;
  const cc = crossCheck(story, s, { derived: false, strict: true, lang: L });
  if (!partial && cc.claims.some((c) => c.verified !== true && c.kind !== 'week')) return null;
  const { claims } = textClaims(s, { lang: L, entities: ents });
  claims.forEach((c, k) => { c.ok = cc.claims[k]?.verified === true; });
  const sf = storyFacts(story, { derived: false });
  let out = '', at = 0, i = 0;
  for (const c of claims) {
    if (c.kind === 'key' && col.keys && !col.keys.includes(c.found)) col.keys.push(c.found);
    if (!['number', 'percent', 'rank', 'quarter', 'date'].includes(c.kind) || !c.ok) continue;
    if (c.at < at || s.slice(c.at, c.at + c.text.length) !== c.text) continue;
    let value = c.found, unit;
    if (c.kind === 'rank') unit = 'rank';
    else if (c.kind === 'quarter') { unit = 'quarter'; if (!/^\d{4}-Q/.test(value)) value = [...sf.quarters].find((q) => q.endsWith(value)) || value; }
    else if (c.kind === 'date') { unit = 'date'; const md = `${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`; value = c.y ? `${c.y}-${md}` : [...sf.dates].find((d) => d.slice(5) === md) || null; }
    else unit = c.unit === '%' ? '%' : c.unit === 'h' ? 'h' : c.unit === 'd' ? 'd' : c.unit === 'eur' ? 'eur' : 'n';
    const fid = `${prefix}${i++}`;
    if (value == null) continue;
    col.facts.push({ id: fid, label: c.kind === 'rank' ? T(L, 'Rang', 'rank') : unit === 'quarter' ? T(L, 'Quartal', 'quarter') : unit === 'date' ? T(L, 'Datum', 'date') : T(L, 'Wert aus Lotse', 'value from Lotse'), value, unit, display: c.text });
    out += `${s.slice(at, c.at)}{{${fid}}}`;
    at = c.at + c.text.length;
  }
  return out + s.slice(at);
}

// ---------- the environment: one computation, every story once ----------
function makeEnv(opts) {
  const ctx0 = opts.ctx || {};
  const L = (opts.lang || ctx0.lang) === 'en' ? 'en' : 'de';
  const computed = ctx0.computed || computeAll(ctx0.ds);
  // the local formatter (never the app's global one): the report's language may differ from the app's
  const ctx = { ...ctx0, computed, lang: L, fmt: null };
  const { model, wl } = computed;
  const ds = ctx0.ds || model.ds;
  const asOf = new Date(Number.isFinite(ctx0.now) ? ctx0.now : Date.now()).toISOString();
  let report = ctx0.report || null;
  if (!report) { try { report = { ...cLevelReport(ds), asOf }; } catch { report = { asOf, today: ds?.today, kpis: {}, rows: [] }; } }
  const v = (() => { try { return reportKpis({ report, computed, planActual: ctx0.planActual || null, lang: L, cfg: ds?.config || null }); } catch { return null; } })();
  const p = opts.period;
  const quarter = typeof p === 'string' && wl.quarters.includes(p) ? p : p === 'next' ? wl.quarters[1] || wl.quarters[0] : p?.quarter && wl.quarters.includes(p.quarter) ? p.quarter : wl.quarters[0];
  const teams = teamIds(computed);
  const teamId = opts.teamId && (teams.includes(opts.teamId) || model.teams.has(opts.teamId)) ? opts.teamId : opts.audience === 'team' ? busiestTeam(ctx) || teams[0] || null : opts.teamId || null;
  const project = (opts.projectRef && model.itemByRef.get(opts.projectRef)) || (opts.audience === 'project' ? urgentProject(ctx) : null);
  const memo = new Map();
  const story = (skill, params = {}) => {
    const k = `${skill}|${JSON.stringify(params)}`;
    if (!memo.has(k)) { let s = null; try { s = SKILLS[skill].run(ctx, params, L); } catch { s = null; } memo.set(k, s); }
    return memo.get(k);
  };
  const allProjects = model.items.map((it) => ({ ref: it.ref, key: it.key || null, rank: it.rank ?? null, name: it.name }));
  const allTeams = [...model.teams.values()].filter((t) => t.id !== '_none').map((t) => ({ id: t.id, name: t.name }));
  return { ctx, L, computed, model, wl, ds, report, v, quarter, teamId, project, audience: AUDIENCES.includes(opts.audience) ? opts.audience : 'c-level', story, asOf: report?.asOf || asOf, entities: { projects: allProjects, teams: allTeams, people: [] } };
}
const teamNameOf = (env, id) => env.model.teams.get(id)?.name || id;

// ---------- section builders ----------
function base(env, id, title, extra = {}) {
  return { id, kind: KIND[id] || 'text', title, on: true, text: '', variants: [], variant: 0, facts: [], data: {}, entities: env.entities, keys: [], tone: 'info', ...extra };
}
// variants: arrays of sentences (templates); empty sentences drop out; the first variant is the default.
function finish(sec, col, variants, seed) {
  const vs = variants.map((v) => v.filter(Boolean).join(sec.kind === 'risks' ? '\n' : ' ').trim()).filter(Boolean);
  const uniq = [...new Set(vs)];
  sec.facts = col.facts;
  sec.variants = uniq.length ? uniq : [''];
  sec.variant = 0;
  sec.text = sec.variants[0];
  sec.seed = seed;
  // only the facts some variant uses (the chips) – plus every fact the data shows
  const used = new Set(uniq.flatMap(tokensOf));
  sec.facts = col.facts.filter((f) => used.has(f.id) || f.keep);
  sec.keys = [...new Set([...(sec.keys || []), ...(col.keys || [])])];
  return sec;
}
// a story section: the story's visual + KPIs, narrative = its sentences as templates
function storySection(env, id, title, s, { lead = [] } = {}) {
  const L = env.L;
  const sec = base(env, id, title);
  const col = collector(L, `${id}.`);
  if (!s) return finish({ ...sec, tone: 'info' }, col, [[T(L, 'Für diesen Abschnitt liegen gerade keine Daten vor.', 'There is no data for this section right now.')]], id);
  if (s.skill === 'planActualExplain' && s.tone !== 'info' && !(s.kpis.find((k) => k.id === 'plan')?.value > 0)) {
    return finish({ ...sec, tone: 'info', on: false }, col, [[T(L, 'Für diese Auswahl gibt es im Zeitraum keine geplanten Stunden – Plan vs. Ist bleibt leer.', 'There are no planned hours for this selection in the period – plan vs. actual stays empty.')]], id);
  }
  sec.story = s;
  sec.tone = s.tone;
  sec.data = { visual: s.visual, kpis: s.kpis };
  sec.entities = mergeEntities(env.entities, s.entities);
  let n = 0;
  const tk = (text) => tokenise(text, s, col, `${id}.s${n++}.`, L);
  const head = tk(s.headline);
  const hp = plainText(head || '', col.facts).toLowerCase();
  const fs = s.findings.map((f) => tk(f.text)).filter(Boolean);
  const fresh = fs.filter((f) => !hp.includes(plainText(f, col.facts).replace(/[.!]$/, '').toLowerCase()));
  const leadT = lead.filter(Boolean);
  const v0 = [...leadT, head, fresh[0]];
  const v1 = [...leadT, ...fs.slice(0, 2)];
  const v2 = [...leadT, head, ...fresh.slice(0, 3)];
  return finish(sec, col, [v0, v1, v2], s.id);
}
function mergeEntities(a, b) {
  const out = { projects: [...(a?.projects || [])], teams: [...(a?.teams || [])], people: [] };
  for (const p of b?.projects || []) if (!out.projects.some((x) => x.ref === p.ref || (x.name === p.name && x.rank === p.rank))) out.projects.push(p);
  for (const t of b?.teams || []) if (!out.teams.some((x) => x.name === t.name)) out.teams.push(t);
  if (b?.texts?.length) out.texts = [...b.texts];
  return out;
}

const plural = (n, one, many) => (n === 1 ? one : many);

function kpisSection(env) {
  const { L, v } = env;
  const sec = base(env, 'kpis', T(L, 'Kennzahlen', 'Key figures'));
  const col = collector(L, 'kpis.');
  if (!v) return finish(sec, col, [[T(L, 'Der Report-Stand ist noch nicht berechnet.', 'The report snapshot has not been computed yet.')]], 'kpis');
  const t = Object.fromEntries(v.tiles.map((x) => [x.id, x]));
  const pts = (x) => (isNum(x) ? pctPts(x) : null);
  const tok = {
    projects: col.fx('projects', t.projects.label, t.projects.value, 'n'),
    progress: col.fx('progress', t.progress.label, pts(t.progress.value), '%'),
    overdue: col.fx('overdue', T(L, 'Vorgänge über Due Date', 'Items past due'), t.schedule.value, 'n'),
    util: col.fx('util', t.util.label, pts(t.util.value), '%'),
    weeks: col.fx('weeks', T(L, 'Wochen', 'weeks'), 4, 'n'),
    asPlanned: t.asPlanned.kind === 'pct' ? col.fx('asPlanned', t.asPlanned.label, pts(t.asPlanned.value), '%') : null,
    sla: t.support.kind === 'pct' ? col.fx('sla', T(L, 'SLA-Quote', 'SLA rate'), pts(t.support.value), '%') : null,
  };
  for (const f of col.facts) f.keep = true;
  sec.tone = v.tiles.some((x) => x.tone === 'bad') ? 'bad' : v.tiles.some((x) => x.tone === 'warn') ? 'warn' : 'ok';
  sec.data = { tiles: v.tiles.map((x) => ({ id: x.id, label: x.label, display: x.display, sub: x.sub, tone: x.tone || null, kind: x.kind })) };
  const s1 = tok.progress && tok.projects && tok.overdue ? T(L, `${tok.progress} Fortschritt über ${tok.projects} aktive Projekte, ${tok.overdue} Vorgänge über dem Due Date.`, `${tok.progress} progress across ${tok.projects} active projects, ${tok.overdue} work items past their due date.`) : null;
  const s2 = tok.util ? T(L, `Auslastung der nächsten ${tok.weeks} Wochen: ${tok.util}${tok.sla ? `, SLA-Quote ${tok.sla}` : ''}${tok.asPlanned ? `, ${tok.asPlanned} der Zeit lief wie geplant` : ''}.`, `Utilisation of the next ${tok.weeks} weeks: ${tok.util}${tok.sla ? `, SLA rate ${tok.sla}` : ''}${tok.asPlanned ? `, ${tok.asPlanned} of the time went as planned` : ''}.`) : null;
  const s1b = tok.projects && tok.progress ? T(L, `Im Portfolio laufen ${tok.projects} Projekte; gemeinsam stehen sie bei ${tok.progress}.`, `The portfolio runs ${tok.projects} projects; together they stand at ${tok.progress}.`) : null;
  return finish(sec, col, [[s1, s2], [s1b, s2], [s2, s1]], 'kpis');
}

function lateSection(env) {
  const { L, v, project } = env;
  const sec = base(env, 'late', T(L, 'Verzug und Terminrisiken', 'Late and at-risk projects'));
  const col = collector(L, 'late.');
  if (!v) return finish(sec, col, [[T(L, 'Der Report-Stand ist noch nicht berechnet.', 'The report snapshot has not been computed yet.')]], 'late');
  const rows = v.rows.filter((x) => !project || x.ref === project.ref);
  const hit = rows.filter((x) => x.term.tone !== 'ok' || x.health === 'critical')
    .sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0) || a.rank - b.rank);
  const late = rows.filter((x) => x.daysOverdue > 0);
  const risk = rows.filter((x) => !(x.daysOverdue > 0) && x.term.tone === 'warn');
  sec.tone = late.length ? 'bad' : risk.length ? 'warn' : 'ok';
  const F = localFmt(L);
  sec.data = {
    columns: [T(L, 'Rang', 'Rank'), T(L, 'Projekt', 'Project'), 'Health', 'Due Date', T(L, 'Fortschritt', 'Progress'), T(L, 'Termin', 'Schedule')],
    align: ['c', 'l', 'l', 'l', 'r', 'l'],
    rows: hit.slice(0, 12).map((x) => ({ tone: x.term.tone === 'bad' || x.health === 'critical' ? 'bad' : 'warn', cells: [String(x.rank), x.name, ({ onTrack: T(L, 'im Plan', 'on track'), atRisk: T(L, 'gefährdet', 'at risk'), critical: T(L, 'kritisch', 'critical') }[x.health] || T(L, 'kein Update', 'no update')), x.due ? display(x.due, 'date', L) : '–', isNum(x.progress) ? F.pct(x.progress) : '–', x.term.text] })),
    empty: T(L, 'Kein Projekt ist über dem Termin oder gefährdet.', 'No project is past due or at risk.'),
  };
  const all = col.fx('active', T(L, 'Aktive Projekte', 'Active projects'), rows.length, 'n');
  const soft = rows.filter((x) => x.term.tone === 'soft');
  if (!late.length && !risk.length) {
    const nS = col.fx('soft', T(L, 'Projekte mit Vorgängen über Due', 'Projects with items past due'), soft.length, 'n');
    return finish(sec, col, [[soft.length ? T(L, `Kein Projekt ist über seinem Termin; bei ${nS} ${plural(soft.length, 'Projekt sind', 'Projekten sind')} einzelne Vorgänge über dem Due Date.`, `No project is past its due date; ${nS} ${plural(soft.length, 'project has', 'projects have')} single work items past due.`)
      : project ? T(L, `${project.name} hält seinen Termin.`, `${project.name} is on schedule.`) : T(L, `Alle ${all} Projekte halten ihren Termin.`, `All ${all} projects are on schedule.`)]], 'late');
  }
  if (!hit.length) return finish(sec, col, [[project ? T(L, `${project.name} hält seinen Termin.`, `${project.name} is on schedule.`) : T(L, `Alle ${all} Projekte halten ihren Termin.`, `All ${all} projects are on schedule.`)]], 'late');
  const nL = col.fx('late', T(L, 'Projekte über Termin', 'Projects past due'), late.length, 'n');
  const nR = col.fx('risk', T(L, 'Projekte gefährdet', 'Projects at risk'), risk.length, 'n');
  const w = late[0] ? [...late].sort((a, b) => b.daysOverdue - a.daysOverdue)[0] : null;
  const wd = w ? col.fx('worstDays', T(L, 'Tage über Termin', 'days past due'), w.daysOverdue, 'd') : null;
  const r0 = risk[0];
  const rr = r0 ? col.fx('riskRank', T(L, 'Rang', 'rank'), r0.rank, 'rank') : null;
  const s1 = late.length ? T(L, `${nL} ${plural(late.length, 'Projekt ist', 'Projekte sind')} über dem Termin${risk.length ? `, ${nR} weitere gefährdet` : ''}.`, `${nL} ${plural(late.length, 'project is', 'projects are')} past due${risk.length ? `, ${nR} more at risk` : ''}.`)
    : T(L, `Kein Projekt ist über dem Termin, aber ${nR} ${plural(risk.length, 'ist', 'sind')} gefährdet.`, `No project is past due, but ${nR} ${plural(risk.length, 'is', 'are')} at risk.`);
  const s2 = w ? T(L, `Am weitesten zurück liegt ${w.name}: ${wd} über dem Termin.`, `Furthest behind is ${w.name}, ${wd} past due.`) : null;
  const s3 = r0 ? T(L, `Gefährdet ist zuerst ${r0.name} auf ${rr}: ${r0.term.text}.`, `First at risk is ${r0.name} at ${rr}: ${r0.term.text}.`) : null;
  const s2b = w ? T(L, `${w.name} ist ${wd} über dem Termin – das größte Terminrisiko im Portfolio.`, `${w.name} is ${wd} past due – the largest schedule risk in the portfolio.`) : null;
  return finish(sec, col, [[s1, s2, s3], [s2b, s1], [s1, s3]], 'late');
}

// What the meeting has to decide: capacity gaps, the latest project, overtime, blockers, conflicts, SLA.
function riskItems(env, col) {
  const { L, computed, wl, model, quarter, teamId, project } = env;
  const items = [];
  // 1 · capacity: the team with the largest gap in the quarter
  const cells = (teamId ? [teamId] : teamIds(computed)).map((t) => ({ t, c: wl.cells[t]?.[quarter] })).filter((x) => x.c && x.c.demand > x.c.capacity + 0.5)
    .map((x) => ({ ...x, miss: x.c.demand - x.c.capacity })).sort((a, b) => b.miss - a.miss);
  const pq = project ? wl.projectQ[project.ref]?.[quarter] : null;
  const cap = project ? (pq && pq.status !== 'ok' ? { t: pq.teams.filter((t) => t.status !== 'ok').sort((a, b) => (b.demand - b.staffed) - (a.demand - a.staffed))[0] } : null) : cells[0] || null;
  if (cap?.t) {
    const tid = project ? cap.t.teamId : cap.t;
    const miss = project ? cap.t.demand - cap.t.staffed : cap.miss;
    const first = project || (cap.c?.waterRank != null ? model.items.find((it) => it.rank === cap.c.waterRank) : null);
    const tn = tid && tid !== '_none' ? teamNameOf(env, tid) : null;
    const q = col.fx('r.q', T(L, 'Quartal', 'quarter'), quarter, 'quarter');
    const m = col.fx('r.miss', T(L, 'Fehlende Stunden', 'Missing hours'), r1(miss), 'h');
    const rk = first ? col.fx('r.rank', T(L, 'Rang', 'rank'), first.rank, 'rank') : null;
    if (m) items.push({ id: 'capacity', tone: 'bad', title: T(L, 'Kapazität', 'Capacity'),
      text: first ? T(L, `In ${q} ist ${first.name} (${rk}) nicht voll besetzbar${tn ? ` – Team ${tn} fehlen ${m}` : ` – es fehlen ${m}`}.`, `In ${q} ${first.name} (${rk}) cannot be fully staffed${tn ? ` – team ${tn} is short ${m}` : ` – ${m} are missing`}.`)
        : T(L, `In ${q} fehlen${tn ? ` Team ${tn}` : ''} ${m}.`, `In ${q}${tn ? ` team ${tn} is` : ''} short ${m}.`),
      decision: first ? T(L, `${m} zusätzlich${tn ? ` für Team ${tn}` : ''} beschaffen oder ${first.name} später starten?`, `Find ${m} more${tn ? ` for team ${tn}` : ''} or start ${first.name} later?`) : T(L, `${m} Kapazität beschaffen oder Umfang kürzen?`, `Find ${m} of capacity or cut scope?`) });
  }
  // 2 · the latest project
  const late = (env.v?.rows || []).filter((x) => x.daysOverdue > 0 && (!project || x.ref === project.ref)).sort((a, b) => b.daysOverdue - a.daysOverdue)[0];
  if (late && !teamId) {
    const d = col.fx('r.late', T(L, 'Tage über Termin', 'days past due'), late.daysOverdue, 'd');
    items.push({ id: 'late', tone: 'bad', title: T(L, 'Termin', 'Schedule'), text: T(L, `${late.name} liegt ${d} über dem Termin.`, `${late.name} is ${d} past due.`),
      decision: T(L, `Neuen Termin für ${late.name} festlegen – ${d} Verzug – oder Umfang kürzen?`, `Set a new date for ${late.name} – ${d} late – or cut scope?`) });
  }
  // 3 · overtime: the most loaded team and what would relieve it
  try {
    const oo = ooOf(env.ctx, L);
    const ot = (teamId ? oo.teams.filter((t) => t.teamId === teamId) : oo.teams)[0];
    if (ot && !project) {
      const h = col.fx('r.ot', T(L, 'Stunden zu viel', 'Hours too many'), r1(ot.hours), 'h');
      const wk = col.fx('r.otw', T(L, 'Wochen über voller Kapazität', 'weeks above full capacity'), ot.overWeeks.length, 'n');
      const nw = col.fx('r.otn', T(L, 'Wochen', 'weeks'), oo.weeks.length, 'n');
      const mv = ot.move?.[0];
      const mh = mv ? col.fx('r.mvh', T(L, 'verschieben', 'move'), r1(mv.hours), 'h') : null;
      items.push({ id: 'overtime', tone: 'warn', title: T(L, 'Überlast', 'Overload'), text: T(L, `Team ${ot.name} ist in ${wk} von ${nw} Wochen über voller Kapazität, zusammen ${h} zu viel.`, `Team ${ot.name} is above full capacity in ${wk} of ${nw} weeks, ${h} too much in total.`),
        decision: mv ? T(L, `${mv.name} (${mh}) verschieben, um Team ${ot.name} zu entlasten?`, `Move ${mv.name} (${mh}) to relieve team ${ot.name}?`) : T(L, `Team ${ot.name} um ${h} entlasten – wer übernimmt?`, `Relieve team ${ot.name} of ${h} – who takes it over?`) });
    }
  } catch { /* overtime is optional */ }
  // 4 · blockers
  const deps = computed.deps;
  const get = (id) => model.byId.get(id) || model.external.get(id);
  const inScope = (id) => { const i = get(id); return i && (!project || i.rootRef === project.ref) && (!teamId || i.team?.id === teamId || i.teamId === teamId); };
  const blocked = (deps.blocked || []).filter((b) => inScope(b.id));
  if (blocked.length) {
    const oldest = [...blocked].filter((b) => b.days != null).sort((a, b) => b.days - a.days)[0];
    const it = oldest ? get(oldest.id) : null;
    const nb = col.fx('r.blocked', T(L, 'Blockiert', 'Blocked'), blocked.length, 'n');
    const od = oldest ? col.fx('r.bdays', T(L, 'Tage blockiert', 'days blocked'), oldest.days, 'd', { dat: L !== 'en' }) : null;
    items.push({ id: 'blockers', tone: oldest?.days > 7 ? 'bad' : 'warn', title: T(L, 'Blockaden', 'Blockers'),
      text: T(L, `${nb} ${plural(blocked.length, 'Vorgang ist', 'Vorgänge sind')} blockiert${od ? `, der älteste seit ${od}` : ''}.`, `${nb} work ${plural(blocked.length, 'item is', 'items are')} blocked${od ? `, the oldest for ${od}` : ''}.`),
      decision: it?.key && od ? T(L, `Blockade von ${it.key} eskalieren – seit ${od} offen?`, `Escalate the blocker on ${it.key} – open for ${od}?`) : T(L, `${nb} blockierte Vorgänge eskalieren?`, `Escalate ${nb} blocked work items?`), keys: it?.key ? [it.key] : [] });
  }
  // 5 · schedule conflicts between dependent work
  const conflicts = (deps.list || []).filter((d) => d.conflict && (inScope(d.pre) || inScope(d.dep)));
  if (conflicts.length) {
    const nc = col.fx('r.conf', T(L, 'Terminkonflikte', 'Schedule conflicts'), conflicts.length, 'n');
    const top = [...conflicts].sort((a, b) => (b.conflictDays || 0) - (a.conflictDays || 0))[0];
    const cd = col.fx('r.cdays', T(L, 'Tage Überschneidung', 'days of overlap'), top.conflictDays, 'd');
    items.push({ id: 'conflicts', tone: 'warn', title: T(L, 'Abhängigkeiten', 'Dependencies'),
      text: T(L, `${nc} ${plural(conflicts.length, 'Terminkonflikt', 'Terminkonflikte')} zwischen abhängigen Aufgaben${cd ? `, bis zu ${cd} Überschneidung` : ''}.`, `${nc} schedule ${plural(conflicts.length, 'conflict', 'conflicts')} between dependent tasks${cd ? `, up to ${cd} of overlap` : ''}.`),
      decision: T(L, `Reihenfolge bei ${nc} ${plural(conflicts.length, 'Terminkonflikt', 'Terminkonflikten')} mit den Projektleitungen klären?`, `Settle the order of ${nc} colliding ${plural(conflicts.length, 'dependency', 'dependencies')} with the project leads?`) });
  }
  // 6 · SLA below target
  const sa = computed.supportSum;
  if (!project && !teamId && sa?.slaRate != null && sa.target != null && sa.slaRate < sa.target) {
    const r = col.fx('r.sla', T(L, 'SLA-Quote', 'SLA rate'), pctPts(sa.slaRate), '%');
    const tg = col.fx('r.slat', T(L, 'Ziel', 'target'), pctPts(sa.target), '%');
    items.push({ id: 'sla', tone: 'warn', title: 'Support', text: T(L, `Die SLA-Quote liegt mit ${r} unter dem Ziel von ${tg}.`, `The SLA rate of ${r} is below the ${tg} target.`),
      decision: T(L, `Support-Reserve erhöhen, um wieder ${tg} zu erreichen?`, `Raise the support reserve to get back to ${tg}?`) });
  }
  return items.slice(0, 5);
}
function risksSection(env) {
  const { L } = env;
  const sec = base(env, 'risks', T(L, 'Risiken und Entscheidungen', 'Risks and decisions needed'));
  const col = collector(L, 'risks.');
  const items = riskItems(env, col);
  for (const f of col.facts) f.keep = true;
  sec.keys = [...new Set(items.flatMap((x) => x.keys || []))];
  sec.data = { items: items.map(({ id, tone, title, text }) => ({ id, tone, title, text })) };
  sec.tone = items.some((x) => x.tone === 'bad') ? 'bad' : items.length ? 'warn' : 'ok';
  env.decisions = items;
  if (!items.length) {
    const n = col.fx('active', T(L, 'Aktive Projekte', 'Active projects'), env.v?.rows.length ?? env.model.items.length, 'n');
    return finish(sec, col, [[T(L, `Keine offene Entscheidung: alle ${n} Projekte sind im Plan und besetzbar.`, `No open decision: all ${n} projects are on track and staffable.`)]], 'risks');
  }
  const numbered = items.map((x, i) => `${i + 1}. ${x.decision}`);
  const prose = [T(L, `Zuerst: ${items[0].decision}`, `First: ${items[0].decision}`), ...(items[1] ? [T(L, `Danach: ${items[1].decision}`, `Then: ${items[1].decision}`)] : []), ...items.slice(2).map((x) => `– ${x.decision}`)];
  const short = items.slice(0, 3).map((x, i) => `${i + 1}. ${x.decision}`);
  return finish(sec, col, [numbered, prose, short], 'risks');
}

function summarySection(env, sections) {
  const { L, audience, v, quarter, project, teamId } = env;
  const sec = base(env, 'summary', T(L, 'Zusammenfassung', 'Executive summary'));
  const col = collector(L, 'sum.');
  let n = 0;
  const tk = (s, text) => (s && text ? tokenise(text, s, col, `sum.s${n++}.`, L) : null);
  const firstF = (s) => (s?.findings?.[0]?.text || null);
  const slots = [];
  if (audience === 'project' && project) {
    const pb = env.story('projectBrief', { ref: project.ref });
    const bl = env.story('blockers', { ref: project.ref });
    slots.push([tk(pb, pb?.headline)], [tk(pb, pb?.findings?.[1]?.text), tk(pb, firstF(pb))], [tk(bl, bl?.headline)]);
    sec.entities = mergeEntities(sec.entities, pb?.entities);
  } else if (audience === 'team' && teamId) {
    const tb = env.story('teamBrief', { team: teamId });
    const ot = env.story('overtime', { team: teamId });
    slots.push([tk(tb, tb?.headline), tk(tb, firstF(tb))], [tk(ot, ot?.headline), tk(ot, firstF(ot))]);
    sec.entities = mergeEntities(sec.entities, tb?.entities);
  } else {
    const t = v ? Object.fromEntries(v.tiles.map((x) => [x.id, x])) : null;
    if (t) {
      const a = col.fx('active', T(L, 'Aktive Projekte', 'Active projects'), t.projects.value, 'n');
      const p = col.fx('progress', T(L, 'Fortschritt', 'Progress'), isNum(t.progress.value) ? pctPts(t.progress.value) : null, '%');
      const lateRows = v.rows.filter((x) => x.daysOverdue > 0).sort((x, y) => y.daysOverdue - x.daysOverdue);
      const nl = col.fx('late', T(L, 'Projekte über Termin', 'Projects past due'), lateRows.length, 'n');
      const wd = lateRows[0] ? col.fx('lateDays', T(L, 'Tage über Termin', 'days past due'), lateRows[0].daysOverdue, 'd') : null;
      slots.push([
        p ? T(L, `${a} aktive Projekte, Gesamtfortschritt ${p}.`, `${a} active projects, overall progress ${p}.`) : null,
        p ? T(L, `Das Portfolio umfasst ${a} aktive Projekte und steht bei ${p} Fortschritt.`, `The portfolio holds ${a} active projects at ${p} progress.`) : null,
      ]);
      slots.push(lateRows.length ? [
        T(L, `${nl} ${plural(lateRows.length, 'Projekt ist', 'Projekte sind')} über dem Termin, am weitesten ${lateRows[0].name} (${wd}).`, `${nl} ${plural(lateRows.length, 'project is', 'projects are')} past due, furthest ${lateRows[0].name} by ${wd}.`),
        T(L, `${lateRows[0].name} liegt ${wd} hinter dem Termin; insgesamt ${plural(lateRows.length, 'ist', 'sind')} ${nl} ${plural(lateRows.length, 'Projekt', 'Projekte')} im Verzug.`, `${lateRows[0].name} is ${wd} behind schedule; ${nl} ${plural(lateRows.length, 'project is', 'projects are')} late in total.`),
      ] : [T(L, `Alle ${a} Projekte halten ihren Termin.`, `All ${a} projects are on schedule.`)]);
    }
    const wlS = env.story('waterline', { quarter });
    slots.push([tk(wlS, wlS?.headline), tk(wlS, firstF(wlS))]);
    const ot = env.story('overtime', {});
    slots.push([tk(ot, ot?.headline), tk(ot, firstF(ot))]);
    sec.entities = mergeEntities(sec.entities, wlS?.entities);
  }
  // the decision sentence: from the risks section (drafted first)
  const dec = env.decisions || [];
  if (dec.length) {
    const nd = col.fx('decisions', T(L, 'Entscheidungen', 'Decisions'), dec.length, 'n');
    const take = (tpl) => remap(tpl, sections.find((s) => s.id === 'risks')?.facts || env.riskFacts || [], col);
    const d0 = take(dec[0].decision);
    slots.push([
      T(L, `${nd} ${plural(dec.length, 'Entscheidung steht', 'Entscheidungen stehen')} an; die wichtigste: ${d0}`, `${nd} ${plural(dec.length, 'decision is', 'decisions are')} due; the most important: ${d0}`),
      T(L, `Zu entscheiden: ${d0}`, `To decide: ${d0}`),
    ]);
  }
  const pick = (slot, k) => { const xs = slot.filter(Boolean); return xs.length ? xs[k % xs.length] : null; };
  const v0 = slots.map((s) => pick(s, 0));
  const v1 = slots.map((s) => pick(s, 1));
  const v2 = [slots[0], slots[slots.length - 1]].filter(Boolean).map((s) => pick(s, 0));
  const tones = sections.filter((s) => s.id !== 'summary' && s.on !== false).map((s) => s.tone);
  sec.tone = tones.includes('bad') ? 'bad' : tones.includes('warn') ? 'warn' : 'ok';
  sec.keys = [...new Set((sections.find((x) => x.id === 'risks')?.keys || env.riskKeys || []))];
  return finish(sec, col, [v0, v1, v2], 'summary');
}
// tokens of one section's template, copied into another section's collector (same values, new ids)
function remap(tpl, from, col) {
  const by = new Map(from.map((f) => [f.id, f]));
  return String(tpl).replace(TOKEN_RE, (m, id) => {
    const f = by.get(id);
    if (!f) return '';
    const nid = `sum.${id}`;
    if (!col.facts.some((x) => x.id === nid)) col.facts.push({ ...f, id: nid, keep: false });
    return `{{${nid}}}`;
  });
}

function supportSection(env) {
  const { L, computed } = env;
  const s = env.story('supportTopics', {});
  const sa = computed.supportSum;
  const col0 = collector(L, 'support.k');
  const lead = [];
  if (sa?.slaRate != null) {
    const r = col0.fx('sla', T(L, 'SLA-Quote', 'SLA rate'), pctPts(sa.slaRate), '%');
    const tg = sa.target != null ? col0.fx('target', T(L, 'Ziel', 'target'), pctPts(sa.target), '%') : null;
    const br = isNum(sa.breaches) ? col0.fx('breaches', T(L, 'Offen über dem SLA', 'Open past SLA'), sa.breaches, 'n') : null;
    lead.push(T(L, `Die SLA-Quote liegt bei ${r}${tg ? ` (Ziel ${tg})` : ''}${br ? `; ${br} Tickets sind offen über dem SLA` : ''}.`, `The SLA rate is ${r}${tg ? ` (target ${tg})` : ''}${br ? `; ${br} tickets are open past their SLA` : ''}.`));
  }
  if (!s && !lead.length) {
    const sec = base(env, 'support', T(L, 'Support und SLA', 'Support and SLA'));
    return { ...finish(sec, col0, [[T(L, 'Für dieses Portfolio ist kein Support-Bereich konfiguriert.', 'No support area is configured for this portfolio.')]], 'support'), on: false };
  }
  const sec = storySection(env, 'support', T(L, 'Support und SLA', 'Support and SLA'), s, { lead });
  sec.facts = [...col0.facts, ...sec.facts];
  if (sa?.slaRate != null && sa.target != null && sa.slaRate < sa.target) sec.tone = sec.tone === 'bad' ? 'bad' : 'warn';
  return sec;
}

function buildSection(env, id, built = []) {
  const { L, quarter, teamId, project } = env;
  const F = localFmt(L);
  switch (id) {
    case 'kpis': return kpisSection(env);
    case 'late': return lateSection(env);
    case 'risks': return risksSection(env);
    case 'summary': return summarySection(env, built);
    case 'support': return supportSection(env);
    case 'portfolio': return storySection(env, 'portfolio', T(L, 'Projekte nach Rang', 'Projects by rank'), env.story('portfolioBrief', {}));
    case 'waterline': return storySection(env, 'waterline', T(L, `Wasserlinie ${F.quarter(quarter)}`, `Waterline ${F.quarter(quarter)}`), env.story('waterline', { quarter, ...(teamId && env.audience === 'team' ? { team: teamId } : {}) }));
    case 'capacity': return storySection(env, 'capacity', T(L, 'Kapazität und Überstunden', 'Capacity and overtime'), env.story('overtime', teamId && env.audience === 'team' ? { team: teamId } : {}));
    case 'planActual': return storySection(env, 'planActual', T(L, 'Plan vs. Ist', 'Plan vs. actual'), env.story('planActualExplain', teamId && env.audience === 'team' ? { team: teamId } : {}));
    case 'blockers': return storySection(env, 'blockers', T(L, 'Blockaden und Abhängigkeiten', 'Blockers and dependencies'), env.story('blockers', project ? { ref: project.ref } : {}));
    case 'project': {
      const it = project || urgentProject(env.ctx);
      return storySection(env, 'project', it ? it.name : T(L, 'Projekt-Lagebild', 'Project briefing'), it ? env.story('projectBrief', { ref: it.ref }) : null);
    }
    case 'team': {
      const tid = teamId || busiestTeam(env.ctx);
      return storySection(env, 'team', tid ? T(L, `Team ${teamNameOf(env, tid)}`, `Team ${teamNameOf(env, tid)}`) : T(L, 'Team-Lagebild', 'Team briefing'), tid ? env.story('teamBrief', { team: tid }) : null);
    }
    case 'text': return { ...base(env, 'text', T(L, 'Notiz', 'Note')), kind: 'text', text: '', variants: [''] };
    default: return null;
  }
}

function docTitle(env) {
  const { L, audience, project, teamId } = env;
  if (audience === 'project' && project) return T(L, `Projektbericht ${project.name}`, `Project report ${project.name}`);
  if (audience === 'team' && teamId) return T(L, `Lagebericht Team ${teamNameOf(env, teamId)}`, `Team ${teamNameOf(env, teamId)} status report`);
  if (audience === 'steering') return T(L, 'Bericht für den Lenkungskreis', 'Steering committee report');
  return T(L, 'Management-Report Portfolio', 'Management report portfolio');
}

// ---------- public API ----------
export function draftReport(opts = {}) {
  const env = makeEnv(opts);
  const { L } = env;
  const ids = (Array.isArray(opts.sections) && opts.sections.length ? opts.sections : PRESETS[env.audience]).filter((id) => SECTION_IDS.includes(id) || id === 'text' || /^text-\d+$/.test(id));
  // risks before summary (the summary names the most important decision); the order of the doc stays as asked
  const order = [...ids].sort((a, b) => (a === 'summary') - (b === 'summary') || (b === 'risks') - (a === 'risks'));
  const built = [];
  if (ids.includes('summary') && !ids.includes('risks')) { const col = collector(L, 'risks.'); env.decisions = riskItems(env, col); env.riskFacts = col.facts; env.riskKeys = env.decisions.flatMap((x) => x.keys || []); }
  for (const id of order) {
    const sec = buildSection(env, /^text-\d+$/.test(id) ? 'text' : id, built);
    if (!sec) continue;
    if (/^text-\d+$/.test(id)) sec.id = id;
    built.push(sec);
  }
  const sections = ids.map((id) => built.find((s) => s.id === id)).filter(Boolean);
  const F = localFmt(L);
  return {
    v: DOC_VERSION, audience: env.audience, lang: L, period: { quarter: env.quarter, label: F.quarter(env.quarter) },
    projectRef: env.project?.ref || null, teamId: env.teamId || null,
    title: docTitle(env),
    subtitle: `${audienceName(env.audience, L)} · ${F.quarter(env.quarter)}`,
    asOf: env.asOf,
    sections,
  };
}
// One section on its own ("add section"): same options as draftReport.
export function draftSection(id, opts = {}) {
  const env = makeEnv(opts);
  if (id === 'summary') { const col = collector(env.L, 'risks.'); env.decisions = riskItems(env, col); env.riskFacts = col.facts; env.riskKeys = env.decisions.flatMap((x) => x.keys || []); }
  return buildSection(env, id === 'text' || /^text-\d+$/.test(id) ? 'text' : id, []) || null;
}
// The next rule-based phrasing (a different variant of the same verified facts).
export function rephrase(sec) {
  const vs = sec?.variants || [];
  if (vs.length < 2) return sec;
  const cur = vs.indexOf(sec.text);
  const k = ((cur >= 0 ? cur : sec.variant || 0) + 1) % vs.length;
  return { ...sec, variant: k, text: vs[k] };
}
// Which claims of the section's text are not backed by its facts (numbers typed by hand, a wrong quarter …).
export function checkSection(sec) {
  const text = plainText(sec).replace(/^\s*(\d{1,2}\.|[–•-])\s+/gm, '');
  if (!text.trim()) return [];
  const story = checkStory(sec);
  const r = crossCheck(story, text, { derived: false, strict: true, lang: sec.lang || guessLang(text) });
  return r.claims.filter((c) => c.verified !== true && c.kind !== 'week');
}
const guessLang = (t) => (/\b(the|and|of|is|are)\b/.test(t) && !/\b(und|der|die|das|ist|sind)\b/.test(t) ? 'en' : 'de');
export function checkStory(sec) {
  const fs = sec.facts || [];
  return {
    computedAt: new Date().toISOString(),
    kpis: fs.filter((f) => isNum(f.value)).map((f) => ({ id: f.id, label: f.unit === 'rank' ? 'Rang rank' : f.label, value: f.value, unit: f.unit === 'rank' ? 'n' : f.unit })),
    findings: [{ evidence: [...fs.filter((f) => f.unit === 'quarter' || f.unit === 'date').map((f) => ({ label: f.label, value: f.value, unit: f.unit })), ...(sec.keys || []).map((k) => ({ label: 'key', key: k }))] }],
    visual: { kind: 'none', data: {} },
    entities: { projects: sec.entities?.projects || [], teams: sec.entities?.teams || [], people: [], ...(sec.entities?.texts ? { texts: sec.entities.texts } : {}) },
  };
}
// A text from outside (the AI's wording, pasted text) taken into a section: every number the section's facts back
// becomes a protected chip; the rest stays plain text (and checkSection() shows it as not verified).
export function adoptText(sec, text, lang) {
  const L = lang === 'en' ? 'en' : 'de';
  const col = collector(L, `${sec.id}.a${hash(text) % 9973}.`);
  col.facts.push(...(sec.facts || []));
  const tpl = String(text || '').split(/\n+/).map((line, i) => tokenise(line, checkStory(sec), col, `${sec.id}.a${hash(text) % 9973}.${i}.`, L, { partial: true }) ?? line).join('\n');
  return { ...sec, text: tpl, facts: col.facts };
}

// The whole report as plain text (copy, Confluence notes) and the summary alone.
export function docText(doc, { onlyOn = true } = {}) {
  const lines = [doc.title, doc.subtitle, ''];
  for (const s of doc.sections || []) {
    if (onlyOn && s.on === false) continue;
    lines.push(s.title, plainText(s), '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function summaryText(doc) {
  const s = (doc.sections || []).find((x) => x.id === 'summary' && x.on !== false) || (doc.sections || []).find((x) => x.on !== false);
  return s ? `${doc.title}\n${plainText(s)}` : doc.title;
}
export const stableSeed = (doc) => hash(`${doc.audience}|${doc.asOf}`);
