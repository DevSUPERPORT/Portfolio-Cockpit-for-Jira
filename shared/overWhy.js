// "Warum zu viel?" – the reasoning behind one red week on the weekly board, in pieces a person can follow (boss
// 2026-11-20: "if it is not possible for you to find this info, we need more info in the app – simple for users to see
// the reasoning behind the overbooking, with easy fix actions with Lotse"). Pure: everything comes from the board that is
// on screen (buildBoard), so the explanation can never disagree with the cell it explains.
//
//   explainOver({ board, model, rowId, foot, wi }) → {
//     scope: 'person' | 'project' | 'team', week: { from, to }, load, avail, fit (loadFit.fitOf),
//     time:  where the time comes from – person: weekly hours − absence/holidays − daily business = time for projects;
//            team/project: per person their share in the team + what their other teams leave unused (shareSplit)
//     takes: what uses it – support, higher-ranked projects, the tasks of the cell, other teams' work
//     people: [{ id, name, share, entitled, borrowed, from, lent, to, time, here, person: { load, avail, over, util } }]
//   }
//   handOverFor(board, taskId) → the team member who has room for the task in every board week it touches, or null
import { teamSettings } from './engine.js';
import { fitOf } from './loadFit.js';

const EPS = 0.05;
const sum = (a, f = (x) => x) => a.reduce((s, x) => s + (f(x) || 0), 0);
const ratio = (load, avail) => (avail > EPS ? load / avail : load > EPS ? Infinity : 0);

function personOf(board, id, wi) {
  const w = board.personWeeks(id)[wi];
  return { load: w.load, avail: w.avail, util: w.util, over: Math.max(0, w.load - w.avail) };
}
const taskList = (cell) => cell.cards.filter((k) => k.kind === 'task').map((k) => ({
  id: k.id, key: k.key, summary: k.summary || '', hours: k.hours, assignee: k.assignee || null, assigneeName: k.assigneeName || null,
  hidden: !!k.hidden, ref: k.ref, project: k.project || '', idx: k.idx, len: k.len, oe: k.oe, start: k.start, due: k.due, pending: !!k.pending,
})).sort((a, b) => b.hours - a.hours);

// one person's part of a team in this week (null for people outside the viewer's scope)
function teamPeople(board, team, wi, { here = new Map(), extra = [] } = {}) {
  const ids = [...new Set([...(board.members?.(team) || []), ...extra])];
  const out = [];
  let hiddenTime = 0, hiddenLoad = 0, hiddenN = 0;
  for (const id of ids) {
    // people outside the viewer's scope (UC-08): no names, no single values – their time and load only as one sum
    if (board.isHidden(id)) {
      const t = board.teamPart(id, wi, team);
      hiddenTime += t.time;
      hiddenLoad += t.load;
      hiddenN++;
      continue;
    }
    const sw = board.splitWeek(id, wi);
    const b = sw?.byTeam?.[team];
    const member = !!(board.inTeamOf?.(id, team));
    out.push({
      id, name: board.candidates.find((c) => c.id === id)?.name || '', member,
      share: b?.share ?? 0, entitled: b?.entitled ?? 0, borrowed: b?.borrowed ?? 0, lent: b?.lent ?? 0, time: b?.time ?? 0,
      teamLoad: b?.load ?? 0, from: b?.from || [], to: b?.to || [], here: here.get(id) || 0, person: personOf(board, id, wi),
      teams: (sw?.list || []).filter((x) => x.load > EPS || x.entitled > EPS).map((x) => ({ teamId: x.teamId, load: x.load, time: x.time, share: x.share })),
    });
  }
  out.sort((a, b) => (b.here - a.here) || (b.time - a.time) || a.name.localeCompare(b.name, 'de'));
  return { people: out, hidden: hiddenN ? { count: hiddenN, time: hiddenTime, load: hiddenLoad } : null };
}

export function explainOver({ board, model, rowId = null, foot = false, wi }) {
  const W = board.weeks[wi];
  if (!W) return null;
  const week = { from: W.from, to: W.to };
  // ---------- one person ----------
  const row = rowId ? board.rows.find((r) => r.id === rowId) : null;
  if (row?.kind === 'person') {
    const c = row.cells[wi];
    const a = board.personAvail(row.accountId, wi) || {};
    const p = model.ds.capacity?.people?.[row.accountId] || null;
    const st = teamSettings(model, row.teamId);
    const sw = board.splitWeek(row.accountId, wi);
    return {
      scope: 'person', week, load: c.load, avail: c.avail, fit: fitOf(c.load, c.avail), name: row.name, personId: row.accountId,
      time: {
        weekly: a.weekly || 0, nominal: a.nominal || 0, off: Math.max(0, a.off || 0), absentDays: a.absent || 0, holidayDays: a.holidays || 0,
        daily: Math.max(0, a.daily || 0), dailyPct: (+st.dailyBusinessPct || 0) + (+st.internalPct || 0), avail: c.avail, derived: !p,
      },
      takes: { support: c.support || 0, tasks: taskList(c), other: c.other || 0, otherKind: board.kind === 'project' ? 'projects' : 'teams' },
      teams: (sw?.list || []).filter((x) => x.load > EPS || x.entitled > EPS).map((x) => ({ teamId: x.teamId, share: x.share, load: x.load, time: x.time, over: x.over })),
      people: [],
    };
  }
  // ---------- a project of a team (Projekte rows) ----------
  if (row?.kind === 'projectRow') {
    const c = row.cells[wi];
    const tasks = taskList(c);
    const here = new Map();
    for (const t of tasks) if (t.assignee && !t.hidden) here.set(t.assignee, (here.get(t.assignee) || 0) + t.hours);
    const tp = teamPeople(board, board.team, wi, { here, extra: [...here.keys()] });
    // person by person (as the row counts it): what each had left after support and the higher-ranked projects
    const left = new Map((c.people || []).map((p) => [p.id, p]));
    for (const p of tp.people) { const q = left.get(p.id); if (q) { p.before = q.before; p.overHere = q.over; p.higher = q.higher; } }
    return {
      scope: 'project', week, load: c.load, avail: c.avail, fit: fitOf(c.load, c.avail), name: row.name, ref: row.ref, team: board.team,
      time: { team: c.basis?.team ?? 0, here: c.basis?.here ?? c.avail },
      takes: { support: c.basis?.support ?? 0, higher: c.basis?.higher ?? 0, tasks, unassigned: c.unassigned?.hours || 0, unassignedOver: c.unassigned?.over || 0 },
      over: c.over ?? Math.max(0, c.load - c.avail), free: c.free ?? 0,
      people: tp.people, hidden: tp.hidden, hiddenWork: sum((c.people || []).filter((p) => p.hidden), (p) => p.hours),
    };
  }
  // ---------- the Personen board's sum row: the people above, each with their whole week (boss 2026-11-23) ----------
  if (foot && board.foot?.[wi]?.sumOf === 'people') {
    const f = board.foot[wi];
    const out = [];
    let hiddenTime = 0, hiddenLoad = 0, hiddenN = 0;
    for (const id of board.footPeople?.() || []) {
      const person = personOf(board, id, wi);
      if (board.isHidden(id)) { hiddenTime += person.avail; hiddenLoad += person.load; hiddenN++; continue; }
      // shaped like a team member whose whole time counts here, so the same lines and lists can show it
      out.push({ id, name: board.candidates.find((c) => c.id === id)?.name || '', member: true, share: 1, entitled: person.avail, borrowed: 0, lent: 0,
        time: person.avail, teamLoad: person.load, from: [], to: [], here: person.load, person, teams: [] });
    }
    out.sort((a, b) => (b.person.over - a.person.over) || (b.here - a.here) || a.name.localeCompare(b.name, 'de'));
    return {
      scope: 'people', week, load: f.load, avail: f.avail, fit: fitOf(f.load, f.avail), name: '', team: board.team,
      time: { team: f.time ?? f.avail }, over: f.over ?? Math.max(0, f.load - f.avail), free: f.free ?? 0,
      takes: { members: f.load - (f.unassigned || 0), unassigned: f.unassigned || 0 },
      people: out, hidden: hiddenN ? { count: hiddenN, time: hiddenTime, load: hiddenLoad } : null,
    };
  }
  // ---------- a whole team (a team row of the overview, the Projekte sum) ----------
  const team = row?.kind === 'team' ? row.teamId : board.team;
  const f = foot ? board.foot[wi] : row?.cells[wi];
  if (!f || !team) return null;
  const tp = teamPeople(board, team, wi);
  const memberLoad = sum(tp.people.filter((x) => x.member), (x) => x.teamLoad) + (tp.hidden?.load || 0);
  // helpers from other teams: their work for this team (their time counts with what their own teams leave unused)
  return {
    scope: 'team', week, load: f.load, avail: f.avail, fit: fitOf(f.load, f.avail), name: row?.name || '', team,
    time: { team: f.time ?? f.avail }, over: f.over ?? Math.max(0, f.load - f.avail), free: f.free ?? 0,
    takes: { members: memberLoad, outside: Math.max(0, f.load - memberLoad) },
    people: tp.people, hidden: tp.hidden,
  };
}

// Hand the task to someone of its team who has room in every board week it touches (≤ target) – the one left with the
// most room wins. Only people the viewer may see; never the current assignee.
export function handOverFor(board, taskId, { target = 1 } = {}) {
  const t = board.taskById.get(taskId);
  if (!t) return null;
  const used = t.hours.map((h, i) => (h > EPS ? i : -1)).filter((i) => i >= 0);
  if (!used.length) return null;
  let best = null;
  for (const c of board.candidates) {
    if (c.id === t.assignee || board.isHidden(c.id)) continue;
    if (t.teamId && !board.inTeamOf(c.id, t.teamId)) continue;
    const pw = board.personWeeks(c.id);
    let peak = 0, ok = true;
    for (const i of used) {
      const w = pw[i];
      if (!(w.avail > EPS)) { ok = false; break; }
      const u = (w.load + t.hours[i]) / w.avail;
      if (u > target + 0.005) { ok = false; break; }
      peak = Math.max(peak, u);
    }
    if (ok && (!best || peak < best.peak - 1e-9)) best = { id: c.id, name: c.name, peak, weeks: used.map((i) => board.weeks[i].from), hours: sum(used, (i) => t.hours[i]) };
  }
  return best;
}

export { ratio as overRatio };
