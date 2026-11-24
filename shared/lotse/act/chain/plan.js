// Lotse chains – from a complex request to a plan: ordered steps, each a tool of the catalogue (tools.js) with its
// params and, where it works on what an earlier step found, an input binding ("them" → the set of step 1).
//
//   planChain(text, ctx) → Plan = { v: 1, text, lang, source: 'lotse', steps: [Step], unresolved: [{ text, reason }] }
//     Step = { id: 's1', tool, params, input: 's1'|null, clause, why }
//   cleanPlan(plan, ctx, { source }) → a checked plan (unknown tools / params / bindings refused: INVALID with `problems`)
//   planProblems(plan, ctx) → [{ step, field, message }]     (the same checks, as a list – the editor and the LLM path)
//   comparePlans(a, b) → { same, diffs: [{ at, kind: 'tool'|'params'|'input'|'missing'|'extra', a, b }] }
//   stepTitle(step, ctx) → [de, en]                        what the plan view writes on a step
//   chainRoute(text, ctx) → null | { plan }                 is this sentence a chain (route.js asks first)
//
// Each clause is mapped by the understanding Lotse already has: the query language (query.js parseQuery), a few
// set-aware chain patterns (plan their weeks, remind them, a list / a PDF for each of them, compare the rankings, check
// the waterline, sum it up for the owner), the act router (route.js: workflows and commands), the skills (understand.js)
// and the document job (orchestrate/parse.js). Nothing is guessed silently: a clause Lotse cannot map is listed in
// `unresolved` and shown – the person removes it, rewrites it or asks the AI (when it is on).
import { splitClauses, qOf } from './split.js';
import { parseQuery, PRESETS, PRESET_IDS, queryKey, formatQuery, queryLabel, cleanQuery, quarterIn } from '../query.js';
import { toolCatalog, toolOf, cleanParams, outEntity, queryOfTool } from '../tools.js';
import { routeSingle } from '../route.js';
import { understand } from '../../understand.js';
import { parseJob, jobScore, BLOCKS_FOR, DEFAULT_BLOCKS } from '../orchestrate/parse.js';
import { findProject, findTeam, fold } from '../../../ask.js';
import { T, langOf, computedOf, invalid, stable } from '../kit.js';
import { learnedTool } from '../../learn.js';

export const MAX_STEPS = 8;
const R = {
  balance: /\b(plane?n?|plan|bring\w*|glaett\w*|balance|level|even out|ausgleich\w*|organi[sz]\w*)\b.{0,60}(\b100 ?%|\b(auf|to) (das |the )?ziel\b|\bto (the )?target\b)|\b(auf|to) 100 ?%/,
  remind: /\b(erinner\w*|remind\w*|benachrichtig\w*|notify|anschreib\w*|ping)\b/,
  list: /\b(liste|list|tabelle|table)\b/,
  doc: /\bpdfs?\b|\bdokument\w*|\bdocuments?\b|\bbericht\w*|\breports?\b|\bhandout\w*|\bunterlage\w*/,
  pdf: /\bpdfs?\b|\bdokument\w*|\bdocuments?\b|\bdatei\b|\bfile\b|\bausdruck\w*|\bprint\w*/,
  brief: /\bfass\w*\b.{0,50}\bzusammen\b|\bzusammenfass\w*|\bsummari[sz]\w*|\bsummary\b|\bkurzfassung\b|\binformier\w*|\binform\b|\bbrief (the|for)\b|\bwrite (it )?up\b/,
  waterline: /\b(wasserlinie|waterline|besetzbar\w*|staffab\w*)\b/,
  change: /\b(aender\w*|change\w*|veraender\w*|vergleich\w*|compar\w*|ob|whether|if|pruef\w*|check\w*|differen\w*|unterschied\w*|effect\w*|auswirk\w*|wirkung|moves?|bewegt)\b/,
  fillEst: /\b(fuell\w*|fill\w*|ergaenz\w*|setz\w*|add|complete)\b.{0,40}\b(schaetzung\w*|estimates?|aufwaende?)\b|\b(schaetzung\w*|estimates?)\b.{0,30}\b(fuellen|ergaenzen|fill|add)\b/,
  rerank: /\b(vergleich\w*|compar\w*|bewert\w*|pruef\w*|check\w*|zeig\w*|show)\b.{0,30}\b(rangfolge\w*|ranking\w*|reihenfolge\w*|rankings?|priorisierung\w*|prioritaeten)\b/,
  clevel: /\bc-?level\b|\bmanagement-?report\b|\bvorstandsbericht\b|\bboard report\b|\bexecutive report\b/,
  each: /\b(je|pro|per|each|every|jede[nmrs]?|jeweils|eigene[ns]?|own|einzeln\w*|individual\w*|every one of them)\b/,
  textOnly: /\b(nur (als )?text|text only|nachricht\w*|messages?|notiz\w*|notes?|e-?mails?)\b/,
  aTeamLeads: /\bteamleit\w*|\bteam ?leads?\b|\bteamleiter\w*/,
  aOwners: /\bowner\w*|\bprojektleit\w*|\bproject (leads?|managers?)\b|\bverantwortlich\w*/,
  aManagement: /\bmanagement\b|\bgeschaeftsfuehrung\b|\bvorstand\w*|\bboard\b|\bchef\w*|\bexecutives?\b|\bleadership\b|\bc-?level\b/,
  formal: /\bformell\w*|\bformal\w*|\bsachlich\w*|\bsie-?form\b/,
  gaps: /\b(luecke\w*|gaps?|fehlende werte|missing values)\b/,
};
const audienceOf = (q, entity) => (R.aTeamLeads.test(q) ? 'teamLeads' : R.aOwners.test(q) ? 'owners' : R.aManagement.test(q) ? 'management' : entity === 'teams' ? 'teamLeads' : entity === 'projects' ? 'owners' : 'colleagues');
const boardOf = (q) => (/\b(geschaeftsfuehrung|vorstand\w*|board|ceo|c-?level)\b/.test(q) ? 'board' : R.aTeamLeads.test(q) ? 'teamLeads' : /\b(bereichsleit\w*|management)\b/.test(q) ? 'management' : 'board');

// the latest earlier step whose output is a set of one of these entities
function lastSet(steps, accepts) {
  for (let i = steps.length - 1; i >= 0; i--) {
    const t = toolOf(steps[i].tool);
    const e = outEntity(t, steps[i].params) || (steps[i].passEntity || null);
    if (e && (!accepts || accepts.includes(e))) return { id: steps[i].id, entity: e, step: steps[i] };
  }
  return null;
}
// what the earlier steps already fixed: the quarter, the project, the window
function context(steps) {
  const out = { quarter: null, project: null, team: null, next: null, past: null, preset: null };
  for (const s of steps) {
    if (s.params?.quarter) out.quarter = s.params.quarter;
    if (s.params?.project) out.project = s.params.project;
    if (s.params?.team) out.team = s.params.team;
    const t = toolOf(s.tool);
    if (t?.kind === 'query') {
      const q = queryOfTool(t, s.params);
      if (q?.window?.next) out.next = q.window.next;
      if (q?.window?.past) out.past = q.window.past;
      if (q?.window?.quarter) out.quarter = q.window.quarter;
      out.preset = t.preset || null;
    }
  }
  return out;
}
const presetParams = (preset, q) => {
  const base = PRESETS[preset];
  const p = {};
  if (q.where?.[0] && base.where[0] && typeof q.where[0].v === 'number' && q.where[0].v !== base.where[0].v) p.threshold = q.where[0].v;
  if (q.window?.next && q.window.next !== base.window?.next) p.next = q.window.next;
  if (q.window?.past && q.window.past !== base.window?.past) p.past = q.window.past;
  if (q.window?.quarter) p.quarter = q.window.quarter;
  if (q.scope?.kind === 'project') p.project = q.scope.ref;
  if (q.scope?.kind === 'team') p.team = q.scope.ref;
  return p;
};
// blocks for a document over a set: from the clause, else from what the steps before were about
function docBlocks(q, ctx, entity, steps) {
  const subjects = entity === 'teams' ? 'teams' : entity === 'projects' ? 'projects' : 'people';
  const job = parseJob(q, { ...ctx });
  let blocks = job.said?.blocks ? job.blocks.filter((b) => BLOCKS_FOR[subjects].includes(b)) : [];
  if (!blocks.length) {
    const tools = steps.map((s) => s.tool);
    const pre = context(steps).preset;
    if (tools.includes('plan.balance')) blocks = ['weeks', 'tasks'];
    else if (pre === 'belowBooking') blocks = ['bookings'];
    else if (pre === 'overloaded' || pre === 'absentWithWork') blocks = ['weeks', 'tasks', 'absences'];
    else if (pre === 'teamsSupport' || pre === 'ticketsSla' || tools.includes('query.ticketsSla')) blocks = ['support', 'overdue'];
    else if (pre === 'teamsOverCapacity') blocks = ['weeks', 'overdue'];
    else blocks = [...DEFAULT_BLOCKS[subjects]];
    blocks = blocks.filter((b) => BLOCKS_FOR[subjects].includes(b));
  }
  if (BLOCKS_FOR[subjects].includes('risks') && !blocks.includes('risks')) blocks.push('risks');
  if (!context(steps).past) blocks = blocks.filter((b) => b !== 'bookings' && b !== 'planActual');
  return blocks;
}

// ---------- one clause → one step ----------
export function mapClause(c, ctx, steps, each) {
  const q = c.q;
  const env = context(steps);
  const { model } = computedOf(ctx);
  const qs = computedOf(ctx).wl.quarters;
  const mk = (tool, params = {}, input = null, why = '') => ({ tool, params, input, why });
  const learned = learnedTool(c.text, ctx);
  if (learned && toolOf(learned.tool)?.chainable) {
    const t = toolOf(learned.tool);
    const inp = t.input ? lastSet(steps, t.input.accepts) : null;
    return mk(learned.tool, {}, inp?.id || null, 'learned');
  }
  // --- chain patterns first: they are about the set or the results before ---
  const peopleSet = lastSet(steps, ['people']);
  const anySet = lastSet(steps, null);
  if (R.balance.test(q) && peopleSet) {
    const m = /\b(\d{2,3}) ?%/.exec(q);
    return mk('plan.balance', { ...(m && +m[1] !== 100 ? { target: +m[1] } : {}), ...(/\b(uebergeb\w*|uebergab\w*|hand ?over\w*|umverteil\w*|reassign\w*)\b/.test(q) ? { handover: true } : {}) }, peopleSet.id, 'balance');
  }
  if (R.remind.test(q) && peopleSet) return mk('notify.remind', R.gaps.test(q) || env.preset === 'storiesNoEstimate' ? { kind: 'gaps' } : {}, peopleSet.id, 'remind');
  if (R.list.test(q) && anySet && !R.each.test(q.replace(/\bliste\b/, ''))) return mk('doc.list', R.pdf.test(q) || !R.textOnly.test(q) ? {} : { format: 'text' }, anySet.id, 'list');
  if (R.clevel.test(q) || (/\b(report|bericht)\b/.test(q) && /\b(geschaeftsfuehrung|vorstand|board)\b/.test(q))) return mk('wf.cLevelReport', { audience: boardOf(q) }, null, 'clevel');
  if (R.rerank.test(q)) { const own = quarterIn(q, ctx); return mk('wf.reRankQuarter', { ...(own ? { quarter: own } : env.quarter && qs.includes(env.quarter) ? { quarter: env.quarter } : {}) }, null, 'rerank'); }
  if (R.waterline.test(q) && R.change.test(q) && steps.length) return mk('check.waterline', { ...(env.project ? { project: env.project } : {}), ...(env.quarter ? { quarter: env.quarter } : {}) }, null, 'waterline');
  if (R.fillEst.test(q)) {
    const p = findProject(q, model);
    const t = p ? null : findTeam(q, model);
    return mk('fill.estimates', { ...(p ? { project: p.ref } : t ? { team: t.id } : env.project ? { project: env.project } : {}) }, null, 'fillEstimates');
  }
  if (R.brief.test(q) && steps.length && (c.ref || R.aOwners.test(q) || R.aManagement.test(q) || R.aTeamLeads.test(q))) {
    return mk('doc.brief', { audience: R.aOwners.test(q) ? 'owners' : R.aTeamLeads.test(q) ? 'teamLeads' : R.aManagement.test(q) ? 'management' : env.project ? 'owners' : 'management', ...(R.pdf.test(q) ? { format: 'pdf' } : {}) }, null, 'brief');
  }
  const docSet = lastSet(steps, ['people', 'teams', 'projects']);
  if (R.doc.test(q) && docSet && (c.ref || c.each || each || R.each.test(q) || R.aTeamLeads.test(q) || R.aOwners.test(q))) {
    const entity = docSet.entity;
    const subjSet = each && each !== entity ? (lastSet(steps, [each]) || docSet) : docSet;
    const ent2 = subjSet.entity;
    const w = { next: env.next, past: env.past };
    const fmtv = R.textOnly.test(q) && !R.pdf.test(q) ? 'text' : (c.each || each || R.each.test(q)) ? 'pdfEach' : 'pdfAll';
    return mk('doc.job', { blocks: docBlocks(c.text, ctx, ent2, steps), ...(w.next ? { next: w.next } : {}), ...(w.past ? { past: w.past } : {}), format: fmtv, audience: audienceOf(q, ent2), ...(R.formal.test(q) || audienceOf(q, ent2) === 'management' ? { tone: 'formal' } : {}) }, subjSet.id, 'docEach');
  }
  // --- a set Lotse should find ("wer …", "alle Projekte, die …", "Support-Last je Team") ---
  const qq = each && !/\b(je|pro|per|fuer jede[ns]?|each|every)\b/.test(q) ? `${c.text} ${each === 'teams' ? 'je Team' : each === 'projects' ? 'je Projekt' : 'je Person'}` : c.text;
  const pq = parseQuery(qq, ctx);
  if (pq) {
    const preset = pq.why && PRESETS[pq.why] ? pq.why : null;
    if (preset) return mk(`query.${preset}`, presetParams(preset, pq.query), null, 'query');
    return mk('query', { query: pq.query }, null, 'query');
  }
  // --- everything Lotse already understands on its own: workflows, commands, skills, document jobs ---
  const r = routeSingle(c.text, ctx);
  if (r?.kind === 'workflow' && toolOf(`wf.${r.workflow}`)?.chainable && r.workflow !== 'orchestrate') {
    const t = toolOf(`wf.${r.workflow}`);
    const p = {};
    if (r.params?.ref) p.project = r.params.ref;
    if (r.params?.team && t.params.team) p.team = r.params.team;
    if (r.params?.person && t.params.person) p.person = r.params.person;
    if (r.params?.quarter && t.params.quarter) p.quarter = r.params.quarter;
    if (t.params.quarter && !p.quarter && env.quarter) p.quarter = env.quarter;
    if (t.params.project && !p.project && env.project && c.ref) p.project = env.project;
    const inp = t.input && !p.project && !p.team && !p.person && (c.ref || c.each) ? lastSet(steps, t.input.accepts) : null;
    return mk(t.id, Object.fromEntries(Object.entries(p).filter(([k]) => t.params[k])), inp?.id || null, 'workflow');
  }
  if (r?.kind === 'command' && toolOf(`cmd.${r.command}`)) return mk(`cmd.${r.command}`, { args: r.params }, null, 'command');
  // "bereite das Weekly vor" may mean two jobs: in a chain, the recommended reading (the person sees it in the plan and can change it)
  if (r?.kind === 'decide') {
    const o = (r.options || []).find((x) => x.recommended) || r.options?.[0];
    if (o?.value?.workflow && toolOf(`wf.${o.value.workflow}`)?.chainable && o.value.workflow !== 'orchestrate') {
      const t = toolOf(`wf.${o.value.workflow}`);
      const pp = {};
      if (o.value.params?.ref && t.params.project) pp.project = o.value.params.ref;
      if (o.value.params?.team && t.params.team) pp.team = o.value.params.team;
      return mk(t.id, pp, null, 'workflow');
    }
  }
  if (jobScore(c.text, ctx).job) return mk('wf.orchestrate', { text: c.text.slice(0, 300) }, null, 'job');
  const u = understand(c.text, ctx, {});
  if (u?.skill && toolOf(`skill.${u.skill}`)?.chainable) {
    const t = toolOf(`skill.${u.skill}`);
    const p = {};
    for (const k of Object.keys(t.params)) if (u.params?.[k] != null) p[k] = u.params[k];
    const inp = t.input && !Object.keys(p).length && (c.ref || c.each) ? lastSet(steps, t.input.accepts) : null;
    return mk(t.id, p, inp?.id || null, 'skill');
  }
  return null;
}

// ---------- the whole request ----------
const memo = new Map();
export function planChain(text, ctx) {
  const key = `${langOf(ctx)}|${String(text || '').slice(0, 600)}`;
  const c = computedOf(ctx);
  const hit = memo.get(key);
  if (hit && hit.c === c && hit.learned === ctx.learned) return hit.plan;
  const { clauses, each } = splitClauses(text);
  const steps = [];
  const unresolved = [];
  for (const cl of clauses.slice(0, MAX_STEPS + 4)) {
    if (steps.length >= MAX_STEPS) { unresolved.push({ text: cl.text, reason: 'tooMany' }); continue; }
    let m = null;
    try { m = mapClause(cl, ctx, steps, each); } catch { m = null; }
    if (!m) { unresolved.push({ text: cl.text, reason: 'unknown' }); continue; }
    const id = `s${steps.length + 1}`;
    let params = m.params;
    try { params = cleanParams(m.tool, m.params, ctx); } catch (e) { unresolved.push({ text: cl.text, reason: 'params', field: e.field }); continue; }
    steps.push({ id, tool: m.tool, params, input: m.input, clause: cl.text, why: m.why, ...(m.tool === 'plan.balance' ? { passEntity: 'people' } : {}) });
  }
  const plan = { v: 1, text: String(text || '').slice(0, 600), lang: langOf(ctx), source: 'lotse', steps: steps.map(({ passEntity, ...s }) => s), unresolved, each };
  if (memo.size > 40) memo.clear();
  memo.set(key, { c, learned: ctx.learned, plan });
  return plan;
}

// ---------- checking a plan from anywhere (the editor, the LLM) ----------
export function planProblems(plan, ctx) {
  const out = [];
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.steps)) return [{ step: null, field: 'plan', message: 'plan.steps missing' }];
  if (!plan.steps.length) out.push({ step: null, field: 'steps', message: 'no steps' });
  if (plan.steps.length > MAX_STEPS) out.push({ step: null, field: 'steps', message: `at most ${MAX_STEPS} steps` });
  const seen = [];
  plan.steps.slice(0, MAX_STEPS).forEach((s, i) => {
    const sid = `s${i + 1}`;
    if (!s || typeof s !== 'object') { out.push({ step: sid, field: 'step', message: 'not an object' }); return; }
    const t = toolOf(s.tool);
    if (!t) { out.push({ step: sid, field: 'tool', message: `unknown tool ${String(s.tool).slice(0, 40)}` }); seen.push({ id: sid, tool: null }); return; }
    if (!t.chainable) out.push({ step: sid, field: 'tool', message: `${t.id} cannot be chained` });
    try { cleanParams(t, s.params || {}, ctx); } catch (e) { out.push({ step: sid, field: e.field || 'params', message: e.message }); }
    const inp = s.input == null || s.input === '' ? null : String(s.input);
    if (inp) {
      const src = seen.find((x) => x.id === inp || x.id === `s${inp}`);
      if (!src) out.push({ step: sid, field: 'input', message: `input ${inp} is not an earlier step` });
      else if (!t.input) out.push({ step: sid, field: 'input', message: `${t.id} takes no input` });
      else {
        const e = src.tool ? outEntity(toolOf(src.tool), src.params) || (src.tool === 'plan.balance' ? 'people' : null) : null;
        if (!e || !t.input.accepts.includes(e)) out.push({ step: sid, field: 'input', message: `${t.id} cannot work on ${e || 'that output'}` });
      }
    } else if (t.input?.required) out.push({ step: sid, field: 'input', message: `${t.id} needs a set from an earlier step` });
    seen.push({ id: sid, tool: s.tool, params: s.params });
  });
  return out;
}
export function cleanPlan(plan, ctx, { source = 'lotse' } = {}) {
  const problems = planProblems(plan, ctx);
  if (problems.length) { const e = invalid('plan', problems[0].message); e.problems = problems; throw e; }
  const steps = plan.steps.map((s, i) => {
    const inp = s.input == null || s.input === '' ? null : String(s.input).startsWith('s') ? String(s.input) : `s${s.input}`;
    return { id: `s${i + 1}`, tool: s.tool, params: cleanParams(s.tool, s.params || {}, ctx), input: inp, clause: typeof s.clause === 'string' ? s.clause.slice(0, 200) : '', ...(s.why ? { why: String(s.why).slice(0, 40) } : {}) };
  });
  return { v: 1, text: String(plan.text || '').slice(0, 600), lang: langOf(ctx), source: source === 'ai' ? 'ai' : 'lotse', steps, unresolved: Array.isArray(plan.unresolved) ? plan.unresolved.slice(0, 8).map((u) => ({ text: String(u?.text || '').slice(0, 200), reason: String(u?.reason || 'unknown').slice(0, 20) })) : [] };
}

// aligned by the longest common sequence of tools: a step only one plan has is "extra" / "missing", a step in the same
// place with another tool is "tool", the same tool with other settings or another input is "params" / "input"
export function comparePlans(a, b) {
  const A = a?.steps || [], B = b?.steps || [];
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i].tool === B[j].tool ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const diffs = [];
  let i = 0, j = 0, ga = [], gb = [];
  const flush = () => {
    const k = Math.min(ga.length, gb.length);
    for (let x = 0; x < k; x++) diffs.push({ at: ga[x], kind: 'tool', a: A[ga[x]], b: B[gb[x]] });
    for (const x of ga.slice(k)) diffs.push({ at: x, kind: 'missing', a: A[x] });
    for (const y of gb.slice(k)) diffs.push({ at: y, kind: 'extra', b: B[y] });
    ga = []; gb = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && A[i].tool === B[j].tool) {
      flush();
      if (stable(A[i].params || {}) !== stable(B[j].params || {})) diffs.push({ at: i, kind: 'params', a: A[i], b: B[j] });
      const ia = A[i].input ? A.findIndex((x) => x.id === A[i].input) : -1, ib = B[j].input ? B.findIndex((x) => x.id === B[j].input) : -1;
      if ((ia < 0 ? null : A[ia].tool) !== (ib < 0 ? null : B[ib].tool)) diffs.push({ at: i, kind: 'input', a: A[i], b: B[j] });
      i++; j++;
    } else if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) ga.push(i++);
    else gb.push(j++);
  }
  flush();
  return { same: !diffs.length, diffs };
}

// ---------- words for the plan view ----------
export function stepTitle(step, ctx) {
  const t = toolOf(step.tool);
  if (!t) return ['?', '?'];
  if (t.kind === 'query') {
    try { const q = queryOfTool(t, step.params || {}); return queryLabel(cleanQuery(q, ctx), ctx); } catch { return t.title; }
  }
  return t.title;
}
// option values in plain words – never an internal id like "pdfEach" on screen (live finding)
const VALUE_NAMES = {
  pdfAll: ['ein PDF für alle', 'one PDF for all'], pdfEach: ['ein PDF je Person', 'one PDF per person'], text: ['nur Text', 'text only'],
  colleagues: ['Kolleg:innen', 'colleagues'], management: ['Geschäftsführung', 'management'], teamLeads: ['Teamleitungen', 'team leads'], owners: ['Projekt-Owner', 'project owners'],
  friendly: ['freundlich', 'friendly'], formal: ['förmlich', 'formal'], rank: ['nach Rang', 'by rank'], due: ['nach Termin', 'by due date'],
};
export function stepDetail(step, ctx) {
  const t = toolOf(step.tool);
  const L = langOf(ctx);
  if (!t) return '';
  const { model } = computedOf(ctx);
  const bits = [];
  for (const [k, v] of Object.entries(step.params || {})) {
    const spec = t.params[k];
    if (!spec || k === 'query') continue;
    const name = spec.label[L === 'en' ? 1 : 0];
    const val = spec.type === 'project' ? model.itemByRef.get(v)?.name || v : spec.type === 'team' ? model.teams.get(v)?.name || v : spec.type === 'person' ? ctx.ds?.people?.[v]?.name || v : spec.type === 'blocks' ? v.length : spec.type === 'quarter' ? `Q${String(v).slice(-1)} ${String(v).slice(0, 4)}` : typeof v === 'boolean' ? (v ? T(L, 'ja', 'yes') : T(L, 'nein', 'no')) : VALUE_NAMES[v] ? VALUE_NAMES[v][L === 'en' ? 1 : 0] : String(v);
    bits.push(`${name}: ${val}`);
  }
  if (step.tool === 'query' && step.params?.query) bits.push(formatQuery(step.params.query));
  return bits.join(' · ');
}

// ---------- routing: is this sentence a chain? ----------
// Conservative on purpose – every single job keeps its own way (route.js): a chain needs two mapped steps AND either a
// data flow (a step works on an earlier step's set or results), a set to find, or an explicit sequence word.
export function chainRoute(text, ctx) {
  const raw = String(text || '');
  if (raw.length < 12) return null;
  const { clauses } = splitClauses(raw);
  if (clauses.length < 2) return null;
  const plan = planChain(raw, ctx);
  const n = plan.steps.length;
  if (n < 2 && !(n >= 1 && plan.unresolved.length && clauses.some((c) => c.seq))) return null;
  const tools = plan.steps.map((s) => toolOf(s.tool));
  const flow = plan.steps.some((s) => s.input);
  const query = tools.some((t) => t.kind === 'query');
  const chainOnly = plan.steps.some((s) => ['check.waterline', 'doc.brief', 'doc.list', 'notify.remind', 'plan.balance', 'doc.job', 'fill.estimates'].includes(s.tool));
  const seq = clauses.some((c) => c.seq);
  if (!(flow || query || chainOnly || seq)) return null;
  // a pure document job ("prüfe … und pack alles in ein PDF für jeden Kollegen") stays the orchestrator's
  if (tools.every((t) => t.id === 'wf.orchestrate' || t.kind === 'story') && !query && !flow) return null;
  if (new Set(plan.steps.map((s) => s.tool)).size < 2 && !flow && !plan.unresolved.length) return null;
  return { plan };
}
void PRESET_IDS; void queryKey; void fold; void toolCatalog;
