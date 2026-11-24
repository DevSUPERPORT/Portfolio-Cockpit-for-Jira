// C-level report as a typeset PDF (A4 landscape). jsPDF is loaded only when exporting.
// Key figures, rows and sentences come from shared/reportKpis.js – the same wording as the screen and Confluence.
import { utilTone } from '../../../../shared/kpis.js'; // relative: also runs in Node tests
import { reportKpis } from '../../../../shared/reportKpis.js';
import { tr, fmt, healthName, ruleName, getLang } from './i18n.js';
import { drawLogo } from './pdfLogo.js';

const C = {
  ink: [38, 39, 41], ink2: [107, 104, 96], line: [224, 221, 214], paper: [245, 244, 241], band: [251, 250, 248],
  accent: [227, 75, 4], accentDeep: [192, 64, 3], ok: [47, 125, 87], okSoft: [226, 240, 231], warn: [184, 122, 0], warnSoft: [251, 239, 210],
  bad: [194, 50, 31], badSoft: [249, 224, 218], info: [61, 91, 166], infoSoft: [230, 236, 247], white: [255, 255, 255],
};
const HEALTH = { onTrack: ['ok', 'okSoft'], atRisk: ['warn', 'warnSoft'], critical: ['bad', 'badSoft'] };
const TERM = { bad: ['bad', 'badSoft'], warn: ['warn', 'warnSoft'], ok: ['ok', 'okSoft'], soft: ['ink2', 'band'] };
const W = 297, H = 210, M = 14;
// Helvetica (WinAnsi) has no arrows etc.; keep the text printable.
const clean = (s) => String(s ?? '').replace(/[→⇒]/g, '->').replace(/[≥]/g, '>=').replace(/[≤]/g, '<=').replace(/[✓✔]/g, 'OK').replace(/[−]/g, '-').replace(/[∞]/g, 'unendl.').replace(/[^\u0000-ÿ€„“”‘’–—•…]/g, '');
const md = (s) => clean(String(s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, ''));

export async function downloadReportPdf(r, { summary, planActual } = {}) {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const v = reportKpis({ report: r, planActual, lang: getLang() });
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: tr('Portfolio-Report', 'Portfolio report'), creator: 'SUPERPORT Portfolio Cockpit', subject: tr('C-Level-Report', 'C-level report') });
  const fill = (c) => doc.setFillColor(...C[c]);
  const color = (c) => doc.setTextColor(...C[c]);
  const font = (size, style = 'normal') => { doc.setFont('helvetica', style); doc.setFontSize(size); };
  const asOf = `${fmt.dateLong(r.asOf)} · ${fmt.time(r.asOf)}`;
  const rows = v.rows;

  // ---------- page 1: header band, six key figures, summary, distributions, top risks ----------
  fill('ink'); doc.rect(0, 0, W, 32, 'F');
  fill('accent'); doc.rect(0, 32, W, 1.2, 'F');
  drawLogo(doc, M, 8, 16);
  font(7.5, 'bold'); color('accent'); doc.text('SUPERPORT', M + 22, 13);
  font(21, 'bold'); color('white'); doc.text(tr('Portfolio-Report', 'Portfolio report'), M + 22, 22.5);
  font(8); doc.setTextColor(200, 198, 192);
  doc.text(doc.splitTextToSize(clean(`${tr('Stand', 'As of')} ${asOf}, ${tr('täglich berechnet · alle Projekte · freigegeben für', 'computed daily · all projects · shared with')} ${v.header.audience}`), 170)[0], M + 22, 27.5);
  font(8); doc.text(tr('Vertraulich – nur für den internen Gebrauch', 'Confidential – internal use only'), W - M, 15, { align: 'right' });

  const tw = (W - 2 * M - 5 * 4) / 6;
  v.tiles.forEach((t, i) => {
    const x = M + i * (tw + 4), y = 39;
    fill('white'); doc.setDrawColor(...C.line); doc.setLineWidth(0.25); doc.roundedRect(x, y, tw, 27, 2.5, 2.5, 'FD');
    if (t.tone) { fill(t.tone); doc.rect(x, y + 3, 1.2, 21, 'F'); }
    font(6.8, 'bold'); color('ink2'); doc.text(clean(t.label).toUpperCase(), x + 4, y + 6.5);
    if (t.kind === 'text') { font(8.6, 'bold'); color('ink'); doc.text(doc.splitTextToSize(clean(t.display), tw - 7).slice(0, 2), x + 4, y + 12.5); }
    else { font(17, 'bold'); color(t.tone === 'bad' ? 'bad' : 'ink'); doc.text(clean(t.display), x + 4, y + 15.5); }
    font(6.4); color('ink2'); doc.text(doc.splitTextToSize(clean(t.sub), tw - 7).slice(0, 2), x + 4, y + 20);
  });

  // Executive summary (AI text if generated in the cockpit, otherwise a fact-based summary).
  const bullets = summary ? md(summary).split(/\n+/).map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean) : factSummary(r, { planActual });
  const sx = M, sy = 71, sw = 172;
  fill('band'); doc.setDrawColor(...C.line); doc.roundedRect(sx, sy, sw, 120, 2.5, 2.5, 'FD');
  fill('accent'); doc.rect(sx, sy, 1.4, 120, 'F');
  font(11, 'bold'); color('ink'); doc.text(tr('Executive Summary', 'Executive summary'), sx + 6, sy + 9);
  font(7); color('ink2'); doc.text(summary ? tr('KI-Zusammenfassung (Forge LLM) – geprüft mit den Zahlen dieses Reports', 'AI summary (Forge LLM) – based on the figures in this report') : tr('Automatisch aus den Kennzahlen erstellt', 'Generated from the key figures'), sx + 6, sy + 13.5);
  let y = sy + 21;
  font(9.2); color('ink');
  for (const b of bullets.slice(0, 9)) {
    const lines = doc.splitTextToSize(clean(b), sw - 16);
    if (y + lines.length * 4.3 > sy + 116) break;
    fill('accent'); doc.circle(sx + 7.5, y - 1.2, 0.8, 'F');
    doc.text(lines, sx + 10.5, y);
    y += lines.length * 4.3 + 2.4;
  }

  // Distributions + top risks (right column).
  const rx = sx + sw + 6, rw = W - M - rx;
  const hc = r.healthCounts || {};
  const tc = { bad: rows.filter((x) => x.term.tone === 'bad').length, warn: rows.filter((x) => x.term.tone === 'warn' || x.term.tone === 'soft').length, ok: rows.filter((x) => x.term.tone === 'ok').length };
  const dist = (title, parts, yy) => {
    font(8.5, 'bold'); color('ink'); doc.text(title, rx, yy);
    const total = parts.reduce((a, p) => a + p[1], 0) || 1;
    let x = rx;
    parts.forEach(([, n, c]) => { const w = (n / total) * rw; if (w > 0) { fill(c); doc.rect(x, yy + 2.5, w, 5, 'F'); } x += w; });
    font(7.2); let lx = rx;
    parts.forEach(([label, n, c]) => { fill(c); doc.rect(lx, yy + 10.2, 2.4, 2.4, 'F'); color('ink'); const t = `${clean(label)} ${n}`; doc.text(t, lx + 3.4, yy + 12.2); lx += doc.getTextWidth(t) + 8; });
  };
  dist(tr('Health der aktiven Projekte', 'Health of active projects'), [[tr('Im Plan', 'On track'), hc.onTrack || 0, 'ok'], [tr('Gefährdet', 'At risk'), hc.atRisk || 0, 'warn'], [tr('Kritisch', 'Critical'), hc.critical || 0, 'bad'], [tr('kein Update', 'no update'), hc.none || 0, 'line']], sy + 4);
  dist(tr('Termin', 'Schedule'), [[tr('Im Plan', 'On track'), tc.ok, 'ok'], [tr('Gefährdet', 'At risk'), tc.warn, 'warn'], [tr('Über Termin', 'Past due'), tc.bad, 'bad']], sy + 26);
  font(8.5, 'bold'); color('ink'); doc.text(tr('Top-Risiken', 'Top risks'), rx, sy + 50);
  let ry = sy + 56;
  const risks = rows.filter((x) => x.term.tone !== 'ok' || x.health === 'critical' || x.overrun).sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0) || (b.conflicts || 0) - (a.conflicts || 0) || a.rank - b.rank).slice(0, 6);
  if (!risks.length) { font(8); color('ok'); doc.text(tr('Keine akuten Risiken – alle Projekte im Plan.', 'No acute risks – all projects on track.'), rx, ry); }
  for (const x of risks) {
    const why = [x.term.tone !== 'ok' ? x.term.text : null, x.waitText || null, x.overrun ? tr(`Prognose ${x.progText}`, `forecast ${x.progText}`) : null, x.health === 'critical' ? tr('Health kritisch', 'health critical') : null].filter(Boolean).join(' · ');
    const tone = x.term.tone === 'bad' || x.health === 'critical' ? 'bad' : 'warn';
    fill(tone); doc.circle(rx + 1.2, ry - 1.1, 1, 'F');
    font(8.4, 'bold'); color('ink'); doc.text(doc.splitTextToSize(`${x.rank}. ${clean(x.name)}`, rw - 4)[0], rx + 4, ry);
    font(7.2); color('ink2'); doc.text(doc.splitTextToSize(clean(why), rw - 4)[0] || '', rx + 4, ry + 3.8);
    ry += 10.5;
    if (ry > sy + 116) break;
  }

  // ---------- page 2: running projects by rank ----------
  const section = (title, sub) => {
    doc.addPage();
    fill('ink'); doc.rect(0, 0, W, 14, 'F'); fill('accent'); doc.rect(0, 14, W, 0.8, 'F');
    font(7, 'bold'); color('accent'); doc.text('SUPERPORT', M, 6.5);
    font(11.5, 'bold'); color('white'); doc.text(clean(title), M, 11.2);
    font(7.5); doc.setTextColor(200, 198, 192); doc.text(clean(sub || ''), W - M, 9.5, { align: 'right' });
    return 21;
  };
  const tableStyle = {
    theme: 'grid', margin: { left: M, right: M, top: 20, bottom: 14 },
    styles: { font: 'helvetica', fontSize: 7.6, cellPadding: 1.8, lineColor: C.line, lineWidth: 0.15, textColor: C.ink, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: C.ink, textColor: C.white, fontStyle: 'bold', fontSize: 7.4 },
    alternateRowStyles: { fillColor: C.band },
  };
  const tone = (d, t) => { if (!t || !C[t]) return; const s = TERM[t] || [t, `${t}Soft`]; d.cell.styles.fillColor = C[s[1]]; d.cell.styles.textColor = C[s[0]]; d.cell.styles.fontStyle = 'bold'; };
  let top = section(tr('Laufende Projekte nach Rang', 'Running projects by rank'), clean(v.progressFormula));
  autoTable(doc, {
    ...tableStyle, startY: top,
    head: [[tr('Rang', 'Rank'), tr('Projekt', 'Project'), 'Owner', 'Health', 'Due Date', tr('Fortschritt', 'Progress'), tr('Time Spent · offen', 'Spent · open'), tr('Prognose', 'Forecast'), tr('Termin', 'Schedule'), tr('Health-Kommentar', 'Health comment')]],
    body: rows.map((x) => [x.rank, clean(`${x.name}${x.waitText ? `\n${x.waitText}` : ''}`), clean(x.owner || '–'), x.health ? clean(healthName(x.health)) : tr('kein Update', 'no update'),
      `${x.due ? fmt.date(x.due, { day: '2-digit', month: '2-digit', year: '2-digit' }) : '–'}${x.daysOverdue > 0 ? `\n+${x.daysOverdue} ${tr('Tage', 'days')}` : ''}`, '', `${fmt.n(x.TS)} · ${fmt.n(x.open)} h`, clean(x.progText), clean(x.term.text), clean(x.healthComment || '')]),
    columnStyles: { 0: { cellWidth: 10, halign: 'center', fontStyle: 'bold' }, 1: { cellWidth: 56, fontStyle: 'bold' }, 2: { cellWidth: 24 }, 3: { cellWidth: 18 }, 4: { cellWidth: 18 }, 5: { cellWidth: 26 }, 6: { cellWidth: 24, halign: 'right' }, 7: { cellWidth: 16, halign: 'right' }, 8: { cellWidth: 34 }, 9: { cellWidth: 'auto', fontSize: 6.9, textColor: C.ink2 } },
    didParseCell: (d) => {
      if (d.section !== 'body') return;
      const x = rows[d.row.index];
      if (d.column.index === 3 && HEALTH[x.health]) { d.cell.styles.fillColor = C[HEALTH[x.health][1]]; d.cell.styles.textColor = C[HEALTH[x.health][0]]; d.cell.styles.fontStyle = 'bold'; }
      if (d.column.index === 8) tone(d, x.term.tone);
      if (d.column.index === 4 && x.daysOverdue > 0) { d.cell.styles.textColor = C.bad; d.cell.styles.fontStyle = 'bold'; }
      if (d.column.index === 7 && x.overrun) { d.cell.styles.textColor = C.bad; d.cell.styles.fontStyle = 'bold'; }
    },
    didDrawCell: (d) => {
      if (d.section !== 'body' || d.column.index !== 5) return;
      const p = Math.max(0, Math.min(1, rows[d.row.index].progress || 0));
      const bw = d.cell.width - 13, bx = d.cell.x + 2, by = d.cell.y + d.cell.height / 2 - 1.2;
      doc.setFillColor(...C.line); doc.roundedRect(bx, by, bw, 2.4, 1.2, 1.2, 'F');
      if (p > 0) { doc.setFillColor(...C.ink); doc.roundedRect(bx, by, Math.max(2.4, bw * p), 2.4, 1.2, 1.2, 'F'); }
      font(7); color('ink'); doc.text(fmt.pct(p), d.cell.x + d.cell.width - 1.8, d.cell.y + d.cell.height / 2 + 1, { align: 'right' });
    },
  });

  // ---------- page 3: capacity by rank (every quarter) and the next 4 weeks ----------
  top = section(tr('Kapazität nach Rangfolge', 'Capacity by rank'), tr('Support zuerst, dann die Projekte je Team in Rangfolge', 'Support first, then each team\'s projects in rank order'));
  const wlRows = v.waterline.quarters.flatMap((q) => v.waterline.byQ[q].teams.map((t, i) => ({ q: i === 0 ? v.waterline.byQ[q].label : '', t })));
  autoTable(doc, {
    ...tableStyle, startY: top,
    head: [[tr('Quartal', 'Quarter'), 'Team', tr('Auslastung', 'Utilisation'), tr('Einschätzung', 'Assessment')]],
    body: wlRows.length ? wlRows.map(({ q, t }) => [q, clean(t.name), clean(t.utilText), clean(t.sentence)]) : [[{ content: tr('Noch keine Kapazitäten gepflegt.', 'No capacities maintained yet.'), colSpan: 4, styles: { textColor: C.ink2 } }]],
    columnStyles: { 0: { cellWidth: 22, fontStyle: 'bold' }, 1: { cellWidth: 40, fontStyle: 'bold' }, 2: { cellWidth: 24, halign: 'center' } },
    didParseCell: (d) => { if (d.section === 'body' && d.column.index === 2 && wlRows[d.row.index]) tone(d, wlRows[d.row.index].t.tone); },
  });
  const u = v.util4;
  let yy = doc.lastAutoTable.finalY + 9;
  if (yy > H - 50) yy = section(tr('Auslastung nächste 4 Wochen', 'Utilisation next 4 weeks'), '') - 3;
  font(10, 'bold'); color('ink'); doc.text(clean(`${tr('Auslastung', 'Utilisation')} – ${u.weeksText}`), M, yy);
  const heat = (x) => utilTone(x) || null; // same rule as the screen
  autoTable(doc, {
    ...tableStyle, startY: yy + 3,
    head: [['Team', ...u.weekLabels, tr('Ø 4 Wochen', 'Avg 4 weeks')]],
    body: [...u.teams.map((t) => [clean(t.name), ...u.weekLabels.map((_, i) => (t.u?.[i] == null ? '–' : fmt.pct(t.u[i]))), clean(t.reason ? `${t.utilText} (${t.reason})` : t.utilText)]), [tr('Alle Teams', 'All teams'), ...u.weekLabels.map(() => ''), fmt.pct(u.avg)]],
    columnStyles: { 0: { cellWidth: 46, fontStyle: 'bold' } },
    didParseCell: (d) => {
      if (d.section !== 'body' || d.column.index < 1) return;
      const t = u.teams[d.row.index];
      if (!t && d.column.index <= u.weekLabels.length) return;
      const val = !t ? u.avg : d.column.index <= u.weekLabels.length ? t.u?.[d.column.index - 1] : t.util;
      d.cell.styles.halign = 'center';
      tone(d, heat(val));
    },
  });
  if (u.personLevel && u.persons.length) {
    let py = doc.lastAutoTable.finalY + 7;
    if (py > H - 40) py = section(tr('Personen über 100 %', 'People over 100%'), '') - 3;
    font(10, 'bold'); color('ink'); doc.text(tr('Personen über 100 %', 'People over 100%'), M, py);
    autoTable(doc, {
      ...tableStyle, startY: py + 3, margin: { left: M, right: W / 2, top: 20, bottom: 14 },
      head: [[tr('Person', 'Person'), 'Team', tr('Wochen', 'Weeks'), tr('Höchstwert', 'Peak')]],
      body: u.persons.map((p) => [clean(p.name), clean(p.team), clean(p.weeksText), clean(p.maxText)]),
      columnStyles: { 3: { halign: 'right', textColor: C.bad, fontStyle: 'bold' } },
    });
  }

  // ---------- page 4: where the time went, risks, dependencies, milestones, quality, support ----------
  top = section(tr('Wohin floss die Zeit? · Risiken & Meilensteine', 'Where did the time go? · risks & milestones'), tr('Was Entscheidungen braucht', 'What needs decisions'));
  const half = (W - 2 * M - 8) / 2;
  font(10, 'bold'); color('ink'); doc.text(tr('Terminkonflikte zwischen Abhängigkeiten', 'Date conflicts between dependencies'), M, top + 2);
  autoTable(doc, {
    ...tableStyle, startY: top + 5, margin: { left: M, right: W - M - half, top: 20, bottom: 14 },
    head: [[tr('Voraussetzung', 'Prerequisite'), tr('Projekt', 'Project'), tr('Abhängig', 'Dependent'), tr('Projekt', 'Project'), tr('Tage', 'Days')]],
    body: (r.conflicts || []).length ? r.conflicts.map((c) => [c.preKey || '–', clean(c.preProject || '–'), c.depKey || '–', clean(c.depProject || '–'), `+${c.days}`]) : [[{ content: tr('Keine Terminkonflikte.', 'No date conflicts.'), colSpan: 5, styles: { textColor: C.ok } }]],
    columnStyles: { 4: { halign: 'right', textColor: C.bad, fontStyle: 'bold' } },
  });
  const leftEnd = doc.lastAutoTable.finalY;
  font(10, 'bold'); color('ink'); doc.text(tr('Meilensteine', 'Milestones'), M + half + 8, top + 2);
  autoTable(doc, {
    ...tableStyle, startY: top + 5, margin: { left: M + half + 8, right: M, top: 20, bottom: 14 },
    head: [[tr('Meilenstein', 'Milestone'), tr('Datum', 'Date'), 'Stories', tr('Später fällig', 'Due later'), 'Status']],
    body: (r.milestones || []).length ? r.milestones.map((m) => [clean(m.name), fmt.date(m.date, { day: '2-digit', month: '2-digit', year: 'numeric' }), m.stories, m.late, m.atRisk ? tr('gefährdet', 'at risk') : tr('im Plan', 'on track')])
      : [[{ content: tr('Keine Meilensteine konfiguriert.', 'No milestones configured.'), colSpan: 5, styles: { textColor: C.ink2 } }]],
    didParseCell: (d) => { if (d.section === 'body' && d.column.index === 4 && r.milestones?.[d.row.index]) { const bad = r.milestones[d.row.index].atRisk; d.cell.styles.fillColor = C[bad ? 'warnSoft' : 'okSoft']; d.cell.styles.textColor = C[bad ? 'warn' : 'ok']; d.cell.styles.fontStyle = 'bold'; } },
  });
  let by = Math.max(leftEnd, doc.lastAutoTable.finalY) + 9;
  if (by > H - 52) by = section(tr('Zeit, Datenqualität & Support', 'Time, data quality & support'), '');
  const third = (W - 2 * M - 16) / 3;
  const box = (x, title, linesArr, note) => {
    fill('band'); doc.setDrawColor(...C.line); doc.roundedRect(x, by, third, 40, 2.5, 2.5, 'FD');
    font(10, 'bold'); color('ink'); doc.text(clean(title), x + 5, by + 8);
    font(8.2); let ly = by + 15;
    if (note) { color('ink2'); doc.text(doc.splitTextToSize(clean(note), third - 10).slice(0, 4), x + 5, ly); return; }
    for (const [label, value, t] of linesArr) { color('ink2'); doc.text(clean(label), x + 5, ly); color(t || 'ink'); font(8.2, 'bold'); doc.text(clean(value), x + third - 5, ly, { align: 'right' }); font(8.2); ly += 5; }
  };
  const f = v.flows;
  box(M, `${tr('Wohin floss die Zeit?', 'Where did the time go?')}${f.period ? ` · ${f.period}` : ''}`, f.rows.map((x) => [x.label, fmt.h(x.h)]), !f.ready || !f.rows.length ? f.note : null);
  const dqr = r.dataQuality || { score: 0, rules: [] };
  box(M + third + 8, tr('Datenqualität', 'Data quality'), [[tr('Vollständigkeit', 'Completeness'), fmt.pct(dqr.score), dqr.score >= 0.85 ? 'ok' : dqr.score >= 0.65 ? 'warn' : 'bad'], [tr('Dringende Lücken (≤ 4 Wochen)', 'Urgent gaps (<= 4 weeks)'), String(dqr.urgent ?? 0), dqr.urgent ? 'warn' : 'ok'],
    ...(dqr.rules || []).slice(0, 3).map((x) => [ruleName(x.rule), String(x.count)])]);
  const sp = r.support;
  box(M + 2 * (third + 8), 'Support & SLA', sp ? [[tr('SLA-Quote', 'SLA rate'), sp.slaRate == null ? '–' : fmt.pct(sp.slaRate), sp.slaRate != null && sp.slaRate < (sp.target ?? 0.95) ? 'warn' : 'ok'], [tr('Offen über dem SLA', 'Open past SLA'), String(sp.breaches ?? 0), sp.breaches ? 'bad' : 'ok'], [tr('Offene Tickets', 'Open tickets'), String(sp.open ?? 0)], [tr('Support-Last pro Woche', 'Support load per week'), sp.weeklyTotal == null ? '–' : fmt.h(sp.weeklyTotal)]]
    : [], sp ? null : tr('Kein Support-Bereich konfiguriert.', 'No support area configured.'));

  // ---------- footer on every page ----------
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...C.line); doc.setLineWidth(0.2); doc.line(M, H - 9, W - M, H - 9);
    font(7); color('ink2');
    drawLogo(doc, M, H - 7.6, 4, [38, 39, 41]);
    doc.text(clean(`SUPERPORT Portfolio Cockpit · ${tr('vertraulich', 'confidential')}`), M + 5.6, H - 5);
    doc.text(clean(`${tr('Stand', 'As of')} ${asOf}`), W / 2, H - 5, { align: 'center' });
    doc.text(`${tr('Seite', 'Page')} ${i} / ${pages}`, W - M, H - 5, { align: 'right' });
  }
  const blob = doc.output('blob');
  const fileName = `${tr('portfolio-report', 'portfolio-report')}-${String(r.asOf).slice(0, 10)}.pdf`;
  if (pdfSink.save) return pdfSink.save(blob, fileName, doc);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}
export const pdfSink = { save: null };

// The report composed with Lotse (components/report): A4 portrait, the pure layout of components/report/pdfLayout.js
// painted with vector charts, logo, page numbers, date and the "Stand" footer.
export async function downloadComposedPdf(composed, { branding = {}, fileName } = {}) {
  const { jsPDF } = await import('jspdf');
  const { layoutReport, paint } = await import('../components/report/pdfLayout.js');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const measure = (t, size, style = 'normal') => { pdf.setFont('helvetica', style); pdf.setFontSize(size); return pdf.getTextWidth(String(t)); };
  const layout = layoutReport(composed, { branding, measure });
  pdf.setProperties({ title: clean(composed.title), creator: 'SUPERPORT Portfolio Cockpit', subject: clean(composed.subtitle || '') });
  paint(pdf, layout, drawLogo);
  const blob = pdf.output('blob');
  const name = fileName || `${String(composed.title || 'report').toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report'}-${String(composed.asOf || new Date().toISOString()).slice(0, 10)}.pdf`;
  if (pdfSink.save) return pdfSink.save(blob, name, pdf, layout);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
  return { name, pages: layout.pages.length };
}

// Fact-based summary when no AI summary was generated.
export function factSummary(r, { planActual } = {}) {
  const v = reportKpis({ report: r, planActual, lang: getLang() });
  const k = r.kpis || {}, rows = v.rows, hc = r.healthCounts || {};
  const late = rows.filter((x) => x.daysOverdue > 0), over = rows.filter((x) => x.overrun);
  const wq = v.waterline.byQ[v.waterline.defaultQ];
  const t = Object.fromEntries(v.tiles.map((x) => [x.id, x]));
  const out = [
    tr(`${rows.length} aktive Projekte (${t.projects.sub.split(' · Health')[0]}), Gesamtfortschritt ${fmt.pct(k.progress)}.`, `${rows.length} active projects (${t.projects.sub.split(' · health')[0]}), overall progress ${fmt.pct(k.progress)}.`),
    tr(`Health: ${hc.critical || 0} kritisch, ${hc.atRisk || 0} gefährdet, ${hc.onTrack || 0} im Plan, ${hc.none || 0} ohne Update.`, `Health: ${hc.critical || 0} critical, ${hc.atRisk || 0} at risk, ${hc.onTrack || 0} on track, ${hc.none || 0} without update.`),
    late.length ? tr(`Über Termin: ${late.map((x) => `${x.name} (+${x.daysOverdue} Tage)`).join(', ')}.`, `Past due: ${late.map((x) => `${x.name} (+${x.daysOverdue} days)`).join(', ')}.`) : tr('Kein Projekt ist über seinem Fälligkeitsdatum.', 'No project is past its due date.'),
    over.length ? tr(`Mehraufwand erwartet: ${over.map((x) => `${x.name} (${x.progText})`).join(', ')}.`, `Extra effort expected: ${over.map((x) => `${x.name} (${x.progText})`).join(', ')}.`) : null,
    tr(`Auslastung ${v.util4.weeksText}: ${fmt.pct(v.util4.avg)}; ${t.util.sub.split(' · ').at(-1)}.`, `Utilisation ${v.util4.weeksText}: ${fmt.pct(v.util4.avg)}; ${t.util.sub.split(' · ').at(-1)}.`),
    wq ? wq.headline : null,
    v.flows.ready ? tr(`Letzte 4 Wochen ${fmt.pct(t.asPlanned.value)} wie geplant, ${t.asPlanned.sub.split(' · ').at(-1)}.`, `Last 4 weeks ${fmt.pct(t.asPlanned.value)} as planned, ${t.asPlanned.sub.split(' · ').at(-1)}.`) : null,
    (r.conflicts || []).length ? tr(`${r.conflicts.length} Terminkonflikt(e) zwischen abhängigen Vorgängen.`, `${r.conflicts.length} date conflict(s) between dependent work items.`) : null,
    k.slaRate != null ? tr(`Support: SLA-Quote ${fmt.pct(k.slaRate)} (${t.support.sub}).`, `Support: SLA rate ${fmt.pct(k.slaRate)} (${t.support.sub}).`) : null,
  ];
  return out.filter(Boolean);
}
