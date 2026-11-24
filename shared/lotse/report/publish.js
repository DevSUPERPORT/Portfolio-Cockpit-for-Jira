// The composed report leaves the browser – Confluence publishing and the per-person draft. Pure, DE + EN, no Forge.
//
//   cleanComposed(input)                  → the composer document as the server accepts it (validated, size-capped) – throws
//   verifyComposed(doc, fresh, { people }) → every section re-checked against a FRESH computation of the same report:
//       tokens whose fact changed (stale), numbers typed by hand that no fresh fact backs (unsourced – checkSection),
//       person names anywhere (person). The data blocks (KPIs, tables, charts) always come from the fresh computation.
//   composedStorage(verified, opts)       → Confluence storage format (XHTML); charts as tables with the same numbers
//   visualTable(visual, lang)             → { columns, rows } – one chart as a table (Confluence, screen readers)
//   cleanDraft(input) / DRAFT_MAX_BYTES   → the composer draft a person keeps on the server (slim, capped) or null
//
// Why tables and not pictures: chart images would be Confluence attachments, which need a further Confluence permission
// (write:attachment) the app does not ask for. Tables carry the same verified numbers; the PDF has the graphics.
import { plainText, tokensOf, checkSection, SECTION_IDS } from './compose.js';
import { localFmt, T } from '../narrate.js';

export const PUBLISH_LIMITS = Object.freeze({ bytes: 150_000, sections: 24, text: 6000, title: 160, facts: 160, factDisplay: 60 });
export const DRAFT_MAX_BYTES = 120_000;
const KINDS = ['summary', 'kpis', 'story', 'chart', 'table', 'risks', 'text'];
const UNITS = ['h', '%', 'd', 'n', 'eur', 'rank', 'quarter', 'date'];
const AUD = ['c-level', 'steering', 'team', 'project'];
const SEC_RE = /^(?:[a-zA-Z]{2,20}|text-\d{1,3})$/;
const FACT_RE = /^[A-Za-z0-9_.:-]{1,60}$/;
const REF_RE = /^(issue|space):\d{1,18}$/;
const TEAM_RE = /^[A-Za-z0-9:_-]{1,64}$/;
const Q_RE = /^\d{4}-Q[1-4]$/;
const BAD = new Set(['__proto__', 'constructor', 'prototype']);

export class PublishError extends Error { constructor(m) { super(m); this.code = 'INVALID'; } }
const need = (ok, m) => { if (!ok) throw new PublishError(m); };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).some((k) => BAD.has(k));
const str = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').slice(0, n);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function cleanFact(f) {
  need(isObj(f) && FACT_RE.test(String(f.id || '')), 'fact');
  need(UNITS.includes(f.unit), 'fact unit');
  const value = isNum(f.value) ? f.value : typeof f.value === 'string' && /^\d{4}-(Q[1-4]|\d{2}-\d{2})$/.test(f.value) ? f.value : null;
  need(value != null, 'fact value');
  return { id: f.id, label: str(f.label, 80), value, unit: f.unit, display: str(f.display, PUBLISH_LIMITS.factDisplay) };
}

// The document the composer sends: only what the person shaped (order, on/off, titles, text with chips) – the data
// blocks are never taken from the browser.
export function cleanComposed(input) {
  need(isObj(input), 'document');
  need(JSON.stringify(input).length <= PUBLISH_LIMITS.bytes, 'document too large');
  need(AUD.includes(input.audience), 'audience');
  need(Array.isArray(input.sections) && input.sections.length >= 1 && input.sections.length <= PUBLISH_LIMITS.sections, 'sections');
  const ids = new Set();
  const sections = input.sections.map((s) => {
    need(isObj(s) && SEC_RE.test(String(s.id || '')) && (SECTION_IDS.includes(s.id) || /^text(-\d+)?$/.test(s.id)), 'section id');
    need(!ids.has(s.id), 'section twice');
    ids.add(s.id);
    need(KINDS.includes(s.kind), 'section kind');
    need(typeof s.text === 'string' && s.text.length <= PUBLISH_LIMITS.text, 'section text');
    need(!Array.isArray(s.facts) || s.facts.length <= PUBLISH_LIMITS.facts, 'facts');
    return { id: s.id, kind: s.kind, title: str(s.title, PUBLISH_LIMITS.title).trim(), on: s.on !== false, text: str(s.text, PUBLISH_LIMITS.text), facts: (Array.isArray(s.facts) ? s.facts : []).map(cleanFact) };
  });
  const q = input.period && typeof input.period === 'object' ? input.period.quarter : input.period;
  return {
    audience: input.audience, lang: input.lang === 'en' ? 'en' : 'de',
    quarter: typeof q === 'string' && Q_RE.test(q) ? q : null,
    projectRef: typeof input.projectRef === 'string' && REF_RE.test(input.projectRef) ? input.projectRef : null,
    teamId: typeof input.teamId === 'string' && TEAM_RE.test(input.teamId) ? input.teamId : null,
    title: str(input.title, 200).trim(), subtitle: str(input.subtitle, 200).trim(),
    confidential: input.confidential !== false,
    sections,
  };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sameValue = (a, b) => (isNum(a) && isNum(b) ? Math.abs(a - b) < 1e-9 : String(a) === String(b));
const foldName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// people: display names; a name counts when it stands as whole words (case and accents ignored)
export function namesIn(text, people = []) {
  const t = ` ${foldName(text).replace(/[^a-z0-9ß]+/g, ' ')} `;
  return [...new Set(people.filter((n) => typeof n === 'string' && n.trim().length >= 4).filter((n) => t.includes(` ${foldName(n).replace(/[^a-z0-9ß]+/g, ' ').trim()} `)))];
}

// A section's text with every chip written out: fresh values where the fact still exists, the chip's own display
// otherwise (checked afterwards like typed text).
function render(text, clientFacts, freshFacts) {
  const cf = new Map(clientFacts.map((f) => [f.id, f]));
  const ff = new Map(freshFacts.map((f) => [f.id, f]));
  const stale = [];
  const out = String(text || '').replace(/\{\{([A-Za-z0-9_.:-]{1,60})\}\}/g, (_, id) => {
    const a = cf.get(id), b = ff.get(id);
    if (b) { if (a && !sameValue(a.value, b.value)) stale.push({ text: a.display, expected: b.display, label: b.label }); return b.display; }
    return a ? a.display : '';
  });
  return { text: out, stale };
}

// doc: cleanComposed(...) · fresh: draftReport({ ...same audience / period / team / project / lang, sections: ids })
// → { ok, problems: [{ section, title, kind: 'stale'|'unsourced'|'person', text, expected? }], sections: [...] }
export function verifyComposed(doc, fresh, { people = [] } = {}) {
  const L = doc.lang;
  const problems = [];
  const sections = [];
  const byId = new Map((fresh?.sections || []).map((s) => [s.id, s]));
  const push = (sec, kind, list) => { for (const x of list) problems.push({ section: sec.id, title: sec.title, kind, text: x.text, ...(x.expected ? { expected: x.expected } : {}) }); };
  for (const name of namesIn(`${doc.title} \n ${doc.subtitle}`, people)) problems.push({ section: null, title: doc.title, kind: 'person', text: name });
  for (const s of doc.sections) {
    if (!s.on) continue;
    const f = byId.get(s.id) || (/^text(-\d+)?$/.test(s.id) ? { id: s.id, kind: 'text', title: s.title, facts: [], data: {}, keys: [], entities: { projects: [], teams: [], people: [] }, tone: 'info' } : null);
    if (!f) { problems.push({ section: s.id, title: s.title, kind: 'unsourced', text: s.title }); continue; }
    const { text, stale } = render(s.text, s.facts, f.facts || []);
    push(s, 'stale', stale);
    const base = { ...f, lang: L };
    push(s, 'unsourced', checkSection({ ...base, text }).map((c) => ({ text: c.text, expected: c.expected })));
    if (s.title && s.title !== f.title) push(s, 'unsourced', checkSection({ ...base, text: s.title }).map((c) => ({ text: c.text, expected: c.expected })));
    for (const name of namesIn(`${s.title}\n${text}`, people)) problems.push({ section: s.id, title: s.title, kind: 'person', text: name });
    sections.push({ id: s.id, kind: f.kind || s.kind, title: s.title || f.title, text, tone: f.tone || 'info', data: f.data || {}, facts: f.facts || [] });
  }
  return { ok: problems.length === 0, problems: problems.slice(0, 40), sections };
}

// ---------- a chart as a table ----------
export function visualTable(v, lang = 'de') {
  const L = lang === 'en' ? 'en' : 'de';
  const F = localFmt(L);
  const d = v?.data || {};
  const u = (unit) => (x) => (x == null || !isNum(x) ? '–' : unit === '%' ? (L === 'en' ? `${F.n(x)}%` : `${F.n(x)} %`) : unit === 'h' ? `${F.n(x, Math.abs(x) < 10 && !Number.isInteger(x) ? 1 : 0)} h` : unit === 'd' ? `${F.n(x)} ${T(L, x === 1 ? 'Tag' : 'Tage', x === 1 ? 'day' : 'days')}` : unit === 'eur' ? `${F.n(x)} €` : F.n(x, Number.isInteger(x) ? 0 : 1));
  const date = (x) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? (() => { const [y, m, dd] = x.slice(0, 10).split('-'); return L === 'en' ? `${+dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]} ${y}` : `${dd}.${m}.${y}`; })() : '–');
  const STATUS = { ok: T(L, 'besetzt', 'staffed'), partial: T(L, 'teilweise', 'partly'), no: T(L, 'nicht besetzt', 'not staffed') };
  switch (v?.kind) {
    case 'bars': return { columns: [T(L, 'Eintrag', 'Item'), T(L, 'Wert', 'Value')], rows: (d.items || []).map((x) => [x.rank != null ? `${x.rank} · ${x.label}` : x.label, u(d.unit)(x.value) + (x.sub ? ` (${x.sub})` : '')]) };
    case 'columns': case 'line': return { columns: ['', ...(d.series || []).map((s) => s.name)], rows: (d.labels || []).map((l, k) => [l, ...(d.series || []).map((s) => u(d.unit)(s.values?.[k]))]) };
    case 'donut': return { columns: [T(L, 'Anteil', 'Share'), T(L, 'Wert', 'Value')], rows: [...(d.items || []).map((x) => [x.label, u(d.unit)(x.value)]), ...(isNum(d.total) ? [[T(L, 'Gesamt', 'Total'), u(d.unit)(d.total)]] : [])] };
    case 'heat': return { columns: ['', ...(d.cols || [])], rows: (d.rows || []).map((r) => [r.label, ...(r.values || []).map((x) => u(d.unit)(x))]) };
    case 'waterline': return { columns: [T(L, 'Rang', 'Rank'), T(L, 'Projekt', 'Project'), T(L, 'Bedarf', 'Demand'), T(L, 'Kumuliert', 'Cumulative'), 'Status'], rows: (d.items || []).map((x) => [String(x.rank ?? ''), x.label, u('h')(x.value), u('h')(x.cum), STATUS[x.status] || '–']) };
    case 'compare': return { columns: ['', d.a?.label || 'A', d.b?.label || 'B'], rows: (d.rows || []).map((r) => [r.label, r.unit === 'date' ? date(r.a) : u(r.unit)(r.a), r.unit === 'date' ? date(r.b) : u(r.unit)(r.b)]) };
    case 'gantt': return { columns: ['', T(L, 'Beginn', 'Start'), T(L, 'Ende', 'End')], rows: (d.rows || []).map((r) => [r.label, date(r.start), date(r.end)]) };
    case 'timeline': return { columns: [T(L, 'Datum', 'Date'), T(L, 'Ereignis', 'Event')], rows: (d.events || d.items || []).map((e) => [date(e.date), e.label]) };
    default: return { columns: [], rows: [] };
  }
}

// ---------- Confluence storage format ----------
const COLOUR = { bad: 'Red', warn: 'Yellow', ok: 'Green', info: 'Blue', soft: 'Grey' };
const lozenge = (txt, colour) => `<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">${colour}</ac:parameter><ac:parameter ac:name="title">${esc(txt)}</ac:parameter></ac:structured-macro>`;
function table(columns, rows, { tones = null } = {}) {
  if (!rows.length) return '';
  const head = columns.some((c) => c) ? `<tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>` : '';
  return `<table><tbody>${head}${rows.map((r, i) => `<tr>${r.map((c, j) => `<td>${j === r.length - 1 && tones?.[i] ? lozenge(c, COLOUR[tones[i]] || 'Grey') : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function paragraphs(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const l of lines) {
    const num = /^\d{1,2}\.\s+(.*)$/.exec(l), dash = /^[–•-]\s+(.*)$/.exec(l);
    const kind = num ? 'ol' : dash ? 'ul' : null;
    if (kind) { if (list !== kind) { close(); html += `<${kind}>`; list = kind; } html += `<li>${esc((num || dash)[1])}</li>`; } else { close(); html += `<p>${esc(l)}</p>`; }
  }
  close();
  return html;
}
// verified: verifyComposed(...) · opts: { lang, title, subtitle, asOf, confidential, people }
export function composedStorage(verified, { lang = 'de', subtitle = '', asOf = null, confidential = true, people = [] } = {}) {
  const L = lang === 'en' ? 'en' : 'de';
  const F = localFmt(L);
  const tone = { ok: T(L, 'im Plan', 'on track'), warn: T(L, 'Achtung', 'watch'), bad: T(L, 'kritisch', 'critical'), info: T(L, 'Hinweis', 'note') };
  const unit = (k) => (k.unit === '%' ? (L === 'en' ? `${F.n(k.value)}%` : `${F.n(k.value)} %`) : k.unit === 'h' ? F.h(k.value, Math.abs(k.value) < 10 ? 1 : 0) : k.unit === 'd' ? `${F.n(k.value)} ${T(L, k.value === 1 ? 'Tag' : 'Tage', k.value === 1 ? 'day' : 'days')}` : k.unit === 'eur' ? `${F.n(k.value)} €` : F.n(k.value, Number.isInteger(k.value) ? 0 : 1));
  const clean = (rows) => { const keep = rows.filter((r) => !r.some((c) => namesIn(c, people).length)); return { rows: keep, dropped: rows.length - keep.length }; };
  const day = asOf ? new Date(asOf).toISOString().slice(0, 10) : null;
  let html = `<p><em>${esc(T(L, 'Stand', 'As of'))} ${esc(day ? (L === 'en' ? day : day.split('-').reverse().join('.')) : '–')}${subtitle ? ` · ${esc(subtitle)}` : ''} · ${esc(T(L, 'erstellt mit Lotse im SUPERPORT Portfolio Cockpit – jede Zahl beim Veröffentlichen gegen die aktuellen Daten geprüft', 'written with Lotse in SUPERPORT Portfolio Cockpit – every number checked against the current data when published'))}</em></p>`;
  if (confidential) html += `<p><strong>${esc(T(L, 'Vertraulich – nur für den internen Gebrauch', 'Confidential – internal use only'))}</strong></p>`;
  let charts = 0;
  for (const s of verified.sections || []) {
    const d = s.data || {};
    html += `<h2>${esc(s.title)}${s.kind !== 'text' ? ` ${lozenge(tone[s.tone] || tone.info, COLOUR[s.tone] || 'Grey')}` : ''}</h2>`;
    if (s.kind !== 'risks') html += paragraphs(s.text);
    if (s.kind === 'kpis' && d.tiles?.length) html += `<table><tbody><tr>${d.tiles.map((t) => `<th>${esc(t.label)}</th>`).join('')}</tr><tr>${d.tiles.map((t) => `<td><strong>${esc(t.display)}</strong>${t.sub ? `<br/><em>${esc(t.sub)}</em>` : ''}</td>`).join('')}</tr></tbody></table>`;
    else if (s.kind === 'table') {
      const { rows } = clean((d.rows || []).map((r) => r.cells || []));
      html += rows.length ? table(d.columns || [], rows, { tones: (d.rows || []).filter((r) => !(r.cells || []).some((c) => namesIn(c, people).length)).map((r) => r.tone) }) : `<p>${esc(d.empty || '')}</p>`;
    } else if (s.kind === 'risks') {
      if (d.items?.length) html += `<ul>${d.items.map((it) => `<li><strong>${esc(it.title)}:</strong> ${esc(plainText(it.text, s.facts))}</li>`).join('')}</ul>`;
      if (s.text.trim()) html += `<h3>${esc(T(L, 'Zu entscheiden', 'Decisions needed'))}</h3>${paragraphs(s.text)}`;
    } else {
      if (s.kind === 'story' && d.kpis?.length) html += table([T(L, 'Kennzahl', 'Figure'), T(L, 'Wert', 'Value')], d.kpis.slice(0, 4).filter((k) => isNum(k.value)).map((k) => [k.label, unit(k)]));
      if (d.visual) {
        const t = visualTable(d.visual, L);
        const { rows, dropped } = clean(t.rows);
        if (rows.length) { charts += 1; html += table(t.columns, rows); }
        if (dropped) html += `<p><em>${esc(T(L, `${dropped} ${dropped === 1 ? 'Zeile' : 'Zeilen'} mit Personen ausgelassen.`, `${dropped} ${dropped === 1 ? 'row' : 'rows'} with people left out.`))}</em></p>`;
        if (d.visual.caption && !namesIn(d.visual.caption, people).length) html += `<p><em>${esc(d.visual.caption)}</em></p>`;
      }
    }
  }
  if (charts) html += `<hr/><p><em>${esc(T(L, 'Diagramme stehen hier als Tabellen mit denselben Zahlen; die grafische Fassung enthält der PDF-Export des Report-Composers.', 'Charts appear here as tables with the same numbers; the PDF export of the report composer has the graphics.'))}</em></p>`;
  return html;
}
// What a withdrawn page shows (undo of a first publish: the app may create and update pages, not delete them).
export function withdrawnStorage(lang = 'de') {
  const L = lang === 'en' ? 'en' : 'de';
  return `<p><em>${esc(T(L, 'Dieser Report wurde im Portfolio Cockpit zurückgezogen. Die Seite kann in Confluence gelöscht werden; ihr Verlauf enthält die zurückgezogene Fassung.', 'This report was withdrawn in Portfolio Cockpit. The page can be deleted in Confluence; its history holds the withdrawn version.'))}</em></p>`;
}

// ---------- the draft on the server ----------
// Kept: what the person shaped (settings, order, on/off, titles, texts, chips, the data blocks as drafted). Dropped: the
// stories and name lists (recomputed in the browser). Unknown keys never get in; too large → null (the browser keeps it).
export function cleanDraft(input) {
  if (input === null) return null;
  if (!isObj(input) || !isObj(input.doc) || !Array.isArray(input.doc.sections)) return undefined;
  const d = input.doc;
  const st = isObj(input.settings) ? input.settings : {};
  const settings = {
    audience: AUD.includes(st.audience) ? st.audience : 'c-level',
    period: typeof st.period === 'string' && (Q_RE.test(st.period) || ['current', 'next'].includes(st.period)) ? st.period : 'current',
    teamId: typeof st.teamId === 'string' && TEAM_RE.test(st.teamId) ? st.teamId : null,
    projectRef: typeof st.projectRef === 'string' && REF_RE.test(st.projectRef) ? st.projectRef : null,
    lang: st.lang === 'en' ? 'en' : 'de', logo: st.logo !== false, confidential: st.confidential !== false,
  };
  let sections;
  try {
    sections = d.sections.slice(0, PUBLISH_LIMITS.sections).map((s) => {
      need(isObj(s) && SEC_RE.test(String(s.id || '')) && KINDS.includes(s.kind), 'section');
      return {
        id: s.id, kind: s.kind, title: str(s.title, PUBLISH_LIMITS.title), on: s.on !== false, text: str(s.text, PUBLISH_LIMITS.text),
        variants: Array.isArray(s.variants) ? s.variants.slice(0, 4).map((v) => str(v, PUBLISH_LIMITS.text)) : [],
        variant: Number.isInteger(s.variant) && s.variant >= 0 && s.variant < 4 ? s.variant : 0,
        facts: (Array.isArray(s.facts) ? s.facts.slice(0, PUBLISH_LIMITS.facts) : []).map(cleanFact),
        keys: (Array.isArray(s.keys) ? s.keys : []).filter((k) => typeof k === 'string' && /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/.test(k)).slice(0, 40),
        tone: ['ok', 'warn', 'bad', 'info'].includes(s.tone) ? s.tone : 'info',
        data: isObj(s.data) ? JSON.parse(JSON.stringify(s.data)) : {},
      };
    });
  } catch { return undefined; }
  const out = {
    v: 1, at: Number.isFinite(input.at) ? Math.round(input.at) : Date.now(), settings,
    doc: {
      v: Number.isInteger(d.v) ? d.v : 1, audience: settings.audience, lang: d.lang === 'en' ? 'en' : 'de',
      period: isObj(d.period) && Q_RE.test(String(d.period.quarter)) ? { quarter: d.period.quarter, label: str(d.period.label, 20) } : null,
      projectRef: typeof d.projectRef === 'string' && REF_RE.test(d.projectRef) ? d.projectRef : null,
      teamId: typeof d.teamId === 'string' && TEAM_RE.test(d.teamId) ? d.teamId : null,
      title: str(d.title, 200), subtitle: str(d.subtitle, 200), asOf: typeof d.asOf === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(d.asOf) ? d.asOf.slice(0, 30) : null,
      published: isObj(d.published) && /^\d{1,18}$/.test(String(d.published.pageId)) ? { pageId: String(d.published.pageId), spaceId: String(d.published.spaceId || '').replace(/\D/g, '').slice(0, 18), url: str(d.published.url, 400), at: str(d.published.at, 30) } : null,
      sections,
    },
  };
  if (JSON.stringify(out).length > DRAFT_MAX_BYTES) { for (const s of out.doc.sections) s.variants = []; }
  if (JSON.stringify(out).length > DRAFT_MAX_BYTES) return undefined;
  return out;
}
