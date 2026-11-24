// Project briefing: where a project stands – effort, date, staffing per quarter, conflicts, gaps, health.
import { actionItems, dataQuality } from '../../engine.js';
import { dayIdx } from '../../dates.js';
import { lc1, computedOf, newStory, addProject, addTeam, addPerson, kpi, ev, finding, action, follow, done, infoStory, pickProject, urgentProject, pctPts, r1, T, say, worst } from '../kit.js';
import { healthName, wlName, plural } from '../narrate.js';
import { ruleLabel } from './gapsFix.js';

export default {
  id: 'projectBrief',
  title: (L) => T(L, 'Projekt-Lagebild', 'Project briefing'),
  params: ['project'],
  match: [/\b(lagebild|lage|briefing|status|stand|zusammenfassung|summary|ueberblick|overview)\b/, /wie (steht|laeuft|geht'?s|weit ist)|how (is|far along is|are things with)|what'?s (going on|up) (with|in)|was ist (bei|mit) .* los/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const { model, metrics, wl, deps } = c;
    const it = pickProject(ctx, p);
    if (!it) {
      const u = urgentProject(ctx);
      return infoStory(ctx, {
        skill: 'projectBrief', lang: L, headline: T(L, 'Welches Projekt soll Lotse zusammenfassen?', 'Which project should Lotse sum up?'),
        finding: T(L, 'In der Frage steht kein Projekt, das Lotse im Portfolio findet.', 'The question names no project Lotse can find in the portfolio.'),
        followUps: [u, ...model.items.slice(0, 3)].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3).map((x) => follow(x.name, T(L, `Lagebild ${x.name}`, `Briefing ${x.name}`))),
      });
    }
    const m = metrics.get(it.ref);
    const s = newStory(ctx, { skill: 'projectBrief', subject: { kind: 'project', ref: it.ref, name: it.name }, lang: L });
    const F = s.fmt;
    const name = addProject(s, it);
    const pdq = dataQuality(model, new Set([it.ref]));
    const acts = actionItems(model, it, m, wl, deps, pdq);
    const today = model.today;
    const daysLeft = m.due ? dayIdx(m.due) - today : null;
    const progress = pctPts(m.progress);
    const q0 = wl.quarters[0];
    const pq = wl.projectQ[it.ref] || {};

    s.kpis.push(kpi('progress', T(L, 'Fortschritt', 'Progress'), progress, '%', { tone: 'ink' }));
    s.kpis.push(kpi('forecast', T(L, 'Prognose', 'Forecast'), m.forecast, 'h', { delta: r1(m.forecast - m.OE), hint: T(L, `Plan ${F.h(m.OE)}`, `plan ${F.h(m.OE)}`), tone: m.warnings.some((w) => w.kind === 'forecastOverPlan') ? 'warn' : 'ok' }));
    if (m.daysOverdue > 0) s.kpis.push(kpi('late', T(L, 'Tage über Termin', 'Days past due'), m.daysOverdue, 'd', { tone: 'bad' }));
    else if (daysLeft != null) s.kpis.push(kpi('daysLeft', T(L, 'Tage bis Termin', 'Days to due date'), daysLeft, 'd', { tone: daysLeft < 14 ? 'warn' : 'ok' }));
    s.kpis.push(kpi('overdue', T(L, 'Stories überfällig', 'Stories overdue'), m.overdueCount, 'n', { tone: m.overdueCount ? 'bad' : 'ok' }));

    s.visual = {
      kind: 'bars',
      data: { unit: 'h', target: r1(m.OE), items: [
        { label: T(L, 'Gebucht', 'Logged'), value: r1(m.TS), tone: 'ink' },
        { label: T(L, 'Restschätzung', 'Remaining'), value: r1(m.RE), tone: 'info' },
        { label: T(L, 'Noch nicht geschätzt (T-Shirt)', 'Not estimated yet (T-shirt)'), value: r1(m.openTshirt), tone: 'muted' },
      ] },
      caption: T(L, 'Aufwand in Stunden: gebucht, Rest und noch nicht als Story geschätzt; die Linie ist der Plan (Original Estimate).', 'Effort in hours: logged, remaining and not yet estimated as stories; the line is the plan (original estimate).'),
    };

    // findings
    if (m.daysOverdue > 0) s.findings.push(finding(T(L, `${name} ist ${m.daysOverdue} Tage über dem Termin (${F.date(m.due)}).`, `${name} is ${m.daysOverdue} days past its due date (${F.date(m.due)}).`), 'bad', 95, [ev(T(L, 'Due Date', 'Due date'), m.due, 'date'), ev(T(L, 'Tage drüber', 'Days over'), m.daysOverdue, 'd')]));
    const od = acts.filter((a) => a.kind === 'overdue');
    if (od.length) {
      const max = Math.max(...od.map((a) => a.days));
      s.findings.push(finding(T(L, `${od.length} ${plural(od.length, 'Story ist', 'Stories sind')} über dem Due Date, die älteste seit ${max} Tagen.`, `${od.length} ${plural(od.length, 'story is', 'stories are')} past the due date, the oldest by ${max} days.`), 'bad', 85 + Math.min(10, max / 3),
        od.slice(0, 4).map((a) => ev(T(L, 'Tage überfällig', 'days overdue'), a.days, 'd', { key: a.key, text: a.summary }))));
    }
    for (const [qi, q] of wl.quarters.slice(0, 2).entries()) {
      const v = pq[q];
      if (!v || v.status === 'ok') continue;
      const short = v.teams.filter((t) => t.status !== 'ok').map((t) => ({ ...t, miss: t.demand - t.staffed })).sort((a, b) => b.miss - a.miss);
      const miss = short.reduce((a, t) => a + t.miss, 0);
      const tn = addTeam(s, model, short[0].teamId);
      const who = tn ? T(L, `bei Team ${tn}`, `team ${tn} is`) : T(L, 'bei Stories ohne Team', 'stories without a team are');
      s.findings.push(finding(T(L, `In ${F.quarter(q)} ist ${name} ${wlName(v.status, L)}: ${who} fehlen ${F.h(short[0].miss)}${short.length > 1 ? `, insgesamt ${F.h(miss)}` : ''}.`, `In ${F.quarter(q)} ${name} is ${wlName(v.status, L)}: ${who} ${F.h(short[0].miss)} short${short.length > 1 ? `, ${F.h(miss)} in total` : ''}.`),
        v.status === 'no' ? 'bad' : 'warn', (qi === 0 ? 80 : 60) + (v.status === 'no' ? 5 : 0),
        [ev(T(L, 'Quartal', 'Quarter'), q, 'quarter'), ...short.slice(0, 3).map((t) => ev(addTeam(s, model, t.teamId) || T(L, 'ohne Team', 'no team'), r1(t.miss), 'h', { ref: `team:${t.teamId}` })), ...(short.length > 1 ? [ev(T(L, 'Fehlt gesamt', 'Missing in total'), r1(miss), 'h')] : [])]));
    }
    const conf = acts.filter((a) => a.kind === 'conflict');
    if (conf.length) s.findings.push(finding(T(L, `${conf.length} ${plural(conf.length, 'Terminkonflikt', 'Terminkonflikte')}: ${conf[0].key} soll starten, bevor ${conf[0].other} fertig ist (${conf[0].days} Tage).`, `${conf.length} schedule ${plural(conf.length, 'conflict', 'conflicts')}: ${conf[0].key} is due to start before ${conf[0].other} is finished (${conf[0].days} days).`), 'bad', 75,
      [ev(T(L, 'Konflikte', 'Conflicts'), conf.length, 'n'), ...conf.slice(0, 3).flatMap((a) => [ev(T(L, 'Tage Überschneidung', 'days overlap'), a.days, 'd', { key: a.key }), ev(T(L, 'Vorgänger', 'prerequisite'), undefined, null, { key: a.other })])]));
    const absent = acts.filter((a) => a.kind === 'absence');
    if (absent.length) {
      const a = absent[0];
      const who = addPerson(s, ctx, a.person?.id) || T(L, 'Eine Person', 'Someone');
      s.findings.push(finding(T(L, `${who} ist vom ${F.date(a.from)} bis ${F.date(a.to)} abwesend, während ${a.key} läuft.`, `${who} is away from ${F.date(a.from)} to ${F.date(a.to)} while ${a.key} runs.`), 'warn', 55,
        [ev(T(L, 'von', 'from'), a.from, 'date', { key: a.key }), ev(T(L, 'bis', 'to'), a.to, 'date')]));
    }
    const fo = m.warnings.find((w) => w.kind === 'forecastOverPlan');
    if (fo) s.findings.push(finding(T(L, `Die Prognose ${F.h(m.forecast)} liegt ${pctPts(fo.pct)} % über dem Plan von ${F.h(m.OE)}.`, `The forecast of ${F.h(m.forecast)} is ${pctPts(fo.pct)}% above the plan of ${F.h(m.OE)}.`), 'warn', 50,
      [ev(T(L, 'Plan', 'Plan'), m.OE, 'h'), ev(T(L, 'Prognose', 'Forecast'), m.forecast, 'h'), ev(T(L, 'über Plan', 'over plan'), pctPts(fo.pct), '%')]));
    const gaps = pdq.gaps.filter((g) => g.severity === 'gap' && g.rule !== 'overdue');
    if (gaps.length) {
      const urgent = gaps.filter((g) => g.urgent).length;
      s.findings.push(finding(urgent ? T(L, `${gaps.length} Datenlücken, ${urgent} davon dringend (Termin in den nächsten 4 Wochen).`, `${gaps.length} data gaps, ${urgent} of them urgent (date within the next 4 weeks).`) : T(L, `${gaps.length} Datenlücken, keine davon dringend.`, `${gaps.length} data gaps, none of them urgent.`), urgent ? 'warn' : 'info', urgent ? 45 : 25,
        [ev(T(L, 'Lücken', 'Gaps'), gaps.length, 'n'), ev(T(L, 'dringend', 'urgent'), urgent, 'n'), ev(T(L, 'Wochen', 'weeks'), 4, 'n'), ...gaps.slice(0, 2).map((g) => ev(ruleLabel(g.rule, L), undefined, null, g.key ? { key: g.key } : {}))]));
    }
    if (it.health) {
      const age = it.health.at ? Math.max(0, today - dayIdx(String(it.health.at).slice(0, 10))) : null;
      const bad = it.health.status === 'critical', risk = it.health.status === 'atRisk';
      if (bad || risk || (age != null && age > 14)) s.findings.push(finding(T(L, `Health: ${healthName(it.health.status, L)}${age != null ? `, letztes Update vor ${age} Tagen` : ''}.`, `Health: ${healthName(it.health.status, L)}${age != null ? `, last update ${age} days ago` : ''}.`), bad ? 'bad' : 'warn', bad ? 70 : risk ? 45 : 35,
        [ev(T(L, 'Tage seit Update', 'days since update'), age ?? undefined, age != null ? 'd' : null, { text: it.health.comment || undefined })]));
    }
    if (!s.findings.length) s.findings.push(finding(T(L, `${name} liegt im Plan: ${progress} % Fortschritt, keine überfällige Story, alle Quartale besetzbar.`, `${name} is on track: ${progress}% progress, no overdue story, every quarter staffable.`), 'ok', 10, [ev(T(L, 'Fortschritt', 'Progress'), progress, '%')]));

    // verdict
    const q0s = pq[q0]?.status;
    s.tone = worst(m.daysOverdue > 0 || it.health?.status === 'critical' || q0s === 'no' ? 'bad' : null, m.overdueCount || q0s === 'partial' || conf.length || it.health?.status === 'atRisk' || fo ? 'warn' : null);
    const top = [...s.findings].sort((a, b) => b.impact - a.impact)[0];
    s.headline = m.daysOverdue > 0
      ? say(s.id, 'h', [T(L, `${name} ist ${m.daysOverdue} Tage über dem Termin – ${progress} % sind geschafft.`, `${name} is ${m.daysOverdue} days past due – ${progress}% is done.`), T(L, `${name}: ${progress} % Fortschritt, aber schon ${m.daysOverdue} Tage über dem Termin.`, `${name}: ${progress}% progress, but already ${m.daysOverdue} days past due.`)])
      : s.tone === 'ok'
        ? T(L, `${name} liegt im Plan: ${progress} % Fortschritt${daysLeft != null ? `, noch ${daysLeft} Tage bis zum Termin` : ''}.`, `${name} is on track: ${progress}% progress${daysLeft != null ? `, ${daysLeft} days to the due date` : ''}.`)
        : say(s.id, 'h', [T(L, `${name}: ${progress} % Fortschritt – wichtigster Punkt: ${lc1(top.text, s, L)}`, `${name}: ${progress}% progress – first thing to look at: ${lc1(top.text, s, L)}`),
          T(L, `${name} steht bei ${progress} % – ${lc1(top.text, s, L)}`, `${name} is at ${progress}% – ${lc1(top.text, s, L)}`)]);

    s.actions.push(action('open', T(L, 'Projekt öffnen', 'Open project'), 'navigate', { view: 'project', ref: it.ref }, T(L, `Öffnet die Projektdetails von ${name}.`, `Opens the project details of ${name}.`)));
    if (m.daysOverdue > 0 || (q0s && q0s !== 'ok')) s.actions.push(action('whatIfDue', T(L, '2 Wochen mehr Zeit?', '2 more weeks?'), 'whatIf', { change: { kind: 'due', ref: it.ref, weeks: 2 } }, T(L, `Rechnet durch, was 2 Wochen mehr Zeit für ${name} an Wasserlinie und Überlast ändern – nichts wird gespeichert.`, `Works out what 2 more weeks for ${name} change in the waterline and overload – nothing is saved.`)));
    if (gaps.length) s.actions.push(action('gaps', T(L, 'Lücken füllen', 'Fill gaps'), 'navigate', { view: 'quality', ref: it.ref }, T(L, `Zeigt die ${gaps.length} Datenlücken mit Vorschlägen.`, `Shows the ${gaps.length} data gaps with suggestions.`)));
    s.followUps.push(follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')), follow(T(L, 'Health-Entwurf', 'Health draft'), T(L, `Health-Entwurf für ${name}`, `Health draft for ${name}`)),
      follow(T(L, 'Blockaden', 'Blockers'), T(L, `Was blockiert ${name}?`, `What blocks ${name}?`)), follow(T(L, '2 Wochen später?', '2 weeks later?'), T(L, 'Was wäre wenn Due +2 Wochen?', 'What if due +2 weeks?')));
    s.how = { text: T(L, 'Fortschritt = gebucht ÷ (gebucht + Rest + offene T-Shirt Size). Prognose = gebucht + Rest. Engpässe aus der Wasserlinie je Quartal, Konflikte aus den Abhängigkeiten, Lücken aus den Pflichtfeldern.', 'Progress = logged ÷ (logged + remaining + open T-shirt size). Forecast = logged + remaining. Bottlenecks from the waterline per quarter, conflicts from the dependencies, gaps from the required fields.'),
      inputs: [[T(L, 'Plan', 'Plan'), F.h(m.OE)], [T(L, 'Gebucht', 'Logged'), F.h(m.TS)], [T(L, 'Rest', 'Remaining'), F.h(m.RE)], [T(L, 'Stories', 'Stories'), String(m.storyCount)], [T(L, 'Reife', 'Maturity'), m.maturity == null ? '–' : F.pct(m.maturity)]] };
    s.confidence = m.maturity == null ? 'low' : m.maturity >= 0.7 ? 'high' : m.maturity >= 0.4 ? 'medium' : 'low';
    s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity'), T(L, 'Wasserlinie', 'Waterline')];
    return done(s);
  },
};
