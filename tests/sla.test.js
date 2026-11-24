import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slaHours, ticketSla, supportAnalytics, targetHours, DEFAULT_SLA } from '../shared/sla.js';

const at = (iso) => Date.parse(iso);
// the app's own SLA policy is an opt-in now (policyFallback) – the algorithm is still tested here
const cal = { ...DEFAULT_SLA, location: 'NONE', policyFallback: true };

test('business hours skip nights and weekends', () => {
  // Fri 2026-11-06 16:00 → Mon 2026-11-09 10:00 = 1 h Friday + 2 h Monday
  assert.equal(slaHours(at('2026-11-06T16:00:00Z'), at('2026-11-09T10:00:00Z'), cal), 3);
  assert.equal(slaHours(at('2026-11-06T16:00:00Z'), at('2026-11-09T10:00:00Z'), { ...cal, mode: '24x7' }), 66);
});

test('public holidays do not count (Germany, 25 Dec)', () => {
  const de = { ...cal, location: 'DE' };
  assert.equal(slaHours(at('2026-12-24T08:00:00Z'), at('2026-12-28T08:00:00Z'), de), 9); // 24th counts, 25th/26th/27th not
});

test('policy targets by priority, case-insensitive, with fallback', () => {
  assert.equal(targetHours('highest', cal), 8);
  assert.equal(targetHours('Blocker', cal), 72);
});

test('ticket SLA states: ok, at risk, breached, met', () => {
  const now = at('2026-11-04T12:00:00Z'); // Wednesday
  const mk = (created, priority, extra = {}) => ({ created, priority, statusCat: 'indeterminate', ...extra });
  assert.equal(ticketSla(mk('2026-11-04T10:00:00Z', 'Highest'), cal, now).status, 'ok'); // 2 of 8 h
  assert.equal(ticketSla(mk('2026-11-03T15:00:00Z', 'Highest'), cal, now).status, 'atRisk'); // 2 + 4 = 6 of 8 h
  assert.equal(ticketSla(mk('2026-11-02T08:00:00Z', 'Highest'), cal, now).status, 'breached');
  assert.equal(ticketSla(mk('2026-11-02T08:00:00Z', 'Highest', { statusCat: 'done', resolved: '2026-11-02T12:00:00Z' }), cal, now).status, 'met');
});

test('JSM SLA data wins over the policy', () => {
  const s = ticketSla({ priority: 'Low', created: '2026-11-04T10:00:00Z', statusCat: 'indeterminate', jsm: { goalMs: 4 * 3600e3, elapsedMs: 5 * 3600e3, breached: true } }, cal, at('2026-11-04T11:00:00Z'));
  assert.equal(s.source, 'jsm');
  assert.equal(s.status, 'breached');
});

test('analytics: KPIs, trend, aging, project bridge, urgent queue order', () => {
  const now = at('2026-11-04T12:00:00Z');
  const tickets = [
    { id: '1', key: 'S-1', priority: 'Highest', created: '2026-11-02T08:00:00Z', statusCat: 'indeterminate', links: ['900'], worklogs: [{ h: 3 }] },
    { id: '2', key: 'S-2', priority: 'Medium', created: '2026-11-04T09:00:00Z', statusCat: 'new', links: [] },
    { id: '3', key: 'S-3', priority: 'High', created: '2026-10-28T09:00:00Z', resolved: '2026-10-28T15:00:00Z', statusCat: 'done', links: ['900'] },
  ];
  const a = supportAnalytics(tickets, { cal, now, rootOf: (id) => (id === '900' ? 'issue:10' : null) });
  assert.equal(a.kpis.open, 2);
  assert.equal(a.kpis.breachedOpen, 1);
  assert.equal(a.kpis.met, 1);
  assert.equal(a.kpis.unlinked, 1);
  assert.equal(a.queue[0].key, 'S-1', 'breached first');
  assert.deepEqual(a.byProject.map((p) => [p.ref, p.tickets, p.open, p.hours]), [['issue:10', 2, 1, 3]]);
  assert.equal(a.trend.length, 8);
  assert.equal(a.trend.at(-1).created, 2);
  assert.equal(a.aging.reduce((x, b) => x + b.count, 0), 2);
});

test('per service space: the same tickets and SLA rule as the Support view; one space = the totals', async () => {
  const { supportAnalytics, serviceKpis } = await import('../shared/sla.js');
  const now = Date.parse('2026-11-06T12:00:00Z');
  const mk = (id, svc, created, resolved, priority = 'High') => ({ id, key: `S-${id}`, priority, created, resolved, statusCat: resolved ? 'done' : 'new', services: svc, links: [] });
  const tickets = [mk('1', ['A'], '2026-11-02T08:00:00Z', null), mk('2', ['A'], '2026-11-02T08:00:00Z', '2026-11-02T09:00:00Z'), mk('3', ['B'], '2026-10-01T08:00:00Z', null), mk('4', ['A', 'B'], '2026-11-05T08:00:00Z', null)];
  const a = supportAnalytics(tickets, { now });
  const A = serviceKpis(a, 'A'), B = serviceKpis(a, 'B');
  assert.equal(A.open, 2); assert.equal(B.open, 2);
  assert.equal(A.tickets + B.tickets - 1, tickets.length, 'a ticket in two spaces counts in both');
  const only = supportAnalytics(tickets.filter((t) => t.services.includes('A') && t.services.length === 1), { now });
  const k = serviceKpis(only, 'A');
  assert.equal(k.open, only.kpis.open, 'one space: open = the Support view');
  assert.equal(k.slaRate, only.kpis.slaRate, 'one space: SLA rate = the Support view');
});

test('default: a ticket without JSM SLA data has no SLA and counts in no SLA figure (2026-11-18)', async () => {
  const { supportAnalytics: sa, ticketSla: ts, DEFAULT_SLA: D } = await import('../shared/sla.js');
  const now = Date.parse('2026-11-18T12:00:00Z');
  const plain = { priority: 'Highest', created: '2026-10-01T08:00:00Z', statusCat: 'new' };
  assert.equal(ts(plain, D, now).status, 'none');
  const withJsm = { ...plain, id: 'j', jsm: { goalMs: 8 * 3600e3, elapsedMs: 9 * 3600e3, breached: true } };
  assert.equal(ts(withJsm, D, now).status, 'breached');
  const a = sa([{ ...plain, id: 'p' }, withJsm], { cal: D, now });
  assert.equal(a.kpis.withSla, 1);
  assert.equal(a.kpis.breached, 1);
  assert.equal(a.kpis.breachedOpen, 1);
  const only = sa([{ ...plain, id: 'p' }], { cal: D, now });
  assert.equal(only.kpis.withSla, 0);
  assert.equal(only.kpis.slaRate, null, 'no rate instead of 0 %');
});
