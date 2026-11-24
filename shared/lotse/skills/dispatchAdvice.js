// Support dispatch: the incoming tickets, most urgent SLA first, each with a team (component mapping → the team that
// usually resolved such tickets → the team on the ticket) and the team member with the lowest load (shared/dispatch.js).
import { dispatchSettings, incomingTickets, sortBySla, componentHistory, suggestTeam, similarIndex, freestTeam, suggestAssignees, isCritical, isHighPriority, reserveCheck } from '../../dispatch.js';
import { ticketSla, DEFAULT_SLA } from '../../sla.js';
import { computedOf, dsOf, newStory, addTeam, addPerson, kpi, ev, finding, action, follow, done, infoStory, r1, T, say, worst, teamName, personName } from '../kit.js';
import { plural, list } from '../narrate.js';

export function dispatchPlan(ctx) {
  const c = computedOf(ctx);
  const ds = dsOf(ctx);
  const tickets = ds.supportTickets?.tickets || [];
  const settings = dispatchSettings(ds.config);
  const cal = ds.config?.support?.sla || DEFAULT_SLA;
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  const { incoming } = incomingTickets(tickets, settings);
  const rows = sortBySla(incoming.map((t) => ({ ...t, sla: ticketSla(t, cal, now) })));
  const teamIds = new Set([...c.model.teams.keys()]);
  const history = componentHistory(tickets);
  const members = new Map((c.weeks?.teams || []).filter((t) => t.teamId !== '_none').map((t) => [t.teamId, t.members.filter((m) => !String(m.id).startsWith('anon-')).map((m) => ({ id: m.id, plan: m.plan[0] || 0, cap: m.cap[0] || 0 }))]));
  // the same hints as the Support tab: similar tickets, the assignee's team, last resort the team with the most free time
  const similar = similarIndex(tickets);
  const pt = new Map(); for (const [tid, list] of members) for (const m of list) if (!pt.has(m.id)) pt.set(m.id, tid);
  const fallback = freestTeam(members, (id) => teamIds.has(id));
  const team = new Map(rows.map((r) => [r.id, suggestTeam(r, { componentTeams: settings.componentTeams, history, teamIds, similar, personTeam: (id) => pt.get(id) || null, fallback })]));
  const who = suggestAssignees(rows, (r) => team.get(r.id)?.teamId, members);
  return { rows, team, who, cal, members };
}

export default {
  id: 'dispatchAdvice',
  title: (L) => T(L, 'Support verteilen', 'Support dispatch'),
  params: [],
  match: [/verteil(en|ung)? .*(ticket|support)|(ticket|support).* verteil|dispatch|zuweis|zuordn|assign (the )?(tickets|support)|wer (bekommt|nimmt|soll) .*ticket|who (should )?(take|get)s? .*ticket|eingang|incoming|neue tickets|new tickets|sla (kritisch|gerissen|breach)|tickets? (ueber|past) (dem )?sla/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const ds = dsOf(ctx);
    if (!ds.supportTickets?.tickets?.length) return infoStory(ctx, { skill: 'dispatchAdvice', lang: L, subject: { kind: 'topic', ref: null, name: 'Support' }, headline: T(L, 'Es sind keine Support-Tickets geladen.', 'No support tickets are loaded.'), finding: T(L, 'Support-Verteilen braucht konfigurierte Service-Projekte oder Queues.', 'Dispatching needs configured service projects or queues.'), followUps: [follow(T(L, 'Portfolio-Lage', 'Portfolio'), T(L, 'Lagebild Portfolio', 'Portfolio briefing'))] });
    const { model } = c;
    const { rows, team, who, cal } = dispatchPlan(ctx);
    const s = newStory(ctx, { skill: 'dispatchAdvice', subject: { kind: 'topic', ref: 'support', name: 'Support' }, lang: L });
    const F = s.fmt;
    const breached = rows.filter((r) => r.sla.status === 'breached');
    const critical = rows.filter(isCritical);
    const high = rows.filter((r) => isHighPriority(r.priority, cal));
    s.kpis.push(kpi('incoming', T(L, 'Im Eingang', 'Incoming'), rows.length, 'n', { tone: 'ink' }));
    s.kpis.push(kpi('breached', T(L, 'SLA gerissen', 'SLA breached'), breached.length, 'n', { tone: breached.length ? 'bad' : 'ok' }));
    s.kpis.push(kpi('critical', T(L, 'Unter 1 h SLA', 'Under 1 h SLA'), critical.length, 'n', { tone: critical.length ? 'bad' : 'ok' }));
    s.kpis.push(kpi('high', T(L, 'Hohe Priorität', 'High priority'), high.length, 'n', { tone: high.length ? 'warn' : 'ok' }));
    if (!rows.length) {
      s.visual = { kind: 'donut', data: { unit: 'n', total: ds.supportTickets.tickets.filter((t) => t.statusCat !== 'done').length, items: [{ label: T(L, 'offen, schon verteilt', 'open, already dispatched'), value: ds.supportTickets.tickets.filter((t) => t.statusCat !== 'done').length, tone: 'ok' }] }, caption: T(L, 'Offene Tickets – keines wartet im Eingang.', 'Open tickets – none is waiting in the inbox.') };
      s.findings.push(finding(T(L, 'Im Eingang wartet kein Ticket.', 'No ticket is waiting in the inbox.'), 'ok', 10, []));
    } else {
      s.visual = {
        kind: 'bars',
        data: { unit: 'h', items: rows.slice(0, 12).map((r) => {
          const tn = addTeam(s, model, team.get(r.id)?.teamId);
          const pn = personName(ctx, who.get(r.id));
          return { label: r.key, key: r.key, value: r1(r.sla.remainingH ?? 0), tone: r.sla.status === 'breached' ? 'bad' : r.sla.status === 'atRisk' || isCritical(r) ? 'warn' : 'ok', sub: [tn, pn].filter(Boolean).join(' · ') || T(L, 'kein Vorschlag', 'no suggestion') };
        }) },
        caption: T(L, 'Tickets im Eingang, dringendstes zuerst: verbleibende SLA-Zeit in Stunden (negativ = gerissen), darunter Team und Person des Vorschlags.', 'Incoming tickets, most urgent first: SLA time left in hours (negative = breached), with the suggested team and person.'),
      };
      if (breached.length) s.findings.push(finding(T(L, `${breached.length} ${plural(breached.length, 'Ticket hat', 'Tickets haben')} das SLA schon gerissen, am längsten ${breached[0].key} (${F.h(-breached[0].sla.remainingH)} drüber).`, `${breached.length} ${plural(breached.length, 'ticket has', 'tickets have')} already breached the SLA, longest ${breached[0].key} (${F.h(-breached[0].sla.remainingH)} over).`), 'bad', 92,
        breached.slice(0, 4).map((r) => ev(T(L, 'Stunden über SLA', 'hours over SLA'), r1(-r.sla.remainingH), 'h', { key: r.key, text: r.summary }))));
      const soon = critical.filter((r) => r.sla.status !== 'breached');
      if (soon.length) s.findings.push(finding(T(L, `${soon.length} ${plural(soon.length, 'Ticket hat', 'Tickets haben')} weniger als 1 h SLA übrig: ${list(soon.map((r) => r.key), L)}.`, `${soon.length} ${plural(soon.length, 'ticket has', 'tickets have')} less than 1 h of SLA left: ${list(soon.map((r) => r.key), L)}.`), 'bad', 85,
        [ev('1 h', 1, 'h'), ...soon.slice(0, 4).map((r) => ev(T(L, 'SLA übrig', 'SLA left'), r1(r.sla.remainingH), 'h', { key: r.key }))]));
      const byTeam = new Map();
      for (const r of rows) { const t = team.get(r.id)?.teamId; if (t) byTeam.set(t, (byTeam.get(t) || 0) + 1); }
      const split = [...byTeam].sort((a, b) => b[1] - a[1]);
      const none = rows.filter((r) => !team.get(r.id)?.teamId).length;
      if (split.length) s.findings.push(finding(T(L, `Vorschlag: ${list(split.map(([t, n]) => `${n} an ${addTeam(s, model, t)}`), L, 4)}${none ? `; ${none} ohne Team-Hinweis` : ''} – Person jeweils mit der geringsten Auslastung diese Woche.`, `Suggestion: ${list(split.map(([t, n]) => `${n} to ${addTeam(s, model, t)}`), L, 4)}${none ? `; ${none} without a team hint` : ''} – each to the person with the lowest load this week.`), 'info', 60,
        [ev(T(L, 'mit Vorschlag', 'with a suggestion'), rows.length - none, 'n'), ...split.slice(0, 4).map(([t, n]) => ev(teamName(model, t), n, 'n', { ref: `team:${t}` })), ...(none ? [ev(T(L, 'ohne Team', 'no team'), none, 'n')] : []), ...(split.length > 4 ? [ev(T(L, 'weitere Teams', 'more teams'), split.length - 4, 'n')] : [])]));
    }
    const res = reserveCheck(c.support).filter((x) => x.verdict === 'low');
    if (res.length) {
      const x = res.sort((a, b) => b.diff - a.diff)[0];
      const tn = addTeam(s, model, x.teamId);
      s.findings.push(finding(T(L, `Support-Reserve von ${tn} zu knapp: reserviert ${F.h(x.reserved)} je Woche, gebraucht zuletzt Ø ${F.h(x.recent)}.`, `${tn}'s support reserve is too small: ${F.h(x.reserved)} reserved per week, lately avg ${F.h(x.recent)} needed.`), 'warn', 50,
        [ev(T(L, 'reserviert je Woche', 'reserved per week'), x.reserved, 'h', { ref: `team:${x.teamId}` }), ev(T(L, 'Ø letzte 4 Wochen', 'avg last 4 weeks'), x.recent, 'h')]));
    }
    s.tone = worst(...s.findings.map((f) => (f.tone === 'info' ? null : f.tone)));
    s.headline = !rows.length ? T(L, 'Im Support-Eingang wartet nichts.', 'Nothing is waiting in the support inbox.')
      : say(s.id, 'h', [T(L, `${rows.length} Tickets im Eingang, ${breached.length} schon über dem SLA – Lotse hat für ${rows.filter((r) => team.get(r.id)?.teamId).length} Team und Person.`, `${rows.length} tickets incoming, ${breached.length} already past the SLA – Lotse has a team and person for ${rows.filter((r) => team.get(r.id)?.teamId).length}.`),
        T(L, `Zuerst ${rows[0].key}: ${rows[0].sla.status === 'breached' ? 'SLA gerissen' : `${F.h(rows[0].sla.remainingH, 1)} SLA übrig`}; im Eingang warten ${rows.length} Tickets.`, `First ${rows[0].key}: ${rows[0].sla.status === 'breached' ? 'SLA breached' : `${F.h(rows[0].sla.remainingH, 1)} of SLA left`}; ${rows.length} tickets are waiting.`)]);
    if (rows[0] && rows[0].sla.status !== 'breached') s.findings.push(finding(T(L, `Dringendstes Ticket: ${rows[0].key} mit ${F.h(rows[0].sla.remainingH, 1)} SLA übrig.`, `Most urgent ticket: ${rows[0].key} with ${F.h(rows[0].sla.remainingH, 1)} of SLA left.`), 'warn', 40, [ev(T(L, 'SLA übrig', 'SLA left'), r1(rows[0].sla.remainingH), 'h', { key: rows[0].key })]));
    const items = rows.filter((r) => team.get(r.id)?.teamId).slice(0, 20).map((r) => ({ issueId: r.id, key: r.key, teamId: team.get(r.id).teamId, accountId: who.get(r.id) || null }));
    if (items.length) {
      for (const x of items.slice(0, 3)) addPerson(s, ctx, x.accountId);
      s.actions.push(action('dispatchAll', T(L, `${items.length} verteilen`, `Dispatch ${items.length}`), 'dispatch', { items }, T(L, `Weist ${items.length} Tickets zu: ${items.slice(0, 3).map((x) => `${x.key} → ${teamName(model, x.teamId)}${x.accountId ? ` (${personName(ctx, x.accountId) || '–'})` : ''}`).join(', ')}${items.length > 3 ? ' …' : ''} – jedes einzeln rückgängig.`, `Assigns ${items.length} tickets: ${items.slice(0, 3).map((x) => `${x.key} → ${teamName(model, x.teamId)}${x.accountId ? ` (${personName(ctx, x.accountId) || '–'})` : ''}`).join(', ')}${items.length > 3 ? ' …' : ''} – each undoable.`)));
      s.actions.push(action('dispatchFirst', T(L, `${items[0].key} zuweisen`, `Assign ${items[0].key}`), 'dispatch', { items: [items[0]] }, T(L, `Weist nur ${items[0].key} zu (${teamName(model, items[0].teamId)}).`, `Assigns only ${items[0].key} (${teamName(model, items[0].teamId)}).`)));
    }
    s.actions.push(action('open', T(L, 'Support öffnen', 'Open support'), 'navigate', { view: 'support', tab: 'dispatch' }, T(L, 'Öffnet „Support-Tickets verteilen“.', 'Opens "Dispatch support tickets".')));
    s.followUps.push(follow(T(L, 'Wiederkehrende Themen', 'Recurring topics'), T(L, 'Welche Support-Themen kommen immer wieder?', 'Which support topics keep coming back?')), follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')), follow(T(L, 'Realistische Kapazität', 'Real capacity'), T(L, 'Wie viel Kapazität bleibt nach Support?', 'How much capacity is left after support?')));
    s.how = { text: T(L, 'Eingang = offene Tickets im konfigurierten Eingangsstatus (sonst „To Do“). Reihenfolge nach verbleibender SLA-Zeit. Team: Komponenten-Zuordnung der Konfiguration, sonst das Team, das solche Tickets meist gelöst hat, sonst das Team am Ticket. Person: geringste Auslastung diese Woche, jedes vorgeschlagene Ticket zählt mit 4 h.', 'Incoming = open tickets in the configured incoming status (otherwise "To Do"). Ordered by SLA time left. Team: the configuration\'s component mapping, otherwise the team that usually resolved such tickets, otherwise the team on the ticket. Person: lowest load this week, each suggested ticket counts as 4 h.'),
      inputs: [[T(L, 'Tickets geladen', 'Tickets loaded'), String(ds.supportTickets.tickets.length)], [T(L, 'SLA-Kalender', 'SLA calendar'), cal === DEFAULT_SLA ? T(L, 'Standard', 'default') : T(L, 'konfiguriert', 'configured')]] };
    s.confidence = rows.length ? 'medium' : 'high';
    s.sources = ['Jira Service Management', T(L, 'Kapazitäten', 'Capacity')];
    return done(s);
  },
};
