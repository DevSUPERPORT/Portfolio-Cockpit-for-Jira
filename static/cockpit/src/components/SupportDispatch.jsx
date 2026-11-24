import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { motion } from 'framer-motion';
import { enter, isReduced, MS, EASE, cssEase } from '../lib/motion.js';
import { useApp, errText } from '../state.jsx';
import { tr, fmt } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call, openIssue } from '../lib/api.js';
import { Empty, useTip, infoCard, spring } from './ui.jsx';
import { incomingTickets, sortBySla, componentHistory, suggestTeam, similarIndex, freestTeam, suggestAssignees, filterDispatch, isCritical, isHighPriority, personLoad, componentNames, PER_TICKET_H } from '@shared/dispatch.js';
import { useAiAssist, AiButton, AiPanel } from './AiAssist.jsx';
import { dispatchPayload } from '@shared/aiPayload.js';
import { dispatchOverrides } from '../lib/aiApply.js';
import './Support.css';

// Lotse computes in the browser – it takes every selected ticket (up to this many); the AI gets 6 at a time (cost).
const LOTSE_MAX = 100;

// "Verteilen": new support tickets by remaining SLA time, each with a suggested team (component) and the team member
// with the lowest load this week. "Zuweisen" sets team, assignee and the configured status – as the user, undoable.
const PAGE = 60;
const STATUS_NOTE = {
  NO_TRANSITION: () => tr('Status unverändert – kein passender Übergang im Workflow', 'status unchanged – no matching workflow transition'),
  TRANSITION_FAILED: () => tr('Status unverändert – der Übergang verlangt weitere Angaben', 'status unchanged – the transition needs more input'),
};

export default function SupportDispatch({ rows, settings, svcSel, serviceName, cal, slaText, canAssign, teamField }) {
  const { ds, computed, setDs, toast, pushUndo, runUndo, done, undoList } = useApp();
  const tip = useTip();
  const { model, weeks } = computed;
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [draft, setDraft] = useState({}); // ticketId → { teamId?, accountId? }
  const [busy, setBusy] = useState(() => new Set());
  const [recent, setRecent] = useState([]); // just assigned: { id, key, text, entry }
  const [limit, setLimit] = useState(PAGE);
  const anon = ds?.personLevel === false; // pseudonymised people cannot be assigned
  const teams = useMemo(() => [...model.teams.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))), [model]);
  const teamIds = useMemo(() => new Set(teams.map((t) => t.id)), [teams]);
  const tname = (id) => model.teams.get(id)?.name || id || '–';
  const pname = (id) => ds?.people?.[id]?.name || tr('Unbekannt', 'Unknown');
  // Team members with this week's plan and capacity (after support) – the same numbers as the weekly planning.
  const members = useMemo(() => {
    const m = new Map();
    for (const t of weeks?.teams || []) m.set(t.teamId, t.members.map((p) => ({ id: p.id, plan: p.plan[0] || 0, cap: p.cap[0] || 0 })).sort((a, b) => (personLoad(a) ?? 9) - (personLoad(b) ?? 9)));
    return m;
  }, [weeks]);

  const recentIds = useMemo(() => new Set(recent.map((r) => r.id)), [recent]);
  const { incoming, otherNew, mode } = useMemo(() => incomingTickets(rows, settings), [rows, settings]);
  const history = useMemo(() => componentHistory(rows), [rows]);
  const sorted = useMemo(() => sortBySla(incoming.filter((t) => !recentIds.has(t.id))), [incoming, recentIds]);
  // Suggestions over ALL incoming tickets (stable while filtering), most urgent first, spread by PER_TICKET_H each.
  // Lotse's team hints: mapping → component history → team on the ticket → similar tickets → the assignee's team →
  // (last resort) the team with the most free time this week – each with its reason (shared/dispatch.js suggestTeam)
  const similar = useMemo(() => similarIndex(rows), [rows]);
  const personTeam = useMemo(() => { const m = new Map(); for (const [tid, list] of members) for (const p of list) if (!m.has(p.id)) m.set(p.id, tid); return (id) => m.get(id) || null; }, [members]);
  const fallback = useMemo(() => freestTeam(members, (id) => !teamIds || teamIds.has(id)), [members, teamIds]);
  const suggTeam = useMemo(() => new Map(sorted.map((r) => [r.id, suggestTeam(r, { componentTeams: settings.componentTeams, history, teamIds, similar, personTeam, fallback })])), [sorted, settings, history, teamIds, similar, personTeam, fallback]);
  const suggWho = useMemo(() => suggestAssignees(sorted, (r) => suggTeam.get(r.id)?.teamId, members), [sorted, suggTeam, members]);
  const inView = useMemo(() => sorted.filter((r) => !svcSel || (r.services || []).includes(svcSel)), [sorted, svcSel]);

  const teamOf = (r) => draft[r.id]?.teamId ?? suggTeam.get(r.id)?.teamId ?? null;
  const whoOf = (r) => {
    const t = teamOf(r), list = members.get(t) || [];
    const d = draft[r.id]?.accountId;
    if (d && list.some((p) => p.id === d)) return d;
    if (t === suggTeam.get(r.id)?.teamId && suggWho.has(r.id)) return suggWho.get(r.id);
    return list.find((p) => p.cap > 0)?.id || null;
  };
  const changed = (r) => !!draft[r.id] && (teamOf(r) !== suggTeam.get(r.id)?.teamId || whoOf(r) !== (suggWho.get(r.id) ?? null));

  const list = useMemo(() => filterDispatch(inView, { filter, q, teamOf, cal }), [inView, filter, q, draft, suggTeam, cal]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = list.slice(0, limit);
  const counts = useMemo(() => {
    const byTeam = new Map();
    for (const r of inView) { const t = teamOf(r); if (t) byTeam.set(t, (byTeam.get(t) || 0) + 1); }
    return { all: inView.length, critical: inView.filter(isCritical).length, high: inView.filter((r) => isHighPriority(r.priority, cal)).length, byTeam: [...byTeam].sort((a, b) => tname(a[0]).localeCompare(tname(b[0]))) };
  }, [inView, draft, suggTeam, cal]); // eslint-disable-line react-hooks/exhaustive-deps
  const breached = inView.filter((r) => r.sla?.status === 'breached').length;
  const selShown = shown.filter((r) => sel.has(r.id));
  const allSel = shown.length > 0 && shown.every((r) => sel.has(r.id));
  // KI-Assistent: team and person for the selected tickets (or the first six shown) – applied through the same assign
  const aiRows = useRef([]);
  const ai = useAiAssist({ feature: 'dispatch', build: () => {
    aiRows.current = (selShown.length ? selShown : shown).slice(0, ai.aiEnabled ? 6 : LOTSE_MAX);
    return dispatchPayload({ max: aiRows.current.length, tickets: aiRows.current, teams, members, suggTeam, history, mapping: settings.componentTeams, personName: pname });
  } });
  const aiAssign = async (r) => {
    const targets = r.items.map((x) => aiRows.current.find((t) => t.id === x.issueId)).filter(Boolean);
    await assign(targets, dispatchOverrides(r), { via: r.source === 'lotse' ? 'lotse' : 'ai' });
    // keep going: Lotse looks at the next tickets right away (live finding 2026-11-17 – it stopped after one batch)
    setRerun((n) => n + 1);
  };
  const [rerun, setRerun] = useState(0);
  useEffect(() => { if (rerun && ai.open) ai.run({ fresh: true }); }, [rerun]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchTicket = (id, fn) => setDs((d) => ({ ...d, supportTickets: { ...d.supportTickets, tickets: d.supportTickets.tickets.map((t) => (t.id === id ? fn(t) : t)) } }));
  const statusLine = (res) => (res.statusChanged ? tr(`Status „${res.after.status.name}“`, `status "${res.after.status.name}"`) : STATUS_NOTE[res.statusNote]?.() || null);

  // over: Map ticketId → { teamId, accountId } (a KI-Vorschlag), else the row's draft or the app's suggestion
  async function assign(targets, over = null, { via = null } = {}) {
    if (!canAssign) { toast({ text: tr('Dir fehlt das Recht „Support-Tickets verteilen“.', 'You lack the right "Dispatch support tickets".'), error: true }); return; }
    const items = targets.map((r) => { const o = over?.get(r.id); const t = o ? o.teamId : teamOf(r); const who = o ? o.accountId : whoOf(r); return { r, issueId: r.id, teamId: teamField && t ? t : null, accountId: !anon ? who || null : null }; }).filter((x) => x.teamId || x.accountId);
    if (!items.length) { toast({ text: tr('Nichts zuzuweisen – Team oder Person fehlt.', 'Nothing to assign – team or person missing.'), error: true }); return; }
    setBusy((b) => new Set([...b, ...items.map((x) => x.issueId)]));
    try {
      const { results } = await call('support.dispatch', { items: items.map(({ issueId, teamId, accountId }) => ({ issueId, ...(teamId ? { teamId } : {}), ...(accountId ? { accountId } : {}) })) });
      const entries = [], added = [];
      for (const res of results) {
        const x = items.find((i) => i.issueId === res.issueId);
        if (!res.ok || !x) continue;
        const snap = ds.supportTickets.tickets.find((t) => t.id === x.issueId);
        const who = res.after.accountId && res.after.accountId !== res.before.accountId ? res.after.accountId : null;
        patchTicket(x.issueId, (t) => ({
          ...t,
          ...(who ? { assignee: { id: who, name: pname(who), avatar: null } } : {}),
          ...(x.teamId && teamField ? { team: { id: x.teamId, name: tname(x.teamId) } } : {}),
          ...(res.after.status ? { status: res.after.status.name, statusId: res.after.status.id, statusCat: res.after.status.cat } : {}),
        }));
        const target = [x.accountId ? pname(x.accountId) : null, x.teamId ? tr(`Team ${tname(x.teamId)}`, `team ${tname(x.teamId)}`) : null].filter(Boolean).join(' · ');
        const text = `${x.r.summary} → ${target}`;
        const note = statusLine(res);
        const undo = async () => {
          const { results: [u] } = await call('support.undoDispatch', { items: [{ issueId: x.issueId, accountId: res.before.accountId, teamId: res.before.teamId, statusId: res.statusChanged ? res.before.statusId : null, restoreTeam: !!x.teamId, restoreAssignee: !!x.accountId }] });
          if (!u?.ok) throw Object.assign(new Error(u?.error?.message || tr('Rückgängig nicht möglich.', 'Undo not possible.')), { code: u?.error?.code });
          const statusBack = !res.statusChanged || u.statusChanged || u.statusNote === 'ALREADY';
          patchTicket(x.issueId, (t) => ({ ...t, assignee: snap?.assignee ?? null, team: snap?.team ?? null, ...(statusBack && snap ? { status: snap.status, statusId: snap.statusId, statusCat: snap.statusCat } : {}) }));
          setRecent((rs) => rs.filter((y) => y.id !== x.issueId));
          if (!statusBack) toast({ text: tr(`${x.r.key}: Zuweisung zurückgenommen, der Status bleibt – der Workflow hat keinen Weg zurück.`, `${x.r.key}: assignment undone, the status stays – the workflow has no way back.`), error: true });
        };
        const label = via === 'ai' ? tr(`${x.r.key} zugewiesen (KI-Vorschlag)`, `${x.r.key} assigned (AI suggestion)`) : via === 'lotse' ? tr(`${x.r.key} zugewiesen (Lotse-Vorschlag)`, `${x.r.key} assigned (Lotse suggestion)`) : tr(`${x.r.key} zugewiesen`, `${x.r.key} assigned`);
        const entry = items.length === 1
          ? done(`${x.r.key} → ${target}${note ? ` · ${note}` : ''}`, 'check', label, undo, [`dispatch:${x.issueId}`])
          : pushUndo(label, undo, [`dispatch:${x.issueId}`]);
        entries.push(entry);
        added.push({ id: x.issueId, key: x.r.key, text, note, entry });
      }
      if (entries.length > 1) toast({ text: tr(`${entries.length} Tickets zugewiesen`, `${entries.length} tickets assigned`), icon: 'check', undo: async () => { for (const e of [...entries].reverse()) await runUndo(e, { quiet: true }); } });
      if (added.length) setRecent((rs) => [...added, ...rs].slice(0, 12));
      const failed = results.filter((x) => !x.ok);
      if (failed.length) {
        const keys = failed.map((f) => items.find((i) => i.issueId === f.issueId)?.r.key).filter(Boolean).join(', ');
        toast({ text: tr(`Nicht zugewiesen: ${keys} – ${errText(failed[0].error)}`, `Not assigned: ${keys} – ${errText(failed[0].error)}`), error: true });
      }
      setSel((s) => { const n = new Set(s); for (const a of added) n.delete(a.id); return n; });
      setDraft((d) => { const n = { ...d }; for (const a of added) delete n[a.id]; return n; });
    } catch (e) {
      toast({ text: errText(e), error: true });
    } finally {
      setBusy((b) => { const n = new Set(b); for (const x of items) n.delete(x.issueId); return n; });
    }
  }
  // ---------- rows: stable handlers (a click on one row re-renders only that row) ----------
  const latest = useRef(null);
  latest.current = { assign };
  const onToggle = useCallback((id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const onTeam = useCallback((id, teamId) => setDraft((d) => ({ ...d, [id]: { teamId: teamId || null } })), []);
  const onWho = useCallback((id, teamId, accountId) => setDraft((d) => ({ ...d, [id]: { teamId, accountId } })), []);
  const onAssign = useCallback((r) => latest.current.assign([r]), []);
  // the options of the two selects, once per data state (not per row and render)
  const teamOpts = useMemo(() => teams.map((t) => ({ value: t.id, label: t.name })), [teams]);
  const memOpts = useMemo(() => {
    const m = new Map();
    for (const [tid, list] of members) m.set(tid, list.map((p) => ({ value: p.id, label: p.cap > 0 ? `${pname(p.id)} · ${fmt.pct(personLoad(p))}` : `${pname(p.id)} · ${tr('abwesend', 'absent')}` })));
    return m;
  }, [members, ds]); // eslint-disable-line react-hooks/exhaustive-deps
  const listRef = useRef(null);
  useRowFlip(listRef, shown.map((r) => r.id).join('|'));

  const undoRecent = async (r) => {
    if (undoList.includes(r.entry)) { await runUndo(r.entry); return; }
    try { await r.entry.run(); toast({ text: `${tr('Rückgängig', 'Undone')}: ${r.key}`, icon: 'history' }); } catch (e) { toast({ text: errText(e), error: true }); }
  };

  const info = infoCard({
    title: tr('Verteilen', 'Dispatching'),
    text: tr(`Neue Support-Tickets, das dringendste SLA zuerst. Vorschlag: Team über die Komponente (Zuordnung in der Konfiguration, sonst das Team, das solche Tickets meist gelöst hat), Person mit der geringsten Auslastung diese Woche – wie in der Wochenplanung. Jedes vorgeschlagene Ticket zählt mit Ø ${PER_TICKET_H} h, damit sich die Vorschläge verteilen.`,
      `New support tickets, most urgent SLA first. Suggestion: team via the component (mapping in the configuration, else the team that usually resolved such tickets), the person with the lowest load this week – as in the weekly planning. Every suggested ticket counts with Ø ${PER_TICKET_H} h so suggestions spread.`),
    hint: tr('„Zuweisen“ setzt Team, Person und den konfigurierten Status in Jira – mit deinen Rechten, ohne E-Mail-Benachrichtigung, rückgängig per Strg+Z.', '"Assign" sets team, person and the configured status in Jira – with your permissions, without email notification, undo with Ctrl+Z.'),
  });

  const filterChip = (value, label, n) => (
    <button key={value} type="button" className="sp-chip sm" aria-pressed={filter === value} onClick={() => { setFilter(value); setLimit(PAGE); }}>
      {filter === value && <motion.span layoutId="sp-disp-filter" className="sp-chip-pill" transition={spring} />}
      {label}<span className="sp-count">{n}</span>
    </button>
  );

  return (
    <section className="card" style={{ overflow: 'hidden' }}>
      <div className="sp-head">
        <h2 className="card-title"><Icon name="send" />{tr('Verteilen', 'Dispatching')}</h2>
        <span className="sp-info" tabIndex={0} {...tip(info)}><Icon name="info" size={14} /></span>
        <span className="chip num">{inView.length}</span>
        {breached > 0 && <span className="chip chip-bad num">{tr(`${breached} über dem SLA`, `${breached} past SLA`)}</span>}
        <div className="sp-head-end">
          {canAssign && inView.length > 0 && <AiButton ai={ai} label={selShown.length ? tr(`Verteilen (${Math.min(ai.aiEnabled ? 6 : LOTSE_MAX, selShown.length)})`, `Dispatch (${Math.min(ai.aiEnabled ? 6 : LOTSE_MAX, selShown.length)})`) : tr('Verteilen', 'Dispatch')} />}
          {selShown.length > 0 && (
            <motion.button type="button" className="btn btn-primary btn-sm" {...enter(0, { y: 0, scale: 0.96, d: 'quick' })} onClick={() => assign(selShown)} disabled={busy.size > 0}>
              <Icon name="check" size={14} />{tr(`Ausgewählte zuweisen (${selShown.length})`, `Assign selected (${selShown.length})`)}
            </motion.button>
          )}
        </div>
      </div>
      {ai.open && (
        <div style={{ padding: '0 16px 12px' }}>
          <AiPanel ai={ai} title={tr('Team und Person je Ticket', 'Team and person per ticket')} render={(r, nm) => <AiDispatchList r={r} nm={nm} pname={pname} tname={tname} />}
            onApply={aiAssign} canApply={(r) => r.items?.length > 0} applyLabel={tr('Zuweisen', 'Assign')} />
        </div>
      )}
      {mode !== 'status' && (
        <div className="sp-hint"><Icon name="info" size={13} /><span>{mode === 'noStatusIds'
          ? tr('Die Tickets bringen keine Status-IDs mit – gezeigt werden alle offenen Tickets im Status „Zu erledigen“.', 'The tickets carry no status ids – showing every open ticket in the "To Do" category.')
          : tr('Keine Eingangs-Status konfiguriert – gezeigt werden alle offenen Tickets im Status „Zu erledigen“. Ein Jira-Admin legt sie unter Konfiguration › Support fest.', 'No incoming statuses configured – showing every open ticket in the "To Do" category. A Jira admin sets them under Configuration › Support.')}</span></div>
      )}
      <div className="sp-toolbar">
        <div className="sp-chipgroups">
          <div className="sp-chips" role="group" aria-label={tr('Zeigen', 'Show')}>
            <span className="sp-chips-label">{tr('Zeigen', 'Show')}</span>
            {filterChip('all', tr('Alle', 'All'), counts.all)}
            {counts.critical > 0 && filterChip('critical', tr('SLA kritisch', 'SLA critical'), counts.critical)}
            {filterChip('high', tr('Priorität hoch', 'High priority'), counts.high)}
          </div>
          {counts.byTeam.length > 0 && (
            <div className="sp-chips" role="group" aria-label={tr('Nach Team', 'By team')} data-team-chips>
              <span className="sp-chips-label" {...tip(infoCard({ title: tr('Nach Team', 'By team'), text: tr('Das Team, das ein Ticket beim Zuweisen bekommt – der Vorschlag oder deine Auswahl in der Spalte „Team“. Ein Klick zeigt nur diese Tickets; die Zahl ist ihre Anzahl.', 'The team a ticket gets when you assign it – the suggestion or your choice in the "Team" column. A click shows only those tickets; the number is how many.') }))}>{tr('Nach Team', 'By team')}<Icon name="info" size={12} /></span>
              {counts.byTeam.map(([id, n]) => filterChip(`team:${id}`, tname(id), n))}
            </div>
          )}
        </div>
        <label className="input-wrap" style={{ width: 240 }}>
          <Icon name="search" size={14} />
          <input className="input input-sm" type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder={tr('Key, Titel oder Komponente', 'Key, title or component')} aria-label={tr('Tickets durchsuchen', 'Search tickets')} />
        </label>
      </div>
      {list.length === 0 ? (
        <Empty icon="check" title={inView.length ? tr('Keine Tickets für diese Auswahl', 'No tickets for this selection') : tr('Alles verteilt', 'Everything dispatched')}>
          {inView.length ? null : tr('Kein neues Ticket wartet auf ein Team.', 'No new ticket is waiting for a team.')}
        </Empty>
      ) : (
        <div className="sp-scroll tall" tabIndex={0} ref={listRef}>
          <div className="sp-grid-disp sp-thead">
            <input type="checkbox" className="sp-check" checked={allSel} onChange={() => setSel((s) => { const n = new Set(s); for (const r of shown) { if (allSel) n.delete(r.id); else n.add(r.id); } return n; })} aria-label={tr('Alle auswählen', 'Select all')} />
            <span>Ticket</span><span>{tr('Priorität · SLA', 'Priority · SLA')}</span><span>Team</span><span>{tr('Bearbeitung', 'Assignee')}</span><span />
          </div>
          {shown.map((r, i) => {
            const team = teamOf(r);
            return (
              <DispatchRow key={r.id} r={r} i={i} team={team} who={whoOf(r)} memOpts={memOpts.get(team) || null} teamOpts={teamOpts} st={suggTeam.get(r.id)}
                selected={sel.has(r.id)} isBusy={busy.has(r.id)} changed={changed(r)} anon={anon} cal={cal} serviceName={serviceName} slaText={slaText} tip={tip}
                onToggle={onToggle} onTeam={onTeam} onWho={onWho} onAssign={onAssign} />
            );
          })}
          {list.length > shown.length && <div className="sp-more"><button className="btn btn-sm btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>{tr(`${list.length - shown.length} weitere zeigen`, `Show ${list.length - shown.length} more`)}</button></div>}
        </div>
      )}
      {otherNew > 0 && <div className="sp-hint" style={{ borderTop: '1px solid var(--line-soft)', borderBottom: 0 }}><Icon name="info" size={13} /><span>{tr(`${otherNew} weitere offene ${otherNew === 1 ? 'Ticket steht' : 'Tickets stehen'} in anderen Status (z. B. „Neu“) und ${otherNew === 1 ? 'erscheint' : 'erscheinen'} hier nicht.`, `${otherNew} more open ${otherNew === 1 ? 'ticket is' : 'tickets are'} in other statuses (e.g. "New") and not listed here.`)}</span></div>}
      {!teamField && <div className="sp-hint" style={{ borderTop: '1px solid var(--line-soft)', borderBottom: 0 }}><Icon name="info" size={13} /><span>{tr('Kein Team-Feld konfiguriert – „Zuweisen“ setzt nur die Person und den Status.', 'No team field configured – "Assign" sets only the person and the status.')}</span></div>}
      {recent.length > 0 && (
        <div className="sp-recent">
          <span className="eyebrow">{tr('Gerade zugewiesen', 'Just assigned')}</span>
          {recent.map((x) => (
            <motion.div key={x.id} className="sp-recent-row" {...enter(0, { y: -4 })}>
              <button className="tkey" onClick={() => openIssue(x.key)}>{x.key}</button>
              <span>{x.text}</span>
              {x.note && <span className="sp-meta">{x.note}</span>}
              <button type="button" className="btn btn-xs" onClick={() => undoRecent(x)}><Icon name="undo" size={12} />{tr('Rückgängig', 'Undo')}</button>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}

// One ticket row. Memoized: ticking a box, typing in the search or picking a team re-renders only the rows that
// changed. Plain markup (no framer `layout` per row – it measured all 60 rows on every render, 240 ms on a big site);
// the entrance is a CSS rise (staggered like enter()), reordering glides with useRowFlip below.
const DispatchRow = memo(function DispatchRow({ r, i, team, who, memOpts, teamOpts, st, selected, isBusy, changed, anon, cal, serviceName, slaText, tip, onToggle, onTeam, onWho, onAssign }) {
  const comps = componentNames(r);
  const [stagger] = useState(() => Math.min(i, 12)); // only the first mount staggers
  return (
    <div data-flip={r.id} className={`sp-grid-disp sp-drow sp-drow-in ${selected ? 'selected' : ''} ${isBusy ? 'busy' : ''}`} style={{ '--i': stagger }}>
      <input type="checkbox" className="sp-check" checked={selected} onChange={() => onToggle(r.id)} aria-label={tr(`${r.key} auswählen`, `Select ${r.key}`)} />
      <div className="sp-ticket">
        <span className="sp-ticket-title"><button className="tkey" onClick={() => openIssue(r.key)}>{r.key}</button> <span title={r.summary}>{r.summary}</span></span>
        <span className="sp-meta">{[(r.services || []).map(serviceName).filter(Boolean).join(', '), comps.join(', '), r.status, r.created ? fmt.ago(r.created) : null].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="sp-cell">
        <span className={`chip ${isHighPriority(r.priority, cal) ? 'chip-accent' : ''}`}>{r.priority || '–'}</span>
        <span className={`chip ${r.sla?.status === 'breached' ? 'chip-bad' : isCritical(r) ? 'chip-warn' : 'chip-outline'}`}>{slaText(r.sla)}</span>
      </div>
      <div className="sp-cell">
        <LazySelect value={team || ''} options={teamOpts} placeholder={team ? null : tr('– Team wählen –', '– pick a team –')} onChange={(v) => onTeam(r.id, v)} label={tr(`Team für ${r.key}`, `Team for ${r.key}`)} />
        {st?.source && team === st.teamId && <span className="sp-tag" tabIndex={0} {...tip(infoCard({ title: tr('Warum dieses Team?', 'Why this team?'), text: st.source === 'mapping' ? tr(`Komponente „${st.component}“ ist in der Konfiguration diesem Team zugeordnet.`, `Component "${st.component}" is mapped to this team in the configuration.`) : st.source === 'history' ? tr(`Tickets mit der Komponente „${st.component}“ hat zuletzt meist dieses Team gelöst.`, `Tickets with component "${st.component}" were mostly resolved by this team.`) : st.source === 'similar' ? tr(`Ähnliche Tickets hatte dieses Team – am ähnlichsten ${st.basis}${st.words?.length ? ` (gleiche Wörter: ${st.words.join(', ')})` : ''}.`, `This team had similar tickets – most similar ${st.basis}${st.words?.length ? ` (shared words: ${st.words.join(', ')})` : ''}.`)
          : st.source === 'assignee' ? tr('Die Person am Ticket gehört zu diesem Team.', 'The person on the ticket belongs to this team.')
            : st.source === 'capacity' ? tr(`Kein Hinweis am Ticket (Komponente, Verlauf, ähnliche Tickets). Vorschlag: das Team mit der meisten freien Zeit diese Woche (${fmt.h(st.free || 0)} frei) – bitte prüfen.`, `No hint on the ticket (component, history, similar tickets). Suggestion: the team with the most free time this week (${fmt.h(st.free || 0)} free) – please check.`)
              : tr('Das Team steht bereits am Ticket.', 'The team is already on the ticket.') }))}>{st.source === 'mapping' ? tr('über Komponente', 'via component') : st.source === 'history' ? tr('aus dem Verlauf', 'from history') : st.source === 'similar' ? tr(`wie ${st.basis}`, `like ${st.basis}`) : st.source === 'assignee' ? tr('über Person', 'via person') : st.source === 'capacity' ? tr('freie Zeit · prüfen', 'free time · check') : tr('am Ticket', 'on ticket')}</span>}
      </div>
      <div className="sp-cell">
        {anon ? <span className="faint" style={{ fontSize: 12.5 }}>{tr('Personenwerte sind ausgeschaltet', 'Person-level values are off')}</span> : memOpts?.length ? (
          <>
            <LazySelect value={who || ''} options={memOpts} placeholder={who ? null : tr('– Person wählen –', '– pick a person –')} onChange={(v) => onWho(r.id, team, v)} label={tr(`Person für ${r.key}`, `Person for ${r.key}`)} />
            {changed
              ? <span className="sp-tag changed"><Icon name="edit" size={11} />{tr('geändert', 'changed')}</span>
              : <span className="sp-tag" tabIndex={0} {...tip(infoCard({ title: tr('Vorschlag der App', 'Suggested by the app'), text: tr(`Geringste Auslastung im Team diese Woche (geplante Stunden ÷ Kapazität nach Support). Bereits vorgeschlagene Tickets zählen mit je ${PER_TICKET_H} h.`, `Lowest load in the team this week (planned hours ÷ capacity after support). Already suggested tickets count with ${PER_TICKET_H} h each.`) }))}><Icon name="sparkle" size={11} />{tr('Vorschlag', 'Suggestion')}</span>}
          </>
        ) : <span className="faint" style={{ fontSize: 12.5 }}>{team ? tr('Keine Personen mit Kapazität im Team', 'No people with capacity in the team') : '–'}</span>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-sm btn-dark" onClick={() => onAssign(r)} disabled={isBusy || (!team && !who)} aria-label={tr(`${r.key} zuweisen`, `Assign ${r.key}`)}>
          {isBusy ? <Icon name="refresh" size={13} /> : null}{tr('Zuweisen', 'Assign')}
        </button>
      </div>
    </div>
  );
});

// A native select that holds only its chosen option until it is used: 60 rows × 40 teams were 2,400 option elements
// on every render. Pressing, focusing or a key fills in every option first (flushSync – before the browser opens the
// list), so mouse, keyboard and screen readers always get the full list. Shows the same value as before.
function LazySelect({ value, options, placeholder, onChange, label }) {
  const [all, setAll] = useState(false);
  const arm = () => { if (!all) flushSync(() => setAll(true)); };
  const cur = all ? null : options.find((o) => o.value === value);
  return (
    <select className="select select-sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
      onPointerDown={arm} onMouseDown={arm} onFocus={arm} onKeyDown={arm}>
      {placeholder && <option value="">{placeholder}</option>}
      {all ? options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>) : cur ? <option value={cur.value}>{cur.label}</option> : null}
    </select>
  );
}

// Rows glide to their new place when the list order changes (a ticket assigned, a filter, the search) – transform
// only, measured only on such a change (not on every render), positions relative to the list (scrolling does not
// count). The first positions are read when the browser is idle after the first paint, where reading is free.
function useRowFlip(ref, key) {
  const pos = useRef(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    const read = () => {
      const top = root.getBoundingClientRect().top - root.scrollTop;
      const m = new Map();
      for (const el of root.querySelectorAll('[data-flip]')) m.set(el.dataset.flip, el.getBoundingClientRect().top - top);
      return m;
    };
    const before = pos.current;
    if (!before) {
      const later = typeof requestIdleCallback === 'function' ? requestIdleCallback(() => { pos.current = read(); }, { timeout: 1500 }) : setTimeout(() => { pos.current = read(); }, 300);
      return () => (typeof cancelIdleCallback === 'function' ? cancelIdleCallback(later) : clearTimeout(later));
    }
    const now = read();
    pos.current = now;
    if (isReduced()) return undefined;
    for (const el of root.querySelectorAll('[data-flip]')) {
      const b = before.get(el.dataset.flip), a = now.get(el.dataset.flip);
      if (b == null || a == null || Math.abs(b - a) < 1 || !el.animate) continue;
      el.animate([{ transform: `translateY(${b - a}px)` }, { transform: 'none' }], { duration: MS.base, easing: cssEase(EASE) });
    }
    return undefined;
  }, [ref, key]);
}

function AiDispatchList({ r, nm, pname, tname }) {
  return (
    <ul className="ai-list" aria-label={tr('Vorgeschlagene Zuweisungen', 'Suggested assignments')}>
      {r.items.map((x, i) => (
        <motion.li key={x.issueId} className="ai-item" {...enter(i, { y: 4, delay: 0.04 })}>
          <span className="tkey">{x.key}</span>
          <b>{tname(x.teamId)}{x.accountId ? ` · ${pname(x.accountId)}` : ''}</b>
          {x.why && <span className="ai-item-why">{nm.text(x.why)}</span>}
        </motion.li>
      ))}
    </ul>
  );
}
