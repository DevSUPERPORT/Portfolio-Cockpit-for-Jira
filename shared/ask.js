// Ask: turns a plain-language question (German or English) into an answer card computed from the
// cockpit's own data. Deterministic and local – nothing leaves the app. Questions it cannot map fall
// back to the AI assistant (if the admin enabled it). Questions that rate individual people are
// declined: the cockpit plans capacity, it does not score employees.
import { targetHours } from './sla.js';
import { supportAnalytics } from './sla.js';
import { realisticCapacity, similarWork, supportTopics, overtimeOutlook } from './insights.js';
import { WISH_CARDS, WISH_IDS, WISH_RULES, HISTORY_CARDS, ruleWish, wishSubject, isWish } from './wishCatalog.js';

export { WISH_CARDS, WISH_IDS, HISTORY_CARDS, ruleWish, wishSubject };

const T = (lang, de, en) => (lang === 'de' ? de : en);
export const fold = (s) => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Every chart kind a card can switch to. The first entry of a card's `views` is its default.
export const VIEW_KINDS = ['number', 'list', 'table', 'bar', 'donut', 'columns', 'line', 'heat', 'graph', 'text'];

const INTENTS = [
  ['guard', /\b(wer|who|welche[rs]? (mitarbeiter|person|kolleg))\b.*\b(langsam|faul|am wenigsten|schlecht|unproduktiv|least|slowest|lazy|worst|underperform|unproductive)|\b(leistung|performance|produktivitaet|productivity) (von|der|des|of)\b|\branking der (mitarbeiter|personen)|\brank (the )?(people|employees)/],
  // "Ich will …": the wish cards (shared/wishCatalog.js) come right after the guard, so a wish beats the broader intents
  ...WISH_RULES,
  ['attention', /aufmerksam|attention|was brennt|burning|worauf|focus on|kuemmern|look at first|wichtigste|most important|heute|today|diese woche|this week|handlungsbedarf|action|top( \d+)? (risk|risiken|themen|issues|probleme)|groesste[n]? (risik|problem)|biggest (risk|problem)s?|was muss ich|what should i/],
  ['waterline', /wasserlinie|waterline|ab welchem rang|from which rank|besetzbar|staffable|reicht .*kapazitaet|kapazitaet .*reicht|enough capacity|nicht machbar|not feasible|schaffen wir|can we (do|make|deliver|manage)|machbar|feasible/],
  ['blocked', /(was|what|welche[rsn]?|which|wo|where)\b.*\b(blockiert|blocked)\b|\bstuck\b|steht still|stehen still|haeng(t|en) fest|im status blocked|\bblocked (items|stories|work)/],
  ['maturity', /reife|maturity|belastbar|reliab|verlaesslich|wie sicher|how (solid|sure|reliable)|feinschaetz|grob .*fein/],
  ['support', /support|sla\b|slas\b|ticket|incident|stoerung|service ?desk|helpdesk/],
  ['dependencies', /abhaengig|depend|konflikt|conflict|blockier|blocking|blocked|vernetz|network|zusammenhaeng/],
  ['quality', /datenqualitaet|data quality|luecke|gaps?\b|fehlende|missing|unvollstaendig|incomplete|gepflegt|maintained|\bfehlen\b|ohne (schaetzung|team|termin|due|t-?shirt)|without (an? )?(estimate|team|date|due|t-?shirt)|(no|keine?) t-?shirt/],
  ['overdue', /ueberfaellig|overdue|verspaet|verzug|\blate\b|behind schedule|im rueckstand|deadline|frist|slipp|rutsch|termin(e)? (verpasst|gerissen)|missed (date|deadline)/],
  ['milestones', /meilenstein|milestone|go-?live|release|freigabe/],
  ['utilization', /auslast|ausgelast|utili[sz]|overload|ueberlast|kapazitaet|capacity|team(s)? .*(voll|busy|frei|free)|(busy|voll|frei|free) .*team|\bbusy\b|workload|arbeitslast|engpass|bottleneck|wer hat (noch )?zeit|who has (spare |free )?(time|capacity)/],
  ['hours', /stunden|hours|aufwand|effort|gebucht|logged|schaetz|estimat|budget|prognose|forecast|abweich|deviation|zeit vs|time vs|soll.?ist|plan.?(vs|gegen|ist)|planned|actual|spend|ausgegeben|mehr als geplant|more than planned/],
  ['health', /health|gesundheit|ampel|on track|im plan|gefaehrdet|at risk|kritisch|critical|risik|risk|stimmung/],
  ['progress', /fortschritt|progress|wie weit|how far|fertig|complete|erledigt|done|stand\b/],
  ['count', /wie viele|how many|anzahl|number of|\bzaehl|\bcount\b/],
  ['ranking', /rang|rank|reihenfolge|prioritaet|priorit|portfolio|alle projekte|all projects|uebersicht|overview|liste|list/],
];
const VIEW_WORDS = [
  ['donut', /kuchen|torte|\bpie\b|donut|kreis/], ['bar', /balken|\bbars?\b|vergleich|compare/], ['line', /linie|trend|verlauf|entwicklung|over time|zeitlich/],
  ['table', /tabelle|table/], ['heat', /heatmap|\bheat\b|matrix/], ['graph', /\bgraph|netz|network|landkarte|\bmap\b/], ['number', /\bzahl\b|\bnumber\b|kennzahl|kpi/],
  ['columns', /saeulen|columns/],
];

// ---------- entity detection ----------
// The folded names, keys and their patterns per project / team, built once per object and name (a question is
// matched against every project several times – this used to build hundreds of RegExps per question).
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const infoCache = new WeakMap();
function infoOf(p) {
  let x = infoCache.get(p);
  if (!x || x.rawName !== p.name || x.rawKey !== p.key || x.rawPk !== p.projectKey) {
    const name = fold(p.name), key = fold(p.key || '');
    const first = name.split(/[\s\-–:]+/)[0], pk = fold(p.projectKey || String(p.key || '').split('-')[0]);
    x = {
      rawName: p.name, rawKey: p.key, rawPk: p.projectKey, name, key,
      keyRe: key ? new RegExp(`\\b${esc(key)}\\b`) : null,
      word: name.split(/[\s\-–:]+/).find((w) => w.length >= 6),
      short: [first, pk].filter((t) => t && t.length >= 3).map((t) => new RegExp(`(^|[^a-z0-9])${esc(t)}([^a-z0-9]|$)`)),
    };
    infoCache.set(p, x);
  }
  return x;
}
export function findProject(q, model) {
  let best = null;
  for (const p of model.items) {
    const { name, keyRe, word } = infoOf(p);
    if (keyRe && keyRe.test(q)) return p;
    if (name.length >= 3 && q.includes(name)) { if (!best || name.length > fold(best.name).length) best = p; continue; }
    // first distinctive word of the project name (e.g. "Kundenportal")
    if (word && q.includes(word) && !best) best = p;
  }
  // a short name: the space key or the name's first part ("ERP" → "ERP-Anbindung") – only when exactly one project fits
  if (!best) {
    const short = model.items.filter((p) => infoOf(p).short.some((re) => re.test(q)));
    if (short.length === 1) best = short[0];
  }
  const rank = /(?:projekt|project|rang|rank)\s*#?\s*(\d{1,3})\b|#(\d{1,3})\b/.exec(q);
  if (!best && rank) best = model.items.find((p) => p.rank === +(rank[1] || rank[2])) || null;
  return best;
}
export function findTeam(q, model) {
  let best = null;
  for (const t of model.teams.values()) {
    let x = infoCache.get(t);
    if (!x || x.rawName !== t.name) { const n = fold(t.name); x = { rawName: t.name, n, re: n.length >= 2 ? new RegExp(`(^|[^a-z0-9])${esc(n)}([^a-z0-9]|$)`) : null }; infoCache.set(t, x); }
    if (x.re && x.re.test(q) && (!best || x.n.length > fold(best.name).length)) best = t;
  }
  return best;
}
function findQuarter(q, quarters) {
  const m = /\bq([1-4])\s*[/ -]?\s*(20\d\d)\b|\b(20\d\d)\s*[- ]?q([1-4])\b/.exec(q);
  if (m) { const k = `${m[2] || m[3]}-Q${m[1] || m[4]}`; if (quarters.includes(k)) return k; }
  if (/naechste[sn]? quartal|next quarter/.test(q)) return quarters[1] || null;
  if (/dieses quartal|this quarter|aktuelle[sn]? quartal|current quarter/.test(q)) return quarters[0] || null;
  return null;
}

const KEYWORDS = ['ueberfaellig', 'auslastung', 'ausgelastet', 'ueberlastet', 'kapazitaet', 'abhaengigkeiten', 'datenqualitaet', 'meilensteine', 'fortschritt', 'prognose', 'gefaehrdet', 'kritisch', 'blockiert',
  'wasserlinie', 'schaetzung', 'stunden', 'support', 'tickets', 'overdue', 'utilization', 'capacity', 'overloaded', 'dependencies', 'milestones', 'progress', 'forecast', 'blocked', 'waterline', 'estimate',
  'workload', 'maturity', 'reife', 'health', 'ranking', 'projects', 'projekte', 'teams', 'budget', 'missing', 'fehlende', 'deviation', 'abweichung', 'bottleneck', 'engpass',
  'ueberstunden', 'overtime', 'realistisch', 'realistic', 'aehnlich', 'similar', 'wiederkehrend', 'recurring', 'playbook', 'playbooks'];
function lev1(a, b) { // edit distance ≤ 1 (insert, delete, substitute, swap neighbours)
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}
export function fixTypos(q) {
  return q.split(' ').map((w) => (w.length >= 5 && !KEYWORDS.includes(w) ? KEYWORDS.find((k) => lev1(w, k)) || w : w)).join(' ');
}

export function parseQuestion(question, { model, quarters = [] } = {}) {
  const q = fixTypos(fold(question).replace(/[?!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim());
  const scores = INTENTS.map(([id, re], i) => [id, re.test(q) ? 100 - i : 0]).filter(([, s]) => s > 0);
  let intent = scores.length ? scores.sort((a, b) => b[1] - a[1])[0][0] : null;
  // "how many …" with a topic word keeps the topic (e.g. "how many tickets are past SLA" → support)
  if (intent === 'count') { const topic = scores.find(([id]) => id !== 'count'); if (topic) intent = topic[0]; }
  const project = model ? findProject(q, model) : null;
  const team = model ? findTeam(q, model) : null;
  const quarter = findQuarter(q, quarters);
  if (!intent && project) intent = 'project';
  if (!intent && team) intent = 'utilization';
  const view = VIEW_WORDS.find(([, re]) => re.test(q))?.[0] || null;
  // the work to estimate in "estimate like before" (original spelling)
  const subject = intent === 'similarWork' ? wishSubject(question) : '';
  return { q, intent, project, team, quarter, view, mine: /\b(meine?[nmrs]?|my|mine)\b/.test(q), wish: isWish(q), subject };
}

// ---------- recipes ----------
const healthTone = { onTrack: 'ok', atRisk: 'warn', critical: 'bad' };
function hName(h, L) { return ({ onTrack: T(L, 'Im Plan', 'On track'), atRisk: T(L, 'Gefährdet', 'At risk'), critical: T(L, 'Kritisch', 'Critical') }[h] || T(L, 'Kein Update', 'No update')); }
const wlName = (s, L) => ({ ok: T(L, 'besetzbar', 'staffable'), partial: T(L, 'teilweise', 'partly'), no: T(L, 'nicht besetzbar', 'not staffable') }[s] || '–');
const pctTone = (u) => (u == null ? 'muted' : u > 1.0001 ? 'bad' : u > 0.85 ? 'warn' : 'ok');

function scopeItems(ctx, p) {
  const { model } = ctx.computed;
  let items = model.items.filter((x) => (x.statusCat ?? 'new') !== 'done');
  if (p.project) items = items.filter((x) => x.ref === p.project.ref);
  else if (p.mine && ctx.me?.id) { const mine = items.filter((x) => x.owner?.id === ctx.me.id); if (mine.length) items = mine; }
  return items;
}
const label = (it) => `#${it.rank} ${it.name}`;

const RECIPES = {
  attention(ctx, p, L, F) {
    const { model, metrics, wl, deps, dq, support } = ctx.computed;
    const q0 = wl.quarters[0];
    const items = scopeItems(ctx, p);
    const open = model.items.filter((x) => (x.statusCat ?? 'new') !== 'done');
    const scoped = !!p.project || items.length < open.length;
    const refs = new Set(items.map((x) => x.ref));
    const list = [];
    for (const it of items) {
      const m = metrics.get(it.ref);
      if (it.health?.status === 'critical') list.push({ text: T(L, `${label(it)}: Health kritisch`, `${label(it)}: health critical`), sub: it.health.comment || '', tone: 'bad', ref: it.ref, w: 5 });
      if (m?.daysOverdue > 0) list.push({ text: T(L, `${label(it)}: ${m.daysOverdue} Tage über dem Termin`, `${label(it)}: ${m.daysOverdue} days past due`), tone: 'bad', ref: it.ref, w: 4 });
      const st = wl.projectQ[it.ref]?.[q0]?.status;
      if (st && st !== 'ok') list.push({ text: T(L, `${label(it)}: in ${F.quarter(q0)} ${wlName(st, L)}`, `${label(it)}: ${wlName(st, L)} in ${F.quarter(q0)}`), tone: st === 'no' ? 'bad' : 'warn', ref: it.ref, w: st === 'no' ? 4 : 2 });
      if (it.health?.status === 'atRisk') list.push({ text: T(L, `${label(it)}: Health gefährdet`, `${label(it)}: health at risk`), sub: it.health.comment || '', tone: 'warn', ref: it.ref, w: 2 });
    }
    const conflicts = deps.list.filter((d) => d.conflict && (!scoped || refs.has(model.byId.get(d.pre)?.rootRef) || refs.has(model.byId.get(d.dep)?.rootRef)));
    if (conflicts.length) list.push({ text: T(L, `${conflicts.length} Terminkonflikte bei Abhängigkeiten`, `${conflicts.length} schedule conflicts in dependencies`), tone: 'bad', w: 3, go: 'deps' });
    if (!scoped) {
      for (const t of wl.teamIds) { const c = wl.cells[t]?.[q0]; if (t !== '_none' && c && Number.isFinite(c.util) && c.util > 1.0001) list.push({ text: T(L, `Team ${model.teams.get(t)?.name || t}: ${F.pct(c.util)} ausgelastet in ${F.quarter(q0)}`, `Team ${model.teams.get(t)?.name || t}: ${F.pct(c.util)} loaded in ${F.quarter(q0)}`), tone: 'bad', w: 3, go: 'capacity' }); }
      const urgent = dq.gaps.filter((g) => g.urgent).length;
      if (urgent) list.push({ text: T(L, `${urgent} dringende Datenlücken`, `${urgent} urgent data gaps`), tone: 'warn', w: 1, go: 'quality' });
      const sa = ctx.supportA;
      if (sa?.kpis.breachedOpen) list.push({ text: T(L, `${sa.kpis.breachedOpen} Support-Tickets über dem SLA`, `${sa.kpis.breachedOpen} support tickets past SLA`), tone: 'bad', w: 3, go: 'support' });
      else if (support?.slaRate != null && support.slaRate < support.slaTarget) list.push({ text: T(L, `SLA-Quote ${F.pct(support.slaRate)} unter Ziel`, `SLA rate ${F.pct(support.slaRate)} below target`), tone: 'warn', w: 2, go: 'support' });
    }
    list.sort((a, b) => b.w - a.w);
    const cats = [[T(L, 'Kritisch', 'Critical'), list.filter((x) => x.tone === 'bad').length, 'bad'], [T(L, 'Beobachten', 'Watch'), list.filter((x) => x.tone === 'warn').length, 'warn']];
    return {
      title: p.project ? T(L, `Was bei ${p.project.name} Aufmerksamkeit braucht`, `What needs attention in ${p.project.name}`) : scoped ? T(L, 'Was in deinen Projekten Aufmerksamkeit braucht', 'What needs attention in your projects') : T(L, 'Was jetzt Aufmerksamkeit braucht', 'What needs attention now'),
      answer: list.length ? T(L, `${list.length} Punkte – zuerst: ${list[0].text}.`, `${list.length} points – first: ${list[0].text}.`) : T(L, 'Nichts Dringendes – alles im grünen Bereich.', 'Nothing urgent – everything looks fine.'),
      views: ['list', 'donut', 'table'],
      data: { list: list.slice(0, 14), parts: cats.map(([l, v, tone]) => ({ label: l, value: v, tone })), table: { head: [T(L, 'Punkt', 'Item'), T(L, 'Details', 'Details')], rows: list.slice(0, 14).map((x) => [x.text, x.sub || '']) } },
      tone: list.some((x) => x.tone === 'bad') ? 'bad' : list.length ? 'warn' : 'ok',
    };
  },

  maturity(ctx, p, L, F) {
    const { metrics } = ctx.computed;
    const items = scopeItems(ctx, p);
    const rows = items.map((it) => ({ it, m: metrics.get(it.ref) }));
    const sized = rows.filter(({ m }) => m?.maturity != null), unsized = rows.filter(({ m }) => m && m.maturity == null);
    const OE = sized.reduce((a, { m }) => a + (m.maturityBasis?.oeCovered ?? m.OE), 0), OT = sized.reduce((a, { m }) => a + m.openTshirt, 0);
    const all = OE + OT > 0 ? OE / (OE + OT) : null;
    return {
      title: T(L, 'Reife: wie belastbar die Zahlen sind', 'Maturity: how reliable the numbers are'),
      answer: all == null ? T(L, 'Noch keine Reife: kein Projekt hat eine T-Shirt Size.', 'No maturity yet: no project has a T-shirt size.')
        : T(L, `Reife ${F.pct(all)} = ${F.h(OE)} Original Estimate ÷ (${F.h(OE)} + ${F.h(OT)} offene T-Shirt Size)${unsized.length ? ` · ${unsized.length} ohne T-Shirt Size (–)` : ''}.`, `Maturity ${F.pct(all)} = ${F.h(OE)} original estimate ÷ (${F.h(OE)} + ${F.h(OT)} open T-shirt size)${unsized.length ? ` · ${unsized.length} without a T-shirt size (–)` : ''}.`),
      views: ['bar', 'table', 'list', 'number'],
      data: {
        number: all == null ? null : { value: all, unit: 'pct', foot: T(L, 'über alle Projekte mit T-Shirt Size', 'over all projects with a T-shirt size') },
        series: sized.map(({ it, m }) => ({ label: label(it), value: m.maturity, tone: m.maturity < 0.5 ? 'warn' : 'ink', ref: it.ref })), unit: 'pct', max: 1,
        table: { head: [T(L, 'Projekt', 'Project'), T(L, 'Reife', 'Maturity'), 'Original Estimate', T(L, 'Offene T-Shirt Size', 'Open T-shirt size')], rows: rows.map(({ it, m }) => [label(it), m?.maturity == null ? '–' : F.pct(m.maturity), F.h(m?.OE || 0), F.h(m?.openTshirt || 0)]) },
        list: [...unsized.map(({ it }) => ({ text: label(it), sub: T(L, 'Keine T-Shirt Size – Reife nicht bestimmbar', 'No T-shirt size – maturity unknown'), tone: 'warn', ref: it.ref })),
          ...sized.map(({ it, m }) => ({ text: `${label(it)}: ${F.pct(m.maturity)}`, sub: T(L, `${F.h(m.openTshirt)} T-Shirt Size noch nicht als Story geschätzt`, `${F.h(m.openTshirt)} of T-shirt size not yet estimated`), tone: m.maturity < 0.5 ? 'warn' : 'ok', ref: it.ref }))],
      },
    };
  },

  blocked(ctx, p, L, F) {
    const { model, deps } = ctx.computed;
    const refs = new Set(scopeItems(ctx, p).map((x) => x.ref));
    const list = (deps.blocked || []).filter((b) => refs.has(model.byId.get(b.id)?.rootRef));
    const iss = (id) => model.byId.get(id) || model.external.get(id) || { key: id, summary: '' };
    return {
      title: T(L, 'Was steht still (Status Blocked)', 'What is stuck (status Blocked)'),
      answer: list.length ? T(L, `${list.length} Vorgänge blockiert${list[0].days != null ? `, der älteste seit ${list[0].days} Tagen` : ''}.`, `${list.length} work items blocked${list[0].days != null ? `, the oldest for ${list[0].days} days` : ''}.`) : T(L, 'Nichts blockiert.', 'Nothing is blocked.'),
      views: ['list', 'table', 'number'],
      data: {
        number: { value: list.length, unit: 'n', tone: list.length ? 'bad' : 'ok', foot: T(L, 'Stories und Sub-tasks im Status Blocked', 'stories and sub-tasks in the Blocked status') },
        list: list.map((b) => { const i = iss(b.id); return { text: `${i.key} ${i.summary}`, key: i.key, tone: b.days > 7 ? 'bad' : 'warn',
          sub: [b.days != null ? T(L, `seit ${b.days} Tagen`, `for ${b.days} days`) : null, b.waitsOn.length ? T(L, `wartet auf ${b.waitsOn.map((x) => iss(x).key).join(', ')}`, `waiting for ${b.waitsOn.map((x) => iss(x).key).join(', ')}`) : null, b.reason ? `„${b.reason.slice(0, 80)}“` : null].filter(Boolean).join(' · ') }; }),
        table: { head: ['Key', T(L, 'Vorgang', 'Work item'), T(L, 'Projekt', 'Project'), T(L, 'Seit', 'Since'), T(L, 'Wartet auf', 'Waiting for')], rows: list.map((b) => { const i = iss(b.id); return [i.key, i.summary, model.itemByRef.get(i.rootRef)?.name || '–', b.days == null ? '–' : T(L, `${b.days} Tage`, `${b.days} days`), b.waitsOn.map((x) => iss(x).key).join(', ') || '–']; }) },
      },
    };
  },

  ranking(ctx, p, L, F) {
    const { metrics, wl } = ctx.computed;
    const q0 = p.quarter || wl.quarters[0];
    const items = scopeItems(ctx, p);
    const rows = items.map((it) => { const m = metrics.get(it.ref); return { it, m, st: wl.projectQ[it.ref]?.[q0]?.status || null }; });
    return {
      title: T(L, 'Portfolio nach Rang', 'Portfolio by rank'),
      answer: T(L, `${items.length} aktive Projekte. Rang 1: ${items[0]?.name || '–'}.`, `${items.length} active projects. Rank 1: ${items[0]?.name || '–'}.`),
      views: ['table', 'bar', 'list'],
      data: {
        table: { head: [T(L, 'Rang', 'Rank'), T(L, 'Projekt', 'Project'), T(L, 'Fortschritt', 'Progress'), 'Health', `${F.quarter(q0)}`, T(L, 'Termin', 'Due')], rows: rows.map(({ it, m, st }) => [`#${it.rank}`, it.name, F.pct(m?.progress), hName(it.health?.status, L), wlName(st, L), F.date(m?.due)]) },
        series: rows.map(({ it, m, st }) => ({ label: label(it), value: m?.progress || 0, tone: st === 'no' ? 'bad' : st === 'partial' ? 'warn' : 'ink', ref: it.ref })), unit: 'pct', max: 1,
        list: rows.map(({ it, m, st }) => ({ text: label(it), sub: `${F.pct(m?.progress)} · ${hName(it.health?.status, L)} · ${wlName(st, L)}`, tone: healthTone[it.health?.status] || 'muted', ref: it.ref })),
      },
    };
  },

  progress(ctx, p, L, F) {
    const { metrics } = ctx.computed;
    const items = scopeItems(ctx, p);
    const ms = items.map((it) => metrics.get(it.ref)).filter(Boolean);
    const TS = ms.reduce((a, m) => a + m.TS, 0), RE = ms.reduce((a, m) => a + m.RE, 0), OT = ms.reduce((a, m) => a + m.openTshirt, 0);
    const prog = TS + RE + OT > 0 ? TS / (TS + RE + OT) : 0;
    const one = items.length === 1 ? items[0] : null;
    return {
      title: one ? T(L, `Fortschritt: ${one.name}`, `Progress: ${one.name}`) : T(L, 'Fortschritt der Projekte', 'Project progress'),
      answer: one ? T(L, `${one.name} steht bei ${F.pct(prog)} – ${F.h(TS)} geleistet, ${F.h(RE + OT)} offen.`, `${one.name} is at ${F.pct(prog)} – ${F.h(TS)} done, ${F.h(RE + OT)} open.`)
        : T(L, `Das Portfolio steht bei ${F.pct(prog)} (${F.h(TS)} von ${F.h(TS + RE + OT)}).`, `The portfolio is at ${F.pct(prog)} (${F.h(TS)} of ${F.h(TS + RE + OT)}).`),
      views: one ? ['number', 'donut', 'list'] : ['bar', 'number', 'donut', 'table'],
      data: {
        number: { value: prog, unit: 'pct', foot: T(L, 'geleistet ÷ (geleistet + Rest + offene T-Shirts)', 'done ÷ (done + remaining + open T-shirts)') },
        parts: [{ label: T(L, 'Geleistet', 'Done'), value: TS, color: 'var(--ink)' }, { label: T(L, 'Rest (Stories)', 'Remaining (stories)'), value: RE, color: 'var(--accent)' }, { label: T(L, 'Offene T-Shirts', 'Open T-shirts'), value: OT, color: 'var(--line-strong)' }], partsUnit: 'h',
        series: items.map((it) => ({ label: label(it), value: metrics.get(it.ref)?.progress || 0, ref: it.ref })), unit: 'pct', max: 1,
        table: { head: [T(L, 'Projekt', 'Project'), T(L, 'Fortschritt', 'Progress'), T(L, 'Geleistet', 'Done'), T(L, 'Rest', 'Remaining'), T(L, 'Reife', 'Maturity')], rows: items.map((it) => { const m = metrics.get(it.ref); return [label(it), F.pct(m?.progress), F.h(m?.TS), F.h((m?.RE || 0) + (m?.openTshirt || 0)), F.pct(m?.maturity)]; }) },
        list: one ? (() => { const m = metrics.get(one.ref); return [
          { text: T(L, `Rang #${one.rank}`, `Rank #${one.rank}`), tone: 'ink' },
          { text: T(L, `${m.storyCount} Stories, ${F.pct(m.estimatedShare)} geschätzt`, `${m.storyCount} stories, ${F.pct(m.estimatedShare)} estimated`), tone: m.estimatedShare < 0.8 ? 'warn' : 'ok' },
          { text: T(L, `Prognose ${F.h(m.forecast)} bei Plan ${F.h(m.OE)}`, `Forecast ${F.h(m.forecast)} vs plan ${F.h(m.OE)}`), tone: m.warnings.some((w) => w.kind === 'forecastOverPlan') ? 'warn' : 'ok' },
          { text: m.due ? T(L, `Termin ${F.date(m.due)}${m.daysOverdue ? ` – ${m.daysOverdue} Tage drüber` : ''}`, `Due ${F.date(m.due)}${m.daysOverdue ? ` – ${m.daysOverdue} days over` : ''}`) : T(L, 'Kein Termin', 'No due date'), tone: m.daysOverdue ? 'bad' : 'ok' },
        ]; })() : [],
      },
    };
  },

  health(ctx, p, L) {
    const items = scopeItems(ctx, p);
    const by = { onTrack: 0, atRisk: 0, critical: 0, none: 0 };
    for (const it of items) by[it.health?.status || 'none']++;
    const notOk = items.filter((it) => it.health?.status !== 'onTrack');
    return {
      title: T(L, 'Health der Projekte', 'Project health'),
      answer: T(L, `${by.onTrack} im Plan, ${by.atRisk} gefährdet, ${by.critical} kritisch, ${by.none} ohne Update.`, `${by.onTrack} on track, ${by.atRisk} at risk, ${by.critical} critical, ${by.none} without update.`),
      views: ['donut', 'list', 'table', 'bar'],
      data: {
        parts: [{ label: hName('onTrack', L), value: by.onTrack, tone: 'ok' }, { label: hName('atRisk', L), value: by.atRisk, tone: 'warn' }, { label: hName('critical', L), value: by.critical, tone: 'bad' }, { label: hName(null, L), value: by.none, tone: 'muted' }],
        series: [{ label: hName('onTrack', L), value: by.onTrack, tone: 'ok' }, { label: hName('atRisk', L), value: by.atRisk, tone: 'warn' }, { label: hName('critical', L), value: by.critical, tone: 'bad' }, { label: hName(null, L), value: by.none, tone: 'muted' }],
        list: notOk.map((it) => ({ text: `${label(it)} – ${hName(it.health?.status, L)}`, sub: it.health?.comment || '', tone: healthTone[it.health?.status] || 'muted', ref: it.ref })),
        table: { head: [T(L, 'Projekt', 'Project'), 'Health', T(L, 'Kommentar', 'Comment')], rows: items.map((it) => [label(it), hName(it.health?.status, L), it.health?.comment || '']) },
      },
      tone: by.critical ? 'bad' : by.atRisk ? 'warn' : 'ok',
    };
  },

  waterline(ctx, p, L, F) {
    const { model, wl } = ctx.computed;
    const q = p.quarter || wl.quarters[0];
    const items = scopeItems(ctx, p);
    const st = (it) => wl.projectQ[it.ref]?.[q]?.status || null;
    const first = items.find((it) => st(it) && st(it) !== 'ok');
    const ok = items.filter((it) => st(it) === 'ok').length;
    const teams = wl.teamIds.filter((t) => t !== '_none' && wl.cells[t]?.[q]);
    return {
      title: T(L, `Wasserlinie ${F.quarter(q)}`, `Waterline ${F.quarter(q)}`),
      answer: first ? T(L, `Ab Rang #${first.rank} (${first.name}) reicht die Kapazität in ${F.quarter(q)} nicht mehr. ${ok} Projekte voll besetzbar.`, `From rank #${first.rank} (${first.name}) capacity runs out in ${F.quarter(q)}. ${ok} projects fully staffable.`)
        : T(L, `Alle Projekte sind in ${F.quarter(q)} besetzbar.`, `All projects are staffable in ${F.quarter(q)}.`),
      views: ['list', 'heat', 'bar', 'number'],
      data: {
        number: { value: first ? first.rank : null, unit: 'rank', foot: T(L, 'erster nicht voll besetzbarer Rang', 'first rank not fully staffable') },
        list: items.filter((it) => st(it)).map((it) => ({ text: label(it), sub: wlName(st(it), L), tone: st(it) === 'ok' ? 'ok' : st(it) === 'partial' ? 'warn' : 'bad', ref: it.ref })),
        heat: { cols: wl.quarters.map((x) => F.quarter(x)), rows: teams.map((t) => ({ label: model.teams.get(t)?.name || t, values: wl.quarters.map((x) => { const c = wl.cells[t]?.[x]; return c ? (c.util === Infinity ? 9.99 : c.util) : null; }) })) },
        series: teams.map((t) => { const u = wl.cells[t][q].util; return { label: model.teams.get(t)?.name || t, value: u === Infinity ? 9.99 : u, tone: pctTone(u) }; }), unit: 'pct',
      },
      tone: first ? 'warn' : 'ok',
    };
  },

  utilization(ctx, p, L, F) {
    const { model, wl } = ctx.computed;
    const q = p.quarter || wl.quarters[0];
    const teams = (p.team ? [p.team.id] : wl.teamIds).filter((t) => t !== '_none' && Object.keys(wl.cells[t] || {}).length);
    const util = (t, x) => { const c = wl.cells[t]?.[x]; return c ? (c.util === Infinity ? 9.99 : c.util) : null; };
    const over = teams.filter((t) => (util(t, q) || 0) > 1.0001);
    if (p.team) {
      const t = p.team.id, cell = wl.cells[t]?.[q];
      const rows = (cell?.rows || []).filter((r) => r.kind === 'project');
      return {
        title: T(L, `Team ${p.team.name}: Auslastung`, `Team ${p.team.name}: utilisation`),
        answer: cell ? T(L, `${p.team.name} ist in ${F.quarter(q)} zu ${F.pct(cell.util)} ausgelastet (${F.h(cell.demand)} Bedarf bei ${F.h(cell.capacity)} Kapazität).`, `${p.team.name} is ${F.pct(cell.util)} loaded in ${F.quarter(q)} (${F.h(cell.demand)} demand vs ${F.h(cell.capacity)} capacity).`) : T(L, `Für ${p.team.name} gibt es in ${F.quarter(q)} keinen Bedarf.`, `${p.team.name} has no demand in ${F.quarter(q)}.`),
        views: ['line', 'bar', 'table'],
        data: {
          line: { labels: wl.quarters.map((x) => F.quarter(x)), series: [{ name: p.team.name, values: wl.quarters.map((x) => util(t, x)) }], target: 1, unit: 'pct' },
          series: rows.map((r) => ({ label: label(model.itemByRef.get(r.ref) || { rank: r.rank, name: r.ref }), value: r.demand, tone: r.status === 'ok' ? 'ink' : r.status === 'partial' ? 'warn' : 'bad', ref: r.ref })), unit: 'h',
          table: { head: [T(L, 'Projekt', 'Project'), T(L, 'Bedarf', 'Demand'), T(L, 'Besetzt', 'Staffed'), 'Status'], rows: rows.map((r) => [label(model.itemByRef.get(r.ref) || { rank: r.rank, name: r.ref }), F.h(r.demand), F.h(r.staffed), wlName(r.status, L)]) },
        },
        tone: pctTone(cell?.util),
      };
    }
    return {
      title: T(L, `Auslastung der Teams ${F.quarter(q)}`, `Team utilisation ${F.quarter(q)}`),
      answer: over.length ? T(L, `${over.length} von ${teams.length} Teams sind in ${F.quarter(q)} über 100 %: ${over.map((t) => model.teams.get(t)?.name || t).join(', ')}.`, `${over.length} of ${teams.length} teams are over 100% in ${F.quarter(q)}: ${over.map((t) => model.teams.get(t)?.name || t).join(', ')}.`)
        : T(L, `Kein Team ist in ${F.quarter(q)} überlastet.`, `No team is overloaded in ${F.quarter(q)}.`),
      views: ['bar', 'heat', 'line', 'table'],
      data: {
        series: teams.map((t) => ({ label: model.teams.get(t)?.name || t, value: util(t, q) ?? 0, tone: pctTone(util(t, q)) })).sort((a, b) => b.value - a.value), unit: 'pct',
        heat: { cols: wl.quarters.map((x) => F.quarter(x)), rows: teams.map((t) => ({ label: model.teams.get(t)?.name || t, values: wl.quarters.map((x) => util(t, x)) })) },
        line: { labels: wl.quarters.map((x) => F.quarter(x)), series: teams.slice(0, 6).map((t) => ({ name: model.teams.get(t)?.name || t, values: wl.quarters.map((x) => util(t, x)) })), target: 1, unit: 'pct' },
        table: { head: ['Team', T(L, 'Kapazität', 'Capacity'), T(L, 'Bedarf', 'Demand'), T(L, 'Auslastung', 'Utilisation')], rows: teams.map((t) => { const c = wl.cells[t]?.[q]; return [model.teams.get(t)?.name || t, F.h(c?.capacity), F.h(c?.demand), F.pct(c?.util)]; }) },
      },
      tone: over.length ? 'bad' : 'ok',
    };
  },

  dependencies(ctx, p, L, F) {
    const { model, deps } = ctx.computed;
    const root = (id) => model.byId.get(id)?.rootRef || model.external.get(id)?.projectKey || null;
    const list = deps.list.filter((d) => d.open && (!p.project || [root(d.pre), root(d.dep)].includes(p.project.ref)));
    const nodes = new Map(), edges = new Map();
    const node = (r) => {
      if (!r || nodes.has(r)) return;
      const it = model.itemByRef.get(r);
      nodes.set(r, { id: r, label: it ? label(it) : r, tone: it ? healthTone[it.health?.status] || 'ink' : 'muted', ext: !it });
    };
    for (const d of list) {
      const a = root(d.pre), b = root(d.dep);
      if (!a || !b) continue;
      node(a); node(b);
      if (a === b) { nodes.get(a).internal = (nodes.get(a).internal || 0) + 1; continue; }
      const k = `${a}>${b}`;
      const e = edges.get(k) || edges.set(k, { from: a, to: b, count: 0, conflicts: 0, days: 0 }).get(k);
      e.count++; if (d.conflict) { e.conflicts++; e.days = Math.max(e.days, d.conflictDays); }
    }
    const conflicts = list.filter((d) => d.conflict);
    const iss = (id) => model.byId.get(id) || model.external.get(id) || { key: id, summary: '' };
    return {
      title: p.project ? T(L, `Abhängigkeiten: ${p.project.name}`, `Dependencies: ${p.project.name}`) : T(L, 'Abhängigkeiten im Portfolio', 'Dependencies across the portfolio'),
      answer: T(L, `${list.length} offene ${list.length === 1 ? 'Abhängigkeit' : 'Abhängigkeiten'}, davon ${conflicts.length} mit Terminkonflikt.`, `${list.length} open ${list.length === 1 ? 'dependency' : 'dependencies'}, ${conflicts.length} with a schedule conflict.`),
      views: ['graph', 'list', 'table', 'number'],
      data: {
        graph: { nodes: [...nodes.values()], edges: [...edges.values()].map((e) => ({ ...e, tone: e.conflicts ? 'bad' : 'ink', label: String(e.conflicts || e.count) })) },
        number: { value: conflicts.length, unit: 'n', foot: T(L, 'Terminkonflikte', 'schedule conflicts'), tone: conflicts.length ? 'bad' : 'ok' },
        list: conflicts.slice(0, 14).map((d) => ({ text: `${iss(d.pre).key} → ${iss(d.dep).key}`, sub: T(L, `${d.conflictDays} Tage Konflikt · ${iss(d.dep).summary}`, `${d.conflictDays} days conflict · ${iss(d.dep).summary}`), tone: 'bad', key: iss(d.dep).key })),
        table: { head: [T(L, 'Vorgänger', 'Predecessor'), T(L, 'Nachfolger', 'Successor'), T(L, 'Beziehung', 'Relation'), T(L, 'Konflikt', 'Conflict')], rows: list.slice(0, 40).map((d) => [`${iss(d.pre).key} ${iss(d.pre).summary}`, `${iss(d.dep).key} ${iss(d.dep).summary}`, d.relation, d.conflict ? T(L, `${d.conflictDays} Tage`, `${d.conflictDays} days`) : '–']) },
      },
      tone: conflicts.length ? 'bad' : 'ok',
    };
  },

  quality(ctx, p, L, F) {
    const { dq } = ctx.computed;
    const gaps = p.project ? dq.gaps.filter((g) => g.rootRef === p.project.ref) : dq.gaps;
    const byRule = new Map();
    for (const g of gaps) byRule.set(g.rule, (byRule.get(g.rule) || 0) + 1);
    const urgent = gaps.filter((g) => g.urgent);
    return {
      title: T(L, 'Datenqualität', 'Data quality'),
      answer: T(L, `Datenqualität ${F.pct(dq.score)}. ${gaps.length} Lücken, ${urgent.length} davon dringend.`, `Data quality ${F.pct(dq.score)}. ${gaps.length} gaps, ${urgent.length} urgent.`),
      views: ['bar', 'number', 'list', 'donut'],
      data: {
        number: { value: dq.score, unit: 'pct', foot: T(L, 'vollständig gepflegte Vorgänge', 'fully maintained work items'), tone: dq.score < 0.8 ? 'warn' : 'ok' },
        series: [...byRule.entries()].map(([rule, n]) => ({ label: ctx.ruleName ? ctx.ruleName(rule) : rule, value: n, tone: 'ink' })).sort((a, b) => b.value - a.value),
        parts: [{ label: T(L, 'Dringend', 'Urgent'), value: urgent.length, tone: 'bad' }, { label: T(L, 'Weitere Lücken', 'Other gaps'), value: gaps.filter((g) => !g.urgent && g.severity === 'gap').length, tone: 'warn' }, { label: T(L, 'Hinweise', 'Hints'), value: gaps.filter((g) => g.severity === 'hint').length, tone: 'muted' }],
        list: urgent.concat(gaps.filter((g) => !g.urgent)).slice(0, 14).map((g) => ({ text: `${g.key} ${g.summary}`, sub: ctx.ruleName ? ctx.ruleName(g.rule) : g.rule, tone: g.urgent ? 'bad' : 'warn', key: g.key })),
      },
      tone: urgent.length ? 'warn' : 'ok',
    };
  },

  overdue(ctx, p, L, F) {
    const { metrics } = ctx.computed;
    const items = scopeItems(ctx, p);
    const rows = items.map((it) => ({ it, m: metrics.get(it.ref) })).filter(({ m }) => m && (m.overdueCount || m.daysOverdue));
    const total = rows.reduce((a, r) => a + r.m.overdueCount, 0);
    return {
      title: T(L, 'Überfällige Arbeit', 'Overdue work'),
      answer: (() => {
        if (!rows.length) return T(L, 'Nichts ist überfällig.', 'Nothing is overdue.');
        const late = rows.filter((r) => r.m.daysOverdue).length, withStories = rows.filter((r) => r.m.overdueCount).length;
        const a = total ? T(L, `${total} offene ${total === 1 ? 'Story ist' : 'Stories sind'} überfällig (in ${withStories} ${withStories === 1 ? 'Projekt' : 'Projekten'}).`, `${total} open ${total === 1 ? 'story is' : 'stories are'} overdue (in ${withStories} ${withStories === 1 ? 'project' : 'projects'}).`) : T(L, 'Keine offene Story ist überfällig.', 'No open story is overdue.');
        const b = late ? T(L, ` ${late} ${late === 1 ? 'Projekt liegt' : 'Projekte liegen'} über dem eigenen Termin.`, ` ${late} ${late === 1 ? 'project is' : 'projects are'} past their own due date.`) : '';
        return a + b;
      })(),
      views: ['bar', 'number', 'list'],
      data: {
        number: { value: total, unit: 'n', foot: T(L, 'überfällige offene Stories', 'overdue open stories'), tone: total ? 'bad' : 'ok' },
        series: rows.map(({ it, m }) => ({ label: label(it), value: m.overdueCount, tone: m.daysOverdue ? 'bad' : 'warn', ref: it.ref })).sort((a, b) => b.value - a.value),
        list: rows.map(({ it, m }) => ({ text: label(it), sub: m.daysOverdue ? T(L, `Projekt ${m.daysOverdue} Tage über dem Termin · ${m.overdueCount} Vorgänge`, `project ${m.daysOverdue} days past due · ${m.overdueCount} items`) : T(L, `${m.overdueCount} Vorgänge überfällig`, `${m.overdueCount} items overdue`), tone: m.daysOverdue ? 'bad' : 'warn', ref: it.ref })),
      },
      tone: total ? 'bad' : 'ok',
    };
  },

  milestones(ctx, p, L, F) {
    const ms = ctx.computed.milestones || [];
    const risky = ms.filter((m) => m.atRisk);
    return {
      title: T(L, 'Meilensteine', 'Milestones'),
      answer: ms.length ? T(L, `${ms.length} Meilensteine, ${risky.length} gefährdet.${ms[0] ? ` Nächster: ${ms[0].name} am ${F.date(ms[0].date)}.` : ''}`, `${ms.length} milestones, ${risky.length} at risk.${ms[0] ? ` Next: ${ms[0].name} on ${F.date(ms[0].date)}.` : ''}`) : T(L, 'Es sind keine Meilensteine gepflegt.', 'No milestones are maintained.'),
      views: ['list', 'table', 'donut'],
      data: {
        list: ms.map((m) => ({ text: `${m.name} · ${F.date(m.date)}`, sub: m.atRisk ? T(L, `gefährdet – ${m.late.length} Stories enden später`, `at risk – ${m.late.length} stories finish later`) : T(L, 'im Plan', 'on track'), tone: m.atRisk ? 'bad' : 'ok' })),
        table: { head: [T(L, 'Meilenstein', 'Milestone'), T(L, 'Datum', 'Date'), 'Status', T(L, 'Stories', 'Stories'), T(L, 'Später', 'Late')], rows: ms.map((m) => [m.name, F.date(m.date), m.atRisk ? T(L, 'gefährdet', 'at risk') : T(L, 'im Plan', 'on track'), String(m.stories.length), String(m.late.length)]) },
        parts: [{ label: T(L, 'Im Plan', 'On track'), value: ms.length - risky.length, tone: 'ok' }, { label: T(L, 'Gefährdet', 'At risk'), value: risky.length, tone: 'bad' }],
      },
      tone: risky.length ? 'warn' : 'ok',
    };
  },

  hours(ctx, p, L, F) {
    const { metrics } = ctx.computed;
    const items = scopeItems(ctx, p);
    const ms = items.map((it) => ({ it, m: metrics.get(it.ref) })).filter(({ m }) => m);
    const OE = ms.reduce((a, x) => a + x.m.OE, 0), TS = ms.reduce((a, x) => a + x.m.TS, 0), FC = ms.reduce((a, x) => a + x.m.forecast, 0);
    const dev = OE > 0 ? FC / OE - 1 : null;
    return {
      title: T(L, 'Schätzung, Aufwand und Prognose', 'Estimate, effort and forecast'),
      answer: T(L, `Geplant ${F.h(OE)}, gebucht ${F.h(TS)}, Prognose ${F.h(FC)}${dev != null ? ` (${dev >= 0 ? '+' : ''}${F.pct(dev)} zum Plan)` : ''}.`, `Planned ${F.h(OE)}, logged ${F.h(TS)}, forecast ${F.h(FC)}${dev != null ? ` (${dev >= 0 ? '+' : ''}${F.pct(dev)} vs plan)` : ''}.`),
      views: ['columns', 'table', 'bar', 'number'],
      data: {
        columns: { labels: ms.map(({ it }) => `#${it.rank}`), series: [{ name: T(L, 'Plan (OE)', 'Plan (OE)'), values: ms.map(({ m }) => m.OE), color: 'var(--line-strong)' }, { name: T(L, 'Gebucht', 'Logged'), values: ms.map(({ m }) => m.TS), color: 'var(--ink)' }, { name: T(L, 'Prognose', 'Forecast'), values: ms.map(({ m }) => m.forecast), color: 'var(--accent)' }], unit: 'h' },
        series: ms.filter(({ m }) => m.OE > 0).map(({ it, m }) => ({ label: label(it), value: m.forecast / m.OE - 1, tone: m.forecast > m.OE * 1.1 ? 'bad' : 'ok', ref: it.ref })), unit: 'signedPct',
        number: { value: dev, unit: 'signedPct', foot: T(L, 'Prognose gegenüber Plan', 'forecast vs plan'), tone: dev > 0.1 ? 'bad' : 'ok' },
        table: { head: [T(L, 'Projekt', 'Project'), 'Plan', T(L, 'Gebucht', 'Logged'), T(L, 'Rest', 'Remaining'), T(L, 'Prognose', 'Forecast')], rows: ms.map(({ it, m }) => [label(it), F.h(m.OE), F.h(m.TS), F.h(m.RE), F.h(m.forecast)]) },
      },
    };
  },

  support(ctx, p, L, F) {
    const a = ctx.supportA, s = ctx.computed.support;
    if (!a && !s) return { title: 'Support', answer: T(L, 'Es ist keine Support-Arbeit verbunden. Ein Jira-Admin richtet das unter Konfiguration › Support & SLAs ein.', 'No support work is connected. A Jira admin sets this up under Configuration › Support & SLAs.'), views: ['text'], data: {} };
    if (!a) return {
      title: T(L, 'Support-Reserve je Team', 'Support reserve per team'),
      answer: T(L, `SLA-Quote ${F.pct(s.slaRate)}, ${F.h(s.weeklyTotal)} je Woche für Support reserviert.`, `SLA rate ${F.pct(s.slaRate)}, ${F.h(s.weeklyTotal)} per week reserved for support.`),
      views: ['bar', 'number'], data: { series: s.teams.map((t) => ({ label: ctx.computed.model.teams.get(t.teamId)?.name || t.teamId, value: t.weekly })), unit: 'h', number: { value: s.slaRate, unit: 'pct', foot: T(L, 'SLA-Quote', 'SLA rate') } },
    };
    const k = a.kpis;
    const prios = a.byPriority.filter((x) => x.open);
    const colors = ['var(--bad)', 'var(--accent)', 'var(--warn)', 'var(--ink)', 'var(--line-strong)'];
    if (p.project) {
      const rows = a.queue.filter((r) => r.project === p.project.ref);
      return {
        title: T(L, `Support für ${p.project.name}`, `Support for ${p.project.name}`),
        answer: T(L, `${rows.length} offene Tickets hängen an ${p.project.name}, ${rows.filter((r) => r.sla.status === 'breached').length} davon über dem SLA.`, `${rows.length} open tickets are linked to ${p.project.name}, ${rows.filter((r) => r.sla.status === 'breached').length} past SLA.`),
        views: ['list', 'number'],
        data: { list: rows.slice(0, 14).map((r) => ({ text: `${r.key} ${r.summary}`, sub: `${r.priority || ''} · ${r.sla.status}`, tone: r.sla.status === 'breached' ? 'bad' : r.sla.status === 'atRisk' ? 'warn' : 'ok', key: r.key })), number: { value: rows.length, unit: 'n', foot: T(L, 'offene Tickets', 'open tickets') } },
      };
    }
    return {
      title: T(L, 'Support & SLAs', 'Support & SLAs'),
      answer: T(L, `${k.open} offene Tickets, ${k.breachedOpen} über dem SLA, ${k.atRisk} knapp. SLA-Quote ${F.pct(k.slaRate)} (Ziel ${F.pct(k.target)}).`, `${k.open} open tickets, ${k.breachedOpen} past SLA, ${k.atRisk} close. SLA rate ${F.pct(k.slaRate)} (target ${F.pct(k.target)}).`),
      views: ['number', 'donut', 'line', 'columns', 'bar', 'list'],
      data: {
        number: { value: k.slaRate, unit: 'pct', foot: T(L, `SLA-Quote · Ziel ${F.pct(k.target)}`, `SLA rate · target ${F.pct(k.target)}`), tone: k.slaRate != null && k.slaRate < k.target ? 'bad' : 'ok' },
        parts: prios.map((x, i) => ({ label: x.priority, value: x.open, color: colors[Math.min(i, 4)] })),
        line: { labels: a.trend.map((w) => F.week(w.week)), series: [{ name: T(L, 'SLA-Quote', 'SLA rate'), values: a.trend.map((w) => w.rate) }], target: k.target, unit: 'pct', domain: [0, 1] },
        columns: { labels: a.trend.map((w) => F.week(w.week)), series: [{ name: T(L, 'Neu', 'Created'), values: a.trend.map((w) => w.created), color: 'var(--accent)' }, { name: T(L, 'Gelöst', 'Resolved'), values: a.trend.map((w) => w.resolved), color: 'var(--ink)' }], unit: 'n' },
        series: a.byProject.map((x) => ({ label: ctx.computed.model.itemByRef.get(x.ref) ? label(ctx.computed.model.itemByRef.get(x.ref)) : x.ref, value: x.open, tone: x.breached ? 'bad' : 'ink', ref: x.ref })), unit: 'n',
        list: a.queue.filter((r) => r.sla.status !== 'ok').slice(0, 14).map((r) => ({ text: `${r.key} ${r.summary}`, sub: `${r.priority || ''} · ${targetHours(r.priority, ctx.cal)} h`, tone: r.sla.status === 'breached' ? 'bad' : 'warn', key: r.key })),
      },
      tone: k.breachedOpen ? 'bad' : 'ok',
    };
  },

  count(ctx, p, L, F) {
    const { model } = ctx.computed;
    const issues = model.ds.issues || [];
    const roles = [['structure', T(L, 'Epics', 'Epics')], ['estimate', T(L, 'Stories', 'Stories')], ['rough', T(L, 'Grobplanung', 'Rough items')]];
    const wantRole = /epic/.test(p.q) ? 'structure' : /stor/.test(p.q) ? 'estimate' : /workstream|grob|rough/.test(p.q) ? 'rough' : null;
    if (wantRole) {
      const xs = issues.filter((i) => i.role === wantRole && (!p.project || i.rootRef === p.project.ref));
      const by = { new: 0, indeterminate: 0, done: 0 };
      for (const i of xs) by[i.status?.cat || 'new']++;
      const name = roles.find(([r]) => r === wantRole)[1];
      return {
        title: T(L, `Anzahl ${name}`, `Number of ${name}`), answer: T(L, `${xs.length} ${name}: ${by.new} offen, ${by.indeterminate} in Arbeit, ${by.done} erledigt.`, `${xs.length} ${name}: ${by.new} to do, ${by.indeterminate} in progress, ${by.done} done.`),
        views: ['number', 'donut'], data: { number: { value: xs.length, unit: 'n', foot: name }, parts: [{ label: T(L, 'Offen', 'To do'), value: by.new, tone: 'muted' }, { label: T(L, 'In Arbeit', 'In progress'), value: by.indeterminate, tone: 'warn' }, { label: T(L, 'Erledigt', 'Done'), value: by.done, tone: 'ok' }] },
      };
    }
    const items = model.items;
    const open = items.filter((x) => (x.statusCat ?? 'new') !== 'done').length;
    return {
      title: T(L, 'Projekte im Portfolio', 'Projects in the portfolio'), answer: T(L, `${items.length} Projekte im Portfolio, ${open} davon aktiv.`, `${items.length} projects in the portfolio, ${open} active.`),
      views: ['number', 'donut'], data: { number: { value: items.length, unit: 'n', foot: T(L, 'Projekte', 'projects') }, parts: [{ label: T(L, 'Aktiv', 'Active'), value: open, tone: 'ink' }, { label: T(L, 'Abgeschlossen', 'Completed'), value: items.length - open, tone: 'ok' }] },
    };
  },

  project(ctx, p, L, F) {
    const card = RECIPES.progress(ctx, p, L, F);
    const { wl, deps, dq, model } = ctx.computed;
    const it = p.project;
    const st = wl.projectQ[it.ref]?.[wl.quarters[0]]?.status;
    const conf = deps.list.filter((d) => d.conflict && [model.byId.get(d.pre)?.rootRef, model.byId.get(d.dep)?.rootRef].includes(it.ref)).length;
    const gaps = dq.gaps.filter((g) => g.rootRef === it.ref && g.urgent).length;
    card.title = `${label(it)}`;
    card.answer = T(L, `${it.name}: Rang #${it.rank}, ${F.pct(ctx.computed.metrics.get(it.ref)?.progress)} Fortschritt, Health ${hName(it.health?.status, L)}, in ${F.quarter(wl.quarters[0])} ${wlName(st, L)}.`, `${it.name}: rank #${it.rank}, ${F.pct(ctx.computed.metrics.get(it.ref)?.progress)} progress, health ${hName(it.health?.status, L)}, ${wlName(st, L)} in ${F.quarter(wl.quarters[0])}.`);
    card.data.list = [
      ...card.data.list,
      { text: T(L, `Health: ${hName(it.health?.status, L)}`, `Health: ${hName(it.health?.status, L)}`), sub: it.health?.comment || '', tone: healthTone[it.health?.status] || 'muted' },
      { text: T(L, `${F.quarter(wl.quarters[0])}: ${wlName(st, L)}`, `${F.quarter(wl.quarters[0])}: ${wlName(st, L)}`), tone: st === 'ok' ? 'ok' : st ? 'bad' : 'muted' },
      { text: T(L, `${conf} Terminkonflikte`, `${conf} schedule conflicts`), tone: conf ? 'bad' : 'ok' },
      { text: T(L, `${gaps} dringende Datenlücken`, `${gaps} urgent data gaps`), tone: gaps ? 'warn' : 'ok' },
    ];
    card.views = ['list', 'number', 'donut'];
    return card;
  },

  // ---------- "Ich will …" ----------
  realCapacity(ctx, p, L, F) {
    const rc = rcOf(ctx, L);
    const teams = p.team ? rc.teams.filter((t) => t.teamId === p.team.id) : rc.teams;
    const n = rc.weeks.length;
    const title = p.team ? T(L, `Realistische Kapazität: ${p.team.name}`, `Realistic capacity: ${p.team.name}`) : T(L, 'Realistische Kapazität je Team', 'Realistic capacity per team');
    const info = { title, text: rc.facts.join(' '), inputs: [...periodInputs(rc, L, F), ...historyInputs(ctx, L)] };
    if (!teams.length) return { title, answer: T(L, `Für ${p.team ? p.team.name : 'die Teams'} gibt es in den nächsten ${n} Wochen weder Kapazität noch geplante Arbeit.`, `${p.team ? p.team.name : 'The teams'} have neither capacity nor planned work in the next ${n} weeks.`), views: ['text'], data: {}, tone: 'muted', info, desc: '' };
    const one = teams.length === 1 ? teams[0] : null;
    const tot = (k) => teams.reduce((a, t) => a + (t.avg[k] || 0), 0);
    const sup = teams.reduce((a, t) => a + (t.support.p80 || 0), 0);
    const over = teams.filter((t) => t.overWeeks > 0);
    const util = (t) => (t.avg.room > 0 ? t.avg.plannedAdj / t.avg.room : t.avg.plannedAdj > 0 ? 9.99 : 0);
    const S = [T(L, 'Verfügbar', 'Available'), T(L, 'Support (P80)', 'Support (P80)'), T(L, 'Raum für Projekte', 'Room for projects'), T(L, 'Geplant (realistisch)', 'Planned (realistic)')];
    const C = ['var(--line-strong)', 'var(--warn)', 'var(--ink)', 'var(--accent)'];
    const columns = one
      ? { labels: one.weekly.map((w) => F.date(w.from)), series: [one.weekly.map((w) => w.nominal), one.weekly.map((w) => w.supportP80), one.weekly.map((w) => w.room), one.weekly.map((w) => w.plannedAdj)].map((values, i) => ({ name: S[i], values, color: C[i] })), unit: 'h' }
      : { labels: teams.map((t) => t.name), series: [teams.map((t) => t.avg.nominal), teams.map((t) => t.support.p80), teams.map((t) => t.avg.room), teams.map((t) => t.avg.plannedAdj)].map((values, i) => ({ name: S[i], values, color: C[i] })), unit: 'h' };
    const teamCard = (t) => ({ text: t.explain, calc: T(L, `${F.h(t.avg.nominal)} verfügbar − ${F.h(t.support.p80)} Support (P80) ≈ ${F.h(t.avg.room)} Raum · ${F.h(t.avg.planned)} geplant × ${fmtFactor(t.estimate.factor, L)} = ${F.h(t.avg.plannedAdj)}`, `${F.h(t.avg.nominal)} available − ${F.h(t.support.p80)} support (P80) ≈ ${F.h(t.avg.room)} room · ${F.h(t.avg.planned)} planned × ${fmtFactor(t.estimate.factor, L)} = ${F.h(t.avg.plannedAdj)}`),
      inputs: [[T(L, 'Support Median', 'Support median'), F.h(t.support.median)], [T(L, 'Support-Wochen gemessen', 'Support weeks measured'), String(t.support.weeks)], [T(L, 'Schätzfaktor', 'Estimate factor'), `${fmtFactor(t.estimate.factor, L)} (${factorSource(t.estimate, L)})`], [T(L, 'Sicherheit', 'Confidence'), confName(t.confidence, L)]] });
    return {
      title,
      answer: one ? one.explain : T(L, `Pro Woche sind Ø ${F.h(tot('nominal'))} verfügbar; Support braucht realistisch ${F.h(sup)}, bleiben ${F.h(tot('room'))} für Projekte – geplant sind realistisch ${F.h(tot('plannedAdj'))}.${over.length ? ` Überstunden drohen bei ${over.map((t) => t.name).join(', ')}.` : ' Das passt ohne Überstunden.'}`,
        `Per week avg ${F.h(tot('nominal'))} is available; support realistically needs ${F.h(sup)}, leaving ${F.h(tot('room'))} for projects – realistically ${F.h(tot('plannedAdj'))} is planned.${over.length ? ` Overtime looms for ${over.map((t) => t.name).join(', ')}.` : ' That fits without overtime.'}`),
      desc: one ? T(L, 'Säulen je Woche: verfügbare Stunden, Support-Bedarf (P80), Raum für Projekte und realistisch geplante Arbeit.', 'Columns per week: available hours, support need (P80), room for projects and realistically planned work.')
        : T(L, 'Säulen je Team, Durchschnitt pro Woche: verfügbar, Support-Bedarf (P80), Raum für Projekte, realistisch geplant.', 'Columns per team, average per week: available, support need (P80), room for projects, realistically planned.'),
      views: one ? ['columns', 'line', 'table', 'list'] : ['columns', 'bar', 'table', 'list'],
      data: {
        columns,
        line: one ? { labels: one.weekly.map((w) => F.date(w.from)), series: [{ name: S[2], values: one.weekly.map((w) => w.room) }, { name: S[3], values: one.weekly.map((w) => w.plannedAdj) }], unit: 'h' } : null,
        series: teams.map((t) => ({ label: t.name, value: util(t), tone: pctTone(util(t)), card: teamCard(t) })).sort((a, b) => b.value - a.value), unit: 'pct',
        table: { head: ['Team', T(L, 'Verfügbar Ø', 'Available avg'), 'Support P80', T(L, 'Raum Ø', 'Room avg'), T(L, 'Geplant Ø', 'Planned avg'), T(L, 'Faktor', 'Factor'), T(L, 'Realistisch Ø', 'Realistic avg'), T(L, 'Überstunden', 'Overtime')],
          rows: teams.map((t) => [t.name, F.h(t.avg.nominal), F.h(t.support.p80), F.h(t.avg.room), F.h(t.avg.planned), fmtFactor(t.estimate.factor, L), F.h(t.avg.plannedAdj), t.totals.overtime > 0 ? F.h(t.totals.overtime) : '–']) },
        list: teams.map((t) => ({ text: t.name, sub: t.explain, tone: t.overWeeks ? 'bad' : 'ok', go: 'capacity' })),
      },
      info: { ...info, calc: one ? teamCard(one).calc : T(L, `${F.h(tot('nominal'))} − ${F.h(sup)} Support ≈ ${F.h(tot('room'))} Raum je Woche · geplant ${F.h(tot('planned'))} → realistisch ${F.h(tot('plannedAdj'))}`, `${F.h(tot('nominal'))} − ${F.h(sup)} support ≈ ${F.h(tot('room'))} room per week · planned ${F.h(tot('planned'))} → realistically ${F.h(tot('plannedAdj'))}`),
        items: teams.slice(0, 8).map((t) => ({ text: t.name, sub: T(L, `Raum Ø ${F.h(t.avg.room)} · realistisch geplant Ø ${F.h(t.avg.plannedAdj)}${t.overWeeks ? ` · ${t.overWeeks} Wochen über 100 %` : ''}`, `room avg ${F.h(t.avg.room)} · realistically planned avg ${F.h(t.avg.plannedAdj)}${t.overWeeks ? ` · ${t.overWeeks} weeks above 100 %` : ''}`), tone: t.overWeeks ? 'bad' : 'ok' })), itemsTitle: 'Teams' },
      tone: over.length ? 'warn' : 'ok', needsHistory: true,
    };
  },

  fitsNoOvertime(ctx, p, L, F) {
    const rc = rcOf(ctx, L);
    const teams = p.team ? rc.teams.filter((t) => t.teamId === p.team.id) : rc.teams;
    const n = rc.weeks.length;
    const title = p.team ? T(L, `Was ${p.team.name} ohne Überstunden schafft`, `What ${p.team.name} manages without overtime`) : T(L, 'Was passt ohne Überstunden', 'What fits without overtime');
    // per project over all teams: fits only if it fits in every team that has work for it
    const byRef = new Map();
    for (const t of teams) for (const r of t.projects) {
      if (!(r.plannedAdj > 0)) continue;
      const e = byRef.get(r.ref) || byRef.set(r.ref, { ref: r.ref, rank: r.rank, name: r.name, planned: 0, plannedAdj: 0, fitHours: 0, teams: [] }).get(r.ref);
      e.planned += r.planned; e.plannedAdj += r.plannedAdj; e.fitHours += r.fitHours; e.teams.push({ name: t.name, fits: r.fits, explain: r.explain });
    }
    const rows = [...byRef.values()].map((e) => ({ ...e, fits: e.teams.every((x) => x.fits === 'ok') ? 'ok' : e.teams.every((x) => x.fits === 'no') ? 'no' : 'partial' }))
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || String(a.ref).localeCompare(String(b.ref)));
    const nm = (r) => (r.ref === '_none' ? T(L, 'Ohne Projekt', 'No project') : r.rank != null ? `#${r.rank} ${r.name || r.ref}` : r.name || r.ref);
    const fitName = (f) => ({ ok: T(L, 'passt', 'fits'), partial: T(L, 'teilweise', 'partly'), no: T(L, 'passt nicht', 'does not fit') }[f]);
    const ok = rows.filter((r) => r.fits === 'ok').length;
    const first = rows.find((r) => r.fits !== 'ok');
    const room = teams.reduce((a, t) => a + t.totals.room, 0), need = teams.reduce((a, t) => a + t.totals.plannedAdj, 0);
    const info = { title, text: T(L, `Die Wasserlinie auf der realistischen Kapazität: je Team wird der Raum für Projekte (verfügbar minus Support-P80) über ${n} Wochen nach Rang mit der realistisch geschätzten Arbeit (Restschätzung × Schätzfaktor) gefüllt. Ein Projekt passt, wenn es in jedem beteiligten Team noch Platz hat.`, `The waterline on realistic capacity: per team the room for projects (available minus support P80) over ${n} weeks is filled in rank order with the realistically estimated work (remaining estimate × estimate factor). A project fits when it has room in every team involved.`),
      calc: T(L, `Raum ${F.h(room)} · realistisch geplant ${F.h(need)} · ${ok} von ${rows.length} Projekten passen`, `Room ${F.h(room)} · realistically planned ${F.h(need)} · ${ok} of ${rows.length} projects fit`),
      inputs: [...periodInputs(rc, L, F), ...historyInputs(ctx, L)], items: teams.slice(0, 8).map((t) => ({ text: t.name, sub: T(L, `Raum ${F.h(t.totals.room)}, geplant ${F.h(t.totals.plannedAdj)} – ${t.fitCount} Projekte passen${t.waterRank != null ? `, ab Rang #${t.waterRank} nicht mehr` : ''}`, `room ${F.h(t.totals.room)}, planned ${F.h(t.totals.plannedAdj)} – ${t.fitCount} projects fit${t.waterRank != null ? `, not from rank #${t.waterRank}` : ''}`), tone: t.waterRank != null ? 'warn' : 'ok' })), itemsTitle: 'Teams' };
    if (!rows.length) return { title, answer: T(L, `In den nächsten ${n} Wochen ist keine Arbeit geplant – es passt alles.`, `No work is planned in the next ${n} weeks – everything fits.`), views: ['text'], data: {}, tone: 'ok', info, desc: '', needsHistory: true };
    const prev = first ? rows[rows.indexOf(first) - 1] : null;
    // fits over the whole period, but single weeks are too full: say so – the work needs spreading, not cutting
    const tight = teams.filter((t) => t.overWeeks > 0).map((t) => t.name);
    return {
      title,
      answer: !first ? T(L, `Alle ${rows.length} Projekte passen in den nächsten ${n} Wochen ohne Überstunden${tight.length ? ` – nur einzelne Wochen sind zu voll (${tight.join(', ')}), dort die Arbeit zeitlich verteilen` : ''}.`, `All ${rows.length} projects fit in the next ${n} weeks without overtime${tight.length ? ` – only single weeks are too full (${tight.join(', ')}); spread the work there` : ''}.`)
        : T(L, `${prev ? `Bis ${nm(prev)} passt alles ohne Überstunden; ab` : 'Schon ab'} ${nm(first)} reicht die realistische Zeit nicht mehr (${ok} von ${rows.length} Projekten passen).`, `${prev ? `Up to ${nm(prev)} everything fits without overtime; from` : 'Already from'} ${nm(first)} the realistic time runs out (${ok} of ${rows.length} projects fit).`),
      desc: T(L, 'Projekte nach Rang: grün passt ohne Überstunden, gelb nur teilweise, rot nicht mehr – gemessen am realistischen Raum der Teams.', 'Projects by rank: green fits without overtime, amber only partly, red no longer – measured against the teams\' realistic room.'),
      views: ['list', 'bar', 'number', 'table'],
      data: {
        list: rows.map((r) => ({ text: nm(r), sub: `${fitName(r.fits)} · ${T(L, `${F.h(r.plannedAdj)} realistisch`, `${F.h(r.plannedAdj)} realistic`)}${r.fits === 'partial' ? T(L, ` · ${F.h(r.fitHours)} haben Platz`, ` · ${F.h(r.fitHours)} have room`) : ''} · ${r.teams.map((x) => x.name).join(', ')}`, tone: r.fits === 'ok' ? 'ok' : r.fits === 'partial' ? 'warn' : 'bad', ref: r.ref !== '_none' ? r.ref : undefined })),
        series: rows.map((r) => ({ label: nm(r), value: r.plannedAdj, tone: r.fits === 'ok' ? 'ok' : r.fits === 'partial' ? 'warn' : 'bad', ref: r.ref !== '_none' ? r.ref : undefined, card: { text: r.teams.map((x) => x.explain).join(' '), inputs: [[T(L, 'Geplant (Restschätzung)', 'Planned (remaining)'), F.h(r.planned)], [T(L, 'Realistisch', 'Realistic'), F.h(r.plannedAdj)], [T(L, 'Davon mit Platz', 'Of which with room'), F.h(r.fitHours)]] } })), unit: 'h',
        number: { value: ok, unit: 'n', foot: T(L, `von ${rows.length} Projekten passen ohne Überstunden`, `of ${rows.length} projects fit without overtime`), tone: first ? 'warn' : 'ok' },
        table: { head: [T(L, 'Rang', 'Rank'), T(L, 'Projekt', 'Project'), T(L, 'Geplant', 'Planned'), T(L, 'Realistisch', 'Realistic'), T(L, 'Mit Platz', 'With room'), 'Status', 'Teams'], rows: rows.map((r) => [r.rank != null ? `#${r.rank}` : '–', r.name || r.ref, F.h(r.planned), F.h(r.plannedAdj), F.h(r.fitHours), fitName(r.fits), r.teams.map((x) => x.name).join(', ')]) },
      },
      info, tone: first ? 'warn' : 'ok', needsHistory: true,
    };
  },

  overtime(ctx, p, L, F) {
    const rc = rcOf(ctx, L);
    const oo = ooOf(ctx, L);
    const n = rc.weeks.length;
    const teams = p.team ? oo.teams.filter((t) => t.teamId === p.team.id) : oo.teams;
    const people = (p.team ? oo.people.filter((x) => x.teamId === p.team.id) : oo.people);
    const who = (x) => x.name || T(L, 'Kolleg:in (anonym)', 'Colleague (anonymous)');
    const title = p.team ? T(L, `Überstunden-Ausblick: ${p.team.name}`, `Overtime outlook: ${p.team.name}`) : T(L, 'Überstunden-Ausblick', 'Overtime outlook');
    const moveText = (m) => `${m.rank != null ? `#${m.rank} ` : ''}${m.name || T(L, 'ohne Projekt', 'no project')} (${F.h(m.hours)})`;
    const info = { title, text: T(L, `Wer in den nächsten ${n} Wochen über 100 % der realistischen Zeit geplant ist: realistisch geplante Arbeit (Restschätzung × Schätzfaktor) größer als der Raum nach Support (P80). Zum Verschieben vorgeschlagen wird die Arbeit mit dem niedrigsten Rang in genau diesen Wochen, bis die Überstunden gedeckt sind.`, `Who is planned above 100 % of the realistic time in the next ${n} weeks: realistically planned work (remaining estimate × estimate factor) above the room after support (P80). Proposed to move: the lowest-ranked work in exactly those weeks, until the overtime is covered.`),
      calc: teams.length ? teams.slice(0, 3).map((t) => `${t.name}: ${t.overWeeks.map((w) => F.h(w.hours)).join(' + ')} = ${F.h(t.hours)}`).join(' · ') : T(L, 'keine Woche über 100 %', 'no week above 100 %'),
      inputs: [...periodInputs(rc, L, F), ...historyInputs(ctx, L)], items: [...teams, ...people].slice(0, 8).map((x) => ({ text: x.name ? x.name : who(x), sub: x.explain, tone: 'bad' })) };
    if (!teams.length && !people.length) return { title, answer: T(L, `In den nächsten ${n} Wochen ist niemand über 100 % der realistischen Zeit geplant – keine Überstunden in Sicht.`, `Nobody is planned above 100 % of the realistic time in the next ${n} weeks – no overtime in sight.`), views: ['text'], data: {}, tone: 'ok', info, desc: '', needsHistory: true };
    const lead = teams[0] || people[0];
    const weeksIdx = rc.weeks.map((w) => w.from);
    const units = teams.length ? teams : people;
    return {
      title,
      answer: T(L, `${lead.name ? lead.name : who(lead)} ist in ${lead.overWeeks.length} von ${n} Wochen über 100 % (${F.h(lead.hours)} zu viel)${lead.move.length ? ` – zuerst verschieben: ${lead.move.slice(0, 2).map(moveText).join(', ')}` : ''}.${teams.length + people.length > 1 ? T(L, ` Insgesamt ${teams.length} ${teams.length === 1 ? 'Team' : 'Teams'} und ${people.length} ${people.length === 1 ? 'Person' : 'Personen'} betroffen.`, '') : ''}`,
        `${lead.name ? lead.name : who(lead)} is above 100 % in ${lead.overWeeks.length} of ${n} weeks (${F.h(lead.hours)} too much)${lead.move.length ? ` – move first: ${lead.move.slice(0, 2).map(moveText).join(', ')}` : ''}.${teams.length + people.length > 1 ? ` ${teams.length} ${teams.length === 1 ? 'team' : 'teams'} and ${people.length} ${people.length === 1 ? 'person' : 'people'} affected in total.` : ''}`),
      desc: T(L, 'Säulen: Stunden über der realistischen Zeit je Woche; die Liste nennt die Arbeit mit dem niedrigsten Rang, die man verschieben kann.', 'Columns: hours above the realistic time per week; the list names the lowest-ranked work that can be moved.'),
      views: ['list', 'columns', 'number', 'table'],
      data: {
        list: [...[...teams, ...people.slice(0, 6)].map((u) => ({ text: u.teamId && !u.id ? u.name : who(u), sub: T(L, `${u.overWeeks.length} von ${n} Wochen über 100 % · ${F.h(u.hours)} zu viel${u.peakLoad != null ? ` · Spitze ${F.pct(u.peakLoad)}` : ''}`, `${u.overWeeks.length} of ${n} weeks above 100 % · ${F.h(u.hours)} too much${u.peakLoad != null ? ` · peak ${F.pct(u.peakLoad)}` : ''}`), tone: u.id ? 'warn' : 'bad', ...(u.id ? {} : { go: 'capacity' }) })),
          ...units.flatMap((u) => u.move.filter((m) => m.ref && m.ref !== '_none').map((m) => ({ text: T(L, `Verschieben: ${moveText(m)}`, `Move: ${moveText(m)}`), sub: T(L, `entlastet ${u.name || who(u)}`, `relieves ${u.name || who(u)}`), tone: 'ink', ref: m.ref }))).slice(0, 8)],
        columns: { labels: weeksIdx.map((d) => F.date(d)), series: units.slice(0, 6).map((u, i) => ({ name: u.name || who(u), values: weeksIdx.map((d) => u.overWeeks.find((w) => w.from === d)?.hours || 0), color: ['var(--bad)', 'var(--warn)', 'var(--accent)', 'var(--ink)', '#3D5BA6', '#8F8B82'][i] })), unit: 'h' },
        number: { value: teams.length ? oo.hours : people.reduce((a, x) => a + x.hours, 0), unit: 'h', foot: teams.length ? T(L, `Überstunden in ${teams.length} ${teams.length === 1 ? 'Team' : 'Teams'} (${n} Wochen)`, `overtime in ${teams.length} ${teams.length === 1 ? 'team' : 'teams'} (${n} weeks)`) : T(L, 'Überstunden einzelner Personen', 'overtime of individual people'), tone: 'bad' },
        table: { head: [T(L, 'Wer', 'Who'), T(L, 'Wochen > 100 %', 'Weeks > 100 %'), T(L, 'Spitze', 'Peak'), T(L, 'Zu viel', 'Too much'), T(L, 'Verschieben', 'Move')], rows: [...teams, ...people].map((u) => [u.name || who(u), String(u.overWeeks.length), u.peakLoad != null ? F.pct(u.peakLoad) : '–', F.h(u.hours), u.move.map(moveText).join(', ') || '–']) },
      },
      info, tone: 'bad', needsHistory: true,
    };
  },

  similarWork(ctx, p, L, F) {
    const subject = (p.subject || '').trim() || (p.project ? p.project.name : '');
    const title = subject ? T(L, `Wie früher: ${subject.slice(0, 60)}`, `Like before: ${subject.slice(0, 60)}`) : T(L, 'Schätzen wie früher', 'Estimate like before');
    const pool = poolOf(ctx);
    const info0 = { title, text: T(L, 'Sucht erledigte Stories mit ähnlichem Titel (Textähnlichkeit, plus Team, Typ und Komponente) und zeigt, was sie wirklich gekostet haben: gebuchte Stunden, Überzug gegenüber der Schätzung und Dauer. Kommentare werden nur gezählt.', 'Finds finished stories with a similar summary (text similarity, plus team, type and component) and shows what they really took: logged hours, overrun against the estimate and duration. Comments are only counted.'),
      inputs: [[T(L, 'Gesucht', 'Looking for'), subject || '–'], [T(L, 'Vergleichsmenge', 'Compared with'), T(L, `${pool.length} erledigte Stories`, `${pool.length} finished stories`)], ...historyInputs(ctx, L)] };
    if (!subject) return { title, answer: T(L, 'Schreib dazu, was geschätzt werden soll – z. B. „Ich will schätzen wie früher: Schnittstelle zum Lager-System“.', 'Add what should be estimated – e.g. "I want to estimate like before: interface to the warehouse system".'), views: ['text'], data: {}, tone: 'muted', info: info0, desc: '', needsHistory: true };
    const sw = similarWork({ summary: subject }, pool, { limit: 8, lang: L });
    const s = sw.stats;
    const info = { ...info0, calc: s.n ? T(L, `Median der gebuchten Stunden von ${s.withActual} ähnlichen: ${F.h(s.medianActualH)} · P80 ${F.h(s.p80ActualH)}${s.typicalOverrunPct != null ? ` · Überzug Median ${s.typicalOverrunPct} % (${s.overrunN} mit Schätzung)` : ''}`, `Median logged hours of ${s.withActual} similar: ${F.h(s.medianActualH)} · P80 ${F.h(s.p80ActualH)}${s.typicalOverrunPct != null ? ` · median overrun ${s.typicalOverrunPct} % (${s.overrunN} with an estimate)` : ''}`) : T(L, 'Keine ähnliche erledigte Arbeit', 'No similar finished work'),
      inputs: [...info0.inputs, [T(L, 'Sicherheit', 'Confidence'), confName(sw.confidence, L)]] };
    const oTone = (o) => (o == null ? 'ink' : o > 25 ? 'bad' : o > 0 ? 'warn' : 'ok');
    const sub = (x) => [T(L, `${F.h(x.actualH)} gebucht`, `${F.h(x.actualH)} logged`), x.estimateH != null ? T(L, `geschätzt ${F.h(x.estimateH)}${x.overrunPct != null ? ` (${x.overrunPct > 0 ? '+' : ''}${x.overrunPct} %)` : ''}`, `estimated ${F.h(x.estimateH)}${x.overrunPct != null ? ` (${x.overrunPct > 0 ? '+' : ''}${x.overrunPct} %)` : ''}`) : null,
      x.durationWorkdays != null ? T(L, `${x.durationWorkdays} Arbeitstage`, `${x.durationWorkdays} working days`) : null, T(L, `${Math.round(x.score * 100)} % ähnlich`, `${Math.round(x.score * 100)} % similar`), x.comments ? T(L, `${x.comments} Kommentare`, `${x.comments} comments`) : null].filter(Boolean).join(' · ');
    return {
      title, answer: sw.explain,
      desc: T(L, 'Ähnliche erledigte Arbeit: was sie wirklich gekostet hat – gebuchte Stunden, Überzug gegenüber der Schätzung und Dauer.', 'Similar finished work: what it really took – logged hours, overrun against the estimate and duration.'),
      views: s.n ? ['number', 'list', 'bar', 'table'] : ['text'],
      data: {
        number: s.medianActualH != null ? { value: s.medianActualH, unit: 'h', foot: T(L, `typischer Aufwand (Median) · P80 ${F.h(s.p80ActualH)}${s.typicalOverrunPct != null ? ` · typisch ${s.typicalOverrunPct > 0 ? '+' : ''}${s.typicalOverrunPct} % zur Schätzung` : ''}${s.medianDurationWorkdays != null ? ` · ${s.medianDurationWorkdays} Arbeitstage` : ''}`, `typical effort (median) · P80 ${F.h(s.p80ActualH)}${s.typicalOverrunPct != null ? ` · typically ${s.typicalOverrunPct > 0 ? '+' : ''}${s.typicalOverrunPct} % vs estimate` : ''}${s.medianDurationWorkdays != null ? ` · ${s.medianDurationWorkdays} working days` : ''}`) } : null,
        list: sw.items.map((x) => ({ text: `${x.key} ${x.summary}`, sub: sub(x), tone: oTone(x.overrunPct), key: x.key })),
        series: sw.items.map((x) => ({ label: x.key, value: x.actualH, tone: oTone(x.overrunPct), card: { text: x.summary, inputs: [[T(L, 'Gebucht', 'Logged'), F.h(x.actualH)], [T(L, 'Geschätzt', 'Estimated'), x.estimateH != null ? F.h(x.estimateH) : '–'], [T(L, 'Überzug', 'Overrun'), x.overrunPct != null ? `${x.overrunPct} %` : '–'], [T(L, 'Ähnlichkeit', 'Similarity'), `${Math.round(x.score * 100)} %`]] } })), unit: 'h',
        table: { head: ['Key', T(L, 'Vorgang', 'Work item'), T(L, 'Gebucht', 'Logged'), T(L, 'Geschätzt', 'Estimated'), T(L, 'Überzug', 'Overrun'), T(L, 'Dauer', 'Duration'), T(L, 'Ähnlich', 'Similar')], rows: sw.items.map((x) => [x.key, x.summary, F.h(x.actualH), x.estimateH != null ? F.h(x.estimateH) : '–', x.overrunPct != null ? `${x.overrunPct} %` : '–', x.durationWorkdays != null ? T(L, `${x.durationWorkdays} AT`, `${x.durationWorkdays} wd`) : '–', `${Math.round(x.score * 100)} %`]) },
        similar: { subject, items: sw.items.map((x) => ({ id: x.id, key: x.key, summary: x.summary, actualH: x.actualH, estimateH: x.estimateH, overrunPct: x.overrunPct, days: x.durationWorkdays, comments: x.comments })), stats: s },
      },
      info, tone: sw.confidence === 'low' ? 'muted' : 'ok', needsHistory: true,
    };
  },

  supportTopics(ctx, p, L, F) {
    const tickets = ticketsOf(ctx);
    const title = T(L, 'Wiederkehrende Support-Themen', 'Recurring support topics');
    if (!tickets.length) return { title, answer: T(L, 'Es sind keine Support-Tickets verbunden – ein Jira-Admin richtet das unter Konfiguration › Support & SLAs ein.', 'No support tickets are connected – a Jira admin sets this up under Configuration › Support & SLAs.'), views: ['text'], data: {}, tone: 'muted', desc: '', needsHistory: true };
    const st = supportTopicsOf(ctx, L);
    const trendName = (t) => ({ rising: T(L, 'steigend', 'rising'), falling: T(L, 'fallend', 'falling'), stable: T(L, 'stabil', 'stable'), new: T(L, 'neu', 'new') }[t] || t);
    const topics = st.topics.slice(0, 14);
    const pb = st.topics.filter((x) => x.playbook);
    return {
      title, answer: st.explain,
      desc: T(L, 'Themen, die im Support immer wieder kommen – mit Anzahl, Zeitaufwand und Tendenz. Markierte lohnen ein Playbook mit Standardantwort.', 'Topics that keep coming back in support – with count, time and trend. Marked ones are worth a playbook with a standard reply.'),
      views: topics.length ? ['list', 'bar', 'table', 'number'] : ['text'],
      data: {
        list: topics.map((x) => ({ text: `${x.name}${x.playbook ? T(L, ' · Playbook-Kandidat', ' · playbook candidate') : ''}`, sub: T(L, `${x.count} Tickets · ${F.h(x.spentTotal)} · Median ${F.h(x.spentMedian, 1)} · ${trendName(x.trend)}${x.open ? ` · ${x.open} offen` : ''}`, `${x.count} tickets · ${F.h(x.spentTotal)} · median ${F.h(x.spentMedian, 1)} · ${trendName(x.trend)}${x.open ? ` · ${x.open} open` : ''}`), tone: x.trend === 'rising' ? 'bad' : x.playbook ? 'warn' : 'ink', go: 'support:playbooks' })),
        series: topics.map((x) => ({ label: x.name, value: x.count, tone: x.trend === 'rising' ? 'bad' : x.playbook ? 'warn' : 'ink', card: { text: x.explain, inputs: [[T(L, 'Tickets', 'Tickets'), String(x.count)], [T(L, 'Zeit gesamt', 'Time total'), F.h(x.spentTotal)], [T(L, 'Letzte 4 Wochen', 'Last 4 weeks'), String(x.recent)], [T(L, 'Beispiele', 'Examples'), x.exampleKeys.slice(0, 3).join(', ') || '–']] } })), unit: 'n',
        table: { head: [T(L, 'Thema', 'Topic'), 'Tickets', T(L, 'Zeit', 'Time'), 'Median', T(L, 'Tendenz', 'Trend'), T(L, 'Offen', 'Open'), T(L, 'Beispiele', 'Examples'), 'Playbook'], rows: topics.map((x) => [x.name, String(x.count), F.h(x.spentTotal), F.h(x.spentMedian, 1), trendName(x.trend), String(x.open), x.exampleKeys.slice(0, 3).join(', '), x.playbook ? T(L, 'ja', 'yes') : '–']) },
        number: { value: pb.length, unit: 'n', foot: T(L, `Playbook-Kandidaten · zusammen ${F.h(pb.reduce((a, x) => a + x.spentTotal, 0))}`, `playbook candidates · ${F.h(pb.reduce((a, x) => a + x.spentTotal, 0))} in total`), tone: pb.length ? 'warn' : 'ok' },
      },
      info: { title, text: T(L, 'Tickets werden nach ihrem wichtigsten wiederkehrenden Wort im Titel gruppiert (sonst nach Anfragetyp, Komponente oder Label). Ein Thema ab 3 Tickets und 2 h Aufwand ist ein Kandidat für eine Standardantwort oder einen Hilfeartikel. Tendenz: letzte 4 Wochen gegen den Durchschnitt davor.', 'Tickets are grouped by the most important recurring word in their summary (otherwise by request type, component or label). A topic with 3+ tickets and 2+ h of effort is a candidate for a standard reply or help article. Trend: last 4 weeks against the average before.'),
        calc: T(L, `${st.topics.length} Themen in ${st.tickets} Tickets · ${pb.length} Kandidaten`, `${st.topics.length} topics in ${st.tickets} tickets · ${pb.length} candidates`), inputs: historyInputs(ctx, L), items: pb.slice(0, 8).map((x) => ({ text: x.name, sub: x.explain, tone: 'warn' })), itemsTitle: T(L, 'Playbook-Kandidaten', 'Playbook candidates') },
      tone: pb.length ? 'warn' : 'ok', needsHistory: true,
    };
  },
};

// ---------- helpers of the "Ich will …" cards ----------
// One insights computation per data state (computed × history × language) – several cards share it.
const insightCache = new WeakMap();
function insightsOf(ctx, L) {
  const c = ctx.computed;
  let e = insightCache.get(c);
  if (!e || e.history !== (ctx.history || null) || e.lang !== L) { e = { history: ctx.history || null, lang: L }; insightCache.set(c, e); }
  return e;
}
const rcOf = (ctx, L) => { const e = insightsOf(ctx, L); return e.rc || (e.rc = realisticCapacity(ctx.computed, { weeks: 12, history: ctx.history || null, planActual: ctx.planActual || null, lang: L })); };
const ooOf = (ctx, L) => { const e = insightsOf(ctx, L); return e.oo || (e.oo = overtimeOutlook(rcOf(ctx, L), { lang: L })); };
const supportTopicsOf = (ctx, L) => { const e = insightsOf(ctx, L); return e.st || (e.st = supportTopics(ticketsOf(ctx), { minCount: 3, lang: L, today: ctx.computed.model.ds?.today || ctx.ds?.today || null })); };
// Done stories: the loaded history plus the done stories already in the dataset (deduplicated by id inside similarWork's pool).
// Both lists are built once per data state (the dataset's array × the history's array) and frozen: every Lotse question
// used to rebuild them (20k tickets, 30k stories), and a stable array lets insights cache its index and topics.
const NO_HISTORY = [];
const listCache = new WeakMap(); // source array → WeakMap(history array → frozen list)
function cachedList(src, hist, build) {
  const a = src || NO_HISTORY, h = hist || NO_HISTORY;
  const m = listCache.get(a) || listCache.set(a, new WeakMap()).get(a);
  let e = m.get(h);
  // a list changed in place (same array, other length) is built again
  if (!e || e.n !== a.length || e.hn !== h.length) { e = { n: a.length, hn: h.length, out: Object.freeze(build()) }; m.set(h, e); }
  return e.out;
}
export function poolOf(ctx) {
  const issues = ctx.computed?.model?.ds?.issues || ctx.ds?.issues || null;
  return cachedList(issues, ctx.history?.stories || null, () => {
    const seen = new Set(), out = [];
    for (const s of [...(ctx.history?.stories || []), ...(issues || []).filter((i) => i.role === 'estimate' && (i.status?.cat ?? i.statusCat) === 'done')]) {
      const k = s.id ?? s.key; if (k == null || seen.has(k)) continue; seen.add(k); out.push(s);
    }
    return out;
  });
}
// Support tickets: resolved ones from the history plus the open/recent ones of the dataset.
export function ticketsOf(ctx) {
  const tickets = (ctx.ds || ctx.computed?.model?.ds)?.supportTickets?.tickets || null;
  return cachedList(tickets, ctx.history?.support || null, () => {
    const seen = new Set(), out = [];
    for (const t of [...(ctx.history?.support || []), ...(tickets || [])]) {
      const k = t?.id ?? t?.key; if (k == null || seen.has(k)) continue; seen.add(k); out.push(t);
    }
    return out;
  });
}
const fmtFactor = (f, L) => `×${(Math.round((+f || 1) * 100) / 100).toLocaleString(L === 'de' ? 'de-DE' : 'en-GB')}`;
const factorSource = (e, L) => ({ team: T(L, `aus ${e.n} Stories des Teams`, `from ${e.n} of the team's stories`), all: T(L, `aus ${e.n} Stories aller Teams`, `from ${e.n} stories of all teams`), none: T(L, 'noch zu wenig Daten – 1', 'not enough data yet – 1') }[e.source] || e.source);
const confName = (c, L) => ({ high: T(L, 'hoch', 'high'), medium: T(L, 'mittel', 'medium'), low: T(L, 'niedrig', 'low') }[c] || T(L, 'niedrig', 'low'));
function periodInputs(rc, L, F) {
  return [[T(L, 'Zeitraum', 'Period'), T(L, `${rc.weeks.length} Wochen ab ${F.date(rc.weeks[0]?.from)}`, `${rc.weeks.length} weeks from ${F.date(rc.weeks[0]?.from)}`)],
    [T(L, 'Schätzfaktor gesamt', 'Overall estimate factor'), rc.estimate.factor != null ? T(L, `${fmtFactor(rc.estimate.factor, L)} aus ${rc.estimate.n} Stories`, `${fmtFactor(rc.estimate.factor, L)} from ${rc.estimate.n} stories`) : T(L, 'noch keine erledigten Stories mit Schätzung', 'no finished stories with an estimate yet')]];
}
function historyInputs(ctx, L) {
  const h = ctx.history;
  if (h) return [[T(L, 'Verlauf', 'History'), T(L, `${(h.stories || []).length} erledigte Stories · ${(h.support || []).length} gelöste Tickets${h.months ? ` · ${h.months} Monate` : ''}`, `${(h.stories || []).length} finished stories · ${(h.support || []).length} resolved tickets${h.months ? ` · ${h.months} months` : ''}`)]];
  return [[T(L, 'Verlauf', 'History'), ctx.historyState === 'loading' ? T(L, 'wird geladen – vorerst nur aktuelle Daten', 'loading – current data only for now') : ctx.historyState === 'error' ? T(L, 'nicht verfügbar – nur aktuelle Daten', 'not available – current data only') : T(L, 'nur aktuelle Daten', 'current data only')]];
}

// Answer a question. Returns null when the question cannot be mapped (the UI then asks the AI).
// ctx: { computed, ds, me, roles, lang, fmt, ruleName, supportA, cal }
// opts.force = { intent, team, project, text } – a card chosen by the optional AI intent parser (already validated
// against WISH_CARDS and the user's own teams/projects); the card then says "KI" as its source.
export function answer(question, ctx, opts = {}) {
  const L = ctx.lang || 'de';
  const quarters = ctx.computed?.wl?.quarters || [];
  const p = parseQuestion(question, { model: ctx.computed.model, quarters });
  const f = opts.force;
  if (f && WISH_IDS.has(f.intent) && RECIPES[f.intent]) {
    p.intent = f.intent;
    if (f.team) p.team = ctx.computed.model.teams.get(f.team) || p.team;
    if (f.project) p.project = ctx.computed.model.itemByRef.get(f.project) || p.project;
    if (typeof f.text === 'string' && f.text.trim()) p.subject = f.text.trim().slice(0, 200);
    else if (f.intent === 'similarWork' && !p.subject) p.subject = wishSubject(question);
  }
  const source = f && p.intent === f.intent ? 'ai' : 'rule';
  if (p.intent === 'guard') {
    return { intent: 'guard', title: T(L, 'Keine Bewertung von Personen', 'No rating of individuals'), answer: T(L, 'Das Cockpit bewertet keine einzelnen Personen. Frag nach Teams, Projekten oder Kapazität – zum Beispiel „Welche Teams sind überlastet?".', 'The cockpit does not rate individual people. Ask about teams, projects or capacity – for example "Which teams are overloaded?".'), views: ['text'], data: {}, tone: 'muted', parsed: p };
  }
  const fn = p.intent && RECIPES[p.intent];
  if (!fn || (p.intent === 'project' && !p.project)) return null;
  const card = fn(ctx, p, L, ctx.fmt);
  const views = card.views.filter((v) => v === 'text' || hasData(card, v));
  const view = p.view && views.includes(p.view) ? p.view : views[0] || 'text';
  return { intent: p.intent, ...card, views: views.length ? views : ['text'], view, source, parsed: { intent: p.intent, project: p.project?.ref || null, team: p.team?.id || null, quarter: p.quarter, ...(p.subject ? { subject: p.subject } : {}) } };
}
// For a question the cockpit cannot map: the closest questions it CAN answer (shared words, then the
// suggestions for this person), so there is never a dead end and nothing is guessed.
export function closestQuestions(question, ctx, n = 4) {
  const L = ctx.lang || 'de';
  const STOP = new Set(['the', 'and', 'are', 'how', 'what', 'which', 'who', 'with', 'for', 'our', 'too', 'much', 'many', 'der', 'die', 'das', 'und', 'ist', 'sind', 'wie', 'was', 'wer', 'welche', 'welcher', 'mit', 'fuer', 'unsere', 'zu', 'viel', 'viele', 'eine', 'ein', 'den', 'dem',
    'ich', 'will', 'moechte', 'brauche', 'wir', 'wollen', 'zeig', 'zeige', 'mir', 'uns', 'want', 'need', 'show', 'wissen', 'know', 'see', 'sehen', 'mal', 'bitte', 'please']);
  const toks = (x) => fixTypos(fold(x).replace(/[^a-z0-9 ]+/g, ' ')).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
  const words = new Set(toks(question));
  const same = (x, w) => x === w || (x.length >= 4 && w.length >= 4 && x.slice(0, Math.min(5, x.length, w.length)) === w.slice(0, Math.min(5, x.length, w.length)));
  const pool = [...suggestions({ computed: ctx.computed, roles: ctx.roles || {}, me: ctx.me, lang: L, supportA: ctx.supportA, hasSupport: !!(ctx.supportA || ctx.computed?.support) }).map((x) => x.q),
    ...wishStarters(L, true).map((x) => x.q),
    T(L, 'Wie ausgelastet sind die Teams?', 'How busy are the teams?'), T(L, 'Wie belastbar sind die Zahlen (Reife)?', 'How reliable are the numbers (maturity)?'), T(L, 'Was ist blockiert?', 'What is blocked?'),
    T(L, 'Schätzung gegen gebuchte Zeit', 'Estimate vs logged time'), T(L, 'Portfolio nach Rang', 'Portfolio by rank'), T(L, 'Was ist überfällig?', 'What is overdue?')];
  const score = (cand) => toks(cand).filter((w) => [...words].some((x) => same(x, w))).length;
  return [...new Set(pool)].map((q, i) => ({ q, s: score(q) * 10 - i * 0.01 })).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.q);
}

export function hasData(card, v) {
  const d = card.data || {};
  switch (v) {
    case 'number': return !!d.number;
    case 'list': return (d.list || []).length > 0;
    case 'table': return (d.table?.rows || []).length > 0;
    case 'bar': return (d.series || []).length > 0;
    case 'donut': return (d.parts || []).some((x) => x.value > 0);
    case 'columns': return (d.columns?.labels || []).length > 0;
    case 'line': return (d.line?.labels || []).length > 1;
    case 'heat': return (d.heat?.rows || []).length > 0;
    case 'graph': return (d.graph?.nodes || []).length > 1;
    default: return true;
  }
}

// Support analytics for the Ask canvas (same numbers as the Support view).
export function supportFor(ds, computed) {
  const tickets = ds?.supportTickets?.tickets;
  if (!tickets) return null;
  const cfg = ds.config?.support || {};
  const { model } = computed;
  const rootOf = (id) => model.byId.get(id)?.rootRef || (model.itemByRef.has(`issue:${id}`) ? `issue:${id}` : null);
  return supportAnalytics(tickets, { cal: cfg.sla || undefined, target: (cfg.slaTargetPct ?? 95) / 100, rootOf });
}

// "Ich will …" starters: the wishes the cockpit answers best (first on an empty canvas and as closest suggestions).
export const WISH_GROUP = { de: 'Ich will …', en: 'I want …' };
export function wishStarters(lang = 'de', hasSupport = true) {
  const L = lang, group = T(L, WISH_GROUP.de, WISH_GROUP.en);
  return [
    { q: T(L, 'Ich will Ressourcen realistisch planen', 'I want to plan resources realistically'), icon: 'gauge', card: 'realCapacity' },
    { q: T(L, 'Ich will wissen, ob wir das ohne Überstunden schaffen', 'I want to know what fits without overtime'), icon: 'waves', card: 'fitsNoOvertime' },
    { q: T(L, 'Ich will Überstunden vermeiden', 'I want to avoid overtime'), icon: 'alert', card: 'overtime' },
    { q: T(L, 'Ich will schätzen wie früher: ', 'I want to estimate like before: '), icon: 'clock', card: 'similarWork', fill: true },
    ...(hasSupport ? [{ q: T(L, 'Ich will wiederkehrende Support-Themen sehen', 'I want to see recurring support topics'), icon: 'headset', card: 'supportTopics' }] : []),
  ].map((x) => ({ ...x, group }));
}

// Suggested questions: by role first, then what the data currently shows.
export function suggestions({ computed, roles = {}, me, lang = 'de', supportA, hasSupport }) {
  const L = lang;
  const out = [];
  const add = (group, q, icon) => { if (!out.some((x) => x.q === q)) out.push({ group, q, icon }); };
  const g = { you: T(L, 'Für dich', 'For you'), now: T(L, 'Gerade auffällig', 'Worth a look now'), more: T(L, 'Weitere Fragen', 'More questions') };
  if (!computed) return out;
  for (const w of wishStarters(L, hasSupport || !!supportA)) add(w.group, w.q, w.icon);
  const { model, wl, deps, dq } = computed;
  const mine = me?.id ? model.items.filter((x) => x.owner?.id === me.id) : [];
  add(g.you, T(L, 'Was braucht jetzt meine Aufmerksamkeit?', 'What needs my attention now?'), 'zap');
  if (roles.viewReport || roles.manageRanking) {
    add(g.you, T(L, 'Ab welchem Rang reicht die Kapazität nicht mehr?', 'From which rank does capacity run out?'), 'waves');
    add(g.you, T(L, 'Wie ist die Health der Projekte?', 'How is the health of the projects?'), 'heart');
  }
  if (mine.length) add(g.you, T(L, `Wie weit ist ${mine[0].name}?`, `How far along is ${mine[0].name}?`), 'project');
  if (roles.editCapacity) add(g.you, T(L, 'Welche Teams sind überlastet?', 'Which teams are overloaded?'), 'gauge');
  if (roles.admin || roles.manageSettings) add(g.you, T(L, 'Wo fehlen Daten?', 'Where is data missing?'), 'shield');
  if (hasSupport) add(g.you, T(L, 'Wie stehen Support und SLAs?', 'How are support and SLAs doing?'), 'headset');
  // data-driven
  const q0 = wl.quarters[0];
  const over = wl.teamIds.filter((t) => (wl.cells[t]?.[q0]?.util || 0) > 1.0001).map((t) => model.teams.get(t)?.name).filter(Boolean);
  if (over[0]) add(g.now, T(L, `Warum ist Team ${over[0]} überlastet?`, `Why is team ${over[0]} overloaded?`), 'gauge');
  if (deps.conflicts) add(g.now, T(L, 'Zeig die Abhängigkeiten als Netz', 'Show the dependencies as a network'), 'link');
  const crit = model.items.find((x) => x.health?.status === 'critical');
  if (crit) add(g.now, T(L, `Was ist bei ${crit.name} los?`, `What is going on with ${crit.name}?`), 'alert');
  if (supportA?.kpis.unlinked) add(g.now, T(L, 'Welche Projekte erzeugen den meisten Support?', 'Which projects create the most support?'), 'headset');
  if (dq.gaps.some((x) => x.urgent)) add(g.now, T(L, 'Welche Datenlücken sind dringend?', 'Which data gaps are urgent?'), 'shield');
  // general
  add(g.more, T(L, 'Fortschritt aller Projekte als Balken', 'Progress of all projects as bars'), 'ranking');
  add(g.more, T(L, 'Schätzung gegen gebuchte Zeit', 'Estimate vs logged time'), 'clock');
  add(g.more, T(L, 'Was ist überfällig?', 'What is overdue?'), 'calendar');
  add(g.more, T(L, 'Wie stehen die Meilensteine?', 'How are the milestones?'), 'milestone');
  add(g.more, T(L, 'Auslastung der Teams als Heatmap', 'Team utilisation as a heatmap'), 'grid');
  add(g.more, T(L, 'Wie viele Epics gibt es?', 'How many epics are there?'), 'layers');
  return out;
}
