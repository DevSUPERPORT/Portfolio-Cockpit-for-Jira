// Local design backend for the Support upgrade (UC-17): 'support.dispatch', 'support.undoDispatch', 'support.reserve'.
// Wiring in lib/mock.js (dev builds only):
//   import { dispatchMocks, enrichMockTickets, MOCK_SUPPORT_DISPATCH } from './mockDispatch.js';
//   enrichMockTickets(supportTickets.tickets, TEAMS);                       // once, after the tickets are generated
//   config.support = { ...config.support, ...MOCK_SUPPORT_DISPATCH };        // incoming statuses, mapping, cause field
//   const dm = dispatchMocks({ tickets: () => supportTickets.tickets, capacity: () => capacity, config: () => config, roles: () => roles });
//   // in invoke(name, payload):  if (dm[name]) return dm[name](payload);
// Admin settings props for <SupportDispatchSettings>: MOCK_STATUSES, MOCK_COMPONENTS, MOCK_CAUSE_FIELDS.
import { canDispatch, validDispatchItems, validReserve } from '@shared/dispatch.js';
import { isoOf, todayIdx } from '@shared/dates.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (data) => ({ ok: true, data });
const fail = (code, message) => ({ ok: false, error: { code, message } });

export const MOCK_STATUSES = [
  { id: '1', name: 'Offen', category: 'new' }, { id: '2', name: 'Neu', category: 'new' }, { id: '6', name: 'Wartet auf Support', category: 'new' },
  { id: '3', name: 'In Arbeit', category: 'indeterminate' }, { id: '4', name: 'Wartet auf Kunde', category: 'indeterminate' }, { id: '5', name: 'Erledigt', category: 'done' },
];
const STATUS = Object.fromEntries(MOCK_STATUSES.map((s) => [s.id, s]));
// the mock workflow: which status can go where
const FLOW = { 1: ['3', '5'], 2: ['1', '3'], 6: ['3', '4'], 3: ['1', '4', '5'], 4: ['3'], 5: ['3'] };
export const MOCK_COMPONENTS = ['Konto', 'Export', 'Netzwerk', 'Checkout', 'Hardware', 'SAP', 'Stammdaten'];
export const MOCK_CAUSE_FIELDS = [{ id: 'customfield_10500', name: 'Ursache' }, { id: 'customfield_10501', name: 'Kategorie (alt)' }];
export const MOCK_SUPPORT_DISPATCH = {
  dispatch: { incomingStatusIds: ['1', '6'], afterStatusId: '3', componentTeams: { Netzwerk: 't-int', Hardware: 't-mob' } },
  timeGroupBy: 'requestType', causeFieldId: 'customfield_10500',
};
const BY_SUBJECT = {
  'Login schlägt fehl': ['Konto', 'Passwort zurücksetzen', 'Bedienung'], 'Passwort-Reset kommt nicht an': ['Konto', 'Passwort zurücksetzen', 'Bedienung'],
  'Rechnung doppelt verschickt': ['SAP', 'Problem mit Rechnung melden', 'Fehler im Release'], 'VPN bricht ab': ['Netzwerk', 'Zugang beantragen', 'Drittsystem'],
  'Export hängt': ['Export', 'Technisches Problem melden', 'Fehler im Release'], 'Portal lädt langsam': ['Checkout', 'Technisches Problem melden', 'Drittsystem'],
  'Schnittstelle liefert 500': ['SAP', 'Technisches Problem melden', 'Drittsystem'], 'Druckauftrag verschwindet': ['Hardware', 'Email request', ''],
  'Neue Benutzerin anlegen': ['Konto', 'Neuen Mitarbeiter ausstatten', 'Onboarding'], 'Datenabgleich unvollständig': ['Stammdaten', 'Stammdaten ändern', 'Datenqualität'],
  'App stürzt beim Start ab': ['', 'Email request', ''], 'Zertifikat läuft ab': ['Netzwerk', 'Get IT help', 'Drittsystem'],
};

// Adds what the real dataset will carry (statusId, components, requestType, cause, dated worklogs), deterministically.
export function enrichMockTickets(tickets, teams) {
  const today = todayIdx();
  tickets.forEach((t, k) => {
    const [comp, rt, cause] = BY_SUBJECT[t.summary] || ['', 'Email request', ''];
    t.components = comp ? [comp] : [];
    t.requestType = rt;
    t.cause = cause || null;
    const sid = t.statusCat === 'done' ? '5' : t.statusCat === 'indeterminate' ? (k % 3 ? '3' : '4') : k % 5 === 0 ? '2' : k % 2 ? '6' : '1';
    t.statusId = sid; t.status = STATUS[sid].name;
    if (t.statusCat === 'new' && k % 2) { t.assignee = null; }
    if (comp === 'Export' && t.team?.id !== 't-int' && t.statusCat === 'done') t.team = teams.find((x) => x.id === 't-int') || t.team;
    // spread the ticket's time over up to three dated worklogs in the last five weeks
    const h = t.spentH || 0;
    const parts = h > 0 ? Math.min(3, Math.max(1, Math.round(h / 2))) : 0;
    t.worklogs = Array.from({ length: parts }, (_, i) => ({ a: t.assignee?.id || null, d: isoOf(today - 3 - ((k * 5 + i * 9) % 33)), h: Math.round((h / parts) * 4) / 4 }));
  });
  return tickets;
}

export function dispatchMocks({ tickets, capacity, config, roles }) {
  const find = (id) => tickets().find((t) => t.id === id);
  const people = () => Object.keys(capacity().people || {});
  const teamName = (id) => capacity().teams?.[id]?.name || id;
  const run = async (payload, undo) => {
    await wait(380);
    if (!canDispatch(roles())) return fail('NO_ACCESS', 'NO_ACCESS:dispatch');
    let items;
    try { items = validDispatchItems(payload?.items, { undo }); } catch (e) { return fail('INVALID', e.message); }
    const after = config().support?.dispatch?.afterStatusId || null;
    const results = items.map((x) => {
      const t = find(x.issueId);
      const out = { issueId: x.issueId, ok: false, error: null, before: null, after: null, statusChanged: false, statusNote: null, notes: [] };
      if (!t) { out.error = { code: 'NOT_FOUND', message: 'Not a visible support ticket' }; return out; }
      out.before = { accountId: t.assignee?.id || null, teamId: t.team?.id || null, statusId: t.statusId || null };
      if (!undo && x.accountId && !people().includes(x.accountId)) { out.error = { code: 'FORBIDDEN', message: 'User cannot be assigned' }; return out; }
      const setA = undo ? x.restoreAssignee : x.accountId != null;
      const setT = undo ? x.restoreTeam : x.teamId != null;
      if (setA) t.assignee = x.accountId ? { id: x.accountId, name: '', avatar: null } : null;
      if (setT) t.team = x.teamId ? { id: x.teamId, name: teamName(x.teamId) } : null;
      const target = undo ? x.statusId : after;
      if (!target) out.statusNote = 'NO_TARGET';
      else if (target === t.statusId) out.statusNote = 'ALREADY';
      else if (!(FLOW[t.statusId] || []).includes(target)) out.statusNote = 'NO_TRANSITION';
      else {
        const st = STATUS[target];
        t.statusId = st.id; t.status = st.name; t.statusCat = st.category;
        out.statusChanged = true;
      }
      out.ok = true;
      out.after = { accountId: t.assignee?.id || null, teamId: t.team?.id || null, status: out.statusChanged ? { id: t.statusId, name: t.status, cat: t.statusCat } : null };
      return out;
    });
    return ok({ results });
  };
  return {
    'support.dispatch': (payload) => run(payload, false),
    'support.undoDispatch': (payload) => run(payload, true),
    'support.reserve': async (payload) => {
      await wait(300);
      const r = roles();
      if (!(r.editCapacity || r.admin)) return fail('NO_ACCESS', 'NO_ACCESS:editCapacity');
      let v;
      try { v = validReserve(payload); } catch (e) { return fail('INVALID', e.message); }
      const cap = capacity();
      cap.teams = cap.teams || {};
      const prev = cap.teams[v.teamId]?.supportOverride ?? null;
      if (cap.teams[v.teamId] || v.hours != null) cap.teams[v.teamId] = { ...(cap.teams[v.teamId] || { name: payload.teamName || v.teamId, dailyBusinessPct: 20, internalPct: 0, absenceRatePct: 10, extraWeeklyHours: 0 }), supportOverride: v.hours };
      return ok({ teamId: v.teamId, hours: v.hours, previous: prev });
    },
  };
}
