// KPI registry: ONE definition per number. Every tile (project details, portfolio), its hover breakdown, the
// legend and the tests read from here, so a number can never be computed or explained in two ways.
// Each KPI returns: value, display, a short base line ("foot"), the calculation with the real numbers, the
// inputs it is built from, and the work items behind it.
import { dataQuality, spreadWindow, shareIn, capacityPeople, personCapacityIn, maturityOf, sizeHours, roughUnits as engineRoughUnits, teamSettings, projectShare, ancestor } from './engine.js';
import { teamDetails } from './team.js';
import { inTeam, shareOf } from './allocation.js';
import { dayIdx, weeksFrom, quarterRange, isoOf } from './dates.js';

const T = (lang, de, en) => (lang === 'de' ? de : en);
const isOpen = (i) => (i.status?.cat ?? i.statusCat ?? 'new') !== 'done';
// Rules that make a story incomplete (the data-quality definition); 'overdue' and hints do not.
const COMPLETENESS = (rule) => rule.startsWith('missing:') || rule === 'dueAfterMilestone' || rule === 'datesInverted';

// ---------- proof ("Nachprüfen"): the records every number is computed from ----------
// proof = { columns: [{ id, label, unit: 'h'|'n'|'pct'|'date'|'text' }], rows: [{ key?, issueId?, ref?, label, group?, values,
//   children?: { columns, rows } }], totals: [{ id, col?, agg?: 'sum'|'rows', where?: { group }, value, label, given?, unit?, source? }],
//   final?: { op: 'ratio', num: [totalId], den: [totalId | '-totalId'], offset?, value } | { op: 'total', id, value, clamp0? } |
//   { op: 'given', value }, steps: [plain sentences], note? }
// totals are the exact figures of `calc`: summing a column over the rows (agg 'sum', optionally only rows of one group)
// or counting the rows (agg 'rows') gives them again – the panel recomputes that in the browser, the tests here.
// Children (an epic's stories, a project's epics) are details to open, not summed into the totals.
const issueLabel = (i) => `${i?.key || ''} ${i?.summary || ''}`.trim();
const issueRow = (i, values, extra = {}) => ({ key: i.key || null, issueId: i.id || null, label: issueLabel(i), values, ...extra });
const colOf = (id, label, unit) => ({ id, label, unit });
const totalOf = (id, col, value, label, extra = {}) => ({ id, col, value, label, agg: 'sum', ...extra });
const levelName = (model, role, fallback) => (model.cfg.levels || []).find((l) => l.role === role)?.name || fallback;
// the stories under each rough unit (same rule as the engine: the item itself, or the nearest rough ancestor)
function storiesByUnit(model, p, units, stories) {
  const itemIsUnit = units.length === 1 && units[0].isItem;
  const by = new Map();
  for (const s of stories) {
    const u = itemIsUnit ? `item:${p.ref}` : ancestor(model, s, 'rough')?.id ?? '_none';
    (by.get(u) || by.set(u, []).get(u)).push(s);
  }
  return by;
}
// The maturity rows of one project: its rough units (epics, or the project itself) with T-shirt size, quarters,
// original estimate (counted only below a size), open size – each unit opens to its stories.
function maturityUnits(L, model, p, m, fmt) {
  const issues = model.byRoot.get(p.ref) || [];
  const stories = issues.filter((i) => i.role === 'estimate');
  const by = storiesByUnit(model, p, (m.units || []).map((u) => ({ isItem: u.isItem })), stories);
  const storyCols = [colOf('oe', 'Original Estimate', 'h'), colOf('status', T(L, 'Status', 'Status'), 'text'), colOf('due', 'Due Date', 'date')];
  const storyRows = (list) => ({ columns: storyCols, rows: list.map((s) => issueRow(s, { oe: s.oe || 0, status: s.status?.name || '', due: s.due || null })) });
  const rows = (m.units || []).map((u) => {
    const sized = u.hours > 0;
    return {
      key: u.isItem ? p.key || null : u.key || null, issueId: u.isItem ? null : u.id, ref: u.isItem ? p.ref : undefined, id: u.id,
      label: `${u.key ? `${u.key} ` : ''}${u.name || u.id}`, group: sized ? 'sized' : 'unsized',
      values: { tshirt: u.tshirt || '', size: u.hours || 0, quarters: (u.quarters || []).map(fmt.quarter).join(', '), oe: sized ? u.oe : 0, oeOut: sized ? 0 : u.oe, open: u.open || 0, ...(m.expired > 0 ? { expired: u.expired || 0 } : {}) },
      children: storyRows(by.get(u.id) || []),
    };
  });
  const loose = by.get('_none') || [];
  if (loose.length) {
    rows.push({ label: T(L, `Stories ohne ${levelName(model, 'rough', 'Epic')} darüber`, `Stories without a ${levelName(model, 'rough', 'epic')} above`), group: 'unsized', id: '_none',
      values: { tshirt: '', size: 0, quarters: '', oe: 0, oeOut: loose.reduce((a, s) => a + (s.oe || 0), 0), open: 0, ...(m.expired > 0 ? { expired: 0 } : {}) }, children: storyRows(loose) });
  }
  const columns = [colOf('tshirt', 'T-Shirt Size', 'text'), colOf('size', T(L, 'in Stunden', 'in hours'), 'h'), colOf('quarters', 'Quarter/s', 'text'),
    colOf('oe', T(L, 'Original Estimate (zählt)', 'Original estimate (counts)'), 'h'), colOf('oeOut', T(L, 'Original Estimate ohne T-Shirt Size', 'Original estimate without T-shirt size'), 'h'),
    colOf('open', T(L, 'Offen', 'Open'), 'h'), ...(m.expired > 0 ? [colOf('expired', T(L, 'Verfallen', 'Lapsed'), 'h')] : [])];
  return { columns, rows };
}

// ---------- definitions (legend) ----------
export function definitions(lang, cfg = {}) {
  const thr = cfg.rules?.forecastThresholdPct ?? 10;
  const L = lang;
  return [
    { id: 'progress', icon: 'gauge', label: T(L, 'Fortschritt', 'Progress'), text: T(L, 'Time Spent ÷ (Time Spent + Remaining Estimate + offene T-Shirt Size). Nicht die Anzahl erledigter Vorgänge.', 'Time spent ÷ (time spent + remaining estimate + open T-shirt size). Not the number of finished work items.') },
    { id: 'forecast', icon: 'up', label: T(L, 'Prognose', 'Forecast'), text: T(L, `Time Spent + Remaining Estimate im Vergleich zum Original Estimate. Rot ab ${thr} % darüber.`, `Time spent + remaining estimate compared with the original estimate. Red from ${thr}% above.`) },
    { id: 'maturity', icon: 'layers', label: T(L, 'Reife', 'Maturity'), text: T(L, 'Original Estimate ÷ (Original Estimate + offene T-Shirt Size) – wie belastbar die Zahlen sind. Gerechnet wird nur, wo eine T-Shirt Size gesetzt ist: Ohne grobe Schätzung ist unbekannt, wie viel noch fehlt, deshalb zeigt das Cockpit dann keine Prozentzahl, sondern was fehlt.', 'Original estimate ÷ (original estimate + open T-shirt size) – how reliable the numbers are. Calculated only where a T-shirt size is set: without a rough estimate it is unknown how much is still missing, so the cockpit shows what is missing instead of a percentage.') },
    { id: 'openTshirt', icon: 'target', label: T(L, 'Offene T-Shirt Size', 'Open T-shirt size'), text: T(L, 'T-Shirt Size des Epics (die Ebene mit der groben Schätzung), in Stunden umgerechnet und gleichmäßig auf seine Quarter/s verteilt, minus Original Estimate der Stories im selben Quartal (mindestens 0). Zählt nur in laufenden und kommenden Quartalen; was in abgelaufenen Quartalen nicht als Story geschätzt wurde, verfällt.', 'T-shirt size of the epic (the level with the rough estimate), converted into hours and spread evenly over its Quarter/s, minus the original estimate of the stories in the same quarter (at least 0). Counts only in the current and coming quarters; what was not estimated as stories in past quarters lapses.') },
    { id: 'dataQuality', icon: 'shield', label: T(L, 'Datenqualität', 'Data quality'), text: T(L, 'Anteil der Epics und Stories, bei denen alle Pflichtfelder aus der Konfiguration gefüllt sind (bei Stories: kein Due Date nach dem Meilenstein). Rot unter 70 %. Fehlende Werte ergänzt du direkt dort, wo du arbeitest: „Fehlende Werte“ in Meine Arbeit, Teams und Projekte.', 'Share of epics and stories whose required fields from the configuration are all filled in (stories: no due date after the milestone). Red below 70%. Fill missing values right where you work: "Missing values" in My work, Teams and Projects.') },
    { id: 'dependencies', icon: 'link', label: T(L, 'Abhängigkeiten', 'Dependencies'), text: T(L, 'Verknüpfungen mit konfigurierten Link-Typen; Konflikt, wenn der Blocker erst nach dem Start des Wartenden fertig wird. Im Portfolio als „wartet auf …“, hier unter Handlungsbedarf, in der Wochenplanung als Banner mit Lösung.', 'Links of the configured link types; a conflict when the blocker finishes only after the waiting item starts. Shown as "waits for …" in the portfolio, under Action needed here, and as a banner with a fix in weekly planning.') },
    { id: 'overdue', icon: 'calendar', label: T(L, 'Über Due Date', 'Past due date'), text: T(L, 'Offene Stories, deren Due Date in der Vergangenheit liegt.', 'Open stories whose due date is in the past.') },
    { id: 'capacity', icon: 'users', label: T(L, 'Kapazität', 'Capacity'), text: T(L, 'Engpässe: Team-Quartale, in denen ein Team dieses Projekt nicht voll besetzen kann, plus Personen mit Problemen in den Wochen bis Quartalsende (über 100 % über alle Projekte, abwesend trotz geplanter Stunden, oder Stunden ohne Assignee). OK, wenn es keine gibt. Lösen lässt sich das in der Wochenplanung (verschieben, umverteilen, Optimieren).', 'Bottlenecks: team quarters in which a team cannot fully staff this project, plus people with problems in the weeks until the end of the quarter (over 100% across all projects, absent despite planned hours, or hours without an assignee). OK when there are none. Resolve them in weekly planning (move, reassign, Optimize).') },
    { id: 'hover', icon: 'info', label: T(L, 'Mouseover', 'Hover'), text: T(L, 'Über einer Kachel zeigt die Aufschlüsselung mit den echten Zahlen, Klick springt zum Bereich.', 'Hovering a tile shows the breakdown with the real numbers; a click jumps to the area.') },
    { id: 'weeks', icon: 'gauge', section: T(L, 'Kapazität für dieses Projekt', 'Capacity for this project'), label: T(L, 'Wochen bis Quartalsende', 'Weeks to quarter end'), text: T(L, 'Die Wochenplanung für dieses Projekt bis Ende des laufenden Quartals: Stunden je Person aus diesem Projekt, die Auslastung zählt über alle Projekte. Die Stunden einer Aufgabe liegen immer zwischen Start und Due – gleichmäßig oder nach freier Kapazität (Admin-Vorgabe, umschaltbar unter „Verteilung“; Termine ändern sich nie). Aufgaben lassen sich per Drag & Drop verschieben; in Jira landet erst, was du übernimmst.', 'Weekly planning for this project until the end of the current quarter: hours per person from this project, utilization counts across all projects. A task\'s hours always stay between start and due – evenly or by free capacity (admin default, switchable under "Distribution"; dates never change). Drag tasks to move them; only what you apply lands in Jira.') },
  ];
}

// ---------- weeks until the end of the quarter: project hours and total load per person ----------
export function projectWeeks(model, ref, support) {
  const end = quarterRange(model.curQ)[1];
  const n = Math.max(1, Math.min(14, Math.ceil((end - model.today + 1) / 7)));
  const weeks = weeksFrom(model.today, n);
  const people = capacityPeople(model);
  const mine = new Map(), all = new Map();
  const add = (map, key, k, h) => { const a = map.get(key) || map.set(key, new Array(n).fill(0)).get(key); a[k] += h; };
  for (const s of model.ds.issues || []) {
    if (s.role !== 'estimate' || !isOpen(s) || !s.re) continue;
    const w = spreadWindow(s, 're', model.today);
    if (!w) continue;
    const key = s.assignee?.id || '_none';
    weeks.forEach(([a, b], k) => {
      const h = shareIn(s.re, a, b, w, 'linear');
      if (!h) return;
      add(all, key, k, h);
      if (s.rootRef === ref) add(mine, key, k, h);
    });
  }
  const rows = [...mine.entries()].map(([id, hours]) => {
    const person = people.get(id);
    const cap = person ? weeks.map(([a, b]) => personCapacityIn(model, person, a, b, support?.personWeekly?.[id] || 0)) : null;
    const total = all.get(id) || hours;
    const util = cap ? total.map((h, k) => (cap[k] > 0 ? h / cap[k] : h > 0 ? Infinity : 0)) : null;
    return { id, hours, totalHours: total, cap, util, sum: hours.reduce((x, y) => x + y, 0) };
  }).sort((a, b) => b.sum - a.sum);
  return { weeks, rows };
}

// ---------- project KPIs ----------
// ctx: { computed, ref, lang, fmt, people?, usageName?, ruleName? } – fmt = { pct, h, n, signedPct, date, quarter, week }
export function projectKpis({ computed, ref, lang = 'de', fmt, people = {}, usageName = (u) => u, ruleName = (r) => r }) {
  const L = lang;
  const { model, metrics, wl, deps, support } = computed;
  const m = metrics.get(ref);
  const p = model.itemByRef.get(ref);
  if (!m || !p) return [];
  const thr = (model.cfg.rules?.forecastThresholdPct ?? 10) / 100;
  const issues = model.byRoot.get(ref) || [];
  const stories = issues.filter((i) => i.role === 'estimate');
  const h = (v) => fmt.h(v);
  const defs = Object.fromEntries(definitions(L, model.cfg).map((d) => [d.id, d]));
  const item = (i, sub, tone) => ({ key: i.key, id: i.id, text: `${i.key} ${i.summary || ''}`.trim(), sub, tone });
  const out = [];
  // proof parts shared by progress and forecast: stories, sub-tasks with own time (older datasets) and open sizes
  const storyWord = levelName(model, 'estimate', 'Story'), tinyWord = levelName(model, 'tiny', 'Sub-task'), roughWord = levelName(model, 'rough', 'Epic');
  const subLogs = model.ds.storyTotals ? [] : issues.filter((i) => i.role === 'tiny' && i.ts > 0);
  const cKind = colOf('kind', T(L, 'Ebene', 'Level'), 'text'), cTS = colOf('ts', 'Time Spent', 'h'), cRE = colOf('re', T(L, 'Remaining Estimate (nur offene)', 'Remaining estimate (open only)'), 'h');
  const unitLabel = (u) => `${u.isItem ? (p.key ? `${p.key} ` : '') : (u.key ? `${u.key} ` : '')}${u.name || u.id}`;
  const unitRef = (u) => ({ key: u.isItem ? p.key || null : u.key || null, issueId: u.isItem ? null : u.id, ...(u.isItem ? { ref: p.ref } : {}) });

  // Fortschritt
  const denom = m.TS + m.RE + m.openTshirt;
  out.push({
    ...defs.progress, value: denom > 0 ? m.progress : null, display: denom > 0 ? fmt.pct(m.progress) : '–', area: 'structure',
    foot: denom > 0 ? T(L, `Time Spent ${h(m.TS)} von ca. ${h(denom)}`, `Time spent ${h(m.TS)} of approx. ${h(denom)}`) : T(L, 'noch nichts geschätzt', 'nothing estimated yet'),
    calc: `${h(m.TS)} ÷ (${h(m.TS)} + ${h(m.RE)} + ${h(m.openTshirt)}) = ${fmt.pct(m.progress)}`,
    inputs: [[T(L, 'Time Spent', 'Time spent'), h(m.TS)], [T(L, 'Remaining Estimate (offene Stories)', 'Remaining estimate (open stories)'), h(m.RE)], [T(L, 'Offene T-Shirt Size', 'Open T-shirt size'), h(m.openTshirt)]],
    items: stories.filter((s) => s.ts > 0).sort((a, b) => b.ts - a.ts).map((s) => item(s, T(L, `${h(s.ts)} gebucht · ${h(s.re)} Rest`, `${h(s.ts)} logged · ${h(s.re)} remaining`))),
    itemsTitle: T(L, 'Gebuchte Zeit je Story', 'Logged time per story'),
    proof: {
      columns: [cKind, cTS, cRE, colOf('ot', T(L, 'Offene T-Shirt Size', 'Open T-shirt size'), 'h')],
      rows: [
        ...stories.filter((s) => s.ts > 0 || (isOpen(s) && s.re > 0)).map((s) => issueRow(s, { kind: storyWord, ts: s.ts || 0, re: isOpen(s) ? s.re || 0 : 0, ot: 0 })),
        ...subLogs.map((s) => issueRow(s, { kind: tinyWord, ts: s.ts || 0, re: 0, ot: 0 })),
        ...(m.units || []).filter((u) => u.open > 0).map((u) => ({ ...unitRef(u), label: unitLabel(u), values: { kind: u.isItem ? T(L, 'Projekt', 'Project') : roughWord, ts: 0, re: 0, ot: u.open } })),
      ],
      totals: [totalOf('ts', 'ts', m.TS, 'Time Spent'), totalOf('re', 're', m.RE, 'Remaining Estimate'), totalOf('ot', 'ot', m.openTshirt, T(L, 'Offene T-Shirt Size', 'Open T-shirt size'))],
      ...(denom > 0 ? { final: { op: 'ratio', num: ['ts'], den: ['ts', 're', 'ot'], value: m.progress } } : {}),
      steps: [
        T(L, `Addiere die Spalte Time Spent: ${h(m.TS)}.`, `Add up the Time spent column: ${h(m.TS)}.`),
        T(L, `Addiere Remaining Estimate (nur offene Stories, ${h(m.RE)}) und offene T-Shirt Size (${h(m.openTshirt)}).`, `Add up remaining estimate (open stories only, ${h(m.RE)}) and open T-shirt size (${h(m.openTshirt)}).`),
        T(L, 'Teile Time Spent durch die Summe aller drei – das ist der Fortschritt.', 'Divide time spent by the sum of all three – that is the progress.'),
      ],
    },
  });

  // Prognose
  const dev = m.OE > 0 ? m.forecast / m.OE - 1 : null;
  out.push({
    ...defs.forecast, value: dev, display: dev == null ? '–' : fmt.signedPct(dev), area: 'structure', hot: dev != null && dev > thr,
    foot: m.OE > 0 ? T(L, `ca. ${h(m.forecast)} statt ${h(m.OE)} Original Estimate`, `approx. ${h(m.forecast)} instead of ${h(m.OE)} original estimate`) : T(L, 'noch keine Stories geschätzt', 'no stories estimated yet'),
    calc: (m.OE > 0 ? `(${h(m.TS)} + ${h(m.RE)}) ÷ ${h(m.OE)} − 1 = ${fmt.signedPct(dev)}` : T(L, 'Ohne Original Estimate gibt es keinen Vergleich.', 'Without an original estimate there is nothing to compare.'))
      + (m.tshirtTotal > 0 ? T(L, ` · Original Estimate gegen T-Shirt Size gesamt: ${h(m.OE)} von ${h(m.tshirtTotal)}, ${m.tshirtTotal >= m.OE ? `noch ${h(m.tshirtTotal - m.OE)} bis zur T-Shirt Size` : `${h(m.OE - m.tshirtTotal)} über der T-Shirt Size`}.`, ` · Original estimate against the total T-shirt size: ${h(m.OE)} of ${h(m.tshirtTotal)}, ${m.tshirtTotal >= m.OE ? `${h(m.tshirtTotal - m.OE)} left to the T-shirt size` : `${h(m.OE - m.tshirtTotal)} above the T-shirt size`}.`) : ''),
    inputs: [[T(L, 'Time Spent', 'Time spent'), h(m.TS)], [T(L, 'Remaining Estimate', 'Remaining estimate'), h(m.RE)], [T(L, 'Prognose', 'Forecast'), h(m.forecast)], [T(L, 'Original Estimate', 'Original estimate'), h(m.OE)]],
    items: stories.map((s) => ({ s, d: (s.ts || 0) + (isOpen(s) ? s.re || 0 : 0) - (s.oe || 0) })).filter((x) => x.d > 0.05).sort((a, b) => b.d - a.d)
      .map(({ s, d }) => item(s, T(L, `+${h(d)} über Original Estimate (${h(s.oe)})`, `+${h(d)} over original estimate (${h(s.oe)})`), 'bad')),
    itemsTitle: T(L, 'Stories über ihrer Schätzung', 'Stories above their estimate'),
    proof: {
      columns: [cKind, cTS, cRE, colOf('oe', 'Original Estimate', 'h')],
      rows: [
        ...stories.filter((s) => s.ts > 0 || s.oe > 0 || (isOpen(s) && s.re > 0)).map((s) => issueRow(s, { kind: storyWord, ts: s.ts || 0, re: isOpen(s) ? s.re || 0 : 0, oe: s.oe || 0 })),
        ...subLogs.map((s) => issueRow(s, { kind: tinyWord, ts: s.ts || 0, re: 0, oe: 0 })),
      ],
      totals: [totalOf('ts', 'ts', m.TS, 'Time Spent'), totalOf('re', 're', m.RE, 'Remaining Estimate'), totalOf('oe', 'oe', m.OE, 'Original Estimate')],
      ...(m.OE > 0 ? { final: { op: 'ratio', num: ['ts', 're'], den: ['oe'], offset: -1, value: dev } } : {}),
      steps: [
        T(L, `Addiere Time Spent (${h(m.TS)}) und Remaining Estimate der offenen Stories (${h(m.RE)}) – das ist die Prognose ${h(m.forecast)}.`, `Add time spent (${h(m.TS)}) and the remaining estimate of open stories (${h(m.RE)}) – that is the forecast ${h(m.forecast)}.`),
        T(L, `Addiere die Spalte Original Estimate: ${h(m.OE)}.`, `Add up the Original estimate column: ${h(m.OE)}.`),
        T(L, 'Prognose ÷ Original Estimate − 1 = Abweichung vom Plan.', 'Forecast ÷ original estimate − 1 = deviation from the plan.'),
      ],
    },
  });

  // Reife – only where a rough estimate (T-shirt size) exists; never a made-up 100 %.
  const mb = m.maturityBasis || { units: 0, withTshirt: 0, missing: [], oeCovered: m.OE, oeUncovered: 0 };
  const unitRows = (m.units || []).map((u) => {
    const text = `${u.key ? `${u.key} ` : ''}${u.name || u.id}`;
    const target = u.isItem ? { ref: p.ref } : { issueId: u.id };
    if (!(u.hours > 0)) {
      return { key: u.key, id: u.isItem ? null : u.id, text, tone: 'bad', fix: { usage: 'tshirt', ...target },
        sub: T(L, `keine T-Shirt Size – ${h(u.oe)} Original Estimate darunter, aber unklar, wie viel noch fehlt`, `no T-shirt size – ${h(u.oe)} original estimate below, but unclear how much is still missing`) };
    }
    return { key: u.key, id: u.isItem ? null : u.id, text, tone: u.open > 0 ? 'warn' : 'ok',
      sub: T(L, `T-Shirt ${u.tshirt} = ${h(u.hours)} · ${(u.quarters || []).map(fmt.quarter).join(', ') || 'ohne Quartal'} · geschätzt ${h(u.oe)} · offen ${h(u.open)}`, `T-shirt ${u.tshirt} = ${h(u.hours)} · ${(u.quarters || []).map(fmt.quarter).join(', ') || 'no quarter'} · estimated ${h(u.oe)} · open ${h(u.open)}`) };
  });
  const missingN = mb.missing.length, unitWord = (n) => (!(m.units || [])[0]?.isItem ? T(L, n === 1 ? 'Epic' : 'Epics', n === 1 ? 'epic' : 'epics') : T(L, n === 1 ? 'Projekt' : 'Projekte', n === 1 ? 'project' : 'projects'));
  out.push({
    ...defs.maturity, value: m.maturity, display: m.maturity == null ? '–' : fmt.pct(m.maturity), area: 'structure',
    hot: missingN > 0, state: m.maturity == null ? (mb.withTshirt > 0 ? 'lapsed' : 'missing') : missingN ? 'partial' : 'ok',
    // sized, but only in past quarters and nothing estimated below: nothing open, nothing planned – not "missing"
    foot: m.maturity == null && mb.withTshirt > 0
      ? T(L, 'T-Shirt Size nur in abgelaufenen Quartalen, nichts als Story geschätzt', 'T-shirt size only in past quarters, nothing estimated as stories')
      : m.maturity == null
      ? T(L, 'T-Shirt Size fehlt – Reife nicht bestimmbar', 'T-shirt size missing – maturity unknown')
      : `${m.openTshirt > 0.5 ? T(L, `${h(m.openTshirt)} T-Shirt Size noch nicht als Story geschätzt`, `${h(m.openTshirt)} of T-shirt size not yet estimated as stories`) : T(L, `T-Shirt Size ab ${fmt.quarter(model.curQ)} vollständig geschätzt`, `T-shirt size fully estimated from ${fmt.quarter(model.curQ)}`)}${missingN ? T(L, ` · ${missingN} ${unitWord(missingN)} ohne T-Shirt Size`, ` · ${missingN} ${unitWord(missingN)} without T-shirt size`) : ''}`,
    calc: m.maturity == null && mb.withTshirt > 0
      ? T(L, `Reife = Original Estimate ÷ (Original Estimate + offene T-Shirt Size) = 0 h ÷ (0 h + 0 h): ${h(m.expired)} T-Shirt Size lagen in abgelaufenen Quartalen und sind verfallen, darunter ist nichts geschätzt. Neue Quartale oder Stories setzen, dann gibt es wieder eine Reife.`, `Maturity = original estimate ÷ (original estimate + open T-shirt size) = 0 h ÷ (0 h + 0 h): ${h(m.expired)} of T-shirt size lay in past quarters and lapsed, nothing is estimated below. Set new quarters or stories to get a maturity again.`)
      : m.maturity == null
      ? T(L, 'Reife = Original Estimate ÷ (Original Estimate + offene T-Shirt Size). Ohne T-Shirt Size ist unbekannt, wie viel noch fehlt – deshalb keine Prozentzahl.', 'Maturity = original estimate ÷ (original estimate + open T-shirt size). Without a T-shirt size it is unknown how much is still missing – so no percentage.')
      : `${h(mb.oeCovered)} ÷ (${h(mb.oeCovered)} + ${h(m.openTshirt)}) = ${fmt.pct(m.maturity)}`,
    inputs: [
      [T(L, 'Original Estimate mit T-Shirt Size darüber', 'Original estimate below a T-shirt size'), h(mb.oeCovered)],
      [T(L, 'Offene T-Shirt Size', 'Open T-shirt size'), h(m.openTshirt)],
      ...(mb.oeUncovered > 0 ? [[T(L, 'Nicht eingerechnet (ohne T-Shirt Size)', 'Not counted (no T-shirt size)'), h(mb.oeUncovered)]] : []),
      ...(m.expired > 0 ? [[T(L, 'Verfallen (abgelaufene Quartale)', 'Lapsed (past quarters)'), h(m.expired)]] : []),
      [T(L, `${unitWord(2)} mit T-Shirt Size`, `${unitWord(2)} with T-shirt size`), `${mb.withTshirt} / ${mb.units}`],
    ],
    items: unitRows.sort((a, b) => (a.fix ? 0 : 1) - (b.fix ? 0 : 1)),
    itemsTitle: T(L, 'T-Shirt Sizes und was davon noch offen ist', 'T-shirt sizes and what is still open'),
    proof: {
      ...maturityUnits(L, model, p, m, fmt),
      totals: [
        totalOf('oe', 'oe', mb.oeCovered, T(L, 'Original Estimate mit T-Shirt Size darüber', 'Original estimate below a T-shirt size')),
        totalOf('open', 'open', m.openTshirt, T(L, 'Offene T-Shirt Size', 'Open T-shirt size')),
        ...(mb.oeUncovered > 0.005 ? [totalOf('oeOut', 'oeOut', mb.oeUncovered, T(L, 'Nicht eingerechnet (ohne T-Shirt Size)', 'Not counted (no T-shirt size)'))] : []),
        ...(m.expired > 0 ? [totalOf('expired', 'expired', m.expired, T(L, 'Verfallen (abgelaufene Quartale)', 'Lapsed (past quarters)'))] : []),
      ],
      ...(m.maturity != null ? { final: { op: 'ratio', num: ['oe'], den: ['oe', 'open'], value: m.maturity } } : {}),
      steps: [
        T(L, `Klappe jede Zeile auf: Die Original Estimates der Stories ergeben die Summe der Zeile. Nur Zeilen mit T-Shirt Size zählen – zusammen ${h(mb.oeCovered)}.`, `Expand each row: the stories' original estimates add up to the row. Only rows with a T-shirt size count – together ${h(mb.oeCovered)}.`),
        T(L, `Offene T-Shirt Size je Quartal = T-Shirt Size ÷ Anzahl Quarter/s − Original Estimate der Stories in diesem Quartal (mindestens 0, nur laufende und kommende Quartale). Zusammen ${h(m.openTshirt)}.`, `Open T-shirt size per quarter = T-shirt size ÷ number of quarters − original estimate of the stories in that quarter (at least 0, current and coming quarters only). Together ${h(m.openTshirt)}.`),
        T(L, 'Reife = Original Estimate ÷ (Original Estimate + offene T-Shirt Size).', 'Maturity = original estimate ÷ (original estimate + open T-shirt size).'),
      ],
    },
  });

  // Datenqualität: epics (the rough level – or the project itself when it carries the T-shirt size) and stories
  const dq = dataQuality(model, new Set([ref]));
  const roleOf = new Map((model.cfg.levels || []).map((l) => [l.key, l.role]));
  const itemIsRough = !!(m.units || [])[0]?.isItem;
  const levelRole = (l) => (l.levelKey === 'portfolio' ? 'portfolio' : roleOf.get(l.levelKey) || l.levelKey);
  const sumL = (pred, k) => dq.levels.filter(pred).reduce((a, l) => a + l[k], 0);
  const isStoryL = (l) => levelRole(l) === 'estimate', isEpicL = (l) => levelRole(l) === 'rough' || (itemIsRough && levelRole(l) === 'portfolio');
  const stTotal = sumL(isStoryL, 'total'), stOk = sumL(isStoryL, 'complete'), epTotal = sumL(isEpicL, 'total'), epOk = sumL(isEpicL, 'complete');
  const total = stTotal + epTotal, complete = stOk + epOk;
  const byStory = new Map();
  const counted = (g) => g.role === 'estimate' || g.role === 'rough' || (itemIsRough && g.role === 'portfolio');
  for (const g of dq.gaps) if (counted(g) && g.severity === 'gap' && COMPLETENESS(g.rule)) (byStory.get(g.issueId) || byStory.set(g.issueId, []).get(g.issueId)).push(g);
  const share = total ? complete / total : null;
  const epWord = itemIsRough ? T(L, 'Projekt', 'Project') : T(L, 'Epics', 'Epics');
  out.push({
    ...defs.dataQuality, value: share, display: share == null ? '–' : fmt.pct(share), area: 'structure', hot: share != null && share < 0.7,
    foot: total ? T(L, `${complete} von ${total} Vorgängen mit allen Pflichtfeldern`, `${complete} of ${total} work items with all required fields`) : T(L, 'noch keine Vorgänge', 'no work items yet'),
    calc: total ? T(L, `(${epOk} + ${stOk}) ÷ (${epTotal} + ${stTotal}) = ${fmt.pct(share)} · ${epWord}: ${epOk} von ${epTotal} vollständig, Stories: ${stOk} von ${stTotal}. Wie weit die T-Shirt Size schon als Story geschätzt ist, zeigt die Reife.`, `(${epOk} + ${stOk}) ÷ (${epTotal} + ${stTotal}) = ${fmt.pct(share)} · ${epWord}: ${epOk} of ${epTotal} complete, stories: ${stOk} of ${stTotal}. How much of the T-shirt size is already estimated as stories is shown by maturity.`) : T(L, 'Keine Vorgänge in diesem Projekt.', 'No work items in this project.'),
    inputs: [[epWord, `${epOk} / ${epTotal}`], [T(L, 'Stories', 'Stories'), `${stOk} / ${stTotal}`], [T(L, 'Stories mit Original Estimate', 'Stories with original estimate'), `${stories.filter((s) => s.oe > 0).length} / ${stories.length}`]],
    items: [...byStory.entries()].map(([id, gs]) => {
      const s = model.byId.get(id);
      const miss = gs.filter((g) => g.rule.startsWith('missing:')).map((g) => usageName(g.rule.slice(8)));
      const other = gs.filter((g) => !g.rule.startsWith('missing:')).map((g) => ruleName(g.rule));
      return item(s || { key: gs[0].key, summary: gs[0].summary, id }, [miss.length ? T(L, 'fehlt: ', 'missing: ') + miss.join(', ') : null, ...other].filter(Boolean).join(' · '), 'warn');
    }),
    itemsTitle: T(L, 'Unvollständige Vorgänge und was fehlt', 'Incomplete work items and what is missing'),
    proof: (() => {
      const gapsOf = new Map();
      for (const g of dq.gaps) if (g.severity === 'gap' && COMPLETENESS(g.rule)) (gapsOf.get(g.issueId) || gapsOf.set(g.issueId, []).get(g.issueId)).push(g);
      const missText = (id) => {
        const gs = gapsOf.get(id) || [];
        const miss = gs.filter((g) => g.rule.startsWith('missing:')).map((g) => usageName(g.rule.slice(8)));
        const other = gs.filter((g) => !g.rule.startsWith('missing:')).map((g) => ruleName(g.rule));
        return [miss.length ? T(L, 'fehlt: ', 'missing: ') + miss.join(', ') : null, ...other].filter(Boolean).join(' · ');
      };
      const lvRole = (i) => { const lk = i.levelKey || i.role; return roleOf.get(lk) || lk; };
      const rows = [];
      if (itemIsRough) {
        const id = `item:${ref}`;
        rows.push({ key: p.key || null, ref: p.ref, label: `${p.key ? `${p.key} ` : ''}${p.name || ''}`.trim(), group: 'epic', values: { kind: epWord, ok: gapsOf.has(id) ? 0 : 1, missing: missText(id) } });
      }
      for (const i of issues) {
        const r = lvRole(i);
        const group = r === 'estimate' ? 'story' : r === 'rough' ? 'epic' : null;
        if (!group) continue;
        rows.push(issueRow(i, { kind: group === 'story' ? storyWord : roughWord, ok: gapsOf.has(i.id) ? 0 : 1, missing: missText(i.id) }, { group }));
      }
      rows.sort((a, b) => a.values.ok - b.values.ok);
      return {
        columns: [cKind, colOf('ok', T(L, 'Vollständig (1 = ja)', 'Complete (1 = yes)'), 'n'), colOf('missing', T(L, 'Was fehlt', 'What is missing'), 'text')],
        rows,
        totals: [
          totalOf('epOk', 'ok', epOk, T(L, `${epWord} vollständig`, `${epWord} complete`), { where: { group: 'epic' } }),
          totalOf('stOk', 'ok', stOk, T(L, 'Stories vollständig', 'Stories complete'), { where: { group: 'story' } }),
          { id: 'ep', agg: 'rows', where: { group: 'epic' }, value: epTotal, label: T(L, `${epWord} gesamt`, `${epWord} in total`) },
          { id: 'st', agg: 'rows', where: { group: 'story' }, value: stTotal, label: T(L, 'Stories gesamt', 'Stories in total') },
        ],
        ...(total ? { final: { op: 'ratio', num: ['epOk', 'stOk'], den: ['ep', 'st'], value: share } } : {}),
        steps: [
          T(L, `Zähle die Zeilen: ${epTotal} ${epWord} und ${stTotal} Stories.`, `Count the rows: ${epTotal} ${epWord} and ${stTotal} stories.`),
          T(L, `Zähle die vollständigen (Spalte „Vollständig“ = 1): ${epOk} + ${stOk}. „Was fehlt“ nennt das fehlende Pflichtfeld.`, `Count the complete ones (column "Complete" = 1): ${epOk} + ${stOk}. "What is missing" names the missing required field.`),
          T(L, 'Vollständige ÷ alle = Datenqualität.', 'Complete ÷ all = data quality.'),
        ],
      };
    })(),
  });

  // Abhängigkeiten
  const pdeps = deps.list.filter((d) => [d.pre, d.dep].some((id) => (model.byId.get(id) || model.external.get(id))?.rootRef === ref));
  const open = pdeps.filter((d) => d.open), conflicts = open.filter((d) => d.conflict);
  const iss = (id) => model.byId.get(id) || model.external.get(id) || { key: id, summary: '' };
  out.push({
    ...defs.dependencies, value: pdeps.length, display: String(pdeps.length), area: 'deps', hot: conflicts.length > 0,
    foot: T(L, `${conflicts.length} mit Terminkonflikt`, `${conflicts.length} with a schedule conflict`),
    calc: T(L, `${pdeps.length} Verknüpfungen (${open.length} offen), davon ${conflicts.length} mit Terminkonflikt`, `${pdeps.length} links (${open.length} open), ${conflicts.length} with a schedule conflict`),
    inputs: [[T(L, 'Verknüpfungen', 'Links'), String(pdeps.length)], [T(L, 'Offen', 'Open'), String(open.length)], [T(L, 'Mit Terminkonflikt', 'With schedule conflict'), String(conflicts.length)], [T(L, 'Ohne Hinweis', 'Without a note'), String(open.filter((d) => d.missingNote).length)]],
    items: open.sort((a, b) => b.conflict - a.conflict || b.conflictDays - a.conflictDays).map((d) => ({ key: iss(d.dep).key, id: d.dep, text: `${iss(d.pre).key} → ${iss(d.dep).key}`, sub: d.conflict ? T(L, `Konflikt: ${d.conflictDays} Tage · ${iss(d.dep).summary}`, `conflict: ${d.conflictDays} days · ${iss(d.dep).summary}`) : `${d.relation} · ${iss(d.dep).summary}`, tone: d.conflict ? 'bad' : 'ok' })),
    itemsTitle: T(L, 'Verknüpfungen', 'Links'),
    proof: {
      columns: [colOf('relation', T(L, 'Beziehung', 'Relation'), 'text'), colOf('open', T(L, 'Offen (1 = ja)', 'Open (1 = yes)'), 'n'), colOf('conflict', T(L, 'Terminkonflikt (1 = ja)', 'Schedule conflict (1 = yes)'), 'n'),
        colOf('days', T(L, 'Konflikt in Tagen', 'Conflict in days'), 'n'), colOf('preDue', T(L, 'Blocker fertig (Due)', 'Blocker done (due)'), 'date'), colOf('depStart', T(L, 'Wartender startet', 'Waiting item starts'), 'date')],
      rows: pdeps.map((d) => ({ key: iss(d.dep).key || null, issueId: d.dep, keys: [iss(d.pre).key, iss(d.dep).key].filter(Boolean), label: `${iss(d.pre).key} → ${iss(d.dep).key}`,
        values: { relation: d.relation, open: d.open ? 1 : 0, conflict: d.conflict ? 1 : 0, days: d.conflictDays || 0, preDue: iss(d.pre).due || null, depStart: iss(d.dep).start || null } })),
      totals: [
        { id: 'n', agg: 'rows', value: pdeps.length, label: T(L, 'Verknüpfungen', 'Links') },
        totalOf('open', 'open', open.length, T(L, 'Offen', 'Open')),
        totalOf('conflict', 'conflict', conflicts.length, T(L, 'Mit Terminkonflikt', 'With schedule conflict')),
      ],
      final: { op: 'total', id: 'n', value: pdeps.length },
      steps: [
        T(L, `Jede Zeile ist eine Verknüpfung mit einem konfigurierten Link-Typ, an der dieses Projekt beteiligt ist: ${pdeps.length}.`, `Each row is a link of a configured link type that involves this project: ${pdeps.length}.`),
        T(L, 'Konflikt = beide offen und der Blocker wird erst nach dem Start des Wartenden fertig (Due des Blockers > Start des Wartenden).', 'Conflict = both open and the blocker finishes only after the waiting item starts (blocker due > waiting item start).'),
      ],
    },
  });

  // Über Due Date
  const late = m.overdueIssues.map((id) => model.byId.get(id)).filter(Boolean);
  out.push({
    ...defs.overdue, value: late.length, display: String(late.length), area: 'actions', hot: late.length > 0,
    foot: T(L, 'offene Stories mit Due Date in der Vergangenheit', 'open stories with a due date in the past'),
    calc: T(L, `${late.length} von ${m.openStoryCount} offenen Stories`, `${late.length} of ${m.openStoryCount} open stories`),
    inputs: [[T(L, 'Offene Stories', 'Open stories'), String(m.openStoryCount)], [T(L, 'davon über Due Date', 'past due date'), String(late.length)], ...(m.daysOverdue ? [[T(L, 'Projekt selbst', 'Project itself'), T(L, `${m.daysOverdue} Tage über ${fmt.date(m.due)}`, `${m.daysOverdue} days past ${fmt.date(m.due)}`)]] : [])],
    items: late.sort((a, b) => dayIdx(a.due) - dayIdx(b.due)).map((s) => item(s, T(L, `fällig ${fmt.date(s.due)} · ${model.today - dayIdx(s.due)} Tage drüber`, `due ${fmt.date(s.due)} · ${model.today - dayIdx(s.due)} days over`), 'bad')),
    itemsTitle: T(L, 'Überfällige Stories', 'Overdue stories'),
    proof: (() => {
      const lateIds = new Set(m.overdueIssues);
      const rows = stories.filter(isOpen).map((s) => issueRow(s, { due: s.due || null, overdue: lateIds.has(s.id) ? 1 : 0, days: lateIds.has(s.id) ? model.today - dayIdx(s.due) : 0 }))
        .sort((a, b) => b.values.overdue - a.values.overdue || b.values.days - a.values.days);
      return {
        columns: [colOf('due', 'Due Date', 'date'), colOf('overdue', T(L, 'Überfällig (1 = ja)', 'Past due (1 = yes)'), 'n'), colOf('days', T(L, 'Tage drüber', 'Days over'), 'n')],
        rows,
        totals: [{ id: 'open', agg: 'rows', value: m.openStoryCount, label: T(L, 'Offene Stories', 'Open stories') }, totalOf('late', 'overdue', late.length, T(L, 'davon über Due Date', 'past due date'))],
        final: { op: 'total', id: 'late', value: late.length },
        steps: [
          T(L, `Die Liste enthält alle ${m.openStoryCount} offenen Stories mit ihrem Due Date.`, `The list holds all ${m.openStoryCount} open stories with their due date.`),
          T(L, `Überfällig ist eine Story, deren Due Date vor heute (${fmt.date(isoOf(model.today))}) liegt – das sind ${late.length}.`, `A story is past due when its due date lies before today (${fmt.date(isoOf(model.today))}) – that is ${late.length}.`),
        ],
      };
    })(),
  });

  // Kapazität: bottlenecks in weeks (people) and quarters (teams)
  const pw = projectWeeks(model, ref, support);
  // people with a problem in at least one week: over 100 % (all projects), absent with planned hours, or no assignee
  const personHits = [];
  for (const r of pw.rows) {
    const weeks = [];
    r.hours.forEach((hh, k) => {
      if (!(hh > 0.05)) return;
      if (r.id === '_none') weeks.push({ k, why: 'none' });
      else if (r.cap && r.cap[k] <= 0.01) weeks.push({ k, why: 'absent' });
      else if (r.util && r.util[k] > 1.0001) weeks.push({ k, why: 'over', u: r.util[k] });
    });
    if (weeks.length) personHits.push({ r, weeks });
  }
  const pq = wl.projectQ[ref] || {};
  const qHits = [];
  for (const q of wl.quarters) for (const t of pq[q]?.teams || []) if (t.status !== 'ok') qHits.push({ q, t });
  const name = (id) => people[id]?.name || (id === '_none' ? T(L, 'Nicht zugewiesen', 'Unassigned') : T(L, 'Person', 'Person'));
  const nHits = personHits.length + qHits.length;
  const whyText = (w) => (w.why === 'none' ? T(L, 'ohne Assignee', 'no assignee') : w.why === 'absent' ? T(L, 'abwesend', 'absent') : fmt.pct(w.u));
  out.push({
    ...defs.capacity, value: nHits, display: nHits ? String(nHits) : 'OK', area: 'capacity', hot: nHits > 0,
    foot: nHits ? T(L, 'Engpässe in Wochen oder Quartalen', 'bottlenecks in weeks or quarters') : T(L, 'alle besetzbar', 'all staffable'),
    calc: T(L, `${qHits.length} Team-Quartale nicht voll besetzbar + ${personHits.length} Personen mit Wochen-Problemen`, `${qHits.length} team quarters not fully staffable + ${personHits.length} people with week problems`),
    inputs: [[T(L, 'Wochen bis Quartalsende', 'Weeks to quarter end'), String(pw.weeks.length)], [T(L, 'Personen in diesem Projekt', 'People on this project'), String(pw.rows.filter((r) => r.id !== '_none').length)], [T(L, 'Quartale im Blick', 'Quarters in view'), wl.quarters.map(fmt.quarter).join(', ')]],
    items: [
      ...personHits.map(({ r, weeks }) => ({ text: name(r.id), sub: weeks.slice(0, 4).map((w) => `${fmt.week(isoOf(pw.weeks[w.k][0]))} ${whyText(w)}`).join(' · ') + (weeks.length > 4 ? ' …' : ''), tone: 'bad' })),
      ...qHits.map(({ q, t }) => ({ text: `${model.teams.get(t.teamId)?.name || t.teamId} · ${fmt.quarter(q)}`, sub: T(L, `${t.status === 'no' ? 'nicht besetzbar' : 'teilweise besetzbar'} · Bedarf ${h(t.demand)}, besetzt ${h(t.staffed)}`, `${t.status === 'no' ? 'not staffable' : 'partly staffable'} · demand ${h(t.demand)}, staffed ${h(t.staffed)}`), tone: t.status === 'no' ? 'bad' : 'warn' })),
    ],
    itemsTitle: T(L, 'Engpässe', 'Bottlenecks'),
    proof: {
      columns: [colOf('kind', T(L, 'Art', 'Kind'), 'text'), colOf('detail', T(L, 'Warum', 'Why'), 'text'), colOf('n', T(L, 'Zählt', 'Counts'), 'n')],
      rows: [
        ...personHits.map(({ r, weeks }) => ({ label: name(r.id), group: 'person', values: { kind: T(L, 'Person', 'Person'), detail: weeks.map((w) => `${fmt.week(isoOf(pw.weeks[w.k][0]))} ${whyText(w)}`).join(' · '), n: 1 } })),
        ...qHits.map(({ q, t }) => ({ label: `${model.teams.get(t.teamId)?.name || t.teamId} · ${fmt.quarter(q)}`, group: 'quarter', values: { kind: T(L, 'Team-Quartal', 'Team quarter'), detail: T(L, `Bedarf ${h(t.demand)}, besetzt ${h(t.staffed)}`, `demand ${h(t.demand)}, staffed ${h(t.staffed)}`), n: 1 } })),
      ],
      totals: [totalOf('quarters', 'n', qHits.length, T(L, 'Team-Quartale nicht voll besetzbar', 'Team quarters not fully staffable'), { where: { group: 'quarter' } }), totalOf('people', 'n', personHits.length, T(L, 'Personen mit Wochen-Problemen', 'People with week problems'), { where: { group: 'person' } }), totalOf('all', 'n', nHits, T(L, 'Engpässe', 'Bottlenecks'))],
      final: { op: 'total', id: 'all', value: nHits },
      steps: [
        T(L, 'Team-Quartal zählt, wenn die Wasserlinie das Team für dieses Projekt im Quartal nicht voll besetzen kann.', 'A team quarter counts when the waterline cannot fully staff the team for this project in the quarter.'),
        T(L, 'Person zählt, wenn sie in einer Woche bis Quartalsende über 100 % liegt (alle Projekte), abwesend ist oder die Stunden keinen Assignee haben.', 'A person counts when in a week until the quarter end they are above 100% (all projects), absent, or the hours have no assignee.'),
        T(L, 'Beides zusammen ergibt die Zahl auf der Kachel; Details in der Wochenplanung.', 'Both together give the number on the tile; details in weekly planning.'),
      ],
    },
  });
  return out;
}

// ---------- portfolio KPIs (the same definitions, summed over the active projects) ----------
export function portfolioDefinitions(lang, cfg = {}) {
  const L = lang;
  const rhythm = cfg.rules?.healthRhythmDays || 7;
  const base = Object.fromEntries(definitions(L, cfg).map((d) => [d.id, d]));
  return [
    { id: 'active', icon: 'project', label: T(L, 'Aktive Projekte', 'Active projects'), text: T(L, 'Projekte im Portfolio, die noch nicht abgeschlossen sind (Status-Kategorie nicht „Erledigt“).', 'Projects in the portfolio that are not finished yet (status category not "Done").') },
    { ...base.progress, label: T(L, 'Gesamtfortschritt', 'Overall progress'), text: T(L, 'Summe Time Spent ÷ (Summe Time Spent + Remaining Estimate + offene T-Shirt Size) über alle aktiven Projekte – große Projekte zählen mehr als kleine.', 'Total time spent ÷ (total time spent + remaining estimate + open T-shirt size) over all active projects – big projects weigh more than small ones.') },
    { ...base.maturity, label: T(L, 'Planungsreife', 'Planning maturity'), text: T(L, 'Summe Original Estimate ÷ (Summe Original Estimate + offene T-Shirt Size) über alle aktiven Projekte – wie belastbar die Zahlen sind.', 'Total original estimate ÷ (total original estimate + open T-shirt size) over all active projects – how reliable the numbers are.') },
    base.openTshirt,
    { id: 'waterline', icon: 'waves', label: T(L, 'Wasserlinie', 'Waterline'), text: T(L, 'Kapazität je Team wird in Rangfolge verteilt (Support zuerst; Personen in mehreren Teams zählen mit ihrem Anteil in %). Ein Projekt ist voll besetzbar, wenn alle seine Teams den Bedarf im Quartal decken.', 'Each team\'s capacity is handed out in rank order (support first; people in several teams count with their share in %). A project is fully staffable when all its teams can cover its demand in the quarter.') },
    { id: 'health', icon: 'heart', label: T(L, 'Health-Updates', 'Health updates'), text: T(L, `Projekte, deren Health-Update älter als ${rhythm} Tage ist – nur ein Hinweis auf das Alter: es gibt keinen Pflicht-Rhythmus, keine Erinnerung und es wird nichts verschickt. Der Health-Punkt zeigt, wer den Stand wann gesetzt hat, und die Fakten dazu.`, `Projects whose health update is older than ${rhythm} days – a hint about age only: there is no required rhythm, no reminder and nothing is sent. The health dot shows who set the status and when, plus the facts behind it.`) },
    base.hover,
  ];
}

// ctx: { computed, lang, fmt, ranked, wl (live waterline), quarter, now? }
export function portfolioKpis({ computed, lang = 'de', fmt, ranked, wl, quarter, now = Date.now() }) {
  const L = lang;
  const { model, metrics } = computed;
  const h = (v) => fmt.h(v);
  const defs = Object.fromEntries(portfolioDefinitions(L, model.cfg).map((d) => [d.id, d]));
  const active = ranked.filter((p) => !metrics.get(p.ref)?.done);
  const ms = active.map((p) => ({ p, m: metrics.get(p.ref) })).filter((x) => x.m);
  const S = (f) => ms.reduce((a, x) => a + (f(x.m) || 0), 0);
  const TS = S((m) => m.TS), RE = S((m) => m.RE), OT = S((m) => m.openTshirt), OE = S((m) => m.OE);
  const progress = TS + RE + OT > 0 ? TS / (TS + RE + OT) : 0;
  // Reife over what has a rough estimate; projects without any T-shirt size are named, not counted as 100 %.
  const OEc = S((m) => m.maturityBasis?.oeCovered ?? m.OE);
  const anyCovered = ms.some(({ m }) => (m.maturityBasis ? m.maturityBasis.withTshirt > 0 : m.OE + m.openTshirt > 0));
  const maturity = anyCovered ? maturityOf(OEc, OT) : null;
  const noTshirt = ms.filter(({ m }) => m.maturity == null);
  const partly = ms.filter(({ m }) => m.maturity != null && (m.maturityBasis?.missing.length || 0) > 0);
  const label = (p) => `#${p.rank} ${p.name}`;
  const st = (p) => wl.projectQ[p.ref]?.[quarter]?.status || 'ok';
  const staffable = active.filter((p) => st(p) === 'ok');
  const rhythm = (model.cfg.rules?.healthRhythmDays || 7) * 864e5;
  const due = ranked.filter((p) => !p.health || now - Date.parse(p.health.at) > rhythm);
  const wlName = { ok: T(L, 'voll besetzbar', 'fully staffable'), partial: T(L, 'teilweise besetzbar', 'partly staffable'), no: T(L, 'nicht besetzbar', 'not staffable') };
  return [
    { ...defs.active, value: active.length, display: String(active.length), area: 'ranking',
      foot: T(L, `${ranked.length - active.length} abgeschlossen`, `${ranked.length - active.length} completed`),
      calc: T(L, `${ranked.length} im Portfolio − ${ranked.length - active.length} abgeschlossen = ${active.length}`, `${ranked.length} in the portfolio − ${ranked.length - active.length} completed = ${active.length}`),
      inputs: [[T(L, 'Im Portfolio', 'In the portfolio'), String(ranked.length)], [T(L, 'Abgeschlossen', 'Completed'), String(ranked.length - active.length)]],
      items: active.map((p) => ({ text: label(p), sub: p.key || '', tone: 'ok' })), itemsTitle: T(L, 'Aktive Projekte', 'Active projects'),
      proof: proofActive(L, ranked, metrics, label) },
    { ...defs.progress, value: progress, display: fmt.pct(progress), area: 'ranking',
      foot: T(L, `Time Spent ${h(TS)} von ca. ${h(TS + RE + OT)}`, `Time spent ${h(TS)} of approx. ${h(TS + RE + OT)}`),
      calc: `${h(TS)} ÷ (${h(TS)} + ${h(RE)} + ${h(OT)}) = ${fmt.pct(progress)}`,
      inputs: [[T(L, 'Time Spent', 'Time spent'), h(TS)], [T(L, 'Remaining Estimate', 'Remaining estimate'), h(RE)], [T(L, 'Offene T-Shirt Size', 'Open T-shirt size'), h(OT)]],
      items: ms.map(({ p, m }) => ({ text: label(p), sub: `${fmt.pct(m.progress)} · ${h(m.TS)} / ${h(m.TS + m.RE + m.openTshirt)}`, tone: 'ok' })), itemsTitle: T(L, 'Je Projekt', 'Per project'),
      proof: proofPortfolioProgress(L, ms, label, { TS, RE, OT, progress }, h) },
    { ...defs.maturity, value: maturity, display: maturity == null ? '–' : fmt.pct(maturity), area: 'ranking', hot: noTshirt.length + partly.length > 0,
      foot: maturity == null ? T(L, 'keine T-Shirt Sizes – Reife nicht bestimmbar', 'no T-shirt sizes – maturity unknown')
        : `${T(L, `offene T-Shirt Size ${h(OT)}`, `open T-shirt size ${h(OT)}`)}${noTshirt.length ? T(L, ` · ${noTshirt.length} ${noTshirt.length === 1 ? 'Projekt' : 'Projekte'} ohne T-Shirt Size`, ` · ${noTshirt.length} ${noTshirt.length === 1 ? 'project' : 'projects'} without T-shirt size`) : ''}`,
      calc: maturity == null ? T(L, 'Ohne T-Shirt Size ist unbekannt, wie viel noch fehlt – deshalb keine Prozentzahl.', 'Without T-shirt sizes it is unknown how much is still missing – so no percentage.') : `${h(OEc)} ÷ (${h(OEc)} + ${h(OT)}) = ${fmt.pct(maturity)}`,
      inputs: [[T(L, 'Original Estimate mit T-Shirt Size darüber', 'Original estimate below a T-shirt size'), h(OEc)], [T(L, 'Offene T-Shirt Size', 'Open T-shirt size'), h(OT)], ...(OE - OEc > 0 ? [[T(L, 'Nicht eingerechnet (ohne T-Shirt Size)', 'Not counted (no T-shirt size)'), h(OE - OEc)]] : []), [T(L, 'Projekte ohne T-Shirt Size', 'Projects without T-shirt size'), String(noTshirt.length)]],
      items: ms.map(({ p, m }) => ({ text: label(p), sub: m.maturity == null ? T(L, `keine T-Shirt Size · ${h(m.OE)} Original Estimate nicht eingerechnet`, `no T-shirt size · ${h(m.OE)} original estimate not counted`) : T(L, `Reife ${fmt.pct(m.maturity)} · offene T-Shirt Size ${h(m.openTshirt)}`, `maturity ${fmt.pct(m.maturity)} · open T-shirt ${h(m.openTshirt)}`), tone: m.maturity == null ? 'bad' : m.openTshirt > 0 ? 'warn' : 'ok' })).sort((a, b) => (a.tone === 'bad' ? 0 : 1) - (b.tone === 'bad' ? 0 : 1)),
      itemsTitle: T(L, 'Je Projekt', 'Per project'),
      proof: proofPortfolioMaturity(L, model, ms, label, { OEc, OT, OE, maturity }, h, fmt) },
    { ...defs.waterline, label: `${defs.waterline.label} ${fmt.quarter(quarter)}`, value: staffable.length, display: `${staffable.length} / ${active.length}`, area: 'ranking', hot: staffable.length < active.length,
      foot: T(L, 'Projekte voll besetzbar', 'projects fully staffable'),
      calc: T(L, `${staffable.length} von ${active.length} aktiven Projekten in ${fmt.quarter(quarter)} voll besetzbar`, `${staffable.length} of ${active.length} active projects fully staffable in ${fmt.quarter(quarter)}`),
      inputs: Object.entries(wlName).map(([k, n]) => [n, String(active.filter((p) => st(p) === k).length)]),
      items: active.map((p) => ({ text: label(p), sub: wlName[st(p)], tone: st(p) === 'ok' ? 'ok' : st(p) === 'partial' ? 'warn' : 'bad' })), itemsTitle: T(L, 'In Rangfolge', 'In rank order'),
      proof: proofWaterline(L, active, label, st, wlName, staffable.length, fmt.quarter(quarter)) },
    { ...defs.health, value: due.length, display: String(due.length), area: 'ranking', hot: due.length > 0,
      foot: due.length ? T(L, 'älter als der Hinweis-Rhythmus', 'older than the hint rhythm') : T(L, 'alle aktuell', 'all current'),
      calc: T(L, `${due.length} von ${ranked.length} Projekten ohne Update seit ${model.cfg.rules?.healthRhythmDays || 7} Tagen`, `${due.length} of ${ranked.length} projects without an update for ${model.cfg.rules?.healthRhythmDays || 7} days`),
      inputs: [[T(L, 'Rhythmus', 'Rhythm'), T(L, `${model.cfg.rules?.healthRhythmDays || 7} Tage`, `${model.cfg.rules?.healthRhythmDays || 7} days`)], [T(L, 'Fällig', 'Due'), String(due.length)]],
      items: due.map((p) => ({ text: label(p), sub: p.health ? T(L, `letztes Update ${fmt.date(p.health.at)}`, `last update ${fmt.date(p.health.at)}`) : T(L, 'noch nie aktualisiert', 'never updated'), tone: 'warn' })), itemsTitle: T(L, 'Update fällig', 'Update due'),
      proof: proofHealth(L, ranked, due, label, model.cfg.rules?.healthRhythmDays || 7, now) },
  ];
}

// Recount a proof from its rows (the "Nachprüfen" panel runs this in the browser): each total summed / counted again,
// the final step computed from the recounted totals and compared with the figure on the tile.
const nearly = (a, b) => a != null && b != null && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
export function recountProof(proof, value) {
  if (!proof) return null;
  const match = (r, where) => !where || Object.entries(where).every(([k, v]) => (r[k] ?? r.values?.[k]) === v);
  const totals = (proof.totals || []).map((t) => {
    if (t.given) return { ...t, recount: t.value, ok: true };
    const rows = (proof.rows || []).filter((r) => match(r, t.where));
    const recount = t.agg === 'rows' ? rows.length : rows.reduce((a, r) => a + (Number(r.values?.[t.col]) || 0), 0);
    return { ...t, recount, ok: nearly(recount, t.value) };
  });
  const byId = new Map(totals.map((t) => [t.id, t.recount]));
  const f = proof.final;
  let final = null;
  if (f) {
    let v = null;
    if (f.op === 'ratio') {
      const add = (ids) => ids.reduce((a, id) => a + (id.startsWith('-') ? -(byId.get(id.slice(1)) || 0) : byId.get(id) || 0), 0);
      const d = add(f.den);
      v = d ? add(f.num) / d + (f.offset || 0) : null;
    } else if (f.op === 'total') {
      v = byId.get(f.id) ?? null;
      if (f.clamp0 && v != null) v = Math.max(0, v);
    } else v = f.value;
    const tile = value == null || !Number.isFinite(value) ? true : nearly(v, value);
    final = { ...f, recount: v, ok: f.op === 'given' ? null : nearly(v, f.value) && tile };
  }
  return { totals, final, ok: totals.every((t) => t.ok) && (!final || final.ok !== false) };
}

// ---------- portfolio proofs: one row per project, the per-project figures that are summed ----------
const projectRow = (p, label, values, extra = {}) => ({ key: p.key || null, ref: p.ref, label: label(p), values, ...extra });
function proofActive(L, ranked, metrics, label) {
  const done = (p) => !!metrics.get(p.ref)?.done;
  const active = ranked.filter((p) => !done(p)).length;
  return {
    columns: [colOf('active', T(L, 'Aktiv (1 = ja)', 'Active (1 = yes)'), 'n'), colOf('done', T(L, 'Abgeschlossen (1 = ja)', 'Completed (1 = yes)'), 'n')],
    rows: ranked.map((p) => projectRow(p, label, { active: done(p) ? 0 : 1, done: done(p) ? 1 : 0 })),
    totals: [{ id: 'all', agg: 'rows', value: ranked.length, label: T(L, 'Im Portfolio', 'In the portfolio') }, totalOf('done', 'done', ranked.length - active, T(L, 'Abgeschlossen', 'Completed')), totalOf('active', 'active', active, T(L, 'Aktiv', 'Active'))],
    final: { op: 'total', id: 'active', value: active },
    steps: [T(L, 'Abgeschlossen ist ein Projekt, dessen Status-Kategorie „Erledigt“ ist.', 'A project is completed when its status category is "Done".'), T(L, 'Alle Projekte − abgeschlossene = aktive.', 'All projects − completed = active.')],
  };
}
function proofPortfolioProgress(L, ms, label, { TS, RE, OT, progress }, h) {
  return {
    columns: [colOf('ts', 'Time Spent', 'h'), colOf('re', 'Remaining Estimate', 'h'), colOf('ot', T(L, 'Offene T-Shirt Size', 'Open T-shirt size'), 'h'), colOf('progress', T(L, 'Fortschritt des Projekts', 'Project progress'), 'pct')],
    rows: ms.map(({ p, m }) => projectRow(p, label, { ts: m.TS, re: m.RE, ot: m.openTshirt, progress: m.TS + m.RE + m.openTshirt > 0 ? m.progress : null })),
    totals: [totalOf('ts', 'ts', TS, 'Time Spent'), totalOf('re', 're', RE, 'Remaining Estimate'), totalOf('ot', 'ot', OT, T(L, 'Offene T-Shirt Size', 'Open T-shirt size'))],
    ...(TS + RE + OT > 0 ? { final: { op: 'ratio', num: ['ts'], den: ['ts', 're', 'ot'], value: progress } } : {}),
    steps: [
      T(L, `Addiere je Spalte über alle aktiven Projekte: Time Spent ${h(TS)}, Remaining Estimate ${h(RE)}, offene T-Shirt Size ${h(OT)}.`, `Add up each column over all active projects: time spent ${h(TS)}, remaining estimate ${h(RE)}, open T-shirt size ${h(OT)}.`),
      T(L, 'Time Spent ÷ (Time Spent + Remaining + offene T-Shirt Size) – große Projekte zählen dadurch mehr als kleine.', 'Time spent ÷ (time spent + remaining + open T-shirt size) – so big projects weigh more than small ones.'),
      T(L, 'Jedes Projekt lässt sich in seinem eigenen Fortschritt genauso nachprüfen.', 'Each project can be checked the same way in its own progress.'),
    ],
  };
}
function proofPortfolioMaturity(L, model, ms, label, { OEc, OT, OE, maturity }, h, fmt) {
  const rows = ms.map(({ p, m }) => {
    const oe = m.maturityBasis?.oeCovered ?? m.OE;
    return projectRow(p, label, { oe, oeOut: m.OE - oe, open: m.openTshirt, maturity: m.maturity }, { group: m.maturity == null ? 'unsized' : 'sized', children: maturityUnits(L, model, p, m, fmt) });
  });
  return {
    columns: [colOf('oe', T(L, 'Original Estimate (eingerechnet)', 'Original estimate (counted)'), 'h'), colOf('oeOut', T(L, 'Original Estimate ohne T-Shirt Size', 'Original estimate without T-shirt size'), 'h'),
      colOf('open', T(L, 'Offene T-Shirt Size', 'Open T-shirt size'), 'h'), colOf('maturity', T(L, 'Reife des Projekts', 'Project maturity'), 'pct')],
    rows,
    totals: [
      totalOf('oe', 'oe', OEc, T(L, 'Original Estimate mit T-Shirt Size darüber', 'Original estimate below a T-shirt size')),
      totalOf('open', 'open', OT, T(L, 'Offene T-Shirt Size', 'Open T-shirt size')),
      ...(OE - OEc > 0.005 ? [totalOf('oeOut', 'oeOut', OE - OEc, T(L, 'Nicht eingerechnet (ohne T-Shirt Size)', 'Not counted (no T-shirt size)'))] : []),
    ],
    ...(maturity != null ? { final: { op: 'ratio', num: ['oe'], den: ['oe', 'open'], value: maturity } } : {}),
    steps: [
      T(L, 'Klappe ein Projekt auf: Darunter stehen seine Epics mit T-Shirt Size, Quarter/s, Original Estimate und was offen ist – jedes mit Link nach Jira.', 'Expand a project: below are its epics with T-shirt size, quarters, original estimate and what is open – each linked to Jira.'),
      T(L, `Addiere über alle aktiven Projekte: Original Estimate unter einer T-Shirt Size ${h(OEc)} und offene T-Shirt Size ${h(OT)}.`, `Add up over all active projects: original estimate below a T-shirt size ${h(OEc)} and open T-shirt size ${h(OT)}.`),
      T(L, 'Planungsreife = Original Estimate ÷ (Original Estimate + offene T-Shirt Size). Ohne T-Shirt Size zählt ein Projekt nicht mit.', 'Planning maturity = original estimate ÷ (original estimate + open T-shirt size). A project without T-shirt size does not count.'),
    ],
  };
}
function proofWaterline(L, active, label, st, wlName, staffable, quarterText) {
  return {
    columns: [colOf('status', T(L, `Wasserlinie ${quarterText}`, `Waterline ${quarterText}`), 'text'), colOf('ok', T(L, 'Voll besetzbar (1 = ja)', 'Fully staffable (1 = yes)'), 'n')],
    rows: active.map((p) => projectRow(p, label, { status: wlName[st(p)], ok: st(p) === 'ok' ? 1 : 0 })),
    totals: [{ id: 'all', agg: 'rows', value: active.length, label: T(L, 'Aktive Projekte', 'Active projects') }, totalOf('ok', 'ok', staffable, T(L, 'Voll besetzbar', 'Fully staffable'))],
    final: { op: 'total', id: 'ok', value: staffable },
    steps: [T(L, 'Die Kapazität jedes Teams wird in Rangfolge verteilt (Support zuerst).', "Each team's capacity is handed out in rank order (support first)."), T(L, 'Voll besetzbar ist ein Projekt, wenn alle seine Teams den Bedarf im Quartal decken. Die Herleitung je Team zeigt die Kapazitätsansicht.', 'A project is fully staffable when all its teams cover its demand in the quarter. The capacity view shows the derivation per team.')],
  };
}
function proofHealth(L, ranked, due, label, rhythm, now) {
  const isDue = new Set(due.map((p) => p.ref));
  return {
    columns: [colOf('at', T(L, 'Letztes Update', 'Last update'), 'date'), colOf('days', T(L, 'Tage her', 'Days ago'), 'n'), colOf('due', T(L, 'Update fällig (1 = ja)', 'Update due (1 = yes)'), 'n')],
    rows: ranked.map((p) => projectRow(p, label, { at: p.health?.at ? String(p.health.at).slice(0, 10) : null, days: p.health?.at ? Math.floor((now - Date.parse(p.health.at)) / 864e5) : null, due: isDue.has(p.ref) ? 1 : 0 })),
    totals: [{ id: 'all', agg: 'rows', value: ranked.length, label: T(L, 'Projekte', 'Projects') }, totalOf('due', 'due', due.length, T(L, 'Fällig', 'Due'))],
    final: { op: 'total', id: 'due', value: due.length },
    steps: [T(L, `Fällig ist ein Projekt, dessen letztes Health-Update älter als ${rhythm} Tage ist oder das noch keins hat.`, `A project is due when its last health update is older than ${rhythm} days or it has none.`)],
  };
}

// ---------- the company's Jira structure rules, checked live ----------
// Each check: the rule as the structure spec words it, how many work items break it, and which ones.
// ctx: { computed, ds, lang, fmt, usageName? }
export function structureChecks({ computed, ds, lang = 'de', fmt, usageName = (u) => u }) {
  const L = lang;
  const { model } = computed;
  const issues = model.ds.issues || [];
  const open = (i) => (i.status?.cat ?? 'new') !== 'done';
  const it = (i, sub, tone = 'warn') => ({ key: i.key, id: i.id, text: `${i.key} ${i.summary || ''}`.trim(), sub, tone });
  const out = [];
  // 1. Epics (the level with the rough estimate) carry T-shirt size and Quarter/s
  // the rough-estimate carriers: rough-level items below each project, or the portfolio item itself (same rule as the engine)
  const roughUnits = model.items.filter((p) => (p.statusCat ?? 'new') !== 'done')
    .flatMap((p) => engineRoughUnits(model, p).map((u) => (u.isItem ? { ...p, summary: p.name } : u)))
    .filter((u) => open(u) || u.ref);
  const sized = (u) => sizeHours(model, u.tshirt) > 0;
  const r1 = roughUnits.filter((u) => !sized(u) || !(u.quarters || []).length);
  out.push({ id: 'roughSize', title: T(L, 'T-Shirt Size und Quarter/s am Epic', 'T-Shirt Size and Quarter/s on the epic'),
    rule: T(L, 'Am Epic reicht eine grobe Größe. Das Cockpit rechnet sie in Stunden um und verteilt sie auf die gewählten Quarter/s. Pflicht beim Anlegen.', 'A rough size on the epic is enough. The cockpit converts it into hours and spreads it over the selected Quarter/s. Required on creation.'),
    total: roughUnits.length, count: r1.length,
    items: r1.map((u) => ({ ...it(u, [!sized(u) ? 'T-Shirt Size' : null, !(u.quarters || []).length ? 'Quarter/s' : null].filter(Boolean).map((x) => T(L, `${x} fehlt`, `${x} missing`)).join(' · '), !sized(u) ? 'bad' : 'warn'),
      ...(!sized(u) ? { fix: { usage: 'tshirt', ...(u.ref ? { ref: u.ref } : { issueId: u.id }) } } : {}) })) });
  // 2. Stories past "Open" carry Team, Original Estimate, Start date and Due date
  const started = issues.filter((i) => i.role === 'estimate' && open(i) && (i.status?.cat === 'indeterminate' || /^ready$/i.test(i.status?.name || '')));
  const need = [['team', (i) => !i.team], ['originalEstimate', (i) => !(i.oe > 0)], ['startDate', (i) => !i.start], ['dueDate', (i) => !i.due]];
  const r2 = started.map((i) => ({ i, miss: need.filter(([, f]) => f(i)).map(([u]) => usageName(u)) })).filter((x) => x.miss.length);
  out.push({ id: 'storyReady', title: T(L, 'Stories ab „Ready“ vollständig', 'Stories complete from "Ready"'),
    rule: T(L, 'Bevor eine Story startet, braucht sie Team, Original Estimate, Start date und Due date.', 'Before a story starts it needs Team, Original Estimate, Start date and Due date.'),
    total: started.length, count: r2.length, items: r2.map(({ i, miss }) => it(i, `${i.status?.name || ''} · ${T(L, 'fehlt', 'missing')}: ${miss.join(', ')}`)) });
  // 3. Time is logged on stories
  const subLogs = issues.filter((i) => i.role === 'tiny' && i.ts > 0);
  out.push({ id: 'logOnStories', title: T(L, 'Zeit auf Stories buchen', 'Log time on stories'),
    rule: T(L, 'Nur dort zählt sie für Fortschritt und Kapazität. Buchung auf Sub-tasks ist noch in Klärung – bis dahin nur auf Stories buchen.', 'Only there it counts for progress and capacity. Logging on sub-tasks is still being decided – until then, log on stories only.'),
    total: issues.filter((i) => i.role === 'tiny').length, count: subLogs.length,
    items: subLogs.map((i) => it(i, T(L, `${fmt.h(i.ts)} auf dem Sub-task gebucht`, `${fmt.h(i.ts)} logged on the sub-task`))) });
  // 4. Milestones via Fix versions (only when milestones are in use)
  if ((model.ds.milestones || []).length || model.msField) {
    const openStories = issues.filter((i) => i.role === 'estimate' && open(i));
    const noMs = openStories.filter((i) => !(i.fixVersionIds || []).length && !i.milestone);
    out.push({ id: 'milestones', title: T(L, 'Meilensteine über Fix versions', 'Milestones via Fix versions'),
      rule: T(L, 'Stories bekommen ihre Fix version; Releases über mehrere Spaces bündelt das Cockpit als Cross-Release.', 'Stories get their fix version; the cockpit bundles releases across spaces as a cross-release.'),
      total: openStories.length, count: noMs.length, items: noMs.map((i) => it(i, T(L, 'keine Fix version', 'no fix version'), 'muted')) });
  }
  // 5. No support tickets in project spaces
  const projectSpaces = new Set(issues.map((i) => i.projectKey).filter(Boolean));
  const tickets = ds?.supportTickets?.tickets || [];
  const inProject = tickets.filter((t) => projectSpaces.has(t.projectKey));
  if (tickets.length) {
    out.push({ id: 'supportSpace', title: T(L, 'Keine Support-Tickets im Projekt-Space', 'No support tickets in project spaces'),
      rule: T(L, 'Support gehört in den Service-Space (Beispiel SUP), direkt auf Ebene 5 ohne Project darüber.', 'Support belongs in the service space (e.g. SUP), directly on level 5 with no Project above it.'),
      total: tickets.length, count: inProject.length,
      items: inProject.map((t) => ({ key: t.key, text: `${t.key} ${t.summary || ''}`, sub: T(L, `liegt im Projekt-Space ${t.projectKey}`, `sits in project space ${t.projectKey}`), tone: 'warn' })) });
  }
  return out.map((c) => ({ ...c, ok: c.count === 0 }));
}

// Utilisation tone, one rule everywhere (screen, PDF, Excel, Ask): room up to 85 %, nearly full up to 100 %,
// overbooked above 100 %. "Red" therefore always means more planned work than capacity – never just "some load".
export const UTIL_WARN = 0.85;
export const utilTone = (u) => (u == null || Number.isNaN(u) ? null : u > 1.0001 ? 'bad' : u > UTIL_WARN ? 'warn' : 'ok');

// A team without capacity (no people, no weekly hours maintained): utilisation is not a number. Internally it may be
// Infinity; on screen, in the report, PDF and Confluence it is "–" with the reason – never "∞".
export const NO_CAP_TEXT = '–';
export const noCapacityReason = (load, lang = 'de') => (load > 0.05
  ? T(lang === 'en' ? 'en' : 'de', 'Arbeit geplant, aber keine Kapazität', 'work planned but no capacity')
  : T(lang === 'en' ? 'en' : 'de', 'keine Kapazität gepflegt', 'no capacity maintained'));
// { noCap, text, reason, util }: pct formats a finite utilisation.
export function teamUtilView(load, cap, { lang = 'de', pct = (u) => `${Math.round(u * 100)} %` } = {}) {
  if (cap > 0) return { noCap: false, util: (load || 0) / cap, text: pct((load || 0) / cap), reason: null };
  return { noCap: true, util: null, text: NO_CAP_TEXT, reason: noCapacityReason(load || 0, lang) };
}

// ---------- Teamdetails: the same tiles with breakdown as the portfolio, for one team ----------
export function teamDefinitions(lang) {
  const L = lang;
  return [
    { id: 'members', icon: 'users', label: T(L, 'Mitglieder', 'Members'), text: T(L, 'Personen mit Kapazität in diesem Team (gepflegt unter Teams › Kapazitäten pflegen oder abgeleitet aus zugewiesenen Stories) und ihre Wochenstunden – bei mehreren Teams mit ihrem Anteil in %.', 'People with capacity in this team (maintained under Teams › Maintain capacities or derived from assigned stories) and their weekly hours – with their share in % when they work in several teams.') },
    { id: 'available', icon: 'clock', label: T(L, 'Für Projekte je Woche', 'For projects per week'), text: T(L, 'Wochenstunden − Tagesgeschäft % − Intern % (beides Anteile der Wochenstunden) − gemessener Support des Teams (gebuchte Stunden auf Tickets dieses Teams). Je Person zählt dagegen, was die Person selbst auf Support-Tickets bucht – auch für andere Teams. Feiertage und Abwesenheiten kommen in der Wochenansicht dazu, die Ausfallquote nur in der Quartalsplanung.', 'Weekly hours − daily business % − internal % (both shares of the weekly hours) − the team’s measured support (hours logged on this team’s tickets). Per person it is what that person logs on support tickets – also for other teams. Holidays and absences are deducted in the weekly view, the absence rate only in quarter planning.') },
    { id: 'support', icon: 'headset', label: T(L, 'Support (Vorrang)', 'Support (priority)'), text: T(L, 'Gebuchte Support-Stunden je Woche (Durchschnitt) – sie gehen vor allen Projekten von der Kapazität ab.', 'Logged support hours per week (average) – taken off the capacity before any project.') },
    { id: 'util', icon: 'gauge', label: T(L, 'Auslastung', 'Utilization'), text: T(L, 'Projektbedarf des Teams im Quartal (Remaining Estimate + offene T-Shirt Size) ÷ Kapazität nach Support. Bis 85 % Luft, bis 100 % fast voll, darüber überbucht.', "The team's project demand in the quarter (remaining estimate + open T-shirt size) ÷ capacity after support. Up to 85 % room, up to 100 % nearly full, above that overbooked.") },
    { id: 'progress', icon: 'target', label: T(L, 'Fortschritt des Teams', 'Team progress'), text: T(L, 'Time Spent ÷ (Time Spent + Remaining Estimate) über die Stories des Teams in allen Projekten.', "Time spent ÷ (time spent + remaining estimate) over the team's stories in all projects.") },
    { id: 'watch', icon: 'alert', label: T(L, 'Blockiert / überfällig', 'Blocked / past due'), text: T(L, 'Offene Stories und Sub-tasks des Teams im Status Blocked oder über ihrem Due Date. In der Übersicht filterst du die Liste auf blockiert oder überfällig.', 'Open stories and sub-tasks of the team in the Blocked status or past their due date. In the overview you filter the list to blocked or past due.') },
  ];
}

// The records behind the team tiles (see "proof" above).
function teamProofs({ L, model, computed, td, teamId, h, fmt, name, perPerson, extra, gross, dPct, iPct, avail, q0, c0, TS, RE, progress, blocked, overdue }) {
  const hourCol = (id, label) => colOf(id, label, 'h');
  const members = {
    columns: [hourCol('w', T(L, 'Wochenstunden (bei mehreren Teams: Anteil)', 'Weekly hours (several teams: share)'), 'h')],
    rows: [...perPerson.map(({ p, w }) => ({ label: name(p.id), group: 'person', values: { w } })), ...(extra ? [{ label: T(L, 'Ohne Namen (Team-Einstellung)', 'Unnamed (team setting)'), group: 'extra', values: { w: extra } }] : [])],
    totals: [{ id: 'people', agg: 'rows', where: { group: 'person' }, value: perPerson.length, label: T(L, 'Personen', 'People') }, totalOf('gross', 'w', gross, T(L, 'Wochenstunden des Teams', 'Weekly hours of the team'))],
    final: { op: 'total', id: 'people', value: perPerson.length },
    steps: [T(L, `Addiere die Wochenstunden aller Personen: ${h(gross)}.`, `Add up everyone's weekly hours: ${h(gross)}.`), T(L, 'Wer in mehreren Teams arbeitet, zählt mit seinem Anteil (Wochenstunden × Anteil in %).', 'Someone working in several teams counts with their share (weekly hours × share in %).')],
  };
  const net = gross - gross * dPct / 100 - gross * iPct / 100 - td.supportWeekly;
  const available = {
    columns: [hourCol('hours', T(L, 'Stunden je Woche', 'Hours per week'))],
    rows: [
      { label: T(L, 'Wochenstunden', 'Weekly hours'), values: { hours: gross } },
      { label: T(L, `− Tagesgeschäft ${dPct} %`, `− daily business ${dPct}%`), values: { hours: -gross * dPct / 100 } },
      { label: T(L, `− Intern ${iPct} %`, `− internal ${iPct}%`), values: { hours: -gross * iPct / 100 } },
      { label: T(L, '− Support des Teams (Ø je Woche)', '− team support (avg per week)'), values: { hours: -td.supportWeekly } },
    ],
    totals: [totalOf('net', 'hours', net, T(L, 'Für Projekte je Woche', 'For projects per week'))],
    final: { op: 'total', id: 'net', clamp0: true, value: avail },
    steps: [T(L, 'Von den Wochenstunden gehen Tagesgeschäft und Intern (je ein Anteil der Wochenstunden) und der gemessene Support ab.', 'Daily business and internal work (each a share of the weekly hours) and the measured support are taken off the weekly hours.'), T(L, `Die Summe der Zeilen ist ${h(avail)} für Projekte (nie unter 0).`, `The rows add up to ${h(avail)} for projects (never below 0).`)],
  };
  const supTeam = (computed.support?.teams || []).find((t) => t.teamId === teamId) || null;
  const support = {
    columns: [hourCol('weekly', T(L, 'Dieses Team je Woche', 'This team per week')), hourCol('avg', T(L, 'Ø je Woche', 'Avg per week')), colOf('rising', T(L, 'Steigt (1 = ja)', 'Rising (1 = yes)'), 'n'), colOf('open', T(L, 'Offene Tickets', 'Open tickets'), 'n')],
    rows: td.spaces.map((s) => ({ key: null, label: s.key ? `${s.key} ${s.name}` : s.name, values: { weekly: s.weekly || 0, avg: s.avg || 0, rising: s.spike ? 1 : 0, open: s.open ?? 0 } })),
    totals: [{ id: 'sup', value: td.supportWeekly, unit: 'h', label: T(L, 'Support des Teams je Woche', 'Team support per week'), given: true, source: T(L, 'aus den Zeitbuchungen auf Support-Tickets dieses Teams', "from the time logged on this team's support tickets") }],
    final: { op: 'given', value: td.supportWeekly },
    note: supTeam?.override != null
      ? T(L, 'Der Wert ist in der Support-Reserve von Hand gesetzt.', 'The value is set by hand in the support reserve.')
      : T(L, `Gemessen an den Buchungen auf Tickets dieses Teams: Ø der letzten ${computed.support?.averagingWeeks || 4} Wochen; steigen die letzten 2 Wochen über das 1,2-Fache, zählt ihr Ø. Die Space-Zeilen zeigen, wo die Zeit anfällt – Tickets ohne Space zählen im Team mit.`, `Measured from the bookings on this team's tickets: the average of the last ${computed.support?.averagingWeeks || 4} weeks; if the last 2 weeks rise above 1.2 times that, their average counts. The space rows show where the time goes – tickets without a space count for the team too.`),
    steps: [T(L, 'Der Support-Wert stammt aus den Zeitbuchungen auf Support-Tickets – nachzählen in Jira über die Worklogs der Tickets dieses Teams.', 'The support value comes from the time logged on support tickets – recount it in Jira from the worklogs of this team\'s tickets.')],
  };
  const cell = computed.wl.cells[teamId]?.[q0];
  const pRow = (ref) => model.itemByRef.get(ref);
  const util = {
    columns: [hourCol('demand', T(L, `Bedarf in ${fmt.quarter(q0)}`, `Demand in ${fmt.quarter(q0)}`)), colOf('status', T(L, 'Wasserlinie', 'Waterline'), 'text')],
    rows: (cell?.rows || []).filter((r) => r.kind === 'project').map((r) => ({ key: pRow(r.ref)?.key || null, ref: r.ref, label: `#${r.rank} ${pRow(r.ref)?.name || r.ref}`, values: { demand: r.demand, status: r.status } })),
    totals: [
      totalOf('demand', 'demand', c0.demand, T(L, 'Projektbedarf', 'Project demand')),
      { id: 'cap', value: c0.capacity, unit: 'h', label: T(L, 'Kapazität im Quartal', 'Capacity in the quarter'), given: true, source: T(L, 'aus der Kapazitätsplanung (Wochenstunden × 12 × Projektanteil × (1 − Ausfallquote))', 'from capacity planning (weekly hours × 12 × project share × (1 − absence rate))') },
      { id: 'sup', value: c0.support, unit: 'h', label: 'Support', given: true, source: T(L, 'aus den Support-Buchungen (Reserve je Quartal)', 'from the support bookings (reserve per quarter)') },
    ],
    ...(c0.cap > 0 ? { final: { op: 'ratio', num: ['demand'], den: ['cap', '-sup'], value: c0.util } } : {}),
    steps: [
      T(L, `Addiere den Bedarf der Projekte (Remaining Estimate + offene T-Shirt Size dieses Teams im Quartal): ${h(c0.demand)}.`, `Add up the projects' demand (remaining estimate + open T-shirt size of this team in the quarter): ${h(c0.demand)}.`),
      T(L, `Kapazität ${h(c0.capacity)} = Wochenstunden × 12 Wochen × Projektanteil × (1 − Ausfallquote), davon geht Support ${h(c0.support)} ab.`, `Capacity ${h(c0.capacity)} = weekly hours × 12 weeks × project share × (1 − absence rate), minus support ${h(c0.support)}.`),
      T(L, 'Auslastung = Bedarf ÷ (Kapazität − Support).', 'Utilization = demand ÷ (capacity − support).'),
    ],
  };
  const isOpenI = (i) => (i.status?.cat ?? i.statusCat ?? 'new') !== 'done';
  const teamStories = td.projects.flatMap((p) => (model.byRoot.get(p.ref) || []).filter((i) => i.role === 'estimate' && i.team?.id === teamId));
  const prog = {
    columns: [colOf('project', T(L, 'Projekt', 'Project'), 'text'), hourCol('ts', 'Time Spent'), hourCol('re', T(L, 'Remaining Estimate (nur offene)', 'Remaining estimate (open only)'))],
    rows: teamStories.filter((s) => s.ts > 0 || (isOpenI(s) && s.re > 0)).map((s) => issueRow(s, { project: pRow(s.rootRef)?.name || '', ts: s.ts || 0, re: isOpenI(s) ? s.re || 0 : 0 })),
    totals: [totalOf('ts', 'ts', TS, 'Time Spent'), totalOf('re', 're', RE, 'Remaining Estimate')],
    ...(progress != null ? { final: { op: 'ratio', num: ['ts'], den: ['ts', 're'], value: progress } } : {}),
    steps: [T(L, `Addiere Time Spent (${h(TS)}) und Remaining Estimate der offenen Stories (${h(RE)}) über die Stories dieses Teams.`, `Add up time spent (${h(TS)}) and the remaining estimate of open stories (${h(RE)}) over this team's stories.`), T(L, 'Time Spent ÷ (Time Spent + Remaining Estimate).', 'Time spent ÷ (time spent + remaining estimate).')],
  };
  const watch = {
    columns: [colOf('blocked', T(L, 'Blockiert (1 = ja)', 'Blocked (1 = yes)'), 'n'), colOf('overdue', T(L, 'Nur überfällig (1 = ja)', 'Past due only (1 = yes)'), 'n'), colOf('days', T(L, 'Tage über Due', 'Days past due'), 'n'), colOf('due', 'Due Date', 'date')],
    rows: td.watch.map((w) => { const i = model.byId.get(w.id) || { id: w.id }; return issueRow(i, { blocked: w.blocked ? 1 : 0, overdue: w.blocked ? 0 : 1, days: w.days || 0, due: i.due || null }); }),
    totals: [totalOf('blocked', 'blocked', blocked, T(L, 'Blockiert', 'Blocked')), totalOf('overdue', 'overdue', overdue, T(L, 'Überfällig', 'Past due')), { id: 'all', agg: 'rows', value: td.watch.length, label: T(L, 'Zusammen', 'Together') }],
    final: { op: 'total', id: 'all', value: td.watch.length },
    steps: [T(L, 'Offene Stories und Sub-tasks des Teams im Status Blocked zählen als blockiert; die übrigen mit Due Date vor heute als überfällig.', "The team's open stories and sub-tasks in the Blocked status count as blocked; the others with a due date before today as past due.")],
  };
  return { members, available, support, util, progress: prog, watch };
}

// ctx: { computed, teamId, lang, fmt, people? (accountId → { name }) }
export function teamKpis({ computed, teamId, lang = 'de', fmt, people = {} }) {
  const L = lang;
  const { model, support } = computed;
  const td = teamDetails(computed, teamId);
  const defs = Object.fromEntries(teamDefinitions(L).map((d) => [d.id, d]));
  // one decimal where a value is not whole, so every calculation on a tile adds up as written (40 − 8 − 4 − 0.5 = 27.5)
  const h = (v) => fmt.h(v, Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1);
  const name = (id) => people[id]?.name || T(L, 'Person', 'Person');
  const st = teamSettings(model, teamId);
  const share = projectShare(st);
  const dPct = +st.dailyBusinessPct || 0, iPct = +st.internalPct || 0;
  const members = [...capacityPeople(model).values()].filter((p) => inTeam(p, teamId)); // split people: weekly hours × share
  const extra = +st.extraWeeklyHours || 0;
  const gross = td.weeklyHours + extra;
  const avail = Math.max(0, gross * share - td.supportWeekly);
  const perPerson = members.map((p) => { const w = (+p.weeklyHours || 0) * shareOf(p, teamId); const s = (support?.personWeekly?.[p.id] || 0) * shareOf(p, teamId); return { p, w, s, a: Math.max(0, w * share - s) }; });
  const q0 = td.quarters[0], c0 = td.cells[q0] || { capacity: 0, support: 0, cap: 0, demand: 0, free: 0, util: 0 };
  const tone = utilTone(c0.util);
  const TS = td.projects.reduce((a, p) => a + p.ts, 0), RE = td.projects.reduce((a, p) => a + p.re, 0);
  const progress = TS + RE > 0 ? TS / (TS + RE) : null;
  const wlName = { ok: T(L, 'passt', 'fits'), partial: T(L, 'teilweise', 'partly'), no: T(L, 'passt nicht mehr', 'no longer fits') };
  const blocked = td.watch.filter((w) => w.blocked).length, overdue = td.watch.filter((w) => !w.blocked).length;
  const minus = (pct, label) => (pct ? ` − ${h(gross * pct / 100)} ${label}` : '');
  const tp = teamProofs({ L, model, computed, td, teamId, h, fmt, name, perPerson, extra, gross, dPct, iPct, share, avail, q0, c0, TS, RE, progress, blocked, overdue });
  return [
    { ...defs.members, value: members.length, display: String(members.length), area: 'capacity',
      foot: T(L, `${h(gross)} je Woche · ${td.projects.length} ${td.projects.length === 1 ? 'Projekt' : 'Projekte'} · ${td.spaces.length} Service-Spaces`, `${h(gross)} per week · ${td.projects.length} ${td.projects.length === 1 ? 'project' : 'projects'} · ${td.spaces.length} service ${td.spaces.length === 1 ? 'space' : 'spaces'}`),
      calc: members.length || extra ? `${[...perPerson.map((x) => h(x.w)), ...(extra ? [`${h(extra)} ${T(L, 'ohne Namen', 'unnamed')}`] : [])].join(' + ')} = ${h(gross)}` : T(L, 'Niemand mit Kapazität zugeordnet = 0 h (unter Kapazität › Kapazitäten bearbeiten Personen hinzufügen)', 'Nobody with capacity assigned = 0 h (add people under Capacity › Edit capacities)'),
      inputs: [[T(L, 'Personen', 'People'), String(members.length)], [T(L, 'Wochenstunden', 'Weekly hours'), h(td.weeklyHours)], ...(extra ? [[T(L, 'Ohne Namen', 'Unnamed'), h(extra)]] : [])],
      items: perPerson.map(({ p, w }) => ({ text: name(p.id), sub: T(L, `${h(w)} je Woche${p.derived ? ' · Standardwert' : ''}`, `${h(w)} per week${p.derived ? ' · default value' : ''}`), tone: 'ok' })), itemsTitle: T(L, 'Personen', 'People'),
      proof: tp.members },
    { ...defs.available, value: avail, display: h(avail), area: 'capacity',
      foot: T(L, `von ${h(gross)} · Tagesgeschäft ${dPct} % · Intern ${iPct} % · Support ${h(td.supportWeekly)}`, `of ${h(gross)} · daily business ${dPct} % · internal ${iPct} % · support ${h(td.supportWeekly)}`),
      calc: `${h(gross)}${minus(dPct, T(L, 'Tagesgeschäft', 'daily business'))}${minus(iPct, T(L, 'intern', 'internal'))}${td.supportWeekly ? ` − ${h(td.supportWeekly)} Support` : ''} = ${h(avail)}`,
      inputs: [[T(L, 'Wochenstunden', 'Weekly hours'), h(gross)], [T(L, 'Tagesgeschäft', 'Daily business'), `${dPct} % = ${h(gross * dPct / 100)}`], [T(L, 'Intern', 'Internal'), `${iPct} % = ${h(gross * iPct / 100)}`], [T(L, 'Support des Teams (Tickets dieses Teams, Ø je Woche)', "Team support (this team's tickets, avg per week)"), h(td.supportWeekly)]],
      items: perPerson.map(({ p, w, s, a }) => ({ text: name(p.id), sub: `${h(w)}${dPct ? ` − ${h(w * dPct / 100)}` : ''}${iPct ? ` − ${h(w * iPct / 100)}` : ''}${s ? ` − ${h(s)} Support` : ''} = ${h(a)} ${T(L, 'für Projekte', 'for projects')}`, tone: 'ok' })), itemsTitle: T(L, 'Je Person', 'Per person'),
      proof: tp.available },
    { ...defs.support, value: td.supportWeekly, display: h(td.supportWeekly), area: 'projects',
      foot: T(L, `je Woche · ${fmt.pct(td.supportShare)} der Wochenstunden${td.spaces.length ? '' : ' · kein Support'}`, `per week · ${fmt.pct(td.supportShare)} of the weekly hours${td.spaces.length ? '' : ' · no support'}`),
      calc: gross > 0 ? `${h(td.supportWeekly)} ÷ ${h(gross)} = ${fmt.pct(td.supportShare)}` : T(L, 'Keine Wochenstunden', 'No weekly hours'),
      inputs: [[T(L, 'Support je Woche', 'Support per week'), h(td.supportWeekly)], [T(L, 'Service-Spaces', 'Service spaces'), String(td.spaces.length)], [T(L, 'Je Quartal reserviert', 'Reserved per quarter'), h(td.supportWeekly * 12)]],
      items: td.spaces.map((s) => ({ text: s.name, sub: T(L, `${h(s.weekly)} je Woche · Ø ${h(s.avg)}${s.spike ? ' · steigt' : ''} · ${s.open ?? 0} offene Tickets`, `${h(s.weekly)} per week · avg ${h(s.avg)}${s.spike ? ' · rising' : ''} · ${s.open ?? 0} open tickets`), tone: s.spike ? 'warn' : 'ok' })), itemsTitle: T(L, 'Service-Spaces', 'Service spaces'),
      proof: tp.support },
    // no capacity: "–" and the reason (never "∞"), with the way out – maintain capacities
    { ...defs.util, label: `${defs.util.label} ${fmt.quarter(q0)}`, value: c0.cap > 0 ? c0.util : null, display: c0.cap > 0 ? fmt.pct(c0.util) : NO_CAP_TEXT, area: c0.cap > 0 ? 'projects' : 'capacity', hot: tone === 'bad' || (c0.cap <= 0 && c0.demand > 0.5), noCap: !(c0.cap > 0),
      foot: c0.cap > 0
        ? T(L, `${h(c0.demand)} Projektbedarf von ${h(c0.cap)} nach Support · ${c0.free >= 0 ? `${h(c0.free)} frei` : `${h(-c0.free)} fehlen`}`, `${h(c0.demand)} project demand of ${h(c0.cap)} after support · ${c0.free >= 0 ? `${h(c0.free)} free` : `${h(-c0.free)} missing`}`)
        : `${noCapacityReason(c0.demand > 0.5 ? c0.demand : 0, L)}${c0.demand > 0.5 ? ` (${h(c0.demand)})` : ''} · ${T(L, 'Kapazitäten pflegen', 'maintain capacities')}`,
      calc: c0.cap > 0 ? `${h(c0.demand)} ÷ (${h(c0.capacity)} − ${h(c0.support)} Support) = ${fmt.pct(c0.util)}` : c0.demand > 0.5 ? T(L, `${h(c0.demand)} Bedarf, aber 0 h Kapazität – dem Team ist niemand mit Kapazität zugeordnet, eine Auslastung gibt es nicht. Unter Teams › Kapazitäten pflegen Personen und Wochenstunden eintragen.`, `${h(c0.demand)} demand but 0 h capacity – nobody with capacity is assigned to the team, so there is no utilization. Add people and weekly hours under Teams › Maintain capacities.`) : T(L, 'Kein Bedarf und keine Kapazität im Quartal – keine Kapazität gepflegt (Teams › Kapazitäten pflegen).', 'No demand and no capacity in the quarter – no capacity maintained (Teams › Maintain capacities).'),
      inputs: [[T(L, 'Kapazität im Quartal', 'Capacity in the quarter'), h(c0.capacity)], [T(L, 'Support', 'Support'), h(c0.support)], [T(L, 'Nach Support', 'After support'), h(c0.cap)], [T(L, 'Projektbedarf', 'Project demand'), h(c0.demand)], [c0.free >= 0 ? T(L, 'Frei', 'Free') : T(L, 'Fehlt', 'Missing'), h(Math.abs(c0.free))]],
      items: td.projects.filter((p) => (p.q[q0]?.demand || 0) > 0.5).map((p) => ({ text: `#${p.rank} ${p.name}`, sub: `${h(p.q[q0].demand)} · ${wlName[p.q[q0].status] || wlName.ok}`, tone: p.q[q0].status === 'ok' ? 'ok' : p.q[q0].status === 'partial' ? 'warn' : 'bad' })), itemsTitle: T(L, `Bedarf in ${fmt.quarter(q0)}, in Rangfolge`, `Demand in ${fmt.quarter(q0)}, in rank order`),
      proof: tp.util },
    { ...defs.progress, value: progress, display: progress == null ? '–' : fmt.pct(progress), area: 'projects',
      foot: T(L, `Time Spent ${h(TS)} von ca. ${h(TS + RE)}`, `Time spent ${h(TS)} of approx. ${h(TS + RE)}`),
      calc: progress == null ? T(L, 'Noch keine geschätzten Stories', 'No estimated stories yet') : `${h(TS)} ÷ (${h(TS)} + ${h(RE)}) = ${fmt.pct(progress)}`,
      inputs: [[T(L, 'Time Spent', 'Time spent'), h(TS)], [T(L, 'Remaining Estimate', 'Remaining estimate'), h(RE)], [T(L, 'Stories', 'Stories'), String(td.projects.reduce((a, p) => a + p.stories, 0))]],
      items: td.projects.filter((p) => p.stories).map((p) => ({ text: `#${p.rank} ${p.name}`, sub: `${p.ts + p.re > 0 ? fmt.pct(p.ts / (p.ts + p.re)) : '–'} · ${h(p.ts)} / ${h(p.ts + p.re)} · ${p.stories} Stories`, tone: 'ok' })), itemsTitle: T(L, 'Je Projekt', 'Per project'),
      proof: tp.progress },
    { ...defs.watch, value: td.watch.length, display: String(td.watch.length), area: 'watch', hot: td.watch.length > 0,
      foot: td.watch.length ? T(L, `${blocked} blockiert · ${overdue} überfällig`, `${blocked} blocked · ${overdue} past due`) : T(L, 'nichts blockiert oder überfällig', 'nothing blocked or past due'),
      calc: `${blocked} ${T(L, 'blockiert', 'blocked')} + ${overdue} ${T(L, 'überfällig', 'past due')} = ${td.watch.length}`,
      inputs: [[T(L, 'Blockiert', 'Blocked'), String(blocked)], [T(L, 'Überfällig', 'Past due'), String(overdue)]],
      items: td.watch.map((w) => {
        const i = model.byId.get(w.id);
        const sub = w.blocked
          ? T(L, `blockiert${w.since ? ` seit ${fmt.date(w.since)}` : ''}${w.overdue ? ` · ${w.days} Tage überfällig` : ''}`, `blocked${w.since ? ` since ${fmt.date(w.since)}` : ''}${w.overdue ? ` · ${w.days} days past due` : ''}`)
          : T(L, `${w.days} Tage überfällig`, `${w.days} days past due`);
        return { key: i?.key, text: `${i?.key || ''} ${i?.summary || ''}`.trim(), sub, tone: w.blocked ? 'bad' : 'warn' };
      }), itemsTitle: T(L, 'Work Items', 'Work items'),
      proof: tp.watch },
  ];
}
