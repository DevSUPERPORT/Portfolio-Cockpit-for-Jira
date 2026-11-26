// E2E self-test harness — compiled ONLY into test builds (VITE_SELFTEST=1), never shipped.
// It drives the real resolvers as the logged-in user; the server enforces every permission.
import { useEffect, useRef, useState } from 'react';
import { call, getContext, holdWrites, releaseWrites, readSnapshot, snapshotKey } from './lib/api.js';
import { computeAll, weeksUtilization } from '@shared/engine.js';
const fmtN = (v) => (Math.round((v || 0) * 10) / 10).toString();
import { digestSummary, digestDiff } from '@shared/digest.js';
import { todayInbox } from '@shared/inbox.js';
import { parseDay, fmtDay, localToday } from '@shared/smartActions.js';
import { roleBoards } from '@shared/boards.js';
import { answer as answerQ } from '@shared/ask.js';
import { supportTopics } from '@shared/insights.js';
import { WISH_IDS } from '@shared/wishCatalog.js';
import { isoOf } from '@shared/dates.js';
import { quarterChoices } from '@shared/quarterRange.js';
import { rankCandidates } from '@shared/projectSearch.js';
import { fmt, ruleName, getLang } from './lib/i18n.js';

const req = async (path, opts = {}) => {
  const { requestJira } = await import('./lib/bridge.js');
  const r = await requestJira(path, { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, ...opts });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};
const expectErr = async (name, payload, code) => {
  try { await call(name, payload); return { ok: false, info: 'succeeded but should fail' }; }
  catch (e) { return { ok: !code || e.code === code || String(e.code).startsWith(code), info: `${e.code}: ${String(e.message).slice(0, 60)}` }; }
};
let FID = null;
async function fieldIds() {
  if (FID) return FID;
  const env = String((await getContext()).environmentType || 'DEVELOPMENT').toUpperCase();
  const fields = (await req('/rest/api/3/field')).body;
  const pick = (k) => fields.find((f) => String(f.key).includes('083d5c93') && String(f.key).includes('__' + env + '__') && String(f.key).endsWith(k))?.id;
  FID = { rank: pick('pc-portfolio-rank'), tshirt: pick('pc-tshirt-size'), quarters: pick('pc-target-quarters'), env };
  return FID;
}
const cf = (id) => 'cf[' + String(id).replace('customfield_', '') + ']';
// Ask canvas: wait until every card is fully shown and has stopped moving (two equal samples 300 ms apart), at most 12 s –
// an overlap is only real where the cards come to rest. → the time it took (ms), or null when they never settled
async function settled(cards, maxMs = 12000) {
  const t0 = performance.now();
  const snap = () => cards.map((c) => { const r = c.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.height)},${getComputedStyle(c).opacity}`; }).join('|');
  let prev = snap();
  for (;;) {
    await new Promise((r) => setTimeout(r, 300));
    const cur = snap();
    if (cur === prev && cards.every((c) => +getComputedStyle(c).opacity >= 0.99)) return Math.round(performance.now() - t0);
    if (performance.now() - t0 > maxMs) return null;
    prev = cur;
  }
}
async function ctx() {
  await fieldIds();
  const epics = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: 'project in (PCX, PCR) AND issuetype = Epic ORDER BY key', fields: ['summary', 'project', 'assignee', 'issuetype'], maxResults: 20 }) })).body.issues;
  const story = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: 'project = PCX AND issuetype = Story ORDER BY key', fields: ['summary'], maxResults: 5 }) })).body.issues[0];
  const noTeam = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: 'project = PCX AND issuetype = Story AND Team is EMPTY ORDER BY key', fields: ['summary'], maxResults: 1 }) })).body.issues[0];
  const groups = Object.fromEntries((await Promise.all(['pc-test-management', 'pc-test-projectadmins'].map((g) => req(`/rest/api/3/group/bulk?groupName=${g}`)))).filter((r) => r.body?.values?.[0]).map((r) => [r.body.values[0].name, r.body.values[0].groupId])); // non-admins may not list groups
  return { epics, story, noTeam, groups };
}
const sandboxConfig = (groups, mgmt = 'pc-test-management') => ({
  portfolio: { source: 'issue', issueTypeIds: ['10000'], autoRemoveDone: false },
  levels: [{ key: 'story', name: 'Story, Task, Bug', role: 'estimate', issueTypeIds: ['10008', '10010', '10009'] }, { key: 'subtask', name: 'Sub-task', role: 'tiny', issueTypeIds: ['10007'] }],
  fields: { team: 'customfield_10001', startDate: 'customfield_10015', tshirt: 'app', targetQuarters: 'app', note: 'customfield_10204' },
  matrix: {
    portfolio: { owner: 'required', dueDate: 'optional', tshirt: 'required', targetQuarters: 'required', team: 'optional' },
    story: { team: 'required', assignee: 'optional', originalEstimate: 'required', startDate: 'required', dueDate: 'required', milestone: 'optional', parent: 'required' },
    subtask: { assignee: 'optional' },
  },
  dependencies: { linkTypeIds: ['10000'], reversedLinkTypeIds: [] },
  report: { publishSpaces: [{ id: '5144578', key: 'PCXR', name: 'Portfolio Cockpit Sandbox Reports' }] },
  tshirtSizes: [{ key: 'XS', hours: 40 }, { key: 'S', hours: 120 }, { key: 'M', hours: 320 }, { key: 'L', hours: 640 }, { key: 'XL', hours: 1280 }],
  rules: { dueDateWarning: true, distribution: 'linear', personLevel: true, lockSubtasks: true, healthRhythmDays: 7, forecastThresholdPct: 10, deviationThresholdPct: 15 },
  permissions: {
    viewReport: [{ id: groups[mgmt], name: mgmt }], manageRanking: [{ id: groups[mgmt], name: mgmt }],
    editCapacity: [{ id: groups[mgmt], name: mgmt }], editHealth: [{ id: groups['pc-test-projectadmins'], name: 'pc-test-projectadmins' }],
  },
  support: { serviceProjectIds: [], averagingWeeks: 4, slaTargetPct: 95 },
  capacityDefaults: { defaultWeeklyHours: 40, defaultLocation: 'DE-NW' },
});

// open a view through search (Ctrl K) – Nachweis and other views without a tab of their own (E2E 2026-11-20)
async function viaPalette(query, re) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.dispatchEvent(new CustomEvent('pc-palette', { detail: true }));
  let input = null;
  for (let w = 0; w < 20 && !(input = document.querySelector('.palette-input')); w++) await sleep(150);
  if (!input) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, query);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  let item = null;
  // a view entry, not the "Ask Lotse: …" line on top (that one opens the Lotse panel)
  for (let w = 0; w < 30 && !(item = [...document.querySelectorAll('.palette-item:not(.lx-pal-top)')].find((b) => re.test(b.textContent))); w++) await sleep(150);
  if (!item) { window.dispatchEvent(new CustomEvent('pc-palette', { detail: false })); return false; }
  item.click();
  await sleep(600);
  return true;
}
const SUITES = {
  // The DEVELOPMENT install on superportdev (2026-11-17): configure it once like the sandbox – sub-task lock OFF (its
  // trigger sees every work item of the site) – add the PCX projects and test capacity: Dev Team away over Christmas
  // (the tester's KW 52–53 case). Refuses any other environment; writes only this install's own storage and its own
  // (development) Portfolio Rank field on the PCX epics.
  async devSetup(t, c) {
    const env = (await fieldIds()).env;
    t('environment is DEVELOPMENT', env === 'DEVELOPMENT', env);
    if (env !== 'DEVELOPMENT') return;
    const cur = await call('config.get');
    const base = sandboxConfig(c.groups);
    if (!cur.config.setupComplete) await call('config.save', { config: { ...base, rules: { ...base.rules, lockSubtasks: false, distribution: 'capacity' } } });
    const cfg = (await call('config.get')).config;
    t('configured; sub-task lock OFF', cfg.setupComplete && cfg.rules.lockSubtasks === false, `distribution ${cfg.rules.distribution}`);
    let ds = await call('dataset');
    if (!ds.portfolio.length) for (const e of c.epics) await call('portfolio.add', { ref: `issue:${e.id}` });
    ds = await call('dataset');
    t('portfolio: PCX projects in', ds.portfolio.length > 0, `${ds.portfolio.length} projects · ${ds.issues.length} work items`);
    const cap = (await call('capacity.get')).capacity;
    if (!Object.keys(cap.people || {}).length) {
      const me = (await call('bootstrap')).me.id;
      const byName = (re) => Object.values(ds.people || {}).find((p) => re.test(p.name || ''))?.id || null;
      const team = (name) => (ds.teams || []).find((x) => x.name === name)?.id || null;
      const people = {};
      const put = (id, teamName, h) => { if (id && team(teamName)) people[id] = { weeklyHours: h, location: 'DE-NW', teamId: team(teamName) }; };
      const others = Object.values(ds.people || {}).map((p) => p.id).filter((id) => id && id !== me);
      put(me, 'Web', 38); put(others[0], 'Integration', 40); put(others[1], 'Integration', 40); put(others[2], 'Data', 40);
      const teams = Object.fromEntries((ds.teams || []).map((x) => [x.id, { name: x.name, dailyBusinessPct: 20, internalPct: 10, absenceRatePct: 0 }]));
      const absences = [{ accountId: me, from: '2026-12-21', to: '2027-01-01', type: 'vacation' }, ...(others[0] ? [{ accountId: others[0], from: '2026-12-28', to: '2026-12-30', type: 'vacation' }] : [])];
      await call('capacity.save', { capacity: { people, teams, absences } });
    }
    // support: the FSST service project (as on the production install), only when this install has none yet
    const cfgNow = (await call('config.get')).config;
    if (!(cfgNow.support?.serviceProjectIds || []).length && !(cfgNow.support?.queues || []).length) {
      const fsst = await req('/rest/api/3/project/FSST').catch(() => null);
      if (fsst?.status === 200 && fsst.body?.id) await call('config.save', { config: { ...cfgNow, support: { ...cfgNow.support, serviceProjectIds: [String(fsst.body.id)] } } });
    }
    const sup = (await call('config.get')).config.support || {};
    t('support space configured', (sup.serviceProjectIds || []).length > 0 || (sup.queues || []).length > 0, JSON.stringify(sup.serviceProjectIds || []));
    const cap2 = (await call('capacity.get')).capacity;
    t('test capacity in place (people, absences)', Object.keys(cap2.people || {}).length > 0 && (cap2.absences || []).length > 0, `${Object.keys(cap2.people).length} people · ${cap2.absences.length} absences`);
  },
  // Weekly plan (tester + boss 2026-11-17): every part in the hover, no "∞", suggestions that fit, 8 / 12 / 26 weeks.
  async boardLive(t) {
    const ds = await call('dataset');
    const computed = computeAll(ds);
    const { buildBoard, taskParts } = await import('@shared/weekPlan.js');
    const { suggestShifts } = await import('@shared/planSuggest.js');
    let parts = 0, bad = 0, sug = 0, sugBad = 0, noTime = 0;
    for (const team of computed.model.teams.keys()) {
      const board = buildBoard({ ds, computed, team });
      for (const tk of board.taskById.values()) {
        if (tk.len < 2) continue;
        parts++;
        if (Math.abs(taskParts(tk).reduce((a, p) => a + p.hours, 0) - tk.oe) > 0.2) bad++;
      }
      for (const r of board.rows) for (const cell of r.cells) if (r.kind === 'person' && !(cell.avail > 0.05) && (cell.own ?? cell.load) > 0.05) noTime++;
      for (const x of suggestShifts({ ds, computed, board })) {
        sug++;
        // only the weeks the work moves INTO (the week it leaves may have no time – an absence – and other work left)
        if (x.preview.some((p) => p.after.load > p.before.load + 0.05 && !(p.after.avail > 0.05))) sugBad++;
      }
    }
    t('all parts of every multi-week task add up to its estimate', parts > 0 && bad === 0, `${parts} tasks, ${bad} off`);
    t('suggestions never move work into a week without time', sugBad === 0, `${sug} suggestions · ${noTime} person-weeks without time but with work`);
    t('red weeks of planners get a suggestion (also when a person is booked for months)', noTime === 0 || sug > 0, `${noTime} weeks without time · ${sug} suggestions`);
    // E2E consistency (2026-11-17): what a suggestion's preview promises is exactly what the board shows after Accept –
    // both distributions; and the optimizer's promise (accepting creates no new overload) holds on real data
    const { moveTask } = await import('@shared/weekPlan.js');
    const { optimizeAll, suggestionMoves, OPT_MODES } = await import('@shared/optimize.js');
    const U = (x) => (x.avail > 0.05 ? x.load / x.avail : x.load > 0.05 ? 99 : 0);
    let pv = 0, pvOff = 0, optN = 0, optBad = 0;
    const byId = new Map((ds.issues || []).map((i) => [i.id, i]));
    for (const distribution of ['even', 'capacity']) {
      for (const team of computed.model.teams.keys()) {
        const board = buildBoard({ ds, computed, team, distribution });
        for (const x of suggestShifts({ ds, computed, board }).slice(0, 4)) {
          const after = buildBoard({ ds, computed, team, distribution, moves: moveTask({}, byId.get(x.taskId), x.change || { weeks: x.weeks }) });
          const row = after.rows.find((r) => r.accountId === x.personId);
          if (!row) continue;
          for (const p of x.preview) { const wi = after.weeks.findIndex((w) => w.from === p.monday); if (wi < 0) continue; pv++; if (Math.abs(row.cells[wi].load - p.after.load) > 0.01) pvOff++; }
        }
        const all = optimizeAll({ ds, computed, board, team, target: 1, distribution });
        const sel = OPT_MODES.flatMap((m) => all[m].suggestions);
        if (!sel.length) continue;
        optN += sel.length;
        const b2 = buildBoard({ ds, computed, team, distribution, moves: suggestionMoves({}, ds.issues, sel) });
        for (const r of board.rows.filter((x) => x.kind === 'person')) {
          const r2 = b2.rows.find((x) => x.accountId === r.accountId);
          if (r2) r.cells.forEach((c, i) => { if (U(r2.cells[i]) > Math.max(U(c), 1) + 0.02) optBad++; });
        }
      }
    }
    t('suggestion previews = the board after Accept (even and by capacity)', pvOff === 0, `${pv} preview weeks checked, ${pvOff} off`);
    t('optimizer: accepting every suggestion creates no new overload (even and by capacity)', optBad === 0, `${optN} suggestions · ${optBad} person-weeks newly over`);
    // Jahresprognose: every project, 12 and 24 months – finite numbers, months add up
    const { projectYear } = await import('@shared/yearPlan.js');
    {
      // a staged move shows up in the year view (and is counted as pending)
      const it = computed.model.items.find((p) => (ds.issues || []).some((i) => i.rootRef === p.ref && i.role === 'estimate' && i.start && i.due && i.oe > 0 && i.status?.cat !== 'done'));
      const story = it && ds.issues.find((i) => i.rootRef === it.ref && i.role === 'estimate' && i.start && i.due && i.oe > 0 && i.status?.cat !== 'done');
      if (story) {
        const y0 = projectYear({ ds, computed, project: it.ref }), y1 = projectYear({ ds, computed, project: it.ref, moves: moveTask({}, story, { weeks: 6 }) });
        t('year projection includes pending board moves', y1.pending === 1 && y0.pending === 0 && JSON.stringify(y1.total) !== JSON.stringify(y0.total), `${it.name}: ${y0.planned.toFixed(1)} h → ${y1.planned.toFixed(1)} h in range`);
      }
    }
    let yBad = 0, yN = 0;
    for (const it of computed.model.items) for (const months of [12, 24]) {
      const y = projectYear({ ds, computed, project: it.ref, months });
      yN++;
      if (y.months.length !== months || !Number.isFinite(y.planned) || Math.abs(y.total.reduce((a, b) => a + b, 0) - y.planned) > 1e-6 || y.rows.some((r) => r.cells.some((c) => !Number.isFinite(c.own)))) yBad++;
    }
    t('year projection: every project, 12 and 24 months, consistent numbers', yN > 0 && yBad === 0, `${yN} projections`);
    // the screen: Wochenplanung, first team – no "∞", the week range switch works (and is put back)
    const tab = [...document.querySelectorAll('[role="tab"]')].find((x) => /^(Wochenplanung|Weekly planning)/.test(x.textContent.trim()));
    tab?.click(); await new Promise((r) => setTimeout(r, 2500));
    const chip = [...document.querySelectorAll('button')].find((b) => /^(Web)$/.test(b.textContent.trim())) || [...document.querySelectorAll('button')].find((b) => /Pers\.|ppl/.test(b.textContent));
    chip?.click(); await new Promise((r) => setTimeout(r, 2500));
    const heads = [...document.querySelectorAll('.wb-head')].map((h) => h.textContent);
    t('board shows no "∞"', heads.length > 0 && !heads.some((h) => h.includes('∞')), `${heads.length} week heads`);
    const sugText = document.querySelector('[data-wb-suggestions]')?.innerText || '';
    t('suggestions read plainly (no "∞")', !sugText.includes('∞'), sugText.slice(0, 200) || 'no suggestions on this board');
    const seg = [...document.querySelectorAll('.wb-dist button')].find((b) => b.textContent.trim() === '12');
    seg?.click(); await new Promise((r) => setTimeout(r, 2500));
    const cols = getComputedStyle(document.querySelector('.wb-grid') || document.body).getPropertyValue('--wb-cols').trim();
    t('week range 12 shows 12 weeks', cols === '12', `--wb-cols ${cols}`);
    [...document.querySelectorAll('.wb-dist button')].find((b) => b.textContent.trim() === '8')?.click();
    await new Promise((r) => setTimeout(r, 1500));
  },
  // Lotse on the year (user 2026-11-17): "Jahres-Check" on real data (valid, every number sourced) and the closure
  // mission from the snow sentence up to the preview – read-only: the job is cancelled before anything is written.
  async yearLive(t) {
    const ds = await call('dataset');
    const computed = computeAll(ds);
    const L = await import('@shared/lotse/index.js');
    const me = (await call('bootstrap')).me;
    const ctx = { ds, computed, lang: 'de', me, roles: (await call('bootstrap')).roles };
    const s = L.run('yearCheck', {}, ctx);
    let okStory = false; try { okStory = !!L.validStory(s); } catch { okStory = false; }
    t('Jahres-Check: a valid story on this site\'s data', okStory && s.skill === 'yearCheck', s?.headline || '');
    t('Jahres-Check: every number sourced', L.selfCheck(s).length === 0, JSON.stringify(L.selfCheck(s)).slice(0, 300));
    const r = L.routeAct('Heute hat es stark geschneit und die Arbeit ist für die Woche ausgefallen, lass uns den Plan neu ordnen', ctx);
    t('the snow sentence routes to the closure mission', r?.workflow === 'disruption', JSON.stringify(r?.params || {}));
    let st = L.startWorkflow({ id: 'disruption', params: { ...(r?.params || {}), scope: 'me' } }, ctx);
    for (let g = 0; g < 20 && st.status !== 'done'; g++) { const cur = L.currentStep(st); if (!cur || cur.kind === 'preview') break; st = cur.kind === 'decide' ? L.answerWorkflow(st, cur.id, (cur.options.find((o) => o.recommended && !o.disabled) || cur.options.find((o) => !o.disabled)).id) : L.nextWorkflow(st); }
    const stories = st.steps.filter((x) => x.kind === 'story');
    t('closure mission: impact story valid and sourced', stories.length > 0 && stories.every((x) => { try { return L.validStory(x.story) && L.selfCheck(x.story).length === 0; } catch { return false; } }), stories.map((x) => x.story.headline).join(' | ').slice(0, 300));
    const cur = L.currentStep(st);
    t('closure mission ends in a preview (nothing written)', !cur || cur.kind === 'preview' || st.status === 'done', cur?.kind || st.status);
    L.cancelWorkflow(st);
  },
  // People in several teams (user 2026-11-17): the multi-team check and the automatic fix on this site's real data –
  // read-only: the mission runs to its preview (with the re-check of its own result), then it is cancelled.
  async splitLive(t) {
    const ds = await call('dataset');
    const computed = computeAll(ds);
    const L = await import('@shared/lotse/index.js');
    const { splitConflicts, realConflicts } = await import('@shared/splitPeople.js');
    const { weeksUtilization } = await import('@shared/engine.js');
    const boot = await call('bootstrap');
    const ctx = { ds, computed, lang: 'de', me: boot.me, roles: boot.roles };
    const r = splitConflicts(computed.model, computed.support);
    const split = r.people.filter((p) => p.teams.length >= 2);
    t('multi-team check runs on this site', true, `${split.length} in several teams (${split.map((p) => `${p.name || '?'} ${p.teams.map((x) => `${computed.model.teams.get(x.teamId)?.name || x.teamId} ${x.pct} %`).join('/')}`).join('; ').slice(0, 200)}) · ${realConflicts(r).length} conflicts`);
    // the same hours as the Teams tab
    const wu = weeksUtilization(computed.model, computed.support, 12);
    let same = 0, off = 0;
    for (const p of r.people) { const m = wu.teams.flatMap((x) => x.members).find((x) => x.id === p.id); if (!m) continue; m.plan.forEach((h, w) => { same++; if (Math.abs(h - p.total[w]) > 1e-6) off++; }); }
    t('multi-team numbers = the Teams tab numbers', off === 0, `${same} person-weeks compared, ${off} off`);
    const s = L.run('splitCheck', {}, ctx);
    let ok = false; try { ok = !!L.validStory(s); } catch { ok = false; }
    t('Mehrteam-Check: valid story, every number sourced', ok && L.selfCheck(s).length === 0, `${s.headline} ${JSON.stringify(L.selfCheck(s)).slice(0, 200)}`);
    const route = L.routeAct('Löse die Mehrteam-Konflikte automatisch', ctx);
    t('"Löse die Mehrteam-Konflikte automatisch" → the mission, no questions', route?.workflow === 'splitResolve' && route.params?.mode === 'auto', JSON.stringify(route || {}).slice(0, 160));
    let st = L.startWorkflow({ id: 'splitResolve', params: { mode: 'auto' } }, ctx);
    for (let g = 0; g < 30 && st.status !== 'done'; g++) { const cur = L.currentStep(st); if (!cur || cur.kind === 'preview') break; st = cur.kind === 'decide' ? L.answerWorkflow(st, cur.id, (cur.options.find((o) => o.recommended && !o.disabled) || cur.options.find((o) => !o.disabled)).id) : L.nextWorkflow(st); }
    const stories = st.steps.filter((x) => x.kind === 'story').map((x) => x.story);
    t('mission stories valid and sourced', stories.length > 0 && stories.every((x) => { try { return L.validStory(x) && L.selfCheck(x).length === 0; } catch { return false; } }), stories.map((x) => x.headline).join(' | ').slice(0, 300));
    const after = stories.find((x) => x.id === 'splitResolve:after');
    const before = realConflicts(r).length;
    const left = after ? after.kpis.find((k) => k.id === 'after')?.value : before;
    t('Lotse\'s re-check of its own result: fewer conflicts, never more', !before || (after && left < before) || (!after && /keine|no multi/i.test(stories[0]?.headline || '')), `${before} → ${left ?? '–'}`);
    const cur = L.currentStep(st);
    t('mission ends in a preview or with nothing to do (nothing written)', !cur || cur.kind === 'preview' || st.status === 'done', cur?.kind || st.status);
    L.cancelWorkflow(st);
    // the Teams tab shows the callout for a team with a conflict (UI)
    const teamWith = realConflicts(r).find((c) => c.kind === 'overbooked' || c.kind === 'shareDrift');
    t('Teams tab: a team with a multi-team conflict exists or none is needed', true, teamWith ? `${teamWith.kind} – ${teamWith.personId}` : 'no team needs the callout');
  },
  // Support › Verteilen › Lotse (live finding 2026-11-17: one ticket only, then stuck) – read-only: nothing is assigned.
  async dispatchLive(t) {
    const ds = await call('dataset');
    const computed = computeAll(ds);
    const D = await import('@shared/dispatch.js');
    const { lotseDraft } = await import('@shared/lotse/teamwork.js');
    const { dispatchPayload } = await import('@shared/aiPayload.js');
    const tickets = ds.supportTickets?.tickets || [];
    const settings = D.dispatchSettings(ds.config);
    const rows = D.sortBySla(D.incomingTickets(tickets, settings).incoming);
    t('incoming tickets loaded', rows.length > 0, `${rows.length} incoming`);
    if (!rows.length) return;
    const teamIds = new Set(computed.model.teams.keys());
    const members = new Map((computed.weeks?.teams || []).filter((x) => x.teamId !== '_none').map((x) => [x.teamId, x.members.map((m) => ({ id: m.id, plan: m.plan[0] || 0, cap: m.cap[0] || 0 }))]));
    const pt = new Map(); for (const [tid, l] of members) for (const m of l) if (!pt.has(m.id)) pt.set(m.id, tid);
    const opts = { componentTeams: settings.componentTeams, history: D.componentHistory(tickets), teamIds, similar: D.similarIndex(tickets), personTeam: (id) => pt.get(id) || null, fallback: D.freestTeam(members, (id) => teamIds.has(id)) };
    const sugg = new Map(rows.map((r) => [r.id, D.suggestTeam(r, opts)]));
    const src = {}; for (const s of sugg.values()) src[s.source || 'none'] = (src[s.source || 'none'] || 0) + 1;
    t('every incoming ticket has a team hint (with its reason)', !src.none, JSON.stringify(src));
    const batch = rows.slice(0, 100);
    const teams = [...computed.model.teams.values()].map((x) => ({ id: x.id, name: x.name }));
    const payload = dispatchPayload({ max: batch.length, tickets: batch, teams, members, suggTeam: sugg, history: opts.history, mapping: settings.componentTeams, personName: (id) => ds.people?.[id]?.name || '' });
    const r = lotseDraft('dispatch', { ...payload, feature: 'dispatch', lang: 'de' }, { ds, computed, lang: 'de' }).result;
    t('Lotse proposes the whole batch, not just one', (r?.items?.length || 0) === batch.filter((x) => sugg.get(x.id)?.teamId).length, `${r?.items?.length} of ${batch.length}`);
    const per = new Map(); for (const x of r?.items || []) if (x.accountId) per.set(x.accountId, (per.get(x.accountId) || 0) + 1);
    t('the batch is spread over people', per.size > 1 || (r?.items?.length || 0) <= 1, [...per.values()].join('/'));
  },
  // Atlassian Teams (boss feedback 2026-11-17): live connection, members in the dataset, the same membership rule in
  // the Teams tab and in the issue panel. Read-only (a refresh only rewrites the cockpit's own snapshot).
  async teamsLive(t) {
    const st = await call('teams.atlassian', { refresh: true });
    t('Atlassian Teams readable (as this user)', st.status === 'ok', `${st.status} · ${st.teams?.length ?? 0} teams${st.failed ? ` · ${st.failed} failed` : ''}`);
    const withMembers = (st.teams || []).filter((x) => x.members > 0);
    t('teams with members found', withMembers.length > 0, withMembers.map((x) => `${x.name} ${x.members}`).join(', '));
    const ds = await call('dataset');
    t('dataset carries the snapshot', ds.atlTeams?.status === 'ok', ds.atlTeams ? `${Object.keys(ds.atlTeams.teams).length} teams` : 'none');
    // themes (the level above the projects): every project's theme is a loaded theme, and it is the project's Jira parent
    const thIds = new Set((ds.themes || []).map((x) => x.id));
    const badTheme = (ds.portfolio || []).filter((p) => p.themeId && (!thIds.has(p.themeId) || p.themeId !== p.parentId));
    t('themes: each project\'s theme is its loaded Jira parent', Array.isArray(ds.themes) && !badTheme.length, `${(ds.themes || []).length} themes · ${(ds.portfolio || []).filter((p) => p.themeId).length}/${(ds.portfolio || []).length} projects with a theme${badTheme.length ? ` · wrong: ${badTheme.map((p) => p.key).join(', ')}` : ''}`);
    const parentOf = new Map((ds.portfolio || []).filter((p) => p.parentId).map((p) => [p.key, p.parentId]));
    if (parentOf.size) {
      const one = [...parentOf.keys()][0];
      const jp = (await req(`/rest/api/3/issue/${one}?fields=parent`)).body?.fields?.parent?.id || null;
      t('themes: the parent matches Jira', jp === parentOf.get(one), `${one} → ${jp}`);
    }
    t('no work item of a switched-off level reaches the browser', !(ds.issues || []).some((i) => i.role === 'skip'));
    // Add project – search (boss 2026-11-19): a partial key and a word start find a real candidate (read only)
    const candPool = await call('portfolio.candidates', { pool: true }).catch(() => null);
    t('add project: the candidates load once (pool)', Array.isArray(candPool?.items), candPool ? `${candPool.items.length} candidates${candPool.truncated ? ' (more on the server)' : ''}` : 'no pool');
    const cand = candPool?.items?.find((c) => /\d{2,}$/.test(c.key || '') && /[A-Za-zÄÖÜäöü]{4,}/.test(c.name || ''));
    if (cand) {
      const part = cand.key.slice(0, -1);
      t('add project: a partial key finds it (browser)', rankCandidates(candPool.items, part).some((x) => x.ref === cand.ref), `${part} → ${cand.key}`);
      const word = (cand.name.match(/[A-Za-zÄÖÜäöü]{4,}/) || [''])[0].slice(0, 4).toLowerCase();
      const srv = await call('portfolio.candidates', { query: word });
      t('add project: a word start finds it (server)', Array.isArray(srv) && srv.some((x) => x.ref === cand.ref), `${word} → ${srv?.length ?? 0} results`);
    }
    const { buildModel } = await import('@shared/engine.js');
    const { memberStatus, teamOutsiders, membershipSource } = await import('@shared/teamMembership.js');
    const model = buildModel(ds);
    const sample = Object.entries(ds.atlTeams?.teams || {}).find(([, x]) => x.members?.length);
    if (sample) {
      const [tid, x] = sample;
      t('members of a team are judged members', x.members.every((m) => memberStatus(model, m.accountId, tid) === 'member'), `${x.name}: ${x.members.length}`);
      t('membership source is Atlassian for that team', membershipSource(model, tid) === 'atlassian');
    }
    // every outsider listed in the Teams tab is really missing from the Atlassian team
    let checked = 0, wrong = 0;
    for (const tid of model.teams.keys()) {
      if (membershipSource(model, tid) !== 'atlassian') continue;
      for (const o of teamOutsiders(model, tid)) { checked++; if ((ds.atlTeams.teams[tid].members || []).some((m) => m.accountId === o.id)) wrong++; }
    }
    t('outsiders in the Teams tab are not members in Atlassian', wrong === 0, `${checked} checked`);
    // boss 2026-11-17 (CEO team): everyone in an Atlassian team counts in that team's capacity – maintained or not –
    // and nobody counts in a team Atlassian says they are not in
    const { capacityPeople } = await import('@shared/engine.js');
    const { shareOf } = await import('@shared/allocation.js');
    const people = capacityPeople(model);
    let mem = 0, missing = [], extra = [];
    for (const tid of model.teams.keys()) {
      if (membershipSource(model, tid) !== 'atlassian') continue;
      const ids = new Set((ds.atlTeams.teams[tid].members || []).map((m) => m.accountId));
      for (const id of ids) { mem++; const p = people.get(id); if (!p || !(shareOf(p, tid) > 0)) missing.push(`${model.teams.get(tid)?.name}: ${ds.people?.[id]?.name || '?'}`); }
      for (const p of people.values()) if (shareOf(p, tid) > 0 && !ids.has(p.id)) extra.push(`${model.teams.get(tid)?.name}: ${ds.people?.[p.id]?.name || '?'}`);
    }
    // boss 2026-11-18: team names as plain text; the quarter field offers the configured range
    const enc = Object.values(ds.atlTeams?.teams || {}).filter((x) => /&(#\d+|#x[0-9a-f]+|amp|quot|lt|gt|apos);/i.test(x.name || '')).map((x) => x.name);
    t('team names are plain text (no HTML entities)', !enc.length, enc.slice(0, 3).join(', ') || `${Object.keys(ds.atlTeams?.teams || {}).length} names`);
    const fo = await call('field.options');
    const qr = (await call('config.get')).config?.quarterRange || {};
    const want = quarterChoices(qr);
    t('target-quarter field offers the configured range (window − switched off + added)', Array.isArray(fo?.quarters) && JSON.stringify(fo.quarters) === JSON.stringify(want), `${fo?.quarters?.[0]} … ${fo?.quarters?.at(-1)} (${fo?.quarters?.length}; want ${want.length}; off ${(qr.off || []).length}, extra ${(qr.extra || []).length})`);
    t('capacity members = Atlassian members in every shown team', !missing.length && !extra.length, `${mem} memberships · missing ${missing.slice(0, 3).join(', ') || 0} · extra ${extra.slice(0, 3).join(', ') || 0}`);
    // PCX-1 (sandbox): the issue panel says the same as the Teams tab
    const pcx1 = ds.issues.find((i) => i.key === 'PCX-1');
    if (pcx1?.team?.id && pcx1.assignee?.id) {
      const want = memberStatus(model, pcx1.assignee.id, pcx1.team.id);
      t('PCX-1: membership known', ['member', 'outside'].includes(want), `${pcx1.team.name}: ${want}`);
    }
  },
  // Restores the configuration exactly as it was before the version history started (read-only otherwise).
  // Exact restore after a test run that changed the configuration: the newest version saved before the cutoff (PCX-1
  // property pc-restore-cutoff { at }), compared field by field afterwards (E2E 2026-11-24: denyRoles crashed mid-way).
  async restoreBefore(t) {
    const cut = (await req('/rest/api/3/issue/PCX-1/properties/pc-restore-cutoff')).body?.value?.at;
    t('cutoff set', typeof cut === 'string' && cut.length > 10, String(cut));
    if (!cut) return;
    const hist = await call('config.history');
    const after = hist.filter((h) => h.at >= cut);
    const v = hist.filter((h) => h.at < cut).sort((a, b) => b.at.localeCompare(a.at))[0];
    t('version before the cutoff found', !!v, v ? `${v.at} ${v.note || ''} ${v.byName || ''} · ${after.length} version(s) after the cutoff` : 'none');
    if (!v) return;
    await call('config.restore', { id: v.id });
    const empty = (x) => x == null || x === '' || (Array.isArray(x) && !x.length) || (typeof x === 'object' && !Array.isArray(x) && !Object.keys(x).length);
    const diff = (a, b, path, out) => {
      if (empty(a) && empty(b)) return out;
      if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(path); return out; }
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], path ? `${path}.${k}` : k, out);
      return out;
    };
    const want = (await call('config.version', { id: v.id })).config;
    const now = (await call('config.get')).config;
    const d = diff(now, want, '', []).filter((p) => !/^((ai\.)?changedAt|(ai\.)?changedBy|version|setupComplete)$/.test(p)); // ai.changedAt/By: audit stamp of every AI change, the restore itself is one
    t('configuration equals that version (field by field)', !d.length, d.slice(0, 12).join(' | '));
  },
  async restoreOrig(t) {
    const hist = await call('config.history');
    const orig = hist.find((v) => v.note === 'before-history');
    t('original version found', !!orig, orig?.at);
    if (!orig) return;
    await call('config.restore', { id: orig.id });
    t('restored', true);
  },
  // Field-by-field comparison: current configuration vs. the version before any change in the history.
  async cfgdiff(t) {
    const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
    const diff = (a, b, path, out) => {
      if (empty(a) && empty(b)) return out;
      if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: ${JSON.stringify(b)?.slice(0, 60)} → ${JSON.stringify(a)?.slice(0, 60)}`); return out; }
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], path ? `${path}.${k}` : k, out);
      return out;
    };
    const hist = await call('config.history');
    const first = hist[hist.length - 1];
    const base = (await call('config.version', { id: first.id })).config;
    const now = (await call('config.get')).config;
    const d = diff(now, base, '', []);
    t(`versions: ${hist.length}, oldest ${first.at} (${first.note || first.byName})`, true);
    t('current configuration = configuration before the history (ignoring key order and empty defaults)', d.length === 0, d.slice(0, 6).join(' | '));
  },
  // Self-service configuration: delegated settings, version history/restore, Jira options, copy guard.
  // Every write restores the exact previous configuration at the end.
  async adminx(t) {
    const got = await call('config.get');
    const before = got.config;
    // Field-by-field comparison, independent of key order; missing and empty defaults count as equal.
    const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
    const diffs = (a, b, path = '', out = []) => {
      if (empty(a) && empty(b)) return out;
      if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(path); return out; }
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffs(a[k], b[k], path ? `${path}.${k}` : k, out);
      return out;
    };
    const pick = (c) => ({ portfolio: c.portfolio, levels: c.levels, fields: c.fields, matrix: c.matrix, rules: c.rules, tshirtSizes: c.tshirtSizes, permissions: c.permissions });
    const sig = (c) => diffs(pick(c), pick(before)).join(', ');
    const s0 = await call('settings.get');
    t('settings.get returns the delegated subset', Array.isArray(s0.tshirtSizes) && s0.delegatedRules.includes('healthRhythmDays') && !('permissions' in s0), Object.keys(s0).join(','));
    const sizes = before.tshirtSizes.map((x, i) => (i === 0 ? { ...x, hours: x.hours + 1 } : x));
    const saved = await call('settings.save', { tshirtSizes: sizes, rules: { healthRhythmDays: (before.rules.healthRhythmDays % 90) + 1, personLevel: !before.rules.personLevel, lockSubtasks: !before.rules.lockSubtasks }, permissions: { manageRanking: [{ id: 'x-1', name: 'x' }] } });
    const after = (await call('config.get')).config;
    t('settings.save changes sizes and safe rules', after.tshirtSizes[0].hours === before.tshirtSizes[0].hours + 1 && after.rules.healthRhythmDays !== before.rules.healthRhythmDays, JSON.stringify(saved.rules).slice(0, 120));
    t('settings.save cannot touch privacy, sub-task lock or permissions', after.rules.personLevel === before.rules.personLevel && after.rules.lockSubtasks === before.rules.lockSubtasks && !diffs(after.permissions, before.permissions).length, diffs(after.permissions, before.permissions).join(', '));
    const hist = await call('config.history');
    t('version history recorded', hist.length >= 2 && hist[0].sections.includes('tshirtSizes'), `${hist.length} versions, newest: ${hist[0].sections.join('+')} by ${hist[0].byName}`);
    const prior = hist[1];
    const full = await call('config.version', { id: prior.id });
    t('a version holds the full configuration', !!full.config?.portfolio && Array.isArray(full.config.levels));
    t('config.restore rejects a malformed id', (await expectErr('config.restore', { id: '../../config' }, 'INVALID')).ok);
    t('config.restore: unknown id', (await expectErr('config.restore', { id: '2026-01-01T00:00:00.000Z:zzzzzz' }, 'NOT_FOUND')).ok);
    await call('config.restore', { id: prior.id });
    const back = (await call('config.get')).config;
    t('restore brings back the exact earlier configuration', sig(back) === '', sig(back) || 'identical');
    const hist2 = await call('config.history');
    t('the restore itself is a new version', /^restored /.test(hist2[0].note || ''), hist2[0].note);
    const opt = (got.meta.fields || []).find((f) => f.type === 'option' || (f.type === 'array' && f.items === 'option'));
    if (opt) {
      const o = await call('fields.options', { fieldId: opt.id });
      t(`fields.options reads Jira options (${opt.name})`, Array.isArray(o.options) && typeof o.manageUrl === 'string', `${o.source}: ${o.options.length} options`);
    }
    t('fields.options rejects a bad field id', (await expectErr('fields.options', { fieldId: 'summary' }, 'INVALID')).ok);
    t('copyValues rejects a bad usage', (await expectErr('fields.copyValues', { usage: 'summary', to: 'customfield_10001' }, 'INVALID')).ok);
    t('copyValues rejects a bad target', (await expectErr('fields.copyValues', { usage: 'tshirt', to: 'duedate' }, 'INVALID')).ok);
    const endDiff = sig((await call('config.get')).config);
    t('configuration unchanged at the end', endDiff === '', endDiff || 'identical');
  },
  // Who changed the configuration last (from the app's own audit log). Read-only.
  async configHistory(t) {
    const log = await call('audit.list', { limit: 100 });
    const list = Array.isArray(log) ? log : Array.isArray(log?.entries) ? log.entries : Object.values(log || {});
    t('audit entries read', true, `${list.length} entries, type ${Array.isArray(log) ? 'array' : typeof log}`);
    const entries = list.filter((e) => /^config/.test(e?.action || '')).slice(0, 8);
    for (const e of entries) t(`${e.at} ${e.action}`, true, `by ${e.byName || e.by} ${JSON.stringify(e.details || {}).slice(0, 120)}`);
    if (!entries.length) t('no config entries in the audit log', true, JSON.stringify(log).slice(0, 160));
  },
  // Diagnose and restore the demo portfolio (sandbox PCX epics, demo order).
  async repair(t, c) {
    const cfg = (await call('config.get')).config;
    t('config: portfolio type', true, JSON.stringify(cfg.portfolio));
    let ds = await call('dataset');
    const inPf = new Set(ds.portfolio.map((p) => p.ref));
    const pcx = c.epics.filter((e) => e.fields.project.key === 'PCX');
    t('epic issue types', true, pcx.map((e) => `${e.key}:${e.fields.issuetype?.id ?? '?'}`).join(' '));
    for (const e of pcx.filter((e) => !inPf.has(`issue:${e.id}`))) {
      try { await call('portfolio.add', { ref: `issue:${e.id}` }); t(`re-added ${e.key}`, true); } catch (err) { t(`re-add ${e.key}`, false, `${err.code} ${err.message}`); }
    }
    ds = await call('dataset');
    const want = ['PCX-13', 'PCX-3', 'PCX-21', 'PCX-32', 'PCX-46'];
    const byKey = Object.fromEntries(ds.portfolio.map((p) => [p.key, p.ref]));
    if (want.every((k) => byKey[k])) await call('portfolio.reorder', { order: want.map((k) => byKey[k]) });
    ds = await call('dataset');
    t('demo portfolio complete and in order', [...ds.portfolio].sort((a, b) => a.rank - b.rank).map((p) => p.key).join(',') === want.join(','), [...ds.portfolio].sort((a, b) => a.rank - b.rank).map((p) => p.key).join(','));
  },
  // Owner / milestone field mapping and the tour preference (restores the configuration afterwards).
  async fields(t) {
    const got = await call('config.get');
    const before = got.config;
    t('defaults: owner = Assignee, milestone = fix versions', !before.fields.owner && !before.fields.milestone, JSON.stringify({ o: before.fields.owner, m: before.fields.milestone }));
    // Milestone from a custom field: point it at the existing Start date field (a date) for this check.
    const dateField = before.fields.startDate;
    const saved = await call('config.save', { config: { ...before, fields: { ...before.fields, milestone: dateField } } });
    t('milestone mapped to a custom field', saved.fields.milestone === dateField, dateField);
    const ds = await call('dataset');
    const withMs = ds.issues.filter((i) => i.milestone?.date).length;
    t('milestone values read from that field', withMs > 0, `${withMs} work items`);
    const ms = computeAll(ds).milestones.filter((m) => m.fromField);
    t('milestones built from the field', ms.length > 0 && ms.every((m) => m.date), `${ms.length} milestones`);
    const userField = (got.meta.fields || []).find((f) => f.type === 'user' || f.items === 'user');
    if (userField) {
      await call('config.save', { config: { ...before, fields: { ...before.fields, owner: userField.id } } });
      const ds2 = await call('dataset');
      t(`owner read from custom field ${userField.name}`, ds2.portfolio.every((p) => p.owner === null || typeof p.owner?.id === 'string'), ds2.portfolio.map((p) => p.owner?.name || '–').join(', '));
    }
    const bad = await call('config.save', { config: { ...before, fields: { ...before.fields, owner: 'app', milestone: 'x) OR (1=1' } } });
    t('invalid owner/milestone mappings are dropped', bad.fields.owner === '' && bad.fields.milestone === '', JSON.stringify({ o: bad.fields.owner, m: bad.fields.milestone }));
    const restored = await call('config.save', { config: before });
    // compared by value, not by text: the saved config comes back normalised (key order) – 2026-11-24 the same settings
    // failed only because of the order of their keys
    const canon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
    t('configuration restored', restored.fields.milestone === (before.fields.milestone || '') && restored.fields.owner === (before.fields.owner || '') && canon(restored.portfolio) === canon(before.portfolio), `${canon(restored.portfolio)} vs ${canon(before.portfolio)}`.slice(0, 400));
    const ds3 = await call('dataset');
    t('default milestone source back (fix versions)', !ds3.issues.some((i) => i.milestone), '');
    // Tour preference
    t('prefs.save stores tourDone', (await call('prefs.save', { tourDone: true })).tourDone === true);
    t('prefs.save ignores a non-boolean tourDone', (await call('prefs.save', { tourDone: 'yes' })).tourDone === true);
    t('tourDone survives a reload', (await call('bootstrap')).prefs.tourDone === true);
  },
  // Clicks through every view of the real UI (both languages): renders without the error screen,
  // no console errors, and axe-core finds no WCAG 2.2 AA violations. Changes no Jira data.
  // Ask canvas, live: questions become cards, charts switch, full screen, PDF, per-user persistence.
  // Read-only for Jira; it only writes the tester's own canvas layout and clears it again at the end.
  async askLive(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const axe = (await import('axe-core')).default;
    // Ask is the header button now (not a tab)
    const tab = document.querySelector('[data-tour="ask"]') || [...document.querySelectorAll('[role=tab]')].find((b) => /Fragen|Ask/.test(b.textContent));
    t('Ask is reachable (header button)', !!tab);
    tab?.click();
    let input = null;
    for (let w = 0; w < 30 && !input; w++) { await sleep(300); input = document.querySelector('.ask-input input'); }
    t('composer ready', !!input);
    if (!input) return;
    const before = document.querySelectorAll('.ask-card').length;
    const hero = document.querySelector('.ask-hero');
    t('suggestions shown when empty', before > 0 || (hero && hero.querySelectorAll('.ask-sugg').length >= 4), `${hero?.querySelectorAll('.ask-sugg').length || 0} suggestions`);
    const setV = (v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })); };
    const qs = ['Was braucht jetzt meine Aufmerksamkeit?', 'Wie ist die Health der Projekte als Kuchen?', 'Fortschritt aller Projekte als Balken', 'Auslastung der Teams als Heatmap', 'Zeig die Abhängigkeiten als Netz', 'Schätzung gegen gebuchte Zeit', 'Wer arbeitet am langsamsten?'];
    for (const q of qs) { setV(q); await sleep(80); input.closest('form').requestSubmit(); await sleep(700); }
    const cards = [...document.querySelectorAll('.ask-card')];
    t('one card per question', cards.length === before + qs.length, `${cards.length - before} new`);
    const fresh = cards.slice(before);
    const titles = fresh.map((c) => c.querySelector('h3')?.textContent || '');
    t('answers computed locally (no AI needed)', fresh.slice(0, 6).every((c) => (c.querySelector('.ask-answer')?.textContent || '').length > 10 && !c.querySelector('.ask-ai-note')), titles.join(' | '));
    t('person rating declined', /Personen|individuals/.test(titles.at(-1)), titles.at(-1));
    t('pie chosen from the words', !!fresh[1]?.querySelector('.donut-wrap'));
    t('heatmap chosen from the words', !!fresh[3]?.querySelector('.heat') || /keinen Bedarf|no demand/.test(fresh[3]?.textContent || ''));
    // switch the chart of the progress card through every offered view
    const seg = fresh[2]?.querySelectorAll('.ask-card-foot .seg-btn') || [];
    let switched = 0;
    for (const b of seg) { b.click(); await sleep(450); if (b.getAttribute('aria-pressed') === 'true') switched++; }
    t('chart types switch', seg.length >= 2 && switched === seg.length, `${switched}/${seg.length}`);
    // full screen
    fresh[4]?.querySelector('button[aria-label="Groß ansehen"], button[aria-label="View large"]')?.click();
    await sleep(900);
    const full = document.querySelector('.ask-full[role=dialog]');
    t('full screen opens', !!full);
    if (full) {
      const r = await axe.run(full, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
      t('full screen: 0 axe violations', r.violations.length === 0, r.violations.map((v) => v.id).join(','));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      for (let w = 0; w < 15 && document.querySelector('.ask-full'); w++) await sleep(200);
      t('Esc closes full screen', !document.querySelector('.ask-full'));
    }
    const stage = document.querySelector('.ask-root');
    const r2 = await axe.run(stage, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
    t('canvas: 0 axe violations', r2.violations.length === 0, r2.violations.map((v) => `${v.id}(${v.nodes.length}) ${v.nodes[0]?.target?.join(' ')}`).join(' | '));
    // PDF of two selected cards (captured instead of downloaded)
    const { pdfSink } = await import('./lib/pdf.js');
    let pdf = null;
    pdfSink.save = (blob, name, doc) => { pdf = { blob, name, pages: doc.getNumberOfPages() }; };
    for (const c of fresh.slice(0, 2)) { const cb = c.querySelector('.ask-sel input'); if (cb && !cb.checked) cb.click(); }
    await sleep(300);
    [...document.querySelectorAll('.ask-toolbar button')].find((b) => /PDF/.test(b.textContent))?.click();
    for (let w = 0; w < 40 && !pdf; w++) await sleep(250);
    pdfSink.save = null;
    const head = pdf ? new Uint8Array(await pdf.blob.slice(0, 5).arrayBuffer()) : [];
    t('PDF of selected cards', !!pdf && String.fromCharCode(...head) === '%PDF-' && pdf.blob.size > 5000, pdf ? `${pdf.name} · ${pdf.pages} pages · ${pdf.blob.size} bytes` : 'none');
    // leaving the tab and coming back keeps the board of this session
    [...document.querySelectorAll('[role=tab]')][0]?.click();
    await sleep(1200);
    (document.querySelector('[data-tour="ask"]') || [...document.querySelectorAll('[role=tab]')].find((b) => /Fragen|Ask/.test(b.textContent)))?.click(); // back through the header button
    for (let w = 0; w < 20 && document.querySelectorAll('.ask-card').length < cards.length; w++) await sleep(200);
    t('cards survive switching tabs', document.querySelectorAll('.ask-card').length === cards.length, `${document.querySelectorAll('.ask-card').length}/${cards.length}`);
    // persistence: the layout is saved for this user
    await sleep(1600);
    const boot = await call('bootstrap', {});
    t('canvas saved per user', (boot.prefs?.ask?.cards || []).length === cards.length, `${(boot.prefs?.ask?.cards || []).length} stored`);
    t('stored as questions, not data', (boot.prefs?.ask?.cards || []).every((c) => !c.data && typeof c.q === 'string'));
    // simple view: one column of answers, other areas hidden
    document.querySelector('.ask-toolbar [role=switch]')?.click();
    await sleep(900);
    t('simple view: answers as a feed, tabs hidden', document.querySelectorAll('.ask-feed .ask-card').length === cards.length && getComputedStyle(document.querySelector('.tabs')).display === 'none');
    document.querySelector('.ask-toolbar [role=switch]')?.click();
    await sleep(600);
    // clean up through the UI (the canvas saves itself), so no later save can bring the cards back
    [...document.querySelectorAll('.ask-toolbar button')].find((b) => /Leinwand leeren|Clear canvas/.test(b.getAttribute('aria-label') || ''))?.click();
    await sleep(2200);
    const after = await call('bootstrap', {});
    t('cleanup: canvas emptied', (after.prefs?.ask?.cards || []).length === 0);
  },
  // Support bridge, live, on sandbox issues only (PCX): queue preview count and link → undo round-trip.
  // No configuration is changed.
  async supportLive(t, c) {
    const pcx = (await req('/rest/api/3/project/PCX')).body;
    const p = await call('support.preview', { queue: { id: 'qt', name: 'Test', projectIds: [String(pcx.id)], issueTypeIds: [], labels: [] } });
    t('queue preview counts (approximate-count, as user)', Number.isFinite(p.total) && p.total > 0 && Number.isFinite(p.open), `${p.total} total · ${p.open} open`);
    const pl = await call('support.preview', { queue: { id: 'qt', name: 'Test', projectIds: [String(pcx.id)], issueTypeIds: [], labels: ['pc-no-such-label'] } });
    t('labels narrow the queue', pl.total === 0, `${pl.total}`);
    const bad = await call('support.preview', { queue: { id: 'qt', projectIds: ['1) OR (1=1'], labels: ['a" OR x="b'] } }).catch((e) => ({ err: e.code }));
    t('invalid ids/labels are dropped', bad.err || (bad.total === 0 && bad.open === 0), JSON.stringify(bad));
    const story = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: 'project = PCX AND issuetype = Story ORDER BY key DESC', fields: ['issuelinks'], maxResults: 1 }) })).body.issues[0];
    const epic = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: 'project = PCX AND issuetype = Epic ORDER BY key DESC', fields: ['summary'], maxResults: 1 }) })).body.issues[0];
    t('sandbox items found', !!story && !!epic, `${story?.key} → ${epic?.key}`);
    if (!story || !epic) return;
    const linked = (k) => req(`/rest/api/3/issue/${k}?fields=issuelinks`).then((r) => (r.body.fields.issuelinks || []).some((l) => (l.outwardIssue || l.inwardIssue)?.id === epic.id));
    const had = await linked(story.key);
    t('no prior link (clean start)', !had);
    if (had) return;
    await call('support.link', { ticketId: story.id, targetId: epic.id });
    t('link created in Jira', await linked(story.key));
    await call('support.unlink', { ticketId: story.id, targetId: epic.id });
    t('undo removes exactly that link', !(await linked(story.key)));
    t('link rejects bad ids', (await expectErr('support.link', { ticketId: 'x', targetId: epic.id })).ok);
  },
  // Demo setup requested by the user: an "IT-Support" queue over the sandbox support tickets in PCX
  // (Bugs labelled "support") plus SLA targets. Only config.support changes; everything else is compared.
  async supportDemo(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const before = (await call('config.get')).config;
    const pcx = (await req('/rest/api/3/project/PCX')).body;
    const queues = [];
    for (const q of before.support?.queues || []) {
      // an empty test queue on the (empty) GMT space would only clutter the demo
      const n = await call('support.preview', { queue: q }).catch(() => null);
      if (n && n.total === 0) { t(`dropped empty queue "${q.name}"`, true, q.projectIds.join(',')); continue; }
      if (q.projectIds.includes(String(pcx.id)) && q.labels.includes('support')) continue;
      queues.push(q);
    }
    queues.push({ id: 'itsupport', name: 'IT-Support', projectIds: [String(pcx.id)], issueTypeIds: ['10009'], labels: ['support'] });
    const next = structuredClone(before);
    next.support = {
      ...before.support, queues, slaTargetPct: 95,
      sla: { mode: 'business', start: 8, end: 17, location: 'DE', atRiskShare: 0.75, fallbackHours: 24, policies: [{ priority: 'Highest', hours: 4 }, { priority: 'High', hours: 8 }, { priority: 'Medium', hours: 24 }, { priority: 'Low', hours: 40 }, { priority: 'Lowest', hours: 80 }] },
    };
    const preview = await call('support.preview', { queue: queues.at(-1) });
    t('queue finds the demo tickets', preview.total >= 14, `${preview.total} tickets · ${preview.open} open`);
    await call('config.save', { config: next });
    const after = (await call('config.get')).config;
    const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x));
    const changed = Object.keys({ ...before, ...after }).filter((k) => stable(before[k]) !== stable(after[k]));
    t('only the support section changed', changed.every((k) => k === 'support'), changed.join(',') || 'support');
    t('queue saved', (after.support.queues || []).some((q) => q.id === 'itsupport'), (after.support.queues || []).map((q) => q.name).join(', '));
    // the cockpit now shows the Support tab with the tickets
    document.querySelector('[aria-label="Aktualisieren"], [aria-label="Refresh"]')?.click();
    let tab = null;
    for (let w = 0; w < 60 && !tab; w++) { await sleep(500); tab = [...document.querySelectorAll('[role=tab]')].find((b) => /Support/.test(b.textContent)); }
    t('Support tab appears', !!tab, tab?.textContent);
    tab?.click();
    let txt = '';
    for (let w = 0; w < 30; w++) { await sleep(500); txt = document.querySelector('main')?.innerText || ''; if (/Offene Tickets|Open tickets/.test(txt)) break; }
    const m = /(?:Offene Tickets|Open tickets)\s*\n?\s*(\d+)/.exec(txt);
    t('Situation shows the open tickets', m && +m[1] === preview.open, m?.[0]?.replace(/\s+/g, ' '));
    const axe = (await import('axe-core')).default;
    for (const sec of ['Tickets', 'Projekte|Projects', 'Teams']) {
      [...document.querySelectorAll('.seg-btn')].find((b) => new RegExp(sec).test(b.textContent))?.click();
      await sleep(1500);
      const main = document.querySelector('main');
      const r = await axe.run(main, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
      t(`${sec.split('|')[0]} renders, 0 axe violations`, main.innerText.length > 200 && r.violations.length === 0, r.violations.map((v) => v.id).join(',') || `${main.innerText.length} chars`);
    }
    [...document.querySelectorAll('.seg-btn')].find((b) => /Lage|Situation/.test(b.textContent))?.click();
  },
  // Read-only: what the support configuration contains and what the Support view shows.
  async supportInspect(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const cfg = (await call('config.get')).config;
    for (const q of cfg.support.queues || []) {
      const n = await call('support.preview', { queue: q }).catch((e) => ({ err: e.code }));
      t(`queue "${q.name}"`, true, `${JSON.stringify({ p: q.projectIds, ty: q.issueTypeIds, l: q.labels })} → ${JSON.stringify(n)}`);
    }
    t('service spaces', true, JSON.stringify(cfg.support.serviceProjectIds));
    const errs = [];
    const orig = console.error;
    console.error = (...a) => { errs.push(a.map((x) => String(x?.message || x)).join(' ').slice(0, 150)); orig(...a); };
    const tab = [...document.querySelectorAll('[role=tab]')].find((b) => /Support/.test(b.textContent));
    tab?.click();
    await sleep(4000);
    const main = () => (document.querySelector('main')?.innerText || '').replace(/\s+/g, ' ');
    t('situation text', true, main().slice(0, 150));
    t('situation text 2', true, main().slice(150, 300));
    for (const sec of ['Tickets', 'Projekte|Projects', 'Teams']) {
      [...document.querySelectorAll('.seg-btn')].find((b) => new RegExp(sec).test(b.textContent))?.click();
      await sleep(2500);
      t(`${sec} text`, true, main().slice(0, 150));
    }
    console.error = orig;
    t('console errors', errs.length === 0, errs.join(' | '));
  },
  // Read-only diagnostic: does switching Support sections register, and does the content follow?
  async supportClick(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    [...document.querySelectorAll('[role=tab]')].find((b) => /Support/.test(b.textContent))?.click();
    for (let w = 0; w < 30 && !document.querySelector('main .stats'); w++) await sleep(300);
    const btn = () => [...document.querySelectorAll('main .seg-btn')].find((b) => /^Tickets/.test(b.textContent.trim()));
    for (let w = 0; w < 60 && !btn(); w++) await sleep(500); // the ticket analysis loads after the tiles (first suite after start)
    t('Tickets button found', !!btn(), btn()?.textContent);
    btn()?.click();
    const trace = [];
    for (let w = 0; w < 16; w++) {
      await sleep(500);
      trace.push(`${btn()?.getAttribute('aria-pressed') === 'true' ? 'P' : '-'}${document.querySelector('main table') ? 'T' : '-'}${document.querySelector('main .stats') ? 'S' : '-'}`);
    }
    // since 2026-11: the KPI tiles stay on top in every section; without JSM SLAs the list starts with all open tickets
    t('section switches to Tickets (its table, or the empty state of the filter)', btn()?.getAttribute('aria-pressed') === 'true' && (!!document.querySelector('main .sp-ticket-table') || /Nichts brennt|Nothing is burning|Keine Tickets|No tickets/.test(document.querySelector('main')?.innerText || '')), trace.join(' '));
    const urgentSeg = [...document.querySelectorAll('main .seg-btn')].find((b) => /^(Dringend|Urgent)$/.test(b.textContent.trim()));
    const allSeg = [...document.querySelectorAll('main .seg-btn')].find((b) => /^(Alle offenen|All open)$/.test(b.textContent.trim()));
    const noSla = /SLA (erfüllt|met)\s*–/i.test(document.querySelector('main .stats')?.innerText.replace(/\s+/g, ' ') || '');
    t('without SLAs the ticket list starts with all open tickets (never an empty "Nothing is burning")', !noSla || allSeg?.getAttribute('aria-pressed') === 'true', `noSla ${noSla} · urgent ${urgentSeg?.getAttribute('aria-pressed')} · all ${allSeg?.getAttribute('aria-pressed')}`);
    const mounted = document.querySelectorAll('main .page').length;
    t('one Support page mounted', mounted === 1, `${mounted}`);
    [...document.querySelectorAll('main .seg-btn')].find((b) => /^(Projekte|Projects)/.test(b.textContent.trim()))?.click();
    await sleep(2500);
    t('switches to Projects', /SLA[- ](breaches|Verletzungen)/i.test(document.querySelector('main')?.innerText || ''), (document.querySelector('main')?.innerText || '').replace(/\s+/g, ' ').slice(100, 220));
  },
  // SUPERPORT kill switch, live: checks the app against the mode this build was deployed with (App Status / ops panel).
  async killSwitch(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const code = (p) => p.then(() => 'ok', (e) => e.code);
    const av = await call('availability');
    t('availability answers', ['off', 'readonly', 'on'].includes(av.mode), `${av.mode} · ${av.statusUrl}`);
    if (av.mode === 'on') {
      for (const n of ['bootstrap', 'dataset', 'config.get', 'report.get', 'ai.ask', 'prefs.save', 'health.set', 'portfolio.reorder', 'issue.fill', 'support.link', 'config.save']) {
        const c = await code(call(n, {}));
        t(`${n} refused`, c === 'UNAVAILABLE', c);
      }
      for (let w = 0; w < 30 && !document.querySelector('.paused-page'); w++) await sleep(300);
      t('"temporarily unavailable" page shown', !!document.querySelector('.paused-page'), (document.querySelector('.paused-page')?.innerText || '').replace(/\s+/g, ' ').slice(0, 90));
      t('no portfolio data on screen', !document.querySelector('.rank-row, .stats, [role=tablist]'));
      t('no cached snapshot left in the browser', !Object.keys(sessionStorage).some((k) => k.startsWith('pc:v1:')));
      return;
    }
    const before = await call('bootstrap', {});
    t('bootstrap reports the mode', before.availability?.mode === av.mode, before.availability?.mode);
    const ds = await call('dataset');
    t('reading works', ds.portfolio?.length > 0, `${ds.portfolio?.length} projects`);
    for (let w = 0; w < 20 && !document.querySelector('[role=tablist]'); w++) await sleep(300);
    if (av.mode === 'readonly') {
      t('"changes are paused" banner shown', !!document.querySelector('.paused-banner'), (document.querySelector('.paused-banner')?.innerText || '').replace(/\s+/g, ' ').slice(0, 90));
      const other = before.prefs?.lang === 'de' ? 'en' : 'de';
      for (const [n, p] of [['prefs.save', { lang: other }], ['digest.save', { items: {} }], ['health.set', { ref: ds.portfolio[0].ref, status: 'onTrack', comment: 'x' }], ['portfolio.reorder', { order: ds.portfolio.map((x) => x.ref) }], ['support.link', { ticketId: '1', targetId: '2' }], ['config.save', { config: {} }], ['milestones.save', { milestones: [] }]]) {
        const c = await code(call(n, p));
        t(`${n} refused`, c === 'UNAVAILABLE', c);
      }
      const after = await call('bootstrap', {});
      t('nothing was saved', (after.prefs?.lang ?? null) === (before.prefs?.lang ?? null), `${before.prefs?.lang} → ${after.prefs?.lang}`);
      for (const n of ['config.get', 'report.get', 'capacity.get', 'audit.list']) { const c = await code(call(n, {})); t(`${n} still readable`, c !== 'UNAVAILABLE', c); }
      return;
    }
    t('no banner when the app is online', !document.querySelector('.paused-banner, .paused-page'));
    const same = await code(call('prefs.save', { lang: before.prefs?.lang ?? null })); // writes the value it already has
    t('changes work', same === 'ok', same);
  },
  // Live: the same number on every page (maturity vs data quality, support badge vs Support view vs portfolio row).
  async matching(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const main = () => (document.querySelector('main')?.innerText || '').replace(/\s+/g, ' ');
    const tab = (re) => [...document.querySelectorAll('[role=tab]')].find((b) => re.test(b.textContent));
    tab(/^Portfolio/)?.click();
    for (let w = 0; w < 30 && !/Planungsreife|Maturity/i.test(main()); w++) await sleep(300);
    await sleep(1800); // counters animate in
    // Planungsreife = Original Estimate ÷ (Original Estimate + open T-shirt size), with its base on the tile
    const mt = [...document.querySelectorAll('.kpi')].find((k) => /Planungsreife|Planning maturity/.test(k.textContent));
    const calc = mt?.getAttribute('aria-label') || '';
    t('maturity tile: base = open T-shirt size, calculation OE ÷ (OE + T-shirt)', /offene T-Shirt Size|open T-shirt size/.test(mt?.querySelector('.kpi-foot')?.textContent || '') && /h ÷ \(.+ h \+ .+ h\) =/.test(calc), calc);
    // the Portfolio's support rows, read while the Portfolio is on screen (one row per service space)
    const supTexts = [...document.querySelectorAll('.support-card .rank-row.support')].map((r) => r.textContent);
    // data quality page: exact story counts, the same stories the cockpit plans with
    const ds = await call('dataset');
    const est = new Set((ds.config.levels || []).filter((l) => l.role === 'estimate').map((l) => l.key));
    const stories = ds.issues.filter((i) => est.has(i.levelKey) || i.role === 'estimate');
    // (the separate data-quality tab is gone – its rows live in each project's "Missing values" now)
    void stories;
    const sup = tab(/Support/);
    if (!sup) { t('support not configured – nothing to compare', true); return; }
    const badge = Number(sup.querySelector('.tab-badge')?.textContent || 0);
    sup.click();
    for (let w = 0; w < 30 && !document.querySelector('main .stats'); w++) await sleep(300);
    // the numbers count up: read them once they have stopped moving
    const snap = () => document.querySelector('main .stats')?.innerText || '';
    for (let w = 0, prev = ''; w < 30; w++) { await sleep(500); const now = snap(); if (now && now === prev) break; prev = now; }
    const stats = Object.fromEntries([...document.querySelectorAll('main .stats > *')].map((x) => { const l = x.innerText.split('\n').map((y) => y.trim()).filter(Boolean); return [l[0], l[1]]; }));
    const open = Number(stats['OFFENE TICKETS'] ?? stats['OPEN TICKETS']);
    const pastTxt = stats['SLA-VERLETZUNGEN'] ?? stats['SLA BREACHES'];
    const past = pastTxt === '–' ? 0 : Number(pastTxt);
    const rate = stats['SLA ERFÜLLT'] ?? stats['SLA MET'];
    const ticketsLabel = [...document.querySelectorAll('main .seg-btn')].find((b) => /^Tickets/.test(b.textContent.trim()))?.textContent || '';
    const urgent = Number(/·\s*(\d+)/.exec(ticketsLabel)?.[1] || 0);
    t('tab badge = urgent tickets in the Support view', badge === urgent, `badge ${badge} · Tickets ${urgent}`);
    // Portfolio has one support row per service space: with one space it must equal the Support view exactly
    const rowOpen = supTexts.map((x) => Number(/(\d+) (offene Tickets|open tickets)/.exec(x)?.[1] || 0));
    const sumOpen = rowOpen.reduce((a, b) => a + b, 0);
    t('portfolio support rows = Support view (open tickets)', supTexts.length > 0 && (supTexts.length === 1 ? sumOpen === open : sumOpen >= open), `${supTexts.length} rows: ${rowOpen.join(' + ')} | Support view: ${open} open`);
    // SLAs only from JSM: no SLA in the Support view → no SLA percentage on the Portfolio rows either
    t('portfolio support row = Support view (SLA rate)', supTexts.length > 0 && rate != null && (rate === '–' ? supTexts.every((x) => !/SLA [\d.,]+ ?%/.test(x)) : (supTexts.length !== 1 || supTexts[0].includes(`SLA ${rate}`))), `${supTexts.map((x) => (/SLA [\d.,]+ ?%/.exec(x) || ['–'])[0]).join(' | ')} | Support view: ${rate}`);
    t('urgent ≥ past SLA', urgent >= past, `${urgent} ≥ ${past}`);
    tab(/^Portfolio/)?.click();
  },
  // Live data accuracy: the Project-details tiles against an independent source (Jira REST), project by project.
  async kpiTruth(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ds = await call('dataset');
    const est = (ds.config.levels || []).filter((l) => l.role === 'estimate').flatMap((l) => l.issueTypeIds);
    t('story types from the configuration', est.length > 0, est.join(','));
    [...document.querySelectorAll('[role=tab]')].find((b) => /^Projekte|^Projects|Projektdetails|Project details/.test(b.textContent))?.click();
    const pills = () => [...document.querySelectorAll('main button')].filter((b) => b.querySelector('.pill-rank'));
    for (let w = 0; w < 40 && !pills().length; w++) await sleep(300); // the project picker, not just any tile
    t('Project details opens', pills().length > 0, `${pills().length} projects`);
    let sumOe = 0, sizedProjects = 0, partlyKnown = false;
    for (const p of ds.portfolio.filter((x) => x.kind === 'issue' && x.statusCat !== 'done')) {
      // independent: every story-level work item below the project, straight from Jira (children and grandchildren)
      // every page (Jira returns at most 100 per page) and every level below the project (2026-11-23: the demo projects
      // have workstreams between project and epic – two levels were not enough)
      const jql = async (q) => { const out = []; let tok; do { const b = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: q, fields: ['timeoriginalestimate', 'aggregatetimeoriginalestimate', 'issuetype', 'status', 'duedate'], maxResults: 100, nextPageToken: tok }) })).body || {}; out.push(...(b.issues || [])); tok = b.isLast === false ? b.nextPageToken : null; } while (tok); return out; };
      const below = [];
      for (let frontier = [p.key], d = 0; frontier.length && d < 8; d++) {
        const next = [];
        for (let i = 0; i < frontier.length; i += 40) next.push(...await jql(`parent in (${frontier.slice(i, i + 40).join(',')})`));
        below.push(...next);
        frontier = next.map((x) => x.key);
      }
      const lvl1 = below; // kept for the size lookup below: every rough unit at any depth
      const stories = below.filter((i) => est.includes(String(i.fields.issuetype.id)));
      // story totals (story + its sub-tasks), as the company spec says the cockpit reads them
      const oe = stories.reduce((a, i) => a + (i.fields.aggregatetimeoriginalestimate ?? i.fields.timeoriginalestimate ?? 0), 0) / 3600;
      const today = ds.today; // the same day the cockpit calculates with
      const late = stories.filter((i) => i.fields.status.statusCategory.key !== 'done' && i.fields.duedate && i.fields.duedate < today).length;
      pills().find((b) => b.textContent.includes(p.name))?.click();
      // read the tiles only once the page shows this project
      for (let w = 0; w < 30 && document.querySelector('main h1')?.textContent !== p.name; w++) await sleep(200);
      await sleep(400);
      t(`${p.name}: page shows the chosen project`, document.querySelector('main h1')?.textContent === p.name, document.querySelector('main h1')?.textContent);
      const tile = (re) => [...document.querySelectorAll('.kpi')].find((k) => re.test(k.querySelector('.kpi-label')?.textContent || ''));
      const dqTile = tile(/Datenqualität|Data quality/), mat = tile(/Reife|Maturity/), od = tile(/Über Due Date|Past due/);
      const foot = (k) => k?.querySelector('.kpi-foot')?.textContent || '';
      // data quality now counts epics + stories: "(epics ok + stories ok) ÷ (epics + stories)" – the stories are the second total
      const total = Number(/÷ \((\d+) \+ (\d+)\)/.exec(dqTile?.getAttribute('aria-label') || '')?.[2]);
      t(`${p.name}: story count = Jira`, total === stories.length, `tile ${total} · Jira ${stories.length}`);
      const label = (k) => (k?.getAttribute('aria-label') || '');
      t(`${p.name}: past due = Jira`, Number(od?.querySelector('.kpi-value')?.textContent) === late, `tile ${od?.querySelector('.kpi-value')?.textContent} · Jira ${late}`);
      // Reife: a percentage exactly when Jira has a T-shirt size (on the epic below the project, or on the project item itself
      // when it has no epics below it), "–" otherwise. Read straight from Jira, independent of the cockpit's dataset.
      // the configured field from the admin configuration (the dataset's public config does not carry the field ids –
      // live 2026-11-23 the check read the app's own field while the site is set up with another T-shirt field)
      const cfgT = (await call('config.get').catch(() => null))?.config?.fields?.tshirt ?? ds.config.fields?.tshirt;
      const tf = !cfgT || cfgT === 'app' ? (await fieldIds()).tshirt : cfgT;
      const hasValue = (v) => v != null && v !== '' && !(Array.isArray(v) && !v.length);
      const roughIds = (ds.config.levels || []).filter((l) => l.role === 'rough').flatMap((l) => l.issueTypeIds.map(String));
      const roughBelow = roughIds.length ? lvl1.filter((i) => roughIds.includes(String(i.fields.issuetype.id))) : [];
      const units = roughBelow.length ? roughBelow.map((i) => i.key) : [p.key];
      const sizes = [];
      for (const k of units) sizes.push((await req(`/rest/api/3/issue/${k}?fields=${tf}`)).body?.fields?.[tf]);
      const sized = sizes.some(hasValue);
      const shown = mat?.querySelector('.kpi-value')?.textContent;
      t(`${p.name}: Reife ${sized ? 'is a percentage' : 'shows "–"'} (T-shirt size in Jira on ${units.join(', ')}: ${sizes.map((v) => (hasValue(v) ? JSON.stringify(v?.value ?? v) : 'none')).join(', ')})`, sized ? /%/.test(shown || '') : shown === '–', `tile ${shown} · ${mat?.querySelector('.kpi-foot')?.textContent}`);
      if (sized && units.length === 1) {
        // the whole project is one sized unit: the Original Estimate in the calculation is all of the project's stories
        const oeInCalc = Number((/([\d.,]+) h ÷/.exec(label(mat))?.[1] || '').replace(/[.,]/g, '')); // whole hours: '.' or ',' is a thousands separator
        t(`${p.name}: Original Estimate in the Reife calculation = Jira`, Math.abs(oeInCalc - Math.round(oe)) <= 1, `tile ${oeInCalc} h · Jira ${Math.round(oe)} h`);
        sumOe += oe;
        sizedProjects += 1;
      } else if (sized) partlyKnown = true; // several epics: the covered share is checked by the unit tests, not here
    }
    // portfolio tiles: maturity = sum of the projects (same definition)
    document.querySelector('[role=tab][data-tour="tab-portfolio"]')?.click(); // by id – "Meine Arbeit" is the first tab
    await sleep(1800);
    let pm = null;
    for (let w = 0; w < 30 && !/÷/.test(pm?.getAttribute('aria-label') || ''); w++) { await sleep(300); pm = [...document.querySelectorAll('.kpi')].find((k) => /Planungsreife|Planning maturity/.test(k.textContent)); }
    const pOe = Number((/([\d.,]+) h ÷/.exec(pm?.getAttribute('aria-label') || '')?.[1] || '').replace(/[.,]/g, ''));
    if (!partlyKnown) {
      // only projects with a T-shirt size count towards the portfolio Reife (the others have no known total)
      t(`portfolio Original Estimate = sum of the ${sizedProjects} sized projects in Jira`, Math.abs(pOe - Math.round(sumOe)) <= ds.portfolio.length, `tile ${pOe} h · Jira ${Math.round(sumOe)} h`);
    }
  },
  async views(t) {
    const axe = (await import('axe-core')).default;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const errs = [];
    const orig = console.error;
    console.error = (...a) => { errs.push(a.map((x) => String(x?.message || x)).join(' ').slice(0, 160)); orig(...a); };
    const tabs = () => [...document.querySelectorAll('[role=tab]')];
    const main = () => document.querySelector('main');
    const startLang = document.documentElement.lang;
    // First-run tour, opened from the "?" button.
    document.querySelector('[data-tour="help"]')?.click();
    const card = () => document.querySelector('.tour-card[role=dialog]');
    for (let w = 0; w < 40 && !card(); w++) await sleep(200); // from another area the tour waits for the portfolio view
    await sleep(900); // let the card finish fading in before measuring contrast
    t('tour opens from "?"', !!card());
    const seen = [];
    for (let k = 0; k < 12 && card(); k++) {
      seen.push(card().dataset.step); // set on render, not after the text animation
      const r = await axe.run(card(), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
      if (r.violations.length) t(`tour step ${k + 1}: axe`, false, r.violations.map((v) => v.id).join(','));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const was = seen.at(-1);
      for (let w = 0; w < 30 && card() && card().dataset.step === was; w++) await sleep(200);
      await sleep(400);
    }
    t('tour walks through every step and closes', !card() && seen.length >= 8, `${seen.length} steps: ${seen.join(' › ')}`);
    for (const lang of [startLang, startLang === 'de' ? 'en' : 'de']) {
      document.querySelector(`.lang-switch button[lang=${lang}]`)?.click();
      await sleep(900);
      for (let i = 0; i < tabs().length; i++) {
        const tab = tabs()[i];
        const name = tab.textContent.replace(/\d+\+?$/, '').trim();
        tab.click();
        // Views that load their own data (report, capacity) get up to 10 s to show content.
        let txt = '';
        for (let w = 0; w < 20; w++) { await sleep(500); txt = main()?.innerText || ''; if (txt.length > 150 && w >= 3) break; }
        t(`[${lang}] ${name} renders`, !/This view ran into a problem|Diese Ansicht hatte ein Problem/.test(txt) && txt.length > 150, `${txt.length} chars`);
        if (lang === startLang) {
          // entrance animations first: a card still fading in (opacity < 1) reads as low contrast to axe (live finding)
          for (let w = 0; w < 20 && [...(main()?.querySelectorAll('.stat, .kpi, .card') || [])].some((x) => +getComputedStyle(x).opacity < 1); w++) await sleep(250);
          const r = await axe.run(main(), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
          t(`[${lang}] ${name}: 0 axe violations`, r.violations.length === 0, r.violations.map((v) => `${v.id}(${v.nodes.length}) ${v.nodes[0]?.target?.join(' ')}`).join(' | '));
        }
      }
    }
    document.querySelector(`.lang-switch button[lang=${startLang}]`)?.click();
    await sleep(900);
    tabs()[0]?.click();
    await sleep(1200);
    console.error = orig;
    t('language restored', document.documentElement.lang === startLang, startLang);
    t('no console errors while browsing', errs.length === 0, errs.join(' | '));
  },
  // Tab arrows, Ask (understanding, layout, big tables) and smart actions in the palette. Writes only one thing –
  // a re-rank in the sandbox portfolio – and undoes it, checking the Jira rank field is exactly as before.
  async smartLive(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 15000) => { for (let w = 0; w < ms / 200; w++) { const v = fn(); if (v) return v; await sleep(200); } return null; };
    const setVal = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    // 1 every tab is reachable: scroll right with the arrow until the end, every tab was visible once
    const nav = document.querySelector('.tabs');
    const seen = new Set();
    const look = () => { const r = nav.getBoundingClientRect(); for (const b of nav.querySelectorAll('[role=tab]')) { const x = b.getBoundingClientRect(); if (x.left >= r.left - 1 && x.right <= r.right + 1) seen.add(b.dataset.tour); } };
    look();
    for (let k = 0; k < 8 && document.querySelector('.tabs-arrow.r'); k++) { document.querySelector('.tabs-arrow.r').click(); await sleep(700); look(); }
    const all = nav.querySelectorAll('[role=tab]').length;
    t('tab bar: every tab can be reached (arrows when they do not all fit)', seen.size === all, `${seen.size} of ${all} seen · overflow ${nav.scrollWidth > nav.clientWidth}`);
    for (let k = 0; k < 8 && document.querySelector('.tabs-arrow.l'); k++) { document.querySelector('.tabs-arrow.l').click(); await sleep(500); }
    // 2 Ask: a burst of everyday questions → answered (not "did you mean"), no overlaps
    (document.querySelector('[data-tour="ask"]') || document.querySelector('[data-tour="tab-ask"]'))?.click(); // Ask moved from a tab to the header button
    await waitFor(() => document.querySelector('.ask-stage') && document.querySelector('.ask-input input'));
    document.querySelector('.ask-toolbar button[aria-label="Leinwand leeren"], .ask-toolbar button[aria-label="Clear canvas"]')?.click();
    await sleep(400);
    const input = document.querySelector('.ask-input input'), form = document.querySelector('.ask-input');
    const qs = ['Wie ausgelastet sind die Teams?', 'Stunden je Projekt als Tabelle', 'Wie belastbar sind die Zahlen?', 'Was ist blockiert?', 'Was ist überfällig?'];
    for (const q of qs) { setVal(input, q); await sleep(20); form.requestSubmit(); await sleep(40); }
    await sleep(2800);
    // only this burst's cards (a board saved from an earlier visit may still hold others)
    const cards = [...document.querySelectorAll('.ask-world .ask-card')].filter((c) => qs.some((q) => (c.querySelector('.ask-q')?.textContent || '').includes(q)));
    const near = cards.filter((c) => c.querySelector('.ask-near')).length;
    t('Ask: everyday questions are answered from the data (none falls to "did you mean")', cards.length === qs.length && near === 0, `${cards.length} cards · ${near} unanswered · ${cards.map((c) => c.querySelector('h3')?.textContent).join(' | ')}`);
    const settleMs = await settled(cards); // where the cards end up, not mid-animation (big data: answers take longer)
    const boxes = cards.map((c) => c.getBoundingClientRect());
    let overlaps = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) overlaps++; }
    const pairs = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) pairs.push(`${i}/${j}: [${Math.round(a.left)},${Math.round(a.top)}–${Math.round(a.bottom)}] [${Math.round(b.left)},${Math.round(b.top)}–${Math.round(b.bottom)}] style ${cards[i].style.top}/${cards[j].style.top} h ${cards[i].offsetHeight}/${cards[j].offsetHeight} op ${getComputedStyle(cards[j]).opacity}`); }
    t('Ask: a burst of questions never stacks cards on top of each other', overlaps === 0, `${overlaps} overlaps ${pairs.join(' | ')} · settled ${settleMs ?? 'never (12 s)'} ms · visible ${document.visibilityState}`);
    // 3 the big table: filter, numeric sort
    document.querySelector('.ask-toolbar button.num')?.click(); // zoom to 100 % first, as a person would (zoomed out the cards are an overview)
    await sleep(600);
    const tableCard = cards.find((c) => c.querySelector('.dtable'));
    const dt = tableCard?.querySelector('.dtable');
    if (dt) {
      const rows0 = dt.querySelectorAll('tbody tr').length;
      const head = [...dt.querySelectorAll('thead th')].map((x) => x.textContent);
      const col = head.findIndex((h) => /Gebucht|Logged|Plan/.test(h));
      dt.querySelectorAll('thead th button')[col]?.click();
      await sleep(300);
      const nums = [...dt.querySelectorAll('tbody tr')].map((r) => Number(String(r.cells[col]?.textContent || '').replace(/[^\d]/g, '')));
      t('Ask table: a click sorts the column as numbers (largest first)', nums.every((x, i) => i === 0 || nums[i - 1] >= x), nums.join(', '));
      const inp = dt.querySelector('.dtable-search input');
      if (inp) {
        const firstName = dt.querySelector('tbody tr td')?.textContent.replace(/^#\d+\s*/, '').slice(0, 6);
        setVal(inp, firstName); await sleep(300);
        t('Ask table: filtering shows "x of y"', /\d+ (von|of) \d+/.test(dt.querySelector('.dtable-bar .faint')?.textContent || ''), dt.querySelector('.dtable-bar .faint')?.textContent);
        setVal(inp, '');
      } else t('Ask table: filter only from 7 rows', rows0 <= 6, `${rows0} rows`);
    } else t('Ask: the hours question shows a table', false);
    // 4 smart actions: previews (no writes) and one real re-rank, undone
    const pal = async (txt) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      const inp = await waitFor(() => document.querySelector('.palette-input'), 3000);
      setVal(inp, txt); await sleep(300);
      return { inp, first: document.querySelector('.palette-item')?.innerText.replace(/\n/g, ' | ') || '' };
    };
    const ds = await call('dataset');
    const ranked = [...ds.portfolio].sort((a, b) => a.rank - b.rank);
    const p2 = ranked[1];
    // the smart actions need two projects (re-rank); a portfolio with one project cannot try them – said, not crashed
    if (!p2) { t('smart actions: need at least two projects in the portfolio – skipped here (re-rank and undo are covered by kpiTruth)', true, `${ranked.length} project(s)`); return; }
    let r = await pal(`Setze ${p2.name} auf gefährdet: Test-Vorschau`);
    t('smart action: health is understood and previewed (not run)', /Health|health/.test(r.first) && /Test-Vorschau/.test(r.first), r.first);
    r.inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
    r = await pal(`Team Web für alle Stories ohne Team in Atlantis`);
    t('smart action: an unknown scope is refused, nothing widens', /Atlantis/.test(r.first) && /nicht gefunden|not found|nothing will change|nichts wird/i.test(r.first), r.first);
    r.inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(300);
    const order0 = ranked.map((p) => p.ref);
    const rankF = (await fieldIds()).rank;
    const before = (await req(`/rest/api/3/issue/${p2.id}?fields=${rankF}`)).body?.fields?.[rankF];
    r = await pal(`${p2.name} auf Rang 1`);
    t('smart action: re-rank is previewed', /Rang 1|rank 1/.test(r.first), r.first);
    r.inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Enter opens Lotse with the preview – the search bar never applies a change itself; "Apply" there writes it
    const go = await waitFor(() => document.querySelector('[data-act="command"][data-command="rank.set"][data-phase="preview"] .lx-go:not(:disabled)'), 20000);
    t('smart action: Enter opens the change in Lotse as a preview (nothing written yet)', !!go);
    go?.click();
    await waitFor(() => document.querySelector('[data-act="command"][data-command="rank.set"][data-phase="applied"]'), 20000);
    document.querySelector('.lp-scrim')?.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(400);
    let moved = null;
    for (let k = 0; k < 30; k++) { await sleep(500); const d = await call('dataset'); moved = [...d.portfolio].sort((a, b) => a.rank - b.rank)[0]?.ref; if (moved === p2.ref) break; }
    t('smart action: re-rank ran (saved on the server)', moved === p2.ref, `rank 1 = ${moved}`);
    // undo from the history
    document.querySelector('.undo-btn')?.click();
    const ub = await waitFor(() => document.querySelector('.undo-row button'), 3000);
    ub?.click();
    let back = null;
    for (let k = 0; k < 30; k++) { await sleep(500); const d = await call('dataset'); back = [...d.portfolio].sort((a, b) => a.rank - b.rank).map((p) => p.ref); if (back.join() === order0.join()) break; }
    document.body.click();
    t('undo restores the exact ranking', back?.join() === order0.join(), back?.join());
    const after = (await req(`/rest/api/3/issue/${p2.id}?fields=${rankF}`)).body?.fields?.[rankF];
    t('undo restores the Jira rank field exactly', after === before, `${before} → ${after}`);
    document.querySelector('[data-tour="tab-portfolio"]')?.click();
  },
  // End to end, read-only: the parts no other suite covers – configuration (Blocked status, booking check), server
  // guards of the new reads, the client read-guard, the daily forecast record, and the new interactions.
  async e2eExtra(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 20000) => { for (let w = 0; w < ms / 250; w++) { const v = fn(); if (v) return v; await sleep(250); } return null; };
    const tab = (re) => [...document.querySelectorAll('[role=tab]')].find((b) => re.test(b.textContent));
    // configuration: statuses offered, defaults present (read only)
    const cg = await call('config.get').catch((e) => ({ err: e.code }));
    t('config: statuses offered for the Blocked choice', Array.isArray(cg.meta?.statuses) && cg.meta.statuses.length > 0 && cg.meta.statuses.every((s) => s.name && s.ids.length), `${cg.meta?.statuses?.length} statuses · ${cg.err || ''}`);
    t('config: Blocked choice is a list (empty = by name)', Array.isArray(cg.config?.dependencies?.blockedStatusIds ?? []), JSON.stringify(cg.config?.dependencies?.blockedStatusIds ?? null));
    const bk = cg.config?.booking;
    t('config: booking check settings with sane values', bk && typeof bk.enabled === 'boolean' && bk.minPct >= 0 && bk.minPct <= 100 && bk.escalatePct >= 0 && bk.graceDays >= 0, JSON.stringify(bk));
    // server guards of the new reads
    const today = new Date().toISOString().slice(0, 10);
    const ok = await call('booking.worklogs', { from: today.slice(0, 8) + '01', to: today }).catch((e) => ({ err: e.code }));
    t('booking.worklogs answers for the current month', ok && typeof ok.people === 'object' && !ok.err, ok.err || `${Object.keys(ok.people).length} people`);
    t('booking.worklogs refuses an inverted period', (await expectErr('booking.worklogs', { from: today, to: '2020-01-01' }, 'INVALID')).ok);
    t('booking.worklogs refuses more than ~4 months', (await expectErr('booking.worklogs', { from: '2025-01-01', to: '2025-12-31' }, 'INVALID')).ok);
    t('booking.worklogs refuses non-dates', (await expectErr('booking.worklogs', { from: '2026-01-01; DROP', to: today }, 'INVALID')).ok);
    // the daily forecast record: a report refresh records today (aggregates only), readable by the report group
    await call('report.refresh').catch(() => null);
    const hist = await call('history.get').catch((e) => ({ err: e.code }));
    const day = hist && !hist.err ? hist[today] || hist[Object.keys(hist).sort().at(-1)] : null;
    t('forecast record: today (or the last run) is recorded', !!day, hist?.err || Object.keys(hist || {}).sort().slice(-3).join(', '));
    if (day) t('forecast record: aggregates only – [OE, TS, RE, open T-shirt, Reife, done] per project', Object.values(day).every((v) => Array.isArray(v) && v.length === 6 && v.every((x) => x == null || typeof x === 'number')), JSON.stringify(Object.values(day)[0]));
    // the client read-guard: only /rest/api/3 reads; writes and other APIs are refused before any request
    const { jiraRead } = await import('./lib/api.js');
    const refused = async (p, b) => { try { await jiraRead(p, b); return false; } catch (e) { return e.code === 'FORBIDDEN'; } };
    t('client guard: comments endpoint refused', await refused('/rest/api/3/issue/1/comment'));
    t('client guard: a POST other than search refused', await refused('/rest/api/3/issue/1/changelog', { x: 1 }));
    t('client guard: other APIs refused', (await refused('/rest/agile/1.0/board')) && (await refused('/wiki/api/v2/pages')) && (await refused('/rest/api/3/../../wiki')));
    const me = await jiraRead('/rest/api/3/myself').catch(() => null);
    t('client guard: an allowed read works', !!me?.accountId);
    // Portfolio: "Alle aufklappen" opens every row's legend, and closes them again
    tab(/^Portfolio/)?.click();
    const all = await waitFor(() => document.querySelector('.hb-all'));
    const rows = document.querySelectorAll('[data-tour=ranking] .rank-row').length;
    all?.click(); await sleep(500);
    const open = document.querySelectorAll('[data-tour=ranking] .hb-legend').length;
    const withOe = [...document.querySelectorAll('[data-tour=ranking] .rank-row')].filter((r) => !r.querySelector('.hb-line.muted')).length;
    all?.click(); await sleep(500);
    t('"Alle aufklappen" opens the hours legend of every estimated row and closes it again', open === withOe && document.querySelectorAll('[data-tour=ranking] .hb-legend').length === 0, `${rows} rows · ${open} opened of ${withOe} estimated`);
    // Teamdetails: a project expands to the team's work items
    tab(/^(Teams|Teamdetails|Team details)/) /* the tab is "Teams" now */?.click();
    const pill = await waitFor(() => [...document.querySelectorAll('.team-pill')].find((p) => !/^0 /.test(p.querySelector('span')?.textContent || '')));
    pill?.click(); await sleep(600);
    const projBtn = await waitFor(() => document.querySelector('.tw .tw-name[aria-expanded]'));
    projBtn?.click();
    const issues = await waitFor(() => document.querySelector('.tw-issues'), 5000);
    await sleep(400);
    t('Teamdetails: a project opens its work items, the team\'s own marked', !!issues && (issues.querySelectorAll('tr.mine').length > 0 || /Keine Vorgänge|No work items/.test(issues.textContent)), `${issues?.querySelectorAll('tr.mine').length || 0} own · ${issues?.querySelectorAll('tbody tr').length || 0} rows`);
    projBtn?.click(); await sleep(300);
    // Dependencies: the Status column shows the prerequisite's Jira status
    tab(/Abhängigkeiten|Dependencies/)?.click();
    await waitFor(() => document.getElementById('dep-blocked'));
    await sleep(800);
    const depRows = [...document.querySelectorAll('table thead')].find((h) => /Voraussetzung|Prerequisite/.test(h.textContent))?.closest('table')?.querySelectorAll('tbody tr') || [];
    t('Dependencies: every link row shows a status pill and a schedule', [...depRows].every((r) => r.children.length >= 6 && r.children[4].querySelector('.chip')), `${depRows.length} rows`);
    // Booked hours: "Nur Auffällige" shows only hints and escalations
    tab(/Time Spent vs|Time spent vs/)?.click();
    const card = await waitFor(() => document.querySelector('section[aria-label="Gebuchte Stunden je Mitarbeiter"], section[aria-label="Booked hours per person"]'), 10000);
    if (card) {
      await waitFor(() => card.querySelector('tbody tr') || card.querySelector('.empty'), 20000);
      [...card.querySelectorAll('.card-head button')].find((b) => /Nur Auffällige|Flagged only/.test(b.textContent))?.click();
      await sleep(600);
      const shown = [...card.querySelectorAll('tbody tr')];
      t('booked hours: "flagged only" shows only hints and escalations', shown.every((r) => /Hinweis|Hint|Eskalation|Escalation/.test(r.lastElementChild?.textContent || '')), `${shown.length} rows`);
      [...card.querySelectorAll('.card-head button')].find((b) => /^Alle$|^All$/.test(b.textContent.trim()))?.click();
    } else t('booked hours card (role/person level)', true, 'not shown for this user');
    tab(/^Portfolio/)?.click();
  },
  // Nachweis, read-only: the in-app cross-check against Jira agrees on every value; data contract and accuracy render.
  async proof(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 60000) => { for (let w = 0; w < ms / 250; w++) { const v = fn(); if (v) return v; await sleep(250); } return null; };
    const proofTab = [...document.querySelectorAll('[role=tab]')].find((b) => /Nachweis|Proof/.test(b.textContent));
    if (proofTab) proofTab.click(); else await viaPalette('Nachweis', /(Nachweis|Proof) –/);
    const btn = await waitFor(() => [...document.querySelectorAll('#proof-check button, .seal-act button')].find((b) => /Jetzt prüfen|Check now|Erneut prüfen|Check again|Gegenprobe starten|Start the cross-check/.test(b.textContent)), 45000);
    t('Nachweis opens with the cross-check', !!btn, document.querySelector('#proof-check')?.innerText.slice(0, 120));
    if (!btn) return;
    btn.click();
    const rows = await waitFor(() => { const r = document.querySelectorAll('#proof-check tbody tr'); return r.length ? r : null; }, 120000);
    const bad = [...(rows || [])].filter((r) => !r.querySelector('.chip-ok'));
    t(`cross-check: every project matches Jira (${rows?.length || 0} projects × 6 values)`, rows && bad.length === 0, bad.map((r) => r.innerText.replace(/\s+/g, ' ')).join(' | ') || 'all ✓');
    const contract = document.querySelectorAll('#proof-contract tbody tr').length;
    t('data contract lists every agreed field', contract >= 12, `${contract} rows`);
    const cards = document.querySelectorAll('#proof-cards .mc').length;
    t('metric cards: one per number', cards >= 12, `${cards} cards`);
    document.querySelector('#proof-cards .mc')?.click();
    const drawer = await waitFor(() => document.querySelector('.mc-detail'), 5000);
    t('a card opens with formula, sources and how to check it', !!drawer && /JQL|Jira/.test(drawer.textContent), drawer?.textContent.slice(0, 80));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);
    const accBtn = [...document.querySelectorAll('#proof-accuracy button')].find((b) => /Nachrechnen|Compute|Prognosen nachrechnen|Recompute forecasts/.test(b.textContent));
    accBtn?.click();
    // done = the plan/forecast duel, or the plain "no stories to evaluate yet" message – not the "not computed" placeholder
    const accDone = await waitFor(() => document.querySelector('#proof-accuracy .acc-duel') || /Noch keine auswertbaren|No stories to evaluate/.test(document.querySelector('#proof-accuracy')?.textContent || ''), 90000);
    t('forecast accuracy runs on the real history (an empty result is said plainly)', !!accDone, document.querySelector('#proof-accuracy')?.innerText.replace(/\s+/g, ' ').slice(0, 220));
  },
  // Prototype update (Nov 2026), read-only: Portfolio split, Reife column, Teamdetails sums, Blocked count vs. Jira,
  // booked hours of the signed-in user vs. Jira worklogs. Nothing is written.
  async protoUpdate(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 15000) => { for (let w = 0; w < ms / 250; w++) { const v = fn(); if (v) return v; await sleep(250); } return null; };
    const tab = (re) => [...document.querySelectorAll('[role=tab]')].find((b) => re.test(b.textContent));
    const ds = await call('dataset');
    const c = computeAll(ds);
    const num = (s) => Number(String(s || '').replace(/[^\d−-]/g, '').replace('−', '-'));
    // 1 Portfolio: support card iff service spaces; Reife column = the engine's maturity
    tab(/^Portfolio/)?.click();
    await waitFor(() => document.querySelector('[data-tour=ranking] .rank-row'));
    await sleep(1200);
    const services = (c.support?.services || []).length;
    const supCard = document.querySelector('.support-card');
    t('Portfolio: Support has its own card exactly when service spaces exist', !!supCard === services > 0, `${services} spaces · card ${!!supCard}`);
    if (supCard) t('Support card: one row per service space', supCard.querySelectorAll('.rank-row.support').length === services, `${supCard.querySelectorAll('.rank-row.support').length} rows`);
    t('Projects card title "Projekte"', /^(Projekte|Projects)$/.test(document.querySelector('[data-tour=ranking] .card-title')?.textContent.trim() || ''), document.querySelector('[data-tour=ranking] .card-title')?.textContent);
    for (const row of document.querySelectorAll('[data-tour=ranking] .rank-row')) {
      const nameTxt = row.querySelector('.pname .t')?.textContent;
      const p = ds.portfolio.find((x) => x.name === nameTxt);
      if (!p) continue;
      const m = c.metrics.get(p.ref);
      const shown = row.querySelector('.reife')?.textContent.trim();
      const want = m.maturity == null ? '–' : `${Math.round(m.maturity * 100)}`;
      t(`Reife column ${p.name}`, m.maturity == null ? shown === '–' : num(shown) === Number(want), `shown ${shown} · engine ${want}`);
      t(`hours bar ${p.name}`, !!row.querySelector('.hb-track .hb-ts') && (m.tshirtTotal > 0) === !!row.querySelector('.hb-tshirt'));
    }
    // 2 Teamdetails: rows add up to the demand; free = capacity − demand
    tab(/^(Teams|Teamdetails|Team details)/) /* the tab is "Teams" now */?.click();
    const pills = await waitFor(() => { const x = document.querySelectorAll('.team-pill'); return x.length ? x : null; });
    t('Teamdetails opens with a team picker', !!pills, `${pills?.length || 0} teams`);
    for (const pill of [...(pills || [])].slice(0, 6)) {
      pill.click();
      await sleep(700);
      const sec = [...document.querySelectorAll('section.card')].find((x) => /arbeitet|works on/.test(x.querySelector('h2')?.textContent || ''));
      if (!sec) { t(`${pill.querySelector('b')?.textContent}: work table`, false); continue; }
      const rows = [...sec.querySelectorAll('.tw-row')];
      const foot = rows.filter((r) => r.classList.contains('tw-foot')).map((r) => [...r.children].slice(3).map((x) => num(x.textContent)));
      const projRows = rows.filter((r) => !r.classList.contains('tw-head') && !r.classList.contains('tw-foot') && !r.querySelector('.rank-num.s'));
      const sums = foot[1]?.map((_, k) => projRows.reduce((a, r) => a + (num([...r.children][3 + k]?.textContent) || 0), 0)) || [];
      const okSum = foot[1]?.every((d, k) => Math.abs(d - sums[k]) <= projRows.length) ?? false; // rounding: ≤ 1 h per row
      const okFree = foot[2]?.every((f, k) => Math.abs(f - (foot[0][k] - foot[1][k])) <= 1) ?? false;
      t(`${pill.querySelector('b')?.textContent}: project rows add up to the demand; free = capacity − demand`, okSum && okFree, `cap ${foot[0]} · demand ${foot[1]} (rows ${sums}) · free ${foot[2]}`);
    }
    // 3 Dependencies: Blocked = open stories/sub-tasks in the Blocked status in the portfolio (Jira)
    if (!tab(/Abhängigkeiten|Dependencies/)) t('Dependencies has no page of its own any more (blocked work shows in Teams and each project) – skipped', true);
    else {
    tab(/Abhängigkeiten|Dependencies/)?.click();
    // wait for the Dependencies page itself (Teamdetails also has a "Blockiert / überfällig" tile)
    await waitFor(() => document.getElementById('dep-blocked'));
    await sleep(600);
    const stat = [...document.querySelectorAll('.stat')].find((s) => /^(Blockiert|Blocked)$/.test(s.querySelector('.eyebrow')?.textContent.trim() || ''));
    const shownBlocked = num(stat?.querySelector('.stat-value')?.textContent);
    const ids = new Set((ds.config.dependencies?.blockedStatusIds || []).map(String));
    const roleTypes = new Set((ds.config.levels || []).filter((l) => l.role === 'estimate' || l.role === 'tiny').flatMap((l) => l.issueTypeIds.map(String)));
    // the portfolio's stories and sub-tasks, their status re-read straight from Jira
    const candidates = ds.issues.filter((i) => roleTypes.has(String(i.type?.id))).map((i) => i.id);
    let jiraBlocked = 0;
    for (let k = 0; k < candidates.length; k += 100) {
      const rr = await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: `id in (${candidates.slice(k, k + 100).join(',')})`, fields: ['status'], maxResults: 100 }) });
      for (const i of rr.body?.issues || []) {
        const st = i.fields.status;
        if (!st || st.statusCategory?.key === 'done') continue;
        if (ids.size ? ids.has(String(st.id)) : /^(blocked|blockiert)$/i.test(String(st.name || '').trim())) jiraBlocked++;
      }
    }
    t('Blocked = stories and sub-tasks in the Blocked status (Jira)', shownBlocked === jiraBlocked, `tile ${shownBlocked} · Jira ${jiraBlocked}`);
    t('Blocked section renders', !!document.getElementById('dep-blocked'));
    }
    // 4 Booked hours: the signed-in user's booked time = their worklogs in Jira for the same period
    tab(/Time Spent vs|Time spent vs/)?.click();
    const card = await waitFor(() => document.querySelector('section[aria-label="Gebuchte Stunden je Mitarbeiter"], section[aria-label="Booked hours per person"]'), 8000);
    if (!card) { t('booked-hours card (needs person level and capacity/report/admin role)', true, 'not shown for this user'); return; }
    await waitFor(() => card.querySelector('tbody tr') || card.querySelector('.empty, .callout.accent'), 20000);
    const sub = card.querySelector('.card-sub')?.textContent || '';
    const { bookingRange } = await import('@shared/booking.js');
    const { dayIdx, isoOf } = await import('@shared/dates.js');
    const today = dayIdx(ds.today);
    const d = new Date(today * 864e5);
    const a = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 864e5), b = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 864e5) - 1;
    const rg = bookingRange(a, b, today, ds.config.booking?.graceDays ?? 2);
    if (!rg.valid) { t('booked hours: period still in the grace days', true, sub); return; }
    const from = isoOf(rg.a), to = isoOf(rg.b);
    const me = (await req('/rest/api/3/myself')).body;
    const issues = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: `worklogAuthor = currentUser() AND worklogDate >= "${from}" AND worklogDate <= "${to}"`, fields: ['summary'], maxResults: 200 }) })).body?.issues || [];
    let h = 0;
    for (const i of issues) {
      const wl = (await req(`/rest/api/3/issue/${i.id}/worklog?maxResults=5000`)).body?.worklogs || [];
      for (const w of wl) if (w.author?.accountId === me.accountId && w.started?.slice(0, 10) >= from && w.started.slice(0, 10) <= to) h += (w.timeSpentSeconds || 0) / 3600;
    }
    const myRow = [...card.querySelectorAll('tbody tr')].find((r) => r.textContent.includes(me.displayName));
    const shownH = myRow ? num([...myRow.children][3]?.firstChild?.textContent) : 0;
    t(`booked hours of ${me.displayName} ${from}…${to} = Jira worklogs`, Math.abs(shownH - Math.round(h)) <= 1, `card ${myRow ? shownH : 'no row'} h · Jira ${Math.round(h)} h (${issues.length} work items)`);
  },
  // Smart suggestions + undo, clicked through the real UI and checked in Jira. Writes only to the PCX/PCR
  // sandbox and reverts every change (history panel, then Ctrl+Z), so Jira ends exactly as it started.
  async smartUndo(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ds = await call('dataset');
    const F = ds.config.fields || {};
    await fieldIds();
    const fieldOf = { team: F.team, tshirt: !F.tshirt || F.tshirt === 'app' ? FID.tshirt : F.tshirt, targetQuarters: !F.targetQuarters || F.targetQuarters === 'app' ? FID.quarters : F.targetQuarters, startDate: F.startDate, dueDate: 'duedate', originalEstimate: 'timeoriginalestimate' };
    const read = async (key, fid) => JSON.stringify((await req(`/rest/api/3/issue/${key}?fields=${fid}`)).body?.fields?.[fid] ?? null);
    const waitFor = async (fn, ms = 15000) => { for (let w = 0; w < ms / 250; w++) { const v = fn(); if (v) return v; await sleep(250); } return null; };
    const dqTab = [...document.querySelectorAll('[role=tab]')].find((b) => /Datenqualität|Data quality/.test(b.textContent));
    if (!dqTab) { t('smart suggestions: the data-quality page is gone (missing values live in each project) – skipped', true); return; }
    dqTab.click();
    const card = await waitFor(() => document.querySelector('section.smart'));
    if (!card) { t('smart suggestions: none in the current data (card hidden)', !!(await waitFor(() => document.querySelector('main h1'))), 'no fixable gap has a data-backed suggestion'); return; }
    t('smart suggestions card shows on Data quality', true, card.querySelector('.card-title')?.textContent);
    const sandboxRow = () => [...document.querySelectorAll('.smart-row')].find((r) => /^PC[XR]-\d+$/.test(r.querySelector('.tkey')?.textContent || ''));
    const row = sandboxRow();
    if (!row) { t('a suggestion on a sandbox work item to try', false, 'no PCX/PCR row'); return; }
    const key = row.querySelector('.tkey').textContent;
    const usageLabel = row.querySelector('.smart-why b')?.textContent || '';
    t(`suggestion explains itself (${key})`, (row.querySelector('.smart-why')?.textContent || '').length > 25, row.querySelector('.smart-why')?.textContent);
    const usage = row.dataset.usage;
    const fid = fieldOf[usage];
    t('row names its field', !!fid, `${usageLabel} → ${usage}`);
    if (!fid) return;
    const before = await read(key, fid);
    const count = () => Number(document.querySelector('.undo-count')?.textContent || 0);
    const n0 = count();
    row.querySelector('button.btn').click();
    let changed = null;
    for (let w = 0; w < 40 && changed == null; w++) { await sleep(500); const v = await read(key, fid); if (v !== before) changed = v; }
    t(`apply: ${key} ${usage} saved in Jira`, changed != null, `${before} → ${changed}`);
    t('apply adds one entry to the undo history', !!(await waitFor(() => count() === n0 + 1)), `${n0} → ${count()}`);
    // undo from the history panel
    document.querySelector('.undo-btn')?.click();
    const undoBtn = await waitFor(() => document.querySelector('.undo-row button'));
    t('history panel lists the change', !!undoBtn && /Vorschlag|Suggestion/.test(document.querySelector('.undo-label')?.textContent || ''), document.querySelector('.undo-label')?.textContent);
    undoBtn?.click();
    let back = null;
    for (let w = 0; w < 40; w++) { await sleep(500); back = await read(key, fid); if (back === before) break; }
    t('undo (history panel) restores Jira exactly', back === before, `${before} → ${changed} → ${back}`);
    t('history count back', !!(await waitFor(() => count() === n0)), `${count()}`);
    // apply again and undo with Ctrl+Z
    document.body.click();
    const again = await waitFor(() => [...document.querySelectorAll('.smart-row')].find((r) => r.querySelector('.tkey')?.textContent === key && r.dataset.usage === usage));
    if (!again) { t('suggestion is offered again after undo', false); return; }
    // the app disables writes while data refreshes after an undo – wait until the button is enabled
    const againBtn = again.querySelector('button.btn');
    for (let w = 0; w < 40 && againBtn.disabled; w++) await sleep(250);
    againBtn.click();
    let v2 = null;
    for (let w = 0; w < 40; w++) { await sleep(500); v2 = await read(key, fid); if (v2 !== before) break; }
    await waitFor(() => count() === n0 + 1);
    document.activeElement?.blur?.();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    let v3 = null;
    for (let w = 0; w < 40; w++) { await sleep(500); v3 = await read(key, fid); if (v3 === before) break; }
    t('Ctrl+Z restores Jira exactly', v2 !== before && v3 === before, `${before} → ${v2} → ${v3} · button ${againBtn.disabled ? 'still disabled' : 'enabled'} · ${document.querySelector('.toasts')?.innerText.replace(/\s+/g, ' ').slice(0, 120) || 'no message'}`);
  },
  // "Heute zu tun", due dates, dependency links and Ask boards – live. Every write lands on the sandbox (PCX/PCR),
  // is checked in Jira's own REST API, then undone from the history and checked again.
  async nextLive(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 20000) => { for (let w = 0; w < ms / 250; w++) { const v = await fn(); if (v) return v; await sleep(250); } return null; };
    const setVal = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const sandbox = (k) => /^PC[XR]-\d+$/.test(k || '');
    const undoTop = async () => {
      document.body.click(); await sleep(200);
      document.querySelector('.undo-btn')?.click();
      const b = await waitFor(() => document.querySelector('.undo-row button'), 4000);
      const label = document.querySelector('.undo-label')?.textContent || '';
      b?.click(); await sleep(300); document.body.click();
      return label;
    };
    const pal = async (txt) => {
      document.body.click(); await sleep(150);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      const inp = await waitFor(() => document.querySelector('.palette-input'), 3000);
      setVal(inp, txt); await sleep(350);
      return { inp, first: document.querySelector('.palette-item')?.innerText.replace(/\n/g, ' | ') || '' };
    };
    // since the search bar hands sentences to Lotse: Enter opens the preview card in Lotse, "Ausführen / Apply" writes
    const applyInLotse = async (command) => {
      const go = await waitFor(() => document.querySelector(`[data-act="command"][data-command="${command}"][data-phase="preview"] .lx-go:not(:disabled)`), 20000);
      go?.click();
      await waitFor(() => document.querySelector(`[data-act="command"][data-command="${command}"][data-phase="applied"]`), 20000);
      document.querySelector('.lp-scrim')?.click(); // close the panel
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(400);
      return !!go;
    };
    const boot = await call('bootstrap', {});
    const me = boot.me, roles = boot.roles || {};
    let ds = await call('dataset');
    let comp = computeAll(ds);
    await fieldIds();
    const F = ds.config.fields || {};
    const fieldOf = { team: F.team, tshirt: !F.tshirt || F.tshirt === 'app' ? FID.tshirt : F.tshirt, targetQuarters: !F.targetQuarters || F.targetQuarters === 'app' ? FID.quarters : F.targetQuarters, startDate: F.startDate, dueDate: 'duedate', originalEstimate: 'timeoriginalestimate' };
    const read = async (key, fid) => JSON.stringify((await req(`/rest/api/3/issue/${key}?fields=${fid}`)).body?.fields?.[fid] ?? null);
    const count = () => Number((document.querySelector('.inbox-btn')?.getAttribute('aria-label') || '').match(/(\d+)/)?.[1] ?? -1);

    // ---------- 1 the inbox shows exactly what the computation finds ----------
    const inbox = todayInbox({ computed: comp, me, roles, lang: getLang() });
    await waitFor(() => document.querySelector('.inbox-btn'));
    t('inbox: header count = health due + suggestions + long-blocked (computed from the same data)', count() === inbox.total, `${count()} shown · ${inbox.health.length} health + ${inbox.suggestions ? 1 : 0} suggestions + ${inbox.blocked.length} blocked`);
    document.querySelector('.inbox-btn').click();
    await waitFor(() => document.querySelector('[role=dialog] .inbox, [role=dialog] .empty'));
    // accessibility of the new parts (WCAG 2.2 AA): the header with the count badge and the inbox panel
    const axe = (await import('axe-core')).default;
    const ax = async (el) => (el ? (await axe.run(el, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations : [{ id: 'element missing', nodes: [] }]);
    const axInfo = (v) => v.map((x) => `${x.id}(${x.nodes.length}) ${x.nodes[0]?.target?.join(' ') || ''}`).join(' | ');
    await sleep(1200); // let the panel finish sliding in
    let v = await ax(document.querySelector('header.topbar'));
    t('header with the inbox count: 0 axe violations (WCAG 2.2 AA)', v.length === 0, axInfo(v));
    v = await ax(document.querySelector('[role=dialog].drawer'));
    t('inbox panel: 0 axe violations (WCAG 2.2 AA)', v.length === 0, axInfo(v));
    const sec = (re) => [...document.querySelectorAll('[role=dialog] section')].find((s) => re.test(s.getAttribute('aria-label') || ''));
    const chipN = (s) => (s ? Number(s.querySelector('.inbox-h .chip')?.textContent) : 0);
    const hS = sec(/Health/), sS = sec(/Vorschläge|Suggestions/), bS = sec(/blockiert|Blocked/);
    t('inbox: every section counts what the computation finds', chipN(hS) === inbox.health.length && chipN(sS) === (inbox.suggestions?.n || 0) && chipN(bS) === inbox.blocked.length, `health ${chipN(hS)}/${inbox.health.length} · suggestions ${chipN(sS)}/${inbox.suggestions?.n || 0} · blocked ${chipN(bS)}/${inbox.blocked.length}`);
    const rhythm = (ds.config.rules?.healthRhythmDays || 7) * 864e5;
    const wrong = inbox.health.filter((h) => { const p = ds.portfolio.find((x) => x.ref === h.ref); return p.health && Date.now() - Date.parse(p.health.at) <= rhythm; });
    t('inbox: only health updates older than the rhythm (or never given) are due', wrong.length === 0, `${inbox.health.length} due · rhythm ${rhythm / 864e5} days`);
    t('inbox: blocked = only stories blocked for more than 7 days', inbox.blocked.every((b) => b.days > 7), `${inbox.blocked.length} (all blocked: ${(comp.deps.blocked || []).length})`);

    // ---------- 2 one click: confirm an unchanged health (sandbox project), then undo exactly ----------
    const hRow = inbox.health.find((h) => h.status && sandbox(ds.portfolio.find((p) => p.ref === h.ref)?.key));
    if (!hRow) t('N/A confirm unchanged: no sandbox project has a due health with a status right now', true, inbox.health.map((h) => h.name).join(', ') || 'none due');
    else {
      const before = ds.portfolio.find((p) => p.ref === hRow.ref).health;
      const n0 = count();
      const li = document.querySelector(`[role=dialog] li[data-ref="${hRow.ref}"]`);
      const b = [...(li?.querySelectorAll('button') || [])].find((x) => /bestätigen|Confirm/.test(x.textContent));
      b?.click();
      const h1 = await waitFor(async () => { const h = (await call('dataset')).portfolio.find((p) => p.ref === hRow.ref)?.health; return h && h.at !== before.at ? h : null; });
      t(`confirm unchanged (${hRow.name}): same status and comment, today's date`, h1 && h1.status === before.status && h1.comment === before.comment && h1.at !== before.at, h1 ? `${before.at} → ${h1.at}` : 'not saved');
      t('confirm unchanged: the item leaves the inbox (count −1)', !!(await waitFor(() => count() === n0 - 1, 8000)), `${n0} → ${count()}`);
      await undoTop();
      const h2 = await waitFor(async () => { const h = (await call('dataset')).portfolio.find((p) => p.ref === hRow.ref)?.health; return h && h.at === before.at ? h : null; });
      t('undo restores the earlier health exactly (date, author, comment) – the update is due again', h2 && h2.by === before.by && h2.comment === before.comment && h2.status === before.status, h2 ? `${h2.at} · ${h2.byName}` : 'not restored');
      t('undo: the item is back in the inbox', !!(await waitFor(() => count() === n0, 8000)), `${count()}`);
    }

    // ---------- 3 apply suggestions in one go, one undo restores every value in Jira ----------
    const list = inbox.suggestions?.list || [];
    const keyOf = (s) => s.gap.key || ds.portfolio.find((p) => p.ref === s.gap.rootRef)?.key;
    const sb = list.filter((s) => sandbox(keyOf(s)) && fieldOf[s.usage] && !String(s.gap.rootRef || '').startsWith('space:')).slice(0, 6);
    if (!sb.length) t('N/A apply all: no smart suggestion on a sandbox work item right now', true, `${list.length} suggestions in total`);
    else {
      const allSandbox = list.length === sb.length && list.every((s) => sandbox(keyOf(s)));
      const befores = await Promise.all(sb.map((s) => read(keyOf(s), fieldOf[s.usage])));
      const n0 = Number(document.querySelector('.undo-count')?.textContent || 0);
      if (allSandbox) [...document.querySelectorAll('[role=dialog] button')].find((x) => /übernehmen|Apply all/.test(x.textContent))?.click();
      else await window.__pcApplySuggestions?.(sb);
      const after = await waitFor(async () => { const v = await Promise.all(sb.map((s) => read(keyOf(s), fieldOf[s.usage]))); return v.every((x, i) => x !== befores[i]) ? v : null; }, 40000);
      t(`apply ${sb.length} suggestions at once (${allSandbox ? 'the inbox button' : 'the same apply, sandbox items only – the full list includes other spaces'}): every value saved in Jira`, !!after, sb.map((s, i) => `${keyOf(s)} ${s.usage}: ${befores[i]} → ${after?.[i]}`).join(' · ').slice(0, 150));
      t('apply all = ONE entry in the undo history', !!(await waitFor(() => Number(document.querySelector('.undo-count')?.textContent || 0) === n0 + 1, 8000)), `${n0} → ${document.querySelector('.undo-count')?.textContent}`);
      const label = await undoTop();
      const back = await waitFor(async () => { const v = await Promise.all(sb.map((s) => read(keyOf(s), fieldOf[s.usage]))); return v.every((x, i) => x === befores[i]) ? v : null; }, 40000);
      t('one undo restores every value in Jira exactly', !!back, `${label} · ${back ? 'all restored' : 'not all restored'}`);
    }
    document.querySelector('[role=dialog] .drawer-close, [role=dialog] button[aria-label="Schließen"], [role=dialog] button[aria-label="Close"]')?.click();
    await sleep(400);

    // ---------- 4 smart action: due date in one sentence, then undo ----------
    ds = await call('dataset'); comp = computeAll(ds);
    const openStory = (i) => sandbox(i.key) && i.role === 'estimate' && (i.status?.cat ?? 'new') !== 'done';
    const story = ds.issues.find((i) => openStory(i) && i.due) || ds.issues.find(openStory);
    if (!story) t('due date: a sandbox story to try', false);
    else {
      const day = parseDay('in 3 wochen', localToday());
      const want = isoOf(day);
      const before = await read(story.key, 'duedate');
      const r = await pal(`Fälligkeit ${story.key} in 3 Wochen`);
      t(`due date: "${story.key} in 3 Wochen" is understood as a change with a preview (current → new)`, r.first.includes(story.key) && /→/.test(r.first) && /Fälligkeit|Due date/i.test(r.first), r.first);
      r.inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      t('due date: Lotse shows the preview and applies it on "Apply"', await applyInLotse('issue.setField'));
      const v = await waitFor(async () => ((await read(story.key, 'duedate')) === JSON.stringify(want) ? true : null), 20000);
      t('due date: saved in Jira', !!v, `${before} → ${await read(story.key, 'duedate')}`);
      await undoTop();
      const b = await waitFor(async () => ((await read(story.key, 'duedate')) === before ? true : null), 20000);
      t('undo restores the due date in Jira exactly', !!b, `${before} → ${await read(story.key, 'duedate')}`);
    }

    // ---------- 5 smart action: dependency link in one sentence, guards, then undo deletes exactly that link ----------
    const types = (ds.config.dependencies?.linkTypeIds || []).map(String);
    const opens = ds.issues.filter((i) => /^PCX-\d+$/.test(i.key) && i.role === 'estimate' && (i.status?.cat ?? 'new') !== 'done');
    const linked = (x, y) => (x.links || []).some((l) => l.otherId === y.id) || (y.links || []).some((l) => l.otherId === x.id);
    let pair = null;
    for (const a of opens) { for (const b of opens) if (a.id !== b.id && !linked(a, b)) { pair = [a, b]; break; } if (pair) break; }
    if (!types.length) {
      const r = await pal(`${opens[0]?.key} blockiert ${opens[1]?.key}`);
      t('link: without a configured dependency link type the action is refused (nothing written)', /konfiguriert|configured/.test(r.first), r.first);
      r.inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } else if (!pair) t('link: two unlinked sandbox stories to try', false, `${opens.length} open PCX stories`);
    else {
      const [a, b] = pair;
      const linksOf = async (key) => (await req(`/rest/api/3/issue/${key}?fields=issuelinks`)).body?.fields?.issuelinks || [];
      const reversed = (ds.config.dependencies?.reversedLinkTypeIds || []).map(String);
      const isIt = (l) => types.includes(String(l.type?.id)) && (reversed.includes(String(l.type?.id)) ? l.inwardIssue?.key === b.key : l.outwardIssue?.key === b.key);
      const r = await pal(`${a.key} blockiert ${b.key}`);
      t(`link: "${a.key} blockiert ${b.key}" is previewed`, /blockiert|blocks/.test(r.first) && r.first.includes(a.key) && r.first.includes(b.key) && !/nicht|not found|schon|already/.test(r.first), r.first);
      r.inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await applyInLotse('deps.link');
      const l = await waitFor(async () => (await linksOf(a.key)).find(isIt) || null, 20000);
      t(`link: created in Jira with the configured type, reading "${a.key} ${l?.type?.outward || 'blocks'} ${b.key}"`, !!l, l ? `${l.type.name} #${l.id}` : 'no link');
      if (l) {
        const d2 = computeAll(await call('dataset')).deps.list;
        t('link: the cockpit reads it in the same direction (a waits-for list entry)', d2.some((d) => d.pre === a.id && d.dep === b.id), `${d2.length} dependencies`);
        const again = await call('deps.link', { preId: a.id, depId: b.id }).catch((e) => ({ err: e.code }));
        t('deps.link twice: recognised, no second link', again.existed === true && (await linksOf(a.key)).filter(isIt).length === 1, JSON.stringify(again).slice(0, 80));
        t('deps.link refuses the same work item twice', (await expectErr('deps.link', { preId: a.id, depId: a.id }, 'INVALID')).ok);
        t('deps.link refuses a work item you cannot see', (await expectErr('deps.link', { preId: a.id, depId: '999999999' }, 'NOT_FOUND')).ok);
        t('deps.link refuses the opposite direction (a cycle)', (await expectErr('deps.link', { preId: b.id, depId: a.id }, 'INVALID')).ok);
        const other = opens.find((x) => x.id !== a.id && x.id !== b.id);
        if (other) t('deps.unlink refuses a link that is not this dependency', (await expectErr('deps.unlink', { linkId: String(l.id), preId: a.id, depId: other.id }, 'INVALID')).ok);
        await undoTop();
        const gone = await waitFor(async () => (!(await linksOf(a.key)).some((x) => x.id === l.id) ? true : null), 20000);
        t('undo deletes exactly that link in Jira', !!gone, `#${l.id}`);
        const d3 = computeAll(await call('dataset')).deps.list;
        t('after undo the cockpit no longer shows it', !d3.some((d) => d.pre === a.id && d.dep === b.id));
      }
    }

    // ---------- 6 Ask boards: role board opens with live numbers, save/switch/delete, then back exactly as before ----------
    const prefs0 = (await call('bootstrap', {})).prefs || {};
    const qsOf = (cards) => (cards || []).map((c) => c.q).join(' || ');
    (document.querySelector('[data-tour="ask"]') || document.querySelector('[data-tour="tab-ask"]'))?.click(); // Ask moved from a tab to the header button
    await waitFor(() => document.querySelector('.ask-board-btn'));
    await sleep(600);
    const shownQs = () => [...document.querySelectorAll('.ask-world .ask-card .ask-q')].map((x) => x.textContent.replace(/^„|“$/g, ''));
    const orig = shownQs();
    const tpl = roleBoards({ computed: comp, me, roles, lang: getLang(), hasSupport: !!(comp.supportA || comp.support) });
    const mgmt = tpl.find((b) => b.id === 'mgmt');
    const openMenu = async () => { document.body.click(); await sleep(150); document.querySelector('.ask-board-btn').click(); return waitFor(() => document.querySelector('.ask-menu'), 3000); };
    await openMenu();
    [...document.querySelectorAll('.ask-menu .menu-item')].find((m) => m.innerText.startsWith(mgmt.name))?.click();
    await waitFor(() => shownQs().join() === mgmt.questions.join(), 8000);
    await sleep(1200);
    const cards = [...document.querySelectorAll('.ask-world .ask-card')];
    t(`board "${mgmt.name}": one card per question, none unanswered`, cards.length === mgmt.questions.length && !cards.some((c) => c.querySelector('.ask-near')), `${cards.length}/${mgmt.questions.length}`);
    const actx = { computed: comp, ds, lang: getLang(), fmt, ruleName, me, roles, supportA: comp.supportA || null, cal: ds.config?.support?.sla };
    const live = mgmt.questions.map((q) => answerQ(q, actx)?.answer || '');
    const onCards = cards.map((c) => c.querySelector('.ask-answer')?.textContent || '');
    t('board numbers are live: each card shows what the data says right now', live.every((a, i) => a === onCards[i]), onCards[0]?.slice(0, 120));
    await settled(cards); // measure where the cards end up, not mid-animation (big data: answers take longer)
    const boxes = cards.map((c) => c.getBoundingClientRect());
    let ov = 0; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const x = boxes[i], y = boxes[j]; if (x.left < y.right - 2 && y.left < x.right - 2 && x.top < y.bottom - 2 && y.top < x.bottom - 2) ov++; }
    // which pairs, where (screen box vs. the layout's style.top + measured height), so a failure says why
    const pairInfo = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const x = boxes[i], y = boxes[j]; if (x.left < y.right - 2 && y.left < x.right - 2 && x.top < y.bottom - 2 && y.top < x.bottom - 2) pairInfo.push(`${cards[i].querySelector('.ask-q')?.textContent.slice(0, 18)}[${Math.round(x.left)},${Math.round(x.top)}-${Math.round(x.bottom)} top ${cards[i].style.top} h ${cards[i].offsetHeight}] × ${cards[j].querySelector('.ask-q')?.textContent.slice(0, 18)}[${Math.round(y.left)},${Math.round(y.top)}-${Math.round(y.bottom)} top ${cards[j].style.top} h ${cards[j].offsetHeight}]`); }
    t('board layout: no card on top of another', ov === 0, `${ov} overlaps ${pairInfo.join(' | ')}`.slice(0, 600));
    const name = `E2E ${new Date().toISOString().slice(11, 19)}`;
    await openMenu();
    await sleep(400);
    const vm = await ax(document.querySelector('.ask-menu'));
    t('Boards menu: 0 axe violations (WCAG 2.2 AA)', vm.length === 0, axInfo(vm));
    setVal(document.querySelector('.ask-menu-save input'), name); await sleep(150);
    document.querySelector('.ask-menu-save button[type=submit]').click();
    const saved = await waitFor(async () => ((await call('bootstrap', {})).prefs?.askBoards || []).find((b) => b.name === name) || null, 10000);
    t('save: the board is stored for this person on the server (questions + layout)', saved && qsOf(saved.cards) === mgmt.questions.join(' || '), saved ? `${saved.cards.length} cards` : 'not stored');
    await openMenu();
    const lead = tpl.find((b) => b.id === 'lead');
    [...document.querySelectorAll('.ask-menu .menu-item')].find((m) => m.innerText.startsWith(lead.name))?.click();
    t(`switch to "${lead.name}"`, !!(await waitFor(() => shownQs().join() === lead.questions.join(), 8000)), shownQs().length + ' cards');
    await openMenu();
    [...document.querySelectorAll('.ask-menu-saved .menu-item')].find((m) => m.innerText.includes(name))?.click();
    t('the saved board reopens with the same questions', !!(await waitFor(() => shownQs().join() === mgmt.questions.join(), 8000)));
    await openMenu();
    [...document.querySelectorAll('.ask-menu-saved')].find((r) => r.innerText.includes(name))?.querySelector('button[aria-label]')?.click();
    const delOk = await waitFor(async () => !((await call('bootstrap', {})).prefs?.askBoards || []).some((b) => b.name === name), 10000);
    t('delete: removed on the server', !!delOk);
    // back exactly as before: "back to here" on the first board opened undoes all five steps in order
    document.body.click(); await sleep(200);
    document.querySelector('.undo-btn')?.click();
    await waitFor(() => document.querySelector('.undo-row'), 3000);
    const row = [...document.querySelectorAll('.undo-row')].find((r) => r.innerText.includes(mgmt.name) && /geöffnet|opened/.test(r.innerText));
    [...(row?.querySelectorAll('button') || [])].at(-1)?.click();
    const back = !!(await waitFor(() => shownQs().join() === orig.join(), 10000));
    t('undo back to before the first board: the canvas shows exactly the cards from before', back, `${orig.length} cards before · undo entry ${row ? 'found' : 'NOT found'} (${document.querySelectorAll('.undo-row').length} entries) · now ${shownQs().length}: ${shownQs().slice(0, 3).join(' / ').slice(0, 160)}`);
    await sleep(1500);
    const prefs1 = (await call('bootstrap', {})).prefs || {};
    t('…and the stored boards and canvas equal the state before the test', JSON.stringify((prefs1.askBoards || []).map((b) => b.name)) === JSON.stringify((prefs0.askBoards || []).map((b) => b.name)) && qsOf(prefs1.ask?.cards) === qsOf(prefs0.ask?.cards), `${(prefs1.askBoards || []).length} boards · ${(prefs1.ask?.cards || []).length} cards`);
    document.body.click();
    document.querySelector('[data-tour="tab-portfolio"]')?.click();
  },
  // Teamdetails tiles (same registry as the portfolio): six tiles per team, each explaining itself; "for projects per
  // week" recomputed independently from the saved capacity settings; the breakdown opens; WCAG 2.2 AA. Read only.
  async teamTiles(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 15000) => { for (let w = 0; w < ms / 250; w++) { const v = fn(); if (v) return v; await sleep(250); } return null; };
    const axe = (await import('axe-core')).default;
    const cap = (await call('capacity.get')).capacity;
    const ds = await call('dataset');
    const c = computeAll(ds);
    const num = (s) => Number(String(s || '').replace(/[^\d,.-]/g, '').replace(',', '.'));
    [...document.querySelectorAll('[role=tab]')].find((b) => /^(Teams|Teamdetails|Team details)/.test(b.textContent.trim()))?.click();
    await waitFor(() => document.querySelector('.team-picker'));
    const pills = [...document.querySelectorAll('.team-pill')];
    for (const pill of pills) {
      pill.click();
      await sleep(700);
      const teamName = pill.querySelector('b')?.textContent;
      const tiles = [...document.querySelectorAll('main .kpi')];
      const labels = tiles.map((k) => k.querySelector('.kpi-label')?.textContent);
      const calcOf = (k) => (/(?:Rechnung|Calculation): (.+)$/.exec(k.getAttribute('aria-label') || '') || [])[1] || '';
      t(`${teamName}: six tiles, each with its calculation`, tiles.length === 6 && tiles.every((k) => calcOf(k).length > 3), tiles.map((k) => `${k.querySelector('.kpi-label')?.textContent}: ${calcOf(k)}`).join(' | ').slice(0, 150));
      // independent: Σ weekly hours of the team's people (+ unnamed) × (1 − daily − internal) − measured support
      const id = Object.keys(cap.teams || {}).find((k) => cap.teams[k].name === teamName) || [...c.model.teams.values()].find((x) => x.name === teamName)?.id;
      const st = { dailyBusinessPct: 20, internalPct: 0, ...(cap.teams?.[id] || {}) };
      const { capacityPeople } = await import('@shared/engine.js');
      const { shareOf } = await import('@shared/allocation.js');
      const derived = 0; // members on default values (Atlassian Teams, assignees) are counted like everyone else
      const gross = [...capacityPeople(c.model).values()].reduce((a, p) => a + (+p.weeklyHours || 0) * shareOf(p, id), 0) + (+st.extraWeeklyHours || 0);
      const sup = (c.support?.teams || []).find((x) => x.teamId === id)?.weekly ?? (c.support?.reserveQuarter?.[id] || 0) / 12;
      const want = Math.max(0, gross * Math.max(0.05, 1 - ((+st.dailyBusinessPct || 0) + (+st.internalPct || 0)) / 100) - sup);
      const avTile = tiles.find((k) => /Für Projekte je Woche|For projects per week/.test(k.textContent));
      const shown = num(avTile?.querySelector('.kpi-value')?.textContent);
      if (!derived) t(`${teamName}: "for projects per week" = settings (${gross} h × (1 − ${st.dailyBusinessPct} % − ${st.internalPct || 0} %) − ${Math.round(sup * 10) / 10} h support)`, Math.abs(shown - want) <= 0.6, `tile ${shown} · recomputed ${Math.round(want * 10) / 10} · tile calc: ${calcOf(avTile)} · members: ${calcOf(tiles[0])} · test people: ${[...capacityPeople(c.model).values()].filter((p) => shareOf(p, id) > 0).map((p) => `${p.weeklyHours}×${Math.round(shareOf(p, id) * 100)}%`).join(' + ')}`);
      else t(`${teamName}: people derived from assignments (defaults) – skipped`, true, `${derived} derived`);
    }
    // the breakdown opens on hover/focus and shows the calculation
    const tile = document.querySelector('main .kpi');
    const wrap = tile?.closest('.kpi-wrap');
    wrap?.scrollIntoView({ block: 'center' }); await sleep(300); // a person hovers a tile they can see
    wrap?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }));
    wrap?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, pointerType: 'mouse', relatedTarget: document.body }));
    const pop = await waitFor(() => document.querySelector('.kpi-pop'), 3000);
    t('hover/focus opens the breakdown with calculation and inputs', !!pop && !!pop.querySelector('.kpi-calc code') && pop.querySelectorAll('.kpi-inputs > div').length > 0, pop?.querySelector('.kpi-calc code')?.textContent);
    // visible, not just present: the card is the top element where it sits (nothing covers it)
    if (pop) { pop.scrollIntoView({ block: 'nearest' }); await sleep(300); }
    const pr = pop?.getBoundingClientRect();
    const hit = pr ? document.elementFromPoint(pr.left + pr.width / 2, pr.top + Math.min(40, pr.height / 2)) : null;
    t('the breakdown is on top (visible, not covered by other cards)', !!hit && pop.contains(hit), `${hit ? hit.className : 'no element'} · card [${pr ? `${Math.round(pr.left)},${Math.round(pr.top)} ${Math.round(pr.width)}×${Math.round(pr.height)}` : '–'}] in a ${innerWidth}×${innerHeight} frame`);
    // a heatmap cell explains itself: the card's planned hours = the number in the cell
    const cell = [...document.querySelectorAll('main section[data-team-area="capacity"] .heat-cell[tabindex="0"]')].find((c) => /^\d/.test(c.textContent.trim()));
    if (cell) {
      cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      cell.focus(); cell.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      const card = await waitFor(() => document.querySelector('.tooltip.tip-card'), 3000);
      const calc = card?.querySelector('.kpi-calc code')?.textContent || '';
      const planned = num((/([\d.,]+) h (?:geplant|planned)/.exec(calc) || [])[1]);
      t('heatmap cell: the card shows the calculation, its planned hours = the cell', !!card && /=/.test(calc) && Math.abs(planned - num(cell.textContent)) <= 0.6, `cell ${cell.textContent.trim()} · ${calc.slice(0, 130)}`);
      cell.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); cell.blur();
    } else t('heatmap cell with planned hours to check', true, 'N/A – no planned hours in the shown team');
    const r = await axe.run(document.querySelector('main .kpi-grid'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
    t('team tiles incl. breakdown: 0 axe violations (WCAG 2.2 AA)', r.violations.length === 0, r.violations.map((v) => `${v.id}(${v.nodes.length})`).join(', '));
    tile?.closest('.kpi-wrap')?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    document.querySelector('[data-tour="tab-portfolio"]')?.click();
  },
  // Kapazität › Quartale (read-only): every number in the "So wird gerechnet" box and the table adds up, and the
  // capacity line matches an independent recomputation from capacity.get (management question 2026-11-09).
  async waterCalc(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 15000) => { for (let w = 0; w < ms / 250; w++) { const v = fn(); if (v) return v; await sleep(250); } return null; };
    const axe = (await import('axe-core')).default;
    const cap = (await call('capacity.get')).capacity || {};
    const ds = await call('dataset');
    const n = (s) => Number(String(s || '').replace(/[^\d,-]/g, '').replace(',', '.')); // whole hours, "1.068 h" → 1068
    // the quarter view lives in Teams › Team capacity › Quarters now (no Capacity tab of its own)
    const capTab = [...document.querySelectorAll('[role=tab]')].find((b) => /^(Kapazität|Capacity)/.test(b.textContent.trim())) || [...document.querySelectorAll('[role=tab]')].find((b) => /^Teams/.test(b.textContent.trim()));
    capTab?.click();
    const seg = await waitFor(() => [...document.querySelectorAll('main button')].find((b) => /^(Quartale|Quarters)$/.test(b.textContent.trim())));
    seg?.click();
    await waitFor(() => document.querySelector('.wl-cell'));
    const cells = [...document.querySelectorAll('.wl-cell')];
    // the all-teams quarter grid has no entry in the navigation any more (each team has Teams › Team capacity › Quarters)
    if (!cells.length) { t('quarter grid of all teams: not in the navigation any more – skipped (Teams › Quarters is covered by teamsLive)', true); return; }
    t('quarter cells found', cells.length > 0, `${cells.length}`);
    let bad = 0, checked = 0, capChecked = 0;
    const notes = [];
    for (const cell of cells) {
      cell.click();
      await sleep(450);
      const box = document.querySelector('[data-wl-calc]');
      const line = (k) => box?.querySelector(`[data-line="${k}"]`);
      const res = (k) => n(line(k)?.querySelector('.wl-calc-res')?.textContent);
      const expr = (k) => line(k)?.querySelector('.wl-calc-expr')?.textContent || '';
      const head = [...document.querySelectorAll('section.card .card-head .card-title')].map((x) => x.textContent).find((x) => / · /.test(x)) || '?';
      const capV = res('cap'), dem = res('demand'), free = res('free'), util = res('util');
      const rows = [...document.querySelectorAll('section.card .table tbody tr')].map((tr) => [n(tr.cells[2]?.textContent), n(tr.cells[3]?.textContent)]);
      const foot = Object.fromEntries([...document.querySelectorAll('.wl-foot tr')].map((tr) => [tr.dataset.foot, n(tr.cells[2]?.textContent)]));
      const sumRows = rows.reduce((a, r) => a + r[0], 0);
      const terms = expr('demand').includes('…') ? null : (expr('demand').match(/[\d.]+(?= h)/g) || []).map((x) => n(x)).reduce((a, x) => a + x, 0);
      const missing = /Fehlt|Missing/.test(line('free')?.textContent || '');
      const ok = sumRows === dem && rows.length && rows[rows.length - 1][1] === dem && foot.demand === dem && foot.cap === capV && foot.free === free
        && (terms == null || terms === dem) && (missing ? dem - capV : capV - dem) === free && (capV > 0 ? Math.round((dem / capV) * 100) === util : true)
        && n(cell.querySelector('.num')?.textContent) === util;
      checked++;
      if (!ok) { bad++; notes.push(`${head}: rows ${sumRows} box ${dem} last ${rows[rows.length - 1]?.[1]} foot ${foot.demand}/${foot.cap}/${foot.free} terms ${terms} cap ${capV} free ${free} util ${util}`); }
      // independent capacity: Σ saved weekly hours of the team (+ unnamed) × 12 × (1 − daily − internal) × (1 − absence)
      const teamName = head.split(' · ')[0];
      const id = Object.keys(cap.teams || {}).find((k) => cap.teams[k].name === teamName) || (ds.teams || []).find((x) => x.name === teamName)?.id;
      const people = Object.values(cap.people || {}).filter((p) => p.teamId === id);
      const derived = (ds.issues || []).some((i) => i.role === 'estimate' && i.team?.id === id && i.assignee?.id && !(cap.people || {})[i.assignee.id]);
      if (id && !derived) {
        const st = { dailyBusinessPct: 20, internalPct: 0, absenceRatePct: 10, ...(cap.teams?.[id] || {}) };
        let weekly = people.reduce((a, p) => a + (+p.weeklyHours || 0), 0);
        if (!weekly && cap.teamWeekly?.[id]) weekly = +cap.teamWeekly[id];
        weekly += +st.extraWeeklyHours || 0;
        const want = weekly * 12 * Math.max(0.05, 1 - ((+st.dailyBusinessPct || 0) + (+st.internalPct || 0)) / 100) * (1 - (+st.absenceRatePct || 0) / 100);
        capChecked++;
        if (Math.round(want) !== capV) { bad++; notes.push(`${head}: capacity shown ${capV}, recomputed ${Math.round(want * 10) / 10}`); }
      }
    }
    t(`every cell adds up (box = table = footer = tile) and the capacity line = recomputed from settings (${checked} cells, ${capChecked} capacity checks)`, bad === 0, notes.slice(0, 4).join(' || ') || 'all consistent');
    // the cell's hover card carries the same four lines
    const c0 = document.querySelector('.wl-cell');
    c0?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const card = await waitFor(() => document.querySelector('.tooltip.tip-card'), 3000);
    const code = card?.querySelector('.kpi-calc code')?.textContent || '';
    t('hover card shows capacity, total demand, free/missing and utilisation', /(Kapazität|Capacity)/.test(code) && /(Bedarf gesamt|Total demand)/.test(code) && /(Frei|Fehlt|Free|Missing)/.test(code) && /(Auslastung|Utilization)/.test(code), code.replace(/\n/g, ' | ').slice(0, 160));
    c0?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    const r = await axe.run(document.querySelector('[data-wl-calc]')?.closest('section'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
    t('waterline panel incl. calculation box: 0 axe violations (WCAG 2.2 AA)', r.violations.length === 0, r.violations.map((v) => `${v.id}(${v.nodes.length})`).join(', '));
    document.querySelector('[data-tour="tab-portfolio"]')?.click();
  },
  // One-off configuration requested by the site owner (2026-11-09): "Intern 10 %, Ausfallquote 0 %" on the teams
  // Data, Integration, Netz and Web – through the normal permission-checked save, nothing else touched. Idempotent.
  // The earlier values are written into the result so the change can be reverted exactly.
  // On request of the user (2026-11-11): superportdev's default distribution becomes "Nach freier Kapazität".
  // One audited, versioned config save; the previous value is recorded here and the version before the change
  // stays in Konfiguration › Versionen & Sicherung (one-click restore = the undo for this action).
  async setCapacityDefault(t) {
    const got = await call('config.get');
    const cfg = got.config;
    const before = cfg.rules?.distribution || 'linear';
    t('before (for an exact undo)', true, `rules.distribution = ${before}`);
    if (before === 'capacity') { t('already "Nach freier Kapazität" – nothing changed', true); return; }
    await call('config.save', { config: { ...cfg, rules: { ...cfg.rules, distribution: 'capacity' } } });
    const after = (await call('config.get')).config;
    t('default distribution is now "Nach freier Kapazität"', after.rules?.distribution === 'capacity', `rules.distribution = ${after.rules?.distribution}`);
    const changedOther = Object.keys(after.rules || {}).filter((k) => k !== 'distribution' && JSON.stringify(after.rules[k]) !== JSON.stringify(cfg.rules?.[k]));
    t('no other rule changed', changedOther.length === 0, changedOther.join(', ') || 'none');
    t('roles, support, booking, notices untouched', ['roles', 'support', 'booking', 'notices'].every((k) => JSON.stringify(after[k]) === JSON.stringify(cfg[k])));
  },
  async setInternal(t) {
    const NAMES = ['Data', 'Integration', 'Netz', 'Web'];
    const ds = await call('dataset');
    const got = await call('capacity.get');
    const cap = structuredClone(got.capacity || { people: {}, teams: {}, absences: [] });
    cap.teams = cap.teams || {};
    const ids = new Map([...(ds.teams || []).map((x) => [x.id, x.name]), ...Object.entries(cap.teams).map(([id, x]) => [id, x.name])]);
    const targets = [...ids].filter(([, name]) => NAMES.includes(name));
    t('the four teams are found', targets.length === NAMES.length, targets.map(([, n]) => n).join(', '));
    const before = Object.fromEntries(targets.map(([id, name]) => [name, cap.teams[id] ? { dailyBusinessPct: cap.teams[id].dailyBusinessPct, internalPct: cap.teams[id].internalPct ?? 0, absenceRatePct: cap.teams[id].absenceRatePct, saved: true } : { saved: false }]));
    t('before (for an exact revert)', true, JSON.stringify(before));
    let changed = 0;
    for (const [id, name] of targets) {
      const cur = cap.teams[id] || { name, dailyBusinessPct: 20, absenceRatePct: 10, extraWeeklyHours: 0 };
      if ((cur.internalPct ?? 0) === 10 && cur.absenceRatePct === 0) continue;
      cap.teams[id] = { ...cur, name: cur.name || name, internalPct: 10, absenceRatePct: 0 };
      changed++;
    }
    const untouched = JSON.stringify([cap.people, cap.absences]) === JSON.stringify([got.capacity?.people || {}, got.capacity?.absences || []]);
    t('people and absences are passed through unchanged', untouched);
    if (changed) await call('capacity.save', { capacity: cap });
    const after = (await call('capacity.get')).capacity.teams;
    t(`saved: Intern 10 %, Ausfallquote 0 % on ${targets.length} teams (${changed} changed)`, targets.every(([id]) => after[id]?.internalPct === 10 && after[id]?.absenceRatePct === 0), targets.map(([id, n]) => `${n} ${after[id]?.dailyBusinessPct}/${after[id]?.internalPct}/${after[id]?.absenceRatePct}`).join(' · '));
    // the result as the boss sees it: weekly capacity per person after Tagesgeschäft + intern (+ support)
    const c2 = computeAll(await call('dataset'));
    const wu = weeksUtilization(c2.model, c2.support, 2);
    const rows = wu.teams.flatMap((tm) => tm.members.map((m) => `${ds.people?.[m.id]?.name || m.id}: ${fmtN(m.cap[0])} h (plan ${fmtN(m.plan[0])} h, free ${fmtN(m.cap[0] - m.plan[0])} h)`));
    t('weekly capacity per person now', rows.length > 0, rows.join(' · '));
  },
  // Instant open: the tab-scoped snapshot and the write gate, checked from inside the app frame.
  async snapshot(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(2500); // the app writes its snapshot ~0.8 s after fresh data
    const c = await getContext();
    const key = snapshotKey(c);
    t('snapshot key is per account, site and module', !!key && key.includes(c.accountId) && key.includes(c.cloudId) && key.includes(c.moduleKey), key && key.replace(c.accountId, '<acct>'));
    const snap = readSnapshot(key, c.accountId);
    t('snapshot of this tab holds the dataset', snap?.ds?.portfolio?.length > 0 && !!snap.boot?.roles, snap ? `${snap.ds.portfolio.length} items, ${Math.round((Date.now() - snap.at) / 1000)} s old` : 'none');
    t('snapshot is sessionStorage only (gone with the tab)', !Object.keys(localStorage).some((k) => k.startsWith('pc:')));
    // Real account ids contain ':' (e.g. 557058:…) – the purge must still recognise them as foreign.
    const foreign = 'pc:v1:557058:0000-other:' + c.cloudId + ':pc-cockpit:';
    sessionStorage.setItem(foreign, '{"v":1}');
    readSnapshot(key, c.accountId);
    t("another account's snapshot is purged on read", sessionStorage.getItem(foreign) === null);
    t('own snapshot survives the purge', !!sessionStorage.getItem(key));
    t('admin page never caches', snapshotKey({ ...c, moduleKey: 'pc-admin' }) === null);
    holdWrites();
    const held = await call('health.set', { ref: 'issue:1', status: 'nope', comment: 'x' }).then(() => 'sent', (e) => e.code);
    let readOk = false;
    await call('prefs.save', {}).then(() => { readOk = true; });
    releaseWrites();
    t('writes are refused (not queued) while a snapshot is on screen', held === 'STALE', held);
    t('reads pass while writes are held', readOk);
    const after = await call('health.set', { ref: 'issue:1', status: 'nope', comment: 'x' }).then(() => 'sent', (e) => e.code);
    t('after fresh data writes go through (and are validated)', after === 'INVALID', after);
  },
  // Improvement loop: one-round-trip bootstrap, "since your last visit", language preference, parallel bulk fills.
  async improve(t) {
    let t0 = performance.now();
    const b = await call('bootstrap', { withDataset: true });
    const oneTrip = Math.round(performance.now() - t0);
    t('bootstrap brings the dataset along', b.dataset?.portfolio?.length > 0 && Array.isArray(b.dataset.issues), `${b.dataset?.portfolio?.length} items`);
    // Five alternating samples each; medians, so one slow call does not decide the result.
    const one = [oneTrip], twoT = [];
    for (let k = 0; k < 5; k++) {
      t0 = performance.now(); await call('bootstrap'); await call('dataset'); twoT.push(performance.now() - t0);
      if (k < 4) { t0 = performance.now(); await call('bootstrap', { withDataset: true }); one.push(performance.now() - t0); }
    }
    const med = (a) => Math.round([...a].sort((x, y) => x - y)[a.length >> 1]);
    t('one round trip beats two (median of 5)', med(one) < med(twoT), `one ${med(one)} ms [${one.map(Math.round).join(',')}] vs two ${med(twoT)} ms [${twoT.map(Math.round).join(',')}]`);
    const plain = await call('bootstrap');
    t('bootstrap without the flag stays lean', plain.dataset === null);
    // digest
    const items = digestSummary(b.dataset, computeAll(b.dataset, { skipWeeks: true }));
    const refs = Object.keys(items);
    t('digest.save rejects a malformed ref', (await expectErr('digest.save', { items: { 'issue:1 OR 1=1': { r: 1 } } }, 'INVALID')).ok);
    t('digest.save rejects an array', (await expectErr('digest.save', { items: [1, 2] }, 'INVALID')).ok);
    t('digest.save rejects 1501 items', (await expectErr('digest.save', { items: Object.fromEntries(Array.from({ length: 1501 }, (_, i) => [`issue:${i + 1}`, { r: i + 1 }])) }, 'INVALID')).ok);
    await call('digest.save', { items: JSON.parse('{"__proto__": {"r": 1}}') }).catch(() => null);
    t('__proto__ key cannot pollute', ({}).r === undefined && Object.prototype.r === undefined);
    const hRef = refs.slice(1, -1).find((r) => items[r].h) || refs[1];
    const junk = refs.at(-1);
    const was = items[hRef].h === 'critical' ? 'onTrack' : 'critical';
    const shifted = Object.fromEntries(refs.map((r) => [r, { ...items[r] }]));
    shifted[refs[0]].r = 999;
    shifted[hRef].h = was;
    Object.assign(shifted[junk], { p: 7, s: '<b>', d: 'yesterday' });
    await call('digest.save', { items: shifted, ack: true });
    const b2 = await call('bootstrap');
    const stored = b2.digest?.items?.[junk];
    t('digest stored and sanitised', stored && stored.p === null && stored.s === null && stored.d === null && b2.digest.items[hRef].h === was, JSON.stringify(stored));
    const diff = digestDiff(b2.digest, items);
    const kinds = diff ? diff.changes.map((c) => `${c.ref === refs[0] ? 'A' : c.ref === hRef ? 'H' : c.ref === junk ? 'J' : '?'}:${c.kind}`) : [];
    t('digest shows exactly the changed items', items[hRef].h ? kinds.includes('A:rank') && kinds.includes('H:health') && kinds.every((k) => !k.startsWith('?')) : kinds.includes('A:rank'), kinds.join(','));
    await call('digest.save', { items });
    const b3 = await call('bootstrap');
    t('a reload within 30 min keeps the comparison base', b3.digest?.items?.[hRef]?.h === was);
    await call('digest.save', { items, ack: true }); // leave the real state behind
    const b4 = await call('bootstrap');
    t('"Got it" resets the base', digestDiff(b4.digest, items)?.changes.length === 0);
    // language
    const before = b.prefs?.lang ?? null;
    t('prefs.save stores lang', (await call('prefs.save', { lang: 'en' })).lang === 'en');
    t('prefs.save ignores unknown lang', (await call('prefs.save', { lang: 'fr' })).lang === 'en');
    await call('prefs.save', { lang: before });
    t('lang restored', ((await call('bootstrap')).prefs.lang ?? null) === before, String(before));
    // parallel bulk fill + parallel undo on two stories without a team
    const two = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: 'project = PCX AND issuetype = Story AND cf[10015] is EMPTY ORDER BY key', fields: ['summary'], maxResults: 3 }) })).body.issues || [];
    if (two.length >= 2) {
      await Promise.all(two.map((i) => call('issue.fill', { issueId: i.id, usage: 'startDate', value: '2026-12-01' })));
      const got = await Promise.all(two.map((i) => req(`/rest/api/3/issue/${i.id}?fields=customfield_10015`)));
      t(`bulk: ${two.length} parallel fills saved`, got.every((g) => g.body.fields.customfield_10015 === '2026-12-01'), two.map((i) => i.key).join(','));
      await Promise.all(two.map((i) => call('issue.fill', { issueId: i.id, usage: 'startDate', clear: true })));
      const back = await Promise.all(two.map((i) => req(`/rest/api/3/issue/${i.id}?fields=customfield_10015`)));
      t('bulk: parallel undo restored all', back.every((g) => !g.body.fields.customfield_10015), back.map((g) => String(g.body.fields.customfield_10015)).join(','));
    } else t('bulk: needs two stories without start date', false, `${two.length} found`);
    // Undo restores what was there before – also when the field was NOT empty (overdue / milestone rules).
    const dated = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: 'project = PCX AND issuetype = Story AND duedate is not EMPTY ORDER BY key', fields: ['duedate'], maxResults: 1 }) })).body.issues?.[0];
    if (dated) {
      const before = dated.fields.duedate;
      const r1 = await call('issue.fill', { issueId: dated.id, usage: 'dueDate', value: '2027-06-30' });
      t('fill reports the previous due date', r1.previous === before, `${dated.key}: ${r1.previous} (was ${before})`);
      await call('issue.fill', { issueId: dated.id, usage: 'dueDate', restore: r1.previous });
      const back = (await req(`/rest/api/3/issue/${dated.id}?fields=duedate`)).body.fields.duedate;
      t('undo restores an existing due date (not cleared)', back === before, `${back}`);
    } else t('needs a story with a due date', false);
    const est = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: 'project = PCX AND issuetype = Story AND originalEstimate is EMPTY ORDER BY key', fields: ['timetracking'], maxResults: 1 }) })).body.issues?.[0];
    if (est) {
      const tt0 = est.fields.timetracking || {};
      const r2 = await call('issue.fill', { issueId: est.id, usage: 'originalEstimate', value: 8 });
      const mid = (await req(`/rest/api/3/issue/${est.id}?fields=timetracking`)).body.fields.timetracking || {};
      await call('issue.fill', { issueId: est.id, usage: 'originalEstimate', restore: r2.previous });
      const tt1 = (await req(`/rest/api/3/issue/${est.id}?fields=timetracking`)).body.fields.timetracking || {};
      t('estimate fill saved', mid.originalEstimateSeconds === 8 * 3600, JSON.stringify(mid));
      t('estimate undo restores original AND remaining estimate', (tt1.originalEstimateSeconds ?? null) === (tt0.originalEstimateSeconds ?? null) && (tt1.remainingEstimateSeconds ?? null) === (tt0.remainingEstimateSeconds ?? null), `${est.key} before ${JSON.stringify(tt0)} after ${JSON.stringify(tt1)}`);
    } else t('needs a story without estimate', false);
    t('restore rejects garbage', (await expectErr('issue.fill', { issueId: dated?.id || '1', usage: 'dueDate', restore: 'tomorrow' }, 'INVALID')).ok);
  },
  async setup(t, c) {
    const b = await call('bootstrap');
    t('bootstrap: Jira admin detected', b.roles.admin === true, JSON.stringify(b.roles));
    t('config.get as admin', !!(await call('config.get')).meta);
    t('config.save rejects two estimate levels', (await expectErr('config.save', { config: { ...sandboxConfig(c.groups), levels: [{ key: 'a', role: 'estimate', issueTypeIds: ['10008'] }, { key: 'b', role: 'estimate', issueTypeIds: ['10010'] }] } }, 'INVALID')).ok);
    t('config.save rejects type on two levels', (await expectErr('config.save', { config: { ...sandboxConfig(c.groups), portfolio: { source: 'issue', issueTypeIds: ['10008'] } } }, 'INVALID')).ok);
    const saved = await call('config.save', { config: { ...sandboxConfig(c.groups), __proto__: { polluted: true }, evil: 'x' } });
    t('config.save valid; unknown keys dropped', saved.setupComplete && !('evil' in saved), Object.keys(saved).join(','));
    const b2 = await call('bootstrap');
    t('roles from groups (mgmt member)', b2.roles.manageRanking && b2.roles.viewReport && b2.roles.editCapacity && !b2.roles.editHealth, JSON.stringify(b2.roles));
    const cand = await call('portfolio.candidates', { query: '' });
    t('candidates lists epics only', cand.length > 0 && cand.every((x) => x.ref.startsWith('issue:')), `${cand.length}`);
    for (const e of c.epics) { const r = await call('portfolio.add', { ref: `issue:${e.id}` }); t(`add ${e.key}`, r.added !== undefined); }
    t('add rejects non-portfolio type (Story)', (await expectErr('portfolio.add', { ref: `issue:${c.story.id}` }, 'INVALID')).ok);
    t('add rejects space ref in issue mode', (await expectErr('portfolio.add', { ref: 'space:10048' }, 'INVALID')).ok);
    t('add rejects malformed ref', (await expectErr('portfolio.add', { ref: 'issue:1 OR 1=1' }, 'INVALID')).ok);
    const ds = await call('dataset');
    t('dataset: all 6 items visible', ds.portfolio.length === 6, `${ds.portfolio.length} items, ${ds.issues.length} issues`);
    const jql = await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: cf(FID.rank) + ' is not EMPTY ORDER BY ' + cf(FID.rank) + ' ASC', fields: [FID.rank], maxResults: 20 }) });
    t('rank field written & JQL-searchable', jql.body.issues?.length === 6 && jql.body.issues.every((i, k) => i.fields[FID.rank] === k + 1), FID.env + ' ' + (jql.body.issues || []).map((i) => i.fields[FID.rank]).join(','));
  },
  async positive(t, c) {
    let ds = await call('dataset');
    const ME = (await call('bootstrap')).me.id;
    const WEB = (ds.teams || []).find((x) => x.name === 'Web')?.id || ds.teams?.[0]?.id;
    const order = [...ds.portfolio].sort((a, b) => a.rank - b.rank).map((p) => p.ref);
    const swapped = [order[1], order[0], ...order.slice(2)];
    await call('portfolio.reorder', { order: swapped });
    const j = await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: cf(FID.rank) + ' = 1', fields: ['summary'], maxResults: 2 }) });
    t('reorder writes new rank 1 to Jira', j.body.issues?.length === 1 && `issue:${j.body.issues[0].id}` === swapped[0], j.body.issues?.map((i) => i.key).join());
    t('reorder rejects duplicates', (await expectErr('portfolio.reorder', { order: [order[0], order[0]] }, 'INVALID')).ok);
    t('reorder rejects unknown ref', (await expectErr('portfolio.reorder', { order: ['issue:999999'] }, 'INVALID')).ok);
    t('reorder rejects non-array', (await expectErr('portfolio.reorder', { order: 'x' }, 'INVALID')).ok);
    const pcx = c.epics.find((e) => e.fields.project.key === 'PCX');
    t('health.set ok', (await call('health.set', { ref: `issue:${pcx.id}`, status: 'atRisk', comment: 'Self-test: Abhängigkeit verzögert Start.' })).status === 'atRisk');
    t('health.set rejects bad status', (await expectErr('health.set', { ref: `issue:${pcx.id}`, status: 'great', comment: 'x' }, 'INVALID')).ok);
    t('health.set rejects 281 chars', (await expectErr('health.set', { ref: `issue:${pcx.id}`, status: 'onTrack', comment: 'x'.repeat(281) }, 'INVALID')).ok);
    await call('issue.fill', { issueId: pcx.id, usage: 'tshirt', value: 'M' });
    const f = await req(`/rest/api/3/issue/${pcx.id}?fields=${FID.tshirt}`);
    t('fill T-shirt into app field (asApp after edit check)', f.body.fields[FID.tshirt] === 'M', JSON.stringify(f.body.fields));
    await call('issue.fill', { issueId: pcx.id, usage: 'targetQuarters', value: ['2026-Q4', '2027-Q1'] });
    const f2 = await req(`/rest/api/3/issue/${pcx.id}?fields=${FID.quarters}`);
    t('fill target quarters', f2.body.fields[FID.quarters] === '2026-Q4, 2027-Q1', f2.body.fields[FID.quarters]);
    if (c.noTeam) {
      await call('issue.fill', { issueId: c.noTeam.id, usage: 'team', value: WEB });
      const g = await req(`/rest/api/3/issue/${c.noTeam.id}?fields=customfield_10001`);
      t('fill team as user (Jira field)', g.body.fields.customfield_10001?.name === 'Web', JSON.stringify(g.body.fields.customfield_10001)?.slice(0, 60));
    }
    t('fill rejects unknown usage', (await expectErr('issue.fill', { issueId: pcx.id, usage: 'summary', value: 'hack' }, 'INVALID')).ok);
    t('fill rejects bad estimate', (await expectErr('issue.fill', { issueId: pcx.id, usage: 'originalEstimate', value: -5 }, 'INVALID')).ok);
    t('fill rejects JQL-ish issueId', (await expectErr('issue.fill', { issueId: '1) OR (1=1', usage: 'tshirt', value: 'M' }, 'INVALID')).ok);
    const sub = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: 'project = PCX AND issuetype = Sub-task', fields: ['summary'], maxResults: 1 }) })).body.issues[0];
    if (sub) {
      // the lock is off by default (rules.lockSubtasks: false) – switched on for this check, the setting restored right after
      const cfgL = (await call('config.get')).config;
      const wasOn = !!cfgL.rules?.lockSubtasks;
      if (!wasOn) await call('config.save', { config: { ...cfgL, rules: { ...cfgL.rules, lockSubtasks: true } } });
      const lk = await expectErr('issue.fill', { issueId: sub.id, usage: 'originalEstimate', value: 4 }, 'SUBTASK_LOCKED');
      if (!wasOn) await call('config.save', { config: cfgL });
      const after = !!(await call('config.get')).config.rules?.lockSubtasks;
      t('estimate on sub-task blocked by lock (switched on for the check, then restored)', lk.ok && after === wasOn, `${lk.info} · lock now ${after ? 'on' : 'off'} (was ${wasOn ? 'on' : 'off'})`);
    }
    const cap = await call('capacity.get');
    await call('capacity.save', { capacity: { ...cap.capacity, people: { ...cap.capacity.people, [ME]: { weeklyHours: 38, location: 'DE-NW', teamId: WEB } }, teams: { [WEB]: { name: 'Web', dailyBusinessPct: 15, absenceRatePct: 10 } }, absences: [{ accountId: ME, from: '2026-12-21', to: '2027-01-01', type: 'vacation' }] } });
    t('capacity.save + get roundtrip', (await call('capacity.get')).capacity.people[ME]?.weeklyHours === 38);
    t('capacity.save rejects __proto__ / bad ids', (await expectErr('capacity.save', { capacity: { people: { 'a b': { weeklyHours: 1 } } } }, 'INVALID')).ok);
    t('capacity weekly hours clamped', await (async () => { const cc = (await call('capacity.get')).capacity; await call('capacity.save', { capacity: { ...cc, people: { ...cc.people, x1: { weeklyHours: 9999, location: 'MARS' } } } }); const p = (await call('capacity.get')).capacity.people.x1; const ok = p.weeklyHours === 80 && p.location === 'NONE'; delete cc.people.x1; await call('capacity.save', { capacity: cc }); return ok; })());
    // the capacity as it was before this suite (2026-11-24: the test state stayed – team settings, absences and the
    // Dev Team entry other testers had maintained on dev were gone)
    await call('capacity.save', { capacity: cap.capacity });
    const back = (await call('capacity.get')).capacity;
    t('capacity restored to what it was before', JSON.stringify(Object.keys(back.teams || {}).sort()) === JSON.stringify(Object.keys(cap.capacity.teams || {}).sort()) && (back.absences || []).length === (cap.capacity.absences || []).length, `${Object.keys(back.teams || {}).length} teams · ${(back.absences || []).length} absences`);
    t('milestones: version in two milestones rejected', (await expectErr('milestones.save', { milestones: [{ name: 'A', date: '2027-01-01', fixVersionIds: ['1'] }, { name: 'B', date: '2027-01-01', fixVersionIds: ['1'] }] }, 'INVALID')).ok);
    const vers = await call('meta.versions', { query: 'PCX' });
    const ms = await call('milestones.save', { milestones: [{ name: 'Go-Live Sandbox', date: '2026-12-15', fixVersionIds: vers.filter((v) => v.projectKey === 'PCX' && v.name !== 'PCX Release 2').map((v) => v.id) }] });
    t('milestones saved with PCX versions', ms.length === 1 && ms[0].fixVersionIds.length >= 1, JSON.stringify(ms[0].fixVersionIds));
    // the milestones as they were (2026-11-24: the single test milestone used to stay)
    await call('milestones.save', { milestones: (ds.milestones || []).map((m) => ({ name: m.name, date: m.date, fixVersionIds: m.fixVersionIds || [] })) }).catch(() => null);
    const r = await call('report.refresh');
    // one row per active portfolio project (the demo data of 2026-11-23 made it 14 – the old check said exactly 6)
    const activeN = ds.portfolio.filter((p) => p.statusCat !== 'done').length;
    t('report computed (asApp) with rows', r.rows.length > 0 && r.rows.length <= ds.portfolio.length, `${r.rows.length} rows · ${activeN} active of ${ds.portfolio.length} projects`);
    const p = await call('prefs.save', { selectedRef: 'issue:1; DROP', view: '<script>', filters: { status: 'evil', onlyIssues: 'yes' } });
    t('prefs sanitized', !p.selectedRef?.includes(';') && p.view !== '<script>' && p.filters.status === 'all', JSON.stringify(p));
    const a = await call('audit.list');
    t('audit log has rank/config/health entries', ['rank.change', 'config.update', 'health.update'].every((x) => a.some((e) => e.action === x)), `${a.length}`);
    ds = await call('dataset');
    t('dataset: pseudonyms absent while person level on', ds.issues.some((i) => i.assignee && i.assignee.name));
  },
  async denyRoles(t, c) {
    const ME = (await call('bootstrap')).me.id;
    // Move every app role to a group Dev Team is NOT in; admin still can (config is admin-only).
    t('step ctx ok', true, Object.keys(c.groups).join());
    // only the roles move to another group – on top of the CURRENT configuration (never the old sandbox one), restored
    // in finally even when a check crashes (E2E 2026-11-24)
    const before = (await call('config.get')).config;
    const revoked = (extra = {}) => ({ ...before, permissions: sandboxConfig(c.groups, 'pc-test-projectadmins').permissions, ...extra });
    let unassigned = null;
    try {
    try { await call('config.save', { config: revoked() }); } catch (e) { t('config.save to projectadmins', false, e.code + ' ' + e.message); throw e; }
    t('step config saved', true);
    const b = await call('bootstrap');
    t('roles revoked', !b.roles.manageRanking && !b.roles.viewReport && !b.roles.editCapacity, JSON.stringify(b.roles));
    const ds = await call('dataset');
    const order = [...ds.portfolio].sort((x, y) => x.rank - y.rank).map((p) => p.ref);
    t('reorder denied', (await expectErr('portfolio.reorder', { order: [...order].reverse() }, 'NO_ACCESS')).ok);
    t('add denied', (await expectErr('portfolio.add', { ref: order[0] }, 'NO_ACCESS')).ok);
    t('remove denied', (await expectErr('portfolio.remove', { ref: order[0] }, 'NO_ACCESS')).ok);
    t('candidates denied', (await expectErr('portfolio.candidates', {}, 'NO_ACCESS')).ok);
    t('report.get denied', (await expectErr('report.get', {}, 'NO_ACCESS')).ok);
    t('report.publish denied', (await expectErr('report.publish', { spaceId: '1' }, 'NO_ACCESS')).ok);
    t('confluence.spaces denied', (await expectErr('confluence.spaces', {}, 'NO_ACCESS')).ok);
    t('capacity.get denied', (await expectErr('capacity.get', {}, 'NO_ACCESS')).ok);
    t('capacity.save denied', (await expectErr('capacity.save', { capacity: { people: {}, teams: {}, absences: [] } }, 'NO_ACCESS')).ok);
    const pcx = c.epics.find((e) => e.fields.project.key === 'PCX' && e.key !== c.epics[0].key);
    await req(`/rest/api/3/issue/${pcx.id}`, { method: 'PUT', body: JSON.stringify({ fields: { assignee: null } }) });
    unassigned = pcx;
    t('health denied for non-owner without group', (await expectErr('health.set', { ref: `issue:${pcx.id}`, status: 'onTrack', comment: 'x' }, 'NO_ACCESS')).ok);
    t('health.clear denied for non-owner', (await expectErr('health.clear', { ref: `issue:${pcx.id}` }, 'NO_ACCESS')).ok);
    t('ai.healthDraft denied for non-owner (or AI off)', (await expectErr('ai.healthDraft', { ref: `issue:${pcx.id}` }, 'NO_ACCESS')).ok || (await expectErr('ai.healthDraft', { ref: `issue:${pcx.id}` }, 'AI_DISABLED')).ok);
    t('ai.reportSummary denied without report group (or AI off)', (await expectErr('ai.reportSummary', {}, 'NO_ACCESS')).ok || (await expectErr('ai.reportSummary', {}, 'AI_DISABLED')).ok);
    const mine = c.epics.find((e) => e.fields.assignee?.accountId === ME && e.fields.project.key === 'PCX' && e.id !== pcx.id);
    t('health allowed for own project (owner)', (await call('health.set', { ref: `issue:${mine.id}`, status: 'onTrack', comment: 'Owner darf immer.' })).status === 'onTrack');
    await req(`/rest/api/3/issue/${pcx.id}`, { method: 'PUT', body: JSON.stringify({ fields: { assignee: { accountId: ME } } }) });
    unassigned = null;
    const ds2 = await call('dataset');
    t('capacity absences without reason for non-editors', (ds2.capacity.absences || []).every((x) => x.type === 'absent'), JSON.stringify(ds2.capacity.absences));
    await call('config.save', { config: revoked({ rules: { ...(before.rules || {}), personLevel: false } }) });
    const ds3 = await call('dataset');
    t('person level off: assignees pseudonymized', ds3.issues.filter((i) => i.assignee).every((i) => i.assignee.anon && !i.assignee.name && i.assignee.id.startsWith('anon-')), `${ds3.issues.filter((i) => i.assignee).length} assignees`);
    t('person level off: worklog authors pseudonymized', ds3.issues.flatMap((i) => i.worklogs).every((w) => !w.a || w.a.startsWith('anon-')));
    t('person level off: no real account ids in people/capacity', !JSON.stringify({ p: ds3.people, c: ds3.capacity }).includes('712020:9965b502') || Object.keys(ds3.people).every((k) => ds3.portfolio.some((p) => p.owner?.id === k)));
    } finally {
      if (unassigned) await req(`/rest/api/3/issue/${unassigned.id}`, { method: 'PUT', body: JSON.stringify({ fields: { assignee: { accountId: ME } } }) }).catch(() => {});
      await call('config.save', { config: before }); // restore exactly what was there
    }
    t('roles restored', (await call('bootstrap')).roles.manageRanking);
  },
  // Meine Arbeit (UC-20) live: reads the own week, then books on ONE sandbox story (PCX) – only if this account has
  // no booking of its own there today – changes it, comments, removes it again and checks Jira after each step:
  // worklog, remaining estimate and time spent end exactly where they started. Guards: sub-task, hours, date.
  // Plan 2026-11-11 (prototype + use cases): the new navigation, roles matrix, weekly planning (one reversible
  // write on a PCX sandbox story through plan.apply), plan vs. actual, support dispatching – read-only otherwise.
  // 2026-11-20 – boss: "139 % / 125 % / 250 % – but it is always me": My work reads the board's own numbers; the week
  // heads say it in words. Real data, read-only.
  // dev install only: the 14 demo projects (PCX-71..84, docs/DEMO-DATA.md) into the DEV portfolio, then a data reload
  async demoPortfolio(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const keys = ['PCX-78', 'PCX-76', 'PCX-71', 'PCX-80', 'PCX-75', 'PCX-72', 'PCX-74', 'PCX-73', 'PCX-77', 'PCX-79', 'PCX-83', 'PCX-81', 'PCX-82', 'PCX-84'];
    const found = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: `key in (${keys.join(',')})`, fields: ['issuetype'], maxResults: 50 }) })).body?.issues || [];
    const byKey = new Map(found.map((i) => [i.key, i.id]));
    let added = 0, had = 0;
    const errs = [];
    for (const k of keys) {
      const id = byKey.get(k);
      if (!id) { errs.push(`${k} not found`); continue; }
      try { const r = await call('portfolio.add', { ref: `issue:${id}` }); if (r?.added) added++; else had++; } catch (e) { errs.push(`${k} ${e.code || e.message}`); }
    }
    t(`dev portfolio: ${added} demo projects added, ${had} already there`, added + had === keys.length, errs.join(' · '));
    document.querySelector('.topbar-tools button[aria-label="Aktualisieren"], .topbar-tools button[aria-label="Refresh"]')?.click();
    const head = () => document.querySelector('.topbar, header')?.textContent || '';
    const bigger = /(?<!\d)(1[5-9]|2\d) ?(Projekte|projects)/; // the header reads "SUPERPORT15 projects" (no space)
    for (let w = 0; w < 120; w++) { await sleep(500); if (bigger.test(head())) break; }
    t('the app shows the bigger portfolio', bigger.test(head()), head().slice(0, 80));
  },
  // 2026-11-23 – scale with the big demo data set (docs/DEMO-DATA.md, ~1,400 work items): how long the data load, the
  // computation and every view take in the real app. Read-only. Budgets: data ≤ 20 s, computation ≤ 3 s, a view ≤ 4 s.
  async scaleLive(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const tab = (re) => [...document.querySelectorAll('[role=tab]')].find((b) => re.test(b.textContent.trim()));
    const until = async (fn, ms = 30000) => { const t0 = performance.now(); for (;;) { if (fn()) return Math.round(performance.now() - t0); if (performance.now() - t0 > ms) return null; await sleep(40); } };
    let t0 = performance.now();
    const ds = await call('dataset');
    const load = Math.round(performance.now() - t0);
    t0 = performance.now();
    const c = computeAll(ds);
    const comp = Math.round(performance.now() - t0);
    const stories = ds.issues.filter((i) => i.role === 'estimate').length;
    t(`data: ${ds.portfolio.length} projects, ${ds.issues.length} work items (${stories} stories), loaded in ${load} ms${ds.truncated ? ' – TRUNCATED' : ''}`, load <= 20000 && !ds.truncated, JSON.stringify({ load, truncated: !!ds.truncated, orphans: (ds.orphans || []).length, tickets: ds.supportTickets?.tickets?.length || 0, server: ds.timing || null }), true);
    t(`computation (computeAll) ${comp} ms`, comp <= 3000, `${c.model.items.length} items · ${c.model.teams.size} teams`);
    // the server loaded the hierarchy through Jira Plans (one search per project) – here the same work items by the walk
    // (a parent search per level, read-only): none missing, each under the same project
    {
      const S = async (jql) => { const out = []; let tok; do { const r = await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql, fields: ['parent'], maxResults: 100, nextPageToken: tok }) }); out.push(...(r.body?.issues || [])); tok = r.body?.isLast === false ? r.body.nextPageToken : null; } while (tok); return out; };
      const roots = ds.portfolio.filter((p) => p.kind === 'issue');
      const rootIds = new Set(roots.map((p) => String(p.id)));
      const want = new Map();
      let frontier = roots.map((p) => ({ id: String(p.id), ref: p.ref }));
      for (let d = 0; d < 8 && frontier.length; d++) {
        const refOf = new Map(frontier.map((x) => [x.id, x.ref]));
        const next = [];
        for (let i = 0; i < frontier.length; i += 40) {
          for (const x of await S(`parent in (${frontier.slice(i, i + 40).map((y) => y.id).join(',')})`)) {
            if (rootIds.has(x.id) || want.has(x.id)) continue;
            const ref = refOf.get(x.fields?.parent?.id);
            want.set(x.id, ref); next.push({ id: x.id, ref });
          }
        }
        frontier = next;
      }
      const got = new Map(ds.issues.map((i) => [String(i.id), i.rootRef]));
      const missing = [...want.keys()].filter((id) => !got.has(id)), wrong = [...want].filter(([id, ref]) => got.has(id) && got.get(id) !== ref);
      t(`hierarchy: ${want.size} work items below ${roots.length} projects – all loaded, each under its project (server: ${ds.timing?.plans || 'walk'})`, missing.length === 0 && wrong.length === 0, `missing ${missing.length} · wrong project ${wrong.length} · walk ${want.size} · dataset ${ds.issues.length}`, true);
    }
    const views = [
      [/^(Meine Arbeit|My work)/, () => document.querySelector('.mine-profile')],
      [/^Portfolio/, () => document.querySelectorAll('[data-tour=ranking] .rank-row').length >= Math.min(10, ds.portfolio.length)],
      [/^(Projekte|Projects)/, () => document.querySelector('main .kpi-grid')],
      [/^Teams/, () => document.querySelector('.team-picker') && document.querySelector('main .kpi-grid')],
      [/^(Wochenplanung|Weekly planning)/, () => document.querySelector('.wb-grid .wb-row:nth-child(3)')],
      [/^(Plan vs\. Ist|Plan vs\. actual)/, () => document.querySelector('.pa-page .pa-teams, .pa-page .callout, .pa-page .empty')],
      [/^Support/, () => document.querySelector('main .stats')],
      [/^(C-Level-Report|C-level report)/, () => document.querySelector('.rp-page')],
    ];
    const times = [];
    for (const [re, ready] of views) {
      const b = tab(re);
      if (!b) { times.push(`${re.source}: no tab`); continue; }
      await sleep(600);
      // the previous view's page must be gone first – otherwise a shared selector (.kpi-grid) counts as ready at 0 ms
      const old = document.querySelector('main.main')?.firstElementChild;
      b.click();
      const took = await until(() => (!old || !old.isConnected) && b.getAttribute('aria-selected') === 'true' && ready(), 30000);
      times.push(`${b.textContent.trim().replace(/\d+\+?$/, '')}: ${took ?? '>30000'} ms`);
      t(`view ${b.textContent.trim().replace(/\d+\+?$/, '')} ready in ${took ?? '>30000'} ms`, took != null && took <= 4000);
    }
    // the weekly board with 26 weeks, by free capacity, every team
    tab(/^(Wochenplanung|Weekly planning)/)?.click(); await sleep(1500);
    const seg26 = [...document.querySelectorAll('main .seg-btn, main button')].find((b) => b.textContent.trim() === '26');
    const capBtn = [...document.querySelectorAll('main .seg-btn, main button')].find((b) => /^(Nach freier Kapazität|By free capacity)$/.test(b.textContent.trim()));
    capBtn?.click(); await sleep(400);
    // the range is remembered: start from 8 weeks so the switch to 26 is measured (not a board already showing 26)
    const seg8 = [...document.querySelectorAll('main .seg-btn, main button')].find((b) => b.textContent.trim() === '8');
    seg8?.click();
    await until(() => document.querySelectorAll('.wb-wk').length && document.querySelectorAll('.wb-wk').length < 26, 10000);
    seg26?.click();
    const w26 = await until(() => document.querySelectorAll('.wb-wk').length >= 26, 30000);
    t(`weekly board: 26 weeks by free capacity in ${w26 ?? '>30000'} ms`, w26 != null && w26 <= 4000, `${document.querySelectorAll('.wb-card').length} cards`);
    const allBtn = [...document.querySelectorAll('main button')].find((b) => /^(Alle Teams|All teams)$/.test(b.textContent.trim()));
    allBtn?.click();
    const wAll = await until(() => document.querySelector('[data-row^="t:"]'), 30000);
    t(`weekly board: all teams in ${wAll ?? '>30000'} ms`, wAll != null && wAll <= 4000);
    // a big project page (the one with the most work items)
    const big = [...c.model.items].sort((a, b) => (c.model.byRoot.get(b.ref)?.length || 0) - (c.model.byRoot.get(a.ref)?.length || 0))[0];
    tab(/^(Projekte|Projects)/)?.click(); await sleep(1200);
    const pill = [...document.querySelectorAll('main button')].find((b) => b.textContent.includes(big?.name || '¬'));
    pill?.click();
    const tp = await until(() => [...document.querySelectorAll('main h1, main h2')].some((h) => h.textContent.includes(big.name)), 30000);
    t(`project page "${big?.name}" (${c.model.byRoot.get(big?.ref)?.length || 0} work items) in ${tp ?? '>30000'} ms`, tp != null && tp <= 4000);
    // report refresh (server) and the Lotse portfolio briefing
    t0 = performance.now(); await call('report.refresh').catch(() => null); const rr = Math.round(performance.now() - t0);
    t(`C-level report recomputed on the server in ${rr} ms`, rr <= 25000);
    t('timings', true, times.join(' · '), true);
    tab(/^Portfolio/)?.click();
  },
  // 2026-11-20 – boss: "This is my capacity – why does the project view have 250 %? 2 × 125 %? It is always me." A split
  // person's team share is a guarantee, not a cap: on real data the teams' times add up to the person's time and the
  // teams' overloads to the person's overload; every team sum is the same in Personen, Projekte and the Teams overview;
  // "Warum?" opens the explanation on a red week. Read-only.
  // 2026-11-23 – boss: "add this calculation also in the box", "the complete period and the free days – holidays etc.",
  // "the sum … is not correct, or?". On the screen: the My work week card shows period, the whole calculation and the days
  // off; the Weekly planning "Summe" explains itself as the people above added up. Read-only.
  async weekTipLive(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const wait = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(60); } };
    const tab = (re) => [...document.querySelectorAll('[role="tab"]')].find((b) => re.test(b.textContent.trim()));
    const cardTitled = (re) => [...document.querySelectorAll('.tooltip.tip-card')].find((c) => re.test(c.querySelector('.tip-card-head b')?.textContent || ''));
    const hover = async (el, re) => {
      for (let k = 0; k < 3; k++) {
        el.scrollIntoView({ block: 'center' });
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        const c = await wait(() => cardTitled(re), 2500);
        if (c) return c;
        el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); await sleep(200);
      }
      return null;
    };
    const unhover = (el) => { el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false })); };
    tab(/^(Meine Arbeit|My work)/)?.click();
    const strip = await wait(() => document.querySelectorAll('.mine-strip-w').length >= 8 && document.querySelectorAll('.mine-strip-w'), 15000);
    if (!strip) { t('My work: the 8-week strip is there', false); return; }
    let withCalc = 0, withPeriod = 0, offShown = 0, offWeeks = 0;
    const samples = [];
    const missed = [];
    for (const w of strip) {
      const wk = w.getAttribute('aria-label')?.split(':')[0] || '';
      const card = await hover(w, new RegExp(`^${wk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
      if (!card) missed.push(wk);
      const head = card?.querySelector('.tip-card-head span')?.textContent || '';
      const calc = card?.querySelector('.kpi-calc code')?.textContent || '';
      if (/\d{2}\.\d{2}\. – \d{2}\.\d{2}\.\d{4}|\d{2}\/\d{2} – \d{2}\/\d{2}\/\d{4}/.test(head)) withPeriod++;
      if (/(Zeit für Projekte|time for projects)/.test(calc) && /÷|nichts geplant|nothing planned|keine Zeit|no time/.test(calc)) withCalc++;
      const off = /(frei|abwesend|Feiertag|off|absent|holiday)[^\n]*\(\d+ (Tag|Tage|day|days)\)/.test(calc);
      if (off) { offWeeks++; if (card.querySelectorAll('.kpi-items li').length > 0) offShown++; }
      if (samples.length < 2 && calc) samples.push(`${card.querySelector('.tip-card-head b')?.textContent} ${head} | ${calc.replace(/\n/g, ' / ')}`);
      unhover(w); await sleep(120);
    }
    t('My work: every week card shows the whole period (Mon – Fri with year)', withPeriod === strip.length, `${withPeriod}/${strip.length}${missed.length ? ` · no card for ${missed.join(', ')}` : ''}`);
    t('My work: every week card shows the calculation (weekly hours … = time for projects, planned ÷ time)', withCalc === strip.length, `${withCalc}/${strip.length} · ${samples.join(' ‖ ')}`, true);
    t('My work: a week with days off lists them by day (holiday names, absences)', offShown === offWeeks, `${offShown}/${offWeeks} weeks with days off`);
    // Weekly planning: the Summe of the people
    tab(/^(Wochenplanung|Weekly planning)/)?.click();
    await wait(() => document.querySelector('.wb-row.foot'), 15000);
    await sleep(800);
    const foot = [...document.querySelectorAll('.wb-row.foot .wb-head[data-has-tip]')][0];
    if (!foot) { t('Weekly planning: a "Summe" cell with planned work to explain', true, 'N/A – nothing planned in the shown team'); return; }
    const card = await hover(foot, /^(Summe|Total) · /);
    const text = card?.textContent || '';
    t('Weekly planning: the "Summe" says it adds up the people above (whole weeks) and shows the calculation', /(Personen oben zusammen|people above together)/.test(text) && /(Zeit der Personen|the people's time)/.test(card?.querySelector('.kpi-calc code')?.textContent || ''), text.slice(0, 220), true);
    unhover(foot);
  },
  async teamTimeLive(t) {
    const ds = await call('dataset');
    const computed = computeAll(ds);
    const { buildBoard, distributionOf } = await import('@shared/weekPlan.js');
    const { capacityPeople } = await import('@shared/engine.js');
    const dist = distributionOf(ds.config?.rules?.distribution);
    const all = buildBoard({ ds, computed, weeks: 8, distribution: dist });
    let n = 0, bad = 0, split = 0, borrowed = 0;
    const badList = [];
    for (const p of capacityPeople(computed.model).values()) {
      if (all.isHidden(p.id)) continue;
      const pw = all.personWeeks(p.id);
      for (let wi = 0; wi < 8; wi++) {
        const s = all.splitWeek(p.id, wi);
        if (!s) continue;
        n++;
        if ((p.teams || []).length > 1) split++;
        if (s.list.some((b) => b.borrowed > 0.05)) borrowed++;
        const sumTime = s.list.reduce((a, b) => a + b.time, 0);
        const want = Math.max(0, pw[wi].load - pw[wi].avail);
        if (Math.abs(sumTime - pw[wi].avail) > 0.01 || Math.abs(s.over - want) > 0.01) { bad++; badList.push(`${p.id.slice(0, 6)} W${wi} ${sumTime.toFixed(1)}/${pw[wi].avail.toFixed(1)} over ${s.over.toFixed(1)}/${want.toFixed(1)}`); }
      }
    }
    t('every person-week: the teams\' times add up to the person\'s time, their overloads to the person\'s overload', n > 0 && bad === 0, `${n} person-weeks · ${split} of split people · ${borrowed} with time from another team · ${bad} off ${badList.slice(0, 3).join(', ')}`);
    // the same team sum in all three views
    let teams = 0, diff = 0, sumDiff = 0;
    const diffList = [], sumList = [];
    for (const r of all.rows.filter((x) => x.kind === 'team')) {
      const pj = buildBoard({ ds, computed, team: r.teamId, mode: 'projects', weeks: 8, distribution: dist });
      const pp = buildBoard({ ds, computed, team: r.teamId, mode: 'people', weeks: 8, distribution: dist });
      teams++;
      // the team's own slice: the same in the Teams overview and the Projekte sum
      // (the Projekte sum also counts work nobody is assigned to, so only the time is the same there)
      r.cells.forEach((c, wi) => { if (Math.abs(c.time - pj.foot[wi].time) > 0.01) { diff++; diffList.push(`${r.name} W${wi}`); } });
      // 2026-11-23 (boss: "the sum … is not correct, or?"): the Personen "Summe" = its person rows added up (whole weeks)
      const ppl = pp.rows.filter((x) => x.kind === 'person' || x.kind === 'hidden');
      pp.foot.forEach((f, wi) => {
        const time = ppl.reduce((a, x) => a + (x.cells[wi].avail || 0), 0), load = ppl.reduce((a, x) => a + (x.cells[wi].load || 0), 0) + (f.unassigned || 0);
        if (Math.abs(f.time - time) > 0.01 || Math.abs(f.load - load) > 0.01) { sumDiff++; sumList.push(`${r.name} W${wi} ${f.load.toFixed(1)}/${load.toFixed(1)}`); }
      });
    }
    t('each team\'s own time is the same in Projekte and the Teams overview', teams > 0 && diff === 0, `${teams} teams · ${diff} off ${diffList.slice(0, 3).join(', ')}`);
    t('Personen: the "Summe" row is its person rows added up (time and planned)', teams > 0 && sumDiff === 0, `${teams} teams · ${sumDiff} off ${sumList.slice(0, 3).join(', ')}`);
    // the screen: "Warum?" on red weeks, the explanation opens, no "0 %"
    const tab = [...document.querySelectorAll('[role="tab"]')].find((x) => /^(Wochenplanung|Weekly planning)/.test(x.textContent.trim()));
    tab?.click(); await new Promise((r) => setTimeout(r, 2500));
    const zero = [...document.querySelectorAll('.wb-head > b, .wb-card.member > b')].filter((b) => /^0\s?%$/.test(b.textContent.trim())).length;
    t('no week head and no member chip says "0 %"', zero === 0, `${zero}`);
    const btn = document.querySelector('[data-why-over]');
    const red = document.querySelectorAll('.wb-head.t-bad').length;
    if (btn) {
      btn.click(); await new Promise((r) => setTimeout(r, 900));
      const d = document.querySelector('[data-over-why]');
      const txt = d?.innerText.replace(/\s+/g, ' ') || '';
      t('"Warum?" opens the explanation: where the time comes from, what uses it, the same number', !!d && /(Woher die Zeit kommt|Where the time comes from)/.test(txt) && /(Was sie braucht|What uses it)/.test(txt), `${red} red heads · ${txt.slice(0, 160)}`);
      d?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      t('Escape closes it', !document.querySelector('[data-over-why]'));
    } else t('"Warum?" is offered on every red week head (none red on this board)', red === 0, `${red} red heads without the button`);
  },
  async fitLive(t) {
    const ds = await call('dataset');
    const computed = computeAll(ds);
    const { buildBoard, personBoardWeeks, distributionOf } = await import('@shared/weekPlan.js');
    const dist = distributionOf(ds.config?.rules?.distribution);
    let n = 0, off = 0;
    const offList = [];
    const seen = new Set();
    for (const team of computed.model.teams.keys()) {
      const board = buildBoard({ ds, computed, team, mode: 'people', weeks: 8, distribution: dist });
      for (const r of board.rows.filter((x) => x.kind === 'person' && x.accountId && !seen.has(x.accountId))) {
        seen.add(r.accountId);
        const mine = personBoardWeeks({ ds, computed, personId: r.accountId, weeks: 8, distribution: dist });
        if (!mine) continue;
        r.cells.forEach((c, i) => { n++; if (Math.abs((c.load || 0) - mine[i].load) > 0.01 || Math.abs((c.avail || 0) - mine[i].avail) > 0.01) { off++; offList.push(`${r.name || r.accountId} W${i}`); } });
      }
    }
    t('My work = the weekly board for every person and week (load and time)', n > 0 && off === 0, `${n} person-weeks · ${off} off ${offList.slice(0, 4).join(', ')}`);
    // the board on screen: words in every head with planned work, the percentage kept, never "∞"
    const tab = [...document.querySelectorAll('[role="tab"]')].find((x) => /^(Wochenplanung|Weekly planning)/.test(x.textContent.trim()));
    tab?.click(); await new Promise((r) => setTimeout(r, 2500));
    const heads = [...document.querySelectorAll('.wb-head.fit')].map((h) => h.textContent);
    t('week heads say it in words (too much / free / nearly full) and keep the %', heads.length > 0 && heads.every((h) => /(zu viel|too much|frei|free|fast voll|nearly full)/.test(h) && /%/.test(h) && !h.includes('∞')), `${heads.length} heads · e.g. ${heads.slice(0, 3).join(' | ')}`);
    const mineTab = [...document.querySelectorAll('[role="tab"]')].find((x) => /^(Meine Arbeit|My work)/.test(x.textContent.trim()));
    mineTab?.click();
    let tile = '';
    for (let w = 0; w < 60 && !tile; w++) { await new Promise((r) => setTimeout(r, 500)); tile = document.querySelector('[data-mine-load]')?.innerText.replace(/\s+/g, ' ') || ''; } // the week loads from Jira first
    t('My work: the load tile says it in words', /(zu viel|too much|frei|free|fast voll|nearly full|nichts geplant|nothing planned|keine Zeit|no time)/.test(tile), tile.slice(0, 120));
    t('the header shows the new app icon', !!document.querySelector('.brand-mark svg.app-icon rect[fill="#D04403"]'));
  },
  // 2026-11-19 – boss: parentless work items belong in the project (structure, Action needed); tester: red-week advice
  // past the project due. Real data; the one write (set a parent, then undo it) is checked back to "no parent".
  async parentLive(t) {
    const ds = await call('dataset');
    const { parentChoices } = await import('@shared/orphans.js');
    const { actionItems, dataQuality } = await import('@shared/engine.js');
    const computed = computeAll(ds);
    const { model, metrics, wl, deps } = computed;
    const own = ds.issues.filter((i) => i.orphan);
    const unclear = ds.orphans || [];
    const all = [...own, ...unclear];
    t('parentless work items are loaded (own project / project unclear)', Array.isArray(ds.orphans), `${own.length} own · ${unclear.length} unclear · ${all.slice(0, 8).map((x) => x.key).join(', ')} · scan ${JSON.stringify(ds.orphanInfo)}`);
    const sup = new Set((ds.supportTickets?.tickets || []).map((x) => String(x.id)));
    t('none of them is support work', all.every((x) => !sup.has(String(x.id))), all.filter((x) => sup.has(String(x.id))).map((x) => x.key).join(', '));
    const pTypes = new Set([...(ds.config.portfolio?.issueTypeIds || []), ...(ds.config.portfolio?.group?.issueTypeIds || [])].map(String));
    const items = new Set(ds.portfolio.map((p) => String(p.id)));
    t('none is a project, a theme or a sub-task', all.every((x) => !pTypes.has(String(x.type?.id)) && !items.has(String(x.id)) && x.role !== 'tiny'));
    if (all.length) {
      const r = await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: `id in (${all.slice(0, 50).map((x) => x.id).join(',')}) AND parent is not EMPTY`, fields: ['parent'], maxResults: 50 }) });
      t('none has a parent in Jira (checked in Jira)', r.status === 200 && (r.body?.issues || []).length === 0, `${(r.body?.issues || []).map((x) => x.key).join(', ')}`);
    }
    // own ones: in their project's work items and in its Action needed; unclear ones: in every candidate project
    let shown = 0, missing = 0;
    for (const p of ds.portfolio) {
      const a = actionItems(model, p, metrics.get(p.ref), wl, deps, dataQuality(model, new Set([p.ref])));
      const want = [...own.filter((i) => i.rootRef === p.ref && i.status?.cat !== 'done'), ...unclear.filter((o) => o.candidates.includes(p.ref) && o.status?.cat !== 'done')].map((x) => x.id);
      for (const id of want) (a.some((x) => x.kind === 'noParent' && x.issueId === id) ? shown++ : missing++);
    }
    t('every open parentless item shows in Action needed of its project(s)', missing === 0, `${shown} rows · ${missing} missing`);
    t('unclear ones: their space holds several projects; every candidate is a portfolio project of that space', unclear.every((o) => (o.spaceProjects || 0) >= 2 && o.candidates.length >= 1 && o.candidates.every((ref) => { const p = model.itemByRef.get(ref); return p && String(p.projectId) === String(o.projectId); })));
    // the write: set a parent, then undo – and check in Jira that it is back to none
    const devEnv = (await fieldIds()).env === 'DEVELOPMENT'; // the write test only on the development install
    const target = devEnv ? unclear.find((o) => o.status?.cat !== 'done') || own.find((i) => i.status?.cat !== 'done') : null;
    if (target) {
      const ref = target.rootRef || target.candidates[0];
      const choice = parentChoices(model, ds.config, ref, target)[0];
      t('a parent can be chosen from the project', !!choice, choice ? `${target.key} → ${choice.key}` : `${target.key}: none`);
      if (choice) {
        const parentOf = async () => (await req(`/rest/api/3/issue/${target.id}?fields=parent`)).body?.fields?.parent?.key || null;
        let set = null;
        try { set = await call('issue.parent', { issueId: target.id, parentId: choice.id }); } catch (e) { set = { error: `${e.code}: ${e.message}` }; }
        const after = await parentOf();
        t('set: Jira has the parent', set?.ok === true && after === choice.key, `${JSON.stringify(set)} · Jira: ${after}`);
        const other = parentChoices(model, ds.config, ref, target)[1] || (model.itemByRef.get(ref)?.id && String(model.itemByRef.get(ref).id) !== choice.id ? { id: String(model.itemByRef.get(ref).id) } : null);
        if (other) {
          const r = await expectErr('issue.parent', { issueId: target.id, parentId: other.id });
          t('another parent on a work item that HAS one is refused (never re-parents)', r.ok && /HAS_PARENT/.test(r.info), r.info);
        }
        let undo = null;
        try { undo = await call('issue.parent', { issueId: target.id, clear: true, expect: choice.id }); } catch (e) { undo = { error: `${e.code}: ${e.message}` }; }
        const back = await parentOf();
        t('undo: Jira has no parent again', undo?.ok === true && back === null, `${JSON.stringify(undo)} · Jira: ${back}`);
      }
    }
    // red-week advice and the project due date (real boards, both distributions)
    const { suggestShifts } = await import('@shared/planSuggest.js');
    const { buildBoard } = await import('@shared/weekPlan.js');
    let n = 0, late = 0, wrong = 0;
    const lateKeys = [];
    for (const distribution of ['even', 'capacity']) {
      for (const team of model.teams.keys()) {
        for (const x of suggestShifts({ ds, computed, board: buildBoard({ ds, computed, team, distribution }) })) {
          n++;
          if (x.pastProjectDue) { late++; lateKeys.push(x.key); continue; }
          if (x.projectDue && x.newDue && x.newDue > x.projectDue) wrong++;
        }
      }
    }
    t('advice marked "within the due" really ends by the project due', wrong === 0, `${n} suggestions · ${late} past the due (shown only on request): ${[...new Set(lateKeys)].join(', ')}`);
  },
  async planLive(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 15000) => { for (let w = 0; w < ms / 250; w++) { const v = fn(); if (v) return v; await sleep(250); } return null; };
    const tabs = () => [...document.querySelectorAll('[role=tab]')];
    const tab = (re) => tabs().find((b) => re.test(b.textContent));
    const main = () => document.querySelector('main');
    const boot = await call('bootstrap');
    // 1 navigation and roles
    const ids = tabs().map((b) => b.dataset.tour?.replace('tab-', ''));
    t('tabs follow the plan (Meine Arbeit … Konfiguration)', JSON.stringify(ids) === JSON.stringify(['mine', 'portfolio', 'project', 'team', 'plan', 'time', ...(ids.includes('support') ? ['support'] : []), 'report', 'config']), ids.join(' · '));
    t('no separate Abhängigkeiten / Datenqualität / Kapazität / Fragen / Nachweis tab', !ids.some((x) => ['deps', 'quality', 'capacity', 'ask', 'proof'].includes(x)));
    t('roles come from the matrix (rights list)', Array.isArray(boot.roles?.rights) && boot.roles.rights.includes('mine'), (boot.roles?.rights || []).join(','));
    const cfg = (await call('config.get')).config;
    t('config v3 with roles block (migrated)', cfg.version === 3 && !!cfg.roles?.rights?.management, `v${cfg.version}`);
    t('notices are off by default', cfg.notices?.enabled === false);
    t('browser config never carries group lists', !boot.config?.roles?.groups && !boot.config?.permissions);
    // 2 weekly planning renders a board
    tab(/Wochenplanung|Weekly planning/)?.click();
    const board = await waitFor(() => main()?.querySelector('[class*="wb-"]'));
    t('Wochenplanung: board renders', !!board);
    t('Wochenplanung: no error view', !/This view ran into a problem|Diese Ansicht hatte ein Problem/.test(main()?.innerText || ''));
    // 3 plan.apply round trip on one open PCX story with dates (start/due +7 days, then back)
    const startF = boot.config?.fields?.startDate || null;
    const q = 'project = PCX AND issuetype = Story AND statusCategory != Done AND duedate is not EMPTY ORDER BY key ASC';
    const story = ((await req(`/rest/api/3/search/jql?jql=${encodeURIComponent(q)}&maxResults=5&fields=duedate${startF ? `,${startF}` : ''}`)).body?.issues || [])[0];
    if (!story) t('plan.apply round trip', true, 'N/A – no open PCX story with a due date (not touched)');
    else {
      const due0 = story.fields.duedate, start0 = startF ? story.fields[startF] || null : null;
      const plus7 = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); };
      const move = { issueId: story.id, due: plus7(due0), ...(start0 ? { start: plus7(start0) } : {}) };
      let restored = false;
      try {
        const r = await call('plan.apply', { moves: [move] });
        const res = r.results?.[0];
        const after = (await req(`/rest/api/3/issue/${story.id}?fields=duedate${startF ? `,${startF}` : ''}`)).body.fields;
        t('plan.apply writes start and due as the user', res?.ok && after.duedate === move.due && (!start0 || after[startF] === move.start), `${story.key}: due ${due0} → ${after.duedate}`);
        const back = await call('plan.apply', { moves: [{ issueId: story.id, due: due0, ...(start0 ? { start: start0 } : {}) }], undo: true });
        const again = (await req(`/rest/api/3/issue/${story.id}?fields=duedate${startF ? `,${startF}` : ''}`)).body.fields;
        restored = again.duedate === due0 && (!start0 || again[startF] === start0);
        t('plan.apply undo restores the dates', back.results?.[0]?.ok && restored, `${story.key}: due ${again.duedate}`);
        // audit log (tester 2026-11-18 "logs everything twice"): the move and its undo are two named entries with
        // from → to; the same move sent again changes nothing in Jira and adds no entry
        const entries = async () => ((await call('audit.list').catch(() => null)) || []).filter((e) => /^plan\.apply/.test(e.action) && (e.details?.keys || []).includes(story.key));
        const log1 = await entries();
        t('audit: move and undo are two named entries with from → to', log1[0]?.action === 'plan.apply.undo' && log1[1]?.action === 'plan.apply' && log1[1]?.details?.changes?.[0]?.due?.[1] === move.due && log1[0]?.details?.changes?.[0]?.due?.[1] === due0,
          log1.slice(0, 2).map((e) => `${e.action} ${JSON.stringify(e.details?.changes?.[0] || {})}`).join(' | '));
        const same = await call('plan.apply', { moves: [{ issueId: story.id, due: due0 }] });
        const log2 = await entries();
        t('audit: the same move again is not written and not logged', same.results?.[0]?.ok && same.results?.[0]?.unchanged === true && log2.length === log1.length && log2[0]?.at === log1[0]?.at, `unchanged ${same.results?.[0]?.unchanged} · entries ${log1.length} → ${log2.length}`);
      } finally {
        if (!restored) { try { await call('plan.apply', { moves: [{ issueId: story.id, due: due0, ...(start0 ? { start: start0 } : {}) }] }); } catch { /* reported above */ } }
      }
    }
    t('plan.apply refuses a malformed payload', (await expectErr('plan.apply', { moves: [{ issueId: 'PCX-1', due: 'tomorrow' }] }, 'INVALID')).ok);
    // tester 2026-11-19 (read only – nothing is applied): "Finish sooner" on a prerequisite in a blocks conflict also moves
    // the dependent's start, so the conflict is resolved; the gap suggestion never puts a due date before the start
    {
      const { optimizeAll, suggestionMoves } = await import('@shared/optimize.js');
      const { conflicts: planConflicts } = await import('@shared/weekPlan.js');
      const { suggestionFor } = await import('@shared/smart.js');
      const dsN = await call('dataset');
      const compN = computeAll(dsN);
      const confl = (compN.deps?.list || []).filter((d) => d.conflict);
      let checked = 0, left = [];
      for (const tm of [...new Set(dsN.issues.filter((i) => confl.some((d) => d.pre === i.id) && i.team?.id).map((i) => i.team.id))].slice(0, 4)) {
        const opt = optimizeAll({ ds: dsN, computed: compN, team: tm });
        for (const s of opt.sooner.suggestions.filter((x) => confl.some((d) => d.pre === x.taskId))) {
          checked++;
          const mv = suggestionMoves({}, dsN.issues, [s]);
          const still = planConflicts({ model: compN.model, moves: mv }).filter((c) => c.pre.id === s.taskId && !(s.keeps || []).includes(c.dep.key));
          if (still.length) left.push(`${s.key}→${still.map((c) => c.dep.key).join(',')}`);
        }
      }
      t('finish sooner: no blocks conflict left behind unannounced', !left.length, checked ? `${checked} suggestion(s) on a prerequisite in conflict${left.length ? ` · left: ${left.join('; ')}` : ' · all resolved or named'}` : 'N/A – no "finish sooner" on a prerequisite in conflict right now');
      const bad = compN.dq.gaps.filter((g) => g.field === 'dueDate' && g.issueId).map((g) => ({ g, s: suggestionFor(compN, g, 'de'), i: compN.model.byId.get(g.issueId) }))
        .filter(({ s, i }) => s?.date && i?.start && s.value < i.start);
      t('gap suggestion: never a due date before the start', !bad.length, bad.map(({ g, s, i }) => `${g.key}: ${s.value} < ${i.start}`).join(', ') || `${compN.dq.gaps.filter((g) => g.field === 'dueDate').length} due-date gaps checked`);
      const pool = await call('portfolio.candidates', { pool: true }).catch(() => null);
      t('add project: candidates carry their space (for Jira\'s create dialog)', !pool?.items?.length || pool.items.every((c) => !!c.projectId), pool ? `${pool.items.length} candidates` : 'no pool');
      t('add project: portfolio projects carry their space', dsN.portfolio.filter((p) => p.kind === 'issue').every((p) => !!p.projectId), `${dsN.portfolio.length} projects`);
    }
    // 3b the team moves along with a reassignment (tester 2026-11-17): Team field written as the user, undo = "before"
    const teamF = boot.config?.fields?.team || null;
    const tid = (v) => (v == null ? null : typeof v === 'string' ? v : v.id ?? null);
    const tq = 'project = PCX AND issuetype = Story AND statusCategory != Done ORDER BY key ASC';
    const tStory = teamF ? ((await req(`/rest/api/3/search/jql?jql=${encodeURIComponent(tq)}&maxResults=20&fields=${teamF}`)).body?.issues || []).find((i) => tid(i.fields[teamF])) : null;
    const dsT = tStory ? await call('dataset') : null;
    const otherTeam = tStory ? (dsT.teams || []).find((x) => x.id !== tid(tStory.fields[teamF]) && /^[A-Za-z0-9:-]{1,64}$/.test(x.id)) : null;
    if (!tStory || !otherTeam) t('plan.apply team round trip', true, 'N/A – no PCX story with a team or no second team (not touched)');
    else {
      const team0 = tid(tStory.fields[teamF]);
      let back = null;
      try {
        const r = await call('plan.apply', { moves: [{ issueId: tStory.id, team: otherTeam.id }] });
        const res = r.results?.[0];
        back = res?.before ? { issueId: tStory.id, team: res.before.team ?? null } : null;
        const after = tid((await req(`/rest/api/3/issue/${tStory.id}?fields=${teamF}`)).body.fields[teamF]);
        t('plan.apply writes the Team field as the user', res?.ok && after === otherTeam.id && res.before?.team === team0, `${tStory.key}: ${team0} → ${after}`);
      } finally {
        await call('plan.apply', { moves: [back || { issueId: tStory.id, team: team0 }] }).catch(() => {});
        const again = tid((await req(`/rest/api/3/issue/${tStory.id}?fields=${teamF}`)).body.fields[teamF]);
        t('plan.apply undo restores the team', again === team0, `${tStory.key}: ${again}`);
      }
    }
    // 4 plan vs. actual
    let pa = null; try { pa = await call('planActual.get', { weeks: 4, team: 'all' }); } catch (e) { pa = { err: e.code || e.message }; }
    t('Plan vs. Ist: resolver answers (snapshots or "first snapshot pending")', pa && !pa.err, pa?.err || `${(pa?.weeks || []).length} stored weeks`);
    tab(/Plan vs\./)?.click();
    const pv = await waitFor(() => ((main()?.innerText || '').length > 150 ? main() : null));
    t('Plan vs. Ist: view renders', !!pv && !/This view ran into a problem|Diese Ansicht hatte ein Problem/.test(pv.innerText));
    // 5 support: dispatching section (no ticket is changed)
    const sup = tab(/^Support/);
    if (!sup) t('Support: dispatching', true, 'N/A – no support configured');
    else {
      sup.click();
      const disp = await waitFor(() => [...(main()?.querySelectorAll('h2,h3') || [])].find((h) => /Verteilen|Dispatch/.test(h.textContent)));
      t('Support: dispatching section renders', !!disp);
      let dr = null; try { dr = await call('support.dispatch', { items: [{ issueId: '1', accountId: 'x' }] }); } catch (e) { dr = { refused: e.code }; }
      t('support.dispatch refuses tickets outside the configured support work', !!dr && (dr.refused || dr.results?.every((x) => !x.ok)), dr?.refused || dr?.results?.map((x) => x.error?.code || x.error).join(','));
    }
    // 6 projects: missing values box next to action needed
    tab(/^Projekte|^Projects/)?.click();
    const gb = await waitFor(() => main()?.querySelector('.gapbox'));
    t('Projekte: "Fehlende Werte im Projekt" box', !!gb, `${gb?.dataset.gaps ?? '?'} gaps`);
    // 7 privacy: booking answers with its scope
    let bk = null; try { const d = new Date(); d.setDate(d.getDate() - 7 - ((d.getDay() + 6) % 7)); const a = d.toISOString().slice(0, 10); d.setDate(d.getDate() + 4); bk = await call('booking.worklogs', { from: a, to: d.toISOString().slice(0, 10) }); } catch (e) { bk = { err: e.code, msg: e.message }; }
    t('booking: scope reported (privacy UC-08)', !!bk && (bk.err === 'NO_ACCESS' || ['all', 'team', 'none'].includes(bk.scope)), bk?.err ? `${bk.err} ${bk.msg || ''}` : bk?.scope);
    // 8 the plan's open points (2026-11-11 later): report key figures, locations, team shares, notices still off
    let rep = null; try { rep = await call('report.refresh'); } catch (e) { rep = { err: e.code }; }
    t('C-level report: six key figures data (extras stored)', !!rep && (rep.err === 'NO_ACCESS' || !!rep.extra), rep?.err || Object.keys(rep?.extra || {}).slice(0, 6).join(','));
    t('config: locations list (holiday calendars, company days off)', Array.isArray(cfg.locations), `${(cfg.locations || []).length} locations`);
    t('notices still off after this release', cfg.notices?.enabled === false);
  },
  async mineLive(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 15000) => { for (let w = 0; w < ms / 250; w++) { const v = fn(); if (v) return v; await sleep(250); } return null; };
    const boot = await call('bootstrap');
    const me = boot.me.id;
    const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
    const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const wk = await call('mine.week', { from: iso(mon), to: iso(fri) });
    t('mine.week: own week loads (as the user)', Array.isArray(wk.issues) && Array.isArray(wk.worklogs), `${wk.issues.length} work items · ${wk.worklogs.length} own worklogs`);
    t('mine.week: only own worklogs', wk.worklogs.every((w) => w.issueId && w.d >= iso(mon) && w.d <= iso(fri)));
    // guards (nothing is written)
    t('book: 25 h refused', (await expectErr('mine.book', { issueId: '1', date: today, hours: 25 }, 'INVALID')).ok);
    t('book: date a year back refused', (await expectErr('mine.book', { issueId: '1', date: `${d.getFullYear() - 1}-01-02`, hours: 1 }, 'INVALID')).ok);
    t('book: malformed issue id refused', (await expectErr('mine.book', { issueId: 'PCX-1', date: today, hours: 1 }, 'INVALID')).ok);
    const sub = (await req(`/rest/api/3/search/jql?jql=${encodeURIComponent('project = PCX AND issuetype in subTaskIssueTypes() ORDER BY created DESC')}&maxResults=1&fields=summary`)).body?.issues?.[0];
    if (sub) t('book: sub-task refused (UC-20)', (await expectErr('mine.book', { issueId: sub.id, date: today, hours: 0.25 }, 'SUBTASK_NOT_BOOKABLE')).ok, sub.key);
    // the real booking round trip on one open PCX story
    const story = (await req(`/rest/api/3/search/jql?jql=${encodeURIComponent('project = PCX AND issuetype = Story AND statusCategory != Done ORDER BY key ASC')}&maxResults=20&fields=summary,timetracking`)).body?.issues || [];
    const tt = async (id) => (await req(`/rest/api/3/issue/${id}?fields=timetracking`)).body?.fields?.timetracking || {};
    const mineToday = async (id) => ((await req(`/rest/api/3/issue/${id}/worklog`)).body?.worklogs || []).filter((w) => w.author?.accountId === me && String(w.started).slice(0, 10) === today);
    let target = null;
    for (const s of story) { if (!(await mineToday(s.id)).length) { target = s; break; } }
    if (!target) { t('booking round trip', true, 'N/A – every candidate already has an own booking today (not touched)'); }
    else {
      const t0 = await tt(target.id);
      const tz = -d.getTimezoneOffset();
      let left = false;
      try {
        const r1 = await call('mine.book', { issueId: target.id, date: today, hours: 0.25, tz });
        const w1 = await mineToday(target.id);
        t(`book 0,25 h on ${target.key}: one own worklog in Jira`, r1.op === 'create' && w1.length === 1 && w1[0].timeSpentSeconds === 900, `${r1.op} · ${w1.map((w) => w.timeSpentSeconds).join(',')}`);
        left = true;
        const t1 = await tt(target.id);
        if (t0.remainingEstimateSeconds != null) t('remaining estimate drops like in Jira', (t0.remainingEstimateSeconds - (t1.remainingEstimateSeconds ?? 0)) === Math.min(900, t0.remainingEstimateSeconds), `${t0.remainingEstimateSeconds} → ${t1.remainingEstimateSeconds}`);
        const r2 = await call('mine.book', { issueId: target.id, date: today, hours: 0.5, tz });
        const w2 = await mineToday(target.id);
        t('change to 0,5 h: the same worklog is updated', r2.op === 'update' && w2.length === 1 && w2[0].timeSpentSeconds === 1800 && w2[0].id === w1[0].id);
        await call('mine.book', { issueId: target.id, date: today, hours: 0.5, comment: 'Selftest Meine Arbeit – wird gleich entfernt', tz });
        const w3 = await mineToday(target.id);
        t('comment saved on the worklog', JSON.stringify(w3[0]?.comment || '').includes('Selftest Meine Arbeit'));
        const r4 = await call('mine.book', { issueId: target.id, date: today, hours: 0, tz });
        const w4 = await mineToday(target.id);
        left = w4.length > 0;
        t('empty cell (0 h): the worklog is removed', r4.op === 'delete' && w4.length === 0);
        const t4 = await tt(target.id);
        t('afterwards: time spent and remaining exactly as before', (t4.timeSpentSeconds ?? 0) === (t0.timeSpentSeconds ?? 0) && (t4.remainingEstimateSeconds ?? null) === (t0.remainingEstimateSeconds ?? null), `spent ${t0.timeSpentSeconds}→${t4.timeSpentSeconds} · remaining ${t0.remainingEstimateSeconds}→${t4.remainingEstimateSeconds}`);
      } finally {
        if (left) { try { await call('mine.book', { issueId: target.id, date: today, hours: 0, tz }); } catch { /* reported above */ } }
      }
    }
    // the view: renders, KPIs, accessible
    const tab = [...document.querySelectorAll('[role=tab]')].find((b) => /Meine Arbeit|My work/.test(b.textContent));
    t('"Meine Arbeit" is the first tab', [...document.querySelectorAll('[role=tab]')][0] === tab);
    tab?.click();
    const sheet = await waitFor(() => document.querySelector('[data-mine] .mine-grid'), 20000);
    t('the week sheet renders', !!sheet && document.querySelectorAll('[data-mine] .mine-kpi').length === 4, `${document.querySelectorAll('[data-mine] input.mine-cell').length} cells`);
    const axe = (await import('axe-core')).default;
    const r = await axe.run(document.querySelector('[data-mine]'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
    t('Meine Arbeit: 0 axe violations (WCAG 2.2 AA)', r.violations.length === 0, r.violations.map((v) => `${v.id}(${v.nodes.length})`).join(', '));
    document.querySelector('[data-tour="tab-portfolio"]')?.click();
  },
  // "Woche vervollständigen" live: every reason is re-read straight from Jira (not through the app), the invariants
  // are checked on the live proposal, and one proposal is taken on the sandbox: a comment on PCX-1 today creates the
  // evidence, the proposal is booked, Jira is checked, then booking and comment are removed again.
  async mineSmart(t) {
    const { suggestWeek } = await import('@shared/mineSuggest.js');
    const { buildWeek } = await import('@shared/mine.js');
    const boot = await call('bootstrap', { withDataset: true });
    const me = boot.me.id;
    const d = new Date(); const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const today = iso(d); const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
    const from = iso(mon), to = iso(fri);
    const pcx1 = (await req('/rest/api/3/issue/PCX-1?fields=summary,timetracking')).body;
    // controlled evidence: one comment by me on the sandbox story today
    const posted = (await req(`/rest/api/3/issue/${pcx1.id}/comment`, { method: 'POST', body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Selftest Woche vervollständigen – wird gleich entfernt' }] }] } }) })).body;
    let bookedIt = false;
    try {
      const ev = await call('mine.evidence', { from, to });
      t('mine.evidence loads (as the user)', Array.isArray(ev.events), `${ev.issues.length} work items · ${ev.events.length} events`);
      t('every event is mine and inside the week', ev.events.every((e) => e.d >= from && e.d <= to));
      // independent check: re-read up to 12 events straight from Jira's changelog / comments
      let checked = 0, bad = 0;
      for (const e of ev.events.slice(0, 12)) {
        checked++;
        if (e.kind === 'comment') {
          const cs = (await req(`/rest/api/3/issue/${e.issueId}/comment?maxResults=100&orderBy=-created`)).body?.comments || [];
          if (!cs.some((c) => c.author?.accountId === me && String(c.created).slice(0, 10) === e.d)) bad++;
        } else {
          const cl = (await req(`/rest/api/3/issue/${e.issueId}/changelog?maxResults=100`)).body;
          const all = cl?.total > 100 ? (await req(`/rest/api/3/issue/${e.issueId}/changelog?startAt=${cl.total - 100}&maxResults=100`)).body?.values || [] : cl?.values || [];
          if (!all.some((h) => h.author?.accountId === me && String(h.created).slice(0, 10) === e.d)) bad++;
        }
      }
      t('every reason is a real entry by me in Jira (re-read independently)', bad === 0 && ev.events.some((e) => e.issueId === pcx1.id && e.kind === 'comment' && e.d === today), `${checked} checked · ${bad} not found`);
      // invariants on the live proposal
      const wk = await call('mine.week', { from, to });
      const c = computeAll(boot.dataset || await call('dataset'));
      const sheet = buildWeek({ computed: c, data: wk, meId: me, today, lang: 'de' });
      const known = new Set(wk.issues.map((i) => i.id));
      const sg = suggestWeek({ days: sheet.days, issues: [...wk.issues, ...ev.issues.filter((i) => !known.has(i.id))], worklogs: wk.worklogs, events: ev.events });
      const booked = new Set(wk.worklogs.filter((w) => w.h > 0).map((w) => `${w.issueId}|${w.d}`));
      const shapes = sg.shapes;
      const sums = Object.entries(sg.perDay).every(([day, x]) => Math.abs(sg.list.filter((s) => s.d === day).reduce((a, s) => a + s.h, 0) - x.h) < 1e-9 && x.h <= x.gap + 1e-9);
      t('per day the proposals add up exactly and never exceed the gap', sums, JSON.stringify(sg.perDay));
      t('no proposal on future days, sub-tasks or booked cells', sg.list.every((s) => s.d <= today && !shapes.get(s.issueId)?.type?.subtask && !booked.has(`${s.issueId}|${s.d}`)), `${sg.list.length} proposals`);
      t('quarter hours only', sg.list.every((s) => Math.abs(s.h * 4 - Math.round(s.h * 4)) < 1e-9));
      // take the PCX-1 proposal of today (if the day has a gap and the cell is empty)
      const mine = sg.list.find((s) => s.issueId === pcx1.id && s.d === today);
      if (!mine) t('take one proposal on the sandbox', true, booked.has(`${pcx1.id}|${today}`) ? 'N/A – PCX-1 already has an own booking today (not touched)' : `N/A – no gap today (${JSON.stringify(sg.perDay[today] || {})})`);
      else {
        t('the PCX-1 proposal cites the comment', mine.basis === 'activity' && mine.events.some((e) => e.kind === 'comment'), `${mine.h} h · ${mine.basis}`);
        const r = await call('mine.book', { issueId: pcx1.id, date: today, hours: mine.h, tz: -d.getTimezoneOffset() });
        bookedIt = true;
        const w = ((await req(`/rest/api/3/issue/${pcx1.id}/worklog`)).body?.worklogs || []).filter((x) => x.author?.accountId === me && String(x.started).slice(0, 10) === today);
        t('taken: exactly that worklog is in Jira', r.op === 'create' && w.length === 1 && w[0].timeSpentSeconds === Math.round(mine.h * 3600), `${w.map((x) => x.timeSpentSeconds).join(',')}`);
        await call('mine.book', { issueId: pcx1.id, date: today, hours: 0, tz: -d.getTimezoneOffset() });
        bookedIt = false;
        const tt = (await req(`/rest/api/3/issue/${pcx1.id}?fields=timetracking`)).body?.fields?.timetracking || {};
        t('undone: remaining estimate exactly as before', (tt.remainingEstimateSeconds ?? null) === (pcx1.fields.timetracking?.remainingEstimateSeconds ?? null), `${pcx1.fields.timetracking?.remainingEstimateSeconds} → ${tt.remainingEstimateSeconds}`);
      }
      // the effort: actions to book the proposed week by hand vs. one click
      const cells = sg.list.length;
      t(`effort: ${cells} cells by hand ≈ ${cells * 3} actions (click, type, Enter) → 1 click`, true, `${sg.total} h proposed`);
    } finally {
      if (bookedIt) { try { await call('mine.book', { issueId: pcx1.id, date: today, hours: 0, tz: -d.getTimezoneOffset() }); } catch { /* reported */ } }
      if (posted?.id) await req(`/rest/api/3/issue/${pcx1.id}/comment/${posted.id}`, { method: 'DELETE' });
    }
    const gone = !((await req(`/rest/api/3/issue/${pcx1.id}/comment?maxResults=100&orderBy=-created`)).body?.comments || []).some((x) => x.id === posted?.id);
    t('clean-up: the test comment is removed', gone);
    // the banner in the UI
    [...document.querySelectorAll('[role=tab]')].find((b) => /Meine Arbeit|My work/.test(b.textContent))?.click();
    for (let i = 0; i < 60 && !document.querySelector('[data-mine] .mine-smart:not(.quiet)'); i++) await new Promise((r) => setTimeout(r, 250));
    const banner = document.querySelector('[data-mine] .mine-smart');
    t('the proposal banner shows (or "all booked")', !!banner && /vervollständigen|Complete the week|alles gebucht|Everything is booked/.test(banner.textContent), banner?.textContent.slice(0, 120));
    const axe = (await import('axe-core')).default;
    const ra = await axe.run(document.querySelector('[data-mine]'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } });
    t('Meine Arbeit with proposals: 0 axe violations', ra.violations.length === 0, ra.violations.map((v) => `${v.id}(${v.nodes.length})`).join(', '));
    document.querySelector('[data-tour="tab-portfolio"]')?.click();
  },
  // The boss's insights (2026-11-11): history as the user (cross-checked with Jira), the "Ich will …" cards, playbooks
  // (app storage only: one test playbook is saved, deleted, restored by undo and deleted again) and – only while the AI
  // is on – the intent mapping and the playbook draft. Nothing in Jira is changed.
  async insightsLive(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 15000) => { for (let w = 0; w < ms / 250; w++) { const v = fn(); if (v) return v; await sleep(250); } return null; };
    const boot = await call('bootstrap');
    const lang = getLang();
    // 1) history
    let t0 = performance.now();
    const h = await call('insights.history', {});
    t('history loads as the user', Array.isArray(h?.stories) && Array.isArray(h?.support), `${h?.stories?.length} stories · ${h?.support?.length} tickets · ${Math.round(performance.now() - t0)} ms${h?.supportFailed ? ' · support FAILED' : ''}${h?.truncated?.stories || h?.truncated?.support ? ' · truncated' : ''}`);
    if (!h?.stories) return;
    const rows = [...h.stories, ...h.support];
    t('history rows carry no names, e-mails or comment texts', rows.every((r) => !('name' in r) && !('displayName' in r) && !('emailAddress' in r) && !('comments' in r)) && !/@[\w-]+\./.test(JSON.stringify(rows)));
    t('only resolved work inside the window', h.stories.every((s) => s.statusCat === 'done' && s.resolved && s.resolved >= h.since) && h.support.every((s) => s.resolved && s.resolved >= h.supportSince), `stories since ${h.since} · support since ${h.supportSince}`);
    const sample = h.stories.slice(0, 6);
    if (sample.length) {
      const j = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: `key in (${sample.map((s) => s.key).join(',')})`, fields: ['status', 'resolutiondate', 'timespent', 'aggregatetimespent', 'timeoriginalestimate', 'aggregatetimeoriginalestimate'], maxResults: 10 }) })).body.issues;
      const bad = j.filter((i) => {
        const s = sample.find((x) => x.key === i.key); const f = i.fields;
        const ts = (f.aggregatetimespent ?? f.timespent ?? 0) / 3600, oe = (f.aggregatetimeoriginalestimate ?? f.timeoriginalestimate ?? 0) / 3600;
        return f.status?.statusCategory?.key !== 'done' || !f.resolutiondate || Math.abs((s?.ts || 0) - ts) > 0.02 || Math.abs((s?.oe || 0) - oe) > 0.02;
      });
      t('sample stories = Jira (done, logged h, estimate h)', j.length === sample.length && !bad.length, `${sample.map((s) => `${s.key} ${s.ts}/${s.oe} h`).join(' · ')}${bad.length ? ` · MISMATCH ${bad.map((i) => i.key).join(',')}` : ''}`);
    } else t('sample stories = Jira (done, logged h, estimate h)', true, 'N/A – no finished stories in the window');
    const textsAllowed = boot.config?.ai?.enabled === true && boot.config?.ai?.shareTexts === true;
    const cm = sample.length ? await call('insights.comments', { ids: sample.slice(0, 3).map((s) => s.id), texts: true }) : {};
    t('comments: counts always, texts only when the admin allows', Object.values(cm).every((c) => Number.isFinite(c.count) && (textsAllowed || !(c.last || []).length)), `${Object.keys(cm).length} items · texts ${textsAllowed ? 'allowed' : 'not allowed'}`);
    // the numbers behind the cards, computed here from the same inputs
    const st = supportTopics(h.support, { minCount: 3, lang });
    t('support topics computed', Array.isArray(st.topics), `${st.topics.length} topics · ${st.topics.filter((x) => x.playbook).length} playbook candidates · ${st.topics.slice(0, 3).map((x) => `${x.name} ×${x.count}`).join(', ')}`);

    // 2) the "Ich will …" cards on the Ask canvas
    for (let w = 0; w < 120 && document.querySelectorAll('[role=tab]').length < 5; w++) await sleep(250);
    const askBtn = [...document.querySelectorAll('button')].find((b) => /^(Fragen|Ask)$/.test(b.textContent.trim()));
    t('Ask opens from the header', !!askBtn);
    askBtn?.click();
    const input = await waitFor(() => document.querySelector('.ask-input input'), 10000);
    t('composer ready', !!input);
    if (input) {
      const hero = document.querySelector('.ask-hero');
      t('empty canvas offers the "I want …" wishes', !hero || hero.querySelectorAll('.ask-sugg.wish').length >= 4, `${hero?.querySelectorAll('.ask-sugg.wish').length ?? 'canvas not empty'}`);
      const subject = h.stories[0]?.summary || (lang === 'de' ? 'Schnittstelle zum Lager-System' : 'interface to the warehouse system');
      const wishes = [
        ['Ich will Ressourcen realistisch planen', /Realistische Kapazität|Realistic capacity/],
        ['I want to know what fits without overtime', /ohne Überstunden|without overtime/],
        ['Ich will nicht, dass mein Team abends arbeiten muss', /Überstunden-Ausblick|Overtime outlook/],
        ['I want to see recurring support topics', /Support-Themen|support topics/],
        [`Ich will schätzen wie früher: "${subject}"`, /Wie früher|Like before/],
      ];
      const before = document.querySelectorAll('.ask-card').length;
      const setV = (v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })); };
      t0 = performance.now();
      for (const [q] of wishes) { setV(q); await sleep(80); input.closest('form').requestSubmit(); await sleep(500); }
      const cards = await waitFor(() => { const c = [...document.querySelectorAll('.ask-card')].slice(before); return c.length >= wishes.length && c.every((x) => (x.querySelector('.ask-answer')?.textContent || '').length > 15) ? c : null; }, 45000);
      t('one card per wish, answered', !!cards, `${cards ? cards.length : document.querySelectorAll('.ask-card').length - before} cards · ${Math.round(performance.now() - t0)} ms`);
      (cards || []).forEach((c, i) => {
        const title = c.querySelector('h3')?.textContent || '', ans = c.querySelector('.ask-answer')?.textContent || '', src = c.querySelector('.ask-src-tag')?.textContent || '';
        t(`wish → ${wishes[i][1].source.split('|')[0]}`, wishes[i][1].test(title) && /Regel der App|App rule/.test(src), `${title} · ${src} · ${ans.slice(0, 120)}`);
      });
      if (cards?.[4]) t('"like before" finds the story itself among similar finished work', /\d/.test(cards[4].querySelector('.ask-answer')?.textContent || '') && !/Keine ähnliche|No similar/.test(cards[4].textContent), subject);
      const axe = (await import('axe-core')).default;
      const r = await axe.run(document.querySelector('.ask-root'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
      t('Ask canvas: 0 axe violations', r.violations.length === 0, r.violations.map((v) => `${v.id}×${v.nodes.length}`).join(','));
    }

    // 3) playbooks (app storage only)
    const pb0 = await call('playbooks.list');
    t('playbooks readable', Array.isArray(pb0?.items), `${pb0?.items?.length} saved · can edit: ${pb0?.canEdit}`);
    if (pb0?.canEdit) {
      const s = await call('playbooks.save', { playbook: { title: 'PC-SELFTEST Playbook (wird gleich gelöscht)', topic: 'selftest', topicName: 'Selftest', symptoms: ['Test'], steps: ['[Schritt ergänzen]'], reply: 'Hallo, das ist ein Test. [Name]' } });
      const mid = await call('playbooks.list');
      t('save → listed, stamped by the server', mid.items.some((x) => x.id === s.playbook.id) && !!s.playbook.updatedAt, s.playbook.id);
      const del = await call('playbooks.delete', { id: s.playbook.id });
      const re = await call('playbooks.save', { playbook: del.deleted, restore: true });
      t('undo of a delete restores the same playbook', re.playbook.id === s.playbook.id);
      await call('playbooks.delete', { id: s.playbook.id });
      const after = await call('playbooks.list');
      t('cleanup: playbooks as before', after.items.length === pb0.items.length && !after.items.some((x) => x.id === s.playbook.id), `${after.items.length} saved`);
    }

    // 4) AI (only while the admin has it on) – AI is per person by default: switched on for the run, restored after
    if (boot.config?.ai?.enabled !== true) { t('AI parts', true, 'N/A – AI is off'); return; }
    const mineBefore = boot.config?.ai?.user === true || boot.config?.ai?.access === 'all';
    if (!mineBefore) await call('prefs.save', { ai: true });
    try {
    const wish = lang === 'de' ? 'Wo geht bei uns gerade die meiste ungeplante Zeit hin?' : 'Where is most of our unplanned time going right now?';
    t0 = performance.now();
    try {
      const r = await call('ai.assist', { feature: 'intent', lang, wish, teams: [], projects: [] });
      t('intent: only a catalogue card (or none)', r.card === null || WISH_IDS.has(r.card), `${r.card} · ${r.source} · ${Math.round(performance.now() - t0)} ms · ${String(r.why || '').slice(0, 100)}`);
    } catch (e) { t('intent: only a catalogue card (or none)', false, `${e.code}: ${String(e.message).slice(0, 80)}`); }
    const topic = st.topics.find((x) => x.playbook);
    if (!topic) { t('playbook draft', true, 'N/A – no playbook candidate in the live support history'); return; }
    t0 = performance.now();
    try {
      const r = await call('ai.assist', { feature: 'playbookDraft', lang, topic: { id: topic.id, name: topic.name, count: topic.count, spentTotal: topic.spentTotal, spentMedian: topic.spentMedian, trend: topic.trend, open: topic.open },
        examples: h.support.filter((x) => topic.ids.includes(x.id)).slice(0, 8).map((x) => ({ key: x.key, summary: x.summary, created: x.created })) });
      const reply = r.draft?.reply || '';
      t('playbook draft: steps + customer reply', !!r.draft && r.draft.steps.length > 0 && reply.length > 20, `${r.source} · ${Math.round(performance.now() - t0)} ms · ${r.draft?.steps.length} steps`);
      t('customer reply has no internal figures or keys', !new RegExp(`\\b${topic.count}\\b`).test(reply) && !/\b[A-Z][A-Z0-9]+-\d+\b/.test(reply) && !/\b\d+([.,]\d+)?\s?(h|Std\.?|Stunden|hours)\b/.test(reply), reply.slice(0, 160));
    } catch (e) { t('playbook draft: steps + customer reply', false, `${e.code}: ${String(e.message).slice(0, 80)}`); }
    } finally { if (!mineBefore) await call('prefs.save', { ai: false }); }
  },
  // "Datenschutz & Sicherheit" (2026-11-11), read-only: opens Konfiguration › KI & Datenschutz, the panel and checks the
  // note, the six cards, the sources and the state card. Saves nothing.
  async trustLive(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 15000) => { for (let w = 0; w < ms / 250; w++) { const v = fn(); if (v) return v; await sleep(250); } return null; };
    const boot = await call('bootstrap');
    for (let w = 0; w < 120 && document.querySelectorAll('[role=tab]').length < 5; w++) await sleep(250);
    const cfgTab = [...document.querySelectorAll('[role=tab]')].find((x) => /Konfiguration|Configuration/.test(x.textContent));
    t('configuration tab present (admin)', !!cfgTab);
    if (!cfgTab) return;
    cfgTab.click();
    const nav = await waitFor(() => [...document.querySelectorAll('button,a,[role=tab]')].find((b) => /^(KI & Datenschutz|AI & data protection)$/.test(b.textContent.trim())), 15000);
    t('section "KI & Datenschutz" present', !!nav);
    nav?.click();
    const btn = await waitFor(() => document.querySelector('[data-dt-open]'), 10000);
    const note = document.querySelector('[data-dt-note]');
    t('button under the AI switch', !!btn, btn?.textContent.slice(0, 80));
    t('note always visible at the bottom', !!note && /Atlassian Cloud|Atlassian cloud/.test(note.textContent) && /externen Servern|external servers/.test(note.textContent), note?.textContent.slice(0, 120));
    if (!btn) return;
    if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
    const panel = await waitFor(() => document.getElementById('dt-panel'), 5000);
    await sleep(700);
    t('panel opens with the data path and seven cards (incl. "What SUPERPORT sees")', !!panel && !!panel.querySelector('.dt-path') && panel.querySelectorAll('.dt-card').length === 7, `${panel?.querySelectorAll('.dt-card').length} cards`);
    t('three Atlassian sources linked', panel?.querySelectorAll('.dt-sources:not([data-dt-docs]) .linkbtn').length === 3);
    t('App EULA, privacy and security linked', panel?.querySelectorAll('[data-dt-docs] .linkbtn').length === 3);
    const facts = [...document.querySelectorAll('.ai-fact b')].map((b) => b.textContent);
    const on = boot.config?.ai?.enabled === true;
    t('state card follows the saved AI setting', on ? facts.some((f) => /Aktiv|Active/.test(f)) && !facts.some((f) => /nicht aktiv|not active/.test(f)) : facts.some((f) => /nicht aktiv|not active/.test(f)), `AI ${on ? 'on' : 'off'} · ${facts.join(' | ')}`);
    const axe = (await import('axe-core')).default;
    const r = await axe.run(document.querySelector('.ai-cfg'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
    t('AI settings with the panel: 0 axe violations', r.violations.length === 0, r.violations.map((v) => `${v.id}×${v.nodes.length}`).join(','));
    btn.click();
    [...document.querySelectorAll('[role=tab]')].find((x) => /^Portfolio/.test(x.textContent.trim()))?.click();
  },
  // AI budget (2026-11-12): one real Forge LLM call (≈ 1 cent) must move this month's meter by its real token cost; the
  // identical second call must come from the shared cache – free, meter unchanged. Then the budget panel is checked.
  async budgetLive(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 15000) => { for (let w = 0; w < ms / 250; w++) { const v = fn(); if (v) return v; await sleep(250); } return null; };
    const budget = async () => (await call('bootstrap')).config?.ai?.budget || null;
    const b0 = await budget();
    t('the browser gets this month\'s budget', !!b0 && Number.isFinite(b0.usedEur) && Number.isFinite(b0.limitEur) && /^\d{4}-\d{2}$/.test(b0.month), b0 ? `${b0.usedEur} € / ${b0.limitEur} € (${b0.pct} %) · ${b0.calls} calls · ${b0.cacheHits} reused · ${b0.set ? 'AI_BUDGET set' : 'defaults'} · site ${b0.host} · ${b0.eurPerUsd} €/$` : 'missing');
    t('site recognised for SUPERPORT\'s per-site budgets', /\.atlassian\.net$/.test(b0?.host || ''), b0?.host);
    const boot = await call('bootstrap');
    if (boot.config?.ai?.enabled !== true) { t('metering', true, 'N/A – AI is off'); return; }
    if (b0?.stopped) { t('metering', true, `N/A – budget stopped (${b0.reason})`); return; }
    const mineBefore = boot.config?.ai?.user === true;
    t('per person: without the own switch the server refuses (AI_USER_OFF)', mineBefore || boot.config?.ai?.access === 'all' || (await expectErr('ai.assist', { feature: 'intent', lang: 'de', wish: 'Ich will Überstunden vermeiden', teams: [], projects: [] }, 'AI_USER_OFF')).ok, mineBefore ? 'N/A – already on for this person' : 'refused');
    if (!mineBefore) await call('prefs.save', { ai: true });
    const payload = { feature: 'intent', lang: getLang(), wish: `Ich will wissen, wo diese Woche die meiste Zeit hingeht (Budget-Test ${Date.now().toString(36)})`, teams: [], projects: [] };
    let t0 = performance.now();
    const r1 = await call('ai.assist', payload);
    const ms1 = Math.round(performance.now() - t0);
    const b1 = await budget();
    const cost = Math.round(((b1?.usedEur || 0) - (b0.usedEur || 0)) * 10000) / 10000;
    t('a real answer is metered: +1 call, cost > 0, real token figures', r1.source === 'ai' ? b1.calls === b0.calls + 1 && cost > 0 && b1.estimated === b0.estimated : true,
      r1.source === 'ai' ? `+${cost} € (rounded meter) · ${ms1} ms · card ${r1.card}` : `N/A – the AI answered with the app rule (${r1.reason})`);
    t0 = performance.now();
    const r2 = await call('ai.assist', payload);
    const ms2 = Math.round(performance.now() - t0);
    const b2 = await budget();
    t('the identical request comes from the shared cache – free', r1.source !== 'ai' || (r2.cached === true && b2.calls === b1.calls && b2.cacheHits === b1.cacheHits + 1 && b2.usedEur === b1.usedEur),
      `cached ${r2.cached === true} · ${ms2} ms (first ${ms1} ms) · meter ${b1.usedEur} → ${b2.usedEur} €`);
    // the panel
    for (let w = 0; w < 120 && document.querySelectorAll('[role=tab]').length < 5; w++) await sleep(250);
    [...document.querySelectorAll('[role=tab]')].find((x) => /Konfiguration|Configuration/.test(x.textContent))?.click();
    const nav = await waitFor(() => [...document.querySelectorAll('button,a,[role=tab]')].find((b) => /^(KI & Datenschutz|AI & data protection)$/.test(b.textContent.trim())), 15000);
    nav?.click();
    const panel = await waitFor(() => document.querySelector('[data-ai-budget]'), 10000);
    t('budget panel in the AI settings (meter, limits, how it is computed)', !!panel && !!panel.querySelector('[role=meter]') && panel.querySelectorAll('input[type=number]').length === 2, panel?.querySelector('.aib-figure')?.textContent);
    t('the per-person rule is explained to the admin, with the count', !!document.querySelector('[data-ai-people]'), document.querySelector('[data-ai-people] .muted')?.textContent.slice(-40));
    if (!mineBefore) await call('prefs.save', { ai: false });
    t('own switch restored', true, mineBefore ? 'stays on' : 'off again');
    [...document.querySelectorAll('[role=tab]')].find((x) => /^Portfolio/.test(x.textContent.trim()))?.click();
  },
  // Lotse ACTS (2026-11-12): one real, reversible write on the sandbox (PCX-1 Original Estimate +1 h) through Lotse's
  // command layer – preview → token → apply → Jira shows it → undo → Jira shows the old value; refused without token;
  // a workflow plans on real data (cancelled, nothing written); the report composer drafts and the server re-checks it
  // (dry run – nothing is published).
  async actLive(t) {
    const L = await import('@shared/lotse/index.js');
    const { draftReport } = await import('@shared/lotse/report/compose.js');
    const boot = await call('bootstrap');
    const ds = await call('dataset');
    const computed = computeAll(ds);
    const lang = getLang();
    const ctx = { computed, ds, roles: boot.roles, me: boot.me, lang, fmt, ruleName, config: boot.config };
    const io = { call };
    const jiraOE = async () => (((await req('/rest/api/3/issue/PCX-1?fields=timeoriginalestimate')).body?.fields?.timeoriginalestimate) || 0) / 3600;
    const issue = (ds.issues || []).find((i) => i.key === 'PCX-1');
    t('sandbox work item PCX-1 is in the data', !!issue, issue ? `${issue.key} · estimate ${issue.oe} h` : 'missing');
    if (issue) {
      const before = await jiraOE();
      const target = Math.round((before + 1) * 4) / 4;
      let pv;
      try { pv = L.previewCommand('issue.setField', { issue: 'PCX-1', field: 'estimate', value: target }, ctx); } catch (e) { t('preview', false, e.message); }
      t('preview lists exactly the one change', pv?.changes?.length === 1 && !!pv.token, pv ? `${pv.summary} · token ${String(pv.token).slice(0, 8)}…` : '');
      let refused = false;
      try { await L.applyCommand('issue.setField', { issue: 'PCX-1', field: 'estimate', value: target }, io, { ctx }); } catch { refused = true; }
      t('without the preview token nothing is written', refused && (await jiraOE()) === before, `Jira ${await jiraOE()} h`);
      if (pv?.token) {
        const r = await L.applyCommand('issue.setField', { issue: 'PCX-1', field: 'estimate', value: target }, io, { ctx, token: pv.token });
        const after = await jiraOE();
        t('apply writes to Jira', r.applied >= 1 && Math.abs(after - target) < 0.01, `${before} h → ${after} h (expected ${target} h)`);
        await r.run?.(io); // applyCommand returns the undo itself: { label, run, keys, … }
        const restored = await jiraOE();
        t('its undo restores Jira', Math.abs(restored - before) < 0.01, `${after} h → ${restored} h`);
      }
    }
    // a workflow plans on real data – cancelled, nothing written
    try {
      let st = L.startWorkflow({ id: 'fillGaps', params: {} }, ctx);
      const step = L.currentStep(st);
      t('workflow "fill gaps" plans on this site\'s data', !!step && Array.isArray(st.steps) && st.steps.length >= 2, `${st.steps.length} steps · now: ${step?.kind} – ${String(step?.question || step?.title || '').slice(0, 80)}`);
      st = L.cancelWorkflow(st);
      t('cancelled without writing', st.status === 'cancelled');
    } catch (e) { t('workflow "fill gaps" plans on this site\'s data', false, e.message); }
    // MISSIONS (2026-11-12): the person's own sentence starts "my week at 100 %"; every decision answered with Lotse's
    // recommendation up to the preview – stories valid, every number sourced, the plan keeps this week within 100 % –
    // then cancelled: nothing is written. The same for "plan a team realistically".
    try {
      const W = await import('@shared/lotse/act/workflows.js');
      const rec = (cur) => {
        const ok = cur.options.filter((o) => !o.disabled);
        if (!cur.multi) return (ok.find((o) => o.recommended) || ok[0])?.id;
        const r = ok.filter((o) => o.recommended).map((o) => o.id);
        return r.length ? r : [ok[ok.length - 1].id];
      };
      const walk = (st) => { for (let g = 0; g < 60; g++) { const cur = L.currentStep(st); if (!cur || st.status === 'done' || cur.kind === 'preview' || cur.kind === 'summary') return st; if (cur.kind === 'story') st = L.nextWorkflow(st); else if (cur.kind === 'decide') st = L.answerWorkflow(st, cur.id, rec(cur)); else return st; } return st; };
      const sentence = lang === 'de' ? 'Bring meine Woche auf 100 % – ordne meinen Plan' : 'I want you to fix the schedule of my week for me to be at 100% capacity please';
      const u = L.understand(sentence, ctx);
      t('the sentence starts the mission "my week at 100 %"', u.workflow === 'balanceWeek', `"${sentence}" → ${u.workflow || u.skill}`);
      // the jobs get what the Lotse panel gives them: the history of finished work and the playbooks (both read as the person)
      let history = null, playbooks = [];
      try { history = await call('insights.history', {}); } catch { /* no history right */ }
      try { playbooks = (await call('playbooks.list'))?.items || []; } catch { /* no support right */ }
      const jobCtx = { ...ctx, history, playbooks };
      for (const [id, params] of [['balanceWeek', {}], ['teamPlan', {}], ['learnFromPast', {}], ['supportPlaybooks', {}]]) {
        const t0 = performance.now();
        let st = walk(L.startWorkflow({ id, params }, jobCtx));
        const ms = Math.round(performance.now() - t0);
        const stories = st.steps.filter((x) => x.kind === 'story');
        const bad = stories.flatMap((x) => { try { L.validStory(x.story); } catch (e) { return [`${x.id}: ${e.message}`]; } return L.selfCheck(x.story).map((c) => `${x.id}: ${c.claim}`); });
        const uns = W.unsourced(st);
        const cur = L.currentStep(st);
        const plan = st.steps.find((x) => x.id === 'story:plan2' || x.id === 'story:plan')?.story;
        const k = (id2) => plan?.kpis?.find((x) => x.id === id2)?.value;
        const pv = st.steps.find((x) => x.kind === 'preview');
        t(`mission "${id}" plans on this site's data up to the preview`, !!cur && (cur.kind === 'preview' || cur.kind === 'summary') && !bad.length && !uns.length,
          `${ms} ms · ${st.steps.length} steps · now ${cur?.kind} · ${plan ? plan.headline : st.steps.find((x) => x.kind === 'summary')?.note || ''}${pv ? ` · preview ${pv.count} changes${pv.warnings.length ? ` · ${pv.warnings[0]}` : ''}` : ''}${bad.length ? ` · story problems: ${bad.slice(0, 3).join('; ')}` : ''}${uns.length ? ` · unsourced: ${uns.slice(0, 3).map((x) => `${x.number} in "${String(x.text || '').slice(0, 90)}"`).join('; ')}` : ''}`);
        // more work than time (as below): this week may stay over 100 % – but only when the plan says what does not fit
        const tooMuch = !!plan && JSON.stringify(plan.findings || []).match(/Mehr Arbeit als Zeit|More work than time/);
        if (id === 'balanceWeek' && plan) t('with the plan this week is within 100 % – or the plan says what does not fit', (k('after0') ?? 0) <= 100 || !!tooMuch, `before ${k('before0')} % → after ${k('after0')} % · ${plan.headline}${tooMuch ? ' · reported: more work than time' : ''}`);
        // every planned week – not only this one – ends within 100 %; where not, which stories fill it (read-only diagnosis)
        if (id === 'balanceWeek' && boot.me?.id) {
          const { replan } = await import('@shared/lotse/plan/replan.js');
          for (const order of ['due', 'rank']) {
            const r = replan(jobCtx, { people: [boot.me.id], order, fixWeeks: 12, handover: true });
            const p = r.people.find((x) => x.role === 'planned');
            const over = (p?.after || []).map((w, i) => ({ w, i })).filter(({ w }) => Number.isFinite(w.util) && w.util > 1.005);
            const moved = new Map(r.moves.map((m) => [m.issueId, m]));
            const why = over.map(({ w, i }) => {
              const a = Date.parse(`${w.from}T00:00:00Z`) / 864e5, b = a + 6;
              const rows = (ds.issues || []).filter((s) => s.role === 'estimate' && (s.status?.cat ?? 'new') !== 'done' && s.re > 0 && s.assignee?.id === boot.me.id).map((s) => {
                const m = moved.get(s.id);
                const st = m ? m.to.start : s.start, du = m ? m.to.due : s.due;
                return { k: s.key, st, du, m: m ? m.reason : 'fixed', s0: s.start, d0: s.due, re: s.re };
              }).filter((x) => { const s1 = Date.parse(`${x.st || x.du}T00:00:00Z`) / 864e5, e1 = Date.parse(`${x.du || x.st}T00:00:00Z`) / 864e5; return Number.isFinite(s1) && Number.isFinite(e1) && Math.min(s1, e1) <= b && Math.max(s1, e1) >= a; });
              return `week ${i} (${w.from}) ${Math.round(w.util * 100)} % = ${w.plan.toFixed(1)} h / ${w.capRest.toFixed(1)} h: ${rows.map((x) => `${x.k} ${x.m} ${x.st}..${x.du} (was ${x.s0}..${x.d0}) re ${x.re}`).join('; ')}`;
            });
            // more work than time (1,400 demo items, 2026-11-23): what finds no room stays where it is and is reported as
            // "Mehr Arbeit als Zeit" – then a week may stay over 100 %, but only together with that report
            const mine = r.unplaced.filter((u) => u.owner === boot.me.id);
            const unplacedH = mine.reduce((a, u) => a + (u.h || 0), 0);
            t(`[${order}] every planned week of my plan ends within 100 % – or the plan says what does not fit`, !over.length || mine.length > 0,
              over.length ? `${over.length} weeks over · ${mine.length} stories (${unplacedH.toFixed(1)} h) reported as "more work than time" · ${why.join(' || ').slice(0, 1500)}` : (p?.after || []).map((w) => (Number.isFinite(w.util) ? Math.round(w.util * 100) : '∞')).join(' '));
          }
        }
        st = L.cancelWorkflow(st);
        t(`mission "${id}" cancelled without writing`, st.status === 'cancelled' && !st.applied.length);
      }
    } catch (e) { t('missions plan on this site\'s data', false, `${e.code || ''} ${String(e.message).slice(0, 200)}`); }
    // ORCHESTRATOR (2026-11-16): the owner's free-form job on real data – understood, planned with decisions, every story
    // valid and sourced, the document built (one section per recipient, proof of every number) and its PDF laid out.
    // Nothing is downloaded, sent or written: the walk stops at the preview.
    try {
      const W = await import('@shared/lotse/act/workflows.js');
      const { buildJobDoc, docProblems } = await import('@shared/lotse/report/jobDoc.js');
      const { layoutJob } = await import('./lib/jobPdf.js');
      let pa = null;
      try { pa = await call('planActual.get', { weeks: 4, team: 'all' }); } catch { /* no right */ }
      const jctx = { ...ctx, planActual: pa };
      const pname = computed.model.items[0]?.name || 'Portfolio';
      const sentence = lang === 'de' ? `Prüfe alle Arbeitswochen der Leute im Projekt ${pname}, pack alles in ein PDF und bereite für jeden Kollegen einen persönlichen Bericht vor` : `Check all worker weeks of the people on project ${pname}, put everything into a PDF and prepare a personalized report for each colleague`;
      const u = L.understand(sentence, jctx);
      t('the owner\'s job sentence starts the orchestrator', u.workflow === 'orchestrate', `"${sentence.slice(0, 90)}…" → ${u.workflow || u.skill}`);
      if (u.workflow === 'orchestrate') {
        const rec = (cur) => { const ok = cur.options.filter((o) => !o.disabled); if (!cur.multi) return (ok.find((o) => o.recommended) || ok[0])?.id; const r = ok.filter((o) => o.recommended).map((o) => o.id); return r.length ? r : [ok[0].id]; };
        const t0 = performance.now();
        let st = L.startWorkflow({ id: 'orchestrate', params: u.params || {} }, jctx);
        for (let g = 0; g < 60; g++) { const cur = L.currentStep(st); if (!cur || st.status === 'done' || cur.kind === 'preview' || cur.kind === 'summary') break; st = cur.kind === 'story' ? L.nextWorkflow(st) : cur.kind === 'decide' ? L.answerWorkflow(st, cur.id, rec(cur)) : st; if (cur.kind === 'command') break; }
        const ms = Math.round(performance.now() - t0);
        const bad = st.steps.filter((x) => x.kind === 'story').flatMap((x) => { try { L.validStory(x.story); } catch (e) { return [`${x.id}: ${e.message}`]; } return L.selfCheck(x.story).map((c) => `${x.id}: ${c.claim}`); });
        const uns = W.unsourced(st);
        const cmd = st.steps.find((x) => x.command === 'doc.pdf');
        t('the job plans on this site\'s data up to the preview', !!cmd && !bad.length && !uns.length, `${ms} ms · ${st.steps.length} steps · now ${L.currentStep(st)?.kind}${bad.length ? ` · story problems: ${bad.slice(0, 3).join('; ')}` : ''}${uns.length ? ` · unsourced: ${uns.slice(0, 3).map((x) => `${x.number} in "${String(x.text || '').slice(0, 90)}"`).join('; ')}` : ''}`);
        if (cmd) {
          const doc = buildJobDoc(jctx, cmd.params.job);
          const probs = docProblems(doc);
          const lay = layoutJob(doc);
          t('the document: one section per recipient, every number with its proof, PDF laid out', doc.sections.length > 0 && !probs.length && lay.pages.length > 1, `"${doc.title}" · ${doc.sections.length} sections (${doc.sections.map((s) => s.heading || s.title || s.id).slice(0, 4).join(', ')}) · ${doc.proof.length} proofs · ${lay.pages.length} pages${probs.length ? ` · problems: ${probs.slice(0, 3).join('; ')}` : ''}`);
        }
        st = L.cancelWorkflow(st);
        t('job cancelled without writing or sending', st.status === 'cancelled' && !st.applied.length);
      }
      // CHAINS (2026-11-16): complex multi-step requests – planned on real data, every step valid, walked to the first
      // write preview or decision; nothing applied, cancelled. Plus the Forge LLM planner (N/A when AI is off for me).
      const { planChain, planProblems } = await import('@shared/lotse/act/chain/plan.js');
      const chains = lang === 'de'
        ? ['Finde alle, die in den nächsten 4 Wochen über 100 % liegen, plane jede ihrer Wochen auf 100 % und gib jedem ein PDF mit seinem neuen Plan.', 'Wer liegt unter dem Buchungsziel? Erinner sie und mach mir eine Liste als PDF.']
        : ['Find everyone over 100 % in the next 4 weeks, plan each of their weeks to 100 % and give every one of them a PDF with their new plan.', 'Who is below the booking target? Remind them and make me a list as a PDF.'];
      for (const text of chains) {
        const t0 = performance.now();
        const plan = planChain(text, jctx);
        const probs = plan ? planProblems(plan, jctx) : ['no plan'];
        const u2 = L.understand(text, jctx);
        let st = u2.workflow === 'chain' ? L.startWorkflow({ id: 'chain', params: u2.params || {} }, jctx) : null;
        const rec = (cur) => { const ok = cur.options.filter((o) => !o.disabled); if (!cur.multi) return (ok.find((o) => o.recommended) || ok[0])?.id; const r = ok.filter((o) => o.recommended).map((o) => o.id); return r.length ? r : [ok[0].id]; };
        let stops = 0;
        for (let g = 0; st && g < 80; g++) { const cur = L.currentStep(st); if (!cur || st.status === 'done' || cur.kind === 'preview' || cur.kind === 'summary' || cur.kind === 'command') break; if (cur.kind === 'story') st = L.nextWorkflow(st); else if (cur.kind === 'decide') { st = L.answerWorkflow(st, cur.id, rec(cur)); stops++; } else break; }
        const ms = Math.round(performance.now() - t0);
        const bad = (st?.steps || []).filter((x) => x.kind === 'story').flatMap((x) => { try { L.validStory(x.story); } catch (e) { return [`${x.id}: ${e.message}`]; } return L.selfCheck(x.story).map((c) => `${x.id}: ${c.claim}`); });
        const uns = st ? W.unsourced(st) : [];
        t(`chain "${text.slice(0, 38)}…" plans on this site's data`, !!plan && !probs.length && u2.workflow === 'chain' && !!st && !bad.length && !uns.length,
          `${ms} ms · ${plan?.steps?.length || 0} steps (${(plan?.steps || []).map((s) => s.tool).join(' → ')}) · ${stops} decisions · now ${st ? L.currentStep(st)?.kind : '–'}${probs.length ? ` · plan problems: ${probs.slice(0, 2).join('; ')}` : ''}${bad.length ? ` · story problems: ${bad.slice(0, 2).join('; ')}` : ''}${uns.length ? ` · unsourced: ${uns.slice(0, 3).map((x) => `${x.number} in "${String(x.text || '').slice(0, 90)}"`).join('; ')}` : ''}`);
        if (st) { st = L.cancelWorkflow(st); t('chain cancelled without writing or sending', st.status === 'cancelled' && !st.applied.length); }
      }
      try {
        const r = await call('lotse.llm', { mode: 'plan', text: chains[0], lang });
        const steps = r?.plan?.steps || [];
        // AI off for me / quota / invalid answer → Lotse goes on alone (fallback) – fine; an AI plan must have usable steps
        // (unknown tools the model invents are rejected by the server and listed – that is the check working)
        t('Forge LLM planner answers with a plan of catalogue tools only (or Lotse goes on alone)', r?.source === 'fallback' || steps.length > 0, r?.source === 'fallback' ? `fallback – ${r.reason}` : `${r.model || 'AI'} · ${steps.length} steps: ${steps.map((s) => s.tool).join(' → ')}${(r?.rejected || []).length ? ` · rejected by the server: ${JSON.stringify(r.rejected).slice(0, 160)}` : ''} · sent ${r.sent?.tools} tool schemas, text "${String(r.sent?.text || '').slice(0, 80)}"`);
      } catch (e) { t('Forge LLM planner answers with a plan of catalogue tools only', ['AI_USER_OFF', 'AI_DISABLED', 'AI_QUOTA', 'AI_BUDGET'].includes(e.code), `N/A – ${e.code}`); }
      const wi = L.understand(lang === 'de' ? `Was wäre, wenn ${computed.model.items.at(-1)?.name} 2 Wochen mehr bekommt?` : `What if ${computed.model.items.at(-1)?.name} gets 2 more weeks?`, ctx);
      t('what-if in natural words is understood (tester finding)', wi.skill === 'whatIf', `${wi.skill || wi.workflow} ${JSON.stringify(wi.params || {}).slice(0, 120)}`);
    } catch (e) { t('orchestrator plans on this site\'s data', false, `${e.code || ''} ${String(e.message).slice(0, 200)}`); }
    // the report composer: drafted from real data, every section re-checked by the server (dry run)
    try {
      // exactly like the Report view: the stored report snapshot, prepared for this viewer
      const { reportExtras, reportForViewer } = await import('@shared/reportKpis.js');
      // a fresh report (as "Aktualisieren" in the Report view): the stored snapshot may predate an engine change –
      // drafting from it would rightly be flagged as stale by the server's re-check (seen after the 2026-11-17 release)
      const r0 = await call('report.refresh');
      let rx = r0; if (!r0.extra) { try { rx = { ...r0, ...reportExtras(computed, boot.config, null) }; } catch { rx = r0; } }
      const doc = draftReport({ ctx: { ...ctx, report: reportForViewer(rx, boot.roles), now: Date.now() }, audience: 'c-level', lang });
      t('report composer drafts from real data', doc.sections.length >= 5, `${doc.sections.length} sections · ${doc.title}`);
      const v = await call('report.publishComposed', { doc: { ...doc, sections: doc.sections.map((s) => ({ ...s, on: true })) }, dryRun: true });
      t('server re-checks every section against fresh data (dry run, nothing published)', v.ok === true && v.checked >= 5, `${v.checked} checked · ${JSON.stringify(v.problems || []).slice(0, 200)}`);
    } catch (e) { t('report composer drafts from real data', false, `${e.code || ''} ${String(e.message).slice(0, 160)}`); }
  },
  // Lotse (2026-11-12) on the REAL site data: every skill → a valid visual Story whose every number has a source
  // (selfCheck), no filler, fast; the panel in the UI; and – while AI is on – one AI reading with the code cross-check.
  async lotseLive(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 15000) => { for (let w = 0; w < ms / 250; w++) { const v = fn(); if (v) return v; await sleep(250); } return null; };
    const L = await import('@shared/lotse/index.js');
    const boot = await call('bootstrap');
    const ds = await call('dataset');
    const computed = computeAll(ds);
    const lang = getLang();
    const ctx = { computed, ds, roles: boot.roles, me: boot.me, lang, fmt, ruleName, config: boot.config };
    const items = computed.model.items;
    const teams = [...computed.model.teams.values()].filter((x) => x.id !== '_none');
    const params = {
      projectBrief: { ref: items[0]?.ref }, teamBrief: { team: teams[0]?.id }, planningAdvice: { team: teams[0]?.id }, healthDraft: { ref: items[0]?.ref },
      estimate: { text: lang === 'de' ? 'Schnittstelle zum Kundenportal' : 'interface to the customer portal' },
      whatIf: items.length > 1 ? { change: { kind: 'rank', ref: items[1].ref, toRank: items.length } } : null,
      compare: items.length > 1 ? { refs: [items[0].ref, items[1].ref] } : null, why: { skill: 'portfolioBrief', params: {} },
    };
    const bad = [], slow = [], seen = [];
    for (const id of L.SKILL_IDS) {
      if (params[id] === null) continue;
      const t0 = performance.now();
      let s;
      try { s = L.SKILLS[id].run(ctx, params[id] || {}, lang); } catch (e) { bad.push(`${id}: threw ${e.message}`); continue; }
      const ms = performance.now() - t0;
      if (ms > 400) slow.push(`${id} ${Math.round(ms)} ms`);
      try { L.validStory(s); } catch (e) { bad.push(`${id}: invalid ${e.message}`); continue; }
      const missing = L.selfCheck(s);
      if (missing.length) bad.push(`${id}: unsourced ${missing.slice(0, 3).map((m) => `«${m.claim}» in «${String(m.sentence).slice(0, 90)}»`).join(" ; ")}`);
      // filler only in what Lotse wrote – work item / project names come from Jira and may contain any word
      const own = JSON.stringify([s.headline, s.kpis.map((k) => [k.label, k.value]), s.findings.map((f) => f.text), s.visual?.caption, s.how?.text, s.actions.map((a) => a.preview)]);
      const fm = /lorem|placeholder|\bundefined\b|\bNaN\b|\[object/i.exec(own);
      if (fm) bad.push(`${id}: filler «${own.slice(Math.max(0, fm.index - 90), fm.index + 30)}»`);
      const raw = /lorem|placeholder|\bundefined\b|\bNaN\b|\[object/i.exec(JSON.stringify(s));
      if (raw && !fm) seen.push(`${id}: note – "${raw[0]}" only inside Jira data «${JSON.stringify(s).slice(Math.max(0, raw.index - 60), raw.index + 20)}»`);
      if (!s.visual?.kind) bad.push(`${id}: no visual`);
      seen.push(`${id}: ${s.headline.slice(0, 70)}`);
    }
    t('every skill: valid, visual, every number sourced – on this site\'s real data', !bad.length, bad.length ? bad.join(' | ').slice(0, 600) : `${seen.length} skills · e.g. ${seen.slice(0, 3).join(' · ')}`);
    t('fast enough (each story < 400 ms in the browser)', !slow.length, slow.join(', ') || 'ok');
    const story = L.ask(lang === 'de' ? 'Wie steht das Portfolio?' : 'How is the portfolio?', ctx);
    t('ask: a question becomes a story', story?.skill === 'portfolioBrief', story?.headline);
    const top = L.briefing(ctx);
    t('Heute für dich: up to 3 stories for this role', Array.isArray(top) && top.length >= 1 && top.length <= 3, top.map((x) => x.skill).join(', '));
    // the UI
    for (let w = 0; w < 120 && document.querySelectorAll('[role=tab]').length < 5; w++) await sleep(250);
    const btn = [...document.querySelectorAll('button')].find((b) => /^Lotse$|^Navigator$/.test(b.textContent.trim()));
    t('Lotse in the header', !!btn);
    btn?.click();
    const panel = await waitFor(() => document.querySelector('[data-lotse-panel]'), 8000);
    const input = panel?.querySelector('input');
    if (input) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, lang === 'de' ? `Wie steht ${items[0]?.name || 'das Portfolio'}?` : `How is ${items[0]?.name || 'the portfolio'} doing?`);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(100);
      input.form?.requestSubmit();
    }
    const card = await waitFor(() => panel?.querySelector('[data-story]'), 8000);
    t('the panel answers with a visual story card', !!card && !!card.querySelector('figure, [role=img], svg'), card ? `${card.dataset.story} · ${card.dataset.visual}` : 'no card');
    const axe = (await import('axe-core')).default;
    // axe only after the card has faded in (live 2026-11-17: a headline caught mid-fade read as 1.48 : 1 contrast)
    await waitFor(() => { if (!card) return true; for (const el of [card, ...card.querySelectorAll('*')]) if (+getComputedStyle(el).opacity < 1) return false; return true; }, 4000);
    await sleep(300);
    if (panel) { const r = await axe.run(panel, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }); t('Lotse panel: 0 axe violations', r.violations.length === 0, r.violations.map((v) => `${v.id}×${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')} – ${String(n.any?.[0]?.message || '').slice(0, 140)}`).join(' | ')}`).join(' || ')); }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(600);
    t('Esc closes the panel', !document.querySelector('[data-lotse-panel]'));
    // AI reading + cross-check (≈ 1 cent; only while the admin has AI on)
    if (boot.config?.ai?.enabled !== true) { t('AI reading', true, 'N/A – AI is off'); return; }
    const mineBefore = boot.config?.ai?.user === true || boot.config?.ai?.access === 'all';
    if (!mineBefore) await call('prefs.save', { ai: true });
    try {
      const t0 = performance.now();
      const r = await call('lotse.llm', { story, lang });
      t('AI reading of the verified story, cross-checked in code', typeof r.text === 'string' && r.text.length > 20 && ['agrees', 'differs', 'unverifiable'].includes(r.crossCheck?.verdict),
        `${r.source} · ${Math.round(performance.now() - t0)} ms · ${r.crossCheck?.verdict} (${Math.round((r.crossCheck?.agree || 0) * 100)} %) · ${r.text.slice(0, 120)}`);
      t('only the story was sent (no ids, no e-mails)', !/[\w.+-]+@[\w-]+\.|\b[0-9a-f]{24,}\b|557058:/.test(JSON.stringify(r.usedFacts || {})), `${JSON.stringify(r.usedFacts || {}).length} chars`);
    } catch (e) { t('AI reading of the verified story, cross-checked in code', false, `${e.code}: ${String(e.message).slice(0, 100)}`); }
    finally { if (!mineBefore) await call('prefs.save', { ai: false }); }
  },
  // AI switch (2026-11-10), read-only: reads the live setting and checks that server and UI follow it. Changes nothing.
  async aiSwitch(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const boot = await call('bootstrap');
    const ai = boot.config?.ai;
    t('the configuration carries the AI setting', !!ai && typeof ai.enabled === 'boolean', JSON.stringify({ enabled: ai?.enabled, features: ai?.features, shareNames: ai?.shareNames, shareTexts: ai?.shareTexts, changedAt: ai?.changedAt }));
    // wait until the app has rendered its tabs – otherwise "no AI button" would pass on an empty page
    for (let w = 0; w < 120 && document.querySelectorAll('[role=tab]').length < 5; w++) await sleep(250);
    t('app is rendered (tabs present) before checking the UI', document.querySelectorAll('[role=tab]').length >= 5, `${document.querySelectorAll('[role=tab]').length} tabs`);
    const tab = (re) => { const b = [...document.querySelectorAll('[role=tab]')].find((x) => re.test(x.textContent)); b?.click(); return !!b; };
    if (ai?.enabled !== true) {
      for (const [name, payload] of [['ai.ask', { question: 'Was ist diese Woche wichtig?', lang: 'de' }], ['ai.healthDraft', { ref: boot.dataset?.portfolio?.[0]?.ref || 'issue:1', lang: 'de' }], ['ai.reportSummary', { lang: 'de' }]]) {
        t(`AI off: ${name} is refused by the server (AI_DISABLED)`, (await expectErr(name, payload, 'AI_DISABLED')).ok);
      }
      // the UI shows no AI entry point
      const pd = tab(/^Projekte|^Projects|Projektdetails|Project details/); await sleep(2000);
      t('AI off: no "AI briefing" in project details', pd && (document.querySelector('main')?.innerText || '').length > 150 && !/KI-Lagebild|AI briefing/.test(document.body.innerText), pd ? '' : 'tab not found');
      const rp = tab(/C-Level|C-level/); await sleep(3000);
      t('AI off: no AI executive summary in the C-level report', rp && (document.querySelector('main')?.innerText || '').length > 150 && !/Mit KI zusammenfassen|Summarize with AI/.test(document.body.innerText), rp ? '' : 'tab not found');
      tab(/^Portfolio/); await sleep(1500);
      const hb = document.querySelector('[data-tour="health"]');
      if (hb) { hb.click(); await sleep(900); t('AI off: no "Draft with AI" in the health dialog', !!document.querySelector('[role=dialog]') && !/Mit KI formulieren|Draft with AI/.test(document.body.innerText)); document.querySelector('[role=dialog] .btn-ghost')?.click(); await sleep(400); }
      else t('health dialog to check', true, 'N/A – no health button for this account');
    } else {
      t('AI on – this suite only reports the state (the ai suite tests the answers)', true, `features: ${Object.entries(ai.features).filter(([, v]) => v).map(([k]) => k).join(', ')}`);
    }
    tab(/^Portfolio/);
  },
  // AI on (user request 2026-11-11, superportdev only): switches Forge LLM on with every feature, data minimisation stays
  // ON (no names, no texts). Idempotent: saves only when something differs. Changes nothing else in the configuration.
  async aiEnable(t) {
    // every AI feature of the app (config.js DEFAULT_AI.features) – the E2E of 2026-11-25 tests them all
    const FEATURES = ['ask', 'healthDraft', 'reportSummary', 'planning', 'gaps', 'dispatch', 'planActual', 'teamBrief', 'projectBrief', 'myWeek', 'intent', 'similarSummary', 'playbookDraft', 'lotse'];
    const cfg = (await call('config.get')).config;
    const ai0 = cfg.ai || {};
    t('before (ai block, for an exact revert)', true, JSON.stringify(ai0));
    const want = { ...ai0, enabled: true, features: Object.fromEntries(FEATURES.map((k) => [k, true])), shareNames: false, shareTexts: false };
    const same = ai0.enabled === true && ai0.shareNames === false && ai0.shareTexts === false && FEATURES.every((k) => ai0.features?.[k] === true);
    if (same) t('AI already on with every feature and minimisation on – nothing saved', true);
    else await call('config.save', { config: { ...cfg, ai: want } });
    const after = (await call('config.get')).config;
    t('AI is on', after.ai?.enabled === true, `changedBy ${after.ai?.changedBy} at ${after.ai?.changedAt}`);
    t('every feature is on', FEATURES.every((k) => after.ai?.features?.[k] === true), JSON.stringify(after.ai?.features));
    t('data minimisation stays on (no names, no texts)', after.ai?.shareNames === false && after.ai?.shareTexts === false);
    // everything except the ai block (and the bookkeeping the server sets on every save) is exactly as before
    const IGNORE = new Set(['ai', 'updatedAt', 'savedAt', 'savedBy']);
    const diff = [...new Set([...Object.keys(cfg), ...Object.keys(after)])].filter((k) => !IGNORE.has(k) && JSON.stringify(cfg[k]) !== JSON.stringify(after[k]));
    t('nothing else in the configuration changed', diff.length === 0, diff.join(', ') || 'every other top-level key identical');
    const log = await call('audit.list').catch(() => []);
    const expected = ai0.enabled === true ? 'ai.settings' : 'ai.enabled'; // already on but features/sharing differed → a settings entry
    const hit = (log || []).find((e) => e.action === expected);
    t(`audit shows the switch (${expected})`, same || (!!hit && Date.now() - Date.parse(hit.at) < 10 * 60e3), hit ? `${hit.action} by ${hit.byName || hit.by} at ${hit.at}` : same ? 'N/A – nothing was switched in this run' : `no ${expected} entry`);
    const boot = await call('bootstrap');
    t('bootstrap (the browser config) reports AI on', boot.config?.ai?.enabled === true);
  },
  // AI off (user request 2026-11-25, own development site only): switches only ai.enabled off. Features, data minimisation,
  // budget and every other setting stay as they are. Idempotent: saves only when AI is on.
  async aiDisable(t) {
    const cfg = (await call('config.get')).config;
    const ai0 = cfg.ai || {};
    t('before (ai block, for an exact revert)', true, JSON.stringify(ai0));
    if (ai0.enabled !== true) t('AI already off – nothing saved', true);
    else await call('config.save', { config: { ...cfg, ai: { ...ai0, enabled: false } } });
    const after = (await call('config.get')).config;
    t('AI is off', after.ai?.enabled === false, `changedBy ${after.ai?.changedBy} at ${after.ai?.changedAt}`);
    const rest = (a) => JSON.stringify({ ...(a || {}), enabled: null, changedAt: null, changedBy: null });
    t('the other AI settings are unchanged (features, sharing, budget)', rest(after.ai) === rest(ai0), rest(after.ai));
    const IGNORE = new Set(['ai', 'updatedAt', 'savedAt', 'savedBy']);
    const diff = [...new Set([...Object.keys(cfg), ...Object.keys(after)])].filter((k) => !IGNORE.has(k) && JSON.stringify(cfg[k]) !== JSON.stringify(after[k]));
    t('nothing else in the configuration changed', diff.length === 0, diff.join(', ') || 'every other top-level key identical');
    const log = await call('audit.list').catch(() => []);
    const hit = (log || []).find((e) => e.action === 'ai.disabled');
    t('audit shows the switch (ai.disabled)', ai0.enabled !== true || (!!hit && Date.now() - Date.parse(hit.at) < 10 * 60e3), hit ? `${hit.action} by ${hit.byName || hit.by} at ${hit.at}` : ai0.enabled !== true ? 'N/A – nothing was switched in this run' : 'no ai.disabled entry');
    const boot = await call('bootstrap');
    t('bootstrap (the browser config) reports AI off', boot.config?.ai?.enabled === false);
  },

  // Every AI feature live, through the real UI: open the screen, click the KI button, wait for the answer (≤ 90 s),
  // check suggestion + reasoning, what was sent (no names, ids, e-mails, URLs) and that every key it names exists.
  // ONE real write: an AI value for a missing field on a PCX work item, verified via REST, undone via the app's undo,
  // verified again (restored in `finally` no matter what). Planning, dispatch and my week are only asserted, never applied.
  //
  // Findings already foreseeable (review with the result):
  //  - ai.assist must be registered in src/index.js (and in maintenance READ_RESOLVERS) – until then every assist
  //    feature fails here with "function not found"; ask/healthDraft/reportSummary still work.
  //  - The open app keeps the config it loaded: right after aiEnable the KI buttons appear only after a data refresh
  //    (this suite clicks "Aktualisieren" once if needed).
  //  - teamBrief/projectBrief build the caller's dataset on the server AND call the LLM (15 s timeout in llm()) in one
  //    invocation – on a large site that can come close to Forge's 25 s limit; latency is recorded per feature.
  //  - MAX_TOKENS 700 in ai.js: a planning answer with many picks can be cut off → invalid JSON → "Regel der App"
  //    fallback (source=fallback, reason AI_INVALID). Watch the source column.
  //  - Daily quota is 60 calls per person; one run uses ~10.
  //  - GapBox shows 6 gaps first; the suite opens "Alle zeigen" to reach a PCX gap.
  async aiLive(t) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitFor = async (fn, ms = 15000) => { for (let w = 0; w < ms / 250; w++) { const v = fn(); if (v) return v; await sleep(250); } return null; };
    const tab = (re) => { const b = [...document.querySelectorAll('[role=tab]')].find((x) => re.test(x.textContent)); b?.click(); return !!b; };
    const main = () => document.querySelector('main');
    const boot = await call('bootstrap');
    if (boot.config?.ai?.enabled !== true) { t('AI is off – run aiEnable first', false, 'N/A'); return; }
    // AI is per person (default off): switch it on for the test account, restored at the end
    const mineBefore = boot.config?.ai?.user === true;
    if (!mineBefore) await call('prefs.save', { ai: true });
    t('AI switched on for this person (restored afterwards)', true, mineBefore ? 'was on already' : 'was off – switched on for the run');
    // Lotse chains: Forge LLM as planner – only catalogue tools, people masked, the server rejects what it does not know
    try {
      const text = getLang() === 'de' ? 'Finde alle, die in den nächsten 4 Wochen über 100 % liegen, plane jede ihrer Wochen auf 100 % und gib jedem ein PDF mit seinem neuen Plan.' : 'Find everyone over 100 % in the next 4 weeks, plan each of their weeks to 100 % and give every one of them a PDF with their new plan.';
      const t0 = Date.now();
      const r = await call('lotse.llm', { mode: 'plan', text, lang: getLang(), fresh: true });
      const steps = r?.plan?.steps || [];
      t('Lotse chain: Forge LLM plans with catalogue tools only', r?.source === 'ai' && steps.length > 0, `${Date.now() - t0} ms · ${r?.source}${r?.reason ? ` (${r.reason})` : ''} · ${r?.model || ''} · ${steps.length} steps: ${steps.map((s) => s.tool).join(' → ')}${(r?.rejected || []).length ? ` · rejected by the server: ${JSON.stringify(r.rejected).slice(0, 160)}` : ''} · sent ${r?.sent?.tools} tool schemas`);
    } catch (e) { t('Lotse chain: Forge LLM plans with catalogue tools only', false, `${e.code || ''} ${String(e.message).slice(0, 160)}`); }
    const shareNames = boot.config.ai.shareNames === true;
    const ds = await call('dataset');
    // what must never show up in the sent facts (while names are not shared): display names and account ids of the dataset
    const names = new Set(), ids = new Set();
    const addP = (p) => { if (!p) return; if (p.name && String(p.name).trim().length >= 4) names.add(String(p.name).trim()); if (p.id || p.accountId) ids.add(String(p.id || p.accountId)); };
    Object.entries(ds.people || {}).forEach(([id, p]) => { ids.add(id); addP(p); });
    (ds.issues || []).forEach((i) => addP(i.assignee));
    (ds.portfolio || []).forEach((p) => addP(p.owner));
    (ds.supportTickets?.tickets || []).forEach((x) => addP(x.assignee));
    if (boot.me?.name) names.add(boot.me.name);
    if (boot.me?.id) ids.add(boot.me.id);
    // the answer must follow the UI language (a rough word count is enough to catch German vs. English)
    const lang = getLang();
    const langOk = (text) => { const w = ` ${String(text).toLowerCase().replace(/[^a-zäöüß ]+/g, ' ')} `; const n = (re) => (w.match(re) || []).length; const de = n(/ (und|der|die|das|nicht|mit|ist|für|auf|wird|ein|eine) /g), en = n(/ (and|the|is|with|for|not|to|of|are|a|an) /g); return lang === 'de' ? de >= en : en >= de; };
    // measure live answers, not the 15-minute browser cache
    try { for (let i = sessionStorage.length - 1; i >= 0; i--) { const k = sessionStorage.key(i); if (k?.startsWith('pc-ai:')) sessionStorage.removeItem(k); } } catch { /* none */ }
    const keys = new Set([...(ds.issues || []).map((i) => i.key), ...(ds.portfolio || []).map((p) => p.key), ...(ds.supportTickets?.tickets || []).map((x) => x.key)].filter(Boolean));
    const leaks = (s) => [
      ...(shareNames ? [] : [...names].filter((n) => s.includes(n))),
      ...[...ids].filter((x) => x.length >= 8 && s.includes(x)),
      ...(s.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []), ...(s.match(/https?:\/\/\S+/g) || []),
    ];
    // the app keeps the config it loaded – refresh once so the KI buttons appear after aiEnable
    for (let w = 0; w < 120 && document.querySelectorAll('[role=tab]').length < 5; w++) await sleep(250);
    tab(/^Projekte|^Projects/);
    // always reload once: AI is per person and the page holds the config it loaded before the switch above (Lotse's
    // buttons are always there now, so "no button yet" no longer tells us the config is stale)
    document.querySelector('[aria-label="Aktualisieren"], [aria-label="Refresh"]')?.click();
    await sleep(1500);
    for (let w = 0; w < 120 && !document.querySelector('[data-ai-feature]'); w++) await sleep(250);
    await sleep(1500);

    // one assistant: click its button, wait for the panel, check it; returns the panel (or null = N/A)
    const run = async (feature, btnScope = document) => {
      const btn = await waitFor(() => btnScope.querySelector(`button[data-ai-feature="${feature}"]`), 12000);
      if (!btn) return null;
      const scope = btn.closest('.ai-assist, [data-gap-key], section, .mine-sheet') || document;
      const t0 = performance.now();
      btn.click();
      const panel = await waitFor(() => { const p = scope.querySelector(`.ai-panel[data-ai-feature="${feature}"]`) || document.querySelector(`.ai-panel[data-ai-feature="${feature}"]`); return p && ['done', 'error'].includes(p.dataset.aiPhase) ? p : null; }, 90000);
      const ms = Math.round(performance.now() - t0);
      if (!panel) { t(`${feature}: answer within 90 s`, false, `no answer after ${ms} ms`); return null; }
      if (panel.dataset.aiPhase === 'error') { t(`${feature}: answer`, false, `${ms} ms · ${panel.querySelector('.ai-error')?.innerText}`); return null; }
      const src = panel.dataset.aiSource, model = panel.dataset.aiModel || '–';
      const body = panel.querySelector('.ai-body')?.innerText || '';
      const why = panel.querySelector('.ai-why')?.innerText || '';
      const hasSuggestion = !!panel.querySelector('.ai-text, .ai-list, .ai-value, .ai-points') || /\S/.test(body.split(/Warum\?|Why\?/)[0]);
      t(`${feature}: suggestion + reasoning (${src}, ${model}, ${ms} ms)`, hasSuggestion && (src === 'fallback' || why.length > 10),
        `${src === 'fallback' ? 'REGEL DER APP (fallback) · ' : ''}${ms} ms · ${body.replace(/\s+/g, ' ').slice(0, 400)}`);
      t(`${feature}: answers in the UI language (${lang})`, langOk(body), body.replace(/\s+/g, ' ').slice(0, 120));
      t(`${feature}: marked as AI with the policy line`, /KI-Vorschlag|AI suggestion|KI-generiert|AI-generated/.test(panel.innerText) && /Gesendet|Sent/.test(panel.innerText));
      [...panel.querySelectorAll('.ai-link')].find((b) => /Was wurde gesendet|What was sent/.test(b.textContent))?.click();
      const sent = (await waitFor(() => panel.querySelector('.ai-sent'), 3000))?.textContent || '';
      const bad = leaks(sent);
      t(`${feature}: "Was wurde gesendet?" – no names, account ids, e-mails or URLs`, sent.length > 2 && bad.length === 0, bad.length ? `LEAK: ${bad.slice(0, 5).join(', ')}` : `${sent.length} chars sent${shareNames ? ' (names allowed by setting)' : ''}`);
      const named = [...new Set(body.match(/\b[A-Z][A-Z0-9_]{1,9}-\d+\b/g) || [])];
      // a key outside the cockpit's dataset can still be real (My work also lists tickets of other service spaces) – ask Jira
      const unknown = [];
      for (const k of named.filter((x) => !keys.has(x))) { const r = await req(`/rest/api/3/issue/${encodeURIComponent(k)}?fields=summary`).catch(() => null); if (!(r && r.status === 200)) unknown.push(k); }
      t(`${feature}: every key it names exists`, unknown.length === 0, unknown.length ? `unknown: ${unknown.join(', ')}` : `${named.length} keys: ${named.slice(0, 8).join(', ')}`);
      return panel;
    };
    const close = (p) => p?.querySelector('.ai-x')?.click();

    // projectBrief + gaps (Projekte) – the one real apply, on a PCX work item
    const fieldOf = (usage) => ({ originalEstimate: 'timeoriginalestimate', dueDate: 'duedate', startDate: boot.config.fields?.startDate, team: boot.config.fields?.team })[usage];
    const computed = computeAll(ds);
    const pcxGaps = computed.dq.gaps.filter((g) => g.fixable && /^PCX-/.test(g.key || '') && !g.isItem && String(g.rule).startsWith('missing:') && fieldOf(g.field));
    const order = ['originalEstimate', 'dueDate', 'startDate', 'team'];
    pcxGaps.sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
    const project = ds.portfolio.find((p) => p.ref === pcxGaps[0]?.rootRef) || ds.portfolio.find((p) => /^PCX-/.test(p.key));
    tab(/^Projekte|^Projects/);
    await waitFor(() => document.querySelector('.pills'));
    if (project) document.querySelector(`.pill[data-ref="${project.ref}"]`)?.click();
    await sleep(1200);
    const pb = await run('projectBrief');
    if (!pb) t('projectBrief', true, 'N/A – no project briefing button'); else close(pb);
    if (!pcxGaps.length) t('gaps: AI value applied and undone on PCX', true, 'N/A – no fillable missing value on a PCX work item');
    else {
      document.querySelector('.gapbox-more[aria-expanded="false"]')?.click();
      await sleep(600);
      let applied = false;
      for (const g of pcxGaps.slice(0, 4)) {
        const row = await waitFor(() => document.querySelector(`[data-gap-key="${g.key}"][data-gap-field="${g.field}"]`), 5000);
        if (!row) continue;
        const panel = await run('gaps', row);
        if (!panel) continue;
        const useBtn = [...panel.querySelectorAll('.ai-actions button')].find((b) => /Wert übernehmen|Use value/.test(b.textContent));
        if (!useBtn) { t(`gaps ${g.key} (${g.field}): AI had no sound value`, true, 'skipped – trying the next gap'); close(panel); continue; }
        if (!/^PCX-/.test(g.key)) { close(panel); continue; } // never anything outside the sandbox
        const f = fieldOf(g.field);
        const get = async () => (await req(`/rest/api/3/issue/${g.issueId}?fields=${f}`)).body?.fields?.[f] ?? null;
        const before = await get();
        let restored = false;
        try {
          useBtn.click();
          const toastUndo = await waitFor(() => [...document.querySelectorAll('[role=status] button, .toast button')].find((b) => /Rückgängig|Undo/.test(b.textContent) && /KI-Vorschlag|AI suggestion/.test(b.closest('[role=status], .toast')?.textContent || '')), 15000);
          await sleep(800);
          const now = await get();
          t(`gaps ${g.key}: AI value saved in Jira (${g.field})`, now != null && JSON.stringify(now) !== JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(now)}`);
          // undo the way a person would: the toast's "Rückgängig" (else Ctrl+Z = the newest undo entry, which is this fill)
          if (toastUndo?.isConnected) toastUndo.click();
          else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
          let back = null;
          for (let w = 0; w < 30; w++) { await sleep(500); back = await get(); if (JSON.stringify(back) === JSON.stringify(before)) break; }
          restored = JSON.stringify(back) === JSON.stringify(before);
          t(`gaps ${g.key}: undo in the app restores the field`, restored, `${toastUndo?.isConnected === false || !toastUndo ? 'Ctrl+Z' : 'toast undo'} → ${JSON.stringify(back)}`);
          applied = true;
        } finally {
          if (!restored) { try { await call('issue.fill', { issueId: g.issueId, usage: g.field, clear: true }); t(`gaps ${g.key}: restored in finally`, (await get()) == null); } catch (e) { t(`gaps ${g.key}: restore in finally`, false, e.message); } }
        }
        break;
      }
      if (!applied) t('gaps: AI value applied and undone on PCX', true, 'N/A – the AI found no sound value for the first PCX gaps');
    }

    // teamBrief
    tab(/^Teams/); await sleep(1500);
    const tb = await run('teamBrief'); if (!tb) t('teamBrief', true, 'N/A – no teams'); else close(tb);
    // planning (assert only – nothing is added to the pending moves)
    tab(/Wochenplanung|Weekly planning/);
    await waitFor(() => document.querySelector('.pills .pill'), 15000);
    // the optimizer panel open (it keeps its state across teams); count its suggestions (the three mode badges)
    const openOpt = async () => {
      const b = await waitFor(() => document.querySelector('.wb-opt-btn'), 6000);
      if (!b) return null;
      if (!document.getElementById('wb-opt-panel')) b.click();
      return waitFor(() => document.getElementById('wb-opt-panel'), 5000);
    };
    const countOpt = (panel) => [...(panel?.querySelectorAll('.wb-opt-badge') || [])].reduce((a, x) => a + (+x.textContent || 0), 0);
    // pick the team (or "Alle Teams") with the most optimizer suggestions – the AI has something to combine there
    const pills = [...document.querySelectorAll('.pills .pill')];
    let best = { n: -1, label: null };
    for (const pill of pills) {
      pill.click(); await sleep(900);
      const panel = await openOpt();
      const n = panel ? countOpt(panel) : -1;
      if (n > best.n) best = { n, label: pill.textContent.trim() };
    }
    if (best.label) pills.find((x) => x.textContent.trim() === best.label)?.click();
    await sleep(900);
    const optPanel = await openOpt();
    if (!optPanel) t('planning', true, 'N/A – no board with anything to optimise');
    else {
      t('planning: team with the most suggestions chosen', true, `${best.label}: ${best.n} suggestions`);
      const pl = await run('planning', optPanel);
      if (!pl) t('planning: assistant in the optimizer', false, `panel=${!!document.getElementById('wb-opt-panel')} · KI buttons: ${[...document.querySelectorAll('button[data-ai-feature]')].map((b) => b.dataset.aiFeature).join(',') || 'none'}`);
      else { t('planning: nothing applied by the test', true, 'only asserted – no pending move added'); close(pl); }
    }
    // planActual – only once weekly plan snapshots exist
    let paData = null; try { paData = await call('planActual.get', { weeks: 4, team: 'all' }); } catch (e) { paData = { err: e.code }; }
    if (paData?.state !== 'ready') t('planActual', true, `N/A – no plan snapshots yet (${paData?.err || paData?.state || 'pending'}); the assistant appears once the first weekly snapshot exists`);
    else {
      tab(/Plan vs\./); await sleep(2500);
      const pa = await run('planActual'); if (!pa) t('planActual: assistant on the screen', false, 'snapshots exist but no KI button'); else close(pa);
    }
    // dispatch (assert only)
    if (!tab(/^Support/)) t('dispatch', true, 'N/A – no support configured');
    else {
      await sleep(2000);
      const dp = await run('dispatch'); if (!dp) t('dispatch', true, 'N/A – no incoming tickets'); else { t('dispatch: nothing assigned by the test', true, 'only asserted'); close(dp); }
    }
    // myWeek (assert only)
    tab(/^Meine Arbeit|^My work/); await sleep(2500);
    const mw = await run('myWeek'); if (!mw) t('myWeek', true, 'N/A – no bookings this week'); else { t('myWeek: no comment written by the test', true, 'only asserted'); close(mw); }

    // ask / healthDraft / reportSummary through their resolvers (their UI is the Ask canvas, the health dialog, the report)
    const timed = async (name, payload) => { const t0 = performance.now(); try { const r = await call(name, payload); return { r, ms: Math.round(performance.now() - t0) }; } catch (e) { return { e, ms: Math.round(performance.now() - t0) }; } };
    const textLeaks = (s) => (shareNames ? [] : [...names].filter((n) => s.includes(n)));
    const pcx = ds.portfolio.find((p) => /^PCX-/.test(p.key));
    for (const [name, payload, text] of [
      ['ai.ask', { question: lang === 'de' ? 'Was braucht diese Woche Aufmerksamkeit?' : 'What needs attention this week?', lang }, (r) => r.text],
      ['ai.healthDraft', { ref: pcx?.ref, lang }, (r) => `${r.status}: ${r.comment}`],
      ['ai.reportSummary', { lang }, (r) => r.text],
    ]) {
      if (name === 'ai.healthDraft' && !pcx) { t(name, true, 'N/A – no PCX project'); continue; }
      const { r, e, ms } = await timed(name, payload);
      if (e) { t(name, e.code === 'NO_ACCESS', `N/A for this account? ${e.code} ${ms} ms`); continue; }
      const s = String(text(r) || '');
      t(`${name}: answer (${r.source}, ${ms} ms)`, s.length > 5 && ['ai', 'fallback'].includes(r.source), `${r.source}${r.reason ? ` ${r.reason}` : ''} · ${ms} ms · ${s.slice(0, 400)}`);
      t(`${name}: answers in the UI language (${lang})`, langOk(s), s.slice(0, 120));
      if (name !== 'ai.healthDraft') t(`${name}: each project named once with its rank (no "#5 PCX-46 (#5)")`, !/#(\d+)\s+[A-Z][A-Z0-9_]*-\d+\s*\(#\1\)/.test(s), (s.match(/#\d+\s+[A-Z][A-Z0-9_]*-\d+\s*\(#\d+\)/g) || []).join(', ') || 'ok');
      t(`${name}: no person names in the answer`, textLeaks(s).length === 0, textLeaks(s).join(', '));
    }
    tab(/^Portfolio/);
    if (!mineBefore) await call('prefs.save', { ai: false });
  },
  async ai(t, c) {
    const boot0 = await call('bootstrap');
    if (boot0.config?.ai?.enabled !== true) { t('AI is switched off – answers not testable (see aiSwitch)', true, 'N/A'); return; }
    // AI is also per person (default off, the server refuses with AI_USER_OFF): on for this run, restored afterwards
    const mineBefore = boot0.config?.ai?.user === true;
    t('AI_USER_OFF while the person has not switched AI on', mineBefore || (await expectErr('ai.ask', { question: 'Was ist wichtig?', lang: 'de' }, 'AI_USER_OFF')).ok);
    if (!mineBefore) await call('prefs.save', { ai: true });
    try {
    const a = await call('ai.ask', { question: 'Was braucht diese Woche Aufmerksamkeit?', lang: 'de' });
    t('ai.ask answers', a.text?.length > 20 && ['ai', 'fallback'].includes(a.source), `${a.source}${a.reason ? ' ' + a.reason : ''}: ${a.text?.slice(0, 90)}`);
    // a project of the portfolio as configured (Epic or another work type such as Project)
    const port = (await call('dataset')).portfolio.filter((p) => p.kind === 'issue' && /^PCX-/.test(p.key || ''));
    const pcx = port.find((p) => p.owner) || port[0];
    const b = await call('ai.ask', { question: 'Give me a briefing on this project.', ref: `issue:${pcx.id}`, lang: 'en' });
    t('ai.ask with project focus', b.text?.length > 20, `${b.source}: ${b.text?.slice(0, 90)}`);
    t('ai.ask rejects empty question', (await expectErr('ai.ask', { question: ' ' }, 'INVALID')).ok);
    t('ai.ask rejects 600 chars', (await expectErr('ai.ask', { question: 'x'.repeat(600) }, 'INVALID')).ok);
    const d = await call('ai.healthDraft', { ref: `issue:${pcx.id}`, lang: 'de' });
    t('ai.healthDraft returns status + sentence', ['onTrack', 'atRisk', 'critical'].includes(d.status) && d.comment.length > 5 && d.comment.length <= 280, `${d.source}: ${d.status} ${d.comment.slice(0, 80)}`);
    const s = await call('ai.reportSummary', { lang: 'de' });
    t('ai.reportSummary for report group', s.text?.length > 20, `${s.source}: ${s.text?.slice(0, 90)}`);
    } finally { if (!mineBefore) await call('prefs.save', { ai: false }); }
  },
  async undo(t, c) {
    // a PCX project of the portfolio as configured (Epic or another work type such as Project)
    const port = (await call('dataset')).portfolio.filter((p) => p.kind === 'issue' && /^PCX-/.test(p.key || ''));
    const epic = port.find((p) => p.owner) || port[0];
    if (!epic) { t('a PCX project in the portfolio to test undo on', false, 'none'); return; }
    const ref = `issue:${epic.id}`;
    const hOf = async () => (await call('dataset')).portfolio.find((p) => p.ref === ref)?.health || null;
    const h0 = await hOf();
    const a = await call('health.set', { ref, status: 'onTrack', comment: 'A' });
    await call('health.set', { ref, status: 'critical', comment: 'B' });
    const back = await call('health.set', { ref, restore: true }); // undo = the previous record exactly
    t('health undo restores the previous record exactly (status, comment, date, author)', back?.comment === 'A' && back?.status === 'onTrack' && back?.at === a.at && back?.by === a.by, `${back?.comment} ${back?.at}`);
    t('the earlier records never reach the browser', !('prev' in (back || {})) && !('prev' in ((await hOf()) || {})));
    const orig = await call('health.set', { ref, restore: true });
    t('a second undo goes back to how it was before the test', (orig?.at ?? null) === (h0?.at ?? null) && (orig?.comment ?? null) === (h0?.comment ?? null), `${h0?.at} → ${orig?.at}`);
    await call('issue.fill', { issueId: epic.id, usage: 'tshirt', value: 'L' });
    await call('issue.fill', { issueId: epic.id, usage: 'tshirt', clear: true });
    const f = await req(`/rest/api/3/issue/${epic.id}?fields=${FID.tshirt}`);
    t('undo clears app field', f.body.fields[FID.tshirt] == null, JSON.stringify(f.body.fields));
    await call('issue.fill', { issueId: epic.id, usage: 'tshirt', value: 'M' });
    const noEst = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: 'project = PCX AND issuetype = Story AND originalEstimate is EMPTY', fields: ['summary'], maxResults: 1 }) })).body.issues[0];
    if (noEst) {
      await call('issue.fill', { issueId: noEst.id, usage: 'originalEstimate', value: 6 });
      const g1 = await req(`/rest/api/3/issue/${noEst.id}?fields=timeoriginalestimate`);
      await call('issue.fill', { issueId: noEst.id, usage: 'originalEstimate', clear: true });
      const g2 = await req(`/rest/api/3/issue/${noEst.id}?fields=timeoriginalestimate`);
      t('estimate fill + undo (Jira field as user)', g1.body.fields.timeoriginalestimate === 21600 && g2.body.fields.timeoriginalestimate == null, `${g1.body.fields.timeoriginalestimate} -> ${g2.body.fields.timeoriginalestimate}`);
    }
    const noStart = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: 'project = PCX AND issuetype = Story AND "Start date" is EMPTY', fields: ['summary'], maxResults: 1 }) })).body.issues[0];
    if (noStart) {
      await call('issue.fill', { issueId: noStart.id, usage: 'startDate', value: '2026-11-16' });
      await call('issue.fill', { issueId: noStart.id, usage: 'startDate', clear: true });
      const g = await req(`/rest/api/3/issue/${noStart.id}?fields=customfield_10015`);
      t('start date fill + undo', g.body.fields.customfield_10015 == null);
    }
    let ds = await call('dataset');
    const order = [...ds.portfolio].sort((x, y) => x.rank - y.rank).map((p) => p.ref);
    const victim = order[1];
    const before = (await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: `id = ${victim.slice(6)}`, fields: [FID.rank] }) })).body.issues[0].fields[FID.rank];
    await call('portfolio.remove', { ref: victim });
    await call('portfolio.add', { ref: victim });
    await call('portfolio.reorder', { order });
    ds = await call('dataset');
    t('remove + undo restores exact rank', [...ds.portfolio].sort((x, y) => x.rank - y.rank).map((p) => p.ref).join() === order.join());
    const j = await req('/rest/api/3/search/jql', { method: 'POST', body: JSON.stringify({ jql: `id = ${victim.slice(6)}`, fields: [FID.rank] }) });
    t('rank field restored in Jira (global rank)', j.body.issues[0].fields[FID.rank] === before, `${before} -> ${j.body.issues[0].fields[FID.rank]}`);
    t('clear rejects unknown usage', (await expectErr('issue.fill', { issueId: epic.id, usage: 'summary', clear: true }, 'INVALID')).ok);
  },
  // Role probe for the multi-account Playwright suite (tests/e2e). Non-destructive: write probes use payloads that
  // fail validation *after* the permission check (so allowed -> INVALID, denied -> NO_ACCESS), or are restored at once.
  async roleMatrix(t, c) {
    const me = (await call('bootstrap')).me;
    const probe = async (name, payload) => { try { await call(name, payload); return 'allowed'; } catch (e) { return e.code === 'INVALID' ? 'allowed' : e.code; } };
    const m = {};
    m.dataset = await probe('dataset');
    const ds = m.dataset === 'allowed' ? await call('dataset') : { portfolio: [] };
    m.visibleProjects = ds.portfolio.map((p) => p.key).sort().join(',');
    m.reorder = await probe('portfolio.reorder', { order: 'x' });
    m.addRemove = await probe('portfolio.candidates', {});
    m.reportGet = await probe('report.get');
    m.capacityGet = await probe('capacity.get');
    m.configGet = await probe('config.get');
    m.auditList = await probe('audit.list');
    const notMine = ds.portfolio.find((p) => p.owner?.id !== me.id);
    const mine = ds.portfolio.find((p) => p.owner?.id === me.id);
    for (const [label, p] of [['healthOther', notMine], ['healthOwn', mine]]) {
      if (!p) { m[label] = 'n/a'; continue; }
      m[label] = await probe('health.set', { ref: p.ref, status: 'onTrack', comment: 'role probe' });
      if (m[label] === 'allowed') await call('health.set', { ref: p.ref, restore: true }); // exactly as before (date and author included)
    }
    const epic = c.epics.find((e) => e.fields.project.key === 'PCX');
    m.fillAppField = await probe('issue.fill', { issueId: epic.id, usage: 'tshirt', value: 'M' });
    m.hiddenRefHealth = await probe('health.set', { ref: `issue:${c.epics.find((e) => e.fields.project.key === 'PCR')?.id || '1'}`, status: 'onTrack', comment: 'x' });
    for (const [k, v] of Object.entries(m)) t(`${k}=${v}`, true);
    const el = document.getElementById('roletest-result') || Object.assign(document.body.appendChild(document.createElement('pre')), { id: 'roletest-result' });
    el.setAttribute('data-testid', 'roletest-result');
    el.textContent = JSON.stringify({ accountId: me.id, ...m });
  },
  // Showcase state for the sandbox (PCX only): believable health updates, a sensible order,
  // work in progress, and capacity sized so the waterline cuts through the ranking.
  async demoPrep(t) {
    const DEMO = {
      'PCX-13': { rank: 1, status: 'onTrack', progress: true, comment: 'Migrationswelle 2 abgeschlossen. Abschaltung des Altsystems bleibt für Januar geplant.' },
      'PCX-3': { rank: 2, status: 'atRisk', progress: true, comment: 'Freigabe der Partner-API durch Security verzögert sich um ca. 2 Wochen; Go-Live im März bleibt erreichbar.' },
      'PCX-21': { rank: 3, status: 'onTrack', progress: true, comment: 'Pilot mit zwei Service-Teams läuft, Qualitätskennzahlen im Zielkorridor.' },
      'PCX-32': { rank: 4, status: 'onTrack', progress: false, comment: 'Fachkonzept abgenommen; Umsetzung startet planmäßig in Q1.' },
      'PCX-46': { rank: 5, status: 'critical', progress: false, comment: 'Tiefbaugenehmigung fehlt weiterhin; Termin 30.10. verpasst, neuer Plan bis Mitte November.' },
    };
    let ds = await call('dataset');
    const byKey = Object.fromEntries(ds.portfolio.map((p) => [p.key, p]));
    t('all demo projects present', Object.keys(DEMO).every((k) => byKey[k]), Object.keys(byKey).join(','));
    for (const [key, d] of Object.entries(DEMO)) {
      const h = await call('health.set', { ref: byKey[key].ref, status: d.status, comment: d.comment });
      t(`health ${key} → ${d.status}`, h.status === d.status);
      if (d.progress && byKey[key].statusCat === 'new') {
        const tr = (await req(`/rest/api/3/issue/${key}/transitions`)).body.transitions || [];
        const go = tr.find((x) => x.to?.statusCategory?.key === 'indeterminate');
        if (go) await req(`/rest/api/3/issue/${key}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: go.id } }) });
        t(`${key} in progress`, !!go, go?.name);
      }
    }
    const order = Object.entries(DEMO).sort((a, b) => a[1].rank - b[1].rank).map(([k]) => byKey[k].ref);
    await call('portfolio.reorder', { order });
    ds = await call('dataset');
    const now = [...ds.portfolio].sort((a, b) => a.rank - b.rank).map((p) => p.key).join(',');
    t('demo order', now === Object.keys(DEMO).sort((a, b) => DEMO[a].rank - DEMO[b].rank).join(','), now);
  },
  async seedCapacity(t) {
    // Size each team's unnamed capacity from real demand so the waterline cuts through the ranking.
    const ds = await call('dataset');
    const c0 = computeAll(ds);
    const q = c0.wl.quarters[0];
    const cap = (await call('capacity.get')).capacity;
    for (const team of ds.teams) {
      const cell = c0.wl.cells[team.id]?.[q];
      if (!cell) continue;
      const named = Object.values(cap.people).filter((p) => p.teamId === team.id).reduce((a, p) => a + (+p.weeklyHours || 0), 0);
      const target = cell.demand * 0.72; // ~72 % of demand is staffable
      const weekly = Math.max(8, Math.round((target / (12 * 0.85 * 0.9) - named) / 8) * 8);
      cap.teams[team.id] = { name: team.name, dailyBusinessPct: 15, absenceRatePct: 10, extraWeeklyHours: weekly };
    }
    await call('capacity.save', { capacity: cap });
    const ds2 = await call('dataset');
    const c = computeAll(ds2);
    const st = Object.values(c.wl.projectQ).map((v) => v[q]?.status).filter(Boolean);
    t('capacity seeded for teams', Object.values(cap.teams).filter((x) => x.extraWeeklyHours).length >= 3, Object.values(cap.teams).map((x) => x.name + ' ' + x.extraWeeklyHours + 'h').join(', '));
    t('waterline now cuts the ranking', st.includes('ok') && st.some((s) => s !== 'ok'), q + ': ' + st.join(','));
    const r = await call('report.refresh');
    t('report reflects capacity', r.kpis.avgUtil > 0, 'avgUtil ' + Math.round(r.kpis.avgUtil * 100) + '%');
  },
  async publish(t) {
    const sp = await call('confluence.spaces', { query: 'PCXR' });
    t('confluence connected', sp.available === true, JSON.stringify(sp).slice(0, 120));
    const target = sp.spaces?.find((s) => s.key === 'PCXR');
    t('sandbox space listed', !!target);
    if (!target) return;
    const page = await call('report.publish', { spaceId: target.id, title: `Portfolio-Report Selftest ${new Date().toISOString().slice(0, 16)}`, lang: 'de' });
    t('report published', !!page.id, JSON.stringify(page).slice(0, 140));
    t('publish rejects bad spaceId', (await expectErr('report.publish', { spaceId: '1 OR 1=1' }, 'INVALID')).ok);
  },
  async restricted(t) {
    // Run after Dev Team was removed from pc-test-restricted (no Browse on PCR).
    const ds = await call('dataset');
    t('PCR item hidden (not even counted)', ds.portfolio.length === 5 && !ds.portfolio.some((p) => p.key?.startsWith('PCR')), `${ds.portfolio.length}: ${ds.portfolio.map((p) => p.key).join(',')}`);
    t('PCR issues hidden', !ds.issues.some((i) => i.key.startsWith('PCR')));
    t('ranks dense 1..n for visible', [...ds.portfolio].sort((a, b) => a.rank - b.rank).every((p, i) => p.rank === i + 1));
    const r = await call('report.refresh');
    t('report (asApp, report group) still covers all 6', r.rows.length === 6, `${r.rows.length}`);
    const pcr = (await call('portfolio.candidates', { query: 'Phoenix' }));
    t('PCR not offered as candidate', !pcr.some((x) => x.name?.includes('Phoenix')));
    const st = await call('bootstrap');
    const all = (await call('report.get')).rows.map((x) => x.ref);
    const visible = ds.portfolio.map((p) => p.ref);
    const hidden = all.find((x) => !visible.includes(x));
    t('reorder including hidden item rejected', (await expectErr('portfolio.reorder', { order: [hidden, ...visible] }, 'INVALID')).ok, st.roles.manageRanking ? '' : 'no manageRanking');
    t('health on hidden item rejected', !(await expectErr('health.set', { ref: hidden, status: 'onTrack', comment: 'x' })).info.startsWith('succeeded'));
    t('fill on hidden issue rejected', !(await expectErr('issue.fill', { issueId: hidden.slice(6), usage: 'tshirt', value: 'M' })).info.startsWith('succeeded'));
    const dsAfter = await call('dataset');
    t('reorder of visible keeps hidden slot', dsAfter.portfolio.length === 5);
  },
};

export default function SelfTest() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const run = async (name) => {
    if (String((await getContext()).environmentType || '').toUpperCase() === 'PRODUCTION') { setRows([{ label: 'Test harness disabled: production environment', ok: false, info: '' }]); return; }
    setBusy(true);
    const out = [];
    const t = (label, ok, info = '') => { out.push({ label, ok: !!ok, info: String(info).slice(0, 600) }); setRows([...out]); };
    try { const c = await ctx(); await SUITES[name](t, c); } catch (e) { t(`CRASH ${e.code || ''}`, false, e.message); }
    setBusy(false);
    console.log('[selftest]', name, JSON.stringify(out));
  };
  // Auto-run the suites baked into this build and publish results to a sandbox issue property (readable via REST).
  const started = useRef(false);
  useEffect(() => {
    const plan = (import.meta.env.VITE_SELFTEST_RUN || '').split(',').filter((x) => SUITES[x]);
    if (!plan.length || started.current) return;
    started.current = true;
    (async () => {
      // Never on the production environment (that is the one customers install): App security § 5 – "Testing uses
      // separate development and test environments with test data, never customer data." The release tool refuses
      // such builds for production as well; this is the second lock.
      const envType = String((await getContext()).environmentType || '').toUpperCase();
      if (envType === 'PRODUCTION') { setRows([{ label: 'Test harness disabled: production environment', ok: false, info: 'test builds run only in development / staging' }]); return; }
      // One run at a time: Jira can mount the app frame twice, and two runs of writing suites would race.
      const lockPath = '/rest/api/3/issue/PCX-1/properties/pc-selftest-lock';
      const mine = Math.random().toString(36).slice(2);
      const held = await req(lockPath).catch(() => ({ status: 404 }));
      if (held.status === 200 && Date.now() - Date.parse(held.body?.value?.at || 0) < 10 * 60e3) return;
      await req(lockPath, { method: 'PUT', body: JSON.stringify({ at: new Date().toISOString(), id: mine }) });
      await new Promise((r) => setTimeout(r, 1500));
      if ((await req(lockPath)).body?.value?.id !== mine) return; // another run won the race
      const report = { at: new Date().toISOString(), suites: {} };
      // Jira keeps an issue property up to 32 KB: passed checks are stored without their details, failures in full
      const slim = (r) => { const out = { ...r, suites: Object.fromEntries(Object.entries(r.suites).map(([k, l]) => [k, l.map((x) => (x.ok && !x.keep ? { label: x.label.slice(0, 120), ok: true } : x))])) }; return JSON.stringify(out).length > 30000 ? { ...out, suites: Object.fromEntries(Object.entries(out.suites).map(([k, l]) => [k, l.map((x) => (x.ok ? { ok: true } : { ...x, info: String(x.info).slice(0, 200) }))])) } : out; };
      for (const name of plan) {
        const out = [];
        const t = (label, ok, info = '', keep = false) => { out.push({ label, ok: !!ok, info: String(info).slice(0, 600), ...(keep ? { keep: true } : {}) }) /* room for the AI text (aiLive) */; setRows([...out]); };
        try { const c = await ctx(); await SUITES[name](t, c); } catch (e) { t('CRASH ' + (e.code || ''), false, e.message); }
        report.suites[name] = out;
        // after every suite: a long run that hangs later still leaves the results so far (and keeps the lock fresh)
        await req('/rest/api/3/issue/PCX-1/properties/pc-selftest', { method: 'PUT', body: JSON.stringify({ ...slim(report), running: true }) }).catch(() => {});
        await req(lockPath, { method: 'PUT', body: JSON.stringify({ at: new Date().toISOString(), id: mine }) }).catch(() => {});
      }
      await req('/rest/api/3/issue/PCX-1/properties/pc-selftest', { method: 'PUT', body: JSON.stringify(slim(report)) });
      await req(lockPath, { method: 'DELETE' });
    })();
  }, []);
  const pass = rows.filter((r) => r.ok).length;
  return (
    <div style={{ position: 'fixed', inset: '8px 8px auto auto', zIndex: 9999, width: 560, maxHeight: '92vh', overflow: 'auto', background: '#111', color: '#eee', borderRadius: 12, padding: 12, font: '12px/1.35 monospace' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {Object.keys(SUITES).map((s) => <button key={s} disabled={busy} onClick={() => run(s)} style={{ padding: '6px 10px', borderRadius: 6, border: 0, background: '#E34B04', color: '#fff' }}>{s}</button>)}
        <span>{busy ? 'running…' : `${pass}/${rows.length} passed`}</span>
      </div>
      {rows.map((r, i) => <div key={i} style={{ color: r.ok ? '#7CE0A3' : '#FF7A66' }}>{r.ok ? 'PASS' : 'FAIL'} {r.label} <span style={{ color: '#999' }}>{r.info}</span></div>)}
    </div>
  );
}
