// Lotse chains – documents made from what a chain found: a LIST of a set (the members and the numbers that qualified
// them) and a BRIEF (a summary of the chain's results for one reader). Same model as the job document
// (report/jobDoc.js: cover, overview, sections, proof) so the same renderer paints it (lib/jobPdf.js) and the same
// checks apply (docProblems: every figure carries its proof).
//
//   cleanChainDoc(spec, ctx) → spec (strict; INVALID otherwise)    spec = { kind: 'list', set, title? } | { kind: 'brief', brief }
//   buildChainDoc(ctx, spec) → doc
import { METRICS, ENTITY_NAMES, formatQuery, memberText } from '../query.js';
import { fmtOf, T, plural } from '../../narrate.js';
import { dsOf, memo } from '../../kit.js';
import { invalid } from '../kit.js';

const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n) : null);
const prim = (v) => v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 40);
export function cleanSet(set) {
  if (!set || typeof set !== 'object' || !Object.keys(METRICS).includes(set.entity)) throw invalid('set');
  if (!Array.isArray(set.members) || set.members.length > 100) throw invalid('set.members');
  const members = set.members.map((m) => {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || m.id.length > 80) throw invalid('set.members');
    const values = {};
    for (const [k, v] of Object.entries(m.values || {})) { if (!METRICS[set.entity][k] || !prim(v)) throw invalid('set.values'); values[k] = v; }
    return { id: m.id, kind: str(m.kind, 20) || 'item', name: str(m.name, 120) || m.id, values, ...(str(m.key, 30) ? { key: str(m.key, 30) } : {}), ...(m.target != null && Number.isFinite(+m.target) ? { target: +m.target } : {}), keys: Array.isArray(m.keys) ? m.keys.filter((k) => typeof k === 'string' && k.length <= 30).slice(0, 12) : [] };
  });
  const q = set.query && typeof set.query === 'object' ? set.query : null;
  if (!q || q.entity !== set.entity || !Array.isArray(q.where)) throw invalid('set.query');
  return { entity: set.entity, query: JSON.parse(JSON.stringify(q)), total: Math.max(members.length, Math.round(+set.total || 0)), checked: Math.max(0, Math.round(+set.checked || 0)), label: Array.isArray(set.label) && set.label.length === 2 ? set.label.map((x) => String(x).slice(0, 160)) : ['', ''], members };
}
function cleanBrief(b) {
  if (!b || typeof b !== 'object') throw invalid('brief');
  const kpis = (Array.isArray(b.kpis) ? b.kpis : []).slice(0, 4).map((k) => ({ label: str(k.label, 60) || '', value: Number.isFinite(+k.value) ? +k.value : 0, unit: ['h', '%', 'd', 'n'].includes(k.unit) ? k.unit : 'n' }));
  const findings = (Array.isArray(b.findings) ? b.findings : []).slice(0, 8).map((f) => ({ text: str(f.text, 400) || '', tone: ['ok', 'warn', 'bad', 'info'].includes(f.tone) ? f.tone : 'info' })).filter((f) => f.text);
  const m = b.message && typeof b.message === 'object' ? b.message : {};
  return { title: str(b.title, 120) || 'Lotse', headline: str(b.headline, 400) || '', kpis, findings, ai: b.ai === true, message: { to: str(m.to, 120) || '', subject: str(m.subject, 160) || '', text: str(m.text, 4000) || '' }, sources: (Array.isArray(b.sources) ? b.sources : []).map((s) => str(s, 60)).filter(Boolean).slice(0, 6) };
}
export function cleanChainDoc(spec, ctx) {
  if (!spec || typeof spec !== 'object') throw invalid('doc');
  if (spec.kind === 'list') return { kind: 'list', set: cleanSet(spec.set), title: str(spec.title, 120) || null };
  if (spec.kind === 'brief') return { kind: 'brief', brief: cleanBrief(spec.brief) };
  void ctx;
  throw invalid('doc.kind');
}

const unitText = (F, L, v, u) => (v == null ? '–' : typeof v === 'boolean' ? (v ? T(L, 'ja', 'yes') : T(L, 'nein', 'no')) : typeof v === 'string' ? v : u === '%' ? (v >= 999 ? T(L, 'keine freie Zeit', 'no free time') : L === 'en' ? `${v}%` : `${v} %`) : u === 'h' ? F.h(v, 1) : u === 'd' ? `${v} ${T(L, plural(v, 'Tag', 'Tage'), plural(v, 'day', 'days'))}` : F.n(v));
// the columns a list shows per entity: the condition's metrics first, then the entity's usual figures
const COLS = { people: ['load', 'booking', 'absentPlanned', 'overdue'], projects: ['staffable', 'missing', 'daysOverdue', 'noTshirt'], teams: ['load', 'support', 'slaRisk'], stories: ['overdue', 'remaining', 'blocked', 'noEstimate'], tickets: ['sla', 'slaLeft'] };

export function buildChainDoc(ctx, spec0) {
  const spec = cleanChainDoc(spec0, ctx);
  return memo(ctx, `chain:doc:${ctx?.lang === 'en' ? 'en' : 'de'}:${ctx?.me?.id || ''}:${JSON.stringify(spec)}`, () => (spec.kind === 'list' ? listDoc(ctx, spec) : briefDoc(ctx, spec)));
}
function base(ctx, title, subtitle, intro, lines) {
  const L = ctx?.lang === 'en' ? 'en' : 'de';
  const ds = dsOf(ctx);
  const me = ctx?.me?.name || ds.people?.[ctx?.me?.id]?.name || null;
  const F = fmtOf({ ...ctx, fmt: null }, L);
  return {
    L, F, me,
    doc: { v: 1, kind: 'lotseJob', lang: L, title, subtitle, author: me, asOf: new Date(Number.isFinite(ctx?.now) ? ctx.now : Date.now()).toISOString(), today: ds.today, audience: 'management', tone: 'formal', format: 'pdfAll',
      cover: { title, subtitle, lines: [...lines, [T(L, 'Erstellt von', 'Prepared by'), me ? T(L, `${me} mit Lotse`, `${me} with Lotse`) : 'Lotse'], [T(L, 'Stand', 'As of'), `${F.date(ds.today)} ${String(ds.today).slice(0, 4)}`]], intro } },
  };
}
function listDoc(ctx, { set, title }) {
  const L0 = ctx?.lang === 'en' ? 'en' : 'de';
  const label = set.label[L0 === 'en' ? 1 : 0] || ENTITY_NAMES[set.entity][L0 === 'en' ? 1 : 0];
  const { L, F, doc } = base(ctx, title || T(L0, `Liste · ${label}`, `List · ${label}`), T(L0, `${set.total} ${plural(set.total, 'Treffer', 'Treffer')} von ${set.checked} geprüft`, `${set.total} ${plural(set.total, 'match', 'matches')} of ${set.checked} checked`),
    T(L0, 'Diese Liste zeigt jeden Treffer mit den Zahlen, die ihn qualifiziert haben – Quelle und Formel stehen im Nachweis.', `This list shows every member of the set with the numbers that qualified it – source and formula are in the proof.`),
    [[T(L0, 'Abfrage', 'Query'), formatQuery(set.query)]]);
  const M = METRICS[set.entity];
  const cols = [...new Set([...set.query.where.map((w) => w.m), ...COLS[set.entity]])].filter((k) => M[k]).slice(0, 4);
  const proof = [];
  let pn = 0;
  const addProof = (label, values, keys = []) => { const id = `p${++pn}`; proof.push({ id, section: 's:list', label, values, formula: T(L, 'Wie in der Abfrage des Auftrags berechnet – dieselben Zahlen wie in den Ansichten des Cockpits.', 'Computed as in the job\'s query – the same numbers as in the cockpit\'s views.'), inputs: [[T(L, 'Abfrage', 'Query'), formatQuery(set.query)]], keys: keys.slice(0, 20), source: set.entity === 'tickets' ? 'Jira Service Management' : T(L, 'Jira · Kapazitäten', 'Jira · Capacity') }); return id; };
  const rows = set.members.map((m) => {
    const p = addProof(m.name, cols.map((k) => [M[k].name[L === 'en' ? 1 : 0], unitText(F, L, m.values[k], M[k].unit)]), m.keys || []);
    const tone = set.entity === 'tickets' ? (m.values.sla === 'breached' ? 'bad' : 'warn') : null;
    return { cells: [{ text: m.name }, ...cols.map((k) => ({ text: unitText(F, L, m.values[k], M[k].unit), proof: p }))], ...(tone ? { tone } : {}) };
  });
  const ov = addProof(T(L, 'Überblick', 'Overview'), [[T(L, 'Treffer', 'Matches'), String(set.total)], [T(L, 'Geprüft', 'Checked'), String(set.checked)]]);
  const q = { ...set.query };
  doc.overview = { heading: T(L, 'Überblick', 'Overview'), paragraphs: [label], kpis: [{ label: T(L, 'Treffer', 'Matches'), value: set.total, unit: 'n', display: F.n(set.total), tone: set.total ? 'warn' : 'ok', proof: ov }, { label: T(L, 'Geprüft', 'Checked'), value: set.checked, unit: 'n', display: F.n(set.checked), proof: ov }], visual: null, findings: [] };
  const lines = set.members.slice(0, 30).map((m) => `– ${m.name}: ${memberText(F, L, q, m)}`);
  doc.sections = [{
    id: 's:list', subject: { kind: 'topic', id: 'list', name: label }, heading: T(L, 'Liste', 'List'), tone: set.total ? 'warn' : 'ok', greeting: '', paragraphs: [T(L, `${set.total} ${plural(set.total, 'Treffer', 'Treffer')}, nach dem ersten Kriterium sortiert.`, `${set.total} ${plural(set.total, 'match', 'matches')}, sorted by the first criterion.`)],
    kpis: [], visual: null, tables: [{ id: 'list', title: label, columns: [T(L, 'Name', 'Name'), ...cols.map((k) => M[k].name[L === 'en' ? 1 : 0])], align: ['l', ...cols.map(() => 'r')], rows, empty: T(L, 'Keine Treffer.', 'No matches.') }],
    findings: [], suggestions: [], message: { to: '', subject: label, text: [label, '', ...lines].join('\n') },
  }];
  doc.proof = proof;
  doc.messages = doc.sections.map((s) => ({ id: s.id, ...s.message }));
  doc.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity')];
  return doc;
}
function briefDoc(ctx, { brief }) {
  const L0 = ctx?.lang === 'en' ? 'en' : 'de';
  const { L, F, doc } = base(ctx, brief.title, brief.headline, brief.ai ? T(L0, 'Text als KI-Entwurf, von Lotse gegen die belegten Zahlen geprüft.', 'Text drafted by AI, checked by Lotse against the proven numbers.') : T(L0, 'Zusammenfassung der Schritte dieses Auftrags – jede Zahl aus den Schritten davor.', 'Summary of this job\'s steps – every number from the steps before.'), [[T(L0, 'Für', 'For'), brief.message.to || '–']]);
  const proof = [{ id: 'p1', section: 's:brief', label: T(L, 'Kennzahlen', 'Key figures'), values: brief.kpis.map((k) => [k.label, unitText(F, L, k.value, k.unit)]), formula: T(L, 'Aus den Ergebnissen der Schritte des Auftrags (Abfragen, Vorschauen, übernommene Änderungen).', 'From the results of the job\'s steps (queries, previews, applied changes).'), inputs: [], keys: [], source: brief.sources.join(' · ') || 'Lotse' }];
  doc.overview = { heading: T(L, 'Überblick', 'Overview'), paragraphs: [brief.headline], kpis: brief.kpis.map((k) => ({ ...k, display: unitText(F, L, k.value, k.unit), proof: 'p1' })), visual: null, findings: [] };
  doc.sections = [{ id: 's:brief', subject: { kind: 'topic', id: 'brief', name: brief.message.to || brief.title }, heading: brief.message.to || brief.title, tone: brief.findings.some((f) => f.tone === 'bad') ? 'bad' : brief.findings.some((f) => f.tone === 'warn') ? 'warn' : 'ok', greeting: '', paragraphs: [], kpis: [], visual: null, tables: [], findings: brief.findings, suggestions: [], message: brief.message }];
  doc.proof = proof;
  doc.messages = [{ id: 's:brief', ...brief.message }];
  doc.sources = brief.sources.length ? brief.sources : ['Lotse'];
  return doc;
}
