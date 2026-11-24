// Lotse mission "Ausfall": something unforeseen took working days away – "Heute hat es stark geschneit, die Arbeit ist
// für die Woche ausgefallen, plane neu" / "the office is closed tomorrow (power cut) – rearrange the plan" (user
// 2026-11-17). Steps: which days → who → what is lost (story) → record it as absence? → re-plan the people who had
// work in those days (the same re-planner as "Meine Woche auf 100 %", on the numbers WITH the closure) → late work? →
// preview → apply. Nothing is written before the preview; every write has its own undo.
import { T, langOf, plural, fact, meId, can, teamLabel, personLabel, computedOf, dsOf } from './kit.js';
import { COMMANDS } from './commands.js';
import { replan } from '../plan/replan.js';
import { newStory, kpi, ev, finding, done as doneStory, sum, addPerson } from '../kit.js';
import { capacityPeople, computeAll } from '../../engine.js';
import { inTeam } from '../../allocation.js';
import { personWeekAvail, planTasks } from '../../weekPlan.js';
import { isoOf, mondayOf } from '../../dates.js';
import { movesStory, lateStep, planBatch } from './missionsPlan.js';

const optOf = (a) => (typeof a === 'string' ? a : a?.option ?? null);
const blockedWhy = (ctx, id) => { try { return COMMANDS[id]?.allowed?.(ctx) || null; } catch { return null; } };
export const PERIODS = ['today', 'week', 'tomorrow', 'nextWeek'];
const MAX_REPLAN_PEOPLE = 60;

// the days of a period (day indices, Mon–Fri only where it matters)
export function periodRange(period, today) {
  const mon = mondayOf(today);
  const nextWork = (d) => { let x = d + 1; while ((((x + 3) % 7) + 7) % 7 > 4) x++; return x; };
  switch (period) {
    case 'today': return [today, today];
    case 'tomorrow': { const d = nextWork(today); return [d, d]; }
    case 'nextWeek': return [mon + 7, mon + 11];
    // this week = from today to Friday (days already past are not lost any more)
    case 'week': default: return [Math.max(today, mon), Math.max(today, mon + 4)];
  }
}
// "heute" / "diese Woche" / "die ganze Woche" / "morgen" / "nächste Woche" in the sentence (folded text)
export function periodFromText(q) {
  const s = String(q || '');
  if (/naechste[nr]? woche|next week/.test(s)) return 'nextWeek';
  if (/(ganze|gesamte|diese|die|fuer die|for the|this|whole|entire) woche|(this|the|whole|entire) week|fuer die woche|for the week/.test(s)) return 'week';
  if (/\bmorgen\b|tomorrow/.test(s)) return 'tomorrow';
  if (/\bheute\b|\btoday\b/.test(s)) return 'today';
  return null;
}
export function scopeFromText(q) {
  const s = String(q || '');
  if (/\b(alle|allen|jeden|everyone|everybody|all of us|whole (company|team)|ganze[nrs]? (firma|unternehmen|buero|standort)|firma|company|office|buero)\b/.test(s)) return 'all';
  if (/\b(ich|mich|mir|i|me|my)\b/.test(s) && !/\b(wir|uns|we|us)\b/.test(s)) return 'me';
  return null;
}

export function disruptMissions() {
  const disruption = {
    id: 'disruption', title: (L) => T(L, 'Ausfall: Plan neu ordnen', 'Closure: rearrange the plan'), params: ['period', 'scope', 'team'],
    match: [
      /\b(schnee|geschneit|schneit|glatteis|sturm|unwetter|hochwasser|ueberschwemm\w*|stromausfall|internetausfall|streik|snow\w*|blizzard|storm|flood\w*|power (cut|outage)|outage|strike)\b.{0,120}\b(arbeit|work|buero|office|ausgefallen|faellt aus|geschlossen|closed|cancel+ed|zu|plan\w*|woche|week|tag|day)\b/,
      /\b(arbeit|work|buero|office|betrieb|standort)\b.{0,40}\b(ausgefallen|faellt\w* aus|fiel aus|geschlossen|zu|cancel+ed|closed|shut)\b/,
      /\b(ausfall|closure|shutdown|betriebsruhe|geschlossen|closed)\b.{0,60}\b(plan\w*|neu (ordnen|planen)|rearrange|re-?plan|umplanen|verschieben)\b/,
      /\b(plan\w*|rearrange|re-?plan|umplan\w*|neu (ordnen|planen))\b.{0,60}\b(ausfall|ausgefallen|geschlossen|closed|cancel+ed|schnee|snow\w*)\b/,
    ],
    plan(P, { period = null, scope = null, team = null }) {
      const { ctx } = P;
      const L = P.L;
      const c = computedOf(ctx);
      const ds = dsOf(ctx);
      const { model } = c;
      const people = capacityPeople(model);
      // 1. which days
      let per = PERIODS.includes(period) ? period : null;
      if (!per) {
        const a = P.decide('period', {
          question: P.t('Welche Tage fallen aus?', 'Which days are lost?'),
          options: [
            { id: 'today', label: P.t('Heute', 'Today') },
            { id: 'week', label: P.t('Diese Woche (ab heute)', 'This week (from today)'), recommended: true },
            { id: 'tomorrow', label: P.t('Morgen', 'Tomorrow') },
            { id: 'nextWeek', label: P.t('Nächste Woche', 'Next week') },
          ],
        });
        if (a === undefined) return;
        per = optOf(a);
      }
      const [a0, b0] = periodRange(per, model.today);
      const from = isoOf(a0), to = isoOf(b0);
      // 2. who
      let who = ['all', 'me', 'team'].includes(scope) ? scope : team ? 'team' : null;
      let tm = team || null;
      const myTeams = [...people.values()].filter((p) => p.id === meId(ctx)).flatMap((p) => (p.teams?.length ? p.teams.map((x) => x.teamId) : p.teamId ? [p.teamId] : []));
      if (!who) {
        const opts = [
          { id: 'all', label: P.t('Alle', 'Everyone'), detail: P.t('alle Personen mit Kapazität im Cockpit', 'everyone with capacity in the cockpit'), recommended: true },
          ...myTeams.slice(0, 3).map((t) => ({ id: `team:${t}`, label: P.t(`Team ${teamLabel(ctx, t)}`, `Team ${teamLabel(ctx, t)}`) })),
          ...(meId(ctx) && people.has(meId(ctx)) ? [{ id: 'me', label: P.t('Nur ich', 'Only me') }] : []),
        ];
        const a = P.decide('scope', { question: P.t('Wen betrifft der Ausfall?', 'Who is affected?'), options: opts });
        if (a === undefined) return;
        const o = optOf(a);
        if (o.startsWith('team:')) { who = 'team'; tm = o.slice(5); } else who = o;
      }
      const affected = [...people.values()].filter((p) => (who === 'all' ? true : who === 'me' ? p.id === meId(ctx) : inTeam(p, tm)) && !String(p.id).startsWith('anon-'));
      if (!affected.length) { P.summary(P.t('Niemand mit Kapazität ist betroffen – nichts zu planen.', 'Nobody with capacity is affected – nothing to plan.')); return; }
      // 3. what is lost: the time and the planned work in those days, per person
      const W = [{ a: a0, b: b0 }];
      const lost = affected.map((p) => {
        const av = personWeekAvail(model, p, a0, b0, c.support?.personWeekly?.[p.id] || 0);
        const tasks = planTasks(model, (ds.issues || []).filter((i) => i.assignee?.id === p.id), W, null).filter((t) => t.hours[0] > 0.05);
        return { id: p.id, avail: av.avail, tasks: tasks.map((t) => ({ id: t.id, key: t.key, summary: t.summary, hours: t.hours[0], due: t.due })), planned: sum(tasks, (t) => t.hours[0]) };
      });
      const s = newStory(ctx, { skill: 'disruption', subject: { kind: 'topic', ref: 'closure', name: P.t('Ausfall', 'Closure') }, lang: L });
      const F = s.fmt;
      const hLost = sum(lost, (x) => x.avail), hWork = sum(lost, (x) => x.planned);
      const hit = lost.filter((x) => x.planned > 0.05).sort((x, y) => y.planned - x.planned);
      const days = Math.round((b0 - a0) / 1) + 1;
      s.kpis.push(kpi('lost', P.t('Arbeitszeit fällt aus', 'Working time lost'), Math.round(hLost), 'h', { tone: 'bad' }));
      s.kpis.push(kpi('planned', P.t('Story-Arbeit in diesen Tagen', 'Story work in these days'), Math.round(hWork), 'h', { tone: hWork > 0.5 ? 'warn' : 'ok' }));
      s.kpis.push(kpi('people', P.t('Personen betroffen', 'People affected'), affected.length, 'n'));
      s.headline = P.t(`Ausfall ${F.date(from)} – ${F.date(to)}: ${F.h(hLost)} Arbeitszeit fallen weg; für diese Tage waren ${F.h(hWork)} Story-Arbeit geplant.`, `Closure ${F.date(from)} – ${F.date(to)}: ${F.h(hLost)} of working time are lost; ${F.h(hWork)} of story work was planned for these days.`);
      s.findings.push(finding(P.t(`${affected.length} ${plural(affected.length, 'Person ist', 'Personen sind')} betroffen, ${days} ${plural(days, 'Kalendertag', 'Kalendertage')} (${F.date(from)} – ${F.date(to)}).`, `${affected.length} ${plural(affected.length, 'person is', 'people are')} affected, ${days} calendar ${plural(days, 'day', 'days')} (${F.date(from)} – ${F.date(to)}).`), 'warn', 80,
        [ev(P.t('Personen', 'people'), affected.length, 'n'), ev(P.t('Kalendertage', 'calendar days'), days, 'n'), ev(P.t('Arbeitszeit', 'working time'), Math.round(hLost), 'h'), ev(P.t('ab', 'from'), from, 'date'), ev(P.t('bis', 'to'), to, 'date'), ev(P.t('für Stories geplant', 'planned for stories'), Math.round(hWork), 'h')]));
      if (hit.length) {
        const top = hit.slice(0, 3);
        for (const x of top) addPerson(s, ctx, x.id);
        s.findings.push(finding(P.t(`Am stärksten getroffen: ${top.map((x) => `${personLabel(ctx, x.id) || 'Person'} (${F.h(x.planned, 1)})`).join(', ')} – deren Stories müssen später laufen.`, `Hit hardest: ${top.map((x) => `${personLabel(ctx, x.id) || 'person'} (${F.h(x.planned, 1)})`).join(', ')} – their stories have to run later.`), 'bad', 90,
          top.map((x) => ev(personLabel(ctx, x.id) || P.t('Person', 'person'), Math.round(x.planned * 10) / 10, 'h', { ref: `person:${x.id}` }))));
      } else s.findings.push(finding(P.t('In diesen Tagen war keine Story-Arbeit geplant – der Plan bleibt, wie er ist.', 'No story work was planned in these days – the plan stays as it is.'), 'ok', 60, [ev(P.t('geplant', 'planned'), 0, 'h')]));
      s.visual = { kind: 'bars', data: { unit: 'h', items: (hit.length ? hit : lost).slice(0, 10).map((x) => ({ label: personLabel(ctx, x.id) || '–', value: Math.round(x.planned * 10) / 10, sub: P.t(`${F.h(x.avail, 1)} Arbeitszeit weg`, `${F.h(x.avail, 1)} of time lost`), tone: x.planned > 0.05 ? 'bad' : 'ok' })) }, caption: P.t('Geplante Story-Stunden je Person in den ausgefallenen Tagen.', 'Planned story hours per person in the lost days.') };
      s.how = { text: P.t('Arbeitszeit = Wochenstunden an den betroffenen Arbeitstagen nach Tagesgeschäft und Intern. Story-Stunden = Original Estimate gleichmäßig je Woche, wie in der Wochenplanung.', 'Working time = weekly hours on the affected working days after daily business and internal work. Story hours = original estimate spread per week, as in the weekly planning.'), inputs: [] };
      s.confidence = 'high';
      P.storyObj('story:impact', doneStory(s));
      if (!hit.length && !can.capacity(ctx)) { P.summary(P.t('Nichts neu zu planen.', 'Nothing to re-plan.')); return; }
      // 4. record it (so every plan and the board know these days are gone)?
      const capWhy = blockedWhy(ctx, 'capacity.closure');
      const rec = P.decide('record', {
        question: P.t(`Den Ausfall für ${affected.length} ${plural(affected.length, 'Person', 'Personen')} als Abwesenheit eintragen?`, `Record the closure as absence for ${affected.length} ${plural(affected.length, 'person', 'people')}?`),
        facts: [fact('n', affected.length)],
        options: [
          { id: 'record', label: P.t('Ja, eintragen', 'Yes, record it'), detail: capWhy || P.t('Wochenplanung, Kapazität und Prognosen rechnen dann ohne diese Tage – ein Klick macht es rückgängig', 'weekly planning, capacity and projections then leave these days out – one click undoes it'), recommended: !capWhy, disabled: !!capWhy },
          { id: 'plan', label: P.t('Nur den Plan neu ordnen', 'Only rearrange the plan'), detail: P.t('Abwesenheiten bleiben, wie sie sind', 'absences stay as they are'), recommended: !!capWhy },
        ],
      });
      if (rec === undefined) return;
      // the re-plan runs on the numbers WITH the closure (a copy of the data – nothing is changed here)
      const ds2 = { ...ds, capacity: { ...(ds.capacity || {}), absences: [...(ds.capacity?.absences || []), ...affected.map((p, i) => ({ id: `lotse-closure-${i}`, accountId: p.id, from, to, type: 'absent' }))] } };
      const ctx2 = { ...ctx, ds: ds2, computed: computeAll(ds2) };
      const planners = hit.slice(0, MAX_REPLAN_PEOPLE).map((x) => x.id);
      const cmds = optOf(rec) === 'record' ? [{ id: 'cmd:closure', command: 'capacity.closure', params: { people: affected.map((p) => p.id), from, to }, title: P.t('Ausfall eintragen', 'Record the closure') }] : [];
      if (planners.length) {
        // minimal change (E2E audit 2026-11-17: a one-day closure re-planned 52 unrelated stories): only the weeks of the
        // closure are fixed, only their work moves
        const opts = { people: planners, order: 'due', fixWeeks: 12, focus: [from, to], focusBase: computedOf(ctx).model };
        let r = replan(ctx2, opts);
        if (r.moves.length) P.storyObj('story:moves', movesStory(ctx2, r, { kind: 'topic', ref: 'closure', name: P.t('Ausfall', 'Closure') }));
        const lt = lateStep(P, r);
        if (lt === null) return;
        if (lt.lock.length) r = replan(ctx2, { ...opts, lock: lt.lock });
        cmds.push(...planBatch(P, r, 'cmd:plan', P.t('Neue Fenster in Jira setzen', 'Set the new windows in Jira')));
      }
      if (!cmds.length) { P.summary(P.t('Nichts zu ändern – der Plan passt auch mit dem Ausfall.', 'Nothing to change – the plan fits even with the closure.')); return; }
      P.batch('preview', cmds);
      P.summary(blockedWhy(ctx, 'plan.move') ? P.t('Den Plan in Jira ändern darf, wer die Wochenplanung ändern darf – zeig deiner Teamleitung diese Vorschau.', 'Changing the plan in Jira needs the right to change weekly planning – show this preview to your team lead.') : null);
    },
  };
  return [disruption];
}
