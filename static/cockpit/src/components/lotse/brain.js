// Lotse in the search (Ctrl K): loaded with the first opening of the search (App.jsx imports it lazily), so the main
// bundle stays small. Pure functions of the app state – no hooks:
//   ctxOf(app)            the engine's context (the same inputs as useLotseCtx in engine.js)
//   instant(text, ctx)    what Lotse understood, as the search's top row: story / action / workflow / decision, with a
//                         live mini-preview for an action (count + the first changes) – nothing is ever applied here
//   commandRows(ctx, s)   the commands this person may run, each with a sentence to start from
//   jobRows(ctx, s)       the ten jobs (workflows) matching the typed words; suggestedJobs(ctx) for an empty field
import * as Engine from '@shared/lotse/index.js';
import { fmt, getLang, ruleName, tr } from '../../lib/i18n.js';
import { learnedStore } from '../../lib/lotseLearned.js';
import { JOBS, jobOf } from './acts.js';

const L2 = (p) => tr(p[0], p[1]);
export function ctxOf({ computed, ds, roles, boot, config }) {
  if (!computed) return null;
  return { computed, ds, roles, me: boot?.me, lang: getLang(), fmt, ruleName, config, supportA: computed.supportA || null, cal: ds?.config?.support?.sla, learned: learnedStore.get() };
}

function paramText(params, ctx) {
  const m = ctx.computed.model;
  const bits = [];
  if (params?.team) bits.push(`${tr('Team', 'Team')} ${m.teams.get(params.team)?.name || params.team}`);
  if (params?.ref) bits.push(m.itemByRef.get(params.ref)?.name || params.ref);
  if (params?.person) bits.push(ctx.ds?.people?.[params.person]?.name || params.person);
  if (params?.quarter) bits.push(fmt.quarter ? fmt.quarter(params.quarter) : params.quarter);
  return bits.join(' · ');
}
// → { kind: 'story'|'command'|'workflow'|'decide', icon, label, sub, hint, mini?: { count, rows[], blocked } } | null
export function instant(text, ctx) {
  const t = String(text || '').trim();
  if (t.length < 3 || !ctx) return null;
  let u;
  try { u = Engine.understand(t, ctx, {}); } catch { return null; }
  if (u.kind === 'workflow') {
    const job = jobOf(u.workflow);
    const p = paramText(u.params, ctx);
    return { kind: 'workflow', icon: job?.icon || 'layers', label: u.title, sub: [p, tr('Schritt für Schritt mit Vorschau', 'step by step with a preview')].filter(Boolean).join(' · '), hint: tr('Aufgabe', 'Job') };
  }
  if (u.kind === 'command') {
    let pv = null;
    try { pv = Engine.previewCommand(u.command, u.params, ctx); } catch { pv = null; }
    const title = u.describe || Engine.COMMANDS[u.command]?.title(getLang());
    if (!pv) return { kind: 'command', icon: 'zap', label: title, sub: tr('Passt nicht zu den aktuellen Daten – Lotse zeigt, warum.', 'Does not fit the current data – Lotse shows why.'), hint: tr('Aktion', 'Action') };
    return {
      kind: 'command', icon: 'zap', label: title, hint: pv.write ? tr('Vorschau', 'Preview') : tr('Aktion', 'Action'),
      sub: pv.blocked ? `${tr('Nicht möglich', 'Not possible')}: ${pv.blocked}` : pv.summary,
      mini: { count: pv.count, blocked: !!pv.blocked, rows: (pv.changes || []).slice(0, 3).map((c) => ({ subject: c.key || '', from: c.from, to: c.to, label: c.label })) },
    };
  }
  if (u.kind === 'decide') return { kind: 'decide', icon: 'target', label: u.question, sub: (u.options || []).slice(0, 3).map((o) => o.label).join(' · '), hint: tr('Rückfrage', 'Question') };
  const sk = u.skill && u.skill !== 'guard' && Engine.SKILLS[u.skill];
  const title = sk ? (typeof sk.title === 'function' ? sk.title(getLang()) : sk.title) : null;
  return { kind: 'story', icon: 'target', label: `${tr('Lotse fragen', 'Ask Lotse')}: „${t}“`, sub: title ? `${tr('Antwort als Bild', 'Answer as a picture')} · ${title}` : tr('Bild mit echten Zahlen', 'picture with real numbers'), hint: tr('Antwort', 'Answer') };
}

const EXAMPLES = {
  'rank.set': ['<Projekt> auf Rang 2', 'Move <project> to rank 2'],
  'rank.reorder': ['Ranking für das Quartal neu setzen', 'Re-rank the quarter'],
  'issue.setField': ['Setze die Schätzung von <KEY-12> auf 8 h', 'Set the estimate of <KEY-12> to 8 h'],
  'issue.bulkFill': ['Gib allen Stories ohne Team in <Projekt> das Team <Team>', 'Give all stories without a team in <project> the team <team>'],
  'plan.move': ['Verschiebe alles von <Person> in KW 48 eine Woche später', 'Move everything of <person> in week 48 one week later'],
  'plan.applyOptimizer': ['Löse die Überlast in Team <Team>', 'Resolve the overload of team <team>'],
  'health.set': ['Setze die Health von <Projekt> auf gefährdet', 'Set the health of <project> to at risk'],
  'dispatch.assign': ['Verteile die neuen Support-Tickets', 'Assign the new support tickets'],
  'support.reserve': ['Setze die Support-Reserve von Team <Team> auf 20 h', 'Set the support reserve of team <team> to 20 h'],
  'deps.link': ['<KEY-12> blockiert <KEY-47>', '<KEY-12> blocks <KEY-47>'],
  'deps.unlink': ['Entferne die Abhängigkeit <KEY-12> → <KEY-47>', 'Remove the dependency <KEY-12> → <KEY-47>'],
  'booking.book': ['Buche 2 h auf <KEY-12> heute', 'Log 2 h on <KEY-12> today'],
  'notice.remind': ['Erinnere mein Team ans Buchen', 'Remind my team to log time'],
  'capacity.setHours': ['Setze die Wochenstunden von <Person> auf 32', 'Set the weekly hours of <person> to 32'],
  'report.compose': ['Erstelle den C-Level-Report', 'Create the C-level report'],
  navigate: ['Öffne die Wochenplanung', 'Open weekly planning'],
};
const has = (s, ...ws) => !s || ws.some((w) => String(w || '').toLowerCase().includes(s));
export function commandRows(ctx, s) {
  if (!ctx) return [];
  let list = [];
  try { list = Engine.commandList(ctx); } catch { return []; }
  return list.filter((c) => c.allowed && c.id !== 'navigate' && EXAMPLES[c.id] && has(s, c.title, ...EXAMPLES[c.id])).map((c) => ({ id: c.id, title: c.title, example: L2(EXAMPLES[c.id]), write: c.write }));
}
export function jobRows(s) {
  return JOBS.filter((j) => has(s, ...j.title, ...j.line)).map((j) => ({ ...j, label: L2(j.title), sub: L2(j.line) }));
}
const BY_ROLE = { employee: ['bookingCheck'], projectAdmin: ['fillGaps', 'healthRound', 'fixConflicts'], management: ['cLevelReport', 'reRankQuarter', 'resolveOverload'] };
export function suggestedJobs(ctx) {
  let role = 'projectAdmin';
  try { role = Engine.roleOf(ctx) || role; } catch { /* default */ }
  return (BY_ROLE[role] || BY_ROLE.projectAdmin).map(jobOf).filter(Boolean).map((j) => ({ ...j, label: L2(j.title), sub: L2(j.line) }));
}
