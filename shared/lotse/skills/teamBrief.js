// Team briefing: load per quarter against capacity after support, the waterline of the current quarter, people above
// 100 % in the coming weeks, what is blocked or past due.
import { teamDetails, teamIds } from '../../team.js';
import { capacityPeople } from '../../engine.js';
import { computedOf, newStory, addProject, addTeam, kpi, ev, finding, action, follow, done, infoStory, pctPts, r1, T, say, worst, utilTone, teamName } from '../kit.js';
import { plural } from '../narrate.js';
import { splitConflicts } from '../../splitPeople.js';
import { inTeam } from '../../allocation.js';

export function pickTeam(ctx, p) {
  const c = computedOf(ctx);
  const ids = teamIds(c);
  if (p?.team && (ids.includes(p.team) || c.model.teams.has(p.team))) return p.team;
  const mine = ctx.me?.id ? capacityPeople(c.model).get(ctx.me.id)?.teamId : null;
  if (p?.mine && mine) return mine;
  return null;
}
export function busiestTeam(ctx) {
  const c = computedOf(ctx);
  const q0 = c.wl.quarters[0];
  return teamIds(c).map((id) => [id, c.wl.cells[id]?.[q0]?.util ?? 0]).sort((a, b) => (Number.isFinite(b[1]) ? b[1] : 1e9) - (Number.isFinite(a[1]) ? a[1] : 1e9))[0]?.[0] || null;
}

export default {
  id: 'teamBrief',
  title: (L) => T(L, 'Team-Lagebild', 'Team briefing'),
  params: ['team'],
  match: [/\bteam\b.*\b(lage|lagebild|briefing|status|stand|ueberblick|overview|ausgelastet|auslastung|load|busy)\b|\b(lage|briefing|status|auslastung|load)\b.*\bteam\b/, /wie (steht|geht'?s|laeuft) (es )?(dem |im )?team|how is (the )?team|mein team|my team/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const { model, wl } = c;
    const tid = pickTeam(ctx, p) || (p?.any ? busiestTeam(ctx) : null);
    if (!tid) {
      return infoStory(ctx, {
        skill: 'teamBrief', lang: L, headline: T(L, 'Welches Team soll Lotse zusammenfassen?', 'Which team should Lotse sum up?'),
        finding: T(L, 'In der Frage steht kein Team, das Lotse kennt.', 'The question names no team Lotse knows.'),
        followUps: teamIds(c).slice(0, 4).map((id) => follow(teamName(model, id), T(L, `Lagebild Team ${teamName(model, id)}`, `Briefing team ${teamName(model, id)}`))),
      });
    }
    const td = teamDetails(c, tid);
    const s = newStory(ctx, { skill: 'teamBrief', subject: { kind: 'team', ref: tid, name: teamName(model, tid) }, lang: L });
    const F = s.fmt;
    const tn = addTeam(s, model, tid);
    const q0 = wl.quarters[0];
    const cur = td.cells[q0];
    const util = Number.isFinite(cur.util) ? pctPts(cur.util) : null;
    if (util != null) s.kpis.push(kpi('util', T(L, `Auslastung ${F.quarter(q0)}`, `Load ${F.quarter(q0)}`), util, '%', { tone: utilTone(cur.util) }));
    s.kpis.push(kpi('free', T(L, `Frei ${F.quarter(q0)}`, `Free ${F.quarter(q0)}`), cur.free, 'h', { tone: cur.free < 0 ? 'bad' : 'ok' }));
    s.kpis.push(kpi('members', T(L, 'Personen', 'People'), td.members.length, 'n'));
    s.kpis.push(kpi('support', T(L, 'Support je Woche', 'Support per week'), td.supportWeekly, 'h', { tone: 'ink' }));

    const cell = wl.cells[tid]?.[q0];
    const rows = (cell?.rows || []).filter((r) => r.kind === 'project');
    if (rows.length) {
      s.visual = {
        kind: 'waterline',
        data: { unit: 'h', capacity: r1(cell.capacity), support: r1(cell.support), team: tn, quarter: q0, waterRank: cell.waterRank ?? null,
          items: rows.slice(0, 24).map((r) => { const it = model.itemByRef.get(r.ref); addProject(s, it); return { label: it?.name || r.ref, rank: r.rank, ref: r.ref, ...(it?.key ? { key: it.key } : {}), value: r1(r.demand), cum: r1(r.cum), status: r.status }; }) },
        caption: T(L, `Bedarf von Team ${tn} in ${F.quarter(q0)} nach Rang gestapelt, gegen die Kapazität (nach Support-Reserve).`, `Team ${tn}'s demand in ${F.quarter(q0)} stacked by rank against its capacity (after the support reserve).`),
      };
    } else {
      const qs = td.quarters.slice(0, 4);
      s.visual = { kind: 'columns', data: { unit: 'h', labels: qs.map((q) => F.quarter(q)), series: [{ name: T(L, 'Kapazität', 'Capacity'), values: qs.map((q) => r1(td.cells[q].cap)), tone: 'ink' }, { name: T(L, 'Bedarf', 'Demand'), values: qs.map((q) => r1(td.cells[q].demand)), tone: 'warn' }] },
        caption: T(L, `Kapazität und Bedarf von Team ${tn} je Quartal.`, `Capacity and demand of team ${tn} per quarter.`) };
    }

    // findings
    td.quarters.slice(0, 3).forEach((q, qi) => {
      const x = td.cells[q];
      if (!(x.free < -0.5)) return;
      const wc = wl.cells[tid]?.[q];
      const first = wc?.waterRank != null ? model.items.find((it) => it.rank === wc.waterRank) : null;
      if (first) addProject(s, first);
      s.findings.push(finding(first
        ? T(L, `In ${F.quarter(q)} fehlen ${F.h(-x.free)} – ab Rang ${first.rank} (${first.name}) reicht die Kapazität nicht.`, `In ${F.quarter(q)} ${F.h(-x.free)} are missing – from rank ${first.rank} (${first.name}) capacity runs out.`)
        : T(L, `In ${F.quarter(q)} fehlen ${F.h(-x.free)}.`, `In ${F.quarter(q)} ${F.h(-x.free)} are missing.`), 'bad', qi === 0 ? 88 : 70 - qi * 5,
        [ev(T(L, 'Quartal', 'Quarter'), q, 'quarter'), ev(T(L, 'Kapazität', 'Capacity'), x.cap, 'h'), ev(T(L, 'Bedarf', 'Demand'), x.demand, 'h'), ev(T(L, 'Fehlt', 'Missing'), -x.free, 'h'), ...(Number.isFinite(x.util) ? [ev(T(L, 'Auslastung', 'Load'), pctPts(x.util), '%')] : [])]));
    });
    const wk = (c.weeks?.teams || []).find((t) => t.teamId === tid);
    if (wk) {
      const over = wk.members.filter((m) => m.util.some((u) => u > 1.0001 && Number.isFinite(u)));
      if (over.length) {
        const peak = Math.max(...over.flatMap((m) => m.util.filter(Number.isFinite)));
        s.findings.push(finding(T(L, `${over.length} von ${wk.members.length} Personen sind in den nächsten ${wk.plan.length} Wochen zeitweise über 100 % (Spitze ${pctPts(peak)} %).`, `${over.length} of ${wk.members.length} people are above 100% at times in the next ${wk.plan.length} weeks (peak ${pctPts(peak)}%).`), 'warn', 60,
          [ev(T(L, 'über 100 %', 'above 100%'), over.length, 'n'), ev(T(L, 'Personen', 'people'), wk.members.length, 'n'), ev(T(L, 'Wochen', 'weeks'), wk.plan.length, 'n'), ev(T(L, 'Spitze', 'peak'), pctPts(peak), '%'), ev('100 %', 100, '%')]));
      }
    }
    const blocked = td.watch.filter((w) => w.blocked);
    if (blocked.length) {
      const old = blocked.map((w) => (w.since ? model.today - Math.floor(Date.parse(`${w.since}T00:00:00Z`) / 864e5) : null)).filter((x) => x != null);
      const max = old.length ? Math.max(...old) : null;
      s.findings.push(finding(T(L, `${blocked.length} ${plural(blocked.length, 'Aufgabe ist', 'Aufgaben sind')} blockiert${max != null ? `, die älteste seit ${max} Tagen` : ''}.`, `${blocked.length} ${plural(blocked.length, 'task is', 'tasks are')} blocked${max != null ? `, the oldest for ${max} days` : ''}.`), 'bad', 72,
        blocked.slice(0, 4).map((w, i) => ev(T(L, 'blockiert seit Tagen', 'days blocked'), old[i] ?? undefined, old[i] != null ? 'd' : null, { key: model.byId.get(w.id)?.key }))));
    }
    const late = td.watch.filter((w) => w.overdue && !w.blocked);
    if (late.length) {
      const max = Math.max(...late.map((w) => w.days));
      s.findings.push(finding(T(L, `${late.length} ${plural(late.length, 'Aufgabe ist', 'Aufgaben sind')} über dem Due Date, bis zu ${max} Tage.`, `${late.length} ${plural(late.length, 'task is', 'tasks are')} past the due date, by up to ${max} days.`), 'warn', 62,
        [ev(T(L, 'überfällig', 'overdue'), late.length, 'n'), ...late.slice(0, 4).map((w) => ev(T(L, 'Tage überfällig', 'days overdue'), w.days, 'd', { key: model.byId.get(w.id)?.key }))]));
    }
    const sup = (c.support?.teams || []).find((t) => t.teamId === tid);
    if (sup?.spike) s.findings.push(finding(T(L, `Support steigt: zuletzt Ø ${F.h(sup.recentAvg)} je Woche statt ${F.h(sup.avg)}.`, `Support is rising: lately avg ${F.h(sup.recentAvg)} per week instead of ${F.h(sup.avg)}.`), 'warn', 55,
      [ev(T(L, 'zuletzt je Woche', 'lately per week'), sup.recentAvg, 'h'), ev(T(L, 'Ø je Woche', 'avg per week'), sup.avg, 'h')]));
    // people in several teams (2026-11-17): free capacity that another team already uses is no free capacity
    {
      const ids = new Set([...capacityPeople(model).values()].filter((x) => inTeam(x, tid)).map((x) => x.id));
      const ph = ids.size ? splitConflicts(model, c.support, { only: ids }).phantomByTeam[tid] || 0 : 0;
      if (ph > 0.5) s.findings.push(finding(T(L, `${F.h(ph)} der freien Kapazität von ${tn} sind nur scheinbar frei: Personen, die auch für andere Teams arbeiten, sind dort schon verplant.`, `${F.h(ph)} of ${tn}'s free capacity is only seemingly free: people who also work for other teams are already booked there.`), 'warn', 58,
        [ev(T(L, 'scheinbar frei', 'phantom free'), Math.round(ph), 'h', { ref: `team:${tid}` })]));
    }
    if (!s.findings.length) s.findings.push(finding(T(L, `Team ${tn} hat in ${F.quarter(q0)} ${F.h(cur.free)} frei; nichts blockiert oder überfällig.`, `Team ${tn} has ${F.h(cur.free)} free in ${F.quarter(q0)}; nothing blocked or past due.`), 'ok', 10, [ev(T(L, 'Quartal', 'Quarter'), q0, 'quarter'), ev(T(L, 'Frei', 'Free'), cur.free, 'h')]));

    s.tone = worst(...s.findings.map((f) => f.tone));
    const top = [...s.findings].sort((a, b) => b.impact - a.impact)[0];
    s.headline = s.tone === 'ok'
      ? T(L, `Team ${tn} ist in ${F.quarter(q0)} zu ${util ?? 0} % ausgelastet und hat ${F.h(cur.free)} Luft.`, `Team ${tn} is ${util ?? 0}% loaded in ${F.quarter(q0)} with ${F.h(cur.free)} to spare.`)
      : say(s.id, 'h', [T(L, `Team ${tn}: ${top.text}`, `Team ${tn}: ${top.text}`),
        T(L, `Bei Team ${tn} zuerst: ${top.text}`, `Team ${tn}, first: ${top.text}`)]);
    s.actions.push(action('open', T(L, 'Team öffnen', 'Open team'), 'navigate', { view: 'team', teamId: tid }, T(L, `Öffnet die Teamdetails von ${tn}.`, `Opens the team details of ${tn}.`)));
    s.actions.push(action('plan', T(L, 'Wochenplanung', 'Weekly plan'), 'navigate', { view: 'plan', teamId: tid }, T(L, `Öffnet die Wochenplanung von Team ${tn} mit den Optimieren-Vorschlägen.`, `Opens team ${tn}'s weekly plan with the optimize suggestions.`)));
    if (cur.free < 0) s.actions.push(action('whatIfCap', T(L, '+40 h je Woche?', '+40 h per week?'), 'whatIf', { change: { kind: 'teamHours', teamId: tid, weekly: 40 } }, T(L, `Rechnet durch, was 40 h mehr Kapazität je Woche für Team ${tn} an der Wasserlinie ändern – nichts wird gespeichert.`, `Works out what 40 h more capacity per week for team ${tn} changes in the waterline – nothing is saved.`)));
    s.followUps.push(follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')), follow(T(L, 'Planungsvorschläge', 'Planning advice'), T(L, `Planungsvorschläge für Team ${tn}`, `Planning advice for team ${tn}`)),
      follow(T(L, 'Überstunden', 'Overtime'), T(L, `Überstunden Team ${tn}`, `Overtime team ${tn}`)), follow(T(L, 'Realistische Kapazität', 'Real capacity'), T(L, `Realistische Kapazität Team ${tn}`, `Realistic capacity team ${tn}`)));
    s.how = { text: T(L, 'Kapazität = Wochenstunden × 12 Wochen × Projektanteil × (1 − Ausfallquote) minus Support-Reserve; Bedarf = Restschätzung und offene T-Shirt Size der Projekte, nach Rang (Wasserlinie). Personen-Wochen aus der Wochenplanung.', 'Capacity = weekly hours × 12 weeks × project share × (1 − absence rate) minus the support reserve; demand = remaining estimate and open T-shirt size of the projects, by rank (waterline). Person weeks from the weekly planning.'),
      inputs: [[T(L, 'Wochenstunden', 'Weekly hours'), F.h(td.weeklyHours)], [T(L, 'Support je Woche', 'Support per week'), F.h(td.supportWeekly)], [T(L, 'Projekte', 'Projects'), String(td.projects.length)]] };
    s.confidence = td.members.length ? 'high' : 'low';
    s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity'), 'Support'];
    return done(s);
  },
};
