// Support dispatch – Lotse's team hints (live finding 2026-11-17: Lotse proposed only the one ticket that already had a
// team; tickets without component, history or team got nothing). Order: mapping → component history → team on the
// ticket → similar tickets → the assignee's team → (last resort, said as such) the team with the most free time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestTeam, similarIndex, similarTeam, freestTeam, ticketTokens } from '../shared/dispatch.js';

const T = (id, summary, team = null, extra = {}) => ({ id, key: `FS-${id}`, summary, team: team ? { id: team, name: team } : null, components: [], labels: [], ...extra });
const past = [
  T('1', 'Customer order stuck in payment gateway', 'web'),
  T('2', 'Payment gateway timeout on checkout', 'web'),
  T('3', 'Stock vehicle import from warehouse feed', 'data'),
  T('4', 'Warehouse feed missing vehicle records', 'data'),
  T('5', 'Login page slow', 'web'),
];

test('tokens: words of 4+ letters, no numbers, no filler words, plus labels', () => {
  assert.deepEqual(ticketTokens({ summary: 'Stock vehicle #1000 – bitte prüfen', labels: ['Lager'] }).sort(), ['label:lager', 'prufen', 'stock', 'vehicle'].sort());
});

test('similar tickets point to their team, naming the most similar ticket and the shared words', () => {
  const idx = similarIndex(past);
  const s = similarTeam(T('9', 'Vehicle records missing after warehouse import'), idx);
  assert.equal(s.teamId, 'data');
  assert.ok(['FS-3', 'FS-4'].includes(s.key));
  assert.ok(s.words.length >= 2);
  assert.equal(similarTeam(T('10', 'Printer on floor 3'), idx), null, 'no shared words → no hint');
});

test('a near tie between two teams is no hint', () => {
  const idx = similarIndex([T('1', 'Report export broken', 'a'), T('2', 'Report export broken', 'b')]);
  assert.equal(similarTeam(T('3', 'Report export broken again'), idx), null);
});

test('order of hints, and the free-time fallback only as the last resort', () => {
  const similar = similarIndex(past);
  const members = new Map([['web', [{ id: 'u1', plan: 30, cap: 32 }]], ['data', [{ id: 'u2', plan: 10, cap: 32 }]]]);
  const fallback = freestTeam(members);
  assert.deepEqual([fallback.teamId, Math.round(fallback.free)], ['data', 22]);
  const opts = { teamIds: new Set(['web', 'data']), similar, personTeam: (id) => (id === 'u1' ? 'web' : null), fallback };
  assert.equal(suggestTeam(T('20', 'Anything', 'web'), opts).source, 'current');
  assert.equal(suggestTeam(T('21', 'Checkout payment gateway error'), opts).source, 'similar');
  assert.equal(suggestTeam(T('22', 'Printer on floor 3', null, { assignee: { id: 'u1' } }), opts).source, 'assignee');
  const last = suggestTeam(T('23', 'Printer on floor 3'), opts);
  assert.deepEqual([last.source, last.teamId], ['capacity', 'data']);
  // without the new options the old behaviour stays exactly as it was
  assert.deepEqual(suggestTeam(T('24', 'Printer on floor 3'), { teamIds: new Set(['web']) }), { teamId: null, source: null, component: null });
  assert.equal(suggestTeam({ ...T('25', 'x'), components: [{ name: 'Pay' }] }, { componentTeams: { Pay: 'web' }, teamIds: new Set(['web']) }).source, 'mapping');
});

// ---------- Lotse's batch (Support › Verteilen › Lotse) ----------
import { lotseDraft } from '../shared/lotse/teamwork.js';
import { lotseCtx } from './lotseFixture.js';

test('Lotse spreads a batch over the team (4 h per ticket) and gives near-identical tickets to the same person', () => {
  const ctx = lotseCtx('de');
  const members = [{ id: 'a', name: 'A', load: 0.1, cap: 30, absent: false }, { id: 'b', name: 'B', load: 0.15, cap: 30, absent: false }];
  const tk = (id, summary, extra = {}) => ({ id, key: `FS-${id}`, summary, suggestedTeamId: 'web', suggestionSource: 'current', ...extra });
  const payload = { tickets: [tk('1', 'Invoice export fails'), tk('2', 'Password reset mail missing'), tk('3', 'Printer offline'), tk('4', 'Invoice export fails again today')], teams: [{ id: 'web', name: 'Web', members }] };
  const r = lotseDraft('dispatch', payload, ctx).result;
  const by = Object.fromEntries(r.items.map((x) => [x.key, x]));
  assert.equal(r.items.length, 4, 'every ticket of the batch gets a proposal');
  assert.notEqual(by['FS-1'].accountId, by['FS-2'].accountId, 'the second ticket goes to the other person (A got 4 h)');
  assert.equal(by['FS-4'].accountId, by['FS-1'].accountId, 'same topic → same person');
  assert.match(by['FS-4'].why, /Gleiches Thema wie FS-1/);
  // the reasons name the new hints
  const r2 = lotseDraft('dispatch', { ...payload, tickets: [tk('9', 'x', { suggestionSource: 'similar', suggestionBasis: 'FS-3', suggestionWords: ['printer'] }), tk('10', 'y', { suggestionSource: 'capacity' })] }, ctx).result;
  assert.match(r2.items[0].why, /^Ähnlich wie FS-3 \(„printer“\)/);
  assert.match(r2.items[1].why, /freien Zeit/);
});

test('Lotse never fills a person beyond 100 %: the rest of the batch goes to the team only, with the reason', () => {
  const ctx = lotseCtx('de');
  const members = [{ id: 'solo', name: 'Solo', load: 0.5, cap: 20, absent: false }];
  const tickets = Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), key: `FS-${i + 1}`, summary: `Thema ${['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'][i]} offen`, suggestedTeamId: 'data', suggestionSource: 'current' }));
  const r = lotseDraft('dispatch', { tickets, teams: [{ id: 'data', name: 'Data', members }] }, ctx).result;
  const withPerson = r.items.filter((x) => x.accountId);
  // picked at 50 %, 70 % and 90 % (each ticket adds 4 h of 20 h); at 110 % the person is full → the rest team only
  assert.equal(withPerson.length, 3);
  assert.ok(r.items.filter((x) => !x.accountId).every((x) => x.teamId === 'data' && /schon bei \d+ %/.test(x.why)));
  assert.equal(r.items.length, 6, 'every ticket still gets its team');
});
