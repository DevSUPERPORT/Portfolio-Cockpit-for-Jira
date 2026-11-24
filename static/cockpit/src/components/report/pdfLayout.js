// The composed report as A4 portrait pages – a PURE layout: the document (shared/lotse/report/compose.js) in, a list of
// pages with drawing operations out (text, rect, line, circle, polygon, logo). paint() puts them on a jsPDF document;
// tests check the layout without a PDF. Charts are vectors (bars, columns, lines, donut slices, waterline, heat, gantt),
// so they stay sharp when printed. Helvetica (WinAnsi): text is cleaned to printable characters.
import { localFmt } from '../../../../../shared/lotse/narrate.js'; // relative: also runs in Node tests
import { plainText } from '../../../../../shared/lotse/report/compose.js';

export const PAGE = { W: 210, H: 297, M: 18, FOOT: 16 };
const { W, H, M } = PAGE;
const CW = W - 2 * M;
export const C = {
  ink: [38, 39, 41], ink2: [107, 104, 96], ink3: [150, 146, 138], line: [224, 221, 214], band: [251, 250, 248], sunken: [242, 239, 233],
  accent: [227, 75, 4], accentSoft: [252, 233, 223], ok: [47, 125, 87], okSoft: [226, 240, 231], warn: [184, 122, 0], warnSoft: [251, 239, 210],
  bad: [194, 50, 31], badSoft: [249, 224, 218], info: [61, 91, 166], infoSoft: [230, 236, 247], white: [255, 255, 255], muted: [202, 198, 187],
};
const TONE = { ok: 'ok', warn: 'warn', bad: 'bad', info: 'info', ink: 'ink', muted: 'muted', accent: 'accent' };
const SERIES = ['ink', 'accent', 'info', 'warn'];
export const clean = (s) => String(s ?? '').replace(/[→⇒]/g, '->').replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[✓✔]/g, 'OK').replace(/[−]/g, '-').replace(/[∞]/g, 'inf.').replace(/ | /g, ' ').replace(/[^\u0000-ÿ€„“”‘’–—•…]/g, '');
const T = (L, de, en) => (L === 'en' ? en : de);
// Helvetica's average advance ≈ 0.5 em; good enough for a layout preview (paint() passes the exact jsPDF measure)
export const approxMeasure = (text, size, style = 'normal') => String(text).length * size * (style === 'bold' ? 0.53 : 0.5) * 0.3528;

// ---------- the layout ----------
export function layoutReport(doc, { branding = {}, measure = approxMeasure, chartOnly = false } = {}) {
  const L = doc.lang === 'en' ? 'en' : 'de';
  const F = localFmt(L);
  const logo = branding.logo !== false, confidential = branding.confidential !== false;
  const pages = [];
  const sectionPages = {};
  let ops, y;
  const newPage = (first = false) => {
    ops = [];
    pages.push({ ops });
    y = first ? 0 : M;
    if (!first) {
      // a slim running head on follow-up pages
      text(clean(doc.title), M, 11, 7.5, 'bold', 'ink3');
      ops.push({ op: 'line', x1: M, y1: 13.5, x2: W - M, y2: 13.5, color: C.line, w: 0.2 });
      y = 21;
    }
  };
  const room = () => (chartOnly ? Infinity : H - PAGE.FOOT - y);
  const ensure = (h) => { if (h > room()) newPage(); };
  function text(t, x, yy, size, style = 'normal', color = 'ink', align) { ops.push({ op: 'text', x, y: yy, text: clean(t), size, style, color: C[color] || color, ...(align ? { align } : {}) }); }
  const rect = (x, yy, w, h, fill, extra = {}) => ops.push({ op: 'rect', x, y: yy, w, h, fill: C[fill] || fill, ...extra });
  function wrap(t, size, width, style = 'normal') {
    const out = [];
    for (const para of clean(t).split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      let line = '';
      for (const w0 of words) {
        const next = line ? `${line} ${w0}` : w0;
        if (measure(next, size, style) <= width || !line) line = next; else { out.push(line); line = w0; }
      }
      out.push(line);
    }
    return out;
  }
  const fit = (t, size, width, style) => { let s = clean(t); if (measure(s, size, style) <= width) return s; while (s.length > 1 && measure(`${s}…`, size, style) > width) s = s.slice(0, -1); return `${s}…`; };
  const unitFmt = (unit) => (v) => (v == null || !Number.isFinite(v) ? '–' : unit === '%' ? (L === 'en' ? `${F.n(v)}%` : `${F.n(v)} %`) : unit === 'h' ? `${F.n(v)} h` : unit === 'd' ? `${F.n(v)} ${T(L, v === 1 ? 'Tag' : 'Tage', v === 1 ? 'day' : 'days')}` : F.n(v, Number.isInteger(v) ? 0 : 1));

  // ---------- cover band ----------
  newPage(true);
  if (chartOnly) { for (const s of doc.sections || []) drawData(s); return { pages, sectionPages, lang: L, height: y }; }
  rect(0, 0, W, 44, 'ink');
  rect(0, 44, W, 1.2, 'accent');
  const tx = logo ? M + 24 : M;
  if (logo) ops.push({ op: 'logo', x: M, y: 12, size: 18 });
  text('SUPERPORT · PORTFOLIO COCKPIT', tx, 17, 7.5, 'bold', 'accent');
  const tLines = wrap(doc.title, 19, W - tx - M - 2, 'bold').slice(0, 2);
  tLines.forEach((l, i) => text(l, tx, 26 + i * 7.4, 19, 'bold', 'white'));
  const asOf = asOfText(doc.asOf, L);
  text(`${doc.subtitle || ''} · ${T(L, 'Stand', 'As of')} ${asOf}`, tx, 26 + tLines.length * 7.4 + 0.5, 8.5, 'normal', [200, 198, 192]);
  if (confidential) text(T(L, 'Vertraulich – nur für den internen Gebrauch', 'Confidential – internal use only'), W - M, 9, 7.2, 'normal', [200, 198, 192], 'right');
  y = 56;

  // ---------- sections ----------
  const on = (doc.sections || []).filter((s) => s.on !== false);
  for (const s of on) {
    const body = plainText(s);
    const paras = body ? wrap(body, 10, CW - 4) : [];
    // the heading never stands alone at the bottom of a page: heading + 3 lines (or the visual's start) together
    ensure(14 + Math.min(3, paras.length) * 4.9 + 8);
    sectionPages[s.id] = pages.length - 1;
    rect(M, y - 4.6, 1.3, 6.4, TONE[s.tone] || 'ink');
    text(s.title, M + 4, y, 13, 'bold', 'ink');
    y += 7;
    const writeParas = () => {
      for (const ln of paras) {
        ensure(5);
        const numbered = /^(\d{1,2}\.|–)\s/.test(ln);
        text(ln, M + (numbered ? 1 : 0), y, 10, 'normal', 'ink');
        y += 4.9;
      }
      if (paras.length) y += 2.5;
    };
    if (s.kind !== 'risks') writeParas();
    drawData(s);
    if (s.kind === 'risks' && paras.length) {
      ensure(12);
      text(T(L, 'Zu entscheiden', 'Decisions needed'), M, y + 1, 9, 'bold', 'accent');
      y += 6.5;
      writeParas();
    }
    y += 7;
  }

  // ---------- footers ----------
  const n = pages.length;
  pages.forEach((p, i) => {
    p.ops.push({ op: 'line', x1: M, y1: H - 11, x2: W - M, y2: H - 11, color: C.line, w: 0.2 });
    const fx = logo ? M + 5.6 : M;
    if (logo) p.ops.push({ op: 'logo', x: M, y: H - 9.6, size: 4, tile: C.ink });
    p.ops.push({ op: 'text', x: fx, y: H - 7, text: clean(`SUPERPORT Portfolio Cockpit${confidential ? ` · ${T(L, 'vertraulich', 'confidential')}` : ''}`), size: 7, style: 'normal', color: C.ink2 });
    p.ops.push({ op: 'text', x: W / 2, y: H - 7, text: clean(`${T(L, 'Stand', 'As of')} ${asOf}`), size: 7, style: 'normal', color: C.ink2, align: 'center' });
    p.ops.push({ op: 'text', x: W - M, y: H - 7, text: `${T(L, 'Seite', 'Page')} ${i + 1} / ${n}`, size: 7, style: 'normal', color: C.ink2, align: 'right' });
  });
  return { pages, sectionPages, lang: L };

  // ---------- data blocks ----------
  function drawData(s) {
    const d = s.data || {};
    if (s.kind === 'kpis' && d.tiles?.length) return tiles(d.tiles);
    if (s.kind === 'table') return table(d);
    if (s.kind === 'risks') return riskCards(d.items || [], s.facts || []);
    if (d.kpis?.length && s.kind === 'story') figures(d.kpis);
    if (d.visual) visual(d.visual);
  }
  function tiles(list) {
    const cols = 3, gap = 4, tw = (CW - gap * (cols - 1)) / cols, th = 24;
    for (let r = 0; r < Math.ceil(list.length / cols); r++) {
      ensure(th + 4);
      list.slice(r * cols, r * cols + cols).forEach((t, i) => {
        const x = M + i * (tw + gap);
        rect(x, y, tw, th, 'band', { stroke: C.line, r: 2.2 });
        if (t.tone) rect(x, y + 3, 1.1, th - 6, TONE[t.tone] || 'ink');
        text(fit(String(t.label).toUpperCase(), 6.6, tw - 7, 'bold'), x + 4, y + 6, 6.6, 'bold', 'ink2');
        if (t.kind === 'text') wrap(t.display, 8.4, tw - 7, 'bold').slice(0, 2).forEach((l, k) => text(l, x + 4, y + 12 + k * 3.8, 8.4, 'bold', 'ink'));
        else text(t.display, x + 4, y + 14.5, 16, 'bold', t.tone === 'bad' ? 'bad' : 'ink');
        wrap(t.sub || '', 6.3, tw - 7).slice(0, 2).forEach((l, k) => text(l, x + 4, y + 19 + k * 2.8, 6.3, 'normal', 'ink2'));
      });
      y += th + gap;
    }
    y += 1;
  }
  function figures(kpis) {
    const list = kpis.slice(0, 4);
    const w = CW / list.length;
    ensure(14);
    list.forEach((k, i) => {
      const x = M + i * w;
      text(unitFmt(k.unit)(k.value), x, y + 5, 13, 'bold', k.tone === 'bad' ? 'bad' : k.tone === 'warn' ? 'warn' : 'ink');
      text(fit(k.label, 7, w - 4), x, y + 9.6, 7, 'normal', 'ink2');
    });
    y += 14;
  }
  function table(d) {
    const cols = d.columns || [];
    const rows = d.rows || [];
    if (!rows.length) { ensure(8); text(d.empty || '', M, y + 3, 9, 'normal', 'ok'); y += 8; return; }
    const weights = cols.map((_, i) => (i === 1 ? 3.2 : i === cols.length - 1 ? 2.4 : 1.1));
    const tot = weights.reduce((a, b) => a + b, 0);
    const ws = weights.map((w) => (w / tot) * CW);
    const xs = ws.map((_, i) => M + ws.slice(0, i).reduce((a, b) => a + b, 0));
    const head = () => { rect(M, y, CW, 6.4, 'ink'); cols.forEach((c, i) => text(fit(c, 7.4, ws[i] - 3, 'bold'), xs[i] + 1.8, y + 4.3, 7.4, 'bold', 'white')); y += 6.4; };
    ensure(6.4 + 6.4 * Math.min(3, rows.length));
    head();
    rows.forEach((r, k) => {
      if (6.4 > room()) { newPage(); head(); }
      if (k % 2) rect(M, y, CW, 6.4, 'band');
      r.cells.forEach((c, i) => {
        const al = d.align?.[i];
        const tx2 = al === 'r' ? xs[i] + ws[i] - 1.8 : al === 'c' ? xs[i] + ws[i] / 2 : xs[i] + 1.8;
        const col = i === cols.length - 1 ? (r.tone === 'bad' ? 'bad' : 'warn') : 'ink';
        text(fit(c, 7.8, ws[i] - 3, i === 1 ? 'bold' : 'normal'), tx2, y + 4.3, 7.8, i === 1 || i === cols.length - 1 ? 'bold' : 'normal', col, al === 'r' ? 'right' : al === 'c' ? 'center' : undefined);
      });
      ops.push({ op: 'line', x1: M, y1: y + 6.4, x2: M + CW, y2: y + 6.4, color: C.line, w: 0.15 });
      y += 6.4;
    });
    y += 3;
  }
  function riskCards(items, facts) {
    for (const it of items) {
      const lines = wrap(plainText(it.text, facts), 9, CW - 12);
      const h = 7 + lines.length * 4.4;
      ensure(h + 2);
      rect(M, y, CW, h, `${TONE[it.tone] || 'warn'}Soft`, { r: 2 });
      rect(M, y + 2, 1.2, h - 4, TONE[it.tone] || 'warn');
      text(it.title, M + 5, y + 5.2, 7.2, 'bold', TONE[it.tone] || 'warn');
      lines.forEach((l, k) => text(l, M + 5, y + 9.6 + k * 4.4, 9, 'normal', 'ink'));
      y += h + 2.2;
    }
    if (items.length) y += 2;
  }
  // ---------- charts ----------
  function visual(v) {
    const d = v.data || {};
    switch (v.kind) {
      case 'bars': hbars((d.items || []).slice(0, 12).map((x) => ({ label: x.rank != null ? `${x.rank} · ${x.label}` : x.label, value: x.value, tone: x.tone, sub: x.sub })), unitFmt(d.unit), Math.max(d.max || 0, d.target || 0, ...(d.items || []).map((x) => x.value || 0)) || 1); break;
      case 'columns': case 'line': columns(d, v.kind === 'line'); break;
      case 'donut': donut(d); break;
      case 'waterline': waterline(d); break;
      case 'heat': heat(d); break;
      case 'compare': compare(v.data); break;
      case 'gantt': gantt(d); break;
      case 'timeline': timeline(d); break;
      default: break;
    }
    if (v.caption) { const cl = wrap(v.caption, 7.4, CW); ensure(cl.length * 3.4 + 2); cl.forEach((l) => { text(l, M, y + 2.5, 7.4, 'normal', 'ink3'); y += 3.4; }); y += 1.5; }
  }
  function hbars(items, f, max) {
    const lw = 62, vw = 18, bw = CW - lw - vw - 4;
    for (const it of items) {
      ensure(6.2);
      text(fit(it.label, 7.8, lw - 2), M, y + 3.6, 7.8, 'normal', 'ink');
      rect(M + lw, y + 1.2, bw, 3, 'sunken', { r: 1.5 });
      const w = Math.max(0.8, (Math.max(0, it.value || 0) / max) * bw);
      rect(M + lw, y + 1.2, Math.min(bw, w), 3, TONE[it.tone] || 'ink', { r: 1.5 });
      text(f(it.value), W - M, y + 3.6, 7.8, 'bold', 'ink', 'right');
      y += 6.2;
    }
    y += 1.5;
  }
  function columns(d, asLine) {
    const labels = d.labels || [], series = (d.series || []).slice(0, 4);
    if (!labels.length || !series.length) return;
    const ch = 46, lh = 10;
    ensure(ch + lh + 6);
    const top = y + 2, bottom = top + ch, left = M + 12, right = M + CW;
    const vals = series.flatMap((s) => s.values.map((v) => v ?? 0));
    const max = Math.max(1, d.target || 0, ...vals), f = unitFmt(d.unit);
    for (let k = 0; k <= 4; k++) {
      const yy = bottom - (k / 4) * ch;
      ops.push({ op: 'line', x1: left, y1: yy, x2: right, y2: yy, color: k ? C.line : C.ink3, w: k ? 0.12 : 0.25 });
      text(f(Math.round((max * k) / 4)), left - 1.5, yy + 1, 6, 'normal', 'ink3', 'right');
    }
    const gw = (right - left) / labels.length;
    const color = (s, i) => C[TONE[s.tone] || SERIES[i % SERIES.length]] || C.ink;
    if (asLine) {
      series.forEach((s, i) => {
        const pts = s.values.map((v, k) => [left + gw * (k + 0.5), bottom - ((v ?? 0) / max) * ch]);
        for (let k = 1; k < pts.length; k++) ops.push({ op: 'line', x1: pts[k - 1][0], y1: pts[k - 1][1], x2: pts[k][0], y2: pts[k][1], color: color(s, i), w: 0.7 });
        pts.forEach(([x, yy]) => ops.push({ op: 'circle', x, y: yy, r: 0.8, fill: color(s, i) }));
      });
    } else {
      const bw = Math.min(9, (gw * 0.72) / series.length);
      labels.forEach((_, k) => series.forEach((s, i) => {
        const v = Math.max(0, s.values[k] ?? 0), h = (v / max) * ch;
        const x = left + gw * k + (gw - bw * series.length) / 2 + i * bw;
        if (h > 0.05) rect(x, bottom - h, bw - 0.4, h, color(s, i));
      }));
    }
    if (Number.isFinite(d.target)) { const yy = bottom - (d.target / max) * ch; ops.push({ op: 'line', x1: left, y1: yy, x2: right, y2: yy, color: C.accent, w: 0.4, dash: [1.2, 1] }); }
    const step = Math.ceil(labels.length / 12);
    labels.forEach((l, k) => { if (k % step === 0) text(fit(l, 6.4, gw * step - 1), left + gw * (k + 0.5), bottom + 4, 6.4, 'normal', 'ink2', 'center'); });
    y = bottom + 7;
    let lx = left;
    series.forEach((s, i) => { rect(lx, y - 2.2, 2.4, 2.4, color(s, i)); text(s.name, lx + 3.4, y, 7, 'normal', 'ink'); lx += measure(clean(s.name), 7) + 9; });
    y += 4;
  }
  function donut(d) {
    const items = (d.items || []).filter((x) => x.value > 0);
    const total = items.reduce((a, x) => a + x.value, 0);
    if (!total) return;
    ensure(40);
    const cx = M + 18, cy = y + 17, r = 15, ri = 9;
    let a0 = -Math.PI / 2;
    items.forEach((x, i) => {
      const a1 = a0 + (x.value / total) * Math.PI * 2;
      const steps = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 48));
      const pts = [];
      for (let k = 0; k <= steps; k++) { const a = a0 + ((a1 - a0) * k) / steps; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
      for (let k = steps; k >= 0; k--) { const a = a0 + ((a1 - a0) * k) / steps; pts.push([cx + ri * Math.cos(a), cy + ri * Math.sin(a)]); }
      ops.push({ op: 'poly', pts, fill: C[TONE[x.tone] || SERIES[i % SERIES.length]] || C.ink });
      a0 = a1;
    });
    text(unitFmt(d.unit)(d.total ?? total), cx, cy + 1.5, 9, 'bold', 'ink', 'center');
    items.slice(0, 8).forEach((x, i) => { const yy = y + 5 + i * 4.4; rect(M + 42, yy - 2.3, 2.4, 2.4, TONE[x.tone] || SERIES[i % SERIES.length]); text(fit(x.label, 8, 90), M + 46, yy, 8, 'normal', 'ink'); text(unitFmt(d.unit)(x.value), M + 150, yy, 8, 'bold', 'ink', 'right'); });
    y += 38;
  }
  function waterline(d) {
    const items = (d.items || []).slice(0, 14);
    if (!items.length) return;
    const lw = 58, bw = CW - lw - 18;
    const max = Math.max(1, d.capacity || 0, ...items.map((x) => x.cum || 0));
    const STAT = { ok: 'ok', partial: 'warn', no: 'bad' };
    ensure(8 + Math.min(4, items.length) * 5.6);
    const top = y;
    for (const it of items) {
      ensure(5.6);
      text(fit(`${it.rank} · ${it.label}`, 7.6, lw - 2), M, y + 3.6, 7.6, 'normal', 'ink');
      const x0 = M + lw + ((it.cum - it.value) / max) * bw, w = Math.max(0.6, (it.value / max) * bw);
      rect(x0, y + 1.2, w, 3.2, STAT[it.status] || 'ink');
      text(unitFmt('h')(it.value), W - M, y + 3.6, 7.4, 'bold', 'ink', 'right');
      y += 5.6;
    }
    if (Number.isFinite(d.capacity)) {
      const cx = M + lw + (d.capacity / max) * bw;
      ops.push({ op: 'line', x1: cx, y1: top, x2: cx, y2: y, color: C.accent, w: 0.5, dash: [1.2, 0.8] });
      text(`${T(L, 'Kapazität', 'Capacity')} ${unitFmt('h')(d.capacity)}`, cx, y + 3, 6.6, 'bold', 'accent', 'center');
      y += 4;
    }
    y += 2;
  }
  function heat(d) {
    const cols = d.cols || [], rows = (d.rows || []).slice(0, 12);
    if (!cols.length || !rows.length) return;
    const lw = 40, cw = (CW - lw) / cols.length, rh = 6;
    ensure(rh * (rows.length + 1) + 3);
    cols.forEach((c, i) => text(fit(c, 6.6, cw - 1), M + lw + cw * (i + 0.5), y + 4, 6.6, 'bold', 'ink2', 'center'));
    y += rh;
    for (const r of rows) {
      text(fit(r.label, 7.4, lw - 2), M, y + 4, 7.4, 'normal', 'ink');
      r.values.forEach((v, i) => {
        const tone = v == null ? 'sunken' : d.unit === '%' ? (v > 100 ? 'badSoft' : v > 85 ? 'warnSoft' : 'okSoft') : 'sunken';
        rect(M + lw + cw * i + 0.3, y + 0.4, cw - 0.6, rh - 0.8, tone);
        text(v == null ? '–' : unitFmt(d.unit)(v), M + lw + cw * (i + 0.5), y + 4, 6.6, 'normal', 'ink', 'center');
      });
      y += rh;
    }
    y += 2;
  }
  function compare(d) {
    const rows = d.rows || [];
    ensure(6 + rows.length * 5.6);
    text(d.a?.label || '', M + 100, y + 3.6, 7.6, 'bold', 'ink2', 'right');
    text(d.b?.label || '', M + CW, y + 3.6, 7.6, 'bold', 'ink2', 'right');
    y += 5.6;
    for (const r of rows) {
      const f = r.unit === 'date' ? (x) => (x ? F.date(x) : '–') : unitFmt(r.unit);
      text(fit(r.label, 8, 60), M, y + 3.6, 8, 'normal', 'ink');
      text(f(r.a), M + 100, y + 3.6, 8, 'bold', 'ink', 'right');
      text(f(r.b), M + CW, y + 3.6, 8, 'bold', r.tone === 'bad' ? 'bad' : 'ink', 'right');
      ops.push({ op: 'line', x1: M, y1: y + 5.4, x2: M + CW, y2: y + 5.4, color: C.line, w: 0.12 });
      y += 5.6;
    }
    y += 2;
  }
  function gantt(d) {
    const rows = (d.rows || []).slice(0, 12);
    const a = Date.parse(d.from), b = Date.parse(d.to);
    if (!rows.length || !(b > a)) return;
    const lw = 55, bw = CW - lw;
    const px = (iso) => M + lw + Math.max(0, Math.min(1, (Date.parse(iso) - a) / (b - a))) * bw;
    ensure(rows.length * 5.6 + 4);
    const top = y;
    for (const r of rows) {
      text(fit(r.label, 7.6, lw - 2), M, y + 3.6, 7.6, 'normal', 'ink');
      if (r.before) rect(px(r.before.start), y + 1.2, Math.max(0.6, px(r.before.end) - px(r.before.start)), 3.2, 'line');
      rect(px(r.start), y + 1.2, Math.max(0.6, px(r.end) - px(r.start)), 3.2, TONE[r.tone] || 'ink');
      y += 5.6;
    }
    if (d.today) ops.push({ op: 'line', x1: px(d.today), y1: top, x2: px(d.today), y2: y, color: C.accent, w: 0.4, dash: [1, 0.8] });
    text(F.date(d.from), M + lw, y + 3, 6.4, 'normal', 'ink3');
    text(F.date(d.to), M + CW, y + 3, 6.4, 'normal', 'ink3', 'right');
    y += 6;
  }
  function timeline(d) {
    for (const e of (d.events || []).slice(0, 12)) {
      ensure(5.4);
      ops.push({ op: 'circle', x: M + 1.5, y: y + 2.6, r: 1, fill: C[TONE[e.tone] || 'ink'] });
      text(F.date(e.date), M + 5, y + 3.6, 7.8, 'bold', 'ink');
      text(fit(e.label, 7.8, CW - 30), M + 24, y + 3.6, 7.8, 'normal', 'ink');
      y += 5.4;
    }
    y += 2;
  }
}

export function asOfText(iso, L) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  const loc = L === 'en' ? 'en-GB' : 'de-DE';
  return `${new Intl.DateTimeFormat(loc, { day: '2-digit', month: L === 'en' ? 'short' : '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d)}`;
}

// The text a page shows (tests, search): every text op in reading order.
export const pageText = (page) => page.ops.filter((o) => o.op === 'text').map((o) => o.text).join(' ');

// ---------- paint the layout on a jsPDF document ----------
export function paint(pdf, layout, drawLogo) {
  layout.pages.forEach((p, i) => {
    if (i > 0) pdf.addPage();
    for (const o of p.ops) {
      switch (o.op) {
        case 'rect':
          pdf.setFillColor(...o.fill);
          if (o.stroke) { pdf.setDrawColor(...o.stroke); pdf.setLineWidth(0.25); }
          if (o.r) pdf.roundedRect(o.x, o.y, o.w, o.h, Math.min(o.r, o.h / 2, o.w / 2), Math.min(o.r, o.h / 2, o.w / 2), o.stroke ? 'FD' : 'F');
          else pdf.rect(o.x, o.y, o.w, o.h, o.stroke ? 'FD' : 'F');
          break;
        case 'text':
          pdf.setFont('helvetica', o.style || 'normal'); pdf.setFontSize(o.size); pdf.setTextColor(...o.color);
          pdf.text(o.text, o.x, o.y, o.align ? { align: o.align } : undefined);
          break;
        case 'line':
          pdf.setDrawColor(...o.color); pdf.setLineWidth(o.w || 0.2);
          if (o.dash && pdf.setLineDashPattern) pdf.setLineDashPattern(o.dash, 0);
          pdf.line(o.x1, o.y1, o.x2, o.y2);
          if (o.dash && pdf.setLineDashPattern) pdf.setLineDashPattern([], 0);
          break;
        case 'circle': pdf.setFillColor(...o.fill); pdf.circle(o.x, o.y, o.r, 'F'); break;
        case 'poly': {
          pdf.setFillColor(...o.fill);
          const [x0, y0] = o.pts[0];
          const deltas = o.pts.slice(1).map(([x, yy], k) => [x - o.pts[k][0], yy - o.pts[k][1]]);
          pdf.lines(deltas, x0, y0, [1, 1], 'F', true);
          break;
        }
        case 'logo': if (drawLogo) drawLogo(pdf, o.x, o.y, o.size, o.tile); break;
        default: break;
      }
    }
  });
}

// One section's data block (KPI figures + chart) alone, drawn exactly like the PDF and in the REPORT's language – the
// composer shows its charts with these operations as SVG (components/report/ReportVisual.jsx), so the page on screen,
// the PDF and the report language always agree. → { ops, height } in mm; x runs from PAGE.M to PAGE.W − PAGE.M.
export function layoutVisual(section, { lang = 'de', measure = approxMeasure } = {}) {
  const r = layoutReport({ lang, title: '', sections: [{ ...section, on: true, text: '' }] }, { branding: { logo: false, confidential: false }, measure, chartOnly: true });
  return { ops: r.pages[0]?.ops || [], height: r.height || 0 };
}
