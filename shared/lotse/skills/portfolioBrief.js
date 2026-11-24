// Portfolio briefing (C-level): every active project in rank order with its progress and schedule, then the few
// things a management meeting decides on – late projects, the staffing line, overloaded teams, conflicts, SLA.
import { lc1, computedOf, newStory, addProject, addTeam, kpi, ev, finding, action, follow, done, infoStory, pctPts, sum, T, say, worst, teamName } from '../kit.js';
import { plural, list } from '../narrate.js';
import { teamIds } from '../../team.js';

export default {
  id: 'portfolioBrief',
  title: (L) => T(L, 'Portfolio-Lagebild', 'Portfolio briefing'),
  params: [],
  match: [/\bportfolio\b|alle projekte|all projects|gesamt(lage|bild|ueberblick)|management|c-?level|vorstand|geschaeftsfuehrung|executive|board|big picture|ueberblick ueber alles|overall|insgesamt|im grossen und ganzen|alles in allem/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const { model, metrics, wl, deps, dq, weeks } = c;
    const active = model.items.filter((x) => !metrics.get(x.ref)?.done);
    if (!active.length) return infoStory(ctx, { skill: 'portfolioBrief', lang: L, subject: { kind: 'portfolio', ref: null, name: 'Portfolio' }, headline: T(L, 'Im Portfolio ist noch kein aktives Projekt.', 'There is no active project in the portfolio yet.'), finding: T(L, 'Lotse braucht mindestens ein Projekt im Portfolio.', 'Lotse needs at least one project in the portfolio.') });
    const s = newStory(ctx, { skill: 'portfolioBrief', subject: { kind: 'portfolio', ref: null, name: 'Portfolio' }, lang: L });
    const F = s.fmt;
    const q0 = wl.quarters[0];
    const TS = sum(active, (x) => metrics.get(x.ref).TS), RE = sum(active, (x) => metrics.get(x.ref).RE), OT = sum(active, (x) => metrics.get(x.ref).openTshirt);
    const progress = TS + RE + OT > 0 ? pctPts(TS / (TS + RE + OT)) : 0;
    const conflictsOf = (ref) => deps.list.filter((d) => d.conflict && [d.pre, d.dep].some((id) => model.byId.get(id)?.rootRef === ref)).length;
    const schedule = (x) => { const m = metrics.get(x.ref); return m.daysOverdue > 0 ? 'late' : conflictsOf(x.ref) || Object.values(wl.projectQ[x.ref] || {}).some((v) => v.status !== 'ok') ? 'atRisk' : 'onTrack'; };
    const late = active.filter((x) => metrics.get(x.ref).daysOverdue > 0);
    const teamUtil = (weeks?.teams || []).filter((t) => t.teamId !== '_none' && t.capTotal > 0).map((t) => ({ id: t.teamId, util: t.planTotal / t.capTotal })).sort((a, b) => b.util - a.util);
    const over = teamUtil.filter((t) => t.util > 1.0001);
    s.kpis.push(kpi('active', T(L, 'Aktive Projekte', 'Active projects'), active.length, 'n'));
    s.kpis.push(kpi('progress', T(L, 'Fortschritt gesamt', 'Overall progress'), progress, '%', { tone: 'ink' }));
    s.kpis.push(kpi('late', T(L, 'Projekte im Verzug', 'Projects late'), late.length, 'n', { tone: late.length ? 'bad' : 'ok' }));
    s.kpis.push(kpi('teamsOver', T(L, 'Teams über 100 %', 'Teams above 100%'), over.length, 'n', { tone: over.length ? 'warn' : 'ok' }));
    const TONE = { late: 'bad', atRisk: 'warn', onTrack: 'ok' };
    const SUB = { late: T(L, 'im Verzug', 'late'), atRisk: T(L, 'gefährdet', 'at risk'), onTrack: T(L, 'im Plan', 'on track') };
    s.visual = {
      kind: 'bars',
      data: { unit: '%', max: 100, items: active.slice(0, 24).map((x) => { addProject(s, x); const sc = schedule(x); return { label: x.name, value: pctPts(metrics.get(x.ref).progress), tone: TONE[sc], rank: x.rank, ref: x.ref, ...(x.key ? { key: x.key } : {}), sub: SUB[sc] }; }) },
      caption: T(L, 'Alle aktiven Projekte nach Rang: Fortschritt in Prozent, Farbe = Terminlage (rot im Verzug, gelb gefährdet, grün im Plan).', 'All active projects by rank: progress in percent, colour = schedule (red late, yellow at risk, green on track).'),
    };
    if (late.length) {
      const ls = [...late].sort((a, b) => metrics.get(b.ref).daysOverdue - metrics.get(a.ref).daysOverdue);
      for (const x of ls) addProject(s, x);
      s.findings.push(finding(T(L, `${late.length} ${plural(late.length, 'Projekt ist', 'Projekte sind')} über dem Termin: ${list(ls.map((x) => `${x.name} (${metrics.get(x.ref).daysOverdue} Tage)`), L)}.`, `${late.length} ${plural(late.length, 'project is', 'projects are')} past due: ${list(ls.map((x) => `${x.name} (${metrics.get(x.ref).daysOverdue} days)`), L)}.`), 'bad', 92,
        ls.slice(0, 4).map((x) => ev(T(L, 'Tage über Termin', 'days past due'), metrics.get(x.ref).daysOverdue, 'd', { key: x.key || undefined, ref: x.ref }))));
    }
    // The staffing line per TEAM, exactly as the waterline answer: a project counts here only when one of its real teams
    // cannot staff it, and the hours missing are each short team's demand above its capacity. Work without a team has
    // no capacity to run short of – it is said separately, with its own hours (golden BUG-4).
    const shortTeams = teamIds(c).map((t) => wl.cells[t]?.[q0]).filter(Boolean)
      .filter((x) => x.waterRank != null || x.demand > x.capacity + 0.5).map((x) => ({ ...x, missing: Math.max(0, x.demand - x.capacity) }));
    const teamsOfQ = (x) => wl.projectQ[x.ref]?.[q0]?.teams || [];
    const notStaffed = active.filter((x) => teamsOfQ(x).some((t) => t.teamId !== '_none' && t.status !== 'ok'));
    // work without a team in this quarter: no team's capacity covers it, so it is not in the hours missing at the teams
    const noTeam = active.map((x) => ({ x, d: sum(teamsOfQ(x).filter((t) => t.teamId === '_none'), (t) => t.demand) })).filter((r) => r.d > 0.5);
    const noTeamH = sum(noTeam, (r) => r.d);
    const noTeamEv = noTeam.length ? [ev(T(L, 'Stunden ohne Team', 'Hours without a team'), noTeamH, 'h'), ev(T(L, 'Projekte ohne Team', 'Projects without a team'), noTeam.length, 'n')] : [];
    const noTeamText = (lead) => (lead
      ? T(L, `In ${F.quarter(q0)} sind ${F.h(noTeamH)} Arbeit ohne Team (${noTeam.length} ${plural(noTeam.length, 'Projekt', 'Projekte')}) – dafür ist keine Kapazität eingeplant, bis ein Team zugeordnet ist.`, `In ${F.quarter(q0)}, ${F.h(noTeamH)} of work has no team (${noTeam.length} ${plural(noTeam.length, 'project', 'projects')}) – no capacity is planned for it until a team is assigned.`)
      : T(L, `Dazu kommen ${F.h(noTeamH)} Arbeit ohne Team (${noTeam.length} ${plural(noTeam.length, 'Projekt', 'Projekte')}), für die keine Kapazität eingeplant ist.`, `On top, ${F.h(noTeamH)} of work has no team (${noTeam.length} ${plural(noTeam.length, 'project', 'projects')}) and no capacity planned.`));
    if (notStaffed.length) {
      const ranks = shortTeams.map((x) => x.waterRank).filter((r) => r != null);
      const first = (ranks.length ? model.items.find((it) => it.rank === Math.min(...ranks)) : null) || [...notStaffed].sort((a, b) => a.rank - b.rank)[0];
      const teams = shortTeams.filter((x) => x.missing > 0).sort((a, b) => b.missing - a.missing).map((x) => x.teamId);
      const missing = sum(shortTeams, (x) => x.missing);
      s.findings.push(finding(T(L, `In ${F.quarter(q0)} sind ${notStaffed.length} von ${active.length} Projekten nicht voll besetzbar, ab Rang ${first.rank} (${first.name}); es fehlen ${F.h(missing)}${teams.length ? ` bei ${list(teams.map((t) => addTeam(s, model, t)), L, 8)}` : ''}.`, `In ${F.quarter(q0)} ${notStaffed.length} of ${active.length} projects cannot be fully staffed, from rank ${first.rank} (${first.name}); ${F.h(missing)} are missing${teams.length ? ` in ${list(teams.map((t) => addTeam(s, model, t)), L, 8)}` : ''}.`) + (noTeam.length ? ` ${noTeamText(false)}` : ''), notStaffed.some((x) => teamsOfQ(x).some((t) => t.teamId !== '_none' && t.status === 'no')) ? 'bad' : 'warn', 85,
        [ev(T(L, 'Quartal', 'Quarter'), q0, 'quarter'), ev(T(L, 'nicht voll besetzbar', 'not fully staffable'), notStaffed.length, 'n'), ev(T(L, 'Fehlende Stunden bei Teams', 'Hours missing at teams'), missing, 'h'), ev(T(L, 'erster Engpass (Rang)', 'first bottleneck (rank)'), first.rank, 'n', { ref: first.ref, ...(first.key ? { key: first.key } : {}) }) /* the rank in the sentence is sourced (live E2E 2026-11-25: «from rank 1» unsourced) */, ...noTeamEv]));
    } else if (noTeam.length) s.findings.push(finding(noTeamText(true), 'warn', 64, [ev(T(L, 'Quartal', 'Quarter'), q0, 'quarter'), ...noTeamEv]));
    if (over.length) s.findings.push(finding(T(L, `${over.length} ${plural(over.length, 'Team ist', 'Teams sind')} in den nächsten ${weeks.weeks.length} Wochen über 100 % geplant: ${list(over.map((t) => `${addTeam(s, model, t.id)} ${pctPts(t.util)} %`), L)}.`, `${over.length} ${plural(over.length, 'team is', 'teams are')} planned above 100% in the next ${weeks.weeks.length} weeks: ${list(over.map((t) => `${addTeam(s, model, t.id)} ${pctPts(t.util)}%`), L)}.`), 'warn', 70,
      [...over.slice(0, 4).map((t) => ev(teamName(model, t.id), pctPts(t.util), '%', { ref: `team:${t.id}` })), ev(T(L, 'Wochen', 'weeks'), weeks.weeks.length, 'n'), ev('100 %', 100, '%'), ...(over.length > 3 ? [ev(T(L, 'weitere', 'more'), over.length - 3, 'n')] : [])]));
    if (deps.conflicts) {
      const top = deps.list.filter((d) => d.conflict)[0];
      // either side may live outside the portfolio (live finding 2026-11-12: "der größte: undefined startet …")
      const pre = model.byId.get(top.pre) || model.external.get(top.pre), dep = model.byId.get(top.dep) || model.external.get(top.dep);
      const n = deps.conflicts;
      const head = T(L, `${n} ${plural(n, 'Terminkonflikt', 'Terminkonflikte')} zwischen abhängigen Aufgaben`, `${n} ${plural(n, 'schedule conflict', 'schedule conflicts')} between dependent tasks`);
      const largest = n === 1 ? T(L, '', '') : T(L, ', der größte', ', the largest');
      const detail = dep?.key && pre?.key
        ? T(L, `${largest}: ${dep.key} startet ${top.conflictDays} Tage vor dem Ende von ${pre.key}.`, `${largest}: ${dep.key} starts ${top.conflictDays} days before ${pre.key} ends.`)
        : T(L, `${largest}: ${top.conflictDays} Tage Überschneidung.`, `${largest}: ${top.conflictDays} days of overlap.`);
      s.findings.push(finding(`${head}${detail}`, 'warn', 62,
        [ev(T(L, 'Konflikte', 'Conflicts'), n, 'n'), ev(T(L, 'Tage', 'days'), top.conflictDays, 'd', dep?.key ? { key: dep.key } : {}), ...(pre?.key ? [ev(T(L, 'Vorgänger', 'prerequisite'), undefined, null, { key: pre.key })] : [])]));
    }
    const sa = c.supportSum;
    if (sa?.slaRate != null && sa.target != null && sa.slaRate < sa.target) s.findings.push(finding(T(L, `Die SLA-Quote liegt mit ${pctPts(sa.slaRate)} % unter dem Ziel von ${pctPts(sa.target)} %.`, `The SLA rate of ${pctPts(sa.slaRate)}% is below the ${pctPts(sa.target)}% target.`), 'warn', 50,
      [ev(T(L, 'SLA-Quote', 'SLA rate'), pctPts(sa.slaRate), '%'), ev(T(L, 'Ziel', 'Target'), pctPts(sa.target), '%')]));
    const urgent = dq.gaps.filter((g) => g.urgent).length;
    if (urgent) s.findings.push(finding(T(L, `${urgent} dringende Datenlücken machen Zahlen unsicher (Termin in den nächsten 4 Wochen).`, `${urgent} urgent data gaps make numbers less reliable (date within the next 4 weeks).`), 'info', 30, [ev(T(L, 'dringend', 'urgent'), urgent, 'n'), ev(T(L, 'Wochen', 'weeks'), 4, 'n')]));
    if (!s.findings.length) s.findings.push(finding(T(L, `Alle ${active.length} Projekte sind im Plan und in ${F.quarter(q0)} besetzbar.`, `All ${active.length} projects are on track and staffable in ${F.quarter(q0)}.`), 'ok', 10, [ev(T(L, 'Quartal', 'Quarter'), q0, 'quarter')]));

    s.tone = worst(...s.findings.map((f) => (f.tone === 'info' ? null : f.tone)));
    const top = [...s.findings].sort((a, b) => b.impact - a.impact)[0];
    s.headline = s.tone === 'ok'
      ? T(L, `${active.length} aktive Projekte, ${progress} % Fortschritt – alles im Plan.`, `${active.length} active projects, ${progress}% progress – all on track.`)
      : say(s.id, 'h', [T(L, `${active.length} aktive Projekte, ${progress} % Fortschritt – ${lc1(top.text, s, L)}`, `${active.length} active projects, ${progress}% progress – ${lc1(top.text, s, L)}`),
        T(L, `Portfolio bei ${progress} %: ${top.text}`, `Portfolio at ${progress}%: ${top.text}`)]);
    s.actions.push(action('report', T(L, 'C-Level-Report', 'C-level report'), 'navigate', { view: 'report' }, T(L, 'Öffnet den C-Level-Report mit denselben Zahlen.', 'Opens the C-level report with the same numbers.')));
    s.actions.push(action('waterline', T(L, 'Wasserlinie', 'Waterline'), 'navigate', { view: 'capacity', quarter: q0 }, T(L, `Zeigt die Wasserlinie für ${F.quarter(q0)} je Team.`, `Shows the waterline for ${F.quarter(q0)} per team.`)));
    s.followUps.push(follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')), follow(T(L, 'Wasserlinie', 'Waterline'), T(L, 'Ab welchem Rang reicht die Kapazität nicht?', 'From which rank does capacity run out?')),
      follow(T(L, 'Überstunden', 'Overtime'), T(L, 'Wer macht bald Überstunden?', 'Who is heading for overtime?')), ...(active.length >= 2 ? [follow(T(L, 'Rang 1 und 2 vergleichen', 'Compare rank 1 and 2'), T(L, `Vergleiche ${active[0].name} mit ${active[1].name}`, `Compare ${active[0].name} with ${active[1].name}`))] : []));
    s.how = { text: T(L, 'Fortschritt = gebucht ÷ (gebucht + Rest + offene T-Shirt Size) über alle aktiven Projekte. Verzug = Projekt-Termin überschritten; gefährdet = Terminkonflikt oder ein Quartal nicht voll besetzbar. Team-Auslastung = geplant ÷ Kapazität der nächsten Wochen.', 'Progress = logged ÷ (logged + remaining + open T-shirt size) over all active projects. Late = project due date passed; at risk = a schedule conflict or a quarter not fully staffable. Team load = planned ÷ capacity of the coming weeks.'),
      inputs: [[T(L, 'Gebucht', 'Logged'), F.h(TS)], [T(L, 'Rest', 'Remaining'), F.h(RE)], [T(L, 'Offene T-Shirt Size', 'Open T-shirt size'), F.h(OT)], [T(L, 'Datenqualität', 'Data quality'), F.pct(dq.score)]] };
    s.confidence = dq.score >= 0.8 ? 'high' : dq.score >= 0.5 ? 'medium' : 'low';
    s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity'), T(L, 'Wasserlinie', 'Waterline'), ...(sa ? ['Support'] : [])];
    return done(s);
  },
};
