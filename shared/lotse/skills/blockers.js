// Blockers and dependencies: work in the Blocked status (since when, why, what it waits for) and schedule conflicts
// between dependent work items (engine.js dependencies). Reasons are Jira comments – evidence.text only.
import { computedOf, newStory, addProject, kpi, ev, finding, action, follow, done, pickProject, T, say, worst } from '../kit.js';
import { plural, list } from '../narrate.js';

export default {
  id: 'blockers',
  title: (L) => T(L, 'Blockaden und Abhängigkeiten', 'Blockers and dependencies'),
  params: ['project', 'mine'],
  match: [/blockiert|blocked|blockade|blocker|blockt|haengt fest|haengen fest|haeng(t|en) (\w+ )?fest|steht still|stuck|wartet auf|waiting (for|on)|abhaengig|depend|terminkonflikt|schedule conflict|konflikt|conflict|was (bremst|blockiert|haelt)|what (blocks|holds|slows)/],
  run(ctx, p, L) {
    const c = computedOf(ctx);
    const { model, deps } = c;
    const it = pickProject(ctx, p);
    const me = p?.mine ? ctx.me?.id : null;
    const get = (id) => model.byId.get(id) || model.external.get(id);
    const inScope = (id) => { const i = get(id); return i && (!it || i.rootRef === it.ref) && (!me || i.assignee?.id === me); };
    const blocked = deps.blocked.filter((b) => inScope(b.id));
    const conflicts = deps.list.filter((d) => d.conflict && (inScope(d.pre) || inScope(d.dep)));
    const missingNotes = deps.list.filter((d) => d.missingNote && (inScope(d.pre) || inScope(d.dep))).length;
    const subject = it ? { kind: 'project', ref: it.ref, name: it.name } : me ? { kind: 'person', ref: `person:${me}`, name: T(L, 'Meine Aufgaben', 'My tasks') } : { kind: 'portfolio', ref: null, name: 'Portfolio' };
    const s = newStory(ctx, { skill: 'blockers', subject, lang: L });
    const F = s.fmt;
    if (it) addProject(s, it);
    const oldest = blocked.find((b) => b.days != null);
    s.kpis.push(kpi('blocked', T(L, 'Blockiert', 'Blocked'), blocked.length, 'n', { tone: blocked.length ? 'bad' : 'ok' }));
    if (oldest) s.kpis.push(kpi('oldest', T(L, 'Älteste Blockade', 'Oldest blocker'), oldest.days, 'd', { tone: oldest.days > 7 ? 'bad' : 'warn' }));
    s.kpis.push(kpi('conflicts', T(L, 'Terminkonflikte', 'Schedule conflicts'), conflicts.length, 'n', { tone: conflicts.length ? 'warn' : 'ok' }));
    s.kpis.push(kpi('notes', T(L, 'Ohne Hinweis', 'Without a note'), missingNotes, 'n', { tone: missingNotes ? 'info' : 'ok' }));
    if (blocked.length) {
      s.visual = { kind: 'bars', data: { unit: 'd', items: blocked.slice(0, 12).map((b) => { const i = get(b.id); return { label: i.key, key: i.key, value: b.days ?? 0, tone: (b.days ?? 0) > 7 ? 'bad' : 'warn', sub: b.waitsOn.length ? T(L, `wartet auf ${b.waitsOn.map((x) => get(x)?.key).filter(Boolean).join(', ')}`, `waits for ${b.waitsOn.map((x) => get(x)?.key).filter(Boolean).join(', ')}`) : T(L, 'ohne verknüpften Vorgänger', 'no linked prerequisite') }; }) },
        caption: T(L, 'Vorgänge im Status Blocked: seit wie vielen Tagen.', 'Work items in the Blocked status: for how many days.') };
    } else if (conflicts.length) {
      s.visual = { kind: 'bars', data: { unit: 'd', items: conflicts.slice(0, 12).map((d) => { const a = get(d.dep), b = get(d.pre); return { label: `${a?.key} ← ${b?.key}`, key: a?.key, value: d.conflictDays, tone: 'warn' }; }) },
        caption: T(L, 'Terminkonflikte: so viele Tage startet die abhängige Aufgabe vor dem Ende ihres Vorgängers.', 'Schedule conflicts: how many days the dependent task starts before its prerequisite ends.') };
    } else {
      s.visual = { kind: 'donut', data: { unit: 'n', total: deps.open, items: [{ label: T(L, 'offene Abhängigkeiten ohne Konflikt', 'open dependencies without conflict'), value: deps.open, tone: 'ok' }] }, caption: T(L, 'Offene Abhängigkeiten – keine blockiert, kein Konflikt.', 'Open dependencies – none blocked, no conflict.') };
    }
    for (const b of blocked.slice(0, 2)) {
      const i = get(b.id);
      const wait = b.waitsOn.map((x) => get(x)?.key).filter(Boolean);
      const proj = model.itemByRef.get(i.rootRef);
      if (proj) addProject(s, proj);
      s.findings.push(finding(T(L, `${i.key}${proj ? ` (${proj.name})` : ''} steht ${b.days != null ? `seit ${b.days} Tagen ` : ''}auf Blocked${wait.length ? ` und wartet auf ${list(wait, L)}` : ''}.`, `${i.key}${proj ? ` (${proj.name})` : ''} has been blocked${b.days != null ? ` for ${b.days} days` : ''}${wait.length ? ` and waits for ${list(wait, L)}` : ''}.`), (b.days ?? 0) > 7 ? 'bad' : 'warn', 80 + Math.min(15, (b.days ?? 0) / 2),
        [ev(T(L, 'Tage blockiert', 'days blocked'), b.days ?? undefined, b.days != null ? 'd' : null, { key: i.key, text: b.reason || undefined }), ...(b.since ? [ev(T(L, 'seit', 'since'), b.since, 'date')] : []), ...wait.slice(0, 3).map((k) => ev(T(L, 'wartet auf', 'waits for'), undefined, null, { key: k }))]));
    }
    if (blocked.length > 2) s.findings.push(finding(T(L, `Insgesamt ${blocked.length} Vorgänge blockiert.`, `${blocked.length} work items blocked in total.`), 'warn', 60, [ev(T(L, 'blockiert', 'blocked'), blocked.length, 'n')]));
    if (conflicts.length) {
      const d = conflicts[0];
      const a = get(d.dep), b = get(d.pre);
      s.findings.push(finding(T(L, `${conflicts.length} ${plural(conflicts.length, 'Terminkonflikt', 'Terminkonflikte')}, der größte: ${a?.key} startet ${d.conflictDays} Tage vor dem Ende von ${b?.key}.`, `${conflicts.length} schedule ${plural(conflicts.length, 'conflict', 'conflicts')}, the largest: ${a?.key} starts ${d.conflictDays} days before ${b?.key} ends.`), 'warn', 70,
        [ev(T(L, 'Konflikte', 'conflicts'), conflicts.length, 'n'), ev(T(L, 'Tage', 'days'), d.conflictDays, 'd', { key: a?.key }), ev(T(L, 'Vorgänger', 'prerequisite'), undefined, null, { key: b?.key }), ...(b?.due ? [ev(T(L, 'Ende Vorgänger', 'prerequisite ends'), b.due, 'date')] : []), ...(a?.start ? [ev(T(L, 'Start', 'start'), a.start, 'date')] : [])]));
    }
    if (missingNotes) s.findings.push(finding(T(L, `${missingNotes} offene Abhängigkeiten haben keinen Hinweis, warum sie bestehen.`, `${missingNotes} open dependencies have no note on why they exist.`), 'info', 25, [ev(T(L, 'ohne Hinweis', 'without a note'), missingNotes, 'n')]));
    if (!s.findings.length) s.findings.push(finding(T(L, 'Nichts blockiert und kein Terminkonflikt.', 'Nothing is blocked and there is no schedule conflict.'), 'ok', 10, []));
    s.tone = worst(...s.findings.map((f) => (f.tone === 'info' ? null : f.tone)));
    s.headline = !blocked.length && !conflicts.length ? T(L, `${it ? `${it.name}: n` : 'N'}ichts blockiert, kein Terminkonflikt.`, `${it ? `${it.name}: n` : 'N'}othing blocked, no schedule conflict.`)
      : say(s.id, 'h', [T(L, `${blocked.length} ${plural(blocked.length, 'Vorgang', 'Vorgänge')} blockiert${oldest ? `, der älteste seit ${oldest.days} Tagen` : ''}; dazu ${conflicts.length} ${plural(conflicts.length, 'Terminkonflikt', 'Terminkonflikte')}.`, `${blocked.length} work ${plural(blocked.length, 'item', 'items')} blocked${oldest ? `, the oldest for ${oldest.days} days` : ''}; plus ${conflicts.length} schedule ${plural(conflicts.length, 'conflict', 'conflicts')}.`),
        T(L, `Es hängt an ${blocked.length} blockierten ${plural(blocked.length, 'Vorgang', 'Vorgängen')} und ${conflicts.length} ${plural(conflicts.length, 'Terminkonflikt', 'Terminkonflikten')}.`, `Things hang on ${blocked.length} blocked work ${plural(blocked.length, 'item', 'items')} and ${conflicts.length} schedule ${plural(conflicts.length, 'conflict', 'conflicts')}.`)]);
    const first = blocked[0] ? get(blocked[0].id) : null;
    if (first) s.actions.push(action('open', first.key, 'open', { key: first.key, issueId: first.id }, T(L, `Öffnet ${first.key} in Jira.`, `Opens ${first.key} in Jira.`)));
    if (conflicts[0]) { const a = get(conflicts[0].dep); const pr = a ? model.itemByRef.get(a.rootRef) : null; if (pr) s.actions.push(action('whatIfDue', T(L, `${pr.name} +2 Wochen?`, `${pr.name} +2 weeks?`), 'whatIf', { change: { kind: 'due', ref: pr.ref, weeks: 2 } }, T(L, `Rechnet durch, was 2 Wochen später für ${pr.name} ändern – nichts wird gespeichert.`, `Works out what 2 weeks later for ${pr.name} change – nothing is saved.`))); }
    s.actions.push(action('deps', T(L, 'Abhängigkeiten', 'Dependencies'), 'navigate', { view: 'deps', ...(it ? { ref: it.ref } : {}) }, T(L, 'Öffnet das Abhängigkeitsnetz.', 'Opens the dependency network.')));
    s.followUps.push(follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')), follow(T(L, 'Portfolio-Lage', 'Portfolio'), T(L, 'Lagebild Portfolio', 'Portfolio briefing')), ...(it ? [follow(T(L, 'Lagebild', 'Briefing'), T(L, `Lagebild ${it.name}`, `Briefing ${it.name}`))] : []));
    s.how = { text: T(L, 'Blockiert = Stories und Sub-tasks in den konfigurierten Blocked-Status, seit der letzten Änderung dorthin (Jira-Historie); Grund = letzter Kommentar. Konflikt = die abhängige Aufgabe startet vor dem Due Date ihres Vorgängers (nur konfigurierte Link-Typen).', 'Blocked = stories and sub-tasks in the configured Blocked statuses, since the last change to it (Jira history); reason = latest comment. Conflict = the dependent task starts before its prerequisite\'s due date (configured link types only).'),
      inputs: [[T(L, 'Offene Abhängigkeiten', 'Open dependencies'), String(deps.open)], [T(L, 'Konflikte gesamt', 'Conflicts in total'), String(deps.conflicts)]] };
    s.confidence = 'high';
    s.sources = ['Jira'];
    return done(s);
  },
};
