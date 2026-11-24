// Planning advice: the weekly-plan optimizer (shared/optimize.js) run for a team / project / everyone, one change per
// task – overload first (smooth, rebalance), then finishing sooner. Actions are the board's own moves ('move').
import { optimizeAll } from '../../optimize.js';
import { computedOf, dsOf, memo, newStory, addProject, addTeam, addPerson, kpi, ev, finding, action, follow, done, sum, T, say, worst, teamName, todayIso } from '../kit.js';
import { plural } from '../narrate.js';
import { pickTeam } from './teamBrief.js';

const ORDER = { smooth: 0, rebalance: 1, sooner: 2 };
// At most one suggestion per task: overload before speed-up, the lowest rank first (it moves before higher-ranked work).
export const PICK_MAX = { smooth: 4, rebalance: 3, sooner: 3 };
export function pickSuggestions(all) {
  const seen = new Set(), per = { smooth: 0, rebalance: 0, sooner: 0 };
  return ['smooth', 'rebalance', 'sooner'].flatMap((m) => all[m].suggestions).sort((a, b) => ORDER[a.mode] - ORDER[b.mode] || (b.rank ?? 0) - (a.rank ?? 0))
    .filter((x) => (seen.has(x.taskId) || per[x.mode] >= PICK_MAX[x.mode] ? false : (seen.add(x.taskId), (per[x.mode] += 1)))).slice(0, 12);
}
export const HORIZON_WEEKS = 12;

export default {
  id: 'planningAdvice',
  title: (L) => T(L, 'Planungsvorschläge', 'Planning advice'),
  params: ['team', 'project'],
  match: [/planungsvorschl|planning (advice|suggestions)|wochenplan|weekly plan|optimier|optimi[sz]e|umplanen|replan|glaetten|smooth|umverteil|rebalanc|entlast|relieve|besser (verteilen|planen)|plan (better|smarter)|frueher fertig|finish (sooner|earlier)|wie (verteile|plane) ich|how (should|do) i (plan|distribute)/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const { model } = c;
    const team = pickTeam(ctx, p);
    const project = p?.ref && model.itemByRef.has(p.ref) ? p.ref : null;
    const all = memo(ctx, `opt:${team}:${project}`, () => optimizeAll({ ds: dsOf(ctx), computed: c, team: project ? null : team, project, target: 1, horizonWeeks: HORIZON_WEEKS }));
    const scopeName = project ? model.itemByRef.get(project).name : team ? T(L, `Team ${teamName(model, team)}`, `team ${teamName(model, team)}`) : T(L, 'alle Teams', 'all teams');
    const s = newStory(ctx, { skill: 'planningAdvice', subject: project ? { kind: 'project', ref: project, name: model.itemByRef.get(project).name } : team ? { kind: 'team', ref: team, name: teamName(model, team) } : { kind: 'portfolio', ref: null, name: 'Portfolio' }, lang: L });
    const F = s.fmt;
    if (project) addProject(s, model.itemByRef.get(project));
    if (team) addTeam(s, model, team);
    const picks = pickSuggestions(all);
    const count = (m) => picks.filter((x) => x.mode === m);
    const smooth = count('smooth'), rebal = count('rebalance'), sooner = count('sooner');
    const notes = all.smooth.notes || [];
    const weeksSaved = sum(sooner, (x) => x.weeksSaved || 0);
    s.kpis.push(kpi('overloaded', T(L, 'Personen mit Überlast', 'People overloaded'), all.overloaded || 0, 'n', { tone: all.overloaded ? 'bad' : 'ok' }));
    s.kpis.push(kpi('suggestions', T(L, 'Vorschläge', 'Suggestions'), picks.length, 'n', { tone: 'ink' }));
    s.kpis.push(kpi('relieve', T(L, 'Entlasten', 'Relieve'), smooth.length + rebal.length, 'n', { tone: smooth.length + rebal.length ? 'warn' : 'ok' }));
    s.kpis.push(kpi('weeksSaved', T(L, 'Wochen früher fertig', 'Weeks sooner'), weeksSaved, 'n', { tone: 'ok' }));
    const dated = picks.filter((x) => x.newStart && x.newDue).slice(0, 12);
    const today = todayIso(ctx);
    if (dated.length) {
      const all2 = dated.flatMap((x) => [x.start, x.due, x.newStart, x.newDue]).filter(Boolean).sort();
      s.visual = {
        kind: 'gantt',
        data: { from: all2[0] < today ? all2[0] : today, to: all2.at(-1), today, rows: dated.map((x) => {
          const who = x.mode === 'rebalance' ? addPerson(s, ctx, x.toPersonId) : addPerson(s, ctx, x.personId);
          const moved = x.start && x.due && (x.start !== x.newStart || x.due !== x.newDue);
          return { label: `${x.key}${who ? ` · ${x.mode === 'rebalance' ? '→ ' : ''}${who}` : ''}`, key: x.key, ref: x.ref, start: x.newStart, end: x.newDue, tone: x.mode === 'smooth' ? 'warn' : x.mode === 'rebalance' ? 'info' : 'ok', ...(moved ? { before: { start: x.start, end: x.due } } : {}) };
        }) },
        caption: T(L, 'Vorgeschlagene Änderungen: Balken = neuer Zeitraum, Schatten = bisher; gelb glätten, blau umverteilen, grün früher fertig.', 'Suggested changes: bar = new period, shadow = before; yellow smooth, blue rebalance, green finish sooner.'),
      };
    } else {
      s.visual = { kind: 'donut', data: { unit: 'n', total: all.considered || 0, items: [{ label: T(L, 'Aufgaben geprüft', 'Tasks checked'), value: all.considered || 0, tone: 'ok' }] }, caption: T(L, 'Geprüfte Aufgaben mit Schätzung, Terminen und Person – keine Änderung nötig.', 'Checked tasks with an estimate, dates and a person – no change needed.') };
    }
    if (smooth.length) {
      const x = smooth[0];
      addProject(s, model.itemByRef.get(x.ref));
      s.findings.push(finding(T(L, `${smooth.length} ${plural(smooth.length, 'Aufgabe', 'Aufgaben')} strecken oder verschieben nimmt Überlast heraus – z. B. ${x.key} (Rang ${x.rank}) ${x.kind === 'shift' ? `um ${x.shiftWeeks} ${plural(x.shiftWeeks, 'Woche', 'Wochen')} später` : `auf ${x.toWeeks} statt ${x.fromWeeks} Wochen gestreckt`}.`, `Stretching or moving ${smooth.length} ${plural(smooth.length, 'task', 'tasks')} removes overload – e.g. ${x.key} (rank ${x.rank}) ${x.kind === 'shift' ? `${x.shiftWeeks} ${plural(x.shiftWeeks, 'week', 'weeks')} later` : `stretched over ${x.toWeeks} instead of ${x.fromWeeks} weeks`}.`), 'warn', 82,
        [ev(T(L, 'Glätten', 'Smooth'), smooth.length, 'n'), ev(T(L, 'Wochen später', 'weeks later'), x.shiftWeeks || 0, 'n'), ev(T(L, 'Wochen vorher', 'weeks before'), x.fromWeeks, 'n', { key: x.key }), ev(T(L, 'Wochen danach', 'weeks after'), x.toWeeks, 'n'), ev(T(L, 'neues Ende', 'new end'), x.newDue, 'date')]));
    }
    if (rebal.length) {
      const x = rebal[0];
      const to = addPerson(s, ctx, x.toPersonId) || T(L, 'eine Kolleg:in', 'a colleague');
      const from = addPerson(s, ctx, x.personId) || T(L, 'der bisherigen Person', 'the current person');
      s.findings.push(finding(T(L, `${rebal.length} ${plural(rebal.length, 'Aufgabe', 'Aufgaben')} an Kolleg:innen mit Luft geben – z. B. ${x.key} von ${from} an ${to} (danach höchstens ${Math.round(x.toLoad[1] * 100)} %).`, `Hand ${rebal.length} ${plural(rebal.length, 'task', 'tasks')} to colleagues with room – e.g. ${x.key} from ${from} to ${to} (at most ${Math.round(x.toLoad[1] * 100)}% after).`), 'warn', 72,
        [ev(T(L, 'Umverteilen', 'Rebalance'), rebal.length, 'n'), ev(T(L, 'Auslastung danach', 'load after'), Math.round(x.toLoad[1] * 100), '%', { key: x.key }), ev(T(L, 'bisher', 'before'), Math.round(x.toLoad[0] * 100), '%')]));
    }
    if (sooner.length) s.findings.push(finding(T(L, `${sooner.length} ${plural(sooner.length, 'Aufgabe kann', 'Aufgaben können')} früher fertig werden, zusammen ${weeksSaved} ${plural(weeksSaved, 'Woche', 'Wochen')} – ohne neue Überlast.`, `${sooner.length} ${plural(sooner.length, 'task', 'tasks')} can finish sooner, ${weeksSaved} ${plural(weeksSaved, 'week', 'weeks')} in total – without new overload.`), 'ok', 45,
      [ev(T(L, 'Früher fertig', 'Sooner'), sooner.length, 'n'), ev(T(L, 'Wochen gespart', 'weeks saved'), weeksSaved, 'n'), ...sooner.slice(0, 3).map((x) => ev(T(L, 'neues Ende', 'new end'), x.newDue, 'date', { key: x.key }))]));
    if (notes.length) s.findings.push(finding(T(L, `Bei ${notes.length} ${plural(notes.length, 'Person', 'Personen')} bleibt Überlast, die sich nicht durch Verschieben vor den Termin lösen lässt – dort hilft nur Umpriorisieren oder mehr Kapazität.`, `${notes.length} ${plural(notes.length, 'person keeps', 'people keep')} overload that moving cannot solve before the due date – only re-prioritising or more capacity helps there.`), 'bad', 76,
      [ev(T(L, 'nicht lösbar', 'not solvable'), notes.length, 'n'), ...notes.slice(0, 3).map((n) => ev(T(L, 'betrifft', 'concerns'), undefined, null, { key: n.key }))]));
    if (!s.findings.length) s.findings.push(finding(T(L, `${all.considered || 0} Aufgaben geprüft: keine Überlast und nichts, das früher fertig werden kann.`, `${all.considered || 0} tasks checked: no overload and nothing that can finish sooner.`), 'ok', 10, [ev(T(L, 'geprüft', 'checked'), all.considered || 0, 'n')]));
    s.tone = worst(...s.findings.map((f) => f.tone));
    s.headline = picks.length
      ? say(s.id, 'h', [T(L, `${picks.length} Vorschläge für ${scopeName}: ${smooth.length + rebal.length} entlasten, ${sooner.length} machen früher fertig.`, `${picks.length} suggestions for ${scopeName}: ${smooth.length + rebal.length} relieve overload, ${sooner.length} finish sooner.`),
        T(L, `Für ${scopeName} schlägt Lotse ${picks.length} Änderungen vor – zuerst Überlast raus (${smooth.length + rebal.length}), dann früher fertig (${sooner.length}).`, `For ${scopeName} Lotse suggests ${picks.length} changes – overload first (${smooth.length + rebal.length}), then finishing sooner (${sooner.length}).`)])
      : T(L, `Für ${scopeName} ist nichts umzuplanen: ${all.considered || 0} Aufgaben geprüft.`, `Nothing to replan for ${scopeName}: ${all.considered || 0} tasks checked.`);
    s.kpis[2] = { ...s.kpis[2], hint: T(L, 'glätten + umverteilen', 'smooth + rebalance') };
    for (const x of picks.slice(0, 3)) {
      const label = { smooth: T(L, 'glätten', 'smooth'), rebalance: T(L, 'umverteilen', 'rebalance'), sooner: T(L, 'früher fertig', 'sooner') }[x.mode];
      s.actions.push(action(`move:${x.id}`, `${x.key} ${label}`, 'move', { suggestionId: x.id, taskId: x.taskId, key: x.key, mode: x.mode, move: x.move }, x.reason?.[L === 'en' ? 'en' : 'de'] || label));
    }
    s.followUps.push(follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')), follow(T(L, 'Überstunden', 'Overtime'), T(L, 'Wer macht bald Überstunden?', 'Who is heading for overtime?')),
      follow(T(L, 'Was passt ohne Überstunden?', 'What fits without overtime?'), T(L, 'Was passt ohne Überstunden?', 'What fits without overtime?')));
    s.how = { text: T(L, 'Der Optimierer der Wochenplanung: Kapazität je Person und Woche (nach Feiertagen, Abwesenheit, Tagesgeschäft und Support) gegen alle ihre Aufgaben. Erst Überlast glätten (niedriger Rang zuerst), dann an Kolleg:innen mit Luft geben, dann früher fertig – je Aufgabe höchstens eine Änderung, nie über den Projekt-Termin.', 'The weekly plan optimizer: capacity per person and week (after holidays, absence, daily business and support) against all their tasks. Smooth overload first (low rank first), then hand to colleagues with room, then finish sooner – at most one change per task, never past the project due date.'),
      inputs: [[T(L, 'Ziel-Auslastung', 'Target load'), '100 %'], [T(L, 'Horizont', 'Horizon'), `${all.horizon} ${T(L, 'Wochen', 'weeks')}`], [T(L, 'Gefunden', 'Found'), `${all.smooth.count} / ${all.rebalance.count} / ${all.sooner.count}`], [T(L, 'Geprüft', 'Checked'), String(all.considered || 0)], [T(L, 'Ausgelassen', 'Skipped'), String((all.skipped?.pending || 0) + (all.skipped?.hidden || 0) + (all.skipped?.unassigned || 0))]] };
    s.confidence = all.considered >= 10 ? 'high' : 'medium';
    s.sources = ['Jira', T(L, 'Kapazitäten', 'Capacity'), T(L, 'Wochenplanung', 'Weekly plan')];
    return done(s);
  },
};
