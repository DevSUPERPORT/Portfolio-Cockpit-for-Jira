// Hover explanations shared by Teamdetails and Capacity: one cell of a heatmap, with its calculation and the work
// items behind it. The numbers come from shared/team.js (the same arithmetic as the capacity engine).
import { personWeek, teamWeekItems } from '@shared/team.js';
import { dayIdx } from '@shared/dates.js';
import { utilTone, noCapacityReason, NO_CAP_TEXT } from '@shared/kpis.js';
import { roundParts } from '@shared/engine.js';
import { tr, fmt, getLang } from './i18n.js';
import { infoCard } from '../components/ui.jsx';

export const toneWord = (u) => (u > 1.0001 ? tr('überbucht', 'overbooked') : u > 0.85 ? tr('fast voll', 'nearly full') : tr('Luft', 'room'));
// Hover cards for the heatmap: every cell explains itself (same arithmetic as the engine – shared/team.js personWeek).
export const h1 = (v) => fmt.h(v, Math.abs(v - Math.round(v)) < 0.05 ? 0 : 1);
export function personWeekCard(computed, w, id, who) {
  const pw = personWeek(computed, id, dayIdx(w.from), dayIdx(w.to));
  if (!pw) return null;
  const u = pw.util;
  const off = [pw.holidays ? tr(`${pw.holidays} Feiertag${pw.holidays > 1 ? 'e' : ''}`, `${pw.holidays} public holiday${pw.holidays > 1 ? 's' : ''}`) : '', pw.absent ? tr(`${pw.absent} Tag${pw.absent > 1 ? 'e' : ''} abwesend`, `${pw.absent} day${pw.absent > 1 ? 's' : ''} absent`) : ''].filter(Boolean).join(', ');
  return infoCard({
    title: `${who} · ${fmt.week(w.from)}`, sub: `${fmt.date(w.from)} – ${fmt.date(w.to)} · ${Number.isFinite(u) ? fmt.pct(u) : '∞'} · ${toneWord(u)}`,
    text: tr('Geplante Stunden dieser Woche über alle Projekte gegen die Zeit, die nach Tagesgeschäft, interner Arbeit und Support für Projekte bleibt.', 'Planned hours this week over all projects against the time left for projects after daily business, internal work and support.'),
    calc: `${h1(pw.weekly)} × ${pw.days}/5 ${tr('Tage', 'days')} = ${h1(pw.gross)}${pw.dPct ? ` − ${h1(pw.daily)} ${tr('Tagesgeschäft', 'daily business')}` : ''}${pw.iPct ? ` − ${h1(pw.internal)} ${tr('intern', 'internal')}` : ''}${pw.support > 0.05 ? ` − ${h1(pw.support)} Support` : ''} = ${h1(pw.cap)} ${tr('verfügbar', 'available')} · ${h1(pw.plan)} ${tr('geplant', 'planned')} ÷ ${h1(pw.cap)} = ${Number.isFinite(u) ? fmt.pct(u) : '∞'}`,
    inputs: [
      [tr('Wochenstunden', 'Weekly hours'), h1(pw.weekly)],
      [tr('Arbeitstage', 'Working days'), `${pw.days} ${tr('von', 'of')} ${pw.all}${off ? ` (${off})` : ''}`],
      [tr('Tagesgeschäft', 'Daily business'), `${pw.dPct} % = ${h1(pw.daily)}`],
      [tr('Intern', 'Internal'), `${pw.iPct} % = ${h1(pw.internal)}`],
      [tr('Support dieser Person (eigene Buchungen auf Support-Tickets)', "This person's support (own logs on support tickets)"), h1(pw.support)],
      [tr('Verfügbar für Projekte', 'Available for projects'), h1(pw.cap)],
      [tr('Geplant', 'Planned'), h1(pw.plan)],
      [pw.cap - pw.plan >= 0 ? tr('Frei', 'Free') : tr('Zu viel', 'Too much'), h1(Math.abs(pw.cap - pw.plan))],
    ],
    items: pw.items.map((x) => ({ text: `${x.key} ${x.summary}`, sub: `${h1(x.h)} ${tr('diese Woche', 'this week')} · ${x.project}${x.overdue ? tr(' · überfällig – wird jetzt eingeplant', ' · past due – planned now') : x.due ? ` · ${tr('Rest', 'remaining')} ${h1(x.re)} ${tr('bis', 'until')} ${fmt.date(x.due)}` : ''}`, tone: x.overdue ? 'warn' : 'ok' })),
    itemsTitle: tr('Geplant in dieser Woche', 'Planned this week'),
    hint: tr('Remaining Estimate jeder Story gleichmäßig auf die Arbeitstage bis zum Due Date verteilt.', 'Each story\'s remaining estimate is spread evenly over the working days up to its due date.'),
  });
}
export function teamWeekCard(computed, w, k, tw, teamName, person) {
  const items = teamWeekItems(computed, tw.teamId, dayIdx(w.from), dayIdx(w.to));
  const plan = tw.plan[k], cap = tw.cap[k], u = cap > 0 ? plan / cap : plan > 0 ? Infinity : 0;
  return infoCard({
    title: `${teamName} · ${fmt.week(w.from)}`, sub: `${fmt.date(w.from)} – ${fmt.date(w.to)} · ${cap > 0 ? toneWord(u) : noCapacityReason(plan, getLang())}`,
    text: tr('Alle Stories mit diesem Team (auch ohne Person) in dieser Woche gegen die Summe der verfügbaren Zeit der Personen im Team.', 'All stories with this team (also unassigned ones) in this week against the summed available time of the team\'s people.'),
    // no capacity: "–" and why, never "∞" (a team without people)
    calc: cap > 0 ? `${h1(plan)} ${tr('geplant', 'planned')} ÷ ${h1(cap)} ${tr('verfügbar', 'available')} = ${fmt.pct(u)}` : `${h1(plan)} ${tr('geplant', 'planned')}, 0 h ${tr('verfügbar', 'available')} – ${noCapacityReason(plan, getLang())}`,
    inputs: [...tw.rows.map((r) => [person(r.id), `${h1(r.plan[k])} / ${h1(r.cap[k])}`]), [tr('Ohne Person', 'Unassigned'), h1(items.filter((x) => !x.assignee).reduce((a, x) => a + x.h, 0))]],
    items: items.map((x) => ({ text: `${x.key} ${x.summary}`, sub: `${h1(x.h)} · ${x.project}${x.assignee ? ` · ${person(x.assignee)}` : tr(' · ohne Person', ' · unassigned')}`, tone: x.assignee ? 'ok' : 'warn' })),
    itemsTitle: tr('Stories des Teams in dieser Woche', 'The team\'s stories this week'),
  });
}
// ---------- waterline (Kapazität › Quartale): the four lines of arithmetic behind one team × quarter ----------
const pctStr = (v) => `${Math.round(v * 100)} %`;
// Capacity line: weekly hours × 12 weeks × project share × (100 % − absence).
export function capacitySteps(p) {
  if (!p) return null;
  const share = `${pctStr(p.share)} ${tr('für Projekte', 'for projects')}`;
  const abs = p.absencePct ? ` × ${pctStr(1 - p.absencePct / 100)} ${tr('ohne Ausfall', 'without absence')}` : '';
  const shareWhy = p.share <= 0.0501 && p.dailyPct + p.internalPct >= 95
    ? tr('mindestens 5 % bleiben immer für Projekte', 'at least 5 % always stay for projects')
    : `100 % − ${p.dailyPct} % ${tr('Tagesgeschäft', 'daily business')} − ${p.internalPct} % ${tr('Intern', 'internal')}`;
  if (!(p.weekly > 0)) return { expr: tr('keine Wochenstunden für dieses Team gepflegt (Kapazitäten bearbeiten)', 'no weekly hours maintained for this team (Edit capacities)'), shareWhy };
  return { expr: `${h1(p.weekly)}/${tr('Woche', 'week')} × ${p.weeks} ${tr('Wochen', 'weeks')} × ${share}${abs}`, shareWhy };
}
// What the waterline panel displays for one cell: rounded rows, running totals, total, capacity, free, utilisation.
export function waterShown(cell) {
  const parts = roundParts(cell.rows.map((r) => r.demand));
  let acc = 0;
  const rows = cell.rows.map((r, i) => { acc += parts[i]; return { ...r, shownDemand: parts[i], shownCum: acc }; });
  const demand = acc;
  const capacity = Math.round(cell.capacity);
  return { rows, demand, capacity, capExact: Math.abs(cell.capacity - capacity) < 0.05, free: capacity - demand, util: capacity > 0 ? demand / capacity : demand > 0 ? Infinity : 0 };
}
const hh = (v) => fmt.h(v);
// The four lines shown above the waterline table and in the cell's hover card – each as expression + result.
export function waterSteps(cell) {
  const cs = capacitySteps(cell.capParts);
  const s = waterShown(cell);
  const terms = s.rows.filter((r) => r.shownDemand > 0).map((r) => (r.kind === 'support' ? `${hh(r.shownDemand)} Support` : `${hh(r.shownDemand)} (#${r.rank})`));
  const shown = terms.length > 6 ? [...terms.slice(0, 5), tr(`… ${terms.length - 5} weitere`, `… ${terms.length - 5} more`)] : terms;
  const ok = s.free >= 0;
  return {
    shown: s, free: s.free, shareWhy: cs?.shareWhy,
    lines: [
      { key: 'cap', label: tr('Kapazität (Wasserlinie)', 'Capacity (waterline)'), expr: cs ? cs.expr : '', result: hh(s.capacity), approx: !s.capExact },
      { key: 'demand', label: tr('Bedarf gesamt', 'Total demand'), expr: shown.join(' + ') || '0 h', result: hh(s.demand) },
      { key: 'free', label: ok ? tr('Frei', 'Free') : tr('Fehlt', 'Missing'), expr: `${hh(s.capacity)} − ${hh(s.demand)}`, result: hh(Math.abs(s.free)), tone: ok ? 'ok' : 'bad' },
      { key: 'util', label: tr('Auslastung', 'Utilization'), expr: s.capacity > 0 ? `${hh(s.demand)} ÷ ${hh(s.capacity)}` : noCapacityReason(s.demand, getLang()), result: s.capacity > 0 ? fmt.pct(s.util) : NO_CAP_TEXT, tone: s.capacity > 0 ? utilTone(s.util) : s.demand > 0.05 ? 'bad' : null },
    ],
  };
}
export function waterCellCard(cell, teamName, personName) {
  const ws = waterSteps(cell);
  const p = cell.capParts;
  return infoCard({
    title: `${teamName} · ${fmt.quarter(cell.q)}`, sub: ws.shown.capacity > 0 ? `${fmt.pct(ws.shown.util)} · ${toneWord(ws.shown.util)}` : `${NO_CAP_TEXT} · ${noCapacityReason(ws.shown.demand, getLang())}`,
    text: tr('Auslastung = gesamter Bedarf im Quartal (Support zuerst, dann die Projekte in Rangfolge) ÷ Kapazität des Teams im Quartal.', 'Utilization = total demand in the quarter (support first, then the projects in rank order) ÷ the team\'s capacity in the quarter.'),
    calc: ws.lines.map((l) => `${l.label}: ${l.expr ? `${l.expr} ${l.approx ? '≈' : '='} ` : ''}${l.result}`).join('\n'),
    items: [
      ...(p?.members || []).map((m) => ({ text: personName(m.id), sub: `${h1(m.weeklyHours)} ${tr('je Woche', 'per week')}`, tone: 'ok' })),
      ...(p?.teamWeekly ? [{ text: tr('Team-Wochenstunden (ohne Personen)', 'Team weekly hours (no people)'), sub: h1(p.teamWeekly), tone: 'ok' }] : []),
      ...(p?.extra ? [{ text: tr('Zusätzliche Stunden ohne Person', 'Extra hours without a person'), sub: h1(p.extra), tone: 'ok' }] : []),
    ],
    itemsTitle: tr('Wochenstunden im Team', 'Weekly hours in the team'),
    hint: p ? `${tr('Projektanteil', 'Project share')} ${pctStr(p.share)} = ${ws.shareWhy}${p.absencePct ? '' : tr(' · Ausfall 0 %', ' · absence 0 %')}` : null,
  });
}

export function quarterCard(td, q, teamName) {
  const c = td.cells[q];
  return infoCard({
    title: `${teamName} · ${fmt.quarter(q)}`, sub: toneWord(c.util),
    text: tr('Projektbedarf des Teams im Quartal (Remaining Estimate + offene T-Shirt Size) gegen die Kapazität nach Support.', 'The team\'s project demand in the quarter (remaining estimate + open T-shirt size) against the capacity after support.'),
    hint: c.support > 0.05 && c.cap > 0 ? tr(`Dieselben Stunden wie in Kapazität › Quartale. Dort zählt Support zum Bedarf (${h1(c.demand + c.support)} ÷ ${h1(c.capacity)} = ${fmt.pct((c.demand + c.support) / c.capacity)}), hier wird er vorher von der Kapazität abgezogen – daher weicht der Prozentwert leicht ab.`, `The same hours as in Capacity › Quarters. There support counts as demand (${h1(c.demand + c.support)} ÷ ${h1(c.capacity)} = ${fmt.pct((c.demand + c.support) / c.capacity)}); here it is taken off the capacity first – so the percentage differs slightly.`) : tr('Dieselben Stunden wie in Kapazität › Quartale.', 'The same hours as in Capacity › Quarters.'),
    calc: c.cap > 0 ? `${h1(c.demand)} ÷ (${h1(c.capacity)} − ${h1(c.support)} Support) = ${fmt.pct(c.util)}` : tr(`${h1(c.demand)} Bedarf, aber keine Kapazität`, `${h1(c.demand)} demand, but no capacity`),
    inputs: [[tr('Kapazität im Quartal', 'Capacity in the quarter'), h1(c.capacity)], ['Support', h1(c.support)], [tr('Nach Support', 'After support'), h1(c.cap)], [tr('Projektbedarf', 'Project demand'), h1(c.demand)], [c.free >= 0 ? tr('Frei', 'Free') : tr('Fehlt', 'Missing'), h1(Math.abs(c.free))]],
    items: td.projects.filter((p) => (p.q[q]?.demand || 0) > 0.5).map((p) => ({ text: `#${p.rank} ${p.name}`, sub: `${h1(p.q[q].demand)}${p.q[q].status !== 'ok' ? tr(' · passt nicht mehr voll', ' · no longer fully fits') : ''}`, tone: p.q[q].status === 'ok' ? 'ok' : p.q[q].status === 'partial' ? 'warn' : 'bad' })),
    itemsTitle: tr('Bedarf je Projekt, in Rangfolge', 'Demand per project, in rank order'),
  });
}

