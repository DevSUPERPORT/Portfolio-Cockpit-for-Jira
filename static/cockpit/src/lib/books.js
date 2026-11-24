// Content of every Excel export: which sheets, which columns, which colours.
import { cLevelReport, estimateVsSpent, sizeHours } from '../../../../shared/engine.js'; // relative: also runs in Node tests
import { tr, fmt, healthName, ruleName, roleName } from './i18n.js';
import { getContext } from './api.js';
import { downloadWorkbook } from './xlsx.js';

let site = null;
async function siteUrl() {
  if (site == null) site = (await getContext().catch(() => ({})))?.siteUrl || '';
  return site;
}
const link = (base, key) => (key ? { text: key, url: base ? `${base}/browse/${key}` : null } : null);
const HT = { onTrack: 'ok', atRisk: 'warn', critical: 'bad' };
const WT = { ok: 'ok', partial: 'warn', no: 'bad' };
const wlName = (s) => ({ ok: tr('besetzbar', 'staffable'), partial: tr('teilweise', 'partly'), no: tr('nicht besetzbar', 'not staffable') }[s] || '–');
const stamp = (ds) => `${tr('Stand', 'As of')} ${fmt.dateLong(ds.today)} · ${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
const teamName = (model, id) => model.teams.get(id)?.name || (id === '_none' ? tr('Ohne Team', 'No team') : id);

function projectRows(ds, computed, base) {
  const { model, metrics, wl } = computed;
  const sizes = ds.config?.tshirtSizes || [];
  const deps = computed.deps.list;
  return [...ds.portfolio].sort((a, b) => a.rank - b.rank).map((p) => {
    const m = metrics.get(p.ref) || {};
    const conflicts = deps.filter((d) => d.conflict && [d.pre, d.dep].some((id) => model.byId.get(id)?.rootRef === p.ref)).length;
    const openDeps = deps.filter((d) => d.open && [d.pre, d.dep].some((id) => (model.byId.get(id) || model.external.get(id))?.rootRef === p.ref)).length;
    const row = {
      rank: p.rank, global: p.globalRank ?? p.rank, key: link(base, p.kind === 'issue' ? p.key : null) || (p.key ? { text: p.key } : null), name: p.name,
      owner: p.owner?.name || '', status: p.status?.name || (m.done ? tr('erledigt', 'done') : ''), health: p.health ? healthName(p.health.status) : tr('kein Update', 'no update'),
      healthTone: HT[p.health?.status], comment: p.health?.comment || '', healthAt: p.health?.at || null, healthBy: p.health?.byName || '',
      // maturity stays empty without a T-shirt size: unknown, not 0 %
      progress: m.progress ?? 0, maturity: m.maturity ?? null, oe: m.OE, ts: m.TS, re: m.RE, forecast: m.forecast, dev: m.OE > 0 ? (m.forecast - m.OE) / m.OE : null,
      tshirt: p.tshirt || '', tshirtH: p.tshirt ? sizeHours(model, p.tshirt) : null, openT: m.openTshirt, quarters: (p.quarters || []).map(fmt.quarter).join(', '),
      start: p.start, due: m.due, overdue: m.daysOverdue || null, team: p.leadTeam?.name || '', stories: m.storyCount, late: m.overdueCount, openDeps, conflicts,
    };
    wl.quarters.forEach((q, i) => { const s = wl.projectQ[p.ref]?.[q]?.status; row[`w${i}`] = m.done ? tr('erledigt', 'done') : wlName(s || 'ok'); row[`wt${i}`] = m.done ? 'muted' : WT[s || 'ok']; });
    return row;
  });
}

function projectSheet(ds, computed, base) {
  const { wl } = computed;
  return {
    name: tr('Projekte', 'Projects'), description: tr('Alle Portfolio-Projekte mit Rang, Health, Fortschritt, Stunden, Terminen und Wasserlinie', 'All portfolio projects with rank, health, progress, hours, dates and waterline'),
    freezeCols: 4, totals: ['oe', 'ts', 're', 'forecast', 'tshirtH', 'openT'],
    rows: projectRows(ds, computed, base),
    columns: [
      { header: tr('Rang', 'Rank'), key: 'rank', type: 'int', width: 7, bold: true }, { header: tr('Globaler Rang', 'Global rank'), key: 'global', type: 'int', width: 9 },
      { header: tr('Schlüssel', 'Key'), key: 'key', type: 'link', width: 11 }, { header: tr('Projekt', 'Project'), key: 'name', width: 34, bold: true },
      { header: 'Owner', key: 'owner', width: 18 }, { header: 'Status', key: 'status', width: 14 },
      { header: 'Health', key: 'health', width: 13, tone: (r) => r.healthTone }, { header: tr('Health-Kommentar', 'Health comment'), key: 'comment', width: 44, wrap: true },
      { header: tr('Health am', 'Health on'), key: 'healthAt', type: 'date', width: 12 }, { header: tr('Health von', 'Health by'), key: 'healthBy', width: 16 },
      { header: tr('Fortschritt', 'Progress'), key: 'progress', type: 'pct', width: 11, bar: true }, { header: tr('Planungsreife', 'Maturity'), key: 'maturity', type: 'pct', width: 11, bar: true },
      { header: 'Original Estimate', key: 'oe', type: 'hours', width: 13 }, { header: 'Time Spent', key: 'ts', type: 'hours', width: 12 }, { header: 'Remaining', key: 're', type: 'hours', width: 12 },
      { header: tr('Prognose', 'Forecast'), key: 'forecast', type: 'hours', width: 12 },
      { header: tr('Prognose vs. Schätzung', 'Forecast vs. estimate'), key: 'dev', type: 'pct1', width: 12, tone: (r) => (r.dev > 0.1 ? 'bad' : r.dev < -0.1 ? 'info' : null) },
      { header: tr('T-Shirt', 'T-shirt'), key: 'tshirt', width: 9 }, { header: tr('T-Shirt h', 'T-shirt h'), key: 'tshirtH', type: 'hours', width: 11 },
      { header: tr('Offene T-Shirt h', 'Open T-shirt h'), key: 'openT', type: 'hours', width: 12 }, { header: tr('Ziel-Quartale', 'Target quarters'), key: 'quarters', width: 22 },
      { header: 'Start', key: 'start', type: 'date', width: 12 }, { header: tr('Fällig', 'Due'), key: 'due', type: 'date', width: 12 },
      { header: tr('Tage überfällig', 'Days overdue'), key: 'overdue', type: 'int', width: 10, tone: (r) => (r.overdue > 0 ? 'bad' : null) },
      { header: tr('Lead-Team', 'Lead team'), key: 'team', width: 14 }, { header: 'Stories', key: 'stories', type: 'int', width: 9 },
      { header: tr('Stories über Due Date', 'Stories past due'), key: 'late', type: 'int', width: 11, tone: (r) => (r.late > 0 ? 'warn' : null) },
      { header: tr('Offene Abhängigkeiten', 'Open dependencies'), key: 'openDeps', type: 'int', width: 12 },
      { header: tr('Terminkonflikte', 'Date conflicts'), key: 'conflicts', type: 'int', width: 11, tone: (r) => (r.conflicts > 0 ? 'bad' : null) },
      ...wl.quarters.map((q, i) => ({ header: `${tr('Wasserlinie', 'Waterline')} ${fmt.quarter(q)}`, key: `w${i}`, width: 15, tone: (r) => r[`wt${i}`] })),
    ],
    note: tr('Fortschritt = Time Spent ÷ (Spent + Remaining + offene T-Shirts). Prognose = Spent + Remaining. Wasserlinie: Kapazität je Team, nach Rang verteilt, Support zuerst.', 'Progress = time spent ÷ (spent + remaining + open T-shirts). Forecast = spent + remaining. Waterline: team capacity allocated by rank, support first.'),
  };
}

function waterlineSheet(ds, computed) {
  const { model, wl, metrics } = computed;
  const rows = [];
  for (const p of [...ds.portfolio].sort((a, b) => a.rank - b.rank)) {
    if (metrics.get(p.ref)?.done) continue;
    for (const q of wl.quarters) for (const tq of wl.projectQ[p.ref]?.[q]?.teams || []) {
      rows.push({ rank: p.rank, name: p.name, q: fmt.quarter(q), team: teamName(model, tq.teamId), demand: tq.demand, staffed: tq.staffed, gap: Math.max(0, tq.demand - tq.staffed), status: wlName(tq.status), tone: WT[tq.status] });
    }
  }
  return {
    name: tr('Wasserlinie', 'Waterline'), description: tr('Bedarf je Projekt, Quartal und Team – wie viel davon besetzbar ist', 'Demand per project, quarter and team – and how much of it is staffable'),
    freezeCols: 2, totals: ['demand', 'staffed', 'gap'], rows,
    columns: [
      { header: tr('Rang', 'Rank'), key: 'rank', type: 'int', width: 7 }, { header: tr('Projekt', 'Project'), key: 'name', width: 32, bold: true }, { header: tr('Quartal', 'Quarter'), key: 'q', width: 10 },
      { header: 'Team', key: 'team', width: 16 }, { header: tr('Bedarf', 'Demand'), key: 'demand', type: 'hours', width: 12 }, { header: tr('Besetzbar', 'Staffable'), key: 'staffed', type: 'hours', width: 12 },
      { header: tr('Lücke', 'Gap'), key: 'gap', type: 'hours', width: 11, tone: (r) => (r.gap > 0.05 ? 'bad' : null) }, { header: 'Status', key: 'status', width: 15, tone: (r) => r.tone },
    ],
  };
}

function capacitySheets(ds, computed) {
  const { model, wl, weeks } = computed;
  const qRows = [];
  for (const t of wl.teamIds) for (const q of wl.quarters) {
    const c = wl.cells[t]?.[q];
    if (!c) continue;
    const wr = c.waterRank ? model.items.find((p) => p.rank === c.waterRank)?.name : null;
    const cp = c.capParts;
    const capCalc = cp ? `${fmt.n(cp.weekly, 1)} h/${tr('Woche', 'week')} × ${cp.weeks} ${tr('Wochen', 'weeks')} × ${Math.round(cp.share * 100)} % ${tr('für Projekte', 'for projects')}${cp.absencePct ? ` × ${100 - cp.absencePct} % ${tr('ohne Ausfall', 'without absence')}` : ''}` : '';
    qRows.push({ team: teamName(model, t), q: fmt.quarter(q), capCalc, cap: c.capacity, sup: c.support, demand: c.demand, free: c.capacity - c.demand, util: Number.isFinite(c.util) ? c.util : null, unsched: c.unscheduled || null, water: c.waterRank ? `${c.waterRank}. ${wr || ''}` : tr('alles besetzbar', 'all staffable') });
  }
  const sheets = [{
    name: tr('Kapazität Quartale', 'Capacity quarters'), description: tr('Kapazität, Support-Reserve, Bedarf und Auslastung je Team und Quartal', 'Capacity, support reserve, demand and utilisation per team and quarter'),
    freezeCols: 2, totals: ['cap', 'sup', 'demand'], rows: qRows,
    columns: [
      { header: 'Team', key: 'team', width: 18, bold: true }, { header: tr('Quartal', 'Quarter'), key: 'q', width: 10 },
      { header: tr('Kapazität – Rechnung', 'Capacity – calculation'), key: 'capCalc', width: 44 }, { header: tr('Kapazität', 'Capacity'), key: 'cap', type: 'hours', width: 12 }, { header: tr('Support-Reserve', 'Support reserve'), key: 'sup', type: 'hours', width: 13 },
      { header: tr('Bedarf inkl. Support', 'Demand incl. support'), key: 'demand', type: 'hours', width: 14 }, { header: tr('Frei', 'Free'), key: 'free', type: 'hours', width: 11, tone: (r) => (r.free < 0 ? 'bad' : null) },
      { header: tr('Auslastung', 'Utilisation'), key: 'util', type: 'pct', width: 11, scale: true }, { header: tr('Ohne Termin (aktuelles Q)', 'Unscheduled (current Q)'), key: 'unsched', type: 'hours', width: 14 },
      { header: tr('Wasserlinie ab', 'Waterline from'), key: 'water', width: 30 },
    ],
  }];
  if (weeks) {
    const wRows = weeks.teams.filter((t) => t.capTotal > 0 || t.planTotal > 0).map((t) => {
      const r = { team: teamName(model, t.teamId), plan: t.planTotal, cap: t.capTotal, avg: t.capTotal > 0 ? t.planTotal / t.capTotal : null };
      t.util.forEach((u, i) => { r[`u${i}`] = Number.isFinite(u) ? u : null; });
      return r;
    });
    sheets.push({
      name: tr('Auslastung Wochen', 'Utilisation weeks'), description: tr('Geplante Stunden ÷ Kapazität je Team und Woche (8 Wochen)', 'Planned hours ÷ capacity per team and week (8 weeks)'),
      freezeCols: 1, totals: ['plan', 'cap'], rows: wRows,
      columns: [
        { header: 'Team', key: 'team', width: 18, bold: true }, { header: tr('Geplant', 'Planned'), key: 'plan', type: 'hours', width: 12 }, { header: tr('Kapazität', 'Capacity'), key: 'cap', type: 'hours', width: 12 },
        { header: tr('Ø Auslastung', 'Avg utilisation'), key: 'avg', type: 'pct', width: 12, scale: true },
        ...weeks.weeks.map((w, i) => ({ header: `${fmt.week(w.from)} (${fmt.date(w.from)})`, key: `u${i}`, type: 'pct', width: 13, scale: true })),
      ],
    });
  }
  return sheets;
}

function healthSheet(ds) {
  const rows = [...ds.portfolio].sort((a, b) => a.rank - b.rank).map((p) => ({ rank: p.rank, name: p.name, status: p.health ? healthName(p.health.status) : tr('kein Update', 'no update'), tone: HT[p.health?.status] || 'muted', comment: p.health?.comment || '', by: p.health?.byName || '', at: p.health?.at || null }));
  return {
    name: 'Health', description: tr('Aktueller Health-Status je Projekt mit Kommentar', 'Current health per project with comment'), rows, freezeCols: 2,
    columns: [{ header: tr('Rang', 'Rank'), key: 'rank', type: 'int', width: 7 }, { header: tr('Projekt', 'Project'), key: 'name', width: 34, bold: true }, { header: 'Status', key: 'status', width: 14, tone: (r) => r.tone },
      { header: tr('Kommentar', 'Comment'), key: 'comment', width: 70, wrap: true }, { header: tr('Von', 'By'), key: 'by', width: 18 }, { header: tr('Am', 'On'), key: 'at', type: 'date', width: 12 }],
  };
}

function depsSheet(computed, list, base) {
  const { model } = computed;
  const get = (id) => model.byId.get(id) || model.external.get(id) || {};
  const proj = (i) => model.itemByRef.get(i?.rootRef)?.name || '';
  const rows = list.map((d) => {
    const pre = get(d.pre), dep = get(d.dep);
    return { pre: link(base, pre.key), preS: pre.summary || '', preP: proj(pre), preDue: pre.due, rel: d.relation, dep: link(base, dep.key), depS: dep.summary || '', depP: proj(dep), depStart: dep.start,
      status: d.conflict ? tr('Konflikt', 'Conflict') : d.open ? tr('offen', 'open') : tr('erledigt', 'done'), tone: d.conflict ? 'bad' : d.open ? 'info' : 'ok', days: d.conflict ? d.conflictDays : null, note: d.note || '' };
  });
  return {
    name: tr('Abhängigkeiten', 'Dependencies'), description: tr('Voraussetzung → abhängiger Vorgang, mit Terminkonflikten', 'Prerequisite → dependent work item, with date conflicts'), rows, freezeCols: 1,
    columns: [
      { header: tr('Voraussetzung', 'Prerequisite'), key: 'pre', type: 'link', width: 12 }, { header: tr('Titel', 'Summary'), key: 'preS', width: 30 }, { header: tr('Projekt', 'Project'), key: 'preP', width: 24 },
      { header: tr('Fällig', 'Due'), key: 'preDue', type: 'date', width: 12 }, { header: tr('Beziehung', 'Relation'), key: 'rel', width: 14 },
      { header: tr('Abhängig', 'Dependent'), key: 'dep', type: 'link', width: 12 }, { header: tr('Titel', 'Summary'), key: 'depS', width: 30 }, { header: tr('Projekt', 'Project'), key: 'depP', width: 24 },
      { header: 'Start', key: 'depStart', type: 'date', width: 12 }, { header: 'Status', key: 'status', width: 12, tone: (r) => r.tone },
      { header: tr('Konflikt-Tage', 'Conflict days'), key: 'days', type: 'int', width: 11, tone: (r) => (r.days ? 'bad' : null) }, { header: tr('Hinweis', 'Note'), key: 'note', width: 40, wrap: true },
    ],
  };
}

function gapSheets(computed, gaps, levelName, base) {
  const { dq, model } = computed;
  return [{
    name: tr('Lücken', 'Gaps'), description: tr('Fehlende Pflichtangaben je Vorgang – sortiert nach Dringlichkeit', 'Missing required data per work item – most urgent first'),
    rows: [...gaps].sort((a, b) => b.urgent - a.urgent).map((g) => ({ rule: ruleName(g.rule), key: link(base, g.key), summary: g.summary || '', level: levelName(g.levelKey), project: model.itemByRef.get(g.rootRef)?.name || '',
      who: g.responsible && !g.responsible.anon ? g.responsible.name : '', urgent: g.urgent ? tr('dringend', 'urgent') : '', fixable: g.fixable ? tr('im Cockpit füllbar', 'fixable in the cockpit') : tr('in Jira', 'in Jira') })),
    freezeCols: 2,
    columns: [
      { header: tr('Regel', 'Rule'), key: 'rule', width: 28, bold: true }, { header: tr('Schlüssel', 'Key'), key: 'key', type: 'link', width: 12 }, { header: tr('Titel', 'Summary'), key: 'summary', width: 36 },
      { header: tr('Ebene', 'Level'), key: 'level', width: 14 }, { header: tr('Projekt', 'Project'), key: 'project', width: 26 }, { header: tr('Verantwortlich', 'Responsible'), key: 'who', width: 18 },
      { header: tr('Dringend', 'Urgent'), key: 'urgent', width: 10, tone: (r) => (r.urgent ? 'warn' : null) }, { header: tr('Behebung', 'Fix'), key: 'fixable', width: 18 },
    ],
  }, {
    name: tr('Regeln', 'Rules'), description: tr('Lücken je Prüfregel', 'Gaps per check rule'), totals: ['count', 'urgent'],
    rows: dq.rules.map((r) => ({ rule: ruleName(r.rule), sev: r.severity === 'hint' ? tr('Hinweis', 'Hint') : tr('Lücke', 'Gap'), count: r.count, urgent: r.urgent })),
    columns: [{ header: tr('Regel', 'Rule'), key: 'rule', width: 36, bold: true }, { header: tr('Art', 'Kind'), key: 'sev', width: 10 }, { header: tr('Anzahl', 'Count'), key: 'count', type: 'int', width: 10 }, { header: tr('Dringend', 'Urgent'), key: 'urgent', type: 'int', width: 10, tone: (r) => (r.urgent ? 'warn' : null) }],
  }, {
    name: tr('Vollständigkeit', 'Completeness'), description: tr('Anteil vollständiger Vorgänge je Ebene', 'Share of complete work items per level'),
    rows: dq.levels.map((l) => ({ level: levelName(l.levelKey), complete: l.complete, total: l.total, pct: l.pct })),
    columns: [{ header: tr('Ebene', 'Level'), key: 'level', width: 22, bold: true }, { header: tr('Vollständig', 'Complete'), key: 'complete', type: 'int', width: 12 }, { header: tr('Gesamt', 'Total'), key: 'total', type: 'int', width: 10 }, { header: tr('Quote', 'Rate'), key: 'pct', type: 'pct', width: 10, bar: true }],
  }];
}

function timeSheets(computed, res, people) {
  const { model } = computed;
  const name = (r, persons) => (persons ? people?.[r.id]?.name || tr('Unbekannt', 'Unknown') : teamName(model, r.id));
  const mk = (list, persons) => list.map((r) => ({ name: name(r, persons), est: r.est, logged: r.logged, dev: r.logged - r.est, devPct: r.est > 0 ? (r.logged - r.est) / r.est : null }));
  const cols = (label) => [{ header: label, key: 'name', width: 24, bold: true }, { header: tr('Geschätzt', 'Estimated'), key: 'est', type: 'hours', width: 12 }, { header: tr('Erfasst', 'Logged'), key: 'logged', type: 'hours', width: 12 },
    { header: tr('Abweichung', 'Deviation'), key: 'dev', type: 'hours', width: 12 }, { header: tr('Abweichung %', 'Deviation %'), key: 'devPct', type: 'pct', width: 12, tone: (r) => (Math.abs(r.devPct || 0) >= 0.15 ? (r.devPct > 0 ? 'bad' : 'warn') : null) }];
  const byProject = res.teams.flatMap((t) => t.byProject.map((b) => ({ team: teamName(model, t.id), project: model.itemByRef.get(b.ref)?.name || b.ref, est: b.est, logged: b.logged })));
  return [
    { name: 'Teams', description: tr('Geschätzt vs. erfasst je Team im Zeitraum', 'Estimated vs. logged per team in the period'), rows: mk(res.teams), totals: ['est', 'logged', 'dev'], columns: cols('Team') },
    ...(res.persons?.length ? [{ name: tr('Personen', 'People'), description: tr('Geschätzt vs. erfasst je Person', 'Estimated vs. logged per person'), rows: mk(res.persons, true), totals: ['est', 'logged', 'dev'], columns: cols(tr('Person', 'Person')) }] : []),
    { name: tr('Nach Projekt', 'By project'), description: tr('Stunden je Team und Projekt', 'Hours per team and project'), rows: byProject, totals: ['est', 'logged'],
      columns: [{ header: 'Team', key: 'team', width: 18, bold: true }, { header: tr('Projekt', 'Project'), key: 'project', width: 32 }, { header: tr('Geschätzt', 'Estimated'), key: 'est', type: 'hours', width: 12 }, { header: tr('Erfasst', 'Logged'), key: 'logged', type: 'hours', width: 12 }] },
  ];
}

function kpis(ds, computed) {
  const { metrics, wl } = computed;
  const active = ds.portfolio.filter((p) => !metrics.get(p.ref)?.done);
  const S = (f) => active.reduce((a, p) => a + (f(metrics.get(p.ref)) || 0), 0);
  const TS = S((m) => m.TS), RE = S((m) => m.RE), OT = S((m) => m.openTshirt), OE = S((m) => m.OE);
  const q = wl.quarters[0];
  const staffable = active.filter((p) => (wl.projectQ[p.ref]?.[q]?.status || 'ok') === 'ok').length;
  const health = (s) => ds.portfolio.filter((p) => p.health?.status === s).length;
  return [
    { label: tr('Aktive Projekte', 'Active projects'), value: active.length, type: 'int', note: `${ds.portfolio.length - active.length} ${tr('abgeschlossen', 'completed')}` },
    { label: tr('Gesamtfortschritt', 'Overall progress'), value: TS + RE + OT > 0 ? TS / (TS + RE + OT) : 0, type: 'pct', note: tr('Time Spent ÷ (Spent + Remaining + offene T-Shirts)', 'Spent ÷ (spent + remaining + open T-shirts)') },
    { label: tr('Planungsreife', 'Maturity'), value: OE + OT > 0 ? OE / (OE + OT) : 0, type: 'pct', note: tr('Anteil bereits als Story geschätzt', 'Share already estimated as stories') },
    { label: `${tr('Voll besetzbar', 'Fully staffable')} ${fmt.quarter(q)}`, value: staffable, type: 'int', tone: staffable < active.length ? 'warn' : 'ok', note: `${tr('von', 'of')} ${active.length}` },
    { label: tr('Kritisch', 'Critical'), value: health('critical'), type: 'int', tone: health('critical') ? 'bad' : null },
    { label: tr('Gefährdet', 'At risk'), value: health('atRisk'), type: 'int', tone: health('atRisk') ? 'warn' : null },
    { label: tr('Terminkonflikte', 'Date conflicts'), value: computed.deps.conflicts || 0, type: 'int', tone: computed.deps.conflicts ? 'bad' : null },
    { label: tr('Datenqualität', 'Data quality'), value: computed.dq.score, type: 'pct' },
    { label: 'Time Spent', value: TS, type: 'hours' }, { label: 'Remaining', value: RE, type: 'hours' }, { label: tr('Offene T-Shirt-Stunden', 'Open T-shirt hours'), value: OT, type: 'hours' },
  ];
}

// ---------- public exports ----------
export async function exportPortfolio(app) {
  const { ds, computed } = app;
  const base = await siteUrl();
  return downloadWorkbook(tr('portfolio', 'portfolio'), {
    title: tr('Portfolio-Übersicht', 'Portfolio overview'), subtitle: stamp(ds), kpis: kpis(ds, computed),
    sheets: [projectSheet(ds, computed, base), waterlineSheet(ds, computed), ...capacitySheets(ds, computed), healthSheet(ds)],
  });
}
export async function exportDependencies(app, list) {
  const base = await siteUrl();
  const conflicts = list.filter((d) => d.conflict).length;
  return downloadWorkbook(tr('abhaengigkeiten', 'dependencies'), {
    title: tr('Abhängigkeiten', 'Dependencies'), subtitle: stamp(app.ds),
    kpis: [{ label: tr('Abhängigkeiten in der Auswahl', 'Dependencies in selection'), value: list.length, type: 'int' }, { label: tr('Offen', 'Open'), value: list.filter((d) => d.open).length, type: 'int' },
      { label: tr('Terminkonflikte', 'Date conflicts'), value: conflicts, type: 'int', tone: conflicts ? 'bad' : 'ok' }, { label: tr('Ohne Hinweis', 'Without note'), value: list.filter((d) => d.missingNote).length, type: 'int' }],
    sheets: [depsSheet(app.computed, list, base)],
  });
}
export async function exportQuality(app, gaps, levelName) {
  const base = await siteUrl();
  const dq = app.computed.dq;
  return downloadWorkbook(tr('datenqualitaet', 'data-quality'), {
    title: tr('Datenqualität', 'Data quality'), subtitle: stamp(app.ds),
    kpis: [{ label: tr('Vollständig', 'Complete'), value: dq.score, type: 'pct', tone: dq.score >= 0.85 ? 'ok' : dq.score >= 0.65 ? 'warn' : 'bad' }, { label: tr('Lücken gesamt', 'Gaps total'), value: dq.gaps.length, type: 'int' },
      { label: tr('Dringend (≤ 4 Wochen)', 'Urgent (≤ 4 weeks)'), value: dq.gaps.filter((g) => g.urgent).length, type: 'int', tone: 'warn' }, { label: tr('In dieser Auswahl', 'In this selection'), value: gaps.length, type: 'int' }],
    sheets: gapSheets(app.computed, gaps, levelName || ((k) => roleName(k)), base),
  });
}
export async function exportTime(app, res, periodLabel) {
  return downloadWorkbook(tr('zeit-vs-schaetzung', 'time-vs-estimate'), {
    title: tr('Zeit vs. Schätzung', 'Time vs. estimate'), subtitle: `${periodLabel} · ${stamp(app.ds)}`,
    kpis: [{ label: tr('Geschätzt', 'Estimated'), value: res.est, type: 'hours' }, { label: tr('Erfasst', 'Logged'), value: res.logged, type: 'hours' },
      { label: tr('Abweichung', 'Deviation'), value: res.dev, type: 'hours', tone: res.dev > 0 ? 'bad' : null, note: res.est > 0 ? fmt.signedPct(res.devPct) : '' }, { label: tr('Arbeitstage', 'Working days'), value: res.workdays, type: 'int' }],
    sheets: timeSheets(app.computed, res, app.ds.people),
  });
}
export async function exportCapacity(app) {
  return downloadWorkbook(tr('kapazitaet', 'capacity'), { title: tr('Kapazität & Auslastung', 'Capacity & utilisation'), subtitle: stamp(app.ds), kpis: kpis(app.ds, app.computed).slice(0, 4), sheets: capacitySheets(app.ds, app.computed) });
}
// Everything in one workbook (from the C-level report).
export async function exportEverything(app, levelName) {
  const { ds, computed } = app;
  const base = await siteUrl();
  const model = computed.model;
  const res = estimateVsSpent(model, model.today - 30, model.today);
  return downloadWorkbook(tr('portfolio-komplett', 'portfolio-complete'), {
    title: tr('Portfolio – Gesamtbericht', 'Portfolio – full report'), subtitle: stamp(ds), kpis: kpis(ds, computed),
    sheets: [projectSheet(ds, computed, base), healthSheet(ds), waterlineSheet(ds, computed), ...capacitySheets(ds, computed), depsSheet(computed, computed.deps.list, base),
      ...gapSheets(computed, computed.dq.gaps, levelName || ((k) => roleName(k)), base), ...timeSheets(computed, res, ds.people).map((s) => ({ ...s, name: `${s.name} (30 ${tr('Tage', 'days')})` }))],
  });
}
export { cLevelReport };
