// C-level report (UC-06): the six key figures and the sections below them, worded once for the screen, the PDF
// and the Confluence page.
//
//   reportExtras(computed, cfg, planActualPayload) – server side, next to cLevelReport: everything the stored
//       snapshot needs on top of the engine's report ("wartet auf …", capacity by rank for all quarters, the next
//       4 weeks as in weekly planning, support trend, plan vs. actual of the last 4 weeks, who may see it).
//       Returns { extra } – merged into the report with Object.assign.
//   reportForViewer(report, roles) – people over 100 % only for viewers who may see individual values (logs 'all').
//   planActualSummary(payload) – the 'planActual.get' payload in four numbers (reuses analyzePlanActual).
//   reportKpis({ report, computed?, planActual?, lang, cfg? }) – tiles, project rows and sections, ready to render.
//       Old snapshots without `extra` still render: missing parts fall back to what the report itself holds
//       (or to `computed`, when given).
//
// Pure: no I/O, no clock reads except the report's own dates.
import { waterlineSentence } from './engine.js';
import { waitsFor, waitsLabel } from './waits.js';
import { buildBoard } from './weekPlan.js';
import { analyzePlanActual, weekNo } from './planActual.js';
import { ROLE_IDS, ROLE_LABEL } from './roles.js';
import { utilTone, noCapacityReason, NO_CAP_TEXT } from './kpis.js';

export const REPORT_WEEKS = 4;
const EPS = 0.01;
const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const r3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);
const sum = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);
const ratio = (load, avail) => (avail > EPS ? load / avail : load > EPS ? Infinity : 0);

// ---------- server: what the snapshot needs on top of cLevelReport ----------
export function reportExtras(computed, cfg = null, planActualPayload = null) {
  const { model, wl, support, supportSum } = computed;
  const c = cfg || model.cfg || {};
  const rules = c.rules || {};
  const teamName = (t) => model.teams.get(t)?.name || t;
  const byName = (a, b) => String(teamName(a)).localeCompare(String(teamName(b)), 'de');

  // "wartet auf …" per project (same as the portfolio rows)
  const waits = {};
  for (const [ref, w] of waitsFor(computed)) {
    waits[ref] = {
      list: w.list.map((e) => ({ ref: e.ref, name: e.name, rank: e.rank, items: e.items, conflicts: e.conflicts, lowerRank: !!e.lowerRank })),
      hot: !!w.hot, items: w.items, conflicts: w.conflicts,
    };
  }

  // capacity by rank: every quarter of the waterline, one sentence per team (both languages: the snapshot is shared)
  const wlTeams = (wl?.teamIds || []).filter((t) => t !== '_none').sort(byName);
  const byQ = {};
  for (const q of wl?.quarters || []) {
    byQ[q] = wlTeams.filter((t) => wl.cells[t]?.[q]).map((t) => {
      const cell = wl.cells[t][q];
      return {
        teamId: t, name: teamName(t), util: cell.util === Infinity ? null : r3(cell.util), capacity: r1(cell.capacity), demand: r1(cell.demand),
        waterRank: cell.waterRank ?? null, s: { de: waterlineSentence(cell, model, 'de'), en: waterlineSentence(cell, model, 'en') },
      };
    });
  }

  // the next 4 weeks exactly as weekly planning shows them (support + tasks against weekly hours minus absence)
  const personLevel = rules.personLevel !== false;
  let util4 = null;
  try {
    const board = buildBoard({ ds: model.ds, computed, weeks: REPORT_WEEKS });
    const teams = board.rows.filter((r) => r.kind === 'team').map((r) => {
      const load = sum(r.cells, (x) => x.load), avail = sum(r.cells, (x) => x.avail);
      return { teamId: r.teamId, name: r.name, load: r1(load), avail: r1(avail), util: r3(ratio(load, avail) === Infinity ? null : ratio(load, avail)), noCap: avail <= EPS && load > EPS, u: r.cells.map((x) => (x.util === Infinity ? null : r3(x.util))) };
    }).filter((t) => t.load > EPS || t.avail > EPS);
    const load = sum(teams, (t) => t.load), avail = sum(teams, (t) => t.avail);
    let persons = null;
    if (personLevel) {
      const by = new Map();
      for (const r of board.rows) {
        if (r.kind !== 'team') continue;
        r.cells.forEach((cell, wi) => {
          for (const m of cell.cards) {
            if (m.kind !== 'member' || m.hidden || !m.accountId) continue;
            const p = by.get(m.accountId) || by.set(m.accountId, { id: m.accountId, name: m.name || '', team: r.name, u: new Array(REPORT_WEEKS).fill(0), over: 0, absentPlanned: false }).get(m.accountId);
            const over = m.util > 1.0001;
            if (over) p.over += 1;
            if (m.util === Infinity) p.absentPlanned = true;
            p.u[wi] = m.util === Infinity ? null : r3(m.util);
          }
        });
      }
      persons = [...by.values()].filter((p) => p.over > 0 && p.name)
        .map((p) => ({ ...p, max: p.absentPlanned ? null : Math.max(...p.u.filter((x) => x != null)) }))
        .sort((a, b) => (b.absentPlanned - a.absentPlanned) || ((b.max ?? 0) - (a.max ?? 0)) || a.name.localeCompare(b.name, 'de'));
    }
    util4 = { weeks: board.weeks.map((w) => w.from), teams, load: r1(load), avail: r1(avail), avg: avail > EPS ? r3(load / avail) : null, persons };
  } catch { util4 = null; } // never let a planning detail break the report

  const rising = (support?.teams || []).filter((t) => t.spike && t.avg > 0 && t.teamId !== '_none').map((t) => teamName(t.teamId)).sort((a, b) => a.localeCompare(b, 'de'));

  return {
    extra: {
      v: 1,
      forecastThresholdPct: Number.isFinite(+rules.forecastThresholdPct) ? +rules.forecastThresholdPct : 10,
      dueWarn: rules.dueDateWarning !== false,
      waits,
      waterline: { quarters: wl?.quarters || [], byQ },
      util4,
      support: { target: supportSum?.target ?? support?.slaTarget ?? null, rising },
      planActual: planActualPayload ? planActualSummary(planActualPayload) : null,
      audience: audienceOf(c.roles),
    },
  };
}

// Who may open the report: every role whose rights hold the "C-level report" tab, with its Jira groups; Jira
// admins always.
export function audienceOf(roles) {
  const rights = roles?.rights || null;
  const out = [];
  for (const role of ROLE_IDS) {
    const has = rights ? (rights[role] || []).includes('report') : role === 'management';
    if (!has) continue;
    out.push({ role, groups: role === 'employee' ? [] : (roles?.groups?.[role] || []).map((g) => g?.name || g?.id).filter(Boolean).slice(0, 8) });
  }
  out.push({ role: 'jiraAdmin', groups: [] });
  return out;
}

// The plan vs. actual payload in a few numbers: share as planned, hours diverted and where they went.
export function planActualSummary(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.state !== 'ready') return { state: payload.state || 'none', firstWeek: payload.firstWeek || null };
  const a = analyzePlanActual(payload, { lang: 'de', team: 'all' });
  const flows = { sup: 0, other: 0, intern: 0, abs: a.kpis.absU || 0 };
  for (const r of a.rows) {
    const d = r.book - r.plan;
    if (d <= EPS) continue;
    if (r.kind === 'support') flows.sup += d; else if (r.kind === 'internal') flows.intern += d; else flows.other += d;
  }
  return {
    state: 'ready', weeks: (payload.weeks || []).map((w) => w.key), provisional: a.provisional,
    plan: r1(a.kpis.plan), book: r1(a.kpis.book), asPlanned: r1(a.kpis.asPlanned), asPlannedPct: r3(a.kpis.asPlannedPct),
    diverted: r1(flows.sup + flows.other + flows.intern), flows: { sup: r1(flows.sup), other: r1(flows.other), intern: r1(flows.intern), abs: r1(flows.abs) },
  };
}

// Individual values (people over 100 %) only for viewers with "individual values: all teams".
export function reportForViewer(report, roles) {
  const u = report?.extra?.util4;
  if (!u || !u.persons) return report;
  if (roles?.logs === 'all') return report;
  return { ...report, extra: { ...report.extra, util4: { ...u, persons: null } } };
}

// ---------- wording ----------
const loc = (L) => (L === 'en' ? 'en-GB' : 'de-DE');
export function reportFormat(lang = 'de') {
  const L = lang === 'en' ? 'en' : 'de';
  const nf = new Intl.NumberFormat(loc(L), { maximumFractionDigits: 0 });
  const T = (de, en) => (L === 'de' ? de : en);
  const n = (v) => (v == null || !Number.isFinite(v) ? '–' : nf.format(Math.round(v)));
  const pct = (v) => (v == null || !Number.isFinite(v) ? '–' : L === 'de' ? `${nf.format(Math.round(v * 100))} %` : `${nf.format(Math.round(v * 100))}%`);
  const signedPct = (v) => (v == null || !Number.isFinite(v) ? '–' : `${v > 0.005 ? '+' : v < -0.005 ? '−' : '±'}${pct(Math.abs(v))}`);
  const h = (v) => (v == null || !Number.isFinite(v) ? '–' : `${nf.format(Math.round(v))} h`);
  const quarter = (q) => (q ? `Q${String(q).slice(-1)} ${String(q).slice(0, 4)}` : '–');
  const plural = (k, one, many) => `${n(k)} ${k === 1 ? one : many}`;
  return { L, T, n, pct, signedPct, h, quarter, plural };
}

// ---------- the report, ready to render ----------
export function reportKpis({ report, computed = null, planActual = null, lang = 'de', cfg = null } = {}) {
  const F = reportFormat(lang);
  const { T, n, pct, signedPct, h, quarter, plural } = F;
  const r = report || {};
  const k = r.kpis || {};
  const rows0 = r.rows || [];
  const x = r.extra || (computed ? reportExtras(computed, cfg, planActual).extra : {});
  const thrPct = x.forecastThresholdPct ?? cfg?.rules?.forecastThresholdPct ?? 10;
  const thr = thrPct / 100;
  const dueWarn = x.dueWarn ?? cfg?.rules?.dueDateWarning !== false;
  const today = r.today || String(r.asOf || '').slice(0, 10);

  // ---- project rows ----
  const rows = rows0.map((p) => {
    const open = (p.RE || 0) + (p.openTshirt || 0);
    const prog = p.OE > 0 && Number.isFinite(p.forecast) ? p.forecast / p.OE - 1 : null;
    const overrun = prog != null && prog > thr;
    const w = x.waits?.[p.ref] || null;
    let term;
    if (dueWarn && p.daysOverdue > 0) term = { tone: 'bad', text: T(`Projekt +${n(p.daysOverdue)} Tage über Due${p.overdueCount ? ` · ${n(p.overdueCount)} Vorg.` : ''}`, `Project +${n(p.daysOverdue)} days past due${p.overdueCount ? ` · ${n(p.overdueCount)} items` : ''}`) };
    else if (dueWarn && p.overdueCount > 0) term = { tone: 'soft', text: T(`${plural(p.overdueCount, 'Vorgang', 'Vorgänge')} über Due`, `${plural(p.overdueCount, 'item', 'items')} past due`) };
    else if (p.schedule === 'atRisk') term = { tone: 'warn', text: p.conflicts > 0 ? T('Gefährdet · Terminkonflikt', 'At risk · date conflict') : T('Gefährdet · Kapazität', 'At risk · capacity') };
    else term = { tone: 'ok', text: T('Im Plan', 'On track') };
    return {
      ...p, open, prog, progText: prog == null ? '–' : signedPct(prog), overrun,
      waitText: w ? waitsLabel(w, T) : '', waitHot: !!w?.hot, term,
      progressSub: T(`${h(p.TS)} Time Spent · ${h(open)} offen`, `${h(p.TS)} time spent · ${h(open)} open`),
    };
  });
  const started = (p) => (p.TS || 0) > EPS || (p.start && p.start <= today);
  const running = rows.filter(started), planned = rows.filter((p) => !started(p));
  const crit = rows.filter((p) => p.health === 'critical'), risk = rows.filter((p) => p.health === 'atRisk'), noHealth = rows.filter((p) => !p.health);
  const overrun = rows.filter((p) => p.overrun);
  const lateProjects = rows.filter((p) => p.daysOverdue > 0);
  const label = (p) => `#${p.rank} ${p.name}`;

  // ---- 4 weeks ----
  const util4 = utilFour(r, x, F);

  // ---- plan vs. actual ----
  let pa = x.planActual || null;
  if ((!pa || pa.state !== 'ready') && planActual) pa = planActualSummary(planActual) || pa;
  const flows = flowsOf(pa, F);

  // ---- support ----
  const sup = r.support || null;
  const target = x.support?.target ?? sup?.target ?? null;
  const rising = x.support?.rising || [];
  const hasSupport = Number.isFinite(k.slaRate) || Number.isFinite(k.supportShare);

  // ---- totals ----
  const TS = sum(rows, (p) => p.TS), RE = sum(rows, (p) => p.RE), OT = sum(rows, (p) => p.openTshirt);
  const progress = k.progress ?? (TS + RE + OT > 0 ? TS / (TS + RE + OT) : 0);

  const tiles = [
    {
      id: 'projects', label: T('Projekte', 'Projects'), kind: 'count', value: rows.length, display: n(rows.length),
      sub: T(`${n(running.length)} laufend · ${n(planned.length)} geplant · Health ${n(crit.length)} kritisch, ${n(risk.length)} gefährdet`, `${n(running.length)} running · ${n(planned.length)} planned · health ${n(crit.length)} critical, ${n(risk.length)} at risk`),
      tone: crit.length || risk.length ? 'warn' : null,
      explain: {
        text: T('Alle aktiven Projekte im Portfolio. Laufend = schon Zeit gebucht oder Start erreicht; geplant = noch nicht begonnen. Health ist die Einschätzung der Owner.', 'All active projects in the portfolio. Running = time already logged or start date reached; planned = not started yet. Health is the owners\' judgement.'),
        calc: T(`${n(running.length)} laufend + ${n(planned.length)} geplant = ${n(rows.length)}`, `${n(running.length)} running + ${n(planned.length)} planned = ${n(rows.length)}`),
        inputs: [[T('Kritisch', 'Critical'), n(crit.length)], [T('Gefährdet', 'At risk'), n(risk.length)], [T('Im Plan', 'On track'), n(rows.length - crit.length - risk.length - noHealth.length)], [T('Ohne Health-Update', 'No health update'), n(noHealth.length)]],
        items: [...crit, ...risk].map((p) => ({ text: label(p), sub: p.health === 'critical' ? T('kritisch', 'critical') : T('gefährdet', 'at risk'), tone: p.health === 'critical' ? 'bad' : 'warn' })),
        itemsTitle: T('Kritisch oder gefährdet', 'Critical or at risk'),
      },
    },
    {
      id: 'progress', label: T('Fortschritt', 'Progress'), kind: 'pct', value: progress, display: pct(progress),
      sub: `${T(`${h(TS)} Time Spent · ${h(RE + OT)} offen`, `${h(TS)} time spent · ${h(RE + OT)} open`)}${overrun.length ? T(` · ${n(overrun.length)} mit Mehraufwand`, ` · ${n(overrun.length)} with extra effort`) : ''}`,
      tone: null,
      explain: {
        text: T(`Time Spent ÷ (Time Spent + Remaining Estimate + offene T-Shirt Size) über alle aktiven Projekte – dieselbe Rechnung wie im Portfolio. Mehraufwand: Prognose (Time Spent + Remaining) liegt mehr als ${n(thrPct)} % über dem Original Estimate.`, `Time spent ÷ (time spent + remaining estimate + open T-shirt size) over all active projects – the same calculation as the portfolio. Extra effort: the forecast (time spent + remaining) is more than ${n(thrPct)}% above the original estimate.`),
        calc: `${h(TS)} ÷ (${h(TS)} + ${h(RE)} + ${h(OT)}) = ${pct(progress)}`,
        inputs: [['Time Spent', h(TS)], ['Remaining Estimate', h(RE)], [T('Offene T-Shirt Size', 'Open T-shirt size'), h(OT)]],
        items: overrun.map((p) => ({ text: label(p), sub: T(`Prognose ${h(p.forecast)} gegen ${h(p.OE)} Original Estimate (${p.progText})`, `forecast ${h(p.forecast)} against ${h(p.OE)} original estimate (${p.progText})`), tone: 'warn' })),
        itemsTitle: T('Mit Mehraufwand', 'With extra effort'),
      },
    },
    {
      id: 'schedule', label: T('Termintreue', 'Schedule'), kind: 'count', value: k.issuesOverdue ?? sum(rows, (p) => p.overdueCount), display: n(k.issuesOverdue ?? sum(rows, (p) => p.overdueCount)),
      sub: T(`Vorgänge über Due Date · ${n(lateProjects.length)} ${lateProjects.length === 1 ? 'Projekt' : 'Projekte'} über Termin`, `items past due date · ${n(lateProjects.length)} ${lateProjects.length === 1 ? 'project' : 'projects'} past due`), // real plural (E2E 2026-11-20)
      tone: dueWarn && ((k.issuesOverdue || 0) > 0 || lateProjects.length) ? 'bad' : null,
      explain: {
        text: T('Offene Vorgänge, deren Due Date vorbei ist, und Projekte, deren eigenes Due Date überschritten ist – mit Tagen Verzug.', 'Open items whose due date has passed, and projects past their own due date – with days overdue.'),
        inputs: [[T('Vorgänge über Due Date', 'Items past due date'), n(k.issuesOverdue ?? sum(rows, (p) => p.overdueCount))], [T('Projekte über Termin', 'Projects past due'), n(lateProjects.length)]],
        items: [...lateProjects].sort((a, b) => b.daysOverdue - a.daysOverdue).map((p) => ({ text: label(p), sub: T(`+${n(p.daysOverdue)} Tage über Due Date`, `+${n(p.daysOverdue)} days past due`), tone: 'bad' })),
        itemsTitle: T('Projekte über Termin', 'Projects past due'),
      },
    },
    {
      id: 'util', label: T('Auslastung', 'Utilisation'), kind: 'pct', value: util4.avg, display: pct(util4.avg),
      sub: `${util4.weeksText} · ${util4.personLevel ? T(`${plural(util4.persons.length, 'Person', 'Personen')} über 100 %`, `${plural(util4.persons.length, 'person', 'people')} over 100%`) : T(`${plural(util4.teamsOver.length, 'Team', 'Teams')} über 100 %`, `${plural(util4.teamsOver.length, 'team', 'teams')} over 100%`)}`,
      tone: utilTone(util4.avg) === 'ok' ? null : utilTone(util4.avg),
      explain: {
        text: util4.basis === 'board'
          ? T('Wie in der Wochenplanung: Support und Tasks gegen die Wochenstunden abzüglich Urlaub, Feiertagen und Tagesgeschäft – alle Teams zusammen. Bis 85 % Luft, bis 100 % fast voll, darüber überbucht.', 'As in weekly planning: support and tasks against weekly hours minus vacation, public holidays and daily business – all teams together. Up to 85% room, up to 100% nearly full, above that overbooked.')
          : T('Geplante Stunden aller Teams gegen ihre verfügbare Zeit (aus dem täglichen Report-Stand).', 'Planned hours of all teams against their available time (from the daily report snapshot).'),
        calc: util4.load != null ? `${h(util4.load)} ÷ ${h(util4.avail)} = ${pct(util4.avg)}` : pct(util4.avg),
        inputs: util4.teams.map((t) => [t.name, pct(t.util)]),
        items: util4.personLevel
          ? util4.persons.map((p) => ({ text: `${p.name} · ${p.team}`, sub: p.weeksText, tone: 'bad' }))
          : util4.teamsOver.map((t) => ({ text: t.name, sub: pct(t.util), tone: 'bad' })),
        itemsTitle: util4.personLevel ? T('Personen über 100 %', 'People over 100%') : T('Teams über 100 %', 'Teams over 100%'),
      },
    },
    {
      id: 'asPlanned', label: T('Wie geplant', 'As planned'), kind: flows.ready ? 'pct' : 'text', value: flows.ready ? pa.asPlannedPct : null,
      display: flows.ready ? pct(pa.asPlannedPct) : T('ab dem ersten Wochen-Snapshot', 'from the first weekly snapshot'),
      sub: flows.ready ? T(`letzte 4 Wochen · ${h(pa.diverted)} umgeleitet`, `last 4 weeks · ${h(pa.diverted)} diverted`) : T('Plan vs. Ist braucht eine abgeschlossene Woche', 'plan vs. actual needs one completed week'),
      tone: flows.ready && pa.asPlannedPct != null && pa.asPlannedPct < 0.9 ? 'bad' : null,
      explain: {
        text: T('Aus „Plan vs. Ist“: Anteil der geplanten Stunden der letzten 4 Wochen, die auch dort gebucht wurden, wo der Wochen-Snapshot sie geplant hatte. Umgeleitet = Stunden, die stattdessen in Support über der Reserve, andere Projekte oder interne Arbeit flossen.', 'From "Plan vs. actual": share of the planned hours of the last 4 weeks that were booked where the weekly snapshot had planned them. Diverted = hours that went into support above the reserve, other projects or internal work instead.'),
        calc: flows.ready ? `${h(pa.asPlanned)} ÷ ${h(pa.plan)} = ${pct(pa.asPlannedPct)}` : null,
        inputs: flows.ready ? [[T('Geplant', 'Planned'), h(pa.plan)], [T('Gebucht', 'Booked'), h(pa.book)], [T('Wie geplant', 'As planned'), h(pa.asPlanned)], ...flows.rows.map((f) => [f.label, h(f.h)])] : [],
        hint: flows.ready ? null : T('Sobald der erste Wochen-Snapshot eine abgeschlossene Woche hat, steht hier die Zahl.', 'As soon as the first weekly snapshot has a completed week, the number appears here.'),
      },
    },
    {
      id: 'support', label: 'Support', kind: hasSupport ? 'pct' : 'text', value: k.slaRate ?? null, display: k.slaRate == null ? '–' : pct(k.slaRate),
      sub: !hasSupport ? T('kein Support konfiguriert', 'no support configured')
        : [`SLA${target != null ? T(` (Ziel ${pct(target)})`, ` (target ${pct(target)})`) : ''}`, Number.isFinite(k.supportShare) ? T(`${pct(k.supportShare)} der Kapazität`, `${pct(k.supportShare)} of capacity`) : null, rising.length ? T(`steigt bei ${rising.join(', ')}`, `rising in ${rising.join(', ')}`) : null].filter(Boolean).join(' · '),
      tone: k.slaRate != null && target != null && k.slaRate < target ? 'bad' : null,
      explain: {
        text: T('SLA-Quote: Anteil der Support-Tickets innerhalb ihrer SLA-Zeit. Anteil der Kapazität: die Teamzeit, die der Support vor allen Projekten bekommt. „Steigt“: Teams, deren Support-Zeit der letzten 2 Wochen mehr als 20 % über dem Durchschnitt liegt.', 'SLA rate: share of support tickets within their SLA time. Share of capacity: the team time support gets before any project. "Rising": teams whose support time of the last 2 weeks is more than 20% above average.'),
        inputs: hasSupport ? [[T('SLA-Quote', 'SLA rate'), pct(k.slaRate)], [T('Ziel', 'Target'), pct(target)], [T('Anteil der Kapazität', 'Share of capacity'), pct(k.supportShare)], ...(sup?.breaches != null ? [[T('Offen über dem SLA', 'Open past SLA'), n(sup.breaches)]] : [])] : [],
        items: rising.map((t) => ({ text: t, sub: T('Support-Zeit steigt', 'support time rising'), tone: 'warn' })),
        itemsTitle: T('Steigend', 'Rising'),
      },
    },
  ];

  return {
    lang: F.L, tiles, rows, waterline: waterlineOf(r, x, F), util4, flows,
    header: {
      asOf: r.asOf || null,
      audience: audienceText(x.audience || audienceOf(null), F),
    },
    progressFormula: T('Fortschritt = Time Spent ÷ (Time Spent + Remaining Estimate + offene T-Shirt Size)', 'Progress = time spent ÷ (time spent + remaining estimate + open T-shirt size)'),
    thresholdPct: thrPct,
  };
}

function audienceText(list, F) {
  const { T, L } = F;
  const part = (a) => {
    const name = a.role === 'employee' ? T('alle Mitarbeiter', 'all employees') : a.role === 'jiraAdmin' ? T('Jira-Admins', 'Jira admins') : (ROLE_LABEL[a.role] || [a.role, a.role])[L === 'de' ? 0 : 1];
    return a.groups?.length ? `${name} (${a.groups.join(', ')})` : name;
  };
  return (list || []).map(part).join(', ');
}

function utilFour(r, x, F) {
  const { T, pct, plural } = F;
  const u = x.util4;
  const weekLabel = (iso) => { const wk = isoWeekNo(iso); return T(`KW ${wk}`, `W ${wk}`); };
  if (u) {
    // no capacity: "–" and the reason, never "∞"
    const teams = u.teams.map((t) => ({ ...t, utilText: t.noCap ? NO_CAP_TEXT : pct(t.util), reason: t.noCap ? noCapacityReason(t.load, F.L) : null, tone: t.noCap ? 'bad' : utilTone(t.util) }));
    const persons = Array.isArray(u.persons) ? u.persons.map((p) => ({
      ...p, maxText: p.absentPlanned || p.max == null ? T('abwesend, eingeplant', 'absent, planned') : pct(p.max),
      weeksText: `${plural(p.over, T('Woche', 'week'), T('Wochen', 'weeks'))} ${T('über 100 %', 'over 100%')}`,
    })) : null;
    const wk = u.weeks || [];
    return {
      basis: 'board', weeks: wk, weekLabels: wk.map(weekLabel),
      weeksText: wk.length ? T(`nächste 4 Wochen (${weekLabel(wk[0])}–${isoWeekNo(wk.at(-1))})`, `next 4 weeks (${weekLabel(wk[0])}–${isoWeekNo(wk.at(-1))})`) : T('nächste 4 Wochen', 'next 4 weeks'),
      teams, avg: u.avg, load: u.load, avail: u.avail, teamsOver: teams.filter((t) => t.noCap || (t.util ?? 0) > 1.0001),
      personLevel: !!persons, persons: persons || [],
    };
  }
  // older snapshots: the first 4 of the 8 engine weeks (capacity-weighted with the 8-week capacity)
  const wk = (r.weeks || []).slice(0, REPORT_WEEKS);
  const teams = (r.teamWeeks || []).map((t) => {
    const us = (t.util || []).slice(0, REPORT_WEEKS).filter((v) => v != null && Number.isFinite(v));
    const util = us.length ? us.reduce((a, v) => a + v, 0) / us.length : null;
    return { name: t.name, util, cap: t.cap || 0, u: (t.util || []).slice(0, REPORT_WEEKS), utilText: pct(util), tone: utilTone(util) };
  }).filter((t) => t.util != null).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const capT = sum(teams, (t) => t.cap);
  const avg = teams.length ? (capT > 0 ? sum(teams, (t) => t.util * t.cap) / capT : sum(teams, (t) => t.util) / teams.length) : (r.kpis?.avgUtil ?? null);
  return {
    basis: 'report', weeks: wk, weekLabels: wk.map(weekLabel), weeksText: T('nächste 4 Wochen', 'next 4 weeks'),
    teams, avg, load: null, avail: null, teamsOver: teams.filter((t) => t.util > 1.0001), personLevel: false, persons: [],
  };
}

function isoWeekNo(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '–';
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

function flowsOf(pa, F) {
  const { T } = F;
  if (!pa || pa.state !== 'ready') {
    return {
      ready: false, state: pa?.state || 'none', rows: [], max: 1,
      note: T('Hier steht ab dem ersten Wochen-Snapshot, wohin die geplante Zeit tatsächlich geflossen ist – Support über der Reserve, andere Projekte, interne Arbeit oder ungeplante Abwesenheit.', 'From the first weekly snapshot on, this shows where the planned time actually went – support above the reserve, other projects, internal work or unplanned absence.'),
    };
  }
  const f = pa.flows || {};
  const rows = [
    { id: 'sup', label: T('Support über Reserve', 'Support above reserve'), h: f.sup || 0 },
    { id: 'other', label: T('Andere Projekte', 'Other projects'), h: f.other || 0 },
    { id: 'intern', label: T('Intern ohne Projekt', 'Internal without project'), h: f.intern || 0 },
    { id: 'abs', label: T('Ungeplant abwesend', 'Unplanned absence'), h: f.abs || 0 },
  ].filter((x) => x.h > 0.5);
  const wk = pa.weeks || [];
  const period = wk.length ? (wk.length === 1 ? T(`KW ${weekNo(wk[0])}`, `W ${weekNo(wk[0])}`) : T(`KW ${weekNo(wk[0])}–${weekNo(wk.at(-1))}`, `W ${weekNo(wk[0])}–${weekNo(wk.at(-1))}`)) : '';
  return {
    ready: true, state: 'ready', rows, max: Math.max(1, ...rows.map((x) => x.h)), period,
    provisional: (pa.provisional || []).length > 0,
    note: rows.length ? T('Geplant laut Wochen-Snapshot gegen gebuchte Stunden aller Teams – erklärt, warum sich Projekte verschieben.', 'Planned per weekly snapshot against booked hours of all teams – explains why projects slip.')
      : T('Die Zeit floss wie geplant – nichts Nennenswertes umgeleitet.', 'Time went as planned – nothing worth mentioning was diverted.'),
  };
}

function waterlineOf(r, x, F) {
  const { T, pct, h, quarter, n } = F;
  const mk = (q, list) => {
    // a team without capacity: "–" and the reason in front of the sentence (never "∞")
    const teams = list.map((t) => {
      const noCap = t.util == null || !(t.capacity > 0);
      const reason = noCap ? noCapacityReason(t.demand || 0, F.L) : null;
      const s = t.s?.[F.L] || t.s?.de || '';
      return { ...t, noCap, reason, utilText: noCap ? NO_CAP_TEXT : pct(t.util), tone: noCap ? ((t.demand || 0) > 0.05 ? 'bad' : null) : utilTone(t.util), short: t.waterRank != null,
        sentence: noCap ? `${reason.charAt(0).toUpperCase()}${reason.slice(1)}${s ? ` – ${s}` : '.'}` : s };
    });
    const short = teams.filter((t) => t.short).length;
    return {
      q, label: quarter(q), teams,
      headline: short ? T(`${n(short)} ${short === 1 ? 'Team kann' : 'Teams können'} in ${quarter(q)} nicht alle Ränge besetzen.`, `${n(short)} ${short === 1 ? 'team cannot' : 'teams cannot'} staff all ranks in ${quarter(q)}.`)
        : T(`In ${quarter(q)} können alle Teams alle Projekte besetzen.`, `In ${quarter(q)} every team can staff every project.`),
    };
  };
  const wl = x.waterline;
  if (wl?.quarters?.length) {
    const quarters = wl.quarters.filter((q) => (wl.byQ?.[q] || []).length);
    return { quarters, defaultQ: quarters.includes(wl.quarters[1]) ? wl.quarters[1] : quarters[0] || null, byQ: Object.fromEntries(quarters.map((q) => [q, mk(q, wl.byQ[q])])) };
  }
  const nq = r.waterlineNextQ;
  if (!nq?.quarter) return { quarters: [], defaultQ: null, byQ: {} };
  const list = [...(nq.teams || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'de')).map((t) => ({
    ...t, s: { [F.L]: t.waterRank != null
      ? T(`Ab Rang ${t.waterRank} nicht voll besetzbar (${h(t.demand)} Bedarf, ${h(t.capacity)} Kapazität).`, `Not fully staffable from rank ${t.waterRank} (${h(t.demand)} demand, ${h(t.capacity)} capacity).`)
      : T(`Alle Projekte sind besetzbar; Auslastung ${pct(t.util)}.`, `All projects can be staffed; utilization ${pct(t.util)}.`) },
  }));
  return { quarters: [nq.quarter], defaultQ: nq.quarter, byQ: { [nq.quarter]: mk(nq.quarter, list) } };
}
