// "Mehrteam-Check" (user 2026-11-17: "one member that belongs to two teams can cause time conflicts, or other peculiar
// and complex conflicts – make sure that never happens"): every person who works for more than one team, checked with
// the cockpit's own numbers (shared/splitPeople.js) – double booked weeks, a better-ranked project losing time to a
// worse-ranked one of the other team, a team using more than its share (the other team counts phantom capacity), work
// in a team the person is not a member of, shares that do not add up, people split on default values. The mission
// "Mehrteam-Konflikte lösen" (act/missionsSplit.js) fixes them; this story is its first step.
import { splitConflicts, realConflicts } from '../../splitPeople.js';
import { computedOf, newStory, addPerson, addTeam, addProject, kpi, ev, finding, follow, done, T, worst, teamName } from '../kit.js';
import { plural } from '../narrate.js';
import { isoWeekNo } from '../story.js';
import { inTeam } from '../../allocation.js';
import { capacityPeople } from '../../engine.js';

const SEV_TONE = { bad: 'bad', warn: 'warn', info: 'info' };
const IMPACT = { overbooked: 95, priority: 85, shareDrift: 80, outsideWork: 60, sharesOff: 55, defaults: 20 };

// the people a person / team scope means: the person; or everyone in the team or with work in it
export function scopeIds(ctx, { person = null, team = null } = {}) {
  if (person) return new Set([person]);
  if (!team) return null;
  const { model } = computedOf(ctx);
  const ids = new Set([...capacityPeople(model).values()].filter((p) => inTeam(p, team)).map((p) => p.id));
  for (const i of model.ds.issues || []) if (i.team?.id === team && i.assignee?.id) ids.add(i.assignee.id);
  return ids;
}

export function splitStory(ctx, r, { person = null, team = null, L = 'de', skill = 'splitCheck' } = {}) {
  const c = computedOf(ctx);
  const { model } = c;
  const subject = person ? { kind: 'person', ref: person, name: model.ds.people?.[person]?.name || T(L, 'Person', 'Person') } : team ? { kind: 'team', ref: team, name: teamName(model, team) || team } : { kind: 'portfolio', ref: null, name: T(L, 'Mehrteam', 'Multi-team') };
  const s = newStory(ctx, { skill, subject, lang: L });
  const F = s.fmt;
  if (team && model.teams.has(team)) addTeam(s, model, team);
  const tn = (id) => teamName(model, id) || T(L, 'ohne Team', 'no team');
  const wk = (iso) => `${T(L, 'KW', 'W')} ${isoWeekNo(iso)}`;
  const nm = (p) => p.name || T(L, 'Eine Person', 'A person');
  const split = r.people.filter((p) => p.teams.length >= 2);
  const real = realConflicts(r);
  const over = real.filter((x) => x.kind === 'overbooked');
  const phantom = Object.values(r.phantomByTeam).reduce((a, b) => a + b, 0);
  s.kpis.push(kpi('people', T(L, 'Personen mit Konflikt', 'People with a conflict'), new Set(real.map((x) => x.personId)).size, 'n', { tone: real.length ? 'bad' : 'ok' }));
  s.kpis.push(kpi('conflicts', T(L, 'Konflikte', 'Conflicts'), real.length, 'n', { tone: real.length ? 'bad' : 'ok' }));
  s.kpis.push(kpi('overWeeks', T(L, 'Doppelt verplante Wochen', 'Double-booked weeks'), over.reduce((a, x) => a + x.weeks.length, 0), 'n', { tone: over.length ? 'bad' : 'ok' }));
  s.kpis.push(kpi('phantom', T(L, 'Scheinbar freie Stunden', 'Phantom free hours'), phantom, 'h', { tone: phantom > 0.5 ? 'warn' : 'ok' }));
  const list = [...r.people].flatMap((p) => p.conflicts.map((x) => ({ p, x }))).sort((a, b) => (IMPACT[b.x.kind] || 0) - (IMPACT[a.x.kind] || 0));
  for (const { p, x } of list.slice(0, 6)) {
    addPerson(s, ctx, p.id);
    const teamsTxt = p.teams.map((t) => `${tn(t.teamId)} ${t.pct} %`).join(', ');
    for (const t of p.teams) if (model.teams.has(t.teamId)) addTeam(s, model, t.teamId);
    if (x.kind === 'overbooked') {
      const pk = x.peak;
      const pkWeek = x.weeks.find((w) => w.from === pk.from);
      // live E2E 2026-11-23 (a person in 6 teams): a finding carries at most 8 sources, and every number in its text needs
      // one – so the 3 biggest teams of the peak week by name, the rest as one sum; the shares by name only for 2 teams
      const byTeam = Object.entries(pkWeek.byTeam).filter(([, h]) => h > 0.05).sort((a, b) => b[1] - a[1]);
      const top = byTeam.slice(0, 3), rest = byTeam.slice(3).reduce((a, [, h]) => a + h, 0);
      const parts = [...top.map(([t, h]) => `${tn(t)} ${F.h(h, 1)}`), ...(rest > 0.05 ? [T(L, `weitere ${F.h(rest, 1)}`, `others ${F.h(rest, 1)}`)] : [])].join(' + ');
      const pct = Number.isFinite(pk.util) ? Math.round(pk.util * 100) : null;
      const named = p.teams.length <= 2;
      const inTeams = named ? teamsTxt : T(L, `in ${p.teams.length} Teams`, `in ${p.teams.length} teams`);
      s.findings.push(finding(T(L, `${nm(p)} (${inTeams}) ist in ${x.weeks.length} ${plural(x.weeks.length, 'Woche', 'Wochen')} doppelt verplant – am stärksten ${wk(pk.from)}: ${parts} bei ${F.h(pk.cap, 1)} Zeit${pct != null ? ` (${pct} %)` : ''}.`, `${nm(p)} (${inTeams}) is double booked in ${x.weeks.length} ${plural(x.weeks.length, 'week', 'weeks')} – worst ${wk(pk.from)}: ${parts} with ${F.h(pk.cap, 1)} of time${pct != null ? ` (${pct} %)` : ''}.`), 'bad', IMPACT.overbooked,
        [ev(T(L, 'Wochen', 'weeks'), x.weeks.length, 'n'), ev(T(L, 'Zeit', 'time'), Math.round(pk.cap * 10) / 10, 'h', { ref: `person:${p.id}`, date: pk.from }), ...top.map(([t, h]) => ev(tn(t), Math.round(h * 10) / 10, 'h', { ref: `team:${t}` })), ...(rest > 0.05 ? [ev(T(L, 'weitere Teams', 'other teams'), Math.round(rest * 10) / 10, 'h')] : []), ...(pct != null ? [ev(T(L, 'Auslastung', 'load'), pct, '%')] : []), ...(named ? p.teams.map((t) => ev(tn(t.teamId), t.pct, '%')) : [ev('Teams', p.teams.length, 'n')])]));
    } else if (x.kind === 'priority') {
      const a = model.itemByRef.get(x.first.ref), b = model.itemByRef.get(x.second[0].ref);
      if (a) addProject(s, a); if (b) addProject(s, b);
      s.findings.push(finding(T(L, `Bei ${nm(p)} nimmt ${b?.name || x.second[0].key} (${tn(x.second[0].teamId)}) in diesen Wochen ${F.h(x.hours, 1)}, die ${a?.name || x.first.key} (${tn(x.first.teamId)}, besser gerankt) braucht.`, `For ${nm(p)}, ${b?.name || x.second[0].key} (${tn(x.second[0].teamId)}) takes ${F.h(x.hours, 1)} in these weeks that ${a?.name || x.first.key} (${tn(x.first.teamId)}, ranked higher) needs.`), 'warn', IMPACT.priority,
        [ev(T(L, 'Stunden', 'hours'), Math.round(x.hours * 10) / 10, 'h'), ...(a ? [ev(a.name, a.rank, 'n', { ref: a.ref, label: 'rank' })] : []), ...(b ? [ev(b.name, b.rank, 'n', { ref: b.ref })] : [])]));
    } else if (x.kind === 'shareDrift') {
      const tk = x.takers[0], gv = x.givers[0];
      const sug = x.suggested ? x.suggested.map((t) => `${tn(t.teamId)} ${t.pct} %`).join(' / ') : null;
      s.findings.push(finding(T(L, `${nm(p)}: ${tn(tk.teamId)} braucht ${F.h(tk.actual)} statt der ${F.h(tk.expected)} aus ${tk.pct} % Anteil – ${tn(gv.teamId)} rechnet dadurch mit ${F.h(gv.phantom)}, die es nicht gibt.${sug ? ` Passend wären ${sug}.` : ''}`, `${nm(p)}: ${tn(tk.teamId)} needs ${F.h(tk.actual)} instead of the ${F.h(tk.expected)} from a ${tk.pct} % share – so ${tn(gv.teamId)} counts ${F.h(gv.phantom)} that do not exist.${sug ? ` Fitting would be ${sug}.` : ''}`), 'warn', IMPACT.shareDrift,
        [ev(tn(tk.teamId), Math.round(tk.actual), 'h', { ref: `team:${tk.teamId}` }), ev(T(L, 'aus dem Anteil', 'from the share'), Math.round(tk.expected), 'h'), ev(T(L, 'Anteil', 'share'), tk.pct, '%'), ev(tn(gv.teamId), Math.round(gv.phantom), 'h', { ref: `team:${gv.teamId}` }), ...(x.suggested || []).map((t) => ev(tn(t.teamId), t.pct, '%'))]));
    } else if (x.kind === 'outsideWork') {
      if (model.teams.has(x.teamId)) addTeam(s, model, x.teamId);
      s.findings.push(finding(T(L, `${nm(p)} arbeitet ${F.h(x.hours, 1)} für ${tn(x.teamId)}, ist dort aber kein Mitglied – diese Stunden zählen in keiner Teamkapazität (${x.tasks.slice(0, 3).map((t) => t.key).join(', ')}).`, `${nm(p)} works ${F.h(x.hours, 1)} for ${tn(x.teamId)} without being a member – these hours count in no team's capacity (${x.tasks.slice(0, 3).map((t) => t.key).join(', ')}).`), 'warn', IMPACT.outsideWork,
        [ev(tn(x.teamId), Math.round(x.hours * 10) / 10, 'h', { ref: `team:${x.teamId}` }), ...x.tasks.slice(0, 3).map((t) => ev(t.key, Math.round(t.hours * 10) / 10, 'h', { key: t.key }))]));
    } else if (x.kind === 'sharesOff') {
      s.findings.push(finding(T(L, `${nm(p)}: die Anteile ergeben ${x.total} % statt 100 % (${teamsTxt}).`, `${nm(p)}: the shares add up to ${x.total} % instead of 100 % (${teamsTxt}).`), 'warn', IMPACT.sharesOff, [ev(T(L, 'Summe', 'sum'), x.total, '%'), ev(T(L, 'Ziel', 'target'), 100, '%'), ...p.teams.map((t) => ev(tn(t.teamId), t.pct, '%'))]));
    } else if (x.kind === 'defaults') {
      s.findings.push(finding(T(L, `${nm(p)} ist in ${p.teams.length} Teams (${teamsTxt}), aber ohne gepflegte Werte – das Cockpit rechnet mit ${F.h(x.weeklyHours, 1)} je Woche, gleich verteilt.`, `${nm(p)} is in ${p.teams.length} teams (${teamsTxt}) but without maintained values – the cockpit counts ${F.h(x.weeklyHours, 1)} per week, split evenly.`), 'info', IMPACT.defaults,
        [ev(T(L, 'Teams', 'teams'), p.teams.length, 'n'), ev(T(L, 'Wochenstunden', 'weekly hours'), x.weeklyHours, 'h'), ...p.teams.map((t) => ev(tn(t.teamId), t.pct, '%'))]));
    }
  }
  if (!s.findings.length) s.findings.push(finding(split.length ? T(L, `${split.length} ${plural(split.length, 'Person arbeitet', 'Personen arbeiten')} in mehreren Teams – ohne Konflikt: keine Woche doppelt verplant, die Anteile passen zur Arbeit.`, `${split.length} ${plural(split.length, 'person works', 'people work')} in several teams – without conflict: no week double booked, the shares fit the work.`) : T(L, 'Niemand arbeitet für mehrere Teams – kein Mehrteam-Konflikt möglich.', 'Nobody works for several teams – no multi-team conflict possible.'), 'ok', 40, [ev(T(L, 'Personen in mehreren Teams', 'people in several teams'), split.length, 'n')]));
  const top = r.people.filter((p) => p.conflicts.some((x) => x.severity !== 'info')).slice(0, 8);
  s.visual = top.length
    ? { kind: 'bars', data: { unit: 'h', items: top.map((p) => { const o = p.conflicts.find((x) => x.kind === 'overbooked'); const d = p.conflicts.find((x) => x.kind === 'shareDrift'); const v = o ? o.excess : d ? d.givers.reduce((a, g) => a + (g.phantom || 0), 0) : p.conflicts.find((x) => x.kind === 'outsideWork')?.hours || 0; return { label: p.name || T(L, 'Person', 'person'), value: Math.round(v * 10) / 10, tone: o ? 'bad' : 'warn' }; }) }, caption: T(L, 'Stunden über der Zeit (doppelt verplant) bzw. scheinbar frei je Person.', 'Hours above the time (double booked) or phantom free per person.') }
    : { kind: 'bars', data: { unit: 'n', items: [{ label: T(L, 'Personen in mehreren Teams', 'People in several teams'), value: split.length, tone: 'ok' }] }, caption: T(L, 'Kein Mehrteam-Konflikt.', 'No multi-team conflict.') };
  s.headline = !real.length
    ? (split.length ? T(L, `Mehrteam-Check: ${split.length} ${plural(split.length, 'Person', 'Personen')} in mehreren Teams – alles passt.`, `Multi-team check: ${split.length} ${plural(split.length, 'person', 'people')} in several teams – everything fits.`) : T(L, 'Mehrteam-Check: niemand ist in mehreren Teams.', 'Multi-team check: nobody is in several teams.'))
    : T(L, `Mehrteam-Check: ${real.length} ${plural(real.length, 'Konflikt', 'Konflikte')} bei ${new Set(real.map((x) => x.personId)).size} ${plural(new Set(real.map((x) => x.personId)).size, 'Person', 'Personen')}${over.length ? ` – ${over.reduce((a, x) => a + x.weeks.length, 0)} doppelt verplante ${plural(over.reduce((a, x) => a + x.weeks.length, 0), 'Woche', 'Wochen')}` : ''}.`,
      `Multi-team check: ${real.length} ${plural(real.length, 'conflict', 'conflicts')} for ${new Set(real.map((x) => x.personId)).size} ${plural(new Set(real.map((x) => x.personId)).size, 'person', 'people')}${over.length ? ` – ${over.reduce((a, x) => a + x.weeks.length, 0)} double-booked ${plural(over.reduce((a, x) => a + x.weeks.length, 0), 'week', 'weeks')}` : ''}.`);
  s.tone = worst(...s.findings.map((f) => SEV_TONE[f.tone] || f.tone).filter((t) => t !== 'info'));
  // resolving is a job (the story card's mission button: "Mehrteam-Konflikte automatisch lösen"), not a follow-up question
  if (real.length) s.followUps.push(follow(T(L, 'Mehr Kapazität?', 'More capacity?'), T(L, 'Wo reicht die Kapazität nicht?', 'Where is capacity short?')));
  s.followUps.push(follow(T(L, 'Überstunden', 'Overtime'), T(L, 'Wer hat zu viel Arbeit?', 'Who has too much work?')));
  s.how = { text: T(L, 'Wie Kapazität und Teams rechnen: die Restschätzung jeder Story gleichmäßig über ihre Arbeitstage, gegen die Zeit der Person (Feiertage, Abwesenheiten, Tagesgeschäft, Intern, Support). Eine Teamkapazität zählt Zeit × Anteil – nimmt ein Team mehr als seinen Anteil, zählt das andere Team Stunden, die schon verplant sind. Teams kommen aus Atlassian Teams, Anteile aus Teams › Kapazitäten pflegen.', 'As capacity and teams calculate: each story\'s remaining estimate evenly over its working days, against the person\'s time (holidays, absences, daily business, internal, support). A team\'s capacity counts time × share – when one team takes more than its share, the other team counts hours that are already used. Teams come from Atlassian Teams, shares from Teams › Maintain capacities.'), inputs: [[T(L, 'Wochen', 'Weeks'), String(r.weeks.length)], [T(L, 'Personen geprüft', 'People checked'), String(r.people.length)]] };
  s.confidence = 'high';
  s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity'), 'Atlassian Teams'];
  return done(s);
}

export default {
  id: 'splitCheck',
  title: (L) => T(L, 'Mehrteam-Check', 'Multi-team check'),
  params: ['person', 'team'],
  match: [/mehr(ere[nr]?)? teams|zwei teams|beiden teams|two teams|both teams|several teams|multiple teams|multi-?team|mehrteam|doppelt (verplant|gebucht)|double[- ]?book\w*|(team-?)?anteile?\b|team shares?|split (across|between)|phantom|scheinbar frei/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const r = splitConflicts(c.model, c.support, { only: scopeIds(ctx, p || {}) });
    return splitStory(ctx, r, { person: p?.person || null, team: p?.team || null, L });
  },
};
