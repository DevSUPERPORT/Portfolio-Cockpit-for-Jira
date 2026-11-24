// Health draft: a proposed status and one sentence for a project's health update, computed from its metrics (late,
// overdue stories, conflicts, staffing). Nothing is saved – the action opens the health dialog prefilled.
import { actionItems, dataQuality } from '../../engine.js';
import { computedOf, newStory, addProject, addTeam, kpi, ev, finding, action, follow, done, infoStory, pickProject, urgentProject, pctPts, T, say } from '../kit.js';
import { healthName, plural } from '../narrate.js';

export function draftHealth(ctx, it, L, F) {
  const c = computedOf(ctx);
  const { model, metrics, wl, deps } = c;
  const m = metrics.get(it.ref);
  const acts = actionItems(model, it, m, wl, deps, dataQuality(model, new Set([it.ref])));
  const conflicts = acts.filter((a) => a.kind === 'conflict').length;
  const cap = acts.filter((a) => a.kind === 'capacity' && a.q === wl.quarters[0]);
  const longOverdue = acts.some((a) => a.kind === 'overdue' && a.days > 14);
  const status = m.daysOverdue > 0 || longOverdue || cap.some((a) => a.status === 'no') ? 'critical' : m.overdueCount || conflicts || cap.length ? 'atRisk' : 'onTrack';
  const bits = [];
  if (m.daysOverdue > 0) bits.push(T(L, `${m.daysOverdue} Tage über dem Termin`, `${m.daysOverdue} days past due`));
  if (m.overdueCount) bits.push(T(L, `${m.overdueCount} ${plural(m.overdueCount, 'Story', 'Stories')} über Due Date`, `${m.overdueCount} ${plural(m.overdueCount, 'story', 'stories')} past due`));
  if (conflicts) bits.push(T(L, `${conflicts} ${plural(conflicts, 'Terminkonflikt', 'Terminkonflikte')}`, `${conflicts} schedule ${plural(conflicts, 'conflict', 'conflicts')}`));
  if (cap.length) bits.push(T(L, `Engpass in ${F.quarter(wl.quarters[0])}`, `bottleneck in ${F.quarter(wl.quarters[0])}`));
  const progress = pctPts(m.progress);
  const comment = T(L, `Fortschritt ${progress} %${bits.length ? `; offen: ${bits.join(', ')}` : ', keine akuten Risiken'}.`, `Progress ${progress}%${bits.length ? `; open: ${bits.join(', ')}` : ', no acute risks'}.`);
  return { status, comment, m, conflicts, cap, progress };
}

export default {
  id: 'healthDraft',
  title: (L) => T(L, 'Health-Entwurf', 'Health draft'),
  params: ['project'],
  match: [/health|gesundheit|ampel|status ?update|statusbericht|status report|rag status|(draft|entwurf|entwirf).*status|status.*(draft|entwurf)/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const { model, wl } = c;
    const it = pickProject(ctx, p) || (p?.any ? urgentProject(ctx) : null);
    if (!it) return infoStory(ctx, { skill: 'healthDraft', lang: L, headline: T(L, 'Für welches Projekt soll Lotse ein Health-Update entwerfen?', 'Which project should Lotse draft a health update for?'), finding: T(L, 'In der Frage steht kein Projekt aus dem Portfolio.', 'The question names no project of the portfolio.'), followUps: model.items.slice(0, 3).map((x) => follow(x.name, T(L, `Health-Entwurf für ${x.name}`, `Health draft for ${x.name}`))) });
    const s = newStory(ctx, { skill: 'healthDraft', subject: { kind: 'project', ref: it.ref, name: it.name }, lang: L });
    const F = s.fmt;
    const name = addProject(s, it);
    const d = draftHealth(ctx, it, L, F);
    const { m } = d;
    const stories = (model.byRoot.get(it.ref) || []).filter((i) => i.role === 'estimate');
    const doneN = stories.filter((i) => i.status?.cat === 'done').length;
    const blockedN = stories.filter((i) => i.status?.cat !== 'done' && model.isBlocked(i)).length;
    const lateN = m.overdueCount;
    const onTime = stories.length - doneN - blockedN - lateN;
    s.kpis.push(kpi('progress', T(L, 'Fortschritt', 'Progress'), d.progress, '%', { tone: 'ink' }));
    s.kpis.push(kpi('overdue', T(L, 'Stories überfällig', 'Stories overdue'), lateN, 'n', { tone: lateN ? 'bad' : 'ok' }));
    s.kpis.push(kpi('conflicts', T(L, 'Terminkonflikte', 'Schedule conflicts'), d.conflicts, 'n', { tone: d.conflicts ? 'warn' : 'ok' }));
    if (m.daysOverdue > 0) s.kpis.push(kpi('late', T(L, 'Tage über Termin', 'Days past due'), m.daysOverdue, 'd', { tone: 'bad' }));
    s.visual = {
      kind: 'donut',
      data: { unit: 'n', total: stories.length, items: [{ label: T(L, 'erledigt', 'done'), value: doneN, tone: 'ok' }, { label: T(L, 'offen im Termin', 'open, on time'), value: Math.max(0, onTime), tone: 'info' }, { label: T(L, 'überfällig', 'overdue'), value: lateN, tone: 'bad' }, { label: T(L, 'blockiert', 'blocked'), value: blockedN, tone: 'warn' }] },
      caption: T(L, `Die ${stories.length} Stories von ${name} nach Lage.`, `The ${stories.length} stories of ${name} by state.`),
    };
    const tone = { onTrack: 'ok', atRisk: 'warn', critical: 'bad' }[d.status];
    s.findings.push(finding(T(L, `Vorschlag: „${healthName(d.status, L)}“ – ${d.comment}`, `Suggestion: "${healthName(d.status, L)}" – ${d.comment}`), tone, 90,
      [ev(T(L, 'Fortschritt', 'Progress'), d.progress, '%'), ...(m.daysOverdue > 0 ? [ev(T(L, 'Tage über Termin', 'days past due'), m.daysOverdue, 'd')] : []), ev(T(L, 'Stories überfällig', 'stories overdue'), lateN, 'n'), ev(T(L, 'Konflikte', 'conflicts'), d.conflicts, 'n'), ...(d.cap.length ? [ev(T(L, 'Quartal', 'Quarter'), wl.quarters[0], 'quarter')] : [])]));
    if (it.health) {
      const same = it.health.status === d.status;
      s.findings.push(finding(same ? T(L, `Das passt zum letzten Update („${healthName(it.health.status, L)}“).`, `That matches the last update ("${healthName(it.health.status, L)}").`) : T(L, `Das letzte Update sagt „${healthName(it.health.status, L)}“ – die Zahlen sprechen für „${healthName(d.status, L)}“.`, `The last update says "${healthName(it.health.status, L)}" – the numbers point to "${healthName(d.status, L)}".`), same ? 'ok' : 'warn', same ? 20 : 60,
        [ev(T(L, 'letztes Update', 'last update'), String(it.health.at || '').slice(0, 10) || undefined, it.health.at ? 'date' : null, { text: it.health.comment || undefined })]));
    } else s.findings.push(finding(T(L, `${name} hat noch kein Health-Update.`, `${name} has no health update yet.`), 'info', 30, []));
    for (const a of d.cap.slice(0, 1)) {
      const tn = addTeam(s, model, a.teamId);
      if (tn) s.findings.push(finding(T(L, `Engpass bei Team ${tn} in ${F.quarter(a.q)}: ${F.h(a.missing)} fehlen.`, `Bottleneck in team ${tn} in ${F.quarter(a.q)}: ${F.h(a.missing)} missing.`), 'warn', 50, [ev(T(L, 'Fehlt', 'Missing'), a.missing, 'h', { ref: `team:${a.teamId}` }), ev(T(L, 'Quartal', 'Quarter'), a.q, 'quarter')]));
    }
    s.tone = tone;
    s.headline = say(s.id, 'h', [T(L, `Health-Vorschlag für ${name}: ${healthName(d.status, L)} – ${d.comment}`, `Health suggestion for ${name}: ${healthName(d.status, L)} – ${d.comment}`), T(L, `${name}: Lotse würde „${healthName(d.status, L)}“ melden – ${d.comment}`, `${name}: Lotse would report "${healthName(d.status, L)}" – ${d.comment}`)]);
    s.actions.push(action('health', T(L, 'Als Health übernehmen', 'Use as health update'), 'navigate', { view: 'portfolio', ref: it.ref, status: d.status, comment: d.comment, opts: { ref: it.ref, health: { ref: it.ref, status: d.status, comment: d.comment } } }, T(L, `Öffnet den Health-Dialog mit „${healthName(d.status, L)}“ und dem Satz – gespeichert wird erst, wenn du bestätigst.`, `Opens the health dialog with "${healthName(d.status, L)}" and the sentence – saved only when you confirm.`)));
    s.followUps.push(follow(T(L, 'Lagebild', 'Briefing'), T(L, `Lagebild ${name}`, `Briefing ${name}`)), follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')), follow(T(L, 'Blockaden', 'Blockers'), T(L, `Was blockiert ${name}?`, `What blocks ${name}?`)));
    s.how = { text: T(L, 'Kritisch = Projekt über dem Termin, eine Story mehr als 14 Tage überfällig oder im aktuellen Quartal nicht besetzbar. Gefährdet = überfällige Stories, Terminkonflikte oder ein Engpass im aktuellen Quartal. Sonst im Plan.', 'Critical = project past its due date, a story more than 14 days overdue, or not staffable in the current quarter. At risk = overdue stories, schedule conflicts or a bottleneck in the current quarter. Otherwise on track.'), inputs: [[T(L, 'Stories', 'Stories'), String(stories.length)], [T(L, 'Due Date', 'Due date'), m.due ? F.date(m.due) : '–']] };
    s.confidence = 'high';
    s.sources = ['Jira', T(L, 'Wasserlinie', 'Waterline')];
    return done(s);
  },
};
