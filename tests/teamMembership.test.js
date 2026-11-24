// Assignees outside the work item's team (boss feedback 2026-11-17): membership = maintained capacity with a share > 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberStatus, issueTeamCheck, teamOutsiders } from '../shared/teamMembership.js';
import { capacityPeople } from '../shared/engine.js';
import { lotseCtx, lotseDataset } from './lotseFixture.js';

test('member / outside / unmaintained follow the maintained capacity, never the derived default team', () => {
  const ds = lotseDataset();
  const ctx = lotseCtx('de', { ds });
  const { model } = ctx.computed;
  const people = capacityPeople(model);
  const saved = [...people.values()].find((p) => !p.derived);
  assert.ok(saved, 'fixture has maintained people');
  const own = saved.teamId;
  const other = [...model.teams.keys()].find((t) => t !== own && !(saved.teams || []).some((x) => x.teamId === t));
  assert.equal(memberStatus(model, saved.id, own), 'member');
  assert.equal(memberStatus(model, saved.id, other), 'outside');
  assert.equal(memberStatus(model, 'nobody-123', own), 'unmaintained');
});

test('a story of team X assigned to a person of team Y is reported for X with its key; members are not listed', () => {
  const ds = lotseDataset();
  const people0 = capacityPeople(lotseCtx('de', { ds }).computed.model);
  const story = ds.issues.find((i) => i.role === 'estimate' && i.status?.cat !== 'done' && i.assignee?.id && people0.get(i.assignee.id) && !people0.get(i.assignee.id).derived);
  const p = people0.get(story.assignee.id);
  const otherTeam = ds.teams.find((t) => t.id !== p.teamId && !(p.teams || []).some((x) => x.teamId === t.id));
  story.team = { id: otherTeam.id, name: otherTeam.name };
  const { model } = lotseCtx('de', { ds }).computed;
  const chk = issueTeamCheck(model, model.byId.get(story.id));
  assert.equal(chk.status, 'outside');
  assert.equal(chk.teamId, otherTeam.id);
  const out = teamOutsiders(model, otherTeam.id);
  const me = out.find((x) => x.id === story.assignee.id);
  assert.ok(me && me.tasks.some((t) => t.key === story.key), JSON.stringify(out.map((x) => [x.id, x.tasks.map((t) => t.key)])));
  for (const x of out) assert.notEqual(memberStatus(model, x.id, otherTeam.id), 'member');
  // no team or no assignee → nothing to check
  assert.equal(issueTeamCheck(model, { team: null, assignee: { id: 'u1' } }), null);
  assert.equal(issueTeamCheck(model, { team: { id: otherTeam.id }, assignee: null }), null);
});

// ---------- Atlassian Teams (boss feedback 2026-11-17: teams and members must match Atlassian Teams) ----------
import { buildModel } from '../shared/engine.js';
import { capacityDrift, membershipSource } from '../shared/teamMembership.js';
import { evenSplit, atlIndex } from '../shared/atlTeams.js';

function withAtl(mutate) {
  const ds = lotseDataset();
  const people = capacityPeople(lotseCtx('de', { ds }).computed.model);
  const saved = [...people.values()].filter((p) => !p.derived);
  const derived = [...people.values()].filter((p) => p.derived);
  const [a, b] = ds.teams;
  // Atlassian: team a = the first maintained person + the first derived one; team b = the derived one too + a new member
  ds.atlTeams = { at: 1, status: 'ok', teams: { [a.id]: { name: a.name, members: [{ accountId: saved[0].id, name: 'S0' }, ...(derived[0] ? [{ accountId: derived[0].id, name: 'D0' }] : [])] }, [b.id]: { name: b.name, members: [...(derived[0] ? [{ accountId: derived[0].id, name: 'D0' }] : []), { accountId: 'new-1', name: 'Neu Eins' }] } } };
  mutate?.(ds);
  return { ds, model: buildModel(ds), a, b, saved, derived };
}

test('Atlassian Teams decide membership for the teams they contain; other teams keep the capacity rule', () => {
  const { model, a, b, saved, derived } = withAtl();
  assert.equal(membershipSource(model, a.id), 'atlassian');
  assert.equal(memberStatus(model, saved[0].id, a.id), 'member');
  assert.equal(memberStatus(model, 'new-1', b.id), 'member');
  assert.equal(memberStatus(model, saved[0].id, b.id), 'outside');
  if (derived[0]) assert.equal(memberStatus(model, derived[0].id, a.id), 'member', 'derived people are judged by Atlassian, not "unmaintained"');
  const third = model.ds.teams[2];
  if (third) assert.equal(membershipSource(model, third.id), 'cockpit');
});

test('people without maintained capacity split evenly across their Atlassian teams; members without work count once', () => {
  const { model, a, b, saved, derived } = withAtl();
  const people = capacityPeople(model);
  if (derived[0]) assert.deepEqual(people.get(derived[0].id).teams.map((x) => x.pct).sort(), [50, 50]);
  assert.deepEqual(people.get('new-1').teams, [{ teamId: b.id, pct: 100 }]);
  assert.equal(people.get('new-1').derived, true);
  assert.deepEqual(evenSplit(['x', 'y', 'z'], 'z').map((t) => [t.teamId, t.pct]), [['z', 34], ['x', 33], ['y', 33]]);
});

// boss 2026-11-17: someone added to the CEO team in Atlassian Teams was not listed there – maintained people kept their
// cockpit teams. Now the TEAMS follow Atlassian for everyone; maintained hours, location and kept shares stay.
test('maintained people: teams follow Atlassian (added → in the team, removed → out); hours, location and teams Atlassian does not know stay', () => {
  const base = capacityPeople(lotseCtx('de', { ds: lotseDataset() }).computed.model);
  const { model, a, b, saved } = withAtl((ds) => {
    // a maintained person who is NOT in team a or b in the cockpit gets added to b in Atlassian (the CEO case)
    const other = Object.keys(ds.capacity.people).find((id) => id !== Object.keys(ds.capacity.people)[0] && ![ds.teams[0].id, ds.teams[1].id].includes(ds.capacity.people[id].teamId) && !ds.capacity.people[id].teams);
    ds.atlTeams.teams[ds.teams[1].id].members.push({ accountId: other, name: 'Boss' });
    ds._other = other;
  });
  const people = capacityPeople(model);
  const other = model.ds._other;
  const o = people.get(other), o0 = base.get(other);
  assert.ok(o.teams.some((x) => x.teamId === b.id && x.pct > 0), 'added in Atlassian → counts in that team');
  assert.ok(o.teams.some((x) => x.teamId === o0.teamId && x.pct > 0), 'a team Atlassian does not judge keeps its share');
  assert.equal(o.teams.reduce((s, x) => s + x.pct, 0), 100);
  assert.equal(o.weeklyHours, o0.weeklyHours);
  assert.equal(o.location, o0.location);
  assert.equal(o.derived, false);
  assert.equal(memberStatus(model, other, b.id), 'member');
  // maintained in team a / b but not an Atlassian member there → no longer counted there
  for (const p of people.values()) {
    if (p.derived) continue;
    for (const t of [a.id, b.id]) if (!atlIndex(model.ds).isMember(p.id, t)) assert.ok(!(p.teams || [{ teamId: p.teamId, pct: 100 }]).some((x) => x.teamId === t && x.pct > 0), `${p.id} still in ${t}`);
  }
  assert.ok(people.get(saved[0].id).teamId === a.id || (people.get(saved[0].id).teams || []).some((x) => x.teamId === a.id));
});

test('capacity drift: once teams follow Atlassian there is none left to report', () => {
  const { model, a } = withAtl();
  const d = capacityDrift(model, a.id);
  assert.equal(d.extra.length, 0);
  assert.equal(d.missing.length, 0);
  assert.equal(d.members, atlIndex(model.ds).byTeam.get(a.id).size);
  assert.equal(capacityDrift(model, 'no-such-team'), null);
});

test('configuration › teams: hidden teams vanish from every list but keep their names; their work items keep the team', () => {
  const { model, a, b } = withAtl((ds) => { ds.config = { ...ds.config, teams: { source: 'atlassian', show: [ds.teams[0].id] } }; });
  assert.deepEqual([...model.teams.keys()], [a.id]);
  assert.equal(model.teams.size, 1);
  assert.equal(model.teams.get(b.id)?.name, b.name, 'name lookups still work');
  assert.ok(model.ds.issues.some((i) => i.team?.id === b.id), 'work items keep their team');
  // nobody gets a share in a hidden team from Atlassian
  for (const p of capacityPeople(model).values()) if (p.fromAtlassian) assert.ok(!p.teams.some((x) => x.teamId === b.id));
});

test('source "cockpit" or an unreadable snapshot: Atlassian Teams are ignored', () => {
  const off = withAtl((ds) => { ds.config = { ...ds.config, teams: { source: 'cockpit', show: null } }; });
  assert.equal(atlIndex(off.model.ds), null);
  assert.equal(memberStatus(off.model, 'new-1', off.b.id), 'unmaintained');
  const empty = withAtl((ds) => { ds.atlTeams = { ...ds.atlTeams, status: 'empty' }; });
  assert.equal(atlIndex(empty.model.ds), null);
});

// ---------- issue view: the note next to the assignee ----------
import { quickTeamStatus } from '../src/lib/atlTeams.js';
import { storyCheck } from '../shared/storyCheck.js';
import { computeAll } from '../shared/engine.js';

test('issue panel lozenge: Atlassian decides where it knows the team; capacity only for maintained people and only with person-level values on', () => {
  const snap = { status: 'ok', teams: { T1: { members: [{ accountId: 'a' }] } } };
  const capacity = { people: { b: { teamId: 'T2' }, c: { teams: [{ teamId: 'T2', pct: 60 }, { teamId: 'T3', pct: 40 }] } } };
  const cfg = { rules: {} };
  assert.equal(quickTeamStatus({ cfg, snap, capacity, assigneeId: 'a', teamId: 'T1' }), 'member');
  assert.equal(quickTeamStatus({ cfg, snap, capacity, assigneeId: 'b', teamId: 'T1' }), 'outside');
  assert.equal(quickTeamStatus({ cfg, snap, capacity, assigneeId: 'b', teamId: 'T3' }), 'outside', 'team unknown to Atlassian → capacity rule');
  assert.equal(quickTeamStatus({ cfg, snap, capacity, assigneeId: 'c', teamId: 'T3' }), 'member');
  assert.equal(quickTeamStatus({ cfg, snap, capacity, assigneeId: 'x', teamId: 'T3' }), null, 'not maintained → nothing to say');
  assert.equal(quickTeamStatus({ cfg: { rules: { personLevel: false } }, snap, capacity, assigneeId: 'b', teamId: 'T3' }), null);
  assert.equal(quickTeamStatus({ cfg: { teams: { source: 'cockpit' }, rules: {} }, snap, capacity, assigneeId: 'a', teamId: 'T1' }), null, 'source cockpit ignores Atlassian');
  assert.equal(quickTeamStatus({ cfg, snap: { ...snap, status: 'empty' }, capacity, assigneeId: 'b', teamId: 'T1' }), 'outside', 'unreadable snapshot → capacity rule');
  assert.equal(quickTeamStatus({ cfg, snap, capacity, assigneeId: null, teamId: 'T1' }), null);
});

test('planning check panel: an assignee outside the Atlassian team is said first, with the members and the fixes', () => {
  const { ds, a, saved } = withAtl();
  const story = ds.issues.find((i) => i.role === 'estimate' && i.status?.cat !== 'done' && i.assignee?.id && i.assignee.id !== saved[0].id);
  story.team = { id: a.id, name: a.name };
  const r = storyCheck(computeAll(ds, { skipWeeks: true }), story.id, { lang: 'de' });
  assert.equal(r.assigneeCheck.status, 'outside');
  assert.equal(r.assigneeCheck.source, 'atlassian');
  assert.ok(r.team.notes.some((n) => n.key === 'teamMismatch' && /Atlassian Teams/.test(n.text)));
  assert.ok(r.team.rows.some(([k, v]) => /Atlassian Teams/.test(k) && v.includes('S0') === false && v.length > 0));
  assert.ok(!r.team.notes.some((n) => /Kapazitätsplanung/.test(n.text)), 'no contradicting capacity note');
  // the member itself: an "ok" note, no banner
  story.assignee = { id: saved[0].id, name: 'S0' };
  const r2 = storyCheck(computeAll(ds, { skipWeeks: true }), story.id, { lang: 'de' });
  assert.equal(r2.assigneeCheck.status, 'member');
  assert.ok(r2.team.notes.some((n) => n.tone === 'ok'));
});
