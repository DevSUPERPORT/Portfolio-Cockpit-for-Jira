// Lotse acts – commands in plain language (DE/EN): "Gib allen Stories ohne Team in Glasfaser-Netzausbau das Team Netz",
// "set the estimate of all KPR stories without estimate to 8 h", "verschiebe alles von Anna in KW 48 eine Woche später",
// "setze Health aller meiner Projekte auf im Plan mit Kommentar …".
//
// parseBulk(text, ctx) →
//   null                                                         not a command
//   { kind: 'command', command, params, filter?, confidence, describe }   ready for preview (never applied here)
//   { kind: 'decide', question, options: [{ id, label, detail?, recommended?, value: { command, params } }],
//     freeText?: { placeholder, kind: 'hours'|'text'|'date', command, params, path }, reason }
//                                                                something is missing or ambiguous – never guess on writes
// resolveDecide(decide, answer, ctx) → { command, params } | null   answer = option id | { text }
import { findProject } from '../../ask.js';
import { parseDay } from '../../smartActions.js';
import { dayIdx, isoOf, mondayOf } from '../../dates.js';
import { T, fold, langOf, computedOf, dsOf, meId, can, issueOf, byKeyIndex, FIELDS, fieldName, cleanValue, valueText, selectIssues, describeFilter, weekKeyOf, teamLabel, personLabel, projectLabel, fmt, plural, healthName, ownsProject } from './kit.js';
import { COMMANDS } from './commands.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEY_RAW = /\b([A-Z][A-Z0-9_]{1,19}-\d{1,9})\b/g;
const NUMW = { ein: 1, eine: 1, einen: 1, einer: 1, one: 1, a: 1, an: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4, fuenf: 5, five: 5, sechs: 6, six: 6 };
const FIELD_RE = {
  estimate: /schaetzung(en)?|schaetzwert|aufwand|original ?estimates?|estimates?/,
  tshirt: /t-?shirt(-?groessen?)?|\bgroessen?\b|\bsizes?\b/,
  quarters: /ziel-?quartale?|target quarters?/,
  due: /due ?dates?|faelligkeit(sdatum)?|enddatum|end ?dates?|deadlines?|\btermine?\b/,
  start: /start ?(datum|dates?)|\bstart\b|beginn/,
  assignee: /bearbeiter(in)?|assignees?/,
  team: /\bteams?\b/,
};
const MISSING_RE = new RegExp(`\\b(ohne|without|with no|missing|fehlende[nmrs]?|keine[nmrs]?|no)\\s+(?:eine?n?\\s+|an?\\s+|the\\s+)?(${Object.values(FIELD_RE).map((r) => r.source).join('|')})`);
const IMPERATIVE = /^(bitte |please |lotse,? )?(gib|gebe|setz|setze|setzt|trag|trage|fuell|fuelle|verschieb|verschiebe|schieb|schiebe|weis|weise|ordne|buche|buch|erfasse|erinnere|verknuepf|verknuepfe|reservier|reserviere|aender|aendere|stell|stelle|zieh|ziehe|leg|lege|entfern|entferne|loesch|loesche|oeffne|geh|gehe|give|set|put|fill|move|shift|push|postpone|pull|assign|book|log|remind|link|unlink|reserve|change|update|make|add|remove|delete|open|go|mark|rank|priorisiere|prioritize)\b/;

function prep(text) {
  const raw = String(text || '').slice(0, 500);
  const keys = [...raw.matchAll(KEY_RAW)].map((m) => m[1]);
  const q = fold(raw).replace(/[?!;„“"”()]+/g, ' ').replace(/\s+/g, ' ').trim();
  // without work item keys (a "KPR-105" must not read as project KPR) and without quoted comments
  const qn = q.replace(/\b[a-z][a-z0-9_]{1,19}-\d{1,9}\b/g, ' ').replace(/\s+/g, ' ');
  return { raw, q, qn, keys };
}
// the people with their folded names and patterns, built once per people object (not 600 regexes per sentence)
const word = (w) => new RegExp(`(^|[^a-z0-9])${esc(w)}('?s)?([^a-z0-9]|$)`);
const peopleIx = new WeakMap();
function peopleIndex(ctx) {
  const src = dsOf(ctx).people || {};
  let ix = peopleIx.get(src);
  if (!ix) {
    const firstRe = new Map();
    ix = Object.values(src).filter((p) => p?.name).map((p) => {
      const n = fold(p.name), f = n.split(' ')[0];
      if (!firstRe.has(f)) firstRe.set(f, word(f));
      return { p, n, re: word(n), f, fre: firstRe.get(f) };
    });
    peopleIx.set(src, ix);
  }
  return ix;
}
function people(ctx, q) {
  const all = peopleIndex(ctx);
  const full = all.filter((x) => x.n.length >= 4 && x.re.test(q));
  if (full.length) return full.map((x) => ({ p: x.p, at: q.search(x.re), len: x.n.length }));
  const byFirst = new Map();
  for (const x of all) { if (x.f.length >= 3 && x.fre.test(q)) (byFirst.get(x.f) || byFirst.set(x.f, []).get(x.f)).push(x.p); }
  return [...byFirst].map(([f, ps]) => ({ p: ps.length === 1 ? ps[0] : null, ambiguous: ps.length > 1 ? ps : null, at: q.search(word(f)), first: f }));
}
function weekOf(q, ctx) {
  const today = dayIdx(dsOf(ctx).today);
  let m;
  if ((m = /\b(?:kw|week|woche|wk)\s*(\d{1,2})\b/.exec(q))) {
    const n = +m[1];
    if (n < 1 || n > 53) return null;
    const cur = weekKeyOf(today);
    let y = +cur.slice(0, 4);
    if (n < +cur.slice(-2) - 10) y++;
    return `${y}-W${String(n).padStart(2, '0')}`;
  }
  if (/\b(diese|dieser|this) (woche|week)\b/.test(q)) return weekKeyOf(today);
  if (/\b(naechste|naechsten|next) (woche|week)\b/.test(q)) return weekKeyOf(today + 7);
  return null;
}
const hoursOf = (q) => { const m = /(\d+(?:[.,]\d+)?)\s*(?:h|std|stunden|hours?|hrs?)\b/.exec(q); return m ? +m[1].replace(',', '.') : null; };
function weeksOf(q) {
  const m = /\b(\d{1,2}|ein|eine|einen|one|a|zwei|two|drei|three|vier|four|fuenf|five|sechs|six)\s+(wochen?|weeks?)\b/.exec(q);
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? +m[1] : NUMW[m[1]] || null;
}
const levelOf = (q) => (/\bepics?\b/.test(q) ? 'epic' : /\bworkstreams?\b/.test(q) ? 'workstream' : /\b(sub-?tasks?|unteraufgaben)\b/.test(q) ? 'subtask' : 'story');
const healthOf = (q) => (/\b(im plan|on track|ontrack|gruen|green)\b/.test(q) ? 'onTrack' : /\b(gefaehrdet|at risk|gelb|yellow|amber)\b/.test(q) ? 'atRisk' : /\b(kritisch|critical|rot|red)\b/.test(q) ? 'critical' : null);

// the team the text names as the TARGET ("das Team Netz", "to team Web") and the one it filters by ("von Team Web")
// folded team names with their patterns, once per teams Map
const teamsIx = new WeakMap();
function teamsIndex(model) {
  let ix = teamsIx.get(model.teams);
  if (!ix) {
    ix = [...model.teams.values()].map((t) => { const n = fold(t.name); return { t, n, re: new RegExp(`(^|[^a-z0-9])${esc(n)}([^a-z0-9]|$)`, 'g') }; });
    teamsIx.set(model.teams, ix);
  }
  return ix;
}
function teamsOf(qn, model, projectName) {
  const q = projectName ? qn.replace(new RegExp(esc(projectName), 'g'), ' ') : qn;
  const out = { target: null, filter: null, any: null };
  for (const { t, n, re } of teamsIndex(model)) {
    for (const m of q.matchAll(re)) {
      const before = q.slice(Math.max(0, m.index - 22), m.index + 1);
      const hit = { t, len: n.length };
      if (/\b(von|vom|of|im|in|des|aus|from|fuer|for) (dem |the )?teams? ?$/.test(before.trimEnd() + ' ') || /\b(von|of|im|in|des|aus|from) $/.test(before)) { if (!out.filter || out.filter.len < hit.len) out.filter = hit; } else if (/\b(teams?|auf|to|an|nach|zu|into|ins)\b ?$/.test(before.trimEnd() + ' ') || /\bteam $/.test(before)) { if (!out.target || out.target.len < hit.len) out.target = hit; }
      if (!out.any || out.any.len < hit.len) out.any = hit;
    }
  }
  return { target: out.target?.t || null, filter: out.filter?.t || null, any: out.any?.t || null };
}

// Every branch of parseBulk needs at least one of these; without any of them the sentence is not a command.
const REMIND = /\b(erinnere|erinner|remind)\b/;
const RESERVE = /\b(reserve|reservier|reserviere|support-?reserve)\b/;
const BOOK = /^(bitte |please )?(buche|buch|book|log|erfasse)\b/;
const ABSENCE = /\b(urlaub|vacation|holiday|abwesend|away|absent|schulung|training)\b/;
const NAV = /^(bitte |please )?(oeffne|geh zu|gehe zu|open|go to|show me the|zeig mir die ansicht)\b/;
const RANK = /\b(rang|rank|platz|prioritaet|priority|ganz oben|to the top|nach vorne|ans ende|to the bottom|ganz nach hinten)\b/;
const HEALTH = /\b(health|ampel|status)\b/;
const MOVE = /\b(verschieb|verschiebe|schieb|schiebe|move|shift|postpone|vorziehen|zieh|ziehe)\b/;
const MOVE_SOFT = /\b(push|pull|spaeter|later|frueher|earlier)\b/;
function looksLikeAction(q, qn, rawKeys) {
  return rawKeys.length > 0 || REMIND.test(q) || RESERVE.test(q) || BOOK.test(q) || ABSENCE.test(q) || hoursOf(q) != null || NAV.test(q)
    || RANK.test(qn) || HEALTH.test(q) || MOVE.test(q) || (MOVE_SOFT.test(q) && weeksOf(q) != null)
    || IMPERATIVE.test(q) || /\b(bitte|please)\b/.test(q) || /^(alle|all|allen|every)\b/.test(q) || MISSING_RE.test(qn);
}

const cmd = (command, params, describe, confidence = 'high') => ({ kind: 'command', command, params, ...(params.filter ? { filter: params.filter } : {}), confidence, describe });
const decide = (question, options, extra = {}) => ({ kind: 'decide', question, options, ...extra });

export function parseBulk(text, ctx) {
  const L = langOf(ctx);
  const c = computedOf(ctx);
  const { model } = c;
  const ds = dsOf(ctx);
  const F = fmt(ctx);
  const { raw, q, qn, keys: rawKeys } = prep(text);
  if (!q) return null;
  // a scenario or a question is never a write
  if (/was waere,? wenn|was ist,? wenn|was passiert,? wenn|angenommen|what if|what happens if|suppose|stell dir vor|szenario|scenario/.test(q)) return null;
  if (/^(wie|was|wer|wo|wann|warum|wieso|welche[rsn]?|how|what|who|where|when|why|which|is|are|do|does|did|can|could|hat|habe|haben|ist|sind|kann|koennen)\b/.test(q) && !IMPERATIVE.test(q)) return null;
  // nothing in the sentence that any of the commands below needs: not an action (no entity lookups on 50k work items
  // for "Lagebild Portfolio" or every keystroke of the search)
  if (!looksLikeAction(q, qn, rawKeys)) return null;
  const tickets = ds.supportTickets?.tickets || [];
  const isTicket = (k) => !!byKeyIndex(tickets, k);
  const keys = rawKeys.filter((k) => issueOf(ctx, k) || isTicket(k));
  const ticketKeys = keys.filter(isTicket);
  const issueKeys = keys.filter((k) => issueOf(ctx, k));
  const imperative = IMPERATIVE.test(q) || /\b(bitte|please)\b/.test(q) || /^(alle|all|allen|every)\b/.test(q);
  const project = findProject(qn, model);
  const pname = project ? fold(project.name) : null;
  const teams = teamsOf(qn, model, pname);
  const ps = people(ctx, qn);
  const amb = ps.find((x) => x.ambiguous);
  const person = ps.find((x) => x.p)?.p || null;
  const mine = /\b(mein|meine|meinen|meinem|meiner|meines|my|mine)\b/.test(q);
  const week = weekOf(q, ctx);
  const level = levelOf(q);
  const today = dayIdx(ds.today);
  const filterBase = () => {
    const f = { level };
    if (project) f.project = project.ref;
    if (week) f.week = week;
    if (/\b(blockierte?n?|blocked)\b/.test(q)) f.status = 'blocked';
    if (/\b(ueberfaellige?n?|overdue)\b/.test(q)) f.overdue = true;
    return f;
  };
  const ambDecide = (base) => decide(T(L, `Welche Person meinst du mit „${amb.first}“?`, `Which person do you mean by "${amb.first}"?`),
    amb.ambiguous.map((p) => ({ id: p.id, label: p.name, value: base(p.id) })), { reason: 'ambiguousPerson' });

  // ---- reminders (blocked in the preview unless a Jira admin switched notices on) ----
  if (/\b(erinnere|erinner|remind)\b/.test(q)) {
    const kind = /buch|book|stunden|hours|zeit|time|worklog/.test(q) ? 'booking' : 'gaps';
    let list = [];
    if (person) list = [person.id];
    else if (teams.any) list = Object.entries(ds.capacity?.people || {}).filter(([, p]) => p.teamId === teams.any.id || (p.teams || []).some((x) => x.teamId === teams.any.id)).map(([id]) => id).filter((id) => ds.people?.[id]);
    else if (/\b(alle|allen|everyone|everybody|all)\b/.test(q)) list = Object.keys(ds.capacity?.people || {}).filter((id) => ds.people?.[id]);
    if (amb && !person) return ambDecide((id) => ({ command: 'notice.remind', params: { kind, people: [id] } }));
    if (!list.length) return decide(T(L, 'Wen soll Lotse erinnern?', 'Who should Lotse remind?'), [...model.teams.values()].filter((t) => Object.values(ds.capacity?.people || {}).some((p) => p.teamId === t.id)).slice(0, 6).map((t) => {
      const ids = Object.entries(ds.capacity?.people || {}).filter(([, p]) => p.teamId === t.id).map(([id]) => id);
      return { id: `team:${t.id}`, label: T(L, `Team ${t.name}`, `Team ${t.name}`), detail: T(L, `${ids.length} ${plural(ids.length, 'Person', 'Personen')}`, `${ids.length} ${plural(ids.length, 'person', 'people')}`), value: { command: 'notice.remind', params: { kind, people: ids } } };
    }), { reason: 'noScope' });
    return cmd('notice.remind', { kind, people: list }, T(L, `Erinnerung an ${list.length} ${plural(list.length, 'Person', 'Personen')}`, `Reminder to ${list.length} ${plural(list.length, 'person', 'people')}`));
  }

  // ---- dependencies: "KPR-1 blockiert ERP-2" / "remove the dependency between A and B" ----
  if (issueKeys.length >= 2 && (/\b(blockiert|blocks|blocking|abhaengigkeit|dependency|verknuepf|link)/.test(q))) {
    const [a, b] = issueKeys;
    const blockedBy = /\b(wird von|is blocked by|haengt ab von|depends on|wartet auf|waits for)\b/.test(q);
    const pre = blockedBy ? b : a, dep = blockedBy ? a : b;
    if (/\b(entfern|loesch|loese|remove|delete|unlink|aufheben|trenne)/.test(q)) return cmd('deps.unlink', { pre, dep }, T(L, `${pre} blockiert ${dep} nicht mehr`, `${pre} no longer blocks ${dep}`));
    return cmd('deps.link', { pre, dep }, T(L, `${pre} blockiert ${dep}`, `${pre} blocks ${dep}`), imperative ? 'high' : 'medium');
  }

  // ---- support tickets: "weise SUP-401 Team Web zu" ----
  if (ticketKeys.length && /\b(weis|weise|zuweis|zuweisen|assign|gib|give|an|to)\b/.test(q) && (teams.any || person)) {
    const t = teams.target || teams.any;
    return cmd('dispatch.assign', { items: ticketKeys.map((k) => ({ ticket: k, ...(t ? { teamId: t.id } : {}), ...(person ? { accountId: person.id } : {}) })) },
      T(L, `${ticketKeys.join(', ')} → ${[t?.name, person?.name].filter(Boolean).join(' · ')}`, `${ticketKeys.join(', ')} → ${[t?.name, person?.name].filter(Boolean).join(' · ')}`));
  }

  // ---- support reserve: "reserviere 12 h Support für Team Web" ----
  if (/\b(reserve|reservier|reserviere|support-?reserve)\b/.test(q) && teams.any) {
    const h = hoursOf(q);
    const auto = /\b(automatisch|automatic|auto)\b/.test(q);
    if (h == null && !auto) return decide(T(L, `Wie viele Stunden je Woche soll Team ${teams.any.name} für Support reservieren?`, `How many hours per week should team ${teams.any.name} reserve for support?`),
      [{ id: 'auto', label: T(L, 'Automatisch (gemessener Durchschnitt)', 'Automatic (measured average)'), value: { command: 'support.reserve', params: { teamId: teams.any.id, hours: null } } }],
      { freeText: { placeholder: T(L, 'z. B. 12 h', 'e.g. 12 h'), kind: 'hours', command: 'support.reserve', params: { teamId: teams.any.id }, path: 'hours' }, reason: 'noValue' });
    return cmd('support.reserve', { teamId: teams.any.id, hours: auto ? null : h }, T(L, `Support-Reserve Team ${teams.any.name}`, `Support reserve team ${teams.any.name}`));
  }

  // ---- booking own time: "buche 2 h auf KPR-118 (heute|gestern|am 10.11.)" ----
  if (/^(bitte |please )?(buche|buch|book|log|erfasse)\b/.test(q) && hoursOf(q) != null) {
    const target = issueKeys[0] || ticketKeys[0];
    let d = today;
    const dm = /\b(\d{4}-\d{2}-\d{2})\b/.exec(raw) || /(?:^|\s)(\d{1,2})\.(\d{1,2})\.?/.exec(raw);
    if (/\b(gestern|yesterday)\b/.test(q)) d = today - 1;
    else if (/\b(vorgestern)\b/.test(q)) d = today - 2;
    else if (dm) { const x = dm[1].includes('-') ? dayIdx(dm[1]) : dayIdx(`${ds.today.slice(0, 4)}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`); if (x != null) d = x > today ? x - 365 : x; }
    else { const wds = [['montag', 'monday'], ['dienstag', 'tuesday'], ['mittwoch', 'wednesday'], ['donnerstag', 'thursday'], ['freitag', 'friday']]; const k = wds.findIndex((w) => w.some((n) => new RegExp(`\\b${n}\\b`).test(q))); if (k >= 0) { d = mondayOf(today) + k; if (d > today) d -= 7; } }
    const params = { items: [{ issue: target, date: isoOf(d), hours: hoursOf(q) }] };
    if (!target) {
      const mineOpen = (ds.issues || []).filter((i) => i.role === 'estimate' && i.assignee?.id === meId(ctx) && i.status?.cat === 'indeterminate').slice(0, 4);
      return decide(T(L, `Auf welchen Vorgang soll Lotse ${F.h(params.items[0].hours, 2)} buchen?`, `Which work item should Lotse log ${F.h(params.items[0].hours, 2)} on?`), mineOpen.map((i) => ({ id: i.id, label: `${i.key} · ${i.summary}`, value: { command: 'booking.book', params: { items: [{ ...params.items[0], issue: i.id }] } } })), { reason: 'noTarget' });
    }
    return cmd('booking.book', params, T(L, `${F.h(params.items[0].hours, 2)} auf ${target}`, `${F.h(params.items[0].hours, 2)} on ${target}`));
  }

  // ---- capacity: "Jonas arbeitet ab jetzt 32 h pro Woche" / "Lea ist vom 1.12. bis 5.12. im Urlaub" ----
  const absence = /\b(urlaub|vacation|holiday|abwesend|away|absent|schulung|training)\b/.test(q);
  if ((person || amb) && !keys.length && (absence || (hoursOf(q) != null && /\b(pro|je|per|a|in der) (woche|week)\b|wochenstunden|weekly hours|hours a week|stunden die woche/.test(q)))) {
    if (amb && !person) return ambDecide((id) => ({ command: 'capacity.setHours', params: { person: id, weeklyHours: hoursOf(q) } }));
    if (absence) {
      const ds2 = [...raw.matchAll(/(\d{4}-\d{2}-\d{2})|(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/g)].map((m) => (m[1] ? m[1] : isoOf(parseDay(`${m[2]}.${m[3]}.${m[4] || ''}`, today) ?? today)));
      if (ds2.length < 2) return decide(T(L, `Von wann bis wann ist ${person.name} abwesend?`, `From when to when is ${person.name} away?`), [], { freeText: { placeholder: T(L, 'z. B. 01.12. bis 05.12.', 'e.g. 2026-12-01 to 2026-12-05'), kind: 'dateRange', command: 'capacity.setHours', params: { person: person.id }, path: 'absence' }, reason: 'noValue' });
      const type = /\b(schulung|training)\b/.test(q) ? 'training' : /\b(urlaub|vacation|holiday)\b/.test(q) ? 'vacation' : 'absent';
      return cmd('capacity.setHours', { person: person.id, absence: { from: ds2[0], to: ds2[1], type } }, T(L, `Abwesenheit ${person.name}`, `Absence ${person.name}`));
    }
    return cmd('capacity.setHours', { person: person.id, weeklyHours: hoursOf(q) }, T(L, `Wochenstunden ${person.name}`, `Weekly hours ${person.name}`));
  }

  // ---- navigation: "öffne die Wochenplanung" ----
  if (/^(bitte |please )?(oeffne|geh zu|gehe zu|open|go to|show me the|zeig mir die ansicht)\b/.test(q)) {
    const V = [['plan', /wochenplanung|weekly plan|planung|planning board/], ['support', /support|tickets/], ['report', /report|bericht/], ['mine', /meine arbeit|my work|buchungen|bookings/], ['capacity', /kapazitaet|capacit/], ['time', /plan vs|ist-?stunden|actual/], ['team', /\bteams?\b/], ['portfolio', /portfolio|ranking|rangfolge/]];
    const v = V.find(([, re]) => re.test(q));
    if (project && (!v || v[0] === 'portfolio')) return cmd('navigate', { view: 'project', opts: { ref: project.ref } }, project.name);
    if (v) return cmd('navigate', { view: v[0], ...(v[0] === 'team' && teams.any ? { opts: { team: teams.any.id } } : {}) }, v[0]);
    return null;
  }

  // ---- ranking: "setze Datenplattform auf Rang 1" / "move ERP-Anbindung to the top" ----
  if (project && /\b(rang|rank|platz|prioritaet|priority|ganz oben|to the top|nach vorne|ans ende|to the bottom|ganz nach hinten)\b/.test(qn) && !/\bhealth\b/.test(q)) {
    const n = model.items.length;
    const m = /(?:rang|rank|platz|position|#)\s*#?(\d{1,3})\b/.exec(qn);
    const to = m ? +m[1] : /ganz oben|to the top|nach vorne|first|top priority|hoechste prioritaet/.test(qn) ? 1 : /ans ende|to the bottom|ganz nach hinten|last/.test(qn) ? n : null;
    if (to == null) return decide(T(L, `Auf welchen Rang soll ${project.name}?`, `Which rank should ${project.name} get?`), [1, Math.ceil(n / 2), n].filter((x, i, a) => a.indexOf(x) === i && x !== project.rank).map((r) => ({ id: `rank:${r}`, label: T(L, `Rang ${r}`, `Rank ${r}`), value: { command: 'rank.set', params: { ref: project.ref, toRank: r } } })), { reason: 'noValue' });
    return cmd('rank.set', { ref: project.ref, toRank: Math.max(1, Math.min(n, to)) }, T(L, `${project.name} auf Rang ${to}`, `${project.name} to rank ${to}`));
  }

  // ---- health: "setze Health aller meiner Projekte auf im Plan mit Kommentar …" ----
  const hs = healthOf(q);
  if (/\b(health|ampel|status)\b/.test(q) && !/\b(draft|entwurf|entwirf|entwerfen|vorschlag|suggest)/.test(q) && (hs || /^(bitte |please )?(setz|setze|set|update|aktualisier|aktualisiere|markier|markiere|mark|stell|stelle|change|aender|aendere)\b/.test(q))) {
    const cm = /(?:mit (?:dem )?kommentar|with (?:the )?comment|kommentar|comment)\s*:?\s*(.+)$/i.exec(raw);
    const comment = cm ? cm[1].trim().replace(/^["„“'»«]+|["„“'»«.]+$/g, '').trim() : '';
    const all = /\b(aller|alle|all|saemtliche[rn]?|every)\b.*\bprojekte?\b|\ball (the )?projects\b/.test(q);
    const refs = project ? [project.ref] : mine ? model.items.filter((it) => ownsProject(ctx, it.ref)).map((it) => it.ref) : all ? model.items.map((it) => it.ref) : [];
    const items = (s, cmt) => refs.map((ref) => ({ ref, status: s, comment: cmt }));
    if (!refs.length) return decide(T(L, 'Für welche Projekte soll Lotse die Health setzen?', 'Which projects should Lotse set the health for?'), [
      ...(model.items.some((it) => ownsProject(ctx, it.ref)) ? [{ id: 'mine', label: T(L, 'Meine Projekte', 'My projects'), value: hs && comment ? { command: 'health.set', params: { items: model.items.filter((it) => ownsProject(ctx, it.ref)).map((it) => ({ ref: it.ref, status: hs, comment })) } } : { workflow: 'healthRound' } }] : []),
      { id: 'round', label: T(L, 'Health-Runde mit Entwürfen starten', 'Start a health round with drafts'), recommended: true, value: { workflow: 'healthRound' } },
    ], { reason: 'noScope' });
    if (!hs) return decide(T(L, 'Welcher Status?', 'Which status?'), ['onTrack', 'atRisk', 'critical'].map((s) => ({ id: s, label: healthName(s, L), value: comment ? { command: 'health.set', params: { items: items(s, comment) } } : null })).map((o) => (o.value ? o : { ...o, value: { workflow: 'healthRound' } })), { reason: 'noValue' });
    if (!comment) return decide(T(L, `Welcher Kommentar zu „${healthName(hs, L)}“? (1–280 Zeichen)`, `Which comment for "${healthName(hs, L)}"? (1–280 characters)`), [], { freeText: { placeholder: T(L, 'Ein Satz, was die Lage erklärt', 'One sentence that explains the state'), kind: 'text', command: 'health.set', params: { items: items(hs, '') }, path: 'comment' }, reason: 'noValue' });
    return cmd('health.set', { items: items(hs, comment.slice(0, 280)) }, T(L, `Health ${healthName(hs, L)} für ${refs.length} ${plural(refs.length, 'Projekt', 'Projekte')}`, `Health ${healthName(hs, L)} for ${refs.length} ${plural(refs.length, 'project', 'projects')}`));
  }

  // ---- moving work: "verschiebe alles von Anna in KW 48 eine Woche später" ----
  const isMove = /\b(verschieb|verschiebe|schieb|schiebe|move|shift|postpone|vorziehen|zieh|ziehe)\b/.test(q) || (/\b(push|pull|spaeter|later|frueher|earlier)\b/.test(q) && weeksOf(q) != null);
  const assignTo = /\b(an|to|auf|zu)\s+(?:[a-z]+\s+)?$/;
  if (isMove) {
    const w = weeksOf(q);
    const later = /\b(spaeter|later|nach hinten|back|postpone|zurueck)\b/.test(q), earlier = /\b(frueher|earlier|vorziehen|nach vorne|forward|ziehe? .* vor|pull)\b/.test(q);
    const f = filterBase();
    if (person && !mine) { const px = ps.find((x) => x.p === person); const before = qn.slice(Math.max(0, px.at - 8), px.at + 1); if (!assignTo.test(before)) f.assignee = person.id; }
    if (mine) f.assignee = 'me';
    if (teams.filter || (teams.any && !teams.target)) f.team = (teams.filter || teams.any).id;
    const toPerson = person && ps.find((x) => x.p === person) && assignTo.test(qn.slice(Math.max(0, ps.find((x) => x.p === person).at - 8), ps.find((x) => x.p === person).at + 1)) ? person : null;
    const scope = issueKeys.length ? { moves: issueKeys.map((k) => ({ issue: k })) } : null;
    const hasScope = !!(scope || f.assignee || f.team || f.project || f.week || f.status || f.overdue);
    if (amb && !person) return ambDecide((id) => ({ command: 'plan.move', params: { filter: { ...f, assignee: id }, weeks: (w || 1) * (earlier ? -1 : 1) } }));
    const base = (o) => (scope ? { moves: scope.moves.map((m) => ({ ...m, ...o })) } : { filter: f, ...o });
    if (toPerson && !w) {
      if (!hasScope) return decide(T(L, `Welche Vorgänge soll ${toPerson.name} übernehmen?`, `Which work items should ${toPerson.name} take over?`), [], { reason: 'noScope' });
      return cmd('plan.move', base({ assignee: toPerson.id }), T(L, `${scope ? issueKeys.join(', ') : describeFilter(ctx, f)} → ${toPerson.name}`, `${scope ? issueKeys.join(', ') : describeFilter(ctx, f)} → ${toPerson.name}`));
    }
    if (!hasScope) return decide(T(L, 'Welche Vorgänge soll Lotse verschieben?', 'Which work items should Lotse move?'), [
      { id: 'mine', label: T(L, 'Meine offenen Stories', 'My open stories'), value: { command: 'plan.move', params: { filter: { level: 'story', assignee: 'me' }, weeks: (w || 1) * (earlier ? -1 : 1) } } },
      { id: 'week', label: T(L, 'Alles in dieser Woche', 'Everything this week'), value: { command: 'plan.move', params: { filter: { level: 'story', week: weekKeyOf(today) }, weeks: (w || 1) * (earlier ? -1 : 1) } } },
    ], { reason: 'noScope' });
    if (!later && !earlier) {
      const n = w || 1;
      return decide(T(L, `${n} ${plural(n, 'Woche', 'Wochen')} später oder früher?`, `${n} ${plural(n, 'week', 'weeks')} later or earlier?`), [
        { id: 'later', label: T(L, `${n} ${plural(n, 'Woche', 'Wochen')} später`, `${n} ${plural(n, 'week', 'weeks')} later`), recommended: true, value: { command: 'plan.move', params: base({ weeks: n }) } },
        { id: 'earlier', label: T(L, `${n} ${plural(n, 'Woche', 'Wochen')} früher`, `${n} ${plural(n, 'week', 'weeks')} earlier`), value: { command: 'plan.move', params: base({ weeks: -n }) } },
      ], { reason: 'noDirection' });
    }
    const n = (w || 1) * (earlier ? -1 : 1);
    return cmd('plan.move', base({ weeks: n }), T(L, `${scope ? issueKeys.join(', ') : describeFilter(ctx, f)}: ${Math.abs(n)} ${plural(Math.abs(n), 'Woche', 'Wochen')} ${n > 0 ? 'später' : 'früher'}`, `${scope ? issueKeys.join(', ') : describeFilter(ctx, f)}: ${Math.abs(n)} ${plural(Math.abs(n), 'week', 'weeks')} ${n > 0 ? 'later' : 'earlier'}`));
  }

  // ---- setting a field (one work item or many) ----
  const mm = MISSING_RE.exec(qn);
  const missing = mm ? Object.keys(FIELD_RE).find((k) => FIELD_RE[k].test(mm[2])) : null;
  const rest = mm ? qn.replace(mm[0], ' ') : qn;
  let field = ['estimate', 'tshirt', 'quarters', 'due', 'start', 'assignee'].find((k) => FIELD_RE[k].test(rest)) || null;
  if (!field && teams.target && /\bteams?\b/.test(rest)) field = 'team';
  if (!field && /\b(weise|weis|assign|zuweisen)\b/.test(q) && person) field = 'assignee';
  if (!field && missing && (imperative || /\b(auf|to)\b/.test(q))) field = missing;
  if (!field && /\b(gib|give)\b/.test(q) && teams.target) field = 'team';
  if (!field && /\bq[1-4]\s*\/?\s*20\d\d\b/.test(q) && /\b(quartal|quarter)/.test(q)) field = 'quarters';
  // the short form of the search bar (E2E 2026-11-20 – it worked before the search handed over to Lotse):
  // "Fälligkeit PCX-11 in 3 Wochen", "Due date PCX-11 15.12.", "Schätzung PCX-11 8 h" – field first, a named work item,
  // a value; never a question
  const terse = !!field && issueKeys.length > 0 && FIELD_RE[field]?.test(qn.split(/\s+/).slice(0, 2).join(' ')) && !/\?\s*$/.test(q);
  if (!field || !(imperative || missing || terse)) return null;
  // the value
  let value = null;
  const meta = FIELDS[field];
  if (meta.kind === 'hours') value = hoursOf(rest) ?? hoursOf(q);
  else if (meta.kind === 'team') value = (teams.target || (!teams.filter ? teams.any : null))?.id || null;
  else if (meta.kind === 'person') { const tp = ps.find((x) => x.p && assignTo.test(qn.slice(Math.max(0, x.at - 8), x.at + 1))) || ps.find((x) => x.p); value = tp?.p?.id || null; }
  else if (meta.kind === 'date') { const d = parseDay(q.replace(/\b(kw|week|woche)\s*\d{1,2}\b/g, ' '), today); value = d == null ? null : isoOf(d); }
  else if (meta.kind === 'tshirt') { const m = /(?:t-?shirt(?:-?groessen?)?|groessen?|sizes?)\s*(?:auf|to|=|von|of)?\s*(xxs|xs|s|m|l|xl|xxl)\b/.exec(q) || /\b(xxs|xs|s|m|l|xl|xxl)\b\s*(?:fuer|for|als|as)/.exec(q) || /\b(?:auf|to)\s+(xxs|xs|s|m|l|xl|xxl)\b/.exec(q); value = m ? m[1].toUpperCase() : null; }
  else if (meta.kind === 'quarters') { const qs = [...q.matchAll(/\bq([1-4])\s*\/?\s*(20\d\d)\b|\b(20\d\d)-?q([1-4])\b/g)].map((m) => (m[1] ? `${m[2]}-Q${m[1]}` : `${m[3]}-Q${m[4]}`)); value = qs.length ? qs : null; }
  if (terse && !imperative && !missing && value == null) return null; // "Fälligkeit PCX-11" alone is a question for the briefing
  // A named scope ("… in Atlantis") that is no known project, team, person or week: ask which project instead of widening
  // to the whole portfolio (live E2E 2026-11-23: "Team Web für alle Stories ohne Team in Atlantis" offered all 22 stories
  // without a team, in every project). Read from the person's own words, so the question quotes their spelling.
  if (!issueKeys.length && !project) {
    const sm = /(?:^|\s)(?:in|im|bei)\s+(?:(?:dem\s+)?projekt\s+|project\s+)?([\p{L}\p{N}][\p{L}\p{N}\s_.&-]{1,60})$/iu.exec(String(raw || text).replace(/[?!.]+$/, '').trim());
    const phrase = sm ? sm[1].trim() : null;
    const pf = phrase ? prep(phrase).qn : '';
    const known = !phrase || !!findProject(pf, model) || !!teamsOf(pf, model, null).any || people(ctx, pf).some((x) => x.p)
      || /\b(kw|week|woche|wochen|weeks|q[1-4]|20\d\d|monat|month|jahr|year|tagen?|days?)\b|\d/.test(pf);
    if (!known) {
      const opts = [...model.items].sort((a, b) => a.rank - b.rank).slice(0, 6).map((p) => ({ id: p.ref, label: p.name, value: { command: 'issue.bulkFill', params: { field, ...(value != null ? { value } : {}), filter: { ...filterBase(), ...(missing ? { missing } : {}), project: p.ref } } } }));
      return decide(T(L, `Kein Projekt „${phrase}“ gefunden – nichts wird geändert. Welches Projekt meinst du?`, `No project "${phrase}" found – nothing will change. Which project do you mean?`), opts, { reason: 'unknownScope' });
    }
  }
  // the scope: named work items, or a filter
  const f = filterBase();
  if (missing) f.missing = missing;
  if (field === 'team') { if (teams.filter) f.team = teams.filter.id; } else if (teams.filter || teams.any) f.team = (teams.filter || teams.any).id;
  if (field !== 'assignee') { if (mine) f.assignee = 'me'; else if (person) f.assignee = person.id; } else if (mine) f.assignee = 'me';
  if (/\b(ohne bearbeiter|unassigned|nicht zugewiesen|without (an )?assignee)\b/.test(q)) f.assignee = '_none';
  const scoped = issueKeys.length > 0 || !!(f.project || f.team || f.assignee || f.week || f.missing || f.status || f.overdue);
  const fn = fieldName(field, L);
  if (amb && !person && field !== 'assignee') return ambDecide((id) => ({ command: 'issue.bulkFill', params: { field, value, filter: { ...f, assignee: id } } }));
  if (value == null) {
    const params = issueKeys.length === 1 ? { issue: issueKeys[0], field } : issueKeys.length ? { field, items: issueKeys.map((k) => ({ issue: k })) } : { field, filter: f };
    const command = issueKeys.length === 1 ? 'issue.setField' : 'issue.bulkFill';
    const opts = meta.kind === 'team' ? [...model.teams.values()].filter((t) => t.id !== '_none').slice(0, 6).map((t) => ({ id: t.id, label: t.name, value: { command, params: { ...params, value: t.id } } })) : [];
    return decide(T(L, `Welchen Wert soll ${fn} bekommen?`, `Which value should the ${fn.toLowerCase()} get?`), opts, { freeText: meta.kind === 'team' ? undefined : { placeholder: { hours: T(L, 'z. B. 8 h', 'e.g. 8 h'), date: T(L, 'z. B. 15.12.', 'e.g. 2026-12-15'), tshirt: 'S, M, L, XL', quarters: 'Q1 2027', person: T(L, 'Name', 'name') }[meta.kind], kind: meta.kind, command, params, path: 'value' }, reason: 'noValue' });
  }
  if (issueKeys.length === 1) return cmd('issue.setField', { issue: issueKeys[0], field, value }, T(L, `${issueKeys[0]}: ${fn} → ${valueText(ctx, field, value)}`, `${issueKeys[0]}: ${fn} → ${valueText(ctx, field, value)}`));
  if (issueKeys.length > 1) return cmd('issue.bulkFill', { field, items: issueKeys.map((k) => ({ issue: k, value })) }, T(L, `${issueKeys.length} Vorgänge: ${fn} → ${valueText(ctx, field, value)}`, `${issueKeys.length} work items: ${fn} → ${valueText(ctx, field, value)}`));
  if (!scoped) {
    // never guess the scope of a write: offer the projects with the most matching work items
    // one selection over all work items, counted per project (the same numbers as one selection per project)
    const sel = selectIssues(ctx, { level, missing: field });
    const per = new Map();
    for (const i of sel) per.set(i.rootRef, (per.get(i.rootRef) || 0) + 1);
    const counts = model.items.map((it) => ({ it, n: per.get(it.ref) || 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
    const total = sel.length;
    return decide(T(L, `Für welche Vorgänge soll ${fn} ${valueText(ctx, field, value)} werden?`, `Which work items should get ${fn.toLowerCase()} ${valueText(ctx, field, value)}?`), [
      ...counts.map(({ it, n }) => ({ id: `project:${it.ref}`, label: T(L, `Ohne ${fn} in ${it.name}`, `Without ${fn.toLowerCase()} in ${it.name}`), detail: T(L, `${n} ${plural(n, 'Vorgang', 'Vorgänge')}`, `${n} work ${plural(n, 'item', 'items')}`), facts: [{ label: 'n', value: n }], value: { command: 'issue.bulkFill', params: { field, value, filter: { level, project: it.ref, missing: field } } } })),
      ...(total ? [{ id: 'all', label: T(L, `Alle ohne ${fn} im Portfolio`, `Everything without ${fn.toLowerCase()} in the portfolio`), detail: T(L, `${total} ${plural(total, 'Vorgang', 'Vorgänge')}`, `${total} work ${plural(total, 'item', 'items')}`), facts: [{ label: 'n', value: total }], value: { command: 'issue.bulkFill', params: { field, value, filter: { level, missing: field } } } }] : []),
    ], { reason: 'noScope' });
  }
  return cmd('issue.bulkFill', { field, value, filter: f }, T(L, `${describeFilter(ctx, f)}: ${fn} → ${valueText(ctx, field, value)}`, `${describeFilter(ctx, f)}: ${fn} → ${valueText(ctx, field, value)}`), imperative ? 'high' : 'medium');
}

// The answer to a decide → the command it stands for (free text parsed by the kind).
export function resolveDecide(d, answer, ctx) {
  if (!d || d.kind !== 'decide') return null;
  if (typeof answer === 'string') return d.options.find((o) => o.id === answer)?.value || null;
  const ft = d.freeText;
  if (!ft || !answer || typeof answer.text !== 'string') return null;
  const text = answer.text.trim();
  let v = text;
  const today = dayIdx(dsOf(ctx).today);
  if (ft.kind === 'hours') { const m = /(\d+(?:[.,]\d+)?)/.exec(text); v = m ? +m[1].replace(',', '.') : null; }
  else if (ft.kind === 'date') { const x = parseDay(fold(text), today); v = x == null ? null : isoOf(x); }
  else if (ft.kind === 'tshirt') v = text.toUpperCase();
  else if (ft.kind === 'quarters') v = [...fold(text).matchAll(/q([1-4])\s*\/?\s*(20\d\d)/g)].map((m) => `${m[2]}-Q${m[1]}`);
  else if (ft.kind === 'dateRange') { const ds2 = [...text.matchAll(/(\d{4}-\d{2}-\d{2})|(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/g)].map((m) => (m[1] ? m[1] : isoOf(parseDay(`${m[2]}.${m[3]}.${m[4] || ''}`, today) ?? today))); v = ds2.length >= 2 ? { from: ds2[0], to: ds2[1], type: 'absent' } : null; }
  if (v == null || (typeof v === 'string' && !v)) return null;
  const params = JSON.parse(JSON.stringify(ft.params));
  if (ft.path === 'comment' && Array.isArray(params.items)) params.items = params.items.map((x) => ({ ...x, comment: String(v).slice(0, 280) }));
  else if (ft.path === 'value' && Array.isArray(params.items)) params.items = params.items.map((x) => ({ ...x, value: v }));
  else params[ft.path] = v;
  return { command: ft.command, params };
}
export const isWriteCommand = (id) => !!COMMANDS[id]?.write;
export { describeFilter, projectLabel, teamLabel, personLabel, can };
