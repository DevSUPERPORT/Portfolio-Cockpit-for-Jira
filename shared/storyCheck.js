// Planungs-Check on the Jira work item (management request 2026-11-10): for one story, in plain sentences –
// does the assignee belong to the story's team, how its remaining time is spread, how loaded the assignee is,
// and which dates conflict (dependencies, project end, milestone, waterline). Pure and deterministic: the same
// engine numbers as the cockpit (computeAll), so the panel and the cockpit can never disagree.
import { dayIdx, workdays, mondayOf, quarterKeyOf, quarterRange, ymdIdx, dow } from './dates.js';
import { capacityPeople, spreadWindow, shareIn, teamSettings, projectShare } from './engine.js';
import { personWeek } from './team.js';
import { utilTone } from './kpis.js';
import { allocationOf, shareOf, inTeam } from './allocation.js';
import { atlIndex } from './atlTeams.js';
import { memberStatus } from './teamMembership.js';

const RANK = { ok: 0, info: 1, warn: 2, bad: 3 };
const worst = (list) => list.reduce((w, x) => (RANK[x?.tone] > RANK[w] ? x.tone : w), 'ok');
const isOpen = (i) => (i?.status?.cat ?? i?.statusCat) !== 'done';

export function isoWeek(idx) {
  const thu = idx + 3 - ((dow(idx) + 6) % 7);
  const y = new Date(thu * 86400000).getUTCFullYear();
  return 1 + Math.floor((thu - ymdIdx(y, 1, 1)) / 7);
}

function texts(lang) {
  const de = lang !== 'en';
  const L = (d, e) => (de ? d : e);
  const nf = new Intl.NumberFormat(de ? 'de-DE' : 'en-GB', { maximumFractionDigits: 1 });
  const h = (v) => `${nf.format(Math.round((+v || 0) * 10) / 10)} h`;
  const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)} %` : '∞');
  const df = new Intl.DateTimeFormat(de ? 'de-DE' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
  const date = (v) => { const i = typeof v === 'number' ? v : dayIdx(v); return i == null ? '–' : df.format(new Date(i * 86400000)); };
  const q = (k) => `Q${k.slice(-1)} ${k.slice(0, 4)}`;
  const wk = (idx) => L(`KW ${isoWeek(idx)}`, `W${isoWeek(idx)}`);
  return { de, L, h, pct, date, q, wk };
}

const FIELD = {
  team: ['Team', 'Team'], assignee: ['Bearbeiter', 'Assignee'], originalEstimate: ['Original Estimate', 'Original estimate'],
  startDate: ['Start Date', 'Start date'], dueDate: ['Due Date', 'Due date'], milestone: ['Meilenstein', 'Milestone'], parent: ['Übergeordneter Vorgang', 'Parent'],
  tshirt: ['T-Shirt Size', 'T-shirt size'], targetQuarters: ['Zielquartale', 'Target quarters'], owner: ['Owner', 'Owner'],
};

/**
 * @param computed computeAll(ds)
 * @param issueId  Jira issue id (string) of the work item the panel sits on
 * @param opts     { lang: 'de' | 'en', maxWeeks }
 */
export function storyCheck(computed, issueId, opts = {}) {
  const { model, deps, dq, wl } = computed;
  const T = texts(opts.lang);
  const { L, h, pct, date } = T;
  const id = String(issueId);
  const personLevel = model.ds.personLevel !== false;
  const nameOf = (u) => (u ? model.ds.people?.[u.id]?.name || u.name || L('Unbekannt', 'Unknown') : null);
  const teamName = (tid) => (tid ? model.teams.get(tid)?.name || tid : null);

  // the portfolio item itself (e.g. an epic/project): a summary of its stories
  const item = model.itemByRef.get(`issue:${id}`);
  let iss = model.byId.get(id);
  if (!iss && !item) {
    return { known: false, text: L('Dieser Vorgang gehört zu keinem Projekt im Portfolio Cockpit – hier gibt es nichts zu prüfen.', 'This work item is not part of any project in the Portfolio Cockpit – nothing to check here.') };
  }
  if (item && (!iss || iss.role === 'portfolio')) return projectSummary(computed, item, T, personLevel);
  // a sub-task is planned through its story
  let viaParent = null;
  if (iss.role === 'tiny' && iss.parentId && model.byId.get(iss.parentId)?.role === 'estimate') { viaParent = iss; iss = model.byId.get(iss.parentId); }
  if (iss.role !== 'estimate') return groupSummary(computed, iss, T, personLevel);

  const project = model.itemByRef.get(iss.rootRef) || null;
  const today = model.today;
  const open = isOpen(iss);
  const people = capacityPeople(model);
  const aId = iss.assignee?.id || null;
  const tId = iss.team?.id || null;
  const capP = aId ? people.get(aId) : null;
  const aName = nameOf(iss.assignee);

  // ---------- team & assignee ----------
  const team = { rows: [], notes: [] };
  team.rows.push([L('Team der Story', 'Story team'), teamName(tId) || '–']);
  team.rows.push([L('Bearbeiter', 'Assignee'), personLevel ? aName || '–' : L('ausgeblendet', 'hidden')]);
  // Atlassian Teams decide membership where the cockpit can read them (shared/teamMembership.js)
  const atl = atlIndex(model.ds);
  const byAtl = !!(tId && atl?.judged(tId));
  const assigneeCheck = tId && aId && !iss.assignee?.anon ? { status: memberStatus(model, aId, tId, people), source: byAtl ? 'atlassian' : 'cockpit', team: teamName(tId), name: personLevel || byAtl ? aName : null } : null;
  if (byAtl) {
    const names = [...atl.byTeam.get(tId)].map((pid) => model.ds.people?.[pid]?.name || atl.names.get(pid)).filter(Boolean).sort((a, b) => a.localeCompare(b, 'de'));
    team.rows.push([L(`Mitglieder von ${teamName(tId)} (Atlassian Teams)`, `Members of ${teamName(tId)} (Atlassian Teams)`), names.length ? names.join(', ') : L('keine', 'none')]);
    if (!aId) team.notes.push({ tone: 'info', text: L('Niemand zugewiesen – die Stunden zählen beim Team, aber bei keiner Person.', 'Nobody assigned – the hours count for the team, but for no person.') });
    else if (assigneeCheck?.status === 'outside') {
      team.notes.push({ tone: 'warn', key: 'teamMismatch', text: L(
        `${aName} ist laut Atlassian Teams kein Mitglied von ${teamName(tId)}. Die Stunden zählen als Bedarf bei ${teamName(tId)}, belasten aber die Zeit von ${aName}, die in den eigenen Teams eingeplant ist.`,
        `According to Atlassian Teams, ${aName} is not a member of ${teamName(tId)}. The hours count as demand for ${teamName(tId)} but use ${aName}'s time, which is planned in their own teams.`) });
      team.notes.push({ tone: 'info', text: L(
        `Lösung: ${aName} in Atlassian Teams zu ${teamName(tId)} hinzufügen, jemanden aus ${teamName(tId)} zuweisen${names.length ? ` (${names.slice(0, 4).join(', ')}${names.length > 4 ? ' …' : ''})` : ''} oder das Team der Story ändern.`,
        `Fix: add ${aName} to ${teamName(tId)} in Atlassian Teams, assign someone from ${teamName(tId)}${names.length ? ` (${names.slice(0, 4).join(', ')}${names.length > 4 ? ' …' : ''})` : ''}, or change the story's team.`) });
    } else if (assigneeCheck?.status === 'member') team.notes.push({ tone: 'ok', text: L(`${aName} ist Mitglied von ${teamName(tId)} (Atlassian Teams).`, `${aName} is a member of ${teamName(tId)} (Atlassian Teams).`) });
  }
  // everyone with a share in the story's team (UC-14), "(60 %)" when they work there only part of their time
  const members = tId && !byAtl ? [...people.values()].filter((p) => !p.derived && inTeam(p, tId)).map((p) => {
    const n = model.ds.people?.[p.id]?.name;
    const sh = Math.round(shareOf(p, tId) * 100);
    return n ? (sh < 100 ? `${n} (${sh} %)` : n) : null;
  }).filter(Boolean) : [];
  if (!tId) team.notes.push({ tone: 'bad', text: L('Kein Team gesetzt – die Stunden fehlen in jeder Teamplanung (Kapazität, Wasserlinie).', 'No team set – the hours are missing from every team plan (capacity, waterline).') });
  if (!aId && !byAtl) team.notes.push({ tone: 'info', text: L('Niemand zugewiesen – die Stunden zählen beim Team, aber bei keiner Person.', 'Nobody assigned – the hours count for the team, but for no person.') });
  if (aId && personLevel && !byAtl) {
    const capTeam = capP?.teamId || null;
    const split = capP && !capP.derived ? allocationOf(capP) : [];
    team.rows.push([L('Bearbeiter eingeplant im Team', 'Assignee planned in team'), split.length > 1
      ? split.map((x) => `${teamName(x.teamId)} (${Math.round(x.pct)} %)`).join(', ')
      : capTeam ? `${teamName(capTeam)}${capP.derived ? L(' (abgeleitet)', ' (derived)') : ''}` : '–']);
    if (!capP || capP.derived) {
      team.notes.push({ tone: 'warn', text: L(`Für ${aName} ist im Cockpit keine Kapazität gepflegt. Gerechnet wird mit ${h(capP?.weeklyHours ?? model.ds.capacity?.defaultWeeklyHours ?? 40)} je Woche${capTeam ? ` im Team ${teamName(capTeam)} (dort hat ${aName} die meisten offenen Stunden)` : ''}. Pflegen unter Kapazität › Kapazitäten bearbeiten.`, `No capacity is maintained for ${aName} in the cockpit. It assumes ${h(capP?.weeklyHours ?? model.ds.capacity?.defaultWeeklyHours ?? 40)} per week${capTeam ? ` in team ${teamName(capTeam)} (where ${aName} has the most open hours)` : ''}. Maintain it under Capacity › Edit capacities.`) });
    }
    const there = capP && !capP.derived ? inTeam(capP, tId) : capTeam === tId;
    if (tId && capTeam && !there) {
      team.notes.push({ tone: 'warn', key: 'teamMismatch', text: L(
        `${aName} gehört laut Kapazitätsplanung zum Team ${teamName(capTeam)}, nicht zu ${teamName(tId)}. Die Stunden zählen als Bedarf bei ${teamName(tId)}, belasten aber die Zeit von ${aName}, die bei ${teamName(capTeam)} eingeplant ist – eine der beiden Planungen stimmt so nicht.`,
        `According to capacity planning ${aName} belongs to team ${teamName(capTeam)}, not ${teamName(tId)}. The hours count as demand for ${teamName(tId)} but use ${aName}'s time, which is planned in ${teamName(capTeam)} – one of the two plans is off.`) });
      team.notes.push({ tone: 'info', text: L(
        `Lösung: Team auf ${teamName(capTeam)} ändern, jemanden aus ${teamName(tId)} zuweisen${members.length ? ` (${members.slice(0, 4).join(', ')}${members.length > 4 ? ' …' : ''})` : ''} oder ${aName} unter Kapazität › Kapazitäten bearbeiten dem Team ${teamName(tId)} zuordnen.`,
        `Fix: change the team to ${teamName(capTeam)}, assign someone from ${teamName(tId)}${members.length ? ` (${members.slice(0, 4).join(', ')}${members.length > 4 ? ' …' : ''})` : ''}, or move ${aName} to team ${teamName(tId)} under Capacity › Edit capacities.`) });
    } else if (tId && there && capP && !capP.derived) {
      const sh = Math.round(shareOf(capP, tId) * 100);
      team.notes.push({ tone: 'ok', text: sh < 100
        ? L(`${aName} gehört zu ${sh} % zum Team ${teamName(tId)}.`, `${aName} belongs to team ${teamName(tId)} with ${sh} %.`)
        : L(`${aName} gehört zum Team ${teamName(tId)}.`, `${aName} belongs to team ${teamName(tId)}.`) });
    }
  }
  if (tId && !byAtl) team.rows.push([L(`Personen im Team ${teamName(tId)}`, `People in team ${teamName(tId)}`), personLevel ? (members.length ? members.join(', ') : L('keine gepflegt', 'none maintained')) : String(members.length)]);
  team.tone = worst(team.notes);

  // ---------- time allocation ----------
  const time = { rows: [], notes: [], quarters: [] };
  const s = dayIdx(iss.start), e = dayIdx(iss.due);
  time.rows.push([L('Original Estimate', 'Original estimate'), iss.oe > 0 ? h(iss.oe) : '–']);
  time.rows.push([L('Erfasst', 'Logged'), h(iss.ts || 0)]);
  time.rows.push([L('Rest (Remaining Estimate)', 'Remaining estimate'), h(iss.re || 0)]);
  const win = open ? spreadWindow(iss, 're', today) : null;
  if (!open) time.notes.push({ tone: 'ok', text: L('Erledigt – die Story belastet keine Planung mehr.', 'Done – the story no longer uses any capacity.') });
  else if (e == null) time.notes.push({ tone: 'warn', text: L('Kein Due Date – die Story wird nicht eingeplant (zählt als „unterminiert“) und fehlt in Wochen- und Quartalsplanung.', 'No due date – the story is not scheduled (counts as "unscheduled") and is missing from the weekly and quarter plans.') });
  else {
    const overdue = e < today;
    const from = win[0];
    const wd = Math.max(1, workdays(win[0], win[1]));
    const perWeek = (iss.re || 0) / Math.max(wd / 5, 0.2);
    time.rows.push([L('Verteilt über', 'Spread over'), overdue ? L('sofort (überfällig)', 'now (past due)') : `${date(from)} – ${date(e)} · ${wd} ${L('Arbeitstage', 'working days')}`]);
    if (!overdue && iss.re > 0) time.rows.push([L('Das sind je Woche', 'That is per week'), `≈ ${h(perWeek)}`]);
    if (overdue) time.notes.push({ tone: 'bad', text: L(`Due Date seit ${today - e} Tagen überschritten (${date(e)}). Der Rest von ${h(iss.re || 0)} wird komplett in die nächste Arbeitswoche gebucht.`, `Due date passed ${today - e} days ago (${date(e)}). The remaining ${h(iss.re || 0)} are booked into the next working week.`) });
    if (s == null && !overdue) time.notes.push({ tone: 'info', text: L(`Kein Start Date – geplant wird ab heute (${date(today)}).`, `No start date – planned from today (${date(today)}).`) });
    if (s != null && s > e) time.notes.push({ tone: 'bad', text: L(`Start Date (${date(s)}) liegt nach dem Due Date (${date(e)}).`, `Start date (${date(s)}) is after the due date (${date(e)}).`) });
    if (s != null && s < today && !overdue && !(iss.ts > 0)) time.notes.push({ tone: 'info', text: L(`Gestartet laut Plan am ${date(s)}, aber noch keine Zeit erfasst.`, `Planned to start on ${date(s)}, but no time logged yet.`) });
    if (!(iss.re > 0)) time.notes.push({ tone: 'warn', text: L('Rest ist 0 h – die offene Story belastet die Planung nicht. Remaining Estimate prüfen.', 'Remaining is 0 h – the open story uses no capacity. Check the remaining estimate.') });
    // which quarters the remaining hours land in (the waterline uses the same split)
    if (iss.re > 0) {
      let k = quarterKeyOf(win[0]);
      for (let n = 0; n < 8; n++) {
        const r = quarterRange(k);
        const part = shareIn(iss.re, r[0], r[1], win, model.rule);
        if (part > 0.05) time.quarters.push({ q: k, label: T.q(k), h: part });
        if (r[1] >= win[1]) break;
        k = quarterKeyOf(r[1] + 1);
      }
      if (time.quarters.length) time.rows.push([L('Rest je Quartal', 'Remaining per quarter'), time.quarters.map((x) => `${x.label}: ${h(x.h)}`).join(' · ')]);
    }
  }
  if (iss.oe > 0 && (iss.ts || 0) > iss.oe + 0.05) time.notes.push({ tone: 'warn', text: L(`Mehr Zeit erfasst als geschätzt: ${h(iss.ts)} statt ${h(iss.oe)} (+${h(iss.ts - iss.oe)}).`, `More time logged than estimated: ${h(iss.ts)} instead of ${h(iss.oe)} (+${h(iss.ts - iss.oe)}).`) });
  time.tone = worst(time.notes);

  // ---------- assignee load (only with person-level values on) ----------
  let load = null;
  if (open && aId && personLevel && capP) {
    const mon = mondayOf(today);
    const until = win ? win[1] : today + 27;
    const n = Math.max(2, Math.min(opts.maxWeeks || 8, Math.ceil((until - mon + 1) / 7)));
    const weeks = [];
    for (let k = 0; k < n; k++) {
      const a = mon + k * 7, b = a + 6;
      const pw = personWeek(computed, aId, a, b);
      if (!pw) continue;
      const story = pw.items.find((x) => x.id === iss.id)?.h || 0;
      weeks.push({ label: T.wk(a), from: a, plan: pw.plan, cap: pw.cap, util: pw.util, story, tone: utilTone(pw.util) || 'ok', items: pw.items.length });
    }
    const st = teamSettings(model, capP.teamId);
    load = { name: aName, weeks, notes: [], weeklyHours: +capP.weeklyHours || 0, share: projectShare(st) };
    const over = weeks.filter((w) => w.util > 1.0001 && Number.isFinite(w.util));
    const none = weeks.filter((w) => !Number.isFinite(w.util)); // work planned in a week without any available time
    if (over.length) {
      const top = [...over].sort((x, y) => y.util - x.util)[0];
      load.notes.push({ tone: 'bad', text: L(`${aName} ist in ${over.length} von ${weeks.length} Wochen überbucht – am stärksten in ${top.label} mit ${pct(top.util)} (${h(top.plan)} geplant, ${h(top.cap)} verfügbar).`, `${aName} is overbooked in ${over.length} of ${weeks.length} weeks – most in ${top.label} at ${pct(top.util)} (${h(top.plan)} planned, ${h(top.cap)} available).`) });
    }
    if (none.length) {
      load.notes.push({ tone: 'bad', text: L(`In ${none.map((w) => w.label).join(', ')} hat ${aName} keine verfügbare Zeit (Abwesenheit oder Feiertage), trotzdem sind ${h(none.reduce((t, w) => t + w.plan, 0))} eingeplant.`, `In ${none.map((w) => w.label).join(', ')} ${aName} has no available time (absence or public holidays), yet ${h(none.reduce((t, w) => t + w.plan, 0))} are planned.`) });
    }
    if (over.length || none.length) { /* noted above */ } else if (weeks.some((w) => w.util > 0.85)) load.notes.push({ tone: 'warn', text: L(`${aName} ist in einzelnen Wochen fast voll (über 85 %).`, `${aName} is nearly full in some weeks (above 85 %).`) });
    else if (weeks.length) load.notes.push({ tone: 'ok', text: L(`${aName} hat in diesen Wochen Luft (höchstens ${pct(Math.max(...weeks.map((w) => (Number.isFinite(w.util) ? w.util : 0))))}).`, `${aName} has room in these weeks (at most ${pct(Math.max(...weeks.map((w) => (Number.isFinite(w.util) ? w.util : 0))))}).`) });
    // absences inside the story's window
    if (win) for (const ab of model.ds.capacity?.absences || []) {
      if (ab.accountId !== aId) continue;
      const fa = dayIdx(ab.from), fb = dayIdx(ab.to);
      if (fa == null || fb == null || fb < win[0] || fa > win[1]) continue;
      load.notes.push({ tone: 'warn', text: L(`${aName} ist vom ${date(fa)} bis ${date(fb)} abwesend – mitten im Zeitraum dieser Story. In diesen Tagen ist keine Kapazität da.`, `${aName} is absent from ${date(fa)} to ${date(fb)} – inside this story's time frame. There is no capacity on those days.`) });
    }
    const others = (model.ds.issues || []).filter((x) => x.id !== iss.id && x.role === 'estimate' && isOpen(x) && x.assignee?.id === aId && x.re > 0);
    load.rows = [[L('Wochenstunden', 'Weekly hours'), h(load.weeklyHours)], [L('Davon für Projekte', 'Of which for projects'), `${pct(load.share)} = ${h(load.weeklyHours * load.share)}`], [L(`Weitere offene Stories von ${aName}`, `Other open stories of ${aName}`), `${others.length} · ${h(others.reduce((t, x) => t + x.re, 0))} ${L('Rest', 'remaining')}`]];
    load.tone = worst(load.notes);
  }

  // ---------- conflicts ----------
  const conflicts = [];
  const get = (x) => model.byId.get(x) || model.external.get(x);
  for (const d of deps.list) {
    if (d.dep === iss.id) {
      const pre = get(d.pre);
      const pd = dayIdx(pre?.due);
      const tag = { key: pre?.key, summary: pre?.summary };
      if (!isOpen(pre)) conflicts.push({ tone: 'ok', ...tag, text: L(`Wartet auf ${pre.key} – erledigt.`, `Waits for ${pre.key} – done.`) });
      else if (!open) continue;
      else if (pd == null) conflicts.push({ tone: 'warn', ...tag, text: L(`Wartet auf ${pre.key}, das kein Due Date hat – ob es rechtzeitig fertig wird, ist nicht prüfbar.`, `Waits for ${pre.key}, which has no due date – whether it finishes in time cannot be checked.`) });
      // a prerequisite that is still open although its due date has passed: this story may be held up right now
      else if (pd < today) conflicts.push({ tone: 'bad', ...tag, text: L(`Wartet auf ${pre.key} – noch offen, obwohl es seit ${today - pd} Tagen fällig ist (Due Date ${date(pd)}). Diese Story kann davon aufgehalten werden; neues Due Date für ${pre.key} klären.`, `Waits for ${pre.key} – still open although it was due ${today - pd} days ago (due date ${date(pd)}). This story may be held up; agree a new due date for ${pre.key}.`) });
      else if (e != null && pd > e) conflicts.push({ tone: 'bad', ...tag, text: L(`Wartet auf ${pre.key}, das erst am ${date(pd)} fertig sein soll – nach dem Due Date dieser Story (${date(e)}).`, `Waits for ${pre.key}, due only on ${date(pd)} – after this story's due date (${date(e)}).`) });
      else if (d.conflict) conflicts.push({ tone: 'bad', ...tag, text: L(`Wartet auf ${pre.key} (fällig am ${date(pd)}), startet aber schon am ${date(s)} – ${d.conflictDays} Tage Überschneidung.`, `Waits for ${pre.key} (due on ${date(pd)}) but starts on ${date(s)} – ${d.conflictDays} days overlap.`) });
      else if (s == null) conflicts.push({ tone: 'warn', ...tag, text: L(`Wartet auf ${pre.key} (fällig am ${date(pd)}). Diese Story hat kein Start Date – nicht vor dem ${date(pd)} starten.`, `Waits for ${pre.key} (due on ${date(pd)}). This story has no start date – do not start before ${date(pd)}.`) });
      else conflicts.push({ tone: 'ok', ...tag, text: L(`Wartet auf ${pre.key} – fällig am ${date(pd)}, vor dem Start (${date(s)}).`, `Waits for ${pre.key} – due on ${date(pd)}, before the start (${date(s)}).`) });
      if (d.missingNote && open && isOpen(pre)) conflicts.push({ tone: 'info', text: L(`Kein Abhängigkeits-Hinweis zu ${pre.key} – worauf genau gewartet wird, steht nirgends.`, `No dependency note for ${pre.key} – nobody wrote down what exactly is awaited.`) });
    } else if (d.pre === iss.id) {
      const dep = get(d.dep);
      if (!dep || !isOpen(dep) || !open) continue;
      const tag = { key: dep.key, summary: dep.summary };
      if (d.conflict) conflicts.push({ tone: 'bad', ...tag, text: L(`${dep.key} wartet auf diese Story und startet am ${date(dep.start)} – diese Story ist erst am ${date(e)} fällig (${d.conflictDays} Tage zu spät).`, `${dep.key} waits for this story and starts on ${date(dep.start)} – this story is due only on ${date(e)} (${d.conflictDays} days late).`) });
      else conflicts.push({ tone: 'ok', ...tag, text: L(`${dep.key} wartet auf diese Story – Termine passen.`, `${dep.key} waits for this story – dates fit.`) });
    }
  }
  if (open && model.isBlocked(iss)) conflicts.push({ tone: 'warn', text: L(`Status „${iss.status?.name || 'Blocked'}“${iss.blockedSince ? ` seit ${date(iss.blockedSince)}` : ''}.`, `Status "${iss.status?.name || 'Blocked'}"${iss.blockedSince ? ` since ${date(iss.blockedSince)}` : ''}.`) });
  if (open && e != null && project?.due && dayIdx(project.due) != null && e > dayIdx(project.due)) {
    conflicts.push({ tone: 'warn', text: L(`Due Date (${date(e)}) liegt nach dem Projektende von „${project.name}“ (${date(project.due)}).`, `Due date (${date(e)}) is after the end of "${project.name}" (${date(project.due)}).`) });
  }
  for (const g of dq.gaps.filter((x) => x.issueId === iss.id)) {
    if (g.rule === 'overdue') continue; // already explained under time
    if (g.rule.startsWith('missing:')) { const f = FIELD[g.rule.slice(8)]; conflicts.push({ tone: 'warn', text: L(`${f ? f[0] : g.rule.slice(8)} fehlt – Pflichtfeld laut Cockpit-Konfiguration.`, `${f ? f[1] : g.rule.slice(8)} missing – required by the cockpit configuration.`) }); }
    else if (g.rule === 'dueAfterMilestone') conflicts.push({ tone: 'warn', text: L(`Due Date liegt nach dem Meilenstein ${g.milestone}.`, `Due date is after milestone ${g.milestone}.`) });
    else if (g.rule === 'datesInverted') conflicts.push({ tone: 'bad', text: L(`Start (${date(dayIdx(g.start))}) liegt nach dem Due Date (${date(dayIdx(g.due))}) – die Planung bucht alle Stunden in die Due-Woche, bis die Termine stimmen.`, `Start (${date(dayIdx(g.start))}) is after the due date (${date(dayIdx(g.due))}) – planning books every hour into the due week until the dates are right.`) });
    else if (g.rule === 'outsideParent') conflicts.push({ tone: 'warn', text: L('Termine liegen außerhalb des Zeitraums des übergeordneten Epics.', 'Dates are outside the time frame of the parent epic.') });
  }
  // waterline: does the project still fit under the team's capacity line in the quarters this story lands in?
  if (open && tId && project) {
    for (const x of time.quarters) {
      const pt = wl.projectQ[project.ref]?.[x.q]?.teams?.find((t) => t.teamId === tId);
      if (!pt || pt.status === 'ok') continue;
      conflicts.push({ tone: pt.status === 'no' ? 'bad' : 'warn', text: L(
        `In ${x.label} passt „${project.name}“ (Rang ${project.rank}) im Team ${teamName(tId)} ${pt.status === 'no' ? 'nicht mehr' : 'nur teilweise'} unter die Kapazitätslinie (${h(pt.staffed)} von ${h(pt.demand)} besetzbar).`,
        `In ${x.label}, "${project.name}" (rank ${project.rank}) ${pt.status === 'no' ? 'no longer fits' : 'only partly fits'} under team ${teamName(tId)}'s capacity line (${h(pt.staffed)} of ${h(pt.demand)} staffable).`) });
    }
  }
  conflicts.sort((a, b) => RANK[b.tone] - RANK[a.tone]);

  const all = [...team.notes, ...time.notes, ...(load?.notes || []), ...conflicts];
  const bad = all.filter((x) => x.tone === 'bad').length, warn = all.filter((x) => x.tone === 'warn').length;
  const headline = bad + warn === 0
    ? L('Alles stimmig: Team, Termine und Auslastung passen.', 'All consistent: team, dates and load fit.')
    : [bad ? L(`${bad} Konflikt${bad > 1 ? 'e' : ''}`, `${bad} conflict${bad > 1 ? 's' : ''}`) : null, warn ? L(`${warn} Hinweis${warn > 1 ? 'e' : ''}`, `${warn} warning${warn > 1 ? 's' : ''}`) : null].filter(Boolean).join(' · ');
  return {
    known: true, kind: 'story', key: iss.key, summary: iss.summary, viaParent: viaParent ? { key: viaParent.key } : null,
    project: project ? { key: project.key, name: project.name, rank: project.rank, health: project.health?.status || null } : null,
    personLevel, tone: worst(all), counts: { bad, warn }, headline, team, time, load, conflicts, today: model.ds.today, assigneeCheck,
  };
}

// An epic or other level between project and story: what its stories add up to and which of them need a look.
function groupSummary(computed, iss, T, personLevel) {
  const { model } = computed;
  const { L, h } = T;
  const below = (model.ds.issues || []).filter((x) => x.role === 'estimate' && isOpen(x) && descends(model, x, iss.id));
  return summaryOf(computed, below, T, personLevel, { key: iss.key, summary: iss.summary, kind: 'group',
    intro: L(`Geplant wird über die ${below.length} offenen Stories darunter (${h(below.reduce((t, x) => t + (x.re || 0), 0))} Rest).`, `Planning runs through the ${below.length} open stories below (${h(below.reduce((t, x) => t + (x.re || 0), 0))} remaining).`) });
}
function projectSummary(computed, item, T, personLevel) {
  const { model } = computed;
  const { L, h } = T;
  const below = (model.byRoot.get(item.ref) || []).filter((x) => x.role === 'estimate' && isOpen(x));
  return summaryOf(computed, below, T, personLevel, { key: item.key, summary: item.name, kind: 'project',
    intro: L(`Projekt auf Rang ${item.rank}. Geplant wird über ${below.length} offene Stories (${h(below.reduce((t, x) => t + (x.re || 0), 0))} Rest).`, `Project at rank ${item.rank}. Planning runs through ${below.length} open stories (${h(below.reduce((t, x) => t + (x.re || 0), 0))} remaining).`) });
}
function descends(model, x, ancestorId) {
  let cur = x.parentId ? model.byId.get(x.parentId) : null;
  while (cur) { if (cur.id === ancestorId) return true; cur = cur.parentId ? model.byId.get(cur.parentId) : null; }
  return false;
}
function summaryOf(computed, stories, T, personLevel, head) {
  const { model, deps } = computed;
  const { L } = T;
  const people = capacityPeople(model);
  const mismatch = personLevel ? stories.filter((x) => x.team?.id && x.assignee?.id && people.get(x.assignee.id)?.teamId && !inTeam(people.get(x.assignee.id), x.team.id)) : [];
  const noTeam = stories.filter((x) => !x.team);
  const noDue = stories.filter((x) => !x.due);
  const overdue = stories.filter((x) => dayIdx(x.due) != null && dayIdx(x.due) < model.today);
  const ids = new Set(stories.map((x) => x.id));
  const conflictDeps = deps.list.filter((d) => d.conflict && (ids.has(d.pre) || ids.has(d.dep)));
  const list = (arr) => arr.slice(0, 6).map((x) => ({ key: x.key, summary: x.summary }));
  const groups = [
    { tone: 'warn', n: mismatch.length, text: L('Bearbeiter gehört nicht zum Team der Story', 'Assignee is not in the story\'s team'), items: list(mismatch) },
    { tone: 'bad', n: noTeam.length, text: L('Ohne Team', 'Without team'), items: list(noTeam) },
    { tone: 'warn', n: noDue.length, text: L('Ohne Due Date (nicht eingeplant)', 'Without due date (not scheduled)'), items: list(noDue) },
    { tone: 'bad', n: overdue.length, text: L('Due Date überschritten', 'Past due'), items: list(overdue) },
    { tone: 'bad', n: conflictDeps.length, text: L('Terminkonflikte bei Abhängigkeiten', 'Schedule conflicts in dependencies'), items: [] },
  ].filter((g) => g.n > 0);
  const bad = groups.filter((g) => g.tone === 'bad').reduce((t, g) => t + g.n, 0), warn = groups.filter((g) => g.tone === 'warn').reduce((t, g) => t + g.n, 0);
  return {
    known: true, ...head, personLevel, groups, tone: worst(groups), counts: { bad, warn },
    headline: groups.length ? L(`${groups.reduce((t, g) => t + g.n, 0)} Stories brauchen einen Blick`, `${groups.reduce((t, g) => t + g.n, 0)} stories need a look`) : L('Alle Stories darunter sind stimmig.', 'All stories below are consistent.'),
    today: model.ds.today,
  };
}
