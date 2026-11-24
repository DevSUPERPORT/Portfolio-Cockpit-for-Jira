// Confluence storage-format rendering of the C-level report (UC-06). Built on the server from the stored
// snapshot only; every value is escaped. Same wording and numbers as the screen and the PDF (shared/reportKpis.js).
// Individual values of people never go to Confluence: the page is readable by everyone in the space.
import { reportKpis, reportForViewer } from '../../shared/reportKpis.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lozenge = (txt, colour) => `<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">${colour}</ac:parameter><ac:parameter ac:name="title">${esc(txt)}</ac:parameter></ac:structured-macro>`;
const COLOUR = { bad: 'Red', warn: 'Yellow', ok: 'Green', soft: 'Grey' };

export function reportStorageHtml(r, lang = 'de') {
  const L = lang === 'en' ? 'en' : 'de';
  const T = (de, en) => (L === 'de' ? de : en);
  const v = reportKpis({ report: reportForViewer(r, { logs: 'none' }), lang: L });
  const health = { onTrack: [T('Im Plan', 'On track'), 'Green'], atRisk: [T('Gefährdet', 'At risk'), 'Yellow'], critical: [T('Kritisch', 'Critical'), 'Red'] };
  const asOf = r.asOf ? `${new Date(r.asOf).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '–';
  const pct = (x) => (x == null || !Number.isFinite(x) ? '–' : L === 'de' ? `${Math.round(x * 100)} %` : `${Math.round(x * 100)}%`);
  const h = (x) => (x == null || !Number.isFinite(x) ? '–' : `${Math.round(x)} h`);

  const kpis = `<table><tbody><tr>${v.tiles.map((t) => `<th>${esc(t.label)}</th>`).join('')}</tr>
<tr>${v.tiles.map((t) => `<td><strong>${esc(t.display)}</strong><br/><em>${esc(t.sub)}</em></td>`).join('')}</tr></tbody></table>`;

  const rows = v.rows.map((x) => `<tr><td>${esc(x.rank)}</td><td><strong>${esc(x.name)}</strong> (${esc(x.key)})${x.owner ? ` · ${esc(x.owner)}` : ''}${x.waitText ? `<br/><em>${esc(x.waitText)}</em>` : ''}</td>
<td>${x.health ? lozenge(...health[x.health]) : esc(T('kein Update', 'no update'))}</td>
<td>${esc(x.due || '–')}${x.daysOverdue > 0 ? ` (+${esc(x.daysOverdue)} ${esc(T('Tage', 'days'))})` : ''}</td>
<td>${esc(pct(x.progress))}<br/><em>${esc(x.progressSub)}</em></td><td>${esc(x.progText)}</td><td>${lozenge(x.term.text, COLOUR[x.term.tone] || 'Grey')}</td></tr>`).join('');

  const wl = v.waterline.quarters.map((q) => {
    const b = v.waterline.byQ[q];
    return `<h3>${esc(b.label)}</h3><p>${esc(b.headline)}</p>
<table><tbody><tr><th>${T('Team', 'Team')}</th><th>${T('Auslastung', 'Utilisation')}</th><th>${T('Einschätzung', 'Assessment')}</th></tr>
${b.teams.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.utilText)}</td><td>${esc(t.sentence)}</td></tr>`).join('')}</tbody></table>`;
  }).join('');

  const u = v.util4;
  const util = `<table><tbody><tr><th>Team</th>${u.weekLabels.map((w) => `<th>${esc(w)}</th>`).join('')}<th>${T('Ø 4 Wochen', 'Avg 4 weeks')}</th></tr>
${u.teams.map((t) => `<tr><td>${esc(t.name)}</td>${u.weekLabels.map((_, i) => `<td>${esc(pct(t.u?.[i]))}</td>`).join('')}<td><strong>${esc(t.utilText)}</strong>${t.reason ? ` (${esc(t.reason)})` : ''}</td></tr>`).join('')}
<tr><td><strong>${T('Alle Teams', 'All teams')}</strong></td>${u.weekLabels.map(() => '<td></td>').join('')}<td><strong>${esc(pct(u.avg))}</strong></td></tr></tbody></table>`;

  const f = v.flows;
  const flows = f.ready && f.rows.length
    ? `<p>${esc(f.period)} · ${esc(f.note)}</p><table><tbody><tr><th>${T('Wohin', 'Where')}</th><th>${T('Stunden', 'Hours')}</th></tr>${f.rows.map((x) => `<tr><td>${esc(x.label)}</td><td>${esc(h(x.h))}</td></tr>`).join('')}</tbody></table>`
    : `<p><em>${esc(f.note)}</em></p>`;

  return `<p>${esc(T('Stand', 'As of'))} ${esc(asOf)}, ${esc(T('täglich berechnet · alle Projekte · freigegeben für', 'computed daily · all projects · shared with'))} ${esc(v.header.audience)}</p>
${kpis}
<h2>${esc(T('Laufende Projekte nach Rang', 'Running projects by rank'))}</h2>
<table><tbody><tr><th>${T('Rang', 'Rank')}</th><th>${T('Projekt', 'Project')}</th><th>Health</th><th>Due Date</th><th>${T('Fortschritt', 'Progress')}</th><th>${T('Prognose', 'Forecast')}</th><th>${T('Termin', 'Schedule')}</th></tr>${rows}</tbody></table>
<h2>${esc(T('Kapazität nach Rangfolge', 'Capacity by rank'))}</h2>
<p>${esc(T('Wie die Wasserlinie im Portfolio: Support zuerst, dann werden die Projekte je Team in Rangfolge mit Kapazität aufgefüllt.', 'Like the waterline in the portfolio: support first, then each team\'s capacity is filled with the projects in rank order.'))}</p>
${wl}
<h2>${esc(T('Auslastung nächste 4 Wochen', 'Utilisation next 4 weeks'))}</h2>
${util}
<h2>${esc(T('Wohin floss die Zeit? · letzte 4 Wochen', 'Where did the time go? · last 4 weeks'))}</h2>
${flows}
<p><em>${esc(v.progressFormula)}. ${esc(T(`Prognose = (Time Spent + Remaining Estimate) gegen Original Estimate; Mehraufwand ab +${v.thresholdPct} %.`, `Forecast = (time spent + remaining estimate) against original estimate; extra effort from +${v.thresholdPct}%.`))} ${esc(T('Erstellt mit Portfolio Cockpit von SUPERPORT.', 'Created with Portfolio Cockpit by SUPERPORT.'))}</em></p>`;
}
