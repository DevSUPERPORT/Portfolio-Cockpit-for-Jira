// Compare two projects or two teams side by side, with the same numbers as their briefings.
import { dayIdx } from '../../dates.js';
import { teamDetails } from '../../team.js';
import { computedOf, newStory, addProject, addTeam, ev, finding, action, follow, done, infoStory, pctPts, r1, T, say, teamName } from '../kit.js';

function projectRows(c, it, L) {
  const m = c.metrics.get(it.ref);
  return [
    { id: 'progress', label: T(L, 'Fortschritt', 'Progress'), unit: '%', v: pctPts(m.progress), better: 'higher' },
    { id: 'forecast', label: T(L, 'Prognose', 'Forecast'), unit: 'h', v: r1(m.forecast) },
    { id: 'remaining', label: T(L, 'Restschätzung', 'Remaining'), unit: 'h', v: r1(m.RE) },
    { id: 'overdue', label: T(L, 'Stories überfällig', 'Stories overdue'), unit: 'n', v: m.overdueCount, better: 'lower' },
    { id: 'daysLeft', label: T(L, 'Tage bis Termin', 'Days to due date'), unit: 'd', v: m.due ? dayIdx(m.due) - c.model.today : null, better: 'higher' },
    { id: 'maturity', label: T(L, 'Reife', 'Maturity'), unit: '%', v: m.maturity == null ? null : pctPts(m.maturity), better: 'higher' },
    { id: 'rank', label: T(L, 'Rang', 'Rank'), unit: 'n', v: it.rank },
  ];
}
function teamRows(c, id, L) {
  const td = teamDetails(c, id);
  const cur = td.cells[c.wl.quarters[0]];
  return [
    { id: 'util', label: T(L, 'Auslastung', 'Load'), unit: '%', v: Number.isFinite(cur.util) ? pctPts(cur.util) : null, better: 'lower' },
    { id: 'free', label: T(L, 'Frei im Quartal', 'Free this quarter'), unit: 'h', v: r1(cur.free), better: 'higher' },
    { id: 'members', label: T(L, 'Personen', 'People'), unit: 'n', v: td.members.length },
    { id: 'support', label: T(L, 'Support je Woche', 'Support per week'), unit: 'h', v: r1(td.supportWeekly), better: 'lower' },
    { id: 'projects', label: T(L, 'Projekte', 'Projects'), unit: 'n', v: td.projects.length },
    { id: 'blocked', label: T(L, 'Blockiert', 'Blocked'), unit: 'n', v: td.watch.filter((w) => w.blocked).length, better: 'lower' },
    { id: 'late', label: T(L, 'Überfällig', 'Past due'), unit: 'n', v: td.watch.filter((w) => w.overdue).length, better: 'lower' },
  ];
}

export default {
  id: 'compare',
  title: (L) => T(L, 'Vergleich', 'Comparison'),
  params: ['refs', 'teams'],
  match: [/vergleich|compare|gegenueber|versus|\bvs\.?\b|im vergleich|side by side|nebeneinander|unterschied zwischen|difference between/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const { model } = c;
    const refs = (p?.refs || []).filter((r) => model.itemByRef.has(r)).slice(0, 2);
    const teams = (p?.teams || []).filter((t) => model.teams.has(t)).slice(0, 2);
    const isP = refs.length === 2;
    const tn = [...model.teams.values()].slice(0, 2).map((t) => t.name);
    if (!isP && teams.length !== 2) return infoStory(ctx, { skill: 'compare', lang: L, headline: T(L, 'Was soll Lotse vergleichen?', 'What should Lotse compare?'), finding: T(L, 'Nenne zwei Projekte oder zwei Teams.', 'Name two projects or two teams.'),
      followUps: [...(model.items.length >= 2 ? [follow(T(L, 'Rang 1 und 2', 'Rank 1 and 2'), T(L, `Vergleiche ${model.items[0].name} mit ${model.items[1].name}`, `Compare ${model.items[0].name} with ${model.items[1].name}`))] : []),
        ...(tn.length === 2 ? [follow(`${tn[0]} / ${tn[1]}`, T(L, `Vergleiche Team ${tn[0]} mit Team ${tn[1]}`, `Compare team ${tn[0]} with team ${tn[1]}`))] : [])] });
    const A = isP ? model.itemByRef.get(refs[0]) : teams[0], B = isP ? model.itemByRef.get(refs[1]) : teams[1];
    const nameA = isP ? A.name : teamName(model, A), nameB = isP ? B.name : teamName(model, B);
    const s = newStory(ctx, { skill: 'compare', subject: isP ? { kind: 'project', ref: `${A.ref}|${B.ref}`, name: `${nameA} / ${nameB}` } : { kind: 'team', ref: `${A}|${B}`, name: `${nameA} / ${nameB}` }, lang: L });
    const F = s.fmt;
    if (isP) { addProject(s, A); addProject(s, B); } else { addTeam(s, model, A); addTeam(s, model, B); }
    const ra = isP ? projectRows(c, A, L) : teamRows(c, A, L), rb = isP ? projectRows(c, B, L) : teamRows(c, B, L);
    const rows = ra.map((x, i) => ({ ...x, a: x.v, b: rb[i].v })).filter((x) => x.a != null || x.b != null);
    const tone = (x) => (!x.better || x.a == null || x.b == null || x.a === x.b ? 'muted' : (x.better === 'lower' ? x.b < x.a : x.b > x.a) ? 'ok' : 'warn');
    s.visual = { kind: 'compare', data: { a: { label: nameA.slice(0, 60) }, b: { label: nameB.slice(0, 60) }, rows: rows.slice(0, 8).map((x) => ({ label: x.label, unit: x.unit, a: x.a, b: x.b, ...(x.better ? { better: x.better } : {}), tone: tone(x) })) },
      caption: T(L, `${nameA} und ${nameB} nebeneinander; grün = ${nameB} steht dort besser da.`, `${nameA} and ${nameB} side by side; green = ${nameB} is better there.`) };
    s.kpis = rows.filter((x) => x.better && x.a != null && x.b != null).slice(0, 2).flatMap((x) => [
      { id: `${x.id}A`, label: `${x.label} ${nameA}`.slice(0, 60), value: x.a, unit: x.unit }, { id: `${x.id}B`, label: `${x.label} ${nameB}`.slice(0, 60), value: x.b, unit: x.unit }]);
    const fmtV = (x, v) => (x.unit === 'h' ? F.h(v) : x.unit === '%' ? `${v}${L === 'en' ? '%' : ' %'}` : x.unit === 'd' ? T(L, `${v} Tage`, `${v} days`) : F.n(v));
    const diffs = rows.filter((x) => x.better && x.a != null && x.b != null && x.a !== x.b).map((x) => ({ x, rel: Math.abs(x.b - x.a) / Math.max(1, Math.abs(x.a), Math.abs(x.b)) })).sort((u, v) => v.rel - u.rel);
    for (const { x, rel } of diffs.slice(0, 3)) {
      const bBetter = x.better === 'lower' ? x.b < x.a : x.b > x.a;
      s.findings.push(finding(T(L, `${x.label}: ${nameA} ${fmtV(x, x.a)}, ${nameB} ${fmtV(x, x.b)} – ${bBetter ? nameB : nameA} steht besser da.`, `${x.label}: ${nameA} ${fmtV(x, x.a)}, ${nameB} ${fmtV(x, x.b)} – ${bBetter ? nameB : nameA} is ahead.`), 'info', Math.round(40 + rel * 50),
        [ev(nameA.slice(0, 60), x.a, x.unit), ev(nameB.slice(0, 60), x.b, x.unit)]));
    }
    if (!s.findings.length) s.findings.push(finding(T(L, `${nameA} und ${nameB} liegen in allen Kennzahlen gleich auf.`, `${nameA} and ${nameB} are level on every figure.`), 'info', 10, []));
    s.tone = 'info';
    const top = diffs[0]?.x;
    s.headline = top ? say(s.id, 'h', [T(L, `${nameA} gegen ${nameB}: größter Unterschied bei ${top.label} (${fmtV(top, top.a)} zu ${fmtV(top, top.b)}).`, `${nameA} vs. ${nameB}: the biggest difference is ${top.label.toLowerCase()} (${fmtV(top, top.a)} to ${fmtV(top, top.b)}).`),
      T(L, `Im Vergleich unterscheiden sich ${nameA} und ${nameB} am stärksten bei ${top.label}: ${fmtV(top, top.a)} zu ${fmtV(top, top.b)}.`, `${nameA} and ${nameB} differ most in ${top.label.toLowerCase()}: ${fmtV(top, top.a)} to ${fmtV(top, top.b)}.`)])
      : T(L, `${nameA} und ${nameB} liegen gleich auf.`, `${nameA} and ${nameB} are level.`);
    s.actions.push(action('openA', nameA.slice(0, 80), 'navigate', isP ? { view: 'project', ref: A.ref } : { view: 'team', teamId: A }, T(L, `Öffnet ${nameA}.`, `Opens ${nameA}.`)));
    s.actions.push(action('openB', nameB.slice(0, 80), 'navigate', isP ? { view: 'project', ref: B.ref } : { view: 'team', teamId: B }, T(L, `Öffnet ${nameB}.`, `Opens ${nameB}.`)));
    s.followUps.push(follow(nameA.slice(0, 60), isP ? T(L, `Lagebild ${nameA}`, `Briefing ${nameA}`) : T(L, `Lagebild Team ${nameA}`, `Briefing team ${nameA}`)), follow(nameB.slice(0, 60), isP ? T(L, `Lagebild ${nameB}`, `Briefing ${nameB}`) : T(L, `Lagebild Team ${nameB}`, `Briefing team ${nameB}`)));
    s.how = { text: isP ? T(L, 'Dieselben Kennzahlen wie im Projekt-Lagebild: Fortschritt, Prognose, Rest, überfällige Stories, Tage bis zum Termin, Reife.', 'The same figures as the project briefing: progress, forecast, remaining, overdue stories, days to the due date, maturity.') : T(L, 'Dieselben Kennzahlen wie im Team-Lagebild, für das aktuelle Quartal.', 'The same figures as the team briefing, for the current quarter.'), inputs: [[T(L, 'Quartal', 'Quarter'), F.quarter(c.wl.quarters[0])]] };
    s.confidence = 'high';
    s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity')];
    return done(s);
  },
};
