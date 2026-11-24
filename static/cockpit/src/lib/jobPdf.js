// The document of a Lotse job (shared/lotse/report/jobDoc.js) as a typeset A4 PDF – the same look as the C-level report
// and the report composer: SUPERPORT band, Helvetica, the brand colours, vector charts (the charts are drawn by the
// composer's own chart layout, components/report/pdfLayout.js), page numbers and the "Stand" footer.
//
//   layoutJob(doc, { measure }) → { pages: [{ ops }], toc: [{ heading, page }] }   PURE – tests check it without a PDF
//   downloadJobPdf(doc, { each }) → { name, pages }                                jsPDF (loaded on demand) + paint()
//
// Pages: cover (title, scope, recipients, author, date, contents) · overview · one page (or more) per recipient with
// greeting, key figures, week chart, tables, findings, suggestions and a sign-off · appendix "Nachweis / Proof" (every
// figure: values, formula, inputs, Jira keys). `each` = also one PDF per recipient (only their section and its proof).
import { PAGE, C, clean, approxMeasure, layoutVisual, paint, asOfText } from '../components/report/pdfLayout.js';
import { sectionDoc } from '../../../../shared/lotse/report/jobDoc.js'; // relative: also runs in Node tests
import { drawLogo } from './pdfLogo.js';
import { pdfSink } from './pdf.js';

const { W, H, M } = PAGE;
const CW = W - 2 * M;
const FOOT = 16;
const T = (L, de, en) => (L === 'en' ? en : de);
const TONE = { ok: 'ok', warn: 'warn', bad: 'bad', info: 'info' };

export function layoutJob(doc, { measure = approxMeasure } = {}) {
  const L = doc.lang === 'en' ? 'en' : 'de';
  const pages = [];
  const toc = [];
  let ops, y;
  const text = (t, x, yy, size, style = 'normal', color = 'ink', align) => ops.push({ op: 'text', x, y: yy, text: clean(t), size, style, color: C[color] || color, ...(align ? { align } : {}) });
  const rect = (x, yy, w, h, fill, extra = {}) => ops.push({ op: 'rect', x, y: yy, w, h, fill: C[fill] || fill, ...extra });
  const line = (x1, y1, x2, y2, color = 'line', w = 0.2) => ops.push({ op: 'line', x1, y1, x2, y2, color: C[color] || color, w });
  const fit = (t, size, width, style) => { let s = clean(t); if (measure(s, size, style) <= width) return s; while (s.length > 1 && measure(`${s}…`, size, style) > width) s = s.slice(0, -1); return `${s}…`; };
  const wrap = (t, size, width, style = 'normal') => {
    const out = [];
    for (const para of clean(t).split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      let ln = '';
      for (const w0 of words) { const nx = ln ? `${ln} ${w0}` : w0; if (measure(nx, size, style) <= width || !ln) ln = nx; else { out.push(ln); ln = w0; } }
      out.push(ln);
    }
    return out;
  };
  const room = () => H - FOOT - y;
  const newPage = (head = true) => {
    ops = [];
    pages.push({ ops });
    y = M;
    if (head) {
      text(fit(doc.title, 7.5, CW - 40, 'bold'), M, 11, 7.5, 'bold', 'ink3');
      text('LOTSE', W - M, 11, 7, 'bold', 'accent', 'right');
      line(M, 13.5, W - M, 13.5);
      y = 21;
    }
  };
  const ensure = (h) => { if (h > room()) newPage(); };
  const para = (t, size = 9.6, color = 'ink', style = 'normal', gap = 4.6) => { for (const ln of wrap(t, size, CW, style)) { ensure(gap + 1); text(ln, M, y, size, style, color); y += gap; } };
  const heading = (t, tone = 'ink', sub) => {
    ensure(22);
    rect(M, y - 5.2, 1.4, 7.4, TONE[tone] || 'ink');
    text(fit(t, 15, CW - 6, 'bold'), M + 4.5, y, 15, 'bold', 'ink');
    y += 5.4;
    if (sub) { text(fit(sub, 8.2, CW - 6), M + 4.5, y, 8.2, 'normal', 'ink2'); y += 5; }
    y += 2;
  };
  const tiles = (kpis) => {
    const list = (kpis || []).slice(0, 4);
    if (!list.length) return;
    const gap = 3.5, tw = (CW - gap * (list.length - 1)) / list.length, th = 19;
    ensure(th + 4);
    list.forEach((k, i) => {
      const x = M + i * (tw + gap);
      rect(x, y, tw, th, 'band', { stroke: C.line, r: 2.2 });
      if (k.tone && TONE[k.tone]) rect(x, y + 3, 1.1, th - 6, TONE[k.tone]);
      text(fit(String(k.label).toUpperCase(), 6.3, tw - 7, 'bold'), x + 4, y + 5.6, 6.3, 'bold', 'ink2');
      text(fit(k.display, 15, tw - 7, 'bold'), x + 4, y + 14.4, 15, 'bold', k.tone === 'bad' ? 'bad' : k.tone === 'warn' ? 'warn' : 'ink');
    });
    y += th + 5;
  };
  const chart = (visual) => {
    if (!visual) return;
    const v = layoutVisual({ kind: 'story', data: { visual } }, { lang: L, measure });
    if (!v.ops.length) return;
    ensure(v.height + 2);
    const top = y;
    for (const o of v.ops) {
      if (o.op === 'line') ops.push({ ...o, y1: o.y1 + top, y2: o.y2 + top });
      else if (o.op === 'poly') ops.push({ ...o, pts: o.pts.map(([px, py]) => [px, py + top]) });
      else ops.push({ ...o, y: o.y + top });
    }
    y += v.height + 3;
  };
  const table = (t) => {
    const cols = t.columns || [];
    const n = cols.length;
    if (!n) return;
    ensure(12);
    text(t.title, M, y + 1, 9.4, 'bold', 'ink');
    y += 4;
    if (!t.rows?.length) { text(t.empty || '–', M, y + 3, 8.4, 'normal', 'ok'); y += 8; return; }
    // the widest column is the free text (a story's summary); figures stay narrow
    const weights = cols.map((c, i) => (t.id === 'tasks' ? [1.3, 3.6, 1.9, 1, 1.9][i] ?? 1 : t.id === 'overdue' ? [1.2, 3.4, 1.8, 1, 1.4][i] ?? 1 : t.id === 'absences' ? [1.4, 2.2, 2.4][i] ?? 1 : 1));
    const tot = weights.reduce((a, b) => a + b, 0);
    const ws = weights.map((w) => (w / tot) * CW);
    const xs = ws.map((_, i) => M + ws.slice(0, i).reduce((a, b) => a + b, 0));
    const rh = 6;
    const head = () => { rect(M, y, CW, rh, 'ink'); cols.forEach((c, i) => { const al = t.align?.[i]; text(fit(c, 7, ws[i] - 3, 'bold'), al === 'r' ? xs[i] + ws[i] - 1.8 : xs[i] + 1.8, y + 4.1, 7, 'bold', 'white', al === 'r' ? 'right' : undefined); }); y += rh; };
    ensure(rh * Math.min(4, t.rows.length + 1));
    head();
    t.rows.forEach((r, k) => {
      if (rh > room()) { newPage(); head(); }
      if (r.tone === 'bad') rect(M, y, CW, rh, 'badSoft'); else if (r.tone === 'warn') rect(M, y, CW, rh, 'warnSoft'); else if (k % 2) rect(M, y, CW, rh, 'band');
      r.cells.forEach((c, i) => {
        const al = t.align?.[i];
        const col = i === n - 1 && r.tone === 'bad' ? 'bad' : i === n - 1 && r.tone === 'warn' ? 'warn' : 'ink';
        text(fit(c.text, 7.6, ws[i] - 3, i === 0 ? 'bold' : 'normal'), al === 'r' ? xs[i] + ws[i] - 1.8 : xs[i] + 1.8, y + 4.1, 7.6, i === 0 ? 'bold' : 'normal', col, al === 'r' ? 'right' : undefined);
      });
      line(M, y + rh, M + CW, y + rh, 'line', 0.12);
      y += rh;
    });
    if (t.more) { text(T(L, `+ ${t.more} weitere`, `+ ${t.more} more`), M, y + 3.6, 7, 'normal', 'ink3'); y += 4; }
    y += 5;
  };
  const findings = (list, title) => {
    if (!list?.length) return;
    ensure(14);
    text(title, M, y + 1, 9.4, 'bold', 'ink');
    y += 5;
    for (const f of list) {
      const lines = wrap(f.text, 8.8, CW - 6);
      ensure(lines.length * 4.2 + 1.5);
      ops.push({ op: 'circle', x: M + 1.3, y: y - 1.2, r: 0.95, fill: C[TONE[f.tone] || 'ink'] || C.ink });
      lines.forEach((ln, i) => text(ln, M + 4.5, y + i * 4.2, 8.8, 'normal', 'ink'));
      y += lines.length * 4.2 + 1.6;
    }
    y += 2.5;
  };
  const suggestions = (list) => {
    if (!list?.length) return;
    const rows = list.map((s) => ({ lines: wrap(s.text, 8.8, CW - 12), ask: s.ask ? T(L, `Frag Lotse: „${s.ask}“`, `Ask Lotse: "${s.ask}"`) : null }));
    const h = 9 + rows.reduce((a, r) => a + r.lines.length * 4.2 + (r.ask ? 3.8 : 0) + 1.8, 0);
    ensure(h + 2);
    rect(M, y, CW, h, 'accentSoft', { r: 2.2 });
    rect(M, y + 2.5, 1.2, h - 5, 'accent');
    text(T(L, 'VORSCHLÄGE', 'SUGGESTIONS'), M + 5, y + 5.6, 7, 'bold', 'accent');
    let yy = y + 10.4;
    for (const r of rows) {
      text('->', M + 5, yy, 8.8, 'bold', 'accent');
      r.lines.forEach((ln, i) => text(ln, M + 10, yy + i * 4.2, 8.8, 'normal', 'ink'));
      yy += r.lines.length * 4.2;
      if (r.ask) { text(fit(r.ask, 7.4, CW - 14), M + 10, yy, 7.4, 'normal', 'ink2'); yy += 3.8; }
      yy += 1.8;
    }
    y += h + 4;
  };

  // ---------- cover ----------
  newPage(false);
  rect(0, 0, W, 78, 'ink');
  rect(0, 78, W, 1.4, 'accent');
  ops.push({ op: 'logo', x: M, y: 16, size: 18 });
  text('SUPERPORT · PORTFOLIO COCKPIT', M + 24, 22, 7.5, 'bold', 'accent');
  text(T(L, 'Lotse-Auftrag', 'Lotse job'), M + 24, 27.5, 8.5, 'normal', [200, 198, 192]);
  const tl = wrap(doc.cover.title, 23, CW, 'bold').slice(0, 2);
  tl.forEach((l, i) => text(l, M, 46 + i * 9, 23, 'bold', 'white'));
  text(fit(doc.cover.subtitle, 9.5, CW), M, 46 + tl.length * 9 + 1, 9.5, 'normal', [200, 198, 192]);
  text(T(L, 'Vertraulich – nur für den internen Gebrauch', 'Confidential – internal use only'), W - M, 12, 7.2, 'normal', [200, 198, 192], 'right');
  y = 94;
  for (const [k, v] of doc.cover.lines) {
    const vl = wrap(v, 9.6, CW - 42).slice(0, 3);
    text(String(k).toUpperCase(), M, y, 7, 'bold', 'ink3');
    vl.forEach((ln, i) => text(ln, M + 42, y + i * 4.6, 9.6, i ? 'normal' : 'bold', 'ink'));
    y += Math.max(1, vl.length) * 4.6 + 3.2;
  }
  y += 4;
  rect(M, y - 4.5, CW, 0.3, 'line');
  y += 5;
  para(doc.cover.intro, 10, 'ink2', 'normal', 5);
  y += 6;
  text(T(L, 'INHALT', 'CONTENTS'), M, y, 7, 'bold', 'ink3');
  y += 6;
  const tocAt = { page: 0, y };
  // ---------- overview ----------
  if (doc.overview) {
    newPage();
    toc.push({ heading: doc.overview.heading, page: pages.length });
    heading(doc.overview.heading, 'ink', doc.subtitle);
    para(doc.overview.paragraphs.join(' '), 10, 'ink', 'normal', 4.9);
    y += 3;
    tiles(doc.overview.kpis);
    chart(doc.overview.visual);
    findings(doc.overview.findings, T(L, 'Was auffällt', 'What stands out'));
  }
  // ---------- one page per recipient ----------
  for (const s of doc.sections) {
    newPage();
    toc.push({ heading: s.heading, page: pages.length, tone: s.tone });
    const toneWord = { bad: T(L, 'Handlungsbedarf', 'Action needed'), warn: T(L, 'Im Blick behalten', 'Keep an eye on'), ok: T(L, 'Im Plan', 'On track') }[s.tone] || '';
    heading(s.heading, s.tone, `${toneWord} · ${doc.subtitle}`);
    para(s.greeting, 10, 'ink', 'bold', 5);
    para(s.paragraphs.join(' '), 9.8, 'ink', 'normal', 4.8);
    y += 3;
    tiles(s.kpis);
    chart(s.visual);
    for (const t of s.tables) table(t);
    findings(s.findings, T(L, 'Was auffällt', 'What stands out'));
    suggestions(s.suggestions);
    ensure(14);
    text(doc.tone === 'formal' ? T(L, 'Freundliche Grüße', 'Kind regards') : T(L, 'Viele Grüße', 'Best'), M, y + 2, 9.4, 'normal', 'ink');
    if (doc.author) text(doc.author, M, y + 7, 9.4, 'bold', 'ink');
    y += 12;
  }
  // ---------- appendix: proof ----------
  newPage();
  toc.push({ heading: T(L, 'Nachweis', 'Proof'), page: pages.length });
  heading(T(L, 'Nachweis – woher jede Zahl kommt', 'Proof – where every number comes from'), 'ink', T(L, `${doc.proof.length} Belege · Quellen: ${doc.sources.join(', ')}`, `${doc.proof.length} entries · sources: ${doc.sources.join(', ')}`));
  const pw = [10, 44, 46, CW - 10 - 44 - 46];
  const px = pw.map((_, i) => M + pw.slice(0, i).reduce((a, b) => a + b, 0));
  const phead = () => { rect(M, y, CW, 6, 'ink'); [T(L, 'Nr.', 'No.'), T(L, 'Zahl', 'Figure'), T(L, 'Werte', 'Values'), T(L, 'Formel · Eingaben · Jira-Keys', 'Formula · inputs · Jira keys')].forEach((h, i) => text(h, px[i] + 1.5, y + 4.1, 7, 'bold', 'white')); y += 6; };
  phead();
  doc.proof.forEach((p, k) => {
    const c1 = wrap(p.label, 6.8, pw[1] - 3, 'bold');
    const c2 = p.values.map(([a, b]) => `${a}: ${b}`).flatMap((t) => wrap(t, 6.6, pw[2] - 3));
    const c3 = [...wrap(p.formula, 6.4, pw[3] - 3), ...p.inputs.map(([a, b]) => `${a}: ${b}`).flatMap((t) => wrap(t, 6.4, pw[3] - 3)), ...(p.keys.length ? wrap(`Jira: ${p.keys.slice(0, 24).join(', ')}${p.keys.length > 24 ? ' …' : ''}`, 6.4, pw[3] - 3) : []), ...(p.source ? wrap(`${T(L, 'Quelle', 'Source')}: ${p.source}`, 6.4, pw[3] - 3) : [])];
    const n = Math.max(c1.length, c2.length, c3.length);
    const h = n * 3.1 + 2.6;
    if (h > room()) { newPage(); phead(); }
    if (k % 2) rect(M, y, CW, h, 'band');
    text(String(k + 1), px[0] + 1.5, y + 3.6, 6.8, 'bold', 'ink2');
    c1.forEach((l, i) => text(l, px[1] + 1.5, y + 3.6 + i * 3.1, 6.8, 'bold', 'ink'));
    c2.forEach((l, i) => text(l, px[2] + 1.5, y + 3.6 + i * 3.1, 6.6, 'normal', 'ink'));
    c3.forEach((l, i) => text(l, px[3] + 1.5, y + 3.6 + i * 3.1, 6.4, 'normal', i < wrap(p.formula, 6.4, pw[3] - 3).length ? 'ink' : 'ink2'));
    line(M, y + h, M + CW, y + h, 'line', 0.12);
    y += h;
  });
  // ---------- contents on the cover (now that the pages are known) ----------
  const cover = pages[0].ops;
  let ty = tocAt.y;
  for (const e of toc) {
    cover.push({ op: 'text', x: M, y: ty, text: clean(e.heading), size: 9.6, style: 'normal', color: C.ink });
    cover.push({ op: 'text', x: W - M, y: ty, text: String(e.page), size: 9.6, style: 'bold', color: C.ink2, align: 'right' });
    cover.push({ op: 'line', x1: M + measure(clean(e.heading), 9.6) + 2, y1: ty - 0.8, x2: W - M - 8, y2: ty - 0.8, color: C.line, w: 0.15, dash: [0.5, 1] });
    ty += 5.2;
    if (ty > H - FOOT - 6) break;
  }
  // ---------- footers ----------
  const asOf = asOfText(doc.asOf, L);
  pages.forEach((p, i) => {
    p.ops.push({ op: 'line', x1: M, y1: H - 11, x2: W - M, y2: H - 11, color: C.line, w: 0.2 });
    p.ops.push({ op: 'logo', x: M, y: H - 9.6, size: 4, tile: C.ink });
    p.ops.push({ op: 'text', x: M + 5.6, y: H - 7, text: clean(`SUPERPORT Portfolio Cockpit · Lotse · ${T(L, 'vertraulich', 'confidential')}`), size: 7, style: 'normal', color: C.ink2 });
    p.ops.push({ op: 'text', x: W / 2 + 12, y: H - 7, text: clean(`${T(L, 'Stand', 'As of')} ${asOf}`), size: 7, style: 'normal', color: C.ink2, align: 'center' });
    p.ops.push({ op: 'text', x: W - M, y: H - 7, text: `${T(L, 'Seite', 'Page')} ${i + 1} / ${pages.length}`, size: 7, style: 'normal', color: C.ink2, align: 'right' });
  });
  return { pages, toc, lang: L };
}

// The text of a page in reading order (tests, search).
export const jobPageText = (page) => page.ops.filter((o) => o.op === 'text').map((o) => o.text).join(' ');
export const jobFileName = (doc) => `${String(doc.title || 'lotse').toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'lotse'}-${String(doc.today || doc.asOf || '').slice(0, 10)}.pdf`;

async function render(doc) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const measure = (t, size, style = 'normal') => { pdf.setFont('helvetica', style); pdf.setFontSize(size); return pdf.getTextWidth(String(t)); };
  const layout = layoutJob(doc, { measure });
  pdf.setProperties({ title: clean(doc.title), subject: clean(doc.subtitle || ''), author: clean(doc.author || 'Lotse'), creator: 'SUPERPORT Portfolio Cockpit · Lotse' });
  paint(pdf, layout, drawLogo);
  return { pdf, layout };
}
function save(blob, name, pdf, layout) {
  if (pdfSink.save) return pdfSink.save(blob, name, pdf, layout);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
  return null;
}
// The whole document (and, with each, one PDF per recipient – downloaded one after another).
export async function downloadJobPdf(doc, { each = false } = {}) {
  const { pdf, layout } = await render(doc);
  const name = jobFileName(doc);
  await save(pdf.output('blob'), name, pdf, layout);
  const out = { name, pages: layout.pages.length, files: [name] };
  if (each) for (const s of doc.sections) { const r = await downloadSectionPdf(doc, s.id); if (r) out.files.push(r.name); }
  // the last one, for tests and the result card
  if (typeof window !== 'undefined') window.__lotseJobPdf = { name, pages: layout.pages.length, files: out.files, toc: layout.toc };
  return out;
}
// The personal PDF of one recipient: only their section and the proof of its numbers.
export async function downloadSectionPdf(doc, sectionId) {
  const one = sectionDoc(doc, sectionId);
  if (!one) return null;
  const { pdf, layout } = await render(one);
  const name = jobFileName(one);
  await save(pdf.output('blob'), name, pdf, layout);
  return { name, pages: layout.pages.length };
}
