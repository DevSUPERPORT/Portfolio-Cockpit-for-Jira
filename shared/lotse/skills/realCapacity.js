// Realistic capacity (shared/insights.js realisticCapacity): per team what is really available for projects after
// the support reality (P80 of the weekly support hours), and what is planned once the team's estimate factor is applied.
import { computedOf, rcOf, newStory, addTeam, kpi, ev, finding, action, follow, done, infoStory, r1, sum, T, say, worst } from '../kit.js';
import { isoWeekNo } from '../story.js';
import { pickTeam } from './teamBrief.js';

export default {
  id: 'realCapacity',
  title: (L) => T(L, 'Realistische Kapazität', 'Realistic capacity'),
  params: ['team'],
  match: [/realistisch|realistic|echte[n]? kapazitaet|real capacity|tatsaechlich(e)? (zeit|kapazitaet)|actual capacity|wie viel (zeit|kapazitaet) (haben wir|bleibt)|how much (time|capacity) (do we (really |actually )?have|is left)|nach (abzug (des |vom )?)?support|after support|ressourcen (realistisch )?planen|resourc(e|ing) planning|(zeit|kapazitaet|stunden) (frisst|kostet|bindet|verbraucht|braucht) (der |unser )?support|support (frisst|kostet|bindet|verbraucht)|how much (time|capacity) (does )?(the )?support (take|eat|cost|consume)/],
  run(ctx, p, L) {
    const { model } = computedOf(ctx);
    const rc = rcOf(ctx, L);
    const tid = pickTeam(ctx, p);
    const teams = tid ? rc.teams.filter((t) => t.teamId === tid) : rc.teams;
    if (!teams.length) return infoStory(ctx, { skill: 'realCapacity', lang: L, headline: T(L, 'Für dieses Team gibt es keine Kapazität oder Planung.', 'There is no capacity or plan for this team.'), finding: T(L, 'Kapazitäten werden unter Teams › Kapazitäten gepflegt.', 'Capacity is maintained under Teams › Capacity.') });
    const one = teams.length === 1 ? teams[0] : null;
    const s = newStory(ctx, { skill: 'realCapacity', subject: one ? { kind: 'team', ref: one.teamId, name: one.name } : { kind: 'portfolio', ref: null, name: 'Portfolio' }, lang: L });
    const F = s.fmt;
    const n = rc.weeks.length;
    const avg = (f) => r1(sum(teams, (t) => t.avg[f]));
    const sup = r1(sum(teams, (t) => t.support.p80));
    s.kpis.push(kpi('available', T(L, 'Verfügbar je Woche', 'Available per week'), avg('nominal'), 'h', { tone: 'ink' }));
    s.kpis.push(kpi('support', T(L, 'Support realistisch (P80)', 'Support realistic (P80)'), sup, 'h'));
    s.kpis.push(kpi('room', T(L, 'Raum für Projekte', 'Room for projects'), avg('room'), 'h', { tone: 'ok' }));
    s.kpis.push(kpi('planned', T(L, 'Geplant realistisch', 'Planned realistic'), avg('plannedAdj'), 'h', { tone: avg('plannedAdj') > avg('room') ? 'bad' : 'ok' }));
    if (one) {
      addTeam(s, model, one.teamId);
      s.visual = { kind: 'columns', data: { unit: 'h', labels: one.weekly.map((w) => `${T(L, 'KW', 'W')} ${isoWeekNo(w.from)}`), series: [{ name: T(L, 'Raum für Projekte', 'Room for projects'), values: one.weekly.map((w) => w.room), tone: 'ok' }, { name: T(L, 'Geplant realistisch', 'Planned realistic'), values: one.weekly.map((w) => w.plannedAdj), tone: 'warn' }] },
        caption: T(L, `Team ${one.name} je Woche: realistischer Raum für Projekte gegen die geplante Arbeit × Schätzfaktor.`, `Team ${one.name} per week: realistic room for projects against the planned work × estimate factor.`) };
    } else {
      const ts = teams.slice(0, 12);
      for (const t of ts) addTeam(s, model, t.teamId);
      s.visual = { kind: 'columns', data: { unit: 'h', labels: ts.map((t) => t.name), series: [{ name: T(L, 'Verfügbar', 'Available'), values: ts.map((t) => t.avg.nominal), tone: 'muted' }, { name: T(L, 'Support (P80)', 'Support (P80)'), values: ts.map((t) => t.support.p80), tone: 'info' }, { name: T(L, 'Raum für Projekte', 'Room for projects'), values: ts.map((t) => t.avg.room), tone: 'ok' }, { name: T(L, 'Geplant realistisch', 'Planned realistic'), values: ts.map((t) => t.avg.plannedAdj), tone: 'warn' }] },
        caption: T(L, `Ø je Woche über ${n} Wochen: verfügbar, Support-Realität, Raum für Projekte und realistisch geplant – je Team.`, `Avg per week over ${n} weeks: available, support reality, room for projects and realistically planned – per team.`) };
    }
    for (const t of [...teams].sort((a, b) => (b.avg.plannedAdj - b.avg.room) - (a.avg.plannedAdj - a.avg.room)).slice(0, 3)) {
      addTeam(s, model, t.teamId);
      const gap = t.avg.plannedAdj - t.avg.room;
      const factor = Math.abs(t.estimate.factor - 1) >= 0.005;
      s.findings.push(finding(T(L, `Team ${t.name}: Ø ${F.h(t.avg.nominal)} verfügbar, Support braucht realistisch ${F.h(t.support.p80)}, bleiben ${F.h(t.avg.room)}; geplant sind ${factor ? `mit Faktor ${F.n(t.estimate.factor, 2)} ` : ''}${F.h(t.avg.plannedAdj)} je Woche.`, `Team ${t.name}: avg ${F.h(t.avg.nominal)} available, support realistically needs ${F.h(t.support.p80)}, ${F.h(t.avg.room)} left; planned ${factor ? `with factor ${F.n(t.estimate.factor, 2)} ` : ''}is ${F.h(t.avg.plannedAdj)} per week.`),
        gap > 0.5 ? 'bad' : 'ok', gap > 0.5 ? Math.min(95, 60 + gap / 5) : 15,
        [ev(T(L, 'verfügbar', 'available'), t.avg.nominal, 'h', { ref: `team:${t.teamId}` }), ev(T(L, 'Support P80', 'support P80'), t.support.p80, 'h'), ev(T(L, 'Raum', 'room'), t.avg.room, 'h'), ev(T(L, 'geplant realistisch', 'planned realistic'), t.avg.plannedAdj, 'h'), ev(T(L, 'Schätzfaktor', 'estimate factor'), t.estimate.factor, 'n')]));
    }
    if (rc.unassignedPlanned > 0.5) s.findings.push(finding(T(L, `${F.h(rc.unassignedPlanned)} geplante Arbeit hat kein Team und fehlt in dieser Rechnung.`, `${F.h(rc.unassignedPlanned)} of planned work has no team and is missing from this calculation.`), 'info', 30, [ev(T(L, 'ohne Team', 'no team'), rc.unassignedPlanned, 'h')]));
    s.tone = worst(...s.findings.map((f) => (f.tone === 'info' ? null : f.tone)));
    const room = avg('room'), plan = avg('plannedAdj');
    s.headline = say(s.id, 'h', [T(L, `${one ? `Team ${one.name}` : 'Realistisch'}: ${F.h(room)} je Woche für Projekte, geplant sind ${F.h(plan)}${plan > room ? ` – ${F.h(plan - room)} zu viel` : ''}.`, `${one ? `Team ${one.name}` : 'Realistically'}: ${F.h(room)} per week for projects, ${F.h(plan)} planned${plan > room ? ` – ${F.h(plan - room)} too much` : ''}.`),
      T(L, `Nach Support (P80 ${F.h(sup)}) bleiben ${F.h(room)} je Woche für Projekte; geplant ${F.h(plan)}.`, `After support (P80 ${F.h(sup)}) ${F.h(room)} per week remain for projects; planned ${F.h(plan)}.`)]);
    if (plan > room) s.findings.length < 4 && s.findings.push(finding(T(L, `Zusammen sind je Woche ${F.h(plan - room)} mehr geplant als realistisch Raum ist.`, `Together ${F.h(plan - room)} per week more are planned than there is realistic room.`), 'bad', 50, [ev(T(L, 'Raum', 'room'), room, 'h'), ev(T(L, 'geplant', 'planned'), plan, 'h'), ev(T(L, 'zu viel', 'too much'), r1(plan - room), 'h')]));
    s.actions.push(action('capacity', T(L, 'Kapazitäten', 'Capacity'), 'navigate', { view: 'capacity', ...(one ? { teamId: one.teamId } : {}) }, T(L, 'Öffnet die Kapazitäten mit Support-Reserve und Wochenstunden.', 'Opens capacity with the support reserve and weekly hours.')));
    s.followUps.push(follow(T(L, 'Was passt?', 'What fits?'), T(L, 'Was passt ohne Überstunden?', 'What fits without overtime?')), follow(T(L, 'Überstunden', 'Overtime'), T(L, 'Wer macht bald Überstunden?', 'Who is heading for overtime?')), follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')));
    s.how = { text: T(L, 'Verfügbar = Wochenstunden nach Feiertagen, Abwesenheiten, Tagesgeschäft und interner Arbeit. Support = P80 der wöchentlichen Support-Stunden (in 4 von 5 Wochen reicht das). Geplant = Restschätzung × Schätzfaktor (gebucht ÷ geschätzt erledigter Stories, getrimmter Mittelwert).', 'Available = weekly hours after holidays, absences, daily business and internal work. Support = P80 of the weekly support hours (enough in 4 of 5 weeks). Planned = remaining estimate × estimate factor (logged ÷ estimated of finished stories, trimmed mean).'),
      inputs: [[T(L, 'Zeitraum', 'Period'), `${n} ${T(L, 'Wochen', 'weeks')}`], [T(L, 'Schätzfaktor gesamt', 'Overall estimate factor'), rc.estimate.factor != null ? `${F.n(rc.estimate.factor, 2)} (${rc.estimate.n})` : '–']] };
    s.confidence = teams.every((t) => t.confidence === 'high') ? 'high' : teams.some((t) => t.confidence !== 'low') ? 'medium' : 'low';
    s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity'), 'Support', T(L, 'Verlauf', 'History')];
    return done(s);
  },
};
