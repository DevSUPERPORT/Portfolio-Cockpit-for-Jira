// Lotse missions – knowledge from the past: learn from finished projects and their comments, and turn recurring
// support topics into playbooks and standard replies.
//
//   learnFromPast     { project }   what similar finished work says about a project's open stories (estimate vs. time
//                                   spent, the team's estimate factor, the themes in the comments of that work) →
//                                   decide: fill missing estimates (median of similar finished stories, else siblings –
//                                   the gapsFix basis), optionally correct existing ones by the team factor (never by
//                                   default), one by one with own hours → optional risk note in the health update →
//                                   preview → apply (issue.bulkFill, health.set) → summary.
//   supportPlaybooks  {}            recurring support topics (insights.supportTopics): tickets, hours, last occurrence,
//                                   which already have a playbook → decide which topics, per topic the playbookDraft draft
//                                   (symptoms, steps, standard reply without internal figures; own words for the proven
//                                   fix) → preview → apply (playbook.save, app storage only) → open Support › Playbooks.
//
// Data: the done stories of the dataset plus ctx.history.stories (insights.history) when the caller passed it; comment
// counts from the history rows, comment TEXTS only from ctx.comments ({ [issueId]: { count, last: [{ text }] } } – the
// insights.comments shape; the server sends texts only when the admin allows them); playbooks from ctx.playbooks
// (playbooks.list: array or { items }) – without it the command checks the stored playbooks itself when saving.
// Missing data is said plainly (info stories, thin-history findings), never filled in.
import { similarWork, estimateFactors, supportTopics, median, words } from '../../insights.js';
import { poolOf, ticketsOf } from '../../ask.js';
import { canReadPlaybooks, canEditPlaybooks } from '../../playbooks.js';
import { suggestFor } from '../skills/gapsFix.js';
import { draftHealth } from '../skills/healthDraft.js';
import { playbookOf } from '../skills/playbookDraft.js';
import { lessonsOf, commentKeywords } from '../skills/similarSummary.js';
import { newStory, addProject, kpi, ev, finding, follow, done as doneStory, infoStory, sum, isOpen, teamName as teamNameOf } from '../kit.js';
import { T, langOf, r1, r2, can, cleanValue, valueText, dsOf, computedOf, plural, healthName, fact } from './kit.js';

const THIN_POOL = 10; // fewer finished stories than this: the past is thin – said plainly, siblings help out
const MAX_TOPICS = 8;
const KEY_RE = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/;
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
// numbers that are part of a name ("Drucker im 2. OG") are no measured values – they still stand in the facts
const nameFacts = (s) => [...String(s || '').matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => fact('name', Number(m[0].replace(',', '.'))));
const commentTexts = (comments, id) => (comments?.[String(id)]?.last || []).map((c) => (typeof c === 'string' ? c : c?.text)).filter(Boolean);
const short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

// ---------- learnFromPast: the analysis ----------
// For each open story of the project: the similar finished stories (similarWork, as gapsFix does), grouped by the open
// story's summary; the estimate factor of the story's team; the comments of that similar work.
export function pastOf(ctx, ref) {
  const c = computedOf(ctx);
  const { model } = c;
  const it = model.itemByRef.get(ref);
  const open = (dsOf(ctx).issues || []).filter((i) => i.rootRef === ref && i.role === 'estimate' && isOpen(i))
    .sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));
  const pool = poolOf(ctx);
  const hits = new Map(); // past key → similarWork item
  const groups = new Map(); // open summary → { label, open: [keys], past: Set(keys) }
  let poolSize = pool.filter((r) => (r.statusCat ?? r.status?.cat) === 'done' || r.resolved).length;
  for (const i of open.slice(0, 80)) {
    const parent = i.parentId ? model.byId.get(i.parentId) : null;
    const sim = similarWork({ id: i.id, key: i.key, summary: i.summary, team: i.team, type: i.type, parentSummary: parent?.summary, components: i.components, labels: i.labels }, pool, { limit: 6 });
    poolSize = Math.max(poolSize, sim.poolSize);
    const g = groups.get(norm(i.summary)) || groups.set(norm(i.summary), { label: short(i.summary, 60), open: [], past: new Set() }).get(norm(i.summary));
    g.open.push(i.key);
    for (const x of sim.items) { if (!hits.has(x.key)) hits.set(x.key, x); g.past.add(x.key); }
  }
  const past = [...hits.values()];
  // estimate vs. time spent per group: the medians of the similar finished stories that have both
  const rows = [...groups.values()].map((g) => {
    const both = [...g.past].map((k) => hits.get(k)).filter((x) => x.estimateH > 0 && x.actualH > 0);
    return { ...g, n: both.length, est: both.length ? r1(median(both.map((x) => x.estimateH))) : null, act: both.length ? r1(median(both.map((x) => x.actualH))) : null };
  }).filter((g) => g.n).sort((a, b) => b.open.length - a.open.length || b.n - a.n || a.label.localeCompare(b.label)).slice(0, 8);
  const withO = past.filter((x) => Number.isFinite(x.overrunPct));
  const over = withO.length ? Math.round(median(withO.map((x) => x.overrunPct))) : null;
  const les = lessonsOf({ items: past, stats: { typicalOverrunPct: over }, comments: ctx.comments || null }, langOf(ctx));
  // the recurring words of the comments, with the work items they come from
  const texted = past.map((x) => ({ key: x.key, texts: commentTexts(ctx.comments, x.id) })).filter((x) => x.texts.length);
  const kws = texted.length ? commentKeywords(texted.flatMap((x) => x.texts), 4).map((k) => {
    const tok = words(k.word)[0]?.t;
    return { word: k.word, n: k.n, keys: tok ? texted.filter((x) => x.texts.some((t) => words(t).some((w) => w.t === tok))).map((x) => x.key).filter((k2) => KEY_RE.test(k2)) : [] };
  }) : [];
  const counted = past.filter((x) => (ctx.comments?.[String(x.id)]?.count ?? x.comments) != null).length;
  // the team factor (time spent ÷ estimate of finished stories): per team, else all teams
  const ef = estimateFactors({ model, history: ctx.history || null });
  // missing estimates with a value from real data (gapsFix.suggestFor: similar finished work, else siblings)
  const missing = open.filter((i) => !(i.oe > 0));
  const sugg = [];
  for (const i of missing) {
    const sug = suggestFor(ctx, { issueId: i.id, field: 'originalEstimate', key: i.key });
    if (!sug || typeof sug.value !== 'number') continue;
    try { sugg.push({ issue: i, sug, value: cleanValue(ctx, 'estimate', sug.value) }); } catch { /* not a valid estimate */ }
  }
  // existing estimates of stories not started yet × their team's factor (only offered, never the default)
  const corr = [];
  for (const i of open) {
    if (!(i.oe > 0) || (i.status?.cat ?? i.statusCat ?? 'new') !== 'new') continue;
    const f = ef.factorFor(i.team?.id || null);
    if (f.source === 'none' || !Number.isFinite(f.factor) || Math.abs(f.factor - 1) < 0.1) continue;
    let v;
    try { v = cleanValue(ctx, 'estimate', i.oe * f.factor); } catch { continue; }
    if (v !== i.oe) corr.push({ issue: i, from: i.oe, value: v, f });
  }
  // the project's own comments right now: why stories are blocked (the latest comment, loaded with the dataset)
  const blocked = open.filter((i) => i.blockedReason).slice(0, 2);
  const teamId = it?.leadTeam?.id || it?.team?.id || null;
  return { it, open, pool, poolSize, past, rows, withO, over, les, kws, texted: texted.length, counted, ef, factor: ef.factorFor(teamId), teamId, missing, sugg, corr, blocked, thin: poolSize < THIN_POOL || past.length < 3 };
}

function pastStory(ctx, x) {
  const L = langOf(ctx);
  const { model } = computedOf(ctx);
  const s = newStory(ctx, { skill: 'similarSummary', subject: { kind: 'project', ref: x.it.ref, name: x.it.name }, lang: L });
  s.id = `similarSummary:past:${x.it.ref}`;
  const F = s.fmt;
  addProject(s, x.it);
  s.entities.texts = [];
  const nSim = x.sugg.filter((y) => y.sug.basis === 'similar').length, nSib = x.sugg.length - nSim;
  const sugH = r1(sum(x.sugg, (y) => y.value));
  s.kpis.push(kpi('open', T(L, 'Offene Stories', 'Open stories'), x.open.length, 'n', { tone: 'ink' }));
  s.kpis.push(kpi('missing', T(L, 'Ohne Schätzung', 'Without estimate'), x.missing.length, 'n', { tone: x.missing.length ? 'warn' : 'ok' }));
  s.kpis.push(kpi('similar', T(L, 'Ähnliche erledigte', 'Similar finished'), x.past.length, 'n', { hint: T(L, `aus ${x.poolSize} erledigten Stories`, `out of ${x.poolSize} finished stories`) }));
  if (x.over != null) s.kpis.push(kpi('overrun', T(L, 'Typischer Überzug', 'Typical overrun'), x.over, '%', { tone: x.over > 10 ? 'warn' : 'ok' }));
  else s.kpis.push(kpi('pool', T(L, 'Vergleichsbasis', 'Pool'), x.poolSize, 'n', { tone: x.thin ? 'warn' : undefined }));
  // visual: estimate vs. time spent of the similar finished work, per group of open stories
  if (x.rows.length) {
    s.visual = { kind: 'compare', data: { a: { label: T(L, 'Geschätzt (Median)', 'Estimated (median)') }, b: { label: T(L, 'Gebraucht (Median)', 'Spent (median)') },
      rows: x.rows.map((g) => ({ label: g.label, unit: 'h', a: g.est, b: g.act, better: 'lower', tone: g.act > g.est * 1.1 ? 'warn' : 'ok' })) },
    caption: T(L, 'Ähnliche erledigte Stories je Gruppe offener Stories: ihre Schätzung gegen die gebuchte Zeit.', 'Similar finished stories per group of open stories: their estimate against the logged time.') };
    for (const g of x.rows) s.entities.texts.push(g.label);
  } else {
    const withOe = x.open.length - x.missing.length;
    s.visual = { kind: 'donut', data: { unit: 'n', total: x.open.length, items: [{ label: T(L, 'mit Schätzung', 'with estimate'), value: withOe, tone: 'ok' }, { label: T(L, 'Vorschlag aus Daten', 'suggested from data'), value: x.sugg.length, tone: 'ink' }, { label: T(L, 'ohne Grundlage', 'no basis'), value: x.missing.length - x.sugg.length, tone: 'muted' }] },
      caption: T(L, 'Offene Stories des Projekts: geschätzt, mit Vorschlag aus echten Daten, ohne Grundlage.', 'Open stories of the project: estimated, with a suggestion from real data, without a basis.') };
  }
  if (x.thin) s.findings.push(finding(T(L, `Dünne Vergangenheit: nur ${x.poolSize} erledigte ${plural(x.poolSize, 'Story', 'Stories')} als Vergleich, ${x.past.length} davon ähnlich – Lotse nimmt zusätzlich die Schätzungen der Geschwister-Stories.`, `Thin history: only ${x.poolSize} finished ${plural(x.poolSize, 'story', 'stories')} to compare with, ${x.past.length} of them similar – Lotse also uses the estimates of sibling stories.`), 'warn', 90,
    [ev(T(L, 'erledigte Stories', 'finished stories'), x.poolSize, 'n'), ev(T(L, 'ähnlich', 'similar'), x.past.length, 'n')]));
  else s.findings.push(finding(T(L, `Für ${x.open.length} offene Stories fand Lotse ${x.past.length} ähnliche erledigte aus ${x.poolSize} Stories der Vergangenheit.`, `For ${x.open.length} open stories Lotse found ${x.past.length} similar finished ones among ${x.poolSize} past stories.`), 'info', 55,
    [ev(T(L, 'offen', 'open'), x.open.length, 'n'), ev(T(L, 'ähnlich', 'similar'), x.past.length, 'n'), ev(T(L, 'erledigte Stories', 'finished stories'), x.poolSize, 'n'), ...x.past.slice(0, 3).map((y) => ev(T(L, 'Vergleich', 'comparison'), undefined, null, { key: y.key }))]));
  if (x.withO.length >= 2) {
    const f = x.factor;
    // the team's own factor (enough finished stories of its own), else the factor of all teams – said as what it is
    const own = f.source === 'team' && x.teamId && model.teams.has(x.teamId);
    const fx = f.source !== 'none' ? T(L, ` Faktor ${own ? `von Team ${teamNameOf(model, x.teamId)}` : 'aller Teams'}: ${F.n(f.factor, 2)} aus ${f.n} Stories.`, ` Factor ${own ? `of team ${teamNameOf(model, x.teamId)}` : 'of all teams'}: ${F.n(f.factor, 2)} from ${f.n} stories.`) : '';
    if (own) s.entities.teams.push({ id: x.teamId, name: teamNameOf(model, x.teamId) });
    s.findings.push(finding(x.les.overN ? T(L, `${x.les.overN} von ${x.withO.length} ähnlichen Stories lagen über der Schätzung, typisch um ${Math.abs(x.over)} %.${fx}`, `${x.les.overN} of ${x.withO.length} similar stories ran over the estimate, typically by ${Math.abs(x.over)}%.${fx}`)
      : T(L, `Alle ${x.withO.length} ähnlichen Stories blieben im Rahmen der Schätzung.${fx}`, `All ${x.withO.length} similar stories stayed within the estimate.${fx}`), x.les.overN && x.over > 10 ? 'warn' : 'ok', 75,
    [ev(T(L, 'über Schätzung', 'over estimate'), x.les.overN, 'n'), ev(T(L, 'mit Schätzung', 'with estimate'), x.withO.length, 'n'), ...(x.over != null ? [ev(T(L, 'Überzug', 'overrun'), Math.abs(x.over), '%')] : []), ...(f.source !== 'none' ? [ev(T(L, 'Faktor', 'factor'), r2(f.factor), 'n'), ev(T(L, 'Stories im Faktor', 'stories in factor'), f.n, 'n')] : [])]));
  }
  if (x.kws.length) {
    const keys = [...new Set(x.kws.flatMap((k) => k.keys))].slice(0, 3);
    s.findings.push(finding(T(L, `In den Kommentaren dieser Arbeit immer wieder: ${x.kws.slice(0, 3).map((k) => `„${k.word}“ (${k.n})`).join(', ')}${keys.length ? ` – etwa in ${keys.join(', ')}` : ''}.`, `Recurring in the comments of that work: ${x.kws.slice(0, 3).map((k) => `"${k.word}" (${k.n})`).join(', ')}${keys.length ? ` – e.g. in ${keys.join(', ')}` : ''}.`), 'warn', 70,
      [...x.kws.slice(0, 3).map((k) => ev(k.word, k.n, 'n')), ...keys.map((k) => ev(T(L, 'Kommentar in', 'comment in'), undefined, null, { key: k }))]));
    for (const k of x.kws) s.entities.texts.push(k.word);
  } else if (x.les.talk) {
    const t = x.les.talk;
    s.findings.push(finding(t.many > t.few ? T(L, `Viel Abstimmung kostete Zeit: mit 3 und mehr Kommentaren typisch ${F.h(t.many, 1)} statt ${F.h(t.few, 1)} – Klärung früh einplanen. Die Kommentartexte selbst sind nicht geladen.`, `Much alignment cost time: with 3 or more comments typically ${F.h(t.many, 1)} instead of ${F.h(t.few, 1)} – plan clarification early. The comment texts are not loaded.`)
      : T(L, `Viel Abstimmung kostete keine Zeit: mit 3 und mehr Kommentaren ${F.h(t.many, 1)} gegen ${F.h(t.few, 1)}. Die Kommentartexte selbst sind nicht geladen.`, `Much alignment cost no time: with 3 or more comments ${F.h(t.many, 1)} against ${F.h(t.few, 1)}. The comment texts are not loaded.`), t.many > t.few ? 'warn' : 'info', 60,
    [ev(T(L, 'viel Abstimmung', 'much alignment'), t.many, 'h'), ev(T(L, 'wenig Abstimmung', 'little alignment'), t.few, 'h'), ev(T(L, 'Kommentare', 'comments'), 3, 'n'), ev(T(L, 'Stories mit 3+ Kommentaren', 'stories with 3+ comments'), t.nMany, 'n')]));
  } else if (x.past.length) {
    s.findings.push(finding(x.counted ? T(L, 'Die Kommentartexte der ähnlichen Arbeit sind nicht geladen, und die Kommentaranzahl allein zeigt kein Muster.', 'The comment texts of the similar work are not loaded, and the comment count alone shows no pattern.')
      : T(L, 'Zur ähnlichen Arbeit sind keine Kommentare geladen – Lotse wertet nur Schätzung und gebuchte Zeit aus.', 'No comments are loaded for the similar work – Lotse evaluates only estimate and logged time.'), 'info', 20, []));
  }
  if (x.missing.length) s.findings.push(finding(T(L, `${x.missing.length} offene ${plural(x.missing.length, 'Story hat', 'Stories haben')} keine Schätzung – für ${x.sugg.length} hat Lotse einen Wert${x.sugg.length ? ` (${[nSim ? `${nSim} aus ähnlicher erledigter Arbeit` : '', nSib ? `${nSib} aus Geschwistern` : '', `zusammen ${F.h(sugH, 1)}`].filter(Boolean).join(', ')})` : ''}.`, `${x.missing.length} open ${plural(x.missing.length, 'story has', 'stories have')} no estimate – Lotse has a value for ${x.sugg.length}${x.sugg.length ? ` (${[nSim ? `${nSim} from similar finished work` : '', nSib ? `${nSib} from siblings` : '', `${F.h(sugH, 1)} in total`].filter(Boolean).join(', ')})` : ''}.`), x.sugg.length ? 'warn' : 'info', 65,
    [ev(T(L, 'ohne Schätzung', 'without estimate'), x.missing.length, 'n'), ev(T(L, 'mit Vorschlag', 'with suggestion'), x.sugg.length, 'n'), ev(T(L, 'aus ähnlicher Arbeit', 'from similar work'), nSim, 'n'), ev(T(L, 'aus Geschwistern', 'from siblings'), nSib, 'n'), ev(T(L, 'Summe', 'total'), sugH, 'h')]));
  else s.findings.push(finding(T(L, `Alle ${x.open.length} offenen Stories haben eine Schätzung.`, `All ${x.open.length} open stories have an estimate.`), 'ok', 30, [ev(T(L, 'offen', 'open'), x.open.length, 'n')]));
  for (const b of x.blocked.slice(0, 1)) {
    s.findings.push(finding(T(L, `Im Projekt gerade blockiert: ${b.key} – letzter Kommentar „${short(b.blockedReason, 120)}“.`, `Blocked in the project right now: ${b.key} – latest comment "${short(b.blockedReason, 120)}".`), 'warn', 35, [ev(T(L, 'blockiert', 'blocked'), undefined, null, { key: b.key, text: short(b.blockedReason, 120) })]));
    s.entities.texts.push(short(b.blockedReason, 120));
  }
  s.tone = x.thin || (x.over != null && x.over > 10) || x.kws.length ? 'warn' : 'info';
  // every number of the headline stands in the kpis or the findings above
  const tail = x.missing.length
    ? T(L, `${x.sugg.length} von ${x.missing.length} fehlenden Schätzungen lassen sich aus echten Daten belegen`, `${x.sugg.length} of ${x.missing.length} missing estimates can be backed with real data`)
    : T(L, `alle ${x.open.length} offenen Stories sind geschätzt`, `all ${x.open.length} open stories are estimated`);
  s.headline = x.thin
    ? T(L, `${x.it.name}: nur ${x.poolSize} erledigte ${plural(x.poolSize, 'Story', 'Stories')} als Vergleich – ${tail}.`, `${x.it.name}: only ${x.poolSize} finished ${plural(x.poolSize, 'story', 'stories')} to compare with – ${tail}.`)
    : x.over != null && x.over !== 0
      ? T(L, `${x.it.name}: ähnliche erledigte Arbeit brauchte typisch ${Math.abs(x.over)} % ${x.over > 0 ? 'mehr' : 'weniger'} als geschätzt – ${tail}.`, `${x.it.name}: similar finished work typically took ${Math.abs(x.over)}% ${x.over > 0 ? 'more' : 'less'} than estimated – ${tail}.`)
      : T(L, `${x.it.name}: ${x.past.length} ähnliche erledigte Stories für ${x.open.length} offene – ${tail}.`, `${x.it.name}: ${x.past.length} similar finished stories for ${x.open.length} open ones – ${tail}.`);
  s.followUps.push(follow(T(L, 'Passt das noch?', 'Does it fit?'), T(L, 'Was passt ohne Überstunden?', 'What fits without overtime?')), follow(T(L, 'Lücken', 'Gaps'), T(L, `Welche Werte fehlen in ${x.it.name}?`, `Which values are missing in ${x.it.name}?`)), follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')));
  s.how = { text: T(L, 'Ähnlich = gleiche Wörter im Titel (und im Epic), dazu Team, Typ, Komponente, Label (wie „Schätzen wie früher“). Überzug = gebuchte Zeit ÷ Schätzung der ähnlichen erledigten Stories, Median. Vorschlag = Median ähnlicher erledigter Stories mit gebuchter Zeit (ab 2), sonst Median der Geschwister. Kommentare: Anzahl immer, Wörter nur, wenn die Texte geladen werden dürfen.', 'Similar = the same words in the title (and the epic), plus team, type, component, label (as in "estimate like before"). Overrun = logged time ÷ estimate of the similar finished stories, median. Suggestion = median of similar finished stories with logged time (from 2), otherwise the median of the siblings. Comments: the count always, words only when texts may be loaded.'),
    inputs: [[T(L, 'Vergleichsbasis', 'Pool'), T(L, `${x.poolSize} erledigte Stories`, `${x.poolSize} finished stories`)], [T(L, 'Verlauf', 'History'), ctx.history ? T(L, 'geladen', 'loaded') : T(L, 'nur aktuelle Daten', 'current data only')], [T(L, 'Kommentartexte', 'Comment texts'), String(x.texted)]] };
  s.confidence = x.thin ? 'low' : x.past.length >= 6 ? 'high' : 'medium';
  s.sources = ['Jira', ...(ctx.history ? [T(L, 'Verlauf', 'History')] : []), ...(x.texted ? [T(L, 'Kommentare', 'Comments')] : [])];
  s.entities.texts = [...new Set(s.entities.texts.filter(Boolean))].slice(0, 20);
  if (!s.entities.texts.length) delete s.entities.texts;
  return doneStory(s);
}

// a project to learn for: the most stories without an estimate, then the riskiest health
function projectCandidates(ctx) {
  const { model } = computedOf(ctx);
  const H = { critical: 2, atRisk: 1 };
  const ds = dsOf(ctx);
  return model.items.map((it) => {
    const open = (ds.issues || []).filter((i) => i.rootRef === it.ref && i.role === 'estimate' && isOpen(i));
    return { it, open: open.length, noEst: open.filter((i) => !(i.oe > 0)).length, risk: H[it.health?.status] || 0 };
  }).filter((x) => x.open).sort((a, b) => b.noEst - a.noEst || b.risk - a.risk || a.it.rank - b.it.rank).slice(0, 5);
}
const basisText = (L, sug) => ({ similar: T(L, `Median von ${sug.n} ähnlichen erledigten Stories`, `median of ${sug.n} similar finished stories`), siblings: T(L, `Median von ${sug.n} Geschwistern`, `median of ${sug.n} siblings`) }[sug.basis] || '');
const fillCmd = (L, id, list, title) => ({ id, command: 'issue.bulkFill', params: { field: 'estimate', items: list.map((x) => ({ issue: x.issue.id, value: x.value })) }, title });

// the lesson as one health comment (≤ 280): the overrun, the comment words, the alignment cost – only what was measured
function lessonNote(L, x) {
  const parts = [];
  if (x.over != null && x.over >= 10) parts.push(T(L, `Lehre aus ${x.withO.length} ähnlichen erledigten Stories: typisch ${x.over} % über der Schätzung – Puffer einplanen.`, `Lesson from ${x.withO.length} similar finished stories: typically ${x.over}% over the estimate – plan a buffer.`));
  if (x.kws.length) parts.push(T(L, `In ihren Kommentaren immer wieder: ${x.kws.slice(0, 3).map((k) => k.word).join(', ')}.`, `Recurring in their comments: ${x.kws.slice(0, 3).map((k) => k.word).join(', ')}.`));
  else if (x.les.talk && x.les.talk.many > x.les.talk.few) parts.push(T(L, 'Mit viel Abstimmung dauerte es länger – Klärung früh einplanen.', 'With much alignment it took longer – plan clarification early.'));
  let out = '';
  for (const p of parts) if ((out ? `${out} ${p}` : p).length <= 280) out = out ? `${out} ${p}` : p;
  return out;
}

export function knowledgeMissions({ optOf, textOf, MAX_ONE_BY_ONE }) {
  const learnFromPast = {
    id: 'learnFromPast', title: (L) => T(L, 'Aus früheren Projekten lernen', 'Learn from past projects'), params: ['project'],
    match: [
      /\blern\w*\b.*\b(aus|von)\b.*\b(frueher\w*|vergangen\w*|abgeschlossen\w*|erledigt\w*|bisherig\w*|aehnlich\w*|alt(en|e)?)\b.*\b(projekt\w*|stories|vorhaben|arbeit)\b/,
      /\bschaetz\w*\b.*\bprojekt\w*\b.*\b(anhand|nach|wie|aus|mit)\b.*\b(aehnlich\w*|frueher\w*|vergangen\w*|bisherig\w*|abgeschlossen\w*)\b/,
      /\bschaetz\w*\b.*\b(anhand|nach|aus|mit)\b (der |den )?(aehnlich\w*|frueher\w*|vergangen\w*|bisherig\w*|abgeschlossen\w*) projekt\w*\b/,
      /\bestimate\b.*\b(based on|using|from|like)\b (the )?(similar|past|previous|earlier|finished|completed) projects\b/,
      /\b(was|welche)\b.*\b(lehr\w*|gelernt|lernen)\b.*\b(frueher\w*|vergangen\w*|abgeschlossen\w*|bisherig\w*)\b.*\bprojekt\w*\b|\b(frueher\w*|vergangen\w*|abgeschlossen\w*)\b.*\bprojekt\w*\b.*\b(lehr\w*|gelernt|beigebracht)\b/,
      /\blearn\w*\b.*\bfrom\b.*\b(past|previous|earlier|former|finished|completed|similar|old)\b.*\b(projects?|work|stories)\b/,
      /\bwhat did\b.*\b(past|previous|earlier|former|finished|completed)\b.*\bprojects?\b.*\b(teach|tell|show)\b|\b(lessons?|learnings?)\b.*\bfrom\b.*\b(past|previous|earlier|former)\b.*\bprojects?\b/,
      /\bestimate\b.*\bprojects?\b.*\b(based on|like|from|using)\b.*\b(similar|past|previous|earlier|finished)\b/,
    ],
    plan(P, { ref = null }) {
      const { ctx, c, L, F } = P;
      let r = ref && c.model.itemByRef.has(ref) ? ref : null;
      if (!r) {
        const cand = projectCandidates(ctx);
        if (!cand.length) { P.storyObj('story:none', infoStory(ctx, { skill: 'similarSummary', lang: L, subject: { kind: 'portfolio', ref: null, name: 'Portfolio' }, headline: T(L, 'Kein Projekt hat offene Stories – es gibt nichts zu schätzen.', 'No project has open stories – there is nothing to estimate.'), finding: T(L, 'Lernen aus früheren Projekten hilft bei offenen Stories: ihre Schätzung gegen ähnliche erledigte Arbeit.', 'Learning from past projects helps with open stories: their estimate against similar finished work.') })); P.summary(T(L, 'Nichts zu tun.', 'Nothing to do.')); return; }
        const a = P.decide('project', {
          question: P.t('Für welches Projekt soll Lotse aus früheren Projekten lernen?', 'Which project should Lotse learn for from past projects?'),
          options: cand.map((x, k) => ({ id: x.it.ref, label: x.it.name, detail: P.t(`${x.noEst} von ${x.open} offenen Stories ohne Schätzung${x.risk ? ` · Health ${healthName(x.it.health.status, L)}` : ''}`, `${x.noEst} of ${x.open} open stories without an estimate${x.risk ? ` · health ${healthName(x.it.health.status, L)}` : ''}`), facts: [fact('noEst', x.noEst), fact('open', x.open)], recommended: k === 0 })),
        });
        if (a === undefined) return;
        r = optOf(a);
      }
      const x = pastOf(ctx, r);
      P.storyObj('story:past', pastStory(ctx, x));
      if (!x.open.length) { P.summary(P.t(`${x.it.name} hat keine offenen Stories – nichts zu schätzen.`, `${x.it.name} has no open stories – nothing to estimate.`)); return; }
      const sugH = r1(sum(x.sugg, (y) => y.value));
      const nSim = x.sugg.filter((y) => y.sug.basis === 'similar').length, nSib = x.sugg.length - nSim;
      const fromH = r1(sum(x.corr, (y) => y.from)), toH = r1(sum(x.corr, (y) => y.value));
      const what = !x.sugg.length && !x.corr.length ? [] : P.decide('what', {
        question: P.t(`Was soll Lotse für ${x.it.name} aus der Vergangenheit übernehmen?`, `What should Lotse take over from the past for ${x.it.name}?`), multi: true,
        options: [
          { id: 'fill', label: P.t('Fehlende Schätzungen ergänzen', 'Fill missing estimates'), detail: x.sugg.length ? P.t(`${x.sugg.length} ${plural(x.sugg.length, 'Story', 'Stories')}, zusammen ${F.h(sugH, 1)} – ${[nSim ? `${nSim} aus ähnlicher erledigter Arbeit` : '', nSib ? `${nSib} aus Geschwistern` : ''].filter(Boolean).join(', ')}`, `${x.sugg.length} ${plural(x.sugg.length, 'story', 'stories')}, ${F.h(sugH, 1)} in total – ${[nSim ? `${nSim} from similar finished work` : '', nSib ? `${nSib} from siblings` : ''].filter(Boolean).join(', ')}`) : P.t('Für keine fehlende Schätzung gibt es eine belastbare Grundlage.', 'No missing estimate has a sound basis.'),
            facts: [fact('n', x.sugg.length), fact('h', sugH), fact('sim', nSim), fact('sib', nSib)], recommended: x.sugg.length > 0, disabled: !x.sugg.length },
          { id: 'correct', label: P.t('Bestehende Schätzungen mit dem Teamfaktor korrigieren', 'Correct existing estimates by the team factor'), detail: x.corr.length ? P.t(`${x.corr.length} noch nicht begonnene ${plural(x.corr.length, 'Story', 'Stories')}, ${F.h(fromH, 1)} → ${F.h(toH, 1)}. Die realistische Kapazität rechnet den Faktor schon ein – nur wählen, wenn die Schätzungen selbst stimmen sollen.`, `${x.corr.length} ${plural(x.corr.length, 'story', 'stories')} not started yet, ${F.h(fromH, 1)} → ${F.h(toH, 1)}. Realistic capacity already applies the factor – choose this only if the estimates themselves should be right.`) : P.t('Kein Team weicht genug von seinen Schätzungen ab, oder es fehlen erledigte Stories dafür.', 'No team deviates enough from its estimates, or finished stories are missing for it.'),
            facts: [fact('n', x.corr.length), fact('from', fromH), fact('to', toH)], disabled: !x.corr.length },
          { id: 'nothing', label: P.t('Nur lernen, nichts ändern', 'Just learn, change nothing') },
        ],
      });
      if (what === undefined) return;
      const pick = new Set([].concat(what));
      if (pick.has('nothing')) { P.summary(P.t('Nichts geändert – die Lehren stehen oben.', 'Nothing changed – the lessons are above.')); return; }
      let chosen = pick.has('fill') ? x.sugg : [];
      if (chosen.length > 1) {
        const m = Math.min(chosen.length, MAX_ONE_BY_ONE);
        const how = P.decide('how', {
          question: P.t(`${chosen.length} Schätzungen aus echten Daten – alle übernehmen oder einzeln?`, `${chosen.length} estimates from real data – apply all or one by one?`), facts: [fact('n', chosen.length)],
          options: [
            { id: 'all', label: P.t('Alle übernehmen', 'Apply all'), detail: P.t(`${chosen.length} Werte, jeder einzeln rückgängig`, `${chosen.length} values, each one undoable`), facts: [fact('n', chosen.length)], recommended: true },
            { id: 'one', label: P.t('Einzeln durchgehen', 'One by one'), detail: P.t(`die ersten ${m} bestätigen, ändern oder auslassen`, `confirm, change or leave out the first ${m}`), facts: [fact('n', m)] },
          ],
        });
        if (how === undefined) return;
        if (optOf(how) === 'one') {
          const list = [];
          for (const y of chosen.slice(0, MAX_ONE_BY_ONE)) {
            const val = valueText(ctx, 'estimate', y.value);
            const ex = (y.sug.keys || []).filter((k) => KEY_RE.test(k)).slice(0, 2);
            const b = P.decide(`est:${y.issue.id}`, {
              question: P.t(`${y.issue.key}: Schätzung fehlt – Vorschlag ${val} (${basisText(L, y.sug)}${ex.length ? `, z. B. ${ex.join(', ')}` : ''}).`, `${y.issue.key}: estimate missing – suggestion ${val} (${basisText(L, y.sug)}${ex.length ? `, e.g. ${ex.join(', ')}` : ''}).`),
              facts: [fact('n', y.sug.n), fact('value', y.value)], issue: { key: y.issue.key, summary: y.issue.summary },
              options: [{ id: 'accept', label: P.t(`Übernehmen: ${val}`, `Apply: ${val}`), recommended: true, facts: [fact('value', y.value)] }, { id: 'skip', label: P.t('Auslassen', 'Leave out') }],
              freeText: { kind: 'hours', placeholder: P.t(`eigener Wert, z. B. ${val}`, `own value, e.g. ${val}`), optional: true },
            });
            if (b === undefined) return;
            if (optOf(b) === 'skip') continue;
            list.push(b && typeof b === 'object' && b.value != null ? { ...y, value: b.value } : y);
          }
          chosen = list;
        }
      }
      const corr = pick.has('correct') ? x.corr : [];
      // optional: the lesson as a note in the project's health update (health.set: owner or the enabled group, undoable)
      const note = lessonNote(L, x);
      let noteCmd = null;
      if (note && can.health(ctx, r)) {
        const status = x.it.health?.status || draftHealth(ctx, x.it, L, F).status;
        const n = P.decide('note', {
          question: P.t(`Die Lehre als Notiz ins Health-Update von ${x.it.name} schreiben?`, `Write the lesson as a note into the health update of ${x.it.name}?`),
          draft: { status, comment: note },
          options: [
            { id: 'note', label: P.t('Als Notiz übernehmen', 'Add as a note'), detail: P.t(`Health bleibt „${healthName(status, L)}“, der bisherige Kommentar wird ersetzt – rückgängig möglich.`, `Health stays "${healthName(status, L)}", the current comment is replaced – undoable.`), recommended: x.over != null && x.over >= 20 },
            { id: 'no', label: P.t('Keine Notiz', 'No note'), recommended: !(x.over != null && x.over >= 20) },
          ],
          freeText: { kind: 'text', placeholder: note.slice(0, 120), min: 1, max: 280, optional: true },
        });
        if (n === undefined) return;
        if (optOf(n) === 'note') noteCmd = { id: 'cmd:note', command: 'health.set', params: { items: [{ ref: r, status, comment: (textOf(n) || note).slice(0, 280) }] }, title: P.t('Lehre ins Health-Update', 'Lesson into the health update') };
      }
      const cmds = [];
      if (chosen.length) cmds.push(fillCmd(L, 'cmd:fill', chosen, P.t(`Schätzungen für ${chosen.length} ${plural(chosen.length, 'Story', 'Stories')}`, `Estimates for ${chosen.length} ${plural(chosen.length, 'story', 'stories')}`)));
      if (corr.length) cmds.push(fillCmd(L, 'cmd:correct', corr, P.t(`Schätzungen mit Teamfaktor für ${corr.length} ${plural(corr.length, 'Story', 'Stories')}`, `Estimates by team factor for ${corr.length} ${plural(corr.length, 'story', 'stories')}`)));
      if (noteCmd) cmds.push(noteCmd);
      P.batch('preview', cmds);
      P.summary(cmds.length ? null : !x.sugg.length && !x.corr.length ? P.t('Für die offenen Stories gibt es keine belastbare Grundlage aus der Vergangenheit – nichts geändert.', 'The past gives no sound basis for the open stories – nothing changed.') : P.t('Nichts geändert – die Lehren stehen oben.', 'Nothing changed – the lessons are above.'));
    },
  };

  const supportPlaybooks = {
    id: 'supportPlaybooks', title: (L) => T(L, 'Support-Playbooks anlegen', 'Create support playbooks'), params: [],
    match: [
      /\b(erstell\w*|anleg\w*|leg\w*|bau\w*|schreib\w*|mach\w*|entwirf|entwerf\w*)\b.*\b(playbooks|hilfe-?artikel|standard-?antworten)\b/,
      /\b(playbooks|hilfe-?artikel|standard-?antworten)\b.*\b(anlegen|erstellen|schreiben|aufbauen|entwerfen)\b/,
      /\b(create|build|write|make|set up|draft|prepare)\b.*\b(playbooks|help articles|standard (replies|answers|responses)|canned (replies|responses)|direct (replies|responses))\b/,
      /\b(playbooks|standard ?antwort\w*|hilfe-?artikel)\b.*\bfuer (die )?(wiederkehrend\w*|haeufig\w*)\b/,
    ],
    plan(P) {
      const { ctx, L, F } = P;
      const roles = ctx.roles || {};
      const subject = { kind: 'topic', ref: 'support', name: 'Support' };
      if (!canReadPlaybooks(roles)) { P.storyObj('story:none', infoStory(ctx, { skill: 'supportTopics', lang: L, subject, headline: T(L, 'Playbooks gehören zum Support-Bereich, den du nicht siehst.', 'Playbooks belong to the support area, which you do not see.'), finding: T(L, 'Den Support-Bereich gibt ein Jira-Admin in der Konfiguration unter „Rollen“ frei.', 'A Jira admin enables the support area in the configuration under "Roles".') })); P.summary(T(L, 'Nichts zu tun.', 'Nothing to do.')); return; }
      const tickets = ticketsOf({ ...ctx, ds: dsOf(ctx) });
      if (!tickets.length) { P.storyObj('story:none', infoStory(ctx, { skill: 'supportTopics', lang: L, subject, headline: T(L, 'Es sind keine Support-Tickets geladen – ohne Tickets gibt es keine wiederkehrenden Themen.', 'No support tickets are loaded – without tickets there are no recurring topics.'), finding: T(L, 'Playbooks entstehen aus gelösten Tickets der Service-Projekte (Verlauf) und den offenen.', 'Playbooks come from resolved tickets of the service projects (history) and the open ones.') })); P.summary(T(L, 'Nichts angelegt.', 'Nothing created.')); return; }
      const st = supportTopics(tickets, { minCount: 3, lang: L, today: dsOf(ctx).today });
      const known = Array.isArray(ctx.playbooks) ? ctx.playbooks : Array.isArray(ctx.playbooks?.items) ? ctx.playbooks.items : null;
      const has = new Map((known || []).filter((p) => p?.topic).map((p) => [p.topic, p]));
      const created = new Map(tickets.map((t) => [String(t.id), String(t.created || '').slice(0, 10)]));
      const lastOf = (t) => (t.ids || []).map((id) => created.get(String(id))).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort().at(-1) || null;
      const cands = st.topics.filter((t) => t.playbook).map((t) => ({ t, last: lastOf(t), pb: has.get(t.id) || null }));
      P.storyObj('story:topics', topicsStory(ctx, st, cands, known));
      if (!cands.length) { P.summary(P.t('Kein Thema kommt oft genug wieder, um ein Playbook zu lohnen – nichts angelegt.', 'No topic recurs often enough to be worth a playbook – nothing created.')); return; }
      if (!canEditPlaybooks(roles)) { P.summary(P.t('Playbooks anlegen darf, wer Tickets verteilt oder Kapazitäten pflegt – du kannst sie in Support › Playbooks lesen.', 'Playbooks can be created by people who dispatch tickets or maintain capacities – you can read them under Support › Playbooks.')); return; }
      const open = cands.filter((x) => !x.pb).slice(0, MAX_TOPICS);
      if (!open.length) { P.summary(P.t('Jedes wiederkehrende Thema hat schon ein Playbook – nichts zu tun.', 'Every recurring topic already has a playbook – nothing to do.')); return; }
      const trend = (t) => ({ rising: T(L, 'steigend', 'rising'), falling: T(L, 'fallend', 'falling'), stable: T(L, 'stabil', 'stable'), new: T(L, 'neu', 'new') }[t.trend] || '');
      const a = P.decide('topics', {
        question: P.t('Für welche Themen soll Lotse ein Playbook mit Standardantwort anlegen?', 'For which topics should Lotse create a playbook with a standard reply?'), multi: true,
        options: [
          ...open.map((x, k) => ({ id: x.t.id, label: x.t.name, detail: P.t(`${x.t.count} Tickets, zusammen ${F.h(x.t.spentTotal, 1)}${x.last ? `, zuletzt am ${F.date(x.last)}` : ''}, Tendenz ${trend(x.t)}`, `${x.t.count} tickets, ${F.h(x.t.spentTotal, 1)} in total${x.last ? `, last on ${F.date(x.last)}` : ''}, trend ${trend(x.t)}`),
            facts: [fact('n', x.t.count), fact('h', x.t.spentTotal), ...nameFacts(x.t.name)], recommended: k < 3 || x.t.trend === 'rising' })),
          { id: 'nothing', label: P.t('Keins anlegen', 'Create none') },
        ],
      });
      if (a === undefined) return;
      const pick = new Set([].concat(a));
      if (pick.has('nothing')) { P.summary(P.t('Nichts angelegt.', 'Nothing created.')); return; }
      const { model } = computedOf(ctx);
      const items = [];
      for (const x of open.filter((y) => pick.has(y.t.id))) {
        const pb = playbookOf(x.t, { tickets, lang: L, teamName: (id) => teamNameOf(model, id) });
        const d = pb.draft;
        const nOpen = d.steps.filter((s) => /\[[^\]]+\]/.test(s)).length;
        const b = P.decide(`pb:${x.t.id}`, {
          question: P.t(`Playbook „${x.t.name}“: ${d.symptoms.length} ${plural(d.symptoms.length, 'Symptom', 'Symptome')}, ${d.steps.length} Schritte und eine Standardantwort ohne interne Zahlen – so anlegen?`, `Playbook "${x.t.name}": ${d.symptoms.length} ${plural(d.symptoms.length, 'symptom', 'symptoms')}, ${d.steps.length} steps and a standard reply without internal figures – create it like this?`),
          facts: [fact('symptoms', d.symptoms.length), fact('steps', d.steps.length), ...nameFacts(x.t.name)],
          draft: { comment: d.reply, title: d.title, symptoms: d.symptoms, steps: d.steps, reply: d.reply },
          options: [
            { id: 'accept', label: P.t('So anlegen', 'Create it like this'), detail: nOpen ? P.t(`${nOpen} ${plural(nOpen, 'Schritt bleibt', 'Schritte bleiben')} in [Klammern] – das weiß nur euer Support-Team.`, `${nOpen} ${plural(nOpen, 'step stays', 'steps stay')} in [brackets] – only your support team knows that.`) : P.t('Alle Schritte stammen aus den Tickets.', 'Every step comes from the tickets.'), facts: [fact('open', nOpen)], recommended: true },
            { id: 'skip', label: P.t('Auslassen', 'Leave out') },
          ],
          freeText: { kind: 'text', placeholder: P.t('Die bewährte Lösung in einem Satz – geht in Schritte und Antwort', 'The proven fix in one sentence – goes into steps and reply'), min: 3, max: 280, optional: true },
        });
        if (b === undefined) return;
        if (optOf(b) === 'skip') continue;
        items.push(asPlaybook(L, x.t, pb, textOf(b)));
      }
      const cmds = items.length ? [
        { id: 'cmd:playbooks', command: 'playbook.save', params: { items }, title: P.t(`${items.length} ${plural(items.length, 'Playbook', 'Playbooks')} anlegen`, `Create ${items.length} ${plural(items.length, 'playbook', 'playbooks')}`) },
        { id: 'cmd:open', command: 'navigate', params: { view: 'support', opts: { tab: 'playbooks' } }, title: P.t('Support › Playbooks öffnen', 'Open Support › Playbooks') },
      ] : [];
      P.batch('preview', cmds);
      P.summary(items.length ? null : P.t('Alle Themen ausgelassen – nichts angelegt.', 'Every topic left out – nothing created.'));
    },
  };
  return [learnFromPast, supportPlaybooks];
}

// the playbook as stored (shared/playbooks.js validPlaybook shape); the person's own words fill the fix placeholders
export function asPlaybook(L, topic, pb, own = null) {
  const d = pb.draft;
  const fix = own && String(own).trim() ? String(own).trim().replace(/\s+/g, ' ').slice(0, 280) : null;
  const steps = d.steps.map((s) => (fix && /^\[(Lösungsschritt ergänzen|Add the fix)/.test(s) ? T(L, `Bewährte Lösung: ${fix}`, `Proven fix: ${fix}`) : s));
  if (fix && !steps.some((s) => s.includes(fix))) steps.splice(Math.min(2, steps.length), 0, T(L, `Bewährte Lösung: ${fix}`, `Proven fix: ${fix}`));
  const reply = fix ? d.reply.replace(T(L, '[kurzer Schritt für den Kunden]', '[short step for the customer]'), fix) : d.reply;
  return { title: d.title, topic: topic.id, topicName: topic.name, symptoms: d.symptoms, steps: steps.slice(0, 10), reply, keys: (pb.keys || []).filter((k) => KEY_RE.test(k)).slice(0, 8), source: 'rule' };
}

// ---------- supportPlaybooks: the story ----------
function topicsStory(ctx, st, cands, known) {
  const L = langOf(ctx);
  const s = newStory(ctx, { skill: 'supportTopics', subject: { kind: 'topic', ref: 'support', name: 'Support' }, lang: L });
  s.id = 'supportTopics:playbooks';
  const F = s.fmt;
  s.entities.texts = [];
  const hours = r1(sum(cands, (x) => x.t.spentTotal));
  const tix = sum(cands, (x) => x.t.count);
  const withPb = cands.filter((x) => x.pb).length;
  s.kpis.push(kpi('topics', T(L, 'Wiederkehrende Themen', 'Recurring topics'), st.topics.length, 'n', { tone: 'ink' }));
  s.kpis.push(kpi('candidates', T(L, 'Lohnen ein Playbook', 'Worth a playbook'), cands.length, 'n', { tone: cands.length ? 'warn' : 'ok' }));
  s.kpis.push(kpi('hours', T(L, 'Support-Zeit darin', 'Support time in them'), hours, 'h'));
  if (known) s.kpis.push(kpi('covered', T(L, 'Schon mit Playbook', 'Already with a playbook'), withPb, 'n', { tone: withPb === cands.length && cands.length ? 'ok' : undefined }));
  else s.kpis.push(kpi('tickets', T(L, 'Tickets', 'Tickets'), st.tickets, 'n'));
  const TR = { rising: T(L, 'steigend', 'rising'), falling: T(L, 'fallend', 'falling'), stable: T(L, 'stabil', 'stable'), new: T(L, 'neu', 'new') };
  if (!st.topics.length) {
    s.visual = { kind: 'donut', data: { unit: 'n', total: st.tickets, items: [{ label: T(L, 'Einzelfälle', 'one-offs'), value: st.tickets, tone: 'muted' }] }, caption: T(L, 'Alle Tickets sind Einzelfälle – kein Thema kommt wieder.', 'All tickets are one-offs – no topic recurs.') };
  } else {
    const shown = st.topics.slice(0, 12);
    const byId = new Map(cands.map((x) => [x.t.id, x]));
    s.visual = { kind: 'bars', data: { unit: 'n', items: shown.map((t) => { const x = byId.get(t.id); return { label: t.name.slice(0, 80), value: t.count, tone: x?.pb ? 'ok' : t.trend === 'rising' ? 'warn' : t.playbook ? 'ink' : 'muted', sub: [F.h(t.spentTotal, 1), x?.last ? T(L, `zuletzt ${F.date(x.last)}`, `last ${F.date(x.last)}`) : null, TR[t.trend], x?.pb ? T(L, 'Playbook vorhanden', 'playbook exists') : null].filter(Boolean).join(' · ') }; }) },
      caption: T(L, 'Tickets je wiederkehrendem Thema; grün = Playbook vorhanden, gelb = steigend, dunkel = lohnt ein Playbook.', 'Tickets per recurring topic; green = playbook exists, yellow = rising, dark = worth a playbook.') };
    for (const t of shown) s.entities.texts.push(t.name);
  }
  for (const x of cands.filter((y) => !y.pb).slice(0, 2)) {
    const t = x.t;
    s.entities.texts.push(t.name);
    s.findings.push(finding(T(L, `„${t.name}“: ${t.count} Tickets, zusammen ${F.h(t.spentTotal, 1)}${x.last ? `, zuletzt am ${F.date(x.last)}` : ''}, Tendenz ${TR[t.trend]} – noch ohne Playbook.`, `"${t.name}": ${t.count} tickets, ${F.h(t.spentTotal, 1)} in total${x.last ? `, last on ${F.date(x.last)}` : ''}, trend ${TR[t.trend]} – no playbook yet.`),
      t.trend === 'rising' ? 'warn' : 'info', Math.min(90, 50 + t.count + (t.trend === 'rising' ? 15 : 0)),
      [ev(T(L, 'Tickets', 'tickets'), t.count, 'n'), ev(T(L, 'Zeit', 'time'), t.spentTotal, 'h'), ...(x.last ? [ev(T(L, 'zuletzt', 'last'), x.last, 'date')] : []), ...t.exampleKeys.filter((k) => KEY_RE.test(k)).slice(0, 3).map((k) => ev(T(L, 'Beispiel', 'example'), undefined, null, { key: k }))]));
  }
  if (cands.length) s.findings.push(finding(known
    ? T(L, `${cands.length} ${plural(cands.length, 'Thema lohnt', 'Themen lohnen')} ein Playbook – zusammen ${F.h(hours, 1)} in ${tix} Tickets; ${withPb} ${plural(withPb, 'hat', 'haben')} schon eins.`, `${cands.length} ${plural(cands.length, 'topic is', 'topics are')} worth a playbook – ${F.h(hours, 1)} in ${tix} tickets; ${withPb} already ${plural(withPb, 'has', 'have')} one.`)
    : T(L, `${cands.length} ${plural(cands.length, 'Thema lohnt', 'Themen lohnen')} ein Playbook – zusammen ${F.h(hours, 1)} in ${tix} Tickets. Vorhandene Playbooks prüft Lotse beim Speichern und überschreibt keins.`, `${cands.length} ${plural(cands.length, 'topic is', 'topics are')} worth a playbook – ${F.h(hours, 1)} in ${tix} tickets. Lotse checks existing playbooks when saving and overwrites none.`),
  'warn', 60, [ev(T(L, 'Themen', 'topics'), cands.length, 'n'), ev(T(L, 'Zeit', 'time'), hours, 'h'), ev(T(L, 'Tickets', 'tickets'), tix, 'n'), ...(known ? [ev(T(L, 'mit Playbook', 'with playbook'), withPb, 'n'), ev(T(L, 'ohne Playbook', 'without playbook'), cands.length - withPb, 'n')] : [])]));
  else s.findings.push(finding(T(L, `In ${st.tickets} Tickets lohnt kein Thema ein Playbook – erst ab 3 Tickets und 2 h Zeit.`, `No topic in ${st.tickets} tickets is worth a playbook – that starts at 3 tickets and 2 h of time.`), 'ok', 30,
    [ev(T(L, 'Tickets', 'tickets'), st.tickets, 'n'), ev(T(L, 'ab Tickets', 'from tickets'), 3, 'n'), ev(T(L, 'ab Zeit', 'from time'), 2, 'h')]));
  if (cands.length) s.findings.push(finding(T(L, 'Jedes Playbook bringt eine Standardantwort für Kunden mit – ohne interne Zahlen; sie wird kopiert, nie an ein Ticket gesendet.', 'Every playbook comes with a standard reply for customers – without internal figures; it is copied, never sent to a ticket.'), 'info', 25, []));
  s.tone = cands.some((x) => !x.pb && x.t.trend === 'rising') ? 'warn' : cands.some((x) => !x.pb) ? 'info' : 'ok';
  const todo = cands.filter((x) => !x.pb).length;
  s.headline = !st.topics.length ? T(L, `${st.tickets} Tickets, kein wiederkehrendes Thema.`, `${st.tickets} tickets, no recurring topic.`)
    : !cands.length ? T(L, `${st.topics.length} wiederkehrende Themen, aber keins lohnt schon ein Playbook.`, `${st.topics.length} recurring topics, but none is worth a playbook yet.`)
      : T(L, `${cands.length} wiederkehrende Support-Themen lohnen ein Playbook – ${F.h(hours, 1)} Support-Zeit${known ? `, ${todo} noch ohne` : ''}.`, `${cands.length} recurring support topics are worth a playbook – ${F.h(hours, 1)} of support time${known ? `, ${todo} still without one` : ''}.`);
  s.followUps.push(follow(T(L, 'Tickets verteilen', 'Dispatch'), T(L, 'Wer soll die neuen Tickets bekommen?', 'Who should take the new tickets?')), follow(T(L, 'Realistische Kapazität', 'Real capacity'), T(L, 'Wie viel Kapazität bleibt nach Support?', 'How much capacity is left after support?')), follow(T(L, 'Warum?', 'Why?'), T(L, 'warum?', 'why?')));
  s.how = { text: T(L, 'Ein Thema = Tickets mit demselben markanten Wort im Titel (ab 3 Tickets). Ein Playbook lohnt ab 3 Tickets und 2 h Zeit. Entwurf: Symptome aus den Ticket-Titeln, Schritte aus Komponente, Beispiel-Tickets und dem Team, das die meisten löste; die Standardantwort enthält keine internen Zahlen.', 'A topic = tickets sharing the same distinctive word in the title (from 3 tickets). A playbook pays off from 3 tickets and 2 h of time. Draft: symptoms from the ticket titles, steps from component, example tickets and the team that resolved most; the standard reply has no internal figures.'),
    inputs: [[T(L, 'Tickets', 'Tickets'), String(st.tickets)], [T(L, 'Stand', 'As of'), F.date(st.asOf)], [T(L, 'Vorhandene Playbooks', 'Existing playbooks'), known ? String(known.length) : T(L, 'werden beim Speichern geprüft', 'checked when saving')]] };
  s.confidence = st.tickets >= 50 ? 'high' : st.tickets >= 15 ? 'medium' : 'low';
  s.sources = ['Jira Service Management', ...(ctx.history ? [T(L, 'Verlauf', 'History')] : []), ...(known ? ['Playbooks'] : [])];
  s.entities.texts = [...new Set(s.entities.texts.filter(Boolean))].slice(0, 20);
  if (!s.entities.texts.length) delete s.entities.texts;
  return doneStory(s);
}
