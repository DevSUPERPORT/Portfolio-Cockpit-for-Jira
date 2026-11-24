// Lotse mission "Mehrteam-Konflikte lösen" (user 2026-11-17: "one member that belongs to two teams can cause time
// conflicts … if it does, I want Lotse and AI to find a way to resolve everything automatically and implement a working
// solution"). Steps: the multi-team check (skills/splitCheck.js) → how (recommended: everything) → re-plan the people
// concerned ACROSS all their teams by project rank (the re-planner measures the whole person, so a week can never be
// filled twice), hand work that cannot fit over to a team colleague with room, hand work done outside the person's teams
// to a member of that team with room, and set the team shares to where the hours really go (so no team counts phantom
// capacity) → Lotse re-checks the RESULT with the same check before anything is shown → preview → apply (one undo).
//
// mode 'auto' (from the multi-team story, a chain or the Teams tab): no questions – the recommended way, late work
// planned honestly. Nothing is written before the preview: changing Jira and the capacities needs the person's OK there.
import { T, plural, fact, can, computedOf, dsOf, personLabel, teamLabel } from './kit.js';
import { replan } from '../plan/replan.js';
import { capacityPeople, computeAll, weeksUtilization, spreadWindow, shareIn } from '../../engine.js';
import { inTeam, allocationOf } from '../../allocation.js';
import { splitConflicts, realConflicts, sharesFromHours } from '../../splitPeople.js';
import { splitStory, scopeIds } from '../skills/splitCheck.js';
import { movesStory, lateStep, planBatch } from './missionsPlan.js';
import { weeksFrom, nextWorkday } from '../../dates.js';

const optOf = (a) => (typeof a === 'string' ? a : a?.option ?? null);
const EPS = 0.05;
const MAX_PEOPLE = 40;

// The data as it would be after the plan: moves ({ issue, start?, due?, assignee?, team? }) and shares ({ person, teams }).
export function simulate(ds, { moves = [], shares = [], people = null } = {}) {
  const byId = new Map();
  for (const m of moves) byId.set(String(m.issue), { ...(byId.get(String(m.issue)) || {}), ...m });
  const names = ds.people || {};
  const issues = (ds.issues || []).map((i) => {
    const m = byId.get(i.id);
    if (!m) return i;
    return { ...i, ...(m.start !== undefined ? { start: m.start } : {}), ...(m.due !== undefined ? { due: m.due } : {}),
      ...(m.assignee !== undefined ? { assignee: m.assignee ? { id: m.assignee, name: names[m.assignee]?.name || '', avatar: null } : null } : {}),
      ...(m.team !== undefined ? { team: m.team ? { id: m.team, name: (ds.teams || []).find((t) => t.id === m.team)?.name || '' } : null } : {}) };
  });
  let capacity = ds.capacity;
  if (shares.length) {
    capacity = { ...(capacity || {}), people: { ...(capacity?.people || {}) } };
    for (const s of shares) {
      const cur = capacity.people[s.person] || { weeklyHours: people?.get(s.person)?.weeklyHours ?? 40, location: people?.get(s.person)?.location || 'NONE' };
      const main = s.teams.some((x) => x.teamId === cur.teamId) ? cur.teamId : [...s.teams].sort((a, b) => b.pct - a.pct)[0].teamId;
      capacity.people[s.person] = { ...cur, teamId: main, teams: s.teams.map((x) => ({ teamId: x.teamId, pct: x.pct })) };
    }
  }
  return { ...ds, issues, capacity };
}

// Work done outside the person's teams → the member of that team with the most room in the work's weeks (≤ 100 %).
function outsideHandovers(c, r, skip) {
  const { model, support } = c;
  const people = capacityPeople(model);
  const wu = weeksUtilization(model, support, 12);
  const load = new Map();
  for (const t of wu.teams) for (const m of t.members) if (!load.has(m.id)) load.set(m.id, { plan: [...m.plan], cap: m.cap });
  const W = weeksFrom(model.today, 12);
  const out = [];
  for (const x of realConflicts(r).filter((k) => k.kind === 'outsideWork')) {
    for (const t of x.tasks) {
      if (skip.has(t.id)) continue;
      const i = model.byId.get(t.id);
      if (!i || !(i.re > 0)) continue;
      const win = spreadWindow(i, 're', model.today) || [nextWorkday(model.today), nextWorkday(model.today)];
      const h = W.map(([a, b]) => shareIn(i.re, a, b, win, 'linear'));
      let best = null;
      for (const p of people.values()) {
        if (p.id === x.personId || !inTeam(p, x.teamId) || String(p.id).startsWith('anon') || !model.ds.people?.[p.id]?.name) continue;
        const l = load.get(p.id);
        if (!l) continue;
        const peak = Math.max(...h.map((v, w) => (v > EPS ? (l.cap[w] > EPS ? (l.plan[w] + v) / l.cap[w] : Infinity) : 0)));
        if (peak <= 1.0 + 1e-9 && (!best || peak < best.peak)) best = { p, peak };
      }
      if (!best) continue;
      const l = load.get(best.p.id);
      h.forEach((v, w) => { l.plan[w] += v; }); // the next task sees this one
      out.push({ issue: t.id, key: t.key, assignee: best.p.id, from: x.personId, teamId: x.teamId, peak: best.peak, hours: t.hours });
      skip.add(t.id);
    }
  }
  return out;
}

export function splitMissions() {
  const splitResolve = {
    id: 'splitResolve', title: (L) => T(L, 'Mehrteam-Konflikte lösen', 'Resolve multi-team conflicts'), params: ['person', 'team', 'mode'],
    match: [
      /\b(loes\w*|behebe?\w*|klaer\w*|repariere?\w*|bereinig\w*|fix\w*|resolve\w*|solve\w*|sort\w* out|repair\w*|clean up)\b.{0,50}\b(mehrteam\w*|mehrere[nr]? teams|zwei teams|beide[nr]? teams|two teams|both teams|several teams|multiple teams|multi-?team\w*|doppelt verplant\w*|double[- ]?book\w*|team-?anteile?|team shares?|phantom\w*)/,
      /\b(mehrteam|multi-?team)[- ]?konflikt\w*\b.{0,30}\b(loes\w*|beheb\w*|resolve|fix)/,
    ],
    plan(P, { person = null, team = null, mode = null }) {
      const { ctx } = P;
      const L = P.L;
      const c = computedOf(ctx);
      const ds = dsOf(ctx);
      const { model } = c;
      const people = capacityPeople(model);
      // 1. what is wrong (the same check the person can ask for)
      const only = scopeIds(ctx, { person, team });
      const r0 = splitConflicts(model, c.support, { only });
      P.storyObj('story:check', splitStory(ctx, r0, { person, team, L, skill: 'splitResolve' }));
      const real0 = realConflicts(r0);
      if (!real0.length) { P.summary(P.t('Keine Mehrteam-Konflikte – niemand ist doppelt verplant, die Anteile passen. Nichts zu tun.', 'No multi-team conflicts – nobody is double booked, the shares fit. Nothing to do.')); return; }
      const ids = [...new Set(real0.map((x) => x.personId))].slice(0, MAX_PEOPLE);
      const kinds = new Set(real0.map((x) => x.kind));
      const canPlan = can.plan(ctx), canCap = can.capacity(ctx);
      // 2. how
      let how = ['auto', 'replan', 'shares'].includes(mode) ? mode : null;
      const auto = mode === 'auto';
      if (!how) {
        const a = P.decide('how', {
          question: P.t(`${real0.length} ${plural(real0.length, 'Konflikt', 'Konflikte')} bei ${ids.length} ${plural(ids.length, 'Person', 'Personen')} – wie soll Lotse sie lösen?`, `${real0.length} ${plural(real0.length, 'conflict', 'conflicts')} for ${ids.length} ${plural(ids.length, 'person', 'people')} – how should Lotse resolve them?`),
          facts: [fact('n', real0.length), fact('people', ids.length)],
          options: [
            { id: 'auto', label: P.t('Alles lösen', 'Resolve everything'), detail: P.t('Über alle Teams nach Projektrang neu planen, Arbeit ohne Platz an Kolleg:innen mit Luft geben, Anteile an die echte Arbeit anpassen – Lotse prüft das Ergebnis, bevor du es siehst', 'Re-plan across all teams by project rank, hand work without room to colleagues with time, fit the shares to the real work – Lotse checks the result before you see it'), recommended: canPlan || canCap, disabled: !canPlan && !canCap },
            { id: 'replan', label: P.t('Nur neu planen', 'Only re-plan'), detail: P.t('Termine verschieben, niemand wechselt, Anteile bleiben', 'Move dates, nobody changes, shares stay'), disabled: !canPlan || !(kinds.has('overbooked') || kinds.has('priority')) },
            { id: 'shares', label: P.t('Nur Anteile anpassen', 'Only fit the shares'), detail: P.t('Der Plan bleibt; jedes Team rechnet danach mit den Stunden, die es wirklich bekommt', 'The plan stays; afterwards every team counts the hours it really gets'), disabled: !canCap || !(kinds.has('shareDrift') || kinds.has('sharesOff')) },
          ],
        });
        if (a === undefined) return;
        how = optOf(a);
      }
      const cmds = [];
      const moves = [];
      let r = null;
      // 3. re-plan the people across ALL their teams (the re-planner measures the whole person: one week, one limit)
      if (how !== 'shares' && canPlan && (kinds.has('overbooked') || kinds.has('priority'))) {
        const opts = { people: ids, order: 'rank', handover: how === 'auto', fixWeeks: 12 };
        r = replan(ctx, opts);
        if (r.moves.length) P.storyObj('story:moves', movesStory(ctx, r, { kind: 'topic', ref: 'split', name: P.t('Mehrteam', 'Multi-team') }));
        if (!auto) {
          const lt = lateStep(P, r);
          if (lt === null) return;
          if (lt.lock.length) r = replan(ctx, { ...opts, lock: lt.lock });
        }
        for (const m of r.moves) moves.push({ issue: m.issueId, start: m.to.start, due: m.to.due, ...(m.to.assignee ? { assignee: m.to.assignee } : {}) });
        cmds.push(...planBatch(P, r, 'cmd:plan', P.t('Neue Fenster in Jira setzen', 'Set the new windows in Jira')));
      }
      // 4. work outside the person's teams → a member of that team with room (only when everything is resolved)
      let ds1 = simulate(ds, { moves });
      let c1 = moves.length ? computeAll(ds1) : c;
      if (how === 'auto' && canPlan && kinds.has('outsideWork')) {
        const r1 = splitConflicts(c1.model, c1.support, { only: new Set(ids) });
        const hand = outsideHandovers(c1, r1, new Set(moves.filter((m) => m.assignee).map((m) => String(m.issue))));
        if (hand.length) {
          cmds.push({ id: 'cmd:handover', command: 'plan.move', params: { moves: hand.map((h) => ({ issue: h.issue, assignee: h.assignee })) }, title: P.t(`${hand.length} ${plural(hand.length, 'Vorgang', 'Vorgänge')} an ein Mitglied des Teams geben`, `Give ${hand.length} work ${plural(hand.length, 'item', 'items')} to a member of the team`) });
          moves.push(...hand.map((h) => ({ issue: h.issue, assignee: h.assignee })));
          ds1 = simulate(ds, { moves });
          c1 = computeAll(ds1);
        }
      }
      // 4b. work outside the person's teams that nobody of that team can take: the work item's team becomes the person's
      // (main) team – the hours then count where they are done. Asked unless mode 'auto'; listed in the preview, undoable.
      if (how === 'auto' && canPlan) {
        const rx = splitConflicts(c1.model, c1.support, { only: new Set(ids) });
        const p1 = capacityPeople(c1.model);
        const left = realConflicts(rx).filter((k) => k.kind === 'outsideWork').flatMap((k) => k.tasks.map((t) => ({ ...t, personId: k.personId, from: k.teamId, to: p1.get(k.personId)?.teamId || null }))).filter((t) => t.to && t.to !== t.from);
        if (left.length) {
          let go = auto;
          if (!go) {
            const a = P.decide('outside', {
              question: P.t(`${left.length} ${plural(left.length, 'Vorgang wird', 'Vorgänge werden')} von Personen außerhalb ${plural(left.length, 'seines', 'ihres')} Teams bearbeitet, und dort hat niemand Luft – was gilt?`, `${left.length} work ${plural(left.length, 'item is', 'items are')} done by people outside ${plural(left.length, 'its', 'their')} team, and nobody there has room – what applies?`),
              facts: [fact('n', left.length)],
              options: [
                { id: 'team', label: P.t('Team an die Person anpassen', 'Move the team to the person'), detail: P.t('Das Team-Feld wird zum Team der Person – die Stunden zählen dort, wo sie geleistet werden', 'The Team field becomes the person\'s team – the hours count where they are done'), recommended: true },
                { id: 'leave', label: P.t('So lassen', 'Leave it'), detail: P.t('Der Teams-Tab markiert sie weiter als „Nicht im Team“', 'The Teams tab keeps flagging them as "not in team"') },
              ],
            });
            if (a === undefined) return;
            go = optOf(a) === 'team';
          }
          if (go) {
            cmds.push({ id: 'cmd:team', command: 'plan.move', params: { moves: left.slice(0, 200).map((t) => ({ issue: t.id, team: t.to })) }, title: P.t(`Team von ${Math.min(200, left.length)} ${plural(left.length, 'Vorgang', 'Vorgängen')} an die Person anpassen`, `Move the team of ${Math.min(200, left.length)} work ${plural(left.length, 'item', 'items')} to the person`) });
            moves.push(...left.slice(0, 200).map((t) => ({ issue: t.id, team: t.to })));
            ds1 = simulate(ds, { moves });
            c1 = computeAll(ds1);
          }
        }
      }
      // 5. shares that follow the work AFTER the plan – so no team counts hours another team uses
      const shares = [];
      if (how !== 'replan' && canCap) {
        const p1 = capacityPeople(c1.model);
        const r1 = splitConflicts(c1.model, c1.support, { only: new Set(ids) });
        for (const pp of r1.people) {
          const drift = pp.conflicts.find((x) => x.kind === 'shareDrift');
          const off = pp.conflicts.find((x) => x.kind === 'sharesOff');
          if (!drift && !off) continue;
          const members = allocationOf(p1.get(pp.id) || {}).map((x) => x.teamId);
          const next = (drift && drift.suggested) || sharesFromHours(pp.actual, members) || (off ? members.map((teamId, k) => ({ teamId, pct: k ? Math.floor(100 / members.length) : 100 - Math.floor(100 / members.length) * (members.length - 1) })) : null);
          if (!next || next.length < 2) continue;
          const same = next.every((x) => pp.teams.some((t) => t.teamId === x.teamId && t.pct === x.pct));
          if (same) continue;
          shares.push({ person: pp.id, teams: next });
          cmds.push({ id: `cmd:shares:${pp.id}`, command: 'capacity.setShares', params: { person: pp.id, teams: next }, title: P.t(`Anteile ${personLabel(ctx, pp.id) || 'Person'}: ${next.map((x) => `${teamLabel(ctx, x.teamId)} ${x.pct} %`).join(' / ')}`, `Shares ${personLabel(ctx, pp.id) || 'person'}: ${next.map((x) => `${teamLabel(ctx, x.teamId)} ${x.pct} %`).join(' / ')}`) });
        }
      }
      // 6. Lotse checks the result with the same check – before anything is shown or written
      const ds2 = shares.length ? simulate(ds1, { shares, people }) : ds1;
      const c2 = shares.length ? computeAll(ds2) : c1;
      const r2 = splitConflicts(c2.model, c2.support, { only: new Set(ids) });
      const real2 = realConflicts(r2);
      const after = splitStory({ ...ctx, ds: ds2, computed: c2 }, r2, { person, team, L, skill: 'splitResolve' });
      after.id = 'splitResolve:after';
      const restWhy = (list) => {
        const k = new Set(list.map((x) => x.kind));
        return k.has('overbooked') || k.has('priority') ? P.t('mehr Arbeit als Zeit – Rangfolge oder Termine klären', 'more work than time – settle ranking or dates')
          : k.has('outsideWork') ? P.t('Arbeit außerhalb des eigenen Teams – Mitgliedschaft in Atlassian Teams oder das Team-Feld klären', 'work outside the own team – settle the Atlassian Teams membership or the Team field')
            : P.t('Anteile – unter Teams › Kapazitäten pflegen prüfen', 'shares – check under Teams › Maintain capacities');
      };
      after.headline = real2.length
        ? P.t(`Nach der Lösung: ${real0.length} → ${real2.length} ${plural(real2.length, 'Konflikt', 'Konflikte')} – übrig: ${restWhy(real2)}.`, `After the fix: ${real0.length} → ${real2.length} ${plural(real2.length, 'conflict', 'conflicts')} – left: ${restWhy(real2)}.`)
        : P.t(`Nach der Lösung: ${real0.length} → 0 Konflikte – niemand doppelt verplant, die Anteile passen.`, `After the fix: ${real0.length} → 0 conflicts – nobody double booked, the shares fit.`);
      after.kpis = [{ id: 'before', label: P.t('Konflikte vorher', 'Conflicts before'), value: real0.length, unit: 'n' }, { id: 'after', label: P.t('Konflikte danach', 'Conflicts after'), value: real2.length, unit: 'n', tone: real2.length ? 'warn' : 'ok' }, ...after.kpis.filter((k) => k.id !== 'conflicts').slice(0, 2)];
      P.storyObj('story:after', after);
      if (!cmds.length) {
        P.summary(!canPlan && !canCap ? P.t('Lösen darf, wer die Wochenplanung oder die Kapazitäten pflegt – zeig deiner Teamleitung diesen Check.', 'Resolving needs the right to change weekly planning or capacities – show this check to your team lead.')
          : P.t('Lotse findet keine Änderung, die hilft: es ist mehr Arbeit da als Zeit. Nächster Schritt: Rangfolge oder Termine mit den Projekt-Ownern klären.', 'Lotse finds no change that helps: there is more work than time. Next step: settle ranking or dates with the project owners.'));
        return;
      }
      P.batch('preview', cmds);
      P.summary(real2.length ? P.t(`Übrig ${plural(real2.length, 'bleibt', 'bleiben')} ${real2.length}: ${restWhy(real2)}.`, `${real2.length} ${plural(real2.length, 'remains', 'remain')}: ${restWhy(real2)}.`) : null);
    },
  };
  return [splitResolve];
}
