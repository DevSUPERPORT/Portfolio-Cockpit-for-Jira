// Lotse – the Story: the one format every skill returns, the UI renders and the optional AI reads.
// Pure. validStory() is strict (the server runs it on what the browser sends); storyFacts() turns a story into the set
// of verifiable claims that crosscheck.js and the tests compare text against.
//
// Story = {
//   id: 'skill:subject', skill, subject: { kind: 'project'|'team'|'person'|'portfolio'|'ticket'|'topic', ref, name },
//   lang: 'de'|'en', computedAt: ISO, tone: 'ok'|'warn'|'bad'|'info',
//   headline: ONE sentence with real numbers,
//   kpis: [{ id, label, value: number, unit, tone?, delta?, hint? }]          0–4 (2–4 for every data story)
//   visual: { kind, data, caption }                                             REQUIRED – shapes below
//   findings: [{ text, tone, impact: 0..100, evidence: [{ key?, ref?, label, value?, unit?, text? }] }]   1–4, by impact
//   actions: [{ id, label, kind, payload, preview, undoable: true }]          0–3, never applied by Lotse itself
//   followUps: [{ label, text }]                                                2–4 questions Lotse can answer next
//   how: { text, inputs: [[label, value]] }, confidence: 'high'|'medium'|'low', sources: string[],
//   entities: { projects: [{ ref, key, rank, name }], teams: [{ id, name }], people: [{ id, name }], texts?: string[] }
//       – the names the story mentions: the cross-check knows them, the AI only sees them as allowed (P1 / "#rank KEY");
//         texts = free Jira text inside sentences (e.g. a support topic named after ticket titles) – hidden unless texts are allowed
// }
// Units: 'h' hours · '%' percent POINTS (112 = 112 %) · 'd' days · 'n' a count · 'eur' euro; compare rows also 'date' (ISO).
// evidence.value may be an ISO date (unit 'date') or a quarter 'YYYY-Qn' (unit 'quarter').
// evidence.text is free Jira text (a summary, a reason) – shown in the app, sent to the AI only when texts are allowed.
//
// Visual kinds (data shapes – the UI renders exactly these; tone ∈ ok|warn|bad|info|muted|ink):
//   bars      { unit, items: [{ label, value, tone?, key?, ref?, rank?, sub? }] ≤24, target?: number, max?: number }
//             horizontal bars, one per item, in the given order; target = a reference line (e.g. the plan)
//   columns   { unit, labels: string[] ≤26, series: [{ name, values: number[], tone? }] ≤4, target?: number }
//             vertical grouped columns per label (weeks, quarters, days); every series has labels.length values
//   line      same shape as columns, drawn as lines (trends over time)
//   donut     { unit, items: [{ label, value ≥ 0, tone? }] ≤8, total }
//   heat      { unit, cols: string[] ≤12, rows: [{ label, key?, ref?, values: (number|null)[] }] ≤12, max? }
//             a matrix (e.g. utilisation % per team and week); null = no value
//   timeline  { from, to, today, events: [{ date, label, tone?, key?, kind? }] ≤16 }   ISO dates on one axis
//   gantt     { from, to, today, rows: [{ label, key?, ref?, start, end, tone?, before?: { start, end } }] ≤12 }
//             before = where the bar was before a suggested move (drawn as a ghost)
//   compare   { a: { label }, b: { label }, rows: [{ label, unit, a, b, better?: 'lower'|'higher', tone? }] ≤8 }
//             side by side (two projects, two teams, or before/after of a what-if); a/b: number, ISO date or null
//   waterline { unit: 'h', capacity: number|null, support?, team?, quarter?, waterRank: number|null,
//               items: [{ label, rank, ref?, key?, value, cum, status: 'ok'|'partial'|'no' }] ≤24 }
//             demand stacked in rank order against one capacity line (capacity null = several teams: status only)

export const STORY_TONES = ['ok', 'warn', 'bad', 'info'];
export const TONES = ['ok', 'warn', 'bad', 'info', 'muted', 'ink'];
export const UNITS = ['h', '%', 'd', 'n', 'eur'];
export const VISUAL_KINDS = ['bars', 'columns', 'line', 'donut', 'heat', 'timeline', 'gantt', 'compare', 'waterline'];
export const SUBJECT_KINDS = ['project', 'team', 'person', 'portfolio', 'ticket', 'topic'];
export const ACTION_KINDS = ['open', 'move', 'assign', 'fill', 'rank', 'dispatch', 'navigate', 'whatIf'];
export const MAX_STORY_BYTES = 12_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const KEY_RE = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/;
const ID_RE = /^[A-Za-z0-9:_.|#@ -]{1,140}$/;
const BAD = new Set(['__proto__', 'constructor', 'prototype']);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v, n) => typeof v === 'string' && v.length <= n;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const opt = (v, f) => (v === undefined || v === null ? undefined : f(v));

class StoryError extends Error { constructor(m) { super(`story: ${m}`); this.code = 'INVALID'; } }
const need = (ok, m) => { if (!ok) throw new StoryError(m); };

// ---------- strict validation + sanitised copy ----------
function str(v, n, what, { empty = false } = {}) {
  need(typeof v === 'string', `${what} must be text`);
  const s = clean(v, n);
  need(empty || s.length > 0, `${what} is empty`);
  return s;
}
const num = (v, what) => { need(isNum(v), `${what} must be a number`); return v; };
const tone = (v, what, list = TONES) => { need(list.includes(v), `${what}: bad tone`); return v; };
const date = (v, what) => { need(typeof v === 'string' && DATE_RE.test(v), `${what}: ISO date expected`); return v; };
const arr = (v, max, what, min = 0) => { need(Array.isArray(v), `${what} must be a list`); need(v.length >= min && v.length <= max, `${what}: ${min}–${max} entries`); return v; };
const plain = (v, what) => { need(v && typeof v === 'object' && !Array.isArray(v), `${what} must be an object`); for (const k of Object.keys(v)) need(!BAD.has(k), `${what}: bad key`); return v; };
const ref = (v) => opt(v, (x) => { need(typeof x === 'string' && ID_RE.test(x), 'bad ref'); return x; });
const key = (v) => opt(v, (x) => { need(typeof x === 'string' && KEY_RE.test(x), `bad key ${String(x).slice(0, 30)}`); return x; });
const unitOf = (v, what, extra = []) => { need([...UNITS, ...extra].includes(v), `${what}: bad unit`); return v; };
const numOrNull = (v, what) => (v === null ? null : num(v, what));

const VISUAL = {
  bars(d) {
    return {
      unit: unitOf(d.unit, 'bars.unit'), target: opt(d.target, (x) => num(x, 'bars.target')), max: opt(d.max, (x) => num(x, 'bars.max')),
      items: arr(d.items, 24, 'bars.items').map((x, i) => (plain(x, `bars.items[${i}]`), {
        label: str(x.label, 80, 'bar label'), value: num(x.value, 'bar value'), tone: opt(x.tone, (t) => tone(t, 'bar')), key: key(x.key), ref: ref(x.ref),
        rank: opt(x.rank, (r) => num(r, 'bar rank')), sub: opt(x.sub, (s) => str(s, 120, 'bar sub', { empty: true })),
      })),
    };
  },
  columns(d, kind = 'columns') {
    const labels = arr(d.labels, 26, `${kind}.labels`, 1).map((l) => str(l, 40, `${kind} label`));
    return {
      unit: unitOf(d.unit, `${kind}.unit`), labels, target: opt(d.target, (x) => num(x, `${kind}.target`)),
      series: arr(d.series, 4, `${kind}.series`, 1).map((s, i) => {
        plain(s, `${kind}.series[${i}]`);
        const values = arr(s.values, labels.length, `${kind}.series.values`, labels.length).map((v) => numOrNull(v, `${kind} value`));
        return { name: str(s.name, 60, 'series name'), values, tone: opt(s.tone, (t) => tone(t, 'series')) };
      }),
    };
  },
  line(d) { return VISUAL.columns(d, 'line'); },
  donut(d) {
    return {
      unit: unitOf(d.unit, 'donut.unit'), total: num(d.total, 'donut.total'),
      items: arr(d.items, 8, 'donut.items', 1).map((x) => (plain(x, 'donut item'), { label: str(x.label, 60, 'donut label'), value: (need(isNum(x.value) && x.value >= 0, 'donut value'), x.value), tone: opt(x.tone, (t) => tone(t, 'donut')) })),
    };
  },
  heat(d) {
    const cols = arr(d.cols, 12, 'heat.cols', 1).map((c) => str(c, 30, 'heat col'));
    return {
      unit: unitOf(d.unit, 'heat.unit'), cols, max: opt(d.max, (x) => num(x, 'heat.max')),
      rows: arr(d.rows, 12, 'heat.rows', 1).map((r) => (plain(r, 'heat row'), { label: str(r.label, 60, 'heat label'), key: key(r.key), ref: ref(r.ref), values: arr(r.values, cols.length, 'heat values', cols.length).map((v) => numOrNull(v, 'heat value')) })),
    };
  },
  timeline(d) {
    return {
      from: date(d.from, 'timeline.from'), to: date(d.to, 'timeline.to'), today: date(d.today, 'timeline.today'),
      events: arr(d.events, 16, 'timeline.events', 1).map((e) => (plain(e, 'event'), { date: date(e.date, 'event.date'), label: str(e.label, 80, 'event label'), tone: opt(e.tone, (t) => tone(t, 'event')), key: key(e.key), kind: opt(e.kind, (k) => str(k, 20, 'event kind')) })),
    };
  },
  gantt(d) {
    return {
      from: date(d.from, 'gantt.from'), to: date(d.to, 'gantt.to'), today: date(d.today, 'gantt.today'),
      rows: arr(d.rows, 12, 'gantt.rows', 1).map((r) => (plain(r, 'gantt row'), {
        label: str(r.label, 80, 'gantt label'), key: key(r.key), ref: ref(r.ref), start: date(r.start, 'gantt.start'), end: date(r.end, 'gantt.end'), tone: opt(r.tone, (t) => tone(t, 'gantt')),
        before: opt(r.before, (b) => (plain(b, 'gantt before'), { start: date(b.start, 'before.start'), end: date(b.end, 'before.end') })),
      })),
    };
  },
  compare(d) {
    plain(d.a, 'compare.a'); plain(d.b, 'compare.b');
    return {
      a: { label: str(d.a.label, 60, 'compare a') }, b: { label: str(d.b.label, 60, 'compare b') },
      rows: arr(d.rows, 8, 'compare.rows', 1).map((r) => {
        plain(r, 'compare row');
        const unit = unitOf(r.unit, 'compare unit', ['date']);
        const val = (v) => (v === null ? null : unit === 'date' ? date(v, 'compare date') : num(v, 'compare value'));
        return { label: str(r.label, 60, 'compare label'), unit, a: val(r.a), b: val(r.b), better: opt(r.better, (b) => (need(['lower', 'higher'].includes(b), 'compare better'), b)), tone: opt(r.tone, (t) => tone(t, 'compare')) };
      }),
    };
  },
  waterline(d) {
    need(d.unit === 'h', 'waterline.unit must be h');
    return {
      unit: 'h', capacity: d.capacity === null ? null : num(d.capacity, 'waterline.capacity'), support: opt(d.support, (x) => num(x, 'waterline.support')),
      team: opt(d.team, (x) => str(x, 60, 'waterline.team')), quarter: opt(d.quarter, (x) => (need(/^\d{4}-Q[1-4]$/.test(x), 'waterline.quarter'), x)),
      waterRank: d.waterRank === null || d.waterRank === undefined ? null : num(d.waterRank, 'waterRank'),
      items: arr(d.items, 24, 'waterline.items', 1).map((x) => (plain(x, 'waterline item'), {
        label: str(x.label, 80, 'waterline label'), rank: num(x.rank, 'waterline rank'), ref: ref(x.ref), key: key(x.key), value: num(x.value, 'waterline value'), cum: num(x.cum, 'waterline cum'),
        status: (need(['ok', 'partial', 'no'].includes(x.status), 'waterline status'), x.status),
      })),
    };
  },
};

function evidence(e) {
  plain(e, 'evidence');
  return {
    key: key(e.key), ref: ref(e.ref), label: str(e.label, 100, 'evidence label'),
    value: opt(e.value, (v) => (typeof v !== 'string' ? num(v, 'evidence value') : e.unit === 'quarter' ? (need(/^\d{4}-Q[1-4]$/.test(v), 'evidence quarter'), v) : date(v, 'evidence date'))),
    unit: opt(e.unit, (u) => unitOf(u, 'evidence unit', ['date', 'quarter'])), text: opt(e.text, (t) => str(t, 160, 'evidence text', { empty: true })),
  };
}
function entities(x) {
  if (x === undefined || x === null) return undefined;
  plain(x, 'entities');
  return {
    projects: arr(x.projects || [], 40, 'entities.projects').map((p) => (plain(p, 'entity'), { ref: ref(p.ref) || null, key: key(p.key) || null, rank: p.rank == null ? null : num(p.rank, 'entity rank'), name: str(p.name, 100, 'entity name') })),
    teams: arr(x.teams || [], 40, 'entities.teams').map((t) => (plain(t, 'entity'), { id: ref(t.id) || null, name: str(t.name, 60, 'team name') })),
    people: arr(x.people || [], 40, 'entities.people').map((p) => (plain(p, 'entity'), { id: ref(p.id) || null, name: str(p.name, 80, 'person name') })),
    ...(x.texts ? { texts: arr(x.texts, 20, 'entities.texts').map((t) => str(t, 100, 'entity text')) } : {}),
  };
}

// Returns a sanitised deep copy (only known fields, texts trimmed) or throws { code: 'INVALID' }.
export function validStory(s, { maxBytes = MAX_STORY_BYTES } = {}) {
  plain(s, 'story');
  need(isStr(s.id, 160) && s.id.length > 0, 'id');
  need(typeof s.skill === 'string' && /^[a-zA-Z]{2,32}$/.test(s.skill), 'skill');
  plain(s.subject, 'subject');
  need(SUBJECT_KINDS.includes(s.subject.kind), 'subject.kind');
  need(s.lang === 'de' || s.lang === 'en', 'lang');
  need(typeof s.computedAt === 'string' && ISO_RE.test(s.computedAt), 'computedAt');
  plain(s.visual, 'visual');
  need(VISUAL_KINDS.includes(s.visual.kind), 'visual.kind');
  plain(s.visual.data, 'visual.data');
  plain(s.how, 'how');
  const out = {
    id: clean(s.id, 160), skill: s.skill,
    subject: { kind: s.subject.kind, ref: s.subject.ref == null ? null : (need(isStr(s.subject.ref, 140), 'subject.ref'), clean(s.subject.ref, 140)), name: str(s.subject.name, 100, 'subject.name') },
    lang: s.lang, computedAt: s.computedAt, tone: tone(s.tone, 'story', STORY_TONES),
    headline: str(s.headline, 300, 'headline'),
    kpis: arr(s.kpis, 4, 'kpis').map((k) => (plain(k, 'kpi'), {
      id: str(k.id, 40, 'kpi.id'), label: str(k.label, 60, 'kpi.label'), value: num(k.value, 'kpi.value'), unit: unitOf(k.unit, 'kpi'),
      tone: opt(k.tone, (t) => tone(t, 'kpi')), delta: opt(k.delta, (d) => num(d, 'kpi.delta')), hint: opt(k.hint, (h) => str(h, 120, 'kpi.hint', { empty: true })),
    })),
    visual: { kind: s.visual.kind, data: VISUAL[s.visual.kind](s.visual.data), caption: str(s.visual.caption, 200, 'caption') },
    findings: arr(s.findings, 4, 'findings', 1).map((f) => (plain(f, 'finding'), {
      text: str(f.text, 300, 'finding.text'), tone: tone(f.tone, 'finding'), impact: num(f.impact, 'impact'), evidence: arr(f.evidence || [], 8, 'evidence').map(evidence),
    })),
    actions: arr(s.actions || [], 3, 'actions').map((a) => {
      plain(a, 'action');
      need(ACTION_KINDS.includes(a.kind), 'action.kind');
      need(a.payload === undefined || (a.payload && typeof a.payload === 'object'), 'action.payload');
      const payload = a.payload ? JSON.parse(JSON.stringify(a.payload)) : {};
      need(JSON.stringify(payload).length <= 4000, 'action.payload too large');
      return { id: str(a.id, 80, 'action.id'), label: str(a.label, 80, 'action.label'), kind: a.kind, payload, preview: str(a.preview, 300, 'action.preview'), undoable: a.undoable !== false };
    }),
    followUps: arr(s.followUps || [], 4, 'followUps').map((f) => (plain(f, 'followUp'), { label: str(f.label, 60, 'followUp.label'), text: str(f.text, 200, 'followUp.text') })),
    how: { text: str(s.how.text, 400, 'how.text'), inputs: arr(s.how.inputs || [], 10, 'how.inputs').map((p) => (need(Array.isArray(p) && p.length === 2, 'how input'), [str(String(p[0] ?? ''), 60, 'how label'), clean(p[1], 140)])) },
    confidence: (need(['high', 'medium', 'low'].includes(s.confidence), 'confidence'), s.confidence),
    sources: arr(s.sources || [], 8, 'sources').map((x) => str(x, 40, 'source')),
  };
  const ents = entities(s.entities);
  if (ents) out.entities = ents;
  for (let i = 1; i < out.findings.length; i++) need(out.findings[i - 1].impact >= out.findings[i].impact, 'findings sorted by impact');
  need(JSON.stringify(out).length <= maxBytes, `larger than ${maxBytes} bytes`);
  return out;
}
// The same check without throwing: [] when valid, otherwise the first problem.
export function storyProblems(s, opts) {
  try { validStory(s, opts); return []; } catch (e) { return [e.message]; }
}

// ---------- the verifiable claims of a story ----------
// numbers: [{ value, unit, src, direct }] – direct = written in kpis / visual / evidence; derived = differences, sums and
// shares of two direct numbers of the same unit (what a careful reader computes from them).
const quarterOfIso = (iso) => `${iso.slice(0, 4)}-Q${Math.floor((+iso.slice(5, 7) - 1) / 3) + 1}`;
export function isoWeekNo(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
export function storyFacts(story, { derived = true } = {}) {
  const numbers = [], dates = new Set(), keys = new Set(), ranks = new Set(), quarters = new Set();
  const teams = new Map(), projects = [], people = [];
  const addN = (value, unit, src) => { if (isNum(value)) numbers.push({ value, unit: unit || 'n', src, direct: true }); };
  const addD = (v) => { if (typeof v === 'string' && DATE_RE.test(v)) { dates.add(v); quarters.add(quarterOfIso(v)); } };
  const addK = (k) => { if (typeof k === 'string' && KEY_RE.test(k)) keys.add(k); };
  const ent = story.entities || {};
  for (const p of ent.projects || []) { projects.push(p); if (p.key) keys.add(p.key); if (isNum(p.rank)) ranks.add(p.rank); }
  for (const t of ent.teams || []) teams.set(String(t.name).toLowerCase(), t.name);
  for (const p of ent.people || []) people.push(p);
  if (story.subject?.kind === 'team' && story.subject.name) teams.set(story.subject.name.toLowerCase(), story.subject.name);
  const rankish = (label) => /\b(rang|rank)\b/i.test(String(label || ''));
  for (const k of story.kpis || []) { addN(k.value, k.unit, `kpi:${k.id}`); if (rankish(k.label) && isNum(k.value)) ranks.add(k.value); }
  for (const f of story.findings || []) for (const e of f.evidence || []) {
    addK(e.key);
    if (e.unit === 'date') addD(e.value); else if (e.unit === 'quarter') quarters.add(e.value); else { addN(e.value, e.unit, 'evidence'); if (rankish(e.label) && isNum(e.value)) ranks.add(e.value); }
  }
  const v = story.visual || {}, d = v.data || {};
  const unit = d.unit;
  switch (v.kind) {
    case 'bars':
      for (const x of d.items || []) { addN(x.value, unit, 'visual'); addK(x.key); if (isNum(x.rank)) ranks.add(x.rank); }
      addN(d.target, unit, 'visual'); addN((d.items || []).length, 'n', 'visual');
      break;
    case 'columns': case 'line':
      for (const s of d.series || []) { for (const x of s.values || []) addN(x, unit, 'visual'); addN((s.values || []).reduce((a, x) => a + (x || 0), 0), unit, 'visual:sum'); }
      addN(d.target, unit, 'visual'); addN((d.labels || []).length, 'n', 'visual');
      break;
    case 'donut':
      for (const x of d.items || []) addN(x.value, unit, 'visual');
      addN(d.total, unit, 'visual');
      break;
    case 'heat':
      for (const r of d.rows || []) { addK(r.key); for (const x of r.values || []) addN(x, unit, 'visual'); }
      addN((d.rows || []).length, 'n', 'visual');
      break;
    case 'timeline':
      for (const e of d.events || []) { addD(e.date); addK(e.key); }
      addD(d.today);
      break;
    case 'gantt':
      for (const r of d.rows || []) { addD(r.start); addD(r.end); addK(r.key); if (r.before) { addD(r.before.start); addD(r.before.end); } }
      addD(d.today); addN((d.rows || []).length, 'n', 'visual');
      break;
    case 'compare':
      for (const r of d.rows || []) {
        if (r.unit === 'date') { addD(r.a); addD(r.b); } else {
          addN(r.a, r.unit, 'visual'); addN(r.b, r.unit, 'visual');
          if (rankish(r.label)) for (const x of [r.a, r.b]) if (isNum(x)) ranks.add(x);
          if (isNum(r.a) && isNum(r.b)) addN(Math.abs(r.b - r.a), r.unit, 'visual:diff');
        }
      }
      break;
    case 'waterline':
      for (const x of d.items || []) { addN(x.value, 'h', 'visual'); addN(x.cum, 'h', 'visual'); addK(x.key); if (isNum(x.rank)) ranks.add(x.rank); }
      addN(d.capacity, 'h', 'visual'); addN(d.support, 'h', 'visual');
      if (isNum(d.waterRank)) { ranks.add(d.waterRank); if (d.waterRank > 1) ranks.add(d.waterRank - 1); }
      if (d.quarter) quarters.add(d.quarter);
      if (d.team) teams.set(d.team.toLowerCase(), d.team);
      addN((d.items || []).length, 'n', 'visual');
      break;
    default: break;
  }
  if (typeof story.computedAt === 'string') addD(story.computedAt.slice(0, 10));
  if (derived) {
    const direct = numbers.filter((x) => x.unit !== 'n').slice(0, 70);
    for (let i = 0; i < direct.length; i++) {
      for (let j = i + 1; j < direct.length; j++) {
        const a = direct[i], b = direct[j];
        if (a.unit !== b.unit) continue;
        numbers.push({ value: Math.abs(a.value - b.value), unit: a.unit, src: 'derived', direct: false }, { value: a.value + b.value, unit: a.unit, src: 'derived', direct: false });
        if (a.unit === 'h' && a.value > 0 && b.value > 0) numbers.push({ value: (100 * Math.min(a.value, b.value)) / Math.max(a.value, b.value), unit: '%', src: 'derived', direct: false });
      }
      if (direct[i].unit === '%' && direct[i].value <= 100 && direct[i].value >= 0) numbers.push({ value: 100 - direct[i].value, unit: '%', src: 'derived', direct: false });
    }
  }
  const weeks = new Set([...dates].map(isoWeekNo));
  return { numbers, dates, keys, ranks, quarters, weeks, teams, projects, people };
}
