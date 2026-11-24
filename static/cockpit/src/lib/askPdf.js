// Ask canvas → PDF (A4 portrait). Every card keeps the view chosen on the canvas; charts are drawn as
// vectors, so they stay sharp when printed. jsPDF loads only when exporting.
import { utilTone } from '../../../../shared/kpis.js'; // relative: also runs in Node tests
import { tr, fmt } from './i18n.js';
import { layoutGraph } from '../components/graphLayout.js';
import { pdfSink } from './pdf.js';
import { drawLogo } from './pdfLogo.js';

const C = {
  ink: [38, 39, 41], ink2: [107, 104, 96], ink3: [150, 146, 138], line: [224, 221, 214], soft: [236, 233, 227], band: [251, 250, 248], sunken: [242, 239, 233],
  accent: [227, 75, 4], accentDeep: [192, 64, 3], accentSoft: [252, 233, 223], ok: [47, 125, 87], okSoft: [226, 240, 231], warn: [184, 122, 0], warnSoft: [251, 239, 210],
  bad: [194, 50, 31], badSoft: [249, 224, 218], info: [61, 91, 166], white: [255, 255, 255], muted: [202, 198, 187],
};
const VAR = { 'var(--ink)': 'ink', 'var(--accent)': 'accent', 'var(--ok)': 'ok', 'var(--warn)': 'warn', 'var(--bad)': 'bad', 'var(--info)': 'info', 'var(--line-strong)': 'muted', 'var(--ink-3)': 'ink3' };
const PALETTE = [C.ink, C.accent, [143, 139, 130], [201, 138, 6], [61, 91, 166], [47, 125, 87], [176, 91, 140], [94, 140, 154]];
const rgb = (x, i = 0) => {
  if (!x) return PALETTE[i % PALETTE.length];
  if (C[x]) return C[x];
  if (VAR[x]) return C[VAR[x]];
  const m = /^#([0-9a-f]{6})$/i.exec(x);
  return m ? [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16)) : PALETTE[i % PALETTE.length];
};
const toneOf = (t) => ({ ok: C.ok, warn: C.warn, bad: C.bad, ink: C.ink, muted: C.muted }[t] || C.ink);
const fmtBy = (unit) => ({ pct: (v) => fmt.pct(v), h: (v) => fmt.h(v), n: (v) => fmt.n(v), signedPct: (v) => fmt.signedPct(v), rank: (v) => (v == null ? '–' : `#${v}`) }[unit] || ((v) => fmt.n(v, 1)));
const clean = (s) => String(s ?? '').replace(/[→⇒]/g, '->').replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[✓✔]/g, 'OK').replace(/[^\u0000-ÿ€„“”‘’–—•…]/g, '');
const W = 210, H = 297, M = 16, CW = W - 2 * M;

export async function downloadAskPdf(cards, { me } = {}) {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const title = tr('Fragen & Antworten', 'Questions & answers');
  doc.setProperties({ title, creator: 'SUPERPORT Portfolio Cockpit', subject: title });
  const font = (size, style = 'normal') => { doc.setFont('helvetica', style); doc.setFontSize(size); };
  const color = (c) => doc.setTextColor(...c);
  const fill = (c) => doc.setFillColor(...c);
  const now = new Date().toISOString();

  // ---------- header ----------
  fill(C.ink); doc.rect(0, 0, W, 30, 'F');
  fill(C.accent); doc.rect(0, 30, W, 1.1, 'F');
  drawLogo(doc, M, 7, 16);
  font(7.5, 'bold'); color(C.accent); doc.text('SUPERPORT · PORTFOLIO COCKPIT', M + 22, 12);
  font(19, 'bold'); color(C.white); doc.text(title, M + 22, 20.5);
  font(8); doc.setTextColor(200, 198, 192); doc.text(clean(`${tr('Stand', 'As of')} ${fmt.dateLong(now)} · ${fmt.time(now)}${me?.name ? ` · ${me.name}` : ''}`), M + 22, 25.5);
  font(8); doc.text(tr('Vertraulich – nur für den internen Gebrauch', 'Confidential – internal use only'), W - M, 25.5, { align: 'right' });

  // ---------- contents ----------
  let y = 40;
  font(8, 'bold'); color(C.ink2); doc.text(tr('INHALT', 'CONTENTS'), M, y); y += 5;
  cards.forEach((c, i) => {
    font(9.5); color(C.ink);
    const t = doc.splitTextToSize(clean(`${i + 1}.  ${c.title}`), CW - 10)[0];
    doc.text(t, M, y);
    fill(toneOf(c.tone)); doc.rect(W - M - 3, y - 2.6, 3, 3, 'F');
    y += 5.6;
  });
  y += 4;

  const ensure = (h) => { if (y + h > H - 16) { doc.addPage(); y = 18; } };
  const est = (c) => ({ number: 30, list: 12 + Math.min(14, (c.data.list || []).length) * 8, table: 16 + Math.min(30, c.data.table?.rows.length || 0) * 6.4, bar: 12 + Math.min(22, (c.data.series || []).length) * 6.6, donut: 58, columns: 72, line: 64, heat: 16 + (c.data.heat?.rows.length || 0) * 7, graph: 120, text: 40 }[c.view] || 40);

  cards.forEach((c, i) => {
    const view = c.views?.includes(c.view) ? c.view : c.views?.[0] || 'text';
    const answer = doc.splitTextToSize(clean(c.answer || ''), CW);
    ensure(24 + answer.length * 5 + Math.min(80, est({ ...c, view })));
    // card heading
    fill(C.band); doc.setDrawColor(...C.line); doc.setLineWidth(0.25); doc.roundedRect(M, y, CW, 13, 2.5, 2.5, 'FD');
    fill(toneOf(c.tone)); doc.rect(M, y + 2.5, 1.3, 8, 'F');
    font(7, 'bold'); color(C.ink2); doc.text(`${i + 1}`.padStart(2, '0'), M + 5, y + 5.5);
    font(11.5, 'bold'); color(C.ink); doc.text(doc.splitTextToSize(clean(c.title), CW - 22)[0], M + 12, y + 6);
    font(7.8); color(C.ink3); doc.text(doc.splitTextToSize(clean(`„${c.q}“`), CW - 22)[0], M + 12, y + 10.4);
    y += 18;
    if (answer.length) { font(10); color(C.ink); doc.text(answer, M, y); y += answer.length * 4.8 + 3; }
    draw(view, c);
    y += 8;
  });

  // ---------- footer on every page ----------
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setDrawColor(...C.line); doc.setLineWidth(0.2); doc.line(M, H - 11, W - M, H - 11);
    font(7); color(C.ink3);
    drawLogo(doc, M, H - 9.6, 4, [38, 39, 41]);
    doc.text(tr('Berechnet aus Jira-Daten, die du sehen darfst. KI-Texte sind gekennzeichnet.', 'Computed from Jira data you are allowed to see. AI texts are marked.'), M + 5.6, H - 7);
    doc.text(`${p} / ${n}`, W - M, H - 7, { align: 'right' });
  }
  const blob = doc.output('blob');
  const fileName = `${tr('fragen', 'questions')}-${now.slice(0, 10)}.pdf`;
  if (pdfSink.save) return pdfSink.save(blob, fileName, doc);
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
  return undefined;

  // ---------- chart renderers ----------
  function draw(view, c) {
    const d = c.data || {};
    if (view === 'number') {
      const f = fmtBy(d.number?.unit);
      font(30, 'bold'); color(d.number?.tone === 'bad' ? C.bad : C.ink); doc.text(clean(f(d.number?.value)), M, y + 10);
      font(9); color(C.ink2); doc.text(clean(d.number?.foot || ''), M, y + 16);
      y += 20; return;
    }
    if (view === 'list') {
      autoTable(doc, {
        startY: y, margin: { left: M, right: M }, theme: 'plain', styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 1.6, bottom: 1.6, left: 5, right: 2 }, textColor: C.ink, lineColor: C.soft, lineWidth: { bottom: 0.2 } },
        body: (d.list || []).slice(0, 30).map((x) => [{ content: clean(x.text), tone: x.tone }, clean(x.sub || '')]),
        columnStyles: { 0: { cellWidth: CW * 0.55, fontStyle: 'bold' }, 1: { textColor: C.ink2, fontSize: 8.5 } },
        didDrawCell: (h) => { if (h.section === 'body' && h.column.index === 0) { fill(toneOf(h.cell.raw?.tone)); doc.rect(h.cell.x + 1, h.cell.y + h.cell.height / 2 - 1.2, 2.4, 2.4, 'F'); } },
      });
      y = doc.lastAutoTable.finalY + 2; return;
    }
    if (view === 'table' || view === 'heat') {
      const head = view === 'table' ? d.table.head : ['', ...d.heat.cols];
      const body = view === 'table' ? d.table.rows : d.heat.rows.map((r) => [r.label, ...r.values.map((v) => ({ content: v == null ? '–' : fmt.pct(v), v }))]);
      autoTable(doc, {
        startY: y, margin: { left: M, right: M }, head: [head.map(clean)], body: body.map((r) => r.map((x) => (typeof x === 'object' && x ? { ...x, content: clean(x.content) } : clean(x)))),
        theme: 'grid', styles: { font: 'helvetica', fontSize: 8.6, cellPadding: 2, textColor: C.ink, lineColor: C.line, lineWidth: 0.2 },
        headStyles: { fillColor: C.ink, textColor: C.white, fontStyle: 'bold', fontSize: 8 }, alternateRowStyles: { fillColor: C.band },
        didParseCell: (h) => {
          const v = h.cell.raw?.v;
          if (h.section === 'body' && v !== undefined) { const t = utilTone(v); if (t) { h.cell.styles.fillColor = C[`${t}Soft`]; h.cell.styles.textColor = C[t]; h.cell.styles.fontStyle = 'bold'; } h.cell.styles.halign = 'center'; }
        },
      });
      y = doc.lastAutoTable.finalY + 2; return;
    }
    if (view === 'bar') {
      const items = (d.series || []).slice(0, 22), f = fmtBy(d.unit);
      const max = d.max || Math.max(1e-9, ...items.map((x) => Math.abs(x.value || 0)));
      const lw = 62, bw = CW - lw - 22;
      items.forEach((it, k) => {
        const yy = y + k * 6.6;
        font(8.4); color(C.ink); doc.text(doc.splitTextToSize(clean(it.label), lw - 3)[0], M, yy + 3.4);
        fill(C.sunken); doc.roundedRect(M + lw, yy + 0.8, bw, 3.6, 1.8, 1.8, 'F');
        const w = Math.max(0.8, (Math.abs(it.value || 0) / max) * bw);
        fill(it.tone ? toneOf(it.tone) : rgb(it.color, 0)); doc.roundedRect(M + lw, yy + 0.8, Math.min(bw, w), 3.6, 1.8, 1.8, 'F');
        font(8.4, 'bold'); color(C.ink); doc.text(clean(f(it.value)), W - M, yy + 3.4, { align: 'right' });
      });
      y += items.length * 6.6 + 2; return;
    }
    if (view === 'donut') {
      const parts = (d.parts || []).filter((p) => p.value > 0), total = parts.reduce((a, p) => a + p.value, 0) || 1, f = fmtBy(d.partsUnit || 'n');
      const cx = M + 26, cy = y + 25, R = 22, r = 13;
      let a0 = -Math.PI / 2;
      parts.forEach((p, k) => {
        const a1 = a0 + (p.value / total) * 2 * Math.PI, steps = Math.max(2, Math.ceil(((a1 - a0) / (2 * Math.PI)) * 90));
        const pts = [];
        for (let s = 0; s <= steps; s++) { const a = a0 + ((a1 - a0) * s) / steps; pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
        for (let s = steps; s >= 0; s--) { const a = a0 + ((a1 - a0) * s) / steps; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
        fill(p.tone ? toneOf(p.tone) : rgb(p.color, k));
        doc.lines(pts.slice(1).map((pt, j) => [pt[0] - pts[j][0], pt[1] - pts[j][1]]), pts[0][0], pts[0][1], [1, 1], 'F', true);
        a0 = a1;
      });
      font(13, 'bold'); color(C.ink); doc.text(clean(f(total)), cx, cy + 1.8, { align: 'center' });
      parts.forEach((p, k) => {
        const yy = y + 6 + k * 6.4;
        fill(p.tone ? toneOf(p.tone) : rgb(p.color, k)); doc.roundedRect(M + 60, yy - 2.6, 3, 3, 0.8, 0.8, 'F');
        font(9); color(C.ink); doc.text(clean(p.label), M + 66, yy);
        font(9, 'bold'); doc.text(`${clean(f(p.value))}  (${fmt.pct(p.value / total)})`, W - M, yy, { align: 'right' });
      });
      y += Math.max(52, parts.length * 6.4 + 10); return;
    }
    if (view === 'columns' || view === 'line') {
      const spec = view === 'columns' ? d.columns : d.line, f = fmtBy(spec.unit);
      const ch = 48, x0 = M + 12, cw = CW - 12, base = y + ch;
      const all = spec.series.flatMap((s) => s.values).filter((v) => v != null);
      const lo = view === 'line' ? (spec.domain?.[0] ?? Math.min(0, ...all)) : 0, hi = view === 'line' ? (spec.domain?.[1] ?? Math.max(1e-9, ...all, spec.target ?? 0)) : Math.max(1e-9, ...all);
      const Y = (v) => base - ((v - lo) / (hi - lo || 1)) * ch;
      doc.setDrawColor(...C.soft); doc.setLineWidth(0.2);
      [0, 0.5, 1].forEach((g) => { const yy = base - g * ch; doc.line(x0, yy, x0 + cw, yy); font(6.8); color(C.ink3); doc.text(clean(f(lo + g * (hi - lo))), x0 - 1.5, yy + 1, { align: 'right' }); });
      const n = spec.labels.length, step = cw / n;
      if (view === 'columns') {
        const k = spec.series.length, bw = Math.min(6, (step * 0.7) / k);
        spec.labels.forEach((_, i) => spec.series.forEach((s, j) => {
          const v = s.values[i] || 0, x = x0 + i * step + step / 2 - (k * bw) / 2 + j * bw;
          fill(rgb(s.color, j)); doc.rect(x, Y(v), bw - 0.4, base - Y(v), 'F');
        }));
      } else {
        if (spec.target != null) { doc.setDrawColor(...C.accent); doc.setLineDashPattern([1.2, 1.2], 0); doc.line(x0, Y(spec.target), x0 + cw, Y(spec.target)); doc.setLineDashPattern([], 0); }
        spec.series.forEach((s, j) => {
          doc.setDrawColor(...rgb(s.color, j)); doc.setLineWidth(0.7);
          let prev = null;
          s.values.forEach((v, i) => { const pt = v == null ? null : [x0 + i * step + step / 2, Y(v)]; if (pt && prev) doc.line(prev[0], prev[1], pt[0], pt[1]); if (pt) { fill(rgb(s.color, j)); doc.circle(pt[0], pt[1], 0.8, 'F'); } prev = pt; });
        });
      }
      font(6.8); color(C.ink2);
      spec.labels.forEach((l, i) => { if (n <= 12 || i % Math.ceil(n / 12) === 0) doc.text(clean(l), x0 + i * step + step / 2, base + 4, { align: 'center' }); });
      let lx = x0;
      spec.series.forEach((s, j) => { fill(rgb(s.color, j)); doc.rect(lx, base + 7.2, 2.6, 2.6, 'F'); font(7.6); color(C.ink); doc.text(clean(s.name), lx + 4, base + 9.4); lx += 8 + doc.getTextWidth(clean(s.name)); });
      y = base + 14; return;
    }
    if (view === 'graph') {
      const g = d.graph, gh = 110, sx = CW / 1000, sy = gh / 640;
      const pos = layoutGraph(g.nodes, g.edges, 1000, 640).map((p) => [M + p.x * sx, y + p.y * sy]);
      const at = new Map(g.nodes.map((nd, i) => [nd.id, pos[i]]));
      fill(C.band); doc.setDrawColor(...C.line); doc.setLineWidth(0.2); doc.roundedRect(M, y, CW, gh, 3, 3, 'FD');
      for (const e of g.edges) {
        const a = at.get(e.from), b = at.get(e.to); if (!a || !b) continue;
        const bad = e.tone === 'bad';
        doc.setDrawColor(...(bad ? C.bad : C.ink3)); doc.setLineWidth(bad ? 0.8 : 0.4);
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
        const cut = Math.min(17 / (Math.abs(ux) || 1e-6), 5 / (Math.abs(uy) || 1e-6));
        const ex = b[0] - ux * cut, ey = b[1] - uy * cut;
        doc.line(a[0], a[1], ex, ey);
        fill(bad ? C.bad : C.ink3); doc.triangle(ex, ey, ex - ux * 2.4 - uy * 1.2, ey - uy * 2.4 + ux * 1.2, ex - ux * 2.4 + uy * 1.2, ey - uy * 2.4 - ux * 1.2, 'F');
        const mx = (a[0] + ex) / 2, my = (a[1] + ey) / 2;
        fill(bad ? C.bad : C.white); doc.circle(mx, my, 2.4, 'F'); font(6.5, 'bold'); color(bad ? C.white : C.ink); doc.text(clean(e.label), mx, my + 0.9, { align: 'center' });
      }
      g.nodes.forEach((nd, i) => {
        const [x, yy] = pos[i];
        const label = clean(nd.label.length > 24 ? `${nd.label.slice(0, 23)}…` : nd.label);
        font(7.4, 'bold'); const w = Math.min(36, doc.getTextWidth(label) + 8);
        fill(C.white); doc.setDrawColor(...toneOf(nd.tone)); doc.setLineWidth(nd.ext ? 0.3 : 0.6); doc.roundedRect(x - w / 2, yy - 4, w, 8, 2, 2, 'FD');
        fill(toneOf(nd.tone)); doc.circle(x - w / 2 + 2.8, yy, 0.9, 'F');
        color(C.ink); doc.text(doc.splitTextToSize(label, w - 6)[0], x - w / 2 + 4.6, yy + 1.2);
      });
      y += gh + 2; return;
    }
    // text (AI answers, notices)
    const lines = doc.splitTextToSize(clean(String(c.text || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '').replace(/^\s*[-*]\s+/gm, '• ')), CW);
    for (const l of lines) { ensure(6); font(9.6); color(C.ink); doc.text(l, M, y); y += 4.8; }
    if (c.intent === 'ai') { font(7.4, 'bold'); color(C.accentDeep); doc.text(c.source === 'ai' ? tr('KI-GENERIERT · BITTE PRÜFEN', 'AI-GENERATED · PLEASE VERIFY') : tr('AUTOMATISCHE ZUSAMMENFASSUNG', 'AUTOMATIC SUMMARY'), M, y + 2); y += 5; }
  }
}
